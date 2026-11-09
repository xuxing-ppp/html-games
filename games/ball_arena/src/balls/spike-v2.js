(function initializeSpikeV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpikeV2Plugin({ resolveArenaGeometry, registerBall }) {
  // V1 的 1/4 有效大小：下底与高都取 V1 的一半。
  const CONE_SIDE = 7.5;
  const CONE_HEIGHT = 10;
  const CONE_COLLISION_DAMAGE = 3;
  const SHOOT_SPEED = 15;
  const SHOOT_DAMAGE = 2;
  const SHOOT_LIFE = Number.MAX_SAFE_INTEGER;
  const CONE_DEDUP_RADIUS = 12;
  // 本体碰到尖刺（或在其附近碰墙）即触发脱墙射出。
  const CONE_TRIGGER_RADIUS = 16;
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

  function orientation(first, second, third) {
    return (
      (second.x - first.x) * (third.y - first.y) -
      (second.y - first.y) * (third.x - first.x)
    );
  }

  function onSegment(point, start, end) {
    return (
      point.x >= Math.min(start.x, end.x) - EPSILON &&
      point.x <= Math.max(start.x, end.x) + EPSILON &&
      point.y >= Math.min(start.y, end.y) - EPSILON &&
      point.y <= Math.max(start.y, end.y) + EPSILON
    );
  }

  function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const firstOrientation = orientation(firstStart, firstEnd, secondStart);
    const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
    const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
    const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);
    const crossesFirst = (firstOrientation > EPSILON && secondOrientation < -EPSILON) ||
      (firstOrientation < -EPSILON && secondOrientation > EPSILON);
    const crossesSecond = (thirdOrientation > EPSILON && fourthOrientation < -EPSILON) ||
      (thirdOrientation < -EPSILON && fourthOrientation > EPSILON);
    if (crossesFirst && crossesSecond) return true;
    return (
      (Math.abs(firstOrientation) <= EPSILON && onSegment(secondStart, firstStart, firstEnd)) ||
      (Math.abs(secondOrientation) <= EPSILON && onSegment(secondEnd, firstStart, firstEnd)) ||
      (Math.abs(thirdOrientation) <= EPSILON && onSegment(firstStart, secondStart, secondEnd)) ||
      (Math.abs(fourthOrientation) <= EPSILON && onSegment(firstEnd, secondStart, secondEnd))
    );
  }

  function segmentDistance(firstStart, firstEnd, secondStart, secondEnd) {
    if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) return 0;
    const firstToSecondStart = closestPointOnSegment(
      secondStart.x,
      secondStart.y,
      firstStart,
      firstEnd
    );
    const firstToSecondEnd = closestPointOnSegment(
      secondEnd.x,
      secondEnd.y,
      firstStart,
      firstEnd
    );
    const secondToFirstStart = closestPointOnSegment(
      firstStart.x,
      firstStart.y,
      secondStart,
      secondEnd
    );
    const secondToFirstEnd = closestPointOnSegment(
      firstEnd.x,
      firstEnd.y,
      secondStart,
      secondEnd
    );
    return Math.min(
      Math.hypot(secondStart.x - firstToSecondStart.x, secondStart.y - firstToSecondStart.y),
      Math.hypot(secondEnd.x - firstToSecondEnd.x, secondEnd.y - firstToSecondEnd.y),
      Math.hypot(firstStart.x - secondToFirstStart.x, firstStart.y - secondToFirstStart.y),
      Math.hypot(firstEnd.x - secondToFirstEnd.x, firstEnd.y - secondToFirstEnd.y)
    );
  }

  function segmentTouchesCone(start, end, radius, cone) {
    if (!cone || !Array.isArray(cone.vertices) || cone.vertices.length < 3) return false;
    if (pointInsideTriangle(start.x, start.y, cone) || pointInsideTriangle(end.x, end.y, cone)) {
      return true;
    }
    for (let index = 0; index < 3; index += 1) {
      const edgeStart = cone.vertices[index];
      const edgeEnd = cone.vertices[(index + 1) % 3];
      if (segmentDistance(start, end, edgeStart, edgeEnd) <= radius + EPSILON) return true;
    }
    return false;
  }

  function circleTouchesCone(ball, cone) {
    if (
      !Number.isFinite(ball.x) || !Number.isFinite(ball.y) ||
      !cone || !Array.isArray(cone.vertices) || cone.vertices.length < 3
    ) {
      return false;
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
    let fallbackNormalX;
    let fallbackNormalY;
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
      const edgeLength = Math.hypot(edgeX, edgeY);
      if (Number.isFinite(edgeLength) && edgeLength > EPSILON) {
        fallbackNormalX = edgeY / edgeLength;
        fallbackNormalY = -edgeX / edgeLength;
      } else {
        fallbackNormalX = 1;
        fallbackNormalY = 0;
      }
      normalX = fallbackNormalX;
      normalY = fallbackNormalY;
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

  function coneVertices(entity) {
    // 由当前 anchor 位置与法线重建三角形顶点。
    const tangentX = -entity.normalY;
    const tangentY = entity.normalX;
    return [
      {
        x: entity.x + tangentX * CONE_SIDE / 2,
        y: entity.y + tangentY * CONE_SIDE / 2
      },
      {
        x: entity.x - tangentX * CONE_SIDE / 2,
        y: entity.y - tangentY * CONE_SIDE / 2
      },
      {
        x: entity.x + entity.normalX * CONE_HEIGHT,
        y: entity.y + entity.normalY * CONE_HEIGHT
      }
    ];
  }

  function launchCone(entity, coneServices) {
    entity.flies = true;
    entity.vx = entity.normalX * SHOOT_SPEED;
    entity.vy = entity.normalY * SHOOT_SPEED;
    // Placement entities can sit on a wall for arbitrarily long periods.  A
    // flight duration must start at launch, not be measured from placement,
    // otherwise a cone older than four seconds disappears on the same frame
    // that its owner finally touches it.
    entity.age = 0;
    entity.life = SHOOT_LIFE;
    // 射出瞬间清空接触集合：飞行阶段按"每帧谁在刺上"重算，只结算新接触。
    entity.touching = new Set();
  }

  function updatePlacedCone(entity, coneServices) {
    const touchingNow = new Set();
    const contactTargets = [];
        coneServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
      const overlapping = circleTouchesCone(target, entity);
      coneServices.notifyEntityContact(target, entity, { overlapping });
      if (!overlapping) continue;
      touchingNow.add(target.instanceId);
      const targetContact = coneServices.getContactProfile(target);
      if (!targetContact.solid || !targetContact.attackable) continue;
      if (!entity.touching.has(target.instanceId)) {
        if (coneServices.tryConsumeEntity(target, entity, { physical: true })) {
          entity.entityActive = false;
          return;
        }
        coneServices.dealDamage(target, CONE_COLLISION_DAMAGE);
      }
      resolveConeCollision(target, entity);
    }
    entity.touching = touchingNow;

    const owner = entity.owner;
    const ownerTouchingNow = Boolean(
      owner && Number.isFinite(owner.x) && Number.isFinite(owner.y) && owner.hp > 0 &&
      circleTouchesCone(owner, entity)
    );

    // The cone is born at the wall underneath the owner's body.  Treat that
    // initial overlap as placement, not as a launch request.  The owner must
    // first clear the cone and then enter it again; this gives us an actual
    // contact edge and prevents a stationary/stunned owner from launching its
    // freshly planted cone after an arbitrary grace timer.
    if (entity.ownerTouchArmed && entity.ownerTouching === false && owner) {
      const previousX = Number.isFinite(owner.prevX) ? owner.prevX : owner.x;
      const previousY = Number.isFinite(owner.prevY) ? owner.prevY : owner.y;
      const ownerPathTouches = segmentTouchesCone(
        { x: previousX, y: previousY },
        { x: owner.x, y: owner.y },
        Number.isFinite(owner.radius) ? owner.radius : 15,
        entity
      );
      if (ownerTouchingNow || ownerPathTouches) {
        launchCone(entity, coneServices);
        return;
      }
    }
    if (!ownerTouchingNow) {
      entity.ownerTouching = false;
      entity.ownerTouchArmed = true;
      return;
    }
    entity.ownerTouching = true;
  }

  function updateFlyingCone(entity, coneServices, dt) {
    if (!Number.isFinite(entity.vx) || !Number.isFinite(entity.vy)) {
      entity.entityActive = false;
      return;
    }
    const startX = entity.x;
    const startY = entity.y;
    entity.x += entity.vx * dt;
    entity.y += entity.vy * dt;
    // 命中判定按"这一段飞行里刺身与目标是否相交"逐帧重算：留在刺里的目标只结算
    // 一次，离开之后再次被刺到会重新受伤 —— 与落地尖刺、V1 的 touching 语义一致。
    // 不能沿用一次性 hitTargets：飞刺寿命是无限的，那等于同一个敌人整局只吃一次。
    const touchingNow = new Set();
    const contactTargets = [];
        coneServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
      const closest = closestPointOnSegment(
        target.x,
        target.y,
        { x: startX, y: startY },
        { x: entity.x, y: entity.y }
      );
      if (Math.hypot(target.x - closest.x, target.y - closest.y) >
        target.radius + CONE_SIDE / 2) continue;
      touchingNow.add(target.instanceId);
      if (entity.touching.has(target.instanceId)) continue;
      coneServices.dealDamage(target, SHOOT_DAMAGE);
    }
    entity.touching = touchingNow;
  }

  function drawCone(context, entity, flying) {
    const vertices = entity.vertices;
    context.save();
    if (flying) {
      context.globalCompositeOperation = "lighter";
      context.shadowColor = "#ff8f4c";
      context.shadowBlur = 8;
    } else {
      context.shadowColor = "#ff2f2f";
      context.shadowBlur = 5;
    }
    context.fillStyle = flying ? "rgba(255, 122, 66, 0.85)" : "rgba(214, 34, 34, 0.78)";
    context.strokeStyle = flying ? "#ffd0a0" : "#ff7a6a";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(vertices[0].x, vertices[0].y);
    context.lineTo(vertices[1].x, vertices[1].y);
    context.lineTo(vertices[2].x, vertices[2].y);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  function createConeEntity(context) {
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
    const entity = {
      kind: "spike-v2-cone",
      arena: resolveArenaGeometry(game),
      x: anchorX,
      y: anchorY,
      normalX,
      normalY,
      touching: new Set(),
      flies: false,
      owner: ball,
      // The body normally overlaps the newly planted cone at the wall.  The
      // first clear/re-enter transition is the only self-trigger that should
      // launch it.
      ownerTouching: false,
      ownerTouchArmed: false,
      vertices: null
    };
    entity.vertices = coneVertices(entity);
    entity.ownerTouching = circleTouchesCone(ball, entity);
    entity.ownerTouchArmed = !entity.ownerTouching;
    return entity;
  }

  const spikeV2Definition = {
    id: "spikeV2",
    name: "\u5c16\u523aV2",
    englishName: "Spike V2",
    color: "#b8543c",
    description: "\u78b0\u8fb9\u5e03\u7f6e\u5c16\u523a / \u78b0\u523a -3 / \u672c\u4f53\u89e6\u53d1\u5c04\u51fa",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      function updateCone(entity, coneServices, dt) {
        entity.vertices = coneVertices(entity);
        if (entity.flies) {
          updateFlyingCone(entity, coneServices, dt);
          return;
        }
        updatePlacedCone(entity, coneServices);
      }

      const cones = [];

      function pruneCones() {
        for (let index = cones.length - 1; index >= 0; index -= 1) {
          if (cones[index].entityActive === false) cones.splice(index, 1);
        }
      }

      function nearExistingCone(entity) {
        for (const cone of cones) {
          if (
            cone.entityActive !== false &&
            Math.hypot(cone.x - entity.x, cone.y - entity.y) < CONE_DEDUP_RADIUS
          ) {
            return true;
          }
        }
        return false;
      }

      return {
        update() {
          pruneCones();
        },
        onWallBounce(context) {
          const entity = createConeEntity(context);
          // 已有尖刺就在这个触墙点：直接让它脱墙射出，不叠新刺。
          let triggered = false;
          for (const cone of cones) {
            if (
              cone.entityActive === false || cone.flies ||
              Math.hypot(cone.x - entity.x, cone.y - entity.y) >= CONE_TRIGGER_RADIUS
            ) continue;
            launchCone(cone, services);
            triggered = true;
          }
          if (triggered || nearExistingCone(entity)) return;
          const spawned = services.spawnCombatEntity({
            ...entity,
            combatKind: "trap",
            trap: true,
            life: Number.MAX_SAFE_INTEGER,
            drawLayer: "background",
            update({ entity: cone, game, services: coneServices }, dt) {
              const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
              updateCone(cone, coneServices, step);
              // 出界即销毁：整个刺身离开场地就立刻回收，不留一个飞到场外、既打不到
              // 人又永远不消失的实体。刺座（entity.x/y）是三角的尾边、刺尖在前方
              // CONE_HEIGHT 处，所以刺座越过边界一个身长时整个三角已经在场外。
              const gameSize = game ? game.arenaSize : 0;
              if (gameSize > 0) {
                const margin = CONE_HEIGHT;
                if (
                  !resolveArenaGeometry(game).intersectsCircle(cone.x, cone.y, margin)
                ) {
                  cone.entityActive = false;
                }
              }
            },
            draw({ entity: cone }, canvasContext) {
              drawCone(canvasContext, cone, cone.flies);
            }
          });
          cones.push(spawned);
        }
      };
    }
  };

  registerBall(spikeV2Definition);
  return { spikeV2Definition, CONE_SIDE, CONE_HEIGHT, SHOOT_SPEED, SHOOT_DAMAGE,
    spikeV2CircleTouchesCone: circleTouchesCone,
    spikeV2SegmentTouchesCone: segmentTouchesCone,
    spikeV2ResolveConeCollision: resolveConeCollision };
});
