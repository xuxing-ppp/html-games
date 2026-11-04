// Battle experiments, formation tools and local persistence. No network dependencies.
(function(){
  const $=id=>document.getElementById(id), C=W.Config.CONST, T=W.Config.UNIT_TYPES;
  const scenarios={
    balanced:{desc:'双方同等编制，步兵掩护远程。',red:[['roman_swordsman',8],['archer',4],['priest',1]],blue:[['roman_swordsman',8],['archer',4],['priest',1]]},
    swarm:{desc:'三名巨人对二十八名部落勇士。',red:[['giant',3]],blue:[['tribesman',28]]},
    arrows:{desc:'盾墙掩护狂战士突破箭雨。正面防御与侧翼突击的实验。',red:[['shielder',7],['berserker',5]],blue:[['archer',14],['spartan_spearman',4]]},
    arcane:{desc:'法师、牧师和重甲的协同战。密集阵型也可能成为火球的靶子。',red:[['heavy_knight',4],['mage',4],['priest',2]],blue:[['giant',2],['mounted_archer',7],['priest',2]]}
  };
  let history=[], elapsed=0, scores={red:0,blue:0}, mode='classic', initial={red:1,blue:1}, hudAt=0;
  const modes={classic:'击败全部敌军；180 秒后按剩余生命比例结算。',control:'独占中央据点持续得分，先到 30 分获胜；歼灭敌军也可获胜。',storm:'10 秒后安全圈收缩，圈外持续受伤。迫使远程部队进入近战！'};
  function snap(){return W.Game.state.units.map(u=>({typeId:u.typeId,team:u.team,x:u.pos.x,y:u.pos.y}));}
  function remember(){history.push({units:snap(),map:W.Terrain.current});if(history.length>30)history.shift();}
  function editable(){if(W.Game.state.phase==='setup')return true;W.UI.flash('先重置战场，再调整布阵');return false;}
  function restore(data){W.Game.clearAll();for(const u of data)if(!W.Campaign?.active||u.team==='red')W.Game.createUnit(u.typeId,u.team,u.x,u.y);W.Game.recomputeCosts();W.UI.updatePhaseUI();}
  function preset(){if(!editable()||W.Campaign?.active)return;remember();const sc=scenarios[$('scenario').value];W.Game.clearAll();for(const team of ['red','blue']){let col=0;for(const [id,n] of sc[team]){for(let i=0;i<n;i++){const rows=Math.min(n,7);const p=W.Terrain.freeSpot(id,team,(team==='red'?-1:1)*(170+col*65+Math.floor(i/7)*48),(i%7-(rows-1)/2)*48);if(p)W.Game.createUnit(id,team,p.x,p.y);}col+=Math.ceil(n/7);}}W.Game.recomputeCosts();W.UI.updatePhaseUI();$('scenarioDesc').textContent=sc.desc;W.Renderer.fit();}
  function formationOffsets(point){const cfg=T[W.Game.state.input.selectedTypeId];if(!cfg)return [];const spacing=cfg.radius*2+12,kind=$('formation').value;
    let offsets=[[0,0]];
    if(kind==='line')offsets=Array.from({length:5},(_,i)=>[0,(i-2)*spacing]);
    if(kind==='wedge')offsets=[[0,0],[-1,-1],[-1,1],[-2,-2],[-2,0],[-2,2]].map(([x,y])=>[x*spacing*(point.x<0?1:-1),y*spacing]);
    if(kind==='cluster')offsets=Array.from({length:9},(_,i)=>[(Math.floor(i/3)-1)*spacing,(i%3-1)*spacing]);
    return offsets;
  }
  function place(point){const s=W.Game.state;if(s.input.erase){const u=W.UI.pickUnitAt(point);if(u){W.Game.removeUnit(u);W.Game.recomputeCosts();}return;}
    const id=s.input.selectedTypeId;if(!id)return;const cfg=T[id],offsets=formationOffsets(point);
    for(const [dx,dy] of offsets){let x=point.x+dx,y=point.y+dy;if(s.input.gridSnap){x=Math.round(x/C.GRID_SIZE)*C.GRID_SIZE;y=Math.round(y/C.GRID_SIZE)*C.GRID_SIZE;}
      if(!W.Terrain.passable({x,y},cfg.radius)||Math.abs(x)>C.BOUND_X-cfg.radius||Math.abs(y)>C.BOUND_Y-cfg.radius||s.units.length>=C.MAX_UNITS)continue;
      if((x<0)!==(point.x<0))continue;
      if(s.units.some(u=>Math.hypot(u.pos.x-x,u.pos.y-y)<u.radius+cfg.radius+2))continue;
      if(W.Campaign&&!W.Campaign.allow(id,x<0?'red':'blue'))break;
      W.Game.createUnit(id,x<0?'red':'blue',x,y);
    }W.Game.recomputeCosts();
  }
  function begin(){elapsed=0;scores={red:0,blue:0};mode=$('battleMode').value;initial={red:0,blue:0};for(const u of W.Game.state.units)initial[u.team]+=u.maxHp;}
  function finish(winner){const s=W.Game.state;if(s.winner)return;s.winner=winner;W.UI.showBanner(winner);const alive=s.units.filter(u=>u.alive);$('bannerSub').textContent=`用时 ${elapsed.toFixed(1)} 秒 · 红方剩余 ${alive.filter(u=>u.team==='red').length} / 蓝方剩余 ${alive.filter(u=>u.team==='blue').length} · ${mode==='control'?'据点 '+Math.floor(scores.red)+' : '+Math.floor(scores.blue):'调整阵容，试试另一种解法'}`;if(W.Campaign)W.Campaign.result(winner,elapsed);}
  function radius(){return Math.max(85,650-Math.max(0,elapsed-10)*5);}
  function step(dt){const s=W.Game.state;elapsed+=dt;
    if(mode==='control'){const count={red:0,blue:0};for(const u of s.units)if(u.alive&&Math.hypot(u.pos.x,u.pos.y)<115)count[u.team]++;for(const team of ['red','blue'])if(count[team]&&!count[team==='red'?'blue':'red']){scores[team]+=dt;if(scores[team]>=30)finish(team);}}
    if(mode==='storm'&&elapsed>10){const r=radius();for(const u of s.units)if(u.alive&&Math.hypot(u.pos.x,u.pos.y)>r){u.hp=Math.max(0,u.hp-dt*(5+u.maxHp*.025));if(u.hp===0)W.Physics.kill(u);}}
    if(elapsed>=180&&!s.winner){const hp={red:0,blue:0};for(const u of s.units)if(u.alive)hp[u.team]+=u.hp;const diff=mode==='control'?scores.red-scores.blue:hp.red/initial.red-hp.blue/initial.blue;finish(Math.abs(diff)<.001?'draw':diff>0?'red':'blue');}
  }
  function steer(u){if(mode!=='control'||Math.hypot(u.pos.x,u.pos.y)<88)return;const d=Math.hypot(u.pos.x,u.pos.y);u.thrustX=-u.pos.x/d*u.moveSpeed*C.THRUST_SCALE;u.thrustY=-u.pos.y/d*u.moveSpeed*C.THRUST_SCALE;}
  function draw(ctx){const s=W.Game.state, m=s.phase==='setup'?$('battleMode').value:mode;
    ctx.save();if(m==='control'){const leader=scores.red===scores.blue?'#dabc79':scores.red>scores.blue?'#ed7869':'#79b9d1';ctx.fillStyle=leader+'18';ctx.strokeStyle=leader;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,115,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([5,8]);ctx.beginPath();ctx.arc(0,0,125,0,Math.PI*2);ctx.stroke();ctx.fillStyle=leader;ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('争夺据点 / 30',0,-140);}
    if(m==='storm'){const r=s.phase==='setup'?650:radius();ctx.fillStyle='#b676ce22';ctx.beginPath();ctx.rect(-C.BOUND_X,-C.BOUND_Y,2*C.BOUND_X,2*C.BOUND_Y);ctx.arc(0,0,r,0,Math.PI*2,true);ctx.fill('evenodd');ctx.strokeStyle='#c6a1da';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();}ctx.restore();
  }
  function hud(){const now=performance.now();if(now-hudAt<100)return;hudAt=now;const s=W.Game.state,hp={red:0,blue:0},count={red:0,blue:0};for(const u of s.units)if(u.alive){count[u.team]++;hp[u.team]+=u.hp;}
    for(const team of ['red','blue']){$(team+'Count').textContent=count[team];$(team+'Budget').textContent='兵力 / '+s[team+'Cost']+' 金';$(team+'Strength').style.width=(s.phase==='setup'?100:Math.min(100,100*hp[team]/(initial[team]||1)))+'%';}
    $('battleTime').textContent=s.phase==='setup'?'00:00':String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(Math.floor(elapsed%60)).padStart(2,'0');$('phaseLabel').textContent=s.winner?'战斗结束':s.phase==='setup'?'准备部署':s.paused?'已暂停':'交战中';const m=s.phase==='setup'?$('battleMode').value:mode;$('objectiveLabel').textContent=m==='control'?`据点 ${Math.floor(scores.red)} : ${Math.floor(scores.blue)} / 30`:m==='storm'?'安全圈持续收缩':'歼灭全部敌军';
    const id=s.input.selectedTypeId;if(id&&$('unitDetail').dataset.unit!==id){$('unitDetail').dataset.unit=id;$('unitDetail').innerHTML='<strong>'+T[id].name+'</strong><p>'+T[id].desc+'</p><p>生命 '+T[id].hp+' · 攻击 '+T[id].attack+' · 造价 '+T[id].cost+'</p>';}
    for(const id of ['scenario','btnScenario','battleMode','formation','btnUndo','btnLoad','btnErase','btnRandom'])$(id).disabled=s.phase==='battle';
    if(W.Campaign)W.Campaign.hud();if(W.Interaction)W.Interaction.hud();
  }
  function init(){$('btnScenario').onclick=preset;$('scenario').onchange=()=>{$('scenarioDesc').textContent=scenarios[$('scenario').value].desc;};$('battleMode').onchange=()=>{$('modeDesc').textContent=modes[$('battleMode').value];};$('btnFit').onclick=()=>W.Renderer.fit();$('btnZoomIn').onclick=()=>W.Renderer.zoom(1.2);$('btnZoomOut').onclick=()=>W.Renderer.zoom(1/1.2);$('btnPan').onclick=()=>{W.Game.state.input.panMode=!W.Game.state.input.panMode;$('btnPan').classList.toggle('active',W.Game.state.input.panMode);};$('btnGrid').onclick=()=>{W.Game.state.input.gridSnap=!W.Game.state.input.gridSnap;$('btnGrid').classList.toggle('active',W.Game.state.input.gridSnap);};$('btnErase').onclick=()=>{W.Game.state.input.erase=!W.Game.state.input.erase;$('btnErase').classList.toggle('active',W.Game.state.input.erase);};$('btnUndo').onclick=()=>{if(editable()&&history.length){const old=history.pop();W.Terrain.setMap(old.map);restore(old.units);$('mapSelect').value=old.map;W.Maps?.preview();W.Renderer.fit();}};
    $('btnSave').onclick=()=>{if(!editable()||W.Campaign?.active)return;try{localStorage.setItem('war-lab-v1',JSON.stringify({units:snap(),mode:$('battleMode').value,map:W.Terrain.current}));W.UI.flash('布阵已保存在这台设备');}catch(e){W.UI.flash('浏览器未允许本地保存');}};
    $('btnLoad').onclick=()=>{if(!editable()||W.Campaign?.active)return;try{const d=JSON.parse(localStorage.getItem('war-lab-v1'));if(!d||!Array.isArray(d.units)||d.units.length>C.MAX_UNITS||!d.units.every(u=>T[u.typeId]&&['red','blue'].includes(u.team)&&Number.isFinite(u.x)&&Number.isFinite(u.y)))throw Error();const map=d.map===undefined?'meadow':d.map;if(!W.Terrain.hasMap(map)||!d.units.every(u=>W.Terrain.passable({x:u.x,y:u.y},T[u.typeId].radius,map))||d.units.some((u,i)=>d.units.slice(0,i).some(v=>Math.hypot(u.x-v.x,u.y-v.y)<T[u.typeId].radius+T[v.typeId].radius)))throw Error();remember();W.Terrain.setMap(map);restore(d.units);$('mapSelect').value=map;W.Maps?.preview();W.Renderer.fit();$('battleMode').value=modes[d.mode]?d.mode:'classic';$('battleMode').onchange();W.UI.flash('布阵已读取');}catch(e){W.UI.flash('没有可用的本地布阵');}};
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-filter]').forEach(a=>a.classList.toggle('active',a===b));document.querySelectorAll('.unit-card').forEach(c=>c.hidden=b.dataset.filter!=='all'&&T[c.dataset.id].kind!==b.dataset.filter);});$('btnHelp').onclick=()=>$('helpDialog').showModal();$('btnCloseHelp').onclick=()=>$('helpDialog').close();new ResizeObserver(()=>W.Renderer.resize()).observe($('stage'));preset();history=[];
  }
  W.Lab={controlGoal(u){return mode==='control'&&Math.hypot(u.pos.x,u.pos.y)>=88?{x:0,y:0}:null;},preset,formationOffsets,clearHistory(){history=[];},init,place,remember,begin,step,steer,draw,hud,finish};
})();
