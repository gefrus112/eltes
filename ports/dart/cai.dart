// ==========================================================================
// Eltes CAI engine — Dart port (standard library only).
//
// Arithmetic, percentages, unit and temperature conversion, with an explicit
// refusal for anything outside those rules. No network, no model weights.
//
//     dart run ports/dart/cai.dart ports/vectors.tsv
// ==========================================================================
import 'dart:io';
import 'dart:math' as math;

class ParseError implements Exception {
  ParseError(this.message);
  final String message;

  @override
  String toString() => message;
}

// --------------------------------------------------------------------------
// formatting
// --------------------------------------------------------------------------

String formatNumber(double value) {
  if (value.isNaN) return 'NaN';
  if (value == double.infinity) return 'Infinity';
  if (value == double.negativeInfinity) return '-Infinity';

  final magnitude = value.abs();
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
    final raw = value.toStringAsExponential(10);
    final index = raw.indexOf('e');
    if (index < 0) return raw;
    var mantissa = raw.substring(0, index);
    final exponent = raw.substring(index + 1).replaceFirst('+', '');
    if (mantissa.contains('.')) {
      mantissa = mantissa.replaceFirst(RegExp(r'0+$'), '');
      mantissa = mantissa.replaceFirst(RegExp(r'\.$'), '');
    }
    return '${mantissa}e$exponent';
  }

  final rounded = (value * 1e10).round() / 1e10;
  if (rounded == 0) return '0';
  var text = rounded.toStringAsFixed(10);
  text = text.replaceFirst(RegExp(r'0+$'), '');
  text = text.replaceFirst(RegExp(r'\.$'), '');
  return text.isEmpty ? '0' : text;
}

// --------------------------------------------------------------------------
// tokens
// --------------------------------------------------------------------------

class Token {
  const Token.number(this.value)
      : kind = 'number',
        text = '',
        op = '';
  const Token.ident(this.text)
      : kind = 'ident',
        value = 0,
        op = '';
  const Token.operator(this.op)
      : kind = 'op',
        value = 0,
        text = '';
  const Token.simple(this.kind)
      : value = 0,
        text = '',
        op = '';

  final String kind;
  final double value;
  final String text;
  final String op;
}

const Map<String, List<int>> functions = {
  'sqrt': [1, 1], 'cbrt': [1, 1], 'abs': [1, 1],
  'sin': [1, 1], 'cos': [1, 1], 'tan': [1, 1],
  'asin': [1, 1], 'acos': [1, 1], 'atan': [1, 1],
  'exp': [1, 1], 'floor': [1, 1], 'ceil': [1, 1], 'round': [1, 1],
  'ln': [1, 1], 'log10': [1, 1], 'log2': [1, 1],
  'log': [1, 2], 'pow': [2, 2],
  'min': [1, 1 << 30], 'max': [1, 1 << 30], 'sum': [1, 1 << 30],
  'mean': [1, 1 << 30], 'product': [1, 1 << 30],
};

const Map<String, int> precedence = {
  '+': 1,
  '-': 1,
  '*': 2,
  '/': 2,
  '%': 2,
  '^': 3,
};

bool digitBefore(List<String> characters, int index) {
  for (var cursor = index - 1; cursor >= 0; cursor--) {
    if (RegExp(r'\s').hasMatch(characters[cursor])) continue;
    return RegExp(r'[0-9]').hasMatch(characters[cursor]);
  }
  return false;
}

bool digitAfter(List<String> characters, int index) {
  for (var cursor = index + 1; cursor < characters.length; cursor++) {
    if (RegExp(r'\s').hasMatch(characters[cursor])) continue;
    return RegExp(r'[0-9]').hasMatch(characters[cursor]);
  }
  return false;
}

String prepare(String source) {
  var text = source
      .replaceAll('×', '*')
      .replaceAll('✕', '*')
      .replaceAll('✖', '*')
      .replaceAll('÷', '/')
      .replaceAll('−', '-')
      .replaceAll('–', '-')
      .replaceAll('—', '-')
      .replaceAll('²', '^2')
      .replaceAll('³', '^3');

  final characters = text.split('');
  final out = <String>[];
  for (var index = 0; index < characters.length; index++) {
    final character = characters[index];
    if ((character == 'x' || character == 'X') &&
        digitBefore(characters, index) &&
        digitAfter(characters, index)) {
      out.add('*');
    } else {
      out.add(character);
    }
  }
  return out.join();
}

