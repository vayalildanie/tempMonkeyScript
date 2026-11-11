# v1.5.5 Coverage Baseline (measured on v1.5.4, `main` at `12837a9`)

## How it was measured

- **Coverage data.** Chromium's built-in V8 block coverage (`page.coverage`), collected for every test in the full suite (200 passed) and merged across tests. No new dependency was added.
- **Temporary patch.** The fixture patch that collects the coverage was reverted afterwards. Task 7a of the plan makes it a permanent opt-in (`npm run coverage`).
- **Merge logic.** See `coverage-merge.reference.js` in this folder.
- **What counts as an executable line:** not blank, not a comment, and not a lone closing bracket. A line counts as covered if any of its code ran in any test.
- **What counts as a function:** every function V8 reports, including small arrow callbacks such as `.catch(() => {})`.

## Result

| File | Lines covered | Functions covered |
|---|---|---|
| `utils.js` | 176 / 202 (87.1%) | 36 / 42 (85.7%) |
| `trans-cursor.js` | 60 / 60 (100%) | 15 / 15 (100%) |
| `scoring-shortcuts.js` | 422 / 488 (86.5%) | 63 / 79 (79.7%) |
| `remark-composer.js` | 616 / 729 (84.5%) | 91 / 102 (89.2%) |
| `qc-compare.js` | 607 / 637 (95.3%) | 87 / 101 (86.1%) |
| **Total** | **1881 / 2116 (88.9%)** | **292 / 339 (86.1%)** |

## What the 235 uncovered lines are

| Group | About how many lines | What | Worth testing? |
|---|---|---|---|
| **A. Real features with no test** | ~165 | <ul><li>The chip Settings window (⚙, about 110 lines)</li><li>X to clear a score on the annotation page</li><li>Esc and the arrows during a label pick</li><li>Shortcuts OFF</li><li>QC click-to-flip on the Adopt button</li><li>QC category with a single sub-label</li><li>The copy-icon tag stripping wiring</li><li>Chip settings saving</li></ul> | **Yes.** These are things the user does. A regression in Settings or X would ship unnoticed today. |
| **B. Mouse drag and resize of the three panels** | ~35 | `Utils.makeDraggable` / `makeResizable` handlers, and each panel's save of its position and size | **Yes, one table.** v1.5.4's bug was window geometry, and these handlers are shared by all three panels. |
| **C. Safety stops** | ~10 | The scoring queue stops when a score lands on the wrong value, or when a clear fails | **Yes, two tests.** "Never advance while carrying a wrong value" is a safety rule from the README. |
| **D. Defensive failure paths** | ~25 | `catch` blocks and `.catch(() => {})` timeouts that run only when NOVA's dropdown fails or never opens; the QC 8s start-up timeout | **No.** Each test would need fault injection plus a real 400–1500ms wait. That makes the suite slower and flakier, and it only proves an error message appears. |

## What 100% would mean, and whether it's needed

- **100% line coverage** would mean every line in group D runs in some test. To get there you'd make NOVA's simulated dropdown fail or hang in about 15 different ways and wait out each timeout.
- **100% function coverage** is stricter. V8 counts every `.catch(() => {})` arrow as a function, so every timeout in the code has to be triggered once.
- **Estimated cost:**
  - Groups A to C: about 30 tests, roughly half a day for one implementer. That brings lines to about 96–97%.
  - The last 3–4% (group D): roughly another day, and it adds about 20–30 seconds of deliberate waiting to every run. It also adds tests that break when the timeout constants change.
- **Is it necessary?** No. Coverage shows which code never runs, not whether the tests check the right outcome. This suite's quality comes from its assertions and from the mutation checks done in each release (break the code, watch the right test fail).
- **Recommendation:** close groups A to C, list group D by name as intentionally uncovered, and use the number as a ratchet. The report fails only if coverage drops, not if it misses 100%.

## Over-testing

For each test, I checked which lines it covers that no other test covers.

| Spec | Tests | Tests with no unique line | Lines only this spec covers |
|---|---|---|---|
| `scoring.spec.js` | 24 | 21 | 121 |
| `submit-check.spec.js` | 33 | 32 | 84 |
| `qc-shortcuts.spec.js` | 10 | 8 | 91 |
| `qc-swap.spec.js` | 32 | 30 | 25 |
| `remark-mouse.spec.js` | 9 | 8 | 17 |
| `remark-window.spec.js` | 7 | 7 | 13 |
| `remark-writes.spec.js` | 35 | 34 | 10 |
| `qc-navigation.spec.js` | 9 | 7 | 9 |
| `remark-target-selection.spec.js` | 24 | 24 | 8 |
| `capture-contract`, `harness`, `release-smoke`, `shared` | 16 | 16 | 0 |

**How to read this.** Most tests add no unique line, but that is expected and is not over-testing. Most of the suite is table-driven: many rows run the same code with different inputs. The rows exist to check different outcomes (a different score, a different remark, a different tab), not different lines.

Line coverage cannot measure redundancy between such tests; only identical assertions on identical inputs can. The v1.5.3 clean-up (196 → 192 tests) already removed those.

The four specs with 0 unique lines check the fixtures, the selector contract, and the version markers rather than `src/`, so their purpose is different and they stay.

**Verdict:** no test refactor in v1.5.5. Put new tests into the existing files, plus `perf.spec.js` for the new `@perf` tag.

## Appendix: reproducing

1. Temporarily patch `tests/helpers/test.js` so the `page` fixture calls `page.coverage.startJSCoverage({ resetOnNavigation: false })` before `use(page)`. After it, write `stopJSCoverage()` entries whose URL contains `/src/` (backslashes normalized) to one JSON file per test.
2. Run `npx playwright test` with `COV_DIR` set.
3. Run `node coverage-merge.reference.js <COV_DIR> report.json`.

Task 7a turns this into `npm run coverage`.
