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

## Task 6: test clean-up (`3377cee`, `4c53316`, merged `59cd597`)

Subagent `agent-skills:test-engineer` (Opus, own worktree), cut off once by a usage limit and resumed. 196 -> 192 tests (193 here with the local capture), 9 -> 12 spec files; `@logic` 177, `@contract` 8, `@layout` 7. Lead verification: merge clean; `git diff 62aa500 HEAD -- src annotation-scoring-shortcuts.user.js` empty; every JS file passes `node --check`; full suite 193/193; `--grep @logic` 177/177. Five lead mutation spot-checks against the merged specs, each in the expected file and restored: Escape blur removed (3 failed in `remark-writes`), first-ArrowUp jump never spent (3 in `remark-target-selection`, including the merged table rows), gate counting 3 Points as needing a remark (9 in `submit-check`), QC neither-case target changed (6 in `qc-swap`), QC remark outline removed (3 in `qc-navigation`). The subagent's own 17 mutation checks, the list of merges, the behaviors left unmerged because equal coverage could not be proven, and the coverage gaps are in `test-behavior-map.md`.

## Requirement to test map

Specs live in `tests/`. Test names read `<behavior> when <condition>`; tables name their rows.

| Requirement | Covered by |
|---|---|
| **A-GATE** (remark gate; Check Off unchanged; blocked toast) | `submit-check.spec.js` > `remark gate` (3 modes x 6 cases, no-Space-on-block, toast pairing in Label and Submit Check), `Label Check`, `Submit Check`, `empty-row auto-advance` (incl. translations rendering before the timer) |
| **A-ESC** (Escape unfocus) | `remark-writes.spec.js` > `escape` (edit box, NOVA textarea incl. `Trans 2 Remarks`, second Escape closes, unrelated button and unrelated textarea, IME composition) |
| **A-QUOTE** (`"text"`, one source, Note, chrome refused) | `remark-writes.spec.js` > `quoting` (12+ accept and refuse rows with exact Note tokens, selection kept on refusal), `separators` (4 incl. old `Trans N "…"`), `contract` rows `note-heading`, `note-body` |
| **B-Z** (Score and Remark together) | `qc-swap.spec.js` > `Z swaps Score and Remark`, `Z guards and mouse` |
| **B-FAIL** (preserved pair, flip-flop, stash, verify) | `qc-swap.spec.js` > `failsafe: the preserved pair survives clears and edits`, `rows changing under the pairs` |
| **B-ADV** (every writing Z advances; refusals stay put) | `qc-swap.spec.js` > `Z auto-advance`, `Z refusals`, `rows changing under the pairs` (selection moved during a flip) |
| **B-SEL** (Score and Remark outlined; badge position) | `qc-navigation.spec.js` > `selector spans Score and Remark`, `tab round trip` |
| **B-RW** (Rewrite and whole-row Remarks removed) | `qc-navigation.spec.js` > `starting on a QC page` (legend has no Rewrite or "+ Add"); `grep -ni rewrite src` empty |
| **B-SUITE** (QC shortcuts) | `qc-shortcuts.spec.js` > `score keys`, `label menu`, `help toggle`, `guards`; `qc-navigation.spec.js` |
| **T-CLEAN** | `PLANNING/reports/v1.5.3/test-behavior-map.md` |

## Task 7 pre-deploy checklist (lead)

