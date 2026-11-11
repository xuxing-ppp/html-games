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
function dummy(id='arenaDummy',name='测试靶'){
 if(registry.list().some(d=>d.id===id))return;
 registry.register({id,name,englishName:'Test target',color:'#eeeeee',description:'Tests only',stats:{radius:15,speed:150,maxHp:1000},createBehavior:()=>({})});
}
function stateOf(ball){return ball.behavior.getArenaExtensionState();}
function stunActive(ball){return [...ball.effects.values()].some(effect=>effect.visualType==='stun');}
function wall(context={x:0,y:100,normalX:1,normalY:0}){return {bouncedX:true,bouncedY:false,wallContacts:[context]};}

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
test('all six original characters have finite state and no entity leaks',()=>{
 dummy();
 for(const id of M.ORIGINAL_IDS){
  const e=frozen(battle(id,'arenaDummy'));run(e,12);const own=e.game.balls[0];assert(Number.isFinite(own.hp));assert(Number.isFinite(own.x)&&Number.isFinite(own.y));assert(stateOf(own));
  if(id==='arenaPainter')assert(stateOf(own).pools<=6&&stateOf(own).stripes<=4);
  if(id==='arenaCourier')assert(stateOf(own).boxes<=3);
  if(id==='arenaBattery')assert(stateOf(own).charge>=0&&stateOf(own).charge<=4);
  dispose(e);assert.equal(e.entitySystem.entities.length,0,id);
 }
});
test('spring compresses on walls, then spends layers on a heavy contact hit',()=>{
 dummy();const e=frozen(battle('arenaSpring','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 for(let i=0;i<3;i++)e.invokeHook(own,'onWallBounce',wall());
 assert.equal(stateOf(own).stacks,3);assert(stateOf(own).wallHits,3);
 const before=target.hp;e.invokeHook(own,'onCollision',null,target);
 assert.equal(before-target.hp,10);assert(stunActive(target));assert.equal(stateOf(own).stacks,0);
 const hpBefore=own.hp;e.invokeHook(own,'onWallBounce',wall());e.invokeHook(own,'onWallBounce',wall());
 e.dealDamage(own,10,target);assert(own.hp>hpBefore-8); // 2 layers reduce the hit.
 dispose(e);
});
test('painter creates pools and wall stripes that slow and damage',()=>{
 dummy();const e=frozen(battle('arenaPainter','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 target.x=target.prevX=own.x;target.y=target.prevY=own.y;run(e,2);
 assert(stateOf(own).pools>=1);assert(stateOf(own).attacks>=1);assert(target.hp<1000);assert(e.getSlowFactor(target)<1);
 e.invokeHook(own,'onWallBounce',wall());assert(stateOf(own).stripes>=1);
 target.x=target.prevX=5;target.y=target.prevY=100;const before=target.hp;run(e,.7);assert(target.hp<before);
 for(let i=0;i<6;i++)e.invokeHook(own,'onWallBounce',wall());
 assert(stateOf(own).stripes<=4);
 dispose(e);
});
test('courier boxes orbit, damage enemies, and return as supplies',()=>{
 dummy();const e=frozen(battle('arenaCourier','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 target.x=target.prevX=100;target.y=target.prevY=100;run(e,4);
 assert(stateOf(own).spawns>=1);assert(stateOf(own).hits>=1);assert(stateOf(own).boxes<=3);assert(target.hp<1000);
 const beforeHp=own.hp;e.dealDamage(own,20,target);assert(own.hp>beforeHp-20);
 target.x=target.prevX=190;own.hp=90;run(e,3.2);assert(stateOf(own).pickups>=1);assert(own.hp>90);
 dispose(e);
});
test('boomerang ricochets without tracking and hits for three per target',()=>{
 dummy();const e=frozen(battle('arenaBoomerang','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 target.x=target.prevX=130;target.y=target.prevY=100;run(e,3.2);
 assert(stateOf(own).attacks>=1);assert(stateOf(own).hits>=1);assert(target.hp<1000);
 dispose(e);
});
test('bubble form is invulnerable and pops into a damaging foam field',()=>{
 dummy();const e=frozen(battle('arenaBubble','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 target.x=target.prevX=own.x;target.y=target.prevY=own.y;run(e,2.9);
 assert(stateOf(own).bubbled);
 const before=own.hp;e.dealDamage(own,20,target);assert.equal(own.hp,before);
 const profile=own.behavior.getContactProfile();assert.equal(profile.physical,false);assert.equal(profile.targetable,false);
 run(e,1.4);assert(!stateOf(own).bubbled);assert(stateOf(own).pops>=1);assert(target.hp<1000);
 dispose(e);
});
test('battery stores damage and wall hits, then discharges on contact or full charge',()=>{
 dummy();const e=frozen(battle('arenaBattery','arenaDummy')),own=e.game.balls[0],target=e.game.balls[1];
 e.dealDamage(own,10,target);assert.equal(stateOf(own).charge,1);
 e.invokeHook(own,'onWallBounce',wall());assert.equal(stateOf(own).charge,2);
 const before=target.hp;e.invokeHook(own,'onCollision',null,target);assert.equal(before-target.hp,6);assert.equal(stateOf(own).charge,0);
 for(let i=0;i<4;i++)e.dealDamage(own,10,target);assert.equal(stateOf(own).charge,4);
 const hpBefore=target.hp;run(e,2.7);assert(stateOf(own).discharges>=1);assert(stateOf(own).charge===0);assert(target.hp<hpBefore);
 dispose(e);
});
test('supplies cap at two and heal only injured interactable combatants',()=>{
 dummy();const e=frozen(battle('arenaDummy','arenaDummy')),h=new c.ArenaMechanisms(e,{supplies:true});h.update(30);assert.equal(h.supplies.length,2);const b=e.game.balls[0];Object.assign(h.supplies[0],{x:b.x,y:b.y});h.update(.01);assert.equal(h.supplies.length,2);b.hp=995;h.update(.01);assert.equal(b.hp,1000);assert.equal(h.supplies.length,1);b.active=false;Object.assign(h.supplies[0],{x:b.x,y:b.y});b.hp=900;h.update(.01);assert.equal(b.hp,900);assert.equal(h.supplies.length,1);h.dispose();dispose(e);
});
test('pads respect cooldown and movement locks; laser respects steel defense',()=>{
 dummy();const e=battle('arenaDummy','steelCoil'),h=new c.ArenaMechanisms(e,{pads:true,laser:true}),b=e.game.balls[0];b.x=51;b.y=50;b.vx=-100;b.vy=0;h.update(.01);assert(b.vx>0);b.vx=-100;h.update(.1);assert.equal(b.vx,-100);h.update(1);assert(b.vx>0);e.setMovementLocked(b,true);b.vx=-100;h.update(1.1);assert.equal(b.vx,-100);
 const steel=e.game.balls[1];steel.x=50;steel.y=150;const before=steel.hp;h.nextLaser=h.time;h.update(.01);h.update(1.5);h.update(.1);assert(before-steel.hp>0&&before-steel.hp<8);const after=steel.hp;h.update(.1);assert.equal(steel.hp,after);h.dispose();dispose(e);
});
test('fixed seeded simulation including hazards is invariant across frame batch sizes',()=>{
 function simulate(batch){const e=new B.BattleEngine();let h;const session=B.createDeterministicSession({engine:e,seed:217,setup(engine){engine.createGame('arenaPainter','arenaBattery');h=new c.ArenaMechanisms(engine,{pads:true,supplies:true,laser:true});engine.beginFight();}});const update=e.update.bind(e);e.update=dt=>{const t=e.game.time;update(dt);h.update(e.game.time-t);};for(let n=0;n<1200;n+=batch)session.advance(Math.min(batch,1200-n)/60);const result=JSON.stringify({balls:e.game.balls.map(b=>({id:b.id,hp:b.hp,x:b.x,y:b.y})),supplies:h.supplies,steps:session.steps});session.dispose();h.dispose();dispose(e);return result;}
 assert.equal(simulate(1),simulate(4));assert.equal(simulate(1),simulate(12));
});

test('supplies do not spawn inside solid constructed obstacles',()=>{
 dummy();const e=frozen(battle('arenaDummy','arenaDummy'));e.game.combatEntities.push({solid:true,entityActive:true,x:100,y:100,length:200,width:200,angle:0});const h=new c.ArenaMechanisms(e,{supplies:true});h.update(10);assert.equal(h.supplies.length,0);h.dispose();dispose(e);
});

test('clarified descriptions only target registered roles and stay complete',()=>{
 const entries=c.ArenaDescriptions;assert.ok(entries&&typeof entries==='object');
 for(const [id,entry] of Object.entries(entries)){
  const d=registry.get(id);assert.ok(d,id);
  assert.equal(typeof entry.summary,'string');assert.equal(typeof entry.detail,'string');
  assert(entry.summary.trim().length>0,id);assert(entry.detail.trim().length>0,id);
  assert(entry.summary.length<=120,id);assert(entry.detail.length<=400,id);
  assert(!/[<>]/.test(entry.summary+entry.detail),id);
  assert(!entry.summary.includes('  ')&&!entry.detail.includes('  '),id);
 }
});

test('time limits differ by mode and timeout resolution uses remaining health',()=>{
 assert.deepEqual({...M.TIME_LIMITS},{duel:240,team:360,wheel:600,brawl:480,boss:480});
 assert.equal(M.timeLimit({mode:'duel'}),240);assert.equal(M.timeLimit({mode:'team'}),360);assert.equal(M.timeLimit({mode:'wheel'}),600);assert.equal(M.timeLimit({mode:'brawl'}),480);assert.equal(M.timeLimit({mode:'boss'}),480);assert.equal(M.timeLimit({mode:'unknown'}),240);
 const e=battle('oldWoodMaster','steelCoil');e.game.teams[0].balls[0].hp=40;e.game.teams[1].balls[0].hp=60;const result=e.resolveByHp();assert.equal(result.winnerTeamId,'right');assert.equal(e.game.winnerTeam.id,'right');assert.equal(e.game.state,'ended');dispose(e);
});

test('wheel replacements draw fresh seeded headings after automatic death notification',()=>{
 dummy('wheelHeadingProbe');
 function capture(seed,batches){
  const session=B.createDeterministicSession({registry,seed,setup:e=>{e.createBattle(B.createModeBattleConfig('wheel',['wheelHeadingProbe','wheelHeadingProbe','wheelHeadingProbe'],['wheelHeadingProbe','wheelHeadingProbe','wheelHeadingProbe']));e.beginFight();}}),e=session.engine,headings=[];
  const original=e.randomDirection;let calls=0;e.randomDirection=()=>{calls++;return original();};
  for(let round=0;round<2;round++){
   for(const team of e.game.teams)team.balls[round].hp=0;
   for(const dt of batches)session.advance(dt);
   for(const team of e.game.teams){const ball=team.balls[round+1];assert(e.isBallActive(ball));assert(Math.abs(ball.vx)>1e-6);assert(Math.abs(ball.vy)>1e-6);assert(Math.abs(Math.hypot(ball.vx,ball.vy)-e.effectiveSpeed(ball))<1e-6);headings.push([ball.vx,ball.vy]);}
  }
  assert.equal(calls,4);session.dispose();dispose(e);return headings;
 }
 const first=capture(217,[1/60]);assert.deepEqual(first,capture(217,[1/120,1/120]));assert.notDeepEqual(first,capture(218,[1/60]));assert.notDeepEqual(first[0],first[2]);
});

test('wheel skill retention defaults on and disabling clears dead owners and summon descendants',()=>{
 assert.equal(M.sanitize({},registry).retainDeadSkills,true);
 for(const retain of [true,false]){
  const e=battle(['spike','steelCoil'],['thumbtack','steelCoil'],'wheel');
  M.installWheelSkillCleanup(e,{mode:'wheel',retainDeadSkills:retain});
  const owner=e.game.teams[0].balls[0],enemy=e.game.teams[1].balls[0],next=e.game.teams[0].balls[1];
  e.invokeHook(owner,'onWallBounce',wall());
  const spike=e.game.combatEntities.find(x=>x.ownerInstanceId===owner.instanceId);assert(spike);
  const summon=e.spawnSummon(owner,registry.get('steelCoil'));
  const child=e.spawnCombatEntity({kind:'test-zone',life:100},summon);
  const enemyEntity=e.spawnCombatEntity({kind:'test-zone',life:100},enemy);
  e.entitySystem.beginStep();
  const pending=e.spawnCombatEntity({kind:'test-zone',life:100},owner);
  e.entitySystem.endStep();
  owner.hp=0;e.notifyNewDeaths();
  assert.equal(spike.entityActive,retain);assert.equal(child.entityActive,retain);assert.equal(pending.entityActive,retain);
  assert.equal(summon.hp>0,retain);assert.equal(enemyEntity.entityActive,true);assert(next.hp>0);
  run(e,.1);assert(e.isBallActive(next));
  if(!retain)assert(!e.game.combatEntities.some(x=>x.entityActive&&[owner.instanceId,summon.instanceId].includes(x.ownerInstanceId)));
  dispose(e);
 }
});

test('thumbtack shots disappear with their defeated wheel owner when retention is off',()=>{
 for(const retain of [true,false]){
  const e=frozen(battle(['thumbtack','steelCoil'],['steelCoil','steelCoil'],'wheel'));
  M.installWheelSkillCleanup(e,{mode:'wheel',retainDeadSkills:retain});
  const owner=e.game.teams[0].balls[0];
  e.invokeHook(owner,'update',null,10);e.invokeHook(owner,'afterUpdateStep');
  const tacks=e.game.combatEntities.filter(x=>x.ownerInstanceId===owner.instanceId);
  assert(tacks.length>0);owner.hp=0;e.notifyNewDeaths();
  assert(tacks.every(x=>x.entityActive===retain));dispose(e);
 }
});
