// QC Compare (src/qc-compare.js) on the reduced quality_ fixture.
// B0 smoke and B1 characterization of the current code (v1.5.3 plan, B-SUITE).
// TransCursor internals (clamping, slot memory) belong to shared.spec.js and
// scoring.spec.js; score-only Z, Rewrite and Remark "+ Add" are deliberately
// not characterized here because v1.5.3 replaces or deletes them.
const { test, expect } = require('@playwright/test');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const fileUrl = (name) => 'file://' + path.resolve(__dirname, 'fixtures', name).replace(/\\/g, '/');
const qcUrl = fileUrl('quality_compare.html');
const annotationUrl = fileUrl('annotation.html');

const HELP_KEY = 'trans-tool:nova-qc-help-v1';
const SCOREABLE = [1, 2, 4, 5, 6, 7];

// Annotator 1 / Annotator 2 data for the row. Trans3 has no translation text.
// Differences: Trans1, Trans2, Trans4, Trans7. Agreements: Trans5, Trans6.
const DATA = {
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

const scoreMod = (n) => `[data-module-name="Trans${n} Score"]`;
const remarkMod = (n) => (n === 2 ? '[data-module-name="Trans 2 Remarks"]' : `[data-module-name="Trans${n} Remarks"]`);

function value(page, n) {
  return page.locator(`${scoreMod(n)} .ant-select-selection-item`).first().textContent()
    .then((t) => t.trim())
    .catch(() => '');
}
async function expectValue(page, n, text) {
  await expect.poll(() => value(page, n)).toBe(text);
}

// Trans numbers whose score host carries the QC selection outline.
function selected(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.qc-active-score')).map((el) => {
    const mod = el.closest('[data-module-name$=" Score"]');
    const m = /^Trans ?(\d+) Score$/.exec(mod ? mod.getAttribute('data-module-name') : '');
    return m ? parseInt(m[1], 10) : null;
  }));
}
async function expectSelected(page, n) {
  await expect.poll(() => selected(page)).toEqual([n]);
}

const activeTab = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.tabs-group .tab'))
  .findIndex((t) => t.classList.contains('active')));
const cursorStatus = (page) => page.locator('#qc-cursor').textContent();
const expanded = (page, n) => page.locator(`${scoreMod(n)} input`).first().getAttribute('aria-expanded');
const allScores = (page) => Promise.all(SCOREABLE.map((n) => value(page, n)));

async function clickTab(page, i) {
  await page.locator('.tabs-group .tab').nth(i).click();
  await expect.poll(() => activeTab(page)).toBe(i);
}

async function bootQC(page) {
  await page.goto(qcUrl);
  await page.evaluate((data) => window.__fixture.seedQC(data), DATA);
  await bootModules(page);
  // Ready: the scrape has finished and painted a badge under every scoreable translation.
  await expect(page.locator('.qc-badge')).toHaveCount(SCOREABLE.length);
  await expectSelected(page, 1);
}

async function openLabelMenu(page, n) {
  await page.keyboard.press('2');
  await expect.poll(() => cursorStatus(page)).toContain('press 1-9/0');
  await expectValue(page, n, '2 Points');
  await expect.poll(() => expanded(page, n)).toBe('true');
}

let pageErrors;
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test.describe('smoke', () => {
  test('scrapes both tabs and renders badges when the URL contains /quality_', async ({ page }) => {
    await bootQC(page);

    await expect(page.locator('#qc-panel')).toBeVisible();
    await expect(page.locator('#qc-summary')).toContainText('4 still to reconcile: Trans 1, 2, 4, 7');
    // Annotator 2 was visited once and the module returned to Annotator 1.
    expect(await page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0]);
    expect(await activeTab(page)).toBe(0);
    // Verdict rule: Annotator 1 gets "1", Annotator 2 gets "3".
    expect(await page.evaluate(() => window.__fixture.verdict)).toEqual({ a1: 'right', a2: 'wrong' });

    for (const n of [1, 2, 4, 7]) {
      await expect(page.locator(`${scoreMod(n)} .qc-badge`), `Trans${n}`).toHaveClass(/qc-diff/);
    }
    for (const n of [5, 6]) {
      await expect(page.locator(`${scoreMod(n)} .qc-badge`), `Trans${n}`).toHaveClass(/qc-same/);
    }
    await expect(page.locator(`${scoreMod(2)} .qc-badge`)).toContainText('Annotator 2: 3 Points');
    await expect(page.locator(`${scoreMod(3)} .qc-badge`)).toHaveCount(0);
    // Annotator 1's own data is what is on screen.
    await expectValue(page, 2, '2 Points / Fluency');
    await expect(page.locator(`${remarkMod(2)} textarea`)).toHaveValue('Lorem a1 two');
  });

  test('lists only the live shortcuts in the legend when the panel is open', async ({ page }) => {
    await bootQC(page);
    const legend = (await page.locator('#qc-help').textContent()).replace(/\s+/g, ' ');
    expect(legend).not.toMatch(/Rewrite|\+ ?Add|＋ ?Add/);
    expect(legend).toContain('Z Swaps Labels');
    expect(legend).toContain('Move Focus (Trans)');
  });

  test('never shows the QC panel when the URL is not a /quality_ page', async ({ page }) => {
    await page.goto(annotationUrl);
    await bootModules(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#qc-panel')).toHaveCount(0);
    await expect(page.locator('#qc-style')).toHaveCount(0);
    await expect(page.locator('.qc-badge, .qc-active-score')).toHaveCount(0);
  });
});