- [x] Every requirement maps to at least one passing test (table above).
- [x] `npm test` green (193 here, 192 without a local capture); `node --check` clean on every JS file.
- [x] R-A and R-B findings fixed or ruled on (sections above).
- [x] `grep -ni rewrite src` empty; no `Trans ${` quote template in `src/remark-composer.js`.
- [x] Version `v1.5.3` in the userscript header (`@version`, `TL.SCRIPT_VERSION`), README banner, and `release-smoke.spec.js`.
- [x] Decision defaults applied (section above) and rulings recorded.
- [x] Rollback point confirmed: tag `v1.5.2` at `2752748`.
- [ ] Fast-forward `main`, tag `v1.5.3` (done after this commit).
- [ ] Push `main` and the tag (only on the user's instruction).
- [ ] Live checklist run by the user: `PLANNING/reports/v1.5.3/live-checklist.md`.

## Review R-A (Track A) and rulings

Reviewer: `agent-skills:code-reviewer` (read-only), verdict REQUEST CHANGES, no critical defects. Fixed in `1b86e94`:

1. **Fixed: Note quote root too wide.** `.ant-spin-container` also holds the Collapse control (`.expand-btn`, inside `.refactor-content`) and the picture list (`.image-list-container`, a sibling). Reproduced by the reviewer against the real capture markup. The Note source is now its `h1` plus `.refactor-content .content-box`, applied as one group with the single-source rule; whitespace is ignored in the equality (the real page has no separating spaces between blocks).
2. **Fixed: tests could not see (1).** The fixture Note now carries the chrome; accept rows assert exact tokens and no chrome words; new refusal rows cover the Collapse control and picture list; refusals assert the selection is kept. Mutation check: restoring the wide root failed the 3 new rows.
3. **Fixed: toast test passed with reasons swapped.** Now asserts `Trans4 needs a complete label; Trans2 needs a remark.` in both Label and Submit Check.
4. **Fixed: Escape test's "unrelated focus" was a button.** The fixture now has the header `textarea#form_item_remark`; a test asserts the first Escape closes with it focused.
5. **Fixed: spurious toast from the empty-row timer.** The timer re-checks `scoreable` before dispatching Enter; new test renders translations inside the second.
6. **Accepted: the gate fails open when a translation has no Remarks textarea** (documented in code; nothing for the annotator to fill in).
7. **Fixed: Escape during IME composition** is now left to the IME (`e.isComposing`); tested.
8. **Accepted nits:** a typed remark that ends in a quoted span is treated as a quote for chip separators (any trailing `"…"`); a zero-width-space-only remark passes `trim()`.

## Review R-B (Track B) and rulings

Reviewer: `agent-skills:code-reviewer` (read-only), verdict REQUEST CHANGES. It reviewed `7827464` and noted the verify redesign landing at `7a2b281`. Fixed in the next commit (197 tests green; every fix mutation-checked against its test):

1. **Fixed: Z could write the previous row's Annotator 2 unit into the new row.** In the ~220ms before the re-scrape starts the pairs were stale and `flip` did not look. `flip` now refuses while `getRowSig() !== lastRowSig`.
2. **Fixed: a row change during a scrape was never detected.** `lastRowSig` was taken at the end of the read. It is now taken before it, so the next mutation sees the new row and re-reads.
3. **Fixed (rest of it): a score picked by hand (the mouse) did not count as the user acting**, so a verify retry within 2.5s could rebuild the pair from it. The verify now treats any live score that differs from the snapshot as "the pairs are in use" and stops.
4. **Fixed: a failed scrape left the module dead.** A failed first read now returns to Annotator 1's tab and is retried on the next row change (`scrapeFailed`); a failed verify retry leaves the earlier good pairs and `ready` alone.
5. **Fixed: the verify could switch tabs under a focused Remarks box.** It now does nothing while `Utils.inTextEntry()` is true.
6. **Partly fixed: the `manual` stash.** The badge note now carries the full text in a `title` (hover). Accepted: only the latest stash is kept, and nothing restores it (ruling B8 stands: it is a record, not a third flip state).
7. **Accepted (pre-existing): the idle re-render loop.** `updateSummary` rewrites `innerHTML` each render, which retriggers `onMutate` about every 220ms forever. Not changed: out of scope, and it does not affect correctness. Also accepted: a flicker between the Note-based and Trans1-based row signature while the Note module is absent mid-render would be read as a row change (the pairs are then rebuilt); no evidence it happens on the real page, where the signature is identical across both annotator tabs.
8. **Fixed (minor): Z advanced from the cursor's current position,** so an arrow press during a flip skipped a translation. It now advances only if the selection is still on the flipped translation.

Test notes: a lazy-load test was misnamed (renamed); the 3-Points warning tests also pass via the idle re-render loop (they do not isolate the `input` listener; accepted). New tests: row change before the re-read, row change during a read, recovery after a failed read, mouse-picked score then verify, advance guard, hover title.

## Findings and rulings

- **B1 finding:** `3`, `C`, and label-digit picks do not advance in QC today (`relabel()` and `commitLabel()` never move the cursor); only Z advances. Ruling: unchanged in v1.5.3; plan lines corrected. Not in scope.
- **B2 behavior notes:** the stale-text verify poll and the typing listener for the 3-Points warning were deleted with the long-text code. B4 must add per-translation remark staleness handling to the scrape; B6 must re-add the `input` listener for the warning. The summary now counts score differences only.
- **Latent defect fixed (B4): QC never detected a row change.** `qc-compare.js` `getRowSig()` read `[data-module-name="笔记外文翻译"]`, which does not exist in any of the three captures, so on the current page a new row was never re-scraped (stale snapshots, and with the pair model stale pairs). It now uses the Note module's text, falling back to Trans1, like the other modules. If NOVA navigates rows with a full page reload this was masked; in a single-page flow it was a live bug. Behavior change: QC now re-scrapes (visits Annotator 2's tab) on each row change. Needs a live check.
- **B9 refinement (ruling).** The plan said a flip refuses when the target side has no score. Applied literally that breaks the flip-flop for any translation Annotator 1 left unscored (the second Z could never return to Annotator 1's original). Ruling: refuse only when the flip would write **Annotator 2's** empty score; returning to Annotator 1's original, even unscored, is allowed. When the live unit matches neither side and Annotator 2 has no score, Z restores Annotator 1's original instead.
- **Badge second line moved from B6 to B4.** Comparing whole units made a remark-only difference show a red "Swap" badge with equal scores; the `Remark: …` line (Annotator 2's text, or `(none)`) ships with B4 so every commit is coherent. B6 kept the 3-Points warning, its live refresh, and the legend text.
- **Summary count now includes remark-only differences** (Trans5 in the B1 smoke data); the B1 smoke expectation was updated.
- **No separate unit test for `flipTarget`.** The plan suggested a `shared.spec.js`-style unit test; exposing it would add a test-only export to the product module. Its cases (matches a, matches b, neither, nothing to flip) are covered through the browser tests instead (flip-flop, clears table, hand edit, matches, no-score refusal).
- **Lazy-load verify, redesigned (`7a2b281`).** The B4 version merged fill-only, which could never correct a first read that captured the *previous row's leftover text* (the failure the original poller was written for, per the README). It now re-scrapes (full replace, at most twice, for about 2.5s) when Annotator 1's live remarks differ from the snapshot, but only while the user has not typed, flipped, or relabeled anything; after that it stops for good, so a preserved value can never be lost to it. Two new tests (leftover text corrected; verify stops after a flip) plus the lazy-load test; mutation checks: ignoring the "touched" flag failed the stop test, disabling the verify failed the lazy and leftover tests. Limitation: it cannot see late text on Annotator 2's tab (flipping to an empty remark would then clear Annotator 1's, which is kept as the stash). Needs a live check.
- **Subagent fixture note:** the worktree lacks the gitignored `captures/` folder, so its full-suite count differs by the one capture contract test.
