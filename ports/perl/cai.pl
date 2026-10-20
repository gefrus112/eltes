#!/usr/bin/env perl
# ==========================================================================
# Eltes CAI engine — Perl port.
#
# Arithmetic, percentages, unit and temperature conversion, and an explicit
# refusal for anything outside those rules. Standard library only.
#
#   perl ports/perl/cai.pl ports/vectors.tsv
# ==========================================================================
use strict;
use warnings;
use utf8;
use POSIX qw(fmod);
use File::Basename qw(dirname);

binmode(STDOUT, ':encoding(UTF-8)');
binmode(STDERR, ':encoding(UTF-8)');

my %FUNCTIONS = (
    sqrt => [1, 1], cbrt => [1, 1], abs => [1, 1],
    sin => [1, 1], cos => [1, 1], tan => [1, 1],
    asin => [1, 1], acos => [1, 1], atan => [1, 1],
    ln => [1, 1], log10 => [1, 1], log2 => [1, 1], exp => [1, 1],
    floor => [1, 1], ceil => [1, 1], round => [1, 1],
    log => [1, 2], pow => [2, 2],
    min => [1, 1e9], max => [1, 1e9], sum => [1, 1e9],
    mean => [1, 1e9], product => [1, 1e9],
);

my %PRECEDENCE = ('+' => 1, '-' => 1, '*' => 2, '/' => 2, '%' => 2, '^' => 3);

# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

sub prepare {
    my ($source) = @_;
    my $text = $source;
    $text =~ s/[×✕✖]/*/g;
    $text =~ s/÷/\//g;
    $text =~ s/[−–—]/-/g;
    $text =~ s/²/^2/g;
    $text =~ s/³/^3/g;

    my @chars = split //, $text;
    my $out = '';
    for my $index (0 .. $#chars) {
        my $ch = $chars[$index];
        if (($ch eq 'x' || $ch eq 'X') && _digit_before(\@chars, $index) && _digit_after(\@chars, $index)) {
            $out .= '*';
        } else {
            $out .= $ch;
        }
    }
    return $out;
}

sub _digit_before {
    my ($chars, $index) = @_;
    for (my $cursor = $index - 1; $cursor >= 0; $cursor--) {
        next if $chars->[$cursor] =~ /\s/;
        return $chars->[$cursor] =~ /[0-9]/ ? 1 : 0;
    }
    return 0;
}

sub _digit_after {
    my ($chars, $index) = @_;
    for (my $cursor = $index + 1; $cursor < scalar(@$chars); $cursor++) {
        next if $chars->[$cursor] =~ /\s/;
        return $chars->[$cursor] =~ /[0-9]/ ? 1 : 0;
    }
    return 0;
}

sub tokenize {
    my ($source) = @_;
    my $text = prepare($source);
    my @tokens;
    my $index = 0;

    while ($index < length($text)) {
        my $ch = substr($text, $index, 1);

        if ($ch =~ /\s/) { $index++; next; }

        if ($ch =~ /[0-9]/ || ($ch eq '.' && substr($text, $index + 1, 1) =~ /[0-9]/)) {
            my $start = $index;
            $index++ while $index < length($text) && substr($text, $index, 1) =~ /[0-9]/;
            if (substr($text, $index, 1) eq '.') {
                $index++;
                $index++ while $index < length($text) && substr($text, $index, 1) =~ /[0-9]/;
            }
            if (substr($text, $index, 1) eq 'e' || substr($text, $index, 1) eq 'E') {
                my $probe = $index + 1;
                my $sign = substr($text, $probe, 1);
                $probe++ if $sign eq '+' || $sign eq '-';
                if (substr($text, $probe, 1) =~ /[0-9]/) {
                    $probe++ while $probe < length($text) && substr($text, $probe, 1) =~ /[0-9]/;
                    $index = $probe;
                }
            }
            my $literal = substr($text, $start, $index - $start);
            die "bad number\n" unless $literal =~ /^[0-9.eE+-]+$/;
            my $value = 0 + $literal;
            die "bad number\n" unless $value == $value && abs($value) != 9**9**9;
            push @tokens, { type => 'num', value => $value };
            next;
        }

        if ($ch =~ /[a-zA-Z]/) {
            my $start = $index;
            $index++ while $index < length($text) && substr($text, $index, 1) =~ /[a-zA-Z]/;
            push @tokens, { type => 'ident', value => lc(substr($text, $start, $index - $start)) };
            next;
        }

        if (index('+-*/^%!', $ch) >= 0) { push @tokens, { type => 'op', value => $ch }; $index++; next; }
        if ($ch eq '(') { push @tokens, { type => '(' }; $index++; next; }
        if ($ch eq ')') { push @tokens, { type => ')' }; $index++; next; }
        if ($ch eq ',') { push @tokens, { type => ',' }; $index++; next; }
        die "unexpected character\n";
    }

    my @expanded;
    for my $token (@tokens) {
        if (@expanded) {
            my $previous = $expanded[-1];
            my $ends = $previous->{type} eq 'num'
                || $previous->{type} eq ')'
                || ($previous->{type} eq 'ident' && ($previous->{value} eq 'pi' || $previous->{value} eq 'e'));
            my $starts = $token->{type} eq 'num' || $token->{type} eq 'ident' || $token->{type} eq '(';
            my $is_call = $previous->{type} eq 'ident'
                && exists $FUNCTIONS{ $previous->{value} }
                && $token->{type} eq '(';
            push @expanded, { type => 'op', value => '*' } if $ends && $starts && !$is_call;
        }
        push @expanded, $token;
    }
    return \@expanded;
}

# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

my @TOKENS;
my $POS;

sub factorial {
    my ($value) = @_;
    die "factorial domain\n" if $value < 0 || $value != int($value) || $value > 170;
    my $result = 1;
    my $step = 2;
    while ($step <= $value) { $result *= $step; $step++; }
    return $result;
}

sub call_function {
    my ($name, $args) = @_;
    my ($low, $high) = @{ $FUNCTIONS{$name} };
    die "argument count\n" if @$args < $low || @$args > $high;
    my $first = $args->[0];

    return sqrt($first) if $name eq 'sqrt';
    return _cbrt($first) if $name eq 'cbrt';
    return abs($first) if $name eq 'abs';
    return sin($first) if $name eq 'sin';
    return cos($first) if $name eq 'cos';
    return tan($first) if $name eq 'tan';
    return asin($first) if $name eq 'asin';
    return acos($first) if $name eq 'acos';
    return atan($first) if $name eq 'atan';
    return $first > 0 ? log($first) : (0 + 'nan') if $name eq 'ln';
    return $first > 0 ? log($first) / log(10) : (0 + 'nan') if $name eq 'log10';
    return $first > 0 ? log($first) / log(2) : (0 + 'nan') if $name eq 'log2';
    return exp($first) > 1e308 ? (0 + 'inf') : exp($first) if $name eq 'exp';
    return int($first == int($first) ? $first : ($first < 0 ? int($first) - 1 : int($first))) if $name eq 'floor';
    return int($first == int($first) ? $first : ($first < 0 ? int($first) : int($first) + 1)) if $name eq 'ceil';
    return int($first + ($first < 0 ? -0.5 : 0.5)) if $name eq 'round';
    if ($name eq 'log') {
        return log($first) if @$args == 1;
        return log($first) / log($args->[1]);
    }
    if ($name eq 'pow') { return $first ** $args->[1]; }
    if ($name eq 'min') {
        my $m = $first;
        for my $value (@$args) { $m = $value if $value < $m; }
        return $m;
    }
    if ($name eq 'max') {
        my $m = $first;
        for my $value (@$args) { $m = $value if $value > $m; }
        return $m;
    }
    if ($name eq 'sum') { my $t = 0; $t += $_ for @$args; return $t; }
    if ($name eq 'mean') { my $t = 0; $t += $_ for @$args; return $t / @$args; }
    if ($name eq 'product') { my $t = 1; $t *= $_ for @$args; return $t; }
    die "unknown function\n";
}

sub _cbrt {
    my ($value) = @_;
    return $value < 0 ? -((-$value) ** (1 / 3)) : $value ** (1 / 3);
}

