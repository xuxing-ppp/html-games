// ai.js —— 战斗AI (从原单文件拆出; 全局命名空间 W)
(function(){
  const CFG = W.Config.UNIT_TYPES, C = W.Config.CONST;

  function findNearestEnemy(u){
    const units = W.Game.state.units;
    let best = null, bd = Infinity;
    for (let i=0;i<units.length;i++){
      const t = units[i];
      if (!t.alive || t.team === u.team) continue;
      const dx = t.pos.x-u.pos.x, dy = t.pos.y-u.pos.y, d = dx*dx+dy*dy;
      if (d < bd){ bd = d; best = t; }
    }
    return best;
  }

  function rangedAttack(u, t){
    const cfg = CFG[u.typeId], p = cfg.projectile;
    const dx = t.pos.x-u.pos.x, dy = t.pos.y-u.pos.y;
    const dist = Math.hypot(dx,dy)||1;
    let tt = dist/p.speed, px = t.pos.x+t.vel.vx*tt, py = t.pos.y+t.vel.vy*tt;
    tt = Math.hypot(px-u.pos.x,py-u.pos.y)/p.speed;
    px = t.pos.x+t.vel.vx*tt; py = t.pos.y+t.vel.vy*tt;
    const ang = Math.atan2(py-u.pos.y, px-u.pos.x) + W.Util.rand(-1,1)*p.spread;
    W.Projectiles.spawn(u, ang, p);
    u.attackCooldown = cfg.attackInterval;
  }

  function update(u, dt){
    if (!u.alive || u.state !== 'standing') return;
    const cfg = CFG[u.typeId];
    u.moveSpeed = cfg.moveSpeed; u.attackMult=1;
    u.attackCooldown -= dt;
    const t = findNearestEnemy(u);
    if (cfg.special && W.Specials && W.Specials[cfg.special.kind]) W.Specials[cfg.special.kind](u, t, dt);  // special 前置(rage 覆盖 moveSpeed)
    if(W.Abilities)W.Abilities.attack(u,t,dt);
    u.moveSpeed *= W.Terrain.speedAt(u.pos);
    if(u.stunTime>0){u.thrustX=0;u.thrustY=0;return;}
    if (!t){ u.thrustX = 0; u.thrustY = 0; return; }       // 无敌：摩擦滑停
    const dx = t.pos.x-u.pos.x, dy = t.pos.y-u.pos.y, d = Math.hypot(dx,dy)||1;
    const nx = dx/d, ny = dy/d;
    u.desiredAngle = Math.atan2(dy, dx);                   // 朝敌
    const SP = u.moveSpeed * C.THRUST_SCALE;               // 用 u.moveSpeed(rage 已覆盖)
    if (cfg.kind === 'melee'){
      u.thrustX = nx*SP; u.thrustY = ny*SP;                // 冲锋(武器碰到就掉血)
    } else {
      const R = cfg.range;
      u.timeSinceLastShot += dt;
      if (d > R || !W.Terrain.lineClear(u.pos,t.pos)){ u.thrustX = nx*SP; u.thrustY = ny*SP; }                            // 靠近
      else if (d < R*C.RANGED_RETREAT_FRAC){ u.thrustX = -nx*SP*C.RANGED_RETREAT_SPEED; u.thrustY = -ny*SP*C.RANGED_RETREAT_SPEED; } // 后退
      else { u.thrustX = 0; u.thrustY = 0; }                                         // 悬停射击
      if (d <= R && u.attackCooldown <= 0 && W.Terrain.lineClear(u.pos,t.pos)){ rangedAttack(u, t); u.timeSinceLastShot = 0; }
      if (u.timeSinceLastShot > C.RANGED_STALEMATE_TIME){ u.thrustX = nx*SP; u.thrustY = ny*SP; } // 反僵局
    }
    if(W.Lab)W.Lab.steer(u);
    if(W.Terrain.maps[W.Terrain.current].outline.length>4||W.Terrain.shapes.some(s=>s.type==='rock')){
      const control=W.Lab?.controlGoal(u);
      const retreat=u.thrustX*nx+u.thrustY*ny<0;
      W.Terrain.steer(u,control|| (retreat?{x:u.pos.x-nx*180,y:u.pos.y-ny*180}:t.pos),dt);
    }
  }

  W.AI = { findNearestEnemy, update, rangedAttack };
})();
