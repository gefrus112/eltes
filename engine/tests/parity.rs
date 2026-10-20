//! The crate runs the same conformance suite as every port in `ports/`.
//!
//! If this test fails, the Rust engine and the other language ports disagree,
//! which is exactly the regression the shared file exists to catch. When the
//! crate is used outside this repository the vectors file is absent, so the
//! test explains itself and returns.

use std::path::Path;

use eltes_cai::{answer, evaluate, format_number};

#[test]
fn matches_the_shared_conformance_suite() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../ports/vectors.tsv");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) => {
            eprintln!(
                "skipping parity vectors: could not read {} ({error})",
                path.display()
            );
            return;
        }
    };

    let mut checked = 0usize;
    let mut failures: Vec<String> = Vec::new();

    for (offset, raw) in text.lines().enumerate() {
        let number = offset + 1;
        let line = raw.trim_end_matches('\r');
        if line.trim().is_empty() || line.starts_with('#') {
            continue;
        }

        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 3 {
            failures.push(format!("line {number}: expected at least 3 columns"));
            continue;
        }
        checked += 1;

        if fields[0] == "eval" {
            match evaluate(fields[1]) {
                Ok(value) => {
                    let expected: f64 = match fields[2].parse() {
                        Ok(expected) => expected,
                        Err(_) => {
                            failures.push(format!("line {number}: bad expectation {}", fields[2]));
                            continue;
                        }
                    };
                    let tolerance = 1e-9 * expected.abs().max(1.0);
                    if (value - expected).abs() > tolerance {
                        failures.push(format!(
                            "line {number}: {} -> {} (wanted {})",
                            fields[1],
                            format_number(value),
                            fields[2]
                        ));
                    }
                }
                Err(error) => failures.push(format!("line {number}: {} -> {error}", fields[1])),
            }
            continue;
        }

        let result = answer(fields[1]);
        if result.intent.as_str() != fields[2] {
            failures.push(format!(
                "line {number}: {} -> intent {} (wanted {})",
                fields[1],
                result.intent.as_str(),
                fields[2]
            ));
            continue;
        }

        if let Some(fragments) = fields.get(3) {
            for fragment in fragments.split('|').filter(|fragment| !fragment.is_empty()) {
                if !result.text.contains(fragment) {
                    failures.push(format!(
                        "line {number}: {} -> text missing {fragment:?}",
                        fields[1]
                    ));
                    break;
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} of {checked} shared vectors failed:\n{}",
        failures.len(),
        failures.join("\n")
    );
    assert!(checked >= 40, "expected the full suite, saw {checked} cases");
}
