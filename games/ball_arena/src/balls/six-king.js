(function initializeSixKing(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js")),
        ...require("./hammer-v2.js"),
        ...require("./international-chess.js"),
        ...require("./wdc.js"),
        ...require("./green.js"),
        ...require("./spiderweb.js"),
        ...require("./train-weapon.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSixKingPlugin(dependencies) {
  "use strict";

  const {
    resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback,
    hammerV2Definition,
    internationalChessDefinition,
    wdcDefinition,
    greenDefinition,
    spiderwebDefinition,
    trainWeaponDefinition,
    createGreenPoisonEffect,
    createGreenCone,
    greenConeTouchesBall,
    resolveGreenConeCollision,
    drawGreenCones,
    spiderwebSweepTouchesSilk,
    spiderwebCurrentlyTouchesSilk,
    drawSpiderwebSilk,
    SPIDERWEB_SILK_HALF_WIDTH
  } = dependencies;

  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const CONE_DAMAGE = 3;
  const SILK_DAMAGE = 1;
  const FUSED_TRACK_CONTACTS = 3;
  const FUSED_TRACK_SPEED = 250;
  const FUSED_SPIKE_RADIUS = 6;
  const FUSED_SPIKE_EXIT_MARGIN = 30;
  const FUSED_SILK_FADE_DISTANCE = 60;
  // 0.05 -> 0.16：六王球的两处击退（融合毒刺、锤击列车）统一时长。
  const FUSED_KNOCKBACK_DURATION = 0.16;
  const TRAIN_KNOCKBACK_DURATION = 0.16;
  const FUSED_KNOCKBACK_SPEED_MULTIPLIER = 2;
  const EPSILON = 1e-9;
  const EPSILON_SQUARED = EPSILON * EPSILON;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }
  const SECTOR_COLORS = [
    "#8e5021",
    "#40de2b",
    "#db150b",
    "#d2a400",
    "#1f58ff",
    "#ecebf2"
  ];
  const SIX_KING_E_OPTIONS = Object.freeze({
    fusedTrack: true,
    fusedTrackContacts: FUSED_TRACK_CONTACTS,
    fusedTrackSpeed: FUSED_TRACK_SPEED,
    fusedSpikeRadius: FUSED_SPIKE_RADIUS,
    fusedSpikeExitMargin: FUSED_SPIKE_EXIT_MARGIN,
    fusedSilkFadeDistance: FUSED_SILK_FADE_DISTANCE,
    linkedSpawnCooldown: 10,
    coneDamage: 1,
    silkDamage: 1,
    poisonOptions: Object.freeze({ damageTicks: 1 }),
    hammerOptions: Object.freeze({
      centerDistance: 30,
      headWidth: 24,
      headHeight: 12,
      triggerDistance: 30,
      normalRotationPeriod: 2,
      attackSpeedMultiplier: 1,
      damage: 1,
      dazeDuration: 0.75,
      knockbackSpeedMultiplier: 1.8,
      contactAttack: true,
      smokeAlways: true
    }),
    chessOptions: Object.freeze({
      normalDuration: 5,
      collisionDamage: 1,
      knockbackSpeedMultiplier: 6.5 / 4,
      routeHitboxShape: "circle",
      routeHitboxRadius: 15,
      singleStep: true
    }),
    wdcOptions: Object.freeze({
      alwaysDomain: true,
      refreshInterval: 3
    }),
    railCooldown: 8
  });

  function callHook(behavior, hook, context, ...args) {
    const callback = behavior && behavior[hook];
    return typeof callback === "function"
      ? callback.call(behavior, context, ...args)
      : undefined;
  }

  function positiveMinimum(values) {
    let minimum;
    for (const value of values) {
      if (!Number.isFinite(value) || value <= 0) continue;
      minimum = minimum === undefined ? value : Math.min(minimum, value);
    }
    return minimum;
  }

  function mergeCapabilityOverrides(behaviors, context) {
    let merged = null;
    for (const behavior of behaviors) {
      const overrides = callHook(behavior, "getCapabilityOverrides", context);
      if (overrides && typeof overrides === "object") {
        merged = { ...(merged || {}), ...overrides };
      }
    }
    return merged;
  }

  function coneTip(cone) {
    return cone.vertices[2];
  }

  function closestPointOnLine(x, y, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON_SQUARED
      ? 0
      : Math.max(0, Math.min(1, (
        (x - startX) * deltaX + (y - startY) * deltaY
      ) / lengthSquared));
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  function buildFusedRoute(points) {
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

  function pointOnFusedRoute(route, distance) {
    if (!route || route.segments.length === 0) return null;
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
    const segment = route.segments.find((candidate) => (
      distance <= candidate.endDistance + EPSILON
    ));
    if (!segment) return null;
    const offset = distance - segment.startDistance;
    return {
      x: segment.startX + segment.directionX * offset,
      y: segment.startY + segment.directionY * offset,
      directionX: segment.directionX,
      directionY: segment.directionY
    };
  }

  function pointToSegmentDistance(x, y, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON_SQUARED
      ? 0
      : Math.max(0, Math.min(1, (
        (x - startX) * deltaX + (y - startY) * deltaY
      ) / lengthSquared));
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    return {
      distance: Math.hypot(x - closestX, y - closestY),
      x: closestX,
      y: closestY,
      progress
    };
  }

  function drawFusedSilk(canvasContext, route, headDistance, fadeDistance, opacity = 1) {
    if (!route || route.segments.length === 0 || opacity <= 0) return;
    const fade = Math.max(1, fadeDistance);
    canvasContext.save();
    canvasContext.strokeStyle = "#ffffff";
    canvasContext.lineWidth = SPIDERWEB_SILK_HALF_WIDTH * 2;
    canvasContext.lineCap = "round";
    const baseAlpha = canvasContext.globalAlpha;
    route.segments.forEach((segment) => {
      const samples = Math.max(1, Math.ceil((segment.endDistance - segment.startDistance) / 8));
      for (let index = 0; index < samples; index += 1) {
        const startDistance = segment.startDistance + (
          (segment.endDistance - segment.startDistance) * index / samples
        );
        const endDistance = segment.startDistance + (
          (segment.endDistance - segment.startDistance) * (index + 1) / samples
        );
        const midpoint = (startDistance + endDistance) / 2;
        const alpha = headDistance <= EPSILON
          ? 1
          : clamp((midpoint - (headDistance - fade)) / fade, 0, 1);
        if (alpha <= 0) continue;
        const startX = segment.startX + segment.directionX * (
          startDistance - segment.startDistance
        );
        const startY = segment.startY + segment.directionY * (
          startDistance - segment.startDistance
        );
        const endX = segment.startX + segment.directionX * (
          endDistance - segment.startDistance
        );
        const endY = segment.startY + segment.directionY * (
          endDistance - segment.startDistance
        );
        canvasContext.globalAlpha = baseAlpha * alpha * opacity * 0.7;
        canvasContext.beginPath();
        canvasContext.moveTo(startX, startY);
        canvasContext.lineTo(endX, endY);
        canvasContext.stroke();
      }
    });
    canvasContext.restore();
  }

  function drawFusedSpike(canvasContext, point, radius, opacity = 1) {
    if (!point || opacity <= 0) return;
    const directionX = Number.isFinite(point.directionX) ? point.directionX : 1;
    const directionY = Number.isFinite(point.directionY) ? point.directionY : 0;
    const normalX = -directionY;
    const normalY = directionX;
    const baseDistance = Math.max(8, radius * 2.2);
    const tipDistance = Math.max(5, radius * 1.1);
    canvasContext.save();
    canvasContext.globalAlpha *= opacity;
    canvasContext.fillStyle = "#00b86b";
    canvasContext.strokeStyle = "#72ffc0";
    canvasContext.lineWidth = 1.2;
    canvasContext.beginPath();
    canvasContext.moveTo(
      point.x + directionX * tipDistance,
      point.y + directionY * tipDistance
    );
    canvasContext.lineTo(
      point.x - directionX * baseDistance + normalX * radius,
      point.y - directionY * baseDistance + normalY * radius
    );
    canvasContext.lineTo(
      point.x - directionX * baseDistance - normalX * radius,
      point.y - directionY * baseDistance - normalY * radius
    );
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();
    canvasContext.restore();
  }

  function createFusedTrainKnockback(entityId, directionX, directionY) {
    return createSharedKnockback({
      id: `six-king-fused-knockback-${entityId}`,
      duration: FUSED_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: FUSED_KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function spawnFusedTrainImpact(services, x, y) {
    services.spawnParticleBurst({
      kind: "six-king-fused-spike-impact",
      x,
      y,
      minDiameter: 1,
      maxDiameter: 8,
      colors: ["#ffffff", "#969ba0"],
      initialRadius: 25,
      life: 0.42
    });
  }

  function createLinkedCone(context) {
    const cone = createGreenCone(context);
    const tip = coneTip(cone);
    return {
      ...cone,
      kind: "six-king-poison-silk",
      combatKind: "trap",
      trap: true,
      life: PERMANENT_LIFE,
      drawLayer: "background",
      anchorX: tip.x,
      anchorY: tip.y,
      start: tip,
      end: context.ball,
      owner: context.ball,
      color: "#ffffff",
      touchingCone: new Set(),
      touchingSilk: new Set()
    };
  }

  function drawSixSectorBody(context, canvasContext) {
    const { ball } = context;
    canvasContext.save();
    canvasContext.translate(ball.x, ball.y);
    for (let index = 0; index < SECTOR_COLORS.length; index += 1) {
      const start = -Math.PI / 2 + index * Math.PI / 3;
      const end = start + Math.PI / 3;
      canvasContext.fillStyle = SECTOR_COLORS[index];
      canvasContext.beginPath();
      canvasContext.moveTo(0, 0);
      canvasContext.arc(0, 0, ball.radius, start, end);
      canvasContext.closePath();
      canvasContext.fill();
    }
    canvasContext.strokeStyle = "#24262a";
    canvasContext.lineWidth = 1.5;
    canvasContext.beginPath();
    canvasContext.arc(0, 0, ball.radius, 0, Math.PI * 2);
    canvasContext.stroke();
    canvasContext.restore();
    return true;
  }

  const sixKingDefinition = {
    id: "sixKing",
    name: "六王球",
    englishName: "Six King",
    color: "#d5d7da",
    rosterType: "outOfSpec",
    description: "六王融合 / 双领域 / 毒刺蛛网 / 锤击列车",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 8,
    createBehavior(services, options = {}) {
      const fusedTrack = options.fusedTrack === true;
      const fusedTrackContacts = Number.isFinite(options.fusedTrackContacts)
        ? Math.max(1, Math.floor(options.fusedTrackContacts))
        : FUSED_TRACK_CONTACTS;
      const fusedTrackSpeed = Number.isFinite(options.fusedTrackSpeed)
        ? Math.max(1, options.fusedTrackSpeed)
        : FUSED_TRACK_SPEED;
      const fusedSpikeRadius = Number.isFinite(options.fusedSpikeRadius)
        ? Math.max(1, options.fusedSpikeRadius)
        : FUSED_SPIKE_RADIUS;
      const fusedSpikeExitMargin = Number.isFinite(options.fusedSpikeExitMargin)
        ? Math.max(1, options.fusedSpikeExitMargin)
        : FUSED_SPIKE_EXIT_MARGIN;
      const fusedSilkFadeDistance = Number.isFinite(options.fusedSilkFadeDistance)
        ? Math.max(1, options.fusedSilkFadeDistance)
        : FUSED_SILK_FADE_DISTANCE;
      let ownerBall = null;
      let arenaSize = 0;
      const linkedSpawnCooldown = Number.isFinite(options.linkedSpawnCooldown)
        ? Math.max(0, options.linkedSpawnCooldown)
        : 0;
      const coneDamage = Number.isFinite(options.coneDamage)
        ? options.coneDamage
        : CONE_DAMAGE;
      const silkDamage = Number.isFinite(options.silkDamage)
        ? options.silkDamage
        : SILK_DAMAGE;
      const poisonOptions = options.poisonOptions || {};
      const hammerBehavior = hammerV2Definition.createBehavior(
        services,
        options.hammerOptions || {}
      );
      const wdcBehavior = wdcDefinition.createBehavior(
        services,
        options.wdcOptions || {}
      );
      const chessServices = Object.freeze({
        ...services,
        dealDamage(target, amount, source, options) {
          if (!ownerBall || !arenaSize) {
            return services.dealDamage(target, amount, source, options);
          }
          const hit = {
            x: (ownerBall.x + target.x) / 2,
            y: (ownerBall.y + target.y) / 2
          };
          const damage = wdcDamageAt(hit.x, hit.y, arenaSize, amount);
          if (damage <= 0) return false;
          return services.dealDamage(target, damage, source, options);
        }
      });
      const chessBehavior = internationalChessDefinition.createBehavior(
        chessServices,
        options.chessOptions || {}
      );
      const trainBehavior = trainWeaponDefinition.createBehavior(services, {
        trainPalette: "red",
        railCooldown: options.railCooldown,
        trainKnockbackDuration: TRAIN_KNOCKBACK_DURATION,
        resolveTrainDamage({ contactX, contactY, defaultDamage }) {
          return wdcDamageAt(
            contactX,
            contactY,
            arenaSize,
            defaultDamage
          );
        }
      });
      const behaviors = [
        hammerBehavior,
        chessBehavior,
        wdcBehavior,
        trainBehavior
      ];
      const linkedEntities = [];
      let nextLinkedSpawnAt = 0;
      let fusedTrackState = fusedTrack ? "laying" : "disabled";
      let fusedEdgeContactCount = 0;
      let fusedTrackPoints = [];
      let fusedRoute = null;
      let fusedSpikeEntity = null;

      function wdcDamageAt(x, y, arenaSize, fallback) {
        const damage = callHook(
          wdcBehavior,
          "getWdcDamageAt",
          null,
          x,
          y,
          arenaSize
        );
        if (Number.isFinite(damage)) {
          callHook(wdcBehavior, "recordWdcCellHit", null, x, y, arenaSize);
          return damage;
        }
        return fallback;
      }

      function updateLinkedEntity(entity, entityServices) {
        const owner = entity.owner;
        if (!owner) return;

        const touchingConeNow = new Set();
        const previousOwnerX = Number.isFinite(owner.prevX) ? owner.prevX : owner.x;
        const previousOwnerY = Number.isFinite(owner.prevY) ? owner.prevY : owner.y;
        const ownerMoved = Math.hypot(
          owner.x - previousOwnerX,
          owner.y - previousOwnerY
        ) > EPSILON;

        entityServices.forEachContactEnemy((target) => {
          if (entity.entityActive === false) return;
          const targetKey = target.instanceId;
          const overlapping = greenConeTouchesBall(target, entity);
          entityServices.notifyEntityContact(target, entity, { overlapping });
          if (overlapping) {
            touchingConeNow.add(targetKey);
            const profile = entityServices.getContactProfile(target);
            if (profile.solid && profile.attackable && !entity.touchingCone.has(targetKey)) {
              if (entityServices.tryConsumeEntity(target, entity, { physical: true })) {
                entity.entityActive = false;
                return;
              }
              const damage = wdcDamageAt(
                target.x,
                target.y,
                entity.arenaSize,
                coneDamage
              );
              if (damage > 0) entityServices.dealDamage(target, damage);
              entityServices.applyEffect(
                target,
                createGreenPoisonEffect(poisonOptions)
              );
            }
            if (profile.solid && profile.attackable) {
              resolveGreenConeCollision(target, entity);
            }
          }

          const touchRadius = target.radius + SPIDERWEB_SILK_HALF_WIDTH;
          const wasTouchingSilk = entity.touchingSilk.has(targetKey);
          const isTouchingSilk = spiderwebCurrentlyTouchesSilk(
            target,
            entity,
            owner,
            touchRadius
          );
          const targetMoved = Math.hypot(
            target.x - target.prevX,
            target.y - target.prevY
          ) > EPSILON;
          if (
            !wasTouchingSilk &&
            (ownerMoved || targetMoved) &&
            (isTouchingSilk || spiderwebSweepTouchesSilk(
              target,
              entity,
              owner,
              previousOwnerX,
              previousOwnerY,
              touchRadius
            ))
          ) {
            const hit = closestPointOnLine(
              target.x,
              target.y,
              entity.anchorX,
              entity.anchorY,
              owner.x,
              owner.y
            );
            const damage = wdcDamageAt(
              hit.x,
              hit.y,
              entity.arenaSize,
              silkDamage
            );
            if (damage > 0) entityServices.dealDamage(target, damage);
          }
          if (isTouchingSilk) entity.touchingSilk.add(targetKey);
          else entity.touchingSilk.delete(targetKey);
        });

        entity.touchingCone = touchingConeNow;
      }

      function spawnLinkedEntity(context) {
        const definition = createLinkedCone(context);
        const entity = services.spawnCombatEntity({
          ...definition,
          update({ entity: activeEntity, game, services: entityServices }) {
            activeEntity.arenaSize = game;
            updateLinkedEntity(activeEntity, entityServices);
          },
          draw({ entity: activeEntity }, canvasContext) {
            drawGreenCones(canvasContext, [activeEntity]);
            drawSpiderwebSilk(canvasContext, activeEntity);
          }
        });
        linkedEntities.push(entity);
      }

      function fusedWallPoint(context) {
        const { ball, game } = context;
        if (context.wallContacts && context.wallContacts.length) return context.wallContacts[0];
        return {
          x: context.bouncedX
            ? (ball.x <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.x,
          y: context.bouncedY
            ? (ball.y <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.y
        };
      }

      function recordFusedTrackPoint(point) {
        const last = fusedTrackPoints[fusedTrackPoints.length - 1];
        if (last && Math.hypot(point.x - last.x, point.y - last.y) <= EPSILON) return;
        fusedTrackPoints.push({ x: point.x, y: point.y });
      }

      function fusedSilkSegments(route, headDistance) {
        if (!route || route.segments.length === 0) return [];
        const fadeStart = Math.max(0, headDistance - fusedSilkFadeDistance);
        return route.segments.flatMap((segment, segmentIndex) => {
          if (segment.endDistance <= fadeStart + EPSILON) return [];
          const startDistance = Math.max(segment.startDistance, fadeStart);
          const startOffset = startDistance - segment.startDistance;
          return [{
            ...segment,
            segmentIndex,
            startX: segment.startX + segment.directionX * startOffset,
            startY: segment.startY + segment.directionY * startOffset,
            startDistance
          }];
        });
      }

      function silkSegmentTouchesTarget(target, segment, touchRadius) {
        const pseudoSilk = {
          anchorX: segment.startX,
          anchorY: segment.startY
        };
        const pseudoOwner = {
          x: segment.endX,
          y: segment.endY
        };
        return spiderwebCurrentlyTouchesSilk(target, pseudoSilk, pseudoOwner, touchRadius) ||
          spiderwebSweepTouchesSilk(
            target,
            pseudoSilk,
            pseudoOwner,
            segment.endX,
            segment.endY,
            touchRadius
          );
      }

      function updateFusedSilkContacts(entity, entityServices, route, silkMoved) {
        if (!route || route.segments.length === 0) return;
        const visibleSegments = fusedSilkSegments(route, entity.headDistance || 0);
        const currentTouches = new Set();
        entityServices.forEachEnemy((target) => {
          const profile = entityServices.getContactProfile(target);
          if (!profile.solid || !profile.attackable) return;
          const targetMoved = Math.hypot(
            target.x - target.prevX,
            target.y - target.prevY
          ) > EPSILON;
          visibleSegments.forEach((segment) => {
            const key = `${target.instanceId}:${segment.segmentIndex}`;
            const isTouching = silkSegmentTouchesTarget(
              target,
              segment,
              target.radius + SPIDERWEB_SILK_HALF_WIDTH
            );
            const wasTouching = entity.touchingSilk.has(key);
            if (
              !wasTouching &&
              (targetMoved || silkMoved) &&
              isTouching
            ) {
              const hit = closestPointOnLine(
                target.x,
                target.y,
                segment.startX,
                segment.startY,
                segment.endX,
                segment.endY
              );
              const damage = wdcDamageAt(
                hit.x,
                hit.y,
                entity.arenaSize,
                silkDamage
              );
              if (damage > 0) entityServices.dealDamage(target, damage);
            }
            if (isTouching) currentTouches.add(key);
          });
        });
        entity.touchingSilk = currentTouches;
      }

      function collideFusedSpike(
        entity,
        target,
        entityServices,
        previousPoint,
        point,
        releaseOnMiss = true
      ) {
        const contactRadius = target.radius + fusedSpikeRadius;
        const nearest = pointToSegmentDistance(
          target.x,
          target.y,
          previousPoint.x,
          previousPoint.y,
          point.x,
          point.y
        );
        if (nearest.distance >= contactRadius) {
          if (releaseOnMiss) entity.spikeContacts.delete(target.instanceId);
          return false;
        }
        let normalX = target.x - nearest.x;
        let normalY = target.y - nearest.y;
        const normalLength = Math.hypot(normalX, normalY);
        if (normalLength <= EPSILON) {
          const moveX = point.x - previousPoint.x;
          const moveY = point.y - previousPoint.y;
          const moveLength = Math.hypot(moveX, moveY) || 1;
          normalX = -moveY / moveLength;
          normalY = moveX / moveLength;
        } else {
          normalX /= normalLength;
          normalY /= normalLength;
        }
        const contactKey = target.instanceId;
        const wasHit = entity.spikeContacts.has(contactKey);
        let registeredHit = wasHit;
        if (!wasHit) {
          const damage = wdcDamageAt(
            nearest.x,
            nearest.y,
            entity.arenaSize,
            coneDamage
          );
          const hit = damage > 0 && entityServices.dealDamage(target, damage);
          if (hit && target.hp > 0) {
            entityServices.applyEffect(
              target,
              createFusedTrainKnockback(
                entity.instanceId,
                normalX,
                normalY
              )
            );
            entityServices.applyEffect(
              target,
              createGreenPoisonEffect(poisonOptions)
            );
            spawnFusedTrainImpact(
              entityServices,
              nearest.x + normalX * fusedSpikeRadius,
              nearest.y + normalY * fusedSpikeRadius
            );
            registeredHit = true;
          }
          entity.spikeContacts.add(contactKey);
        }
        if (!registeredHit) return true;
        Object.assign(target, resolveArenaGeometry(entity.arenaSize).clampPoint(nearest.x + normalX * contactRadius, nearest.y + normalY * contactRadius, target.radius));
        const velocityDot = target.vx * normalX + target.vy * normalY;
        if (velocityDot < 0) {
          target.vx -= velocityDot * 2 * normalX;
          target.vy -= velocityDot * 2 * normalY;
          target.storedVx = target.vx;
          target.storedVy = target.vy;
        }
        return true;
      }

      function fusedMotionSegments(route, startDistance, endDistance) {
        if (!route || route.segments.length === 0) return [];
        if (Math.abs(endDistance - startDistance) <= EPSILON) {
          const point = pointOnFusedRoute(route, endDistance);
          return point ? [{ start: point, end: point }] : [];
        }
        const lower = Math.min(startDistance, endDistance);
        const upper = Math.max(startDistance, endDistance);
        return route.segments.flatMap((segment) => {
          if (segment.endDistance < lower - EPSILON || segment.startDistance > upper + EPSILON) {
            return [];
          }
          const segmentStart = pointOnFusedRoute(
            route,
            Math.max(lower, segment.startDistance)
          );
          const segmentEnd = pointOnFusedRoute(
            route,
            Math.min(upper, segment.endDistance)
          );
          return segmentStart && segmentEnd
            ? [{
                start: startDistance <= endDistance ? segmentStart : segmentEnd,
                end: startDistance <= endDistance ? segmentEnd : segmentStart
              }]
            : [];
        });
      }

      function updateFusedTrackEntity(entity, entityServices, game, dt) {
        entity.arenaSize = game;
        if (entity.mode === "laying") {
          const points = fusedTrackPoints.concat([{ x: ownerBall.x, y: ownerBall.y }]);
          entity.route = buildFusedRoute(points);
          updateFusedSilkContacts(
            entity,
            entityServices,
            entity.route,
            true
          );
          return;
        }
        if (entity.mode !== "moving" || !entity.route || entity.route.segments.length === 0) {
          return;
        }
        const previousDistance = entity.headDistance;
        const maximumDistance = entity.route.length + fusedSpikeExitMargin;
        entity.headDistance = Math.min(
          maximumDistance,
          entity.headDistance + fusedTrackSpeed * Math.max(0, dt)
        );
        const previousPoint = pointOnFusedRoute(entity.route, previousDistance);
        const point = pointOnFusedRoute(entity.route, entity.headDistance);
        if (!previousPoint || !point) return;
        entity.x = point.x;
        entity.y = point.y;
        entity.directionX = point.directionX;
        entity.directionY = point.directionY;
        entity.silkFadeProgress = clamp(
          entity.headDistance / fusedSilkFadeDistance,
          0,
          1
        );
        updateFusedSilkContacts(
          entity,
          entityServices,
          entity.route,
          entity.headDistance !== previousDistance
        );
        const motionSegments = fusedMotionSegments(
          entity.route,
          previousDistance,
          entity.headDistance
        );
        entityServices.forEachEnemy((target) => {
          const profile = entityServices.getContactProfile(target);
          if (!profile.solid || !profile.attackable) {
            entity.spikeContacts.delete(target.instanceId);
            return;
          }
          let touchingSpike = false;
          motionSegments.forEach(({ start, end }) => {
            touchingSpike = collideFusedSpike(
              entity,
              target,
              entityServices,
              start,
              end,
              false
            ) || touchingSpike;
          });
          if (!touchingSpike) entity.spikeContacts.delete(target.instanceId);
        });
        if (entity.headDistance + EPSILON >= maximumDistance) {
          resetFusedTrack(entity);
        }
      }

      function resetFusedTrack(entity = fusedSpikeEntity) {
        if (entity) entity.entityActive = false;
        if (fusedSpikeEntity === entity) fusedSpikeEntity = null;
        fusedTrackState = "laying";
        fusedEdgeContactCount = 0;
        fusedTrackPoints = [];
        fusedRoute = null;
      }

      function spawnFusedTrackEntity(context) {
        if (fusedSpikeEntity && fusedSpikeEntity.entityActive !== false) return;
        fusedTrackState = "laying";
        fusedRoute = null;
        fusedSpikeEntity = services.spawnCombatEntity({
          // Keep the established poison-silk kind so existing entity tooling
          // continues to recognise the fused trap while it changes phase.
          kind: "six-king-poison-silk",
          fusedSpike: true,
          combatKind: "trap",
          trap: true,
          lifecycle: "owner-bound",
          life: Number.MAX_SAFE_INTEGER,
          drawLayer: "background",
          mode: "laying",
          route: null,
          headDistance: 0,
          silkFadeProgress: 0,
          spikeContacts: new Set(),
          touchingSilk: new Set(),
          arenaSize: context.game,
          update({ entity, game, services: entityServices }, dt) {
            updateFusedTrackEntity(entity, entityServices, game, dt);
          },
          draw({ entity }, canvasContext) {
            const route = entity.mode === "laying"
              ? buildFusedRoute(fusedTrackPoints.concat([{ x: ownerBall.x, y: ownerBall.y }]))
              : entity.route;
            drawFusedSilk(
              canvasContext,
              route,
              entity.mode === "moving" ? entity.headDistance : 0,
              fusedSilkFadeDistance
            );
            if (entity.mode === "moving") {
              drawFusedSpike(canvasContext, entity, fusedSpikeRadius);
            }
          }
        });
      }

      function beginFusedSpike() {
        if (!fusedSpikeEntity || fusedSpikeEntity.entityActive === false) return;
        fusedRoute = buildFusedRoute(fusedTrackPoints);
        if (fusedRoute.segments.length === 0) {
          resetFusedTrack();
          return;
        }
        fusedSpikeEntity.route = fusedRoute;
        fusedSpikeEntity.mode = "moving";
        fusedSpikeEntity.headDistance = 0;
        fusedSpikeEntity.spikeContacts = new Set();
        fusedSpikeEntity.touchingSilk = new Set();
        fusedTrackState = "moving";
      }

      function handleFusedWallBounce(context) {
        if (fusedTrackState !== "laying") return;
        const point = fusedWallPoint(context);
        if (!fusedSpikeEntity) spawnFusedTrackEntity(context);
        recordFusedTrackPoint(point);
        if (fusedSpikeEntity) fusedSpikeEntity.trackPoints = fusedTrackPoints;
        fusedEdgeContactCount += 1;
        if (fusedEdgeContactCount >= fusedTrackContacts) beginFusedSpike();
      }

      function runBehaviors(hook, context, ...args) {
        for (const behavior of behaviors) callHook(behavior, hook, context, ...args);
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          arenaSize = context.game;
          runBehaviors("onSpawn", context);
        },
        update(context, dt) {
          ownerBall = context.ball;
          arenaSize = context.game;
          // Chess moves first; Light then records the resulting transfer/route
          // positions when it is still laying rails.
          callHook(chessBehavior, "update", context, dt);
          callHook(hammerBehavior, "update", context, dt);
          callHook(wdcBehavior, "update", context, dt);
          callHook(trainBehavior, "update", context, dt);
        },
        updateWhilePaused(context, dt) {
          runBehaviors("updateWhilePaused", context, dt);
        },
        getNextTransitionIn(context) {
          return positiveMinimum(behaviors.map((behavior) => (
            callHook(behavior, "getNextTransitionIn", context)
          )));
        },
        getNextPausedTransitionIn(context) {
          return positiveMinimum(behaviors.map((behavior) => (
            callHook(behavior, "getNextPausedTransitionIn", context)
          )));
        },
        afterUpdateStep(context, dt) {
          callHook(chessBehavior, "afterUpdateStep", context, dt);
          callHook(hammerBehavior, "afterUpdateStep", context, dt);
          callHook(wdcBehavior, "afterUpdateStep", context, dt);
          callHook(trainBehavior, "afterUpdateStep", context, dt);
        },
        afterUpdateStepWhilePaused(context, dt) {
          runBehaviors("afterUpdateStepWhilePaused", context, dt);
        },
        onDeath(context) {
          if (fusedSpikeEntity) fusedSpikeEntity.entityActive = false;
          fusedSpikeEntity = null;
          fusedTrackState = fusedTrack ? "disabled" : fusedTrackState;
          runBehaviors("onDeath", context);
        },
        onWallBounce(context) {
          if (fusedTrack) {
            handleFusedWallBounce(context);
            return;
          }
          const now = context.game && Number.isFinite(context.game.time)
            ? context.game.time
            : 0;
          if (now + EPSILON < nextLinkedSpawnAt) {
            callHook(trainBehavior, "onWallBounce", context);
            return;
          }
          spawnLinkedEntity(context);
          nextLinkedSpawnAt = now + linkedSpawnCooldown;
          callHook(trainBehavior, "onWallBounce", context);
        },
        onCollision(context, target) {
          callHook(wdcBehavior, "onCollision", context, target);
        },
        onBeforeDamage(context, event) {
          return callHook(chessBehavior, "onBeforeDamage", context, event) || event;
        },
        getCapabilityOverrides(context) {
          return mergeCapabilityOverrides(behaviors, context);
        },
        getContactProfile(context) {
          return callHook(chessBehavior, "getContactProfile", context) || {
            solid: true,
            attackable: true
          };
        },
        drawArenaBackground(context, canvasContext) {
          callHook(trainBehavior, "drawArenaBackground", context, canvasContext);
          callHook(wdcBehavior, "drawArenaBackground", context, canvasContext);
          callHook(chessBehavior, "drawArenaBackground", context, canvasContext);
        },
        drawArenaForeground(context, canvasContext) {
          callHook(trainBehavior, "drawArenaForeground", context, canvasContext);
        },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) {
          callHook(hammerBehavior, "drawBorrowedWeapon", context, canvasContext);
        },
        drawBefore(context, canvasContext) {
          callHook(hammerBehavior, "drawBefore", context, canvasContext);
          // 象棋子行为的领域无敌散光（走向中心渐亮、回位渐暗）
          callHook(chessBehavior, "drawBefore", context, canvasContext);
        },
        drawBody: drawSixSectorBody,
        drawAfter(context, canvasContext) {
          callHook(chessBehavior, "drawAfter", context, canvasContext);
        },
        getSixKingState() {
          return {
            linkedEntityCount: linkedEntities.filter((entity) => (
              entity.entityActive !== false
            )).length,
            hammer: callHook(hammerBehavior, "getHammerState", null),
            chess: callHook(chessBehavior, "getDomainState", null),
            wdc: callHook(wdcBehavior, "getWdcDomainState", null),
            train: callHook(trainBehavior, "getLightState", null),
            fusedTrack: {
              state: fusedTrackState,
              edgeContactCount: fusedEdgeContactCount,
              trackPoints: fusedTrackPoints.map((point) => ({ ...point })),
              routeLength: fusedRoute ? fusedRoute.length : 0,
              spikeDistance: fusedSpikeEntity ? fusedSpikeEntity.headDistance : 0,
              spikeSpeed: fusedTrackSpeed,
              silkFadeProgress: fusedSpikeEntity
                ? fusedSpikeEntity.silkFadeProgress || 0
                : 0
            }
          };
        }
      };
    }
  };

  registerBall(sixKingDefinition);
  const sixKingEDefinition = {
    ...sixKingDefinition,
    id: "sixKingE",
    name: "六王球E",
    englishName: "Six King E",
    // 强度适配版归入杂鱼档位，仍可手动进入普通对局。
    rosterType: "zako",
    description: "六王强度适配版 / 接触锤击与常驻烟雾 / 三次撞边铺丝后毒刺驶出 / 单步象棋",
    createBehavior(services) {
      return sixKingDefinition.createBehavior(services, SIX_KING_E_OPTIONS);
    }
  };
  registerBall(sixKingEDefinition);
  return { sixKingDefinition, sixKingEDefinition };
});
