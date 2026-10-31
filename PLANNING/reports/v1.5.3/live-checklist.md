# v1.5.3 live checklist (run on the real NOVA pages)

The automated suite uses a model of the page, so these are the things it cannot prove. Run them after the release is on `main` (Tampermonkey fetches the `@require`d files from `main`) or by pasting the branch's files into a local copy of the script. Tick what passes; note what does not. The "if it fails" column says what the failure would mean.

Use a throwaway row you can edit and reset. None of these steps needs a real submission except the single one marked **(submits)**.

## Annotation page (score page)

| # | Do this | Expect | If it fails |
|---|---|---|---|
| A1 | Score a translation `2 Points` with a full label. Leave its Remarks box empty. Press Enter in **Label Check** (default). | Enter is held back; a toast names that translation as needing a remark | Gate not reading the real Remarks box (check the `TransN Remarks` module name on this row) |
| A2 | Same row, switch to **Submit Check** (`Z`), press Enter. | Nothing submits | Same as A1, or the synthetic Space escaped |
| A3 | Type any remark in that translation's own Remarks box (not the popover). Press Enter in Submit Check. **(submits)** | One submit | The real Space listener ignores the synthetic Space (the known unverified item) |
| A4 | Score a translation `3 Points`, leave its remark empty; everything else labelled and remarked. Enter. | Passes, no toast block | Gate over-blocking |
| A5 | Switch to **Check Off**, repeat A1. | Enter is not held back | Check Off no longer off |
| A6 | A bare `2 Points` (no label) on one translation and a missing remark on another. Enter. | One toast naming both, each with its own reason: `Trans2 needs a complete label; Trans4 needs a remark.` | Reasons paired with the wrong translation |
| A7 | Open Remark Options (`O`). Click its edit box, type some text, press `Esc` once. | The box loses focus; the window stays open; text and target unchanged. A second `Esc` closes it. | Escape handling not reaching the real keydown |
| A8 | Click a translation's own Remarks box while the window is open, type, press `Esc` once. | That box loses focus; window stays open | Same |
| A9 | With a Chinese (or other IME) keyboard, start composing in a Remarks box and press `Esc` mid-composition. | The composition is cancelled by the IME; the window stays open | IME `isComposing` not reported (the guard is then inactive) |
| A10 | Select a sentence inside a translation, press `Q`. | `"the sentence"` is added to the highlighted Remarks box. No `Trans N` prefix | Quote format |
| A11 | Select a few words inside the **Note** body, press `Q`. | Quoted the same way | The live Note body is not `.refactor-content .content-box` |
| A12 | Drag from the Note body to the end of the note, including the **Collapse/Expand** control or the picture row, press `Q`. | Refused ("Select text inside one translation or the Note"); nothing written; the selection is still there | Note chrome is still quotable |
| A13 | Triple-click a whole translation, press `Q`. Then Ctrl-A, press `Q`. | The triple-click is quoted. Ctrl-A is refused | Refusal too strict / too loose on the real DOM |
| A14 | Select from one translation into the next, press `Q`. | Refused | Single-source rule |
| A15 | After A10, click elsewhere or move to the next row and back. | The remark written by the composer is still in the translation's own box and was saved by NOVA | NOVA's React state overwrote the script's write (the known unverified item) |

## QC page (`/quality_`)

| # | Do this | Expect | If it fails |
|---|---|---|---|
| Q1 | Open a QC row. | Badges appear under each Score; Score **and** Remarks of the selected translation are outlined together; the badge sits between them; compare with your two reference screenshots | Outline wrapper wrong on the live layout (`.text-labels`) |
| Q2 | On a translation where the annotators differ in remark only, look at the badge. | It shows Annotator 2's remark as a second line, and the summary counts it as still to reconcile | Remark not read from the live Remarks box |
| Q3 | Press `Z` on a translation that differs. | Score and Remark become Annotator 2's; the selection moves to the next translation | Remark write not persisting (see Q5) |
| Q4 | Press `↑`, then `Z` again. | Back to Annotator 1's exact original score and remark | Pair not preserved |
| Q5 | After Q3, reload the page (or move row and come back). | Whatever NOVA saved is what you left on screen | NOVA's state overwrote the remark write |
| Q6 | Clear Annotator 1's remark by hand and press `X` on the score; press `Z`. | Annotator 2's value is written; `↑`, `Z` restores Annotator 1's original | Failsafe |
| Q7 | Type your own remark over Annotator 1's, press `Z`. | Annotator 2's is written; the badge shows `your edit: …` (hover for the full text) | Hand-edit stash |
| Q8 | Move to the **next row**. | The panel re-reads both tabs (a short flicker to Annotator 2 and back) and shows the new row's differences. `Z` right after the move writes nothing wrong | Row change detection (new in v1.5.3; it never worked before) |
| Q9 | On a row where a remark loads slowly (if you can find one), watch the first 3 seconds. | The row's real remark becomes the stored original; no loop of tab switching | Lazy-load verify |
| Q10 | Press `Z` on a translation whose Annotator 2 remark is empty and Annotator 1's is not. | Annotator 1's remark is cleared; `↑`, `Z` brings it back. If Annotator 2's remark had simply not loaded yet, press `↑`, `Z` to restore | Late text on Annotator 2's tab is not seen by the verify (known limit) |
| Q11 | Score a translation `3 Points` and give it a remark. | The panel warning names it; it clears when the remark is removed | Per-translation warning |
| Q12 | Check the browser console during all of the above. | No errors from the script | Any leftover reference to removed code |

## Also still worth a glance (from earlier releases)

- Real dropdown popups: do the score dropdowns attach to `body`? (scoring keys still work if they do.)
- `3`, `C`, and label digits on the QC page set the score without advancing (unchanged; only `Z` advances).
