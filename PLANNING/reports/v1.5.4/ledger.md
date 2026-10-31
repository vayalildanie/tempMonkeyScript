# v1.5.4 Ledger

Patch for a reported display problem: the Remark Options window "often does not show properly". Branch `release/v1.5.4` (from `main` at `6bd46cf`, v1.5.3).

## Diagnosis (surface-level scan, then reproduced in headless Chromium on the fixture)

Not user error. Two defects in `src/remark-composer.js`:

1. **Saved position and size were applied unchecked.** `enter()` applied `applySavedPos` and `applySavedSize` as stored, and a saved position set `pinned`, which skipped the on-screen clamp in `openPopover`. The viewport clamp only ran while dragging. Reproduced: a position saved on a 1920x1080 screen reopened in a 1280x800 window put the window at left 1500 (right edge 1880), entirely off-screen; a saved height of 1200 in an 800px window cut off the bottom (hint line and resize handle). Width was already capped by the CSS `max-width: 92vw`.
2. **A window removed by the page came back hidden.** `onMutate` re-created a missing `#rmd-popover` but the new element has `display: none` from the stylesheet and nothing restored it while `active`, so the composer kept `body.rmd-active` (keyboard yielded) with nothing on screen. Reproduced. Whether the real page removes it is unknown; the re-create code predates this.

## Fix

- `fitPopover` (new): clamps the live window into the viewport (8px pad), shrinking width and height if needed, without touching localStorage, so the remembered layout comes back on a bigger screen.
- `showPopover` (new): the size, position and show logic that was inline in `enter()`, now shared; it ends with `fitPopover`.
- `onMutate`: after re-creating the window while it is open, call `showPopover()` and reload the edit box from the target.
- A `resize` listener re-fits an open window.

## Evidence

- 7 new tests in `tests/remark-window.spec.js` (3 `@layout` rows for bad saved geometry plus a control, 1 resize, 2 re-create). All fail without the matching fix: removing `fitPopover` failed the 3 geometry rows; removing the resize listener failed the resize test; removing the re-show failed the re-create test; re-showing without reloading the edit box failed it too.
- Full suite: see the commit; version markers `1.5.4` agree (`release-smoke`).
- Reproduction probe (before/after, same script): before, 2 of 3 saved-geometry cases off-screen and the re-created window `display: none`; after, all fully on screen and the re-created window visible at the same place.

## Not done / unknown

- No live NOVA check. If the symptom persists after this patch it is something else (the scan found nothing that would make chips overlap or boxes look squashed); a screenshot would be needed.
