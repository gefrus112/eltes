/* ==========================================================================
   Eltes CAI engine — C port (C99, standard library only).

   Arithmetic, percentages, unit and temperature conversion, with an explicit
   refusal for anything outside those rules. No network, no model weights.

   Build and run the shared conformance suite:

       cc -std=c99 -O2 -Wall -Wextra -o cai cai.c -lm
       ./cai ../vectors.tsv
   ========================================================================== */
#include <ctype.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_TOKENS 512
#define MAX_WORDS 128
#define BUF 2048
#define TEXT 8192

/* --------------------------------------------------------------------------
   string helpers
   -------------------------------------------------------------------------- */

static void lower_copy(const char *src, char *out, size_t size) {
    size_t i = 0;
    for (; src[i] && i + 1 < size; i++) {
        unsigned char ch = (unsigned char)src[i];
        out[i] = (ch < 128) ? (char)tolower(ch) : (char)ch;
    }
    out[i] = '\0';
}

/* Collapse runs of whitespace and trim the ends, in place. */
static void collapse(char *text) {
    char *read = text;
    char *write = text;
    int space = 0;
    while (*read && isspace((unsigned char)*read)) read++;
    for (; *read; read++) {
        if (isspace((unsigned char)*read)) {
            space = 1;
            continue;
        }
        if (space && write != text) *write++ = ' ';
        space = 0;
        *write++ = *read;
    }
    *write = '\0';
}

static int starts_with(const char *text, const char *prefix) {
    return strncmp(text, prefix, strlen(prefix)) == 0;
}

static int ends_with(const char *text, const char *suffix) {
    size_t length = strlen(text);
    size_t tail = strlen(suffix);
    if (tail > length) return 0;
    return strcmp(text + length - tail, suffix) == 0;
}

/* Replace every occurrence of `needle` with `replacement`, safely. */
static void replace_all(char *text, size_t size, const char *needle, const char *replacement) {
    char out[BUF];
    size_t out_len = 0;
    size_t needle_len = strlen(needle);
    const char *cursor = text;

    if (needle_len == 0) return;
    while (*cursor) {
        const char *hit = strstr(cursor, needle);
        if (!hit) {
            size_t rest = strlen(cursor);
            if (out_len + rest + 1 >= size) rest = size > out_len + 1 ? size - out_len - 1 : 0;
            memcpy(out + out_len, cursor, rest);
            out_len += rest;
            break;
        }
        size_t chunk = (size_t)(hit - cursor);
        if (out_len + chunk + 1 >= size) chunk = size > out_len + 1 ? size - out_len - 1 : 0;
        memcpy(out + out_len, cursor, chunk);
        out_len += chunk;
        size_t add = strlen(replacement);
        if (out_len + add + 1 >= size) add = size > out_len + 1 ? size - out_len - 1 : 0;
        memcpy(out + out_len, replacement, add);
        out_len += add;
        cursor = hit + needle_len;
    }
    out[out_len] = '\0';
    snprintf(text, size, "%s", out);
}

/* --------------------------------------------------------------------------
   number formatting
   -------------------------------------------------------------------------- */

static void format_number(double value, char *out, size_t size) {
    if (isnan(value)) {
        snprintf(out, size, "NaN");
        return;
    }
    if (isinf(value)) {
        snprintf(out, size, value > 0 ? "Infinity" : "-Infinity");
        return;
    }

    double magnitude = fabs(value);
    if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
        char raw[64];
        snprintf(raw, sizeof raw, "%.10e", value);
        char *marker = strchr(raw, 'e');
        if (marker) {
            *marker = '\0';
            char *mantissa = raw;
            size_t length = strlen(mantissa);
            while (length > 1 && mantissa[length - 1] == '0') mantissa[--length] = '\0';
            if (length > 1 && mantissa[length - 1] == '.') mantissa[--length] = '\0';
            snprintf(out, size, "%se%s", mantissa, marker + 1);
        } else {
            snprintf(out, size, "%s", raw);
        }
        return;
    }

    double rounded = round(value * 1e10) / 1e10;
    if (rounded == 0) {
        snprintf(out, size, "0");
        return;
    }
    snprintf(out, size, "%.10f", rounded);
    size_t length = strlen(out);
    while (length > 1 && out[length - 1] == '0') out[--length] = '\0';
    if (length > 1 && out[length - 1] == '.') out[--length] = '\0';
}

/* --------------------------------------------------------------------------
   tokenizer
   -------------------------------------------------------------------------- */

typedef enum { T_NUM, T_IDENT, T_OP, T_LPAREN, T_RPAREN, T_COMMA } TokenType;

typedef struct {
    TokenType type;
    double number;
    char text[24];
    char op;
} Token;

