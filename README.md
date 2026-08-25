# tempMonkeyScript

A Tampermonkey userscript that adds a productivity layer on top of a
human-in-the-loop translation annotation workbench: annotators are shown a
source post and up to 7 machine translations of it ("Trans1"–"Trans7"), and
score/label each one through a chain of cascading dropdowns.

The script never changes what gets submitted — it only automates the mouse
clicks a human would otherwise make by hand, and shows its work clearly
enough that the annotator can see and override anything before submitting.

One deliberate exception, added in `v1.3.2` (moved onto a different key in
`v1.3.3`, made a 3-way cycle in `v1.3.4`): the submit blocker *prevents* an
action rather than performing one. In its default Label Check mode it only
suppresses the Enter keystroke — it never finds or clicks the submit button
— so pressing Space, or clicking Submit with the mouse, always works.
Submit Check mode is the one deliberate case where the script *does* submit
for you (by synthesizing that same Space press) rather than just blocking,
and `Z` cycles through Label Check / Submit Check / Check Off.

It's one file, single-install (open Tampermonkey, paste the script), with
`@grant none` — it never gains any Tampermonkey API access beyond the normal
browser DOM, by design.

## What it does

Three independent features, each solving a distinct pain point on the same
page:

1. **Scoring Shortcuts** — keyboard-driven scoring, so annotators don't have
   to mouse into a dropdown for every one of the ~7 translations on every
   row.
2. **Remark Composer** — a fast way to build structured, consistent
   free-text remarks by clicking translation excerpts and pre-written
   category chips instead of typing full sentences by hand.
3. **QC Compare** — for the separate quality-check pass: shows both
   annotators' scores/text side by side (the platform only shows one at a
   time) and lets a reviewer swap to the other annotator's value, or relabel
   from scratch, by keyboard or with one click.

It also holds back Enter-to-submit while a populated translation is still
missing a complete label, and keeps the Remarks field as tall as its content
so a long remark never hides inside a scrollbox.

## Install

1. Open Tampermonkey → create a new script.
2. Paste the full contents of `annotation-scoring-shortcuts.user.js`.
3. Save. The on-page panel's version badge should match the `@version` in
   the file header.

## Not yet built

**Module 4 — Single-model Reference.** On single-model batches the platform
shows only one translation per item, with no other models' phrasing to
compare against. The plan is a strictly read-only lookup panel — never
touching scoring, labels, or the submit button — driven by an offline-built
`ref.json` file. Not started; there's no code for it in this file yet.

## Shortcuts (current)

Keyboard shortcuts are scoped per page: Module 1 and Module 2 share the
score page and bail out entirely on `/quality_` URLs; Module 3 owns the
`/quality_` page and is unclaimed everywhere else. None of the three fire
while a text field has focus.

**Module 1 — Scoring Shortcuts** (score page)

| Key | Effect |
|---|---|
| `3` | Score the active translation "3 Points", then auto-advance |
| `C` | Score it "Confusing", then auto-advance |
| `2` | Score it "2 Points", stay put — leaves the label menu open |
| `1`–`9`, `0` | While a label menu is open: pick the Nth item |
| `X` | Clear the active translation's score, stay put |
| `↑` / `↓` | Move the active translation |
| `←` / `→` | Swap columns (Trans1–3 / Trans4–7) — either key toggles |
| `Z` | Cycle the submit check: Label Check → Submit Check → Check Off |
| `P` | Show/hide the shortcuts panel — works even while shortcuts are OFF |
| `Esc` | Cancel an in-progress label pick |

**Module 2 — Remark Options** (score page; internal module name is still `RemarkComposer`. Module 1 yields the keyboard to it entirely while its popover is open, by checking for `body.rmd-active`)

