//! Routing: turn a prompt into an intent and an answer.
//!
//! The order is deliberate and mirrors the browser engine:
//!
//! ```text
//! empty → percentage → unit conversion → date → arithmetic → live refusal → fallback
//! ```
//!
//! Anything the engine cannot ground ends in the fallback or the live refusal.
//! There is no guessing step and no hidden model: if a route does not apply,
//! the answer says so.

use crate::dates;
use crate::number::format_number;
use crate::parser;
use crate::units;

/// What kind of answer was produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent {
    /// Nothing was asked.
    Empty,
    /// Arithmetic.
    Math,
    /// A percentage calculation.
    Percent,
    /// A unit or temperature conversion.
    Units,
    /// Calendar arithmetic.
    Date,
    /// An expression that does not produce a finite number.
    MathLimit,
    /// A question that needs current facts.
    Live,
    /// Everything else.
    Fallback,
}

impl Intent {
    /// The stable identifier used by the web app and the tests.
    pub fn as_str(self) -> &'static str {
        match self {
            Intent::Empty => "empty",
            Intent::Math => "math",
            Intent::Percent => "percent",
            Intent::Units => "units",
            Intent::Date => "date",
            Intent::MathLimit => "math-limit",
            Intent::Live => "live",
            Intent::Fallback => "fallback",
        }
    }
}

/// A routed answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    /// Which route produced the answer.
    pub intent: Intent,
    /// The text shown to the person who asked.
    pub text: String,
}

impl Answer {
    /// Build an answer from an intent and any string-like text.
    pub fn new(intent: Intent, text: impl Into<String>) -> Self {
        Self {
            intent,
            text: text.into(),
        }
    }
}

const EMPTY_TEXT: &str = "Ask me for arithmetic, percentages, a unit conversion or a date calculation. \
I answer on this device, so there is no network round trip.";

const LIVE_TEXT: &str = "I cannot check live information — this engine has no network access, and I \
will not invent an answer.

Switch to a connected hosted model for current facts, or paste the source text here and I will help \
you reason about it.";

const FALLBACK_TEXT: &str = "I want to be straight with you: **this is a small on-device engine**, and \
that question is outside what it can answer reliably.

It is solid on:

- arithmetic, percentages and unit conversions
- temperatures, dates and calendar arithmetic

Switch to a hosted model for open-ended writing, code review or live information.";

const LIVE_WORDS: &[&str] = &[
    "weather",
    "news",
    "stock price",
    "score",
    "who won",
    "latest",
    "headlines",
    "browse",
    "search the web",
];

/// Answer a prompt.
///
/// ```
/// let answer = eltes_cai::answer("12 km to miles");
/// assert_eq!(answer.intent, eltes_cai::Intent::Units);
/// assert!(answer.text.contains("7.4564543068"));
/// ```
pub fn answer(prompt: &str) -> Answer {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Answer::new(Intent::Empty, EMPTY_TEXT);
    }

    let lowered = trimmed.to_lowercase();

    if let Some(text) = percent_intent(&lowered) {
        return Answer::new(Intent::Percent, text);
    }

    if let Some(text) = unit_intent(&lowered) {
        return Answer::new(Intent::Units, text);
    }

    if let Some(answer) = date_intent(&lowered) {
        return answer;
    }

    if let Some(answer) = math_intent(trimmed) {
        return answer;
    }

    if LIVE_WORDS.iter().any(|word| lowered.contains(*word)) {
        return Answer::new(Intent::Live, LIVE_TEXT);
    }

    Answer::new(Intent::Fallback, FALLBACK_TEXT)
}

// --------------------------------------------------------------------------
// percentages
// --------------------------------------------------------------------------

