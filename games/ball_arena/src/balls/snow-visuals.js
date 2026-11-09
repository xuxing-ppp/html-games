(function initializeSnowVisuals(root, factory) {
  // 雪球家族（雪花 / 雪仗）共用的弹道与雪系视效工具箱。
  // 预判拦截点复用流沙已经导出的那支折射预测，不再写第二份几何。
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/arena-geometry.js"), require("./quicksand.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnowVisualsPlugin({ resolveArenaGeometry, quicksandPredictTargetPosition }) {
  if (typeof quicksandPredictTargetPosition !== "function") {
    throw new Error("Snow visuals require quicksandPredictTargetPosition");
  }

  const SNOW_PALETTE = Object.freeze({
    core: "#ffffff",
    body: "#f4faff",
    shade: "#c9e0f2",
    rim: "#8ec5ea",
    deep: "#5ea3d6",
    mist: "#dcefff",
    glow: "#b7dcf5"
  });
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const LEAD_PASSES = 2;
  const SPIN_RATE = 6.5;
  const OUT_OF_ARENA_MARGIN = 2;
  // 拖尾统一档：短、淡、速度越高拉得越长，让 300 速的雪球自己画出一条雪线。
  const TRAIL_DEFAULTS = Object.freeze({
    sampleLife: 0.22,
    maxAlpha: 0.42,
    minScale: 0.24,
    blurRatio: 0.34,
    sampleInterval: 0.022,
    maxSamples: 14,
    widthRatio: 0.85,
    stretchGain: 1 / 190,
    maxStretch: 3.2,
    speedFloor: 120,
    speedRamp: 160
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    const magnitude = Math.hypot(x, y);
    if (magnitude > EPSILON) return { x: x / magnitude, y: y / magnitude };
    const fallback = Math.hypot(fallbackX, fallbackY) || 1;
    return { x: fallbackX / fallback, y: fallbackY / fallback };
  }

  // 预判拦截点：按飞行时间把目标速度外推到落点（路径含墙面反射），迭代两次收敛。
  // 雪球是单发 1.2 秒的节奏，照当前位置直投几乎必空，这里交给预判而不是制导硬拽。
  function aimWithLead(fromX, fromY, target, arenaSize, speed) {
    let aimX = target.x;
    let aimY = target.y;
    for (let pass = 0; pass < LEAD_PASSES; pass += 1) {
      const duration = Math.hypot(aimX - fromX, aimY - fromY) / speed;
      const predicted = quicksandPredictTargetPosition(target, arenaSize, duration);
      aimX = predicted.x;
      aimY = predicted.y;
    }
    return normalizeDirection(aimX - fromX, aimY - fromY);
  }

  // 轻微制导：每步朝目标偏转，速度大小恒定不变。turnRate 为 0 时是纯直线弹道。
  // 默认追的是预判拦截点；leadAim === false 时改为直追敌人当前位置（不带提前量）。
  function steerTowardTarget(entity, entityServices, dt) {
    const turnRate = entity.turnRate;
    if (!Number.isFinite(turnRate) || turnRate <= 0 || dt <= EPSILON) return;
    if (!entityServices || typeof entityServices.getOpponent !== "function") return;
    const target = entityServices.getOpponent();
    if (!target || target.hp <= 0) return;
    const desired = entity.leadAim === false
      ? normalizeDirection(target.x - entity.x, target.y - entity.y)
      : aimWithLead(entity.x, entity.y, target, entity.arenaSize, entity.speed);
    const current = Math.atan2(entity.vy, entity.vx);
    const wanted = Math.atan2(desired.y, desired.x);
    let delta = wanted - current;
    while (delta > Math.PI) delta -= TWO_PI;
    while (delta < -Math.PI) delta += TWO_PI;
    const heading = current + clamp(delta, -turnRate * dt, turnRate * dt);
    entity.vx = Math.cos(heading) * entity.speed;
    entity.vy = Math.sin(heading) * entity.speed;
  }

  function emitTrail(entity, entityServices) {
    if (!entity.trailConfig) return;
    if (!entity.trailReference) {
      if (!entityServices || typeof entityServices.spawnAfterimageTrail !== "function") return;
      entity.trailReference = entityServices.spawnAfterimageTrail(
        Object.assign({}, TRAIL_DEFAULTS, entity.trailConfig, { radius: entity.radius })
      );
    }
    entity.trailReference.emit(entity.x, entity.y, entity.radius, {
      heading: entity.heading,
      speed: entity.speed,
      angle: entity.spin
    });
  }

  // 硬收尾：命中、出界、本体消失时立刻清掉尾迹，不留一条停住的雪雾。
  function retireProjectile(entity) {
    entity.entityActive = false;
    if (!entity.trailReference) return;
    entity.trailReference.end(true);
    entity.trailReference = null;
  }

  function paintSnowball(canvas, entity) {
    const radius = entity.radius;
    const color = entity.color || SNOW_PALETTE.core;
    if (!canvas || typeof canvas.arc !== "function") return;
    const baseAlpha = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
    canvas.save();
    // 外圈冷光：小雪球（直径 3）靠它才在雪白战场上看得见。
    canvas.globalAlpha = baseAlpha * 0.34;
    canvas.fillStyle = SNOW_PALETTE.glow;
    canvas.beginPath();
    canvas.arc(entity.x, entity.y, radius * 2.1, 0, TWO_PI);
    canvas.fill();
    // 球体
    canvas.globalAlpha = baseAlpha;
    canvas.fillStyle = color;
    canvas.beginPath();
    canvas.arc(entity.x, entity.y, radius, 0, TWO_PI);
    canvas.fill();
    canvas.strokeStyle = SNOW_PALETTE.rim;
    canvas.lineWidth = Math.min(1, radius * 0.42);
    canvas.beginPath();
    canvas.arc(entity.x, entity.y, radius - canvas.lineWidth / 2, 0, TWO_PI);
    canvas.stroke();
    // 自转的冰晶高光：小雪球只画一颗，大雪球画三颗。
    const sparkles = radius >= 3 ? 3 : 1;
    canvas.fillStyle = SNOW_PALETTE.core;
    for (let index = 0; index < sparkles; index += 1) {
      const angle = entity.spin + index * TWO_PI / sparkles;
      const distance = radius * 0.42;
      const size = Math.max(0.9, radius * 0.3);
      canvas.fillRect(
        Math.round(entity.x + Math.cos(angle) * distance - size / 2),
        Math.round(entity.y + Math.sin(angle) * distance - size / 2),
        size,
        size
      );
    }
    canvas.restore();
  }

  // 命中/出手的雪粉：扩散环 + 四散雪粒，走既有粒子系统。
  function spawnSnowBurst(entityServices, options = {}) {
    if (!entityServices || typeof entityServices.spawnParticleBurst !== "function") return null;
    const x = Number.isFinite(options.x) ? options.x : 0;
    const y = Number.isFinite(options.y) ? options.y : 0;
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const palette = options.palette || [
      SNOW_PALETTE.core, SNOW_PALETTE.mist, SNOW_PALETTE.rim, SNOW_PALETTE.glow
    ];
    return entityServices.spawnParticleBurst({
      x,
      y,
      kind: options.kind || "snow-puff",
      colors: palette,
      count: Math.max(2, Math.round((options.count || 10) * scale)),
      minDiameter: 1.4 * scale,
      maxDiameter: 4.2 * scale,
      minSpeed: 46 * scale,
      maxSpeed: (options.fast ? 210 : 150) * scale,
      directionAngle: Number.isFinite(options.directionAngle) ? options.directionAngle : undefined,
      directionSpread: options.directionSpread || Math.PI,
      initialRadius: 2 * scale,
      life: 0.34 + 0.08 * scale,
      drag: 3.2,
      ring: options.ring === false ? null : {
        color: options.ringColor || SNOW_PALETTE.core,
        lineWidth: 1.1 * scale,
        startRadius: 2 * scale,
        endRadius: (options.ringRadius || 20) * scale
      }
    });
  }

  // 命中点的霜爆：粒子之外的六角冰晶闪，交给视效组合一次性生成。
  function createFrostBurst(x, y, options = {}) {
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const angle = Number.isFinite(options.angle) ? options.angle : 0;
    const big = options.big === true;
    return {
      kind: options.kind || "snow-frost-burst",
      life: big ? 0.5 : 0.32,
      x,
      y,
      angle,
      scale,
      big,
      draw({ effect }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const progress = clamp(effect.age / effect.life, 0, 1);
        const alpha = 1 - progress;
        const baseAlpha = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
        canvas.save();
        canvas.globalAlpha = baseAlpha * alpha * 0.9;
        canvas.globalCompositeOperation = "lighter";
        const radius = (big ? 16 : 10) * effect.scale * (0.35 + progress);
        canvas.strokeStyle = SNOW_PALETTE.core;
        canvas.lineWidth = Math.max(0.7, (big ? 1.8 : 1.2) * effect.scale * alpha);
        canvas.beginPath();
        canvas.arc(effect.x, effect.y, radius, 0, TWO_PI);
        canvas.stroke();
        // 六角冰针：沿六个方向炸开，长度随进度伸长、随进度变淡。
        canvas.strokeStyle = SNOW_PALETTE.mist;
        canvas.lineWidth = Math.max(0.6, 0.9 * effect.scale);
        for (let arm = 0; arm < 6; arm += 1) {
          const armAngle = effect.angle + arm * Math.PI / 3;
          const inner = radius * 0.35;
          const outer = radius * (0.9 + (arm % 2) * 0.22);
          canvas.beginPath();
          canvas.moveTo(
            effect.x + Math.cos(armAngle) * inner,
            effect.y + Math.sin(armAngle) * inner
          );
          canvas.lineTo(
            effect.x + Math.cos(armAngle) * outer,
            effect.y + Math.sin(armAngle) * outer
          );
          canvas.stroke();
        }
        canvas.restore();
      }
    };
  }

  // 命中点：霜爆 + 雪粉一次生成，两个子视效各自带寿命。
  function spawnSnowImpact(entityServices, options = {}) {
    if (!entityServices || typeof entityServices.spawnVisualComposition !== "function") return null;
    const x = Number.isFinite(options.x) ? options.x : 0;
    const y = Number.isFinite(options.y) ? options.y : 0;
    const scale = Number.isFinite(options.scale) ? options.scale : 1;
    const angle = Number.isFinite(options.angle) ? options.angle : 0;
    const frozen = options.frozen === true;
    return entityServices.spawnVisualComposition([
      {
        factory: () => createFrostBurst(x, y, {
          scale: frozen ? scale * 1.5 : scale,
          angle,
          big: frozen,
          kind: options.burstKind || "snow-frost-burst"
        }),
        overrides: { drawLayer: "foreground" }
      },
      {
        particleBurst: {
          x,
          y,
          kind: options.kind || "snow-impact",
          colors: frozen
            ? [SNOW_PALETTE.core, SNOW_PALETTE.mist, SNOW_PALETTE.rim, "#9fd8ff"]
            : [SNOW_PALETTE.core, SNOW_PALETTE.mist, SNOW_PALETTE.glow],
          count: Math.round((frozen ? 16 : 9) * scale),
          minDiameter: 1.2 * scale,
          maxDiameter: 3.8 * scale,
          minSpeed: 50 * scale,
          maxSpeed: (frozen ? 230 : 150) * scale,
          directionAngle: angle,
          directionSpread: Math.PI * 0.92,
          initialRadius: 2,
          life: frozen ? 0.42 : 0.3,
          drag: 3.4,
          ring: frozen
            ? {
                color: SNOW_PALETTE.core,
                lineWidth: 1.4 * scale,
                startRadius: 2,
                endRadius: 26 * scale
              }
            : null
        }
      }
    ]);
  }

  // 减速目标的霜罩：一圈会呼吸的霜环 + 环上六颗冰晶，画在受害者身上。
  function drawFrostOverlay(canvas, ball, options = {}) {
    if (!canvas || typeof canvas.arc !== "function" || !ball) return;
    const elapsed = Math.max(0, Number.isFinite(options.elapsed) ? options.elapsed : 0);
    const strength = clamp(Number.isFinite(options.strength) ? options.strength : 1, 0, 1);
    const baseAlpha = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 6.5);
    canvas.save();
    canvas.globalAlpha = baseAlpha * (0.2 + 0.22 * pulse) * (0.35 + 0.65 * strength);
    canvas.strokeStyle = SNOW_PALETTE.mist;
    canvas.lineWidth = 1.3;
    canvas.beginPath();
    canvas.arc(ball.x, ball.y, ball.radius + 2.4, 0, TWO_PI);
    canvas.stroke();
    canvas.globalAlpha = baseAlpha * (0.42 + 0.3 * pulse) * (0.4 + 0.6 * strength);
    canvas.fillStyle = SNOW_PALETTE.core;
    for (let index = 0; index < 6; index += 1) {
      const angle = index * Math.PI / 3 + elapsed * 1.1;
      const distance = ball.radius + 4.4;
      const size = index % 2 === 0 ? 2 : 1;
      canvas.fillRect(
        Math.round(ball.x + Math.cos(angle) * distance - size / 2),
        Math.round(ball.y + Math.sin(angle) * distance - size / 2),
        size,
        size
      );
    }
    canvas.restore();
  }

  /**
   * 雪球弹体：直线（或轻微制导）飞行 + 扫掠命中 + 残影拖尾。
   * 命中判定与结算分离——本工厂只负责"打到了谁"，伤害/状态由 onHit 决定。
   */
  function createSnowProjectile(config) {
    const options = config || {};
    const kind = options.kind;
    if (typeof kind !== "string" || !kind) {
      throw new TypeError("Snow projectile requires a kind");
    }
    if (typeof options.onHit !== "function") {
      throw new TypeError("Snow projectile requires an onHit handler");
    }
    if (!Number.isFinite(options.radius) || options.radius <= 0) {
      throw new TypeError("Snow projectile requires a positive radius");
    }
    if (!Number.isFinite(options.life) || options.life <= 0) {
      throw new TypeError("Snow projectile requires a positive life");
    }
    if (!Number.isFinite(options.speed) || options.speed <= 0) {
      throw new TypeError("Snow projectile requires a positive speed");
    }
    const direction = normalizeDirection(options.directionX, options.directionY);
    const startX = Number.isFinite(options.x) ? options.x : 0;
    const startY = Number.isFinite(options.y) ? options.y : 0;
    const paint = typeof options.draw === "function" ? options.draw : paintSnowball;

    return {
      kind,
      combatKind: "projectile",
      attackTags: ["cold"],
      replayDamage: Number.isFinite(options.replayDamage) ? options.replayDamage : 1,
      radius: options.radius,
      color: options.color || SNOW_PALETTE.core,
      life: options.life,
      x: startX,
      y: startY,
      previousX: startX,
      previousY: startY,
      speed: options.speed,
      turnRate: Number.isFinite(options.turnRate) ? options.turnRate : 0,
      // 默认 true：沿用预判拦截点。显式传 false 才是"朝敌方方向"直追。
      leadAim: options.leadAim !== false,
      arenaSize: options.arenaSize || 200,
      vx: direction.x * options.speed,
      vy: direction.y * options.speed,
      heading: Math.atan2(direction.y, direction.x),
      spin: 0,
      trailConfig: options.trail || null,
      trailReference: null,
      update({ entity, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const fromX = entity.x;
        const fromY = entity.y;
        steerTowardTarget(entity, entityServices, elapsed);
        entity.x += entity.vx * elapsed;
        entity.y += entity.vy * elapsed;
        entity.spin += SPIN_RATE * elapsed;
        entity.heading = Math.atan2(entity.vy, entity.vx);
        emitTrail(entity, entityServices);
        // 扫掠命中：这一步走过的整段都要算，300 速不会穿人。
        const hit = entityServices.getFirstEnemyHit(
          fromX, fromY, entity.x, entity.y, entity.radius
        );
        if (hit) {
          retireProjectile(entity);
          options.onHit(entity, hit, entityServices);
          return;
        }
        const margin = entity.radius + OUT_OF_ARENA_MARGIN;
        if (
          !resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, margin)
        ) {
          retireProjectile(entity);
        }
      },
      draw({ entity }, canvas) {
        paint(canvas, entity);
      }
    };
  }

  return {
    SNOW_PALETTE,
    SNOW_TRAIL_DEFAULTS: TRAIL_DEFAULTS,
    aimWithLead,
    normalizeDirection,
    createSnowProjectile,
    createFrostBurst,
    spawnSnowBurst,
    spawnSnowImpact,
    drawFrostOverlay,
    paintSnowball
  };
});
