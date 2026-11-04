(function(){
  const $=id=>document.getElementById(id),T=W.Config.UNIT_TYPES,C=W.Config.CONST;
  let selected=null,drag=null,filter='all';
  function world(e){const r=$('canvas').getBoundingClientRect();return W.Renderer.s2w(e.clientX-r.left,e.clientY-r.top);}
  function down(e){const s=W.Game.state;if(s.input.panMode)return false;if(!s.input.inspect&&s.phase!=='battle')return false;selected=W.UI.pickUnitAt(world(e));
    if(selected&&s.phase==='setup'&&(!W.Campaign.active||selected.team==='red')){W.Lab.remember();drag={unit:selected,x:selected.pos.x,y:selected.pos.y,pointer:e.pointerId};e.currentTarget.setPointerCapture(e.pointerId);}hud();return true;
  }
  function valid(u,w){if(!W.Terrain.passable(w,u.radius)||Math.abs(w.x)>C.BOUND_X-u.radius||Math.abs(w.y)>C.BOUND_Y-u.radius||(w.x<0)!==(u.team==='red'))return false;return !W.Game.state.units.some(a=>a!==u&&Math.hypot(a.pos.x-w.x,a.pos.y-w.y)<a.radius+u.radius+2);}
  function move(e){if(drag&&W.Game.state.phase!=='setup'){drag=null;return true;}if(!drag||e.pointerId!==drag.pointer)return false;const p=world(e);if(W.Game.state.input.gridSnap){p.x=Math.round(p.x/C.GRID_SIZE)*C.GRID_SIZE;p.y=Math.round(p.y/C.GRID_SIZE)*C.GRID_SIZE;}if(valid(drag.unit,p)){drag.unit.pos.x=p.x;drag.unit.pos.y=p.y;}return true;}
  function up(e){if(!drag||e.pointerId!==drag.pointer)return false;drag=null;return true;}
  function cancel(){if(drag){drag.unit.pos.x=drag.x;drag.unit.pos.y=drag.y;drag=null;}}
  function remove(){if(!selected||W.Game.state.phase!=='setup')return;W.Lab.remember();W.Game.removeUnit(selected);W.Game.recomputeCosts();selected=null;hud();}
  function hud(){if(!W.Game.state.units.includes(selected))selected=null;const panel=$('inspectPanel');panel.hidden=!selected;if(!selected)return;const u=selected,c=T[u.typeId];panel.innerHTML=`<strong>${u.team==='red'?'红':'蓝'} · ${c.name}</strong><span>${Math.ceil(u.hp)} / ${u.maxHp} HP · ${c.mass} 质量</span><span>${!u.alive?'已阵亡':u.stunTime>0?'震慑':u.slowTime>0?'霜冻减速':u.rally?'军旗鼓舞':u.chargeTime>0?'冲锋中':'就绪'}${c.special&&['charge','quake','dash'].includes(c.special.kind)?' · 技能 '+Math.ceil(u.abilityCd)+'s':''}</span>`;}
  function draw(ctx){if(!selected||!W.Game.state.units.includes(selected))return;const u=selected,c=T[u.typeId];ctx.save();ctx.strokeStyle='#f0d796';ctx.lineWidth=2/W.Game.state.camera.zoom;ctx.beginPath();ctx.arc(u.pos.x,u.pos.y,u.radius+8,0,Math.PI*2);ctx.stroke();if(W.Game.state.phase==='setup'){ctx.setLineDash([6,7]);ctx.strokeStyle='#efd6a03d';ctx.beginPath();ctx.arc(u.pos.x,u.pos.y,c.kind==='ranged'?c.range:c.range+u.radius,0,Math.PI*2);ctx.stroke();}ctx.restore();}
  function search(){const q=$('unitSearch').value.trim().toLowerCase();document.querySelectorAll('.unit-card').forEach(card=>{const c=T[card.dataset.id];card.hidden=(filter!=='all'&&c.kind!==filter)||!(c.name+c.nameEn+c.desc).toLowerCase().includes(q);});}
  function init(){$('btnInspect').onclick=()=>{const i=W.Game.state.input;i.inspect=!i.inspect;i.erase=false;i.panMode=false;$('btnInspect').classList.toggle('active',i.inspect);$('btnErase').classList.remove('active');$('btnPan').classList.remove('active');};
    for(const id of ['btnErase','btnPan'])$(id).addEventListener('click',()=>{const i=W.Game.state.input;i.inspect=false;$('btnInspect').classList.remove('active');if(id==='btnErase'){i.panMode=false;$('btnPan').classList.remove('active');}else{i.erase=false;$('btnErase').classList.remove('active');}});
    $('unitSearch').addEventListener('input',search);document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(a=>a.classList.toggle('active',a===b));search();});
    $('canvas').addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
    window.addEventListener('keydown',e=>{if(W.Menu?.isHome)return;if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||$('helpDialog').open)return;if(e.key==='Escape'){cancel();selected=null;W.Game.state.input.inspect=false;$('btnInspect').classList.remove('active');hud();}if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('btnUndo').click();}});
  }
  W.Interaction={init,down,move,up,hud,draw};
})();
