// ==========================================================================
// Eltes CAI engine — C++ port (C++17, standard library only).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     g++ -std=c++17 -O2 -Wall -Wextra -Werror -o cai cai.cpp
//     ./cai ../vectors.tsv
// ==========================================================================
#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct ParseError : std::runtime_error {
    explicit ParseError(const std::string &message) : std::runtime_error(message) {}
};

std::string lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    return text;
}

std::string trim(const std::string &text) {
    size_t begin = 0;
    size_t end = text.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(text[begin]))) begin++;
    while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1]))) end--;
    return text.substr(begin, end - begin);
}

std::string collapse(const std::string &text) {
    std::istringstream stream(text);
    std::string word;
    std::string out;
    while (stream >> word) {
        if (!out.empty()) out += ' ';
        out += word;
    }
    return out;
}

void replace_all(std::string &text, const std::string &needle, const std::string &replacement) {
    if (needle.empty()) return;
    size_t position = 0;
    while ((position = text.find(needle, position)) != std::string::npos) {
        text.replace(position, needle.size(), replacement);
        position += replacement.size();
    }
}

bool starts_with(const std::string &text, const std::string &prefix) {
    return text.rfind(prefix, 0) == 0;
}

bool ends_with(const std::string &text, const std::string &suffix) {
    return text.size() >= suffix.size() &&
           text.compare(text.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::vector<std::string> words_of(const std::string &text) {
    std::istringstream stream(text);
    std::vector<std::string> words;
    std::string word;
    while (stream >> word) words.push_back(word);
    return words;
}

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

std::string format_number(double value) {
    if (std::isnan(value)) return "NaN";
    if (std::isinf(value)) return value > 0 ? "Infinity" : "-Infinity";

    double magnitude = std::fabs(value);
    if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
        std::ostringstream stream;
        stream << std::scientific << std::setprecision(10) << value;
        std::string raw = stream.str();
        size_t marker = raw.find('e');
        if (marker == std::string::npos) return raw;
        std::string mantissa = raw.substr(0, marker);
        std::string exponent = raw.substr(marker + 1);
        if (mantissa.find('.') != std::string::npos) {
            while (!mantissa.empty() && mantissa.back() == '0') mantissa.pop_back();
            if (!mantissa.empty() && mantissa.back() == '.') mantissa.pop_back();
        }
        return mantissa + "e" + exponent;
    }

    double rounded = std::round(value * 1e10) / 1e10;
    if (rounded == 0) return "0";

    std::ostringstream stream;
    stream << std::fixed << std::setprecision(10) << rounded;
    std::string text = stream.str();
    if (text.find('.') != std::string::npos) {
        while (!text.empty() && text.back() == '0') text.pop_back();
        if (!text.empty() && text.back() == '.') text.pop_back();
    }
    return text;
}

// --------------------------------------------------------------------------
// tokenizer
// --------------------------------------------------------------------------

const std::map<std::string, std::pair<int, int>> FUNCTIONS = {
    {"sqrt", {1, 1}}, {"cbrt", {1, 1}}, {"abs", {1, 1}},
    {"sin", {1, 1}}, {"cos", {1, 1}}, {"tan", {1, 1}},
    {"asin", {1, 1}}, {"acos", {1, 1}}, {"atan", {1, 1}},
    {"ln", {1, 1}}, {"log10", {1, 1}}, {"log2", {1, 1}}, {"exp", {1, 1}},
    {"floor", {1, 1}}, {"ceil", {1, 1}}, {"round", {1, 1}},
    {"log", {1, 2}}, {"pow", {2, 2}},
    {"min", {1, 1000}}, {"max", {1, 1000}}, {"sum", {1, 1000}},
    {"mean", {1, 1000}}, {"product", {1, 1000}},
};

enum class Kind { Number, Ident, Operator, Open, Close, Comma };

struct Token {
    Kind kind;
    double number = 0;
    std::string text;
    char op = '\0';
};

bool digit_before(const std::string &text, size_t index) {
    for (size_t cursor = index; cursor > 0;) {
        cursor--;
        if (std::isspace(static_cast<unsigned char>(text[cursor]))) continue;
        return std::isdigit(static_cast<unsigned char>(text[cursor])) != 0;
    }
    return false;
}

bool digit_after(const std::string &text, size_t index) {
    for (size_t cursor = index + 1; cursor < text.size(); cursor++) {
        if (std::isspace(static_cast<unsigned char>(text[cursor]))) continue;
        return std::isdigit(static_cast<unsigned char>(text[cursor])) != 0;
    }
    return false;
}

std::string prepare(const std::string &source) {
    std::string text = source;
    replace_all(text, "×", "*");
    replace_all(text, "✕", "*");
    replace_all(text, "✖", "*");
    replace_all(text, "÷", "/");
    replace_all(text, "−", "-");
    replace_all(text, "–", "-");
    replace_all(text, "—", "-");
    replace_all(text, "²", "^2");
    replace_all(text, "³", "^3");

    std::string out;
    out.reserve(text.size());
    for (size_t index = 0; index < text.size(); index++) {
        char ch = text[index];
        if ((ch == 'x' || ch == 'X') && digit_before(text, index) && digit_after(text, index)) {
            out += '*';
        } else {
            out += ch;
        }
    }
    return out;
}

std::vector<Token> tokenize(const std::string &source) {
    std::string text = prepare(source);
    std::vector<Token> tokens;
    size_t index = 0;

    while (index < text.size()) {
        char ch = text[index];
        if (std::isspace(static_cast<unsigned char>(ch))) { index++; continue; }

        if (std::isdigit(static_cast<unsigned char>(ch)) ||
            (ch == '.' && index + 1 < text.size() && std::isdigit(static_cast<unsigned char>(text[index + 1])))) {
            size_t start = index;
            while (index < text.size() && std::isdigit(static_cast<unsigned char>(text[index]))) index++;
            if (index < text.size() && text[index] == '.') {
                index++;
                while (index < text.size() && std::isdigit(static_cast<unsigned char>(text[index]))) index++;
            }
            if (index < text.size() && (text[index] == 'e' || text[index] == 'E')) {
                size_t probe = index + 1;
                if (probe < text.size() && (text[probe] == '+' || text[probe] == '-')) probe++;
                if (probe < text.size() && std::isdigit(static_cast<unsigned char>(text[probe]))) {
                    while (probe < text.size() && std::isdigit(static_cast<unsigned char>(text[probe]))) probe++;
                    index = probe;
                }
            }
            double value = 0;
            try {
                value = std::stod(text.substr(start, index - start));
            } catch (const std::exception &) {
                throw ParseError("bad number");
            }
            if (!std::isfinite(value)) throw ParseError("bad number");
            tokens.push_back({Kind::Number, value, "", '\0'});
            continue;
        }

        if (std::isalpha(static_cast<unsigned char>(ch))) {
            size_t start = index;
            while (index < text.size() && std::isalpha(static_cast<unsigned char>(text[index]))) index++;
            tokens.push_back({Kind::Ident, 0, lower(text.substr(start, index - start)), '\0'});
            continue;
        }

        if (std::string("+-*/^%!").find(ch) != std::string::npos) {
            tokens.push_back({Kind::Operator, 0, "", ch});
            index++;
            continue;
        }
        if (ch == '(') { tokens.push_back({Kind::Open, 0, "", '\0'}); index++; continue; }
        if (ch == ')') { tokens.push_back({Kind::Close, 0, "", '\0'}); index++; continue; }
        if (ch == ',') { tokens.push_back({Kind::Comma, 0, "", '\0'}); index++; continue; }
        throw ParseError("unexpected character");
    }

    std::vector<Token> expanded;
    expanded.reserve(tokens.size() + 4);
    for (const Token &token : tokens) {
        if (!expanded.empty()) {
            const Token &previous = expanded.back();
            bool ends = previous.kind == Kind::Number || previous.kind == Kind::Close ||
                        (previous.kind == Kind::Ident && (previous.text == "pi" || previous.text == "e"));
            bool starts = token.kind == Kind::Number || token.kind == Kind::Ident || token.kind == Kind::Open;
            bool is_call = previous.kind == Kind::Ident && FUNCTIONS.count(previous.text) != 0 &&
                           token.kind == Kind::Open;
            if (ends && starts && !is_call) {
                expanded.push_back({Kind::Operator, 0, "", '*'});
            }
        }
        expanded.push_back(token);
    }
    return expanded;
}

// --------------------------------------------------------------------------
// parser
// --------------------------------------------------------------------------

class Parser {
  public:
    explicit Parser(std::vector<Token> tokens) : tokens_(std::move(tokens)) {}

    double parse() {
        double value = expression(0);
        if (position_ != tokens_.size()) throw ParseError("parse");
        return value;
    }

  private:
    const Token &peek() const {
        static const Token empty{Kind::Comma, 0, "", '\0'};
        if (position_ >= tokens_.size()) throw ParseError("parse");
        return tokens_[position_];
    }

    bool has() const { return position_ < tokens_.size(); }

    double expression(int min_precedence) {
        double left = primary();

        while (has() && tokens_[position_].kind == Kind::Operator && tokens_[position_].op == '!') {
            position_++;
            left = factorial(left);
        }

        while (has() && tokens_[position_].kind == Kind::Operator) {
            char op = tokens_[position_].op;
            int precedence = 0;
            switch (op) {
                case '+': case '-': precedence = 1; break;
                case '*': case '/': case '%': precedence = 2; break;
                case '^': precedence = 3; break;
                default: return left;
            }
            if (precedence < min_precedence) break;
            position_++;
            double right = expression(op == '^' ? precedence : precedence + 1);
            switch (op) {
                case '+': left += right; break;
                case '-': left -= right; break;
                case '*': left *= right; break;
                case '/': left /= right; break;
                case '%': left = std::fmod(left, right); break;
                case '^': left = std::pow(left, right); break;
                default: throw ParseError("parse");
            }
        }

        return left;
    }

    static double factorial(double value) {
        if (value < 0 || value != std::floor(value) || value > 170) throw ParseError("factorial domain");
        double result = 1;
        for (double step = 2; step <= value; step += 1) result *= step;
        return result;
    }

    static double call(const std::string &name, const std::vector<double> &args) {
        auto found = FUNCTIONS.find(name);
        if (found == FUNCTIONS.end()) throw ParseError("unknown function");
        int low = found->second.first;
        int high = found->second.second;
        if (static_cast<int>(args.size()) < low || static_cast<int>(args.size()) > high) {
            throw ParseError("argument count");
        }

        if (name == "sqrt") return std::sqrt(args[0]);
        if (name == "cbrt") return std::cbrt(args[0]);
        if (name == "abs") return std::fabs(args[0]);
        if (name == "sin") return std::sin(args[0]);
        if (name == "cos") return std::cos(args[0]);
        if (name == "tan") return std::tan(args[0]);
        if (name == "asin") return std::asin(args[0]);
        if (name == "acos") return std::acos(args[0]);
        if (name == "atan") return std::atan(args[0]);
        if (name == "ln") return std::log(args[0]);
        if (name == "log10") return std::log10(args[0]);
        if (name == "log2") return std::log2(args[0]);
        if (name == "exp") return std::exp(args[0]);
        if (name == "floor") return std::floor(args[0]);
        if (name == "ceil") return std::ceil(args[0]);
        if (name == "round") return std::round(args[0]);
        if (name == "log") return args.size() == 1 ? std::log(args[0]) : std::log(args[0]) / std::log(args[1]);
        if (name == "pow") return std::pow(args[0], args[1]);
        if (name == "min") return *std::min_element(args.begin(), args.end());
        if (name == "max") return *std::max_element(args.begin(), args.end());
        if (name == "sum") {
            double total = 0;
            for (double value : args) total += value;
            return total;
        }
        if (name == "mean") {
            double total = 0;
            for (double value : args) total += value;
            return total / static_cast<double>(args.size());
        }
        if (name == "product") {
            double total = 1;
            for (double value : args) total *= value;
            return total;
        }
        throw ParseError("unknown function");
    }

    double primary() {
        if (!has()) throw ParseError("parse");
        Token token = tokens_[position_++];

        if (token.kind == Kind::Number) return token.number;
        if (token.kind == Kind::Operator && (token.op == '-' || token.op == '+')) {
            double value = expression(3);
            return token.op == '-' ? -value : value;
        }
        if (token.kind == Kind::Open) {
            double value = expression(0);
            if (!has() || tokens_[position_].kind != Kind::Close) throw ParseError("parse");
            position_++;
            return value;
        }
        if (token.kind == Kind::Ident) {
            if (has() && tokens_[position_].kind == Kind::Open && FUNCTIONS.count(token.text) != 0) {
                position_++;
                std::vector<double> args;
                if (has() && tokens_[position_].kind != Kind::Close) {
                    args.push_back(expression(0));
                    while (has() && tokens_[position_].kind == Kind::Comma) {
                        position_++;
                        args.push_back(expression(0));
                    }
                }
                if (!has() || tokens_[position_].kind != Kind::Close) throw ParseError("parse");
                position_++;
                return call(token.text, args);
            }
            if (token.text == "pi") return 3.14159265358979323846;
            if (token.text == "e") return 2.71828182845904523536;
        }
        throw ParseError("parse");
    }

    std::vector<Token> tokens_;
    size_t position_ = 0;
};

double evaluate(const std::string &source) {
    std::vector<Token> tokens = tokenize(source);
    if (tokens.empty()) throw ParseError("parse");
    Parser parser(std::move(tokens));
    return parser.parse();
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

struct Unit {
    std::string kind;
    double factor;
};

const std::map<std::string, Unit> UNITS = {
    {"mm", {"length", 0.001}}, {"cm", {"length", 0.01}}, {"m", {"length", 1}},
    {"metre", {"length", 1}}, {"metres", {"length", 1}}, {"meter", {"length", 1}},
    {"meters", {"length", 1}}, {"km", {"length", 1000}}, {"in", {"length", 0.0254}},
    {"inch", {"length", 0.0254}}, {"inches", {"length", 0.0254}}, {"ft", {"length", 0.3048}},
    {"feet", {"length", 0.3048}}, {"foot", {"length", 0.3048}}, {"yd", {"length", 0.9144}},
    {"mi", {"length", 1609.344}}, {"mile", {"length", 1609.344}}, {"miles", {"length", 1609.344}},
    {"mg", {"mass", 0.001}}, {"g", {"mass", 1}}, {"kg", {"mass", 1000}},
    {"oz", {"mass", 28.349523125}}, {"lb", {"mass", 453.59237}}, {"lbs", {"mass", 453.59237}},
    {"pound", {"mass", 453.59237}}, {"pounds", {"mass", 453.59237}},
    {"stone", {"mass", 6350.29318}}, {"st", {"mass", 6350.29318}},
    {"ml", {"volume", 0.001}}, {"l", {"volume", 1}}, {"litre", {"volume", 1}},
    {"litres", {"volume", 1}}, {"liter", {"volume", 1}}, {"liters", {"volume", 1}},
    {"tsp", {"volume", 0.00492892159}}, {"tbsp", {"volume", 0.0147867648}},
    {"cup", {"volume", 0.2365882365}}, {"pint", {"volume", 0.473176473}},
    {"qt", {"volume", 0.946352946}}, {"quart", {"volume", 0.946352946}},
    {"gal", {"volume", 3.785411784}}, {"gallon", {"volume", 3.785411784}},
    {"gallons", {"volume", 3.785411784}},
    {"b", {"data", 1}}, {"kb", {"data", 1e3}}, {"mb", {"data", 1e6}}, {"gb", {"data", 1e9}},
    {"tb", {"data", 1e12}}, {"kib", {"data", 1024}}, {"mib", {"data", 1048576}},
    {"gib", {"data", 1073741824}},
    {"km/h", {"speed", 0.277777778}}, {"kph", {"speed", 0.277777778}},
    {"mph", {"speed", 0.44704}}, {"m/s", {"speed", 1}},
    {"m2", {"area", 1}}, {"km2", {"area", 1e6}}, {"ft2", {"area", 0.09290304}},
    {"sqft", {"area", 0.09290304}}, {"acre", {"area", 4046.8564224}},
    {"hectare", {"area", 10000}}, {"ha", {"area", 10000}},
};

double temperature_convert(double value, char from, char to) {
    double celsius = from == 'c' ? value : from == 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    if (to == 'c') return celsius;
    if (to == 'f') return celsius * 9 / 5 + 32;
    return celsius + 273.15;
}

// --------------------------------------------------------------------------
// intents
// --------------------------------------------------------------------------

std::string normalize(const std::string &text) {
    std::string out = lower(text);
    replace_all(out, "’", "'");
    replace_all(out, "‘", "'");
    replace_all(out, "−", "-");
    replace_all(out, "–", "-");
    replace_all(out, "—", "-");
    replace_all(out, "²", "^2");
    replace_all(out, "³", "^3");
    return collapse(out);
}

bool is_number(const std::string &word) {
    if (word.empty()) return false;
    size_t consumed = 0;
    try {
        std::stod(word, &consumed);
    } catch (const std::exception &) {
        return false;
    }
    return consumed == word.size();
}

bool split_number(const std::string &word, double &value, std::string &remainder) {
    size_t index = 0;
    if (index < word.size() && (word[index] == '+' || word[index] == '-')) index++;
    size_t digits = index;
    while (index < word.size() && std::isdigit(static_cast<unsigned char>(word[index]))) index++;
    if (index < word.size() && word[index] == '.') {
        index++;
        while (index < word.size() && std::isdigit(static_cast<unsigned char>(word[index]))) index++;
    }
    if (index == digits) return false;
    try {
        value = std::stod(word.substr(0, index));
    } catch (const std::exception &) {
        return false;
    }
    remainder = word.substr(index);
    return true;
}

std::string percent_intent(const std::string &text) {
    std::string expanded = text;
    replace_all(expanded, "%", " percent ");
    std::vector<std::string> words = words_of(expanded);

    for (size_t index = 0; index + 3 < words.size(); index++) {
        if (words[index + 1] != "percent") continue;
        if (words[index + 2] != "of" && words[index + 2] != "off") continue;
        if (!is_number(words[index]) || !is_number(words[index + 3])) continue;

        double percent = std::stod(words[index]);
        double base = std::stod(words[index + 3]);
        double part = percent / 100 * base;

        if (words[index + 2] == "off") {
            return "**" + format_number(base - part) + "** after " + format_number(percent) +
                   "% off " + format_number(base) + " (a discount of " + format_number(part) + ").";
        }
        return "**" + format_number(part) + "** — " + format_number(percent) + "% of " +
               format_number(base) + ".\n\n" + format_number(base) + " × " +
               format_number(percent) + " / 100 = " + format_number(part);
    }

    if (text.find("percent") != std::string::npos || text.find("increase") != std::string::npos ||
        text.find("decrease") != std::string::npos || text.find("change") != std::string::npos) {
        for (size_t index = 0; index + 3 < words.size(); index++) {
            if (words[index] != "from" || words[index + 2] != "to") continue;
            if (!is_number(words[index + 1]) || !is_number(words[index + 3])) continue;
            double start = std::stod(words[index + 1]);
            double end = std::stod(words[index + 3]);
            if (start == 0) {
                return "Percentage change from zero is undefined because the calculation divides by the "
                       "starting value. I will not report a finite percentage.";
            }
            double change = (end - start) / std::fabs(start) * 100;
            return "**" + format_number(change) + "%** change from " + format_number(start) + " to " +
                   format_number(end) + ".\n\nFormula: (" + format_number(end) + " − " +
                   format_number(start) + ") ÷ |" + format_number(start) + "| × 100";
        }
    }

    return "";
}

std::string unit_intent(const std::string &text) {
    std::string prepared = text;
    replace_all(prepared, "°", " ");
    replace_all(prepared, "degrees", " ");
    replace_all(prepared, "degree", " ");
    replace_all(prepared, "celsius", " c ");
    replace_all(prepared, "centigrade", " c ");
    replace_all(prepared, "fahrenheit", " f ");
    replace_all(prepared, "kelvin", " k ");

    std::vector<std::string> words = words_of(prepared);

    for (size_t index = 0; index < words.size(); index++) {
        double value = 0;
        std::string remainder;
        if (!split_number(words[index], value, remainder)) continue;

        std::string source;
        size_t cursor = 0;
        if (trim(remainder).empty()) {
            if (index + 1 >= words.size()) continue;
            source = words[index + 1];
            cursor = index + 2;
        } else {
            source = remainder;
            cursor = index + 1;
        }
        if (cursor + 1 >= words.size()) continue;
        const std::string &connector = words[cursor];
        if (connector != "to" && connector != "in" && connector != "into" && connector != "as") continue;
        const std::string &target = words[cursor + 1];

        if (source.size() == 1 && target.size() == 1 &&
            std::string("cfk").find(source[0]) != std::string::npos &&
            std::string("cfk").find(target[0]) != std::string::npos) {
            char from_key = source[0];
            char to_key = target[0];
            if (from_key == to_key) {
                std::string label(1, static_cast<char>(std::toupper(static_cast<unsigned char>(from_key))));
                std::string to_label(1, static_cast<char>(std::toupper(static_cast<unsigned char>(to_key))));
                return format_number(value) + " °" + label + " is the same in °" + to_label + ".";
            }
            double converted = temperature_convert(value, from_key, to_key);
            std::string from_label(1, static_cast<char>(std::toupper(static_cast<unsigned char>(from_key))));
            std::string to_label(1, static_cast<char>(std::toupper(static_cast<unsigned char>(to_key))));
            return "**" + format_number(converted) + " °" + to_label + "**\n\n`" +
                   format_number(value) + " °" + from_label + " → " + format_number(converted) +
                   " °" + to_label + "`";
        }

        auto from = UNITS.find(source);
        auto to = UNITS.find(target);
        if (from == UNITS.end() || to == UNITS.end() || from->second.kind != to->second.kind) continue;

        double converted = value * from->second.factor / to->second.factor;
        std::string note = from->second.kind == "data"
            ? "Using decimal units (1 KB = 1,000 bytes)."
            : "Exact conversion factors.";
        return "**" + format_number(converted) + " " + target + "**\n\n`" + format_number(value) +
               " " + source + " = " + format_number(converted) + " " + target + "`\n\n" + note;
    }

    return "";
}

std::pair<std::string, std::string> math_intent(const std::string &text) {
    std::string candidate = text;
    static const std::vector<std::string> PREFIXES = {
        "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
        "solve ", "evaluate ", "how much is ",
    };
    for (const std::string &prefix : PREFIXES) {
        if (starts_with(candidate, prefix)) {
            candidate = candidate.substr(prefix.size());
            break;
        }
    }
    candidate = trim(candidate);
    while (!candidate.empty() && (candidate.back() == '?' || candidate.back() == '=')) candidate.pop_back();
    candidate = trim(candidate);

    if (starts_with(candidate, "the ")) candidate = candidate.substr(4);

    if (starts_with(candidate, "square root of ")) {
        candidate = "sqrt(" + candidate.substr(std::string("square root of ").size()) + ")";
    } else if (starts_with(candidate, "cube root of ")) {
        candidate = "cbrt(" + candidate.substr(std::string("cube root of ").size()) + ")";
    } else if (starts_with(candidate, "factorial of ")) {
        candidate = candidate.substr(std::string("factorial of ").size()) + "!";
    } else if (ends_with(candidate, " squared")) {
        candidate = "(" + candidate.substr(0, candidate.size() - std::string(" squared").size()) + ")^2";
    } else if (ends_with(candidate, " cubed")) {
        candidate = "(" + candidate.substr(0, candidate.size() - std::string(" cubed").size()) + ")^3";
    }

    std::string padded = " " + candidate + " ";
    replace_all(padded, " to the power of ", "^");
    replace_all(padded, " divided by ", "/");
    replace_all(padded, " multiplied by ", "*");
    replace_all(padded, " times ", "*");
    replace_all(padded, " plus ", "+");
    replace_all(padded, " minus ", "-");
    replace_all(padded, " factorial", "!");
    candidate = trim(padded);

    if (candidate.empty()) return {"", ""};

    for (char ch : candidate) {
        if (std::isdigit(static_cast<unsigned char>(ch))) continue;
        if (std::isalpha(static_cast<unsigned char>(ch))) continue;
        if (std::string("+-*/^%(),!. ").find(ch) != std::string::npos) continue;
        return {"", ""};
    }

    bool has_digit = std::any_of(candidate.begin(), candidate.end(),
                                 [](unsigned char ch) { return std::isdigit(ch) != 0; });
    std::vector<std::string> words = words_of(candidate);
    bool has_constant = false;
    for (const std::string &word : words) {
        if (word == "pi" || word == "e") has_constant = true;
    }
    if (!has_digit && !has_constant) return {"", ""};

    double value = 0;
    try {
        value = evaluate(candidate);
    } catch (const std::exception &) {
        return {"", ""};
    }

    if (!std::isfinite(value)) {
        return {"math-limit",
                "That expression does not produce a finite number (for example, division by zero, an "
                "invalid function domain or numeric overflow), so I will not present it as a normal result."};
    }

    std::string shown = format_number(value);
    std::string display = candidate;
    replace_all(display, "*", "×");
    bool trig = display.find("sin(") != std::string::npos || display.find("cos(") != std::string::npos ||
                display.find("tan(") != std::string::npos || display.find("asin(") != std::string::npos ||
                display.find("acos(") != std::string::npos || display.find("atan(") != std::string::npos;
    return {"math", "**" + shown + "**\n\nExpression: " + display + " = " + shown +
                        (trig ? "\n\nTrigonometric functions use radians." : "")};
}

std::pair<std::string, std::string> answer(const std::string &prompt) {
    std::string text = trim(prompt);
    if (text.empty()) {
        return {"empty", "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, "
                         "so there is no network round trip."};
    }

    std::string lowered = normalize(text);

    std::string percent = percent_intent(lowered);
    if (!percent.empty()) return {"percent", percent};

    std::string units = unit_intent(lowered);
    if (!units.empty()) return {"units", units};

    std::pair<std::string, std::string> math = math_intent(lowered);
    if (!math.first.empty()) return math;

    static const std::vector<std::string> LIVE = {
        "weather", "news", "stock price", "score", "who won", "latest",
        "headlines", "browse", "search the web",
    };
    for (const std::string &word : LIVE) {
        if (lowered.find(word) != std::string::npos) {
            return {"live", "I cannot check live information — this engine has no network access, and it "
                            "will not invent an answer.\n\nSwitch to a connected hosted model for current "
                            "facts, or paste the source text here and I will help you reason about it."};
        }
    }

    return {"fallback", "I want to be straight with you: **this is a small on-device engine**, and that "
                        "question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic "
                        "and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for "
                        "open-ended writing, code review or live information."};
}

// --------------------------------------------------------------------------
// conformance runner
// --------------------------------------------------------------------------

int run_vectors(const std::string &path) {
    std::ifstream handle(path);
    if (!handle) {
        std::cerr << "cannot read " << path << "\n";
        return 1;
    }

    std::vector<std::string> failures;
    int checked = 0;
    int number = 0;
    std::string line;

    while (std::getline(handle, line)) {
        number++;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (trim(line).empty() || line[0] == '#') continue;

        std::vector<std::string> fields;
        size_t start = 0;
        for (size_t index = 0; index <= line.size() && fields.size() < 4; index++) {
            if (index == line.size() || line[index] == '\t') {
                fields.push_back(line.substr(start, index - start));
                start = index + 1;
            }
        }
        if (fields.size() < 3) {
            failures.push_back("line " + std::to_string(number) + ": expected at least 3 columns");
            continue;
        }
        checked++;

        if (fields[0] == "eval") {
            double value = 0;
            try {
                value = evaluate(fields[1]);
            } catch (const std::exception &) {
                failures.push_back("line " + std::to_string(number) + ": '" + fields[1] + "' -> error");
                continue;
            }
            double target = std::stod(fields[2]);
            double tolerance = 1e-9 * (std::fabs(target) > 1 ? std::fabs(target) : 1);
            if (std::fabs(value - target) > tolerance) {
                failures.push_back("line " + std::to_string(number) + ": '" + fields[1] + "' -> " +
                                   format_number(value) + ", wanted " + fields[2]);
            }
            continue;
        }

        auto [intent, text] = answer(fields[1]);
        if (intent != fields[2]) {
            failures.push_back("line " + std::to_string(number) + ": '" + fields[1] + "' -> intent " +
                               intent + ", wanted " + fields[2]);
            continue;
        }
        if (fields.size() > 3 && !fields[3].empty()) {
            std::stringstream fragments(fields[3]);
            std::string fragment;
            while (std::getline(fragments, fragment, '|')) {
                if (text.find(fragment) == std::string::npos) {
                    failures.push_back("line " + std::to_string(number) + ": '" + fields[1] +
                                       "' -> text missing '" + fragment + "'");
                    break;
                }
            }
        }
    }

    if (!failures.empty()) {
        for (const std::string &failure : failures) std::cout << "FAIL " << failure << "\n";
        std::cout << failures.size() << " failure(s) out of " << checked << " case(s)\n";
        return 1;
    }

    std::cout << "ok: " << checked << " cases\n";
    return 0;
}

}  // namespace

int main(int argc, char **argv) {
    const std::string path = argc > 1 ? argv[1] : "../vectors.tsv";
    return run_vectors(path);
}
