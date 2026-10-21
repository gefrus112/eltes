# ==========================================================================
# Eltes CAI engine — AWK port (POSIX awk; tested with mawk and gawk).
#
# Arithmetic, percentages, unit and temperature conversion, with an explicit
# refusal for anything outside those rules. No network, no model weights.
#
#     awk -f ports/awk/cai.awk ports/vectors.tsv
# ==========================================================================

BEGIN {
    FS = "\t"
    init_units()
    target = (ARGV[1] == "") ? "../vectors.tsv" : ARGV[1]
    status = run_vectors(target)
    close(target)
    exit(status)
}

# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------

function fmt(v,    magnitude, text, mantissa, exponent, cut) {
    if (v != v) return "NaN"
    magnitude = (v < 0) ? -v : v
    if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
        text = sprintf("%.10e", v)
        cut = index(text, "e")
        if (cut == 0) return text
        mantissa = substr(text, 1, cut - 1)
        exponent = substr(text, cut + 1) + 0
        if (index(mantissa, ".") > 0) {
            sub(/0+$/, "", mantissa)
            sub(/\.$/, "", mantissa)
        }
        return mantissa "e" exponent
    }

    text = sprintf("%.10f", v)
    sub(/0+$/, "", text)
    sub(/\.$/, "", text)
    if (text == "" || text == "-0" || text == "-") return "0"
    return text
}

# --------------------------------------------------------------------------
# characters
# --------------------------------------------------------------------------

function is_digit(c) { return c ~ /^[0-9]$/ }
function is_letter(c) { return c ~ /^[a-zA-Z]$/ }
function is_space(c) { return c == " " || c == "\t" || c == "\r" }

function digit_before(s, idx,    cursor, c) {
    for (cursor = idx - 1; cursor >= 1; cursor--) {
        c = substr(s, cursor, 1)
        if (is_space(c)) continue
        return is_digit(c)
    }
    return 0
}

function digit_after(s, idx,    cursor, c, n) {
    n = length(s)
    for (cursor = idx + 1; cursor <= n; cursor++) {
        c = substr(s, cursor, 1)
        if (is_space(c)) continue
        return is_digit(c)
    }
    return 0
}

function prepare(source,    text, out, idx, n, c) {
    text = source
    gsub(/×/, "*", text)
    gsub(/✕/, "*", text)
    gsub(/✖/, "*", text)
    gsub(/÷/, "/", text)
    gsub(/−/, "-", text)
    gsub(/–/, "-", text)
    gsub(/—/, "-", text)
    gsub(/²/, "^2", text)
    gsub(/³/, "^3", text)

    out = ""
    n = length(text)
    for (idx = 1; idx <= n; idx++) {
        c = substr(text, idx, 1)
        if ((c == "x" || c == "X") && digit_before(text, idx) && digit_after(text, idx)) {
            out = out "*"
        } else {
            out = out c
        }
    }
    return out
}

# --------------------------------------------------------------------------
# tokens: 1 number, 2 ident, 3 op, 4 open, 5 close, 6 comma
# --------------------------------------------------------------------------

function push_token(kind, value, text, op) {
    TN++
    TK_K[TN] = kind
    TK_V[TN] = value
    TK_T[TN] = text
    TK_O[TN] = op
}

