# Annotation fixture

Reduced page used by Playwright to boot the userscript modules against a
NOVA-like annotation DOM. It is not the live page and it does not submit
anything to NOVA.

## Provenance

Extracted from the user-supplied capture:

`C:\Users\Admin\Documents\projects\NOVA\NOVA Annotate HTML example.txt`

That file is an outerHTML dump of one annotation workbench. It is not checked
into this repository. If the capture is missing in a later environment, treat
the structural details below as unverified against a fresh dump.

## What was kept

- Module names and the nested outer/inner `font[data-module-name]` wrappers.
- `data-module-key` values `Text`, `LabelsCascade`, and `TextLabels`.
- Translation text in `.preview-content` under `TransN`.
- Score controls: `.cascade-container`, `.nova-cascader`, `.ant-select`,
  `.ant-select-selector`, and the combobox `input[aria-expanded]`.
- Per-translation Remarks textareas inside `.text-labels` / `.whole-mode`.
- The capture's Remarks spelling. Trans2 is `Trans 2 Remarks` (with a space).
  The others are `TransN Remarks`. Scores are `TransN Score`. Translation
  text modules are `TransN`.
- v1.5.3: a `source` column with `Context-EN` (key `Text`, same shape as a
  translation) and `Note` (key `NoteTrans`). Note's shape follows
  `user 1 double blind html.txt`: `.module-title .title-text` = `Note`, then
  `.ant-spin-container` holding an `h1` heading and
  `.refactor-content .content-box #content`, followed by the page's own
  chrome that must not be quotable: the `.expand-btn` Collapse control inside
  `.refactor-content` and a sibling `.image-list-container` (picture count,
  size buttons, cover tag, page digit). Note text is not in
  `.preview-content`. A header `textarea#form_item_remark` (the page's `备注`
  bar, outside every module) is also present. Because every module's row signature reads Note first,
  tests that simulate a row change must change Note's `#content` text too.

## What was redacted or replaced

- Task text. The capture's translation copy is not in this fixture.
  Trans1–Trans2 and Trans4–Trans7 `.preview-content` are distinct lorem ipsum.
  Trans4–Trans7 stay nonempty (the capture left those four empty). Trans3's
  `.preview-content` is empty so tests can skip an empty translation. Trans2's
  score starts as a closed bare `2 Points`, with a visible clear control.
- Remote scripts, stylesheets, icons, and tracking pixels. `img` `src` values
  that were data-URIs or CDN URLs are empty.
- Session and task identifiers: generated element `id`s, `data-module-path`,
  and `data-module-config-id`. Combobox ids are fixture-local (`fx-select-N`).
- Vue scoped `data-v-*` attributes and dumped `[object Object]` props.
- The userscript highlight class `tl-active-score` that the capture picked up
  from a live session. The fixture starts with every cascader closed.
- Page chrome outside the translation modules (nav, content-type). The
  left column is Trans1–Trans3; the right column is Trans4–Trans7. Note and
  Context-EN text is lorem ipsum.

## Simulator

`annotation-sim.js` is not part of the capture. It opens a cascader on the
`mousedown` + `mouseup` + `click` sequence `Utils.clickEl` sends, so a
production click is not lost when the focused input sits outside
`.ant-select-selector`. Root items keep exact `data-path-key` values
`3 Points`, `2 Points`, and `Confusing`. Nested items use
`__RC_CASCADER_SPLIT__` paths (for example
`2 Points__RC_CASCADER_SPLIT__Grammar__RC_CASCADER_SPLIT__Grammar`); the
visible label stays separate from that key. Re-expanding `2 Points` resets a
deeper displayed value back to bare `2 Points`. `.ant-select-clear` is 16×16
so a center click can hit it. `window.__fixture.submitCount` increments only
when the platform-like handler (below) accepts a Space `keydown`, or when
`#fx-submit` is clicked. `window.__fixture.spaceEvents` records every Space
keydown and keyup (target tag, `bubbles`, `defaultPrevented`, `key`/`code`,
`accepted`) whether or not the handler accepts it, so a dispatched event that
never submits stays visible.

### Platform Space handler: ASSUMPTIONS

The capture contains only the header button
`<button class="ant-btn blue-btn"><span>提交</span><span class="btn-hot-key light">Space</span></button>`
inside `.header-commit-btns`. The real key listener is not in it, so the
following is a model of a plausible platform, not observed NOVA behavior:

1. ASSUMPTION: the listener is on `window`, bubbling phase, for `keydown`.
2. ASSUMPTION: it counts a submit only if `event.bubbles`, not
   `defaultPrevented`, `key === ' '` and `code === 'Space'`.
3. ASSUMPTION: it follows the common hotkey guard and ignores events whose
   target is an `INPUT`, `TEXTAREA`, `SELECT` or contenteditable element. This
   includes the cascader's readonly `input[type=search]`.
4. Keyup is recorded but never counts.

Whether live NOVA applies any of these is unverified.

Test-only hook: set `window.__fixture.failNextLeaf = true` and the next click on
a nested label leaf (a `data-path-key` containing `__RC_CASCADER_SPLIT__`, not a
category with an expand arrow) is ignored once: the displayed value stays as it
was and the popup stays open. The flag then resets to `false`. This simulates a
label click the platform did not accept.
