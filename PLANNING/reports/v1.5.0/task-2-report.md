# Task 2 report: Shared parser and cursor regression

Status: DONE_WITH_CONCERNS

Commit: `6ca1915` `fix: parse spaced translation module names`

## What I implemented

`Utils.transNumFromModuleName` now allows one optional space between `Trans` and its number. The suffix is still matched exactly, including its leading space when the caller passes one.

```javascript
const m = new RegExp(`^Trans ?(\\d+)${suffix}$`).exec(name);
```

That accepts the fixture's exact `Trans 2 Remarks` spelling and still rejects `Trans1 Score` when the suffix is `Remarks`, `Trans 2 Remarks` when the suffix is empty or ` Score`, and `Trans  2` (two spaces). `src/trans-cursor.js` was not edited. QC Compare and `README.md` were not edited.

## Tests and results

RED, before the parser change:

```
npx playwright test tests/shared.spec.js
  x  parses Trans module numbers ... Expected: 2 Received: null
     tests/shared.spec.js:25  Trans 2 Remarks
  ok TransCursor toggles columns, remembers slots, falls back, and nextIn advances
  1 failed, 1 passed
```

GREEN:

```
npx playwright test tests/shared.spec.js
  ok 1 [chromium] › tests\shared.spec.js:19:1 › parses Trans module numbers and rejects unrelated names and wrong suffixes (372ms)
  ok 2 [chromium] › tests\shared.spec.js:62:1 › TransCursor toggles columns, remembers slots, falls back, and nextIn advances (256ms)
  2 passed (1.4s)
```

Full suite before commit (`npm test`):

```
  ok 1 [chromium] › tests\harness.spec.js:7:1 › boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel (513ms)
  ok 2 [chromium] › tests\shared.spec.js:19:1 › parses Trans module numbers and rejects unrelated names and wrong suffixes (470ms)
  ok 3 [chromium] › tests\harness.spec.js:42:1 › Utils.clickEl opens a cascader and selects 3 Points (286ms)
  ok 4 [chromium] › tests\shared.spec.js:62:1 › TransCursor toggles columns, remembers slots, falls back, and nextIn advances (289ms)
  4 passed (1.7s)
```

## TDD evidence

The parser test was written against the unchanged regex `^Trans(\\d+)${suffix}$`. The first red run failed at `Trans 2 Remarks` returning null, which is the expected failure. The cursor test failed on that same first run because its expectations did not match `TransCursor`. Those expectations were corrected against the existing implementation; production cursor code was not changed. After that correction, a second red run failed only on `Trans 2 Remarks` (cursor test passed). The one-line parser change then made both tests pass.

## Files changed

Committed in `6ca1915`:

- `src/utils.js`
- `tests/shared.spec.js`

Not committed, left as found: `PLANNING/` untracked, and the pre-existing `docs/superpowers/` deletions. Not pushed.

## Self-review

- `Trans1`, `Trans1 Score`, and `Trans1 Remarks` still parse to 1 with the matching suffix.
- `Trans 2 Remarks` with suffix ` Remarks` parses to 2. The same node with `''` or ` Score` stays null, so a Score suffix cannot match a Remarks module.
- Unrelated names, a `MyTrans1` prefix, two spaces, a missing space before `Score`, and a trailing extra token stay null.
- Cursor coverage uses the real `window.TL.TransCursor`: left/right toggle from Trans1 lands on Trans4; remembered slots return to Trans6 and Trans2; a remembered right slot that is absent while the cursor is on the left stays put (toggle returns null, current remains Trans1); an empty right column stays put; a first-visit right column falls back to Trans5; `nextIn` advances, clamps at the end, and returns a missing number unchanged.
- `src/trans-cursor.js` did not need an edit. The cursor regression passed against the existing implementation.

## Concerns

1. Retracted. The original missing-slot scenario did not exercise the stay-put path, and there is no cursor discrepancy. See the review fix below.
2. Only a single optional space is accepted. `Trans  2` (two spaces) still returns null, matching the ruling that whitespace between Trans and the number is optional, not arbitrary.
3. `transHasText` still queries `[data-module-name="TransN"]` with no space. The fixture's text modules are unspaced, so this task did not change that helper.

## Review fix

The original `missingRememberedSlot` scenario called `set(1)` then `set(6)` against `[1, 2, 3, 5, 7]`. That left `cur` at 6 and `lastColRight` at 6, with `lastColLeft` at 1. `toggleColumn` calls `resolve` first, and `resolve` moves an absent `cur` down to the nearest lower listed number, so 6 became 5 before any target was chosen. The cursor was then in the right column, `goingRight` was false, and the target was the remembered left slot 1. That is the ordinary remembered-slot path. It never reached the first-listed fallback (`trans-cursor.js` line 94) or the stay-put guard (line 96). Returning 1 was also ambiguous: Trans1 is both the remembered left slot and the first listed number. The cursor does not violate its stay-put comment. Concern #1 was wrong.

The replacement calls `set(6, { silent: true })` then `set(1, { silent: true })` on the same list. `cur` is 1, which is present, so `resolve` does not move it. `lastColRight` is 6, which is absent. `toggleColumn` selects that remembered right slot, line 96 rejects it, and the call returns null. The assertion also checks `get()` is still 1, so the stay is not inferred from a null return alone.

Also in `tests/shared.spec.js`: the case that passes suffix `'Score'` (no leading space) against `Trans1 Score` is named `suffixMissingLeadingSpace`, and a constructed `Trans 2 Score` node with suffix `' Score'` is asserted to return 2. No fixture module has that name; the assertion documents the intentional widening.

`src/trans-cursor.js` was not edited.

```
npx playwright test tests/shared.spec.js
  ok 1 [chromium] › tests\shared.spec.js:19:1 › parses Trans module numbers and rejects unrelated names and wrong suffixes (440ms)
  ok 2 [chromium] › tests\shared.spec.js:71:1 › TransCursor toggles columns, remembers slots, falls back, and nextIn advances (270ms)
  2 passed (1.8s)

npm test
  ok 1 [chromium] › tests\harness.spec.js:7:1 › boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel (666ms)
  ok 2 [chromium] › tests\shared.spec.js:19:1 › parses Trans module numbers and rejects unrelated names and wrong suffixes (601ms)
  ok 4 [chromium] › tests\shared.spec.js:71:1 › TransCursor toggles columns, remembers slots, falls back, and nextIn advances (292ms)
  ok 3 [chromium] › tests\harness.spec.js:42:1 › Utils.clickEl opens a cascader and selects 3 Points (320ms)
  4 passed (2.0s)
```
