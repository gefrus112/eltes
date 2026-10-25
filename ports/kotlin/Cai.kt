// ==========================================================================
// Eltes CAI engine — Kotlin port (standard library only).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     kotlinc Cai.kt -include-runtime -d cai.jar && java -jar cai.jar ../vectors.tsv
// ==========================================================================
import java.util.Locale
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.cbrt
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan
import kotlin.system.exitProcess

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

fun formatNumber(value: Double): String {
    if (value.isNaN()) return "NaN"
    if (value == Double.POSITIVE_INFINITY) return "Infinity"
    if (value == Double.NEGATIVE_INFINITY) return "-Infinity"

    val magnitude = abs(value)
    if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
        val raw = String.format(Locale.ROOT, "%.10e", value)
        val marker = raw.indexOf('e')
        if (marker < 0) return raw
        var mantissa = raw.substring(0, marker)
        val exponent = raw.substring(marker + 1)
        if (mantissa.contains('.')) {
            mantissa = mantissa.replace(Regex("0+$"), "").replace(Regex("\\.$"), "")
        }
        return mantissa + "e" + exponent
    }

    val rounded = round(value * 1e10) / 1e10
    if (rounded == 0.0) return "0"
    var text = String.format(Locale.ROOT, "%.10f", rounded)
    text = text.replace(Regex("0+$"), "").replace(Regex("\\.$"), "")
    return if (text.isEmpty()) "0" else text
}

// --------------------------------------------------------------------------
// tokens
// --------------------------------------------------------------------------

enum class Kind { NUMBER, IDENT, OPERATOR, OPEN, CLOSE, COMMA }

data class Token(
    val kind: Kind,
    val value: Double = 0.0,
    val text: String = "",
    val op: Char = ' ',
)

class ParseFailure(message: String) : RuntimeException(message)

val FUNCTIONS: Map<String, Pair<Int, Int>> = mapOf(
    "sqrt" to (1 to 1), "cbrt" to (1 to 1), "abs" to (1 to 1),
    "sin" to (1 to 1), "cos" to (1 to 1), "tan" to (1 to 1),
    "asin" to (1 to 1), "acos" to (1 to 1), "atan" to (1 to 1),
    "ln" to (1 to 1), "log10" to (1 to 1), "log2" to (1 to 1), "exp" to (1 to 1),
    "floor" to (1 to 1), "ceil" to (1 to 1), "round" to (1 to 1),
    "log" to (1 to 2), "pow" to (2 to 2),
    "min" to (1 to Int.MAX_VALUE), "max" to (1 to Int.MAX_VALUE),
    "sum" to (1 to Int.MAX_VALUE), "mean" to (1 to Int.MAX_VALUE),
    "product" to (1 to Int.MAX_VALUE),
)

val PRECEDENCE: Map<Char, Int> = mapOf('+' to 1, '-' to 1, '*' to 2, '/' to 2, '%' to 2, '^' to 3)

// --------------------------------------------------------------------------
// tokenizer
// --------------------------------------------------------------------------

fun digitBefore(text: String, index: Int): Boolean {
    for (cursor in index - 1 downTo 0) {
        if (text[cursor].isWhitespace()) continue
        return text[cursor].isDigit()
    }
    return false
}

fun digitAfter(text: String, index: Int): Boolean {
    for (cursor in index + 1 until text.length) {
        if (text[cursor].isWhitespace()) continue
        return text[cursor].isDigit()
    }
    return false
}

fun prepare(source: String): String {
    val text = source
        .replace("×", "*").replace("✕", "*").replace("✖", "*")
        .replace("÷", "/")
        .replace("−", "-").replace("–", "-").replace("—", "-")
        .replace("²", "^2").replace("³", "^3")

    val out = StringBuilder(text.length)
    for (index in text.indices) {
        val ch = text[index]
        if ((ch == 'x' || ch == 'X') && digitBefore(text, index) && digitAfter(text, index)) {
            out.append('*')
        } else {
            out.append(ch)
        }
    }
    return out.toString()
}

