# ==========================================================================
# Eltes CAI engine — R port (base R only, no packages).
#
# Arithmetic, percentages, unit and temperature conversion, with an explicit
# refusal for anything outside those rules. No network, no model weights.
#
#     Rscript ports/r/cai.R ports/vectors.tsv
# ==========================================================================

format_number <- function(value) {
  if (is.nan(value)) return("NaN")
  if (is.infinite(value)) return(if (value > 0) "Infinity" else "-Infinity")

  magnitude <- abs(value)
  if (magnitude >= 1e12 || (magnitude > 0 && magnitude < 1e-8)) {
    text <- sprintf("%.10e", value)
    parts <- strsplit(text, "e", fixed = TRUE)[[1]]
    if (length(parts) < 2) return(text)
    mantissa <- parts[1]
    exponent <- as.integer(parts[2])
    if (grepl(".", mantissa, fixed = TRUE)) {
      mantissa <- sub("0+$", "", mantissa)
      mantissa <- sub("\\.$", "", mantissa)
    }
    return(paste0(mantissa, "e", exponent))
  }

  rounded <- round(value * 1e10) / 1e10
  if (rounded == 0) return("0")
  text <- sprintf("%.10f", rounded)
  text <- sub("0+$", "", text)
  text <- sub("\\.$", "", text)
  if (text == "" || text == "-0") "0" else text
}

# --------------------------------------------------------------------------
# tokens
# --------------------------------------------------------------------------

FUNCTIONS <- list(
  sqrt = c(1, 1), cbrt = c(1, 1), abs = c(1, 1),
  sin = c(1, 1), cos = c(1, 1), tan = c(1, 1),
  asin = c(1, 1), acos = c(1, 1), atan = c(1, 1),
  exp = c(1, 1), floor = c(1, 1), ceil = c(1, 1), round = c(1, 1),
  ln = c(1, 1), log10 = c(1, 1), log2 = c(1, 1),
  log = c(1, 2), pow = c(2, 2),
  min = c(1, Inf), max = c(1, Inf), sum = c(1, Inf),
  mean = c(1, Inf), product = c(1, Inf)
)

PRECEDENCE <- c("+" = 1L, "-" = 1L, "*" = 2L, "/" = 2L, "%" = 2L, "^" = 3L)

digit_before <- function(chars, index) {
  cursor <- index - 1L
  while (cursor >= 1L) {
    if (grepl("\\s", chars[cursor])) {
      cursor <- cursor - 1L
      next
    }
    return(grepl("[0-9]", chars[cursor]))
  }
  FALSE
}

digit_after <- function(chars, index) {
  cursor <- index + 1L
  while (cursor <= length(chars)) {
    if (grepl("\\s", chars[cursor])) {
      cursor <- cursor + 1L
      next
    }
    return(grepl("[0-9]", chars[cursor]))
  }
  FALSE
}

prepare <- function(source) {
  text <- source
  text <- gsub("\u00d7", "*", text, fixed = TRUE)
  text <- gsub("\u2715", "*", text, fixed = TRUE)
  text <- gsub("\u00f7", "/", text, fixed = TRUE)
  text <- gsub("\u2212", "-", text, fixed = TRUE)
  text <- gsub("\u2013", "-", text, fixed = TRUE)
  text <- gsub("\u2014", "-", text, fixed = TRUE)
  text <- gsub("\u00b2", "^2", text, fixed = TRUE)
  text <- gsub("\u00b3", "^3", text, fixed = TRUE)

  chars <- strsplit(text, "", fixed = TRUE)[[1]]
  if (length(chars) == 0) return("")
  out <- character(length(chars))
  for (index in seq_along(chars)) {
    character <- chars[index]
    is_times <- (character == "x" || character == "X") &&
      digit_before(chars, index) && digit_after(chars, index)
    out[index] <- if (is_times) "*" else character
  }
  paste0(out, collapse = "")
}

new_tokens <- function() {
  list(kind = integer(0), value = numeric(0), text = character(0), op = character(0))
}

add_token <- function(tokens, kind, value = 0, text = "", op = "") {
  tokens$kind <- c(tokens$kind, as.integer(kind))
  tokens$value <- c(tokens$value, as.numeric(value))
  tokens$text <- c(tokens$text, text)
  tokens$op <- c(tokens$op, op)
  tokens
}

