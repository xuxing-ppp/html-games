(function initializeSnake(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnakePlugin({ resolveArenaGeometry, registerBall }) {
  const GROWTH_STAGES = 2;
  const FIRST_SEGMENT_DIAMETER = 29;
  const MIN_SEGMENT_DIAMETER = 6;
  const BASE_COLLISION_DAMAGE = 1;
  const MAX_SEGMENTS = 30;
  const MAX_COLLISION_DAMAGE = BASE_COLLISION_DAMAGE + MAX_SEGMENTS;
  const TAIL_OVERLAP = 2;
  const TAIL_RESPONSE = 8;
  const TAIL_SWAY_ANGLE = 0.045;
  const TAIL_SWAY_SPEED = 5;
  const BODY_COLOR = "#277D8D";
  const TAIL_COLOR = "#1B5967";
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function targetKey(target) {
    return target.instanceId || target;
  }

  function interpolateColor(start, end, progress) {
    const amount = clamp(progress, 0, 1);
    const startValue = Number.parseInt(start.slice(1), 16);
    const endValue = Number.parseInt(end.slice(1), 16);
    const channels = [16, 8, 0].map((shift) => Math.round(
      ((startValue >> shift) & 255) +
      (((endValue >> shift) & 255) - ((startValue >> shift) & 255)) * amount
    ));
    return `#${channels.map((channel) => (
      channel.toString(16).padStart(2, "0")
    )).join("").toUpperCase()}`;
  }

  function segmentColor(segment) {
    return interpolateColor(BODY_COLOR, TAIL_COLOR, segment.stage / GROWTH_STAGES);
  }

  function velocityAngle(ball, fallback) {
    const vx = Math.abs(ball.vx) + Math.abs(ball.vy) > EPSILON
      ? ball.vx
      : ball.storedVx;
    const vy = Math.abs(ball.vx) + Math.abs(ball.vy) > EPSILON
      ? ball.vy
      : ball.storedVy;
    return Math.abs(vx) + Math.abs(vy) > EPSILON ? Math.atan2(vy, vx) : fallback;
  }

  function resolveTailOverlap(segment, target, arenaSize) {
    let dx = target.x - segment.x;
    let dy = target.y - segment.y;
    let distance = Math.hypot(dx, dy);
    const minimumDistance = segment.radius + target.radius;
    if (distance >= minimumDistance) return false;

    if (distance <= EPSILON) {
      const velocityMagnitude = Math.hypot(target.vx, target.vy);
      if (velocityMagnitude > EPSILON) {
        dx = -target.vx / velocityMagnitude;
        dy = -target.vy / velocityMagnitude;
      } else {
        dx = Math.cos(segment.angle);
        dy = Math.sin(segment.angle);
      }
      distance = 1;
    }
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minimumDistance - distance;

    if (!target.positionLocked) {
      Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(target.x + nx * overlap, target.y + ny * overlap, target.radius));
    }

    const velocityDot = target.vx * nx + target.vy * ny;
    if (velocityDot < 0) {
      target.vx -= 2 * velocityDot * nx;
      target.vy -= 2 * velocityDot * ny;
    }
    const storedDot = target.storedVx * nx + target.storedVy * ny;
    if (storedDot < 0) {
      target.storedVx -= 2 * storedDot * nx;
      target.storedVy -= 2 * storedDot * ny;
    }
    return true;
  }

  function drawTail(canvasContext, segments) {
    if (segments.length === 0) return;
    canvasContext.save();
    canvasContext.shadowBlur = 3;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      const color = segmentColor(segment);
      canvasContext.fillStyle = color;
      canvasContext.shadowColor = color;
      canvasContext.beginPath();
      canvasContext.arc(segment.x, segment.y, segment.radius, 0, Math.PI * 2);
      canvasContext.fill();
    }
    canvasContext.restore();
  }

  const snakeDefinition = {
    id: "snake",
    name: "\u97ad\u5b50",
    englishName: "Whip",
    color: BODY_COLOR,
    description: "\u78b0\u649e\u6210\u957f\u5c3e\u6bb5 / \u9f99\u5c3e\u6446\u52a8 / \u4f24\u5bb3\u9012\u589e",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      const segments = [];
      const tailContacts = new Set();
      const lastHeadContactAt = new Map();
      let contactCount = 0;
      let headAngle = 0;

      function positionSegments(ball, game, dt) {
        headAngle = velocityAngle(ball, headAngle);
        let parent = ball;
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          const response = TAIL_RESPONSE / (1 + index * 0.22);
          const blend = 1 - Math.exp(-response * Math.max(0, dt));
          segment.angle += wrapAngle(headAngle - segment.angle) * blend;
          segment.angle = wrapAngle(segment.angle);
          const sway = Math.sin(
            services.getTime() * TAIL_SWAY_SPEED - index * 0.82
          ) * (TAIL_SWAY_ANGLE + Math.min(index, 6) * 0.0025);
          const visualAngle = segment.angle + sway;
          const spacing = parent.radius + segment.radius - TAIL_OVERLAP;
          Object.assign(segment, resolveArenaGeometry(game).clampPoint(parent.x - Math.cos(visualAngle) * spacing, parent.y - Math.sin(visualAngle) * spacing, segment.radius));
          parent = segment;
        }
      }

      function addGrowingSegment(ball, game) {
        headAngle = velocityAngle(ball, headAngle);
        const fullDiameter = Math.max(
          MIN_SEGMENT_DIAMETER,
          FIRST_SEGMENT_DIAMETER - segments.length
        );
        const stage = 1;
        const radius = fullDiameter * stage / GROWTH_STAGES / 2;
        const parent = segments.at(-1) || ball;
        const angle = segments.length === 0 ? headAngle : parent.angle;
        const spacing = parent.radius + radius - TAIL_OVERLAP;
        segments.push({
          fullDiameter,
          stage,
          radius,
          angle,
          ...resolveArenaGeometry(game).clampPoint(parent.x - Math.cos(angle) * spacing,
            parent.y - Math.sin(angle) * spacing, radius)
        });
      }

      function advanceTailGrowth(ball, game) {
        const growingSegment = segments.at(-1);
        if (!growingSegment || growingSegment.stage >= GROWTH_STAGES) {
          if (segments.length >= MAX_SEGMENTS) return;
          addGrowingSegment(ball, game);
        } else {
          growingSegment.stage += 1;
          growingSegment.radius = (
            growingSegment.fullDiameter * growingSegment.stage / GROWTH_STAGES / 2
          );
        }
        positionSegments(ball, game, 0);
      }

      function completedSegmentCount() {
        return segments.filter((segment) => segment.stage >= GROWTH_STAGES).length;
      }

      function registerContact(context, target, canAttack = true) {
        contactCount += 1;
        advanceTailGrowth(context.ball, context.game);
        if (!canAttack || !services.getContactProfile(target).attackable) return;
        const damage = Math.min(
          BASE_COLLISION_DAMAGE + completedSegmentCount(),
          MAX_COLLISION_DAMAGE
        );
        services.dealDamage(target, damage, context.ball);
      }

      function updateTailContacts(context, canAttack) {
        const activeContacts = new Set();
        const growthAllowed = services.getContactProfile(context.ball).solid;
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).solid) return;
          let touching = false;
          segments.forEach((segment) => {
            if (resolveTailOverlap(segment, target, context.game)) {
              touching = true;
            }
          });
          if (!touching) return;

          const key = targetKey(target);
          activeContacts.add(key);
          if (!growthAllowed || tailContacts.has(key)) return;
          const headContactTime = lastHeadContactAt.get(key);
          if (
            headContactTime === undefined ||
            Math.abs(headContactTime - services.getTime()) > EPSILON
          ) {
            registerContact(context, target, canAttack);
          }
        });
        tailContacts.clear();
        activeContacts.forEach((key) => tailContacts.add(key));
      }

      function updateTail(context, dt, canAttack) {
        positionSegments(context.ball, context.game, dt);
        updateTailContacts(context, canAttack);
      }

      return {
        onAttackTransfer(context) {
          // Growth belongs to this weapon instance; old contact pairs do not.
          tailContacts.clear();
          lastHeadContactAt.clear();
          positionSegments(context.ball, context.game, 0);
        },
        onCollision(context, target) {
          lastHeadContactAt.set(targetKey(target), services.getTime());
          registerContact(context, target, !context.blockedAtContact);
        },
        afterUpdateStep(context, dt) {
          updateTail(context, dt, true);
        },
        afterUpdateStepWhilePaused(context, dt) {
          updateTail(context, dt, false);
        },
        drawBefore(_context, canvasContext) {
          drawTail(canvasContext, segments);
        },
        getTailSegments() {
          return segments;
        },
        getContactCount() {
          return contactCount;
        }
      };
    }
  };

  registerBall(snakeDefinition);
  return { snakeDefinition, MAX_SEGMENTS, MAX_COLLISION_DAMAGE };
});