fun tokenize(source: String): List<Token> {
    val text = prepare(source)
    val tokens = mutableListOf<Token>()
    var index = 0

    while (index < text.length) {
        val ch = text[index]

        if (ch.isWhitespace()) { index++; continue }

        if (ch.isDigit() || (ch == '.' && index + 1 < text.length && text[index + 1].isDigit())) {
            val start = index
            while (index < text.length && text[index].isDigit()) index++
            if (index < text.length && text[index] == '.') {
                index++
                while (index < text.length && text[index].isDigit()) index++
            }
            if (index < text.length && (text[index] == 'e' || text[index] == 'E')) {
                var probe = index + 1
                if (probe < text.length && (text[probe] == '+' || text[probe] == '-')) probe++
                if (probe < text.length && text[probe].isDigit()) {
                    while (probe < text.length && text[probe].isDigit()) probe++
                    index = probe
                }
            }
            val literal = text.substring(start, index)
            val value = literal.toDoubleOrNull() ?: throw ParseFailure("bad number")
            if (value.isNaN() || value.isInfinite()) throw ParseFailure("bad number")
            tokens.add(Token(Kind.NUMBER, value))
            continue
        }

        if (ch.isLetter()) {
            val start = index
            while (index < text.length && text[index].isLetter()) index++
            tokens.add(Token(Kind.IDENT, text = text.substring(start, index).lowercase(Locale.ROOT)))
            continue
        }

        if ("+-*/^%!".contains(ch)) {
            tokens.add(Token(Kind.OPERATOR, op = ch))
            index++
            continue
        }
        if (ch == '(') { tokens.add(Token(Kind.OPEN)); index++; continue }
        if (ch == ')') { tokens.add(Token(Kind.CLOSE)); index++; continue }
        if (ch == ',') { tokens.add(Token(Kind.COMMA)); index++; continue }
        throw ParseFailure("unexpected character")
    }

    val expanded = mutableListOf<Token>()
    for (item in tokens) {
        val previous = expanded.lastOrNull()
        if (previous != null) {
            val ends = previous.kind == Kind.NUMBER || previous.kind == Kind.CLOSE ||
                (previous.kind == Kind.IDENT && (previous.text == "pi" || previous.text == "e"))
            val starts = item.kind == Kind.NUMBER || item.kind == Kind.IDENT || item.kind == Kind.OPEN
            val isCall = previous.kind == Kind.IDENT && FUNCTIONS.containsKey(previous.text) &&
                item.kind == Kind.OPEN
            if (ends && starts && !isCall) expanded.add(Token(Kind.OPERATOR, op = '*'))
        }
        expanded.add(item)
    }
    return expanded
}

// --------------------------------------------------------------------------
// parser
// --------------------------------------------------------------------------

class Parser(private val tokens: List<Token>) {
    private var position = 0

    fun parse(): Double {
        val value = expression(0)
        if (position != tokens.size) throw ParseFailure("parse")
        return value
    }

    private fun has() = position < tokens.size

    private fun expression(minPrecedence: Int): Double {
        var left = primary()

        while (has() && tokens[position].kind == Kind.OPERATOR && tokens[position].op == '!') {
            position++
            left = factorial(left)
        }

        while (has() && tokens[position].kind == Kind.OPERATOR) {
            val op = tokens[position].op
            val precedence = PRECEDENCE[op] ?: break
            if (precedence < minPrecedence) break
            position++
            val right = expression(if (op == '^') precedence else precedence + 1)
            left = when (op) {
                '+' -> left + right
                '-' -> left - right
                '*' -> left * right
                '/' -> left / right
                '%' -> left % right
                '^' -> left.pow(right)
                else -> throw ParseFailure("parse")
            }
        }

        return left
    }