fn percent_intent(text: &str) -> Option<String> {
    let normalized = text.replace('%', " percent ");
    let words: Vec<&str> = normalized.split_whitespace().collect();

    for window in words.windows(4) {
        if window[1] != "percent" || (window[2] != "of" && window[2] != "off") {
            continue;
        }
        let (Ok(percent), Ok(base)) = (window[0].parse::<f64>(), window[3].parse::<f64>()) else {
            continue;
        };
        let part = percent / 100.0 * base;

        if window[2] == "off" {
            return Some(format!(
                "**{}** after {}% off {} (a discount of {}).",
                format_number(base - part),
                format_number(percent),
                format_number(base),
                format_number(part)
            ));
        }
        return Some(format!(
            "**{}** — {}% of {}.\n\n{} × {} / 100 = {}",
            format_number(part),
            format_number(percent),
            format_number(base),
            format_number(base),
            format_number(percent),
            format_number(part)
        ));
    }

    let mentions_change = ["percent", "increase", "decrease", "change"]
        .iter()
        .any(|word| text.contains(word));
    if !mentions_change {
        return None;
    }

    for window in words.windows(4) {
        if window[0] != "from" || window[2] != "to" {
            continue;
        }
        let (Ok(start), Ok(end)) = (window[1].parse::<f64>(), window[3].parse::<f64>()) else {
            continue;
        };
        if start == 0.0 {
            return Some(
                "Percentage change from zero is undefined because the calculation divides by the \
                 starting value. I will not report a finite percentage."
                    .to_string(),
            );
        }
        let change = (end - start) / start.abs() * 100.0;
        return Some(format!(
            "**{}%** change from {} to {}.\n\nFormula: ({} − {}) ÷ |{}| × 100",
            format_number(change),
            format_number(start),
            format_number(end),
            format_number(end),
            format_number(start),
            format_number(start)
        ));
    }

    None
}


/// Apply a list of literal replacements in order.
///
/// One helper rather than a chain of `str::replace` calls keeps the
/// normalisation tables readable and easy to extend.
fn replace_many(input: &str, pairs: &[(&str, &str)]) -> String {
    let mut out = input.to_string();
    for (from, to) in pairs {
        out = out.replace(from, to);
    }
    out
}

// --------------------------------------------------------------------------
// units
// --------------------------------------------------------------------------

fn unit_intent(text: &str) -> Option<String> {
    let prepared = replace_many(
        text,
        &[
            ("°", " "),
            ("degrees", " "),
            ("degree", " "),
            ("fahrenheit", " f "),
            ("celsius", " c "),
            ("centigrade", " c "),
            ("kelvin", " k "),
            ("miles per hour", " mph "),
            ("kilometers per hour", " km/h "),
            ("kilometres per hour", " km/h "),
        ],
    );
    let words: Vec<&str> = prepared.split_whitespace().collect();

    for (index, word) in words.iter().enumerate() {
        let Some((value, remainder)) = split_number(word) else {
            continue;
        };

        let (from, after_from) = if remainder.is_empty() {
            match words.get(index + 1) {
                Some(next) => (*next, index + 2),
                None => continue,
            }
        } else {
            (remainder, index + 1)
        };

        let Some(connector) = words.get(after_from) else {
            continue;
        };
        if !matches!(*connector, "to" | "in" | "into" | "as" | "->" | "→") {
            continue;
        }
        let Some(target) = words.get(after_from + 1).copied() else {
            continue;
        };

        if from.len() == 1 && target.len() == 1 {
            if let Some(converted) = units::temperature(value, from, target) {
                let from_label = from.to_uppercase();
                let to_label = target.to_uppercase();
                if from == target {
                    return Some(format!(
                        "{} °{from_label} is the same in °{to_label}.",
                        format_number(value)
                    ));
                }
                return Some(format!(
                    "**{} °{to_label}**\n\n`{} °{from_label} → {} °{to_label}`",
                    format_number(converted),
                    format_number(value),
                    format_number(converted)
                ));
            }
        }

        let Some(conversion) = units::convert(value, from, target) else {
            continue;
        };
        let converted = format_number(conversion.value);
        let note = if conversion.kind == units::Kind::Data {
            "Using decimal units (1 KB = 1,000 bytes)."
        } else {
            "Exact conversion factors."
        };
        return Some(format!(
            "**{converted} {target}**\n\n`{} {from} = {converted} {target}`\n\n{note}",
            format_number(value)
        ));
    }

    None
}

