(function(){
'use strict';
const A=globalThis.ArenaApp,T=globalThis.ArenaTournament,B=globalThis.BallBattle,registry=B.ballRegistry,$=id=>document.getElementById(id),esc=A.esc;
const KEY='ball-arena-tournament-v1',OPTIONS_KEY='ball-arena-tournament-options-v1';
let run=null,prefs={teamSize:1,size:32,filterElite:false},selectedRound=0,detailMatch=null;
try{run=T.restore(localStorage.getItem(KEY),registry);const stored=JSON.parse(localStorage.getItem(OPTIONS_KEY));if(stored){prefs.teamSize=[1,2,3].includes(stored.teamSize)?stored.teamSize:1;prefs.size=T.SIZES.includes(stored.size)?stored.size:null;prefs.filterElite=stored.filterElite===true;}}catch{}
if(run)selectedRound=T.tournamentProgress(run.bracket).roundIndex;
function save(){try{if(run)localStorage.setItem(KEY,JSON.stringify(run));else localStorage.removeItem(KEY);localStorage.setItem(OPTIONS_KEY,JSON.stringify(prefs));}catch{}}
function randomSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function live(){return !!run&&A.context?.tournamentRun===run&&!!A.session&&!A.settled;}
function entrant(id,match){
 if(!id)return '<span class="tournament-waiting">等待晋级</span>';
 const ids=T.entrantIds(run,id),winner=match?.winnerId===id;
 return `<span class="tournament-entrant ${winner?'winner':''}"><span class="tournament-ball-dots">${ids.map(ball=>`<i style="background:${registry.get(ball).color}"></i>`).join('')}</span><span class="tournament-entrant-copy"><strong>${esc(T.entrantName(run,id,registry))}</strong>${run.bracket.teamSize>1?`<small>${esc(T.teamText(run,id,registry))}</small>`:''}</span>${winner?'<span class="winner-mark" aria-label="胜者">✓</span>':''}</span>`;
}
function updateHome(){
 $('home-continue-tournament').hidden=!run;$('home-continue-tournament').textContent=run&&T.isTournamentComplete(run.bracket)?'查看锦标赛结果':'继续锦标赛';
 $('home-tournament').innerHTML=(run?'新锦标赛':'锦标赛')+' <span>♜</span>';
}
function render(){
 updateHome();$('tournament-setup').hidden=!!run;$('tournament-bracket').hidden=!run;$('tournament-reset').hidden=!run;$('tournament-settings').disabled=!!run;
 if(!run){
  const definitions=T.pool(registry,prefs.filterElite),capacity=T.capacity(registry,prefs.teamSize,prefs.filterElite),unit=prefs.teamSize===1?'球':'队';if(prefs.size>capacity)prefs.size=null;
  $('tournament-status').textContent='开赛前设置';$('tournament-filter-elite').checked=prefs.filterElite;
  for(const button of $('tournament-teams').children){const selected=Number(button.dataset.teamSize)===prefs.teamSize;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));}
  $('tournament-capacity').textContent=`${definitions.filter(d=>d.rosterType==='normal').length} 个普通球 · ${definitions.filter(d=>d.rosterType==='elite').length} 个精英球 · 可组 ${capacity} ${unit}`;
  $('tournament-sizes').innerHTML=T.SIZES.map(size=>`<button data-tournament-size="${size}" ${size>capacity?'disabled':''} class="${prefs.size===size?'active':''}" aria-pressed="${prefs.size===size}"><strong>${size} ${unit}</strong><small>${size>capacity?'数量不足 · 可组 '+capacity+' '+unit:'共 '+(size-1)+' 场 · '+Math.log2(size)+' 轮'}</small></button>`).join('');
  $('tournament-next-title').textContent=prefs.size?`${prefs.teamSize}V${prefs.teamSize} · ${prefs.size} ${unit}`:'请选择比赛规模';$('tournament-next-summary').textContent='抽签后锁定参赛阵容，角色不重复。';$('tournament-play').textContent='确认并抽签 ↗';$('tournament-play').disabled=!prefs.size;return;
 }
 const bracket=run.bracket,progress=T.tournamentProgress(bracket),next=T.nextPendingMatch(bracket),complete=T.isTournamentComplete(bracket),champion=T.tournamentChampionId(bracket);
 selectedRound=Math.min(selectedRound,bracket.rounds.length-1);
 $('tournament-status').textContent=`${bracket.teamSize}V${bracket.teamSize} · ${bracket.size} ${bracket.teamSize===1?'球':'队'} · 已完成 ${progress.playedCount} / ${progress.totalMatches} 场`;
 $('tournament-champion').hidden=!complete;
 $('tournament-champion').innerHTML=complete?`<span aria-hidden="true">★</span><div><small>冠军</small><strong>${esc(T.entrantName(run,champion,registry))}</strong>${bracket.teamSize>1?`<p>${esc(T.teamText(run,champion,registry))}</p>`:''}</div>`:'';
 $('tournament-rounds').innerHTML=bracket.rounds.map((matches,r)=>`<button data-tournament-round="${r}" aria-pressed="${r===selectedRound}" class="${r===selectedRound?'active':''}">${T.roundNameForRoundIndex(bracket,r)} <small>${matches.filter(m=>m.winnerId).length}/${matches.length}</small></button>`).join('');
 $('tournament-matches').innerHTML=bracket.rounds[selectedRound].map(match=>`<button class="tournament-match ${next?.id===match.id?'next-match':''}" data-tournament-match="${match.id}" ${!match.leftId||!match.rightId?'disabled':''}><span class="tournament-match-heading">第 ${match.index+1} 场 <small>${match.winnerId?'已结束':next?.id===match.id?(live()?'比赛中':'下一场'):match.leftId&&match.rightId?'待开始':'等待晋级'}</small></span>${entrant(match.leftId,match)}${entrant(match.rightId,match)}</button>`).join('');
 $('tournament-next-title').textContent=complete?'本届锦标赛已结束':`${T.roundNameForRoundIndex(bracket,next.round)} · 第 ${next.index+1} 场`;
 $('tournament-next-summary').textContent=complete?'冠军已保存，可以查看各轮比赛或再办一届。':T.teamText(run,next.leftId,registry)+' VS '+T.teamText(run,next.rightId,registry);
 $('tournament-play').textContent=live()?'继续当前比赛 ↗':complete?'再办一届 ↗':'开始下一场 ↗';$('tournament-play').disabled=false;
}
function enter(){A.showScreen('tournament');render();}
function startMatch(match,options={}){
 if(!run||!match?.leftId||!match?.rightId)return;
 const activeId=A.context?.tournamentRun===run?A.context.matchId:null;
 if(live()&&activeId!==match.id){A.toast('请先结束当前比赛，再观看其他场次。');return;}
 if(live()&&activeId===match.id&&!options.replay){A.resumeExternalMatch();return;}
 const seed=options.seed??T.seedFor(run,match),replay=options.replay===true||!!match.winnerId;
 save();detailMatch=null;
 A.startExternalMatch({tournamentRun:run,matchId:match.id,state:T.battleState(run,match),seed,replay,title:'锦标赛 · '+T.roundNameForRoundIndex(run.bracket,match.round)+' · 第 '+(match.index+1)+' 场',
  onBack:enter,
  onNext(){if(T.isTournamentComplete(run.bracket)){enter();return;}startMatch(T.nextPendingMatch(run.bracket));},
  onFinish({winner,seed,replay}){
   if(!replay)T.settle(run,match.id,winner,seed);
   save();const progress=T.tournamentProgress(run.bracket),complete=T.isTournamentComplete(run.bracket);selectedRound=progress.roundIndex;updateHome();
   const winningId=winner===0?match.leftId:winner===1?match.rightId:null,finalWin=complete&&match.round===run.bracket.rounds.length-1&&!replay;
   return {title:winningId?T.entrantName(run,winningId,registry)+(finalWin?'夺冠':'获胜'):'本场平局',subtitle:replay?'原种子重放，不改变赛程。':winner===null?'未决出胜者，换种子重赛；双方重新满血。':`已完成 ${progress.playedCount} / ${progress.totalMatches} 场${finalWin?' · 冠军已保存':' · 胜者晋级'}`,nextLabel:complete?'查看冠军':winner===null?'平局重赛':'下一场'};
  }
 });
}
function showMatch(id){
 if(!run)return;const match=T.findTournamentMatch(run.bracket,id);if(!match)return;detailMatch=match;
 $('tournament-detail-title').textContent=T.roundNameForRoundIndex(run.bracket,match.round)+' · 第 '+(match.index+1)+' 场';
 $('tournament-detail-body').innerHTML=`<div class="tournament-detail-teams">${entrant(match.leftId,match)}${entrant(match.rightId,match)}</div><p class="tournament-detail-status">${match.winnerId?'胜者：'+esc(T.entrantName(run,match.winnerId,registry)):run.records[id]?.draws?'已有 '+run.records[id].draws+' 次平局，等待重赛。':'每场重新满血，胜者晋级。'}</p>`;
 const otherActive=live()&&A.context.matchId!==id;
 $('tournament-detail-watch').disabled=otherActive||!match.leftId||!match.rightId;$('tournament-detail-watch').textContent=otherActive?'请先结束当前比赛':match.winnerId?'重放此场':live()?'继续当前比赛':'观看此场';A.openDialog('tournament-match-detail');
}
$('home-tournament').onclick=()=>{enter();if(run)A.openDialog('tournament-reset-dialog');};$('home-continue-tournament').onclick=enter;
$('tournament-teams').onclick=e=>{const button=e.target.closest('[data-team-size]');if(!button||run)return;prefs.teamSize=Number(button.dataset.teamSize);render();save();};
$('tournament-filter-elite').onchange=()=>{if(run)return;prefs.filterElite=$('tournament-filter-elite').checked;render();save();};
$('tournament-sizes').onclick=e=>{const button=e.target.closest('[data-tournament-size]');if(!button||button.disabled||run)return;prefs.size=Number(button.dataset.tournamentSize);render();save();};
$('tournament-settings').onclick=A.openSettings;
$('tournament-rounds').onclick=e=>{const button=e.target.closest('[data-tournament-round]');if(!button)return;selectedRound=Number(button.dataset.tournamentRound);render();$('tournament-matches').scrollTop=0;};
$('tournament-matches').onclick=e=>{const button=e.target.closest('[data-tournament-match]');if(button&&!button.disabled)showMatch(button.dataset.tournamentMatch);};
$('tournament-detail-watch').onclick=()=>{if(detailMatch)startMatch(detailMatch);};
$('tournament-reset').onclick=()=>A.openDialog('tournament-reset-dialog');
$('tournament-reset-confirm').onclick=()=>{A.discardExternalMatch();run=null;selectedRound=0;save();A.showScreen('tournament');render();};
$('tournament-play').onclick=()=>{
 if(!run){try{run=T.draw(registry,{...prefs,physics:A.state.physics,hazards:A.state.hazards},A.state.seedText===''?randomSeed():Number(A.state.seedText));selectedRound=0;save();render();}catch(error){A.toast(error.message);}return;}
 if(live()){A.resumeExternalMatch();return;}if(T.isTournamentComplete(run.bracket)){A.openDialog('tournament-reset-dialog');return;}startMatch(T.nextPendingMatch(run.bracket));
};
window.addEventListener('arena:navigate',e=>{updateHome();if(e.detail.screen==='tournament')render();});
updateHome();render();
globalThis.ArenaTournamentUI={get run(){return run;},get preferences(){return prefs;},enter,render,startMatch};
})();
