//! A small, forgiving arithmetic parser.
//!
//! It accepts the notation people actually type into a calculator:
//!
//! ```text
//! 2 + 3 * 4      2(3+4)      2pi      3!      2^10      -2^2
//! sqrt(144)      max(3, 9)   log(8, 2)        12 km -> handled elsewhere
//! ```
//!
//! Implicit multiplication is inserted between a value and a following value,
//! `^` is right-associative, and unary minus binds tighter than `^` (so
//! `-2^2` is `-4`, matching the browser engine).

use std::fmt;

/// Why an expression could not be evaluated.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EvalError {
    /// A character outside the calculator alphabet.
    UnexpectedCharacter,
    /// A numeric literal that does not parse into a finite number.
    BadNumber,
    /// A structurally incomplete expression.
    Parse,
    /// A function called with the wrong number of arguments.
    ArgumentCount,
    /// A factorial of something that is not a whole number from 0 to 170.
    FactorialDomain,
}

impl fmt::Display for EvalError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            EvalError::UnexpectedCharacter => "unexpected character",
            EvalError::BadNumber => "bad number",
            EvalError::Parse => "could not parse the expression",
            EvalError::ArgumentCount => "wrong number of arguments",
            EvalError::FactorialDomain => "factorial needs a whole number from 0 to 170",
        };
        formatter.write_str(text)
    }
}

impl std::error::Error for EvalError {}

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Number(f64),
    Ident(String),
    Op(char),
    Open,
    Close,
    Comma,
}

const FUNCTIONS: &[&str] = &[
    "sqrt", "cbrt", "abs", "sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "log10",
    "log2", "exp", "floor", "ceil", "round", "min", "max", "sum", "mean", "product", "pow",
];

/// Is `name` one of the functions the engine knows?
pub fn is_function(name: &str) -> bool {
    FUNCTIONS.contains(&name)
}

/// Evaluate a bare arithmetic expression.
pub fn evaluate(source: &str) -> Result<f64, EvalError> {
    let tokens = tokenize(source)?;
    if tokens.is_empty() {
        return Err(EvalError::Parse);
    }
    let mut parser = Parser {
        tokens: &tokens,
        position: 0,
    };
    let value = parser.expression(0)?;
    if parser.position != tokens.len() {
        return Err(EvalError::Parse);
    }
    Ok(value)
}

/// Rewrite calculator notation into plain arithmetic:
/// `×`, `÷`, typographic minus signs, superscripts, and the `2 x 3` spelling
/// of multiplication (only between digits, so `x` stays an unknown name).
fn prepare(source: &str) -> String {
    let characters: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut index = 0;

    while index < characters.len() {
        match characters[index] {
            '×' | '✕' | '✖' => {
                out.push('*');
                index += 1;
            }
            '÷' => {
                out.push('/');
                index += 1;
            }
            '−' | '–' | '—' => {
                out.push('-');
                index += 1;
            }
            '²' => {
                out.push_str("^2");
                index += 1;
            }
            '³' => {
                out.push_str("^3");
                index += 1;
            }
            'x' | 'X' => {
                let trimmed: Vec<char> = out.chars().collect();
                let digit_before = trimmed
                    .iter()
                    .rev()
                    .find(|character| !character.is_whitespace())
                    .is_some_and(|character| character.is_ascii_digit());
                let mut probe = index + 1;
                while probe < characters.len() && characters[probe].is_whitespace() {
                    probe += 1;
                }
                let digit_after = probe < characters.len() && characters[probe].is_ascii_digit();
                out.push(if digit_before && digit_after { '*' } else { characters[index] });
                index += 1;
            }
            other => {
                out.push(other);
                index += 1;
            }
        }
    }

    out
}

