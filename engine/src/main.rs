//! `cai` — ask the engine from a terminal.
//!
//! ```text
//! $ cai "12 km to miles"
//! **7.4564543068 miles**
//!
//! `12 km = 7.4564543068 miles`
//!
//! Exact conversion factors.
//!
//! $ cai --eval "2 + 3 * 4"
//! 14
//! ```

use std::io::{self, Read};

use eltes_cai::{answer, evaluate, format_number};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.is_empty() {
        let mut buffer = String::new();
        if io::stdin().read_to_string(&mut buffer).is_ok() && !buffer.trim().is_empty() {
            run(&buffer, false, false);
            return;
        }
        usage();
        return;
    }

    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        usage();
        return;
    }

    let mut json = false;
    let mut show_intent = false;
    let mut eval = false;
    let mut words: Vec<String> = Vec::new();

    for arg in args {
        match arg.as_str() {
            "--json" => json = true,
            "--intent" => show_intent = true,
            "--eval" => eval = true,
            _ => words.push(arg),
        }
    }

    let prompt = words.join(" ");
    if prompt.trim().is_empty() {
        usage();
        return;
    }

    if eval {
        match evaluate(&prompt) {
            Ok(value) => println!("{}", format_number(value)),
            Err(error) => {
                eprintln!("error: {error}");
                std::process::exit(1);
            }
        }
        return;
    }

    run(&prompt, json, show_intent);
}

fn run(prompt: &str, json: bool, show_intent: bool) {
    let result = answer(prompt);
    if json {
        println!(
            "{{\"intent\":\"{}\",\"text\":\"{}\"}}",
            result.intent.as_str(),
            escape(&result.text)
        );
    } else if show_intent {
        println!("{}", result.intent.as_str());
    } else {
        println!("{}", result.text);
    }
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other => out.push(other),
        }
    }
    out
}

fn usage() {
    println!(
        "cai — the Eltes on-device answer engine\n\
         \n\
         USAGE:\n\
         \x20   cai \"12 km to miles\"\n\
         \x20   cai --eval \"2 + 3 * 4\"       print just the number\n\
         \x20   cai --intent \"15% of 240\"      show which rule matched\n\
         \x20   cai --json \"100 f to c\"       machine-readable output\n\
         \x20   echo \"sqrt(144)\" | cai        read the prompt from stdin\n\
         \n\
         No key, no network, no model weights. Anything outside arithmetic,\n\
         percentages and unit conversion is refused rather than guessed."
    );
}
