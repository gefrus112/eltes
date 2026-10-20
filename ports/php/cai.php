<?php
/**
 * Eltes CAI engine — PHP port (standard library only, PHP 8.1+).
 *
 * Arithmetic, percentages, unit and temperature conversion, with an explicit
 * refusal for anything outside those rules. No network, no model weights.
 *
 *     php ports/php/cai.php ports/vectors.tsv
 */

declare(strict_types=1);

const FUNCTIONS = [
    'sqrt' => [1, 1], 'cbrt' => [1, 1], 'abs' => [1, 1],
    'sin' => [1, 1], 'cos' => [1, 1], 'tan' => [1, 1],
    'asin' => [1, 1], 'acos' => [1, 1], 'atan' => [1, 1],
    'ln' => [1, 1], 'log10' => [1, 1], 'log2' => [1, 1], 'exp' => [1, 1],
    'floor' => [1, 1], 'ceil' => [1, 1], 'round' => [1, 1],
    'log' => [1, 2], 'pow' => [2, 2],
    'min' => [1, PHP_INT_MAX], 'max' => [1, PHP_INT_MAX], 'sum' => [1, PHP_INT_MAX],
    'mean' => [1, PHP_INT_MAX], 'product' => [1, PHP_INT_MAX],
];

const PRECEDENCE = ['+' => 1, '-' => 1, '*' => 2, '/' => 2, '%' => 2, '^' => 3];

const UNITS = [
    'mm' => ['length', 0.001], 'cm' => ['length', 0.01], 'm' => ['length', 1.0],
    'metre' => ['length', 1.0], 'metres' => ['length', 1.0], 'meter' => ['length', 1.0],
    'meters' => ['length', 1.0], 'km' => ['length', 1000.0], 'in' => ['length', 0.0254],
    'inch' => ['length', 0.0254], 'inches' => ['length', 0.0254], 'ft' => ['length', 0.3048],
    'feet' => ['length', 0.3048], 'foot' => ['length', 0.3048], 'yd' => ['length', 0.9144],
    'mi' => ['length', 1609.344], 'mile' => ['length', 1609.344], 'miles' => ['length', 1609.344],
    'mg' => ['mass', 0.001], 'g' => ['mass', 1.0], 'kg' => ['mass', 1000.0],
    'oz' => ['mass', 28.349523125], 'lb' => ['mass', 453.59237], 'lbs' => ['mass', 453.59237],
    'pound' => ['mass', 453.59237], 'pounds' => ['mass', 453.59237],
    'stone' => ['mass', 6350.29318], 'st' => ['mass', 6350.29318],
    'ml' => ['volume', 0.001], 'l' => ['volume', 1.0], 'litre' => ['volume', 1.0],
    'litres' => ['volume', 1.0], 'liter' => ['volume', 1.0], 'liters' => ['volume', 1.0],
    'tsp' => ['volume', 0.00492892159], 'tbsp' => ['volume', 0.0147867648],
    'cup' => ['volume', 0.2365882365], 'pint' => ['volume', 0.473176473],
    'qt' => ['volume', 0.946352946], 'quart' => ['volume', 0.946352946],
    'gal' => ['volume', 3.785411784], 'gallon' => ['volume', 3.785411784],
    'gallons' => ['volume', 3.785411784],
    'b' => ['data', 1.0], 'kb' => ['data', 1e3], 'mb' => ['data', 1e6], 'gb' => ['data', 1e9],
    'tb' => ['data', 1e12], 'kib' => ['data', 1024.0], 'mib' => ['data', 1048576.0],
    'gib' => ['data', 1073741824.0],
    'km/h' => ['speed', 0.277777778], 'kph' => ['speed', 0.277777778],
    'mph' => ['speed', 0.44704], 'm/s' => ['speed', 1.0],
    'm2' => ['area', 1.0], 'km2' => ['area', 1e6], 'ft2' => ['area', 0.09290304],
    'sqft' => ['area', 0.09290304], 'acre' => ['area', 4046.8564224],
    'hectare' => ['area', 10000.0], 'ha' => ['area', 10000.0],
];

