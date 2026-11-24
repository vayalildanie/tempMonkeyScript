# Test Suite Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the Playwright suite from 323 to about 290–297 tests (about 9–10 s of the 86 s run) by removing tests that re-prove the same behaviour, without lowering line coverage or the regression-catching power of the suite.

**Architecture:** Test-only change. No file under `src/` or the userscript changes, so there is no version bump. Each cut is justified by reading the source: the cut tests exercise code paths that are provably shared (`Utils.pickCascaderItem`, `Utils.runSubmitGate`, `Utils.needsRemark`). Each trim is proven safe by a mutation check: break the source on purpose, confirm the trimmed suite still fails, then revert.

**Tech Stack:** Playwright (`npm test`, `npm run coverage`), plain-JS specs in `tests/`.

**Spec:** None. The basis is the testing summary given to the user on 2026-11-23, corrected below where reading the source changed it.

## Global Constraints

- `src/**` and `annotation-scoring-shortcuts.user.js` stay untouched. `git diff --stat main -- src annotation-scoring-shortcuts.user.js` must be empty at the end.
- `npm run coverage` must report total line coverage of at least 98.1% (baseline in `tests/coverage-baseline.json`, tolerance 0.5). The uncovered-line lists must not gain a new entry. Baseline lists (captured 2026-11-23, 323 tests):
  - `qc-compare.js`: 296, 330, 331, 408, 409, 434, 435, 459, 460, 461, 1109
  - `remark-composer.js`: 195, 646, 647, 696, 716, 717, 720, 723, 724
  - `scoring-shortcuts.js`: 84, 299, 300, 381–384, 388–390, 399, 400, 410–413, 470, 623–625, 820–822
- Do not drop a case that guards a distinct input. Cut only a case whose code path another kept test already drives.
- Work on branch `chore/trim-tests`. Do not push or merge without asking.

## Corrections to the earlier summary

- The earlier "270–280 tests, 15 s" estimate was too optimistic. Reading the source gives **323 → about 290 (all tasks) or about 297 (skipping optional Task 4)**, and about 9–10 s saved.
- Quoting (`remark-writes.spec.js`) cannot become a pure `page.evaluate` table as the summary suggested. `tryQuoteSelection` depends on a real DOM selection, so it is made optional (Task 4) with a measured go/no-go.
- `qc-swap`'s 11 failsafe tests and the four remark-composer files are **not** trimmed. They guard distinct data-loss and geometry behaviour.

## Review Focus

Inputs the trimmed suite must still catch. Each is pinned by a mutation check in the task that owns it.

1. Check mode `off` leaves Enter alone even on a row Submit Check would block (Task 1, M3).
2. Label Check blocks a blocked row **and** passes a clean row without submitting (Task 1, M2).
3. A non-3 score with a whitespace-only remark still blocks (kept row in the Task 1 table).
4. `Confusing / Other / open feedback` needs a remark, while every other Confusing leaf and bare `Confusing` do not (Task 2, M1).
5. A QC two-key Confusing path and the one-key Other leaf still resolve through `pickCascaderItem` (Task 3, M4).

---

### Task 0: Baseline

**Files:**
- Create (untracked scratch): `<scratchpad>/baseline/` holding `baseline.json`, `titles.txt`, `coverage.txt`.

- [ ] **Step 1: Create the branch.** `git switch -c chore/trim-tests`.
- [ ] **Step 2: Capture timing and titles.** Run `npx playwright test --reporter=json > <scratchpad>/baseline/baseline.json` and `npx playwright test --list > <scratchpad>/baseline/titles.txt`. Expected: 323 passed; `titles.txt` ends `Total: 323 tests in 15 files`.
- [ ] **Step 3: Capture coverage.** Run `npm run coverage > <scratchpad>/baseline/coverage.txt`. Expected: `OK: total line coverage 98.1% vs baseline 98.1%`.
- [ ] **Step 4: Per-file time table.** Sum `duration` per spec file from `baseline.json` and write it to `<scratchpad>/baseline/per-file.txt`. This replaces the unmeasured per-file times in the summary and is the "before" for Task 5.

No commit.

---

### Task 1: Collapse the remark-gate matrix

**Why:** `submitBlocker` (`src/remark-composer.js:990`) does not depend on the check mode. `performCheck` (line 1002) only returns early for `off` and passes `submit: checkMode === 'submit'` to `Utils.runSubmitGate`. The 10 table rows × 3 modes therefore re-prove the same blocking decision 3 times, and all 10 `off` rows assert the same thing.

**Files:**
- Modify: `tests/submit-check.spec.js:212-277` (the `remark gate` describe).
- Read first: `tests/submit-check.spec.js:55-73` (`Label Check`). If an existing test there already covers "Label Check blocks" or "Label Check passes without submitting", do not add the duplicate below.

**Interfaces:**
- Consumes (already in the file): `cycleTo(page, 'label'|'submit'|'off')`, `setScores(page, {...ALL_THREE, ...scores})`, `setRemarks(page, remarks)`, `expectOutcome(page, mode, blocked)`, `cases`.
- Produces: nothing for later tasks.

