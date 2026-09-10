"""Boot smoke test: the regression net for the module split.

This does not assert on feature behavior. It asserts that all five src/*.js
files plus the entry point load and boot without throwing, against a page
with none of the real workbench markup — which is exactly the DOM shape that
exists for a moment between document-idle firing and NOVA's React tree
finishing its first paint. If a future change reorders module construction,
drops a null check, or breaks the bootAll() ordering documented at its call
site in annotation-scoring-shortcuts.user.js, this fails immediately without
needing a captured NOVA fixture.

Unlike the pre-v1.4.0 version of this test, there's no single window.__ASS
object to enumerate — each src/*.js file publishes its own factory directly
onto window.TL (TL.Utils, TL.TransCursor, TL.ScoringShortcuts,
TL.RemarkComposer, TL.QCCompare), so this checks that public surface instead.
"""

EXPECTED_TL_KEYS = {"Utils", "TransCursor", "ScoringShortcuts", "RemarkComposer", "QCCompare"}


def test_all_modules_construct_without_throwing(page, load_script):
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    load_script(page, "blank.html")

    assert errors == [], f"uncaught script errors during boot: {errors}"

    present = page.evaluate(
        """(keys) => keys.filter((k) => typeof window.TL[k] !== 'undefined')""",
        list(EXPECTED_TL_KEYS),
    )
    assert set(present) == EXPECTED_TL_KEYS


def test_scoring_shortcuts_injects_its_panel_on_boot(page, load_script):
    load_script(page, "blank.html")
    # Scoring Shortcuts' start() calls injectPanel() unconditionally (unless
    # on a QC page, which blank.html's file:// URL never matches) — its
    # presence is the cheapest proof start() actually ran, not just that the
    # factory function exists.
    panel = page.locator("#tl-score-panel")
    assert panel.count() == 1


def test_remark_composer_injects_its_popover_on_boot(page, load_script):
    load_script(page, "blank.html")
    # Remark Composer's start() calls injectPopover() unconditionally on a
    # non-QC page — same reasoning as the Scoring Shortcuts check above.
    popover = page.locator("#rmd-popover")
    assert popover.count() == 1
