# Confusing Sub-Category Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `C` (Confusing) open the same generic label-pick drill `2` (2 Points) already uses, on both the annotation page (Scoring Shortcuts) and the QC page (QC Compare), and narrow Remark Composer's "Likely need remarks" flag to the one Confusing leaf that actually needs free text.

**Architecture:** Confusing gained a nested, mixed-depth sub-label tree on the platform (screenshots, 2026-11-17), the same shape `2 Points` already has. Both `scoring-shortcuts.js` and `qc-compare.js` already implement `2 Points`' "write the category, leave the dropdown open, let 1-9/0 drill the rest" generically — neither has any hardcoded knowledge of `2 Points`' own sub-label names. This plan reuses that same generic path for `Confusing` (a handful of condition changes, zero new picking logic), and adds the one place that *does* need a real label string: `remark-composer.js`'s exact-match check for the single leaf that needs a remark.

**Tech Stack:** Vanilla JS userscript modules (`src/*.js`), Playwright tests (`tests/*.spec.js`) against a hand-built Ant-Design-cascader fixture (`tests/fixtures/annotation-sim.js`, reused by the QC fixture).

**Spec:** [docs/superpowers/specs/2026-11-17-confusing-subcategory-labels-design.md](../specs/2026-11-17-confusing-subcategory-labels-design.md)

## Global Constraints

- Reuse the existing generic label-mode machinery (`pickLabelByNumber` / `commitLabelAndAdvance` / `renderLabelBadges` in `scoring-shortcuts.js`; `pickLabelByNumber` / `commitLabel` / `reopenForLabelPick` in `qc-compare.js`) — no new per-category code paths.
- `2 Points`' own tree, picking behavior, and remark-flagging rule (`/^2 Points/`) are unchanged.
- The keyboard shortcut stays `C`; only its behavior changes.
- The "needs a remark" leaf is matched by exact full-string equality (`'Confusing / Other / open feedback'`), never by splitting the displayed path on `/` and counting segments — that label contains its own `/`.
- Advance (annotation page) / commit status (QC page) only ever fires on a true leaf, never on an intermediate category pick, regardless of whether that leaf sits 2 or 3 levels under `Confusing`.
- Match the repo's existing commit shape for this kind of change: one commit per task, `src` + its `tests` + the matching `README.md` line(s) together (see `1f4eb70`).

## Review Focus

- **Bare `Confusing` must count as an incomplete label**, the same way bare `2 Points` already does — otherwise the submit-check gate would wave through a translation whose Confusing pick was never finished. Pinned in Task 1 (`isLabelComplete`/`commitLabelAndAdvance`) and Task 2 (submit-check case).
- **Advance must wait for a true leaf regardless of tree depth** — a 2-level Confusing leaf (`Task input issue`) commits on the first digit; a 3-level one (`English meaning unclear ▸ …`) must not commit on the first digit, only the second. Pinned in Task 1 and Task 3.
- **The remark-flag split must be exact-string, not prefix/substring** — `Confusing / Other / open feedback` is flagged; every other complete Confusing leaf, including ones that themselves contain a `/` in their own label, is not. Pinned in Task 2.
- **QC Compare's `C` must behave like its `2` does**, not like the annotation page's old single-keystroke `C` — `relabel()`'s "leave it open, reopen and redrill" special-case was written only for `2 Points` and must be checked for `Confusing` too. Pinned in Task 3.
- **The remark-composer and submit-check "needs a remark" rules are two different features that must not be conflated** — only `likelyText()`'s informational hint is narrowed to the `Other / open feedback` leaf; `missingRemarkNumbers()`'s Enter-blocking gate is unchanged and still requires a remark on any non-3-Points, fully-labelled Confusing pick. Pinned in Task 2 by asserting both rules independently.

---

## Task 1: Confusing opens a label pick on the annotation page

**Files:**
- Modify: `tests/fixtures/annotation-sim.js` (shared by the QC fixture too — see Task 3)
- Modify: `tests/fixtures/README.md:63-68`
- Modify: `src/scoring-shortcuts.js:28-42` (`CFG`), `:155-158` (`isLabelComplete`), `:521-525` (`commitLabelAndAdvance`), `:647-649` (keydown)
- Modify: `README.md:165` (shortcuts table)
- Test: `tests/scoring.spec.js`

