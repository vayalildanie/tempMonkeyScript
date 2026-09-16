// ==UserScript==
// @name         Annotation Scoring Shortcuts
// @namespace    translation-tool-injection
// @version      1.4.7
// @description  Keyboard shortcuts to score and label the 7 translations on the annotation workbench
// @match        https://nova.xiaohongshu.com/model-studio/workspace/*
// @run-at       document-idle
// @grant        none
// @require      https://raw.githubusercontent.com/vayalildanie/tempMonkeyScript/main/src/utils.js
// @require      https://raw.githubusercontent.com/vayalildanie/tempMonkeyScript/main/src/trans-cursor.js
// @require      https://raw.githubusercontent.com/vayalildanie/tempMonkeyScript/main/src/scoring-shortcuts.js
// @require      https://raw.githubusercontent.com/vayalildanie/tempMonkeyScript/main/src/remark-composer.js
// @require      https://raw.githubusercontent.com/vayalildanie/tempMonkeyScript/main/src/qc-compare.js
// ==/UserScript==

/*
 * v1.4.7 widens Remark Composer's live "Trans N" highlight
 * (`highlightTransRefs` in src/remark-composer.js) to recognize a
 * comma/hyphen list after "Trans", not just a single number — "Trans 1, 2",
 * "Trans 0, 1", "Trans 1-3", and "Trans 1-3, 5" now highlight the same as a
 * lone "Trans 1" always did. Purely a display-overlay regex change, scoped
 * to Remark Composer only (no other module touched): it recognizes the
 * shape of a multi-translation reference so a hand-typed one reads visually
 * the same as a machine-inserted single-translation quote — it does not
 * parse or validate the numbers against which translations actually exist.
 *
 * v1.4.6 fixes `Q` always refusing with "Selection must stay inside a
 * single translation," even for a selection that plainly never left one.
 * `tryQuoteSelection`'s containment check walks every `[data-module-name]`
 * element the selection's Range intersects and bails the instant it sees a
 * SECOND intersecting element that parses to a Trans number at all — it
 * never checked whether that second element was actually a *different*
 * translation number. The platform can render more than one element
 * sharing the same `[data-module-name="TransN"]` for one translation
 * (every other reader of this attribute already defends against that by
 * taking only the first match via `querySelector` — see
 * Utils.transHasText and this file's own Trans1 fallback); a selection
 * touching two same-numbered duplicates tripped the same "ambiguous, bail"
 * path as a real cross-translation selection. Now only a genuinely
 * different number aborts it. See src/remark-composer.js's
 * `tryQuoteSelection` for the detail.
 *
 * v1.4.5 reuses v1.4.4's tag-stripping fix in Remark Composer's `Q` quote
 * flow (`tryQuoteSelection` in src/remark-composer.js): a text selection
 * that starts or ends at a translation's very edge could catch the
 * wrapping MT segment tag along with the real text, the same failure mode
 * the copy icons had. The raw `window.getSelection()` string is now run
 * through the same `Utils.stripAnnotationTags` before anything else — no
 * new stripping logic, just the one already proven against the copy-icon
 * fix. The three quote-logic defects documented in v1.4.1 (unescaped `"`
 * in the token, no double-quote guard, raw newlines in multi-line quotes)
 * are unrelated and still not fixed here.
 *
 * v1.4.4 fixes the platform's per-translation copy icons carrying raw
 * machine-translation segment tags (`<content1>`, `</content1>`, etc.) onto
 * the clipboard. Rather than hooking the icons themselves — unlabeled
 * `<img>`s with no stable selector — this patches
 * `navigator.clipboard.writeText` once at boot so any copy made through it
 * is run through `Utils.stripAnnotationTags` first, which strips tag-shaped
 * wrapping off the very start/end of the copied string and leaves the rest
 * alone. Page-wide (score page and quality page both), since it's a no-op
 * for text that has no such wrapping. See `Utils.stripAnnotationTags`'s own
 * comment in src/utils.js — the same helper is meant to be reused by the
 * quote feature later.
 *
 * v1.4.3 dedupes DOM/UI mechanics that had drifted into three separate
 * copies since the v1.4.0 split: panel drag-to-move and corner/edge resize
 * (Scoring Shortcuts' panel, Remark Composer's popover, QC Compare's
 * panel), the cascader-popup helpers (popupsVisible/edgeGap/
 * closeOpenCascaders, shared by Scoring Shortcuts and QC Compare), and the
 * `data-module-name` -> Trans-number parsing repeated in all three modules.
 * All moved into src/utils.js as shared *mechanism* — never shared *state*;
 * each panel still owns its own localStorage key and decides what shape to
 * persist via its own onDrop callback. No functional change intended,
 * except one explicit fix: Remark Composer's popover now also clamps into
 * the viewport while dragging (previously the only one of the three panels
 * that could be dragged fully off-screen). See utils.js's header comment.
 *
 * v1.4.0 split this file's three modules — Scoring Shortcuts, Remark
 * Composer, QC Compare — plus their shared helpers (Utils, TransCursor) out
 * into the `src/*.js` files @require'd above, so this file is now just the
 * boot sequence. See README.md for the full feature reference, shortcut
 * tables, ground rules, storage-key list, and version history (including
 * the pre-split history of every module, preserved there). Each src/*.js
 * file also keeps its own inline history going forward, at its own top.
 *
 * @require loads every module's code on every matching page unconditionally
 * — Tampermonkey has no code-splitting — so "which module is active on this
 * URL" is still decided at runtime, exactly as before the split: each
 * module's own start() checks location.href and bails out if it doesn't
 * apply (Scoring Shortcuts and Remark Composer on the score page, QC
 * Compare on /quality_ pages).
 *
 * This split also moved the submit-check system (Z cycles Label Check /
 * Submit Check / Check Off, Enter runs the check) from Scoring Shortcuts
 * into Remark Composer, and dropped Alt as a check trigger entirely — see
 * remark-composer.js's header comment. The "keep the Remarks field as tall
 * as its content" feature (v1.3.2) was also removed outright in this split;
 * the Remarks field is back to the platform's native small scrolling
 * textarea on both pages.
 *
 * Safety note (unchanged since the original): this script only "clicks for
 * you" — every action it takes is the same thing your mouse would do, and
 * every value it sets is visible on screen before you submit. It never
 * touches anything you didn't ask it to.
 *
 * One deliberate exception to that: the submit blocker *prevents* an action
 * rather than performing one. In Label Check and Check Off mode it only
 * ever suppresses the Enter keystroke — it never finds or clicks the submit
 * button — so pressing Space, or clicking Submit with the mouse, always
 * works, and Z cycles past the check entirely.
 *
 * A second deliberate exception: Submit Check mode *does* drive a
 * submission. On a clean check it synthesizes the same Space keypress your
 * own hand would send — but only after the identical label-completeness
 * check the other two modes use, and only as a direct, visible result of
 * your own Enter press. Never on a timer, never silently, and never in the
 * other two modes.
 */

(function () {
  'use strict';

  // Single source of truth for every module's version badge — set before
  // any module is instantiated, since each module now reads TL.SCRIPT_VERSION
  // from a separate file instead of a shared closure variable.
  window.TL = window.TL || {};
  TL.SCRIPT_VERSION = 'v1.4.7';

  const scoringShortcuts = TL.ScoringShortcuts(TL.Utils);
  const remarkComposer = TL.RemarkComposer(TL.Utils, scoringShortcuts);
  const qcCompare = TL.QCCompare(TL.Utils);

  function bootAll() {
    TL.Utils.installClipboardSanitizer();
    scoringShortcuts.start();
    remarkComposer.start();
    qcCompare.start();
  }

  if (document.body) bootAll();
  else window.addEventListener('DOMContentLoaded', bootAll);
})();
