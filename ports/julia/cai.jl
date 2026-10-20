# ==========================================================================
# Eltes CAI engine — Julia port (standard library only).
#
# Arithmetic, percentages, unit and temperature conversion, with an explicit
# refusal for anything outside those rules. No network, no model weights.
#
#     julia ports/julia/cai.jl ports/vectors.tsv
# ==========================================================================

using Printf

const FUNCTIONS = Dict(
    "sqrt" => (1, 1), "cbrt" => (1, 1), "abs" => (1, 1),
    "sin" => (1, 1), "cos" => (1, 1), "tan" => (1, 1),
    "asin" => (1, 1), "acos" => (1, 1), "atan" => (1, 1),
    "exp" => (1, 1), "floor" => (1, 1), "ceil" => (1, 1), "round" => (1, 1),
    "ln" => (1, 1), "log10" => (1, 1), "log2" => (1, 1),
    "log" => (1, 2), "pow" => (2, 2),
    "min" => (1, typemax(Int)), "max" => (1, typemax(Int)),
    "sum" => (1, typemax(Int)), "mean" => (1, typemax(Int)),
    "product" => (1, typemax(Int)),
)

const PRECEDENCE = Dict('+' => 1, '-' => 1, '*' => 2, '/' => 2, '%' => 2, '^' => 3)

# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------

function format_number(value::Float64)
    isnan(value) && return "NaN"
    value == Inf && return "Infinity"
    value == -Inf && return "-Infinity"

    magnitude = abs(value)
    if magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)
        raw = @sprintf("%.10e", value)
        parts = split(raw, 'e')
        length(parts) < 2 && return raw
        mantissa = parts[1]
        exponent = parts[2]
        if occursin('.', mantissa)
            mantissa = replace(mantissa, r"0+$" => "")
            mantissa = replace(mantissa, r"\.$" => "")
        end
        return string(mantissa, "e", exponent)
    end

    rounded = round(value * 1e10) / 1e10
    rounded == 0 && return "0"
    text = @sprintf("%.10f", rounded)
    text = replace(text, r"0+$" => "")
    text = replace(text, r"\.$" => "")
    return isempty(text) ? "0" : text
end

# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

struct Token
    kind::Symbol
    value::Float64
    text::String
    op::Char
end

Token(kind::Symbol; value::Float64 = 0.0, text::String = "", op::Char = ' ') =
    Token(kind, value, text, op)

function digit_before(chars::Vector{Char}, index::Int)
    cursor = index - 1
    while cursor >= 1
        isspace(chars[cursor]) || return isdigit(chars[cursor])
        cursor -= 1
    end
    return false
end

function digit_after(chars::Vector{Char}, index::Int)
    cursor = index + 1
    while cursor <= length(chars)
        isspace(chars[cursor]) || return isdigit(chars[cursor])
        cursor += 1
    end
    return false
end

function prepare(source::String)
    text = replace(source,
        "×" => "*", "✕" => "*", "✖" => "*",
        "÷" => "/",
        "−" => "-", "–" => "-", "—" => "-",
        "²" => "^2", "³" => "^3")
    chars = collect(text)
    out = IOBuffer()
    for (index, ch) in enumerate(chars)
        if (ch == 'x' || ch == 'X') && digit_before(chars, index) && digit_after(chars, index)
            print(out, '*')
        else
            print(out, ch)
        end
    end
    return String(take!(out))
end

