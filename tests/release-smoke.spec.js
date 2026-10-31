// Release smoke: the version markers agree, the legend and the Remark Options
// popover say what this release ships, and the panels lay out inside the
// viewport. The screenshots land in test-results/ for a visual check.
const { test, expect } = require('./helpers/test');
const fs = require('fs');
const path = require('path');
const { boot: bootFixture } = require('./helpers/fixture');

const root = path.resolve(__dirname, '..');
const VERSION = '1.5.4';
const shot = (name) => path.join(root, 'test-results', `${name}-v${VERSION}.png`);

async function boot(page) {
  await bootFixture(page);
  await expect(page.locator('#tl-score-panel')).toBeVisible();
}

test.describe('release markers', { tag: '@contract' }, () => {
  test(`the @version header, TL.SCRIPT_VERSION and the panel head all read ${VERSION}`, async ({ page }) => {
    const entry = fs.readFileSync(path.join(root, 'annotation-scoring-shortcuts.user.js'), 'utf8');
    expect(entry).toMatch(new RegExp(`// @version {6}${VERSION.replace(/\./g, '\\.')}\\r?\\n`));
    expect(entry).toContain(`TL.SCRIPT_VERSION = 'v${VERSION}'`);
    // The fs assertions above are the real check; boot.js reads the same file, so the badge only confirms wiring.
    await boot(page);
    await expect(page.locator('#tl-score-head')).toContainText(`v${VERSION}`);
  });
});

test.describe('legend content', { tag: '@layout' }, () => {
  test('the legend lists the remark and checker keys, Q before O, with no help paragraph', async ({ page }) => {
    await boot(page);
    await expect(page.locator('#tl-score-help')).toHaveCount(0);

    const entries = await page.$$eval('#tl-score-body > span', (spans) =>
      spans.map((s) => ({
        keys: [...s.querySelectorAll('.tl-kbd')].map((k) => k.textContent.trim()),
        text: s.textContent.replace(/\s+/g, ' ').trim(),
      })));
    const find = (key) => entries.findIndex((e) => e.keys.includes(key));
    const label = (key) => entries[find(key)].text;

    expect(label('Q')).toContain('Quote/Edit Remark');
    expect(label('O')).toContain('Remark Options');
    expect(label('Z')).toContain('Cycle Checker');
    expect(label('Enter')).toContain('Run Checker');
    expect(label('Esc')).toContain('Back');
    expect(find('Q')).toBeGreaterThanOrEqual(0);
    expect(find('Q')).toBeLessThan(find('O'));

    const panelText = (await page.locator('#tl-score-panel').innerText()).toLowerCase();
    for (const gone of ['arrow keys pick', 'outside a text box', 'jumps back to trans1', 'click a chip']) {
      expect(panelText).not.toContain(gone);
    }
  });

  test('the Remark Options popover shows no static help text when it opens', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('o');
    const popover = page.locator('#rmd-popover');
    await expect(popover).toBeVisible();
    await expect(page.locator('#rmd-hint')).toHaveText('');
    const text = (await popover.innerText()).toLowerCase();
    for (const phrase of ['click a translation', 'title', 'enter runs it', 'arrow keys', 'remarks box']) {
      expect(text).not.toContain(phrase);
    }
  });
});

function panelMetrics(page) {
  return page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const panel = document.getElementById('tl-score-panel');
    const p = box('#tl-score-panel');
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      panel: { left: p.left, right: p.right, bottom: p.bottom, height: p.height },
      bodyBottom: box('#tl-score-body').bottom,
      statusBottom: box('#tl-score-status').bottom,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
    };
  });
}

