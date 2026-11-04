// Deterministic integration checks for the actual game modules, without a browser.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='battleMode'?'classic':id==='formation'?'single':'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:''});return nodes.get(id);}
let seed=20261022;const seededMath=Object.create(Math);seededMath.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const storage=new Map();const ctx=vm.createContext({localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},console,Math:seededMath,performance:{now:()=>1000},setTimeout:()=>0,clearTimeout(){},document:{getElementById:node,querySelectorAll:()=>[],body:{classList:{toggle(){}}}},window:{},requestAnimationFrame(){}});
const root=path.join(__dirname,'..');for(const file of ['namespace','util','config','roster','physics','ai','projectiles','specials','effects','terrain','ui','abilities','game','lab','campaign'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),ctx);
function run(code){return vm.runInContext(code,ctx);}
run('W.Renderer={fit(){}};');
run("W.Game.clearAll(); W.Game.createUnit('giant','red',0,0);W.Game.startBattle()");assert.equal(run('W.Game.state.phase'),'setup','Cannot start a one-sided battle');
node('formation').value='cluster';run("W.Game.clearAll();W.Game.state.input.selectedTypeId='tribesman';W.Lab.place({x:-200,y:0});");assert.equal(run('W.Game.state.units.length'),9,'3x3 formation');run('W.Lab.place({x:-200,y:0});');assert.equal(run('W.Game.state.units.length'),9,'No overlapping placements');run('W.Lab.place({x:-900,y:0});');assert.equal(run('W.Game.state.units.length'),9,'No out of bounds placement');
run("W.Game.createUnit('giant','blue',200,0);W.Game.startBattle();W.Game.state.paused=true;W.Game.resetBattle();");assert.equal(run('W.Game.state.paused'),false);assert.equal(run('W.Game.state.units.length'),10,'Restore original army');
node('battleMode').value='control';run("W.Game.clearAll();W.Game.createUnit('giant','red',0,0);W.Game.createUnit('giant','blue',400,0);W.Game.startBattle();for(let i=0;i<1801;i++)W.Lab.step(1/60);");assert.equal(run('W.Game.state.winner'),'red','Control point score victory');
node('battleMode').value='control';run("W.Game.clearAll();W.Game.createUnit('giant','red',-30,0);W.Game.createUnit('giant','blue',30,0);W.Game.startBattle();for(let i=0;i<1801;i++)W.Lab.step(1/60);");assert.equal(run('W.Game.state.winner'),null,'Contested point does not score');
node('battleMode').value='storm';run("W.Game.clearAll();W.Game.createUnit('tribesman','red',-690,0);W.Game.createUnit('giant','blue',0,0);W.Game.startBattle();for(let i=0;i<1800;i++)W.Lab.step(1/60);W.Game.checkWin();");assert.equal(run('W.Game.state.winner'),'blue','Storm kills outside units');
node('battleMode').value='classic';run("W.Game.clearAll();W.Game.createUnit('giant','red',-200,0);W.Game.createUnit('giant','blue',200,0);W.Game.startBattle();for(let i=0;i<10801;i++)W.Lab.step(1/60);");assert.equal(run('W.Game.state.winner'),'draw','Timeout breaks stalemate');
for(const mode of ['classic','control','storm']){node('battleMode').value=mode;run("W.Game.clearAll();for(let i=0;i<4;i++){W.Game.createUnit('roman_swordsman','red',-120,i*32);W.Game.createUnit('archer','blue',120,i*32);}W.Game.startBattle();for(let i=0;i<10810&&!W.Game.state.winner;i++)W.Game.step(1/60);");assert.ok(run('W.Game.state.winner'),mode+' completes');assert.ok(run('W.Game.state.units.every(u=>Number.isFinite(u.pos.x)&&Number.isFinite(u.hp))'),'finite simulation');}
console.log('PASS: formations, bounds, overlap, reset, contested capture, capture victory, storm deaths, timeout and 3 full battles.');

