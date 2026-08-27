// ============================================================================
// trans-tool / Utils
//
// Shared DOM helpers used by more than one module (Scoring Shortcuts, Remark
// Composer, QC Compare). Nothing here is tied to any one module's lifecycle —
// these are stateless functions, safe to hand around as a plain object.
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
    // real Space press would be scoped to.
    dispatchNativeSpace() {
      const target = document.activeElement || document;
      const opts = { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
    },
  };

  TL.Utils = Utils;
})();
