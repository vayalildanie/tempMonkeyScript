// QC Compare: V combines both annotators' remarks into the live one, keeping
// the live score, and Z (or X then Z) always gets Annotator 1's original back
// (v1.5.7 plan, Task 2).
const { test, expect } = require('./helpers/test');
const { scoreMod } = require('./helpers/scores');
const { setRemark } = require('./helpers/remarks');
const {
  unit, expectUnit, expectSelected, moveSelectionTo, clickTab, remarkMod, bootQC: bootQCWith,
} = require('./helpers/qc');

// Trans1: both remarks differ.  Trans2: identical remarks.  Trans4: Annotator 1's remark empty, 3 Points.
// Trans5: Annotator 1's remark is whitespace only.  Trans6: both empty.  Trans7: both differ, last translation.
const DATA = {
  a1: {
    1: { score: '2 Points / Fluency', remark: 'a one' },
    2: { score: '2 Points / Fluency', remark: 'same' },
    4: { score: '3 Points', remark: '' },
    5: { score: 'Confusing / Task input issue', remark: '  ' },
    6: { score: '3 Points', remark: '' },
    7: { score: '2 Points / Fluency', remark: 'a seven' },
  },
  a2: {
    1: { score: '3 Points', remark: 'b one' },
    2: { score: '2 Points / Accuracy', remark: 'same' },
    4: { score: '2 Points / Accuracy', remark: 'b four' },
    5: { score: '3 Points', remark: 'b five' },
    6: { score: '3 Points', remark: '' },
    7: { score: '3 Points', remark: 'b seven' },
  },
};
const A = (n) => DATA.a1[n];
const B = (n) => DATA.a2[n];
const bootQC = (page) => bootQCWith(page, DATA);
const badge = (page, n) => page.locator(`${scoreMod(n)} .qc-badge`);
const status = (page) => page.locator('#qc-cursor');

test.describe('V combines remarks', { tag: '@logic' }, () => {
  test('writes "A; B" into the remark and keeps the live score', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await expectUnit(page, 1, { score: A(1).score, remark: 'a one; b one' });
  });

  test('keeps the score the reviewer has selected, not Annotator 1\'s original', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('3'); // relabel Trans1 to 3 Points by hand
    await expect.poll(async () => (await unit(page, 1)).score).toBe('3 Points');
    await page.keyboard.press('v');
    await expectUnit(page, 1, { score: '3 Points', remark: 'a one; b one' });
  });

  test('moves on to the next scoreable translation and skips the empty Trans3', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 2);
    await page.keyboard.press('ArrowDown'); // Trans4 (Trans3 has no text)
    await expectSelected(page, 4);
    await page.keyboard.press('v');
    await expectUnit(page, 4, { score: '3 Points', remark: 'b four' });
    await expectSelected(page, 5);
  });

  test('stays on the last translation when it is the one combined', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 7);
    await page.keyboard.press('v');
    await expectUnit(page, 7, { score: A(7).score, remark: 'a seven; b seven' });
    await expectSelected(page, 7);
  });

  test('collapses when one side is empty or whitespace only', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 4); // Annotator 1 empty
    await page.keyboard.press('v');
    await expectUnit(page, 4, { score: '3 Points', remark: 'b four' });
    await expectSelected(page, 5);
    await page.keyboard.press('v'); // Trans5: Annotator 1 whitespace only
    await expectUnit(page, 5, { score: A(5).score, remark: 'b five' });
  });

  test('refuses and does not advance when the remarks are identical or both empty', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 2); // identical remarks: the combined text equals the live one
    await page.keyboard.press('v');
    await expect(status(page)).toContainText('already combined');
    await expectSelected(page, 2);
    await moveSelectionTo(page, 6); // both empty
    await page.keyboard.press('v');
    await expect(status(page)).toContainText('no remarks to combine');
    await expectSelected(page, 6);
    await expectUnit(page, 6, A(6));
  });

  test('a second V on the same translation does nothing', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await expectUnit(page, 1, { score: A(1).score, remark: 'a one; b one' });
    await page.keyboard.press('ArrowUp');
    await expectSelected(page, 1);
    await page.keyboard.press('v');
    await expect(status(page)).toContainText('already combined');
    await expectUnit(page, 1, { score: A(1).score, remark: 'a one; b one' });
    await expectSelected(page, 1);
  });
});

