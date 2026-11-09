(function initializeSixZone(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSixZonePlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const SECTOR_COLORS = Object.freeze([
    "#86d9ff", "#2467c9", "#8b9199",
    "#ffd84a", "#eafcff", "#23835a"
  ]);
  const FROST_WIDTH = 20;
  const FROST_ACTIVE_DURATION = 1;
  const FROST_FADE_DURATION = 0.25;
  const FREEZE_DURATION = 0.6;
  const FROST_CONTACT_GRACE = 0.08;
  const FROST_DAMAGE_START_INTERVAL = 1;
  const FROST_DAMAGE_END_INTERVAL = 0.3;
  const FROST_DAMAGE_START_RATE = 1 / FROST_DAMAGE_START_INTERVAL;
  const FROST_DAMAGE_END_RATE = 1 / FROST_DAMAGE_END_INTERVAL;
  const FROST_DAMAGE = 1;
  const SONIC_LIFE = 0.4;
  const SONIC_MIN_RADIUS = 15;
  const SONIC_MAX_RADIUS = 60;
  const ARROW_INTERVAL = 1;
  const ARROW_CHARGE_DURATION = 0.6;
  const ARROW_DAMAGE = 1;
  const ARROW_SPEED_MULTIPLIER = 3;
  const ELECTRIC_CHARGE_TIME = 5;
  const ELECTRIC_STUN_DURATION = 1.2;
  const ELECTRIC_TICK_INTERVAL = 0.4;
  const ELECTRIC_DAMAGE = 1;
  const GLASS_RADIUS = 2;
  const GLASS_PLACEMENT_RADIUS = 20;
  const GLASS_DAMAGE = 1;
  const SAW_RADIUS = 12.5;
  const SAW_ORBIT_RADIUS = 25;
  const SAW_INITIAL_SPEED_MULTIPLIER = 3;
  const SAW_FINAL_SPEED_MULTIPLIER = 1;
  const SAW_DECELERATION_DURATION = 8;
  const SAW_COOLDOWN = 5;
  const SAW_DAMAGE = 1;
  const EFFECT_LIFE = 1e9;
  const MIN_TRAIL_LENGTH = 0.5;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashPixel(x, y, seed) {
    let value = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 1000) / 1000;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = x;
    let directionY = y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function cumulativeFrostDamage(elapsed) {
    const duration = Math.max(0, elapsed);
    const rampElapsed = Math.min(duration, FREEZE_DURATION);
    const rateDelta = FROST_DAMAGE_END_RATE - FROST_DAMAGE_START_RATE;
    return (
      FROST_DAMAGE_START_RATE * duration +
      rateDelta * rampElapsed * rampElapsed / (2 * FREEZE_DURATION) +
      rateDelta * Math.max(0, duration - FREEZE_DURATION)
    );
  }

  function drawSixSectorBody(context, ball) {
    const start = -Math.PI / 2;
    for (let index = 0; index < SECTOR_COLORS.length; index += 1) {
      const from = start + index * Math.PI / 3;
      const to = from + Math.PI / 3;
      context.beginPath();
      context.moveTo(ball.x, ball.y);
      context.arc(ball.x, ball.y, ball.radius, from, to);
      context.closePath();
      context.fillStyle = SECTOR_COLORS[index];
      context.fill();
      if (typeof context.stroke === "function") {
        context.strokeStyle = "rgba(255, 255, 255, 0.48)";
        context.lineWidth = 0.55;
        context.stroke();
      }
    }
  }

  function circleTouchesSegment(ball, effect) {
    const reach = ball.radius + FROST_WIDTH / 2 + EPSILON;
    if (
      ball.x < effect.segmentMinX - reach || ball.x > effect.segmentMaxX + reach ||
      ball.y < effect.segmentMinY - reach || ball.y > effect.segmentMaxY + reach
    ) return false;
    const deltaX = effect.segmentDeltaX;
    const deltaY = effect.segmentDeltaY;
    const lengthSquared = effect.segmentLengthSquared;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((ball.x - effect.startX) * deltaX + (ball.y - effect.startY) * deltaY) /
          lengthSquared,
        0,
        1
      );
    const x = effect.startX + deltaX * progress;
    const y = effect.startY + deltaY * progress;
    return Math.hypot(ball.x - x, ball.y - y) <= ball.radius + FROST_WIDTH / 2;
  }

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function closestPointOnSegment(pointX, pointY, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  function pointSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const closest = closestPointOnSegment(pointX, pointY, startX, startY, endX, endY);
    const deltaX = pointX - closest.x;
    const deltaY = pointY - closest.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  function segmentsIntersect(first, second) {
    const firstX = first.endX - first.startX;
    const firstY = first.endY - first.startY;
    const secondX = second.endX - second.startX;
    const secondY = second.endY - second.startY;
    const denominator = crossProduct(firstX, firstY, secondX, secondY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = second.startX - first.startX;
    const offsetY = second.startY - first.startY;
    const firstProgress = crossProduct(offsetX, offsetY, secondX, secondY) / denominator;
    const secondProgress = crossProduct(offsetX, offsetY, firstX, firstY) / denominator;
    return firstProgress >= -EPSILON && firstProgress <= 1 + EPSILON &&
      secondProgress >= -EPSILON && secondProgress <= 1 + EPSILON;
  }

  function segmentDistanceSquared(first, second) {
    if (segmentsIntersect(first, second)) return 0;
    return Math.min(
      pointSegmentDistanceSquared(
        first.startX, first.startY, second.startX, second.startY, second.endX, second.endY
      ),
      pointSegmentDistanceSquared(
        first.endX, first.endY, second.startX, second.startY, second.endX, second.endY
      ),
      pointSegmentDistanceSquared(
        second.startX, second.startY, first.startX, first.startY, first.endX, first.endY
      ),
      pointSegmentDistanceSquared(
        second.endX, second.endY, first.startX, first.startY, first.endX, first.endY
      )
    );
  }

  // 冻结进度只产出 speedFactor（最低 0.1）。倍率、朝向与免疫全部由引擎的
  // SpeedModifierSystem 统一处理，这里不再直接改倍率或速度向量。
  function applyFreezeProgress(effect, progress) {
    effect.speedFactor = 1 - clamp(progress, 0, 1) * 0.9;
    effect.freezeProgress = clamp(progress, 0, 1);
  }

  function createFrostEffect(services, source) {
    return {
      id: "six-zone-frost",
      attackTags: ["cold", "freeze"],
      duration: FROST_CONTACT_GRACE,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          // 重新接触只延续冻结进度与伤害节奏，不重置计时。
          effect.startedAt = game.time;
          effect.damage = FROST_DAMAGE;
          effect.startTickInterval = FROST_DAMAGE_START_INTERVAL;
          effect.endTickInterval = FROST_DAMAGE_END_INTERVAL;
          effect.damageProgress = 0;
          effect.damageElapsed = 0;
        }
        applyFreezeProgress(effect, (game.time - effect.startedAt) / FREEZE_DURATION);
      },
      update({ ball, effect, game, services: effectServices }) {
        if (game.time + EPSILON < effect.expiresAt) {
          const elapsed = Math.max(0, game.time - effect.startedAt);
          effect.damageProgress += Math.max(
            0,
            cumulativeFrostDamage(elapsed) -
              cumulativeFrostDamage(effect.damageElapsed)
          );
          effect.damageElapsed = elapsed;
          while (effect.damageProgress + EPSILON >= 1) {
            effectServices.dealDamage(ball, effect.damage);
            effect.damageProgress = Math.max(0, effect.damageProgress - 1);
          }
        }
        applyFreezeProgress(effect, (game.time - effect.startedAt) / FREEZE_DURATION);
      },
      draw({ ball, effect }, context) {
        const progress = effect.freezeProgress || 0;
        context.save();
        context.globalAlpha *= 0.4 + progress * 0.45;
        context.strokeStyle = "#eafcff";
        context.lineWidth = 1;
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI / 3;
          context.beginPath();
          context.moveTo(
            ball.x + Math.cos(angle) * (ball.radius + 1),
            ball.y + Math.sin(angle) * (ball.radius + 1)
          );
          context.lineTo(
            ball.x + Math.cos(angle) * (ball.radius + 3 + progress * 2),
            ball.y + Math.sin(angle) * (ball.radius + 3 + progress * 2)
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createFrostCrystals(startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const tangentX = deltaX / length;
    const tangentY = deltaY / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const count = Math.max(2, Math.ceil(length / 4));
    return Array.from({ length: count }, (_, index) => {
      const progress = (index + 0.5) / count;
      const side = index % 2 === 0 ? -1 : 1;
      const centerX = startX + deltaX * progress + normalX * side * 2.5;
      const centerY = startY + deltaY * progress + normalY * side * 2.5;
      const size = 2.8 + index % 3;
      return [
        { x: centerX - tangentX * size, y: centerY - tangentY * size },
        { x: centerX + normalX * size * 0.65, y: centerY + normalY * size * 0.65 },
        { x: centerX + tangentX * size, y: centerY + tangentY * size },
        { x: centerX - normalX * size * 0.65, y: centerY - normalY * size * 0.65 }
      ];
    });
  }

  function createFrostTrail(services, source, startX, startY, endX, endY) {
    const segmentDeltaX = endX - startX;
    const segmentDeltaY = endY - startY;
    return {
      kind: "six-zone-frost-trail",
      drawLayer: "background",
      life: FROST_ACTIVE_DURATION + FROST_FADE_DURATION,
      width: FROST_WIDTH,
      activeDuration: FROST_ACTIVE_DURATION,
      fadeDuration: FROST_FADE_DURATION,
      startX,
      startY,
      endX,
      endY,
      segmentDeltaX,
      segmentDeltaY,
      segmentLengthSquared: segmentDeltaX * segmentDeltaX + segmentDeltaY * segmentDeltaY,
      segmentMinX: Math.min(startX, endX),
      segmentMaxX: Math.max(startX, endX),
      segmentMinY: Math.min(startY, endY),
      segmentMaxY: Math.max(startY, endY),
      crystals: createFrostCrystals(startX, startY, endX, endY),
      update({ effect, services: entityServices }) {
        if (effect.age > FROST_ACTIVE_DURATION + EPSILON) return;
        entityServices.forEachEnemy((target) => {
          const profile = entityServices.getContactProfile(target);
          if (profile.solid && profile.attackable && circleTouchesSegment(target, effect)) {
            entityServices.applyEffect(target, createFrostEffect(entityServices, source));
          }
        });
      },
      draw({ effect }, context) {
        const melt = effect.age <= FROST_ACTIVE_DURATION
          ? 0
          : clamp(
            (effect.age - FROST_ACTIVE_DURATION) / FROST_FADE_DURATION,
            0,
            1
          );
        const opacity = 1 - melt;
        if (opacity <= 0) return;
        context.save();
        const inheritedAlpha = context.globalAlpha;
        for (const crystal of effect.crystals) {
          const centerX = crystal.reduce((sum, point) => sum + point.x, 0) / crystal.length;
          const centerY = crystal.reduce((sum, point) => sum + point.y, 0) / crystal.length;
          const scale = 1 - melt * 0.55;
          context.globalAlpha = inheritedAlpha * opacity * 0.32;
          context.fillStyle = "#bdefff";
          context.strokeStyle = "#efffff";
          context.lineWidth = 0.45;
          context.beginPath();
          crystal.forEach((point, index) => {
            const x = centerX + (point.x - centerX) * scale;
            const y = centerY + (point.y - centerY) * scale + melt * 2;
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
          context.fill();
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function sonicDamage(contactRadius) {
    if (contactRadius <= 30) return 3;
    if (contactRadius <= 45) return 2;
    return 1;
  }

  function createSonicWave(services, source) {
    return {
      kind: "six-zone-sonic-wave",
      life: SONIC_LIFE,
      x: source.x,
      y: source.y,
      radius: SONIC_MIN_RADIUS,
      minRadius: SONIC_MIN_RADIUS,
      maxRadius: SONIC_MAX_RADIUS,
      hitTargets: new Set(),
      update({ effect, services: entityServices }, dt = 0) {
        const previousRadius = effect.radius;
        const progress = clamp((effect.age + Math.max(0, dt)) / effect.life, 0, 1);
        effect.radius = SONIC_MIN_RADIUS + (SONIC_MAX_RADIUS - SONIC_MIN_RADIUS) * progress;
        entityServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (effect.hitTargets.has(key)) return;
          const distance = Math.hypot(target.x - effect.x, target.y - effect.y);
          const nearEdge = distance - target.radius;
          const farEdge = distance + target.radius;
          if (
            farEdge + EPSILON < previousRadius ||
            nearEdge > effect.radius + EPSILON ||
            farEdge + EPSILON < SONIC_MIN_RADIUS
          ) return;
          const contactRadius = Math.max(SONIC_MIN_RADIUS, nearEdge);
          if (entityServices.dealDamage(target, sonicDamage(contactRadius))) {
            effect.hitTargets.add(key);
          }
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= Math.pow(1 - progress, 1.2) * 0.78;
        context.strokeStyle = "#4f8edb";
        context.lineWidth = 1.8 - progress * 0.8;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createArrow(services, source, target) {
    const direction = normalizeDirection(target.x - source.x, target.y - source.y);
    const speed = source.speed * ARROW_SPEED_MULTIPLIER;
    const startDistance = source.radius + 3;
    return {
      kind: "six-zone-arrow",
      life: 3,
      x: source.x + direction.x * startDistance,
      y: source.y + direction.y * startDistance,
      vx: direction.x * speed,
      vy: direction.y * speed,
      radius: 2,
      damage: ARROW_DAMAGE,
      penetrating: false,
      update({ effect, game, services: entityServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const hit = entityServices.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          effect.radius
        );
        if (hit && entityServices.dealDamage(hit, effect.damage)) {
          effect.life = 0;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, 8)
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        const angle = Math.atan2(effect.vy, effect.vx);
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(angle);
        context.strokeStyle = "#d5d9de";
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(-7, 0);
        context.lineTo(6, 0);
        context.stroke();
        context.fillStyle = "#8b9199";
        context.beginPath();
        context.moveTo(7, 0);
        context.lineTo(2, -2.5);
        context.lineTo(2, 2.5);
        context.closePath();
        context.fill();
        context.restore();
      }
    };
  }

  function createElectricStun(services, source) {
    return {
      id: "six-zone-electric-stun",
      visualType: "stun",
      duration: ELECTRIC_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      damage: ELECTRIC_DAMAGE,
      tickInterval: ELECTRIC_TICK_INTERVAL,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx != null ? ball.storedVx : ball.vx;
          effect.savedVy = ball.storedVy != null ? ball.storedVy : ball.vy;
        }
        effect.nextDamageAt = game.time + effect.tickInterval;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          game.time + EPSILON >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + EPSILON
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
        ball.vx = ball.storedVx = effect.savedVx;
        ball.vy = ball.storedVy = effect.savedVy;
      }
    };
  }

  function touchesPoint(ball, x, y, radius) {
    return Math.hypot(ball.x - x, ball.y - y) <= ball.radius + radius;
  }

  function createGlassShard(services, source, x, y) {
    const rotation = Math.random() * Math.PI * 2;
    const radii = [2, 1.35 + Math.random() * 0.35, 1.65 + Math.random() * 0.3];
    const angles = [rotation, rotation + 2.05, rotation + 4.28];
    const points = angles.map((angle, index) => ({
      x: x + Math.cos(angle) * radii[index],
      y: y + Math.sin(angle) * radii[index]
    }));
    return {
      kind: "six-zone-glass-shard",
      life: EFFECT_LIFE,
      x,
      y,
      radius: GLASS_RADIUS,
      points,
      update({ effect, services: entityServices }) {
        const targets = [];
        entityServices.forEachContactEnemy(target => targets.push(target));
        for (const target of targets) {
          const profile = entityServices.getContactProfile(target);
          const overlapping = touchesPoint(target, effect.x, effect.y, effect.radius);
          entityServices.notifyEntityContact(target, effect, { overlapping });
          if (!profile.attackable || !overlapping) {
            continue;
          }
          if (entityServices.tryConsumeEntity(target, effect, { physical: true })) {
            effect.life = 0;
            return;
          }
          if (entityServices.dealDamage(target, GLASS_DAMAGE)) effect.life = 0;
          return;
        }
      },
      draw({ effect }, context) {
        context.save();
        context.globalAlpha *= 0.42;
        context.fillStyle = "#eafcff";
        context.strokeStyle = "#ffffff";
        context.lineWidth = 0.65;
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.fill();
        context.stroke();
        context.restore();
      }
    };
  }

  function placeGlassAt(entityServices, source, x, y, arenaSize) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * GLASS_PLACEMENT_RADIUS;
    const { x: shardX, y: shardY } = resolveArenaGeometry(arenaSize).clampPoint(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, GLASS_RADIUS);
    return entityServices.spawnCombatEntity(createGlassShard(
      entityServices,
      source,
      shardX,
      shardY
    ));
  }

  function reflectSawFromTarget(target, saw, normalX, normalY) {
    const relativeNormal =
      (saw.vx - target.vx) * normalX +
      (saw.vy - target.vy) * normalY;
    if (relativeNormal <= EPSILON) return false;

    const reflectedX = saw.vx - 2 * relativeNormal * normalX;
    const reflectedY = saw.vy - 2 * relativeNormal * normalY;
    const direction = normalizeDirection(
      reflectedX,
      reflectedY,
      -saw.directionX,
      -saw.directionY
    );
    const speed = Math.hypot(saw.vx, saw.vy);
    saw.directionX = direction.x;
    saw.directionY = direction.y;
    saw.vx = direction.x * speed;
    saw.vy = direction.y * speed;
    return true;
  }

  function resolveSawContact(target, saw, arenaSize, entityServices) {
    let deltaX = target.x - saw.x;
    let deltaY = target.y - saw.y;
    let distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = target.radius + saw.radius;
    if (distance >= minimumDistance) return false;
    if (distance <= EPSILON) {
      deltaX = 1;
      deltaY = 0;
      distance = 1;
    }
    const normalX = deltaX / distance;
    const normalY = deltaY / distance;
    const targetLocked = entityServices.isMovementLocked(target);
    if (!targetLocked) {
      const overlap = minimumDistance - distance;
      Object.assign(saw, resolveArenaGeometry(arenaSize).clampPoint(saw.x - normalX * overlap * 0.5, saw.y - normalY * overlap * 0.5, saw.radius));
      Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(target.x + normalX * overlap * 0.5, target.y + normalY * overlap * 0.5, target.radius));
    } else {
      const overlap = minimumDistance - distance;
      Object.assign(saw, resolveArenaGeometry(arenaSize).clampPoint(saw.x - normalX * overlap, saw.y - normalY * overlap, saw.radius));
    }
    reflectSawFromTarget(target, saw, normalX, normalY);
    if (!targetLocked) {
      const velocityDot = target.vx * normalX + target.vy * normalY;
      if (velocityDot < 0) {
        target.vx -= 2 * velocityDot * normalX;
        target.vy -= 2 * velocityDot * normalY;
      }
      const storedDot = target.storedVx * normalX + target.storedVy * normalY;
      if (storedDot < 0) {
        target.storedVx -= 2 * storedDot * normalX;
        target.storedVy -= 2 * storedDot * normalY;
      }
    }
    return true;
  }

  function resolveSweptSawContact(target, saw) {
    let bestDistanceSquared = Infinity;
    let contactX = saw.x;
    let contactY = saw.y;
    saw.movementSegments.forEach((segment) => {
      const closest = closestPointOnSegment(
        target.x,
        target.y,
        segment.startX,
        segment.startY,
        segment.endX,
        segment.endY
      );
      const deltaX = target.x - closest.x;
      const deltaY = target.y - closest.y;
      const distanceSquared = deltaX * deltaX + deltaY * deltaY;
      if (distanceSquared >= bestDistanceSquared) return;
      bestDistanceSquared = distanceSquared;
      contactX = closest.x;
      contactY = closest.y;
    });
    const normal = normalizeDirection(
      target.x - contactX,
      target.y - contactY,
      saw.directionX,
      saw.directionY
    );
    return reflectSawFromTarget(target, saw, normal.x, normal.y);
  }

  function sawSweptContact(target, saw) {
    const targetPath = {
      startX: Number.isFinite(target.prevX) ? target.prevX : target.x,
      startY: Number.isFinite(target.prevY) ? target.prevY : target.y,
      endX: target.x,
      endY: target.y
    };
    const contactRadius = target.radius + saw.radius;
    return saw.movementSegments.some((segment) => (
      segmentDistanceSquared(segment, targetPath) <=
        contactRadius * contactRadius + EPSILON
    ));
  }

  function updateSawFacing(saw, target) {
    if (!target) return;
    saw.facingAngle = Math.atan2(target.y - saw.y, target.x - saw.x);
  }

  function positionAttachedSaw(saw, source, target) {
    const direction = normalizeDirection(
      target ? target.x - source.x : saw.directionX,
      target ? target.y - source.y : saw.directionY,
      saw.directionX,
      saw.directionY
    );
    saw.x = source.x + direction.x * SAW_ORBIT_RADIUS;
    saw.y = source.y + direction.y * SAW_ORBIT_RADIUS;
    saw.vx = 0;
    saw.vy = 0;
    updateSawFacing(saw, target);
  }

  function launchSaw(saw, source, target) {
    const direction = normalizeDirection(
      target ? target.x - source.x : saw.directionX,
      target ? target.y - source.y : saw.directionY,
      saw.directionX,
      saw.directionY
    );
    const startDistance = source.radius + saw.radius;
    saw.phase = "flight";
    saw.flightElapsed = 0;
    saw.cooldownElapsed = 0;
    saw.speedMultiplier = SAW_INITIAL_SPEED_MULTIPLIER;
    saw.directionX = direction.x;
    saw.directionY = direction.y;
    saw.x = source.x + direction.x * startDistance;
    saw.y = source.y + direction.y * startDistance;
    saw.vx = direction.x * source.speed * saw.speedMultiplier;
    saw.vy = direction.y * source.speed * saw.speedMultiplier;
    saw.contacts.clear();
    saw.movementSegments = [];
    saw.launchCount += 1;
    updateSawFacing(saw, target);
  }

  function attachSaw(saw, source, target) {
    saw.phase = "cooldown";
    saw.cooldownElapsed = 0;
    saw.speedMultiplier = 0;
    saw.contacts.clear();
    saw.movementSegments = [];
    positionAttachedSaw(saw, source, target);
  }

  function moveSawDistance(saw, distance, source, arenaSize, canRecall, entityServices) {
    let remaining = Math.max(0, distance);
    let iterations = 0;
    while (remaining > EPSILON && iterations < 128) {
      iterations += 1;
      const arena = resolveArenaGeometry(arenaSize);
      Object.assign(saw, arena.clampPoint(saw.x, saw.y, saw.radius));
      const hit = arena.traceSegment(saw.x, saw.y, saw.x + saw.directionX * remaining, saw.y + saw.directionY * remaining, saw.radius);
      const travel = hit ? remaining * hit.t : remaining;
      const startX = saw.x;
      const startY = saw.y;
      const endX = startX + saw.directionX * travel;
      const endY = startY + saw.directionY * travel;

      if (canRecall) {
        const contact = firstSegmentCircleContact(
          startX,
          startY,
          endX,
          endY,
          source.x,
          source.y,
          source.radius + saw.radius
        );
        if (contact !== null) {
          saw.x = startX + (endX - startX) * contact;
          saw.y = startY + (endY - startY) * contact;
          saw.movementSegments.push({ startX, startY, endX: saw.x, endY: saw.y });
          return true;
        }
      }

      saw.x = endX;
      saw.y = endY;
      if (travel > EPSILON) saw.movementSegments.push({ startX, startY, endX, endY });
      remaining = Math.max(0, remaining - travel);
      if (!hit) break;
      const dot = saw.directionX * hit.normalX + saw.directionY * hit.normalY;
      saw.directionX -= 2 * dot * hit.normalX;
      saw.directionY -= 2 * dot * hit.normalY;
      placeGlassAt(entityServices, saw, saw.x, saw.y, arenaSize);
    }
    return false;
  }

  function leaveSawFrostTrails(saw, entityServices) {
    saw.movementSegments.forEach((segment) => {
      if (Math.hypot(segment.endX - segment.startX, segment.endY - segment.startY) < (
        MIN_TRAIL_LENGTH
      )) return;
      entityServices.spawnCombatEntity(createFrostTrail(
        entityServices,
        saw,
        segment.startX,
        segment.startY,
        segment.endX,
        segment.endY
      ));
    });
  }

  function advanceSawFlight(saw, elapsed, source, target, arenaSize, entityServices) {
    let remaining = Math.max(0, elapsed);
    saw.movementSegments = [];
    if (saw.flightElapsed < SAW_DECELERATION_DURATION - EPSILON) {
      const decelerationStep = Math.min(
        remaining,
        SAW_DECELERATION_DURATION - saw.flightElapsed
      );
      const startMultiplier = SAW_INITIAL_SPEED_MULTIPLIER -
        (SAW_INITIAL_SPEED_MULTIPLIER - SAW_FINAL_SPEED_MULTIPLIER) *
          saw.flightElapsed / SAW_DECELERATION_DURATION;
      const endElapsed = saw.flightElapsed + decelerationStep;
      const endMultiplier = SAW_INITIAL_SPEED_MULTIPLIER -
        (SAW_INITIAL_SPEED_MULTIPLIER - SAW_FINAL_SPEED_MULTIPLIER) *
          endElapsed / SAW_DECELERATION_DURATION;
      const distance = source.speed * (startMultiplier + endMultiplier) / 2 * decelerationStep;
      moveSawDistance(saw, distance, source, arenaSize, false, entityServices);
      saw.flightElapsed = endElapsed;
      saw.speedMultiplier = endMultiplier;
      remaining = Math.max(0, remaining - decelerationStep);
    }

    if (
      saw.flightElapsed + EPSILON >= SAW_DECELERATION_DURATION &&
      Math.hypot(saw.x - source.x, saw.y - source.y) <= source.radius + saw.radius + EPSILON
    ) {
      leaveSawFrostTrails(saw, entityServices);
      attachSaw(saw, source, target);
      return;
    }

    if (remaining > EPSILON && saw.phase === "flight") {
      saw.flightElapsed += remaining;
      saw.speedMultiplier = SAW_FINAL_SPEED_MULTIPLIER;
      const recalled = moveSawDistance(
        saw,
        source.speed * SAW_FINAL_SPEED_MULTIPLIER * remaining,
        source,
        arenaSize,
        true,
        entityServices
      );
      if (recalled) {
        leaveSawFrostTrails(saw, entityServices);
        attachSaw(saw, source, target);
        return;
      }
    }

    saw.vx = saw.directionX * source.speed * saw.speedMultiplier;
    saw.vy = saw.directionY * source.speed * saw.speedMultiplier;
    updateSawFacing(saw, target);
    leaveSawFrostTrails(saw, entityServices);
  }

  function updateSawContacts(saw, entityServices, arenaSize) {
    const current = new Set();
    entityServices.forEachEnemy((target) => {
      const profile = entityServices.getContactProfile(target);
      if (!profile.solid) return;
      const touching = Math.hypot(target.x - saw.x, target.y - saw.y) <
        target.radius + saw.radius;
      const crossed = sawSweptContact(target, saw);
      if (!touching && !crossed) return;
      const key = target.instanceId || target.id;
      if (touching) {
        current.add(key);
        resolveSawContact(target, saw, arenaSize, entityServices);
      } else if (crossed) {
        resolveSweptSawContact(target, saw);
      }
      if (saw.contacts.has(key)) return;
      if (profile.attackable) {
        entityServices.dealDamage(target, SAW_DAMAGE, { collisionDamage: true });
      }
      placeGlassAt(entityServices, saw, saw.x, saw.y, arenaSize);
    });
    saw.contacts = current;
  }

  function createIceGlassSaw(services, source) {
    const target = services.getOpponent();
    const saw = {
      kind: "six-zone-ice-glass-saw",
      combatKind: "summon",
      lifecycle: "owner-bound",
      life: EFFECT_LIFE,
      solid: true,
      radius: SAW_RADIUS,
      x: source.x,
      y: source.y,
      vx: 0,
      vy: 0,
      directionX: 1,
      directionY: 0,
      facingAngle: 0,
      phase: "flight",
      flightElapsed: 0,
      cooldownElapsed: 0,
      speedMultiplier: SAW_INITIAL_SPEED_MULTIPLIER,
      launchCount: 0,
      contacts: new Set(),
      movementSegments: [],
      update({ effect, game, services: entityServices }, dt) {
        const owner = effect.owner;
        const currentTarget = entityServices.getOpponent();
        const arenaSize = game;
        let remaining = Math.max(0, dt);
        if (effect.phase === "cooldown") {
          positionAttachedSaw(effect, owner, currentTarget);
          // Flight sweep segments no longer apply while retracted; only the
          // attached circle is a collision body now.
          effect.movementSegments = [];
          // The retracted saw keeps its collision body: it still pushes
          // overlapping enemies apart and deals collision damage on contact.
          updateSawContacts(effect, entityServices, arenaSize);
          const cooldownStep = Math.min(remaining, SAW_COOLDOWN - effect.cooldownElapsed);
          effect.cooldownElapsed += cooldownStep;
          remaining = Math.max(0, remaining - cooldownStep);
          if (effect.cooldownElapsed + EPSILON < SAW_COOLDOWN) return;
          launchSaw(effect, owner, currentTarget);
        }
        advanceSawFlight(effect, remaining, owner, currentTarget, arenaSize, entityServices);
        if (effect.phase === "flight") updateSawContacts(effect, entityServices, arenaSize);
      },
      draw({ effect }, context) {
        drawSaw(context, effect);
      }
    };
    launchSaw(saw, source, target);
    return saw;
  }

  function drawSaw(context, saw) {
    context.save();
    context.translate(saw.x, saw.y);
    context.rotate(saw.facingAngle);
    context.globalCompositeOperation = "lighter";
    context.shadowColor = "#9eeaff";
    context.shadowBlur = 5;
    for (let index = 0; index < 12; index += 1) {
      const angle = index * Math.PI / 6;
      const next = angle + Math.PI / 12;
      const end = angle + Math.PI / 6;
      context.fillStyle = index % 2 === 0
        ? "rgba(210, 249, 255, 0.88)"
        : "rgba(126, 211, 240, 0.76)";
      context.beginPath();
      context.moveTo(Math.cos(angle) * 9.5, Math.sin(angle) * 9.5);
      context.lineTo(Math.cos(next) * saw.radius, Math.sin(next) * saw.radius);
      context.lineTo(Math.cos(end) * 9.5, Math.sin(end) * 9.5);
      context.closePath();
      context.fill();
      if (typeof context.stroke === "function") {
        context.strokeStyle = "rgba(244, 255, 255, 0.82)";
        context.lineWidth = 0.45;
        context.stroke();
      }
    }
    context.shadowBlur = 2;
    context.fillStyle = "rgba(112, 202, 234, 0.52)";
    context.strokeStyle = "rgba(235, 255, 255, 0.9)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.arc(0, 0, 9.5, 0, Math.PI * 2);
    context.fill();
    if (typeof context.stroke === "function") context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = "rgba(240, 255, 255, 0.72)";
    context.lineWidth = 0.65;
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3 + 0.18;
      context.beginPath();
      context.moveTo(Math.cos(angle) * 2.7, Math.sin(angle) * 2.7);
      context.lineTo(Math.cos(angle) * 8.2, Math.sin(angle) * 8.2);
      if (typeof context.stroke === "function") context.stroke();
    }
    context.fillStyle = "rgba(225, 251, 255, 0.9)";
    context.beginPath();
    context.moveTo(4, 0);
    context.lineTo(-2.4, -2.8);
    context.lineTo(-2.4, 2.8);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawElectricCharge(context, ball, progress, gameTime) {
    if (typeof context.fillRect !== "function") return;
    const alpha = 0.08 + clamp(progress, 0, 1) * 0.92;
    const tick = Math.floor(gameTime / 0.3);
    const outer = ball.radius + 5;
    const inner = ball.radius + 1;
    const outerSquared = outer * outer;
    const innerSquared = inner * inner;

    context.save();
    context.globalAlpha *= alpha;
    context.fillStyle = "#ffd84a";
    for (let y = -outer; y <= outer; y += 1) {
      for (let x = -outer; x <= outer; x += 1) {
        const distanceSquared = x * x + y * y;
        if (
          distanceSquared >= innerSquared &&
          distanceSquared <= outerSquared &&
          hashPixel(x, y, tick) < 0.5
        ) {
          context.fillRect(
            Math.round(ball.x + x),
            Math.round(ball.y + y),
            1,
            1
          );
        }
      }
    }
    context.restore();
  }

  function drawArrowCharge(context, ball, target, progress) {
    if (!target || progress <= 0) return;
    const direction = normalizeDirection(target.x - ball.x, target.y - ball.y);
    const normalX = -direction.y;
    const normalY = direction.x;
    const centerX = ball.x + direction.x * (ball.radius + 7);
    const centerY = ball.y + direction.y * (ball.radius + 7);
    context.save();
    context.globalAlpha *= 0.35 + progress * 0.65;
    context.strokeStyle = "#aeb4ba";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX + normalX * 6, centerY + normalY * 6);
    context.lineTo(centerX + direction.x * 4, centerY + direction.y * 4);
    context.lineTo(centerX - normalX * 6, centerY - normalY * 6);
    context.stroke();
    context.fillStyle = "#d8dde2";
    context.fillRect(
      Math.round(centerX - direction.x * (5 - progress * 4)),
      Math.round(centerY - direction.y * (5 - progress * 4)),
      2,
      2
    );
    context.restore();
  }

  const sixZoneDefinition = {
    id: "sixZone",
    name: "\u516d\u533a\u7403",
    englishName: "Six Zone",
    color: SECTOR_COLORS[0],
    sectorColors: SECTOR_COLORS,
    description: "\u51b0\u7483\u952f\u5206\u4f53\u5faa\u73af / \u78b0\u8fb9\u97f3\u6ce2 / \u5f13\u7bad\u4e0e\u7535\u51fb",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let sawEntity = null;
      let arrowTimer = 0;
      let electricCharge = 0;

      function afterStep(context, canAttack) {
        if (canAttack) {
          while (arrowTimer + EPSILON >= ARROW_INTERVAL) {
            arrowTimer -= ARROW_INTERVAL;
            const target = services.getOpponent();
            if (target) services.spawnProjectile(createArrow(services, context.ball, target));
          }
        }
      }

      return {
        onSpawn(context) {
          sawEntity = services.spawnCombatEntity(createIceGlassSaw(
            services,
            context.ball
          ));
        },
        update(_context, dt) {
          const elapsed = Math.max(0, dt);
          arrowTimer += elapsed;
          electricCharge = Math.min(ELECTRIC_CHARGE_TIME, electricCharge + elapsed);
        },
        afterUpdateStep(context) {
          afterStep(context, true);
        },
        afterUpdateStepWhilePaused(context) {
          afterStep(context, false);
        },
        onCollision(context, target) {
          if (context.blockedAtContact || electricCharge + EPSILON < ELECTRIC_CHARGE_TIME) {
            return;
          }
          services.applyEffect(
            target,
            createElectricStun(services, context.ball),
            context.ball
          );
          services.spawnHitText(target, "X");
          electricCharge = 0;
        },
        onWallBounce(context) {
          services.spawnCombatEntity(createSonicWave(services, context.ball));
        },
        drawBody(context, canvasContext) {
          drawSixSectorBody(canvasContext, context.ball);
          return true;
        },
        drawBefore(context, canvasContext) {
          drawElectricCharge(
            canvasContext,
            context.ball,
            electricCharge / ELECTRIC_CHARGE_TIME,
            context.game.time
          );
        },
        drawAfter(context, canvasContext) {
          const chargeStart = ARROW_INTERVAL - ARROW_CHARGE_DURATION;
          const progress = clamp(
            (arrowTimer - chargeStart) / ARROW_CHARGE_DURATION,
            0,
            1
          );
          drawArrowCharge(
            canvasContext,
            context.ball,
            services.getOpponent(),
            progress
          );
        },
        getSawState() {
          return sawEntity;
        }
      };
    }
  };

  registerBall(sixZoneDefinition);
  return { sixZoneDefinition };
});
