// The `test` and `expect` every spec imports instead of '@playwright/test'.
//
// It overrides the built-in `page` fixture with one guard: any uncaught
// error thrown inside the page (a `pageerror`) during the test fails that
// test after it finishes, with the errors listed. Tests that never touch
// `page` do not create one, so the guard costs them nothing.
const base = require('@playwright/test');

const test = base.test.extend({
  page: async ({ page }, use) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // Opt-in coverage (npm run coverage sets COV_DIR). Without it nothing here runs.
    const covDir = process.env.COV_DIR;
    if (covDir) await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    if (covDir) {
      const cov = (await page.coverage.stopJSCoverage()).filter((e) => e.url.replace(/\\/g, '/').includes('/src/'));
      const info = base.test.info();
      const id = `${info.workerIndex}-${info.testId}-${info.title}`.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 150);
      require('fs').writeFileSync(require('path').join(covDir, `${id}.json`),
        JSON.stringify({ name: info.title, file: require('path').basename(info.file), cov }));
    }
    base.expect(pageErrors, 'uncaught errors thrown in the page during this test').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