function tokenize(source,    s, idx, n, c, start, literal, probe, value) {
    s = prepare(source)
    TN = 0
    idx = 1
    n = length(s)

    while (idx <= n) {
        c = substr(s, idx, 1)

        if (is_space(c)) {
            idx++
            continue
        }

        if (is_digit(c) || (c == "." && idx + 1 <= n && is_digit(substr(s, idx + 1, 1)))) {
            start = idx
            while (idx <= n && is_digit(substr(s, idx, 1))) idx++
            if (idx <= n && substr(s, idx, 1) == ".") {
                idx++
                while (idx <= n && is_digit(substr(s, idx, 1))) idx++
            }
            if (idx <= n && (substr(s, idx, 1) == "e" || substr(s, idx, 1) == "E")) {
                probe = idx + 1
                if (probe <= n && (substr(s, probe, 1) == "+" || substr(s, probe, 1) == "-")) probe++
                if (probe <= n && is_digit(substr(s, probe, 1))) {
                    while (probe <= n && is_digit(substr(s, probe, 1))) probe++
                    idx = probe
                }
            }
            literal = substr(s, start, idx - start)
            value = literal + 0
            if (value != value || value == "" || (value == 0 && literal !~ /^[+-]?0*\.?0*$/)) {
                return 0
            }
            push_token(1, value, "", "")
            continue
        }

        if (is_letter(c)) {
            start = idx
            while (idx <= n && is_letter(substr(s, idx, 1))) idx++
            push_token(2, 0, tolower(substr(s, start, idx - start)), "")
            continue
        }

        if (c ~ /^[+*\/^%!-]$/) {
            push_token(3, 0, "", c)
            idx++
            continue
        }
        if (c == "(") { push_token(4, 0, "", ""); idx++; continue }
        if (c == ")") { push_token(5, 0, "", ""); idx++; continue }
        if (c == ",") { push_token(6, 0, "", ""); idx++; continue }
        return 0
    }

    # implicit multiplication: 2pi, 2(3+4), (1+1)(2+2)
    EN = 0
    for (idx = 1; idx <= TN; idx++) {
        if (EN > 0) {
            ends = (EK_K[EN] == 1 || EK_K[EN] == 5 ||
                    (EK_K[EN] == 2 && (EK_T[EN] == "pi" || EK_T[EN] == "e")))
            starts = (TK_K[idx] == 1 || TK_K[idx] == 2 || TK_K[idx] == 4)
            is_call = (EK_K[EN] == 2 && (EK_T[EN] in FUNCTION_MAX) && TK_K[idx] == 4)
            if (ends && starts && !is_call) {
                EN++
                EK_K[EN] = 3; EK_V[EN] = 0; EK_T[EN] = ""; EK_O[EN] = "*"
            }
        }
        EN++
        EK_K[EN] = TK_K[idx]
        EK_V[EN] = TK_V[idx]
        EK_T[EN] = TK_T[idx]
        EK_O[EN] = TK_O[idx]
    }
    return 1
}

# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

function precedence(op) {
    if (op == "+" || op == "-") return 1
    if (op == "*" || op == "/" || op == "%") return 2
    if (op == "^") return 3
    return 0
}

function factorial(value) {
    if (value < 0 || value != int(value) || value > 170) {
        PR_ERR = 1
        return 0
    }
    result = 1
    for (step = 2; step <= value; step++) result *= step
    return result
}

function parse_expr(minimum,    left, op, current, right, next_min, value) {
    left = parse_primary()
    if (PR_ERR) return 0

    while (TP <= EN && EK_K[TP] == 3 && EK_O[TP] == "!") {
        TP++
        left = factorial(left)
        if (PR_ERR) return 0
    }

    while (TP <= EN && EK_K[TP] == 3) {
        op = EK_O[TP]
        current = precedence(op)
        if (current == 0 || current < minimum) break
        TP++
        next_min = (op == "^") ? current : current + 1
        right = parse_expr(next_min)
        if (PR_ERR) return 0

        if (op == "+") {
            left += right
        } else if (op == "-") {
            left -= right
        } else if (op == "*") {
            left *= right
        } else if (op == "/") {
            if (right == 0) { PR_ERR = 2; return 0 }
            left /= right
        } else if (op == "%") {
            if (right == 0) { PR_ERR = 2; return 0 }
            left = left - int(left / right) * right
        } else if (op == "^") {
            left = left ^ right
        } else {
            PR_ERR = 1
            return 0
        }
        if (left != left || left >= 1e308 || left <= -1e308) { PR_ERR = 2; return 0 }
    }

    return left
}

function parse_primary(    kind, value, text, op, inner, base, count, result) {
    if (TP > EN) {
        PR_ERR = 1
        return 0
    }

    kind = EK_K[TP]
    value = EK_V[TP]
    text = EK_T[TP]
    op = EK_O[TP]
    TP++

    if (kind == 1) return value

    if (kind == 3 && (op == "-" || op == "+")) {
        inner = parse_expr(3)
        if (PR_ERR) return 0
        return (op == "-") ? -inner : inner
    }

    if (kind == 4) {
        inner = parse_expr(0)
        if (PR_ERR) return 0
        if (TP > EN || EK_K[TP] != 5) {
            PR_ERR = 1
            return 0
        }
        TP++
        return inner
    }

    if (kind == 2) {
        if (TP <= EN && EK_K[TP] == 4 && (text in FUNCTION_MIN)) {
            TP++
            base = FARGN
            if (TP <= EN && EK_K[TP] != 5) {
                FARGN++
                FARG[FARGN] = parse_expr(0)
                if (PR_ERR) return 0
                while (TP <= EN && EK_K[TP] == 6) {
                    TP++
                    FARGN++
                    FARG[FARGN] = parse_expr(0)
                    if (PR_ERR) return 0
                }
            }
            count = FARGN - base
            if (TP > EN || EK_K[TP] != 5) {
                FARGN = base
                PR_ERR = 1
                return 0
            }
            TP++
            result = call_function(text, base, count)
            FARGN = base
            return result
        }
        if (text == "pi") return 3.141592653589793
        if (text == "e") return 2.718281828459045
    }

    PR_ERR = 1
    return 0
}

