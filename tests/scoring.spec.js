const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { scoreMod, expanded, scoreNumsWith, setScores, ALL_EMPTY } = require('./helpers/scores');

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

// Every leaf of NOVA's real Confusing tree, by the keys after C (C-2-1 = C, 2, 1).
// Categories 1 and 2 have several children, so they wait for a second digit.
const CONFUSING_PATHS = [
  { keys: ['1', '1'], value: 'Confusing / English meaning unclear / Meme or cultural reference unclear' },
  { keys: ['1', '2'], value: 'Confusing / English meaning unclear / Key word, phrase, or symbol unclear' },
  { keys: ['1', '3'], value: 'Confusing / English meaning unclear / Sentence meaning or logical relation unclear' },
  { keys: ['2', '1'], value: 'Confusing / Necessary context missing / Essential referent unresolved' },
  { keys: ['2', '2'], value: 'Confusing / Necessary context missing / Essential linked context missing' },
  { keys: ['3'], value: 'Confusing / Task input issue' },
  { keys: ['4'], value: 'Confusing / Other / open feedback' },
];
const pathName = (keys) => ['C', ...keys].join('-');

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

async function openConfusingLabelMenu(page, n) {
  await page.keyboard.press('c');
  await expect(page.locator(`${scoreMod(n)} input`).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(`${scoreMod(n)} .tl-num-badge`).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expectActive(page, 1);
});

test.describe('lateral movement', { tag: '@logic' }, () => {
  test('ArrowLeft and ArrowRight jump between the Trans1-3 and Trans4-7 columns', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 1);
    await page.keyboard.press('ArrowLeft');
    await expectActive(page, 4);
    await page.keyboard.press('ArrowRight');
    await expectActive(page, 1);
  });

  test('a column returns to its last-used slot when you toggle back to it', async ({ page }) => {
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

  test('the empty Trans3 is skipped when stepping down or up, and checkCompleteness reports it as skipped', async ({ page }) => {
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

  test('ArrowDown stays on Trans7 when it is already at the bottom of the right column', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
    await expectActive(page, 7);
  });

  // WASD are aliases of the arrow keys (v1.5.5): same assertions, w/a/s/d in place of the matching arrow.
  test('A and D jump between the Trans1-3 and Trans4-7 columns like ArrowLeft and ArrowRight', async ({ page }) => {
    await page.keyboard.press('d');
    await expectActive(page, 4);
    await page.keyboard.press('a');
    await expectActive(page, 1);
    await page.keyboard.press('a');
    await expectActive(page, 4);
    await page.keyboard.press('d');
    await expectActive(page, 1);
  });

  test('S and W step down and up, skipping the empty Trans3, like ArrowDown and ArrowUp', async ({ page }) => {
    await page.keyboard.press('s');
    await expectActive(page, 2);
    await page.keyboard.press('s');
    await expectActive(page, 4);
    await page.keyboard.press('w');
    await expectActive(page, 2);
  });

  test('S stays on Trans7 when it is already at the bottom of the right column', async ({ page }) => {
    await page.keyboard.press('d');
    for (let i = 0; i < 6; i++) await page.keyboard.press('s');
    await expectActive(page, 7);
  });

  test('uppercase W/A/S/D alias the arrows too', async ({ page }) => {
    await page.keyboard.press('Shift+D');
    await expectActive(page, 4);
    await page.keyboard.press('Shift+A');
    await expectActive(page, 1);
    await page.keyboard.press('Shift+S');
    await expectActive(page, 2);
    await page.keyboard.press('Shift+W');
    await expectActive(page, 1);
  });
});

test.describe('3 advances', { tag: '@logic' }, () => {
  test('3 sets 3 Points, closes the cascader and advances when pressed on Trans1', async ({ page }) => {
    await page.keyboard.press('3');
    await expectValue(page, 1, '3 Points');
    await expectActive(page, 2);
    await expect.poll(() => expanded(page, 1)).toBe('false');
  });

  test('3 sets 3 Points and stays when pressed on the last translation', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expectActive(page, 7);
    await page.keyboard.press('3');
    await expectValue(page, 7, '3 Points');
    await expectActive(page, 7);
    await expect.poll(() => status(page)).toContain('(last)');
  });
});

