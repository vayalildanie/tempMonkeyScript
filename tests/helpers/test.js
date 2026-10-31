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
    await use(page);
    base.expect(pageErrors, 'uncaught errors thrown in the page during this test').toEqual([]);
  },
});

module.exports = { test, expect: base.expect };
