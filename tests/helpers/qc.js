// QC Compare (src/qc-compare.js) on tests/fixtures/quality_compare.html.
// The fixture's simulator (quality-sim.js) takes both annotators' data through
// window.__fixture.seedQC({ a1, a2 }), each { n: { score, remark } }.
const { expect } = require('@playwright/test');
const { QUALITY, boot } = require('./fixture');
const { scoreMod, scoreNumsWith } = require('./scores');

// Translations with text on the QC fixture; Trans3 has none.
const SCOREABLE = [1, 2, 4, 5, 6, 7];

// The row used by qc-navigation.spec.js and qc-shortcuts.spec.js (qc-swap.spec.js
// has its own). Score differences: Trans1, Trans2, Trans4, Trans7. Trans5 agrees
// on the score but its remarks differ. Trans6 agrees on both.
const COMPARE_DATA = {
  a1: {
    1: { score: '', remark: '' },
    2: { score: '2 Points / Fluency', remark: 'Lorem a1 two' },
    4: { score: '3 Points', remark: '' },
    5: { score: 'Confusing', remark: 'Lorem a1 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '', remark: '' },
  },
  a2: {
    1: { score: '3 Points', remark: '' },
    2: { score: '3 Points', remark: '' },
    4: { score: '2 Points / Accuracy', remark: 'Lorem a2 four' },
    5: { score: 'Confusing', remark: 'Lorem a2 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '3 Points', remark: '' },
  },
};

const remarkMod = (n) => (n === 2 ? '[data-module-name="Trans 2 Remarks"]' : `[data-module-name="Trans${n} Remarks"]`);

// The score text shown for Trans `n`, '' when the control shows none.
function scoreValue(page, n) {
  return page.locator(`${scoreMod(n)} .ant-select-selection-item`).first().textContent()
    .then((t) => t.trim())
    .catch(() => '');
}
async function expectScore(page, n, text) {
  await expect.poll(() => scoreValue(page, n)).toBe(text);
}

// Trans `n`'s live { score, remark } as one unit.
const unit = (page, n) => page.evaluate((n) => {
  const sm = document.querySelector(`[data-module-name="Trans${n} Score"]`);
  const item = sm && sm.querySelector('.ant-select-selection-item');
  const rm = Array.from(document.querySelectorAll('[data-module-name]'))
    .find((m) => new RegExp(`^Trans ?${n} Remarks$`).test(m.getAttribute('data-module-name')));
  const ta = rm && rm.querySelector('textarea');
  return { score: item ? item.textContent.trim() : '', remark: ta ? ta.value : '' };
}, n);
async function expectUnit(page, n, expected) {
  await expect.poll(() => unit(page, n)).toEqual({ score: expected.score, remark: expected.remark });
}

// Trans numbers whose score host carries the QC selection outline.
const selected = (page) => scoreNumsWith(page, 'qc-active-score');
async function expectSelected(page, n) {
  await expect.poll(() => selected(page)).toEqual([n]);
}

// Presses ArrowDown until Trans `n` is selected.
async function moveSelectionTo(page, n) {
  for (let i = 0; i < 8 && (await selected(page))[0] !== n; i++) await page.keyboard.press('ArrowDown');
  await expectSelected(page, n);
}

// Index of the active annotator tab: 0 = Annotator 1, 1 = Annotator 2.
const activeTab = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.tabs-group .tab'))
  .findIndex((t) => t.classList.contains('active')));
async function clickTab(page, i) {
  await page.locator('.tabs-group .tab').nth(i).click();
  await expect.poll(() => activeTab(page)).toBe(i);
}

const cursorStatus = (page) => page.locator('#qc-cursor').textContent();

// Hands both annotators' data to the fixture simulator.
const seedQC = (page, data) => page.evaluate((d) => window.__fixture.seedQC(d), data);

// Opens the QC fixture with `data`, boots the modules and waits until the
// scrape has finished: a badge under every scoreable translation, Trans1 selected.
async function bootQC(page, data) {
  await boot(page, { fixture: QUALITY, beforeModules: (p) => seedQC(p, data) });
  await expect(page.locator('.qc-badge')).toHaveCount(SCOREABLE.length);
  await expectSelected(page, 1);
}

module.exports = {
  SCOREABLE,
  COMPARE_DATA,
  remarkMod,
  scoreValue,
  expectScore,
  unit,
  expectUnit,
  selected,
  expectSelected,
  moveSelectionTo,
  activeTab,
  clickTab,
  cursorStatus,
  seedQC,
  bootQC,
};
