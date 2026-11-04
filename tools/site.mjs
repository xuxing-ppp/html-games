import { readFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function catalog(base = root) {
  const context = {};
  vm.runInNewContext(await readFile(join(base, 'hall/catalog.js'), 'utf8'), context);
  return JSON.parse(JSON.stringify(context.GamesCatalog));
}
export async function readVersion(id, base = root) {
  const context = {};
  vm.runInNewContext(await readFile(join(base, 'games', id, 'version.js'), 'utf8'), context);
  return context.GAME_VERSION;
}
async function walk(directory, extensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Runtime symlink is not supported: ${path}`);
    if (entry.isDirectory()) files.push(...await walk(path, extensions));
    else if (extensions.includes(extname(entry.name))) files.push(path);
  }
  return files;
}
export async function runtimeFiles(base = root) {
  const files = ['index.html', 'hall/catalog.js', 'hall/order.js', 'hall/app.js', 'hall/style.css', 'hall/icon.svg'];
  for (const game of await catalog(base)) {
    files.push(`games/${game.id}/index.html`, `games/${game.id}/version.js`, `hall/previews/${game.id}.webp`);
    for (const [directory, extensions] of Object.entries(game.runtime)) {
      files.push(...(await walk(join(base, 'games', game.id, directory), extensions)).map(path => path.slice(base.length + 1).replaceAll('\\', '/')));
    }
    for (const file of game.files || []) files.push(`games/${game.id}/${file}`);
  }
  for (const file of files) {
    const info = await lstat(join(base, file));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular runtime file: ${file}`);
  }
  return [...new Set(files)].sort();
}
