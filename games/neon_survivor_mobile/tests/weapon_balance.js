// Practical weapon audit: node tests/weapon_balance.js --assert [--all|--bridge|--weapon ID]
// --all covers 221 forms at their stage times; --bridge compares L4/L5 at 10 min.
// --range ID is an isolated single-target mechanism check, not a balance score.
// JSON lines record each fixed-seed run. Tests stay local under ignored tests/.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
let seed = 1;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const math = Object.create(Math); math.random = random;
const box = { Math: math, console, window: null, document: {} };
box.window = box; box.SV = {};
vm.createContext(box);
for (const file of ['util', 'config', 'pool', 'spatial', 'entities', 'ai', 'weapons', 'waves', 'auto'])
  vm.runInContext(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), box, { filename: file + '.js' });
const SV = box.SV, C = SV.Config;
SV.Effects = new Proxy({}, { get: () => () => {} });
SV.Audio = new Proxy({}, { get: () => () => {} });
SV.HUD = { toast() {} };
SV.Input = { axis: { x: 0, y: 0 } };
SV.Renderer = { cam: { x: 0, y: 0, zoom: 1 }, cssSize: () => ({ w: 1180, h: 700 }) };
SV.Game = { state: null, onXP() {}, onPlayerDeath() { this.state.dead = true; } };
const baseIds = Object.keys(C.WEAPONS);
const evoIds = Object.keys(C.WEAPON_EVOS).filter(id => id.endsWith('_evo'));
const fusionIds = C.FUSIONS.map(f => f.to);
const minuteFor = (tier, level) => tier === 'evo' ? 14 : tier === 'fusion' ? 18 : level <= 4 ? 5 : 10;
const decks = {
  5: [['blade', 4], ['railgun', 4], ['sentry', 4], ['shotgun', 4]],
  10: [['blade', 8], ['railgun', 8], ['sentry', 8], ['shotgun', 8], ['poison', 8]],
  14: [['blade_evo', 8], ['railgun_evo', 8], ['sentry_evo', 8], ['shotgun_evo', 8], ['poison_evo', 8]],
  18: [['missile_chain', 8], ['railgun_grenade', 8], ['shotgun_grenade', 8], ['hex_poison', 8], ['grenade_meteor', 8]]
};
function makeState(minute, id, level) {
  const ch = C.CHARACTERS.allrounder;
  const passiveLevel = minute >= 18 ? 12 : minute >= 14 ? 8 : minute >= 10 ? 5 : 3;
  const s = { stage: C.STAGES.ruins, stageId: 'ruins', difficulty: 'hard', charId: 'allrounder',
    charMul: { hpMul: ch.hpMul, speedMul: ch.speedMul }, charMods: ch.charMods || {}, special: null,
    passives: { ...ch.startPassives, maxhp: passiveLevel, armor: passiveLevel,
      regen: passiveLevel, speed: passiveLevel, damage: passiveLevel,
      cooldown: passiveLevel, area: passiveLevel }, time: minute * 60, level: minute * 6, xp: 0,
    enemies: [], gems: [], pickups: [], eshots: [], hazards: [], afterimages: [],
    weaponDamage: {}, weaponActive: {}, weaponRecent: {}, enemyDamage: {}, skillDamage: {},
    encountered: { enemy: {}, boss: {} }, bossFlags: { count: 0 }, _bossLoot: {}, _bossGid: 0,
    kills: 0, player: SV.Entities.makePlayer(), dead: false, endless: false };
  SV.Game.state = s;
  const m = SV.Entities.mods(s);
  s.player.hp = s.player.maxHp = m.maxHp;
  SV.Weapons.init(s, id);
  s.weapons[0].level = level;
  s.weapons[0].evolved = !baseIds.includes(id);
  const companionSlots = decks[minute].length - 1;
  for (const [other, lv] of decks[minute]) {
    if (other === id || s.weapons.length > companionSlots) continue;
    s.weapons.push({ id: other, level: lv, cd: 0, angle: 0, evolved: !baseIds.includes(other) });
  }
  SV.Waves.reset(s);
  // Checkpoint starts after previously scheduled bosses; later waves still run.
  s.bossSpawned = s.stage.bosses.map(([, at]) => at <= s.time);
  s.spawnPause = 0;
  SV.Auto._lx = SV.Auto._ly = 0;
  SV.Input.axis.x = SV.Input.axis.y = 0;
  return s;
}
function run(id, level, minute, runSeed, seconds = 60) {
  seed = runSeed;
  const s = makeState(minute, id, level), dt = 1 / 60;
  let peak = 0, distanceSum = 0, distanceN = 0, closeFrames = 0;
  for (let frame = 0; frame < seconds * 60 && !s.dead; frame++) {
    s.time += dt;
    SV.Waves.update(s, dt);
    SV.Entities.rebuildGrid(s);
    SV.Entities.updateCharacterState(s, dt);
    SV.Weapons.updateAll(s, dt);
    SV.Auto.tick(s, dt);
    SV.Entities.updatePlayer(s, dt);
    SV.Entities.updateEnemies(s, dt);
    SV.Entities.envTick(s, dt);
    peak = Math.max(peak, SV.Weapons.proj.list.length);
    if (frame % 30 === 0 && s.enemies.length) {
      let nearest = Infinity;
      for (const e of s.enemies) if (e.hp > 0)
        nearest = Math.min(nearest, Math.hypot(e.x - s.player.x, e.y - s.player.y));
      if (Number.isFinite(nearest)) { distanceSum += nearest; distanceN++; if (nearest < 110) closeFrames++; }
    }
  }
  const survived = Math.min(seconds, s.time - minute * 60);
  return { id, level, minute, seed: runSeed, seconds: +survived.toFixed(1), hp: +s.player.hp.toFixed(1),
    damage: +(s.weaponDamage[SV.Entities.tid(id)] || 0).toFixed(1), kills: s.kills,
    taken: +Object.values(s.enemyDamage).reduce((a, b) => a + b, 0).toFixed(1),
    meanNearest: distanceN ? +(distanceSum / distanceN).toFixed(1) : null,
    closePct: distanceN ? +(100 * closeFrames / distanceN).toFixed(1) : 0, peak };
}
function checkLevels() {
  const problems = [];
  const higher = ['damage', 'dot', 'explodeDmg', 'count', 'radius', 'length', 'range', 'life', 'speed', 'dur', 'freeze'];
  const lower = ['cooldown', 'tick', 'fireCd'];
  const state = { passives: { ...C.CHARACTERS.allrounder.startPassives }, charId: 'allrounder',
    charMods: {}, special: null };
  for (const id of baseIds) for (let level = 1; level < 8; level++) {
    const old = SV.Weapons.stats({ id, level }, state);
    const next = SV.Weapons.stats({ id, level: level + 1 }, state);
    for (const key of higher) if (old[key] != null && next[key] != null && next[key] + 1e-9 < old[key])
      problems.push(`${id} L${level}->L${level + 1} ${key}: ${old[key]} -> ${next[key]}`);
    for (const key of lower) if (old[key] != null && next[key] != null && next[key] > old[key] + 1e-9)
      problems.push(`${id} L${level}->L${level + 1} ${key}: ${old[key]} -> ${next[key]}`);
  }
  return problems;
}
// Isolated, stationary single-target probe for range and hit-mechanism diagnosis only.
function rangeProbe(id, distance, seconds = 15) {
  seed = 0x51a7;
  const s = makeState(10, id, 8);
  s.weapons.length = 1;
  const e = SV.Entities.makeEnemy(s, 'brute', distance, 0);
  e.speed = e.dmg = e.regenRate = 0;
  e.hp = e.maxHp = 1e9;
  s.enemies = [e];
  for (let frame = 0; frame < seconds * 60; frame++) {
    SV.Entities.rebuildGrid(s);
    SV.Weapons.updateAll(s, 1 / 60);
    SV.Entities.updateEnemies(s, 1 / 60);
  }
  return +(s.weaponDamage[SV.Entities.tid(id)] || 0).toFixed(1);
}
if (process.argv.includes('--range')) {
  const id = process.argv[process.argv.indexOf('--range') + 1];
  if (!C.weaponDef(id)) throw Error('Unknown weapon: ' + id);
  console.log(JSON.stringify({ id, distances: [60, 95, 180, 260].map(d => [d, rangeProbe(id, d)]) }));
  process.exit(0);
}
const audit = process.argv.includes('--all');
const bridge = process.argv.includes('--bridge');
const requested = process.argv.includes('--weapon') ? process.argv[process.argv.indexOf('--weapon') + 1] : null;
const targets = requested ? [requested] : bridge ? baseIds : process.argv.includes('--fusions') ? fusionIds
  : audit ? [...baseIds, ...evoIds, ...fusionIds]
  : ['blade', 'missile', 'aura', 'railgun', 'polymorph', 'poison_evo', 'aura_poison'];