- [ ] **Step 1: Mutation baseline (should go RED later, not now).** Apply M2 and M3 below on the *current* suite and confirm each makes at least one test fail. This proves the mutations are detectable before the trim.
  - M2: in `src/remark-composer.js:1008`, change `submit: checkMode === 'submit'` to `submit: true`. Run `npx playwright test submit-check -g "remark gate"`. Expected: FAIL (label-mode "Enter passes" rows).
  - M3: delete line 1004 (`if (checkMode === 'off') return;`). Expected: FAIL (off-mode rows).
  - Revert each with `git checkout -- src/`.
- [ ] **Step 2: Replace the three-mode loop** (`for (const mode of ['label','submit','off'])`, lines 254-266) with:
  - the `cases` table run **only in Submit Check**: `test(`${blocked ? 'Enter is blocked' : 'Enter submits'} when ${label}`)` calling `cycleTo(page,'submit')` then `expectOutcome(page,'submit',blocked)` (10 tests);
  - `test('Label Check blocks Enter when a non-3 score has no remark')`, using the first row of `cases` with `expectOutcome(page,'label',true)`;
  - `test('Label Check lets Enter through without submitting when the row is clean')`, using the `3 Points has an empty remark` row with `expectOutcome(page,'label',false)`;
  - `test('Enter is left alone when the check is off, even on a row Submit Check would block')`, using the first row with `cycleTo(page,'off')` and `expectOutcome(page,'off',true)`.
  Leave the two toast tests (lines 269-276) as they are.
- [ ] **Step 3: Run.** `npx playwright test submit-check`. Expected: PASS, with the `remark gate` describe at 15 tests (was 32); the file at 38 tests.
- [ ] **Step 4: Mutation check.** Re-apply M2, run `-g "remark gate"`. Expected: FAIL at the "Label Check lets Enter through" test. Revert. Re-apply M3. Expected: FAIL at the "check is off" test. Revert.
- [ ] **Step 5: Commit.** `git add tests/submit-check.spec.js && git commit -m "test: run the remark-gate table once in Submit Check, with one test each for Label Check and off"`.

---

### Task 2: Collapse the Confusing parity block

**Why:** `Utils.needsRemark` is pure and already reachable as `window.TL.Utils.needsRemark` (the same access pattern as `window.TL.Utils.dispatchNativeSpace` on line 280). Eight end-to-end tests each open the composer to check one string.

**Files:**
- Modify: `tests/submit-check.spec.js:299-332`.

**Interfaces:**
- Consumes: `window.TL.Utils.needsRemark(text: string | null | undefined): boolean` from `src/utils.js`; the `LEAVES` and `ALL_THREE` constants already in the block.
- Produces: nothing.

- [ ] **Step 1: Write the pure table test first.**
  `test('needsRemark: only Other / open feedback and non-Confusing, non-3 labels need a remark')` runs `page.evaluate` over these pairs and compares the results as one object. The failure message must name the string.
  - `[ '', false ]`, `[ '   ', false ]`, `[ 'Confusing', false ]`, `[ '3 Points', false ]`, `[ '2 Points', true ]`, `[ '2 Points / Fluency', true ]`, `[ 'Confusing / Task input issue', false ]`, `[ 'Confusing / Necessary context missing / Essential referent unresolved', false ]`, `[ 'Confusing / English meaning unclear / Key word, phrase, or symbol unclear', false ]`, `[ 'Confusing / Other / open feedback', true ]`.
- [ ] **Step 2: Run it.** Expected: PASS. It describes existing behaviour, so a pass is correct. Then apply M1 below and expect FAIL.
  - M1: in `src/utils.js` `needsRemark`, change `return t === 'Confusing / Other / open feedback';` to `return false;`. Expected: this test and the Other-leaf end-to-end test FAIL. Revert with `git checkout -- src/`.
- [ ] **Step 3: Shrink the end-to-end loop.** Keep the "Submit Check submits once…" test. Replace `for (const leaf of LEAVES)` with a four-leaf list: `'2 Points / Fluency'`, `'Confusing / English meaning unclear / Key word, phrase, or symbol unclear'`, `'Confusing / Task input issue'`, `'Confusing / Other / open feedback'`. The parity check keeps its body, and its title keeps the leaf name. Delete the unused `LEAVES` entries.
- [ ] **Step 4: Run.** `npx playwright test submit-check`. Expected: PASS; the parity describe has 6 tests (was 9); the file has 35 tests (was 55).
- [ ] **Step 5: Commit.** `git commit -am "test: check needsRemark as a table and keep four end-to-end parity leaves"`.

---

### Task 3: Stop re-proving the shared label picker on the QC page

**Why:** Both pages resolve a key to a leaf through `Utils.pickCascaderItem` (`src/qc-compare.js:527`, `src/scoring-shortcuts.js:565`). `scoring.spec.js` already runs every Confusing leaf (`CONFUSING_PATHS`, 7 tests) and all nine digit labels. `qc-shortcuts.spec.js` repeats the 7 leaves and 3 of the digits. What is QC-specific is that the cursor does **not** advance and the status text differs; a few representatives show that.

