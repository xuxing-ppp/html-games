// Focused regression for the weapon, pickup, Boss schedule and pause changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const elements = new Map();
function el(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll() { return []; } });
  return elements.get(id);
}
const ctx = { console, Math, setTimeout, clearTimeout, window: null, document: { getElementById: el, querySelectorAll() { return []; }, addEventListener() {} } };
ctx.window = ctx;
ctx.SV = {};
vm.createContext(ctx);
function load(file) { vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), ctx, { filename: file }); }
load('util.js'); load('config.js');
const SV = ctx.SV, C = SV.Config.CONST, W = SV.Config.WEAPONS;
assert.equal(C.HEALTH_PULL_RADIUS, C.PICKUP_RADIUS);
assert.deepEqual(Array.from(C.LATE_BOSS_TIMES), [930, 1050, 1140]);
assert.equal(C.ENDLESS_BOSS_FIRST, 1230);
assert.equal(C.ENDLESS_BOSS_EVERY, 90);
assert.equal(C.BOSS_AIM_LEAD_FACTOR, 0.45);
assert.equal(C.BOSS_AIM_LEAD_MAX_TIME, 0.45);
assert.equal(C.BOSS_AIM_LEAD_MAX_DIST, 90);
assert(W.meteor.stats(1).damage > 21 * 1.2);
assert(W.meteor.stats(1).radius > 52);
assert(W.railgun.stats(1).damage < 24.3);
assert(W.railgun.stats(8).damage > 99.9);
for (const id of Object.keys(W)) {
  const first = W[id].stats(1), last = W[id].stats(8);
  const attack = s => s.damage == null ? s.dot : s.damage;
  assert(Number.isFinite(attack(first)) && attack(first) > 0, `${id} has offensive output`);
  assert(Number.isFinite(attack(last)) && attack(last) >= attack(first), `${id} damage grows`);
  assert(attack(last) / attack(first) < 12, `${id} level growth stays bounded`);
  for (let lv = 1; lv <= 8; lv++) {
    const s = W[id].stats(lv);
    assert(Number.isFinite(attack(s)) && attack(s) > 0, `${id} L${lv} finite damage`);
    if (s.cooldown != null) assert(s.cooldown > 0 && s.cooldown < 10, `${id} L${lv} valid cooldown`);
  }
}
assert.equal(Object.values(SV.Config.BOSSES).filter(b => b.tier === 1).length, 6);
assert.equal(Object.values(SV.Config.BOSSES).filter(b => b.tier === 3).length, 6);
const expectedT1Hp = { duke: 980, scavenger: 875, frostwarden: 1035, bloodhunter: 900, riftsentry: 990, thornwarden: 1200 };
for (const [id, def] of Object.entries(SV.Config.BOSSES).filter(([, b]) => b.tier === 1)) {
  const scale = SV.Config.DIFFICULTY.normal.bossDmgMul * SV.Config.CURVES.dmgFactor(5);
  assert(def.dmg * scale <= 36, `${id} T1 normal contact damage`);
  if (def.attacks.projectile) {
    assert(Math.max(...def.attacks.projectile) * scale <= 15, `${id} T1 normal projectile damage`);
    const sniperShot = SV.Config.ENEMIES.sniper.projDmg * SV.Config.DIFFICULTY.normal.dmgMul * SV.Config.CURVES.dmgFactor(5);
    assert(Math.min(...def.attacks.projectile) * scale > sniperShot, `${id} T1 projectile exceeds sniper damage`);
  }
  assert.equal(def.hp, expectedT1Hp[id], `${id} T1 reinforced base HP`);
  if (def.mechanics && def.mechanics.warn) assert(def.mechanics.warn >= 0.7, `${id} readable T1 warning`);
}
const oldHpFactor = t => 1.2 + 0.22 * t + 0.012 * t * t + 0.0004 * t * t * t;
const oldBossHpFactor = t => 1 + 0.2 * t + 0.006 * t * t;
const oldEndlessMul = o => 1 + 0.22 * o + 0.01 * o * o;
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, `${label}: ${actual}`);
near(SV.Config.CURVES.hpFactor(5) / oldHpFactor(5), 1.30, '5m enemy HP ratio');
near(SV.Config.CURVES.hpFactor(9.5) / oldHpFactor(9.5), 1.50, '9.5m enemy HP ratio');
near(SV.Config.CURVES.hpFactor(13.5) / oldHpFactor(13.5), 1.55, '13.5m enemy HP ratio');
near(SV.Config.CURVES.hpFactor(18) / oldHpFactor(18), 1.63, '18m enemy HP ratio');
near(SV.Config.CURVES.hpFactor(20) / oldHpFactor(20), 1.65, '20m enemy HP ratio');
near(SV.Config.CURVES.bossHpFactor(5) / oldBossHpFactor(5), 2.00, '5m Boss HP ratio');
near(SV.Config.CURVES.bossHpFactor(9.5) / oldBossHpFactor(9.5), 2.25, '9.5m Boss HP ratio');
near(SV.Config.CURVES.bossHpFactor(13.5) / oldBossHpFactor(13.5), 2.25, '13.5m Boss HP ratio');
near(SV.Config.CURVES.bossHpFactor(18) / oldBossHpFactor(18), 2.28, '18m Boss HP ratio');
near(SV.Config.CURVES.bossHpFactor(20) / oldBossHpFactor(20), 2.30, '20m Boss HP ratio');
const enemy25Ratio = SV.Config.CURVES.hpFactor(25) * SV.Config.CURVES.endlessHpMul(5) / (oldHpFactor(25) * oldEndlessMul(5));
near(enemy25Ratio, 1.70, '25m endless enemy HP versus old curve');
const boss25Ratio = SV.Config.CURVES.bossHpFactor(25) * SV.Config.CURVES.endlessHpMul(5) / (oldBossHpFactor(25) * oldEndlessMul(5));
near(boss25Ratio, 2.35, '25m endless Boss HP versus old curve');
near(SV.Config.CURVES.dmgFactor(13.5), 1.75, '13.5m damage factor');
near(SV.Config.CURVES.dmgFactor(18), 2.05, '18m damage factor');
near(SV.Config.CURVES.dmgFactor(20), 2.20, '20m damage factor');
near(SV.Config.CURVES.dmgFactor(25) * SV.Config.CURVES.endlessDmgMul(5), 3.24, '25m endless damage factor');
for (let t = 9.5, prev = 0; t <= 30; t += 0.25) {
  const values = [SV.Config.CURVES.hpFactor(t), SV.Config.CURVES.bossHpFactor(t), SV.Config.CURVES.dmgFactor(t)];
  assert(values.every(Number.isFinite), `late curves finite at ${t}m`);
  if (prev) assert(values.every((v, i) => v >= prev[i]), `late curves monotonic at ${t}m`);
  prev = values;
}
const maxT3Contact18 = Math.max(...Object.values(SV.Config.BOSSES).filter(b => b.tier === 3).map(b => b.dmg))
  * SV.Config.DIFFICULTY.normal.bossDmgMul * C.T3_BOSS_DAMAGE_MUL
  * SV.Config.CURVES.dmgFactor(18);
