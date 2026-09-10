# What can and can't be verified between iterations

This documents what the pytest + Playwright suite in `tests/` actually
proves, and where its coverage runs out — so a passing suite isn't mistaken
for more confidence than it earns.

## Why Playwright, not a pure-JS unit-test runner (jsdom, Jest)

The script is browser-DOM code, not portable JS: `Utils.fireMouse` reads
`getBoundingClientRect()` to compute click coordinates (jsdom returns
all-zero rects — every synthesized click would land at (0,0)), the panel
drag/resize helpers (`Utils.makeDraggable`/`Utils.makeResizable`, added
`v1.4.3`) are layout-driven the same way, and the Q-quoting flow depends on
a real `Selection`/`Range` boundary quirk that jsdom's Selection stub can't
reproduce. A real Chromium via Playwright is required to test any of this
truthfully.

## No test-only seam needed

An earlier version of this suite (pre-`v1.4.0`, when the script was one
3,851-line file in a single closure) needed a guarded export —
`if (window.__ASS_TEST__) { window.__ASS = {...} }` — appended to the bottom
of the file, since nothing inside that closure (`Utils`, `TransCursor`, the
module factories) was reachable from outside otherwise.

That's no longer true. Since the `v1.4.0` split into `src/*.js` files, each
one already ends with an unconditional publish onto `window.TL` —
`TL.Utils = Utils;`, `TL.TransCursor = TransCursor;`, `TL.ScoringShortcuts =
ScoringShortcuts;`, `TL.RemarkComposer = RemarkComposer;`, `TL.QCCompare =
QCCompare;` — all public, all the time, with no flag required. Verified by
loading all five files against a stubbed `window`/`document` in plain Node
and calling `TL.ScoringShortcuts(TL.Utils)` etc. directly.

`tests/conftest.py`'s `load_script` fixture takes advantage of this: it just
loads the five `src/*.js` files in `@require` order, then the entry point
file itself (`annotation-scoring-shortcuts.user.js`), exactly the way
Tampermonkey does — so `bootAll()` runs for real, and `window.TL.*` is
already there to assert against or drive test-built instances from
(`window.TL.TransCursor({...})` in `test_trans_cursor.py`, for example).

## Testable now, with confidence

- **Pure logic with no DOM dependency.** `TransCursor` (column memory,
  `resolve`/clamping, `toggleColumn`, `nextIn`) is a closure over a
  caller-supplied `list()` — it's exercised directly via `window.TL.
  TransCursor`, with zero fixture markup, and behaves exactly like a normal
  unit test. See `tests/test_trans_cursor.py`.
- **Boot sequencing.** That all three modules (Scoring Shortcuts, Remark
  Composer, QC Compare) construct and `start()` without throwing, against a
  page with none of NOVA's markup yet (the real DOM shape at the instant
  `document-idle` fires, before React's first paint), and that each of the
  five `src/*.js` files' public `TL.*` surface is present. This is the
  cheapest, highest-value regression net there is: if a future change
  reorders module construction, drops a null-check, or breaks one file's
  `@require` load order relative to another, this fails immediately without
  needing any captured fixture. See `tests/test_boot_smoke.py`.
- **`localStorage`-backed state.** Check-mode persistence (`v1.3.5`, moved
  to Remark Composer in `v1.4.0`): press Z, read `localStorage`, reload the
  page, confirm it survived. This is end-to-end, real behavior, no mocking
  involved — one of the few places the script's actual production code path
  (not a stand-in for it) is fully exercised. See
  `tests/test_check_mode_persistence.py`. Panel position/size persistence
  (`SCORE_POS_KEY`, `SCORE_SIZE_KEY`, and the equivalents in Remark Composer
  and QC Compare — all going through `Utils.readJSON`/`writeJSON` as of
  `v1.4.3`) and the min/collapse flag (`SCORE_MIN_KEY`) follow the identical
  pattern and can be tested the same way.
- **Keyboard → DOM effect, once real fixtures exist.** Any shortcut whose
  effect lands in DOM state reachable without truly matching Ant Design's
  internals (e.g. does pressing 1–9 write the expected label onto the
  correct `data-*` attribute or class) is testable against a **captured**
  fixture (see `tests/fixtures/README.md`) — not a hand-authored one. This
  is the next layer to build, table-driven from the README's shortcut
  tables: key → expected DOM effect. It directly catches the "moved Swap
  from S to Z, broke Erase" class of regression the version history shows
  happening on nearly every release. This is also where the currently-open
  Remark Composer quoting bug (`tryQuoteSelection` in
  `src/remark-composer.js`) belongs once it's reproducible against a real
  fixture — see `tests/fixtures/dev-harness.html` for the interactive path
  to get there first.

## Not reliably testable in this environment

- **Real Ant Design's response to synthesized events.** `Utils.clickEl`
  fires a mousedown/mouseup/click triple at real screen coordinates because
  that's what Ant Design's dropdown/cascader listens for — but a *fixture's*
  fake dropdown only responds because we built it to. A passing test here
  proves the script emits the right event sequence, not that the real
  platform reacts as expected. Captured fixtures (real markup) close most of
  this gap for structural behavior, but a full behavioral fidelity claim
  ("this dropdown really opens on NOVA") is not something this harness can
  make — only a manual check against the live site can.
- **Anything touching the live backend.** Submit Check mode can be verified
  as "synthesizes the same Space keypress a real submit would" — not as "an
  actual submission occurred," since there's no real NOVA backend in the
  test environment.
- **Visual appearance and geometry-as-correctness.** Drag-handle placement,
  z-index stacking, whether the QC highlight overlay visually aligns with
  the Remarks textarea — positions and sizes are numerically assertable, but
  "does this look right" is not. Don't chase pixel-snapshot tests here; they
  turn into flaky maintenance debt without adding real confidence.
- **Timing and race ordering.** `Utils.waitFor` timeouts, `settleTimer`,
  and the MutationObserver-vs-input-listener registration order are all
  real races. Playwright's auto-retrying assertions can cover the common
  path, but exact timeout boundaries and adversarial interleavings are
  inherently flaky to assert on — treat any test relying on a specific timer
  firing order as suspect, and never use `time.sleep`/fixed waits to paper
  over flakiness.
- **Tampermonkey itself.** The `@require` fetch-and-cache behavior, the
  `@version`/update-check cycle, and the metadata block's effect are all
  extension-level mechanics with no extension present in this harness. This
  suite can only test the *already-injected* script (via ordinary
  `<script src>` tags, since the script has `@grant none` and zero
  Tampermonkey-specific API calls). A real end-to-end check of `@require`
  itself (does the browser actually pick up a pushed change, on what
  schedule) has to be done manually in an actual Tampermonkey install, not
  in this suite.

## Net effect

The boot-smoke and TransCursor/persistence tests give a fast,
fixture-free way to catch "a change broke construction order or a shared
reference across the five `src/*.js` files" class of bug immediately. They
do **not** cover whether the script preserves its actual on-page behavior
against real Ant Design markup — that needs the captured-fixture layer
described in `tests/fixtures/README.md` and the interactive
`tests/fixtures/dev-harness.html` loader, which is the natural next layer to
build out, starting with whatever fixture reproduces the current quoting
bug.