/// Split a leading number from the rest of a word: `"12km"` → `(12.0, "km")`.
fn split_number(word: &str) -> Option<(f64, &str)> {
    let bytes = word.as_bytes();
    let mut end = 0;
    if end < bytes.len() && (bytes[end] == b'+' || bytes[end] == b'-') {
        end += 1;
    }
    let digits = end;
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    if end < bytes.len() && bytes[end] == b'.' {
        end += 1;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
    }
    if end == digits {
        return None;
    }
    let value: f64 = word[..end].parse().ok()?;
    Some((value, &word[end..]))
}

// --------------------------------------------------------------------------
// dates
// --------------------------------------------------------------------------

fn format_date((year, month, day): (i32, u32, u32)) -> String {
    format!("{year}-{month:02}-{day:02}")
}

fn date_intent(text: &str) -> Option<Answer> {
    let mentioned: Vec<(i32, u32, u32)> = text.split_whitespace().filter_map(dates::parse_date).collect();
    let asks_about_days = text.contains("day") || text.contains("between") || text.contains("since");
    let asks_weekday = text.contains("weekday") || text.contains("day of the week");

    if mentioned.len() >= 2 && asks_about_days {
        let start = mentioned[0];
        let end = mentioned[1];
        let from = dates::days_from_civil(start.0, start.1, start.2);
        let to = dates::days_from_civil(end.0, end.1, end.2);
        let difference = to - from;
        let move_word = if difference < 0 { "before" } else { "after" };
        return Some(Answer::new(
            Intent::Date,
            format!(
                "**{} days**\n\n{} is {} {}.\n\nBoth endpoints are excluded; add one for an inclusive \
                 count.",
                difference.abs(),
                format_date(end),
                difference.abs(),
                move_word
            ),
        ));
    }

    if mentioned.len() == 1 && asks_weekday {
        let date = mentioned[0];
        return Some(Answer::new(
            Intent::Date,
            format!(
                "{} is a **{}**.",
                format_date(date),
                dates::weekday_name(date.0, date.1, date.2)
            ),
        ));
    }

    if mentioned.len() == 1 && (text.contains("until") || text.contains("till")) {
        let target = mentioned[0];
        let today = dates::today_utc();
        let difference = dates::days_from_civil(target.0, target.1, target.2)
            - dates::days_from_civil(today.0, today.1, today.2);
        let phrase = if difference < 0 {
            format!("{} days have passed since {}", difference.abs(), format_date(target))
        } else {
            format!("{} days remain until {}", difference, format_date(target))
        };
        return Some(Answer::new(
            Intent::Date,
            format!("**{phrase}**\n\nToday is {}, a {}.", format_date(today), dates::weekday_name(today.0, today.1, today.2)),
        ));
    }

    None
}

// --------------------------------------------------------------------------
// arithmetic
// --------------------------------------------------------------------------

const PREFIXES: &[&str] = &[
    "what is the value of ",
    "how much is ",
    "what is ",
    "what's ",
    "calculate ",
    "compute ",
    "solve ",
    "evaluate ",
];

