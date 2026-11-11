// Mutation counting for the perf baseline tests (tests/perf.spec.js).
//
// countMutations installs a MutationObserver on document.body, waits `ms`,
// disconnects it and returns what it saw:
//   batches  - observer callbacks fired (one per delivered batch of records)
//   records  - MutationRecords across all batches
//   own      - records whose target sits inside one of the userscript's own
//              UI (OWN_SELECTOR), i.e. writes the scripts made to themselves

const OWN_SELECTOR = '#rmd-popover, #tl-score-panel, .qc-badge, #qc-panel, .tl-toast';

async function countMutations(page, ms) {
  await page.evaluate((ownSelector) => {
    const counts = { batches: 0, records: 0, own: 0 };
    const tally = (list) => {
      counts.batches++;
      counts.records += list.length;
      list.forEach((r) => {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (el && el.closest(ownSelector)) counts.own++;
      });
    };
    const mo = new MutationObserver(tally);
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.__perfCount = { mo, tally, counts };
  }, OWN_SELECTOR);

  await page.waitForTimeout(ms);

  return page.evaluate(() => {
    const { mo, tally, counts } = window.__perfCount;
    const pending = mo.takeRecords();
    if (pending.length) tally(pending);
    mo.disconnect();
    delete window.__perfCount;
    return { batches: counts.batches, records: counts.records, own: counts.own };
  });
}

module.exports = { countMutations, OWN_SELECTOR };