const PREFIXES = [
    "what's ", 'what is ', 'what is the value of ', 'calculate ', 'compute ',
    'solve ', 'evaluate ', 'how much is ',
];

const LIVE_WORDS = [
    'weather', 'news', 'stock price', 'score', 'who won', 'latest',
    'headlines', 'browse', 'search the web',
];

class CaiParseError extends Exception
{
}

/** @return array{0: string, 1: float, 2: string, 3: string} */
function make_token(string $kind, float $value = 0.0, string $text = '', string $op = ''): array
{
    return [$kind, $value, $text, $op];
}

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

function format_number(float $value): string
{
    if (is_nan($value)) {
        return 'NaN';
    }
    if (is_infinite($value)) {
        return $value > 0 ? 'Infinity' : '-Infinity';
    }

    $magnitude = abs($value);
    if ($magnitude >= 1e12 || ($magnitude > 0 && $magnitude < 1e-8)) {
        $raw = sprintf('%.10e', $value);
        [$mantissa, $exponent] = explode('e', $raw);
        $mantissa = rtrim($mantissa, '0');
        $mantissa = rtrim($mantissa, '.');
        return $mantissa . 'e' . $exponent;
    }

    $rounded = round($value * 1e10) / 1e10;
    if ($rounded == 0) {
        return '0';
    }
    $text = sprintf('%.10f', $rounded);
    $text = rtrim($text, '0');
    $text = rtrim($text, '.');
    return $text === '' ? '0' : $text;
}

// --------------------------------------------------------------------------
// tokenizer
// --------------------------------------------------------------------------

function digit_before(string $text, int $index): bool
{
    for ($cursor = $index - 1; $cursor >= 0; $cursor--) {
        if (ctype_space($text[$cursor])) {
            continue;
        }
        return ctype_digit($text[$cursor]);
    }
    return false;
}

function digit_after(string $text, int $index): bool
{
    $length = strlen($text);
    for ($cursor = $index + 1; $cursor < $length; $cursor++) {
        if (ctype_space($text[$cursor])) {
            continue;
        }
        return ctype_digit($text[$cursor]);
    }
    return false;
}

function prepare(string $source): string
{
    $text = str_replace(
        ['×', '✕', '✖', '÷', '−', '–', '—', '²', '³'],
        ['*', '*', '*', '/', '-', '-', '-', '^2', '^3'],
        $source
    );

    $out = '';
    $length = strlen($text);
    $index = 0;
    // Multibyte symbols were already replaced, so byte-wise scanning is safe here.
    while ($index < $length) {
        $ch = $text[$index];
        if (($ch === 'x' || $ch === 'X') && digit_before($text, $index) && digit_after($text, $index)) {
            $out .= '*';
        } else {
            $out .= $ch;
        }
        $index++;
    }
    return $out;
}

