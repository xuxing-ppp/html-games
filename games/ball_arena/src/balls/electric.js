(function initializeElectricBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricPlugin({ registerBall }) {
  const FIELD_RADIUS = 45;
  const STUN_DURATION = 2.8;
  const STUN_INTERVAL = 0.4;
  const STUN_DAMAGE = 3;
  const RECOVERY_TIME = 5.5;
  const VISUAL_INTERVAL = 0.03;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function hashPixel(x, y, seed) {
    let value = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 1000) / 1000;
  }

  function createElectricSpark(centerX, centerY, x, y, alpha, seed) {
    const blocks = [];
    let angle = Math.atan2(y - centerY, x - centerX) + (
      hashPixel(seed, 2, 0) - 0.5
    ) * 0.8;
    const count = 7 + Math.floor(hashPixel(seed, 4, 0) * 6);
    let px = x;
    let py = y;
    for (let index = 0; index < count; index += 1) {
      if (index > 0 && index % 2 === 0) {
        const radialAngle = Math.atan2(py - centerY, px - centerX);
        angle = radialAngle + (hashPixel(seed + index, 5, 0) - 0.5) * 1.05;
      }
      px += Math.cos(angle) * 2.35;
      py += Math.sin(angle) * 2.35;
      const radius = Math.hypot(px - centerX, py - centerY);
      if (radius > FIELD_RADIUS - 2) {
        px = centerX + (px - centerX) / radius * (FIELD_RADIUS - 2);
        py = centerY + (py - centerY) / radius * (FIELD_RADIUS - 2);
      } else if (radius < 17) {
        px = centerX + (px - centerX) / Math.max(radius, 1e-9) * 17;
        py = centerY + (py - centerY) / Math.max(radius, 1e-9) * 17;
      }
      if (index % 5 !== 3) blocks.push({ x: Math.round(px), y: Math.round(py) });
    }
    return {
      kind: "electric-spark",
      life: 0.28 + hashPixel(seed, 8, 0) * 0.14,
      drawLayer: "background",
      alpha,
      blocks,
      draw({ effect }, context) {
        const fade = 1 - effect.age / effect.life;
        context.save();
        context.globalAlpha *= effect.alpha * fade;
        context.fillStyle = "#9f861c";
        effect.blocks.forEach((block) => context.fillRect(block.x - 1, block.y - 1, 3, 3));
        context.fillStyle = "#ffe66a";
        effect.blocks.forEach((block, index) => {
          if (index % 3 !== 1) context.fillRect(block.x, block.y, 1, 1);
        });
        context.restore();
      }
    };
  }

  function createStunEffect(services, source) {
    return {
      id: "stun",
      visualType: "stun",
      duration: STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      pausesBehavior: true,
      getContactProfile() {
        return { attackable: false };
      },
      damage: STUN_DAMAGE,
      tickInterval: STUN_INTERVAL,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx != null
            ? ball.storedVx
            : (ball.preHitVx != null ? ball.preHitVx : ball.vx);
          effect.savedVy = ball.storedVy != null
            ? ball.storedVy
            : (ball.preHitVy != null ? ball.preHitVy : ball.vy);
          if (Math.hypot(effect.savedVx, effect.savedVy) <= 1e-9 && ball.movementLocked) {
            effect.savedVx = ball.speed * (ball.speedMultiplier || 1);
            effect.savedVy = 0;
          }
        }
        effect.nextDamageAt = game.time + effect.tickInterval;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          effect.nextDamageAt > 0 &&
          game.time >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + 1e-9
        ) {
          effectServices.dealDamage(ball, effect.damage);
          effect.nextDamageAt += effect.tickInterval;
        }

        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
      },
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 48) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    };
  }

  const electricDefinition = {
    id: "electric",
    name: "电球",
    englishName: "Electric Ball",
    color: "#ffff00",
    description: "充能型 / 2.8秒僵直",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let recovery = 0;
      let wasInRange = false;
      let observedTargetId = null;
      let pendingTargetId = null;
      let visualTimer = 0;
      let visualSeed = 0;
      const activeVisuals = [];

      function spawnVisual(ball) {
        const alpha = clamp(1 - recovery / RECOVERY_TIME, 0, 1);
        if (alpha <= 0) return;
        visualSeed += 1;
        const angle = hashPixel(visualSeed, 12, 0) * Math.PI * 2;
        const radius = ball.radius + 2 + hashPixel(visualSeed, 13, 0) * 12;
        for (let index = activeVisuals.length - 1; index >= 0; index -= 1) {
          if (activeVisuals[index].age >= activeVisuals[index].life) activeVisuals.splice(index, 1);
        }
        activeVisuals.push(services.spawnVisualEffect(createElectricSpark(
          ball.x,
          ball.y,
          ball.x + Math.cos(angle) * radius,
          ball.y + Math.sin(angle) * radius,
          alpha,
          visualSeed * 31
        )));
      }

      function tryTrigger(context, target, enteredRange = !wasInRange) {
        if (!target || recovery > 1e-9) return false;
        const inRange = Math.hypot(
          target.x - context.ball.x,
          target.y - context.ball.y
        ) <= FIELD_RADIUS;
        if (!inRange || !enteredRange) return false;
        activeVisuals.forEach((effect) => {
          effect.alpha = 0;
        });
        activeVisuals.length = 0;
        services.applyEffect(target, createStunEffect(services, context.ball), context.ball);
        recovery = RECOVERY_TIME;
        services.spawnHitText(target, "X");
        return true;
      }

      return {
        update(context, dt) {
          const elapsed = Math.max(0, dt);
          recovery = Math.max(0, recovery - elapsed);
          visualTimer += elapsed;
          let visualBursts = 0;
          while (visualTimer >= VISUAL_INTERVAL && visualBursts < 4) {
            visualTimer -= VISUAL_INTERVAL;
            spawnVisual(context.ball);
            visualBursts += 1;
          }
          if (visualBursts >= 4) visualTimer %= VISUAL_INTERVAL;
          const target = services.getOpponent();
          const targetId = target ? target.instanceId : null;
          if (targetId !== observedTargetId) {
            observedTargetId = targetId;
            wasInRange = false;
          }
          const inRange = Boolean(target && Math.hypot(
            target.x - context.ball.x,
            target.y - context.ball.y
          ) <= FIELD_RADIUS);
          if (!inRange) {
            if (pendingTargetId === targetId) pendingTargetId = null;
          } else if (!wasInRange) {
            pendingTargetId = targetId;
          }
          if (
            targetId !== null && pendingTargetId === targetId &&
            tryTrigger(context, target, true)
          ) {
            pendingTargetId = null;
          }
          wasInRange = inRange;
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          if (tryTrigger(context, target)) pendingTargetId = null;
        }
      };
    }
  };

  registerBall(electricDefinition);
  return { electricDefinition };
});
