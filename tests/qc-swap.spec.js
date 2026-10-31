// QC Compare: Z swaps Score and Remark together, with a preserved pair so Z
// keeps flip-flopping between the two annotators even after either side is
// cleared (v1.5.3 plan: B-Z, B-FAIL, B-ADV).
const { test, expect } = require('./helpers/test');
const { scoreMod } = require('./helpers/scores');
const { setRemark } = require('./helpers/remarks');
const {
  SCOREABLE, unit, expectUnit, selected, expectSelected, moveSelectionTo, clickTab, bootQC: bootQCWith,
} = require('./helpers/qc');

// Trans1: both halves differ. Trans2: score only. Trans4: remark only.
// Trans5: Annotator 2 has no score. Trans6: identical. Trans7: score only, last translation.
const DATA = {
  a1: {
    1: { score: '3 Points', remark: '' },
    2: { score: '2 Points / Fluency', remark: 'shared' },
    4: { score: '3 Points', remark: '' },
    5: { score: 'Confusing', remark: 'a1 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '2 Points / Fluency', remark: '' },
  },
  a2: {
    1: { score: '2 Points / Accuracy', remark: 'a2 remark one' },
    2: { score: '3 Points', remark: 'shared' },
    4: { score: '3 Points', remark: 'a2 four' },
    5: { score: '', remark: 'a2 five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '3 Points', remark: '' },
  },
};
const A = (n) => DATA.a1[n];
const B = (n) => DATA.a2[n];

const badge = (page, n) => page.locator(`${scoreMod(n)} .qc-badge`);
const allRemarks = (page) => Promise.all(SCOREABLE.map((n) => unit(page, n).then((u) => u.remark)));
const summary = (page) => page.locator('#qc-summary').innerText();
const bootQC = (page, data = DATA) => bootQCWith(page, data);

test.describe('Z swaps Score and Remark', () => {
  const kinds = [
    ['both halves differ', 1],
    ['only the score differs', 2],
    ['only the remark differs', 4],
  ];
  for (const [label, n] of kinds) {
    test(`writes Annotator 2's value and shows the swapped badge when ${label}`, async ({ page }) => {
      await bootQC(page);
      await moveSelectionTo(page, n);
      await page.keyboard.press('z');
      await expectUnit(page, n, B(n));
      await expect(badge(page, n)).toHaveClass(/qc-adopted/);
    });
  }

  test('never writes another translation when Z swaps one', async ({ page }) => {
    await bootQC(page);
    const before = await allRemarks(page);
    await page.keyboard.press('z'); // Trans1
    await expectUnit(page, 1, B(1));
    const after = await allRemarks(page);
    expect(after.filter((_, i) => SCOREABLE[i] !== 1)).toEqual(before.filter((_, i) => SCOREABLE[i] !== 1));
  });

  test('keeps flip-flopping between the two annotators when Z is pressed repeatedly', async ({ page }) => {
    await bootQC(page);
    const steps = [B(1), A(1), B(1)];
    for (let i = 0; i < steps.length; i++) {
      await page.keyboard.press('z');
      await expectUnit(page, 1, steps[i]);
      await expectSelected(page, 2); // every writing Z advances
      await page.keyboard.press('ArrowUp');
      await expectSelected(page, 1);
    }
  });

  test('shows Annotator 2\'s remark in the badge only when the remarks differ', async ({ page }) => {
    await bootQC(page);
    await expect(badge(page, 4)).toContainText('a2 four');
    await expect(badge(page, 2)).not.toContainText('shared'); // equal remarks: no remark line
  });

  test('counts a remark-only difference as still to reconcile', async ({ page }) => {
    await bootQC(page);
    await expect.poll(() => summary(page)).toContain('5 still to reconcile: Trans 1, 2, 4, 5, 7');
  });
});

test.describe('failsafe: the preserved pair survives clears and edits', () => {
  // Annotator 1's Trans2 is ('2 Points / Fluency', 'shared'); Annotator 2's is ('3 Points', 'shared').
  const clears = [
    ['the remark is cleared', async (page) => { await setRemark(page, 2, ''); }],
    ['the score is cleared with X', async (page) => { await page.keyboard.press('x'); await expect.poll(async () => (await unit(page, 2)).score).toBe(''); }],
    ['both are cleared', async (page) => {
      await setRemark(page, 2, '');
      await page.keyboard.press('x');
      await expect.poll(async () => (await unit(page, 2)).score).toBe('');
    }],
  ];
  for (const [label, clear] of clears) {
    test(`restores Annotator 1's original on the second Z when ${label}`, async ({ page }) => {
      await bootQC(page);
      await moveSelectionTo(page, 2);
      await clear(page);
      await page.keyboard.press('z'); // matches neither side: writes Annotator 2's
      await expectUnit(page, 2, B(2));
      await expectSelected(page, 4); // the writing Z advanced; Trans3 is skipped
      await page.keyboard.press('ArrowUp');
      await expectSelected(page, 2);
      await page.keyboard.press('z');
      await expectUnit(page, 2, A(2));
    });
  }

  test('still writes Annotator 2\'s preserved remark after it was cleared on its own tab', async ({ page }) => {
    await bootQC(page);
    await clickTab(page, 1);
    await setRemark(page, 1, '');
    await clickTab(page, 0);
    await page.keyboard.press('z'); // Trans1
    await expectUnit(page, 1, B(1));
  });

  test('records a remark that loads after the scrape as Annotator 1\'s original', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 6);
    await setRemark(page, 6, 'late text', { input: false }); // the platform finishing a load: no input event
    await page.waitForTimeout(2200); // past the bounded verify window
    await page.keyboard.press('z');
    await expectUnit(page, 6, { score: '3 Points', remark: '' }); // matched Annotator 1's filled value, so it flips to Annotator 2's
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 6, { score: '3 Points', remark: 'late text' });
    await expect(badge(page, 6)).not.toContainText('was:');
  });

  test('replaces the previous row\'s leftover remark with the real one when the platform corrects it after the scrape', async ({ page }) => {
    const leftover = { ...DATA, a1: { ...DATA.a1, 6: { score: '3 Points', remark: 'leftover from the last row' } } };
    await bootQC(page, leftover);
    await moveSelectionTo(page, 6);
    await setRemark(page, 6, 'the real remark', { input: false }); // the platform catching up: no input event
    await page.waitForTimeout(2200);
    await page.keyboard.press('z'); // Annotator 1's original is the real remark, so this flips to Annotator 2's (empty)
    await expectUnit(page, 6, { score: '3 Points', remark: '' });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 6, { score: '3 Points', remark: 'the real remark' });
  });

  test('stops correcting the pair once the user has flipped a translation', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('z'); // Trans1: the pair is now in use
    await expectUnit(page, 1, B(1));
    await moveSelectionTo(page, 4); // originals ('3 Points', '') and ('3 Points', 'a2 four')
    await setRemark(page, 4, 'late text', { input: false });
    await page.waitForTimeout(2200);
    await page.keyboard.press('z'); // live matches neither original: Annotator 2's is written, the text is kept
    await expectUnit(page, 4, B(4));
    await expect(badge(page, 4)).toContainText('late text');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 4, A(4)); // the original stays the empty one
  });

  test('does not re-read the pair after a score was changed by hand', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => { // a score picked with the mouse: no keyboard path, no input event
      document.querySelector('[data-module-name="Trans2 Score"] .ant-select-selection-item').textContent = '3 Points';
    });
    await setRemark(page, 6, 'late text', { input: false });
    await page.waitForTimeout(2200);
    await moveSelectionTo(page, 2);
    await page.keyboard.press('z'); // the live unit now equals Annotator 2's, so Z flips back to the original
    await expectUnit(page, 2, A(2));
  });

  test('shows the whole hand-edited text on hover when the badge shortens it', async ({ page }) => {
    const long = 'a long hand-edited remark that runs well past forty characters in length';
    await bootQC(page);
    await moveSelectionTo(page, 4);
    await setRemark(page, 4, long);
    await page.keyboard.press('z');
    await expectUnit(page, 4, B(4));
    await expect(page.locator(`${scoreMod(4)} .qc-badge [title]`)).toHaveAttribute('title', `3 Points + ${long}`);
  });

  test('keeps a hand-edited remark in the badge before Z overwrites it', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 4);
    await setRemark(page, 4, 'typed edit');
    await page.keyboard.press('z');
    await expectUnit(page, 4, B(4));
    await expect(badge(page, 4)).toContainText('typed edit');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 4, A(4)); // the edit was never one of the two originals
  });

  test('discards every pair when the row changes', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('z'); // Trans1 now holds Annotator 2's value
    await expectUnit(page, 1, B(1));
    await page.evaluate(() => {
      document.querySelector('[data-module-key="NoteTrans"] h1').textContent = 'A different row heading.';
    });
    // The row change re-scrapes: Annotator 2's tab is visited again (tabs 1, 0, then 1, 0).
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
    await expectSelected(page, 1);
    // The new pair reads the swapped Trans1 as both annotators' value, so Z has nothing to flip.
    await page.keyboard.press('z');
    await expect(page.locator('#qc-cursor')).toContainText('Trans1 matches');
    await expectUnit(page, 1, B(1));
  });
});