fn math_intent(text: &str) -> Option<Answer> {
    let mut candidate = text.trim().to_string();
    for prefix in PREFIXES.iter().copied() {
        if let Some(rest) = candidate.strip_prefix(prefix) {
            candidate = rest.trim().to_string();
            break;
        }
    }

    candidate = candidate
        .trim_end_matches(['?', '=', ' '])
        .to_string();
    if let Some(rest) = candidate.strip_prefix("the ") {
        candidate = rest.trim().to_string();
    }
    candidate = replace_many(
        &candidate,
        &[
            ("−", "-"),
            ("–", "-"),
            ("—", "-"),
            ("²", "^2"),
            ("³", "^3"),
        ],
    );

    if let Some(rest) = candidate.strip_prefix("square root of ") {
        candidate = format!("sqrt({})", rest.trim());
    } else if let Some(rest) = candidate.strip_prefix("cube root of ") {
        candidate = format!("cbrt({})", rest.trim());
    } else if let Some(rest) = candidate.strip_prefix("factorial of ") {
        candidate = format!("{}!", rest.trim());
    } else if let Some(rest) = candidate.strip_suffix(" squared") {
        candidate = format!("({})^2", rest.trim());
    } else if let Some(rest) = candidate.strip_suffix(" cubed") {
        candidate = format!("({})^3", rest.trim());
    }

    let padded = format!(" {candidate} ");
    candidate = replace_many(
        &padded,
        &[
            (" to the power of ", "^"),
            (" divided by ", "/"),
            (" multiplied by ", "*"),
            (" times ", "*"),
            (" plus ", "+"),
            (" minus ", "-"),
        ],
    )
    .trim()
    .to_string();

    if candidate.is_empty() {
        return None;
    }
    let allowed = |character: char| {
        character.is_ascii_alphanumeric() || "+-*/^%(),!. ".contains(character)
    };
    if !candidate.chars().all(allowed) {
        return None;
    }

    let has_digit = candidate.chars().any(|character| character.is_ascii_digit());
    let has_constant = candidate
        .split(|character: char| !character.is_ascii_alphabetic())
        .any(|word| word == "pi" || word == "e");
    if !has_digit && !has_constant {
        return None;
    }

    let value = parser::evaluate(&candidate).ok()?;
    if !value.is_finite() {
        return Some(Answer::new(
            Intent::MathLimit,
            "That expression does not produce a finite number (for example, division by zero, an \
             invalid function domain or numeric overflow), so I will not present it as a normal result.",
        ));
    }

    let shown = format_number(value);
    let display = candidate.replace('*', "×");
    let trigonometric = ["sin(", "cos(", "tan(", "asin(", "acos(", "atan("]
        .iter()
        .any(|name| candidate.contains(*name));
    let note = if trigonometric {
        "\n\nTrigonometric functions use radians."
    } else {
        ""
    };
    Some(Answer::new(
        Intent::Math,
        format!("**{shown}**\n\nExpression: {display} = {shown}{note}"),
    ))
}

#[cfg(test)]
mod tests {
    use super::{answer, Intent};

    #[test]
    fn routes_arithmetic() {
        let result = answer("what is 2 + 3 * 4?");
        assert_eq!(result.intent, Intent::Math);
        assert!(result.text.contains("14"));
    }

    #[test]
    fn routes_percentages_before_arithmetic() {
        let discount = answer("20% off 80");
        assert_eq!(discount.intent, Intent::Percent);
        assert!(discount.text.contains("64"));
        assert!(discount.text.contains("discount of 16"));
        assert!(answer("percent change from 0 to 10").text.contains("undefined"));
    }

    #[test]
    fn routes_units() {
        let miles = answer("12 km to miles");
        assert_eq!(miles.intent, Intent::Units);
        assert!(miles.text.contains("7.4564543068"));

        let temperature = answer("72 f to c");
        assert!(temperature.text.contains("22.2222222222"));
    }

    #[test]
    fn refuses_live_questions_instead_of_guessing() {
        let result = answer("what is the weather in Boston");
        assert_eq!(result.intent, Intent::Live);
        assert!(result.text.contains("cannot check live information"));
    }

    #[test]
    fn falls_back_honestly() {
        let result = answer("Which antibiotic should I take for this infection?");
        assert_eq!(result.intent, Intent::Fallback);
        assert!(result.text.contains("outside what it can answer reliably"));
    }

    #[test]
    fn answers_calendar_questions() {
        let span = answer("days between 2026-01-01 and 2026-10-20");
        assert_eq!(span.intent, Intent::Date);
        assert!(span.text.contains("292"));

        let weekday = answer("what day of the week is 2026-10-20");
        assert!(weekday.text.contains("Tuesday"));
    }
}