function tokenize(source::String)
    text = prepare(source)
    chars = collect(text)
    tokens = Token[]
    index = 1
    n = length(chars)

    while index <= n
        ch = chars[index]

        if isspace(ch)
            index += 1
            continue
        end

        if isdigit(ch) || (ch == '.' && index + 1 <= n && isdigit(chars[index + 1]))
            start = index
            while index <= n && isdigit(chars[index])
                index += 1
            end
            if index <= n && chars[index] == '.'
                index += 1
                while index <= n && isdigit(chars[index])
                    index += 1
                end
            end
            if index <= n && (chars[index] == 'e' || chars[index] == 'E')
                probe = index + 1
                if probe <= n && (chars[probe] == '+' || chars[probe] == '-')
                    probe += 1
                end
                if probe <= n && isdigit(chars[probe])
                    while probe <= n && isdigit(chars[probe])
                        probe += 1
                    end
                    index = probe
                end
            end
            literal = String(chars[start:index-1])
            value = tryparse(Float64, literal)
            (value === nothing || isnan(value) || isinf(value)) && error("bad number")
            push!(tokens, Token(:number; value = value))
            continue
        end

        if isletter(ch)
            start = index
            while index <= n && isletter(chars[index])
                index += 1
            end
            push!(tokens, Token(:ident; text = lowercase(String(chars[start:index-1]))))
            continue
        end

        if ch in ('+', '-', '*', '/', '^', '%', '!')
            push!(tokens, Token(:op; op = ch))
            index += 1
            continue
        end
        if ch == '('
            push!(tokens, Token(:open))
            index += 1
            continue
        end
        if ch == ')'
            push!(tokens, Token(:close))
            index += 1
            continue
        end
        if ch == ','
            push!(tokens, Token(:comma))
            index += 1
            continue
        end
        error("unexpected character")
    end

    expanded = Token[]
    for item in tokens
        if !isempty(expanded)
            previous = expanded[end]
            ends = previous.kind === :number || previous.kind === :close ||
                (previous.kind === :ident && (previous.text == "pi" || previous.text == "e"))
            starts = item.kind === :number || item.kind === :ident || item.kind === :open
            is_call = previous.kind === :ident && haskey(FUNCTIONS, previous.text) && item.kind === :open
            if ends && starts && !is_call
                push!(expanded, Token(:op; op = '*'))
            end
        end
        push!(expanded, item)
    end
    return expanded
end

# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

mutable struct Parser
    tokens::Vector{Token}
    position::Int
end

has_tokens(parser::Parser) = parser.position <= length(parser.tokens)

function factorial_value(value::Float64)
    if value < 0 || value != floor(value) || value > 170
        error("factorial domain")
    end
    result = 1.0
    step = 2.0
    while step <= value
        result *= step
        step += 1
    end
    return result
end

function call_function(name::String, args::Vector{Float64})
    bounds = get(FUNCTIONS, name, nothing)
    bounds === nothing && error("unknown function")
    (length(args) < bounds[1] || length(args) > bounds[2]) && error("argument count")
    first = args[1]

    name == "sqrt" && return sqrt(first)
    name == "cbrt" && return cbrt(first)
    name == "abs" && return abs(first)
    name == "sin" && return sin(first)
    name == "cos" && return cos(first)
    name == "tan" && return tan(first)
    name == "asin" && return asin(first)
    name == "acos" && return acos(first)
    name == "atan" && return atan(first)
    name == "ln" && return first > 0 ? log(first) : NaN
    name == "log10" && return first > 0 ? log10(first) : NaN
    name == "log2" && return first > 0 ? log2(first) : NaN
    name == "exp" && return exp(first)
    name == "floor" && return floor(first)
    name == "ceil" && return ceil(first)
    name == "round" && return round(first)
    if name == "log"
        return length(args) == 1 ? log(first) : log(first) / log(args[2])
    end
    name == "pow" && return first ^ args[2]
    name == "min" && return minimum(args)
    name == "max" && return maximum(args)
    name == "sum" && return sum(args)
    name == "mean" && return sum(args) / length(args)
    name == "product" && return prod(args)
    error("unknown function")
end

function primary(parser::Parser)
    has_tokens(parser) || error("parse")
    item = parser.tokens[parser.position]
    parser.position += 1

    if item.kind === :number
        return item.value
    end

    if item.kind === :op && (item.op == '-' || item.op == '+')
        value = expression(parser, 3)
        return item.op == '-' ? -value : value
    end

    if item.kind === :open
        value = expression(parser, 0)
        if !has_tokens(parser) || parser.tokens[parser.position].kind !== :close
            error("parse")
        end
        parser.position += 1
        return value
    end

    if item.kind === :ident
        if has_tokens(parser) && parser.tokens[parser.position].kind === :open &&
           haskey(FUNCTIONS, item.text)
            parser.position += 1
            args = Float64[]
            if has_tokens(parser) && parser.tokens[parser.position].kind !== :close
                push!(args, expression(parser, 0))
                while has_tokens(parser) && parser.tokens[parser.position].kind === :comma
                    parser.position += 1
                    push!(args, expression(parser, 0))
                end
            end
            if !has_tokens(parser) || parser.tokens[parser.position].kind !== :close
                error("parse")
            end
            parser.position += 1
            return call_function(item.text, args)
        end
        item.text == "pi" && return pi
        item.text == "e" && return ℯ
    end

    error("parse")
end

