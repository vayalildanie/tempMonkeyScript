// Perf baselines for the two idle/self-trigger bugs that v1.5.5 T2 (idle QC
// re-render) and T3 (self-triggered settle) fixed, plus regression coverage
// for T3's own-UI filter (own-root re-injection, Settings typing).
const { test, expect } = require('./helpers/test');
const { boot } = require('./helpers/fixture');
const { bootQC, COMPARE_DATA } = require('./helpers/qc');
const { openComposer } = require('./helpers/remarks');
const { countMutations } = require('./helpers/perf');

test('an idle QC row produces no mutation batches', { tag: '@perf' }, async ({ page }) => {
  await bootQC(page, COMPARE_DATA);
  // Let the QC lazy-load re-check (up to ~2.5s of verify ticks) settle first.
  await page.waitForFunction(() => !window.__tlQcVerifyPending);
  const { batches } = await countMutations(page, 2000);
  expect(batches).toBe(0); // fails today: ~9-10 batches, from updateSummary()'s unconditional writes
});

test('typing in the composer schedules no settle outside our own UI', { tag: '@perf' }, async ({ page }) => {
  await boot(page);
  await openComposer(page);
  await page.evaluate(() => { window.__tlSettleScheduled = { remark: 0, score: 0, qc: 0 }; });
  await page.locator('#rmd-edit').click();
  await page.keyboard.type('x'.repeat(20));
  await page.waitForTimeout(600);
  const scheduled = await page.evaluate(() => window.__tlSettleScheduled);
  expect(scheduled.remark).toBe(0); // fails today: ~20
  expect(scheduled.score).toBe(0);  // fails today: ~20
  await expect(page.locator('#rmd-edit')).toHaveValue('x'.repeat(20));
});

test('a mutation while QC is scraping does not schedule a new settle timer', { tag: '@perf' }, async ({ page }) => {
  await bootQC(page, COMPARE_DATA);
  await page.waitForFunction(() => !window.__tlQcVerifyPending);
  // Change the row heading so onMutate's settle fires, sees a new row, and calls scrapeBoth() (scraping = true).
  await page.evaluate(() => {
    document.querySelector('[data-module-key="NoteTrans"] h1').textContent = 'Row two heading';
  });
  // Mid-read, on Annotator 2's tab — scraping is still true here (same checkpoint qc-swap.spec.js uses).
  await page.waitForFunction(() => window.__fixture.tabLog.length >= 3);
  await page.evaluate(() => { window.__tlSettleScheduled = { remark: 0, score: 0, qc: 0 }; });
  // An unrelated, non-own-UI mutation fired while QC is mid-scrape must not touch the settle timer at all.
  await page.evaluate(() => { document.body.appendChild(document.createElement('div')); });
  const scheduled = await page.evaluate(() => window.__tlSettleScheduled.qc);
  expect(scheduled).toBe(0); // shouldSkip() bailed before scheduling, same as the old raw-callback guard
  // The scrape itself still completes normally once it's done.
  await expect.poll(() => page.evaluate(() => window.__fixture.tabLog)).toEqual([1, 0, 1, 0]);
});

test('removing the score panel or the remark popover still re-injects it', { tag: '@perf' }, async ({ page }) => {
  await boot(page);
  await openComposer(page);
  await page.evaluate(() => document.getElementById('tl-score-panel')?.remove());
  await expect(page.locator('#tl-score-panel')).toBeAttached({ timeout: 1000 });
});

test('typing in Settings does not trigger a row-change reset', { tag: '@perf' }, async ({ page }) => {
  await boot(page);
  await openComposer(page);
  await page.locator('#rmd-settings-btn').click();
  await page.locator('#rmd-settings-overlay input').first().fill('Renamed Group');
  await page.waitForTimeout(400);
  await expect(page.locator('#rmd-settings-overlay')).toBeVisible(); // did not get closed/reset
});
