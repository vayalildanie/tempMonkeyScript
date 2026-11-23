// ============================================================================
// trans-tool / Utils
//
// Shared DOM helpers used by more than one module (Scoring Shortcuts, Remark
// Composer, QC Compare). Nothing here is tied to any one module's lifecycle —
// these are stateless functions, safe to hand around as a plain object. As
// of v1.4.3 this also includes shared UI *mechanism* — draggable/resizable
// panels, cascader-popup lookups, JSON localStorage read/write — that had
// drifted into near-duplicate copies across modules; each caller still owns
// its own storage key and behavior, only the DOM plumbing is shared. See
// README.md's "modules stay behaviorally isolated" ground rule for why that
// distinction matters.
//
// Loaded via @require, ahead of every module file — see
// annotation-scoring-shortcuts.user.js's @require list and boot order.
// ============================================================================
(function () {
  'use strict';
  window.TL = window.TL || {};

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

    // Which translation number a given module belongs to, read off its own
    // `data-module-name` (e.g. "Trans3 Score" -> 3 with suffix=" Score", or
    // plain "Trans3" -> 3 with suffix=""). A single space between Trans and
    // its number is optional so the observed "Trans 2 Remarks" spelling
    // parses the same way; the suffix still has to match exactly. Was
    // written independently in Scoring Shortcuts, Remark Composer, and QC
    // Compare — same regex, three copies.
    transNumFromModuleName(mod, suffix = '') {
      if (!mod) return null;
      const name = mod.getAttribute('data-module-name') || '';
      const m = new RegExp(`^Trans ?(\\d+)${suffix}$`).exec(name);
      return m ? parseInt(m[1], 10) : null;
    },

    // The text currently selected/shown in a cascader (score/label) control.
    readSelected(mod) {
      const item = mod && mod.querySelector('.ant-select-selection-item');
      return item ? item.textContent.trim() : '';
    },

    // ---- Shared page-reading helpers (Scoring Shortcuts, QC Compare, Remark Composer) ----
    // Each was previously copied into two or three modules.

    // A fingerprint for "which row am I on": the Note module's text (the
    // page's own source text, different per row), else Trans1's, first 80
    // chars trimmed. A change means the page navigated to a new row.
    rowSig() {
      const src = document.querySelector('[data-module-key="NoteTrans"]')
        || document.querySelector('[data-module-name="Trans1"]');
      return src ? src.textContent.trim().slice(0, 80) : '';
    },

    // Every module whose name is "Trans<N><suffix>", keyed by Trans number.
    // The platform nests duplicate `[data-module-name]` wrappers for one
    // module and re-renders can replace nodes, so this is read live and the
    // first (outermost) match wins per number.
    modulesBySuffix(suffix) {
      const map = new Map();
      document.querySelectorAll('[data-module-name]').forEach((mod) => {
        const n = Utils.transNumFromModuleName(mod, suffix);
        if (n !== null && !map.has(n)) map.set(n, mod);
      });
      return map;
    },

    // Trans n's Remarks textarea, or null (also null for a missing n).
    remarkTextarea(n) {
      const mod = Utils.modulesBySuffix(' Remarks').get(n);
      return (mod && mod.querySelector('textarea')) || null;
    },

    // ---- Shared cascader-popup helpers (Scoring Shortcuts + QC Compare) ----
    // Both modules drive the platform's Ant Design cascader controls and hit
    // the same "which popup actually belongs to the control I just clicked"
    // problem — each module's own adjacency check (findItemNearSelector /
    // pickNextOnPath) uses edgeGap to answer it; only that mechanism moved
    // here; the per-module "which item on the path" logic stayed local since
    // it differs (display text match vs. data-path-key walk).

    // Every visible (not display:none) Ant Design dropdown currently open
    // anywhere on the page.
    popupsVisible() {
      return Array.from(document.querySelectorAll('.ant-select-dropdown'))
        .filter((p) => getComputedStyle(p).display !== 'none');
    },

    // Distance between a popup's near edge and its trigger's near edge. A
    // dropdown always renders flush against its own trigger (just a few
    // pixels of gap), so this distance reliably tells "this control's own
    // dropdown" apart from a different translation's dropdown that happens
    // to be open at the same time.
    edgeGap(popup, selectorRect) {
      const pr = popup.getBoundingClientRect();
      if ((popup.className || '').indexOf('placement-top') >= 0) return Math.abs(pr.bottom - selectorRect.top);
      return Math.abs(pr.top - selectorRect.bottom);
    },

    // Close every cascader dropdown that's currently open (detected via
    // aria-expanded="true"), by clicking its own trigger to collapse it —
    // so a stale/leftover open dropdown can never reappear alongside, or
    // get confused with, the one about to be driven.
    async closeOpenCascaders() {
      const opens = Array.from(document.querySelectorAll('input[aria-expanded="true"]'));
      for (const inp of opens) {
        const sel = inp.closest('.ant-select');
        if (sel) Utils.clickEl(sel.querySelector('.ant-select-selector') || sel);
      }
      if (opens.length) {
        await Utils.waitFor(() => document.querySelectorAll('input[aria-expanded="true"]').length === 0, 700).catch(() => {});
      }
    },

    // Pick item #index (1-based) from the deepest column currently shown in
    // an open cascader popup — the number-key label pick both Scoring
    // Shortcuts and QC Compare do. Only the pick/click/drill mechanics live
    // here; finding the popup, the busy guard, status text and what happens
    // after a commit stay in each module.
    //
    // The decisive signal: `ant-cascader-menu-item-expand` present means a
    // category (drill deeper), absent means a leaf label. A category with
    // exactly one leaf child gets that leaf picked too — it still has to be
    // selected explicitly (e.g. to land on "Grammar/Grammar").
    //
    // opts.findPopup re-finds the popup after the category click (each
    // module has its own lookup; defaults to the popup passed in).
    // opts.beforeLeafClick runs right before the auto-picked leaf is
    // clicked, so Scoring Shortcuts can re-read the displayed value the
    // category click may have changed.
    //
    // Returns { outcome }: 'not-open' (fewer than 2 columns), 'not-found'
    // (no item at that index), 'leaf', 'drilled-leaf' or 'drilled-category'.
    async pickCascaderItem(popup, index, opts = {}) {
      const findPopup = opts.findPopup || (() => popup);
      const cols = popup.querySelectorAll('ul.ant-cascader-menu');
      if (cols.length < 2) return { outcome: 'not-open' };
      const col = cols[cols.length - 1]; // deepest column currently shown
      const li = col.querySelectorAll('li.ant-cascader-menu-item')[index - 1];
      if (!li) return { outcome: 'not-found' };

      const isLeaf = !li.classList.contains('ant-cascader-menu-item-expand');
      const colsBefore = cols.length;
      Utils.clickEl(li.querySelector('.ant-cascader-menu-item-content') || li);
      if (isLeaf) return { outcome: 'leaf' };

      // Category: drill in and wait for the next column to render.
      await Utils.waitFor(() => {
        const p = findPopup();
        return !!p && p.querySelectorAll('ul.ant-cascader-menu').length > colsBefore;
      }, 800).catch(() => {});

      const p2 = findPopup();
      const newCols = p2 ? p2.querySelectorAll('ul.ant-cascader-menu') : [];
      const deepest = newCols[newCols.length - 1];
      const subItems = deepest ? deepest.querySelectorAll('li.ant-cascader-menu-item') : [];
      if (subItems.length === 1 && !subItems[0].classList.contains('ant-cascader-menu-item-expand')) {
        if (opts.beforeLeafClick) opts.beforeLeafClick();
        Utils.clickEl(subItems[0].querySelector('.ant-cascader-menu-item-content') || subItems[0]);
        return { outcome: 'drilled-leaf' };
      }
      return { outcome: 'drilled-category' };
    },

    // ---- JSON-safe localStorage read/write ----
    // Only the try/catch + parse/stringify mechanics; which key to use and
    // what shape to store stays each caller's own decision (position/size
    // objects, flags, config blobs — whatever that module owns).
    readJSON(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    writeJSON(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    },

    // Pull a fixed-position element back inside the viewport: past the
    // right/bottom edge gets pulled back, negative coords clamp to 0. Used
    // after restoring a saved position (the screen may have gotten smaller
    // since) and after un-collapsing a panel.
    clampIntoView(el, pad = 4) {
      const r = el.getBoundingClientRect();
      const left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, r.left));
      const top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, r.top));
      el.style.left = left + 'px'; el.style.top = top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
    },

    // ---- Draggable / resizable panels (v1.4.3) ----
    // Previously hand-rolled independently in Scoring Shortcuts, Remark
    // Composer, and QC Compare — the same mousedown/mousemove/mouseup
    // wiring three times, with real drift between the copies (only two of
    // the three clamped the dragged panel into the viewport). This is the
    // mechanism only — which storage key to use and what to persist stays
    // each caller's own decision via its own onDrop callback, same as the
    // rest of this file: shared *mechanism*, never shared *state*.

    // Make `el` draggable via mousedown-drag on `handle`, switching it to
    // fixed left/top positioning (cancelling any right/bottom/transform
    // positioning already on it).
    //   clamp        — keep `el` fully inside the viewport while dragging (default true)
    //   ignore(e)    — return true to ignore this mousedown (default: clicks on a <button>)
    //   onDragStart()— called once, when a drag begins
    //   onDrop()     — called once, when the mouse is released (e.g. to persist the new position)
    makeDraggable(el, handle, opts = {}) {
      if (!handle) return;
      const {
        clamp = true,
        ignore = (e) => e.target.closest && e.target.closest('button'),
        onDragStart,
        onDrop,
      } = opts;
      let ox = 0, oy = 0;
      function onMove(e) {
        let left = e.clientX - ox, top = e.clientY - oy;
        if (clamp) {
          const r = el.getBoundingClientRect(), pad = 4;
          left = Math.max(pad, Math.min(window.innerWidth - r.width - pad, left));
          top = Math.max(pad, Math.min(window.innerHeight - r.height - pad, top));
        }
        el.style.left = left + 'px'; el.style.top = top + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto'; el.style.transform = 'none';
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        if (onDrop) onDrop();
      }
      handle.addEventListener('mousedown', (e) => {
        if (ignore(e)) return;
        e.preventDefault();
        if (onDragStart) onDragStart();
        const r = el.getBoundingClientRect();
        ox = e.clientX - r.left; oy = e.clientY - r.top;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
    },

    // Make `el` resizable via mousedown-drag on `handle` (typically a
    // corner or edge grip). `axes: 'x'` is width-only (Scoring Shortcuts'
    // panel, whose height always auto-fits its content); `'xy'` is
    // width+height (Remark Composer's popover). Bounds are read once per
    // drag via `getMaxW`/`getMaxH` — the element's left/top don't move
    // during a resize, so a value computed at drag-start stays correct for
    // the whole drag.
    //   onDrop() — called once, when the mouse is released (e.g. to persist the new size)
    makeResizable(el, handle, opts = {}) {
      if (!handle) return;
      const { axes = 'x', minW = 0, minH = 0, getMaxW, getMaxH, onDrop } = opts;
      let startX = 0, startY = 0, startW = 0, startH = 0, maxW = Infinity, maxH = Infinity;
      function onMove(e) {
        const w = Math.max(minW, Math.min(maxW, startW + (e.clientX - startX)));
        el.style.width = w + 'px';
        if (axes === 'xy') {
          const h = Math.max(minH, Math.min(maxH, startH + (e.clientY - startY)));
          el.style.height = h + 'px';
        }
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('mouseup', onUp, true);
        if (onDrop) onDrop();
      }
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation(); // don't also start a drag from the same mousedown
        const r = el.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY; startW = r.width; startH = r.height;
        maxW = getMaxW ? (getMaxW() || Infinity) : Infinity;
        maxH = getMaxH ? (getMaxH() || Infinity) : Infinity;
        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('mouseup', onUp, true);
      });
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

    // Collapse repeated calls to `fn` (no args) onto the next animation
    // frame — at most one real call per frame no matter how many times the
    // returned function is invoked before then. For handlers hung off a
    // per-keystroke event (input/scroll) that do real DOM reads (offsetTop,
    // scrollHeight, getComputedStyle) or DOM writes, calling the underlying
    // work synchronously on every event forces a layout recalculation once
    // per character typed — on a long field that's the difference between
    // smooth typing and visible stutter.
    rafThrottle(fn) {
      let scheduled = false;
      return function () {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; fn(); });
      };
    },

    // ---- Shared toast + keycap styling (promoted from Scoring Shortcuts in
    // the v1.4.0 module split, so Remark Composer's relocated check-mode
    // system can show the exact same toast without duplicating its CSS) ----
    //
    // Idempotent, lazily called by showToast() itself and by any module's
    // own injectStyle() that renders a `.tl-kbd` keycap in its legend/panel
    // — so `.tl-kbd` exists regardless of which module happens to run first.
    ensureToastStyle() {
      if (document.getElementById('tl-toast-style')) return;
      const s = document.createElement('style');
      s.id = 'tl-toast-style';
      s.textContent = `
        /* Renders a key name in a panel/legend like a physical keycap. */
        .tl-kbd {
          display: inline-block; min-width: 18px; padding: 1px 5px; margin-right: 5px;
          font: 600 11px/1.4 ui-monospace, Menlo, Consolas, monospace; text-align: center;
          color: #1f2430; background: #fff; border: 1px solid #c2c6d0; border-bottom-width: 2px;
          border-radius: 4px; box-shadow: 0 1px 0 rgba(0,0,0,.04); vertical-align: middle;
        }
        /* Blocked-submission toast. Its own floating element rather than a
           panel's status line, which is invisible when that panel is
           collapsed/closed — a blocked submit must never be missable. */
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
        #tl-toast .tl-toast-sub { display: block; margin-top: 5px; font-size: 12px; color: #a1690a; }
        /* Pass variant — a check that succeeded, not one that blocked. Kept as a
           class toggle on the same #tl-toast element rather than a second toast
           system, so both variants share position/sizing/timer logic. */
        #tl-toast.tl-toast-ok { background: #ebfbee; color: #2b8a3e; border-color: #2f9e44; }
        #tl-toast.tl-toast-ok b { color: #2b8a3e; }
        #tl-toast.tl-toast-ok .tl-toast-sub { color: #2f9e44; }`;
      document.head.appendChild(s);
    },

    // Show a transient centered message. Re-shown while already visible just
    // resets the timer, so holding Enter doesn't stack toasts. `variant`
    // 'warn' (default) is the amber blocked-submission style; 'ok' is the
    // green pass-confirmation style (see .tl-toast-ok above).
    showToast(html, ms = 2600, variant = 'warn') {
      let t = document.getElementById('tl-toast');
      if (!t) {
        Utils.ensureToastStyle();
        t = document.createElement('div');
        t.id = 'tl-toast';
        document.body.appendChild(t);
      }
      t.innerHTML = html;
      t.classList.toggle('tl-toast-ok', variant === 'ok');
      // Next frame, so the opacity transition actually runs on first show.
      requestAnimationFrame(() => t.classList.add('tl-toast-show'));
      clearTimeout(Utils._toastTimer);
      Utils._toastTimer = setTimeout(() => {
        t.classList.remove('tl-toast-show');
      }, ms);
    },

    // ---- Submit Check: synthesize the platform's native Space submit ----
    // Space is the platform's real submit key. Submit Check mode (Remark
    // Composer) fires this once its completeness check passes, so a clean
    // Enter both checks and submits in one press. Fires a full
    // keydown+keyup pair, bubbling, the same "real sequence of events"
    // approach Utils.fireMouse uses for synthetic mouse input. Targets
    // document.activeElement (falling back to document) since that's what a
    // real Space press would be scoped to — except when that is a form
    // control or editable element (e.g. the Ant cascader's readonly search
    // input, which keeps focus after a mouse-picked score). Hotkey handlers
    // typically ignore keys aimed at those, so the event goes to the body.
    // UNVERIFIED against the live NOVA page: the body retarget rests on an
    // assumed hotkey guard, and Submit Check needs a live-page smoke test
    // before being trusted (see tests/fixtures/README.md).
    dispatchNativeSpace() {
      let target = document.activeElement || document;
      if (target.nodeType === 1 && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
        target = document.body;
      }
      const opts = { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
    },

    // ---- Does this score need a remark? (v1.5.7) ----
    // The one rule behind both the submit gate and "Likely need remarks".
    // Exempt: unscored, 3 Points, and every Confusing sub-label except the
    // open-feedback one (the others describe the problem on their own).
    // Everything else — all 2 Points, and any label NOVA adds later — needs
    // one, so an unknown label blocks rather than slipping through.
    // The exception is matched as a whole string: the label contains a "/"
    // itself, so splitting the path on "/" would misread it.
    needsRemark(text) {
      const t = String(text == null ? '' : text).trim();
      if (t === '' || /^3 Points/.test(t)) return false;
      if (/^Confusing \/ /.test(t)) return t === 'Confusing / Other / open feedback';
      return true;
    },

    // ---- Submit gate: check first, then submit with the native Space ----
    // Shared by Remark Composer's Enter check and QC Compare's Enter-to-submit.
    // `check()` returns '' (or null) when nothing blocks the submit, or an
    // HTML message saying what does. Blocked: the key is swallowed and the
    // message shown as a toast. Clean: optional `passToast`, then — only when
    // `submit` is true — the key's own effect is replaced by
    // dispatchNativeSpace(). Returns true on a clean pass.
    runSubmitGate(e, { check = () => '', submit = true, passToast = '' } = {}) {
      const blocked = check();
      if (blocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        Utils.showToast(blocked);
        return false;
      }
      if (passToast) Utils.showToast(passToast, 1600, 'ok');
      if (submit) {
        e.preventDefault();
        Utils.dispatchNativeSpace();
      }
      return true;
    },

    // ---- Copy-tag stripping (v1.4.4) ----
    // The platform's own translation text carries machine-translation
    // segment tags (`<content1>`, `</content1>`, etc.) that are never meant
    // to be read by a human — they only ever show up wrapping the very start
    // and/or end of a string, never in the middle. Strips any number of them
    // off both ends, repeatedly (handles nested wrapping like
    // "<a><b>text</b></a>"), and leaves everything else — including a
    // literal "<" a translator typed as content — untouched. Exported as a
    // standalone function (not folded into the clipboard patch below) so the
    // quote feature can reuse the exact same rule later.
    stripAnnotationTags(text) {
      if (typeof text !== 'string') return text;
      const leading = /^\s*<\/?[A-Za-z][\w-]*\s*\/?>\s*/;
      const trailing = /\s*<\/?[A-Za-z][\w-]*\s*\/?>\s*$/;
      let out = text, prev;
      do { prev = out; out = out.replace(leading, ''); } while (out !== prev);
      do { prev = out; out = out.replace(trailing, ''); } while (out !== prev);
      return out;
    },

    // Patch `navigator.clipboard.writeText` in place so every copy made
    // through it — including the platform's own per-translation copy icons,
    // whatever their DOM shape — is run through `stripAnnotationTags` first.
    // Deliberately not a click-listener on the copy icon itself: those icons
    // are plain unlabeled `<img>`s with framework-generated scoped-CSS
    // attributes and no stable selector, while every copy path on this
    // platform ends up calling the same clipboard API — patching that one
    // choke point is robust to the page's DOM changing under us. Idempotent
    // (`__tlPatched` guard) so re-running boot (e.g. after a SPA
    // navigation re-injects the script) never double-wraps it.
    installClipboardSanitizer() {
      const clipboard = navigator.clipboard;
      if (!clipboard || !clipboard.writeText || clipboard.writeText.__tlPatched) return;
      const original = clipboard.writeText.bind(clipboard);
      const patched = (text) => original(Utils.stripAnnotationTags(text));
      patched.__tlPatched = true;
      clipboard.writeText = patched;
    },

    // ---- Shared settle observer (v1.5.5 T3 — P-SELF, C-SHARED part 1) ----
    // Every module (Scoring Shortcuts, QC Compare, Remark Composer) watches
    // document.body for SPA row-changes/re-renders via its own debounced
    // MutationObserver, so the platform settling (or our own panel/popover
    // re-render) can be reacted to once, after a short quiet period rather
    // than on every single mutation record. Previously each module also
    // reacted to mutations it caused ITSELF — typing into the composer, for
    // instance, repaints its own highlight backdrop — which kept
    // rescheduling that module's settle timer indefinitely while the user
    // typed. This selector names every root/piece of UI any module injects
    // into the page, so records caused only by our own writes can be
    // filtered out before deciding whether to (re)start the settle timer.
    OWN_UI_SELECTOR: '#rmd-popover, #rmd-settings-overlay, #rmd-check-pill, #tl-score-panel, #tl-score-pill, .qc-badge, #qc-panel, .tl-toast',

    // Settle delay per module (unchanged from each module's own prior
    // hardcoded value — centralized here only so there's one place that
    // defines "how long is quiet enough").
    SETTLE_MS: { score: 200, remark: 250, qc: 220 },

    // One MutationObserver, watching document.body, that calls `fn` after
    // mutations have been quiet for `delayMs` — but only counting mutations
    // that aren't just the script re-painting its own UI (see
    // OWN_UI_SELECTOR above). A record is "our own" when its target (or, for
    // a characterData record, the target text node's parentElement) sits
    // inside OWN_UI_SELECTOR — EXCEPT a record whose removedNodes includes
    // one of our own root elements: the platform wiping out
    // #rmd-popover/#tl-score-panel/#qc-panel wholesale must still restart
    // the timer, so onMutate's "re-inject if the platform wiped it" check
    // actually gets to run.
    //
    // opts.characterData — observe characterData mutations too (only Remark
    //   Composer needs this, for its live backdrop/preview text).
    // opts.name — when set, and window.__tlSettleScheduled exists
    //   (test-only instrumentation), increments window.__tlSettleScheduled[name]
    //   every time the timer actually (re)starts.
    // opts.shouldSkip() — optional, generic, caller-supplied predicate checked
    //   on every batch before scheduling/rescheduling the settle timer. When
    //   it returns true, the batch is dropped entirely (no timer start, no
    //   reschedule, no test counter bump) — the same effect a module's own
    //   early-bail raw mutation callback had before this observer was
    //   shared. Kept as a plain predicate rather than named module state (no
    //   `scraping`/`adopting` here) so this helper stays module-agnostic;
    //   each caller supplies its own notion of "busy right now" (e.g. QC
    //   Compare's `() => scraping || adopting`).
    //
    // Returns the MutationObserver (already observing) — one instance per
    // caller; this does not share a single observer across modules.
    observeSettled(fn, delayMs, opts = {}) {
      const { characterData = false, name, shouldSkip } = opts;
      let timer = null;
      function ownRootRemoved(record) {
        return Array.from(record.removedNodes).some((n) => n.nodeType === 1 && n.matches && n.matches(Utils.OWN_UI_SELECTOR));
      }
      function isOwnWrite(record) {
        const el = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        return !!(el && el.closest && el.closest(Utils.OWN_UI_SELECTOR));
      }
      function onBatch(records) {
        if (shouldSkip && shouldSkip()) return; // caller says it's busy — don't touch the timer at all
        const kept = records.filter((r) => !isOwnWrite(r) || ownRootRemoved(r));
        if (!kept.length) return; // nothing but our own writes in this batch — don't reschedule
        clearTimeout(timer);
        if (name && window.__tlSettleScheduled) window.__tlSettleScheduled[name]++; // test-only counter
        timer = setTimeout(fn, delayMs);
      }
      const mo = new MutationObserver(onBatch);
      mo.observe(document.body, { childList: true, subtree: true, characterData });
      return mo;
    },
  };

  TL.Utils = Utils;
})();
