//! Arithmetic evaluator.
//!
//! A Pratt parser over a small hand-written tokenizer: no `eval`, no scripting
//! runtime, no allocation-heavy AST. It accepts the notation people actually
//! type into a calculator (`2(3+4)`, `2pi`, `3!`, `sqrt 9`) and rejects
//! everything else with an error rather than a best guess.

use std::fmt;

/// Why an expression could not be evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalError {
    /// A character that is not part of the supported notation.
    UnexpectedCharacter,
    /// A numeric literal that could not be represented as a finite `f64`.
    BadNumber,
    /// The token stream did not form a complete expression.
    Parse,
    /// A function was called with the wrong number of arguments.
    ArgumentCount,
    /// Factorial of a negative, fractional or very large value.
    FactorialDomain,
}

impl fmt::Display for EvalError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            EvalError::UnexpectedCharacter => "unexpected character",
            EvalError::BadNumber => "number out of range",
            EvalError::Parse => "could not parse expression",
            EvalError::ArgumentCount => "wrong number of arguments",
            EvalError::FactorialDomain => "factorial is defined here only for 0..=170",
        };
        f.write_str(text)
    }
}

impl std::error::Error for EvalError {}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Num(f64),
    Ident(String),
    Op(char),
    LParen,
    RParen,
    Comma,
}

/// Evaluate an arithmetic expression.
///
/// ```
/// assert_eq!(eltes_cai::evaluate("2 + 3 * 4").unwrap(), 14.0);
/// assert_eq!(eltes_cai::evaluate("2(3+4)").unwrap(), 14.0);
/// assert!(eltes_cai::evaluate("rm -rf /").is_err());
/// ```
pub fn evaluate(source: &str) -> Result<f64, EvalError> {
    let tokens = tokenize(source)?;
    if tokens.is_empty() {
        return Err(EvalError::Parse);
    }
    let mut parser = Parser { tokens: &tokens, pos: 0 };
    let value = parser.expression(0)?;
    if parser.pos != tokens.len() {
        return Err(EvalError::Parse);
    }
    Ok(value)
}

fn prepare(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for ch in source.chars() {
        match ch {
            '\u{00d7}' | '\u{2715}' | '\u{2716}' => out.push('*'),
            '\u{00f7}' => out.push('/'),
            '\u{2212}' | '\u{2013}' | '\u{2014}' => out.push('-'),
            '\u{00b2}' => out.push_str("^2"),
            '\u{00b3}' => out.push_str("^3"),
            ',' => out.push(','),
            _ => out.push(ch),
        }
    }
    // `2 x 3` is a common calculator spelling of `2 * 3`; only rewrite it when
    // digits sit on both sides, so words like "x" stay untouched.
    let chars: Vec<char> = out.chars().collect();
    let mut rewritten = String::with_capacity(out.len());
    for (index, ch) in chars.iter().enumerate() {
        if (*ch == 'x' || *ch == 'X')
            && index > 0
            && index + 1 < chars.len()
            && chars[index - 1].is_ascii_digit()
            && chars[index + 1].is_ascii_digit()
        {
            rewritten.push('*');
        } else {
            rewritten.push(*ch);
        }
    }
    rewritten
}

fn tokenize(source: &str) -> Result<Vec<Token>, EvalError> {
    let prepared = prepare(source);
    let chars: Vec<char> = prepared.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch.is_whitespace() {
            index += 1;
            continue;
        }

        let starts_number = ch.is_ascii_digit()
            || (ch == '.' && index + 1 < chars.len() && chars[index + 1].is_ascii_digit());
        if starts_number {
            let start = index;
            while index < chars.len() && chars[index].is_ascii_digit() {
                index += 1;
            }
            if index < chars.len() && chars[index] == '.' {
                index += 1;
                while index < chars.len() && chars[index].is_ascii_digit() {
                    index += 1;
                }
            }
            if index < chars.len() && (chars[index] == 'e' || chars[index] == 'E') {
                let mut probe = index + 1;
                if probe < chars.len() && (chars[probe] == '+' || chars[probe] == '-') {
                    probe += 1;
                }
                if probe < chars.len() && chars[probe].is_ascii_digit() {
                    while probe < chars.len() && chars[probe].is_ascii_digit() {
                        probe += 1;
                    }
                    index = probe;
                }
            }
            let literal: String = chars[start..index].iter().collect();
            let value: f64 = literal.parse().map_err(|_| EvalError::BadNumber)?;
            if !value.is_finite() {
                return Err(EvalError::BadNumber);
            }
            tokens.push(Token::Num(value));
            continue;
        }

        if ch.is_ascii_alphabetic() {
            let start = index;
            while index < chars.len() && chars[index].is_ascii_alphabetic() {
                index += 1;
            }
            let name: String = chars[start..index].iter().collect();
            tokens.push(Token::Ident(name.to_ascii_lowercase()));
            continue;
        }

        match ch {
            '+' | '-' | '*' | '/' | '^' | '%' | '!' => {
                tokens.push(Token::Op(ch));
                index += 1;
            }
            '(' => {
                tokens.push(Token::LParen);
                index += 1;
            }
            ')' => {
                tokens.push(Token::RParen);
                index += 1;
            }
            ',' => {
                tokens.push(Token::Comma);
                index += 1;
            }
            _ => return Err(EvalError::UnexpectedCharacter),
        }
    }

    Ok(insert_implicit_products(tokens))
}