fn tokenize(source: &str) -> Result<Vec<Token>, EvalError> {
    let prepared = prepare(source);
    let characters: Vec<char> = prepared.chars().collect();
    let mut tokens = Vec::new();
    let mut index = 0;

    while index < characters.len() {
        let character = characters[index];

        if character.is_whitespace() {
            index += 1;
            continue;
        }

        if character.is_ascii_digit()
            || (character == '.' && index + 1 < characters.len() && characters[index + 1].is_ascii_digit())
        {
            let start = index;
            while index < characters.len() && characters[index].is_ascii_digit() {
                index += 1;
            }
            if index < characters.len() && characters[index] == '.' {
                index += 1;
                while index < characters.len() && characters[index].is_ascii_digit() {
                    index += 1;
                }
            }
            if index < characters.len() && (characters[index] == 'e' || characters[index] == 'E') {
                let mut probe = index + 1;
                if probe < characters.len() && (characters[probe] == '+' || characters[probe] == '-') {
                    probe += 1;
                }
                if probe < characters.len() && characters[probe].is_ascii_digit() {
                    while probe < characters.len() && characters[probe].is_ascii_digit() {
                        probe += 1;
                    }
                    index = probe;
                }
            }
            let literal: String = characters[start..index].iter().collect();
            let value: f64 = literal.parse().map_err(|_| EvalError::BadNumber)?;
            if !value.is_finite() {
                return Err(EvalError::BadNumber);
            }
            tokens.push(Token::Number(value));
            continue;
        }

        if character.is_ascii_alphabetic() {
            let start = index;
            while index < characters.len() && characters[index].is_ascii_alphabetic() {
                index += 1;
            }
            let name: String = characters[start..index].iter().collect();
            tokens.push(Token::Ident(name.to_ascii_lowercase()));
            continue;
        }

        match character {
            '+' | '-' | '*' | '/' | '^' | '%' | '!' => {
                tokens.push(Token::Op(character));
                index += 1;
            }
            '(' => {
                tokens.push(Token::Open);
                index += 1;
            }
            ')' => {
                tokens.push(Token::Close);
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
        Token::Number(_) | Token::Close => true,
        Token::Ident(name) => name.as_str() == "pi" || name.as_str() == "e",
        _ => false,
    }
}

fn starts_value(token: &Token) -> bool {
    matches!(token, Token::Number(_) | Token::Ident(_) | Token::Open)
}

fn insert_implicit_products(tokens: Vec<Token>) -> Vec<Token> {
    let mut expanded = Vec::with_capacity(tokens.len() + 4);
    for token in tokens {
        let previous = expanded.last().cloned();
        if let Some(previous) = previous {
            let is_call = matches!(&previous, Token::Ident(name) if is_function(name))
                && matches!(token, Token::Open);
            if ends_value(&previous) && starts_value(&token) && !is_call {
                expanded.push(Token::Op('*'));
            }
        }
        expanded.push(token);
    }
    expanded
}

struct Parser<'a> {
    tokens: &'a [Token],
    position: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.position)
    }

    fn expression(&mut self, min_precedence: u8) -> Result<f64, EvalError> {
        let mut left = self.primary()?;

        while matches!(self.peek(), Some(Token::Op('!'))) {
            self.position += 1;
            left = factorial(left)?;
        }

        while let Some(Token::Op(operator)) = self.peek().cloned() {
            let precedence = match operator {
                '+' | '-' => 1,
                '*' | '/' | '%' => 2,
                '^' => 3,
                _ => break,
            };
            if precedence < min_precedence {
                break;
            }
            self.position += 1;
            let next = if operator == '^' {
                precedence
            } else {
                precedence + 1
            };
            let right = self.expression(next)?;
            left = match operator {
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
        let token = self.peek().cloned().ok_or(EvalError::Parse)?;
        self.position += 1;

        match token {
            Token::Number(value) => Ok(value),
            Token::Op(sign @ ('-' | '+')) => {
                let value = self.expression(3)?;
                Ok(if sign == '-' { -value } else { value })
            }
            Token::Open => {
                let value = self.expression(0)?;
                if !matches!(self.peek(), Some(Token::Close)) {
                    return Err(EvalError::Parse);
                }
                self.position += 1;
                Ok(value)
            }
            Token::Ident(name) => {
                if matches!(self.peek(), Some(Token::Open)) && is_function(&name) {
                    self.position += 1;
                    let mut arguments = Vec::new();
                    if !matches!(self.peek(), Some(Token::Close)) {
                        arguments.push(self.expression(0)?);
                        while matches!(self.peek(), Some(Token::Comma)) {
                            self.position += 1;
                            arguments.push(self.expression(0)?);
                        }
                    }
                    if !matches!(self.peek(), Some(Token::Close)) {
                        return Err(EvalError::Parse);
                    }
                    self.position += 1;
                    return call_function(&name, &arguments);
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

fn factorial(value: f64) -> Result<f64, EvalError> {
    if value < 0.0 || value.fract() != 0.0 || value > 170.0 {
        return Err(EvalError::FactorialDomain);
    }
    let mut result = 1.0;
    let mut step = 2.0;
    while step <= value {
        result *= step;
        step += 1.0;
    }
    Ok(result)
}

fn unary(arguments: &[f64]) -> Result<f64, EvalError> {
    match arguments {
        [value] => Ok(*value),
        _ => Err(EvalError::ArgumentCount),
    }
}

fn aggregate(arguments: &[f64], start: f64, combine: fn(f64, f64) -> f64) -> Result<f64, EvalError> {
    if arguments.is_empty() {
        return Err(EvalError::ArgumentCount);
    }
    Ok(arguments.iter().copied().fold(start, combine))
}

fn call_function(name: &str, arguments: &[f64]) -> Result<f64, EvalError> {
    let value = match name {
        "sqrt" => unary(arguments)?.sqrt(),
        "cbrt" => unary(arguments)?.cbrt(),
        "abs" => unary(arguments)?.abs(),
        "sin" => unary(arguments)?.sin(),
        "cos" => unary(arguments)?.cos(),
        "tan" => unary(arguments)?.tan(),
        "asin" => unary(arguments)?.asin(),
        "acos" => unary(arguments)?.acos(),
        "atan" => unary(arguments)?.atan(),
        "ln" => unary(arguments)?.ln(),
        "log10" => unary(arguments)?.log10(),
        "log2" => unary(arguments)?.log2(),
        "exp" => unary(arguments)?.exp(),
        "floor" => unary(arguments)?.floor(),
        "ceil" => unary(arguments)?.ceil(),
        "round" => unary(arguments)?.round(),
        "log" => match arguments {
            [value] => value.ln(),
            [value, base] => value.ln() / base.ln(),
            _ => return Err(EvalError::ArgumentCount),
        },
        "pow" => match arguments {
            [base, exponent] => base.powf(*exponent),
            _ => return Err(EvalError::ArgumentCount),
        },
        "min" => aggregate(arguments, f64::INFINITY, f64::min)?,
        "max" => aggregate(arguments, f64::NEG_INFINITY, f64::max)?,
        "sum" => aggregate(arguments, 0.0, |total, next| total + next)?,
        "product" => aggregate(arguments, 1.0, |total, next| total * next)?,
        "mean" => aggregate(arguments, 0.0, |total, next| total + next)? / arguments.len() as f64,
        _ => return Err(EvalError::Parse),
    };
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::{evaluate, EvalError};

    fn value(source: &str) -> f64 {
        evaluate(source).expect("expression should evaluate")
    }

    #[test]
    fn respects_precedence_and_parentheses() {
        assert_eq!(value("2 + 3 * 4"), 14.0);
        assert_eq!(value("(2 + 3) * 4"), 20.0);
        assert_eq!(value("10 / 4"), 2.5);
        assert_eq!(value("10 % 3"), 1.0);
    }

    #[test]
    fn power_is_right_associative_and_binds_below_unary_minus() {
        assert_eq!(value("2^3^2"), 512.0);
        assert_eq!(value("-2^2"), -4.0);
        assert_eq!(value("(-2)^2"), 4.0);
    }

    #[test]
    fn inserts_implicit_multiplication() {
        assert_eq!(value("2(3+4)"), 14.0);
        assert_eq!(value("(1+1)(2+2)"), 8.0);
        assert!((value("2pi") - std::f64::consts::TAU).abs() < 1e-12);
    }

    #[test]
    fn understands_functions() {
        assert_eq!(value("sqrt(144)"), 12.0);
        assert_eq!(value("max(3, 9, 4)"), 9.0);
        assert_eq!(value("mean(2, 4, 6)"), 4.0);
        assert!((value("log(8, 2)") - 3.0).abs() < 1e-12);
        assert_eq!(value("3!"), 6.0);
        assert_eq!(value("sqrt(9) + 1"), 4.0);
    }

    #[test]
    fn rejects_text_and_broken_expressions() {
        assert!(matches!(evaluate("what is the weather"), Err(EvalError::Parse)));
        assert_eq!(evaluate("2 +"), Err(EvalError::Parse));
        assert_eq!(evaluate("sqrt()"), Err(EvalError::ArgumentCount));
        assert_eq!(evaluate("(-1)!"), Err(EvalError::FactorialDomain));
    }
}