function call_function(name, base, count,    first, second, total, idx, current, minimum) {
    if (count < FUNCTION_MIN[name] || count > FUNCTION_MAX[name]) {
        PR_ERR = 1
        return 0
    }
    first = FARG[base + 1]

    if (name == "sqrt") {
        if (first < 0) { PR_ERR = 2; return 0 }
        return sqrt(first)
    }
    if (name == "cbrt") {
        if (first < 0) return -((-first) ^ (1 / 3))
        return first ^ (1 / 3)
    }
    if (name == "abs") return (first < 0) ? -first : first
    if (name == "sin") return sin(first)
    if (name == "cos") return cos(first)
    if (name == "tan") {
        if (cos(first) == 0) { PR_ERR = 2; return 0 }
        return sin(first) / cos(first)
    }
    if (name == "asin") {
        if (first < -1 || first > 1) { PR_ERR = 2; return 0 }
        return atan2(first, sqrt(1 - first * first))
    }
    if (name == "acos") {
        if (first < -1 || first > 1) { PR_ERR = 2; return 0 }
        return atan2(sqrt(1 - first * first), first)
    }
    if (name == "atan") return atan2(first, 1)
    if (name == "ln" || name == "log" || name == "log10" || name == "log2") {
        if (first <= 0) { PR_ERR = 2; return 0 }
        if (name == "log" && count == 2) {
            second = FARG[base + 2]
            if (second <= 0 || second == 1) { PR_ERR = 2; return 0 }
            return log(first) / log(second)
        }
        if (name == "log10") return log(first) / log(10)
        if (name == "log2") return log(first) / log(2)
        return log(first)
    }
    if (name == "exp") return exp(first)
    if (name == "floor") return int(first) - (first < 0 && first != int(first) ? 1 : 0)
    if (name == "ceil") return int(first) + (first > 0 && first != int(first) ? 1 : 0)
    if (name == "round") return int(first + (first >= 0 ? 0.5 : -0.5))
    if (name == "pow") return first ^ FARG[base + 2]
    if (name == "min" || name == "max") {
        total = first
        for (idx = 2; idx <= count; idx++) {
            current = FARG[base + idx]
            if (name == "min") {
                if (current < total) total = current
            } else {
                if (current > total) total = current
            }
        }
        return total
    }
    if (name == "sum" || name == "mean") {
        total = 0
        for (idx = 1; idx <= count; idx++) total += FARG[base + idx]
        return (name == "mean") ? total / count : total
    }
    if (name == "product") {
        total = 1
        for (idx = 1; idx <= count; idx++) total *= FARG[base + idx]
        return total
    }
    PR_ERR = 1
    return 0
}

function evaluate(source,    value) {
    PR_ERR = 0
    FARGN = 0
    if (!tokenize(source)) {
        PR_ERR = 1
        return 0
    }
    if (EN == 0) {
        PR_ERR = 1
        return 0
    }
    TP = 1
    value = parse_expr(0)
    if (PR_ERR) return 0
    if (TP != EN + 1) {
        PR_ERR = 1
        return 0
    }
    if (value != value || value >= 1e308 || value <= -1e308) {
        PR_ERR = 2
        return 0
    }
    return value
}

# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

function add_unit(name, kind, factor) {
    UNIT_KIND[name] = kind
    UNIT_FACTOR[name] = factor
}

