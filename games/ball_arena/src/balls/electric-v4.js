(function initializeElectricV4(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricV4Plugin({ registerBall, resolveArenaGeometry }) {
  const FIRE_INTERVAL = 1 / 20;
  const ANGLE_STEP_DEGREES = 38;
  const ANGLE_STEP = ANGLE_STEP_DEGREES * Math.PI / 180;
  const LIGHTNING_DAMAGE = 3;
  const LIGHTNING_HIT_RADIUS = 2;
  const LIGHTNING_LIFE = 0.18;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function distanceToArenaEdge(x, y, directionX, directionY, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    return arena.movementLimit(x, y, directionX, directionY, arena.size * 2);
  }

  function createLightningPath(ball, arenaSize, angle) {
    const directionX = Math.cos(angle);
    const directionY = -Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    const edgeDistance = distanceToArenaEdge(
      ball.x,
      ball.y,
      directionX,
      directionY,
      arenaSize
    );
    const startDistance = Math.min(ball.radius, edgeDistance);
    const length = Math.max(0, edgeDistance - startDistance);
    const segmentCount = Math.max(2, Math.min(28, Math.ceil(length / 15)));
    const points = [];
    let bendOffset = 0;

    for (let index = 0; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const distance = startDistance + length * progress;
      const edgeFade = Math.sin(progress * Math.PI);
      // Let each bend carry a little of the previous bend so the bolt reads
      // as a natural discharge instead of a perfectly alternating sawtooth.
      bendOffset = bendOffset * 0.48 + (Math.random() - 0.5) * 11;
      const pointOffset = index === 0 || index === segmentCount
        ? 0
        : Math.max(-10, Math.min(10, bendOffset)) * edgeFade;
      points.push({
        x: ball.x + directionX * distance + normalX * pointOffset,
        y: ball.y + directionY * distance + normalY * pointOffset
      });
    }

    const branches = [];
    for (let index = 3; index < points.length - 2; index += 4) {
      const point = points[index];
      const side = index % 2 === 0 ? -1 : 1;
      const branchLength = 6 + Math.random() * 9;
      const middle = {
        x: point.x + normalX * side * branchLength * 0.52 + directionX * branchLength * 0.12,
        y: point.y + normalY * side * branchLength * 0.52 + directionY * branchLength * 0.12
      };
      branches.push({
        points: [
          { x: point.x, y: point.y },
          middle,
          {
            x: middle.x + normalX * side * branchLength * 0.48 + directionX * branchLength * 0.12,
            y: middle.y + normalY * side * branchLength * 0.48 + directionY * branchLength * 0.12
          }
        ]
      });
    }

    return { points, branches, directionX, directionY };
  }

  function pointToSegmentDistanceSquared(pointX, pointY, start, end) {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON) {
      const deltaX = pointX - start.x;
      const deltaY = pointY - start.y;
      return deltaX * deltaX + deltaY * deltaY;
    }
    const progress = clamp(
      ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) /
        lengthSquared,
      0,
      1
    );
    const closestX = start.x + segmentX * progress;
    const closestY = start.y + segmentY * progress;
    const deltaX = pointX - closestX;
    const deltaY = pointY - closestY;
    return deltaX * deltaX + deltaY * deltaY;
  }

  function pathHitsTarget(points, target) {
    const hitDistance = target.radius + LIGHTNING_HIT_RADIUS;
    const hitDistanceSquared = hitDistance * hitDistance;
    for (let index = 1; index < points.length; index += 1) {
      if (pointToSegmentDistanceSquared(
        target.x,
        target.y,
        points[index - 1],
        points[index]
      ) <= hitDistanceSquared) return true;
    }
    return false;
  }

  function createLightningEffect(path, angleDegrees) {
    return {
      kind: "electric-v4-lightning",
      life: LIGHTNING_LIFE,
      angleDegrees,
      directionX: path.directionX,
      directionY: path.directionY,
      points: path.points,
      branches: path.branches,
      penetrating: true,
      damage: LIGHTNING_DAMAGE,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        const flicker = Math.floor(effect.age * 100) % 2 === 0 ? 1 : 0.7;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade * flicker;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.shadowColor = "#5bdcff";
        context.shadowBlur = 7;
        context.strokeStyle = "#2089ed";
        context.lineWidth = 3.4 - progress * 1.7;
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();

        context.shadowBlur = 3;
        context.strokeStyle = "#dffcff";
        context.lineWidth = 0.95;
        context.stroke();

        context.strokeStyle = "#7be8ff";
        context.lineWidth = Math.max(0.45, 0.85 - progress * 0.35);
        effect.branches.forEach((branch) => {
          context.beginPath();
          branch.points.forEach((point, index) => {
            if (index === 0) context.moveTo(point.x, point.y);
            else context.lineTo(point.x, point.y);
          });
          context.stroke();
        });
        context.restore();
      }
    };
  }

  const electricV4Definition = {
    id: "electricV4",
    name: "\u7535\u7403V4",
    englishName: "Electric Ball V4",
    color: "#278ee8",
    description: "20发/秒逆时针雷电 / 38度步进 / 穿透 -3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let fireTimer = 0;
      let firePending = false;
      let shotIndex = 0;

      function fire(context) {
        services.playSound("shoot");
        const angle = shotIndex * ANGLE_STEP;
        const angleDegrees = (shotIndex * ANGLE_STEP_DEGREES) % 360;
        shotIndex += 1;
        const path = createLightningPath(
          context.ball,
          context.game,
          angle
        );
        const effect = services.spawnVisualEffect(
          createLightningEffect(path, angleDegrees)
        );
        services.forEachEnemy((target) => {
          if (!pathHitsTarget(effect.points, target)) return;
          services.dealDamage(target, LIGHTNING_DAMAGE, context.ball);
        });
      }

      return {
        update(_context, dt) {
          fireTimer = Math.min(FIRE_INTERVAL, fireTimer + Math.max(0, dt));
          firePending = fireTimer + EPSILON >= FIRE_INTERVAL;
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, FIRE_INTERVAL - fireTimer);
        },
        afterUpdateStep(context) {
          if (!firePending) return;
          firePending = false;
          fireTimer = 0;
          fire(context);
        },
        getShotCount() {
          return shotIndex;
        }
      };
    }
  };

  registerBall(electricV4Definition);
  return { electricV4Definition };
});
