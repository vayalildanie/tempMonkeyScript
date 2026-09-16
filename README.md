# tempMonkeyScript

A Tampermonkey userscript that adds a productivity layer on top of a
human-in-the-loop translation annotation workbench: annotators are shown a
source post and up to 7 machine translations of it ("Trans1"–"Trans7"), and
score/label each one through a chain of cascading dropdowns.

The script never changes what gets submitted — it only automates the mouse
clicks a human would otherwise make by hand, and shows its work clearly
enough that the annotator can see and override anything before submitting.

One deliberate exception, added in `v1.3.2` (moved onto a different key in
`v1.3.3`, made a 3-way cycle in `v1.3.4`, moved from Scoring Shortcuts into
Remark Composer in `v1.4.0`): the submit blocker *prevents* an action rather
than performing one. In its default Label Check mode it only suppresses the
Enter keystroke — it never finds or clicks the submit button — so pressing
Space, or clicking Submit with the mouse, always works. Submit Check mode is
the one deliberate case where the script *does* submit for you (by
synthesizing that same Space press) rather than just blocking, and `Z`
cycles through Label Check / Submit Check / Check Off.

As of `v1.4.0` this is a multi-file install: one small entry-point
`.user.js` file that `@require`s the module files under `src/` straight from
this GitHub repo. There's still no build step or bundler — it's plain files
loaded in sequence — and `@grant none` stays: the script never gains any
Tampermonkey API access beyond the normal browser DOM, by design. See
"Install" and "Code layout" below.

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
missing a complete label.

## Install

1. Open Tampermonkey → create a new script.
2. Paste the full contents of `annotation-scoring-shortcuts.user.js`.
3. Save. Tampermonkey fetches the `@require`d files under `src/` from this
   repo's `main` branch automatically — nothing else to paste.
4. The on-page panel's version badge should match the `@version` in the file
   header.

Requires this repo to stay **public** — `@require` fetches over plain HTTPS
with no authentication, so a private repo would break every installed copy.

## Code layout

```
annotation-scoring-shortcuts.user.js   entry point: @require list + boot sequence only
src/utils.js                           shared DOM helpers + the toast/keycap UI
src/trans-cursor.js                    shared active-translation cursor (Scoring Shortcuts + QC Compare)
src/scoring-shortcuts.js               Module 1
src/remark-composer.js                 Module 2 (also owns the submit-check system, see below)
src/qc-compare.js                      Module 3
```

