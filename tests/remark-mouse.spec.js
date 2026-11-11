// Remark Composer (src/remark-composer.js) mouse selection and direct editing:
// clicks and input in NOVA's own Remarks fields select the target, without
// writing, and never disturb the field's own caret or selection.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { bootModules } = require('./helpers/boot');
const { ALL_EMPTY, setScores } = require('./helpers/scores');
const {
  setRemark, expectRemarks, activeTargets, expectTarget,
  remarkArea, remarkField, keepComposerClear, edit, openComposer,
} = require('./helpers/remarks');

// Fixture facts: Trans1, 2, 4-7 are populated; Trans3's text is empty. The
// per-translation Remarks modules are TransN Remarks, except Trans2's, which
// the real capture spells "Trans 2 Remarks".

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expect(page.locator('#rmd-popover')).toBeAttached();
});

test.describe('mouse selection and direct editing', { tag: '@logic' }, () => {
  // Keep the floating composer away from the right-column native click targets.
  test.beforeEach(async ({ page }) => {
    await keepComposerClear(page);
  });
  const field = remarkField;
  const area = remarkArea;

  test('a click on a Remarks module loads its text without writing, and chips and Clear then change only that module', async ({ page }) => {
    await setRemark(page, 1, 'one');
    await setRemark(page, 4, 'four');
    await openComposer(page);
    await area(page, 4).dispatchEvent('click');
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue('four');
    await page.locator('.rmd-chip[data-chip="Natural"]').click();
    await expectRemarks(page, { 1: 'one', 4: 'four, Natural' });
    await page.locator('#rmd-clear-btn').click();
    await expectRemarks(page, { 1: 'one', 4: '' });
    await area(page, 1).dispatchEvent('click');
    await expect(edit(page)).toHaveValue('one');
  });

  test('the target stays and no text leaks when the Remarks of the empty Trans3 is clicked or edited', async ({ page }) => {
    await openComposer(page);
    await area(page, 3).dispatchEvent('click');
    await setRemark(page, 3, 'ineligible');
    await expectTarget(page, 1);
    await expect(edit(page)).toHaveValue('');
    await expectRemarks(page, { 3: 'ineligible', 1: '' });
  });

  test('a click on the already-targeted Remarks module keeps the text selected in its textarea', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' });
    await setRemark(page, 4, 'four');
    await openComposer(page);
    await field(page, 4).click();
    await field(page, 4).evaluate((ta) => ta.setSelectionRange(1, 3));
    await area(page, 4).dispatchEvent('click');
    expect(await field(page, 4).evaluate((ta) => [ta.selectionStart, ta.selectionEnd])).toEqual([1, 3]);
    await expectTarget(page, 4);
  });

  test('the composer opens on its initial target when Remarks were clicked or edited while it was closed', async ({ page }) => {
    await field(page, 4).click();
    await setRemark(page, 4, 'closed');
    expect(await activeTargets(page)).toEqual([]);
    await field(page, 4).evaluate((ta) => ta.blur());
    await openComposer(page);
    await expectTarget(page, 1);
    await expect(edit(page)).toHaveValue('');
  });

  test('a replaced Remarks module stays clickable and syncs both ways', async ({ page }) => {
    await openComposer(page);
    await area(page, 4).evaluate((mod) => mod.replaceWith(mod.cloneNode(true)));
    await field(page, 4).click();
    await expectTarget(page, 4);
    await edit(page).fill('proxy');
    await expectRemarks(page, { 4: 'proxy', 1: '' });
    await setRemark(page, 4, 'native');
    await expect(edit(page)).toHaveValue('native');
  });

  test('clicks on the composer or source text keep the target, and column memory learns a click-selected target', async ({ page }) => {
    await openComposer(page);
    await area(page, 5).dispatchEvent('click');
    await page.locator('#rmd-head .rmd-title').click();
    await page.locator('[data-module-name="Trans1"] .preview-content').first().dispatchEvent('click');
    await expectTarget(page, 5);
    await page.keyboard.press('ArrowLeft');
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowRight');
    await expectTarget(page, 5);
  });

  test('"Trans 2 Remarks" is selected by an input even when its text equals #rmd-edit', async ({ page }) => {
    await setRemark(page, 1, 'same');
    await openComposer(page);
    await setRemark(page, 2, 'same');
    await expectTarget(page, 2);
    await edit(page).fill('two');
    await expectRemarks(page, { 1: 'same', 2: 'two' });
  });

  test('a Remarks module can be selected by click when every translation is empty', async ({ page }) => {
    await page.locator('[data-module-name^="Trans"] .preview-content').evaluateAll((els) => els.forEach((el) => { el.textContent = ''; }));
    await openComposer(page);
    await area(page, 3).dispatchEvent('click');
    await expectTarget(page, 3);
  });

  test('selecting by click fires no input event, and score clicks and right-clicks keep the target', async ({ page }) => {
    await openComposer(page);
    await page.evaluate(() => {
      window.nativeInputs = 0;
      document.addEventListener('input', () => window.nativeInputs++);
    });
    await area(page, 4).dispatchEvent('click');
    await expectTarget(page, 4);
    expect(await page.evaluate(() => window.nativeInputs)).toBe(0);
    await area(page, 5).dispatchEvent('click', { button: 2 });
    await page.locator('[data-module-name="Trans1 Score"] .ant-select-selector').first().dispatchEvent('click');
    await expectTarget(page, 4);
  });
});