| Key | Effect |
|---|---|
| `O` | Open/close the Remark Options popover |
| `Q` | Quote the current selection (or, with nothing selected, focus the composer's edit box) |
| `Esc` | Close the popover, or close its Settings panel if that's open |

**Module 3 — QC Compare** (`/quality_` page)

| Key | Effect |
|---|---|
| `3` / `2` / `C` | Relabel the active translation directly to 3 Points / (open) 2 Points / Confusing |
| `1`–`9`, `0` | While a label menu is open: pick the Nth item |
| `X` | Clear the active translation's score |
| `Z` | Swap the active translation to the other annotator's value (press again to swap back) |
| `↑` / `↓` | Move the active translation |
| `←` / `→` | Swap columns (Trans1–3 / Trans4–7) |
| `P` | Show/hide the help/legend panel — same toggle as its own `▸`/`▾` triangle |
| `Esc` | Cancel an in-progress label pick |

## Storage keys

Each module persists its own state under a `trans-tool:` prefix — nothing is
shared across modules, matching the "modules stay behaviorally isolated"
rule below.

- **Module 1:** `trans-tool:nova-score-pos-v3` (panel position),
  `trans-tool:nova-score-min-v1` (minimized state),
  `trans-tool:nova-score-size-v2` (panel width),
  `trans-tool:nova-score-check-v1` (submit check mode — added `v1.3.5`).
- **Module 2:** `trans-tool:nova-remark-chips` (chip configuration; falls
  back to 30 built-in defaults if absent or invalid).
- **Module 3:** `trans-tool:nova-qc-pos-v1` (panel position only — the
  help/legend expanded state is not persisted, and resets open on every
  reload).

## Ground rules

Invariants the script is expected to keep, regardless of what else changes:

- **`@grant none` stays.** The script never gains Tampermonkey API access
  beyond the normal browser DOM — a deliberate trust boundary, and part of
  why annotators can trust it isn't doing anything hidden.
- **Stays a single `.user.js` file.** No build step, no bundler — editing
  and installing stays "open file, edit, paste into Tampermonkey."
- **DOM selectors are functional contracts, not prose to translate.**
  Several selectors match literal Chinese text the live site renders (e.g.
  `[data-module-name="笔记外文翻译"]`). These are not comments — they're how
  the script finds elements. Only comments and log tags get the English
  rewrite treatment; selector strings never do.
- **Modules stay behaviorally isolated.** The three modules don't share state.
  Two pieces of code are the sanctioned exceptions — shared utility
  functions (`Utils`: click simulation, the poll-until-condition helper, the
  native-controlled-input value setter) and the cross-module `TransCursor`
  that gives Module 1 and Module 3 identical arrow-key semantics (added
  `v1.3.2`) — but no module reads another module's internal state directly.
- **Comment convention:** English first; original Chinese kept in
  parentheses immediately after, for any comment carrying real design
  rationale (not for every line) — e.g. `// Collapse other cascaders first,
  or a stale one pops open alongside this one (先收掉其它级联,否则残留的会一起弹出).`
  Console log tags follow the same pattern:
  `[Scoring Shortcuts / 打分快捷键]`.
- **Version bump convention:** the on-page badge and `@version` header move
  together — every module's badge reads from one shared `SCRIPT_VERSION`
  constant rather than keeping its own, fixing a real drift bug from early
  in the project (the `@version` header once said `1.2.4` while Module 1's
  own badge constant still said `v1.2.1`).

## How it stays careful — mechanism notes

Non-obvious behavior that's easy to trip over if you're changing the code
around it:

- **`canonPath` (Module 3).** The platform's cascader menu items carry their
  full hierarchy path in a `data-path-key` attribute joined with a private
  delimiter, while the *displayed* value text uses `" / "` — and some label
  text itself legitimately contains a literal `/` (e.g. "Unauthentic
  Vocabulary / Collocations"), so the two can't be compared by naively
  splitting on `/`. `canonPath` normalizes both sides to the same bare-`/`
  convention before ever comparing them.
- **Adjacency-gated popup matching (Modules 1 and 3).** Before trusting a
  menu popup, the script checks it rendered within ~100px of the exact
  selector it just clicked — so a leftover popup from a different
  translation can never get clicked into by mistake.
- **Collapse-others-then-blur before reopening a dropdown.** If a previous
  cascader is still focused (even if visually closed), the platform
  re-opens it alongside the new one, which looks like a random extra
  dropdown flashing open.
- **Read back and verify, never guess forward.** Every score/label click is
  followed by reading the displayed value back and confirming it matches
  what was requested; a mismatch stops and surfaces rather than silently
  applying the wrong score.
- **Sibling-box insertion (Module 3's compare boxes).** The Remarks and
  Rewrite fields have a layout-enforced fixed height with `overflow:
  visible` — content appended *inside* them overflows past the bottom edge
  and gets covered by whatever renders next. Inserting the compare box
  immediately *after* the field in the DOM gives it its own space instead.
- **Lazy-load self-correction (Module 3).** The platform sometimes finishes
  switching QC tabs before the current row's Remarks/Rewrite text has
  actually loaded, so the first read can capture the *previous* row's
  leftover text. A short poller re-scrapes automatically for ~2.5s — but
  only while you're not actively typing in that field.
- **Stateless per-line "＋ Add" (Module 3 Remarks).** The button never reads
  what's in the Remarks box and never tracks what it's already added — it
  only ever appends. Consequences, all intended: clicking the same row
  twice appends it twice, and "undo" is the textarea's own native undo.
- **Verdict = "1" / "3" (Module 3).** Driven onto the platform's real
  `.right-btn` (Annotator 1 → "1") / `.wrong-btn` (Annotator 2 → "3") inside
  `.quality-container` — same control as the platform's own "correct/wrong"
  wording, just relabeled to the reviewer's actual convention.
- **Checked, so nobody chases it again:** the original pre-rewrite script's
  own QC module header claimed arrow keys jumped between disagreements and
  highlighted them. That was never actually implemented — its QC module
  registered no `keydown` handler at all. Nothing was dropped from the
  original; the header comment was simply stale. (Module 3 only gained real
  arrow-key navigation later, in `v1.3.2`.)

## Version history

### `v1.3.5` — Check mode persists, both modules' legends simplified

Three changes, none behavioral for scoring itself — all legend/persistence
cleanup following `v1.3.4`.

**The submit check mode now survives a reload.** Previously `checkModeIdx`
was session-only by explicit design (see `v1.3.4`'s "quietly on a
non-default mode" reasoning) — this reverses that: it's now saved to
`localStorage` under `trans-tool:nova-score-check-v1` on every `Z` cycle and
reloaded in `start()`. A brand-new session with nothing yet stored still
starts on Label Check (index 0), so the reversal only affects a session that
already chose something else — a reload mid-row no longer silently drops a
reviewer who deliberately switched to Submit Check or Check Off back into
Label Check.

**Both modules' legends were compacted.** Module 1's separate `3 3 Points` /
`2 2 Points → label (1–9 pick)` lines became one `1–9 Label/Score Selection`
line (display only — the keys themselves are unchanged), and `P`'s label
changed from "Show/hide window" to "Show/hide Legend". Module 3's help text
was a full prose paragraph explaining Swap/Undo/Add by hand; it's now the
same compact `<span>` row-list style Module 1 uses, matching the visual
language across both modules.

**Module 3 (QC Compare) remapped Swap and gained `P`.** Swap moved from `S`
to `Z` (freeing `S`, unused since), pushing erase/clear from `Z` to `X` —
the same `Z`→check-cycle / `X`→erase pattern `v1.3.4` established in Module
1, so the two modules' key layouts now read the same way even though they do
different things. `P` toggles the help/legend panel by flipping the same
`helpOpen` flag and calling the same `applyHelp()` the panel's own `▸`/`▾`
triangle already used — no new toggle logic, just a second way to trigger
the existing one.

### `v1.3.4` — Submit Check ternary, shortcut remap, legend cleanup

The submit blocker becomes a 3-way cycle instead of a plain on/off, plus the
key remapping that made room for it.

**`Z` (was `B`) now cycles three modes instead of toggling one.** *Label
Check* is the old default: block Enter on an incomplete label, let a clean
Enter through untouched. *Submit Check* adds real teeth — on a clean check
it also synthesizes the platform's native Space keypress
(`dispatchNativeSpace`, a real `keydown`+`keyup` pair targeted at
`document.activeElement`), so a clean Enter both checks and submits in one
press. *Check Off* is unchanged: no check at all. This is a second
deliberate exception to "the script only clicks for you, never for itself"
(the first was the blocker itself, in `v1.3.2`) — Submit Check mode does
drive a real submission, but only after the identical completeness check the
other two modes share, and only as the direct result of the user's own
Enter press, never on a timer or silently. A clean pass in any mode now also
shows a green confirmation toast (`.tl-toast-ok`) instead of staying silent,
so a passed check is as visible as a blocked one.

**Keys remapped to make room.** Erase moved `Z`→`X`; `Confusing` stays `C`.
The Remark Composer's open/close shortcut moved `R`→`O` and its user-facing
name changed to "Remark Options" (the internal module name and identifiers
are unchanged — renamed in the UI only, same pattern `v1.3.2` used for
Adopt→Swap).

**Legend reorganized:** the check-cycle line moved to the top, and the two
arrow-key lines (move translation / swap column) merged into one "Move
Translation Focus" line.

**Known gap carried forward:** the `AGENTS.md` reconciliation flagged as
"next up" in `v1.3.3` still hasn't happened — the file isn't present
anywhere in this repo (tracked or untracked), so the script header's pointer
to it is currently a dead reference rather than just stale content. Worth
resolving before it causes real confusion for a new reader.

### `v1.3.3` — Submit check moved to Enter, full-translation quoting fixed

Two changes, both refinements of v1.3.2 features rather than new surface.

**The submit blocker now holds back Enter instead of Space.** Space goes back
to being the platform's untouched native submit key, exactly like before
`v1.3.2`. Same completeness check, same toast, same `B` toggle — only the key
it's watching changed. (Announced badge text, toast copy, and the panel
tooltip were all updated to match.)

**Quoting an entire translation (`Q`) now works.** The check that a selection
stays inside one translation used to walk `anchorNode`/`focusNode` up to the
nearest `.preview-content` via `.closest()` — which only ever walks *upward*.
Selecting a whole translation (dragging past the last character, or releasing
in the blank space below the last line) is a real `Selection`/`Range` quirk:
the browser resolves that boundary to `.preview-content`'s *parent*, not a
node inside it, so `.closest()` could never recognize it and the quote was
rejected as "outside the translation" — even though only one translation was
ever touched. Fixed by checking which `TransN` *container* the selection's
`Range` intersects (`Range.intersectsNode`) instead of which `.preview-content`
its endpoints happen to resolve to. A selection that actually spans two
translations is still rejected, since a real cross-translation drag
intersects two distinct containers. Verified against the exact escaped-
boundary case in a real browser (not just reasoned about) — see the commit
for the repro.

**Next up:** the file header points readers at `AGENTS.md` "in this repo" for
the full feature reference, but it isn't actually tracked in git and its
content has drifted — it still describes Module 3 as having no keyboard
shortcuts of its own, which stopped being true in `v1.3.2`. Reconciling
`AGENTS.md` with the shipped code (and deciding whether it belongs in the
repo at all) is the plan for `v1.3.4`, before that release adds anything new
on top.

### `v1.3.2` — Submit blocker, QC keyboard, Swap, full-height Remarks

Four changes, plus one refactor that made two of them cheap.

**Space no longer submits an under-labelled row.** Score and label are one
cascader whose value is a path, so it's easy to stop on a non-leaf — bare
`2 Points` — and submit without noticing. Space is now held back while any
populated translation is incomplete, with a toast naming which ones. `B`
toggles the check (session-only, so a refresh restores it).

Two catches, both exact string comparisons: nothing selected, or exactly
`2 Points`. Depth deliberately isn't counted — the display joins levels with
`" / "` *and* some labels contain `" / "` themselves, so a complete
`2 Points / Authenticity / Unauthentic Vocabulary / Collocations` has *more*
separators than an incomplete `2 Points / Authenticity`. The check is derived
from the live DOM rather than tracked as a flag, so a label set with the mouse
counts exactly like one set with `0`–`9`. The script only suppresses the
keystroke — it never looks for or clicks the submit button — so clicking
Submit with the mouse is an override for free.

**QC Compare has a keyboard.** It was mouse-only by design; now `↑`/`↓` select
a translation and `←`/`→` toggle column (Trans1–3 / Trans4–7), matching Module
1 exactly, plus `3`/`C`/`Z`/`2` to relabel and `0`–`9` to pick a 2-Points
label. Nothing had to be arbitrated: Modules 1 and 2 both bail out on
`/quality_` pages, so the keyboard there was entirely unclaimed. Label mode is
derived from whether a menu is actually open rather than tracked in a flag —
without that, `2` then `3` could never reach label item #3.

**Adopt is now Swap, bound to `S`.** `adopted`/`undoAdopt` were already a
clean toggle, so one key does both directions. Renamed in the UI only; the
function names, data attributes and CSS classes keep `adopt`/`undo`, since
renaming those would churn the click delegation for nothing.

**The Remarks field grows to fit its content** on both pages, instead of
scrolling inside a small box. Growth is unbounded on purpose — a cap would
reintroduce internal scrolling for exactly the long remarks this fixes. This
needed NOVA's own fixed module height relaxed, and it retires `v1.3.1`'s
scroll-the-field-to-the-new-line step, which is meaningless once nothing
scrolls.

**Refactor:** the active-translation cursor is now one shared `TransCursor`
instead of a copy in each module — this is what let Module 3's arrows match
Module 1's semantics for free. It deals only in Trans numbers, never indices,
which is forced rather than cosmetic: Module 3 re-queries its score modules on
demand and the platform's re-renders replace those nodes, so an index into any
snapshot goes stale by construction. It's the second piece of cross-module
code after `Utils`.

Migrating Module 1 onto it fixed a latent bug in `commitLabelAndAdvance`,
which read a value back by index into one array but advanced by index into a
freshly re-read one — a list shift mid-label-pick could have landed the
advance on the wrong translation. Carrying the Trans number instead makes that
mismatch impossible to express.

### `v1.3.1` — Module 3: Remarks + Add now focuses the field it just wrote to

The + Add button's write never depended on focus, but the click itself never
moved focus into the Remarks field — so the step felt unreliable unless
you'd already clicked into the field by hand: the write landed, but there
was no visible caret, and if the box was scrolled, the newly appended line
could be out of view.

Fix: one animation frame after the write, focus the field, place the caret
at the end, and scroll the field's own content so the new line is visible.
Reuses the same deferred-focus pattern already used elsewhere in the script
for the identical problem (synchronous focus right after a click loses a
fight with the browser pulling focus back toward the button just clicked).

### `v1.3.0` — Module 3 (QC Compare) added, rebuilt fresh

Module 3 handles the separate quality-check pass: reads both annotators'
scores/Remarks/Rewrite, overlays the differences on Annotator 1's view, and
lets a reviewer adopt or undo the other annotator's value with one click.

Faithful port of the diff/adopt/undo engine for scores and Rewrite,
re-verified line-by-line against source — the two-tab scrape, the
cascade-matching fix for multi-level scores, the lazy-load self-correction,
the sibling-box DOM insertion, and the 3-Points-with-remark validation all
match with no behavior change. The verdict-button click is a plain
fire-and-forget, idempotent click — deliberately no reload-on-failure
fallback (an earlier experiment added one; its retry guard wasn't
loop-proof and could leave the page reloading indefinitely, so it was left
out).

Two deliberate departures from the earlier baseline:
- Verdict buttons are driven to "1" / "3" instead of "correct" / "wrong" —
  same underlying control, different target values.
- Remarks uses a stateless per-line "+ Add" button instead of a whole-field
  Adopt/Undo: each line of Annotator 2's Remarks gets its own button that
  appends just that line to Annotator 1's Remarks, never reading or
  overwriting what's already there. Rewrite keeps the whole-field pattern.

New: the panel's summary line names what's still outstanding (which Trans
numbers disagree, plus Rewrite if it does) instead of just a diff count.

### `v1.2.4` — Module 2: bidirectional Remarks sync, `Q` fallback focus

- Typing directly into the platform's real Remarks field now syncs back
  into the composer box live (new delegated input listener; value-equality
  guard prevents feedback loop with the existing composer→platform
  mirroring).
- `Q` with nothing selected now focuses the composer's edit box instead of
  just showing a hint — makes select → `Q` (quote) → `Q` (focus box) → type
  reliable.

### `v1.2.3` — Module 2 bugfix: layout was sideways; marked finalized

- **Bugfix:** `1.2.2`'s flexbox layout never got `flex-direction: column`,
  so content laid out horizontally instead of stacked. One-line fix.
- Module 2 (Remark Composer) marked finalized as of this version.

### `v1.2.2` — Module 2: resizable popover, red reset button

- Corner-grab resize, both axes, can grow or shrink (unlike Module 1's
  shrink-only resize).
- Resize is session-ephemeral, never persisted — resets to the default size
  every time it's opened.
- Layout switched to flexbox so the chip grid scrolls instead of clipping
  when resized.
- Settings modal reset button is now a small red icon; also resets popover
  size immediately (chip reset still requires Save).

### `v1.2.1` — Module 2 restored + popover-visibility bugfix

- Merged `1.0.2`'s Module 1 changes into the `1.2.0` build (temporarily
  reverted for the `1.0.2` redo).
- **Bugfix:** popover never appeared — `style.display = ''` fell back to the
  stylesheet's `display:none`. Fixed with an explicit `'block'`.

### `v1.2.0` — Module 2 (Remark Composer) added

- Chip palette, smart separators, live highlight overlay, full settings
  editor — faithfully ported.
- Quoting redesigned: title-click still inserts a `Trans N` reference;
  excerpt quoting is now select-then-`Q` (plain browser selection, no
  drag-takeover/word-snapping) instead of automatic-on-mouseup.
- `Q` only means "quote" while the composer is active — no conflict with
  Module 1's shortcuts.

*(There's no `1.1.x` — the project skipped from `1.0.2` straight to `1.2.0`
when Module 2 was added.)*

### `v1.0.2` — Module 1

- `Q`/`E` removed as navigation keys — arrows only.
- Columns redefined: Trans1–3 (left) / Trans4–7 (right).
- Left/Right always toggle column regardless of key; remembers your last
  position in each column (persists across rows) instead of a fixed mirror
  slot.
- Resize is width-only now; height always auto-fits content.

### `v1.0.1` — Module 1

- `Z`: erase the active translation's score, stays put (doesn't advance).
- `P`: show/hide the panel; works even while shortcuts are OFF.
- Shrink-only resize (floor 260×90px), persisted across reloads.
- Left/Right: jump to the mirrored translation, fixed offset (Trans7
  unreachable).

### `v1.0.0` — Clean rewrite baseline

Phase 0 (shared utilities) and Phase 1 (Module 1: Scoring Shortcuts) plus
Module 2 (Remark Composer) complete. A clean, no-behavior-change rewrite of
the original userscript into a single-file, well-commented baseline.
