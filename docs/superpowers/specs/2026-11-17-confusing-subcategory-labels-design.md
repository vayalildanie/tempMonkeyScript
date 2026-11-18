# Confusing sub-category labels — design

## Intent / why

The platform's `Confusing` score option has grown sub-categories (screenshots
confirmed 2026-11-17), the same way `2 Points` already has. Today `C` sets
the bare `Confusing` leaf and auto-advances in one keystroke; that's now
wrong, because `Confusing` is no longer a leaf. Separately, `Remark
Composer`'s "Likely need remarks" line flags every `Confusing` score as
needing a remark — also now wrong, since most of the new sub-categories are
self-explanatory and only one isn't.

## Confusing tree (as seen in the screenshots)

```
Confusing
├─ English meaning unclear ▸
│   ├─ Meme or cultural reference unclear
│   ├─ Key word, phrase, or symbol unclear
│   └─ Sentence meaning or logical relation unclear
├─ Necessary context missing ▸
│   ├─ Essential referent unresolved
│   └─ Essential linked context missing
├─ Task input issue                (leaf, stops at level 2)
└─ Other / open feedback           (leaf, stops at level 2) ← only one needing a remark
```

Mixed depth, unlike `2 Points`, where every top-level category drills to a
level-3 leaf.

## Goals

