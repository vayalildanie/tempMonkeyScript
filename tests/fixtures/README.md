# Fixtures

`blank.html` is hand-authored and deliberately has none of the real
workbench's markup — it exists only for the boot smoke test and the
pure-logic tests (TransCursor, check-mode persistence), none of which touch
NOVA's DOM at all.

Everything else the script does — reading `.ant-select-selector`, walking
`li.ant-cascader-menu-item` columns, finding `.preview-content` and
`.title-text`, measuring the QC highlight overlay against the Remarks
textarea — depends on Ant Design's actual rendered markup on
`nova.xiaohongshu.com`. A fixture for those tests must **not** be
hand-authored from the CSS selectors in the script: that's circular (a fake
element responds to the script because we built it to respond, which proves
nothing about the real site) and it silently drifts from reality as NOVA's
frontend changes.

## How to capture a real fixture

1. Open the real workbench page in a normal browser tab, in the state you
   want to test (e.g. a row with a translation ready to score, or the Remark
   Composer open).
2. In DevTools' Inspector, find the smallest container that includes
   everything the module under test queries for, right-click it, and choose
   **Copy > Outer HTML** (Firefox and Chrome both have this in the
   Inspector's element context menu). Or, from the Console, more precisely:
   ```js
   copy(document.querySelector('.ant-cascader-menus').outerHTML)
   ```
3. **Scrub real content** before saving anywhere: translation text, remarks,
   reviewer names, IDs, anything that isn't structural. Replace with
   placeholder Latin/CJK filler of similar length (some of the script's
   logic — e.g. the translation-reference regex in QC Compare — is
   length/shape sensitive, so don't reduce a paragraph to `"foo"`).
4. Save it as its own fixture file under `tests/fixtures/`, one per
   feature area (e.g. `scoring_cascader.html`, `qc_compare_panel.html`,
   `remark_composer_open.html`) — not one combined "full NOVA page" fixture.
   A monolithic fixture couples unrelated tests together and becomes its own
   maintenance burden.
5. At the top of the file, add an HTML comment with **provenance**:
   ```html
   <!--
     Captured from nova.xiaohongshu.com/model-studio/workspace/<page-type>
     on YYYY-MM-DD. Content scrubbed; structure and classes are real.
     Captured by: <name>. Refresh if <the module>'s selectors stop matching.
   -->
   ```

## When a fixture-based test starts failing

Two possible causes, and they need different responses:

- **The script regressed** — a refactor broke logic that used to work against
  this exact markup. Fix the script.
- **NOVA's markup changed** — the fixture is now stale. Re-capture it (steps
  1–4 above) and note the new date in its provenance comment. This is a
  fixture-refresh task, not a script bug, but it should still be visible
  (don't just silently update the fixture and move on — the stale-fixture
  window is exactly when the *real* script could have been broken on the
  live site without any test catching it).

If a test can't tell you which of the two happened, it's not asserting
tightly enough — prefer assertions on structural outcomes (which element got
a class, what a cursor's `get()` returns, what got written to localStorage)
over pixel/geometry snapshots.

## Interactive debugging: `dev-harness.html`

The pytest+Playwright suite above is the automated regression net; it isn't
the fastest way to just reproduce a bug and try a fix by hand. For that, use
`dev-harness.html` in this same directory: open it directly in a browser
(double-click, or File > Open File — no Tampermonkey install, no login, no
local server) and it loads the real script — all five `src/*.js` files plus
the entry point, in the same order `@require` does — against whatever markup
sits in its `<body>`.

To use it for a specific bug:

1. Capture and scrub a fixture per the steps above, scoped to whatever the
   bug actually needs (e.g. a quoting bug needs at least one populated
   `[data-module-name="TransN"]` block plus the `Remarks` field — it doesn't
   need the QC Compare page's markup at all).
2. Copy `dev-harness.html` to a new file (or paste into
   `quoting-bug-repro.html.template` and rename it to `.html` if that's the
   bug you're on), and paste the scrubbed markup into `<body>` in place of
   the placeholder comment.
3. Open the new file in Firefox. Reload after every edit to `src/*.js` — the
   script re-boots fresh each time, exactly like a Tampermonkey update would.
4. Once the bug reproduces reliably this way, promote the fixture into the
   pytest suite (a new `test_*.py` file loading the same fixture via
   `load_script`) so it stays fixed going forward.
