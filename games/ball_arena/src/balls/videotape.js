(function initializeVideotape(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVideotapePlugin({ resolveArenaGeometry, registerBall }) {
  const ROLL_INTERVAL = 6;
  const REPLAY_DURATION = 3;
  const COLLISION_DAMAGE = 5;
  const STEALTH_OPACITY = 0.28;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeDirection(x, y) {
    const magnitude = Math.hypot(x, y) || 1;
    return { x: x / magnitude, y: y / magnitude };
  }

  function frameAt(frames, time) {
    if (frames.length === 1 || time <= frames[0].time) return frames[0];
    for (let index = 1; index < frames.length; index += 1) {
      const next = frames[index];
      if (time > next.time) continue;
      const previous = frames[index - 1];
      const duration = Math.max(EPSILON, next.time - previous.time);
      const progress = clamp((time - previous.time) / duration, 0, 1);
      return {
        x: previous.x + (next.x - previous.x) * progress,
        y: previous.y + (next.y - previous.y) * progress,
        vx: previous.vx + (next.vx - previous.vx) * progress,
        vy: previous.vy + (next.vy - previous.vy) * progress
      };
    }
    return frames.at(-1);
  }

  function segmentHitsBall(startX, startY, endX, endY, target, radius) {
    const lineX = endX - startX;
    const lineY = endY - startY;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((target.x - startX) * lineX + (target.y - startY) * lineY) /
          lengthSquared,
        0,
        1
      );
    const closestX = startX + lineX * progress;
    const closestY = startY + lineY * progress;
    return Math.hypot(target.x - closestX, target.y - closestY) <= (
      target.radius + radius
    );
  }

  function createImpact(x, y, color) {
    return {
      kind: "videotape-replay-impact",
      life: 0.28,
      x,
      y,
      color,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#54e6ff";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(effect.x, effect.y, 5 + progress * 18, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#ff4fc8";
        context.beginPath();
        context.moveTo(effect.x - 12, effect.y - 12);
        context.lineTo(effect.x + 12, effect.y + 12);
        context.moveTo(effect.x + 12, effect.y - 12);
        context.lineTo(effect.x - 12, effect.y + 12);
        context.stroke();
        context.restore();
      }
    };
  }

  function createReplayProjectile(services, source, target, event) {
    const direction = normalizeDirection(target.x - source.x, target.y - source.y);
    const speed = Math.max(EPSILON, event.speed || source.speed);
    const radius = Math.max(1, event.radius || 3);
    return {
      kind: `videotape-${event.kind || "projectile"}`,
      life: Math.max(0.1, event.life || 2),
      x: source.x,
      y: source.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      radius,
      damage: Math.max(0, event.damage || 1),
      targetInstanceId: target.instanceId,
      color: event.color || "#54e6ff",
      update({ effect, game, services: entityServices }, dt) {
        const replayTarget = entityServices.getBall(effect.targetInstanceId);
        if (!replayTarget || replayTarget.hp <= 0) {
          effect.life = 0;
          return;
        }
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        if (segmentHitsBall(startX, startY, effect.x, effect.y, replayTarget, effect.radius)) {
          if (entityServices.dealDamage(replayTarget, effect.damage, {
            replayAttack: true
          })) {
            entityServices.spawnVisualEffect(createImpact(
              replayTarget.x,
              replayTarget.y,
              replayTarget.color
            ));
          }
          effect.life = 0;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, radius)
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 0.72;
        context.fillStyle = "#ff4fc8";
        context.beginPath();
        context.arc(effect.x + 2, effect.y, effect.radius + 1, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#54e6ff";
        context.beginPath();
        context.arc(effect.x - 2, effect.y, effect.radius + 1, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = effect.color;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  function createStrikeVisual(source, target, event) {
    return {
      kind: "videotape-replay-strike",
      life: 0.22,
      startX: source.x,
      startY: source.y,
      endX: target.x,
      endY: target.y,
      color: event.color || "#54e6ff",
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.setLineDash([4, 3]);
        context.strokeStyle = "#ff4fc8";
        context.lineWidth = 4;
        context.beginPath();
        context.moveTo(effect.startX + 2, effect.startY);
        context.lineTo(effect.endX + 2, effect.endY);
        context.stroke();
        context.strokeStyle = "#54e6ff";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(effect.startX - 2, effect.startY);
        context.lineTo(effect.endX - 2, effect.endY);
        context.stroke();
        context.restore();
      }
    };
  }

  function replayEvent(services, source, target, event) {
    if (!target || target.hp <= 0) return;
    if (event.type === "projectile") {
      services.spawnProjectile(createReplayProjectile(services, source, target, event));
      return;
    }
    if (event.type !== "strike") return;
    services.spawnVisualEffect(createStrikeVisual(source, target, event));
    if (Math.hypot(target.x - source.x, target.y - source.y) <= event.range) {
      if (services.dealDamage(target, event.damage, source, { replayAttack: true })) {
        services.spawnVisualEffect(createImpact(target.x, target.y, target.color));
      }
    }
  }

  function drawReplayBody(context, ball, time) {
    const frame = Math.floor(time * 24);
    const jitter = frame % 5 === 0 ? 2 : 0;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.55;
    context.fillStyle = "#ff4fc8";
    context.beginPath();
    context.arc(ball.x + 3 + jitter, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#54e6ff";
    context.beginPath();
    context.arc(ball.x - 3 - jitter, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha *= 0.7;
    context.fillStyle = ball.replaySourceColor;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius - 2, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.45;
    context.fillStyle = "#d8fbff";
    for (let y = -ball.radius + 3; y < ball.radius; y += 5) {
      const halfWidth = Math.sqrt(Math.max(0, ball.radius * ball.radius - y * y));
      context.fillRect(ball.x - halfWidth, ball.y + y, halfWidth * 2, 1);
    }
    context.restore();
  }

  function createReplayDefinition(window, ownerInstanceId) {
    const frames = window.frames.map((frame) => ({ ...frame }));
    const events = window.events.map((event) => ({ ...event }));
    return {
      id: "videotapeReplay",
      name: `${window.targetName} REC`,
      englishName: "Videotape Replay",
      color: window.targetColor,
      description: "VHS replay actor",
      isReplayActor: true,
      healthless: true,
      stats: {
        radius: window.targetRadius,
        speed: 1,
        maxHp: 1
      },
      createBehavior(services) {
        let elapsed = 0;
        let nextEventIndex = 0;
        return {
          update(context, dt) {
            elapsed = Math.min(REPLAY_DURATION, elapsed + Math.max(0, dt));
            const frame = frameAt(frames, elapsed);
            context.ball.x = frame.x;
            context.ball.y = frame.y;
            context.ball.vx = context.ball.vy = 0;
            context.ball.storedVx = context.ball.storedVy = 0;
            const target = services.getBall(window.targetInstanceId);
            while (
              target && nextEventIndex < events.length &&
              events[nextEventIndex].time <= elapsed + EPSILON
            ) {
              replayEvent(services, context.ball, target, events[nextEventIndex]);
              nextEventIndex += 1;
            }
            if (elapsed + EPSILON >= REPLAY_DURATION) {
              context.ball.hp = 0;
              context.ball.fade = 0;
              context.ball.deathNotified = true;
            }
          },
          getNextTransitionIn() {
            const nextEventTime = nextEventIndex < events.length
              ? events[nextEventIndex].time
              : REPLAY_DURATION;
            return Math.max(
              EPSILON,
              Math.min(REPLAY_DURATION - elapsed, nextEventTime - elapsed)
            );
          },
          getContactProfile() {
            return { solid: true, attackable: false };
          },
          onCollision(context, target) {
            if (target.instanceId !== window.targetInstanceId) return;
            context.services.dealDamage(target, COLLISION_DAMAGE, {
              replayAttack: true
            });
          },
          drawBody(context, canvasContext) {
            drawReplayBody(canvasContext, context.ball, context.game.time);
            return true;
          },
          getHpDisplay() {
            return { text: "REC" };
          },
          getReplayElapsed() {
            return elapsed;
          }
        };
      },
      replayOwnerInstanceId: ownerInstanceId,
      replayTargetInstanceId: window.targetInstanceId,
      replaySourceColor: window.targetColor
    };
  }

  const videotapeDefinition = {
    id: "videotape",
    name: "\u5f55\u50cf\u5e26",
    englishName: "Videotape",
    color: "#4b405c",
    description: "\u6bcf6\u79d2\u56de\u653e\u4e09\u79d2\u6218\u6597 / VHS\u6b8b\u50cf",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 6,
    createBehavior(services) {
      let rollTimer = 0;
      let replayActor = null;

      function replayIsActive() {
        return Boolean(replayActor && replayActor.hp > 0);
      }

      return {
        update(_context, dt) {
          rollTimer = Math.min(ROLL_INTERVAL, rollTimer + Math.max(0, dt));
          if (replayActor && replayActor.hp <= 0) replayActor = null;
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, ROLL_INTERVAL - rollTimer);
        },
        afterUpdateStep(context) {
          if (rollTimer + EPSILON < ROLL_INTERVAL) return;
          rollTimer = 0;
          const target = services.getOpponent();
          if (!target || target.hp <= 0) return;
          const window = services.getReplayWindow(target, REPLAY_DURATION);
          if (!window || window.frames.length === 0) return;
          const first = window.frames[0];
          replayActor = services.spawnSummon(
            createReplayDefinition(window, context.ball.instanceId),
            {
              x: first.x,
              y: first.y,
              vx: 0,
              vy: 0,
              movementLocked: true,
              positionLocked: true
            }
          );
          if (replayActor) {
            replayActor.replayOwnerInstanceId = context.ball.instanceId;
            replayActor.replayTargetInstanceId = target.instanceId;
            replayActor.replaySourceColor = target.color;
          }
        },
        getContactProfile() {
          return replayIsActive()
            ? { solid: false, attackable: false }
            : undefined;
        },
        drawBefore(_context, canvasContext) {
          if (replayIsActive()) canvasContext.globalAlpha *= STEALTH_OPACITY;
        },
        isReplaying() {
          return replayIsActive();
        }
      };
    }
  };

  registerBall(videotapeDefinition);
  return { videotapeDefinition };
});
