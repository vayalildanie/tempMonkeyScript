# v1.5.0 final-review fix report

1. **Stale timer on mode change** – `cycleCheckMode` (src/remark-composer.js) now calls `clearTimeout(autoAdvanceTimer)`. tests/submit-check.spec.js: the pinned test was renamed "leaving Submit mode cancels the pending timer: no Enter is dispatched at all" and asserts `enterPrevented` is `[]` (plus no submit/Space).
   Mutation: with the `clearTimeout` line stashed away, the test failed: `Expected: []  Received: [false]` at submit-check.spec.js:199 (12 passed, 1 failed). Restored; passes.
2. **Unverified caveat** – comment-only: src/utils.js `dispatchNativeSpace` and the 1.5.0 header paragraph now say Space retargeting is UNVERIFIED on live NOVA (assumed hotkey guard), needing a live Submit Check smoke test (tests/fixtures/README.md referenced in utils.js).
3. **Header accuracy** – 1.5.0 paragraph now mentions the "Likely need remarks" line, removal of the "Trans N" backdrop highlight, and the optional-space Trans-name parser. The safety note now states the empty-row auto-advance exception (1s timer, same check, cancelled by row change or mode cycle) instead of "never on a timer".
4. **README** – banner rewritten (implemented + 76 tests on branch, not live-verified, not pushed, installed copies stay v1.4.7 until push, Submit Check needs smoke test); Module 4 "Deferred to `v1.5`" -> `v1.6`. No other README edits.
5. **New tests (tests/remark-targets.spec.js, "row change and re-render while open")**: (a) row change re-resolves the initial target (4 -> 5), #rmd-edit shows Trans5's value, old row's typed text and all other boxes intact, one-shot jump re-armed; (b) same-target row change reloads the new row's text (value swapped with no input event); (c) cursor.sync fallback: emptying the active target's translation moves target 4 -> 2 with no writes. No production bug found; all passed first run.
6. **scoring.spec.js** – negative assertion replaced with `.toBe('2 Points')` (the displayed value after the category click while the leaf failed).

## Verification
- `npx playwright test tests/submit-check.spec.js tests/remark-targets.spec.js tests/scoring.spec.js` -> 69 passed
- `npm test` -> 79 passed (76 + 3 new)
- `node --check` on entry file and src/*.js -> no output (all OK)
