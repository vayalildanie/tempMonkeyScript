"""Check-mode persistence (v1.3.5, now owned by Remark Composer as of v1.4.0):
real, testable behavior.

The submit-check mode (Label Check / Submit Check / Check Off, cycled with
Z) is saved to localStorage and reloaded on the next boot. This needs no
Ant Design markup at all — the keydown handler and localStorage read/write
both work against blank.html — so unlike most of this script, it's testable
end-to-end exactly as a user would experience it: press a key, reload the
page, confirm the state came back.
"""

CHECK_KEY = "trans-tool:nova-score-check-v1"


def test_fresh_session_defaults_to_label_check(page, load_script):
    load_script(page, "blank.html")
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") is None


def test_pressing_z_cycles_and_persists_the_mode(page, load_script):
    load_script(page, "blank.html")
    page.keyboard.press("z")
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") == "submit"
    page.keyboard.press("z")
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") == "off"
    page.keyboard.press("z")
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") == "label"


def test_mode_survives_a_reload(page, load_script):
    load_script(page, "blank.html")
    page.keyboard.press("z")  # -> submit
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") == "submit"

    load_script(page, "blank.html")  # simulates a page reload: re-injects and reboots
    assert page.evaluate(f"() => localStorage.getItem('{CHECK_KEY}')") == "submit"