sub primary {
    die "parse\n" if $POS > $#TOKENS;
    my $token = $TOKENS[$POS];

    if ($token->{type} eq 'num') { $POS++; return $token->{value}; }

    if ($token->{type} eq 'op' && ($token->{value} eq '-' || $token->{value} eq '+')) {
        $POS++;
        my $value = expression(3);
        return $token->{value} eq '-' ? -$value : $value;
    }

    if ($token->{type} eq '(') {
        $POS++;
        my $value = expression(0);
        die "parse\n" if !defined $TOKENS[$POS] || $TOKENS[$POS]{type} ne ')';
        $POS++;
        return $value;
    }

    if ($token->{type} eq 'ident') {
        $POS++;
        if (defined $TOKENS[$POS] && $TOKENS[$POS]{type} eq '(' && exists $FUNCTIONS{ $token->{value} }) {
            $POS++;
            my @args;
            if (!defined $TOKENS[$POS] || $TOKENS[$POS]{type} ne ')') {
                push @args, expression(0);
                while (defined $TOKENS[$POS] && $TOKENS[$POS]{type} eq ',') {
                    $POS++;
                    push @args, expression(0);
                }
            }
            die "parse\n" if !defined $TOKENS[$POS] || $TOKENS[$POS]{type} ne ')';
            $POS++;
            return call_function($token->{value}, \@args);
        }
        return 3.141592653589793 if $token->{value} eq 'pi';
        return 2.718281828459045 if $token->{value} eq 'e';
    }

    die "parse\n";
}

sub expression {
    my ($min_precedence) = @_;
    my $left = primary();

    while (defined $TOKENS[$POS] && $TOKENS[$POS]{type} eq 'op' && $TOKENS[$POS]{value} eq '!') {
        $POS++;
        $left = factorial($left);
    }

    while (1) {
        my $token = $TOKENS[$POS];
        last if !defined $token || $token->{type} ne 'op';
        my $op = $token->{value};
        last unless exists $PRECEDENCE{$op};
        my $precedence = $PRECEDENCE{$op};
        last if $precedence < $min_precedence;
        $POS++;
        my $right = expression($op eq '^' ? $precedence : $precedence + 1);
        if    ($op eq '+') { $left += $right; }
        elsif ($op eq '-') { $left -= $right; }
        elsif ($op eq '*') { $left *= $right; }
        elsif ($op eq '/') { $left = $right == 0 ? 0 + 'inf' : $left / $right; }
        elsif ($op eq '%') { $left = $right == 0 ? 0 + 'nan' : fmod($left, $right); }
        else               { $left = $left ** $right; }
    }

    return $left;
}

sub evaluate {
    my ($source) = @_;
    my $tokens = tokenize($source);
    die "parse\n" unless @$tokens;
    @TOKENS = @$tokens;
    $POS = 0;
    my $value = expression(0);
    die "parse\n" if $POS != scalar(@TOKENS);
    return $value;
}

# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------

sub format_number {
    my ($value) = @_;
    return 'NaN' if $value != $value;
    return 'Infinity' if $value == 9**9**9;
    return '-Infinity' if $value == -(9**9**9);

    my $magnitude = abs($value);
    if ($magnitude >= 1e12 || ($magnitude > 0 && $magnitude < 1e-8)) {
        my $raw = sprintf('%.10e', $value);
        my ($mantissa, $exponent) = split /e/, $raw;
        $mantissa =~ s/0+$//;
        $mantissa =~ s/\.$//;
        my $sign = $exponent < 0 ? '-' : '+';
        my $absolute = abs($exponent);
        return "${mantissa}e${sign}${absolute}";
    }

    my $rounded = int($value * 1e10 + ($value >= 0 ? 0.5 : -0.5)) / 1e10;
    return '0' if $rounded == 0;
    my $text = sprintf('%.10f', $rounded);
    $text =~ s/0+$//;
    $text =~ s/\.$//;
    return $text;
}

# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

