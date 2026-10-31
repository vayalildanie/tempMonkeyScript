(function () {
  'use strict';
  window.TL = window.TL || {};

  // ======================================================================
  // MODULE 3: QC Compare
  //
  // For the separate quality-check pass (URLs containing /quality_/): the
  // platform splits the two annotators into "Annotator 1 / Annotator 2"
  // tabs, so a reviewer keeps switching tabs to eyeball the differences.
  // This module scrapes both into one view — it stays on Annotator 1 (the
  // submission baseline) and, under each Trans N Score, shows Annotator 2's
  // value: red if it differs, a faint "agrees" if the same. Clicking a red
  // note (or its Adopt button) writes Annotator 2's value into Annotator 1
  // by driving the same cascader Module 1 drives; Undo restores the
  // original. A summary panel names what's still outstanding.
  //
  // This is a faithful, freshly re-derived port of the original v0.1.83
  // script's Module 3 (lines 1343–2193 of that script, kept outside this
  // repo) — see `canonPath` below for the cascade-matching fix
  // this module depends on (get this wrong and multi-level adopts silently
  // fail while single-level ones look fine). One deliberate departure from
  // the original, requested: the verdict buttons are driven to "1" / "3"
  // instead of "correct" / "wrong". No resize handle, and no verdict-reload
  // fallback — an earlier build tried both; the reload fallback had a real
  // loop bug (see README.md's v1.3.0 note) and was deliberately left out of
  // this rebuild. (v1.5.3 removed the whole-row long-text compare boxes:
  // NOVA no longer has those modules.)
  //
  // As of v1.4.0 this module's help/legend toggle moved from `P` to `O`,
  // matching Remark Composer's open/close key — the two modules are
  // URL-exclusive (this one only runs on /quality_ pages, Remark Composer
  // never does), so there's no runtime clash either way. Otherwise
  // unchanged by the v1.4.0 module split; this file is a straight lift.
  // ======================================================================
  function QCCompare(Utils) {
    const TAG = '[QC Compare / 质检对比]';
    const VERSION = TL.SCRIPT_VERSION;

    const DEBUG = false;
    function log(msg) { if (DEBUG) console.log(`${TAG} ${msg}`); }

    const TRANS_MAX = 7;

    // The verdict control. The reviewer's rule is "1 for user 1, 3 for user 2"; on the page that is the same pair of
    // buttons the original v0.1.83 drove, inside `.quality-container`, confirmed still correct on the live page. Both
    // vocabularies live side by side here on purpose, so they can't silently drift apart the way the header text and
    // the actual selectors did once already in an earlier build.
    const QC_VERDICT_SEL = {
      right: '.right-btn', // Annotator 1 → "1"
      wrong: '.wrong-btn', // Annotator 2 → "3"
    };

    // ---------- Runtime state ----------
    let snapA = {};              // Annotator 1 score snapshot: { transN: score string }
    let snapB = {};              // Annotator 2 score snapshot: { transN: score string }
    let remA = {};               // Annotator 1 remark snapshot: { transN: text }
    let remB = {};               // Annotator 2 remark snapshot: { transN: text }
    // The preserved pair: each translation's two ORIGINAL { score, remark } units, taken when the row was scraped and
    // never emptied afterwards (a clear, a re-scrape, or a hand edit changes only the live fields). Z flips the live
    // unit between the two; `manual` holds a hand-edited unit Z was about to overwrite. Discarded on a row change.
    let pairs = new Map();       // n -> { a, b, manual }
    let swappedNums = [];        // translations whose live Annotator 1 unit currently equals Annotator 2's (for the summary)
    let remarkTouched = false;   // the user typed in a Remarks box since the last scrape (stops the lazy-load verify)
    let pairsTouched = false;    // the user flipped or relabeled something since the last scrape (also stops the verify)
    let verifyRetries = 0;       // re-scrapes the verify has done for this row (capped)
    let verifyTimer = null;      // bounded post-scrape check that late-loading remark text was captured
    let scraping = false;        // currently switching tabs to scrape (don't render badges now, or Annotator 2's value gets rendered as Annotator 1)
    let adopting = false;        // currently adopting/writing a value (driving the cascader; don't let the observer mis-render now)
    let ready = false;           // scraped successfully at least once
    let lastRowSig = '';         // signature of the row the pairs were read from; a different one means the pairs are stale
    let scrapeFailed = false;    // the last full scrape failed (lets the next row change retry even though nothing is ready)
    let diffNums = [];           // trans numbers currently disagreeing (for the summary count)
    let panelEl = null, summaryEl = null, hdrEl = null, warnEl = null, cursorEl = null;
    let helpOpen = true;         // whether the panel help text is expanded; persisted (v1.4.2), defaults to expanded on a brand-new install
    let labelBusy = false;       // guards against double-firing while a label-menu click is mid-flight

    function escapeHtml(s) { return Utils.escapeHtml(s); }

    // Rule: a translation scored 3 Points should have no remark of its own -> return the Trans numbers that break it,
    // judged from the live fields of the tab being viewed.
    function get3PtRemarkViolations() {
      return scoreableTrans().filter((n) => /^3 Points/.test(readScore(n)) && readRemark(n).trim() !== '');
    }

    // ====================================================================
    // Reading the page — this module keeps its own copies (not shared with
    // Module 1/2) of anything that isn't a generic DOM helper already in
    // Utils, matching the file's "modules stay behaviorally isolated" rule
    // (README.md's "Ground rules" section).
    // ====================================================================

    function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

    function getTabs() { return Array.from(document.querySelectorAll('.tabs-group .tab')); }
    function activeTabIndex() { return getTabs().findIndex((t) => t.classList.contains('active')); }

    // Fixed business rule (no exceptions): in a new task, Annotator 1 gets verdict "1", Annotator 2 gets verdict "3".
    // The buttons act on the current tab's annotator; selecting one deselects the other (mutually exclusive, not a
    // toggle); a selected button carries .active. Idempotent: skip the click if the button is already active (avoids
    // extra clicks when the observer/re-scrape re-fires). Plain fire-and-forget, matching the original exactly — no
    // reload fallback. An earlier build added one (reload the page if the button never confirmed .active), but its
    // guard wasn't loop-proof: a confirmed Annotator 1 click cleared the very guard the Annotator 2 click then
    // depended on, so a verdict that didn't survive a reload could clear -> fail -> reload -> clear -> fail,
    // indefinitely. A verdict that silently doesn't register is a visible, recoverable annoyance; a reload loop makes
    // the page unusable. Deliberately not reintroduced.
    function ensureVerdict(kind) {
      const c = document.querySelector('.quality-container');
      if (!c) return;
      const btn = c.querySelector(QC_VERDICT_SEL[kind]);
      if (btn && !btn.classList.contains('active')) Utils.clickEl(btn);
    }
    async function clickTab(i) {
      const tabs = getTabs();
      if (!tabs[i]) throw new Error(`没找到第 ${i + 1} 个标注 tab`);
      if (tabs[i].classList.contains('active')) return; // already on this tab
      Utils.clickEl(tabs[i]);
      await Utils.waitFor(() => { const t = getTabs()[i]; return t && t.classList.contains('active'); }, 1500);
      await nextFrame(); await nextFrame(); // wait one more frame so the platform finishes re-rendering the scores too
    }

    function scoreModule(n) { return document.querySelector(`[data-module-name="Trans${n} Score"]`); }
    function readScore(n) { return Utils.readSelected(scoreModule(n)); } // empty string = not scored
    // Trans n's Remarks module. The platform nests two wrappers with the same name and spells Trans 2's with a space
    // ("Trans 2 Remarks"), so match by number, not by string; the first (outermost) match wins.
    function remarkModule(n) {
      for (const mod of document.querySelectorAll('[data-module-name]')) {
        if (Utils.transNumFromModuleName(mod, ' Remarks') === n) return mod;
      }
      return null;
    }
    function remarkTextarea(n) {
      const mod = remarkModule(n);
      return mod ? mod.querySelector('textarea') : null;
    }
    function readRemark(n) { const ta = remarkTextarea(n); return ta ? ta.value : ''; }
    function readUnit(n) { return { score: readScore(n), remark: readRemark(n) }; }
    // Remarks match when they are equal ignoring leading/trailing whitespace; scores match exactly.
    function sameUnit(x, y) {
      return !!x && !!y && x.score === y.score && String(x.remark || '').trim() === String(y.remark || '').trim();
    }
    // Which side to write when Z is pressed, or null when there is nothing to flip. A live unit that matches neither
    // side (cleared, half-cleared, hand-edited) gets Annotator 2's first, unless Annotator 2 has no score to write.
    function flipTarget(pair, live) {
      if (sameUnit(pair.a, pair.b)) return null;
      if (sameUnit(live, pair.a)) return 'b';
      if (sameUnit(live, pair.b)) return 'a';
      return pair.b.score ? 'b' : 'a';
    }
    function describeUnit(u) {
      const remark = String(u.remark || '').trim();
      const short = remark.length > 40 ? `${remark.slice(0, 40)}…` : remark;
      return `${u.score || '(not scored)'}${short ? ` + “${short}”` : ''}`;
    }
    // Trans numbers on this row that have both a translation and a scoring control (empty translations aren't compared).
    function scoreableTrans() {
      const out = [];
      for (let n = 1; n <= TRANS_MAX; n++) if (scoreModule(n) && Utils.transHasText(n)) out.push(n);
      return out;
    }
    // Row signature: the source (笔记外文翻译) differs per row -> row-change detection.
    function getRowSig() {
      // The Note module (the page's own source text, different per row), else Trans1 — the same signature the other
      // modules use. The old 笔记外文翻译 module no longer exists, so a row change was never detected here.
      const src = document.querySelector('[data-module-key="NoteTrans"]')
        || document.querySelector('[data-module-name="Trans1"]');
      return src ? src.textContent.trim().slice(0, 80) : '';
    }

    // ====================================================================
    // Adopt: write the "other annotator"'s score into the current one's
    // cascader (= Annotator 1, the submission baseline). Reuses the
    // hard-won tricks from Module 1: (1) first close all other cascaders +
    // blur (root cause: don't let a focused old cascader get popped too)
    // (2) click level by level along the full data-path-key (only in the
    // dropdown hugging this select, never crossing to another Trans)
    // (3) read back & verify, stop on mismatch.
    // ====================================================================
    const SPLIT = '__RC_CASCADER_SPLIT__'; // the level separator token in the platform's data-path-key
    const ADJACENT_GAP_PX = 120;           // threshold (px) for "the dropdown hugs this select"

    // popupsVisible/edgeGap/closeOpenCascaders are shared with Scoring
    // Shortcuts — same cascader controls, same "which popup is actually
    // mine" problem — see Utils.
    const popupsVisible = Utils.popupsVisible;
    const edgeGap = Utils.edgeGap;
    // Restore an option's data-path-key into a display path (SPLIT -> "/").
    // Key point: a label itself may contain "/" (e.g. "Unauthentic Vocabulary / Collocations"), so never split levels via value.split('/'),
    //   use path-key as the authoritative separator to restore, then compare to the target on "/" boundaries. The level
    //   separator is "/" (no spaces), in-label is " / " (spaces) — naturally distinguishable.
    function pkDisplay(li) {
      const k = li.getAttribute('data-path-key') || '';
      return k.split(SPLIT).join('/');
    }
    // The displayed value (readScore / snapB) joins levels with " / " while path-key uses "/" (no spaces) -> multi-level
    //   paths never match at all (root cause: adopt failed for the nested submenus of 2 Points and below; 3 Points/Confusing
    //   are single-level with no slash, so unaffected — that's what hid this bug originally).
    // Fix: before comparing, canonicalize both sides' level separators to "/" (both " / " and " >> "). In-label " / " gets
    //   canonicalized too, but both sides are treated the same and only compared to real li path-keys, and real menu items
    //   are generated only at level boundaries -> boundaries can't misalign.
    function canonPath(s) {
      return String(s == null ? '' : s).replace(/\s*>>\s*/g, '/').replace(/\s*\/\s*/g, '/').trim();
    }
    // In the dropdown hugging this select, pick the next level toward target: restored path-key == target (leaf) or a
    // prefix of target (intermediate); take the item deeper than minLen but the shallowest such (= the very next level to click).
    function pickNextOnPath(selector, target, minLen) {
      const sr = selector.getBoundingClientRect();
      const ct = canonPath(target); // canonicalize the target by level (drop the spaces in " / ")
      let best = null, bestLen = Infinity, bestGap = Infinity;
      for (const p of popupsVisible()) {
        const gap = edgeGap(p, sr);
        if (gap > ADJACENT_GAP_PX) continue; // not a dropdown hugging this box -> skip
        for (const li of p.querySelectorAll('li.ant-cascader-menu-item')) {
          const cd = canonPath(pkDisplay(li)); // canonicalize the candidate the same way before comparing
          if (!cd) continue;
          const onPath = cd === ct || ct.startsWith(cd + '/'); // leaf: exact match / intermediate: on a "/" boundary
          if (!onPath || cd.length <= minLen) continue; // not on the path / not deeper than what's already clicked -> skip
          if (cd.length < bestLen || (cd.length === bestLen && gap < bestGap)) {
            best = li; bestLen = cd.length; bestGap = gap;
          }
        }
      }
      return best;
    }
    const closeOpenCascaders = Utils.closeOpenCascaders;

    // Write value (e.g. "2 Points/Authenticity/Unauthentic Vocabulary / Collocations") into Trans n's cascader.
    async function writeCascade(n, value) {
      const mod = scoreModule(n);
      if (!mod) throw new Error(`没找到 Trans${n} Score`);
      const selector = mod.querySelector('.ant-select-selector');
      const input = mod.querySelector('input');
      if (!selector) throw new Error('没找到下拉选择框');

      await closeOpenCascaders();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();

      Utils.clickEl(selector); // open this control
      await Utils.waitFor(() => input && input.getAttribute('aria-expanded') === 'true', 1200);

      // Walk the real path-keys in the DOM level by level: each time click the option "toward target, one level deeper
      // than clicked" until the restored path-key == target.
      let minLen = 0;
      for (let step = 0; step < 14; step++) {
        if (readScore(n) === value) break; // already there
        const li = pickNextOnPath(selector, value, minLen);
        if (!li) { await nextFrame(); continue; } // the next level isn't rendered yet -> wait a frame and look again
        const disp = canonPath(pkDisplay(li)); // same convention as pickNextOnPath (minLen is also the canonicalized length)
        Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);
        minLen = disp.length;
        if (disp === canonPath(value)) { // reached the leaf -> give the platform time to commit the displayed value
          await Utils.waitFor(() => readScore(n) === value, 800).catch(() => {});
          break;
        }
        // Intermediate: wait for the next column on the right to render (or the full value is already readable).
        await Utils.waitFor(() => pickNextOnPath(selector, value, minLen) || readScore(n) === value, 900).catch(() => {});
      }
      // Read back & verify (up to 1s for the platform to refresh the display into the full path).
      await Utils.waitFor(() => readScore(n) === value, 1000).catch(() => {});
      const got = readScore(n);
      // Close this control + blur (so leftover focus doesn't get popped next time).
      if (input && input.getAttribute('aria-expanded') === 'true') {
        Utils.clickEl(selector);
        await Utils.waitFor(() => input.getAttribute('aria-expanded') !== 'true', 400).catch(() => {});
      }
      if (input && typeof input.blur === 'function') input.blur();
      if (got !== value) throw new Error(`写入后核对不符:期望「${value}」实际「${got || '空'}」`);
      return got;
    }

    // Write one side of a translation's preserved pair into Annotator 1's live fields: the score through the
    // cascader (cleared if that side had none), the remark through the native setter so NOVA sees the input event.
    // Callers hold `adopting`. Throws if the score write does not verify.
    async function writeSide(n, side) {
      const target = pairs.get(n)[side];
      if (readScore(n) !== target.score) {
        if (target.score) await writeCascade(n, target.score);
        else await clearCascade(n);
      }
      const ta = remarkTextarea(n);
      if (ta && ta.value !== target.remark) Utils.setNativeValue(ta, target.remark);
    }

    // Flip the translation between the two annotators' preserved values (Z, the badge's Swap → and its Undo).
    // The pair, not the live Annotator 2 tab, is what gets written, so clearing either side's data never stops a flip.
    // Returns true when something was written (the Z handler advances only then).
    async function flip(n) {
      if (n == null) { setCursorStatus('No translation selected'); return false; }
      if (scraping || adopting || !ready) return false;
      if (activeTabIndex() !== 0) { setSummary('<span style="color:#c92a2a;">Switch to the <b>Annotator&nbsp;1</b> tab to swap.</span>'); return false; }
      if (getRowSig() !== lastRowSig) { setCursorStatus('The row just changed — wait a moment, then press again'); return false; } // pairs are for the previous row
      const pair = pairs.get(n);
      if (!pair) return false;
      const live = readUnit(n);
      const side = flipTarget(pair, live);
      if (side === null) { setCursorStatus(`Trans${n} matches`); return false; }
      if (side === 'b' && !pair.b.score) { setSummary(`Annotator 2 has no score for Trans${n} — set it manually.`); return false; }
      // A live unit that is neither original (a hand edit) is kept before it is overwritten.
      if (!sameUnit(live, pair.a) && !sameUnit(live, pair.b) && (live.score || live.remark.trim())) pair.manual = live;
      pairsTouched = true;
      adopting = true;
      setSummary(`Swapping Trans${n}…`);
      let ok = false;
      try {
        await writeSide(n, side);
        snapA[n] = pair[side].score; // Annotator 1 now holds that side -> keep the snapshots consistent for Annotator 2's tab
        remA[n] = pair[side].remark;
        log(`Trans${n}: flipped to ${side === 'b' ? 'Annotator 2' : 'Annotator 1'} = ${describeUnit(pair[side])}`);
        ok = true;
      } catch (e) {
        console.error(`${TAG} Swap failed:`, e);
        setSummary(`⚠️ Trans${n}: could not apply the swap (see console).`);
      } finally {
        adopting = false;
        render();
      }
      return ok;
    }

    // Clear a Trans's score (click the cascader's built-in clear button).
    async function clearCascade(n) {
      const mod = scoreModule(n);
      const clear = mod && mod.querySelector('.ant-select-clear');
      if (!clear) throw new Error('没找到清除按钮,无法清空');
      Utils.clickEl(clear);
      await Utils.waitFor(() => readScore(n) === '', 700).catch(() => {});
      if (readScore(n) !== '') throw new Error('清空后仍有值');
    }

    // ====================================================================
    // Keyboard relabelling (added v1.3.2)
    //
    // Same shortcuts as Module 1 — 3 / C / Z / 2 then 0-9 — but driving the
    // reviewer's own (Annotator 1) cascader on the QC page. Every write goes
    // through writeCascade, so it inherits the read-back-and-verify
    // guarantee: a relabel either lands the exact value or reports failure,
    // never silently applies something else.
    // ====================================================================

    // The path-keys the shortcuts drive. Same strings as Module 1's CFG —
    // deliberately restated rather than shared, because they're the
    // platform's vocabulary and each module reads them from the same DOM.
    const PATH_KEY = { '3': '3 Points', '2': '2 Points', c: 'Confusing' };

    // Shared preflight for every keyboard write: not mid-scrape, not
    // mid-write, and on the tab we're allowed to write to. Returns false and
    // explains itself rather than failing silently — a keystroke that
    // quietly does nothing is worse than one that says why.
    function canWrite(n) {
      if (scraping || adopting || !ready) return false;
      if (n == null) { setCursorStatus('No translation selected'); return false; }
      if (activeTabIndex() !== 0) {
        setSummary('<span style="color:#c92a2a;">Switch to the <b>Annotator&nbsp;1</b> tab to edit.</span>');
        return false;
      }
      return true;
    }

    // Score the cursor's translation. "2 Points" is a category, not a leaf,
    // so after writing it we reopen the dropdown and leave it open for the
    // 0-9 label pick — mirroring Module 1's `advanceOn2: false`.
    async function relabel(n, pathKey) {
      if (!canWrite(n)) return;
      adopting = true;
      setCursorStatus(`Trans${n} → ${pathKey}…`);
      try {
        await writeCascade(n, pathKey);
        snapA[n] = pathKey;
        pairsTouched = true;
        if (pathKey === PATH_KEY['2']) {
          await reopenForLabelPick(n);
          setCursorStatus(`Trans${n} = 2 Points — press 1-9/0 for a label`);
        } else {
          setCursorStatus(`Trans${n} = ${pathKey} ✓`);
        }
        log(`Trans${n}: set to ${pathKey} from the keyboard`);
      } catch (e) {
        console.error(`${TAG} Relabel failed:`, e);
        setCursorStatus(`⚠️ Trans${n}: could not set ${pathKey} (see console)`);
      } finally {
        adopting = false;
        render();
      }
    }

    // Clear the cursor's translation.
    async function eraseScore(n) {
      if (!canWrite(n)) return;
      adopting = true;
      try {
        await clearCascade(n);
        snapA[n] = '';
        pairsTouched = true;
        setCursorStatus(`Trans${n} cleared`);
      } catch (e) {
        console.error(`${TAG} Erase failed:`, e);
        setCursorStatus(`⚠️ Trans${n}: could not clear (see console)`);
      } finally {
        adopting = false;
        render();
      }
    }

    // writeCascade deliberately closes and blurs the control when it's done.
    // For "2 Points" we want it open, so reopen it as a separate step rather
    // than threading a "leave it open" flag through writeCascade's
    // verify-and-close path.
    //
    // Reopening has to leave the menu *drilled into* "2 Points", not just
    // showing the top level: pickLabelByNumber reads the deepest column, and
    // with only the top level open the digit keys would land on
    // 3 Points/Confusing/2 Points instead of the sub-labels. Ant usually
    // restores the selected path's columns on reopen, but not dependably
    // enough to lean on — so drill in explicitly if it didn't.
    async function reopenForLabelPick(n) {
      const mod = scoreModule(n);
      const selector = mod && mod.querySelector('.ant-select-selector');
      const input = mod && mod.querySelector('input');
      if (!selector) return;
      Utils.clickEl(selector);
      await Utils.waitFor(() => input && input.getAttribute('aria-expanded') === 'true', 1200).catch(() => {});

      const columns = () => {
        const p = labelPopupFor(n);
        return p ? p.querySelectorAll('ul.ant-cascader-menu').length : 0;
      };
      if (columns() >= 2) return; // already drilled in
      // pickNextOnPath does the adjacency-gated, canonPath-matched lookup —
      // same engine writeCascade walks with, so "2 Points" is found the same
      // way here as there.
      const li = pickNextOnPath(selector, PATH_KEY['2'], 0);
      if (!li) return;
      Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);
      await Utils.waitFor(() => columns() >= 2, 800).catch(() => {});
    }

    // The label menu currently hanging off Trans n's cascader, or null.
    // Adjacency-gated for the same reason writeCascade is: another
    // translation's leftover popup must never be mistaken for this one's.
    function labelPopupFor(n) {
      const mod = scoreModule(n);
      const selector = mod && mod.querySelector('.ant-select-selector');
      if (!selector) return null;
      const sr = selector.getBoundingClientRect();
      let best = null, bestGap = Infinity;
      for (const p of popupsVisible()) {
        const gap = edgeGap(p, sr);
        if (gap <= ADJACENT_GAP_PX && gap < bestGap) { best = p; bestGap = gap; }
      }
      return best;
    }

    // Pick item #i (1-based) from the deepest currently-open menu column.
    //
    // This is a deliberately minimal cousin of Module 1's
    // `pickLabelByNumber`: same decisive leaf signal
    // (`ant-cascader-menu-item-expand` present = category, absent = leaf),
    // same single-leaf auto-pick, but without the injected number badges or
    // the shared label-mode state. Module 1's version is entangled with its
    // badge rAF loop, its own status panel and `activeIdx`; hoisting all of
    // that into shared code is a bigger and riskier lift than this copy, and
    // is the right follow-up once TransCursor has proven the pattern.
    async function pickLabelByNumber(n, i) {
      if (labelBusy || !canWrite(n)) return;
      labelBusy = true;
      try {
        const popup = labelPopupFor(n);
        if (!popup) { setCursorStatus('No label menu open — press 2 first'); return; }
        const cols = popup.querySelectorAll('ul.ant-cascader-menu');
        if (cols.length < 2) { setCursorStatus('Labels not open yet'); return; }
        const col = cols[cols.length - 1]; // deepest column currently shown
        const li = col.querySelectorAll('li.ant-cascader-menu-item')[i - 1];
        if (!li) { setCursorStatus(`No item #${i} here`); return; }

        const isLeaf = !li.classList.contains('ant-cascader-menu-item-expand');
        const colsBefore = cols.length;
        Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);

        if (isLeaf) { await commitLabel(n); return; }

        // Category: drill in and wait for the next column to render.
        await Utils.waitFor(() => {
          const p = labelPopupFor(n);
          return !!p && p.querySelectorAll('ul.ant-cascader-menu').length > colsBefore;
        }, 800).catch(() => {});

        // If drilling in reveals exactly one leaf sub-label, take it too —
        // the leaf still has to be explicitly selected (e.g. to land on
        // "Grammar/Grammar"), so this isn't skipping a real choice.
        const p2 = labelPopupFor(n);
        const newCols = p2 ? p2.querySelectorAll('ul.ant-cascader-menu') : [];
        const deepest = newCols[newCols.length - 1];
        const subItems = deepest ? deepest.querySelectorAll('li.ant-cascader-menu-item') : [];
        if (subItems.length === 1 && !subItems[0].classList.contains('ant-cascader-menu-item-expand')) {
          Utils.clickEl(subItems[0].querySelector('.ant-cascader-menu-item-content') || subItems[0]);
          await commitLabel(n);
        } else {
          setCursorStatus('Category selected — press a number for the sub-label');
        }
      } finally {
        labelBusy = false;
      }
    }

    // A leaf was clicked: wait for the platform to show the full path, then
    // close up and resync the snapshot. The platform doesn't auto-close the
    // menu after a leaf pick, so we do it.
    async function commitLabel(n) {
      await Utils.waitFor(() => readScore(n) !== '', 900).catch(() => {});
      await closeOpenCascaders();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      const got = readScore(n);
      snapA[n] = got;
      pairsTouched = true;
      setCursorStatus(got ? `Trans${n} = ${got} ✓` : `⚠️ Trans${n}: label didn't register`);
      render();
    }

    // Close the label menu without picking anything (Esc).
    async function cancelLabelPick(n) {
      await closeOpenCascaders();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      setCursorStatus(n == null ? 'Label pick cancelled' : `Trans${n}: label pick cancelled`);
    }

    // ====================================================================
    // Scrape both: stay on Annotator 1 -> read A (the live value) -> click Annotator 2, read B -> click back to Annotator 1.
    // ====================================================================
    // `isVerifyRetry` is the lazy-load re-check of the same row (see scheduleRemarkVerify): it rebuilds the pairs from a
    // fresh read, which is safe only because that check runs solely while the user has not typed, flipped, or
    // relabeled anything, so no preserved value can be lost. A failed read leaves the existing pairs alone.
    async function scrapeBoth(isVerifyRetry = false) {
      const tabs = getTabs();
      if (tabs.length < 2) { ready = false; log('Only one annotator — nothing to compare'); setSummary('Only one annotator — nothing to compare.'); return; }
      scraping = true;
      const sigAtStart = getRowSig(); // the row being read; a change while reading is then seen as a new row afterwards
      clearBadges();
      setSummary('Loading Annotator 2…');
      try {
        await clickTab(0); // make sure we're on Annotator 1 (the baseline)
        const nums = scoreableTrans();
        const a = {}, ra = {};
        for (const n of nums) { a[n] = readScore(n); ra[n] = readRemark(n); } // read Annotator 1 scores and remarks
        ensureVerdict('right'); // fixed rule: Annotator 1 gets verdict "1" (skip if already marked)
        await clickTab(1);                                              // switch to Annotator 2
        const b = {}, rb = {};
        for (const n of nums) { b[n] = readScore(n); rb[n] = readRemark(n); } // read Annotator 2 scores and remarks
        ensureVerdict('wrong'); // fixed rule: Annotator 2 gets verdict "3" (skip if already marked)
        await clickTab(0);                                              // switch back to Annotator 1
        snapA = a; snapB = b; remA = ra; remB = rb;
        pairs = new Map(); // a new read of the row replaces the previous pairs
        for (const n of nums) pairs.set(n, { a: { score: a[n], remark: ra[n] }, b: { score: b[n], remark: rb[n] }, manual: null });
        ready = true;
        scrapeFailed = false;
        lastRowSig = sigAtStart;
        if (!isVerifyRetry) {
          verifyRetries = 0; remarkTouched = false; pairsTouched = false;
          scheduleRemarkVerify();
        }
        log(`Scrape complete · A: ${nums.map((n) => `T${n}=${a[n] || 'empty'}`).join(' / ')} · B: ${nums.map((n) => `T${n}=${b[n] || 'empty'}`).join(' / ')}`);
      } catch (e) {
        // A failed verify retry leaves the earlier, good pairs in place; a failed first read of a row is retried on the
        // next row change.
        if (!isVerifyRetry) { ready = false; scrapeFailed = true; lastRowSig = sigAtStart; }
        console.error(`${TAG} Scraping Annotator 2 failed:`, e);
        setSummary('⚠️ Could not read Annotator 2 (see console).');
        try { await clickTab(0); } catch (e2) { /* best effort: leave the reviewer on Annotator 1 */ }
      } finally {
        scraping = false;
        render();
      }
    }

    // The platform sometimes finishes switching QC tabs before the row's remark text has actually loaded, so the first
    // read can capture empty text or the previous row's leftover. For about 2.5s after a scrape, compare Annotator 1's
    // live remarks with the snapshot and re-scrape (at most twice) if they differ. It stops for good the moment the
    // user types, flips, or relabels, so it can only correct pairs nobody has touched. It cannot see late text on
    // Annotator 2's tab.
    function scheduleRemarkVerify() {
      clearTimeout(verifyTimer);
      let tries = 0;
      const tick = () => {
        if (++tries > 6) return;
        verifyTimer = setTimeout(async () => {
          if (remarkTouched || pairsTouched || Utils.inTextEntry()) return; // typing or about to: never switch tabs under the user
          if (ready && !scraping && activeTabIndex() === 0 && scoreableTrans().some((n) => readScore(n) !== (snapA[n] || ''))) {
            pairsTouched = true; // a score changed by hand (the mouse): the pairs are in use
            return;
          }
          const stale = ready && !scraping && !adopting && verifyRetries < 2 && activeTabIndex() === 0
            && scoreableTrans().some((n) => readRemark(n) !== (remA[n] || ''));
          if (stale) { verifyRetries++; await scrapeBoth(true); }
          tick();
        }, 400);
      };
      tick();
    }

    // ====================================================================
    // Inline badge: a line under each comparable Trans N Score showing Annotator 2's value + same/different.
    // Annotator 1's value is already shown in the dropdown -> if the same, don't repeat the value, just show "agrees".
    // ====================================================================
    function ensureBadge(mod) {
      const host = mod.querySelector('.cascade-container') || mod;
      let b = host.querySelector(':scope > .qc-badge');
      if (!b) { b = document.createElement('div'); b.className = 'qc-badge'; host.appendChild(b); }
      return b;
    }
    function clearBadges() { document.querySelectorAll('.qc-badge').forEach((b) => b.remove()); }

    function renderBadges() {
      if (scraping || adopting || !ready) return;
      // The badge always shows the "other annotator"'s value: on Annotator 1 -> show Annotator 2; on Annotator 2 -> show Annotator 1 (more intuitive).
      const activeIdx = activeTabIndex();
      if (activeIdx === -1) return; // no active tab found (a render gap) -> skip
      const onB = activeIdx === 1;
      const otherSnap = onB ? snapA : snapB;
      const otherRem = onB ? remA : remB;
      const otherLabel = onB ? 'Annotator 1' : 'Annotator 2';
      updatePanelHeader(onB ? 2 : 1, onB ? 1 : 2); // header: You are on Annotator X, viewing Y's values
      const nums = scoreableTrans();
      const diffs = [];
      const swapped = [];
      for (let n = 1; n <= TRANS_MAX; n++) {
        const mod = scoreModule(n);
        if (!mod) continue;
        if (nums.indexOf(n) === -1) { // empty translation / not comparable -> no badge
          const old = mod.querySelector('.qc-badge'); if (old) old.remove();
          continue;
        }
        const cur = readUnit(n);       // the live score and remark of the current tab (= the current annotator)
        const other = { score: otherSnap[n] || '', remark: otherRem[n] || '' }; // the other annotator's snapshot unit
        const same = sameUnit(cur, other);
        if (!same) diffs.push(n);
        const pair = pairs.get(n);
        // Annotator 1's live unit equals Annotator 2's original while the two originals differ: shown as swapped.
        const isSwapped = !onB && !!pair && !sameUnit(pair.a, pair.b) && sameUnit(cur, pair.b);
        if (isSwapped) swapped.push(n);
        const wasNote = pair && pair.manual
          ? ` <span class="qc-was" title="${escapeHtml(`${pair.manual.score || '(not scored)'} + ${pair.manual.remark}`)}">· your edit: ${escapeHtml(describeUnit(pair.manual))}</span>` : '';
        const badge = ensureBadge(mod);
        let html, cls;
        if (isSwapped) { // "swapped + what it was + undo" only on the Annotator 1 tab
          html = `✓ Swapped to Annotator 2 <span class="qc-was">· was: ${escapeHtml(describeUnit(pair.a))}</span>${wasNote} <span class="qc-undo" data-undo="${n}">Undo</span>`;
          cls = 'qc-badge qc-adopted';
        } else if (same) {
          html = `✓ ${otherLabel} agrees`;
          cls = 'qc-badge qc-same';
        } else {
          const remarkLine = String(cur.remark).trim() === String(other.remark).trim()
            ? '' : `<span class="qc-bd-rem">Remark: ${escapeHtml(other.remark.trim() || '(none)')}</span>`;
          html = `<span class="qc-bd-val">≠ ${otherLabel}: ${escapeHtml(other.score || '(not scored)')}${remarkLine}${wasNote}</span><span class="qc-adopt-btn" data-adopt-score="${n}">Swap →</span>`;
          cls = 'qc-badge qc-diff';
        }
        if (badge.innerHTML !== html) badge.innerHTML = html; // write only on change, to avoid triggering a needless mutation
        if (badge.className !== cls) badge.className = cls;
      }
      diffNums = diffs;
      swappedNums = swapped;
      updateSummary();
    }

    // Full render: score badges + rule checks.
    // cursor.sync() last: the platform's re-renders replace the badge hosts,
    // which takes the selection highlight with them, so it gets restored the
    // same way the badges themselves do. renderBadges bails while !ready, so
    // nothing paints until the scrape completes — which is what we want,
    // since the hosts are being rebuilt anyway.
    function render() { renderBadges(); updateWarn(); cursor.sync(); }

    // ====================================================================
    // Selection cursor (added v1.3.2)
    //
    // Same arrow-key semantics as Module 1, via the shared TransCursor:
    // ↑/↓ step through the comparable translations, ←/→ toggle column
    // (Trans1-3 / Trans4-7) and return to where you last were in it.
    // ====================================================================
    const cursor = TL.TransCursor({
      list: scoreableTrans, // already an ordered array of Trans numbers
      status: setCursorStatus,
      onChange(num, { scroll }) {
        // Mark the badge host, not the badge's innerHTML — renderBadges
        // replaces that on every render and would fight the marker.
        //
        // No feedback-loop guard needed here (unlike the innerHTML writes in
        // renderBadges): the observer watches childList/subtree only, with no
        // `attributes: true`, so a classList toggle can't retrigger it.
        //
        // A translation is selected as a unit: its Score control and its
        // Remarks box get the same outline. Remarks is outlined on its
        // block-level `.text-labels` container, not the outer `font` wrapper
        // (inline, so an outline on it fragments around the line boxes), the
        // same way Score is outlined on `.cascade-container`.
        document.querySelectorAll('.qc-active-score, .qc-active-remark').forEach((el) => el.classList.remove('qc-active-score', 'qc-active-remark'));
        if (num === null) return;
        const mod = scoreModule(num);
        if (!mod) return;
        (mod.querySelector('.cascade-container') || mod).classList.add('qc-active-score');
        const rem = remarkModule(num);
        if (rem) (rem.querySelector('.text-labels') || rem).classList.add('qc-active-remark');
        // Arrow keys pass scroll:true; a plain repaint from render() doesn't.
        // Without this the highlight walks off the bottom of a long row and
        // the view never follows it.
        if (scroll) mod.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    });

    // Move the selection to the next scoreable translation (the same step ArrowDown takes). Z calls it after a flip
    // that wrote something. No wraparound: the last one stays put.
    function advanceFocus() { cursor.step(1); }

    // Rule-check warning: a 3-Points Trans shouldn't have a remark.
    function updateWarn() {
      if (!warnEl) return;
      const v = get3PtRemarkViolations();
      if (!v.length) { warnEl.style.display = 'none'; warnEl.textContent = ''; return; }
      warnEl.style.display = 'block';
      warnEl.textContent = `⚠️ 3 Points must have no remark — remove the remark for: Trans ${v.join(', ')}`;
    }

    // ====================================================================
    // Summary panel (top) text helpers
    // ====================================================================
    function setSummary(msg) { if (summaryEl) summaryEl.innerHTML = msg; }
    // The cursor/keyboard status line needs its own element, not summaryEl:
    // updateSummary() replaces summaryEl wholesale at the end of every
    // renderBadges(), so anything posted there is erased on the next
    // mutation tick. Guarded on inequality so the write can't feed the
    // observer.
    function setCursorStatus(msg) {
      if (cursorEl && cursorEl.textContent !== msg) cursorEl.textContent = msg;
    }
    function updatePanelHeader(curr, other) {
      if (!hdrEl) return;
      const html = `You are on <b>Annotator&nbsp;${curr}</b>. The note under each score shows what <b>Annotator&nbsp;${other}</b> chose.`;
      if (hdrEl.innerHTML !== html) hdrEl.innerHTML = html;
    }
    // "What still needs reconciling." diffNums is derived from the *live* value of the current tab, so a Trans drops
    // off this list the moment it's adopted (or hand-edited to match) — the count only ever shows outstanding work.
    // Adopted-this-row is reported separately so the reviewer can see progress rather than just a shrinking number.
    function updateSummary() {
      if (!summaryEl) return;
      const total = scoreableTrans().length; // number of translations being compared (empty ones excluded)
      const adoptedCount = swappedNums.length; // translations currently holding Annotator 2's unit, so swapping shows as progress
      const done = adoptedCount ? `<span style="color:#2b8a3e;"> · ${adoptedCount} swapped</span>` : '';
      if (!diffNums.length) {
        summaryEl.innerHTML = `<span style="color:#2f9e44;font-weight:600;">Nothing left to reconcile ✓</span>`
          + `<span style="color:#8a909c;"> · ${total} translations compared</span>${done}`;
        return;
      }
      summaryEl.innerHTML = `<span style="color:#c92a2a;font-weight:600;">${diffNums.length} still to reconcile: Trans ${diffNums.join(', ')}</span>`
        + `<span style="color:#8a909c;"> · ${total} compared</span>${done}`;
    }

    // ====================================================================
    // Styles + panel
    // ====================================================================
    function injectStyle() {
      if (document.getElementById('qc-style')) return;
      const s = document.createElement('style');
      s.id = 'qc-style';
      s.textContent = `
        .qc-badge {
          display: block; margin-top: 6px; padding: 3px 9px; border-radius: 6px;
          font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: normal; word-break: break-word;
        }
        .qc-badge.qc-same { color: #8a909c; background: #f4f6fb; }
        .qc-badge.qc-diff { color: #c92a2a; background: #fff0f0; border: 1px solid #ffc9c9; font-weight: 600; cursor: pointer; display: flex; align-items: center; }
        .qc-badge.qc-diff:hover { background: #ffe3e3; }
        .qc-badge .qc-bd-val { flex: 1; min-width: 0; word-break: break-word; }
        .qc-badge .qc-bd-rem { display: block; font-weight: 400; color: #868e96; }
        .qc-badge.qc-adopted { color: #2b8a3e; background: #ebfbee; border: 1px solid #b2f2bb; }
        .qc-badge .qc-was { color: #868e96; font-weight: 400; }
        .qc-badge .qc-undo { color: #1c7ed6; cursor: pointer; text-decoration: underline; font-weight: 600; margin-left: 6px; }
        .qc-badge .qc-undo:hover { color: #1971c2; }

        /* Arrow-key selection highlight. Defined here rather than reusing
           Module 1's .tl-active-score: that rule lives in Module 1's own
           stylesheet, and Module 1 bails out on /quality_ pages, so it is
           never injected here. Same amber-on-pale-yellow look, so the two
           pages read the same way. */
        .qc-active-score,
        .qc-active-remark {
          outline: 2px solid #f0a500 !important;
          outline-offset: 2px;
          background: rgba(255, 221, 87, .30) !important;
          border-radius: 6px;
        }

        .qc-spacer { flex: 1; }
        .qc-adopt-btn {
          cursor: pointer; font-weight: 600; white-space: nowrap; margin-left: 8px;
          color: #1c7ed6; border: 1px solid #a5d8ff; background: #e7f5ff; border-radius: 6px; padding: 1px 8px;
        }
        .qc-adopt-btn:hover { background: #d0ebff; }

        /* top panel: collapsible help + draggable — fixed size, no resize/minimize (bare original parity) */
        #qc-head { display: flex; align-items: center; gap: 6px; cursor: move; user-select: none; }
        #qc-head .qc-ver { font-size: 11px; background: #ffe066; color: #664d00; padding: 1px 7px; border-radius: 6px; font-weight: 700; }
        #qc-head #qc-toggle { cursor: pointer; color: #868e96; font-size: 13px; padding: 0 4px; }
        #qc-head #qc-toggle:hover { color: #1f2430; }
        #qc-summary { font-size: 12px; margin-left: 10px; }
        #qc-warn { margin-top: 6px; padding: 5px 9px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #c92a2a; background: #fff0f0; border: 1px solid #ffc9c9; }
        #qc-help { margin-top: 6px; border-top: 1px solid #f0f0f0; padding-top: 6px; }
        #qc-hdr { color: #4b5563; font-size: 12px; line-height: 1.6; margin-bottom: 4px; }
        .qc-hint { color: #8a909c; font-size: 11px; line-height: 1.6; }
        /* Keyboard/cursor status. Its own line rather than part of #qc-summary,
           which updateSummary() replaces wholesale on every render. Empty by
           default and collapses to nothing until there's something to say. */
        #qc-cursor { color: #4b5563; font-size: 12px; line-height: 1.6; }
        #qc-cursor:empty { display: none; }
        .qc-kbd {
          display: inline-block; min-width: 15px; text-align: center;
          border: 1px solid #d9d9e3; border-bottom-width: 2px; border-radius: 4px;
          background: #fafbfc; color: #1f2430; font-size: 10px; font-weight: 700;
          padding: 0 3px; margin: 0 1px;
        }
      `;
      document.head.appendChild(s);
    }

    function injectPanel() {
      if (document.getElementById('qc-panel')) return;
      const p = document.createElement('div');
      p.id = 'qc-panel';
      p.style.cssText = [
        'position:fixed', 'top:8px', 'left:50%', 'transform:translateX(-50%)', 'z-index:2147483647',
        'background:#fff', 'border:1px solid #d9d9e3', 'border-radius:10px',
        'box-shadow:0 6px 24px rgba(0,0,0,.15)', 'padding:8px 14px', 'width:min(640px, 96vw)',
        'font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', 'color:#1f2430',
      ].join(';');
      p.innerHTML = `
        <div id="qc-head">
          <span style="font-weight:600;">🔍 QC Compare</span>
          <span class="qc-ver">${VERSION}</span>
          <span id="qc-summary"></span>
          <span class="qc-spacer"></span>
          <span id="qc-toggle" title="Show / hide help">▸</span>
        </div>
        <div id="qc-warn" style="display:none;"></div>
        <div id="qc-cursor"></div>
        <div id="qc-help" style="display:none;">
          <div id="qc-hdr"></div>
          <div class="qc-hint" style="display:flex;flex-wrap:wrap;gap:7px 18px;align-items:center;">
            <span style="white-space:nowrap;"><span class="qc-kbd">Z</span> Swaps Score + Remark</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">C</span> Confusing</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">X</span> Clear Label</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">1</span>–<span class="qc-kbd">9</span> Label/Score Selection</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">↑</span><span class="qc-kbd">↓</span><span class="qc-kbd">←</span><span class="qc-kbd">→</span> Move Focus (Trans)</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">O</span> Show/Hide Legend</span>
          </div>
        </div>`;
      document.body.appendChild(p);
      panelEl = p;
      summaryEl = p.querySelector('#qc-summary');
      warnEl = p.querySelector('#qc-warn');
      hdrEl = p.querySelector('#qc-hdr');
      cursorEl = p.querySelector('#qc-cursor');
      const toggle = p.querySelector('#qc-toggle');
      toggle.addEventListener('click', (e) => { e.stopPropagation(); helpOpen = !helpOpen; saveHelpOpen(); applyHelp(); });
      makePanelDraggable(p, p.querySelector('#qc-head'), toggle);
      applySavedPos(p); // use the remembered position if there is one (otherwise default top-center)
      helpOpen = loadSavedHelpOpen(); // restore whether the Legend was left open/closed last session (v1.4.2)
      updatePanelHeader(1, 2); // default header (assumes Annotator 1); renderBadges corrects it to the actual tab
      applyHelp();
    }

    const QC_POS_KEY = 'trans-tool:nova-qc-pos-v1';
    function applySavedPos(p) {
      const o = Utils.readJSON(QC_POS_KEY);
      if (o && typeof o.left === 'number' && typeof o.top === 'number') {
        p.style.left = o.left + 'px'; p.style.top = o.top + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
      }
    }
    function savePos(p) {
      const r = p.getBoundingClientRect();
      Utils.writeJSON(QC_POS_KEY, { left: Math.round(r.left), top: Math.round(r.top) });
    }
    // Whether the Legend was left open or closed, persisted (v1.4.2) so a
    // reviewer who collapses it doesn't see it re-expand on every reload.
    const QC_HELP_KEY = 'trans-tool:nova-qc-help-v1';
    function loadSavedHelpOpen() {
      try {
        const raw = localStorage.getItem(QC_HELP_KEY);
        return raw === null ? true : raw === '1'; // no saved value yet -> default expanded, same as before this existed
      } catch (e) { return true; }
    }
    function saveHelpOpen() {
      try { localStorage.setItem(QC_HELP_KEY, helpOpen ? '1' : '0'); } catch (e) {}
    }
    // Collapse/expand the help text (default expanded — see helpOpen above — so a first-time reviewer sees the full
    // explanation without having to know to expand anything, matching the original exactly).
    function applyHelp() {
      if (!panelEl) return;
      const help = panelEl.querySelector('#qc-help');
      const tg = panelEl.querySelector('#qc-toggle');
      if (help) help.style.display = helpOpen ? 'block' : 'none';
      if (tg) tg.textContent = helpOpen ? '▾' : '▸';
    }
    // Drag the header to move the panel (clicking the help toggle doesn't
    // drag); switches to left/top positioning after being dragged. Drag
    // mechanics are shared with Scoring Shortcuts and Remark Composer —
    // see utils.js.
    function makePanelDraggable(p, head, ignoreEl) {
      Utils.makeDraggable(p, head, {
        ignore: (e) => ignoreEl && (e.target === ignoreEl || ignoreEl.contains(e.target)), // clicking the collapse toggle doesn't drag
        onDrop: () => savePos(p), // remember where it was dropped
      });
    }

    // ====================================================================
    // SPA guard: re-inject the panel/styles if removed; re-add badges lost to re-render; auto re-scrape on a row change.
    // ====================================================================
    let settleTimer = null;
    function onMutate() {
      if (scraping || adopting) return; // don't touch anything during scrape/write, to avoid mis-rendering
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (scraping || adopting) return;
        injectStyle();
        injectPanel();
        const sig = getRowSig();
        if ((ready || scrapeFailed) && sig && sig !== lastRowSig) { // row changed -> re-scrape Annotator 2
          log('Row changed -> re-scraping');
          // Back to the first translation on the new row. Silent because the
          // badge hosts are about to be rebuilt by the scrape — the first
          // paint comes from render()'s cursor.sync(). Column memory is
          // deliberately kept across rows (see TransCursor).
          cursor.reset({ silent: true });
          setCursorStatus('');
          scrapeBoth();
          return;
        }
        render(); // re-add badges lost to a re-render (idempotent)
      }, 220);
    }

    // ====================================================================
    // Keyboard (added v1.3.2 — this module was mouse-only before that)
    //
    // Nothing to arbitrate against: Modules 1 and 2 both bail out on
    // /quality_ pages, so on this page the keyboard is entirely unclaimed
    // except by the platform itself.
    // ====================================================================
    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never touch modifier combos
      const n = cursor.get();
      // Esc only means "cancel the label pick" when there's actually a menu
      // open. Checked before the typing guard so it works while the
      // cascader's own search input has focus, but gated on the open menu so
      // it never steals Esc from someone typing a remark.
      if (e.key === 'Escape' && n != null && labelPopupFor(n)) {
        e.preventDefault();
        cancelLabelPick(n);
        return;
      }
      if (Utils.inTextEntry()) return; // typing in a Remarks box — the keys are for typing

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          advanceFocus();
          return;
        case 'ArrowUp':
          e.preventDefault();
          cursor.step(-1);
          return;
        // Either arrow toggles column; the direction is ignored, matching Module 1.
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          cursor.toggleColumn();
          return;
      }

      // Digits are overloaded: 2 and 3 are score keys, but 1-9/0 also pick
      // items from an open label menu. Module 1 disambiguates with a
      // `labelMode` flag; here the open menu itself is the signal, so the
      // mode is derived from the DOM rather than tracked. That matters for
      // '2' and '3' specifically — without this, "2 then 3" could never
      // reach label item #3, because '3' would always mean "3 Points".
      if (/^[0-9]$/.test(e.key) && n != null && labelPopupFor(n)) {
        e.preventDefault();
        pickLabelByNumber(n, e.key === '0' ? 10 : parseInt(e.key, 10));
        return;
      }

      const k = e.key.toLowerCase();
      // v1.4.0: moved from P to O, matching Remark Composer's open/close key.
      if (k === 'o') { e.preventDefault(); helpOpen = !helpOpen; saveHelpOpen(); applyHelp(); return; }
      if (k === 'z') {
        e.preventDefault();
        // Every Z that writes (either direction of the flip) moves on to the next translation; a refused Z stays put.
        // To flip one back, step up and press Z again.
        Promise.resolve(flip(n)).then((ok) => { if (ok && cursor.get() === n) advanceFocus(); });
        return;
      }
      if (k === 'x') { e.preventDefault(); eraseScore(n); return; }
      if (PATH_KEY[k]) { e.preventDefault(); relabel(n, PATH_KEY[k]); return; }
    }

    // ====================================================================
    // Startup
    // ====================================================================
    async function start() {
      // Only the review pass runs this module — Module 1/2 explicitly cede
      // this page to it (see their own `/\/quality_/` gates).
      if (!/\/quality_/.test(location.href)) { log('Annotation page → QC Compare not enabled'); return; }
      injectStyle();
      injectPanel();
      // Mouse only (Annotator 1 tab): click Undo = undo the adopt; click a red badge = adopt Annotator 2.
      document.addEventListener('click', (e) => {
        if (!e.target.closest) return;
        const undo = e.target.closest('.qc-undo');
        if (undo) { e.preventDefault(); e.stopPropagation(); flip(parseInt(undo.dataset.undo, 10)); return; }
        const sAdopt = e.target.closest('.qc-adopt-btn'); // the score's blue Adopt button (handled separately + stops propagation)
        if (sAdopt) { e.preventDefault(); e.stopPropagation(); flip(parseInt(sAdopt.dataset.adoptScore, 10)); return; }
        const badge = e.target.closest('.qc-badge.qc-diff'); // clicking anywhere in the red area also adopts
        if (!badge || activeTabIndex() !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const mod = badge.closest('[data-module-name]');
        const n = Utils.transNumFromModuleName(mod, ' Score');
        if (n === null) return;
        flip(n);
      }, true);
      // A remark typed on a tab: keep Annotator 1's snapshot current (Annotator 2's tab compares against it) and
      // refresh the badges. Writes this module makes itself (Z) are ignored.
      const refreshForRemark = Utils.rafThrottle(render);
      document.addEventListener('input', (e) => {
        const ta = e.target;
        if (!ta || ta.tagName !== 'TEXTAREA' || adopting || scraping || !ta.closest) return;
        const n = Utils.transNumFromModuleName(ta.closest('[data-module-name]'), ' Remarks');
        if (n === null) return;
        remarkTouched = true;
        if (activeTabIndex() === 0) remA[n] = ta.value;
        refreshForRemark();
      }, true);
      document.addEventListener('keydown', onKeyDown, true); // capture, matching Scoring Shortcuts
      new MutationObserver(onMutate).observe(document.body, { childList: true, subtree: true });
      // Wait for the scoring controls + both tabs to be ready before scraping.
      try {
        await Utils.waitFor(() => getTabs().length >= 2 && scoreableTrans().length > 0, 8000);
      } catch (e) {
        log('Timed out waiting for the page to be ready — the observer will trigger a scrape later');
      }
      cursor.reset({ silent: true }); // land on Trans1 (render() paints it once the scrape lands)
      await scrapeBoth();
      log(`Started ${VERSION}`);
    }

    return { start };
  }

  TL.QCCompare = QCCompare;
})();
