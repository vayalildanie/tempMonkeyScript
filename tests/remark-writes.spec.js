// Remark Composer (src/remark-composer.js) writes: where typing, chips and
// Clear land, reverse sync from NOVA's own field, quoting with Q (quotable
// sources and separators), Escape, and the likely-remark summary.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { ALL_EMPTY, setScores } = require('./helpers/scores');
const {
  setRemark, remarksValues, expectRemarks, expectTarget,
  selectTrans, makeSelection, edit, blur, openComposer,
} = require('./helpers/remarks');

// Fixture facts: Trans1, 2, 4-7 are populated; Trans3's text is empty. The
// per-translation Remarks modules are TransN Remarks, except Trans2's, which
// the real capture spells "Trans 2 Remarks".

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expect(page.locator('#rmd-popover')).toBeAttached();
});

test.describe('writes', { tag: '@logic' }, () => {
  test('typing and chips write only into the target when the target switches', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await openComposer(page);
    await expectTarget(page, 2);
    await edit(page).click();
    await page.keyboard.type('hello');
    await expectRemarks(page, { 1: '', 2: 'hello', 3: '', 4: '', 5: '' });

    await blur(page);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue(''); // reloaded from the new target, not carried over
    await page.locator('.rmd-chip[data-chip="Strange"]').click();
    await expectRemarks(page, { 1: '', 2: 'hello', 4: 'Strange', 5: '' });

    await blur(page);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 2);
    await expect(edit(page)).toHaveValue('hello');
    await page.locator('.rmd-chip[data-chip="Natural"]').click();
    await expectRemarks(page, { 1: '', 2: 'hello, Natural', 4: 'Strange', 5: '' });
  });

  test('typing still writes into the target when the platform replaces its textarea', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await openComposer(page);
    await expectTarget(page, 2);
    await page.evaluate(() => {
      const mod = document.querySelector('[data-module-name="Trans 2 Remarks"]');
      const old = mod.querySelector('textarea');
      const fresh = document.createElement('textarea');
      fresh.className = old.className;
      old.replaceWith(fresh);
    });
    await edit(page).click();
    await page.keyboard.type('after swap');
    await expectRemarks(page, { 1: '', 2: 'after swap', 4: '' });
  });

  test('a page-side edit is mirrored into #rmd-edit and selects its translation when the composer is open', async ({ page }) => {
    const multiline = 'other\n"quoted" <text>'; // a paste-like value: newline, quotes and angle brackets
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await openComposer(page);
    await expectTarget(page, 2);
    await setRemark(page, 2, 'typed on page');
    await expect(edit(page)).toHaveValue('typed on page');
    await setRemark(page, 4, multiline);
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue(multiline);
    await expectRemarks(page, { 2: 'typed on page', 4: multiline });
  });

  test('Clear empties only the target when other translations have remarks', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await setRemark(page, 2, 'two');
    await setRemark(page, 4, 'four');
    await openComposer(page);
    await expectTarget(page, 2);
    await expect(edit(page)).toHaveValue('two');
    await page.locator('#rmd-clear-btn').click();
    await expectRemarks(page, { 2: '', 4: 'four' });
    await expect(edit(page)).toHaveValue('');
  });

  test('no Trans reference highlight appears when the remark text says "Trans 2"', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await edit(page).click();
    await page.keyboard.type('Trans 2 is odd');
    await expect(page.locator('#rmd-edit-bg')).toContainText('Trans 2 is odd');
    expect(await page.locator('.rmd-tref').count()).toBe(0);
  });
});

