// Remark Composer (src/remark-composer.js) mouse selection and direct editing:
// clicks and input in NOVA's own Remarks fields select the target, without
// writing, and never disturb the field's own caret or selection.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
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