    private fun primary(): Double {
        if (!has()) throw ParseFailure("parse")
        val item = tokens[position]
        position++

        if (item.kind == Kind.NUMBER) return item.value

        if (item.kind == Kind.OPERATOR && (item.op == '-' || item.op == '+')) {
            val value = expression(3)
            return if (item.op == '-') -value else value
        }

        if (item.kind == Kind.OPEN) {
            val value = expression(0)
            if (!has() || tokens[position].kind != Kind.CLOSE) throw ParseFailure("parse")
            position++
            return value
        }

        if (item.kind == Kind.IDENT) {
            if (has() && tokens[position].kind == Kind.OPEN && FUNCTIONS.containsKey(item.text)) {
                position++
                val args = mutableListOf<Double>()
                if (has() && tokens[position].kind != Kind.CLOSE) {
                    args.add(expression(0))
                    while (has() && tokens[position].kind == Kind.COMMA) {
                        position++
                        args.add(expression(0))
                    }
                }
                if (!has() || tokens[position].kind != Kind.CLOSE) throw ParseFailure("parse")
                position++
                return callFunction(item.text, args)
            }
            if (item.text == "pi") return Math.PI
            if (item.text == "e") return Math.E
        }

        throw ParseFailure("parse")
    }

    private fun factorial(value: Double): Double {
        if (value < 0 || value != floor(value) || value > 170) throw ParseFailure("factorial domain")
        var result = 1.0
        var step = 2.0
        while (step <= value) { result *= step; step += 1 }
        return result
    }

    private fun callFunction(name: String, args: List<Double>): Double {
        val bounds = FUNCTIONS[name] ?: throw ParseFailure("unknown function")
        if (args.size < bounds.first || args.size > bounds.second) throw ParseFailure("argument count")
        val first = args[0]

        return when (name) {
            "sqrt" -> sqrt(first)
            "cbrt" -> cbrt(first)
            "abs" -> abs(first)
            "sin" -> sin(first)
            "cos" -> cos(first)
            "tan" -> tan(first)
            "asin" -> asin(first)
            "acos" -> acos(first)
            "atan" -> atan(first)
            "ln" -> ln(first)
            "log10" -> log10(first)
            "log2" -> ln(first) / ln(2.0)
            "exp" -> exp(first)
            "floor" -> floor(first)
            "ceil" -> ceil(first)
            "round" -> round(first)
            "log" -> if (args.size == 1) ln(first) else ln(first) / ln(args[1])
            "pow" -> first.pow(args[1])
            "min" -> args.minOrNull()!!
            "max" -> args.maxOrNull()!!
            "sum" -> args.sum()
            "mean" -> args.sum() / args.size
            "product" -> args.fold(1.0) { total, value -> total * value }
            else -> throw ParseFailure("unknown function")
        }
    }
}

