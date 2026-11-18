// QC Compare (src/qc-compare.js) navigation on the reduced quality_ fixture:
// when the module starts, the tab round trip, and the selector that moves with
// the arrow keys and spans a translation's Score and Remark (v1.5.3: B-SEL,
// B-SUITE). TransCursor internals (clamping, slot memory) belong to
// shared.spec.js and scoring.spec.js.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { scoreMod } = require('./helpers/scores');
const {
  COMPARE_DATA, remarkMod, expectScore, expectSelected, activeTab, clickTab, bootQC: bootQCWith,
} = require('./helpers/qc');

// Ready: the scrape has finished and painted a badge under every scoreable translation.
const bootQC = (page) => bootQCWith(page, COMPARE_DATA);

test.describe('starting on a QC page', () => {
  test('scrapes both tabs and renders badges when the URL contains /quality_', { tag: '@logic' }, async ({ page }) => {
    await bootQC(page);

    await expect(page.locator('#qc-panel')).toBeVisible();
    // Trans5 agrees on the score but the remarks differ, which now counts as still to reconcile (v1.5.3).
    await expect(page.locator('#qc-summary')).toContainText('5 still to reconcile: Trans 1, 2, 4, 5, 7');
    // Annotator 2 was visited once and the module returned to Annotator 1.
    expect(await page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0]);
    expect(await activeTab(page)).toBe(0);
    // Verdict rule: Annotator 1 gets "1", Annotator 2 gets "3".
    expect(await page.evaluate(() => window.__fixture.verdict)).toEqual({ a1: 'right', a2: 'wrong' });

    for (const n of [1, 2, 4, 5, 7]) {
      await expect(page.locator(`${scoreMod(n)} .qc-badge`), `Trans${n}`).toHaveClass(/qc-diff/);
    }
    await expect(page.locator(`${scoreMod(6)} .qc-badge`), 'Trans6').toHaveClass(/qc-same/);
    await expect(page.locator(`${scoreMod(2)} .qc-badge`)).toContainText('Annotator 2: 3 Points');
    await expect(page.locator(`${scoreMod(3)} .qc-badge`)).toHaveCount(0);
    // Annotator 1's own data is what is on screen.
    await expectScore(page, 2, '2 Points / Fluency');
    await expect(page.locator(`${remarkMod(2)} textarea`)).toHaveValue('Lorem a1 two');
  });

  test('lists only the live shortcuts in the legend when the panel is open', { tag: '@layout' }, async ({ page }) => {
    await bootQC(page);
    const legend = (await page.locator('#qc-help').textContent()).replace(/\s+/g, ' ');
    expect(legend).not.toMatch(/Rewrite|\+ ?Add|＋ ?Add/);
    expect(legend).toContain('Z Swaps Score + Remark');
    expect(legend).toContain('Move Focus (Trans)');
  });

  test('never shows the QC panel when the URL is not a /quality_ page', { tag: '@logic' }, async ({ page }) => {
    await boot(page);
    await page.waitForTimeout(500);
    await expect(page.locator('#qc-panel')).toHaveCount(0);
    await expect(page.locator('#qc-style')).toHaveCount(0);
    await expect(page.locator('.qc-badge, .qc-active-score')).toHaveCount(0);
  });
});

// v1.5.5 C-PANELFIT (D12): a saved position that is now off-screen is pulled back on load and on resize.
test.describe('QC panel stays on-screen', { tag: '@layout' }, () => {
  const seedOffScreen = (page) => page.addInitScript(() =>
    localStorage.setItem('trans-tool:nova-qc-pos-v1', JSON.stringify({ left: 99999, top: 99999 })));
  const expectInside = async (page) => {
    const box = await page.locator('#qc-panel').boundingBox();
    const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.w);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.h);
  };

  test('is pulled back on-screen if its saved position is now off it, on load and on window resize', async ({ page }) => {
    // The fixture's panel is ~880px tall, taller than the default 800px viewport, so use a viewport it fits in.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await seedOffScreen(page);
    await bootQC(page);
    await expectInside(page);
    // Move it low and to the right, then shrink the viewport so that spot falls off-screen.
    await page.evaluate(() => { const p = document.getElementById('qc-panel'); p.style.left = '600px'; p.style.top = '200px'; });
    await page.setViewportSize({ width: 1000, height: 960 });
    await expect.poll(async () => {
      const b = await page.locator('#qc-panel').boundingBox();
      return b.x + b.width <= await page.evaluate(() => window.innerWidth)
        && b.y + b.height <= await page.evaluate(() => window.innerHeight);
    }).toBe(true);
    await expectInside(page);
  });

  test('the clamp never sets an inline width or height on the panel', async ({ page }) => {
    await seedOffScreen(page);
    await bootQC(page);
    await page.setViewportSize({ width: 800, height: 600 });
    // The panel's own template sets width:min(640px, 96vw) (a responsive width, not a pixel size); the clamp must leave it
    // alone and must not add a height.
    expect(await page.locator('#qc-panel').evaluate((el) => el.style.width)).toBe('min(640px, 96vw)');
    expect(await page.locator('#qc-panel').evaluate((el) => el.style.height)).toBe('');
  });
});

