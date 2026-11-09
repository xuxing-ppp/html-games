(function initializeFiberOptic(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFiberOpticPlugin({ registerBall, resolveArenaGeometry }) {
  const BODY_COLOR = "#d6ecf8";
  const SHARD_COLOR = "#e9fbff";
  const SHARD_RADIUS = 2;
  const SHARD_LENGTH = 5;
  const RELEASE_RADIUS = 30;
  const MAX_SHARDS_PER_BURST = 1;
  const MAX_THREADS_PER_SHARD = 1;
  const SHARD_DAMAGE = 1;
  const THREAD_WIDTH = 0.9;
  const THREAD_HALF_WIDTH = THREAD_WIDTH / 2;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const SHATTER_LIFE = 0.4;
  const SHATTER_PARTICLE_COUNT = 10;
  const EPSILON = 1e-9;
  const EPSILON_SQUARED = EPSILON * EPSILON;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function pointToSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON_SQUARED) {
      const deltaX = pointX - startX;
      const deltaY = pointY - startY;
      return deltaX * deltaX + deltaY * deltaY;
    }

    const progress = Math.max(0, Math.min(1, (
      (pointX - startX) * segmentX + (pointY - startY) * segmentY
    ) / lengthSquared));
    const deltaX = pointX - (startX + segmentX * progress);
    const deltaY = pointY - (startY + segmentY * progress);
    return deltaX * deltaX + deltaY * deltaY;
  }

  function pointLiesOnSegment(pointX, pointY, startX, startY, endX, endY) {
    return (
      pointX >= Math.min(startX, endX) - EPSILON &&
      pointX <= Math.max(startX, endX) + EPSILON &&
      pointY >= Math.min(startY, endY) - EPSILON &&
      pointY <= Math.max(startY, endY) + EPSILON
    );
  }

  function segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY) {
    const abX = bX - aX;
    const abY = bY - aY;
    const cdX = dX - cX;
    const cdY = dY - cY;
    const cSide = crossProduct(abX, abY, cX - aX, cY - aY);
    const dSide = crossProduct(abX, abY, dX - aX, dY - aY);
    const aSide = crossProduct(cdX, cdY, aX - cX, aY - cY);
    const bSide = crossProduct(cdX, cdY, bX - cX, bY - cY);

    if (
      ((cSide > EPSILON && dSide < -EPSILON) ||
        (cSide < -EPSILON && dSide > EPSILON)) &&
      ((aSide > EPSILON && bSide < -EPSILON) ||
        (aSide < -EPSILON && bSide > EPSILON))
    ) return true;

    return (
      (Math.abs(cSide) <= EPSILON && pointLiesOnSegment(cX, cY, aX, aY, bX, bY)) ||
      (Math.abs(dSide) <= EPSILON && pointLiesOnSegment(dX, dY, aX, aY, bX, bY)) ||
      (Math.abs(aSide) <= EPSILON && pointLiesOnSegment(aX, aY, cX, cY, dX, dY)) ||
      (Math.abs(bSide) <= EPSILON && pointLiesOnSegment(bX, bY, cX, cY, dX, dY))
    );
  }

  function segmentDistanceSquared(aX, aY, bX, bY, cX, cY, dX, dY) {
    if (segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY)) return 0;
    return Math.min(
      pointToSegmentDistanceSquared(aX, aY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(bX, bY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(cX, cY, aX, aY, bX, bY),
      pointToSegmentDistanceSquared(dX, dY, aX, aY, bX, bY)
    );
  }

  function touchesPoint(target, x, y, radius) {
    return Math.hypot(target.x - x, target.y - y) <= target.radius + radius;
  }

  function shardIsAlive(shard) {
    return shard.life > 0 && shard.entityActive !== false;
  }

  // Small glass-shatter sparks adapted from Starfield's edge splash,
  // recolored to the Fiber Optic white-blue palette.
  function createShatterSplash(x, y, baseAngle) {
    const particles = Array.from({ length: SHATTER_PARTICLE_COUNT }, (_, index) => ({
      // Spread across a wide fan around the body's travel direction.
      angle: baseAngle + (Math.random() * 2 - 1) * 1.2,
      distance: 6 + Math.random() * 14,
      size: 1.5 + Math.random() * 2,
      delay: index * 0.015
    }));
    return {
      kind: "fiber-optic-shatter",
      life: SHATTER_LIFE,
      x,
      y,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        for (const particle of effect.particles) {
          if (effect.age < particle.delay) continue;
          const particleProgress = clamp(
            (effect.age - particle.delay) / (effect.life - particle.delay),
            0,
            1
          );
          const fade = 1 - particleProgress;
          const distance = particle.distance * (0.3 + particleProgress * 0.7);
          const size = particle.size * (1 - particleProgress * 0.5);
          context.globalAlpha = 0.9 * fade * fade;
          context.fillStyle = particleProgress < 0.5 ? "#e9fbff" : "#9fd4ee";
          context.fillRect(
            Math.round(effect.x + Math.cos(particle.angle) * distance - size / 2),
            Math.round(effect.y + Math.sin(particle.angle) * distance - size / 2),
            size,
            size
          );
        }
        context.restore();
      }
    };
  }

  function drawShard(context, x, y, rotation) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.68;
    context.fillStyle = SHARD_COLOR;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 0.55;
    context.beginPath();
    context.moveTo(SHARD_LENGTH / 2, 0);
    context.lineTo(-SHARD_LENGTH / 2, -1.45);
    context.lineTo(-SHARD_LENGTH * 0.2, 1.25);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  // A thread is bound to its two endpoint shards forever: when either side is
  // destroyed the thread is cleared and never regenerated or rebound.
  function clearThread(thread) {
    if (thread.cleared) return;
    thread.cleared = true;
    thread.life = 0;
    thread.entityActive = false;
    for (const endpoint of [thread.shardA, thread.shardB]) {
      const index = endpoint.threads.indexOf(thread);
      if (index >= 0) endpoint.threads.splice(index, 1);
    }
  }

  function destroyShard(shard) {
    if (!shardIsAlive(shard)) return;
    shard.life = 0;
    shard.entityActive = false;
    for (const thread of shard.threads.slice()) clearThread(thread);
  }

  function sweptTouchesThread(target, entity, touchRadius) {
    const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const previousY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    return segmentDistanceSquared(
      previousX,
      previousY,
      target.x,
      target.y,
      entity.startX,
      entity.startY,
      entity.endX,
      entity.endY
    ) <= touchRadius * touchRadius + EPSILON;
  }

  function createThread(shardA, shardB) {
    return {
      kind: "fiber-optic-thread",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      drawLayer: "background",
      color: BODY_COLOR,
      shardA,
      shardB,
      startX: shardA.x,
      startY: shardA.y,
      endX: shardB.x,
      endY: shardB.y,
      touchingTargets: new Set(),
      update({ entity, services: threadServices }) {
        threadServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          const wasTouching = entity.touchingTargets.has(key);
          const moveX = target.x - target.prevX;
          const moveY = target.y - target.prevY;
          const targetMoved = moveX * moveX + moveY * moveY > EPSILON_SQUARED;
          const touchRadius = target.radius + THREAD_HALF_WIDTH;
          const isTouching = pointToSegmentDistanceSquared(
            target.x,
            target.y,
            entity.startX,
            entity.startY,
            entity.endX,
            entity.endY
          ) <= touchRadius * touchRadius;
          if (
            !wasTouching &&
            targetMoved &&
            (isTouching || sweptTouchesThread(target, entity, touchRadius))
          ) {
            threadServices.dealDamage(target, SHARD_DAMAGE);
          }
          if (isTouching) entity.touchingTargets.add(key);
          else if (wasTouching) entity.touchingTargets.delete(key);
        });
      },
      draw({ entity }, canvasContext) {
        canvasContext.save();
        canvasContext.globalAlpha *= 0.7;
        canvasContext.strokeStyle = entity.color;
        canvasContext.lineWidth = THREAD_WIDTH;
        canvasContext.beginPath();
        canvasContext.moveTo(entity.startX, entity.startY);
        canvasContext.lineTo(entity.endX, entity.endY);
        canvasContext.stroke();
        canvasContext.restore();
      }
    };
  }

  function createShard(x, y) {
    const rotation = Math.random() * Math.PI * 2;
    return {
      kind: "fiber-optic-shard",
      life: PERMANENT_LIFE,
      x,
      y,
      radius: SHARD_RADIUS,
      rotation,
      threads: [],
      update({ effect, services: entityServices }) {
        const contactTargets = [];
        entityServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
          const profile = entityServices.getContactProfile(target);
          const overlapping = touchesPoint(target, effect.x, effect.y, effect.radius);
          entityServices.notifyEntityContact(target, effect, { overlapping });
          if (!profile.attackable || !overlapping) {
            continue;
          }
          if (entityServices.tryConsumeEntity(target, effect, { physical: true })) {
            destroyShard(effect);
            return;
          }
          if (entityServices.dealDamage(target, SHARD_DAMAGE)) destroyShard(effect);
          return;
        }
      },
      draw({ effect }, context) {
        drawShard(context, effect.x, effect.y, effect.rotation);
      }
    };
  }

  const fiberOpticDefinition = {
    id: "fiberOptic",
    name: "玻纤",
    englishName: "Fiberglass",
    color: BODY_COLOR,
    description: "碰撞散落玻璃渣 / 光线与碎屑触敌 -1",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const shards = [];

      // Bindings are computed once at spawn time from the body position and
      // stay frozen: cleared threads are never re-measured or recreated.
      function bindFarthestThreads(shard, bodyX, bodyY) {
        const candidates = shards.filter((other) => (
          other !== shard && shardIsAlive(other)
        ));
        const farthest = candidates
          .map((other) => ({
            other,
            distanceSquared: (other.x - bodyX) * (other.x - bodyX) +
              (other.y - bodyY) * (other.y - bodyY)
          }))
          .sort((first, second) => second.distanceSquared - first.distanceSquared)
          .slice(0, MAX_THREADS_PER_SHARD);
        for (const { other } of farthest) {
          const thread = services.spawnCombatEntity(createThread(shard, other));
          shard.threads.push(thread);
          other.threads.push(thread);
        }
      }

      function releaseShards(context) {
        const ball = context.ball;
        const arena = resolveArenaGeometry(context.game);
        const count = 1 + Math.floor(Math.random() * MAX_SHARDS_PER_BURST);
        for (let index = 0; index < count; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * RELEASE_RADIUS;
          const { x: shardX, y: shardY } = arena.clampPoint(ball.x + Math.cos(angle) * distance,
            ball.y + Math.sin(angle) * distance, SHARD_RADIUS);
          const shard = services.spawnCombatEntity(createShard(shardX, shardY));
          shards.push(shard);
          bindFarthestThreads(shard, ball.x, ball.y);
        }
        services.spawnVisualEffect(createShatterSplash(
          ball.x,
          ball.y,
          Math.atan2(ball.storedVy || 0, ball.storedVx || 0)
        ));
      }

      return {
        onEntityCollision(context) {
          releaseShards(context);
        },
        onCollision(context) {
          releaseShards(context);
        },
        onWallBounce(context) {
          releaseShards(context);
        }
      };
    }
  };

  registerBall(fiberOpticDefinition);
  return {
    fiberOpticDefinition,
    FIBER_OPTIC_RELEASE_RADIUS: RELEASE_RADIUS,
    FIBER_OPTIC_SHARD_DAMAGE: SHARD_DAMAGE,
    FIBER_OPTIC_THREAD_HALF_WIDTH: THREAD_HALF_WIDTH
  };
});
