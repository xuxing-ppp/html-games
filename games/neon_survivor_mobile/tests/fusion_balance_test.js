// Repeatable combat benchmark for all fusion weapons. Ratios are diagnostics, not targets.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const root = path.resolve(__dirname, "..");
let seed = 123456789;
const rng = Object.create(Math);
rng.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
const ctx = { Math: rng, console, window: null };
ctx.window = ctx;
ctx.SV = {};
vm.createContext(ctx);
for (const name of ["util", "config", "pool", "spatial", "effects", "entities", "weapons"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "js", name + ".js"), "utf8"), ctx, { filename: name + ".js" });
}
const SV = ctx.SV;
SV.Audio = { shoot() {}, hit() {}, die() {}, evolve() {}, hurt() {}, bossWarn() {} };
SV.AI = { update(_s, e, _dt) { e.vx = 0; e.vy = 0; } };
SV.Game = { state: null, onPlayerDeath() {} };
SV.Input = { axis: { x: 0, y: 0 } };
SV.Renderer = { cam: { x: 0, y: 0, zoom: 1 }, cssSize: () => ({ w: 800, h: 600 }) };

const dt = 1 / 30;
const frames = 1800; // 60 simulated seconds; count the last 55 seconds.
function makeState(id) {
  const s = {
    difficulty: "normal", endless: false, time: 600, level: 30,
    stage: { half: 2000, goalMin: 1200 }, player: SV.Entities.makePlayer(),
    enemies: [], gems: [], pickups: [], eshots: [], hazards: [],
    weapons: [], passives: {}, charMods: {}, special: null, _mods: null,
    weaponDamage: {}, weaponActive: {}, weaponRecent: {}, enemyDamage: {},
    kills: 0, bossFlags: { count: 0 }, encountered: { enemy: {}, boss: {} }
  };
  SV.Game.state = s;
  SV.Weapons.init(s, id);
  s.weapons[0].level = 8;
  return s;
}
function spawn(s, scene, index, distance) {
  let e;
  if (scene === "boss") {
    e = SV.Entities.makeBoss(s, "colossus", distance, 0);
    e.hp = e.maxHp = 7500;
  } else {
    const a = index * Math.PI * 2 / 24;
    const r = distance + (index % 5) * 18;
    e = SV.Entities.makeEnemy(s, index % 3 === 0 ? "brute" : "zombie", Math.cos(a) * r, Math.sin(a) * r);
    e.hp = e.maxHp = index % 3 === 0 ? 420 : 240;
  }
  e.dmg = e.boomDmg = e.projDmg = 0;
  e.speed = e.regenRate = 0;
  s.enemies.push(e);
}
// Death Wheel damage is driven by visible blade contact rather than a per-target timer.
{
  const s = makeState("blade_evo"), w = s.weapons[0], spec = SV.Weapons.stats(w, s), step = 1 / 60;
  w.angle = 0;
  const target = SV.Entities.makeEnemy(s, "brute", Math.cos(spec.spin * step) * spec.radius, Math.sin(spec.spin * step) * spec.radius);
  target.hp = target.maxHp = 1e9; target.speed = target.dmg = 0; s.enemies = [target];
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, step);
  assert(Math.abs((1e9 - target.hp) - spec.damage) < 1e-6, `first visible blade contact deals one hit (${1e9 - target.hp} vs ${spec.damage})`);
  const afterFirst = target.hp;
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, 1 / 600);
  assert.strictEqual(target.hp, afterFirst, "the same blade does not repeat damage while still overlapping");
  for (let frame = 2; frame < 600; frame++) { SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, step); }
  const dealt = 1e9 - target.hp, expected = spec.damage * spec.count * spec.spin / (Math.PI * 2) * 10;
  assert(Math.abs(dealt / expected - 1) < 0.05, `contact-driven DPS stays near the old cap (${dealt} vs ${expected})`);

  const normal = SV.Weapons.stats(w, s);
  s.charId = "overclocker"; s.special = "overclocker"; s.overclockActive = 1;
  const boosted = SV.Weapons.stats(w, s);
  assert(Math.abs(boosted.spin / normal.spin - 1.2) < 1e-9, "overclock visibly accelerates Death Wheel rotation");
  assert(Math.abs(boosted.damage / normal.damage - 1.2) < 1e-9, "overclock retains its Death Wheel damage multiplier");
}
// Judgment Array keeps five-shot cadence while applying the configured HP fraction and Boss divisor.
for (const boss of [false, true]) {
  const s = makeState("sentry_hex"), spec = SV.Weapons.stats(s.weapons[0], s);
  const target = boss ? SV.Entities.makeBoss(s, "duke", 300, 0) : SV.Entities.makeEnemy(s, "brute", 300, 0);
  target.hp = target.maxHp = 10000; target.speed = target.dmg = 0; s.enemies = [target];
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, 1 / 60);
  const expected = spec.damage * spec.judgeHits + spec.judgeDmg + target.maxHp * spec.judgeFrac * (boss ? 1 / 5 : 1);
  assert(Math.abs((10000 - target.hp) - expected) < 1e-8, `Judgment Array applies ${boss ? "Boss" : "normal"} max-HP damage`);
  assert.strictEqual(target._judgeHits, 0, "judgment consumes all five marks");
  assert.strictEqual(target._judgeLock, spec.judgeLock, "judgment starts its configured lockout");
}
// Annihilation Wheel uses one explicit ruleset for its disk, blades, and pull boundary.
{
  const s = makeState("blade_aura"), spec = SV.Weapons.stats(s.weapons[0], s);
  s.enemies = [];
  const inside = SV.Entities.makeEnemy(s, "brute", spec.radius - 60, 0);
  const outside = SV.Entities.makeEnemy(s, "brute", spec.radius + 35, 0);
  for (const e of [inside, outside]) { e.hp = e.maxHp = 1e6; e.speed = e.dmg = 0; e.bladeCd = 99; }
  s.enemies.push(inside, outside);
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, 1 / 60);
  assert(Math.abs((1e6 - inside.hp) - spec.auraDamage) < 1e-9, "disk damages enemies inside its full radius");
  assert.strictEqual(outside.hp, 1e6, "disk does not damage enemies outside its radius");
  assert(Math.abs(s.player.bladeAuraVisual.radius - spec.radius) < 1e-9, "disk visual uses the gameplay radius");
}
{
  const s = makeState("blade_aura"), spec = SV.Weapons.stats(s.weapons[0], s), dtBlade = 1 / 60;
  s.weapons[0].cd = 1; // isolate blade contact and its splash from the disk pulse
  const angle = spec.spin * dtBlade;
  const target = SV.Entities.makeEnemy(s, "brute", Math.cos(angle) * spec.radius, Math.sin(angle) * spec.radius);
  target.hp = target.maxHp = 1e6; target.speed = target.dmg = 0; s.enemies = [target];
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, dtBlade);
  assert(Math.abs((1e6 - target.hp) - spec.damage - spec.splashDamage) < 1e-8, "blade contact applies explicit direct and splash damage");
  assert(Math.abs(target.bladeCd - spec.bladeTick) < 1e-9, "blade contact uses its configured per-target interval");
}
for (const step of [1 / 60, 0.5]) {
  const s = makeState("blade_aura"), spec = SV.Weapons.stats(s.weapons[0], s), stop = spec.radius * spec.pullStopRatio;
  const enemy = SV.Entities.makeEnemy(s, "brute", spec.radius * 1.12, 0);
  enemy.hp = enemy.maxHp = 1e9; enemy.speed = enemy.dmg = 0; enemy.bladeCd = 99;
  s.enemies = [enemy];
  for (let i = 0; i < 300 && enemy.x > stop + 1e-8; i++) { SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, step); }
  assert(enemy.x >= stop - 1e-8 && enemy.x <= stop + 1e-7, `pull clamps at 96% orbit for dt=${step}`);
  const held = enemy.x; SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, step);
  assert(Math.abs(enemy.x - held) < 1e-9, "enemy no longer approaches inside the stop radius");
  const boss = SV.Entities.makeBoss(s, "duke", spec.radius * 1.12, 0), bossX = boss.x;
  boss.hp = boss.maxHp = 1e9; boss.speed = boss.dmg = 0; boss.bladeCd = 99; s.enemies = [boss];
  SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, step);
  assert.strictEqual(boss.x, bossX, "Boss is immune to Annihilation Wheel pull");
}
function measure(id, scene, bossDistance) {
  seed = 123456789;
  const s = makeState(id);
  const n = scene === "boss" ? 1 : 24;
  for (let i = 0; i < n; i++) spawn(s, scene, i, bossDistance);
  let warm = 0;
  for (let frame = 0; frame < frames; frame++) {
    const t = frame * dt;
    s.player.x = 28 * Math.sin(t * 0.47);
    s.player.y = 24 * Math.sin(t * 0.32);
    s.player.facing = 0;
    SV.Entities.rebuildGrid(s);
    SV.Weapons.updateAll(s, dt);
    SV.Entities.updatePlayer(s, dt);
    SV.Entities.updateEnemies(s, dt);
    while (s.enemies.length < n) spawn(s, scene, scene === "boss" ? 0 : (frame + s.enemies.length) % 24, bossDistance);
    s.gems.length = s.pickups.length = s.eshots.length = 0;
    if (frame === 149) warm = s.weaponDamage[SV.Entities.tid(id)] || 0;
  }
  return ((s.weaponDamage[SV.Entities.tid(id)] || 0) - warm) / 55;
}
// Arc fields from one weapon resolve independently, so overlapping Full-Moon Slash trails stack.
{
  const s = makeState("crescent_evo");
  s.weapons.length = 0;
  const e = SV.Entities.makeEnemy(s, "brute", 100, 0);
  e.hp = e.maxHp = 1e9; e.speed = e.dmg = 0;
  s.enemies = [e]; s.time = 600;
  SV.Weapons.arcFields.push(
    { fieldId: 9001, kind:"sector", x:0, y:0, dir:0, arc:1, inner:70, outer:130, damage:10, life:1, max:1, every:0.4, tick:0, color:"#fff", wid:"crescent_evo" },
    { fieldId: 9002, kind:"sector", x:0, y:0, dir:0, arc:1, inner:70, outer:130, damage:10, life:1, max:1, every:0.4, tick:0, color:"#fff", wid:"crescent_evo" }
  );
  SV.Entities.rebuildGrid(s);
  SV.Weapons.updateAll(s, dt);
  assert.strictEqual(s.weaponDamage.crescent, 20, "overlapping Full-Moon Slash trails stack");
  SV.Weapons.arcFields.length = 0;
}
// Poison shortening the last fraction of a hex fuse must trigger the explosion.
{
  const s = makeState("hex_poison");
  s.weapons.length = 0;
  spawn(s, "swarm", 0);
  const e = s.enemies[0];
  e.hex = 0.1; e.hexDmg = 25; e.hexFrac = 0; e.hexWid = "hex_poison";
  e.poison = 1; e.poisonTick = 0; e.poisonDmg = 0; e.poisonWid = "hex_poison"; e.poisonHexCut = 0.15;
  SV.Entities.rebuildGrid(s);
  SV.Entities.updateEnemies(s, dt);
  assert.strictEqual(e.hex, 0);
  assert.strictEqual(s.weaponDamage.hex_poison, 25);
}
const evolutionPairs = Object.entries(SV.Config.EVOLUTIONS).map(([base, evo]) => ({ base, evo: evo.to }));
const ids = [...new Set([...evolutionPairs.flatMap(pair => [pair.base, pair.evo]), ...SV.Config.FUSIONS.flatMap(f => [f.w1, f.w2, f.to])])];
const values = {};
for (const id of ids) values[id] = {
  boss: Math.max(...[60, 95, 135, 175, 210].map(distance => measure(id, "boss", distance))),
  swarm: Math.max(...[65, 105, 145, 185].map(distance => measure(id, "swarm", distance)))
};
const rows = SV.Config.FUSIONS.map(f => {
  const bossBase = Math.max(values[f.w1].boss, values[f.w2].boss);
  const swarmBase = Math.max(values[f.w1].swarm, values[f.w2].swarm);
  return { id: f.to, boss: values[f.to].boss / bossBase, swarm: values[f.to].swarm / swarmBase,
    fusionBoss: values[f.to].boss, bossBase, fusionSwarm: values[f.to].swarm, swarmBase };
});
const plagueRow = rows.find(r => r.id === "hex_poison");
assert(plagueRow && plagueRow.boss > 1 && plagueRow.swarm > 1, "腐朽天灾削弱后仍应强于两件材料中的较强者");
function ratio(next, base) { return base > 0 ? next / base : next > 0 ? Infinity : 1; }
const evoRows = evolutionPairs.map(pair => ({ id: pair.evo,
  boss: ratio(values[pair.evo].boss, values[pair.base].boss),
  swarm: ratio(values[pair.evo].swarm, values[pair.base].swarm) }));
