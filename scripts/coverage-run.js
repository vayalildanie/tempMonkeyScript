// npm run coverage: run the whole Playwright suite with COV_DIR set, then report.
// COV_DIR lives under the OS temp dir, so nothing lands in the repo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const covDir = path.join(os.tmpdir(), 'tempmonkeyscript-coverage');
fs.rmSync(covDir, { recursive: true, force: true });
fs.mkdirSync(covDir, { recursive: true });

const root = path.join(__dirname, '..');
// shell: true so `npx` resolves on Windows (npx.cmd).
const run = spawnSync('npx playwright test', { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, COV_DIR: covDir } });
const testsFailed = run.status !== 0;
if (testsFailed) console.error('\ncoverage-run: the test run failed (exit ' + run.status + '); reporting anyway.\n');

const report = spawnSync(process.execPath, [path.join(__dirname, 'coverage-report.js'), covDir], { cwd: root, stdio: 'inherit' });
process.exit(testsFailed ? (run.status || 1) : report.status);