test.describe('arrows', () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  test('moves the selection down and skips the empty Trans3 when ArrowDown is pressed', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 2);
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 4);
    await page.keyboard.press('ArrowUp');
    await expectSelected(page, 2);
  });

  test('toggles between columns when ArrowLeft or ArrowRight is pressed', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expectSelected(page, 4);
    await page.keyboard.press('ArrowLeft');
    await expectSelected(page, 1);
  });

  test('keeps the selection and an edited score when the tabs make a round trip', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 4);
    await page.keyboard.press('c');
    await expectValue(page, 4, 'Confusing');

    await clickTab(page, 1);
    await expectValue(page, 4, '2 Points / Accuracy');
    await expect(page.locator(`${remarkMod(4)} textarea`)).toHaveValue('Lorem a2 four');
    await expectSelected(page, 4);

    await clickTab(page, 0);
    await expectValue(page, 4, 'Confusing');
    await expectSelected(page, 4);
  });

  test('restores the selection outline when the score host is re-rendered', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 2);
    await page.evaluate(() => {
      window.__oldHost = document.querySelector('.qc-active-score');
      window.__fixture.rerenderScoreHost(2);
    });
    await expectSelected(page, 2);
    expect(await page.evaluate(() => window.__oldHost.isConnected)).toBe(false);
    await expect(page.locator(`${scoreMod(2)} .qc-badge`)).toHaveCount(1);
  });
});

test.describe('score keys', () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  for (const row of [
    { key: '3', score: '3 Points' },
    { key: 'c', score: 'Confusing' },
  ]) {
    test(`sets ${row.score} on the selected translation when ${row.key} is pressed`, async ({ page }) => {
      await page.keyboard.press(row.key);
      await expectValue(page, 1, row.score);
      await expect.poll(() => cursorStatus(page)).toBe(`Trans1 = ${row.score} ✓`);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      // characterizes current behaviour: the B1 brief expects an advance to
      // Trans2, but relabel() never moves the cursor (only Z advances).
      await expectSelected(page, 1);
    });
  }

  test('clears the selected translation\'s score when X is pressed', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 2);
    await page.keyboard.press('x');
    await expectValue(page, 2, '');
    await expect.poll(() => cursorStatus(page)).toBe('Trans2 cleared');
    await expectSelected(page, 2);
    await expectValue(page, 1, '');
    await expectValue(page, 4, '3 Points');
  });
});

test.describe('label menu', () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  test('opens the label menu without advancing when 2 is pressed', async ({ page }) => {
    await openLabelMenu(page, 1);
    await expectSelected(page, 1);
  });

  for (const row of [
    { key: '4', label: 'Fluency' },
    { key: '2', label: 'Authenticity' },
    { key: '3', label: 'Unauthentic Vocabulary / Collocations' },
  ]) {
    test(`picks label "${row.label}" when ${row.key} is pressed with the menu open`, async ({ page }) => {
      await openLabelMenu(page, 1);
      await page.keyboard.press(row.key);
      await expectValue(page, 1, `2 Points / ${row.label}`);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect.poll(() => cursorStatus(page)).toBe(`Trans1 = 2 Points / ${row.label} ✓`);
      // characterizes current behaviour: the B1 brief expects an advance to
      // Trans2, but commitLabel() never moves the cursor.
      await expectSelected(page, 1);
    });
  }

  test('closes the menu and keeps bare 2 Points when Escape is pressed with the menu open', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('Escape');
    await expect.poll(() => expanded(page, 1)).toBe('false');
    await expect.poll(() => cursorStatus(page)).toBe('Trans1: label pick cancelled');
    await expectValue(page, 1, '2 Points');
    await expectSelected(page, 1);
  });
});

test.describe('help toggle', () => {
  test('toggles the help panel and keeps the setting across a reload when O is pressed', async ({ page }) => {
    await bootQC(page);
    const help = page.locator('#qc-help');
    await expect(help).toBeVisible();

    await page.keyboard.press('o');
    await expect(help).toBeHidden();
    expect(await page.evaluate((k) => localStorage.getItem(k), HELP_KEY)).toBe('0');

    await page.reload();
    await page.evaluate((data) => window.__fixture.seedQC(data), DATA);
    await bootModules(page);
    await expect(page.locator('#qc-panel')).toBeVisible();
    await expect(help).toBeHidden();

    await page.keyboard.press('o');
    await expect(help).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), HELP_KEY)).toBe('1');
  });
});

