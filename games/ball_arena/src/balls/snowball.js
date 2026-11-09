(function initializeSnowball(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnowballPlugin({ registerBall, applyDamageReduction }) {
  // 速度 × 本体直径 = 6000，恒定：滚得越大越慢。
  const SPEED_DIAMETER_PRODUCT = 6000;
  const START_DIAMETER = 20;
  // 每移动 30 距离，直径 +1。
  const GROWTH_DISTANCE = 30;
  // 直径每增加 10，碰撞伤害 +1（开局直径 20 时是 1）。
  const DAMAGE_STEP_DIAMETER = 10;
  const BASE_COLLISION_DAMAGE = 1;
  // 减伤：开局 0%，每 +2 直径才 +1%，上限 99%。
  const DAMAGE_REDUCTION_STEP_DIAMETER = 2;
  const DAMAGE_REDUCTION_PER_STEP = 0.01;
  const DAMAGE_REDUCTION_CAP = 0.99;
  const SNOW_COLORS = Object.freeze(["#ffffff", "#eef7ff", "#d8ecff"]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function speedForDiameter(diameter) {
    return SPEED_DIAMETER_PRODUCT / diameter;
  }

  function collisionDamageFor(diameter) {
    const steps = Math.floor((diameter - START_DIAMETER) / DAMAGE_STEP_DIAMETER);
    return BASE_COLLISION_DAMAGE + Math.max(0, steps);
  }

  function damageReductionFor(diameter) {
    const steps = Math.max(
      0,
      Math.floor((diameter - START_DIAMETER) / DAMAGE_REDUCTION_STEP_DIAMETER)
    );
    return Math.min(DAMAGE_REDUCTION_CAP, steps * DAMAGE_REDUCTION_PER_STEP);
  }

  // 长大时的一圈雪屑：只做视觉，不参与任何判定。
  function createGrowthPuff(radius) {
    return {
      kind: "snowball-growth",
      life: 0.35,
      radius,
      draw({ effect }, context) {
        const progress = Math.min(1, effect.age / effect.life);
        context.save();
        context.translate(effect.x, effect.y);
        context.globalAlpha *= (1 - progress) * 0.7;
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(0, 0, effect.radius + progress * 8, 0, TWO_PI);
        context.stroke();
        context.restore();
      }
    };
  }

  const snowballDefinition = {
    id: "snowball",
    elementTags: Object.freeze(["cold"]),
    name: "雪球",
    englishName: "Snowball",
    color: "#ffffff",
    description: "滚动成长 / 越大越慢 / 体积减伤 / 碰撞伤害随体积提升",
    stats: {
      radius: START_DIAMETER / 2,
      speed: speedForDiameter(START_DIAMETER),
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      const state = {
        ball: null,
        diameter: START_DIAMETER,
        travel: 0,
        baseRadius: null
      };

      function rememberBall(context) {
        if (context && context.ball && state.ball !== context.ball) {
          state.ball = context.ball;
          if (state.baseRadius === null) {
            state.baseRadius = Number.isFinite(context.ball.radius)
              ? context.ball.radius
              : START_DIAMETER / 2;
          }
        }
        return state.ball;
      }

      // 直径 → 半径 + 引擎用的速度倍率（让碰撞归一化也用对速度）。
      // 体积速度是自身位移机制，所以走 setSpeedMultiplier 的自身通道；
      // 它和减速因子相乘，而不是互相覆盖。
      function applySize() {
        const ball = state.ball;
        if (!ball) return;
        ball.radius = state.diameter / 2;
        // Bounce velocity belongs to gravity and wall impulses, not rolling speed.
        if (services.isBounceMode && services.isBounceMode()) return;
        const baseSpeed = Number.isFinite(ball.speed) && ball.speed > EPSILON
          ? ball.speed
          : speedForDiameter(START_DIAMETER);
        const ratio = speedForDiameter(state.diameter) / baseSpeed;
        if (Math.abs(ball.speedMultiplierBase - ratio) > EPSILON) {
          services.setSpeedMultiplier(ratio);
        }
      }

      // 保持当前方向，把速度钉在 4500 / 直径。
      function applySpeed() {
        if (services.isBounceMode && services.isBounceMode()) return;
        const ball = state.ball;
        if (!ball) return;
        const magnitude = Math.hypot(ball.storedVx, ball.storedVy);
        if (magnitude <= EPSILON) {
          ball.vx = ball.storedVx || 0;
          ball.vy = ball.storedVy || 0;
          return;
        }
        const speed = ball.speed * ball.speedMultiplier;
        ball.storedVx = ball.storedVx / magnitude * speed;
        ball.storedVy = ball.storedVy / magnitude * speed;
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
      }

      function roll(context, dt) {
        const ball = rememberBall(context);
        if (!ball || ball.hp <= 0) return;
        const step = Math.max(0, dt);
        const moved = Math.hypot(ball.vx, ball.vy) * step;
        if (moved > EPSILON) {
          state.travel += moved;
          let grew = 0;
          while (state.travel + EPSILON >= GROWTH_DISTANCE) {
            state.travel -= GROWTH_DISTANCE;
            state.diameter += 1;
            grew += 1;
          }
          if (grew > 0) {
            applySize();
            services.spawnVisualEffect(
              createGrowthPuff(state.diameter / 2),
              { x: ball.x, y: ball.y }
            );
            services.spawnParticleBurst({
              x: ball.x,
              y: ball.y,
              count: 6 + grew,
              colors: SNOW_COLORS,
              minDiameter: 1,
              maxDiameter: 2.6,
              minSpeed: 16,
              maxSpeed: 60,
              life: 0.4,
              drag: 3
            });
          }
        }
        applySpeed();
      }

      return {
        onSpawn(context) {
          rememberBall(context);
          applySize();
        },
        update(context, dt) {
          roll(context, dt);
        },
        updateWhilePaused(context) {
          // 被控制时静止，不滚动也不成长，但速度倍率仍然跟着体积。
          rememberBall(context);
        },
        // 体积减伤：直径每 +1 减伤 +1%，上限 99%。
        onBeforeDamage(context, event) {
          if (!event || !event.actor || event.actor === context.ball) return event;
          const reduction = damageReductionFor(state.diameter);
          if (reduction <= 0) return event;
          return applyDamageReduction(event, reduction, Math.random);
        },
        onCollision(context, target) {
          if (!target || target.hp <= 0) return;
          if (context.blockedAtContact) return;
          const damage = collisionDamageFor(state.diameter);
          context.services.dealDamage(target, damage);
          const awayAngle = Math.atan2(
            target.y - context.ball.y,
            target.x - context.ball.x
          );
          context.services.spawnParticleBurst({
            x: (context.ball.x + target.x) / 2,
            y: (context.ball.y + target.y) / 2,
            count: 8,
            colors: SNOW_COLORS,
            minDiameter: 1,
            maxDiameter: 3,
            directionAngle: awayAngle,
            directionSpread: 1.2,
            minSpeed: 40,
            maxSpeed: 140,
            life: 0.5,
            drag: 2.8
          });
        },
        onBorrowEnd(context) {
          // Rion 借用结束：把球体尺寸还给本体（成长状态随借用一起丢弃）。
          if (context && context.ball && state.baseRadius !== null) {
            context.ball.radius = state.baseRadius;
          }
        },
        getSnowballState() {
          return {
            diameter: state.diameter,
            radius: state.diameter / 2,
            speed: speedForDiameter(state.diameter),
            collisionDamage: collisionDamageFor(state.diameter),
            damageReduction: damageReductionFor(state.diameter),
            travelToNextGrowth: Math.max(0, GROWTH_DISTANCE - state.travel)
          };
        }
      };
    }
  };

  registerBall(snowballDefinition);
  return {
    snowballDefinition,
    snowballSpeedForDiameter: speedForDiameter,
    snowballCollisionDamage: collisionDamageFor,
    snowballDamageReduction: damageReductionFor,
    SNOWBALL_SPEED_DIAMETER_PRODUCT: SPEED_DIAMETER_PRODUCT,
    SNOWBALL_START_DIAMETER: START_DIAMETER,
    SNOWBALL_GROWTH_DISTANCE: GROWTH_DISTANCE
  };
});
