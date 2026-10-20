//! Behaviour tests for the crate itself.
//!
//! These are the same expectations as the browser suite (`test/cai.test.cjs`),
//! narrowed to the part of the engine that lives in this crate.

use eltes_cai::{answer, evaluate, format_number, Intent};

#[test]
fn routes_arithmetic_prompts_to_the_math_answer() {
    let result = answer("what is 2 + 3 * 4?");
    assert_eq!(result.intent, Intent::Math);
    assert!(result.text.contains("14"));
    assert!(result.text.contains("Expression: 2 + 3 × 4 = 14"));
}

#[test]
fn answers_percentages_with_the_same_wording() {
    let of = answer("15% of 240");
    assert_eq!(of.intent, Intent::Percent);
    assert!(of.text.starts_with("**36**"));
    assert!(of.text.contains("240 × 15 / 100 = 36"));

    let off = answer("20% off 80");
    assert!(off.text.contains("64"));
    assert!(off.text.contains("discount of 16"));

    let change = answer("percentage change from 40 to 55");
    assert!(change.text.contains("37.5%"));

    let undefined = answer("percent change from 0 to 10");
    assert!(undefined.text.contains("undefined"));
}

#[test]
fn answers_unit_conversions() {
    let miles = answer("12 km to miles");
    assert_eq!(miles.intent, Intent::Units);
    assert!(miles.text.contains("7.4564543068"));

    let pounds = answer("5 kg in lb");
    assert!(pounds.text.contains("11.0231131092"));

    let data = answer("2 gb to mb");
    assert!(data.text.contains("2000"));
    assert!(data.text.contains("decimal units"));

    let speed = answer("100 km/h to mph");
    assert!(speed.text.contains("62.1371192734"));
}

#[test]
fn answers_temperatures() {
    assert!(answer("100 c to f").text.contains("212"));
    assert!(answer("0 c to k").text.contains("273.15"));
    assert!(answer("72 f to c").text.contains("22.2222222222"));
    assert!(answer("12 c to c").text.contains("same"));
}

#[test]
fn refuses_live_questions() {
    let weather = answer("what is the weather in Boston");
    assert_eq!(weather.intent, Intent::Live);
    assert!(weather.text.contains("cannot check live information"));
    assert!(!weather.text.to_lowercase().contains("sunny"));

    assert_eq!(answer("latest news about GPUs").intent, Intent::Live);
}

#[test]
fn falls_back_without_pretending() {
    let medical = answer("Which antibiotic should I take for this infection?");
    assert_eq!(medical.intent, Intent::Fallback);
    assert!(medical.text.contains("outside what it can answer reliably"));
    assert!(!medical.text.to_lowercase().contains("amoxicillin"));

    assert_eq!(answer("hello there").intent, Intent::Fallback);
    assert_eq!(answer("   ").intent, Intent::Empty);
}

#[test]
fn evaluates_the_documented_notation() {
    let cases = [
        ("2+3*4", 14.0),
        ("2^10", 1024.0),
        ("2^3^2", 512.0),
        ("2(3+4)", 14.0),
        ("(1+1)(2+2)", 8.0),
        ("3!", 6.0),
        ("sqrt(144)", 12.0),
        ("-2^2", -4.0),
        ("2 x 3", 6.0),
        ("10/4", 2.5),
        ("10 % 3", 1.0),
        ("max(3,9,4)", 9.0),
        ("mean(2,4,6)", 4.0),
        ("2pi", std::f64::consts::TAU),
    ];

    for (expression, expected) in cases {
        let value = evaluate(expression).expect("expression should evaluate");
        assert!(
            (value - expected).abs() < 1e-9,
            "{expression} evaluated to {value}, expected {expected}"
        );
    }
}

#[test]
fn formats_numbers_like_the_web_engine() {
    assert_eq!(format_number(0.1 + 0.2), "0.3");
    assert_eq!(format_number(1.0 / 3.0), "0.3333333333");
    assert_eq!(format_number(-0.0), "0");
    assert_eq!(format_number(f64::NAN), "NaN");
}

#[test]
fn answers_calendar_questions() {
    let span = answer("days between 2026-01-01 and 2026-10-20");
    assert_eq!(span.intent, Intent::Date);
    assert!(span.text.contains("292"));

    let weekday = answer("what day of the week is 2026-10-20");
    assert_eq!(weekday.intent, Intent::Date);
    assert!(weekday.text.contains("Tuesday"));
}
