const { test, expect } = require('./helpers/test');
const { bootModules } = require('./helpers/boot');
const { boot } = require('./helpers/fixture');
const { POPULATED, scoreMod, setScores } = require('./helpers/scores');
const { setRemarks } = require('./helpers/remarks');

const MODE_KEY = 'trans-tool:nova-score-check-v1';

const fixture = (page) => page.evaluate(() => ({
  submitCount: window.__fixture.submitCount,
  spaceEvents: window.__fixture.spaceEvents,
}));
const submitCount = (page) => page.evaluate(() => window.__fixture.submitCount);
const mode = (page) => page.evaluate((k) => localStorage.getItem(k), MODE_KEY);
const pill = (page) => page.locator('#rmd-check-pill');

// Keeps every Enter keydown so a test can read defaultPrevented once the
// dispatch is finished. A capture listener on window runs before the
// userscript's document-capture handler, so it still sees events the script
// stops with stopImmediatePropagation.
async function trackEnter(page) {
  await page.evaluate(() => {
    window.__enters = [];
    window.addEventListener('keydown', (e) => { if (e.key === 'Enter') window.__enters.push(e); }, true);
  });
}
const enterPrevented = (page) => page.evaluate(() => window.__enters.map((e) => e.defaultPrevented));

async function cycleTo(page, target) {
  const order = ['label', 'submit', 'off'];
  const current = (await mode(page)) || 'label';
  const steps = (order.indexOf(target) - order.indexOf(current) + 3) % 3;
  for (let i = 0; i < steps; i++) await page.keyboard.press('z');
  if (target !== 'label' || steps) await expect.poll(() => mode(page)).toBe(target);
}

async function scoreAll(page) {
  for (const n of POPULATED) {
    await page.keyboard.press('3');
    await expect(page.locator(`${scoreMod(n)} .ant-select-selection-item`).first()).toHaveText('3 Points');
  }
}

test.beforeEach(async ({ page }) => {
  await boot(page, {
    beforeModules: async (p) => {
      await p.evaluate((k) => localStorage.removeItem(k), MODE_KEY);
      await p.reload();
    },
  });
  await expect(page.locator('.tl-active-score')).toHaveCount(1);
  await trackEnter(page);
});

test.describe('Label Check', { tag: '@logic' }, () => {
  test('Enter is blocked and nothing is submitted when populated translations are unscored', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });

  test('Enter passes through and nothing is submitted when every translation was scored 3 Points by keyboard', async ({ page }) => {
    await scoreAll(page);
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([false]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });
});

test.describe('Submit Check', { tag: '@logic' }, () => {
  test.beforeEach(async ({ page }) => {
    await cycleTo(page, 'submit');
  });

  test('Enter is blocked and no Space is sent when populated translations are unscored', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });

  test('Enter is replaced by one Space keydown and keyup and one submit when every translation was scored by keyboard', async ({ page }) => {
    await scoreAll(page);
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents.filter((e) => e.type === 'keydown')).toHaveLength(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keyup')).toHaveLength(1);
    expect(f.submitCount).toBe(1);
  });

  test('one submit still happens when focus is left on a cascader readonly input', async ({ page }) => {
    await scoreAll(page);
    // A mouse-picked score leaves the cascader's readonly search input focused.
    await page.locator(`${scoreMod(7)} input`).first().focus();
    expect(await page.evaluate(() => {
      const el = document.activeElement;
      return [el.tagName, el.readOnly];
    })).toEqual(['INPUT', true]);
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents.filter((e) => e.type === 'keydown')).toHaveLength(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keyup')).toHaveLength(1);
    expect(f.submitCount).toBe(1);
  });
});

test.describe('mode cycling', { tag: '@logic' }, () => {
  test('Z cycles Label -> Submit -> Off -> Label and the mode survives a reload', async ({ page }) => {
    await expect(pill(page)).toContainText('Label Check');
    await page.keyboard.press('z');
    await expect.poll(() => mode(page)).toBe('submit');
    await expect(pill(page)).toContainText('Submit Check');

    await page.reload();
    await bootModules(page);
    await expect(pill(page)).toContainText('Submit Check'); // rebooted modules read the saved mode

    await page.keyboard.press('z');
    await expect.poll(() => mode(page)).toBe('off');
    await expect(pill(page)).toContainText('Check OFF');
    await page.keyboard.press('z');
    await expect.poll(() => mode(page)).toBe('label');
    await expect(pill(page)).toContainText('Label Check');
  });
});

