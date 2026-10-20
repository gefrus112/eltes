#!/usr/bin/env lua
-- ==========================================================================
-- Eltes CAI engine — Lua port (Lua 5.3+, standard library only).
--
-- Arithmetic, percentages, unit and temperature conversion, with an explicit
-- refusal for anything outside those rules. No network, no model weights.
--
--     lua5.4 ports/lua/cai.lua ports/vectors.tsv
-- ==========================================================================

local FUNCTIONS = {
  sqrt = { 1, 1 }, cbrt = { 1, 1 }, abs = { 1, 1 },
  sin = { 1, 1 }, cos = { 1, 1 }, tan = { 1, 1 },
  asin = { 1, 1 }, acos = { 1, 1 }, atan = { 1, 1 },
  exp = { 1, 1 }, floor = { 1, 1 }, ceil = { 1, 1 }, round = { 1, 1 },
  ln = { 1, 1 }, log10 = { 1, 1 }, log2 = { 1, 1 },
  log = { 1, 2 }, pow = { 2, 2 },
  min = { 1, math.huge }, max = { 1, math.huge }, sum = { 1, math.huge },
  mean = { 1, math.huge }, product = { 1, math.huge },
}

local PRECEDENCE = { ["+"] = 1, ["-"] = 1, ["*"] = 2, ["/"] = 2, ["%"] = 2, ["^"] = 3 }

local function lower(text)
  return (string.gsub(text, "%u", string.lower))
end

local function trim(text)
  return (string.gsub(text, "^%s*(.-)%s*$", "%1"))
end

local function collapse(text)
  return (string.gsub(trim(text), "%s+", " "))
end