/** @return list<array{0: string, 1: float, 2: string, 3: string}> */
function tokenize(string $source): array
{
    $text = prepare($source);
    $tokens = [];
    $index = 0;
    $length = strlen($text);

    while ($index < $length) {
        $ch = $text[$index];

        if (ctype_space($ch)) {
            $index++;
            continue;
        }

        if (ctype_digit($ch) || ($ch === '.' && $index + 1 < $length && ctype_digit($text[$index + 1]))) {
            $start = $index;
            while ($index < $length && ctype_digit($text[$index])) {
                $index++;
            }
            if ($index < $length && $text[$index] === '.') {
                $index++;
                while ($index < $length && ctype_digit($text[$index])) {
                    $index++;
                }
            }
            if ($index < $length && ($text[$index] === 'e' || $text[$index] === 'E')) {
                $probe = $index + 1;
                if ($probe < $length && ($text[$probe] === '+' || $text[$probe] === '-')) {
                    $probe++;
                }
                if ($probe < $length && ctype_digit($text[$probe])) {
                    while ($probe < $length && ctype_digit($text[$probe])) {
                        $probe++;
                    }
                    $index = $probe;
                }
            }
            $literal = substr($text, $start, $index - $start);
            if (!is_numeric($literal)) {
                throw new CaiParseError('bad number');
            }
            $value = (float) $literal;
            if (is_nan($value) || is_infinite($value)) {
                throw new CaiParseError('bad number');
            }
            $tokens[] = make_token('number', $value);
            continue;
        }

        if (ctype_alpha($ch)) {
            $start = $index;
            while ($index < $length && ctype_alpha($text[$index])) {
                $index++;
            }
            $tokens[] = make_token('ident', 0.0, strtolower(substr($text, $start, $index - $start)));
            continue;
        }

        if (str_contains('+-*/^%!', $ch)) {
            $tokens[] = make_token('op', 0.0, '', $ch);
            $index++;
            continue;
        }
        if ($ch === '(') {
            $tokens[] = make_token('open');
            $index++;
            continue;
        }
        if ($ch === ')') {
            $tokens[] = make_token('close');
            $index++;
            continue;
        }
        if ($ch === ',') {
            $tokens[] = make_token('comma');
            $index++;
            continue;
        }
        throw new CaiParseError('unexpected character');
    }

    $expanded = [];
    foreach ($tokens as $item) {
        $previous = $expanded === [] ? null : $expanded[count($expanded) - 1];
        if ($previous !== null) {
            $ends = $previous[0] === 'number' || $previous[0] === 'close'
                || ($previous[0] === 'ident' && ($previous[2] === 'pi' || $previous[2] === 'e'));
            $starts = $item[0] === 'number' || $item[0] === 'ident' || $item[0] === 'open';
            $isCall = $previous[0] === 'ident' && isset(FUNCTIONS[$previous[2]]) && $item[0] === 'open';
            if ($ends && $starts && !$isCall) {
                $expanded[] = make_token('op', 0.0, '', '*');
            }
        }
        $expanded[] = $item;
    }
    return $expanded;
}

// --------------------------------------------------------------------------
// parser
// --------------------------------------------------------------------------

final class Parser
{
    /** @var list<array{0: string, 1: float, 2: string, 3: string}> */
    private array $tokens;
    private int $position = 0;

    /** @param list<array{0: string, 1: float, 2: string, 3: string}> $tokens */
    public function __construct(array $tokens)
    {
        $this->tokens = $tokens;
    }

    public function parse(): float
    {
        $value = $this->expression(0);
        if ($this->position !== count($this->tokens)) {
            throw new CaiParseError('parse');
        }
        return $value;
    }

    private function has(): bool
    {
        return $this->position < count($this->tokens);
    }

    private function expression(int $minPrecedence): float
    {
        $left = $this->primary();

        while ($this->has() && $this->tokens[$this->position][0] === 'op' && $this->tokens[$this->position][3] === '!') {
            $this->position++;
            $left = self::factorial($left);
        }

        while ($this->has() && $this->tokens[$this->position][0] === 'op') {
            $op = $this->tokens[$this->position][3];
            $precedence = PRECEDENCE[$op] ?? 0;
            if ($precedence === 0 || $precedence < $minPrecedence) {
                break;
            }
            $this->position++;
            $right = $this->expression($op === '^' ? $precedence : $precedence + 1);
            switch ($op) {
                case '+': $left += $right; break;
                case '-': $left -= $right; break;
                case '*': $left *= $right; break;
                case '/': $left /= $right; break;
                case '%': $left = fmod($left, $right); break;
                case '^': $left = $left ** $right; break;
                default: throw new CaiParseError('parse');
            }
        }

        return $left;
    }

