(function(){
'use strict';
const B=globalThis.BallBattle,M=globalThis.ArenaModel,$=id=>document.getElementById(id);
const registry=B.ballRegistry,roles=registry.list(),storageKey='ball-arena-settings-v1',reduced=matchMedia('(prefers-reduced-motion: reduce)');
const clarified=globalThis.ArenaDescriptions||{};
let saved;try{saved=JSON.parse(localStorage.getItem(storageKey));}catch{}
let state=M.sanitize(saved,registry),editing={side:state.mode==='brawl'?'brawl':'left',index:0},session=null,engine=null,renderer=null,mechanisms=null,series=null,matchState=null,paused=false,speed=state.speed,replaying=false,settled=false,roundSeed=0,rosterScroll=0,detailId=null,accumulator=0,lastFrame=0,lastHud=0;
let skillsAutoResume=false,lineupAutoResume=false,matchTimeLimit=M.timeLimit(state),roundTimedOut=false;
let soundOn=state.soundOn,toastTimer,previewObserver,battleContext=null,homeDemo=null,previousDemoIds=[];
try{const ids=JSON.parse(sessionStorage.getItem('ball-arena-home-demo-v1'));if(Array.isArray(ids)&&ids.length===2&&ids.every(id=>typeof id==='string'))previousDemoIds=ids;}catch{}
const audio=new B.BattleAudio({voiceLimit:24}),previewCache=new Map();let previewEngine,previewRenderer;
const filters=[['all','全部'],['normal','普通'],['zako','杂鱼'],['elite','精英'],['outOfSpec','规格外'],['boss','Boss'],['original','原创'],['favorites','收藏']];
function save(){try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}}
function summaryOf(d){return clarified[d.id]?.summary||d.description;}
function detailOf(d){return clarified[d.id]?.detail||d.description;}
function activeWheelBall(index){const team=engine.game.teams[index];return engine.game.competitiveMode?.activeFor(team.id)||null;}
function visibleTeam(balls,index){return matchState.mode==='wheel'?[activeWheelBall(index)].filter(b=>b&&b.hp>0):balls;}
function statusOf(ball){return ball.hp<=0?'已退场':matchState?.mode==='wheel'?(engine.game.teams.some((t,i)=>activeWheelBall(i)===ball)?'当前上场':'候场'):ball.isModeBench?'候场':'场上';}
function clockText(totalSeconds){const seconds=Math.max(0,Math.floor(totalSeconds));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3000);}
function openDialog(id){if(session&&!settled)pause(true);if(!$(id).open)$(id).showModal();}
function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
function showScreen(name){
 if(name==='home'&&$('home').hidden)disposeHomeDemo();
 closeDialogs();
 if(name!=='battle')dropReplaySession();
 if(name!=='battle'&&session&&!settled)pause(true);
 for(const id of ['home','selection','battle','tournament'])$(id).hidden=id!==name;
 $('app').classList.toggle('on-home',name==='home');$('home-back').hidden=name==='home';
 $('home-continue-free').hidden=!session||!!battleContext||settled;
 window.dispatchEvent(new CustomEvent('arena:navigate',{detail:{screen:name}}));
 if(name==='selection')renderSettings();
 if(name==='battle')resizeArena();
}
function goHome(){showScreen('home');$('home-free').focus({preventScroll:true});}
function enterFree(){if(battleContext){teardown();battleContext=null;}showScreen('selection');renderSelection();$('roster').scrollTop=rosterScroll;}
function startExternalMatch(options){
 options.replay=options.replay===true;battleContext=options;matchState=M.clone(options.state);series=new M.Series(1);return startRound(options.seed,options.replay);
}
function resumeExternalMatch(){if(!battleContext||battleContext.replay===true||replaying||!session||settled)return false;showScreen('battle');pause(false);return true;}
function discardExternalMatch(){if(battleContext){teardown();battleContext=null;}}
function disposeHomeDemo(){
 if(!homeDemo)return;
 const e=homeDemo.session.engine;for(const ball of e.game.balls)e.invokeHook(ball,'onBattleDispose');e.entitySystem.reset();e.visualEffectSystem.reset();homeDemo.session.dispose();homeDemo=null;
}
function drawHomeDemo(dt){
 if(!homeDemo||!reduced.matches&&((homeDemo.session.engine.game.state==='ended'&&homeDemo.visibleSeconds>=6)||homeDemo.session.steps>=1200)){
  disposeHomeDemo();
  const seed=newSeed(),random=B.createSeededRandom(seed),pool=roles.filter(d=>d.rosterType==='normal'&&!['daYun','daYunV2'].includes(d.id));
  const left=pool[Math.floor(random()*pool.length)],opponents=pool.filter(d=>d.id!==left.id&&!(previousDemoIds.includes(left.id)&&previousDemoIds.includes(d.id))),right=opponents[Math.floor(random()*opponents.length)];
  previousDemoIds=[left.id,right.id];try{sessionStorage.setItem('ball-arena-home-demo-v1',JSON.stringify(previousDemoIds));}catch{}
  $('home-demo-label').innerHTML=esc(left.name)+' <span>VS</span> '+esc(right.name)+' · 演示';
  $('home-arena').setAttribute('aria-label',left.name+'与'+right.name+'对战演示');$('home-arena').dataset.leftId=left.id;$('home-arena').dataset.rightId=right.id;
  const demo=B.createDeterministicSession({registry,seed,setup:e=>{e.createGame(left.id,right.id);e.beginFight();}});
  homeDemo={session:demo,visibleSeconds:0,renderer:new B.CanvasRenderer($('home-arena'),demo.engine,{enableGpu:false,targetPixelSize:640,teamColors:{left:'#ed796b',right:'#78b5e7'}})};
  homeDemo.renderer.readArenaShakeOffset=()=>({x:0,y:0});for(let i=0;i<180&&demo.engine.game.state==='running';i++)demo.advance(1/60);
 }
 homeDemo.visibleSeconds+=Math.min(.1,dt);
 if(!reduced.matches&&homeDemo.session.engine.game.state==='running')homeDemo.session.advance(Math.min(.1,dt)*.6);
 homeDemo.renderer.draw();
}
function isOriginal(id){return M.ORIGINAL_IDS.includes(id);}
function listFor(side){return state[side];}
function normalizeForMode(){
 if(state.mode==='duel'){state.left=state.left.slice(0,1);state.right=state.right.slice(0,1);}
 if(state.mode==='boss'){
  const boss=roles.find(d=>d.rosterType==='boss');state.left=[state.left.find(id=>id&&registry.get(id).rosterType==='boss')||boss.id];
 }else state.left=state.left.map(id=>id&&registry.get(id).rosterType==='boss'?'oldWoodMaster':id);
 editing={side:state.mode==='brawl'?'brawl':'left',index:0};
}
function modeChanged(){state.mode=$('mode').value;normalizeForMode();save();renderSelection();renderRoster();}
function sideName(side){return side==='brawl'?'混战名单':side==='left'?'红方':'蓝方';}
function renderSelection(){
 $('mode').value=state.mode;$('series').value=String(state.series);$('series-label').hidden=state.mode==='brawl';
 const group=(side,blue=false)=>{const arr=listFor(side),multi=arr.length>1,min=side==='brawl'?2:1,max=side==='brawl'?12:state.mode==='duel'||state.mode==='boss'&&side==='left'?1:6;
  return `<section class="team-panel ${blue?'blue':''}"><div class="team-head"><span>${sideName(side)}${state.mode==='boss'?(side==='left'?' · BOSS':' · 挑战者'):''}</span><div class="team-ops">${max>1?`<button data-count="${side}" data-delta="-1" aria-label="减少${sideName(side)}人数" ${arr.length<=min?'disabled':''}>−</button><span>${arr.length}</span><button data-count="${side}" data-delta="1" aria-label="增加${sideName(side)}人数" ${arr.length>=max?'disabled':''}>＋</button>`:''}<button data-random="${side}" aria-label="随机${sideName(side)}">随机</button><button data-clear="${side}" aria-label="清空${sideName(side)}">清空</button></div></div><div class="team-slots" style="--slots:${arr.length}">${arr.map((id,index)=>{const d=id?registry.get(id):null;return `<button class="slot ${multi?'multi':''} ${editing.side===side&&editing.index===index?'selected':''}" data-side="${side}" data-slot="${index}" aria-pressed="${editing.side===side&&editing.index===index}" aria-label="${sideName(side)}第${index+1}位：${esc(d?.name||'空位')}" title="${esc(d?.name||'空位')}"><span class="slot-dot" style="background:${d?.color||'#666'}"></span><span class="slot-label">${esc(d?.name||'选择角色')}<small>${d?esc(M.TYPE_NAMES[d.rosterType]):'空位'}${isOriginal(id)?' · 原创':''}</small></span></button>`;}).join('')}</div></section>`;
 };
 $('lineup').classList.toggle('brawl-lineup',state.mode==='brawl');
 $('lineup').innerHTML=state.mode==='brawl'?group('brawl'):group('left')+'<div class="versus"><strong>VS</strong><button id="swap" aria-label="交换双方" title="交换双方" '+(state.mode==='boss'?'disabled':'')+'>⇄</button></div>'+group('right',true);
 renderEditing();const error=M.validate(state,registry);$('start').disabled=!!error;$('selection-note').textContent=error||'选好双方，交给它们自己打。';
 if(!$('selection').hidden)renderSettings();
}
function renderEditing(){const arr=listFor(editing.side);if(editing.index>=arr.length)editing.index=arr.length-1;const d=arr[editing.index]?registry.get(arr[editing.index]):null;$('editing').textContent=`正在选择 ${sideName(editing.side)} · 第 ${editing.index+1} 位${d?' / '+d.name:''}`;}
function filteredRoles(){const needle=state.search.trim().toLowerCase();return roles.filter(d=>{
 if(state.filter==='original'&&!isOriginal(d.id)||state.filter==='favorites'&&!state.favorites.includes(d.id))return false;
 if(!['all','original','favorites'].includes(state.filter)&&d.rosterType!==state.filter)return false;
 if(state.tag!=='all'&&!(ArenaTags[d.id]||[]).includes(state.tag))return false;
 return !needle||(d.name+' '+summaryOf(d)+' '+detailOf(d)+' '+d.description+' '+d.englishName).toLowerCase().includes(needle);
 });}
