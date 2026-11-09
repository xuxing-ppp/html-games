(function initializeElectricPrime(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricPrimePlugin({ registerBall, resolveArenaGeometry }) {
  const FILAMENT_BASE_RATE = 1.4;
  const FILAMENT_INTERVAL = 1 / FILAMENT_BASE_RATE;
  const FILAMENT_LENGTH = 20;
  const FILAMENT_DESPAWN_MARGIN = 200;
  const FILAMENT_RATE_GAIN_PER_ROUND = 0.2;
  const FILAMENT_SPEED_MULTIPLIERS = Object.freeze([0.5, 0.6, 0.7, 0.8]);
  const FILAMENT_DAMAGE = 1;
  const FILAMENT_STUN_DURATION = 0.2;
  const FILAMENT_HIT_RADIUS = 1.5;
  const FILAMENT_VISUAL_TRAIL_LENGTH = 30;
  const FILAMENT_HISTORY_SPACING = 1.75;
  const FILAMENT_SPARK_INTERVAL_MIN = 0.025;
  const FILAMENT_SPARK_INTERVAL_MAX = 0.09;
  const FILAMENT_SPARK_LIFE_MIN = 0.12;
  const FILAMENT_SPARK_LIFE_MAX = 0.32;
  const TURN_RATES_DEGREES = Object.freeze([5, 45, 120, 240]);
  const HITS_PER_ROUND = 4;
  const ELECTROLYSIS_RADIUS = 20;
  const ELECTROLYSIS_DAMAGE = 1;
  const DISCHARGE_WIDTH = 40;
  const CHARGE_EXPLOSION_RADIUS = 80;
  const DISCHARGE_STUN_DURATION = 1.8;
  const DISCHARGE_TICK_INTERVAL = 0.6;
  const DISCHARGE_TICK_DAMAGE = 2;
  const COUNTER_RADIUS = 90;
  const COUNTER_DAZE_DURATION = 0.5;
  const COUNTER_KNOCKBACK_DISTANCE = 50;
  const COUNTER_KNOCKBACK_SPEED = 3.6;
  const COUNTER_DAZE_SPEED = 0.1;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function rotateToward(current, target, maximumStep) {
    const difference = normalizeAngle(target - current);
    return current + clamp(difference, -maximumStep, maximumStep);
  }

  function pointToSegmentDistanceSquared(x, y, start, end) {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON) {
      return (x - start.x) ** 2 + (y - start.y) ** 2;
    }
    const progress = clamp(
      ((x - start.x) * segmentX + (y - start.y) * segmentY) / lengthSquared,
      0,
      1
    );
    const closestX = start.x + segmentX * progress;
    const closestY = start.y + segmentY * progress;
    return (x - closestX) ** 2 + (y - closestY) ** 2;
  }

  function orientation(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function segmentsIntersect(a, b, c, d) {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    return (
      ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
    );
  }

  function segmentDistanceSquared(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointToSegmentDistanceSquared(a.x, a.y, c, d),
      pointToSegmentDistanceSquared(b.x, b.y, c, d),
      pointToSegmentDistanceSquared(c.x, c.y, a, b),
      pointToSegmentDistanceSquared(d.x, d.y, a, b)
    );
  }

  function pathHitsTarget(points, target, halfWidth) {
    const hitRadius = target.radius + halfWidth;
    const hitRadiusSquared = hitRadius * hitRadius;
    for (let index = 1; index < points.length; index += 1) {
      if (pointToSegmentDistanceSquared(
        target.x,
        target.y,
        points[index - 1],
        points[index]
      ) <= hitRadiusSquared) return true;
    }
    return false;
  }

  function gamma(value) {
    const coefficients = [
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7
    ];
    if (value < 0.5) {
      return Math.PI / (Math.sin(Math.PI * value) * gamma(1 - value));
    }
    const shifted = value - 1;
    let sum = 0.99999999999980993;
    coefficients.forEach((coefficient, index) => {
      sum += coefficient / (shifted + index + 1);
    });
    const t = shifted + coefficients.length - 0.5;
    return Math.sqrt(2 * Math.PI) * t ** (shifted + 0.5) * Math.exp(-t) * sum;
  }

  function dischargeDamage(round) {
    return Math.round(gamma(Math.sqrt(round) + 1));
  }

  function createJaggedPath(start, end, segmentCount, maximumOffset) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const direction = normalizeDirection(deltaX, deltaY);
    const normalX = -direction.y;
    const normalY = direction.x;
    const points = [];
    let bend = 0;
    for (let index = 0; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const edgeFade = Math.sin(progress * Math.PI);
      bend = bend * 0.42 + (Math.random() - 0.5) * maximumOffset * 1.6;
      const offset = index === 0 || index === segmentCount
        ? 0
        : clamp(bend, -maximumOffset, maximumOffset) * edgeFade;
      points.push({
        x: start.x + deltaX * progress + normalX * offset,
        y: start.y + deltaY * progress + normalY * offset
      });
    }
    return points;
  }

  function createGroundMarker(target, state) {
    return {
      kind: "electric-prime-ground-marker",
      life: 3600,
      target,
      count: state.count,
      round: state.round,
      update({ effect }) {
        if (!effect.target || effect.target.hp <= 0) effect.life = 0;
      },
      draw({ effect, game }, context) {
        if (!effect.target || effect.target.hp <= 0) return;
        const ball = effect.target;
        const pulse = 0.82 + Math.sin(game.time * 8) * 0.18;
        const x = Math.round(ball.x);
        const topY = Math.round(ball.y - ball.radius - 13);
        const bottomY = Math.round(ball.y + ball.radius + 3);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= pulse;
        context.shadowColor = "#75eaff";
        context.shadowBlur = 7;
        context.strokeStyle = "#9ef3ff";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(x, bottomY);
        context.lineTo(x, bottomY + 6);
        context.moveTo(x - 7, bottomY + 6);
        context.lineTo(x + 7, bottomY + 6);
        context.moveTo(x - 5, bottomY + 9);
        context.lineTo(x + 5, bottomY + 9);
        context.moveTo(x - 3, bottomY + 12);
        context.lineTo(x + 3, bottomY + 12);
        context.stroke();
        context.shadowBlur = 4;
        context.font = '700 11px "Ball Impact", Impact, "Arial Black", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineJoin = "round";
        context.lineWidth = 2.5;
        context.strokeStyle = "#173f62";
        context.fillStyle = "#d9fbff";
        context.strokeText(String(effect.count), x, topY);
        context.fillText(String(effect.count), x, topY);
        context.restore();
      }
    };
  }

  function addTremor(effect, game, context, strength) {
    const frame = Math.floor(game.time * 60) % 4;
    effect.renderOffsetX = frame === 0 ? -strength : (frame === 2 ? strength : 0);
    effect.renderOffsetY = frame === 1 ? -strength : (frame === 3 ? strength : 0);
    context.translate(effect.renderOffsetX, effect.renderOffsetY);
  }

  function createFilamentStun(source) {
    return {
      id: "electric-prime-filament-stun",
      visualType: "stun",
      duration: FILAMENT_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx;
          effect.savedVy = ball.storedVy;
        }
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball }) {
        ball.vx = 0;
        ball.vy = 0;
      },
      onExpire({ ball, effect }) {
        ball.vx = ball.storedVx = effect.savedVx || 0;
        ball.vy = ball.storedVy = effect.savedVy || 0;
      },
      drawBefore({ effect, game }, context) {
        addTremor(effect, game, context, 1.5);
      },
      sourceInstanceId: source.instanceId
    };
  }

  function createElectrolysisStorm(x, y) {
    return {
      kind: "electric-prime-electrolysis-storm",
      life: 0.42,
      x,
      y,
      radius: ELECTROLYSIS_RADIUS,
      damage: ELECTROLYSIS_DAMAGE,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const radius = effect.radius * (0.2 + progress * 0.8);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "rgba(116, 226, 255, 0.18)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#8cecff";
        context.lineWidth = 3 - progress * 1.8;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#e7fdff";
        context.lineWidth = 0.8;
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI / 3 + progress;
          context.beginPath();
          context.moveTo(effect.x, effect.y);
          context.lineTo(
            effect.x + Math.cos(angle) * radius,
            effect.y + Math.sin(angle) * radius
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createChargeExplosion(x, y, damage) {
    return {
      kind: "electric-prime-charge-explosion",
      life: 0.56,
      x,
      y,
      radius: CHARGE_EXPLOSION_RADIUS,
      damage,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const radius = effect.radius * (1 - Math.pow(1 - progress, 3));
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "rgba(83, 202, 255, 0.16)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowColor = "#6bdfff";
        context.shadowBlur = 11;
        context.strokeStyle = "#5ad5ff";
        context.lineWidth = 6 - progress * 4;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.shadowBlur = 3;
        context.strokeStyle = "#ecfeff";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(effect.x, effect.y, radius * 0.82, 0, Math.PI * 2);
        context.stroke();
        for (let index = 0; index < 12; index += 1) {
          const angle = index * Math.PI / 6 + progress * 0.35;
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(angle) * radius * 0.22,
            effect.y + Math.sin(angle) * radius * 0.22
          );
          context.lineTo(
            effect.x + Math.cos(angle + (index % 2 ? 0.09 : -0.09)) * radius,
            effect.y + Math.sin(angle + (index % 2 ? 0.09 : -0.09)) * radius
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createDischargeStun(services, source) {
    return {
      id: "electric-prime-discharge-stun",
      visualType: "stun",
      duration: DISCHARGE_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      tickInterval: DISCHARGE_TICK_INTERVAL,
      tickDamage: DISCHARGE_TICK_DAMAGE,
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx;
          effect.savedVy = ball.storedVy;
        }
        effect.tickTimer = 0;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, services: effectServices }, dt) {
        ball.vx = 0;
        ball.vy = 0;
        effect.tickTimer += Math.max(0, dt);
        while (effect.tickTimer + EPSILON >= DISCHARGE_TICK_INTERVAL && ball.hp > 0) {
          effect.tickTimer = Math.max(0, effect.tickTimer - DISCHARGE_TICK_INTERVAL);
          effectServices.dealDamage(ball, DISCHARGE_TICK_DAMAGE);
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = ball.storedVx = effect.savedVx || 0;
        ball.vy = ball.storedVy = effect.savedVy || 0;
      },
      drawBefore({ effect, game }, context) {
        addTremor(effect, game, context, 2);
      },
      draw({ ball, effect, game }, context) {
        context.save();
        context.translate(-(effect.renderOffsetX || 0), -(effect.renderOffsetY || 0));
        context.globalAlpha *= 0.55 + Math.sin(game.time * 16) * 0.2;
        context.strokeStyle = "#56d8ff";
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 7, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createCounterShockwave(x, y, damage) {
    const particles = Array.from({ length: 18 }, (_value, index) => ({
      angle: index * Math.PI * 2 / 18,
      offset: index % 3 * 4
    }));
    return {
      kind: "electric-prime-counter-shockwave",
      life: 0.5,
      x,
      y,
      radius: COUNTER_RADIUS,
      damage,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const radius = effect.radius * (1 - Math.pow(1 - progress, 2));
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "rgba(156, 238, 255, 0.11)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#a8efff";
        context.lineWidth = 5 - progress * 3;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        effect.particles.forEach((particle) => {
          const distance = radius * 0.6 + particle.offset;
          context.fillStyle = "#dffcff";
          context.fillRect(
            effect.x + Math.cos(particle.angle) * distance - 1,
            effect.y + Math.sin(particle.angle) * distance - 1,
            2,
            2
          );
        });
        context.restore();
      }
    };
  }

  function createCounterDaze(source, directionX, directionY) {
    const direction = normalizeDirection(directionX, directionY);
    return {
      id: "electric-prime-counter-daze",
      bounceCompatible: true,
      visualType: "stun",
      duration: COUNTER_DAZE_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      directionX: direction.x,
      directionY: direction.y,
      remainingDistance: COUNTER_KNOCKBACK_DISTANCE,
      onApply({ ball, effect }) {
        effect.remainingDistance = COUNTER_KNOCKBACK_DISTANCE;
        const speed = ball.speed * ball.speedMultiplier * COUNTER_KNOCKBACK_SPEED;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      update({ ball, effect }, dt) {
        const elapsed = Math.max(0, dt);
        if (effect.remainingDistance > EPSILON) {
          const peakSpeed = ball.speed * ball.speedMultiplier * COUNTER_KNOCKBACK_SPEED;
          const speed = elapsed > EPSILON
            ? Math.min(peakSpeed, effect.remainingDistance / elapsed)
            : peakSpeed;
          ball.vx = effect.directionX * speed;
          ball.vy = effect.directionY * speed;
          effect.remainingDistance = Math.max(0, effect.remainingDistance - speed * elapsed);
          return;
        }
        const speed = ball.speed * ball.speedMultiplier * COUNTER_DAZE_SPEED;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      onWallBounce({ ball, effect }) {
        const directionAfterBounce = normalizeDirection(
          ball.vx,
          ball.vy,
          effect.directionX,
          effect.directionY
        );
        effect.directionX = directionAfterBounce.x;
        effect.directionY = directionAfterBounce.y;
      },
      onExpire({ ball, effect }) {
        const speed = ball.speed * ball.speedMultiplier;
        ball.vx = ball.storedVx = effect.directionX * speed;
        ball.vy = ball.storedVy = effect.directionY * speed;
      },
      drawBefore({ effect, game }, context) {
        addTremor(effect, game, context, 2);
      },
      sourceInstanceId: source.instanceId
    };
  }

  function distanceToArenaEdge(x, y, directionX, directionY, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    return arena.movementLimit(x, y, directionX, directionY, arena.size * 2);
  }

  function createDischargeBolt(source, target, arenaSize, damage) {
    const direction = normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx,
      source.storedVy || source.vy
    );
    const edgeDistance = distanceToArenaEdge(
      source.x,
      source.y,
      direction.x,
      direction.y,
      arenaSize
    );
    const start = {
      x: source.x + direction.x * source.radius,
      y: source.y + direction.y * source.radius
    };
    const end = {
      x: source.x + direction.x * (edgeDistance + 35),
      y: source.y + direction.y * (edgeDistance + 35)
    };
    const points = createJaggedPath(
      start,
      end,
      Math.max(9, Math.ceil(edgeDistance / 14)),
      10
    );
    const branches = [];
    for (let index = 3; index < points.length - 2; index += 4) {
      const branchStart = points[index];
      const side = index % 2 === 0 ? -1 : 1;
      const normalX = -direction.y * side;
      const normalY = direction.x * side;
      branches.push({
        start: branchStart,
        end: {
          x: branchStart.x + normalX * 13 + direction.x * 5,
          y: branchStart.y + normalY * 13 + direction.y * 5
        }
      });
    }
    return {
      kind: "electric-prime-discharge-bolt",
      life: 0.34,
      points,
      branches,
      hitWidth: DISCHARGE_WIDTH,
      damage,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const flicker = Math.floor(effect.age * 95) % 2 === 0 ? 1 : 0.7;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= (1 - progress) * flicker;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.shadowColor = "#72e5ff";
        context.shadowBlur = 14;
        context.strokeStyle = "rgba(64, 190, 255, 0.22)";
        context.lineWidth = DISCHARGE_WIDTH;
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
        context.shadowBlur = 9;
        context.strokeStyle = "#35bff5";
        context.lineWidth = 7 - progress * 3;
        context.stroke();
        context.shadowBlur = 3;
        context.strokeStyle = "#effeff";
        context.lineWidth = 1.5;
        context.stroke();
        context.strokeStyle = "#8beeff";
        context.lineWidth = 1;
        effect.branches.forEach((branch) => {
          context.beginPath();
          context.moveTo(branch.start.x, branch.start.y);
          context.lineTo(branch.end.x, branch.end.y);
          context.stroke();
        });
        context.restore();
      }
    };
  }

  function filamentSegment(effect) {
    const direction = normalizeDirection(effect.vx, effect.vy);
    const halfLength = (effect.length || FILAMENT_LENGTH) / 2;
    return {
      start: {
        x: effect.x - direction.x * halfLength,
        y: effect.y - direction.y * halfLength
      },
      end: {
        x: effect.x + direction.x * halfLength,
        y: effect.y + direction.y * halfLength
      },
      direction
    };
  }

  function filamentHistoryLength(history) {
    let length = 0;
    for (let index = 1; index < history.length; index += 1) {
      length += Math.hypot(
        history[index].x - history[index - 1].x,
        history[index].y - history[index - 1].y
      );
    }
    return length;
  }

  function nextFilamentRandom(effect) {
    let seed = Number.isFinite(effect.visualSeed)
      ? effect.visualSeed >>> 0
      : 0x6d2b79f5;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    effect.visualSeed = seed;
    return seed / 0x100000000;
  }

  function filamentNoise(effect, index, frame, salt = 0) {
    let value = (
      (effect.visualSignature || 0x51f15e5d) ^
      Math.imul(index + 1, 0x45d9f3b) ^
      Math.imul(frame + 1, 0x119de1f3) ^
      Math.imul(salt + 1, 0x27d4eb2d)
    ) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
    return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
  }

  function filamentVisualPoints(effect) {
    const points = Array.isArray(effect.history) ? effect.history.slice() : [];
    const last = points[points.length - 1];
    if (!last || Math.hypot(effect.x - last.x, effect.y - last.y) > 0.25) {
      points.push({ x: effect.x, y: effect.y });
    }
    return points;
  }

  function spawnFilamentSparkBurst(effect) {
    const points = filamentVisualPoints(effect);
    const pointIndex = Math.max(0, Math.min(
      points.length - 1,
      Math.floor(Math.pow(nextFilamentRandom(effect), 0.45) * points.length)
    ));
    const origin = points[pointIndex] || { x: effect.x, y: effect.y };
    const before = points[Math.max(0, pointIndex - 1)] || origin;
    const after = points[Math.min(points.length - 1, pointIndex + 1)] || origin;
    const direction = normalizeDirection(
      after.x - before.x,
      after.y - before.y,
      effect.vx,
      effect.vy
    );
    const directionAngle = Math.atan2(direction.y, direction.x);
    let count = 1 + Math.floor(nextFilamentRandom(effect) * 3);
    if (nextFilamentRandom(effect) > 0.84) count += 2;

    for (let index = 0; index < count; index += 1) {
      const side = nextFilamentRandom(effect) < 0.5 ? -1 : 1;
      const angle = directionAngle + side * (
        0.45 + nextFilamentRandom(effect) * 1.35
      ) + (nextFilamentRandom(effect) - 0.5) * 0.5;
      const speed = 32 + nextFilamentRandom(effect) * 105;
      const life = FILAMENT_SPARK_LIFE_MIN + nextFilamentRandom(effect) * (
        FILAMENT_SPARK_LIFE_MAX - FILAMENT_SPARK_LIFE_MIN
      );
      const tangentJitter = (nextFilamentRandom(effect) - 0.5) * 7;
      const normalJitter = (nextFilamentRandom(effect) - 0.5) * 4;
      effect.sparks.push({
        x: origin.x + direction.x * tangentJitter - direction.y * normalJitter,
        y: origin.y + direction.y * tangentJitter + direction.x * normalJitter,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        drag: 2.5 + nextFilamentRandom(effect) * 7,
        size: nextFilamentRandom(effect) > 0.78 ? 3 : 2,
        variant: Math.floor(nextFilamentRandom(effect) * 5),
        hot: nextFilamentRandom(effect) > 0.72
      });
    }
  }

  function updateFilamentVisualState(effect, dt) {
    const elapsed = Math.max(0, dt);
    if (!Array.isArray(effect.history) || effect.history.length === 0) {
      effect.history = [{ x: effect.x, y: effect.y }];
    }
    const last = effect.history[effect.history.length - 1];
    const deltaX = effect.x - last.x;
    const deltaY = effect.y - last.y;
    const moved = Math.hypot(deltaX, deltaY);
    if (moved + EPSILON >= FILAMENT_HISTORY_SPACING) {
      const directionX = deltaX / moved;
      const directionY = deltaY / moved;
      for (
        let distance = FILAMENT_HISTORY_SPACING;
        distance <= moved + EPSILON;
        distance += FILAMENT_HISTORY_SPACING
      ) {
        effect.history.push({
          x: last.x + directionX * Math.min(distance, moved),
          y: last.y + directionY * Math.min(distance, moved)
        });
      }
    }
    let historyLength = filamentHistoryLength(effect.history);
    while (effect.history.length > 2 && historyLength > FILAMENT_VISUAL_TRAIL_LENGTH) {
      const removed = effect.history.shift();
      historyLength -= Math.hypot(
        effect.history[0].x - removed.x,
        effect.history[0].y - removed.y
      );
    }

    if (!Array.isArray(effect.sparks)) effect.sparks = [];
    effect.sparks.forEach((spark) => {
      spark.x += spark.vx * elapsed;
      spark.y += spark.vy * elapsed;
      const damping = Math.exp(-spark.drag * elapsed);
      spark.vx *= damping;
      spark.vy *= damping;
      spark.life -= elapsed;
    });
    effect.sparks = effect.sparks.filter((spark) => spark.life > EPSILON);
    effect.sparkCooldown = Number.isFinite(effect.sparkCooldown)
      ? effect.sparkCooldown - elapsed
      : 0;
    let burstGuard = 0;
    while (effect.sparkCooldown <= EPSILON && burstGuard < 8) {
      spawnFilamentSparkBurst(effect);
      effect.sparkCooldown += FILAMENT_SPARK_INTERVAL_MIN + nextFilamentRandom(effect) * (
        FILAMENT_SPARK_INTERVAL_MAX - FILAMENT_SPARK_INTERVAL_MIN
      );
      burstGuard += 1;
    }
  }

  function rasterizePixelLine(start, end) {
    let x = Math.round(start.x);
    let y = Math.round(start.y);
    const endX = Math.round(end.x);
    const endY = Math.round(end.y);
    const deltaX = Math.abs(endX - x);
    const deltaY = Math.abs(endY - y);
    const stepX = x < endX ? 1 : -1;
    const stepY = y < endY ? 1 : -1;
    let error = deltaX - deltaY;
    const pixels = [];
    while (true) {
      pixels.push({ x, y });
      if (x === endX && y === endY) break;
      const doubled = error * 2;
      if (doubled > -deltaY) {
        error -= deltaY;
        x += stepX;
      }
      if (doubled < deltaX) {
        error += deltaX;
        y += stepY;
      }
    }
    return pixels;
  }

  function rasterizePixelCrack(points) {
    const pixels = [];
    for (let index = 1; index < points.length; index += 1) {
      const segment = rasterizePixelLine(points[index - 1], points[index]);
      if (pixels.length > 0) segment.shift();
      pixels.push(...segment);
    }
    return pixels;
  }

  function drawFilamentPixel(context, x, y, size, color, alpha) {
    const pixelSize = Math.max(1, Math.round(size));
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.fillRect(
      Math.round(x - pixelSize / 2),
      Math.round(y - pixelSize / 2),
      pixelSize,
      pixelSize
    );
  }

  function drawFilamentBranch(effect, context, crackPixels, branchIndex, frame, baseAlpha) {
    if (crackPixels.length < 4) return;
    const sourceNoise = filamentNoise(effect, branchIndex, frame, 11);
    const sourceIndex = Math.max(1, Math.min(
      crackPixels.length - 2,
      Math.floor(sourceNoise * crackPixels.length)
    ));
    const source = crackPixels[sourceIndex];
    const before = crackPixels[Math.max(0, sourceIndex - 2)];
    const after = crackPixels[Math.min(crackPixels.length - 1, sourceIndex + 2)];
    const direction = normalizeDirection(after.x - before.x, after.y - before.y);
    const side = filamentNoise(effect, branchIndex, frame, 12) < 0.5 ? -1 : 1;
    const length = 7 + Math.floor(filamentNoise(effect, branchIndex, frame, 13) * 9);
    const bend = (filamentNoise(effect, branchIndex, frame, 14) - 0.5) * 5;
    const elbow = {
      x: source.x - direction.y * side * length * 0.58 + direction.x * bend,
      y: source.y + direction.x * side * length * 0.58 + direction.y * bend
    };
    const end = {
      x: source.x - direction.y * side * length + direction.x * bend * 0.35,
      y: source.y + direction.x * side * length + direction.y * bend * 0.35
    };
    const branchPixels = rasterizePixelCrack([source, elbow, end]);
    for (let index = 1; index < branchPixels.length; index += 2) {
      const pixel = branchPixels[index];
      const fade = 0.35 + (1 - index / branchPixels.length) * 0.65;
      drawFilamentPixel(
        context,
        pixel.x,
        pixel.y,
        index < branchPixels.length * 0.45 ? 4 : 3,
        "#138ebd",
        baseAlpha * fade * 0.44
      );
      drawFilamentPixel(
        context,
        pixel.x,
        pixel.y,
        index < branchPixels.length * 0.3 ? 2 : 1,
        index < 3 ? "#eaffff" : "#5cddff",
        baseAlpha * fade
      );
    }
  }

  function buildJaggedFilamentPixels(effect, points, frame) {
    const pathPixels = rasterizePixelCrack(points);
    if (pathPixels.length < 6) return pathPixels;
    const anchors = [pathPixels[0]];
    const stride = 4;
    for (let index = stride; index < pathPixels.length - 1; index += stride) {
      const source = pathPixels[index];
      const before = pathPixels[Math.max(0, index - 2)];
      const after = pathPixels[Math.min(pathPixels.length - 1, index + 2)];
      const direction = normalizeDirection(after.x - before.x, after.y - before.y);
      const side = filamentNoise(effect, index, frame, 41) < 0.5 ? -1 : 1;
      const offset = 0.75 + filamentNoise(effect, index, frame, 42) * 2.25;
      const along = (filamentNoise(effect, index, frame, 43) - 0.5) * 2;
      anchors.push({
        x: source.x - direction.y * side * offset + direction.x * along,
        y: source.y + direction.x * side * offset + direction.y * along
      });
    }
    anchors.push(pathPixels[pathPixels.length - 1]);
    return rasterizePixelCrack(anchors);
  }

  function drawFilament(effect, context) {
    let points = filamentVisualPoints(effect);
    if (points.length < 2) {
      const segment = filamentSegment(effect);
      points = [segment.start, segment.end];
    }
    const frame = Math.floor((effect.age || 0) * 14);
    const crackPixels = buildJaggedFilamentPixels(effect, points, frame);
    if (crackPixels.length === 0) return;
    context.save();
    const baseAlpha = context.globalAlpha;
    context.globalCompositeOperation = "lighter";

    for (let index = 0; index < crackPixels.length; index += 2) {
      const pixel = crackPixels[index];
      const progress = index / Math.max(1, crackPixels.length - 1);
      const widthNoise = filamentNoise(effect, index, frame, 1);
      const flicker = 0.78 + filamentNoise(effect, index, frame, 2) * 0.22;
      const bodySize = widthNoise > 0.72 ? 4 : 3;
      const coreSize = widthNoise > 0.82 ? 2 : 1;
      const alpha = baseAlpha * (0.42 + progress * 0.58) * flicker;
      drawFilamentPixel(context, pixel.x, pixel.y, bodySize + 3, "#075b8b", alpha * 0.14);
      if (
        index > 3 &&
        index < crackPixels.length - 4 &&
        filamentNoise(effect, index, frame, 4) < 0.13
      ) {
        continue;
      }
      drawFilamentPixel(context, pixel.x, pixel.y, bodySize, "#159fc9", alpha * 0.7);
      drawFilamentPixel(
        context,
        pixel.x,
        pixel.y,
        coreSize,
        widthNoise > 0.88 ? "#eaffff" : "#75e7ff",
        alpha
      );
    }

    const branchCount = 5 + Math.floor(filamentNoise(effect, 0, frame, 30) * 5);
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
      drawFilamentBranch(effect, context, crackPixels, branchIndex, frame, baseAlpha);
    }

    for (let pulse = 0; pulse < 2; pulse += 1) {
      const interiorStart = Math.min(4, Math.max(0, crackPixels.length - 1));
      const interiorLength = Math.max(1, crackPixels.length - interiorStart * 2);
      const pulseIndex = interiorStart + (
        Math.floor((effect.age || 0) * (31 + pulse * 7)) +
        Math.floor(crackPixels.length * pulse / 2)
      ) % interiorLength;
      for (let offset = 0; offset < 2; offset += 1) {
        const index = Math.max(0, pulseIndex - offset);
        const pixel = crackPixels[index];
        drawFilamentPixel(
          context,
          pixel.x,
          pixel.y,
          offset === 0 ? 3 : 2,
          offset === 0 ? "#ffffff" : "#baf7ff",
          baseAlpha * (1 - offset * 0.38)
        );
      }
    }

    (effect.sparks || []).forEach((spark) => {
      const fade = clamp(spark.life / spark.maxLife, 0, 1);
      const trailScale = 0.045 + (spark.variant % 3) * 0.022;
      const trailStart = {
        x: spark.x - spark.vx * trailScale,
        y: spark.y - spark.vy * trailScale
      };
      const sparkPixels = rasterizePixelLine(trailStart, spark);
      sparkPixels.forEach((pixel, index) => {
        if ((index + spark.variant) % 2 !== 0 && index !== sparkPixels.length - 1) return;
        const progress = (index + 1) / sparkPixels.length;
        drawFilamentPixel(
          context,
          pixel.x,
          pixel.y,
          index === sparkPixels.length - 1 ? spark.size + 2 : 3,
          spark.hot ? "#a66b22" : "#087b9f",
          baseAlpha * fade * progress * 0.3
        );
        drawFilamentPixel(
          context,
          pixel.x,
          pixel.y,
          index === sparkPixels.length - 1 ? spark.size : 1,
          spark.hot
            ? (index === sparkPixels.length - 1 ? "#fff4c2" : "#ffc65d")
            : (index === sparkPixels.length - 1 ? "#ffffff" : "#70eaff"),
          baseAlpha * fade * progress
        );
      });
      const sparkDirection = normalizeDirection(spark.vx, spark.vy);
      const sparkSide = spark.variant % 2 === 0 ? -1 : 1;
      const tipOffsetX = -sparkDirection.y * sparkSide * (spark.size + 1);
      const tipOffsetY = sparkDirection.x * sparkSide * (spark.size + 1);
      drawFilamentPixel(
        context,
        spark.x + tipOffsetX,
        spark.y + tipOffsetY,
        1,
        spark.hot ? "#ffd77a" : "#9af2ff",
        baseAlpha * fade * 0.8
      );
    });
    context.restore();
  }

  const electricPrimeDefinition = {
    id: "electricPrime",
    name: "雷电",
    englishName: "Electric Ball Prime",
    color: "#a8eaff",
    description: "场外丝状雷电 / 四击阶乘放电 / 接地反击",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FILAMENT_INTERVAL,
    createBehavior(services) {
      let filamentTimer = 0;
      let filamentPending = false;
      let completedRounds = 0;
      const targetStates = new Map();
      const enemyProjectiles = new Set();
      let projectileCacheTime = -Infinity;

      function currentFilamentRate() {
        return FILAMENT_BASE_RATE + completedRounds * FILAMENT_RATE_GAIN_PER_ROUND;
      }

      function currentFilamentInterval() {
        return 1 / currentFilamentRate();
      }

      function advanceFilamentTimer(dt) {
        const interval = currentFilamentInterval();
        filamentTimer = Math.min(interval, filamentTimer + Math.max(0, dt));
        filamentPending = filamentTimer + EPSILON >= interval;
      }

      function stateFor(target) {
        const key = targetKey(target);
        let state = targetStates.get(key);
        if (!state) {
          state = { target, count: 0, round: 0, marker: null };
          targetStates.set(key, state);
        }
        state.target = target;
        return state;
      }

      function syncMarker(state, visualServices = services) {
        if (!state.marker || state.marker.life <= 0) {
          state.marker = visualServices.spawnVisualEffect(createGroundMarker(state.target, state));
        }
        state.marker.target = state.target;
        state.marker.count = state.count;
        state.marker.round = state.round;
      }

      function ensureMarkers() {
        const livingKeys = new Set();
        services.forEachEnemy((target) => {
          const key = targetKey(target);
          livingKeys.add(key);
          const state = stateFor(target);
          syncMarker(state);
        });
        for (const [key, state] of targetStates.entries()) {
          if (livingKeys.has(key)) continue;
          if (state.marker) state.marker.life = 0;
          targetStates.delete(key);
        }
      }

      function bestAttractionTarget(effect, entityServices) {
        let best = null;
        let bestCount = -1;
        let bestDistance = Infinity;
        entityServices.forEachEnemy((target) => {
          if (!entityServices.getContactProfile(target).attackable) return;
          const state = stateFor(target);
          const distance = Math.hypot(target.x - effect.x, target.y - effect.y);
          if (state.count < bestCount) return;
          if (state.count === bestCount && distance >= bestDistance) return;
          best = target;
          bestCount = state.count;
          bestDistance = distance;
        });
        return best;
      }

      function electrolyzeProjectile(effect, projectile, entityServices) {
        projectile.life = 0;
        projectile.update = () => {};
        effect.life = 0;
        const x = projectile.x;
        const y = projectile.y;
        entityServices.spawnVisualEffect(createElectrolysisStorm(x, y));
        entityServices.forEachEnemy((target) => {
          if (Math.hypot(target.x - x, target.y - y) > (
            ELECTROLYSIS_RADIUS + target.radius
          )) return;
          entityServices.dealDamage(target, ELECTROLYSIS_DAMAGE);
        });
      }

      function discharge(source, triggerTarget, state, game, entityServices) {
        state.count = 0;
        state.round += 1;
        completedRounds += 1;
        syncMarker(state, entityServices);
        const damage = dischargeDamage(state.round);
        const bolt = entityServices.spawnVisualEffect(
          createDischargeBolt(source, triggerTarget, game, damage)
        );
        entityServices.forEachEnemy((target) => {
          if (!pathHitsTarget(bolt.points, target, DISCHARGE_WIDTH / 2)) return;
          entityServices.dealDamage(target, damage);
        });

        const explosionX = triggerTarget.x;
        const explosionY = triggerTarget.y;
        entityServices.playSound("ability", { cue: "explosion" });
        entityServices.spawnVisualEffect(createChargeExplosion(explosionX, explosionY, damage));
        entityServices.forEachEnemy((target) => {
          if (Math.hypot(target.x - explosionX, target.y - explosionY) > (
            CHARGE_EXPLOSION_RADIUS + target.radius
          )) return;
          if (target.hp > 0) {
            entityServices.applyEffect(target, createDischargeStun());
          }
        });
      }

      function hitEnemy(effect, target, game, entityServices) {
        if (!entityServices.dealDamage(target, FILAMENT_DAMAGE)) return false;
        effect.life = 0;
        if (target.hp <= 0) return true;
        entityServices.applyEffect(target, createFilamentStun(effect.source));
        const state = stateFor(target);
        state.count = Math.min(HITS_PER_ROUND, state.count + 1);
        syncMarker(state, entityServices);
        if (state.count >= HITS_PER_ROUND) {
          discharge(effect.source, target, state, game, entityServices);
        }
        return true;
      }

      function refreshEnemyProjectiles(game, entityServices) {
        if (projectileCacheTime === game.time) return;
        projectileCacheTime = game.time;
        for (const entity of game.combatEntities) {
          if (
            entity &&
            entity.isProjectile === true &&
            entityServices.isEnemy(entity)
          ) {
            enemyProjectiles.add(entity);
          }
        }
      }

      function updateFilament(effect, game, dt, entityServices) {
        if (effect.life <= 0) return;
        const elapsed = Math.max(0, dt);
        const target = bestAttractionTarget(effect, entityServices);
        if (target) {
          const state = stateFor(target);
          effect.turnRateDegrees = TURN_RATES_DEGREES[state.count];
          effect.speed = effect.baseSpeed * FILAMENT_SPEED_MULTIPLIERS[state.count];
          const currentAngle = Math.atan2(effect.vy, effect.vx);
          const targetAngle = Math.atan2(target.y - effect.y, target.x - effect.x);
          const nextAngle = rotateToward(
            currentAngle,
            targetAngle,
            effect.turnRateDegrees * Math.PI / 180 * elapsed
          );
          effect.vx = Math.cos(nextAngle) * effect.speed;
          effect.vy = Math.sin(nextAngle) * effect.speed;
        }
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;

        const arena = resolveArenaGeometry(game);
        const inside = arena.contains(effect.x, effect.y);
        if (inside) effect.enteredArena = true;
        if (effect.enteredArena && !arena.intersectsCircle(effect.x, effect.y, FILAMENT_DESPAWN_MARGIN)) {
          effect.life = 0;
          return;
        }
        updateFilamentVisualState(effect, elapsed);

        const segment = filamentSegment(effect);
        refreshEnemyProjectiles(game, entityServices);
        for (const projectile of (services.borrowedAttackOnly ? [] : enemyProjectiles)) {
          if (!projectile || projectile === effect || projectile.isProjectile !== true) {
            enemyProjectiles.delete(projectile);
            continue;
          }
          if (projectile.life <= 0 || (
            Number.isFinite(projectile.age) && projectile.age >= projectile.life
          )) {
            enemyProjectiles.delete(projectile);
            continue;
          }
          if (!entityServices.isEnemy(projectile)) {
            enemyProjectiles.delete(projectile);
            continue;
          }
          if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) continue;
          const projectileStart = {
            x: Number.isFinite(projectile.previousX) ? projectile.previousX : projectile.x,
            y: Number.isFinite(projectile.previousY) ? projectile.previousY : projectile.y
          };
          const projectileEnd = { x: projectile.x, y: projectile.y };
          const hitRadius = (Number.isFinite(projectile.radius) ? projectile.radius : 3) +
            FILAMENT_HIT_RADIUS;
          if (segmentDistanceSquared(
            segment.start,
            segment.end,
            projectileStart,
            projectileEnd
          ) > hitRadius * hitRadius) continue;
          electrolyzeProjectile(effect, projectile, entityServices);
          return;
        }

        for (const enemy of entityServices.getEnemies()) {
          if (!entityServices.getContactProfile(enemy).attackable) continue;
          if (pointToSegmentDistanceSquared(
            enemy.x,
            enemy.y,
            segment.start,
            segment.end
          ) > (enemy.radius + FILAMENT_HIT_RADIUS) ** 2) continue;
          if (hitEnemy(effect, enemy, game, entityServices)) return;
        }
      }

      function spawnFilament(context) {
        const arena = resolveArenaGeometry(context.game);
        const edge = Math.floor(Math.random() * 4);
        const progress = Math.random();
        const deviation = (Math.random() - 0.5) * Math.PI * 0.9;
        const outside = FILAMENT_LENGTH / 2 + 2;
        const point = arena.boundaryPoint(["top", "right", "bottom", "left"][edge],
          edge < 2 ? progress : 1 - progress);
        const spawn = { x: point.x - point.normalX * outside,
          y: point.y - point.normalY * outside, angle: Math.atan2(point.normalY, point.normalX) };
        const angle = spawn.angle + deviation;
        const baseSpeed = context.ball.speed;
        const speed = baseSpeed * FILAMENT_SPEED_MULTIPLIERS[0];
        const effect = {
          kind: "electric-prime-filament",
          drawLayer: "background",
          life: 12,
          source: context.ball,
          x: spawn.x,
          y: spawn.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          baseSpeed,
          speed,
          length: FILAMENT_LENGTH,
          turnRateDegrees: TURN_RATES_DEGREES[0],
          enteredArena: false,
          history: [{ x: spawn.x, y: spawn.y }],
          sparks: [],
          sparkCooldown: 0,
          visualSeed: Math.floor(Math.random() * 0x100000000) >>> 0,
          visualSignature: Math.floor(Math.random() * 0x100000000) >>> 0,
          update({ effect: activeEffect, game, services: entityServices }, dt) {
            updateFilament(activeEffect, game, dt, entityServices);
          },
          draw({ effect: activeEffect }, canvasContext) {
            drawFilament(activeEffect, canvasContext);
          }
        };
        services.spawnCombatEntity(effect);
      }

      function releasePendingFilament(context) {
        if (!filamentPending) return;
        filamentPending = false;
        filamentTimer = 0;
        spawnFilament(context);
      }

      function releaseContactCharge(context, target) {
        const state = stateFor(target);
        if (state.count <= 0) return;
        const damage = 1;
        state.count = 0;
        syncMarker(state);
        const source = context.ball;
        context.services.spawnVisualEffect(createCounterShockwave(source.x, source.y, damage));
        context.services.forEachEnemy((enemy) => {
          const deltaX = enemy.x - source.x;
          const deltaY = enemy.y - source.y;
          if (Math.hypot(deltaX, deltaY) > COUNTER_RADIUS + enemy.radius) return;
          if (!context.services.dealDamage(enemy, damage)) return;
          if (enemy.hp > 0) {
            context.services.applyEffect(
              enemy,
              createCounterDaze(source, deltaX, deltaY)
            );
          }
        });
      }

      return {
        onSpawn() {
          ensureMarkers();
        },
        update(_context, dt) {
          advanceFilamentTimer(dt);
          ensureMarkers();
        },
        updateWhilePaused(_context, dt) {
          advanceFilamentTimer(dt);
          ensureMarkers();
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, currentFilamentInterval() - filamentTimer);
        },
        getNextPausedTransitionIn() {
          return Math.max(EPSILON, currentFilamentInterval() - filamentTimer);
        },
        afterUpdateStep(context) {
          releasePendingFilament(context);
        },
        afterUpdateStepWhilePaused(context) {
          releasePendingFilament(context);
        },
        onEnemyProjectileSpawned(context) {
          if (context.projectile) enemyProjectiles.add(context.projectile);
        },
        onCollision(context, target) {
          releaseContactCharge(context, target);
        },
        getPrimeSpawnRate() {
          return currentFilamentRate();
        },
        getPrimeState(target) {
          const state = target ? targetStates.get(targetKey(target)) : null;
          const count = state ? state.count : 0;
          return {
            count,
            round: state ? state.round : 0,
            turnRateDegrees: TURN_RATES_DEGREES[count]
          };
        }
      };
    }
  };

  registerBall(electricPrimeDefinition);
  return { electricPrimeDefinition };
});