assert(maxT3Contact18 < C.PLAYER_BASE_HP, 'normal 18m T3 Boss contact does not one-shot base HP');
const plague = SV.Config.WEAPON_EVOS.hex_poison.stats(8);
assert.deepEqual({ damage: plague.damage, frac: plague.frac, dot: plague.dot, dotDur: plague.dotDur }, { damage: 30, frac: 0.15, dot: 32, dotDur: 3.5 });
assert.deepEqual(Array.from(SV.Config.BOSSES.duke.attacks.projectile), [10, 10]);
assert.deepEqual(Array.from(SV.Config.BOSSES.scavenger.attacks.projectile), [10]);
assert.deepEqual(Array.from(SV.Config.BOSSES.frostwarden.attacks.projectile), [9]);
assert.deepEqual(Array.from(SV.Config.BOSSES.bloodhunter.attacks.projectile), [9]);
assert.deepEqual(Array.from(SV.Config.BOSSES.riftsentry.attacks.projectile), [8, 9]);
assert.deepEqual(Array.from(SV.Config.BOSSES.thornwarden.attacks.projectile), [9]);
assert.equal(SV.Config.BOSSES.wraith.tier, 2);
assert.equal(SV.Config.BOSSES.wraith.hp, 736);
assert.equal(SV.Config.BOSSES.wraith.dmg, 15);
assert.deepEqual(Array.from(SV.Config.BOSSES.wraith.attacks.projectile), [11]);
assert.deepEqual(Object.assign({}, SV.Config.BOSSES.wraith.mechanics), { orbitRadius: 250, orbitRate: 1.3, attackInterval: 2.1, shotSpeed: 260, enragedOrbitMul: 1.6, enragedInterval: 1.2, enrageRingInterval: 5, enrageRingShots: 6, enrageRingSpeed: 190 });
const annihilation = SV.Config.WEAPON_EVOS.blade_aura.stats(8);
assert.deepEqual({ damage: annihilation.damage, bladeTick: annihilation.bladeTick, splash: annihilation.splash, splashDamage: annihilation.splashDamage, auraDamage: annihilation.auraDamage, auraTick: annihilation.auraTick, pullRangeMul: annihilation.pullRangeMul, pullStopRatio: annihilation.pullStopRatio }, { damage: 46.2, bladeTick: 0.25, splash: 26, splashDamage: 27.72, auraDamage: 27.72, auraTick: 0.4, pullRangeMul: 1.3, pullStopRatio: 0.96 });
assert(annihilation.radius >= 201 && annihilation.radius <= 203, 'annihilation disk radius stays about 202');
const deathWheel = SV.Config.WEAPON_EVOS.blade_evo.stats(8);
assert.equal(deathWheel.spin, 3.2, 'death wheel uses readable contact-driven rotation');
const judgment = SV.Config.WEAPON_EVOS.sentry_hex.stats(8);
assert.equal(judgment.judgeFrac, 0.08, 'judgment array deals 8% max HP to normal enemies');
near(judgment.judgeFrac / 5, 0.016, 'judgment array deals 1.6% max HP to Bosses');
const chars = SV.Config.CHARACTERS;
assert.deepEqual(
  {
    bulwarkSpeed: chars.bulwark.speedMul, assassinHp: chars.assassin.hpMul, assassinHigh: chars.assassin.mechanics.highMul,
    collectorSpeed: chars.collector.speedMul, berserkerHp: chars.berserker.hpMul, berserkerHealing: chars.berserker.charMods.healingMul,
    berserkerFull: chars.berserker.mechanics.fullDamageMul, lingererSpeed: chars.lingerer.speedMul,
    lingererPickup: chars.lingerer.charMods.pickupMul, overclockerHp: chars.overclocker.hpMul,
    overclockerIncoming: chars.overclocker.mechanics.incomingMul, phantomHp: chars.phantom.hpMul
  },
  {
    bulwarkSpeed: 0.96, assassinHp: 0.95, assassinHigh: 0.9,
    collectorSpeed: 0.98, berserkerHp: 1, berserkerHealing: 0.65,
    berserkerFull: 0.95, lingererSpeed: 0.96,
    lingererPickup: 0.95, overclockerHp: 0.95,
    overclockerIncoming: 1.15, phantomHp: 0.95
  }
);
assert.deepEqual(
  { arcanistHp: chars.arcanist.hpMul, arcanistPickup: chars.arcanist.charMods.pickupMul, rangerHp: chars.ranger.hpMul, rangerPickup: chars.ranger.charMods.pickupMul },
  { arcanistHp: 0.85, arcanistPickup: 0.75, rangerHp: 0.85, rangerPickup: 0.8 },
  'weapon specialists retain their existing penalties'
);
let previousBossDifficulty = null;
for (const id of SV.Config.DIFFICULTY_ORDER) {
  const d = SV.Config.DIFFICULTY[id];
  for (const key of ['bossHpMul', 'bossDmgMul', 'bossSpeedMul', 'bossShotSpeedMul', 'bossTempoMul']) assert(Number.isFinite(d[key]) && d[key] > 0, `${id} ${key}`);
  if (previousBossDifficulty) for (const key of ['bossHpMul', 'bossDmgMul', 'bossSpeedMul', 'bossShotSpeedMul', 'bossTempoMul']) assert(d[key] > previousBossDifficulty[key], `${key} rises at ${id}`);
  previousBossDifficulty = d;
}
for (const tier of [1, 2, 3]) {
  const groupHp = Object.values(SV.Config.BOSSES).filter(b => b.tier === tier).map(b => b.hp * (b.count || 1));
  assert(Math.max(...groupHp) / Math.min(...groupHp) < 1.7, `T${tier} group HP has no extreme outlier`);
}
const firstBossMinute = { 1: 5, 2: 9.5, 3: 13.5 };
for (const [bossId, def] of Object.entries(SV.Config.BOSSES)) {
  for (const difficultyId of SV.Config.DIFFICULTY_ORDER) {
    const difficulty = SV.Config.DIFFICULTY[difficultyId], minute = firstBossMinute[def.tier];
    const tierMul = def.tier === 3 ? C.T3_BOSS_DAMAGE_MUL : 1;
    const contact = def.dmg * difficulty.bossDmgMul * SV.Config.CURVES.dmgFactor(minute) * tierMul;
    assert(contact < C.PLAYER_BASE_HP, `${bossId} ${difficultyId} first scheduled contact does not one-shot (${contact})`);
  }
}
const tierOnePools = new Set();
for (const stage of Object.values(SV.Config.STAGES)) {
  assert.equal(stage.bosses.length, 3);
  assert.equal(stage.bosses[0][0].length, 3);
  tierOnePools.add(stage.bosses[0][0].join(','));
  for (let tier = 1; tier <= 3; tier++) {
    const [pool, time] = stage.bosses[tier - 1];
    assert.equal(time, [300, 570, 810][tier - 1]);
    assert(pool.length >= 2);
    for (const id of pool) assert.equal(SV.Config.BOSSES[id].tier, tier, id);
  }
  assert(!stage.finale);
}
assert.equal(tierOnePools.size, 4, 'each map has a distinct T1 pool');
const maps = Object.values(SV.Config.STAGES);
for (let a = 0; a < maps.length; a++) for (let b = a + 1; b < maps.length; b++) {
  for (let tier = 0; tier < 3; tier++) {
    const shared = maps[a].bosses[tier][0].filter(id => maps[b].bosses[tier][0].includes(id));
    assert(shared.length <= 1, `${maps[a].name} and ${maps[b].name} T${tier + 1} overlap at most once`);
  }
}
const newBosses = ['scavenger', 'frostwarden', 'bloodhunter', 'riftsentry', 'thornwarden', 'stormherald', 'bloodoracle', 'furnace', 'voidseer', 'eclipseeye'];
for (const id of newBosses) assert(SV.Config.BOSSES[id]);

