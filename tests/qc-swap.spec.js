// QC Compare: Z swaps Score and Remark together, with a preserved pair so Z
// keeps flip-flopping between the two annotators even after either side is
// cleared (v1.5.3 plan: B-Z, B-FAIL, B-ADV). Helpers are duplicated from
// qc-compare.spec.js on purpose; Task 6 moves them to tests/helpers.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const qcUrl = 'file://' + path.resolve(__dirname, 'fixtures/quality_compare.html').replace(/\\/g, '/');

// Trans1: both halves differ. Trans2: score only. Trans4: remark only.
// Trans5: Annotator 2 has no score. Trans6: identical. Trans7: score only, last translation.
const DATA = {
  a1: {
    1: { score: '3 Points', remark: '' },
    2: { score: '2 Points / Fluency', remark: 'shared' },
    4: { score: '3 Points', remark: '' },
    5: { score: 'Confusing', remark: 'a1 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '2 Points / Fluency', remark: '' },
  },
  a2: {
    1: { score: '2 Points / Accuracy', remark: 'a2 remark one' },
    2: { score: '3 Points', remark: 'shared' },
    4: { score: '3 Points', remark: 'a2 four' },
    5: { score: '', remark: 'a2 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '3 Points', remark: '' },
  },
};
const A = (n) => DATA.a1[n];
const B = (n) => DATA.a2[n];
const SCOREABLE = [1, 2, 4, 5, 6, 7];

const scoreMod = (n) => `[data-module-name="Trans${n} Score"]`;
const badge = (page, n) => page.locator(`${scoreMod(n)} .qc-badge`);

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
const allRemarks = (page) => Promise.all(SCOREABLE.map((n) => unit(page, n).then((u) => u.remark)));

// A remark edit as NOVA's own textarea delivers it (native setter; input event unless a lazy load).
const setRemark = (page, n, text, { input = true } = {}) => page.evaluate(({ n, text, input }) => {
  const rm = Array.from(document.querySelectorAll('[data-module-name]'))
    .find((m) => new RegExp(`^Trans ?${n} Remarks$`).test(m.getAttribute('data-module-name')));
  const ta = rm.querySelector('textarea');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
  if (input) ta.dispatchEvent(new Event('input', { bubbles: true }));
}, { n, text, input });

const selected = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.qc-active-score')).map((el) => {
  const mod = el.closest('[data-module-name$=" Score"]');
  const m = /^Trans ?(\d+) Score$/.exec(mod ? mod.getAttribute('data-module-name') : '');
  return m ? parseInt(m[1], 10) : null;
}));
async function expectSelected(page, n) { await expect.poll(() => selected(page)).toEqual([n]); }
const activeTab = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.tabs-group .tab'))
  .findIndex((t) => t.classList.contains('active')));
const summary = (page) => page.locator('#qc-summary').innerText();

async function bootQC(page, data = DATA) {
  await page.goto(qcUrl);
  await page.evaluate((d) => window.__fixture.seedQC(d), data);
  await bootModules(page);
  await expect(page.locator('.qc-badge')).toHaveCount(SCOREABLE.length);
  await expectSelected(page, 1);
}
async function selectTrans(page, n) {
  for (let i = 0; i < 8 && (await selected(page))[0] !== n; i++) await page.keyboard.press('ArrowDown');
  await expectSelected(page, n);
}
async function clickTab(page, i) {
  await page.locator('.tabs-group .tab').nth(i).click();
  await expect.poll(() => activeTab(page)).toBe(i);
}

let pageErrors;
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test.describe('Z swaps Score and Remark', () => {
  const kinds = [
    ['both halves differ', 1],
    ['only the score differs', 2],
    ['only the remark differs', 4],
  ];
  for (const [label, n] of kinds) {
    test(`writes Annotator 2's value and shows the swapped badge when ${label}`, async ({ page }) => {
      await bootQC(page);
      await selectTrans(page, n);
      await page.keyboard.press('z');
      await expectUnit(page, n, B(n));
      await expect(badge(page, n)).toHaveClass(/qc-adopted/);
    });
  }

  test('never writes another translation when Z swaps one', async ({ page }) => {
    await bootQC(page);
    const before = await allRemarks(page);
    await page.keyboard.press('z'); // Trans1
    await expectUnit(page, 1, B(1));
    const after = await allRemarks(page);
    expect(after.filter((_, i) => SCOREABLE[i] !== 1)).toEqual(before.filter((_, i) => SCOREABLE[i] !== 1));
  });

  test('keeps flip-flopping between the two annotators when Z is pressed repeatedly', async ({ page }) => {
    await bootQC(page);
    const steps = [B(1), A(1), B(1)];
    for (let i = 0; i < steps.length; i++) {
      await page.keyboard.press('z');
      await expectUnit(page, 1, steps[i]);
      await expectSelected(page, 2); // every writing Z advances
      await page.keyboard.press('ArrowUp');
      await expectSelected(page, 1);
    }
  });

  test('shows Annotator 2\'s remark in the badge only when the remarks differ', async ({ page }) => {
    await bootQC(page);
    await expect(badge(page, 4)).toContainText('a2 four');
    await expect(badge(page, 2)).not.toContainText('shared'); // equal remarks: no remark line
  });

  test('counts a remark-only difference as still to reconcile', async ({ page }) => {
    await bootQC(page);
    await expect.poll(() => summary(page)).toContain('5 still to reconcile: Trans 1, 2, 4, 5, 7');
  });
});

