// The page structure the userscript modules rely on. One list, used by:
//   - tests/capture-contract.spec.js (the reduced fixture and every local capture)
//   - scripts/capture-ingest.js      (report for a freshly pasted capture)
//
// When the real page changes, a failing line here names exactly which
// assumption broke. Edit the contract only after looking at the new capture.
//
// kind 'selector': document.querySelectorAll(selector).length >= min
// kind 'module'  : distinct data-module-name values matching `pattern` >= min
//                  (the page renders the same name in nested wrappers, so
//                  names are de-duplicated before counting)

const TRANS = [1, 2, 3, 4, 5, 6, 7];

const contract = [
  {
    id: 'trans-score-cascader',
    kind: 'selector',
    selector: '[data-module-name$="Score"] .ant-select-selector',
    min: 1,
    why: 'Scoring Shortcuts opens each TransN Score cascader through its .ant-select-selector',
  },
  {
    id: 'trans-score-combobox',
    kind: 'selector',
    selector: '[data-module-name$="Score"] input[aria-expanded]',
    min: 1,
    why: 'open/closed state of a score control is read from the combobox input',
  },
  {
    id: 'trans-text',
    kind: 'selector',
    selector: '[data-module-name^="Trans"] .preview-content',
    min: 1,
    why: 'a translation is populated when its .preview-content has text',
  },
  {
    id: 'remarks-textarea',
    kind: 'selector',
    selector: '[data-module-name$="Remarks"] textarea',
    min: 1,
    why: 'Remark Composer writes into each TransN Remarks textarea',
  },
  ...TRANS.flatMap((n) => [
    { id: `trans${n}-text-module`, kind: 'module', pattern: `^Trans ?${n}$`, min: 1, why: `Trans${n} source text module` },
    { id: `trans${n}-score-module`, kind: 'module', pattern: `^Trans ?${n} Score$`, min: 1, why: `Trans${n} Score module` },
    { id: `trans${n}-remarks-module`, kind: 'module', pattern: `^Trans ?${n} Remarks$`, min: 1, why: `Trans${n} Remarks module (Trans2 is spelled "Trans 2 Remarks")` },
  ]),
];

// Runs the contract inside a Playwright page. Returns one result per line.
async function checkContract(page) {
  return page.evaluate((items) => items.map((c) => {
    let found;
    if (c.kind === 'selector') {
      found = document.querySelectorAll(c.selector).length;
    } else {
      const re = new RegExp(c.pattern);
      const names = new Set();
      document.querySelectorAll('[data-module-name]').forEach((el) => {
        const name = el.getAttribute('data-module-name') || '';
        if (re.test(name)) names.add(name);
      });
      found = names.size;
    }
    return { id: c.id, why: c.why, min: c.min, found, ok: found >= c.min };
  }), contract);
}

// Distinct module names and keys on the page, for diffing one capture against another.
async function describeStructure(page) {
  return page.evaluate(() => {
    const uniq = (attr) => [...new Set([...document.querySelectorAll(`[${attr}]`)].map((e) => e.getAttribute(attr)))].sort();
    return {
      moduleNames: uniq('data-module-name'),
      moduleKeys: uniq('data-module-key'),
      textareas: document.querySelectorAll('textarea').length,
      cascaders: document.querySelectorAll('.ant-select-selector').length,
    };
  });
}

module.exports = { contract, checkContract, describeStructure };
