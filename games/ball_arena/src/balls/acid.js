(function initializeAcid(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      require("../core/ball-registry.js"),
      require("../core/arena-geometry.js"),
      require("../core/sprite-cache.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAcidPlugin({ registerBall, createArenaGeometry, createSpriteCache, resolveDeviceScale }) {
  const ACID_INTERVAL = 0.8;
  const ACID_RADIUS = 3;
  const ACID_PLACEMENT_RADIUS = 50;
  const ACID_TRAVEL_DURATION = 0.1;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const POISON_TICK_INTERVAL = 0.4;
  const POISON_TICK_COUNT = 2;
  const POISON_DAMAGE = 3;
  // 命中那一刻直接扣的这一份：中毒两跳之外的那一口。
  const CONTACT_DAMAGE = 3;
  const POISON_MIN_SPEED_FACTOR = 0.2;
  const POISON_DURATION = POISON_TICK_INTERVAL * POISON_TICK_COUNT;
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;

  // 参考视频里的酸斑：深绿酸底、暗描边、亮黄绿酸芯与外圈小白绿高光。
  const SPLAT_OUTLINE = "#0d4a18";
  const SPLAT_BASE = "#2f7d2c";
  const SPLAT_MID = "#59c93f";
  const SPLAT_CORE = "#a9f262";
  const SPLAT_GLINT = "#e2ffab";
  const SPLASH_COLORS = Object.freeze(["#d9ff9e", "#9ff066", "#59c93f"]);
  const ACID_SPLAT_VARIANTS = 6;
  const ACID_SPLAT_SIZE = 18;
  const ACID_SPLAT_BASE_RADIUS = 4.1;
  const ACID_SPLAT_POP_DURATION = 0.16;
  const POISON_WASH_RGB = "124, 190, 42";
  // 血量数字在球心：中心只留一层很淡的染色，外圈才是实色冲洗。
  const POISON_CENTER_CLEAR = 0.55;
  const POISON_CENTER_ALPHA = 0.1;
  const POISON_BUBBLE_COUNT = 5;

  const acidSplatSprites = createSpriteCache();

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 纯函数的视觉种子：不消耗战斗随机，也不受 Math.random 影响。
  function visualUnit(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function sweptCirclesOverlap(target, startX, startY, endX, endY, radius) {
    const targetStartX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const targetStartY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const relativeStartX = targetStartX - startX;
    const relativeStartY = targetStartY - startY;
    const relativeDeltaX = (target.x - endX) - relativeStartX;
    const relativeDeltaY = (target.y - endY) - relativeStartY;
    const relativeLengthSquared =
      relativeDeltaX * relativeDeltaX + relativeDeltaY * relativeDeltaY;
    const progress = relativeLengthSquared <= EPSILON
      ? 0
      : clamp(
        -(relativeStartX * relativeDeltaX + relativeStartY * relativeDeltaY) /
          relativeLengthSquared,
        0,
        1
      );
    const closestX = relativeStartX + relativeDeltaX * progress;
    const closestY = relativeStartY + relativeDeltaY * progress;
    const combinedRadius = target.radius + radius;
    return closestX * closestX + closestY * closestY <=
      combinedRadius * combinedRadius + EPSILON;
  }

  function paintSplatBlob(context, centerX, centerY, radius, lobes, phase) {
    const samples = 48;
    for (let index = 0; index <= samples; index += 1) {
      const angle = index / samples * TAU;
      const distance = radius * (0.86 + 0.14 * Math.cos(lobes * angle + phase));
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }

  // 酸斑是静态形状：每个变体烘焙一次，绘制时只做一次 drawImage。
  function paintAcidSplat(context, centerX, centerY, size, variant) {
    const unit = size / ACID_SPLAT_SIZE;
    const base = ACID_SPLAT_BASE_RADIUS * unit;
    const lobes = 5 + (variant % 3);
    const phase = variant * 1.37;
    const tailAngle = variant * 2.399 + 0.6;
    const samples = 60;

    context.beginPath();
    for (let index = 0; index <= samples; index += 1) {
      const angle = index / samples * TAU;
      const lobe = 0.86 + 0.14 * Math.cos(lobes * angle + phase);
      const delta = Math.atan2(
        Math.sin(angle - tailAngle),
        Math.cos(angle - tailAngle)
      );
      const tail = Math.exp(-(delta * delta) / (2 * 0.3 * 0.3));
      const distance = base * lobe + base * 0.42 * tail;
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fillStyle = SPLAT_BASE;
    context.fill();
    context.lineWidth = 0.55 * unit;
    context.strokeStyle = SPLAT_OUTLINE;
    context.stroke();

    // 偏心的亮绿酸芯，让飞溅看起来是湿的而不是一块实心色块。
    context.beginPath();
    paintSplatBlob(
      context,
      centerX + base * 0.12,
      centerY - base * 0.1,
      base * 0.72, 5, phase + 0.9
    );
    context.fillStyle = SPLAT_MID;
    context.fill();

    context.beginPath();
    paintSplatBlob(
      context,
      centerX - base * 0.1,
      centerY + base * 0.12,
      base * 0.43, 4, phase + 2.1
    );
    context.fillStyle = SPLAT_CORE;
    context.fill();

    // 酸芯上的高光点。
    context.fillStyle = SPLAT_GLINT;
    for (let index = 0; index < 3; index += 1) {
      const angle = visualUnit(variant * 7.1 + index * 3.7) * TAU;
      const distance = base * (0.08 + 0.34 * visualUnit(variant * 3.3 + index * 5.1));
      const dot = base * (0.07 + 0.05 * visualUnit(variant * 9.7 + index));
      context.beginPath();
      context.arc(
        centerX + Math.cos(angle) * distance,
        centerY + Math.sin(angle) * distance,
        dot, 0, TAU
      );
      context.fill();
    }

    // 溅出去的小酸滴。
    for (let index = 0; index < 2; index += 1) {
      const angle = tailAngle + 1.6 + index * 2.1 + variant * 0.37;
      const distance = base * (1.28 + index * 0.24);
      const dot = base * (0.14 + 0.06 * visualUnit(variant * 4.7 + index * 2.9));
      const x = centerX + Math.cos(angle) * distance;
      const y = centerY + Math.sin(angle) * distance;
      context.beginPath();
      context.arc(x, y, dot, 0, TAU);
      context.fillStyle = SPLAT_MID;
      context.fill();
      context.lineWidth = 0.35 * unit;
      context.strokeStyle = SPLAT_OUTLINE;
      context.stroke();
    }
  }

  function getAcidSplatSprite(context, variant) {
    const scale = resolveDeviceScale(context);
    if (scale === null) return null;
    return acidSplatSprites.get(
      `acid-splat-v1-${variant}`,
      ACID_SPLAT_SIZE,
      scale,
      (spriteContext, centerX, centerY, size) => {
        paintAcidSplat(spriteContext, centerX, centerY, size, variant);
      }
    );
  }

  function drawFlyingAcid(effect, context) {
    const speed = Math.hypot(effect.vx, effect.vy);
    const directionX = speed > EPSILON ? effect.vx / speed : 1;
    const directionY = speed > EPSILON ? effect.vy / speed : 0;
    const beadRadius = effect.radius + 0.6;
    const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    context.save();
    context.lineCap = "round";
    context.strokeStyle = "rgba(143, 255, 77, 0.22)";
    context.lineWidth = 4.4;
    context.beginPath();
    context.moveTo(effect.x - directionX * 16, effect.y - directionY * 16);
    context.lineTo(effect.x - directionX * 4, effect.y - directionY * 4);
    context.stroke();
    context.strokeStyle = "rgba(205, 255, 140, 0.5)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(effect.x - directionX * 10, effect.y - directionY * 10);
    context.lineTo(effect.x - directionX * 2, effect.y - directionY * 2);
    context.stroke();

    for (let index = 0; index < 2; index += 1) {
      const behind = 6 + index * 3.4;
      const dot = 1.2 - index * 0.35;
      context.globalAlpha = baseAlpha * (0.7 - index * 0.25);
      context.fillStyle = SPLASH_COLORS[index + 1];
      context.beginPath();
      context.arc(
        effect.x - directionX * behind,
        effect.y - directionY * behind,
        dot, 0, TAU
      );
      context.fill();
    }

    context.globalAlpha = baseAlpha;
    context.fillStyle = SPLAT_OUTLINE;
    context.beginPath();
    context.arc(effect.x, effect.y, beadRadius, 0, TAU);
    context.fill();
    context.fillStyle = SPLAT_MID;
    context.beginPath();
    context.arc(effect.x, effect.y, beadRadius - 0.5, 0, TAU);
    context.fill();
    context.fillStyle = SPLAT_CORE;
    context.beginPath();
    context.arc(
      effect.x - directionX * 0.3,
      effect.y - directionY * 0.3,
      beadRadius * 0.6, 0, TAU
    );
    context.fill();
    context.fillStyle = SPLAT_GLINT;
    context.beginPath();
    context.arc(effect.x - 0.7, effect.y - 0.9, 0.8, 0, TAU);
    context.fill();
    context.restore();
  }

  function drawLandedAcid(effect, game, context) {
    const variant = Number.isInteger(effect.splatVariant)
      ? Math.abs(effect.splatVariant) % ACID_SPLAT_VARIANTS
      : 0;
    const landedAt = Number.isFinite(effect.landedAt) ? effect.landedAt : 0;
    const now = game && Number.isFinite(game.time) ? game.time : landedAt;
    const pop = clamp(
      0.55 + 0.45 * Math.max(0, now - landedAt) / ACID_SPLAT_POP_DURATION,
      0.55,
      1
    );
    const sprite = getAcidSplatSprite(context, variant);
    if (sprite) {
      const width = sprite.worldWidth * pop;
      context.drawImage(
        sprite.canvas,
        effect.x - width / 2,
        effect.y - width / 2,
        width,
        width
      );
      return;
    }
    context.save();
    context.translate(effect.x, effect.y);
    context.scale(pop, pop);
    paintAcidSplat(context, 0, 0, ACID_SPLAT_SIZE, variant);
    context.restore();
  }

  function drawAcid(effect, game, context) {
    if (effect.landed) drawLandedAcid(effect, game, context);
    else drawFlyingAcid(effect, context);
  }

  function drawPoisonBubbles(ball, elapsed, pulse, context) {
    const radius = ball.radius;
    const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    const clear = radius * POISON_CENTER_CLEAR;
    for (let index = 0; index < POISON_BUBBLE_COUNT; index += 1) {
      const seed = visualUnit(index * 7.7 + 1.3);
      const phase = (elapsed * 0.7 + seed) % 1;
      const angle = index / POISON_BUBBLE_COUNT * TAU + elapsed * 0.35 + seed;
      const distance = clear + (radius - clear) * (0.45 + 0.4 * seed);
      const dot = Math.max(0.7, radius * (0.055 + 0.05 * seed)) *
        (0.75 + 0.35 * Math.sin(phase * Math.PI));
      const x = ball.x + Math.cos(angle) * distance;
      const y = ball.y + Math.sin(angle) * distance;
      context.globalAlpha = baseAlpha * (0.35 + 0.4 * pulse) *
        (0.5 + 0.5 * Math.sin(phase * Math.PI));
      context.fillStyle = SPLAT_GLINT;
      context.beginPath();
      context.arc(x, y, dot, 0, TAU);
      context.fill();
    }
  }

  function createPoisonEffect() {
    return {
      id: "acid-poison",
      duration: POISON_DURATION,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: POISON_MIN_SPEED_FACTOR,
      onApply({ effect, game, isRefresh }) {
        if (!isRefresh) effect.startedAt = game.time;
        effect.startedAt = game.time;
        effect.nextDamageAt = game.time + POISON_TICK_INTERVAL;
        effect.ticksRemaining = POISON_TICK_COUNT;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          effect.ticksRemaining > 0 &&
          game.time + EPSILON >= effect.nextDamageAt &&
          ball.hp > 0
        ) {
          effectServices.dealDamage(ball, POISON_DAMAGE);
          effect.nextDamageAt += POISON_TICK_INTERVAL;
          effect.ticksRemaining -= 1;
        }
        const recoveryProgress = clamp(
          (game.time - effect.startedAt) / POISON_DURATION,
          0,
          1
        );
        effect.speedFactor = POISON_MIN_SPEED_FACTOR +
          (1 - POISON_MIN_SPEED_FACTOR) * recoveryProgress;
        if (effect.ticksRemaining === 0) effect.expiresAt = game.time;
      },
      draw({ ball, effect, game }, context) {
        const radius = Number.isFinite(ball.radius) ? ball.radius : 0;
        if (radius <= 0) return;
        const now = game && Number.isFinite(game.time) ? game.time : 0;
        const elapsed = Math.max(0, now - (
          Number.isFinite(effect.startedAt) ? effect.startedAt : now
        ));
        const pulse = 0.75 + 0.25 * Math.sin(elapsed * 11);
        const clear = radius * POISON_CENTER_CLEAR;
        const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
        const strength = 0.6 * pulse;
        context.save();
        context.beginPath();
        context.arc(ball.x, ball.y, radius, 0, TAU);
        context.clip();
        context.globalAlpha = baseAlpha;
        if (typeof context.createRadialGradient === "function") {
          const gradient = context.createRadialGradient(
            ball.x, ball.y, 0,
            ball.x, ball.y, radius
          );
          gradient.addColorStop(0, `rgba(${POISON_WASH_RGB}, ${POISON_CENTER_ALPHA * strength})`);
          gradient.addColorStop(
            POISON_CENTER_CLEAR,
            `rgba(${POISON_WASH_RGB}, ${0.34 * strength})`
          );
          gradient.addColorStop(1, `rgba(${POISON_WASH_RGB}, ${strength})`);
          context.fillStyle = gradient;
        } else {
          context.fillStyle = `rgba(${POISON_WASH_RGB}, ${0.3 * strength})`;
        }
        context.beginPath();
        context.arc(ball.x, ball.y, radius, 0, TAU);
        context.fill();
        drawPoisonBubbles(ball, elapsed, pulse, context);
        context.restore();
      }
    };
  }

  function spawnAcidBurst(services, x, y, options) {
    if (!services || typeof services.spawnParticleBurst !== "function") return;
    services.spawnParticleBurst({
      kind: options.kind,
      x,
      y,
      count: options.count,
      colors: SPLASH_COLORS,
      minDiameter: options.minDiameter,
      maxDiameter: options.maxDiameter,
      minSpeed: options.minSpeed,
      maxSpeed: options.maxSpeed,
      initialRadius: options.initialRadius,
      gravityY: options.gravityY,
      drag: 2.7,
      life: options.life
    });
  }

  function createAcid(source, arenaSize) {
    const arena = typeof arenaSize === "object" ? arenaSize : createArenaGeometry(arenaSize);
    const angle = Math.random() * Math.PI * 2;
    const placementDistance = Math.sqrt(Math.random()) * ACID_PLACEMENT_RADIUS;
    const destination = arena.clampPoint(source.x + Math.cos(angle) * placementDistance,
      source.y + Math.sin(angle) * placementDistance, ACID_RADIUS);
    const distance = Math.hypot(destination.x - source.x, destination.y - source.y);
    const velocityX = (destination.x - source.x) / ACID_TRAVEL_DURATION;
    const velocityY = (destination.y - source.y) / ACID_TRAVEL_DURATION;
    const landedAtStart = distance <= EPSILON;
    return {
      kind: "acid-puddle",
      life: PERMANENT_LIFE,
      radius: ACID_RADIUS,
      x: source.x,
      y: source.y,
      originX: source.x,
      originY: source.y,
      vx: velocityX,
      vy: velocityY,
      destinationX: destination.x,
      destinationY: destination.y,
      landed: landedAtStart,
      travelElapsed: landedAtStart ? ACID_TRAVEL_DURATION : 0,
      landedAt: landedAtStart ? 0 : null,
      // 落地后切到球体下方：酸斑是地面残留，不该盖住任何本体。
      drawLayer: landedAtStart ? "background" : "foreground",
      splatVariant: Math.floor(angle / TAU * ACID_SPLAT_VARIANTS) %
        ACID_SPLAT_VARIANTS,
      update({ effect, services: acidServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        if (!effect.landed) {
          effect.travelElapsed = Math.min(
            ACID_TRAVEL_DURATION,
            effect.travelElapsed + Math.max(0, dt)
          );
          const travelProgress = effect.travelElapsed / ACID_TRAVEL_DURATION;
          effect.x = effect.originX +
            (effect.destinationX - effect.originX) * travelProgress;
          effect.y = effect.originY +
            (effect.destinationY - effect.originY) * travelProgress;
          if (effect.travelElapsed + EPSILON >= ACID_TRAVEL_DURATION) {
            effect.x = effect.destinationX;
            effect.y = effect.destinationY;
            effect.vx = 0;
            effect.vy = 0;
            effect.landed = true;
            effect.drawLayer = "background";
            effect.landedAt = acidServices.getTime();
            spawnAcidBurst(acidServices, effect.x, effect.y, {
              kind: "acid-landing",
              count: 5,
              minDiameter: 0.9,
              maxDiameter: 2.1,
              minSpeed: 16,
              maxSpeed: 46,
              initialRadius: 1.2,
              gravityY: 90,
              life: 0.3
            });
          }
        }

        acidServices.forEachEnemy((target) => {
          if (effect.life <= 0) return;
          if (!acidServices.getContactProfile(target).attackable) return;
          if (!sweptCirclesOverlap(
            target,
            startX,
            startY,
            effect.x,
            effect.y,
            effect.radius
          )) return;
          const targetWasAlive = target.hp > 0;
          // 接触即扣一口，再挂上两跳中毒：合计 3 + 3×2 = 9。
          acidServices.dealDamage(target, CONTACT_DAMAGE);
          const poison = acidServices.applyEffect(target, createPoisonEffect());
          if (poison || (targetWasAlive && target.hp <= 0)) {
            spawnAcidBurst(acidServices, target.x, target.y, {
              kind: "acid-impact",
              count: 9,
              minDiameter: 1,
              maxDiameter: 2.8,
              minSpeed: 24,
              maxSpeed: 84,
              initialRadius: target.radius * 0.7,
              gravityY: 110,
              life: 0.42
            });
            effect.life = 0;
          }
        });
      },
      draw({ effect, game }, context) {
        drawAcid(effect, game, context);
      }
    };
  }

  const acidDefinition = {
    id: "acid",
    name: "\u9178\u6db2",
    englishName: "Acid",
    color: "#49c95a",
    description: "每0.8秒半径50吐酸 / 0.1秒落地 / 接触-3+中毒-3×2 / 0.2倍渐复",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: ACID_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      const acids = [];
      function advance(dt) {
        timer = Math.min(ACID_INTERVAL, timer + Math.max(0, dt));
      }
      function nextTransition() {
        return Math.max(EPSILON, ACID_INTERVAL - timer);
      }
      function release(context) {
        if (timer + EPSILON < ACID_INTERVAL) return;
        timer = 0;
        acids.push(services.spawnCombatEntity(createAcid(
          context.ball,
          context.game.arena || context.game.arenaSize
        )));
      }
      return {
        onAttackBorrowStart(context) { timer = ACID_INTERVAL; release(context); },
        isAttackCycleComplete() { return acids.length > 0; },
        update(_context, dt) {
          advance(dt);
          for (let index = acids.length - 1; index >= 0; index -= 1) {
            if (acids[index].age + EPSILON >= acids[index].life) acids.splice(index, 1);
          }
        },
        getNextTransitionIn: nextTransition,
        afterUpdateStep: release,
        getAcidState() {
          return { timer, acids: acids.filter((effect) => effect.life > effect.age) };
        }
      };
    }
  };

  registerBall(acidDefinition);
  return { acidDefinition };
});
