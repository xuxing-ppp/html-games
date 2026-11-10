(function(root){
'use strict';
const C=root.ArenaTournamentCore,B=root.BallBattle;
const SIZES=[4,8,16,32,64,128];
function validFormat(mode,size){return (mode==='standard'?[1,2,3]:mode==='wheel'?[2,3,4,5,6]:[]).includes(size);}
const BANNED=new Set(['hina','sixKing','daYun','daYunV2','sixZoneUltra','yiWanRen']);
function pool(registry,filterElite=false){return registry.list().filter(d=>(d.rosterType==='normal'||!filterElite&&d.rosterType==='elite')&&!BANNED.has(d.id));}
function capacity(registry,teamSize,filterElite=false){return C.tournamentTeamCapacity(pool(registry,filterElite),teamSize);}
function entrantIds(run,id){return C.tournamentEntrantBallIds(run.bracket,id);}
function entrantName(run,id,registry){if(!id)return '等待晋级';const ids=entrantIds(run,id);return run.bracket.teamSize===1?registry.get(ids[0]).name:'第 '+(run.bracket.entrants.indexOf(id)+1)+' 队';}
function teamText(run,id,registry){return entrantIds(run,id).map(ball=>registry.get(ball).name).join(' / ');}
function draw(registry,settings,seed){
 const {size,teamSize,filterElite=false,battleMode="standard"}=settings;
 if(!SIZES.includes(size)||!validFormat(battleMode,teamSize))throw new Error('请选择有效的锦标赛规模和队伍规格');
 const definitions=pool(registry,filterElite);
 if(C.tournamentTeamCapacity(definitions,teamSize)<size)throw new Error('角色数量不足，无法组成所选规模');
 const bracket=C.createTeamTournament(definitions,{size,teamSize,filterElite,random:B.createSeededRandom(seed>>>0)});
 return {version:1,drawSeed:seed>>>0,bracket,settings:{battleMode,physics:['none','bounce','gyro'].includes(settings.physics)?settings.physics:'none',hazards:Object.fromEntries(['pads','supplies','laser'].map(k=>[k,settings.hazards?.[k]===true]))},records:{}};
}
function seedFor(run,match){
 if(!match?.leftId||!match?.rightId)throw new Error('本场对手尚未确定');
 const record=run.records[match.id]||(run.records[match.id]={seed:null,attempts:0,draws:0});
 if(record.seed===null){record.seed=(run.drawSeed+Math.imul(match.round*128+match.index+1,2654435761)+Math.imul(record.attempts,1664525))>>>0;record.attempts++;}
 return record.seed;
}
function settle(run,matchId,winnerSide,seed){
 const match=C.findTournamentMatch(run.bracket,matchId),record=run.records[matchId];
 if(!match||match.winnerId||!record||record.seed!==seed)return false;
 if(winnerSide===null){record.draws++;record.seed=null;return true;}
 if(winnerSide!==0&&winnerSide!==1)return false;
 return C.recordMatchResult(run.bracket,matchId,winnerSide===0?match.leftId:match.rightId);
}
function battleState(run,match){return {mode:run.settings.battleMode==='wheel'?'wheel':run.bracket.teamSize===1?'duel':'team',left:entrantIds(run,match.leftId),right:entrantIds(run,match.rightId),series:1,physics:run.settings.physics,hazards:{...run.settings.hazards}};}
function restore(serialized,registry){
 try{
  const run=JSON.parse(serialized);if(!run||run.version!==1||!Number.isInteger(run.drawSeed)||run.drawSeed<0||run.drawSeed>4294967295)return null;
  const bracket=C.deserializeTournament(JSON.stringify(run.bracket));if(!bracket||!SIZES.includes(bracket.size)||bracket.entrants.length!==bracket.size)return null;
  const allowed=new Map(pool(registry,bracket.filterElite).map(d=>[d.id,d])),used=new Set();
  for(const entrant of bracket.entrants){if(typeof entrant!=='string')return null;const ids=C.tournamentEntrantBallIds(bracket,entrant);let cost=0;
   for(const id of ids){if(!allowed.has(id)||used.has(id))return null;used.add(id);cost+=bracket.teamSize===1?1:allowed.get(id).rosterType==='elite'?2:1;}
   if(cost!==bracket.teamSize)return null;
  }
  for(let r=0;r<bracket.rounds.length;r++)for(let m=0;m<bracket.rounds[r].length;m++){
   const match=bracket.rounds[r][m];if(match.id!==`r${r}-m${m}`||match.round!==r||match.index!==m)return null;
   const left=r===0?bracket.entrants[m*2]:bracket.rounds[r-1][m*2].winnerId,right=r===0?bracket.entrants[m*2+1]:bracket.rounds[r-1][m*2+1].winnerId;
   if(match.leftId!==left||match.rightId!==right||match.winnerId&&(!left||!right))return null;
  }
  if(!run.settings||!['none','bounce','gyro'].includes(run.settings.physics)||typeof run.settings.hazards!=='object'||!run.settings.hazards)return null;
  if(run.settings.battleMode===undefined)run.settings.battleMode='standard';
  if(!validFormat(run.settings.battleMode,bracket.teamSize))return null;
  for(const k of ['pads','supplies','laser'])if(typeof run.settings.hazards[k]!=='boolean')return null;
  if(!run.records||typeof run.records!=='object'||Array.isArray(run.records))return null;
  for(const [id,rec] of Object.entries(run.records))if(!C.findTournamentMatch(bracket,id)||!rec||!(rec.seed===null||Number.isInteger(rec.seed)&&rec.seed>=0&&rec.seed<=4294967295)||!Number.isSafeInteger(rec.attempts)||rec.attempts<1||!Number.isSafeInteger(rec.draws)||rec.draws<0)return null;
  run.bracket=bracket;return run;
 }catch{return null;}
}
root.ArenaTournament={...C,SIZES,BANNED,pool,capacity,draw,entrantIds,entrantName,teamText,seedFor,settle,battleState,restore};
})(globalThis);
