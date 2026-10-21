//! # eltes-cai
//!
//! The deterministic engine behind Eltes CAI, extracted so it can be used
//! anywhere: a terminal, a desktop app, a service worker, or another port.
//!
//! It answers four kinds of question and refuses everything else in plain
//! language:
//!
//! - **arithmetic** — `2 + 3 * 4`, `sqrt(144)`, `3!`, `2pi`, `max(3, 9, 4)`
//! - **percentages** — `15% of 240`, `20% off 80`, percentage change
//! - **units** — `12 km to miles`, `2 gb to mb`, `100 km/h to mph`
//! - **temperatures** — `72 f to c`, `0 c to k`
//! - **dates** — `days between 2026-01-01 and 2026-10-20`
//!
//! There are no model weights, no network calls, no telemetry and no hidden
//! state. A question outside those routes gets an explicit refusal rather than
//! a plausible-sounding invention — that rule is the reason this crate exists.
//!
//! ```
//! use eltes_cai::{answer, Intent};
//!
//! let miles = answer("12 km to miles");
//! assert_eq!(miles.intent, Intent::Units);
//! assert!(miles.text.contains("7.4564543068"));
//!
//! let weather = answer("what is the weather in Boston");
//! assert_eq!(weather.intent, Intent::Live);
//! ```
//!
//! ## What is deliberately not here
//!
//! Eltes-specific knowledge — the documentation mirror, the glossary, chat
//! recall and the model catalogue — stays in the web app, because it is
//! content rather than engine. See `engine/README.md` for the coverage table.

#![forbid(unsafe_code)]

pub mod answer;
pub mod dates;
pub mod number;
pub mod parser;
pub mod units;

pub use answer::{answer, Answer, Intent};
pub use number::format_number;
pub use parser::{evaluate, EvalError};
pub use units::{convert, temperature, Kind, Unit};
