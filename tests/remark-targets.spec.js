const { test, expect } = require('@playwright/test');
const path = require('path');
const { bootModules } = require('./helpers/boot');

const fixtureUrl = 'file://' + path.resolve(__dirname, 'fixtures/annotation.html').replace(/\\/g, '/');

// Fixture facts: Trans1, 2, 4-7 are populated; Trans3's text is empty. The
// per-translation Remarks modules are TransN Remarks, except Trans2's, which
// the real capture spells "Trans 2 Remarks".
const POPULATED = [1, 2, 4, 5, 6, 7];

// Set what each translation's score control displays. '' = unscored.
function setScores(page, scores) {
  return page.evaluate((map) => {
    Object.keys(map).forEach((k) => {
      const mod = document.querySelector(`[data-module-name="Trans${k} Score"]`);
      const selector = mod.querySelector('.ant-select-selector');
      let item = selector.querySelector('.ant-select-selection-item');
      if (!item) {
        item = document.createElement('span');
        item.className = 'ant-select-selection-item';
        selector.appendChild(item);
      }
      item.textContent = map[k];
    });
  }, scores);
}

const ALL_EMPTY = { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' };

function remarksValues(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('[data-module-name]').forEach((mod) => {
      const m = /^Trans ?(\d+) Remarks$/.exec(mod.getAttribute('data-module-name'));
      if (m && !(m[1] in out)) out[m[1]] = mod.querySelector('textarea').value;
    });
    return out;
  });
}

async function expectRemarks(page, expected) {
  await expect.poll(async () => {
    const all = await remarksValues(page);
    const out = {};
    Object.keys(expected).forEach((k) => { out[k] = all[k]; });
    return out;
  }).toEqual(expected);
}

function activeTargets(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.rmd-active-target')).map((el) => {
    const m = /^Trans ?(\d+) Remarks$/.exec(el.getAttribute('data-module-name') || '');
    return m ? parseInt(m[1], 10) : el.getAttribute('data-module-name');
  }));
}

async function expectTarget(page, n) {
  await expect.poll(() => activeTargets(page)).toEqual([n]);
}