test.describe('quoting', { tag: '@logic' }, () => {
  test('Q appends the quote to the target and keeps it when the composer is open', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' });
    await openComposer(page);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 5);
    const text = await selectTrans(page, 2);
    await page.keyboard.press('q');
    await expectRemarks(page, { 1: '', 2: '', 4: '', 5: `"${text}"` });
    await expectTarget(page, 5);
  });

  test('Q puts the caret at the end of #rmd-edit when nothing is selected', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await setRemark(page, 1, 'seed text');
    await page.keyboard.press('q'); // composer closed: opens first
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expectTarget(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const el = document.activeElement;
      return el && el.id === 'rmd-edit' ? [el.selectionStart, el.selectionEnd, el.value.length] : null;
    })).toEqual([9, 9, 9]);
  });

  test('a click on a translation title writes nothing and keeps the target', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2);
    // The popover may sit over the title, so deliver the whole click gesture to
    // the title element directly.
    await page.evaluate(() => {
      const title = document.querySelector('[data-module-name="Trans5"] .title-text');
      ['mousedown', 'mouseup', 'click'].forEach((type) => {
        title.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      });
    });
    await expectRemarks(page, { 1: '', 2: '', 4: '', 5: '' });
    await expect(edit(page)).toHaveValue('');
    await expectTarget(page, 2);
    expect(await page.locator('.rmd-clickable-title').count()).toBe(0);
  });

  // Rows: [label, selection key, accepted?]. An accepted quote is exactly
  // "<selected text>" with no source prefix; a refused one writes nothing.
  const sources = [
    ['a whole translation', 'whole', true],
    ['part of a translation', 'part', true],
    ['a whole translation ending on the parent of .preview-content', 'parent-boundary', true],
    ['the Note body text', 'note-body', true, 'Note body sed ut perspiciatis unde omnis iste natus error.'],
    ['the Note heading and body together', 'note-heading-and-body', true, 'Note heading lorem titleNote body sed ut perspiciatis unde omnis iste natus error.'],
    ['text wrapped in an annotation tag', 'tagged', true],
    ['from Trans4 into Trans5', 'two-translations', false],
    ['the Note body running into the Collapse control', 'note-into-collapse', false],
    ['the Note heading through the picture list', 'note-through-pictures', false],
    ['the Collapse control alone', 'collapse-only', false],
    ['the Note plus Trans1', 'note-and-translation', false],
    ['Context-EN plus Trans1', 'context-and-translation', false],
    ['Context-EN only', 'context-only', false],
    ['a title plus its translation text', 'title-and-text', false],
    ['the whole page (select all)', 'select-all', false],
  ];
  for (const [label, key, accepted, exact] of sources) {
    test(`Q ${accepted ? 'writes "text"' : 'refuses and writes nothing'} when the selection is ${label}`, async ({ page }) => {
      await setScores(page, ALL_EMPTY);
      await openComposer(page);
      await expectTarget(page, 1);
      const raw = await makeSelection(page, key);
      await page.keyboard.press('q');
      if (accepted) {
        const expected = key === 'tagged' ? 'Tagged words here' : raw.trim();
        await expectRemarks(page, { 1: `"${expected}"`, 2: '', 4: '', 5: '' });
        await expect(edit(page)).toHaveValue(`"${expected}"`);
        // The token is the page's own text and nothing from the Note's chrome.
        const token = (await remarksValues(page))[1];
        expect(token).not.toMatch(/Collapse|Pictures|Small|Medium|Large|cover/);
        if (exact) expect(token.replace(/\s+/g, '')).toBe(`"${exact}"`.replace(/\s+/g, ''));
      } else {
        await expect(page.locator('#rmd-hint')).toContainText('one translation or the Note');
        await expectRemarks(page, { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' });
        await expect(edit(page)).toHaveValue('');
        // A refusal leaves the selection in place so it can be adjusted.
        expect(await page.evaluate(() => window.getSelection().toString())).not.toBe('');
      }
      await expectTarget(page, 1);
    });
  }

  test.describe('separators', () => {
    const chipText = (page) => page.locator('#rmd-popover .rmd-chip').first().getAttribute('data-chip');

    test.beforeEach(async ({ page }) => {
      await setScores(page, ALL_EMPTY);
    });

    test('a chip is joined with ": " when it follows a quote', async ({ page }) => {
      await openComposer(page);
      const q = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await blur(page);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await expect(edit(page)).toHaveValue(`"${q}": ${chip}`);
    });

    test('a quote is joined with two spaces when it follows a chip', async ({ page }) => {
      await openComposer(page);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await blur(page);
      const q = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await expect(edit(page)).toHaveValue(`${chip}  "${q}"`);
    });

    test('a quote is joined with two spaces when it follows a quote', async ({ page }) => {
      await openComposer(page);
      const a = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await blur(page);
      const b = (await makeSelection(page, 'note-body')).trim();
      await page.keyboard.press('q');
      await expect(edit(page)).toHaveValue(`"${a}"  "${b}"`);
    });

    test('a chip is joined with ": " when it follows a pre-v1.5.3 Trans N "x" quote', async ({ page }) => {
      await setRemark(page, 1, 'Trans 2 "x"');
      await openComposer(page);
      await expectTarget(page, 1);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await expect(edit(page)).toHaveValue(`Trans 2 "x": ${chip}`);
    });
  });
});

