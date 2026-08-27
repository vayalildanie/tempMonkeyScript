// ============================================================================
// trans-tool / TransCursor
//
// Scoring Shortcuts and QC Compare both let you walk the row's scoreable
// translations with the arrow keys, with identical semantics: ↑/↓ step, ←/→
// toggle column (Trans1-3 vs Trans4-7) and land on wherever you last were in
// that column. That logic lives here once instead of being copy-pasted,
// which is how the two copies of the version constant drifted apart before.
//
// It deals only in Trans NUMBERS, never indices. That isn't tidiness — it's
// forced: QC Compare has no stable array to index into, since it re-queries
// `[data-module-name="TransN Score"]` on demand and the platform's
// re-renders replace those nodes. An index into any snapshot goes stale by
// construction; a number stays valid. (Scoring Shortcuts' index is always
// recoverable from a number via findIndex; the reverse isn't.)
//
// It knows nothing about either module's DOM, highlight style, or status
// panel — those arrive as the `onChange` and `status` callbacks.
//
// Loaded via @require, ahead of the module files that use it — see
// annotation-scoring-shortcuts.user.js's @require list.
// ============================================================================
(function () {
  'use strict';
  window.TL = window.TL || {};

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
    // `cur`, matching the clamping Scoring Shortcuts has always done — this
    // runs from the MutationObserver on every settle, so it's a hot path,
    // not an edge case.
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

  TL.TransCursor = TransCursor;
})();