static Token tokens[MAX_TOKENS];
static int token_count;
static int token_pos;
static int parse_failed;

static const char *FUNCTION_NAMES[] = {
    "sqrt", "cbrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan",
    "ln", "log", "log10", "log2", "exp", "floor", "ceil", "round",
    "min", "max", "sum", "mean", "product", "pow", NULL
};

static int is_function(const char *name) {
    for (int i = 0; FUNCTION_NAMES[i]; i++) {
        if (strcmp(FUNCTION_NAMES[i], name) == 0) return 1;
    }
    return 0;
}

/* Map the UTF-8 spellings of common calculator symbols onto ASCII. */
static void prepare(const char *source, char *out, size_t size) {
    size_t used = 0;
    const unsigned char *cursor = (const unsigned char *)source;
    char stage[BUF];
    size_t staged = 0;

    while (*cursor && staged + 4 < sizeof stage) {
        if (cursor[0] == 0xC3 && cursor[1] == 0x97) { stage[staged++] = '*'; cursor += 2; continue; } /* × */
        if (cursor[0] == 0xC3 && cursor[1] == 0xB7) { stage[staged++] = '/'; cursor += 2; continue; } /* ÷ */
        if (cursor[0] == 0xE2 && cursor[1] == 0x88 && cursor[2] == 0x92) { stage[staged++] = '-'; cursor += 3; continue; } /* − */
        if (cursor[0] == 0xE2 && cursor[1] == 0x80 && cursor[2] == 0x93) { stage[staged++] = '-'; cursor += 3; continue; } /* – */
        if (cursor[0] == 0xE2 && cursor[1] == 0x80 && cursor[2] == 0x94) { stage[staged++] = '-'; cursor += 3; continue; } /* — */
        if (cursor[0] == 0xC2 && cursor[1] == 0xB2) { stage[staged++] = '^'; stage[staged++] = '2'; cursor += 2; continue; } /* ² */
        if (cursor[0] == 0xC2 && cursor[1] == 0xB3) { stage[staged++] = '^'; stage[staged++] = '3'; cursor += 2; continue; } /* ³ */
        stage[staged++] = (char)*cursor++;
    }
    stage[staged] = '\0';

    /* `2 x 3` and `2x3` are calculator spellings of multiplication. */
    for (size_t i = 0; stage[i] && used + 2 < size; i++) {
        if (stage[i] == 'x' || stage[i] == 'X') {
            int digit_before = 0;
            int digit_after = 0;
            for (int back = (int)i - 1; back >= 0; back--) {
                if (isspace((unsigned char)stage[back])) continue;
                digit_before = isdigit((unsigned char)stage[back]) ? 1 : 0;
                break;
            }
            for (size_t ahead = i + 1; stage[ahead]; ahead++) {
                if (isspace((unsigned char)stage[ahead])) continue;
                digit_after = isdigit((unsigned char)stage[ahead]) ? 1 : 0;
                break;
            }
            out[used++] = (digit_before && digit_after) ? '*' : stage[i];
        } else {
            out[used++] = stage[i];
        }
    }
    out[used] = '\0';
}

