(function initializeTrainWeapon(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTrainWeaponPlugin({ getArenaWallContacts, registerBall, createKnockbackEffect: createSharedKnockback }) {
  const REQUIRED_CONTACTS = 4;
  const TRAIN_DELAY = 1;
  const TRAIN_LENGTH = 1100;
  const TRAIN_WIDTH = 20;
  const TRAIN_SPEED = 300;
  const TRAIN_DAMAGE = 5;
  const TRAIN_KNOCKBACK_DURATION = 0.05;
  const TRAIN_KNOCKBACK_SPEED_MULTIPLIER = 2;
  const TRAIN_IMPACT_RADIUS = 25;
  const TRAIN_FADE_DURATION = 0.6;
  // 重装冷却已取消：列车走完就立刻回到铺轨状态。
  const REARM_DELAY = 0;
  const EPSILON = 1e-9;
  const GREEN_TRAIN_PALETTE = Object.freeze({
    outline: "#0a2110",
    locomotive: "#35d85d",
    car: "#269f47",
    panel: "#145f2b",
    window: "#bfffd0",
    lamp: "#fff29a",
    chimney: "#0b3215",
    wheel: "#07110a"
  });
  const RED_TRAIN_PALETTE = Object.freeze({
    outline: "#262a2d",
    locomotive: "#c4c9cc",
    car: "#aeb5b9",
    panel: "#9d252c",
    window: "#d9dddf",
    lamp: "#fff29a",
    chimney: "#141719",
    wheel: "#34383b"
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function createTrainKnockback(source, directionX, directionY, duration) {
    return createSharedKnockback({
      id: `rail-train-knockback-${source.instanceId}`,
      duration: Number.isFinite(duration) ? duration : TRAIN_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: TRAIN_KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function spawnTrainImpact(services, x, y) {
    services.spawnParticleBurst({
      kind: "rail-train-impact",
      x,
      y,
      minDiameter: 1,
      maxDiameter: 8,
      colors: ["#ffffff", "#969ba0"],
      initialRadius: TRAIN_IMPACT_RADIUS,
      life: 0.42
    });
  }

  function buildRoute(points) {
    const segments = [];
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const segmentLength = Math.hypot(deltaX, deltaY);
      if (segmentLength <= EPSILON) continue;
      segments.push({
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        directionX: deltaX / segmentLength,
        directionY: deltaY / segmentLength,
        startDistance: length,
        endDistance: length + segmentLength
      });
      length += segmentLength;
    }
    return { segments, length };
  }

  function trainBodySegments(route, headDistance) {
    const tailDistance = headDistance - TRAIN_LENGTH;
    return route.segments.flatMap((segment) => {
      const startDistance = Math.max(segment.startDistance, tailDistance);
      const endDistance = Math.min(segment.endDistance, headDistance);
      if (endDistance - startDistance <= EPSILON) return [];
      const startOffset = startDistance - segment.startDistance;
      const endOffset = endDistance - segment.startDistance;
      return [{
        startX: segment.startX + segment.directionX * startOffset,
        startY: segment.startY + segment.directionY * startOffset,
        endX: segment.startX + segment.directionX * endOffset,
        endY: segment.startY + segment.directionY * endOffset,
        directionX: segment.directionX,
        directionY: segment.directionY
      }];
    });
  }

  function closestPointOnSegment(x, y, segment) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((x - segment.startX) * deltaX + (y - segment.startY) * deltaY) / lengthSquared, 0, 1);
    const pointX = segment.startX + deltaX * progress;
    const pointY = segment.startY + deltaY * progress;
    return {
      x: pointX,
      y: pointY,
      distance: Math.hypot(x - pointX, y - pointY),
      directionX: segment.directionX,
      directionY: segment.directionY
    };
  }

  function drawRails(canvasContext, route, opacity = 1) {
    if (!route || route.segments.length === 0 || opacity <= 0) return;

    canvasContext.save();
    canvasContext.globalAlpha *= 0.78 * opacity;
    route.segments.forEach((segment) => {
      const normalX = -segment.directionY;
      const normalY = segment.directionX;
      [-3, 3].forEach((offset) => {
        canvasContext.strokeStyle = "#68756b";
        canvasContext.lineWidth = 1.5;
        canvasContext.beginPath();
        canvasContext.moveTo(
          segment.startX + normalX * offset,
          segment.startY + normalY * offset
        );
        canvasContext.lineTo(
          segment.endX + normalX * offset,
          segment.endY + normalY * offset
        );
        canvasContext.stroke();
      });
      canvasContext.strokeStyle = "#a2b3a6";
      canvasContext.lineWidth = 1;
      const segmentLength = segment.endDistance - segment.startDistance;
      for (let distance = 5; distance < segmentLength; distance += 10) {
        const centerX = segment.startX + segment.directionX * distance;
        const centerY = segment.startY + segment.directionY * distance;
        canvasContext.beginPath();
        canvasContext.moveTo(centerX + normalX * 5, centerY + normalY * 5);
        canvasContext.lineTo(centerX - normalX * 5, centerY - normalY * 5);
        canvasContext.stroke();
      }
    });
    canvasContext.restore();
  }

  function pointOnRoute(route, distance) {
    const firstSegment = route.segments[0];
    const lastSegment = route.segments[route.segments.length - 1];
    if (distance < 0) {
      return {
        x: firstSegment.startX + firstSegment.directionX * distance,
        y: firstSegment.startY + firstSegment.directionY * distance,
        directionX: firstSegment.directionX,
        directionY: firstSegment.directionY
      };
    }
    if (distance > route.length) {
      const overflow = distance - route.length;
      return {
        x: lastSegment.endX + lastSegment.directionX * overflow,
        y: lastSegment.endY + lastSegment.directionY * overflow,
        directionX: lastSegment.directionX,
        directionY: lastSegment.directionY
      };
    }

    const boundedDistance = distance;
    const segment = route.segments.find((candidate) => (
      boundedDistance <= candidate.endDistance + EPSILON
    ));
    if (!segment) return null;
    const offset = boundedDistance - segment.startDistance;
    return {
      x: segment.startX + segment.directionX * offset,
      y: segment.startY + segment.directionY * offset,
      directionX: segment.directionX,
      directionY: segment.directionY
    };
  }

  function drawTrainCar(canvasContext, point, length, width, locomotive, palette) {
    const angle = Math.atan2(point.directionY, point.directionX);
    canvasContext.save();
    canvasContext.translate(point.x, point.y);
    canvasContext.rotate(angle);
    canvasContext.fillStyle = palette.outline;
    canvasContext.fillRect(-length / 2 - 2, -width / 2 - 2, length + 4, width + 4);
    canvasContext.fillStyle = locomotive ? palette.locomotive : palette.car;
    canvasContext.fillRect(-length / 2, -width / 2, length, width);

    canvasContext.fillStyle = palette.panel;
    canvasContext.fillRect(-length / 2 + 4, -width / 2 + 4, length * 0.38, width - 8);
    canvasContext.fillStyle = palette.window;
    if (locomotive) {
      canvasContext.fillRect(length * 0.03, -width * 0.32, length * 0.2, width * 0.23);
      canvasContext.fillRect(length * 0.03, width * 0.09, length * 0.2, width * 0.23);
      canvasContext.fillStyle = palette.lamp;
      canvasContext.fillRect(length / 2 - 3, -3, 4, 6);
      canvasContext.fillStyle = palette.chimney;
      canvasContext.fillRect(-length * 0.34, -width / 2 - 4, 7, 4);
    } else {
      canvasContext.fillRect(-length * 0.05, -width * 0.31, length * 0.16, width * 0.18);
      canvasContext.fillRect(-length * 0.05, width * 0.13, length * 0.16, width * 0.18);
    }
    canvasContext.fillStyle = palette.wheel;
    canvasContext.fillRect(-length * 0.3, -width / 2 - 2, length * 0.16, 4);
    canvasContext.fillRect(length * 0.14, -width / 2 - 2, length * 0.16, 4);
    canvasContext.fillRect(-length * 0.3, width / 2 - 2, length * 0.16, 4);
    canvasContext.fillRect(length * 0.14, width / 2 - 2, length * 0.16, 4);
    canvasContext.restore();
  }

  function drawTrain(canvasContext, route, headDistance, width, opacity, palette) {
    if (!route || route.segments.length === 0 || opacity <= 0) return;

    const bodyStart = headDistance - TRAIN_LENGTH;
    const bodyEnd = headDistance;

    const carLength = 46;
    const carSpacing = 50;

    canvasContext.save();
    canvasContext.globalAlpha *= opacity;
    for (
      let centerDistance = bodyEnd - carLength / 2, carIndex = 0;
      centerDistance >= bodyStart;
      centerDistance -= carSpacing, carIndex += 1
    ) {
      const point = pointOnRoute(route, centerDistance);
      if (!point) continue;
      drawTrainCar(
        canvasContext,
        point,
        carLength,
        width,
        carIndex === 0,
        palette
      );
    }
    canvasContext.restore();
  }

  function trainOpacity(route, distance) {
    const exitDistance = route.length + TRAIN_LENGTH;
    const fadeDistance = TRAIN_SPEED * TRAIN_FADE_DURATION;
    return clamp((exitDistance - distance) / fadeDistance, 0, 1);
  }

  const trainWeaponDefinition = {
    id: "bilitoy-train-weapon",
    name: "列车武器",
    englishName: "Train Weapon",
    color: "#4ce66a",
    description: "四次撞边铺轨 / 列车冲撞",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services, options = {}) {
      const trainPalette = options.trainPalette === "red"
        ? RED_TRAIN_PALETTE
        : GREEN_TRAIN_PALETTE;
      const resolveTrainDamage = typeof options.resolveTrainDamage === "function"
        ? options.resolveTrainDamage
        : () => TRAIN_DAMAGE;
      const railCooldown = Number.isFinite(options.railCooldown)
        ? Math.max(0, options.railCooldown)
        : 0;
      // 列车击退时长可由调用方覆写（六王球的锤击列车用它统一到 0.16s）。
      const trainKnockbackDuration = Number.isFinite(options.trainKnockbackDuration)
        ? options.trainKnockbackDuration
        : TRAIN_KNOCKBACK_DURATION;
      let state = "laying";
      let stateTime = 0;
      let edgeContactCount = 0;
      let trackPoints = [];
      let route = null;
      let trainDistance = 0;
      let trainContacts = new Set();
      let trainEntity = null;
      let railCooldownRemaining = 0;

      function transitionTo(nextState) {
        state = nextState;
        stateTime = 0;
      }

      function beginTrain() {
        route = buildRoute(trackPoints);
        trainDistance = 0;
        trainContacts = new Set();
        transitionTo("train");
      }

      function resetToLaying() {
        edgeContactCount = 0;
        trackPoints = [];
        route = null;
        trainDistance = 0;
        trainContacts = new Set();
        railCooldownRemaining = 0;
        transitionTo("laying");
      }

      function recordTrackPoint(x, y) {
        const next = { x, y };
        const last = trackPoints[trackPoints.length - 1];
        if (!last) {
          trackPoints.push(next);
          return;
        }
        if (Math.hypot(next.x - last.x, next.y - last.y) <= EPSILON) return;

        const beforeLast = trackPoints[trackPoints.length - 2];
        if (beforeLast) {
          const previousX = last.x - beforeLast.x;
          const previousY = last.y - beforeLast.y;
          const nextX = next.x - last.x;
          const nextY = next.y - last.y;
          const previousLength = Math.hypot(previousX, previousY);
          const nextLength = Math.hypot(nextX, nextY);
          const cross = previousX * nextY - previousY * nextX;
          const dot = previousX * nextX + previousY * nextY;
          if (
            previousLength > EPSILON &&
            nextLength > EPSILON &&
            Math.abs(cross) <= previousLength * nextLength * 0.001 &&
            dot > 0
          ) {
            trackPoints[trackPoints.length - 1] = next;
            return;
          }
        }
        trackPoints.push(next);
      }

      function collideWithTrain(ball, target, trainServices) {
        if (!route) return;
        const contactKey = target.instanceId;
        const trainSegments = trainBodySegments(route, trainDistance);
        let nearest = null;
        trainSegments.forEach((segment) => {
          const candidate = closestPointOnSegment(target.x, target.y, segment);
          if (!nearest || candidate.distance < nearest.distance) {
            nearest = candidate;
          }
        });

        const contactDistance = target.radius + TRAIN_WIDTH / 2;
        if (!nearest || nearest.distance >= contactDistance) {
          trainContacts.delete(contactKey);
          return;
        }

        let normalX = target.x - nearest.x;
        let normalY = target.y - nearest.y;
        const normalLength = Math.hypot(normalX, normalY);
        if (normalLength <= EPSILON) {
          normalX = -nearest.directionY;
          normalY = nearest.directionX;
        } else {
          normalX /= normalLength;
          normalY /= normalLength;
        }

        if (!trainContacts.has(contactKey)) {
          const resolvedDamage = resolveTrainDamage({
            ball,
            target,
            contactX: nearest.x,
            contactY: nearest.y,
            defaultDamage: TRAIN_DAMAGE
          });
          const damage = Number.isFinite(resolvedDamage)
            ? resolvedDamage
            : TRAIN_DAMAGE;
          if (!trainServices.dealDamage(target, damage)) return;
          trainContacts.add(contactKey);
          trainServices.applyEffect(
            target,
            createTrainKnockback(trainEntity, normalX, normalY, trainKnockbackDuration)
          );
          spawnTrainImpact(
            trainServices,
            nearest.x + normalX * TRAIN_WIDTH / 2,
            nearest.y + normalY * TRAIN_WIDTH / 2
          );
        }

        target.x = nearest.x + normalX * contactDistance;
        target.y = nearest.y + normalY * contactDistance;
        const velocityTowardTrain = target.vx * normalX + target.vy * normalY;
        if (velocityTowardTrain < 0) {
          target.vx -= velocityTowardTrain * 2 * normalX;
          target.vy -= velocityTowardTrain * 2 * normalY;
          target.storedVx = target.vx;
          target.storedVy = target.vy;
        }
      }

      function advanceExistingTrain(ball, dt) {
        const elapsed = Math.max(0, dt);
        if (state === "arming") {
          stateTime = Math.min(TRAIN_DELAY, stateTime + elapsed);
        } else if (state === "train") {
          const maximumDistance = route.length + TRAIN_LENGTH;
          trainDistance = Math.min(
            maximumDistance,
            trainDistance + TRAIN_SPEED * elapsed
          );
        } else if (state === "fading") {
          stateTime = Math.min(TRAIN_FADE_DURATION, stateTime + elapsed);
        }
      }

      function existingTrainBoundary() {
        if (state === "arming") return Math.max(EPSILON, TRAIN_DELAY - stateTime);
        if (state === "train") {
          return Math.max(
            EPSILON,
            (route.length + TRAIN_LENGTH - trainDistance) / TRAIN_SPEED
          );
        }
        if (state === "fading") {
          return Math.max(EPSILON, TRAIN_FADE_DURATION - stateTime);
        }
        return undefined;
      }

      function resolveExistingTrain(ball, trainServices) {
        if (state === "train") {
          trainServices.forEachEnemy((target) => {
            collideWithTrain(ball, target, trainServices);
          });
          if (trainDistance + EPSILON >= route.length + TRAIN_LENGTH) {
            transitionTo("fading");
          }
        } else if (state === "arming" && stateTime + EPSILON >= TRAIN_DELAY) {
          beginTrain();
        } else if (state === "fading" && stateTime + EPSILON >= TRAIN_FADE_DURATION) {
          if (trainEntity) trainEntity.entityActive = false;
          trainEntity = null;
          transitionTo("cooldown");
        }
      }

      function spawnTrainEntity(context) {
        if (trainEntity && trainEntity.entityActive !== false) return;
        trainEntity = services.spawnCombatEntity({
          kind: "light-rail-train",
          combatKind: "zone",
          life: Number.MAX_SAFE_INTEGER,
          drawLayer: "background",
          update({ entity, services: trainServices }, dt) {
            if (trainEntity !== entity) return;
            advanceExistingTrain(entity.owner, dt);
            resolveExistingTrain(entity.owner, trainServices);
          },
          draw({ entity }, canvasContext) {
            if (entity.owner.fade > 0 && !services.borrowedAttackOnly) return;
            const rails = route || buildRoute(trackPoints);
            const fadeProgress = clamp(stateTime / TRAIN_FADE_DURATION, 0, 1);
            const opacity = state === "fading"
              ? 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
              : (state === "cooldown" ? 0 : 1);
            drawRails(canvasContext, rails, opacity);
            if (state === "train") {
              drawTrain(
                canvasContext,
                route,
                trainDistance,
                TRAIN_WIDTH,
                route ? trainOpacity(route, trainDistance) : 0,
                trainPalette
              );
            }
          }
        });
      }

      return {
        isAttackCycleComplete() { return !!trainEntity; },
        update(context, dt) {
          railCooldownRemaining = Math.max(
            0,
            railCooldownRemaining - Math.max(0, dt)
          );
          if (!trainEntity && state === "cooldown") {
            stateTime = Math.min(REARM_DELAY, stateTime + Math.max(0, dt));
          }
        },
        getNextPausedTransitionIn() {
          return existingTrainBoundary();
        },
        getNextTransitionIn() {
          const existingBoundary = existingTrainBoundary();
          if (existingBoundary !== undefined) return existingBoundary;
          if (state === "cooldown") {
            return Math.max(
              EPSILON,
              Math.min(REARM_DELAY - stateTime, railCooldownRemaining || Infinity)
            );
          }
          return undefined;
        },
        afterUpdateStep(context) {
          if (state === "laying" && edgeContactCount > 0) {
            recordTrackPoint(context.ball.x, context.ball.y);
          } else if (
            state === "cooldown" &&
            stateTime + EPSILON >= REARM_DELAY &&
            railCooldownRemaining <= EPSILON
          ) {
            resetToLaying();
          }
        },
        onWallBounce(context) {
          if (state !== "laying") return;
          const { ball, game } = context;
          const contact = getArenaWallContacts(context)[0];
          if (!contact) return;
          const firstPointX = contact.x;
          const firstPointY = contact.y;
          if (edgeContactCount === 0) {
            trackPoints = [{ x: firstPointX, y: firstPointY }];
          } else {
            recordTrackPoint(ball.x, ball.y);
            recordTrackPoint(firstPointX, firstPointY);
          }
          edgeContactCount += 1;
          if (edgeContactCount === REQUIRED_CONTACTS) {
            route = buildRoute(trackPoints);
            railCooldownRemaining = railCooldown;
            spawnTrainEntity(context);
            transitionTo("arming");
          }
        },
        drawArenaBackground(context, canvasContext) {
          if (services.borrowedAttackOnly && trainEntity) return;
          const rails = route || buildRoute(trackPoints);
          const fadeProgress = clamp(stateTime / TRAIN_FADE_DURATION, 0, 1);
          const opacity = state === "fading"
            ? 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
            : (state === "cooldown" ? 0 : 1);
          drawRails(canvasContext, rails, opacity);
        },
        drawArenaForeground(context, canvasContext) {
          if (services.borrowedAttackOnly && trainEntity) return;
          if (state === "train") {
            drawTrain(
              canvasContext,
              route,
              trainDistance,
              TRAIN_WIDTH,
              route ? trainOpacity(route, trainDistance) : 0,
              trainPalette
            );
          }
        },
        getLightState() {
          return {
            state,
            stateTime,
            edgeContactCount,
            trackPoints: trackPoints.map((point) => ({ ...point })),
            routeLength: route ? route.length : 0,
            trainDistance,
            trainLength: TRAIN_LENGTH,
            trainSpeed: TRAIN_SPEED,
            trainWidth: TRAIN_WIDTH,
            railCooldown,
            railCooldownRemaining
          };
        }
      };
    }
  };


  return {
    trainWeaponDefinition,
    // 列车击退是复用件：钢卷要用同一套击退手感。
    createTrainKnockback,
    TRAIN_KNOCKBACK_DURATION,
    TRAIN_KNOCKBACK_SPEED_MULTIPLIER
  };
});
