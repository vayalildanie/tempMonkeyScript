// ==UserScript==
// @name         Annotation Scoring Shortcuts
// @namespace    translation-tool-injection
// @version      1.4.1
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
  TL.SCRIPT_VERSION = 'v1.4.1';

  const scoringShortcuts = TL.ScoringShortcuts(TL.Utils);
  const remarkComposer = TL.RemarkComposer(TL.Utils, scoringShortcuts);
  const qcCompare = TL.QCCompare(TL.Utils);

  function bootAll() {
    scoringShortcuts.start();
    remarkComposer.start();
    qcCompare.start();
  }

  if (document.body) bootAll();
  else window.addEventListener('DOMContentLoaded', bootAll);
})();