fun evaluate(source: String): Double {
    val tokens = tokenize(source)
    if (tokens.isEmpty()) throw ParseFailure("parse")
    return Parser(tokens).parse()
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

data class Unit(val kind: String, val factor: Double)

val UNITS: Map<String, Unit> = buildMap {
    fun add(kind: String, pairs: List<Pair<String, Double>>) {
        for ((name, factor) in pairs) put(name, Unit(kind, factor))
    }
    add("length", listOf(
        "mm" to 0.001, "cm" to 0.01, "m" to 1.0, "metre" to 1.0, "metres" to 1.0,
        "meter" to 1.0, "meters" to 1.0, "km" to 1000.0, "in" to 0.0254, "inch" to 0.0254,
        "inches" to 0.0254, "ft" to 0.3048, "feet" to 0.3048, "foot" to 0.3048,
        "yd" to 0.9144, "mi" to 1609.344, "mile" to 1609.344, "miles" to 1609.344,
    ))
    add("mass", listOf(
        "mg" to 0.001, "g" to 1.0, "kg" to 1000.0, "oz" to 28.349523125,
        "lb" to 453.59237, "lbs" to 453.59237, "pound" to 453.59237, "pounds" to 453.59237,
        "stone" to 6350.29318, "st" to 6350.29318,
    ))
    add("volume", listOf(
        "ml" to 0.001, "l" to 1.0, "litre" to 1.0, "litres" to 1.0, "liter" to 1.0,
        "liters" to 1.0, "tsp" to 0.00492892159, "tbsp" to 0.0147867648,
        "cup" to 0.2365882365, "pint" to 0.473176473, "qt" to 0.946352946,
        "quart" to 0.946352946, "gal" to 3.785411784, "gallon" to 3.785411784,
        "gallons" to 3.785411784,
    ))
    add("data", listOf(
        "b" to 1.0, "kb" to 1e3, "mb" to 1e6, "gb" to 1e9, "tb" to 1e12,
        "kib" to 1024.0, "mib" to 1048576.0, "gib" to 1073741824.0,
    ))
    add("speed", listOf(
        "km/h" to 0.277777778, "kph" to 0.277777778, "mph" to 0.44704, "m/s" to 1.0,
    ))
    add("area", listOf(
        "m2" to 1.0, "km2" to 1e6, "ft2" to 0.09290304, "sqft" to 0.09290304,
        "acre" to 4046.8564224, "hectare" to 10000.0, "ha" to 10000.0,
    ))
}

fun temperature(value: Double, from: Char, to: Char): Double {
    val celsius = when (from) {
        'c' -> value
        'f' -> (value - 32) * 5 / 9
        else -> value - 273.15
    }
    return when (to) {
        'c' -> celsius
        'f' -> celsius * 9 / 5 + 32
        else -> celsius + 273.15
    }
}

// --------------------------------------------------------------------------
// intents
// --------------------------------------------------------------------------

fun normalize(text: String): String {
    val out = text.lowercase(Locale.ROOT)
        .replace("’", "'").replace("‘", "'")
        .replace("−", "-").replace("–", "-").replace("—", "-")
        .replace("²", "^2").replace("³", "^3")
    return out.trim().replace(Regex("\\s+"), " ")
}

fun splitWords(text: String): List<String> = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }

fun isNumberWord(word: String?): Boolean =
    word != null && Regex("^[+-]?[0-9]*\\.?[0-9]+([eE][+-]?[0-9]+)?$").matches(word)

fun splitNumber(word: String): Pair<Double, String>? {
    var index = 0
    if (index < word.length && (word[index] == '+' || word[index] == '-')) index++
    val digits = index
    while (index < word.length && word[index].isDigit()) index++
    if (index < word.length && word[index] == '.') {
        index++
        while (index < word.length && word[index].isDigit()) index++
    }
    if (index == digits) return null
    val value = word.substring(0, index).toDoubleOrNull() ?: return null
    return value to word.substring(index)
}

fun percentIntent(text: String): String? {
    val words = splitWords(text.replace("%", " percent "))

    for (index in 0 until words.size - 3) {
        if (words[index + 1] != "percent") continue
        if (words[index + 2] != "of" && words[index + 2] != "off") continue
        if (!isNumberWord(words[index]) || !isNumberWord(words[index + 3])) continue

        val percent = words[index].toDouble()
        val base = words[index + 3].toDouble()
        val part = percent / 100 * base

        if (words[index + 2] == "off") {
            return "**${formatNumber(base - part)}** after ${formatNumber(percent)}% off " +
                "${formatNumber(base)} (a discount of ${formatNumber(part)})."
        }
        return "**${formatNumber(part)}** — ${formatNumber(percent)}% of ${formatNumber(base)}.\n\n" +
            "${formatNumber(base)} × ${formatNumber(percent)} / 100 = ${formatNumber(part)}"
    }

    if (Regex("percent|increase|decrease|change").containsMatchIn(text)) {
        for (index in 0 until words.size - 3) {
            if (words[index] != "from" || words[index + 2] != "to") continue
            if (!isNumberWord(words[index + 1]) || !isNumberWord(words[index + 3])) continue

            val start = words[index + 1].toDouble()
            val end = words[index + 3].toDouble()
            if (start == 0.0) {
                return "Percentage change from zero is undefined because the calculation divides by " +
                    "the starting value. I will not report a finite percentage."
            }
            val change = (end - start) / abs(start) * 100
            return "**${formatNumber(change)}%** change from ${formatNumber(start)} to " +
                "${formatNumber(end)}.\n\nFormula: (${formatNumber(end)} − ${formatNumber(start)}) ÷ " +
                "|${formatNumber(start)}| × 100"
        }
    }

    return null
}

