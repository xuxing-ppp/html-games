(function initializeGunnerK(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./gunner.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGunnerKPlugin(dependencies) {
  "use strict";
  const { createGunnerDefinition, registerBall, getGunnerArenaGeometry,
    getGunnerWallNormal, traceGunnerArenaFlight } = dependencies;

function createGunnerKPolicy() {
  let geometry = null;
  // ==================== 答题区：枪手 K ====================
  // 策略说明（全部依据每帧快照，不假设固定出生点/对手）：
  // 1. 目标管理：按 instanceId 粘滞锁定“可见且可攻击”的敌人；目标死亡/隐身
  //    时降级到最近候选；拥有召唤物/技能实体的敌人（ownerInstanceId 匹配）
  //    视为本体优先。全场不可见时用最后目击位置做限速推测射击。
  // 2. 瞄准：对目标 forecastSegments 逐段解 |E(t)-M| = 400 t 的二次方程，
  //    取最小正根，并用枪口偏移（半径+弹半径+1）做二次修正；目标
  //    nextTransitionIn 早于弹着时间时认为预测不可信，放弃射击。
  // 3. 危险评估：把自身未来路径（含 0.06s 后坐力段、截断于下次碰壁）与每个
  //    威胁实体/敌方本体的预测段做“时间对齐”的最近距离计算；activeWindow
  //    之外不记分，damage 为 null 一律按危险处理，线段形实体按长度采样。
  // 4. 开火决策：平时仅在拦截时间低于自适应阈值、且后坐力路径不更危险时
  //    开火（开火同时借后坐力远离敌人=风筝）；预计 0.62s 内被撞时进入闪避
  //    模式，在“朝目标开火”和“朝逃逸反方向开火”扇形候选中挑危险最低者。
  // 5. 碰壁转向：在 -75°~75° 每 5° 采样，按路径危险、二次碰壁间隔、与最近
  //    敌人的风筝距离打分，取最高分。
  // 6. 复盘：onEvent 统计 fire / projectile-hit(damaged)，命中率低则收紧
  //    开火阈值，高则放宽（0.35~0.85s 之间）。

  const SELF_RADIUS = 15;
  const SELF_SPEED = 150;
  const BULLET_SPEED = 400;
  const BULLET_RADIUS = 3;
  const MUZZLE = SELF_RADIUS + BULLET_RADIUS + 1;
  const RECOIL_DURATION = 0.06;
  const RECOIL_SPEED = 325;
  const DODGE_HORIZON = 1.0;
  const ATTACK_HORIZON = 0.85;
  const URGENT_TIME = 0.62;
  const TAU_DEFAULT = 0.7;
  const TAU_MIN = 0.35;
  const TAU_MAX = 0.85;
  const DEG = Math.PI / 180;

  let targetLock = null;
  let lastSeen = null; // { x, y, vx, vy, t } 仅保存数值摘要
  let lastAim = 0;
  let tauLimit = TAU_DEFAULT;
  let shots = 0;
  let hits = 0;
  let firesSinceAdapt = 0;

  function num(v, d) { return Number.isFinite(v) ? v : d; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function norm(x, y, fx, fy) {
    const m = Math.hypot(x, y);
    return m > 1e-9 ? { x: x / m, y: y / m } : { x: fx, y: fy };
  }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function quadRoots(a, b, c) {
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) < 1e-9) return [];
      return [-c / b];
    }
    const d = b * b - 4 * a * c;
    if (d < 0) return [];
    const s = Math.sqrt(d);
    return [(-b - s) / (2 * a), (-b + s) / (2 * a)];
  }
  function timeToWall(x, y, vx, vy, r, size) {
    if (geometry) {
      const speed = Math.hypot(vx, vy);
      return speed > 1e-9 ? geometry.movementLimit(x, y, vx / speed, vy / speed, Number.MAX_VALUE, r) / speed : null;
    }
    let best = null;
    const consider = (t) => {
      if (Number.isFinite(t) && t >= 0 && (best === null || t < best)) best = t;
    };
    if (vx > 1e-9) consider((size - r - x) / vx);
    else if (vx < -1e-9) consider((r - x) / vx);
    if (vy > 1e-9) consider((size - r - y) / vy);
    else if (vy < -1e-9) consider((r - y) / vy);
    return best;
  }

  // 路径段统一为 { t0, t1, cx, cy, vx, vy }：pos(t) = (cx + vx t, cy + vy t)
  function cruiseSeg(x, y, vx, vy, r, size, t0, horizon) {
    const tw = timeToWall(x, y, vx, vy, r, size);
    let t1 = horizon;
    if (tw !== null) t1 = Math.min(horizon, t0 + Math.max(0, tw));
    if (t1 <= t0) t1 = t0 + 1e-3;
    return [{ t0, t1, cx: x - vx * t0, cy: y - vy * t0, vx, vy }];
  }
  function currentPath(self, size, horizon) {
    const x = num(self.x, size / 2), y = num(self.y, size / 2);
    const vx = num(self.vx, 0), vy = num(self.vy, 0);
    const r = num(self.radius, SELF_RADIUS);
    const rec = num(self.recoilRemaining, 0);
    if (rec > 0.004) {
      if (geometry) {
        const first = cruiseSeg(x, y, vx, vy, r, size, 0, Math.min(rec, horizon));
        if (first[0].t1 < rec || horizon <= rec) return first;
      }
      const segs = [{ t0: 0, t1: Math.min(rec, horizon), cx: x, cy: y, vx, vy }];
      if (horizon > rec) {
        const d = norm(vx, vy, 1, 0);
        segs.push(...cruiseSeg(x + vx * rec, y + vy * rec,
          d.x * SELF_SPEED, d.y * SELF_SPEED, r, size, rec, horizon));
      }
      return segs;
    }
    return cruiseSeg(x, y, vx, vy, r, size, 0, horizon);
  }
  function postFirePath(self, angle, size, horizon) {
    const x = num(self.x, size / 2), y = num(self.y, size / 2);
    const u = norm(num(self.vx, 0), num(self.vy, 0), 1, 0);
    const rx = u.x * SELF_SPEED - Math.cos(angle) * RECOIL_SPEED;
    const ry = u.y * SELF_SPEED - Math.sin(angle) * RECOIL_SPEED;
    const r = num(self.radius, SELF_RADIUS);
    if (geometry) {
      const first = cruiseSeg(x, y, rx, ry, r, size, 0, Math.min(RECOIL_DURATION, horizon));
      if (first[0].t1 < RECOIL_DURATION || horizon <= RECOIL_DURATION) return first;
    }
    const segs = [{ t0: 0, t1: Math.min(RECOIL_DURATION, horizon), cx: x, cy: y, vx: rx, vy: ry }];
    if (horizon > RECOIL_DURATION) {
      const d = norm(rx, ry, -Math.cos(angle), -Math.sin(angle));
      segs.push(...cruiseSeg(x + rx * RECOIL_DURATION, y + ry * RECOIL_DURATION,
        d.x * SELF_SPEED, d.y * SELF_SPEED, r, size, RECOIL_DURATION, horizon));
    }
    return segs;
  }
  function entSegs(ent, rl) {
    const raw = Array.isArray(ent.forecastSegments) ? ent.forecastSegments : [];
    const out = [];
    for (const s of raw) {
      if (!s) continue;
      const t0 = num(s.t0, 0), t1 = num(s.t1, t0);
      if (t1 <= t0) continue;
      const vx = num(s.vx, 0), vy = num(s.vy, 0);
      out.push({
        t0, t1,
        cx: num(s.x1, num(ent.x, 0)) - vx * t0,
        cy: num(s.y1, num(ent.y, 0)) - vy * t0,
        vx, vy
      });
    }
    if (!out.length) {
      out.push({
        t0: 0, t1: Math.max(0.05, Math.min(rl, 2)),
        cx: num(ent.x, 0), cy: num(ent.y, 0),
        vx: num(ent.vx, 0), vy: num(ent.vy, 0)
      });
    }
    return out;
  }
  function ballSegs(e) { return entSegs(e, 2); }
  function ballPosAt(e, t) {
    const raw = Array.isArray(e.forecastSegments) ? e.forecastSegments : [];
    for (const s of raw) {
      if (!s) continue;
      const t0 = num(s.t0, 0), t1 = num(s.t1, t0);
      if (t >= t0 && t <= t1) {
        return {
          x: num(s.x1, num(e.x, 0)) + num(s.vx, 0) * (t - t0),
          y: num(s.y1, num(e.y, 0)) + num(s.vy, 0) * (t - t0)
        };
      }
    }
    if (raw.length) {
      const s = raw[raw.length - 1];
      return { x: num(s.x2, num(e.x, 0)), y: num(s.y2, num(e.y, 0)) };
    }
    return { x: num(e.x, 0) + num(e.vx, 0) * t, y: num(e.y, 0) + num(e.vy, 0) * t };
  }

  function evalDanger(pathSegs, threats, enemies) {
    let score = 0;
    let impact = null;
    let ax = 0, ay = 0;

    function consider(ps, ecx, ecy, evx, evy, et0, et1, er, w, band, winFrom, winUntil) {
      const lo = Math.max(ps.t0, et0, winFrom);
      const hi = Math.min(ps.t1, et1, winUntil);
      if (hi <= lo) return;
      const rx = ps.cx - ecx, ry = ps.cy - ecy;
      const dx = ps.vx - evx, dy = ps.vy - evy;
      const dd = dx * dx + dy * dy;
      let t = dd > 1e-9 ? -(rx * dx + ry * dy) / dd : lo;
      t = clamp(t, lo, hi);
      const mx = rx + dx * t, my = ry + dy * t;
      const dist = Math.hypot(mx, my);
      const rSum = SELF_RADIUS + er;
      if (dist < rSum + 4) {
        score += (w * 2.2) / (0.24 + t);
        if (impact === null || t < impact) impact = t;
        const px = ps.cx + ps.vx * t, py = ps.cy + ps.vy * t;
        const ex = ecx + evx * t, ey = ecy + evy * t;
        const aw = norm(px - ex, py - ey, 0, 0);
        const wa = w / (0.24 + t);
        ax += aw.x * wa;
        ay += aw.y * wa;
      } else if (dist < rSum + band) {
        score += (w * 0.45) / (0.3 + t);
      }
    }

    if (Array.isArray(threats)) {
      for (const ent of threats) {
        if (!ent || ent.hostile === false) continue;
        const rl = num(ent.remainingLife, 1e9);
        if (rl <= 0) continue;
        const win = ent.activeWindow && typeof ent.activeWindow === "object" ? ent.activeWindow : {};
        const wFrom = num(win.from, 0);
        const wUntil = Math.min(num(win.until, rl), rl);
        if (wUntil <= wFrom) continue;
        const dmg = num(ent.damage, 1); // null 伤害按危险处理
        const w = dmg > 0 ? 1 + Math.min(2.5, dmg) : 0.8;
        const segs = entSegs(ent, rl);
        const shape = ent.shape && typeof ent.shape === "object" ? ent.shape : {};
        const isSeg = shape.type === "segment" &&
          [shape.startX, shape.startY, shape.endX, shape.endY].every(Number.isFinite);
        const cx0 = num(ent.x, 0), cy0 = num(ent.y, 0);
        for (const ps of pathSegs) {
          for (const es of segs) {
            if (isSeg) {
              const len = Math.hypot(shape.endX - shape.startX, shape.endY - shape.startY);
              const n = clamp(Math.ceil(len / 14), 2, 10);
              const er2 = Math.max(num(shape.radius, 0), num(shape.width, 0) / 2, 2);
              for (let k = 0; k <= n; k++) {
                const f = k / n;
                const ox = (shape.startX + (shape.endX - shape.startX) * f) - cx0;
                const oy = (shape.startY + (shape.endY - shape.startY) * f) - cy0;
                consider(ps, es.cx + ox, es.cy + oy, es.vx, es.vy,
                  es.t0, es.t1, er2, w, 10, wFrom, wUntil);
              }
            } else {
              const er = Math.max(num(ent.radius, 0), num(shape.radius, 0), num(shape.width, 0) / 2, 1);
              consider(ps, es.cx, es.cy, es.vx, es.vy, es.t0, es.t1, er, w, 12, wFrom, wUntil);
            }
          }
        }
      }
    }

    if (Array.isArray(enemies)) {
      for (const e of enemies) {
        if (!e || e.visible === false || num(e.hp, 1) <= 0) continue;
        const w = e.capabilities && e.capabilities.canDealDamage === false ? 0.5 : 1.5;
        const er = num(e.radius, 15);
        const segs = ballSegs(e);
        for (const ps of pathSegs) {
          for (const es of segs) {
            consider(ps, es.cx, es.cy, es.vx, es.vy, es.t0, es.t1, er, w, 14, 0, 1e9);
          }
        }
      }
    }

    const am = Math.hypot(ax, ay);
    return {
      score, impact,
      awayX: am > 1e-9 ? ax / am : 0,
      awayY: am > 1e-9 ? ay / am : 0,
      awayMag: am
    };
  }

  function interceptPass(px, py, segs) {
    let best = null;
    for (const s of segs) {
      if (!s) continue;
      const t0 = num(s.t0, 0), t1 = num(s.t1, t0);
      if (t1 <= t0) continue;
      const vx = num(s.vx, 0), vy = num(s.vy, 0);
      const Px = num(s.x1, 0) - vx * t0 - px;
      const Py = num(s.y1, 0) - vy * t0 - py;
      const a = vx * vx + vy * vy - BULLET_SPEED * BULLET_SPEED;
      const b = 2 * (Px * vx + Py * vy);
      const c = Px * Px + Py * Py;
      const roots = quadRoots(a, b, c);
      for (const t of roots) {
        if (t >= -1e-9 && t >= t0 - 1e-6 && t <= t1 + 1e-6 && t <= 2.5) {
          if (!best || t < best.t) {
            const ex = num(s.x1, 0) + vx * (t - t0);
            const ey = num(s.y1, 0) + vy * (t - t0);
            best = { t: Math.max(0, t), angle: Math.atan2(ey - py, ex - px) };
          }
        }
      }
    }
    return best;
  }
  function solveIntercept(sx, sy, target) {
    const raw = Array.isArray(target.forecastSegments) && target.forecastSegments.length
      ? target.forecastSegments
      : [{
        t0: 0, t1: 1,
        x1: num(target.x, 0), y1: num(target.y, 0),
        vx: num(target.vx, 0), vy: num(target.vy, 0)
      }];
    let best = interceptPass(sx, sy, raw);
    if (best) {
      const mx = sx + Math.cos(best.angle) * MUZZLE;
      const my = sy + Math.sin(best.angle) * MUZZLE;
      const refined = interceptPass(mx, my, raw);
      if (refined) best = refined;
    }
    return best;
  }

  function onStart() {
    targetLock = null;
    lastSeen = null;
    lastAim = 0;
    tauLimit = TAU_DEFAULT;
    shots = 0;
    hits = 0;
    firesSinceAdapt = 0;
  }

  function decide(obs) {
    try {
      geometry = getGunnerArenaGeometry(obs && obs.arena);
      const self = obs && obs.self ? obs.self : {};
      const size = num(obs && obs.arena && obs.arena.size, 200);
      const sx = num(self.x, size / 2), sy = num(self.y, size / 2);
      const now = num(obs && obs.time, 0);
      const enemies = (Array.isArray(obs && obs.enemies) ? obs.enemies : [])
        .filter((e) => e && e.visible !== false && num(e.hp, 1) > 0);
      const threats = Array.isArray(obs && obs.threats) ? obs.threats : [];

      // 本体识别：拥有威胁实体的敌人更可能是召唤者/本体
      const ownerIds = new Set();
      for (const ent of threats) {
        if (ent && typeof ent.ownerInstanceId === "string" && ent.ownerInstanceId) {
          ownerIds.add(ent.ownerInstanceId);
        }
      }

      // ---- 目标选择（instanceId 粘滞 + 安全降级）----
      const attackable = enemies.filter((e) => e.attackable !== false);
      let target = null;
      if (targetLock) {
        target = attackable.find((e) => e && e.instanceId === targetLock) || null;
      }
      if (!target && attackable.length) {
        let best = null, bestScore = Infinity;
        for (const e of attackable) {
          const d = Math.hypot(num(e.x, 0) - sx, num(e.y, 0) - sy)
            + num(e.hp, 50) * 0.6
            - (ownerIds.has(e.instanceId) ? 30 : 0);
          if (d < bestScore) { bestScore = d; best = e; }
        }
        target = best;
      }
      targetLock = target ? String(target.instanceId) : null;

      const seen = target || enemies[0] || null;
      if (seen) {
        lastSeen = {
          x: num(seen.x, 0), y: num(seen.y, 0),
          vx: num(seen.vx, 0), vy: num(seen.vy, 0), t: now
        };
      }

      // ---- 当前路径危险 ----
      const base = evalDanger(currentPath(self, size, DODGE_HORIZON), threats, enemies);
      const urgent = base.impact !== null && base.impact <= URGENT_TIME;
      const cooldownReady = num(self.fireCooldown, 1) <= 0.001; // 引擎就绪时恰为 0，避免被拒绝的发射请求

      // ---- 拦截解 ----
      let sol = target ? solveIntercept(sx, sy, target) : null;
      let aim = lastAim;
      if (sol) aim = sol.angle;
      else if (target) aim = Math.atan2(num(target.y, 0) - sy, num(target.x, 0) - sx);

      let fire = false;

      // ---- 闪避开火：后坐力脱离 ----
      if (cooldownReady && urgent) {
        const cands = [];
        if (sol) cands.push(sol.angle);
        if (base.awayMag > 1e-6) {
          const esc = Math.atan2(-base.awayY, -base.awayX); // 后坐力沿 away 方向
          for (const d of [0, 0.5, -0.5, 1.0, -1.0]) cands.push(esc + d);
        }
        let bestA = null, bestScore = Infinity;
        for (const a of cands) {
          const d = evalDanger(postFirePath(self, a, size, DODGE_HORIZON), threats, enemies);
          if (d.score < bestScore - 1e-9) { bestScore = d.score; bestA = a; }
        }
        // 朝目标开火若接近最优，优先它（伤害 + 闪避兼得）
        if (sol && bestA !== null && Math.abs(angDiff(bestA, sol.angle)) > 1e-6) {
          const dAtk = evalDanger(postFirePath(self, sol.angle, size, DODGE_HORIZON), threats, enemies);
          if (dAtk.score <= bestScore + 0.8) { bestA = sol.angle; bestScore = dAtk.score; }
        }
        const improves = bestScore <= base.score * 0.75 || bestScore <= base.score - 2;
        const desperate = base.impact <= 0.3 && bestScore <= base.score + 0.5;
        if (bestA !== null && (improves || desperate)) {
          fire = true;
          aim = bestA;
        }
      }

      // ---- 攻击开火：高质量拦截 + 后坐力路径安全 ----
      if (!fire && cooldownReady && !urgent && target && sol) {
        const trans = target.nextTransitionIn;
        const transOk = !(Number.isFinite(trans) && trans > 0 && trans < sol.t - 0.04);
        if (sol.t <= tauLimit && transOk) {
          const d2 = evalDanger(postFirePath(self, sol.angle, size, ATTACK_HORIZON), threats, enemies);
          // 仅当后坐力路径无碰撞，或本就被撞（危险不显著变大）时才开火
          if (d2.impact === null || d2.score <= base.score + 1) {
            fire = true;
            aim = sol.angle;
          }
        }
      }

      // ---- 隐身期推测射击（限速、低风险时）----
      if (!fire && cooldownReady && !target && lastSeen && now - lastSeen.t < 2.2 && base.impact === null) {
        const dt = now - lastSeen.t;
        const seen = geometry ? traceGunnerArenaFlight({ ...lastSeen, radius: SELF_RADIUS,
          remainingLife: dt }, geometry, dt) : { x: lastSeen.x + lastSeen.vx * dt, y: lastSeen.y + lastSeen.vy * dt };
        const ex = seen.x;
        const ey = seen.y;
        const dd = Math.hypot(ex - sx, ey - sy);
        const ft = dd / BULLET_SPEED;
        aim = Math.atan2(ey + lastSeen.vy * ft - sy, ex + lastSeen.vx * ft - sx);
        fire = true;
      }

      if (!Number.isFinite(aim)) aim = lastAim;
      lastAim = aim;
      return { fire, aimAngle: aim, targetId: targetLock };
    } catch (_err) {
      return { fire: false, aimAngle: Number.isFinite(lastAim) ? lastAim : 0, targetId: targetLock };
    }
  }

  function onWallBounce(obs) {
    try {
      geometry = getGunnerArenaGeometry(obs && obs.arena);
      const self = obs && obs.self ? obs.self : {};
      const size = num(obs && obs.arena && obs.arena.size, 200);
      const x = num(self.x, size / 2), y = num(self.y, size / 2);
      const r = num(self.radius, SELF_RADIUS);
      const threats = Array.isArray(obs && obs.threats) ? obs.threats : [];
      const enemies = (Array.isArray(obs && obs.enemies) ? obs.enemies : [])
        .filter((e) => e && e.visible !== false && num(e.hp, 1) > 0);

      let ix = 0, iy = 0;
      if (x <= r + 2) ix = 1;
      else if (x >= size - r - 2) ix = -1;
      if (y <= r + 2) iy = 1;
      else if (y >= size - r - 2) iy = -1;
      if (ix === 0 && iy === 0) {
        const sp = Math.hypot(num(self.vx, 0), num(self.vy, 0));
        if (sp > 1) { ix = -num(self.vx, 0) / sp; iy = -num(self.vy, 0) / sp; }
        else ix = 1;
      }
      const inw = geometry ? getGunnerWallNormal(geometry, x, y, r) : norm(ix, iy, 1, 0);
      const baseAng = Math.atan2(inw.y, inw.x);

      let bestDeg = 0, bestScore = -Infinity;
      for (let deg = -75; deg <= 75; deg += 5) {
        const ang = baseAng + deg * DEG;
        const vx = Math.cos(ang) * SELF_SPEED, vy = Math.sin(ang) * SELF_SPEED;
        const path = cruiseSeg(x, y, vx, vy, r, size, 0, 1.35);
        const dng = evalDanger(path, threats, enemies);
        const tWall = path[0].t1;
        let score = -dng.score * 6;
        if (dng.impact !== null) score -= 10 / (0.25 + dng.impact);
        if (tWall < 0.4) score -= (0.4 - tWall) * 12; // 避免贴墙抖动
        if (enemies.length) {
          const tm = Math.min(0.6, tWall);
          const mx = x + vx * tm, my = y + vy * tm;
          let dmin = Infinity;
          for (const e of enemies) {
            const ep = ballPosAt(e, tm);
            const d = Math.hypot(mx - ep.x, my - ep.y);
            if (d < dmin) dmin = d;
          }
          if (dmin < 70) score -= (70 - dmin) * 0.1; // 风筝距离
        }
        score -= Math.abs(deg) * 0.008;
        if (score > bestScore) { bestScore = score; bestDeg = deg; }
      }
      return { bounceAngle: clamp(bestDeg, -75, 75) };
    } catch (_err) {
      return { bounceAngle: 0 };
    }
  }

  function onEvent(ev) {
    try {
      if (!ev || typeof ev !== "object") return;
      if (ev.type === "fire") {
        shots += 1;
        firesSinceAdapt += 1;
        if (firesSinceAdapt >= 6 && shots >= 6) {
          const rate = hits / shots;
          if (rate < 0.28) tauLimit = Math.max(TAU_MIN, tauLimit - 0.12);
          else if (rate > 0.55) tauLimit = Math.min(TAU_MAX, tauLimit + 0.08);
          shots = Math.floor(shots / 2);
          hits = Math.floor(hits / 2);
          firesSinceAdapt = 0;
        }
      } else if (ev.type === "projectile-hit") {
        if (ev.damaged === true) hits += 1;
      }
    } catch (_err) {
      // 复盘逻辑绝不影响比赛
    }
  }

  return { onStart, decide, onWallBounce, onEvent };
}

const gunnerKDefinition = createGunnerDefinition({
  id: "gunnerK",
  name: "枪手K",
  englishName: "Gunner K",
  color: "#133145",
  description: "深蓝色自由策略枪手 / 粘滞索敌、时序威胁评估与后坐力风筝",
  policyFactory: createGunnerKPolicy
});

registerBall(gunnerKDefinition);
return { createGunnerKPolicy, gunnerKDefinition };
});