List<Token> tokenize(String source) {
  final text = prepare(source);
  final characters = text.split('');
  final tokens = <Token>[];
  var index = 0;

  while (index < characters.length) {
    final character = characters[index];

    if (RegExp(r'\s').hasMatch(character)) {
      index++;
      continue;
    }

    if (RegExp(r'[0-9]').hasMatch(character) ||
        (character == '.' &&
            index + 1 < characters.length &&
            RegExp(r'[0-9]').hasMatch(characters[index + 1]))) {
      final start = index;
      while (index < characters.length && RegExp(r'[0-9]').hasMatch(characters[index])) {
        index++;
      }
      if (index < characters.length && characters[index] == '.') {
        index++;
        while (index < characters.length && RegExp(r'[0-9]').hasMatch(characters[index])) {
          index++;
        }
      }
      if (index < characters.length &&
          (characters[index] == 'e' || characters[index] == 'E')) {
        var probe = index + 1;
        if (probe < characters.length &&
            (characters[probe] == '+' || characters[probe] == '-')) {
          probe++;
        }
        if (probe < characters.length && RegExp(r'[0-9]').hasMatch(characters[probe])) {
          while (probe < characters.length && RegExp(r'[0-9]').hasMatch(characters[probe])) {
            probe++;
          }
          index = probe;
        }
      }
      final literal = characters.sublist(start, index).join();
      final value = double.tryParse(literal);
      if (value == null || value.isNaN || value.isInfinite) {
        throw ParseError('bad number');
      }
      tokens.add(Token.number(value));
      continue;
    }

    if (RegExp(r'[a-zA-Z]').hasMatch(character)) {
      final start = index;
      while (index < characters.length && RegExp(r'[a-zA-Z]').hasMatch(characters[index])) {
        index++;
      }
      tokens.add(Token.ident(characters.sublist(start, index).join().toLowerCase()));
      continue;
    }

    if ('+-*/^%!'.contains(character)) {
      tokens.add(Token.operator(character));
      index++;
      continue;
    }
    if (character == '(') {
      tokens.add(const Token.simple('open'));
      index++;
      continue;
    }
    if (character == ')') {
      tokens.add(const Token.simple('close'));
      index++;
      continue;
    }
    if (character == ',') {
      tokens.add(const Token.simple('comma'));
      index++;
      continue;
    }
    throw ParseError('unexpected character');
  }

  final expanded = <Token>[];
  for (final item in tokens) {
    if (expanded.isNotEmpty) {
      final previous = expanded.last;
      final ends = previous.kind == 'number' ||
          previous.kind == 'close' ||
          (previous.kind == 'ident' && (previous.text == 'pi' || previous.text == 'e'));
      final starts =
          item.kind == 'number' || item.kind == 'ident' || item.kind == 'open';
      final isCall = previous.kind == 'ident' &&
          functions.containsKey(previous.text) &&
          item.kind == 'open';
      if (ends && starts && !isCall) {
        expanded.add(const Token.operator('*'));
      }
    }
    expanded.add(item);
  }
  return expanded;
}

// --------------------------------------------------------------------------
// parser
// --------------------------------------------------------------------------

class Parser {
  Parser(this.tokens);
  final List<Token> tokens;
  int position = 0;

  bool get has => position < tokens.length;

  double parse() {
    final value = expression(0);
    if (position != tokens.length) throw ParseError('parse');
    return value;
  }

  double expression(int minPrecedence) {
    var left = primary();

    while (has && tokens[position].kind == 'op' && tokens[position].op == '!') {
      position++;
      left = factorial(left);
    }

    while (has && tokens[position].kind == 'op') {
      final operator = tokens[position].op;
      final current = precedence[operator];
      if (current == null || current < minPrecedence) break;
      position++;
      final right = expression(operator == '^' ? current : current + 1);
      switch (operator) {
        case '+':
          left += right;
          break;
        case '-':
          left -= right;
          break;
        case '*':
          left *= right;
          break;
        case '/':
          left /= right;
          break;
        case '%':
          left = left.remainder(right).toDouble();
          break;
        case '^':
          left = math.pow(left, right).toDouble();
          break;
        default:
          throw ParseError('parse');
      }
    }

    return left;
  }