test.describe('rows changing under the pairs', () => {
  const heading = (page, text) => page.evaluate((t) => {
    document.querySelector('[data-module-key="NoteTrans"] h1').textContent = t;
  }, text);

  test('refuses Z in the moment after the row changes, before it is re-read', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => {
      document.querySelector('[data-module-key="NoteTrans"] h1').textContent = 'Row two heading';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
    await expectUnit(page, 1, A(1)); // the old row's Annotator 2 value was not written into the new row
  });

  test('re-reads again when the row changes while a read is already in progress', async ({ page }) => {
    await bootQC(page);
    await heading(page, 'Row two heading');
    await page.waitForFunction(() => window.__fixture.tabLog.length >= 3); // the read is on Annotator 2's tab
    await heading(page, 'Row three heading');
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0, 1, 0]);
  });

  test('works again after the next row change when a read could not finish', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => { window.__fixture.failTabSwitch = true; });
    await heading(page, 'Row two heading');
    await expect(page.locator('#qc-summary')).toContainText('Could not read Annotator 2', { timeout: 8000 });
    await page.evaluate(() => { window.__fixture.failTabSwitch = false; });
    await heading(page, 'Row three heading');
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
    await expect(page.locator('.qc-badge')).toHaveCount(SCOREABLE.length);
    await expectSelected(page, 1);
    await page.keyboard.press('z');
    await expectUnit(page, 1, B(1));
  });

  test('does not move on to a different translation when the selection was moved during the flip', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => {
      const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
      key('z');
      key('ArrowDown'); // same tick: the selection is already on Trans2 when the flip finishes
    });
    await expectUnit(page, 1, B(1));
    await page.waitForTimeout(400);
    await expectSelected(page, 2);
  });
});

