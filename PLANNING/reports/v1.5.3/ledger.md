# v1.5.3 Ledger

Plan: `PLANNING/plans/2026-10-30-v1.5.3-submit-check-remark-gate.md`. Branch: `release/v1.5.3` (cut from `spec/submit-check-remark-gate` at `6a0c17c`). Baseline: 96 Playwright tests passing.

## Decisions applied

The user chose "Start with defaults" on 2026-10-30. Every Decision Register default applies: A1 restore toast naming label or remark; A2 gate Label Check; A3 Escape per spec; Q1 quotable sources are translations and Note only; Q2 token `"text"`; Q3 legacy `Trans N "x"` still counts as a quote for separators; B1 one Z; B3 every writing Z advances; B4 nothing differs means no write and no advance; B5 per-translation 3-Points rule; B6 badge second line; B7 whole-row Remarks deleted; B8 `manual` stash shown as `was:`; B9 empty remark flips, empty target-side score refuses.

## Task 0: read-only checks

- `scoringShortcuts.checkCompleteness()` (`scoring-shortcuts.js:603`) returns `scoreable` (translations with text), `incomplete` (scoreable with an empty or bare `2 Points` label), and `skipped`. It does not return score values. The composer already reads scores with its own `scoreText(n)` and textareas with `remarkTextarea(n)` (`remark-composer.js:171-177`). The gate therefore needs no change to `scoring-shortcuts.js`: remark-missing = `scoreable` minus `incomplete`, whose `scoreText` does not begin with `3 Points`, and whose remark textarea value trims to empty.
- Ruling: a scoreable translation with no Remarks textarea at all is not gated (nothing the annotator could fill in; avoids a false block on a layout change). Recorded here per the plan's rule for lead judgment calls.
- Remark Composer's `start()` returns immediately on `/quality_` URLs (`remark-composer.js:1082`), so the quote rework cannot affect the QC page.

## Task evidence

Counts are Playwright tests as run. Baseline 96. After B2: 151 (96 + 3 escape + 19 gate + 16 quote + 17 QC).

| Task | Commit | Evidence |
|---|---|---|
| 0 | n/a (read-only) | Findings above |
| 1 | `963caa0` | Note and Context-EN added to `annotation.html`; contract lines `note-module`, `note-content-root`; row-change tests also change Note text (Note is the row-signature source). 28 new tests written red for the expected reasons; 96 existing still green |
| 2 | `8802614` | 3 escape tests red then green (`inRemarkBox`, first Escape blurs, second closes, unrelated focus closes on first) |
| 4 | `8802614` | 12 quote-selection rows and 4 separator tests red then green; 3 existing quote tests updated to `"text"`. Mutation check: loosening the single-source rule to `>= 1` made 5 of 6 refusal rows fail (Context-EN only still refused by the root check, as expected); restored |
| 3 | `e328dbc` | 18 gate rows (3 modes x 6 cases) and the toast test red then green; 13 existing submit-check tests unchanged |
| B0, B1 | `17b23c9` (subagent) | `quality_compare.html`, `quality-sim.js`, `qc-compare.spec.js` with 16 tests. Lead re-ran: 16/16 green on unchanged product code |
| B2 | `0709dc8` (subagent) | -578/+46 lines. Lead re-ran: full suite 151/151, `node --check` on every JS file, `grep -ni rewrite src` empty, deleted-name grep empty |

| B3 | `4e79fad` (subagent) | `.qc-active-remark` on the Remarks module's inner `.text-labels` block (the outer `font` wrapper is inline and would fragment the outline); 6 tests. Lead re-ran: 157/157 excluding the red swap file |
| B4+B5 | `ef9a87e` | Preserved pair, symmetric flip-flop, manual stash, fill-only lazy-load verify, whole-unit badges, row-change fix. 21 swap tests written red first (16 failed), then green. Mutation checks: neither-case target changed to `a` failed 4 clears/edit tests; removing the stash failed the hand-edit test |
| B6 | next commit | 3 new warning tests red (2 failed, 1 negative guard passed), then green; legend reads `Z Swaps Score + Remark`. Full suite 181/181 |

## Findings and rulings

- **B1 finding:** `3`, `C`, and label-digit picks do not advance in QC today (`relabel()` and `commitLabel()` never move the cursor); only Z advances. Ruling: unchanged in v1.5.3; plan lines corrected. Not in scope.
- **B2 behavior notes:** the stale-text verify poll and the typing listener for the 3-Points warning were deleted with the long-text code. B4 must add per-translation remark staleness handling to the scrape; B6 must re-add the `input` listener for the warning. The summary now counts score differences only.
- **Latent defect fixed (B4): QC never detected a row change.** `qc-compare.js` `getRowSig()` read `[data-module-name="笔记外文翻译"]`, which does not exist in any of the three captures, so on the current page a new row was never re-scraped (stale snapshots, and with the pair model stale pairs). It now uses the Note module's text, falling back to Trans1, like the other modules. If NOVA navigates rows with a full page reload this was masked; in a single-page flow it was a live bug. Behavior change: QC now re-scrapes (visits Annotator 2's tab) on each row change. Needs a live check.
- **B9 refinement (ruling).** The plan said a flip refuses when the target side has no score. Applied literally that breaks the flip-flop for any translation Annotator 1 left unscored (the second Z could never return to Annotator 1's original). Ruling: refuse only when the flip would write **Annotator 2's** empty score; returning to Annotator 1's original, even unscored, is allowed. When the live unit matches neither side and Annotator 2 has no score, Z restores Annotator 1's original instead.
- **Badge second line moved from B6 to B4.** Comparing whole units made a remark-only difference show a red "Swap" badge with equal scores; the `Remark: …` line (Annotator 2's text, or `(none)`) ships with B4 so every commit is coherent. B6 kept the 3-Points warning, its live refresh, and the legend text.
- **Summary count now includes remark-only differences** (Trans5 in the B1 smoke data); the B1 smoke expectation was updated.
- **No separate unit test for `flipTarget`.** The plan suggested a `shared.spec.js`-style unit test; exposing it would add a test-only export to the product module. Its cases (matches a, matches b, neither, nothing to flip) are covered through the browser tests instead (flip-flop, clears table, hand edit, matches, no-score refusal).
- **Lazy-load limitation.** The bounded verify (up to ~1.6s, fill-only, stops on user typing) can only notice late text on Annotator 1's tab. Late text on Annotator 2's tab at scrape time would be recorded empty (flipping to it would then clear Annotator 1's remark, which is kept as the stash). Needs a live check.
- **Subagent fixture note:** the worktree lacks the gitignored `captures/` folder, so its full-suite count differs by the one capture contract test.