function init_units() {
    add_unit("mm", "length", 0.001); add_unit("cm", "length", 0.01)
    add_unit("m", "length", 1); add_unit("metre", "length", 1)
    add_unit("metres", "length", 1); add_unit("meter", "length", 1)
    add_unit("meters", "length", 1); add_unit("km", "length", 1000)
    add_unit("in", "length", 0.0254); add_unit("inch", "length", 0.0254)
    add_unit("inches", "length", 0.0254); add_unit("ft", "length", 0.3048)
    add_unit("feet", "length", 0.3048); add_unit("foot", "length", 0.3048)
    add_unit("yd", "length", 0.9144); add_unit("mi", "length", 1609.344)
    add_unit("mile", "length", 1609.344); add_unit("miles", "length", 1609.344)

    add_unit("mg", "mass", 0.001); add_unit("g", "mass", 1)
    add_unit("kg", "mass", 1000); add_unit("oz", "mass", 28.349523125)
    add_unit("lb", "mass", 453.59237); add_unit("lbs", "mass", 453.59237)
    add_unit("pound", "mass", 453.59237); add_unit("pounds", "mass", 453.59237)
    add_unit("stone", "mass", 6350.29318); add_unit("st", "mass", 6350.29318)

    add_unit("ml", "volume", 0.001); add_unit("l", "volume", 1)
    add_unit("litre", "volume", 1); add_unit("litres", "volume", 1)
    add_unit("liter", "volume", 1); add_unit("liters", "volume", 1)
    add_unit("tsp", "volume", 0.00492892159); add_unit("tbsp", "volume", 0.0147867648)
    add_unit("cup", "volume", 0.2365882365); add_unit("pint", "volume", 0.473176473)
    add_unit("qt", "volume", 0.946352946); add_unit("quart", "volume", 0.946352946)
    add_unit("gal", "volume", 3.785411784); add_unit("gallon", "volume", 3.785411784)
    add_unit("gallons", "volume", 3.785411784)

    add_unit("b", "data", 1); add_unit("kb", "data", 1e3)
    add_unit("mb", "data", 1e6); add_unit("gb", "data", 1e9)
    add_unit("tb", "data", 1e12); add_unit("kib", "data", 1024)
    add_unit("mib", "data", 1048576); add_unit("gib", "data", 1073741824)

    add_unit("km/h", "speed", 0.277777778); add_unit("kph", "speed", 0.277777778)
    add_unit("mph", "speed", 0.44704); add_unit("m/s", "speed", 1)

    add_unit("m2", "area", 1); add_unit("km2", "area", 1e6)
    add_unit("ft2", "area", 0.09290304); add_unit("sqft", "area", 0.09290304)
    add_unit("acre", "area", 4046.8564224); add_unit("hectare", "area", 10000)
    add_unit("ha", "area", 10000)

    FUNCTION_MIN["sqrt"] = 1; FUNCTION_MAX["sqrt"] = 1
    FUNCTION_MIN["cbrt"] = 1; FUNCTION_MAX["cbrt"] = 1
    FUNCTION_MIN["abs"] = 1; FUNCTION_MAX["abs"] = 1
    FUNCTION_MIN["sin"] = 1; FUNCTION_MAX["sin"] = 1
    FUNCTION_MIN["cos"] = 1; FUNCTION_MAX["cos"] = 1
    FUNCTION_MIN["tan"] = 1; FUNCTION_MAX["tan"] = 1
    FUNCTION_MIN["asin"] = 1; FUNCTION_MAX["asin"] = 1
    FUNCTION_MIN["acos"] = 1; FUNCTION_MAX["acos"] = 1
    FUNCTION_MIN["atan"] = 1; FUNCTION_MAX["atan"] = 1
    FUNCTION_MIN["exp"] = 1; FUNCTION_MAX["exp"] = 1
    FUNCTION_MIN["floor"] = 1; FUNCTION_MAX["floor"] = 1
    FUNCTION_MIN["ceil"] = 1; FUNCTION_MAX["ceil"] = 1
    FUNCTION_MIN["round"] = 1; FUNCTION_MAX["round"] = 1
    FUNCTION_MIN["ln"] = 1; FUNCTION_MAX["ln"] = 1
    FUNCTION_MIN["log10"] = 1; FUNCTION_MAX["log10"] = 1
    FUNCTION_MIN["log2"] = 1; FUNCTION_MAX["log2"] = 1
    FUNCTION_MIN["log"] = 1; FUNCTION_MAX["log"] = 2
    FUNCTION_MIN["pow"] = 2; FUNCTION_MAX["pow"] = 2
    FUNCTION_MIN["min"] = 1; FUNCTION_MAX["min"] = 1000000
    FUNCTION_MIN["max"] = 1; FUNCTION_MAX["max"] = 1000000
    FUNCTION_MIN["sum"] = 1; FUNCTION_MAX["sum"] = 1000000
    FUNCTION_MIN["mean"] = 1; FUNCTION_MAX["mean"] = 1000000
    FUNCTION_MIN["product"] = 1; FUNCTION_MAX["product"] = 1000000
}

