// Remark Composer (src/remark-composer.js) target selection: the initial
// target, the arrow keys and the one-shot first-ArrowUp jump, the native caret
// keys inside remark boxes, the target highlight, and what a row change does
// to the target while the composer is open.
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { POPULATED, ALL_EMPTY, setScores } = require('./helpers/scores');
const {
  setRemark, expectRemarks, activeTargets, expectTarget,
  remarkField, keepComposerClear, selectTrans, edit, blur, openComposer,
} = require('./helpers/remarks');

// Fixture facts: Trans1, 2, 4-7 are populated; Trans3's text is empty. The
// per-translation Remarks modules are TransN Remarks, except Trans2's, which
// the real capture spells "Trans 2 Remarks".

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expect(page.locator('#rmd-popover')).toBeAttached();
});

test.describe('initial target', { tag: '@logic' }, () => {
  const cases = [
    ['Trans1 is 3 Points and Trans2 is unscored', { 1: '3 Points' }, 2],
    ['Trans1 is 3 Points and Trans2 is a bare 2 Points', { 1: '3 Points', 2: '2 Points' }, 2],
    ['Trans1 is 3 Points and Trans2 is a fully labeled 2 Points', { 1: '3 Points', 2: '2 Points / Grammar' }, 2],
    ['Trans1 and Trans2 are 3 Points and Trans4 is Confusing', { 1: '3 Points', 2: '3 Points', 4: 'Confusing' }, 4],
    ['Trans1 and Trans2 are 3 Points and Trans3 is empty', { 1: '3 Points', 2: '3 Points', 3: '' }, 4],
  ];
  for (const [name, scores, expected] of cases) {
    test(`the composer opens on Trans${expected} when ${name}`, async ({ page }) => {
      await setScores(page, { ...ALL_EMPTY, ...scores });
      await openComposer(page);
      await expectTarget(page, expected);
    });
  }

  test('the composer opens on Trans1 when every populated translation is 3 Points', async ({ page }) => {
    const all = {};
    POPULATED.forEach((n) => { all[n] = '3 Points'; });
    await setScores(page, { ...ALL_EMPTY, ...all });
    await openComposer(page);
    await expectTarget(page, 1);
  });

  test('Q opens the composer on the initial target and quotes there when the composer is closed', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' });
    const text = await selectTrans(page, 5);
    await page.keyboard.press('q');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expectTarget(page, 4);
    await expectRemarks(page, { 4: `"${text}"`, 1: '', 2: '', 5: '' });
  });
});

