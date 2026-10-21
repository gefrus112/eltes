#!/usr/bin/env ruby
# ==========================================================================
# Eltes CAI engine — Ruby port (standard library only).
#
# Arithmetic, percentages, unit and temperature conversion, with an explicit
# refusal for anything outside those rules. No network, no model weights.
#
#     ruby ports/ruby/cai.rb ports/vectors.tsv
# ==========================================================================

# frozen_string_literal: true

FUNCTIONS = {
  'sqrt' => [1, 1], 'cbrt' => [1, 1], 'abs' => [1, 1],
  'sin' => [1, 1], 'cos' => [1, 1], 'tan' => [1, 1],
  'asin' => [1, 1], 'acos' => [1, 1], 'atan' => [1, 1],
  'ln' => [1, 1], 'log10' => [1, 1], 'log2' => [1, 1], 'exp' => [1, 1],
  'floor' => [1, 1], 'ceil' => [1, 1], 'round' => [1, 1],
  'log' => [1, 2], 'pow' => [2, 2],
  'min' => [1, 1_000_000], 'max' => [1, 1_000_000], 'sum' => [1, 1_000_000],
  'mean' => [1, 1_000_000], 'product' => [1, 1_000_000]
}.freeze

PRECEDENCE = { '+' => 1, '-' => 1, '*' => 2, '/' => 2, '%' => 2, '^' => 3 }.freeze

class ParseError < StandardError; end

Token = Struct.new(:kind, :value, :text, :op)

def make_token(kind, value = 0.0, text = '', op = '')
  Token.new(kind, value, text, op)
end

# --------------------------------------------------------------------------
# formatting
# --------------------------------------------------------------------------

def format_number(value)
  return 'NaN' if value.nan?
  return 'Infinity' if value == Float::INFINITY
  return '-Infinity' if value == -Float::INFINITY

  magnitude = value.abs
  if magnitude >= 1e12 || (magnitude.positive? && magnitude < 1e-8)
    raw = format('%.10e', value)
    mantissa, exponent = raw.split('e')
    mantissa = mantissa.sub(/0+$/, '').sub(/\.$/, '')
    return "#{mantissa}e#{exponent}"
  end

  rounded = (value * 1e10).round / 1e10
  return '0' if rounded.zero?

  text = format('%.10f', rounded)
  text = text.sub(/0+$/, '').sub(/\.$/, '')
  text.empty? ? '0' : text
end

# --------------------------------------------------------------------------
# tokenizer
# --------------------------------------------------------------------------

def digit_before?(chars, index)
  (index - 1).downto(0) do |cursor|
    next if chars[cursor] =~ /\s/

    return chars[cursor] =~ /[0-9]/ ? true : false
  end
  false
end

def digit_after?(chars, index)
  (index + 1).upto(chars.length - 1) do |cursor|
    next if chars[cursor] =~ /\s/

    return chars[cursor] =~ /[0-9]/ ? true : false
  end
  false
end

def prepare(source)
  text = source
         .gsub(/[×✕✖]/, '*')
         .gsub('÷', '/')
         .gsub(/[−–—]/, '-')
         .gsub('²', '^2')
         .gsub('³', '^3')

  chars = text.chars
  out = +''
  chars.each_with_index do |ch, index|
    out << if (ch == 'x' || ch == 'X') && digit_before?(chars, index) && digit_after?(chars, index)
             '*'
           else
             ch
           end
  end
  out
end

