(function initializeBowV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBowV2Plugin({ registerBall, resolveArenaGeometry }) {
  const FULL_HP_INTERVAL = 1;
  const LOW_HP_INTERVAL = 0.05;
  const ARROW_SPEED_MULTIPLIER = 2.7;
  const ARROW_DAMAGE = 1;
  const ARROW_RADIUS = 2;
  const ARROW_LENGTH = 14;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function livingHpRatio(ball) {
    return clamp((ball.hp - 1) / Math.max(1, ball.maxHp - 1), 0, 1);
  }

  function currentFireInterval(ball) {
    return LOW_HP_INTERVAL * Math.pow(
      FULL_HP_INTERVAL / LOW_HP_INTERVAL,
      livingHpRatio(ball)
    );
  }

  function drawArrow(context, effect) {
    const angle = Math.atan2(effect.vy, effect.vx);
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);
    context.strokeStyle = "#f5f3ee";
    context.lineWidth = 1.8;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-ARROW_LENGTH / 2, 0);
    context.lineTo(ARROW_LENGTH / 2 - 3, 0);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.moveTo(ARROW_LENGTH / 2 + 2, 0);
    context.lineTo(ARROW_LENGTH / 2 - 4, -3.2);
    context.lineTo(ARROW_LENGTH / 2 - 4, 3.2);
    context.closePath();
    context.fill();
    context.strokeStyle = "#d8c7ff";
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(-ARROW_LENGTH / 2 + 1, 0);
    context.lineTo(-ARROW_LENGTH / 2 - 2, -3);
    context.moveTo(-ARROW_LENGTH / 2 + 1, 0);
    context.lineTo(-ARROW_LENGTH / 2 - 2, 3);
    context.stroke();
    context.restore();
  }

  function createArrow(services, source, angle) {
    const speed = source.speed * ARROW_SPEED_MULTIPLIER;
    return {
      kind: "bow-v2-arrow",
      life: 5,
      radius: ARROW_RADIUS,
      damage: ARROW_DAMAGE,
      replayDamage: ARROW_DAMAGE,
      color: "#f5f3ee",
      x: source.x + Math.cos(angle) * (source.radius + 6),
      y: source.y + Math.sin(angle) * (source.radius + 6),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      update({ effect, game, services: entityServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * Math.max(0, dt);
        effect.y += effect.vy * Math.max(0, dt);
        const target = entityServices.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          ARROW_RADIUS
        );
        if (target && entityServices.dealDamage(target, ARROW_DAMAGE)) {
          effect.life = 0;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, ARROW_LENGTH)
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, canvasContext) {
        drawArrow(canvasContext, effect);
      }
    };
  }

  function drawBow(context, ball, angle) {
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    const bowX = ball.radius + 4;

    context.strokeStyle = "#774823";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(bowX - 2, -13);
    context.quadraticCurveTo(bowX + 10, 0, bowX - 2, 13);
    context.stroke();

    context.strokeStyle = "#b96cff";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(bowX - 2, -13);
    context.lineTo(bowX - 8, 0);
    context.lineTo(bowX - 2, 13);
    context.stroke();

    context.strokeStyle = "#f4f0ff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(bowX - 8, 0);
    context.lineTo(bowX + 13, 0);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.moveTo(bowX + 17, 0);
    context.lineTo(bowX + 10, -3.5);
    context.lineTo(bowX + 10, 3.5);
    context.closePath();
    context.fill();
    context.restore();
  }

  const bowV2Definition = {
    id: "bowV2",
    name: "\u5f13\u7badV2",
    englishName: "Bow V2",
    color: "#813fd1",
    description: "\u4f4e\u8840\u52a0\u901f / 3\u500d\u901f\u7bad\u77e2 / \u547d\u4e2d-1",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FULL_HP_INTERVAL,
    createBehavior(services) {
      let fireTimer = 0;
      let fired = false;
      let targetAngle = 0;
      let ownerBall = null;

      function updateTargetAngle(ball) {
        const target = services.getOpponent();
        if (target) targetAngle = Math.atan2(target.y - ball.y, target.x - ball.x);
        return target;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          updateTargetAngle(context.ball);
        },
        onAttackBorrowStart(context) {
          fireTimer = currentFireInterval(context.ball);
          this.afterUpdateStep(context);
        },
        isAttackCycleComplete() { return fired; },
        drawBorrowedWeapon(context, canvasContext) {
          this.drawAfter(context, canvasContext);
        },
        update(context, dt) {
          ownerBall = context.ball;
          updateTargetAngle(context.ball);
          const interval = currentFireInterval(context.ball);
          fireTimer = Math.min(interval, fireTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          const interval = ownerBall ? currentFireInterval(ownerBall) : FULL_HP_INTERVAL;
          return Math.max(EPSILON, interval - fireTimer);
        },
        afterUpdateStep(context) {
          const interval = currentFireInterval(context.ball);
          if (fireTimer + EPSILON < interval) return;
          fireTimer = 0;
          if (!updateTargetAngle(context.ball)) return;
          fired = true;
          services.spawnProjectile(createArrow(
            services,
            context.ball,
            targetAngle
          ));
        },
        drawAfter(context, canvasContext) {
          updateTargetAngle(context.ball);
          drawBow(canvasContext, context.ball, targetAngle);
        },
        getBowState() {
          return {
            targetAngle,
            fireInterval: ownerBall
              ? currentFireInterval(ownerBall)
              : FULL_HP_INTERVAL,
            fireTimer
          };
        }
      };
    }
  };

  registerBall(bowV2Definition);
  return { bowV2Definition };
});
