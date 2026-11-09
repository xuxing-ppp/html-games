(function initializeGunnerD(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./gunner.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGunnerDPlugin(dependencies) {
  "use strict";
  const { createGunnerDefinition, registerBall, getGunnerArenaGeometry,
    getGunnerWallNormal, traceGunnerArenaFlight } = dependencies;

function createGunnerDPolicy() {
  let geometry = null;
  // ==================== 答题区：枪手 D ====================
  // 只能修改这个函数内的策略逻辑。固定属性和引擎由裁判管理。
  const EPS = 1e-9;
  const BULLET_SPEED = 400;
  const BULLET_RADIUS = 3;
  const BULLET_LIFE = 2.4;
  const RECOIL_SPEED = 325;
  const MAX_BOUNCE_DEG = 75;

  const mem = {
    seen: Object.create(null),
    lastAim: 0,
    damageHeat: 0
  };

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function hypot2(x, y) {
    return x * x + y * y;
  }

  function normalize(x, y, fbX, fbY) {
    const mag = Math.hypot(x, y);
    if (!(mag > EPS)) {
      const fbMag = Math.hypot(fbX || 0, fbY || 0);
      if (fbMag > EPS) return { x: fbX / fbMag, y: fbY / fbMag };
      return { x: 1, y: 0 };
    }
    return { x: x / mag, y: y / mag };
  }

  function aimAt(dx, dy, fallback) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return finite(fallback, 0);
    if (Math.abs(dx) <= EPS && Math.abs(dy) <= EPS) return finite(fallback, 0);
    const angle = Math.atan2(dy, dx);
    return Number.isFinite(angle) ? angle : finite(fallback, 0);
  }

  function pingpong(coord, vel, min, span, time) {
    if (!(span > EPS)) return min;
    let rel = coord - min + vel * time;
    const period = span * 2;
    rel -= period * Math.floor(rel / period);
    if (rel < 0) rel += period;
    return (rel <= span ? rel : period - rel) + min;
  }

  function predictPos(x, y, vx, vy, radius, arena, time) {
    const r = finite(radius, 15);
    if (geometry) return traceGunnerArenaFlight({ x, y, vx, vy, radius: r,
      remainingLife: Math.max(0, time) }, geometry, Math.max(0, time));
    const min = r;
    const span = arena - r * 2;
    if (!(span > 1) || !Number.isFinite(time)) {
      return { x: finite(x, 0), y: finite(y, 0) };
    }
    return {
      x: pingpong(finite(x, 0), finite(vx, 0), min, span, time),
      y: pingpong(finite(y, 0), finite(vy, 0), min, span, time)
    };
  }

  function quadraticIntercept(ox, oy, tx, ty, tvx, tvy, speed, gap) {
    const rx = tx - ox;
    const ry = ty - oy;
    const a = tvx * tvx + tvy * tvy - speed * speed;
    const b = 2 * (rx * tvx + ry * tvy - speed * gap);
    const c = rx * rx + ry * ry - gap * gap;
    const roots = [];
    if (Math.abs(a) < 1e-8) {
      if (Math.abs(b) < 1e-8) return null;
      roots.push(-c / b);
    } else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return null;
      const sqrtDisc = Math.sqrt(disc);
      roots.push((-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a));
    }
    let bestT = null;
    for (let i = 0; i < roots.length; i++) {
      const t = roots[i];
      if (!Number.isFinite(t) || t < 0.004 || t > BULLET_LIFE) continue;
      if (bestT === null || t < bestT) bestT = t;
    }
    if (bestT === null) return null;
    const hx = rx + tvx * bestT;
    const hy = ry + tvy * bestT;
    const angle = aimAt(hx, hy, null);
    if (!Number.isFinite(angle)) return null;
    return { t: bestT, angle };
  }

  function timeToHit(px, py, pvx, pvy, qx, qy, qvx, qvy, rad, horizon) {
    const rx = px - qx;
    const ry = py - qy;
    const rvx = pvx - qvx;
    const rvy = pvy - qvy;
    const c = hypot2(rx, ry) - rad * rad;
    if (c <= 0) return 0;
    const a = hypot2(rvx, rvy);
    if (a < 1e-12) return 99;
    const b = 2 * (rx * rvx + ry * rvy);
    const disc = b * b - 4 * a * c;
    if (disc < 0) return 99;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (Number.isFinite(t) && t >= 0 && t <= horizon) return t;
    return 99;
  }

  function listFrom(value) {
    return Array.isArray(value) ? value : [];
  }

  function readArena(observation) {
    geometry = getGunnerArenaGeometry(observation && observation.arena);
    const size = observation && observation.arena ? observation.arena.size : 200;
    return finite(size, 200);
  }

  function remember(observation) {
    const time = finite(observation.time, 0);
    const enemies = listFrom(observation.enemies);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.instanceId === undefined || e.instanceId === null) continue;
      const id = String(e.instanceId);
      if (!id) continue;
      mem.seen[id] = {
        instanceId: id,
        x: finite(e.x, 0),
        y: finite(e.y, 0),
        vx: finite(e.vx, 0),
        vy: finite(e.vy, 0),
        radius: finite(e.radius, 15),
        hp: finite(e.hp, 8),
        maxHp: finite(e.maxHp, 8),
        solid: e.solid !== false,
        attackable: e.attackable !== false,
        time
      };
    }
    const ids = Object.keys(mem.seen);
    for (let i = 0; i < ids.length; i++) {
      if (time - mem.seen[ids[i]].time > 0.55) delete mem.seen[ids[i]];
    }
  }

  function collectTargets(observation) {
    const live = [];
    const seenLive = Object.create(null);
    const enemies = listFrom(observation.enemies);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e) continue;
      const id = e.instanceId === undefined || e.instanceId === null ? "" : String(e.instanceId);
      live.push({
        instanceId: id,
        x: finite(e.x, 0),
        y: finite(e.y, 0),
        vx: finite(e.vx, 0),
        vy: finite(e.vy, 0),
        radius: finite(e.radius, 15),
        hp: finite(e.hp, 8),
        solid: e.solid !== false,
        attackable: e.attackable !== false,
        ghost: false
      });
      if (id) seenLive[id] = true;
    }
    const ids = Object.keys(mem.seen);
    for (let i = 0; i < ids.length; i++) {
      if (seenLive[ids[i]]) continue;
      const rec = mem.seen[ids[i]];
      live.push({
        instanceId: rec.instanceId,
        x: rec.x,
        y: rec.y,
        vx: rec.vx,
        vy: rec.vy,
        radius: rec.radius,
        hp: rec.hp,
        solid: rec.solid,
        attackable: rec.attackable,
        ghost: true
      });
    }
    return live;
  }

  function spawnGap(self) {
    return finite(self.radius, 15) + BULLET_RADIUS + 1;
  }

  function spawnInside(self, angle, arena) {
    const gap = spawnGap(self);
    const x = self.x + Math.cos(angle) * gap;
    const y = self.y + Math.sin(angle) * gap;
    if (geometry) return geometry.contains(x, y, BULLET_RADIUS);
    return x >= BULLET_RADIUS && y >= BULLET_RADIUS &&
      x <= arena - BULLET_RADIUS && y <= arena - BULLET_RADIUS;
  }

  function sampledIntercept(self, enemy, arena, gap) {
    let best = null;
    let bestErr = 1e9;
    for (let i = 1; i <= 48; i++) {
      const t = i * 0.045;
      const p = predictPos(enemy.x, enemy.y, enemy.vx, enemy.vy, enemy.radius, arena, t);
      const dist = Math.hypot(p.x - self.x, p.y - self.y);
      const need = (dist - gap) / BULLET_SPEED;
      const err = Math.abs(need - t);
      if (err < bestErr && Number.isFinite(need)) {
        bestErr = err;
        best = { t, angle: aimAt(p.x - self.x, p.y - self.y, mem.lastAim), err };
      }
    }
    if (!best || bestErr > 0.14) return null;
    return best;
  }

  function addBankAims(aims, self, enemy, arena, gap) {
    const br = BULLET_RADIUS;
    if (geometry && geometry.shape === "circle") {
      for (let i = 2; i <= 22; i++) {
        const t = i * 0.09;
        const p = predictPos(enemy.x, enemy.y, enemy.vx, enemy.vy, enemy.radius, arena, t);
        for (let sample = 0; sample < 64; sample++) {
          const a = sample * Math.PI / 32;
          const nx = -Math.cos(a), ny = -Math.sin(a);
          const wx = geometry.centerX - nx * (geometry.width / 2 - br);
          const wy = geometry.centerY - ny * (geometry.width / 2 - br);
          const incoming = normalize(wx - self.x, wy - self.y, 1, 0);
          const dot = incoming.x * nx + incoming.y * ny;
          const rx = incoming.x - 2 * dot * nx, ry = incoming.y - 2 * dot * ny;
          const along = (p.x - wx) * rx + (p.y - wy) * ry;
          if (along < 0 || Math.abs((p.x - wx) * ry - (p.y - wy) * rx) > enemy.radius + br) continue;
          const need = (Math.hypot(wx - self.x, wy - self.y) + along - gap) / BULLET_SPEED;
          if (Math.abs(need - t) <= 0.08) aims.push({ angle: Math.atan2(incoming.y, incoming.x),
            t, id: enemy.instanceId, kind: "bank" });
        }
      }
      return;
    }
    const left = geometry ? geometry.left : 0;
    const right = geometry ? geometry.right : arena;
    const top = geometry ? geometry.top : 0;
    const bottom = geometry ? geometry.bottom : arena;
    const walls = [
      (x, y) => ({ x: 2 * (left + br) - x, y }),
      (x, y) => ({ x: 2 * (right - br) - x, y }),
      (x, y) => ({ x, y: 2 * (top + br) - y }),
      (x, y) => ({ x, y: 2 * (bottom - br) - y })
    ];
    for (let i = 2; i <= 22; i++) {
      const t = i * 0.09;
      const p = predictPos(enemy.x, enemy.y, enemy.vx, enemy.vy, enemy.radius, arena, t);
      for (let w = 0; w < walls.length; w++) {
        const virt = walls[w](p.x, p.y);
        const dx = virt.x - self.x;
        const dy = virt.y - self.y;
        const dist = Math.hypot(dx, dy);
        const need = (dist - gap) / BULLET_SPEED;
        if (!Number.isFinite(need) || Math.abs(need - t) > 0.08) continue;
        const angle = aimAt(dx, dy, null);
        if (!Number.isFinite(angle)) continue;
        aims.push({ angle, t, id: enemy.instanceId, kind: "bank" });
      }
    }
  }

  function uniqueAims(aims) {
    const out = [];
    for (let i = 0; i < aims.length; i++) {
      const a = aims[i];
      if (!a || !Number.isFinite(a.angle)) continue;
      let dup = false;
      for (let j = 0; j < out.length; j++) {
        let d = Math.abs(a.angle - out[j].angle) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d < 0.035) {
          dup = true;
          break;
        }
      }
      if (!dup) out.push(a);
    }
    return out;
  }

  function traceHit(self, angle, enemies, arena) {
    const gap = spawnGap(self);
    const dirx = Math.cos(angle);
    const diry = Math.sin(angle);
    if (!Number.isFinite(dirx) || !Number.isFinite(diry)) return null;
    if (geometry) {
      const spawn = geometry.clampPoint(self.x + dirx * gap, self.y + diry * gap, BULLET_RADIUS);
      const flight = traceGunnerArenaFlight({ ...spawn, vx: dirx * BULLET_SPEED, vy: diry * BULLET_SPEED,
        radius: BULLET_RADIUS, remainingBounces: 1, remainingLife: 2.2 }, geometry, 2.2);
      for (const segment of flight.segments) {
        for (let t = segment.t0; t < segment.t1; t += 0.025) {
          const end = Math.min(segment.t1, t + 0.025);
          const ax = segment.x1 + segment.vx * (t - segment.t0);
          const ay = segment.y1 + segment.vy * (t - segment.t0);
          const dx = segment.vx * (end - t), dy = segment.vy * (end - t);
          for (const e of enemies) {
            if (!e || e.attackable === false) continue;
            const p = predictPos(e.x, e.y, e.vx, e.vy, e.radius, arena, end);
            const u = clamp(((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
            if (hypot2(p.x - ax - u * dx, p.y - ay - u * dy) <= (e.radius + BULLET_RADIUS) ** 2) {
              return { id: e.instanceId, t: end, enemy: e };
            }
          }
        }
      }
      return null;
    }
    let x = self.x + dirx * gap;
    let y = self.y + diry * gap;
    let vx = dirx * BULLET_SPEED;
    let vy = diry * BULLET_SPEED;
    let bounces = 0;
    const dt = 0.025;
    const min = BULLET_RADIUS;
    const max = arena - BULLET_RADIUS;
    const steps = 88;
    for (let step = 1; step <= steps; step++) {
      let nx = x + vx * dt;
      let ny = y + vy * dt;
      let bounced = false;
      if (nx < min || nx > max) {
        if (bounces >= 1) return null;
        nx = nx < min ? min : max;
        vx = -vx;
        bounces += 1;
        bounced = true;
      }
      if (ny < min || ny > max) {
        if (bounces >= 1 && !bounced) return null;
        ny = ny < min ? min : max;
        vy = -vy;
        if (!bounced) bounces += 1;
      }
      const t = step * dt;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e || e.attackable === false) continue;
        const p = predictPos(e.x, e.y, e.vx, e.vy, e.radius, arena, t);
        const rad = e.radius + BULLET_RADIUS;
        if (hypot2(p.x - nx, p.y - ny) <= rad * rad) {
          return { id: e.instanceId, t, enemy: e };
        }
      }
      x = nx;
      y = ny;
    }
    return null;
  }

  function recoilHeading(self, angle) {
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    return normalize(
      finite(self.vx, 0) - ax * RECOIL_SPEED,
      finite(self.vy, 0) - ay * RECOIL_SPEED,
      -ax,
      -ay
    );
  }

  function pickFocus(self, enemies) {
    let best = null;
    let bestScore = -1e9;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.attackable === false) continue;
      const range = Math.max(
        6,
        Math.hypot(e.x - self.x, e.y - self.y) - e.radius - finite(self.radius, 15)
      );
      const approaching =
        (e.vx - finite(self.vx, 0)) * (e.x - self.x) +
        (e.vy - finite(self.vy, 0)) * (e.y - self.y) < 0;
      const hp = Math.max(0.6, finite(e.hp, 8));
      let score = 55 / range + 7 / hp + (approaching ? 0.55 : 0);
      if (e.radius >= 22) score += 0.25;
      if (e.ghost) score -= 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  function computeDesired(self, enemies, projectiles, entities, arena) {
    const cx = arena * 0.5;
    const cy = arena * 0.5;
    const r = finite(self.radius, 15);
    let wx = 0;
    let wy = 0;

    const margin = 34;
    if (self.x < r + margin) wx += (r + margin - self.x) / margin;
    if (self.x > arena - r - margin) wx -= (self.x - (arena - r - margin)) / margin;
    if (self.y < r + margin) wy += (r + margin - self.y) / margin;
    if (self.y > arena - r - margin) wy -= (self.y - (arena - r - margin)) / margin;
    if (geometry) {
      const safe = geometry.clampPoint(self.x, self.y, r + margin);
      wx = (safe.x - self.x) / margin;
      wy = (safe.y - self.y) / margin;
    }

    let largest = null;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e) continue;
      if (!largest || e.radius > largest.radius) largest = e;
    }
    const bossLike = arena >= 260 || (largest && largest.radius >= 22);

    if (bossLike && largest) {
      const dx = largest.x - self.x;
      const dy = largest.y - self.y;
      const dist = Math.hypot(dx, dy) || 1;
      const nx = dx / dist;
      const ny = dy / dist;
      const safe = largest.radius + r + 52;
      const far = Math.min(arena * 0.4, largest.radius + r + 108);
      let radial = 0;
      if (dist < safe) radial = -1.7;
      else if (dist > far) radial = 0.62;
      else radial = ((safe + far) * 0.5 - dist) / Math.max(far - safe, 1) * 0.35;
      let tx = -ny;
      let ty = nx;
      if (tx * finite(self.vx, 0) + ty * finite(self.vy, 0) < 0) {
        tx = -tx;
        ty = -ty;
      }
      wx += tx * 1.25 + nx * radial;
      wy += ty * 1.25 + ny * radial;
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.solid === false) continue;
      const fut = predictPos(e.x, e.y, e.vx, e.vy, e.radius, arena, 0.26);
      const dx = self.x - fut.x;
      const dy = self.y - fut.y;
      const dist = Math.hypot(dx, dy) || 1;
      const range = dist - e.radius - r;
      const approaching =
        (e.vx - finite(self.vx, 0)) * (e.x - self.x) +
        (e.vy - finite(self.vy, 0)) * (e.y - self.y) < 0;
      let w = 1 / Math.max(range, 7);
      w *= w;
      if (approaching) w *= 1.85;
      if (range < 22) w *= 2.8;
      if (e.ghost) w *= 0.45;
      wx += (dx / dist) * w * 42;
      wy += (dy / dist) * w * 42;
      if (!bossLike) {
        let tx = -dy / dist;
        let ty = dx / dist;
        if (tx * finite(self.vx, 0) + ty * finite(self.vy, 0) < 0) {
          tx = -tx;
          ty = -ty;
        }
        wx += tx * 0.32;
        wy += ty * 0.32;
      }
    }

    if (enemies.length >= 2) {
      let mx = 0;
      let my = 0;
      let n = 0;
      for (let i = 0; i < enemies.length; i++) {
        if (!enemies[i] || enemies[i].solid === false) continue;
        mx += enemies[i].x;
        my += enemies[i].y;
        n += 1;
      }
      if (n > 0) {
        mx /= n;
        my /= n;
        const dx = self.x - mx;
        const dy = self.y - my;
        const dist = Math.hypot(dx, dy) || 1;
        wx += (dx / dist) * 0.85;
        wy += (dy / dist) * 0.85;
      }
      if (n === 2) {
        const pair = [];
        for (let i = 0; i < enemies.length && pair.length < 2; i++) {
          if (enemies[i] && enemies[i].solid !== false) pair.push(enemies[i]);
        }
        const a = pair[0];
        const b = pair[1];
        if (a && b) {
          const ex = b.x - a.x;
          const ey = b.y - a.y;
          const span = hypot2(ex, ey) || 1;
          const t = ((self.x - a.x) * ex + (self.y - a.y) * ey) / span;
          if (t > 0.12 && t < 0.88) {
            let px = -ey;
            let py = ex;
            const plen = Math.hypot(px, py) || 1;
            px /= plen;
            py /= plen;
            if (px * (self.x - mx) + py * (self.y - my) < 0) {
              px = -px;
              py = -py;
            }
            wx += px * 1.45;
            wy += py * 1.45;
          }
        }
      }
    }

    const shots = listFrom(projectiles);
    for (let i = 0; i < shots.length && i < 16; i++) {
      const p = shots[i];
      if (!p) continue;
      const pr = finite(p.radius, 3) + r;
      const hitT = timeToHit(
        finite(p.x, 0), finite(p.y, 0), finite(p.vx, 0), finite(p.vy, 0),
        self.x, self.y, finite(self.vx, 0), finite(self.vy, 0),
        pr, 0.75
      );
      if (hitT >= 0.75) continue;
      const speedp = Math.hypot(finite(p.vx, 0), finite(p.vy, 0)) || 1;
      let sx = -finite(p.vy, 0) / speedp;
      let sy = finite(p.vx, 0) / speedp;
      const awayX = self.x - finite(p.x, 0);
      const awayY = self.y - finite(p.y, 0);
      if (sx * awayX + sy * awayY < 0) {
        sx = -sx;
        sy = -sy;
      }
      const urgency = (0.75 - hitT) / 0.75;
      wx += sx * (2.6 + urgency * 4.2);
      wy += sy * (2.6 + urgency * 4.2);
      const dist = Math.hypot(awayX, awayY) || 1;
      wx += (awayX / dist) * urgency * 1.4;
      wy += (awayY / dist) * urgency * 1.4;
    }

    const ents = listFrom(entities);
    for (let i = 0; i < ents.length && i < 20; i++) {
      const z = ents[i];
      if (!z || z.hostile !== true || z.combatKind === "projectile") continue;
      const dx = self.x - finite(z.x, 0);
      const dy = self.y - finite(z.y, 0);
      const dist = Math.hypot(dx, dy) || 1;
      const keep = finite(z.radius, 10) + r + 10;
      if (dist < keep + 28) {
        const w = dist < keep ? 5.2 : 1.15 * (keep + 28 - dist) / 28;
        wx += (dx / dist) * w;
        wy += (dy / dist) * w;
      }
    }

    if (!bossLike) {
      const dcx = cx - self.x;
      const dcy = cy - self.y;
      const cd = Math.hypot(dcx, dcy) || 1;
      const edge = geometry ? (geometry.shape === "circle"
        ? Math.hypot(self.x - cx, self.y - cy) / (geometry.width * 0.5)
        : Math.max(Math.abs(self.x - cx) / (geometry.width * 0.5), Math.abs(self.y - cy) / (geometry.height * 0.5)))
        : Math.max(Math.abs(self.x - cx), Math.abs(self.y - cy)) / (arena * 0.5);
      if (edge > 0.7) {
        wx += (dcx / cd) * (edge - 0.7) * 2.1;
        wy += (dcy / cd) * (edge - 0.7) * 2.1;
      }
    }

    if (mem.damageHeat > 0.4 && largest) {
      const dx = self.x - largest.x;
      const dy = self.y - largest.y;
      const dist = Math.hypot(dx, dy) || 1;
      wx += (dx / dist) * mem.damageHeat * 0.9;
      wy += (dy / dist) * mem.damageHeat * 0.9;
    }

    return normalize(wx, wy, finite(self.vx, 1), finite(self.vy, 0));
  }

  function inwardNormal(self, arena) {
    const r = finite(self.radius, 15);
    const slop = Math.max(5, r * 0.4);
    if (geometry) return getGunnerWallNormal(geometry, self.x, self.y, r, slop);
    let nx = 0;
    let ny = 0;
    if (self.x <= r + slop) nx += 1;
    if (self.x >= arena - r - slop) nx -= 1;
    if (self.y <= r + slop) ny += 1;
    if (self.y >= arena - r - slop) ny -= 1;
    return normalize(nx, ny, -finite(self.vx, 0), -finite(self.vy, 0));
  }

  function bounceToward(normal, desired) {
    const cross = normal.x * desired.y - normal.y * desired.x;
    const dot = normal.x * desired.x + normal.y * desired.y;
    let deg = Math.atan2(cross, dot) * 180 / Math.PI;
    if (!Number.isFinite(deg)) deg = 0;
    return clamp(deg, -MAX_BOUNCE_DEG, MAX_BOUNCE_DEG);
  }

  function soonestCollision(self, enemies, arena) {
    let soon = 99;
    const r = finite(self.radius, 15);
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.solid === false) continue;
      const rad = r + e.radius - 0.5;
      const t = timeToHit(
        self.x, self.y, finite(self.vx, 0), finite(self.vy, 0),
        e.x, e.y, e.vx, e.vy,
        rad, 0.55
      );
      if (t < soon) soon = t;
    }
    return soon;
  }

  function buildAims(self, enemies, focus, arena) {
    const gap = spawnGap(self);
    const aims = [];
    const list = focus ? [focus].concat(enemies.filter((e) => e !== focus)) : enemies;
    const limit = Math.min(list.length, 4);
    for (let i = 0; i < limit; i++) {
      const e = list[i];
      if (!e || e.attackable === false) continue;
      aims.push({
        angle: aimAt(e.x - self.x, e.y - self.y, mem.lastAim),
        t: 0.2,
        id: e.instanceId,
        kind: "now"
      });
      const leadT = Math.hypot(e.x - self.x, e.y - self.y) / BULLET_SPEED;
      const lead = predictPos(e.x, e.y, e.vx, e.vy, e.radius, arena, clamp(leadT, 0.05, 1.2));
      aims.push({
        angle: aimAt(lead.x - self.x, lead.y - self.y, mem.lastAim),
        t: leadT,
        id: e.instanceId,
        kind: "lead"
      });
      const quad = quadraticIntercept(self.x, self.y, e.x, e.y, e.vx, e.vy, BULLET_SPEED, gap);
      if (quad) aims.push({ angle: quad.angle, t: quad.t, id: e.instanceId, kind: "quad" });
      const samp = sampledIntercept(self, e, arena, gap);
      if (samp) aims.push({ angle: samp.angle, t: samp.t, id: e.instanceId, kind: "samp" });
      if (i === 0) addBankAims(aims, self, e, arena, gap);
    }
    return uniqueAims(aims).slice(0, 18);
  }

  function chooseShot(self, enemies, focus, desired, arena, panic) {
    const aims = buildAims(self, enemies, focus, arena);
    let best = null;
    let bestScore = -1e9;
    for (let i = 0; i < aims.length; i++) {
      const cand = aims[i];
      const hit = traceHit(self, cand.angle, enemies, arena);
      const recoil = recoilHeading(self, cand.angle);
      const recoilDot = recoil.x * desired.x + recoil.y * desired.y;
      const inside = spawnInside(self, cand.angle, arena);
      let score = recoilDot * 0.28 + (inside ? 0.15 : -1.2);
      if (hit) {
        score += 4.2 + 1.6 / (1 + hit.t);
        if (focus && hit.id && focus.instanceId && hit.id === focus.instanceId) score += 0.7;
        if (cand.kind === "bank") score += 0.08;
      } else {
        score -= 1.6;
        if (cand.kind === "quad" || cand.kind === "samp") score += 0.35;
      }
      if (panic) score += recoilDot * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = {
          angle: cand.angle,
          targetId: hit && hit.id ? hit.id : (cand.id || null),
          hit: Boolean(hit),
          score: bestScore
        };
      }
    }
    if (!best && focus) {
      best = {
        angle: aimAt(focus.x - self.x, focus.y - self.y, mem.lastAim),
        targetId: focus.instanceId || null,
        hit: false,
        score: -2
      };
    }
    if (panic && desired) {
      const dodgeAngle = aimAt(-desired.x, -desired.y, mem.lastAim);
      const recoil = recoilHeading(self, dodgeAngle);
      const recoilDot = recoil.x * desired.x + recoil.y * desired.y;
      if (!best || (!best.hit && recoilDot > 0.35 && spawnInside(self, dodgeAngle, arena))) {
        best = {
          angle: dodgeAngle,
          targetId: focus && focus.instanceId ? focus.instanceId : null,
          hit: Boolean(best && best.hit),
          score: recoilDot
        };
      }
    }
    return best;
  }

  function safeAction(fire, aimAngle, targetId) {
    const angle = finite(aimAngle, mem.lastAim || 0);
    mem.lastAim = angle;
    const action = { fire: fire === true, aimAngle: angle };
    if (targetId !== undefined && targetId !== null && String(targetId)) {
      action.targetId = String(targetId);
    }
    return action;
  }

  return {
    onStart() {
      mem.seen = Object.create(null);
      mem.lastAim = 0;
      mem.damageHeat = 0;
    },

    decide(observation) {
      if (!observation || !observation.self) {
        return safeAction(false, mem.lastAim, null);
      }
      const self = observation.self;
      const arena = readArena(observation);
      remember(observation);
      mem.damageHeat *= 0.86;

      const enemies = collectTargets(observation);
      const projectiles = listFrom(observation.projectiles);
      const entities = listFrom(observation.entities);
      const desired = computeDesired(self, enemies, projectiles, entities, arena);
      const focus = pickFocus(self, enemies);
      const collideT = soonestCollision(self, enemies, arena);
      let projT = 99;
      for (let i = 0; i < projectiles.length && i < 16; i++) {
        const p = projectiles[i];
        if (!p) continue;
        const t = timeToHit(
          finite(p.x, 0), finite(p.y, 0), finite(p.vx, 0), finite(p.vy, 0),
          finite(self.x, 0), finite(self.y, 0), finite(self.vx, 0), finite(self.vy, 0),
          finite(p.radius, 3) + finite(self.radius, 15),
          0.6
        );
        if (t < projT) projT = t;
      }
      const wallT = finite(self.nextWallContactIn, 9);
      const panic = collideT < Math.min(0.42, wallT + 0.05) || projT < 0.32 || mem.damageHeat > 1.4;

      const shot = chooseShot(self, enemies, focus, desired, arena, panic);
      const aim = shot ? shot.angle : aimAt(desired.x, desired.y, mem.lastAim);
      const canFire = finite(self.fireCooldown, 0) <= 1e-4;
      const hasTarget = Boolean(focus);
      const fire = canFire && (hasTarget || panic);
      return safeAction(fire, aim, shot ? shot.targetId : (focus && focus.instanceId));
    },

    onWallBounce(observation) {
      if (!observation || !observation.self) return { bounceAngle: 0 };
      const self = observation.self;
      const arena = readArena(observation);
      remember(observation);
      const enemies = collectTargets(observation);
      const desired = computeDesired(
        self,
        enemies,
        listFrom(observation.projectiles),
        listFrom(observation.entities),
        arena
      );
      const normal = inwardNormal(self, arena);
      const r = finite(self.radius, 15);
      const nearCorner = geometry ? geometry.shape === "rectangle" &&
        (self.x < geometry.left + r + 28 || self.x > geometry.right - r - 28) &&
        (self.y < geometry.top + r + 28 || self.y > geometry.bottom - r - 28) :
        (self.x < r + 28 || self.x > arena - r - 28) &&
        (self.y < r + 28 || self.y > arena - r - 28);
      let heading = desired;
      if (nearCorner) {
        heading = normalize(arena * 0.5 - self.x, arena * 0.5 - self.y, desired.x, desired.y);
      }
      const collideT = soonestCollision(self, enemies, arena);
      if (collideT < 0.35 && enemies.length) {
        let nearest = enemies[0];
        let nd = 1e9;
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e || e.solid === false) continue;
          const d = Math.hypot(self.x - e.x, self.y - e.y);
          if (d < nd) {
            nd = d;
            nearest = e;
          }
        }
        if (nearest) {
          heading = normalize(self.x - nearest.x, self.y - nearest.y, heading.x, heading.y);
        }
      }
      const angle = bounceToward(normal, heading);
      return { bounceAngle: finite(angle, 0) };
    },

    onEvent(event) {
      if (!event || typeof event !== "object") return;
      if (event.type === "damaged") {
        mem.damageHeat = Math.min(3, mem.damageHeat + 1.1);
      }
    }
  };
}

const gunnerDDefinition = createGunnerDefinition({
  id: "gunnerD",
  name: "枪手D",
  englishName: "Gunner D",
  color: "#ffffff",
  description: "白色自由策略枪手 / 多目标预测、弹道采样与威胁规避",
  policyFactory: createGunnerDPolicy
});

registerBall(gunnerDDefinition);
return { createGunnerDPolicy, gunnerDDefinition };
});