test.describe('mouse override', { tag: '@logic' }, () => {
  test('a mouse click on the submit control submits when Label Check would block the row', async ({ page }) => {
    await page.locator('#fx-submit').click();
    const f = await fixture(page);
    expect(f.submitCount).toBe(1);
    expect(f.spaceEvents).toEqual([]);
  });
});

test.describe('empty-row auto-advance (Submit Check)', { tag: '@logic' }, () => {
  // Moves the page to a new row. Note is the row-signature source, so its text
  // changes with every row, as on the real page.
  const toEmptyRow = (page) => page.evaluate(() => {
    document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'Empty row note.';
    document.querySelectorAll('.preview-content').forEach((el) => { el.textContent = ''; });
  });
  const toRowWithText = (page, text) => page.evaluate((t) => {
    document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'Next row note.';
    document.querySelectorAll('.preview-content').forEach((el) => { el.textContent = ''; });
    document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = t;
  }, text);

  test.beforeEach(async ({ page }) => {
    await cycleTo(page, 'submit');
  });

  test('submits exactly once about a second after the row becomes empty', async ({ page }) => {
    await toEmptyRow(page);
    await expect.poll(() => submitCount(page), { timeout: 3000 }).toBe(1);
    await page.waitForTimeout(1500);
    const f = await fixture(page);
    expect(f.submitCount).toBe(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keydown')).toHaveLength(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keyup')).toHaveLength(1);
  });

  test('nothing is sent when the next row change brings text before the timer fires', async ({ page }) => {
    await toEmptyRow(page);
    await page.waitForTimeout(500); // past the 250ms settle, before the 1000ms timer fires
    await toRowWithText(page, 'A different row with real text to score.');
    await page.waitForTimeout(2000);
    // A stale timer would dispatch an Enter at ~1250ms. The new row is
    // incomplete, so that Enter would be blocked and never reach Space, so
    // assert on the Enter itself: none may be dispatched at all.
    expect(await enterPrevented(page)).toEqual([]);
    const f = await fixture(page);
    expect(f.submitCount).toBe(0);
    expect(f.spaceEvents).toEqual([]);
  });

  test('nothing is sent when the translations render before the timer fires', async ({ page }) => {
    const texts = await page.evaluate(() => Array.from(document.querySelectorAll('.preview-content')).map((el) => el.textContent));
    await toEmptyRow(page);
    await page.waitForTimeout(500); // past the 250ms settle, so the 1s timer is armed
    await page.evaluate((saved) => {
      document.querySelectorAll('.preview-content').forEach((el, i) => { el.textContent = saved[i]; });
    }, texts); // the translations arrive; the Note (row signature) does not change again
    await page.waitForTimeout(1800);
    expect(await enterPrevented(page)).toEqual([]);
    const f = await fixture(page);
    expect(f.submitCount).toBe(0);
    expect(f.spaceEvents).toEqual([]);
  });

  test('nothing is sent when Submit mode is left before the timer fires', async ({ page }) => {
    await toEmptyRow(page);
    await page.waitForTimeout(500);
    await page.keyboard.press('z');
    await expect.poll(() => mode(page)).toBe('off');
    await page.waitForTimeout(2000);
    // cycleCheckMode clears the pending auto-advance timer, so no Enter goes out.
    expect(await enterPrevented(page)).toEqual([]);
    const f = await fixture(page);
    expect(f.submitCount).toBe(0);
    expect(f.spaceEvents).toEqual([]);
  });
});

