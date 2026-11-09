(function initializeOrbital(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOrbitalPlugin({ resolveArenaGeometry, registerBall }) {
  const SATELLITE_INTERVAL = 0.6;
  const SATELLITE_RADIUS = 4;
  const SATELLITE_DAMAGE = 3;
  // The first ring is only four logical units wider in diameter than the
  // radius-15 body, so it hugs the body instead of floating away from it.
  const ORBIT_BASE_RADIUS = 17;
  const ORBIT_SPACING = 20;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function segmentDistanceToPoint(startX, startY, endX, endY, x, y) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
      0,
      1
    );
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    return Math.hypot(x - closestX, y - closestY);
  }

  function movingBodyDistance(startX, startY, endX, endY, target) {
    const targetStartX = Number.isFinite(target.prevX)
      ? target.prevX
      : (Number.isFinite(target.previousX) ? target.previousX : target.x);
    const targetStartY = Number.isFinite(target.prevY)
      ? target.prevY
      : (Number.isFinite(target.previousY) ? target.previousY : target.y);
    return segmentDistanceToPoint(
      startX - targetStartX,
      startY - targetStartY,
      endX - target.x,
      endY - target.y,
      0,
      0
    );
  }

  function orbitCapacity(orbitIndex) {
    return orbitIndex * 2 + 1;
  }

  function angularSpeedForOrbit(orbitIndex) {
    // Positive angular velocity is clockwise in canvas coordinates.  All
    // requested rates are halved so the satellites do not visually race.
    if (orbitIndex === 0) return Math.PI * 2 * 0.5;
    if (orbitIndex === 1) return Math.PI * 2 * (0.4 + Math.random() * 0.25);
    if (orbitIndex === 2) return Math.PI * 2 * (0.25 + Math.random() * 0.15);
    return Math.PI * 2 * Math.max(0.125, 0.25 - (orbitIndex - 2) * 0.025);
  }

  function resolveSatelliteCollision(entity, target, game) {
    let normalX = target.x - entity.x;
    let normalY = target.y - entity.y;
    let distance = Math.hypot(normalX, normalY);
    if (distance <= EPSILON) {
      normalX = Number.isFinite(entity.vx) ? entity.vx : 0;
      normalY = Number.isFinite(entity.vy) ? entity.vy : 0;
      distance = Math.hypot(normalX, normalY);
    }
    if (distance <= EPSILON) {
      normalX = 1;
      normalY = 0;
      distance = 1;
    }
    normalX /= distance;
    normalY /= distance;

    const separation = SATELLITE_RADIUS + target.radius;
    Object.assign(target, resolveArenaGeometry(game).clampPoint(entity.x + normalX * separation, entity.y + normalY * separation, target.radius));

    const incoming = target.vx * normalX + target.vy * normalY;
    if (incoming < -EPSILON) {
      target.vx -= incoming * 2 * normalX;
      target.vy -= incoming * 2 * normalY;
      target.storedVx = target.vx;
      target.storedVy = target.vy;
    }
  }

  function findOrbitSlot(satellites) {
    const counts = new Map();
    satellites.forEach((satellite) => {
      if (satellite.entityActive === false || satellite.life <= 0) return;
      counts.set(satellite.orbitIndex, (counts.get(satellite.orbitIndex) || 0) + 1);
    });
    for (let orbitIndex = 0; orbitIndex < 100; orbitIndex += 1) {
      const count = counts.get(orbitIndex) || 0;
      if (count < orbitCapacity(orbitIndex)) {
        return { orbitIndex, slotIndex: count };
      }
    }
    return { orbitIndex: 99, slotIndex: 0 };
  }

  function createSatellite(source, orbitIndex, slotIndex, angle, onDeactivate) {
    const orbitRadius = ORBIT_BASE_RADIUS + orbitIndex * ORBIT_SPACING;
    return {
      kind: "orbital-satellite",
      combatKind: "body",
      lifecycle: "owner-bound",
      life: PERMANENT_LIFE,
      drawLayer: "foreground",
      radius: SATELLITE_RADIUS,
      orbitIndex,
      slotIndex,
      orbitRadius,
      angle,
      angularVelocity: angularSpeedForOrbit(orbitIndex),
      x: source.x + Math.cos(angle) * orbitRadius,
      y: source.y + Math.sin(angle) * orbitRadius,
      previousX: source.x + Math.cos(angle) * orbitRadius,
      previousY: source.y + Math.sin(angle) * orbitRadius,
      update({ entity, game, services: entityServices }, dt) {
        if (!entity.owner || entity.owner.hp <= 0) {
          entity.entityActive = false;
          onDeactivate(entity);
          return;
        }
        entity.previousX = entity.x;
        entity.previousY = entity.y;
        entity.angle += entity.angularVelocity * Math.max(0, dt);
        entity.x = entity.owner.x + Math.cos(entity.angle) * entity.orbitRadius;
        entity.y = entity.owner.y + Math.sin(entity.angle) * entity.orbitRadius;
        const elapsed = Math.max(EPSILON, dt);
        entity.vx = (entity.x - entity.previousX) / elapsed;
        entity.vy = (entity.y - entity.previousY) / elapsed;
        let hit = null;
        entityServices.forEachContactEnemy((target) => {
          if (hit) return;
          const distance = movingBodyDistance(
            entity.previousX,
            entity.previousY,
            entity.x,
            entity.y,
            target
          );
          const overlapping = distance <= SATELLITE_RADIUS + target.radius;
          entityServices.notifyEntityContact(target, entity, { overlapping });
          if (overlapping) hit = target;
        });
        if (!hit) return;
        const profile = entityServices.getContactProfile(hit);
        if (profile.solid) resolveSatelliteCollision(entity, hit, game);
        if (entityServices.tryConsumeEntity(hit, entity, { physical: true })) {
          entity.entityActive = false;
          entityServices.spawnParticleBurst({
            kind: "orbital-satellite-shatter",
            x: entity.x,
            y: entity.y,
            count: 18,
            minDiameter: 1,
            maxDiameter: 4,
            minSpeed: 30,
            maxSpeed: 90,
            colors: ["#fff4fb", "#ffb9d9", "#f7dce9"]
          });
          onDeactivate(entity);
          return;
        }
        // Contact consumes the satellite even when a defense hook reduces the
        // resolved damage to zero; it is still a physical one-use satellite.
        entityServices.dealDamage(hit, SATELLITE_DAMAGE);
        entityServices.spawnParticleBurst({
          kind: "orbital-satellite-shatter",
          x: entity.x,
          y: entity.y,
          count: 18,
          minDiameter: 1,
          maxDiameter: 4,
          minSpeed: 30,
          maxSpeed: 90,
          colors: ["#fff4fb", "#ffb9d9", "#f7dce9"]
        });
        entity.entityActive = false;
        onDeactivate(entity);
      },
      draw({ entity, game }, context) {
        const pulse = 0.84 + 0.16 * Math.sin(game.time * 8 + entity.slotIndex);
        context.save();
        context.globalAlpha *= pulse;
        context.fillStyle = "#5d1d42";
        context.beginPath();
        context.arc(entity.x, entity.y, SATELLITE_RADIUS + 0.8, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#f267ab";
        context.beginPath();
        context.arc(entity.x, entity.y, SATELLITE_RADIUS, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#fff1f8";
        context.beginPath();
        context.arc(entity.x - 0.8, entity.y - 0.9, 1.1, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  function drawOrbitalBackground({ ball, game }, context) {
    const maxOrbit = Math.max(2, Math.ceil((game.arenaSize * 0.35 - ORBIT_BASE_RADIUS) / ORBIT_SPACING));
    context.save();
    context.translate(ball.x, ball.y);
    context.strokeStyle = "rgba(49, 27, 55, 0.72)";
    context.lineWidth = 1;
    for (let orbitIndex = 0; orbitIndex <= maxOrbit; orbitIndex += 1) {
      context.globalAlpha = Math.max(0.16, 0.55 - orbitIndex * 0.035);
      const radius = ORBIT_BASE_RADIUS + orbitIndex * ORBIT_SPACING;
      const gapOffset = (orbitIndex * 1.73) % (Math.PI * 2);
      for (let segment = 0; segment < 3; segment += 1) {
        const start = gapOffset + segment * Math.PI * 2 / 3 + 0.1;
        const end = start + Math.PI * 0.48;
        context.beginPath();
        context.arc(0, 0, radius, start, end);
        context.stroke();
      }
    }
    context.restore();
  }

  const orbitalDefinition = {
    id: "orbital",
    name: "轨道球",
    englishName: "Orbital Ball",
    color: "#ef579d",
    description: "同心轨道卫星 / 每0.6秒增加一颗 / 卫星碰撞-3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 3.6,
    createBehavior(services) {
      let satelliteTimer = 0;
      const satellites = [];

      function reconcileSatellites() {
        for (let index = satellites.length - 1; index >= 0; index -= 1) {
          if (satellites[index].entityActive === false || satellites[index].life <= 0) {
            satellites.splice(index, 1);
          }
        }
      }

      function spawnSatellite(ball) {
        reconcileSatellites();
        const { orbitIndex, slotIndex } = findOrbitSlot(satellites);
        const angle = slotIndex * Math.PI * 2 / orbitCapacity(orbitIndex) + Math.random() * 0.22;
        const satellite = services.spawnCombatEntity(
          createSatellite(ball, orbitIndex, slotIndex, angle, () => reconcileSatellites())
        );
        satellites.push(satellite);
      }

      return {
        update(_context, dt) {
          satelliteTimer = Math.min(SATELLITE_INTERVAL, satelliteTimer + Math.max(0, dt));
          reconcileSatellites();
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, SATELLITE_INTERVAL - satelliteTimer);
        },
        afterUpdateStep(context) {
          if (satelliteTimer + EPSILON < SATELLITE_INTERVAL) return;
          satelliteTimer = 0;
          spawnSatellite(context.ball);
        },
        onBorrowEnd() {
          satellites.forEach((satellite) => { satellite.entityActive = false; });
          satellites.length = 0;
        },
        drawArenaBackground(context, canvasContext) {
          drawOrbitalBackground(context, canvasContext);
        },
        getSatelliteState() {
          reconcileSatellites();
          return satellites.map((satellite) => ({
            instanceId: satellite.instanceId,
            orbitIndex: satellite.orbitIndex,
            slotIndex: satellite.slotIndex,
            orbitRadius: satellite.orbitRadius,
            angularVelocity: satellite.angularVelocity
          }));
        }
      };
    }
  };

  registerBall(orbitalDefinition);
  return { orbitalDefinition };
});
