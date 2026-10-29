# SDD ledger — plan: PLANNING/plans/2026-10-29-v1.5.0-annotation-ui-adaptation.md

Workspace: already isolated worktree at C:\Users\Admin\.local\share\opencode\worktree\a61303\v1.5.0-ui-adaptation
Branch: v1.5.0-ui-adaptation (created from detached HEAD c9c5444)
Baseline: no package.json, no test runner. Nothing to run. Uncommitted planning docs only.

## Preflight

| Pair / task | Shared surface | Finding |
|---|---|---|
| Task 1 → 2 | bootModules, fixture DOM | Task 2 consumes harness from Task 1. Compatible. |
| Task 1 → 3 | fixture cascader, Trans4–7 lorem text | Task 3 consumes simulator. Compatible. User asked for lorem ipsum in Trans4–7; plan said "synthetic text". Ruling below. |
| Task 1 → 4 | window.__fixture.submitCount / spaceEvents | Signatures match. Compatible. |
| Task 2 → 3 | transNumFromModuleName | Task 3 consumes parser. Compatible. |
| Task 3 ↔ Task 6 | both modify src/scoring-shortcuts.js | Sequential, no contradictory edits. Task 6 adds help text and version smoke only. |
| Task 4 ↔ Task 5 ↔ Task 6 | all modify src/remark-composer.js | Sequential. Task 4 touches submit path; Task 5 targeting; Task 6 copy. No contradiction. |
| Task 1 internal | harness.spec.js vs files | Agrees. |
| Task 2 internal | tests vs parser-only change | Agrees. Do not edit TransCursor unless regression fails. |
| Task 3 internal | tests vs smallest scoring fix | Agrees. |
| Task 4 internal | tests vs smallest event-path fix | Agrees. |
| Task 5 internal | tests vs targeting implementation | Agrees with confirmed spec decisions. |
| Task 6 internal | version + help + full suite | Agrees. README must not be edited. |

Ruling: Trans4–7 filler text is lorem ipsum — user instruction overrides the plan's generic "synthetic text" — costs nothing if wrong beyond fixture wording.

No other conflicts. Proceeding to Task 1.

## Tasks

- Task 1: complete (commits c9c5444..aa88d3f, review clean)
  - fix round 1/5 (5 addressed, 0 open; commits 56ace0e..aa88d3f)
  - deferred minor: dropdowns are inside the control, not body-portaled; clickEl test uses dispatchEvent so it does not prove hit-testing
- Task 2: complete (commits aa88d3f..dacdb4c, review clean)
  - fix round 1/5 (3 addressed, 0 open — cursor stay-put test retargeted, midSpace renamed, spaced-Score pinned; commits 6ca1915..dacdb4c)
  - deferred minor: parser now also accepts spaced `Trans 2 Score` / `Trans 2` (intentional, pinned by test)
- Task 3: complete (commits dacdb4c..b0d445f, review clean)
  - lateral arrow tests passed on UNMODIFIED src (unexpected pass, no production change made); only fix: commitLabelAndAdvance/pickLabelByNumber read-back
  - Task 3: minor (deferred): tests/scoring.spec.js:475 negative assertion `.not.toBe(...)` should assert the real value
  - Task 3: minor (deferred): tests/scoring.spec.js:364 one-shot status read, could poll
  - Task 3: minor (deferred): tests/scoring.spec.js:313-319 nextIn on a hard-coded list is mostly vacuous
  - Task 3: minor (deferred): re-picking the label already displayed reads as "not applied" (trade-off, Esc recovers)
- Task 4: complete (commits b0d445f..5b1751e, review clean)
  - fix round 1/5 (5 addressed, 0 open — stale-timer test now mutation-checked; commits cd6dbb2..5b1751e)
  - production change: Utils.dispatchNativeSpace targets document.body when activeElement is INPUT/TEXTAREA/SELECT/contenteditable; one pair only. Only the readonly-cascader-input case was RED; all else passed unmodified.
  - Task 4: minor (deferred): shadow-DOM inputs not detected by dispatchNativeSpace
  - Task 4: minor (deferred): Z does not clear the pending empty-row timer (harmless: performCheck re-reads mode)
  - REMAINS UNVERIFIED: the real NOVA Space listener; live-page smoke test required
  - Ruling: real NOVA key listener is not in the captured HTML (only `button.blue-btn` "提交"+"Space" hint in .header-commit-btns); root cause of the Space regression cannot be proven offline — fixture handler models an ASSUMED stricter platform; live-page smoke test stays mandatory — cost if wrong: fix passes fixture but not live site