function markCards(){document.querySelectorAll('.role-card').forEach(el=>{const id=el.dataset.id,left=state.mode==='brawl'?state.brawl.includes(id):state.left.includes(id),right=state.mode!=='brawl'&&state.right.includes(id);el.classList.toggle('in-left',left);el.classList.toggle('in-right',right);el.classList.toggle('in-both',left&&right);el.classList.toggle('unavailable',!M.eligible(registry.get(id),state,editing.side));});}
function renderRoster(reset=true){
 if(previewObserver)previewObserver.disconnect();
 $('filters').innerHTML=filters.map(([id,label])=>`<button data-filter="${id}" aria-pressed="${state.filter===id}" class="${state.filter===id?'active':''}">${label}</button>`).join('');
 const items=filteredRoles();$('roster-count').textContent=`${items.length} / ${roles.length} 位角色`;
 $('roster').innerHTML=items.length?items.map(d=>`<article class="role-card" data-id="${d.id}"><button class="pick-role" data-pick="${d.id}" aria-label="选择${esc(d.name)}" title="${esc(summaryOf(d))}"><canvas width="192" height="130" data-preview="${d.id}" aria-hidden="true"></canvas><span class="role-name">${esc(d.name)}</span><span class="role-desc">${esc(summaryOf(d))}</span></button><span class="role-badge">${isOriginal(d.id)?'原创':d.rosterType==='normal'?'':M.TYPE_NAMES[d.rosterType]}</span><button class="role-favorite ${state.favorites.includes(d.id)?'saved':''}" data-favorite="${d.id}" aria-label="${state.favorites.includes(d.id)?'取消收藏':'收藏'}${esc(d.name)}" aria-pressed="${state.favorites.includes(d.id)}">${state.favorites.includes(d.id)?'★':'☆'}</button><button class="role-info" data-info="${d.id}" aria-label="${esc(d.name)}技能详情">技能 ↗</button></article>`).join(''):'<p class="empty-results">没有符合条件的角色，试试其他关键词或分类。</p>';
 if(reset)$('roster').scrollTop=0;markCards();
 previewObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){drawPreview(e.target,e.target.dataset.preview);previewObserver.unobserve(e.target);}},{root:$('roster'),rootMargin:'100px'});
 $('roster').querySelectorAll('[data-preview]').forEach(c=>previewObserver.observe(c));
}
function drawPreview(canvas,id){
 const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);
 if(previewCache.has(id)){c.drawImage(previewCache.get(id),0,0,canvas.width,canvas.height);return;}
 try{
  if(!previewEngine){previewEngine=new B.BattleEngine();const scratch=document.createElement('canvas');scratch.getContext('2d',{alpha:true});previewRenderer=new B.CanvasRenderer(scratch,previewEngine,{enableGpu:false,targetPixelSize:192});previewRenderer.drawHpText=()=>{};previewRenderer.drawShieldHpText=()=>{};}
  const d=registry.get(id);
  if(d.rosterType==='boss')previewEngine.createBattle(B.createModeBattleConfig('totalwar',[id],['steelCoil']));else previewEngine.createGame(id,'steelCoil');
  const ball=previewEngine.game.balls[0];ball.x=ball.prevX=32;ball.y=ball.prevY=22;ball.fade=1;
  const scratch=previewRenderer.canvas;scratch.width=192;scratch.height=130;previewRenderer.sourceScale=3;previewRenderer.renderScale=3;previewRenderer.context.setTransform(3,0,0,3,0,0);previewRenderer.drawBall(ball);
  const cached=document.createElement('canvas');cached.width=192;cached.height=130;cached.getContext('2d').drawImage(scratch,0,0);previewCache.set(id,cached);c.drawImage(cached,0,0,canvas.width,canvas.height);
 }catch(error){console.warn('角色预览失败',id,error);const d=registry.get(id);c.fillStyle=d.color;c.beginPath();c.arc(canvas.width/2,canvas.height/2,canvas.height*.28,0,Math.PI*2);c.fill();}
}
function pick(id){const d=registry.get(id);if(!M.eligible(d,state,editing.side)){toast(d.rosterType==='boss'?'请切换到 Boss 挑战，选择红方 Boss 位置。':'这个位置需要一位 Boss。');return;}listFor(editing.side)[editing.index]=id;save();renderSelection();markCards();}
function favorite(id){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];save();const top=$('roster').scrollTop;renderRoster(false);$('roster').scrollTop=top;if(detailId===id&&$('detail').open)$('detail-favorite').textContent=state.favorites.includes(id)?'★ 已收藏':'☆ 收藏';}
function randomTeam(side){const pool=roles.filter(d=>M.eligible(d,state,side)&&(state.mode==='boss'&&side==='left'||state.expanded||d.rosterType==='normal'));if(!pool.length)return;state[side]=state[side].map(()=>pool[Math.floor(Math.random()*pool.length)].id);}
function showDetail(id){detailId=id;const d=registry.get(id);$('detail-title').textContent=d.name;$('detail-content').innerHTML=`<div class="detail-hero"><canvas id="detail-preview" width="288" height="200" aria-hidden="true"></canvas><div><p>${M.TYPE_NAMES[d.rosterType]}${isOriginal(id)?' · 原创角色':''}</p><p class="detail-tags">${esc((ArenaTags[id]||[]).join(' · '))}</p></div></div><p class="detail-desc">${esc(detailOf(d))}</p><div class="detail-stats"><div><small>基础生命</small><strong>${d.stats.maxHp}</strong></div><div><small>速度</small><strong>${d.stats.speed}</strong></div><div><small>半径</small><strong>${d.stats.radius}</strong></div></div>`;drawPreview($('detail-preview'),id);$('detail-favorite').textContent=state.favorites.includes(id)?'★ 已收藏':'☆ 收藏';$('detail-pick').disabled=!M.eligible(d,state,editing.side);$('detail-pick').textContent=$('detail-pick').disabled?'不适用于当前位置':'选入'+sideName(editing.side)+'第'+(editing.index+1)+'位';openDialog('detail');}
function renderSettings(tournament=false,run=null,battleMode=null){
 const slot=$(tournament?'tournament-settings-slot':'free-settings-slot');slot.appendChild($('match-settings'));
 const locked=!!run,settings=run?run.settings:state,boss=!tournament&&state.mode==='boss';
 $('wheel-setting').hidden=(run?run.settings.battleMode:battleMode||state.mode)!=='wheel';$('retain-dead-skills').checked=settings.retainDeadSkills!==false;$('retain-dead-skills').disabled=locked;
 $('physics').value=boss?'none':settings.physics;$('physics').disabled=locked||boss;
 $('physics-hint').textContent=boss?'Boss 挑战固定直线运动。':'';
 for(const k of ['pads','supplies','laser']){$('hazard-'+k).checked=settings.hazards[k];$('hazard-'+k).disabled=locked;}
 $('seed-label').textContent=tournament?'抽签种子':'对局种子';$('seed').value=run?String(run.drawSeed):state.seedText;$('seed').disabled=locked;
 $('random-setting').hidden=tournament;$('random-expanded').checked=state.expanded;$('settings-lock').hidden=!locked;
}
function commitSettings(){
 if(!$('retain-dead-skills').disabled)state.retainDeadSkills=$('retain-dead-skills').checked;
 if(!$('physics').disabled)state.physics=$('physics').value;for(const k of ['pads','supplies','laser'])state.hazards[k]=$('hazard-'+k).checked;state.expanded=$('random-expanded').checked;
 const value=$('seed').value.trim();if(value!==''&&(!/^\d{1,10}$/.test(value)||Number(value)>4294967295)){toast('种子须为 0–4294967295 的整数，已改为随机。');state.seedText='';$('seed').value='';}else state.seedText=value;
 save();
}
function seedValue(){return state.seedText===''?newSeed():Number(state.seedText)>>>0;}
function newSeed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
function teardown(){
 session?.dispose();mechanisms?.dispose();
 if(engine?.game){for(const ball of engine.game.balls)engine.invokeHook(ball,'onBattleDispose');engine.entitySystem.reset();engine.visualEffectSystem.reset();engine.activeModeController()?.dispose();}
 session=null;mechanisms=null;engine=null;renderer=null;accumulator=0;replaying=false;
}
function dropReplaySession(){if(!session||!replaying)return false;teardown();battleContext=null;settled=false;paused=false;lastFrame=0;return true;}
function unlockAudio(){try{const ctx=audio.ensureContext();ctx?.resume().catch(()=>{});if(audio.master)audio.master.gain.value=.8;return true;}catch{return false;}}
function startMatch(){
 if(soundOn)unlockAudio();
 const error=M.validate(state,registry);if(error){toast(error);return;}
 battleContext=null;rosterScroll=$('roster').scrollTop;matchState=M.clone(state);series=new M.Series(state.mode==='brawl'?1:state.series);startRound(seedValue(),false);
}
function startRound(seed,replay=false){
 if(soundOn)unlockAudio();
 closeDialogs();teardown();matchTimeLimit=M.timeLimit(matchState);roundTimedOut=false;roundSeed=seed>>>0;replaying=battleContext?Boolean(replay||battleContext.replay===true):Boolean(replay&&series.history.some(r=>r.round===series.round));if(battleContext)battleContext.replay=replaying;settled=false;paused=false;lastFrame=0;accumulator=0;
 const settings=matchState;
 try{
  engine=new B.BattleEngine({onBounce:(ball,intensity)=>{if(soundOn&&!paused)audio.impact(ball,intensity);},onSound:event=>{if(soundOn&&!paused)audio.playEvent(event);}});
  session=B.createDeterministicSession({engine,seed:roundSeed,setup:e=>{e.createBattle(M.configFor(settings,B));M.installWheelSkillCleanup(e,settings);mechanisms=new ArenaMechanisms(e,settings.hazards);e.beginFight();}});
  const update=engine.update.bind(engine);
  engine.update=dt=>{if(engine.game.state!=='running')return;const t=engine.game.time;update(dt);if(engine.game.state==='running')mechanisms.update(Math.max(0,engine.game.time-t));};
  renderer=new B.CanvasRenderer($('arena'),engine,{enableGpu:false,targetPixelSize:800,teamColors:{left:'#ed796b',right:'#78b5e7'}});
  if(reduced.matches)renderer.readArenaShakeOffset=()=>({x:0,y:0});
  showScreen('battle');$('pause-indicator').hidden=true;$('pause').textContent='暂停';$('pause').disabled=false;$('step').disabled=true;
  resizeArena();renderHud();drawBattle();
  $('back').textContent=battleContext?'‹ 返回赛程':'‹ 调整阵容';$('back').focus({preventScroll:true});return true;
 }catch(error){console.error(error);const replayContext=battleContext?.replay===true,tournamentContext=!!battleContext;teardown();if(replayContext)battleContext=null;showScreen(tournamentContext?'tournament':'selection');toast('对局未能建立：'+error.message);return false;}
}
function resizeArena(){
 if($('battle').hidden)return;const stage=$('stage'),size=Math.max(40,Math.min(stage.clientHeight,stage.clientWidth,700));$('arena-wrap').style.width=size+'px';$('arena-wrap').style.height=size+'px';
 if(renderer){const target=Math.min(1600,Math.round(size*Math.min(devicePixelRatio||1,2)));if(Math.abs(renderer.targetPixelSize-target)>8){renderer.targetPixelSize=target;renderer.configureCanvas();}}
 const overlay=$('hazards');overlay.width=Math.round(size*Math.min(devicePixelRatio||1,2));overlay.height=overlay.width;
}
function drawBattle(){if(!renderer||!engine?.game)return;renderer.draw();const c=$('hazards').getContext('2d'),scale=$('hazards').width/engine.arenaSize;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,c.canvas.width,c.canvas.height);c.setTransform(scale,0,0,scale,0,0);mechanisms.draw(c);}
function renderHud(){
 if(!engine)return;
 const g=engine.game,s=matchState;
 $('scoreboard').classList.toggle('is-brawl',s.mode==='brawl');
 $('timer').textContent=`${clockText((session?.steps||0)/60)} / ${clockText(matchTimeLimit)}`;
 $('match-label').textContent=battleContext?(battleContext.title+(replaying?' · 重放':'')):M.MODES[s.mode]+(s.mode!=='brawl'&&series.length>1?` · 第 ${series.round} 局${replaying?' · 重放':''}`:replaying?' · 重放':'');
 $('match-label').title=$('match-label').textContent;
 const teamHtml=(balls,right=false)=>{balls=visibleTeam(balls,right?1:0);const hp=balls.reduce((n,b)=>n+Math.max(0,b.hp),0),max=balls.reduce((n,b)=>n+b.maxHp,0),names=balls.map(b=>b.name+(b.hp<=0?' ×':b.isModeBench?' ·候场':'')).join(' / ')||'无上场角色';return `<div class="team-score ${right?'right':''}"><button class="names" data-team-roster="${right?1:0}" aria-label="查看${right?'蓝方':'红方'}阵容" title="${esc(names)}">${esc(names)} <small aria-hidden="true">⌄</small></button><span class="hp-data">${Math.ceil(hp)} / ${Math.ceil(max)} HP${balls.length>1?' · '+balls.filter(b=>b.hp>0).length+' 人存活':''}</span><div class="hp-track"><div class="hp-fill" style="width:${max?Math.min(100,hp/max*100):0}%"></div></div></div>`;};
 const originals=g.teams.map(t=>t.balls),sides=s.mode==='brawl'?[originals[0].slice(0,Math.ceil(originals[0].length/2)),originals[0].slice(Math.ceil(originals[0].length/2))]:originals;
 $('score-left').innerHTML=teamHtml(sides[0]);$('score-right').innerHTML=teamHtml(sides[1],true);
 $('series-score').innerHTML=battleContext?'VS':`<span>${series.scores[0]}</span><small>:</small><span>${series.scores[1]}</span>`;
 const enabled=[s.hazards.pads?'弹射垫':'',s.hazards.supplies?'急救补给':'',s.hazards.laser?'横扫激光':''].filter(Boolean);
 $('battle-note').textContent=`种子 ${roundSeed} · ${enabled.length?enabled.join(' / '):'无场地机关'}${settled?' · 查看结果':paused?' · 已暂停':''}`;
 $('battle-note').disabled=!settled;$('pause').disabled=settled;$('step').disabled=settled||!paused;$('skills').disabled=settled;
}
function skillGroups(){
 if(matchState.mode==='brawl')return [{label:'混战选手',balls:engine.game.balls,blue:false,brawl:true}];
 return engine.game.teams.map((team,index)=>({label:matchState.mode==='boss'&&index===0?'红方 · BOSS':index===0?'红方':'蓝方',balls:team.balls,blue:index===1}));
}
function skillRow(ball,index=0){
 let d;try{d=registry.get(ball.id);}catch{}
 const current=statusOf(ball)==='当前上场',tags=ArenaTags[ball.id]||[];
 const meta=[d?M.TYPE_NAMES[d.rosterType]:'角色',...tags,statusOf(ball),`${Math.ceil(Math.max(0,ball.hp))} / ${Math.ceil(ball.maxHp)} HP`].join(' · ');
 return `<article class="skills-row ${current?'current-active':''}"><span class="mini-dot" style="background:${ball.color}"></span><div class="skills-main"><div class="skills-name">${matchState.mode==='wheel'?index+1+'. ':''}${esc(ball.name)}<small>${esc(meta)}</small></div><p class="skills-desc">${esc(d?detailOf(d):'暂无技能说明')}</p></div></article>`;
}
function renderSkills(){
 $('skills-body').innerHTML=skillGroups().map(group=>{
  const rows=group.balls.map(skillRow).join('');
  return `<section class="skills-team ${group.blue?'blue':''} ${group.brawl?'brawl':''}"><h3>${esc(group.label)}<small>${group.balls.filter(b=>b.hp>0).length} 人存活</small></h3><div class="skills-list">${rows}</div></section>`;
 }).join('');
}
function openSkills(){
 if(!session||!engine||settled)return;
 skillsAutoResume=!paused;
 if(skillsAutoResume)pause(true);
 renderSkills();
 if(!$('skills-dialog').open)$('skills-dialog').showModal();
}
function timeoutTeams(){
 const teams=engine.game.teams;
 if(!Array.isArray(teams)||teams.length<2)return null;
 const scores=teams.map(team=>engine.teamHpScore(team));
 if(scores[0].hp===scores[1].hp)return null;
 return scores[0].hp>scores[1].hp?{winner:teams[0],loser:teams[1]}:{winner:teams[1],loser:teams[0]};
}
function timeoutBrawlBall(){
 const controller=engine.activeModeController();
 const entrants=controller&&typeof controller.brawlEntrants==='function'?[...controller.brawlEntrants().values()]:[];
 let winner=null,tied=false;
 for(const ball of entrants){
  if(!winner||ball.hp>winner.hp){winner=ball;tied=false;}
  else if(ball.hp===winner.hp)tied=true;
 }
 return tied?null:winner;
}
function endByTimeout(){
 if(!engine||engine.game.state!=='running')return;
 roundTimedOut=true;
 if(matchState.mode==='brawl'){
  const winner=timeoutBrawlBall();
  engine.endBattle(null,null,winner);
  return;
 }
 const result=timeoutTeams();
 if(!result){engine.endBattle(null,null);return;}
 engine.endBattle(result.winner,result.loser);
 for(const ball of engine.runtimeBallsOfTeam(result.loser)){
  if(ball.hp<=0||ball.deathNotified)continue;
  ball.deathNotified=true;ball.diedAt=engine.game.time;
 }
}
function advanceSteps(count){
 const limitSteps=matchTimeLimit*60;
 for(let i=0;i<count&&session&&engine.game.state==='running'&&!settled;i++){
  session.advance(1/60);
  if(session.steps>=limitSteps&&engine.game.state==='running'){endByTimeout();break;}
 }
 if(engine?.game.state==='ended'&&!settled)finishRound();
}
function finishRound(){
 settled=true;paused=true;accumulator=0;
 const g=engine.game,winner=matchState.mode==='brawl'?null:g.winnerTeam?.id==='left'?0:g.winnerTeam?.id==='right'?1:null;
 if(!replaying&&!battleContext)series.record(winner);
 const winName=matchState.mode==='brawl'?(g.winner?.name||null):winner===0?'红方':winner===1?'蓝方':null;
 $('result-title').textContent=winName?winName+'获胜':'本局平局';
 const baseSubtitle=replaying?'原种子重放 · 不重复计入比分':series.complete&&series.length>1?(series.draws>=3?'连续三局平局，系列赛并列结束。':(series.scores[0]>series.scores[1]?'红方':'蓝方')+'赢得系列赛。'):'本局已结束，可重放或调整阵容。';
 $('result-subtitle').textContent=(roundTimedOut?'限时结束，按剩余总生命判定。':'')+baseSubtitle;
 $('result-score').textContent=matchState.mode==='brawl'?'':series.scores.join(' : ');
 $('next-round').hidden=(!!battleContext&&replaying)||series.complete||matchState.mode==='brawl';
 $('rematch').hidden=!!battleContext;$('edit-result').textContent=battleContext?'返回赛程':'调整阵容';$('next-round').textContent='下一局';
 if(battleContext){const result=battleContext.onFinish({winner,seed:roundSeed,replay:replaying})||{};$('result-title').textContent=result.title||$('result-title').textContent;$('result-subtitle').textContent=(roundTimedOut?'限时结束，按剩余总生命判定。':'')+(result.subtitle||'');$('result-score').textContent=result.score||'';if(!replaying)$('next-round').hidden=false;$('next-round').textContent=result.nextLabel||'下一场';}
 $('pause-indicator').hidden=true;renderHud();openDialog('result');
}
function pause(value=!paused){if(!session||settled)return;paused=value;accumulator=0;$('pause').textContent=paused?'继续':'暂停';$('pause-indicator').hidden=!paused;renderHud();}
function returnToSelection(){if(battleContext){const context=battleContext;dropReplaySession();context.onBack();return;}closeDialogs();teardown();showScreen('selection');paused=false;renderSelection();$('roster').scrollTop=rosterScroll;$('start').focus({preventScroll:true});}
function frame(time){
 try{
  if(!$('home').hidden)drawHomeDemo(lastFrame?Math.min(.1,(time-lastFrame)/1000):0);
  if(session&&!$('battle').hidden){const dt=lastFrame?Math.min(.1,(time-lastFrame)/1000):0;if(!paused&&!settled){accumulator+=dt*speed;const steps=Math.floor((accumulator+1e-9)*60);accumulator-=steps/60;advanceSteps(steps);}
   drawBattle();if(time-lastHud>100){renderHud();lastHud=time;}
  }
 }catch(error){console.error(error);pause(true);toast('对战遇到问题，已暂停。可返回选人后重试。');}
 lastFrame=time;requestAnimationFrame(frame);
}
$('version').textContent='v'+GAME_VERSION;
$('tag').innerHTML='<option value="all">全部机制</option>'+[...new Set(Object.values(ArenaTags).flat())].map(t=>`<option>${t}</option>`).join('');
if(![...$('tag').options].some(o=>o.value===state.tag))state.tag='all';$('tag').value=state.tag;$('search').value=state.search;
$('mode').addEventListener('change',modeChanged);$('series').addEventListener('change',()=>{state.series=Number($('series').value);save();});
$('lineup').addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.side){editing={side:button.dataset.side,index:Number(button.dataset.slot)};renderSelection();markCards();$('lineup').querySelector(`[data-side="${editing.side}"][data-slot="${editing.index}"]`)?.focus({preventScroll:true});return;}
 if(button.id==='swap'){[state.left,state.right]=[state.right,state.left];}
 if(button.dataset.random)randomTeam(button.dataset.random);
 if(button.dataset.clear)state[button.dataset.clear]=state[button.dataset.clear].map(()=>null);
 if(button.dataset.count){const side=button.dataset.count,arr=listFor(side);if(button.dataset.delta==='1')arr.push(null);else arr.pop();if(editing.side===side&&editing.index>=arr.length)editing.index=arr.length-1;}
 save();renderSelection();markCards();
});
$('roster').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.pick)pick(b.dataset.pick);if(b.dataset.info)showDetail(b.dataset.info);if(b.dataset.favorite)favorite(b.dataset.favorite);});
$('filters').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(!b)return;state.filter=b.dataset.filter;save();renderRoster();});
$('search').addEventListener('input',()=>{state.search=$('search').value;save();renderRoster();});$('tag').addEventListener('change',()=>{state.tag=$('tag').value;save();renderRoster();});
$('random-all').onclick=()=>{for(const side of state.mode==='brawl'?['brawl']:['left','right'])randomTeam(side);save();renderSelection();markCards();};
$('detail-favorite').onclick=()=>favorite(detailId);$('detail-pick').onclick=()=>{pick(detailId);$('detail').close();};
$('help').onclick=()=>openDialog('help-dialog');
for(const d of document.querySelectorAll('dialog')){d.addEventListener('click',e=>{if(e.target.closest('[data-close]'))d.close();if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});}
$('match-settings').addEventListener('change',commitSettings);
$('start').onclick=startMatch;$('pause').onclick=()=>pause();$('skills').onclick=openSkills;$('step').onclick=()=>{if(paused&&!settled){advanceSteps(1);drawBattle();renderHud();}};
$('speeds').onclick=e=>{const b=e.target.closest('[data-speed]');if(!b)return;speed=Number(b.dataset.speed);state.speed=speed;save();for(const el of $('speeds').children){el.classList.toggle('active',el===b);el.setAttribute('aria-pressed',String(el===b));}};
$('scoreboard').onclick=event=>{const button=event.target.closest('[data-team-roster]');if(!button||!engine)return;lineupAutoResume=!paused&&!settled;const i=Number(button.dataset.teamRoster),all=engine.game.teams.map(t=>t.balls),balls=matchState.mode==='brawl'?(i===0?all[0].slice(0,Math.ceil(all[0].length/2)):all[0].slice(Math.ceil(all[0].length/2))):all[i];$('lineup-detail-title').textContent=matchState.mode==='brawl'?'混战选手':(i===0?'红方':'蓝方')+'阵容';$('lineup-detail-body').innerHTML=visibleTeam(balls,i).map(skillRow).join('')||'<p>无上场角色</p>';openDialog('lineup-detail');};
$('lineup-detail').addEventListener('close',()=>{const resume=lineupAutoResume;lineupAutoResume=false;if(resume&&!settled&&!document.hidden&&!$('battle').hidden)pause(false);});
$('skills-dialog').addEventListener('close',()=>{const resume=skillsAutoResume;skillsAutoResume=false;if(resume&&!settled&&!document.hidden&&!$('battle').hidden)pause(false);});
$('back').onclick=returnToSelection;$('restart').onclick=()=>{if(session)startRound(roundSeed,replaying||(battleContext?settled:true));};
$('replay-result').onclick=()=>startRound(roundSeed,true);$('rematch').onclick=()=>{series=new M.Series(matchState.mode==='brawl'?1:matchState.series);startRound(newSeed(),false);};$('edit-result').onclick=returnToSelection;
$('next-round').onclick=()=>{if(battleContext){if(replaying)return;battleContext.onNext();return;}if(series.next())startRound(newSeed(),false);};
$('battle-note').onclick=()=>{if(settled)openDialog('result');};
function renderSound(){ $('sound').textContent=soundOn?'声音开':'声音关';$('sound').setAttribute('aria-pressed',String(soundOn));}
$('sound').onclick=()=>{soundOn=!soundOn;if(soundOn&&!unlockAudio()){soundOn=false;toast('此浏览器暂不支持声音。');}if(!soundOn&&audio.master)audio.master.gain.value=0;state.soundOn=soundOn;renderSound();save();};
document.addEventListener('pointerdown',()=>{if(soundOn)unlockAudio();},{passive:true});
document.addEventListener('keydown',()=>{if(soundOn)unlockAudio();});
renderSound();for(const button of $('speeds').children){const active=Number(button.dataset.speed)===speed;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}