test.describe('escape', { tag: '@logic' }, () => {
  const focusedId = (page) => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    const mod = el.closest && el.closest('[data-module-name]');
    return el.id || (mod && mod.getAttribute('data-module-name')) || el.tagName;
  });

  test('the first Escape blurs and keeps the window, text and target when #rmd-edit has focus', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await edit(page).click();
    await page.keyboard.type('draft');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expect.poll(() => focusedId(page)).toBe('BODY');
    await expect(edit(page)).toHaveValue('draft');
    await expectRemarks(page, { 1: 'draft' });
    await expectTarget(page, 1);
  });

  test('the first Escape blurs and keeps the window when a NOVA Remarks textarea, including Trans 2 Remarks, has focus', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    const ta = page.locator('[data-module-name="Trans 2 Remarks"] textarea').first();
    await ta.click();
    await expectTarget(page, 2);
    await page.keyboard.type('typed in page');
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expect.poll(() => focusedId(page)).toBe('BODY');
    await expectRemarks(page, { 2: 'typed in page' });
    await expectTarget(page, 2);
  });

  test('Escape closes the window when pressed a second time, or at once when a button has focus', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await edit(page).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();

    await openComposer(page);
    await page.locator('#fx-submit').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
  });

  test('the first Escape closes the window when the header remark bar (an unrelated textarea) has focus', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await page.locator('#form_item_remark').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
  });

  test('Escape is left to the IME when it is part of a composition', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await edit(page).click();
    const prevented = await page.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true });
      document.activeElement.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page.locator('#rmd-popover')).toBeVisible();
    expect(await focusedId(page)).toBe('rmd-edit');
  });
});

test.describe('likely-remark summary', { tag: '@logic' }, () => {
  test('the summary lists 2 Points and Confusing, not 3 Points or unscored, below the edit box when the composer opens', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '2 Points / Grammar', 4: 'Confusing', 5: '2 Points' });
    await openComposer(page);
    const likely = page.locator('#rmd-likely');
    await expect(likely).toHaveText('Likely need remarks: Trans2 (2 Points), Trans4 (Confusing), Trans5 (2 Points)');
    const above = await edit(page).boundingBox();
    const below = await likely.boundingBox();
    expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);
  });

  test('the summary updates when a score changes and says so when nothing needs remarks', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 2: '2 Points' });
    await openComposer(page);
    await expect(page.locator('#rmd-likely')).toHaveText('Likely need remarks: Trans2 (2 Points)');
    await setScores(page, { 2: '3 Points', 6: 'Confusing' });
    await expect(page.locator('#rmd-likely')).toHaveText('Likely need remarks: Trans6 (Confusing)');
    await setScores(page, { 6: '3 Points' });
    await expect(page.locator('#rmd-likely')).toHaveText('No translations need remarks');
  });

  test('the target ignores the summary and the hint line is empty when the composer opens', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 4: 'Confusing' });
    await openComposer(page);
    await expectTarget(page, 2);
    await expect(page.locator('#rmd-hint')).toHaveText('');
    await edit(page).click();
    await page.keyboard.type('ok');
    await expectRemarks(page, { 2: 'ok', 4: '' });
  });
});