const spawns = [], spawnedBosses = [];
SV.Util.choice = arr => arr[0];
SV.Util.randInt = () => 2;
SV.Renderer = { cssSize: () => ({ w: 800, h: 500 }), cam: { zoom: 1 } };
SV.Entities = { addBoss(_s, id) { const e = { id }; spawns.push(id); spawnedBosses.push(e); return e; }, addEnemy() {} };
SV.Audio = { bossWarn() {} };
SV.Effects = { shake() {} };
SV.HUD = { toast() {} };
load('waves.js');
const state = { player: { x: 0, y: 0 }, stage: SV.Config.STAGES.ruins, difficulty: 'normal', enemies: [], time: 0, endless: false, charMods: {}, _bossLoot: {} };
SV.Waves.reset(state);
function at(time, endless = false) { state.time = time; state.endless = endless; SV.Waves.update(state, 1 / 60); }
at(300); assert.equal(spawns.length, 1);
at(570); assert.equal(spawns.length, 3); // 第一候选双生怨灵为双体 Boss
at(810); assert.equal(spawns.length, 4);
at(929); assert.equal(spawns.length, 4);
at(930); assert.equal(spawns.length, 5, 'first late member arrives at the scheduled time');
at(931); assert.equal(spawns.length, 5, 'second member remains queued');
at(932); assert.equal(spawns.length, 6); assert.equal(new Set(spawnedBosses.slice(-2).map(e => e.lootGroup)).size, 1, 'late wave shares one loot group'); let n = spawns.length;
at(1049); assert.equal(spawns.length, n);
at(1050); assert.equal(spawns.length, n + 1); at(1052); assert.equal(spawns.length, n + 2); n = spawns.length;
at(1140); assert.equal(spawns.length, n + 1); at(1142); assert.equal(spawns.length, n + 2); n = spawns.length;
at(1200, true); assert.equal(spawns.length, n);
at(1229, true); assert.equal(spawns.length, n);
at(1230, true); assert(spawns.length >= n + 2 && spawns.length <= n + 3); assert.equal(new Set(spawnedBosses.slice(-2).map(e => e.lootGroup)).size, 1, 'endless wave shares one loot group'); n = spawns.length;
at(1319, true); assert.equal(spawns.length, n);
at(1320, true); assert(spawns.length > n);

