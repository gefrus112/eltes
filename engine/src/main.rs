//! `cai` — a command-line front end for the engine.
//!
//! ```text
//! cai "12 km to miles"
//! cai --eval "2 + 3 * 4"
//! cai --intent "what is the weather in Boston"
//! cai --json "15% of 240"
//! ```
//!
//! With no arguments it reads prompts from standard input, one per line.

use std::env;
use std::io::{self, BufRead, IsTerminal};
use std::process::ExitCode;

use eltes_cai::{answer, evaluate, format_number, Intent};

const HELP: &str = "\
cai — the Eltes CAI engine, on your device

USAGE:
    cai <question>          answer a question
    cai --eval <expr>       print just the number
    cai --intent <question> print just the route (empty, math, units, date, live, fallback)
    cai --json <question>   print {\"intent\":…,\"text\":…}
    cai --help              this text
    cai --version           engine version

EXAMPLES:
    cai \"12 km to miles\"
    cai --eval \"2 + 3 * 4\"
    cai \"days between 2026-01-01 and 2026-10-20\"

No network, no model weights, no telemetry. Questions outside arithmetic,
percentages, units, temperatures and dates are refused in plain language.";

fn main() -> ExitCode {
    let arguments: Vec<String> = env::args().skip(1).collect();

    if arguments.is_empty() {
        if io::stdin().is_terminal() {
            println!("{HELP}");
            return ExitCode::SUCCESS;
        }
        return answer_stream();
    }

    match arguments[0].as_str() {
        "-h" | "--help" => {
            println!("{HELP}");
            ExitCode::SUCCESS
        }
        "-V" | "--version" => {
            println!("cai {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        "--eval" => {
            let expression = arguments[1..].join(" ");
            match evaluate(&expression) {
                Ok(value) => {
                    println!("{}", format_number(value));
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("cai: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        "--intent" => {
            let prompt = arguments[1..].join(" ");
            println!("{}", answer(&prompt).intent.as_str());
            ExitCode::SUCCESS
        }
        "--json" => {
            let prompt = arguments[1..].join(" ");
            let result = answer(&prompt);
            println!(
                "{{\"intent\":\"{}\",\"text\":\"{}\"}}",
                result.intent.as_str(),
                escape_json(&result.text)
            );
            ExitCode::SUCCESS
        }
        _ => {
            print_answer(&arguments.join(" "));
            ExitCode::SUCCESS
        }
    }
}

fn print_answer(prompt: &str) {
    let result = answer(prompt);
    println!("{}", result.text);
    if result.intent != Intent::Empty {
        println!("\n— {}", result.intent.as_str());
    }
}

fn answer_stream() -> ExitCode {
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        match line {
            Ok(prompt) => {
                if prompt.trim().is_empty() {
                    continue;
                }
                println!("{}", answer(&prompt).text);
            }
            Err(error) => {
                eprintln!("cai: {error}");
                return ExitCode::FAILURE;
            }
        }
    }
    ExitCode::SUCCESS
}

fn escape_json(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '"' => escaped.push_str("\\\""),
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other if (other as u32) < 0x20 => escaped.push_str(&format!("\\u{:04x}", other as u32)),
            other => escaped.push(other),
        }
    }
    escaped
}
