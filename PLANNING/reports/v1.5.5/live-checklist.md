# v1.5.5 live checklist

Run on a real NOVA annotation row (score page) and a real QC page. The automated suite only proves these against a model of the page. Reload after installing so the new `@require`d files are in use (the panel head should read `v1.5.5`).

1. **Remark Options header, widest to narrowest.** Press `O`, then drag the window's edge from as wide as it goes down to its narrowest. The mode badge, Settings and close buttons stay in the top-right corner the whole way; the badge label shortens first, then the title.
2. **Extra height.** Drag the window tall. The extra height goes to the edit box (it grows); the chip palette keeps its size.
3. **QC idle.** Open a QC row, leave it alone with DevTools Performance recording for 10-20 seconds. There should be no repeating activity from the script (no steady stream of DOM updates in the QC panel).
4. **Re-render recovery.** On the score page, score a row, then wait for NOVA to re-render it. The active-score highlight returns.
5. **Label-pick badges.** Press `2` to open a label menu, then pick with keys `1`-`9`. The badge numbers are correct and do not flicker.
6. **Submit Check gate and row change.** Run the Submit Check gate (`Z` to Submit Check, then `Enter`) and move on to the next row. The row change is detected on both pages. **D19: this step is what exercises `Utils.dispatchNativeSpace`, which is unverified against live NOVA. Watch specifically that the synthetic Space actually lands (the page submits).**
7. **QC panel off-screen.** Resize the browser window, or reload, with QC Compare's panel position saved from a wider monitor. The panel is pulled back on-screen (same check as step 1 for Remark Options).
8. **W/A/S/D.** On the score page and on QC, `W`/`S` move the selection like up/down and `A`/`D` swap columns like left/right (also in Remark Options' target selection). With focus in a Remarks box, typing `w`, `a`, `s`, `d` still types those letters.
9. **Comma join.** In Remark Options, press `Q` on a selection, then click a chip. The text reads `"quote", Chip` with a comma and no colon. Press `Q` twice on the same selection; the quote appears once.
10. **Known cosmetic items to look at (pre-existing, not regressions).** (a) Does the "Remark Options" title truncate to "Remark Optio..." at the default 380px width, and is that acceptable? (b) On a short screen, is the bottom of the QC panel cut off? The panel is taller than a short viewport and its height is not clamped.