test.describe('tab round trip', { tag: '@logic' }, () => {
  test.beforeEach(async ({ page }) => { await bootQC(page); });

  test('keeps the selection and an edited score when the tabs make a round trip', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, 4);
    await page.keyboard.press('c');
    await page.keyboard.press('3');
    await expectScore(page, 4, 'Confusing / Task input issue');

    await clickTab(page, 1);
    await expectScore(page, 4, '2 Points / Accuracy');
    await expect(page.locator(`${remarkMod(4)} textarea`)).toHaveValue('Lorem a2 four');
    await expectSelected(page, 4);

    await clickTab(page, 0);
    await expectScore(page, 4, 'Confusing / Task input issue');
    await expectSelected(page, 4);
  });
});

test.describe('selector spans Score and Remark', { tag: '@logic' }, () => {
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
  // `message` names the step in a failure.
  const expectOutlines = (page, n, message) => expect.poll(() => outlined(page), message ? { message } : undefined)
    .toEqual({ score: [n], remark: [n] });

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

  // Steps: [label, key, n]. After each step both outlines are on Trans n, and only there.
  const arrowSteps = [
    ['at boot Trans1 is selected', null, 1],
    ['ArrowRight toggles to the right column', 'ArrowRight', 4],
    ['ArrowLeft toggles back to the left column', 'ArrowLeft', 1],
    ['ArrowDown reaches Trans2, whose Remarks is spelled "Trans 2 Remarks"', 'ArrowDown', 2],
    ['ArrowDown skips the empty Trans3', 'ArrowDown', 4],
    ['ArrowUp skips back over the empty Trans3', 'ArrowUp', 2],
    ['ArrowRight returns to the right column\'s last slot', 'ArrowRight', 4],
    ['ArrowLeft returns to the left column\'s last slot', 'ArrowLeft', 2],
  ];
  test('the Score and Remarks outlines move together to each translation the arrow keys select', async ({ page }) => {
    for (const [label, key, n] of arrowSteps) {
      if (key) await page.keyboard.press(key);
      await expectOutlines(page, n, `[${label}] both outlines should be on Trans${n}`);
    }
  });

  // The same walk with WASD in place of the arrows (aliases since v1.5.5).
  const wasdSteps = [
    ['at boot Trans1 is selected', null, 1],
    ['D toggles to the right column', 'd', 4],
    ['A toggles back to the left column', 'a', 1],
    ['S reaches Trans2, whose Remarks is spelled "Trans 2 Remarks"', 's', 2],
    ['S skips the empty Trans3', 's', 4],
    ['W skips back over the empty Trans3', 'w', 2],
    ['D returns to the right column\'s last slot', 'd', 4],
    ['A returns to the left column\'s last slot', 'a', 2],
  ];
  test('the Score and Remarks outlines move together to each translation the WASD keys select', async ({ page }) => {
    for (const [label, key, n] of wasdSteps) {
      if (key) await page.keyboard.press(key);
      await expectOutlines(page, n, `[${label}] both outlines should be on Trans${n}`);
    }
  });

  test('keeps the badge between the Score control and the Remarks when Z swaps a score', async ({ page }) => {
    expect(await domOrder(page, 1)).toEqual(['control', 'badge', 'remarks']);
    await page.keyboard.press('z');
    await expect(page.locator(`${scoreMod(1)} .qc-badge`)).toHaveClass(/qc-adopted/);
    await expectScore(page, 1, '3 Points');
    expect(await domOrder(page, 1)).toEqual(['control', 'badge', 'remarks']);
  });

  test('restores both outlines and keeps one badge when the platform replaces the Score host', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    await expectOutlines(page, 2);
    await page.evaluate(() => {
      window.__oldHost = document.querySelector('.qc-active-score');
      window.__fixture.rerenderScoreHost(2);
    });
    await expectOutlines(page, 2);
    expect(await page.evaluate(() => window.__oldHost.isConnected), 'the old Score host was replaced').toBe(false);
    await expect(page.locator(`${scoreMod(2)} .qc-badge`)).toHaveCount(1);
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
