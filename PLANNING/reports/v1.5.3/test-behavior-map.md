# v1.5.3 Task 6: Test Behavior Map

Requirement: T-CLEAN. Written before any test change (step T6.1), on `release/v1.5.3` at `62aa500`.

**Baseline:** `npx playwright test` = **196 passed** in 9 spec files. (The lead's machine runs 197: one extra
`selector contract holds for capture <name>` test per local folder in the gitignored `captures/`; this worktree has none.)

How to read the tables:

- **Owner** is `file › group › test title` (file names without `.spec.js`). `[n rows]` marks a table-driven test.
- **Status:** `ok` = exactly one owner. **MERGE?** = two or more owners for the same behavior (a merge candidate).
  **GAP** = no test at all (reported only; Task 6 writes no feature tests).
- "Incidental" means the behavior is asserted on the way to another test's real subject. It is listed so a merge
  does not remove the only real owner, but it does not make a behavior a merge candidate by itself.

## A. Scoring shortcuts (annotation stage, `src/scoring-shortcuts.js`, `src/trans-cursor.js`, `src/utils.js`)

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| A1 | ArrowLeft/Right jump between the Trans1-3 and Trans4-7 columns | scoring › lateral movement › left and right jump between the Trans1-3 and Trans4-7 columns | ok (unit-level twin in A20) |
| A2 | Each column remembers the slot last used | scoring › lateral movement › each column remembers the slot you last used | ok (unit-level twin in A20) |
| A3 | The empty Trans3 is never active when stepping down or up | scoring › lateral movement › the empty Trans3 is never active, whether stepping down or moving across | ok |
| A4 | `TransCursor.nextIn` skips a missing number | shared › TransCursor toggles columns... (`nextAfter2`); scoring › ...the empty Trans3 is never active... (`nextIn([1,2,4,5,6,7], 2)`) | MERGE? assertion-level only; left alone (one assertion inside a wider test) |
| A5 | `checkCompleteness()` reports scoreable [1,2,4,5,6,7] and skipped [3] | scoring › ...the empty Trans3 is never active... | ok |
| A6 | ArrowDown past the bottom of the right column stays on Trans7 | scoring › lateral movement › moving down past the bottom of the right column stays on Trans7 | ok |
| A7 | `3` sets 3 Points, closes the cascader and advances | scoring › 3 and C advance › 3 sets 3 Points and advances to the next scoreable translation | ok |
| A8 | `C` sets Confusing and the advance skips the empty Trans3 | scoring › 3 and C advance › C sets Confusing and skips the empty Trans3 on the way to Trans4 | ok |
| A9 | `3` on the last translation sets it, stays, status says "(last)" | scoring › 3 and C advance › 3 on Trans7 sets it and stays there | ok |
| A10 | `2` opens the cascader on bare 2 Points, does not advance, status "press a number" | scoring › 2 and label picks › 2 leaves the cascader open on bare 2 Points and does not advance | ok |
| A11 | Label keys 2-9 and 0 commit their terminal label and advance | scoring › 2 and label picks › terminal label N commits "..." and advances to Trans2 [9 rows] | ok |
| A12 | Label key 1 drills into a category, auto-picks its lone leaf, advances once | scoring › 2 and label picks › 1 drills into a category and only advances once its leaf is committed | ok |
| A13 | A category with several children waits for the next pick | scoring › 2 and label picks › a category with several children waits for the next pick instead of advancing | ok |
| A14 | A label pick from Trans2 skips the empty Trans3 | scoring › 2 and label picks › a label pick from Trans2 skips the empty Trans3 and advances to Trans4 | ok |
| A15 | A label pick on Trans7 stays on Trans7 | scoring › 2 and label picks › a label pick on Trans7 stays on Trans7 | ok |
| A16 | A leaf click the platform ignores: no advance, status "not applied" | scoring › failed label click › a leaf click that leaves bare 2 Points does not advance and says so | ok |
| A17 | After a failed leaf the pick can be retried and then advances | scoring › failed label click › after a failed leaf the label pick can be retried and then advances | ok |
| A18 | A failed lone-leaf auto-pick after a category does not advance | scoring › failed label click › a failed lone-leaf auto-pick after a category does not advance either | ok |
| A19 | `Utils.transNumFromModuleName` parses Trans/Score/Remarks names (incl. "Trans 2 Remarks") and rejects the rest | shared › parses Trans module numbers and rejects unrelated names and wrong suffixes | ok |
| A20 | `TransCursor`: column toggle, slot memory, refusing a missing remembered slot, left-only stays, scroll flags | shared › TransCursor toggles columns, remembers slots, falls back, and nextIn advances | ok |
| A21 | `Utils.clickEl` opens a cascader and selects 3 Points | harness › Utils.clickEl opens a cascader and selects 3 Points | ok |
| A22 | `X` clears the active score in the annotation stage | none | GAP |
| A23 | `P` shows/hides the scoring panel | none | GAP |
| A24 | Escape cancels an in-progress label pick (annotation stage) | none (QC twin F5 exists) | GAP |
| A25 | ArrowUp/Down while picking a label exits label mode and moves | none | GAP |
| A26 | Shortcuts do nothing while the panel's ON/OFF switch is OFF | none | GAP |
| A27 | Scoring keys are ignored with a modifier held or while typing in a text field | none (QC twin F7 exists) | GAP |

