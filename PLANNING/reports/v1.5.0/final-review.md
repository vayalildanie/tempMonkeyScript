# v1.5.0 final whole-branch review

Reviewed range: `c9c5444` (v1.4.7) .. `96a57d6`. Verdict: **ready to merge with
fixes**. The fix wave (`ef1f1f0`) was re-reviewed and approved. This is a
summary of the reviewer's findings and what was done about each; the full
reviewer text was returned in the working session, not saved as a file.

## Strengths the reviewer confirmed
- Every Remark write path (`appendToken`, `clearBox`, the edit-box input
  listener, reverse sync) goes through `writeTarget`, which re-queries the live
  textarea of the active target; switching target only reloads the edit box.
- No state is shared between the composer's cursor and Scoring Shortcuts' cursor
  (each `TransCursor` keeps its column memory in its own closure).
- QC Compare has zero diff; the composer and scoring both still bail out on
  `/quality_` URLs; the parser widening cannot remove any previous match.
- `dispatchNativeSpace` still sends exactly one keydown/keyup pair and never
  clicks the submit button.

## Required fixes (all done in `ef1f1f0`)
1. **Important — stale empty-row timer survived a mode change.** `Z` did not
   clear the pending auto-advance timer, so an un-prevented synthetic Enter
   could still go out (and show a spurious "Check passed" toast in Label mode).
   Fixed: `cycleCheckMode` now clears it; the test that pinned the old behavior
   now asserts no Enter is dispatched at all, and was mutation-checked.
2. **Important — "unverified on live NOVA" was not carried into shipped code.**
   Added to the `dispatchNativeSpace` comment and the entry-file header.
3. **Important — README banner was false at merge.** Rewritten; the rest of the
   README was brought up to date afterwards (see the v1.5.0 history entry).
4. **Important — no test for a row change while the composer is open**, nor for
   the `cursor.sync()` fallback when the active target stops being populated.
   Added. The controller then mutation-checked the row-change tests by removing
   `resolveInitialTarget()` from the row-change block: both tests failed.
5. Minor — a negative `.not.toBe(...)` assertion in `scoring.spec.js` replaced
   with the actual expected value. Entry-file header corrected where it said
   Submit Check acts "never on a timer" (the empty-row auto-advance does).

## Deferred (reviewer: can wait)
- `characterData` observation makes the row signature sensitive to live-updating
  text in the first 80 characters of the Trans1/NoteTrans block — only
  observable on the live page.
- The target highlight is a class on the outer wrapper; visibility depends on
  page CSS, and a React rewrite of that class would drop it until the next
  mutation.
- If the Remarks modules briefly vanish, the target resets to the first
  populated translation rather than the one you had chosen.
- Drag handle is not sticky when the Scoring panel scrolls (only when the
  viewport is shorter than the panel).
- Help block is 4–5 lines at default width (2–3 were asked for).
- `modulesBySuffix` rebuilds a RegExp per element per call.
- `dispatchNativeSpace` does not detect inputs inside shadow DOM.
- Re-picking the label already displayed reads as "not applied".

## Declined to judge (outside the plan/spec)
Whether the Space fix works on live NOVA (cannot be proven offline); Enter
auto-repeat double-submit and Enter's own default effect (both predate this
branch); Enter/`Z` while a Remarks textarea has focus (unchanged from v1.4.7);
the documented v1.4.1 quote defects (unescaped `"`, duplicate quotes,
multi-line quotes); `@require` pinning to `main`; screenshot aesthetics.
