(function () {
  'use strict';
  window.TL = window.TL || {};

  // ============================================================================
  // trans-tool / Remark Composer
  //
  // Lets an annotator build a structured remark by clicking translation
  // titles and category chips instead of typing full sentences by hand —
  // quoting is select-then-Q (plain browser selection, no drag-takeover/
  // word-snapping).
  //
  // As of v1.4.0 this module also owns the submit-check system, moved here
  // wholesale from Scoring Shortcuts: `O` opens/closes this window, `Z`
  // cycles the 3-way check mode (Label Check / Submit Check / Check Off),
  // and `Enter` runs that check safely — never submitting on its own except
  // Submit Check mode's synthetic Space. `Alt` was dropped entirely, not
  // carried over. It reads label-completeness through `scoringShortcuts`'s
  // one read-only `checkCompleteness()` method rather than reaching into
  // Scoring Shortcuts' own DOM-reading internals — see README.md's "Modules
  // stay behaviorally isolated" ground rule for why that's a narrower, safer
  // exception than sharing stateless code (Utils/TransCursor).
  // ============================================================================
  function RemarkComposer(Utils, scoringShortcuts) {
    const RTAG = '[Remark Composer / Remark]';
    const RDEBUG = false;
    function rlog(m) { if (RDEBUG) console.log(`${RTAG} ${m}`); }

    // ---------- Configuration (edit here to change keys) ----------
    const CFG = {
      keyOpen: 'o',        // open/close this window
      keyCycleCheck: 'z',  // cycles the submit check: Label Check → Submit Check → Check Off
    };

    // The submit check's 3-way mode: whether/how Enter is held back while any
    // populated translation is still incompletely labelled. Persisted across
    // reloads under the SAME key Scoring Shortcuts used before this system
    // moved here (v1.4.0) — it's a stored user preference, not tied to which
    // file implements it, and renaming it would silently reset that
    // preference for existing installs. A brand-new session with nothing yet
    // stored still starts at Label Check (index 0); only an *existing* saved
    // mode survives a refresh.
    //   'label'  — block on incomplete, let a clean Enter through untouched
    //   'submit' — same blocking, but a clean Enter also synthesizes Space to actually submit
    //   'off'    — no check at all, Enter always proceeds untouched
    const CHECK_MODES = ['label', 'submit', 'off'];
    // Shared by the popover's check badge (updateCheckBadge) and the
    // closed-state pill (updatePillIcon, added in v1.4.1) so both always
    // agree on icon/label/color for the current mode.
    const CHECK_STYLES = {
      label: { text: '🛡️ Label Check', bg: '#ebfbee', fg: '#2b8a3e', border: '#b2f2bb' },
      submit: { text: '⚔️ Submit Check', bg: '#eef1fb', fg: '#3b5bdb', border: '#bac8f7' },
      off: { text: '⚠️ Check OFF', bg: '#fff0f0', fg: '#c92a2a', border: '#ffc9c9' },
    };
    let checkModeIdx = 0; // overwritten in start() from SCORE_CHECK_KEY if a saved mode exists
    const SCORE_CHECK_KEY = 'trans-tool:nova-score-check-v1';
    function loadSavedCheckModeIdx() {
      try {
        const idx = CHECK_MODES.indexOf(localStorage.getItem(SCORE_CHECK_KEY));
        return idx === -1 ? 0 : idx;
      } catch (e) { return 0; }
    }
    function saveCheckModeIdx() {
      try { localStorage.setItem(SCORE_CHECK_KEY, CHECK_MODES[checkModeIdx]); } catch (e) {}
    }

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
    let checkBadgeEl = null;       // shows the current check mode in the popover header
    let pillEl = null;             // closed-state pill shown while the popover is hidden (v1.4.1)
    let pinned = false;            // true once the user has manually dragged the popover — stop auto-repositioning it
    let lastMouseX = window.innerWidth / 2, lastMouseY = 150; // where the popover appears when opened via O
    let lastRowSig = '';
    let settleTimer = null;

    // Popover size/position — persisted across reloads as of v1.4.0 ("an
    // adjustable window like the shortcuts Legend"), matching Scoring
    // Shortcuts' own panel persistence. The defaults below are only used on
    // a first-ever open, before anything's been saved.
    const POPOVER_DEFAULT_W = 380;  // matches the original fixed CSS width
    const POPOVER_DEFAULT_H = 420;  // nominal default; tune this constant if it looks off in practice
    const POPOVER_MIN_W = 300;      // keeps the header buttons (⚙/Clear/✕) from crowding
    const POPOVER_MIN_H = 260;      // keeps header + edit box + hint usable
    const RMD_POS_KEY = 'trans-tool:nova-remark-pos-v1';
    const RMD_SIZE_KEY = 'trans-tool:nova-remark-size-v1';

    function savePos(p) {
      const r = p.getBoundingClientRect();
      Utils.writeJSON(RMD_POS_KEY, { left: Math.round(r.left), top: Math.round(r.top) });
    }
    // Returns true if a saved position was found and applied.
    function applySavedPos(p) {
      const o = Utils.readJSON(RMD_POS_KEY);
      if (o && typeof o.left === 'number' && typeof o.top === 'number') {
        p.style.left = o.left + 'px'; p.style.top = o.top + 'px';
        return true;
      }
      return false;
    }
    function saveSize(p) {
      const r = p.getBoundingClientRect();
      Utils.writeJSON(RMD_SIZE_KEY, { w: Math.round(r.width), h: Math.round(r.height) });
    }
    // Returns true if a saved size was found and applied.
    function applySavedSize(p) {
      const o = Utils.readJSON(RMD_SIZE_KEY);
      if (o && typeof o.w === 'number' && typeof o.h === 'number') {
        p.style.width = Math.max(POPOVER_MIN_W, o.w) + 'px';
        p.style.height = Math.max(POPOVER_MIN_H, o.h) + 'px';
        return true;
      }
      return false;
    }

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
    // setter, so both stay in sync. Shared by every token producer: the
    // chip palette's click handler, and the quote flow (tryQuoteSelection,
    // below), which builds its token as `Trans N "<selected text>"`.
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
    //
    // Matches a comma/hyphen list after "Trans", not just a lone number —
    // "Trans 1", "Trans 1, 2", "Trans 0, 1", "Trans 1-3", and "Trans 1-3, 5"
    // all highlight in full. This is display-only pattern matching, not a
    // check against which translations actually exist: it never parses the
    // numbers or validates them, it just recognizes the shape so a
    // hand-typed "this quote spans Trans 2, 3" reads the same as a
    // machine-inserted single-translation quote.
    function highlightTransRefs(text) {
      return Utils.escapeHtml(text).replace(
        /\bTrans\s+\d+(?:\s*[-,]\s*\d+)*\b/g,
        (m) => `<span class="rmd-tref">${m}</span>`
      );
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
    // Drag/resize mechanics are shared with Scoring Shortcuts and QC
    // Compare — see utils.js. One behavior change from the unification:
    // this popover now also clamps into the viewport while dragging
    // (Utils.makeDraggable's default), matching the other two panels —
    // previously it was the only one of the three that could be dragged
    // fully off-screen.
    function makeDraggable(p) {
      Utils.makeDraggable(p, p.querySelector('#rmd-head'), {
        onDragStart: () => { pinned = true; }, // manual drag → stop following the mouse from now on
        onDrop: () => savePos(p),
      });
    }

    // Corner-drag resize, both axes, grow or shrink — persisted across
    // reloads (see RMD_SIZE_KEY above); enter() falls back to
    // POPOVER_DEFAULT_W/H only when nothing's been saved yet.
    function makePopoverResizable(p, handle) {
      Utils.makeResizable(p, handle, {
        axes: 'xy',
        minW: POPOVER_MIN_W,
        minH: POPOVER_MIN_H,
        getMaxW: () => window.innerWidth - p.getBoundingClientRect().left - 8,
        getMaxH: () => window.innerHeight - p.getBoundingClientRect().top - 8,
        onDrop: () => saveSize(p),
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
        const isTrans = mod && Utils.transNumFromModuleName(mod) !== null;
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
      const transNum = Utils.transNumFromModuleName(mod);
      if (transNum === null) return;
      appendToken(`Trans ${transNum}`, 'quote');
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
    // ---------- Quoting a selection (Q key, wired in onKeyDown below) ----------
    // Flow: read the current browser selection -> confirm it lands inside
    // exactly one Trans N module -> build a `Trans N "<selected text>"`
    // token via appendToken() above -> clear the selection so it doesn't
    // linger highlighted after the quote is inserted.
    //
    // Known defects, documented here but not fixed in v1.4.1:
    //   - `text` is interpolated into the token unescaped (see the
    //     `Trans ${transNum} "${text}"` line below) — a selection that
    //     itself contains a `"` character produces a malformed token.
    //   - No guard against inserting the same quote twice: pressing Q
    //     twice on an unchanged/overlapping selection appends the token
    //     twice.
    //   - Multi-line selections keep their raw newlines inside the token
    //     (only leading/trailing whitespace is trimmed), so a
    //     multi-paragraph quote reads as a messy multi-line remark.
    function tryQuoteSelection() {
      const selObj = window.getSelection();
      // Same tag-stripping rule as the copy-icon fix (v1.4.4,
      // Utils.stripAnnotationTags): a selection that starts or ends at a
      // translation's very edge can catch the wrapping MT segment tag
      // (`<content1>`, `</content1>`, etc.) along with the real text, so run
      // the raw selection through the same helper before anything else.
      const text = Utils.stripAnnotationTags(selObj ? selObj.toString() : '').trim();
      if (!text) {
        // Nothing selected — most likely right after a quote just cleared
        // the selection. Put the cursor in the composer box so typing
        // continues there, rather than just leaving a hint and doing nothing.
        focusEditEnd();
        setHint('Nothing selected — jumped into the Remark Options box. Select text in a translation first to quote it.');
        return false;
      }
      const range = selObj.rangeCount ? selObj.getRangeAt(0) : null;
      if (!range) return false;
      let transNum = null;
      const mods = document.querySelectorAll('[data-module-name]');
      for (const mod of mods) {
        const n = Utils.transNumFromModuleName(mod);
        if (n === null || !range.intersectsNode(mod)) continue;
        // The platform can render more than one element sharing the same
        // `[data-module-name="TransN"]` for a single translation — every
        // other reader of this attribute in the codebase already accounts
        // for that by grabbing only the first match via `querySelector`
        // (see Utils.transHasText, scoring-shortcuts.js, and the fallback
        // a few lines below in this same file). This loop uses
        // `querySelectorAll` instead (it has to, to detect a genuinely
        // cross-translation selection), so it must compare the NUMBER, not
        // just whether a second match happened — otherwise a selection
        // that intersects two same-numbered duplicate nodes for one
        // translation was wrongly read as touching two different
        // translations and always bailed with "Selection must stay inside
        // a single translation," even for a selection that never left one.
        if (transNum !== null && n !== transNum) { transNum = null; break; } // touches a second, different translation → ambiguous, bail
        transNum = n;
      }
      if (transNum === null) {
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
      updatePillIcon(); // hides the pill now that the popover is open
      document.body.classList.add('rmd-active'); // yields the keyboard to us — Module 1 checks this class
      // Load whatever's already in NOVA's Remarks field for this row (e.g.
      // reopening after typing something, or an existing remark) instead of
      // assuming it's empty.
      const ta = remarkTextarea();
      const val = ta ? ta.value : '';
      if (previewEl) previewEl.value = val;
      setPreview(val);
      if (popover) {
        // Size and position persist across reloads (v1.4.0) — fall back to
        // the fixed defaults / mouse-follow behavior only on a first-ever
        // open, before anything's been saved.
        if (!applySavedSize(popover)) {
          popover.style.width = POPOVER_DEFAULT_W + 'px';
          popover.style.height = POPOVER_DEFAULT_H + 'px';
        }
        if (applySavedPos(popover)) {
          pinned = true; // a remembered position means "stay put", not "follow the mouse"
          popover.style.display = 'flex';
        } else {
          popover.style.display = 'flex';
          openPopover(lastMouseX, lastMouseY);
        }
      }
      markTransTitles(true);
      syncOverlayGeometry();
    }
    function exit() {
      active = false;
      document.body.classList.remove('rmd-active');
      if (popover) popover.style.display = 'none';
      markTransTitles(false);
      updatePillIcon(); // shows the pill now that the popover is closed
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
        // so there's nothing to "commit" later; reset (and persist) it
        // immediately instead, or the next open would just restore the
        // size this button was meant to clear.
        if (popover) {
          popover.style.width = POPOVER_DEFAULT_W + 'px';
          popover.style.height = POPOVER_DEFAULT_H + 'px';
          saveSize(popover);
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
      Utils.ensureToastStyle(); // .tl-kbd (used in the hint line above) + the shared toast, now owned by Utils
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
        #rmd-check-pill {
          position: fixed; left: 16px; bottom: 100px; z-index: 2147483647;
          font: 12px/1 -apple-system,"Segoe UI",sans-serif; font-weight: 700;
          cursor: pointer; border-radius: 18px; padding: 8px 13px;
          box-shadow: 0 2px 10px rgba(0,0,0,.12);
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
          <span class="rmd-title">📝 Remark Options</span>
          <span id="rmd-check-badge" title="Z cycles: Label Check → Submit Check → Check Off" style="
            font-size:11px;padding:1px 7px;border-radius:6px;font-weight:700;white-space:nowrap;cursor:default;"></span>
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
        <div id="rmd-hint">Click a translation's title to reference it. Select text in a translation, then press <b>Q</b> to quote it. Click a chip to add a phrase. <span class="tl-kbd">Z</span> cycles the submit check, <span class="tl-kbd">Enter</span> runs it.</div>
        <div class="rmd-resize-handle" id="rmd-resize-handle" title="Drag to resize"></div>`;
      document.body.appendChild(p);
      popover = p;
      paletteEl = p.querySelector('#rmd-palette');
      previewEl = p.querySelector('#rmd-edit');
      bgEl = p.querySelector('#rmd-edit-bg');
      checkBadgeEl = p.querySelector('#rmd-check-badge');
      updateCheckBadge();

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
      injectPill();
    }

    // ---------- Closed-state pill (mirrors Scoring Shortcuts' #tl-score-pill
    // pattern — scoring-shortcuts.js:786-797 — stacked directly above it at
    // bottom:100px vs its bottom:58px so the two never overlap) ----------
    // Clicking it opens Remark Options via the exact same toggle() used by
    // the O key (see onKeyDown's CFG.keyOpen branch below), so there is
    // exactly one way Remark Options actually opens.
    function injectPill() {
      if (document.getElementById('rmd-check-pill')) return;
      const pill = document.createElement('button');
      pill.id = 'rmd-check-pill';
      pill.title = 'Open Remark Options (O)';
      pill.addEventListener('click', toggle);
      document.body.appendChild(pill);
      pillEl = pill;
      updatePillIcon();
    }

    // Renders the pill from the same CHECK_STYLES table updateCheckBadge()
    // uses, and shows/hides it based on `active` — visible only while
    // Remark Options is closed.
    function updatePillIcon() {
      if (!pillEl) return;
      const s = CHECK_STYLES[CHECK_MODES[checkModeIdx]];
      pillEl.textContent = s.text;
      pillEl.style.background = s.bg;
      pillEl.style.color = s.fg;
      pillEl.style.border = `1px solid ${s.border}`;
      pillEl.style.display = active ? 'none' : 'block';
    }

    // ====================================================================
    // Submit check (moved here wholesale from Scoring Shortcuts, v1.4.0)
    // ====================================================================

    // The check-mode badge in the popover header. Worth showing there
    // (rather than only via toast) so a reviewer who opens the window mid-row
    // can see at a glance why Enter is/isn't submitting for them. Submit
    // Check uses the same accent blue Scoring Shortcuts used for it, so it
    // still reads as a deliberate "on-brand" third state.
    function updateCheckBadge() {
      if (!checkBadgeEl) return;
      const s = CHECK_STYLES[CHECK_MODES[checkModeIdx]];
      checkBadgeEl.textContent = s.text;
      checkBadgeEl.style.background = s.bg;
      checkBadgeEl.style.color = s.fg;
      checkBadgeEl.style.border = `1px solid ${s.border}`;
      updatePillIcon(); // keep the closed-state pill (v1.4.1) in sync
    }

    // The label-completeness check, run on every Enter press (and by the
    // empty-row auto-advance in onMutate below). Label Check and Submit
    // Check share the same block-on-incomplete logic; they only differ on a
    // clean pass — Label Check just lets Enter's own effect through as
    // before, Submit Check also fires a synthetic Space to actually submit
    // (see Utils.dispatchNativeSpace — this is a deliberate exception to
    // "only ever suppress, never click/press for you", carried over
    // unchanged from when this lived in Scoring Shortcuts).
    //
    // Reads completeness through scoringShortcuts.checkCompleteness() rather
    // than any of Scoring Shortcuts' own DOM-reading internals — see this
    // file's header comment.
    function performCheck(e) {
      const checkMode = CHECK_MODES[checkModeIdx];
      if (checkMode === 'off') return;
      const { incomplete } = scoringShortcuts.checkCompleteness();
      if (incomplete.length) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const list = incomplete.map((n) => `Trans${n}`).join(', ');
        Utils.showToast(
          `⛔ Not submitted — <b>${list}</b> ${incomplete.length === 1 ? 'is' : 'are'} missing a complete label.`
          + `<span class="tl-toast-sub">Finish the label, or press Space / click Submit with the mouse to`
          + ` override (<span class="tl-kbd">${CFG.keyCycleCheck.toUpperCase()}</span> cycles this check).</span>`
        );
        return;
      }
      // Everything labelled — a clean pass, worth confirming instead of staying silent.
      Utils.showToast('✅ Check passed — every populated translation is labelled.', 1600, 'ok');
      if (checkMode === 'submit') {
        e.preventDefault(); // this key's own effect is replaced by the synthesized Space below
        Utils.dispatchNativeSpace();
      }
    }

    function cycleCheckMode() {
      checkModeIdx = (checkModeIdx + 1) % CHECK_MODES.length;
      saveCheckModeIdx();
      updateCheckBadge();
      const mode = CHECK_MODES[checkModeIdx];
      const msgs = {
        label: '🛡️ Label Check <b>ON</b><span class="tl-toast-sub">Enter is held back until every populated translation has a complete label.</span>',
        submit: '⚔️ Submit Check <b>ON</b><span class="tl-toast-sub">On a clean check, Enter also submits (presses Space for you) automatically.</span>',
        off: '⚠️ Check <b>OFF</b><span class="tl-toast-sub">Enter submits regardless of missing labels.</span>',
      };
      Utils.showToast(msgs[mode]);
    }

    // ====================================================================
    // Keyboard
    // ====================================================================

    function onKeyDown(e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never touch modifier combos — also absorbs a bare Alt press, a no-op now that its check trigger has been removed

      if (settingsOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
        return; // let every other key go to whatever settings field is focused
      }

      if (e.key === 'Escape') {
        if (active) { e.preventDefault(); exit(); }
        return;
      }

      if (Utils.inTextEntry()) return; // typing anywhere (including our own edit box) → letters/Enter are for typing, not shortcuts

      // Enter: the label-completeness check, moved here from Scoring
      // Shortcuts. Guarded against a focused popover control (a chip
      // button, ⚙/Clear/✕) so that control's own native Enter/click
      // behavior still works instead of also running the check — typing in
      // the edit box itself is already excluded above by inTextEntry().
      if (e.key === 'Enter') {
        if (active && document.activeElement && document.activeElement.closest && document.activeElement.closest('#rmd-popover')) return;
        performCheck(e);
        return;
      }

      const k = e.key.toLowerCase();
      if (k === CFG.keyOpen) {
        e.preventDefault();
        toggle();
      } else if (k === CFG.keyCycleCheck) {
        e.preventDefault();
        cycleCheckMode();
      } else if (k === 'q' && active) {
        // Only meaningful once the composer is open — Scoring Shortcuts
        // still owns Q as "previous translation" everywhere else (it
        // yields the keyboard via body.rmd-active whenever we're active,
        // so there's no clash).
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

    let autoAdvanceTimer = null; // pending auto-Enter for an empty row in Submit Check mode (moved here with the rest of the check system)
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
          // Nothing to score on this row and Submit Check is on: a real
          // Enter press would pass its completeness check vacuously anyway,
          // so press it for the user after a 1s pause instead of leaving
          // them stuck on a row with nothing to do. Goes through the exact
          // same Enter handling as a real keypress (completeness check,
          // toast, dispatchNativeSpace) — this never bypasses that check,
          // it just supplies the keypress. Cleared on every row change so a
          // stale timer can never fire against a row it wasn't scheduled for.
          clearTimeout(autoAdvanceTimer);
          if (!scoringShortcuts.checkCompleteness().scoreable.length && CHECK_MODES[checkModeIdx] === 'submit') {
            autoAdvanceTimer = setTimeout(() => {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
            }, 1000);
          }
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
      checkModeIdx = loadSavedCheckModeIdx(); // survives a reload; falls back to Label Check on a fresh session
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

  TL.RemarkComposer = RemarkComposer;
})();
