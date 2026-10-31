const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');

async function parseNamed(page, name, suffix) {
  return page.evaluate(({ name, suffix }) => {
    const mod = document.querySelector(`[data-module-name="${name}"]`);
    return window.TL.Utils.transNumFromModuleName(mod, suffix);
  }, { name, suffix });
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('parses Trans module numbers and rejects unrelated names and wrong suffixes', async ({ page }) => {
  // A regex that requires Trans immediately against the number returns null
  // for the fixture's exact "Trans 2 Remarks" spelling.
  expect(await parseNamed(page, 'Trans1', '')).toBe(1);
  expect(await parseNamed(page, 'Trans1 Score', ' Score')).toBe(1);
  expect(await parseNamed(page, 'Trans1 Remarks', ' Remarks')).toBe(1);
  expect(await parseNamed(page, 'Trans 2 Remarks', ' Remarks')).toBe(2);

  expect(await parseNamed(page, 'Trans1', ' Score')).toBeNull();
  expect(await parseNamed(page, 'Trans1 Score', '')).toBeNull();
  expect(await parseNamed(page, 'Trans1 Score', ' Remarks')).toBeNull();
  expect(await parseNamed(page, 'Trans1 Remarks', ' Score')).toBeNull();
  expect(await parseNamed(page, 'Trans 2 Remarks', '')).toBeNull();
  expect(await parseNamed(page, 'Trans 2 Remarks', ' Score')).toBeNull();

  const rejected = await page.evaluate(() => {
    const Utils = window.TL.Utils;
    const el = (name) => {
      const node = document.createElement('div');
      node.setAttribute('data-module-name', name);
      return node;
    };
    return {
      missing: Utils.transNumFromModuleName(null),
      empty: Utils.transNumFromModuleName(el('')),
      unrelated: Utils.transNumFromModuleName(el('Source')),
      prefix: Utils.transNumFromModuleName(el('MyTrans1')),
      extraSpace: Utils.transNumFromModuleName(el('Trans  2'), ''),
      suffixMissingLeadingSpace: Utils.transNumFromModuleName(el('Trans1 Score'), 'Score'),
      trailing: Utils.transNumFromModuleName(el('Trans1 Score extra'), ' Score'),
    };
  });
  expect(rejected).toEqual({
    missing: null,
    empty: null,
    unrelated: null,
    prefix: null,
    extraSpace: null,
    suffixMissingLeadingSpace: null,
    trailing: null,
  });

  // No fixture module is named "Trans 2 Score". The optional space is
  // intentional for Score names too, and the suffix must still match exactly.
  const spacedScore = await page.evaluate(() => {
    const node = document.createElement('div');
    node.setAttribute('data-module-name', 'Trans 2 Score');
    return window.TL.Utils.transNumFromModuleName(node, ' Score');
  });
  expect(spacedScore).toBe(2);
});

test('TransCursor toggles columns, remembers slots, falls back, and nextIn advances', async ({ page }) => {
  const result = await page.evaluate(() => {
    const calls = [];
    let nums = [1, 2, 3, 4, 5, 6, 7];
    const cursor = window.TL.TransCursor({
      list: () => nums.slice(),
      onChange: (n, opts) => calls.push({ n, scroll: opts.scroll }),
      status: () => {},
    });

    const start = cursor.reset();
    const toRight = cursor.toggleColumn();
    cursor.set(6, { scroll: true });
    cursor.set(2, { scroll: true });
    const rememberedRight = cursor.toggleColumn();
    const rememberedLeft = cursor.toggleColumn();

    // cur is on the left and the remembered right slot is absent, so
    // toggleColumn must refuse that slot and leave the cursor on Trans1.
    const missingSlot = window.TL.TransCursor({
      list: () => [1, 2, 3, 5, 7],
      onChange: (n) => calls.push({ n }),
    });
    missingSlot.set(6, { silent: true });
    missingSlot.set(1, { silent: true });
    const missingRememberedSlot = missingSlot.toggleColumn();
    const stayedAfterMissingSlot = missingSlot.get();

    const rememberedAfterFallback = window.TL.TransCursor({
      list: () => [1, 2, 3, 5, 7],
      onChange: (n) => calls.push({ n }),
    });
    rememberedAfterFallback.reset({ silent: true });
    rememberedAfterFallback.toggleColumn();
    rememberedAfterFallback.set(2, { scroll: true });
    const rememberedFive = rememberedAfterFallback.toggleColumn();

    const leftOnly = window.TL.TransCursor({
      list: () => [1, 2, 3],
      onChange: (n) => calls.push({ n }),
    });
    leftOnly.reset({ silent: true });
    const stayLeft = leftOnly.toggleColumn();

    return {
      start,
      toRight,
      rememberedRight,
      rememberedLeft,
      missingRememberedSlot,
      stayedAfterMissingSlot,
      rememberedFive,
      stayLeft,
      current: cursor.get(),
      scrolled: calls.filter((c) => c.scroll === true).map((c) => c.n),
      nextAfter2: window.TL.TransCursor.nextIn([1, 2, 4], 2),
      nextAtEnd: window.TL.TransCursor.nextIn([1, 2, 4], 4),
      nextMissing: window.TL.TransCursor.nextIn([1, 2, 4], 3),
    };
  });

  expect(result.start).toBe(1);
  expect(result.toRight).toBe(4);
  expect(result.rememberedRight).toBe(6);
  expect(result.rememberedLeft).toBe(2);
  expect(result.missingRememberedSlot).toBeNull();
  expect(result.stayedAfterMissingSlot).toBe(1);
  expect(result.rememberedFive).toBe(5);
  expect(result.stayLeft).toBeNull();
  expect(result.current).toBe(2);
  expect(result.scrolled).toEqual([4, 6, 2, 6, 2]);
  expect(result.nextAfter2).toBe(4);
  expect(result.nextAtEnd).toBe(4);
  expect(result.nextMissing).toBe(3);
});
