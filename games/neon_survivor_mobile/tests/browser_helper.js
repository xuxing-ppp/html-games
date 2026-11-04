const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
function playwright() {
  if (process.env.PLAYWRIGHT_CORE) return require(process.env.PLAYWRIGHT_CORE);
  try { return require('playwright-core'); }
  catch (_) { return require('/tmp/pwtest/node_modules/playwright-core'); }
}
function chromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  const versions = fs.readdirSync(cache).filter(x => /^chromium_headless_shell-/.test(x)).sort();
  if (!versions.length) throw new Error('Playwright Chromium is not installed; set PLAYWRIGHT_CHROMIUM');
  const base = path.join(cache, versions[versions.length - 1]);
  for (const folder of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64']) {
    const exe = path.join(base, folder, 'chrome-headless-shell');
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error('Cannot locate the Playwright Chromium executable; set PLAYWRIGHT_CHROMIUM');
}
module.exports = { chromium: playwright().chromium, chromiumExecutable, root, indexURL: pathToFileURL(path.join(root, 'index.html')).href };