assert.equal(run('Object.keys(W.Config.UNIT_TYPES).length'),20);
run("W.Game.clearAll();const lancer=W.Game.createUnit('lancer','red',0,0),pike=W.Game.createUnit('pikeman','blue',25,0);lancer.chargeTime=1;W.Abilities.impact(lancer,pike,1,0,150);");assert.ok(run('lancer.hp<lancer.maxHp'),'Pike counters charge');assert.equal(run('lancer.chargeTime'),0);
run("W.Game.clearAll();const hammer=W.Game.createUnit('hammerer','red',0,0),victim=W.Game.createUnit('tribesman','blue',40,0);hammer.abilityCd=0;W.Abilities.attack(hammer,victim,1/60);");assert.ok(run('victim.hp<victim.maxHp&&victim.stunTime>0'),'Quake damages and stuns');
run("W.Game.clearAll();const frost=W.Game.createUnit('frost_mage','red',0,0),iceTarget=W.Game.createUnit('giant','blue',60,0);W.Projectiles.spawn(frost,0,W.Config.UNIT_TYPES.frost_mage.projectile);for(let i=0;i<30;i++)W.Projectiles.step(1/60);");assert.ok(run('iceTarget.slowTime>0'),'Ice projectile slows');
run("W.Game.clearAll();const ballista=W.Game.createUnit('ballista','red',0,0);for(let i=0;i<4;i++)W.Game.createUnit('giant','blue',60+i*65,0);W.Projectiles.spawn(ballista,0,W.Config.UNIT_TYPES.ballista.projectile);for(let i=0;i<60;i++)W.Projectiles.step(1/60);");assert.equal(run("W.Game.state.units.filter(u=>u.team==='blue'&&u.hp<u.maxHp).length"),3,'Bolt hits exactly three targets');assert.ok(run('ballista.vel.vx<0'),'Artillery recoil');
run("W.Game.clearAll();const flag=W.Game.createUnit('standard','red',0,0),ally=W.Game.createUnit('tribesman','red',20,0);W.Abilities.prepare(1/60);");assert.equal(run('ally.rally'),true);run('W.Physics.kill(flag);W.Abilities.prepare(1/60);');assert.equal(run('ally.rally'),false,'Aura ends on death');
run('W.Campaign.init();W.Campaign.load(0);');assert.equal(run('W.Campaign.load(1)'),false,'Later levels locked');
run("const blue=W.Game.state.units.find(u=>u.team==='blue');W.Game.removeUnit(blue);");assert.equal(run("W.Game.state.units.filter(u=>u.team==='blue').length"),10,'Enemy deletion blocked');
assert.equal(run("W.Campaign.allow('giant','red')"),false,'Budget enforced');assert.equal(run("W.Campaign.allow('tribesman','blue')"),false,'Enemy additions blocked');
run('W.Game.clearAll();');assert.equal(run("W.Game.state.units.filter(u=>u.team==='red').length"),0);assert.equal(run("W.Game.state.units.filter(u=>u.team==='blue').length"),10,'Clear retains enemy army');
for(let i=0;i<8;i++){
  assert.equal(run('W.Campaign.load('+i+')'),true);
  assert.ok(run('W.Game.state.redCost<=W.Campaign.levels[W.Campaign.index].budget'),'Recommended army within budget');
  run('W.Game.startBattle();for(let i=0;i<10810&&!W.Game.state.winner;i++)W.Game.step(1/60);');
  assert.ok(run('W.Game.state.winner'),'Campaign fight concludes');assert.ok(run('W.Game.state.units.every(u=>Number.isFinite(u.pos.x)&&Number.isFinite(u.pos.y)&&Number.isFinite(u.hp))'));
  console.log('Campaign',i+1,'recommended result:',run('W.Game.state.winner'));
  // Exercise unlock/rating independently of stochastic combat outcome.
  run("W.Game.state.winner=null;W.Lab.finish('red');");assert.ok(run('W.Campaign.progress['+i+']')>=1);
}
assert.ok(storage.has('war-lab-campaign-v1'),'Progress persisted');run('W.Campaign.leave();');assert.equal(run('W.Campaign.active'),false);
console.log('PASS: 20 units, charge counter, quake, frost, penetration, recoil, aura, budget, enemy lock, progression and eight full campaign battles.');
