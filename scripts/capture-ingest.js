#!/usr/bin/env node
// Turns a pasted outerHTML dump (.txt) and an optional screenshot into an
// offline capture under captures/<name>/, then reports which parts of the
// selector contract the capture satisfies and what changed since the last one.
//
//   npm run capture -- path/to/dump.txt [--screenshot path/to/shot.png] [--name label]
//
// Nothing here talks to the network. See captures/README.md.

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { checkContract, describeStructure } = require('../tests/helpers/selector-contract');

const root = path.resolve(__dirname, '..');
const capturesDir = path.join(root, 'captures');

function parseArgs(argv) {
  const args = { dump: null, screenshot: null, name: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--screenshot') args.screenshot = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (!args.dump) args.dump = a;
    else throw new Error(`Unexpected argument: ${a}`);
  }
  if (!args.dump) throw new Error('Usage: npm run capture -- <dump.txt> [--screenshot <image>] [--name <label>]');
  return args;
}

// Keeps structure, drops what makes a dump huge, remote, or unsafe to open offline.
function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '<svg></svg>')
    .replace(/<link\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/\s(?:src|href|poster|srcset)="(?:data:|https?:)[^"]*"/gi, '')
    .replace(/\sstyle="[^"]*url\([^)]*\)[^"]*"/gi, '')
    .replace(/\sdata-v-[a-f0-9]+=""/g, '');
}

function wrap(html) {
  if (/<html[\s>]/i.test(html)) return html;
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>capture</title></head>\n<body>\n${html}\n</body></html>\n`;
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function uniqueDir(name) {
  let dir = path.join(capturesDir, name);
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(capturesDir, `${name}-${n}`);
  return dir;
}

function latestPrevious(exceptDir) {
  if (!fs.existsSync(capturesDir)) return null;
  const dirs = fs.readdirSync(capturesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && path.join(capturesDir, d.name) !== exceptDir
      && fs.existsSync(path.join(capturesDir, d.name, 'structure.json')))
    .map((d) => d.name)
    .sort();
  return dirs.length ? path.join(capturesDir, dirs[dirs.length - 1]) : null;
}

function diffList(label, before, after) {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  if (!added.length && !removed.length) return [];
  return [`  ${label}:`, ...added.map((x) => `    + ${x}`), ...removed.map((x) => `    - ${x}`)];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dumpPath = path.resolve(args.dump);
  if (!fs.existsSync(dumpPath)) throw new Error(`Dump not found: ${dumpPath}`);
  if (args.screenshot && !fs.existsSync(path.resolve(args.screenshot))) {
    throw new Error(`Screenshot not found: ${path.resolve(args.screenshot)}`);
  }

  const raw = fs.readFileSync(dumpPath, 'utf8');
  if (!/data-module-name=/.test(raw)) {
    throw new Error('This dump has no data-module-name attributes, so it is probably not the annotation page. Nothing written.');
  }

  const dir = uniqueDir(args.name || stamp());
  fs.mkdirSync(dir, { recursive: true });
  const pagePath = path.join(dir, 'page.html');
  fs.writeFileSync(pagePath, wrap(sanitize(raw)));

  if (args.screenshot) {
    const ext = path.extname(args.screenshot) || '.png';
    fs.copyFileSync(path.resolve(args.screenshot), path.join(dir, `screenshot${ext}`));
  }

  const browser = await chromium.launch();
  let results;
  let structure;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto('file://' + pagePath.replace(/\\/g, '/'));
    results = await checkContract(page);
    structure = await describeStructure(page);
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify({ structure, contract: results }, null, 2));

  const rel = path.relative(root, dir);
  console.log(`Capture written to ${rel}/`);
  console.log(`  page.html (${Math.round(fs.statSync(pagePath).size / 1024)} KB, scripts/styles/remote URLs removed)`);
  if (args.screenshot) console.log('  screenshot copied');
  console.log(`  ${structure.moduleNames.length} module names, ${structure.cascaders} score cascaders, ${structure.textareas} textareas`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSelector contract: ${results.length - failed.length}/${results.length} satisfied`);
  for (const r of failed) console.log(`  MISSING ${r.id} (need >= ${r.min}, found ${r.found}) - ${r.why}`);

  const prevDir = latestPrevious(dir);
  if (prevDir) {
    const prev = JSON.parse(fs.readFileSync(path.join(prevDir, 'structure.json'), 'utf8')).structure;
    const lines = [
      ...diffList('module names', prev.moduleNames, structure.moduleNames),
      ...diffList('module keys', prev.moduleKeys, structure.moduleKeys),
    ];
    console.log(`\nChanges since ${path.relative(root, prevDir)}:`);
    console.log(lines.length ? lines.join('\n') : '  none in module names or keys');
  } else {
    console.log('\nNo earlier capture to compare against.');
  }

  console.log(`\nNext: npm test   (tests/capture-contract.spec.js now also checks ${rel}/page.html)`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(2);
});