test.describe('2 and label picks', { tag: '@logic' }, () => {
  test('2 sets bare 2 Points and leaves the label menu open without advancing', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await expectValue(page, 1, '2 Points');
    await expectActive(page, 1);
    expect(await status(page)).toContain('press a number');
    expect(await moves(page)).toEqual([]);
  });

  for (const key of ['2', '3', '4', '5', '6', '7', '8', '9', '0']) {
    const label = LABELS[key === '0' ? 9 : Number(key) - 1];
    test(`${key} commits "2 Points / ${label}" and advances to Trans2 when the label menu is open`, async ({ page }) => {
      await openLabelMenu(page, 1);
      await page.keyboard.press(key);
      await expectValue(page, 1, `2 Points / ${label}`);
      await expectActive(page, 2);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    });
  }

  test('1 drills into the category and advances once its lone leaf is committed', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    await page.keyboard.press('1');
    await expectValue(page, 1, '2 Points / Grammar / Grammar');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: '2 Points / Grammar / Grammar' }]);
  });

  test('a category waits for the next pick instead of advancing when it has several children', async ({ page }) => {
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

  test('a label pick advances past the empty Trans3 when made on Trans2', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await openLabelMenu(page, 2);
    await page.keyboard.press('3');
    await expectValue(page, 2, '2 Points / Unauthentic Vocabulary / Collocations');
    await expectActive(page, 4);
  });

  test('a label pick stays on Trans7 when made on the last translation', async ({ page }) => {
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

test.describe('C and Confusing label picks', { tag: '@logic' }, () => {
  test('C sets bare Confusing and leaves the label menu open without advancing', async ({ page }) => {
    await trackActive(page);
    await openConfusingLabelMenu(page, 1);
    await expectValue(page, 1, 'Confusing');
    await expectActive(page, 1);
    expect(await status(page)).toContain('press a number');
    expect(await moves(page)).toEqual([]);
  });

  for (const path of CONFUSING_PATHS) {
    test(`${pathName(path.keys)} commits "${path.value}" and advances only after the last key`, async ({ page }) => {
      await trackActive(page);
      await openConfusingLabelMenu(page, 1);
      for (const key of path.keys.slice(0, -1)) {
        await page.keyboard.press(key);
        await expect.poll(() => status(page)).toContain('Category selected');
        await expectActive(page, 1);
        await expect.poll(() => expanded(page, 1)).toBe('true');
      }
      expect(await moves(page)).toEqual([]);

      await page.keyboard.press(path.keys[path.keys.length - 1]);
      await expectValue(page, 1, path.value);
      await expectActive(page, 2);
      expect(await moves(page)).toEqual([{ num: 2, trans1: path.value }]);
      await expect.poll(() => expanded(page, 1)).toBe('false');
      await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    });
  }

  test('a translation can be relabelled from one Confusing combination to another (C-2-1, then C-4, then C-1-3)', async ({ page }) => {
    for (const path of [CONFUSING_PATHS[3], CONFUSING_PATHS[6], CONFUSING_PATHS[2]]) {
      await page.keyboard.press('ArrowUp');
      await expectActive(page, 1);
      await openConfusingLabelMenu(page, 1);
      await expectValue(page, 1, 'Confusing');
      for (const key of path.keys) await page.keyboard.press(key);
      await expectValue(page, 1, path.value);
      await expectActive(page, 2);
    }
  });

  test('a Confusing leaf pick advances past the empty Trans3 when made on Trans2', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await openConfusingLabelMenu(page, 2);
    await page.keyboard.press('3');
    await expectValue(page, 2, 'Confusing / Task input issue');
    await expectActive(page, 4);
  });
});

test.describe('failed label click', { tag: '@logic' }, () => {
  test('the cursor stays and the status says not applied when the platform ignores a leaf click', async ({ page }) => {
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

  test('a retried label pick commits and advances after a failed leaf click', async ({ page }) => {
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

  test('the cursor stays when the lone-leaf auto-pick after a category fails', async ({ page }) => {
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

test.describe('label badge rendering', { tag: '@perf' }, () => {
  test('label badges render on menu change, not every frame', async ({ page }) => {
    await openLabelMenu(page, 1); // label mode is on and the badges are showing
    await page.evaluate(() => { window.__tlLabelRenders = 0; });
    await page.waitForTimeout(1000);
    const count = await page.evaluate(() => window.__tlLabelRenders);
    expect(count).toBeLessThanOrEqual(5); // the rAF loop did ~60
  });
});

test.describe('X clears the active score', { tag: '@logic' }, () => {
  test('X on a scored translation clears it and advances, like 3 and C', async ({ page }) => {
    await page.keyboard.press('3');
    await expectValue(page, 1, '3 Points');
    await expectActive(page, 2);
    await page.keyboard.press('ArrowUp');
    await expectActive(page, 1);
    await page.keyboard.press('x');
    await expectValue(page, 1, '');
    await expect.poll(() => status(page)).toBe('Trans1 cleared → Trans2');
    await expectActive(page, 2);
  });

  test('X on an empty translation says it is already empty', async ({ page }) => {
    await page.keyboard.press('x');
    await expect.poll(() => status(page)).toBe('Trans1 already empty');
    await expectActive(page, 1);
  });

  test('X during a label pick cancels it like Esc: badges gone, score kept, cursor stays', async ({ page }) => {
    // X cancels the pick only — it does not also clear the score (that takes a second X).
    await openLabelMenu(page, 1);
    await page.keyboard.press('x');
    await expect.poll(() => status(page)).toBe('Label pick cancelled');
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    await expectValue(page, 1, '2 Points');
    await expectActive(page, 1);
  });
});

test.describe('Esc and arrows during a label pick', { tag: '@logic' }, () => {
  test('Esc cancels the pick, removes the badges and keeps the cursor and bare 2 Points', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('Escape');
    await expect.poll(() => status(page)).toBe('Label pick cancelled');
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
    await expectActive(page, 1);
    await expectValue(page, 1, '2 Points');
  });

  test('ArrowDown leaves label mode and moves to the next translation', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
  });

  test('ArrowUp leaves label mode and moves up', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectActive(page, 2);
    await openLabelMenu(page, 2);
    await page.keyboard.press('ArrowUp');
    await expectActive(page, 1);
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
  });

  // Review Focus #1: WASD during a label pick behave exactly as the arrows do in that state.
  test('S leaves label mode and moves to the next translation, like ArrowDown', async ({ page }) => {
    await openLabelMenu(page, 1);
    await page.keyboard.press('s');
    await expectActive(page, 2);
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
  });

  test('W leaves label mode and moves up, like ArrowUp', async ({ page }) => {
    await page.keyboard.press('s');
    await expectActive(page, 2);
    await openLabelMenu(page, 2);
    await page.keyboard.press('w');
    await expectActive(page, 1);
    await expect(page.locator('.tl-num-badge')).toHaveCount(0);
  });

  test('D and A are inert during a label pick (as ArrowRight/ArrowLeft are), and the digit pick still works afterwards', async ({ page }) => {
    await trackActive(page);
    await openLabelMenu(page, 1);
    for (const k of ['d', 'a', 'ArrowRight', 'ArrowLeft']) await page.keyboard.press(k);
    await expectActive(page, 1);
    await expect(page.locator('.tl-num-badge').first()).toBeVisible();
    await expect.poll(() => expanded(page, 1)).toBe('true');
    await expectValue(page, 1, '2 Points');
    await page.keyboard.press('4');
    await expectValue(page, 1, '2 Points / Fluency');
    await expectActive(page, 2);
    expect(await moves(page)).toEqual([{ num: 2, trans1: '2 Points / Fluency' }]);
  });
});

test.describe('shortcuts OFF', { tag: '@logic' }, () => {
  test('turning shortcuts off removes the highlight and score keys do nothing', async ({ page }) => {
    await setScores(page, ALL_EMPTY); // materialise the (empty) value element so it can be read
    await page.locator('#tl-score-toggle').click();
    await expect(page.locator('#tl-score-toggle')).toHaveText('Shortcuts: OFF');
    await expect.poll(() => activeNums(page)).toEqual([]);
    expect(await status(page)).toBe('OFF');
    for (const k of ['3', 'c', '2', 'x', 'ArrowDown']) await page.keyboard.press(k);
    await page.waitForTimeout(300);
    await expectValue(page, 1, '');
    await expect.poll(() => activeNums(page)).toEqual([]);
    expect(await status(page)).toBe('OFF');
  });

  test('turning shortcuts back on restores the highlight', async ({ page }) => {
    await page.locator('#tl-score-toggle').click();
    await expect.poll(() => activeNums(page)).toEqual([]);
    await page.locator('#tl-score-toggle').click();
    await expectActive(page, 1);
    await page.keyboard.press('3');
    await expectValue(page, 1, '3 Points');
  });
});

test.describe('wrong value stops the queue', { tag: '@logic' }, () => {
  test('a pick that lands on a different value says unexpected -> stopped and drops the next queued key', async ({ page }) => {
    await trackActive(page);
    await page.evaluate(() => { window.__fixture.wrongNextValue = '2 Points / Grammar'; });
    await page.keyboard.press('3');
    await page.keyboard.press('c'); // queued behind the 3; must be dropped
    await expect.poll(() => status(page)).toContain('unexpected → stopped');
    expect(await status(page)).toContain('"2 Points / Grammar"');
    await page.waitForTimeout(500);
    await expectValue(page, 1, '2 Points / Grammar'); // not overwritten by the queued Confusing
    await expectActive(page, 1);
    expect(await moves(page)).toEqual([]);
    expect(await status(page)).toContain('unexpected → stopped');
  });
});