static int tokenize(const char *source) {
    char text[BUF];
    prepare(source, text, sizeof text);

    token_count = 0;
    size_t index = 0;
    size_t length = strlen(text);

    while (index < length) {
        char ch = text[index];
        if (isspace((unsigned char)ch)) { index++; continue; }

        if (isdigit((unsigned char)ch) ||
            (ch == '.' && index + 1 < length && isdigit((unsigned char)text[index + 1]))) {
            size_t start = index;
            while (index < length && isdigit((unsigned char)text[index])) index++;
            if (index < length && text[index] == '.') {
                index++;
                while (index < length && isdigit((unsigned char)text[index])) index++;
            }
            if (index < length && (text[index] == 'e' || text[index] == 'E')) {
                size_t probe = index + 1;
                if (probe < length && (text[probe] == '+' || text[probe] == '-')) probe++;
                if (probe < length && isdigit((unsigned char)text[probe])) {
                    while (probe < length && isdigit((unsigned char)text[probe])) probe++;
                    index = probe;
                }
            }
            char literal[64];
            size_t span = index - start;
            if (span >= sizeof literal) return 0;
            memcpy(literal, text + start, span);
            literal[span] = '\0';
            char *end = NULL;
            double value = strtod(literal, &end);
            if (!end || *end != '\0' || !isfinite(value)) return 0;
            if (token_count >= MAX_TOKENS) return 0;
            tokens[token_count].type = T_NUM;
            tokens[token_count].number = value;
            token_count++;
            continue;
        }

        if (isalpha((unsigned char)ch)) {
            size_t start = index;
            while (index < length && isalpha((unsigned char)text[index])) index++;
            size_t span = index - start;
            if (span >= sizeof tokens[0].text) return 0;
            if (token_count >= MAX_TOKENS) return 0;
            tokens[token_count].type = T_IDENT;
            for (size_t i = 0; i < span; i++) tokens[token_count].text[i] = (char)tolower((unsigned char)text[start + i]);
            tokens[token_count].text[span] = '\0';
            token_count++;
            continue;
        }

        if (strchr("+-*/^%!", ch)) {
            if (token_count >= MAX_TOKENS) return 0;
            tokens[token_count].type = T_OP;
            tokens[token_count].op = ch;
            token_count++;
            index++;
            continue;
        }
        if (ch == '(') { tokens[token_count++].type = T_LPAREN; index++; continue; }
        if (ch == ')') { tokens[token_count++].type = T_RPAREN; index++; continue; }
        if (ch == ',') { tokens[token_count++].type = T_COMMA; index++; continue; }
        return 0;
    }

    /* implicit multiplication: 2pi, 3(4+5), (a)(b) */
    Token expanded[MAX_TOKENS];
    int expanded_count = 0;
    for (int i = 0; i < token_count; i++) {
        if (expanded_count > 0) {
            Token *previous = &expanded[expanded_count - 1];
            int ends = previous->type == T_NUM || previous->type == T_RPAREN ||
                (previous->type == T_IDENT && (strcmp(previous->text, "pi") == 0 || strcmp(previous->text, "e") == 0));
            int starts = tokens[i].type == T_NUM || tokens[i].type == T_IDENT || tokens[i].type == T_LPAREN;
            int is_call = previous->type == T_IDENT && is_function(previous->text) && tokens[i].type == T_LPAREN;
            if (ends && starts && !is_call && expanded_count < MAX_TOKENS) {
                expanded[expanded_count].type = T_OP;
                expanded[expanded_count].op = '*';
                expanded_count++;
            }
        }
        if (expanded_count < MAX_TOKENS) expanded[expanded_count++] = tokens[i];
    }
    memcpy(tokens, expanded, sizeof(Token) * (size_t)expanded_count);
    token_count = expanded_count;
    return 1;
}

/* --------------------------------------------------------------------------
   parser
   -------------------------------------------------------------------------- */

static double expression(int min_precedence);

static double factorial_value(double value) {
    if (value < 0 || value != floor(value) || value > 170) { parse_failed = 1; return 0; }
    double result = 1;
    for (double step = 2; step <= value; step += 1) result *= step;
    return result;
}

static int precedence_of(char op) {
    switch (op) {
        case '+': case '-': return 1;
        case '*': case '/': case '%': return 2;
        case '^': return 3;
        default: return 0;
    }
}

static double call_function(const char *name, const double *args, int count) {
    if (strcmp(name, "min") == 0 || strcmp(name, "max") == 0 || strcmp(name, "sum") == 0 ||
        strcmp(name, "mean") == 0 || strcmp(name, "product") == 0) {
        if (count < 1) { parse_failed = 1; return 0; }
        double total = strcmp(name, "product") == 0 ? 1.0 : 0.0;
        if (strcmp(name, "min") == 0) total = args[0];
        if (strcmp(name, "max") == 0) total = args[0];
        for (int i = 0; i < count; i++) {
            if (strcmp(name, "min") == 0) { if (args[i] < total) total = args[i]; }
            else if (strcmp(name, "max") == 0) { if (args[i] > total) total = args[i]; }
            else if (strcmp(name, "product") == 0) total *= args[i];
            else total += args[i];
        }
        if (strcmp(name, "mean") == 0) total /= count;
        return total;
    }

    int wants_two = strcmp(name, "pow") == 0;
    if (strcmp(name, "log") == 0) {
        if (count == 1) return log(args[0]);
        if (count != 2) { parse_failed = 1; return 0; }
        return log(args[0]) / log(args[1]);
    }
    if (count != 1 && !wants_two) { parse_failed = 1; return 0; }
    if (wants_two && count != 2) { parse_failed = 1; return 0; }

    if (strcmp(name, "sqrt") == 0) return sqrt(args[0]);
    if (strcmp(name, "cbrt") == 0) return cbrt(args[0]);
    if (strcmp(name, "abs") == 0) return fabs(args[0]);
    if (strcmp(name, "sin") == 0) return sin(args[0]);
    if (strcmp(name, "cos") == 0) return cos(args[0]);
    if (strcmp(name, "tan") == 0) return tan(args[0]);
    if (strcmp(name, "asin") == 0) return asin(args[0]);
    if (strcmp(name, "acos") == 0) return acos(args[0]);
    if (strcmp(name, "atan") == 0) return atan(args[0]);
    if (strcmp(name, "ln") == 0) return log(args[0]);
    if (strcmp(name, "log10") == 0) return log10(args[0]);
    if (strcmp(name, "log2") == 0) return log2(args[0]);
    if (strcmp(name, "exp") == 0) return exp(args[0]);
    if (strcmp(name, "floor") == 0) return floor(args[0]);
    if (strcmp(name, "ceil") == 0) return ceil(args[0]);
    if (strcmp(name, "round") == 0) return round(args[0]);
    if (strcmp(name, "pow") == 0) return pow(args[0], args[1]);
    parse_failed = 1;
    return 0;
}

