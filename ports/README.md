# Eltes CAI ports

The Eltes CAI engine is a small, rules-based answer engine: arithmetic,
percentages, unit and temperature conversions, plus an explicit refusal for
anything it cannot check. The reference implementation is the Rust crate in
[`../engine`](../engine); the browser build lives in
[`../assets/js/cai.js`](../assets/js/cai.js).

This directory is the part that makes "port it to every language" real rather
than a slogan. Every port is checked against **one shared conformance suite**,
so a language either answers exactly like the reference or it fails.

The honest scope note: there are thousands of programming languages, including
esoteric and domain-specific ones. Nobody can literally write and maintain a
port in every one. What is achievable — and what this directory is — is a
contract plus a growing set of verified ports, where adding the next language
is one file and one test run.

## The contract

`vectors.tsv` is the contract. It is tab-separated, blank lines and lines
starting with `#` are ignored, and there are two row kinds:

```
answer <TAB> prompt <TAB> intent <TAB> fragment1|fragment2|...
eval   <TAB> expression <TAB> expected_number
```

- **`answer`** — run the full `answer(prompt)`, check the returned intent
  matches exactly, then check that every `|`-separated fragment appears in the
  returned text. An empty fragment column means the intent is the only check.
- **`eval`** — evaluate the expression as a bare expression (no intent routing)
  and compare with the expected number. The tolerance is relative `1e-9`
  (`|actual - expected| <= 1e-9 * max(1, |expected|)`).

Passing every row means the port has the same routing, the same number
formatting and the same user-facing wording as the reference for everything
the suite covers. `vectors.tsv` is intentionally human-readable so it can be
reviewed in a diff like any other behaviour.

## Behaviour the suite pins

Routing order: **percent → units → math → live refusal → fallback**.

| Intent        | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `empty`       | blank prompt                                                   |
| `percent`     | `15% of 240`, `20% off 80`, percentage change                  |
| `units`       | `12 km to miles`, `72 f to c`, data/area/speed units           |
| `math`        | arithmetic, functions, factorials, constants                   |
| `math-limit`  | an expression that does not produce a finite number            |
| `live`        | weather, news, scores, anything needing current facts          |
| `fallback`    | anything else — the honest "small on-device engine" answer     |

Details that ports must reproduce:

- Numbers print with at most 10 decimals, trailing zeros stripped
  (`1/3` → `0.3333333333`), `0` instead of `-0`.
- `^` is right-associative (`2^3^2` is 512); unary minus binds tighter than
  `^`, so `-2^2` is `-4`.
- Implicit multiplication: `2pi`, `2(3+4)`, `(1+1)(2+2)`, and `2 x 3`.
- Math normalisation understands `squared`, `cubed`, `square root of`,
  `cube root of`, `factorial of`, and the words `plus`, `minus`, `times`,
  `divided by`, `multiplied by`, `to the power of`.
- Unit answers include the conversion line and a note; data units use the
  decimal note (`1 KB = 1,000 bytes`).
- The live refusal must not invent an answer, and the fallback must not
  pretend to be a hosted model.

If a port passes `vectors.tsv`, it is accepted for every case the suite
covers. If a case is missing, add it to `vectors.tsv` first, then make the
ports pass — that is how behaviour stays identical across languages.

## Running a port

Each port accepts an optional path to `vectors.tsv` and uses
`../vectors.tsv` relative to itself by default. It prints `ok: N cases` and
exits `0` on success, or prints `FAIL …` lines and exits non-zero.

| Language   | Port                                | Run                                                            |
| ---------- | ----------------------------------- | -------------------------------------------------------------- |
| Rust       | `../engine` (reference)             | `cargo test --manifest-path engine/Cargo.toml`                  |
| Python     | `python/cai.py`                     | `python3 python/cai.py vectors.tsv`                             |
| JavaScript | `javascript/cai.js`                 | `node javascript/cai.js vectors.tsv`                            |
| TypeScript | `typescript/cai.ts`                 | `npx tsc -p typescript && node typescript/dist/cai.js vectors.tsv` |
| Perl       | `perl/cai.pl`                       | `perl perl/cai.pl vectors.tsv`                                  |
| C          | `c/cai.c`                           | `cc -std=c99 -O2 cai.c -lm -o cai && ./cai ../vectors.tsv`      |
| C++        | `cpp/cai.cpp`                       | `g++ -std=c++17 -O2 cai.cpp -o cai && ./cai ../vectors.tsv`     |
| Go         | `go/main.go`                        | `go run go/main.go vectors.tsv`                                 |
| Ruby       | `ruby/cai.rb`                       | `ruby ruby/cai.rb vectors.tsv`                                  |
| PHP        | `php/cai.php`                       | `php php/cai.php vectors.tsv`                                   |
| Java       | `java/Cai.java`                     | `javac -d out java/Cai.java && java -cp out Cai`                |
| Kotlin     | `kotlin/Cai.kt`                     | `kotlinc Cai.kt -include-runtime -d cai.jar && java -jar cai.jar` |
| C#         | `csharp/cai.csproj`                 | `dotnet run --project csharp/cai.csproj`                        |
| Lua        | `lua/cai.lua`                       | `lua5.4 lua/cai.lua vectors.tsv`                                 |
| AWK        | `awk/cai.awk`                       | `awk -f awk/cai.awk vectors.tsv`                                |
| Julia      | `julia/cai.jl`                      | `julia julia/cai.jl vectors.tsv`                                |
| R          | `r/cai.R`                          | `Rscript r/cai.R vectors.tsv`                                   |
| Dart       | `dart/cai.dart`                     | `dart dart/cai.dart vectors.tsv`                                |

`../.github/workflows/ports.yml` runs a matrix of **17 language jobs** on every
push (plus the Rust crate), so a row only stays in this table while it is green.
The one exception is the Rust reference itself: it is checked by
`../.github/workflows/engine.yml` through `../engine/tests/parity.rs`, which runs
this exact `vectors.tsv` through the crate.

## Adding a language

1. Write one file that implements `answer(prompt) -> (intent, text)` and
   `evaluate(expression) -> number` with the behaviour above.
2. Give it a vector runner: read the TSV, run both row kinds, print
   `ok: N cases` or `FAIL …`, and exit non-zero on any failure.
3. Add one row to the table above and one matrix entry in `ports.yml`.
4. Push. The workflow is the judge; a port is only listed once it is green.

No build system, no dependencies beyond the standard library, no network. A
port should be readable in one sitting — that is what keeps them honest.

## Licence

The ports are MIT, matching [`../engine/LICENSE`](../engine/LICENSE).
