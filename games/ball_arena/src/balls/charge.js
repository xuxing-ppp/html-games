(function initializeCharge(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createChargePlugin({ registerBall, resolveArenaGeometry }) {
  const SWITCH_INTERVAL = 5;
  const FIELD_RADIUS = 50;
  const TICK_INTERVAL = 0.4;
  const TICK_DAMAGE = 3;
  const PAUSE_DURATION = 0.25;
  const EPSILON = 1e-9;
  const POSITIVE_COLOR = "#ff5f8f";
  const NEGATIVE_COLOR = "#3ec9ff";

  function createPositivePauseEffect() {
    return {
      id: "charge-positive-pause",
      duration: PAUSE_DURATION,
      // 沉默：挂眩晕视觉，禁止行动与攻击，但正常运动仍然允许。
      preventsAttack: true,
      pausesBehavior: true,
      visualType: "stun"
    };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function noise(seed, index, frame) {
    const value = Math.sin(seed * 0.017 + index * 12.9898 + frame * 2.33) * 43758.5453;
    return value - Math.floor(value);
  }

  function createDischargeBolt(x0, y0, x1, y1, color, seed) {
    return {
      kind: "charge-discharge-bolt",
      life: 0.2,
      x0,
      y0,
      x1,
      y1,
      color,
      seed,
      draw({ effect }, context) {
        const fade = clamp(1 - effect.age / effect.life, 0, 1);
        const deltaX = effect.x1 - effect.x0;
        const deltaY = effect.y1 - effect.y0;
        const length = Math.hypot(deltaX, deltaY) || 1;
        const normalX = -deltaY / length;
        const normalY = deltaX / length;
        const frame = Math.floor(effect.age * 60);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade;
        context.shadowColor = effect.color;
        context.shadowBlur = 6;
        context.strokeStyle = effect.color;
        context.lineWidth = 1.8;
        context.beginPath();
        context.moveTo(effect.x0, effect.y0);
        for (let index = 1; index < 5; index += 1) {
          const progress = index / 5;
          const offset = (noise(effect.seed, index, frame) - 0.5) * 14;
          context.lineTo(
            effect.x0 + deltaX * progress + normalX * offset,
            effect.y0 + deltaY * progress + normalY * offset
          );
        }
        context.lineTo(effect.x1, effect.y1);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.fillRect(Math.round(effect.x1) - 2, Math.round(effect.y1) - 2, 4, 4);
        context.restore();
      }
    };
  }

  function createPauseRing(target) {
    return {
      kind: "charge-pause-ring",
      life: 0.4,
      x: target.x,
      y: target.y,
      radius: target.radius,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = POSITIVE_COLOR;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius + progress * 10, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = POSITIVE_COLOR;
        for (const [offsetX, offsetY] of [
          [-3, 0],
          [3, 0]
        ]) {
          context.fillRect(
            Math.round(effect.x + offsetX) - 1,
            Math.round(effect.y + offsetY) - 2,
            2,
            4
          );
        }
        context.restore();
      }
    };
  }

  function drawPolarityGlyph(context, x, y, color, positive, alpha) {
    context.save();
    context.globalAlpha *= alpha;
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(x, y, 6, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(x - 3, y);
    context.lineTo(x + 3, y);
    context.stroke();
    if (positive) {
      context.beginPath();
      context.moveTo(x, y - 3);
      context.lineTo(x, y + 3);
      context.stroke();
    }
    context.restore();
  }

  const chargeDefinition = {
    id: "charge",
    name: "\u7535\u8377",
    englishName: "Charge",
    color: "#d84bce",
    description: "\u6b63\u8d1f\u7535\u8377\u5207\u6362 / \u78b0\u8fb9\u7559\u7535 / \u8d1f\u7535\u8303\u56f4\u4f24\u5bb3",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: SWITCH_INTERVAL,
    createBehavior(services) {
      let positive = true;
      let switchTimer = 0;
      let charges = [];
      let visualSeed = 0;
      // 本体的电荷源是持久对象：nextTick 不会在每帧重建时被清零。
      const bodySource = { x: 0, y: 0, positive: true, nextTick: 0 };

      function placeCharge(ball, context) {
        const arena = resolveArenaGeometry(context.game);
        let { x, y } = (context.wallContacts || [])[0] || ball;
        if (!context.wallContacts || !context.wallContacts.length) {
          if (context.bouncedX) x = ball.x <= arena.left + ball.radius + EPSILON ? arena.left : arena.right;
          if (context.bouncedY) y = ball.y <= arena.top + ball.radius + EPSILON ? arena.top : arena.bottom;
        }
        charges.push({ x, y, positive, nextTick: 0, nextTickSelf: 0 });
      }

      function positiveSources(ball) {
        const sources = charges.filter((charge) => charge.positive);
        if (positive) {
          sources.push({ x: ball.x, y: ball.y, positive: true });
        }
        return sources;
      }

      function negativeSources(ball) {
        const sources = charges.filter((charge) => !charge.positive);
        if (!positive) {
          bodySource.x = ball.x;
          bodySource.y = ball.y;
          sources.push(bodySource);
        }
        return sources;
      }

      function inRange(target, source) {
        return Math.hypot(target.x - source.x, target.y - source.y) <= FIELD_RADIUS;
      }

      return {
        update(context, dt) {
          const elapsed = Math.max(0, dt);
          switchTimer += elapsed;
          while (switchTimer + EPSILON >= SWITCH_INTERVAL) {
            switchTimer -= SWITCH_INTERVAL;
            positive = !positive;
            bodySource.nextTick = 0;
          }
          const ball = context.ball;
          const time = context.game.time;
          const negatives = negativeSources(ball);
          const positives = positiveSources(ball);
          services.forEachEnemy((target) => {
            let paused = false;
            for (const source of negatives) {
              if (!inRange(target, source)) continue;
              if (time + EPSILON >= (source.nextTick || 0)) {
                source.nextTick = time + TICK_INTERVAL;
                services.dealDamage(target, TICK_DAMAGE, ball);
                visualSeed += 1;
                // 攻击特效：从电荷源到目标的锯齿电弧 + 命亮点。
                services.spawnVisualEffect(createDischargeBolt(
                  source.x,
                  source.y,
                  target.x,
                  target.y,
                  NEGATIVE_COLOR,
                  visualSeed
                ));
              }
            }
            for (const source of positives) {
              if (!inRange(target, source)) continue;
              paused = true;
              break;
            }
            if (paused) {
              const wasPaused = target.effects.has("charge-positive-pause");
              services.applyEffect(target, createPositivePauseEffect(), ball);
              if (!wasPaused) {
                visualSeed += 1;
                services.spawnVisualEffect(createPauseRing(target));
              }
            }
          });
          // 墙上的负电荷只在本体为正电荷时电击本体：本体自己就是负电荷时，
          // 它和墙上的负电同源，互相无害。
          for (const source of charges) {
            if (source.positive) continue;
            if (!positive) continue;
            if (!inRange(ball, source)) continue;
            if (time + EPSILON >= (source.nextTickSelf || 0)) {
              source.nextTickSelf = time + TICK_INTERVAL;
              services.dealDamage(ball, TICK_DAMAGE, ball);
              visualSeed += 1;
              services.spawnVisualEffect(createDischargeBolt(
                source.x,
                source.y,
                ball.x,
                ball.y,
                NEGATIVE_COLOR,
                visualSeed
              ));
            }
          }
        },
        onWallBounce(context) {
          placeCharge(context.ball, context);
          positive = !positive;
          switchTimer = 0;
          bodySource.nextTick = 0;
        },
        drawArenaForeground(context, canvasContext) {
          const flicker = 0.6 + Math.sin(context.game.time * 16) * 0.25;
          for (const charge of charges) {
            const color = charge.positive ? POSITIVE_COLOR : NEGATIVE_COLOR;
            canvasContext.save();
            canvasContext.globalAlpha = flicker * 0.75;
            canvasContext.fillStyle = color;
            canvasContext.globalAlpha *= 0.14;
            canvasContext.beginPath();
            canvasContext.arc(charge.x, charge.y, FIELD_RADIUS * 0.5, 0, Math.PI * 2);
            canvasContext.fill();
            canvasContext.restore();
            drawPolarityGlyph(
              canvasContext,
              charge.x,
              charge.y,
              color,
              charge.positive,
              flicker
            );
            canvasContext.save();
            canvasContext.strokeStyle = color;
            canvasContext.globalAlpha = flicker * 0.18;
            canvasContext.lineWidth = 1;
            canvasContext.beginPath();
            canvasContext.arc(charge.x, charge.y, FIELD_RADIUS, 0, Math.PI * 2);
            canvasContext.stroke();
            canvasContext.restore();
          }
        },
        drawAfter(context, canvasContext) {
          const ball = context.ball;
          const color = positive ? POSITIVE_COLOR : NEGATIVE_COLOR;
          const flicker = 0.75 + Math.sin(context.game.time * 18) * 0.15;
          // 外部圆环表示当前极性，不遮挡会画在球心的血量文字。
          canvasContext.save();
          canvasContext.strokeStyle = color;
          canvasContext.globalAlpha = 0.95 * flicker;
          canvasContext.lineWidth = 2.6;
          canvasContext.shadowColor = color;
          canvasContext.shadowBlur = 5;
          canvasContext.beginPath();
          canvasContext.arc(ball.x, ball.y, ball.radius + 4, 0, Math.PI * 2);
          canvasContext.stroke();
          canvasContext.restore();
          // 环上的极性符号放在球体下方，避开血量。
          drawPolarityGlyph(
            canvasContext,
            ball.x,
            ball.y + ball.radius + 11,
            color,
            positive,
            flicker
          );
          canvasContext.save();
          canvasContext.strokeStyle = color;
          canvasContext.globalAlpha = 0.18;
          canvasContext.lineWidth = 1.5;
          canvasContext.beginPath();
          canvasContext.arc(ball.x, ball.y, FIELD_RADIUS, 0, Math.PI * 2);
          canvasContext.stroke();
          canvasContext.restore();
        },
        getChargeState() {
          return {
            positive,
            switchTimer,
            chargeCount: charges.length,
            charges: charges.slice()
          };
        }
      };
    }
  };

  registerBall(chargeDefinition);
  return { chargeDefinition };
});