function temperature_convert(value, from, to,    celsius) {
    if (from == "c") celsius = value
    else if (from == "f") celsius = (value - 32) * 5 / 9
    else celsius = value - 273.15

    if (to == "c") return celsius
    if (to == "f") return celsius * 9 / 5 + 32
    return celsius + 273.15
}

# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

function normalize(text,    out) {
    out = tolower(text)
    gsub(/’/, "'", out)
    gsub(/‘/, "'", out)
    gsub(/−/, "-", out)
    gsub(/–/, "-", out)
    gsub(/—/, "-", out)
    gsub(/²/, "^2", out)
    gsub(/³/, "^3", out)
    sub(/^[ \t]+/, "", out)
    sub(/[ \t]+$/, "", out)
    gsub(/[ \t]+/, " ", out)
    return out
}

function words_of(text, list,    copy) {
    copy = text
    sub(/^[ \t]+/, "", copy)
    sub(/[ \t]+$/, "", copy)
    if (copy == "") return 0
    return split(copy, list, /[ \t]+/)
}

function is_number_word(word) {
    return word ~ /^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$/
}

# sets SN_VALUE and SN_SUFFIX; returns 1 on success
function split_number(word,    head, rest) {
    if (!match(word, /^[+-]?[0-9]*\.?[0-9]+/)) return 0
    head = substr(word, 1, RLENGTH)
    rest = substr(word, RLENGTH + 1)
    SN_VALUE = head + 0
    SN_SUFFIX = rest
    return 1
}

function percent_intent(text,    list, count, local_text, idx, percent, base, part, change, start, end_) {
    local_text = text
    gsub(/%/, " percent ", local_text)
    count = words_of(local_text, list)

    for (idx = 1; idx + 3 <= count; idx++) {
        if (list[idx + 1] != "percent") continue
        if (list[idx + 2] != "of" && list[idx + 2] != "off") continue
        if (!is_number_word(list[idx]) || !is_number_word(list[idx + 3])) continue

        percent = list[idx] + 0
        base = list[idx + 3] + 0
        part = percent / 100 * base

        if (list[idx + 2] == "off") {
            return "**" fmt(base - part) "** after " fmt(percent) "% off " fmt(base) \
                   " (a discount of " fmt(part) ")."
        }
        return "**" fmt(part) "** — " fmt(percent) "% of " fmt(base) ".\n\n" \
               fmt(base) " × " fmt(percent) " / 100 = " fmt(part)
    }

    if (text !~ /percent|increase|decrease|change/) return ""

    for (idx = 1; idx + 3 <= count; idx++) {
        if (list[idx] != "from" || list[idx + 2] != "to") continue
        if (!is_number_word(list[idx + 1]) || !is_number_word(list[idx + 3])) continue

        start = list[idx + 1] + 0
        end_ = list[idx + 3] + 0
        if (start == 0) {
            return "Percentage change from zero is undefined because the calculation " \
                   "divides by the starting value. I will not report a finite percentage."
        }
        change = (end_ - start) / ((start < 0) ? -start : start) * 100
        return "**" fmt(change) "%** change from " fmt(start) " to " fmt(end_) ".\n\n" \
               "Formula: (" fmt(end_) " − " fmt(start) ") ÷ |" fmt(start) "| × 100"
    }

    return ""
}

