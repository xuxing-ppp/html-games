(function initializeMeteorBurn(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMeteorBurnPlugin({ resolveArenaGeometry, registerBall }) {
  const METEOR_INTERVAL = 2.2;
  const METEOR_COUNT = 3;
  const METEOR_RADIUS = 10;
  const METEOR_SPEED_MULTIPLIER = 3.7;
  const METEOR_DAMAGE = 10;
  const BURN_DURATION = 0.9;
  const BURN_INTERVAL = 0.3;
  const BURN_DAMAGE = 3;
  const BURN_SPEED_FACTOR = 0.75;
  const MAX_TRAVEL_STEP = 8;
  const EPSILON = 1e-9;

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function segmentDistanceToPoint(startX, startY, endX, endY, x, y) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : Math.max(0, Math.min(1,
      ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared
    ));
    return Math.hypot(
      x - (startX + deltaX * progress),
      y - (startY + deltaY * progress)
    );
  }

  // 灼烧（可被其它球借用）：idPrefix 只影响状态 id 的可读性；tickDamage 允许借用方
  // 用同一套机制 / 视觉但改成自己的每跳伤害，默认仍是行星波动自己的数值。
  function createBurnEffect(services, source, idPrefix = "planetary-wave-burn", tickDamage = BURN_DAMAGE) {
    return {
      id: `${idPrefix}-${source.instanceId}`,
      attackTags: ["heat"],
      duration: BURN_DURATION,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: BURN_SPEED_FACTOR,
      onApply({ effect }) {
        effect.tickTimer = 0;
        effect.tickDamage = tickDamage;
      },
      update({ ball, effect, services: effectServices }, dt) {
        effect.tickTimer += Math.max(0, dt);
        while (effect.tickTimer + EPSILON >= BURN_INTERVAL && ball.hp > 0) {
          effect.tickTimer -= BURN_INTERVAL;
          effectServices.dealDamage(ball, effect.tickDamage);
        }
      },
      onWallBounce({ ball, effect }) {
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed <= EPSILON) return;
        const targetSpeed = ball.speed * ball.speedMultiplier;
        ball.storedVx = ball.vx / speed * targetSpeed;
        ball.storedVy = ball.vy / speed * targetSpeed;
      },
      draw({ ball, game }, context) {
        const flicker = 0.55 + Math.sin(game.time * 24) * 0.2;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= flicker;
        context.strokeStyle = "#ff8f36";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createDisintegration(x, y) {
    return {
      kind: "planetary-wave-disintegration",
      life: 0.28,
      x,
      y,
      draw({ effect }, context) {
        const progress = effect.age / effect.life;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "#ffb05a";
        for (let index = 0; index < 9; index += 1) {
          const angle = index * Math.PI * 2 / 9;
          const distance = progress * 18;
          context.fillRect(
            Math.round(effect.x + Math.cos(angle) * distance) - 1,
            Math.round(effect.y + Math.sin(angle) * distance) - 1,
            3,
            3
          );
        }
        context.restore();
      }
    };
  }

  function drawMeteor(effect, context) {
    const angle = Math.atan2(effect.vy, effect.vx);
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);
    context.globalCompositeOperation = "lighter";
    const gradient = context.createLinearGradient(-30, 0, 8, 0);
    gradient.addColorStop(0, "rgba(255, 105, 32, 0)");
    gradient.addColorStop(1, "rgba(255, 155, 56, 0.8)");
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(-30, 0);
    context.lineTo(-5, -6);
    context.lineTo(7, 0);
    context.lineTo(-5, 6);
    context.closePath();
    context.fill();
    context.shadowColor = "#ff7c2c";
    context.shadowBlur = 8;
    context.fillStyle = "#9b4f27";
    context.beginPath();
    context.arc(0, 0, effect.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffc06a";
    context.beginPath();
    context.arc(3, -3, 3, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function randomEdgePoint(arenaSize) {
    const edge = Math.min(3, Math.floor(Math.random() * 4));
    const progress = Math.random();
    return resolveArenaGeometry(arenaSize).boundaryPoint(["top", "right", "bottom", "left"][edge], edge >= 2 ? 1 - progress : progress);
  }

  function createMeteor(services, source, point) {
    const direction = normalizeDirection(source.x - point.x, source.y - point.y);
    const speed = source.speed * METEOR_SPEED_MULTIPLIER;
    return {
      kind: "planetary-wave-meteor",
      attackTags: ["physical", "heat"],
      life: 3,
      radius: METEOR_RADIUS,
      damage: METEOR_DAMAGE,
      replayDamage: METEOR_DAMAGE,
      x: point.x,
      y: point.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      update({ effect, game, services: entityServices }, dt) {
        if (effect.life <= 0) return;
        let remaining = Math.max(0, dt);
        const maximumStep = MAX_TRAVEL_STEP / speed;
        while (remaining > EPSILON && effect.life > 0) {
          const step = Math.min(remaining, maximumStep);
          const startX = effect.x;
          const startY = effect.y;
          const endX = startX + effect.vx * step;
          const endY = startY + effect.vy * step;
          if (segmentDistanceToPoint(
            startX, startY, endX, endY, source.x, source.y
          ) <= source.radius + effect.radius) {
            effect.x = endX;
            effect.y = endY;
            effect.life = 0;
            entityServices.spawnVisualEffect(createDisintegration(effect.x, effect.y));
            return;
          }
          const hit = entityServices.getFirstEnemyHit(
            startX, startY, endX, endY, effect.radius
          );
          if (hit && entityServices.dealDamage(hit, METEOR_DAMAGE)) {
            effect.x = endX;
            effect.y = endY;
            effect.life = 0;
            if (hit.hp > 0) entityServices.applyEffect(hit, createBurnEffect(entityServices, source));
            return;
          }
          effect.x = endX;
          effect.y = endY;
          remaining -= step;
        }
        const margin = 24;
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, margin)
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        drawMeteor(effect, context);
      }
    };
  }


  return {
    createBurnEffect,
    METEOR_BURN_RULES: Object.freeze({
      duration: BURN_DURATION,
      interval: BURN_INTERVAL,
      damage: BURN_DAMAGE,
      speedFactor: BURN_SPEED_FACTOR
    })
  };
});