test.describe('Z refusals', () => {
  test('writes nothing and does not advance when Annotator 2\'s tab is active', async ({ page }) => {
    await bootQC(page);
    await clickTab(page, 1);
    const before = await unit(page, 1);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-summary')).toContainText('Switch to the Annotator 1 tab');
    expect(await unit(page, 1)).toEqual(before);
    await expectSelected(page, 1);
  });

  test('writes nothing and does not advance when Annotator 2 has no score', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 5);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-summary')).toContainText('no score for Trans5');
    await expectUnit(page, 5, A(5));
    await expectSelected(page, 5);
  });

  test('writes nothing and does not advance when both annotators agree', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 6);
    await page.keyboard.press('z');
    await expect(page.locator('#qc-cursor')).toContainText('Trans6 matches');
    await expectUnit(page, 6, A(6));
    await expectSelected(page, 6);
  });
});

test.describe('Z auto-advance', () => {
  test('moves the selection to the next scoreable translation and skips the empty Trans3', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 2);
    await page.keyboard.press('z');
    await expectUnit(page, 2, B(2));
    await expectSelected(page, 4);
  });

  test('stays on the last translation when it is the one swapped', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 7);
    await page.keyboard.press('z');
    await expectUnit(page, 7, B(7));
    await expectSelected(page, 7);
  });
});

test.describe('3 Points must have no remark', () => {
  const warn = (page) => page.locator('#qc-warn');

  test('warns while a 3 Points translation holds a remark and clears when the remark is removed', async ({ page }) => {
    await bootQC(page);
    await expect(warn(page)).toBeHidden();
    await setRemark(page, 6, 'should not be here');
    await expect(warn(page)).toBeVisible();
    await expect(warn(page)).toContainText('Trans 6');
    await setRemark(page, 6, '   ');
    await expect(warn(page)).toBeHidden();
  });

  test('warns after Z writes Annotator 2\'s remark onto a 3 Points score and clears when flipped back', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 4); // Annotator 2: 3 Points with a remark
    await page.keyboard.press('z');
    await expectUnit(page, 4, B(4));
    await expect(warn(page)).toContainText('Trans 4');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 4, A(4));
    await expect(warn(page)).toBeHidden();
  });

  test('does not warn for a remark on a translation scored below 3 Points', async ({ page }) => {
    await bootQC(page);
    await setRemark(page, 2, 'explains the 2 Points'); // Trans2 is 2 Points / Fluency
    await expect(warn(page)).toBeHidden();
  });
});

test.describe('Z guards and mouse', () => {
  test('ignores a second Z that arrives while the first write is still in flight', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => {
      const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true }));
      press();
      press(); // same tick: the guard must drop it, not flip back
    });
    await expectUnit(page, 1, B(1));
    await page.waitForTimeout(600);
    await expectUnit(page, 1, B(1));
  });

  test('flips with the badge buttons the same as Z but does not move the selection', async ({ page }) => {
    await bootQC(page);
    await badge(page, 1).locator('.qc-adopt-btn').click();
    await expectUnit(page, 1, B(1));
    await expectSelected(page, 1);
    await badge(page, 1).locator('.qc-undo').click();
    await expectUnit(page, 1, A(1));
    await expectSelected(page, 1);
  });
});