fun unitIntent(text: String): String? {
    val prepared = text
        .replace("°", " ")
        .replace("degrees", " ").replace("degree", " ")
        .replace("celsius", " c ").replace("centigrade", " c ")
        .replace("fahrenheit", " f ").replace("kelvin", " k ")
    val words = splitWords(prepared)

    for (index in words.indices) {
        val split = splitNumber(words[index]) ?: continue
        val value = split.first
        val remainder = split.second

        val source: String
        val cursor: Int
        if (remainder.isEmpty()) {
            if (index + 1 >= words.size) continue
            source = words[index + 1]
            cursor = index + 2
        } else {
            source = remainder
            cursor = index + 1
        }
        if (cursor + 1 >= words.size) continue
        if (words[cursor] !in listOf("to", "in", "into", "as")) continue
        val target = words[cursor + 1]

        if (source.length == 1 && target.length == 1 && "cfk".contains(source[0]) && "cfk".contains(target[0])) {
            val fromLabel = source.uppercase(Locale.ROOT)
            val toLabel = target.uppercase(Locale.ROOT)
            if (source == target) {
                return "${formatNumber(value)} °$fromLabel is the same in °$toLabel."
            }
            val converted = temperature(value, source[0], target[0])
            return "**${formatNumber(converted)} °$toLabel**\n\n`${formatNumber(value)} °$fromLabel → " +
                "${formatNumber(converted)} °$toLabel`"
        }

        val from = UNITS[source] ?: continue
        val to = UNITS[target] ?: continue
        if (from.kind != to.kind) continue

        val converted = value * from.factor / to.factor
        val note = if (from.kind == "data") {
            "Using decimal units (1 KB = 1,000 bytes)."
        } else {
            "Exact conversion factors."
        }
        return "**${formatNumber(converted)} $target**\n\n`${formatNumber(value)} $source = " +
            "${formatNumber(converted)} $target`\n\n$note"
    }

    return null
}

val PREFIXES = listOf(
    "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
    "solve ", "evaluate ", "how much is ",
)

data class Answer(val intent: String, val text: String)

fun mathIntent(text: String): Answer? {
    var candidate = text
    for (prefix in PREFIXES) {
        if (candidate.startsWith(prefix)) {
            candidate = candidate.substring(prefix.length)
            break
        }
    }
    candidate = candidate.trim().replace(Regex("[?=]+$"), "").trim()
    if (candidate.startsWith("the ")) candidate = candidate.substring(4)

    candidate = when {
        candidate.startsWith("square root of ") ->
            "sqrt(${candidate.substring("square root of ".length)})"
        candidate.startsWith("cube root of ") ->
            "cbrt(${candidate.substring("cube root of ".length)})"
        candidate.startsWith("factorial of ") ->
            "${candidate.substring("factorial of ".length)}!"
        candidate.endsWith(" squared") ->
            "(${candidate.dropLast(" squared".length)})^2"
        candidate.endsWith(" cubed") ->
            "(${candidate.dropLast(" cubed".length)})^3"
        else -> candidate
    }

    val padded = " $candidate "
        .replace(" to the power of ", "^")
        .replace(" divided by ", "/")
        .replace(" multiplied by ", "*")
        .replace(" times ", "*")
        .replace(" plus ", "+")
        .replace(" minus ", "-")
        .replace(" factorial", "!")
    candidate = padded.trim()

    if (candidate.isEmpty()) return null
    for (ch in candidate) {
        if (ch.isLetterOrDigit() || "+-*/^%(),!. ".contains(ch)) continue
        return null
    }

    val hasDigit = candidate.any { it.isDigit() }
    val hasConstant = candidate.split(Regex("[^a-zA-Z]+")).any { it == "pi" || it == "e" }
    if (!hasDigit && !hasConstant) return null

    val value = try {
        evaluate(candidate)
    } catch (error: ParseFailure) {
        return null
    }

    if (value.isNaN() || value.isInfinite()) {
        return Answer(
            "math-limit",
            "That expression does not produce a finite number (for example, division by zero, an " +
                "invalid function domain or numeric overflow), so I will not present it as a normal result.",
        )
    }

    val shown = formatNumber(value)
    val display = candidate.replace("*", "×")
    val trig = Regex("sin\\(|cos\\(|tan\\(|asin\\(|acos\\(|atan\\(").containsMatchIn(candidate)
    return Answer(
        "math",
        "**$shown**\n\nExpression: $display = $shown" +
            (if (trig) "\n\nTrigonometric functions use radians." else ""),
    )
}

