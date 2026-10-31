// NOVA's per-translation Remarks textareas and the Remark Composer (#rmd-*).
// Trans2's module is spelled "Trans 2 Remarks" (with a space) in the capture,
// so every lookup accepts both spellings.
const { expect } = require('@playwright/test');

// Page-side Remarks values as NOVA's own field delivers them: the native value
// setter, then an `input` event unless `input: false` (a platform lazy load
// fires none). `map` is { n: text }.
function setRemarks(page, map, { input = true } = {}) {
  return page.evaluate(({ map, input }) => {
    Object.keys(map).forEach((k) => {
      const mod = Array.from(document.querySelectorAll('[data-module-name]'))
        .find((m) => new RegExp(`^Trans ?${k} Remarks$`).test(m.getAttribute('data-module-name')));
      const ta = mod.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, map[k]);
      if (input) ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, { map, input });
}
const setRemark = (page, n, text, opts) => setRemarks(page, { [n]: text }, opts);

// { n: value } of every Remarks textarea on the page.
function remarksValues(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-module-name]').forEach((mod) => {
      const m = /^Trans ?(\d+) Remarks$/.exec(mod.getAttribute('data-module-name'));
      if (m && !(m[1] in out)) out[m[1]] = mod.querySelector('textarea').value;
    });
    return out;
  });
}

// Polls until the listed translations' Remarks equal `expected` ({ n: text }).
async function expectRemarks(page, expected) {
  await expect.poll(async () => {
    const all = await remarksValues(page);
    const out = {};
    Object.keys(expected).forEach((k) => { out[k] = all[k]; });
    return out;
  }).toEqual(expected);
}

// Trans numbers of the Remarks modules carrying the composer's target highlight.
function activeTargets(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.rmd-active-target')).map((el) => {
    const m = /^Trans ?(\d+) Remarks$/.exec(el.getAttribute('data-module-name') || '');
    return m ? parseInt(m[1], 10) : el.getAttribute('data-module-name');
  }));
}

// Polls until exactly Trans `n` is the composer's target.
async function expectTarget(page, n) {
  await expect.poll(() => activeTargets(page)).toEqual([n]);
}

// Selects the whole text of Trans `n` and returns it trimmed.
function selectTrans(page, n) {
  return page.evaluate((n) => {
    const el = document.querySelector(`[data-module-name="Trans${n}"] .preview-content`);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return el.textContent.trim();
  }, n);
}

// Selects text from the start of Trans `a` to the end of Trans `b`.
function selectAcross(page, a, b) {
  return page.evaluate(({ a, b }) => {
    const first = document.querySelector(`[data-module-name="Trans${a}"] .preview-content`);
    const second = document.querySelector(`[data-module-name="Trans${b}"] .preview-content`);
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, { a, b });
}

// Builds one named selection in the page and returns its raw text.
function makeSelection(page, key) {
  return page.evaluate((key) => {
    const q = (s) => document.querySelector(s);
    const text = (n) => q(`[data-module-name="Trans${n}"] .preview-content`);
    const noteBody = q('[data-module-key="NoteTrans"] #content');
    const noteHead = q('[data-module-key="NoteTrans"] h1');
    const ctx = q('[data-module-name="Context-EN"] .preview-content');
    const expandBtn = q('[data-module-key="NoteTrans"] .expand-btn');
    const imageList = q('[data-module-key="NoteTrans"] .image-list-container');
    const r = document.createRange();
    const toEnd = (el) => r.setEnd(el, el.childNodes.length);
    switch (key) {
      case 'whole': r.selectNodeContents(text(5)); break;
      case 'part': {
        const t = text(2).querySelector('span span').firstChild;
        r.setStart(t, 6);
        r.setEnd(t, 17);
        break;
      }
      case 'parent-boundary': {
        const pc = text(4);
        r.setStart(pc, 0);
        r.setEnd(pc.parentElement, Array.prototype.indexOf.call(pc.parentElement.childNodes, pc) + 1);
        break;
      }
      case 'note-body': r.selectNodeContents(noteBody); break;
      case 'note-heading-and-body': r.setStart(noteHead, 0); toEnd(noteBody); break;
      case 'tagged':
        text(6).textContent = '<content1>Tagged words here</content1>';
        r.selectNodeContents(text(6));
        break;
      case 'two-translations': r.setStart(text(4), 0); toEnd(text(5)); break;
      case 'note-into-collapse': r.setStart(noteBody, 0); toEnd(expandBtn); break;
      case 'note-through-pictures': r.setStart(noteHead, 0); toEnd(imageList); break;
      case 'collapse-only': r.selectNodeContents(expandBtn); break;
      case 'note-and-translation': r.setStart(noteBody, 0); toEnd(text(1)); break;
      case 'context-and-translation': r.setStart(ctx, 0); toEnd(text(1)); break;
      case 'context-only': r.selectNodeContents(ctx); break;
      case 'title-and-text': r.setStart(q('[data-module-name="Trans5"] .title-text'), 0); toEnd(text(5)); break;
      case 'select-all': r.selectNodeContents(document.body); break;
      default: throw new Error(`unknown selection ${key}`);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return sel.toString();
  }, key);
}

// The composer's own editable textarea.
const edit = (page) => page.locator('#rmd-edit');

// A chip click or quote re-focuses #rmd-edit one animation frame later, so wait
// for that before blurring, or the late focus lands after the blur.
async function blur(page) {
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('rmd-edit');
  await page.evaluate(() => document.activeElement.blur());
}

// Opens the composer with O and waits for it.
async function openComposer(page) {
  await page.keyboard.press('o');
  await expect(page.locator('#rmd-popover')).toBeVisible();
}

module.exports = {
  setRemarks,
  setRemark,
  remarksValues,
  expectRemarks,
  activeTargets,
  expectTarget,
  selectTrans,
  selectAcross,
  makeSelection,
  edit,
  blur,
  openComposer,
};
