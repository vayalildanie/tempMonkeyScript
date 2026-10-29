# Task 3 report: scoring navigation and label advancement

## Status
DONE. Commit: see `git log -1` on v1.5.0-ui-adaptation ("fix: restore scoring navigation and advancement").
Files: src/scoring-shortcuts.js, tests/scoring.spec.js, tests/fixtures/annotation-sim.js, tests/fixtures/README.md.

## Tests (tests/scoring.spec.js, 24 tests)
Assert real DOM state: `tl-active-score` on the TransN Score container, displayed `.ant-select-selection-item` value, aria-expanded, status line, and a MutationObserver log of every active-cursor move (with Trans1's displayed value at that moment) to prove nothing moved early or at all.
- Lateral: left/right between Trans1-3 and 4-7, remembered slots (2<->6), skipped empty Trans3 (list [1,2,4,5,6,7], down from 2 lands on 4), bottom clamp at Trans7.
- `3` / `C` set value and advance (C from Trans2 lands on Trans4; 3 on Trans7 stays, "(last)").
- `2` leaves cascader open on bare "2 Points", no advance, zero cursor moves.
- Terminal labels `2`-`9` and `0` (0 = 10th "Other") commit and advance, popup closed, badges removed.
- `1` = category with one leaf: value is full "2 Points / Grammar / Grammar" at the moment the cursor first moves.
- Category with several children (a second leaf is injected by a test observer): status "Category selected", no move; second `1` commits and advances.
- Label pick from Trans2 -> Trans4 (skips Trans3); label pick on Trans7 stays.
- Failed leaf (3 tests): bare leaf fails -> no advance + "not applied" status; retry then succeeds and advances; failed lone-leaf auto-pick after category -> no advance.

## RED (before production change, scoring.spec.js)
21 passed, 3 failed. Failing: the 3 "failed label click" tests, all with
`Expected pattern: /not applied/i  Received string: "Label set: 2 Points ✓ → Trans2"`.
That proves the reviewer-identified defect: a failed leaf still advanced and reported success.
(An earlier draft run also had 3 failures that were my own test-expectation mistakes — wrong label indices and a locator that waits on a nonexistent node — fixed in the tests, not in production.)

## UNEXPECTED PASS: lateral movement
All 4 lateral tests (and 3/C/2/terminal/category tests) passed against UNMODIFIED src. I did not invent a production change. On the reduced fixture, left/right across columns, remembered slots and skipping of empty Trans3 all work. The user's "lateral arrows broken" report is therefore not reproduced here; likely the empty Trans4-7 in the capture (list had no right-column entries, so `toggleColumn` correctly stays put). Not verified against the live NOVA page.

## Production change (src/scoring-shortcuts.js, commitLabelAndAdvance + pickLabelByNumber)
- `pickLabelByNumber` captures the displayed value immediately before the leaf click (`before`); for the single-leaf auto-pick it re-reads right before the leaf click (`beforeLeaf`), since a category click may already change the display.
- `commitLabelAndAdvance(mod, num, nums, before)`: waits (<=600ms) for a value that is non-empty, `!== before`, and `!== CFG.pathKey2` ("2 Points"). If not accepted: sets status `⚠️ Label not applied — TransN still shows "<value>"; press a number to retry`, returns without touching labelMode, popup, or cursor — `cursor.set(next)` is never called, label mode stays on so the pick can be retried. Otherwise behaves as before.
- Edge: relabelling to the identical existing value would read as unchanged, but pressing `2` first resets display to bare "2 Points", so `before` is "2 Points" in practice.

## Test-only hook
`window.__fixture.failNextLeaf = true` in annotation-sim.js: next nested-label leaf click (key containing `__RC_CASCADER_SPLIT__`, non-expand) is ignored once; value and popup unchanged; flag resets. Documented in tests/fixtures/README.md.

## GREEN
- `npx playwright test tests/scoring.spec.js`: 24 passed.
- `npm test`: 28 passed (harness 2, shared 2, scoring 24).
- `node --check src/scoring-shortcuts.js`: OK.

## Not touched
trans-cursor.js, QC Compare, README, version numbers. Not pushed.