  double primary() {
    if (!has) throw ParseError('parse');
    final item = tokens[position];
    position++;

    if (item.kind == 'number') return item.value;

    if (item.kind == 'op' && (item.op == '-' || item.op == '+')) {
      final value = expression(3);
      return item.op == '-' ? -value : value;
    }

    if (item.kind == 'open') {
      final value = expression(0);
      if (!has || tokens[position].kind != 'close') throw ParseError('parse');
      position++;
      return value;
    }

    if (item.kind == 'ident') {
      if (has && tokens[position].kind == 'open' && functions.containsKey(item.text)) {
        position++;
        final args = <double>[];
        if (has && tokens[position].kind != 'close') {
          args.add(expression(0));
          while (has && tokens[position].kind == 'comma') {
            position++;
            args.add(expression(0));
          }
        }
        if (!has || tokens[position].kind != 'close') throw ParseError('parse');
        position++;
        return callFunction(item.text, args);
      }
      if (item.text == 'pi') return 3.141592653589793;
      if (item.text == 'e') return 2.718281828459045;
    }

    throw ParseError('parse');
  }
}

double factorial(double value) {
  if (value < 0 || value != value.roundToDouble() || value > 170) {
    throw ParseError('factorial domain');
  }
  var result = 1.0;
  for (var step = 2.0; step <= value; step += 1) {
    result *= step;
  }
  return result;
}

double callFunction(String name, List<double> args) {
  final bounds = functions[name];
  if (bounds == null) throw ParseError('unknown function');
  if (args.length < bounds[0] || args.length > bounds[1]) {
    throw ParseError('argument count');
  }
  final first = args[0];
  switch (name) {
    case 'sqrt':
      return math.sqrt(first);
    case 'cbrt':
      return math.pow(first, 1 / 3).toDouble();
    case 'abs':
      return first.abs();
    case 'sin':
      return math.sin(first);
    case 'cos':
      return math.cos(first);
    case 'tan':
      return math.tan(first);
    case 'asin':
      return math.asin(first);
    case 'acos':
      return math.acos(first);
    case 'atan':
      return math.atan(first);
    case 'ln':
      return first > 0 ? math.log(first) : double.nan;
    case 'log10':
      return first > 0 ? math.log(first) / math.ln10 : double.nan;
    case 'log2':
      return first > 0 ? math.log(first) / math.ln2 : double.nan;
    case 'exp':
      return math.exp(first);
    case 'floor':
      return first.floorToDouble();
    case 'ceil':
      return first.ceilToDouble();
    case 'round':
      return first.roundToDouble();
    case 'log':
      return args.length == 1 ? math.log(first) : math.log(first) / math.log(args[1]);
    case 'pow':
      return math.pow(first, args[1]).toDouble();
    case 'min':
      return args.reduce((a, b) => a < b ? a : b);
    case 'max':
      return args.reduce((a, b) => a > b ? a : b);
    case 'sum':
      return args.reduce((a, b) => a + b);
    case 'mean':
      return args.reduce((a, b) => a + b) / args.length;
    case 'product':
      return args.reduce((a, b) => a * b);
  }
  throw ParseError('unknown function');
}