- `C` opens Confusing's sub-label picking the same way `2` does for `2
  Points`: dropdown stays open, number keys (1–9/0) walk the live columns,
  badges show which number is which, and the active translation only
  advances once a true leaf is committed — never on a bare `Confusing` or a
  mid-tree category pick (e.g. `Confusing / English meaning unclear` alone).
  This holds automatically given the mixed depth (2 vs 3 levels) because the
  existing drill logic reads leaf-vs-category off the DOM, not off a fixed
  depth.
- `Confusing` counts as an incomplete label (like bare `2 Points` does today)
  until a leaf is picked, so the submit-completeness check and the
  Label-Complete logic keep working unchanged in spirit.
- Remark Composer's "Likely need remarks" line flags a `Confusing` pick only
  when the full displayed value is exactly `Confusing / Other / open
  feedback`. Every other complete Confusing leaf (Task input issue, or
  either level-3 leaf under English meaning unclear / Necessary context
  missing) is self-explanatory and is not flagged.
- Keyboard shortcut stays `C`; behavior changes, key doesn't.

## Non-goals

- No change to the `2 Points` tree, its categories, or its remark-flagging
  rule (`/^2 Points/` stays as-is — any complete or bare 2 Points pick is
  still flagged).
- No hardcoding of Confusing's sub-category *names* into the picking logic
  itself (scoring-shortcuts.js already doesn't know `2 Points`' sub-label
  names either — it's generic over whatever the cascader renders). Only the
  one "needs remark" exact-match string in remark-composer.js is allowed to
  know a real label.
- No UI/legend text changes beyond what's needed to describe the new `C`
  behavior truthfully.

## Anti-goals

- Don't advance on an intermediate category pick (`Confusing / English
  meaning unclear` alone) — that would silently skip past a translation
  that still needs its leaf sub-label.
- Don't flag every Confusing pick for a remark again (defeats the point of
  this change) or stop flagging `Other / open feedback` (the one case that
  actually needs free-text).
- Don't match the "needs remark" leaf by splitting the displayed path on
  `/` and counting segments — `Other / open feedback` contains its own `/`,
  so depth-counting would misfire exactly like the code's existing comments
  warn about for `2 Points` labels. Exact full-string match only.

## Constraints

- Must reuse the existing generic label-mode machinery in
  `scoring-shortcuts.js` (`pickLabelByNumber`, `commitLabelAndAdvance`,
  `renderLabelBadges`/badge observer) — it already handles arbitrary/mixed
  depth with zero per-category knowledge; this is a parameter/condition
  change, not new subsystem code.
- `TransCursor`, `RemarkComposer`'s target-selection, and QC Compare are out
  of scope — none of them read the score text in a way that depends on this.

## Approaches considered

There is genuinely one sensible approach, given the architecture:

1. **Reuse the `2 Points` label-mode path for `C` too** (chosen). Change the
   `C` handler to enqueue with `advance: false` (mirroring
   `CFG.advanceOn2`), and extend the two places that currently special-case
   bare `"2 Points"` as "not yet complete" (`isLabelComplete`,
   `commitLabelAndAdvance`'s `accepted()`) to also special-case bare
   `"Confusing"`. Zero new code paths; the drill/badge/advance machinery is
   already generic.
2. **Write a parallel, Confusing-specific drill implementation.** Rejected —
   pure duplication of (1) for no behavioral difference, and it's exactly
   the kind of copy-paste the `TransCursor` extraction in this codebase was
   already done to avoid (see trans-cursor.js's own header comment).
3. **Keep `C` as a single keystroke that cycles/guesses a default
   sub-label.** Rejected outright — the user never asked for a default, and
   guessing a label is a correctness problem (the annotator must pick the
   true sub-category).

## Decided design (approach 1)

### scoring-shortcuts.js

- `CFG`: add `advanceOnConfusing: false` next to `advanceOn2`, for the same
  "a label still needs picking" reason.
- The `k === CFG.keyConfusing` branch: change
  `enqueueScore(CFG.pathKeyConfusing, 'Confusing', true)` to
  `enqueueScore(CFG.pathKeyConfusing, 'Confusing', CFG.advanceOnConfusing)`.
- `isLabelComplete(mod)`: currently `v !== '' && v !== CFG.pathKey2`. Change
  to also exclude `CFG.pathKeyConfusing`: a bare `"Confusing"` is as
  incomplete as a bare `"2 Points"`.
- `commitLabelAndAdvance`'s `accepted()`: currently excludes `before`,
  `''`, and `CFG.pathKey2`. Add `CFG.pathKeyConfusing` to that exclusion
  list for the same not-yet-terminal reasoning.
- No changes needed to `pickLabelByNumber`, `renderLabelBadges`,
  `startLabelBadges`, `exitLabelMode`, or the label-mode keydown branch —
  all already generic over whatever popup/columns are open, regardless of
  which top-level key (`2` or `C`) opened them.

### remark-composer.js

- `likelyText()`: change
  `else if (t === 'Confusing') parts.push(...)`
  to
  `else if (t === 'Confusing / Other / open feedback') parts.push(...)`
  (exact string equality, matching the codebase's existing no-split-on-`/`
  philosophy for display paths).

### README.md

- Main shortcuts table (`C` row): describe it as opening sub-label picking,
  same shape as the `2` row, instead of "then auto-advance".
- "Likely need remarks" paragraph: describe the Confusing condition as the
  specific `Other / open feedback` leaf, not any Confusing pick.
- QC Compare's relabel table (`3` / `2` / `C` row): same wording update as
  the main table.

### Tests

- `tests/fixtures/annotation-sim.js`: `rootColumn()`'s `Confusing` item
  becomes `expandable: true`; add a schematic nested category/leaf tree for
  it (mirroring the existing synthetic `categoryColumn`/`leafColumn`
  pattern used for `2 Points` — fixture labels don't need to match the real
  site's wording, just the real shape: mixed 2-level and 3-level leaves,
  and a path whose full display text is exactly `Confusing / Other / open
  feedback` so the remark-flagging test has something real to assert on).
- `tests/scoring.spec.js`: the existing single-keystroke `C` test needs to
  become a multi-step pick (press `C`, then number(s), assert no advance
  until the leaf lands); add a case proving advance does NOT happen on an
  intermediate category pick.
- `tests/qc-shortcuts.spec.js`: its `{ key: 'c', score: 'Confusing' }` case
  needs the same multi-step shape.
- `tests/remark-writes.spec.js`: the "Likely need remarks" assertions using
  bare `'Confusing'` need a real leaf path; add both a flagged case
  (`.../Other / open feedback`) and an unflagged case (any other Confusing
  leaf) to prove the new exact-match condition both ways.
- `tests/submit-check.spec.js`: the `'Confusing has an empty remark'` case
  needs a real leaf path too, covering the submit-check's own (separate,
  unaffected) completeness logic against the new tree shape.
- `tests/qc-navigation.spec.js`, `tests/qc-swap.spec.js`: bare `'Confusing'`
  fixtures become real leaf paths so they still represent a valid completed
  score under the new tree.
- End-to-end proof needed: a full keyboard-driven walk (press `C`, pick a
  2-level leaf; press `C` again on another translation, pick a 3-level leaf
  through an intermediate category) confirming advance only fires on the
  final commit in both shapes, plus the remark-flag split (same two
  translations: one flagged, one not).

## What's left to the builder

- Exact fixture label text for the schematic Confusing sub-tree in
  `annotation-sim.js` (doesn't need to match the real site, only the real
  shape — mixed depth, one leaf path reachable that's used for the
  remark-flag test).
- Where within each spec file's existing structure the new/changed test
  cases best fit (adjacent to the existing `2 Points` equivalents in each
  file, as a default).
