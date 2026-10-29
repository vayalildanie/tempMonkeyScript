const fs = require('fs');
const path = require('path');

const SRC = [
  'src/utils.js',
  'src/trans-cursor.js',
  'src/scoring-shortcuts.js',
  'src/remark-composer.js',
  'src/qc-compare.js',
];

// Same boot as annotation-scoring-shortcuts.user.js. The userscript entry
// point is not loaded: it only sets the version and starts the modules, and
// tests need to inject the local src files rather than the remote @require URLs.
async function bootModules(page) {
  const root = path.resolve(__dirname, '../..');
  for (const rel of SRC) {
    await page.addScriptTag({ path: path.join(root, rel) });
  }
  const entry = fs.readFileSync(path.join(root, 'annotation-scoring-shortcuts.user.js'), 'utf8');
  const match = /TL\.SCRIPT_VERSION = '([^']+)'/.exec(entry);
  if (!match) throw new Error('SCRIPT_VERSION not found in annotation-scoring-shortcuts.user.js');
  const version = match[1];
  await page.evaluate((version) => {
    window.TL = window.TL || {};
    if (!window.TL.SCRIPT_VERSION) window.TL.SCRIPT_VERSION = version;
    const scoringShortcuts = window.TL.ScoringShortcuts(window.TL.Utils);
    const remarkComposer = window.TL.RemarkComposer(window.TL.Utils, scoringShortcuts);
    const qcCompare = window.TL.QCCompare(window.TL.Utils);
    window.TL.Utils.installClipboardSanitizer();
    scoringShortcuts.start();
    remarkComposer.start();
    qcCompare.start();
  }, version);
}

module.exports = { bootModules };
