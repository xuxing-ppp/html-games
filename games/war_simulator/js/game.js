// game.js —— 状态+主循环 (从原单文件拆出; 全局命名空间 W)
(function(){
  const C = W.Config.CONST, TYPES = W.Config.UNIT_TYPES;

  const state = {
    phase:'setup', units:[], projectiles:[], corpses:[], effects:[],
    redCost:0, blueCost:0, winner:null, setupSnapshot:null, paused:false, timeScale:1,
    camera:{ x:0, y:0, zoom:1 },
    input:{ mouseWorld:null, selectedTypeId:null, selectedTeam:'red', gridSnap:false,
            mouseDown:false, dragged:false, downPos:null, downTime:0, lastSpawn:null,
            keys:{up:false,down:false,left:false,right:false} }
  };

  let _id=1;
  /** 创建单位(自由 2D 放置) */
  function createUnit(typeId, team, x, y){
    const cfg = TYPES[typeId]; if(!cfg) return null;
    const facing = team==='red'?0:Math.PI;
    const u = {
      id:_id++, typeId, team, pos:{x, y: y||0}, vel:{vx:0,vy:0},
      radius:cfg.radius, mass:cfg.mass, moveSpeed:cfg.moveSpeed,
      angle: facing, angularVel: 0,
      spinDir: (cfg.kind==='melee' && cfg.spin!==0) ? W.Util.randSign() : 0,  // 近战主动恒速旋转(顺/逆时针)，远程不转
      spinSpeed: cfg.spin ?? C.MELEE_SPIN,
      thrustX:0, thrustY:0, desiredAngle: facing,        // AI 设推力+期望朝向，物理积分
      weaponHitCd:null,
      hp:cfg.hp, maxHp:cfg.hp, state:'standing', alive:true,
      attackCooldown:0, settleTimer:0, flashTimer:0, timeSinceLastShot:0, attackMult:1, healCd:0, _remove:false
    };
    if (cfg.kind === 'melee'){                              // 近战武器角度(光滑铰链，初始朝向+随机自转)
      u.wangle = u.angle; u.wangularVel = W.Util.randSign()*C.WSPIN_INIT;
    }
    if(W.Abilities)W.Abilities.reset(u); state.units.push(u); return u;
  }
  function removeUnit(u){ if(W.Campaign?.active&&u.team==='blue'){W.UI.flash('关卡敌军不可更改');return;} const i=state.units.indexOf(u); if(i>=0) state.units.splice(i,1); }

  function recomputeCosts(){ let r=0,b=0; for(let i=0;i<state.units.length;i++){ const c=TYPES[state.units[i].typeId].cost; if(state.units[i].team==='red')r+=c; else b+=c; } state.redCost=r; state.blueCost=b; }

  /** 批量生成(预留接口)：在 (x,y) 附近 spread 内放 count 个 */
  function spawnBatch(typeId, team, count, x, y, spread){
    for(let i=0;i<count;i++){ if(state.units.length>=C.MAX_UNITS) break; const p=W.Terrain.freeSpot(typeId,team,x+W.Util.rand(-spread,spread),y+W.Util.rand(-spread,spread));if(p)createUnit(typeId,team,p.x,p.y); }
    recomputeCosts();
  }

  /** 按预算在该阵营半场随机配兵：循环随机选一个买得起的兵种放置，直到预算花光 */
  function randomArmy(team, budget){
    const ids = Object.keys(TYPES);
    let guard = 0;
    while (budget > 0 && guard++ < 2000){
      const afford = ids.filter(id => TYPES[id].cost <= budget);
      if (afford.length === 0) break;                       // 买不起任何兵种
      if (state.units.length >= C.MAX_UNITS) break;
      const id = afford[Math.floor(Math.random()*afford.length)];
      const x = team==='red' ? W.Util.rand(-380,-20) : W.Util.rand(20,380);   // 限己方半场
      const y = W.Util.rand(-220,220);
      const spot=W.Terrain.freeSpot(id,team,x,y);if(!spot)continue;
      createUnit(id, team, spot.x, spot.y);
      budget -= TYPES[id].cost;
    }
  }

  function snapshot(){ return state.units.map(u=>({typeId:u.typeId, team:u.team, x:u.pos.x, y:u.pos.y})); }
  function restoreSnapshot(sn){ state.units.length=0; for(const s of sn) createUnit(s.typeId, s.team, s.x, s.y); }

  function startBattle(){
    if (state.phase==='battle') return;
    if(W.Campaign&&!W.Campaign.canStart())return;
    if (!['red','blue'].every(t=>state.units.some(u=>u.team===t))){ W.UI.flash('请为红蓝双方都部署士兵'); return; }
    state.paused=false; state.input.mouseDown=false; W.Lab.begin();
    state.setupSnapshot = snapshot();
    for (const u of state.units){
      const cfg=TYPES[u.typeId];
      u.hp=cfg.hp; u.maxHp=cfg.hp; u.alive=true; u.state='standing';
      u.vel.vx=0; u.vel.vy=0; u.angularVel=0;              // 从静止开始，由主动旋转加速到恒定角速度
      u.attackCooldown=0; u.flashTimer=0; u.settleTimer=0; u.timeSinceLastShot=0; u._remove=false;
      u.angle = u.team==='red'?0:Math.PI;
      u.thrustX=0; u.thrustY=0; u.desiredAngle=u.angle; u.weaponHitCd=null;
      u.navigation=null; u.attackMult=1; u.healCd=0; if(W.Abilities)W.Abilities.reset(u);
      if (TYPES[u.typeId].kind === 'melee'){              // 重置武器角度+随机自转
        u.wangle = u.angle; u.wangularVel = W.Util.randSign()*C.WSPIN_INIT;
      }
    }
    W.Projectiles.reset(); W.Effects.clear(); state.corpses.length=0;
    state.winner=null; state.phase='battle'; W.UI.hideBanner();
  }
  function resetBattle(){ state.paused=false; state.input.mouseDown=false; state.phase='setup'; state.winner=null; W.Projectiles.reset(); W.Effects.clear(); state.corpses.length=0; if(state.setupSnapshot) restoreSnapshot(state.setupSnapshot); recomputeCosts(); W.UI.hideBanner(); }
  function clearAll(force=false){ if(W.Campaign?.active&&!force){state.units=state.units.filter(u=>u.team==='blue');state.setupSnapshot=null;state.phase='setup';state.winner=null;state.paused=false;W.Projectiles.reset();W.Effects.clear();state.corpses.length=0;recomputeCosts();W.UI.hideBanner();W.Campaign.restoreEnemy();return;} state.paused=false; state.input.mouseDown=false; state.units.length=0; state.corpses.length=0; W.Effects.clear(); W.Projectiles.reset(); state.setupSnapshot=null; state.phase='setup'; state.winner=null; state.redCost=0; state.blueCost=0; W.UI.hideBanner(); }
  function rematch(){ resetBattle(); startBattle(); }

  function checkWin(){
    if (state.winner) return;
    let red=false, blue=false;
    for (const u of state.units){ if(u.alive){ if(u.team==='red')red=true; else blue=true; } }
    if (!red&&!blue){ W.Lab.finish('draw'); }
    else if (!red){ W.Lab.finish('blue'); }
    else if (!blue){ W.Lab.finish('red'); }
  }

  function step(dt){
    if (state.phase!=='battle'||state.winner) return;
    const units=state.units;
    if(W.Abilities)W.Abilities.prepare(dt);
    for(let i=0;i<units.length;i++) W.AI.update(units[i], dt);
    W.Projectiles.step(dt);
    W.Physics.step(dt);
    W.Effects.update(dt); W.Lab.step(dt);
    checkWin();
  }

  // 定步长主循环 + 相机 WASD 平移
  let _last=0, _acc=0;
  function frame(now){
    if(W.Menu?.isHome){_last=now;_acc=0;requestAnimationFrame(frame);return;}
    if(!_last) _last=now;
    let ft=(now-_last)/1000; _last=now;
    if(ft>C.MAX_FRAME) ft=C.MAX_FRAME;
    const k=state.input.keys, ps=C.PAN_SPEED/state.camera.zoom*ft;
    if(k.left) state.camera.x-=ps; if(k.right) state.camera.x+=ps;
    if(k.up) state.camera.y-=ps; if(k.down) state.camera.y+=ps;
    const cvEl=document.getElementById('canvas'), cz=state.camera.zoom, vw=(cvEl.clientWidth/cz)/2, vh=(cvEl.clientHeight/cz)/2, mg=30;
    if (vw < C.BOUND_X+mg) state.camera.x = W.Util.clamp(state.camera.x, -C.BOUND_X-mg+vw, C.BOUND_X+mg-vw); else state.camera.x = 0;
    if (vh < C.BOUND_Y+mg) state.camera.y = W.Util.clamp(state.camera.y, -C.BOUND_Y-mg+vh, C.BOUND_Y+mg-vh); else state.camera.y = 0;
    if(!state.paused) _acc += ft * state.timeScale;        // 暂停不步进；慢动作 timeScale<1 步进少
    let steps=0;
    while(_acc>=C.FIXED_DT && steps<C.MAX_STEPS){ step(C.FIXED_DT); _acc-=C.FIXED_DT; steps++; }
    if(steps===C.MAX_STEPS) _acc=0;
    W.Renderer.render(); if(W.Lab)W.Lab.hud();
    requestAnimationFrame(frame);
  }

  function init(){
    const cv=document.getElementById('canvas'), ctx=cv.getContext('2d');
    W.Renderer.init(cv, ctx, state.camera);
    W.Renderer.resize(); W.Renderer.prerender();
    W.UI.buildSidebar(); W.UI.wire();
    for(let i=0;i<6;i++) createUnit('tribesman','red', -150, W.Util.rand(-90,90));
    for(let i=0;i<5;i++) createUnit('roman_swordsman','blue', 150, W.Util.rand(-90,90));
    W.UI.selectUnit('tribesman');
    recomputeCosts(); W.UI.updatePhaseUI();
    window.addEventListener('resize', ()=>W.Renderer.resize());
    requestAnimationFrame(frame);
  }

  W.Game = { state, createUnit, removeUnit, recomputeCosts, spawnBatch, randomArmy, startBattle, resetBattle, clearAll, rematch, checkWin, step, init };
})();
