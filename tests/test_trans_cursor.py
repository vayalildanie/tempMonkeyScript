"""Unit tests for TransCursor, reached through window.TL.TransCursor.

TransCursor is pure logic over a caller-supplied `list()` callback — no DOM,
no timers, no Ant Design. This is the one module in the script that a
Playwright harness can test as cleanly as a plain unit test, so it's worth
being thorough here: real DOM/keyboard coverage lives in the shortcut-matrix
tests instead, once real fixtures exist (see tests/fixtures/README.md).

Every test builds a fresh cursor by calling window.TL.TransCursor from
inside page.evaluate — the constructor and its closures live entirely in the
page's JS context, not in Python, so all assertions read back plain
JSON-serializable results (numbers, arrays, null). src/trans-cursor.js
publishes `TL.TransCursor = TransCursor;` unconditionally at its own bottom,
so no test-only seam is needed to reach it.
"""


def _make_cursor(page, nums, leftMax=3):
    """Build a TransCursor over a fixed `nums` list and return a handle whose
    methods can be called from Python via evaluate. onChange/status calls are
    recorded into window.__lastChange / window.__statusCalls for assertions."""
    page.evaluate(
        """(nums) => {
            window.__statusCalls = [];
            window.__lastChange = null;
            window.__cursor = window.TL.TransCursor({
                list: () => nums,
                onChange: (n, opts) => { window.__lastChange = { n, opts }; },
                status: (msg) => { window.__statusCalls.push(msg); },
                leftMax: 3,
            });
        }""",
        nums,
    )


def test_reset_lands_on_first_scoreable(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [2, 4, 6])
    result = page.evaluate("() => window.__cursor.reset()")
    assert result == 2
    assert page.evaluate("() => window.__cursor.get()") == 2


def test_reset_on_empty_row_returns_null(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [])
    result = page.evaluate("() => window.__cursor.reset()")
    assert result is None
    assert page.evaluate("() => window.__cursor.get()") is None


def test_step_moves_forward_and_clamps_at_the_end(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [1, 2, 3])
    page.evaluate("() => window.__cursor.reset({ silent: true })")  # lands on 1
    assert page.evaluate("() => window.__cursor.step(1)") == 2
    assert page.evaluate("() => window.__cursor.step(1)") == 3
    # already at the last element — stepping further must clamp, not wrap or throw
    assert page.evaluate("() => window.__cursor.step(1)") == 3
    calls = page.evaluate("() => window.__statusCalls")
    assert calls[-1] == "Current: Trans3"


def test_toggle_column_prefers_remembered_slot(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [1, 2, 4, 5])  # left={1,2} right={4,5}, leftMax=3
    page.evaluate("() => window.__cursor.set(2, { silent: true })")
    page.evaluate("() => window.__cursor.toggleColumn()")  # -> right; remembers nothing yet, picks first right = 4
    assert page.evaluate("() => window.__cursor.get()") == 4
    page.evaluate("() => window.__cursor.set(5, { silent: true })")  # move within right column, remembered right = 5
    page.evaluate("() => window.__cursor.toggleColumn()")  # -> left; earlier set(2) already remembered left = 2
    assert page.evaluate("() => window.__cursor.get()") == 2
    result = page.evaluate("() => window.__cursor.toggleColumn()")  # -> right; should recall 5, not fall back to 4
    assert result == 5


def test_toggle_column_stays_put_when_other_column_has_nothing_scoreable(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [1, 2])  # both in the left column (leftMax=3); nothing in the right column at all
    page.evaluate("() => window.__cursor.set(1, { silent: true })")
    result = page.evaluate("() => window.__cursor.toggleColumn()")
    assert result is None
    # per TransCursor's contract, a no-op toggle must NOT move `cur`
    assert page.evaluate("() => window.__cursor.get()") == 1


def test_sync_falls_back_to_nearest_lower_number_when_current_disappears(page, load_script):
    load_script(page, "blank.html")
    _make_cursor(page, [1, 2, 3, 5])
    page.evaluate("() => window.__cursor.set(3, { silent: true })")
    # Row re-scraped: Trans3 is gone, but 2 (lower) and 5 (higher) remain.
    # resolve() must prefer the nearest *lower* survivor, matching Module 1's
    # original clamping behavior documented at TransCursor's `resolve`.
    page.evaluate(
        """() => {
            window.__cursor2 = window.TL.TransCursor({
                list: () => [1, 2, 5],
                onChange: (n, opts) => { window.__lastChange = { n, opts }; },
                leftMax: 3,
            });
        }"""
    )
    # sync() re-anchors a *fresh* cursor's internal state, so seed it first
    # via set() against the pre-removal list, then sync() against the new one.
    result = page.evaluate(
        """() => {
            const c = window.TL.TransCursor({ list: () => [1,2,5], leftMax: 3 });
            c.set(3, { silent: true }); // pretend cur was 3 before this row's list changed
            return c.sync();
        }"""
    )
    assert result == 2


def test_next_in_advances_and_saturates_at_the_last_element(page, load_script):
    load_script(page, "blank.html")
    nums = [1, 3, 5]
    assert page.evaluate("(nums) => window.TL.TransCursor.nextIn(nums, 1)", nums) == 3
    assert page.evaluate("(nums) => window.TL.TransCursor.nextIn(nums, 5)", nums) == 5
    # num not present in the snapshot at all -> returned unchanged, not an error
    assert page.evaluate("(nums) => window.TL.TransCursor.nextIn(nums, 99)", nums) == 99