function unit_intent(text,    prepared, list, count, idx, source, cursor, target, fromKind, \
                     toKind, converted, note, fromText, toText, value) {
    prepared = text
    gsub(/°/, " ", prepared)
    gsub(/degrees/, " ", prepared)
    gsub(/degree/, " ", prepared)
    gsub(/celsius/, " c ", prepared)
    gsub(/centigrade/, " c ", prepared)
    gsub(/fahrenheit/, " f ", prepared)
    gsub(/kelvin/, " k ", prepared)

    count = words_of(prepared, list)

    for (idx = 1; idx <= count; idx++) {
        if (!split_number(list[idx])) continue
        value = SN_VALUE

        if (SN_SUFFIX == "") {
            if (idx + 1 > count) continue
            source = list[idx + 1]
            cursor = idx + 2
        } else {
            source = SN_SUFFIX
            cursor = idx + 1
        }
        if (cursor + 1 > count) continue
        if (list[cursor] != "to" && list[cursor] != "in" && list[cursor] != "into" && list[cursor] != "as") continue
        target = list[cursor + 1]

        if (length(source) == 1 && length(target) == 1 && \
            source ~ /^[cfk]$/ && target ~ /^[cfk]$/) {
            fromText = toupper(source)
            toText = toupper(target)
            if (source == target) {
                return fmt(value) " °" fromText " is the same in °" toText "."
            }
            converted = temperature_convert(value, source, target)
            return "**" fmt(converted) " °" toText "**\n\n`" fmt(value) " °" fromText \
                   " → " fmt(converted) " °" toText "`"
        }

        if (!(source in UNIT_KIND) || !(target in UNIT_KIND)) continue
        fromKind = UNIT_KIND[source]
        toKind = UNIT_KIND[target]
        if (fromKind != toKind) continue

        converted = value * UNIT_FACTOR[source] / UNIT_FACTOR[target]
        note = (fromKind == "data") ? "Using decimal units (1 KB = 1,000 bytes)." \
                                    : "Exact conversion factors."
        return "**" fmt(converted) " " target "**\n\n`" fmt(value) " " source " = " \
               fmt(converted) " " target "`\n\n" note
    }

    return ""
}

function strip_prefix(text, prefix,    length_of) {
    length_of = length(prefix)
    if (substr(text, 1, length_of) != prefix) return ""
    return substr(text, length_of + 1)
}

