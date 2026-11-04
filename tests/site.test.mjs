import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { root, runtimeFiles } from '../tools/site.mjs';

const cleanup = await readFile(join(root, 'games/neon_survivor_mobile/retire-offline.js'), 'utf8');
function storage() {
  const data = new Map([
    ['neon-survivor-v2.10.6', new Set(['https://test/Games/games/neon_survivor_mobile/index.html', 'https://test/neon-survivor/index.html'])],
    ['another-game-v1', new Set(['https://test/Games/games/car_racing/index.html'])],
    ['neon-survivor-v1', new Set(['https://test/Games/games/neon_survivor_mobile/audio/menu_loop.mp3'])]
  ]);
  return { data, caches: {
    keys: async () => [...data.keys()],
    open: async name => ({ keys: async () => [...data.get(name)].map(url => ({ url })), delete: async request => data.get(name).delete(request.url) }),
    delete: async name => data.delete(name)
  } };
}
test('cleanup removes only this path in legacy Neon caches', async () => {
  const { data, caches } = storage();
  const context = vm.createContext({ caches });
  vm.runInContext(cleanup, context);
  await context.clearNeonCache('https://test/Games/games/neon_survivor_mobile/');
  assert.deepEqual([...data.get('neon-survivor-v2.10.6')], ['https://test/neon-survivor/index.html']);
  assert(data.has('another-game-v1'));
  assert(!data.has('neon-survivor-v1'));
  await context.clearNeonCache('https://test/Games/games/neon_survivor_mobile/'); // Idempotent.
  assert(data.has('another-game-v1'));
});
test('retirement unregisters without fetch handlers or forced navigation', async () => {
  const { caches } = storage();
  const events = {}, calls = [];
  const self = { registration: { scope:'https://test/Games/games/neon_survivor_mobile/', unregister: async () => calls.push('unregister') },
    clients: { claim: async () => calls.push('claim') }, skipWaiting: async () => calls.push('skip'),
    addEventListener: (event, handler) => { events[event] = handler; } };
  const context = vm.createContext({ caches, self, importScripts: () => vm.runInContext(cleanup, context) });
  vm.runInContext(await readFile(join(root, 'games/neon_survivor_mobile/sw.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(events), ['install', 'activate']);
  const pending = [];
  events.install({ waitUntil: promise => pending.push(promise) });
  events.activate({ waitUntil: promise => pending.push(promise) });
  await Promise.all(pending);
  assert.deepEqual(calls, ['skip', 'claim', 'unregister']);
});
test('runtime resources include libraries, music and compressed paintings', async () => {
  const files = await runtimeFiles();
  assert(files.includes('games/car_racing/lib/THREE-LICENSE.txt'));
  assert(files.includes('games/neon_survivor_mobile/audio/menu_loop.mp3'));
  assert(files.includes('games/ming_magistrate/assets/runtime/county-ink.webp'));
  assert(!files.some(file => /\.(png|zip|ndjson|tsv)$/.test(file)));
});