def tokenize(source)
  text = prepare(source)
  tokens = []
  index = 0

  while index < text.length
    ch = text[index]

    if ch =~ /\s/
      index += 1
      next
    end

    if ch =~ /[0-9]/ || (ch == '.' && text[index + 1] =~ /[0-9]/)
      start = index
      index += 1 while index < text.length && text[index] =~ /[0-9]/
      if text[index] == '.'
        index += 1
        index += 1 while index < text.length && text[index] =~ /[0-9]/
      end
      if text[index] == 'e' || text[index] == 'E'
        probe = index + 1
        probe += 1 if ['+', '-'].include?(text[probe])
        if text[probe] =~ /[0-9]/
          probe += 1 while probe < text.length && text[probe] =~ /[0-9]/
          index = probe
        end
      end
      literal = text[start...index]
      value = Float(literal, exception: false)
      raise ParseError, 'bad number' if value.nil? || !value.finite?

      tokens << make_token(:number, value)
      next
    end

    if ch =~ /[a-zA-Z]/
      start = index
      index += 1 while index < text.length && text[index] =~ /[a-zA-Z]/
      tokens << make_token(:ident, 0.0, text[start...index].downcase)
      next
    end

    if '+-*/^%!'.include?(ch)
      tokens << make_token(:op, 0.0, '', ch)
      index += 1
      next
    end
    case ch
    when '('
      tokens << make_token(:open)
      index += 1
      next
    when ')'
      tokens << make_token(:close)
      index += 1
      next
    when ','
      tokens << make_token(:comma)
      index += 1
      next
    end
    raise ParseError, 'unexpected character'
  end

  expanded = []
  tokens.each do |item|
    previous = expanded.last
    if previous
      ends = previous.kind == :number || previous.kind == :close ||
             (previous.kind == :ident && %w[pi e].include?(previous.text))
      starts = item.kind == :number || item.kind == :ident || item.kind == :open
      is_call = previous.kind == :ident && FUNCTIONS.key?(previous.text) && item.kind == :open
      expanded << make_token(:op, 0.0, '', '*') if ends && starts && !is_call
    end
    expanded << item
  end
  expanded
end

# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

class Parser
  def initialize(tokens)
    @tokens = tokens
    @position = 0
  end

  def parse
    value = expression(0)
    raise ParseError, 'parse' unless @position == @tokens.length

    value
  end

  private

  def has?
    @position < @tokens.length
  end

  def expression(min_precedence)
    left = primary

    while has? && @tokens[@position].kind == :op && @tokens[@position].op == '!'
      @position += 1
      left = factorial(left)
    end

    while has? && @tokens[@position].kind == :op
      op = @tokens[@position].op
      precedence = PRECEDENCE[op]
      break if precedence.nil? || precedence < min_precedence

      @position += 1
      right = expression(op == '^' ? precedence : precedence + 1)
      left = case op
             when '+' then left + right
             when '-' then left - right
             when '*' then left * right
             when '/' then right.zero? ? (left.zero? ? Float::NAN : (left.positive? ? Float::INFINITY : -Float::INFINITY)) : left / right
             when '%' then right.zero? ? Float::NAN : left.remainder(right)
             when '^' then left**right
             else raise ParseError, 'parse'
             end
    end

    left
  end

  def primary
    raise ParseError, 'parse' unless has?

    item = @tokens[@position]
    @position += 1

    return item.value if item.kind == :number

    if item.kind == :op && ['-', '+'].include?(item.op)
      value = expression(3)
      return item.op == '-' ? -value : value
    end

    if item.kind == :open
      value = expression(0)
      raise ParseError, 'parse' unless has? && @tokens[@position].kind == :close

      @position += 1
      return value
    end

    if item.kind == :ident
      if has? && @tokens[@position].kind == :open && FUNCTIONS.key?(item.text)
        @position += 1
        args = []
        if has? && @tokens[@position].kind != :close
          args << expression(0)
          while has? && @tokens[@position].kind == :comma
            @position += 1
            args << expression(0)
          end
        end
        raise ParseError, 'parse' unless has? && @tokens[@position].kind == :close

        @position += 1
        return call_function(item.text, args)
      end
      return Math::PI if item.text == 'pi'
      return Math::E if item.text == 'e'
    end

    raise ParseError, 'parse'
  end

  def factorial(value)
    raise ParseError, 'factorial domain' if value.negative? || value != value.floor || value > 170

    result = 1.0
    step = 2.0
    while step <= value
      result *= step
      step += 1
    end
    result
  end

  def call_function(name, args)
    bounds = FUNCTIONS[name]
    raise ParseError, 'unknown function' if bounds.nil?
    raise ParseError, 'argument count' if args.length < bounds[0] || args.length > bounds[1]

    case name
    when 'sqrt' then Math.sqrt(args[0])
    when 'cbrt' then Math.cbrt(args[0])
    when 'abs' then args[0].abs
    when 'sin' then Math.sin(args[0])
    when 'cos' then Math.cos(args[0])
    when 'tan' then Math.tan(args[0])
    when 'asin' then Math.asin(args[0])
    when 'acos' then Math.acos(args[0])
    when 'atan' then Math.atan(args[0])
    when 'ln' then Math.log(args[0])
    when 'log10' then Math.log10(args[0])
    when 'log2' then Math.log2(args[0])
    when 'exp' then Math.exp(args[0])
    when 'floor' then args[0].floor.to_f
    when 'ceil' then args[0].ceil.to_f
    when 'round' then args[0].round.to_f
    when 'log' then args.length == 1 ? Math.log(args[0]) : Math.log(args[0]) / Math.log(args[1])
    when 'pow' then args[0]**args[1]
    when 'min' then args.min
    when 'max' then args.max
    when 'sum' then args.sum
    when 'mean' then args.sum / args.length
    when 'product' then args.reduce(1.0, :*)
    else raise ParseError, 'unknown function'
    end
  end