**Files:**
- Modify: `tests/qc-shortcuts.spec.js:37-49` (single-row loop) and `:109-124`, `:151-174`.

**Interfaces:**
- Consumes: `openLabelMenu`, `openConfusingLabelMenu`, `expectScore`, `cursorStatus`, `expectSelected`.
- Produces: nothing.

- [ ] **Step 1: Inline the one-row loop.** Replace `for (const row of [{ key:'3', score:'3 Points' }])` with a single test. Behaviour is unchanged and the count stays the same.
- [ ] **Step 2: Cut the digit rows from 3 to 1.** Keep `{ key: '3', label: 'Unauthentic Vocabulary / Collocations' }` (the label that contains a "/"). Remove Fluency and Authenticity.
- [ ] **Step 3: Cut the Confusing paths from 7 to 3.** Keep `['1','1']` (a two-key path, which asserts the "Category selected" status), `['3']` (a one-key path) and `['4']` (the Other leaf, whose label contains a "/"). Add a comment above the list: `// The full leaf matrix runs in scoring.spec.js; both pages share Utils.pickCascaderItem.`
- [ ] **Step 4: Run.** `npx playwright test qc-shortcuts`. Expected: PASS; 20 tests (was 26).
- [ ] **Step 5: Mutation check (M4).** In `src/utils.js`, inside `pickCascaderItem`, make the drill case return `'leaf'` where it returns `'drilled-category'` (read the function at `src/utils.js:199` and pick the minimal edit). Run `npx playwright test qc-shortcuts scoring`. Expected: FAIL in **both** files, so the QC page still catches a broken picker. Revert with `git checkout -- src/`.
- [ ] **Step 6: Commit.** `git commit -am "test: QC keeps representative label paths; scoring.spec.js owns the full matrix"`.

---

### Task 4 (optional, go/no-go): Batch the refused-quote rows

**Why:** 8 of the 15 rows in `remark-writes.spec.js:141-157` (`accepted === false`) assert the same refusal: hint text, nothing written, selection kept. Each pays a full `boot` (about 0.3 s). Batching saves about 7 tests but gives up one-failure-per-row reporting, so it is optional.

**Go/no-go:** From `per-file.txt`, sum the 8 refused rows' durations. **Skip this task if the sum is under 3 s.**

**Files:**
- Modify: `tests/remark-writes.spec.js:158-182`.

- [ ] **Step 1: Split the table** into `accepted` rows (7, unchanged loop) and `refused` rows (8).
- [ ] **Step 2: Write one test** `Q refuses and writes nothing for each selection that spans more than one translation or the Note`. For each refused row, use `await test.step(label, …)` containing: `makeSelection`, press `q`, `expect.soft` on the hint text, empty remarks and kept selection. To stop a stale hint from the previous row passing falsely, clear it first with `page.evaluate(() => { document.querySelector('#rmd-hint').textContent = ''; })`. Replace `expect` with `expect.soft` so every row is reported.
- [ ] **Step 3: Run.** `npx playwright test remark-writes`. Expected: PASS; 31 tests (was 38).
- [ ] **Step 4: Mutation check (M5).** In `src/remark-composer.js`, weaken the containment check at line 554 so it returns `true` for any non-empty selection. Run `-g quoting`. Expected: FAIL, with the failing step names in the output. Revert.
- [ ] **Step 5: Commit.** `git commit -am "test: batch the refused-quote selections into one stepped test"`.

---

### Task 5: Verify, record, finish

**Files:**
- Modify: `README.md` (test count and the testing-section figures; search for `323`).

- [ ] **Step 1: Full run.** `npm test`. Expected: all pass; the total is 290 (297 if Task 4 was skipped). Record the new count and the elapsed time.
- [ ] **Step 2: Coverage.** `npm run coverage`. Expected: `OK: total line coverage` at least 98.1%, with no line added to the baseline uncovered lists in Global Constraints. If a line is newly uncovered, restore the cut test that drove it, or note that the line was driven only by it.
- [ ] **Step 3: Source untouched.** `git diff --stat main -- src annotation-scoring-shortcuts.user.js`. Expected: empty.
- [ ] **Step 4: README.** Update the test count and, if present, the per-file counts (`submit-check`, `qc-shortcuts`, and `remark-writes` if Task 4 ran). Do not touch the version-history entries.
- [ ] **Step 5: Before/after table.** Record per-file counts and times against `per-file.txt` in the final message.
- [ ] **Step 6: Commit.** `git commit -am "docs: update test counts after the trim"`. Ask the user before merging or pushing.

## Expected result

| File | Before | After |
|---|---|---|
| `submit-check` | 55 | 35 |
| `qc-shortcuts` | 26 | 20 |
| `remark-writes` | 38 | 31 (or 38 if Task 4 is skipped) |
| **Suite** | **323** | **290 (or 297)** |

## Self-review notes

- Spec coverage: every cut in the summary maps to a task, except the "dedupe label menu" claim, which was narrowed to QC-only (annotation keeps the full matrix) and the quoting claim, which was downgraded to optional.
- Not done on purpose: the `qc-swap` failsafe group, the remark-composer files and `perf` are not trimmed because they guard separate behaviour.
