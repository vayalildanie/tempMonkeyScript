const { test, expect } = require('@playwright/test');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const fixtureUrl = 'file://' + path.resolve(__dirname, 'fixtures/annotation.html').replace(/\\/g, '/');

test('boots the annotation fixture with an empty Trans3, a closed 2 Points score, and a visible scoring panel', async ({ page }) => {
  await page.goto(fixtureUrl);
  await bootModules(page);

  const texts = await page.locator('[data-module-name^="Trans"] .preview-content').evaluateAll((nodes) => {
    const byName = new Map();
    for (const node of nodes) {
      const mod = node.closest('[data-module-name]');
      const name = mod ? mod.getAttribute('data-module-name') : '';
      if (/^Trans\d+$/.test(name) && !byName.has(name)) byName.set(name, node.textContent.trim());
    }
    return [1, 2, 3, 4, 5, 6, 7].map((n) => byName.get(`Trans${n}`) || '');
  });

  expect(texts).toHaveLength(7);
  expect(texts[2]).toBe('');
  for (const text of texts.filter((_, i) => i !== 2)) expect(text.length).toBeGreaterThan(0);
  expect(new Set(texts.filter(Boolean)).size).toBe(6);

  const trans2 = await page.locator('[data-module-name="Trans2 Score"] .ant-select-selection-item').innerText();
  expect(trans2.trim()).toBe('2 Points');
  await expect(page.locator('[data-module-name="Trans2 Score"] input')).toHaveAttribute('aria-expanded', 'false');
  const clearBox = await page.locator('[data-module-name="Trans2 Score"] .ant-select-clear').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, shown: getComputedStyle(el).display !== 'none' };
  });
  expect(clearBox.shown).toBe(true);
  expect(clearBox.w).toBeGreaterThan(0);
  expect(clearBox.h).toBeGreaterThan(0);

  await expect(page.locator('#tl-score-panel')).toBeVisible();
  const version = await page.evaluate(() => window.TL && window.TL.SCRIPT_VERSION);
  expect(version).toBeTruthy();
});

test('Utils.clickEl opens a cascader and selects 3 Points', async ({ page }) => {
  await page.goto(fixtureUrl);
  await bootModules(page);

  const opened = await page.evaluate(() => {
    const mod = document.querySelector('[data-module-name="Trans1 Score"]');
    const selector = mod.querySelector('.ant-select-selector');
    window.TL.Utils.clickEl(selector);
    const input = mod.querySelector('input');
    const item = document.querySelector(
      '[data-module-name="Trans1 Score"] li.ant-cascader-menu-item[data-path-key="3 Points"] .ant-cascader-menu-item-content'
    );
    return {
      expanded: input && input.getAttribute('aria-expanded'),
      visible: !!(item && item.getClientRects().length),
    };
  });
  expect(opened).toEqual({ expanded: 'true', visible: true });

  const selected = await page.evaluate(() => {
    const content = document.querySelector(
      '[data-module-name="Trans1 Score"] li.ant-cascader-menu-item[data-path-key="3 Points"] .ant-cascader-menu-item-content'
    );
    window.TL.Utils.clickEl(content);
    const mod = document.querySelector('[data-module-name="Trans1 Score"]');
    const item = mod.querySelector('.ant-select-selection-item');
    return {
      value: item ? item.textContent.trim() : '',
      expanded: mod.querySelector('input').getAttribute('aria-expanded'),
    };
  });
  expect(selected).toEqual({ value: '3 Points', expanded: 'false' });
});