double evaluate(String source) {
  final tokens = tokenize(source);
  if (tokens.isEmpty) throw ParseError('parse');
  return Parser(tokens).parse();
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

class Unit {
  const Unit(this.kind, this.factor);
  final String kind;
  final double factor;
}

const Map<String, Unit> units = {
  'mm': Unit('length', 0.001), 'cm': Unit('length', 0.01), 'm': Unit('length', 1),
  'metre': Unit('length', 1), 'metres': Unit('length', 1), 'meter': Unit('length', 1),
  'meters': Unit('length', 1), 'km': Unit('length', 1000), 'in': Unit('length', 0.0254),
  'inch': Unit('length', 0.0254), 'inches': Unit('length', 0.0254),
  'ft': Unit('length', 0.3048), 'feet': Unit('length', 0.3048), 'foot': Unit('length', 0.3048),
  'yd': Unit('length', 0.9144), 'mi': Unit('length', 1609.344),
  'mile': Unit('length', 1609.344), 'miles': Unit('length', 1609.344),
  'mg': Unit('mass', 0.001), 'g': Unit('mass', 1), 'kg': Unit('mass', 1000),
  'oz': Unit('mass', 28.349523125), 'lb': Unit('mass', 453.59237),
  'lbs': Unit('mass', 453.59237), 'pound': Unit('mass', 453.59237),
  'pounds': Unit('mass', 453.59237), 'stone': Unit('mass', 6350.29318),
  'st': Unit('mass', 6350.29318),
  'ml': Unit('volume', 0.001), 'l': Unit('volume', 1), 'litre': Unit('volume', 1),
  'litres': Unit('volume', 1), 'liter': Unit('volume', 1), 'liters': Unit('volume', 1),
  'tsp': Unit('volume', 0.00492892159), 'tbsp': Unit('volume', 0.0147867648),
  'cup': Unit('volume', 0.2365882365), 'pint': Unit('volume', 0.473176473),
  'qt': Unit('volume', 0.946352946), 'quart': Unit('volume', 0.946352946),
  'gal': Unit('volume', 3.785411784), 'gallon': Unit('volume', 3.785411784),
  'gallons': Unit('volume', 3.785411784),
  'b': Unit('data', 1), 'kb': Unit('data', 1e3), 'mb': Unit('data', 1e6),
  'gb': Unit('data', 1e9), 'tb': Unit('data', 1e12), 'kib': Unit('data', 1024),
  'mib': Unit('data', 1048576), 'gib': Unit('data', 1073741824),
  'km/h': Unit('speed', 0.277777778), 'kph': Unit('speed', 0.277777778),
  'mph': Unit('speed', 0.44704), 'm/s': Unit('speed', 1),
  'm2': Unit('area', 1), 'km2': Unit('area', 1e6), 'ft2': Unit('area', 0.09290304),
  'sqft': Unit('area', 0.09290304), 'acre': Unit('area', 4046.8564224),
  'hectare': Unit('area', 10000), 'ha': Unit('area', 10000),
};

double temperatureConvert(double value, String from, String to) {
  final celsius = from == 'c'
      ? value
      : from == 'f'
          ? (value - 32) * 5 / 9
          : value - 273.15;
  if (to == 'c') return celsius;
  if (to == 'f') return celsius * 9 / 5 + 32;
  return celsius + 273.15;
}

// --------------------------------------------------------------------------
// intents
// --------------------------------------------------------------------------

String normalize(String text) {
  var out = text.toLowerCase();
  out = out.replaceAll('’', "'").replaceAll('‘', "'");
  out = out.replaceAll('−', '-').replaceAll('–', '-').replaceAll('—', '-');
  out = out.replaceAll('²', '^2').replaceAll('³', '^3');
  return out.trim().replaceAll(RegExp(r'\s+'), ' ');
}

List<String> words(String text) =>
    text.trim().split(RegExp(r'\s+')).where((word) => word.isNotEmpty).toList();

bool isNumberWord(String? word) =>
    word != null && RegExp(r'^[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?$').hasMatch(word);

List<dynamic>? splitNumber(String word) {
  final match = RegExp(r'^([+-]?[0-9]*\.?[0-9]+)(.*)$', dotAll: true).firstMatch(word);
  if (match == null) return null;
  final value = double.tryParse(match.group(1)!);
  if (value == null) return null;
  return [value, match.group(2)!];
}

String? percentIntent(String text) {
  final list = words(text.replaceAll('%', ' percent '));

  for (var index = 0; index + 3 < list.length; index++) {
    if (list[index + 1] != 'percent') continue;
    if (list[index + 2] != 'of' && list[index + 2] != 'off') continue;
    if (!isNumberWord(list[index]) || !isNumberWord(list[index + 3])) continue;

    final percent = double.parse(list[index]);
    final base = double.parse(list[index + 3]);
    final part = percent / 100 * base;

    if (list[index + 2] == 'off') {
      return '**${formatNumber(base - part)}** after ${formatNumber(percent)}% off '
          '${formatNumber(base)} (a discount of ${formatNumber(part)}).';
    }
    return '**${formatNumber(part)}** — ${formatNumber(percent)}% of ${formatNumber(base)}.\n\n'
        '${formatNumber(base)} × ${formatNumber(percent)} / 100 = ${formatNumber(part)}';
  }

  if (RegExp(r'percent|increase|decrease|change').hasMatch(text)) {
    for (var index = 0; index + 3 < list.length; index++) {
      if (list[index] != 'from' || list[index + 2] != 'to') continue;
      if (!isNumberWord(list[index + 1]) || !isNumberWord(list[index + 3])) continue;

      final start = double.parse(list[index + 1]);
      final end = double.parse(list[index + 3]);
      if (start == 0) {
        return 'Percentage change from zero is undefined because the calculation divides by '
            'the starting value. I will not report a finite percentage.';
      }
      final change = (end - start) / start.abs() * 100;
      return '**${formatNumber(change)}%** change from ${formatNumber(start)} to '
          '${formatNumber(end)}.\n\nFormula: (${formatNumber(end)} − ${formatNumber(start)}) ÷ '
          '|${formatNumber(start)}| × 100';
    }
  }

  return null;
}

String? unitIntent(String text) {
  final prepared = text
      .replaceAll('°', ' ')
      .replaceAll('degrees', ' ')
      .replaceAll('degree', ' ')
      .replaceAll('celsius', ' c ')
      .replaceAll('centigrade', ' c ')
      .replaceAll('fahrenheit', ' f ')
      .replaceAll('kelvin', ' k ');
  final list = words(prepared);

  for (var index = 0; index < list.length; index++) {
    final split = splitNumber(list[index]);
    if (split == null) continue;
    final value = split[0] as double;
    final remainder = split[1] as String;

    String source;
    int cursor;
    if (remainder.isEmpty) {
      if (index + 1 >= list.length) continue;
      source = list[index + 1];
      cursor = index + 2;
    } else {
      source = remainder;
      cursor = index + 1;
    }
    if (cursor + 1 >= list.length) continue;
    if (!['to', 'in', 'into', 'as'].contains(list[cursor])) continue;
    final target = list[cursor + 1];

    if (source.length == 1 &&
        target.length == 1 &&
        'cfk'.contains(source) &&
        'cfk'.contains(target)) {
      final fromLabel = source.toUpperCase();
      final toLabel = target.toUpperCase();
      if (source == target) {
        return '${formatNumber(value)} °$fromLabel is the same in °$toLabel.';
      }
      final converted = temperatureConvert(value, source, target);
      return '**${formatNumber(converted)} °$toLabel**\n\n`${formatNumber(value)} °$fromLabel → '
          '${formatNumber(converted)} °$toLabel`';
    }

    final from = units[source];
    final to = units[target];
    if (from == null || to == null || from.kind != to.kind) continue;

    final converted = value * from.factor / to.factor;
    final note = from.kind == 'data'
        ? 'Using decimal units (1 KB = 1,000 bytes).'
        : 'Exact conversion factors.';
    return '**${formatNumber(converted)} $target**\n\n`${formatNumber(value)} $source = '
        '${formatNumber(converted)} $target`\n\n$note';
  }

  return null;
}

const List<String> prefixes = [
  "what's ", 'what is ', 'what is the value of ', 'calculate ', 'compute ',
  'solve ', 'evaluate ', 'how much is ',
];

List<String>? mathIntent(String text) {
  var candidate = text.trim();
  for (final prefix in prefixes) {
    if (candidate.startsWith(prefix)) {
      candidate = candidate.substring(prefix.length).trim();
      break;
    }
  }
  candidate = candidate.replaceFirst(RegExp(r'[?=]+$'), '').trim();
  if (candidate.startsWith('the ')) candidate = candidate.substring(4);

  if (candidate.startsWith('square root of ')) {
    candidate = 'sqrt(${candidate.substring("square root of ".length)})';
  } else if (candidate.startsWith('cube root of ')) {
    candidate = 'cbrt(${candidate.substring("cube root of ".length)})';
  } else if (candidate.startsWith('factorial of ')) {
    candidate = '${candidate.substring("factorial of ".length)}!';
  } else if (candidate.endsWith(' squared') && candidate.length > 8) {
    candidate = '(${candidate.substring(0, candidate.length - 8)})^2';
  } else if (candidate.endsWith(' cubed') && candidate.length > 6) {
    candidate = '(${candidate.substring(0, candidate.length - 6)})^3';
  }

  var padded = ' $candidate ';
  padded = padded
      .replaceAll(' to the power of ', '^')
      .replaceAll(' divided by ', '/')
      .replaceAll(' multiplied by ', '*')
      .replaceAll(' times ', '*')
      .replaceAll(' plus ', '+')
      .replaceAll(' minus ', '-');
  candidate = padded.trim();

  if (candidate.isEmpty) return null;
  if (!RegExp(r'^[a-zA-Z0-9+\-*/^%(),!. ]+$').hasMatch(candidate)) return null;

  final hasDigit = RegExp(r'[0-9]').hasMatch(candidate);
  final hasConstant = candidate
      .split(RegExp(r'[^a-zA-Z]+'))
      .any((word) => word == 'pi' || word == 'e');
  if (!hasDigit && !hasConstant) return null;

  double value;
  try {
    value = evaluate(candidate);
  } on ParseError {
    return null;
  }

  if (value.isNaN || value.isInfinite) {
    return [
      'math-limit',
      'That expression does not produce a finite number (for example, division by zero, '
          'an invalid function domain or numeric overflow), so I will not present it as a '
          'normal result.',
    ];
  }

  final shown = formatNumber(value);
  final display = candidate.replaceAll('*', '×');
  final trig = RegExp(r'sin\(|cos\(|tan\(|asin\(|acos\(|atan\(').hasMatch(candidate);
  return [
    'math',
    '**$shown**\n\nExpression: $display = $shown'
        '${trig ? "\n\nTrigonometric functions use radians." : ""}',
  ];
}

const List<String> liveWords = [
  'weather', 'news', 'stock price', 'score', 'who won', 'latest',
  'headlines', 'browse', 'search the web',
];

List<String> answer(String prompt) {
  final text = prompt.trim();
  if (text.isEmpty) {
    return [
      'empty',
      'Ask me for arithmetic, percentages or a unit conversion. I answer on this device, '
          'so there is no network round trip.',
    ];
  }

  final lowered = normalize(text);

  final percent = percentIntent(lowered);
  if (percent != null) return ['percent', percent];

  final unit = unitIntent(lowered);
  if (unit != null) return ['units', unit];

  final math = mathIntent(lowered);
  if (math != null) return math;

  for (final word in liveWords) {
    if (lowered.contains(word)) {
      return [
        'live',
        'I cannot check live information — this engine has no network access, and it will '
            'not invent an answer.\n\nSwitch to a connected hosted model for current facts, '
            'or paste the source text here and I will help you reason about it.',
      ];
    }
  }

  return [
    'fallback',
    'I want to be straight with you: **this is a small on-device engine**, and that '
        'question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic '
        'and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for '
        'open-ended writing, code review or live information.',
  ];
}

// --------------------------------------------------------------------------
// conformance runner
// --------------------------------------------------------------------------

int runVectors(String path) {
  final lines = File(path).readAsLinesSync();
  final failures = <String>[];
  var checked = 0;

  for (var offset = 0; offset < lines.length; offset++) {
    final number = offset + 1;
    final line = lines[offset].replaceAll('\r', '');
    if (line.trim().isEmpty || line.startsWith('#')) continue;

    final fields = line.split('\t');
    if (fields.length < 3) {
      failures.add('line $number: expected at least 3 columns');
      continue;
    }
    checked++;

    if (fields[0] == 'eval') {
      double value;
      try {
        value = evaluate(fields[1]);
      } on ParseError {
        failures.add("line $number: '${fields[1]}' -> error");
        continue;
      }
      final expected = double.parse(fields[2]);
      final tolerance = 1e-9 * (expected.abs() > 1 ? expected.abs() : 1);
      if ((value - expected).abs() > tolerance) {
        failures.add("line $number: '${fields[1]}' -> $value, wanted ${fields[2]}");
      }
      continue;
    }

    final result = answer(fields[1]);
    if (result[0] != fields[2]) {
      failures.add("line $number: '${fields[1]}' -> intent ${result[0]}, wanted ${fields[2]}");
      continue;
    }
    if (fields.length > 3 && fields[3].isNotEmpty) {
      for (final fragment in fields[3].split('|')) {
        if (!result[1].contains(fragment)) {
          failures.add("line $number: '${fields[1]}' -> text missing '$fragment'");
          break;
        }
      }
    }
  }

  if (failures.isNotEmpty) {
    for (final failure in failures) {
      print('FAIL $failure');
    }
    print('${failures.length} failure(s) out of $checked case(s)');
    return 1;
  }
  print('ok: $checked cases');
  return 0;
}

void main(List<String> arguments) {
  final target = arguments.isNotEmpty ? arguments.first : '../vectors.tsv';
  exitCode = runVectors(target);
}