end

def evaluate(source)
  tokens = tokenize(source)
  raise ParseError, 'parse' if tokens.empty?

  Parser.new(tokens).parse
end

# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

UNITS = {
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
  'tb' => ['data', 1e12], 'kib' => ['data', 1024.0], 'mib' => ['data', 1_048_576.0],
  'gib' => ['data', 1_073_741_824.0],
  'km/h' => ['speed', 0.277777778], 'kph' => ['speed', 0.277777778],
  'mph' => ['speed', 0.44704], 'm/s' => ['speed', 1.0],
  'm2' => ['area', 1.0], 'km2' => ['area', 1e6], 'ft2' => ['area', 0.09290304],
  'sqft' => ['area', 0.09290304], 'acre' => ['area', 4046.8564224],
  'hectare' => ['area', 10_000.0], 'ha' => ['area', 10_000.0]
}.freeze

def temperature_convert(value, from, to)
  celsius = case from
            when 'c' then value
            when 'f' then (value - 32) * 5 / 9
            else value - 273.15
            end
  case to
  when 'c' then celsius
  when 'f' then celsius * 9 / 5 + 32
  else celsius + 273.15
  end
end

# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

def normalize(text)
  text.downcase
      .gsub(/[’‘]/, "'")
      .gsub(/[−–—]/, '-')
      .gsub('²', '^2')
      .gsub('³', '^3')
      .strip
      .gsub(/\s+/, ' ')
end