test.describe('V is reversible', { tag: '@logic' }, () => {
  test('Z right after V restores Annotator 1\'s original unit', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await expectUnit(page, 1, { score: A(1).score, remark: 'a one; b one' });
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, A(1));
  });

  test('X, then Z restores Annotator 1\'s original (not Annotator 2\'s)', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await expectSelected(page, 2);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('x'); // clears the score; the remark stays combined
    await expect.poll(async () => (await unit(page, 1)).score).toBe('');
    await expectSelected(page, 2);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, A(1));
  });

  test('after undoing, Z flips to Annotator 2 and back as before, so the pair was never changed', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, A(1));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, B(1));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, A(1));
  });

  test('V works again after the undo', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 1, A(1));
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('v');
    await expectUnit(page, 1, { score: A(1).score, remark: 'a one; b one' });
  });

  test('keeps a hand-typed remark in the badge before V overwrites it', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 4);
    await setRemark(page, 4, 'typed edit');
    await page.keyboard.press('v');
    await expectUnit(page, 4, { score: '3 Points', remark: 'b four' });
    await expect(badge(page, 4)).toContainText('typed edit');
  });

  test('the badge says Combined and its Undo restores Annotator 1\'s original; the summary stops counting it', async ({ page }) => {
    await bootQC(page);
    await expect(page.locator('#qc-summary')).toContainText('5 still to reconcile');
    await page.keyboard.press('v');
    await expect(badge(page, 1)).toContainText('Remarks combined');
    await expect(page.locator('#qc-summary')).toContainText('4 still to reconcile');
    await expect(page.locator('#qc-summary')).not.toContainText('swapped');
    await badge(page, 1).locator('.qc-undo').click();
    await expectUnit(page, 1, A(1));
    await expect(page.locator('#qc-summary')).toContainText('5 still to reconcile');
  });

  test('warns when V puts a remark on a 3 Points score and clears when undone', async ({ page }) => {
    await bootQC(page);
    await moveSelectionTo(page, 4);
    await page.keyboard.press('v');
    await expect(page.locator('#qc-warn')).toContainText('Trans 4');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('z');
    await expectUnit(page, 4, A(4));
    await expect(page.locator('#qc-warn')).toBeHidden();
  });

  test('discards the combined state when the row changes', async ({ page }) => {
    await bootQC(page);
    await page.keyboard.press('v');
    await page.evaluate(() => {
      document.querySelector('[data-module-key="NoteTrans"] h1').textContent = 'A different row heading.';
    });
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
    await expectSelected(page, 1);
    // The old pair is gone: the combined unit is now just Annotator 1's value, so Z flips to Annotator 2's, not back to the old original.
    await page.keyboard.press('z');
    await expectUnit(page, 1, B(1));
  });
});

test.describe('V guards', { tag: '@logic' }, () => {
  test('writes nothing when Annotator 2\'s tab is active', async ({ page }) => {
    await bootQC(page);
    await clickTab(page, 1);
    const before = await unit(page, 1);
    await page.keyboard.press('v');
    await expect(page.locator('#qc-summary')).toContainText('Switch to the Annotator 1 tab');
    expect(await unit(page, 1)).toEqual(before);
    await expectSelected(page, 1);
  });

  test('writes nothing in the moment after the row changes, before it is re-read', async ({ page }) => {
    await bootQC(page);
    await page.evaluate(() => {
      document.querySelector('[data-module-key="NoteTrans"] h1').textContent = 'Row two heading';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }));
    });
    await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
    await expectUnit(page, 1, A(1));
  });

  test('typing v in a Remarks box types the letter and combines nothing', async ({ page }) => {
    await bootQC(page);
    await page.locator(`${remarkMod(1)} textarea`).focus();
    await page.keyboard.press('v');
    const u = await unit(page, 1);
    expect(u.remark).toContain('v');
    expect(u.remark).not.toContain('b one');
  });
});
