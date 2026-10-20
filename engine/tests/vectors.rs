//! Behaviour that must match `assets/js/cai.js`.
//!
//! These are the cases from the JavaScript suite that this crate covers, kept
//! here so a change to either engine shows up as a failing test rather than a
//! quiet divergence between the browser and the binary.

use eltes_cai::{answer, evaluate, format_number, Intent};

fn text(prompt: &str) -> String {
    answer(prompt).text
}

#[test]
fn arithmetic_results_are_formatted_like_the_web_engine() {
    assert_eq!(answer("2 + 3 * 4").intent, Intent::Math);
    assert!(text("2 + 3 * 4").starts_with("**14**"));
    assert!(text("2 + 3 * 4").contains("Expression: 2 + 3 × 4 = 14"));
    assert!(text("sqrt(144)").starts_with("**12**"));
    assert!(text("3!").starts_with("**6**"));
    assert!(text("2^10").starts_with("**1024**"));
}

#[test]
fn implicit_products_and_named_operations() {
    assert!(text("2(3+4)").starts_with("**14**"));
    assert!(text("2pi").contains("6.2831853072"));
    assert!(text("6 squared").starts_with("**36**"));
    assert!(text("2 cubed").starts_with("**8**"));
    assert!(text("square root of 81").starts_with("**9**"));
    assert!(text("10 divided by 4").starts_with("**2.5**"));
    assert!(text("7 times 6").starts_with("**42**"));
}

#[test]
fn percentages() {
    let of = answer("15% of 240");
    assert_eq!(of.intent, Intent::Percent);
    assert!(of.text.starts_with("**36**"));

    let off = answer("20% off 80");
    assert_eq!(off.intent, Intent::Percent);
    assert!(off.text.starts_with("**64**"));

    let change = answer("percentage change from 40 to 55");
    assert_eq!(change.intent, Intent::Percent);
    assert!(change.text.starts_with("**37.5%**"));

    let zero = answer("percent change from 0 to 10");
    assert!(zero.text.contains("undefined"));
}

#[test]
fn unit_conversions() {
    let length = answer("12 km to miles");
    assert_eq!(length.intent, Intent::Units);
    assert!(length.text.contains("7.4564543068"));

    let mass = answer("5 kg in lb");
    assert!(mass.text.contains("11.0231131092"));

    let data = answer("2 gb to mb");
    assert!(data.text.contains("2000"));
    assert!(data.text.contains("decimal units"));

    let speed = answer("100 km/h to mph");
    assert!(speed.text.contains("62.1371192734"));
}

#[test]
fn temperatures() {
    assert!(text("100 c to f").contains("212"));
    assert!(text("72 f to c").contains("22.2222222222"));
    assert!(text("0 c to k").contains("273.15"));
    assert!(text("12 c to c").contains("is the same in"));
}

#[test]
fn live_questions_are_refused_without_a_guess() {
    assert_eq!(answer("what is the weather in Sudbury").intent, Intent::Live);
    assert_eq!(answer("latest news about GPUs").intent, Intent::Live);
}

#[test]
fn out_of_scope_questions_abstain() {
    let medical = answer("Which antibiotic should I take for this infection?");
    assert_eq!(medical.intent, Intent::Fallback);
    assert!(medical.text.contains("outside what it can answer reliably"));

    let empty = answer("");
    assert_eq!(empty.intent, Intent::Empty);
}

#[test]
fn the_evaluator_rejects_code_and_shell_text() {
    assert!(evaluate("rm -rf /").is_err());
    assert!(evaluate("process.exit(1)").is_err());
    assert!(evaluate("import os").is_err());
}

#[test]
fn numbers_survive_the_round_trip() {
    assert_eq!(format_number(0.1 + 0.2), "0.3");
    assert_eq!(format_number(1.0 / 3.0), "0.3333333333");
    assert_eq!(answer("1/0").intent, Intent::MathLimit);
}