test.describe('remark gate', { tag: '@logic' }, () => {
  // setScores sets the displayed scores directly ('' = unscored); setRemarks
  // sets page-side Remarks values as NOVA's own field would hold them.
  const ALL_THREE = { 1: '3 Points', 2: '3 Points', 4: '3 Points', 5: '3 Points', 6: '3 Points', 7: '3 Points' };

  // Rows: [label, score overrides, remarks, blocked?]. The Trans2 rows read the
  // spaced "Trans 2 Remarks" module, so they also cover that spelling.
  const cases = [
    ['a non-3 score has an empty remark', { 2: '2 Points / Grammar' }, {}, true],
    ['a non-3 score has a whitespace-only remark', { 2: '2 Points / Grammar' }, { 2: '  \n ' }, true],
    ['a non-3 score has a remark', { 2: '2 Points / Grammar' }, { 2: 'needs a fix' }, false],
    ['Confusing has an empty remark', { 4: 'Confusing' }, {}, true],
    ['3 Points has an empty remark', {}, {}, false],
    ['a label is missing though a remark is present', { 4: '2 Points' }, { 4: 'has a remark' }, true],
  ];

  async function expectOutcome(page, mode, blocked) {
    const prevented = await enterPrevented(page);
    const f = await fixture(page);
    const downs = f.spaceEvents.filter((e) => e.type === 'keydown').length;
    if (mode === 'off') {
      expect(prevented).toEqual([false]);
      expect(f.spaceEvents).toEqual([]);
      expect(f.submitCount).toBe(0);
    } else if (blocked) {
      expect(prevented).toEqual([true]);
      expect(f.spaceEvents).toEqual([]); // no keydown and no keyup
      expect(f.submitCount).toBe(0);
    } else if (mode === 'label') {
      expect(prevented).toEqual([false]);
      expect(f.submitCount).toBe(0);
    } else {
      expect(prevented).toEqual([true]);
      expect(downs).toBe(1);
      expect(f.submitCount).toBe(1);
    }
  }

  for (const mode of ['label', 'submit', 'off']) {
    test.describe(`${mode} mode`, () => {
      for (const [label, scores, remarks, blocked] of cases) {
        test(`${mode === 'off' ? 'Enter is left alone' : blocked ? 'Enter is blocked' : mode === 'submit' ? 'Enter submits' : 'Enter passes'} when ${label}`, async ({ page }) => {
          await cycleTo(page, mode);
          await setScores(page, { ...ALL_THREE, ...scores });
          await setRemarks(page, remarks);
          await page.keyboard.press('Enter');
          await expectOutcome(page, mode, blocked);
        });
      }
    });
  }

  // Trans2 is fully labelled but has no remark; Trans4 is a bare 2 Points. Each reason must sit with its own translation.
  for (const mode of ['label', 'submit']) {
    test(`the toast pairs each translation with its own missing label or remark when ${mode} mode blocks`, async ({ page }) => {
      await cycleTo(page, mode);
      await setScores(page, { ...ALL_THREE, 2: '2 Points / Grammar', 4: '2 Points' });
      await page.keyboard.press('Enter');
      await expect(page.locator('#tl-toast')).toContainText('Trans4 needs a complete label; Trans2 needs a remark.');
    });
  }
});

test.describe('dispatchNativeSpace target', { tag: '@logic' }, () => {
  const dispatch = (page) => page.evaluate(() => window.TL.Utils.dispatchNativeSpace());

  test('Space goes to the body as one keydown+keyup pair when a TEXTAREA has focus', async ({ page }) => {
    await page.locator('textarea').first().focus();
    await dispatch(page);
    const f = await fixture(page);
    expect(f.spaceEvents.map((e) => [e.type, e.target])).toEqual([['keydown', 'BODY'], ['keyup', 'BODY']]);
    expect(f.submitCount).toBe(1);
  });

  test('Space goes to the button as one keydown+keyup pair when a BUTTON has focus', async ({ page }) => {
    await page.locator('#fx-submit').focus();
    await dispatch(page);
    const f = await fixture(page);
    expect(f.spaceEvents.map((e) => [e.type, e.target])).toEqual([['keydown', 'BUTTON'], ['keyup', 'BUTTON']]);
    expect(f.submitCount).toBe(1);
  });
});
