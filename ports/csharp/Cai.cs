// ==========================================================================
// Eltes CAI engine — C# port (.NET, standard library only).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     dotnet run --project cai.csproj -- ../vectors.tsv
// ==========================================================================
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Eltes.Cai;

internal enum Kind
{
    Number,
    Ident,
    Operator,
    Open,
    Close,
    Comma,
}

internal readonly record struct Token(Kind Kind, double Value = 0, string Text = "", char Op = '\0');

internal sealed class ParseFailure : Exception
{
    public ParseFailure(string message) : base(message)
    {
    }
}

internal static class Program
{
    private static readonly Regex Whitespace = new(@"\s+", RegexOptions.Compiled);
    private static readonly Regex NumberWord = new(@"^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$", RegexOptions.Compiled);
    private static readonly Regex NumberPrefix = new(@"^([+-]?[0-9]*\.?[0-9]+)(.*)$", RegexOptions.Compiled | RegexOptions.Singleline);
    private static readonly Regex AllowedMath = new(@"^[a-zA-Z0-9+\-*/^%(),!. ]+$", RegexOptions.Compiled);
    private static readonly Regex TrailingPunctuation = new(@"[?=]+$", RegexOptions.Compiled);

    private static readonly Dictionary<string, (int Low, int High)> Functions = new()
    {
        ["sqrt"] = (1, 1), ["cbrt"] = (1, 1), ["abs"] = (1, 1),
        ["sin"] = (1, 1), ["cos"] = (1, 1), ["tan"] = (1, 1),
        ["asin"] = (1, 1), ["acos"] = (1, 1), ["atan"] = (1, 1),
        ["ln"] = (1, 1), ["log10"] = (1, 1), ["log2"] = (1, 1), ["exp"] = (1, 1),
        ["floor"] = (1, 1), ["ceil"] = (1, 1), ["round"] = (1, 1),
        ["log"] = (1, 2), ["pow"] = (2, 2),
        ["min"] = (1, int.MaxValue), ["max"] = (1, int.MaxValue), ["sum"] = (1, int.MaxValue),
        ["mean"] = (1, int.MaxValue), ["product"] = (1, int.MaxValue),
    };

    private static readonly Dictionary<char, int> Precedence = new()
    {
        ['+'] = 1, ['-'] = 1, ['*'] = 2, ['/'] = 2, ['%'] = 2, ['^'] = 3,
    };

    private sealed record Unit(string Kind, double Factor);

    private static readonly Dictionary<string, Unit> Units = new();

    static Program()
    {
        void Register(string kind, params (string Name, double Factor)[] rows)
        {
            foreach (var row in rows)
            {
                Units[row.Name] = new Unit(kind, row.Factor);
            }
        }

        Register("length",
            ("mm", 0.001), ("cm", 0.01), ("m", 1.0), ("metre", 1.0), ("metres", 1.0),
            ("meter", 1.0), ("meters", 1.0), ("km", 1000.0), ("in", 0.0254), ("inch", 0.0254),
            ("inches", 0.0254), ("ft", 0.3048), ("feet", 0.3048), ("foot", 0.3048),
            ("yd", 0.9144), ("mi", 1609.344), ("mile", 1609.344), ("miles", 1609.344));
        Register("mass",
            ("mg", 0.001), ("g", 1.0), ("kg", 1000.0), ("oz", 28.349523125),
            ("lb", 453.59237), ("lbs", 453.59237), ("pound", 453.59237), ("pounds", 453.59237),
            ("stone", 6350.29318), ("st", 6350.29318));
        Register("volume",
            ("ml", 0.001), ("l", 1.0), ("litre", 1.0), ("litres", 1.0), ("liter", 1.0),
            ("liters", 1.0), ("tsp", 0.00492892159), ("tbsp", 0.0147867648),
            ("cup", 0.2365882365), ("pint", 0.473176473), ("qt", 0.946352946),
            ("quart", 0.946352946), ("gal", 3.785411784), ("gallon", 3.785411784),
            ("gallons", 3.785411784));
        Register("data",
            ("b", 1.0), ("kb", 1e3), ("mb", 1e6), ("gb", 1e9), ("tb", 1e12),
            ("kib", 1024.0), ("mib", 1048576.0), ("gib", 1073741824.0));
        Register("speed",
            ("km/h", 0.277777778), ("kph", 0.277777778), ("mph", 0.44704), ("m/s", 1.0));
        Register("area",
            ("m2", 1.0), ("km2", 1e6), ("ft2", 0.09290304), ("sqft", 0.09290304),
            ("acre", 4046.8564224), ("hectare", 10000.0), ("ha", 10000.0));
    }