function expression(parser::Parser, min_precedence::Int)
    left = primary(parser)

    while has_tokens(parser) && parser.tokens[parser.position].kind === :op &&
          parser.tokens[parser.position].op == '!'
        parser.position += 1
        left = factorial_value(left)
    end

    while has_tokens(parser) && parser.tokens[parser.position].kind === :op
        op = parser.tokens[parser.position].op
        precedence = get(PRECEDENCE, op, 0)
        (precedence == 0 || precedence < min_precedence) && break
        parser.position += 1
        next_precedence = op == '^' ? precedence : precedence + 1
        right = expression(parser, next_precedence)
        if op == '+'
            left += right
        elseif op == '-'
            left -= right
        elseif op == '*'
            left *= right
        elseif op == '/'
            left /= right
        elseif op == '%'
            left = rem(left, right)
        elseif op == '^'
            left = left ^ right
        else
            error("parse")
        end
    end

    return left
end

function evaluate(source::String)
    tokens = tokenize(source)
    isempty(tokens) && error("parse")
    parser = Parser(tokens, 1)
    value = expression(parser, 0)
    parser.position != length(tokens) + 1 && error("parse")
    return value
end

# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

const UNITS = Dict{String, Tuple{String, Float64}}()

function register!(kind::String, rows)
    for (name, factor) in rows
        UNITS[name] = (kind, factor)
    end
end

register!("length", [
    "mm" => 0.001, "cm" => 0.01, "m" => 1.0, "metre" => 1.0, "metres" => 1.0,
    "meter" => 1.0, "meters" => 1.0, "km" => 1000.0, "in" => 0.0254, "inch" => 0.0254,
    "inches" => 0.0254, "ft" => 0.3048, "feet" => 0.3048, "foot" => 0.3048,
    "yd" => 0.9144, "mi" => 1609.344, "mile" => 1609.344, "miles" => 1609.344,
])
register!("mass", [
    "mg" => 0.001, "g" => 1.0, "kg" => 1000.0, "oz" => 28.349523125,
    "lb" => 453.59237, "lbs" => 453.59237, "pound" => 453.59237, "pounds" => 453.59237,
    "stone" => 6350.29318, "st" => 6350.29318,
])
register!("volume", [
    "ml" => 0.001, "l" => 1.0, "litre" => 1.0, "litres" => 1.0, "liter" => 1.0,
    "liters" => 1.0, "tsp" => 0.00492892159, "tbsp" => 0.0147867648,
    "cup" => 0.2365882365, "pint" => 0.473176473, "qt" => 0.946352946,
    "quart" => 0.946352946, "gal" => 3.785411784, "gallon" => 3.785411784,
    "gallons" => 3.785411784,
])
register!("data", [
    "b" => 1.0, "kb" => 1e3, "mb" => 1e6, "gb" => 1e9, "tb" => 1e12,
    "kib" => 1024.0, "mib" => 1048576.0, "gib" => 1073741824.0,
])
register!("speed", ["km/h" => 0.277777778, "kph" => 0.277777778, "mph" => 0.44704, "m/s" => 1.0])
register!("area", [
    "m2" => 1.0, "km2" => 1e6, "ft2" => 0.09290304, "sqft" => 0.09290304,
    "acre" => 4046.8564224, "hectare" => 10000.0, "ha" => 10000.0,
])

function temperature_convert(value::Float64, from::Char, to::Char)
    celsius = from == 'c' ? value : from == 'f' ? (value - 32) * 5 / 9 : value - 273.15
    to == 'c' && return celsius
    to == 'f' && return celsius * 9 / 5 + 32
    return celsius + 273.15
end

# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

function normalize(text::String)
    out = lowercase(text)
    out = replace(out, "’" => "'", "‘" => "'", "−" => "-", "–" => "-", "—" => "-",
        "²" => "^2", "³" => "^3")
    return join(split(strip(out)), " ")
end

is_number_word(word::AbstractString) =
    occursin(r"^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$", word)

function split_number(word::AbstractString)
    match_result = match(r"^([+-]?[0-9]*\.?[0-9]+)(.*)$"s, word)
    match_result === nothing && return nothing
    value = tryparse(Float64, match_result.captures[1])
    value === nothing && return nothing
    return (value, match_result.captures[2])
end

