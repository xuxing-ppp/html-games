(function initializeElectricV6(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricV6Plugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback }) {
  const CURRENT_INTERVAL = 0.8;
  const CURRENT_SPEED_MULTIPLIER = 1.5;
  const CURRENT_RADIUS = 3;
  const CURRENT_LENGTH = 20;
  const CURRENT_MARGIN = 30;
  const PULL_SPEED_PER_CHARGE = 0.12;
  const MAX_PULL_SPEED_MULTIPLIER = 1.2;
  const SHOCKWAVE_RADIUS = 65;
  const KNOCKBACK_SPEED_MULTIPLIER = 3;
  const KNOCKBACK_DURATION_LIMIT = 5;
  const WALL_DAMAGE = 3;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function trimHistory(history, maximumLength) {
    if (history.length < 2) return history;
    const kept = [history[history.length - 1]];
    let remaining = maximumLength;
    for (let index = history.length - 2; index >= 0 && remaining > EPSILON; index -= 1) {
      const newer = kept[kept.length - 1];
      const older = history[index];
      const distance = Math.hypot(newer.x - older.x, newer.y - older.y);
      if (distance <= remaining) {
        kept.push(older);
        remaining -= distance;
        continue;
      }
      const ratio = remaining / Math.max(EPSILON, distance);
      kept.push({
        x: newer.x + (older.x - newer.x) * ratio,
        y: newer.y + (older.y - newer.y) * ratio
      });
      remaining = 0;
    }
    return kept.reverse();
  }

  function visualNoise(seed, index, frame) {
    const value = Math.sin(seed * 0.013 + index * 12.9898 + frame * 3.117) * 43758.5453;
    return value - Math.floor(value);
  }

  function currentVisualPoints(effect) {
    const history = effect.history.length > 1
      ? effect.history
      : [
        { x: effect.x - effect.directionX * CURRENT_LENGTH, y: effect.y - effect.directionY * CURRENT_LENGTH },
        { x: effect.x, y: effect.y }
      ];
    const normalX = -effect.directionY;
    const normalY = effect.directionX;
    const frame = Math.floor(effect.age * 18);
    return history.map((point, index) => {
      if (index === 0 || index === history.length - 1) return point;
      const offset = Math.round((visualNoise(effect.visualSeed, index, frame) - 0.5) * 6);
      return {
        x: Math.round(point.x + normalX * offset),
        y: Math.round(point.y + normalY * offset)
      };
    });
  }

  function drawCurrent(effect, context) {
    const points = currentVisualPoints(effect);
    if (points.length < 2) return;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.lineCap = "square";
    context.lineJoin = "miter";
    context.globalAlpha *= 0.62;
    context.strokeStyle = "#7545c7";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
    context.globalAlpha *= 0.9;
    context.strokeStyle = "#d7b6ff";
    context.lineWidth = 1.25;
    context.stroke();

    const frame = Math.floor(effect.age * 12);
    const sparkCount = visualNoise(effect.visualSeed, 31, frame) > 0.64 ? 1 : 0;
    context.strokeStyle = "#b88cff";
    context.lineWidth = 1;
    for (let index = 0; index < sparkCount; index += 1) {
      const angle = visualNoise(effect.visualSeed, 40 + index, frame) * Math.PI * 2;
      const length = 3 + visualNoise(effect.visualSeed, 50 + index, frame) * 3;
      context.beginPath();
      context.moveTo(effect.x, effect.y);
      context.lineTo(
        Math.round(effect.x + Math.cos(angle) * length),
        Math.round(effect.y + Math.sin(angle) * length)
      );
      context.stroke();
    }
    context.restore();
  }

  function chargeEffectId(source) {
    return `electric-v6-charge-${source.instanceId}`;
  }

  function createChargeEffect(sourceInstanceId) {
    return {
      id: chargeEffectId({ instanceId: sourceInstanceId }),
      duration: Number.MAX_SAFE_INTEGER,
      kind: "electric-v6-charge-marker",
      sourceInstanceId,
      onApply({ effect, isRefresh }) {
        const previousCount = isRefresh && Number.isFinite(effect.count)
          ? effect.count
          : 0;
        effect.count = previousCount + 1;
      },
      update({ effect, services: effectServices }) {
        const creator = effectServices
          ? effectServices.getBall(effect.sourceInstanceId)
          : null;
        if (!creator || creator.hp <= 0 || effect.count <= 0) {
          effect.expiresAt = -1;
        }
      },
      draw({ ball, effect, game }, context) {
        if (ball.hp <= 0 || effect.count <= 0) return;
        const x = Math.round(ball.x);
        const y = Math.round(ball.y - ball.radius - 12);
        const pulse = 0.82 + Math.sin(game.time * 9) * 0.14;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= pulse;
        context.shadowColor = "#9a64ff";
        context.shadowBlur = 6;
        context.font = '700 11px "Ball Impact", Impact, "Arial Black", sans-serif';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineJoin = "round";
        context.lineWidth = 2.5;
        context.strokeStyle = "#321c63";
        context.fillStyle = "#e2c9ff";
        context.strokeText(String(effect.count), x, y);
        context.fillText(String(effect.count), x, y);
        context.restore();
      }
    };
  }

  function createShockwaveVisual(x, y, damage) {
    return {
      kind: "electric-v6-charge-shockwave",
      life: 0.52,
      x,
      y,
      radius: SHOCKWAVE_RADIUS,
      damage,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const radius = effect.radius * (1 - Math.pow(1 - progress, 2.4));
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "rgba(117, 69, 199, 0.14)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.shadowColor = "#985fff";
        context.shadowBlur = 9;
        context.strokeStyle = "#8955e8";
        context.lineWidth = 5 - progress * 3;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#e4cfff";
        context.lineWidth = 1.2;
        for (let index = 0; index < 10; index += 1) {
          const angle = index * Math.PI / 5 + progress * 0.18;
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(angle) * radius * 0.48,
            effect.y + Math.sin(angle) * radius * 0.48
          );
          context.lineTo(
            effect.x + Math.cos(angle + (index % 2 ? 0.06 : -0.06)) * radius,
            effect.y + Math.sin(angle + (index % 2 ? 0.06 : -0.06)) * radius
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createWallImpact(x, y) {
    return {
      kind: "electric-v6-wall-impact",
      life: 0.32,
      x,
      y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#cba3ff";
        context.lineWidth = 1.5;
        for (let index = 0; index < 7; index += 1) {
          const angle = index * Math.PI * 2 / 7;
          const length = 5 + progress * 15;
          context.beginPath();
          context.moveTo(effect.x, effect.y);
          context.lineTo(
            effect.x + Math.cos(angle) * length,
            effect.y + Math.sin(angle) * length
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createWallKnockback(source, directionX, directionY) {
    return createSharedKnockback({
      id: `electric-v6-wall-knockback-${source.instanceId}`,
      duration: KNOCKBACK_DURATION_LIMIT,
      directionX,
      directionY,
      speedMultiplier: KNOCKBACK_SPEED_MULTIPLIER,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onWallBounce({ ball, effect, services }) {
        if (effect.completed) return;
        effect.completed = true;
        services.dealDamage(ball, WALL_DAMAGE);
        services.spawnVisualEffect(createWallImpact(ball.x, ball.y));
        services.clearEffect(ball, effect.id);
      },
      draw({ ball, game }, context) {
        const flicker = Math.floor(game.time * 30) % 2 === 0 ? 0.75 : 0.42;
        context.save();
        context.globalAlpha *= flicker;
        context.strokeStyle = "#b781ff";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 4, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    });
  }
  function drawElectricV6Body(context, ball) {
    const x = ball.x;
    const y = ball.y;
    context.save();
    context.fillStyle = "#6670e8";
    context.beginPath();
    context.arc(x, y, 12, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(91, 224, 255, 0.55)";
    context.beginPath();
    context.arc(x, y, 11, Math.PI / 2, Math.PI * 1.5);
    context.fill();
    context.fillStyle = "rgba(174, 91, 255, 0.55)";
    context.beginPath();
    context.arc(x, y, 11, -Math.PI / 2, Math.PI / 2);
    context.fill();
    context.strokeStyle = "#29358c";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(x, y, 13.5, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = "#d9fbff";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x - 7, y);
    context.lineTo(x + 7, y);
    context.stroke();
    context.restore();
  }

  const electricV6Definition = {
    id: "electricV6",
    name: "\u7535\u7403V6",
    englishName: "Electric Ball V6",
    color: "#6670e8",
    description: "0.8秒微电流 / 电荷磁吸 / n²碰撞震荡",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: CURRENT_INTERVAL,
    createBehavior(services) {
      let fireTimer = 0;
      let firePending = false;
      let sourceInstanceId = null;

      function chargeState(source, target) {
        const state = target && target.effects.get(chargeEffectId(source));
        return state && state.expiresAt > services.getTime() && state.count > 0
          ? state
          : null;
      }

      function createCurrent(source, target) {
        const currentSourceInstanceId = source.instanceId;
        const direction = normalizeDirection(
          target.x - source.x,
          target.y - source.y,
          source.storedVx || source.vx,
          source.storedVy || source.vy
        );
        const speed = source.speed * CURRENT_SPEED_MULTIPLIER;
        const startX = source.x + direction.x * (source.radius + 2);
        const startY = source.y + direction.y * (source.radius + 2);
        return {
          kind: "electric-v6-micro-current",
          life: 4,
          radius: CURRENT_RADIUS,
          damage: 0,
          replayDamage: 0,
          color: "#9b63e8",
          x: startX,
          y: startY,
          vx: direction.x * speed,
          vy: direction.y * speed,
          directionX: direction.x,
          directionY: direction.y,
          history: [{ x: startX, y: startY }],
          visualSeed: Math.floor(Math.random() * 0x100000000) >>> 0,
          update({ effect, game, services: entityServices }, dt) {
            if (effect.life <= 0) return;
            const startStepX = effect.x;
            const startStepY = effect.y;
            effect.x += effect.vx * Math.max(0, dt);
            effect.y += effect.vy * Math.max(0, dt);
            effect.history.push({ x: effect.x, y: effect.y });
            effect.history = trimHistory(effect.history, CURRENT_LENGTH);
            const hit = entityServices.getFirstEnemyHit(
              startStepX,
              startStepY,
              effect.x,
              effect.y,
              CURRENT_RADIUS
            );
            if (hit && entityServices.getContactProfile(hit).attackable) {
              const charge = entityServices.applyEffect(
                hit,
                createChargeEffect(currentSourceInstanceId)
              );
              if (charge) {
                effect.life = 0;
                return;
              }
            }
            if (
          game.arena ? !game.arena.intersectsCircle(effect.x, effect.y, CURRENT_MARGIN) : (
            !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, CURRENT_MARGIN))
            ) effect.life = 0;
          },
          draw({ effect }, context) {
            drawCurrent(effect, context);
          }
        };
      }

      function fire(context) {
        const target = services.getOpponent();
        if (!target) return;
        services.spawnProjectile(createCurrent(context.ball, target));
      }

      function pullChargedEnemies(context, dt) {
        const source = context.ball;
        services.forEachEnemy((target) => {
          const state = chargeState(source, target);
          if (!state) return;
          if (!services.getContactProfile(target).solid) return;
          const deltaX = source.x - target.x;
          const deltaY = source.y - target.y;
          const distance = Math.hypot(deltaX, deltaY);
          const stopDistance = source.radius + target.radius;
          if (distance <= stopDistance + EPSILON) return;
          const pullMultiplier = Math.min(
            MAX_PULL_SPEED_MULTIPLIER,
            state.count * PULL_SPEED_PER_CHARGE
          );
          const travel = Math.min(
            distance - stopDistance,
            source.speed * pullMultiplier * Math.max(0, dt)
          );
          target.x += deltaX / distance * travel;
          target.y += deltaY / distance * travel;
        });
      }

      return {
        update(context, dt) {
          sourceInstanceId = context.ball.instanceId;
          fireTimer = Math.min(CURRENT_INTERVAL, fireTimer + Math.max(0, dt));
          firePending = fireTimer + EPSILON >= CURRENT_INTERVAL;
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, CURRENT_INTERVAL - fireTimer);
        },
        afterUpdateStep(context, dt) {
          pullChargedEnemies(context, dt);
          if (!firePending) return;
          firePending = false;
          fireTimer = 0;
          fire(context);
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          const state = chargeState(context.ball, target);
          if (!state) return;
          const chargeCount = state.count;
          const damage = chargeCount * chargeCount;
          if (!context.services.dealDamage(target, damage)) return;
          state.count = 0;
          state.expiresAt = context.game.time;
          context.services.spawnVisualEffect(createShockwaveVisual(
            context.ball.x,
            context.ball.y,
            damage
          ));
          if (target.hp <= 0) return;
          const direction = normalizeDirection(
            target.x - context.ball.x,
            target.y - context.ball.y,
            target.preHitVx,
            target.preHitVy
          );
          context.services.applyEffect(
            target,
            createWallKnockback(context.ball, direction.x, direction.y)
          );
        },
        drawBody(context, canvasContext) {
          drawElectricV6Body(canvasContext, context.ball);
          return true;
        },
        getChargeState(target) {
          const state = sourceInstanceId && target && target.effects
            ? chargeState({ instanceId: sourceInstanceId }, target)
            : null;
          return {
            count: state ? state.count : 0,
            pullMultiplier: state
              ? Math.min(MAX_PULL_SPEED_MULTIPLIER, state.count * PULL_SPEED_PER_CHARGE)
              : 0
          };
        }
      };
    }
  };

  registerBall(electricV6Definition);
  return { electricV6Definition };
});
