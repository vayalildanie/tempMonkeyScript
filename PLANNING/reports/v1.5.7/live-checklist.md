# v1.5.7 live checklist

Run on a real NOVA annotation row and a real QC page. The automated suite only proves these against a model of the page. Reload after installing so the new `@require`d files are in use (the panel head should read `v1.5.7`).

1. **Confusing leaves skip the remark gate.** Score a row so the only non-3-Points translations are `Confusing / Task input issue` and a 3-level leaf (for example `Confusing / English meaning unclear / Key word, phrase, or symbol unclear`), with empty Remarks boxes. In Label Check, `Enter` passes with the green toast. In Submit Check, `Enter` also submits (the page moves on, once).
2. **Other / open feedback still blocks.** Score one translation `Confusing / Other / open feedback` with an empty Remarks box. `Enter` is held back and the toast names that Trans as needing a remark. Type a remark: `Enter` passes. **Confirm the platform displays this leaf as exactly `Confusing / Other / open feedback`.**
3. **Likely need remarks agrees.** Press `O`: the "Likely need remarks" line lists the same translations the gate blocked (and no others).
4. **QC `V` combines.** On a QC row where the two annotators' remarks differ, press `V` on a translation. Annotator 1's Remarks box shows `A; B`, the score is unchanged, the badge says "Remarks combined" with Undo, and the selection moves on.
5. **QC reversal.** `ArrowUp` then `Z`: Annotator 1's original score and remark are back. Repeat `V`, then `ArrowUp`, `X`, `ArrowUp`, `Z`: the original is back again (not Annotator 2's value).
6. **Nothing leaks to Annotator 2.** After `V` and undo, switch to the Annotator 2 tab: its score and remark are unchanged. Reload the row: the platform saved Annotator 1's original, not the combined text, when you undid it.
7. **`V` while typing.** Click into a Remarks box and type `v`: the letter appears and nothing is combined.
