(function initializeAssassin(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAssassinPlugin({ registerBall }) {
  const DAGGER_LENGTH = 35;
  const DAGGER_DAMAGE = 5;
  const FULL_HP_PERIOD = 2;
  const LOW_HP_PERIOD = 0.1;
  const FULL_HP_SPEED = 150;
  const LOW_HP_SPEED = 300;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function livingHpRatio(ball) {
    return clamp((ball.hp - 1) / Math.max(1, ball.maxHp - 1), 0, 1);
  }

  function rotationPeriod(ball) {
    return LOW_HP_PERIOD * Math.pow(
      FULL_HP_PERIOD / LOW_HP_PERIOD,
      livingHpRatio(ball)
    );
  }

  function movementSpeed(ball) {
    return LOW_HP_SPEED * Math.pow(
      FULL_HP_SPEED / LOW_HP_SPEED,
      livingHpRatio(ball)
    );
  }

  function updateMovementSpeed(ball) {
    const nextSpeed = movementSpeed(ball);
    if (Math.abs(ball.speed - nextSpeed) <= EPSILON) return;
    ball.speed = nextSpeed;
    ball.speedNeedsNormalization = true;
  }

  function daggerSegment(ball, angle) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    return {
      startX: ball.x + directionX * ball.radius,
      startY: ball.y + directionY * ball.radius,
      endX: ball.x + directionX * (ball.radius + DAGGER_LENGTH),
      endY: ball.y + directionY * (ball.radius + DAGGER_LENGTH)
    };
  }

  function pointToSegmentDistance(x, y, segment) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((x - segment.startX) * deltaX + (y - segment.startY) * deltaY) /
        lengthSquared,
      0,
      1
    );
    return Math.hypot(
      x - (segment.startX + deltaX * progress),
      y - (segment.startY + deltaY * progress)
    );
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function drawDagger(context, ball, angle) {
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    context.lineJoin = "round";

    context.strokeStyle = "#171b22";
    context.lineWidth = 5;
    context.lineCap = "butt";
    context.beginPath();
    context.moveTo(ball.radius, 0);
    context.lineTo(ball.radius + 5, 0);
    context.stroke();

    context.strokeStyle = "#b98242";
    context.lineWidth = 3;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(ball.radius + 5, -5);
    context.lineTo(ball.radius + 5, 5);
    context.stroke();

    context.fillStyle = "#5ca8df";
    context.strokeStyle = "#d9f1ff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(ball.radius + 6, -3.5);
    context.lineTo(ball.radius + DAGGER_LENGTH, 0);
    context.lineTo(ball.radius + 6, 3.5);
    context.closePath();
    context.fill();
    context.stroke();

    context.strokeStyle = "rgba(255, 255, 255, 0.82)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(ball.radius + 7, -1.5);
    context.lineTo(ball.radius + DAGGER_LENGTH - 4, -0.3);
    context.stroke();
    context.restore();
  }

  const assassinDefinition = {
    id: "assassin",
    name: "\u523a\u5ba2",
    englishName: "Assassin",
    color: "#e53935",
    description: "\u65cb\u8f6c\u77ed\u5251 / \u4f4e\u8840\u8f6c\u901f\u4e0e\u79fb\u901f\u52a0\u5feb / \u5251\u5203-5",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FULL_HP_PERIOD,
    createBehavior(services) {
      let angle = 0;
      let borrowedTravel = 0;
      let ownerBall = null;
      let overlappingTargets = new Set();

      function checkDaggerHits(ball) {
        const segment = daggerSegment(ball, angle);
        const nextOverlaps = new Set();
        for (const target of services.getEnemies()) {
          if (!services.getContactProfile(target).attackable) continue;
          if (pointToSegmentDistance(target.x, target.y, segment) > target.radius) continue;
          const key = targetKey(target);
          nextOverlaps.add(key);
          if (!overlappingTargets.has(key)) {
            services.dealDamage(target, DAGGER_DAMAGE, ball);
          }
        }
        overlappingTargets = nextOverlaps;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
        },
        update(context, dt) {
          ownerBall = context.ball;
          updateMovementSpeed(context.ball);
          const angularSpeed = Math.PI * 2 / rotationPeriod(context.ball);
          const travel = angularSpeed * Math.max(0, dt);
          borrowedTravel += travel;
          angle = (angle + travel) % (Math.PI * 2);
        },
        afterUpdateStep(context) {
          checkDaggerHits(context.ball);
        },
        drawAfter(context, canvasContext) {
          drawDagger(canvasContext, context.ball, angle);
        },
        drawBorrowedWeapon(context, canvasContext) {
          drawDagger(canvasContext, context.ball, angle);
        },
        isAttackCycleComplete() { return borrowedTravel >= Math.PI * 2 - 1e-9; },
        getAttackCycleTransitionIn(context) {
          return Math.max(0, Math.PI * 2 - borrowedTravel) /
            (Math.PI * 2 / rotationPeriod(context.ball));
        },
        getDaggerState() {
          const ball = ownerBall;
          const segment = ball ? daggerSegment(ball, angle) : null;
          return {
            angle,
            period: ball ? rotationPeriod(ball) : FULL_HP_PERIOD,
            length: DAGGER_LENGTH,
            start: segment ? { x: segment.startX, y: segment.startY } : null,
            end: segment ? { x: segment.endX, y: segment.endY } : null
          };
        }
      };
    }
  };

  registerBall(assassinDefinition);
  return { assassinDefinition };
});
