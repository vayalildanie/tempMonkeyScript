// Merge per-test V8 block coverage into per-file line/function coverage.
// Usage: node merge.js <covDir> <outJson>
const fs = require('fs');
const path = require('path');
const [dir, out] = process.argv.slice(2);

const files = {}; // base -> { source, covered: Uint8Array, fns: Map(key -> {name, line, hit, tests:Set}), lineTests: Map(line -> Set(specFile)) }

function lineStarts(src) { const s = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') s.push(i + 1); return s; }
function lineOf(starts, off) { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; }

for (const f of fs.readdirSync(dir)) {
  const { name, file: spec, cov } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const entry of cov) {
    const base = path.basename(entry.url.replace(/\\/g, '/'));
    const src = entry.source;
    if (!files[base]) files[base] = { source: src, starts: lineStarts(src), covered: new Uint8Array(src.length), fns: new Map(), specsPerLine: new Map() };
    const F = files[base];
    // innermost-range-wins: apply ranges in order (V8 lists outer before inner)
    const counts = new Int32Array(src.length).fill(-1);
    for (const fn of entry.functions) {
      for (const r of fn.ranges) for (let i = r.startOffset; i < Math.min(r.endOffset, src.length); i++) counts[i] = r.count;
    }
    for (let i = 0; i < src.length; i++) if (counts[i] > 0) F.covered[i] = 1;
    for (const fn of entry.functions) {
      const r = fn.ranges[0];
      if (!fn.functionName && r.startOffset === 0) continue; // the script itself
      const key = r.startOffset;
      const rec = F.fns.get(key) || { name: fn.functionName || '(anonymous)', line: lineOf(F.starts, r.startOffset), hit: false, specs: new Set() };
      if (r.count > 0) { rec.hit = true; rec.specs.add(spec); }
      F.fns.set(key, rec);
    }
    // which spec files touch each line (for overlap analysis)
    for (let i = 0; i < src.length; i++) if (counts[i] > 0 && /\S/.test(src[i])) {
      const ln = lineOf(F.starts, i);
      if (!F.specsPerLine.has(ln)) F.specsPerLine.set(ln, new Set());
      F.specsPerLine.get(ln).add(spec);
    }
  }
}

const report = {};
for (const [base, F] of Object.entries(files)) {
  const src = F.source;
  const lines = src.split('\n');
  let inBlock = false, exec = 0, hit = 0;
  const uncovered = [];
  const breadth = {};
  lines.forEach((text, idx) => {
    let t = text.trim();
    if (inBlock) { if (t.includes('*/')) { inBlock = false; t = t.slice(t.indexOf('*/') + 2).trim(); } else return; }
    if (t.startsWith('/*')) { if (!t.includes('*/')) { inBlock = true; return; } t = t.slice(t.indexOf('*/') + 2).trim(); }
    if (!t || t.startsWith('//') || /^[)\]}]+[;,)]*$/.test(t)) return; // blanks, comments, lone closers
    exec++;
    const start = F.starts[idx], end = start + text.length;
    let any = false;
    for (let i = start; i < end; i++) if (F.covered[i] && /\S/.test(src[i])) { any = true; break; }
    if (any) { hit++; const n = (F.specsPerLine.get(idx + 1) || new Set()).size; breadth[n] = (breadth[n] || 0) + 1; }
    else uncovered.push(idx + 1);
  });
  const fns = [...F.fns.values()];
  report[base] = {
    lines: { exec, hit, pct: +(100 * hit / exec).toFixed(1) },
    functions: { total: fns.length, hit: fns.filter((f) => f.hit).length, pct: +(100 * fns.filter((f) => f.hit).length / fns.length).toFixed(1) },
    uncoveredFunctions: fns.filter((f) => !f.hit).map((f) => `${f.name}@${f.line}`),
    uncoveredLines: uncovered,
    specBreadthPerCoveredLine: breadth,
  };
}
fs.writeFileSync(out, JSON.stringify(report, null, 1));
for (const [b, r] of Object.entries(report)) console.log(b.padEnd(22), 'lines', `${r.lines.hit}/${r.lines.exec}`, r.lines.pct + '%', ' fns', `${r.functions.hit}/${r.functions.total}`, r.functions.pct + '%');
let E = 0, H = 0, FT = 0, FH = 0; for (const r of Object.values(report)) { E += r.lines.exec; H += r.lines.hit; FT += r.functions.total; FH += r.functions.hit; }
console.log('TOTAL'.padEnd(22), 'lines', `${H}/${E}`, (100 * H / E).toFixed(1) + '%', ' fns', `${FH}/${FT}`, (100 * FH / FT).toFixed(1) + '%');
