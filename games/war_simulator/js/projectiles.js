// projectiles.js —— 弹药 (从原单文件拆出; 全局命名空间 W)
(function(){
  const C = W.Config.CONST;
  let list = []; const pool = [];

  function spawn(owner, angle, p){
    if (list.length >= C.MAX_PROJECTILES) return;
    const pr = pool.length ? pool.pop() : {};
    pr.pos = { x: owner.pos.x + Math.cos(angle)*owner.radius, y: owner.pos.y + Math.sin(angle)*owner.radius };
    pr.vel = { vx: Math.cos(angle)*p.speed, vy: Math.sin(angle)*p.speed };
    pr.hitIds=new Set();pr.pierce=p.pierce||1;pr.slow=p.slow||0;
    if(p.recoil)W.Physics.applyImpulse(owner,-Math.cos(angle)*p.recoil,-Math.sin(angle)*p.recoil);
    pr.damage = p.damage*(owner.attackMult||1); pr.knockback = p.knockback; pr.team = owner.team; pr.kind = p.kind; pr.life = p.lifetime; pr.aoe = p.aoe || null;
    list.push(pr);
  }

  function checkHit(p){
    const units = W.Game.state.units;
    for (let i=0;i<units.length;i++){
      const u = units[i];
      if (!u.alive || u.team === p.team || p.hitIds.has(u.id)) continue;
      const dx = u.pos.x-p.pos.x, dy = u.pos.y-p.pos.y, rr = u.radius + 3;
      if (dx*dx + dy*dy < rr*rr) return u;
    }
    return null;
  }

  function onHit(p, u){
    const TYPES = W.Config.UNIT_TYPES, ang = Math.atan2(p.vel.vy, p.vel.vx);
    const ucfg = u ? TYPES[u.typeId] : {};
    let dmg = p.damage;
    if (ucfg.special && ucfg.special.kind === 'shield' && Math.cos(ang - u.angle) < 0) dmg = p.damage * 0.1;  // 盾兵正面挡
    if(p.slow && u){u.slowTime=Math.max(u.slowTime||0,p.slow);W.Effects.pulse(u.pos.x,u.pos.y,22,'#8fe3e7','霜冻');}
    const died = u && W.Physics.applyDamage(u, dmg);
    if(u)W.Physics.applyImpulse(u, Math.cos(ang)*p.knockback, Math.sin(ang)*p.knockback);
    if (died) W.Physics.kill(u);
    if (p.aoe){                                                                                                  // 法师火球爆炸(溅射无视盾)
      const R = p.aoe.radius, R2 = R*R, units = W.Game.state.units;
      W.Effects.explosion(p.pos.x, p.pos.y, R);
      for (let i=0;i<units.length;i++){
        const e = units[i];
        if (e === u || !e.alive || e.team === p.team) continue;
        const dx=e.pos.x-p.pos.x, dy=e.pos.y-p.pos.y, d2=dx*dx+dy*dy;
        if (d2 > R2) continue;
        const d=Math.sqrt(d2)||1, nx=dx/d, ny=dy/d;
        const edied = W.Physics.applyDamage(e, p.aoe.damage);
        W.Physics.applyImpulse(e, nx*p.aoe.kb, ny*p.aoe.kb);
        if (edied) W.Physics.kill(e);
      }
    }
  }

  function stepOne(p, dt){
    const speed = Math.hypot(p.vel.vx, p.vel.vy);
    let n = Math.ceil(speed*dt/5); if (n>8) n=8;
    const h = dt/n;
    for (let i=0;i<n;i++){
      const before={...p.pos};p.pos.x += p.vel.vx*h; p.pos.y += p.vel.vy*h;
      if(!W.Terrain.lineClear(before,p.pos,3)){if(p.aoe)onHit(p,null);return true;}
      const hit = checkHit(p); if (hit){p.hitIds.add(hit.id);onHit(p, hit);if(--p.pierce<=0)return true;p.damage*=.72;}
    }
    p.life -= dt; return p.life <= 0;
  }

  function step(dt){
    let w = 0;
    for (let i=0;i<list.length;i++){ const p = list[i]; const dead = stepOne(p, dt); if (!dead) list[w++] = p; else pool.push(p); }
    list.length = w;
  }
  function reset(){ for (const p of list) pool.push(p); list.length = 0; }
  W.Projectiles = { spawn, step, reset, get list(){ return list; } };
})();