test.describe('panel layout', { tag: '@layout' }, () => {
  test('the check badge hugs the right of the Remark Options header when the popover is resized', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('o');
    await expect(page.locator('#rmd-popover')).toBeVisible();

    const measure = () => page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const badge = r('#rmd-check-badge');
      const settings = r('#rmd-settings-btn');
      const title = r('#rmd-head .rmd-title');
      const head = r('#rmd-head');
      return { badgeLeft: badge.left, badgeRight: badge.right, settingsLeft: settings.left, titleRight: title.right, headRight: head.right };
    });

    const fits = await page.evaluate(() => {
      const pop = document.getElementById('rmd-popover').getBoundingClientRect();
      const close = document.getElementById('rmd-close-btn').getBoundingClientRect();
      return { popRight: pop.right, closeRight: close.right };
    });
    expect(fits.closeRight).toBeLessThanOrEqual(fits.popRight);

    const narrow = await measure();
    expect(narrow.settingsLeft - narrow.badgeRight).toBeGreaterThanOrEqual(0);
    expect(narrow.settingsLeft - narrow.badgeRight).toBeLessThanOrEqual(12);

    await page.evaluate(() => { document.getElementById('rmd-popover').style.width = '760px'; });
    const wide = await measure();
    expect(wide.settingsLeft - wide.badgeRight).toBeGreaterThanOrEqual(0);
    expect(wide.settingsLeft - wide.badgeRight).toBeLessThanOrEqual(12);
    expect(wide.badgeLeft).toBeGreaterThan(narrow.badgeLeft + 100);
    expect(wide.badgeLeft - wide.titleRight).toBeGreaterThan(100);
  });

  // One row per viewport. Every row checks that the scoring panel stays inside
  // the viewport; `check` adds what that layout must also do, `shots` keeps
  // screenshots for a visual check.
  const layouts = [
    {
      title: 'the panel and its whole legend fit inside the viewport when the viewport is the default 1280x800',
      check: async (page, m) => {
        expect(m.bodyBottom, 'the legend ends inside the panel').toBeLessThanOrEqual(m.panel.bottom);
        expect(m.statusBottom, 'the status line ends inside the viewport').toBeLessThanOrEqual(m.vh);
        await expect(page.locator('#tl-score-status')).toBeVisible();
      },
      shots: async (page) => {
        await page.screenshot({ path: shot('scoring-panel') });
        await page.keyboard.press('o');
        await expect(page.locator('#rmd-popover')).toBeVisible();
        await page.screenshot({ path: shot('remark-options') });
      },
    },
    {
      title: 'the panel stays inside the viewport and the legend wraps or scrolls when the panel is 260px wide',
      panelWidth: 260,
      check: async (page, m) => {
        await expect(page.locator('#tl-score-status')).toBeVisible();
        // Either the whole panel fits, or it scrolls (max-height engaged).
        expect(m.statusBottom <= m.panel.bottom || m.scrollHeight > m.clientHeight, 'the legend fits or the panel scrolls').toBe(true);
      },
      shots: async (page) => { await page.screenshot({ path: shot('scoring-panel-narrow') }); },
    },
    {
      title: 'the panel is capped and scrolls when the viewport is 300px high',
      viewport: { width: 1280, height: 300 },
      panelWidth: 260,
      check: async (page, m) => {
        expect(m.scrollHeight, 'the capped panel scrolls').toBeGreaterThan(m.clientHeight);
      },
    },
  ];
  for (const row of layouts) {
    test(row.title, async ({ page }) => {
      if (row.viewport) await page.setViewportSize(row.viewport);
      await boot(page);
      if (row.panelWidth) {
        await page.evaluate((w) => { document.getElementById('tl-score-panel').style.width = `${w}px`; }, row.panelWidth);
      }
      const m = await panelMetrics(page);
      expect(m.panel.bottom, 'the panel ends inside the viewport').toBeLessThanOrEqual(m.vh);
      expect(m.panel.left, 'the panel starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect(m.panel.right, 'the panel ends left of the viewport edge').toBeLessThanOrEqual(m.vw);
      await row.check(page, m);
      if (row.shots) await row.shots(page);
    });
  }
});
