//! Eltes CAI core — the deterministic half of the on-device helper.
//!
//! This crate is a Rust port of the arithmetic, percentage and unit-conversion
//! intents in `assets/js/cai.js`. It never opens a socket, never loads model
//! weights and never guesses: anything outside the supported intents comes back
//! as an explicit [`Intent::Fallback`] answer.
//!
//! ```
//! let answer = eltes_cai::answer("12 km to miles");
//! assert_eq!(answer.intent, eltes_cai::Intent::Units);
//! assert!(answer.text.contains("7.4564543068"));
//! ```
//!
//! See `README.md` for the coverage table — what is ported, and what is
//! deliberately still JavaScript-only.

#![forbid(unsafe_code)]

pub mod answer;
pub mod number;
pub mod parser;
pub mod units;

pub use answer::{answer, Answer, Intent};
pub use number::format_number;
pub use parser::{evaluate, EvalError};
pub use units::{convert, temperature, Kind, Unit};
