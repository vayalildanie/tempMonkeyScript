# Task 1 report: Playwright fixture harness

Status: DONE_WITH_CONCERNS

Commit: `56ace0e` `test: add annotation UI fixture harness`

## What I implemented

A Chromium-only Playwright harness that boots the five existing `src/*.js` modules against a reduced annotation page. Production files were not edited.

- `package.json` — private package; `npm test` runs `playwright test`. Dev dependency `@playwright/test` ^1.49.0 (lockfile resolved 1.64.1).
- `playwright.config.js` — one Chromium project, `tests/` as the test dir, 1280×800 viewport.
- `tests/fixtures/annotation.html` — reduced page extracted from `C:\Users\Admin\Documents\projects\NOVA\NOVA Annotate HTML example.txt`.
- `tests/fixtures/annotation-sim.js` — cascader opener and Space submit counter.
- `tests/fixtures/README.md` — provenance and redaction notes.
- `tests/helpers/boot.js` — `bootModules(page)`.
- `tests/harness.spec.js` — boot assertion.
- `.gitignore` — kept `work-KB/`; added Playwright/npm output dirs.

`bootModules(page)` loads, in `@require` order:

1. `src/utils.js`
2. `src/trans-cursor.js`
3. `src/scoring-shortcuts.js`
4. `src/remark-composer.js`
5. `src/qc-compare.js`

It then sets `window.TL.SCRIPT_VERSION` to `v1.4.7` only if unset, and starts modules the same way `annotation-scoring-shortcuts.user.js` does: `ScoringShortcuts(Utils)`, `RemarkComposer(Utils, scoringShortcuts)`, `QCCompare(Utils)`, `installClipboardSanitizer()`, then each `start()`. The userscript entry file is not injected, so remote `@require` URLs are never fetched.

The fixture keeps nested `font[data-module-name]` wrappers, `data-module-key` (`Text`, `LabelsCascade`, `TextLabels`), `.preview-content`, `.cascade-container`, `.ant-select` / `.ant-select-selector` / combobox `input[aria-expanded]`, and per-translation textareas. Trans2 remarks are exactly `Trans 2 Remarks`. Other remarks are `TransN Remarks`. Scores are `TransN Score`. Text modules are `TransN`. Left column is Trans1–3; right column is Trans4–7.

Every `.preview-content` is nonempty lorem ipsum, distinct per translation. Trans4–Trans7 were empty in the capture and are filler here. Task copy, CDN URLs, data-URI icons, session ids, `data-module-path`, `data-module-config-id`, and the captured `tl-active-score` class were removed. Cascaders start closed.

`annotation-sim.js` opens a dropdown on selector click and renders `3 Points`, `2 Points` (expandable), and `Confusing`. `2 Points` opens a category column whose first item expands to a `Grammar` leaf; the other nine items are leaves so keys 1–9 and 0 have a target. `window.__fixture.spaceEvents` records every Space keydown/keyup. `window.__fixture.submitCount` increments only when a bubbling, not-cancelled Space `keydown` reaches the bubble-phase handler, or when `#fx-submit` is clicked. A cancelled or non-bubbling Space is recorded and does not count.

## Tests and results

Focused test, after the harness existed:

```
npx playwright test tests/harness.spec.js
  ok 1 [chromium] › tests\harness.spec.js:7:1 › boots the annotation fixture with seven texts and a visible scoring panel (514ms)
  1 passed (3.2s)
```

Full suite before commit (`npm test`, which is `playwright test`):

```
  ok 1 [chromium] › tests\harness.spec.js:7:1 › boots the annotation fixture with seven texts and a visible scoring panel (379ms)
  1 passed (1.2s)
```

There are no other tests in the repo. No production syntax check was required; `src/` was not modified.

## TDD evidence

RED — written first, before `package.json`, the fixture, the simulator, or `boot.js`:

```
npx playwright test tests/harness.spec.js
```

Failed because the project did not exist:

```
Error: Cannot find module '@playwright/test'
Require stack:
- ...\tests\harness.spec.js
Error: No tests found.
```

That is the expected failure: no Playwright project, no fixture, no boot helper. `npx` briefly installed the `playwright` runner (not `@playwright/test`) while reporting the missing module.

GREEN — same command after the harness, Chromium install, and no production edits:

```
1 passed (3.2s)
```

## Files changed

Committed in `56ace0e`:

- `.gitignore`
- `package.json`
- `package-lock.json`
- `playwright.config.js`
- `tests/fixtures/README.md`
- `tests/fixtures/annotation.html`
- `tests/fixtures/annotation-sim.js`
- `tests/helpers/boot.js`
- `tests/harness.spec.js`