test.describe('arrow movement', { tag: '@logic' }, () => {
  const lateScoring = { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' }; // initial target is Trans4

  test('the first ArrowUp jumps to Trans1 and later arrows step, clamp and skip the empty Trans3 when the target starts below Trans1', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await expectTarget(page, 4);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1); // clamped
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 4); // empty Trans3 is skipped
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 2);
  });

  // The one-shot "first ArrowUp jumps to Trans1" is spent by any of these
  // actions. Rows: { label, act, ups }. `act` opens the composer and performs
  // the action; `ups` are the targets the following ArrowUps must reach, each
  // one translation up (Trans3 is empty and skipped), never a jump to Trans1.
  const jumpSpenders = [
    {
      label: 'ArrowDown was pressed first',
      act: async (page) => {
        await setScores(page, lateScoring);
        await openComposer(page);
        await page.keyboard.press('ArrowDown');
        await expectTarget(page, 5, 'ArrowDown moves Trans4 -> Trans5');
      },
      ups: [4, 2],
    },
    {
      label: 'a column toggle was used first',
      act: async (page) => {
        await setScores(page, lateScoring);
        await openComposer(page);
        await page.keyboard.press('ArrowLeft');
        await expectTarget(page, 1, 'ArrowLeft toggles to the left column');
        await page.keyboard.press('ArrowRight');
        await expectTarget(page, 4, 'ArrowRight toggles back to the right column');
      },
      ups: [2],
    },
    {
      label: 'another translation\'s Remarks was clicked while #rmd-edit had focus',
      act: async (page) => {
        await keepComposerClear(page);
        await openComposer(page); // fixture scores: the initial target is Trans1
        await edit(page).click();
        await remarkField(page, 5).click();
        await expectTarget(page, 5, 'the click selects Trans5');
        await remarkField(page, 5).evaluate((ta) => ta.blur());
      },
      ups: [4],
    },
    {
      label: 'the already-targeted Remarks was clicked',
      act: async (page) => {
        await keepComposerClear(page);
        await setScores(page, lateScoring);
        await openComposer(page);
        await expectTarget(page, 4);
        await remarkField(page, 4).click();
        await remarkField(page, 4).evaluate((ta) => ta.blur());
      },
      ups: [2],
    },
    {
      label: 'direct input changed another translation\'s Remarks',
      act: async (page) => {
        await openComposer(page); // fixture scores: the initial target is Trans1
        await setRemark(page, 5, 'five');
        await expectTarget(page, 5, 'the input selects Trans5');
      },
      ups: [4],
    },
    {
      label: 'a native input left the target\'s Remarks unchanged',
      act: async (page) => {
        await setScores(page, lateScoring);
        await setRemark(page, 4, 'same'); // composer closed: no target yet
        await openComposer(page);
        await expectTarget(page, 4);
        await expect(edit(page)).toHaveValue('same');
        await setRemark(page, 4, 'same'); // equal to #rmd-edit, still an edit by the user
      },
      ups: [2],
    },
  ];
  for (const { label, act, ups } of jumpSpenders) {
    test(`the next ArrowUp steps one translation instead of jumping to Trans1 when ${label}`, async ({ page }) => {
      await act(page);
      for (const n of ups) {
        await page.keyboard.press('ArrowUp');
        await expectTarget(page, n, `[${label}] ArrowUp should step to Trans${n}`);
      }
    });
  }

  test('the first ArrowUp only spends the one-shot jump when Trans1 is already the target', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2);
  });

  test('the first ArrowUp still jumps to Trans1 when the composer wrote into the target\'s Remarks', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await expectTarget(page, 4);
    await edit(page).fill('composer');
    await expectRemarks(page, { 4: 'composer' }); // the write reached NOVA's field (its own feedback input)
    await edit(page).evaluate((ta) => ta.blur());
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1);
  });

  test('arrow keys move the caret and leave the target when focus is in #rmd-edit or a NOVA Remarks textarea', async ({ page }) => {
    await keepComposerClear(page);
    await setScores(page, lateScoring);
    await setRemark(page, 5, 'abcd'); // composer closed: no target yet
    await openComposer(page);
    await expectTarget(page, 4);
    const caret = (box) => box.evaluate((ta) => ta.selectionStart);

    await test.step('in #rmd-edit', async () => {
      await edit(page).click();
      await page.keyboard.type('abc');
      expect(await caret(edit(page)), '#rmd-edit: caret after typing').toBe(3);
      await page.keyboard.press('ArrowLeft');
      expect(await caret(edit(page)), '#rmd-edit: ArrowLeft').toBe(2);
      await page.keyboard.press('ArrowUp');
      expect(await caret(edit(page)), '#rmd-edit: single-line ArrowUp goes to the start').toBe(0);
      await page.keyboard.press('ArrowDown');
      expect(await caret(edit(page)), '#rmd-edit: single-line ArrowDown goes to the end').toBe(3);
      await expectTarget(page, 4, '#rmd-edit: caret keys must not move the target');
      await expectRemarks(page, { 4: 'abc' });
    });

    await test.step('in a NOVA Remarks textarea reached by a real click', async () => {
      await remarkField(page, 5).click();
      await expectTarget(page, 5, 'NOVA textarea: the real click selects Trans5');
      await remarkField(page, 5).evaluate((ta) => ta.setSelectionRange(2, 2));
      await page.keyboard.type('X');
      await expect(edit(page), 'NOVA textarea: typing mirrors live into #rmd-edit').toHaveValue('abXcd');
      await expect(remarkField(page, 5), 'NOVA textarea: keeps focus').toBeFocused();
      await page.keyboard.press('ArrowLeft');
      expect(await caret(remarkField(page, 5)), 'NOVA textarea: ArrowLeft').toBe(2);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      await expectTarget(page, 5, 'NOVA textarea: caret keys must not move the target');
    });
  });

  test('arrow keys select no target when the composer is closed', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    expect(await activeTargets(page)).toEqual([]);
  });
});