`@require` has no code-splitting — every file above downloads and executes
on every matching page load, regardless of URL. Which module is actually
*active* on a given page is still decided at runtime, the same way it always
was: each module's own `start()` checks `location.href` and bails out if it
doesn't apply. Editing a module means editing its `src/*.js` file and
pushing to `main` — Tampermonkey picks up the change the next time it
re-checks the `@require`d URL (see its own update-check settings; this repo
pins `@require` to the `main` branch rather than a specific commit, so there
is no per-release URL to bump, at the cost of that fetch being on
Tampermonkey's own schedule rather than instant).

## Not yet built

**Module 4 — Single-model Reference** (internally referred to in planning as
"Histo_DB"). On single-model batches the platform shows only one translation
per item, with no other models' phrasing to compare against. The plan is a
strictly read-only lookup panel — never touching scoring, labels, or the
submit button — driven by an offline-built `ref.json` file. Not started;
there's no code for it anywhere in this repo yet. Deferred to `v1.5`, after
the `v1.4.0` module-split refactor.

## Shortcuts (current)

Keyboard shortcuts are scoped per page: Module 1 and Module 2 share the
score page and bail out entirely on `/quality_` URLs; Module 3 owns the
`/quality_` page and is unclaimed everywhere else. None of the three fire
while a text field has focus.

As of `v1.4.0`, Module 1 owns only the scoring keyboard; the submit-check
system (`Z` / `Enter`) that used to live in Module 1 moved into Module 2
wholesale, and `Alt` (a second, additive check trigger) was dropped
entirely rather than carried along. See `src/scoring-shortcuts.js` and
`src/remark-composer.js`'s header comments for the full reasoning.

**Module 1 — Scoring Shortcuts** (score page; `src/scoring-shortcuts.js`)

| Key | Effect |
|---|---|
| `3` | Score the active translation "3 Points", then auto-advance |
| `C` | Score it "Confusing", then auto-advance |
| `2` | Score it "2 Points", stay put — leaves the label menu open |
| `1`–`9`, `0` | While a label menu is open: pick the Nth item |
| `X` | Clear the active translation's score, stay put |
| `↑` / `↓` | Move the active translation |
| `←` / `→` | Swap columns (Trans1–3 / Trans4–7) — either key toggles |
| `P` | Show/hide the shortcuts panel — works even while shortcuts are OFF |
| `Esc` | Cancel an in-progress label pick |

**Module 2 — Remark Options** (score page; `src/remark-composer.js`,
internal module name is still `RemarkComposer`. Module 1 yields the keyboard
to it entirely while its popover is open, by checking for `body.rmd-active`
— but `Z`/`Enter` below work regardless of whether the popover is open,
since the submit check is a page-level guard, not a composer-UI feature)

| Key | Effect |
|---|---|
| `O` | Open/close the Remark Options window |
| `Z` | Cycle the submit check: Label Check → Submit Check → Check Off |
| `Enter` | Run the check now, safely — blocks on an incomplete label per the current check mode; in Submit Check mode, a clean pass also submits (synthesizes Space) |
| `Q` | Quote the current selection (or, with nothing selected, focus the composer's edit box) |
| `Esc` | Close the window, or close its Settings panel if that's open |

The window's position and size now persist across reloads, the same way
Module 1's panel always has (see "Storage keys" below) — previously this
window reset to a fixed size every time it was reopened.

**Module 3 — QC Compare** (`/quality_` page; `src/qc-compare.js`)

| Key | Effect |
|---|---|
| `3` / `2` / `C` | Relabel the active translation directly to 3 Points / (open) 2 Points / Confusing |
| `1`–`9`, `0` | While a label menu is open: pick the Nth item |
| `X` | Clear the active translation's score |
| `Z` | Swap the active translation to the other annotator's value (press again to swap back); on a selected Remark +Add line, append that line; on Rewrite, swap/undo it the same as its "Swap →"/"Undo" button |
| `↑` / `↓` | Move the active translation — past the last one, continues into the Remarks +Add lines, then Rewrite |
| `←` / `→` | Swap columns (Trans1–3 / Trans4–7) |
| `O` | Show/hide the help/legend panel — same toggle as its own `▸`/`▾` triangle (moved from `P` in `v1.4.0`, to match Module 2's open/close key — the two modules are URL-exclusive so there's no clash) |
| `Esc` | Cancel an in-progress label pick |

Module 3 also auto-selects each annotator's verdict as soon as it scrapes a
row — Annotator 1 → "1", Annotator 2 → "3" — via `ensureVerdict()`; this is
pre-existing behavior, unchanged by the `v1.4.0` split.

## Storage keys

Each module persists its own state under a `trans-tool:` prefix — nothing is
shared across modules, matching the "modules stay behaviorally isolated"
rule below.

- **Module 1:** `trans-tool:nova-score-pos-v3` (panel position),
  `trans-tool:nova-score-min-v1` (minimized state),
  `trans-tool:nova-score-size-v2` (panel width).
- **Module 2:** `trans-tool:nova-remark-chips` (chip configuration; falls
  back to 30 built-in defaults if absent or invalid),
  `trans-tool:nova-score-check-v1` (submit check mode — added `v1.3.5`,
  kept under its original `nova-score-*` name in `v1.4.0` even though the
  check system moved to this module, since it's a stored user preference
  and renaming it would silently reset existing installs' saved mode),
  `trans-tool:nova-remark-pos-v1` / `trans-tool:nova-remark-size-v1` (the
  Remark Options window's position/size — new in `v1.4.0`; previously this
  window reset to a fixed size on every open and never persisted position).
- **Module 3:** `trans-tool:nova-qc-pos-v1` (panel position only — the
  help/legend expanded state is not persisted, and resets open on every
  reload).

Versioning convention: the `-vN` suffix only bumps when a key's *stored
shape* changes incompatibly with what's already saved (e.g. `nova-score-
size-v1` → `v2` when the size shape changed) — never just because the code
that reads/writes it moved files or got refactored. A refactor that keeps
the same shape keeps the same key, so existing installs' saved
positions/sizes/preferences survive it untouched (see `v1.4.3`'s Utils
extraction below, which touched every one of these keys' code path without
renaming any of them).

## Ground rules

Invariants the script is expected to keep, regardless of what else changes:

- **`@grant none` stays.** The script never gains Tampermonkey API access
  beyond the normal browser DOM — a deliberate trust boundary, and part of
  why annotators can trust it isn't doing anything hidden.
- **Multi-file, loaded via `@require` — no build step, no bundler.** Until
  `v1.4.0` this was a single pasteable `.user.js` file; it's now one small
  entry point plus the module files under `src/`, each fetched straight from
  this GitHub repo (see "Code layout" above). Still plain files with no
  build step or bundler — editing a module means editing its `src/*.js`
  file and pushing to `main`, not running a build.
- **DOM selectors are functional contracts, not prose to translate.**
  Several selectors match literal Chinese text the live site renders (e.g.
  `[data-module-name="笔记外文翻译"]`). These are not comments — they're how
  the script finds elements. Only comments and log tags get the English
  rewrite treatment; selector strings never do.
- **Modules stay behaviorally isolated.** The three modules don't share
  mutable state. Three things are the sanctioned exceptions:
  - shared utility functions (`Utils`: click simulation, the
    poll-until-condition helper, the native-controlled-input value setter,
    the shared toast/keycap UI);
  - the cross-module `TransCursor` that gives Module 1 and Module 3
    identical arrow-key semantics (added `v1.3.2`);
  - Module 1's `checkCompleteness()` (added `v1.4.0`) — a one-way, read-only
    query Module 2 calls to ask about label completeness, so its relocated
    submit-check system doesn't have to duplicate or reach into Module 1's
    own DOM-reading logic. Module 1 has no reciprocal dependency on Module 2
    and no state crosses the boundary, which is what keeps this narrower
    than genuinely shared state.

  Beyond those three, no module reads another module's internal state
  directly.
- **Comment convention:** English first; original Chinese kept in
  parentheses immediately after, for any comment carrying real design
  rationale (not for every line) — e.g. `// Collapse other cascaders first,
  or a stale one pops open alongside this one (先收掉其它级联,否则残留的会一起弹出).`
  Console log tags follow the same pattern:
  `[Scoring Shortcuts / 打分快捷键]`.
- **Version bump convention:** the on-page badge and `@version` header move
  together — every module's badge reads from one shared version value rather
  than keeping its own, fixing a real drift bug from early in the project
  (the `@version` header once said `1.2.4` while Module 1's own badge
  constant still said `v1.2.1`). As of `v1.4.0` that value is
  `TL.SCRIPT_VERSION`, set once in the entry point before any module is
  instantiated (previously a single `SCRIPT_VERSION` constant, closed over
  by all three modules when they were nested in one file — same guarantee,
  different mechanism now that they're separate files).

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

### `v1.4.4` — Strip MT segment tags from copied translation text

The platform's per-translation copy icons were putting raw machine-
translation segment tags (`<content1>`, `</content1>`, and similar) onto the
clipboard along with the actual text — always wrapping the very start and/or
end of the string, never appearing mid-text. Those icons are unlabeled
`<img>`s with a framework-generated scoped-CSS attribute and no stable
selector, so rather than hooking each one, `Utils.installClipboardSanitizer`
patches `navigator.clipboard.writeText` itself, once, at boot — every copy
made through it (on the score page and the quality page both) is run through
new `Utils.stripAnnotationTags` first, which peels off any number of
tag-shaped wrappers from both ends and leaves everything else, including a
literal `<` a translator typed as content, untouched. It's a no-op for text
that was never wrapped, so this is safe to apply page-wide rather than
gating it to a specific button.

`Utils.stripAnnotationTags` is exported standalone, not folded into the
clipboard patch, so the same tag-stripping rule can be reused by the planned
quote feature later without copy-pasting the regex.

### `v1.4.3` — Dedupe shared DOM/UI mechanics into Utils

A tech-debt pass, not a feature release: no shortcut, panel layout, or
behavior is meant to change for an annotator using the script, with one
explicit exception called out below.

**Panel drag-to-move and resize** — hand-rolled independently in Scoring
Shortcuts' panel, Remark Composer's popover, and QC Compare's panel, with
real drift between the three copies (only two of them clamped the dragged
panel into the viewport) — are now `Utils.makeDraggable`/
`Utils.makeResizable`. Each caller still owns its own storage key and decides
what to persist via its own `onDrop` callback, so this is shared *mechanism*,
not shared *state* — see the "Modules stay behaviorally isolated" ground
rule. **Explicit behavior fix:** Remark Composer's popover now also clamps
into the viewport while dragging, matching the other two panels — previously
it was the only one of the three that could be dragged fully off-screen.

**The cascader-popup helpers** (`popupsVisible`/`edgeGap`/
`closeOpenCascaders`) — byte-for-byte identical between Scoring Shortcuts and
QC Compare, both driving the same Ant Design cascader controls — moved to
`Utils` too. Each module's own adjacency threshold (`ADJACENT_GAP_PX`, 100 in
Scoring Shortcuts vs. 120 in QC Compare) and "which item on the path" logic
stayed local, since those differ by design.

**`data-module-name` → Trans-number parsing and reading a cascader's
selected-label text** — written independently three times (`/^Trans(\d+)
Score$/`, `/^Trans(\d+)$/`, and the `.ant-select-selection-item` text read) —
are now `Utils.transNumFromModuleName(mod, suffix)` and `Utils.readSelected(mod)`.

**JSON localStorage read/write** (`Utils.readJSON`/`Utils.writeJSON`) absorbs
the repeated try/catch + `JSON.parse`/`stringify` boilerplate every panel's
position/size persistence had; which key to use and what shape to store is
still each module's own decision.

No storage keys were renamed (see "Storage keys" above) and no new ones were
added.

### `v1.4.0` — Module split into `@require`d files; submit check moved to Remark Composer; Remarks auto-grow removed

This is the tech-debt refactor: the script was one 3,851-line file with
three modules nested in a single closure, which had become hard to read and
was actively coupling behavior across modules that shouldn't have been
coupled. Nothing in this release changes the platform-facing scoring
behavior of Modules 1/3 beyond what's listed below — it's a structural
split plus the specific reassignments requested alongside it.

**The file split into `src/utils.js`, `src/trans-cursor.js`,
`src/scoring-shortcuts.js`, `src/remark-composer.js`, and
`src/qc-compare.js`**, each loaded via `@require` from this repo; the
`.user.js` file is now just the `@require` list and the boot sequence. Each
file wraps its body in its own IIFE and publishes through a single `window.TL`
namespace object, since `@require`d files share one global scope with no
code-splitting — every file downloads and executes on every page load
regardless of URL, same as before; only which module's `start()` decides to
act on a given URL was ever conditional, and that's unchanged. See "Code
layout" above.

**The submit-check system moved from Scoring Shortcuts to Remark Composer,
wholesale.** `Z` (cycle Label Check / Submit Check / Check Off) and `Enter`
(run the check) now live in `src/remark-composer.js`, including the
empty-row auto-advance timer and the check-mode badge (now shown in the
Remark Options window's header instead of the scoring panel's). Remark
Composer reads label-completeness through one new read-only method Scoring
Shortcuts exposes, `checkCompleteness()`, rather than duplicating or
reaching into Scoring Shortcuts' own DOM-reading internals — see "Ground
rules" above for why this is a narrower exception than genuinely shared
state. The persisted check-mode `localStorage` key
(`trans-tool:nova-score-check-v1`) was deliberately **not** renamed, since
it's a stored user preference and renaming it would silently reset every
existing install's saved mode.

**`Alt` was dropped entirely** as a check trigger — it was not carried into
Remark Composer. `Enter` is now the only way to run the check.

**Scoring Shortcuts' final keyboard surface:** `C` / `X` / `1`–`9` / arrows /
`P` only. `Z`, `Enter`, and `Alt` are gone from this module (see above).

**The Remark Options window is now a persisted, adjustable window** like
Scoring Shortcuts' own panel, instead of resetting to a fixed size on every
open: position and size survive a reload (`trans-tool:nova-remark-pos-v1`,
`trans-tool:nova-remark-size-v1`), and its corner-drag resize now sets both
width and height (previously width-only reasoning didn't apply here — its
content isn't reflowing text with an auto-fit height the way Scoring
Shortcuts' panel is).

**QC Compare's help/legend toggle moved from `P` to `O`**, matching Remark
Composer's open/close key so both "adjustable window" modules share the same
open/close mnemonic. Safe because the two modules are URL-exclusive — QC
Compare only runs on `/quality_` pages, Remark Composer never does — so
there's no runtime key clash either way this was decided. QC Compare's
pre-existing auto-verdict-select rule (Annotator 1 → "1", Annotator 2 → "3",
via `ensureVerdict()`) is unchanged; it already existed and already only ran
on the same pages, so nothing needed to move.

**The "keep the Remarks field as tall as its content" feature (v1.3.2) was
removed outright**, along with `Utils.autoGrowTextarea` and the
`GROWN_EVENT` plumbing QC Compare's highlight overlay used to listen for
(that overlay still re-syncs correctly from its other triggers — typing,
scrolling, tab switches, row changes — so nothing else depended on the
removed event). The Remarks field is back to the platform's native small,
internally-scrolling textarea on both pages.

**Deferred:** Module 4 (Single-model Reference, "Histo_DB" in planning —
see "Not yet built" above) was going to be the next feature added on top of
the pre-split codebase; it's now deferred to `v1.5`, after this refactor.

### `v1.3.5` — Check mode persists, legends simplified, Alt check trigger, Remark/Rewrite keyboard selection

Five changes: persistence and legend cleanup following `v1.3.4`, plus two
new behaviors — `Alt` as a second check trigger in Module 1, and arrow-key
selection extended into Remarks +Add / Rewrite in Module 3.

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

**Module 1 gained `Alt` as a second, additive check trigger.** Previously
the completeness check only ran on Enter; `Alt` alone now runs the exact
same check (`performCheck`, factored out of the old inline Enter handler) at
any time, in both Label Check and Submit Check mode, without needing to
press Enter. It's purely additive — Enter's own behavior, including Submit
Check's synthetic Space on a clean pass, is unchanged, and `Alt` never
submits by itself (it can only trigger the same synthetic Space that a clean
Enter would). Real `Alt+X` combos are unaffected — only a bare `Alt` press
is special-cased, ahead of the modifier-combo guard that still bails on
everything else.

**Module 3 (QC Compare)'s arrow-key selection now continues past the last
Translation into Remarks +Add and Rewrite.** `↓` from the last selectable
Translation moves into Annotator 2's Remarks lines that have a "+ Add"
button (skipping blank lines), then into Rewrite if it's renderable, then
stops — no wraparound, mirroring how `TransCursor.step` already clamps at
either end of the Translation list; `↑` walks back the same way. Both are
scoped to Annotator 1's tab (the tab the +Add buttons and Rewrite's "Swap →"
control actually render on) and reset on every row change. `Z` now does the
context-appropriate thing for whichever is selected: on a Remark line, the
same one-shot append `+ Add` already did; on Rewrite, the same adopt/undo
toggle its "Swap →"/"Undo" buttons already did. Neither is new business
logic — both keyboard paths call the exact same functions the existing mouse
clicks did (`appendRemarkLine`, `adoptFieldText`/`undoFieldText`).
`←`/`→` (column toggle) stay a Translation-only concept and no-op while a
Remark line or Rewrite is selected.

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
