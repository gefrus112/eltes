// ==========================================================================
// Eltes CAI engine — Go port (standard library only).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     go run main.go ../vectors.tsv
// ==========================================================================
package main

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode"
)

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

func formatNumber(value float64) string {
	if math.IsNaN(value) {
		return "NaN"
	}
	if math.IsInf(value, 1) {
		return "Infinity"
	}
	if math.IsInf(value, -1) {
		return "-Infinity"
	}

	magnitude := math.Abs(value)
	if magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8) {
		raw := strconv.FormatFloat(value, 'e', 10, 64)
		marker := strings.IndexByte(raw, 'e')
		if marker < 0 {
			return raw
		}
		mantissa := raw[:marker]
		exponent := raw[marker+1:]
		if strings.Contains(mantissa, ".") {
			mantissa = strings.TrimRight(mantissa, "0")
			mantissa = strings.TrimSuffix(mantissa, ".")
		}
		return mantissa + "e" + exponent
	}

	rounded := math.Round(value*1e10) / 1e10
	if rounded == 0 {
		return "0"
	}
	text := strconv.FormatFloat(rounded, 'f', 10, 64)
	text = strings.TrimRight(text, "0")
	text = strings.TrimSuffix(text, ".")
	if text == "" || text == "-" {
		return "0"
	}
	return text
}

// --------------------------------------------------------------------------
// tokenizer
// --------------------------------------------------------------------------

type kind int

const (
	numberKind kind = iota
	identKind
	operatorKind
	openKind
	closeKind
	commaKind
)

type token struct {
	kind  kind
	value float64
	text  string
	op    byte
}

var functions = map[string][2]int{
	"sqrt": {1, 1}, "cbrt": {1, 1}, "abs": {1, 1},
	"sin": {1, 1}, "cos": {1, 1}, "tan": {1, 1},
	"asin": {1, 1}, "acos": {1, 1}, "atan": {1, 1},
	"ln": {1, 1}, "log10": {1, 1}, "log2": {1, 1}, "exp": {1, 1},
	"floor": {1, 1}, "ceil": {1, 1}, "round": {1, 1},
	"log": {1, 2}, "pow": {2, 2},
	"min": {1, math.MaxInt32}, "max": {1, math.MaxInt32}, "sum": {1, math.MaxInt32},
	"mean": {1, math.MaxInt32}, "product": {1, math.MaxInt32},
}

func digitBefore(runes []rune, index int) bool {
	for cursor := index - 1; cursor >= 0; cursor-- {
		if unicode.IsSpace(runes[cursor]) {
			continue
		}
		return unicode.IsDigit(runes[cursor])
	}
	return false
}

func digitAfter(runes []rune, index int) bool {
	for cursor := index + 1; cursor < len(runes); cursor++ {
		if unicode.IsSpace(runes[cursor]) {
			continue
		}
		return unicode.IsDigit(runes[cursor])
	}
	return false
}

func prepare(source string) string {
	replacer := strings.NewReplacer(
		"×", "*", "✕", "*", "✖", "*",
		"÷", "/", "−", "-", "–", "-", "—", "-",
		"²", "^2", "³", "^3",
	)
	text := []rune(replacer.Replace(source))

	out := make([]rune, 0, len(text))
	for index, ch := range text {
		if (ch == 'x' || ch == 'X') && digitBefore(text, index) && digitAfter(text, index) {
			out = append(out, '*')
			continue
		}
		out = append(out, ch)
	}
	return string(out)
}