**Interfaces:**
- Produces (fixture): a `Confusing` root item with `expandable: true`; a `Confusing` sub-tree reachable by digits `1`-`4` in menu order — `1` = `English meaning unclear` (category, drills to a lone leaf `Meme or cultural reference unclear`), `2` = `Necessary context missing` (leaf), `3` = `Task input issue` (leaf), `4` = `Other / open feedback` (leaf). Full displayed paths: `Confusing / Necessary context missing`, `Confusing / Task input issue`, `Confusing / Other / open feedback`, `Confusing / English meaning unclear / Meme or cultural reference unclear`.
- Consumes: `TL.TransCursor`, `Utils.pickCascaderItem`, `Utils.waitFor`, `Utils.clickEl` (all unchanged, already generic — no interface changes needed here).

- [ ] **Step 1: Update the fixture to give `Confusing` a nested, mixed-depth tree**

  In `tests/fixtures/annotation-sim.js`:
  - Add, near the existing `LEAVES` array:
    ```js
    var CONFUSING_LEAVES = [
      'English meaning unclear',
      'Necessary context missing',
      'Task input issue',
      'Other / open feedback',
    ];
    ```
  - In `rootColumn()`, change `menuItem('Confusing', 'Confusing', false)` to `menuItem('Confusing', 'Confusing', true)`.
  - Add, next to `categoryColumn()`/`leafColumn()`:
    ```js
    function confusingCategoryColumn() {
      var prefix = 'Confusing' + SPLIT;
      return column(CONFUSING_LEAVES.map(function (label, index) {
        // Mirrors categoryColumn(): only the first item ("English meaning
        // unclear") drills further, so tests can tell a category click from
        // a terminal leaf. The rest (indices 1-3) are leaves straight off
        // Confusing, matching the real tree's mixed depth.
        return menuItem(label, prefix + label, index === 0);
      }));
    }
    function confusingLeafColumn() {
      var key = 'Confusing' + SPLIT + 'English meaning unclear' + SPLIT + 'Meme or cultural reference unclear';
      return column([menuItem('Meme or cultural reference unclear', key, false)]);
    }
    ```
  - In `displayFromKey()`, change `if (parts[0] !== '2 Points')` to `if (parts[0] !== '2 Points' && parts[0] !== 'Confusing')`.
  - In `onItemClick()`'s expandable branch, change:
    ```js
    if (key === '2 Points') {
      setDisplayed(root, '2 Points');
      showNextColumn(drop, categoryColumn);
    } else {
      showNextColumn(drop, leafColumn);
    }
    ```
    to:
    ```js
    if (key === '2 Points') {
      setDisplayed(root, '2 Points');
      showNextColumn(drop, categoryColumn);
    } else if (key === 'Confusing') {
      setDisplayed(root, 'Confusing');
      showNextColumn(drop, confusingCategoryColumn);
    } else if (key.indexOf('Confusing' + SPLIT) === 0) {
      showNextColumn(drop, confusingLeafColumn);
    } else {
      showNextColumn(drop, leafColumn);
    }
    ```
  - In `tests/fixtures/README.md`'s Simulator section, extend the sentence about root `data-path-key` values and re-expand reset to note that `Confusing` now nests the same way `2 Points` does (reopening it resets a deeper value back to bare `Confusing`).