## B. Check modes and the remark gate (`src/remark-composer.js` `performCheck`, auto-advance)

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| B1 | Label Check blocks Enter on a row with an unscored translation; no Space, no submit | submit-check › Label Check › incomplete row: Enter is blocked and nothing is submitted | ok |
| B2 | Label Check lets Enter through on a complete row; no Space, no submit | submit-check › Label Check › complete row: Enter passes through and nothing is submitted; submit-check › remark gate › label mode › passes 3 Points with an empty remark | MERGE? (gate row does not assert "no Space"; the Label Check test scores by keyboard) |
| B3 | Submit Check blocks Enter on a row with an unscored translation; no Space | submit-check › Submit Check › incomplete row: blocked, no Space | ok |
| B4 | Submit Check on a complete row: Enter prevented, one Space keydown + keyup, one submit | submit-check › Submit Check › complete row: one Space keydown, one keyup, one submit...; submit-check › remark gate › submit mode › passes 3 Points with an empty remark | MERGE? (gate row does not count keyup) |
| B5 | Submit Check still submits once with focus on a cascader's readonly input | submit-check › Submit Check › complete row with focus left on a cascader readonly input: still one submit | ok |
| B6 | Check Off leaves Enter untouched and submits nothing | submit-check › Check Off › Enter is untouched and nothing is submitted; submit-check › remark gate › off mode › ignores ... [6 rows] | MERGE? (off rows use a bare-2-Points row, not an unscored one) |
| B7 | `Z` cycles Label → Submit → Off → Label, the pill follows, the mode survives a reload | submit-check › mode cycling › z cycles Label -> Submit -> Off -> Label and the mode survives a reload | ok |
| B8 | A mouse click on the submit control submits even in Label Check with an incomplete row | submit-check › mouse override › clicking the submit control submits in Label Check mode... | ok |
| B9 | Submit Check auto-submits an empty row exactly once about a second after it empties | submit-check › empty-row auto-advance › submits exactly once about a second after the row empties | ok |
| B10 | A later row change to a non-empty row cancels the stale auto-advance timer | submit-check › empty-row auto-advance › a later row change to a non-empty row cancels the stale timer | ok |
| B11 | Translations rendering before the timer fires cancel the auto Enter | submit-check › empty-row auto-advance › translations that render before the timer fires cancel the auto Enter... | ok |
| B12 | Leaving Submit mode cancels the pending auto-advance timer | submit-check › empty-row auto-advance › leaving Submit mode cancels the pending timer... | ok |
| B13 | Remark gate (A-GATE): non-3 with empty/whitespace remark blocks, non-3 with remark passes, Confusing without remark blocks, 3 Points passes, missing label blocks even with a remark; Off ignores all | submit-check › remark gate › {label,submit,off} mode › ... [18 rows] | ok |
| B14 | The blocked-check toast pairs each translation with its own missing label or remark | submit-check › remark gate › the {label,submit} mode toast pairs each translation... [2 rows] | ok |
| B15 | `dispatchNativeSpace`: a focused TEXTAREA sends Space to the body; a focused BUTTON keeps it | submit-check › dispatchNativeSpace target › focused TEXTAREA...; focused BUTTON... | ok |
| B16 | Enter on a focused popover control (chip, Clear, close) does not run the check | none | GAP |
| B17 | The "Check passed" toast on a clean pass | none (only the blocked toast is asserted) | GAP |

## C. Remark Composer (`src/remark-composer.js`)