tokenize <- function(source) {
  chars <- strsplit(prepare(source), "", fixed = TRUE)[[1]]
  n <- length(chars)
  tokens <- new_tokens()
  index <- 1L

  while (index <= n) {
    character <- chars[index]

    if (grepl("^\\s$", character)) {
      index <- index + 1L
      next
    }

    if (grepl("^[0-9]$", character) ||
      (character == "." && index + 1L <= n && grepl("^[0-9]$", chars[index + 1L]))) {
      start <- index
      while (index <= n && grepl("^[0-9]$", chars[index])) index <- index + 1L
      if (index <= n && chars[index] == ".") {
        index <- index + 1L
        while (index <= n && grepl("^[0-9]$", chars[index])) index <- index + 1L
      }
      if (index <= n && grepl("^[eE]$", chars[index])) {
        probe <- index + 1L
        if (probe <= n && grepl("^[+-]$", chars[probe])) probe <- probe + 1L
        if (probe <= n && grepl("^[0-9]$", chars[probe])) {
          while (probe <= n && grepl("^[0-9]$", chars[probe])) probe <- probe + 1L
          index <- probe
        }
      }
      literal <- paste0(chars[start:(index - 1L)], collapse = "")
      value <- suppressWarnings(as.numeric(literal))
      if (is.na(value) || !is.finite(value)) return(NULL)
      tokens <- add_token(tokens, 1L, value = value)
      next
    }

    if (grepl("^[a-zA-Z]$", character)) {
      start <- index
      while (index <= n && grepl("^[a-zA-Z]$", chars[index])) index <- index + 1L
      tokens <- add_token(tokens, 2L, text = tolower(paste0(chars[start:(index - 1L)], collapse = "")))
      next
    }

    if (grepl("^[+*/^%!-]$", character)) {
      tokens <- add_token(tokens, 3L, op = character)
      index <- index + 1L
      next
    }
    if (character == "(") {
      tokens <- add_token(tokens, 4L)
      index <- index + 1L
      next
    }
    if (character == ")") {
      tokens <- add_token(tokens, 5L)
      index <- index + 1L
      next
    }
    if (character == ",") {
      tokens <- add_token(tokens, 6L)
      index <- index + 1L
      next
    }
    return(NULL)
  }

  expanded <- new_tokens()
  for (index in seq_along(tokens$kind)) {
    count <- length(expanded$kind)
    if (count > 0) {
      previous_kind <- expanded$kind[count]
      previous_text <- expanded$text[count]
      ends <- previous_kind == 1L || previous_kind == 5L ||
        (previous_kind == 2L && (previous_text == "pi" || previous_text == "e"))
      starts <- tokens$kind[index] == 1L || tokens$kind[index] == 2L || tokens$kind[index] == 4L
      is_call <- previous_kind == 2L && !is.null(FUNCTIONS[[previous_text]]) &&
        tokens$kind[index] == 4L
      if (ends && starts && !is_call) expanded <- add_token(expanded, 3L, op = "*")
    }
    expanded <- add_token(
      expanded,
      tokens$kind[index],
      value = tokens$value[index],
      text = tokens$text[index],
      op = tokens$op[index]
    )
  }
  expanded
}

# --------------------------------------------------------------------------
# parser
# --------------------------------------------------------------------------

new_parser <- function(tokens) {
  parser <- new.env(parent = emptyenv())
  parser$tokens <- tokens
  parser$position <- 1L
  parser$error <- ""
  parser$limit <- FALSE
  parser
}

has_token <- function(parser) parser$position <= length(parser$tokens$kind)

fail <- function(parser, message = "parse") {
  parser$error <- message
  0
}

factorial_value <- function(parser, value) {
  if (value < 0 || value != trunc(value) || value > 170) {
    parser$error <- "factorial domain"
    return(0)
  }
  result <- 1
  step <- 2
  while (step <= value) {
    result <- result * step
    step <- step + 1
  }
  result
}

