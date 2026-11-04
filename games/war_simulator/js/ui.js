// ui.js —— 交互 (从原单文件拆出; 全局命名空间 W)
(function(){
  const C = W.Config.CONST, TYPES = W.Config.UNIT_TYPES;
  const SPAWN_SPACING = 26;
  let tip, toastTimer = null;

  function buildSidebar(){
    const list = document.getElementById('unitList'); list.innerHTML = '';
    for (const id in TYPES){
      const cfg = TYPES[id];
      const card = document.createElement('div'); card.tabIndex=0; card.setAttribute('role','button'); card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectUnit(id);}}); card.className='unit-card'; card.dataset.id=id;
      card.innerHTML = '<div class="uc-swatch" style="background:'+cfg.accent+'">'+({hammer:'▣',flag:'⚑',ballista:'➳',bomb:'●',sword:'⚔',spear:'↟',bow:'➶',greathammer:'▣',flag:'⚑',ballista:'➳',bomb:'●',sword:'⚔',sling:'◈',axe:'✦',staff:'✧',club:'◆'}[cfg.weapon]||'◆')+'</div><div class="uc-info"><div class="uc-name">'+cfg.name+' <span class="uc-kind">'+(cfg.kind==='ranged'?'远程':'近战')+'</span></div><div class="uc-cost">💰 '+cfg.cost+'</div></div>';
      card.addEventListener('click', ()=> selectUnit(id));
      card.addEventListener('mouseenter', (e)=> showTooltip(id, e));
      card.addEventListener('mousemove', moveTooltip);
      card.addEventListener('mouseleave', hideTooltip);
      list.appendChild(card);
    }
  }
  function refreshSwatches(){ const col=W.Config.TEAM_COLORS[W.Game.state.input.selectedTeam].main; document.querySelectorAll('.uc-swatch').forEach(s=>s.style.background=col); }
  function selectUnit(id){ W.Game.state.input.inspect=false;W.Game.state.input.panMode=false;document.getElementById('btnInspect')?.classList.remove('active');document.getElementById('btnPan')?.classList.remove('active'); W.Game.state.input.erase=false; document.getElementById('btnErase')?.classList.remove('active'); W.Game.state.input.selectedTypeId=id; document.querySelectorAll('.unit-card').forEach(c=>c.classList.toggle('selected',c.dataset.id===id)); document.body.classList.toggle('no-sel',!id); }
  function setTeam(team){ W.Game.state.input.selectedTeam=team; document.querySelectorAll('.team-btn').forEach(b=>b.classList.toggle('active',b.dataset.team===team)); refreshSwatches(); }

  function showTooltip(id,e){ const cfg=TYPES[id], dps=(cfg.attack/cfg.attackInterval).toFixed(1);
    tip.innerHTML='<div class="tt-title">'+cfg.name+' <span>'+cfg.nameEn+'</span></div><div class="tt-row"><span>类型</span><b>'+(cfg.kind==='ranged'?'远程':'近战')+'</b></div><div class="tt-row"><span>造价</span><b>💰 '+cfg.cost+'</b></div><div class="tt-row"><span>生命</span><b>'+cfg.hp+'</b></div><div class="tt-row"><span>攻击</span><b>'+cfg.attack+'</b></div><div class="tt-row"><span>间隔</span><b>'+cfg.attackInterval+'s</b></div><div class="tt-row"><span>DPS</span><b>'+dps+'</b></div><div class="tt-row"><span>射程</span><b>'+cfg.range+'</b></div><div class="tt-row"><span>移速</span><b>'+cfg.moveSpeed+'</b></div><div class="tt-desc">'+cfg.desc+'</div>';
    tip.style.display='block'; moveTooltip(e); }
  function moveTooltip(e){ const pad=14, r=tip.getBoundingClientRect(); let x=e.clientX+pad, y=e.clientY+pad; if(x+r.width>innerWidth)x=e.clientX-r.width-pad; if(y+r.height>innerHeight)y=e.clientY-r.height-pad; tip.style.left=x+'px'; tip.style.top=y+'px'; }
  function hideTooltip(){ tip.style.display='none'; }

  function getWorld(e){ const r=document.getElementById('canvas').getBoundingClientRect(); return W.Renderer.s2w(e.clientX-r.left,e.clientY-r.top); }
  function spawnAt(w){
    if(W.Lab){W.Lab.place(w);return;} const inp=W.Game.state.input; if(!inp.selectedTypeId) return;
    if (W.Game.state.units.length >= C.MAX_UNITS){ flash('已达单位上限 '+C.MAX_UNITS); return; }
    const cfg = TYPES[inp.selectedTypeId];
    const team = w.x < 0 ? 'red' : 'blue';                  // 摆在哪边就是哪个阵营(左红右蓝)
    const gx = inp.gridSnap ? Math.round(w.x/C.GRID_SIZE)*C.GRID_SIZE : w.x;
    const gy = inp.gridSnap ? Math.round(w.y/C.GRID_SIZE)*C.GRID_SIZE : w.y;
    const us = W.Game.state.units;                            // 放置禁止重叠(碰撞体积)
    for (let i=0;i<us.length;i++){ const o=us[i]; const rr=o.radius+cfg.radius; if ((o.pos.x-gx)*(o.pos.x-gx)+(o.pos.y-gy)*(o.pos.y-gy) < rr*rr){ return; } }
    W.Game.createUnit(inp.selectedTypeId, team, gx, gy);
    W.Game.recomputeCosts();
  }
  function pickUnitAt(w){ const us=W.Game.state.units; for(let i=us.length-1;i>=0;i--){ const u=us[i], r=u.radius*1.8, dx=u.pos.x-w.x, dy=u.pos.y-w.y; if(dx*dx+dy*dy<r*r) return u; } return null; }

  function onDown(e){ if(e.isPrimary===false||e.button!==0) return; const inp=W.Game.state.input; if(W.Interaction?.down(e))return; if(inp.panMode){e.currentTarget.setPointerCapture(e.pointerId);inp.panLast={x:e.clientX,y:e.clientY};return;} if(W.Game.state.phase!=='setup'||!inp.selectedTypeId) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); W.Lab.remember(); const w=getWorld(e); inp.mouseDown=true; inp.dragged=false; inp.downPos={x:w.x,y:w.y}; inp.downTime=performance.now(); inp.lastSpawn=null; }
  function onMove(e){ if(W.Interaction?.move(e))return; const inp=W.Game.state.input, w=getWorld(e); if(inp.panLast){const cam=W.Game.state.camera;cam.x-=(e.clientX-inp.panLast.x)/cam.zoom;cam.y-=(e.clientY-inp.panLast.y)/cam.zoom;inp.panLast={x:e.clientX,y:e.clientY};return;} inp.mouseWorld=w; if(inp.mouseDown&&W.Game.state.phase==='setup'&&inp.selectedTypeId){ const dp=inp.downPos; if(Math.hypot(w.x-dp.x,w.y-dp.y)>6) inp.dragged=true; if(inp.dragged){ const ls=inp.lastSpawn, now=performance.now(); if(!ls||Math.hypot(w.x-ls.x,w.y-ls.y)>SPAWN_SPACING||now-ls.t>70){ spawnAt(w); inp.lastSpawn={x:w.x,y:w.y,t:now}; } } } }
  function onUp(e){ if(W.Interaction?.up(e))return; if(e.button!==0) return; const inp=W.Game.state.input; inp.panLast=null; if(inp.mouseDown&&W.Game.state.phase==='setup'){ if(!inp.dragged) spawnAt(inp.downPos); inp.mouseDown=false; } }
  function onContext(e){ e.preventDefault(); if(W.Game.state.phase!=='setup') return; const u=pickUnitAt(getWorld(e)); if(u){ W.Lab.remember(); W.Game.removeUnit(u); W.Game.recomputeCosts(); } }
  function onWheel(e){ e.preventDefault(); const cam=W.Renderer.cam, cv=document.getElementById('canvas'), minZ=W.Renderer.minZoom(), before=W.Renderer.s2w(e.offsetX,e.offsetY); cam.zoom=W.Util.clamp(cam.zoom*(e.deltaY<0?1.12:1/1.12),minZ,3.5); const after=W.Renderer.s2w(e.offsetX,e.offsetY); cam.x+=before.x-after.x; cam.y+=before.y-after.y; }

  function showBanner(winner){ const t=document.getElementById('bannerTitle'); if(winner==='draw'){t.textContent='🏳 平局';t.style.color='#f2c14e';} else if(winner==='red'){t.textContent='🔴 红方胜利！';t.style.color=W.Config.TEAM_COLORS.red.main;} else {t.textContent='🔵 蓝方胜利！';t.style.color=W.Config.TEAM_COLORS.blue.main;} document.getElementById('banner').classList.add('show'); }
  function hideBanner(){document.getElementById('btnNextLevel').hidden=true; document.getElementById('banner').classList.remove('show'); }
  let lastFlash='',lastFlashAt=0;
  function flash(msg){const now=performance.now();if(msg===lastFlash&&now-lastFlashAt<700)return;lastFlash=msg;lastFlashAt=now; const el=document.getElementById('toast'); el.textContent=msg; el.classList.add('show'); if(toastTimer)clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),1600); }
  function updatePhaseUI(){ const battle=W.Game.state.phase==='battle'; document.body.classList.toggle('in-battle',battle); document.getElementById('btnStart').disabled=battle; const pb=document.getElementById('btnPause'); pb.textContent=W.Game.state.paused?'▶ 继续':'⏸ 暂停'; pb.classList.toggle('active',W.Game.state.paused); pb.disabled=!battle; document.getElementById('btnReset').disabled=(!W.Game.state.setupSnapshot&&!battle); }

  function wire(){
    tip = document.getElementById('tooltip');
    document.getElementById('btnStart').addEventListener('click', startOrRematch);
    document.getElementById('btnReset').addEventListener('click',()=>{ W.Game.resetBattle(); updatePhaseUI(); });
    document.getElementById('btnClear').addEventListener('click',()=>{ W.Game.clearAll(); updatePhaseUI(); });
    document.getElementById('btnRematch').addEventListener('click',()=>{ W.Game.rematch(); updatePhaseUI(); });
    document.getElementById('btnBannerReset').addEventListener('click',()=>{ W.Game.resetBattle(); updatePhaseUI(); });
    document.getElementById('btnRandom').addEventListener('click', randomArmy);
    document.getElementById('btnPause').addEventListener('click', togglePause);
    document.getElementById('btnSlow').addEventListener('click', toggleSlow);
    const cv=document.getElementById('canvas');
    cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp); cv.addEventListener('pointercancel',()=>{W.Game.state.input.mouseDown=false;W.Game.state.input.panLast=null;}); cv.addEventListener('pointerleave',()=>{W.Game.state.input.mouseWorld=null;});
    cv.addEventListener('contextmenu', onContext); cv.addEventListener('wheel', onWheel, {passive:false});
    const panKeys={KeyW:'up',ArrowUp:'up',KeyS:'down',ArrowDown:'down',KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right'};
    window.addEventListener('keydown',(e)=>{
      if(W.Menu?.isHome)return;
      if(/INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName)||document.getElementById('helpDialog').open||e.repeat)return;
      if(panKeys[e.code]){ W.Game.state.input.keys[panKeys[e.code]]=true; e.preventDefault(); }
      else if(e.code==='Tab'){ e.preventDefault(); startOrRematch(); }
      else if(e.code==='Space'){ e.preventDefault(); togglePause(); }
      else if(e.code==='KeyG'){ W.Game.state.input.gridSnap=!W.Game.state.input.gridSnap; }
      else if(e.code==='KeyM'){ toggleSlow(); }
      else if(e.code==='KeyR'){ W.Game.resetBattle(); updatePhaseUI(); }
      else if(e.code==='KeyC'){ W.Game.clearAll(); updatePhaseUI(); }
    });
    window.addEventListener('keyup',(e)=>{ if(panKeys[e.code]) W.Game.state.input.keys[panKeys[e.code]]=false; });
    window.addEventListener('blur',()=>{ const k=W.Game.state.input.keys; k.up=k.down=k.left=k.right=false; });
  }
  function startOrRematch(){ if(W.Game.state.phase==='setup') W.Game.startBattle(); else if(W.Game.state.winner) W.Game.rematch(); updatePhaseUI(); }
  function togglePause(){
    if (W.Game.state.phase!=='battle') return;
    W.Game.state.paused = !W.Game.state.paused;
    const b=document.getElementById('btnPause'); b.textContent = W.Game.state.paused?'▶ 继续':'⏸ 暂停'; b.classList.toggle('active',W.Game.state.paused);
  }
  function toggleSlow(){
    W.Game.state.timeScale = (W.Game.state.timeScale<1)?1:0.25;
    document.getElementById('btnSlow').classList.toggle('active', W.Game.state.timeScale<1);
  }
  function randomArmy(){
    if (W.Game.state.phase!=='setup'){ flash('战斗中无法配兵'); return; }
    if(W.Campaign?.random())return;
    const budget = Math.min(10000,parseInt(document.getElementById('budgetInput').value, 10) || 0);
    if (budget < 10){ flash('金额太少'); return; }
    W.Lab.remember(); W.Game.clearAll(); W.Game.randomArmy('red', budget); W.Game.randomArmy('blue', budget);   // 每边各按此预算
    W.Game.recomputeCosts(); flash('已按每边 ¥'+budget+' 随机配兵');
  }

  W.UI = { buildSidebar, selectUnit, setTeam, showTooltip, hideTooltip, moveTooltip, pickUnitAt, updatePhaseUI, showBanner, hideBanner, flash, wire };
})();