    // ----------------------------------------------------------------------
    // formatting
    // ----------------------------------------------------------------------

    private static string FormatNumber(double value)
    {
        if (double.IsNaN(value))
        {
            return "NaN";
        }
        if (double.IsPositiveInfinity(value))
        {
            return "Infinity";
        }
        if (double.IsNegativeInfinity(value))
        {
            return "-Infinity";
        }

        double magnitude = Math.Abs(value);
        if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8))
        {
            string raw = value.ToString("e10", CultureInfo.InvariantCulture);
            int marker = raw.IndexOf('e');
            if (marker < 0)
            {
                return raw;
            }
            string mantissa = raw[..marker];
            string exponent = raw[(marker + 1)..];
            if (mantissa.Contains('.'))
            {
                mantissa = mantissa.TrimEnd('0').TrimEnd('.');
            }
            return mantissa + "e" + exponent;
        }

        double rounded = Math.Round(value * 1e10, MidpointRounding.AwayFromZero) / 1e10;
        if (rounded == 0)
        {
            return "0";
        }
        string text = rounded.ToString("F10", CultureInfo.InvariantCulture);
        text = text.TrimEnd('0').TrimEnd('.');
        return text.Length == 0 ? "0" : text;
    }

    // ----------------------------------------------------------------------
    // tokenizer
    // ----------------------------------------------------------------------

    private static bool DigitBefore(string text, int index)
    {
        for (int cursor = index - 1; cursor >= 0; cursor--)
        {
            if (char.IsWhiteSpace(text[cursor]))
            {
                continue;
            }
            return char.IsDigit(text[cursor]);
        }
        return false;
    }

    private static bool DigitAfter(string text, int index)
    {
        for (int cursor = index + 1; cursor < text.Length; cursor++)
        {
            if (char.IsWhiteSpace(text[cursor]))
            {
                continue;
            }
            return char.IsDigit(text[cursor]);
        }
        return false;
    }

    private static string Prepare(string source)
    {
        string text = source
            .Replace("×", "*").Replace("✕", "*").Replace("✖", "*")
            .Replace("÷", "/")
            .Replace("−", "-").Replace("–", "-").Replace("—", "-")
            .Replace("²", "^2").Replace("³", "^3");

        var builder = new StringBuilder(text.Length);
        for (int index = 0; index < text.Length; index++)
        {
            char ch = text[index];
            if ((ch == 'x' || ch == 'X') && DigitBefore(text, index) && DigitAfter(text, index))
            {
                builder.Append('*');
            }
            else
            {
                builder.Append(ch);
            }
        }
        return builder.ToString();
    }

    private static List<Token> Tokenize(string source)
    {
        string text = Prepare(source);
        var tokens = new List<Token>();
        int index = 0;

        while (index < text.Length)
        {
            char ch = text[index];

            if (char.IsWhiteSpace(ch))
            {
                index++;
                continue;
            }

            if (char.IsDigit(ch) || (ch == '.' && index + 1 < text.Length && char.IsDigit(text[index + 1])))
            {
                int start = index;
                while (index < text.Length && char.IsDigit(text[index]))
                {
                    index++;
                }
                if (index < text.Length && text[index] == '.')
                {
                    index++;
                    while (index < text.Length && char.IsDigit(text[index]))
                    {
                        index++;
                    }
                }
                if (index < text.Length && (text[index] == 'e' || text[index] == 'E'))
                {
                    int probe = index + 1;
                    if (probe < text.Length && (text[probe] == '+' || text[probe] == '-'))
                    {
                        probe++;
                    }
                    if (probe < text.Length && char.IsDigit(text[probe]))
                    {
                        while (probe < text.Length && char.IsDigit(text[probe]))
                        {
                            probe++;
                        }
                        index = probe;
                    }
                }
                string literal = text[start..index];
                if (!double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
                {
                    throw new ParseFailure("bad number");
                }
                if (double.IsNaN(value) || double.IsInfinity(value))
                {
                    throw new ParseFailure("bad number");
                }
                tokens.Add(new Token(Kind.Number, value));
                continue;
            }

            if (char.IsLetter(ch))
            {
                int start = index;
                while (index < text.Length && char.IsLetter(text[index]))
                {
                    index++;
                }
                tokens.Add(new Token(Kind.Ident, Text: text[start..index].ToLowerInvariant()));
                continue;
            }

            if ("+-*/^%!".Contains(ch))
            {
                tokens.Add(new Token(Kind.Operator, Op: ch));
                index++;
                continue;
            }

            switch (ch)
            {
                case '(':
                    tokens.Add(new Token(Kind.Open));
                    index++;
                    continue;
                case ')':
                    tokens.Add(new Token(Kind.Close));
                    index++;
                    continue;
                case ',':
                    tokens.Add(new Token(Kind.Comma));
                    index++;
                    continue;
                default:
                    throw new ParseFailure("unexpected character");
            }
        }

        var expanded = new List<Token>();
        foreach (var item in tokens)
        {
            if (expanded.Count > 0)
            {
                var previous = expanded[^1];
                bool ends = previous.Kind == Kind.Number || previous.Kind == Kind.Close ||
                    (previous.Kind == Kind.Ident && (previous.Text == "pi" || previous.Text == "e"));
                bool starts = item.Kind == Kind.Number || item.Kind == Kind.Ident || item.Kind == Kind.Open;
                bool isCall = previous.Kind == Kind.Ident && Functions.ContainsKey(previous.Text) && item.Kind == Kind.Open;
                if (ends && starts && !isCall)
                {
                    expanded.Add(new Token(Kind.Operator, Op: '*'));
                }
            }
            expanded.Add(item);
        }
        return expanded;
    }

    // ----------------------------------------------------------------------
    // parser
    // ----------------------------------------------------------------------

    private sealed class Parser
    {
        private readonly List<Token> _tokens;
        private int _position;

        public Parser(List<Token> tokens)
        {
            _tokens = tokens;
        }

        public double Parse()
        {
            double value = Expression(0);
            if (_position != _tokens.Count)
            {
                throw new ParseFailure("parse");
            }
            return value;
        }

        private bool Has() => _position < _tokens.Count;

        private double Expression(int minPrecedence)
        {
            double left = Primary();

            while (Has() && _tokens[_position].Kind == Kind.Operator && _tokens[_position].Op == '!')
            {
                _position++;
                left = Factorial(left);
            }

            while (Has() && _tokens[_position].Kind == Kind.Operator)
            {
                char op = _tokens[_position].Op;
                if (!Precedence.TryGetValue(op, out int precedence) || precedence < minPrecedence)
                {
                    break;
                }
                _position++;
                double right = Expression(op == '^' ? precedence : precedence + 1);
                left = op switch
                {
                    '+' => left + right,
                    '-' => left - right,
                    '*' => left * right,
                    '/' => left / right,
                    '%' => left % right,
                    '^' => Math.Pow(left, right),
                    _ => throw new ParseFailure("parse"),
                };
            }

            return left;
        }

        private double Primary()
        {
            if (!Has())
            {
                throw new ParseFailure("parse");
            }
            var item = _tokens[_position];
            _position++;

            if (item.Kind == Kind.Number)
            {
                return item.Value;
            }

            if (item.Kind == Kind.Operator && (item.Op == '-' || item.Op == '+'))
            {
                double value = Expression(3);
                return item.Op == '-' ? -value : value;
            }

            if (item.Kind == Kind.Open)
            {
                double value = Expression(0);
                if (!Has() || _tokens[_position].Kind != Kind.Close)
                {
                    throw new ParseFailure("parse");
                }
                _position++;
                return value;
            }

            if (item.Kind == Kind.Ident)
            {
                if (Has() && _tokens[_position].Kind == Kind.Open && Functions.ContainsKey(item.Text))
                {
                    _position++;
                    var args = new List<double>();
                    if (Has() && _tokens[_position].Kind != Kind.Close)
                    {
                        args.Add(Expression(0));
                        while (Has() && _tokens[_position].Kind == Kind.Comma)
                        {
                            _position++;
                            args.Add(Expression(0));
                        }
                    }
                    if (!Has() || _tokens[_position].Kind != Kind.Close)
                    {
                        throw new ParseFailure("parse");
                    }
                    _position++;
                    return CallFunction(item.Text, args);
                }
                if (item.Text == "pi")
                {
                    return Math.PI;
                }
                if (item.Text == "e")
                {
                    return Math.E;
                }
            }

            throw new ParseFailure("parse");
        }

        private static double Factorial(double value)
        {
            if (value < 0 || value != Math.Floor(value) || value > 170)
            {
                throw new ParseFailure("factorial domain");
            }
            double result = 1;
            for (double step = 2; step <= value; step++)
            {
                result *= step;
            }
            return result;
        }

        private static double CallFunction(string name, List<double> args)
        {
            if (!Functions.TryGetValue(name, out var bounds))
            {
                throw new ParseFailure("unknown function");
            }
            if (args.Count < bounds.Low || args.Count > bounds.High)
            {
                throw new ParseFailure("argument count");
            }

            double first = args[0];
            return name switch
            {
                "sqrt" => Math.Sqrt(first),
                "cbrt" => Math.Cbrt(first),
                "abs" => Math.Abs(first),
                "sin" => Math.Sin(first),
                "cos" => Math.Cos(first),
                "tan" => Math.Tan(first),
                "asin" => Math.Asin(first),
                "acos" => Math.Acos(first),
                "atan" => Math.Atan(first),
                "ln" => Math.Log(first),
                "log10" => Math.Log10(first),
                "log2" => Math.Log2(first),
                "exp" => Math.Exp(first),
                "floor" => Math.Floor(first),
                "ceil" => Math.Ceiling(first),
                "round" => Math.Round(first, MidpointRounding.AwayFromZero),
                "log" => args.Count == 1 ? Math.Log(first) : Math.Log(first) / Math.Log(args[1]),
                "pow" => Math.Pow(first, args[1]),
                "min" => args.Min(),
                "max" => args.Max(),
                "sum" => args.Sum(),
                "mean" => args.Sum() / args.Count,
                "product" => args.Aggregate(1.0, (total, value) => total * value),
                _ => throw new ParseFailure("unknown function"),
            };
        }
    }

    private static double Evaluate(string source)
    {
        var tokens = Tokenize(source);
        if (tokens.Count == 0)
        {
            throw new ParseFailure("parse");
        }
        return new Parser(tokens).Parse();
    }

    // ----------------------------------------------------------------------
    // units
    // ----------------------------------------------------------------------

    private static double Temperature(double value, char from, char to)
    {
        double celsius = from == 'c' ? value : from == 'f' ? (value - 32) * 5 / 9 : value - 273.15;
        return to == 'c' ? celsius : to == 'f' ? celsius * 9 / 5 + 32 : celsius + 273.15;
    }

    // ----------------------------------------------------------------------
    // intents
    // ----------------------------------------------------------------------

    private static string Normalize(string text)
    {
        string lowered = text.ToLowerInvariant()
            .Replace("’", "'").Replace("‘", "'")
            .Replace("−", "-").Replace("–", "-").Replace("—", "-")
            .Replace("²", "^2").Replace("³", "^3");
        return Whitespace.Replace(lowered.Trim(), " ");
    }

    private static string[] Words(string text)
    {
        return text.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
    }

    private static bool IsNumberWord(string? word)
    {
        return word is not null && NumberWord.IsMatch(word);
    }

    private static (double Value, string Remainder)? SplitNumber(string word)
    {
        var match = NumberPrefix.Match(word);
        if (!match.Success)
        {
            return null;
        }
        if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
        {
            return null;
        }
        return (value, match.Groups[2].Value);
    }

    private static string? PercentIntent(string text)
    {
        var words = Words(text.Replace("%", " percent "));

        for (int index = 0; index + 3 < words.Length; index++)
        {
            if (words[index + 1] != "percent")
            {
                continue;
            }
            if (words[index + 2] != "of" && words[index + 2] != "off")
            {
                continue;
            }
            if (!IsNumberWord(words[index]) || !IsNumberWord(words[index + 3]))
            {
                continue;
            }

            double percent = double.Parse(words[index], CultureInfo.InvariantCulture);
            double @base = double.Parse(words[index + 3], CultureInfo.InvariantCulture);
            double part = percent / 100 * @base;

            if (words[index + 2] == "off")
            {
                return $"**{FormatNumber(@base - part)}** after {FormatNumber(percent)}% off " +
                    $"{FormatNumber(@base)} (a discount of {FormatNumber(part)}).";
            }
            return $"**{FormatNumber(part)}** — {FormatNumber(percent)}% of {FormatNumber(@base)}.\n\n" +
                $"{FormatNumber(@base)} × {FormatNumber(percent)} / 100 = {FormatNumber(part)}";
        }

        if (Regex.IsMatch(text, "percent|increase|decrease|change"))
        {
            for (int index = 0; index + 3 < words.Length; index++)
            {
                if (words[index] != "from" || words[index + 2] != "to")
                {
                    continue;
                }
                if (!IsNumberWord(words[index + 1]) || !IsNumberWord(words[index + 3]))
                {
                    continue;
                }
                double start = double.Parse(words[index + 1], CultureInfo.InvariantCulture);
                double end = double.Parse(words[index + 3], CultureInfo.InvariantCulture);
                if (start == 0)
                {
                    return "Percentage change from zero is undefined because the calculation divides by " +
                        "the starting value. I will not report a finite percentage.";
                }
                double change = (end - start) / Math.Abs(start) * 100;
                return $"**{FormatNumber(change)}%** change from {FormatNumber(start)} to " +
                    $"{FormatNumber(end)}.\n\nFormula: ({FormatNumber(end)} − {FormatNumber(start)}) ÷ " +
                    $"|{FormatNumber(start)}| × 100";
            }
        }

        return null;
    }

    private static string? UnitIntent(string text)
    {
        string prepared = text
            .Replace("°", " ")
            .Replace("degrees", " ").Replace("degree", " ")
            .Replace("celsius", " c ").Replace("centigrade", " c ")
            .Replace("fahrenheit", " f ").Replace("kelvin", " k ");
        var words = Words(prepared);

        for (int index = 0; index < words.Length; index++)
        {
            var split = SplitNumber(words[index]);
            if (split is null)
            {
                continue;
            }
            double value = split.Value.Value;

            string source;
            int cursor;
            if (split.Value.Remainder.Length == 0)
            {
                if (index + 1 >= words.Length)
                {
                    continue;
                }
                source = words[index + 1];
                cursor = index + 2;
            }
            else
            {
                source = split.Value.Remainder;
                cursor = index + 1;
            }
            if (cursor + 1 >= words.Length)
            {
                continue;
            }
            string connector = words[cursor];
            if (connector is not ("to" or "in" or "into" or "as"))
            {
                continue;
            }
            string target = words[cursor + 1];

            if (source.Length == 1 && target.Length == 1 && "cfk".Contains(source[0]) && "cfk".Contains(target[0]))
            {
                string fromLabel = source.ToUpperInvariant();
                string toLabel = target.ToUpperInvariant();
                if (source == target)
                {
                    return $"{FormatNumber(value)} °{fromLabel} is the same in °{toLabel}.";
                }
                double converted = Temperature(value, source[0], target[0]);
                return $"**{FormatNumber(converted)} °{toLabel}**\n\n`{FormatNumber(value)} °{fromLabel} → " +
                    $"{FormatNumber(converted)} °{toLabel}`";
            }

            if (!Units.TryGetValue(source, out var from) || !Units.TryGetValue(target, out var to) ||
                from.Kind != to.Kind)
            {
                continue;
            }

            double result = value * from.Factor / to.Factor;
            string note = from.Kind == "data"
                ? "Using decimal units (1 KB = 1,000 bytes)."
                : "Exact conversion factors.";
            return $"**{FormatNumber(result)} {target}**\n\n`{FormatNumber(value)} {source} = " +
                $"{FormatNumber(result)} {target}`\n\n{note}";
        }

        return null;
    }

    private static readonly string[] Prefixes =
    {
        "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
        "solve ", "evaluate ", "how much is ",
    };

    private sealed record Answer(string Intent, string Text);

    private static Answer? MathIntent(string text)
    {
        string candidate = text;
        foreach (string prefix in Prefixes)
        {
            if (candidate.StartsWith(prefix, StringComparison.Ordinal))
            {
                candidate = candidate[prefix.Length..];
                break;
            }
        }
        candidate = TrailingPunctuation.Replace(candidate.Trim(), "").Trim();
        if (candidate.StartsWith("the ", StringComparison.Ordinal))
        {
            candidate = candidate[4..];
        }

        if (candidate.StartsWith("square root of ", StringComparison.Ordinal))
        {
            candidate = "sqrt(" + candidate["square root of ".Length..] + ")";
        }
        else if (candidate.StartsWith("cube root of ", StringComparison.Ordinal))
        {
            candidate = "cbrt(" + candidate["cube root of ".Length..] + ")";
        }
        else if (candidate.StartsWith("factorial of ", StringComparison.Ordinal))
        {
            candidate = candidate["factorial of ".Length..] + "!";
        }
        else if (candidate.EndsWith(" squared", StringComparison.Ordinal))
        {
            candidate = "(" + candidate[..^" squared".Length] + ")^2";
        }
        else if (candidate.EndsWith(" cubed", StringComparison.Ordinal))
        {
            candidate = "(" + candidate[..^" cubed".Length] + ")^3";
        }

        string padded = " " + candidate + " ";
        padded = padded
            .Replace(" to the power of ", "^")
            .Replace(" divided by ", "/")
            .Replace(" multiplied by ", "*")
            .Replace(" times ", "*")
            .Replace(" plus ", "+")
            .Replace(" minus ", "-")
            .Replace(" factorial", "!");
        candidate = padded.Trim();

        if (candidate.Length == 0 || !AllowedMath.IsMatch(candidate))
        {
            return null;
        }

        bool hasDigit = candidate.Any(char.IsDigit);
        bool hasConstant = Regex.Split(candidate, "[^a-zA-Z]+").Any(word => word is "pi" or "e");
        if (!hasDigit && !hasConstant)
        {
            return null;
        }

        double value;
        try
        {
            value = Evaluate(candidate);
        }
        catch (ParseFailure)
        {
            return null;
        }

        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return new Answer("math-limit",
                "That expression does not produce a finite number (for example, division by zero, an " +
                "invalid function domain or numeric overflow), so I will not present it as a normal result.");
        }

        string shown = FormatNumber(value);
        string display = candidate.Replace("*", "×");
        bool trig = Regex.IsMatch(candidate, @"sin\(|cos\(|tan\(|asin\(|acos\(|atan\(");
        return new Answer("math",
            $"**{shown}**\n\nExpression: {display} = {shown}" +
            (trig ? "\n\nTrigonometric functions use radians." : ""));
    }

    private static readonly string[] Live =
    {
        "weather", "news", "stock price", "score", "who won", "latest",
        "headlines", "browse", "search the web",
    };

    private static Answer AnswerPrompt(string prompt)
    {
        string text = (prompt ?? string.Empty).Trim();
        if (text.Length == 0)
        {
            return new Answer("empty",
                "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, " +
                "so there is no network round trip.");
        }

        string lowered = Normalize(text);

        string? percent = PercentIntent(lowered);
        if (percent is not null)
        {
            return new Answer("percent", percent);
        }

        string? units = UnitIntent(lowered);
        if (units is not null)
        {
            return new Answer("units", units);
        }

        Answer? math = MathIntent(lowered);
        if (math is not null)
        {
            return math;
        }

        foreach (string word in Live)
        {
            if (lowered.Contains(word, StringComparison.Ordinal))
            {
                return new Answer("live",
                    "I cannot check live information — this engine has no network access, and it will " +
                    "not invent an answer.\n\nSwitch to a connected hosted model for current facts, or " +
                    "paste the source text here and I will help you reason about it.");
            }
        }

        return new Answer("fallback",
            "I want to be straight with you: **this is a small on-device engine**, and that question is " +
            "outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n" +
            "- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, " +
            "code review or live information.");
    }

    // ----------------------------------------------------------------------
    // conformance runner
    // ----------------------------------------------------------------------

    private static int RunVectors(string path)
    {
        var lines = File.ReadAllLines(path, Encoding.UTF8);
        var failures = new List<string>();
        int checkedCases = 0;

        for (int offset = 0; offset < lines.Length; offset++)
        {
            int number = offset + 1;
            string line = lines[offset].TrimEnd('\r');
            if (line.Trim().Length == 0 || line.StartsWith('#'))
            {
                continue;
            }
            string[] fields = line.Split('\t');
            if (fields.Length < 3)
            {
                failures.Add($"line {number}: expected at least 3 columns");
                continue;
            }
            checkedCases++;

            if (fields[0] == "eval")
            {
                double value;
                try
                {
                    value = Evaluate(fields[1]);
                }
                catch (ParseFailure)
                {
                    failures.Add($"line {number}: '{fields[1]}' -> error");
                    continue;
                }
                double expected = double.Parse(fields[2], CultureInfo.InvariantCulture);
                double tolerance = 1e-9 * Math.Max(1, Math.Abs(expected));
                if (Math.Abs(value - expected) > tolerance)
                {
                    failures.Add($"line {number}: '{fields[1]}' -> {FormatNumber(value)}, wanted {fields[2]}");
                }
                continue;
            }

            var result = AnswerPrompt(fields[1]);
            if (result.Intent != fields[2])
            {
                failures.Add($"line {number}: '{fields[1]}' -> intent {result.Intent}, wanted {fields[2]}");
                continue;
            }
            if (fields.Length > 3 && fields[3].Length > 0)
            {
                foreach (string fragment in fields[3].Split('|'))
                {
                    if (!result.Text.Contains(fragment, StringComparison.Ordinal))
                    {
                        failures.Add($"line {number}: '{fields[1]}' -> text missing '{fragment}'");
                        break;
                    }
                }
            }
        }

        if (failures.Count > 0)
        {
            foreach (string failure in failures)
            {
                Console.WriteLine($"FAIL {failure}");
            }
            Console.WriteLine($"{failures.Count} failure(s) out of {checkedCases} case(s)");
            return 1;
        }

        Console.WriteLine($"ok: {checkedCases} cases");
        return 0;
    }

    private static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        string target = args.Length > 0 ? args[0] : "../vectors.tsv";
        return RunVectors(target);
    }
}