function percent_intent(text::String)
    words = split(replace(text, "%" => " percent "))

    for index in 1:max(0, length(words) - 3)
        words[index + 1] == "percent" || continue
        (words[index + 2] == "of" || words[index + 2] == "off") || continue
        (is_number_word(words[index]) && is_number_word(words[index + 3])) || continue

        percent = parse(Float64, words[index])
        base = parse(Float64, words[index + 3])
        part = percent / 100 * base

        if words[index + 2] == "off"
            return string("**", format_number(base - part), "** after ", format_number(percent),
                "% off ", format_number(base), " (a discount of ", format_number(part), ").")
        end
        return string("**", format_number(part), "** — ", format_number(percent), "% of ",
            format_number(base), ".\n\n", format_number(base), " × ", format_number(percent),
            " / 100 = ", format_number(part))
    end

    if occursin(r"percent|increase|decrease|change", text)
        for index in 1:max(0, length(words) - 3)
            (words[index] == "from" && words[index + 2] == "to") || continue
            (is_number_word(words[index + 1]) && is_number_word(words[index + 3])) || continue

            start = parse(Float64, words[index + 1])
            finish = parse(Float64, words[index + 3])
            if start == 0
                return "Percentage change from zero is undefined because the calculation " *
                       "divides by the starting value. I will not report a finite percentage."
            end
            change = (finish - start) / abs(start) * 100
            return string("**", format_number(change), "%** change from ", format_number(start),
                " to ", format_number(finish), ".\n\nFormula: (", format_number(finish), " − ",
                format_number(start), ") ÷ |", format_number(start), "| × 100")
        end
    end

    return nothing
end

function unit_intent(text::String)
    prepared = replace(text,
        "°" => " ", "degrees" => " ", "degree" => " ",
        "celsius" => " c ", "centigrade" => " c ", "fahrenheit" => " f ", "kelvin" => " k ")
    words = split(prepared)

    for (index, word) in enumerate(words)
        split_result = split_number(word)
        split_result === nothing && continue
        value, remainder = split_result

        source = ""
        cursor = 0
        if isempty(remainder)
            index + 1 > length(words) && continue
            source = words[index + 1]
            cursor = index + 2
        else
            source = remainder
            cursor = index + 1
        end
        cursor + 1 > length(words) && continue
        words[cursor] in ("to", "in", "into", "as") || continue
        target = words[cursor + 1]

        if length(source) == 1 && length(target) == 1 && source in ("c", "f", "k") &&
           target in ("c", "f", "k")
            from_label = uppercase(source)
            to_label = uppercase(target)
            if source == target
                return string(format_number(value), " °", from_label, " is the same in °",
                    to_label, ".")
            end
            converted = temperature_convert(value, source[1], target[1])
            return string("**", format_number(converted), " °", to_label, "**\n\n`",
                format_number(value), " °", from_label, " → ", format_number(converted),
                " °", to_label, "`")
        end

        from = get(UNITS, source, nothing)
        to = get(UNITS, target, nothing)
        (from === nothing || to === nothing || from[1] != to[1]) && continue

        converted = value * from[2] / to[2]
        note = from[1] == "data" ? "Using decimal units (1 KB = 1,000 bytes)." :
            "Exact conversion factors."
        return string("**", format_number(converted), " ", target, "**\n\n`",
            format_number(value), " ", source, " = ", format_number(converted), " ", target,
            "`\n\n", note)
    end

    return nothing
end

const PREFIXES = [
    "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
    "solve ", "evaluate ", "how much is ",
]

function strip_prefix(text::String, prefix::String)
    startswith(text, prefix) || return nothing
    length(text) <= length(prefix) && return ""
    return text[length(prefix)+1:end]
end