val LIVE = listOf(
    "weather", "news", "stock price", "score", "who won", "latest",
    "headlines", "browse", "search the web",
)

fun answer(prompt: String): Answer {
    val text = prompt.trim()
    if (text.isEmpty()) {
        return Answer(
            "empty",
            "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, " +
                "so there is no network round trip.",
        )
    }

    val lowered = normalize(text)

    percentIntent(lowered)?.let { return Answer("percent", it) }
    unitIntent(lowered)?.let { return Answer("units", it) }
    mathIntent(lowered)?.let { return it }

    for (word in LIVE) {
        if (lowered.contains(word)) {
            return Answer(
                "live",
                "I cannot check live information — this engine has no network access, and it will " +
                    "not invent an answer.\n\nSwitch to a connected hosted model for current facts, " +
                    "or paste the source text here and I will help you reason about it.",
            )
        }
    }

    return Answer(
        "fallback",
        "I want to be straight with you: **this is a small on-device engine**, and that question is " +
            "outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n" +
            "- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, " +
            "code review or live information.",
    )
}

// --------------------------------------------------------------------------
// conformance runner
// --------------------------------------------------------------------------

fun runVectors(path: String): Int {
    val lines = java.io.File(path).readLines(Charsets.UTF_8)
    val failures = mutableListOf<String>()
    var checked = 0

    lines.forEachIndexed { offset, raw ->
        val number = offset + 1
        val line = raw.removeSuffix("\r")
        if (line.isBlank() || line.startsWith("#")) return@forEachIndexed

        val fields = line.split("\t")
        if (fields.size < 3) {
            failures.add("line $number: expected at least 3 columns")
            return@forEachIndexed
        }
        checked++

        if (fields[0] == "eval") {
            val value = try {
                evaluate(fields[1])
            } catch (error: ParseFailure) {
                failures.add("line $number: '${fields[1]}' -> error")
                return@forEachIndexed
            }
            val expected = fields[2].toDouble()
            val tolerance = 1e-9 * maxOf(1.0, abs(expected))
            if (abs(value - expected) > tolerance) {
                failures.add("line $number: '${fields[1]}' -> $value, wanted ${fields[2]}")
            }
            return@forEachIndexed
        }

        val result = answer(fields[1])
        if (result.intent != fields[2]) {
            failures.add("line $number: '${fields[1]}' -> intent ${result.intent}, wanted ${fields[2]}")
            return@forEachIndexed
        }
        val fragments = fields.getOrNull(3)?.split("|")?.filter { it.isNotEmpty() } ?: emptyList()
        for (fragment in fragments) {
            if (!result.text.contains(fragment)) {
                failures.add("line $number: '${fields[1]}' -> text missing '$fragment'")
                break
            }
        }
    }

    if (failures.isNotEmpty()) {
        failures.forEach { println("FAIL $it") }
        println("${failures.size} failure(s) out of $checked case(s)")
        return 1
    }
    println("ok: $checked cases")
    return 0
}

fun main(args: Array<String>) {
    val target = args.firstOrNull() ?: "../vectors.tsv"
    exitProcess(runVectors(target))
}
