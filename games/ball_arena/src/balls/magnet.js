(function initializeMagnetBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("./magnet-visuals.js"), require("./grenade.js"))
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMagnetPlugin({ resolveArenaGeometry, registerBall, magnetDrawMagnet, magnetCreateExplosion, createGrenadeKnockback
}) {
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;
  const RULES = Object.freeze({
    initialThrowFrequencyHz: 1,
    throwFrequencyAccelerationHzPerSecond: 0.02,
    maximumThrowFrequencyHz: 3,
    throwDuration: 0.3,
    throwDistance: 50,
    length: 30,
    width: 9,
    attractionRadius: 84,
    attractionGrowthPerSecond: 3,
    alignmentDuration: 0.25,
    attractionSpeed: 36,
    minimumPairDuration: 0.5,
    innerBlastRadius: 30,
    middleBlastRadius: 69,
    outerBlastRadius: 81
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function angleDifference(target, current) {
    return Math.atan2(Math.sin(target - current), Math.cos(target - current));
  }

  function attractionRadius(time) {
    return RULES.attractionRadius + Math.floor(Math.max(0, time)) * RULES.attractionGrowthPerSecond;
  }

  function throwFrequency(time) {
    return Math.min(
      RULES.maximumThrowFrequencyHz,
      RULES.initialThrowFrequencyHz +
        Math.max(0, time) * RULES.throwFrequencyAccelerationHzPerSecond
    );
  }

  function damageForDistance(distance) {
    if (distance <= RULES.innerBlastRadius + EPSILON) return 12 + Math.floor(Math.random() * 4);
    if (distance <= RULES.middleBlastRadius + EPSILON) return 7 + Math.floor(Math.random() * 3);
    if (distance <= RULES.outerBlastRadius + EPSILON) return 5;
    return 0;
  }

  function isAvailable(entity) {
    return entity && entity.kind === "magnet-bar" && entity.entityActive !== false &&
      entity.age < entity.life && entity.phase === "idle" && !entity.pair;
  }

  function beginPair(first, second, arenaSize) {
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy);
    const direction = distance > EPSILON
      ? { x: dx / distance, y: dy / distance }
      : { x: Math.cos(first.angle), y: Math.sin(first.angle) };
    const bearing = Math.atan2(direction.y, direction.x);
    const straightTurn = Math.abs(angleDifference(bearing, first.angle)) +
      Math.abs(angleDifference(bearing, second.angle));
    const reverseTurn = Math.abs(angleDifference(bearing + Math.PI, first.angle)) +
      Math.abs(angleDifference(bearing + Math.PI, second.angle));
    const desiredAngle = bearing + (reverseTurn < straightTurn ? Math.PI : 0);
    const contactGap = (first.length + second.length - (first.width + second.width) * 0.32) / 2;
    const travel = Math.max(0, (distance - contactGap) / 2);
    let firstAlignedPosition = { x: first.x, y: first.y };
    let secondAlignedPosition = { x: second.x, y: second.y };
    if (distance < contactGap) {
      // Bars that landed too close make room while aligning, so their pole faces
      // touch cleanly instead of exploding from intersecting bodies.
      const margin = Math.max(first.radius, second.radius) + 2;
      const halfGap = contactGap / 2;
      const arena = resolveArenaGeometry(arenaSize);
      const center = arena.shape === "circle"
        ? arena.clampPoint((first.x + second.x) / 2, (first.y + second.y) / 2, margin + halfGap)
        : { x: clamp((first.x + second.x) / 2, arena.left + margin + Math.abs(direction.x) * halfGap,
          arena.right - margin - Math.abs(direction.x) * halfGap),
          y: clamp((first.y + second.y) / 2, arena.top + margin + Math.abs(direction.y) * halfGap,
            arena.bottom - margin - Math.abs(direction.y) * halfGap) };
      const centerX = center.x, centerY = center.y;
      firstAlignedPosition = { x: centerX - direction.x * halfGap, y: centerY - direction.y * halfGap };
      secondAlignedPosition = { x: centerX + direction.x * halfGap, y: centerY + direction.y * halfGap };
    }
    const pair = {
      first,
      second,
      elapsed: 0,
      direction,
      distance,
      // The slanted end faces meet at their midpoints, not at either sharp corner.
      travel,
      alignmentDuration: Math.max(RULES.alignmentDuration,
        RULES.minimumPairDuration - travel / RULES.attractionSpeed),
      firstOrigin: { x: first.x, y: first.y },
      secondOrigin: { x: second.x, y: second.y },
      firstAlignedPosition,
      secondAlignedPosition,
      firstAngle: first.angle,
      secondAngle: second.angle,
      desiredAngle,
      exploded: false
    };
    first.pair = second.pair = pair;
    first.phase = second.phase = "align";
    first.vx = first.vy = second.vx = second.vy = 0;
    return pair;
  }

  function explodePair(pair, services) {
    if (pair.exploded) return;
    pair.exploded = true;
    services.playSound("ability", { cue: "explosion" });
    const x = (pair.first.x + pair.second.x) / 2;
    const y = (pair.first.y + pair.second.y) / 2;
    pair.first.phase = pair.second.phase = "exploded";
    pair.first.entityActive = pair.second.entityActive = false;
    services.forEachEnemy((target) => {
      const surfaceDistance = Math.max(0, Math.hypot(target.x - x, target.y - y) - target.radius);
      const damage = damageForDistance(surfaceDistance);
      if (damage > 0 && services.dealDamage(target, damage)) {
        const dx = target.x - x;
        const dy = target.y - y;
        const distance = Math.hypot(dx, dy);
        const direction = distance > EPSILON
          ? { x: dx / distance, y: dy / distance }
          : pair.direction;
        const knockback = createGrenadeKnockback(pair.first, direction.x, direction.y, 4.5, "magnet");
        knockback.duration = 0.15;
        services.applyEffect(target, knockback);
      }
    });
    services.spawnVisualEffect(magnetCreateExplosion(x, y));
  }

  function advancePair(entity, services, dt) {
    const pair = entity.pair;
    const other = pair.first === entity ? pair.second : pair.first;
    if (other.entityActive === false || other.age >= other.life) {
      entity.pair = null;
      entity.phase = "idle";
      return;
    }
    // One entity owns the shared timeline; both bars therefore move once per step.
    if (pair.first !== entity || pair.exploded) return;
    pair.elapsed += Math.max(0, dt);
    const alignment = clamp(pair.elapsed / pair.alignmentDuration, 0, 1);
    const easedAlignment = alignment * alignment * (3 - 2 * alignment);
    pair.first.angle = pair.firstAngle + angleDifference(pair.desiredAngle, pair.firstAngle) * easedAlignment;
    pair.second.angle = pair.secondAngle + angleDifference(pair.desiredAngle, pair.secondAngle) * easedAlignment;
    pair.first.x = pair.firstOrigin.x + (pair.firstAlignedPosition.x - pair.firstOrigin.x) * easedAlignment;
    pair.first.y = pair.firstOrigin.y + (pair.firstAlignedPosition.y - pair.firstOrigin.y) * easedAlignment;
    pair.second.x = pair.secondOrigin.x + (pair.secondAlignedPosition.x - pair.secondOrigin.x) * easedAlignment;
    pair.second.y = pair.secondOrigin.y + (pair.secondAlignedPosition.y - pair.secondOrigin.y) * easedAlignment;
    pair.first.alignmentProgress = pair.second.alignmentProgress = alignment;
    if (alignment < 1) return;

    pair.first.phase = pair.second.phase = "attract";
    const movingTime = Math.max(0, pair.elapsed - pair.alignmentDuration);
    const distance = RULES.attractionSpeed * movingTime;
    const travel = Math.min(pair.travel, distance);
    pair.first.x = pair.firstAlignedPosition.x + pair.direction.x * travel;
    pair.first.y = pair.firstAlignedPosition.y + pair.direction.y * travel;
    pair.second.x = pair.secondAlignedPosition.x - pair.direction.x * travel;
    pair.second.y = pair.secondAlignedPosition.y - pair.direction.y * travel;
    const speed = travel + EPSILON < pair.travel
      ? RULES.attractionSpeed
      : 0;
    pair.first.vx = pair.direction.x * speed;
    pair.first.vy = pair.direction.y * speed;
    pair.second.vx = -pair.direction.x * speed;
    pair.second.vy = -pair.direction.y * speed;
    pair.first.attractionProgress = pair.second.attractionProgress = pair.travel > EPSILON
      ? travel / pair.travel : 1;
    if (travel + EPSILON >= pair.travel) {
      explodePair(pair, services);
    }
  }

  function createMagnetEntity(x, y, destinationX, destinationY, angle) {
    return {
      kind: "magnet-bar",
      combatKind: "trap",
      lifecycle: "independent",
      life: Number.MAX_SAFE_INTEGER,
      x,
      y,
      originX: x,
      originY: y,
      destinationX,
      destinationY,
      angle,
      length: RULES.length,
      width: RULES.width,
      radius: Math.hypot(RULES.length / 2, RULES.width / 2),
      flightElapsed: 0,
      throwProgress: 0,
      phase: "throw",
      pair: null,
      alignmentProgress: 0,
      attractionProgress: 0,
      vx: (destinationX - x) / RULES.throwDuration,
      vy: (destinationY - y) / RULES.throwDuration,
      update({ entity, game, services }, dt) {
        if (entity.pair) {
          advancePair(entity, services, dt);
          return;
        }
        if (entity.phase === "throw") {
          entity.flightElapsed = Math.min(RULES.throwDuration, entity.flightElapsed + Math.max(0, dt));
          entity.throwProgress = entity.flightElapsed / RULES.throwDuration;
          const progress = 1 - (1 - entity.throwProgress) * (1 - entity.throwProgress);
          entity.x = entity.originX + (entity.destinationX - entity.originX) * progress;
          entity.y = entity.originY + (entity.destinationY - entity.originY) * progress;
          if (entity.flightElapsed + EPSILON < RULES.throwDuration) return;
          entity.x = entity.destinationX;
          entity.y = entity.destinationY;
          entity.vx = entity.vy = 0;
          entity.phase = "idle";
        }
        let partner = null;
        let nearestDistance = attractionRadius(game.time) + EPSILON;
        for (const candidate of game.combatEntities) {
          if (candidate === entity || candidate.ownerInstanceId !== entity.ownerInstanceId || !isAvailable(candidate)) continue;
          const distance = Math.hypot(candidate.x - entity.x, candidate.y - entity.y);
          if (distance > nearestDistance) continue;
          nearestDistance = distance;
          partner = candidate;
        }
        if (partner) beginPair(entity, partner, game);
      },
      draw: magnetDrawMagnet
    };
  }

  const magnetDefinition = {
    id: "magnet",
    name: "磁力球",
    englishName: "Magnet",
    color: "#7c3bd2",
    description: "开场1Hz投磁铁，频率每秒+0.02Hz（上限3Hz）/ 84范围吸引，每秒+3，相吸速度36 / 对接爆炸：30内12-15，69内7-9，81内5，4.5倍速击退0.15秒",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let activeTime = 0;
      let nextThrowAt = 1 / RULES.initialThrowFrequencyHz;
      let throwCount = 0;
      return {
        update(_context, dt) {
          activeTime += Math.max(0, dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, nextThrowAt - activeTime);
        },
        afterUpdateStep({ ball, game }) {
          if (activeTime + EPSILON < nextThrowAt) return;
          throwCount += 1;
          const directionAngle = Math.random() * TAU;
          const angle = Math.random() * TAU;
          const margin = Math.hypot(RULES.length / 2, RULES.width / 2) + 2;
          const { x: destinationX, y: destinationY } = resolveArenaGeometry(game).clampPoint(
            ball.x + Math.cos(directionAngle) * RULES.throwDistance,
            ball.y + Math.sin(directionAngle) * RULES.throwDistance, margin);
          services.spawnCombatEntity(createMagnetEntity(ball.x, ball.y, destinationX, destinationY, angle));
          services.playSound("shoot");
          nextThrowAt = activeTime + 1 / throwFrequency(activeTime);
        },
        getMagnetState() {
          return {
            activeTime,
            nextThrowAt,
            throwCount,
            frequencyHz: throwFrequency(activeTime)
          };
        }
      };
    }
  };

  registerBall(magnetDefinition);
  return {
    magnetDefinition,
    MAGNET_RULES: RULES,
    magnetCreateMagnet: createMagnetEntity,
    magnetAttractionRadius: attractionRadius,
    magnetThrowFrequency: throwFrequency,
    magnetDamageForDistance: damageForDistance
  };
});
