# Task 4 report: Submit Check Space regression

## Status
DONE_WITH_CONCERNS. The live root cause is NOT proven. The real NOVA key listener is not in the captured HTML.

## What was done
1. `tests/fixtures/annotation-sim.js`: the platform-like Space handler is now a stricter model. It is a window-level bubbling `keydown` listener. It counts a submit only if `bubbles`, not `defaultPrevented`, `key === ' '`, `code === 'Space'`, and the target is not INPUT/TEXTAREA/SELECT/contenteditable (this includes the cascader's readonly search input). Every Space keydown/keyup is still recorded in `window.__fixture.spaceEvents` (target tag, bubbles, defaultPrevented, key/code, accepted), separate from `submitCount`.
2. `tests/fixtures/README.md`: each assumption is documented as an ASSUMPTION, with an explicit note that it is unverified against live NOVA.
3. `tests/submit-check.spec.js`: 11 tests covering Label Check, Submit Check (incomplete, complete, focus on a readonly cascader input), Check Off, `z` cycling plus reload persistence, the mouse override, and empty-row auto-advance with both stale-timer cancellations.
4. `src/utils.js` `dispatchNativeSpace`: if `document.activeElement` is an INPUT/TEXTAREA/SELECT/contenteditable, the Space is dispatched at `document.body`. Otherwise it targets activeElement/document as before. It is still exactly one keydown+keyup pair. `src/remark-composer.js` was not changed. The completeness check is not bypassed.

## TDD record
- RED (unmodified src, new strict fixture): `Submit Check > complete row with focus left on a cascader readonly input: still one submit` failed. It recorded one Space keydown and one keyup at INPUT, with `submitCount` 0 (expected 1). This confirms the hypothesis against the fixture model.
- Unexpected passes, with no change needed: Label Check, Submit Check complete row with body focus (Space went to BODY), Check Off, mouse override, and the three auto-advance tests. These passed on unmodified code. The auto-advance Enter is dispatched on `document` while focus is on the body, so Space reaches the body.
- One test-only failure was my own mistake: the Off badge text is "Check OFF", not "Check Off". I fixed the assertion. It was not a production issue.
- GREEN after the utils.js fix: `npm test` gives 39 passed (11 new, 28 earlier). `node --check src/remark-composer.js src/utils.js` is OK.

## Notes
- Enter's `defaultPrevented` is read via a window-capture listener that keeps the event object. This still sees events the script stops with `stopImmediatePropagation`.
- Complete rows are built by pressing real `3` keys six times (Trans1, 2, 4-7).
- Auto-advance tests use bounded real waits (500ms and 2000ms). They do not use `page.clock`.
- Turning Submit Check off before the stale timer fires: the timer still dispatches Enter, but `performCheck` returns for `off`, so nothing submits. The production code does not clear the timer on a mode change. That is harmless, and I left it alone.

## Residual uncertainty / live-page smoke test steps
- Unproven: that live NOVA's listener ignores events whose target is an input, that it listens on window/document in the bubbling phase, or that it only needs `key`/`code`. If its real guard differs (for example it checks `isTrusted`, or reads focus or button state), this fix may not restore the live behavior. A synthetic `KeyboardEvent` is never `isTrusted`, so no event fix could pass an `isTrusted` check.
- The input-target hypothesis is only one plausible cause. The fix is harmless if the hypothesis is wrong: it changes the target only when the focus is on a form control.
- Smoke test on the live page (userscript with this branch):
  1. Open the console. Run `window.addEventListener('keydown', e => console.log('Space?', e.key, e.code, e.target.tagName, e.isTrusted), true)`.
  2. Press `z` until the pill shows Submit Check. Score all translations. Pick at least one with the mouse so a cascader input keeps focus.
  3. Press Enter. Expect exactly one logged Space keydown with target BODY, followed by one real submit, with the row advancing once. If a Space is logged but nothing submits, check the next step.
  4. Press a real Space on the same page. Compare `isTrusted`, target, and result. If the real press works and ours doesn't, the platform filters synthetic events, and that needs a different approach.
  5. Also confirm that an incomplete row stays blocked, and that Check Off and Label Check never log a Space.

## Review fix pass
Changes (tests only; no production change):
- **Stale timer test (Important).** It now asserts `enterPrevented(page)` equals `[]`, meaning no Enter keydown is dispatched at all. The old Space/submit assertions are kept. A stale Enter against the unscored new row would have been blocked, so it never reached Space and the old test could not tell.
- **Mutation checked:** I deleted `clearTimeout(autoAdvanceTimer);` (src/remark-composer.js:952) locally.
  Command: `npx playwright test tests/submit-check.spec.js -g "stale timer"`. Output:
  ```
  1) ... › a later row change to a non-empty row cancels the stale timer
     Error: expect(received).toEqual(expected) // deep equality
     - Array []
     + Array [ true ]
       186 | expect(await enterPrevented(page)).toEqual([]);
  ```
  It then passes with the clearTimeout restored (`git checkout src/remark-composer.js`; the mutation was not committed and `git diff src` is empty).
- **Mode-leave test renamed** to "an Enter fired after leaving Submit mode is not prevented and does not submit". It asserts `enterPrevented === [false]`, no Space and `submitCount` 0. It does not claim cancellation: the timer is not cleared on a mode change, and `performCheck` ignores Enter in Off mode.
- **Pill assertions** now use the auto-retrying `expect(locator('#rmd-check-pill')).toContainText(...)`. The redundant post-reload `mode()` assertion is gone. The post-reboot pill text is the persistence proof.
- **Added two `dispatchNativeSpace` target tests**, calling `TL.Utils.dispatchNativeSpace()` directly. A focused TEXTAREA gives one keydown+keyup pair at BODY. A focused `#fx-submit` BUTTON gives one pair at BUTTON. Each gives `submitCount` 1.

Verification: `npx playwright test tests/submit-check.spec.js` gives 13 passed. `npm test` gives 41 passed. `node --check src/utils.js` is OK.
