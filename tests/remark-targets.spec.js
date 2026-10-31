const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { POPULATED, ALL_EMPTY, setScores } = require('./helpers/scores');
const {
  setRemark, remarksValues, expectRemarks, activeTargets, expectTarget,
  remarkArea, remarkField, keepComposerClear,
  selectTrans, makeSelection, edit, blur, openComposer,
} = require('./helpers/remarks');

// Fixture facts: Trans1, 2, 4-7 are populated; Trans3's text is empty. The
// per-translation Remarks modules are TransN Remarks, except Trans2's, which
// the real capture spells "Trans 2 Remarks".

test.beforeEach(async ({ page }) => {
  await boot(page);
  await expect(page.locator('#rmd-popover')).toBeAttached();
});

test.describe('initial target', () => {
  const cases = [
    ['an unscored translation is eligible', { 1: '3 Points' }, 2],
    ['a bare 2 Points is eligible', { 1: '3 Points', 2: '2 Points' }, 2],
    ['a fully labeled 2 Points / ... is eligible', { 1: '3 Points', 2: '2 Points / Grammar' }, 2],
    ['Confusing is eligible', { 1: '3 Points', 2: '3 Points', 4: 'Confusing' }, 4],
    ['skips 3 Points and the empty translation', { 1: '3 Points', 2: '3 Points', 3: '' }, 4],
  ];
  for (const [name, scores, expected] of cases) {
    test(name, async ({ page }) => {
      await setScores(page, { ...ALL_EMPTY, ...scores });
      await openComposer(page);
      await expectTarget(page, expected);
    });
  }

  test('falls back to Trans1 when every populated score begins with 3 Points', async ({ page }) => {
    const all = {};
    POPULATED.forEach((n) => { all[n] = '3 Points'; });
    await setScores(page, { ...ALL_EMPTY, ...all });
    await openComposer(page);
    await expectTarget(page, 1);
  });

  test('Q with the composer closed opens at the same initial target', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' });
    const text = await selectTrans(page, 5);
    await page.keyboard.press('q');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expectTarget(page, 4);
    await expectRemarks(page, { 4: `"${text}"`, 1: '', 2: '', 5: '' });
  });
});