func tokenize(source string) ([]token, error) {
	text := prepare(source)
	runes := []rune(text)
	tokens := make([]token, 0, len(runes))

	for index := 0; index < len(runes); {
		ch := runes[index]

		if unicode.IsSpace(ch) {
			index++
			continue
		}

		if unicode.IsDigit(ch) || (ch == '.' && index+1 < len(runes) && unicode.IsDigit(runes[index+1])) {
			start := index
			for index < len(runes) && unicode.IsDigit(runes[index]) {
				index++
			}
			if index < len(runes) && runes[index] == '.' {
				index++
				for index < len(runes) && unicode.IsDigit(runes[index]) {
					index++
				}
			}
			if index < len(runes) && (runes[index] == 'e' || runes[index] == 'E') {
				probe := index + 1
				if probe < len(runes) && (runes[probe] == '+' || runes[probe] == '-') {
					probe++
				}
				if probe < len(runes) && unicode.IsDigit(runes[probe]) {
					for probe < len(runes) && unicode.IsDigit(runes[probe]) {
						probe++
					}
					index = probe
				}
			}
			literal := string(runes[start:index])
			value, err := strconv.ParseFloat(literal, 64)
			if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
				return nil, fmt.Errorf("bad number")
			}
			tokens = append(tokens, token{kind: numberKind, value: value})
			continue
		}

		if unicode.IsLetter(ch) {
			start := index
			for index < len(runes) && unicode.IsLetter(runes[index]) {
				index++
			}
			tokens = append(tokens, token{kind: identKind, text: strings.ToLower(string(runes[start:index]))})
			continue
		}

		if strings.ContainsRune("+-*/^%!", ch) {
			tokens = append(tokens, token{kind: operatorKind, op: byte(ch)})
			index++
			continue
		}
		switch ch {
		case '(':
			tokens = append(tokens, token{kind: openKind})
			index++
			continue
		case ')':
			tokens = append(tokens, token{kind: closeKind})
			index++
			continue
		case ',':
			tokens = append(tokens, token{kind: commaKind})
			index++
			continue
		}
		return nil, fmt.Errorf("unexpected character")
	}

	expanded := make([]token, 0, len(tokens)+4)
	for _, item := range tokens {
		if len(expanded) > 0 {
			previous := expanded[len(expanded)-1]
			ends := previous.kind == numberKind || previous.kind == closeKind ||
				(previous.kind == identKind && (previous.text == "pi" || previous.text == "e"))
			starts := item.kind == numberKind || item.kind == identKind || item.kind == openKind
			_, known := functions[previous.text]
			isCall := previous.kind == identKind && known && item.kind == openKind
			if ends && starts && !isCall {
				expanded = append(expanded, token{kind: operatorKind, op: '*'})
			}
		}
		expanded = append(expanded, item)
	}
	return expanded, nil
}

// --------------------------------------------------------------------------
// parser
// --------------------------------------------------------------------------

type parser struct {
	tokens   []token
	position int
}

func precedenceOf(op byte) int {
	switch op {
	case '+', '-':
		return 1
	case '*', '/', '%':
		return 2
	case '^':
		return 3
	}
	return 0
}

func (p *parser) has() bool {
	return p.position < len(p.tokens)
}

func (p *parser) expression(minPrecedence int) (float64, error) {
	left, err := p.primary()
	if err != nil {
		return 0, err
	}

	for p.has() && p.tokens[p.position].kind == operatorKind && p.tokens[p.position].op == '!' {
		p.position++
		left, err = factorial(left)
		if err != nil {
			return 0, err
		}
	}

	for p.has() && p.tokens[p.position].kind == operatorKind {
		op := p.tokens[p.position].op
		precedence := precedenceOf(op)
		if precedence == 0 || precedence < minPrecedence {
			break
		}
		p.position++
		next := precedence
		if op != '^' {
			next = precedence + 1
		}
		right, err := p.expression(next)
		if err != nil {
			return 0, err
		}
		switch op {
		case '+':
			left += right
		case '-':
			left -= right
		case '*':
			left *= right
		case '/':
			left /= right
		case '%':
			left = math.Mod(left, right)
		case '^':
			left = math.Pow(left, right)
		default:
			return 0, fmt.Errorf("parse")
		}
	}

	return left, nil
}