for (const stage of Object.values(SV.Config.STAGES)) {
  const allowed = new Set(stage.bosses.flatMap(pair => pair[0]));
  SV.Util.choice = arr => {
    if (arr.length === allowed.size) assert.deepEqual(new Set(arr), allowed, `${stage.name} uses complete map Boss pool`);
    return arr[0];
  };
  const mapState = { player: { x: 0, y: 0 }, stage, difficulty: 'normal', enemies: [], time: 0, endless: false, charMods: {}, _bossLoot: {} };
  SV.Waves.reset(mapState);
  const from = spawns.length;
  mapState.time = 1140;
  SV.Waves.update(mapState, 1 / 60);
  const late = spawns.slice(from);
  assert(late.length >= 6, `${stage.name} late waves spawn`);
  assert(late.every(id => allowed.has(id)), `${stage.name} late waves stay in map pool`);
  const endlessFrom = spawns.length;
  mapState.endless = true; mapState.time = 1230;
  SV.Waves.update(mapState, 1 / 60);
  assert(spawns.slice(endlessFrom).every(id => allowed.has(id)), `${stage.name} endless waves stay in map pool`);
}

// Each new Boss must execute its AI branch without throwing or emitting invalid shots.
const shots = [], playerHits = [];
SV.Entities.canEnemyRanged = () => true;
SV.Entities.addEShot = (_s, x, y, vx, vy, dmg, _color, _r, srcType) => shots.push({ x, y, vx, vy, dmg, srcType });
let mockEnemyId = 10000;
SV.Entities.addEnemy = (s, type, x, y) => {
  const def = SV.Config.ENEMIES[type];
  const o = { id: mockEnemyId++, type, ai: def.ai, x, y, hp: 1, r: def.r, speed: def.speed, projDmg: def.projDmg, color: def.color, t1: 0, t2: 0, cstate: 'walk', cdir: 0, vx: 0, vy: 0 };
  s.enemies.push(o); return o;
};
SV.Entities.damagePlayer = (_s, dmg, _ignore, srcType) => playerHits.push({ dmg, srcType });
SV.Effects.hit = () => {}; SV.Effects.ring = () => {};
SV.Weapons = { beams: [] };
SV.Game = { state: { player: { x: 0, y: 0, r: 14 }, enemies: [], eshots: [], hazards: [], time: 600, difficulty: 'normal', endless: false, stage: SV.Config.STAGES.ruins } };
load('ai.js');
{
  const sniper = { ai: 'sniper', x: 300, y: 0, speed: 60, projDmg: 11, color: '#fff', t1: 0, vx: 0, vy: 0 };
  shots.length = 0;
  SV.AI.update(SV.Game.state, sniper, 1 / 60);
  assert.equal(sniper.cstate, 'sniper_warn'); assert.equal(shots.length, 0, 'sniper warns before firing');
  for (let i = 0; i < Math.ceil(SV.Config.ENEMIES.sniper.shotWarn * 60) + 1; i++) SV.AI.update(SV.Game.state, sniper, 1 / 60);
  assert.equal(Math.hypot(shots[0].vx, shots[0].vy), 380, 'sniper projectile speed');
}
{
  const shooter = { ai: 'shooter', type: 'shooter', x: 300, y: 0, speed: 70, projDmg: 8, color: '#fff', t1: 0, vx: 0, vy: 0 };
  shots.length = 0;
  SV.AI.update(SV.Game.state, shooter, 1 / 60);
  assert.equal(shooter.cstate, 'shot_warn'); assert.equal(shots.length, 0, 'gunner warns before firing');
  for (let i = 0; i < Math.ceil(SV.Config.ENEMIES.shooter.shotWarn * 60) + 1; i++) SV.AI.update(SV.Game.state, shooter, 1 / 60);
  assert.equal(shots.length, 1, 'gunner fires after warning');
}
for (const id of newBosses) {
  const def = SV.Config.BOSSES[id];
  const boss = { bossType: id, ai: 'boss', x: 160, y: 0, r: def.r, speed: def.speed, t1: 0, t2: 0, ct: 0, cdir: 0, cstate: 'walk', color: def.color, hp: 100 };
  SV.Game.state.enemies = [boss];
  for (let frame = 0; frame < 150; frame++) SV.AI.update(SV.Game.state, boss, 1 / 60);
  assert(Number.isFinite(boss.vx) && Number.isFinite(boss.vy), `${id} movement`);
}
assert(shots.every(s => [s.x, s.y, s.vx, s.vy, s.dmg].every(Number.isFinite)), 'finite Boss shots');
assert(shots.some(s => s.srcType === 'bloodhunter'));
assert(shots.some(s => s.srcType === 'riftsentry'));
assert(shots.some(s => s.srcType === 'thornwarden'));
assert(shots.some(s => s.srcType === 'eclipseeye'));
assert(SV.Game.state.hazards.some(h => h.srcType === 'furnace'), 'furnace hazard attribution');