    private function primary(): float
    {
        if (!$this->has()) {
            throw new CaiParseError('parse');
        }
        $item = $this->tokens[$this->position];
        $this->position++;

        if ($item[0] === 'number') {
            return $item[1];
        }

        if ($item[0] === 'op' && ($item[3] === '-' || $item[3] === '+')) {
            $value = $this->expression(3);
            return $item[3] === '-' ? -$value : $value;
        }

        if ($item[0] === 'open') {
            $value = $this->expression(0);
            if (!$this->has() || $this->tokens[$this->position][0] !== 'close') {
                throw new CaiParseError('parse');
            }
            $this->position++;
            return $value;
        }

        if ($item[0] === 'ident') {
            if ($this->has() && $this->tokens[$this->position][0] === 'open' && isset(FUNCTIONS[$item[2]])) {
                $this->position++;
                $args = [];
                if ($this->has() && $this->tokens[$this->position][0] !== 'close') {
                    $args[] = $this->expression(0);
                    while ($this->has() && $this->tokens[$this->position][0] === 'comma') {
                        $this->position++;
                        $args[] = $this->expression(0);
                    }
                }
                if (!$this->has() || $this->tokens[$this->position][0] !== 'close') {
                    throw new CaiParseError('parse');
                }
                $this->position++;
                return self::call_function($item[2], $args);
            }
            if ($item[2] === 'pi') {
                return M_PI;
            }
            if ($item[2] === 'e') {
                return M_E;
            }
        }

        throw new CaiParseError('parse');
    }

    private static function factorial(float $value): float
    {
        if ($value < 0 || $value !== floor($value) || $value > 170) {
            throw new CaiParseError('factorial domain');
        }
        $result = 1.0;
        for ($step = 2.0; $step <= $value; $step += 1) {
            $result *= $step;
        }
        return $result;
    }

    /** @param list<float> $args */
    private static function call_function(string $name, array $args): float
    {
        $bounds = FUNCTIONS[$name] ?? null;
        if ($bounds === null) {
            throw new CaiParseError('unknown function');
        }
        if (count($args) < $bounds[0] || count($args) > $bounds[1]) {
            throw new CaiParseError('argument count');
        }

        switch ($name) {
            case 'sqrt': return sqrt($args[0]);
            case 'cbrt': return $args[0] < 0 ? -((-$args[0]) ** (1 / 3)) : $args[0] ** (1 / 3);
            case 'abs': return abs($args[0]);
            case 'sin': return sin($args[0]);
            case 'cos': return cos($args[0]);
            case 'tan': return tan($args[0]);
            case 'asin': return asin($args[0]);
            case 'acos': return acos($args[0]);
            case 'atan': return atan($args[0]);
            case 'ln': return log($args[0]);
            case 'log10': return log10($args[0]);
            case 'log2': return log($args[0], 2);
            case 'exp': return exp($args[0]);
            case 'floor': return floor($args[0]);
            case 'ceil': return ceil($args[0]);
            case 'round': return round($args[0]);
            case 'log': return count($args) === 1 ? log($args[0]) : log($args[0], $args[1]);
            case 'pow': return $args[0] ** $args[1];
            case 'min': return min($args);
            case 'max': return max($args);
            case 'sum': return array_sum($args);
            case 'mean': return array_sum($args) / count($args);
            case 'product': return array_product($args);
        }
        throw new CaiParseError('unknown function');
    }
}