- [ ] **Step 2: Write the failing tests in `tests/scoring.spec.js`**

  Remove the old single-keystroke test (currently lines 171-178, `'C sets Confusing and the advance skips the empty Trans3 when pressed on Trans2'`) and rename the surrounding `describe('3 and C advance', …)` to `describe('3 advances', …)` (it now covers only `3`).

  Add, near the top of the file next to `LABELS`:
  ```js
  // Confusing's sub-labels in menu order. Key 1 is a category with one leaf
  // below it; keys 2-4 are leaves straight off Confusing.
  const CONFUSING_LABELS = [
    'English meaning unclear',
    'Necessary context missing',
    'Task input issue',
    'Other / open feedback',
  ];
  ```

  Add, next to `openLabelMenu`:
  ```js
  async function openConfusingLabelMenu(page, n) {
    await page.keyboard.press('c');
    await expect(page.locator(`${scoreMod(n)} input`).first()).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`${scoreMod(n)} .tl-num-badge`).first()).toBeVisible();
  }
  ```

  Add a new `test.describe('C and Confusing label picks', { tag: '@logic' }, () => { … })`, mirroring `'2 and label picks'`, with:

  ```js
  test('C sets bare Confusing and leaves the label menu open without advancing', async ({ page }) => {
    await trackActive(page);
    await openConfusingLabelMenu(page, 1);
    await expectValue(page, 1, 'Confusing');
    await expectActive(page, 1);
    expect(await status(page)).toContain('press a number');
    expect(await moves(page)).toEqual([]);
  });
  ```

  ```js
  for (const key of ['2', '3', '4']) {
    const label = CONFUSING_LABELS[Number(key) - 1];
    test(`${key} commits "Confusing / ${label}" and advances to Trans2 when the Confusing menu is open`, async ({ page }) => {
      await openConfusingLabelMenu(page, 1);
      await page.keyboard.press(key);
      await expectValue(page, 1, `Confusing / ${label}`);
      await expectActive(page, 2);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    });
  }
  ```

  ```js
  test('1 drills into the Confusing category and advances once its lone leaf is committed', async ({ page }) => {
    await trackActive(page);
    await openConfusingLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expectValue(page, 1, 'Confusing / English meaning unclear / Meme or cultural reference unclear');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: 'Confusing / English meaning unclear / Meme or cultural reference unclear' }]);
  });
  ```

  ```js
  test('a Confusing category waits for the next pick instead of advancing when it has several children', async ({ page }) => {
    // Same forced-sibling trick as the 2 Points version above — generic by
    // path depth (3 segments), so it applies to Confusing's category leaf too.
    await page.evaluate(() => {
      new MutationObserver(() => {
        document.querySelectorAll('ul.ant-cascader-menu').forEach((ul) => {
          const items = ul.querySelectorAll('li.ant-cascader-menu-item');
          const key = items[0] && items[0].getAttribute('data-path-key');
          if (items.length === 1 && key && key.split('__RC_CASCADER_SPLIT__').length === 3) {
            const extra = items[0].cloneNode(true);
            extra.setAttribute('data-path-key', key + '-extra');
            ul.appendChild(extra);
          }
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await trackActive(page);
    await openConfusingLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expect.poll(() => status(page)).toContain('Category selected');
    await expectActive(page, 1);
    expect(await moves(page)).toEqual([]);

    await page.keyboard.press('1');
    await expectValue(page, 1, 'Confusing / English meaning unclear / Meme or cultural reference unclear');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: 'Confusing / English meaning unclear / Meme or cultural reference unclear' }]);
  });
  ```

  ```js
  test('a Confusing leaf pick advances past the empty Trans3 when made on Trans2', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await openConfusingLabelMenu(page, 2);
    await page.keyboard.press('3');
    await expectValue(page, 2, 'Confusing / Task input issue');
    await expectActive(page, 4);
  });
  ```

- [ ] **Step 3: Run the new/changed tests to verify they fail**

  Run: `npx playwright test tests/scoring.spec.js -g "Confusing"`
  Expected: FAIL — `C` still sets the bare leaf `Confusing` and auto-advances, so `expectValue`/`expectActive` assertions above mismatch (and `.tl-num-badge` never appears).

- [ ] **Step 4: Implement the `C` behavior change in `src/scoring-shortcuts.js`**

  - In `CFG` (around line 40, next to `advanceOn2: false`), add:
    ```js
    advanceOnConfusing: false, // Confusing is a category now too — a sub-label still needs picking
    ```
  - In `isLabelComplete(mod)` (line ~155-158), change `v !== '' && v !== CFG.pathKey2` to `v !== '' && v !== CFG.pathKey2 && v !== CFG.pathKeyConfusing`.
  - In `commitLabelAndAdvance`'s `accepted()` closure (line ~522-525), add `&& v !== CFG.pathKeyConfusing` to the existing `v !== '' && v !== before && v !== CFG.pathKey2` check.
  - In the keydown handler's `k === CFG.keyConfusing` branch (line ~647-649), change
    `enqueueScore(CFG.pathKeyConfusing, 'Confusing', true);`
    to
    `enqueueScore(CFG.pathKeyConfusing, 'Confusing', CFG.advanceOnConfusing);`

  No other function changes: `pickLabelByNumber`, `renderLabelBadges`, `startLabelBadges`, `exitLabelMode`, and the label-mode keydown branch are already generic over whatever popup is open.

- [ ] **Step 5: Run the tests to verify they pass**

  Run: `npx playwright test tests/scoring.spec.js`
  Expected: PASS (all tests in the file, including the untouched `2`/`3`/erase/label-badge ones)