call_function <- function(parser, name, args) {
  bounds <- FUNCTIONS[[name]]
  if (is.null(bounds)) return(fail(parser, "unknown function"))
  if (length(args) < bounds[1] || length(args) > bounds[2]) return(fail(parser, "argument count"))

  first <- args[1]
  log_of <- function(value) if (value > 0) log(value) else NaN

  result <- switch(name,
    sqrt = if (first < 0) NA_real_ else sqrt(first),
    cbrt = sign(first) * abs(first)^(1 / 3),
    abs = abs(first),
    sin = sin(first),
    cos = cos(first),
    tan = tan(first),
    asin = if (first < -1 || first > 1) NA_real_ else asin(first),
    acos = if (first < -1 || first > 1) NA_real_ else acos(first),
    atan = atan(first),
    ln = log_of(first),
    log10 = log_of(first) / log(10),
    log2 = log_of(first) / log(2),
    exp = exp(first),
    floor = floor(first),
    ceil = ceiling(first),
    round = round(first),
    log = if (length(args) == 1) log_of(first) else log_of(first) / log_of(args[2]),
    pow = first^args[2],
    min = min(args),
    max = max(args),
    sum = sum(args),
    mean = mean(args),
    product = prod(args),
    NA_real_
  )

  if (is.nan(result) || is.na(result)) {
    parser$limit <- TRUE
    parser$error <- "nonfinite"
    return(0)
  }
  if (!is.finite(result) || result >= 1e308 || result <= -1e308) {
    parser$limit <- TRUE
    parser$error <- "nonfinite"
    return(0)
  }
  result
}

parse_primary <- function(parser) {
  if (!has_token(parser)) return(fail(parser))

  kind <- parser$tokens$kind[parser$position]
  value <- parser$tokens$value[parser$position]
  text <- parser$tokens$text[parser$position]
  op <- parser$tokens$op[parser$position]
  parser$position <- parser$position + 1L

  if (kind == 1L) return(value)

  if (kind == 3L && (op == "-" || op == "+")) {
    inner <- parse_expression(parser, 3L)
    if (parser$error != "") return(0)
    return(if (op == "-") -inner else inner)
  }

  if (kind == 4L) {
    inner <- parse_expression(parser, 0L)
    if (parser$error != "") return(0)
    if (!has_token(parser) || parser$tokens$kind[parser$position] != 5L) return(fail(parser))
    parser$position <- parser$position + 1L
    return(inner)
  }

  if (kind == 2L) {
    if (has_token(parser) && parser$tokens$kind[parser$position] == 4L &&
      !is.null(FUNCTIONS[[text]])) {
      parser$position <- parser$position + 1L
      args <- numeric(0)
      if (has_token(parser) && parser$tokens$kind[parser$position] != 5L) {
        args <- c(args, parse_expression(parser, 0L))
        if (parser$error != "") return(0)
        while (has_token(parser) && parser$tokens$kind[parser$position] == 6L) {
          parser$position <- parser$position + 1L
          args <- c(args, parse_expression(parser, 0L))
          if (parser$error != "") return(0)
        }
      }
      if (!has_token(parser) || parser$tokens$kind[parser$position] != 5L) return(fail(parser))
      parser$position <- parser$position + 1L
      return(call_function(parser, text, args))
    }
    if (text == "pi") return(pi)
    if (text == "e") return(exp(1))
  }

  fail(parser)
}

parse_expression <- function(parser, minimum) {
  left <- parse_primary(parser)
  if (parser$error != "") return(0)

  while (has_token(parser) && parser$tokens$kind[parser$position] == 3L &&
    parser$tokens$op[parser$position] == "!") {
    parser$position <- parser$position + 1L
    left <- factorial_value(parser, left)
    if (parser$error != "") return(0)
  }

  while (has_token(parser) && parser$tokens$kind[parser$position] == 3L) {
    operator <- parser$tokens$op[parser$position]
    current <- PRECEDENCE[operator]
    if (is.na(current) || current < minimum) break
    parser$position <- parser$position + 1L
    next_minimum <- if (operator == "^") current else current + 1L
    right <- parse_expression(parser, next_minimum)
    if (parser$error != "") return(0)

    if (operator == "+") {
      left <- left + right
    } else if (operator == "-") {
      left <- left - right
    } else if (operator == "*") {
      left <- left * right
    } else if (operator == "/") {
      if (right == 0) {
        parser$limit <- TRUE
        parser$error <- "nonfinite"
        return(0)
      }
      left <- left / right
    } else if (operator == "%") {
      if (right == 0) {
        parser$limit <- TRUE
        parser$error <- "nonfinite"
        return(0)
      }
      left <- left - trunc(left / right) * right
    } else if (operator == "^") {
      left <- left^right
    } else {
      return(fail(parser))
    }
  }

  left
}

