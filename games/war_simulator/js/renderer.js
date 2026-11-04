// renderer.js —— 渲染 (从原单文件拆出; 全局命名空间 W)
(function(){
  const C = W.Config.CONST, TYPES = W.Config.UNIT_TYPES, TC = W.Config.TEAM_COLORS;
  const S = 48;
  let cv, ctx, cam, dpr=1, cssW=0, cssH=0;
  let grassTile, grassPat;

  function s2w(sx, sy){ return { x:(sx-cssW/2)/cam.zoom + cam.x, y:(sy-cssH/2)/cam.zoom + cam.y }; }
  function rr(x,px,py,w,h,r){ x.beginPath(); x.moveTo(px+r,py); x.arcTo(px+w,py,px+w,py+h,r); x.arcTo(px+w,py+h,px,py+h,r); x.arcTo(px,py+h,px,py,r); x.arcTo(px,py,px+w,py,r); x.closePath(); }

  /** 俯视武器(sprite 用，朝 +x) */
  function drawWeaponTopDown(x, kind, cx, cy, r, accent){
    x.strokeStyle = accent; x.lineCap='round'; x.lineJoin='round';
    const ex = cx + r;
    switch(kind){
      case 'club': x.lineWidth=4; x.beginPath(); x.moveTo(ex,cy); x.lineTo(ex+11,cy); x.stroke(); x.fillStyle=accent; x.beginPath(); x.arc(ex+12,cy,3.5,0,Math.PI*2); x.fill(); break;
      case 'sword': x.lineWidth=2.5; x.beginPath(); x.moveTo(ex,cy); x.lineTo(ex+15,cy); x.stroke(); x.strokeStyle=W.Util.shade(accent,-0.25); x.lineWidth=2; x.beginPath(); x.moveTo(ex-1,cy-3); x.lineTo(ex-1,cy+3); x.stroke(); break;
      case 'spear': x.lineWidth=2; x.beginPath(); x.moveTo(ex-3,cy); x.lineTo(ex+20,cy); x.stroke(); x.fillStyle=accent; x.beginPath(); x.moveTo(ex+20,cy); x.lineTo(ex+25,cy); x.lineTo(ex+20,cy-3); x.lineTo(ex+20,cy+3); x.fill(); break;
      case 'greatsword': x.lineWidth=3.5; x.beginPath(); x.moveTo(ex,cy); x.lineTo(ex+18,cy); x.stroke(); x.strokeStyle=W.Util.shade(accent,-0.25); x.lineWidth=2.5; x.beginPath(); x.moveTo(ex-2,cy-4); x.lineTo(ex-2,cy+4); x.stroke(); break;
      case 'bow': x.lineWidth=2; x.beginPath(); x.arc(ex+7,cy,6,-Math.PI*0.6,Math.PI*0.6); x.stroke(); x.beginPath(); x.moveTo(ex+1,cy); x.lineTo(ex+13,cy); x.stroke(); break;
      case 'sling': x.lineWidth=2; x.beginPath(); x.moveTo(ex,cy); x.lineTo(ex+10,cy+4); x.stroke(); x.fillStyle='#888'; x.beginPath(); x.arc(ex+11,cy+5,3,0,Math.PI*2); x.fill(); break;
      default: x.lineWidth=3; x.beginPath(); x.moveTo(ex,cy); x.lineTo(ex+14,cy); x.stroke();
    }
  }

  /** 绘制俯视剪影(stand=身体+头+武器[幽灵预览]；body=身体+头[运行时动态武器]；rag=扁椭圆+X) */
  function paint(cfg, teamColor, accent, pose, scale=1, padding=0){
    const c = document.createElement('canvas'); c.width=(S+padding*2)*scale; c.height=(S+padding*2)*scale;
    const x = c.getContext('2d');x.scale(scale,scale);x.translate(padding,padding);
    const cx = S/2, cy = S/2, r = 13;
    const dark = W.Util.shade(teamColor, -0.30), light = W.Util.shade(teamColor, 0.25);
    x.clearRect(0,0,S,S); x.lineCap='round'; x.lineJoin='round';
    if (pose === 'rag'){
      x.fillStyle = dark; x.beginPath(); x.ellipse(cx, cy, r*1.5, r*0.7, 0, 0, Math.PI*2); x.fill();
      x.strokeStyle = W.Util.shade(teamColor, -0.50); x.lineWidth = 3;
      x.beginPath(); x.moveTo(cx-15, cy-3); x.lineTo(cx+15, cy+3); x.stroke();
      x.beginPath(); x.moveTo(cx-12, cy+6); x.lineTo(cx+12, cy-6); x.stroke();
      return c;
    }
    x.fillStyle = teamColor; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI*2); x.fill();
    x.strokeStyle = dark; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI*2); x.stroke();
    if (cfg.helmet !== false){                                                      // 头盔(上半圆 + 盔脊 + 盔檐)
      x.fillStyle = W.Util.shade(teamColor,-0.5);
      x.beginPath(); x.arc(cx, cy, r, 0, Math.PI); x.closePath(); x.fill();
      x.strokeStyle = W.Util.shade(teamColor,-0.2); x.lineWidth = 1.5;             // 盔脊(顶→前)
      x.beginPath(); x.moveTo(cx, cy-r); x.lineTo(cx+r*0.7, cy-r*0.3); x.stroke();
      x.lineWidth = 2;                                                              // 盔檐(前端横线)
      x.beginPath(); x.moveTo(cx-r*0.9, cy); x.lineTo(cx+r*0.9, cy); x.stroke();
    }
    if (cfg.special && cfg.special.kind === 'shield'){                              // 盾兵: 盾在武器对面(背面 -x)
      x.fillStyle = W.Util.shade(accent,-0.15);
      x.beginPath(); x.ellipse(cx-r*0.6, cy, r*0.4, r*0.55, 0, 0, Math.PI*2); x.fill();
      x.strokeStyle = W.Util.shade(accent,-0.35); x.lineWidth = 1.5;
      x.beginPath(); x.ellipse(cx-r*0.6, cy, r*0.4, r*0.55, 0, 0, Math.PI*2); x.stroke();
    }
    x.fillStyle = light; x.beginPath(); x.arc(cx + r*0.55, cy, r*0.4, 0, Math.PI*2); x.fill();
    if (pose === 'stand') drawWeaponTopDown(x, cfg.weapon||'sword', cx, cy, r, accent);
    if (pose === 'body' && cfg.kind === 'ranged'){         // 远程用图标贴图区分(无武器线段)
      const pk = cfg.projectile && cfg.projectile.kind;
      if (pk === 'arrow'){            // 弓箭手/弓骑兵: 小箭头
        x.strokeStyle = accent; x.lineWidth = 2; x.lineCap='round';
        x.beginPath(); x.moveTo(cx-6, cy+8); x.lineTo(cx+6, cy-4); x.stroke();
        x.beginPath(); x.moveTo(cx+6, cy-4); x.lineTo(cx+2, cy-7); x.moveTo(cx+6, cy-4); x.lineTo(cx+9, cy-1); x.stroke();
      } else if (pk === 'fireball'){  // 法师: 小火球
        x.fillStyle = '#ff6b35'; x.beginPath(); x.arc(cx, cy+2, 4, 0, Math.PI*2); x.fill();
        x.fillStyle = '#ffd700'; x.beginPath(); x.arc(cx, cy+2, 2, 0, Math.PI*2); x.fill();
      } else if (pk === 'holy'){      // 牧师: 十字
        x.strokeStyle = accent; x.lineWidth = 2; x.lineCap='round';
        x.beginPath(); x.moveTo(cx, cy+3); x.lineTo(cx, cy+11); x.moveTo(cx-4, cy+7); x.lineTo(cx+4, cy+7); x.stroke();
      } else {                        // 投石兵: 小石头堆
        x.fillStyle = '#9aa0a6';
        x.beginPath(); x.arc(cx-3, cy+9, 2.5, 0, Math.PI*2); x.arc(cx+1, cy+10, 2.5, 0, Math.PI*2); x.arc(cx+4, cy+9, 2, 0, Math.PI*2); x.fill();
      }
    }
    return c;
  }

  const cache = {};
  function prerender(){
    for (const id in TYPES){
      const cfg = TYPES[id]; cache[id] = {};
      for (const tm of ['red','blue']){ const col = TC[tm].main; cache[id][tm] = { stand: paint(cfg,col,cfg.accent,'stand'), body: paint(cfg,col,cfg.accent,'body'), rag: paint(cfg,col,cfg.accent,'rag') }; }
    }
    makeGrass();
  }

  function makeGrass(){
    const size = 96;
    grassTile = document.createElement('canvas'); grassTile.width = grassTile.height = size;
    const x = grassTile.getContext('2d');
    x.fillStyle = '#96ac66'; x.fillRect(0,0,size,size);
    for (let i=0;i<size*size*0.06;i++){ x.fillStyle = Math.random()<0.5 ? '#9db570' : '#8fa660'; x.fillRect(Math.random()*size, Math.random()*size, 2, 1); }
    x.fillStyle = 'rgba(20,30,15,0.025)';
    for (let i=0;i<4;i++){ x.beginPath(); x.arc(Math.random()*size, Math.random()*size, 8+Math.random()*10, 0, Math.PI*2); x.fill(); }
    grassPat = ctx.createPattern(grassTile, 'repeat');
  }

  function minZoom(){return Math.max(.01,Math.min(cssW/(2*(C.BOUND_X+30)),cssH/(2*(C.BOUND_Y+30))));}
  function fit(){cam.x=0;cam.y=0;cam.zoom=minZoom();}
  function zoom(f){cam.zoom=W.Util.clamp(cam.zoom*f,minZoom(),3.5);}
  function resize(){ dpr = Math.min(2,window.devicePixelRatio || 1); cssW = cv.clientWidth; cssH = cv.clientHeight; cv.width = Math.round(cssW*dpr); cv.height = Math.round(cssH*dpr); if(cam)fit(); }
  function init(canvas, context, camera){ cv=canvas; ctx=context; cam=camera; resize(); new ResizeObserver(resize).observe(cv); }

  function drawCorpse(c){ const set=cache[c.typeId][c.team].rag, m=TYPES[c.typeId].radius/13; ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.angle); ctx.globalAlpha=Math.max(0,Math.min(1,c.fade/C.CORPSE_FADE))*0.6; ctx.drawImage(set,-S/2*m,-S/2*m,S*m,S*m); ctx.restore(); ctx.globalAlpha=1; }

  /** 近战武器棍(世界坐标)：沿 wangle 画固定长(range)棍+头部，随 wangle 左右摆动(不伸缩) */
  function drawWeaponStick(u, cfg){
    const hdx=Math.cos(u.angle), hdy=Math.sin(u.angle), wdx=Math.cos(u.wangle), wdy=Math.sin(u.wangle);
    const sx = u.pos.x + cfg.radius*hdx, sy = u.pos.y + cfg.radius*hdy;            // 铰链点H(圆周朝向点，固定)
    const tx = sx + cfg.range*wdx, ty = sy + cfg.range*wdy;                        // 武器末端(绕H摆动)
    const accent = cfg.accent, th = C.WEAPON_HALF_THICKNESS;
    ctx.strokeStyle = accent; ctx.lineCap='round'; ctx.lineJoin='round';
    ctx.lineWidth = (cfg.weapon==='club' || cfg.weapon==='greatsword' || cfg.weapon==='staff') ? th*1.5 : th*1.2;
    ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(tx,ty); ctx.stroke();
    ctx.fillStyle = accent;
    const px=-wdy, py=wdx;                                                          // 武器方向垂直轴
    if(cfg.weapon==='hammer'){ctx.save();ctx.translate(tx,ty);ctx.rotate(u.wangle);ctx.fillRect(-5,-8,10,16);ctx.strokeStyle='#ead9bf';ctx.lineWidth=1;ctx.strokeRect(-5,-8,10,16);ctx.restore();}
    else if(cfg.weapon==='flag'){ctx.fillStyle=TC[u.team].main;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx+px*14-wdx*5,ty+py*14-wdy*5);ctx.lineTo(tx-wdx*14,ty-wdy*14);ctx.fill();}
    else if (cfg.weapon === 'spear'){                          // 矛尖
      ctx.beginPath(); ctx.moveTo(tx+wdx*5,ty+wdy*5); ctx.lineTo(tx+px*3,ty+py*3); ctx.lineTo(tx-px*3,ty-py*3); ctx.fill();
    } else if (cfg.weapon==='sword' || cfg.weapon==='greatsword'){ // 护手+尖
      const gw = cfg.weapon==='greatsword'?4:3;
      ctx.strokeStyle = W.Util.shade(accent,-0.25); ctx.lineWidth = th*0.9;
      ctx.beginPath(); ctx.moveTo(sx+px*gw,sy+py*gw); ctx.lineTo(sx-px*gw,sy-py*gw); ctx.stroke();
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(tx,ty,th*1.1,0,Math.PI*2); ctx.fill();
    } else if (cfg.weapon==='axe'){                        // 斧头
      ctx.beginPath(); ctx.moveTo(tx+wdx*2,ty+wdy*2); ctx.lineTo(tx+px*5,ty+py*5); ctx.lineTo(tx-px*2,ty-py*2); ctx.fill();
    } else if (cfg.weapon==='staff'){                      // 法杖球
      ctx.beginPath(); ctx.arc(tx,ty,th*1.4,0,Math.PI*2); ctx.fill();
    } else {                                              // 棒头
      ctx.beginPath(); ctx.arc(tx,ty,th*1.5,0,Math.PI*2); ctx.fill();
    }
  }

  function drawUnit(u){
    const cfg = TYPES[u.typeId], set = cache[u.typeId][u.team];
    const standing = u.state === 'standing';
    const sp = standing ? set.body : set.rag, m = cfg.radius/13;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(u.pos.x, u.pos.y, cfg.radius*1.05, cfg.radius*0.55, 0, 0, Math.PI*2); ctx.fill();
    // Distinct artillery chassis and cavalry silhouette.
    if(u.typeId==='ballista'){ctx.save();ctx.translate(u.pos.x,u.pos.y);ctx.rotate(u.angle);ctx.fillStyle='#54483b';ctx.fillRect(-17,-17,30,34);ctx.fillStyle='#a78a62';ctx.fillRect(-20,-20,9,8);ctx.fillRect(-20,12,9,8);ctx.strokeStyle='#dbbd8a';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(8,-22);ctx.lineTo(18,0);ctx.lineTo(8,22);ctx.stroke();ctx.restore();}
    if(u.typeId==='lancer'||u.typeId==='mounted_archer'){ctx.save();ctx.translate(u.pos.x,u.pos.y);ctx.rotate(u.angle);ctx.fillStyle='#7c6246';ctx.beginPath();ctx.ellipse(-5,0,u.radius*1.6,u.radius*.8,0,0,Math.PI*2);ctx.fill();ctx.fillStyle='#b0946c';ctx.fillRect(7,-6,17,12);ctx.restore();}
    // 本体(旋转) + 武器(沿 angle)
    ctx.save();
    ctx.translate(u.pos.x, u.pos.y);
    ctx.rotate(u.angle);
    ctx.drawImage(sp, -S/2*m, -S/2*m, S*m, S*m);
    if (u.flashTimer > 0){ ctx.fillStyle='rgba(255,255,255,'+Math.min(0.85,u.flashTimer/0.12*0.85)+')'; ctx.beginPath(); ctx.arc(0,0,cfg.radius+2,0,Math.PI*2); ctx.fill(); }
    ctx.restore();
    if (standing && cfg.kind === 'melee' && u.wangle !== undefined) drawWeaponStick(u, cfg);
  }

  function drawProjectile(p){
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(p.pos.x,p.pos.y,2.5,0,Math.PI*2); ctx.fill();
    const ang = Math.atan2(p.vel.vy, p.vel.vx);
    ctx.save(); ctx.translate(p.pos.x, p.pos.y); ctx.rotate(ang);
    if(p.kind==='frost'){ctx.fillStyle='#b8f4ff';ctx.beginPath();ctx.moveTo(9,0);ctx.lineTo(0,-4);ctx.lineTo(-6,0);ctx.lineTo(0,4);ctx.closePath();ctx.fill();}
    else if(p.kind==='bolt'){ctx.strokeStyle='#e4c08c';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(-20,0);ctx.lineTo(12,0);ctx.stroke();ctx.fillStyle='#e4c08c';ctx.beginPath();ctx.moveTo(15,0);ctx.lineTo(6,-5);ctx.lineTo(6,5);ctx.fill();}
    else if(p.kind==='bomb'){ctx.fillStyle='#353130';ctx.beginPath();ctx.arc(0,0,6,0,Math.PI*2);ctx.fill();ctx.fillStyle='#ffd17d';ctx.beginPath();ctx.arc(5,-4,2,0,Math.PI*2);ctx.fill();}
    else if (p.kind === 'stone'){ ctx.fillStyle='#9aa0a6'; ctx.beginPath(); ctx.arc(0,0,3,0,Math.PI*2); ctx.fill(); }
    else if (p.kind === 'fireball'){ ctx.fillStyle='#ff6b35'; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); ctx.fillStyle='#ffd700'; ctx.beginPath(); ctx.arc(0,0,2.5,0,Math.PI*2); ctx.fill(); }
    else if (p.kind === 'holy'){ ctx.fillStyle='#fffacd'; ctx.beginPath(); ctx.arc(0,0,3.5,0,Math.PI*2); ctx.fill(); }
    else { ctx.strokeStyle='#3b2a1a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(-8,0); ctx.lineTo(6,0); ctx.stroke(); ctx.fillStyle='#3b2a1a'; ctx.beginPath(); ctx.moveTo(7,0); ctx.lineTo(2,-2.5); ctx.lineTo(2,2.5); ctx.fill(); }
    ctx.restore();
  }

  function drawGrid(){
    const tl=s2w(0,0), br=s2w(cssW,cssH);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1/cam.zoom; ctx.beginPath();
    for (let x=Math.floor(tl.x/64)*64; x<br.x; x+=64){ ctx.moveTo(x,tl.y); ctx.lineTo(x,br.y); }
    for (let y=Math.floor(tl.y/64)*64; y<br.y; y+=64){ ctx.moveTo(tl.x,y); ctx.lineTo(br.x,y); }
    ctx.stroke();
  }

  function drawBackground(){
    const tl=s2w(0,0), br=s2w(cssW,cssH);
    ctx.fillStyle='#b9aa7d';ctx.fillRect(tl.x,tl.y,br.x-tl.x,br.y-tl.y);
    ctx.save();W.Terrain.trace(ctx);ctx.clip();
    ctx.fillStyle=grassPat;ctx.fillRect(-C.BOUND_X,-C.BOUND_Y,C.BOUND_X*2,C.BOUND_Y*2);
    ctx.fillStyle = TC.red.glow;  ctx.fillRect(tl.x, tl.y, -tl.x, br.y-tl.y);
    ctx.fillStyle = TC.blue.glow; ctx.fillRect(0, tl.y, br.x, br.y-tl.y);
    if (cam.zoom > 0.5) drawGrid();
    ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.setLineDash([8,10]); ctx.lineWidth = 1/cam.zoom;
    ctx.beginPath(); ctx.moveTo(0, tl.y); ctx.lineTo(0, br.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();ctx.strokeStyle = '#4f6942'; ctx.lineWidth = 3/cam.zoom;                 // 地图边界
    W.Terrain.trace(ctx);ctx.stroke();
  }

  function drawGhost(){
    const st = W.Game.state, id = st.input.selectedTypeId;
    if (!id||st.input.panMode||st.input.erase||st.input.inspect) return; const wp = st.input.mouseWorld; if (!wp) return;
    const cfg = TYPES[id]; if (!cfg) return;
    if(W.Campaign?.active&&wp.x>=0){ctx.strokeStyle='#ed7869';ctx.lineWidth=2/cam.zoom;ctx.beginPath();ctx.arc(wp.x,wp.y,18,0,Math.PI*2);ctx.moveTo(wp.x-12,wp.y+12);ctx.lineTo(wp.x+12,wp.y-12);ctx.stroke();return;}
    const team = wp.x < 0 ? 'red' : 'blue';                              // 预览颜色按所在半场(左红右蓝)
    const gx = st.input.gridSnap ? Math.round(wp.x/C.GRID_SIZE)*C.GRID_SIZE : wp.x;
    const gy = st.input.gridSnap ? Math.round(wp.y/C.GRID_SIZE)*C.GRID_SIZE : wp.y;
    const offsets=W.Lab?W.Lab.formationOffsets(wp):[[0,0]];
    for(const [dx,dy] of offsets){if(dx===0&&dy===0)continue;let x=wp.x+dx,y=wp.y+dy;if(st.input.gridSnap){x=Math.round(x/C.GRID_SIZE)*C.GRID_SIZE;y=Math.round(y/C.GRID_SIZE)*C.GRID_SIZE;}const valid=W.Terrain.passable({x,y},cfg.radius)&&Math.abs(x)<C.BOUND_X-cfg.radius&&Math.abs(y)<C.BOUND_Y-cfg.radius&&(x<0)===(wp.x<0)&&!st.units.some(u=>Math.hypot(x-u.pos.x,y-u.pos.y)<u.radius+cfg.radius+2);ctx.fillStyle=valid?TC[team].glow:'#ed786940';ctx.strokeStyle=valid?'#dabc7980':'#ed7869';ctx.lineWidth=1/cam.zoom;ctx.beginPath();ctx.arc(x,y,cfg.radius+2,0,Math.PI*2);ctx.fill();ctx.stroke();}
    const sp = cache[id][team].stand, m = cfg.radius/13;
    ctx.globalAlpha = 0.5; ctx.save(); ctx.translate(gx, gy); ctx.rotate(team==='red'?0:Math.PI); ctx.drawImage(sp, -S/2*m, -S/2*m, S*m, S*m); ctx.restore(); ctx.globalAlpha = 1;
    ctx.strokeStyle = W.Terrain.passable({x:gx,y:gy},cfg.radius)&&!st.units.some(u=>Math.hypot(gx-u.pos.x,gy-u.pos.y)<u.radius+cfg.radius+2)?TC[team].main:'#ed332d'; ctx.lineWidth = 2/cam.zoom; ctx.beginPath(); ctx.arc(gx, gy, cfg.radius+6, 0, Math.PI*2); ctx.stroke();
  }

  function drawHPBars(){
    const units = W.Game.state.units;
    for (let i=0;i<units.length;i++){
      const u = units[i]; if (!u.alive || u.hp >= u.maxHp) continue;
      const cfg = TYPES[u.typeId], w = Math.max(16, cfg.radius*2.4);
      const x = u.pos.x - w/2, y = u.pos.y - cfg.radius - 12;
      ctx.fillStyle='rgba(0,0,0,0.6)'; ctx.fillRect(x-1,y-1,w+2,5);
      ctx.fillStyle=TC[u.team].main; ctx.fillRect(x,y,w*Math.max(0,u.hp/u.maxHp),3);
    }
  }

  function countTeam(team){ let n=0; const us=W.Game.state.units; for(let i=0;i<us.length;i++) if(us[i].team===team&&us[i].alive)n++; return n; }

  function drawHUD(){
    const s = W.Game.state;
    costBox(16,16,'red',s.redCost,countTeam('red'),false);
    costBox(cssW-16,16,'blue',s.blueCost,countTeam('blue'),true);
    ctx.fillStyle='rgba(0,0,0,0.5)'; rr(ctx,cssW/2-70,12,140,30,8); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='14px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(s.phase==='battle'?'⚔ 战斗中':'🛠 布阵中', cssW/2, 28);
    ctx.fillStyle='rgba(255,255,255,0.65)'; ctx.font='12px sans-serif'; ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.fillText('左键放置/拖拽连放 · 右键删除 · 滚轮缩放 · WASD平移 · G网格', cssW/2, cssH-12);
    if (s.input.selectedTypeId && s.phase==='setup'){ const cfg=TYPES[s.input.selectedTypeId]; ctx.textAlign='left'; ctx.fillStyle=TC[s.input.selectedTeam].main; ctx.fillText('已选：'+cfg.name+'（'+(s.input.selectedTeam==='red'?'红方':'蓝方')+'）'+(s.input.gridSnap?' · 网格':''), 16, cssH-12); }
  }
  function costBox(x0,y0,team,cost,count,rightAlign){
    const w=156,h=46, bx = rightAlign? x0-w : x0, col = TC[team];
    ctx.fillStyle='rgba(0,0,0,0.55)'; rr(ctx,bx,y0,w,h,8); ctx.fill();
    ctx.fillStyle=col.main; rr(ctx,bx,y0,6,h,8); ctx.fill();
    ctx.fillStyle='#fff'; ctx.font='12px sans-serif'; ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.fillText(team==='red'?'红方 RED':'蓝方 BLUE', bx+16, y0+19);
    ctx.font='bold 18px sans-serif'; ctx.fillText('💰 '+cost, bx+16, y0+40);
    ctx.textAlign='right'; ctx.font='12px sans-serif'; ctx.fillText('存活 ×'+count, bx+w-12, y0+40);
  }

  function render(){
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,cssW,cssH);
    ctx.translate(cssW/2, cssH/2); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y);
    drawBackground();
    ctx.save();W.Terrain.trace(ctx);ctx.clip();
    W.Terrain.draw(ctx); if(W.Lab)W.Lab.draw(ctx);
    for (const c of W.Game.state.corpses) drawCorpse(c);
    if (W.Game.state.phase==='setup') drawGhost();
    for (const u of W.Game.state.units){drawUnit(u);if(W.Abilities)W.Abilities.draw(ctx,u);}
    if(W.Interaction)W.Interaction.draw(ctx);
    for (const p of W.Projectiles.list) drawProjectile(p);
    W.Effects.draw(ctx);
    drawHPBars();ctx.restore();
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  W.Renderer = { minZoom, thumbnail(id,team='red'){return paint(TYPES[id],TC[team].main,TYPES[id].accent,'stand',3,16).toDataURL();}, fit, zoom, init, resize, prerender, render, s2w, get cam(){return cam;} };
})();
