// ==UserScript==
// @name         Annotation Scoring Shortcuts
// @namespace    translation-tool-injection
// @version      1.5.6
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
 * v1.5.6 follows NOVA's new Confusing sub-labels: C now opens a label pick
 * like 2 does (on both pages) and only advances on a true leaf, and "Likely
 * need remarks" flags only Confusing / Other / open feedback. X clears the
 * active score and advances (or cancels a label pick, like Esc), and Enter
 * submits on QC Compare through the same gate as Submit Check.
 *
 * v1.5.5 fixes QC Compare re-rendering forever while idle, and makes the script
 * ignore its own writes (one shared observer helper replaces three copies).
 * The Remark Options header now stays pinned in the corner at every width and
 * extra window height goes to the edit box. Label-pick badges no longer
 * redraw every frame, Q twice on the same selection no longer duplicates the
 * quote, and a chip after a quote now joins with a comma (the colon is gone).
 * QC Compare's panel is pulled back on-screen on load and resize. W/A/S/D now
 * work as arrow-key aliases on every page where the arrows already do.
 *
 * v1.5.4 fixes the Remark Options window opening cut off or off-screen. A
 * remembered position or size (for example saved on a larger screen, at
 * another zoom level, or with DevTools docked) is now fitted into the visible
 * window when it opens and when the browser window is resized, without
 * overwriting what was saved. If the page removes the window while it is open,
 * the re-created one is shown again with its size, position, target, and text
 * instead of staying hidden while the composer still has the keyboard.
 *
 * Full history: README.md → Version history
 */

(function () {
  'use strict';

  // Single source of truth for every module's version badge — set before
  // any module is instantiated, since each module now reads TL.SCRIPT_VERSION
  // from a separate file instead of a shared closure variable.
  window.TL = window.TL || {};
  TL.SCRIPT_VERSION = 'v1.5.6';

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
