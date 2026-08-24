// ==UserScript==
// @name         Annotation Scoring Shortcuts
// @namespace    translation-tool-injection
// @version      1.3.3
// @description  Keyboard shortcuts to score and label the 7 translations on the annotation workbench
// @match        https://nova.xiaohongshu.com/model-studio/workspace/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Clean rewrite in progress — see AGENTS.md in this repo for the full feature
 * reference, ground rules, and the incremental plan this file is following.
 *
 * Status: Phase 0 (shared utilities), Phase 1 (Module 1: Scoring Shortcuts),
 * Module 2 (Remark Composer), and Phase 3 (Module 3: QC Compare) are
 * complete. Module 2 is a redesign, not a faithful port — quoting works
 * differently than in the original script. See AGENTS.md §7 for what changed
 * and why. Module 3 is a faithful port of the original's diff/adopt/undo
 * engine for scores and Rewrite (see AGENTS.md §4.3 for the `canonPath`
 * cascade-matching fix it depends on), with two deliberate departures: the
 * verdict buttons are driven to the reviewer's "1 / 3" rule instead of the
 * original's "correct / wrong" wording, and Remarks uses stateless per-line
 * "＋ Add" buttons instead of the original's whole-field Adopt/Undo. No
 * panel toggle, resize, or verdict-reload fallback — see AGENTS.md §7 for
 * why those were deliberately left out. Phase 4 (Single-model Reference) has
 * not been ported into this file yet — if you need that feature today, keep
 * using the original v0.1.83 script until it lands here.
 *
 * As of v1.3.2 Module 3 is no longer mouse-only: it has arrow-key selection
 * and keyboard relabelling, and "Adopt" is now the reversible "Swap" (S). The
 * cursor logic behind those arrows is shared with Module 1 via TransCursor —
 * the second sanctioned piece of cross-module code besides Utils, so
 * AGENTS.md §3's "modules stay behaviorally isolated" rule now has two
 * exceptions rather than one. Also new in v1.3.2: Space no longer submits
 * while a populated translation is under-labelled (B toggles that check), and
 * the Remarks field grows to fit its content instead of scrolling internally.
 *
 * v1.3.3 moved that check off Space and onto Enter — Space is back to being
 * the platform's untouched native submit key, and Enter is now the one held
 * back while a populated translation is under-labelled (B still toggles it).
 * The Remark Composer's quote selection (Q) was also loosened: selecting an
 * entire translation could land the browser's selection boundary just
 * outside `.preview-content` (a real Selection/Range quirk, not a typo) and
 * get rejected as "outside the translation" even though only one translation
 * was ever touched — it now checks which translation *container* the
 * selection intersects instead, so a full-translation selection quotes
 * cleanly while a selection spanning two translations is still rejected.
 *
 * Safety note (unchanged from the original): this script only "clicks for
 * you" — every action it takes is the same thing your mouse would do, and
 * every value it sets is visible on screen before you submit. It never
 * touches anything you didn't ask it to.
 *
 * One deliberate exception to that, added in v1.3.2 and carried forward: the
 * submit blocker *prevents* an action rather than performing one. It only
 * ever suppresses the Enter keystroke (Space in v1.3.2) — it never finds or
 * clicks the submit button — so pressing Space, or clicking Submit with the
 * mouse, always works, and B turns the check off entirely.
 */

