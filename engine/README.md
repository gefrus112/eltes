# Eltes CAI engine (Rust)

The deterministic half of the Eltes on-device helper, ported to Rust.

The web app's `assets/js/cai.js` answers questions **inside the tab** with rules
and a curated knowledge set — no key, no network, no model weights. This crate
takes the parts of that engine that are pure functions and reimplements them as
a library plus a small CLI, so the same answers can be produced by a native
binary, a test harness, or anything else that speaks Rust.

```console
$ cargo run --quiet -- "12 km to miles"
**7.4564543068 miles**

`12 km = 7.4564543068 miles`

Exact conversion factors.

— units

$ cargo run --quiet -- --eval "2 + 3 * 4"
14

$ cargo run --quiet -- --intent "15% of 240"
percent
```

## What this crate does

| Capability | Status | Notes |
| --- | --- | --- |
| Arithmetic, precedence, unary minus | Ported | `+ - * / % ^ ( )`, right-associative `^` |
| Implicit products | Ported | `2(3+4)`, `2pi`, `(a)(b)`, `2 x 3` |
| Functions | Ported | `sqrt cbrt abs sin cos tan asin acos atan ln log log10 log2 exp floor ceil round min max sum mean product pow` |
| Factorial | Ported | Postfix `!`, `0..=170` |
| Percentages | Ported | `15% of 240`, `20% off 80`, change between two values |
| Unit conversion | Ported | Length, mass, volume, data, speed, area |
| Temperatures | Ported | Celsius, Fahrenheit, Kelvin |
| Calendar arithmetic | Ported | `days between 2026-01-01 and 2026-10-20`, weekday of a date |
| Abstention | Ported | Out-of-scope questions get an explicit refusal |
| Live-data refusal | Ported | Weather, news, scores and prices are named as unsupported |
| One-variable equations | Not yet | Linear/quadratic solver is still JavaScript-only |
| Eltes knowledge base, glossary | Not yet | Both are site copy; they stay in the web app until there is a shared content format |
| Chat recall, greetings, identity | Not yet | These are conversational framing, not engine rules |
| Streaming chunker | Not yet | The CLI prints a finished answer |

Nothing here is a language model, and the crate never claims to be one. Every
answer comes from a rule you can read.

### Design rules

- **No dependencies.** `std` only, so the crate builds anywhere and the supply
  chain is one line long.
- **No `unsafe`.** Enforced with `#![forbid(unsafe_code)]`.
- **No network, no filesystem.** `answer()` is a pure function of its input,
  apart from `days until <date>`, which reads the system clock to know what
  "today" is.
- **Refuse rather than guess.** Anything outside the table above returns
  `Intent::Fallback` or `Intent::Live`.

## Library use

```rust
let result = eltes_cai::answer("5 kg in lb");
assert_eq!(result.intent, eltes_cai::Intent::Units);
assert!(result.text.contains("11.0231131092"));

let value = eltes_cai::evaluate("sqrt(144) + 2^3").unwrap();
assert_eq!(value, 20.0);
```

`Intent` values are stable strings: `empty`, `percent`, `units`, `date`,
`math`, `math-limit`, `live`, `fallback`. The same names appear in the shared
conformance suite and in every port.

## CLI

```console
cai "12 km to miles"          # answer with light markdown
cai --eval "2 + 3 * 4"        # just the number
cai --intent "15% of 240"     # which rule matched
cai --json "100 f to c"       # {"intent":"units","text":"..."}
echo "sqrt(144)" | cai        # prompt from stdin
```

## Tests

```console
cargo test --all
```

`tests/vectors.rs` pins the cases that are shared with the JavaScript engine, so
a change on either side shows up as a failing test instead of a quiet
divergence. The unit tests beside each module cover the edge cases: floating
point noise, factorial domain, mixed-unit rejection, negative zero.

`tests/parity.rs` runs this crate against [`../ports/vectors.tsv`](../ports/vectors.tsv),
the same file every port in [`../ports`](../ports) is judged by. If the Rust
engine and the Python, Go, Java, C or Lua ports disagree about an answer, that
test names the line.

## Licensing

This crate is **MIT** — see [`LICENSE`](LICENSE). It is a separate work from the
Eltes website and workspace in the repository root, which remain proprietary
(see [`../LICENSE`](../LICENSE) and [`../NOTICE.md`](../NOTICE.md)). The port is
deliberately scoped to the engine so that the site's copy, design and account
flows are unaffected.
