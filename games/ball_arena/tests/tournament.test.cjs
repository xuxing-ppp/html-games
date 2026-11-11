const test=require('node:test'),assert=require('node:assert/strict'),{load}=require('./load.cjs');
const c=load(),T=c.ArenaTournament,B=c.BallBattle,registry=B.ballRegistry,plain=value=>JSON.parse(JSON.stringify(value));
const draw=(size=4,teamSize=1,filterElite=false)=>T.draw(registry,{size,teamSize,filterElite,physics:'none',hazards:{pads:false,supplies:false,laser:false}},217);
function finish(run){let match;while((match=T.nextPendingMatch(run.bracket))){const seed=T.seedFor(run,match);assert(T.settle(run,match.id,match.index%2,seed));}return run;}
test('original model exposed independently and all six field sizes available',()=>{
 assert.deepEqual(plain(T.SIZES),[4,8,16,32,64,128]);assert.deepEqual(plain(B.TOURNAMENT_SIZES),[4]);
});
test('entry pool follows original bans, normal/elite types and elite filter',()=>{
 const pool=T.pool(registry);assert.equal(pool.length,178);assert(pool.every(d=>['normal','elite'].includes(d.rosterType)&&!T.BANNED.has(d.id)));assert.equal(T.pool(registry,true).length,175);assert(T.pool(registry,true).every(d=>d.rosterType==='normal'));
});
test('elite slot weighting produces the same capacities as the original',()=>{
 assert.deepEqual([1,2,3].map(n=>T.capacity(registry,n)),[178,90,60]);assert.deepEqual([1,2,3].map(n=>T.capacity(registry,n,true)),[175,87,58]);
});
test('draw is reproducible, uses unique roles and packs exact weighted team sizes',()=>{
 for(const teamSize of [1,2,3])for(const size of T.SIZES){if(size>T.capacity(registry,teamSize)){assert.throws(()=>draw(size,teamSize),/不足/);continue;}const run=draw(size,teamSize),roles=[];assert.equal(run.bracket.size,size);assert.equal(JSON.stringify(run),JSON.stringify(draw(size,teamSize)));
 for(const entrant of run.bracket.entrants){const ids=T.entrantIds(run,entrant);roles.push(...ids);assert.equal(ids.reduce((sum,id)=>sum+(teamSize>1&&registry.get(id).rosterType==='elite'?2:1),0),teamSize);}
 assert.equal(new Set(roles).size,roles.length);
 }
});
test('insufficient sizes are rejected without shrinking the bracket',()=>{
 assert.throws(()=>draw(128,2),/不足/);assert.throws(()=>draw(64,3),/不足/);assert.throws(()=>draw(3),/有效/);assert.throws(()=>draw(256),/有效/);
});
test('4 through 128 entrants advance through exactly size-minus-one matches',()=>{
 for(const size of T.SIZES){const run=finish(draw(size));assert(T.isTournamentComplete(run.bracket));assert(run.bracket.entrants.includes(T.tournamentChampionId(run.bracket)));assert.equal(T.tournamentProgress(run.bracket).playedCount,size-1);assert.equal(run.bracket.rounds.length,Math.log2(size));}
});
test('draws do not advance and a rematch receives a different deterministic seed',()=>{
 const run=draw(),match=T.nextPendingMatch(run.bracket),first=T.seedFor(run,match);assert.equal(T.seedFor(run,match),first);assert(T.settle(run,match.id,null,first));assert.equal(T.settle(run,match.id,null,first),false);assert.equal(T.tournamentProgress(run.bracket).playedCount,0);assert.equal(T.nextPendingMatch(run.bracket).id,match.id);const second=T.seedFor(run,match);assert.notEqual(second,first);assert.equal(T.settle(run,match.id,0,first),false);assert(T.settle(run,match.id,1,second));assert.equal(T.settle(run,match.id,0,second),false);assert.equal(T.tournamentProgress(run.bracket).playedCount,1);
});
test('saved brackets restore including champion and reject corrupt progression',()=>{
 for(const teamSize of [1,2,3]){const run=finish(draw(4,teamSize));assert.deepEqual(plain(T.restore(JSON.stringify(run),registry)),plain(run));}
 const run=draw(8);const first=T.nextPendingMatch(run.bracket);T.seedFor(run,first);assert(T.restore(JSON.stringify(run),registry));
 const corrupt=plain(run);corrupt.bracket.rounds[1][0].leftId=corrupt.bracket.entrants[0];assert.equal(T.restore(JSON.stringify(corrupt),registry),null);
 const duplicate=plain(draw(4,3));duplicate.bracket.teams[1].ballIds=duplicate.bracket.teams[0].ballIds;assert.equal(T.restore(JSON.stringify(duplicate),registry),null);
 assert.equal(T.restore('bad',registry),null);
 const impossible=plain(draw());impossible.bracket.entrants[0]='hina';impossible.bracket.rounds[0][0].leftId='hina';assert.equal(T.restore(JSON.stringify(impossible),registry),null);
});
test('tournament matches map to original team battle configuration and reset health',()=>{
 const run=draw(4,3),match=T.nextPendingMatch(run.bracket);const s=T.battleState(run,match);assert.equal(s.mode,'team');const e=new B.BattleEngine();e.createBattle(c.ArenaModel.configFor(s,B));e.beginFight();for(const b of e.game.balls)assert.equal(b.hp,b.maxHp);e.game.balls[0].hp=1;e.createBattle(c.ArenaModel.configFor(s,B));assert.equal(e.game.balls[0].hp,e.game.balls[0].maxHp);
});
test('wheel formats preserve weighted capacity, order, saves and engine rotation',()=>{
 assert.deepEqual([4,5,6].map(n=>T.capacity(registry,n)),[45,36,30]);
 assert.deepEqual([4,5,6].map(n=>T.capacity(registry,n,true)),[43,35,29]);
 for(const teamSize of [2,3,4,5,6])for(const filterElite of [false,true]){
  const options={size:4,teamSize,filterElite,battleMode:'wheel'},run=T.draw(registry,options,217);
  assert.equal(JSON.stringify(run),JSON.stringify(T.draw(registry,options,217)));
  assert.deepEqual(plain(T.restore(JSON.stringify(run),registry)),plain(run));
  const used=[];for(const entrant of run.bracket.entrants){const ids=T.entrantIds(run,entrant);used.push(...ids);assert.equal(ids.reduce((n,id)=>n+(registry.get(id).rosterType==='elite'?2:1),0),teamSize);}
  assert.equal(new Set(used).size,used.length);
  const match=T.nextPendingMatch(run.bracket),s=T.battleState(run,match),e=new B.BattleEngine();assert.equal(s.mode,'wheel');e.createBattle(c.ArenaModel.configFor(s,B));e.beginFight();
  const ctrl=e.game.competitiveMode,left=ctrl.activeFor('left'),right=ctrl.activeFor('right');right.hp=73;
  if(s.left.length>1){left.hp=0;ctrl.advanceTeam('left');assert.equal(ctrl.activeFor('left').id,s.left[1]);assert.equal(right.hp,73);}
  e.createBattle(c.ArenaModel.configFor(s,B));assert(e.game.balls.every(b=>b.hp===b.maxHp));
 }
 const old=plain(draw());delete old.settings.battleMode;assert.equal(T.restore(JSON.stringify(old),registry).settings.battleMode,'standard');
 assert.throws(()=>T.draw(registry,{size:4,teamSize:6},1),/有效/);
 const invalid=plain(T.draw(registry,{size:4,teamSize:6,battleMode:'wheel'},1));invalid.settings.battleMode='standard';assert.equal(T.restore(JSON.stringify(invalid),registry),null);
});
test('extended packing reaches advertised capacity for varied normal and elite pools',()=>{
 for(let normals=0;normals<15;normals++)for(let elites=0;elites<10;elites++)for(const teamSize of [4,5,6]){
  const defs=Array.from({length:normals+elites},(_,i)=>({id:'role'+i,rosterType:i<normals?'normal':'elite'})),cap=T.tournamentTeamCapacity(defs,teamSize);
  if(cap<2)continue;const size=2**Math.floor(Math.log2(cap)),bracket=T.createTeamTournament(defs,{size,teamSize,random:B.createSeededRandom(8)});
  for(const team of bracket.teams)assert.equal(team.ballIds.reduce((n,id)=>n+(defs.find(d=>d.id===id).rosterType==='elite'?2:1),0),teamSize);
 }
});

test('wheel retention setting survives save and battle mapping, old saves default on',()=>{
 const run=T.draw(registry,{size:4,teamSize:2,battleMode:'wheel',physics:'none',hazards:{},retainDeadSkills:false},57);
 const restored=T.restore(JSON.stringify(run),registry);
 assert.equal(restored.settings.retainDeadSkills,false);
 assert.equal(T.battleState(restored,T.nextPendingMatch(restored.bracket)).retainDeadSkills,false);
 delete run.settings.retainDeadSkills;
 assert.equal(T.restore(JSON.stringify(run),registry).settings.retainDeadSkills,true);
});
