(function initializeZeusV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createZeusV2Plugin({ resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback }) {
  const SPEAR_INTERVAL = 2;
  const SPEAR_SPEED_MULTIPLIER = 2.5;
  const SPEAR_DAMAGE = 4;
  const DISCHARGE_INTERVAL = 5;
  const LINK_WIDTH = 10;
  const LINK_DAMAGE = 3;
  const LINK_ACTIVE_DURATION = 0.2;
  const LINK_FADE_DURATION = 0.28;
  const KNOCKBACK_SPEED_MULTIPLIER = 5;
  const KNOCKBACK_DURATION = 0.22;
  const STUN_DURATION = 1;
  const LINK_VISUAL_FRAME_RATE = 36;
  const LINK_SEGMENT_LENGTH = 18;
  const LINK_JITTER = 9;
  const LINK_GLOW_COLOR = [201 / 255, 169 / 255, 44 / 255];
  const LINK_BODY_COLOR = [225 / 255, 190 / 255, 44 / 255];
  const LINK_CORE_COLOR = [232 / 255, 215 / 255, 108 / 255];
  const LINK_SPARK_COLOR = [223 / 255, 208 / 255, 127 / 255];
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

  function closestPointOnSegment(startX, startY, endX, endY, x, y) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
      0,
      1
    );
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  function createLinkStun() {
    return {
      id: "zeus-v2-link-stun",
      visualType: "stun",
      duration: STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx;
          effect.savedVy = ball.storedVy;
        }
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball }) {
        ball.vx = 0;
        ball.vy = 0;
      },
      onExpire({ ball, effect }) {
        ball.vx = ball.storedVx = effect.savedVx || 0;
        ball.vy = ball.storedVy = effect.savedVy || 0;
      },
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 60) % 4;
        effect.offsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.offsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.offsetX, effect.offsetY);
      },
      draw({ ball, effect }, context) {
        context.save();
        context.translate(-(effect.offsetX || 0), -(effect.offsetY || 0));
        context.strokeStyle = "#ffe96b";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 4, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createLinkKnockback(services, source, directionX, directionY) {
    return createSharedKnockback({
      id: "zeus-v2-link-knockback",
      duration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onExpire({ ball, services: effectServices }) {
        if (ball.hp > 0) effectServices.applyEffect(ball, createLinkStun());
      },
      speedMultiplier: KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function linkNoise(seed, index, frame) {
    const value = Math.sin(seed * 0.017 + index * 12.9898 + frame * 2.33) * 43758.5453;
    return value - Math.floor(value);
  }

  function linkFade(effect) {
    return effect.age <= effect.activeDuration
      ? 1
      : clamp((effect.life - effect.age) / LINK_FADE_DURATION, 0, 1);
  }

  function prepareLinkVisual(effect) {
    const startX = effect.first.x;
    const startY = effect.first.y;
    const deltaX = effect.second.x - startX;
    const deltaY = effect.second.y - startY;
    const distance = Math.hypot(deltaX, deltaY);
    const segments = Math.max(4, Math.ceil(distance / LINK_SEGMENT_LENGTH));
    const frame = Math.floor(effect.age * LINK_VISUAL_FRAME_RATE);
    if (
      effect.visualFrame === frame &&
      effect.visualStartX === startX &&
      effect.visualStartY === startY &&
      effect.visualDeltaX === deltaX &&
      effect.visualDeltaY === deltaY
    ) return;

    const requiredLength = (segments + 1) * 2;
    if (!effect.visualPoints || effect.visualPoints.length !== requiredLength) {
      effect.visualPoints = new Float32Array(requiredLength);
    }
    const points = effect.visualPoints;
    const inverseDistance = distance > EPSILON ? 1 / distance : 0;
    const normalX = distance > EPSILON ? -deltaY * inverseDistance : 0;
    const normalY = distance > EPSILON ? deltaX * inverseDistance : 1;
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const offset = index === 0 || index === segments
        ? 0
        : (linkNoise(effect.visualSeed, index, frame) - 0.5) * LINK_JITTER;
      const pointOffset = index * 2;
      points[pointOffset] = startX + deltaX * progress + normalX * offset;
      points[pointOffset + 1] = startY + deltaY * progress + normalY * offset;
    }
    effect.visualFrame = frame;
    effect.visualSegments = segments;
    effect.visualStartX = startX;
    effect.visualStartY = startY;
    effect.visualDeltaX = deltaX;
    effect.visualDeltaY = deltaY;
  }

  function createDischargeLink(services, source, first, second) {
    return {
      kind: "zeus-v2-discharge-link",
      life: LINK_ACTIVE_DURATION + LINK_FADE_DURATION,
      activeDuration: LINK_ACTIVE_DURATION,
      width: LINK_WIDTH,
      first,
      second,
      hitTargets: new Set(),
      visualSeed: Math.floor(Math.random() * 0x100000000) >>> 0,
      visualFrame: -1,
      visualPoints: null,
      update({ effect, services: entityServices }) {
        if (effect.age > effect.activeDuration + EPSILON) return;
        const startX = effect.first.x;
        const startY = effect.first.y;
        const endX = effect.second.x;
        const endY = effect.second.y;
        entityServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (effect.hitTargets.has(key)) return;
          const closest = closestPointOnSegment(startX, startY, endX, endY, target.x, target.y);
          if (Math.hypot(target.x - closest.x, target.y - closest.y) > (
            target.radius + effect.width / 2
          )) return;
          if (!entityServices.dealDamage(target, LINK_DAMAGE)) return;
          effect.hitTargets.add(key);
          if (target.hp <= 0) return;
          const direction = normalizeDirection(
            target.x - closest.x,
            target.y - closest.y,
            target.x - source.x,
            target.y - source.y
          );
          entityServices.applyEffect(
            target,
            createLinkKnockback(entityServices, source, direction.x, direction.y)
          );
        });
      },
      draw({ effect }, context) {
        const fade = linkFade(effect);
        prepareLinkVisual(effect);
        const points = effect.visualPoints;
        const segments = effect.visualSegments;
        const frame = effect.visualFrame;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade * 0.68;
        context.shadowColor = "#c9a92c";
        context.shadowBlur = 4;
        context.strokeStyle = "rgba(225, 190, 44, 0.24)";
        context.lineWidth = effect.width;
        context.beginPath();
        context.moveTo(points[0], points[1]);
        for (let index = 1; index <= segments; index += 1) {
          const pointOffset = index * 2;
          context.lineTo(points[pointOffset], points[pointOffset + 1]);
        }
        context.stroke();
        context.shadowBlur = 1.5;
        context.strokeStyle = "#e8d76c";
        context.lineWidth = 1.4;
        context.stroke();
        context.fillStyle = "#dfd07f";
        for (let index = 1; index < segments; index += 2) {
          if (linkNoise(effect.visualSeed, index + 30, frame) < 0.65) continue;
          const pointOffset = index * 2;
          context.fillRect(
            Math.round(points[pointOffset]) - 1,
            Math.round(points[pointOffset + 1]) - 1,
            3,
            3
          );
        }
        context.restore();
      },
      drawGpu({ effect }, batch) {
        const fade = linkFade(effect);
        prepareLinkVisual(effect);
        const points = effect.visualPoints;
        const segments = effect.visualSegments;
        const frame = effect.visualFrame;
        for (let index = 1; index <= segments; index += 1) {
          const pointOffset = index * 2;
          const previousOffset = pointOffset - 2;
          batch.addLinePair(
            points[previousOffset],
            points[previousOffset + 1],
            points[pointOffset],
            points[pointOffset + 1],
            effect.width + 8,
            fade * 0.05,
            effect.width,
            fade * 0.1632,
            LINK_GLOW_COLOR[0],
            LINK_GLOW_COLOR[1],
            LINK_GLOW_COLOR[2],
            LINK_BODY_COLOR[0],
            LINK_BODY_COLOR[1],
            LINK_BODY_COLOR[2]
          );
          batch.addLine(
            points[previousOffset],
            points[previousOffset + 1],
            points[pointOffset],
            points[pointOffset + 1],
            1.4,
            LINK_CORE_COLOR[0],
            LINK_CORE_COLOR[1],
            LINK_CORE_COLOR[2],
            fade * 0.68
          );
        }
        for (let index = 1; index < segments; index += 2) {
          if (linkNoise(effect.visualSeed, index + 30, frame) < 0.65) continue;
          const pointOffset = index * 2;
          batch.addDisc(
            points[pointOffset],
            points[pointOffset + 1],
            1.5,
            LINK_SPARK_COLOR[0],
            LINK_SPARK_COLOR[1],
            LINK_SPARK_COLOR[2],
            fade * 0.68
          );
        }
      }
    };
  }

  function drawSpear(effect, context) {
    const angle = Math.atan2(effect.directionY, effect.directionX);
    const half = effect.visualLength / 2;
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);
    context.globalCompositeOperation = "lighter";
    context.shadowColor = "#ffd82f";
    context.shadowBlur = effect.anchored ? 4 : 7;
    context.strokeStyle = "#fff06a";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-half, -4);
    context.lineTo(half * 0.25, -4);
    context.lineTo(-half * 0.18, 4);
    context.lineTo(half, 4);
    context.stroke();
    context.strokeStyle = "#fffbd1";
    context.lineWidth = 0.7;
    context.stroke();
    context.restore();
  }

  function createSpear(services, source, target) {
    const direction = normalizeDirection(target.x - source.x, target.y - source.y);
    const speed = source.speed * SPEAR_SPEED_MULTIPLIER;
    return {
      kind: "zeus-v2-spear",
      life: 3600,
      radius: 2,
      damage: SPEAR_DAMAGE,
      replayDamage: SPEAR_DAMAGE,
      x: source.x,
      y: source.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      directionX: direction.x,
      directionY: direction.y,
      visualLength: 35 + Math.random() * 5,
      anchored: false,
      update({ effect, game, services: entityServices }, dt) {
        if (effect.anchored || effect.life <= 0) return;
        const step = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        const endX = startX + effect.vx * step;
        const endY = startY + effect.vy * step;
        const boundary = resolveArenaGeometry(game).traceSegment(startX, startY, endX, endY);
        const hit = entityServices.getFirstEnemyHit(startX, startY, boundary ? boundary.x : endX, boundary ? boundary.y : endY, effect.radius);
        if (hit && entityServices.dealDamage(hit, SPEAR_DAMAGE)) {
          effect.life = 0;
          return;
        }
        const reachesBoundary = !!boundary;
        effect.x = boundary ? boundary.x : endX;
        effect.y = boundary ? boundary.y : endY;
        if (reachesBoundary) {
          Object.assign(effect, resolveArenaGeometry(game).clampPoint(effect.x, effect.y, 0));
          effect.vx = 0;
          effect.vy = 0;
          effect.anchored = true;
        }
      },
      draw({ effect }, context) {
        drawSpear(effect, context);
      }
    };
  }

  const zeusV2Definition = {
    id: "zeusV2",
    name: "\u5b99\u65afV2",
    englishName: "Zeus V2",
    color: "#7fc9ed",
    description: "2\u79d2\u5b99\u65af\u4e4b\u77db / 5\u79d2\u957f\u77db\u8054\u7f51\u653e\u7535",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: SPEAR_INTERVAL,
    createBehavior(services) {
      let spearTimer = 0;
      let linkTimer = 0;
      const spears = [];
      return {
        update(_context, dt) {
          const step = Math.max(0, dt);
          spearTimer = Math.min(SPEAR_INTERVAL, spearTimer + step);
          linkTimer = Math.min(DISCHARGE_INTERVAL, linkTimer + step);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, Math.min(
            SPEAR_INTERVAL - spearTimer,
            DISCHARGE_INTERVAL - linkTimer
          ));
        },
        afterUpdateStep(context) {
          if (spearTimer + EPSILON >= SPEAR_INTERVAL) {
            spearTimer = 0;
            const target = services.getOpponent();
            if (target) {
              spears.push(services.spawnProjectile(createSpear(
                services,
                context.ball,
                target
              )));
            }
          }
          if (linkTimer + EPSILON < DISCHARGE_INTERVAL) return;
          linkTimer = 0;
          const anchoredSpears = spears.filter((effect) => (
            effect.kind === "zeus-v2-spear" && effect.life > 0 && effect.anchored
          ));
          for (let left = 0; left < anchoredSpears.length; left += 1) {
            for (let right = left + 1; right < anchoredSpears.length; right += 1) {
              services.spawnCombatEntity(createDischargeLink(
                services,
                context.ball,
                anchoredSpears[left],
                anchoredSpears[right]
              ));
            }
          }
        }
      };
    }
  };

  registerBall(zeusV2Definition);
  return { zeusV2Definition };
});
