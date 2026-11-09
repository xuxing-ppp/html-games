(function initializeSnowFight(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("./snow-visuals.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnowFightPlugin({ resolveArenaGeometry,
  registerBall,
  SNOW_PALETTE,
  normalizeDirection,
  createSnowProjectile,
  spawnSnowBurst,
  spawnSnowImpact,
  drawFrostOverlay
}) {
  if (typeof createSnowProjectile !== "function" || typeof normalizeDirection !== "function") {
    throw new Error("雪仗需要先加载 src/balls/snow-visuals.js");
  }
  // 白色纯色本体。
  const SNOW_FIGHT_COLOR = "#ffffff";
  const THROW_INTERVAL = 1.2;
  // 小雪弹：直径 3、速度 300。
  const PELLET_RADIUS = 1.5;
  const PELLET_SPEED = 300;
  const PELLET_LIFE = 1.4;
  // 初始 1 伤，每命中一次下一次 +1（连击越高，下一发越疼）。
  const BASE_DAMAGE = 1;
  const DAMAGE_STEP = 1;
  // 行动速度（行为 + 移速）压到 50%，之后每秒恢复 10% —— 5 秒回到原速。
  const SLOW_FACTOR = 0.5;
  const SLOW_RECOVERY_PER_SECOND = 0.1;
  const SLOW_DURATION = SLOW_FACTOR / SLOW_RECOVERY_PER_SECOND;
  const CHILL_EFFECT_ID = "snow-fight-chill";
  const PELLET_KIND = "snow-fight-pellet";
  const PELLET_TRAIL_KIND = "snow-fight-pellet-trail";
  const THROW_BURST_KIND = "snow-fight-throw";
  const IMPACT_BURST_KIND = "snow-fight-impact";
  const TURN_RATE = 0;
  const EPSILON = 1e-9;

  // 行动迟缓：移速与行为节奏同降，且每秒回一点；再命中一次直接打回 50%。
  function createChillEffect() {
    return {
      id: CHILL_EFFECT_ID,
      duration: SLOW_DURATION,
      speedFactor: SLOW_FACTOR,
      attackPeriodScale: 1 / SLOW_FACTOR,
      attackTags: ["cold"],
      combatKind: "skill",
      slowAmount: SLOW_FACTOR,
      onApply({ effect, game }) {
        effect.startedAt = game.time;
        effect.slowAmount = SLOW_FACTOR;
        effect.speedFactor = SLOW_FACTOR;
        effect.attackPeriodScale = 1 / SLOW_FACTOR;
      },
      update({ effect, game }) {
        const elapsed = Math.max(0, game.time - (effect.startedAt || 0));
        const factor = Math.min(1, SLOW_FACTOR + elapsed * SLOW_RECOVERY_PER_SECOND);
        effect.slowAmount = Math.max(0, 1 - factor);
        effect.speedFactor = factor;
        effect.attackPeriodScale = 1 / factor;
      },
      draw({ ball, effect, game }, canvas) {
        const elapsed = Math.max(0, game.time - (effect.startedAt || 0));
        drawFrostOverlay(canvas, ball, {
          elapsed,
          strength: effect.slowAmount / SLOW_FACTOR
        });
      }
    };
  }

  // 命中：伤害取"当前这一发"的数值，落地后下一发 +1，并给对方挂上迟缓。
  function resolvePelletHit(pellet, target, entityServices, volley) {
    const damage = volley.nextHitDamage;
    const landed = entityServices.dealDamage(target, damage) === true;
    spawnSnowImpact(entityServices, {
      x: pellet.x,
      y: pellet.y,
      angle: pellet.heading,
      scale: 0.85,
      kind: IMPACT_BURST_KIND,
      burstKind: IMPACT_BURST_KIND + "-frost"
    });
    if (!landed) return;
    volley.hits += 1;
    volley.nextHitDamage = damage + DAMAGE_STEP;
    entityServices.applyEffect(target, createChillEffect());
  }

  const snowFightDefinition = {
    id: "snowFight",
    elementTags: Object.freeze(["cold"]),
    name: "雪仗",
    englishName: "Snow Fight",
    color: SNOW_FIGHT_COLOR,
    description: "每1.2秒掷出直径3雪球 / 命中后敌方行动速度降至50%并每秒回10% / 每命中一次下一发+1伤（初始1）",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 3.6,
    createBehavior(services) {
      const volley = { nextHitDamage: BASE_DAMAGE, hits: 0 };
      let throwTimer = THROW_INTERVAL;

      function throwPellet(context) {
        const ball = context.ball;
        const target = services.getOpponent();
        if (!target || target.hp <= 0) return false;
        const arenaSize = context.game.arena || context.game.arenaSize;
        const direction = normalizeDirection(target.x - ball.x, target.y - ball.y);
        const muzzle = ball.radius + PELLET_RADIUS + 1.5;
        const startX = ball.x + direction.x * muzzle;
        const startY = ball.y + direction.y * muzzle;
        services.spawnProjectile(createSnowProjectile({
          kind: PELLET_KIND,
          x: startX,
          y: startY,
          directionX: direction.x,
          directionY: direction.y,
          speed: PELLET_SPEED,
          radius: PELLET_RADIUS,
          life: PELLET_LIFE,
          color: SNOW_PALETTE.core,
          replayDamage: volley.nextHitDamage,
          turnRate: TURN_RATE,
          arenaSize,
          trail: {
            kind: PELLET_TRAIL_KIND,
            color: SNOW_PALETTE.body,
            maxAlpha: 0.55,
            maxSamples: 16,
            widthRatio: 0.7
          },
          onHit: (pellet, hitTarget, entityServices) => (
            resolvePelletHit(pellet, hitTarget, entityServices, volley)
          )
        }));
        spawnSnowBurst(services, {
          x: startX,
          y: startY,
          kind: THROW_BURST_KIND,
          count: 6,
          scale: 0.8,
          directionAngle: Math.atan2(direction.y, direction.x),
          directionSpread: Math.PI * 0.55,
          ring: false
        });
        return true;
      }

      return {
        update(context, dt) {
          throwTimer -= Math.max(0, Number.isFinite(dt) ? dt : 0);
          if (throwTimer > EPSILON) return;
          throwTimer = THROW_INTERVAL;
          throwPellet(context);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, throwTimer);
        },
        getSnowFightState() {
          return {
            throwTimer,
            nextHitDamage: volley.nextHitDamage,
            hits: volley.hits
          };
        }
      };
    }
  };

  registerBall(snowFightDefinition);
  return {
    snowFightDefinition,
    SNOW_FIGHT_CONSTANTS: {
      SNOW_FIGHT_COLOR,
      THROW_INTERVAL,
      PELLET_RADIUS,
      PELLET_SPEED,
      PELLET_LIFE,
      BASE_DAMAGE,
      DAMAGE_STEP,
      SLOW_FACTOR,
      SLOW_RECOVERY_PER_SECOND,
      SLOW_DURATION,
      CHILL_EFFECT_ID,
      PELLET_KIND,
      PELLET_TRAIL_KIND,
      IMPACT_BURST_KIND,
      TURN_RATE
    }
  };
});