static double primary(void) {
    if (token_pos >= token_count) { parse_failed = 1; return 0; }
    Token token = tokens[token_pos++];

    if (token.type == T_NUM) return token.number;

    if (token.type == T_OP && (token.op == '-' || token.op == '+')) {
        double value = expression(3);
        return token.op == '-' ? -value : value;
    }

    if (token.type == T_LPAREN) {
        double value = expression(0);
        if (parse_failed || token_pos >= token_count || tokens[token_pos].type != T_RPAREN) {
            parse_failed = 1;
            return 0;
        }
        token_pos++;
        return value;
    }

    if (token.type == T_IDENT) {
        if (token_pos < token_count && tokens[token_pos].type == T_LPAREN && is_function(token.text)) {
            token_pos++;
            double args[16];
            int count = 0;
            if (token_pos < token_count && tokens[token_pos].type != T_RPAREN) {
                args[count++] = expression(0);
                while (!parse_failed && token_pos < token_count && tokens[token_pos].type == T_COMMA) {
                    token_pos++;
                    if (count < 16) args[count++] = expression(0);
                }
            }
            if (parse_failed || token_pos >= token_count || tokens[token_pos].type != T_RPAREN) {
                parse_failed = 1;
                return 0;
            }
            token_pos++;
            return call_function(token.text, args, count);
        }
        if (strcmp(token.text, "pi") == 0) return 3.14159265358979323846;
        if (strcmp(token.text, "e") == 0) return 2.71828182845904523536;
    }

    parse_failed = 1;
    return 0;
}

static double expression(int min_precedence) {
    double left = primary();

    while (!parse_failed && token_pos < token_count && tokens[token_pos].type == T_OP && tokens[token_pos].op == '!') {
        token_pos++;
        left = factorial_value(left);
    }

    while (!parse_failed) {
        if (token_pos >= token_count || tokens[token_pos].type != T_OP) break;
        char op = tokens[token_pos].op;
        int precedence = precedence_of(op);
        if (!precedence || precedence < min_precedence) break;
        token_pos++;
        double right = expression(op == '^' ? precedence : precedence + 1);
        switch (op) {
            case '+': left += right; break;
            case '-': left -= right; break;
            case '*': left *= right; break;
            case '/': left /= right; break;
            case '%': left = fmod(left, right); break;
            case '^': left = pow(left, right); break;
            default: parse_failed = 1; break;
        }
    }

    return left;
}

static int evaluate(const char *source, double *out) {
    if (!tokenize(source)) return 0;
    if (token_count == 0) return 0;
    token_pos = 0;
    parse_failed = 0;
    double value = expression(0);
    if (parse_failed || token_pos != token_count) return 0;
    *out = value;
    return 1;
}

/* --------------------------------------------------------------------------
   units
   -------------------------------------------------------------------------- */

typedef struct {
    const char *name;
    const char *kind;
    double factor;
} Unit;

