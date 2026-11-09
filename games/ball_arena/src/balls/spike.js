(function initializeSpike(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpikePlugin({ resolveArenaGeometry, registerBall }) {
  const CONE_SIDE = 15;
  const CONE_HEIGHT = 20;
  const CONE_COLLISION_DAMAGE = 3;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function closestPointOnSegment(x, y, start, end) {
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((x - start.x) * deltaX + (y - start.y) * deltaY) / lengthSquared,
        0,
        1
      );
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
    if (
      !Number.isFinite(ball.x) || !Number.isFinite(ball.y) ||
      !cone || !Array.isArray(cone.vertices) || cone.vertices.length < 3
    ) {
      return false;
    }
    for (const vertex of cone.vertices) {
      if (!Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return false;
    }
    if (pointInsideTriangle(ball.x, ball.y, cone)) return true;
    for (let index = 0; index < 3; index += 1) {
      const start = cone.vertices[index];
      const end = cone.vertices[(index + 1) % 3];
      const closest = closestPointOnSegment(ball.x, ball.y, start, end);
      const radius = Number.isFinite(ball.radius) ? ball.radius : 15;
      if (Math.hypot(ball.x - closest.x, ball.y - closest.y) <= radius + EPSILON) {
        return true;
      }
    }
    return false;
  }

  function resolveConeCollision(ball, cone) {
    if (
      !Number.isFinite(ball.x) || !Number.isFinite(ball.y) ||
      !cone || !Array.isArray(cone.vertices)
    ) {
      return false;
    }
    const inside = pointInsideTriangle(ball.x, ball.y, cone);
    let closestEdge = 0;
    let closestDistance = Infinity;
    let closest = null;
    for (let index = 0; index < 3; index += 1) {
      const start = cone.vertices[index];
      const end = cone.vertices[(index + 1) % 3];
      const candidate = closestPointOnSegment(ball.x, ball.y, start, end);
      const distance = Math.hypot(ball.x - candidate.x, ball.y - candidate.y);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEdge = index;
        closest = candidate;
      }
    }
    if (!closest || !Number.isFinite(closest.x) || !Number.isFinite(closest.y)) {
      return false;
    }
    let normalX = ball.x - closest.x;
    let normalY = ball.y - closest.y;
    const normalMagnitude = Math.hypot(normalX, normalY);
    if (normalMagnitude <= EPSILON) {
      const centroidX = (
        cone.vertices[0].x + cone.vertices[1].x + cone.vertices[2].x
      ) / 3;
      const centroidY = (
        cone.vertices[0].y + cone.vertices[1].y + cone.vertices[2].y
      ) / 3;
      normalX = ball.x - centroidX;
      normalY = ball.y - centroidY;
    }
    let normalLength = Math.hypot(normalX, normalY) || 1;
    normalX /= normalLength;
    normalY /= normalLength;
    const start = cone.vertices[closestEdge];
    const end = cone.vertices[(closestEdge + 1) % 3];
    const edgeX = end.x - start.x;
    const edgeY = end.y - start.y;
    const centroidX = (
      cone.vertices[0].x + cone.vertices[1].x + cone.vertices[2].x
    ) / 3;
    const centroidY = (
      cone.vertices[0].y + cone.vertices[1].y + cone.vertices[2].y
    ) / 3;
    if (
      (centroidX - closest.x) * normalX +
      (centroidY - closest.y) * normalY > 0
    ) {
      normalX *= -1;
      normalY *= -1;
    }
    normalLength = Math.hypot(normalX, normalY);
    if (Number.isFinite(normalLength) && normalLength > EPSILON) {
      normalX /= normalLength;
      normalY /= normalLength;
    } else {
      // 退化/非法几何（例如零长度法线）时退回边缘法线；仍无法构建时使用
      // 一个固定方向，避免 0/0 产生 NaN 污染球体坐标。
      const edgeLength = Math.hypot(edgeX, edgeY);
      if (Number.isFinite(edgeLength) && edgeLength > EPSILON) {
        normalX = edgeY / edgeLength;
        normalY = -edgeX / edgeLength;
      } else {
        normalX = 1;
        normalY = 0;
      }
      if (
        (centroidX - closest.x) * normalX +
        (centroidY - closest.y) * normalY > 0
      ) {
        normalX *= -1;
        normalY *= -1;
      }
    }

    const radius = Number.isFinite(ball.radius) ? ball.radius : 15;
    const penetration = inside
      ? radius + closestDistance
      : radius - closestDistance;
    ball.x += normalX * penetration;
    ball.y += normalY * penetration;
    if (cone.arena) Object.assign(ball, cone.arena.clampPoint(ball.x, ball.y, ball.radius));

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
    if (context.bouncedX) {
      const hitLeft = ball.x <= ball.radius + EPSILON;
      normalX = hitLeft ? 1 : -1;
      anchorX = hitLeft ? 0 : game.arenaSize;
    }
    if (context.bouncedY) {
      const hitTop = ball.y <= ball.radius + EPSILON;
      normalY = hitTop ? 1 : -1;
      anchorY = hitTop ? 0 : game.arenaSize;
    }
    if (context.wallContacts && context.wallContacts.length) {
      const contact = context.wallContacts[0];
      normalX = contact.normalX; normalY = contact.normalY;
      anchorX = contact.x; anchorY = contact.y;
    }
    const normalMagnitude = Math.hypot(normalX, normalY) || 1;
    normalX /= normalMagnitude;
    normalY /= normalMagnitude;
    const tangentX = -normalY;
    const tangentY = normalX;
    return {
      kind: "spike-cone",
      arena: resolveArenaGeometry(game),
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
    context.shadowColor = "#ff2f2f";
    context.shadowBlur = 6;
    cones.forEach((cone) => {
      if (cone.entityActive === false) return;
      context.fillStyle = "rgba(214, 34, 34, 0.78)";
      context.strokeStyle = "#ff7a6a";
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

  const spikeDefinition = {
    id: "spike",
    name: "\u5c16\u523a",
    englishName: "Spike",
    color: "#8a8f98",
    description: "\u78b0\u8fb9\u5e03\u7f6e\u8840\u7ea2\u5c16\u523a / \u78b0\u523a -3",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      function updateCone(cone, coneServices) {
        const touchingNow = new Set();
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
          }
          resolveConeCollision(target, cone);
        }
        cone.touching = touchingNow;
        return false;
      }

      function spawnCone(context) {
        services.spawnCombatEntity({
          ...createCone(context),
          combatKind: "trap",
          trap: true,
          life: Number.MAX_SAFE_INTEGER,
          drawLayer: "background",
          update({ entity, services: coneServices }) {
            updateCone(entity, coneServices);
          },
          draw({ entity }, canvasContext) {
            drawCones(canvasContext, [entity]);
          }
        });
      }

      return {
        onWallBounce(context) {
          spawnCone(context);
        }
      };
    }
  };

  registerBall(spikeDefinition);
  return { spikeDefinition };
});
