(function initializeVampire(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVampirePlugin({ resolveArenaGeometry, registerBall }) {
  // 鹤城同源的锁定吸血骨架：单次恢复 +3，吸血冷却 2 秒（攻击时钟）。
  const LOCK_DURATION = 2.1;
  const LOCK_SPEED_MULTIPLIER = 0.25;
  const TICK_INTERVAL = 0.7;
  const LIFESTEAL_COOLDOWN = 2;
  const HEAL_AMOUNT = 3;
  const DAMAGE_AMOUNT = 3;
  const HEAL_COLOR = "#39ff6a";
  const RELEASE_GAP = 3;
  const BIND_EFFECT_ID = "vampire-bind";
  const EPSILON = 1e-9;

  const BODY_COLOR = "#d91f2c";
  const FANG_COLOR = "#fbf7ee";
  const FANG_EDGE = "rgba(38, 8, 24, 0.55)";

  // 本体保持纯色球体；嘴部两颗白色獠牙横向拉开，始终指向敌方。
  // 牙根藏在球缘之内（本体画在其上），只有牙尖从边缘露出来。
  const FANG_BASE_RADIUS = 0.92;
  const FANG_LENGTH = 0.6;
  const FANG_WIDTH = 0.2;
  const FANG_GAP = 1;
  // 吸血时本体绕敌方中心左右摆动 ±5°，一个来回 0.3 秒。
  const SWING_MAX_ANGLE = 5 * Math.PI / 180;
  const SWING_PERIOD = 0.3;
  const SWING_OMEGA = Math.PI * 2 / SWING_PERIOD;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // 一颗牙：底边垂直于朝向，牙尖沿朝向伸出 length。
  function createFang(baseX, baseY, angle, { length, width }) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const perpendicularX = -directionY;
    const perpendicularY = directionX;
    return {
      baseLeft: {
        x: baseX + perpendicularX * width * 0.5,
        y: baseY + perpendicularY * width * 0.5
      },
      baseRight: {
        x: baseX - perpendicularX * width * 0.5,
        y: baseY - perpendicularY * width * 0.5
      },
      tip: {
        x: baseX + directionX * length,
        y: baseY + directionY * length
      }
    };
  }

  // 两颗獠牙贴着球缘左右分开（间距约一个半径），牙尖都朝向敌方。
  function vampireBodyFangs(ball, angle) {
    const baseRadius = ball.radius * FANG_BASE_RADIUS;
    const gap = ball.radius * FANG_GAP;
    const spread = Math.asin(clamp(gap / (2 * baseRadius), -1, 1));
    const fangs = [];
    for (const side of [-1, 1]) {
      const baseAngle = angle + side * spread;
      const baseX = ball.x + Math.cos(baseAngle) * baseRadius;
      const baseY = ball.y + Math.sin(baseAngle) * baseRadius;
      fangs.push(createFang(baseX, baseY, angle, {
        length: ball.radius * FANG_LENGTH,
        width: ball.radius * FANG_WIDTH
      }));
    }
    return { x: ball.x, y: ball.y, angle, spread, fangs };
  }

  // 吸血尖牙不再单独漂浮：它们只是本体嘴上的两颗獠牙，本体怎么动它们就怎么动。
  function drawFangs(canvasContext, fangs) {
    canvasContext.save();
    canvasContext.fillStyle = FANG_COLOR;
    canvasContext.strokeStyle = FANG_EDGE;
    canvasContext.lineWidth = 0.8;
    for (const fang of fangs) {
      canvasContext.beginPath();
      canvasContext.moveTo(fang.baseLeft.x, fang.baseLeft.y);
      canvasContext.lineTo(fang.tip.x, fang.tip.y);
      canvasContext.lineTo(fang.baseRight.x, fang.baseRight.y);
      canvasContext.closePath();
      canvasContext.fill();
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function createBindEffect(directionX, directionY) {
    return {
      id: BIND_EFFECT_ID,
      duration: LOCK_DURATION,
      locksMovement: true,
      // A contact capture is distinct from ordinary damage. Covered defenses
      // can reject it while still receiving contact and damage events.
      contactCapture: true,
      onApply({ ball, effect }) {
        effect.releaseVx = directionX * ball.speed * ball.speedMultiplier;
        effect.releaseVy = directionY * ball.speed * ball.speedMultiplier;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game }) {
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.releaseVx;
        ball.vy = effect.releaseVy;
        ball.storedVx = effect.releaseVx;
        ball.storedVy = effect.releaseVy;
      }
    };
  }

  const vampireDefinition = {
    id: "vampire",
    name: "吸血鬼",
    englishName: "Vampire",
    color: BODY_COLOR,
    description: "锁定型 / 单次吸血+3，冷却2秒",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let lock = null;
      let cooldownUntil = -Infinity;
      let fangAngle = 0;
      const attackNow = (context) => typeof services.getAttackTime === "function"
        ? services.getAttackTime() : context.game.time;

      // 本体獠牙始终对准敌方：被锁住时咬住锁定目标，否则盯最近的敌人。
      function aimAngle(ball) {
        const target = lock ? lock.target : services.getOpponent();
        if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) {
          fangAngle = Math.atan2(target.y - ball.y, target.x - ball.x);
        }
        return fangAngle;
      }

      function release(ball, { separate = true, now = 0 } = {}) {
        if (!lock) return;
        const target = lock.target;
        const cooldownNow = typeof services.getAttackTime === "function" ? services.getAttackTime() : now;
        const ownerSpeed = ball.speed;
        services.setSpeedMultiplier(1);
        const targetEffect = target.effects.get(BIND_EFFECT_ID);
        if (!separate) {
          services.clearEffect(target, BIND_EFFECT_ID);
          lock = null;
          cooldownUntil = Math.max(cooldownUntil, cooldownNow + LIFESTEAL_COOLDOWN);
          return;
        }
        ball.x -= lock.directionX * RELEASE_GAP * 0.5;
        ball.y -= lock.directionY * RELEASE_GAP * 0.5;
        target.x += lock.directionX * RELEASE_GAP * 0.5;
        target.y += lock.directionY * RELEASE_GAP * 0.5;
        ball.storedVx = -lock.directionX * ownerSpeed;
        ball.storedVy = -lock.directionY * ownerSpeed;
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
        if (targetEffect) {
          const targetSpeed = target.speed * target.speedMultiplier;
          targetEffect.releaseVx = lock.directionX * targetSpeed;
          targetEffect.releaseVy = lock.directionY * targetSpeed;
          target.vx = target.storedVx = targetEffect.releaseVx;
          target.vy = target.storedVy = targetEffect.releaseVy;
          services.clearEffect(target, BIND_EFFECT_ID);
        }
        lock = null;
        cooldownUntil = Math.max(cooldownUntil, cooldownNow + LIFESTEAL_COOLDOWN);
      }

      return {
        update(context) {
          if (!lock) return;
          const targetContact = services.getContactProfile(lock.target);
          if (!targetContact.solid || !targetContact.attackable) {
            release(context.ball, { separate: false, now: context.game.time });
            return;
          }
          const now = context.game.time;
          while (
            lock.nextTickAt <= lock.endsAt + EPSILON &&
            now + EPSILON >= lock.nextTickAt
          ) {
            const targetHpBefore = lock.target.hp;
            services.dealDamage(lock.target, DAMAGE_AMOUNT, context.ball);
            if (lock.target.hp < targetHpBefore) {
              context.ball.hp += HEAL_AMOUNT;
              services.spawnHitText(context.ball, `+${HEAL_AMOUNT}`, { color: HEAL_COLOR });
            }
            lock.nextTickAt += TICK_INTERVAL;
          }
          if (now + EPSILON >= lock.endsAt) release(context.ball, { now });
        },
        getNextTransitionIn(context) {
          if (!lock) return undefined;
          const now = context.game.time;
          return Math.max(
            EPSILON,
            Math.min(lock.nextTickAt, lock.endsAt) - now
          ) / (typeof services.getAttackPeriodScale === "function"
            ? services.getAttackPeriodScale() : 1);
        },
        afterUpdateStep(context) {
          if (!lock) return;
          const targetContact = services.getContactProfile(lock.target);
          if (!targetContact.solid || !targetContact.attackable) {
            release(context.ball, { separate: false, now: context.game.time });
            return;
          }
          const ball = context.ball;
          const target = lock.target;
          const arenaSize = context.game;
          const distance = ball.radius + target.radius;
          // 受害者被本体拖着走：先按本体这一帧的实际位移把它带过去，
          // 再把本体放回以它为中心的圆弧上做 ±5° 摆动。
          const advanceX = ball.x - lock.lastX;
          const advanceY = ball.y - lock.lastY;
          Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(target.x + advanceX, target.y + advanceY, target.radius));
          const swing = SWING_MAX_ANGLE *
            Math.sin((context.game.time - lock.startedAt) * SWING_OMEGA);
          const angle = lock.baseAngle + swing;
          Object.assign(ball, resolveArenaGeometry(arenaSize).clampPoint(target.x + Math.cos(angle) * distance, target.y + Math.sin(angle) * distance, ball.radius));
          target.vx = 0;
          target.vy = 0;
          lock.lastX = ball.x;
          lock.lastY = ball.y;
        },
        onCollision(context, target) {
          if (
            lock || context.blockedAtContact ||
            attackNow(context) + EPSILON < cooldownUntil
          ) return;
          let directionX = target.x - context.ball.x;
          let directionY = target.y - context.ball.y;
          const magnitude = Math.hypot(directionX, directionY) || 1;
          directionX /= magnitude;
          directionY /= magnitude;
          const now = context.game.time;
          const bind = services.applyEffect(
            target,
            createBindEffect(directionX, directionY),
            context.ball
          );
          // A target can reject a contact-capture effect (for example a body
          // fully covered by a shield). In that case the collision has already
          // resolved physically, but the vampire must not enter a phantom lock.
          if (!bind) return;
          lock = {
            target,
            directionX,
            directionY,
            baseAngle: Math.atan2(context.ball.y - target.y, context.ball.x - target.x),
            startedAt: now,
            lastX: context.ball.x,
            lastY: context.ball.y,
            nextTickAt: now + TICK_INTERVAL,
            endsAt: now + LOCK_DURATION
          };
          services.setSpeedMultiplier(LOCK_SPEED_MULTIPLIER);
        },
        getContactProfile() {
          return { solid: !lock };
        },
        onBeforeDamage(_context, event) {
          if (lock) return { amount: 0, showHitText: false };
          return event;
        },
        drawBefore(context, canvasContext) {
          // 两颗白獠牙始终指向敌方，画在本体下方：球体盖住牙根，只有牙尖
          // 从边缘露出来。吸血摆动时跟着本体一起动，不会脱离本体。
          const mouth = vampireBodyFangs(context.ball, aimAngle(context.ball));
          drawFangs(canvasContext, mouth.fangs);
        }
      };
    }
  };

  registerBall(vampireDefinition);
  return {
    vampireDefinition,
    createVampireBindEffect: createBindEffect,
    vampireBodyFangs,
    VAMPIRE_HEAL_AMOUNT: HEAL_AMOUNT,
    VAMPIRE_LIFESTEAL_COOLDOWN: LIFESTEAL_COOLDOWN,
    VAMPIRE_LOCK_DURATION: LOCK_DURATION,
    VAMPIRE_TICK_INTERVAL: TICK_INTERVAL,
    VAMPIRE_DAMAGE_AMOUNT: DAMAGE_AMOUNT,
    VAMPIRE_SWING_MAX_ANGLE: SWING_MAX_ANGLE,
    VAMPIRE_SWING_PERIOD: SWING_PERIOD,
    VAMPIRE_BIND_EFFECT_ID: BIND_EFFECT_ID
  };
});
