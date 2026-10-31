// Score controls ("TransN Score" modules), shared by the annotation and QC specs.

// Annotation fixture facts: Trans1, 2, 4-7 have text; Trans3's text is empty.
const POPULATED = [1, 2, 4, 5, 6, 7];
const ALL_EMPTY = { 1: '', 2: '', 3: '', 4: '', 5: '', 6: '', 7: '' };

const scoreMod = (n) => `[data-module-name="Trans${n} Score"]`;

// Sets what each translation's score control displays, as { n: text }. '' = unscored.
function setScores(page, scores) {
  return page.evaluate((map) => {
    Object.keys(map).forEach((k) => {
      const mod = document.querySelector(`[data-module-name="Trans${k} Score"]`);
      const selector = mod.querySelector('.ant-select-selector');
      let item = selector.querySelector('.ant-select-selection-item');
      if (!item) {
        item = document.createElement('span');
        item.className = 'ant-select-selection-item';
        selector.appendChild(item);
      }
      item.textContent = map[k];
    });
  }, scores);
}

// The aria-expanded state of a score's cascader input: 'true' or 'false'.
const expanded = (page, n) => page.locator(`${scoreMod(n)} input`).first().getAttribute('aria-expanded');

// Trans numbers whose Score module holds an element with `className`
// (tl-active-score for the annotation cursor, qc-active-score for QC).
function scoreNumsWith(page, className) {
  return page.evaluate((cls) => Array.from(document.querySelectorAll(`.${cls}`)).map((el) => {
    const mod = el.closest('[data-module-name$=" Score"]');
    const m = /^Trans ?(\d+) Score$/.exec(mod ? mod.getAttribute('data-module-name') : '');
    return m ? parseInt(m[1], 10) : null;
  }), className);
}

module.exports = { POPULATED, ALL_EMPTY, scoreMod, setScores, expanded, scoreNumsWith };
