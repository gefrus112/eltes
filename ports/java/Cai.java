// ==========================================================================
// Eltes CAI engine — Java port (standard library only, Java 17+).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     javac -encoding UTF-8 -d out Cai.java
//     java -cp out Cai ../vectors.tsv
// ==========================================================================
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public final class Cai {

    // ----------------------------------------------------------------------
    // formatting
    // ----------------------------------------------------------------------

    static String formatNumber(double value) {
        if (Double.isNaN(value)) {
            return "NaN";
        }
        if (Double.isInfinite(value)) {
            return value > 0 ? "Infinity" : "-Infinity";
        }

        double magnitude = Math.abs(value);
        if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
            String raw = String.format(Locale.ROOT, "%.10e", value);
            int marker = raw.indexOf('e');
            if (marker < 0) {
                return raw;
            }
            String mantissa = raw.substring(0, marker);
            String exponent = raw.substring(marker + 1);
            if (mantissa.contains(".")) {
                mantissa = mantissa.replaceAll("0+$", "").replaceAll("\\.$", "");
            }
            return mantissa + "e" + exponent;
        }

        double rounded = Math.round(value * 1e10) / 1e10;
        if (rounded == 0) {
            return "0";
        }
        String text = String.format(Locale.ROOT, "%.10f", rounded);
        text = text.replaceAll("0+$", "").replaceAll("\\.$", "");
        return text.isEmpty() ? "0" : text;
    }

    // ----------------------------------------------------------------------
    // tokens
    // ----------------------------------------------------------------------

    enum Kind { NUMBER, IDENT, OPERATOR, OPEN, CLOSE, COMMA }

    record Token(Kind kind, double value, String text, char op) {
        static Token number(double value) {
            return new Token(Kind.NUMBER, value, "", '\0');
        }

        static Token ident(String text) {
            return new Token(Kind.IDENT, 0, text, '\0');
        }

        static Token operator(char op) {
            return new Token(Kind.OPERATOR, 0, "", op);
        }

        static Token simple(Kind kind) {
            return new Token(kind, 0, "", '\0');
        }
    }

    static final class ParseFailure extends RuntimeException {
        ParseFailure(String message) {
            super(message);
        }
    }

    static final Map<String, int[]> FUNCTIONS = new HashMap<>();
    static final Map<String, Integer> PRECEDENCE = new HashMap<>();

    static {
        for (String name : new String[]{"sqrt", "cbrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan",
                "ln", "log10", "log2", "exp", "floor", "ceil", "round"}) {
            FUNCTIONS.put(name, new int[]{1, 1});
        }
        FUNCTIONS.put("log", new int[]{1, 2});
        FUNCTIONS.put("pow", new int[]{2, 2});
        for (String name : new String[]{"min", "max", "sum", "mean", "product"}) {
            FUNCTIONS.put(name, new int[]{1, Integer.MAX_VALUE});
        }
        PRECEDENCE.put("+", 1);
        PRECEDENCE.put("-", 1);
        PRECEDENCE.put("*", 2);
        PRECEDENCE.put("/", 2);
        PRECEDENCE.put("%", 2);
        PRECEDENCE.put("^", 3);
    }

    // ----------------------------------------------------------------------
    // tokenizer
    // ----------------------------------------------------------------------

    static boolean digitBefore(String text, int index) {
        for (int cursor = index - 1; cursor >= 0; cursor--) {
            if (Character.isWhitespace(text.charAt(cursor))) {
                continue;
            }
            return Character.isDigit(text.charAt(cursor));
        }
        return false;
    }

    static boolean digitAfter(String text, int index) {
        for (int cursor = index + 1; cursor < text.length(); cursor++) {
            if (Character.isWhitespace(text.charAt(cursor))) {
                continue;
            }
            return Character.isDigit(text.charAt(cursor));
        }
        return false;
    }

    static String prepare(String source) {
        String text = source
                .replace("×", "*")
                .replace("✕", "*")
                .replace("✖", "*")
                .replace("÷", "/")
                .replace("−", "-")
                .replace("–", "-")
                .replace("—", "-")
                .replace("²", "^2")
                .replace("³", "^3");

        StringBuilder out = new StringBuilder(text.length());
        for (int index = 0; index < text.length(); index++) {
            char ch = text.charAt(index);
            if ((ch == 'x' || ch == 'X') && digitBefore(text, index) && digitAfter(text, index)) {
                out.append('*');
            } else {
                out.append(ch);
            }
        }
        return out.toString();
    }

    static List<Token> tokenize(String source) {
        String text = prepare(source);
        List<Token> tokens = new ArrayList<>();
        int index = 0;

        while (index < text.length()) {
            char ch = text.charAt(index);

            if (Character.isWhitespace(ch)) {
                index++;
                continue;
            }

            if (Character.isDigit(ch)
                    || (ch == '.' && index + 1 < text.length() && Character.isDigit(text.charAt(index + 1)))) {
                int start = index;
                while (index < text.length() && Character.isDigit(text.charAt(index))) {
                    index++;
                }
                if (index < text.length() && text.charAt(index) == '.') {
                    index++;
                    while (index < text.length() && Character.isDigit(text.charAt(index))) {
                        index++;
                    }
                }
                if (index < text.length() && (text.charAt(index) == 'e' || text.charAt(index) == 'E')) {
                    int probe = index + 1;
                    if (probe < text.length() && (text.charAt(probe) == '+' || text.charAt(probe) == '-')) {
                        probe++;
                    }
                    if (probe < text.length() && Character.isDigit(text.charAt(probe))) {
                        while (probe < text.length() && Character.isDigit(text.charAt(probe))) {
                            probe++;
                        }
                        index = probe;
                    }
                }
                String literal = text.substring(start, index);
                double value;
                try {
                    value = Double.parseDouble(literal);
                } catch (NumberFormatException error) {
                    throw new ParseFailure("bad number");
                }
                if (Double.isNaN(value) || Double.isInfinite(value)) {
                    throw new ParseFailure("bad number");
                }
                tokens.add(Token.number(value));
                continue;
            }

            if (Character.isLetter(ch)) {
                int start = index;
                while (index < text.length() && Character.isLetter(text.charAt(index))) {
                    index++;
                }
                tokens.add(Token.ident(text.substring(start, index).toLowerCase(Locale.ROOT)));
                continue;
            }

            if ("+-*/^%!".indexOf(ch) >= 0) {
                tokens.add(Token.operator(ch));
                index++;
                continue;
            }
            switch (ch) {
                case '(' -> {
                    tokens.add(Token.simple(Kind.OPEN));
                    index++;
                    continue;
                }
                case ')' -> {
                    tokens.add(Token.simple(Kind.CLOSE));
                    index++;
                    continue;
                }
                case ',' -> {
                    tokens.add(Token.simple(Kind.COMMA));
                    index++;
                    continue;
                }
                default -> throw new ParseFailure("unexpected character");
            }
        }

        List<Token> expanded = new ArrayList<>();
        for (Token item : tokens) {
            if (!expanded.isEmpty()) {
                Token previous = expanded.get(expanded.size() - 1);
                boolean ends = previous.kind() == Kind.NUMBER || previous.kind() == Kind.CLOSE
                        || (previous.kind() == Kind.IDENT
                        && (previous.text().equals("pi") || previous.text().equals("e")));
                boolean starts = item.kind() == Kind.NUMBER || item.kind() == Kind.IDENT || item.kind() == Kind.OPEN;
                boolean isCall = previous.kind() == Kind.IDENT && FUNCTIONS.containsKey(previous.text())
                        && item.kind() == Kind.OPEN;
                if (ends && starts && !isCall) {
                    expanded.add(Token.operator('*'));
                }
            }
            expanded.add(item);
        }
        return expanded;
    }

    // ----------------------------------------------------------------------
    // parser
    // ----------------------------------------------------------------------

    static final class Parser {
        private final List<Token> tokens;
        private int position;

        Parser(List<Token> tokens) {
            this.tokens = tokens;
        }

        double parse() {
            double value = expression(0);
            if (position != tokens.size()) {
                throw new ParseFailure("parse");
            }
            return value;
        }

        private boolean has() {
            return position < tokens.size();
        }

        private double expression(int minPrecedence) {
            double left = primary();

            while (has() && tokens.get(position).kind() == Kind.OPERATOR && tokens.get(position).op() == '!') {
                position++;
                left = factorial(left);
            }

            while (has() && tokens.get(position).kind() == Kind.OPERATOR) {
                char op = tokens.get(position).op();
                Integer precedence = PRECEDENCE.get(String.valueOf(op));
                if (precedence == null || precedence < minPrecedence) {
                    break;
                }
                position++;
                double right = expression(op == '^' ? precedence : precedence + 1);
                switch (op) {
                    case '+' -> left += right;
                    case '-' -> left -= right;
                    case '*' -> left *= right;
                    case '/' -> left /= right;
                    case '%' -> left = left % right;
                    case '^' -> left = Math.pow(left, right);
                    default -> throw new ParseFailure("parse");
                }
            }

            return left;
        }

        private double primary() {
            if (!has()) {
                throw new ParseFailure("parse");
            }
            Token item = tokens.get(position);
            position++;

            if (item.kind() == Kind.NUMBER) {
                return item.value();
            }

            if (item.kind() == Kind.OPERATOR && (item.op() == '-' || item.op() == '+')) {
                double value = expression(3);
                return item.op() == '-' ? -value : value;
            }

            if (item.kind() == Kind.OPEN) {
                double value = expression(0);
                if (!has() || tokens.get(position).kind() != Kind.CLOSE) {
                    throw new ParseFailure("parse");
                }
                position++;
                return value;
            }

            if (item.kind() == Kind.IDENT) {
                if (has() && tokens.get(position).kind() == Kind.OPEN && FUNCTIONS.containsKey(item.text())) {
                    position++;
                    List<Double> args = new ArrayList<>();
                    if (has() && tokens.get(position).kind() != Kind.CLOSE) {
                        args.add(expression(0));
                        while (has() && tokens.get(position).kind() == Kind.COMMA) {
                            position++;
                            args.add(expression(0));
                        }
                    }
                    if (!has() || tokens.get(position).kind() != Kind.CLOSE) {
                        throw new ParseFailure("parse");
                    }
                    position++;
                    return callFunction(item.text(), args);
                }
                if (item.text().equals("pi")) {
                    return Math.PI;
                }
                if (item.text().equals("e")) {
                    return Math.E;
                }
            }

            throw new ParseFailure("parse");
        }

        private static double factorial(double value) {
            if (value < 0 || value != Math.floor(value) || value > 170) {
                throw new ParseFailure("factorial domain");
            }
            double result = 1;
            for (double step = 2; step <= value; step++) {
                result *= step;
            }
            return result;
        }

        private static double callFunction(String name, List<Double> args) {
            int[] bounds = FUNCTIONS.get(name);
            if (bounds == null) {
                throw new ParseFailure("unknown function");
            }
            if (args.size() < bounds[0] || args.size() > bounds[1]) {
                throw new ParseFailure("argument count");
            }

            double first = args.get(0);
            switch (name) {
                case "sqrt": return Math.sqrt(first);
                case "cbrt": return Math.cbrt(first);
                case "abs": return Math.abs(first);
                case "sin": return Math.sin(first);
                case "cos": return Math.cos(first);
                case "tan": return Math.tan(first);
                case "asin": return Math.asin(first);
                case "acos": return Math.acos(first);
                case "atan": return Math.atan(first);
                case "ln": return Math.log(first);
                case "log10": return Math.log10(first);
                case "log2": return Math.log(first) / Math.log(2);
                case "exp": return Math.exp(first);
                case "floor": return Math.floor(first);
                case "ceil": return Math.ceil(first);
                case "round": return Math.round(first);
                case "log":
                    return args.size() == 1 ? Math.log(first) : Math.log(first) / Math.log(args.get(1));
                case "pow": return Math.pow(first, args.get(1));
                case "min": return args.stream().mapToDouble(Double::doubleValue).min().orElse(first);
                case "max": return args.stream().mapToDouble(Double::doubleValue).max().orElse(first);
                case "sum": return args.stream().mapToDouble(Double::doubleValue).sum();
                case "mean":
                    return args.stream().mapToDouble(Double::doubleValue).sum() / args.size();
                case "product":
                    return args.stream().reduce(1.0, (total, value) -> total * value);
                default: throw new ParseFailure("unknown function");
            }
        }
    }

    static double evaluate(String source) {
        List<Token> tokens = tokenize(source);
        if (tokens.isEmpty()) {
            throw new ParseFailure("parse");
        }
        return new Parser(tokens).parse();
    }

    // ----------------------------------------------------------------------
    // units
    // ----------------------------------------------------------------------

    record Unit(String kind, double factor) {
    }

    static final Map<String, Unit> UNITS = new HashMap<>();

    static {
        String[][] LENGTH = {{"mm", "0.001"}, {"cm", "0.01"}, {"m", "1"}, {"metre", "1"}, {"metres", "1"},
                {"meter", "1"}, {"meters", "1"}, {"km", "1000"}, {"in", "0.0254"}, {"inch", "0.0254"},
                {"inches", "0.0254"}, {"ft", "0.3048"}, {"feet", "0.3048"}, {"foot", "0.3048"},
                {"yd", "0.9144"}, {"mi", "1609.344"}, {"mile", "1609.344"}, {"miles", "1609.344"}};
        String[][] MASS = {{"mg", "0.001"}, {"g", "1"}, {"kg", "1000"}, {"oz", "28.349523125"},
                {"lb", "453.59237"}, {"lbs", "453.59237"}, {"pound", "453.59237"}, {"pounds", "453.59237"},
                {"stone", "6350.29318"}, {"st", "6350.29318"}};
        String[][] VOLUME = {{"ml", "0.001"}, {"l", "1"}, {"litre", "1"}, {"litres", "1"}, {"liter", "1"},
                {"liters", "1"}, {"tsp", "0.00492892159"}, {"tbsp", "0.0147867648"}, {"cup", "0.2365882365"},
                {"pint", "0.473176473"}, {"qt", "0.946352946"}, {"quart", "0.946352946"},
                {"gal", "3.785411784"}, {"gallon", "3.785411784"}, {"gallons", "3.785411784"}};
        String[][] DATA = {{"b", "1"}, {"kb", "1e3"}, {"mb", "1e6"}, {"gb", "1e9"}, {"tb", "1e12"},
                {"kib", "1024"}, {"mib", "1048576"}, {"gib", "1073741824"}};
        String[][] SPEED = {{"km/h", "0.277777778"}, {"kph", "0.277777778"}, {"mph", "0.44704"}, {"m/s", "1"}};
        String[][] AREA = {{"m2", "1"}, {"km2", "1e6"}, {"ft2", "0.09290304"}, {"sqft", "0.09290304"},
                {"acre", "4046.8564224"}, {"hectare", "10000"}, {"ha", "10000"}};

        register("length", LENGTH);
        register("mass", MASS);
        register("volume", VOLUME);
        register("data", DATA);
        register("speed", SPEED);
        register("area", AREA);
    }

    static void register(String kind, String[][] rows) {
        for (String[] row : rows) {
            UNITS.put(row[0], new Unit(kind, Double.parseDouble(row[1])));
        }
    }

    static double temperatureConvert(double value, char from, char to) {
        double celsius = from == 'c' ? value : from == 'f' ? (value - 32) * 5 / 9 : value - 273.15;
        if (to == 'c') {
            return celsius;
        }
        if (to == 'f') {
            return celsius * 9 / 5 + 32;
        }
        return celsius + 273.15;
    }

    // ----------------------------------------------------------------------
    // intents
    // ----------------------------------------------------------------------

    static String normalize(String text) {
        String out = text.toLowerCase(Locale.ROOT)
                .replace("’", "'")
                .replace("‘", "'")
                .replace("−", "-")
                .replace("–", "-")
                .replace("—", "-")
                .replace("²", "^2")
                .replace("³", "^3")
                .trim();
        return out.replaceAll("\\s+", " ");
    }

    static boolean isNumberWord(String word) {
        return word != null && word.matches("[+-]?[0-9]*\\.?[0-9]+([eE][+-]?[0-9]+)?");
    }

    record Split(double value, String remainder) {
    }

    static Split splitNumber(String word) {
        int index = 0;
        if (index < word.length() && (word.charAt(index) == '+' || word.charAt(index) == '-')) {
            index++;
        }
        int digits = index;
        while (index < word.length() && Character.isDigit(word.charAt(index))) {
            index++;
        }
        if (index < word.length() && word.charAt(index) == '.') {
            index++;
            while (index < word.length() && Character.isDigit(word.charAt(index))) {
                index++;
            }
        }
        if (index == digits) {
            return null;
        }
        try {
            return new Split(Double.parseDouble(word.substring(0, index)), word.substring(index));
        } catch (NumberFormatException error) {
            return null;
        }
    }

    static String percentIntent(String text) {
        List<String> words = words(text.replace("%", " percent "));

        for (int index = 0; index + 3 < words.size(); index++) {
            if (!words.get(index + 1).equals("percent")) {
                continue;
            }
            if (!words.get(index + 2).equals("of") && !words.get(index + 2).equals("off")) {
                continue;
            }
            if (!isNumberWord(words.get(index)) || !isNumberWord(words.get(index + 3))) {
                continue;
            }

            double percent = Double.parseDouble(words.get(index));
            double base = Double.parseDouble(words.get(index + 3));
            double part = percent / 100 * base;

            if (words.get(index + 2).equals("off")) {
                return "**" + formatNumber(base - part) + "** after " + formatNumber(percent)
                        + "% off " + formatNumber(base) + " (a discount of " + formatNumber(part) + ").";
            }
            return "**" + formatNumber(part) + "** — " + formatNumber(percent) + "% of "
                    + formatNumber(base) + ".\n\n" + formatNumber(base) + " × "
                    + formatNumber(percent) + " / 100 = " + formatNumber(part);
        }

        if (text.matches(".*(percent|increase|decrease|change).*")) {
            for (int index = 0; index + 3 < words.size(); index++) {
                if (!words.get(index).equals("from") || !words.get(index + 2).equals("to")) {
                    continue;
                }
                if (!isNumberWord(words.get(index + 1)) || !isNumberWord(words.get(index + 3))) {
                    continue;
                }
                double start = Double.parseDouble(words.get(index + 1));
                double end = Double.parseDouble(words.get(index + 3));
                if (start == 0) {
                    return "Percentage change from zero is undefined because the calculation divides by "
                            + "the starting value. I will not report a finite percentage.";
                }
                double change = (end - start) / Math.abs(start) * 100;
                return "**" + formatNumber(change) + "%** change from " + formatNumber(start)
                        + " to " + formatNumber(end) + ".\n\nFormula: (" + formatNumber(end)
                        + " − " + formatNumber(start) + ") ÷ |" + formatNumber(start) + "| × 100";
            }
        }

        return null;
    }

    static String unitIntent(String text) {
        String prepared = text
                .replace("°", " ")
                .replace("degrees", " ")
                .replace("degree", " ")
                .replace("celsius", " c ")
                .replace("centigrade", " c ")
                .replace("fahrenheit", " f ")
                .replace("kelvin", " k ");
        List<String> words = words(prepared);

        for (int index = 0; index < words.size(); index++) {
            Split split = splitNumber(words.get(index));
            if (split == null) {
                continue;
            }
            double value = split.value();

            String source;
            int cursor;
            if (split.remainder().isEmpty()) {
                if (index + 1 >= words.size()) {
                    continue;
                }
                source = words.get(index + 1);
                cursor = index + 2;
            } else {
                source = split.remainder();
                cursor = index + 1;
            }
            if (cursor + 1 >= words.size()) {
                continue;
            }
            String connector = words.get(cursor);
            if (!connector.equals("to") && !connector.equals("in")
                    && !connector.equals("into") && !connector.equals("as")) {
                continue;
            }
            String target = words.get(cursor + 1);

            if (source.length() == 1 && target.length() == 1
                    && "cfk".indexOf(source.charAt(0)) >= 0 && "cfk".indexOf(target.charAt(0)) >= 0) {
                String fromLabel = source.toUpperCase(Locale.ROOT);
                String toLabel = target.toUpperCase(Locale.ROOT);
                if (source.equals(target)) {
                    return formatNumber(value) + " °" + fromLabel + " is the same in °" + toLabel + ".";
                }
                double converted = temperatureConvert(value, source.charAt(0), target.charAt(0));
                return "**" + formatNumber(converted) + " °" + toLabel + "**\n\n`"
                        + formatNumber(value) + " °" + fromLabel + " → " + formatNumber(converted)
                        + " °" + toLabel + "`";
            }

            Unit from = UNITS.get(source);
            Unit to = UNITS.get(target);
            if (from == null || to == null || !from.kind().equals(to.kind())) {
                continue;
            }

            double converted = value * from.factor() / to.factor();
            String note = from.kind().equals("data")
                    ? "Using decimal units (1 KB = 1,000 bytes)."
                    : "Exact conversion factors.";
            return "**" + formatNumber(converted) + " " + target + "**\n\n`" + formatNumber(value)
                    + " " + source + " = " + formatNumber(converted) + " " + target + "`\n\n" + note;
        }

        return null;
    }

    static final String[] PREFIXES = {
        "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
        "solve ", "evaluate ", "how much is ",
    };

    record Answer(String intent, String text) {
    }

    static Answer mathIntent(String text) {
        String candidate = text;
        for (String prefix : PREFIXES) {
            if (candidate.startsWith(prefix)) {
                candidate = candidate.substring(prefix.length());
                break;
            }
        }
        candidate = candidate.trim().replaceAll("[?=]+$", "").trim();
        if (candidate.startsWith("the ")) {
            candidate = candidate.substring(4);
        }

        if (candidate.startsWith("square root of ")) {
            candidate = "sqrt(" + candidate.substring("square root of ".length()) + ")";
        } else if (candidate.startsWith("cube root of ")) {
            candidate = "cbrt(" + candidate.substring("cube root of ".length()) + ")";
        } else if (candidate.startsWith("factorial of ")) {
            candidate = candidate.substring("factorial of ".length()) + "!";
        } else if (candidate.endsWith(" squared")) {
            candidate = "(" + candidate.substring(0, candidate.length() - " squared".length()) + ")^2";
        } else if (candidate.endsWith(" cubed")) {
            candidate = "(" + candidate.substring(0, candidate.length() - " cubed".length()) + ")^3";
        }

        String padded = " " + candidate + " ";
        padded = padded.replace(" to the power of ", "^")
                .replace(" divided by ", "/")
                .replace(" multiplied by ", "*")
                .replace(" times ", "*")
                .replace(" plus ", "+")
                .replace(" minus ", "-")
                .replace(" factorial", "!");
        candidate = padded.trim();

        if (candidate.isEmpty()) {
            return null;
        }
        for (int index = 0; index < candidate.length(); index++) {
            char ch = candidate.charAt(index);
            if (Character.isLetterOrDigit(ch) || "+-*/^%(),!. ".indexOf(ch) >= 0) {
                continue;
            }
            return null;
        }

        boolean hasDigit = candidate.matches(".*[0-9].*");
        boolean hasConstant = false;
        for (String word : candidate.split("[^a-zA-Z]+")) {
            if (word.equals("pi") || word.equals("e")) {
                hasConstant = true;
            }
        }
        if (!hasDigit && !hasConstant) {
            return null;
        }

        double value;
        try {
            value = evaluate(candidate);
        } catch (ParseFailure error) {
            return null;
        }

        if (Double.isNaN(value) || Double.isInfinite(value)) {
            return new Answer("math-limit",
                    "That expression does not produce a finite number (for example, division by zero, "
                            + "an invalid function domain or numeric overflow), so I will not present it "
                            + "as a normal result.");
        }

        String shown = formatNumber(value);
        String display = candidate.replace("*", "×");
        boolean trig = display.contains("sin(") || display.contains("cos(") || display.contains("tan(")
                || display.contains("asin(") || display.contains("acos(") || display.contains("atan(");
        return new Answer("math", "**" + shown + "**\n\nExpression: " + display + " = " + shown
                + (trig ? "\n\nTrigonometric functions use radians." : ""));
    }

    static final String[] LIVE = {
        "weather", "news", "stock price", "score", "who won", "latest",
        "headlines", "browse", "search the web",
    };

    static Answer answer(String prompt) {
        String text = prompt == null ? "" : prompt.trim();
        if (text.isEmpty()) {
            return new Answer("empty", "Ask me for arithmetic, percentages or a unit conversion. "
                    + "I answer on this device, so there is no network round trip.");
        }

        String lowered = normalize(text);

        String percent = percentIntent(lowered);
        if (percent != null) {
            return new Answer("percent", percent);
        }

        String units = unitIntent(lowered);
        if (units != null) {
            return new Answer("units", units);
        }

        Answer math = mathIntent(lowered);
        if (math != null) {
            return math;
        }

        for (String word : LIVE) {
            if (lowered.contains(word)) {
                return new Answer("live", "I cannot check live information — this engine has no network "
                        + "access, and it will not invent an answer.\n\nSwitch to a connected hosted model "
                        + "for current facts, or paste the source text here and I will help you reason "
                        + "about it.");
            }
        }

        return new Answer("fallback", "I want to be straight with you: **this is a small on-device "
                + "engine**, and that question is outside what it can answer reliably.\n\nIt is solid on:"
                + "\n\n- arithmetic and percentages\n- unit and temperature conversions\n\nSwitch to a "
                + "hosted model for open-ended writing, code review or live information.");
    }

    // ----------------------------------------------------------------------
    // helpers
    // ----------------------------------------------------------------------

    static List<String> words(String text) {
        List<String> out = new ArrayList<>();
        for (String word : text.trim().split("\\s+")) {
            if (!word.isEmpty()) {
                out.add(word);
            }
        }
        return out;
    }

    // ----------------------------------------------------------------------
    // conformance runner
    // ----------------------------------------------------------------------

    static int runVectors(String path) throws IOException {
        List<String> lines = Files.readAllLines(Path.of(path), StandardCharsets.UTF_8);
        List<String> failures = new ArrayList<>();
        int checked = 0;

        for (int offset = 0; offset < lines.size(); offset++) {
            int number = offset + 1;
            String line = lines.get(offset);
            if (line.endsWith("\r")) {
                line = line.substring(0, line.length() - 1);
            }
            if (line.trim().isEmpty() || line.startsWith("#")) {
                continue;
            }
            String[] fields = line.split("\t", -1);
            if (fields.length < 3) {
                failures.add("line " + number + ": expected at least 3 columns");
                continue;
            }
            checked++;

            if (fields[0].equals("eval")) {
                double value;
                try {
                    value = evaluate(fields[1]);
                } catch (ParseFailure error) {
                    failures.add("line " + number + ": '" + fields[1] + "' -> error");
                    continue;
                }
                double expected = Double.parseDouble(fields[2]);
                double tolerance = 1e-9 * Math.max(1, Math.abs(expected));
                if (Math.abs(value - expected) > tolerance) {
                    failures.add("line " + number + ": '" + fields[1] + "' -> " + formatNumber(value)
                            + ", wanted " + fields[2]);
                }
                continue;
            }

            Answer result = answer(fields[1]);
            if (!result.intent().equals(fields[2])) {
                failures.add("line " + number + ": '" + fields[1] + "' -> intent "
                        + result.intent() + ", wanted " + fields[2]);
                continue;
            }
            if (fields.length > 3 && !fields[3].isEmpty()) {
                for (String fragment : fields[3].split("\\|")) {
                    if (!result.text().contains(fragment)) {
                        failures.add("line " + number + ": '" + fields[1] + "' -> text missing '"
                                + fragment + "'");
                        break;
                    }
                }
            }
        }

        if (!failures.isEmpty()) {
            for (String failure : failures) {
                System.out.println("FAIL " + failure);
            }
            System.out.println(failures.size() + " failure(s) out of " + checked + " case(s)");
            return 1;
        }

        System.out.println("ok: " + checked + " cases");
        return 0;
    }

    public static void main(String[] args) throws IOException {
        String target = args.length > 0 ? args[0] : "../vectors.tsv";
        System.exit(runVectors(target));
    }
}