function math_intent(text,    candidate, rest, display, note, value, idx, hasDigit, hasConstant, \
                     fragments, count) {
    candidate = text
    sub(/^[ \t]+/, "", candidate)
    sub(/[ \t]+$/, "", candidate)

    fragments[1] = "what's "
    fragments[2] = "what is "
    fragments[3] = "what is the value of "
    fragments[4] = "calculate "
    fragments[5] = "compute "
    fragments[6] = "solve "
    fragments[7] = "evaluate "
    fragments[8] = "how much is "
    for (idx = 1; idx <= 8; idx++) {
        rest = strip_prefix(candidate, fragments[idx])
        if (rest != "") {
            candidate = rest
            sub(/^[ \t]+/, "", candidate)
            sub(/[ \t]+$/, "", candidate)
            break
        }
    }

    sub(/[?=]+$/, "", candidate)
    sub(/^[ \t]+/, "", candidate)
    sub(/[ \t]+$/, "", candidate)
    rest = strip_prefix(candidate, "the ")
    if (rest != "") candidate = rest

    rest = strip_prefix(candidate, "square root of ")
    if (rest != "") candidate = "sqrt(" rest ")"
    else {
        rest = strip_prefix(candidate, "cube root of ")
        if (rest != "") candidate = "cbrt(" rest ")"
        else {
            rest = strip_prefix(candidate, "factorial of ")
            if (rest != "") candidate = rest "!"
            else if (candidate ~ / squared$/ && length(candidate) > 8)
                candidate = "(" substr(candidate, 1, length(candidate) - 8) ")^2"
            else if (candidate ~ / cubed$/ && length(candidate) > 6)
                candidate = "(" substr(candidate, 1, length(candidate) - 6) ")^3"
        }
    }

    candidate = " " candidate " "
    gsub(/ to the power of /, "^", candidate)
    gsub(/ divided by /, "/", candidate)
    gsub(/ multiplied by /, "*", candidate)
    gsub(/ times /, "*", candidate)
    gsub(/ plus /, "+", candidate)
    gsub(/ minus /, "-", candidate)
    sub(/^[ \t]+/, "", candidate)
    sub(/[ \t]+$/, "", candidate)

    if (candidate == "") return ""
    if (candidate !~ /^[a-zA-Z0-9+\-*\/^%(),!. ]+$/) return ""

    hasDigit = (candidate ~ /[0-9]/)
    hasConstant = 0
    count = split(candidate, fragments, /[^a-zA-Z]+/)
    for (idx = 1; idx <= count; idx++) {
        if (fragments[idx] == "pi" || fragments[idx] == "e") hasConstant = 1
    }
    if (!hasDigit && !hasConstant) return ""

    value = evaluate(candidate)
    if (PR_ERR == 1) return ""
    if (PR_ERR == 2) {
        ANS_INTENT = "math-limit"
        return "That expression does not produce a finite number (for example, division " \
               "by zero, an invalid function domain or numeric overflow), so I will not " \
               "present it as a normal result."
    }

    display = candidate
    gsub(/\*/, "×", display)
    note = ""
    if (candidate ~ /sin\(|cos\(|tan\(|asin\(|acos\(|atan\(/) {
        note = "\n\nTrigonometric functions use radians."
    }
    ANS_INTENT = "math"
    return "**" fmt(value) "**\n\nExpression: " display " = " fmt(value) note
}

function answer(prompt,    text, lowered, result, idx, list, count) {
    ANS_INTENT = ""
    ANS_TEXT = ""

    text = prompt
    sub(/^[ \t]+/, "", text)
    sub(/[ \t]+$/, "", text)

    if (text == "") {
        ANS_INTENT = "empty"
        ANS_TEXT = "Ask me for arithmetic, percentages or a unit conversion. I answer on " \
                   "this device, so there is no network round trip."
        return
    }

    lowered = normalize(text)

    result = percent_intent(lowered)
    if (result != "") {
        ANS_INTENT = "percent"
        ANS_TEXT = result
        return
    }

    result = unit_intent(lowered)
    if (result != "") {
        ANS_INTENT = "units"
        ANS_TEXT = result
        return
    }

    result = math_intent(lowered)
    if (result != "") {
        ANS_TEXT = result
        return
    }

    count = split("weather|news|stock price|score|who won|latest|headlines|browse|search the web", list, "|")
    for (idx = 1; idx <= count; idx++) {
        if (cx_contains(lowered, list[idx])) {
            ANS_INTENT = "live"
            ANS_TEXT = "I cannot check live information — this engine has no network " \
                       "access, and it will not invent an answer.\n\nSwitch to a connected " \
                       "hosted model for current facts, or paste the source text here and " \
                       "I will help you reason about it."
            return
        }
    }

    ANS_INTENT = "fallback"
    ANS_TEXT = "I want to be straight with you: **this is a small on-device engine**, and " \
               "that question is outside what it can answer reliably.\n\nIt is solid on:" \
               "\n\n- arithmetic and percentages\n- unit and temperature conversions\n\n" \
               "Switch to a hosted model for open-ended writing, code review or live information."
}

# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

function cx_contains(haystack, needle) {
    if (needle == "") return 1
    return index(haystack, needle) > 0
}

function run_vectors(path,    line, number, fields, count, checked, failures, idx, fragment, \
                     pieces, pieces_n, value, expected, tolerance, intent, text) {
    checked = 0
    failures = 0
    number = 0

    while ((getline line < path) > 0) {
        number++
        sub(/\r$/, "", line)
        if (line ~ /^[ \t]*$/ || substr(line, 1, 1) == "#") continue

        count = split(line, fields, "\t")
        if (count < 3) {
            print "FAIL line " number ": expected at least 3 columns"
            failures++
            continue
        }
        checked++

        if (fields[1] == "eval") {
            value = evaluate(fields[2])
            if (PR_ERR) {
                print "FAIL line " number ": '" fields[2] "' -> error"
                failures++
                continue
            }
            expected = fields[3] + 0
            tolerance = 1e-9 * (((expected < 0 ? -expected : expected) > 1) ? (expected < 0 ? -expected : expected) : 1)
            if ((value - expected) > tolerance || (expected - value) > tolerance) {
                print "FAIL line " number ": '" fields[2] "' -> " value ", wanted " fields[3]
                failures++
            }
            continue
        }

        answer(fields[2])
        intent = ANS_INTENT
        text = ANS_TEXT

        if (intent != fields[3]) {
            print "FAIL line " number ": '" fields[2] "' -> intent " intent ", wanted " fields[3]
            failures++
            continue
        }
        if (count >= 4 && fields[4] != "") {
            pieces_n = split(fields[4], pieces, "|")
            for (idx = 1; idx <= pieces_n; idx++) {
                fragment = pieces[idx]
                if (!cx_contains(text, fragment)) {
                    print "FAIL line " number ": '" fields[2] "' -> text missing '" fragment "'"
                    failures++
                    break
                }
            }
        }
    }

    if (failures > 0) {
        print failures " failure(s) out of " checked " case(s)"
        return 1
    }
    print "ok: " checked " cases"
    return 0
}
