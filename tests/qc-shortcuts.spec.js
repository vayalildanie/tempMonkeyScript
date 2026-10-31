// QC Compare (src/qc-compare.js) shortcut keys on the reduced quality_ fixture:
// 3, C, X, 2 then a label digit, Escape in the label menu, O, and the guards
// that keep every key quiet while typing or with a modifier held (B-SUITE).
// Z lives in qc-swap.spec.js.
const { test, expect } = require('./helpers/test');
const { bootModules } = require('./helpers/boot');
const { expanded } = require('./helpers/scores');
const {
  SCOREABLE, COMPARE_DATA, remarkMod, scoreValue, expectScore, expectSelected,
  cursorStatus, seedQC, bootQC: bootQCWith,
} = require('./helpers/qc');

const HELP_KEY = 'trans-tool:nova-qc-help-v1';

const allScores = (page) => Promise.all(SCOREABLE.map((n) => scoreValue(page, n)));

// Ready: the scrape has finished and painted a badge under every scoreable translation.
const bootQC = (page) => bootQCWith(page, COMPARE_DATA);

async function openLabelMenu(page, n) {
  await page.keyboard.press('2');
  await expect.poll(() => cursorStatus(page)).toContain('press 1-9/0');
  await expectScore(page, n, '2 Points');
  await expect.poll(() => expanded(page, n)).toBe('true');
}

test.describe('score keys', { tag: '@logic' }, () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  for (const row of [
    { key: '3', score: '3 Points' },
    { key: 'c', score: 'Confusing' },
  ]) {
    test(`sets ${row.score} on the selected translation when ${row.key} is pressed`, async ({ page }) => {
      await page.keyboard.press(row.key);
      await expectScore(page, 1, row.score);
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
    await expectScore(page, 2, '');
    await expect.poll(() => cursorStatus(page)).toBe('Trans2 cleared');
    await expectSelected(page, 2);
    await expectScore(page, 1, '');
    await expectScore(page, 4, '3 Points');
  });
});

test.describe('label menu', { tag: '@logic' }, () => {
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
      await expectScore(page, 1, `2 Points / ${row.label}`);
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
    await expectScore(page, 1, '2 Points');
    await expectSelected(page, 1);
  });
});

test.describe('help toggle', { tag: '@logic' }, () => {
  test('toggles the help panel and keeps the setting across a reload when O is pressed', async ({ page }) => {
    await bootQC(page);
    const help = page.locator('#qc-help');
    await expect(help).toBeVisible();

    await page.keyboard.press('o');
    await expect(help).toBeHidden();
    expect(await page.evaluate((k) => localStorage.getItem(k), HELP_KEY)).toBe('0');

    await page.reload();
    await seedQC(page, COMPARE_DATA);
    await bootModules(page);
    await expect(page.locator('#qc-panel')).toBeVisible();
    await expect(help).toBeHidden();

    await page.keyboard.press('o');
    await expect(help).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), HELP_KEY)).toBe('1');
  });
});

test.describe('guards', { tag: '@logic' }, () => {
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
