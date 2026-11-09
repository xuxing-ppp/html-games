(function initializeKnockback(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createKnockbackApi() {
  "use strict";

  const EPSILON = 1e-9;

  function knockbackWeight(elapsed, duration) {
    const remaining = Math.max(0, Math.min(1, 1 - elapsed / duration));
    return remaining * remaining;
  }

  function knockbackDurationForDistance(distance, peakSpeed, settleSpeed) {
    const meanSpeed = (peakSpeed + 2 * settleSpeed) / 3;
    return meanSpeed > EPSILON ? distance / meanSpeed : 0;
  }

  // Integral of the same curve used by runtime and trajectory prediction.
  function knockbackWeightIntegral(from, to, duration) {
    const start = Math.max(0, Math.min(duration, from));
    const end = Math.max(start, Math.min(duration, to));
    return duration / 3 * (
      Math.pow(1 - start / duration, 3) - Math.pow(1 - end / duration, 3)
    );
  }

  function createKnockbackEffect(options) {
    if (!options || typeof options.id !== "string" || !options.id.trim()) {
      throw new TypeError("Knockback requires a non-empty id");
    }
    if (!Number.isFinite(options.duration) || options.duration <= 0) {
      throw new TypeError("Knockback requires a positive duration");
    }
    const { speed, speedMultiplier = 1, distance, settleSpeedMultiplier = 1, impulseDuration } = options;
    if ((speed !== undefined && (!Number.isFinite(speed) || speed < 0)) ||
        !Number.isFinite(speedMultiplier) || speedMultiplier < 0 ||
        !Number.isFinite(settleSpeedMultiplier) || settleSpeedMultiplier < 0 ||
        (distance !== undefined && (!Number.isFinite(distance) || distance <= 0)) ||
        (impulseDuration !== undefined && (!Number.isFinite(impulseDuration) ||
          impulseDuration <= 0 || impulseDuration > options.duration))) {
      throw new TypeError("Knockback requires finite non-negative speeds and a positive distance");
    }
    const { useBaseSpeed = false, restorePreviousSpeed = false, ...definition } = options;
    return {
      ...definition,
      locksMovement: true,
      bounceCompatible: true,
      knockback: Object.freeze({ speed, speedMultiplier, useBaseSpeed, distance, settleSpeedMultiplier, impulseDuration, restorePreviousSpeed })
    };
  }

  function getKnockbackState(ball) {
    const state = ball && ball.knockbackState;
    return state && state.effect && !state.effect.immune ? state : null;
  }

  function startKnockback(ball, effect, now, fieldPhysics, normalSpeed) {
    const config = effect.knockback;
    let dx = effect.directionX;
    let dy = effect.directionY;
    const magnitude = Math.hypot(dx, dy);
    if (!Number.isFinite(magnitude) || magnitude <= EPSILON) return false;
    dx /= magnitude;
    dy /= magnitude;
    const referenceSpeed = config.useBaseSpeed ? ball.speed : normalSpeed;
    const peakSpeed = config.speed === undefined ? referenceSpeed * config.speedMultiplier : config.speed;
    if (!Number.isFinite(peakSpeed) || peakSpeed < 0) return false;
    const settleSpeed = normalSpeed * config.settleSpeedMultiplier;
    const meanSpeed = (peakSpeed + 2 * settleSpeed) / 3;
    const duration = config.distance === undefined || meanSpeed <= EPSILON
      ? (config.impulseDuration || effect.duration)
      : Math.min(effect.duration, knockbackDurationForDistance(config.distance, peakSpeed, settleSpeed));
    const previous = getKnockbackState(ball);
    effect.savedVx = previous ? previous.effect.savedVx : ball.storedVx;
    effect.savedVy = previous ? previous.effect.savedVy : ball.storedVy;
    effect.savedSpeed = Math.hypot(effect.savedVx, effect.savedVy);
    effect.startedAt = now;
    effect.directionX = dx;
    effect.directionY = dy;
    effect.vx = dx * peakSpeed;
    effect.vy = dy * peakSpeed;
    const state = {
      effect, startedAt: now, duration, fieldPhysics,
      peakSpeed, settleSpeed, extraSpeed: peakSpeed - settleSpeed,
      directionX: dx, directionY: dy, updatedAt: now
    };
    ball.knockbackState = state;
    ball.vx = effect.vx;
    ball.vy = effect.vy;
    if (fieldPhysics) {
      ball.storedVx = ball.vx;
      ball.storedVy = ball.vy;
    } else {
      ball.storedVx = dx * normalSpeed;
      ball.storedVy = dy * normalSpeed;
    }
    return true;
  }

  function advanceKnockback(ball, now, dt, locked, normalSpeed) {
    const state = getKnockbackState(ball);
    ball.knockbackStep = null;
    if (!state) return;
    const elapsed = Math.max(0, now - state.startedAt);
    const from = Math.max(0, state.updatedAt - state.startedAt);
    state.updatedAt = now;
    if (locked) {
      ball.vx = 0;
      ball.vy = 0;
      // A hard lock consumes the impulse rather than replaying it on release.
      state.extraSpeed = 0;
      state.settleSpeed = 0;
      return;
    }
    const startWeight = knockbackWeight(from, state.duration);
    const endWeight = knockbackWeight(elapsed, state.duration);
    const settleSpeed = normalSpeed * state.effect.knockback.settleSpeedMultiplier;
    const delta = state.extraSpeed * (endWeight - startWeight) + settleSpeed - state.settleSpeed;
    ball.vx += state.directionX * delta;
    ball.vy += state.directionY * delta;
    state.settleSpeed = settleSpeed;
    state.effect.vx = ball.vx;
    state.effect.vy = ball.vy;
    if (!state.fieldPhysics) {
      ball.storedVx = state.directionX * normalSpeed;
      ball.storedVy = state.directionY * normalSpeed;
    }
    const integral = knockbackWeightIntegral(from, elapsed, state.duration);
    const correction = state.extraSpeed * (integral - endWeight * dt);
    ball.knockbackStep = {
      time: now, x: state.directionX * correction, y: state.directionY * correction
    };
  }

  // Physics owns the resulting heading. No next-frame callback may resurrect
  // the pre-impact vector; collision energy can also consume the remaining kick.
  function redirectKnockback(ball, now) {
    const state = getKnockbackState(ball);
    if (!state) return;
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed <= EPSILON) {
      state.extraSpeed = 0;
      return;
    }
    state.directionX = state.effect.directionX = ball.vx / speed;
    state.directionY = state.effect.directionY = ball.vy / speed;
    state.effect.vx = ball.vx;
    state.effect.vy = ball.vy;
    const weight = knockbackWeight(now - state.startedAt, state.duration);
    if (weight > EPSILON && state.extraSpeed > 0) {
      state.extraSpeed = Math.min(state.extraSpeed, Math.max(0, speed - state.settleSpeed) / weight);
    }
  }

  function finishKnockback(ball, effect, normalSpeed, locked) {
    const state = ball && ball.knockbackState;
    if (!state || state.effect !== effect) return;
    ball.knockbackState = null;
    if (locked || ball.positionLocked) {
      ball.vx = 0;
      ball.vy = 0;
      return;
    }
    if (effect.immune) {
      ball.vx = ball.storedVx = effect.savedVx;
      ball.vy = ball.storedVy = effect.savedVy;
      return;
    }
    if (!state.fieldPhysics) {
      const restoreSpeed = effect.knockback.restorePreviousSpeed && effect.savedSpeed > EPSILON
        ? effect.savedSpeed : normalSpeed;
      const magnitude = Math.hypot(ball.vx, ball.vy);
      const dx = magnitude > EPSILON ? ball.vx / magnitude : state.directionX;
      const dy = magnitude > EPSILON ? ball.vy / magnitude : state.directionY;
      ball.vx = ball.storedVx = dx * restoreSpeed;
      ball.vy = ball.storedVy = dy * restoreSpeed;
    } else {
      const weight = knockbackWeight(state.updatedAt - state.startedAt, state.duration);
      ball.vx -= state.directionX * state.extraSpeed * weight;
      ball.vy -= state.directionY * state.extraSpeed * weight;
      ball.storedVx = ball.vx;
      ball.storedVy = ball.vy;
    }
  }

  return {
    createKnockbackEffect, knockbackWeight, knockbackWeightIntegral, knockbackDurationForDistance,
    getKnockbackState, startKnockback, advanceKnockback, redirectKnockback, finishKnockback
  };
});
