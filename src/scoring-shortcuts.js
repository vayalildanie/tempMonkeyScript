// ============================================================================
// trans-tool / Scoring Shortcuts
//
// Lets an annotator score any of the 7 translations from the keyboard
// instead of mousing into a dropdown for each one. See README.md's
// "Shortcuts" and "How it stays careful" sections for the full
// plain-English explanation of every shortcut and the reasoning behind
// the trickier parts of this module.
//
// As of v1.4.0 this module owns only the scoring keyboard (C / X / 1-9 /
// arrows / P) — the submit-check system (Z cycle, Enter check; Alt dropped
// entirely) moved to Remark Composer, which reads label-completeness
// through the one read-only method this module exposes: checkCompleteness().
// See remark-composer.js.
// ============================================================================
(function () {
  'use strict';
  window.TL = window.TL || {};

  function ScoringShortcuts(Utils) {
    const TAG = '[Scoring Shortcuts / 打分快捷键]';
    const VERSION = TL.SCRIPT_VERSION; // Shown in the panel badge so you can confirm you're running the latest version.
    // false for annotators (quiet console); flip to true only while debugging.
    const DEBUG = false;
    function log(msg) { if (DEBUG) console.log(`${TAG} ${msg}`); }

    // ---------- Configuration (edit here to change keys/colors) ----------
    const CFG = {
      keyScore3: '3',
      keyScore2: '2',
      keyConfusing: 'c', // case-insensitive
      keyErase: 'x',         // clear the active translation's score; stays on the same translation
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
    let lastRowSig = '';      // fingerprint of the previous row's source text, to detect a row change
    let queue = [];           // pending score requests, strictly in the order keys were pressed
    let processing = false;   // true while the queue is being drained, so it's never processed concurrently
    let labelMode = false;    // true while a "2 Points" label pick is in progress
    let labelBusy = false;    // guards against double-firing while a label click is mid-flight
    let labelBadgeRAF = null; // handle for the loop that keeps the label menu's number badges in sync

    // The active-translation cursor. Shared with QC Compare (see
    // trans-cursor.js), which is why this module no longer tracks an index
    // or its own per-column memory — ←/→ returning you to where you left
    // off in each column is the cursor's job now.
    const cursor = TL.TransCursor({
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
    function transNumberOf(mod) { return Utils.transNumFromModuleName(mod, ' Score'); }

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
    const readSelected = Utils.readSelected;

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

    // .tl-kbd (keycap) and the toast (#tl-toast) are shared with Remark
    // Composer now that it owns the check system — both are Utils'
    // responsibility (see Utils.ensureToastStyle()) so a toast fired from
    // either module always has the same styling, regardless of which
    // module's injectStyle() happened to run first.
    function injectStyle() {
      Utils.ensureToastStyle();
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

    // popupsVisible/closeOpenCascaders/edgeGap are shared with QC Compare —
    // same cascader controls, same "which popup is actually mine" problem —
    // see Utils.
    const popupsVisible = Utils.popupsVisible;
    const closeOpenCascaders = Utils.closeOpenCascaders;
    const edgeGap = Utils.edgeGap;

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
        const nextNum = TL.TransCursor.nextIn(nums, num);
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
      const nextNum = TL.TransCursor.nextIn(nums, num);
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

    // Read-only query for Remark Composer's relocated check system (moved
    // there in v1.4.0 — see remark-composer.js's performCheck). This is the
    // one sanctioned way another module reads this module's state: a
    // one-way, read-only question, never a write, and this module has no
    // reciprocal dependency on Remark Composer. See README.md's "Modules
    // stay behaviorally isolated" ground rule for the full reasoning.
    //   scoreable  — Trans#s with text on this row (what a check considers at all)
    //   incomplete — subset of scoreable missing a full label (what blocks a check)
    //   skipped    — Trans#s with a control but no text (informational only)
    function checkCompleteness() {
      return {
        scoreable: getScoreModules().map(transNumberOf),
        incomplete: incompleteTransNumbers(),
        skipped: getSkippedTransNumbers(),
      };
    }

    function onKeyDown(e) {
      if (document.body.classList.contains('rmd-active')) return; // Remark Composer drawer open → keyboard is entirely its
      if (e.ctrlKey || e.metaKey || e.altKey) return; // never touch modifier combos (the platform's own Ctrl+H, etc.) — this also absorbs a bare Alt press, a no-op now that Alt's check trigger has been removed
      if (e.key === 'Escape') {
        // Esc only cancels an in-progress label pick — the master on/off switch is button-only, by design.
        if (labelMode) { e.preventDefault(); exitLabelMode(); setStatus('Label pick cancelled'); }
        return;
      }
      if (inTextEntry()) return; // typing in Remarks/Rewrite → letter/number keys are for typing, not shortcuts

      // Show/hide the whole panel. Checked before the enabled gate below,
      // same as Esc — you can always get the window back even while
      // shortcuts are turned OFF.
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
          <span style="white-space:nowrap;"><span class="tl-kbd">X</span> Erase score</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">1</span>–<span class="tl-kbd">9</span> Label/Score Selection</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">↑</span><span class="tl-kbd">↓</span><span class="tl-kbd">←</span><span class="tl-kbd">→</span> Move Translation Focus</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">O</span> Remark Options</span>
          <span style="white-space:nowrap;"><span class="tl-kbd">P</span> Show/hide Legend</span>
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
      Utils.makeResizable(p, resizeHandle, { axes: 'x', minW: MIN_PANEL_W, getMaxW: () => naturalWidth, onDrop: () => saveSize(p) });
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
      Utils.makeDraggable(p, p.querySelector('#tl-score-head'), { onDrop: () => savePos(p) });
      applySavedPos(p);
      setEnabled(enabled);
      updateSkippedLine();
    }

    // —— Panel dragging, resizing, and position/size persistence (localStorage) ——
    // The drag/resize mechanics themselves (Utils.makeDraggable/makeResizable)
    // and the viewport clamp are shared with Remark Composer and QC Compare —
    // see utils.js. What's still local here: the storage keys, the {left,top}/
    // {w} shapes, and MIN_PANEL_W/naturalWidth — this panel's own decisions.
    const SCORE_POS_KEY = 'trans-tool:nova-score-pos-v3';
    const SCORE_MIN_KEY = 'trans-tool:nova-score-min-v1';
    const SCORE_SIZE_KEY = 'trans-tool:nova-score-size-v2';
    const MIN_PANEL_W = 260; // small enough to still show the header row and its buttons

    const clampIntoView = Utils.clampIntoView;

    function applySavedPos(p) {
      const o = Utils.readJSON(SCORE_POS_KEY);
      if (o && typeof o.left === 'number' && typeof o.top === 'number') {
        p.style.left = o.left + 'px'; p.style.top = o.top + 'px';
        p.style.right = 'auto'; p.style.bottom = 'auto'; p.style.transform = 'none';
        clampIntoView(p); // in case the saved position is now off-screen (resolution change, or dragged out of bounds before)
      }
    }
    function savePos(p) {
      const r = p.getBoundingClientRect();
      Utils.writeJSON(SCORE_POS_KEY, { left: Math.round(r.left), top: Math.round(r.top) });
    }

    // Right-edge drag, width-only, shrink-only (Utils.makeResizable's
    // axes:'x'): the panel can be made narrower than its natural width
    // (down to MIN_PANEL_W) but never wider — so it can never end up
    // covering more of the workbench than it does by default, only less.
    // Height is never touched — it stays whatever the browser's normal
    // auto-sizing computes for the content at the current width, so a
    // narrower panel (whose legend wraps onto more lines) automatically
    // grows tall enough to still show the status and skipped-translations
    // row, rather than clipping it.
    function saveSize(p) {
      const r = p.getBoundingClientRect();
      Utils.writeJSON(SCORE_SIZE_KEY, { w: Math.round(r.width) });
    }
    function applySavedSize(p) {
      const o = Utils.readJSON(SCORE_SIZE_KEY);
      if (!o || typeof o.w !== 'number') return;
      const maxW = naturalWidth || o.w;
      p.style.width = Math.max(MIN_PANEL_W, Math.min(maxW, o.w)) + 'px';
    }

    // ====================================================================
    // Watching the page for changes (SPA row changes / re-renders)
    // ====================================================================

    let settleTimer = null;
    // Note: the empty-row "auto-advance Enter" behavior that used to live
    // here (pressing Enter for the user when a row has nothing to score, in
    // Submit Check mode) moved to Remark Composer along with the rest of
    // the check system — see its onMutate(), which now owns checkModeIdx.
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

    return { start, checkCompleteness };
  }

  TL.ScoringShortcuts = ScoringShortcuts;
})();
