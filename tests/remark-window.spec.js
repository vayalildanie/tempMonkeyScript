// Remark Composer (src/remark-composer.js): where the Remark Options window is
// and whether it can be seen. A remembered position or size can come from a
// bigger screen, and the page can remove the window; neither may leave the
// annotator with a window that is cut off, off-screen, or invisible while the
// composer still has the keyboard.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { ALL_EMPTY, setScores } = require('./helpers/scores');
const { setRemark, expectRemarks, expectTarget, edit, openComposer } = require('./helpers/remarks');

const POS_KEY = 'trans-tool:nova-remark-pos-v1';
const SIZE_KEY = 'trans-tool:nova-remark-size-v1';
const VIEWPORT = { width: 1280, height: 800 };

const box = (page) => page.evaluate(() => {
  const el = document.getElementById('rmd-popover');
  const r = el.getBoundingClientRect();
  return {
    display: getComputedStyle(el).display,
    left: r.left, top: r.top, right: r.right, bottom: r.bottom,
    vw: window.innerWidth, vh: window.innerHeight,
  };
});
const insideViewport = (b) => b.left >= 0 && b.top >= 0 && b.right <= b.vw && b.bottom <= b.vh;

async function bootWithSaved(page, saved) {
  await boot(page, {
    beforeModules: (p) => p.evaluate((s) => {
      if (!s) return;
      localStorage.setItem('trans-tool:nova-remark-pos-v1', JSON.stringify(s.pos));
      localStorage.setItem('trans-tool:nova-remark-size-v1', JSON.stringify(s.size));
    }, saved),
  });
  await expect(page.locator('#rmd-popover')).toBeAttached();
}

test.describe('window geometry', { tag: '@layout' }, () => {
  test.use({ viewport: VIEWPORT });

  // Rows: [label, saved position and size]. null = nothing saved (the control).
  const cases = [
    ['a position saved on a larger screen', { pos: { left: 1500, top: 900 }, size: { w: 380, h: 340 } }],
    ['a height saved taller than the window', { pos: { left: 40, top: 40 }, size: { w: 380, h: 1200 } }],
    ['a position and size that are both too big', { pos: { left: 1200, top: 700 }, size: { w: 900, h: 900 } }],
    ['nothing saved', null],
  ];
  for (const [label, saved] of cases) {
    test(`opens fully on screen when ${label}`, async ({ page }) => {
      await bootWithSaved(page, saved);
      await openComposer(page);
      const b = await box(page);
      expect(b.display).toBe('flex');
      expect(insideViewport(b), JSON.stringify(b)).toBe(true);
      if (saved) { // only the live window is adjusted; the remembered layout is kept
        expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), POS_KEY)).toEqual(saved.pos);
        expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SIZE_KEY)).toEqual(saved.size);
      }
    });
  }

  test('moves back on screen when the browser window is made smaller while it is open', async ({ page }) => {
    await bootWithSaved(page, null);
    await openComposer(page);
    expect(insideViewport(await box(page))).toBe(true);
    await page.setViewportSize({ width: 600, height: 400 });
    await expect.poll(async () => insideViewport(await box(page))).toBe(true);
  });
});

test.describe('window re-created by the page', { tag: '@logic' }, () => {
  test.use({ viewport: VIEWPORT });

  const wipe = (page) => page.evaluate(() => document.getElementById('rmd-popover').remove());

  test('comes back visible with the same target and text when the page removes it while open', async ({ page }) => {
    await bootWithSaved(page, null);
    await setScores(page, ALL_EMPTY);
    await setRemark(page, 1, 'seed text');
    await openComposer(page);
    await expectTarget(page, 1);
    await expect(edit(page)).toHaveValue('seed text');

    await wipe(page);
    await expect(page.locator('#rmd-popover')).toBeVisible();
    expect(insideViewport(await box(page))).toBe(true);
    await expectTarget(page, 1);
    await expect(edit(page)).toHaveValue('seed text');

    // The new window is wired up: typing writes to the target, and Escape closes it.
    await edit(page).click();
    await page.keyboard.type(' more');
    await expectRemarks(page, { 1: 'seed text more' });
    await page.keyboard.press('Escape'); // first Escape only takes focus off the box
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
  });

  test('stays hidden when the page removes it while it is closed', async ({ page }) => {
    await bootWithSaved(page, null);
    await wipe(page);
    await expect(page.locator('#rmd-popover')).toBeAttached(); // re-created
    await expect(page.locator('#rmd-popover')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.classList.contains('rmd-active'))).toBe(false);
  });
});
