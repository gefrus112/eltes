//! Prompt routing.
//!
//! [`answer`] tries the supported intents in a fixed order and stops at the
//! first one that fits. When none fits it returns [`Intent::Fallback`] with the
//! same wording the web app uses — the engine is meant to say "that is outside
//! what I can answer" rather than produce something plausible and wrong.

use crate::number::format_number;
use crate::parser::evaluate;
use crate::units::{convert, temperature, Kind};

/// Which rule produced an answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent {
    /// Nothing was asked.
    Empty,
    /// A percentage question: `15% of 240`, `20% off 80`, `from 40 to 55`.
    Percent,
    /// A conversion: `12 km to miles`, `100 f to c`.
    Units,
    /// Arithmetic or a supported function.
    Math,
    /// An expression that has no finite value.
    MathLimit,
    /// A request for live facts, which this engine cannot have.
    Live,
    /// Outside the supported surface.
    Fallback,
}

impl Intent {
    /// The stable identifier used in JSON output and tests.
    pub fn as_str(self) -> &'static str {
        match self {
            Intent::Empty => "empty",
            Intent::Percent => "percent",
            Intent::Units => "units",
            Intent::Math => "math",
            Intent::MathLimit => "math-limit",
            Intent::Live => "live",
            Intent::Fallback => "fallback",
        }
    }
}

/// A finished answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    /// Which rule produced the text.
    pub intent: Intent,
    /// The answer, lightly marked up (`**bold**`, `` `code` ``) like the web app.
    pub text: String,
}

impl Answer {
    fn new(intent: Intent, text: impl Into<String>) -> Self {
        Self { intent, text: text.into() }
    }
}

/// Answer a prompt using only deterministic rules.
///
/// ```
/// let result = eltes_cai::answer("15% of 240");
/// assert_eq!(result.intent, eltes_cai::Intent::Percent);
/// assert!(result.text.contains("36"));
/// ```
pub fn answer(prompt: &str) -> Answer {
    let text = prompt.trim();
    if text.is_empty() {
        return Answer::new(
            Intent::Empty,
            "Ask me for arithmetic, percentages or a unit conversion. I answer on this device, so there is no network round trip.",
        );
    }

    let lowered = normalize(text);

    if let Some(result) = percent_intent(&lowered) {
        return result;
    }
    if let Some(result) = unit_intent(&lowered) {
        return result;
    }
    if let Some(result) = math_intent(&lowered) {
        return result;
    }
    if is_live_request(&lowered) {
        return Answer::new(
            Intent::Live,
            "I cannot check live information — this engine has no network access, and it will not invent an answer.\n\nSwitch to a connected hosted model for current facts, or paste the source text here and I will help you reason about it.",
        );
    }

    Answer::new(
        Intent::Fallback,
        "I want to be straight with you: **this is a small on-device engine**, and that question is outside what it can answer reliably.\n\nIt is solid on:\n\n- arithmetic and percentages\n- unit and temperature conversions\n\nSwitch to a hosted model for open-ended writing, code review or live information.",
    )
}

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .replace(['\u{2019}', '\u{2018}'], "'")
        .replace('\u{2212}', "-")
        .replace('\u{2013}', "-")
        .replace('\u{2014}', "-")
        .replace('\u{00b2}', "^2")
        .replace('\u{00b3}', "^3")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/* --------------------------------- percent -------------------------------- */