def number_word?(word)
  !word.nil? && word.match?(/\A[+-]?[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?\z/)
end

def split_number(word)
  match = /\A([+-]?[0-9]*\.?[0-9]+)(.*)\z/m.match(word)
  return nil if match.nil?

  [match[1].to_f, match[2]]
end

def percent_intent(text)
  words = text.gsub('%', ' percent ').split(/\s+/)

  (0..(words.length - 4)).each do |index|
    next unless words[index + 1] == 'percent'
    next unless %w[of off].include?(words[index + 2])
    next unless number_word?(words[index]) && number_word?(words[index + 3])

    percent = words[index].to_f
    base = words[index + 3].to_f
    part = percent / 100 * base

    if words[index + 2] == 'off'
      return "**#{format_number(base - part)}** after #{format_number(percent)}% off " \
             "#{format_number(base)} (a discount of #{format_number(part)})."
    end
    return "**#{format_number(part)}** — #{format_number(percent)}% of #{format_number(base)}.\n\n" \
           "#{format_number(base)} × #{format_number(percent)} / 100 = #{format_number(part)}"
  end

  if text.match?(/percent|increase|decrease|change/)
    (0..(words.length - 4)).each do |index|
      next unless words[index] == 'from' && words[index + 2] == 'to'
      next unless number_word?(words[index + 1]) && number_word?(words[index + 3])

      start = words[index + 1].to_f
      finish = words[index + 3].to_f
      if start.zero?
        return 'Percentage change from zero is undefined because the calculation divides by the ' \
               'starting value. I will not report a finite percentage.'
      end

      change = (finish - start) / start.abs * 100
      return "**#{format_number(change)}%** change from #{format_number(start)} to " \
             "#{format_number(finish)}.\n\nFormula: (#{format_number(finish)} − " \
             "#{format_number(start)}) ÷ |#{format_number(start)}| × 100"
    end
  end

  nil
end

def unit_intent(text)
  prepared = text
             .gsub('°', ' ')
             .gsub('degrees', ' ')
             .gsub('degree', ' ')
             .gsub('celsius', ' c ')
             .gsub('centigrade', ' c ')
             .gsub('fahrenheit', ' f ')
             .gsub('kelvin', ' k ')
  words = prepared.split(/\s+/)

  words.each_with_index do |word, index|
    split = split_number(word)
    next if split.nil?

    value = split[0]
    remainder = split[1]
    if remainder.empty?
      next if index + 1 >= words.length

      source = words[index + 1]
      cursor = index + 2
    else
      source = remainder
      cursor = index + 1
    end
    next if cursor + 1 >= words.length
    next unless %w[to in into as].include?(words[cursor])

    target = words[cursor + 1]

    if source.length == 1 && target.length == 1 && 'cfk'.include?(source) && 'cfk'.include?(target)
      if source == target
        return "#{format_number(value)} °#{source.upcase} is the same in °#{target.upcase}."
      end

      converted = temperature_convert(value, source, target)
      return "**#{format_number(converted)} °#{target.upcase}**\n\n`" \
             "#{format_number(value)} °#{source.upcase} → #{format_number(converted)} °#{target.upcase}`"
    end

    from = UNITS[source]
    to = UNITS[target]
    next if from.nil? || to.nil? || from[0] != to[0]

    converted = value * from[1] / to[1]
    note = from[0] == 'data' ? 'Using decimal units (1 KB = 1,000 bytes).' : 'Exact conversion factors.'
    return "**#{format_number(converted)} #{target}**\n\n`#{format_number(value)} #{source} = " \
           "#{format_number(converted)} #{target}`\n\n#{note}"
  end

  nil
end

PREFIXES = [
  "what's ", 'what is ', 'what is the value of ', 'calculate ', 'compute ',
  'solve ', 'evaluate ', 'how much is '
].freeze

def math_intent(text)
  candidate = text.dup
  PREFIXES.each do |prefix|
    if candidate.start_with?(prefix)
      candidate = candidate[prefix.length..]
      break
    end
  end
  candidate = candidate.strip.sub(/[?=]+\z/, '').strip
  candidate = candidate[4..] if candidate.start_with?('the ')

  if candidate.start_with?('square root of ')
    candidate = "sqrt(#{candidate['square root of '.length..]})"
  elsif candidate.start_with?('cube root of ')
    candidate = "cbrt(#{candidate['cube root of '.length..]})"
  elsif candidate.start_with?('factorial of ')
    candidate = "#{candidate['factorial of '.length..]}!"
  elsif candidate.end_with?(' squared')
    candidate = "(#{candidate[0...-' squared'.length]})^2"
  elsif candidate.end_with?(' cubed')
    candidate = "(#{candidate[0...-' cubed'.length]})^3"
  end

  padded = " #{candidate} "
           .gsub(' to the power of ', '^')
           .gsub(' divided by ', '/')
           .gsub(' multiplied by ', '*')
           .gsub(' times ', '*')
           .gsub(' plus ', '+')
           .gsub(' minus ', '-')
           .gsub(' factorial', '!')
  candidate = padded.strip

  return nil if candidate.empty?
  return nil if candidate.match?(%r{[^a-zA-Z0-9+\-*/^%(),!. ]})

  has_digit = candidate.match?(/[0-9]/)
  has_constant = candidate.split(/[^a-zA-Z]+/).any? { |word| %w[pi e].include?(word) }
  return nil unless has_digit || has_constant

  begin
    value = evaluate(candidate)
  rescue ParseError, ZeroDivisionError, Math::DomainError, FloatDomainError
    return nil
  end

  if value.nan? || value.infinite?
    return ['math-limit',
            'That expression does not produce a finite number (for example, division by zero, ' \
            'an invalid function domain or numeric overflow), so I will not present it as a ' \
            'normal result.']
  end

  shown = format_number(value)
  display = candidate.gsub('*', '×')
  trig = candidate.match?(/sin\(|cos\(|tan\(|asin\(|acos\(|atan\(/)
  ["math", "**#{shown}**\n\nExpression: #{display} = #{shown}" \
           "#{trig ? "\n\nTrigonometric functions use radians." : ''}"]
end

LIVE_WORDS = [
  'weather', 'news', 'stock price', 'score', 'who won', 'latest',
  'headlines', 'browse', 'search the web'
].freeze

def answer(prompt)
  text = prompt.to_s.strip
  if text.empty?
    return ['empty',
            'Ask me for arithmetic, percentages or a unit conversion. I answer on this device, ' \
            'so there is no network round trip.']
  end

  lowered = normalize(text)

  percent = percent_intent(lowered)
  return ['percent', percent] if percent

  units = unit_intent(lowered)
  return ['units', units] if units

  math = math_intent(lowered)
  return math if math

  LIVE_WORDS.each do |word|
    next unless lowered.include?(word)

    return ['live',
            'I cannot check live information — this engine has no network access, and it will ' \
            'not invent an answer.' \
            "\n\nSwitch to a connected hosted model for current facts, or paste the source text " \
            'here and I will help you reason about it.']
  end

  ['fallback',
   'I want to be straight with you: **this is a small on-device engine**, and that question is ' \
   'outside what it can answer reliably.' \
   "\n\nIt is solid on:\n\n- arithmetic and percentages\n- unit and temperature conversions" \
   "\n\nSwitch to a hosted model for open-ended writing, code review or live information."]
end

# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

def run_vectors(path)
  lines = File.readlines(path, chomp: true, encoding: 'UTF-8')
  failures = []
  checked = 0

  lines.each_with_index do |line, offset|
    number = offset + 1
    line = line.sub(/\r\z/, '')
    next if line.strip.empty? || line.start_with?('#')

    fields = line.split("\t", -1)
    if fields.length < 3
      failures << "line #{number}: expected at least 3 columns"
      next
    end
    checked += 1

    if fields[0] == 'eval'
      begin
        value = evaluate(fields[1])
      rescue StandardError
        failures << "line #{number}: '#{fields[1]}' -> error"
        next
      end
      expected = fields[2].to_f
      tolerance = 1e-9 * [1.0, expected.abs].max
      if (value - expected).abs > tolerance
        failures << "line #{number}: '#{fields[1]}' -> #{value}, wanted #{fields[2]}"
      end
      next
    end

    intent, text = answer(fields[1])
    if intent != fields[2]
      failures << "line #{number}: '#{fields[1]}' -> intent #{intent}, wanted #{fields[2]}"
      next
    end
    fragments = (fields[3] || '').split('|').reject(&:empty?)
    fragments.each do |fragment|
      unless text.include?(fragment)
        failures << "line #{number}: '#{fields[1]}' -> text missing '#{fragment}'"
        break
      end
    end
  end

  if failures.any?
    failures.each { |failure| puts "FAIL #{failure}" }
    puts "#{failures.length} failure(s) out of #{checked} case(s)"
    return 1
  end

  puts "ok: #{checked} cases"
  0
end

$stdout.set_encoding('UTF-8') if $stdout.respond_to?(:set_encoding)

target = ARGV[0] || File.expand_path('../vectors.tsv', __dir__)
exit run_vectors(target)
