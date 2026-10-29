const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const root = path.resolve(__dirname, '..');
const fixtureUrl = 'file://' + path.resolve(__dirname, 'fixtures/annotation.html').replace(/\\/g, '/');
const VERSION = '1.5.2';

async function boot(page) {
  await page.goto(fixtureUrl);
  await bootModules(page);
  await expect(page.locator('#tl-score-panel')).toBeVisible();
}

test('legend lists the remark and checker keys, Q before O, with no help paragraph', async ({ page }) => {
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

test('Remark Options popover carries no static help text', async ({ page }) => {
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

test('check badge hugs the right of the Remark Options header while resizing', async ({ page }) => {
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

test(`version markers agree on ${VERSION}`, async ({ page }) => {
  const entry = fs.readFileSync(path.join(root, 'annotation-scoring-shortcuts.user.js'), 'utf8');
  expect(entry).toMatch(new RegExp(`// @version {6}${VERSION.replace(/\./g, '\\.')}\\r?\\n`));
  expect(entry).toContain(`TL.SCRIPT_VERSION = 'v${VERSION}'`);
  // The fs assertions above are the real check; boot.js reads the same file, so the badge only confirms wiring.
  await boot(page);
  await expect(page.locator('#tl-score-head')).toContainText(`v${VERSION}`);
});

function panelMetrics(page) {
  return page.evaluate(() => {
    const box = (sel) => document.querySelector(sel).getBoundingClientRect();
    const panel = document.getElementById('tl-score-panel');
    const p = box('#tl-score-panel');
    return {
      vh: window.innerHeight,
      panel: { left: p.left, right: p.right, bottom: p.bottom, height: p.height },
      bodyBottom: box('#tl-score-body').bottom,
      statusBottom: box('#tl-score-status').bottom,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
    };
  });
}

test('legend fits inside the panel and the viewport; screenshots', async ({ page }) => {
  await boot(page);
  const m = await panelMetrics(page);
  expect(m.bodyBottom).toBeLessThanOrEqual(m.panel.bottom);
  expect(m.statusBottom).toBeLessThanOrEqual(m.vh);
  expect(m.panel.bottom).toBeLessThanOrEqual(m.vh);
  await expect(page.locator('#tl-score-status')).toBeVisible();

  await page.screenshot({ path: path.join(root, 'test-results', `scoring-panel-v${VERSION}.png`) });

  await page.keyboard.press('o');
  await expect(page.locator('#rmd-popover')).toBeVisible();
  await page.screenshot({ path: path.join(root, 'test-results', `remark-options-v${VERSION}.png`) });
});

test('narrow panel stays inside the viewport and the legend wraps', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { document.getElementById('tl-score-panel').style.width = '260px'; });
  const m = await panelMetrics(page);
  expect(m.panel.bottom).toBeLessThanOrEqual(m.vh);
  expect(m.panel.left).toBeGreaterThanOrEqual(0);
  expect(m.panel.right).toBeLessThanOrEqual(1280);
  await expect(page.locator('#tl-score-status')).toBeVisible();
  // Either the whole panel fits, or it scrolls (max-height engaged).
  expect(m.statusBottom <= m.panel.bottom || m.scrollHeight > m.clientHeight).toBe(true);
  await page.screenshot({ path: path.join(root, 'test-results', `scoring-panel-narrow-v${VERSION}.png`) });
});

test('a short viewport caps the panel and makes it scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 300 });
  await boot(page);
  await page.evaluate(() => { document.getElementById('tl-score-panel').style.width = '260px'; });
  const m = await panelMetrics(page);
  expect(m.panel.bottom).toBeLessThanOrEqual(m.vh);
  expect(m.scrollHeight).toBeGreaterThan(m.clientHeight);
});
