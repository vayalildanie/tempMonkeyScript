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

// W-HEAD / W-BODY: the header controls stay in the window's top-right corner at
// every width, and any extra height goes to the edit box.
test.describe('window layout', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1280, height: 1000 } });

  const MIN_W = 300; // = POPOVER_MIN_W in src/remark-composer.js
  const MIN_H = 260; // = POPOVER_MIN_H

  async function openAt(page, w, h) {
    await bootWithSaved(page, null);
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await page.evaluate(([w, h]) => {
      const p = document.getElementById('rmd-popover');
      p.style.left = '20px'; p.style.top = '20px';
      p.style.width = w + 'px'; p.style.height = h + 'px';
    }, [w, h]);
  }

  const controls = (page) => page.evaluate(() => {
    const p = document.getElementById('rmd-popover').getBoundingClientRect();
    const out = { pop: { left: p.left, top: p.top, right: p.right, bottom: p.bottom } };
    for (const id of ['settings', 'clear', 'close']) {
      const r = document.getElementById(`rmd-${id}-btn`).getBoundingClientRect();
      out[id] = { left: r.left, right: r.right, top: r.top, bottom: r.bottom,
        fromRight: p.right - r.right, fromTop: r.top - p.top };
    }
    return out;
  });

  test('header controls stay inside the window and keep their corner offsets at every width', async ({ page }) => {
    await openAt(page, 380, 420);
    const ref = await controls(page);
    for (const w of [MIN_W, 340, 380, 520, 900]) {
      await page.evaluate((w) => { document.getElementById('rmd-popover').style.width = w + 'px'; }, w);
      const c = await controls(page);
      for (const id of ['settings', 'clear', 'close']) {
        const b = c[id];
        expect(b.left, `${id} @${w}`).toBeGreaterThanOrEqual(c.pop.left);
        expect(b.right, `${id} @${w}`).toBeLessThanOrEqual(c.pop.right);
        expect(b.top, `${id} @${w}`).toBeGreaterThanOrEqual(c.pop.top);
        expect(b.bottom, `${id} @${w}`).toBeLessThanOrEqual(c.pop.bottom);
        expect(Math.abs(b.fromRight - ref[id].fromRight), `${id} right offset @${w}`).toBeLessThanOrEqual(1);
        expect(Math.abs(b.fromTop - ref[id].fromTop), `${id} top offset @${w}`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('at the minimum width the badge still names its mode and the header does not overflow', async ({ page }) => {
    await openAt(page, MIN_W, 420);
    const r = await page.evaluate(() => {
      const head = document.getElementById('rmd-head');
      return { title: document.getElementById('rmd-check-badge').getAttribute('title'),
        sw: head.scrollWidth, cw: head.clientWidth };
    });
    expect(r.title).toMatch(/Label Check|Submit Check|Check Off/i);
    expect(r.sw).toBeLessThanOrEqual(r.cw);
  });

  test('a tall window gives the extra height to the edit box, leaving no dead space', async ({ page }) => {
    await openAt(page, 380, 800);
    const r = await page.evaluate(() => {
      const p = document.getElementById('rmd-popover');
      const pr = p.getBoundingClientRect();
      let lastBottom = 0;
      for (const ch of p.children) {
        if (ch.id === 'rmd-resize-handle') continue;
        const cr = ch.getBoundingClientRect();
        if (getComputedStyle(ch).display === 'none' || cr.height === 0) continue;
        lastBottom = Math.max(lastBottom, cr.bottom);
      }
      const pal = document.getElementById('rmd-palette');
      return { editH: document.getElementById('rmd-edit').getBoundingClientRect().height, gap: pr.bottom - lastBottom,
        palH: pal.clientHeight,
        palContent: Math.max(...Array.from(pal.querySelectorAll('.rmd-chip')).map((c) => c.getBoundingClientRect().bottom - pal.getBoundingClientRect().top)) + parseFloat(getComputedStyle(pal).paddingBottom) };
    });
    expect(r.editH).toBeGreaterThan(72);
    expect(r.gap).toBeLessThanOrEqual(24);
    // The palette keeps its natural height: not stretched past its content, not capped below it.
    expect(Math.abs(r.palH - r.palContent), JSON.stringify(r)).toBeLessThanOrEqual(1);
    // Narrower, the chips wrap into a taller palette: with room to spare it must not scroll.
    await page.evaluate((w) => { document.getElementById('rmd-popover').style.width = w + 'px'; }, MIN_W);
    const scrolls = await page.evaluate(() => {
      const pal = document.getElementById('rmd-palette');
      return { client: pal.clientHeight, scroll: pal.scrollHeight };
    });
    expect(scrolls.scroll, JSON.stringify(scrolls)).toBeLessThanOrEqual(scrolls.client + 1);
    // No fixed cap: a longer chip set must be able to take its natural height too.
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('rmd-palette')).maxHeight)).toBe('none');
  });

  test('at the minimum size the palette, edit box and header controls are all visible', async ({ page }) => {
    await openAt(page, MIN_W, MIN_H);
    const r = await page.evaluate(() => {
      const p = document.getElementById('rmd-popover').getBoundingClientRect();
      const vis = (id) => {
        const b = document.getElementById(id).getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.left >= p.left && b.right <= p.right && b.top >= p.top && b.bottom <= p.bottom;
      };
      return { palH: document.getElementById('rmd-palette').getBoundingClientRect().height,
        edit: vis('rmd-edit'), settings: vis('rmd-settings-btn'), clear: vis('rmd-clear-btn'), close: vis('rmd-close-btn') };
    });
    expect(r.palH).toBeGreaterThanOrEqual(64);
    expect(r).toMatchObject({ edit: true, settings: true, clear: true, close: true });
  });

  test('the header compacts only below 380px (badge label) and below 340px (title text), measured as the window width', async ({ page }) => {
    await openAt(page, 380, 420);
    const shown = (sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
    const setW = (w) => page.evaluate((w) => { document.getElementById('rmd-popover').style.width = w + 'px'; }, w);
    for (const [w, label, title] of [[380, true, true], [379, false, true], [340, false, true], [339, false, false]]) {
      await setW(w);
      expect(await shown('.rmd-badge-label'), `badge label @${w}`).toBe(label);
      expect(await shown('.rmd-title-text'), `title text @${w}`).toBe(title);
    }
  });

  test('the edit box has no resize grip of its own', async ({ page }) => {
    await openAt(page, 380, 420);
    expect(await page.evaluate(() => getComputedStyle(document.getElementById('rmd-edit')).resize)).toBe('none');
  });

  test('typing, chips, Q and Escape still work at a resized width', async ({ page }) => {
    await openAt(page, MIN_W, 420);
    await expectTarget(page, 1);
    await edit(page).click();
    await page.keyboard.type('ab');
    await expectRemarks(page, { 1: 'ab' });
    await page.locator('.rmd-chip[data-chip="Strange"]').click();
    await expect(edit(page)).toHaveValue('ab, Strange');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('q'); // nothing selected: puts the caret back in the box
    await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('rmd-edit');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
  });
});
