const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { bootQC, COMPARE_DATA } = require('./helpers/qc');

async function parseNamed(page, name, suffix) {
  return page.evaluate(({ name, suffix }) => {
    const mod = document.querySelector(`[data-module-name="${name}"]`);
    return window.TL.Utils.transNumFromModuleName(mod, suffix);
  }, { name, suffix });
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('transNumFromModuleName returns the Trans number when name and suffix match, and null otherwise', { tag: '@logic' }, async ({ page }) => {
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

test('Utils.rowSig reads the Note module when present, else Trans1', { tag: '@logic' }, async ({ page }) => {
  const withNote = await page.evaluate(() => {
    const note = document.querySelector('[data-module-key="NoteTrans"]');
    return { sig: window.TL.Utils.rowSig(), expected: note ? note.textContent.trim().slice(0, 80) : null };
  });
  expect(withNote.expected).toBeTruthy();
  expect(withNote.sig).toBe(withNote.expected);
  expect(withNote.sig.length).toBeLessThanOrEqual(80);

  const withoutNote = await page.evaluate(() => {
    document.querySelectorAll('[data-module-key="NoteTrans"]').forEach((el) => el.remove());
    const t1 = document.querySelector('[data-module-name="Trans1"]');
    return { sig: window.TL.Utils.rowSig(), expected: t1.textContent.trim().slice(0, 80) };
  });
  expect(withoutNote.expected).toBeTruthy();
  expect(withoutNote.sig).toBe(withoutNote.expected);
});

test('Utils.remarkTextarea finds Trans 2\'s space-spelled module', { tag: '@logic' }, async ({ page }) => {
  const r = await page.evaluate(() => {
    const U = window.TL.Utils;
    const mod = Array.from(document.querySelectorAll('[data-module-name]'))
      .find((m) => m.getAttribute('data-module-name') === 'Trans 2 Remarks');
    return {
      found: !!mod,
      same: U.remarkTextarea(2) === mod.querySelector('textarea'),
      nonNull: U.remarkTextarea(2) !== null,
      missing: U.remarkTextarea(99),
      nullArg: U.remarkTextarea(null),
      mapHas2: U.modulesBySuffix(' Remarks').has(2),
    };
  });
  expect(r.found).toBe(true);
  expect(r.nonNull).toBe(true);
  expect(r.same).toBe(true);
  expect(r.missing).toBeNull();
  expect(r.nullArg).toBeNull();
  expect(r.mapHas2).toBe(true);
});

test('TransCursor toggles columns, remembers slots and refuses a missing slot, and nextIn steps over gaps', { tag: '@logic' }, async ({ page }) => {
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

// The fixture's "Grammar" label is a category whose only child is the leaf
// "Grammar" (the same lone-leaf category the scoring label-pick tests use).
test('Utils.pickCascaderItem drills a category with one leaf and picks that leaf too', { tag: '@logic' }, async ({ page }) => {
  const r = await page.evaluate(async () => {
    const U = window.TL.Utils;
    const mod = document.querySelector('[data-module-name="Trans1 Score"]');
    const shown = () => U.readSelected(mod);
    U.clickEl(mod.querySelector('.ant-select-selector'));
    await U.waitFor(() => U.popupsVisible().length === 1, 1000);
    const popup = U.popupsVisible()[0];
    const notOpen = await U.pickCascaderItem(popup, 1); // only the score column is showing

    const twoPoints = popup.querySelectorAll('li.ant-cascader-menu-item')[1];
    U.clickEl(twoPoints.querySelector('.ant-cascader-menu-item-content'));
    await U.waitFor(() => popup.querySelectorAll('ul.ant-cascader-menu').length === 2, 1000);
    const notFound = await U.pickCascaderItem(popup, 99);

    let seenBeforeLeaf = null;
    const drilled = await U.pickCascaderItem(popup, 1, {
      findPopup: () => U.popupsVisible()[0] || null,
      beforeLeafClick: () => { seenBeforeLeaf = shown(); },
    });
    return { notOpen, notFound, drilled, seenBeforeLeaf, after: shown() };
  });
  expect(r.notOpen).toEqual({ outcome: 'not-open' });
  expect(r.notFound).toEqual({ outcome: 'not-found' });
  expect(r.drilled).toEqual({ outcome: 'drilled-leaf' });
  // The hook runs after the category click and before the leaf click.
  expect(r.seenBeforeLeaf).toBe('2 Points');
  expect(r.after).toBe('2 Points / Grammar / Grammar');
});

// The platform's copy icon ends in navigator.clipboard.writeText; the boot's
// installClipboardSanitizer patch strips the leading/trailing annotation tags.
// The browser's real clipboard needs permissions, so the underlying writeText
// is replaced by a recorder and the sanitizer is installed over it again (it is
// idempotent only while writeText still carries its marker).
test('copy icon: the clipboard write has its annotation tags stripped', { tag: '@logic' }, async ({ page }) => {
  const r = await page.evaluate(async () => {
    const written = [];
    navigator.clipboard.writeText = (t) => { written.push(t); return Promise.resolve(); };
    window.TL.Utils.installClipboardSanitizer();
    await navigator.clipboard.writeText('<content1>x</content1>');
    await navigator.clipboard.writeText('  <b>two words</b> ');
    await navigator.clipboard.writeText('plain <i>inside</i> text');
    const marked = navigator.clipboard.writeText.__tlPatched === true;
    window.TL.Utils.installClipboardSanitizer(); // second install must not wrap again
    await navigator.clipboard.writeText('<content2>y</content2>');
    return { written, marked };
  });
  expect(r.marked).toBe(true);
  expect(r.written).toEqual(['x', 'two words', 'plain <i>inside</i> text', 'y']);
});

test.describe('panel drag and resize', { tag: '@layout' }, () => {
  test.use({ viewport: { width: 1280, height: 1100 } });

  const read = (page, sel) => page.locator(sel).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight };
  });
  const saved = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), key);
  const onScreen = (b) => b.left >= 0 && b.top >= 0 && b.right <= b.vw && b.bottom <= b.vh;
  async function drag(page, from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
  }
  // A point on the header that is not on one of its buttons.
  const headPoint = async (page, sel) => {
    const b = await page.locator(sel).boundingBox();
    return { x: b.x + 6, y: b.y + b.height / 2 };
  };

  test('Scoring Shortcuts: header drag moves and saves the panel, the right-edge grip narrows it within the limits', async ({ page }) => {
    const before = await read(page, '#tl-score-panel');
    const h = await headPoint(page, '#tl-score-head');
    await drag(page, h, { x: h.x - 200, y: h.y + 150 });
    const moved = await read(page, '#tl-score-panel');
    expect(Math.round(moved.left)).toBe(Math.round(before.left - 200));
    expect(Math.round(moved.top)).toBe(Math.round(before.top + 150));
    expect(onScreen(moved)).toBe(true);
    expect(await saved(page, 'trans-tool:nova-score-pos-v3')).toEqual({ left: Math.round(moved.left), top: Math.round(moved.top) });

    // Dragging far past the edge stops at the viewport edge (4px pad).
    const h2 = await headPoint(page, '#tl-score-head');
    await drag(page, h2, { x: -500, y: -500 });
    const clamped = await read(page, '#tl-score-panel');
    expect(onScreen(clamped)).toBe(true);
    expect(Math.round(clamped.left)).toBe(4);
    expect(Math.round(clamped.top)).toBe(4);

    // Right-edge grip: width only, shrink only, never below the minimum.
    const startW = clamped.width;
    const grip = async () => { const g = await page.locator('#tl-score-panel .tl-resize-handle').boundingBox(); return { x: g.x + g.width / 2, y: g.y + g.height / 2 }; };
    let g = await grip();
    await drag(page, g, { x: g.x - 50, y: g.y + 60 });
    const narrower = await read(page, '#tl-score-panel');
    expect(Math.round(narrower.width)).toBe(Math.round(startW - 50));
    expect(Math.round(narrower.height)).toBe(Math.round(clamped.height)); // height is not user-sized
    expect(await saved(page, 'trans-tool:nova-score-size-v2')).toEqual({ w: Math.round(narrower.width) });
    g = await grip();
    await drag(page, g, { x: g.x + 400, y: g.y });
    expect(Math.round((await read(page, '#tl-score-panel')).width)).toBe(Math.round(startW)); // cannot grow past the natural width
    g = await grip();
    await drag(page, g, { x: g.x - 900, y: g.y });
    expect(Math.round((await read(page, '#tl-score-panel')).width)).toBe(260); // MIN_PANEL_W
    expect(await saved(page, 'trans-tool:nova-score-size-v2')).toEqual({ w: 260 });
  });

  test('Remark Options: header drag moves and saves the window, the corner grip resizes both axes within the limits', async ({ page }) => {
    await page.keyboard.press('o');
    await expect(page.locator('#rmd-popover')).toBeVisible();
    const before = await read(page, '#rmd-popover');
    const h = await headPoint(page, '#rmd-head');
    await drag(page, h, { x: h.x + 120, y: h.y + 90 });
    const moved = await read(page, '#rmd-popover');
    expect(Math.round(moved.left)).toBe(Math.round(before.left + 120));
    expect(Math.round(moved.top)).toBe(Math.round(before.top + 90));
    expect(await saved(page, 'trans-tool:nova-remark-pos-v1')).toEqual({ left: Math.round(moved.left), top: Math.round(moved.top) });

    const h2 = await headPoint(page, '#rmd-head');
    await drag(page, h2, { x: 5000, y: 5000 });
    expect(onScreen(await read(page, '#rmd-popover'))).toBe(true);
    const pos = await saved(page, 'trans-tool:nova-remark-pos-v1');
    expect(pos.left).toBeGreaterThan(moved.left);

    // Corner grip: grow, then shrink below the minimum, then try to run off-screen.
    await drag(page, await headPoint(page, '#rmd-head'), { x: 400, y: 200 });
    const base = await read(page, '#rmd-popover');
    const corner = async () => { const b = await page.locator('#rmd-resize-handle').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    let c = await corner();
    await drag(page, c, { x: c.x + 60, y: c.y + 40 });
    const grown = await read(page, '#rmd-popover');
    expect(Math.round(grown.width)).toBe(Math.round(base.width + 60));
    expect(Math.round(grown.height)).toBe(Math.round(base.height + 40));
    expect(await saved(page, 'trans-tool:nova-remark-size-v1')).toEqual({ w: Math.round(grown.width), h: Math.round(grown.height) });
    c = await corner();
    await drag(page, c, { x: c.x - 1000, y: c.y - 1000 });
    const small = await read(page, '#rmd-popover');
    expect(Math.round(small.width)).toBe(300);  // POPOVER_MIN_W
    expect(small.height).toBeGreaterThanOrEqual(260); // POPOVER_MIN_H
    expect(await saved(page, 'trans-tool:nova-remark-size-v1')).toEqual({ w: 300, h: Math.round(small.height) });
    c = await corner();
    await drag(page, c, { x: c.x + 3000, y: c.y + 3000 });
    expect(onScreen(await read(page, '#rmd-popover'))).toBe(true);
  });

  test('QC Compare: header drag moves and saves the panel and keeps it on screen; the help toggle does not drag; there is no resize grip', async ({ page }) => {
    await bootQC(page, COMPARE_DATA);
    const before = await read(page, '#qc-panel');
    expect(await page.locator('#qc-panel .tl-resize-handle, #qc-panel .rmd-resize-handle').count()).toBe(0);
    // Clicking the toggle with a little mouse travel does not move the panel.
    const t = await page.locator('#qc-toggle').boundingBox();
    await drag(page, { x: t.x + t.width / 2, y: t.y + t.height / 2 }, { x: t.x - 150, y: t.y + 40 });
    expect(await read(page, '#qc-panel')).toEqual(before);

    const h = await headPoint(page, '#qc-head');
    await drag(page, h, { x: h.x - 100, y: h.y + 60 });
    const moved = await read(page, '#qc-panel');
    expect(Math.round(moved.left)).toBe(Math.round(before.left - 100));
    expect(Math.round(moved.top)).toBe(Math.round(before.top + 60));
    expect(await saved(page, 'trans-tool:nova-qc-pos-v1')).toEqual({ left: Math.round(moved.left), top: Math.round(moved.top) });

    const h2 = await headPoint(page, '#qc-head');
    await drag(page, h2, { x: 5000, y: 5000 });
    expect(onScreen(await read(page, '#qc-panel'))).toBe(true);
    await drag(page, await headPoint(page, '#qc-head'), { x: -5000, y: -5000 });
    const topLeft = await read(page, '#qc-panel');
    expect(onScreen(topLeft)).toBe(true);
    expect(await saved(page, 'trans-tool:nova-qc-pos-v1')).toEqual({ left: Math.round(topLeft.left), top: Math.round(topLeft.top) });
  });
});
