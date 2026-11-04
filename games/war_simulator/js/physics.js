// physics.js —— 弹珠物理 (从原单文件拆出; 全局命名空间 W)
(function(){
  const C = W.Config.CONST;

  /** 积分：站立=推力(加法保留动量)+低摩擦+限速+组合角度(碰撞旋转+朝敌转向)；尸体=摩擦停下 */
  function integrateBody(b, dt){
    if (b.flashTimer>0) b.flashTimer -= dt;
    if (b.state === 'standing'){
      b.vel.vx += b.thrustX * dt / Math.sqrt(b.mass);
      b.vel.vy += b.thrustY * dt / Math.sqrt(b.mass);
      const cfg=W.Config.UNIT_TYPES[b.typeId];
      const sf = Math.pow(cfg.mass>2?.983:C.STAND_FRICTION, dt*60);
      b.vel.vx *= sf; b.vel.vy *= sf;
      const sp = Math.hypot(b.vel.vx, b.vel.vy), maxSp = b.moveSpeed * C.CHARGE_MULT;
      if (sp > maxSp){ const k = maxSp/sp; b.vel.vx *= k; b.vel.vy *= k; }
      if (b.spinDir !== 0){                                  // 近战：主动恒速旋转(碰撞减速→再加速，往复)
        const target = b.stunTime>0?0:b.spinDir * b.spinSpeed * (b.slowTime>0?.55:1);
        const k = 1 - Math.exp(-C.SPIN_ACCEL*dt);
        b.angularVel += (target - b.angularVel) * k;
      } else {                                               // 远程：碰撞扰动后衰减回 0
        b.angularVel *= Math.pow(C.ANG_FRICTION_STAND, dt*60);
        const turn=(cfg.turnRate||2.5)*(b.slowTime>0?.55:1);
        if(!(b.stunTime>0))b.angle+=W.Util.clamp(W.Util.normalizeAngle(b.desiredAngle-b.angle),-turn*dt,turn*dt);
      }
      b.angle += b.angularVel * dt;
    } else {
      b.vel.vx *= Math.pow(C.DRAG_FRICTION, dt*60);
      b.vel.vy *= Math.pow(C.DRAG_FRICTION, dt*60);
      b.angularVel *= Math.pow(C.ANGULAR_FRICTION, dt*60);
      b.angle += b.angularVel * dt;
    }
    b.pos.x += b.vel.vx * dt;
    b.pos.y += b.vel.vy * dt;
  }

  /** 圆-圆碰撞：Baumgarte 位置修正 + 弹性法向冲量 + 切向摩擦冲量(产生旋转) */
  function collideBodies(a, b){
    let dx = b.pos.x-a.pos.x, dy = b.pos.y-a.pos.y;
    if(dx===0&&dy===0){dx=.001*(a.id<b.id?1:-1);}
    const dist2 = dx*dx + dy*dy;
    const r = a.radius + b.radius;
    if (dist2 >= r*r || dist2 === 0) return;
    const dist = Math.sqrt(dist2);
    const nx = dx/dist, ny = dy/dist;
    const ima = 1/a.mass, imb = 1/b.mass;
    const pen = r-dist, slop=0.05, percent=1.0;              // 台球式：立即完全分离，不残留穿透(否则黏连)
    const corr = Math.max(pen-slop,0)/(ima+imb)*percent;
    a.pos.x -= nx*corr*ima; a.pos.y -= ny*corr*ima;
    b.pos.x += nx*corr*imb; b.pos.y += ny*corr*imb;
    const rvx = b.vel.vx-a.vel.vx, rvy = b.vel.vy-a.vel.vy;
    const vn = rvx*nx + rvy*ny;
    if (vn > 0) return;                                       // 已分离
    const rag = (a.state!=='standing' || b.state!=='standing');
    const ca=W.Config.UNIT_TYPES[a.typeId],cb=W.Config.UNIT_TYPES[b.typeId];
    const e = rag ? C.COLLIDE_RESTITUTION_RAG : Math.sqrt((ca.restitution??.65)*(cb.restitution??.65));
    if(W.Abilities){W.Abilities.impact(a,b,nx,ny,-vn);W.Abilities.impact(b,a,-nx,-ny,-vn);}
    const jn = -(1+e)*vn/(ima+imb);
    let Jx = jn*nx, Jy = jn*ny;
    // 切向(摩擦)冲量→角速度。盘转动惯量 I = INERTIA_FACTOR*m*r²
    const tx=-ny, ty=nx, ra=a.radius, rb=b.radius;
    const vt = rvx*tx + rvy*ty + (-b.angularVel*rb - a.angularVel*ra);
    const invMassT = (1 + 1/C.INERTIA_FACTOR) * (ima+imb);
    let jt = -vt/invMassT;
    const cap = C.COLLIDE_FRICTION * Math.abs(jn);           // Coulomb 上限
    if (jt > cap) jt = cap; else if (jt < -cap) jt = -cap;
    Jx += jt*tx; Jy += jt*ty;
    a.vel.vx -= Jx*ima; a.vel.vy -= Jy*ima;
    b.vel.vx += Jx*imb; b.vel.vy += Jy*imb;
    const Ia = C.INERTIA_FACTOR*a.mass*ra*ra, Ib = C.INERTIA_FACTOR*b.mass*rb*rb;
    const dAa=(-ra*jt)/Ia, dBb=(-rb*jt)/Ib;
    a.angularVel += dAa; b.angularVel += dBb;
    if (a.wangle !== undefined) a.wangularVel += dAa*C.WEAPON_TRANSFER;  // 铰链传武器(本体碰撞→武器跟随转)
    if (b.wangle !== undefined) b.wangularVel += dBb*C.WEAPON_TRANSFER;
  }

  /** 施加冲量(击退)：纯 2D，不升空 */
  function applyImpulse(b, jx, jy){ b.vel.vx += jx/b.mass; b.vel.vy += jy/b.mass; }

  /** 扣血，返回是否致死 */
  function applyDamage(b, dmg){
    if (!b.alive) return false;
    dmg*=b.dashTime>0?.45:1; b.hp -= dmg; b.flashTimer = 0.12;
    W.Effects.hit(b.pos.x, b.pos.y, W.Config.TEAM_COLORS[b.team].main);
    if (b.hp <= 0){ b.hp = 0; return true; }
    return false;
  }
  /** 治疗(不超过最大血量) */
  function heal(b, amt){ if(!b.alive) return; b.hp = Math.min(b.maxHp, b.hp+amt); W.Effects.heal(b.pos.x, b.pos.y); }

  /** 死亡：变尸体态 + 随机旋转 + 等待结算 */
  function kill(b){
    if (!b.alive) return;
    b.alive = false; b.hp = 0; b.state = 'dead';
    b.angularVel = W.Util.randSign() * (6 + Math.random()*8);
    b.settleTimer = C.SETTLE_TIME;
  }

  /** 点到线段最短距离 —— 武器命中检测 */
  function segCircleDist(ax,ay,bx,by, px,py){
    const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
    if (L2===0) return Math.hypot(px-ax, py-ay);
    let s = ((px-ax)*dx + (py-ay)*dy)/L2;
    if (s<0) s=0; else if (s>1) s=1;
    return Math.hypot(px-(ax+s*dx), py-(ay+s*dy));
  }

  /** 武器铰链：弱弹簧回正 + 低阻尼自由摆动(子步进)，约束±90°不穿本体 */
  function integrateWeapons(dt){
    const units = W.Game.state.units, TYPES = W.Config.UNIT_TYPES;
    const h = dt / C.WSUBSTEPS;
    for (let i=0;i<units.length;i++){
      const u = units[i];
      if (u.state !== 'standing'||u.stunTime>0) continue;
      const cfg = TYPES[u.typeId];
      if (cfg.kind !== 'melee' || u.wangle === undefined) continue;
      const WI = (cfg.weaponMass||C.WMASS) * cfg.range * cfg.range;
      const WK = C.WSPIN_OMEGA * C.WSPIN_OMEGA * C.WMASS * cfg.range * cfg.range;
      const WC = 2 * C.WSPIN_ZETA * Math.sqrt(WK * WI);
      for (let s=0;s<C.WSUBSTEPS;s++){
        const tau = WK * W.Util.normalizeAngle(u.angle - u.wangle) - WC * u.wangularVel;
        u.wangularVel += (tau / WI) * h;
        u.wangle += u.wangularVel * h;
      }
      if (u.wangularVel > 8) u.wangularVel = 8; else if (u.wangularVel < -8) u.wangularVel = -8;
      const da = W.Util.normalizeAngle(u.wangle - u.angle), lim = Math.PI/2 * 0.92;
      if (da > lim){ u.wangle = u.angle + lim; if(u.wangularVel>0) u.wangularVel *= -0.4; }
      else if (da < -lim){ u.wangle = u.angle - lim; if(u.wangularVel<0) u.wangularVel *= -0.4; }
    }
  }

  /** 武器棍碰撞：棍子线段(沿 wangle 固定长 range) 扫到本体圆→推开+敌方伤害(每目标冷却) */
  function weaponCollide(dt){
    const units = W.Game.state.units, TYPES = W.Config.UNIT_TYPES, WHT = C.WEAPON_HALF_THICKNESS;
    for (let i=0;i<units.length;i++){
      const u = units[i];
      if (u.state !== 'standing'||u.stunTime>0) continue;
      const cfg = TYPES[u.typeId];
      if (cfg.kind !== 'melee' || u.wangle === undefined) continue;
      if (u.weaponHitCd) for (const k in u.weaponHitCd){ u.weaponHitCd[k]-=dt; if(u.weaponHitCd[k]<=0) delete u.weaponHitCd[k]; }
      const hdx=Math.cos(u.angle), hdy=Math.sin(u.angle), wdx=Math.cos(u.wangle), wdy=Math.sin(u.wangle);
      const sx = u.pos.x + u.radius*hdx, sy = u.pos.y + u.radius*hdy;             // 铰链点H(圆周朝向点，固定)
      const tx = sx + cfg.range*wdx, ty = sy + cfg.range*wdy;                      // 武器末端(H沿wangle伸出)
      const wim = 1/(cfg.weaponMass||C.WMASS);
      for (let j=0;j<units.length;j++){
        const t = units[j];
        if (t===u || !t.alive || !W.Terrain.lineClear(u.pos,t.pos)) continue;
        const rr = t.radius + 10;   // 命中容差(武器摆动时仍能扫到；与视觉棍宽分开)
        const dist = segCircleDist(sx,sy,tx,ty, t.pos.x,t.pos.y);
        if (dist >= rr) continue;
        const ndx = t.pos.x - u.pos.x - u.radius*hdx - cfg.range*0.5*wdx, ndy = t.pos.y - u.pos.y - u.radius*hdy - cfg.range*0.5*wdy;
        const d = Math.hypot(ndx,ndy) || 0.001, nx = ndx/d, ny = ndy/d;        // 武器中点→本体(近似法向)
        const imb = 1/t.mass;
        const pen = Math.max((rr - dist)-0.05,0)/(wim+imb);
        t.pos.x += nx*pen*imb; t.pos.y += ny*pen*imb;                          // 推开敌方本体(武器角度由弹簧管)
        const vn = t.vel.vx*nx + t.vel.vy*ny;                                  // 武器无线速度，用敌方
        if (vn < 0){ const jn = -(1+C.WREST)*vn/imb; t.vel.vx += jn*nx*imb; t.vel.vy += jn*ny*imb; }
        if (t.team !== u.team && !(u.weaponHitCd && u.weaponHitCd[t.id])){     // 敌方+冷却→伤害
          const hx = u.pos.x - t.pos.x, hy = u.pos.y - t.pos.y;
          const frontal = (hx*Math.cos(t.angle) + hy*Math.sin(t.angle)) > 0;  // 攻击者在目标前半
          const tcfg = TYPES[t.typeId];
          let mult = 1;
          if (frontal){
            if (tcfg.special && tcfg.special.kind === 'shield') mult = 0.1;   // 盾兵正面×0.1
            else if (tcfg.helmet !== false) mult = 0.25;                       // 头盔正面×0.25
          }
          const contactSpeed=Math.hypot(u.vel.vx-t.vel.vx-u.wangularVel*cfg.range*wdy,u.vel.vy-t.vel.vy+u.wangularVel*cfg.range*wdx);
          const momentum=W.Util.clamp(.7+contactSpeed/240,.7,1.45);
          const atk = cfg.attack * (u.attackMult || 1)*momentum;                        // 狂战士rage攻击加成
          const died = applyDamage(t, atk * mult);
          applyImpulse(t, nx*cfg.knockback*momentum, ny*cfg.knockback*momentum);
          applyImpulse(u,-nx*cfg.knockback*.18,-ny*cfg.knockback*.18);
          if (died) kill(t);
          if (!u.weaponHitCd) u.weaponHitCd = Object.create(null);
          u.weaponHitCd[t.id] = cfg.attackInterval;
        }
      }
    }
  }

  /** 尸体结算：停下/超时→转尸体记录 */
  function settleDead(b, dt){
    if (b.state === 'dead'){
      b.settleTimer -= dt;
      const sp = Math.hypot(b.vel.vx, b.vel.vy);
      if (b.settleTimer <= 0 || sp < 6) b._remove = true;
    }
  }

  /** 地图边界：单位碰边界反弹 */
  function collideBounds(b){
    W.Terrain.collideBoundary(b);
  }

  /** 线段相交检测(用于武器拼刀) */
  function segIntersect(ax1,ay1,ax2,ay2, bx1,by1,bx2,by2){
    const d1x=ax2-ax1, d1y=ay2-ay1, d2x=bx2-bx1, d2y=by2-by1;
    const denom = d1x*d2y - d1y*d2x;
    if (denom === 0) return null;
    const dx=ax1-bx1, dy=ay1-by1;
    const t=(d2x*dy - d2y*dx)/denom, s=(d1x*dy - d1y*dx)/denom;
    if (t>=0&&t<=1&&s>=0&&s<=1) return {x:ax1+t*d1x, y:ay1+t*d1y};
    return null;
  }

  /** 武器拼刀：两近战武器棍相交→火花+推开双方本体+微小武器扰动(武器角度由角弹簧稳定管理确保命中) */
  function weaponVsWeapon(){
    const units=W.Game.state.units, TYPES=W.Config.UNIT_TYPES;
    const ms=[];
    for (let i=0;i<units.length;i++){ const u=units[i]; if(u.state==='standing'&&TYPES[u.typeId].kind==='melee'&&u.wangle!==undefined) ms.push(u); }
    for (let i=0;i<ms.length;i++){
      const a=ms[i], ca=TYPES[a.typeId];
      const ahx=Math.cos(a.angle), ahy=Math.sin(a.angle), awx=Math.cos(a.wangle), awy=Math.sin(a.wangle);
      const ax1=a.pos.x+a.radius*ahx, ay1=a.pos.y+a.radius*ahy, ax2=ax1+ca.range*awx, ay2=ay1+ca.range*awy;
      for (let j=i+1;j<ms.length;j++){
        const b=ms[j], cb=TYPES[b.typeId];
        const bhx=Math.cos(b.angle), bhy=Math.sin(b.angle), bwx=Math.cos(b.wangle), bwy=Math.sin(b.wangle);
        const bx1=b.pos.x+b.radius*bhx, by1=b.pos.y+b.radius*bhy, bx2=bx1+cb.range*bwx, by2=by1+cb.range*bwy;
        const P = segIntersect(ax1,ay1,ax2,ay2, bx1,by1,bx2,by2);
        if (P){
          const ddx=b.pos.x-a.pos.x, ddy=b.pos.y-a.pos.y, dd=Math.hypot(ddx,ddy)||1;
          const nx=ddx/dd, ny=ddy/dd;
          const rWAx=P.x-ax1, rWAy=P.y-ay1, rWBx=P.x-bx1, rWBy=P.y-by1;       // P到铰链H(=ax1,ay1)的力臂
          const vAx=a.vel.vx - a.angularVel*(ay1-a.pos.y) - a.wangularVel*rWAy; // P点速度(本体vel+angularVel+wangularVel)
          const vAy=a.vel.vy + a.angularVel*(ax1-a.pos.x) + a.wangularVel*rWAx;
          const vBx=b.vel.vx - b.angularVel*(by1-b.pos.y) - b.wangularVel*rWBy;
          const vBy=b.vel.vy + b.angularVel*(bx1-b.pos.x) + b.wangularVel*rWBx;
          const vn=(vBx-vAx)*nx + (vBy-vAy)*ny;
          if (vn < 0){                                                          // 相向碰撞
            const e=C.WREST;
            const rWAn=rWAx*ny-rWAy*nx, rWBn=rWBx*ny-rWBy*nx;                  // rW×n(2D叉积)
            const IwA=(ca.weaponMass||C.WMASS)*ca.range*ca.range, IwB=(cb.weaponMass||C.WMASS)*cb.range*cb.range; // 武器绕铰链惯量
            const jn=Math.min(180,-(1+e)*vn / (rWAn*rWAn/IwA + rWBn*rWBn/IwB + C.WEAPON_TRANSFER*C.WEAPON_TRANSFER*(1/a.mass+1/b.mass)));              // 含旋转有效质量的冲量
            const dWA=jn*rWAn/IwA, dWB=jn*rWBn/IwB;
            a.wangularVel -= dWA; b.wangularVel += dWB;                        // 武器被弹(主要)
            a.angularVel -= dWA*C.WEAPON_TRANSFER;                             // 铰链传本体(武器带动转)
            b.angularVel += dWB*C.WEAPON_TRANSFER;
            const t=C.WEAPON_TRANSFER;
            a.vel.vx -= jn*nx*t/a.mass; a.vel.vy -= jn*ny*t/a.mass;           // 本体被推一点
            b.vel.vx += jn*nx*t/b.mass; b.vel.vy += jn*ny*t/b.mass;
            const sep=1.5; a.pos.x-=nx*sep; a.pos.y-=ny*sep; b.pos.x+=nx*sep; b.pos.y+=ny*sep;
            W.Effects.hit(P.x, P.y, '#ffffff');                                // 拼刀火花
          }
        }
      }
    }
  }

  /** 物理主步进：积分 → 武器弹簧 → 边界 → 单位碰撞 → 地形 → 武器命中 → 拼刀 → 尸体结算 */
  function step(dt){
    const units = W.Game.state.units;
    for (let i=0;i<units.length;i++) integrateBody(units[i], dt);
    integrateWeapons(dt);                                  // 武器角弹簧(子步进)
    for (let i=0;i<units.length;i++) collideBounds(units[i]);  // 地图边界反弹
    for (let it=0; it<3; it++)                               // 多次碰撞迭代(彻底分开，台球感)
      for (let i=0;i<units.length;i++)
        for (let j=i+1;j<units.length;j++) collideBodies(units[i], units[j]);
    for (let i=0;i<units.length;i++) {W.Terrain.collideTerrain(units[i]);W.Terrain.collideBoundary(units[i]);}
    weaponCollide(dt);
    weaponVsWeapon();                                      // 武器拼刀(弹开摆动)
    const corpses = W.Game.state.corpses;
    let w = 0;
    for (let i=0;i<units.length;i++){
      const b = units[i];
      settleDead(b, dt);
      if (b._remove){
        corpses.push({ x:b.pos.x, y:b.pos.y, angle:b.angle, typeId:b.typeId, team:b.team, fade:C.CORPSE_FADE });
        if (corpses.length > C.MAX_CORPSES) corpses.shift();
      } else units[w++] = b;
    }
    units.length = w;
  }

  W.Physics = { integrateBody, integrateWeapons, collideBodies, applyImpulse, applyDamage, heal, kill, weaponCollide, step };
})();
