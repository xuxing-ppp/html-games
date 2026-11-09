(function initializeDaYunV3(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunV3Plugin({ registerBall, applyDamageReduction }) {
  const MAX_SPEED = 500;
  const RAMP_SECONDS = 30;
  const DAMAGE_REDUCTION = 0.94;
  const EPSILON = 1e-9;

  const daYunV3Definition = {
    id: "daYunV3",
    name: "\u5927\u8fd0V3",
    englishName: "Da Yun V3",
    color: "#7c8189",
    description: "恒功率加速 / 30秒拉到500 / 94%减伤 / 撞击 -2",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 20
    },
    createBehavior(services) {
      let elapsed = 0;

      function targetSpeed() {
        return Math.min(MAX_SPEED, MAX_SPEED * Math.sqrt(Math.min(1, elapsed / RAMP_SECONDS)));
      }

      return {
        onSpawn(context) {
          const ball = context.ball;
          ball.speed = 0;
          ball.vx = 0;
          ball.vy = 0;
          ball.storedVx = 0;
          ball.storedVy = 0;
        },
        update(context, dt) {
          elapsed += Math.max(0, dt);
          const ball = context.ball;
          const target = targetSpeed();
          ball.speed = target;
          // Force the actual velocity magnitude to match the sqrt(t/30) curve
          // every frame.  Collisions and wall bounces may change storedVx /
          // storedVy (direction), but the rate is always clamped back to
          // targetSpeed() before the engine moves the ball.
          const mag = Math.hypot(ball.storedVx, ball.storedVy);
          if (target > EPSILON && mag > EPSILON) {
            ball.storedVx = (ball.storedVx / mag) * target;
            ball.storedVy = (ball.storedVy / mag) * target;
          } else if (target > EPSILON) {
            const angle = Math.random() * Math.PI * 2;
            ball.storedVx = Math.cos(angle) * target;
            ball.storedVy = Math.sin(angle) * target;
          } else {
            ball.storedVx = 0;
            ball.storedVy = 0;
          }
          ball.vx = ball.storedVx;
          ball.vy = ball.storedVy;
          ball.speedNeedsNormalization = false;
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          // Damage scales with speed: 1 at standstill, 5 at top speed.
          const progress = Math.min(1, context.ball.speed / MAX_SPEED);
          const damage = 1 + Math.round(4 * progress);
          context.services.dealDamage(target, damage);
        },
        onBeforeDamage(context, event) {
          if (!event.actor || event.actor === context.ball) return event;
          return applyDamageReduction(event, DAMAGE_REDUCTION, Math.random);
        }
      };
    }
  };

  registerBall(daYunV3Definition);
  return { daYunV3Definition };
});