evaluate <- function(source) {
  tokens <- tokenize(source)
  result <- list(ok = FALSE, value = 0, limit = FALSE)
  if (is.null(tokens) || length(tokens$kind) == 0) return(result)

  parser <- new_parser(tokens)
  value <- parse_expression(parser, 0L)
  if (parser$error != "") {
    result$limit <- parser$limit
    return(result)
  }
  if (parser$position != length(parser$tokens$kind) + 1L) return(result)
  if (!is.finite(value) || value >= 1e308 || value <= -1e308) {
    result$limit <- TRUE
    return(result)
  }
  list(ok = TRUE, value = value, limit = FALSE)
}

# --------------------------------------------------------------------------
# units
# --------------------------------------------------------------------------

build_units <- function(rows) {
  units <- new.env(parent = emptyenv())
  for (kind in names(rows)) {
    for (name in names(rows[[kind]])) {
      units[[name]] <- list(kind = kind, factor = rows[[kind]][[name]])
    }
  }
  units
}

UNITS <- build_units(list(
  length = list(
    mm = 0.001, cm = 0.01, m = 1, metre = 1, metres = 1, meter = 1, meters = 1,
    km = 1000, `in` = 0.0254, inch = 0.0254, inches = 0.0254,
    ft = 0.3048, feet = 0.3048, foot = 0.3048, yd = 0.9144,
    mi = 1609.344, mile = 1609.344, miles = 1609.344
  ),
  mass = list(
    mg = 0.001, g = 1, kg = 1000, oz = 28.349523125, lb = 453.59237,
    lbs = 453.59237, pound = 453.59237, pounds = 453.59237,
    stone = 6350.29318, st = 6350.29318
  ),
  volume = list(
    ml = 0.001, l = 1, litre = 1, litres = 1, liter = 1, liters = 1,
    tsp = 0.00492892159, tbsp = 0.0147867648, cup = 0.2365882365,
    pint = 0.473176473, qt = 0.946352946, quart = 0.946352946,
    gal = 3.785411784, gallon = 3.785411784, gallons = 3.785411784
  ),
  data = list(
    b = 1, kb = 1e3, mb = 1e6, gb = 1e9, tb = 1e12,
    kib = 1024, mib = 1048576, gib = 1073741824
  ),
  speed = list(`km/h` = 0.277777778, kph = 0.277777778, mph = 0.44704, `m/s` = 1),
  area = list(
    m2 = 1, km2 = 1e6, ft2 = 0.09290304, sqft = 0.09290304,
    acre = 4046.8564224, hectare = 10000, ha = 10000
  )
))

temperature_convert <- function(value, from, to) {
  celsius <- if (from == "c") {
    value
  } else if (from == "f") {
    (value - 32) * 5 / 9
  } else {
    value - 273.15
  }
  if (to == "c") return(celsius)
  if (to == "f") return(celsius * 9 / 5 + 32)
  celsius + 273.15
}

# --------------------------------------------------------------------------
# intents
# --------------------------------------------------------------------------

normalize <- function(text) {
  out <- tolower(text)
  out <- gsub("\u2019", "'", out, fixed = TRUE)
  out <- gsub("\u2018", "'", out, fixed = TRUE)
  out <- gsub("\u2212", "-", out, fixed = TRUE)
  out <- gsub("\u2013", "-", out, fixed = TRUE)
  out <- gsub("\u2014", "-", out, fixed = TRUE)
  out <- gsub("\u00b2", "^2", out, fixed = TRUE)
  out <- gsub("\u00b3", "^3", out, fixed = TRUE)
  out <- trimws(out)
  out <- gsub("[[:space:]]+", " ", out)
  out
}