my %UNITS = (
    mm => ['length', 0.001], cm => ['length', 0.01], m => ['length', 1],
    metre => ['length', 1], metres => ['length', 1], meter => ['length', 1], meters => ['length', 1],
    km => ['length', 1000], in => ['length', 0.0254], inch => ['length', 0.0254], inches => ['length', 0.0254],
    ft => ['length', 0.3048], feet => ['length', 0.3048], foot => ['length', 0.3048], yd => ['length', 0.9144],
    mi => ['length', 1609.344], mile => ['length', 1609.344], miles => ['length', 1609.344],
    mg => ['mass', 0.001], g => ['mass', 1], kg => ['mass', 1000],
    oz => ['mass', 28.349523125], lb => ['mass', 453.59237], lbs => ['mass', 453.59237],
    pound => ['mass', 453.59237], pounds => ['mass', 453.59237],
    stone => ['mass', 6350.29318], st => ['mass', 6350.29318],
    ml => ['volume', 0.001], l => ['volume', 1], litre => ['volume', 1], litres => ['volume', 1],
    liter => ['volume', 1], liters => ['volume', 1],
    tsp => ['volume', 0.00492892159], tbsp => ['volume', 0.0147867648],
    cup => ['volume', 0.2365882365], pint => ['volume', 0.473176473],
    qt => ['volume', 0.946352946], quart => ['volume', 0.946352946],
    gal => ['volume', 3.785411784], gallon => ['volume', 3.785411784], gallons => ['volume', 3.785411784],
    b => ['data', 1], kb => ['data', 1e3], mb => ['data', 1e6], gb => ['data', 1e9], tb => ['data', 1e12],
    kib => ['data', 1024], mib => ['data', 1048576], gib => ['data', 1073741824],
    'km/h' => ['speed', 0.277777778], kph => ['speed', 0.277777778],
    mph => ['speed', 0.44704], 'm/s' => ['speed', 1],
    m2 => ['area', 1], km2 => ['area', 1e6], ft2 => ['area', 0.09290304], sqft => ['area', 0.09290304],
    acre => ['area', 4046.8564224], hectare => ['area', 10000], ha => ['area', 10000],
);

sub temperature {
    my ($value, $from, $to) = @_;
    my $celsius = $from eq 'c' ? $value : $from eq 'f' ? ($value - 32) * 5 / 9 : $value - 273.15;
    return $celsius if $to eq 'c';
    return $celsius * 9 / 5 + 32 if $to eq 'f';
    return $celsius + 273.15;
}

# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

sub normalize {
    my ($text) = @_;
    my $lowered = lc $text;
    $lowered =~ s/[’‘]/'/g;
    $lowered =~ s/[−–—]/-/g;
    $lowered =~ s/²/^2/g;
    $lowered =~ s/³/^3/g;
    $lowered =~ s/^\s+|\s+$//g;
    $lowered =~ s/\s+/ /g;
    return $lowered;
}

sub percent_intent {
    my ($text) = @_;
    my $expanded = $text;
    $expanded =~ s/%/ percent /g;
    my @words = split /\s+/, $expanded;

    for my $index (0 .. $#words - 3) {
        next unless $words[ $index + 1 ] eq 'percent';
        next unless $words[ $index + 2 ] eq 'of' || $words[ $index + 2 ] eq 'off';
        next unless _is_number($words[$index]) && _is_number($words[ $index + 3 ]);
        my $percent = 0 + $words[$index];
        my $base = 0 + $words[ $index + 3 ];
        my $part = $percent / 100 * $base;
        if ($words[ $index + 2 ] eq 'off') {
            return '**' . format_number($base - $part) . '** after ' . format_number($percent)
                . '% off ' . format_number($base) . ' (a discount of ' . format_number($part) . ').';
        }
        return '**' . format_number($part) . '** — ' . format_number($percent) . '% of '
            . format_number($base) . ".\n\n" . format_number($base) . ' × '
            . format_number($percent) . ' / 100 = ' . format_number($part);
    }

    if ($text =~ /percent|increase|decrease|change/) {
        for my $index (0 .. $#words - 3) {
            next unless $words[$index] eq 'from' && $words[ $index + 2 ] eq 'to';
            next unless _is_number($words[ $index + 1 ]) && _is_number($words[ $index + 3 ]);
            my $start = 0 + $words[ $index + 1 ];
            my $end = 0 + $words[ $index + 3 ];
            if ($start == 0) {
                return 'Percentage change from zero is undefined because the calculation divides by the starting value. I will not report a finite percentage.';
            }
            my $change = ($end - $start) / abs($start) * 100;
            return '**' . format_number($change) . '%** change from ' . format_number($start)
                . ' to ' . format_number($end) . "\n\nFormula: (" . format_number($end)
                . ' − ' . format_number($start) . ') ÷ |' . format_number($start) . '| × 100';
        }
    }

    return undef;
}

sub _is_number {
    my ($word) = @_;
    return defined $word && $word =~ /^[+-]?[0-9]*\.?[0-9]+$/;
}

