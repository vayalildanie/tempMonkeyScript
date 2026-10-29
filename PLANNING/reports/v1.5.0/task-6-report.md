# Task 6 report: help text, version, release checks

## Changes
- src/scoring-shortcuts.js: new `#tl-score-help` block below `#tl-score-statusrow` (11px, #9aa0ac, `.tl-kbd` keycaps).
- annotation-scoring-shortcuts.user.js: `@version 1.5.0`, `TL.SCRIPT_VERSION = 'v1.5.0'`, v1.5.0 header paragraph.
- tests/helpers/boot.js: version read from the entry file's `TL.SCRIPT_VERSION = '...'` line (no hard-coded fallback).
- tests/release-smoke.spec.js: 4 tests (help in panel, popover has no help, version markers, layout + 2 screenshots).
- Screenshots: test-results/scoring-panel-v1.5.0.png, test-results/remark-options-v1.5.0.png.

## Exact help text
With Remark Options open, the arrow keys choose which translation's Remarks box is written to — only when focus is outside a text box (after a chip click or [Q], click outside it first). It starts on the first translation not scored 3 Points; the first [↑] jumps back to Trans1. Select text in a translation and press [Q] to quote it (nothing selected: jumps into the Remark Options box). Click a chip to add a phrase. [Z] cycles the submit check, [Enter] runs it.

## Panel height at 1280x800
- Before: 128.2px (bottom 136.2)
- After: 209.9px (bottom 217.9; scrollHeight 208 == clientHeight 208; no clipping)
- The help renders as about 4-5 lines at the default 680px width, not 2-3; the spec asked for accuracy, so it was not trimmed further.

## Verification
1. RED: tests 1, 3, 4 failed (no #tl-score-help; version 1.4.7). Test 2 (popover has no help) passed unexpectedly because Task 5 already emptied `#rmd-hint`; it is a regression guard.
2. GREEN: `npx playwright test tests/release-smoke.spec.js` 4 passed.
3. `npm test`: 74 passed.
4. Per-file `node --check` over the entry file and src/*.js: no output.

## Notes
- In the fixture, the Remark Options popover sits over the lower part of the scoring panel (see remark-options screenshot). That is popover placement, unchanged by this task. On the live page the popover has its own saved position.
- README.md, qc-compare.js, trans-cursor.js, and submit-check logic untouched.

## Review fix pass
Changes:
- src/scoring-shortcuts.js: panel gets `max-height:calc(100vh - 16px)` (overflow:auto already set). Help text reworded: "if ↑ is your first arrow press, it jumps back to Trans1"; "first translation with text that isn't scored 3 Points (Trans1 if none)"; "click outside the Remark Options box first".
- tests/helpers/boot.js: throws `Error('SCRIPT_VERSION not found in annotation-scoring-shortcuts.user.js')` when the version line is missing.
- tests/release-smoke.spec.js: test 2 is case-insensitive and also forbids "arrow keys" and "remarks box"; test 3 has a comment saying the fs assertions are the real check; test 4 now checks help.bottom <= panel.bottom, status.bottom <= viewport, panel.bottom <= viewport (vacuous scrollHeight check and console.log removed); new narrow-width test (260px, screenshot test-results/scoring-panel-narrow-v1.5.0.png); new short-viewport test (1280x300, 260px wide: panel bottom <= viewport and scrollHeight > clientHeight).
- Verified RED: with the max-height removed, the short-viewport test fails; with it restored it passes.

Heights (1280x800): default width 680px: 230.3px (was 209.9px before the reword; 128.2px before the help block); 260px width: 454.6px (bottom 462.6, help wraps with scrollWidth 230 == clientWidth 230).

Commands: `npx playwright test tests/release-smoke.spec.js` 6 passed; `npm test` 76 passed; per-file `node --check` over the entry file and src/*.js printed nothing.