function evaluate(string $source): float
{
    $tokens = tokenize($source);
    if ($tokens === []) {
        throw new CaiParseError('parse');
    }
    return (new Parser($tokens))->parse();
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

function temperature_convert(float $value, string $from, string $to): float
{
    $celsius = $from === 'c' ? $value : ($from === 'f' ? ($value - 32) * 5 / 9 : $value - 273.15);
    if ($to === 'c') {
        return $celsius;
    }
    if ($to === 'f') {
        return $celsius * 9 / 5 + 32;
    }
    return $celsius + 273.15;
}

// --------------------------------------------------------------------------
// intents
// --------------------------------------------------------------------------

function normalize(string $text): string
{
    $lowered = strtolower($text);
    $lowered = str_replace(['’', '‘'], "'", $lowered);
    $lowered = str_replace(['−', '–', '—'], '-', $lowered);
    $lowered = str_replace(['²', '³'], ['^2', '^3'], $lowered);
    $words = preg_split('/\s+/', trim($lowered)) ?: [];
    return implode(' ', $words);
}

function is_number_word(?string $word): bool
{
    if ($word === null || $word === '') {
        return false;
    }
    if (preg_match('/^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$/', $word) !== 1) {
        return false;
    }
    return is_numeric($word);
}

/** @return array{0: float, 1: string}|null */
function split_number(string $word): ?array
{
    if (preg_match('/^([+-]?[0-9]*\.?[0-9]+)(.*)$/s', $word, $match) !== 1) {
        return null;
    }
    return [(float) $match[1], $match[2]];
}

function percent_intent(string $text): ?string
{
    $words = preg_split('/\s+/', trim(str_replace('%', ' percent ', $text))) ?: [];
    $count = count($words);

    for ($index = 0; $index + 3 < $count; $index++) {
        if ($words[$index + 1] !== 'percent') {
            continue;
        }
        if ($words[$index + 2] !== 'of' && $words[$index + 2] !== 'off') {
            continue;
        }
        if (!is_number_word($words[$index]) || !is_number_word($words[$index + 3])) {
            continue;
        }

        $percent = (float) $words[$index];
        $base = (float) $words[$index + 3];
        $part = $percent / 100 * $base;

        if ($words[$index + 2] === 'off') {
            return '**' . format_number($base - $part) . '** after ' . format_number($percent)
                . '% off ' . format_number($base) . ' (a discount of ' . format_number($part) . ').';
        }
        return '**' . format_number($part) . '** — ' . format_number($percent) . '% of '
            . format_number($base) . ".\n\n" . format_number($base) . ' × '
            . format_number($percent) . ' / 100 = ' . format_number($part);
    }

    if (preg_match('/percent|increase|decrease|change/', $text) === 1) {
        for ($index = 0; $index + 3 < $count; $index++) {
            if ($words[$index] !== 'from' || $words[$index + 2] !== 'to') {
                continue;
            }
            if (!is_number_word($words[$index + 1]) || !is_number_word($words[$index + 3])) {
                continue;
            }
            $start = (float) $words[$index + 1];
            $end = (float) $words[$index + 3];
            if ($start == 0.0) {
                return 'Percentage change from zero is undefined because the calculation divides by '
                    . 'the starting value. I will not report a finite percentage.';
            }
            $change = ($end - $start) / abs($start) * 100;
            return '**' . format_number($change) . '%** change from ' . format_number($start)
                . ' to ' . format_number($end) . ".\n\nFormula: (" . format_number($end)
                . ' − ' . format_number($start) . ') ÷ |' . format_number($start) . '| × 100';
        }
    }

    return null;
}

function unit_intent(string $text): ?string
{
    $prepared = str_replace(
        ['°', 'degrees', 'degree', 'celsius', 'centigrade', 'fahrenheit', 'kelvin'],
        [' ', ' ', ' ', ' c ', ' c ', ' f ', ' k '],
        $text
    );
    $words = preg_split('/\s+/', trim($prepared)) ?: [];
    $count = count($words);

    for ($index = 0; $index < $count; $index++) {
        $split = split_number($words[$index]);
        if ($split === null) {
            continue;
        }
        $value = $split[0];
        $remainder = $split[1];

        if ($remainder === '') {
            if ($index + 1 >= $count) {
                continue;
            }
            $source = $words[$index + 1];
            $cursor = $index + 2;
        } else {
            $source = $remainder;
            $cursor = $index + 1;
        }
        if ($cursor + 1 >= $count) {
            continue;
        }
        $connector = $words[$cursor];
        if (!in_array($connector, ['to', 'in', 'into', 'as'], true)) {
            continue;
        }
        $target = $words[$cursor + 1];

        if (strlen($source) === 1 && strlen($target) === 1
            && str_contains('cfk', $source) && str_contains('cfk', $target)) {
            if ($source === $target) {
                return format_number($value) . ' °' . strtoupper($source) . ' is the same in °'
                    . strtoupper($target) . '.';
            }
            $converted = temperature_convert($value, $source, $target);
            return '**' . format_number($converted) . ' °' . strtoupper($target) . "**\n\n`"
                . format_number($value) . ' °' . strtoupper($source) . ' → '
                . format_number($converted) . ' °' . strtoupper($target) . '`';
        }

        $from = UNITS[$source] ?? null;
        $to = UNITS[$target] ?? null;
        if ($from === null || $to === null || $from[0] !== $to[0]) {
            continue;
        }

        $converted = $value * $from[1] / $to[1];
        $note = $from[0] === 'data'
            ? 'Using decimal units (1 KB = 1,000 bytes).'
            : 'Exact conversion factors.';
        return '**' . format_number($converted) . ' ' . $target . "**\n\n`"
            . format_number($value) . ' ' . $source . ' = ' . format_number($converted) . ' '
            . $target . "`\n\n" . $note;
    }

    return null;
}

/** @return array{0: string, 1: string}|null */
function math_intent(string $text): ?array
{
    $candidate = $text;
    foreach (PREFIXES as $prefix) {
        if (str_starts_with($candidate, $prefix)) {
            $candidate = substr($candidate, strlen($prefix));
            break;
        }
    }
    $candidate = trim($candidate);
    $candidate = rtrim($candidate, '?=');
    $candidate = trim($candidate);

    if (str_starts_with($candidate, 'the ')) {
        $candidate = substr($candidate, 4);
    }

    if (str_starts_with($candidate, 'square root of ')) {
        $candidate = 'sqrt(' . substr($candidate, strlen('square root of ')) . ')';
    } elseif (str_starts_with($candidate, 'cube root of ')) {
        $candidate = 'cbrt(' . substr($candidate, strlen('cube root of ')) . ')';
    } elseif (str_starts_with($candidate, 'factorial of ')) {
        $candidate = substr($candidate, strlen('factorial of ')) . '!';
    } elseif (str_ends_with($candidate, ' squared')) {
        $candidate = '(' . substr($candidate, 0, -strlen(' squared')) . ')^2';
    } elseif (str_ends_with($candidate, ' cubed')) {
        $candidate = '(' . substr($candidate, 0, -strlen(' cubed')) . ')^3';
    }

    $padded = ' ' . $candidate . ' ';
    $padded = str_replace(' to the power of ', '^', $padded);
    $padded = str_replace(' divided by ', '/', $padded);
    $padded = str_replace(' multiplied by ', '*', $padded);
    $padded = str_replace(' times ', '*', $padded);
    $padded = str_replace(' plus ', '+', $padded);
    $padded = str_replace(' minus ', '-', $padded);
    $padded = str_replace(' factorial', '!', $padded);
    $candidate = trim($padded);

    if ($candidate === '') {
        return null;
    }
    if (preg_match('/^[a-zA-Z0-9+\-*\/^%(),!. ]+$/', $candidate) !== 1) {
        return null;
    }

    $hasDigit = preg_match('/[0-9]/', $candidate) === 1;
    $parts = preg_split('/[^a-zA-Z]+/', $candidate) ?: [];
    $hasConstant = in_array('pi', $parts, true) || in_array('e', $parts, true);
    if (!$hasDigit && !$hasConstant) {
        return null;
    }

    try {
        $value = evaluate($candidate);
    } catch (CaiParseError $error) {
        return null;
    }

    if (is_nan($value) || is_infinite($value)) {
        return ['math-limit', 'That expression does not produce a finite number (for example, division by '
            . 'zero, an invalid function domain or numeric overflow), so I will not present it as a '
            . 'normal result.'];
    }

    $shown = format_number($value);
    $display = str_replace('*', '×', $candidate);
    $trig = preg_match('/sin\(|cos\(|tan\(|asin\(|acos\(|atan\(/', $candidate) === 1;
    return ['math', '**' . $shown . "**\n\nExpression: " . $display . ' = ' . $shown
        . ($trig ? "\n\nTrigonometric functions use radians." : '')];
}

/** @return array{0: string, 1: string} */
function answer(string $prompt): array
{
    $text = trim($prompt);
    if ($text === '') {
        return ['empty', 'Ask me for arithmetic, percentages or a unit conversion. I answer on this '
            . 'device, so there is no network round trip.'];
    }

    $lowered = normalize($text);

    $percent = percent_intent($lowered);
    if ($percent !== null) {
        return ['percent', $percent];
    }

    $units = unit_intent($lowered);
    if ($units !== null) {
        return ['units', $units];
    }

    $math = math_intent($lowered);
    if ($math !== null) {
        return $math;
    }

    foreach (LIVE_WORDS as $word) {
        if (str_contains($lowered, $word)) {
            return ['live', 'I cannot check live information — this engine has no network access, and '
                . "it will not invent an answer.\n\nSwitch to a connected hosted model for current "
                . 'facts, or paste the source text here and I will help you reason about it.'];
        }
    }

    return ['fallback', 'I want to be straight with you: **this is a small on-device engine**, and '
        . "that question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic "
        . "and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for "
        . 'open-ended writing, code review or live information.'];
}

// --------------------------------------------------------------------------
// conformance runner
// --------------------------------------------------------------------------

function run_vectors(string $path): int
{
    $handle = @fopen($path, 'rb');
    if ($handle === false) {
        fwrite(STDERR, "cannot read {$path}\n");
        return 1;
    }

    $failures = [];
    $checked = 0;
    $number = 0;

    while (($line = fgets($handle)) !== false) {
        $number++;
        $line = rtrim($line, "\r\n");
        if (trim($line) === '' || str_starts_with($line, '#')) {
            continue;
        }
        $fields = explode("\t", $line);
        if (count($fields) < 3) {
            $failures[] = "line {$number}: expected at least 3 columns";
            continue;
        }
        $checked++;

        if ($fields[0] === 'eval') {
            try {
                $value = evaluate($fields[1]);
            } catch (CaiParseError $error) {
                $failures[] = "line {$number}: '{$fields[1]}' -> error";
                continue;
            }
            $expected = (float) $fields[2];
            $tolerance = 1e-9 * max(1.0, abs($expected));
            if (abs($value - $expected) > $tolerance) {
                $failures[] = "line {$number}: '{$fields[1]}' -> {$value}, wanted {$fields[2]}";
            }
            continue;
        }

        [$intent, $text] = answer($fields[1]);
        if ($intent !== $fields[2]) {
            $failures[] = "line {$number}: '{$fields[1]}' -> intent {$intent}, wanted {$fields[2]}";
            continue;
        }
        $fragments = array_filter(explode('|', $fields[3] ?? ''), static fn (string $part): bool => $part !== '');
        foreach ($fragments as $fragment) {
            if (!str_contains($text, $fragment)) {
                $failures[] = "line {$number}: '{$fields[1]}' -> text missing '{$fragment}'";
                break;
            }
        }
    }

    fclose($handle);

    if ($failures !== []) {
        foreach ($failures as $failure) {
            echo "FAIL {$failure}\n";
        }
        echo count($failures) . ' failure(s) out of ' . $checked . " case(s)\n";
        return 1;
    }

    echo "ok: {$checked} cases\n";
    return 0;
}

$target = $argv[1] ?? __DIR__ . '/../vectors.tsv';
exit(run_vectors($target));