func (p *parser) primary() (float64, error) {
	if !p.has() {
		return 0, fmt.Errorf("parse")
	}
	item := p.tokens[p.position]
	p.position++

	switch item.kind {
	case numberKind:
		return item.value, nil
	case operatorKind:
		if item.op == '-' || item.op == '+' {
			value, err := p.expression(3)
			if err != nil {
				return 0, err
			}
			if item.op == '-' {
				return -value, nil
			}
			return value, nil
		}
	case openKind:
		value, err := p.expression(0)
		if err != nil {
			return 0, err
		}
		if !p.has() || p.tokens[p.position].kind != closeKind {
			return 0, fmt.Errorf("parse")
		}
		p.position++
		return value, nil
	case identKind:
		if p.has() && p.tokens[p.position].kind == openKind {
			if _, known := functions[item.text]; known {
				p.position++
				args := make([]float64, 0, 4)
				if p.has() && p.tokens[p.position].kind != closeKind {
					value, err := p.expression(0)
					if err != nil {
						return 0, err
					}
					args = append(args, value)
					for p.has() && p.tokens[p.position].kind == commaKind {
						p.position++
						value, err := p.expression(0)
						if err != nil {
							return 0, err
						}
						args = append(args, value)
					}
				}
				if !p.has() || p.tokens[p.position].kind != closeKind {
					return 0, fmt.Errorf("parse")
				}
				p.position++
				return callFunction(item.text, args)
			}
		}
		switch item.text {
		case "pi":
			return math.Pi, nil
		case "e":
			return math.E, nil
		}
	}

	return 0, fmt.Errorf("parse")
}

func factorial(value float64) (float64, error) {
	if value < 0 || value != math.Floor(value) || value > 170 {
		return 0, fmt.Errorf("factorial domain")
	}
	result := 1.0
	for step := 2.0; step <= value; step++ {
		result *= step
	}
	return result, nil
}

func callFunction(name string, args []float64) (float64, error) {
	bounds, known := functions[name]
	if !known {
		return 0, fmt.Errorf("unknown function")
	}
	if len(args) < bounds[0] || len(args) > bounds[1] {
		return 0, fmt.Errorf("argument count")
	}

	switch name {
	case "sqrt":
		return math.Sqrt(args[0]), nil
	case "cbrt":
		return math.Cbrt(args[0]), nil
	case "abs":
		return math.Abs(args[0]), nil
	case "sin":
		return math.Sin(args[0]), nil
	case "cos":
		return math.Cos(args[0]), nil
	case "tan":
		return math.Tan(args[0]), nil
	case "asin":
		return math.Asin(args[0]), nil
	case "acos":
		return math.Acos(args[0]), nil
	case "atan":
		return math.Atan(args[0]), nil
	case "ln":
		return math.Log(args[0]), nil
	case "log10":
		return math.Log10(args[0]), nil
	case "log2":
		return math.Log2(args[0]), nil
	case "exp":
		return math.Exp(args[0]), nil
	case "floor":
		return math.Floor(args[0]), nil
	case "ceil":
		return math.Ceil(args[0]), nil
	case "round":
		return math.Round(args[0]), nil
	case "log":
		if len(args) == 1 {
			return math.Log(args[0]), nil
		}
		return math.Log(args[0]) / math.Log(args[1]), nil
	case "pow":
		return math.Pow(args[0], args[1]), nil
	case "min":
		total := args[0]
		for _, value := range args[1:] {
			total = math.Min(total, value)
		}
		return total, nil
	case "max":
		total := args[0]
		for _, value := range args[1:] {
			total = math.Max(total, value)
		}
		return total, nil
	case "sum":
		total := 0.0
		for _, value := range args {
			total += value
		}
		return total, nil
	case "mean":
		total := 0.0
		for _, value := range args {
			total += value
		}
		return total / float64(len(args)), nil
	case "product":
		total := 1.0
		for _, value := range args {
			total *= value
		}
		return total, nil
	}
	return 0, fmt.Errorf("unknown function")
}