test.describe('chip settings', { tag: '@logic' }, () => {
  const CHIP_KEY = 'trans-tool:nova-remark-chips';
  const SIZE_KEY = 'trans-tool:nova-remark-size-v1';
  const DEFAULT_HEADS = ['Fluency', 'Word Choice', 'Meaning', 'Mechanics', 'Positive'];
  // textContent, not innerText: the heads are upper-cased by CSS.
  const heads = (page) => page.locator('.rmd-chip-head').allTextContents().then((a) => a.map((t) => t.trim()));
  const stored = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
  const openSettings = async (page) => {
    await page.locator('#rmd-settings-btn').click();
    await expect(page.locator('#rmd-settings-overlay')).toBeVisible();
  };
  const reboot = async (page) => {
    await page.reload();
    await bootModules(page);
    await expect(page.locator('#rmd-popover')).toBeAttached();
  };

  test.beforeEach(async ({ page }) => {
    await openComposer(page);
  });

  test('Open then Cancel changes nothing', async ({ page }) => {
    await openSettings(page);
    await page.locator('.rmd-set-name').first().fill('Changed');
    await page.locator('.rmd-set-del-group').nth(1).click();
    await page.locator('#rmd-set-cancel').click();
    await expect(page.locator('#rmd-settings-overlay')).toHaveCount(0);
    expect(await heads(page)).toEqual(DEFAULT_HEADS);
    expect(await stored(page, CHIP_KEY)).toBeNull();
    await openSettings(page); // the buffer was thrown away, not kept
    await expect(page.locator('.rmd-set-name').first()).toHaveValue('Fluency');
    await expect(page.locator('.rmd-set-group')).toHaveCount(5);
  });

  test('Save persists a renamed group and an added chip, and they survive a reload', async ({ page }) => {
    await openSettings(page);
    await page.locator('.rmd-set-name').first().fill('Tone');
    await page.locator('.rmd-set-add-chip').first().click();
    await page.locator('.rmd-set-chip-text[data-gi="0"][data-ci="6"]').fill('Brand new chip');
    await page.locator('#rmd-set-save').click();
    await expect(page.locator('#rmd-settings-overlay')).toHaveCount(0);
    expect((await heads(page))[0]).toBe('Tone');
    await expect(page.locator('.rmd-chip[data-chip="Brand new chip"]')).toBeVisible();

    await reboot(page);
    await openComposer(page);
    expect((await heads(page))[0]).toBe('Tone');
    await expect(page.locator('.rmd-chip[data-chip="Brand new chip"]')).toBeVisible();
    expect(JSON.parse(await stored(page, CHIP_KEY)).groups[0].head).toBe('Tone');
  });

  test('deleting every named group and saving alerts and saves nothing', async ({ page }) => {
    const messages = [];
    page.on('dialog', (d) => { messages.push(d.message()); d.accept(); });
    await openSettings(page);
    for (let i = 0; i < 5; i++) await page.locator('.rmd-set-del-group').first().click();
    await expect(page.locator('.rmd-set-group')).toHaveCount(0);
    await page.locator('#rmd-set-save').click();
    await expect.poll(() => messages).toEqual(['Need at least 1 group with a name.']);
    await expect(page.locator('#rmd-settings-overlay')).toBeVisible(); // stays open
    expect(await stored(page, CHIP_KEY)).toBeNull();
    expect(await heads(page)).toEqual(DEFAULT_HEADS);
  });

  test('a group renamed to blank is dropped on Save', async ({ page }) => {
    await openSettings(page);
    await page.locator('.rmd-set-name').nth(2).fill('   ');
    await page.locator('#rmd-set-save').click();
    expect(await heads(page)).toEqual(['Fluency', 'Word Choice', 'Mechanics', 'Positive']);
  });

  test('the up and down buttons reorder groups, and the order is saved', async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('.rmd-set-up').first()).toBeDisabled();
    await expect(page.locator('.rmd-set-down').last()).toBeDisabled();
    await page.locator('.rmd-set-down').first().click(); // Fluency <-> Word Choice
    await page.locator('.rmd-set-up').nth(4).click();    // Positive <-> Mechanics
    await page.locator('#rmd-set-save').click();
    expect(await heads(page)).toEqual(['Word Choice', 'Fluency', 'Meaning', 'Positive', 'Mechanics']);
    expect(JSON.parse(await stored(page, CHIP_KEY)).groups.map((g) => g.head))
      .toEqual(['Word Choice', 'Fluency', 'Meaning', 'Positive', 'Mechanics']);
  });

  test('Reset restores the default chips on Save and the default window size at once', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openSettings(page);
    await page.locator('.rmd-set-name').first().fill('Tone');
    await page.locator('.rmd-set-del-group').nth(1).click();
    await page.locator('#rmd-set-save').click();
    expect((await heads(page))[0]).toBe('Tone');

    await page.evaluate(() => {
      const p = document.getElementById('rmd-popover');
      p.style.width = '520px';
      p.style.height = '500px';
    });
    await openSettings(page);
    await page.locator('#rmd-set-reset').click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('trans-tool:nova-remark-size-v1')))).toEqual({ w: 380, h: 420 });
    expect(await page.locator('#rmd-popover').evaluate((p) => [p.style.width, p.style.height])).toEqual(['380px', '420px']);
    await page.locator('#rmd-set-save').click();
    expect(await heads(page)).toEqual(DEFAULT_HEADS);
  });

  test('Esc closes Settings without closing Remark Options', async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-settings-overlay')).toHaveCount(0);
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expect(page.locator('body')).toHaveClass(/rmd-active/);
  });
});