fn percent_intent(text: &str) -> Option<Answer> {
    let expanded = text.replace('%', " percent ");
    let words: Vec<&str> = expanded.split_whitespace().collect();

    for index in 0..words.len().saturating_sub(3) {
        if words[index + 1] != "percent" {
            continue;
        }
        let operator = words[index + 2];
        if operator != "of" && operator != "off" {
            continue;
        }
        let (Ok(percent), Ok(base)) =
            (words[index].parse::<f64>(), words[index + 3].parse::<f64>())
        else {
            continue;
        };

        let part = percent / 100.0 * base;
        let text = if operator == "off" {
            format!(
                "**{}** after {}% off {} (a discount of {}).",
                format_number(base - part),
                format_number(percent),
                format_number(base),
                format_number(part)
            )
        } else {
            format!(
                "**{}** — {}% of {}.\n\n{} × {} / 100 = {}",
                format_number(part),
                format_number(percent),
                format_number(base),
                format_number(base),
                format_number(percent),
                format_number(part)
            )
        };
        return Some(Answer::new(Intent::Percent, text));
    }

    if text.contains("percent") || text.contains("increase") || text.contains("decrease") || text.contains("change") {
        for index in 0..words.len().saturating_sub(3) {
            if words[index] != "from" || words[index + 2] != "to" {
                continue;
            }
            let (Ok(start), Ok(end)) = (words[index + 1].parse::<f64>(), words[index + 3].parse::<f64>()) else {
                continue;
            };
            if start == 0.0 {
                return Some(Answer::new(
                    Intent::Percent,
                    "Percentage change from zero is undefined because the calculation divides by the starting value. I will not report a finite percentage.",
                ));
            }
            let change = (end - start) / start.abs() * 100.0;
            return Some(Answer::new(
                Intent::Percent,
                format!(
                    "**{}%** change from {} to {}.\n\nFormula: ({} − {}) ÷ |{}| × 100",
                    format_number(change),
                    format_number(start),
                    format_number(end),
                    format_number(end),
                    format_number(start),
                    format_number(start)
                ),
            ));
        }
    }

    None
}

/* ---------------------------------- units --------------------------------- */

fn split_number(word: &str) -> Option<(f64, &str)> {
    let end = word
        .char_indices()
        .find(|(_, ch)| !(ch.is_ascii_digit() || *ch == '.' || *ch == '-' || *ch == '+'))
        .map(|(index, _)| index)
        .unwrap_or(word.len());
    if end == 0 {
        return None;
    }
    let value = word[..end].parse::<f64>().ok()?;
    Some((value, &word[end..]))
}

fn unit_intent(text: &str) -> Option<Answer> {
    let prepared = text
        .replace('°', " ")
        .replace("degrees", " ")
        .replace("degree", " ")
        .replace("fahrenheit", " f ")
        .replace("celsius", " c ")
        .replace("centigrade", " c ")
        .replace("kelvin", " k ");
    let words: Vec<&str> = prepared.split_whitespace().collect();

    for index in 0..words.len() {
        let Some((value, remainder)) = split_number(words[index]) else {
            continue;
        };

        let (from, cursor) = if remainder.trim().is_empty() {
            if index + 1 >= words.len() {
                continue;
            }
            (words[index + 1], index + 2)
        } else {
            (remainder, index + 1)
        };
        if cursor + 1 >= words.len() {
            continue;
        }
        let connector = words[cursor];
        if !matches!(connector, "to" | "in" | "into" | "as") {
            continue;
        }
        let to = words[cursor + 1];

        if from.len() == 1 && to.len() == 1 && is_temperature_unit(from) && is_temperature_unit(to) {
            let from_key = from.chars().next().unwrap_or('c');
            let to_key = to.chars().next().unwrap_or('c');
            let converted = temperature(value, from_key, to_key);
            let label_from = from_key.to_ascii_uppercase();
            let label_to = to_key.to_ascii_uppercase();
            if from_key == to_key {
                return Some(Answer::new(
                    Intent::Units,
                    format!(
                        "{} °{} is the same in °{}.",
                        format_number(value),
                        label_from,
                        label_to
                    ),
                ));
            }
            return Some(Answer::new(
                Intent::Units,
                format!(
                    "**{} °{}**\n\n`{} °{} → {} °{}`",
                    format_number(converted),
                    label_to,
                    format_number(value),
                    label_from,
                    format_number(converted),
                    label_to
                ),
            ));
        }

        let Some(conversion) = convert(value, from, to) else {
            continue;
        };
        let converted = format_number(conversion.value);
        let note = if conversion.kind == Kind::Data {
            "Using decimal units (1 KB = 1,000 bytes)."
        } else {
            "Exact conversion factors."
        };
        let text = format!(
            "**{} {}**\n\n`{} {} = {} {}`\n\n{}",
            converted,
            to,
            format_number(value),
            from,
            converted,
            to,
            note
        );
        return Some(Answer::new(Intent::Units, text));
    }

    None
}

