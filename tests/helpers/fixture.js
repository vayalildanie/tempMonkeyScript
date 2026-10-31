// Fixture URLs and the standard boot: open a fixture page, then inject and
// start the userscript modules (helpers/boot.js).
const path = require('path');
const { bootModules } = require('./boot');

const ANNOTATION = 'annotation.html';
const QUALITY = 'quality_compare.html';

// file:// URL of a page in tests/fixtures (forward slashes on Windows too).
function fixtureUrl(name = ANNOTATION) {
  return 'file://' + path.resolve(__dirname, '..', 'fixtures', name).replace(/\\/g, '/');
}

// Opens `fixture` and boots the modules. `beforeModules` runs after the page
// loads and before the modules start (seed data, clear storage, reload).
async function boot(page, { fixture = ANNOTATION, beforeModules } = {}) {
  await page.goto(fixtureUrl(fixture));
  if (beforeModules) await beforeModules(page);
  await bootModules(page);
}

module.exports = { ANNOTATION, QUALITY, fixtureUrl, boot };