Not committed, left as found: `PLANNING/` untracked, and the pre-existing `docs/superpowers/` deletions. `README.md` and `src/` were not touched. QC Compare source was not touched.

## Self-review

- The boot test fails if the fixture is missing, a translation text is empty, two translations share the same text, `TL.SCRIPT_VERSION` is missing, or `#tl-score-panel` is not visible. That panel is injected by `ScoringShortcuts.start()`, so the test is a real boot, not a file-exists check.
- Module names and nesting come from the capture. Preview text does not.
- `bootModules` does not load `annotation-scoring-shortcuts.user.js`, by the task ruling. Version fallback matches the current entry point (`v1.4.7`).
- Submit counting is separate from raw Space recording, which is what Task 4 needs. This task does not assert that path; a later test should.
- Dropdowns are appended inside `.ant-select` (`position: relative`) so `Utils.edgeGap` can treat them as adjacent to the selector. Live NOVA may portal dropdowns to `document.body`. If adjacency tests fail later, move the popup and position it against the trigger instead of changing production code first.
- Category labels are a small stand-in (`Grammar`, `Authenticity`, …), not the capture's label tree. The capture had no open cascader menus and no `data-path-key` values. Root keys the userscript already uses (`3 Points`, `2 Points`, `Confusing`) are present.
- Clicking a category sets or keeps a `2 Points` prefix and adds a column; a leaf click joins with ` / ` and closes. A failed leaf click that does not change the DOM will leave a bare `2 Points`, which is the failure mode Task 3 wants to detect.
- `.gitignore` originally replaced `work-KB/`. That was restored before commit.

## Concerns

1. Popup placement is inside the control, not body-portaled. Later scoring tests may need the simulator to position an open menu the way Ant does if `edgeGap` behaves differently.
2. Label menu text is synthetic. Only the interaction shape (expand vs leaf, `data-path-key`, `ant-cascader-menu-item`) is contracted for later tasks.
3. `window.__fixture.submitCount` / `spaceEvents` are implemented and documented, but this task's only test does not exercise them. Task 4 is the first proof that a synthetic Space increments `submitCount` exactly once.
4. Chromium was installed with `npx playwright install chromium` (Chrome for Testing 156.0.8078.4 / playwright chromium v1248). The first install attempts timed out in the foreground and completed when rerun in the background.

## Review fix

Commit: `aa88d3f` `test: make fixture clicks and score states usable`

### What changed

- `annotation-sim.js` now handles the `mousedown` + `mouseup` + `click` sequence `Utils.clickEl` sends. The selector toggles on `mousedown` and ignores the rest of that gesture, so focusing the combobox input cannot drop the open. Menu items and `.ant-select-clear` use the same sequence. A click-only listener is no longer the only path.
- Nested `data-path-key` values use `__RC_CASCADER_SPLIT__` (`2 Points__RC_CASCADER_SPLIT__Grammar`, and `2 Points__RC_CASCADER_SPLIT__Grammar__RC_CASCADER_SPLIT__Grammar` for the leaf). Display text stays the label, joined with ` / ` for the selection item. Root keys remain exact `3 Points`, `2 Points`, and `Confusing`.
- Re-expanding `2 Points` resets the displayed value to bare `2 Points`.
- `.ant-select-clear` is 16×16 and shown when a value is selected.
- Trans3 `.preview-content` is empty. Trans2 Score starts closed on bare `2 Points` with a visible clear control. Trans4–Trans7 remain nonempty distinct lorem ipsum. `Trans 2 Remarks` is unchanged.
- `tests/harness.spec.js` asserts the empty Trans3, the closed `2 Points` clear control, and that `Utils.clickEl` opens Trans1's menu and selects `3 Points`.

RED before the fixture/simulator edits (assertion written first):

```
npx playwright test tests/harness.spec.js
  x  boots ... Expected: "" Received: "Duis aute irure dolor ..."
  ok Utils.clickEl opens a cascader and selects 3 Points
  1 failed, 1 passed
```

The empty-text failure was the missing row state. The click test passed via `element.dispatchEvent` even on the old click listener, because those events do not retarget the way a trusted click does. The simulator was still changed so `mousedown` opens the menu before focus moves, which is the production `clickEl` sequence.

GREEN:

```
npx playwright test tests/harness.spec.js
  ok 1 [chromium] › tests\harness.spec.js:7:1 › boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel (445ms)
  ok 2 [chromium] › tests\harness.spec.js:42:1 › Utils.clickEl opens a cascader and selects 3 Points (268ms)
  2 passed (1.7s)
```

No `src/` or README changes. PLANNING/ and the pre-existing docs deletions were left unstaged.
