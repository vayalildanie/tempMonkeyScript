# v1.5.3 Ledger

Plan: `PLANNING/plans/2026-10-30-v1.5.3-submit-check-remark-gate.md`. Branch: `release/v1.5.3` (cut from `spec/submit-check-remark-gate` at `6a0c17c`). Baseline: 96 Playwright tests passing.

## Decisions applied

The user chose "Start with defaults" on 2026-10-30. Every Decision Register default applies: A1 restore toast naming label or remark; A2 gate Label Check; A3 Escape per spec; Q1 quotable sources are translations and Note only; Q2 token `"text"`; Q3 legacy `Trans N "x"` still counts as a quote for separators; B1 one Z; B3 every writing Z advances; B4 nothing differs means no write and no advance; B5 per-translation 3-Points rule; B6 badge second line; B7 whole-row Remarks deleted; B8 `manual` stash shown as `was:`; B9 empty remark flips, empty target-side score refuses.

## Task 0: read-only checks

- `scoringShortcuts.checkCompleteness()` (`scoring-shortcuts.js:603`) returns `scoreable` (translations with text), `incomplete` (scoreable with an empty or bare `2 Points` label), and `skipped`. It does not return score values. The composer already reads scores with its own `scoreText(n)` and textareas with `remarkTextarea(n)` (`remark-composer.js:171-177`). The gate therefore needs no change to `scoring-shortcuts.js`: remark-missing = `scoreable` minus `incomplete`, whose `scoreText` does not begin with `3 Points`, and whose remark textarea value trims to empty.
- Ruling: a scoreable translation with no Remarks textarea at all is not gated (nothing the annotator could fill in; avoids a false block on a layout change). Recorded here per the plan's rule for lead judgment calls.
- Remark Composer's `start()` returns immediately on `/quality_` URLs (`remark-composer.js:1082`), so the quote rework cannot affect the QC page.

## Task evidence

(filled in per task)