// A page-side edit of a Remarks textarea, as NOVA's own field would deliver it.
function pageEdit(page, n, text) {
  return page.evaluate(({ n, text }) => {
    const mod = Array.from(document.querySelectorAll('[data-module-name]'))
      .find((m) => new RegExp(`^Trans ?${n} Remarks$`).test(m.getAttribute('data-module-name')));
    const ta = mod.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, { n, text });
}

function selectTrans(page, n) {
  return page.evaluate((n) => {
    const el = document.querySelector(`[data-module-name="Trans${n}"] .preview-content`);
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return el.textContent.trim();
  }, n);
}

function selectAcross(page, a, b) {
  return page.evaluate(({ a, b }) => {
    const first = document.querySelector(`[data-module-name="Trans${a}"] .preview-content`);
    const second = document.querySelector(`[data-module-name="Trans${b}"] .preview-content`);
    const range = document.createRange();
    range.setStart(first, 0);
    range.setEnd(second, second.childNodes.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }, { a, b });
}

const edit = (page) => page.locator('#rmd-edit');
// A chip click or quote re-focuses #rmd-edit one animation frame later, so wait
// for that before blurring, or the late focus lands after the blur.
async function blur(page) {
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe('rmd-edit');
  await page.evaluate(() => document.activeElement.blur());
}

async function openComposer(page) {
  await page.keyboard.press('o');
  await expect(page.locator('#rmd-popover')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto(fixtureUrl);
  await bootModules(page);
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
    await expectRemarks(page, { 4: `Trans 5 "${text}"`, 1: '', 2: '', 5: '' });
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

  test('ArrowDown first clears the one-shot jump', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 5);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 4);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 2); // sequential, not a jump to Trans1
  });

  test('a column toggle also clears the one-shot jump', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await page.keyboard.press('ArrowLeft');
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowRight');
    await expectTarget(page, 4);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 2);
  });

  test('when Trans1 is already the target the first ArrowUp only consumes the one-shot', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 1);
    await page.keyboard.press('ArrowDown');
    await expectTarget(page, 2);
  });

  test('arrows inside #rmd-edit keep native caret behavior and do not move the target', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await expectTarget(page, 4);
    await edit(page).click();
    await page.keyboard.type('abc');
    const caret = () => page.evaluate(() => document.getElementById('rmd-edit').selectionStart);
    expect(await caret()).toBe(3);
    await page.keyboard.press('ArrowLeft');
    expect(await caret()).toBe(2);
    await page.keyboard.press('ArrowUp');
    expect(await caret()).toBe(0); // native: single-line ArrowUp goes to the start
    await page.keyboard.press('ArrowDown');
    expect(await caret()).toBe(3);
    await expectTarget(page, 4);
    await expectRemarks(page, { 4: 'abc' });
  });

  test('arrows inside the NOVA Remarks textarea keep native behavior', async ({ page }) => {
    await setScores(page, lateScoring);
    await openComposer(page);
    await expectTarget(page, 4);
    await pageEdit(page, 5, 'xyz');
    await page.evaluate(() => {
      const ta = document.querySelector('[data-module-name="Trans5 Remarks"] textarea');
      ta.focus();
      ta.setSelectionRange(3, 3);
    });
    await page.keyboard.press('ArrowLeft');
    expect(await page.evaluate(() => document.querySelector('[data-module-name="Trans5 Remarks"] textarea').selectionStart)).toBe(2);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expectTarget(page, 4);
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

  test('reverse sync mirrors a page-side edit of the active target only', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await openComposer(page);
    await expectTarget(page, 2);
    await pageEdit(page, 2, 'typed on page');
    await expect(edit(page)).toHaveValue('typed on page');
    await pageEdit(page, 4, 'other');
    await expect(edit(page)).toHaveValue('typed on page');
    await expectRemarks(page, { 2: 'typed on page', 4: 'other' });
  });

  test('Clear affects only the active target', async ({ page }) => {
    await setScores(page, { ...ALL_EMPTY, 1: '3 Points' });
    await pageEdit(page, 2, 'two');
    await pageEdit(page, 4, 'four');
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

test.describe('row change and re-render while open', () => {
  const lateScoring = { ...ALL_EMPTY, 1: '3 Points', 2: '3 Points' }; // initial target is Trans4
  const nextRow = (page) => page.evaluate(() => {
    document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = 'A brand new row, different source text.';
  });

  test('a row change re-resolves the initial target and never carries text into the new row', async ({ page }) => {
    await setScores(page, lateScoring);
    await pageEdit(page, 1, 'one');
    await pageEdit(page, 2, 'two');
    await pageEdit(page, 5, 'five');
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
    await pageEdit(page, 4, 'old row remark');
    await openComposer(page);
    await expectTarget(page, 4);
    await expect(edit(page)).toHaveValue('old row remark');
    // The platform swaps the row and its Remarks value together, with no input event.
    await page.evaluate(() => {
      const ta = document.querySelector('[data-module-name="Trans4 Remarks"] textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'new row remark');
      document.querySelector('[data-module-name="Trans1"] .preview-content').textContent = 'A brand new row, different source text.';
    });
    await expect(edit(page)).toHaveValue('new row remark');
    await expectTarget(page, 4);
    await expectRemarks(page, { 1: '', 2: '', 4: 'new row remark', 5: '' });
  });

  test('when the active target stops being populated the target falls to a populated one without writing', async ({ page }) => {
    await setScores(page, lateScoring);
    await pageEdit(page, 2, 'two');
    await pageEdit(page, 4, 'four');
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
    await expectRemarks(page, { 1: '', 2: '', 4: '', 5: `Trans 2 "${text}"` });
    await expectTarget(page, 5);
  });

  test('Q with no selection focuses #rmd-edit with the caret at the end', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await pageEdit(page, 1, 'seed text');
    await page.keyboard.press('q'); // composer closed: opens first
    await expect(page.locator('#rmd-popover')).toBeVisible();
    await expectTarget(page, 1);
    await expect.poll(() => page.evaluate(() => {
      const el = document.activeElement;
      return el && el.id === 'rmd-edit' ? [el.selectionStart, el.selectionEnd, el.value.length] : null;
    })).toEqual([9, 9, 9]);
  });

  test('a selection spanning two translations is rejected and writes nothing', async ({ page }) => {
    await setScores(page, ALL_EMPTY);
    await openComposer(page);
    await selectAcross(page, 4, 5);
    await page.keyboard.press('q');
    await expect(page.locator('#rmd-hint')).toContainText('single translation');
    await expectRemarks(page, { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' });
    await expect(edit(page)).toHaveValue('');
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