static const Unit UNITS[] = {
    {"mm", "length", 0.001}, {"cm", "length", 0.01}, {"m", "length", 1},
    {"metre", "length", 1}, {"metres", "length", 1}, {"meter", "length", 1}, {"meters", "length", 1},
    {"km", "length", 1000}, {"in", "length", 0.0254}, {"inch", "length", 0.0254},
    {"inches", "length", 0.0254}, {"ft", "length", 0.3048}, {"feet", "length", 0.3048},
    {"foot", "length", 0.3048}, {"yd", "length", 0.9144}, {"mi", "length", 1609.344},
    {"mile", "length", 1609.344}, {"miles", "length", 1609.344},
    {"mg", "mass", 0.001}, {"g", "mass", 1}, {"kg", "mass", 1000},
    {"oz", "mass", 28.349523125}, {"lb", "mass", 453.59237}, {"lbs", "mass", 453.59237},
    {"pound", "mass", 453.59237}, {"pounds", "mass", 453.59237},
    {"stone", "mass", 6350.29318}, {"st", "mass", 6350.29318},
    {"ml", "volume", 0.001}, {"l", "volume", 1}, {"litre", "volume", 1}, {"litres", "volume", 1},
    {"liter", "volume", 1}, {"liters", "volume", 1}, {"tsp", "volume", 0.00492892159},
    {"tbsp", "volume", 0.0147867648}, {"cup", "volume", 0.2365882365},
    {"pint", "volume", 0.473176473}, {"qt", "volume", 0.946352946},
    {"quart", "volume", 0.946352946}, {"gal", "volume", 3.785411784},
    {"gallon", "volume", 3.785411784}, {"gallons", "volume", 3.785411784},
    {"b", "data", 1}, {"kb", "data", 1e3}, {"mb", "data", 1e6}, {"gb", "data", 1e9},
    {"tb", "data", 1e12}, {"kib", "data", 1024}, {"mib", "data", 1048576}, {"gib", "data", 1073741824},
    {"km/h", "speed", 0.277777778}, {"kph", "speed", 0.277777778},
    {"mph", "speed", 0.44704}, {"m/s", "speed", 1},
    {"m2", "area", 1}, {"km2", "area", 1e6}, {"ft2", "area", 0.09290304},
    {"sqft", "area", 0.09290304}, {"acre", "area", 4046.8564224},
    {"hectare", "area", 10000}, {"ha", "area", 10000},
    {NULL, NULL, 0}
};

static const Unit *lookup_unit(const char *name) {
    for (int i = 0; UNITS[i].name; i++) {
        if (strcmp(UNITS[i].name, name) == 0) return &UNITS[i];
    }
    return NULL;
}

static double temperature_convert(double value, char from, char to) {
    double celsius = from == 'c' ? value : from == 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    if (to == 'c') return celsius;
    if (to == 'f') return celsius * 9 / 5 + 32;
    return celsius + 273.15;
}

/* --------------------------------------------------------------------------
   intents
   -------------------------------------------------------------------------- */

static void normalize(const char *source, char *out, size_t size) {
    char lowered[BUF];
    lower_copy(source, lowered, sizeof lowered);
    replace_all(lowered, sizeof lowered, "’", "'");
    replace_all(lowered, sizeof lowered, "‘", "'");
    replace_all(lowered, sizeof lowered, "−", "-");
    replace_all(lowered, sizeof lowered, "–", "-");
    replace_all(lowered, sizeof lowered, "—", "-");
    replace_all(lowered, sizeof lowered, "²", "^2");
    replace_all(lowered, sizeof lowered, "³", "^3");
    snprintf(out, size, "%s", lowered);
    collapse(out);
}

static int is_numeric(const char *word) {
    if (!word || !*word) return 0;
    char *end = NULL;
    strtod(word, &end);
    return end && *end == '\0';
}

/* Split "12km" into 12 and "km". Returns 1 when a number was found. */
static int split_number(const char *word, double *value, const char **remainder) {
    const char *cursor = word;
    if (*cursor == '+' || *cursor == '-') cursor++;
    const char *digits = cursor;
    while (isdigit((unsigned char)*cursor)) cursor++;
    if (*cursor == '.') {
        cursor++;
        while (isdigit((unsigned char)*cursor)) cursor++;
    }
    if (cursor == digits) return 0;
    char number[64];
    size_t span = (size_t)(cursor - word);
    if (span >= sizeof number) return 0;
    memcpy(number, word, span);
    number[span] = '\0';
    *value = strtod(number, NULL);
    *remainder = cursor;
    return 1;
}

static int split_words(char *text, char *words[], int max) {
    int count = 0;
    char *cursor = text;
    while (*cursor && count < max) {
        while (*cursor && isspace((unsigned char)*cursor)) cursor++;
        if (!*cursor) break;
        words[count++] = cursor;
        while (*cursor && !isspace((unsigned char)*cursor)) cursor++;
        if (*cursor) *cursor++ = '\0';
    }
    return count;
}

