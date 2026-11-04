// Paired live audit: node tests/weapon_balance_paired.js --all > tests/paired.ndjson
// Two fixed decks, five seeds, realistic 60 second runs and matched controls.
const fs = require('fs'), path = require('path'), vm = require('vm');
const option = (key, fallback) => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : fallback;
const root = option('--root', path.resolve(__dirname, '..'));
const secondsPerRun = +option('--seconds', 60);
let seed = 1;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const math = Object.create(Math); math.random = random;
const box = { Math: math, console, window: null, document: {} };
box.window = box; box.SV = {};
vm.createContext(box);
for (const file of ['util', 'config', 'pool', 'spatial', 'entities', 'ai', 'weapons', 'waves', 'auto']) {
  let source = fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8');
  // Test-only instrumentation sees module-local DoT too. Game/HUD damage buckets are unchanged.
  if (file === 'entities') source = source.replace('    e.hp -= real;', `
    if (SV.auditHit && e.hp > 0) SV.auditHit(state, e, real, opts.wid);
    e.hp -= real;`);
  vm.runInContext(source, box, { filename: file + '.js' });
}
const SV = box.SV, C = SV.Config;
SV.auditHit = (state, e, damage, wid) => {
  if (!state.audit || !wid) return;
  const key = SV.Entities.tid(wid), bucket = state.audit[key] || (state.audit[key] = {effective:0,overkill:0,boss:0,elite:0,fodder:0});
  const effective = Math.min(e.hp, damage);
  bucket.effective += effective; bucket.overkill += Math.max(0,damage-e.hp);
  bucket[e.isBoss?'boss':e.elite?'elite':'fodder'] += effective;
};
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
  5: [ ['blade','railgun','shotgun','frost','chain'], ['missile','aura','poison','sentry','boomerang'] ],
  10: [ ['blade','railgun','shotgun','frost','chain'], ['missile','aura','poison','sentry','boomerang'] ],
  14: [ ['blade_evo','railgun_evo','shotgun_evo','frost_evo','chain_evo'], ['missile_evo','aura_evo','poison_evo','sentry_evo','boomerang_evo'] ],
  18: [ ['blade_aura','missile_chain','railgun_grenade','frost_poison','boomerang_sentry'],
        ['shotgun_shockwave','lance_vortex','meteor_chain','hex_poison','spear_timestop'] ]
};
function companionDeck(minute, deckIndex, excluded) {
  if (minute !== 18) return decks[minute][deckIndex].filter(id => !excluded.includes(id)).slice(0, 4);
  const preferred = decks[18][deckIndex];
  const fallback = C.FUSIONS.map(f => f.to).filter(id => !preferred.includes(id));
  const ordered = preferred.concat(deckIndex ? fallback.reverse() : fallback);
  const used = new Set(excluded.filter(id => id.endsWith('_evo')));
  const picked = [];
  for (const id of ordered) {
    if (excluded.includes(id)) continue;
    const materials = C.weaponDef(id).fuse;
    if (materials.some(x => used.has(x))) continue;
    picked.push(id);
    for (const material of materials) used.add(material);
    if (picked.length === 3) break;
  }
  if (picked.length !== 3) throw Error('Not enough compatible fusion companions');
  return picked;
}
function makeState(minute, ids, deckIndex, excluded) {
  const ch = C.CHARACTERS.allrounder;
  const passiveLevel = minute >= 14 ? 5 : minute >= 10 ? 2 : 1;
  const s = { stage: C.STAGES.ruins, stageId: 'ruins', difficulty: 'hard', charId: 'allrounder',
    charMul: { hpMul: ch.hpMul, speedMul: ch.speedMul }, charMods: ch.charMods || {}, special: null,
    passives: { ...ch.startPassives, maxhp: passiveLevel, armor: passiveLevel,
      regen: passiveLevel, speed: passiveLevel, damage: passiveLevel,
      cooldown: passiveLevel, area: passiveLevel }, time: minute * 60, level: minute * 6, xp: 0,
    enemies: [], gems: [], pickups: [], eshots: [], hazards: [], afterimages: [],
    weaponDamage: {}, weaponActive: {}, weaponRecent: {}, enemyDamage: {}, skillDamage: {}, audit: {},
    encountered: { enemy: {}, boss: {} }, bossFlags: { count: 0 }, _bossLoot: {}, _bossGid: 0,
    kills: 0, player: SV.Entities.makePlayer(), dead: false, endless: false };
  const required = new Set();
  function requirements(id) {
    const def = C.weaponDef(id);
    if (def.fuse) def.fuse.forEach(requirements);
    else if (id.endsWith('_evo')) required.add(C.EVOLUTIONS[id.replace(/_evo$/, '')].reqPassive);
  }
  for (const id of [...companionDeck(minute, deckIndex, excluded), ...excluded]) requirements(id);
  for (const id of required) s.passives[id] = Math.max(5, s.passives[id] || 0);
  SV.Game.state = s;
  const m = SV.Entities.mods(s);
  s.player.hp = s.player.maxHp = m.maxHp;
  const deck = companionDeck(minute, deckIndex, excluded);
  SV.Weapons.init(s, ids[0]?.id || deck[0]);
  s.weapons.length = 0;
  const avoid = new Set(excluded);
  for (const x of ids) {
    s.weapons.push({ id: x.id, level: x.level, cd: 0, angle: 0, evolved: !baseIds.includes(x.id) });
  }
  const companionLevel = minute === 5 ? 4 : 8;
  for (const other of deck) {
    if (avoid.has(other)) continue;
    s.weapons.push({ id: other, level: companionLevel, cd: 0, angle: 0, evolved: !baseIds.includes(other) });
  }
  // Count weapon acquisitions/levels, evolution/fusion cards and prerequisite passives, minus free starting grants.
  const weaponCost = s.weapons.reduce((sum,w) => sum + (fusionIds.includes(w.id)?19:w.id.endsWith('_evo')?9:w.level),0)-1;
  const passiveCost = Object.entries(s.passives).reduce((sum,[id,n])=>sum+Math.max(0,n-(ch.startPassives[id]||0)),0);
  s.auditCost = weaponCost + passiveCost;
  // These are controlled late-game checkpoints, not a claim that every run reaches this level at this time.
  s.level = s.auditCost + 1;
  if (minute === 18) {
    const materials = [];
    for (const w of s.weapons) {
      if (fusionIds.includes(w.id)) materials.push(...C.weaponDef(w.id).fuse);
      else materials.push(w.id);
    }
    if (new Set(materials).size !== materials.length) throw Error('Fusion loadout reuses a material');
  }
  SV.Waves.reset(s);
  // Checkpoint starts after previously scheduled bosses; later waves still run.
  s.bossSpawned = s.stage.bosses.map(([, at]) => at <= s.time);
  s.spawnPause = 0;
  s.lateBossIndex = C.CONST.LATE_BOSS_TIMES.filter(at=>at<=s.time).length;
  SV.Auto._lx = SV.Auto._ly = 0;
  SV.Input.axis.x = SV.Input.axis.y = 0;
  return s;
}
function run(id, level, minute, runSeed, deckIndex, variant, ids, excluded, seconds = secondsPerRun) {
  seed = runSeed;
  const s = makeState(minute, ids, deckIndex, excluded), dt = 1 / 60;
  let peak = 0, distanceSum = 0, distanceN = 0, closeFrames = 0;
  let freezeTime = 0, sheepTime = 0, knockFrames = 0, intercepted = 0;
  for (let frame = 0; frame < seconds * 60 && !s.dead; frame++) {
    s.time += dt;
    const cam=SV.Renderer.cam,size=SV.Renderer.cssSize(),half=s.stage.half;
    cam.x=SV.Util.clamp(s.player.x,-half+size.w/2,half-size.w/2);
    cam.y=SV.Util.clamp(s.player.y,-half+size.h/2,half-size.h/2);
    SV.Waves.update(s, dt);
    SV.Entities.rebuildGrid(s);
    SV.Entities.updateCharacterState(s, dt);
    const shotsBefore = s.eshots.length;
    SV.Weapons.updateAll(s, dt);
    if (shotsBefore > s.eshots.length) intercepted += shotsBefore - s.eshots.length;
    SV.Auto.tick(s, dt);
    SV.Entities.updatePlayer(s, dt);
    SV.Entities.updateEnemies(s, dt);
    SV.Entities.envTick(s, dt);
    peak = Math.max(peak, SV.Weapons.proj.list.length);
    for (const e of s.enemies) if (e.hp > 0) {
      if (e.frozen > 0) freezeTime += dt;
      if (e.sheep > 0) sheepTime += dt;
      if (Math.hypot(e.vx || 0, e.vy || 0) > e.speed * 1.2) knockFrames++;
    }
    if (frame % 30 === 0 && s.enemies.length) {
      let nearest = Infinity;
      for (const e of s.enemies) if (e.hp > 0)
        nearest = Math.min(nearest, Math.hypot(e.x - s.player.x, e.y - s.player.y));
      if (Number.isFinite(nearest)) { distanceSum += nearest; distanceN++; if (nearest < 110) closeFrames++; }
    }
  }
  const survived = Math.min(seconds, s.time - minute * 60);
  return { id, level, minute, deck: deckIndex, variant, seed: runSeed,
    companions: s.weapons.slice(ids.length).map(w => w.id),
    cost: s.auditCost, metrics: s.audit[SV.Entities.tid(id)] || {}, allMetrics: s.audit,
    seconds: +survived.toFixed(1), hp: +s.player.hp.toFixed(1),
    damage: +(s.weaponDamage[SV.Entities.tid(id)] || 0).toFixed(1), kills: s.kills,
    taken: +Object.values(s.enemyDamage).reduce((a, b) => a + b, 0).toFixed(1),
    meanNearest: distanceN ? +(distanceSum / distanceN).toFixed(1) : null,
    closePct: distanceN ? +(100 * closeFrames / distanceN).toFixed(1) : 0, peak,
    freezeTime: +freezeTime.toFixed(1), sheepTime: +sheepTime.toFixed(1), knockFrames, intercepted };
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
  const s = makeState(10, [{id, level: 8}], 0, [id]);
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
const requested = process.argv.includes('--weapon') ? process.argv[process.argv.indexOf('--weapon') + 1] : null;
const shardArg = process.argv.includes('--shard') ? process.argv[process.argv.indexOf('--shard') + 1] : null;
const [shardIndex, shardCount] = shardArg ? shardArg.split('/').map(Number) : [0, 1];
if (shardIndex < 0 || shardIndex >= shardCount || !Number.isInteger(shardCount)) throw Error('Invalid shard');
const targets = (requested ? [requested] : [...baseIds, ...evoIds, ...fusionIds])
  .filter((_, index) => index % shardCount === shardIndex);
const seeds = [0x51a7, 0x9273, 0xc314, 0x7849, 0xef12];
let rows = 0, peak = 0;
for (const id of targets) {
  if (!C.weaponDef(id)) throw Error('Unknown weapon: ' + id);
  const tier = baseIds.includes(id) ? 'base' : id.endsWith('_evo') ? 'evo' : 'fusion';
  const levels = tier === 'base' ? [1,2,3,4,5,6,7,8] : [8];
  for (const level of levels) {
    const minute = minuteFor(tier, level);
    const source = tier === 'evo' ? id.replace(/_evo$/, '') : tier === 'fusion' ? C.weaponDef(id).fuse : null;
    const variants = [{name:'current', ids:[{id,level}]}, {name:'empty', ids:[]}];
    if (tier === 'base' && level > 1) variants.push({name:'previous', ids:[{id,level:level-1}]});
    if (tier === 'base' && level === 5) variants.push({name:'bridge4', ids:[{id,level:4}]});
    if (tier === 'evo') variants.push({name:'source', ids:[{id:source,level:8}]});
    if (tier === 'fusion') {
      variants.push({name:'sources', ids:source.map(x=>({id:x,level:8}))});
      const materials = new Set(source.map(x=>x.replace(/_evo$/, '')));
      const refill = baseIds.find(x=>!materials.has(x) && !companionDeck(minute,0,[id,...source]).concat(companionDeck(minute,1,[id,...source])).some(y=>C.weaponDef(y).fuse?.includes(x+'_evo')));
      if (refill) variants.push({name:'refilled',ids:[{id,level},{id:refill,level:1}]});
    }
    const excluded = [id].concat(Array.isArray(source) ? source : source ? [source] : []);
    for (let deck = 0; deck < 2; deck++) for (const runSeed of seeds) for (const variant of variants) {
      const row = run(id, level, minute, runSeed, deck, variant.name, variant.ids, excluded);
      rows++; peak = Math.max(peak, row.peak);
      console.log(JSON.stringify(row));
    }
  }
}
if (process.argv.includes('--assert')) {
  const problems = checkLevels();
  if (baseIds.length !== 21 || evoIds.length !== 21 || fusionIds.length !== 32)
    problems.push('Weapon coverage differs from 21/21/32');
  if (peak > C.CONST.MAX_PROJECTILES) problems.push(`Projectile peak ${peak}`);
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1; }
  else console.error(`Audit passed: ${rows} paired live runs, peak ${peak}, all base upgrades monotonic`);
}
