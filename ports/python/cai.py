#!/usr/bin/env python3
"""Eltes CAI engine — Python port.

A deterministic answer engine: arithmetic, percentages, unit and temperature
conversion, with an explicit refusal for anything outside those rules. No
network, no model weights, no dependencies beyond the standard library.

Run the shared conformance suite:

    python3 ports/python/cai.py ports/vectors.tsv
"""

from __future__ import annotations

import math
import os
import sys

# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

FUNCTIONS = {
    "sqrt": (1, 1), "cbrt": (1, 1), "abs": (1, 1),
    "sin": (1, 1), "cos": (1, 1), "tan": (1, 1),
    "asin": (1, 1), "acos": (1, 1), "atan": (1, 1),
    "ln": (1, 1), "log10": (1, 1), "log2": (1, 1), "exp": (1, 1),
    "floor": (1, 1), "ceil": (1, 1), "round": (1, 1),
    "log": (1, 2), "pow": (2, 2),
    "min": (1, None), "max": (1, None), "sum": (1, None),
    "mean": (1, None), "product": (1, None),
}


class ParseError(Exception):
    pass


def prepare(source: str) -> str:
    out = []
    for ch in source:
        if ch in "\u00d7\u2715\u2716":
            out.append("*")
        elif ch == "\u00f7":
            out.append("/")
        elif ch in "\u2212\u2013\u2014":
            out.append("-")
        elif ch == "\u00b2":
            out.append("^2")
        elif ch == "\u00b3":
            out.append("^3")
        else:
            out.append(ch)

    chars = list("".join(out))
    result = []
    for index, ch in enumerate(chars):
        if ch in "xX" and _digit_before(chars, index) and _digit_after(chars, index):
            result.append("*")
        else:
            result.append(ch)
    return "".join(result)


def _digit_before(chars, index):
    cursor = index - 1
    while cursor >= 0:
        if chars[cursor].isspace():
            cursor -= 1
            continue
        return chars[cursor].isdigit()
    return False


def _digit_after(chars, index):
    cursor = index + 1
    while cursor < len(chars):
        if chars[cursor].isspace():
            cursor += 1
            continue
        return chars[cursor].isdigit()
    return False


def tokenize(source: str):
    text = prepare(source)
    tokens = []
    index = 0
    while index < len(text):
        ch = text[index]
        if ch.isspace():
            index += 1
            continue

        if ch.isdigit() or (ch == "." and index + 1 < len(text) and text[index + 1].isdigit()):
            start = index
            while index < len(text) and text[index].isdigit():
                index += 1
            if index < len(text) and text[index] == ".":
                index += 1
                while index < len(text) and text[index].isdigit():
                    index += 1
            if index < len(text) and text[index] in "eE":
                probe = index + 1
                if probe < len(text) and text[probe] in "+-":
                    probe += 1
                if probe < len(text) and text[probe].isdigit():
                    while probe < len(text) and text[probe].isdigit():
                        probe += 1
                    index = probe
            try:
                value = float(text[start:index])
            except ValueError as error:
                raise ParseError("bad number") from error
            if not math.isfinite(value):
                raise ParseError("bad number")
            tokens.append(("num", value))
            continue

        if ch.isalpha() and ch.isascii():
            start = index
            while index < len(text) and text[index].isalpha() and text[index].isascii():
                index += 1
            tokens.append(("ident", text[start:index].lower()))
            continue

        if ch in "+-*/^%!":
            tokens.append(("op", ch))
            index += 1
            continue
        if ch == "(":
            tokens.append(("(", ch))
            index += 1
            continue
        if ch == ")":
            tokens.append((")", ch))
            index += 1
            continue
        if ch == ",":
            tokens.append((",", ch))
            index += 1
            continue
        raise ParseError("unexpected character")

    expanded = []
    for token in tokens:
        if expanded:
            previous = expanded[-1]
            ends = previous[0] == "num" or previous[0] == ")" or (
                previous[0] == "ident" and previous[1] in ("pi", "e")
            )
            starts = token[0] in ("num", "ident", "(")
            is_call = previous[0] == "ident" and previous[1] in FUNCTIONS and token[0] == "("
            if ends and starts and not is_call:
                expanded.append(("op", "*"))
        expanded.append(token)
    return expanded


# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

PRECEDENCE = {"+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3}


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def take(self):
        token = self.peek()
        if token is None:
            raise ParseError("parse")
        self.pos += 1
        return token

    def expect(self, kind):
        token = self.peek()
        if token is None or token[0] != kind:
            raise ParseError("parse")
        self.pos += 1

    def expression(self, min_precedence=0):
        left = self.primary()

        while True:
            token = self.peek()
            if token is not None and token[0] == "op" and token[1] == "!":
                self.pos += 1
                left = self.factorial(left)
                continue
            break

        while True:
            token = self.peek()
            if token is None or token[0] != "op" or token[1] not in PRECEDENCE:
                break
            precedence = PRECEDENCE[token[1]]
            if precedence < min_precedence:
                break
            self.pos += 1
            op = token[1]
            right = self.expression(precedence if op == "^" else precedence + 1)
            if op == "+":
                left += right
            elif op == "-":
                left -= right
            elif op == "*":
                left *= right
            elif op == "/":
                left /= right
            elif op == "%":
                if right == 0:
                    left = math.nan
                else:
                    left = math.fmod(left, right)
            else:
                left = left ** right

        return left

    def factorial(self, value):
        if value < 0 or value != int(value) or value > 170:
            raise ParseError("factorial domain")
        result = 1.0
        step = 2.0
        while step <= value:
            result *= step
            step += 1.0
        return result

    def primary(self):
        kind, value = self.take()

        if kind == "num":
            return value
        if kind == "op" and value in "+-":
            operand = self.expression(3)
            return -operand if value == "-" else operand
        if kind == "(":
            result = self.expression(0)
            self.expect(")")
            return result
        if kind == "ident":
            if self.peek() is not None and self.peek()[0] == "(" and value in FUNCTIONS:
                self.expect("(")
                args = []
                if self.peek() is not None and self.peek()[0] != ")":
                    args.append(self.expression(0))
                    while self.peek() is not None and self.peek()[0] == ",":
                        self.pos += 1
                        args.append(self.expression(0))
                self.expect(")")
                return self.call(value, args)
            if value == "pi":
                return math.pi
            if value == "e":
                return math.e
        raise ParseError("parse")

    @staticmethod
    def call(name, args):
        low, high = FUNCTIONS[name]
        if len(args) < low or (high is not None and len(args) > high):
            raise ParseError("argument count")
        if name == "sqrt":
            return math.sqrt(args[0])
        if name == "cbrt":
            return math.copysign(abs(args[0]) ** (1 / 3), args[0])
        if name == "abs":
            return abs(args[0])
        if name == "sin":
            return math.sin(args[0])
        if name == "cos":
            return math.cos(args[0])
        if name == "tan":
            return math.tan(args[0])
        if name == "asin":
            return math.asin(args[0])
        if name == "acos":
            return math.acos(args[0])
        if name == "atan":
            return math.atan(args[0])
        if name == "ln":
            return math.log(args[0]) if args[0] > 0 else math.nan
        if name == "log":
            if len(args) == 1:
                return math.log(args[0]) if args[0] > 0 else math.nan
            if args[0] <= 0 or args[1] <= 0:
                return math.nan
            return math.log(args[0]) / math.log(args[1])
        if name == "log10":
            return math.log10(args[0]) if args[0] > 0 else math.nan
        if name == "log2":
            return math.log2(args[0]) if args[0] > 0 else math.nan
        if name == "exp":
            try:
                return math.exp(args[0])
            except OverflowError:
                return math.inf
        if name == "floor":
            return float(math.floor(args[0]))
        if name == "ceil":
            return float(math.ceil(args[0]))
        if name == "round":
            return float(round(args[0]))
        if name == "pow":
            try:
                return args[0] ** args[1]
            except (OverflowError, ValueError):
                return math.nan
        if name == "min":
            return min(args)
        if name == "max":
            return max(args)
        if name == "sum":
            return sum(args)
        if name == "mean":
            return sum(args) / len(args)
        if name == "product":
            product = 1.0
            for value in args:
                product *= value
            return product
        raise ParseError("unknown function")


def evaluate(source: str) -> float:
    tokens = tokenize(source)
    if not tokens:
        raise ParseError("parse")
    parser = Parser(tokens)
    value = parser.expression(0)
    if parser.pos != len(tokens):
        raise ParseError("parse")
    return value


# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------

def format_number(value: float) -> str:
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"

    magnitude = abs(value)
    if magnitude >= 1e12 or (0 < magnitude < 1e-8):
        mantissa, exponent = f"{value:.10e}".split("e")
        if "." in mantissa:
            mantissa = mantissa.rstrip("0").rstrip(".")
        sign = "-" if int(exponent) < 0 else "+"
        return f"{mantissa}e{sign}{abs(int(exponent))}"

    rounded = round(value * 1e10) / 1e10
    if rounded == 0:
        return "0"
    text = f"{rounded:.10f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

UNITS = {
    "mm": ("length", 0.001), "cm": ("length", 0.01), "m": ("length", 1.0),
    "metre": ("length", 1.0), "metres": ("length", 1.0), "meter": ("length", 1.0),
    "meters": ("length", 1.0), "km": ("length", 1000.0), "in": ("length", 0.0254),
    "inch": ("length", 0.0254), "inches": ("length", 0.0254), "ft": ("length", 0.3048),
    "feet": ("length", 0.3048), "foot": ("length", 0.3048), "yd": ("length", 0.9144),
    "mi": ("length", 1609.344), "mile": ("length", 1609.344), "miles": ("length", 1609.344),
    "mg": ("mass", 0.001), "g": ("mass", 1.0), "kg": ("mass", 1000.0),
    "oz": ("mass", 28.349523125), "lb": ("mass", 453.59237), "lbs": ("mass", 453.59237),
    "pound": ("mass", 453.59237), "pounds": ("mass", 453.59237),
    "stone": ("mass", 6350.29318), "st": ("mass", 6350.29318),
    "ml": ("volume", 0.001), "l": ("volume", 1.0), "litre": ("volume", 1.0),
    "litres": ("volume", 1.0), "liter": ("volume", 1.0), "liters": ("volume", 1.0),
    "tsp": ("volume", 0.00492892159), "tbsp": ("volume", 0.0147867648),
    "cup": ("volume", 0.2365882365), "pint": ("volume", 0.473176473),
    "qt": ("volume", 0.946352946), "quart": ("volume", 0.946352946),
    "gal": ("volume", 3.785411784), "gallon": ("volume", 3.785411784),
    "gallons": ("volume", 3.785411784),
    "b": ("data", 1.0), "kb": ("data", 1e3), "mb": ("data", 1e6), "gb": ("data", 1e9),
    "tb": ("data", 1e12), "kib": ("data", 1024.0), "mib": ("data", 1048576.0),
    "gib": ("data", 1073741824.0),
    "km/h": ("speed", 0.277777778), "kph": ("speed", 0.277777778),
    "mph": ("speed", 0.44704), "m/s": ("speed", 1.0),
    "m2": ("area", 1.0), "km2": ("area", 1e6), "ft2": ("area", 0.09290304),
    "sqft": ("area", 0.09290304), "acre": ("area", 4046.8564224),
    "hectare": ("area", 10000.0), "ha": ("area", 10000.0),
}


def convert(value, source, target):
    if source not in UNITS or target not in UNITS:
        return None
    kind, factor = UNITS[source]
    target_kind, target_factor = UNITS[target]
    if kind != target_kind:
        return None
    return kind, value * factor / target_factor


def temperature(value, source, target):
    if source == "c":
        celsius = value
    elif source == "f":
        celsius = (value - 32) * 5 / 9
    else:
        celsius = value - 273.15
    if target == "c":
        return celsius
    if target == "f":
        return celsius * 9 / 5 + 32
    return celsius + 273.15


# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

def normalize(text: str) -> str:
    text = text.lower()
    for char in "\u2019\u2018":
        text = text.replace(char, "'")
    for char in "\u2212\u2013\u2014":
        text = text.replace(char, "-")
    text = text.replace("\u00b2", "^2").replace("\u00b3", "^3")
    return " ".join(text.split())


def answer(prompt: str):
    text = prompt.strip()
    if not text:
        return "empty", (
            "Ask me for arithmetic, percentages or a unit conversion. I answer "
            "on this device, so there is no network round trip."
        )

    lowered = normalize(text)

    result = percent_intent(lowered)
    if result:
        return "percent", result

    result = unit_intent(lowered)
    if result:
        return "units", result

    result = math_intent(lowered)
    if result:
        return result

    if any(word in lowered for word in (
        "weather", "news", "stock price", "score", "who won",
        "latest", "headlines", "browse", "search the web",
    )):
        return "live", (
            "I cannot check live information \u2014 this engine has no network "
            "access, and it will not invent an answer.\n\nSwitch to a connected "
            "hosted model for current facts, or paste the source text here and I "
            "will help you reason about it."
        )

    return "fallback", (
        "I want to be straight with you: **this is a small on-device engine**, and "
        "that question is outside what it can answer reliably.\n\nIt is solid on:"
        "\n\n- arithmetic and percentages\n- unit and temperature conversions"
        "\n\nSwitch to a hosted model for open-ended writing, code review or live "
        "information."
    )


def percent_intent(text: str):
    words = text.replace("%", " percent ").split()

    for index in range(0, max(0, len(words) - 3)):
        if words[index + 1] != "percent" or words[index + 2] not in ("of", "off"):
            continue
        try:
            percent = float(words[index])
            base = float(words[index + 3])
        except ValueError:
            continue
        part = percent / 100 * base
        if words[index + 2] == "off":
            return (
                f"**{format_number(base - part)}** after {format_number(percent)}% off "
                f"{format_number(base)} (a discount of {format_number(part)})."
            )
        return (
            f"**{format_number(part)}** \u2014 {format_number(percent)}% of "
            f"{format_number(base)}.\n\n{format_number(base)} × "
            f"{format_number(percent)} / 100 = {format_number(part)}"
        )

    if any(word in text for word in ("percent", "increase", "decrease", "change")):
        for index in range(0, max(0, len(words) - 3)):
            if words[index] != "from" or words[index + 2] != "to":
                continue
            try:
                start = float(words[index + 1])
                end = float(words[index + 3])
            except ValueError:
                continue
            if start == 0:
                return (
                    "Percentage change from zero is undefined because the "
                    "calculation divides by the starting value. I will not report "
                    "a finite percentage."
                )
            change = (end - start) / abs(start) * 100
            return (
                f"**{format_number(change)}%** change from {format_number(start)} to "
                f"{format_number(end)}.\n\nFormula: ({format_number(end)} \u2212 "
                f"{format_number(start)}) ÷ |{format_number(start)}| × 100"
            )

    return None


def split_number(word: str):
    end = 0
    while end < len(word) and (word[end].isdigit() or word[end] in ".-+"):
        end += 1
    if end == 0:
        return None
    try:
        return float(word[:end]), word[end:]
    except ValueError:
        return None


def unit_intent(text: str):
    prepared = text.replace("°", " ")
    prepared = prepared.replace("degrees", " ").replace("degree", " ")
    prepared = prepared.replace("celsius", " c ").replace("centigrade", " c ")
    prepared = prepared.replace("fahrenheit", " f ").replace("kelvin", " k ")
    words = prepared.split()

    for index in range(len(words)):
        split = split_number(words[index])
        if split is None:
            continue
        value, remainder = split
        if remainder.strip() == "":
            if index + 1 >= len(words):
                continue
            source = words[index + 1]
            cursor = index + 2
        else:
            source = remainder
            cursor = index + 1
        if cursor + 1 >= len(words):
            continue
        if words[cursor] not in ("to", "in", "into", "as"):
            continue
        target = words[cursor + 1]

        if len(source) == 1 and len(target) == 1 and source in "cfk" and target in "cfk":
            if source == target:
                return (
                    f"{format_number(value)} °{source.upper()} is the same in "
                    f"°{target.upper()}."
                )
            converted = temperature(value, source, target)
            return (
                f"**{format_number(converted)} °{target.upper()}**\n\n"
                f"`{format_number(value)} °{source.upper()} → "
                f"{format_number(converted)} °{target.upper()}`"
            )

        conversion = convert(value, source, target)
        if conversion is None:
            continue
        kind, converted = conversion
        shown = format_number(converted)
        note = (
            "Using decimal units (1 KB = 1,000 bytes)."
            if kind == "data"
            else "Exact conversion factors."
        )
        return (
            f"**{shown} {target}**\n\n`{format_number(value)} {source} = "
            f"{shown} {target}`\n\n{note}"
        )

    return None


PREFIXES = (
    "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
    "solve ", "evaluate ", "how much is ",
)


def math_intent(text: str):
    candidate = text
    for prefix in PREFIXES:
        if candidate.startswith(prefix):
            candidate = candidate[len(prefix):]
            break
    candidate = candidate.strip().rstrip("?=").strip()

    if candidate.startswith("the "):
        candidate = candidate[4:]
    if candidate.startswith("square root of "):
        candidate = "sqrt(" + candidate[len("square root of "):] + ")"
    elif candidate.startswith("cube root of "):
        candidate = "cbrt(" + candidate[len("cube root of "):] + ")"
    elif candidate.startswith("factorial of "):
        candidate = candidate[len("factorial of "):] + "!"
    elif candidate.endswith(" squared"):
        candidate = "(" + candidate[: -len(" squared")] + ")^2"
    elif candidate.endswith(" cubed"):
        candidate = "(" + candidate[: -len(" cubed")] + ")^3"

    padded = " " + candidate + " "
    padded = padded.replace(" to the power of ", "^")
    padded = padded.replace(" divided by ", "/")
    padded = padded.replace(" multiplied by ", "*")
    padded = padded.replace(" times ", "*")
    padded = padded.replace(" plus ", "+")
    padded = padded.replace(" minus ", "-")
    padded = padded.replace(" factorial", "!")
    candidate = padded.strip()

    if not candidate:
        return None
    if any(not (ch.isalnum() or ch in "+-*/^%(),!. " or ch.isspace()) for ch in candidate):
        return None
    has_digit = any(ch.isdigit() for ch in candidate)
    words = "".join(ch if ch.isalpha() else " " for ch in candidate).split()
    if not has_digit and not any(word in ("pi", "e") for word in words):
        return None

    try:
        value = evaluate(candidate)
    except (ParseError, ZeroDivisionError, ValueError, OverflowError):
        return None

    if not math.isfinite(value):
        return "math-limit", (
            "That expression does not produce a finite number (for example, "
            "division by zero, an invalid function domain or numeric overflow), so "
            "I will not present it as a normal result."
        )

    shown = format_number(value)
    display = candidate.replace("*", "×")
    trig = any(name + "(" in candidate for name in ("sin", "cos", "tan", "asin", "acos", "atan"))
    note = "\n\nTrigonometric functions use radians." if trig else ""
    return "math", f"**{shown}**\n\nExpression: {display} = {shown}{note}"


# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

def run_vectors(path: str) -> int:
    failures = []
    checked = 0

    with open(path, encoding="utf-8") as handle:
        for number, raw in enumerate(handle, start=1):
            line = raw.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            fields = line.split("\t")
            if len(fields) < 3:
                failures.append(f"line {number}: expected at least 3 columns")
                continue
            mode, prompt, expected = fields[0], fields[1], fields[2]
            contains = fields[3].split("|") if len(fields) > 3 and fields[3] else []
            checked += 1

            if mode == "eval":
                try:
                    value = evaluate(prompt)
                except ParseError as error:
                    failures.append(f"line {number}: {prompt!r} -> error {error}")
                    continue
                target = float(expected)
                tolerance = 1e-9 * max(1.0, abs(target))
                if abs(value - target) > tolerance:
                    failures.append(f"line {number}: {prompt!r} -> {value!r}, wanted {target!r}")
                continue

            intent, text = answer(prompt)
            if intent != expected:
                failures.append(f"line {number}: {prompt!r} -> intent {intent!r}, wanted {expected!r}")
                continue
            for fragment in contains:
                if fragment not in text:
                    failures.append(f"line {number}: {prompt!r} -> text missing {fragment!r}")
                    break

    if failures:
        for failure in failures:
            print("FAIL " + failure)
        print(f"{len(failures)} failure(s) out of {checked} case(s)")
        return 1

    print(f"ok: {checked} cases")
    return 0


def main(argv) -> int:
    if len(argv) > 1 and argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    if len(argv) > 1:
        return run_vectors(argv[1])
    default = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vectors.tsv")
    return run_vectors(default)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
