const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { scoreMod, expanded, scoreNumsWith } = require('./helpers/scores');

// The fixture's second-level labels, in menu order. Keys 2-9 and 0 pick
// LABELS[n - 1] (0 is the 10th); key 1 is a category with one leaf below it.
const LABELS = [
  'Grammar',
  'Authenticity',
  'Unauthentic Vocabulary / Collocations',
  'Fluency',
  'Accuracy',
  'Omission',
  'Addition',
  'Terminology',
  'Register',
  'Other',
];

// Trans numbers whose "TransN Score" block currently carries tl-active-score.
const activeNums = (page) => scoreNumsWith(page, 'tl-active-score');

async function expectActive(page, n) {
  await expect.poll(() => activeNums(page)).toEqual([n]);
}

function value(page, n) {
  return page.locator(`${scoreMod(n)} .ant-select-selection-item`).first().innerText().then((t) => t.trim());
}

async function expectValue(page, n, text) {
  await expect.poll(() => value(page, n)).toBe(text);
}

const status = (page) => page.locator('#tl-score-status').innerText();

// Records every tl-active-score move, with Trans1's displayed value at that
// moment, so a test can prove the cursor never moved early or at all.
async function trackActive(page) {
  await page.evaluate(() => {
    window.__moves = [];
    const read = () => {
      const el = document.querySelector('[data-module-name="Trans1 Score"] .ant-select-selection-item');
      return el ? el.textContent.trim() : '';
    };
    const num = () => {
      const el = document.querySelector('.tl-active-score');
      const mod = el && el.closest('[data-module-name$=" Score"]');
      const m = mod && /^Trans ?(\d+) Score$/.exec(mod.getAttribute('data-module-name'));
      return m ? parseInt(m[1], 10) : null;
    };
    let last = num();
    new MutationObserver(() => {
      const now = num();
      if (now !== last) { window.__moves.push({ num: now, trans1: read() }); last = now; }
    }).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
  });
}
const moves = (page) => page.evaluate(() => window.__moves);