func evaluate(source string) (float64, error) {
	tokens, err := tokenize(source)
	if err != nil {
		return 0, err
	}
	if len(tokens) == 0 {
		return 0, fmt.Errorf("parse")
	}
	p := parser{tokens: tokens}
	value, err := p.expression(0)
	if err != nil {
		return 0, err
	}
	if p.position != len(p.tokens) {
		return 0, fmt.Errorf("parse")
	}
	return value, nil
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

type unit struct {
	kind   string
	factor float64
}

var units = map[string]unit{
	"mm": {"length", 0.001}, "cm": {"length", 0.01}, "m": {"length", 1},
	"metre": {"length", 1}, "metres": {"length", 1}, "meter": {"length", 1},
	"meters": {"length", 1}, "km": {"length", 1000}, "in": {"length", 0.0254},
	"inch": {"length", 0.0254}, "inches": {"length", 0.0254}, "ft": {"length", 0.3048},
	"feet": {"length", 0.3048}, "foot": {"length", 0.3048}, "yd": {"length", 0.9144},
	"mi": {"length", 1609.344}, "mile": {"length", 1609.344}, "miles": {"length", 1609.344},
	"mg": {"mass", 0.001}, "g": {"mass", 1}, "kg": {"mass", 1000},
	"oz": {"mass", 28.349523125}, "lb": {"mass", 453.59237}, "lbs": {"mass", 453.59237},
	"pound": {"mass", 453.59237}, "pounds": {"mass", 453.59237},
	"stone": {"mass", 6350.29318}, "st": {"mass", 6350.29318},
	"ml": {"volume", 0.001}, "l": {"volume", 1}, "litre": {"volume", 1},
	"litres": {"volume", 1}, "liter": {"volume", 1}, "liters": {"volume", 1},
	"tsp": {"volume", 0.00492892159}, "tbsp": {"volume", 0.0147867648},
	"cup": {"volume", 0.2365882365}, "pint": {"volume", 0.473176473},
	"qt": {"volume", 0.946352946}, "quart": {"volume", 0.946352946},
	"gal": {"volume", 3.785411784}, "gallon": {"volume", 3.785411784},
	"gallons": {"volume", 3.785411784},
	"b": {"data", 1}, "kb": {"data", 1e3}, "mb": {"data", 1e6}, "gb": {"data", 1e9},
	"tb": {"data", 1e12}, "kib": {"data", 1024}, "mib": {"data", 1048576},
	"gib": {"data", 1073741824},
	"km/h": {"speed", 0.277777778}, "kph": {"speed", 0.277777778},
	"mph": {"speed", 0.44704}, "m/s": {"speed", 1},
	"m2": {"area", 1}, "km2": {"area", 1e6}, "ft2": {"area", 0.09290304},
	"sqft": {"area", 0.09290304}, "acre": {"area", 4046.8564224},
	"hectare": {"area", 10000}, "ha": {"area", 10000},
}

func temperature(value float64, from, to string) float64 {
	var celsius float64
	switch from {
	case "c":
		celsius = value
	case "f":
		celsius = (value - 32) * 5 / 9
	default:
		celsius = value - 273.15
	}
	switch to {
	case "c":
		return celsius
	case "f":
		return celsius*9/5 + 32
	}
	return celsius + 273.15
}

// --------------------------------------------------------------------------
// intents
// --------------------------------------------------------------------------

func normalize(text string) string {
	out := strings.ToLower(text)
	out = strings.NewReplacer("’", "'", "‘", "'", "−", "-", "–", "-", "—", "-", "²", "^2", "³", "^3").Replace(out)
	return strings.Join(strings.Fields(out), " ")
}

func isNumber(word string) bool {
	if word == "" || strings.ContainsAny(word, "NnIi") {
		return false
	}
	_, err := strconv.ParseFloat(word, 64)
	return err == nil
}

func splitNumber(word string) (float64, string, bool) {
	index := 0
	if index < len(word) && (word[index] == '+' || word[index] == '-') {
		index++
	}
	digits := index
	for index < len(word) && word[index] >= '0' && word[index] <= '9' {
		index++
	}
	if index < len(word) && word[index] == '.' {
		index++
		for index < len(word) && word[index] >= '0' && word[index] <= '9' {
			index++
		}
	}
	if index == digits {
		return 0, "", false
	}
	value, err := strconv.ParseFloat(word[:index], 64)
	if err != nil {
		return 0, "", false
	}
	return value, word[index:], true
}

func percentIntent(text string) (string, bool) {
	words := strings.Fields(strings.ReplaceAll(text, "%", " percent "))

	for index := 0; index+3 < len(words); index++ {
		if words[index+1] != "percent" {
			continue
		}
		if words[index+2] != "of" && words[index+2] != "off" {
			continue
		}
		if !isNumber(words[index]) || !isNumber(words[index+3]) {
			continue
		}
		percent, _ := strconv.ParseFloat(words[index], 64)
		base, _ := strconv.ParseFloat(words[index+3], 64)
		part := percent / 100 * base

		if words[index+2] == "off" {
			return "**" + formatNumber(base-part) + "** after " + formatNumber(percent) +
				"% off " + formatNumber(base) + " (a discount of " + formatNumber(part) + ").", true
		}
		return "**" + formatNumber(part) + "** — " + formatNumber(percent) + "% of " +
			formatNumber(base) + ".\n\n" + formatNumber(base) + " × " + formatNumber(percent) +
			" / 100 = " + formatNumber(part), true
	}

	if strings.Contains(text, "percent") || strings.Contains(text, "increase") ||
		strings.Contains(text, "decrease") || strings.Contains(text, "change") {
		for index := 0; index+3 < len(words); index++ {
			if words[index] != "from" || words[index+2] != "to" {
				continue
			}
			if !isNumber(words[index+1]) || !isNumber(words[index+3]) {
				continue
			}
			start, _ := strconv.ParseFloat(words[index+1], 64)
			end, _ := strconv.ParseFloat(words[index+3], 64)
			if start == 0 {
				return "Percentage change from zero is undefined because the calculation divides by " +
					"the starting value. I will not report a finite percentage.", true
			}
			change := (end - start) / math.Abs(start) * 100
			return "**" + formatNumber(change) + "%** change from " + formatNumber(start) +
				" to " + formatNumber(end) + ".\n\nFormula: (" + formatNumber(end) + " − " +
				formatNumber(start) + ") ÷ |" + formatNumber(start) + "| × 100", true
		}
	}

	return "", false
}

func unitIntent(text string) (string, bool) {
	replacer := strings.NewReplacer(
		"°", " ", "degrees", " ", "degree", " ",
		"celsius", " c ", "centigrade", " c ", "fahrenheit", " f ", "kelvin", " k ",
	)
	words := strings.Fields(replacer.Replace(text))

	for index := 0; index < len(words); index++ {
		value, remainder, ok := splitNumber(words[index])
		if !ok {
			continue
		}

		var source string
		var cursor int
		if remainder == "" {
			if index+1 >= len(words) {
				continue
			}
			source = words[index+1]
			cursor = index + 2
		} else {
			source = remainder
			cursor = index + 1
		}
		if cursor+1 >= len(words) {
			continue
		}
		connector := words[cursor]
		if connector != "to" && connector != "in" && connector != "into" && connector != "as" {
			continue
		}
		target := words[cursor+1]

		if len(source) == 1 && len(target) == 1 &&
			strings.ContainsRune("cfk", rune(source[0])) && strings.ContainsRune("cfk", rune(target[0])) {
			fromLabel := strings.ToUpper(source)
			toLabel := strings.ToUpper(target)
			if source == target {
				return formatNumber(value) + " °" + fromLabel + " is the same in °" + toLabel + ".", true
			}
			converted := temperature(value, source, target)
			return "**" + formatNumber(converted) + " °" + toLabel + "**\n\n`" +
				formatNumber(value) + " °" + fromLabel + " → " + formatNumber(converted) +
				" °" + toLabel + "`", true
		}

		from, fromKnown := units[source]
		to, toKnown := units[target]
		if !fromKnown || !toKnown || from.kind != to.kind {
			continue
		}

		converted := value * from.factor / to.factor
		note := "Exact conversion factors."
		if from.kind == "data" {
			note = "Using decimal units (1 KB = 1,000 bytes)."
		}
		return "**" + formatNumber(converted) + " " + target + "**\n\n`" +
			formatNumber(value) + " " + source + " = " + formatNumber(converted) + " " + target +
			"`\n\n" + note, true
	}

	return "", false
}

var prefixes = []string{
	"what's ", "what is ", "what is the value of ", "calculate ", "compute ",
	"solve ", "evaluate ", "how much is ",
}

func mathIntent(text string) (string, string, bool) {
	candidate := text
	for _, prefix := range prefixes {
		if strings.HasPrefix(candidate, prefix) {
			candidate = candidate[len(prefix):]
			break
		}
	}
	candidate = strings.TrimSpace(candidate)
	candidate = strings.TrimRight(candidate, "?=")
	candidate = strings.TrimSpace(candidate)

	candidate = strings.TrimPrefix(candidate, "the ")

	if strings.HasPrefix(candidate, "square root of ") {
		candidate = "sqrt(" + candidate[len("square root of "):] + ")"
	} else if strings.HasPrefix(candidate, "cube root of ") {
		candidate = "cbrt(" + candidate[len("cube root of "):] + ")"
	} else if strings.HasPrefix(candidate, "factorial of ") {
		candidate = candidate[len("factorial of "):] + "!"
	} else if strings.HasSuffix(candidate, " squared") {
		candidate = "(" + candidate[:len(candidate)-len(" squared")] + ")^2"
	} else if strings.HasSuffix(candidate, " cubed") {
		candidate = "(" + candidate[:len(candidate)-len(" cubed")] + ")^3"
	}

	padded := " " + candidate + " "
	padded = strings.ReplaceAll(padded, " to the power of ", "^")
	padded = strings.ReplaceAll(padded, " divided by ", "/")
	padded = strings.ReplaceAll(padded, " multiplied by ", "*")
	padded = strings.ReplaceAll(padded, " times ", "*")
	padded = strings.ReplaceAll(padded, " plus ", "+")
	padded = strings.ReplaceAll(padded, " minus ", "-")
	padded = strings.ReplaceAll(padded, " factorial", "!")
	candidate = strings.TrimSpace(padded)

	if candidate == "" {
		return "", "", false
	}
	for _, ch := range candidate {
		if unicode.IsDigit(ch) || unicode.IsLetter(ch) || strings.ContainsRune("+-*/^%(),!. ", ch) {
			continue
		}
		return "", "", false
	}

	hasDigit := strings.ContainsAny(candidate, "0123456789")
	hasConstant := false
	for _, word := range strings.FieldsFunc(candidate, func(r rune) bool { return !unicode.IsLetter(r) }) {
		if word == "pi" || word == "e" {
			hasConstant = true
		}
	}
	if !hasDigit && !hasConstant {
		return "", "", false
	}

	value, err := evaluate(candidate)
	if err != nil {
		return "", "", false
	}

	if math.IsNaN(value) || math.IsInf(value, 0) {
		return "math-limit", "That expression does not produce a finite number (for example, division " +
			"by zero, an invalid function domain or numeric overflow), so I will not present it as " +
			"a normal result.", true
	}

	shown := formatNumber(value)
	display := strings.ReplaceAll(candidate, "*", "×")
	trig := strings.Contains(candidate, "sin(") || strings.Contains(candidate, "cos(") ||
		strings.Contains(candidate, "tan(") || strings.Contains(candidate, "asin(") ||
		strings.Contains(candidate, "acos(") || strings.Contains(candidate, "atan(")
	note := ""
	if trig {
		note = "\n\nTrigonometric functions use radians."
	}
	return "math", "**" + shown + "**\n\nExpression: " + display + " = " + shown + note, true
}

var liveWords = []string{
	"weather", "news", "stock price", "score", "who won", "latest",
	"headlines", "browse", "search the web",
}

func answer(prompt string) (string, string) {
	text := strings.TrimSpace(prompt)
	if text == "" {
		return "empty", "Ask me for arithmetic, percentages or a unit conversion. I answer on this " +
			"device, so there is no network round trip."
	}

	lowered := normalize(text)

	if value, ok := percentIntent(lowered); ok {
		return "percent", value
	}
	if value, ok := unitIntent(lowered); ok {
		return "units", value
	}
	if intent, value, ok := mathIntent(lowered); ok {
		return intent, value
	}

	for _, word := range liveWords {
		if strings.Contains(lowered, word) {
			return "live", "I cannot check live information — this engine has no network access, and " +
				"it will not invent an answer.\n\nSwitch to a connected hosted model for current " +
				"facts, or paste the source text here and I will help you reason about it."
		}
	}

	return "fallback", "I want to be straight with you: **this is a small on-device engine**, and " +
		"that question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic " +
		"and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for " +
		"open-ended writing, code review or live information."
}

// --------------------------------------------------------------------------
// conformance runner
// --------------------------------------------------------------------------

func runVectors(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cannot read %s\n", path)
		return 1
	}

	failures := make([]string, 0)
	checked := 0

	for offset, line := range strings.Split(string(data), "\n") {
		number := offset + 1
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Split(line, "\t")
		if len(fields) < 3 {
			failures = append(failures, fmt.Sprintf("line %d: expected at least 3 columns", number))
			continue
		}
		checked++

		if fields[0] == "eval" {
			value, err := evaluate(fields[1])
			if err != nil {
				failures = append(failures, fmt.Sprintf("line %d: '%s' -> error", number, fields[1]))
				continue
			}
			expected, err := strconv.ParseFloat(fields[2], 64)
			if err != nil {
				failures = append(failures, fmt.Sprintf("line %d: bad expectation '%s'", number, fields[2]))
				continue
			}
			tolerance := 1e-9 * math.Max(1, math.Abs(expected))
			if math.Abs(value-expected) > tolerance {
				failures = append(failures, fmt.Sprintf("line %d: '%s' -> %s, wanted %s",
					number, fields[1], formatNumber(value), fields[2]))
			}
			continue
		}

		intent, text := answer(fields[1])
		if intent != fields[2] {
			failures = append(failures, fmt.Sprintf("line %d: '%s' -> intent %s, wanted %s",
				number, fields[1], intent, fields[2]))
			continue
		}
		if len(fields) > 3 && fields[3] != "" {
			for _, fragment := range strings.Split(fields[3], "|") {
				if !strings.Contains(text, fragment) {
					failures = append(failures, fmt.Sprintf("line %d: '%s' -> text missing '%s'",
						number, fields[1], fragment))
					break
				}
			}
		}
	}

	if len(failures) > 0 {
		for _, failure := range failures {
			fmt.Println("FAIL " + failure)
		}
		fmt.Printf("%d failure(s) out of %d case(s)\n", len(failures), checked)
		return 1
	}
	fmt.Printf("ok: %d cases\n", checked)
	return 0
}

func main() {
	target := "../vectors.tsv"
	if len(os.Args) > 1 {
		target = os.Args[1]
	}
	os.Exit(runVectors(target))
}
