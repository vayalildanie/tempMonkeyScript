// The test harness itself: the facts about tests/fixtures/annotation.html that
// other specs rely on, the module boot, and Utils.clickEl against the
// fixture's cascader simulator.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');

test.describe('annotation fixture', { tag: '@contract' }, () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
  });

  test('the fixture has seven translations, only Trans3 empty, and six distinct texts', async ({ page }) => {
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
  });

  test('Trans2 starts as a closed bare 2 Points with a visible clear control', async ({ page }) => {
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
  });

  test('booting the modules shows the scoring panel and sets TL.SCRIPT_VERSION', async ({ page }) => {
    await expect(page.locator('#tl-score-panel')).toBeVisible();
    const version = await page.evaluate(() => window.TL && window.TL.SCRIPT_VERSION);
    expect(version).toBeTruthy();
  });

  test('Utils.clickEl opens a cascader and picks 3 Points when it clicks the selector and then the item', async ({ page }) => {
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
});
