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
  // original. Rewrite gets the same whole-field treatment via an inline
  // compare box under the field. A summary panel names what's still
  // outstanding.
  //
  // This is a faithful, freshly re-derived port of the original v0.1.83
  // script's Module 3 (lines 1343–2193 of that script, kept outside this
  // repo) — see `canonPath` below for the cascade-matching fix
  // this module depends on (get this wrong and multi-level adopts silently
  // fail while single-level ones look fine). Two deliberate departures from
  // the original, both requested: the verdict buttons are driven to "1" /
  // "3" instead of "correct" / "wrong", and Remarks uses stateless
  // per-line "＋ Add" buttons instead of the original's whole-field
  // Adopt/Undo. No resize handle, and no verdict-reload fallback — an
  // earlier build tried both; the reload fallback had a real loop bug (see
  // README.md's v1.3.0 note) and was deliberately left out of this rebuild.
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

    // Read-only reflection of Remark Options' check mode (v1.4.1). Remark
    // Composer never runs on /quality_ pages (see its own start(), which
    // bails out there), so this page has no live check state of its own —
    // it just reads the same localStorage key remark-composer.js's
    // SCORE_CHECK_KEY writes, duplicated here as a plain string since that
    // module's internals aren't exported.
    const QC_CHECK_MODES = ['label', 'submit', 'off'];
    const QC_CHECK_STYLES = {
      label: { text: '🛡️ Label Check', bg: '#ebfbee', fg: '#2b8a3e', border: '#b2f2bb' },
      submit: { text: '⚔️ Submit Check', bg: '#eef1fb', fg: '#3b5bdb', border: '#bac8f7' },
      off: { text: '⚠️ Check OFF', bg: '#fff0f0', fg: '#c92a2a', border: '#ffc9c9' },
    };
    const QC_CHECK_KEY = 'trans-tool:nova-score-check-v1';
    const DEBUG = false;
    function log(msg) { if (DEBUG) console.log(`${TAG} ${msg}`); }

    const TRANS_MAX = 7;
    // Row-level long-text fields (one per row, not per-Trans): also compared + adoptable.
    const TEXT_FIELDS = [
      { key: 'remarks', module: 'Remarks', label: 'Remarks' },
      { key: 'rewrite', module: 'Rewrite', label: 'Rewrite' },
    ];

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
    let textA = {};              // Annotator 1 long-text snapshot: { remarks, rewrite } (raw, not trimmed)
    let textB = {};              // Annotator 2 long-text snapshot
    let adoptedText = new Map(); // adopted text field key -> the original Annotator 1 text (was/undo); cleared on a row change
    let scraping = false;        // currently switching tabs to scrape (don't render badges now, or Annotator 2's value gets rendered as Annotator 1)
    let adopting = false;        // currently adopting/writing a value (driving the cascader; don't let the observer mis-render now)
    let verifyIv = null;         // post-scrape self-correction poll handle (detects a snapshot gone stale from lazy-loaded textareas)
    let verifyRetries = 0;       // number of re-scrapes this row triggered by correction (guards against infinite re-scrape in edge cases)
    let ready = false;           // scraped successfully at least once
    let lastRowSig = '';         // row signature; re-scrape on a row change
    let diffNums = [];           // trans numbers currently disagreeing (for the summary count)
    let adopted = new Map();     // adopted Trans -> the original Annotator 1 value (was/undo); cleared on a row change
    let panelEl = null, summaryEl = null, hdrEl = null, warnEl = null, cursorEl = null;
    let checkPillEl = null;      // read-only Check Icon pill, shown while the Legend is hidden (v1.4.1)
    let helpOpen = true;         // whether the panel help text is expanded (default expanded so the intro is fully visible)
    let labelBusy = false;       // guards against double-firing while a label-menu click is mid-flight

    function escapeHtml(s) { return Utils.escapeHtml(s); }

    // Match Trans references in Remarks, case-insensitive:
    //   prefix Trans / Translation (optional plural s); followed by numbers, as a list or a range:
    //   Trans1 · Trans 1 · Translation 1 · Trans 1, 2 · Trans1/2 · Trans 1 & 2 · Trans 1+2 · Trans 1 and 2 · Trans 1-3 · Trans 1 to 3
    //   a hyphen must be immediately followed by a digit -> "Trans 4 - By saying..." (text after the dash) is just Trans 4, not misread as a range
    const TRANS_REF_RE = /Trans(?:lation)?s?\s*\d+(?:\s*(?:[,/&+~-]|to|and)\s*\d+)*/gi;
    // Pull all trans numbers out of a reference (expanding ranges a-b / a~b / a to b).
    function numsInRef(ref) {
      const expanded = ref.replace(/(\d+)\s*(?:-|~|to)\s*(\d+)/gi, (mm, a, b) => {
        a = +a; b = +b; const out = [];
        if (a <= b && b - a <= 30) { for (let i = a; i <= b; i++) out.push(i); } else { out.push(a, b); }
        return out.join(',');
      });
      return (expanded.match(/\d+/g) || []).map(Number);
    }

    // After escaping, highlight "Trans N (list)": wrap the whole reference; numbers in redSet are red (a violation), the rest yellow.
    function highlightTrans(s, redSet) {
      return escapeHtml(s).replace(TRANS_REF_RE, (m) => {
        const bad = redSet && redSet.size && numsInRef(m).some((n) => redSet.has(n));
        return `<span class="qc-tref${bad ? ' qc-tref-bad' : ''}">${m}</span>`;
      });
    }
    function referencedTransNums(text) {
      const set = new Set();
      let m;
      const re = new RegExp(TRANS_REF_RE.source, 'gi'); // its own lastIndex, to avoid clashing with the global regex
      while ((m = re.exec(text))) numsInRef(m[0]).forEach((n) => { if (n >= 1 && n <= TRANS_MAX) set.add(n); });
      return set;
    }
    // Rule: a translation scored exactly "3 Points" should have no remark written about it -> return the Trans numbers
    // that are both 3 Points and referenced in Remarks (live value of the current tab).
    function get3PtRemarkViolations() {
      const referenced = referencedTransNums(readFieldRaw('Remarks'));
      const out = [];
      for (let n = 1; n <= TRANS_MAX; n++) {
        if (normText(readScore(n)) === '3 Points' && referenced.has(n)) out.push(n);
      }
      return out;
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
    function readScore(n) {
      const mod = scoreModule(n);
      if (!mod) return '';
      const item = mod.querySelector('.ant-select-selection-item');
      return item ? item.textContent.trim() : ''; // empty string = not scored
    }
    // Trans numbers on this row that have both a translation and a scoring control (empty translations aren't compared).
    function scoreableTrans() {
      const out = [];
      for (let n = 1; n <= TRANS_MAX; n++) if (scoreModule(n) && Utils.transHasText(n)) out.push(n);
      return out;
    }
    // Row signature: the source (笔记外文翻译) differs per row -> row-change detection.
    function getRowSig() {
      const src = document.querySelector('[data-module-name="笔记外文翻译"]');
      return src ? src.textContent.trim().slice(0, 80) : '';
    }

    // ---------- Long-text fields (Remarks / Rewrite) read/write ----------
    function fieldTextarea(moduleName) {
      const m = document.querySelector(`[data-module-name="${moduleName}"]`);
      return m ? m.querySelector('textarea') : null;
    }
    function readFieldRaw(moduleName) {
      const ta = fieldTextarea(moduleName);
      return ta ? ta.value : '';
    }
    function normText(s) { return String(s == null ? '' : s).trim(); } // ignore leading/trailing whitespace when comparing, to reduce noise

    // ---------- Overlay a "transparent text + translucent highlight" layer on the platform's native (editable) Remarks/Rewrite textarea ----------
    // pointer-events:none so it doesn't block input; it must match the textarea's font/box-model/scroll exactly, so the highlight lands on Trans N.
    const HL_COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
      'textAlign', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
    function ensureHLOverlay(ta, key) {
      const wrap = ta.parentElement;
      if (!wrap) return null;
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      let ov = wrap.querySelector(`:scope > .qc-hl[data-hl="${key}"]`);
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'qc-hl';
        ov.setAttribute('data-hl', key);
        wrap.appendChild(ov); // placed after the textarea -> layered on top of it (z-index)
      }
      return ov;
    }
    function syncHLOverlay(ta, ov, redSet) {
      const cs = getComputedStyle(ta);
      for (const p of HL_COPY) ov.style[p] = cs[p];
      ov.style.left = ta.offsetLeft + 'px';
      ov.style.top = ta.offsetTop + 'px';
      ov.style.width = ta.offsetWidth + 'px';
      ov.style.height = ta.offsetHeight + 'px';
      const v = ta.value;
      const html = highlightTrans(v, redSet) + (v.endsWith('\n') ? '\n' : ''); // add a trailing newline to align line heights
      if (ov.innerHTML !== html) ov.innerHTML = html;
      ov.scrollTop = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
    }
    function syncFieldHighlights() {
      const violations = new Set(get3PtRemarkViolations()); // a 3-Points Trans that still has a remark -> mark it red in Remarks
      for (const f of TEXT_FIELDS) {
        const ta = fieldTextarea(f.module);
        if (!ta) continue;
        const ov = ensureHLOverlay(ta, f.key);
        if (ov) syncHLOverlay(ta, ov, f.key === 'remarks' ? violations : null);
      }
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

    function popupsVisible() {
      return Array.from(document.querySelectorAll('.ant-select-dropdown'))
        .filter((p) => getComputedStyle(p).display !== 'none');
    }
    // Gap from the dropdown's top to the select's bottom (a dropdown always hugs its own trigger) -> distinguishes this control's dropdown from another Trans's.
    function edgeGap(popup, sr) {
      const pr = popup.getBoundingClientRect();
      if ((popup.className || '').indexOf('placement-top') >= 0) return Math.abs(pr.bottom - sr.top);
      return Math.abs(pr.top - sr.bottom);
    }
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
    // Close every "expanded" cascader (via aria-expanded=true) to prevent stale-dropdown cross-talk.
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

    // Click a red badge -> write Annotator 2's value into Trans n of Annotator 1 (mouse only, no keyboard).
    async function adoptOther(n) {
      if (scraping || adopting || !ready) return;
      if (activeTabIndex() !== 0) { setSummary('<span style="color:#c92a2a;">Switch to the <b>Annotator&nbsp;1</b> tab to swap.</span>'); return; }
      const target = snapB[n] || '';
      if (!target) { setSummary(`Annotator 2 has no score for Trans${n} — set it manually.`); return; }
      const prev = readScore(n); // the value before adopting (Annotator 1) -> saved for "was..." + undo
      adopting = true;
      setSummary(`Swapping Trans${n} to Annotator 2…`);
      try {
        await writeCascade(n, target);
        if (!adopted.has(n)) adopted.set(n, prev); // record the original only on the first adopt (repeat clicks don't overwrite)
        snapA[n] = target; // Annotator 1 now = Annotator 2 -> update the snapshot so it stays consistent when you view Annotator 2
        log(`Trans${n}: adopted Annotator 2 = ${target} (was ${prev || 'empty'})`);
      } catch (e) {
        console.error(`${TAG} Adopt failed:`, e);
        setSummary(`⚠️ Trans${n}: could not apply Annotator 2 (see console).`);
      } finally {
        adopting = false;
        render();
      }
    }

    // Undo the adopt: write the original Annotator 1 value back (clear it if it wasn't scored).
    async function undoAdopt(n) {
      if (scraping || adopting || !ready) return;
      if (activeTabIndex() !== 0) return;
      if (!adopted.has(n)) return;
      const prev = adopted.get(n);
      adopting = true;
      setSummary(`Undoing Trans${n}…`);
      try {
        if (prev) await writeCascade(n, prev);
        else await clearCascade(n); // wasn't scored originally -> clear
        snapA[n] = prev;
        adopted.delete(n);
        log(`Trans${n}: undone, restored to ${prev || '(empty)'}`);
      } catch (e) {
        console.error(`${TAG} Undo failed:`, e);
        setSummary(`⚠️ Trans${n}: undo failed (see console).`);
      } finally {
        adopting = false;
        render();
      }
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
        adopted.delete(n); // a hand-set value is no longer "adopted from Annotator 2"
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
        adopted.delete(n);
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
      adopted.delete(n);
      setCursorStatus(got ? `Trans${n} = ${got} ✓` : `⚠️ Trans${n}: label didn't register`);
      render();
    }

    // Close the label menu without picking anything (Esc).
    async function cancelLabelPick(n) {
      await closeOpenCascaders();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      setCursorStatus(n == null ? 'Label pick cancelled' : `Trans${n}: label pick cancelled`);
    }

    // Adopt Annotator 2's long text (Remarks/Rewrite) -> write the whole thing into Annotator 1's field (the field is editable, so you can hand-mix parts).
    // Remarks doesn't use this — see appendRemarkLine below.
    function adoptFieldText(key) {
      if (scraping || adopting || !ready) return;
      if (activeTabIndex() !== 0) { setSummary('<span style="color:#c92a2a;">Switch to the <b>Annotator&nbsp;1</b> tab to swap.</span>'); return; }
      const f = TEXT_FIELDS.find((x) => x.key === key);
      const ta = f && fieldTextarea(f.module);
      if (!ta) return;
      const target = textB[key] != null ? textB[key] : '';
      const prev = ta.value;
      adopting = true;
      try {
        Utils.setNativeValue(ta, target);
        if (!adoptedText.has(key)) adoptedText.set(key, prev);
        textA[key] = target; // Annotator 1 now = Annotator 2
        log(`${f.label}: adopted Annotator 2`);
      } catch (e) {
        console.error(`${TAG} Adopt (long text) failed:`, e);
      } finally {
        adopting = false;
        render();
      }
    }
    // Undo the long-text adopt -> write the original Annotator 1 text back.
    function undoFieldText(key) {
      if (scraping || adopting || !ready) return;
      if (activeTabIndex() !== 0) return;
      if (!adoptedText.has(key)) return;
      const f = TEXT_FIELDS.find((x) => x.key === key);
      const ta = f && fieldTextarea(f.module);
      if (!ta) return;
      const prev = adoptedText.get(key);
      adopting = true;
      try {
        Utils.setNativeValue(ta, prev);
        textA[key] = prev;
        adoptedText.delete(key);
        log(`${f.label}: undone`);
      } catch (e) {
        console.error(`${TAG} Undo (long text) failed:`, e);
      } finally {
        adopting = false;
        render();
      }
    }

    // ====================================================================
    // Per-line Remarks append — the one deliberate departure from the
    // original's whole-field Adopt/Undo (Rewrite keeps that pattern
    // unchanged above; Remarks does not, because reconciling Remarks into
    // one agreed text isn't the goal here — pulling useful lines from
    // Annotator 2's notes into Annotator 1's own write-up is). Annotator
    // 2's Remarks is listed one row per line (split on literal `\n`, not
    // "Trans N" boundaries — too unreliable, misspellings, "Trans 1-7",
    // etc.), each with its own button that appends exactly that line's
    // text to the end of Annotator 1's Remarks.
    //
    // Deliberately stateless: the button never reads what's currently in
    // the box, never tracks what it's already added, and never rewrites or
    // reorders anything already there — it only ever appends. Clicking the
    // same row twice appends it twice; undo is the textarea's own native
    // undo. Only the button writes (the row itself isn't clickable), so
    // reading through the suggestions can't paste one by accident.
    // ====================================================================
    function splitRemarkLines(text) {
      // Row indices must stay stable against what's rendered, so this never filters/renumbers — a blank line still
      // gets its own row (rendered as a non-actionable placeholder, see renderTextCompare).
      return String(text == null ? '' : text).split('\n');
    }
    // Append one line of Annotator 2's Remarks to the end of Annotator 1's Remarks field. The only judgement call it
    // makes is the separator: start a fresh line unless the field is currently empty.
    function appendRemarkLine(idx) {
      if (scraping || adopting || !ready) return;
      if (activeTabIndex() !== 0) { setSummary('<span style="color:#c92a2a;">Switch to the <b>Annotator&nbsp;1</b> tab to add a line.</span>'); return; }
      const line = splitRemarkLines(textB.remarks)[idx];
      if (line == null || !line.trim()) return;
      const ta = fieldTextarea('Remarks');
      if (!ta) return;
      const cur = ta.value;
      const next = cur.trim() ? cur.replace(/\s+$/, '') + '\n' + line : line;
      Utils.setNativeValue(ta, next);
      // Keep textA.remarks in lockstep with what was just written — every other write path in this module does the
      // same (adoptOther updates snapA, adoptFieldText/undoFieldText update textA). Skipping this here would leave
      // textA.remarks stale, and scheduleTextVerify's staleness check (a few lines below) would then misread this
      // deliberate write as the platform's lazy-load bug and force a phantom re-scrape — its only guard against that
      // is "is the textarea itself focused," which a click on this button never triggers.
      textA.remarks = next;
      log(`Remarks: appended Annotator 2's line ${idx + 1}`);
      render();
      // One frame later (see Module 2's focusEditEnd for why synchronous focus loses a fight with the browser pulling
      // it back toward the button that was just clicked): focus the real Remarks field and put the caret at the end —
      // makes the whole interaction one click instead of click-then-manually-click-the-box.
      //
      // v1.3.1 also scrolled the field's own content down to reveal the appended line. That's gone as of v1.3.2: the
      // field now grows to fit its content and never scrolls internally, so there was nothing left to scroll.
      requestAnimationFrame(() => {
        ta.focus();
        try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
        syncFieldHighlights(); // the field just got taller — re-measure the Trans-N highlight overlay
      });
    }

    // ====================================================================
    // Scrape both: stay on Annotator 1 -> read A (the live value) -> click Annotator 2, read B -> click back to Annotator 1.
    // ====================================================================
    async function scrapeBoth(isVerifyRetry) {
      const tabs = getTabs();
      if (tabs.length < 2) { ready = false; log('Only one annotator — nothing to compare'); setSummary('Only one annotator — nothing to compare.'); return; }
      if (!isVerifyRetry) verifyRetries = 0; // a real row change -> reset the correction retry count
      if (verifyIv) { clearInterval(verifyIv); verifyIv = null; }
      scraping = true;
      adopted.clear(); adoptedText.clear(); // new row -> clear the previous row's adopt/undo records
      extraSel = null; // new row's Remarks/Rewrite content is unrelated to the old selection
      clearBadges(); clearTextBoxes();
      setSummary('Loading Annotator 2…');
      try {
        await clickTab(0); // make sure we're on Annotator 1 (the baseline)
        const nums = scoreableTrans();
        const a = {}, ta = {};
        for (const n of nums) a[n] = readScore(n);                       // read Annotator 1 scores
        for (const f of TEXT_FIELDS) ta[f.key] = readFieldRaw(f.module); // read Annotator 1 long text
        ensureVerdict('right'); // fixed rule: Annotator 1 gets verdict "1" (skip if already marked)
        await clickTab(1);                                              // switch to Annotator 2
        const b = {}, tb = {};
        for (const n of nums) b[n] = readScore(n);                       // read Annotator 2 scores
        for (const f of TEXT_FIELDS) tb[f.key] = readFieldRaw(f.module); // read Annotator 2 long text
        ensureVerdict('wrong'); // fixed rule: Annotator 2 gets verdict "3" (skip if already marked)
        await clickTab(0);                                              // switch back to Annotator 1
        snapA = a; snapB = b; textA = ta; textB = tb;
        ready = true;
        lastRowSig = getRowSig();
        log(`Scrape complete · A: ${nums.map((n) => `T${n}=${a[n] || 'empty'}`).join(' / ')} · B: ${nums.map((n) => `T${n}=${b[n] || 'empty'}`).join(' / ')}`);
      } catch (e) {
        ready = false;
        console.error(`${TAG} Scraping Annotator 2 failed:`, e);
        setSummary('⚠️ Could not read Annotator 2 (see console).');
      } finally {
        scraping = false;
        render();
        scheduleTextVerify(); // start self-correction: watch whether lazy-loaded textareas made the snapshot stale
      }
    }

    // Post-scrape self-correction: the platform sometimes lazy-loads this row's Remarks/Rewrite text (especially under
    // load), so the snapshot ends up being the previous row's. Poll briefly: if the current tab (Annotator 1) textarea's
    // actual content differs from the snapshot and the user isn't typing in it (no focus) -> it's platform lazy-loading
    // -> auto re-scrape once to fix it.
    function scheduleTextVerify() {
      if (verifyIv) { clearInterval(verifyIv); verifyIv = null; }
      let tries = 0;
      verifyIv = setInterval(() => {
        if (scraping || adopting) return; // busy, wait for the next tick
        if (!ready || activeTabIndex() !== 0) { clearInterval(verifyIv); verifyIv = null; return; }
        const ae = document.activeElement;
        if (ae && ae.tagName === 'TEXTAREA') { clearInterval(verifyIv); verifyIv = null; return; } // the user is editing -> stop, don't interrupt
        const stale = TEXT_FIELDS.some((f) => normText(textA[f.key] || '') !== normText(readFieldRaw(f.module)));
        if (stale) {
          clearInterval(verifyIv); verifyIv = null;
          if (verifyRetries >= 4) { log('Self-correction retry cap reached, giving up'); return; }
          verifyRetries++;
          log('Stale long-text snapshot detected (platform lazy-load) -> auto re-scraping to correct');
          scrapeBoth(true);
          return;
        }
        if (++tries > 25) { clearInterval(verifyIv); verifyIv = null; } // ~2.5s with no issue -> done
      }, 100);
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
      const otherLabel = onB ? 'Annotator 1' : 'Annotator 2';
      updatePanelHeader(onB ? 2 : 1, onB ? 1 : 2); // header: You are on Annotator X, viewing Y's values
      const nums = scoreableTrans();
      const diffs = [];
      for (let n = 1; n <= TRANS_MAX; n++) {
        const mod = scoreModule(n);
        if (!mod) continue;
        if (nums.indexOf(n) === -1) { // empty translation / not comparable -> no badge
          const old = mod.querySelector('.qc-badge'); if (old) old.remove();
          continue;
        }
        const cur = readScore(n);      // the live value of the current tab (= the current annotator)
        const other = otherSnap[n] || ''; // the other annotator's snapshot value
        const same = cur === other;
        if (!same) diffs.push(n);
        const badge = ensureBadge(mod);
        let html, cls;
        if (!onB && adopted.has(n)) { // show "adopted + original + undo" only on the Annotator 1 tab
          const prev = adopted.get(n);
          html = `✓ Swapped to Annotator 2 <span class="qc-was">· was: ${escapeHtml(prev || '(not scored)')}</span> <span class="qc-undo" data-undo="${n}">Undo</span>`;
          cls = 'qc-badge qc-adopted';
        } else if (same) {
          html = `✓ ${otherLabel} agrees`;
          cls = 'qc-badge qc-same';
        } else {
          html = `<span class="qc-bd-val">≠ ${otherLabel}: ${escapeHtml(other || '(not scored)')}</span><span class="qc-adopt-btn" data-adopt-score="${n}">Swap →</span>`;
          cls = 'qc-badge qc-diff';
        }
        if (badge.innerHTML !== html) badge.innerHTML = html; // write only on change, to avoid triggering a needless mutation
        if (badge.className !== cls) badge.className = cls;
      }
      diffNums = diffs;
      updateSummary();
    }

    // ---------- Long-text (Remarks/Rewrite) inline compare box ----------
    // Note: these modules are locked to a fixed height by the layout (e.g. Remarks h=300, overflow:visible), so appending
    // the box inside a module overflows below it and gets covered by the next module -> invisible. So instead insert it
    // right after the module (as a sibling in the column flow); it takes its own space and pushes later modules down.
    function ensureTextBox(mod, key) {
      let b = document.querySelector(`.qc-textbox[data-qc-for="${key}"]`);
      if (!b) {
        b = document.createElement('div');
        b.className = 'qc-textbox';
        b.setAttribute('data-qc-for', key);
      }
      // The module may be re-rendered into a new node -> re-anchor the box right after the current module every time.
      if (b.previousElementSibling !== mod && mod.parentNode) {
        mod.parentNode.insertBefore(b, mod.nextSibling);
      }
      return b;
    }
    function clearTextBoxes() { document.querySelectorAll('.qc-textbox').forEach((b) => b.remove()); }

    function renderTextCompare() {
      if (scraping || adopting || !ready) return;
      const activeIdx = activeTabIndex();
      if (activeIdx === -1) return;
      const onB = activeIdx === 1;
      const otherLabel = onB ? 'Annotator 1' : 'Annotator 2';
      for (const f of TEXT_FIELDS) {
        const mod = document.querySelector(`[data-module-name="${f.module}"]`);
        if (!mod) continue;
        const cur = readFieldRaw(f.module);                       // the live text in the current tab's field
        const other = (onB ? textA[f.key] : textB[f.key]) || '';  // the other annotator's text
        const same = normText(cur) === normText(other);
        const box = ensureTextBox(mod, f.key);
        let html, cls;
        if (f.key === 'remarks') {
          // Per-line append — Remarks alone, deliberately different from the whole-field Adopt/Undo every other
          // field below uses. Each of Annotator 2's lines is a suggestion the reviewer can drop into their own
          // Remarks with one click; nothing is compared, replaced, or tracked.
          //
          // No `same` branch here on the Annotator 1 tab, unlike every other field: `same` is recomputed from the
          // *live* field on each render, so on the very common "Annotator 1 wrote nothing, Annotator 2 wrote one
          // line" row, the first ＋ Add would make the two texts equal and the suggestion list would replace
          // itself with "matches" — the tool disappearing the moment it's used. "Same" also doesn't mean "nothing
          // left to do" here: these two remarks are never meant to converge.
          if (onB && same) {
            cls = 'qc-textbox qc-tb-same';
            html = `✓ ${otherLabel}'s ${f.label} matches`;
          } else if (onB) {
            // Read-only reference on the Annotator 2 tab — appending only makes sense on Annotator 1's tab
            // (same activeTabIndex()===0 gate every other write action already uses).
            cls = 'qc-textbox qc-tb-ref';
            html = `<div class="qc-tb-head"><span>${otherLabel}'s ${f.label}</span></div>`
                 + `<div class="qc-tb-body">${highlightTrans(other || '(empty)')}</div>`;
          } else {
            // Neutral styling, not the red "differs" treatment the scores and Rewrite use: a Remarks that reads
            // differently from Annotator 2's is normal and isn't counted as outstanding work (see updateSummary).
            cls = 'qc-textbox qc-tb-ref';
            const lines = splitRemarkLines(textB.remarks);
            const rows = lines.map((line, i) => {
              // Blank lines get a placeholder row with no button — nothing to add.
              if (!line.trim()) {
                return '<div class="qc-tb-pick-row qc-tb-pick-row-blank"><span class="qc-tb-pick-bullet">·</span>'
                     + '<span class="qc-tb-pick-text qc-tb-was">(blank line)</span></div>';
              }
              return `<div class="qc-tb-pick-row"><span class="qc-tb-pick-bullet">•</span>`
                   + `<span class="qc-tb-pick-text">${highlightTrans(line)}</span>`
                   + `<span class="qc-tb-append" data-append-line="${i}" title="Append this line to your Remarks (追加到本人 Remarks)">＋ Add</span></div>`;
            }).join('');
            const hint = textB.remarks && textB.remarks.trim()
              ? 'click ＋ Add to paste a line into your Remarks'
              : 'nothing written';
            html = `<div class="qc-tb-head"><span>${otherLabel}'s ${f.label} — ${hint}</span></div>`
                 + `<div class="qc-tb-picklist">${rows}</div>`;
          }
        } else if (!onB && adoptedText.has(f.key)) { // Annotator 1 only: adopted -> show the original + Undo
          const prev = adoptedText.get(f.key);
          cls = 'qc-textbox qc-tb-adopted';
          html = `<div class="qc-tb-head"><span>✓ Swapped to Annotator&nbsp;2's ${f.label}</span><span class="qc-spacer"></span><span class="qc-tb-undo" data-undo-text="${f.key}">Undo</span></div>`
               + `<div class="qc-tb-was">was (Annotator&nbsp;1):</div><div class="qc-tb-body">${highlightTrans(prev || '(empty)')}</div>`;
        } else if (same) {
          cls = 'qc-textbox qc-tb-same';
          html = `✓ ${otherLabel}'s ${f.label} matches`;
        } else {
          cls = 'qc-textbox qc-tb-diff';
          const adoptBtn = onB ? '' : `<span class="qc-tb-adopt" data-adopt-text="${f.key}">Swap →</span>`;
          html = `<div class="qc-tb-head"><span>≠ ${otherLabel}'s ${f.label}</span><span class="qc-spacer"></span>${adoptBtn}</div>`
               + `<div class="qc-tb-body">${highlightTrans(other || '(empty)')}</div>`;
        }
        if (box.className !== cls) box.className = cls;
        if (box.innerHTML !== html) box.innerHTML = html; // write only on change, to avoid mutation feedback
      }
      syncFieldHighlights(); // sync the Trans N highlight overlay on the platform's editable field
    }

    // Full render: score badges + long-text compare boxes + rule checks.
    // cursor.sync() last: the platform's re-renders replace the badge hosts,
    // which takes the selection highlight with them, so it gets restored the
    // same way the badges themselves do. renderBadges bails while !ready, so
    // nothing paints until the scrape completes — which is what we want,
    // since the hosts are being rebuilt anyway.
    function render() { renderBadges(); renderTextCompare(); updateWarn(); cursor.sync(); reapplyExtHighlight(); }

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
        // rewrites that on every render and would fight the marker.
        //
        // No feedback-loop guard needed here (unlike the innerHTML writes in
        // renderBadges): the observer watches childList/subtree only, with no
        // `attributes: true`, so a classList toggle can't retrigger it.
        document.querySelectorAll('.qc-active-score').forEach((el) => el.classList.remove('qc-active-score'));
        if (num === null) return;
        const mod = scoreModule(num);
        if (!mod) return;
        (mod.querySelector('.cascade-container') || mod).classList.add('qc-active-score');
        // Arrow keys pass scroll:true; a plain repaint from render() doesn't.
        // Without this the highlight walks off the bottom of a long row and
        // the view never follows it.
        if (scroll) mod.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    });

    // Swap the cursor's translation between the two annotators' values.
    // Formerly one-way "Adopt" plus a separate Undo click; the pair was
    // already a clean toggle, so `S` just makes it reversible in one key.
    // Note the naming split: user-facing text says "Swap", the underlying
    // functions keep their adopt/undo names — renaming those would churn the
    // data-attribute click delegation for no behavioral gain.
    function swap(n) {
      if (n == null) { setCursorStatus('No translation selected'); return; }
      return adopted.has(n) ? undoAdopt(n) : adoptOther(n);
    }

    // ====================================================================
    // Extended selection: Remarks +Add lines and Rewrite (added v1.3.5)
    //
    // The shared TransCursor only knows Trans numbers (it's also used by
    // Module 1, which has no Remarks/Rewrite concept), so rather than
    // teaching it non-Trans items, this is a small parallel selection layer
    // local to this module: ↓ past the last Trans hands off into this list,
    // ↑ from its first item hands back to the last Trans. Deliberately no
    // wraparound at either end, matching TransCursor.step's own clamping.
    // ====================================================================
    let extraSel = null; // null | { type: 'remark', idx } | { type: 'rewrite' }

    // Indices (into splitRemarkLines(textB.remarks)) of lines that actually
    // have a "+ Add" button — i.e. exactly the rows renderTextCompare draws
    // in the picklist branch (lines ~3202-3221 above): Annotator 1's tab
    // only, remarks or not (per that branch's own comment, the picklist
    // shows regardless of match), blank lines excluded (no button).
    function remarkAddLines() {
      if (!ready || activeTabIndex() !== 0) return [];
      const out = [];
      splitRemarkLines(textB.remarks || '').forEach((line, i) => { if (line.trim()) out.push(i); });
      return out;
    }
    // Whether the Rewrite "Swap →" control is currently renderable — same gate renderTextCompare's adoptBtn uses.
    function rewriteAvailable() {
      return ready && activeTabIndex() === 0 && !!document.querySelector('[data-module-name="Rewrite"]');
    }
    function extList() {
      const out = remarkAddLines().map((idx) => ({ type: 'remark', idx }));
      if (rewriteAvailable()) out.push({ type: 'rewrite' });
      return out;
    }
    function sameExt(a, b) { return !!a && !!b && a.type === b.type && a.idx === b.idx; }

    // Paint (or clear) the extended-selection highlight. Mirrors the
    // cursor's own onChange above, but on the Remarks/Rewrite boxes instead
    // of a Trans score module.
    function selectExt(item, { scroll = true } = {}) {
      document.querySelectorAll('.qc-active-score, .qc-active-pick').forEach((el) => el.classList.remove('qc-active-score', 'qc-active-pick'));
      extraSel = item;
      if (!item) return;
      let el = null;
      if (item.type === 'remark') {
        const btn = document.querySelector(`.qc-tb-append[data-append-line="${item.idx}"]`);
        el = btn && btn.closest('.qc-tb-pick-row');
        setCursorStatus(`Remark line ${item.idx + 1} selected`);
      } else {
        el = document.querySelector('.qc-textbox[data-qc-for="rewrite"]');
        setCursorStatus('Rewrite selected');
      }
      if (!el) { extraSel = null; return; } // content changed under us — fail quiet, not broken
      el.classList.add('qc-active-pick');
      if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    // Re-apply the extended highlight after a re-render rebuilt the DOM it lives on (renderTextCompare rewrites
    // innerHTML wholesale) — same reason cursor.sync() exists for the Trans badges. Also the one place that catches a
    // switch to Annotator 2's tab: extraSel is only explicitly cleared on a row change (scrapeBoth), but a plain tab
    // click re-renders this same render() path without changing the row, so a Rewrite selection made on Annotator 1's
    // tab would otherwise keep showing highlighted on Annotator 2's tab — where neither the +Add buttons nor the
    // Swap control exist, so nothing was actually reachable there, only visually stale. Re-validating against the
    // *current* extList() on every render (not just checking the element still exists, which the Rewrite box always
    // does regardless of tab) is what actually catches that.
    function reapplyExtHighlight() {
      if (!extraSel) return;
      if (!extList().some((x) => sameExt(x, extraSel))) {
        extraSel = null;
        document.querySelectorAll('.qc-active-pick').forEach((el) => el.classList.remove('qc-active-pick'));
        return;
      }
      selectExt(extraSel, { scroll: false });
    }

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
    // updateSummary() rewrites summaryEl wholesale at the end of every
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
    // Rewrite is included because it has the same whole-field Adopt/Undo as scores; Remarks deliberately isn't — the
    // two annotators' remarks are expected to read differently, and the per-line ＋ Add list is its reconciliation UI.
    function updateSummary() {
      if (!summaryEl) return;
      const total = scoreableTrans().length; // number of translations being compared (empty ones excluded)
      const adoptedCount = adopted.size + adoptedText.size; // scores + Rewrite, so adopting Rewrite shows as progress too
      const done = adoptedCount ? `<span style="color:#2b8a3e;"> · ${adoptedCount} swapped</span>` : '';
      // Compare against the *other* tab's snapshot, the same way renderBadges picks otherSnap — on the Annotator 2 tab
      // the live Rewrite field is Annotator 2's own, so comparing it to textB would always report "no difference".
      const otherRewrite = (activeTabIndex() === 1 ? textA.rewrite : textB.rewrite) || '';
      const rewriteDiff = ready && normText(otherRewrite) !== normText(readFieldRaw('Rewrite'));
      const parts = [];
      if (diffNums.length) parts.push(`Trans ${diffNums.join(', ')}`);
      if (rewriteDiff) parts.push('Rewrite');
      if (!parts.length) {
        summaryEl.innerHTML = `<span style="color:#2f9e44;font-weight:600;">Nothing left to reconcile ✓</span>`
          + `<span style="color:#8a909c;"> · ${total} translations compared</span>${done}`;
        return;
      }
      const n = diffNums.length + (rewriteDiff ? 1 : 0);
      summaryEl.innerHTML = `<span style="color:#c92a2a;font-weight:600;">${n} still to reconcile: ${parts.join(' · ')}</span>`
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
        .qc-badge.qc-adopted { color: #2b8a3e; background: #ebfbee; border: 1px solid #b2f2bb; }
        .qc-badge .qc-was { color: #868e96; font-weight: 400; }
        .qc-badge .qc-undo { color: #1c7ed6; cursor: pointer; text-decoration: underline; font-weight: 600; margin-left: 6px; }
        .qc-badge .qc-undo:hover { color: #1971c2; }

        /* Arrow-key selection highlight. Defined here rather than reusing
           Module 1's .tl-active-score: that rule lives in Module 1's own
           stylesheet, and Module 1 bails out on /quality_ pages, so it is
           never injected here. Same amber-on-pale-yellow look, so the two
           pages read the same way. */
        .qc-active-score {
          outline: 2px solid #f0a500 !important;
          outline-offset: 2px;
          background: rgba(255, 221, 87, .30) !important;
          border-radius: 6px;
        }

        /* Extended-selection highlight (Remarks +Add line / Rewrite, added v1.3.5) — same look as .qc-active-score,
           applied to a .qc-tb-pick-row or the Rewrite .qc-textbox instead of a Trans score module. */
        .qc-active-pick {
          outline: 2px solid #f0a500 !important;
          outline-offset: 2px;
          background: rgba(255, 221, 87, .30) !important;
          border-radius: 6px;
        }

        /* long-text (Remarks/Rewrite) inline compare box */
        .qc-textbox {
          margin-top: 6px; border-radius: 8px; padding: 7px 10px;
          font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .qc-textbox.qc-tb-same { color: #8a909c; background: #f4f6fb; }
        .qc-textbox.qc-tb-diff { background: #fff5f5; border: 1px solid #ffc9c9; }
        .qc-textbox.qc-tb-adopted { background: #ebfbee; border: 1px solid #b2f2bb; }
        /* Neutral reference box — used for the Remarks ＋ Add list. Red is reserved for "still to reconcile";
           Remarks reading differently from Annotator 2's is normal and isn't counted as outstanding work. */
        .qc-textbox.qc-tb-ref { background: #f8f9fc; border: 1px solid #dde1e6; }
        .qc-tb-head { display: flex; align-items: center; color: #c92a2a; font-weight: 600; margin-bottom: 4px; }
        .qc-textbox.qc-tb-adopted .qc-tb-head { color: #2b8a3e; }
        .qc-textbox.qc-tb-ref .qc-tb-head { color: #4b5563; }
        .qc-spacer { flex: 1; }
        .qc-tb-was { color: #868e96; font-size: 11px; margin-bottom: 2px; }
        .qc-tb-body { white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow: auto; color: #1f2430; }

        /* Per-line Remarks append — one row per split line of Annotator 2's Remarks, each with its own "＋ Add"
           button. The row itself isn't clickable (unlike the score badge): only the button writes, so a reviewer
           reading the suggestions can't paste one by accident. */
        .qc-tb-picklist { max-height: 220px; overflow: auto; }
        .qc-tb-pick-row {
          display: flex; align-items: flex-start; gap: 5px; padding: 4px 0;
          color: #1f2430; word-break: break-word;
        }
        .qc-tb-pick-row + .qc-tb-pick-row { border-top: 1px solid #e6e9f0; }
        .qc-tb-pick-bullet { flex: none; color: #8a909c; font-weight: 700; line-height: 1.5; }
        .qc-tb-pick-text { flex: 1; min-width: 0; line-height: 1.5; }
        .qc-tb-append {
          flex: none; cursor: pointer; font-weight: 700; white-space: nowrap; margin-left: 6px;
          color: #1c7ed6; border: 1px solid #a5d8ff; background: #e7f5ff; border-radius: 6px; padding: 1px 8px;
        }
        .qc-tb-append:hover { background: #d0ebff; }
        .qc-tb-append:active { background: #a5d8ff; }
        .qc-tref { background: #fff3bf; border-radius: 3px; padding: 0 2px; }
        .qc-tref-bad { background: #ffc9c9 !important; } /* violation (3 Points but has a remark) -> red in the compare box */

        /* Trans N highlight overlay on the platform's editable field: transparent text + translucent highlight, sits over the textarea without blocking input */
        .qc-hl {
          position: absolute; z-index: 2; pointer-events: none; overflow: hidden;
          margin: 0; background: transparent; color: transparent;
          white-space: pre-wrap; overflow-wrap: break-word; word-break: break-word;
          border-style: solid; border-color: transparent; box-sizing: border-box;
        }
        /* underline-style highlight: just a line at the bottom, not over the glyphs -> text stays crisp (a solid fill looks gray) */
        .qc-hl .qc-tref { background: linear-gradient(to top, rgba(245, 159, 0, .7) 0.16em, transparent 0.16em); border-radius: 0; padding: 0; }
        .qc-hl .qc-tref-bad { background: linear-gradient(to top, rgba(224, 49, 49, .8) 0.16em, transparent 0.16em) !important; } /* violation -> red underline */
        .qc-tb-adopt, .qc-tb-undo, .qc-adopt-btn { cursor: pointer; font-weight: 600; white-space: nowrap; margin-left: 8px; }
        .qc-tb-adopt, .qc-adopt-btn { color: #1c7ed6; border: 1px solid #a5d8ff; background: #e7f5ff; border-radius: 6px; padding: 1px 8px; }
        .qc-tb-adopt:hover, .qc-adopt-btn:hover { background: #d0ebff; }
        .qc-tb-undo { color: #1c7ed6; text-decoration: underline; }
        .qc-tb-undo:hover { color: #1971c2; }

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
           which updateSummary() rewrites wholesale on every render. Empty by
           default and collapses to nothing until there's something to say. */
        #qc-cursor { color: #4b5563; font-size: 12px; line-height: 1.6; }
        #qc-cursor:empty { display: none; }
        .qc-kbd {
          display: inline-block; min-width: 15px; text-align: center;
          border: 1px solid #d9d9e3; border-bottom-width: 2px; border-radius: 4px;
          background: #fafbfc; color: #1f2430; font-size: 10px; font-weight: 700;
          padding: 0 3px; margin: 0 1px;
        }
        #qc-check-pill {
          position: fixed; left: 16px; bottom: 100px; z-index: 2147483647;
          font: 12px/1 -apple-system,"Segoe UI",sans-serif; font-weight: 700;
          cursor: default; border-radius: 18px; padding: 8px 13px;
          box-shadow: 0 2px 10px rgba(0,0,0,.12);
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
            <span style="white-space:nowrap;"><span class="qc-kbd">Z</span> Swaps Labels · Adds Remark line · Swaps Rewrite</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">C</span> Confusing</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">X</span> Clear Label</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">1</span>–<span class="qc-kbd">9</span> Label/Score Selection</span>
            <span style="white-space:nowrap;"><span class="qc-kbd">↑</span><span class="qc-kbd">↓</span><span class="qc-kbd">←</span><span class="qc-kbd">→</span> Move Focus (Trans → Remark +Add → Rewrite)</span>
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
      toggle.addEventListener('click', (e) => { e.stopPropagation(); helpOpen = !helpOpen; applyHelp(); });
      makePanelDraggable(p, p.querySelector('#qc-head'), toggle);
      applySavedPos(p); // use the remembered position if there is one (otherwise default top-center)
      updatePanelHeader(1, 2); // default header (assumes Annotator 1); renderBadges corrects it to the actual tab
      injectCheckPill();
      applyHelp();
    }

    // ---------- Closed-state Check Icon pill (read-only; same corner/offset
    // as Remark Options' own pill, left:16px;bottom:100px, for visual
    // consistency — the two never coexist in the DOM since Remark Composer
    // doesn't load on /quality_ pages) ----------
    function injectCheckPill() {
      if (document.getElementById('qc-check-pill')) return;
      const pill = document.createElement('button');
      pill.id = 'qc-check-pill';
      pill.title = 'Check mode set on the annotation page';
      document.body.appendChild(pill);
      checkPillEl = pill;
      updateCheckPill();
    }

    function updateCheckPill() {
      if (!checkPillEl) return;
      let mode = 'label';
      try {
        const idx = QC_CHECK_MODES.indexOf(localStorage.getItem(QC_CHECK_KEY));
        mode = idx === -1 ? 'label' : QC_CHECK_MODES[idx];
      } catch (e) {}
      const s = QC_CHECK_STYLES[mode];
      checkPillEl.textContent = s.text;
      checkPillEl.style.background = s.bg;
      checkPillEl.style.color = s.fg;
      checkPillEl.style.border = `1px solid ${s.border}`;
      checkPillEl.style.display = helpOpen ? 'none' : 'block';
    }
    const QC_POS_KEY = 'trans-tool:nova-qc-pos-v1';
    function applySavedPos(p) {
      try {
        const raw = localStorage.getItem(QC_POS_KEY);
        if (!raw) return;
        const o = JSON.parse(raw);
        if (o && typeof o.left === 'number' && typeof o.top === 'number') {
          p.style.left = o.left + 'px'; p.style.top = o.top + 'px';
          p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
        }
      } catch (e) {}
    }
    function savePos(p) {
      try { const r = p.getBoundingClientRect(); localStorage.setItem(QC_POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (e) {}
    }
    // Collapse/expand the help text (default expanded — see helpOpen above — so a first-time reviewer sees the full
    // explanation without having to know to expand anything, matching the original exactly).
    function applyHelp() {
      if (!panelEl) return;
      const help = panelEl.querySelector('#qc-help');
      const tg = panelEl.querySelector('#qc-toggle');
      if (help) help.style.display = helpOpen ? 'block' : 'none';
      if (tg) tg.textContent = helpOpen ? '▾' : '▸';
      updateCheckPill(); // shows/hides the read-only Check Icon pill (v1.4.1) opposite the Legend
    }
    // Drag the header to move the panel (clicking the help toggle doesn't drag); switches to left/top positioning after being dragged.
    function makePanelDraggable(p, head, ignoreEl) {
      let ox = 0, oy = 0;
      function onMove(e) {
        const r = p.getBoundingClientRect(), pad = 4;
        const left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, e.clientX - ox));
        const top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, e.clientY - oy));
        p.style.left = left + 'px'; p.style.top = top + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto';
        p.style.transform = 'none'; // dragged -> cancel the centering transform, switch to absolute left/top
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        savePos(p); // remember where it was dropped
      }
      head.addEventListener('mousedown', (e) => {
        if (ignoreEl && (e.target === ignoreEl || ignoreEl.contains(e.target))) return; // clicking the collapse toggle doesn't drag
        e.preventDefault();
        const r = p.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
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
        if (ready && sig && sig !== lastRowSig) { // row changed -> re-scrape Annotator 2
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
        render(); // re-add badges/compare boxes lost to a re-render (idempotent)
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
      if (Utils.inTextEntry()) return; // typing in Remarks/Rewrite — the keys are for typing

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (extraSel) {
            const list = extList();
            const i = list.findIndex((x) => sameExt(x, extraSel));
            if (i !== -1 && i < list.length - 1) selectExt(list[i + 1]); // else already at the end — stay put, no wrap
            return;
          }
          {
            const nums = cursor.list();
            if (nums.length && cursor.get() === nums[nums.length - 1]) {
              const list = extList();
              if (list.length) { selectExt(list[0]); return; } // last Trans -> hand off to Remarks +Add / Rewrite
            }
          }
          cursor.step(1);
          return;
        case 'ArrowUp':
          e.preventDefault();
          if (extraSel) {
            const list = extList();
            const i = list.findIndex((x) => sameExt(x, extraSel));
            if (i > 0) { selectExt(list[i - 1]); return; }
            const nums = cursor.list(); // first extended item -> hand back to the last Trans
            extraSel = null;
            document.querySelectorAll('.qc-active-pick').forEach((el) => el.classList.remove('qc-active-pick'));
            if (nums.length) cursor.set(nums[nums.length - 1], { scroll: true });
            return;
          }
          cursor.step(-1);
          return;
        // Either arrow toggles column; the direction is ignored, matching Module 1. Column toggle is a Trans-only
        // concept, so it's a no-op while a Remark line / Rewrite is selected.
        case 'ArrowLeft':
        case 'ArrowRight':
          e.preventDefault();
          if (!extraSel) cursor.toggleColumn();
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
      if (k === 'o') { e.preventDefault(); helpOpen = !helpOpen; applyHelp(); return; }
      if (k === 'z') {
        e.preventDefault();
        if (extraSel) {
          // Remark line -> same one-shot append as clicking + Add; Rewrite -> same adopt/undo toggle as the
          // existing Swap →/Undo buttons. Neither is a new action, just a keyboard path to the existing one.
          if (extraSel.type === 'remark') appendRemarkLine(extraSel.idx);
          else if (adoptedText.has('rewrite')) undoFieldText('rewrite'); else adoptFieldText('rewrite');
          return;
        }
        swap(n);
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
        if (undo) { e.preventDefault(); e.stopPropagation(); undoAdopt(parseInt(undo.dataset.undo, 10)); return; }
        const append = e.target.closest('.qc-tb-append'); // per-line Remarks append — stateless, appends only
        if (append) { e.preventDefault(); e.stopPropagation(); appendRemarkLine(parseInt(append.dataset.appendLine, 10)); return; }
        const tAdopt = e.target.closest('.qc-tb-adopt');
        if (tAdopt) { e.preventDefault(); e.stopPropagation(); adoptFieldText(tAdopt.dataset.adoptText); return; }
        const tUndo = e.target.closest('.qc-tb-undo');
        if (tUndo) { e.preventDefault(); e.stopPropagation(); undoFieldText(tUndo.dataset.undoText); return; }
        const sAdopt = e.target.closest('.qc-adopt-btn'); // the score's blue Adopt button (handled separately + stops propagation)
        if (sAdopt) { e.preventDefault(); e.stopPropagation(); adoptOther(parseInt(sAdopt.dataset.adoptScore, 10)); return; }
        const badge = e.target.closest('.qc-badge.qc-diff'); // clicking anywhere in the red area also adopts
        if (!badge || activeTabIndex() !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const mod = badge.closest('[data-module-name]');
        const m = mod && /^Trans(\d+) Score$/.exec(mod.getAttribute('data-module-name') || '');
        if (!m) return;
        adoptOther(parseInt(m[1], 10));
      }, true);
      // Typing / scrolling in the platform Remarks/Rewrite field -> live-sync the Trans N highlight overlay.
      const isFieldTA = (el) => el && el.tagName === 'TEXTAREA' && el.closest
        && el.closest('[data-module-name="Remarks"], [data-module-name="Rewrite"]');
      // rAF-throttled: syncFieldHighlights() calls getComputedStyle and
      // rebuilds the overlay's innerHTML, and updateWarn() re-derives
      // get3PtRemarkViolations() (its own DOM read across every Trans score)
      // a second time on top of the copy syncFieldHighlights already computed
      // internally — real, non-trivial work that was previously re-run in
      // full on every single keystroke. Coalescing both to one pass per
      // animation frame is what actually fixes the typing lag; nothing about
      // what gets synced changes, only how often the sync work runs.
      const scheduleFieldSync = Utils.rafThrottle(() => { syncFieldHighlights(); updateWarn(); });
      const scheduleHLOnly = Utils.rafThrottle(syncFieldHighlights);
      document.addEventListener('input', (e) => { if (isFieldTA(e.target)) scheduleFieldSync(); }, true);
      document.addEventListener('scroll', (e) => { if (isFieldTA(e.target)) scheduleHLOnly(); }, true);
      // (v1.4.0 removed the Remarks-field-auto-grow feature this used to
      // also listen for — the highlight overlay now only re-syncs from the
      // input/scroll listeners above, which is everything it needs since
      // the field no longer changes height on its own.)
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
