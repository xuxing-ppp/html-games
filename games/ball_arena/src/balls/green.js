(function initializeGreen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGreenPlugin({ registerBall, getArenaWallContacts }) {
  const CONE_SIDE = 15;
  const CONE_HEIGHT = 20;
  const POISON_TICK_INTERVAL = 0.3;
  const POISON_TICK_COUNT = 5;
  const POISON_DURATION = POISON_TICK_INTERVAL * POISON_TICK_COUNT;
  const RECOVERY_DURATION = 0.5;
  const POISON_DAMAGE = 1;
  const CONE_COLLISION_DAMAGE = 3;
  const POISON_SPEED_FACTOR = 0.5;
  const EPSILON = 1e-9;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createPoisonEffect(options = {}) {
    const damageTicks = Number.isFinite(options.damageTicks)
      ? Math.max(0, Math.floor(options.damageTicks))
      : POISON_TICK_COUNT;
    const poisonDuration = Number.isFinite(options.poisonDuration)
      ? Math.max(0, options.poisonDuration)
      : POISON_TICK_INTERVAL * damageTicks;
    return {
      id: "green-poison",
      duration: poisonDuration + RECOVERY_DURATION,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: POISON_SPEED_FACTOR,
      onApply({ effect, game, isRefresh }) {
        if (!isRefresh) effect.startedAt = game.time;
        effect.startedAt = game.time;
        effect.nextDamageAt = game.time + POISON_TICK_INTERVAL;
      },
      update({ ball, effect, game, services: effectServices }) {
        const poisonEndsAt = effect.startedAt + poisonDuration;
        while (
          effect.nextDamageAt <= poisonEndsAt + EPSILON &&
          game.time + EPSILON >= effect.nextDamageAt
        ) {
          effectServices.dealDamage(ball, POISON_DAMAGE);
          effect.nextDamageAt += POISON_TICK_INTERVAL;
        }

        const elapsed = game.time - effect.startedAt;
        effect.speedFactor = elapsed <= poisonDuration
          ? POISON_SPEED_FACTOR
          : POISON_SPEED_FACTOR + (1 - POISON_SPEED_FACTOR) * clamp(
            (elapsed - poisonDuration) / RECOVERY_DURATION,
            0,
            1
          );
      },
      draw({ ball, effect, game }, context) {
        const frame = Math.floor((game.time - effect.startedAt) * 12);
        context.save();
        context.fillStyle = "#33e889";
        context.globalAlpha *= 0.75;
        for (let index = 0; index < 5; index += 1) {
          const angle = index * Math.PI * 2 / 5 + frame * 0.16;
          const distance = ball.radius + 3 + ((frame + index) % 4);
          context.fillRect(
            Math.round(ball.x + Math.cos(angle) * distance),
            Math.round(ball.y + Math.sin(angle) * distance),
            2,
            2
          );
        }
        context.restore();
      }
    };
  }

  function closestPointOnSegment(x, y, start, end) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared, 0, 1);
    return {
      x: start.x + deltaX * progress,
      y: start.y + deltaY * progress
    };
  }

  function signedArea(point, first, second) {
    return (
      (point.x - second.x) * (first.y - second.y) -
      (first.x - second.x) * (point.y - second.y)
    );
  }

  function pointInsideTriangle(x, y, cone) {
    const point = { x, y };
    const first = signedArea(point, cone.vertices[0], cone.vertices[1]);
    const second = signedArea(point, cone.vertices[1], cone.vertices[2]);
    const third = signedArea(point, cone.vertices[2], cone.vertices[0]);
    const hasNegative = first < 0 || second < 0 || third < 0;
    const hasPositive = first > 0 || second > 0 || third > 0;
    return !(hasNegative && hasPositive);
  }

  function circleTouchesCone(ball, cone) {
    if (pointInsideTriangle(ball.x, ball.y, cone)) return true;
    for (let index = 0; index < 3; index += 1) {
      const start = cone.vertices[index];
      const end = cone.vertices[(index + 1) % 3];
      const closest = closestPointOnSegment(ball.x, ball.y, start, end);
      if (Math.hypot(ball.x - closest.x, ball.y - closest.y) <= ball.radius) {
        return true;
      }
    }
    return false;
  }

  function resolveConeCollision(ball, cone) {
    const inside = pointInsideTriangle(ball.x, ball.y, cone);
    let closest = null;
    let closestEdge = 0;
    let closestDistance = Infinity;
    for (let index = 0; index < 3; index += 1) {
      const point = closestPointOnSegment(
        ball.x,
        ball.y,
        cone.vertices[index],
        cone.vertices[(index + 1) % 3]
      );
      const distance = Math.hypot(ball.x - point.x, ball.y - point.y);
      if (distance < closestDistance) {
        closest = point;
        closestEdge = index;
        closestDistance = distance;
      }
    }
    if (!inside && closestDistance > ball.radius) return false;

    let normalX;
    let normalY;
    if (closestDistance > EPSILON) {
      const sign = inside ? -1 : 1;
      normalX = (ball.x - closest.x) / closestDistance * sign;
      normalY = (ball.y - closest.y) / closestDistance * sign;
    } else {
      const start = cone.vertices[closestEdge];
      const end = cone.vertices[(closestEdge + 1) % 3];
      const edgeX = end.x - start.x;
      const edgeY = end.y - start.y;
      const edgeLength = Math.hypot(edgeX, edgeY) || 1;
      normalX = edgeY / edgeLength;
      normalY = -edgeX / edgeLength;
      const centroidX = cone.vertices.reduce((sum, point) => sum + point.x, 0) / 3;
      const centroidY = cone.vertices.reduce((sum, point) => sum + point.y, 0) / 3;
      if (
        (centroidX - closest.x) * normalX +
        (centroidY - closest.y) * normalY > 0
      ) {
        normalX *= -1;
        normalY *= -1;
      }
    }

    const penetration = inside
      ? ball.radius + closestDistance
      : ball.radius - closestDistance;
    ball.x += normalX * penetration;
    ball.y += normalY * penetration;

    const velocityDot = ball.vx * normalX + ball.vy * normalY;
    if (velocityDot < 0) {
      ball.vx -= 2 * velocityDot * normalX;
      ball.vy -= 2 * velocityDot * normalY;
    }
    const storedDot = ball.storedVx * normalX + ball.storedVy * normalY;
    if (storedDot < 0) {
      ball.storedVx -= 2 * storedDot * normalX;
      ball.storedVy -= 2 * storedDot * normalY;
    }
    return true;
  }

  function createCone(context) {
    const { ball, game } = context;
    let normalX = 0;
    let normalY = 0;
    let anchorX = ball.x;
    let anchorY = ball.y;
    for (const contact of getArenaWallContacts(context)) {
      normalX += contact.normalX;
      normalY += contact.normalY;
      if (contact.normalX) anchorX = contact.x;
      if (contact.normalY) anchorY = contact.y;
    }
    const normalMagnitude = Math.hypot(normalX, normalY) || 1;
    normalX /= normalMagnitude;
    normalY /= normalMagnitude;
    const tangentX = -normalY;
    const tangentY = normalX;
    return {
      kind: "green-poison-cone",
      touching: new Set(),
      vertices: [
        {
          x: anchorX + tangentX * CONE_SIDE / 2,
          y: anchorY + tangentY * CONE_SIDE / 2
        },
        {
          x: anchorX - tangentX * CONE_SIDE / 2,
          y: anchorY - tangentY * CONE_SIDE / 2
        },
        {
          x: anchorX + normalX * CONE_HEIGHT,
          y: anchorY + normalY * CONE_HEIGHT
        }
      ]
    };
  }

  function drawCones(context, cones) {
    context.save();
    context.shadowColor = "#00e888";
    context.shadowBlur = 6;
    cones.forEach((cone) => {
      if (cone.entityActive === false) return;
      context.fillStyle = "rgba(0, 184, 107, 0.72)";
      context.strokeStyle = "#72ffc0";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(cone.vertices[0].x, cone.vertices[0].y);
      context.lineTo(cone.vertices[1].x, cone.vertices[1].y);
      context.lineTo(cone.vertices[2].x, cone.vertices[2].y);
      context.closePath();
      context.fill();
      context.stroke();
    });
    context.restore();
  }

      function updateCone(cone, coneServices) {
        // An untargetable enemy is deliberately omitted by getEnemies(). Keep
        // its previous contact latched so revealing inside the same cone does
        // not turn one uninterrupted overlap into a second poison entry.
        const touchingNow = new Set(Array.from(cone.touching).filter((instanceId) => {
          const target = coneServices.getBall(instanceId);
          return Boolean(
            target && target.hp > 0 && coneServices.isEnemy(target) &&
            coneServices.getContactProfile(target).attackable === false
          );
        }));
        const contactTargets = [];
        coneServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
          const overlapping = circleTouchesCone(target, cone);
          coneServices.notifyEntityContact(target, cone, { overlapping });
          if (!overlapping) continue;
          touchingNow.add(target.instanceId);
          const targetContact = coneServices.getContactProfile(target);
          if (!targetContact.solid || !targetContact.attackable) continue;
          if (!cone.touching.has(target.instanceId)) {
            if (coneServices.tryConsumeEntity(target, cone, { physical: true })) {
              cone.entityActive = false;
              return true;
            }
            coneServices.dealDamage(target, CONE_COLLISION_DAMAGE);
            coneServices.applyEffect(target, createPoisonEffect());
          }
          resolveConeCollision(target, cone);
        }
        cone.touching = touchingNow;
        return false;
      }

      function createGreenConeEntity(context) {
        return {
          ...createCone(context),
          combatKind: "trap",
          trap: true,
          life: PERMANENT_LIFE,
          drawLayer: "background",
          update({ entity, services: coneServices }) {
            updateCone(entity, coneServices);
          },
          draw({ entity }, canvasContext) {
            drawCones(canvasContext, [entity]);
          }
        };
      }

  const greenDefinition = {
    id: "green",
    name: "毒刺",
    englishName: "Green",
    color: "#00b86b",
    description: "撞边布置 / 中毒减速",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      return {
        onWallBounce(context) {
          services.spawnCombatEntity(createGreenConeEntity(context));
        }
      };
    }
  };

  registerBall(greenDefinition);
  return {
    greenDefinition,
    createGreenPoisonEffect: createPoisonEffect,
    createGreenCone: createCone,
    createGreenConeEntity,
    greenConeTouchesBall: circleTouchesCone,
    resolveGreenConeCollision: resolveConeCollision,
    drawGreenCones: drawCones
  };
});
