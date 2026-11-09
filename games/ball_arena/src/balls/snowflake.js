(function initializeSnowflake(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("./snow-visuals.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnowflakePlugin({ resolveArenaGeometry,
  registerBall,
  SNOW_PALETTE,
  normalizeDirection,
  createSnowProjectile,
  spawnSnowBurst,
  spawnSnowImpact,
  drawFrostOverlay
}) {
  if (typeof createSnowProjectile !== "function" || typeof normalizeDirection !== "function") {
    throw new Error("雪花需要先加载 src/balls/snow-visuals.js");
  }
  // 蓝白纯色本体：只画颜色，不叠花纹。
  const SNOWFLAKE_COLOR = "#d8ecff";
  const THROW_INTERVAL = 1.2;
  // 小雪球：直径 8、速度 300、基础 1 伤。
  const PELLET_RADIUS = 4;
  const PELLET_SPEED = 300;
  const PELLET_DAMAGE = 1;
  const PELLET_LIFE = 1.4;
  // 打在已被大雪花罩住的敌人身上：伤害抬到 8，并且不再铺新的大雪花。
  const CHARGED_DAMAGE = 8;
  // 大雪花直径 60，落地存活 0.6 秒。
  const WREATH_RADIUS = 30;
  const WREATH_LIFE = 0.6;
  const WREATH_SPIN = 0.8;
  const WREATH_GROW = 0.12;
  const WREATH_FADE = 0.18;
  // 圈内敌人移速与行为节奏都降到原来的 25%（即减速 75%）。
  // 圈内每步刷新，出圈立刻回温。
  const SLOW_FACTOR = 0.25;
  const ATTACK_PERIOD_SCALE = 1 / SLOW_FACTOR;
  // 冰寒余温：踩在雪花里每步刷新一次，雪花化掉后还会留这么久。
  // 1.2 秒的投掷间隔比 0.6 秒的雪花寿命长——如果减速严格跟着雪花走，
  // 「此时再击中→8伤」这条分支在实战里永远打不出来。留 0.7 秒余温，
  // 「1 → 8 → 1 → 8」的循环才成立（想让 8 伤只在雪花还在时生效：
  // 把它调成 0，同时把 THROW_INTERVAL 压到 0.6 以内）。
  const CHILL_DURATION = 0.7;
  const CHILL_EFFECT_ID = "snowflake-chill";
  const PELLET_KIND = "snowflake-pellet";
  const PELLET_TRAIL_KIND = "snowflake-pellet-trail";
  const THROW_BURST_KIND = "snowflake-throw";
  const IMPACT_BURST_KIND = "snowflake-impact";
  const WREATH_KIND = "snowflake-wreath";
  const WREATH_BURST_KIND = "snowflake-wreath-burst";
  // 出手不再打提前量（直朝敌人当前位置），飞行中仍留一点朝当前位置的修正余量。
  const TURN_RATE = 2.4;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  // 大雪花罩住的敌人：身上带的是这一条冰寒。
  function isChilled(target) {
    return Boolean(target && target.effects && target.effects.has(CHILL_EFFECT_ID));
  }

  function createChillEffect() {
    return {
      id: CHILL_EFFECT_ID,
      duration: CHILL_DURATION,
      speedFactor: SLOW_FACTOR,
      attackPeriodScale: ATTACK_PERIOD_SCALE,
      attackTags: ["cold"],
      combatKind: "skill",
      onApply({ effect, game }) {
        if (!Number.isFinite(effect.startedAt)) effect.startedAt = game.time;
      },
      draw({ ball, effect, game }, canvas) {
        drawFrostOverlay(canvas, ball, {
          elapsed: Math.max(0, game.time - (effect.startedAt || 0)),
          strength: 1
        });
      }
    };
  }

  // 大雪花：直径 60 的领域，站在里面的敌人移速与行动节奏都降到 25%。
  function createWreath(x, y) {
    return {
      kind: WREATH_KIND,
      combatKind: "zone",
      life: WREATH_LIFE,
      lifecycle: "independent",
      radius: WREATH_RADIUS,
      x,
      y,
      spin: 0,
      update({ entity, services: zoneServices }, dt) {
        entity.spin += WREATH_SPIN * Math.max(0, dt);
        zoneServices.forEachEnemy((enemy) => {
          if (Math.hypot(enemy.x - entity.x, enemy.y - entity.y) > WREATH_RADIUS) return;
          zoneServices.applyEffect(enemy, createChillEffect());
        });
      },
      draw({ entity }, canvas) {
        drawWreath(canvas, entity);
      }
    };
  }

  function drawWreath(canvas, wreath) {
    if (!canvas || typeof canvas.arc !== "function") return;
    const grow = easeOutCubic(clamp(wreath.age / WREATH_GROW, 0, 1));
    const fade = clamp((wreath.life - wreath.age) / WREATH_FADE, 0, 1);
    const alpha = grow * fade;
    if (alpha <= 0) return;
    const radius = WREATH_RADIUS * (0.72 + 0.28 * grow);
    const baseAlpha = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
    canvas.save();
    // 领域底盘：中心淡、边缘更亮，边界就是判定半径。
    const gradient = canvas.createRadialGradient(
      wreath.x, wreath.y, radius * 0.1,
      wreath.x, wreath.y, radius
    );
    gradient.addColorStop(0, "rgba(216, 236, 255, 0.1)");
    gradient.addColorStop(0.72, "rgba(216, 236, 255, 0.16)");
    gradient.addColorStop(1, "rgba(236, 247, 255, 0.3)");
    canvas.globalAlpha = baseAlpha * alpha;
    canvas.fillStyle = gradient;
    canvas.beginPath();
    canvas.arc(wreath.x, wreath.y, radius, 0, TWO_PI);
    canvas.fill();
    canvas.strokeStyle = "rgba(240, 250, 255, 0.85)";
    canvas.lineWidth = 1.3;
    canvas.beginPath();
    canvas.arc(wreath.x, wreath.y, radius - 0.65, 0, TWO_PI);
    canvas.stroke();

    // 六角雪花本体：六条主枝 + 每枝两对小叉。
    canvas.translate(wreath.x, wreath.y);
    canvas.rotate(wreath.spin);
    canvas.globalAlpha = baseAlpha * alpha * 0.9;
    canvas.strokeStyle = SNOW_PALETTE.core;
    canvas.lineWidth = 1.9;
    canvas.lineCap = "round";
    const armLength = radius * 0.86;
    for (let arm = 0; arm < 6; arm += 1) {
      const armAngle = arm * Math.PI / 3;
      const tipX = Math.cos(armAngle) * armLength;
      const tipY = Math.sin(armAngle) * armLength;
      canvas.beginPath();
      canvas.moveTo(0, 0);
      canvas.lineTo(tipX, tipY);
      canvas.stroke();
      for (const [ratio, branch] of [[0.42, 0.26], [0.68, 0.2]]) {
        const baseX = Math.cos(armAngle) * armLength * ratio;
        const baseY = Math.sin(armAngle) * armLength * ratio;
        const branchLength = armLength * branch;
        canvas.lineWidth = 1.4;
        for (const side of [-1, 1]) {
          const branchAngle = armAngle + side * Math.PI / 4.5;
          canvas.beginPath();
          canvas.moveTo(baseX, baseY);
          canvas.lineTo(
            baseX + Math.cos(branchAngle) * branchLength,
            baseY + Math.sin(branchAngle) * branchLength
          );
          canvas.stroke();
        }
        canvas.lineWidth = 1.9;
      }
    }
    canvas.globalAlpha = baseAlpha * alpha;
    canvas.beginPath();
    canvas.arc(0, 0, radius * 0.09, 0, TWO_PI);
    canvas.fillStyle = SNOW_PALETTE.core;
    canvas.fill();
    canvas.restore();
  }

  // 小雪球命中：先按"是否已被大雪花罩住"定伤害，再决定铺不铺新的大雪花。
  function resolvePelletHit(pellet, target, entityServices) {
    const frozen = isChilled(target);
    const damage = frozen ? CHARGED_DAMAGE : PELLET_DAMAGE;
    const landed = entityServices.dealDamage(target, damage) === true;
    spawnSnowImpact(entityServices, {
      x: pellet.x,
      y: pellet.y,
      angle: pellet.heading,
      scale: frozen ? 1.15 : 0.9,
      frozen,
      kind: IMPACT_BURST_KIND,
      burstKind: IMPACT_BURST_KIND + "-frost"
    });
    // 只有真正打中的那一下才铺大雪花：被无敌/减伤挡掉不算命中。
    if (frozen || !landed) return;
    entityServices.spawnCombatEntity(createWreath(target.x, target.y));
    spawnSnowBurst(entityServices, {
      x: target.x,
      y: target.y,
      kind: WREATH_BURST_KIND,
      count: 14,
      scale: 1.3,
      ringRadius: WREATH_RADIUS,
      ring: true,
      ringColor: SNOW_PALETTE.mist
    });
  }

  const snowflakeDefinition = {
    id: "snowflake",
    elementTags: Object.freeze(["cold"]),
    name: "雪花",
    englishName: "Snowflake",
    color: SNOWFLAKE_COLOR,
    description: "每1.2秒掷出直径8雪球 / 命中-1并在原地落直径60大雪花0.6秒（圈内行动降至25%） / 打在圈内敌人身上-8且不再落雪",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 3.6,
    createBehavior(services) {
      let throwTimer = THROW_INTERVAL;

      function throwPellet(context) {
        const ball = context.ball;
        const target = services.getOpponent();
        if (!target || target.hp <= 0) return false;
        const arenaSize = context.game.arena || context.game.arenaSize;
        // 朝敌方当前位置直射，不再外推拦截点（与雪仗同一套出手方式）。
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
          replayDamage: CHARGED_DAMAGE,
          turnRate: TURN_RATE,
          // 制导目标同样是敌人当前位置，不追预判点。
          leadAim: false,
          arenaSize,
          trail: { kind: PELLET_TRAIL_KIND, color: SNOW_PALETTE.mist, maxAlpha: 0.5 },
          onHit: resolvePelletHit
        }));
        spawnSnowBurst(services, {
          x: startX,
          y: startY,
          kind: THROW_BURST_KIND,
          count: 7,
          scale: 0.9,
          directionAngle: Math.atan2(direction.y, direction.x),
          directionSpread: Math.PI * 0.6,
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
        getSnowflakeState() {
          return { throwTimer };
        }
      };
    }
  };

  registerBall(snowflakeDefinition);
  return {
    snowflakeDefinition,
    SNOWFLAKE_CONSTANTS: {
      SNOWFLAKE_COLOR,
      THROW_INTERVAL,
      PELLET_RADIUS,
      PELLET_SPEED,
      PELLET_DAMAGE,
      PELLET_LIFE,
      CHARGED_DAMAGE,
      WREATH_RADIUS,
      WREATH_LIFE,
      SLOW_FACTOR,
      ATTACK_PERIOD_SCALE,
      CHILL_DURATION,
      CHILL_EFFECT_ID,
      PELLET_KIND,
      PELLET_TRAIL_KIND,
      WREATH_KIND,
      WREATH_BURST_KIND,
      IMPACT_BURST_KIND,
      TURN_RATE
    }
  };
});