test.describe('arrow movement', () => {
  const lateScoring = { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' }; // initial target is Trans4

  test('the first ArrowUp jumps to Trans1, later arrows are sequential and clamped', async ({ page }) => {
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

  test('arrows do nothing while the composer is closed', async ({ page }) => {
    await page.keyboard.press('ArrowDown');
    expect(await activeTargets(page)).toEqual([]);
  });
});

test.describe('highlight', () => {
  test('only the active Remarks module carries the class, and it goes away on close', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2); // Trans 2 Remarks (the spaced spelling)
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
    await expect.poll(() => activeTargets(page)).toEqual([]);
  });

  test('is re-applied after the module is replaced', async ({ page }) => {
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

  test('scoring active-score highlight is not applied while the composer is open', async ({ page }) => {
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

test.describe('writes', () => {
  test('typing and chips land only in the highlighted target across target switches', async ({ page }) => {
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

  test('a React-style replacement of the textarea does not redirect the write', async ({ page }) => {
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

  test('reverse sync selects an eligible page-side edit', async ({ page }) => {
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

  test('Clear affects only the active target', async ({ page }) => {
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

  test('typing "Trans 2" never produces a .rmd-tref highlight', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await edit(page).click();
    await page.keyboard.type('Trans 2 is odd');
    await expect(page.locator('#rmd-edit-bg')).toContainText('Trans 2 is odd');
    expect(await page.locator('.rmd-tref').count()).toBe(0);
  });
});

test.describe('mouse selection and direct editing', () => {
  // Keep the floating composer away from the right-column native click targets.
  test.beforeEach(async ({ page }) => {
    await keepComposerClear(page);
  });
  const field = remarkField;
  const area = remarkArea;

  test('module clicks load text without writing; subsequent chips and Clear affect only that target', async ({ page }) => {
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

  test('ineligible empty translation clicks and edits do not switch or leak text', async ({ page }) => {
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

  test('closed clicks and inputs do not retain a mouse target on reopen', async ({ page }) => {
    await field(page, 4).click();
    await setRemark(page, 4, 'closed');
    expect(await activeTargets(page)).toEqual([]);
    await field(page, 4).evaluate((ta) => ta.blur());
    await openComposer(page);
    await expectTarget(page, 1);
    await expect(edit(page)).toHaveValue('');
  });

  test('replacement module remains clickable and synchronizes both ways', async ({ page }) => {
    await openComposer(page);
    await area(page, 4).evaluate((mod) => mod.replaceWith(mod.cloneNode(true)));
    await field(page, 4).click();
    await expectTarget(page, 4);
    await edit(page).fill('proxy');
    await expectRemarks(page, { 4: 'proxy', 1: '' });
    await setRemark(page, 4, 'native');
    await expect(edit(page)).toHaveValue('native');
  });

  test('composer and source clicks do not retarget; column memory learns mouse selection', async ({ page }) => {
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

  test('spaced module names select even when the new text equals the proxy', async ({ page }) => {
    await setRemark(page, 1, 'same');
    await openComposer(page);
    await setRemark(page, 2, 'same');
    await expectTarget(page, 2);
    await edit(page).fill('two');
    await expectRemarks(page, { 1: 'same', 2: 'two' });
  });

  test('all-empty source fallback still permits selecting Remarks', async ({ page }) => {
    await page.locator('[data-module-name^="Trans"] .preview-content').evaluateAll((els) => els.forEach((el) => { el.textContent = ''; }));
    await openComposer(page);
    await area(page, 3).dispatchEvent('click');
    await expectTarget(page, 3);
  });

  test('selection alone emits no input events; ignored score and right-click do not retarget', async ({ page }) => {
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

test.describe('row change and re-render while open', () => {
  const lateScoring = { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' }; // initial target is Trans4
  // Note is the row-signature source, so a new row changes its text too.
  const nextRow = (page) => page.evaluate(() => {
    document.querySelector('[data-module-key="NoteTrans"] #content').textContent = 'A brand new row note.';
    document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = 'A brand new row, different source text.';
  });

  test('a row change re-resolves the initial target and never carries text into the new row', async ({ page }) => {
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

  test('a row change that keeps the same target still reloads its text from the new row', async ({ page }) => {
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

  test('when the active target stops being populated the target falls to a populated one without writing', async ({ page }) => {
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

test.describe('quoting', () => {
  test('Q with the composer open keeps the highlighted target and appends there', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' });
    await openComposer(page);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 5);
    const text = await selectTrans(page, 2);
    await page.keyboard.press('q');
    await expectRemarks(page, { 1: '', 2: '', 4: '', 5: `"${text}"` });
    await expectTarget(page, 5);
  });

  test('Q with no selection focuses #rmd-edit with the caret at the end', async ({ page }) => {
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

  test('clicking a translation title inserts nothing and keeps the target', async ({ page }) => {
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
    ['Note body text', 'note-body', true, 'Note body sed ut perspiciatis unde omnis iste natus error.'],
    ['Note heading and body together', 'note-heading-and-body', true, 'Note heading lorem titleNote body sed ut perspiciatis unde omnis iste natus error.'],
    ['text wrapped in an annotation tag', 'tagged', true],
    ['Trans4 to Trans5', 'two-translations', false],
    ['Note body running into the Collapse control', 'note-into-collapse', false],
    ['Note heading through the picture list', 'note-through-pictures', false],
    ['the Collapse control alone', 'collapse-only', false],
    ['Note plus Trans1', 'note-and-translation', false],
    ['Context-EN plus Trans1', 'context-and-translation', false],
    ['Context-EN only', 'context-only', false],
    ['a title plus its translation text', 'title-and-text', false],
    ['the whole page (select all)', 'select-all', false],
  ];
  for (const [label, key, accepted, exact] of sources) {
    test(`${accepted ? 'quotes' : 'refuses'} ${label}`, async ({ page }) => {
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

    test('a chip after a quote is joined with ": "', async ({ page }) => {
      await openComposer(page);
      const q = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await blur(page);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await expect(edit(page)).toHaveValue(`"${q}": ${chip}`);
    });

    test('a quote after a chip is joined with two spaces', async ({ page }) => {
      await openComposer(page);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await blur(page);
      const q = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await expect(edit(page)).toHaveValue(`${chip}  "${q}"`);
    });

    test('a quote after a quote is joined with two spaces', async ({ page }) => {
      await openComposer(page);
      const a = (await makeSelection(page, 'part')).trim();
      await page.keyboard.press('q');
      await blur(page);
      const b = (await makeSelection(page, 'note-body')).trim();
      await page.keyboard.press('q');
      await expect(edit(page)).toHaveValue(`"${a}"  "${b}"`);
    });

    test('a pre-v1.5.3 Trans N quote still counts as a quote before a chip', async ({ page }) => {
      await setRemark(page, 1, 'Trans 2 "x"');
      await openComposer(page);
      await expectTarget(page, 1);
      const chip = await chipText(page);
      await page.locator('#rmd-popover .rmd-chip').first().click();
      await expect(edit(page)).toHaveValue(`Trans 2 "x": ${chip}`);
    });
  });
});

test.describe('escape', () => {
  const focusedId = (page) => page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'BODY';
    const mod = el.closest && el.closest('[data-module-name]');
    return el.id || (mod && mod.getAttribute('data-module-name')) || el.tagName;
  });

  test('the first Escape blurs #rmd-edit and keeps the window, text, and target', async ({ page }) => {
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

  test('the first Escape blurs a NOVA Remarks textarea, including Trans 2 Remarks', async ({ page }) => {
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

  test('a second Escape closes the window, and an unrelated focus still closes on the first', async ({ page }) => {
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

  test('closes on the first Escape when an unrelated textarea (the header remark bar) has focus', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await page.locator('#form_item_remark').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#rmd-popover')).toBeHidden();
  });

  test('leaves an Escape that is part of IME composition to the IME', async ({ page }) => {
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

test.describe('likely-remark summary', () => {
  test('lists 2 Points (bare or labeled) and Confusing; omits 3 Points and unscored', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 2: '2 Points / Grammar', 4: 'Confusing', 5: '2 Points' });
    await openComposer(page);
    const likely = page.locator('#rmd-likely');
    await expect(likely).toHaveText('Likely need remarks: Trans2 (2 Points), Trans4 (Confusing), Trans5 (2 Points)');
    const above = await edit(page).boundingBox();
    const below = await likely.boundingBox();
    expect(below.y).toBeGreaterThanOrEqual(above.y + above.height);
  });

  test('updates after a score change and says so when nothing needs remarks', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 2: '2 Points' });
    await openComposer(page);
    await expect(page.locator('#rmd-likely')).toHaveText('Likely need remarks: Trans2 (2 Points)');
    await setScores(page, { 2: '3 Points', 6: 'Confusing' });
    await expect(page.locator('#rmd-likely')).toHaveText('Likely need remarks: Trans6 (Confusing)');
    await setScores(page, { 6: '3 Points' });
    await expect(page.locator('#rmd-likely')).toHaveText('No translations need remarks');
  });

  test('is informational: the target ignores it and the hint line is empty by default', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points', 4: 'Confusing' });
    await openComposer(page);
    await expectTarget(page, 2);
    await expect(page.locator('#rmd-hint')).toHaveText('');
    await edit(page).click();
    await page.keyboard.type('ok');
    await expectRemarks(page, { 2: 'ok', 4: '' });
  });
});