for (const r of evoRows) console.log(`${r.id.padEnd(22)} evo boss ${r.boss.toFixed(2)}  swarm ${r.swarm.toFixed(2)}`);
for (const r of rows) console.log(`${r.id.padEnd(22)} boss ${r.boss.toFixed(2)} (${r.fusionBoss.toFixed(0)}/${r.bossBase.toFixed(0)})  swarm ${r.swarm.toFixed(2)} (${r.fusionSwarm.toFixed(0)}/${r.swarmBase.toFixed(0)})`);
if (process.argv.includes("--check")) {
  const badEvos = evoRows.filter(r => !Number.isFinite(r.boss) || !Number.isFinite(r.swarm) || Math.max(r.boss, r.swarm) < 1.5 || Math.min(r.boss, r.swarm) < 1);
  if (badEvos.length) { console.error(`Evolution target failed: ${badEvos.map(r => `${r.id} ${r.boss.toFixed(2)}/${r.swarm.toFixed(2)}`).join(", ")}`); process.exitCode = 1; }
  const bad = rows.filter(r => !Number.isFinite(r.boss) || !Number.isFinite(r.swarm) || r.boss <= 0 || r.swarm <= 0);
  if (bad.length) { console.error(`${bad.length} fusion weapons produced invalid output`); process.exitCode = 1; }
}