words <- function(text) {
  text <- trimws(text)
  if (text == "") return(character(0))
  strsplit(text, "[[:space:]]+")[[1]]
}

is_number_word <- function(word) {
  grepl("^[+-]?[0-9]*\\.?[0-9]+([eE][+-]?[0-9]+)?$", word)
}

split_number <- function(word) {
  match <- regmatches(word, regexpr("^[+-]?[0-9]*\\.?[0-9]+", word))
  if (length(match) == 0) return(NULL)
  value <- suppressWarnings(as.numeric(match))
  if (is.na(value) || !is.finite(value)) return(NULL)
  list(value = value, suffix = substring(word, nchar(match) + 1L))
}

percent_intent <- function(text) {
  list_words <- words(gsub("%", " percent ", text, fixed = TRUE))
  count <- length(list_words)
  if (count >= 4) {
    for (index in 1:(count - 3)) {
      if (list_words[index + 1] != "percent") next
      if (list_words[index + 2] != "of" && list_words[index + 2] != "off") next
      if (!is_number_word(list_words[index]) || !is_number_word(list_words[index + 3])) next

      percent <- as.numeric(list_words[index])
      base <- as.numeric(list_words[index + 3])
      part <- percent / 100 * base

      if (list_words[index + 2] == "off") {
        return(paste0(
          "**", format_number(base - part), "** after ", format_number(percent), "% off ",
          format_number(base), " (a discount of ", format_number(part), ")."
        ))
      }
      return(paste0(
        "**", format_number(part), "** \u2014 ", format_number(percent), "% of ",
        format_number(base), ".\n\n", format_number(base), " \u00d7 ", format_number(percent),
        " / 100 = ", format_number(part)
      ))
    }
  }

  if (!grepl("percent|increase|decrease|change", text)) return("")

  if (count >= 4) {
    for (index in 1:(count - 3)) {
      if (list_words[index] != "from" || list_words[index + 2] != "to") next
      if (!is_number_word(list_words[index + 1]) || !is_number_word(list_words[index + 3])) next

      start <- as.numeric(list_words[index + 1])
      end <- as.numeric(list_words[index + 3])
      if (start == 0) {
        return(paste0(
          "Percentage change from zero is undefined because the calculation divides by ",
          "the starting value. I will not report a finite percentage."
        ))
      }
      change <- (end - start) / abs(start) * 100
      return(paste0(
        "**", format_number(change), "%** change from ", format_number(start), " to ",
        format_number(end), ".\n\nFormula: (", format_number(end), " \u2212 ",
        format_number(start), ") \u00f7 |", format_number(start), "| \u00d7 100"
      ))
    }
  }

  ""
}

unit_intent <- function(text) {
  prepared <- text
  prepared <- gsub("\u00b0", " ", prepared, fixed = TRUE)
  prepared <- gsub("degrees", " ", prepared, fixed = TRUE)
  prepared <- gsub("degree", " ", prepared, fixed = TRUE)
  prepared <- gsub("celsius", " c ", prepared, fixed = TRUE)
  prepared <- gsub("centigrade", " c ", prepared, fixed = TRUE)
  prepared <- gsub("fahrenheit", " f ", prepared, fixed = TRUE)
  prepared <- gsub("kelvin", " k ", prepared, fixed = TRUE)

  list_words <- words(prepared)
  count <- length(list_words)
  labels <- c(c = "C", f = "F", k = "K")

  for (index in seq_len(count)) {
    piece <- split_number(list_words[index])
    if (is.null(piece)) next

    if (piece$suffix == "") {
      if (index + 1 > count) next
      source <- list_words[index + 1]
      cursor <- index + 2
    } else {
      source <- piece$suffix
      cursor <- index + 1
    }
    if (cursor + 1 > count) next
    if (!(list_words[cursor] %in% c("to", "in", "into", "as"))) next
    target <- list_words[cursor + 1]

    if (nchar(source) == 1 && nchar(target) == 1 && source %in% names(labels) && target %in% names(labels)) {
      from_label <- labels[[source]]
      to_label <- labels[[target]]
      if (source == target) {
        return(paste0(
          format_number(piece$value), " \u00b0", from_label, " is the same in \u00b0", to_label, "."
        ))
      }
      converted <- temperature_convert(piece$value, source, target)
      return(paste0(
        "**", format_number(converted), " \u00b0", to_label, "**\n\n`",
        format_number(piece$value), " \u00b0", from_label, " \u2192 ",
        format_number(converted), " \u00b0", to_label, "`"
      ))
    }

    from <- if (exists(source, envir = UNITS, inherits = FALSE)) UNITS[[source]] else NULL
    to <- if (exists(target, envir = UNITS, inherits = FALSE)) UNITS[[target]] else NULL
    if (is.null(from) || is.null(to) || from$kind != to$kind) next

    converted <- piece$value * from$factor / to$factor
    note <- if (from$kind == "data") "Using decimal units (1 KB = 1,000 bytes)." else "Exact conversion factors."
    return(paste0(
      "**", format_number(converted), " ", target, "**\n\n`", format_number(piece$value), " ",
      source, " = ", format_number(converted), " ", target, "`\n\n", note
    ))
  }

  ""
}

