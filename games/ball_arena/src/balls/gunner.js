(function initializeGunnerContestant(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGunnerContestantApi(dependencies) {
  "use strict";
  const { registerBall, createArenaGeometry } = dependencies;

  const EPSILON = 1e-9;
  const DECISION_INTERVAL = 0.05;
  const FIRE_COOLDOWN = 1;
  const BULLET_SPEED = 400;
  const BULLET_DAMAGE = 4;
  const COLLISION_DAMAGE = 4;
  const BULLET_RADIUS = 3;
  const BULLET_LIFE = 2.5;
  const RECOIL_DURATION = 0.06;
  const RECOIL_SPEED = 325;
  const MAX_EVENT_HISTORY = 32;
  const THREAT_FORECAST_HORIZON = BULLET_LIFE;
  const MAX_FORECAST_SEGMENTS = 16;

  const GUNNER_CONSTANTS = Object.freeze({
    decisionInterval: DECISION_INTERVAL,
    fireCooldown: FIRE_COOLDOWN,
    bulletSpeed: BULLET_SPEED,
    bulletDamage: BULLET_DAMAGE,
    collisionDamage: COLLISION_DAMAGE,
    bulletRadius: BULLET_RADIUS,
    bulletLife: BULLET_LIFE,
    recoilDuration: RECOIL_DURATION,
    recoilSpeed: RECOIL_SPEED,
    threatForecastHorizon: THREAT_FORECAST_HORIZON,
    maxForecastSegments: MAX_FORECAST_SEGMENTS
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function definedOr(value, fallback) {
    return value !== null && value !== undefined ? value : fallback;
  }

  function normalizeVector(x, y, fallbackX = 1, fallbackY = 0) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) return { x: fallbackX, y: fallbackY };
    return { x: x / magnitude, y: y / magnitude };
  }

  function nextWallContactIn(ball, arenaSize) {
    const radius = finiteOr(ball.radius, 15);
    if (arenaSize && typeof arenaSize === "object") {
      const speed = Math.hypot(ball.vx, ball.vy);
      if (speed <= EPSILON) return null;
      return arenaSize.movementLimit(
        ball.x, ball.y, ball.vx / speed, ball.vy / speed,
        Number.MAX_VALUE, radius
      ) / speed;
    }
    const candidates = [];
    if (ball.vx > EPSILON) candidates.push((arenaSize - radius - ball.x) / ball.vx);
    if (ball.vx < -EPSILON) candidates.push((radius - ball.x) / ball.vx);
    if (ball.vy > EPSILON) candidates.push((arenaSize - radius - ball.y) / ball.vy);
    if (ball.vy < -EPSILON) candidates.push((radius - ball.y) / ball.vy);
    const positive = candidates.filter((value) => Number.isFinite(value) && value >= 0);
    return positive.length > 0 ? Math.min(...positive) : null;
  }

  function snapshotEffects(ball, now) {
    if (!(ball && ball.effects instanceof Map)) return [];
    return Array.from(ball.effects.entries())
      .map(([id, effect]) => {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) return null;
        return Object.freeze({
          id: String(effect.id || id),
          remaining: Math.max(0, effect.expiresAt - now),
          visualType: effect.visualType ? String(effect.visualType) : null,
          locksMovement: effect.locksMovement === true,
          pausesBehavior: effect.pausesBehavior === true,
          preventsAttack: effect.preventsAttack === true,
          blocksDamageOutput: effect.blocksDamageOutput === true,
          sealsAbilities: effect.sealsAbilities === true
        });
      })
      .filter(Boolean);
  }

  function fallbackCapabilities(ball, now) {
    const capabilities = {
      canMove: ball && ball.movementLocked !== true,
      canAct: true,
      canBodyAttack: true,
      canDealDamage: true
    };
    for (const effect of snapshotEffects(ball, now)) {
      if (effect.locksMovement) capabilities.canMove = false;
      if (effect.pausesBehavior) capabilities.canAct = false;
      if (effect.preventsAttack) capabilities.canBodyAttack = false;
      if (effect.blocksDamageOutput) capabilities.canDealDamage = false;
      if (effect.sealsAbilities) {
        capabilities.canAct = false;
        capabilities.canBodyAttack = false;
        capabilities.canDealDamage = false;
      }
    }
    return Object.freeze(capabilities);
  }

  function freezeCapabilities(capabilities, fallback) {
    const source = capabilities && typeof capabilities === "object" ? capabilities : fallback;
    return Object.freeze({
      canMove: source.canMove !== false,
      canAct: source.canAct !== false,
      canBodyAttack: source.canBodyAttack !== false,
      canDealDamage: source.canDealDamage !== false
    });
  }

  function segmentCoordinates(entity) {
    const source = entity && entity.shape && typeof entity.shape === "object"
      ? entity.shape
      : {};
    const start = entity && entity.start && typeof entity.start === "object"
      ? entity.start
      : source.start;
    const end = entity && entity.end && typeof entity.end === "object"
      ? entity.end
      : source.end;
    const startX = finiteOr(entity && definedOr(entity.startX, definedOr(source.startX, start && start.x)), NaN);
    const startY = finiteOr(entity && definedOr(entity.startY, definedOr(source.startY, start && start.y)), NaN);
    const endX = finiteOr(entity && definedOr(entity.endX, definedOr(source.endX, end && end.x)), NaN);
    const endY = finiteOr(entity && definedOr(entity.endY, definedOr(source.endY, end && end.y)), NaN);
    return { startX, startY, endX, endY };
  }

  function snapshotShape(entity, radius) {
    const source = entity && entity.shape && typeof entity.shape === "object"
      ? entity.shape
      : {};
    const { startX, startY, endX, endY } = segmentCoordinates(entity);
    const hasSegment = [startX, startY, endX, endY].every(Number.isFinite);
    const type = String(source.type || entity.shapeType || (hasSegment ? "segment" : (
      entity.isProjectile === true ? "circle" : "unknown"
    )));
    const segmentLength = hasSegment
      ? Math.hypot(endX - startX, endY - startY)
      : null;
    const shape = {
      type,
      radius,
      width: finiteOr(entity && definedOr(entity.width, definedOr(source.width, (
        Number.isFinite(entity.halfWidth) ? entity.halfWidth * 2 : null
      ))), null),
      height: finiteOr(entity && definedOr(entity.height, source.height), null),
      length: finiteOr(entity && definedOr(entity.length, definedOr(source.length, segmentLength)), null),
      angle: finiteOr(entity && definedOr(entity.angle, source.angle), null)
    };
    if (hasSegment) Object.assign(shape, { startX, startY, endX, endY });
    return Object.freeze(shape);
  }

  function snapshotTargeting(entity) {
    const source = entity && entity.combatSource;
    const policy = source && source.targetPolicy
      ? source.targetPolicy
      : entity && entity.targetPolicy;
    const forcedTargetInstanceId = policy && typeof policy === "object" &&
      policy.forcedTargetInstanceId
      ? String(policy.forcedTargetInstanceId)
      : null;
    return Object.freeze({
      mode: entity && entity.targeting ? String(entity.targeting) : (
        forcedTargetInstanceId ? "forced" : "enemy"
      ),
      forcedTargetInstanceId
    });
  }

  function traceArenaFlight(snapshot, arena, horizon) {
    let remaining = Math.max(0, Math.min(horizon, snapshot.remainingLife));
    let { x, y, vx, vy } = snapshot;
    let elapsed = 0;
    let bounces = 0;
    let expired = false;
    const segments = [];
    while (remaining > EPSILON && segments.length < MAX_FORECAST_SEGMENTS) {
      const nextX = x + vx * remaining;
      const nextY = y + vy * remaining;
      const hit = arena.traceSegment(x, y, nextX, nextY, snapshot.radius);
      const duration = hit ? remaining * hit.t : remaining;
      segments.push(Object.freeze({
        t0: elapsed, t1: elapsed + duration,
        x1: x, y1: y, x2: hit ? hit.x : nextX, y2: hit ? hit.y : nextY,
        vx, vy, bouncedAtEnd: Boolean(hit)
      }));
      x = hit ? hit.x : nextX;
      y = hit ? hit.y : nextY;
      elapsed += duration;
      remaining -= duration;
      if (!hit) break;
      if (Number.isInteger(snapshot.remainingBounces) && bounces >= snapshot.remainingBounces) {
        expired = true;
        break;
      }
      // Straight-wall corners reflect both axes; curved walls use their radial normal.
      if (arena.shape === "rectangle" && hit.normalX && hit.normalY) {
        vx = -vx;
        vy = -vy;
      } else {
        const dot = vx * hit.normalX + vy * hit.normalY;
        vx -= 2 * dot * hit.normalX;
        vy -= 2 * dot * hit.normalY;
      }
      bounces += 1;
    }
    return { segments, x, y, vx, vy, bounces, expired };
  }

  function getGunnerArenaGeometry(metadata) {
    return metadata && metadata.shape && metadata.shape !== "square"
      ? createArenaGeometry({ shape: metadata.shape, width: metadata.width, height: metadata.height })
      : null;
  }

  function getGunnerWallNormal(arena, x, y, radius, tolerance = 2) {
    if (arena.shape === "circle") return normalizeVector(arena.centerX - x, arena.centerY - y);
    let nx = 0;
    let ny = 0;
    if (x <= arena.left + radius + tolerance) nx += 1;
    if (x >= arena.right - radius - tolerance) nx -= 1;
    if (y <= arena.top + radius + tolerance) ny += 1;
    if (y >= arena.bottom - radius - tolerance) ny -= 1;
    const fallback = normalizeVector(arena.centerX - x, arena.centerY - y);
    return normalizeVector(nx, ny, fallback.x, fallback.y);
  }

  function forecastSegments(snapshot, arenaSize, horizon = THREAT_FORECAST_HORIZON) {
    if (!snapshot) return [];
    let remaining = Math.max(0, Math.min(
      finiteOr(horizon, THREAT_FORECAST_HORIZON),
      finiteOr(snapshot.remainingLife, finiteOr(snapshot.life, 0))
    ));
    if (arenaSize && typeof arenaSize === "object") {
      return traceArenaFlight({ ...snapshot, remainingLife: remaining }, arenaSize, remaining).segments;
    }
    let x = snapshot.x;
    let y = snapshot.y;
    let vx = snapshot.vx;
    let vy = snapshot.vy;
    let elapsed = 0;
    let bouncesLeft = Number.isInteger(snapshot.remainingBounces)
      ? Math.max(0, snapshot.remainingBounces)
      : null;
    const segments = [];
    while (remaining > EPSILON && segments.length < MAX_FORECAST_SEGMENTS) {
      const wallIn = nextWallContactIn({ x, y, vx, vy, radius: snapshot.radius }, arenaSize);
      const duration = Math.min(remaining, Number.isFinite(wallIn) ? Math.max(0, wallIn) : remaining);
      const nextX = x + vx * duration;
      const nextY = y + vy * duration;
      const reachesWall = Number.isFinite(wallIn) && wallIn <= duration + EPSILON;
      const segment = {
        t0: elapsed,
        t1: elapsed + duration,
        x1: x,
        y1: y,
        x2: reachesWall ? clamp(nextX, snapshot.radius, arenaSize - snapshot.radius) : nextX,
        y2: reachesWall ? clamp(nextY, snapshot.radius, arenaSize - snapshot.radius) : nextY,
        vx,
        vy,
        bouncedAtEnd: reachesWall
      };
      segments.push(Object.freeze(segment));
      elapsed += duration;
      remaining -= duration;
      if (!reachesWall || remaining <= EPSILON) break;
      if (bouncesLeft === 0) break;
      x = segment.x2;
      y = segment.y2;
      const hitX = Math.abs(x - snapshot.radius) <= EPSILON ||
        Math.abs(x - (arenaSize - snapshot.radius)) <= EPSILON;
      const hitY = Math.abs(y - snapshot.radius) <= EPSILON ||
        Math.abs(y - (arenaSize - snapshot.radius)) <= EPSILON;
      if (hitX) vx = -vx;
      if (hitY) vy = -vy;
      if (!hitX && !hitY) {
        // Guard against malformed positions/velocities causing a zero-length loop.
        break;
      }
      if (bouncesLeft !== null) bouncesLeft -= 1;
      if (duration <= EPSILON) {
        x += vx * EPSILON;
        y += vy * EPSILON;
        elapsed += EPSILON;
        remaining = Math.max(0, remaining - EPSILON);
      }
    }
    return segments;
  }

  function snapshotBall(
    ball,
    self = false,
    profile = null,
    now = 0,
    arenaSize = 200,
    capabilities = null,
    nextTransitionIn = null
  ) {
    if (!ball) return null;
    const visible = self || !profile || profile.solid !== false || profile.attackable !== false;
    const x = finiteOr(ball.x, 0);
    const y = finiteOr(ball.y, 0);
    const vx = finiteOr(ball.vx, finiteOr(ball.storedVx, 0));
    const vy = finiteOr(ball.vy, finiteOr(ball.storedVy, 0));
    const snapshot = {
      instanceId: String(ball.instanceId || ball.id || ""),
      definitionId: String(ball.id || ""),
      teamId: ball.teamId,
      x,
      y,
      vx,
      vy,
      radius: finiteOr(ball.radius, 15),
      hp: finiteOr(ball.hp, 0),
      maxHp: finiteOr(ball.maxHp, 0),
      bodyDamage: Number.isFinite(ball.collisionDamage)
        ? ball.collisionDamage
        : Number.isFinite(ball.definition && ball.definition.collisionDamage)
          ? ball.definition.collisionDamage
          : null,
      visible: visible && ball.active !== false,
      solid: profile && profile.solid !== undefined
        ? profile.solid === true
        : ball.active !== false,
      attackable: profile && profile.attackable !== undefined
        ? profile.attackable === true
        : ball.active !== false && ball.hp > 0
    };
    if (!self && snapshot.visible) {
      snapshot.capabilities = freezeCapabilities(capabilities, fallbackCapabilities(ball, now));
      snapshot.activeEffects = Object.freeze(snapshotEffects(ball, now));
      snapshot.nextTransitionIn = Number.isFinite(nextTransitionIn) && nextTransitionIn > 0
        ? nextTransitionIn
        : null;
      snapshot.forecastSegments = Object.freeze(forecastSegments({
        x,
        y,
        vx,
        vy,
        radius: snapshot.radius,
        remainingLife: THREAT_FORECAST_HORIZON
      }, arenaSize));
    }
    return snapshot;
  }

  function snapshotEntity(entity, selfTeamId, arenaSize) {
    if (!entity || entity.entityActive === false) return null;
    const coordinates = segmentCoordinates(entity);
    const hasSegment = Object.values(coordinates).every(Number.isFinite);
    const x = Number.isFinite(entity.x)
      ? entity.x
      : hasSegment ? (coordinates.startX + coordinates.endX) / 2 : NaN;
    const y = Number.isFinite(entity.y)
      ? entity.y
      : hasSegment ? (coordinates.startY + coordinates.endY) / 2 : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const remainingLife = Math.max(0, finiteOr(entity.life, 0) - finiteOr(entity.age, 0));
    const age = finiteOr(entity.age, 0);
    const activeFrom = clamp(
      finiteOr(entity.activeFrom, 0) - age,
      0,
      remainingLife
    );
    const activeUntil = Math.max(
      activeFrom,
      Math.min(remainingLife, finiteOr(entity.activeUntil, finiteOr(entity.life, 0)) - age)
    );
    const damage = Number.isFinite(entity.damage) ? entity.damage : null;
    const hostile = entity.teamId !== selfTeamId;
    const snapshot = {
      instanceId: String(entity.instanceId || ""),
      kind: String(entity.kind || "entity"),
      combatKind: String(entity.combatKind || "zone"),
      ownerInstanceId: String(entity.ownerInstanceId || ""),
      creditInstanceId: String(entity.creditInstanceId || ""),
      teamId: entity.teamId,
      hostile,
      x,
      y,
      vx: finiteOr(entity.vx, 0),
      vy: finiteOr(entity.vy, 0),
      radius: finiteOr(entity.radius, 0),
      age: finiteOr(entity.age, 0),
      life: finiteOr(entity.life, 0),
      remainingLife,
      bounces: Number.isInteger(entity.bounces) ? entity.bounces : 0,
      remainingBounces: Number.isInteger(entity.maxBounces)
        ? Math.max(0, entity.maxBounces - (Number.isInteger(entity.bounces) ? entity.bounces : 0))
        : Number.isInteger(entity.bounceLimit)
          ? Math.max(0, entity.bounceLimit - (Number.isInteger(entity.bounces) ? entity.bounces : 0))
          : null,
      damage,
      damageInterval: Number.isFinite(entity.damageInterval)
        ? Math.max(0, entity.damageInterval)
        : null,
      shape: snapshotShape(entity, finiteOr(entity.radius, 0)),
      activeWindow: Object.freeze({ from: activeFrom, until: activeUntil }),
      solid: entity.solid !== false && entity.physical !== false,
      attackable: entity.attackable !== false && entity.targetable !== false,
      targeting: snapshotTargeting(entity),
      wallAnchored: entity.wallAnchored === true || entity.wallAnchor === true,
      forecastSegments: []
    };
    snapshot.forecastSegments = Object.freeze(forecastSegments(snapshot, arenaSize));
    snapshot.threatensSelf = hostile;
    return snapshot;
  }

  function buildObservation(context, state, config = {}) {
    const { ball, game, services } = context;
    const configuredMagazine = Number.isInteger(config.magazineCapacity)
      ? Math.max(0, config.magazineCapacity)
      : 0;
    const magazineEnabled = configuredMagazine > 0;
    const arenaSize = finiteOr(game.arenaSize, 200);
    const forecastArena = game.arena && game.arena.shape !== "square" ? game.arena : arenaSize;
    const now = finiteOr(game.time, 0);
    const enemies = typeof services.getEnemies === "function"
      ? services.getEnemies().map((target) => {
        const profile = typeof services.getContactProfile === "function"
          ? services.getContactProfile(target)
          : null;
        if (profile && profile.solid === false && profile.attackable === false) return null;
        const capabilities = typeof services.getCapabilities === "function"
          ? services.getCapabilities(target)
          : null;
        const nextTransitionIn = typeof services.getNextTransitionIn === "function"
          ? services.getNextTransitionIn(target)
          : null;
        const snapshot = snapshotBall(
          target,
          false,
          profile,
          now,
          forecastArena,
          capabilities,
          nextTransitionIn
        );
        return snapshot ? Object.freeze(snapshot) : null;
      }).filter((target) => target && target.visible)
      : [];
    const entities = Array.isArray(game.combatEntities)
      ? game.combatEntities.map((entity) => {
        const snapshot = snapshotEntity(entity, ball.teamId, forecastArena);
        return snapshot ? Object.freeze(snapshot) : null;
      }).filter(Boolean)
      : [];

    const selfSnapshot = {
      ...snapshotBall(ball, true),
      fireCooldown: magazineEnabled ? 0 : finiteOr(state.cooldown, 0),
      recoilRemaining: finiteOr(state.recoilRemaining, 0),
      nextWallContactIn: nextWallContactIn(ball, forecastArena),
      nextDecisionIn: Math.max(0, DECISION_INTERVAL - finiteOr(state.accumulator, 0)),
      capabilities: freezeCapabilities(
        typeof services.getCapabilities === "function" ? services.getCapabilities(ball) : null,
        fallbackCapabilities(ball, now)
      )
    };
    if (magazineEnabled) {
      selfSnapshot.ammo = Math.max(0, Math.floor(finiteOr(state.ammo, 0)));
      selfSnapshot.magazineCapacity = configuredMagazine;
      selfSnapshot.nextAmmoIn = selfSnapshot.ammo >= configuredMagazine
        ? null
        : Math.max(0, finiteOr(state.reloadRemaining, config.ammoRechargeDuration || 1));
      selfSnapshot.magazineFull = selfSnapshot.ammo >= configuredMagazine;
    }
    selfSnapshot.activeEffects = Object.freeze(snapshotEffects(ball, now));
    selfSnapshot.forecastSegments = Object.freeze(forecastSegments({
      x: selfSnapshot.x,
      y: selfSnapshot.y,
      vx: selfSnapshot.vx,
      vy: selfSnapshot.vy,
      radius: selfSnapshot.radius,
      remainingLife: THREAT_FORECAST_HORIZON
    }, forecastArena));
    selfSnapshot.nextTransitionIn = selfSnapshot.recoilRemaining > EPSILON
      ? selfSnapshot.recoilRemaining
      : selfSnapshot.nextDecisionIn;
    const threats = entities.filter((entity) => entity.hostile);

    return Object.freeze({
      tick: state.tick,
      time: finiteOr(game.time, 0),
      dt: DECISION_INTERVAL,
      arena: Object.freeze({
        size: arenaSize,
        ...(game.arena ? {
          shape: game.arena.shape, width: game.arena.width, height: game.arena.height,
          left: game.arena.left, top: game.arena.top,
          right: game.arena.right, bottom: game.arena.bottom,
          centerX: game.arena.centerX, centerY: game.arena.centerY
        } : {}),
        forecastHorizon: THREAT_FORECAST_HORIZON,
        maxForecastSegments: MAX_FORECAST_SEGMENTS
      }),
      self: Object.freeze(selfSnapshot),
      enemies: Object.freeze(enemies),
      projectiles: Object.freeze(entities.filter((entity) => entity.combatKind === "projectile")),
      entities: Object.freeze(entities),
      threats: Object.freeze(threats),
      recentEvents: Object.freeze(state.events.slice())
    });
  }

  function defaultAction(previous = {}) {
    return {
      fire: false,
      aimAngle: finiteOr(previous.aimAngle, 0),
      bounceAngle: finiteOr(previous.bounceAngle, 0),
      targetId: previous.targetId || null
    };
  }

  function normalizeAction(action, previous = {}) {
    const source = action && typeof action === "object" ? action : {};
    const normalized = defaultAction(previous);
    normalized.fire = source.fire === true;
    if (Number.isFinite(source.aimAngle)) normalized.aimAngle = source.aimAngle;
    if (Number.isFinite(source.bounceAngle)) {
      normalized.bounceAngle = clamp(source.bounceAngle, -75, 75);
    }
    if (source.targetId !== undefined && source.targetId !== null) {
      normalized.targetId = String(source.targetId);
    }
    return normalized;
  }

  function callPolicy(policy, method, observation, fallback) {
    if (!policy || typeof policy[method] !== "function") return fallback;
    try {
      const result = policy[method](observation);
      return result && typeof result === "object" ? result : fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function hasIllegalActionField(action, field) {
    if (!action || typeof action !== "object" || !(field in action)) return false;
    if (field === "fire") return typeof action[field] !== "boolean";
    if (field === "aimAngle") return !Number.isFinite(action[field]);
    if (field === "bounceAngle") {
      return !Number.isFinite(action[field]) || action[field] < -75 || action[field] > 75;
    }
    if (field === "targetId") {
      return action[field] !== null && action[field] !== undefined &&
        (typeof action[field] !== "string" && typeof action[field] !== "number");
    }
    return false;
  }

  function createGunnerBullet(owner, direction, onHit = null, options = {}) {
    const damage = Number.isFinite(options.damage) ? options.damage : BULLET_DAMAGE;
    const spawnX = owner.x + direction.x * (owner.radius + BULLET_RADIUS + 1);
    const spawnY = owner.y + direction.y * (owner.radius + BULLET_RADIUS + 1);
    const spawn = options.arena && options.arena.shape !== "square"
      ? options.arena.clampPoint(spawnX, spawnY, BULLET_RADIUS)
      : { x: spawnX, y: spawnY };
    return {
      kind: "gunner-bullet",
      combatKind: "projectile",
      isProjectile: true,
      maxBounces: 1,
      life: BULLET_LIFE,
      x: spawn.x,
      y: spawn.y,
      vx: direction.x * BULLET_SPEED,
      vy: direction.y * BULLET_SPEED,
      radius: BULLET_RADIUS,
      color: "#d7e7ff",
      damage,
      bounces: 0,
      drawLayer: "background",
      update({ entity, game, services }, dt) {
        if (game.arena && game.arena.shape !== "square") {
          const flight = traceArenaFlight({
            ...entity, remainingLife: dt, remainingBounces: entity.maxBounces - entity.bounces
          }, game.arena, dt);
          for (const segment of flight.segments) {
            const hit = services.getFirstEnemyHit(
              segment.x1, segment.y1, segment.x2, segment.y2, entity.radius
            );
            if (!hit) continue;
            const previousHp = hit.hp;
            const resolved = services.dealDamage(hit, entity.damage);
            if (typeof onHit === "function") onHit({
              target: hit, damaged: resolved === true && hit.hp < previousHp,
              amount: Math.max(0, previousHp - hit.hp)
            });
            entity.entityActive = false;
            return;
          }
          entity.x = flight.x;
          entity.y = flight.y;
          entity.vx = flight.vx;
          entity.vy = flight.vy;
          entity.bounces += flight.bounces;
          if (flight.expired) entity.entityActive = false;
          return;
        }
        const startX = entity.x;
        const startY = entity.y;
        const nextX = startX + entity.vx * dt;
        const nextY = startY + entity.vy * dt;
        let endX = nextX;
        let endY = nextY;
        let bounced = false;

        if (nextX - entity.radius < 0 || nextX + entity.radius > game.arenaSize) {
          if (entity.bounces >= 1) {
            entity.entityActive = false;
            return;
          }
          endX = clamp(nextX, entity.radius, game.arenaSize - entity.radius);
          entity.vx = -entity.vx;
          entity.bounces += 1;
          bounced = true;
        }
        if (nextY - entity.radius < 0 || nextY + entity.radius > game.arenaSize) {
          if (entity.bounces >= 1 && !bounced) {
            entity.entityActive = false;
            return;
          }
          endY = clamp(nextY, entity.radius, game.arenaSize - entity.radius);
          entity.vy = -entity.vy;
          if (!bounced) entity.bounces += 1;
          bounced = true;
        }

        const hit = services.getFirstEnemyHit(
          startX,
          startY,
          endX,
          endY,
          entity.radius
        );
        if (hit) {
          const previousHp = hit.hp;
          const resolved = services.dealDamage(hit, entity.damage);
          if (typeof onHit === "function") {
            onHit({
              target: hit,
              damaged: resolved === true && hit.hp < previousHp,
              amount: Math.max(0, previousHp - hit.hp)
            });
          }
          entity.entityActive = false;
          return;
        }
        entity.x = endX;
        entity.y = endY;
      },
      draw({ entity }, canvasContext) {
        canvasContext.save();
        canvasContext.fillStyle = entity.color;
        canvasContext.beginPath();
        canvasContext.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
        canvasContext.fill();
        canvasContext.restore();
      }
    };
  }

  function createSafePolicy() {
    return {
      onStart() {},
      decide() {
        return { fire: false, aimAngle: 0 };
      },
      onWallBounce() {
        return { bounceAngle: 0 };
      },
      onEvent() {}
    };
  }

  function createGunnerDefinition({
    id,
    name,
    englishName,
    color = "#4b6f9f",
    description = "自由策略枪手 / 碰壁决策 + 独立瞄准 + 固定后坐力",
    policyFactory = createSafePolicy,
    bulletDamage = BULLET_DAMAGE,
    collisionDamage = COLLISION_DAMAGE,
    magazineCapacity = 0,
    ammoRechargeDuration = 1,
    playerInput = null
  } = {}) {
    if (typeof id !== "string" || !id.trim()) throw new TypeError("Gunner id is required");
    if (typeof policyFactory !== "function") throw new TypeError("Gunner policyFactory is required");
    if (!Number.isFinite(bulletDamage) || bulletDamage < 0) {
      throw new TypeError("Gunner bulletDamage must be non-negative");
    }
    if (!Number.isFinite(collisionDamage) || collisionDamage < 0) {
      throw new TypeError("Gunner collisionDamage must be non-negative");
    }
    if (!Number.isInteger(magazineCapacity) || magazineCapacity < 0) {
      throw new TypeError("Gunner magazineCapacity must be a non-negative integer");
    }
    if (!Number.isFinite(ammoRechargeDuration) || ammoRechargeDuration <= 0) {
      throw new TypeError("Gunner ammoRechargeDuration must be positive");
    }
    const magazineEnabled = magazineCapacity > 0;

    return {
      id,
      name: name || id,
      englishName: englishName || id,
      color,
      description,
      collisionDamage,
      bulletDamage,
      magazineCapacity,
      ammoRechargeDuration: magazineEnabled ? ammoRechargeDuration : null,
      stats: {
        radius: 15,
        speed: 150,
        maxHp: 100
      },
      createBehavior(services) {
        let policy;
        try {
          policy = policyFactory();
        } catch (_error) {
          policy = createSafePolicy();
        }
        if (!policy || typeof policy !== "object") policy = createSafePolicy();

        const state = {
          accumulator: DECISION_INTERVAL,
          ammo: magazineEnabled ? 0 : null,
          reloadRemaining: magazineEnabled ? ammoRechargeDuration : 0,
          cooldown: 0,
          recoilRemaining: 0,
          recoilVelocity: { x: 0, y: 0 },
          aimAngle: 0,
          targetId: null,
          bounceAngle: 0,
          tick: 0,
          time: 0,
          events: [],
          metrics: {
            decisions: 0,
            wallBounceCalls: 0,
            fireRequests: 0,
            fires: 0,
            rejectedFireRequests: 0,
            illegalActions: 0,
            policyErrors: 0
          }
        };

        function emitEvent(type, details = {}) {
          state.events.push(Object.freeze({
             type,
             time: finiteOr(state.time, 0),
             ...details
           }));
          if (state.events.length > MAX_EVENT_HISTORY) state.events.shift();
          try {
            if (typeof policy.onEvent === "function") policy.onEvent(state.events.at(-1));
          } catch (_error) {
            // A contestant policy cannot interrupt the simulation.
          }
        }

        function decide(context) {
          const observation = playerInput ? null : buildObservation(context, state, {
            magazineCapacity,
            ammoRechargeDuration
          });
          state.metrics.decisions += 1;
          let rawAction = {};
          try {
            const result = playerInput ? playerInput() : typeof policy.decide === "function"
              ? policy.decide(observation)
              : {};
            rawAction = result && typeof result === "object" ? result : {};
          } catch (_error) {
            state.metrics.policyErrors += 1;
          }
          if (["fire", "aimAngle", "bounceAngle", "targetId"].some((field) => (
            hasIllegalActionField(rawAction, field)
          ))) state.metrics.illegalActions += 1;
          const action = normalizeAction(rawAction, state);
          state.aimAngle = action.aimAngle;
          state.targetId = action.targetId;
          state.bounceAngle = action.bounceAngle;
          if (action.fire) {
            state.metrics.fireRequests += 1;
            const canFire = state.recoilRemaining <= EPSILON && (
              magazineEnabled ? state.ammo > 0 : state.cooldown <= EPSILON
            );
            if (canFire) {
              if (magazineEnabled) state.ammo -= 1;
              fire(context);
              state.metrics.fires += 1;
              if (!magazineEnabled) state.cooldown = FIRE_COOLDOWN;
            } else {
              state.metrics.rejectedFireRequests += 1;
            }
          }
        }

        function fire(context) {
          const { ball } = context;
          const direction = {
            x: Math.cos(state.aimAngle),
            y: Math.sin(state.aimAngle)
          };
          const projectile = services.spawnProjectile(createGunnerBullet(
            ball,
            direction,
            ({ target, damaged, amount }) => emitEvent("projectile-hit", {
              projectileId: projectile && projectile.instanceId,
              targetId: target && target.instanceId,
              damaged: damaged === true,
              amount: finiteOr(amount, 0),
              targetHp: finiteOr(target && target.hp, 0)
            }),
            { damage: bulletDamage, arena: context.game.arena }
          ));

          // Direct player steering replaces the gun's recoil-driven locomotion.
          // Projectile geometry, damage and cooldown still use the shared path.
          if (playerInput) {
            emitEvent("fire", { aimAngle: state.aimAngle,
              projectileId: projectile && projectile.instanceId });
            return;
          }
          const current = normalizeVector(
            finiteOr(ball.storedVx, ball.vx),
            finiteOr(ball.storedVy, ball.vy)
          );
          state.recoilVelocity = {
            x: current.x * finiteOr(ball.speed, 150) - direction.x * RECOIL_SPEED,
            y: current.y * finiteOr(ball.speed, 150) - direction.y * RECOIL_SPEED
          };
          state.recoilRemaining = RECOIL_DURATION;
          ball.storedVx = state.recoilVelocity.x;
          ball.storedVy = state.recoilVelocity.y;
          emitEvent("fire", {
            aimAngle: state.aimAngle,
            projectileId: projectile && projectile.instanceId,
            recoilVx: state.recoilVelocity.x,
            recoilVy: state.recoilVelocity.y
          });
        }

        function finishRecoil(ball) {
          const direction = normalizeVector(state.recoilVelocity.x, state.recoilVelocity.y);
          const speed = finiteOr(ball.speed, 150);
          ball.storedVx = direction.x * speed;
          ball.storedVy = direction.y * speed;
          ball.vx = ball.storedVx;
          ball.vy = ball.storedVy;
          state.recoilRemaining = 0;
        }

        return {
          onSpawn(context) {
            try {
              if (typeof policy.onStart === "function") {
                policy.onStart(buildObservation(context, state, {
                  magazineCapacity,
                  ammoRechargeDuration
                }));
              }
            } catch (_error) {
              // Policy initialization is isolated from game execution.
            }
          },
          update(context, dt) {
            const { ball } = context;
            if (playerInput && !services.isMovementLocked(ball)) {
              const input = playerInput();
              const x = finiteOr(input.moveX, 0);
              const y = finiteOr(input.moveY, 0);
              const magnitude = Math.hypot(x, y);
              const scale = ball.speed * ball.speedMultiplier / Math.max(1, magnitude);
              ball.vx = ball.storedVx = x * scale;
              ball.vy = ball.storedVy = y * scale;
              ball.speedNeedsNormalization = false;
            }
            const delta = Math.max(0, finiteOr(dt, 0));
            state.tick += 1;
            state.time = finiteOr(context && context.game && context.game.time, state.time || 0);
            state.cooldown = Math.max(0, state.cooldown - delta);

            if (magazineEnabled && state.ammo < magazineCapacity) {
              state.reloadRemaining = Math.max(0, state.reloadRemaining - delta);
              while (state.reloadRemaining <= EPSILON && state.ammo < magazineCapacity) {
                state.ammo += 1;
                state.reloadRemaining += ammoRechargeDuration;
              }
            }

            if (state.recoilRemaining > EPSILON) {
              state.recoilRemaining = Math.max(0, state.recoilRemaining - delta);
              ball.storedVx = state.recoilVelocity.x;
              ball.storedVy = state.recoilVelocity.y;
              if (state.recoilRemaining <= EPSILON) finishRecoil(ball);
            }

            state.accumulator += delta;
            while (state.accumulator + EPSILON >= DECISION_INTERVAL) {
              state.accumulator -= DECISION_INTERVAL;
              decide(context);
            }
          },
          getNextTransitionIn() {
            const transitions = [];
            if (state.recoilRemaining > EPSILON) transitions.push(state.recoilRemaining);
            if (magazineEnabled && state.ammo < magazineCapacity && state.reloadRemaining > EPSILON) {
              transitions.push(state.reloadRemaining);
            }
            return transitions.length > 0 ? Math.min(...transitions) : undefined;
          },
          onWallBounce(context) {
            if (playerInput) return;
            state.metrics.wallBounceCalls += 1;
            const observation = buildObservation(context, state, {
              magazineCapacity,
              ammoRechargeDuration
            });
            let rawAction = {};
            try {
              const result = typeof policy.onWallBounce === "function"
                ? policy.onWallBounce(observation)
                : {};
              rawAction = result && typeof result === "object" ? result : {};
            } catch (_error) {
              state.metrics.policyErrors += 1;
            }
            if (hasIllegalActionField(rawAction, "bounceAngle")) {
              state.metrics.illegalActions += 1;
            }
            const action = normalizeAction(rawAction, state);
            state.bounceAngle = action.bounceAngle;

            const { ball } = context;
            let inwardX = 0;
            let inwardY = 0;
            if (context.game.arena && context.game.arena.shape !== "square") {
              for (const contact of context.wallContacts || []) {
                inwardX += contact.normalX;
                inwardY += contact.normalY;
              }
            } else {
              if (context.bouncedX) inwardX += ball.x <= ball.radius + EPSILON ? 1 : -1;
              if (context.bouncedY) inwardY += ball.y <= ball.radius + EPSILON ? 1 : -1;
            }
            const inward = normalizeVector(inwardX, inwardY, -ball.vx, -ball.vy);
            const cosine = Math.cos(state.bounceAngle * Math.PI / 180);
            const sine = Math.sin(state.bounceAngle * Math.PI / 180);
            const currentSpeed = Math.max(
              0.001,
              Math.hypot(finiteOr(ball.storedVx, ball.vx), finiteOr(ball.storedVy, ball.vy))
            );
            ball.storedVx = (inward.x * cosine - inward.y * sine) * currentSpeed;
            ball.storedVy = (inward.x * sine + inward.y * cosine) * currentSpeed;
            emitEvent("wall-bounce", {
              bouncedX: Boolean(context.bouncedX),
              bouncedY: Boolean(context.bouncedY),
              bounceAngle: state.bounceAngle
            });
          },
          onCollision(context, target) {
            if (!target || target.hp <= 0) return;
            const previousHp = target.hp;
            const resolved = context.services.dealDamage(target, collisionDamage);
            emitEvent("collision-hit", {
              targetId: target.instanceId,
              damaged: resolved === true && target.hp < previousHp,
              amount: Math.max(0, previousHp - target.hp),
              targetHp: finiteOr(target.hp, 0)
            });
          },
          onDamaged(_context, event) {
            emitEvent("damaged", {
              amount: finiteOr(event && event.amount, 0)
            });
          },
          getGunnerState() {
            return {
              cooldown: state.cooldown,
              ...(magazineEnabled ? {
                ammo: state.ammo,
                magazineCapacity,
                nextAmmoIn: state.ammo >= magazineCapacity ? null : state.reloadRemaining
              } : {}),
              recoilRemaining: state.recoilRemaining,
              aimAngle: state.aimAngle,
              targetId: state.targetId,
              bounceAngle: state.bounceAngle,
              metrics: { ...state.metrics }
            };
          }
        };
      }
    };
  }

  return {
    GUNNER_CONSTANTS,
    createGunnerDefinition,
    createGunnerBullet,
    createSafeGunnerPolicy: createSafePolicy,
    buildGunnerObservation: buildObservation,
    getGunnerArenaGeometry,
    getGunnerWallNormal,
    traceGunnerArenaFlight: traceArenaFlight,
    normalizeGunnerAction: normalizeAction,
    registerBall
  };
});
