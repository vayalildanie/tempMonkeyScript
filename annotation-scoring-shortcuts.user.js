// ==UserScript==
// @name         Annotation Scoring Shortcuts
// @namespace    translation-tool-injection
// @version      1.0.2
// @description  Keyboard shortcuts to score and label the 7 translations on the annotation workbench
// @match        https://nova.xiaohongshu.com/model-studio/workspace/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Clean rewrite in progress — see AGENTS.md in this repo for the full feature
 * reference, ground rules, and the incremental plan this file is following.
 *
 * Status: Phase 0 (shared utilities) and Phase 1 (Module 1: Scoring
 * Shortcuts) are complete. Phases 2-4 (Remark Composer, QC Compare,
 * Single-model Reference) have not been ported into this file yet — if you
 * need those features today, keep using the original v0.1.83 script until
 * they land here.
 *
 * Safety note (unchanged from the original): this script only "clicks for
 * you" — every action it takes is the same thing your mouse would do, and
 * every value it sets is visible on screen before you submit. It never
 * touches anything you didn't ask it to.
 */

(function () {
  'use strict';

  // ======================================================================
  // Shared utilities
  //
  // These are used by more than one module. In the original script each of
  // these was copy-pasted independently inside 2-3 of the 4 modules; here
  // they're written once. Nothing about *behavior* changes — call sites
  // still pass their own timeouts, still call these at the same points in
  // their logic, so each module's tuning stays exactly what it was.
  // ======================================================================
  const Utils = {
    // Dispatch a full, real-looking mouse event at an element's center.
    // NOVA's dropdowns are Ant Design components that listen for actual
    // mouse events, not synthetic .click() calls, so this simulates the
    // three events a real click produces, in order, at the coordinates a
    // real click would land at.
    fireMouse(el, type) {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, view: window,
        clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      }));
    },

    clickEl(el) {
      Utils.fireMouse(el, 'mousedown');
      Utils.fireMouse(el, 'mouseup');
      Utils.fireMouse(el, 'click');
    },

    // Poll a condition until it becomes truthy, or reject after `timeout`ms.
    // Used everywhere this script waits for the platform to finish
    // rendering something (a dropdown opening, a menu column appearing,
    // a value updating) before acting on it.
    waitFor(testFn, timeout = 1500) {
      return new Promise((resolve, reject) => {
        const t0 = performance.now();
        (function poll() {
          let r;
          try { r = testFn(); } catch (e) { r = null; }
          if (r) return resolve(r);
          if (performance.now() - t0 > timeout) return reject(new Error('Timed out waiting (等待超时)'));
          requestAnimationFrame(poll);
        })();
      });
    },

    // Write into a React/Ant "controlled" textarea. A plain `el.value = x`
    // is silently ignored by React-controlled inputs, because React's own
    // change-detection only sees changes made through the native property
    // setter it's tracking — so this calls that native setter directly
    // (bypassing whatever wrapper React put around `.value`), then
    // manually dispatches `input`/`change` so React reacts to it as if a
    // person had typed it.
    setNativeValue(el, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },

    // Does translation slot N actually have text? Empty slots should never
    // be scored, labeled, or otherwise acted on. The translation text lives
    // inside `.preview-content` under `[data-module-name="TransN"]` — the
    // "TransN" title text itself lives elsewhere in the same block, so this
    // can't accidentally match on the title.
    transHasText(n) {
      const textMod = document.querySelector(`[data-module-name="Trans${n}"]`);
      if (!textMod) return false;
      const content = textMod.querySelector('.preview-content');
      return !!content && content.textContent.trim().length > 0;
    },

    escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    },
  };

  // ======================================================================
  // MODULE 1: Scoring Shortcuts
  //
  // Lets an annotator score any of the 7 translations from the keyboard
  // instead of mousing into a dropdown for each one. See AGENTS.md §4.1
  // for the full plain-English explanation of every shortcut and the
  // reasoning behind the trickier parts of this module.
  // ======================================================================
  function ScoringShortcuts(Utils) {
    const TAG = '[Scoring Shortcuts / 打分快捷键]';
    const VERSION = 'v1.0.2'; // Shown in the panel badge so you can confirm you're running the latest version.
    // false for annotators (quiet console); flip to true only while debugging.
    const DEBUG = false;
    function log(msg) { if (DEBUG) console.log(`${TAG} ${msg}`); }

    // ---------- Configuration (edit here to change keys/colors) ----------
    const CFG = {
      keyScore3: '3',
      keyScore2: '2',
      keyConfusing: 'c', // case-insensitive
      keyErase: 'z',        // clear the active translation's score; stays on the same translation
      keyToggleWindow: 'p', // show/hide the whole shortcuts panel
      pathKey3: '3 Points',            // the platform's data-path-key for the "3 Points" option
      pathKey2: '2 Points',
      pathKeyConfusing: 'Confusing',
      highlightColor: '#3b5bdb',              // panel accent (blue)
      highlightBorder: '#f0a500',             // active-translation highlight border (amber)
      highlightBg: 'rgba(255, 221, 87, .30)', // active-translation highlight fill (pale yellow)
      advanceOn2: false, // don't auto-advance after "2 Points" — a label still needs picking
    };

    // ---------- Runtime state ----------
    let enabled = true;       // master on/off switch for the shortcuts
    let activeIdx = 0;        // index of the currently-active translation (0 = Trans1)
    let lastRowSig = '';      // fingerprint of the previous row's source text, to detect a row change
    let queue = [];           // pending score requests, strictly in the order keys were pressed
    let processing = false;   // true while the queue is being drained, so it's never processed concurrently
    let labelMode = false;    // true while a "2 Points" label pick is in progress
    let labelBusy = false;    // guards against double-firing while a label click is mid-flight
    let labelBadgeRAF = null; // handle for the loop that keeps the label menu's number badges in sync
    // Remembers the last active translation within each column (1-3 / 4-7),
    // so ←/→ returns you to where you left off in the other column instead
    // of jumping to a fixed mirrored slot. Persists across rows on purpose —
    // if you habitually check e.g. Trans6 first, ← / → keeps landing there.
    let lastColLeft = null;
    let lastColRight = null;

    // ====================================================================
    // Reading the page
    // ====================================================================

    // Every visible (not display:none) cascader dropdown currently open anywhere on the page.
    function popupsVisible() {
      return Array.from(document.querySelectorAll('.ant-select-dropdown'))
        .filter((p) => getComputedStyle(p).display !== 'none');
    }

    // Find a menu item by its data-path-key, but only within one specific popup —
    // never search across popups, or a click could land in the wrong translation's menu.
    function findItemInPopup(popup, pathKey) {
      if (!popup) return null;
      for (const li of popup.querySelectorAll('li.ant-cascader-menu-item')) {
        if (li.getAttribute('data-path-key') === pathKey) return li;
      }
      return null;
    }

    // Which translation number a given scoring control belongs to, read off
    // its own data-module-name (e.g. "Trans3 Score" -> 3).
    function transNumberOf(mod) {
      const m = /^Trans(\d+) Score$/.exec(mod.getAttribute('data-module-name') || '');
      return m ? parseInt(m[1], 10) : null;
    }

    // Every scoreable translation's scoring control, in Trans-number order,
    // skipping any translation whose text is empty (nothing to score).
    function getScoreModules() {
      const map = {};
      document.querySelectorAll('.ant-select-selector').forEach((sel) => {
        const mod = sel.closest('[data-module-name]');
        if (!mod) return;
        const n = transNumberOf(mod);
        if (n === null) return;
        if (!Utils.transHasText(n)) return; // skip empty translations — never enter the scoring queue
        if (!map[n]) map[n] = mod; // if nested duplicates share a name, keep the first one found
      });
      return Object.keys(map).map(Number).sort((a, b) => a - b).map((n) => map[n]);
    }

    // Translation numbers on this row that have a scoring control but no
    // text — i.e. the ones getScoreModules() is deliberately skipping.
    // Shown in the panel so it's clear why a "missing" translation was skipped.
    function getSkippedTransNumbers() {
      const all = new Set();
      document.querySelectorAll('.ant-select-selector').forEach((sel) => {
        const mod = sel.closest('[data-module-name]');
        const n = mod ? transNumberOf(mod) : null;
        if (n !== null) all.add(n);
      });
      const scoreable = new Set(getScoreModules().map(transNumberOf));
      return Array.from(all).filter((n) => !scoreable.has(n)).sort((a, b) => a - b);
    }

    // The text currently selected/shown in a given scoring control.
    function readSelected(mod) {
      const item = mod.querySelector('.ant-select-selection-item');
      return item ? item.textContent.trim() : '';
    }

    // A fingerprint for "which row am I on" — the source text is always
    // present and different per row, so a change in it means the page has
    // navigated to a new row and per-row state (activeIdx, etc.) should reset.
    function getRowSig() {
      const src = document.querySelector('[data-module-key="NoteTrans"]')
        || document.querySelector('[data-module-name="Trans1"]');
      return src ? src.textContent.trim().slice(0, 80) : '';
    }

    // ====================================================================
    // Highlighting the active translation
    // ====================================================================

    function injectStyle() {
      if (document.getElementById('tl-score-style')) return;
      const s = document.createElement('style');
      s.id = 'tl-score-style';
      s.textContent = `
        .tl-active-score {
          /* Drawn inset, not as an outer border, so it never gets clipped by a
             parent container with overflow:hidden (向内画边框,不外扩,不会被裁). */
          box-shadow: inset 0 0 0 2px ${CFG.highlightBorder} !important;
          border-radius: 10px !important;
          background: ${CFG.highlightBg} !important;
          transition: background .15s;
        }
        /* Number badges injected into the label menu (see label-mode section below). */
        .tl-num-badge {
          display: inline-block; min-width: 16px; height: 16px; line-height: 16px;
          text-align: center; padding: 0 3px; margin-right: 8px; vertical-align: middle;
          background: #ffe066; color: #664d00; font-weight: 700; font-size: 11px; border-radius: 4px;
        }
        /* Renders a key name in the panel like a physical keycap. */
        .tl-kbd {
          display: inline-block; min-width: 18px; padding: 1px 5px; margin-right: 5px;
          font: 600 11px/1.4 ui-monospace, Menlo, Consolas, monospace; text-align: center;
          color: #1f2430; background: #fff; border: 1px solid #c2c6d0; border-bottom-width: 2px;
          border-radius: 4px; box-shadow: 0 1px 0 rgba(0,0,0,.04); vertical-align: middle;
        }
        /* Right-edge resize grip on the shortcuts panel — width only, shrink-only
           (see makeResizable). Height is deliberately never set explicitly: it
           always auto-fits its content, so narrowing the panel (which wraps the
           shortcut legend onto more lines) grows the panel taller automatically
           instead of clipping the status/skipped-translations row underneath. */
        .tl-resize-handle {
          position: absolute; top: 0; right: 0; bottom: 0; width: 8px;
          cursor: ew-resize;
          background: repeating-linear-gradient(to bottom, transparent 0 4px, #c2c6d0 4px 5px);
          background-position: center;
          background-repeat: repeat-y;
          background-size: 2px 8px;
        }`;
      document.head.appendChild(s);
    }

    function applyHighlight() {
      document.querySelectorAll('.tl-active-score').forEach((el) => el.classList.remove('tl-active-score'));
      if (!enabled) return;
      const mods = getScoreModules();
      if (!mods.length) return;
      if (activeIdx >= mods.length) activeIdx = mods.length - 1;
      if (activeIdx < 0) activeIdx = 0;
      const mod = mods[activeIdx];
      // Highlight the whole "TransX Score" block (title + dropdown), not just the dropdown itself.
      const target = mod.querySelector('.cascade-container') || mod;
      target.classList.add('tl-active-score');
      // Remember which column this translation belongs to, for ←/→ (see jumpColumn).
      const num = transNumberOf(mod);
      if (num !== null) { if (num <= 3) lastColLeft = num; else lastColRight = num; }
      return mod;
    }

    function scrollActiveIntoView() {
      const mods = getScoreModules();
      const mod = mods[activeIdx];
      if (mod) mod.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }

    // ====================================================================
    // Setting a score programmatically
    // ====================================================================

    // Close every cascader dropdown that's currently open (detected via
    // aria-expanded="true"), by clicking its own trigger to collapse it.
    // This prevents stale/leftover open dropdowns from re-appearing
    // alongside the one we're about to drive, or from confusing the
    // "which popup belongs to my selector" check in findItemNearSelector.
    async function closeOpenCascaders() {
      const opens = Array.from(document.querySelectorAll('input[aria-expanded="true"]'));
      for (const inp of opens) {
        const sel = inp.closest('.ant-select');
        if (sel) Utils.clickEl(sel.querySelector('.ant-select-selector') || sel);
      }
      if (opens.length) {
        await Utils.waitFor(() => document.querySelectorAll('input[aria-expanded="true"]').length === 0, 700).catch(() => {});
      }
    }

    // Distance between a popup's near edge and its trigger's near edge.
    // A dropdown always renders flush against its own trigger (just a few
    // pixels of gap), so this distance is a reliable signal for "does this
    // popup belong to this exact selector" — see findItemNearSelector.
    function edgeGap(popup, sr) {
      const pr = popup.getBoundingClientRect();
      if ((popup.className || '').indexOf('placement-top') >= 0) return Math.abs(pr.bottom - sr.top);
      return Math.abs(pr.top - sr.bottom);
    }

    // Only trust a popup that renders adjacent to (within this many px of)
    // the selector we just clicked. Same-column rows on other translations
    // sit much farther away than this, so the threshold reliably tells
    // "this control's own dropdown" apart from "some other translation's
    // dropdown that happened to reappear."
    const ADJACENT_GAP_PX = 100;

    // Find the target menu item, but only inside a popup adjacent to
    // `selector`. If the only match right now is a distant popup (e.g. a
    // previous translation's dropdown that the platform re-opened on its
    // own), return null and let the caller keep waiting rather than click
    // into the wrong translation's menu.
    function findItemNearSelector(selector, pathKey) {
      const sr = selector.getBoundingClientRect();
      let best = null, bestGap = Infinity;
      for (const p of popupsVisible()) {
        const li = findItemInPopup(p, pathKey);
        if (!li) continue;
        const gap = edgeGap(p, sr);
        if (gap > ADJACENT_GAP_PX) continue; // not flush against this selector — skip, don't guess
        if (gap < bestGap) { bestGap = gap; best = li; }
      }
      return best;
    }

    async function setScore(mod, pathKey, leaveOpen) {
      await closeOpenCascaders(); // collapse every other open cascader first

      // Root-cause fix: blur whatever element still holds keyboard focus.
      // If a previously-focused cascader is left focused (even while
      // visually closed), the platform re-opens it alongside this one when
      // this one opens — that's the real cause of "a previous dropdown
      // flashes open" (上一个下拉闪现的真正原因是:上一个级联还聚焦着).
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }

      const selector = mod.querySelector('.ant-select-selector') || mod.querySelector('.ant-select');
      const input = mod.querySelector('input');
      if (!selector) throw new Error('Scoring dropdown not found (没找到下拉选择框)');

      Utils.clickEl(selector); // open this control — its dropdown appears normally, visible to the user
      await Utils.waitFor(() => input && input.getAttribute('aria-expanded') === 'true', 1200);
      // Wait for the platform to build the menu, then pick the item from the popup adjacent to this selector.
      const li = await Utils.waitFor(() => findItemNearSelector(selector, pathKey), 1500);
      Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);
      // Give the platform a moment to accept the click (value appears, or the control collapses).
      await Utils.waitFor(() => readSelected(mod).indexOf(pathKey) >= 0
        || (input && input.getAttribute('aria-expanded') !== 'true'), 1000).catch(() => {});

      // After a leaf value (3 Points / Confusing): collapse and blur, so
      // this control doesn't carry leftover focus into the next operation
      // (the same root cause fixed above, avoided proactively here too).
      if (!leaveOpen) {
        if (input && input.getAttribute('aria-expanded') === 'true') {
          Utils.clickEl(selector);
          await Utils.waitFor(() => input.getAttribute('aria-expanded') !== 'true', 400).catch(() => {});
        }
        if (input && typeof input.blur === 'function') input.blur();
      }
    }

    // Move the active-translation cursor.
    function move(delta) {
      const mods = getScoreModules();
      if (!mods.length) return;
      activeIdx = Math.max(0, Math.min(mods.length - 1, activeIdx + delta));
      applyHighlight();
      scrollActiveIntoView();
      setStatus(`Current: Trans${transNumberOf(mods[activeIdx]) || activeIdx + 1}`);
    }

    // Jump sideways to the other column: Trans1-3 are the left column,
    // Trans4-7 are the right column. Both ← and → do the same thing —
    // always toggle to the other column, direction doesn't matter. Rather
    // than landing on a fixed mirrored slot, this returns you to wherever
    // you last were in that column (lastColLeft/lastColRight, updated by
    // applyHighlight on every move); the first time you ever jump into a
    // column, it lands on the first scoreable translation there. If neither
    // the remembered nor the fallback translation is currently scoreable
    // (missing or empty), this does nothing rather than guess.
    function jumpColumn() {
      const mods = getScoreModules();
      if (!mods.length) return;
      const curNum = transNumberOf(mods[activeIdx]);
      if (curNum === null) return;
      const goingRight = curNum <= 3;
      const inTargetColumn = goingRight ? (n) => n >= 4 : (n) => n <= 3;
      const remembered = goingRight ? lastColRight : lastColLeft;
      let targetNum = remembered !== null && inTargetColumn(remembered) ? remembered : null;
      if (targetNum === null) {
        const firstAvailable = mods.map(transNumberOf).find(inTargetColumn);
        if (firstAvailable === undefined) return; // nothing scoreable in the other column
        targetNum = firstAvailable;
      }
      const targetIdx = mods.findIndex((m) => transNumberOf(m) === targetNum);
      if (targetIdx === -1) return; // target translation isn't scoreable right now — stay put
      activeIdx = targetIdx;
      applyHighlight();
      scrollActiveIntoView();
      setStatus(`Current: Trans${targetNum}`);
    }

    // Queue a score request (in key-press order) and kick off processing.
    function enqueueScore(pathKey, label, advance) {
      queue.push({ kind: 'set', pathKey, label, advance });
      pump();
    }

    // Queue a request to clear the active translation's score. Goes through
    // the same queue as scoring requests, so a Z press can never race a
    // 3/C/2 press into acting on the wrong translation.
    function enqueueErase() {
      queue.push({ kind: 'erase' });
      pump();
    }

    // Drain the queue one request at a time. The next request only starts
    // once the previous one has fully finished (including read-back
    // verification and advancing), so rapid key presses can never race
    // each other into applying to the wrong translation.
    async function pump() {
      if (processing) return;
      processing = true;
      try {
        while (queue.length) {
          await applyOne(queue.shift());
        }
      } finally {
        processing = false;
      }
    }

    // Click the active translation's own "clear" control (the small × Ant
    // Design renders on a filled cascader) and blur/collapse afterwards —
    // same leftover-focus precaution as setScore, since this drives the
    // same kind of control.
    async function eraseActive(mod) {
      await closeOpenCascaders();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
      const clearBtn = mod.querySelector('.ant-select-clear');
      if (!clearBtn) return; // nothing rendered to click — already empty
      Utils.clickEl(clearBtn);
      await Utils.waitFor(() => readSelected(mod).length === 0, 800).catch(() => {});
    }

    // Apply a single request from the queue — either "set this score" or
    // "erase this score" — read the value back to confirm it actually
    // took, and only then update the UI. If the read-back doesn't match
    // what was requested, stop and surface the mismatch — never keep going
    // as if it had worked.
    async function applyOne(req) {
      const mods = getScoreModules();
      if (!mods.length) { setStatus('No scoring control found'); return; }
      if (activeIdx >= mods.length) activeIdx = mods.length - 1;
      if (activeIdx < 0) activeIdx = 0;

      const idx = activeIdx;
      const mod = mods[idx];
      const name = mod.getAttribute('data-module-name') || `#${idx + 1}`;
      const num = transNumberOf(mod) || idx + 1; // the real Trans number, correct even when earlier slots were skipped

      if (req.kind === 'erase') {
        const before = readSelected(mod);
        if (!before) { setStatus(`Trans${num} already empty`); return; }
        setStatus(`Clearing Trans${num}…`);
        try {
          await eraseActive(mod);
        } catch (e) {
          console.error(`${TAG} [${name}] Failed to clear score:`, e);
          setStatus(`Trans${num} clear failed: ${e.message} (stopped)`);
          queue.length = 0;
          return;
        }
        const got = readSelected(mod);
        if (got) {
          setStatus(`⚠️ Trans${num} still shows "${got}" — clear failed`);
          queue.length = 0;
          return;
        }
        // Stays on the same translation — clearing is a "let me redo this
        // one" action, not a reason to move on.
        if (labelMode) exitLabelMode();
        applyHighlight();
        setStatus(`Trans${num} cleared`);
        return;
      }

      setStatus(`Setting Trans${num} = ${req.label}…`);

      try {
        await setScore(mod, req.pathKey, !req.advance); // "2 Points" leaves the dropdown open for a label pick; everything else collapses it
      } catch (e) {
        console.error(`${TAG} [${name}] Failed to set score (设分失败):`, e);
        setStatus(`Trans${num} failed: ${e.message} (stopped)`);
        queue.length = 0; // stop on error and drop the rest of the queue, rather than risk cascading misalignment
        return;
      }

      // Wait for the displayed value to actually become what we asked for (up to 800ms), then read it back.
      await Utils.waitFor(() => readSelected(mod).indexOf(req.pathKey) >= 0, 800).catch(() => {});
      const got = readSelected(mod);
      const ok = got.indexOf(req.pathKey) >= 0;
      log(`Applied to [${name}] · expected "${req.pathKey}" · got "${got || 'empty'}" · ${ok ? 'OK ✓' : 'MISMATCH ✗'}`);

      if (!ok) {
        setStatus(`⚠️ Trans${num} shows "${got || 'empty'}", unexpected → stopped`);
        queue.length = 0; // never advance while carrying an unverified/wrong value
        return;
      }

      if (req.advance) {
        activeIdx = Math.min(mods.length - 1, idx + 1);
        applyHighlight();
        scrollActiveIntoView();
        const nextNum = transNumberOf(mods[activeIdx]) || activeIdx + 1;
        setStatus(idx === activeIdx ? `Trans${num} = ${got} ✓ (last)` : `Trans${num} = ${got} ✓ → Trans${nextNum}`);
      } else {
        // "2 Points": leave the menu open, enter label-pick mode, show the number badges.
        applyHighlight();
        labelMode = true;
        startLabelBadges();
        setStatus(`Trans${num} = ${got} ✓ — press a number to pick a label`);
      }
    }

    // ====================================================================
    // Label shortcuts (number keys pick a menu item; badges show which number is which)
    // ====================================================================

    function openLabelPopup() { return popupsVisible()[0] || null; }

    // Inject 1..n number badges onto the label columns (every column after
    // the first — the first column is the score column itself, which never
    // gets a badge) of every currently-visible popup.
    function renderLabelBadges() {
      for (const popup of popupsVisible()) {
        const cols = popup.querySelectorAll('ul.ant-cascader-menu');
        cols.forEach((ul, colIdx) => {
          ul.querySelectorAll('li.ant-cascader-menu-item').forEach((li, i) => {
            const content = li.querySelector('.ant-cascader-menu-item-content');
            if (!content) return;
            let badge = content.querySelector('.tl-num-badge');
            const want = colIdx >= 1 && i < 10; // label 1-9, and the 10th item as "0"
            if (want) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tl-num-badge';
                content.insertBefore(badge, content.firstChild);
              }
              badge.textContent = i === 9 ? '0' : String(i + 1);
            } else if (badge) {
              badge.remove();
            }
          });
        });
      }
    }
    function clearLabelBadges() {
      document.querySelectorAll('.tl-num-badge').forEach((b) => b.remove());
    }
    function startLabelBadges() {
      if (labelBadgeRAF) return;
      (function loop() {
        if (!labelMode) { labelBadgeRAF = null; clearLabelBadges(); return; }
        renderLabelBadges();
        labelBadgeRAF = requestAnimationFrame(loop);
      })();
    }
    function exitLabelMode() {
      labelMode = false;
      clearLabelBadges();
      if (document.activeElement && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur(); // close whatever label menu was left open
      }
    }

    // Read back the chosen label, close the menu, and advance to the next scoreable translation.
    async function commitLabelAndAdvance(idx, list) {
      await Utils.waitFor(() => { const m = list[idx]; return m && readSelected(m).length > 0; }, 600).catch(() => {});
      const got = list[idx] ? readSelected(list[idx]) : '';
      labelMode = false;
      clearLabelBadges();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      await closeOpenCascaders(); // make sure the menu is actually closed
      const list2 = getScoreModules();
      activeIdx = Math.min(list2.length - 1, idx + 1);
      applyHighlight();
      scrollActiveIntoView();
      const nextNum = transNumberOf(list2[activeIdx]) || activeIdx + 1;
      setStatus(idx === activeIdx ? `Label set: ${got} ✓ (last)` : `Label set: ${got} ✓ → Trans${nextNum}`);
    }

    // Pick item N from the current rightmost (deepest) menu column. An item
    // with an expand arrow is a category (drill in further); one without is
    // a leaf label (commit it, close the menu, advance).
    async function pickLabelByNumber(n) {
      if (labelBusy) return;
      labelBusy = true;
      try {
        const popup = openLabelPopup();
        if (!popup) { exitLabelMode(); return; }
        const cols = popup.querySelectorAll('ul.ant-cascader-menu');
        if (cols.length < 2) { setStatus('Labels not open yet'); return; }
        const col = cols[cols.length - 1]; // rightmost = deepest column currently shown
        const li = col.querySelectorAll('li.ant-cascader-menu-item')[n - 1];
        if (!li) { setStatus(`No item #${n} here`); return; }

        // The decisive signal: an expand-arrow class means "category, can drill deeper";
        // its absence means "this is a leaf label."
        const isLeaf = !li.classList.contains('ant-cascader-menu-item-expand');
        const list = getScoreModules();
        const idx = activeIdx;
        const colsBefore = cols.length;

        Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);

        if (isLeaf) {
          // The platform doesn't auto-close the menu for a leaf pick, so we commit and advance ourselves.
          await commitLabelAndAdvance(idx, list);
          return;
        }

        // Category: drill in, wait for the next column to appear.
        await Utils.waitFor(() => {
          const p = openLabelPopup();
          return !!p && p.querySelectorAll('ul.ant-cascader-menu').length > colsBefore;
        }, 800).catch(() => {});

        // If drilling in reveals exactly one leaf sub-label, auto-pick it too
        // (the leaf still needs to be explicitly selected — e.g. to land on
        // "Grammar/Grammar" — so this isn't skippable), then commit + advance.
        const p2 = openLabelPopup();
        const newCols = p2 ? p2.querySelectorAll('ul.ant-cascader-menu') : [];
        const deepest = newCols[newCols.length - 1];
        const subItems = deepest ? deepest.querySelectorAll('li.ant-cascader-menu-item') : [];
        if (subItems.length === 1 && !subItems[0].classList.contains('ant-cascader-menu-item-expand')) {
          Utils.clickEl(subItems[0].querySelector('.ant-cascader-menu-item-content') || subItems[0]);
          await commitLabelAndAdvance(idx, list);
        } else {
          setStatus('Category selected — press a number for the sub-label');
        }
      } finally {
        labelBusy = false;
      }
    }

    // ====================================================================
    // Keyboard
    // ====================================================================

    // Is the user currently typing somewhere (Remarks/Rewrite, etc.)? If so,
    // number/letter keys must be left alone for typing, not intercepted.
    // Note: the cascader's own hidden search input is readonly, so it does
    // NOT count as "typing" here.
    function inTextEntry() {
      const el = document.activeElement;
      if (!el) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName === 'INPUT') {
        if (el.readOnly) return false;
        const t = (el.type || '').toLowerCase();
        return ['text', 'search', 'email', 'number', 'password', 'url', 'tel'].includes(t);
      }
      return false;
    }

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never touch modifier combos (the platform's own Ctrl+H, etc.)
      if (document.body.classList.contains('rmd-active')) return; // Remark Composer drawer open → keyboard is entirely its
      if (e.key === 'Escape') {
        // Esc only cancels an in-progress label pick — the master on/off switch is button-only, by design.
        if (labelMode) { e.preventDefault(); exitLabelMode(); setStatus('Label pick cancelled'); }
        return;
      }
      if (inTextEntry()) return; // typing in Remarks/Rewrite → letter/number keys are for typing, not shortcuts

      // Show/hide the whole panel. Deliberately checked before the enabled
      // gate below, same as Esc — you can always get the window back even
      // while shortcuts are turned OFF.
      if (e.key.toLowerCase() === CFG.keyToggleWindow) {
        e.preventDefault();
        setCollapsed(!collapsed);
        return;
      }

      if (!enabled) return;

      // Label-pick mode: number keys choose the Nth item in the rightmost column;
      // arrows exit label mode and move to another translation; anything else is ignored.
      if (labelMode) {
        if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pickLabelByNumber(e.key === '0' ? 10 : parseInt(e.key, 10)); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); exitLabelMode(); move(1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); exitLabelMode(); move(-1); return; }
        return;
      }

      // Normal scoring mode.
      const k = e.key.toLowerCase();
      if (k === CFG.keyScore3) {
        e.preventDefault();
        enqueueScore(CFG.pathKey3, '3 Points', true);
      } else if (k === CFG.keyConfusing) {
        e.preventDefault();
        enqueueScore(CFG.pathKeyConfusing, 'Confusing', true);
      } else if (k === CFG.keyErase) {
        e.preventDefault();
        enqueueErase();
      } else if (k === CFG.keyScore2) {
        e.preventDefault();
        enqueueScore(CFG.pathKey2, '2 Points', CFG.advanceOn2);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        jumpColumn();
      }
    }

    // ====================================================================
    // Status panel
    // ====================================================================

    let panelEl = null, statusEl = null, toggleBtn = null, skippedEl = null, pillEl = null;
    let collapsed = false;    // true while minimized to the bottom-left pill
    let naturalWidth = null;  // the panel's default width, measured once on first render — resize can shrink below this but never grow past it

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg; // shown to the annotator in the panel
      log(msg);                                 // echoed to console only when DEBUG is on
    }

    // Shows which translations on this row were skipped for having no text.
    function updateSkippedLine() {
      if (!skippedEl) return;
      const skipped = getSkippedTransNumbers();
      skippedEl.textContent = skipped.length
        ? `Skipped (empty): Trans ${skipped.join(', ')}`
        : 'No empty translations';
    }

    function setEnabled(on) {
      enabled = on;
      if (toggleBtn) {
        toggleBtn.textContent = on ? 'Shortcuts: ON' : 'Shortcuts: OFF';
        toggleBtn.style.background = on ? CFG.highlightColor : '#9aa0ac';
      }
      if (on) { applyHighlight(); setStatus(`ON · Trans${activeIdx + 1}`); }
      else { document.querySelectorAll('.tl-active-score').forEach((el) => el.classList.remove('tl-active-score')); setStatus('OFF'); }
    }

    // Show/hide the whole panel, shrinking to a pill in the bottom-left
    // (matching the Reference module's pattern) while hidden. Reachable via
    // the — button, the P key, or clicking the pill to restore.
    function setCollapsed(on) {
      collapsed = on;
      try { localStorage.setItem(SCORE_MIN_KEY, on ? '1' : '0'); } catch (e) {}
      if (panelEl) panelEl.style.display = on ? 'none' : '';
      if (pillEl) pillEl.style.display = on ? '' : 'none';
      if (!on && panelEl) clampIntoView(panelEl);
    }

    function injectPanel() {
      if (document.getElementById('tl-score-panel')) return;
      const p = document.createElement('div');
      p.id = 'tl-score-panel';
      p.style.cssText = [
        'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
        'background:#fff', 'border:1px solid #d9d9e3', 'border-radius:10px',
        'box-shadow:0 6px 24px rgba(0,0,0,.15)', 'padding:8px 14px', 'width:min(680px, 96vw)',
        'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', 'color:#1f2430',
        'box-sizing:border-box', 'overflow:auto',
      ].join(';');
      p.innerHTML = `
        <div id="tl-score-head" style="display:flex;align-items:center;gap:8px;cursor:move;user-select:none;margin-bottom:6px;">
          <span style="font-weight:600;white-space:nowrap;">⌨️ Scoring Shortcuts</span>
          <span style="font-size:11px;background:#ffe066;color:#664d00;padding:1px 7px;border-radius:6px;font-weight:700;">${VERSION}</span>
          <span style="flex:1;"></span>
          <button id="tl-score-toggle" style="
            padding:4px 12px;border:none;border-radius:7px;color:#fff;
            font-weight:600;cursor:pointer;white-space:nowrap;"></button>
          <button id="tl-score-min" title="Minimize to pill (收起到左下角)" style="
            padding:4px 10px;border:1px solid #dde1e6;background:#fff;color:#6b7280;border-radius:7px;
            font-weight:700;cursor:pointer;line-height:1;white-space:nowrap;">—</button>
        </div>
        <div id="tl-score-body" style="display:flex;flex-wrap:wrap;gap:7px 18px;align-items:center;color:#4b5563;font-size:12px;">
          <span style="white-space:nowrap;"><span class="tl-kbd">C</span> Confusing</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">Z</span> Erase score</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">3</span> 3 Points</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">2</span> 2 Points → label (<span class="tl-kbd">1</span>–<span class="tl-kbd">9</span> pick)</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">↑</span><span class="tl-kbd">↓</span> move trans</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">←</span><span class="tl-kbd">→</span> swap column</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">R</span> Remark composer</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">P</span> Show/hide window</span>
        </div>
        <div id="tl-score-statusrow" style="display:flex;gap:12px;align-items:baseline;border-top:1px solid #eee;margin-top:6px;padding-top:6px;">
          <span id="tl-score-status" style="font-size:12px;color:#3b5bdb;flex:1;min-height:16px;"></span>
          <span id="tl-score-skipped" style="font-size:11px;color:#9aa0ac;white-space:nowrap;"></span>
        </div>`;
      document.body.appendChild(p);
      panelEl = p;
      statusEl = p.querySelector('#tl-score-status');
      skippedEl = p.querySelector('#tl-score-skipped');
      toggleBtn = p.querySelector('#tl-score-toggle');
      toggleBtn.addEventListener('click', () => setEnabled(!enabled));

      // Measure the panel's natural (un-resized) width before anything can
      // override it — this becomes the resize handle's upper bound, so you
      // can shrink the window but never make it wider than its default.
      // Height is intentionally not measured/clamped — see the CSS comment
      // on .tl-resize-handle above.
      naturalWidth = p.getBoundingClientRect().width;

      // Resize grip, right edge — width-only, shrink-only (see makeResizable).
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'tl-resize-handle';
      resizeHandle.title = 'Drag to shrink';
      p.appendChild(resizeHandle);
      makeResizable(p, resizeHandle);
      applySavedSize(p);

      // Minimize: hide the whole panel, shrink to a pill in the bottom-left
      // (matching the Reference module's pattern); click the pill to restore.
      // State persisted to localStorage.
      const minBtn = p.querySelector('#tl-score-min');
      let pill = document.getElementById('tl-score-pill');
      if (!pill) {
        pill = document.createElement('button');
        pill.id = 'tl-score-pill';
        pill.textContent = '⌨️ Shortcuts';
        pill.title = 'Show shortcuts panel (展开打分面板)';
        pill.style.cssText = 'position:fixed;left:16px;bottom:58px;z-index:2147483647;'
          + 'font:12px/1 -apple-system,"Segoe UI",sans-serif;font-weight:700;cursor:pointer;'
          + 'border:1px solid #c5cae0;background:#eef1fb;color:#3b5bdb;border-radius:18px;'
          + 'padding:8px 13px;box-shadow:0 2px 10px rgba(0,0,0,.12);display:none';
        document.body.appendChild(pill);
      }
      pillEl = pill;
      minBtn.addEventListener('click', () => setCollapsed(true));
      pill.onclick = () => setCollapsed(false);
      setCollapsed(localStorage.getItem(SCORE_MIN_KEY) === '1');
      makePanelDraggable(p, p.querySelector('#tl-score-head'));
      applySavedPos(p);
      setEnabled(enabled);
      updateSkippedLine();
    }

    // —— Panel dragging, resizing, and position/size persistence (localStorage) ——
    const SCORE_POS_KEY = 'trans-tool:nova-score-pos-v3';
    const SCORE_MIN_KEY = 'trans-tool:nova-score-min-v1';
    const SCORE_SIZE_KEY = 'trans-tool:nova-score-size-v2';
    const MIN_PANEL_W = 260; // small enough to still show the header row and its buttons

    function applySavedPos(p) {
      try {
        const raw = localStorage.getItem(SCORE_POS_KEY);
        if (!raw) return;
        const o = JSON.parse(raw);
        if (o && typeof o.left === 'number' && typeof o.top === 'number') {
          p.style.left = o.left + 'px'; p.style.top = o.top + 'px';
          p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
          clampIntoView(p); // in case the saved position is now off-screen (resolution change, or dragged out of bounds before)
        }
      } catch (e) {}
    }
    // Pull the panel back inside the viewport: past the right/bottom edge gets pulled back, negative coords get clamped to 0.
    function clampIntoView(p) {
      const pad = 4, r = p.getBoundingClientRect();
      const left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, r.left));
      const top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, r.top));
      p.style.left = left + 'px'; p.style.top = top + 'px';
      p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
    }
    function savePos(p) {
      try { const r = p.getBoundingClientRect(); localStorage.setItem(SCORE_POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (e) {}
    }
    function makePanelDraggable(p, handle) {
      if (!handle) return;
      let ox = 0, oy = 0;
      function onMove(e) {
        const r = p.getBoundingClientRect(), pad = 4;
        const left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, e.clientX - ox));
        const top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, e.clientY - oy));
        p.style.left = left + 'px'; p.style.top = top + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        savePos(p);
      }
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        const r = p.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
    }

    // Right-edge drag, width-only, shrink-only: the panel can be made
    // narrower than its natural width (down to MIN_PANEL_W) but never wider
    // — so it can never end up covering more of the workbench than it does
    // by default, only less. Height is never touched here — it stays
    // whatever the browser's normal auto-sizing computes for the content at
    // the current width, so a narrower panel (whose legend wraps onto more
    // lines) automatically grows tall enough to still show the status and
    // skipped-translations row, rather than clipping it.
    function saveSize(p) {
      try {
        const r = p.getBoundingClientRect();
        localStorage.setItem(SCORE_SIZE_KEY, JSON.stringify({ w: Math.round(r.width) }));
      } catch (e) {}
    }
    function applySavedSize(p) {
      try {
        const raw = localStorage.getItem(SCORE_SIZE_KEY);
        if (!raw) return;
        const o = JSON.parse(raw);
        if (!o || typeof o.w !== 'number') return;
        const maxW = naturalWidth || o.w;
        p.style.width = Math.max(MIN_PANEL_W, Math.min(maxW, o.w)) + 'px';
      } catch (e) {}
    }
    function makeResizable(p, handle) {
      let startX = 0, startW = 0;
      function onMove(e) {
        const maxW = naturalWidth || startW;
        const w = Math.max(MIN_PANEL_W, Math.min(maxW, startW + (e.clientX - startX)));
        p.style.width = w + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        saveSize(p);
      }
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't also start a panel-drag from the same mousedown
        const r = p.getBoundingClientRect();
        startX = e.clientX;
        startW = r.width;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
    }

    // ====================================================================
    // Watching the page for changes (SPA row changes / re-renders)
    // ====================================================================

    let settleTimer = null;
    function onMutate() {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!document.getElementById('tl-score-panel')) injectPanel(); // re-inject if the platform wiped it
        injectStyle();
        const sig = getRowSig();
        if (sig && sig !== lastRowSig) { // row changed → reset the active-translation cursor
          lastRowSig = sig;
          activeIdx = 0;
          if (labelMode) exitLabelMode(); // a row change cancels any in-progress label pick
          const nums = getScoreModules().map(transNumberOf);
          log(`Scoreable Trans on this row: ${nums.join(', ')} (empty ones auto-skipped)`);
          updateSkippedLine();
          if (enabled) setStatus(`New row · Trans${nums[0] || 1}`);
        }
        if (enabled) applyHighlight();
      }, 200);
    }

    // ====================================================================
    // Startup
    // ====================================================================

    function start() {
      // QC pages only do comparison (see the QC Compare module) — scoring
      // shortcuts/panel stay out of the way there to avoid conflicting with
      // that workflow.
      if (/\/quality_/.test(location.href)) { log('QC page → scoring module not enabled (质检页 → 打分模块不启用)'); return; }
      injectStyle();
      injectPanel();
      lastRowSig = getRowSig();
      log(`Scoreable Trans on this row: ${getScoreModules().map(transNumberOf).join(', ')} (empty ones auto-skipped)`);
      applyHighlight();
      document.addEventListener('keydown', onKeyDown, true); // capture phase, to get the key before the platform does
      const mo = new MutationObserver(onMutate);
      mo.observe(document.body, { childList: true, subtree: true });
      window.addEventListener('resize', () => { const p = document.getElementById('tl-score-panel'); if (p) clampIntoView(p); });
      log(`Started ${VERSION}`);
    }

    return { start };
  }

  // ======================================================================
  // Boot
  // ======================================================================
  const scoringShortcuts = ScoringShortcuts(Utils);

  if (document.body) scoringShortcuts.start();
  else window.addEventListener('DOMContentLoaded', () => scoringShortcuts.start());
})();