fn is_temperature_unit(name: &str) -> bool {
    matches!(name, "c" | "f" | "k")
}

/* ----------------------------------- math --------------------------------- */

fn math_intent(text: &str) -> Option<Answer> {
    let mut candidate = text.to_string();
    for prefix in [
        "what's ",
        "what is ",
        "what is the value of ",
        "calculate ",
        "compute ",
        "solve ",
        "evaluate ",
        "how much is ",
    ] {
        if let Some(rest) = candidate.strip_prefix(prefix) {
            candidate = rest.to_string();
            break;
        }
    }
    candidate = candidate.trim().trim_end_matches(['?', '=']).trim().to_string();
    if let Some(rest) = candidate.strip_prefix("the ") {
        candidate = rest.to_string();
    }
    if let Some(rest) = candidate.strip_prefix("square root of ") {
        candidate = format!("sqrt({})", rest);
    } else if let Some(rest) = candidate.strip_prefix("cube root of ") {
        candidate = format!("cbrt({})", rest);
    } else if let Some(rest) = candidate.strip_prefix("factorial of ") {
        candidate = format!("{}!", rest);
    } else if let Some(rest) = candidate.strip_suffix(" squared") {
        candidate = format!("({})^2", rest);
    } else if let Some(rest) = candidate.strip_suffix(" cubed") {
        candidate = format!("({})^3", rest);
    }

    let padded = format!(" {} ", candidate);
    let padded = padded
        .replace(" to the power of ", "^")
        .replace(" divided by ", "/")
        .replace(" multiplied by ", "*")
        .replace(" times ", "*")
        .replace(" plus ", "+")
        .replace(" minus ", "-")
        .replace(" factorial", "!");
    let candidate = padded.trim().to_string();

    if candidate.is_empty() {
        return None;
    }
    let allowed = candidate
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || "+-*/^%(),!. ".contains(ch));
    if !allowed {
        return None;
    }
    let has_digit = candidate.chars().any(|ch| ch.is_ascii_digit());
    let has_constant = candidate.split(|ch: char| !ch.is_ascii_alphabetic()).any(|word| word == "pi" || word == "e");
    if !has_digit && !has_constant {
        return None;
    }

    match evaluate(&candidate) {
        Ok(value) if value.is_finite() => {
            let shown = format_number(value);
            let display = candidate.replace('*', "×");
            let note = if ["sin(", "cos(", "tan(", "asin(", "acos(", "atan("]
                .iter()
                .any(|name| candidate.contains(name))
            {
                "\n\nTrigonometric functions use radians."
            } else {
                ""
            };
            Some(Answer::new(
                Intent::Math,
                format!("**{}**\n\nExpression: {} = {}{}", shown, display, shown, note),
            ))
        }
        Ok(_) => Some(Answer::new(
            Intent::MathLimit,
            "That expression does not produce a finite number (for example, division by zero, an invalid function domain or numeric overflow), so I will not present it as a normal result.",
        )),
        Err(_) => None,
    }
}

fn is_live_request(text: &str) -> bool {
    [
        "weather",
        "news",
        "stock price",
        "score",
        "who won",
        "latest",
        "headlines",
        "browse",
        "search the web",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_prompt_is_explicit() {
        let result = answer("   ");
        assert_eq!(result.intent, Intent::Empty);
    }

    #[test]
    fn refuses_live_facts() {
        assert_eq!(answer("what is the weather in Boston").intent, Intent::Live);
        assert_eq!(answer("who won the game last night").intent, Intent::Live);
    }

    #[test]
    fn abstains_instead_of_guessing() {
        assert_eq!(answer("Should I take ibuprofen with my medication?").intent, Intent::Fallback);
    }
}