function signatureBoss(id) {
  const def = SV.Config.BOSSES[id];
  const boss = { bossType: id, ai: 'boss', x: 160, y: 0, r: def.r, speed: def.speed, t1: 0, t2: 99, ct: 0, cdir: 0, cstate: 'walk', color: def.color, hp: 100 };
  SV.Game.state.enemies = [boss]; shots.length = 0; playerHits.length = 0; SV.Weapons.beams.length = 0;
  return boss;
}
function frames(boss, count) { for (let i = 0; i < count; i++) SV.AI.update(SV.Game.state, boss, 1 / 60); }
function assertShotSpeed(expected, label) {
  assert(shots.length > 0, `${label} emits shots`);
  for (const shot of shots) assert(Math.abs(Math.hypot(shot.vx, shot.vy) - expected) < 1e-6, `${label} projectile speed`);
}
let sig = signatureBoss('scavenger');
frames(sig, 1); assert.equal(sig.cstate, 'tele');
frames(sig, Math.ceil(SV.Config.BOSSES.scavenger.mechanics.warn * 60) + Math.ceil(SV.Config.BOSSES.scavenger.mechanics.chargeDuration * 60) + 2);
assert.equal(shots.length, SV.Config.BOSSES.scavenger.mechanics.exitShots);
assertShotSpeed(220, 'scavenger exit fan');
sig = signatureBoss('frostwarden');
frames(sig, 1); assert.equal(sig.cstate, 'ice_warn'); assert.equal(shots.length, 0);
frames(sig, Math.ceil(SV.Config.BOSSES.frostwarden.mechanics.warn * 60) + 1); assert.equal(shots.length, 0); assert.equal(sig.cstate, 'ice_beam');
SV.Game.state.player.x = sig.x + Math.cos(sig.cdir - SV.Config.BOSSES.frostwarden.mechanics.flankAngle) * 200;
SV.Game.state.player.y = sig.y + Math.sin(sig.cdir - SV.Config.BOSSES.frostwarden.mechanics.flankAngle) * 200;
frames(sig, 1); assert(playerHits.some(h => h.srcType === 'frostwarden'), 'frostwarden laser damages along its warned line');
frames(sig, Math.ceil(SV.Config.BOSSES.frostwarden.mechanics.beamDuration * 60) + 1);
assert(SV.Weapons.beams.length >= 2, 'frostwarden emits paired laser visuals');
assert.equal(shots.length, 0, 'frostwarden replaces sparse flank projectiles with lasers');
assert.equal(sig.cstate, 'ice_follow');
frames(sig, Math.ceil(SV.Config.BOSSES.frostwarden.mechanics.follow * 60) + 1); assert.equal(shots.length, 1); assert.equal(sig.cstate, 'walk');
assert(Math.abs(Math.hypot(shots[0].vx, shots[0].vy) - 195) < 1e-6, 'frostwarden center projectile speed');
assert(SV.Config.BOSSES.frostwarden.attacks.laser[0] < SV.Config.BOSSES.frostwarden.attacks.projectile[0], 'frostwarden laser is low-damage space control');
SV.Game.state.player.x = 0; SV.Game.state.player.y = 0;

sig = signatureBoss('bloodhunter');
frames(sig, 1); assert.equal(sig.cstate, 'blood_mark'); assert.equal(shots.length, 0);
assert(Math.abs((sig.flankAX + sig.flankBX) / 2 - sig.markX) < 1e-9 && Math.abs((sig.flankAY + sig.flankBY) / 2 - sig.markY) < 1e-9, 'bloodhunter flanks center on marked player position');
assert(Math.abs(Math.hypot(sig.flankAX - sig.markX, sig.flankAY - sig.markY) - SV.Config.BOSSES.bloodhunter.mechanics.flankDist) < 1e-9, 'bloodhunter flank distance');
frames(sig, Math.ceil(SV.Config.BOSSES.bloodhunter.mechanics.warn * 60) + 1); assert.equal(shots.length, 4);
assert.equal(new Set(shots.map(s => `${s.x},${s.y}`)).size, 2, 'bloodhunter fires from both flanks');
assert(shots.every(s => Math.abs(s.x - sig.markX) < 1e-9), 'bloodhunter flank axis counters circular movement');
assertShotSpeed(215, 'bloodhunter flank');

