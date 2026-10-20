//! Number formatting that matches the JavaScript engine's `cleanNumber`.
//!
//! Everyday results are rounded to ten decimal places and printed without a
//! trailing `.0`; anything at or beyond 1e12 (or smaller than 1e-8 in absolute
//! value) switches to exponent notation, because writing those out in full is
//! unreadable and easy to miscount.

/// Format a number the way the web engine does.
///
/// ```
/// assert_eq!(eltes_cai::format_number(0.1 + 0.2), "0.3");
/// assert_eq!(eltes_cai::format_number(-0.0), "0");
/// assert_eq!(eltes_cai::format_number(1.5e13), "1.5e+13");
/// ```
pub fn format_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return (if value.is_sign_positive() { "Infinity" } else { "-Infinity" }).to_string();
    }

    let magnitude = value.abs();
    if magnitude >= 1e12 || (magnitude > 0.0 && magnitude < 1e-8) {
        return exponential(value);
    }

    let rounded = (value * 1e10).round() / 1e10;
    if rounded == 0.0 {
        return "0".to_string();
    }
    let mut text = format!("{}", rounded);
    // `Display` for f64 never emits a trailing ".0", but be explicit in case
    // the value came back as something like "12.0000000000" on another target.
    if text.contains('.') {
        while text.ends_with('0') {
            text.pop();
        }
        if text.ends_with('.') {
            text.pop();
        }
    }
    text
}

fn exponential(value: f64) -> String {
    let raw = format!("{:.*e}", 10, value);
    let (mantissa, exponent) = match raw.split_once('e') {
        Some(parts) => parts,
        None => return raw,
    };

    let mut mantissa = mantissa.to_string();
    if mantissa.contains('.') {
        while mantissa.ends_with('0') {
            mantissa.pop();
        }
        if mantissa.ends_with('.') {
            mantissa.pop();
        }
    }

    let parsed: i32 = exponent.parse().unwrap_or(0);
    let sign = if parsed < 0 { "-" } else { "+" };
    format!("{}e{}{}", mantissa, sign, parsed.abs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_floating_point_noise() {
        assert_eq!(format_number(0.1 + 0.2), "0.3");
        assert_eq!(format_number(2.0 / 3.0), "0.6666666667");
    }

    #[test]
    fn keeps_integers_plain() {
        assert_eq!(format_number(14.0), "14");
        assert_eq!(format_number(-4.0), "-4");
        assert_eq!(format_number(1024.0), "1024");
    }

    #[test]
    fn collapses_negative_zero() {
        assert_eq!(format_number(-0.0), "0");
    }

    #[test]
    fn switches_to_exponent_at_the_edges() {
        assert_eq!(format_number(1.5e13), "1.5e+13");
        assert_eq!(format_number(2.0e-9), "2e-9");
        assert_eq!(format_number(-3.25e-10), "-3.25e-10");
    }
}