test.describe('highlight', { tag: '@logic' }, () => {
  test('only the target Remarks module is highlighted, and the highlight goes when the composer closes', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2); // Trans 2 Remarks (the spaced spelling)
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
    await expect.poll(() => activeTargets(page)).toEqual([]);
  });

  test('the highlight comes back when the platform replaces the target Remarks module', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await page.evaluate(() => {
      const old = document.querySelector('[data-module-name="Trans1 Remarks"]');
      // cloneNode copies the highlight class too, so strip it: the class must
      // come back from the composer, not from the copy.
      const fresh = old.cloneNode(true);
      fresh.classList.remove('rmd-active-target');
      old.replaceWith(fresh);
    });
    await expectTarget(page, 1);
  });

  test('the scoring cursor highlight is hidden when the composer is open', async ({ page }) => {
    const style = () => page.evaluate(() => {
      const el = document.querySelector('.tl-active-score');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, bgColor: cs.backgroundColor, bgImage: cs.backgroundImage };
    });
    const shadow = async () => (await style() || {}).shadow;
    await expect.poll(shadow).not.toBe('none');
    await expect.poll(shadow).not.toBeUndefined();
    await expect.poll(async () => (await style()).bgColor).not.toBe('rgba(0, 0, 0, 0)');
    await openComposer(page);
    await expect.poll(shadow).toBe('none');
    // polled: scoring's .15s background transition may still be settling
    await expect.poll(style).toMatchObject({ bgColor: 'rgba(0, 0, 0, 0)', bgImage: 'none' });
    await page.keyboard.press('Escape');
    await expect.poll(shadow).not.toBe('none');
  });
});

test.describe('row change and re-render while open', { tag: '@logic' }, () => {
  const lateScoring = { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' }; // initial target is Trans4
  // Note is the row-signature source, so a new row changes its text too.
  const nextRow = (page) => page.evaluate(() => {
    document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'A brand new row note.';
    document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = 'A brand new row, different source text.';
  });

  test('the target is re-resolved, no text is carried over and the jump is re-armed when the row changes', async ({ page }) => {
    await setScores(page, lateScoring);
    await setRemark(page, 1, 'one');
    await setRemark(page, 2, 'two');
    await setRemark(page, 5, 'five');
    await openComposer(page);
    await expectTarget(page, 4);
    await edit(page).click();
    await page.keyboard.type('typed on old row'); // focus stays in #rmd-edit
    await expectRemarks(page, { 1: 'one', 2: 'two', 4: 'typed on old row', 5: 'five' });

    // New row: Trans4 is now scored 3 Points too, so the initial target moves to Trans5.
    await nextRow(page);
    await setScores(page, { 4: '3 Points' });
    await expectTarget(page, 5);
    await expect(edit(page)).toHaveValue('five');
    await expectRemarks(page, { 1: 'one', 2: 'two', 3: '', 4: 'typed on old row', 5: 'five', 6: '', 7: '' });
    // One-shot jump is re-armed for the new row.
    await blur(page);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1);
  });

  test('#rmd-edit reloads the text of the new row when a row change keeps the same target', async ({ page }) => {
    await setScores(page, lateScoring);
    await setRemark(page, 4, 'old row remark');
    await openComposer(page);
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue('old row remark');
    // The platform swaps the row and its Remarks value together, with no input event.
    await page.evaluate(() => {
      const ta = document.querySelector('[data-module-name="Trans4 Remarks"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'new row remark');
      document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'A brand new row note.';
      document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = 'A brand new row, different source text.';
    });
    await expect(edit(page)).toHaveValue('new row remark');
    await expectTarget(page, 4);
    await expectRemarks(page, { 1: '', 2: '', 4: 'new row remark', 5: '' });
  });

  test('the target falls to the nearest lower populated translation, without writing, when its text empties', async ({ page }) => {
    await setScores(page, lateScoring);
    await setRemark(page, 2, 'two');
    await setRemark(page, 4, 'four');
    await openComposer(page);
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue('four');
    await page.evaluate(() => {
      document.querySelector('[data-module-name="Trans4"] .preview-content').textContent = '';
    });
    await expectTarget(page, 2); // nearest lower populated translation
    await expect(edit(page)).toHaveValue('two');
    await expectRemarks(page, { 1: '', 2: 'two', 4: 'four', 5: '' });
  });
});