static int percent_intent(const char *text, char *out, size_t size) {
    char expanded[BUF];
    snprintf(expanded, sizeof expanded, "%s", text);
    replace_all(expanded, sizeof expanded, "%", " percent ");

    char buffer[BUF];
    snprintf(buffer, sizeof buffer, "%s", expanded);
    char *words[MAX_WORDS];
    int count = split_words(buffer, words, MAX_WORDS);

    for (int i = 0; i + 3 < count; i++) {
        if (strcmp(words[i + 1], "percent") != 0) continue;
        if (strcmp(words[i + 2], "of") != 0 && strcmp(words[i + 2], "off") != 0) continue;
        if (!is_numeric(words[i]) || !is_numeric(words[i + 3])) continue;
        double percent = strtod(words[i], NULL);
        double base = strtod(words[i + 3], NULL);
        double part = percent / 100 * base;
        char a[64], b[64], c[64];
        if (strcmp(words[i + 2], "off") == 0) {
            format_number(base - part, a, sizeof a);
            format_number(percent, b, sizeof b);
            format_number(base, c, sizeof c);
            char d[64];
            format_number(part, d, sizeof d);
            snprintf(out, size, "**%s** after %s%% off %s (a discount of %s).", a, b, c, d);
        } else {
            format_number(part, a, sizeof a);
            format_number(percent, b, sizeof b);
            format_number(base, c, sizeof c);
            snprintf(out, size, "**%s** — %s%% of %s.\n\n%s × %s / 100 = %s", a, b, c, c, b, a);
        }
        return 1;
    }

    if (strstr(text, "percent") || strstr(text, "increase") || strstr(text, "decrease") || strstr(text, "change")) {
        for (int i = 0; i + 3 < count; i++) {
            if (strcmp(words[i], "from") != 0 || strcmp(words[i + 2], "to") != 0) continue;
            if (!is_numeric(words[i + 1]) || !is_numeric(words[i + 3])) continue;
            double start = strtod(words[i + 1], NULL);
            double end = strtod(words[i + 3], NULL);
            if (start == 0) {
                snprintf(out, size,
                    "Percentage change from zero is undefined because the calculation divides by the starting value. I will not report a finite percentage.");
                return 1;
            }
            double change = (end - start) / fabs(start) * 100;
            char a[64], b[64], c[64];
            format_number(change, a, sizeof a);
            format_number(start, b, sizeof b);
            format_number(end, c, sizeof c);
            snprintf(out, size, "**%s%%** change from %s to %s.\n\nFormula: (%s − %s) ÷ |%s| × 100", a, b, c, c, b, b);
            return 1;
        }
    }

    return 0;
}

static int unit_intent(const char *text, char *out, size_t size) {
    char prepared[BUF];
    snprintf(prepared, sizeof prepared, "%s", text);
    replace_all(prepared, sizeof prepared, "°", " ");
    replace_all(prepared, sizeof prepared, "degrees", " ");
    replace_all(prepared, sizeof prepared, "degree", " ");
    replace_all(prepared, sizeof prepared, "celsius", " c ");
    replace_all(prepared, sizeof prepared, "centigrade", " c ");
    replace_all(prepared, sizeof prepared, "fahrenheit", " f ");
    replace_all(prepared, sizeof prepared, "kelvin", " k ");

    char *words[MAX_WORDS];
    int count = split_words(prepared, words, MAX_WORDS);

    for (int i = 0; i < count; i++) {
        double value = 0;
        const char *remainder = NULL;
        if (!split_number(words[i], &value, &remainder)) continue;

        const char *source = NULL;
        int cursor = 0;
        if (*remainder == '\0') {
            if (i + 1 >= count) continue;
            source = words[i + 1];
            cursor = i + 2;
        } else {
            source = remainder;
            cursor = i + 1;
        }
        if (cursor + 1 >= count) continue;
        const char *connector = words[cursor];
        if (strcmp(connector, "to") != 0 && strcmp(connector, "in") != 0 &&
            strcmp(connector, "into") != 0 && strcmp(connector, "as") != 0) continue;
        const char *target = words[cursor + 1];

        if (strlen(source) == 1 && strlen(target) == 1 &&
            strchr("cfk", source[0]) && strchr("cfk", target[0])) {
            char a[64];
            if (source[0] == target[0]) {
                format_number(value, a, sizeof a);
                snprintf(out, size, "%s °%c is the same in °%c.", a, toupper((unsigned char)source[0]),
                         toupper((unsigned char)target[0]));
                return 1;
            }
            double converted = temperature_convert(value, source[0], target[0]);
            char b[64];
            format_number(value, a, sizeof a);
            format_number(converted, b, sizeof b);
            snprintf(out, size, "**%s °%c**\n\n`%s °%c → %s °%c`", b, toupper((unsigned char)target[0]),
                     a, toupper((unsigned char)source[0]), b, toupper((unsigned char)target[0]));
            return 1;
        }

        const Unit *from = lookup_unit(source);
        const Unit *to = lookup_unit(target);
        if (!from || !to || strcmp(from->kind, to->kind) != 0) continue;

        double converted = value * from->factor / to->factor;
        char a[64], b[64];
        format_number(value, a, sizeof a);
        format_number(converted, b, sizeof b);
        const char *note = strcmp(from->kind, "data") == 0
            ? "Using decimal units (1 KB = 1,000 bytes)."
            : "Exact conversion factors.";
        snprintf(out, size, "**%s %s**\n\n`%s %s = %s %s`\n\n%s", b, target, a, source, b, target, note);
        return 1;
    }

    return 0;
}