- [ ] **Step 6: Update `README.md`'s Module 1 shortcuts table**

  Change line 165 from
  `| \`C\` | Score it "Confusing", then auto-advance |`
  to
  `| \`C\` | Score it "Confusing", stay put — leaves the label menu open |`
  (matching line 166's wording for `2`).

- [ ] **Step 7: Commit**

  ```bash
  git add src/scoring-shortcuts.js tests/scoring.spec.js tests/fixtures/annotation-sim.js tests/fixtures/README.md README.md
  git commit -m "v1.5.5: C opens a Confusing sub-label pick, same as 2 Points"
  ```

---

## Task 2: Narrow the "Likely need remarks" flag; prove the submit-check gate is unaffected

**Files:**
- Modify: `src/remark-composer.js:290-296` (`likelyText`)
- Modify: `README.md:51`, `:206-208`
- Test: `tests/remark-writes.spec.js`, `tests/submit-check.spec.js`

**Interfaces:**
- Consumes: `scoreText(n)` (unchanged, returns the full displayed path, e.g. `'Confusing / Other / open feedback'`); `CFG.pathKeyConfusing` / `isLabelComplete` from Task 1 (submit-check's gate already reads bare-`Confusing`-is-incomplete through `scoringShortcuts.checkCompleteness()`, no new wiring needed).
- Produces: `likelyText()` continues to return the same `'Likely need remarks: …'` / `'No translations need remarks'` strings; only which Confusing translations qualify changes.

- [ ] **Step 1: Write the failing tests**

  In `tests/remark-writes.spec.js`, inside `describe('likely-remark summary', …)`:
  - Change the first test's `setScores` call (currently `{ ...ALL_EMPTY, 1: '3 Points', 2: '2 Points / Grammar', 4: 'Confusing', 5: '2 Points' }`) to use a real flagged leaf for Trans4: `4: 'Confusing / Other / open feedback'`. The expected text (`'Likely need remarks: Trans2 (2 Points), Trans4 (Confusing), Trans5 (2 Points)'`) stays the same — `likelyText()` pushes the short `(Confusing)` label regardless of which leaf matched.
  - Change the second test's two `setScores` calls that use bare `'Confusing'` for Trans6 to `'Confusing / Other / open feedback'`; expected texts stay the same.
  - Add a new test proving the split:
    ```js
    test('a Confusing leaf other than "Other / open feedback" is not listed, even though it is a complete label', async ({ page }) => {
      await setScores(page, { ...ALL_EMPTY, 4: 'Confusing / Task input issue', 6: 'Confusing / Other / open feedback' });
      await openComposer(page);
      await expect(page.locator('#rmd-likely')).toHaveText('Likely need remarks: Trans6 (Confusing)');
    });
    ```

  In `tests/submit-check.spec.js`'s `cases` array (`describe('remark gate', …)`):
  - Change `['Confusing has an empty remark', { 4: 'Confusing' }, {}, true]` to `['Confusing has an empty remark', { 4: 'Confusing / Task input issue' }, {}, true]` — a complete, non-"Other/open feedback" leaf still blocks on a missing remark, proving the submit-check gate's own rule (any non-3-Points complete label needs a remark) is untouched by the narrower hint-line rule.
  - Add `['a Confusing label is missing though a remark is present', { 4: 'Confusing' }, { 4: 'has a remark' }, true]`, mirroring the existing bare-`2 Points` case, pinning that bare `Confusing` still blocks as an incomplete label.

- [ ] **Step 2: Run the new/changed tests to verify the expected ones fail**

  Run: `npx playwright test tests/remark-writes.spec.js -g "likely-remark"`
  Expected: FAIL — `likelyText()` still matches on bare string equality to `'Confusing'`, which none of the new leaf-path scores equal, so all three tests in `describe('likely-remark summary', …)` mismatch their expected text.

  Run: `npx playwright test tests/submit-check.spec.js -g "Confusing"`
  Expected: PASS already, with no production-code change — these two cases only changed their test *data* to a real leaf path, not the behavior under test (the submit-check gate's own "any non-3-Points complete label needs a remark" rule, in `missingRemarkNumbers()`, is untouched by this task). A pass here before Step 3 is the expected, correct result — it demonstrates Review Focus item 5 (the hint-line rule and the gate rule are independent) rather than signalling a missing step.

- [ ] **Step 3: Implement the flag narrowing in `src/remark-composer.js`**

  In `likelyText()` (line ~290-296), change:
  ```js
  else if (t === 'Confusing') parts.push(`Trans${n} (Confusing)`);
  ```
  to:
  ```js
  else if (t === 'Confusing / Other / open feedback') parts.push(`Trans${n} (Confusing)`);
  ```
  (Exact string equality — never split `t` on `/` to test depth; see Global Constraints.)

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx playwright test tests/remark-writes.spec.js tests/submit-check.spec.js`
  Expected: PASS

- [ ] **Step 5: Update `README.md`**

  - Line 51: change "shows which translations (scored 2 Points or Confusing) probably need one" to "shows which translations (scored 2 Points, or Confusing scored `Other / open feedback`) probably need one".
  - Lines 206-208: change "Under the edit box a 'Likely need remarks' line lists translations scored `2 Points` (bare or fully labelled) or `Confusing`" to "…lists translations scored `2 Points` (bare or fully labelled) or Confusing's `Other / open feedback` leaf specifically — every other Confusing sub-label is self-explanatory and is left out".

- [ ] **Step 6: Commit**

  ```bash
  git add src/remark-composer.js tests/remark-writes.spec.js tests/submit-check.spec.js README.md
  git commit -m "v1.5.5: Likely-need-remarks flags only Confusing / Other / open feedback"
  ```

---

## Task 3: Confusing opens a label pick on the QC page too

**Files:**
- Modify: `src/qc-compare.js:366-388` (`relabel`), `:421-441` (`reopenForLabelPick`)
- Modify: `README.md:225`
- Test: `tests/qc-shortcuts.spec.js`, `tests/qc-navigation.spec.js`, `tests/qc-swap.spec.js`

**Interfaces:**
- Consumes: the Task 1 fixture tree (`annotation-sim.js`'s simulator drives the QC page's editable cascader too — see `tests/fixtures/quality-sim.js`'s header comment: "The cascader itself … stays annotation-sim.js's job"), so no further fixture work is needed here.
- Produces: `relabel(n, pathKey)` and `reopenForLabelPick(n, pathKey)` — `reopenForLabelPick` gains a required second parameter (previously implicitly `CFG.pathKey2`).

- [ ] **Step 1: Write the failing tests**

  In `tests/qc-shortcuts.spec.js`:
  - Remove `{ key: 'c', score: 'Confusing' }` from the `for (const row of […])` loop in `describe('score keys', …)` (keep `{ key: '3', score: '3 Points' }` — `3` is unaffected).
  - In `describe('label menu', …)`, add a helper next to `openLabelMenu`:
    ```js
    async function openConfusingLabelMenu(page, n) {
      await page.keyboard.press('c');
      await expect.poll(() => cursorStatus(page)).toContain('press 1-9/0');
      await expectScore(page, n, 'Confusing');
      await expect.poll(() => expanded(page, n)).toBe('true');
    }
    ```
  - Add tests mirroring the existing `2`-driven ones:
    ```js
    test('opens the Confusing label menu without relabeling or moving the selection when c is pressed', async ({ page }) => {
      await openConfusingLabelMenu(page, 1);
      await expectSelected(page, 1);
    });
    ```
    ```js
    for (const row of [
      { key: '2', label: 'Necessary context missing' },
      { key: '3', label: 'Task input issue' },
      { key: '4', label: 'Other / open feedback' },
    ]) {
      test(`picks Confusing label "${row.label}" when ${row.key} is pressed with the Confusing menu open`, async ({ page }) => {
        await openConfusingLabelMenu(page, 1);
        await page.keyboard.press(row.key);
        await expectScore(page, 1, `Confusing / ${row.label}`);
        await expect.poll(() => expanded(page, 1)).toBe('false');
        await expect.poll(() => cursorStatus(page)).toBe(`Trans1 = Confusing / ${row.label} ✓`);
        await expectSelected(page, 1);
      });
    }
    ```
    ```js
    test('selects the lone sub-label too when the Confusing category is picked with 1', async ({ page }) => {
      await openConfusingLabelMenu(page, 1);
      await page.keyboard.press('1');
      await expectScore(page, 1, 'Confusing / English meaning unclear / Meme or cultural reference unclear');
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect.poll(() => cursorStatus(page)).toBe('Trans1 = Confusing / English meaning unclear / Meme or cultural reference unclear ✓');
      await expectSelected(page, 1);
    });
    ```
    ```js
    test('closes the menu and keeps bare Confusing when Escape is pressed with the Confusing menu open', async ({ page }) => {
      await openConfusingLabelMenu(page, 1);
      await page.keyboard.press('Escape');
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect.poll(() => cursorStatus(page)).toBe('Trans1: label pick cancelled');
      await expectScore(page, 1, 'Confusing');
      await expectSelected(page, 1);
    });
    ```

  In `tests/qc-navigation.spec.js`'s `'keeps the selection and an edited score when the tabs make a round trip'` test (lines ~101-116): after `await page.keyboard.press('c');`, add `await page.keyboard.press('3');` (commits the `Task input issue` leaf), and change both `await expectScore(page, 4, 'Confusing')` assertions to `await expectScore(page, 4, 'Confusing / Task input issue')`.

  In `tests/qc-swap.spec.js`, change `DATA.a1[5].score` from `'Confusing'` to `'Confusing / Task input issue'` (static seed data, not exercised through the cascader, but kept realistic for the new tree).

- [ ] **Step 2: Run the new/changed tests to verify they fail**

  Run: `npx playwright test tests/qc-shortcuts.spec.js tests/qc-navigation.spec.js -g "Confusing"`
  Expected: FAIL — `relabel()` still writes the bare `Confusing` leaf directly and collapses/blurs the dropdown (no reopen-for-pick), so `expanded` is `'false'` immediately after `c` and no further digit has anything open to act on.

- [ ] **Step 3: Implement the `C` behavior change in `src/qc-compare.js`**

  - In `relabel(n, pathKey)` (line ~366-388), change:
    ```js
    if (pathKey === CFG.pathKey2) {
      await reopenForLabelPick(n);
      setCursorStatus(`Trans${n} = 2 Points — press 1-9/0 for a label`);
    } else {
      setCursorStatus(`Trans${n} = ${pathKey} ✓`);
    }
    ```
    to:
    ```js
    if (pathKey === CFG.pathKey2 || pathKey === CFG.pathKeyConfusing) {
      await reopenForLabelPick(n, pathKey);
      setCursorStatus(`Trans${n} = ${pathKey} — press 1-9/0 for a label`);
    } else {
      setCursorStatus(`Trans${n} = ${pathKey} ✓`);
    }
    ```
  - In `reopenForLabelPick` (line ~421-441), add a `pathKey` parameter and use it in place of the hardcoded `CFG.pathKey2`:
    ```js
    async function reopenForLabelPick(n, pathKey) {
      // … unchanged body …
      const li = pickNextOnPath(selector, pathKey, 0);
      // … unchanged rest …
    }
    ```
    Update the function's header comment to speak generically about "the category just written" rather than naming `2 Points` specifically.

  No other function changes: `pickLabelByNumber`, `labelPopupFor`, `commitLabel`, `cancelLabelPick`, `PATH_KEY`, and the `onKeyDown` digit/letter dispatch are already generic.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `npx playwright test tests/qc-shortcuts.spec.js tests/qc-navigation.spec.js tests/qc-swap.spec.js`
  Expected: PASS

- [ ] **Step 5: Update `README.md`'s Module 3 shortcuts table**

  Change line 225 from
  `| \`3\` / \`2\` / \`C\` | Relabel the active translation directly to 3 Points / (open) 2 Points / Confusing |`
  to
  `| \`3\` / \`2\` / \`C\` | Relabel the active translation directly to 3 Points / (open) 2 Points / (open) Confusing |`

- [ ] **Step 6: Commit**

  ```bash
  git add src/qc-compare.js tests/qc-shortcuts.spec.js tests/qc-navigation.spec.js tests/qc-swap.spec.js README.md
  git commit -m "v1.5.5: QC Compare's C opens a Confusing sub-label pick too"
  ```

---

## Task 4: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire Playwright suite**

  Run: `npx playwright test`
  Expected: PASS — every spec file in `tests/`, not just the ones touched above (in particular `tests/capture-contract.spec.js` and `tests/harness.spec.js`, which assert structural facts about the fixtures that Task 1's `annotation-sim.js` edit must not break).

- [ ] **Step 2: Fix any unexpected failures and re-run**

  If something outside the touched files breaks, treat it as a sign the fixture change had a side effect this plan didn't anticipate — diagnose before patching (see `superpowers:systematic-debugging` if the cause isn't obvious from the failure message).

- [ ] **Step 3: Commit, if Step 2 produced any changes**

  ```bash
  git add -A
  git commit -m "v1.5.5: fix full-suite fallout from the Confusing sub-category change"
  ```
