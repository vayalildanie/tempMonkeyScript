const { test, expect } = require('./helpers/test');
const fs = require('fs');
const path = require('path');
const { contract, checkContract } = require('./helpers/selector-contract');

const root = path.resolve(__dirname, '..');
const toUrl = (p) => 'file://' + p.replace(/\\/g, '/');

const targets = [
  { name: 'reduced fixture (tests/fixtures/annotation.html)', file: path.join(__dirname, 'fixtures/annotation.html') },
  { name: 'reduced QC fixture (tests/fixtures/quality_compare.html)', file: path.join(__dirname, 'fixtures/quality_compare.html') },
];

// Local captures made with `npm run capture`. They are gitignored, so a fresh
// clone only checks the fixture; your machine also checks every capture you made.
const capturesDir = path.join(root, 'captures');
if (fs.existsSync(capturesDir)) {
  for (const d of fs.readdirSync(capturesDir, { withFileTypes: true })) {
    const file = path.join(capturesDir, d.name, 'page.html');
    if (d.isDirectory() && fs.existsSync(file)) targets.push({ name: `capture ${d.name}`, file });
  }
}

for (const target of targets) {
  test(`the selector contract holds for ${target.name}`, { tag: '@contract' }, async ({ page }) => {
    await page.goto(toUrl(target.file));
    const results = await checkContract(page);
    const missing = results.filter((r) => !r.ok).map((r) => `${r.id}: found ${r.found}, need ${r.min} (${r.why})`);
    expect(missing).toEqual([]);
  });
}

test('contract ids are unique and every line explains itself', { tag: '@contract' }, () => {
  const ids = contract.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const c of contract) expect(c.why.length).toBeGreaterThan(10);
});
