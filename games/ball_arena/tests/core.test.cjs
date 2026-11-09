const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./load.cjs');
const c=load(),B=c.BallBattle,M=c.ArenaModel,registry=B.ballRegistry;
const metadata=registry.list().map(d=>({id:d.id,name:d.name,stats:{...d.stats},description:d.description}));
function battle(left='oldWoodMaster',right='steelCoil',mode='1v1'){
 const e=new B.BattleEngine();e.createBattle(B.createModeBattleConfig(mode,[].concat(left),[].concat(right)));e.beginFight();return e;
}
function dispose(e){for(const b of e.game.balls)e.invokeHook(b,'onBattleDispose');e.entitySystem.reset();e.visualEffectSystem.reset();e.activeModeController()?.dispose();}
function run(e,seconds){for(let i=0;i<Math.round(seconds*60)&&e.game.state==='running';i++)e.update(1/60);}
function frozen(e){for(const b of e.game.balls){e.setMovementLocked(b,true);b.x=b.prevX=60+(b.teamId==='right'?50:0);b.y=b.prevY=100;}return e;}
function dummy(){if(registry.list().some(d=>d.id==='arenaDummy'))return;registry.register({id:'arenaDummy',name:'测试靶',englishName:'Test target',color:'#eeeeee',description:'Tests only',stats:{radius:15,speed:150,maxHp:1000},createBehavior:()=>({})});}
test('184 original definitions preserved plus six original characters',()=>{
 assert.equal(registry.list().length,190);assert.equal(M.ORIGINAL_IDS.length,6);
 const source=require('./original-roster.json');
 for(const original of source.roles){const d=registry.get(original.id);assert.equal(d.name,original.name);assert.equal(d.description,original.description);assert.deepEqual({...d.stats},original.stats);}
 assert(Object.values(c.ArenaTags).every(tags=>Array.isArray(tags)));
});
test('all original roles simulate and key roles have finite state',()=>{
 const failures=[];
 for(const d of metadata.filter(d=>!M.ORIGINAL_IDS.includes(d.id))){let e;try{e=battle(d.id,'steelCoil',registry.get(d.id).rosterType==='boss'?'totalwar':'1v1');run(e,2);for(const b of e.game.balls)assert(Number.isFinite(b.hp)&&Number.isFinite(b.x)&&Number.isFinite(b.y));}catch(err){failures.push([d.id,err.stack,err.cause?.stack]);}finally{if(e)dispose(e);}}
 assert.deepEqual(failures,[]);
 for(const id of ['oldWoodMaster','steelCoil','spiderweb','copy','rewind']){const e=battle(id);run(e,12);assert(e.game.time>0);dispose(e);}
});
test('mode config preserves physical field size, limits and eligibility',()=>{
 const s=M.defaults();assert.equal(M.validate(s,registry),'');
 for(const physics of ['none','bounce','gyro']){s.physics=physics;const e=new B.BattleEngine();e.createBattle(M.configFor(s,B));assert.equal(e.arenaSize,physics==='none'?200:240);dispose(e);}
 s.left=[null];assert.match(M.validate(s,registry),/空位/);
 s.left=[registry.list().find(d=>d.rosterType==='boss').id];assert.match(M.validate(s,registry),/Boss/);
 s.mode='boss';assert.equal(M.validate(s,registry),'');assert.equal(M.configFor(s,B).mode,'totalwar');
});
test('series settlement idempotence, early win and three draws',()=>{
 const s=new M.Series(3);s.record(0);assert.equal(s.record(1),false);assert.deepEqual([...s.scores],[1,0]);assert(s.next());s.record(0);assert(s.complete);assert(!s.next());
 const d=new M.Series(5);for(let i=0;i<3;i++){d.record(null);if(i<2)d.next();}assert(d.complete);assert.deepEqual([...d.scores],[0,0]);
 const reset=new M.Series(3);reset.record(null);reset.next();reset.record(1);assert.equal(reset.draws,0);
});
test('corrupt persisted preferences recover without inventing roles',()=>{
 const s=M.sanitize({left:['missing'],right:'wrong',favorites:['bad','steelCoil','steelCoil'],hazards:null,seedText:'-1',series:9,mode:'unknown'},registry);
 assert.deepEqual([...s.left],[null]);assert.deepEqual([...s.right],['steelCoil']);assert.deepEqual([...s.favorites],['steelCoil']);assert.equal(s.mode,'duel');assert.equal(s.seedText,'');assert.equal(s.series,1);
});
test('team, wheel, brawl and Boss battles can start',()=>{
 for(const mode of ['nvn','wheel','brawl','totalwar']){
  const left=mode==='totalwar'?[registry.list().find(d=>d.rosterType==='boss').id]:['oldWoodMaster','spiderweb'];
  const e=battle(left,mode==='brawl'?[]:['steelCoil','electric'],mode);run(e,2);assert(e.game.time>0);if(mode==='wheel'){assert.equal(e.game.balls.filter(b=>e.isBallActive(b)).length,2);const first=e.game.teams[0].balls[0];first.hp=0;run(e,.2);assert(e.isBallActive(e.game.teams[0].balls[1]));}dispose(e);
 }
});
test('all six new characters launch skills without invalid state',()=>{
 dummy();
 for(const id of M.ORIGINAL_IDS){const e=frozen(battle(id,'arenaDummy'));run(e,12);const own=e.game.balls[0],enemy=e.game.balls[1];assert(Number.isFinite(own.hp));assert(enemy.hp<=1000);const state=own.behavior.getArenaExtensionState();if(id==='arenaPainter')assert(state.pools<=6);dispose(e);assert.equal(e.entitySystem.entities.length,0);}
});
test('spring fist hits once for six, with recoil direction',()=>{
 dummy();const e=frozen(battle('arenaSpring','arenaDummy'));e.setMovementLocked(e.game.balls[1],false);e.game.balls[1].vx=e.game.balls[1].storedVx=-150;e.game.balls[1].vy=e.game.balls[1].storedVy=0;const before=e.game.balls[1].hp;e.invokeHook(e.game.balls[0],'update',null,3);run(e,.5);assert.equal(before-e.game.balls[1].hp,6);dispose(e);
});
test('bubble hits for two and slow expires',()=>{
 dummy();const e=frozen(battle('arenaBubble','arenaDummy'));e.invokeHook(e.game.balls[0],'update',null,3);run(e,.6);const t=e.game.balls[1];assert.equal(t.hp,998);assert(Math.abs(e.getSlowFactor(t)-.6)<1e-9);run(e,1.6);assert.equal(e.getSlowFactor(t),1);dispose(e);
});
test('paint refreshes one source without stacking and clears after leaving',()=>{
 dummy();const e=frozen(battle('arenaPainter','arenaDummy')),own=e.game.balls[0],t=e.game.balls[1];t.x=own.x;t.y=own.y;e.invokeHook(own,'update',null,4);run(e,.2);assert.equal([...t.effects.values()].filter(x=>x.id.startsWith('arena-paint')).length,1);assert.equal(e.getSlowFactor(t),.75);t.x=180;run(e,.15);assert.equal(e.getSlowFactor(t),1);dispose(e);
});
test('parcel telegraph precedes ten damage and boomerang hits each leg once',()=>{
 dummy();let e=frozen(battle('arenaCourier','arenaDummy'));e.invokeHook(e.game.balls[0],'update',null,5);run(e,.9);assert.equal(e.game.balls[1].hp,1000);run(e,.2);assert.equal(e.game.balls[1].hp,990);dispose(e);
 e=frozen(battle('arenaBoomerang','arenaDummy'));e.invokeHook(e.game.balls[0],'update',null,4);run(e,1.65);assert.equal(e.game.balls[1].hp,992);dispose(e);
});
test('battery stores actual damage capped at twenty; misses retain charge',()=>{
 dummy();const e=frozen(battle('arenaBattery','arenaDummy')),own=e.game.balls[0],t=e.game.balls[1];e.dealDamage(own,10,t);assert.equal(own.behavior.getArenaExtensionState().charge,3);t.x=190;e.invokeHook(own,'update',null,5);assert.equal(own.behavior.getArenaExtensionState().charge,3);e.dealDamage(own,60,t);assert.equal(own.behavior.getArenaExtensionState().charge,20);t.x=100;e.invokeHook(own,'update',null,5);assert.equal(t.hp,980);assert.equal(own.behavior.getArenaExtensionState().charge,0);dispose(e);
});
test('supplies cap at two and heal only injured interactable combatants',()=>{
 dummy();const e=frozen(battle('arenaDummy','arenaDummy')),h=new c.ArenaMechanisms(e,{supplies:true});h.update(30);assert.equal(h.supplies.length,2);const b=e.game.balls[0];Object.assign(h.supplies[0],{x:b.x,y:b.y});h.update(.01);assert.equal(h.supplies.length,2);b.hp=995;h.update(.01);assert.equal(b.hp,1000);assert.equal(h.supplies.length,1);b.active=false;Object.assign(h.supplies[0],{x:b.x,y:b.y});b.hp=900;h.update(.01);assert.equal(b.hp,900);assert.equal(h.supplies.length,1);h.dispose();dispose(e);
});
test('pads respect cooldown and movement locks; laser respects steel defense',()=>{
 dummy();const e=battle('arenaDummy','steelCoil'),h=new c.ArenaMechanisms(e,{pads:true,laser:true}),b=e.game.balls[0];b.x=51;b.y=50;b.vx=-100;b.vy=0;h.update(.01);assert(b.vx>0);b.vx=-100;h.update(.1);assert.equal(b.vx,-100);h.update(1);assert(b.vx>0);e.setMovementLocked(b,true);b.vx=-100;h.update(1.1);assert.equal(b.vx,-100);
 const steel=e.game.balls[1];steel.x=50;steel.y=150;const before=steel.hp;h.nextLaser=h.time;h.update(.01);h.update(1.5);h.update(.1);assert(before-steel.hp>0&&before-steel.hp<8);const after=steel.hp;h.update(.1);assert.equal(steel.hp,after);h.dispose();dispose(e);
});
test('fixed seeded simulation including hazards is invariant across frame batch sizes',()=>{
 function simulate(batch){const e=new B.BattleEngine();let h;const session=B.createDeterministicSession({engine:e,seed:217,setup(engine){engine.createGame('arenaBattery','arenaBubble');h=new c.ArenaMechanisms(engine,{pads:true,supplies:true,laser:true});engine.beginFight();}});const update=e.update.bind(e);e.update=dt=>{const t=e.game.time;update(dt);h.update(e.game.time-t);};for(let n=0;n<1200;n+=batch)session.advance(Math.min(batch,1200-n)/60);const result=JSON.stringify({balls:e.game.balls.map(b=>({id:b.id,hp:b.hp,x:b.x,y:b.y})),supplies:h.supplies,steps:session.steps});session.dispose();h.dispose();dispose(e);return result;}
 assert.equal(simulate(1),simulate(4));assert.equal(simulate(1),simulate(12));
});

test('supplies do not spawn inside solid constructed obstacles',()=>{
 dummy();const e=frozen(battle('arenaDummy','arenaDummy'));e.game.combatEntities.push({solid:true,entityActive:true,x:100,y:100,length:200,width:200,angle:0});const h=new c.ArenaMechanisms(e,{supplies:true});h.update(10);assert.equal(h.supplies.length,0);h.dispose();dispose(e);
});