fn ends_value(token: &Token) -> bool {
    match token {
        Token::Num(_) | Token::RParen => true,
        Token::Ident(name) => name == "pi" || name == "e",
        _ => false,
    }
}

fn starts_value(token: &Token) -> bool {
    matches!(token, Token::Num(_) | Token::Ident(_) | Token::LParen)
}

fn insert_implicit_products(tokens: Vec<Token>) -> Vec<Token> {
    let mut out = Vec::with_capacity(tokens.len() + 4);
    for token in tokens {
        if let Some(previous) = out.last() {
            let is_call = matches!(previous, Token::Ident(name) if is_function(name))
                && token == Token::LParen;
            if ends_value(previous) && starts_value(&token) && !is_call {
                out.push(Token::Op('*'));
            }
        }
        out.push(token);
    }
    out
}

fn is_function(name: &str) -> bool {
    matches!(
        name,
        "sqrt"
            | "cbrt"
            | "abs"
            | "sin"
            | "cos"
            | "tan"
            | "asin"
            | "acos"
            | "atan"
            | "ln"
            | "log"
            | "log10"
            | "log2"
            | "exp"
            | "floor"
            | "ceil"
            | "round"
            | "min"
            | "max"
            | "sum"
            | "mean"
            | "product"
            | "pow"
    )
}

fn single(args: &[f64]) -> Result<f64, EvalError> {
    match args {
        [value] => Ok(*value),
        _ => Err(EvalError::ArgumentCount),
    }
}

fn call_function(name: &str, args: &[f64]) -> Result<f64, EvalError> {
    match name {
        "sqrt" => Ok(single(args)?.sqrt()),
        "cbrt" => Ok(single(args)?.cbrt()),
        "abs" => Ok(single(args)?.abs()),
        "sin" => Ok(single(args)?.sin()),
        "cos" => Ok(single(args)?.cos()),
        "tan" => Ok(single(args)?.tan()),
        "asin" => Ok(single(args)?.asin()),
        "acos" => Ok(single(args)?.acos()),
        "atan" => Ok(single(args)?.atan()),
        "ln" => Ok(single(args)?.ln()),
        "log10" => Ok(single(args)?.log10()),
        "log2" => Ok(single(args)?.log2()),
        "exp" => Ok(single(args)?.exp()),
        "floor" => Ok(single(args)?.floor()),
        "ceil" => Ok(single(args)?.ceil()),
        "round" => Ok(single(args)?.round()),
        "log" => match args.len() {
            1 => Ok(args[0].ln()),
            2 => Ok(args[0].ln() / args[1].ln()),
            _ => Err(EvalError::ArgumentCount),
        },
        "pow" => {
            if args.len() == 2 {
                Ok(args[0].powf(args[1]))
            } else {
                Err(EvalError::ArgumentCount)
            }
        }
        "min" => aggregate(args, f64::min),
        "max" => aggregate(args, f64::max),
        "sum" => {
            if args.is_empty() {
                return Err(EvalError::ArgumentCount);
            }
            Ok(args.iter().sum())
        }
        "mean" => {
            if args.is_empty() {
                return Err(EvalError::ArgumentCount);
            }
            Ok(args.iter().sum::<f64>() / args.len() as f64)
        }
        "product" => {
            if args.is_empty() {
                return Err(EvalError::ArgumentCount);
            }
            Ok(args.iter().product())
        }
        _ => Err(EvalError::Parse),
    }
}

fn aggregate(args: &[f64], combine: fn(f64, f64) -> f64) -> Result<f64, EvalError> {
    let mut iter = args.iter().copied();
    let first = iter.next().ok_or(EvalError::ArgumentCount)?;
    Ok(iter.fold(first, combine))
}