sig = signatureBoss('riftsentry');
frames(sig, 1); assert.equal(sig.cstate, 'rift_open'); assert.equal(shots.length, 0);
assert(Math.abs((sig.flankAX + sig.flankBX) / 2 - sig.markX) < 1e-9 && Math.abs((sig.flankAY + sig.flankBY) / 2 - sig.markY) < 1e-9, 'riftsentry portals center on marked player position');
assert(Math.abs(Math.hypot(sig.flankAX - sig.markX, sig.flankAY - sig.markY) - SV.Config.BOSSES.riftsentry.mechanics.portalDist) < 1e-9, 'riftsentry portal distance');
frames(sig, Math.ceil(SV.Config.BOSSES.riftsentry.mechanics.warn * 60) + 1); assert.equal(shots.length, 4);
assert.equal(new Set(shots.map(s => `${s.x},${s.y}`)).size, 2, 'riftsentry fires from paired rifts');
assertShotSpeed(190, 'riftsentry crossfire');

sig = signatureBoss('thornwarden');
frames(sig, 1); assert.equal(sig.dr, SV.Config.BOSSES.thornwarden.mechanics.armor); assert.equal(shots.length, 0);
frames(sig, Math.ceil(SV.Config.BOSSES.thornwarden.mechanics.warn * 60) + 1); assert.equal(shots.length, 3); assert.equal(sig.dr, 0); assert.equal(sig.cstate, 'thorn_cool');
assertShotSpeed(215, 'thornwarden fan');

sig = signatureBoss('stormherald');
SV.Game.state.player.vx = 0; SV.Game.state.player.vy = 180;
frames(sig, 1); assert.equal(sig.cstate, 'storm_warn'); assert.equal(sig.sweepDir, -1); assert.equal(shots.length, 0);
frames(sig, Math.ceil(SV.Config.BOSSES.stormherald.mechanics.warn * 60) + 64); assert(shots.length >= 7 && shots.length <= 9);
assert(new Set(shots.map(s => Math.atan2(s.vy, s.vx).toFixed(2))).size > 2, 'stormherald sweeps angles');
SV.Game.state.player.vx = 0; SV.Game.state.player.vy = 0;

sig = signatureBoss('bloodoracle');
sig.t1 = 99; sig.t2 = 0;
frames(sig, 1); assert.equal(sig.cstate, 'ritual'); assert.equal(sig.ritualMinionIds.length, 2);
SV.Game.state = JSON.parse(JSON.stringify(SV.Game.state));
sig = SV.Game.state.enemies.find(e => e.bossType === 'bloodoracle');
SV.Game.state.enemies.find(e => e.id === sig.ritualMinionIds[0]).hp = 0;
frames(sig, 49); assert.equal(shots.length, 3, 'killing a ritual follower removes its volley');

sig = signatureBoss('magnetwarper'); sig.t2 = 99;
frames(sig, 1); assert.equal(sig.cstate, 'pull_warn'); assert.equal(shots.length, 0, 'magnetwarper warns before pulling');
frames(sig, Math.ceil(SV.Config.BOSSES.magnetwarper.mechanics.pullWarn * 60) + 1);
assert.equal(sig.cstate, 'pull'); assert.equal(shots.length, 12, 'magnetwarper opens with a pull ring after warning');
frames(sig, Math.ceil(SV.Config.BOSSES.magnetwarper.mechanics.pullDuration * 60) + 1);
assert.equal(shots.length, 20, 'magnetwarper releases a second ring after the pull');

sig = signatureBoss('architect'); sig.t1 = 99; sig.t2 = 99; sig.t3 = 0;
frames(sig, 1); assert.equal(sig.cstate, 'architect_warn'); assert.equal(shots.length, 0, 'architect offset barrage is warned');
frames(sig, Math.ceil(SV.Config.BOSSES.architect.mechanics.offsetWarn * 60) + 1);
assert.equal(shots.length, SV.Config.BOSSES.architect.mechanics.offsetShots * 2, 'architect fires paired offset rings after warning');
assert.equal(new Set(shots.map(s => `${s.x},${s.y}`)).size, 2, 'architect offset rings use two readable origins');

sig = signatureBoss('inquisitor'); sig.t2 = 99;
const inquisitorStart = [sig.x, sig.y];
frames(sig, 1); assert.equal(sig.cstate, 'judge_warn'); assert.equal(shots.length, 0, 'inquisitor warns before teleporting');
assert.deepEqual([sig.x, sig.y], inquisitorStart, 'inquisitor remains at origin during warning');
frames(sig, Math.ceil(SV.Config.BOSSES.inquisitor.mechanics.teleportWarn * 60) + 1);
assert.equal(shots.length, SV.Config.BOSSES.inquisitor.mechanics.ringShots + SV.Config.BOSSES.inquisitor.mechanics.arrivalShots, 'inquisitor fires origin and arrival rings after warning');

SV.Game.state.hazards = [];
sig = signatureBoss('furnace'); sig.t1 = 99; sig.t2 = 0;
frames(sig, 1); assert.equal(SV.Game.state.hazards.length, 2, 'furnace creates paired warned burn zones');
assert(SV.Game.state.hazards.every(h => h.warm === 1 && h.srcType === 'furnace'));

sig = signatureBoss('voidseer');
frames(sig, 1); assert.equal(sig.cstate, 'seer_warn'); assert.equal(shots.length, 0);
frames(sig, 42); assert.equal(sig.cstate, 'seer_echo'); assert.equal(shots.length, 6, 'voidseer arrival ring');
const oldX = sig.echoX, oldY = sig.echoY;
frames(sig, 29); assert.equal(shots.length, 14);
assert(shots.slice(6).every(s => s.x === oldX && s.y === oldY), 'voidseer echo fires from old position');

