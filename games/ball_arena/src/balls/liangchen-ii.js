(function initializeLiangchenII(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenIIPlugin(dependencies) {
  "use strict";
  const { registerBall } = dependencies;

  const RULES = Object.freeze({
    bodyDamage: 2,
    boostBodyDamage: 16,
    boostSpeedMultiplier: 3,
    boostDuration: 4,
    boostCooldown: 4,
    regenPeriod: 4  // 回血速率单位：每4s回 (maxHp - hp) 血
  });
  const EPSILON = 1e-9;

  function regenRate(ball) {
    // 速率 = 缺失血量 / 4s。满血→0，25血→2.5/s，1血→8.5/s
    return Math.max(0, ball.maxHp - ball.hp) / RULES.regenPeriod;
  }

  const liangchenIIDefinition = {
    id: "liangchenII",
    name: "良辰II",
    englishName: "Liangchen II",
    color: "#960c04",
    description: "CD期回血速率=(缺失血量)/4s，血越少回越快 / 冲刺4s：16撞伤×3速+拖尾",
    stats: { radius: 15, speed: 150, maxHp: 35 },
    createBehavior(services) {
      let boostTimeLeft = 0;
      let cooldownLeft = 0;
      let trail = null;

      function isBoosting() { return boostTimeLeft > EPSILON; }
      function isCoolingDown() { return !isBoosting() && cooldownLeft > EPSILON; }

      let lastReportedHp = null;
      function regen(ball, dt) {
        if (ball.hp <= 0 || ball.hp >= ball.maxHp || !canRegenNow()) {
          lastReportedHp = ball.hp;
          return;
        }
        const before = ball.hp;
        ball.hp = Math.min(ball.maxHp, ball.hp + regenRate(ball) * dt);
        // 每跨过一个整数血量就飘一次 "+1"
        const crossed = Math.floor(ball.hp) - Math.floor(before);
        if (crossed > 0) services.spawnHitText(ball, "+" + crossed, { color: "#ff9a8f" });
        lastReportedHp = ball.hp;
      }
      function canRegenNow() { return isCoolingDown(); }

      function startBoost(ball) {
        boostTimeLeft = RULES.boostDuration;
        cooldownLeft = 0;
        services.setSpeedMultiplier(RULES.boostSpeedMultiplier);
        trail = services.spawnAfterimageTrail({
          kind: "liangchen-ii-boost-trail",
          color: "#960c04",
          maxAlpha: 0.5,
          sampleLife: 0.3,
          maxSamples: 20,
          sampleInterval: 0.015,
          speedFloor: ball.speed,
          speedRamp: ball.speed * RULES.boostSpeedMultiplier - ball.speed
        }, { lifecycle: "owner-bound" });
      }

      function endBoost(ball) {
        boostTimeLeft = 0;
        cooldownLeft = RULES.boostCooldown;
        services.setSpeedMultiplier(1);
        if (trail && !trail.finished) trail.end(true);
        trail = null;
      }

      function emitTrail(ball) {
        if (!trail || trail.finished) return;
        trail.emit(ball.x, ball.y, ball.radius, {
          heading: Math.atan2(ball.vy, ball.vx),
          speed: Math.hypot(ball.vx, ball.vy)
        });
      }

      function advancePhase(ball, dt) {
        if (isBoosting()) {
          boostTimeLeft -= dt;
          emitTrail(ball);
          if (boostTimeLeft <= EPSILON) endBoost(ball);
        } else if (isCoolingDown()) {
          cooldownLeft -= dt;
          if (cooldownLeft <= EPSILON) cooldownLeft = 0;
        } else {
          startBoost(ball);
        }
      }

      return {
        update({ ball }, dt) {
          regen(ball, dt);
          advancePhase(ball, dt);
        },
        updateWhilePaused({ ball }, dt) {
          if (isBoosting()) {
            boostTimeLeft -= dt;
            if (boostTimeLeft <= EPSILON) endBoost(ball);
          } else if (isCoolingDown()) {
            cooldownLeft -= dt;
            if (cooldownLeft <= EPSILON) cooldownLeft = 0;
          }
        },
        getNextTransitionIn() {
          if (isBoosting()) return Math.max(EPSILON, boostTimeLeft);
          if (isCoolingDown()) return Math.max(EPSILON, cooldownLeft);
          return EPSILON;
        },
        onCollision(context, target) {
          context.services.dealDamage(target,
            isBoosting() ? RULES.boostBodyDamage : RULES.bodyDamage);
        },
        onDeath() {
          if (trail && !trail.finished) trail.end(true);
          trail = null;
        },
        onBorrowEnd() {
          boostTimeLeft = 0;
          cooldownLeft = 0;
          if (trail && !trail.finished) trail.end(true);
          trail = null;
        },
        getLiangchenIIState() {
          return {
            boostTimeLeft, cooldownLeft,
            regenRate: 0,
            isBoosting: isBoosting(),
            isCoolingDown: isCoolingDown()
          };
        }
      };
    }
  };

  registerBall(liangchenIIDefinition);
  return { liangchenIIDefinition, LIANGCHEN_II_RULES: RULES, regenRate };
});
