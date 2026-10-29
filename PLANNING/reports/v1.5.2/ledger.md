# v1.5.2 execution ledger

Plan: `PLANNING/plans/2026-10-29-v1.5.2-remark-click-selection.md`
Base: `7fc8688`. Native implementation, authorized release to main.

- [x] Task 1: click selection and direct editing, RED → GREEN (8 expected feature failures; 44 target tests passing).
- [x] Task 2: release metadata RED → GREEN, documentation, full verification (96 tests, 16 JavaScript syntax checks, diff whitespace check).
- [x] Independent review: no Critical/Important findings. Equal-value native-input mismatch fixed with a failing regression then green full suite.
- [ ] Release push/tag verification (performed after committing this record).

Pre-flight: Task 2 consumes Task 1 behavior; no interface conflict.
Ruling: use the existing main checkout with the user's explicit authorization rather than create another worktree.
Ruling: replace the old active-only reverse-sync test: eligible inactive input now deliberately selects its field. Preserve an ineligible-input negative test.
Ruling: consume the ArrowUp one-shot for every accepted native input, including same-target input, as required by the spec; equal-value synthetic feedback remains a no-op.

Ruling: use one final release commit rather than intermediate task commits to match the user's request to commit after passing tests and documentation updates.
Ruling: run syntax checks per file; the plan's original wildcard command did not check all files.
Test setup: pin the floating composer away from the right-column textarea so real Playwright clicks are not intercepted by it.
Additional coverage: spaced module names, equal-text retargeting, all-empty source fallback, selection emits no input, right-click and score clicks ignored.
Existing native-caret regression now expects Trans5 after direct editing Trans5 (the intended new selection behavior).

Final: fixed equal-value native-input one-shot mismatch — `unchanged native input consumes first Up but composer feedback does not` RED → GREEN; full suite 96/96. A synchronous write guard with try/finally distinguishes composer feedback from native events.
Final: minor (deferred): strengthen isolated tests for same-target click consumption, active-module replacement followed by clicking and reverse sync, and settings-open event guards. Existing tests cover overlapping behavior but not every combination in isolation.
Live checklist: click module/header/textarea; type/paste/delete/undo and IME in both fields; confirm React persistence after blur; rapid switches plus chips/Clear; arrow navigation after blur; switch rows while open. Not performed against live NOVA.
