// ai.js — SV.AI: 每种敌人行为一函数。仅写入 e.vx/e.vy(满速)与定时器,积分由 entities 完成。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const E = SV.Entities;
  const C = SV.Config.CONST;

  function toPlayer(e, p, spd) {
    const a = U.angleTo(e.x, e.y, p.x, p.y);
    e.vx = Math.cos(a) * spd; e.vy = Math.sin(a) * spd;
  }
  // Boss 弹幕/激光伤害缩放:dmgFactor(t) × bossDmgMul × endlessDmgMul
  function dmgScale(st, e) {
    const t = st.time / 60;
    const diff = SV.Config.DIFFICULTY[st.difficulty] || SV.Config.DIFFICULTY.normal;
    const em = (st.endless && st.stage) ? SV.Config.CURVES.endlessDmgMul(Math.max(0, (st.time - st.stage.goalMin) / 60)) : 1;
    const tierMul = e && e.bossType && SV.Config.BOSSES[e.bossType].tier === 3 ? SV.Config.CONST.T3_BOSS_DAMAGE_MUL : 1;
    return SV.Config.CURVES.dmgFactor(t) * (diff.bossDmgMul || diff.dmgMul) * em * tierMul;
  }
  function bossAttack(e, kind, index) {
    const def = SV.Config.BOSSES[e.bossType] || {};
    const vals = (def.attacks && def.attacks[kind]) || [0];
    return vals[Math.min(index || 0, vals.length - 1)] || 0;
  }
  function bossMech(e) { return SV.Config.BOSSES[e.bossType].mechanics; }
  function bossDiff(st) { return SV.Config.DIFFICULTY[st.difficulty] || SV.Config.DIFFICULTY.normal; }
  function bossMove(st, speed) { return speed * (bossDiff(st).bossSpeedMul || 1); }
  function bossShotSpeed(st, speed) { return speed * (bossDiff(st).bossShotSpeedMul || 1); }
  function bossInterval(st, seconds) { return seconds / (bossDiff(st).bossTempoMul || 1); }
  function predictedPoint(e, p, speed) {
    const flight = U.dist(e.x, e.y, p.x, p.y) / Math.max(1, speed);
    const leadT = Math.min(C.BOSS_AIM_LEAD_MAX_TIME, flight * C.BOSS_AIM_LEAD_FACTOR);
    let lx = (p.vx || 0) * leadT, ly = (p.vy || 0) * leadT;
    const lm = Math.hypot(lx, ly), maxLead = C.BOSS_AIM_LEAD_MAX_DIST;
    if (lm > maxLead) { lx *= maxLead / lm; ly *= maxLead / lm; }
    return { x: p.x + lx, y: p.y + ly };
  }
  function shotAngle(st, e, x, y, angle, speed, dmg, radius) {
    if (!E.canEnemyRanged(st, e)) return;
    speed = bossShotSpeed(st, speed);
    E.addEShot(st, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
      dmg * dmgScale(st, e), e.color, radius || 6, e.bossType);
  }
  function aimedFrom(st, e, x, y, tx, ty, count, spread, speed, dmg) {
    const angle = U.angleTo(x, y, tx, ty);
    for (let i = 0; i < count; i++) shotAngle(st, e, x, y, angle + (i - (count - 1) / 2) * spread, speed, dmg, 6);
  }
  function setFlankOrigins(st, e, angle, distance) {
    const edge = Math.max(0, ((st.stage && st.stage.half) || 2000) - 8);
    const dx = Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
    e.flankAX = U.clamp(e.markX - dx, -edge, edge); e.flankAY = U.clamp(e.markY - dy, -edge, edge);
    e.flankBX = U.clamp(e.markX + dx, -edge, edge); e.flankBY = U.clamp(e.markY + dy, -edge, edge);
  }
  function ensureFlankOrigins(st, e, angle, distance) {
    if (![e.flankAX, e.flankAY, e.flankBX, e.flankBY].every(Number.isFinite)) setFlankOrigins(st, e, angle, distance);
  }
  function safePointAroundPlayer(st, p, radius) {
    const edge = Math.max(0, ((st.stage && st.stage.half) || 2000) - 20), start = U.rand(0, U.TAU);
    let best = null, bestD = -1;
    for (let i = 0; i < 8; i++) {
      const a = start + i * U.TAU / 8;
      const x = U.clamp(p.x + Math.cos(a) * radius, -edge, edge), y = U.clamp(p.y + Math.sin(a) * radius, -edge, edge);
      const d = U.dist2(p.x, p.y, x, y);
      if (d > bestD) { bestD = d; best = { x: x, y: y }; }
    }
    return best;
  }
  function attackPulse(e, x, y, radius) {
    SV.Effects.ring(x, y, e.color, 6, radius, 0.3, 3);
    SV.Effects.hit(x, y, e.color);
  }
  function laserRay(st, e, angle, length, width, damage) {
    if (!E.canEnemyRanged(st, e)) return;
    const dx = Math.cos(angle), dy = Math.sin(angle), p = st.player;
    const px = p.x - e.x, py = p.y - e.y;
    const along = px * dx + py * dy;
    const side = Math.abs(-py * dx + px * dy);
    if (along > 0 && along < length && side < width + p.r) E.damagePlayer(st, damage * dmgScale(st, e), false, e.bossType);
    SV.Weapons.beams.push({ pts: [[e.x, e.y], [e.x + dx * length, e.y + dy * length]], life: 0.08, max: 0.08, color: e.color, width: width * 2, visualStyle: "laser" });
  }
  function eclipseRing(st, e, gapAngle) {
    const m = bossMech(e), count = m.ringShots, dmg = bossAttack(e, "projectile", 1);
    for (let i = 0; i < count; i++) {
      const angle = i * U.TAU / count;
      if (Math.abs(Math.atan2(Math.sin(angle - gapAngle), Math.cos(angle - gapAngle))) < m.gapHalf) continue;
      shotAngle(st, e, e.x, e.y, angle, m.ringSpeed, dmg, 7);
    }
    attackPulse(e, e.x, e.y, 115);
  }

  const Beh = {
    chase: function (e, p, dt) { toPlayer(e, p, e.speed); },
    tank: function (e, p, dt) { toPlayer(e, p, e.speed); },
    fast: function (e, p, dt) {
      const a = U.angleTo(e.x, e.y, p.x, p.y);
      const sway = Math.sin((e.t1 += dt) * 6) * 0.5;
      const ca = Math.cos(a + sway), sa = Math.sin(a + sway);
      e.vx = ca * e.speed; e.vy = sa * e.speed;
    },
    shooter: function (e, p, dt) {
      const def = SV.Config.ENEMIES.shooter;
      if (e.cstate === "shot_warn") {
        e.vx = 0; e.vy = 0; e.ct -= dt; e.flash = 0.12;
        if (e.ct <= 0) {
          const spd = def.shotSpeed;
          if (E.canEnemyRanged(SV.Game.state, e)) E.addEShot(SV.Game.state, e.x, e.y, Math.cos(e.cdir) * spd, Math.sin(e.cdir) * spd, e.projDmg, e.color, 6, "shooter");
          e.cstate = "walk"; e.t1 = def.shotInterval;
        }
        return;
      }
      const d = U.dist(e.x, e.y, p.x, p.y);
      const a = U.angleTo(e.x, e.y, p.x, p.y);
      // 随机选向,每 0.6-1.2s 换一次(打破"纯切向同款")
      e.t2 -= dt;
      if (e.t2 <= 0) { e.t2 = U.rand(0.6, 1.2); e.cdir = a + U.rand(-Math.PI * 0.7, Math.PI * 0.7); }
      let ang = e.cdir;
      const minRange = e.architectTurret ? SV.Config.BOSSES.architect.mechanics.turretMinRange : 140;
      const maxRange = e.architectTurret ? SV.Config.BOSSES.architect.mechanics.turretMaxRange : 260;
      if (d > maxRange) ang = a;                 // 太远:靠近
      else if (d < minRange) ang = a + Math.PI;  // 太近:退
      e.vx = Math.cos(ang) * e.speed; e.vy = Math.sin(ang) * e.speed;
      e.t1 -= dt;
      if (e.t1 <= 0 && d < (e.architectTurret ? maxRange + 80 : def.shotRange)) {
        e.cstate = "shot_warn"; e.ct = e.architectTurret ? SV.Config.BOSSES.architect.mechanics.turretWarn : def.shotWarn; e.cdir = a;
      }
    },
    bomber: function (e, p, dt) {
      toPlayer(e, p, e.speed);
      if (U.dist2(e.x, e.y, p.x, p.y) < (e.aoe + p.r) * (e.aoe + p.r)) {
        e.hp = 0; // 触发爆炸(killEnemy 结算 AOE)
      }
    },
    spawner: function (e, p, dt) {
      e.vx = 0; e.vy = 0;
      e.t1 -= dt;
      if (e.t1 <= 0) {
        e.t1 = 4;
        for (let i = 0; i < 3; i++) { const a = U.rand(0, U.TAU); E.addEnemy(SV.Game.state, "swarmer", e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18); }
      }
    },
    charger: function (e, p, dt) {
      const def = SV.Config.ENEMIES.charger;
      if (e.cstate === "walk") {
        toPlayer(e, p, e.speed);
        e.ct -= dt;
        if (e.ct <= 0) { e.cstate = "tele"; e.teleT = 0.7; e.cdir = U.angleTo(e.x, e.y, p.x, p.y); }
      } else if (e.cstate === "tele") {
        e.vx = 0; e.vy = 0;
        e.teleT -= dt;
        e.flash = (Math.floor(Math.max(0, e.teleT) * 18) % 2 === 0) ? 0.2 : 0.04; // 高频白闪预警
        if (e.teleT <= 0) { e.cstate = "charge"; e.chargeT = 0.6; }
      } else if (e.cstate === "charge") {
        e.vx = Math.cos(e.cdir) * def.chargeSpeed; e.vy = Math.sin(e.cdir) * def.chargeSpeed;
        e.chargeT -= dt;
        if (e.chargeT <= 0) { e.cstate = "cool"; e.coolT = 1.4; }
      } else { // cool
        e.vx = 0; e.vy = 0; e.coolT -= dt;
        if (e.coolT <= 0) { e.cstate = "walk"; e.ct = U.rand(0.4, 1.2); }
      }
    },
    flee: function (e, p, dt) {
      const d = U.dist(e.x, e.y, p.x, p.y);
      if (d < 360) { const a = U.angleTo(p.x, p.y, e.x, e.y); e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed; }
      else { e.vx *= 0.9; e.vy *= 0.9; }
    },
    wander: function (e, p, dt) {
      // 快速随机游走(ghost 高价值目标用):近身侧闪、中距背离、远距自由游走
      e.t1 -= dt;
      if (e.t1 <= 0) { e.t1 = U.rand(0.6, 1.4); e.cdir = U.rand(0, U.TAU); }
      const d = U.dist(e.x, e.y, p.x, p.y);
      let ang = e.cdir;
      if (d < 90) ang = U.angleTo(p.x, p.y, e.x, e.y) + U.rand(-0.5, 0.5);
      else if (d < 240) ang = U.angleTo(e.x, e.y, p.x, p.y) + Math.PI;
      e.vx = Math.cos(ang) * e.speed; e.vy = Math.sin(ang) * e.speed;
    },
    blink: function (e, p, dt) {
      if (e.blinkWarn > 0) {
        toPlayer(e, p, e.speed * 0.18);
        e.blinkWarn -= dt;
        e.flash = (Math.floor(e.blinkWarn * 20) % 2 === 0) ? 0.2 : 0.04;
        if (e.blinkWarn <= 0) {
          e.x = e.blinkX; e.y = e.blinkY;
          e.blinkWarn = 0;
          e.t1 = U.rand(C.BLINK_PERIOD_MIN, C.BLINK_PERIOD_MAX) - C.BLINK_WARN;
          e.flash = 0.2; SV.Effects.hit(e.x, e.y, e.color);
        }
        return;
      }
      toPlayer(e, p, e.speed);
      e.t1 -= dt;
      if (e.t1 <= 0) {
        const a = U.angleTo(e.x, e.y, p.x, p.y);
        const d = Math.max(0, Math.min(C.BLINK_DISTANCE, U.dist(e.x, e.y, p.x, p.y) - C.BLINK_GAP));
        e.blinkX = e.x + Math.cos(a) * d; e.blinkY = e.y + Math.sin(a) * d;
        e.blinkWarn = C.BLINK_WARN;
      }
    },
    splitter: function (e, p, dt) { toPlayer(e, p, e.speed); }, // 死亡分裂由 killEnemy 处理
    shield: function (e, p, dt) { toPlayer(e, p, e.speed); },   // 减伤由 e.dr 在 damageEnemy 处理
    sniper: function (e, p, dt) {
      const def = SV.Config.ENEMIES.sniper;
      if (e.cstate === "sniper_warn") {
        e.vx = 0; e.vy = 0; e.ct -= dt; e.flash = 0.16;
        if (e.ct <= 0) {
          if (E.canEnemyRanged(SV.Game.state, e)) E.addEShot(SV.Game.state, e.x, e.y, Math.cos(e.cdir) * def.shotSpeed, Math.sin(e.cdir) * def.shotSpeed, e.projDmg, e.color, 7, "sniper");
          e.cstate = "walk"; e.t1 = def.shotInterval;
        }
        return;
      }
      const d = U.dist(e.x, e.y, p.x, p.y);
      const a = U.angleTo(e.x, e.y, p.x, p.y);
      // 更站桩:sweet spot 内强阻尼,仅距离极不适配时挪动
      if (d < 280) { e.vx = -Math.cos(a) * e.speed * 0.6; e.vy = -Math.sin(a) * e.speed * 0.6; }
      else if (d > 420) { e.vx = Math.cos(a) * e.speed * 0.6; e.vy = Math.sin(a) * e.speed * 0.6; }
      else { e.vx *= 0.82; e.vy *= 0.82; }
      e.t1 -= dt;
      if (e.t1 <= 0 && d < def.shotRange) { e.cstate = "sniper_warn"; e.ct = def.shotWarn; e.cdir = a; }
    },
    regen: function (e, p, dt) {
      toPlayer(e, p, e.speed);
      // 自愈者回血随时间成长(同敌人 maxHP 因子);SV.Game.state 为本文件既有取 state 模式。
      if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.regenRate * SV.Entities.healScale(SV.Game.state) * dt);
    },
    shield_aura: function (e, p, dt) { toPlayer(e, p, e.speed); }, // 护盾光环效果在 tickAuras 处理
    heal_aura: function (e, p, dt) { toPlayer(e, p, e.speed); },   // 回血光环效果在 tickAuras 处理
    speed_aura: function (e, p, dt) { toPlayer(e, p, e.speed); },  // 加速光环效果在 tickAuras 处理
    stalker: function (e, p, dt) {
      // 潜伏者:隐身接近 → 近身现身 → 短暂突袭冲刺
      const d = U.dist(e.x, e.y, p.x, p.y);
      if (!e.revealed) {
        toPlayer(e, p, e.speed);
        if (d < 70) { e.revealed = true; e.flash = 0.3; SV.Effects.hit(e.x, e.y, e.color); }
      } else {
        if (e._lungeT == null) e._lungeT = 0.6;
        e._lungeT -= dt;
        toPlayer(e, p, e._lungeT > 0 ? e.speed * 1.8 : e.speed);
      }
    },
    slime: function (e, p, dt) {
      // 腐泥:摇摆追击；同一只腐泥的采样点归入一条连续毒径，避免密集圆斑和重叠伤害。
      const a = U.angleTo(e.x, e.y, p.x, p.y);
      const wob = Math.sin((e.t1 += dt) * 3) * 0.6;
      e.vx = Math.cos(a + wob) * e.speed; e.vy = Math.sin(a + wob) * e.speed;
      e.t2 -= dt;
      if (e.t2 <= 0) {
        e.t2 = e.trailInterval;
        const st = SV.Game.state;
        if (st.hazards) {
          let trail = null;
          for (let i = st.hazards.length - 1; i >= 0; i--) {
            const h = st.hazards[i];
            if (h.kind === "poisonTrail" && h.ownerId === e.id) { trail = h; break; }
          }
          if (!trail && st.hazards.length < SV.Config.CONST.MAX_HAZARDS) {
            trail = { x:e.x, y:e.y, r:16, dmg:e.trailDmg*0.5, color:e.color, kind:"poisonTrail", tick:0, ownerId:e.id, points:[], srcType:"slime" };
            st.hazards.push(trail);
          }
          if (trail) {
            trail.x=e.x; trail.y=e.y; trail.points.push({ x:e.x, y:e.y, life:e.trailDur, max:e.trailDur });
          }
        }
      }
    },
    boss: function (e, p, dt) {
      const st = SV.Game.state;
      if (e.bossType === "duke") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0) { e.t1 = bossInterval(st, m.summonInterval); for (let i = 0; i < m.summonCount; i++) { const a = U.rand(0, U.TAU); E.addEnemy(st, "zombie", e.x + Math.cos(a) * 24, e.y + Math.sin(a) * 24); } }
        if (e.t2 <= 0) {
          e.t2 = bossInterval(st, m.ringInterval);
          spiralBurst(st, e, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 0), 7);
          aimedSpread(st, e, p, 1, 0, m.seamSpeed, bossAttack(e, "projectile", 1), true);
        }
      } else if (e.bossType === "wraith") {
        const m = bossMech(e);
        const enraged = !!e.enrage;
        const R = m.orbitRadius, sp = m.orbitRate * (enraged ? m.enragedOrbitMul : 1);
        e.cdir += sp * dt;
        const tx = p.x + Math.cos(e.cdir) * R, ty = p.y + Math.sin(e.cdir) * R;
        const a = U.angleTo(e.x, e.y, tx, ty);
        const moveSpeed = bossMove(st, e.speed);
        e.vx = Math.cos(a) * moveSpeed; e.vy = Math.sin(a) * moveSpeed;
        e.t1 -= dt;
        if (e.t1 <= 0) { e.t1 = bossInterval(st, enraged ? m.enragedInterval : m.attackInterval); aimedSpread(st, e, p, 3, 0.32, m.shotSpeed, bossAttack(e, "projectile", 0), true); }
        if (enraged) {
          e.t3 = (e.t3 || 0) - dt;
          if (e.t3 <= 0) { e.t3 = bossInterval(st, m.enrageRingInterval); spiralBurst(st, e, m.enrageRingShots, m.enrageRingSpeed, bossAttack(e, "projectile", 0), 6); }
        }
      } else if (e.bossType === "scavenger") {
        // 短程预警冲刺:锁定玩家当时的位置,冲完后停顿供反击。
        const m = bossMech(e);
        e.t1 -= dt;
        if (e.cstate === "tele") {
          e.vx = 0; e.vy = 0; e.ct -= dt; e.flash = 0.18;
          if (e.ct <= 0) { e.cstate = "charge"; e.ct = m.chargeDuration; }
        } else if (e.cstate === "charge") {
          const chargeSpeed = bossMove(st, m.chargeSpeed);
          e.vx = Math.cos(e.cdir) * chargeSpeed; e.vy = Math.sin(e.cdir) * chargeSpeed;
          e.ct -= dt;
          if (e.ct <= 0) {
            for (let i = 0; i < m.exitShots; i++) shotAngle(st, e, e.x, e.y, e.cdir + (i - (m.exitShots - 1) / 2) * m.exitSpread, m.shotSpeed, bossAttack(e, "projectile", 0));
            attackPulse(e, e.x, e.y, 55);
            e.cstate = "cool"; e.ct = m.recovery;
          }
        } else if (e.cstate === "cool") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) e.cstate = "walk";
        } else {
          toPlayer(e, p, bossMove(st, e.speed));
          if (e.t1 <= 0) { const q = predictedPoint(e, p, m.chargeSpeed); e.t1 = bossInterval(st, m.interval); e.cdir = U.angleTo(e.x, e.y, q.x, q.y); e.cstate = "tele"; e.ct = m.warn; }
        }
      } else if (e.bossType === "frostwarden") {
        const m = bossMech(e);
        if (e.cstate === "ice_warn" || e.cstate === "ice_beam" || e.cstate === "ice_follow") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0 && e.cstate === "ice_warn") {
            attackPulse(e, e.x, e.y, 55);
            e.cstate = "ice_beam"; e.ct = m.beamDuration;
          } else if (e.cstate === "ice_beam") {
            laserRay(st, e, e.cdir - m.flankAngle, m.beamLength, m.beamWidth, bossAttack(e, "laser", 0));
            laserRay(st, e, e.cdir + m.flankAngle, m.beamLength, m.beamWidth, bossAttack(e, "laser", 0));
            if (e.ct <= 0) { e.cstate = "ice_follow"; e.ct = m.follow; }
          } else if (e.ct <= 0) {
            shotAngle(st, e, e.x, e.y, U.angleTo(e.x, e.y, e.markX, e.markY), m.centerSpeed, bossAttack(e, "projectile", 0));
            attackPulse(e, e.x, e.y, 38);
            e.cstate = "walk"; e.t1 = bossInterval(st, m.interval);
          }
        } else {
          toPlayer(e, p, bossMove(st, e.speed)); e.t1 -= dt;
          if (e.t1 <= 0) {
            const q = predictedPoint(e, p, m.centerSpeed);
            e.cstate = "ice_warn"; e.ct = m.warn; e.markX = q.x; e.markY = q.y; e.cdir = U.angleTo(e.x, e.y, q.x, q.y);
          }
        }
      } else if (e.bossType === "bloodhunter") {
        const m = bossMech(e);
        const a = U.angleTo(e.x, e.y, p.x, p.y), d = U.dist(e.x, e.y, p.x, p.y);
        const move = d > m.range ? a : a + Math.PI / 2 + Math.sin((e.t3 = (e.t3 || 0) + dt * m.swayRate)) * m.swayAngle;
        const moveSpeed = bossMove(st, e.speed);
        e.vx = Math.cos(move) * moveSpeed; e.vy = Math.sin(move) * moveSpeed;
        if (e.cstate === "blood_mark") {
          ensureFlankOrigins(st, e, e.cdir, m.flankDist);
          e.ct -= dt;
          if (e.ct <= 0) {
            for (const [x, y] of [[e.flankAX, e.flankAY], [e.flankBX, e.flankBY]]) {
              aimedFrom(st, e, x, y, e.markX, e.markY, 2, m.spread, m.shotSpeed, bossAttack(e, "projectile", 0));
              attackPulse(e, x, y, 30);
            }
            e.cstate = "walk"; e.t1 = bossInterval(st, m.interval);
          }
        } else {
          e.t1 -= dt;
          if (e.t1 <= 0) {
            e.cstate = "blood_mark"; e.ct = m.warn; e.markX = p.x; e.markY = p.y;
            e.cdir = U.angleTo(e.x, e.y, p.x, p.y) + Math.PI / 2;
            setFlankOrigins(st, e, e.cdir, m.flankDist);
          }
        }
      } else if (e.bossType === "riftsentry") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        if (e.cstate === "rift_open") {
          ensureFlankOrigins(st, e, e.cdir, m.portalDist);
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) {
            for (const [x, y] of [[e.flankAX, e.flankAY], [e.flankBX, e.flankBY]]) {
              aimedFrom(st, e, x, y, e.markX, e.markY, 2, m.spread, m.shotSpeed, bossAttack(e, "projectile", 0));
              attackPulse(e, x, y, 42);
            }
            e.cstate = "walk"; e.t1 = bossInterval(st, m.interval);
          }
        } else {
          e.t1 -= dt;
          if (e.t1 <= 0) {
            e.cstate = "rift_open"; e.ct = m.warn; e.cdir += Math.PI / 2; e.markX = p.x; e.markY = p.y;
            setFlankOrigins(st, e, e.cdir, m.portalDist);
          }
        }
      } else if (e.bossType === "thornwarden") {
        const m = bossMech(e);
        if (e.cstate === "tele") {
          e.vx = 0; e.vy = 0; e.ct -= dt; e.flash = 0.15;
          if (e.ct <= 0) {
            for (let i = -1; i <= 1; i++) shotAngle(st, e, e.x, e.y, e.cdir + i * m.spread, m.shotSpeed, bossAttack(e, "projectile", 0));
            attackPulse(e, e.x, e.y, 68);
            e.dr = 0; e.cstate = "thorn_cool"; e.ct = m.recovery;
          }
        } else if (e.cstate === "thorn_cool") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) { e.cstate = "walk"; e.t1 = bossInterval(st, m.interval); }
        } else {
          toPlayer(e, p, bossMove(st, e.speed));
          e.t1 -= dt;
          if (e.t1 <= 0) { const q = predictedPoint(e, p, m.shotSpeed); e.cstate = "tele"; e.ct = m.warn; e.cdir = U.angleTo(e.x, e.y, q.x, q.y); e.dr = m.armor; }
        }
      } else if (e.bossType === "stormherald") {
        const m = bossMech(e);
        const a = U.angleTo(e.x, e.y, p.x, p.y), d = U.dist(e.x, e.y, p.x, p.y);
        const move = d > m.range ? a : a + Math.PI / 2;
        const moveSpeed = bossMove(st, e.speed);
        e.vx = Math.cos(move) * moveSpeed; e.vy = Math.sin(move) * moveSpeed;
        if (e.cstate === "storm_warn") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) { e.cstate = "storm_sweep"; e.ct = m.sweep; e.t2 = 0; }
        } else if (e.cstate === "storm_sweep") {
          e.ct -= dt; e.t2 -= dt;
          if (e.t2 <= 0 && e.ct > 0) {
            e.t2 = bossInterval(st, m.shotInterval);
            shotAngle(st, e, e.x, e.y, e.cdir + e.sweepDir * (m.sweep - e.ct) * m.sweepAngle / m.sweep, m.shotSpeed, bossAttack(e, "projectile", 0));
          }
          if (e.ct <= 0) { e.cstate = "walk"; e.t1 = bossInterval(st, m.interval); }
        } else {
          e.t1 -= dt;
          if (e.t1 <= 0) {
            const rx = p.x - e.x, ry = p.y - e.y, tangent = rx * (p.vy || 0) - ry * (p.vx || 0);
            e.sweepDir = tangent < 0 ? -1 : 1;
            e.cdir = a - e.sweepDir * m.sweepAngle * 0.18;
            e.cstate = "storm_warn"; e.ct = m.warn;
          }
        }
      } else if (e.bossType === "bloodoracle") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        if (e.cstate === "ritual") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) {
            for (const id of e.ritualMinionIds || []) {
              const o = st.enemies.find(function (other) { return other.id === id && other.hp > 0; });
              if (o) { aimedFrom(st, e, o.x, o.y, p.x, p.y, m.ritualShots, m.ritualSpread, m.shotSpeed, bossAttack(e, "projectile", 0)); attackPulse(e, o.x, o.y, 45); }
            }
            e.ritualMinionIds = null; e.cstate = "walk"; e.t2 = bossInterval(st, m.ritualInterval);
          }
        } else {
          e.t1 -= dt; e.t2 -= dt;
          if (e.t1 <= 0) { e.t1 = bossInterval(st, m.boltInterval); aimedSpread(st, e, p, m.boltShots, m.boltSpread, m.shotSpeed, bossAttack(e, "projectile", 0), true); }
          if (e.t2 <= 0) {
            e.cstate = "ritual"; e.ct = m.ritualWarn; e.ritualMinionIds = [];
            if (st.enemies.length < C.MAX_ENEMIES - 2) for (let i = 0; i < 2; i++) {
              const o = E.addEnemy(st, "runner", e.x + (i ? 32 : -32), e.y + 24);
              if (o) e.ritualMinionIds.push(o.id);
            }
          }
        }
      } else if (e.bossType === "furnace") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0) { e.t1 = bossInterval(st, m.ringInterval); spiralBurst(st, e, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 0), 7); }
        if (e.t2 <= 0) {
          e.t2 = bossInterval(st, m.hazardInterval);
          const leadX = p.x + (p.vx || 0) * 0.45, leadY = p.y + (p.vy || 0) * 0.45;
          const side = U.angleTo(e.x, e.y, leadX, leadY) + Math.PI / 2;
          for (let i = 0; i < m.hazardCount && st.hazards.length < C.MAX_HAZARDS; i++) {
            const sign = i % 2 ? 1 : -1, band = Math.floor(i / 2) + 1;
            const x = leadX + Math.cos(side) * m.hazardOffset * sign * band;
            const y = leadY + Math.sin(side) * m.hazardOffset * sign * band;
            st.hazards.push({ x: x, y: y, r: m.hazardRadius, dmg: bossAttack(e, "projectile", 0) * dmgScale(st, e), life: m.hazardDuration, max: m.hazardDuration, color: e.color, kind: "burn", tick: 0.5, warm: m.hazardWarm, srcType: e.bossType });
          }
        }
      } else if (e.bossType === "voidseer") {
        const m = bossMech(e);
        if (e.cstate === "seer_warn" || e.cstate === "seer_echo") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0 && e.cstate === "seer_warn") {
            e.echoX = e.x; e.echoY = e.y;
            e.x = e.markX; e.y = e.markY; e.flash = 0.3;
            SV.Effects.hit(e.x, e.y, e.color);
            ringFrom(st, e.x, e.y, m.arrivalShots, m.arrivalSpeed, bossAttack(e, "projectile", 0), e.color, 6, "voidseer", e);
            e.cstate = "seer_echo"; e.ct = m.echoDelay;
          } else if (e.ct <= 0) {
            for (let i = 0; i < m.echoShots; i++) shotAngle(st, e, e.echoX, e.echoY, Math.PI / 4 + i * U.TAU / m.echoShots, m.echoSpeed, bossAttack(e, "projectile", 0));
            attackPulse(e, e.echoX, e.echoY, 75);
            e.cstate = "walk"; e.t1 = bossInterval(st, m.interval);
          }
        } else {
          toPlayer(e, p, bossMove(st, e.speed));
          e.t1 -= dt; e.t2 -= dt;
          if (e.t1 <= 0) {
            const a = U.rand(0, U.TAU);
            const edge = ((st.stage && st.stage.half) || 2000) - e.r;
            e.markX = U.clamp(p.x + Math.cos(a) * m.teleportDist, -edge, edge);
            e.markY = U.clamp(p.y + Math.sin(a) * m.teleportDist, -edge, edge);
            e.cstate = "seer_warn"; e.ct = m.warn;
          }
          if (e.t2 <= 0) { e.t2 = bossInterval(st, m.boltInterval); aimedSpread(st, e, p, m.boltShots, m.boltSpread, m.boltSpeed, bossAttack(e, "projectile", 0), true); }
        }
      } else if (e.bossType === "eclipseeye") {
        const m = bossMech(e);
        e.cdir += m.orbitSpeed * dt;
        const tx = p.x + Math.cos(e.cdir) * m.orbitRadius, ty = p.y + Math.sin(e.cdir) * m.orbitRadius;
        const a = U.angleTo(e.x, e.y, tx, ty);
        const moveSpeed = bossMove(st, e.speed);
        e.vx = Math.cos(a) * moveSpeed; e.vy = Math.sin(a) * moveSpeed;
        if (e.cstate === "eclipse_charge" || e.cstate === "eclipse_second") {
          e.ct -= dt;
          if (e.ct <= 0 && e.cstate === "eclipse_charge") {
            eclipseRing(st, e, e.gapAngle);
            e.cstate = "eclipse_second"; e.ct = m.secondDelay;
          } else if (e.ct <= 0) {
            eclipseRing(st, e, e.gapAngle);
            e.cstate = "walk"; e.t1 = bossInterval(st, m.interval);
          }
        } else {
          e.t1 -= dt; e.t2 -= dt;
          if (e.t1 <= 0) { e.cstate = "eclipse_charge"; e.ct = m.warn; e.gapAngle = U.angleTo(e.x, e.y, p.x, p.y) + Math.PI / 3; }
          if (e.t2 <= 0) { e.t2 = bossInterval(st, m.boltInterval); aimedSpread(st, e, p, m.boltShots, m.boltSpread, m.boltSpeed, bossAttack(e, "projectile", 0), true); }
        }
      } else if (e.bossType === "architect") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0) { e.t1 = bossInterval(st, m.ringInterval); spiralBurst(st, e, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 1), 7); }
        if (e.t2 <= 0) {
          let turrets = 0; for (let i = 0; i < st.enemies.length; i++) if (st.enemies[i].architectTurret) turrets++;
          if (turrets < m.turretMax) {
            e.t2 = bossInterval(st, m.turretInterval);
            const q = safePointAroundPlayer(st, p, m.turretSpawnDist), turret = E.addEnemy(st, "shooter", q.x, q.y);
            if (turret) { turret.architectTurret = true; turret.t1 = 0; }
          }
          else e.t2 = bossInterval(st, 3);
        }
        // 玩家两侧离体弹环:先固定并展示两个远距来源,预警结束后才开火。
        if (e.cstate === "architect_warn") {
          e.ct -= dt;
          if (e.ct <= 0) {
            const d = bossAttack(e, "projectile", 0);
            ringFrom(st, e.flankAX, e.flankAY, m.offsetShots, m.offsetSpeed, d, e.color, 6, "architect", e);
            ringFrom(st, e.flankBX, e.flankBY, m.offsetShots, m.offsetSpeed, d, e.color, 6, "architect", e);
            e.cstate = "walk"; e.t3 = bossInterval(st, m.offsetInterval);
          }
        } else {
          e.t3 = (e.t3 || 0) - dt;
          if (e.t3 <= 0) {
          const side = U.angleTo(e.x, e.y, p.x, p.y) + Math.PI / 2, sx = Math.cos(side) * m.offsetDist, sy = Math.sin(side) * m.offsetDist;
          const edge = Math.max(0, ((st.stage && st.stage.half) || 2000) - 8);
            e.flankAX = U.clamp(p.x - sx, -edge, edge); e.flankAY = U.clamp(p.y - sy, -edge, edge);
            e.flankBX = U.clamp(p.x + sx, -edge, edge); e.flankBY = U.clamp(p.y + sy, -edge, edge);
            e.cstate = "architect_warn"; e.ct = m.offsetWarn;
          }
        }
      } else if (e.bossType === "queen") {
        const m = bossMech(e);
        toPlayer(e, p, bossMove(st, e.speed));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0) { e.t1 = bossInterval(st, m.summonInterval); for (let i = 0; i < m.summonCount; i++) { const a = U.rand(0, U.TAU); E.addEnemy(st, "swarmer", e.x + Math.cos(a) * 22, e.y + Math.sin(a) * 22); } }
        if (e.t2 <= 0) {
          e.t2 = bossInterval(st, m.ringInterval);
          spiralBurst(st, e, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 0), 6);
          aimedSpread(st, e, p, m.aimedShots, m.aimedSpread, m.aimedSpeed, bossAttack(e, "projectile", 1), true);
        }
      } else if (e.bossType === "inquisitor") {
        const m = bossMech(e);
        if (e.cstate === "judge_warn") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) {
            e.x = e.markX; e.y = e.markY; e.flash = 0.25; SV.Effects.hit(e.x, e.y, e.color);
            ringFrom(st, e.echoX, e.echoY, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 1), e.color, 6, "inquisitor", e);
            ringFrom(st, e.x, e.y, m.arrivalShots, m.arrivalSpeed, bossAttack(e, "projectile", 1), e.color, 7, "inquisitor", e);
            e.cstate = "walk";
          }
          return;
        }
        e.t1 -= dt; e.t2 -= dt;
        const d = U.dist(e.x, e.y, p.x, p.y);
        const a = U.angleTo(e.x, e.y, p.x, p.y);
        const moveSpeed = bossMove(st, e.speed);
        if (d > 320) { e.vx = Math.cos(a) * moveSpeed; e.vy = Math.sin(a) * moveSpeed; }
        else if (d < 200) { e.vx = -Math.cos(a) * moveSpeed; e.vy = -Math.sin(a) * moveSpeed; }
        else { e.vx *= 0.9; e.vy *= 0.9; }
        if (e.t1 <= 0) {
          e.t1 = bossInterval(st, U.rand(m.teleportMin, m.teleportMax));
          const ta = U.rand(0, U.TAU), edge = ((st.stage && st.stage.half) || 2000) - e.r;
          e.echoX = e.x; e.echoY = e.y;
          e.markX = U.clamp(p.x + Math.cos(ta) * m.teleportDist, -edge, edge);
          e.markY = U.clamp(p.y + Math.sin(ta) * m.teleportDist, -edge, edge);
          e.cstate = "judge_warn"; e.ct = m.teleportWarn;
          return;
        }
        if (e.t2 <= 0) { e.t2 = bossInterval(st, m.boltInterval); aimedSpread(st, e, p, m.boltShots, m.boltSpread, m.boltSpeed, bossAttack(e, "projectile", 0), true); }
      } else if (e.bossType === "magnetwarper") {
        // 磁暴行者:缓慢追敌 + 周期引力波(把玩家吸向自己)+ 贴身电击圈
        const m = bossMech(e);
        const pulling = e.cstate === "pull", warning = e.cstate === "pull_warn";
        if (!pulling && !warning) toPlayer(e, p, bossMove(st, e.speed * m.moveMul));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0 && !pulling && !warning) { e.t1 = bossInterval(st, m.pullInterval); e.cstate = "pull_warn"; e.ct = m.pullWarn; }
        if (e.cstate === "pull_warn") {
          e.vx = 0; e.vy = 0; e.ct -= dt;
          if (e.ct <= 0) { e.cstate = "pull"; e.ct = m.pullDuration; ringFrom(st, e.x, e.y, m.ringShots, m.ringSpeed, bossAttack(e, "projectile", 0), e.color, 6, "magnetwarper", e); }
        } else if (e.cstate === "pull") {
          e.ct -= dt;
          e.vx = 0; e.vy = 0;
          if (e.ct > 0) {
            const a = U.angleTo(p.x, p.y, e.x, e.y); // 玩家 → Boss 方向
            p.x += Math.cos(a) * m.pullForce * dt; p.y += Math.sin(a) * m.pullForce * dt;
            SV.Effects.ring(e.x, e.y, e.color, 50, 95, 0.3, 2);
          } else {
            ringFrom(st, e.x, e.y, m.releaseShots, m.releaseSpeed, bossAttack(e, "projectile", 0), e.color, 6, "magnetwarper", e);
            e.cstate = "walk";
          }
        }
        if (e.t2 <= 0 && e.cstate !== "pull_warn") {
          e.t2 = bossInterval(st, m.shockInterval);
          if (U.dist(e.x, e.y, p.x, p.y) < m.shockRange) E.damagePlayer(st, bossAttack(e, "shock", 0) * dmgScale(st, e), false, "magnetwarper");
        }
      } else if (e.bossType === "twins") {
        // 镜像双子:追敌 + 周期换位;击杀其一 → 本体反噬 25%(killEnemy 处理)
        const m = bossMech(e);
        const spd = e.speed * (e.enrage ? m.enragedSpeedMul : 1);
        toPlayer(e, p, bossMove(st, spd));
        e.t1 -= dt; e.t2 -= dt;
        if (e.t1 <= 0 && !e.enrage) {
          e.t1 = bossInterval(st, m.swapInterval); e.cstate = "swap"; e.ct = m.swapWarn;
        }
        if (e.cstate === "swap") {
          e.ct -= dt; e.vx = 0; e.vy = 0;
          if (e.ct <= 0) {
            e.cstate = "walk";
            for (let i = 0; i < st.enemies.length; i++) {
              const o = st.enemies[i];
              if (o !== e && o.bossType === "twins" && o.hp > 0) {
                const tx = e.x, ty = e.y;
                e.x = o.x; e.y = o.y; o.x = tx; o.y = ty;
                e.flash = 0.2; o.flash = 0.2;
                SV.Effects.hit(e.x, e.y, e.color); SV.Effects.hit(o.x, o.y, o.color);
                const rd = bossAttack(e, "projectile", 1);
                ringFrom(st, e.x, e.y, m.ringShots, m.ringSpeed, rd, e.color, 6, "twins", e); // 换位后两点各开一环
                ringFrom(st, o.x, o.y, m.ringShots, m.ringSpeed, rd, o.color, 6, "twins", o);
                break;
              }
            }
          }
        }
        if (e.t2 <= 0) { e.t2 = bossInterval(st, m.shotInterval); aimedSpread(st, e, p, 3, 0.3, m.shotSpeed, bossAttack(e, "projectile", 0), true); }
      } else if (e.bossType === "colossus") {
        // 弹幕巨像:不动 + 周期旋转扫射激光(期间召唤小怪)
        const m = bossMech(e);
        e.vx = 0; e.vy = 0;
        e.t1 -= dt;
        if (e.t1 <= 0 && e.cstate !== "sweep_warn" && e.cstate !== "sweep") {
          e.t1 = bossInterval(st, m.sweepInterval); e.cstate = "sweep_warn"; e.ct = m.sweepWarn; e.cdir = U.rand(0, U.TAU);
        }
        if (e.cstate === "sweep_warn") {
          e.ct -= dt;
          if (e.ct <= 0) { e.cstate = "sweep"; e.ct = m.sweepDuration; spiralBurst(st, e, 14, 150, bossAttack(e, "projectile", 0), 7); }
        } else if (e.cstate === "sweep") {
          e.ct -= dt;
          e.cdir += m.sweepSpeed * dt;
          laserRay(st, e, e.cdir, m.laserLength, m.laserWidth, bossAttack(e, "laser", 0));
          if (e.ct <= 0) e.cstate = "walk";
          e.t2 -= dt;
          if (e.t2 <= 0) {
            e.t2 = bossInterval(st, m.summonInterval);
            for (let i = 0; i < 3; i++) { const a = U.rand(0, U.TAU); E.addEnemy(st, "zombie", e.x + Math.cos(a) * 80, e.y + Math.sin(a) * 80); }
          }
        } else {
          e.t2 -= dt;
          if (e.t2 <= 0) { e.t2 = bossInterval(st, m.idleRingInterval); spiralBurst(st, e, 10, 150, bossAttack(e, "projectile", 0), 8); }
        }
      } else {
        toPlayer(e, p, bossMove(st, e.speed));
      }
    }
  };

  function burst(st, e, n, spd, dmg, r) {
    if (!E.canEnemyRanged(st, e)) return;
    spd = bossShotSpeed(st, spd);
    const off = U.rand(0, U.TAU);
    const d = dmg * dmgScale(st, e), src = e.bossType || e.type;
    for (let k = 0; k < n; k++) { const a = off + k / n * U.TAU; E.addEShot(st, e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, d, e.color, r, src); }
  }
  function aimedSpread(st, e, p, n, spreadRad, spd, dmg, lead) {
    if (!E.canEnemyRanged(st, e)) return;
    spd = bossShotSpeed(st, spd);
    const q = lead ? predictedPoint(e, p, spd) : p, tx = q.x, ty = q.y;
    const base = U.angleTo(e.x, e.y, tx, ty);
    const d = dmg * dmgScale(st, e), src = e.bossType || e.type;
    for (let k = 0; k < n; k++) { const a = base + (k - (n - 1) / 2) * spreadRad; E.addEShot(st, e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, d, e.color, 6, src); }
  }
  // 从任意点发射环形弹幕(非体心,增加弹幕来源多样性)。srcType 由调用方传入(Boss 体内或换位点等)
  function ringFrom(st, x, y, n, spd, dmg, color, r, srcType, attacker) {
    if (attacker && !E.canEnemyRanged(st, attacker)) return;
    spd = bossShotSpeed(st, spd);
    const off = U.rand(0, U.TAU);
    const d = dmg * dmgScale(st, { bossType: srcType });
    for (let k = 0; k < n; k++) { const a = off + k / n * U.TAU; E.addEShot(st, x, y, Math.cos(a) * spd, Math.sin(a) * spd, d, color, r || 6, srcType || null); }
  }
  // 螺旋弹幕:每次发射旋转相位(e.sp 专用字段),多次发射绘出螺旋。n=每圈弹数
  function spiralBurst(st, e, n, spd, dmg, r) {
    if (!E.canEnemyRanged(st, e)) return;
    spd = bossShotSpeed(st, spd);
    const ph = e.sp || 0;
    const d = dmg * dmgScale(st, e), src = e.bossType || e.type;
    for (let k = 0; k < n; k++) { const a = ph + k / n * U.TAU; E.addEShot(st, e.x, e.y, Math.cos(a) * spd, Math.sin(a) * spd, d, e.color, r || 6, src); }
    e.sp = ph + 0.5;
  }

  const AI = {
    update: function (state, e, dt) {
      // 冰冻:完全停滞(不移动、不开火、不产卵、bomber 不自爆)
      if (e.frozen > 0) { e.vx = 0; e.vy = 0; return; }
      // 变羊:中等速度随机游走(不追玩家、不开火;碰撞伤害由接触判定跳过,其余机制不变)
      if (e.sheep > 0) {
        e.t2 -= dt;
        if (e.t2 <= 0) { e.t2 = U.rand(0.5, 1.3); e.cdir = U.rand(0, U.TAU); }
        const spd = SV.Config.CONST.SHEEP_SPEED;
        e.vx = Math.cos(e.cdir) * spd; e.vy = Math.sin(e.cdir) * spd;
        return;
      }
      const p = state.player;
      const fn = Beh[e.ai] || Beh.chase;
      fn(e, p, dt);
    }
  };
  SV.AI = AI;
})();