sub split_number {
    my ($word) = @_;
    return undef unless $word =~ /^([+-]?[0-9]*\.?[0-9]+)(.*)$/s;
    return (0 + $1, $2);
}

sub unit_intent {
    my ($text) = @_;
    my $prepared = $text;
    $prepared =~ s/°/ /g;
    $prepared =~ s/degrees/ /g;
    $prepared =~ s/degree/ /g;
    $prepared =~ s/celsius/ c /g;
    $prepared =~ s/centigrade/ c /g;
    $prepared =~ s/fahrenheit/ f /g;
    $prepared =~ s/kelvin/ k /g;
    my @words = split /\s+/, $prepared;

    for my $index (0 .. $#words) {
        my ($value, $remainder) = split_number($words[$index]);
        next unless defined $value;

        my ($source, $cursor);
        if ($remainder !~ /\S/) {
            next if $index + 1 > $#words;
            $source = $words[ $index + 1 ];
            $cursor = $index + 2;
        } else {
            $source = $remainder;
            $cursor = $index + 1;
        }
        next if $cursor + 1 > $#words;
        my $connector = $words[$cursor];
        next unless $connector eq 'to' || $connector eq 'in' || $connector eq 'into' || $connector eq 'as';
        my $target = $words[ $cursor + 1 ];

        if (length($source) == 1 && length($target) == 1
            && $source =~ /^[cfk]$/ && $target =~ /^[cfk]$/) {
            if ($source eq $target) {
                return format_number($value) . ' °' . uc($source) . ' is the same in °' . uc($target) . '.';
            }
            my $converted = temperature($value, $source, $target);
            return '**' . format_number($converted) . ' °' . uc($target) . "**\n\n`"
                . format_number($value) . ' °' . uc($source) . ' → '
                . format_number($converted) . ' °' . uc($target) . '`';
        }

        next unless exists $UNITS{$source} && exists $UNITS{$target};
        my ($kind, $factor) = @{ $UNITS{$source} };
        my ($target_kind, $target_factor) = @{ $UNITS{$target} };
        next unless $kind eq $target_kind;

        my $converted = $value * $factor / $target_factor;
        my $shown = format_number($converted);
        my $note = $kind eq 'data'
            ? 'Using decimal units (1 KB = 1,000 bytes).'
            : 'Exact conversion factors.';
        return "**${shown} ${target}**\n\n`" . format_number($value) . " ${source} = ${shown} ${target}`\n\n${note}";
    }

    return undef;
}

my @PREFIXES = (
    "what's ", 'what is ', 'what is the value of ', 'calculate ', 'compute ',
    'solve ', 'evaluate ', 'how much is ',
);

