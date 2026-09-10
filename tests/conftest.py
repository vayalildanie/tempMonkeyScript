"""Shared Playwright fixtures for the userscript test suite.

The userscript is never modified by these fixtures. Since the v1.4.0 split
each src/*.js file already ends with an unconditional `TL.X = X;` publish
onto window.TL (Utils, TransCursor, ScoringShortcuts, RemarkComposer,
QCCompare are always public — verified by loading these files against a
stubbed window/document in plain Node with no test-only flag involved), so
unlike the pre-split version of this suite there is no test-only export seam
to enable here. `load_script` just loads the five src/*.js files in the same
order @require does in annotation-scoring-shortcuts.user.js, then the entry
point file itself, so bootAll() runs for real exactly as Tampermonkey would
run it.
"""
import pathlib

import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
FIXTURES_DIR = pathlib.Path(__file__).parent / "fixtures"

SRC_FILES = [
    "src/utils.js",
    "src/trans-cursor.js",
    "src/scoring-shortcuts.js",
    "src/remark-composer.js",
    "src/qc-compare.js",
]
ENTRY_FILE = "annotation-scoring-shortcuts.user.js"


@pytest.fixture
def load_script():
    """Returns a function that boots a fixture HTML file with the real
    script injected (all src/*.js files, then the entry point), and waits
    for bootAll() to have run.

    Usage:
        def test_foo(page, load_script):
            load_script(page, "blank.html")
            ...
    """
    def _load(page, fixture_name):
        page.goto((FIXTURES_DIR / fixture_name).as_uri())
        for rel in SRC_FILES:
            page.add_script_tag(path=str(REPO_ROOT / rel))
        page.add_script_tag(path=str(REPO_ROOT / ENTRY_FILE))
        # bootAll() runs synchronously off document.body/DOMContentLoaded, so
        # by the time the entry point's script tag finishes executing,
        # window.TL.Utils (published unconditionally by utils.js, the first
        # file loaded above) is proof the whole chain already ran.
        page.wait_for_function("() => !!window.TL && !!window.TL.Utils")
        return page
    return _load
