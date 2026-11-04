// Shared deterministic combat environment. No browser, bonus XP or invulnerable player.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function load(root = path.resolve(__dirname, '..'), initialSeed = 0x51a7) {
  let seed = initialSeed;
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const box = { Math: math, console, window: null, document: {} }; box.window = box; box.SV = {};
  vm.createContext(box);
  for (const name of ['util','config','pool','spatial','entities','ai','weapons','waves','upgrades','auto']) {
    let source=fs.readFileSync(path.join(root,'js',name+'.js'),'utf8');
    if(name==='entities')source=source.replace('    e.hp -= real;', '    if (SV.auditHit && e.hp > 0) SV.auditHit(state,e,real,opts.wid);\n    e.hp -= real;')
      .replace('    p.hp -= real;', '    if (SV.auditHurt) SV.auditHurt(state,real,srcType);\n    p.hp -= real;');
    vm.runInContext(source, box, { filename: name + '.js' });
  }
  const SV = box.SV;
  SV.Effects = new Proxy({}, { get: () => () => {} }); SV.Audio = SV.Effects;
  SV.HUD = { toast() {} }; SV.Input = { axis: { x: 0, y: 0 } };
  SV.Renderer = { cam: { x: 0, y: 0, zoom: 1.25 }, cssSize: () => ({ w: 1180, h: 700 }) };
  SV.Game = { state: null, onXP() {}, onPlayerDeath() { this.state.dead = true; } };
  SV.auditHit=(s,e,damage,wid)=>{
    if(!s.engaged)s.engaged={};
    if(s.engaged[e.id]==null)s.engaged[e.id]=s.time;
    if(damage>=e.hp){
      if(!s.engagementKills)s.engagementKills=[];
      s.engagementKills.push({type:e.type,boss:!!e.isBoss,elite:!!e.elite,time:s.time,seconds:s.time-s.engaged[e.id]});
      delete s.engaged[e.id];
    }
    if(!s.hitMetrics)s.hitMetrics={};const k=wid||'unattributed';
    const m=s.hitMetrics[k]||(s.hitMetrics[k]={effective:0,overkill:0,boss:0,elite:0,fodder:0});
    m.effective+=Math.min(e.hp,damage);m.overkill+=Math.max(0,damage-e.hp);
    m[e.isBoss?'boss':e.elite?'elite':'fodder']+=Math.min(e.hp,damage);
  };
  SV.auditHurt=(s,damage,source)=>{
    if(!s.damageTrace)s.damageTrace=[];
    s.damageTrace.push({time:s.time,damage,source});
    while(s.damageTrace.length&&s.damageTrace[0].time<s.time-3)s.damageTrace.shift();
  };
  return SV;
}
function state(SV, { difficulty = 'hard', stage = 'ruins', weapon = 'blade', minute = 0 } = {}) {
  const C = SV.Config, ch = C.CHARACTERS.allrounder;
  const s = { stage: C.STAGES[stage], stageId: stage, difficulty, charId: 'allrounder',
    charMul: { hpMul: ch.hpMul, speedMul: ch.speedMul }, charMods: ch.charMods || {}, special: null,
    passives: { ...ch.startPassives }, player: SV.Entities.makePlayer(),
    time: minute * 60, level: 1, xp: 0, xpNext: C.CURVES.xpForLevel(1), evolutions: 0,
    enemies: [], gems: [], pickups: [], eshots: [], hazards: [], afterimages: [],
    weaponDamage: {}, weaponActive: {}, weaponRecent: {}, enemyDamage: {}, skillDamage: {},
    encountered: { enemy: {}, boss: {} }, bossFlags: { count: 0 }, _bossLoot: {},
    _bossGid: 0, _bossWaveGid: 0, kills: 0, endless: false, envTimer: C.STAGES[stage].envField?.interval || 0,
    everOwned: { [weapon]: true }, dead: false };
  SV.Game.state = s; SV.Weapons.init(s, weapon); SV.Waves.reset(s);
  s.player.hp = s.player.maxHp = SV.Entities.mods(s).maxHp;
  return s;
}
function step(SV, s, dt = 1 / 60, move = () => SV.Auto.tick(s, dt)) {
  s.time += dt;
  // Camera follows and clamps exactly as the real arena, including near walls.
  const half = s.stage.half, cam = SV.Renderer.cam, size = SV.Renderer.cssSize();
  const hw = size.w / (2 * cam.zoom), hh = size.h / (2 * cam.zoom);
  cam.x = SV.Util.clamp(s.player.x, -half + hw, half - hw);
  cam.y = SV.Util.clamp(s.player.y, -half + hh, half - hh);
  SV.Waves.update(s, dt); SV.Entities.rebuildGrid(s);
  SV.Entities.updateCharacterState(s, dt); SV.Weapons.updateAll(s, dt);
  move(); SV.Entities.updatePlayer(s, dt); SV.Entities.updateEnemies(s, dt); SV.Entities.envTick(s, dt);
}
module.exports = { load, state, step };