function focusPause(){if(session&&!paused&&!settled)pause(true);}window.addEventListener('blur',focusPause);document.addEventListener('visibilitychange',()=>{if(document.hidden)focusPause();});
window.addEventListener('keydown',e=>{if(document.querySelector('dialog[open]'))return;if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.code==='Space'&&session&&!settled){e.preventDefault();pause();}if(e.key==='Escape'&&session&&!settled){e.preventDefault();pause(true);}});
new ResizeObserver(resizeArena).observe($('stage'));window.addEventListener('resize',resizeArena);
new ResizeObserver(()=>{const art=document.querySelector('.home-art');if($('home').hidden||!art.clientWidth)return;const size=Math.max(32,Math.min(art.clientWidth-12,art.clientHeight-48,600)),wrap=document.querySelector('.home-arena');wrap.style.width=size+'px';wrap.style.height=size+'px';wrap.style.maxHeight='none';}).observe(document.querySelector('.home-art'));
$('home-back').onclick=goHome;$('home-free').onclick=enterFree;$('home-continue-free').onclick=()=>{showScreen('battle');pause(false);};
normalizeForMode();renderSelection();renderRoster();showScreen('home');requestAnimationFrame(frame);
globalThis.ArenaApp={showScreen,goHome,enterFree,startExternalMatch,resumeExternalMatch,discardExternalMatch,renderSettings,openDialog,openSkills,toast,esc,get context(){return battleContext;},get state(){return state;},get session(){return session;},get engine(){return engine;},get mechanisms(){return mechanisms;},get series(){return series;},get paused(){return paused;},get seed(){return roundSeed;},get settled(){return settled;},get replaying(){return replaying;},get timeLimit(){return matchTimeLimit;},get timedOut(){return roundTimedOut;},startMatch,advanceSteps,pause,returnToSelection,startRound,renderSelection,renderRoster};
})();
