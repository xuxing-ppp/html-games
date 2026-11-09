(function initializeFragment(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFragmentPlugin({ registerBall, createArenaGeometry }) {

  const BODY_COLOR = "#d8c63f";
  const BODY_SHADES = ["#e0cf48", "#d4bf31", "#eadb58"];
  const CRACK_COLOR = "#786a1c";
  const COOLDOWN_DURATION = 1;
  const FRAGMENT_COUNT = 9;
  const FRAGMENT_SPEED = 420;
  const FRAGMENT_DAMAGE = 2;
  const FRAGMENT_RADIUS = 5;
  const FRAGMENT_SCALE = 0.72;
  const TRAIL_LENGTH = 150;
  const MAX_MOVE_STEP = 1 / 120;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  // 片体美术按 15 半径绘制；被青蛙舌头吞缩等机制缩小时按比例缩放，
  // 环半径/线宽随 scale 收缩，保证小半径下不会画出负半径圆弧。
  const BODY_RADIUS = 15;

  const GRID = [
    [{ x: -16, y: -16 }, { x: -5, y: -16 }, { x: 4, y: -16 }, { x: 16, y: -16 }],
    [{ x: -16, y: -5 }, { x: -6, y: -6 }, { x: 5, y: -4 }, { x: 16, y: -6 }],
    [{ x: -16, y: 5 }, { x: -3, y: 6 }, { x: 6, y: 4 }, { x: 16, y: 6 }],
    [{ x: -16, y: 16 }, { x: -4, y: 16 }, { x: 4, y: 16 }, { x: 16, y: 16 }]
  ];

  const FRAGMENT_SHAPES = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const points = [
        GRID[row][column],
        GRID[row][column + 1],
        GRID[row + 1][column + 1],
        GRID[row + 1][column]
      ].map((point) => ({ ...point }));
      const centroid = points.reduce((result, point) => ({
        x: result.x + point.x / points.length,
        y: result.y + point.y / points.length
      }), { x: 0, y: 0 });
      FRAGMENT_SHAPES.push(Object.freeze({
        index: row * 3 + column,
        points: Object.freeze(points),
        centroid: Object.freeze(centroid)
      }));
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function tracePolygon(context, points, scale = 1) {
    context.beginPath();
    context.moveTo(points[0].x * scale, points[0].y * scale);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x * scale, points[index].y * scale);
    }
    context.closePath();
  }

  function drawBodyPieces(context, ball, visibleIndexes = null) {
    const scale = clamp(ball.radius / BODY_RADIUS, 0.05, 1);
    context.save();
    context.translate(ball.x, ball.y);
    context.beginPath();
    context.arc(0, 0, Math.max(0.05, ball.radius - 0.5 * scale), 0, Math.PI * 2);
    context.clip();
    FRAGMENT_SHAPES.forEach((shape, index) => {
      if (visibleIndexes && !visibleIndexes.has(index)) return;
      tracePolygon(context, shape.points, scale);
      context.fillStyle = BODY_SHADES[index % BODY_SHADES.length];
      context.fill();
      context.strokeStyle = CRACK_COLOR;
      context.lineWidth = Math.max(0.5, 1.25 * scale);
      context.stroke();
    });
    context.restore();
  }

  function drawWholeBody(context, ball) {
    drawBodyPieces(context, ball);
    context.save();
    context.strokeStyle = "#75661b";
    context.lineWidth = Math.max(0.5, 2 * clamp(ball.radius / BODY_RADIUS, 0.05, 1));
    context.beginPath();
    context.arc(ball.x, ball.y, Math.max(0.05, ball.radius), 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawReturningBody(context, ball, returnedIndexes) {
    drawBodyPieces(context, ball, returnedIndexes);
    drawHollowBody(context, ball);
  }

  function drawHollowBody(context, ball) {
    const scale = clamp(ball.radius / BODY_RADIUS, 0.05, 1);
    const outerRadius = Math.max(0.05, ball.radius - 0.8 * scale);
    const innerRadius = Math.max(0.05, ball.radius - 2.2 * scale);
    context.save();
    context.strokeStyle = "#746419";
    context.lineWidth = Math.max(0.5, 3.2 * scale);
    context.beginPath();
    context.arc(ball.x, ball.y, outerRadius, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = BODY_COLOR;
    context.lineWidth = Math.max(0.5, 1.6 * scale);
    context.beginPath();
    context.arc(ball.x, ball.y, innerRadius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function trimTrailPoints(points, maximumLength = TRAIL_LENGTH) {
    if (points.length < 2) return points.slice();
    const trimmed = [points[points.length - 1]];
    let remainingLength = maximumLength;

    for (let index = points.length - 2; index >= 0 && remainingLength > EPSILON; index -= 1) {
      const newer = points[index + 1];
      const older = points[index];
      const segmentLength = Math.hypot(newer.x - older.x, newer.y - older.y);
      if (segmentLength <= EPSILON) continue;
      if (segmentLength <= remainingLength + EPSILON) {
        trimmed.push(older);
        remainingLength -= segmentLength;
        continue;
      }
      const progress = remainingLength / segmentLength;
      trimmed.push({
        x: newer.x + (older.x - newer.x) * progress,
        y: newer.y + (older.y - newer.y) * progress
      });
      remainingLength = 0;
    }
    trimmed.reverse();
    return trimmed;
  }

  function appendTrailPoint(fragment, x, y) {
    const points = fragment.trailPoints;
    const latest = points[points.length - 1];
    if (latest && Math.hypot(x - latest.x, y - latest.y) <= EPSILON) return;
    points.push({ x, y });
    fragment.trailPoints = trimTrailPoints(points);
  }

  function trailNormal(points, index) {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    let directionX = next.x - previous.x;
    let directionY = next.y - previous.y;
    let length = Math.hypot(directionX, directionY);
    if (length <= EPSILON && index > 0) {
      directionX = points[index].x - points[index - 1].x;
      directionY = points[index].y - points[index - 1].y;
      length = Math.hypot(directionX, directionY);
    }
    if (length <= EPSILON) return { x: 0, y: 1 };
    return { x: -directionY / length, y: directionX / length };
  }

  function drawRadialTrail(context, fragment) {
    const points = trimTrailPoints(fragment.trailPoints || []);
    if (points.length < 2) return;
    const wide = 4.2;
    const thin = 0.35;
    const distances = [0];
    for (let index = 1; index < points.length; index += 1) {
      distances.push(distances[index - 1] + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y
      ));
    }
    const totalLength = distances[distances.length - 1] || 1;
    const leftEdge = [];
    const rightEdge = [];
    points.forEach((point, index) => {
      const normal = trailNormal(points, index);
      const progress = distances[index] / totalLength;
      const halfWidth = thin + (wide - thin) * progress;
      leftEdge.push({
        x: point.x + normal.x * halfWidth,
        y: point.y + normal.y * halfWidth
      });
      rightEdge.push({
        x: point.x - normal.x * halfWidth,
        y: point.y - normal.y * halfWidth
      });
    });

    context.save();
    context.globalAlpha *= 0.66;
    context.fillStyle = "rgba(216, 198, 63, 0.74)";
    context.beginPath();
    context.moveTo(leftEdge[0].x, leftEdge[0].y);
    for (let index = 1; index < leftEdge.length; index += 1) {
      context.lineTo(leftEdge[index].x, leftEdge[index].y);
    }
    for (let index = rightEdge.length - 1; index >= 0; index -= 1) {
      context.lineTo(rightEdge[index].x, rightEdge[index].y);
    }
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawFlyingFragment(context, fragment) {
    drawRadialTrail(context, fragment);
    const shape = fragment.shape;
    context.save();
    context.translate(fragment.x, fragment.y);
    context.rotate(fragment.rotation + fragment.age * fragment.spin);
    const localPoints = shape.points.map((point) => ({
      x: point.x - shape.centroid.x,
      y: point.y - shape.centroid.y
    }));
    tracePolygon(context, localPoints, FRAGMENT_SCALE);
    context.fillStyle = BODY_SHADES[shape.index % BODY_SHADES.length];
    context.fill();
    context.strokeStyle = CRACK_COLOR;
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  function segmentCircleProgress(startX, startY, endX, endY, centerX, centerY, radius) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((centerX - startX) * deltaX + (centerY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    return Math.hypot(centerX - closestX, centerY - closestY) <= radius
      ? progress
      : null;
  }

  function updateEnemyHits(fragment, entityServices, startX, startY) {
    const touchingNow = new Set();
    entityServices.forEachEnemy((target) => {
      const radius = target.radius + fragment.radius;
      const key = target.instanceId || target.id;
      const crosses = segmentCircleProgress(
        startX,
        startY,
        fragment.x,
        fragment.y,
        target.x,
        target.y,
        radius
      ) !== null;
      if (crosses && !fragment.touchingTargets.has(key)) {
        entityServices.dealDamage(target, FRAGMENT_DAMAGE);
      }
      if (Math.hypot(target.x - fragment.x, target.y - fragment.y) <= radius) {
        touchingNow.add(key);
      }
    });
    fragment.touchingTargets = touchingNow;
  }

  function createFlyingFragment(owner, shape, angle, generation, onCollected) {
    const startX = owner.x + shape.centroid.x * 0.5;
    const startY = owner.y + shape.centroid.y * 0.5;
    const velocityX = Math.cos(angle) * FRAGMENT_SPEED;
    const velocityY = Math.sin(angle) * FRAGMENT_SPEED;
    return {
      kind: "fragment-shard",
      lifecycle: "owner-bound",
      life: PERMANENT_LIFE,
      radius: FRAGMENT_RADIUS,
      damage: FRAGMENT_DAMAGE,
      replayDamage: FRAGMENT_DAMAGE,
      color: BODY_COLOR,
      x: startX,
      y: startY,
      vx: velocityX,
      vy: velocityY,
      trailPoints: [{ x: startX, y: startY }],
      shape,
      generation,
      rotation: angle,
      spin: (shape.index % 2 === 0 ? 1 : -1) * (1.5 + shape.index * 0.08),
      bounceCount: 0,
      armedForReturn: false,
      touchingTargets: new Set(),
      update({ effect, game, services: entityServices }, dt) {
        let remaining = Math.max(0, dt);
        while (remaining > EPSILON && effect.entityActive !== false) {
          const step = Math.min(MAX_MOVE_STEP, remaining);
          const startX = effect.x;
          const startY = effect.y;
          const arena = game.arena || createArenaGeometry(game.arenaSize);
          const wall = arena.traceSegment(effect.x, effect.y, effect.x + effect.vx * step, effect.y + effect.vy * step, effect.radius);
          const motion = { ...arena.clampPoint(effect.x + effect.vx * step, effect.y + effect.vy * step, effect.radius), bounces: wall ? 1 : 0 };
          if (wall && arena.shape === "circle") { motion.x = wall.x; motion.y = wall.y; }
          Object.assign(effect, { x: motion.x, y: motion.y });
          if (wall) {
            if (arena.shape !== "circle" && wall.normalX && wall.normalY) { effect.vx *= -1; effect.vy *= -1; }
            else {
              const dot = effect.vx * wall.normalX + effect.vy * wall.normalY;
              effect.vx -= 2 * dot * wall.normalX; effect.vy -= 2 * dot * wall.normalY;
            }
          }
          effect.bounceCount += motion.bounces;
          appendTrailPoint(effect, effect.x, effect.y);

          updateEnemyHits(effect, entityServices, startX, startY);

          const returnRadius = owner.radius + effect.radius;
          const distance = Math.hypot(effect.x - owner.x, effect.y - owner.y);
          if (!effect.armedForReturn) {
            if (distance > returnRadius + 1) effect.armedForReturn = true;
          } else if (owner.hp > 0 && segmentCircleProgress(
            startX,
            startY,
            effect.x,
            effect.y,
            owner.x,
            owner.y,
            returnRadius
          ) !== null) {
            effect.x = owner.x;
            effect.y = owner.y;
            effect.life = 0;
            effect.entityActive = false;
            onCollected(effect);
            return;
          }
          remaining -= step;
        }
      },
      draw({ effect }, context) {
        drawFlyingFragment(context, effect);
      }
    };
  }

  const fragmentDefinition = {
    id: "fragment",
    name: "碎片",
    englishName: "Fragment",
    color: BODY_COLOR,
    description: "九片穿透反弹 / 420速度 / 全数回收后再发射",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let cooldown = COOLDOWN_DURATION;
      let deployed = false;
      let generation = 0;
      const activeFragments = new Set();
      const returnedIndexes = new Set();

      function completeCollection() {
        if (!deployed || activeFragments.size > 0) return;
        deployed = false;
        cooldown = COOLDOWN_DURATION;
      }

      function collectFragment(fragment) {
        returnedIndexes.add(fragment.shape.index);
        activeFragments.delete(fragment);
        completeCollection();
      }

      function reconcileDestroyedFragments() {
        for (const fragment of Array.from(activeFragments)) {
          if (fragment.entityActive === false || fragment.life <= 0) {
            returnedIndexes.add(fragment.shape.index);
            activeFragments.delete(fragment);
          }
        }
        completeCollection();
      }

      function launchFragments(ball) {
        generation += 1;
        deployed = true;
        returnedIndexes.clear();
        const angleOffset = generation * 0.31;
        FRAGMENT_SHAPES.forEach((shape, index) => {
          const angle = angleOffset + index * Math.PI * 2 / FRAGMENT_COUNT;
          const fragment = services.spawnProjectile(createFlyingFragment(
            ball,
            shape,
            angle,
            generation,
            collectFragment
          ));
          activeFragments.add(fragment);
        });
      }

      return {
        update(_context, dt) {
          if (deployed) {
            reconcileDestroyedFragments();
            return;
          }
          cooldown = Math.max(0, cooldown - Math.max(0, dt));
        },
        getNextTransitionIn() {
          if (deployed) return undefined;
          return Math.max(EPSILON, cooldown);
        },
        afterUpdateStep(context) {
          if (!deployed && cooldown <= EPSILON) launchFragments(context.ball);
        },
        drawBody(context, canvasContext) {
          if (deployed) drawReturningBody(canvasContext, context.ball, returnedIndexes);
          else drawWholeBody(canvasContext, context.ball);
          return true;
        },
        getFragmentState() {
          return {
            cooldown,
            deployed,
            generation,
            remaining: activeFragments.size,
            returnedIndexes: Array.from(returnedIndexes)
          };
        }
      };
    }
  };

  registerBall(fragmentDefinition);
  return {
    fragmentDefinition,
    FRAGMENT_COOLDOWN_DURATION: COOLDOWN_DURATION,
    FRAGMENT_PROJECTILE_COUNT: FRAGMENT_COUNT,
    FRAGMENT_PROJECTILE_SPEED: FRAGMENT_SPEED,
    FRAGMENT_PROJECTILE_DAMAGE: FRAGMENT_DAMAGE,
    FRAGMENT_TRAIL_LENGTH: TRAIL_LENGTH,
    FRAGMENT_BODY_SHAPES: FRAGMENT_SHAPES
  };
});