PREFIXES <- c(
  "what's ", "what is ", "what is the value of ", "calculate ", "compute ",
  "solve ", "evaluate ", "how much is "
)

starts_with <- function(text, prefix) {
  substr(text, 1L, nchar(prefix)) == prefix
}

ends_with <- function(text, suffix) {
  nchar(text) >= nchar(suffix) && substr(text, nchar(text) - nchar(suffix) + 1L, nchar(text)) == suffix
}

math_intent <- function(text) {
  candidate <- trimws(text)
  for (prefix in PREFIXES) {
    if (starts_with(candidate, prefix)) {
      candidate <- trimws(substring(candidate, nchar(prefix) + 1L))
      break
    }
  }
  candidate <- sub("[?=]+$", "", candidate)
  candidate <- trimws(candidate)
  if (starts_with(candidate, "the ")) candidate <- substring(candidate, 5L)

  if (starts_with(candidate, "square root of ")) {
    candidate <- paste0("sqrt(", substring(candidate, nchar("square root of ") + 1L), ")")
  } else if (starts_with(candidate, "cube root of ")) {
    candidate <- paste0("cbrt(", substring(candidate, nchar("cube root of ") + 1L), ")")
  } else if (starts_with(candidate, "factorial of ")) {
    candidate <- paste0(substring(candidate, nchar("factorial of ") + 1L), "!")
  } else if (ends_with(candidate, " squared") && nchar(candidate) > nchar(" squared")) {
    candidate <- paste0("(", substr(candidate, 1L, nchar(candidate) - nchar(" squared")), ")^2")
  } else if (ends_with(candidate, " cubed") && nchar(candidate) > nchar(" cubed")) {
    candidate <- paste0("(", substr(candidate, 1L, nchar(candidate) - nchar(" cubed")), ")^3")
  }

  candidate <- paste0(" ", candidate, " ")
  candidate <- gsub(" to the power of ", "^", candidate, fixed = TRUE)
  candidate <- gsub(" divided by ", "/", candidate, fixed = TRUE)
  candidate <- gsub(" multiplied by ", "*", candidate, fixed = TRUE)
  candidate <- gsub(" times ", "*", candidate, fixed = TRUE)
  candidate <- gsub(" plus ", "+", candidate, fixed = TRUE)
  candidate <- gsub(" minus ", "-", candidate, fixed = TRUE)
  candidate <- trimws(candidate)

  if (candidate == "") return(NULL)
  if (!grepl("^[a-zA-Z0-9+*/^%(),!. \\-]+$", candidate)) return(NULL)

  has_digit <- grepl("[0-9]", candidate)
  parts <- strsplit(candidate, "[^a-zA-Z]+")[[1]]
  has_constant <- any(parts %in% c("pi", "e"))
  if (!has_digit && !has_constant) return(NULL)

  result <- evaluate(candidate)
  if (!result$ok) {
    if (!result$limit) return(NULL)
    return(list(
      intent = "math-limit",
      text = paste0(
        "That expression does not produce a finite number (for example, division by ",
        "zero, an invalid function domain or numeric overflow), so I will not present ",
        "it as a normal result."
      )
    ))
  }

  shown <- format_number(result$value)
  display <- gsub("*", "\u00d7", candidate, fixed = TRUE)
  trig <- grepl("sin\\(|cos\\(|tan\\(|asin\\(|acos\\(|atan\\(", candidate)
  note <- if (trig) "\n\nTrigonometric functions use radians." else ""
  list(intent = "math", text = paste0("**", shown, "**\n\nExpression: ", display, " = ", shown, note))
}

