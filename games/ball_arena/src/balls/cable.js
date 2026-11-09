(function initializeCableBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCablePlugin({ registerBall, resolveArenaGeometry }) {
  const LINE_WIDTH = 3;
  const LEAK_WIDTH = 4.5;
  const CURVE_SAMPLES = 32;
  const LEAK_SAMPLES = 4;
  const SAG_RATIO = 0.22;
  const MIN_SAG = 12;
  const MAX_SAG = 90;
  const CABLE_LIFE = 6.4;
  const DEATH_BURST_LIFE = 0.9;
  const DEATH_BOLT_TIME = 0.3;
  const DEATH_PARTICLE_COUNT = 26;
  const DEATH_GRAVITY = 420;
  const DEATH_FLASH_TIME = 0.1;
  const LEAK_MIN_LENGTH = 4;
  const LEAK_MAX_LENGTH = 10;
  const LEAK_TWO_CHANCE = 0.5;
  const LEAK_HIT_TOLERANCE = 1.5;
  const SPARK_INTERVAL = 0.6;
  const STUN_DURATION = 2;
  const STUN_INTERVAL = 0.4;
  const STUN_DAMAGE = 3;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // Crisp cable treatment: dark jacket outline, colored body, and one offset
  // highlight. This replaces real-time shadowBlur glow and reads better when
  // several cables cross.
  const CABLE_OUTLINE_COLOR = "#0a0e16";
  const CABLE_OUTLINE_EXTRA = 0.7;
  const CABLE_HIGHLIGHT_WIDTH = 0.65;
  const CABLE_HIGHLIGHT_OFFSET = 0.9;
  const CABLE_HIGHLIGHT_MIX = 0.88;
  const CABLE_HIGHLIGHT_ALPHA = 0.9;
  const CABLE_SHADOW_WIDTH = 1.7;
  const CABLE_SHADOW_OFFSET = 0.75;
  const CABLE_SHADOW_MIX = 0.52;
  const CABLE_SHADOW_ALPHA = 0.6;
  const CABLE_SEALED_ALPHA = 0.95;
  const CABLE_PREVIEW_ALPHA = 0.5;
  const CABLE_PREVIEW_DASH = Object.freeze([6, 5]);
  const LIGHT_DIRECTION = Object.freeze({ x: -0.35, y: -0.94 });

  const LEAK_GLOW_EXTRA = 3.2;
  const LEAK_HIGHLIGHT_WIDTH = 0.85;
  const LEAK_HIGHLIGHT_OFFSET = 0.8;
  const LEAK_HIGHLIGHT_COLOR = "#ffffff";
  const LEAK_HIGHLIGHT_ALPHA = 0.95;
  const DISCHARGE_LIFE = 0.2;
  const DISCHARGE_COLORS = Object.freeze(["#fff6c8", "#f0de26"]);

  // 明亮多色电缆配色；刻意不放黄色，保证黄色漏电段在每根电缆上都醒目
  const CABLE_COLORS = [
    "#ff4d6d", "#ff85c2", "#c44dff", "#6a5aff", "#4d9aff",
    "#3dc8ff", "#3dffc8", "#4dff88", "#f5f5ff"
  ];
  const LEAK_COLOR = "#f0de26";
  const LEAK_GLOW = "#fff3a0";
  const DEATH_COLORS = ["#f0de26", "#fff6c8"];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mixWithWhite(hex, amount) {
    const value = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return "#ffffff";
    const ratio = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
    return "#" + channels.map((channel) => (
      Math.round(channel + (255 - channel) * ratio).toString(16).padStart(2, "0")
    )).join("");
  }

  function mixWithBlack(hex, amount) {
    const value = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return "#000000";
    const ratio = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
    return "#" + channels.map((channel) => (
      Math.round(channel * (1 - ratio)).toString(16).padStart(2, "0")
    )).join("");
  }

  // Offset the exact cable polyline toward a fixed light direction. A negative
  // offset produces the opposite shadow band. The real geometry and hit tests
  // never move.
  function offsetPolyline(points, offset) {
    const result = [];
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      let dx = next.x - previous.x;
      let dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) {
        result.push({ x: point.x, y: point.y });
        continue;
      }
      dx /= length;
      dy /= length;
      let nx = -dy;
      let ny = dx;
      if (nx * LIGHT_DIRECTION.x + ny * LIGHT_DIRECTION.y < 0) {
        nx = -nx;
        ny = -ny;
      }
      result.push({ x: point.x + nx * offset, y: point.y + ny * offset });
    }
    return result;
  }

  function nearestPolylinePoint(points, target) {
    let best = null;
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1];
      const b = points[index];
      const abX = b.x - a.x;
      const abY = b.y - a.y;
      const lengthSq = abX * abX + abY * abY;
      const t = lengthSq <= EPSILON
        ? 0
        : clamp(((target.x - a.x) * abX + (target.y - a.y) * abY) / lengthSq, 0, 1);
      const x = a.x + abX * t;
      const y = a.y + abY * t;
      const distance = Math.hypot(target.x - x, target.y - y);
      if (!best || distance < best.distance) best = { x, y, distance };
    }
    return best;
  }

  function hashRandom(seed) {
    let value = (seed * 2246822519 + 374761393) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 100000) / 100000;
  }

  // 重力下垂电缆：t∈[0,1] 沿弦插值，下垂量 4t(1-t)sag 只向 +y，钳制进场地。
  // 拉出时即为最终形态，没有逐步下垂的动画过程。
  function cablePointAt(startX, startY, endX, endY, sag, t, arenaSize) {
    return resolveArenaGeometry(arenaSize).clampPoint(startX + (endX - startX) * t,
      startY + (endY - startY) * t + sag * 4 * t * (1 - t));
  }

  function sampleCablePoints(startX, startY, endX, endY, sag, arenaSize, samples = CURVE_SAMPLES, t0 = 0, t1 = 1) {
    const steps = Math.max(1, samples);
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = t0 + (t1 - t0) * (index / steps);
      points.push(cablePointAt(startX, startY, endX, endY, sag, t, arenaSize));
    }
    return points;
  }

  function cableCurrentPoints(entity) {
    return sampleCablePoints(
      entity.start.x,
      entity.start.y,
      entity.end.x,
      entity.end.y,
      entity.sag,
      entity.arenaSize
    );
  }

  function cableLeakPolyline(entity, leak) {
    return sampleCablePoints(
      entity.start.x,
      entity.start.y,
      entity.end.x,
      entity.end.y,
      entity.sag,
      entity.arenaSize,
      LEAK_SAMPLES,
      leak.t0,
      leak.t1
    );
  }

  function pointSegmentDistance(px, py, a, b) {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSq = abX * abX + abY * abY;
    if (lengthSq <= EPSILON) return Math.hypot(px - a.x, py - a.y);
    const t = clamp(((px - a.x) * abX + (py - a.y) * abY) / lengthSq, 0, 1);
    return Math.hypot(px - (a.x + abX * t), py - (a.y + abY * t));
  }

  function polylineTouches(points, px, py, radius) {
    for (let index = 1; index < points.length; index += 1) {
      if (pointSegmentDistance(px, py, points[index - 1], points[index]) <= radius) return true;
    }
    return false;
  }

  function arcToParameter(cumulative, arc) {
    const segmentCount = cumulative.length - 1;
    for (let index = 1; index < cumulative.length; index += 1) {
      if (arc <= cumulative[index] || index === cumulative.length - 1) {
        const segmentStart = cumulative[index - 1];
        const segmentLength = cumulative[index] - segmentStart;
        const fraction = segmentLength > EPSILON
          ? clamp((arc - segmentStart) / segmentLength, 0, 1)
          : 0;
        return (index - 1 + fraction) / segmentCount;
      }
    }
    return 1;
  }

  // 依据下垂形态按弧长挑选漏电段：1-2 段，每段 4-10，互不重叠
  function pickLeakRanges(startX, startY, endX, endY, sag, arenaSize, time) {
    const finalPoints = sampleCablePoints(startX, startY, endX, endY, sag, arenaSize);
    const cumulative = [0];
    for (let index = 1; index < finalPoints.length; index += 1) {
      cumulative.push(cumulative[index - 1] + Math.hypot(
        finalPoints[index].x - finalPoints[index - 1].x,
        finalPoints[index].y - finalPoints[index - 1].y
      ));
    }
    const totalLength = cumulative[cumulative.length - 1];
    const count = Math.random() < LEAK_TWO_CHANCE ? 2 : 1;
    const ranges = [];
    let attempts = 0;
    while (ranges.length < count && attempts < 24) {
      attempts += 1;
      const length = LEAK_MIN_LENGTH + Math.random() * (LEAK_MAX_LENGTH - LEAK_MIN_LENGTH);
      if (length >= totalLength) continue;
      const startArc = Math.random() * (totalLength - length);
      const range = {
        t0: arcToParameter(cumulative, startArc),
        t1: arcToParameter(cumulative, startArc + length),
        length,
        nextSparkAt: time + Math.random() * SPARK_INTERVAL
      };
      const overlaps = ranges.some((other) => (
        range.t0 < other.t1 + 0.02 && other.t0 < range.t1 + 0.02
      ));
      if (!overlaps) ranges.push(range);
    }
    if (ranges.length === 0) {
      ranges.push({
        t0: 0.45,
        t1: 0.55,
        length: clamp(totalLength * 0.1, LEAK_MIN_LENGTH, LEAK_MAX_LENGTH),
        nextSparkAt: time + Math.random() * SPARK_INTERVAL
      });
    }
    return ranges;
  }

  // 与电球相同的电击眩晕：锁移动/锁行为/禁止攻击，持续 2 秒，每 0.4 秒 3 点伤害
  function createStunEffect() {
    return {
      id: "stun",
      visualType: "stun",
      duration: STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      pausesBehavior: true,
      getContactProfile() {
        return { attackable: false };
      },
      damage: STUN_DAMAGE,
      tickInterval: STUN_INTERVAL,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx != null
            ? ball.storedVx
            : (ball.preHitVx != null ? ball.preHitVx : ball.vx);
          effect.savedVy = ball.storedVy != null
            ? ball.storedVy
            : (ball.preHitVy != null ? ball.preHitVy : ball.vy);
          if (Math.hypot(effect.savedVx, effect.savedVy) <= 1e-9 && ball.movementLocked) {
            effect.savedVx = ball.speed * (ball.speedMultiplier || 1);
            effect.savedVy = 0;
          }
        }
        effect.nextDamageAt = game.time + effect.tickInterval;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          effect.nextDamageAt > 0 &&
          game.time >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + 1e-9
        ) {
          effectServices.dealDamage(ball, effect.damage);
          effect.nextDamageAt += effect.tickInterval;
        }

        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
      },
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 48) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    };
  }

  // 每 0.6 秒从漏电段闪出的电火花：2-3 条短锯齿电弧 + 中心亮点
  function createLeakSpark(x, y, seed) {
    const bolts = [];
    const boltCount = 2 + Math.floor(hashRandom(seed * 3 + 1) * 2);
    for (let bolt = 0; bolt < boltCount; bolt += 1) {
      const points = [{ x, y }];
      let angle = hashRandom(seed * 7 + bolt * 13 + 5) * TWO_PI;
      let px = x;
      let py = y;
      const segments = 3 + Math.floor(hashRandom(seed * 5 + bolt * 11 + 2) * 3);
      for (let index = 0; index < segments; index += 1) {
        angle += (hashRandom(seed + bolt * 31 + index * 7) - 0.5) * 1.7;
        const step = 2 + hashRandom(seed * 5 + bolt * 17 + index * 3) * 3;
        px += Math.cos(angle) * step;
        py += Math.sin(angle) * step;
        points.push({ x: px, y: py });
      }
      bolts.push(points);
    }
    return {
      kind: "cable-leak-spark",
      life: 0.22 + hashRandom(seed * 17 + 9) * 0.1,
      bolts,
      sparkX: x,
      sparkY: y,
      draw({ effect }, context) {
        const fade = Math.max(0, 1 - effect.age / effect.life);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";

        context.globalAlpha = fade * 0.22;
        context.strokeStyle = LEAK_COLOR;
        context.lineWidth = 4.6;
        for (const bolt of effect.bolts) {
          context.beginPath();
          context.moveTo(bolt[0].x, bolt[0].y);
          for (let index = 1; index < bolt.length; index += 1) {
            context.lineTo(bolt[index].x, bolt[index].y);
          }
          context.stroke();
        }

        context.globalAlpha = fade;
        context.strokeStyle = LEAK_GLOW;
        context.lineWidth = 1.35;
        for (const bolt of effect.bolts) {
          context.beginPath();
          context.moveTo(bolt[0].x, bolt[0].y);
          for (let index = 1; index < bolt.length; index += 1) {
            context.lineTo(bolt[index].x, bolt[index].y);
          }
          context.stroke();
        }

        context.globalAlpha = fade * 0.3;
        context.fillStyle = LEAK_COLOR;
        context.beginPath();
        context.arc(effect.sparkX, effect.sparkY, 4.2, 0, TWO_PI);
        context.fill();
        context.globalAlpha = fade;
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(effect.sparkX, effect.sparkY, 1.9, 0, TWO_PI);
        context.fill();
        context.restore();
      }
    };
  }

  function createCableDischarge(start, target, seed) {
    const bolts = [];
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const length = Math.hypot(dx, dy);
    const nx = length > EPSILON ? -dy / length : 0;
    const ny = length > EPSILON ? dx / length : 0;
    for (let bolt = 0; bolt < 3; bolt += 1) {
      const points = [{ x: start.x, y: start.y }];
      const segments = 4;
      for (let index = 1; index <= segments; index += 1) {
        const t = index / segments;
        const jitter = (hashRandom(seed * 7 + bolt * 19 + index * 5) - 0.5) *
          9 * Math.sin(Math.PI * t);
        points.push({
          x: start.x + dx * t + nx * jitter,
          y: start.y + dy * t + ny * jitter
        });
      }
      bolts.push(points);
    }
    const rays = [];
    for (let index = 0; index < 5; index += 1) {
      const angle = hashRandom(seed * 11 + index * 7 + 3) * TWO_PI;
      const length = 3 + hashRandom(seed * 17 + index * 5 + 1) * 6;
      rays.push({
        x1: target.x,
        y1: target.y,
        x2: target.x + Math.cos(angle) * length,
        y2: target.y + Math.sin(angle) * length
      });
    }
    return {
      kind: "cable-discharge",
      life: DISCHARGE_LIFE,
      bolts,
      rays,
      targetX: target.x,
      targetY: target.y,
      draw({ effect }, context) {
        const fade = Math.max(0, 1 - effect.age / effect.life);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        context.globalAlpha = fade * 0.3;
        context.strokeStyle = LEAK_COLOR;
        context.lineWidth = 4.8;
        for (const bolt of effect.bolts) {
          context.beginPath();
          context.moveTo(bolt[0].x, bolt[0].y);
          for (let index = 1; index < bolt.length; index += 1) {
            context.lineTo(bolt[index].x, bolt[index].y);
          }
          context.stroke();
        }
        context.globalAlpha = fade;
        context.strokeStyle = DISCHARGE_COLORS[0];
        context.lineWidth = 1.4;
        for (const bolt of effect.bolts) {
          context.beginPath();
          context.moveTo(bolt[0].x, bolt[0].y);
          for (let index = 1; index < bolt.length; index += 1) {
            context.lineTo(bolt[index].x, bolt[index].y);
          }
          context.stroke();
        }
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(effect.targetX, effect.targetY, 2.6, 0, TWO_PI);
        context.fill();

        context.globalAlpha = fade * 0.8;
        context.strokeStyle = DISCHARGE_COLORS[0];
        context.lineWidth = 1;
        context.beginPath();
        for (const ray of effect.rays) {
          context.moveTo(ray.x1, ray.y1);
          context.lineTo(ray.x2, ray.y2);
        }
        context.stroke();
        context.restore();
      }
    };
  }

  // 3.1 秒寿命到点的爆散特效：整条线闪出较大电火花，黄白色粒子受重力下坠
  function createCableDeathBurst(points, seed) {
    const bolts = [];
    const boltCount = 7;
    for (let bolt = 0; bolt < boltCount; bolt += 1) {
      const anchor = points[Math.floor((bolt + 0.5) / boltCount * (points.length - 1))];
      const boltPoints = [{ x: anchor.x, y: anchor.y }];
      let angle = hashRandom(seed * 11 + bolt * 17 + 3) * TWO_PI;
      let px = anchor.x;
      let py = anchor.y;
      const segments = 5 + Math.floor(hashRandom(seed * 3 + bolt * 7 + 1) * 4);
      for (let index = 0; index < segments; index += 1) {
        angle += (hashRandom(seed * 5 + bolt * 13 + index * 3) - 0.5) * 1.6;
        const step = 3.5 + hashRandom(seed * 7 + bolt * 19 + index * 5) * 3.5;
        px += Math.cos(angle) * step;
        py += Math.sin(angle) * step;
        boltPoints.push({ x: px, y: py });
      }
      bolts.push(boltPoints);
    }
    const particles = [];
    for (let index = 0; index < DEATH_PARTICLE_COUNT; index += 1) {
      const t = index / (DEATH_PARTICLE_COUNT - 1);
      const along = t * (points.length - 1);
      const base = points[Math.floor(along)];
      const next = points[Math.min(points.length - 1, Math.floor(along) + 1)];
      const fraction = along - Math.floor(along);
      particles.push({
        x: base.x + (next.x - base.x) * fraction,
        y: base.y + (next.y - base.y) * fraction,
        vx: (hashRandom(seed * 13 + index * 7 + 2) - 0.5) * 90,
        vy: -20 + hashRandom(seed * 17 + index * 11 + 4) * 90,
        color: DEATH_COLORS[index % DEATH_COLORS.length],
        size: 1.6 + hashRandom(seed * 19 + index * 3 + 6) * 1.8
      });
    }
    return {
      kind: "cable-death-burst",
      life: DEATH_BURST_LIFE,
      points,
      bolts,
      particles,
      update({ effect }, dt) {
        for (const particle of effect.particles) {
          particle.vy += DEATH_GRAVITY * dt;
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
        }
      },
      draw({ effect }, context) {
        context.save();
        const flash = Math.max(0, 1 - effect.age / DEATH_FLASH_TIME);
        if (flash > 0) {
          context.globalAlpha = flash * 0.9;
          context.strokeStyle = "#ffffff";
          context.lineWidth = 3.6;
          context.lineCap = "round";
          strokePolyline(context, effect.points);
        }

        const boltAlpha = 1 - effect.age / DEATH_BOLT_TIME;
        if (boltAlpha > 0) {
          context.globalCompositeOperation = "lighter";
          context.globalAlpha = boltAlpha * 0.28;
          context.strokeStyle = LEAK_COLOR;
          context.lineWidth = 6;
          for (const bolt of effect.bolts) {
            context.beginPath();
            context.moveTo(bolt[0].x, bolt[0].y);
            for (let index = 1; index < bolt.length; index += 1) {
              context.lineTo(bolt[index].x, bolt[index].y);
            }
            context.stroke();
          }
          context.globalAlpha = boltAlpha;
          context.strokeStyle = LEAK_GLOW;
          context.lineWidth = 2.4;
          for (const bolt of effect.bolts) {
            context.beginPath();
            context.moveTo(bolt[0].x, bolt[0].y);
            for (let index = 1; index < bolt.length; index += 1) {
              context.lineTo(bolt[index].x, bolt[index].y);
            }
            context.stroke();
          }
        }

        context.globalCompositeOperation = "source-over";
        context.globalAlpha *= Math.max(0, 1 - effect.age / effect.life);
        for (const particle of effect.particles) {
          context.fillStyle = particle.color;
          context.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
        }
        context.restore();
      }
    };
  }

  function drawAnchorCap(context, point, color, preview) {
    context.save();
    if (preview) context.globalAlpha *= 0.72;
    context.fillStyle = CABLE_OUTLINE_COLOR;
    context.beginPath();
    context.arc(point.x, point.y, 3.2, 0, TWO_PI);
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.28)";
    context.lineWidth = 0.5;
    context.beginPath();
    context.arc(point.x, point.y, 3.2, 0, TWO_PI);
    context.stroke();
    context.fillStyle = preview ? "#7f8694" : color;
    context.beginPath();
    context.arc(point.x, point.y, 1.4, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  function strokePolyline(context, points) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
  }

  function drawCableLine(entity, canvasContext, isPreview) {
    const points = isPreview || !entity.points
      ? cableCurrentPoints(entity)
      : entity.points;
    const baseAlpha = canvasContext.globalAlpha;
    const cableAlpha = isPreview ? CABLE_PREVIEW_ALPHA : CABLE_SEALED_ALPHA;
    const dashed = isPreview && typeof canvasContext.setLineDash === "function";

    canvasContext.save();
    if (dashed) canvasContext.setLineDash(CABLE_PREVIEW_DASH);
    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";

    canvasContext.globalAlpha = baseAlpha * cableAlpha;
    canvasContext.strokeStyle = CABLE_OUTLINE_COLOR;
    canvasContext.lineWidth = LINE_WIDTH + CABLE_OUTLINE_EXTRA * 2;
    strokePolyline(canvasContext, points);

    canvasContext.strokeStyle = entity.color;
    canvasContext.lineWidth = LINE_WIDTH;
    strokePolyline(canvasContext, points);

    canvasContext.globalAlpha = baseAlpha * cableAlpha * CABLE_SHADOW_ALPHA;
    canvasContext.strokeStyle = entity.shadowColor ||
      mixWithBlack(entity.color, CABLE_SHADOW_MIX);
    canvasContext.lineWidth = CABLE_SHADOW_WIDTH;
    strokePolyline(
      canvasContext,
      offsetPolyline(points, -CABLE_SHADOW_OFFSET)
    );

    canvasContext.globalAlpha = baseAlpha * cableAlpha * CABLE_HIGHLIGHT_ALPHA;
    canvasContext.strokeStyle = entity.highlightColor ||
      mixWithWhite(entity.color, CABLE_HIGHLIGHT_MIX);
    canvasContext.lineWidth = CABLE_HIGHLIGHT_WIDTH;
    strokePolyline(
      canvasContext,
      offsetPolyline(points, CABLE_HIGHLIGHT_OFFSET)
    );

    if (dashed) canvasContext.setLineDash([]);
    canvasContext.restore();

    for (const leak of entity.leaks) {
      const leakPoints = leak.points || cableLeakPolyline(entity, leak);
      const pulse = 0.12 + 0.05 *
        (0.5 + 0.5 * Math.sin(entity.age * 5 + (leak.t0 || 0) * 8));
      canvasContext.save();
      canvasContext.lineCap = "round";
      canvasContext.lineJoin = "round";

      canvasContext.globalCompositeOperation = "lighter";
      canvasContext.globalAlpha = baseAlpha * cableAlpha * pulse;
      canvasContext.strokeStyle = LEAK_COLOR;
      canvasContext.lineWidth = LEAK_WIDTH + LEAK_GLOW_EXTRA;
      strokePolyline(canvasContext, leakPoints);

      canvasContext.globalCompositeOperation = "source-over";
      canvasContext.globalAlpha = baseAlpha * cableAlpha;
      canvasContext.strokeStyle = LEAK_COLOR;
      canvasContext.lineWidth = LEAK_WIDTH;
      strokePolyline(canvasContext, leakPoints);

      canvasContext.globalAlpha = baseAlpha * cableAlpha * LEAK_HIGHLIGHT_ALPHA;
      canvasContext.strokeStyle = LEAK_HIGHLIGHT_COLOR;
      canvasContext.lineWidth = LEAK_HIGHLIGHT_WIDTH;
      strokePolyline(
        canvasContext,
        offsetPolyline(leakPoints, LEAK_HIGHLIGHT_OFFSET)
      );
      canvasContext.restore();
    }

    drawAnchorCap(canvasContext, points[0], entity.color, isPreview);
    drawAnchorCap(canvasContext, points[points.length - 1], entity.color, isPreview);
  }

  const cableDefinition = {
    id: "cable",
    name: "电缆",
    englishName: "Cable",
    color: "#f0de26",
    description: "两次碰壁拉出下垂电缆 / 漏电段电击眩晕 / 6.4秒后爆散消失",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      let firstAnchor = null;
      let previewEntity = null;

      function spawnCable(context, start, end, lifecycle) {
        const isPreview = lifecycle === "owner-bound";
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const arenaSize = resolveArenaGeometry(context.game);
        const sag = clamp(distance * SAG_RATIO, MIN_SAG, MAX_SAG);
        // Preserve the original random order: cable color first, then leaks.
        const color = CABLE_COLORS[Math.floor(Math.random() * CABLE_COLORS.length)];
        const points = isPreview
          ? null
          : sampleCablePoints(start.x, start.y, end.x, end.y, sag, arenaSize);
        const leaks = isPreview
          ? []
          : pickLeakRanges(start.x, start.y, end.x, end.y, sag, arenaSize, context.game.time);
        for (const leak of leaks) {
          leak.points = sampleCablePoints(
            start.x, start.y, end.x, end.y, sag, arenaSize,
            LEAK_SAMPLES, leak.t0, leak.t1
          );
        }
        return services.spawnCombatEntity({
          kind: "cable-line",
          combatKind: "zone",
          life: CABLE_LIFE,
          lifecycle,
          drawLayer: "background",
          start: { x: start.x, y: start.y },
          end,
          arenaSize,
          color,
          highlightColor: mixWithWhite(color, CABLE_HIGHLIGHT_MIX),
          shadowColor: mixWithBlack(color, CABLE_SHADOW_MIX),
          sag,
          points,
          sparkSeed: 0,
          leaks,
          update({ entity, game, services: cableServices }, dt) {
            // 寿命到点：先闪出整线爆散特效再自行失效，抢在实体系统静默移除之前
            if (entity.age + dt >= CABLE_LIFE - EPSILON) {
              entity.sparkSeed += 1;
              cableServices.spawnVisualEffect(createCableDeathBurst(
                entity.points || cableCurrentPoints(entity),
                entity.sparkSeed
              ));
              entity.entityActive = false;
              return;
            }
            if (entity.leaks.length === 0) return;
            const leakPolylines = entity.leaks.map((leak) => (
              leak.points || cableLeakPolyline(entity, leak)
            ));
            for (let index = 0; index < entity.leaks.length; index += 1) {
              const leak = entity.leaks[index];
              if (leak.nextSparkAt > game.time + EPSILON) continue;
              leak.nextSparkAt = Math.max(leak.nextSparkAt + SPARK_INTERVAL, game.time + SPARK_INTERVAL);
              entity.sparkSeed += 1;
              const points = leakPolylines[index];
              const segmentIndex = Math.floor(hashRandom(entity.sparkSeed * 7 + 3) * (points.length - 1));
              const from = points[segmentIndex];
              const to = points[Math.min(points.length - 1, segmentIndex + 1)];
              const fraction = hashRandom(entity.sparkSeed * 13 + 5);
              cableServices.spawnVisualEffect(createLeakSpark(
                from.x + (to.x - from.x) * fraction,
                from.y + (to.y - from.y) * fraction,
                entity.sparkSeed
              ));
            }
            let discharged = false;
            let dischargeFrom = null;
            let dischargeTarget = null;
            cableServices.forEachEnemy((target) => {
              if (target.hp <= 0) return;
              // 已带眩晕的目标不重复施加(避免每帧刷新把持续伤害计时器无限重置)
              if (target.effects && target.effects.has("stun")) return;
              for (const leakPoints of leakPolylines) {
                if (polylineTouches(leakPoints, target.x, target.y, target.radius + LEAK_HIT_TOLERANCE)) {
                  cableServices.applyEffect(target, createStunEffect());
                  cableServices.spawnHitText(target, "X");
                  if (!dischargeTarget) {
                    const nearest = nearestPolylinePoint(leakPoints, target);
                    dischargeFrom = nearest
                      ? { x: nearest.x, y: nearest.y }
                      : { x: target.x, y: target.y };
                    dischargeTarget = target;
                  }
                  discharged = true;
                  break;
                }
              }
            });
            if (discharged) {
              if (dischargeFrom && dischargeTarget) {
                cableServices.spawnVisualEffect(createCableDischarge(
                  dischargeFrom,
                  dischargeTarget,
                  entity.sparkSeed + 1
                ));
              }
              // 放电一次即耗尽：电缆立刻消失，不能原地反复硬控
              entity.entityActive = false;
            }
          },
          draw({ entity }, canvasContext) {
            drawCableLine(entity, canvasContext, isPreview);
          }
        });
      }

      return {
        onWallBounce(context) {
          const arena = resolveArenaGeometry(context.game);
          const point = (context.wallContacts || [])[0] || {
            x: context.bouncedX
              ? (context.ball.x <= arena.left + context.ball.radius + EPSILON ? arena.left : arena.right)
              : context.ball.x,
            y: context.bouncedY
              ? (context.ball.y <= arena.top + context.ball.radius + EPSILON ? arena.top : arena.bottom)
              : context.ball.y
          };
          // 预览电缆是 owner-bound：借用结束等情况被移除后，这里自愈重置锚点
          if (firstAnchor && (!previewEntity || previewEntity.entityActive === false)) {
            firstAnchor = null;
            previewEntity = null;
          }
          if (!firstAnchor) {
            firstAnchor = point;
            previewEntity = spawnCable(context, firstAnchor, context.ball, "owner-bound");
            return;
          }
          if (Math.hypot(point.x - firstAnchor.x, point.y - firstAnchor.y) <= EPSILON) return;
          previewEntity.entityActive = false;
          spawnCable(context, firstAnchor, point, "independent");
          firstAnchor = null;
          previewEntity = null;
        },
        getCableState() {
          return {
            firstAnchor,
            previewActive: Boolean(previewEntity && previewEntity.entityActive !== false)
          };
        }
      };
    }
  };

  registerBall(cableDefinition);
  return {
    cableDefinition,
    cableSamplePoints: sampleCablePoints,
    cableCurrentPoints,
    cableLeakPolyline,
    cablePointSegmentDistance: pointSegmentDistance
  };
});