test.describe('guards', () => {
  const KEYS = ['z', '3', 'c', 'x', 'o', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];

  test('ignores every shortcut when a remark textarea has focus or a modifier is held', async ({ page }) => {
    await bootQC(page);
    const before = await allScores(page);
    const helpShown = () => page.locator('#qc-help').isVisible();
    const helpBefore = await helpShown();

    // Typing in a Remarks box: the keys type, nothing else happens.
    await page.locator(`${remarkMod(1)} textarea`).focus();
    for (const key of KEYS) await page.keyboard.press(key);
    await page.evaluate(() => document.activeElement.blur());

    // Modifier combos, sent as synthetic events so the browser itself never
    // acts on them (Alt+Arrow would navigate).
    await page.evaluate((keys) => {
      for (const mod of ['ctrlKey', 'metaKey', 'altKey']) {
        for (const key of keys) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, [mod]: true }));
        }
      }
    }, KEYS);

    await page.waitForTimeout(400);
    expect(await allScores(page)).toEqual(before);
    await expectSelected(page, 1);
    expect(await cursorStatus(page)).toBe('');
    expect(await helpShown()).toBe(helpBefore);
    await expect(page.locator('.qc-badge.qc-adopted')).toHaveCount(0);
  });
});

test.describe('selector spans Score and Remark', () => {
  // Trans numbers carrying each outline, read from the module that owns it.
  const outlined = (page) => page.evaluate(() => {
    const numOf = (el, re) => {
      const mod = el.closest('[data-module-name]');
      const m = re.exec(mod ? mod.getAttribute('data-module-name') : '');
      return m ? parseInt(m[1], 10) : null;
    };
    return {
      score: Array.from(document.querySelectorAll('.qc-active-score')).map((el) => numOf(el, /^Trans ?(\d+) Score$/)),
      remark: Array.from(document.querySelectorAll('.qc-active-remark')).map((el) => numOf(el, /^Trans ?(\d+) Remarks$/)),
    };
  });
  // Exactly one outline of each kind on the page, both on translation n.
  const expectOutlines = (page, n) => expect.poll(() => outlined(page)).toEqual({ score: [n], remark: [n] });

  // Document order of the Score control, its badge and the Remarks module.
  const domOrder = (page, n) => page.evaluate((n) => {
    const score = document.querySelector(`[data-module-name="Trans${n} Score"]`);
    const remarks = document.querySelector(n === 2 ? '[data-module-name="Trans 2 Remarks"]' : `[data-module-name="Trans${n} Remarks"]`);
    const parts = { control: score.querySelector('.ant-select'), badge: score.querySelector('.qc-badge'), remarks };
    return Object.entries(parts)
      .sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(([name]) => name);
  }, n);

  test.beforeEach(async ({ page }) => { await bootQC(page); });

  test('outlines the Score and the Remarks of the same translation when it is selected', async ({ page }) => {
    await expectOutlines(page, 1);
    await page.keyboard.press('ArrowDown');
    // Trans2's module is spelled "Trans 2 Remarks", with a space.
    await expectOutlines(page, 2);
  });

  test('moves both outlines together when the arrow keys are pressed', async ({ page }) => {
    for (const [key, n] of [['ArrowDown', 2], ['ArrowDown', 4], ['ArrowUp', 2], ['ArrowRight', 4], ['ArrowLeft', 2]]) {
      await page.keyboard.press(key);
      await expectOutlines(page, n);
    }
  });

  test('keeps the badge between the Score control and the Remarks when Z swaps a score', async ({ page }) => {
    expect(await domOrder(page, 1)).toEqual(['control', 'badge', 'remarks']);
    await page.keyboard.press('z');
    await expect(page.locator(`${scoreMod(1)} .qc-badge`)).toHaveClass(/qc-adopted/);
    await expectValue(page, 1, '3 Points');
    expect(await domOrder(page, 1)).toEqual(['control', 'badge', 'remarks']);
  });

  test('restores both outlines when the platform replaces the Score host', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectOutlines(page, 2);
    await page.evaluate(() => window.__fixture.rerenderScoreHost(2));
    await expectOutlines(page, 2);
  });

  test('restores both outlines when the platform replaces the Remarks module', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectOutlines(page, 2);
    await page.evaluate(() => {
      window.__oldRemarks = document.querySelector('.qc-active-remark');
      window.__fixture.rerenderRemarkHost(2);
    });
    expect(await page.evaluate(() => window.__oldRemarks.isConnected)).toBe(false);
    await expectOutlines(page, 2);
    await expect(page.locator(`${remarkMod(2)} textarea`).first()).toHaveValue('Lorem a1 two');
  });

  test('leaves no outline on the page when no translation is scoreable', async ({ page }) => {
    await page.evaluate(() => {
      document.querySelectorAll('[data-module-name^="Trans"] .preview-content').forEach((el) => { el.textContent = ''; });
    });
    await expect.poll(() => outlined(page)).toEqual({ score: [], remark: [] });
  });
});
