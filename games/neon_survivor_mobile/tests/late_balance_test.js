const assert = require('node:assert/strict');
const { load, state } = require('./combat_harness');
function setup(opts) { const SV = load(), s = state(SV, opts); return { SV, s, C:SV.Config }; }
function enemy(SV,s,type,x,y) { return SV.Entities.addEnemy(s,type,x,y); }
const close = (a,b,msg) => assert(Math.abs(a-b)<1e-7, `${msg}: ${a} != ${b}`);
// Smooth start; first two minutes and the original damage/Boss HP curves are untouched.
for (const difficulty of ['chill','normal','hard','nightmare']) {
  const {SV,s,C} = setup({difficulty});
  for (const minute of [0,2,8,10,15,20,25]) {
    s.time=minute*60;
    const e=SV.Entities.makeEnemy(s,'zombie',0,0), d=C.DIFFICULTY[difficulty];
    const f=e.maxHp/(C.ENEMIES.zombie.hp*C.CURVES.hpFactor(minute)*d.hpMul);
    if(minute<=8)close(f,1,'early HP unchanged');
    if(minute>=15)close(f,d.lateHpMul,'late HP profile');
    assert(Number.isFinite(e.hp)&&e.hp>0);
    assert(C.CURVES.eliteChance(minute,difficulty)<=d.eliteCap);
  }
}
// Instant damage shares a window; longer contact immunity survives it. Sustained damage is independent.
for (const difficulty of ['normal','nightmare']) {
  const {SV,s,C}=setup({difficulty}); s.passives={};SV.Entities.invalidateMods(s);
  s.player.hp=s.player.maxHp=100;
  assert(SV.Entities.damagePlayer(s,10,false,'zombie')); close(s.player.hp,90,'first hit');
  assert.equal(SV.Entities.damagePlayer(s,40,true,'bomber'),false);close(s.player.hp,90,'different source blocked');
  SV.Entities.updatePlayer(s,C.DIFFICULTY[difficulty].burstIframe+0.001);
  assert(!SV.Entities.damagePlayer(s,10,false,'zombie'),'contact iframe lasts longer');
  assert(SV.Entities.damagePlayer(s,10,true,'shooter')); close(s.player.hp,80,'projectile allowed after shared window');
  assert(SV.Entities.damagePlayer(s,5,true,'slimer',true));close(s.player.hp,75,'sustained hazard remains dangerous');
}
// Overlapping hazards use the strongest ready source, one tick per half second; warm zones never hurt.
{
  const {SV,s}=setup();s.passives={};SV.Entities.invalidateMods(s);s.player.hp=100;
  s.hazards=[10,30,20].map(dmg=>({x:0,y:0,r:50,dmg,life:10,tick:0,warm:0,kind:'burn'}));
  s.hazards.push({x:0,y:0,r:50,dmg:99,life:10,tick:0,warm:3,kind:'burn'});
  SV.Entities.updatePlayer(s,.01);close(s.player.hp,70,'highest single hazard');
  SV.Entities.updatePlayer(s,.25);close(s.player.hp,70,'no early repeated tick');
  SV.Entities.updatePlayer(s,.25);close(s.player.hp,40,'next half-second tick');
}
// Armor + aura cannot multiply into excessive durability; priests do not stack heals or resurrect corpses.
for (const difficulty of ['chill','normal','hard','nightmare']) {
  const {SV,s,C}=setup({difficulty,minute:20});s.passives={};SV.Entities.invalidateMods(s);
  const shield=enemy(SV,s,'shielder',80,0);shield.hp=shield.maxHp=10000;
  enemy(SV,s,'warden',0,0);SV.Entities.rebuildGrid(s);SV.Entities.tickAuras(s,.3);
  const before=shield.hp;SV.Entities.damageEnemy(s,shield,100,{nocrit:true,text:false});
  close(before-shield.hp,100*(1-C.DIFFICULTY[difficulty].wardCap),'combined shield cap');
  s.enemies=[];const target=enemy(SV,s,'zombie',0,0);target.hp=1;target.maxHp=10000;
  enemy(SV,s,'priest',20,0);enemy(SV,s,'priest',-20,0);SV.Entities.rebuildGrid(s);s._auraTick=0;
  SV.Entities.tickAuras(s,.3);close(target.hp-1,C.CURVES.priestHeal(20)*SV.Entities.healScale(s)*.3,'one priest rate');
  target.hp=0;s._auraTick=0;SV.Entities.tickAuras(s,.3);assert.equal(target.hp,0);
}
// Every acquisition path sees the screen first, still respecting short range / controlled exclusions.
for (const weapon of ['missile','sentry','polymorph','polymorph_timestop','sentry_hex','chain_sentry']) {
  const {SV,s}=setup({weapon});SV.Renderer.cssSize=()=>({w:400,h:300});SV.Renderer.cam.zoom=1;
  const off=enemy(SV,s,'zombie',0,190), visible=enemy(SV,s,'zombie',190,0);
  visible.hp=off.hp=visible.maxHp=off.maxHp=1e6;
  SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.01);
  const projectiles=SV.Weapons.proj.list.filter(p=>p.target);
  if(weapon==='sentry') {
    const shot=SV.Weapons.proj.list[0];assert(shot&&Math.abs(shot.vx)>Math.abs(shot.vy)*10,'sentry fires toward visible target');
  }
  else if(projectiles.length)assert.equal(projectiles[0].target.id,visible.id,weapon+' visible priority');
  else { assert(visible.hp<1e6,weapon+' visible direct fire');assert.equal(s.weapons[0].sentries[0].targetId,visible.id,weapon+' first turret sees visible threat'); }
}
{
  const {SV,s}=setup({weapon:'missile'});const far=enemy(SV,s,'zombie',1600,0);
  SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.01);assert.equal(SV.Weapons.proj.list.length,0,'no global acquisition');
  far.x=590;s.weapons[0].cd=0;SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.01);
  const pr=SV.Weapons.proj.list[0];assert(pr&&pr.target===far,'near offscreen fallback');
  far.x=900;SV.Weapons.updateAll(s,.01);assert.equal(pr.target,far,'existing lock keeps travelling outside view');
  far.hp=0;const tooFar=enemy(SV,s,'zombie',1600,0);SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.01);
  assert.notEqual(pr.target,tooFar,'dead lock cannot trigger global re-acquisition');
}
// Fixed wave schedule/count, stagger, relief and serialization of the unspawned member.
{
  const {SV,s}=setup({weapon:'chain'});SV.Renderer.cssSize=()=>({w:400,h:300});SV.Renderer.cam.zoom=1;
  const off=enemy(SV,s,'zombie',0,170),visible=enemy(SV,s,'zombie',180,0);
  off.hp=visible.hp=1e6;SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);
  assert(visible.hp<1e6&&off.hp===1e6,'lightning first acquisition prefers visible enemies within its original range');
}
for(const difficulty of ['chill','normal','hard','nightmare']) {
  const {SV,s,C}=setup({difficulty});s.bossSpawned=s.stage.bosses.map(()=>true);s.time=930;
  SV.Util.choice=arr=>arr[0];SV.Waves.update(s,1/60);
  assert.equal(s.enemies.filter(e=>e.isBoss).length,1);
  assert.equal(s.pendingBosses.length,C.DIFFICULTY[difficulty].lateBossCount-1);
  const copy=JSON.parse(JSON.stringify(s));copy.stage=s.stage;
  copy.time=932;SV.Waves.update(copy,1/60);
  assert.equal(copy.enemies.filter(e=>e.isBoss).length,Math.min(2,C.DIFFICULTY[difficulty].lateBossCount));
  assert.equal(copy.spawnPause,0,'staggered wave does not repeatedly stop normal spawns');
  if(['normal','hard'].includes(difficulty))assert.equal(copy.lateReliefUntil,938);
}
// Compensation preserves expected scheduled XP production, including the lower elite proportion.
{
  const {SV,s,C}=setup({difficulty:'normal',minute:20});s.bossSpawned=s.stage.bosses.map(()=>true);s.lateBossIndex=3;s.swarmTimer=999;
  SV.Waves.update(s,1);
  const e=s.enemies[0];assert(e);close(e.dropComp,(e.elite?.25/.15:.75/.85)/.95,'regular drop compensation');
  const base=Math.max(1,Math.round(C.ENEMIES[e.type].xp*1.5*C.DIFFICULTY.normal.xpMul));
  close(e.xp/(e.elite?3:1)*.95*(1+2*.15),base*(1+2*.25),'expected XP output');
}
// An early kill cannot cash out a wave while its next member is still queued.
{
  const {SV,s}=setup({difficulty:'normal'});SV.Util.choice=arr=>arr[0];
  s.bossSpawned=s.stage.bosses.map(()=>true);s.time=930;SV.Waves.update(s,1/60);
  for(const e of s.enemies)e.hp=0;SV.Entities.rebuildGrid(s);SV.Entities.updateEnemies(s,0);
  assert.equal(s.pickups.filter(p=>p.kind==='treasure').length,0,'queued member holds the reward');
  s.time=932;SV.Waves.update(s,1/60);for(const e of s.enemies)e.hp=0;
  SV.Entities.rebuildGrid(s);SV.Entities.updateEnemies(s,0);
  assert.equal(s.pickups.filter(p=>p.kind==='treasure').length,1,'last member pays exactly once');
}
// Large targets touch fusion blades across cell boundaries; explosions cannot invalidate the caller's query list.
for(const weapon of ['blade_aura','blade_frost','blade_boomerang']) {
  const {SV,s}=setup({weapon});s.passives={};SV.Entities.invalidateMods(s);
  const spec=SV.Weapons.stats(s.weapons[0],s),dt=1/60,angle=spec.spin*dt;
  const e=enemy(SV,s,'brute',Math.cos(angle)*spec.radius+80,Math.sin(angle)*spec.radius);
  e.r=90;e.hp=e.maxHp=1e8;e.dmg=e.speed=0;
  SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,dt);
  assert(e.hp<1e8,weapon+' does not miss a visibly overlapping large enemy');
}
// Area scaling cannot strand both outbound blades forever; returning blades can hit the same enemy again.
{
  const {SV,s}=setup({weapon:'blade_boomerang'});s.passives={area:10};SV.Entities.invalidateMods(s);
  const e=enemy(SV,s,'brute',300,0);e.hp=e.maxHp=1e8;e.speed=e.dmg=0;
  const previous=new Map();let returns=0,launches=0;
  for(let frame=0;frame<600;frame++) {
    SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);SV.Entities.updateEnemies(s,1/60);
    let away=0;
    for(const b of s.player.blades) {
      if(b.mode!=='orbit')away++;
      if(previous.get(b)==='return'&&b.mode==='orbit')returns++;
      if(previous.get(b)==='orbit'&&b.mode==='out')launches++;
      previous.set(b,b.mode);
    }
    assert(away<=2,'at most two blades leave the ring');
  }
  assert(returns>=3&&launches>=4,'blades repeatedly return to the enlarged rotating ring');
}
// Exercise the real transition, not only a fusion equipped directly at a checkpoint.
{
  const {SV,s,C}=setup({weapon:'blade_evo'});
  SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);assert.equal(s.player.blades.length,8);
  s.weapons.push({id:'boomerang_evo',level:8,cd:0,angle:0,evolved:true});
  SV.Weapons.fuse(s,C.FUSIONS.find(c=>c.to==='blade_boomerang'));
  const e=enemy(SV,s,'zombie',200,0);e.hp=1e6;
  SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);
  assert(s.player.blades.every(b=>typeof b.mode==='string'&&Array.isArray(b.hitIds)),'fusion replaces stale evolved-blade state');
}
console.log('late_balance_test: OK');