test.describe('failsafe: the preserved pair survives clears and edits', () => {
  // Annotator 1's Trans2 is ('2 Points / Fluency', 'shared'); Annotator 2's is ('3 Points', 'shared').
  const clears = [
    ['the remark is cleared', async (page) => { await setRemark(page, 2, ''); }],
    ['the score is cleared with X', async (page) => { await page.keyboard.press('x'); await expect.poll(async () => (await unit(page, 2)).score).toBe(''); }],
    ['both are cleared', async (page) => {
      await setRemark(page, 2, '');
      await page.keyboard.press('x');
      await expect.poll(async () => (await unit(page, 2)).score).toBe('');
    }],
  ];
  for (const [label, clear] of clears) {
    test(`restores Annotator 1's original on the second Z when ${label}`, async ({ page }) => {
      await bootQC(page);
      await selectTrans(page, 2);
      await clear(page);
      await page.keyboard.press('z'); // matches neither side: writes Annotator 2's
      await expectUnit(page, 2, B(2));
      await expectSelected(page, 4); // the writing Z advanced; Trans3 is skipped
      await page.keyboard.press('ArrowUp');
      await expectSelected(page, 2);
      await page.keyboard.press('z');
      await expectUnit(page, 2, A(2));
    });
  }

  test('still writes Annotator 2\'s preserved remark after it was cleared on its own tab', async ({ page }) => {
    await bootQC(page);
    await clickTab(page, 1);
    await setRemark(page, 1, '');
    await clickTab(page, 0);
    await page.keyboard.press('z'); // Trans1
    await expectUnit(page, 1, B(1));
  });

  test('keeps the pair unchanged when a lazy-loaded remark shows up after the scrape', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 6);
    await setRemark(page, 6, 'late text', { input: false }); // the platform finishing a load: no input event
    await page.waitForTimeout(2200); // past the bounded verify window
    await page.keyboard.press('z');
    await expectUnit(page, 6, { score: '3 Points', remark: '' }); // matched Annotator 1's filled value, so it flips to Annotator 2's
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 6, { score: '3 Points', remark: 'late text' });
    await expect(badge(page, 6)).not.toContainText('was:');
  });

  test('stashes a hand-edited remark before Z overwrites it and shows it as was:', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 4);
    await setRemark(page, 4, 'typed edit');
    await page.keyboard.press('z');
    await expectUnit(page, 4, B(4));
    await expect(badge(page, 4)).toContainText('typed edit');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 4, A(4)); // the edit was never one of the two originals
  });

  test('discards every pair when the row changes', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('z'); // Trans1 now holds Annotator 2's value
    await expectUnit(page, 1, B(1));
    await page.evaluate(() => {
      document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'A different row note.';
    });
    // The re-scrape reads the swapped Trans1 as both annotators' value, so Z has nothing to flip.
    await expect.poll(() => summary(page)).not.toContain('Trans 1,');
    await page.keyboard.press('ArrowUp');
    await expectSelected(page, 1);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-cursor')).toContainText('Trans1 matches');
    await expectUnit(page, 1, B(1));
  });
});

test.describe('Z refusals', () => {
  test('writes nothing and does not advance when Annotator 2\'s tab is active', async ({ page }) => {
    await bootQC(page);
    await clickTab(page, 1);
    const before = await unit(page, 1);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-summary')).toContainText('Switch to the Annotator 1 tab');
    expect(await unit(page, 1)).toEqual(before);
    await expectSelected(page, 1);
  });

  test('writes nothing and does not advance when Annotator 2 has no score', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 5);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-summary')).toContainText('no score for Trans5');
    await expectUnit(page, 5, A(5));
    await expectSelected(page, 5);
  });

  test('writes nothing and does not advance when both annotators agree', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 6);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-cursor')).toContainText('Trans6 matches');
    await expectUnit(page, 6, A(6));
    await expectSelected(page, 6);
  });
});

test.describe('Z auto-advance', () => {
  test('moves the selection to the next scoreable translation and skips the empty Trans3', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 2);
    await page.keyboard.press('z');
    await expectUnit(page, 2, B(2));
    await expectSelected(page, 4);
  });

  test('stays on the last translation when it is the one swapped', async ({ page }) => {
    await bootQC(page);
    await selectTrans(page, 7);
    await page.keyboard.press('z');
    await expectUnit(page, 7, B(7));
    await expectSelected(page, 7);
  });
});

test.describe('Z guards and mouse', () => {
  test('ignores a second Z that arrives while the first write is still in flight', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => {
      const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
      press();
      press(); // same tick: the guard must drop it, not flip back
    });
    await expectUnit(page, 1, B(1));
    await page.waitForTimeout(600);
    await expectUnit(page, 1, B(1));
  });

  test('flips with the badge buttons the same as Z but does not move the selection', async ({ page }) => {
    await bootQC(page);
    await badge(page, 1).locator('.qc-adopt-btn').click();
    await expectUnit(page, 1, B(1));
    await expectSelected(page, 1);
    await badge(page, 1).locator('.qc-undo').click();
    await expectUnit(page, 1, A(1));
    await expectSelected(page, 1);
  });
});