async function openLabelMenu(page, n) {
  await page.keyboard.press('2');
  await expect(page.locator(`${scoreMod(n)} input`).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${scoreMod(n)} .tl-num-badge`).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expectActive(page, 1);
});

test.describe('lateral movement', () => {
  test('left and right jump between the Trans1-3 and Trans4-7 columns', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 1);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 1);
  });

  test('each column remembers the slot you last used', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 6);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 2);
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 6);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 2);
  });

  test('the empty Trans3 is never active, whether stepping down or moving across', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowUp');
    await expectActive(page, 2);

    const seen = await page.evaluate(() => window.TL.TransCursor.nextIn([1, 2, 4, 5, 6, 7], 2));
    expect(seen).toBe(4);
    const completeness = await page.evaluate(() => {
      const ss = window.TL.ScoringShortcuts(window.TL.Utils);
      return ss.checkCompleteness();
    });
    expect(completeness.scoreable).toEqual([1, 2, 4, 5, 6, 7]);
    expect(completeness.skipped).toEqual([3]);
  });

  test('moving down past the bottom of the right column stays on Trans7', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await expectActive(page, 7);
  });
});

test.describe('3 and C advance', () => {
  test('3 sets 3 Points and advances to the next scoreable translation', async ({ page }) => {
    await page.keyboard.press('3');
    await expectValue(page, 1, '3 Points');
    await expectActive(page, 2);
    await expect.poll(() => expanded(page, 1)).toBe('false');
  });

  test('C sets Confusing and skips the empty Trans3 on the way to Trans4', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await page.keyboard.press('c');
    await expectValue(page, 2, 'Confusing');
    await expectActive(page, 4);
    await expect(page.locator(`${scoreMod(3)} .ant-select-selection-item`)).toHaveCount(0);
  });

  test('3 on Trans7 sets it and stays there', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expectActive(page, 7);
    await page.keyboard.press('3');
    await expectValue(page, 7, '3 Points');
    await expectActive(page, 7);
    await expect.poll(() => status(page)).toContain('(last)');
  });
});

test.describe('2 and label picks', () => {
  test('2 leaves the cascader open on bare 2 Points and does not advance', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await expectValue(page, 1, '2 Points');
    await expectActive(page, 1);
    expect(await status(page)).toContain('press a number');
    expect(await moves(page)).toEqual([]);
  });

  for (const key of ['2', '3', '4', '5', '6', '7', '8', '9', '0']) {
    const label = LABELS[key === '0' ? 9 : Number(key) - 1];
    test(`terminal label ${key} commits "${label}" and advances to Trans2`, async ({ page }) => {
      await openLabelMenu(page, 1);
      await page.keyboard.press(key);
      await expectValue(page, 1, `2 Points / ${label}`);
      await expectActive(page, 2);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    });
  }

  test('1 drills into a category and only advances once its leaf is committed', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expectValue(page, 1, '2 Points / Grammar / Grammar');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: '2 Points / Grammar / Grammar' }]);
  });

  test('a category with several children waits for the next pick instead of advancing', async ({ page }) => {
    // Give the leaf column of the category a second item so the auto-pick of a
    // lone leaf does not apply.
    await page.evaluate(() => {
      new MutationObserver(() => {
        document.querySelectorAll('ul.ant-cascader-menu').forEach((ul) => {
          const items = ul.querySelectorAll('li.ant-cascader-menu-item');
          const key = items[0] && items[0].getAttribute('data-path-key');
          if (items.length === 1 && key && key.split('__RC_CASCADER_SPLIT__').length === 3) {
            const extra = items[0].cloneNode(true);
            extra.setAttribute('data-path-key', key + '-extra');
            ul.appendChild(extra);
          }
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expect.poll(() => status(page)).toContain('Category selected');
    await expectActive(page, 1);
    expect(await moves(page)).toEqual([]);

    await page.keyboard.press('1');
    await expectValue(page, 1, '2 Points / Grammar / Grammar');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: '2 Points / Grammar / Grammar' }]);
  });

  test('a label pick from Trans2 skips the empty Trans3 and advances to Trans4', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await openLabelMenu(page, 2);
    await page.keyboard.press('3');
    await expectValue(page, 2, '2 Points / Unauthentic Vocabulary / Collocations');
    await expectActive(page, 4);
  });

  test('a label pick on Trans7 stays on Trans7', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expectActive(page, 7);
    await openLabelMenu(page, 7);
    await page.keyboard.press('4');
    await expectValue(page, 7, '2 Points / Fluency');
    await expectActive(page, 7);
    await expect.poll(() => status(page)).toContain('(last)');
  });
});

test.describe('failed label click', () => {
  test('a leaf click that leaves bare 2 Points does not advance and says so', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.evaluate(() => { window.__fixture.failNextLeaf = true; });
    await page.keyboard.press('2');

    await expect.poll(() => status(page)).toMatch(/not applied/i);
    await expect.poll(() => page.evaluate(() => window.__fixture.failNextLeaf)).toBe(false);
    await expectValue(page, 1, '2 Points');
    await expectActive(page, 1);
    expect(await moves(page)).toEqual([]);
  });

  test('after a failed leaf the label pick can be retried and then advances', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.evaluate(() => { window.__fixture.failNextLeaf = true; });
    await page.keyboard.press('2');
    await expect.poll(() => status(page)).toMatch(/not applied/i);

    await page.keyboard.press('3');
    await expectValue(page, 1, '2 Points / Unauthentic Vocabulary / Collocations');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: '2 Points / Unauthentic Vocabulary / Collocations' }]);
  });

  test('a failed lone-leaf auto-pick after a category does not advance either', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.evaluate(() => { window.__fixture.failNextLeaf = true; });
    await page.keyboard.press('1');

    await expect.poll(() => status(page)).toMatch(/not applied/i);
    await expectActive(page, 1);
    expect(await moves(page)).toEqual([]);
    await expect.poll(() => value(page, 1)).toBe('2 Points');
  });
});
