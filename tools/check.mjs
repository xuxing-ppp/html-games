import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { catalog, readVersion, root, runtimeFiles } from './site.mjs';

const games = await catalog();
assert.equal(new Set(games.map(game => game.id)).size, games.length);
const files = await runtimeFiles();
const included = new Set(files);
for (const game of games) {
  assert.match(game.id, /^[a-z][a-z0-9_]+$/);
  const version = await readVersion(game.id);
  assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\([1-9]\d*\))?$/);
  assert((await readFile(join(root, 'games', game.id, 'index.html'), 'utf8')).includes('./version.js'));
  try { await access(join(root, 'games', game.id, '.git')); assert.fail(`Nested Git repository: ${game.id}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const file of files) {
  assert(!/(^|\/)(tests|tools|originals|reference|work|node_modules|releases)\//.test(file), file);
  if (file.endsWith('.js')) {
    const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
  if (file.endsWith('.html') || file.endsWith('.css')) {
    const source = await readFile(join(root, file), 'utf8');
    const references = file.endsWith('.html')
      ? [...source.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(match => match[1])
      : [...source.matchAll(/url\(\s*["']?([^\s)'";]+)["']?\s*\)/g)].map(match => match[1]);
    for (const reference of references) {
      if (/^(data:|https?:|#)/.test(reference) || reference.includes('${')) continue;
      const clean = reference.split(/[?#]/)[0];
      if (!clean || clean.endsWith('/')) continue;
      const path = resolve(dirname(join(root, file)), clean).slice(root.length + 1);
      assert(included.has(path), `${file}: missing runtime resource ${reference}`);
    }
  }
}
const app = await readFile(join(root, 'games/neon_survivor_mobile/js/app.js'), 'utf8');
assert(!app.includes('serviceWorker.register'));
const worker = await readFile(join(root, 'games/neon_survivor_mobile/sw.js'), 'utf8');
assert(!/addEventListener\(['"]fetch/.test(worker));
console.log(`PASS: ${games.length} versions, ${files.length} runtime files, syntax and static runtime references.`);