function math_intent(text::String)
    candidate = strip(text)
    for prefix in PREFIXES
        rest = strip_prefix(candidate, prefix)
        if rest !== nothing
            candidate = strip(rest)
            break
        end
    end
    candidate = strip(replace(candidate, r"[?=]+$" => ""))
    startswith(candidate, "the ") && (candidate = candidate[5:end])

    rest = strip_prefix(candidate, "square root of ")
    if rest !== nothing
        candidate = string("sqrt(", strip(rest), ")")
    elseif (rest = strip_prefix(candidate, "cube root of ")) !== nothing
        candidate = string("cbrt(", strip(rest), ")")
    elseif (rest = strip_prefix(candidate, "factorial of ")) !== nothing
        candidate = string(strip(rest), "!")
    elseif endswith(candidate, " squared") && length(candidate) > 8
        candidate = string("(", strip(candidate[1:end-8]), ")^2")
    elseif endswith(candidate, " cubed") && length(candidate) > 6
        candidate = string("(", strip(candidate[1:end-6]), ")^3")
    end

    padded = string(" ", candidate, " ")
    padded = replace(padded, " to the power of " => "^", " divided by " => "/",
        " multiplied by " => "*", " times " => "*", " plus " => "+", " minus " => "-")
    candidate = strip(padded)

    isempty(candidate) && return nothing
    occursin(r"^[a-zA-Z0-9+\-*/^%(),!. ]+$", candidate) || return nothing

    has_digit = occursin(r"[0-9]", candidate)
    has_constant = any(word -> word == "pi" || word == "e", split(candidate, r"[^a-zA-Z]+"))
    (!has_digit && !has_constant) && return nothing

    value = try
        evaluate(candidate)
    catch
        return nothing
    end

    if isnan(value) || isinf(value)
        return ("math-limit",
            "That expression does not produce a finite number (for example, division by " *
            "zero, an invalid function domain or numeric overflow), so I will not present " *
            "it as a normal result.")
    end

    shown = format_number(value)
    display = replace(candidate, "*" => "×")
    trig = occursin(r"sin\(|cos\(|tan\(|asin\(|acos\(|atan\(", candidate)
    note = trig ? "\n\nTrigonometric functions use radians." : ""
    return ("math", string("**", shown, "**\n\nExpression: ", display, " = ", shown, note))
end

const LIVE_WORDS = ["weather", "news", "stock price", "score", "who won", "latest",
    "headlines", "browse", "search the web"]

function answer(prompt::String)
    text = strip(prompt)
    if isempty(text)
        return ("empty",
            "Ask me for arithmetic, percentages or a unit conversion. I answer on this " *
            "device, so there is no network round trip.")
    end

    lowered = normalize(text)

    result = percent_intent(lowered)
    result !== nothing && return ("percent", result)

    result = unit_intent(lowered)
    result !== nothing && return ("units", result)

    result = math_intent(lowered)
    result !== nothing && return result

    for word in LIVE_WORDS
        if occursin(word, lowered)
            return ("live",
                "I cannot check live information — this engine has no network access, and " *
                "it will not invent an answer.\n\nSwitch to a connected hosted model for " *
                "current facts, or paste the source text here and I will help you reason " *
                "about it.")
        end
    end

    return ("fallback",
        "I want to be straight with you: **this is a small on-device engine**, and that " *
        "question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic " *
        "and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for " *
        "open-ended writing, code review or live information.")
end

# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

function run_vectors(path::String)
    lines = readlines(path)
    failures = String[]
    checked = 0

    for (offset, raw) in enumerate(lines)
        number = offset
        line = replace(raw, "\r" => "")
        (isempty(strip(line)) || startswith(line, "#")) && continue

        fields = split(line, '\t'; keepempty = true)
        if length(fields) < 3
            push!(failures, string("line ", number, ": expected at least 3 columns"))
            continue
        end
        checked += 1

        if fields[1] == "eval"
            value = try
                evaluate(fields[2])
            catch
                push!(failures, string("line ", number, ": '", fields[2], "' -> error"))
                continue
            end
            expected = parse(Float64, fields[3])
            tolerance = 1e-9 * max(1.0, abs(expected))
            if abs(value - expected) > tolerance
                push!(failures, string("line ", number, ": '", fields[2], "' -> ", value,
                    ", wanted ", fields[3]))
            end
            continue
        end

        intent, text = answer(fields[2])
        if intent != fields[3]
            push!(failures, string("line ", number, ": '", fields[2], "' -> intent ", intent,
                ", wanted ", fields[3]))
            continue
        end
        if length(fields) >= 4 && !isempty(fields[4])
            for fragment in split(fields[4], '|')
                if !occursin(fragment, text)
                    push!(failures, string("line ", number, ": '", fields[2],
                        "' -> text missing '", fragment, "'"))
                    break
                end
            end
        end
    end

    if !isempty(failures)
        foreach(failure -> println("FAIL ", failure), failures)
        println(length(failures), " failure(s) out of ", checked, " case(s)")
        return 1
    end
    println("ok: ", checked, " cases")
    return 0
end

target = length(ARGS) >= 1 ? ARGS[1] : joinpath(@__DIR__, "..", "vectors.tsv")
exit(run_vectors(target))
