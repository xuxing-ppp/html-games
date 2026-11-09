(function initializeGunnerH(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./gunner.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGunnerHPlugin(dependencies) {
  "use strict";
  const { createGunnerDefinition, registerBall, getGunnerArenaGeometry,
    getGunnerWallNormal, traceGunnerArenaFlight } = dependencies;

function createGunnerHPolicy() {
  let geometry = null;
  // ==================== 答题区：枪手 H ====================
  // 只能修改这个函数内的策略逻辑。固定属性和引擎由裁判管理。
  //
  // 三条从固定物理里读出来的可利用事实：
  //  1) 碰壁后底座把速度方向整体重设为「场内法线旋转 bounceAngle」，入射方向被丢弃。
  //     => 每个碰壁点都是一个免费的「重新选向」决策点（±75°），用它做规避与走位。
  //  2) 发射后坐力 = normalize(150*当前方向 - 325*瞄准方向) 持续 0.06s 后归一到 150。
  //     => 打正前方的目标会 180° 掉头，打身后的目标会向前冲刺 28px；发射本身就是
  //        唯一的「无冷却」机动手段，开火前要先评估它把航向甩到哪里。
  //  3) 对手在两次碰壁之间只能走直线，所以它的直线段终点（碰壁点）在命中前是确定的。
  //     => 用解析提前量打「碰壁前」的线段是必中；一旦跨过对手的碰壁时刻，就只剩
  //        扇形猜测。因此用同一套弹道模拟给候选角打期望命中概率，只打期望高的枪。

  /* ---------- 固定物理常量（只读题面/底座，不修改引擎） ---------- */
  const DEG = Math.PI / 180;
  const BULLET_SPEED = 400;
  const BULLET_RADIUS = 3;
  const RECOIL_SPEED = 325;
  const CRUISE_SPEED = 150;
  const BOUNCE_LIMIT = 75;          // 合法转向角范围（角度制）
  const SIM_DT = 0.02;              // 弹道模拟步长
  const SIM_STEPS = 45;             // ~0.9s 预测窗口
  const FAN_SAMPLES = 7;            // 对手碰壁后合法出射角的采样数
  const BULLET_CLEAR = 26;          // 敌弹安全间隙
  const CONTACT_CLEAR = 22;         // 接触伤害安全间隙
  const FIRE_PROB = 0.3;            // 常规开火期望门限
  const FIRE_PROB_LATE = 0.12;      // 长时间无靶时的补射门限
  const FIRE_LATE_WAIT = 1.8;       // 距上次发射超过该秒数才放宽门限
  const HOLD_PENALTY = 50;          // 后坐航向明显更危险时压枪的差值门限
  const DODGE_GAIN = 25;            // 后坐航向明显更安全时视为一次逃逸机动
  const MAX_HOLD_TICKS = 6;         // 最多压 0.3s，避免为了规避而不开枪

  /* ---------- 闭包状态（不保存 observation，不引用外部时间/随机源） ---------- */
  const mem = {
    aim: 0,                 // 当前瞄准角（始终有限值）
    plannedBounce: 0,       // 预置的下一次碰壁转向，兼作 onWallBounce 异常兜底
    planTime: -999,         // 预规划刷新时刻
    lastFire: -999,         // 上次请求发射的比赛时间
    hold: 0,                // 连续压枪帧数
    prevVx: 1,
    prevVy: 0,              // 上一决策帧的自身速度（用于碰壁法线的角落消歧）
    dirX: 1,
    dirY: 0,                // 最近一次已知的自身航向（速度归零时的兜底）
    fired: 0,
    damaged: 0
  };

  /* ---------- 数学工具 ---------- */
  function num(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, lo, hi) {
    if (!Number.isFinite(value)) return lo;
    return value < lo ? lo : (value > hi ? hi : value);
  }

  function len(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  function unit(x, y) {
    const m = len(x, y);
    if (!(m > 1e-9)) return { x: 1, y: 0 };
    return { x: x / m, y: y / m };
  }

  // 与底座 onWallBounce 完全相同的旋转约定：newDir = R(bounceAngle) * inwardNormal
  function rotate(nx, ny, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: nx * c - ny * s, y: nx * s + ny * c };
  }

  function angleDelta(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return len(ax + dx * t - px, ay + dy * t - py);
  }

  function smallestPositiveRoot(a, b, c) {
    if (Math.abs(a) < 1e-9) {
      if (Math.abs(b) < 1e-9) return null;
      const r = -c / b;
      return Number.isFinite(r) && r > 1e-6 ? r : null;
    }
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sq = Math.sqrt(disc);
    const r1 = (-b + sq) / (2 * a);
    const r2 = (-b - sq) / (2 * a);
    let best = null;
    if (Number.isFinite(r1) && r1 > 1e-6) best = r1;
    if (Number.isFinite(r2) && r2 > 1e-6 && (best === null || r2 < best)) best = r2;
    return best;
  }

  // 沿直线运动到下一次碰壁：时间与指向场内的单位法线（与底座同构）
  function wallContact(x, y, vx, vy, r, size) {
    if (geometry) {
      const speed = Math.hypot(vx, vy);
      if (speed < 1e-9) return null;
      const distance = geometry.movementLimit(x, y, vx / speed, vy / speed, Number.MAX_VALUE, r);
      const px = x + vx / speed * distance;
      const py = y + vy / speed * distance;
      const normal = getGunnerWallNormal(geometry, px, py, r, 1e-7);
      return { t: distance / speed, nx: normal.x, ny: normal.y, x: px, y: py };
    }
    const eps = 1e-9;
    let bestT = null;
    let nx = 0;
    let ny = 0;
    let t;
    if (vx > eps) {
      t = (size - r - x) / vx;
      if (t >= 0 && (bestT === null || t < bestT)) { bestT = t; nx = -1; ny = 0; }
    } else if (vx < -eps) {
      t = (r - x) / vx;
      if (t >= 0 && (bestT === null || t < bestT)) { bestT = t; nx = 1; ny = 0; }
    }
    if (vy > eps) {
      t = (size - r - y) / vy;
      if (t >= 0 && (bestT === null || t < bestT)) { bestT = t; nx = 0; ny = -1; }
    } else if (vy < -eps) {
      t = (r - y) / vy;
      if (t >= 0 && (bestT === null || t < bestT)) { bestT = t; nx = 0; ny = 1; }
    }
    if (bestT === null) return null;
    return { t: bestT, nx: nx, ny: ny };
  }

  // 弹道模拟窗口随场地放大（普通场 200 / Boss 场 300），避免最长直射路径被截断
  function simSteps(size) {
    return Math.round(clamp((size * 1.6) / BULLET_SPEED / SIM_DT, SIM_STEPS, 90));
  }

  /* ---------- 观测净化 ---------- */
  function readObservation(obs) {
    if (!obs || typeof obs !== "object") return null;
    geometry = getGunnerArenaGeometry(obs.arena);
    const size = clamp(num(obs.arena && obs.arena.size, 200), 60, 4000);
    const src = obs.self;
    if (!src || typeof src !== "object") return null;
    const self = {
      id: String(src.instanceId || ""),
      x: num(src.x, size / 2),
      y: num(src.y, size / 2),
      vx: num(src.vx, 0),
      vy: num(src.vy, 0),
      r: clamp(num(src.radius, 15), 1, size / 2 - 1),
      hp: num(src.hp, 1),
      cooldown: Math.max(0, num(src.fireCooldown, 0)),
      recoil: Math.max(0, num(src.recoilRemaining, 0))
    };
    const rawSpeed = len(self.vx, self.vy);
    const ctx = {
      size: size,
      time: num(obs.time, 0),
      self: self,
      // 后坐阶段的观测速度可达 475，但 0.06s 后归一到 150，规划用巡航速度
      mySpeed: rawSpeed > 170 ? CRUISE_SPEED : (rawSpeed > 1 ? rawSpeed : CRUISE_SPEED),
      enemies: [],
      hostiles: []
    };

    const rawEnemies = Array.isArray(obs.enemies) ? obs.enemies : [];
    for (let i = 0; i < rawEnemies.length && ctx.enemies.length < 6; i += 1) {
      const e = rawEnemies[i];
      if (!e || !Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
      const id = String(e.instanceId || "");
      if (id && id === self.id) continue;            // 绝不用下标/绝不把自己当靶
      ctx.enemies.push({
        id: id,
        x: num(e.x, size / 2),
        y: num(e.y, size / 2),
        vx: num(e.vx, 0),
        vy: num(e.vy, 0),
        r: clamp(num(e.radius, 15), 1, size / 2 - 1),
        hp: num(e.hp, 1),
        solid: e.solid !== false,
        attackable: e.attackable !== false
      });
    }

    const rawProjectiles = Array.isArray(obs.projectiles) ? obs.projectiles : [];
    for (let i = 0; i < rawProjectiles.length && ctx.hostiles.length < 10; i += 1) {
      const p = rawProjectiles[i];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.hostile === false) continue;
      const owner = String(p.ownerInstanceId || "");
      if (owner && owner === self.id) continue;      // 自己的子弹不是威胁
      const pvx = num(p.vx, 0);
      const pvy = num(p.vy, 0);
      if (len(pvx, pvy) < 1) continue;
      ctx.hostiles.push({
        x: num(p.x, size / 2),
        y: num(p.y, size / 2),
        vx: pvx,
        vy: pvy,
        r: clamp(num(p.radius, BULLET_RADIUS), 1, 40),
        bounces: Math.max(0, num(p.bounces, 0))
      });
    }
    return ctx;
  }

  /* ---------- 与底座一致的子弹/目标步进 ---------- */
  function stepProjectile(p, dt, size) {
    if (geometry) {
      const flight = traceGunnerArenaFlight({ ...p, radius: p.r,
        remainingLife: dt, remainingBounces: 1 - p.bounces }, geometry, dt);
      p.x = flight.x; p.y = flight.y;
      p.vx = flight.vx; p.vy = flight.vy;
      p.bounces += flight.bounces;
      p.dead = flight.expired;
      p.path = flight.segments;
      return;
    }
    // 镜像 createGunnerBullet.update：镜面反弹，最多一次，第二次碰壁即消失
    const nx = p.x + p.vx * dt;
    const ny = p.y + p.vy * dt;
    let bounced = false;
    if (nx - p.r < 0 || nx + p.r > size) {
      if (p.bounces >= 1) { p.dead = true; return; }
      p.x = clamp(nx, p.r, size - p.r);
      p.vx = -p.vx;
      p.bounces += 1;
      bounced = true;
    } else {
      p.x = nx;
    }
    if (ny - p.r < 0 || ny + p.r > size) {
      if (p.bounces >= 1 && !bounced) { p.dead = true; return; }
      p.y = clamp(ny, p.r, size - p.r);
      p.vy = -p.vy;
      if (!bounced) p.bounces += 1;
    } else {
      p.y = ny;
    }
  }

  function stepTarget(t, dt, size, fanAngle) {
    if (geometry) {
      const first = traceGunnerArenaFlight({ ...t, radius: t.r, remainingLife: dt,
        remainingBounces: !t.bounced && Number.isFinite(fanAngle) ? 0 : null }, geometry, dt);
      t.x = first.x; t.y = first.y;
      t.vx = first.vx; t.vy = first.vy;
      if (first.expired) {
        const normal = getGunnerWallNormal(geometry, t.x, t.y, t.r, 1e-7);
        const direction = rotate(normal.x, normal.y, fanAngle);
        const speed = Math.hypot(t.vx, t.vy) || CRUISE_SPEED;
        const rest = dt - first.segments[first.segments.length - 1].t1;
        const second = traceGunnerArenaFlight({ x: t.x, y: t.y,
          vx: direction.x * speed, vy: direction.y * speed,
          radius: t.r, remainingLife: rest }, geometry, rest);
        t.x = second.x; t.y = second.y;
        t.vx = second.vx; t.vy = second.vy;
      }
      if (first.expired || first.bounces) t.bounced = true;
      return;
    }
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    const r = t.r;
    let hx = 0;
    let hy = 0;
    if (t.x < r) { t.x = r; hx = 1; } else if (t.x > size - r) { t.x = size - r; hx = -1; }
    if (t.y < r) { t.y = r; hy = 1; } else if (t.y > size - r) { t.y = size - r; hy = -1; }
    if (hx === 0 && hy === 0) return;
    const speed = len(t.vx, t.vy) || CRUISE_SPEED;
    if (!t.bounced && Number.isFinite(fanAngle)) {
      // 第一次碰壁：出射方向 = 场内法线旋转一个合法扇形角（对手能任意挑）
      const u = unit(hx, hy);
      const d = rotate(u.x, u.y, fanAngle);
      t.vx = d.x * speed;
      t.vy = d.y * speed;
    } else {
      if (hx !== 0) t.vx = -t.vx;
      if (hy !== 0) t.vy = -t.vy;
    }
    t.bounced = true;
  }

  function bulletHitsTarget(sx, sy, dx, dy, target, size, fanAngle, reach) {
    const b = {
      x: sx, y: sy,
      vx: dx * BULLET_SPEED, vy: dy * BULLET_SPEED,
      r: BULLET_RADIUS, bounces: 0, dead: false
    };
    if (geometry) Object.assign(b, geometry.clampPoint(b.x, b.y, b.r));
    const steps = simSteps(size);
    for (let i = 0; i < steps; i += 1) {
      const ax = b.x;
      const ay = b.y;
      stepProjectile(b, SIM_DT, size);
      if (b.dead && !geometry) return false;
      stepTarget(target, SIM_DT, size, fanAngle);
      if (geometry) {
        for (const segment of b.path) {
          if (pointToSegmentDistance(target.x, target.y, segment.x1, segment.y1, segment.x2, segment.y2) <= reach) return true;
        }
        if (b.dead) return false;
        continue;
      }
      if (pointToSegmentDistance(target.x, target.y, ax, ay, b.x, b.y) <= reach) return true;
    }
    return false;
  }

  /* ---------- 瞄准 ---------- */
  function modelEnemy(e) {
    let vx = e.vx;
    let vy = e.vy;
    const sp = len(vx, vy);
    // 对手处于后坐瞬间（速度 >170 且是普通枪手尺寸）时，用归一化后的巡航速度预测
    if (sp > CRUISE_SPEED * 1.15 && e.r <= 20) {
      const k = CRUISE_SPEED / sp;
      vx *= k;
      vy *= k;
    }
    return { x: e.x, y: e.y, vx: vx, vy: vy, r: e.r };
  }

  function leadTime(ox, oy, m) {
    const dx = m.x - ox;
    const dy = m.y - oy;
    const a = m.vx * m.vx + m.vy * m.vy - BULLET_SPEED * BULLET_SPEED;
    const b = 2 * (dx * m.vx + dy * m.vy);
    const c = dx * dx + dy * dy;
    return smallestPositiveRoot(a, b, c);
  }

  // 直线段提前量 + 出膛点（自身中心外 19px）迭代修正
  function straightLead(self, m, spawnR) {
    let t = leadTime(self.x, self.y, m);
    if (t === null) return null;
    let angle = Math.atan2(m.y + m.vy * t - self.y, m.x + m.vx * t - self.x);
    for (let i = 0; i < 2; i += 1) {
      const ox = self.x + Math.cos(angle) * spawnR;
      const oy = self.y + Math.sin(angle) * spawnR;
      const nt = leadTime(ox, oy, m);
      if (nt === null) break;
      t = nt;
      const ix = m.x + m.vx * t;
      const iy = m.y + m.vy * t;
      const next = Math.atan2(iy - oy, ix - ox);
      if (!Number.isFinite(next)) break;
      angle = next;
    }
    return Number.isFinite(angle) ? angle : null;
  }

  // 跨过对手碰壁时刻时：按「法线出射」预测的折线二段提前量
  function twoSegmentLead(self, m, size, spawnR) {
    const w = wallContact(m.x, m.y, m.vx, m.vy, m.r, size);
    if (!w || !(w.t > 1e-4)) return null;
    const speed = len(m.vx, m.vy);
    if (speed < 1) return null;
    const p1x = geometry ? w.x : clamp(m.x + m.vx * w.t, m.r, size - m.r);
    const p1y = geometry ? w.y : clamp(m.y + m.vy * w.t, m.r, size - m.r);
    const out = rotate(w.nx, w.ny, 0);
    const v1x = out.x * speed;
    const v1y = out.y * speed;
    const s2 = BULLET_SPEED * BULLET_SPEED;
    let ox = self.x;
    let oy = self.y;
    let angle = null;
    for (let i = 0; i < 2; i += 1) {
      const dx = p1x - ox;
      const dy = p1y - oy;
      const u = smallestPositiveRoot(
        v1x * v1x + v1y * v1y - s2,
        2 * (dx * v1x + dy * v1y) - 2 * s2 * w.t,
        dx * dx + dy * dy - s2 * w.t * w.t
      );
      if (u === null) return null;
      angle = Math.atan2(p1y + v1y * u - oy, p1x + v1x * u - ox);
      if (!Number.isFinite(angle)) return null;
      ox = self.x + Math.cos(angle) * spawnR;
      oy = self.y + Math.sin(angle) * spawnR;
    }
    return angle;
  }

  // 候选角的期望命中概率：遍历对手碰壁后的所有合法出射方向
  function fanAngles(m, size) {
    const angles = [];
    for (let i = 0; i < FAN_SAMPLES; i += 1) {
      const frac = FAN_SAMPLES > 1 ? i / (FAN_SAMPLES - 1) : 0.5;
      angles.push((-BOUNCE_LIMIT + 2 * BOUNCE_LIMIT * frac) * DEG);
    }
    // 非枪手实体（例如 Boss）可能按镜面反射碰壁，把这个解也当作一个样本
    const w = wallContact(m.x, m.y, m.vx, m.vy, m.r, size);
    const speed = len(m.vx, m.vy);
    const singleAxis = w && (geometry || (w.nx === 0) !== (w.ny === 0));
    if (w && singleAxis && speed > 1e-6 && w.t > 1e-4) {
      const nx = w.nx;
      const ny = w.ny;
      const ux = m.vx / speed;
      const uy = m.vy / speed;
      const dot = ux * nx + uy * ny;
      const rx = ux - 2 * dot * nx;          // 镜面反射后的单位方向
      const ry = uy - 2 * dot * ny;
      const spec = Math.atan2(nx * ry - ny * rx, rx * nx + ry * ny);
      if (Number.isFinite(spec)) angles.push(clamp(spec / DEG, -BOUNCE_LIMIT, BOUNCE_LIMIT) * DEG);
    }
    return angles;
  }

  function impactProbability(self, angle, m, size, angles) {
    const spawnR = self.r + BULLET_RADIUS + 1;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0;
    const sx = self.x + dx * spawnR;
    const sy = self.y + dy * spawnR;
    const list = angles || fanAngles(m, size);
    let hits = 0;
    for (let i = 0; i < list.length; i += 1) {
      const target = { x: m.x, y: m.y, vx: m.vx, vy: m.vy, r: m.r, bounced: false };
      if (bulletHitsTarget(sx, sy, dx, dy, target, size, list[i], m.r + BULLET_RADIUS)) hits += 1;
    }
    return list.length > 0 ? hits / list.length : 0;
  }

  function bestAimAgainst(self, e, size, refine) {
    const m = modelEnemy(e);
    const spawnR = self.r + BULLET_RADIUS + 1;
    const candidates = [];
    const lead = straightLead(self, m, spawnR);
    if (lead !== null) candidates.push(lead);
    candidates.push(Math.atan2(m.y - self.y, m.x - self.x));
    const two = twoSegmentLead(self, m, size, spawnR);
    if (two !== null) candidates.push(two);
    // 对手下一堵墙的碰壁点是「与它的出射角无关」的确定坐标：扇形各方向到它的
    // 距离都相同，所以打这个点本身是跨过对手碰壁时刻后最稳的一枪
    const w = wallContact(m.x, m.y, m.vx, m.vy, m.r, size);
    if (w && w.t > 1e-4) {
      const px = geometry ? w.x : clamp(m.x + m.vx * w.t, m.r, size - m.r);
      const py = geometry ? w.y : clamp(m.y + m.vy * w.t, m.r, size - m.r);
      const wallPoint = Math.atan2(py - self.y, px - self.x);
      if (Number.isFinite(wallPoint)) candidates.push(wallPoint);
    }

    const unique = [];
    for (let i = 0; i < candidates.length; i += 1) {
      const a = candidates[i];
      if (!Number.isFinite(a)) continue;
      let dup = false;
      for (let k = 0; k < unique.length; k += 1) {
        if (Math.abs(angleDelta(a, unique[k])) < 0.02) { dup = true; break; }
      }
      if (!dup) unique.push(a);
    }

    const flight = Math.max(len(m.x - self.x, m.y - self.y), 1) / BULLET_SPEED;
    const angles = fanAngles(m, size);
    let best = null;
    for (let i = 0; i < unique.length; i += 1) {
      const prob = impactProbability(self, unique[i], m, size, angles);
      // 概率优先，其次期望飞行时间更短、枪口摆动更小
      const value = prob - 0.015 * Math.abs(angleDelta(unique[i], mem.aim));
      if (best === null || value > best.value) best = { angle: unique[i], prob: prob, value: value };
    }
    if (!best || !Number.isFinite(best.angle)) return null;

    // 真要开这一枪时再做一次邻域精修：跨过对手碰壁时刻的枪，最优角通常落在
    // 「直线提前量」与「对手碰壁点」之间，而不是两者的解析解上
    if (refine) {
      for (let step = 1; step <= 3; step += 1) {
        const spread = 0.03 * step;
        for (let s = -1; s <= 1; s += 2) {
          const cand = best.angle + s * spread;
          const prob = impactProbability(self, cand, m, size, angles);
          if (prob > best.prob + 1e-9) best = { angle: cand, prob: prob, value: prob };
        }
      }
    }
    return { angle: best.angle, prob: best.prob, flight: flight, hp: e.hp };
  }

  function chooseShot(ctx, ready) {
    const self = ctx.self;
    const cur = len(self.vx, self.vy) > 1 ? unit(self.vx, self.vy) : unit(mem.dirX, mem.dirY);
    let best = null;
    for (let i = 0; i < ctx.enemies.length; i += 1) {
      const e = ctx.enemies[i];
      if (!e.attackable || e.hp <= 0) continue;
      const shot = bestAimAgainst(ctx.self, e, ctx.size, ready);
      if (!shot) continue;
      let value = shot.prob
        - 0.45 * clamp(shot.flight, 0, 1)
        - 0.001 * Math.max(0, shot.hp)
        - 0.002 * i;
      if (ready) {
        // 后坐力是免费机动：这一枪把自身甩向的方向若能远离该目标，额外加分
        const post = recoilHeading(cur, shot.angle);
        const away = unit(self.x - e.x, self.y - e.y);
        value += 0.06 * (post.x * away.x + post.y * away.y);
      }
      if (best === null || value > best.value) best = { angle: shot.angle, prob: shot.prob, value: value };
    }
    return best;
  }

  /* ---------- 走位（碰壁转向 + 发射前安全检查） ---------- */
  function directionScore(px, py, dx, dy, ctx) {
    const size = ctx.size;
    const self = ctx.self;
    const step = ctx.mySpeed * SIM_DT;
    const w = wallContact(px, py, dx * ctx.mySpeed, dy * ctx.mySpeed, self.r, size);
    const nextContact = w ? w.t : 3;
    const steps = Math.round(clamp(nextContact / SIM_DT, 4, SIM_STEPS));
    const ownPoint = (stepIndex) => {
      if (!geometry) return { x: px + dx * step * stepIndex, y: py + dy * step * stepIndex };
      const duration = Math.min(stepIndex * SIM_DT, nextContact);
      return { x: px + dx * ctx.mySpeed * duration, y: py + dy * ctx.mySpeed * duration };
    };
    let score = 0;

    // 1) 敌弹规避：沿候选直线推进，取与每发敌弹的最小间隙
    for (let i = 0; i < ctx.hostiles.length; i += 1) {
      const src = ctx.hostiles[i];
      const b = {
        x: src.x, y: src.y, vx: src.vx, vy: src.vy,
        r: src.r, bounces: src.bounces, dead: false
      };
      let minGap = Infinity;
      for (let k = 1; k <= steps; k += 1) {
        stepProjectile(b, SIM_DT, size);
        if (b.dead) break;
        const own = ownPoint(k);
        const gap = len(own.x - b.x, own.y - b.y) - b.r - self.r;
        if (gap < minGap) minGap = gap;
      }
      if (minGap < BULLET_CLEAR) {
        const risk = clamp((BULLET_CLEAR - minGap) / BULLET_CLEAR, 0, 1);
        score -= 95 * risk * risk;
      }
    }

    // 2) 碰撞伤害规避 + 风筝距离
    for (let i = 0; i < ctx.enemies.length; i += 1) {
      const e = ctx.enemies[i];
      let ex = e.x;
      let ey = e.y;
      let evx = e.vx;
      let evy = e.vy;
      let minGap = Infinity;
      let gapSum = 0;
      for (let k = 1; k <= steps; k += 1) {
        if (geometry) {
          const moved = traceGunnerArenaFlight({ x: ex, y: ey, vx: evx, vy: evy,
            radius: e.r, remainingLife: SIM_DT }, geometry, SIM_DT);
          ex = moved.x; ey = moved.y; evx = moved.vx; evy = moved.vy;
        } else {
        ex += evx * SIM_DT;
        ey += evy * SIM_DT;
        if (ex < e.r) { ex = e.r; evx = -evx; } else if (ex > size - e.r) { ex = size - e.r; evx = -evx; }
        if (ey < e.r) { ey = e.r; evy = -evy; } else if (ey > size - e.r) { ey = size - e.r; evy = -evy; }
        }
        const own = ownPoint(k);
        const gap = len(own.x - ex, own.y - ey) - e.r - self.r;
        if (gap < minGap) minGap = gap;
        gapSum += gap;
      }
      if (e.solid && minGap < CONTACT_CLEAR) {
        const risk = clamp((CONTACT_CLEAR - minGap) / CONTACT_CLEAR, 0, 1);
        score -= 55 * risk * risk;
      }
      score += 10 * clamp(gapSum / steps / 120, 0, 1);
    }

    // 3) 开阔度：别贴墙贴角，留出后续机动余量
    const mid = Math.max(1, Math.floor(steps / 2));
    const midpoint = ownPoint(mid);
    const mx = midpoint.x;
    const my = midpoint.y;
    const openness = geometry ? (geometry.shape === "circle"
      ? geometry.width / 2 - Math.hypot(mx - geometry.centerX, my - geometry.centerY)
      : Math.min(mx - geometry.left, geometry.right - mx, my - geometry.top, geometry.bottom - my)) - self.r
      : Math.min(Math.min(mx, size - mx), Math.min(my, size - my)) - self.r;
    score += 14 * clamp(openness / 55, 0, 1);

    // 4) 机动节奏：长直线最容易被提前量打中，倾向尽快拿到下一个碰壁决策点
    score -= 9 * clamp((nextContact - 0.55) / 0.9, 0, 1);

    // 5) 反卡角：立刻又要碰壁说明这条候选线贴着墙/挤在墙角，
    //    既压缩了规避窗口，也让下一个决策点失去意义
    score -= 22 * clamp((0.3 - nextContact) / 0.3, 0, 1);

    // 6) 轻微抖动，避免走出可被长期预判的固定路线
    score += Math.random() * 2.5;
    return score;
  }

  function chooseBounce(px, py, inward, ctx) {
    let bestDeg = 0;
    let bestScore = -Infinity;
    for (let i = 0; i <= 20; i += 1) {
      const deg = -BOUNCE_LIMIT + i * (2 * BOUNCE_LIMIT / 20);
      const d = rotate(inward.x, inward.y, deg * DEG);
      const sc = directionScore(px, py, d.x, d.y, ctx);
      if (sc > bestScore) { bestScore = sc; bestDeg = deg; }
    }
    return clamp(bestDeg, -BOUNCE_LIMIT, BOUNCE_LIMIT);
  }

  // 底座用「位置 vs 半径」判断碰了哪堵墙；这里同构推断，角落时用在射速度消歧
  function inferInward(self, size, refVx, refVy) {
    if (geometry) return getGunnerWallNormal(geometry, self.x, self.y, self.r);
    const tol = 2;
    let ix = 0;
    let iy = 0;
    const nearLeft = self.x <= self.r + tol;
    const nearRight = self.x >= size - self.r - tol;
    const nearTop = self.y <= self.r + tol;
    const nearBottom = self.y >= size - self.r - tol;
    if (nearLeft && !nearRight) ix = 1;
    else if (nearRight && !nearLeft) ix = -1;
    if (nearTop && !nearBottom) iy = 1;
    else if (nearBottom && !nearTop) iy = -1;
    if (ix !== 0 && iy !== 0) {
      const dotX = ix * refVx;
      const dotY = iy * refVy;
      if (dotX > 0 && dotY <= 0) ix = 0;
      else if (dotY > 0 && dotX <= 0) iy = 0;
    }
    if (ix === 0 && iy === 0) {
      let fx = -refVx;
      let fy = -refVy;
      if (self.x < size / 2 && fx < 0) fx = -fx;
      if (self.x > size / 2 && fx > 0) fx = -fx;
      if (self.y < size / 2 && fy < 0) fy = -fy;
      if (self.y > size / 2 && fy > 0) fy = -fy;
      if (Math.abs(fx) < 1e-9 && Math.abs(fy) < 1e-9) { fx = 1; fy = 0; }
      return unit(fx, fy);
    }
    return unit(ix, iy);
  }

  function planBounceAhead(ctx) {
    const self = ctx.self;
    const dir = len(self.vx, self.vy) > 1 ? unit(self.vx, self.vy) : unit(mem.dirX, mem.dirY);
    const w = wallContact(self.x, self.y, dir.x * ctx.mySpeed, dir.y * ctx.mySpeed, self.r, ctx.size);
    if (!w) return clamp(mem.plannedBounce, -BOUNCE_LIMIT, BOUNCE_LIMIT);
    const px = geometry ? w.x : clamp(self.x + dir.x * ctx.mySpeed * w.t, self.r, ctx.size - self.r);
    const py = geometry ? w.y : clamp(self.y + dir.y * ctx.mySpeed * w.t, self.r, ctx.size - self.r);
    return chooseBounce(px, py, { x: w.nx, y: w.ny }, ctx);
  }

  // 发射的后坐甩向：normalize(150*当前航向 - 325*瞄准方向)
  function recoilHeading(cur, angle) {
    return unit(
      cur.x * CRUISE_SPEED - Math.cos(angle) * RECOIL_SPEED,
      cur.y * CRUISE_SPEED - Math.sin(angle) * RECOIL_SPEED
    );
  }

  /* ---------- 决策主体 ---------- */
  function decideWith(ctx) {
    const self = ctx.self;
    mem.prevVx = self.vx;
    mem.prevVy = self.vy;
    if (len(self.vx, self.vy) > 1) {
      mem.dirX = self.vx;
      mem.dirY = self.vy;
    }

    if (ctx.time - mem.planTime >= 0.12) {
      mem.plannedBounce = planBounceAhead(ctx);
      mem.planTime = ctx.time;
    }

    const ready = self.cooldown <= 0;
    const shot = chooseShot(ctx, ready);
    const action = {
      fire: false,
      aimAngle: shot ? shot.angle : mem.aim,
      bounceAngle: clamp(mem.plannedBounce, -BOUNCE_LIMIT, BOUNCE_LIMIT)
    };
    if (!shot) {
      mem.hold = 0;
      mem.aim = num(action.aimAngle, mem.aim);
      return action;
    }
    mem.aim = shot.angle;

    // 冷却未结束不请求发射（避免被拒的忙等），到点即射
    if (!ready) {
      mem.hold = 0;
      return action;
    }

    // 后坐甩向的双重用途：能把航向甩离敌弹 = 白捡一次逃逸机动（放宽门限）；
    // 会把航向甩进敌弹/对手而当前航线安全 = 压一帧再打（最多 0.3s，不能因噎废食）
    const sinceFire = mem.lastFire < -900 ? 99 : ctx.time - mem.lastFire;
    let dodging = false;
    if (ctx.hostiles.length > 0) {
      const cur = len(self.vx, self.vy) > 1 ? unit(self.vx, self.vy) : unit(mem.dirX, mem.dirY);
      const post = recoilHeading(cur, shot.angle);
      const scoreCur = directionScore(self.x, self.y, cur.x, cur.y, ctx);
      const scorePost = directionScore(self.x, self.y, post.x, post.y, ctx);
      if (scorePost > scoreCur + DODGE_GAIN) dodging = true;
      else if (scorePost < scoreCur - HOLD_PENALTY && mem.hold < MAX_HOLD_TICKS) {
        mem.hold += 1;
        return action;
      }
    }
    const relaxed = dodging || sinceFire >= FIRE_LATE_WAIT;
    const gate = relaxed ? FIRE_PROB_LATE : FIRE_PROB;
    if (shot.prob < gate) {
      mem.hold = 0;
      return action;
    }
    mem.hold = 0;
    mem.lastFire = ctx.time;
    action.fire = true;
    return action;
  }

  function safeAction() {
    return {
      fire: false,
      aimAngle: num(mem.aim, 0),
      bounceAngle: clamp(mem.plannedBounce, -BOUNCE_LIMIT, BOUNCE_LIMIT)
    };
  }

  function resetMemory() {
    mem.aim = 0;
    mem.plannedBounce = 0;
    mem.planTime = -999;
    mem.lastFire = -999;
    mem.hold = 0;
    mem.prevVx = 1;
    mem.prevVy = 0;
    mem.dirX = 1;
    mem.dirY = 0;
    mem.fired = 0;
    mem.damaged = 0;
  }

  return {
    onStart(observation) {
      try {
        resetMemory();
        const ctx = readObservation(observation);
        if (ctx && len(ctx.self.vx, ctx.self.vy) > 1) {
          mem.dirX = ctx.self.vx;
          mem.dirY = ctx.self.vy;
          mem.prevVx = ctx.self.vx;
          mem.prevVy = ctx.self.vy;
        }
      } catch (_error) {
        resetMemory();
      }
    },

    decide(observation) {
      try {
        const ctx = readObservation(observation);
        if (!ctx) return safeAction();
        const action = decideWith(ctx);
        if (!Number.isFinite(action.aimAngle)) action.aimAngle = mem.aim;
        action.aimAngle = num(action.aimAngle, 0);
        action.bounceAngle = clamp(action.bounceAngle, -BOUNCE_LIMIT, BOUNCE_LIMIT);
        return action;
      } catch (_error) {
        return safeAction();
      }
    },

    onWallBounce(observation) {
      try {
        const ctx = readObservation(observation);
        if (!ctx) return { bounceAngle: clamp(mem.plannedBounce, -BOUNCE_LIMIT, BOUNCE_LIMIT) };
        const self = ctx.self;
        const inward = inferInward(self, ctx.size, mem.prevVx, mem.prevVy);
        const deg = chooseBounce(self.x, self.y, inward, ctx);
        mem.plannedBounce = deg;
        // 出射角本身不做预判价值，加小抖动让路径不可长期拟合
        return { bounceAngle: clamp(deg + (Math.random() * 3 - 1.5), -BOUNCE_LIMIT, BOUNCE_LIMIT) };
      } catch (_error) {
        return { bounceAngle: clamp(mem.plannedBounce, -BOUNCE_LIMIT, BOUNCE_LIMIT) };
      }
    },

    onEvent(event) {
      try {
        if (!event || typeof event !== "object") return;
        if (event.type === "damaged") mem.damaged += num(event.amount, 0);
        else if (event.type === "fire") mem.fired += 1;
      } catch (_error) {
        // 事件回调绝不影响比赛
      }
    }
  };
}

const gunnerHDefinition = createGunnerDefinition({
  id: "gunnerH",
  name: "枪手H",
  englishName: "Gunner H",
  color: "#8a2be2",
  description: "紫色自由策略枪手 / 解析提前量、风险采样与后坐力走位",
  policyFactory: createGunnerHPolicy
});

registerBall(gunnerHDefinition);
return { createGunnerHPolicy, gunnerHDefinition };
});