const rows = [];
for (const id of targets) {
  if (!C.weaponDef(id)) throw Error('Unknown weapon: ' + id);
  const tier = baseIds.includes(id) ? 'base' : id.endsWith('_evo') ? 'evo' : 'fusion';
  const levels = tier === 'base' && bridge ? [4, 5]
    : tier === 'base' && audit ? [1, 2, 3, 4, 5, 6, 7, 8] : [8];
  for (const level of levels) for (const runSeed of [0x51a7, 0x9273, 0xc314]) {
    const row = run(id, level, bridge ? 10 : minuteFor(tier, level), runSeed);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
if (process.argv.includes('--assert')) {
  const problems = checkLevels();
  if (baseIds.length !== 21 || evoIds.length !== 21 || fusionIds.length !== 32)
    problems.push('Weapon coverage differs from 21/21/32');
  for (const row of rows) if (row.peak > C.CONST.MAX_PROJECTILES)
    problems.push(`${row.id} projectile peak ${row.peak}`);
  if (bridge) {
    const median = values => values.sort((a, b) => a - b)[(values.length - 1) >> 1];
    for (const id of targets) {
      const dps = level => median(rows.filter(r => r.id === id && r.level === level)
        .map(r => r.damage / Math.max(1, r.seconds)));
      if (dps(5) < dps(4) * 0.9)
        problems.push(`${id} L4->L5 at 10min: ${dps(4).toFixed(1)} -> ${dps(5).toFixed(1)} DPS`);
    }
  }
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.error(`Audit passed: ${rows.length} live runs, all base upgrades monotonic`);
}