local function starts_with(text, prefix)
  return string.sub(text, 1, #prefix) == prefix
end

local function ends_with(text, suffix)
  return #text >= #suffix and string.sub(text, #text - #suffix + 1) == suffix
end

local function replace_all(text, needle, replacement)
  local out = {}
  local index = 1
  while true do
    local found = string.find(text, needle, index, true)
    if not found then
      table.insert(out, string.sub(text, index))
      break
    end
    table.insert(out, string.sub(text, index, found - 1))
    table.insert(out, replacement)
    index = found + #needle
  end
  return table.concat(out)
end

local function words(text)
  local out = {}
  for word in string.gmatch(text, "%S+") do
    table.insert(out, word)
  end
  return out
end

-- --------------------------------------------------------------------------
-- formatting
-- --------------------------------------------------------------------------

local function format_number(value)
  if value ~= value then
    return "NaN"
  end
  if value == math.huge then
    return "Infinity"
  end
  if value == -math.huge then
    return "-Infinity"
  end

  local magnitude = math.abs(value)
  if magnitude >= 1e12 or (magnitude > 0 and magnitude < 1e-8) then
    local raw = string.format("%.10e", value)
    local mantissa, exponent = string.match(raw, "^(.-)e(.+)$")
    if not mantissa then
      return raw
    end
    if string.find(mantissa, ".", 1, true) then
      mantissa = string.gsub(mantissa, "0+$", "")
      mantissa = string.gsub(mantissa, "%.$", "")
    end
    return mantissa .. "e" .. exponent
  end

  local scaled = value * 1e10
  local rounded = (scaled >= 0 and math.floor(scaled + 0.5) or math.ceil(scaled - 0.5)) / 1e10
  if rounded == 0 then
    return "0"
  end
  local text = string.format("%.10f", rounded)
  text = string.gsub(text, "0+$", "")
  text = string.gsub(text, "%.$", "")
  if text == "" then
    return "0"
  end
  return text
end

-- --------------------------------------------------------------------------
-- tokenizer
-- --------------------------------------------------------------------------

local function is_digit(ch)
  return ch ~= nil and ch >= "0" and ch <= "9"
end

local function is_alpha(ch)
  return ch ~= nil and ((ch >= "a" and ch <= "z") or (ch >= "A" and ch <= "Z"))
end

local function is_space(ch)
  return ch ~= nil and string.find(" \t\r\n\v\f", ch, 1, true) ~= nil
end

local function digit_before(text, index)
  local cursor = index - 1
  while cursor >= 1 do
    local ch = string.sub(text, cursor, cursor)
    if not is_space(ch) then
      return is_digit(ch)
    end
    cursor = cursor - 1
  end
  return false
end

local function digit_after(text, index)
  local cursor = index + 1
  while cursor <= #text do
    local ch = string.sub(text, cursor, cursor)
    if not is_space(ch) then
      return is_digit(ch)
    end
    cursor = cursor + 1
  end
  return false
end

local function prepare(source)
  local text = source
  text = replace_all(text, "×", "*")
  text = replace_all(text, "✕", "*")
  text = replace_all(text, "✖", "*")
  text = replace_all(text, "÷", "/")
  text = replace_all(text, "−", "-")
  text = replace_all(text, "–", "-")
  text = replace_all(text, "—", "-")
  text = replace_all(text, "²", "^2")
  text = replace_all(text, "³", "^3")

  local out = {}
  local index = 1
  while index <= #text do
    local ch = string.sub(text, index, index)
    if (ch == "x" or ch == "X") and digit_before(text, index) and digit_after(text, index) then
      table.insert(out, "*")
    else
      table.insert(out, ch)
    end
    index = index + 1
  end
  return table.concat(out)
end

local function tokenize(source)
  local text = prepare(source)
  local tokens = {}
  local index = 1

  while index <= #text do
    local ch = string.sub(text, index, index)

    if is_space(ch) then
      index = index + 1
    elseif is_digit(ch) or (ch == "." and is_digit(string.sub(text, index + 1, index + 1))) then
      local start = index
      while is_digit(string.sub(text, index, index)) do
        index = index + 1
      end
      if string.sub(text, index, index) == "." then
        index = index + 1
        while is_digit(string.sub(text, index, index)) do
          index = index + 1
        end
      end
      local marker = string.sub(text, index, index)
      if marker == "e" or marker == "E" then
        local probe = index + 1
        local sign = string.sub(text, probe, probe)
        if sign == "+" or sign == "-" then
          probe = probe + 1
        end
        if is_digit(string.sub(text, probe, probe)) then
          while is_digit(string.sub(text, probe, probe)) do
            probe = probe + 1
          end
          index = probe
        end
      end
      local literal = string.sub(text, start, index - 1)
      local value = tonumber(literal)
      if not value or value ~= value or value == math.huge or value == -math.huge then
        error("bad number")
      end
      table.insert(tokens, { kind = "number", value = value })
    elseif is_alpha(ch) then
      local start = index
      while is_alpha(string.sub(text, index, index)) do
        index = index + 1
      end
      table.insert(tokens, { kind = "ident", text = lower(string.sub(text, start, index - 1)) })
    elseif string.find("+-*/^%!", ch, 1, true) then
      table.insert(tokens, { kind = "op", op = ch })
      index = index + 1
    elseif ch == "(" then
      table.insert(tokens, { kind = "open" })
      index = index + 1
    elseif ch == ")" then
      table.insert(tokens, { kind = "close" })
      index = index + 1
    elseif ch == "," then
      table.insert(tokens, { kind = "comma" })
      index = index + 1
    else
      error("unexpected character")
    end
  end

  local expanded = {}
  for _, item in ipairs(tokens) do
    local previous = expanded[#expanded]
    if previous then
      local ends = previous.kind == "number" or previous.kind == "close"
        or (previous.kind == "ident" and (previous.text == "pi" or previous.text == "e"))
      local starts = item.kind == "number" or item.kind == "ident" or item.kind == "open"
      local is_call = previous.kind == "ident" and FUNCTIONS[previous.text] ~= nil and item.kind == "open"
      if ends and starts and not is_call then
        table.insert(expanded, { kind = "op", op = "*" })
      end
    end
    table.insert(expanded, item)
  end
  return expanded
end

-- --------------------------------------------------------------------------
-- parser
-- --------------------------------------------------------------------------

local Parser = {}
Parser.__index = Parser

local function new_parser(tokens)
  return setmetatable({ tokens = tokens, position = 1 }, Parser)
end

function Parser:has()
  return self.position <= #self.tokens
end

local function factorial(value)
  if value < 0 or value ~= math.floor(value) or value > 170 then
    error("factorial domain")
  end
  local result = 1
  local step = 2
  while step <= value do
    result = result * step
    step = step + 1
  end
  return result
end

local function call_function(name, args)
  local bounds = FUNCTIONS[name]
  if not bounds then
    error("unknown function")
  end
  if #args < bounds[1] or #args > bounds[2] then
    error("argument count")
  end

  local first = args[1]
  if name == "sqrt" then return math.sqrt(first) end
  if name == "cbrt" then return first < 0 and -(math.abs(first) ^ (1 / 3)) or first ^ (1 / 3) end
  if name == "abs" then return math.abs(first) end
  if name == "sin" then return math.sin(first) end
  if name == "cos" then return math.cos(first) end
  if name == "tan" then return math.tan(first) end
  if name == "asin" then return math.asin(first) end
  if name == "acos" then return math.acos(first) end
  if name == "atan" then return math.atan(first) end
  if name == "ln" then return first > 0 and math.log(first) or 0 / 0 end
  if name == "log10" then return first > 0 and math.log(first, 10) or 0 / 0 end
  if name == "log2" then return first > 0 and math.log(first, 2) or 0 / 0 end
  if name == "exp" then return math.exp(first) end
  if name == "floor" then return math.floor(first) end
  if name == "ceil" then return math.ceil(first) end
  if name == "round" then return math.floor(first + 0.5) end
  if name == "log" then
    if #args == 1 then return math.log(first) end
    return math.log(first) / math.log(args[2])
  end
  if name == "pow" then return first ^ args[2] end
  if name == "min" then
    local total = first
    for index = 2, #args do total = math.min(total, args[index]) end
    return total
  end
  if name == "max" then
    local total = first
    for index = 2, #args do total = math.max(total, args[index]) end
    return total
  end
  if name == "sum" then
    local total = 0
    for _, value in ipairs(args) do total = total + value end
    return total
  end
  if name == "mean" then
    local total = 0
    for _, value in ipairs(args) do total = total + value end
    return total / #args
  end
  if name == "product" then
    local total = 1
    for _, value in ipairs(args) do total = total * value end
    return total
  end
  error("unknown function")
end

function Parser:primary()
  if not self:has() then
    error("parse")
  end
  local item = self.tokens[self.position]
  self.position = self.position + 1

  if item.kind == "number" then
    return item.value
  end

  if item.kind == "op" and (item.op == "-" or item.op == "+") then
    local value = self:expression(3)
    if item.op == "-" then return -value end
    return value
  end

  if item.kind == "open" then
    local value = self:expression(0)
    if not self:has() or self.tokens[self.position].kind ~= "close" then
      error("parse")
    end
    self.position = self.position + 1
    return value
  end

  if item.kind == "ident" then
    if self:has() and self.tokens[self.position].kind == "open" and FUNCTIONS[item.text] then
      self.position = self.position + 1
      local args = {}
      if self:has() and self.tokens[self.position].kind ~= "close" then
        table.insert(args, self:expression(0))
        while self:has() and self.tokens[self.position].kind == "comma" do
          self.position = self.position + 1
          table.insert(args, self:expression(0))
        end
      end
      if not self:has() or self.tokens[self.position].kind ~= "close" then
        error("parse")
      end
      self.position = self.position + 1
      return call_function(item.text, args)
    end
    if item.text == "pi" then return math.pi end
    if item.text == "e" then return math.exp(1) end
  end

  error("parse")
end

function Parser:expression(min_precedence)
  local left = self:primary()

  while self:has() and self.tokens[self.position].kind == "op" and self.tokens[self.position].op == "!" do
    self.position = self.position + 1
    left = factorial(left)
  end

  while self:has() and self.tokens[self.position].kind == "op" do
    local op = self.tokens[self.position].op
    local precedence = PRECEDENCE[op]
    if not precedence or precedence < min_precedence then
      break
    end
    self.position = self.position + 1
    local right = self:expression(op == "^" and precedence or precedence + 1)
    if op == "+" then
      left = left + right
    elseif op == "-" then
      left = left - right
    elseif op == "*" then
      left = left * right
    elseif op == "/" then
      left = left / right
    elseif op == "%" then
      left = math.fmod(left, right)
    elseif op == "^" then
      left = left ^ right
    else
      error("parse")
    end
  end

  return left
end

local function evaluate(source)
  local tokens = tokenize(source)
  if #tokens == 0 then
    error("parse")
  end
  local parser = new_parser(tokens)
  local value = parser:expression(0)
  if parser.position ~= #parser.tokens + 1 then
    error("parse")
  end
  return value
end

-- --------------------------------------------------------------------------
-- units
-- --------------------------------------------------------------------------

local UNITS = {}
local function register(kind, rows)
  for _, row in ipairs(rows) do
    UNITS[row[1]] = { kind = kind, factor = row[2] }
  end
end

register("length", {
  { "mm", 0.001 }, { "cm", 0.01 }, { "m", 1 }, { "metre", 1 }, { "metres", 1 },
  { "meter", 1 }, { "meters", 1 }, { "km", 1000 }, { "in", 0.0254 }, { "inch", 0.0254 },
  { "inches", 0.0254 }, { "ft", 0.3048 }, { "feet", 0.3048 }, { "foot", 0.3048 },
  { "yd", 0.9144 }, { "mi", 1609.344 }, { "mile", 1609.344 }, { "miles", 1609.344 },
})
register("mass", {
  { "mg", 0.001 }, { "g", 1 }, { "kg", 1000 }, { "oz", 28.349523125 },
  { "lb", 453.59237 }, { "lbs", 453.59237 }, { "pound", 453.59237 }, { "pounds", 453.59237 },
  { "stone", 6350.29318 }, { "st", 6350.29318 },
})
register("volume", {
  { "ml", 0.001 }, { "l", 1 }, { "litre", 1 }, { "litres", 1 }, { "liter", 1 },
  { "liters", 1 }, { "tsp", 0.00492892159 }, { "tbsp", 0.0147867648 },
  { "cup", 0.2365882365 }, { "pint", 0.473176473 }, { "qt", 0.946352946 },
  { "quart", 0.946352946 }, { "gal", 3.785411784 }, { "gallon", 3.785411784 },
  { "gallons", 3.785411784 },
})
register("data", {
  { "b", 1 }, { "kb", 1e3 }, { "mb", 1e6 }, { "gb", 1e9 }, { "tb", 1e12 },
  { "kib", 1024 }, { "mib", 1048576 }, { "gib", 1073741824 },
})
register("speed", {
  { "km/h", 0.277777778 }, { "kph", 0.277777778 }, { "mph", 0.44704 }, { "m/s", 1 },
})
register("area", {
  { "m2", 1 }, { "km2", 1e6 }, { "ft2", 0.09290304 }, { "sqft", 0.09290304 },
  { "acre", 4046.8564224 }, { "hectare", 10000 }, { "ha", 10000 },
})

local function temperature_convert(value, from, to)
  local celsius
  if from == "c" then
    celsius = value
  elseif from == "f" then
    celsius = (value - 32) * 5 / 9
  else
    celsius = value - 273.15
  end
  if to == "c" then
    return celsius
  elseif to == "f" then
    return celsius * 9 / 5 + 32
  end
  return celsius + 273.15
end

-- --------------------------------------------------------------------------
-- intents
-- --------------------------------------------------------------------------

local function normalize(text)
  local out = lower(text)
  out = replace_all(out, "’", "'")
  out = replace_all(out, "‘", "'")
  out = replace_all(out, "−", "-")
  out = replace_all(out, "–", "-")
  out = replace_all(out, "—", "-")
  out = replace_all(out, "²", "^2")
  out = replace_all(out, "³", "^3")
  return collapse(out)
end

local function is_number_word(word)
  if word == nil or word == "" then
    return false
  end
  return string.match(word, "^[%+%-]?%d*%.?%d+([eE][%+%-]?%d+)?$") ~= nil
end

local function split_number(word)
  local index = 1
  local ch = string.sub(word, index, index)
  if ch == "+" or ch == "-" then
    index = index + 1
  end
  local digits = index
  while is_digit(string.sub(word, index, index)) do
    index = index + 1
  end
  if string.sub(word, index, index) == "." then
    index = index + 1
    while is_digit(string.sub(word, index, index)) do
      index = index + 1
    end
  end
  if index == digits then
    return nil
  end
  local value = tonumber(string.sub(word, 1, index - 1))
  if not value then
    return nil
  end
  return value, string.sub(word, index)
end

local function percent_intent(text)
  local list = words(replace_all(text, "%", " percent "))

  local index = 1
  while index + 3 <= #list do
    if list[index + 1] == "percent"
      and (list[index + 2] == "of" or list[index + 2] == "off")
      and is_number_word(list[index]) and is_number_word(list[index + 3]) then
      local percent = tonumber(list[index])
      local base = tonumber(list[index + 3])
      local part = percent / 100 * base

      if list[index + 2] == "off" then
        return "**" .. format_number(base - part) .. "** after " .. format_number(percent)
          .. "% off " .. format_number(base) .. " (a discount of " .. format_number(part) .. ")."
      end
      return "**" .. format_number(part) .. "** — " .. format_number(percent) .. "% of "
        .. format_number(base) .. ".\n\n" .. format_number(base) .. " × "
        .. format_number(percent) .. " / 100 = " .. format_number(part)
    end
    index = index + 1
  end

  if string.find(text, "percent", 1, true) or string.find(text, "increase", 1, true)
    or string.find(text, "decrease", 1, true) or string.find(text, "change", 1, true) then
    index = 1
    while index + 3 <= #list do
      if list[index] == "from" and list[index + 2] == "to"
        and is_number_word(list[index + 1]) and is_number_word(list[index + 3]) then
        local start = tonumber(list[index + 1])
        local finish = tonumber(list[index + 3])
        if start == 0 then
          return "Percentage change from zero is undefined because the calculation divides by the "
            .. "starting value. I will not report a finite percentage."
        end
        local change = (finish - start) / math.abs(start) * 100
        return "**" .. format_number(change) .. "%** change from " .. format_number(start)
          .. " to " .. format_number(finish) .. ".\n\nFormula: (" .. format_number(finish)
          .. " − " .. format_number(start) .. ") ÷ |" .. format_number(start) .. "| × 100"
      end
      index = index + 1
    end
  end

  return nil
end

local function unit_intent(text)
  local prepared = text
  prepared = replace_all(prepared, "°", " ")
  prepared = replace_all(prepared, "degrees", " ")
  prepared = replace_all(prepared, "degree", " ")
  prepared = replace_all(prepared, "celsius", " c ")
  prepared = replace_all(prepared, "centigrade", " c ")
  prepared = replace_all(prepared, "fahrenheit", " f ")
  prepared = replace_all(prepared, "kelvin", " k ")
  local list = words(prepared)

  for index = 1, #list do
    local value, remainder = split_number(list[index])
    if value then
      local source, cursor
      if remainder == "" then
        source = list[index + 1]
        cursor = index + 2
      else
        source = remainder
        cursor = index + 1
      end

      if source and cursor + 1 <= #list then
        local connector = list[cursor]
        local target = list[cursor + 1]
        if connector == "to" or connector == "in" or connector == "into" or connector == "as" then
          if #source == 1 and #target == 1 and string.find("cfk", source, 1, true)
            and string.find("cfk", target, 1, true) then
            local from_label = string.upper(source)
            local to_label = string.upper(target)
            if source == target then
              return format_number(value) .. " °" .. from_label .. " is the same in °" .. to_label .. "."
            end
            local converted = temperature_convert(value, source, target)
            return "**" .. format_number(converted) .. " °" .. to_label .. "**\n\n`"
              .. format_number(value) .. " °" .. from_label .. " → "
              .. format_number(converted) .. " °" .. to_label .. "`"
          end

          local from = UNITS[source]
          local to = UNITS[target]
          if from and to and from.kind == to.kind then
            local converted = value * from.factor / to.factor
            local note = from.kind == "data"
                and "Using decimal units (1 KB = 1,000 bytes)."
                or "Exact conversion factors."
            return "**" .. format_number(converted) .. " " .. target .. "**\n\n`"
              .. format_number(value) .. " " .. source .. " = " .. format_number(converted)
              .. " " .. target .. "`\n\n" .. note
          end
        end
      end
    end
  end

  return nil
end

local PREFIXES = {
  "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
  "solve ", "evaluate ", "how much is ",
}

local function math_intent(text)
  local candidate = text
  for _, prefix in ipairs(PREFIXES) do
    if starts_with(candidate, prefix) then
      candidate = string.sub(candidate, #prefix + 1)
      break
    end
  end
  candidate = trim(candidate)
  while true do
    local last = string.sub(candidate, -1)
    if last == "?" or last == "=" then
      candidate = string.sub(candidate, 1, -2)
    else
      break
    end
  end
  candidate = trim(candidate)

  if starts_with(candidate, "the ") then
    candidate = string.sub(candidate, 5)
  end

  if starts_with(candidate, "square root of ") then
    candidate = "sqrt(" .. string.sub(candidate, #"square root of " + 1) .. ")"
  elseif starts_with(candidate, "cube root of ") then
    candidate = "cbrt(" .. string.sub(candidate, #"cube root of " + 1) .. ")"
  elseif starts_with(candidate, "factorial of ") then
    candidate = string.sub(candidate, #"factorial of " + 1) .. "!"
  elseif ends_with(candidate, " squared") then
    candidate = "(" .. string.sub(candidate, 1, #candidate - #" squared") .. ")^2"
  elseif ends_with(candidate, " cubed") then
    candidate = "(" .. string.sub(candidate, 1, #candidate - #" cubed") .. ")^3"
  end

  local padded = " " .. candidate .. " "
  padded = replace_all(padded, " to the power of ", "^")
  padded = replace_all(padded, " divided by ", "/")
  padded = replace_all(padded, " multiplied by ", "*")
  padded = replace_all(padded, " times ", "*")
  padded = replace_all(padded, " plus ", "+")
  padded = replace_all(padded, " minus ", "-")
  padded = replace_all(padded, " factorial", "!")
  candidate = trim(padded)

  if candidate == "" then
    return nil
  end

  local index = 1
  while index <= #candidate do
    local ch = string.sub(candidate, index, index)
    if not (is_alpha(ch) or is_digit(ch) or string.find("+-*/^%(),!. ", ch, 1, true)) then
      return nil
    end
    index = index + 1
  end

  local has_digit = string.find(candidate, "%d") ~= nil
  local has_constant = false
  for word in string.gmatch(candidate, "%a+") do
    if word == "pi" or word == "e" then
      has_constant = true
    end
  end
  if not has_digit and not has_constant then
    return nil
  end

  local ok, value = pcall(evaluate, candidate)
  if not ok then
    return nil
  end

  if value ~= value or value == math.huge or value == -math.huge then
    return "math-limit",
      "That expression does not produce a finite number (for example, division by zero, an "
      .. "invalid function domain or numeric overflow), so I will not present it as a normal result."
  end

  local shown = format_number(value)
  local display = replace_all(candidate, "*", "×")
  local trig = string.find(candidate, "sin%(") or string.find(candidate, "cos%(")
    or string.find(candidate, "tan%(") or string.find(candidate, "asin%(")
    or string.find(candidate, "acos%(") or string.find(candidate, "atan%(")
  return "math", "**" .. shown .. "**\n\nExpression: " .. display .. " = " .. shown
    .. (trig and "\n\nTrigonometric functions use radians." or "")
end

local LIVE = {
  "weather", "news", "stock price", "score", "who won", "latest",
  "headlines", "browse", "search the web",
}

local function answer(prompt)
  local text = trim(prompt or "")
  if text == "" then
    return "empty",
      "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, "
      .. "so there is no network round trip."
  end

  local lowered = normalize(text)

  local percent = percent_intent(lowered)
  if percent then
    return "percent", percent
  end

  local units = unit_intent(lowered)
  if units then
    return "units", units
  end

  local math_intent_result, math_text = math_intent(lowered)
  if math_intent_result then
    return math_intent_result, math_text
  end

  for _, word in ipairs(LIVE) do
    if string.find(lowered, word, 1, true) then
      return "live",
        "I cannot check live information — this engine has no network access, and it will not "
        .. "invent an answer.\n\nSwitch to a connected hosted model for current facts, or paste "
        .. "the source text here and I will help you reason about it."
    end
  end

  return "fallback",
    "I want to be straight with you: **this is a small on-device engine**, and that question is "
    .. "outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n"
    .. "- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, "
    .. "code review or live information."
end

-- --------------------------------------------------------------------------
-- conformance runner
-- --------------------------------------------------------------------------

local function run_vectors(path)
  local handle = io.open(path, "r")
  if not handle then
    io.stderr:write("cannot read " .. path .. "\n")
    return 1
  end

  local failures = {}
  local checked = 0
  local number = 0

  for line in handle:lines() do
    number = number + 1
    line = string.gsub(line, "\r$", "")
    if trim(line) ~= "" and string.sub(line, 1, 1) ~= "#" then
      local fields = {}
      for field in string.gmatch(line .. "\t", "(.-)\t") do
        table.insert(fields, field)
      end
      if #fields < 3 then
        table.insert(failures, "line " .. number .. ": expected at least 3 columns")
      else
        checked = checked + 1
        if fields[1] == "eval" then
          local ok, value = pcall(evaluate, fields[2])
          if not ok then
            table.insert(failures, "line " .. number .. ": '" .. fields[2] .. "' -> error")
          else
            local expected = tonumber(fields[3])
            local tolerance = 1e-9 * math.max(1, math.abs(expected))
            if math.abs(value - expected) > tolerance then
              table.insert(failures, "line " .. number .. ": '" .. fields[2] .. "' -> "
                .. format_number(value) .. ", wanted " .. fields[3])
            end
          end
        else
          local intent, text = answer(fields[2])
          if intent ~= fields[3] then
            table.insert(failures, "line " .. number .. ": '" .. fields[2] .. "' -> intent "
              .. intent .. ", wanted " .. fields[3])
          elseif fields[4] and fields[4] ~= "" then
            for fragment in string.gmatch(fields[4], "[^|]+") do
              if not string.find(text, fragment, 1, true) then
                table.insert(failures, "line " .. number .. ": '" .. fields[2]
                  .. "' -> text missing '" .. fragment .. "'")
                break
              end
            end
          end
        end
      end
    end
  end

  handle:close()

  if #failures > 0 then
    for _, failure in ipairs(failures) do
      print("FAIL " .. failure)
    end
    print(#failures .. " failure(s) out of " .. checked .. " case(s)")
    return 1
  end

  print("ok: " .. checked .. " cases")
  return 0
end

local here = (arg and arg[0] and string.match(arg[0], "^(.*)[/\\][^/\\]*$")) or "."
local target = arg[1] or (here .. "/../vectors.tsv")
os.exit(run_vectors(target))
