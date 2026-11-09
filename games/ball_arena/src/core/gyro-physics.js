(function initializeGyroPhysics(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./arena-geometry.js") : root.BallBattle);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGyroPhysicsApi(dependencies) {
  "use strict";
  const { resolveArenaGeometry } = dependencies;

  // A central field bends trajectories continuously. Cartesian velocity Verlet
  // preserves angular momentum without rotating velocity a second time; inward
  // passes accelerate naturally and carry their momentum through the empty hub.
  const GYRO_PHYSICS = Object.freeze({
    // Same unit as bounce mode's gravity, aimed at the arena centre.
    gravity: 260,
    // Bounded random speed sampler, shared by the opening speed and the rim kick.
    randomLaunchMin: 60,
    randomLaunchMax: 700,
    // Rim reflection re-samples the wall-parallel component at this weight.
    rimSpinRandomWeight: 0.35,
    // Fight start: the random direction is biased toward the shared tangential
    // direction (so both tops start spinning the same way) and the base speed is
    // blended with the bounded random sampler.
    startSpinWeight: 0.55,
    startRandomWeight: 0.5,
    // The force softens continuously inside this radius; this is not a collider.
    minimumOrbitRadius: 20,
    // A total speed ceiling keeps radial plunges bounded as well as orbits.
    maximumOrbitalSpeed: 900
  });

  const RADIAL_EPSILON = 1e-6;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function createGyroPhysics({ random = Math.random, options = {} } = {}) {
    if (typeof random !== "function") {
      throw new TypeError("Gyro physics random must be a function");
    }
    if (!options || typeof options !== "object") options = {};

    function setting(key, minimum, maximum) {
      const value = options[key];
      if (!Number.isFinite(value)) return GYRO_PHYSICS[key];
      return clamp(value, minimum, maximum);
    }

    const settings = Object.freeze({
      gravity: setting("gravity", 1, Infinity),
      randomLaunchMin: setting("randomLaunchMin", 0, Infinity),
      randomLaunchMax: setting("randomLaunchMax", 1, Infinity),
      rimSpinRandomWeight: setting("rimSpinRandomWeight", 0, 1),
      startSpinWeight: setting("startSpinWeight", 0, 1),
      startRandomWeight: setting("startRandomWeight", 0, 1),
      minimumOrbitRadius: setting("minimumOrbitRadius", 0, Infinity),
      maximumOrbitalSpeed: setting("maximumOrbitalSpeed", 1, Infinity)
    });

    function centerOf(arenaSize) {
      if (!Number.isFinite(arenaSize) || arenaSize <= 0) {
        throw new TypeError("Gyro physics requires a positive arena size");
      }
      return arenaSize / 2;
    }

    // Decompose the live velocity of one ball into the radial/tangential frame of
    // the axis. A ball sitting exactly on the axis (or exactly still on it) has no
    // defined outward ray, so it falls back to its own motion and finally to a
    // random ray — the ejection needs a direction and cannot stall.
    function radialFrame(ball, center) {
      let dx = ball.x - center;
      let dy = ball.y - center;
      let distance = Math.hypot(dx, dy);
      if (distance <= RADIAL_EPSILON) {
        const speed = Math.hypot(ball.vx, ball.vy);
        if (speed > RADIAL_EPSILON) {
          dx = ball.vx / speed;
          dy = ball.vy / speed;
        } else {
          const angle = random() * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
        }
        distance = 0;
      } else {
        dx /= distance;
        dy /= distance;
      }
      const tangentX = -dy;
      const tangentY = dx;
      return {
        distance,
        directionX: dx,
        directionY: dy,
        tangentX,
        tangentY,
        radial: ball.vx * dx + ball.vy * dy,
        tangential: ball.vx * tangentX + ball.vy * tangentY
      };
    }

    function commitVelocity(ball) {
      ball.storedVx = ball.vx;
      ball.storedVy = ball.vy;
      ball.gyroLastStoredVx = ball.storedVx;
      ball.gyroLastStoredVy = ball.storedVy;
    }

    // Ball mechanics keep writing the stored velocity; gyro physics owns the live
    // one. Adopt a stored rewrite exactly once, the same way bounce mode does.
    function prepareVelocity(ball, normalizeStoredVelocity) {
      const storedChanged = Math.abs(ball.storedVx - ball.gyroLastStoredVx) > 1e-9 ||
        Math.abs(ball.storedVy - ball.gyroLastStoredVy) > 1e-9;
      if (!storedChanged && !ball.speedNeedsNormalization) return;
      if (ball.speedNeedsNormalization && typeof normalizeStoredVelocity === "function") {
        normalizeStoredVelocity(ball);
      }
      ball.vx = ball.storedVx;
      ball.vy = ball.storedVy;
      ball.speedNeedsNormalization = false;
    }

    function randomLaunchSpeed() {
      return settings.randomLaunchMin +
        random() * (settings.randomLaunchMax - settings.randomLaunchMin);
    }

    function integrate(ball, dt, arenaSize) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const center = centerOf(arenaSize);
      const softRadius = Math.max(RADIAL_EPSILON, settings.minimumOrbitRadius);
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const step = dt / steps;
      for (let index = 0; index < steps; index += 1) {
        let dx = ball.x - center;
        let dy = ball.y - center;
        let force = settings.gravity / Math.max(softRadius, Math.hypot(dx, dy));
        ball.vx -= dx * force * step * 0.5;
        ball.vy -= dy * force * step * 0.5;
        limitSpeed(ball);
        ball.x += ball.vx * step;
        ball.y += ball.vy * step;
        dx = ball.x - center;
        dy = ball.y - center;
        force = settings.gravity / Math.max(softRadius, Math.hypot(dx, dy));
        ball.vx -= dx * force * step * 0.5;
        ball.vy -= dy * force * step * 0.5;
        limitSpeed(ball);
      }
      commitVelocity(ball);
    }

    function limitSpeed(ball) {
      const speedSquared = ball.vx * ball.vx + ball.vy * ball.vy;
      const limit = settings.maximumOrbitalSpeed;
      if (speedSquared <= limit * limit) return;
      const scale = limit / Math.sqrt(speedSquared);
      ball.vx *= scale;
      ball.vy *= scale;
    }

    // Fight start: spin both tops the same way, then feed the bounded random
    // sampler into the opening speed so no two fights open identically.
    function seedOrbit(ball, arenaSize, baseSpeed) {
      const center = centerOf(arenaSize);
      const frame = radialFrame(ball, center);
      const magnitude = Math.hypot(ball.vx, ball.vy);
      let directionX = magnitude > RADIAL_EPSILON ? ball.vx / magnitude : frame.tangentX;
      let directionY = magnitude > RADIAL_EPSILON ? ball.vy / magnitude : frame.tangentY;
      const spinWeight = settings.startSpinWeight;
      directionX = directionX * (1 - spinWeight) + frame.tangentX * spinWeight;
      directionY = directionY * (1 - spinWeight) + frame.tangentY * spinWeight;
      const directionMagnitude = Math.hypot(directionX, directionY);
      if (directionMagnitude <= RADIAL_EPSILON) {
        directionX = frame.tangentX;
        directionY = frame.tangentY;
      } else {
        directionX /= directionMagnitude;
        directionY /= directionMagnitude;
      }
      const base = Number.isFinite(baseSpeed) ? Math.max(0, baseSpeed) : 0;
      const randomWeight = settings.startRandomWeight;
      const speed = base * (1 - randomWeight) + randomLaunchSpeed() * randomWeight;
      ball.vx = directionX * speed;
      ball.vy = directionY * speed;
      commitVelocity(ball);
    }

    // The arena rim is the outer wall of the plate: reflect and re-sample the
    // wall-parallel component so consecutive laps never retrace each other.
    function resolveWalls(ball, arenaValue) {
      const arena = resolveArenaGeometry(arenaValue);
      const radius = ball.radius;
      if (arena.shape === "circle") {
        const distance = Math.hypot(ball.x - arena.centerX, ball.y - arena.centerY);
        if (distance < arena.width / 2 - radius || distance < RADIAL_EPSILON) return { bouncedX: false, bouncedY: false };
        const hit = Number.isFinite(ball.prevX) && Number.isFinite(ball.prevY)
          ? arena.traceSegment(ball.prevX, ball.prevY, ball.x, ball.y, radius) : null;
        const nx = hit ? hit.normalX : (arena.centerX - ball.x) / distance;
        const ny = hit ? hit.normalY : (arena.centerY - ball.y) / distance;
        const point = arena.clampPoint(hit ? hit.x : ball.x, hit ? hit.y : ball.y, radius);
        ball.x = point.x; ball.y = point.y;
        const incoming = ball.vx * nx + ball.vy * ny;
        if (incoming >= 0) return { bouncedX: false, bouncedY: false };
        const tangent = ball.vx * -ny + ball.vy * nx;
        const weight = settings.rimSpinRandomWeight;
        const spin = tangent * (1 - weight) + (weight > 0 ? (random() < 0.5 ? -1 : 1) * randomLaunchSpeed() * weight : 0);
        ball.vx = -incoming * nx - spin * ny;
        ball.vy = -incoming * ny + spin * nx;
        limitSpeed(ball);
        commitVelocity(ball);
        return { bouncedX: Math.abs(nx) > RADIAL_EPSILON, bouncedY: Math.abs(ny) > RADIAL_EPSILON };
      }
      let bouncedX = false;
      let bouncedY = false;
      if (ball.x - radius < arena.left) {
        ball.x = arena.left + radius;
        ball.vx = Math.abs(ball.vx);
        bouncedX = true;
      } else if (ball.x + radius > arena.right) {
        ball.x = arena.right - radius;
        ball.vx = -Math.abs(ball.vx);
        bouncedX = true;
      }
      if (ball.y - radius < arena.top) {
        ball.y = arena.top + radius;
        ball.vy = Math.abs(ball.vy);
        bouncedY = true;
      } else if (ball.y + radius > arena.bottom) {
        ball.y = arena.bottom - radius;
        ball.vy = -Math.abs(ball.vy);
        bouncedY = true;
      }
      if (!bouncedX && !bouncedY) return { bouncedX, bouncedY };

      const weight = settings.rimSpinRandomWeight;
      if (weight > 0) {
        const signedSample = (random() < 0.5 ? -1 : 1) * randomLaunchSpeed() * weight;
        if (bouncedX) ball.vy = ball.vy * (1 - weight) + signedSample;
        if (bouncedY) ball.vx = ball.vx * (1 - weight) + signedSample;
      }
      // At a corner, a tangential kick is also normal to the other wall.
      if (bouncedX) ball.vx = (ball.x <= arena.left + radius ? 1 : -1) * Math.abs(ball.vx);
      if (bouncedY) ball.vy = (ball.y <= arena.top + radius ? 1 : -1) * Math.abs(ball.vy);
      limitSpeed(ball);
      commitVelocity(ball);
      return { bouncedX, bouncedY };
    }

    return Object.freeze({
      prepareVelocity,
      integrate,
      seedOrbit,
      resolveWalls,
      commitVelocity,
      randomLaunchSpeed,
      settings: Object.freeze({ ...settings })
    });
  }

  return { GYRO_PHYSICS, createGyroPhysics };
});