sig = signatureBoss('eclipseeye');
frames(sig, 1); assert.equal(sig.cstate, 'eclipse_charge'); assert.equal(shots.length, 0);
frames(sig, 55); const firstRing = shots.length; assert(firstRing >= 12 && firstRing < 16);
frames(sig, 34); assert.equal(shots.length, firstRing * 2);
assert(shots.every(s => Math.abs(Math.atan2(Math.sin(Math.atan2(s.vy, s.vx) - sig.gapAngle), Math.cos(Math.atan2(s.vy, s.vx) - sig.gapAngle))) >= 0.43), 'eclipse rings keep their safe gap');

sig = signatureBoss('eclipseeye'); sig.t1 = 99; sig.t2 = 0;
frames(sig, 1); assert.equal(shots.length, 3, 'eclipseeye fires between pulse rings');
assertShotSpeed(280, 'eclipseeye aimed fan');

SV.Game.state.player.x = 0; SV.Game.state.player.y = 0; SV.Game.state.player.vx = 0; SV.Game.state.player.vy = 1000;
sig = signatureBoss('voidseer'); sig.t1 = 99; sig.t2 = 0;
frames(sig, 1); assert.equal(shots.length, 3, 'voidseer predictive fan emits three shots');
const predictedCenter = shots[1], predictedAngle = Math.atan2(predictedCenter.vy, predictedCenter.vx);
const cappedAngle = Math.atan2(C.BOSS_AIM_LEAD_MAX_DIST, -160);
assert(Math.abs(predictedAngle - cappedAngle) < 1e-9, 'T3 prediction caps lead displacement');
SV.Game.state.player.vx = 0; SV.Game.state.player.vy = 0;
sig = signatureBoss('voidseer'); sig.t1 = 99; sig.t2 = 0;
frames(sig, 1); assert(Math.abs(shots[1].vy) < 1e-9 && shots[1].vx < 0, 'T3 prediction falls back to current aim when player is still');

sig = signatureBoss('wraith'); sig.enrage = true; sig.t1 = 99; sig.t3 = 0;
frames(sig, 1); assert.equal(shots.length, 6, 'enraged wraith adds a six-way radial barrage');
assertShotSpeed(190, 'enraged wraith ring');

sig = signatureBoss('colossus'); sig.t2 = 99;
frames(sig, 1); assert.equal(sig.cstate, 'sweep_warn'); assert.equal(SV.Weapons.beams.length, 0); assert.equal(playerHits.length, 0);
frames(sig, Math.ceil(SV.Config.BOSSES.colossus.mechanics.sweepWarn * 60) + 2);
assert.equal(sig.cstate, 'sweep'); assert(SV.Weapons.beams.length > 0, 'colossus laser begins only after warning');

SV.Game.state.difficulty = 'hard';
sig = signatureBoss('bloodhunter');
frames(sig, 1 + Math.ceil(SV.Config.BOSSES.bloodhunter.mechanics.warn * 60));
assertShotSpeed(215 * SV.Config.DIFFICULTY.hard.bossShotSpeedMul, 'hard difficulty Boss shot scaling');
assert(Math.abs(sig.t1 - SV.Config.BOSSES.bloodhunter.mechanics.interval / SV.Config.DIFFICULTY.hard.bossTempoMul) < 0.05, 'hard difficulty Boss cadence scaling');
sig = signatureBoss('riftsentry'); sig.t1 = 99;
frames(sig, 1);
assert(Math.abs(Math.hypot(sig.vx, sig.vy) - sig.speed * SV.Config.DIFFICULTY.hard.bossSpeedMul) < 1e-6, 'hard difficulty Boss movement scaling');
SV.Game.state.difficulty = 'normal';

// Render the actual pause weapon rows, including evolved and fusion weapons.
SV.Audio = null; SV.Effects = null;
SV.Entities.tid = id => id.replace(/_evo$/, '');
SV.Entities.weaponRecentDamage = () => null;
SV.Entities.mods = () => ({ maxHp: 100, speedMul: 1, damageMul: 1, cdMul: 1, areaMul: 1, armorMul: 1, regen: 0, critChance: 0, lifesteal: 0, pickupMul: 1, xpMul: 1, luck: 0 });
SV.Upgrades = { traitLabel: () => '', summary: () => 'stats' };
load('menus.js');
const pauseState = { charId: 'bulwark', startWeaponId: 'blade', weapons: [{ id: 'blade', level: 4 }, { id: 'missile_evo', level: 8, evolved: true }, { id: 'blade_aura', level: 8, evolved: true }], passives: {}, weaponDamage: {}, weaponActive: {}, encountered: { enemy: {}, boss: {} }, time: 0 };
SV.Menus.populatePause(pauseState);
let html = el('pauseArsenal').innerHTML;
assert(html.includes('进化条件：' + SV.Config.PASSIVES.maxhp.name + ' Lv5'));
assert.equal((html.match(/进化条件：/g) || []).length, 1);
pauseState.weapons = [{ id: 'railgun', level: 1 }];
SV.Menus.populatePause(pauseState);
html = el('pauseArsenal').innerHTML;
assert(html.includes('进化条件：' + SV.Config.PASSIVES.luck.name + ' Lv5'));