fn factorial(value: f64) -> Result<f64, EvalError> {
    if value < 0.0 || value.fract() != 0.0 || value > 170.0 {
        return Err(EvalError::FactorialDomain);
    }
    let mut result = 1.0_f64;
    let mut step = 2.0_f64;
    while step <= value {
        result *= step;
        step += 1.0;
    }
    Ok(result)
}

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<Token> {
        self.tokens.get(self.pos).cloned()
    }

    fn eat(&mut self, token: Token) -> Result<(), EvalError> {
        if self.peek().as_ref() == Some(&token) {
            self.pos += 1;
            Ok(())
        } else {
            Err(EvalError::Parse)
        }
    }

    fn expression(&mut self, min_precedence: u8) -> Result<f64, EvalError> {
        let mut left = self.primary()?;

        while let Some(Token::Op('!')) = self.peek() {
            self.pos += 1;
            left = factorial(left)?;
        }

        loop {
            let (op, precedence) = match self.peek() {
                Some(Token::Op(op)) => match op {
                    '+' => ('+', 1),
                    '-' => ('-', 1),
                    '*' => ('*', 2),
                    '/' => ('/', 2),
                    '%' => ('%', 2),
                    '^' => ('^', 3),
                    _ => break,
                },
                _ => break,
            };
            if precedence < min_precedence {
                break;
            }
            self.pos += 1;
            let next_min = if op == '^' { precedence } else { precedence + 1 };
            let right = self.expression(next_min)?;
            left = match op {
                '+' => left + right,
                '-' => left - right,
                '*' => left * right,
                '/' => left / right,
                '%' => left % right,
                '^' => left.powf(right),
                _ => return Err(EvalError::Parse),
            };
        }

        Ok(left)
    }

    fn primary(&mut self) -> Result<f64, EvalError> {
        let token = self.peek().ok_or(EvalError::Parse)?;
        match token {
            Token::Num(value) => {
                self.pos += 1;
                Ok(value)
            }
            Token::Op(sign @ ('-' | '+')) => {
                self.pos += 1;
                let value = self.expression(3)?;
                Ok(if sign == '-' { -value } else { value })
            }
            Token::LParen => {
                self.pos += 1;
                let value = self.expression(0)?;
                self.eat(Token::RParen)?;
                Ok(value)
            }
            Token::Ident(name) => {
                self.pos += 1;
                if matches!(self.peek(), Some(Token::LParen)) && is_function(&name) {
                    self.pos += 1;
                    let mut args = Vec::new();
                    if !matches!(self.peek(), Some(Token::RParen)) {
                        args.push(self.expression(0)?);
                        while matches!(self.peek(), Some(Token::Comma)) {
                            self.pos += 1;
                            args.push(self.expression(0)?);
                        }
                    }
                    self.eat(Token::RParen)?;
                    return call_function(&name, &args);
                }
                if name == "pi" {
                    return Ok(std::f64::consts::PI);
                }
                if name == "e" {
                    return Ok(std::f64::consts::E);
                }
                Err(EvalError::Parse)
            }
            _ => Err(EvalError::Parse),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(left: f64, right: f64) -> bool {
        (left - right).abs() < 1e-9
    }

    #[test]
    fn respects_precedence() {
        assert_eq!(evaluate("2 + 3 * 4").unwrap(), 14.0);
        assert_eq!(evaluate("(2 + 3) * 4").unwrap(), 20.0);
        assert_eq!(evaluate("2 ^ 3 ^ 2").unwrap(), 512.0);
        assert_eq!(evaluate("-2 ^ 2").unwrap(), -4.0);
        assert_eq!(evaluate("10 % 3").unwrap(), 1.0);
    }

    #[test]
    fn handles_implicit_multiplication() {
        assert_eq!(evaluate("2(3+4)").unwrap(), 14.0);
        assert_eq!(evaluate("(1+1)(2+2)").unwrap(), 8.0);
        assert!(close(evaluate("2pi").unwrap(), std::f64::consts::TAU));
        assert_eq!(evaluate("2 x 3").unwrap(), 6.0);
    }

    #[test]
    fn supports_functions_and_factorial() {
        assert_eq!(evaluate("sqrt(144)").unwrap(), 12.0);
        assert_eq!(evaluate("3!").unwrap(), 6.0);
        assert_eq!(evaluate("max(3, 9, 4)").unwrap(), 9.0);
        assert_eq!(evaluate("mean(2, 4, 6)").unwrap(), 4.0);
        // ln(8)/ln(2) lands a hair under 3 in binary floating point.
        assert!(close(evaluate("log(8, 2)").unwrap(), 3.0));
        assert!(matches!(evaluate("sqrt(1, 2)"), Err(EvalError::ArgumentCount)));
        assert!(matches!(evaluate("(-1)!"), Err(EvalError::FactorialDomain)));
    }

    #[test]
    fn rejects_text() {
        assert!(evaluate("rm -rf /").is_err());
        assert!(evaluate("2 +").is_err());
        assert!(evaluate("").is_err());
    }
}