LIVE_WORDS <- c(
  "weather", "news", "stock price", "score", "who won", "latest",
  "headlines", "browse", "search the web"
)

answer <- function(prompt) {
  text <- trimws(prompt)
  if (text == "") {
    return(list(
      intent = "empty",
      text = paste0(
        "Ask me for arithmetic, percentages or a unit conversion. I answer on this ",
        "device, so there is no network round trip."
      )
    ))
  }

  lowered <- normalize(text)

  percent <- percent_intent(lowered)
  if (percent != "") return(list(intent = "percent", text = percent))

  unit <- unit_intent(lowered)
  if (unit != "") return(list(intent = "units", text = unit))

  math <- math_intent(lowered)
  if (!is.null(math)) return(math)

  for (word in LIVE_WORDS) {
    if (grepl(word, lowered, fixed = TRUE)) {
      return(list(
        intent = "live",
        text = paste0(
          "I cannot check live information \u2014 this engine has no network access, and ",
          "it will not invent an answer.\n\nSwitch to a connected hosted model for current ",
          "facts, or paste the source text here and I will help you reason about it."
        )
      ))
    }
  }

  list(
    intent = "fallback",
    text = paste0(
      "I want to be straight with you: **this is a small on-device engine**, and that ",
      "question is outside what it can answer reliably.\n\nIt is solid on:\n\n",
      "- arithmetic and percentages\n- unit and temperature conversions\n\n",
      "Switch to a hosted model for open-ended writing, code review or live information."
    )
  )
}

# --------------------------------------------------------------------------
# conformance runner
# --------------------------------------------------------------------------

run_vectors <- function(path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  failures <- character(0)
  checked <- 0

  for (offset in seq_along(lines)) {
    number <- offset
    line <- sub("\r$", "", lines[offset])
    if (grepl("^[[:space:]]*$", line) || startsWith(line, "#")) next

    fields <- strsplit(line, "\t", fixed = TRUE)[[1]]
    if (length(fields) < 3) {
      failures <- c(failures, paste0("line ", number, ": expected at least 3 columns"))
      next
    }
    checked <- checked + 1

    if (fields[1] == "eval") {
      result <- evaluate(fields[2])
      if (!result$ok) {
        failures <- c(failures, paste0("line ", number, ": '", fields[2], "' -> error"))
        next
      }
      expected <- as.numeric(fields[3])
      tolerance <- 1e-9 * max(1, abs(expected))
      if (abs(result$value - expected) > tolerance) {
        failures <- c(failures, paste0(
          "line ", number, ": '", fields[2], "' -> ", result$value, ", wanted ", fields[3]
        ))
      }
      next
    }

    result <- answer(fields[2])
    if (result$intent != fields[3]) {
      failures <- c(failures, paste0(
        "line ", number, ": '", fields[2], "' -> intent ", result$intent, ", wanted ", fields[3]
      ))
      next
    }
    if (length(fields) >= 4 && nzchar(fields[4])) {
      for (fragment in strsplit(fields[4], "|", fixed = TRUE)[[1]]) {
        if (!grepl(fragment, result$text, fixed = TRUE)) {
          failures <- c(failures, paste0(
            "line ", number, ": '", fields[2], "' -> text missing '", fragment, "'"
          ))
          break
        }
      }
    }
  }

  if (length(failures) > 0) {
    for (failure in failures) cat("FAIL ", failure, "\n", sep = "")
    cat(length(failures), " failure(s) out of ", checked, " case(s)\n", sep = "")
    return(1L)
  }
  cat("ok: ", checked, " cases\n", sep = "")
  0L
}

args <- commandArgs(trailingOnly = TRUE)
target <- if (length(args) >= 1) args[1] else "../vectors.tsv"
status <- run_vectors(target)
quit(status = status)