// Exercise pickup movement through the real player update path.
load('entities.js');
SV.Input = { axis: { x: 0, y: 0 } };
SV.Audio = { pickup() {}, die() {} };
SV.Effects = { text() {}, ring() {}, shake() {}, death() {}, explosion() {}, hit() {} };
SV.Game.onXP = () => {};
const pickState = { player: SV.Entities.makePlayer(), passives: {}, charMul: { hpMul: 1, speedMul: 1 }, charMods: {}, stage: SV.Config.STAGES.ruins, difficulty: 'normal', hazards: [], gems: [], pickups: [], enemies: [], time: 0, afterimages: [], xp: 0 };
pickState.pickups.push(SV.Entities.makePickup(70, 0, 'treasure'));
SV.Entities.updatePlayer(pickState, 1 / 60);
assert(pickState.pickups[0].pulled && pickState.pickups[0].x < 70);
pickState.pickups = [SV.Entities.makePickup(73, 0, 'health')];
pickState.player.hp = 50;
SV.Entities.updatePlayer(pickState, 1 / 60);
assert.equal(pickState.pickups[0].x, 73);
pickState.pickups[0].x = 70;
SV.Entities.updatePlayer(pickState, 1 / 60);
assert(pickState.pickups[0].x < 70);
pickState.pickups = [SV.Entities.makePickup(70, 0, 'health')];
pickState.player.hp = pickState.player.maxHp;
SV.Entities.updatePlayer(pickState, 1 / 60);
assert.equal(pickState.pickups[0].x, 70);

assert.equal(SV.Entities.eliteHealthDropLateFactor({ time: 600 }), 1, 'elite health drops unchanged through 10m');
assert(SV.Entities.eliteHealthDropLateFactor({ time: 1080 }) < SV.Entities.healthDropLateFactor({ time: 1080 }), 'elite health drops decay faster at 18m');
const lootState = {
  player: SV.Entities.makePlayer(), passives: {}, charMul: { hpMul: 1, speedMul: 1 }, charMods: {},
  stage: SV.Config.STAGES.ruins, difficulty: 'normal', enemies: [], gems: [], pickups: [], hazards: [], eshots: [],
  time: 0, kills: 0, bossFlags: { count: 2, wraithEnrage: false }, _bossLoot: {}, enemyDamage: {}, weaponDamage: {}, weaponActive: {}
};
const lootA = SV.Entities.makeBoss(lootState, 'duke', 0, 0), lootB = SV.Entities.makeBoss(lootState, 'architect', 10, 0);
Object.assign(lootA, { hp: 0, lootGroup: 7, bossSource: 'late' });
Object.assign(lootB, { lootGroup: 7, bossSource: 'late' });
lootState.enemies = [lootA, lootB];
SV.Entities.killEnemy(lootState, lootA);
assert.equal(lootState.gems.length, 0, 'non-final wave Boss drops no Boss gems');
assert.deepEqual(lootState.pickups.map(p => p.kind), ['health'], 'non-final wave Boss can only drop health');
lootB.hp = 0;
SV.Entities.killEnemy(lootState, lootB);
assert.equal(lootState.pickups.filter(p => p.kind === 'treasure').length, 1, 'final wave Boss drops the only chest');
assert.equal(lootState.gems.length, 8, 'final wave Boss drops the wave gems');

// Overlapping hostile bullets are consumed together, but only one can damage the
// player during the short projectile-only grace window.
SV.Spatial = { queryCircle() { return []; } };
SV.AI = { update() {} };
SV.Audio.hurt = () => {};
SV.Game.onPlayerDeath = () => {};
const burstState = {
  player: SV.Entities.makePlayer(), passives: {}, charMul: { hpMul: 1, speedMul: 1 }, charMods: {},
  stage: SV.Config.STAGES.ruins, difficulty: 'normal', hazards: [], gems: [], pickups: [], enemies: [],
  eshots: [], time: 0, afterimages: [], enemyDamage: {}, weaponDamage: {}, weaponActive: {}
};
burstState.eshots.push(
  { x: 0, y: 0, vx: 0, vy: 0, dmg: 10, r: 5, life: 1, srcType: 'shooter' },
  { x: 0, y: 0, vx: 0, vy: 0, dmg: 10, r: 5, life: 1, srcType: 'shooter' }
);
SV.Entities.updateEnemies(burstState, 1 / 60);
assert.equal(burstState.player.hp, burstState.player.maxHp - 10, 'overlapping hostile bullets deal one burst of damage');
assert.equal(burstState.eshots.length, 0, 'all overlapping hostile bullets are consumed');
burstState.eshots.push({ x: 0, y: 0, vx: 0, vy: 0, dmg: 10, r: 5, life: 1, srcType: 'shooter' });
SV.Entities.updateEnemies(burstState, 1 / 60);
assert.equal(burstState.player.hp, burstState.player.maxHp - 10, 'projectile grace blocks the immediate follow-up');
burstState.player.eshotIframe = 0;
burstState.player.burstIframe = 0;
burstState.eshots.push({ x: 0, y: 0, vx: 0, vy: 0, dmg: 10, r: 5, life: 1, srcType: 'shooter' });
SV.Entities.updateEnemies(burstState, 1 / 60);
assert.equal(burstState.player.hp, burstState.player.maxHp - 20, 'hostile bullets damage again after the grace window');
console.log('logic_test_balance: OK');