(function () {
  'use strict';

  // Single source of truth for every module's version badge — was
  // previously out of sync (the @version header said 1.2.4 while Module 1's
  // own badge constant still said v1.2.1). Bump this and the @version header
  // together; every module badge reads from here instead of keeping its own.
  const SCRIPT_VERSION = 'v1.3.3';

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

    // Grow a textarea to exactly fit its content, so it never scrolls
    // internally. Setting height to 'auto' first matters: scrollHeight
    // reports the *current* box height once it's been pinned in px, so
    // without the reset the field could grow but never shrink back.
    //
    // Returns true if the height actually changed, so callers can skip
    // downstream work (overlay resync) when nothing moved.
    // Set with `!important` because the platform's own stylesheet pins this
    // field's height, and a normal inline declaration loses to an author
    // `!important` rule. Inline `!important` outranks both.
    autoGrowTextarea(ta) {
      if (!ta) return false;
      const before = ta.style.height;
      ta.style.setProperty('overflow-y', 'hidden', 'important');
      ta.style.setProperty('height', 'auto', 'important');
      const h = ta.scrollHeight;
      if (!h) { // detached or hidden — leave it alone rather than collapse it to 0
        if (before) ta.style.setProperty('height', before, 'important');
        return false;
      }
      ta.style.setProperty('height', h + 'px', 'important');
      return ta.style.height !== before;
    },

    // Is the user typing? Letter/number shortcuts must never fire while a
    // text field has focus. Was previously copy-pasted in Module 1
    // (`inTextEntry`) and Module 2 (`typing`); Module 3 needs it too now
    // that it has a keyboard, so it lives here once.
    //
    // The `readOnly` early-return matters: an Ant cascader's own hidden
    // search input is a readonly text input that takes focus whenever a
    // dropdown opens. Treating that as "typing" would kill every shortcut
    // for exactly as long as a label menu is open — i.e. precisely when
    // the 0-9 label keys are needed.
    inTextEntry() {
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
    },
  };

  // ======================================================================
  // Shared: the active-translation cursor
  //
  // Module 1 (scoring) and Module 3 (QC compare) both let you walk the
  // row's scoreable translations with the arrow keys, with identical
  // semantics: ↑/↓ step, ←/→ toggle column (Trans1-3 vs Trans4-7) and land
  // on wherever you last were in that column. That logic lives here once
  // instead of being copy-pasted, which is how the two copies of the
  // version constant drifted apart before (see SCRIPT_VERSION above).
  //
  // It deals only in Trans NUMBERS, never indices. That isn't tidiness —
  // it's forced: Module 3 has no stable array to index into, since it
  // re-queries `[data-module-name="TransN Score"]` on demand and the
  // platform's re-renders replace those nodes. An index into any snapshot
  // goes stale by construction; a number stays valid. (Module 1's index is
  // always recoverable from a number via findIndex; the reverse isn't.)
  //
  // It knows nothing about either module's DOM, highlight style, or status
  // panel — those arrive as the `onChange` and `status` callbacks.
  // ======================================================================
  function TransCursor({ list, onChange, status, leftMax = 3 }) {
    let cur = null;         // the active Trans NUMBER, or null when the row has none
    // Column memory, deliberately persisting across rows (and across
    // reset()) — if you habitually check Trans6 first, ←/→ keeps landing
    // there. Written in `set` rather than in either module's onChange, so
    // both modules' ←/→ learn from every move.
    let lastColLeft = null;
    let lastColRight = null;

    const isLeft = (n) => n <= leftMax;
    const inCol = (n, goingRight) => (goingRight ? !isLeft(n) : isLeft(n));

    // Re-anchor `cur` to the live list: keep it if still present, else fall
    // back to the nearest lower listed number, else the first. Mutates
    // `cur`, matching the clamping Module 1 has always done — this runs
    // from the MutationObserver on every settle, so it's a hot path, not
    // an edge case.
    function resolve(nums) {
      if (!nums.length) { cur = null; return null; }
      if (cur !== null && nums.indexOf(cur) !== -1) return cur;
      const lower = nums.filter((n) => cur !== null && n < cur);
      cur = lower.length ? lower[lower.length - 1] : nums[0];
      return cur;
    }

    // The only writer of `cur`. `scroll` is passed through to onChange so
    // callers that only want a repaint (not a jump) can say so.
    function set(n, { scroll = false, silent = false } = {}) {
      if (n == null) return null;
      cur = n;
      if (isLeft(n)) lastColLeft = n; else lastColRight = n;
      if (!silent && onChange) onChange(n, { scroll });
      return n;
    }

    return {
      get() { return cur; },
      list() { return list(); },

      // Re-anchor to the live list and repaint. This is what a module's
      // MutationObserver settle calls.
      sync({ scroll = false } = {}) {
        const n = resolve(list());
        if (n === null) { if (onChange) onChange(null, { scroll }); return null; }
        return set(n, { scroll });
      },

      step(delta) {
        const nums = list();
        if (!nums.length) return null;
        const i = Math.max(0, Math.min(nums.length - 1, nums.indexOf(resolve(nums)) + delta));
        const n = set(nums[i], { scroll: true });
        if (status) status(`Current: Trans${n}`);
        return n;
      },

      // Both ← and → toggle to the other column; the direction of the key
      // is ignored, by design. If neither the remembered slot nor a
      // fallback is scoreable right now, stay put rather than guess.
      toggleColumn() {
        const nums = list();
        if (!nums.length) return null;
        const curN = resolve(nums);
        if (curN === null) return null;
        const goingRight = isLeft(curN);
        const remembered = goingRight ? lastColRight : lastColLeft;
        let target = (remembered !== null && inCol(remembered, goingRight)) ? remembered : null;
        if (target === null) target = nums.find((n) => inCol(n, goingRight));
        if (target == null) return null;              // nothing scoreable over there
        if (nums.indexOf(target) === -1) return null; // remembered slot isn't scoreable now
        const n = set(target, { scroll: true });
        if (status) status(`Current: Trans${n}`);
        return n;
      },

      set,

      // Row change: go to the first scoreable translation. Column memory is
      // intentionally NOT cleared.
      reset({ scroll = false, silent = false } = {}) {
        cur = null;
        const nums = list();
        return nums.length ? set(nums[0], { scroll, silent }) : null;
      },
    };
  }

  // The next Trans after `num` in a previously-captured list, or `num`
  // itself if it was the last one. Deliberately a pure helper on a
  // caller-supplied snapshot rather than a cursor method: the async
  // "score, then advance" sites capture the list *before* awaiting and must
  // advance against that same snapshot, not against a freshly re-read list.
  TransCursor.nextIn = function (nums, num) {
    const i = nums.indexOf(num);
    if (i === -1 || i === nums.length - 1) return num;
    return nums[i + 1];
  };

  // ======================================================================
  // Shared: keep the Remarks field as tall as its content
  //
  // The platform's Remarks box is a small fixed-height textarea, so a remark
  // longer than a few lines can only be re-read by scrolling inside it. Grow
  // it to fit instead: the field never scrolls internally, and the page
  // absorbs the extra height.
  //
  // Growth is deliberately unbounded. A cap would reintroduce internal
  // scrolling for exactly the long remarks this exists to fix.
  //
  // Runs on both the annotation page and QC, so it lives here rather than in
  // a module — it isn't tied to either one's lifecycle, and both pages have
  // the same field with the same problem.
  // ======================================================================
  const GROWN_EVENT = 'trans-tool:remarks-grown';

  function startRemarksAutoGrow(Utils) {
    const SEL = '[data-module-name="Remarks"] textarea';

    // NOVA's own layout pins the Remarks module to a fixed height with
    // overflow:visible (it's why Module 3 inserts its compare boxes as
    // siblings rather than children). Growing the textarea inside that box
    // would just push content out under whatever renders next, so the
    // module's own height constraint has to come off too.
    //
    // Scoped to the Remarks module only, and to the wrappers between it and
    // the textarea — not a blanket rule — so nothing else on the page shifts.
    function injectStyle() {
      if (document.getElementById('tl-grow-style')) return;
      const s = document.createElement('style');
      s.id = 'tl-grow-style';
      // The two exclusions are load-bearing, not tidiness. A bare
      // `* { height: auto !important }` also matches:
      //   - the textarea itself, whose measured height we set inline —
      //     stylesheet !important beats a normal inline declaration, so the
      //     blanket rule silently discarded the grow and the field rendered
      //     at auto. The feature did nothing.
      //   - .qc-hl, Module 3's highlight overlay, which is a sibling of the
      //     textarea inside this same module and is also sized inline. It
      //     would collapse to zero height and the highlight would vanish.
      s.textContent = `
        [data-module-name="Remarks"],
        [data-module-name="Remarks"] *:not(textarea):not(.qc-hl) {
          height: auto !important;
          max-height: none !important;
        }
        [data-module-name="Remarks"] textarea {
          overflow-y: hidden !important;
          max-height: none !important;
          resize: none;
        }`;
      document.head.appendChild(s);
    }

    function grow() {
      const ta = document.querySelector(SEL);
      if (!ta) return;
      // Only announce a real height change — the listeners downstream
      // (Module 3's highlight overlay) do measurable work.
      if (Utils.autoGrowTextarea(ta)) {
        document.dispatchEvent(new CustomEvent(GROWN_EVENT));
      }
    }

    injectStyle();

    // One delegated capture-phase listener covers every write path at once:
    // a person typing, and every programmatic write, since setNativeValue
    // dispatches `input` (it has to, for React to see the change at all).
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t && t.tagName === 'TEXTAREA' && t.closest && t.closest('[data-module-name="Remarks"]')) grow();
    }, true);

    // The content is unchanged but the wrap point moves, so the height must
    // be recomputed from scratch.
    window.addEventListener('resize', grow);

    // React replaces the textarea node outright on re-render, which drops the
    // inline height with it, and a row change swaps in different content. Both
    // show up as mutations; re-injecting the style is cheap and idempotent.
    let t = null;
    new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => { injectStyle(); grow(); }, 220); // same settle delay the modules use
    }).observe(document.body, { childList: true, subtree: true });

    grow(); // first pass, for content already on the page
  }

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
    const VERSION = SCRIPT_VERSION; // Shown in the panel badge so you can confirm you're running the latest version.
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
      keyToggleBlock: 'b',  // turn the submit blocker on/off (see blockEnabled)
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
    // Whether Enter is blocked while any populated translation is still
    // incompletely labelled. Session-only on purpose — deliberately NOT
    // persisted alongside the other trans-tool:nova-score-* keys, so this
    // can never leave a later session quietly unblocked. Toggled with B.
    let blockEnabled = true;
    let lastRowSig = '';      // fingerprint of the previous row's source text, to detect a row change
    let queue = [];           // pending score requests, strictly in the order keys were pressed
    let processing = false;   // true while the queue is being drained, so it's never processed concurrently
    let labelMode = false;    // true while a "2 Points" label pick is in progress
    let labelBusy = false;    // guards against double-firing while a label click is mid-flight
    let labelBadgeRAF = null; // handle for the loop that keeps the label menu's number badges in sync

    // The active-translation cursor. Shared with Module 3 (see TransCursor
    // above), which is why this module no longer tracks an index or its own
    // per-column memory — ←/→ returning you to where you left off in each
    // column is the cursor's job now.
    const cursor = TransCursor({
      list: () => getScoreModules().map(transNumberOf),
      status: setStatus,
      onChange(num, { scroll }) {
        document.querySelectorAll('.tl-active-score').forEach((el) => el.classList.remove('tl-active-score'));
        if (!enabled || num === null) return;
        const mod = scoreModuleFor(num);
        if (!mod) return;
        // Highlight the whole "TransX Score" block (title + dropdown), not just the dropdown itself.
        (mod.querySelector('.cascade-container') || mod).classList.add('tl-active-score');
        if (scroll) mod.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    });

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

    // ====================================================================
    // Submission blocker (added v1.3.2)
    // ====================================================================

    // Is this translation completely labelled? Two catches, both exact
    // string comparisons: nothing selected at all, or a bare "2 Points" that
    // never got specialized.
    //
    // Never split the value on "/" to count depth. Score and label are one
    // cascader whose displayed value joins levels with " / ", and some labels
    // legitimately contain " / " themselves ("Unauthentic Vocabulary /
    // Collocations") — so a complete
    // "2 Points / Authenticity / Unauthentic Vocabulary / Collocations" has
    // *more* separators than an incomplete "2 Points / Authenticity". Depth
    // is not recoverable from the display text; exact equality is.
    //
    // Deliberately derived from the live DOM rather than tracked as a flag
    // set by the scoring shortcuts. "2" leaves the dropdown open so the
    // label can be picked with the mouse, so a tracked flag would have to be
    // reconciled against the DOM anyway — and onMutate's 200ms debounce
    // against a constantly re-rendering SPA would overwrite it on nearly
    // every tick, making the stored copy decorative. This way mouse and
    // keyboard are indistinguishable to the check, by construction.
    //
    // Known gap: mouse-picking a mid-level category and stopping
    // ("2 Points / Authenticity") reads as complete — it's neither empty nor
    // bare "2 Points". The 0-9 path can't produce that state (it commits
    // only on a leaf), so it takes deliberate mouse misuse. If it ever
    // matters, the fix is to harvest every `ant-cascader-menu-item-expand`
    // path the script renders into a known-non-leaf set and block on
    // membership — that self-seeds, since you can't reach
    // "2 Points / Authenticity" without the script having just watched
    // Authenticity render as expandable.
    function isLabelComplete(mod) {
      const v = readSelected(mod).trim();
      return v !== '' && v !== CFG.pathKey2;
    }

    // Trans numbers that would block a submit. getScoreModules() already
    // excludes empty translations, so "populated" comes for free.
    function incompleteTransNumbers() {
      return getScoreModules().filter((m) => !isLabelComplete(m)).map(transNumberOf);
    }

    // A fingerprint for "which row am I on" — the source text is always
    // present and different per row, so a change in it means the page has
    // navigated to a new row and per-row state (the cursor, etc.) should reset.
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
        }
        /* Blocked-submission toast. Its own floating element rather than the
           panel's status line, which is invisible when the panel is
           collapsed — a blocked submit must never be missable. */
        #tl-toast {
          position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
          z-index: 2147483647; max-width: min(520px, 92vw);
          padding: 14px 20px; border-radius: 12px;
          background: #fff4e6; color: #8a4b00; border: 2px solid #ffa94d;
          box-shadow: 0 10px 40px rgba(0,0,0,.22);
          font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-align: center; pointer-events: none;
          opacity: 0; transition: opacity .12s;
        }
        #tl-toast.tl-toast-show { opacity: 1; }
        #tl-toast b { color: #c92a2a; }
        #tl-toast .tl-toast-sub { display: block; margin-top: 5px; font-size: 12px; color: #a1690a; }`;
      document.head.appendChild(s);
    }

    // Show a transient centered message. Re-shown while already visible just
    // resets the timer, so holding Enter doesn't stack toasts.
    let toastTimer = null;
    function showToast(html, ms = 2600) {
      let t = document.getElementById('tl-toast');
      if (!t) {
        injectStyle();
        t = document.createElement('div');
        t.id = 'tl-toast';
        document.body.appendChild(t);
      }
      t.innerHTML = html;
      // Next frame, so the opacity transition actually runs on first show.
      requestAnimationFrame(() => t.classList.add('tl-toast-show'));
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        t.classList.remove('tl-toast-show');
      }, ms);
    }

    // The scoring control for a given Trans number. The cursor deals in
    // numbers, so this is how call sites get back to the DOM node.
    function scoreModuleFor(num) {
      return getScoreModules().find((m) => transNumberOf(m) === num) || null;
    }

    // Re-anchor the cursor to the live list and repaint the highlight.
    // Replaces the old applyHighlight(): the clamping it used to do is now
    // TransCursor.sync()'s job, and the per-column memory it used to record
    // moved into the cursor's own set().
    function applyHighlight() { return cursor.sync(); }

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

    // Move the active-translation cursor. Both of these are now one-liners
    // over the shared cursor: stepping, the clamping at either end, the
    // column rule (Trans1-3 vs Trans4-7, either arrow toggles) and the
    // per-column memory all live in TransCursor, and the "Current: TransN"
    // status comes from the `status` callback wired into it above.
    function move(delta) { cursor.step(delta); }
    function jumpColumn() { cursor.toggleColumn(); }

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

    // Click the active translation's own "clear" control and blur/collapse
    // afterwards — same leftover-focus precaution as setScore, since this
    // drives the same kind of control.
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
      // Snapshot the list and re-anchor the cursor to it *before* any await.
      // The advance below must be computed against this same snapshot, not a
      // freshly re-read list — that's what TransCursor.nextIn is for.
      const nums = cursor.list();
      if (!nums.length) { setStatus('No scoring control found'); return; }
      const num = cursor.sync();
      const mod = scoreModuleFor(num);
      if (!mod) { setStatus('No scoring control found'); return; }
      const name = mod.getAttribute('data-module-name') || `Trans${num} Score`;

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
        // Advance against the pre-await snapshot, deliberately — re-reading
        // the list here would change which translation gets focused next.
        const nextNum = TransCursor.nextIn(nums, num);
        cursor.set(nextNum, { scroll: true });
        setStatus(num === nextNum ? `Trans${num} = ${got} ✓ (last)` : `Trans${num} = ${got} ✓ → Trans${nextNum}`);
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
    //
    // Takes (mod, num, nums) rather than the old (idx, list). That signature
    // change fixes a latent bug: the old version read the value back with
    // `list[idx]` but then advanced with `idx + 1` applied to a *freshly
    // re-read* `list2`. Those two arrays are only guaranteed to line up while
    // the row is unchanged, so if the list shifted mid-label-pick the advance
    // could land on the wrong translation. Carrying the Trans number instead
    // of an index makes that mismatch impossible to express.
    async function commitLabelAndAdvance(mod, num, nums) {
      await Utils.waitFor(() => mod && readSelected(mod).length > 0, 600).catch(() => {});
      const got = mod ? readSelected(mod) : '';
      labelMode = false;
      clearLabelBadges();
      if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
      await closeOpenCascaders(); // make sure the menu is actually closed
      const nextNum = TransCursor.nextIn(nums, num);
      cursor.set(nextNum, { scroll: true });
      setStatus(num === nextNum ? `Label set: ${got} ✓ (last)` : `Label set: ${got} ✓ → Trans${nextNum}`);
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
        // Captured before the click, so the commit below reads back and
        // advances relative to the translation this label was picked *for*.
        const nums = cursor.list();
        const num = cursor.get();
        const mod = scoreModuleFor(num);
        const colsBefore = cols.length;

        Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);

        if (isLeaf) {
          // The platform doesn't auto-close the menu for a leaf pick, so we commit and advance ourselves.
          await commitLabelAndAdvance(mod, num, nums);
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
          await commitLabelAndAdvance(mod, num, nums);
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
    // Moved to Utils in v1.3.2, unchanged, when Module 3 grew a keyboard and
    // needed the same test — including the readonly-input exemption for the
    // cascader's own hidden search box.
    const inTextEntry = () => Utils.inTextEntry();

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never touch modifier combos (the platform's own Ctrl+H, etc.)
      if (document.body.classList.contains('rmd-active')) return; // Remark Composer drawer open → keyboard is entirely its
      if (e.key === 'Escape') {
        // Esc only cancels an in-progress label pick — the master on/off switch is button-only, by design.
        if (labelMode) { e.preventDefault(); exitLabelMode(); setStatus('Label pick cancelled'); }
        return;
      }
      if (inTextEntry()) return; // typing in Remarks/Rewrite → letter/number keys are for typing, not shortcuts

      // Enter is the platform's submit (Space was, through v1.3.2 — moved
      // here in v1.3.3 so Space goes back to being the platform's untouched
      // native submit key). Hold Enter back while any populated translation
      // is still incompletely labelled.
      //
      // Placed after the inTextEntry() guard on purpose, so Enter stays a
      // literal newline whenever a text field has focus — never intercept
      // Enter while someone is typing a remark.
      //
      // We only ever suppress the keystroke; we never look for or click the
      // submit button. That's why clicking Submit with the mouse, or
      // pressing Space, still works as an override, for free.
      if (e.key === 'Enter') {
        if (!blockEnabled) return;
        const bad = incompleteTransNumbers();
        if (!bad.length) return; // everything labelled → the platform's Enter proceeds untouched
        e.preventDefault();
        e.stopImmediatePropagation();
        const list = bad.map((n) => `Trans${n}`).join(', ');
        showToast(
          `⛔ Not submitted — <b>${list}</b> ${bad.length === 1 ? 'is' : 'are'} missing a complete label.`
          + `<span class="tl-toast-sub">Finish the label, or press Space / click Submit with the mouse to`
          + ` override (<span class="tl-kbd">${CFG.keyToggleBlock.toUpperCase()}</span> turns this check off).</span>`
        );
        setStatus(`⛔ Submit blocked — incomplete: ${list}`);
        return;
      }

      // Show/hide the whole panel. Checked before the enabled gate below,
      // same as Esc — you can always get the window back even while
      // shortcuts are turned OFF.
      if (e.key.toLowerCase() === CFG.keyToggleWindow) {
        e.preventDefault();
        setCollapsed(!collapsed);
        return;
      }

      // Toggle the submit blocker. Also checked before the enabled gate —
      // if the blocker is holding Enter back, you must be able to switch it
      // off without first turning the shortcuts back on.
      if (e.key.toLowerCase() === CFG.keyToggleBlock) {
        e.preventDefault();
        blockEnabled = !blockEnabled;
        updateBlockBadge();
        showToast(blockEnabled
          ? '🛡️ Submit check <b>ON</b><span class="tl-toast-sub">Enter is held back until every populated translation has a complete label.</span>'
          : '⚠️ Submit check <b>OFF</b><span class="tl-toast-sub">Enter submits regardless of missing labels.</span>');
        setStatus(`Submit check ${blockEnabled ? 'ON' : 'OFF'}`);
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

    let panelEl = null, statusEl = null, toggleBtn = null, skippedEl = null, pillEl = null, blockBadgeEl = null;
    let collapsed = false;    // true while minimized to the bottom-left pill
    let naturalWidth = null;  // the panel's default width, measured once on first render — resize can shrink below this but never grow past it

    function setStatus(msg) {
      if (statusEl) statusEl.textContent = msg; // shown to the annotator in the panel
      log(msg);                                 // echoed to console only when DEBUG is on
    }

    // The submit-blocker's state, in the panel header. Worth showing: if
    // Enter stops working, "why" should be answerable by looking rather than
    // by remembering whether you pressed B.
    function updateBlockBadge() {
      if (!blockBadgeEl) return;
      blockBadgeEl.textContent = blockEnabled ? '🛡️ Submit check' : '⚠️ Check OFF';
      blockBadgeEl.style.background = blockEnabled ? '#ebfbee' : '#fff0f0';
      blockBadgeEl.style.color = blockEnabled ? '#2b8a3e' : '#c92a2a';
      blockBadgeEl.style.border = `1px solid ${blockEnabled ? '#b2f2bb' : '#ffc9c9'}`;
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
      // Reports the real Trans number now. The old `activeIdx + 1` was wrong
      // whenever an earlier slot was empty and therefore skipped — it named a
      // position in the scoreable list, not a translation.
      if (on) { const num = applyHighlight(); setStatus(`ON · Trans${num == null ? 1 : num}`); }
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
          <span id="tl-block-badge" title="Enter won't submit until every populated translation has a complete label (B toggles)" style="
            font-size:11px;padding:1px 7px;border-radius:6px;font-weight:700;white-space:nowrap;cursor:default;"></span>
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
          <span style="white-space:nowrap;"><span class="tl-kbd">B</span> Submit check on/off</span>
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
      blockBadgeEl = p.querySelector('#tl-block-badge');
      updateBlockBadge();

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
          // Silent: the `if (enabled) applyHighlight()` below does the paint.
          // Column memory deliberately survives a row change (see TransCursor).
          cursor.reset({ silent: true });
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
  // MODULE 2: Remark Composer
  //
  // Lets an annotator build a structured remark by clicking translation
  // titles and category chips instead of typing full sentences by hand.
  // This is a redesign of the original module, not a faithful port — see
  // AGENTS.md §7 for exactly what changed (quoting works differently) and
  // why. See AGENTS.md §4.2 for the shared background (chip categories,
  // the React-controlled-textarea write, etc.).
  // ======================================================================
  function RemarkComposer(Utils) {
    const RTAG = '[Remark Composer / Remark]';
    const RDEBUG = false;
    function rlog(m) { if (RDEBUG) console.log(`${RTAG} ${m}`); }

    // ---------- Chip configuration (PM-editable via the ⚙ settings panel) ----------
    const DEFAULT_CHIP_CONFIG = {
      groups: [
        { key: 'fluency',   head: 'Fluency',     chips: ['Strange', 'Unnatural', 'Awkward', 'Run-on', 'Stiff', 'Choppy'] },
        { key: 'word',      head: 'Word Choice', chips: ['Uncommon', 'Literal', 'Redundant', 'Wordy', 'Mistranslated', 'Word-for-word'] },
        { key: 'meaning',   head: 'Meaning',     chips: ['Different meaning', 'Unclear', 'Missing context', 'Ambiguous', 'Vague', 'Missing detail'] },
        { key: 'mechanics', head: 'Mechanics',   chips: ['Missing punctuation', 'Missing period', 'Missing capitalization', 'Plural error', 'Tense error', 'Wrong word'] },
        { key: 'positive',  head: 'Positive',    chips: ['Natural', 'Understandable', 'Tonally similar', 'Grammatically correct', 'Same meaning', 'Captures meaning'] },
      ],
    };
    const CAT_COLOR = { fluency: '#e03131', word: '#f08c00', meaning: '#7048e8', mechanics: '#0c8599', positive: '#2f9e44' };
    const COLOR_KEYS = ['fluency', 'word', 'meaning', 'mechanics', 'positive'];
    const COLOR_EMOJI = { fluency: '🔴', word: '🟠', meaning: '🟣', mechanics: '🔵', positive: '🟢' };
    // Same key the original v0.1.83 script used — if this browser already has
    // saved chip customizations from that script, this version inherits them.
    const RMD_STORAGE_KEY = 'trans-tool:nova-remark-chips';

    // ---------- Runtime state ----------
    let chipConfig = DEFAULT_CHIP_CONFIG;
    let settingsOpen = false, settingsBuffer = null;
    let setOverlay = null, setBody = null;

    let active = false;           // is the composer popover open?
    let previewEl = null;         // #rmd-edit — the real, editable textarea the user types into
    let bgEl = null;               // #rmd-edit-bg — the non-interactive highlight backdrop underneath it
    let popover = null, paletteEl = null;
    let pinned = false;            // true once the user has manually dragged the popover — stop auto-repositioning it
    let lastMouseX = window.innerWidth / 2, lastMouseY = 150; // where the popover appears when opened via R
    let lastRowSig = '';
    let settleTimer = null;

    // Popover size — deliberately session-ephemeral, never persisted. enter()
    // resets to these defaults on every open, so closing and reopening via R
    // always starts fresh regardless of how it was last resized.
    const POPOVER_DEFAULT_W = 380;  // matches the original fixed CSS width
    const POPOVER_DEFAULT_H = 420;  // nominal default; tune this constant if it looks off in practice
    const POPOVER_MIN_W = 300;      // keeps the header buttons (⚙/Clear/✕) from crowding
    const POPOVER_MIN_H = 260;      // keeps header + edit box + hint usable

    function loadStoredChipConfig() {
      try {
        const raw = localStorage.getItem(RMD_STORAGE_KEY);
        if (!raw) return DEFAULT_CHIP_CONFIG;
        const o = JSON.parse(raw);
        if (o && Array.isArray(o.groups) && o.groups.length) return o;
      } catch (e) {}
      return DEFAULT_CHIP_CONFIG;
    }
    function saveChipConfig(cfg) {
      try { localStorage.setItem(RMD_STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }

    // ---------- NOVA's real Remarks textarea (not ours) ----------
    function remarkTextarea() {
      const m = document.querySelector('[data-module-name="Remarks"]');
      return m ? m.querySelector('textarea') : null;
    }

    // ---------- Building the remark text ----------

    // Smart separator between tokens, based on what's already in the box:
    // quote → phrase: ": "   phrase → phrase: ", "   anything → quote: two spaces.
    function separatorFor(tail, newKind) {
      const t = tail.replace(/\s+$/, '');
      if (t === '') return '';
      const prevKind = /Trans\s+\d+(\s+"[^"]*")?$/.test(t) ? 'quote' : 'phrase';
      if (prevKind === 'quote' && newKind === 'phrase') return ': ';
      if (prevKind === 'phrase' && newKind === 'phrase') return ', ';
      if (newKind === 'quote') return '  ';
      return '';
    }

    // Append a token to our own editable textarea, then mirror the result
    // into NOVA's real (React-controlled) Remarks field via the native
    // setter, so both stay in sync.
    function appendToken(token, kind) {
      if (!previewEl) return;
      const cur = previewEl.value.replace(/\s+$/, '');
      const next = cur + separatorFor(cur, kind) + token;
      previewEl.value = next;
      const ta = remarkTextarea();
      if (ta) Utils.setNativeValue(ta, next);
      setPreview(next);
      try { previewEl.setSelectionRange(next.length, next.length); } catch (e) {}
      focusEditEnd();
    }

    function clearBox() {
      if (previewEl) previewEl.value = '';
      const ta = remarkTextarea();
      if (ta) Utils.setNativeValue(ta, '');
      setPreview('');
    }

    // Delay focusing the edit box by one frame: if a quote was just
    // inserted right after a native text selection (Q) or a title click,
    // focusing synchronously gets fought by the browser (it tries to pull
    // focus back toward wherever the selection/click was). One rAF later,
    // it sticks (一帧延迟避免焦点被拖选/点击源头拉回去).
    function focusEditEnd() {
      requestAnimationFrame(() => {
        if (!previewEl) return;
        previewEl.focus();
        try { previewEl.setSelectionRange(previewEl.value.length, previewEl.value.length); } catch (e) {}
      });
    }

    // ---------- Live highlight overlay ----------
    // The edit box is two layers stacked exactly on top of each other: the
    // real, focusable textarea (#rmd-edit) rendered with transparent text —
    // only the caret shows, via caret-color — and a non-interactive backdrop
    // (#rmd-edit-bg) underneath, showing the same text with every "Trans N"
    // mention highlighted. Every layout-affecting style property is copied
    // from the textarea onto the backdrop so the highlight stays
    // pixel-aligned as you type, resize, or scroll.
    function highlightTransRefs(text) {
      return Utils.escapeHtml(text).replace(/\bTrans\s+(\d+)\b/g, '<span class="rmd-tref">Trans $1</span>');
    }
    function setPreview(text) {
      if (bgEl) bgEl.innerHTML = highlightTransRefs(text) + '\n';
    }
    // Refresh the backdrop from the textarea's current value — but never
    // while the user is actively focused and typing in it, or the redraw
    // would fight the browser's own cursor placement mid-keystroke.
    function syncPreview() {
      if (!previewEl || !bgEl) return;
      if (document.activeElement === previewEl) return;
      setPreview(previewEl.value);
    }
    const HL_COPY = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
      'textAlign', 'textIndent',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    ];
    function syncOverlayGeometry() {
      if (!previewEl || !bgEl) return;
      const cs = getComputedStyle(previewEl);
      HL_COPY.forEach((prop) => { bgEl.style[prop] = cs[prop]; });
      bgEl.scrollTop = previewEl.scrollTop;
      bgEl.scrollLeft = previewEl.scrollLeft;
    }

    // ---------- Popover position ----------
    function openPopover(x, y) {
      if (!popover) return;
      // Must be an explicit value, not '' — the stylesheet rule for
      // #rmd-popover sets display:none, and clearing an inline style falls
      // back to the stylesheet rather than showing the element. 'flex' (not
      // 'block') so #rmd-palette's flex:1 can absorb resized space correctly.
      popover.style.display = 'flex';
      if (pinned) return; // user moved it manually — stop auto-repositioning
      const pad = 8;
      const left = Math.max(pad, Math.min(window.innerWidth - popover.offsetWidth - pad, x));
      let top = y + 14;
      if (top + popover.offsetHeight > window.innerHeight - pad) top = y - popover.offsetHeight - 14; // flip above the cursor if it would overflow the bottom
      top = Math.max(pad, top);
      popover.style.left = left + 'px';
      popover.style.top = top + 'px';
    }
    function makeDraggable(p) {
      const handle = p.querySelector('#rmd-head');
      if (!handle) return;
      let ox = 0, oy = 0;
      function onMove(e) {
        p.style.left = (e.clientX - ox) + 'px';
        p.style.top = (e.clientY - oy) + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
      }
      handle.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        e.preventDefault();
        pinned = true; // manual drag → stop following the mouse from now on
        const r = p.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
    }

    // Corner-drag resize, both axes, grow or shrink — unlike Module 1's
    // panel resize, this is never persisted to localStorage; enter() resets
    // to POPOVER_DEFAULT_W/H every time the popover opens, so this is purely
    // a within-session convenience.
    function makePopoverResizable(p, handle) {
      let startX = 0, startY = 0, startW = 0, startH = 0;
      function onMove(e) {
        const r = p.getBoundingClientRect();
        const maxW = window.innerWidth - r.left - 8;
        const maxH = window.innerHeight - r.top - 8;
        const w = Math.max(POPOVER_MIN_W, Math.min(maxW, startW + (e.clientX - startX)));
        const h = Math.max(POPOVER_MIN_H, Math.min(maxH, startH + (e.clientY - startY)));
        p.style.width = w + 'px';
        p.style.height = h + 'px';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
      }
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't also trigger makeDraggable's drag
        const r = p.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY; startW = r.width; startH = r.height;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
    }

    // ---------- Chip palette ----------
    function renderPalette() {
      if (!paletteEl) return;
      paletteEl.innerHTML = chipConfig.groups.map((g) => {
        const color = CAT_COLOR[g.key] || '#666';
        const chips = g.chips.map((c) =>
          `<button type="button" class="rmd-chip" data-chip="${Utils.escapeHtml(c)}" style="border-color:${color};color:${color};">${Utils.escapeHtml(c)}</button>`
        ).join('');
        return `<div class="rmd-chip-col">
          <div class="rmd-chip-head" style="color:${color};">${Utils.escapeHtml(g.head)}</div>
          ${chips}
        </div>`;
      }).join('');
    }

    // ---------- Referencing a translation ----------

    // Add/remove the clickable-title hint style on every translation's
    // title (never on Score/Remarks/etc titles).
    function markTransTitles(on) {
      document.querySelectorAll('.title-text').forEach((el) => {
        const mod = el.closest('[data-module-name]');
        const isTrans = mod && /^Trans\d+$/.test(mod.getAttribute('data-module-name') || '');
        if (on && isTrans) el.classList.add('rmd-clickable-title');
        else el.classList.remove('rmd-clickable-title');
      });
    }

    // Click a translation's title → whole-paragraph reference, "Trans N".
    // (Quoting a specific excerpt is Q, not a click — see tryQuoteSelection.)
    function onDocMouseUp(e) {
      if (!active || settingsOpen) return;
      if (e.target.closest && e.target.closest('#rmd-popover')) return;
      const titleEl = e.target.closest && e.target.closest('.title-text');
      if (!titleEl) return;
      const mod = titleEl.closest('[data-module-name]');
      const m = mod && /^Trans(\d+)$/.exec(mod.getAttribute('data-module-name') || '');
      if (!m) return;
      appendToken(`Trans ${m[1]}`, 'quote');
      openPopover(e.clientX, e.clientY);
    }

    function setHint(msg) {
      const hintEl = popover && popover.querySelector('#rmd-hint');
      if (hintEl) hintEl.textContent = msg;
    }

    // NOVA's Remarks textarea can be replaced by React re-renders, so this is
    // delegated on document (never replaced) rather than holding a direct
    // listener on the element itself — same reasoning as onDocMouseUp above.
    // Handles the reverse sync direction: typing directly into NOVA's own
    // visible Remarks field (instead of the composer box) now flows back
    // into previewEl too, instead of previewEl going stale and silently
    // overwriting it on the next composer-side action.
    function onNovaRemarksInput(e) {
      if (!active) return; // composer closed → previewEl hidden; enter() reloads fresh on next open
      const ta = e.target;
      if (!ta || ta.tagName !== 'TEXTAREA') return;
      if (!ta.closest || !ta.closest('[data-module-name="Remarks"]')) return;
      if (!previewEl) return;
      // Also breaks the composer→NOVA feedback loop: Utils.setNativeValue's
      // synthetic input event reaches here too, but previewEl.value is
      // always set before that call, so the values already match and this
      // is a no-op for that direction.
      if (previewEl.value === ta.value) return;
      previewEl.value = ta.value;
      setPreview(ta.value);
    }

    // Q: turn the current (plain, native) text selection into an excerpt
    // quote — Trans N "raw selected text" — with no word-boundary snapping;
    // this is exactly what the browser selected, taken as-is. Deliberately
    // a two-step action (select, then press Q) rather than firing the
    // instant you finish dragging, so quoting an excerpt is a decision you
    // make on purpose, not something that can happen by accident while
    // reading. The selection must sit entirely within one translation — a
    // selection spanning more than one, or no selection at all, does
    // nothing (with a hint) rather than guess which translation was meant.
    //
    // Containment is checked against the TransN container itself (via
    // Range.intersectsNode), not `.preview-content` — a straight anchor/
    // focus `.closest('.preview-content')` check (pre-v1.3.3) rejected the
    // common case of selecting an *entire* translation, because dragging
    // past the last character (or releasing in the blank space below the
    // last line) is a real Selection/Range quirk that resolves the boundary
    // to `.preview-content`'s parent rather than a node inside it, and
    // `.closest()` only ever walks upward from where the boundary landed.
    // Checking which TransN container(s) the range intersects is forgiving
    // about exactly where within the block the boundary resolved to, while
    // still refusing a selection that actually spans two translations.
    function tryQuoteSelection() {
      const selObj = window.getSelection();
      const text = selObj ? selObj.toString().trim() : '';
      if (!text) {
        // Nothing selected — most likely right after a quote just cleared
        // the selection. Put the cursor in the composer box so typing
        // continues there, rather than just leaving a hint and doing nothing.
        focusEditEnd();
        setHint('Nothing selected — jumped into the Remark Composer box. Select text in a translation first to quote it.');
        return false;
      }
      const range = selObj.rangeCount ? selObj.getRangeAt(0) : null;
      if (!range) return false;
      let transNum = null;
      const mods = document.querySelectorAll('[data-module-name]');
      for (const mod of mods) {
        const m = /^Trans(\d+)$/.exec(mod.getAttribute('data-module-name') || '');
        if (!m || !range.intersectsNode(mod)) continue;
        if (transNum) { transNum = null; break; } // touches a second translation → ambiguous, bail
        transNum = m[1];
      }
      if (!transNum) {
        setHint('Selection must stay inside a single translation.');
        return false;
      }
      appendToken(`Trans ${transNum} "${text}"`, 'quote');
      if (selObj.removeAllRanges) selObj.removeAllRanges();
      return true;
    }

    // ---------- Open / close ----------
    function enter() {
      active = true;
      document.body.classList.add('rmd-active'); // yields the keyboard to us — Module 1 checks this class
      // Load whatever's already in NOVA's Remarks field for this row (e.g.
      // reopening after typing something, or an existing remark) instead of
      // assuming it's empty.
      const ta = remarkTextarea();
      const val = ta ? ta.value : '';
      if (previewEl) previewEl.value = val;
      setPreview(val);
      if (popover) {
        // Always reset to the default size on open — resizing is
        // session-ephemeral, never persisted, so a closed-then-reopened
        // popover starts fresh regardless of how it was last resized.
        popover.style.width = POPOVER_DEFAULT_W + 'px';
        popover.style.height = POPOVER_DEFAULT_H + 'px';
        popover.style.display = 'flex';
        openPopover(lastMouseX, lastMouseY);
      }
      markTransTitles(true);
      syncOverlayGeometry();
    }
    function exit() {
      active = false;
      document.body.classList.remove('rmd-active');
      if (popover) popover.style.display = 'none';
      markTransTitles(false);
    }
    function toggle() { if (active) exit(); else enter(); }

    // ---------- Settings (⚙): edit/reorder/recolor chip groups ----------
    function openSettings() {
      settingsOpen = true;
      settingsBuffer = JSON.parse(JSON.stringify(chipConfig)); // edit a copy — only committed on Save
      injectSettingsModal();
      renderSettings();
    }
    function closeSettings() {
      settingsOpen = false;
      settingsBuffer = null;
      if (setOverlay) setOverlay.remove();
      setOverlay = null; setBody = null;
    }
    function injectSettingsModal() {
      if (setOverlay) return;
      const o = document.createElement('div');
      o.id = 'rmd-settings-overlay';
      o.innerHTML = `<div class="rmd-set-modal">
        <div style="display:flex;align-items:center;margin-bottom:10px;">
          <span style="font-weight:700;">⚙ Remark Chip Settings</span>
          <span style="flex:1;"></span>
          <button class="rmd-set-btn" id="rmd-set-add-group">+ Add group</button>
        </div>
        <div id="rmd-set-body"></div>
        <div class="rmd-set-footer">
          <button class="rmd-set-btn rmd-set-reset-btn" id="rmd-set-reset" title="Reset chips and popover size to defaults">↺</button>
          <span style="flex:1;"></span>
          <button class="rmd-set-btn" id="rmd-set-cancel">Cancel</button>
          <button class="rmd-set-btn" id="rmd-set-save" style="background:#3b5bdb;color:#fff;border-color:#3b5bdb;">Save</button>
        </div>
      </div>`;
      document.body.appendChild(o);
      setOverlay = o;
      setBody = o.querySelector('#rmd-set-body');
      o.addEventListener('mousedown', (e) => { if (e.target === o) closeSettings(); }); // click the dimmed background = close
      o.querySelector('#rmd-set-add-group').addEventListener('click', () => {
        settingsBuffer.groups.push({ key: 'fluency', head: '', chips: [] });
        renderSettings();
      });
      o.querySelector('#rmd-set-reset').addEventListener('click', () => {
        if (!confirm('Reset all chip groups to the built-in defaults?')) return;
        settingsBuffer = JSON.parse(JSON.stringify(DEFAULT_CHIP_CONFIG));
        renderSettings();
        // The chip reset only takes effect on Save, same as any other edit
        // to the buffer — but the popover's size isn't buffered anywhere,
        // so there's nothing to "commit" later; reset it immediately instead.
        if (popover) {
          popover.style.width = POPOVER_DEFAULT_W + 'px';
          popover.style.height = POPOVER_DEFAULT_H + 'px';
        }
      });
      o.querySelector('#rmd-set-cancel').addEventListener('click', closeSettings);
      o.querySelector('#rmd-set-save').addEventListener('click', () => {
        const cleaned = validateSettings(settingsBuffer);
        if (!cleaned) return; // validateSettings() has already alerted the reason
        chipConfig = cleaned;
        saveChipConfig(chipConfig);
        renderPalette();
        closeSettings();
      });
    }
    function renderSettings() {
      if (!setBody) return;
      setBody.innerHTML = settingsBuffer.groups.map((g, gi) => `
        <div class="rmd-set-group">
          <div class="rmd-set-group-head">
            <select class="rmd-set-color" data-gi="${gi}">
              ${COLOR_KEYS.map((k) => `<option value="${k}" ${k === g.key ? 'selected' : ''}>${COLOR_EMOJI[k]} ${k}</option>`).join('')}
            </select>
            <input type="text" class="rmd-set-name" data-gi="${gi}" value="${Utils.escapeHtml(g.head)}" placeholder="Group name">
            <button class="rmd-set-btn rmd-set-up" data-gi="${gi}" ${gi === 0 ? 'disabled' : ''}>↑</button>
            <button class="rmd-set-btn rmd-set-down" data-gi="${gi}" ${gi === settingsBuffer.groups.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="rmd-set-btn rmd-set-del-group" data-gi="${gi}">Delete group</button>
          </div>
          ${g.chips.map((c, ci) => `
            <div class="rmd-set-chip-row">
              <input type="text" class="rmd-set-chip-text" data-gi="${gi}" data-ci="${ci}" value="${Utils.escapeHtml(c)}">
              <button class="rmd-set-btn rmd-set-del-chip" data-gi="${gi}" data-ci="${ci}">✕</button>
            </div>`).join('')}
          <button class="rmd-set-btn rmd-set-add-chip" data-gi="${gi}">+ chip</button>
        </div>`).join('');

      setBody.querySelectorAll('.rmd-set-color').forEach((el) => el.addEventListener('change', (e) => {
        settingsBuffer.groups[+e.target.dataset.gi].key = e.target.value;
      }));
      setBody.querySelectorAll('.rmd-set-name').forEach((el) => el.addEventListener('input', (e) => {
        settingsBuffer.groups[+e.target.dataset.gi].head = e.target.value;
      }));
      setBody.querySelectorAll('.rmd-set-up').forEach((el) => el.addEventListener('click', (e) => {
        const gi = +e.target.dataset.gi;
        [settingsBuffer.groups[gi - 1], settingsBuffer.groups[gi]] = [settingsBuffer.groups[gi], settingsBuffer.groups[gi - 1]];
        renderSettings();
      }));
      setBody.querySelectorAll('.rmd-set-down').forEach((el) => el.addEventListener('click', (e) => {
        const gi = +e.target.dataset.gi;
        [settingsBuffer.groups[gi + 1], settingsBuffer.groups[gi]] = [settingsBuffer.groups[gi], settingsBuffer.groups[gi + 1]];
        renderSettings();
      }));
      setBody.querySelectorAll('.rmd-set-del-group').forEach((el) => el.addEventListener('click', (e) => {
        settingsBuffer.groups.splice(+e.target.dataset.gi, 1);
        renderSettings();
      }));
      setBody.querySelectorAll('.rmd-set-add-chip').forEach((el) => el.addEventListener('click', (e) => {
        settingsBuffer.groups[+e.target.dataset.gi].chips.push('');
        renderSettings();
      }));
      setBody.querySelectorAll('.rmd-set-chip-text').forEach((el) => el.addEventListener('input', (e) => {
        settingsBuffer.groups[+e.target.dataset.gi].chips[+e.target.dataset.ci] = e.target.value;
      }));
      setBody.querySelectorAll('.rmd-set-del-chip').forEach((el) => el.addEventListener('click', (e) => {
        settingsBuffer.groups[+e.target.dataset.gi].chips.splice(+e.target.dataset.ci, 1);
        renderSettings();
      }));
    }

    // Coerces an edited buffer into a valid chip config, or returns null
    // (after alerting why) if it can't be made valid: an invalid/missing
    // color key falls back to "fluency", empty chip text is dropped, groups
    // left with no name are dropped entirely, and at least one named group
    // is required.
    function validateSettings(buf) {
      const groups = buf.groups
        .map((g) => ({
          key: COLOR_KEYS.includes(g.key) ? g.key : 'fluency',
          head: (g.head || '').trim(),
          chips: (g.chips || []).map((c) => (c || '').trim()).filter(Boolean),
        }))
        .filter((g) => g.head.length > 0);
      if (!groups.length) { alert('Need at least 1 group with a name.'); return null; }
      return { groups };
    }

    // ---------- Styles ----------
    function injectStyle() {
      if (document.getElementById('rmd-style')) return;
      const s = document.createElement('style');
      s.id = 'rmd-style';
      s.textContent = `
        .rmd-clickable-title { cursor: pointer; text-decoration: underline dotted; text-underline-offset: 2px; }
        #rmd-popover {
          position: fixed; z-index: 2147483647; width: 380px; max-width: 92vw;
          min-width: 300px; min-height: 260px; box-sizing: border-box;
          background: #fff; border: 1px solid #d9d9e3; border-radius: 12px;
          box-shadow: 0 10px 32px rgba(0,0,0,.18);
          font: 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: #1f2430;
          display: none; flex-direction: column;
        }
        #rmd-head {
          display: flex; align-items: center; gap: 8px; padding: 10px 12px;
          border-bottom: 1px solid #eee; cursor: move; user-select: none;
        }
        #rmd-head .rmd-title { font-weight: 700; }
        #rmd-head button {
          border: 1px solid #dde1e6; background: #fff; color: #6b7280; border-radius: 7px;
          padding: 3px 9px; font-weight: 600; cursor: pointer; line-height: 1.4;
        }
        #rmd-palette {
          display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px;
          padding: 10px 12px; max-height: 220px; overflow: auto;
          flex: 1; min-height: 0;
        }
        .rmd-chip-col { display: flex; flex-direction: column; gap: 4px; }
        .rmd-chip-head { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; margin-bottom: 2px; }
        .rmd-chip {
          border: 1px solid; border-radius: 6px; background: #fff; padding: 3px 5px;
          font-size: 11px; text-align: left; cursor: pointer; line-height: 1.3;
        }
        .rmd-chip:hover { filter: brightness(0.97); }
        #rmd-edit-wrap {
          position: relative; margin: 4px 12px 10px; border: 1px solid #d9d9e3; border-radius: 8px; overflow: hidden;
        }
        #rmd-edit-bg, #rmd-edit {
          margin: 0; padding: 8px 10px; font: 12.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
          white-space: pre-wrap; word-wrap: break-word; box-sizing: border-box; width: 100%;
        }
        #rmd-edit-bg {
          position: absolute; inset: 0; color: #334155; pointer-events: none; overflow: hidden; background: transparent;
        }
        .rmd-tref { background: #fff3bf; border-radius: 3px; }
        #rmd-edit {
          position: relative; height: 72px; resize: vertical; border: none; outline: none;
          background: transparent; color: transparent; caret-color: #1f2430;
        }
        #rmd-hint { padding: 0 12px 10px; font-size: 11px; color: #9aa0ac; }
        #rmd-settings-overlay {
          position: fixed; inset: 0; z-index: 2147483647; background: rgba(15,23,42,.35);
          display: flex; align-items: center; justify-content: center;
        }
        .rmd-set-modal {
          width: min(520px, 92vw); max-height: 82vh; overflow: auto; background: #fff; border-radius: 12px;
          box-shadow: 0 16px 48px rgba(0,0,0,.25); padding: 16px 18px;
          font: 13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color: #1f2430;
        }
        .rmd-set-group { border: 1px solid #eee; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }
        .rmd-set-group-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
        .rmd-set-group-head input[type="text"] { flex: 1; padding: 4px 6px; border: 1px solid #d9d9e3; border-radius: 6px; }
        .rmd-set-chip-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
        .rmd-set-chip-row input[type="text"] { flex: 1; padding: 3px 6px; border: 1px solid #d9d9e3; border-radius: 6px; font-size: 12px; }
        .rmd-set-btn { border: 1px solid #dde1e6; background: #fff; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
        .rmd-set-reset-btn { color: #e03131; border-color: #ffc9c9; font-size: 15px; font-weight: 700; padding: 2px 7px; }
        .rmd-set-reset-btn:hover { background: #fff0f0; }
        .rmd-set-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; gap: 8px; }
        .rmd-resize-handle {
          position: absolute; right: 0; bottom: 0; width: 14px; height: 14px;
          cursor: nwse-resize;
          background: linear-gradient(135deg, transparent 0 50%, #c2c6d0 50% 60%,
                      transparent 60% 70%, #c2c6d0 70% 80%, transparent 80% 100%);
        }
      `;
      document.head.appendChild(s);
    }

    // ---------- Popover DOM ----------
    function injectPopover() {
      const existing = document.getElementById('rmd-popover');
      if (existing) { popover = existing; return; }
      const p = document.createElement('div');
      p.id = 'rmd-popover';
      p.innerHTML = `
        <div id="rmd-head">
          <span class="rmd-title">📝 Remark Composer</span>
          <span style="flex:1;"></span>
          <button id="rmd-settings-btn" title="Settings">⚙</button>
          <button id="rmd-clear-btn" title="Clear">Clear</button>
          <button id="rmd-close-btn" title="Close">✕</button>
        </div>
        <div id="rmd-palette"></div>
        <div id="rmd-edit-wrap">
          <div id="rmd-edit-bg" aria-hidden="true"></div>
          <textarea id="rmd-edit" spellcheck="false"></textarea>
        </div>
        <div id="rmd-hint">Click a translation's title to reference it. Select text in a translation, then press <b>Q</b> to quote it. Click a chip to add a phrase.</div>
        <div class="rmd-resize-handle" id="rmd-resize-handle" title="Drag to resize"></div>`;
      document.body.appendChild(p);
      popover = p;
      paletteEl = p.querySelector('#rmd-palette');
      previewEl = p.querySelector('#rmd-edit');
      bgEl = p.querySelector('#rmd-edit-bg');

      renderPalette();
      paletteEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.rmd-chip');
        if (!btn) return;
        appendToken(btn.getAttribute('data-chip'), 'phrase');
      });

      p.querySelector('#rmd-settings-btn').addEventListener('click', openSettings);
      p.querySelector('#rmd-clear-btn').addEventListener('click', clearBox);
      p.querySelector('#rmd-close-btn').addEventListener('click', exit);

      previewEl.addEventListener('input', () => {
        const ta = remarkTextarea();
        if (ta) Utils.setNativeValue(ta, previewEl.value); // mirror typed text into NOVA's real Remarks field
        setPreview(previewEl.value);
      });
      previewEl.addEventListener('scroll', syncOverlayGeometry);
      previewEl.addEventListener('focus', syncOverlayGeometry);

      makeDraggable(p);
      const resizeHandle = p.querySelector('#rmd-resize-handle');
      if (resizeHandle) makePopoverResizable(p, resizeHandle);
    }

    // ====================================================================
    // Keyboard
    // ====================================================================
    function typing() {
      const el = document.activeElement;
      if (!el) return false;
      if (el.isContentEditable) return true;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName === 'INPUT') {
        const t = (el.type || '').toLowerCase();
        return ['text', 'search', 'email', 'number', 'password', 'url', 'tel'].includes(t);
      }
      return false;
    }

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (settingsOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
        return; // let every other key go to whatever settings field is focused
      }

      if (e.key === 'Escape') {
        if (active) { e.preventDefault(); exit(); }
        return;
      }

      if (typing()) return; // don't hijack R/Q while typing anywhere, including our own edit box

      const k = e.key.toLowerCase();
      if (k === 'r') {
        e.preventDefault();
        toggle();
      } else if (k === 'q' && active) {
        // Only meaningful once the composer is open — Module 1 still owns Q
        // as "previous translation" everywhere else (it yields the keyboard
        // via body.rmd-active whenever we're active, so there's no clash).
        e.preventDefault();
        tryQuoteSelection();
      }
    }

    // ====================================================================
    // Watching the page for changes (SPA row changes / re-renders)
    // ====================================================================
    function getRowSig() {
      const src = document.querySelector('[data-module-key="NoteTrans"]')
        || document.querySelector('[data-module-name="Trans1"]');
      return src ? src.textContent.trim().slice(0, 80) : '';
    }

    function onMutate() {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!document.getElementById('rmd-popover')) injectPopover(); // re-inject if the platform wiped it
        injectStyle();
        const sig = getRowSig();
        if (sig !== lastRowSig) {
          lastRowSig = sig;
          if (active) {
            // Row changed while composer is open → the Remarks field now
            // belongs to a different row; reload our proxy from it instead
            // of carrying over the previous row's text.
            const ta = remarkTextarea();
            const val = ta ? ta.value : '';
            if (previewEl) previewEl.value = val;
            setPreview(val);
          }
          markTransTitles(active);
        }
        if (active) syncPreview();
      }, 250);
    }

    // ====================================================================
    // Startup
    // ====================================================================
    function start() {
      // QC doesn't record remarks — the key is ceded to the Compare module there instead
      // (质检不录 Remark,键位留给对比模块).
      if (/\/quality_/.test(location.href)) { rlog('QC page → Remark Composer not enabled'); return; }
      chipConfig = loadStoredChipConfig();
      injectStyle();
      injectPopover();
      lastRowSig = getRowSig();
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('mouseup', onDocMouseUp, true);
      document.addEventListener('input', onNovaRemarksInput, true);
      document.addEventListener('mousemove', (e) => { lastMouseX = e.clientX; lastMouseY = e.clientY; });
      const mo = new MutationObserver(onMutate);
      mo.observe(document.body, { childList: true, subtree: true });
      rlog('Started');
    }

    return { start };
  }

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
  // script's Module 3 (docs/for_reference/==UserScript==(v1.83) copy.txt,
  // lines 1343–2193) — see AGENTS.md §4.3 for the full design record,
  // including the `canonPath` cascade-matching fix this module depends on
  // (get this wrong and multi-level adopts silently fail while single-level
  // ones look fine). Two deliberate departures from the original, both
  // requested: the verdict buttons are driven to "1" / "3" instead of
  // "correct" / "wrong", and Remarks uses stateless per-line "＋ Add"
  // buttons instead of the original's whole-field Adopt/Undo. No panel `P`
  // toggle, no resize, no verdict-reload fallback — see AGENTS.md §7 for
  // why those were tried in an earlier build and deliberately left out here.
  // ======================================================================
  function QCCompare(Utils) {
    const TAG = '[QC Compare / 质检对比]';
    const VERSION = SCRIPT_VERSION;
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
    // Utils, matching the file's existing "modules stay behaviorally
    // isolated" rule (AGENTS.md §3).
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
    function render() { renderBadges(); renderTextCompare(); updateWarn(); cursor.sync(); }

    // ====================================================================
    // Selection cursor (added v1.3.2)
    //
    // Same arrow-key semantics as Module 1, via the shared TransCursor:
    // ↑/↓ step through the comparable translations, ←/→ toggle column
    // (Trans1-3 / Trans4-7) and return to where you last were in it.
    // ====================================================================
    const cursor = TransCursor({
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
          <div class="qc-hint">
            <span style="color:#c92a2a;font-weight:600;">Red Notices</span> indicate where Annotator&nbsp;2 differs from 1 — that's what's left to reconcile. \nClick the "<span style="color:#1c7ed6;font-weight:600;">Swap →</span>" button to take Annotator&nbsp;2's value; your original is kept as <i>"was…"</i> with an "<span style="color:#1c7ed6;font-weight:600;text-decoration:underline;">Undo</span>" button. Do nothing to keep Annotator&nbsp;1. <b>Rewrite</b> works the same way in a compare box below the field. \n<b>Remarks</b> has been updated, but be not afraid! Annotator&nbsp;2's remarks are listed line by line, Click the "<span style="color:#1c7ed6;font-weight:600;">＋&nbsp;Add</span>" button to append that line to the end of Annotator 1's Remarks; "Add" just pastes selected row of text at end of the Remarks and will not replace, reorder, or overwrite anything written.
            \n<b>Keyboard</b> (new): <span class="qc-kbd">↑</span><span class="qc-kbd">↓</span> select a translation, <span class="qc-kbd">←</span><span class="qc-kbd">→</span> switch column (Trans1-3 / Trans4-7). <span class="qc-kbd">S</span> swaps the selected translation to the other annotator's value — press it again to swap back. <span class="qc-kbd">3</span> / <span class="qc-kbd">C</span> / <span class="qc-kbd">Z</span> score it 3&nbsp;Points / Confusing / clear; <span class="qc-kbd">2</span> then <span class="qc-kbd">1</span>-<span class="qc-kbd">9</span><span class="qc-kbd">0</span> picks a 2&nbsp;Points label, <span class="qc-kbd">Esc</span> cancels. Shortcuts are off while you're typing in a text field, and edits only apply on the Annotator&nbsp;1 tab.
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
      applyHelp();
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
        case 'ArrowDown': e.preventDefault(); cursor.step(1); return;
        case 'ArrowUp': e.preventDefault(); cursor.step(-1); return;
        // Either arrow toggles column; the direction is ignored, matching Module 1.
        case 'ArrowLeft':
        case 'ArrowRight': e.preventDefault(); cursor.toggleColumn(); return;
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
      if (k === 's') { e.preventDefault(); swap(n); return; }
      if (k === 'z') { e.preventDefault(); eraseScore(n); return; }
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
      document.addEventListener('input', (e) => { if (isFieldTA(e.target)) { syncFieldHighlights(); updateWarn(); } }, true);
      document.addEventListener('scroll', (e) => { if (isFieldTA(e.target)) syncFieldHighlights(); }, true);
      // The Remarks field grows to fit its content (see startRemarksAutoGrow).
      // The highlight overlay is absolutely positioned and sized from the
      // textarea's own offsetWidth/offsetHeight, so it has to be re-measured
      // whenever that height changes or it drifts off the text.
      document.addEventListener(GROWN_EVENT, () => syncFieldHighlights());
      document.addEventListener('keydown', onKeyDown, true); // capture, matching Module 1
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

  // ======================================================================
  // Boot
  // ======================================================================
  const scoringShortcuts = ScoringShortcuts(Utils);
  const remarkComposer = RemarkComposer(Utils);
  const qcCompare = QCCompare(Utils);

  function bootAll() {
    // Before the modules, so its `input` listener is registered first and the
    // field has already grown by the time Module 3's own input handler
    // re-measures the highlight overlay against it.
    startRemarksAutoGrow(Utils);
    scoringShortcuts.start();
    remarkComposer.start();
    qcCompare.start();
  }

  if (document.body) bootAll();
  else window.addEventListener('DOMContentLoaded', bootAll);
})();
