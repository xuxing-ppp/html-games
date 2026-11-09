(function initializeArenaGeometry(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createArenaGeometryApi() {
  "use strict";

  const ARENA_SHAPES = Object.freeze(["square", "rectangle", "circle"]);

  function resolveArenaGeometry(value = 200) {
    if (value && typeof value.contains === "function") return value;
    if (value && value.arena) return resolveArenaGeometry(value.arena);
    return createArenaGeometry(value && value.arenaSize !== undefined ? value.arenaSize : value);
  }

  function getArenaWallContacts(context) {
    if (Array.isArray(context.wallContacts)) return context.wallContacts;
    const arena = resolveArenaGeometry(context.game);
    const ball = context.ball;
    if (!context.bouncedX && !context.bouncedY) return [];
    if (arena.shape === "circle") {
      const dx = ball.x - arena.centerX, dy = ball.y - arena.centerY;
      const length = Math.hypot(dx, dy);
      if (length < 1e-9) return [];
      return [{ x: arena.centerX + dx / length * arena.width / 2,
        y: arena.centerY + dy / length * arena.width / 2,
        normalX: -dx / length, normalY: -dy / length }];
    }
    const contacts = [];
    if (context.bouncedX) {
      const leftSide = ball.x < arena.centerX;
      contacts.push({ x: leftSide ? arena.left : arena.right, y: ball.y,
        normalX: leftSide ? 1 : -1, normalY: 0 });
    }
    if (context.bouncedY) {
      const topSide = ball.y < arena.centerY;
      contacts.push({ x: ball.x, y: topSide ? arena.top : arena.bottom,
        normalX: 0, normalY: topSide ? 1 : -1 });
    }
    return contacts;
  }

  function normalizeArenaDescriptor(arena, defaultSize = 200) {
    if (arena === undefined || arena === null) arena = { shape: "square", width: defaultSize, height: defaultSize };
    if (typeof arena === "number") arena = { shape: "square", width: arena, height: arena };
    if (typeof arena !== "object" || !ARENA_SHAPES.includes(arena.shape)) {
      throw new TypeError("Arena shape must be square, rectangle or circle");
    }
    const { shape, width, height = width } = arena;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 ||
        !Number.isFinite(width * height)) {
      throw new RangeError("Arena width and height must be finite positive logical distances");
    }
    if (shape !== "rectangle" && width !== height) {
      throw new RangeError("Square and circle arenas require equal width and height");
    }
    return Object.freeze({ shape, width, height });
  }

  // The logical viewport remains square. Rectangles are centred inside it so
  // legacy area skills retain a meaningful arenaSize and centre coordinate.
  function createArenaGeometry(value = 200) {
    const descriptor = normalizeArenaDescriptor(value);
    const { shape, width, height } = descriptor;
    const size = Math.max(width, height);
    const centerX = size / 2;
    const centerY = size / 2;
    const left = (size - width) / 2;
    const top = (size - height) / 2;
    const right = left + width;
    const bottom = top + height;
    const circular = shape === "circle";

    function contains(x, y, radius = 0) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return false;
      if (circular) return radius <= width / 2 && Math.hypot(x - centerX, y - centerY) <= width / 2 - radius + 1e-9;
      return x >= left + radius - 1e-9 && x <= right - radius + 1e-9 &&
        y >= top + radius - 1e-9 && y <= bottom - radius + 1e-9;
    }

    function clampPoint(x, y, radius = 0) {
      if (circular) {
        const limit = Math.max(0, width / 2 - radius);
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.hypot(dx, dy);
        if (distance > limit && distance > 0) {
          return { x: centerX + dx * limit / distance, y: centerY + dy * limit / distance };
        }
        return { x, y };
      }
      return {
        x: width < radius * 2 ? centerX : Math.max(left + radius, Math.min(right - radius, x)),
        y: height < radius * 2 ? centerY : Math.max(top + radius, Math.min(bottom - radius, y))
      };
    }

    function movementLimit(x, y, nx, ny, distance, radius = 0) {
      if (circular) {
        const limit = Math.max(0, width / 2 - radius);
        const dx = x - centerX;
        const dy = y - centerY;
        const a = nx * nx + ny * ny;
        if (a < 1e-18) return 0;
        const dot = dx * nx + dy * ny;
        const discriminant = dot * dot + a * (limit * limit - dx * dx - dy * dy);
        if (discriminant < 0) return 0;
        return Math.max(0, Math.min(distance, (-dot + Math.sqrt(discriminant)) / a));
      }
      let result = distance;
      if (nx < -1e-9) result = Math.min(result, (left + radius - x) / nx);
      if (nx > 1e-9) result = Math.min(result, (right - radius - x) / nx);
      if (ny < -1e-9) result = Math.min(result, (top + radius - y) / ny);
      if (ny > 1e-9) result = Math.min(result, (bottom - radius - y) / ny);
      return Math.max(0, result);
    }

    // Traversable seams use the actual bounds. In a circle, keep the flight
    // direction and wrap along its chord, retaining overshoot at the other end.
    function wrapPoint(x, y, vx = 1, vy = 0) {
      const modulo = (n, span) => ((n % span) + span) % span;
      if (!circular) return {
        x: x < left || x > right ? left + modulo(x - left, width) : x,
        y: y < top || y > bottom ? top + modulo(y - top, height) : y
      };
      if (contains(x, y)) return { x, y };
      const speed = Math.hypot(vx, vy);
      const nx = speed > 1e-9 ? vx / speed : 1;
      const ny = speed > 1e-9 ? vy / speed : 0;
      const dx = x - centerX;
      const dy = y - centerY;
      const radius = width / 2;
      const transverse = Math.max(-radius + 1e-7, Math.min(radius - 1e-7, -dx * ny + dy * nx));
      const halfChord = Math.sqrt(Math.max(0, radius * radius - transverse * transverse));
      const along = modulo(dx * nx + dy * ny + halfChord, 2 * halfChord) - halfChord;
      return { x: centerX + along * nx - transverse * ny, y: centerY + along * ny + transverse * nx };
    }

    function tracePath(context, inset = 0) {
      context.beginPath();
      if (circular) context.arc(centerX, centerY, Math.max(0, width / 2 - inset), 0, Math.PI * 2);
      else context.rect(left + inset, top + inset, Math.max(0, width - 2 * inset), Math.max(0, height - 2 * inset));
    }

    function samplePoint(random = Math.random, inset = 0) {
      if (!Number.isFinite(inset) || inset < 0) throw new RangeError("Invalid arena inset");
      const a = random(), b = random();
      if (![a, b].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) {
        throw new RangeError("Arena random samples must be in [0, 1]");
      }
      if (circular) {
        const radius = Math.max(0, width / 2 - inset) * Math.sqrt(a);
        return { x: centerX + Math.cos(b * Math.PI * 2) * radius,
          y: centerY + Math.sin(b * Math.PI * 2) * radius };
      }
      return { x: left + Math.min(inset, width / 2) + a * Math.max(0, width - inset * 2),
        y: top + Math.min(inset, height / 2) + b * Math.max(0, height - inset * 2) };
    }

    // Each named side maps to a quarter-circle, preserving four-sided mechanics.
    // Progress runs clockwise: top -> right -> bottom -> left.
    function boundaryPoint(side, progress = 0.5, inset = 0) {
      const sides = ["top", "right", "bottom", "left"];
      const index = sides.indexOf(side);
      if (index < 0 || !Number.isFinite(progress)) throw new TypeError("Invalid arena boundary sample");
      if (!Number.isFinite(inset) || inset < 0) throw new RangeError("Invalid arena inset");
      const u = Math.max(0, Math.min(1, progress));
      if (circular) {
        const angle = -Math.PI * 0.75 + (index + u) * Math.PI / 2;
        const nx = -Math.cos(angle), ny = -Math.sin(angle);
        const r = Math.max(0, width / 2 - inset);
        return { x: centerX - nx * r, y: centerY - ny * r, normalX: nx, normalY: ny };
      }
      const x0 = left + Math.min(inset, width / 2), x1 = right - Math.min(inset, width / 2);
      const y0 = top + Math.min(inset, height / 2), y1 = bottom - Math.min(inset, height / 2);
      if (side === "top") return { x: x0 + (x1 - x0) * u, y: y0, normalX: 0, normalY: 1 };
      if (side === "right") return { x: x1, y: y0 + (y1 - y0) * u, normalX: -1, normalY: 0 };
      if (side === "bottom") return { x: x1 - (x1 - x0) * u, y: y1, normalX: 0, normalY: -1 };
      return { x: x0, y: y1 - (y1 - y0) * u, normalX: 1, normalY: 0 };
    }

    function intersectsCircle(x, y, radius = 0) {
      if (![x, y, radius].every(Number.isFinite) || radius < 0) return false;
      if (circular) return Math.hypot(x - centerX, y - centerY) <= width / 2 + radius;
      const px = Math.max(left, Math.min(right, x));
      const py = Math.max(top, Math.min(bottom, y));
      return Math.hypot(x - px, y - py) <= radius;
    }

    // Pure motion query shared by projectile movement and prediction. Callers own
    // damage, expiry and bounce budgets; returned segments preserve swept hits.
    function advanceMotion(body, dt, { maxBounces = Infinity, maxSegments = 64 } = {}) {
      if (!Number.isFinite(dt) || dt < 0 || ![body.x, body.y, body.vx, body.vy].every(Number.isFinite)) {
        throw new TypeError("Invalid arena motion");
      }
      if (!(maxBounces === Infinity || Number.isInteger(maxBounces) && maxBounces >= 0) ||
          !Number.isInteger(maxSegments) || maxSegments < 1 || maxSegments > 1024) {
        throw new RangeError("Invalid arena motion budget");
      }
      const radius = body.radius == null ? 0 : body.radius;
      if (!Number.isFinite(radius) || radius < 0) throw new RangeError("Invalid arena motion radius");
      let { x, y } = clampPoint(body.x, body.y, radius);
      let vx = body.vx, vy = body.vy, elapsed = 0, bounces = 0, blocked = false;
      const segments = [];
      while (elapsed < dt - 1e-12 && segments.length < maxSegments) {
        const remaining = dt - elapsed;
        const hit = traceSegment(x, y, x + vx * remaining, y + vy * remaining, radius);
        const duration = hit ? remaining * hit.t : remaining;
        const endX = hit ? hit.x : x + vx * duration;
        const endY = hit ? hit.y : y + vy * duration;
        segments.push({ x1: x, y1: y, x2: endX, y2: endY,
          t0: elapsed, t1: elapsed + duration, vx, vy, hit });
        x = endX; y = endY; elapsed += duration;
        if (!hit) break;
        if (bounces >= maxBounces) { blocked = true; break; }
        if (!circular && hit.normalX && hit.normalY) { vx = -vx; vy = -vy; }
        else {
          const dot = vx * hit.normalX + vy * hit.normalY;
          vx -= 2 * dot * hit.normalX; vy -= 2 * dot * hit.normalY;
        }
        bounces += 1;
      }
      return { x, y, vx, vy, bounces, blocked, remainingTime: Math.max(0, dt - elapsed), segments };
    }

    // First exit of a swept disc. Normal points INTO the playable field, so
    // reflection is v - 2*dot(v,n)*n. A tangent endpoint alone is not an exit.
    function traceSegment(x1, y1, x2, y2, radius = 0) {
      if (contains(x2, y2, radius)) return null;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.hypot(dx, dy);
      const start = clampPoint(x1, y1, radius);
      const travel = distance > 1e-9 ? movementLimit(start.x, start.y, dx / distance, dy / distance, distance, radius) : 0;
      const x = start.x + (distance > 1e-9 ? dx / distance * travel : 0);
      const y = start.y + (distance > 1e-9 ? dy / distance * travel : 0);
      let normalX = 0;
      let normalY = 0;
      if (circular) {
        const length = Math.hypot(x - centerX, y - centerY);
        normalX = length > 1e-9 ? (centerX - x) / length : 1;
        normalY = length > 1e-9 ? (centerY - y) / length : 0;
      } else {
        if (dx < 0 && x <= left + radius + 1e-7) normalX = 1;
        if (dx > 0 && x >= right - radius - 1e-7) normalX = -1;
        if (dy < 0 && y <= top + radius + 1e-7) normalY = 1;
        if (dy > 0 && y >= bottom - radius - 1e-7) normalY = -1;
        const length = Math.hypot(normalX, normalY);
        if (length) { normalX /= length; normalY /= length; }
      }
      return { x, y, normalX, normalY, t: distance > 1e-9 ? travel / distance : 0 };
    }

    return Object.freeze({
      ...descriptor, descriptor, size, centerX, centerY, left, top, right, bottom,
      area: circular ? Math.PI * width * width / 4 : width * height,
      contains, clampPoint, movementLimit, wrapPoint, tracePath, traceSegment,
      samplePoint, boundaryPoint, intersectsCircle, advanceMotion
    });
  }

  return { ARENA_SHAPES, normalizeArenaDescriptor, createArenaGeometry, resolveArenaGeometry, getArenaWallContacts };
});
