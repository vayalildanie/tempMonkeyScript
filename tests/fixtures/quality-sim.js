// QC tab simulator for quality_compare.html. Not NOVA.
//
// Loaded after annotation-sim.js, which owns the cascader behaviour and
// creates window.__fixture. This file only adds what the QC page has on top:
//
// - Two datasets, window.__fixture.qc = { a1: { n: { score, remark } }, a2: … }.
//   Clicking a tab moves `active` and rewrites every visible score display and
//   Remarks textarea `.value` from that tab's dataset, the way NOVA re-renders
//   the same DOM on a tab switch.
// - Writes made on the active tab (a score through the cascader, a remark
//   through typing / an input event) are kept in that tab's dataset, so
//   switching away and back preserves them.
// - Verdict buttons (.right-btn / .wrong-btn) are mutually exclusive and
//   remembered per tab.
//
// Test hooks (call seedQC before booting the userscript):
//   __fixture.seedQC({ a1: { 1: { score: '3 Points', remark: '' }, … }, a2: { … } })
//   __fixture.readQC()          -> deep copy of both datasets (active tab synced first)
//   __fixture.tabLog            -> indices of every tab switch, in order
//   __fixture.rerenderScoreHost(n) -> replace TransN Score's .cascade-container
//                                    with a fresh element, as a platform re-render does
(function () {
  'use strict';

  var TRANS_MAX = 7;
  var KEYS = ['a1', 'a2'];
  var fx = window.__fixture;
  if (!fx) throw new Error('quality-sim.js must load after annotation-sim.js');

  fx.qc = { a1: blank(), a2: blank() };
  fx.verdict = { a1: '', a2: '' };
  fx.tabLog = [];

  function blank() {
    var d = {};
    for (var n = 1; n <= TRANS_MAX; n++) d[n] = { score: '', remark: '' };
    return d;
  }

  function tabs() { return Array.prototype.slice.call(document.querySelectorAll('.tabs-group .tab')); }
  function activeIndex() {
    return tabs().findIndex(function (t) { return t.classList.contains('active'); });
  }
  function activeKey() { return KEYS[activeIndex()] || 'a1'; }

  function scoreRoot(n) {
    return document.querySelector('[data-module-name="Trans' + n + ' Score"] .ant-select');
  }
  function remarkArea(n) {
    var mod = document.querySelector('[data-module-name="Trans' + n + ' Remarks"], [data-module-name="Trans ' + n + ' Remarks"]');
    return mod ? mod.querySelector('textarea') : null;
  }
  function transOf(el, suffix) {
    var mod = el && el.closest && el.closest('[data-module-name]');
    var m = mod && new RegExp('^Trans ?(\\d+)' + suffix + '$').exec(mod.getAttribute('data-module-name'));
    return m ? parseInt(m[1], 10) : null;
  }

  function readScore(n) {
    var root = scoreRoot(n);
    var item = root && root.querySelector('.ant-select-selection-item');
    return item ? item.textContent.trim() : '';
  }

  // Show a value in a cascader the way a re-render would. The cascader itself
  // (opening, picking, clearing) stays annotation-sim.js's job.
  function showScore(n, value) {
    var root = scoreRoot(n);
    if (!root) return;
    var selector = root.querySelector('.ant-select-selector');
    var placeholder = selector.querySelector('.ant-select-selection-placeholder');
    var item = selector.querySelector('.ant-select-selection-item');
    if (!item) {
      item = document.createElement('span');
      item.className = 'ant-select-selection-item';
      selector.insertBefore(item, placeholder);
    }
    item.textContent = value;
    if (value) item.setAttribute('title', value); else item.removeAttribute('title');
    if (placeholder) placeholder.style.display = value ? 'none' : '';
    root.classList.toggle('ant-select-has-value', !!value);
    var clear = root.querySelector('.ant-select-clear');
    if (clear) clear.style.display = value ? '' : 'none';
  }

  function showVerdict(kind) {
    ['right', 'wrong'].forEach(function (k) {
      var btn = document.querySelector('.quality-container .' + k + '-btn');
      if (btn) btn.classList.toggle('active', k === kind);
    });
  }

  // Copy what is on screen into the active tab's dataset.
  function capture() {
    var d = fx.qc[activeKey()];
    for (var n = 1; n <= TRANS_MAX; n++) {
      var ta = remarkArea(n);
      d[n] = { score: readScore(n), remark: ta ? ta.value : '' };
    }
  }

  // Rewrite the screen from the active tab's dataset.
  function paint() {
    var key = activeKey();
    var d = fx.qc[key];
    for (var n = 1; n <= TRANS_MAX; n++) {
      var v = d[n] || { score: '', remark: '' };
      showScore(n, v.score || '');
      var ta = remarkArea(n);
      if (ta) ta.value = v.remark || '';
    }
    showVerdict(fx.verdict[key]);
  }

  function switchTo(i) {
    if (i === activeIndex()) return;
    capture();
    tabs().forEach(function (t, j) { t.classList.toggle('active', j === i); });
    fx.tabLog.push(i);
    paint();
  }

  tabs().forEach(function (tab, i) {
    tab.addEventListener('click', function () { switchTo(i); });
  });

  ['right', 'wrong'].forEach(function (kind) {
    var btn = document.querySelector('.quality-container .' + kind + '-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      fx.verdict[activeKey()] = kind;
      showVerdict(kind);
    });
  });

  // Keep the active dataset in step with live edits.
  document.addEventListener('input', function (e) {
    var n = transOf(e.target, ' Remarks');
    if (n !== null && e.target.tagName === 'TEXTAREA') fx.qc[activeKey()][n].remark = e.target.value;
  }, true);
  var scoreObserver = new MutationObserver(function () {
    var d = fx.qc[activeKey()];
    for (var n = 1; n <= TRANS_MAX; n++) d[n].score = readScore(n);
  });
  document.querySelectorAll('[data-module-name$=" Score"] .ant-select-selector').forEach(function (sel) {
    scoreObserver.observe(sel, { childList: true, subtree: true, characterData: true });
  });

  fx.seedQC = function (data) {
    KEYS.forEach(function (key) {
      var src = (data && data[key]) || {};
      var d = blank();
      for (var n = 1; n <= TRANS_MAX; n++) {
        if (src[n]) d[n] = { score: src[n].score || '', remark: src[n].remark || '' };
      }
      fx.qc[key] = d;
    });
    paint();
  };

  fx.readQC = function () {
    capture();
    return JSON.parse(JSON.stringify(fx.qc));
  };

  fx.rerenderScoreHost = function (n) {
    var mod = document.querySelector('font[data-module-name="Trans' + n + ' Score"] > font[data-module-name="Trans' + n + ' Score"]');
    var old = mod && mod.querySelector('.cascade-container');
    if (!old) return false;
    var fresh = document.createElement('div');
    fresh.className = 'cascade-container';
    // Keep the platform's own children (the wired cascader moves across);
    // anything the userscript injected is lost, as in a real re-render.
    Array.prototype.slice.call(old.childNodes).forEach(function (child) {
      if (child.nodeType === 1 && child.classList.contains('qc-badge')) return;
      fresh.appendChild(child);
    });
    old.replaceWith(fresh);
    return true;
  };
})();