static int math_intent(const char *text, char *intent, size_t intent_size, char *out, size_t size) {
    char candidate[BUF];
    snprintf(candidate, sizeof candidate, "%s", text);

    static const char *PREFIXES[] = {
        "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
        "solve ", "evaluate ", "how much is ", NULL
    };
    for (int i = 0; PREFIXES[i]; i++) {
        if (starts_with(candidate, PREFIXES[i])) {
            memmove(candidate, candidate + strlen(PREFIXES[i]), strlen(candidate + strlen(PREFIXES[i])) + 1);
            break;
        }
    }

    size_t length = strlen(candidate);
    while (length > 0 && (candidate[length - 1] == '?' || candidate[length - 1] == '=')) candidate[--length] = '\0';
    collapse(candidate);

    if (starts_with(candidate, "the ")) memmove(candidate, candidate + 4, strlen(candidate + 4) + 1);

    char wrapped[BUF];
    static const char *SQUARE = "square root of ";
    static const char *CUBE = "cube root of ";
    static const char *FACTORIAL = "factorial of ";
    if (starts_with(candidate, SQUARE)) {
        snprintf(wrapped, sizeof wrapped, "sqrt(%s)", candidate + strlen(SQUARE));
        snprintf(candidate, sizeof candidate, "%s", wrapped);
    } else if (starts_with(candidate, CUBE)) {
        snprintf(wrapped, sizeof wrapped, "cbrt(%s)", candidate + strlen(CUBE));
        snprintf(candidate, sizeof candidate, "%s", wrapped);
    } else if (starts_with(candidate, FACTORIAL)) {
        snprintf(wrapped, sizeof wrapped, "%s!", candidate + strlen(FACTORIAL));
        snprintf(candidate, sizeof candidate, "%s", wrapped);
    } else if (ends_with(candidate, " squared")) {
        candidate[strlen(candidate) - strlen(" squared")] = '\0';
        snprintf(wrapped, sizeof wrapped, "(%s)^2", candidate);
        snprintf(candidate, sizeof candidate, "%s", wrapped);
    } else if (ends_with(candidate, " cubed")) {
        candidate[strlen(candidate) - strlen(" cubed")] = '\0';
        snprintf(wrapped, sizeof wrapped, "(%s)^3", candidate);
        snprintf(candidate, sizeof candidate, "%s", wrapped);
    }

    replace_all(candidate, sizeof candidate, " to the power of ", "^");
    replace_all(candidate, sizeof candidate, " divided by ", "/");
    replace_all(candidate, sizeof candidate, " multiplied by ", "*");
    replace_all(candidate, sizeof candidate, " times ", "*");
    replace_all(candidate, sizeof candidate, " plus ", "+");
    replace_all(candidate, sizeof candidate, " minus ", "-");
    replace_all(candidate, sizeof candidate, " factorial", "!");
    collapse(candidate);

    if (!*candidate) return 0;

    int has_digit = 0;
    int has_constant = 0;
    for (const char *cursor = candidate; *cursor; cursor++) {
        char ch = *cursor;
        if (isdigit((unsigned char)ch)) has_digit = 1;
        else if (!(isalpha((unsigned char)ch) || strchr("+-*/^%(),!. ", ch))) return 0;
    }
    char probe[BUF];
    snprintf(probe, sizeof probe, "%s", candidate);
    for (char *cursor = probe; *cursor; cursor++) {
        if (!isalpha((unsigned char)*cursor)) continue;
        char *start = cursor;
        while (isalpha((unsigned char)*cursor)) cursor++;
        char saved = *cursor;
        *cursor = '\0';
        if (strcmp(start, "pi") == 0 || strcmp(start, "e") == 0) has_constant = 1;
        *cursor = saved;
        cursor--;
    }
    if (!has_digit && !has_constant) return 0;

    double value = 0;
    if (!evaluate(candidate, &value)) return 0;

    if (!isfinite(value)) {
        snprintf(intent, intent_size, "math-limit");
        snprintf(out, size,
            "That expression does not produce a finite number (for example, division by zero, an invalid function domain or numeric overflow), so I will not present it as a normal result.");
        return 1;
    }

    char shown[64];
    format_number(value, shown, sizeof shown);
    char display[BUF];
    snprintf(display, sizeof display, "%s", candidate);
    replace_all(display, sizeof display, "*", "×");
    int trig = strstr(candidate, "sin(") || strstr(candidate, "cos(") || strstr(candidate, "tan(") ||
        strstr(candidate, "asin(") || strstr(candidate, "acos(") || strstr(candidate, "atan(");
    snprintf(intent, intent_size, "math");
    snprintf(out, size, "**%s**\n\nExpression: %s = %s%s", shown, display, shown,
             trig ? "\n\nTrigonometric functions use radians." : "");
    return 1;
}

