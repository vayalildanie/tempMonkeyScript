const { test, expect } = require('@playwright/test');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const fixtureUrl = 'file://' + path.resolve(__dirname, 'fixtures/annotation.html').replace(/\\/g, '/');
const MODE_KEY = 'trans-tool:nova-score-check-v1';
const POPULATED = [1, 2, 4, 5, 6, 7]; // Trans3's preview is empty in the fixture

const scoreMod = (n) => `[data-module-name="Trans${n} Score"]`;
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
  await page.goto(fixtureUrl);
  await page.evaluate((k) => localStorage.removeItem(k), MODE_KEY);
  await page.reload();
  await bootModules(page);
  await expect(page.locator('.tl-active-score')).toHaveCount(1);
  await trackEnter(page);
});

test.describe('Label Check', () => {
  test('incomplete row: Enter is blocked and nothing is submitted', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });

  test('complete row: Enter passes through and nothing is submitted', async ({ page }) => {
    await scoreAll(page);
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([false]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });
});

test.describe('Submit Check', () => {
  test.beforeEach(async ({ page }) => {
    await cycleTo(page, 'submit');
  });

  test('incomplete row: blocked, no Space', async ({ page }) => {
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });

  test('complete row: one Space keydown, one keyup, one submit; Enter is prevented', async ({ page }) => {
    await scoreAll(page);
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([true]);
    const f = await fixture(page);
    expect(f.spaceEvents.filter((e) => e.type === 'keydown')).toHaveLength(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keyup')).toHaveLength(1);
    expect(f.submitCount).toBe(1);
  });

  test('complete row with focus left on a cascader readonly input: still one submit', async ({ page }) => {
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

test.describe('Check Off', () => {
  test('Enter is untouched and nothing is submitted', async ({ page }) => {
    await cycleTo(page, 'off');
    await page.keyboard.press('Enter');
    expect(await enterPrevented(page)).toEqual([false]);
    const f = await fixture(page);
    expect(f.spaceEvents).toEqual([]);
    expect(f.submitCount).toBe(0);
  });
});

test.describe('mode cycling', () => {
  test('z cycles Label -> Submit -> Off -> Label and the mode survives a reload', async ({ page }) => {
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

test.describe('mouse override', () => {
  test('clicking the submit control submits in Label Check mode with an incomplete row', async ({ page }) => {
    await page.locator('#fx-submit').click();
    const f = await fixture(page);
    expect(f.submitCount).toBe(1);
    expect(f.spaceEvents).toEqual([]);
  });
});

test.describe('empty-row auto-advance (Submit Check)', () => {
  // Moves the page to a row with nothing to score: changes Trans1 (the row
  // signature source) and empties every translation.
  const toEmptyRow = (page) => page.evaluate(() => {
    document.querySelectorAll('.preview-content').forEach((el) => { el.textContent = ''; });
  });
  const toRowWithText = (page, text) => page.evaluate((t) => {
    document.querySelectorAll('.preview-content').forEach((el) => { el.textContent = ''; });
    document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = t;
  }, text);

  test.beforeEach(async ({ page }) => {
    await cycleTo(page, 'submit');
  });

  test('submits exactly once about a second after the row empties', async ({ page }) => {
    await toEmptyRow(page);
    await expect.poll(() => submitCount(page), { timeout: 3000 }).toBe(1);
    await page.waitForTimeout(1500);
    const f = await fixture(page);
    expect(f.submitCount).toBe(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keydown')).toHaveLength(1);
    expect(f.spaceEvents.filter((e) => e.type === 'keyup')).toHaveLength(1);
  });

  test('a later row change to a non-empty row cancels the stale timer', async ({ page }) => {
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

  test('leaving Submit mode cancels the pending timer: no Enter is dispatched at all', async ({ page }) => {
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

test.describe('dispatchNativeSpace target', () => {
  const dispatch = (page) => page.evaluate(() => window.TL.Utils.dispatchNativeSpace());

  test('focused TEXTAREA: Space goes to the body, one keydown+keyup pair', async ({ page }) => {
    await page.locator('textarea').first().focus();
    await dispatch(page);
    const f = await fixture(page);
    expect(f.spaceEvents.map((e) => [e.type, e.target])).toEqual([['keydown', 'BODY'], ['keyup', 'BODY']]);
    expect(f.submitCount).toBe(1);
  });

  test('focused BUTTON: Space stays on that button, one keydown+keyup pair', async ({ page }) => {
    await page.locator('#fx-submit').focus();
    await dispatch(page);
    const f = await fixture(page);
    expect(f.spaceEvents.map((e) => [e.type, e.target])).toEqual([['keydown', 'BUTTON'], ['keyup', 'BUTTON']]);
    expect(f.submitCount).toBe(1);
  });
});
