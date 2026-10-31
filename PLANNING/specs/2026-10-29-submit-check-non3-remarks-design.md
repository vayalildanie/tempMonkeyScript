# Proposed v1.5.3 — Submit Check remark gate, Escape unfocus, and Note quotes

Status: proposed only. Not approved for implementation, and not part of `v1.5.2`. Both requests below are intended to ship together as a likely `v1.5.3`.

## Why

Submit Check currently asks only whether every populated translation has a complete label. A populated translation scored `2 Points / …` or `Confusing` can therefore pass and be submitted with an empty Remarks field. The annotator wants that case held back: a score that is not a 3 needs a remark before the script triggers submission.

## Current behavior

`scoringShortcuts.checkCompleteness()` returns populated translations and those whose label is incomplete. A label is incomplete only when its displayed value is empty or exactly bare `2 Points`. `RemarkComposer.performCheck()` blocks Enter in Label Check and Submit Check when `incomplete` is non-empty. On a clean pass, Label Check lets Enter through; Submit Check replaces it with one synthetic Space. Check Off does neither. Empty-row auto-advance dispatches that same Enter path.

The check does not read any Remarks textarea.

## Proposed rule

Keep the existing label rule. Add a remark rule:

- Consider only populated translations, using the same population test the label check already uses.
- A displayed score beginning with `3 Points` does not require a remark.
- Every other complete, populated score requires that translation's own Remarks textarea to contain something other than whitespace. This includes bare and labeled `2 Points`, `Confusing`, and any future non-3 value.
- "Something included" means the live textarea value after trimming, not text that exists only in the Remark Options proxy. The lookup must use the existing Trans-number parser, so `Trans 2 Remarks` counts.
- If either the label rule or the remark rule fails, do not trigger submission. In Submit Check that means do not dispatch Space. The page's own Submit button and a manual Space remain available as overrides, as they do for missing labels today.

## Check modes

- **Submit Check:** both rules gate the synthetic submission.
- **Label Check:** apply both rules too. Otherwise its untouched Enter could still submit through the page while a required remark is missing.
- **Check Off:** unchanged; neither rule runs.
- **Empty-row auto-advance:** unchanged path. A row with nothing scoreable still has nothing requiring a remark, so this does not add a new auto-submit case.

The blocked message should name the translation and distinguish a missing label from a missing remark, so the annotator knows which field to fix.

## Non-goals

- Do not require remarks on empty translations or on scores beginning with `3 Points`.
- Do not judge whether the remark is adequate, only that it is non-empty after trimming.
- Do not change scoring, arrow navigation, click-to-select, quote routing, or QC Compare.
- Do not make the script click Submit or send more than the existing single Space on a clean pass.
- Do not treat this document as authorization to implement. Behavior, copy, and version stay at `v1.5.2` until this proposal is approved and released, likely as `v1.5.3`.

## Escape unfocuses a selected remark textbox

Today Escape is handled before the text-entry guard. While Remark Options is open, Escape closes the window even if a remark textbox has focus. The annotator wants a selected remark textbox to be unselected instead: pressing Escape blurs that box and leaves its text and the current target unchanged.

- Applies to the Remark Options edit box (`#rmd-edit`) and to a NOVA per-translation Remarks textarea.
- The first Escape only removes focus. It does not close Remark Options, clear the field, or move the target.
- A following Escape, once no remark textbox is focused, keeps the current close behavior (settings first, otherwise the window). This is the proposed way to keep Esc as Back after the new first press.
- Escape does not blur unrelated page fields, score controls, or the settings form.

## Quote the left Note field

> **Superseded (2026-10-30):** quotes no longer carry any source reference. Every `Q` quote, from a translation or from Note, is written as `"selected text"` only, and a selection must lie entirely inside one source element (Ctrl-A and cross-element selections are refused). See requirement A-QUOTE and Task 4 in `PLANNING/plans/2026-10-30-v1.5.3-submit-check-remark-gate.md`. The `Note "…"` format below is kept as history.

`Q` currently accepts a selection only when it sits inside exactly one `Trans N` module. The left-hand source field, titled **Note**, is therefore refused. The annotator wants to quote from that field the same way as from a translation.

- Identify the Note module by its visible title `Note`, and by `data-module-key="NoteTrans"` when that attribute is present. Confirm the live module name before implementation; the reduced fixture does not currently include this field.
- A selection entirely inside Note quotes as `Note "selected text"` into the remark target `Q` already uses. It does not change the selected remark.
- The same tag-stripping and trimming rules apply. A selection that spans Note and a translation, or more than one translation, is still refused.
- Quoting Note does not make Note a remark target, a score target, or something that needs its own remark.

## Verification when implemented

Tests should prove: a non-3 score with an empty or whitespace-only remark blocks Submit Check and dispatches no Space; the same score with any non-whitespace remark can pass; a `3 Points` score passes with an empty remark; a missing label still blocks even if a remark is present; Label Check also blocks a missing required remark; Check Off does not; and `Trans 2 Remarks` is read correctly. They should also prove that Escape blurs either remark textbox without closing the window or changing its text, and that a second Escape still closes. Note coverage should prove that a selection inside Note appends `Note "…"`, that a selection crossing Note and a translation writes nothing, and that the remark target is unchanged. Live NOVA verification would still be required for the real Space listener and for the Note module's actual attributes.