static const char *LIVE_WORDS[] = {
    "weather", "news", "stock price", "score", "who won", "latest",
    "headlines", "browse", "search the web", NULL
};

static void answer(const char *prompt, char *intent, size_t intent_size, char *out, size_t size) {
    char text[BUF];
    snprintf(text, sizeof text, "%s", prompt ? prompt : "");
    collapse(text);

    if (!*text) {
        snprintf(intent, intent_size, "empty");
        snprintf(out, size,
            "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, so there is no network round trip.");
        return;
    }

    char lowered[BUF];
    normalize(text, lowered, sizeof lowered);

    if (percent_intent(lowered, out, size)) { snprintf(intent, intent_size, "percent"); return; }
    if (unit_intent(lowered, out, size)) { snprintf(intent, intent_size, "units"); return; }
    if (math_intent(lowered, intent, intent_size, out, size)) return;

    for (int i = 0; LIVE_WORDS[i]; i++) {
        if (strstr(lowered, LIVE_WORDS[i])) {
            snprintf(intent, intent_size, "live");
            snprintf(out, size,
                "I cannot check live information — this engine has no network access, and it will not invent an answer.\n\nSwitch to a connected hosted model for current facts, or paste the source text here and I will help you reason about it.");
            return;
        }
    }

    snprintf(intent, intent_size, "fallback");
    snprintf(out, size,
        "I want to be straight with you: **this is a small on-device engine**, and that question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, code review or live information.");
}

/* --------------------------------------------------------------------------
   conformance runner
   -------------------------------------------------------------------------- */

static int run_vectors(const char *path) {
    FILE *handle = fopen(path, "r");
    if (!handle) {
        fprintf(stderr, "cannot read %s\n", path);
        return 1;
    }

    char line[BUF];
    char intent[32];
    char text[TEXT];
    int failures = 0;
    int checked = 0;
    int number = 0;

    while (fgets(line, sizeof line, handle)) {
        number++;
        size_t length = strlen(line);
        while (length && (line[length - 1] == '\n' || line[length - 1] == '\r')) line[--length] = '\0';
        if (length == 0 || line[0] == '#') continue;

        char *fields[4] = {0};
        int count = 0;
        fields[count++] = line;
        for (char *cursor = line; *cursor && count < 4; cursor++) {
            if (*cursor == '\t') {
                *cursor = '\0';
                fields[count++] = cursor + 1;
            }
        }
        if (count < 3) {
            printf("FAIL line %d: expected at least 3 columns\n", number);
            failures++;
            continue;
        }
        checked++;

        if (strcmp(fields[0], "eval") == 0) {
            double value = 0;
            if (!evaluate(fields[1], &value)) {
                printf("FAIL line %d: '%s' -> error\n", number, fields[1]);
                failures++;
                continue;
            }
            double target = strtod(fields[2], NULL);
            double tolerance = 1e-9 * (fabs(target) > 1 ? fabs(target) : 1);
            if (fabs(value - target) > tolerance) {
                printf("FAIL line %d: '%s' -> %.12g, wanted %.12g\n", number, fields[1], value, target);
                failures++;
            }
            continue;
        }

        answer(fields[1], intent, sizeof intent, text, sizeof text);
        if (strcmp(intent, fields[2]) != 0) {
            printf("FAIL line %d: '%s' -> intent %s, wanted %s\n", number, fields[1], intent, fields[2]);
            failures++;
            continue;
        }
        if (count >= 4 && fields[3][0]) {
            char copy[BUF];
            snprintf(copy, sizeof copy, "%s", fields[3]);
            char *cursor = copy;
            while (cursor && *cursor) {
                char *bar = strchr(cursor, '|');
                if (bar) *bar = '\0';
                if (!strstr(text, cursor)) {
                    printf("FAIL line %d: '%s' -> text missing '%s'\n", number, fields[1], cursor);
                    failures++;
                    break;
                }
                cursor = bar ? bar + 1 : NULL;
            }
        }
    }

    fclose(handle);

    if (failures) {
        printf("%d failure(s) out of %d case(s)\n", failures, checked);
        return 1;
    }
    printf("ok: %d cases\n", checked);
    return 0;
}

int main(int argc, char **argv) {
    const char *path = argc > 1 ? argv[1] : "../vectors.tsv";
    return run_vectors(path);
}
