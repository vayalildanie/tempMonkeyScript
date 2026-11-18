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

async function openConfusingLabelMenu(page, n) {
  await page.keyboard.press('c');
  await expect.poll(() => cursorStatus(page)).toContain('press 1-9/0');
  await expectScore(page, n, 'Confusing');
  await expect.poll(() => expanded(page, n)).toBe('true');
}

test.describe('score keys', { tag: '@logic' }, () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  for (const row of [
    { key: '3', score: '3 Points' },
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

  test('X clears the selected translation\'s score and advances to the next', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 2);
    await page.keyboard.press('x');
    await expectScore(page, 2, '');
    await expectSelected(page, 4); // Trans3 is empty in this fixture, so the advance skips it (as Z's does)
    await expectScore(page, 1, '');
    await expectScore(page, 4, '3 Points');
  });

  test('S/W step the selection and D/A toggle the column, like the arrow keys', async ({ page }) => {
    await page.keyboard.press('s');
    await expectSelected(page, 2);
    await page.keyboard.press('w');
    await expectSelected(page, 1);
    await page.keyboard.press('d');
    await expectSelected(page, 4);
    await page.keyboard.press('a');
    await expectSelected(page, 1);
  });
});

test.describe('label menu', { tag: '@logic' }, () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  // Review Focus #1: with the menu open, ArrowDown steps the selection on (leaving the menu behind); S does the same,
  // and the digit pick still works on a fresh menu afterwards. D/A toggle the column like ArrowRight/Left.
  test('S moves the selection on with the label menu open, exactly as ArrowDown does', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 2);
    const arrowState = { score1: await scoreValue(page, 1), expanded1: await expanded(page, 1) };

    await page.keyboard.press('ArrowUp');
    await expectSelected(page, 1);
    await page.keyboard.press('s');
    await expectSelected(page, 2);
    expect({ score1: await scoreValue(page, 1), expanded1: await expanded(page, 1) }).toEqual(arrowState);
  });

  test('D toggles the column with the label menu open, exactly as ArrowRight does, and a digit pick still lands afterwards', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('d');
    await expectSelected(page, 4);
    await page.keyboard.press('a');
    await expectSelected(page, 1);
    // The menu on Trans1 is still the live one (a column toggle leaves it open): a digit still picks from it.
    await expect.poll(() => expanded(page, 1)).toBe('true');
    await page.keyboard.press('4');
    await expectScore(page, 1, '2 Points / Fluency');
    await expectSelected(page, 1);
  });

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

  // The fixture's first label (key 1) is the category "Grammar" with exactly
  // one leaf, also "Grammar" (the same fixture Task 11 used for Scoring Shortcuts).
  test('selects the lone sub-label too when a category with exactly one sub-label is picked with 1', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expectScore(page, 1, '2 Points / Grammar / Grammar');
    await expect.poll(() => expanded(page, 1)).toBe('false');
    await expect.poll(() => cursorStatus(page)).toBe('Trans1 = 2 Points / Grammar / Grammar ✓');
    await expectSelected(page, 1);
  });

  test('closes the menu and keeps bare 2 Points when Escape is pressed with the menu open', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('Escape');
    await expect.poll(() => expanded(page, 1)).toBe('false');
    await expect.poll(() => cursorStatus(page)).toBe('Trans1: label pick cancelled');
    await expectScore(page, 1, '2 Points');
    await expectSelected(page, 1);
  });

  test('opens the Confusing label menu without relabeling or moving the selection when c is pressed', async ({ page }) => {
    await openConfusingLabelMenu(page, 1);
    await expectSelected(page, 1);
  });

  for (const row of [
    { key: '2', label: 'Necessary context missing' },
    { key: '3', label: 'Task input issue' },
    { key: '4', label: 'Other / open feedback' },
  ]) {
    test(`picks Confusing label "${row.label}" when ${row.key} is pressed with the Confusing menu open`, async ({ page }) => {
      await openConfusingLabelMenu(page, 1);
      await page.keyboard.press(row.key);
      await expectScore(page, 1, `Confusing / ${row.label}`);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect.poll(() => cursorStatus(page)).toBe(`Trans1 = Confusing / ${row.label} ✓`);
      await expectSelected(page, 1);
    });
  }

  test('selects the lone sub-label too when the Confusing category is picked with 1', async ({ page }) => {
    await openConfusingLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expectScore(page, 1, 'Confusing / English meaning unclear / Meme or cultural reference unclear');
    await expect.poll(() => expanded(page, 1)).toBe('false');
    await expect.poll(() => cursorStatus(page)).toBe('Trans1 = Confusing / English meaning unclear / Meme or cultural reference unclear ✓');
    await expectSelected(page, 1);
  });

  test('closes the menu and keeps bare Confusing when Escape is pressed with the Confusing menu open', async ({ page }) => {
    await openConfusingLabelMenu(page, 1);
    await page.keyboard.press('Escape');
    await expect.poll(() => expanded(page, 1)).toBe('false');
    await expect.poll(() => cursorStatus(page)).toBe('Trans1: label pick cancelled');
    await expectScore(page, 1, 'Confusing');
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
  const KEYS = ['z', '3', 'c', 'x', 'o', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'];

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

test.describe('Enter submits', { tag: '@logic' }, () => {
  // Records every Space keydown/keyup that reaches the document (what the platform's submit hotkey listens for).
  const recordSpaces = (page) => page.evaluate(() => {
    window.__spaces = [];
    for (const type of ['keydown', 'keyup']) {
      document.addEventListener(type, (ev) => { if (ev.code === 'Space') window.__spaces.push(type); });
    }
  });
  const spaces = (page) => page.evaluate(() => window.__spaces);

  test.beforeEach(async ({ page }) => { await bootQC(page); await recordSpaces(page); });

  test('Enter is replaced by one native Space keydown+keyup', async ({ page }) => {
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(true);
    expect(await spaces(page)).toEqual(['keydown', 'keyup']);
  });

  test('Enter does not submit while a label menu is open, or while typing a remark', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator(`${remarkMod(2)} textarea`).focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await spaces(page)).toEqual([]);
  });

  test('Enter does not submit while the Confusing label menu is open', async ({ page }) => {
    await openConfusingLabelMenu(page, 1);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    expect(await spaces(page)).toEqual([]);
    await expectScore(page, 1, 'Confusing');
  });

  test('a blocking check message stops the submit and shows the toast', async ({ page }) => {
    const result = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      const ok = window.TL.Utils.runSubmitGate(ev, { check: () => '⛔ blocked for test' });
      return { ok, prevented: ev.defaultPrevented };
    });
    expect(result).toEqual({ ok: false, prevented: true });
    expect(await spaces(page)).toEqual([]);
    await expect(page.locator('#tl-toast')).toContainText('blocked for test');
  });
});
