// Merge per-test V8 coverage (written by tests/helpers/test.js when COV_DIR is set)
// into per-file line and function coverage. Ported from
// PLANNING/reports/v1.5.5/coverage-merge.reference.js.
//
// Usage: node scripts/coverage-report.js <covDir>
// Exit 1 if total line % < tests/coverage-baseline.json "lines" minus 0.5 (a ratchet).
// Executable line = not blank, not a comment, not a lone closing bracket.
const fs = require('fs');
const path = require('path');

const TOLERANCE = 0.5;
const BASELINE_FILE = path.join(__dirname, '..', 'tests', 'coverage-baseline.json');
const dir = process.argv[2] || process.env.COV_DIR;
if (!dir || !fs.existsSync(dir)) { console.error('coverage-report: pass the COV_DIR as the first argument'); process.exit(2); }

function lineStarts(src) { const s = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') s.push(i + 1); return s; }
function lineOf(starts, off) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; }

const files = {}; // basename -> { source, starts, covered, fns }
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.json')) continue;
  const { cov } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const entry of cov) {
    const base = path.basename(entry.url.replace(/\\/g, '/'));
    const src = entry.source;
    if (!files[base]) files[base] = { source: src, starts: lineStarts(src), covered: new Uint8Array(src.length), fns: new Map() };
    const F = files[base];
    // innermost range wins: V8 lists outer ranges before inner ones, so later writes override.
    const counts = new Int32Array(src.length).fill(-1);
    for (const fn of entry.functions) {
      for (const r of fn.ranges) for (let i = r.startOffset; i < Math.min(r.endOffset, src.length); i++) counts[i] = r.count;
    }
    for (let i = 0; i < src.length; i++) if (counts[i] > 0) F.covered[i] = 1;
    for (const fn of entry.functions) {
      const r = fn.ranges[0];
      if (!fn.functionName && r.startOffset === 0) continue; // the script itself
      const rec = F.fns.get(r.startOffset) || { name: fn.functionName || '(anonymous)', line: lineOf(F.starts, r.startOffset), hit: false };
      if (r.count > 0) rec.hit = true;
      F.fns.set(r.startOffset, rec);
    }
  }
}

const report = {};
for (const [base, F] of Object.entries(files)) {
  const src = F.source;
  let inBlock = false, exec = 0, hit = 0;
  const uncovered = [];
  src.split('\n').forEach((text, idx) => {
    let t = text.trim();
    if (inBlock) { if (t.includes('*/')) { inBlock = false; t = t.slice(t.indexOf('*/') + 2).trim(); } else return; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) { inBlock = true; return; } t = t.slice(t.indexOf('*/') + 2).trim(); }
    if (!t || t.startsWith('//') || /^[)\]}]+[;,)]*$/.test(t)) return;
    exec++;
    const start = F.starts[idx], end = start + text.length;
    let any = false;
    for (let i = start; i < end; i++) if (F.covered[i] && /\S/.test(src[i])) { any = true; break; }
    if (any) hit++; else uncovered.push(idx + 1);
  });
  const fns = [...F.fns.values()];
  const fhit = fns.filter((f) => f.hit).length;
  report[base] = {
    lines: { exec, hit, pct: exec ? 100 * hit / exec : 100 },
    functions: { total: fns.length, hit: fhit, pct: fns.length ? 100 * fhit / fns.length : 100 },
    uncoveredFunctions: fns.filter((f) => !f.hit).map((f) => `${f.name}@${f.line}`),
    uncoveredLines: uncovered,
  };
}

const names = Object.keys(report).sort();
if (!names.length) { console.error('coverage-report: no coverage data found in ' + dir); process.exit(2); }
const f1 = (n) => n.toFixed(1) + '%';
for (const b of names) {
  const r = report[b];
  console.log(b.padEnd(24), 'lines', `${r.lines.hit}/${r.lines.exec}`.padEnd(10), f1(r.lines.pct).padStart(6), '  fns', `${r.functions.hit}/${r.functions.total}`.padEnd(8), f1(r.functions.pct).padStart(6));
}
let E = 0, H = 0, FT = 0, FH = 0;
for (const r of Object.values(report)) { E += r.lines.exec; H += r.lines.hit; FT += r.functions.total; FH += r.functions.hit; }
const totalPct = 100 * H / E;
console.log('TOTAL'.padEnd(24), 'lines', `${H}/${E}`.padEnd(10), f1(totalPct).padStart(6), '  fns', `${FH}/${FT}`.padEnd(8), f1(100 * FH / FT).padStart(6));

console.log('\nUncovered functions:');
for (const b of names) if (report[b].uncoveredFunctions.length) console.log('  ' + b + ': ' + report[b].uncoveredFunctions.join(', '));
console.log('\nUncovered lines:');
for (const b of names) if (report[b].uncoveredLines.length) console.log('  ' + b + ': ' + report[b].uncoveredLines.join(','));

if (!fs.existsSync(BASELINE_FILE)) {
  console.log('\nNo tests/coverage-baseline.json yet; skipping the ratchet check. Create it as { "lines": <total line % rounded down to one decimal> }.');
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).lines;
if (totalPct < baseline - TOLERANCE) {
  console.error(`\nFAIL: total line coverage ${totalPct.toFixed(1)}% is below baseline ${baseline}% minus ${TOLERANCE}.`);
  process.exit(1);
}
console.log(`\nOK: total line coverage ${totalPct.toFixed(1)}% vs baseline ${baseline}% (tolerance ${TOLERANCE}).`);
