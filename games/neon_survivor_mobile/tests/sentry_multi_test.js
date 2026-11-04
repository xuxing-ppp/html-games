// node tests/sentry_multi_test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const box = { window: null, document: {}, console, Math };
box.window = box; box.SV = {};
vm.createContext(box);
for (const name of ['util', 'config', 'pool', 'spatial', 'entities', 'ai', 'weapons'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', name + '.js'), 'utf8'), box);
const SV = box.SV;
SV.Effects = new Proxy({}, { get: () => () => {} });
SV.Audio = new Proxy({}, { get: () => () => {} });
const s = { stage: SV.Config.STAGES.ruins, difficulty: 'hard', charId: 'allrounder',
  charMul: {}, charMods: {}, passives: {}, time: 18 * 60, enemies: [], eshots: [],
  weaponDamage: {}, weaponActive: {}, player: SV.Entities.makePlayer() };
SV.Game = { state: s };
SV.Weapons.init(s, 'sentry_evo');
s.weapons.push({ id: 'boomerang_sentry', level: 1, cd: 0, angle: 0, evolved: true });
s.weapons.push({ id: 'chain_sentry', level: 1, cd: 0, angle: 0, evolved: true });
s.weapons.push({ id: 'sentry_hex', level: 1, cd: 0, angle: 0, evolved: true });
const enemy = SV.Entities.makeEnemy(s, 'brute', 180, 0);
enemy.hp = enemy.maxHp = 1e9; enemy.speed = enemy.dmg = enemy.regenRate = 0;
s.enemies.push(enemy);
for (let i = 0; i < 60; i++) {
  SV.Entities.rebuildGrid(s);
  SV.Weapons.updateAll(s, 1 / 60);
}
let expected = 0;
for (const w of s.weapons) {
  const count = SV.Weapons.stats(w, s).count;
  assert.strictEqual(w.sentries.length, count, w.id + ' owns its turrets');
  expected += count;
}
assert.strictEqual(s.player.sentries.length, expected, 'renderer sees all turrets');
assert.strictEqual(new Set(s.player.sentries).size, expected, 'turrets are independent objects');
for (const w of s.weapons)
  assert.ok(s.weaponDamage[SV.Entities.tid(w.id)] > 0, w.id + ' attacks independently');
console.log('multi-sentry regression passed: ' + expected + ' independent turrets');
