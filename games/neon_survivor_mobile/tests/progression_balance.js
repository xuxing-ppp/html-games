// node tests/progression_balance.js [--root PATH] [--seeds 5] [--stage ruins] [--difficulty hard] [--build melee]
// Uses actual gem collection and rolled three-card choices. Movement is an automated stress proxy, not a human win-rate estimate.
const { load, state, step } = require('./combat_harness');
const assert = require('node:assert');
const tacticalInput = require('./tactical_input');
const arg = (k, fallback) => process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : fallback;
const builds = {
  melee: ['aura','blade','crescent','spear','frost','detonate'],
  ranged: ['shotgun','missile','sentry','railgun','boomerang','chain'],
  mixed: ['frost','chain','poison','vortex','meteor','aura']
};
const seeds = [0x51a7,0x9273,0xc314,0x7849,0xef12].slice(0, +arg('--seeds', 1));
function run(difficulty, stage, build, seed) {
  const SV = load(arg('--root'), seed), C = SV.Config, preferred = builds[build];
  const s = state(SV, { difficulty, stage, weapon: preferred[0] });
  const history = [], checkpoints = [], bosses = new Map(), bossKills = [], recent = [];
  // Instrument real HP loss, excluding overkill; leave runtime statistics semantics intact.
  // Most calls are module-local, so sample the actual HP and cumulative source counters each step instead.
  SV.Game.onXP = () => {
    while (!s.dead && s.xp >= s.xpNext) {
      s.xp -= s.xpNext; s.level++; s.xpNext = C.CURVES.xpForLevel(s.level);
      const choices = SV.Upgrades.rollChoices(s);
      assert(choices.length > 0 && choices.length <= 3);
      const required = new Set(s.weapons.filter(w=>w.level>=6).map(w => C.EVOLUTIONS[w.id]?.reqPassive).filter(Boolean));
      function score(c) {
        if (c.kind === 'fuse') return 10000;
        if (c.kind === 'evolve') return 9000;
        if (c.kind === 'weapon') return 700 + (s.weapons.find(w => w.id === c.id)?.level || 0) * 25;
        if (c.kind === 'newweapon') return preferred.includes(c.id) ? 550 - preferred.indexOf(c.id) * 8 : (s.weapons.length < 3 ? 150 : -100);
        const n = s.passives[c.id] || 0;
        if (required.has(c.id) && n < 5) return 750 - n * 10;
        if(c.id==='magnet'&&n<3)return 720;
        if(['maxhp','armor','regen'].includes(c.id)&&s.player.hp/s.player.maxHp<.55)return 740/Math.sqrt(n);
        const weights = { damage: 480, cooldown: 480, area: 380, armor: 390, maxhp: 390, regen: 350, lifesteal: 340, magnet: 400, speed: 330, crit: 360, luck: 300 };
        return (weights[c.id] || 100) / Math.sqrt(1 + n);
      }
      const pick = choices.reduce((a,b) => score(b) > score(a) ? b : a);
      history.push({ time: +s.time.toFixed(1), level: s.level, kind: pick.kind, id: pick.id });
      SV.Upgrades.apply(s, pick);
    }
  };
  let peak = 0, nextCheckpoint = 120, maxBurst = 0, offscreenKills = 0;
  let previousTaken = 0, clearSeconds = 0, clearSamples = 0;
  const born = new Map();
  let error=null;
  try { for (let frame = 0; frame < 1200 * 60 && !s.dead; frame++) {
    for (const e of s.enemies) {
      if (e.isBoss && !bosses.has(e.id)) bosses.set(e.id, { id: e.type, start: s.time, source: e.bossSource });
      if (!born.has(e.id)) born.set(e.id, { at: s.time, elite: e.elite, boss: e.isBoss, type: e.type });
    }
    const before = s.enemies.slice();
    step(SV, s, 1/60, arg('--movement','auto') === 'tactical' ? () => tacticalInput(SV,s,frame) : undefined);
    const ids = new Set(s.enemies.map(e => e.id));
    for (const e of before) if (!ids.has(e.id) && e.hp <= 0) {
      if (e.isBoss) { const b = bosses.get(e.id); bossKills.push({ ...b, seconds: +(s.time - b.start).toFixed(2) }); }
      else if (s.time >= 600 && !e.elite && ['zombie','runner','swarmer'].includes(e.type)) {
        const b = born.get(e.id); clearSeconds += s.time - b.at; clearSamples++;
      }
      const cam = SV.Renderer.cam, sz = SV.Renderer.cssSize();
      if (Math.abs(e.x-cam.x) > sz.w/2/cam.zoom + e.r || Math.abs(e.y-cam.y) > sz.h/2/cam.zoom + e.r) offscreenKills++;
      born.delete(e.id);
    }
    const taken = Object.values(s.enemyDamage).reduce((a,b) => a+b,0);
    recent.push([s.time,taken-previousTaken]); previousTaken = taken;
    while (recent.length && recent[0][0] < s.time - 0.5) recent.shift();
    maxBurst = Math.max(maxBurst, recent.reduce((a,b) => a+b[1],0));
    peak = Math.max(peak, s.enemies.length);
    if (s.time >= nextCheckpoint || s.dead) {
      checkpoints.push({ minute: +(s.time/60).toFixed(2), level: s.level, hp: +s.player.hp.toFixed(1),
        enemies: s.enemies.length, bosses: s.enemies.filter(e=>e.isBoss).length, kills:s.kills,
        weapons:s.weapons.map(w=>w.id+':'+w.level) }); nextCheckpoint += 120;
    }
    assert(Number.isFinite(s.player.hp) && s.enemies.length <= C.CONST.MAX_ENEMIES + 20);
  }
  } catch(e) { error=String(e);process.exitCode=1; }
  return { error, difficulty, stage, build, seed, movement:arg('--movement','auto'), survived: !error && !s.dead && s.time>=1199.99, seconds: +s.time.toFixed(1), level:s.level, hp:s.player.hp, remainingEnemies:s.enemies.length,
    remainingBosses:s.enemies.filter(e=>e.isBoss).map(e=>({type:e.type,source:e.bossSource,hpRatio:e.hp/e.maxHp})),
    kills:s.kills, peak, offscreenKills, maxBurst:+maxBurst.toFixed(1), enemyDamage:s.enemyDamage,
    // Includes approach time; this is explicitly NOT time-to-kill after engagement.
    meanFodderLifetime:clearSamples?+(clearSeconds/clearSamples).toFixed(2):null,
    checkpoints,bossKills,choices:history,hitMetrics:s.hitMetrics||{},
    engagementKills:s.engagementKills||[],deathTrace:s.dead?s.damageTrace||[]:[] };
}
for (const d of arg('--difficulty','normal,hard').split(','))
  for (const stage of arg('--stage','ruins,crimson,frozen,void').split(','))
    for (const build of arg('--build','melee,ranged,mixed').split(','))
      for (const seed of seeds) console.log(JSON.stringify(run(d,stage,build,seed)));
