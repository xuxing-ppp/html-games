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

test('184 original definitions preserved plus 27 local characters',()=>{
 assert.equal(registry.list().length,211);assert.equal(M.ORIGINAL_IDS.length,27);
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
test('map presets preserve area across ratios and keep the legacy medium arena',()=>{
 const s=M.defaults();
 assert.equal(M.configFor(s,B).arena,undefined);
 for(const [preset,scale] of Object.entries(M.MAP_PRESETS)){
  s.map.preset=preset;
  for(const ratio of [.5,1,1.37,2]){
   s.map.ratio=ratio;
   const {width,height}=M.mapDimensions(s,B),side=200*scale;
   assert(Math.abs(width/height-ratio)<1e-12);
   assert(Math.abs(width*height-side*side)<1e-8);
  }
 }
 s.map={preset:'huge',ratio:1};assert.equal(M.mapDimensions(s,B).width,800);
 s.mode='boss';assert.equal(M.mapDimensions(s,B).height,1200);
 s.map={preset:'custom',ratio:.5,width:550,height:125};
 assert.deepEqual({...M.mapDimensions(s,B)},{width:550,height:125});
 assert.deepEqual({...M.sanitize({map:{preset:'bad',ratio:NaN,width:901,height:101.1}},registry).map},
  {preset:'medium',ratio:1,width:200,height:200});
 assert.equal(M.sanitize({},registry).teamRings,true);
 assert.equal(M.sanitize({teamRings:false},registry).teamRings,false);
});
test('rectangular maps spawn and contain fighters in every game mode',()=>{
 const boss=registry.list().find(d=>d.rosterType==='boss').id;
 for(const mode of Object.keys(M.MODES))for(const [width,height] of [[340,190],[190,340]]){
  const s={...M.defaults(),mode,map:{preset:'custom',width,height}};
  if(mode==='boss')s.left=[boss];
  if(mode==='wheel'||mode==='team')s.left=['oldWoodMaster','arenaSpring'];
  if(mode==='brawl')s.brawl=Array(12).fill('arenaSpring');
  if(mode!=='boss')s.physics=width>height?'gyro':'bounce';
  const e=new B.BattleEngine();e.createBattle(M.configFor(s,B));e.beginFight();
  assert.equal(e.arena.width,width);assert.equal(e.arena.height,height);
  const active=e.game.balls.filter(b=>e.isBallActive(b));
  for(const b of active){
   assert(e.arena.contains(b.x,b.y,b.radius));
   for(const other of active)if(b!==other)assert(Math.hypot(b.x-other.x,b.y-other.y)+1e-9>=b.radius+other.radius);
  }
  if(mode==='wheel'){
   e.dealDamage(active[0],1e4,active[1]);e.update(1/60);
   const next=e.game.competitiveMode.activeFor('left');
   assert.equal(next.id,'arenaSpring');assert(e.arena.contains(next.x,next.y,next.radius));
  }
  const mechanisms=new c.ArenaMechanisms(e,{laser:true});
  for(const pad of mechanisms.pads())assert(e.arena.contains(pad.x,pad.y,pad.radius));
  assert.equal(mechanisms.laserPosition(true,0),e.arena.left);
  assert.equal(mechanisms.laserPosition(false,1),e.arena.bottom);
  mechanisms.dispose();dispose(e);
 }
 const s={...M.defaults(),mode:'team',map:{preset:'custom',width:100,height:100},left:Array(6).fill('arenaSpring')};
 assert.throws(()=>B.normalizeBattleConfig(M.configFor(s,B),registry),/cannot fit/);
});
test('camera contains distant fighters, eases in and respects the original viewport floor',()=>{
 const arena=B.createArenaGeometry({shape:'rectangle',width:800,height:500});
 const balls=[{x:15,y:165,radius:15},{x:785,y:635,radius:15}];
 const wide=M.cameraFrame(arena,balls,200);
 assert.equal(wide.size,800);
 const close=balls.map((b,index)=>({...b,x:65+index*35,y:195}));
 const easing=M.cameraFrame(arena,close,200,wide,1/60);
 assert(easing.size>200&&easing.size<wide.size);
 const tight=M.cameraFrame(arena,close,200);
 assert.deepEqual({...tight},{x:0,y:150,size:200});
 const expanded=M.cameraFrame(arena,balls,200,tight,1/60);
 assert.equal(expanded.size,800);
 assert.deepEqual({...M.cameraFrame(B.createArenaGeometry(160),balls,200)},{x:0,y:0,size:160});
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
test('all 27 local characters have finite state and no entity leaks',()=>{
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
test('courier reuses only vacant box slots and draws boxes inside the arena',()=>{
 dummy();
 const s={...M.defaults(),left:['arenaCourier'],right:['arenaDummy'],map:{preset:'custom',width:330,height:180}};
 const e=new B.BattleEngine();e.createBattle(M.configFor(s,B));e.beginFight();frozen(e);
 const [own,target]=e.game.balls;
 own.x=own.prevX=e.arena.left+own.radius;own.y=own.prevY=e.arena.top+own.radius;
 target.x=target.prevX=e.arena.right-target.radius;
 const hitTexts=[];
 e.spawnHitText=(x,y,text)=>hitTexts.push(text);
 run(e,7.6);
 const state=stateOf(own);
 assert.equal(state.spawns,3);assert.equal(state.boxes,2);assert.equal(new Set(state.slots).size,2);
 assert.equal(own.hp,own.maxHp);assert(!hitTexts.some(text=>String(text).startsWith('+')));
 const boxes=[];
 const canvas=new Proxy({strokeRect(x,y,w){if(w===16)boxes.push({x:x+8,y:y+8});}},
  {get:(ctx,key)=>key in ctx?ctx[key]:()=>{}});
 e.invokeHook(own,'drawAfter',null,canvas);
 assert.equal(boxes.length,2);
 assert.notDeepEqual(boxes[0],boxes[1]);
 for(const box of boxes)assert(e.arena.contains(box.x,box.y,15));
 Object.assign(target,boxes[0],{prevX:boxes[0].x,prevY:boxes[0].y});
 const hp=target.hp;e.update(1/60);assert(target.hp<=hp-7);
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

function originalFixture(id,x,y,ownerX=45,ownerY=100){
 dummy();
 const e=frozen(battle(id,'arenaDummy')), [owner,target]=e.game.balls;
 move(owner,ownerX,ownerY);move(target,x,y);
 owner.storedVx=150;owner.storedVy=0;
 return {e,owner,target};
}

function move(ball,x,y){ball.x=ball.prevX=x;ball.y=ball.prevY=y;}

test('new periodic skills honor their first cooldown and per-target damage limits',()=>{
 const cases=[
  ['Beacon',3,3.65,3,108,100],
  ['Tremor',4,4.85,4,40,100,93],
  ['Bellows',3,4,2,100,100],
  ['HourglassMagnet',5,5.75,3,120,100,70],
  ['KiteBox',4,5.1,4,98,100],
  ['Ruler',3,3.05,4,98,100],
  ['RainBarrel',4,4.81,4,105,100],
  ['FoldingBarrier',5,5.68,2,62,125,85],
  ['TideWheel',4,4.56,3,100,150,100],
  ['MirrorShard',3,3.65,4,87,100],
  ['CarbonTape',5,6.1,4,138,100,100],
  ['PrismLamp',4,4.9,4,105,100],
  ['Gate',5,7,3,120,100],
  ['StepLight',5,6,4,88,100]
 ];
 for(const [id,period,time,damage,x,y,ownerX] of cases){
  const {e,owner,target}=originalFixture('arena'+id,x,y,ownerX);
  run(e,period-1/60);
  assert.equal(stateOf(owner).casts,0,id);
  assert.equal(target.hp,1000,id);
  run(e,time-period+1/60);
  assert.equal(stateOf(owner).casts,1,id);
  assert.equal(target.hp,1000-damage,id);
  if(id==='Beacon')assert.equal(e.getSlowFactor(target),.75);
  if(id==='StepLight')assert.equal(owner.speedMultiplier,1.25);
  dispose(e);
 }
});

test('rivets are collected once, paper breaks locally, and the spool snaps on crossing',()=>{
 {
  const {e,owner,target}=originalFixture('arenaRiveter',36,140,100);
  run(e,4.6);
  const rivet=e.game.combatEntities.find(entity=>entity.kind==='arena-rivet');
  assert(rivet);
  move(owner,rivet.x-15,rivet.y);
  run(e,.45);
  e.invokeHook(owner,'onCollision',null,target);
  assert.equal(target.hp,993);
  e.invokeHook(owner,'onCollision',null,target);
  assert.equal(target.hp,991);
  dispose(e);
 }
 {
  const {e,target}=originalFixture('arenaCardboard',35,140,100);
  run(e,5.1);
  const board=e.game.combatEntities.find(entity=>entity.kind==='arena-cardboard');
  assert.equal(board.segments.filter(s=>s.alive).length,6);
  move(target,77,105);
  e.updateCombatEntity(board,1/60);
  assert.equal(board.segments.filter(s=>s.alive).length,5);
  move(target,35,140);
  const shot=e.spawnProjectile({kind:'test-paper-shot',x:66,y:125,vx:80,vy:0,radius:2,life:1},target);
  shot.previousX=66;shot.previousY=125;shot.x=85;
  e.updateCombatEntity(board,1/60);
  assert.equal(shot.entityActive,false);
  assert.equal(board.segments.filter(s=>s.alive).length,4);
  dispose(e);
 }
 {
  const {e,target}=originalFixture('arenaSpool',130,135);
  run(e,5.1);
  const thread=e.game.combatEntities.find(entity=>entity.kind==='arena-thread');
  assert(thread);
  move(target,90,100);target.prevX=53;
  e.updateCombatEntity(thread,1/60);
  assert.equal(target.hp,997);
  assert.equal(thread.entityActive,false);
  dispose(e);
 }
});

test('ceramic armor, ink stacks, heat shields and lantern recall settle through the engine',()=>{
 {
  const {e,owner,target}=originalFixture('arenaPottery',110,100);
  run(e,5.05);
  e.dealDamage(owner,7,target);assert.equal(owner.hp,97);assert.equal(owner.speedMultiplier,1.2);
  e.dealDamage(owner,7,target);assert.equal(owner.hp,90);
  dispose(e);
 }
 {
  const {e,owner,target}=originalFixture('arenaInkStamp',110,100);
  e.invokeHook(owner,'onCollision',null,target);
  e.invokeHook(owner,'onCollision',null,target);
  const mark=[...target.effects.values()][0];
  e.invokeEffectHook(target,mark,'onWallBounce');
  assert.equal(target.hp,993);assert.equal(target.effects.size,0);
  dispose(e);
 }
 {
  const e=frozen(battle(['arenaHeatPump','arenaDummy'],'arenaDummy','nvn'));
  const [owner,ally,enemy]=e.game.balls;
  move(owner,45,70);move(ally,45,120);move(enemy,110,100);
  e.applyEffect(owner,{id:'control',duration:5,preventsAttack:true,pausesBehavior:true},enemy);
  for(let i=0;i<3;i++)e.dealDamage(owner,1,enemy);
  assert.equal(owner.hp,97);
  e.dealDamage(ally,4,enemy);assert.equal(ally.hp,999);
  e.dealDamage(owner,2,enemy);assert.equal(owner.hp,97);
  e.dealDamage(owner,3,enemy);assert.equal(owner.hp,95);
  dispose(e);
 }
 {
  const {e,owner,target}=originalFixture('arenaSlideLantern',115,100);
  run(e,5.05);
  move(owner,82,70);
  e.dealDamage(owner,2,target);assert.equal(owner.x,45);assert.equal(owner.y,100);
  move(owner,82,70);
  e.dealDamage(owner,2,target);assert.equal(owner.x,82);
  dispose(e);
 }
});

test('airborne projectiles skip ground hits and interception until they land',()=>{
 const {e,owner,target}=originalFixture('arenaKiteBox',98,100);
 run(e,4.15);
 const flight=e.game.combatEntities.find(entity=>entity.kind==='arena-kite');
 assert.equal(flight.contactLayer,'air');
 assert(flight.height>0&&flight.y===100);
 assert.equal(e.canContact(flight.combatSource,target),false);
 assert.equal(e.dealDamage(target,9,flight.combatSource),false);
 assert.equal(target.hp,1000);
 run(e,.95);
 assert.equal(target.hp,996);
 dispose(e);
});

test('controlled collision and wall events cannot run an active original skill',()=>{
 const {e,owner,target}=originalFixture('arenaInkStamp',110,100);
 e.applyEffect(owner,{id:'control',duration:3,pausesBehavior:true,preventsAttack:true},target);
 e.invokeHook(owner,'onCollision',null,target);
 assert.equal(target.hp,1000);assert.equal(target.effects.size,0);
 e.removeEffect(owner,'control');
 e.invokeHook(owner,'onCollision',null,target);
 assert.equal(target.hp,998);assert.equal(target.effects.size,1);
 dispose(e);
});

test('new skills replay deterministically on normal and rectangular arena presets',()=>{
 for(const map of [{preset:'medium'},{preset:'huge',ratio:2},{preset:'large',ratio:.5}]){
  function replay(){
   const e=new B.BattleEngine();
   const settings={...M.defaults(),mode:'team',left:['arenaKiteBox','arenaCardboard','arenaTremor'],
    right:['arenaStepLight','arenaMirrorShard','arenaHeatPump'],map};
   const session=B.createDeterministicSession({engine:e,seed:332,setup(engine){
    engine.createBattle(M.configFor(settings,B));engine.beginFight();
   }});
   for(let i=0;i<600;i++)session.advance(1/60);
   const results=JSON.stringify({
    balls:e.game.balls.map(({id,x,y,hp})=>({id,x,y,hp})),
    entities:e.game.combatEntities.map(({kind,age,x,y})=>({kind,age,x,y}))
   });
   session.dispose();dispose(e);return results;
  }
  assert.equal(replay(),replay());
 }
});

test('temporary haste is never written into the boxer base multiplier',()=>{
 const {e,owner,target}=originalFixture('boxer',100,100);
 e.applyEffect(owner,{id:'temporary-haste',duration:.4,speedFactor:1.5},owner);
 run(e,.1);
 assert(owner.behavior.getBoxerState().anchored);
 assert.equal(owner.speedMultiplierBase,B.BOXER_SLOW_FACTOR);
 assert(Math.abs(owner.speedMultiplier-B.BOXER_SLOW_FACTOR*1.5)<1e-10);
 move(target,175,175);
 run(e,.6);
 assert.equal(owner.speedMultiplierBase,1);
 assert.equal(owner.speedMultiplier,1);
 dispose(e);
});

test('carpentry releases its movement lock after displacement on a rectangular map',()=>{
 dummy();
 const e=new B.BattleEngine(),s={...M.defaults(),left:['oldWoodMaster'],right:['arenaDummy'],map:{preset:'custom',width:340,height:190}};
 e.createBattle(M.configFor(s,B));e.beginFight();
 const [owner,target]=e.game.balls;
 move(owner,e.arena.left+owner.radius,e.arena.centerY);move(target,180,170);
 e.setMovementLocked(target,true);
 e.invokeHook(owner,'onWallBounce',wall({x:e.arena.left,y:owner.y,normalX:1,normalY:0}));
 assert(owner.behavior.getOldWoodMasterState().nailing);
 assert(owner.movementLocked);
 move(owner,owner.x+30,owner.y);
 e.invokeHook(owner,'update',null,1/60);
 assert(!owner.behavior.getOldWoodMasterState().nailing);
 assert.equal(owner.movementLocked,false);
 dispose(e);
});

test('manhole transfer clears the original jump lock without leaving the borrower locked',()=>{
 const {e,owner,target}=originalFixture('manhole',165,165,80);
 const initial=owner.behavior.getManholeState().cover;
 e.setMovementLocked(owner,false);
 // Advance only the behavior during the animation to fix the relative positions.
 e.game.time+=.7;
 move(owner,initial.x,initial.y);
 e.invokeHook(owner,'afterUpdateStep');
 assert.equal(owner.behavior.getManholeState().phase,'underground');
 for(let i=0;i<125;i++){
  e.game.time+=1/60;
  e.invokeHook(owner,'update',null,1/60);
  e.invokeHook(owner,'afterUpdateStep');
 }
 assert.equal(owner.behavior.getManholeState().phase,'airborne');
 assert.equal(owner.movementLocked,true);
 e.setMovementLocked(target,false);
 const lease=e.borrowAttack(owner,target);
 assert(lease);
 assert.equal(owner.movementLocked,false);
 assert.equal(target.movementLocked,false);
 lease.release();dispose(e);
});

test('impact of an exchanged black-hole effect tracks the new victim and releases on expiry',()=>{
 const {e,owner,target}=originalFixture('blackHole',130,100,60);
 const hole=e.spawnCombatEntity(B.createBlackHoleVortex(target.x,target.y,e.arenaSize),owner);
 e.updateCombatEntity(hole,1/60);
 assert.equal(hole.victim,target);
 assert.equal(hole.holdEffect,target.effects.get('black-hole-hold'));
 e.exchangeEffects(owner,target,effect=>effect.id==='black-hole-hold');
 assert.equal(hole.victim,owner);
 e.removeEffect(owner,'black-hole-hold');
 assert.equal(hole.victim,null);assert.equal(hole.holdEffect,null);
 dispose(e);
});

test('meteor hammer keeps its nodes inside rectangular walls as the owner moves',()=>{
 dummy();
 const e=new B.BattleEngine(),s={...M.defaults(),left:['meteor-hammer'],right:['arenaDummy'],map:{preset:'custom',width:280,height:120}};
 e.createBattle(M.configFor(s,B));e.beginFight();
 const [owner,target]=e.game.balls;
 move(target,240,e.arena.centerY);
 for(const [x,y] of [[15,e.arena.top+15],[15,e.arena.bottom-15],[e.arena.right-15,e.arena.bottom-15]]){
  move(owner,x,y);run(e,.19);
  const {points}=owner.behavior.getMeteorHammerState();
  assert(points.every(p=>e.arena.contains(p.x,p.y)));
 }
 dispose(e);
});

test('vampire bite follows the transferred bind and stops targeting the borrower',()=>{
 const {e,owner, target:borrower}=originalFixture('vampire',96,100);
 e.invokeHook(owner,'onCollision',null,borrower);
 assert(borrower.effects.has('vampire-bind'));
 const lease=e.borrowAttack(owner,borrower);
 assert(lease);
 e.exchangeEffects(owner,borrower,effect=>effect.id==='vampire-bind');
 assert(owner.effects.has('vampire-bind'));assert(!borrower.effects.has('vampire-bind'));
 const ownerHp=owner.hp,borrowerHp=borrower.hp;
 e.game.time+=.75;
 lease.invoke('update',{game:e.gameView()},.75);
 assert(owner.hp<ownerHp);assert(borrower.hp>=borrowerHp);
 e.exchangeEffects(owner,borrower,effect=>effect.id==='vampire-bind');
 lease.release();dispose(e);
});
