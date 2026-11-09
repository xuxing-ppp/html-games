(function initializeBouncePhysics(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./arena-geometry.js") : root.BallBattle);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBouncePhysicsApi(dependencies) {
  "use strict";
  const { resolveArenaGeometry } = dependencies;

  // Bounce mode keeps a separate heading from the instantaneous velocity. The
  // heading is the remembered launch/collision direction; it is not a request
  // to run the ordinary straight-line collision model. Gravity continuously
  // integrates the live vertical velocity, and a floor/ceiling contact creates
  // one continuous launch impulse from three simultaneous contributions:
  // current physical vertical speed (25%), heading-derived lift (35%), and a
  // bounded random perturbation (40%). A near-vertical heading can therefore
  // still make a high jump, but no bounce is selected from discrete modes.
  const BOUNCE_PHYSICS = Object.freeze({
    gravity: 500,
    launchBaseSpeed: 110,
    launchPeakSpeed: 520,
    randomLaunchMin: 50,
    randomLaunchMax: 1000,
    speedScale: 2 / 3,
    // Horizontal motion keeps its current speed for 80% of the sample and
    // borrows the same bounded random-speed sampler used by vertical launches
    // for the remaining 20%. The random contribution is independently either
    // positive or negative; it is not a simple +/-20% multiplier.
    horizontalRandomWeight: 0.2,
    physicalBounceWeight: 0.25,
    headingBounceWeight: 0.35,
    randomBounceWeight: 0.4,
    headingJitter: 0.16,
    minimumLaunchSpeed: 110
  });

  function createBouncePhysics({ random = Math.random, options = {} } = {}) {
    if (typeof random !== "function") throw new TypeError("Bounce physics random must be a function");
    const settings = {
      gravity: Number.isFinite(options.gravity) ? options.gravity : BOUNCE_PHYSICS.gravity,
      launchBaseSpeed: Number.isFinite(options.launchBaseSpeed)
        ? Math.max(1, options.launchBaseSpeed)
        : BOUNCE_PHYSICS.launchBaseSpeed,
      launchPeakSpeed: Number.isFinite(options.launchPeakSpeed)
        ? Math.max(1, options.launchPeakSpeed)
        : BOUNCE_PHYSICS.launchPeakSpeed,
      randomLaunchMin: Number.isFinite(options.randomLaunchMin)
        ? Math.max(0, options.randomLaunchMin)
        : BOUNCE_PHYSICS.randomLaunchMin,
      randomLaunchMax: Number.isFinite(options.randomLaunchMax)
        ? Math.max(1, options.randomLaunchMax)
        : BOUNCE_PHYSICS.randomLaunchMax,
      speedScale: Number.isFinite(options.speedScale)
        ? Math.max(0.05, Math.min(1, options.speedScale))
        : BOUNCE_PHYSICS.speedScale,
      horizontalRandomWeight: Number.isFinite(options.horizontalRandomWeight)
        ? Math.max(0, Math.min(1, options.horizontalRandomWeight))
        : (Number.isFinite(options.horizontalSpeedJitter)
          ? Math.max(0, Math.min(1, options.horizontalSpeedJitter))
          : BOUNCE_PHYSICS.horizontalRandomWeight),
      physicalBounceWeight: Number.isFinite(options.physicalBounceWeight)
        ? Math.max(0, options.physicalBounceWeight)
        : BOUNCE_PHYSICS.physicalBounceWeight,
      headingBounceWeight: Number.isFinite(options.headingBounceWeight)
        ? Math.max(0, options.headingBounceWeight)
        : BOUNCE_PHYSICS.headingBounceWeight,
      randomBounceWeight: Number.isFinite(options.randomBounceWeight)
        ? Math.max(0, options.randomBounceWeight)
        : BOUNCE_PHYSICS.randomBounceWeight,
      headingJitter: Number.isFinite(options.headingJitter)
        ? Math.max(0, Math.min(0.6, options.headingJitter))
        : BOUNCE_PHYSICS.headingJitter,
      minimumLaunchSpeed: Number.isFinite(options.minimumLaunchSpeed)
        ? Math.max(1, options.minimumLaunchSpeed)
        : BOUNCE_PHYSICS.minimumLaunchSpeed
    };

    function remember(ball) {
      const magnitude = Math.hypot(ball.storedVx, ball.storedVy) || 1;
      ball.bounceHeadingX = ball.storedVx / magnitude;
      ball.bounceHeadingY = ball.storedVy / magnitude;
      ball.bounceVelocityInitialized = true;
      ball.bounceLastStoredVx = ball.storedVx;
      ball.bounceLastStoredVy = ball.storedVy;
    }

    function prepareVelocity(ball, normalizeStoredVelocity) {
      if (!ball.bounceVelocityInitialized) remember(ball);
      const storedChanged = Math.abs(ball.storedVx - ball.bounceLastStoredVx) > 1e-9 ||
        Math.abs(ball.storedVy - ball.bounceLastStoredVy) > 1e-9;
      if (storedChanged || ball.speedNeedsNormalization) {
        if (ball.speedNeedsNormalization) normalizeStoredVelocity(ball);
        if (storedChanged) adoptHeading(ball);
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
        ball.speedNeedsNormalization = false;
      }
    }

    function adoptHeading(ball) {
      const magnitude = Math.hypot(ball.storedVx, ball.storedVy);
      if (magnitude <= 0.001) return;
      ball.bounceHeadingX = ball.storedVx / magnitude;
      ball.bounceHeadingY = ball.storedVy / magnitude;
    }

    function randomizeHorizontalSpeed(ball, { force = false } = {}) {
      if (!force && ball.bounceHorizontalSpeedRandomized) return;
      ball.bounceHorizontalSpeedRandomized = true;
      const horizontalSpeed = Number.isFinite(ball.vx) ? ball.vx : (ball.storedVx || 0);
      const randomWeight = settings.horizontalRandomWeight;
      if (randomWeight <= 0) return;
      const sampledSpeed = randomLaunchSpeed();
      const signedSample = (random() < 0.5 ? -1 : 1) * sampledSpeed;
      const blendedSpeed =
        horizontalSpeed * (1 - randomWeight) + signedSample * randomWeight;
      ball.vx = blendedSpeed;
      ball.storedVx = blendedSpeed;
    }

    function reflectHeading(ball, horizontal, vertical) {
      if (!ball.bounceVelocityInitialized) remember(ball);
      if (horizontal) ball.bounceHeadingX *= -1;
      if (vertical) ball.bounceHeadingY *= -1;
      const angle = Math.atan2(ball.bounceHeadingY, ball.bounceHeadingX) +
        (random() * 2 - 1) * settings.headingJitter;
      ball.bounceHeadingX = Math.cos(angle);
      ball.bounceHeadingY = Math.sin(angle);
    }

    function straightLaunchSpeed(ball) {
      const alignment = Math.abs(ball.bounceHeadingY);
      const base = settings.launchBaseSpeed * settings.speedScale;
      const peak = settings.launchPeakSpeed * settings.speedScale;
      return base + (peak - base) * Math.pow(alignment, 1.35);
    }

    function physicalLaunchSpeed(ball) {
      const base = settings.launchBaseSpeed * settings.speedScale;
      const peak = settings.launchPeakSpeed * settings.speedScale;
      const minimum = settings.minimumLaunchSpeed * settings.speedScale;
      const physicalSpeed = Math.min(
        peak,
        Math.max(base, Math.abs(ball.vy))
      );
      return Math.max(minimum, physicalSpeed);
    }

    function randomLaunchSpeed() {
      // The random contribution intentionally uses the full 50..1000 range;
      // only the physical and heading contributions retain speedScale.
      return settings.randomLaunchMin +
        random() * (settings.randomLaunchMax - settings.randomLaunchMin);
    }

    function blendedLaunchSpeed(ball) {
      const totalWeight = settings.physicalBounceWeight +
        settings.headingBounceWeight + settings.randomBounceWeight || 1;
      const physicalWeight = settings.physicalBounceWeight / totalWeight;
      const headingWeight = settings.headingBounceWeight / totalWeight;
      const randomWeight = settings.randomBounceWeight / totalWeight;
      const blended = physicalWeight * physicalLaunchSpeed(ball) +
        headingWeight * straightLaunchSpeed(ball) +
        randomWeight * randomLaunchSpeed();
      const minimum = settings.minimumLaunchSpeed * settings.speedScale;
      const maximum = Math.max(
        settings.launchPeakSpeed * settings.speedScale,
        settings.randomLaunchMax
      );
      return Math.max(
        minimum,
        Math.min(maximum, blended)
      );
    }

    function commitVelocity(ball) {
      ball.storedVx = ball.vx;
      ball.storedVy = ball.vy;
      ball.bounceLastStoredVx = ball.storedVx;
      ball.bounceLastStoredVy = ball.storedVy;
      ball.bounceVelocityInitialized = true;
    }

    function integrate(ball, dt) {
      if (!ball.bounceVelocityInitialized) remember(ball);
      ball.vy += settings.gravity * dt;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      commitVelocity(ball);
    }

    function resolveWalls(ball, arenaValue) {
      const arena = resolveArenaGeometry(arenaValue);
      const radius = ball.radius;
      if (arena.shape === "circle") {
        const distance = Math.hypot(ball.x - arena.centerX, ball.y - arena.centerY);
        if (distance < arena.width / 2 - radius || distance < 1e-9) return { bouncedX: false, bouncedY: false };
        const hit = Number.isFinite(ball.prevX) && Number.isFinite(ball.prevY)
          ? arena.traceSegment(ball.prevX, ball.prevY, ball.x, ball.y, radius) : null;
        const nx = hit ? hit.normalX : (arena.centerX - ball.x) / distance;
        const ny = hit ? hit.normalY : (arena.centerY - ball.y) / distance;
        const point = arena.clampPoint(hit ? hit.x : ball.x, hit ? hit.y : ball.y, radius);
        ball.x = point.x; ball.y = point.y;
        const incoming = ball.vx * nx + ball.vy * ny;
        if (incoming >= 0) return { bouncedX: false, bouncedY: false };
        if (!ball.bounceVelocityInitialized) remember(ball);
        const headingDot = ball.bounceHeadingX * nx + ball.bounceHeadingY * ny;
        ball.bounceHeadingX -= 2 * headingDot * nx;
        ball.bounceHeadingY -= 2 * headingDot * ny;
        ball.vx -= 2 * incoming * nx;
        ball.vy -= 2 * incoming * ny;
        const reflectedNormal = -incoming;
        const launch = Math.abs(ny) * blendedLaunchSpeed(ball) + (1 - Math.abs(ny)) * reflectedNormal;
        ball.vx += (launch - reflectedNormal) * nx;
        ball.vy += (launch - reflectedNormal) * ny;
        randomizeHorizontalSpeed(ball, { force: true });
        const normalAfterKick = ball.vx * nx + ball.vy * ny;
        if (normalAfterKick < launch) {
          ball.vx += (launch - normalAfterKick) * nx;
          ball.vy += (launch - normalAfterKick) * ny;
        }
        commitVelocity(ball);
        return { bouncedX: Math.abs(nx) > 1e-9, bouncedY: Math.abs(ny) > 1e-9 };
      }
      let bouncedX = false;
      let bouncedY = false;
      if (ball.x - radius < arena.left) {
        ball.x = arena.left + radius;
        ball.vx = Math.abs(ball.vx);
        reflectHeading(ball, true, false);
        bouncedX = true;
      } else if (ball.x + radius > arena.right) {
        ball.x = arena.right - radius;
        ball.vx = -Math.abs(ball.vx);
        reflectHeading(ball, true, false);
        bouncedX = true;
      }

      if (ball.y - radius < arena.top) {
        ball.y = arena.top + radius;
        reflectHeading(ball, false, true);
        ball.vy = blendedLaunchSpeed(ball);
        bouncedY = true;
      } else if (ball.y + radius > arena.bottom) {
        ball.y = arena.bottom - radius;
        reflectHeading(ball, false, true);
        ball.vy = -blendedLaunchSpeed(ball);
        bouncedY = true;
      }
      // A vertical bounce must also perturb horizontal motion. Otherwise a
      // ball launched with vx=0 can remain in a perfectly vertical lane
      // forever. Sample once per boundary-contact step, not once per frame.
      if (bouncedX || bouncedY) randomizeHorizontalSpeed(ball, { force: true });
      if (bouncedX) ball.vx = (ball.x <= arena.left + radius ? 1 : -1) * Math.abs(ball.vx);
      if (bouncedX || bouncedY) commitVelocity(ball);
      return { bouncedX, bouncedY };
    }

    return Object.freeze({
      prepareVelocity,
      integrate,
      resolveWalls,
      commitVelocity,
      adoptHeading,
      randomizeHorizontalSpeed,
      settings: Object.freeze({ ...settings })
    });
  }

  return { BOUNCE_PHYSICS, createBouncePhysics };
});