sub math_intent {
    my ($text) = @_;
    my $candidate = $text;
    for my $prefix (@PREFIXES) {
        if (index($candidate, $prefix) == 0) {
            $candidate = substr($candidate, length($prefix));
            last;
        }
    }
    $candidate =~ s/^\s+|\s+$//g;
    $candidate =~ s/[?=]+$//;
    $candidate =~ s/^\s+|\s+$//g;

    $candidate = substr($candidate, 4) if index($candidate, 'the ') == 0;
    if (index($candidate, 'square root of ') == 0) {
        $candidate = 'sqrt(' . substr($candidate, length('square root of ')) . ')';
    } elsif (index($candidate, 'cube root of ') == 0) {
        $candidate = 'cbrt(' . substr($candidate, length('cube root of ')) . ')';
    } elsif (index($candidate, 'factorial of ') == 0) {
        $candidate = substr($candidate, length('factorial of ')) . '!';
    } elsif ($candidate =~ /^(.*) squared$/s) {
        $candidate = "($1)^2";
    } elsif ($candidate =~ /^(.*) cubed$/s) {
        $candidate = "($1)^3";
    }

    my $padded = " $candidate ";
    $padded =~ s/ to the power of /^/g;
    $padded =~ s/ divided by /\//g;
    $padded =~ s/ multiplied by /\*/g;
    $padded =~ s/ times /\*/g;
    $padded =~ s/ plus /+/g;
    $padded =~ s/ minus /-/g;
    $padded =~ s/ factorial/!/g;
    $padded =~ s/^\s+|\s+$//g;

    return undef unless length $padded;
    return undef if $padded =~ /[^a-zA-Z0-9+\-*\/^%(),!. ]/;
    my $has_digit = $padded =~ /[0-9]/ ? 1 : 0;
    my @words = split /[^a-zA-Z]+/, $padded;
    my $has_constant = grep { $_ eq 'pi' || $_ eq 'e' } @words;
    return undef unless $has_digit || $has_constant;

    my $value = eval { evaluate($padded) };
    return undef if $@;

    if ($value != $value || $value == 9**9**9 || $value == -(9**9**9)) {
        return 'math-limit',
            'That expression does not produce a finite number (for example, division by zero, an invalid function domain or numeric overflow), so I will not present it as a normal result.';
    }

    my $shown = format_number($value);
    my $display = $padded;
    $display =~ s/\*/×/g;
    my $note = $padded =~ /(sin|cos|tan|asin|acos|atan)\(/ ? "\n\nTrigonometric functions use radians." : '';
    return 'math', "**${shown}**\n\nExpression: ${display} = ${shown}${note}";
}

my @LIVE = ('weather', 'news', 'stock price', 'score', 'who won', 'latest', 'headlines', 'browse', 'search the web');

sub answer {
    my ($prompt) = @_;
    my $text = defined $prompt ? $prompt : '';
    $text =~ s/^\s+|\s+$//g;
    if (!length $text) {
        return 'empty',
            'Ask me for arithmetic, percentages or a unit conversion. I answer on this device, so there is no network round trip.';
    }

    my $lowered = normalize($text);

    my $percent = percent_intent($lowered);
    return ('percent', $percent) if defined $percent;

    my $units = unit_intent($lowered);
    return ('units', $units) if defined $units;

    my ($math_intent, $math_text) = math_intent($lowered);
    return ($math_intent, $math_text) if defined $math_intent;

    for my $word (@LIVE) {
        if (index($lowered, $word) >= 0) {
            return 'live',
                'I cannot check live information — this engine has no network access, and it will not invent an answer.

Switch to a connected hosted model for current facts, or paste the source text here and I will help you reason about it.';
        }
    }

    return 'fallback',
        'I want to be straight with you: **this is a small on-device engine**, and that question is outside what it can answer reliably.

It is solid on:

- arithmetic and percentages
- unit and temperature conversions

Switch to a hosted model for open-ended writing, code review or live information.';
}

# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

sub run_vectors {
    my ($path) = @_;
    open my $handle, '<:encoding(UTF-8)', $path or die "cannot read $path: $!\n";

    my @failures;
    my $checked = 0;
    my $number  = 0;

    while (my $line = <$handle>) {
        $number++;
        $line =~ s/\r?\n$//;
        next if $line !~ /\S/;
        next if $line =~ /^\s*#/;

        my @fields = split /\t/, $line, -1;
        if (@fields < 3) {
            push @failures, "line $number: expected at least 3 columns";
            next;
        }
        my ($mode, $prompt, $expected) = @fields[0 .. 2];
        my @contains = (defined $fields[3] && length $fields[3]) ? split /\|/, $fields[3] : ();
        $checked++;

        if ($mode eq 'eval') {
            my $value = eval { evaluate($prompt) };
            if ($@) {
                push @failures, "line $number: '$prompt' -> error";
                next;
            }
            my $target = 0 + $expected;
            my $tolerance = 1e-9 * (abs($target) > 1 ? abs($target) : 1);
            push @failures, "line $number: '$prompt' -> $value, wanted $target"
                if abs($value - $target) > $tolerance;
            next;
        }

        my ($intent, $text) = answer($prompt);
        if (!defined $intent || $intent ne $expected) {
            push @failures, "line $number: '$prompt' -> intent $intent, wanted $expected";
            next;
        }
        for my $fragment (@contains) {
            if (index($text, $fragment) < 0) {
                push @failures, "line $number: '$prompt' -> text missing '$fragment'";
                last;
            }
        }
    }

    close $handle;

    if (@failures) {
        print "FAIL $_\n" for @failures;
        print scalar(@failures) . " failure(s) out of $checked case(s)\n";
        return 1;
    }
    print "ok: $checked cases\n";
    return 0;
}

my $target = defined $ARGV[0] ? $ARGV[0] : dirname(__FILE__) . '/../vectors.tsv';
exit run_vectors($target);