- Task 5: complete (commits 5b1751e..a61a0e8, review clean)
  - fix round 1/5 (5 addressed, 0 open — re-apply test no longer vacuous (mutation-checked), native-arrow/caret/background tests added, flaky chip test fixed; commits 4838344..a61a0e8)
  - Task 5: minor (deferred): explicit applyTargetHighlight() in onMutate is redundant with cursor.sync(); comment could say "defensive"
  - Task 5: minor (deferred): modulesBySuffix rebuilds a RegExp per [data-module-name] per call; build maps once per settle
  - Task 5: minor (deferred): `#rmd-likely` shows bare "2 Points" for labeled values like "2 Points / Grammar" (by design)
  - Task 5: note for help text (Task 6): chip click and Q move focus into #rmd-edit, so arrows only move the target after clicking outside the box
  - Task 5: note: Q with a rejected cross-translation selection while closed still leaves the composer open at the initial target
  (Task 5 rulings above)
  - Ruling: arrow targets = per-translation Remarks of POPULATED translations only (matches scoring skipping empties); if none populated fall back to all discovered — spec says "available"; cost if wrong: empty-translation remarks unreachable by arrows
  - Ruling: target movement reuses TL.TransCursor (↑/↓ step, ←/→ toggle column) with a one-shot "first ArrowUp -> Trans1" layered on top; any other nav clears the one-shot — consistent with scoring arrows; cost if wrong: ←/→ do something the user didn't ask for
  - Ruling: while composer is open, scoring's `.tl-active-score` highlight is hidden via CSS `body.rmd-active .tl-active-score` in remark-composer's stylesheet (no state crosses modules) — user asked the Remark be highlighted "rather than" the score
  - Ruling: Q with composer closed -> enter() first (initial-target rule) then quote/focus, including the no-selection case
  - Ruling: Task 5 empties the static `#rmd-hint` text (element kept for transient Q messages); Task 6 writes the moved help into Scoring Shortcuts
- Task 6: complete (commits a61a0e8..96a57d6, review clean)
  - fix round 1/5 (6 addressed, 0 open — panel max-height cap + narrow/short-viewport tests, help wording, containment asserts, boot.js clear error; commits d2f6f9d..96a57d6)
  - Task 6: minor (deferred): `#tl-score-head` is not sticky, so the drag handle/buttons scroll out of view only when the viewport is shorter than the panel
  - Task 6: minor (deferred): help block is ~4-5 lines at default width (asked 2-3); default panel 128px -> 230px tall, 455px at 260px wide
  - Task 6: note: README/entry-file changelog still say v1.4.7 history only; README final docs wait for live verification
  - Ruling: tests/helpers/boot.js version fallback ('v1.4.7') is read from the entry file's TL.SCRIPT_VERSION instead of hard-coded, so it cannot drift — cost if wrong: none
  - Ruling: README is NOT edited in Task 6 (it already says "in progress"); final README documentation waits for live-page verification
  - Ruling: moved help goes in a compact block at the bottom of #tl-score-panel, below the status row, and must not push the panel out of the viewport or clip the status row

## Final review and finish

- Final whole-branch review (c9c5444..96a57d6): ready with fixes — see `final-review.md`.
- Fix wave `ef1f1f0` (one agent, all findings): re-reviewed, approved. Controller additionally mutation-checked the new row-change tests (removing `resolveInitialTarget()` from the row-change block makes both fail).
- Final suite on the merged tree: 79 passed; `node --check` clean on every shipped file.
- Per-task reports were copied from the git-ignored `.superpowers/` workspace into `PLANNING/reports/v1.5.0/` so they survive.