### C.1 Target selection, arrows, highlight, row change

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| C1 | Initial target = first populated translation not scored 3 Points (unscored, bare/labeled 2 Points, Confusing eligible; 3 Points and empty skipped) | remark-targets › initial target › ... [5 rows] | ok |
| C2 | Initial target falls back to Trans1 when every populated score is 3 Points | remark-targets › initial target › falls back to Trans1 when every populated score begins with 3 Points | ok |
| C3 | `Q` with the composer closed opens it at the initial target and quotes there | remark-targets › initial target › Q with the composer closed opens at the same initial target | ok |
| C4 | The first ArrowUp jumps to Trans1; later arrows step, clamp at Trans1, skip the empty Trans3 | remark-targets › arrow movement › the first ArrowUp jumps to Trans1, later arrows are sequential and clamped | ok |
| C5 | ArrowDown consumes the one-shot jump: the next ArrowUp steps one | remark-targets › arrow movement › ArrowDown first clears the one-shot jump | MERGE (group 1) |
| C6 | A column toggle consumes the one-shot jump | remark-targets › arrow movement › a column toggle also clears the one-shot jump | MERGE (group 1) |
| C7 | A click on another translation's Remarks (from composer focus) consumes the jump | remark-targets › mouse... › click from composer focus then Up proceeds from clicked target | MERGE (group 1) |
| C8 | Direct input into another translation's Remarks consumes the jump | remark-targets › mouse... › direct paste-like input switches target, mirrors multiline text and consumes first Up | MERGE (group 1) |
| C9 | A click on the already-targeted Remarks consumes the jump | remark-targets › mouse... › same-target clicks preserve textarea selection and consume the special Up jump | MERGE (group 1) |
| C10 | An unchanged native input on the target consumes the jump | remark-targets › mouse... › unchanged native input consumes first Up but composer feedback does not (second half) | MERGE (group 1) |
| C11 | Composer feedback (our own write into NOVA's textarea) does NOT consume the jump | remark-targets › mouse... › unchanged native input consumes first Up but composer feedback does not (first half) | ok, kept apart (exception) |
| C12 | When Trans1 is already the target, the first ArrowUp only consumes the jump | remark-targets › arrow movement › when Trans1 is already the target the first ArrowUp only consumes the one-shot | ok, kept apart (exception) |
| C13 | Arrows inside `#rmd-edit` move the caret natively and leave the target | remark-targets › arrow movement › arrows inside #rmd-edit keep native caret behavior and do not move the target | MERGE (group 2) |
| C14 | Arrows inside a NOVA Remarks textarea move the caret natively and leave the target | remark-targets › arrow movement › arrows inside the NOVA Remarks textarea keep native behavior | MERGE (group 2) |
| C15 | A real click in a NOVA Remarks textarea selects it, keeps focus and caret, native arrows work, typing mirrors live into `#rmd-edit` | remark-targets › mouse... › real textarea click preserves focus, caret, native arrows and live typing | MERGE (group 2) |
| C16 | Arrows do nothing while the composer is closed | remark-targets › arrow movement › arrows do nothing while the composer is closed | ok |
| C17 | Only the active Remarks module (incl. spaced "Trans 2 Remarks") carries the highlight; it goes on close | remark-targets › highlight › only the active Remarks module carries the class, and it goes away on close | ok |
| C18 | The highlight is re-applied after the module is replaced | remark-targets › highlight › is re-applied after the module is replaced | ok |
| C19 | Scoring's active-score highlight is hidden while the composer is open | remark-targets › highlight › scoring active-score highlight is not applied while the composer is open | ok |
| C20 | A row change re-resolves the initial target, carries no text over, re-arms the jump | remark-targets › row change and re-render while open › a row change re-resolves the initial target... | ok |
| C21 | A row change keeping the same target reloads its text | remark-targets › row change... › a row change that keeps the same target still reloads its text from the new row | ok |
| C22 | When the target stops being populated it falls to the nearest lower populated one, without writing | remark-targets › row change... › when the active target stops being populated... | ok |

### C.2 Writes, quoting, likely-remark summary, Escape

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| C23 | Typing and chips land only in the highlighted target across switches; `#rmd-edit` reloads per target | remark-targets › writes › typing and chips land only in the highlighted target across target switches | ok |
| C24 | A React-style replacement of the textarea does not redirect the write | remark-targets › writes › a React-style replacement of the textarea does not redirect the write | ok |
| C25 | A page-side edit mirrors into `#rmd-edit` and selects its (eligible) translation | remark-targets › writes › reverse sync selects an eligible page-side edit; remark-targets › mouse... › direct paste-like input switches target, mirrors multiline text... | MERGE (with group 1: the paste test's mirror half joins reverse sync) |
| C26 | Clear empties only the active target and `#rmd-edit` | remark-targets › writes › Clear affects only the active target; remark-targets › mouse... › module clicks load text without writing; subsequent chips and Clear affect only that target | MERGE? not merged: the second test's subject is a mouse-selected target and its no-write load; Clear there is one step of it |
| C27 | Typing "Trans 2" never produces a `.rmd-tref` highlight | remark-targets › writes › typing "Trans 2" never produces a .rmd-tref highlight | ok |
| C28 | `Q` with the composer open quotes into the highlighted target; the target does not move | remark-targets › quoting › Q with the composer open keeps the highlighted target and appends there | ok |
| C29 | `Q` with no selection focuses `#rmd-edit` with the caret at the end | remark-targets › quoting › Q with no selection focuses #rmd-edit with the caret at the end | ok |
| C30 | A selection spanning Trans4 to Trans5 is refused and writes nothing | remark-targets › quoting › a selection spanning two translations is rejected and writes nothing; remark-targets › quoting › refuses Trans4 to Trans5 (table row) | MERGE (identical range; the table row asserts strictly more) |
| C31 | Clicking a translation title inserts nothing and keeps the target | remark-targets › quoting › clicking a translation title inserts nothing and keeps the target | ok |
| C32 | Quotable sources (A-QUOTE): whole/part translation, parent boundary, Note body, Note heading+body, tagged text accepted as `"text"`; two translations, Note into Collapse, Note through pictures, Collapse alone, Note+translation, Context-EN (+translation), title+text, select-all refused | remark-targets › quoting › {quotes,refuses} ... [15 rows] | ok |
| C33 | Separators: chip after quote `": "`, quote after chip and quote after quote two spaces, a legacy `Trans N "x"` counts as a quote | remark-targets › quoting › separators › ... [4 tests] | ok |
| C34 | First Escape blurs `#rmd-edit`, keeps window, text, target | remark-targets › escape › the first Escape blurs #rmd-edit and keeps the window, text, and target | ok |
| C35 | First Escape blurs a NOVA Remarks textarea (incl. "Trans 2 Remarks") | remark-targets › escape › the first Escape blurs a NOVA Remarks textarea, including Trans 2 Remarks | ok |
| C36 | Second Escape closes; an unrelated focus (a button) closes on the first | remark-targets › escape › a second Escape closes the window, and an unrelated focus still closes on the first | ok |
| C37 | An unrelated textarea (header remark bar) closes on the first Escape | remark-targets › escape › closes on the first Escape when an unrelated textarea... has focus | ok |
| C38 | Escape during IME composition is left to the IME | remark-targets › escape › leaves an Escape that is part of IME composition to the IME | ok |
| C39 | Likely-remark summary lists 2 Points (bare or labeled) and Confusing, omits 3 Points and unscored, sits below the edit box | remark-targets › likely-remark summary › lists 2 Points (bare or labeled) and Confusing... | ok |
| C40 | The summary updates on a score change and says when nothing needs remarks | remark-targets › likely-remark summary › updates after a score change... | ok |
| C41 | The summary is informational: the target ignores it; the hint line is empty by default | remark-targets › likely-remark summary › is informational...; (hint empty also asserted in release-smoke › Remark Options popover carries no static help text) | ok (assertion-level overlap on the hint only) |
| C42 | Settings (gear) panel: editing and persisting the chip configuration | none | GAP |
| C43 | Popover drag/resize and their persistence | none | GAP |

### C.3 Mouse selection and direct editing

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| C44 | A Remarks module click selects it and loads its text without writing; chips/Clear then affect only it | remark-targets › mouse... › module clicks load text without writing... | ok |
| C45 | A click on the already-targeted Remarks module keeps the text selection inside its textarea | remark-targets › mouse... › same-target clicks preserve textarea selection... (first half) | ok |
| C46 | Ineligible (empty) translation clicks and edits do not switch the target or leak text | remark-targets › mouse... › ineligible empty translation clicks and edits do not switch or leak text | ok |
| C47 | Clicks and inputs while closed leave no mouse target for the next open | remark-targets › mouse... › closed clicks and inputs do not retain a mouse target on reopen | ok |
| C48 | A replaced module stays clickable and syncs both ways | remark-targets › mouse... › replacement module remains clickable and synchronizes both ways | ok |
| C49 | Composer and source-text clicks do not retarget; column memory learns a mouse selection | remark-targets › mouse... › composer and source clicks do not retarget; column memory learns mouse selection | ok |
| C50 | A spaced module name selects even when the new text equals `#rmd-edit` | remark-targets › mouse... › spaced module names select even when the new text equals the proxy | ok |
| C51 | With every translation empty, Remarks can still be selected | remark-targets › mouse... › all-empty source fallback still permits selecting Remarks | ok |
| C52 | Selecting alone fires no input events; score clicks and right-clicks do not retarget | remark-targets › mouse... › selection alone emits no input events; ignored score and right-click do not retarget | ok |

## D. QC Compare: navigation and selector (`src/qc-compare.js`)

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| D1 | On a `/quality_` URL: panel shown, Annotator 2's tab read once then back to Annotator 1, verdict buttons A1 "1" / A2 "3", diff/same badges, A2's score in the badge, no badge for the empty Trans3, A1's own data on screen | qc-compare › smoke › scrapes both tabs and renders badges when the URL contains /quality_ | ok |
| D2 | The summary lists every translation still to reconcile, counting a remark-only difference | qc-compare › smoke › scrapes both tabs... (Trans5: both remarks non-empty); qc-swap › Z swaps Score and Remark › counts a remark-only difference as still to reconcile (Trans4: one remark empty) | MERGE? not merged: the inputs differ (empty vs non-empty remark), so equal coverage cannot be proven |
| D3 | The QC legend lists only live shortcuts (no Rewrite, no "+ Add"; Z Swaps Score + Remark; Move Focus) | qc-compare › smoke › lists only the live shortcuts in the legend when the panel is open | ok |
| D4 | Off a `/quality_` URL there is no QC panel, style, badge or outline | qc-compare › smoke › never shows the QC panel when the URL is not a /quality_ page | ok |
| D5 | ArrowDown/Up move the selection and skip the empty Trans3 | qc-compare › arrows › moves the selection down and skips the empty Trans3...; qc-compare › selector spans... › moves both outlines together when the arrow keys are pressed | MERGE (Q1) |
| D6 | ArrowLeft/Right toggle columns | qc-compare › arrows › toggles between columns...; qc-compare › selector spans... › moves both outlines together... | MERGE (Q1) |
| D7 | The selector outlines the Score and the Remarks of the same translation (incl. spaced "Trans 2 Remarks") | qc-compare › selector spans... › outlines the Score and the Remarks of the same translation when it is selected; ...moves both outlines together... | MERGE (Q1) |
| D8 | A tab round trip keeps the selection and an edited score; the A2 tab shows A2's data | qc-compare › arrows › keeps the selection and an edited score when the tabs make a round trip | ok |
| D9 | The outline (and one badge) comes back when the platform replaces the Score host | qc-compare › arrows › restores the selection outline when the score host is re-rendered; qc-compare › selector spans... › restores both outlines when the platform replaces the Score host | MERGE (Q2) |
| D10 | The badge stays between the Score control and the Remarks after Z | qc-compare › selector spans... › keeps the badge between the Score control and the Remarks when Z swaps a score | ok |
| D11 | Both outlines come back when the platform replaces the Remarks module | qc-compare › selector spans... › restores both outlines when the platform replaces the Remarks module | ok |
| D12 | No outline when nothing is scoreable | qc-compare › selector spans... › leaves no outline on the page when no translation is scoreable | ok |

## E. QC Compare: Z swap, failsafe, rows, 3-Points rule, advance, mouse

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| E1 | Z writes Annotator 2's Score and Remark and marks the badge swapped (both differ / score only / remark only) | qc-swap › Z swaps Score and Remark › writes Annotator 2's value... [3 rows] | ok |
| E2 | Z never writes another translation | qc-swap › Z swaps... › never writes another translation when Z swaps one | ok |
| E3 | Repeated Z flip-flops; every writing Z advances | qc-swap › Z swaps... › keeps flip-flopping between the two annotators when Z is pressed repeatedly | ok |
| E4 | The badge shows A2's remark only when the remarks differ | qc-swap › Z swaps... › shows Annotator 2's remark in the badge only when the remarks differ | ok |
| E5 | After the remark, the score (X) or both are cleared, Z writes A2's and the next Z restores A1's original | qc-swap › failsafe... › restores Annotator 1's original on the second Z when ... [3 rows] | ok |
| E6 | A2's preserved remark is written even after it was cleared on A2's tab | qc-swap › failsafe... › still writes Annotator 2's preserved remark after it was cleared on its own tab | ok |
| E7 | A remark that loads after the scrape is recorded as A1's original | qc-swap › failsafe... › records a remark that loads after the scrape as Annotator 1's original | ok |
| E8 | A previous row's leftover remark is replaced by the real one when the platform corrects it | qc-swap › failsafe... › replaces the previous row's leftover remark... | ok |
| E9 | The pair is no longer corrected once the user has flipped a translation | qc-swap › failsafe... › stops correcting the pair once the user has flipped a translation | ok |
| E10 | The pair is not re-read after a score was changed by hand | qc-swap › failsafe... › does not re-read the pair after a score was changed by hand | ok |
| E11 | The badge's hover title shows the whole hand-edited text | qc-swap › failsafe... › shows the whole hand-edited text on hover when the badge shortens it | ok |
| E12 | A hand-edited remark is kept in the badge before Z overwrites it and is not part of the flip-flop | qc-swap › failsafe... › keeps a hand-edited remark in the badge before Z overwrites it | ok |
| E13 | A row change discards every pair and re-reads | qc-swap › failsafe... › discards every pair when the row changes | ok |
| E14 | Z is refused in the moment after a row change, before the re-read | qc-swap › rows changing under the pairs › refuses Z in the moment after the row changes... | ok |
| E15 | A row change during a read triggers another read | qc-swap › rows changing... › re-reads again when the row changes while a read is already in progress | ok |
| E16 | After a failed read, the next row change works again | qc-swap › rows changing... › works again after the next row change when a read could not finish | ok |
| E17 | The advance does not jump when the selection moved during the flip | qc-swap › rows changing... › does not move on to a different translation when the selection was moved during the flip | ok |
| E18 | Z on Annotator 2's tab writes nothing and does not advance | qc-swap › Z refusals › writes nothing and does not advance when Annotator 2's tab is active | ok |
| E19 | Z when A2 has no score writes nothing and does not advance | qc-swap › Z refusals › writes nothing and does not advance when Annotator 2 has no score | ok |
| E20 | Z when both agree writes nothing, does not advance, says "matches" | qc-swap › Z refusals › writes nothing and does not advance when both annotators agree | ok |
| E21 | Z advances to the next scoreable translation, skipping the empty Trans3 | qc-swap › Z auto-advance › moves the selection to the next scoreable translation and skips the empty Trans3 | ok (also incidental in E5) |
| E22 | Z on the last translation stays there | qc-swap › Z auto-advance › stays on the last translation when it is the one swapped | ok |
| E23 | The 3-Points warning shows while a 3 Points translation has a remark, hides for whitespace | qc-swap › 3 Points must have no remark › warns while a 3 Points translation holds a remark... | ok |
| E24 | The warning appears after Z writes a remark onto 3 Points and clears on flip back | qc-swap › 3 Points must have no remark › warns after Z writes Annotator 2's remark onto a 3 Points score... | ok |
| E25 | No warning for a remark on a score below 3 Points | qc-swap › 3 Points must have no remark › does not warn for a remark on a translation scored below 3 Points | ok |
| E26 | A second Z while the first write is in flight is dropped | qc-swap › Z guards and mouse › ignores a second Z that arrives while the first write is still in flight | ok |
| E27 | The badge buttons flip like Z but do not move the selection | qc-swap › Z guards and mouse › flips with the badge buttons the same as Z but does not move the selection | ok |

## F. QC Compare: shortcuts

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| F1 | `3` / `C` set the score, close the menu, report status, do not advance | qc-compare › score keys › sets ... when ... is pressed [2 rows] | ok |
| F2 | `X` clears only the selected score and does not advance | qc-compare › score keys › clears the selected translation's score when X is pressed | ok |
| F3 | `2` opens the label menu without advancing | qc-compare › label menu › opens the label menu without advancing when 2 is pressed | ok |
| F4 | A digit with the menu open picks `2 Points / <label>`, closes the menu, does not advance | qc-compare › label menu › picks label "..." when N is pressed with the menu open [3 rows: 4, 2, 3] | ok |
| F5 | Escape with the menu open cancels and keeps bare 2 Points | qc-compare › label menu › closes the menu and keeps bare 2 Points when Escape is pressed... | ok |
| F6 | `O` toggles the QC help and keeps the setting across a reload | qc-compare › help toggle › toggles the help panel and keeps the setting across a reload when O is pressed | ok |
| F7 | Every QC shortcut is ignored while a remark textarea has focus or a modifier is held | qc-compare › guards › ignores every shortcut when a remark textarea has focus or a modifier is held | ok |
| F8 | QC label key `1` (category drill-in) and `0` | none (annotation twins A11, A12 exist) | GAP |

## G. Release markers and layout

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| G1 | `@version`, `TL.SCRIPT_VERSION` and the panel head agree on 1.5.3 | release-smoke › version markers agree on 1.5.3 | ok (H7 checks only that a version is set) |
| G2 | The legend lists Q, O, Z, Enter, Esc with their labels, Q before O, no help paragraph, no stale phrases | release-smoke › legend lists the remark and checker keys, Q before O, with no help paragraph | ok |
| G3 | The Remark Options popover has no static help text; the hint is empty | release-smoke › Remark Options popover carries no static help text | ok |
| G4 | The check badge hugs the header's right while resizing; the close button stays inside | release-smoke › check badge hugs the right of the Remark Options header while resizing | ok |
| G5 | Default viewport: legend inside the panel, panel and status inside the viewport (+ screenshots) | release-smoke › legend fits inside the panel and the viewport; screenshots | viewport table (T6.4) |
| G6 | Narrow panel stays inside the viewport and the legend wraps or the panel scrolls | release-smoke › narrow panel stays inside the viewport and the legend wraps | viewport table (T6.4) |
| G7 | A short viewport caps the panel and makes it scroll | release-smoke › a short viewport caps the panel and makes it scroll | viewport table (T6.4) |

## H. Contracts (selectors and fixtures)

| ID | Behavior | Owner(s) | Status |
|---|---|---|---|
| H1 | The selector contract holds on the annotation fixture | capture-contract › selector contract holds for reduced fixture (tests/fixtures/annotation.html) | ok |
| H2 | The selector contract holds on the QC fixture | capture-contract › selector contract holds for reduced QC fixture (tests/fixtures/quality_compare.html) | ok |
| H3 | The selector contract holds on every local capture | capture-contract › selector contract holds for capture <name> (one per local capture; 0 here) | ok |
| H4 | Contract ids are unique and each line explains itself | capture-contract › contract ids are unique and every line explains itself | ok |
| H5 | Fixture: seven translations, only Trans3 empty, six distinct texts | harness › boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel | split (T6.4) |
| H6 | Fixture: Trans2 starts as a closed bare 2 Points with a visible clear control | harness › (same test) | split (T6.4) |
| H7 | Booting the modules shows the scoring panel and sets `TL.SCRIPT_VERSION` | harness › (same test) | split (T6.4) |

## Merge plan (T6.3)

1. **Group 1, one-shot jump (C5 to C10, C25):** one table over the action that consumes the jump. C11 and C12 stay
   their own tests. C8's mirroring half joins C25 (reverse sync); C9's selection half (C45) becomes its own test.
2. **Group 2, native caret keys (C13 to C15):** one test over `#rmd-edit` and a NOVA Remarks textarea.
3. **C30:** the standalone two-translation refusal is removed; the table row covers the identical range with more assertions.
4. **QC Q1 (D5 to D7):** the two arrow tests and the two outline tests become one step table.
5. **QC Q2 (D9):** the two Score-host re-render tests become one.
6. **B2, B4, B6:** candidates; merge only if the gate table can absorb the exact assertions (decided in T6.3).
7. **Not merged:** A4 (assertion-level), C26 and D2 (different inputs or subjects), A1/A2 vs A20 (module wiring vs unit).

## Before/After (T6.5)

The tables above keep the pre-T6.4 file names and titles, so they can be read against the baseline. T6.4 renamed
titles to `<behavior> when <condition>` (every rename is in the T6.4 commit) and moved groups as shown at the end.

| Step | Commit | Tests | Files |
|---|---|---|---|
| Baseline (`62aa500`) | | **196** (197 with one local capture) | 9 |
| T6.1 behavior map | `2e63419` | 196 | 9 |
| T6.2 shared helpers + page-error guard | `eb44912` | 196 | 9 |
| T6.3 merges | `c80dc5b` | 190 | 9 |
| T6.4 split, rename, tag | `3377cee` | **192** (193 with one local capture) | 12 |

Every behavior in sections A to H still has at least one owner. Tags: `@logic` 177, `@contract` 8, `@layout` 7; every
test has exactly one, and `npx playwright test --grep @logic` runs 177.

### Merges: old tests -> new test

| # | Old tests (baseline titles) | New test (final title) | Count |
|---|---|---|---|
| 1 | ArrowDown first clears the one-shot jump; a column toggle also clears the one-shot jump; click from composer focus then Up proceeds from clicked target; direct paste-like input switches target, mirrors multiline text and consumes first Up; same-target clicks preserve textarea selection and consume the special Up jump; unchanged native input consumes first Up but composer feedback does not | `the next ArrowUp steps one translation instead of jumping to Trans1 when ...` [6 rows: ArrowDown, column toggle, click on another Remarks, click on the targeted Remarks, direct input, unchanged native input] + `the first ArrowUp still jumps to Trans1 when the composer wrote into the target's Remarks` + `a click on the already-targeted Remarks module keeps the text selected in its textarea`; the multiline/quote mirror moved into `a page-side edit is mirrored into #rmd-edit and selects its translation when the composer is open` (was "reverse sync") | 6 -> 8 |
| 2 | arrows inside #rmd-edit keep native caret behavior...; arrows inside the NOVA Remarks textarea keep native behavior; real textarea click preserves focus, caret, native arrows and live typing | `arrow keys move the caret and leave the target when focus is in #rmd-edit or a NOVA Remarks textarea` (one `test.step` per textarea) | 3 -> 1 |
| 3 | a selection spanning two translations is rejected and writes nothing | removed: the row `Q refuses and writes nothing when the selection is from Trans4 into Trans5` selects the identical range and asserts more | 1 -> 0 |
| 4 | moves the selection down and skips the empty Trans3...; toggles between columns...; outlines the Score and the Remarks of the same translation...; moves both outlines together... | `the Score and Remarks outlines move together to each translation the arrow keys select` (8 labelled steps) | 4 -> 1 |
| 5 | restores the selection outline when the score host is re-rendered; restores both outlines when the platform replaces the Score host | `restores both outlines and keeps one badge when the platform replaces the Score host` | 2 -> 1 |
| 6 | Check Off › Enter is untouched and nothing is submitted | removed: Off returns before the row is read, and the six `remark gate › off mode` rows assert the same three facts | 1 -> 0 |
| 7 | harness: boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel | split into three `annotation fixture` tests (not a merge) | 1 -> 3 |

Not merged, because equal coverage could not be proven: B2/B4 (the complete-row checks score by keyboard, which leaves
scoring-module state the gate table's DOM-set rows never create), D2 (one remark empty vs both non-empty), C26 (Clear
after a mouse-selected target is one step of a wider test), A4 (one assertion inside a wider test), A1/A2 vs A20
(module wiring vs the cursor unit).

### Mutation checks (src/ broken temporarily, restored before every commit)

| Merge | What was broken | What failed |
|---|---|---|
| 1 | ArrowDown keeps the jump pending | only row "ArrowDown was pressed first" |
| 1 | ArrowLeft/Right keep the jump pending | only row "a column toggle was used first" |
| 1 | a click on the already-targeted Remarks keeps the jump | only row "the already-targeted Remarks was clicked" |
| 1 | a click on another Remarks keeps the jump | only row "another translation's Remarks was clicked while #rmd-edit had focus" |
| 1 | an unchanged native input keeps the jump | only row "a native input left the target's Remarks unchanged" |
| 1 | direct input on another translation keeps the jump | only row "direct input changed another translation's Remarks" |
| 1 | composer feedback spends the jump (`writingTarget` guard dropped) | only "the first ArrowUp still jumps to Trans1 when the composer wrote..." |
| 1 | the mirror keeps only the first line | only the reverse-sync test |
| 1 | a same-target click moves the textarea caret to the end | only the kept-selection test |
| 2 | arrows in `#rmd-edit` move the target | step "in #rmd-edit" (`#rmd-edit: ArrowLeft`) |
| 2 | arrows in a NOVA Remarks textarea move the target | step "in a NOVA Remarks textarea" (`NOVA textarea: ArrowLeft`) |
| 3 | a selection over two sources is accepted | row "Trans4 to Trans5" (plus Note+Trans1, Context-EN+Trans1) |
| 4 | the Remarks outline is never added | step "at boot Trans1 is selected" (plus the two re-render tests) |
| 4 | QC navigation includes the empty Trans3 | step "ArrowDown skips the empty Trans3" (plus the tab round trip) |
| 5 | re-renders never repaint the outline after the first paint | the merged Score-host test (plus the Remarks re-render and no-outline tests) |
| 5 | the badge element is cached per module | only the merged Score-host test (its one-badge assertion came from the removed arrows test) |
| 6 | Off mode blocks an incomplete row | only `off mode › ignores a missing label with a remark present` |

### Where the groups moved (T6.4)

| Baseline file › group | Now |
|---|---|
| remark-targets › initial target, arrow movement, highlight, row change and re-render while open | remark-target-selection.spec.js (same groups) |
| remark-targets › writes, quoting (incl. separators), escape, likely-remark summary | remark-writes.spec.js (same groups) |
| remark-targets › mouse selection and direct editing | remark-mouse.spec.js |
| qc-compare › smoke | qc-navigation.spec.js › starting on a QC page |
| qc-compare › arrows (tab round trip left after the merge) | qc-navigation.spec.js › tab round trip |
| qc-compare › selector spans Score and Remark | qc-navigation.spec.js (same group) |
| qc-compare › score keys, label menu, help toggle, guards | qc-shortcuts.spec.js (same groups) |
| qc-swap › Z swaps › counts a remark-only difference as still to reconcile | qc-swap.spec.js › reconcile summary |
| release-smoke (no groups) | release markers / legend content / panel layout (the three viewport tests are one table) |
| harness (first test) | harness › annotation fixture (three tests, plus Utils.clickEl) |
