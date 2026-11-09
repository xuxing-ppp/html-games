(function initializeGunnerX(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./gunner.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGunnerXPlugin(dependencies) {
  "use strict";
  const { createGunnerDefinition, registerBall, getGunnerArenaGeometry,
    getGunnerWallNormal, traceGunnerArenaFlight } = dependencies;

  // Exact winning submission; only the factory name changes.
function createGunnerXPolicy() {
  let geometry = null;
  // ==================== 答题区：枪手 A ====================
  // 确定性预测控制；只读取公开快照，不依赖角色名或出生位置。
  const PI = Math.PI;
  const history = new Map();
  const contacts = new Map();
  let contactQueue = [], recentDamage = 0, lockedId = null, hasSummons = false;
  function learnContacts() {
    for (const id of contactQueue) {
      const h = contacts.get(id) || { count: 0, damage: 0 };
      h.count++; h.damage += recentDamage;
      contacts.set(id, h);
    }
    while (contacts.size > 64) contacts.delete(contacts.keys().next().value);
    contactQueue = []; recentDamage = 0;
  }
  function remember(o) {
    const seen = new Set();
    for (const e of o.enemies || []) {
      seen.add(e.instanceId);
      const h = history.get(e.instanceId) || { vanished: false, hidden: false };
      if (h.hidden) h.vanished = true;
      h.hidden = false; h.time = o.time; h.hp = e.hp;
      history.set(e.instanceId, h);
    }
    for (const [id, h] of history) {
      if (!seen.has(id)) h.hidden = true;
      if (o.time - h.time > 8 || h.hp <= 0) history.delete(id);
    }
    while (history.size > 128) history.delete(history.keys().next().value);
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (x, d = 0) => Number.isFinite(x) ? x : d;
  function fold(x, r, size) {
    const w = size - 2 * r;
    if (w <= 0) return size / 2;
    let q = ((x - r) % (2 * w) + 2 * w) % (2 * w);
    return r + (q <= w ? q : 2 * w - q);
  }
  function position(e, t, size) {
    if (!num(e.vx) && !num(e.vy)) return { x: e.x, y: e.y };
    for (const g of e.forecastSegments || []) {
      if (t >= g.t0 - 1e-8 && t <= g.t1 + 1e-8)
        return { x: g.x1 + g.vx * (t - g.t0), y: g.y1 + g.vy * (t - g.t0) };
    }
    if (geometry) return traceGunnerArenaFlight({ ...e,
      vx: num(e.vx), vy: num(e.vy), radius: num(e.radius, 15), remainingLife: t
    }, geometry, t);
    return { x: fold(e.x + num(e.vx) * t, num(e.radius, 15), size),
      y: fold(e.y + num(e.vy) * t, num(e.radius, 15), size) };
  }
  function intercept(s, e) {
    let best = null;
    const segments = e.forecastSegments && e.forecastSegments.length ? e.forecastSegments :
      [{ t0: 0, t1: 1.5, x1: e.x, y1: e.y, vx: num(e.vx), vy: num(e.vy) }];
    for (const g of segments) {
      const x = g.x1 - g.vx * g.t0 - s.x, y = g.y1 - g.vy * g.t0 - s.y;
      const a = g.vx * g.vx + g.vy * g.vy - 160000;
      const b = 2 * (x * g.vx + y * g.vy - 400 * 19);
      const c = x * x + y * y - 19 * 19;
      const d = b * b - 4 * a * c;
      const roots = Math.abs(a) < 1e-6 ? [-c / b] : d >= 0 ?
        [(-b - Math.sqrt(d)) / (2 * a), (-b + Math.sqrt(d)) / (2 * a)] : [];
      for (const t of roots) {
        if (t >= Math.max(0, g.t0) - 1e-8 && t <= g.t1 + 1e-8 && t < 2.4 && (!best || t < best.t)) {
          best = { t, angle: Math.atan2(y + g.vy * t, x + g.vx * t), e };
        }
      }
    }
    return best || { t: Math.hypot(e.x - s.x, e.y - s.y) / 400,
      angle: Math.atan2(e.y - s.y, e.x - s.x), e };
  }
  function segmentDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const f = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(x - ax - f * dx, y - ay - f * dy);
  }
  // 每次搜索只预计算一次预测数据，避免候选角度重复遍历冻结对象。
  function prepare(o) {
    const frames = [], s = o.self, size = o.arena.size;
    const enemies = (o.enemies || []).filter(e => e.hp > 0).slice(0, 24);
    const threats = (o.threats || []).filter(e => num(e.damage, 3) > 0)
      .map(e => ({ e, rank: num(e.damage, 3) / (20 + Math.max(0, Math.hypot(s.x - e.x, s.y - e.y) - num(e.radius))) }))
      .sort((a, b) => b.rank - a.rank).slice(0, 32).map(v => v.e);
    for (let i = 1; i <= 10; ++i) {
      const t = i * (hasSummons && size < 250 ? 0.05 : 0.075), bodies = [], hazards = [];
      for (const e of enemies) {
        const p = position(e, t, size), c = e.capabilities || {};
        const harm = c.canBodyAttack === false || c.canDealDamage === false ? 0 : num(e.bodyDamage, 4);
        const learned = contacts.get(e.instanceId);
        // 未知本体伤害默认保守；仅根据可观测的显隐或低损碰撞记录放宽。
        const contactWindow = e.bodyDamage == null && ((history.get(e.instanceId) || {}).vanished ||
          (learned && learned.count >= 2 && learned.damage / learned.count < 0.7));
        bodies.push({ x: p.x, y: p.y, r: s.radius + num(e.radius, 15),
          cost: e.solid === false ? 0 : hasSummons && size < 250 ? (e.maxHp >= 50 ? -70 * (1 + 2 * (1 - e.hp / Math.max(1, e.maxHp))) : 4) : contactWindow ? -20 : harm * 3 - (e.attackable === false ? 0 : 4) });
      }
      for (const e of threats) {
        const aw = e.activeWindow || {};
        if ((e.remainingLife != null && e.remainingLife < t) || num(aw.from) > t || (aw.until != null && aw.until < t)) continue;
        if (geometry && Number.isInteger(e.remainingBounces) && e.forecastSegments &&
            e.forecastSegments.length && e.forecastSegments[e.forecastSegments.length - 1].t1 < t) continue;
        const p = position(e, t, size), sh = e.shape || {};
        const h = { x: p.x, y: p.y, r: s.radius + num(e.radius), cost: num(e.damage, 3) * 3 };
        if (sh.type === 'segment' && [sh.startX, sh.startY, sh.endX, sh.endY].every(Number.isFinite)) {
          h.ax = sh.startX + p.x - e.x; h.ay = sh.startY + p.y - e.y;
          h.bx = sh.endX + p.x - e.x; h.by = sh.endY + p.y - e.y;
          h.r = s.radius + num(sh.width, 2 * num(e.radius)) / 2;
        }
        const margin = h.r + 36;
        h.minX = Math.min(h.ax == null ? h.x : h.ax, h.bx == null ? h.x : h.bx) - margin;
        h.maxX = Math.max(h.ax == null ? h.x : h.ax, h.bx == null ? h.x : h.bx) + margin;
        h.minY = Math.min(h.ay == null ? h.y : h.ay, h.by == null ? h.y : h.by) - margin;
        h.maxY = Math.max(h.ay == null ? h.y : h.ay, h.by == null ? h.y : h.by) + margin;
        hazards.push(h);
      }
      frames.push({ t, w: (1 - t * 0.65) / 10, bodies, hazards });
    }
    return frames;
  }
  function pathScore(o, vx, vy, frames, recoil = false) {
    const s = o.self, size = o.arena.size;
    let value = 0;
    const speed = Math.hypot(vx, vy) || 150;
    let wall = 100;
    if (vx > 0) wall = Math.min(wall, (size - s.radius - s.x) / vx);
    if (vx < 0) wall = Math.min(wall, (s.radius - s.x) / vx);
    if (vy > 0) wall = Math.min(wall, (size - s.radius - s.y) / vy);
    if (vy < 0) wall = Math.min(wall, (s.radius - s.y) / vy);
    if (geometry && speed > 0) wall = geometry.movementLimit(
      s.x, s.y, vx / speed, vy / speed, Number.MAX_VALUE, s.radius
    ) / speed;
    for (const f of frames) {
      const travel = recoil ? Math.min(0.06, f.t) + Math.max(0, f.t - 0.06) * 150 / speed : f.t;
      const q = geometry ? traceGunnerArenaFlight({ ...s, vx, vy, remainingLife: travel }, geometry, travel)
        : { x: fold(s.x + vx * travel, s.radius, size), y: fold(s.y + vy * travel, s.radius, size) };
      const w = f.w * ((!hasSummons || size > 250) && travel > wall + 0.04 ? 0.25 : 1);
      let nearest = size;
      for (const b of f.bodies) {
        const d = Math.hypot(q.x - b.x, q.y - b.y);
        nearest = Math.min(nearest, d);
        const z = Math.max(0, d - b.r) / 17;
        if (z < 3) value -= w * b.cost * Math.exp(-z * z);
      }
      value -= size > 250 ? f.w * Math.max(0, size * 0.72 - nearest) * 0.035 : w * Math.abs(nearest - 85) * 0.009;
      for (const h of f.hazards) {
        if (q.x < h.minX || q.x > h.maxX || q.y < h.minY || q.y > h.maxY) continue;
        const d = h.ax == null ? Math.hypot(q.x - h.x, q.y - h.y) : segmentDistance(q.x, q.y, h.ax, h.ay, h.bx, h.by);
        const z = Math.max(0, d - h.r) / 12;
        if (z < 3) value -= w * h.cost * Math.exp(-z * z);
      }
    }
    return value;
  }
  return {
    onStart() { history.clear(); contacts.clear(); contactQueue = []; recentDamage = 0; lockedId = null; hasSummons = false; },
    decide(o) {
      geometry = getGunnerArenaGeometry(o.arena);
      learnContacts();
      remember(o);
      if ((o.enemies || []).some(e => e.maxHp > 0 && e.maxHp < 20)) hasSummons = true;
      const s = o.self;
      if (!s || num(s.fireCooldown) > 1e-8 || num(s.recoilRemaining) > 1e-8)
        return { fire: false, aimAngle: 0 };
      const frames = prepare(o), speed = Math.hypot(s.vx, s.vy) || 150;
      const ux = s.vx * 150 / speed, uy = s.vy * 150 / speed;
      let best = null, score = -Infinity;
      const candidates = [];
      for (const e of (o.enemies || []).slice(0, 32)) {
        if (e.attackable === false || e.hp <= 0) continue;
        const shot = intercept(s, e);
        const priority = e.maxHp >= s.maxHp * 0.5 ? 1 : 0.3;
        const reward = priority * (4 + 5 * (1 - e.hp / Math.max(1, e.maxHp)) +
          (e.instanceId === lockedId ? 1.5 : 0)) / (1 + shot.t);
        candidates.push({ e, shot, reward });
      }
      candidates.sort((a, b) => b.reward - a.reward);
      for (const { e, shot, reward } of candidates.slice(0, 4)) {
        for (const offset of [0, -0.08, 0.08]) {
          const angle = shot.angle + offset;
          const v = reward * (offset ? 0.96 : 1) + pathScore(o, ux - 325 * Math.cos(angle), uy - 325 * Math.sin(angle), frames, true);
          if (v > score) { score = v; best = { angle, e }; }
        }
      }
      // 无目标或直接射击会陷入危险时，也可用后坐力作有限的逃逸机动。
      const safe = pathScore(o, ux, uy, frames);
      if (score < safe - 0.5 || !best) {
        for (let k = 0; k < 16; ++k) {
          const angle = k * PI / 8;
          const v = pathScore(o, ux - 325 * Math.cos(angle), uy - 325 * Math.sin(angle), frames, true) - 0.8;
          if (v > score && v > safe + 0.5) { score = v; best = { angle, e: null }; }
        }
        if (score < safe - 0.5) return { fire: false, aimAngle: 0 };
      }
      if (best && best.e) lockedId = best.e.instanceId;
      return best ? { fire: true, aimAngle: best.angle, targetId: best.e ? best.e.instanceId : null } : { fire: false, aimAngle: 0 };
    },
    onWallBounce(o) {
      geometry = getGunnerArenaGeometry(o.arena);
      const s = o.self, n = o.arena.size, r = s.radius;
      let nx = s.x <= r + 0.001 ? 1 : s.x >= n - r - 0.001 ? -1 : 0;
      let ny = s.y <= r + 0.001 ? 1 : s.y >= n - r - 0.001 ? -1 : 0;
      if (!nx && !ny) { nx = -num(s.vx, 1); ny = -num(s.vy); }
      if (geometry) ({ x: nx, y: ny } = getGunnerWallNormal(geometry, s.x, s.y, r, 0.001));
      const base = Math.atan2(ny, nx), frames = prepare(o);
      // 暂时失去所有目标时保持大幅横向机动，避免在同一直线上往返。
      if (!(o.enemies || []).length) {
        const cx = n / 2 - s.x, cy = n / 2 - s.y;
        return { bounceAngle: (Math.cos(base) * cy - Math.sin(base) * cx >= 0 ? 1 : -1) * 60 };
      }
      let best = 0, score = -Infinity;
      for (let a = -75; a <= 75; a += 10) {
        const angle = base + a * PI / 180;
        const v = pathScore(o, 150 * Math.cos(angle), 150 * Math.sin(angle), frames) - Math.abs(a) * 0.0001;
        if (v > score) { score = v; best = a; }
      }
      return { bounceAngle: best };
    },
    onEvent(e) {
      if (e.type === 'collision-hit' && e.damaged && contactQueue.length < 16) contactQueue.push(e.targetId);
      if (e.type === 'damaged') recentDamage += num(e.amount);
    }
  };
}

  const gunnerXDefinition = createGunnerDefinition({
    id: "gunnerX",
    name: "枪手",
    englishName: "Gunner",
    color: "#049381",
    description: "2026-09-26 A 策略 / 预测走位与射击决策",
    policyFactory: createGunnerXPolicy
  });

  registerBall(gunnerXDefinition);

  return { createGunnerXPolicy, gunnerXDefinition };
});
