//! Number formatting shared by every answer.
//!
//! Values are rounded to 10 decimal places and trailing zeros are stripped, so
//! `0.1 + 0.2` prints as `0.3` and `1 / 3` prints as `0.3333333333`. Big and
//! tiny magnitudes switch to exponential notation instead of printing a long
//! run of zeros.

/// Format a number the way every Eltes answer does.
pub fn format_number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".to_string()
        } else {
            "-Infinity".to_string()
        };
    }

    let magnitude = value.abs();
    if magnitude >= 1e12 || (magnitude > 0.0 && magnitude < 1e-8) {
        return exponential(value);
    }

    let rounded = (value * 1e10).round() / 1e10;
    let rounded = if rounded == 0.0 { 0.0 } else { rounded };
    format!("{rounded}")
}

fn exponential(value: f64) -> String {
    let raw = format!("{value:.10e}");
    let (mantissa, exponent) = match raw.split_once('e') {
        Some(parts) => parts,
        None => return raw,
    };

    let mut cleaned = mantissa.to_string();
    if cleaned.contains('.') {
        while cleaned.ends_with('0') {
            cleaned.pop();
        }
        if cleaned.ends_with('.') {
            cleaned.pop();
        }
    }

    let parsed: i32 = exponent.parse().unwrap_or(0);
    let sign = if parsed < 0 { '-' } else { '+' };
    format!("{cleaned}e{sign}{}", parsed.abs())
}

#[cfg(test)]
mod tests {
    use super::format_number;

    #[test]
    fn strips_floating_point_noise() {
        assert_eq!(format_number(0.1 + 0.2), "0.3");
        assert_eq!(format_number(36.0), "36");
        assert_eq!(format_number(1.0 / 3.0), "0.3333333333");
    }

    #[test]
    fn conversions_keep_ten_decimals() {
        assert_eq!(format_number(12.0 * 1000.0 / 1609.344), "7.4564543068");
        assert_eq!(format_number(5.0 * 453.59237 / 453.59237), "5");
        assert_eq!(format_number(72.0_f64), "72");
        assert_eq!(format_number((72.0 - 32.0) * 5.0 / 9.0), "22.2222222222");
    }

    #[test]
    fn handles_special_values() {
        assert_eq!(format_number(f64::NAN), "NaN");
        assert_eq!(format_number(f64::INFINITY), "Infinity");
        assert_eq!(format_number(f64::NEG_INFINITY), "-Infinity");
        assert_eq!(format_number(-0.0), "0");
    }

    #[test]
    fn switches_to_exponential_for_extremes() {
        assert_eq!(format_number(1.5e13), "1.5e+13");
        assert_eq!(format_number(2.5e-9), "2.5e-9");
    }
}
