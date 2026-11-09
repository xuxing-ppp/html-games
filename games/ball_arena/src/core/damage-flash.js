(function initializeDamageFlash(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDamageFlashApi() {
  "use strict";

  const MAX_INTENSITY = 6;
  const FADE_IN_SECONDS = 0.015;
  const FADE_OUT_SECONDS = 0.015;
  const ZERO_STATE = Object.freeze({
    active: false,
    intensity: 0,
    duration: 0,
    remaining: 0,
    alpha: 0
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function entryState(entry, time) {
    if (!entry || !Number.isFinite(time)) return ZERO_STATE;
    const age = time - entry.startedAt;
    const remaining = Math.max(0, entry.startedAt + entry.duration - time);
    if (age < 0 || remaining <= 0) return ZERO_STATE;
    let magnitude = entry.intensity;
    if (age < FADE_IN_SECONDS) {
      const progress = clamp(age / FADE_IN_SECONDS, 0, 1);
      magnitude = entry.initialMagnitude +
        (entry.intensity - entry.initialMagnitude) * progress;
    } else if (remaining < FADE_OUT_SECONDS) {
      magnitude *= clamp(remaining / FADE_OUT_SECONDS, 0, 1);
    }
    return {
      active: true,
      intensity: entry.intensity,
      duration: entry.duration,
      remaining,
      alpha: magnitude / MAX_INTENSITY
    };
  }

  class BallDamageFlashController {
    constructor({ getTime = () => 0 } = {}) {
      if (typeof getTime !== "function") {
        throw new TypeError("Ball damage flash requires a time provider");
      }
      this.getTime = getTime;
      this.entries = new WeakMap();
    }

    reset() {
      this.entries = new WeakMap();
    }

    trigger(ball, profile) {
      if (!ball || typeof ball !== "object" || !profile) return null;
      if (!Number.isFinite(profile.intensity) || profile.intensity <= 0) return null;
      if (!Number.isFinite(profile.duration) || profile.duration <= 0) return null;

      const providedTime = this.getTime();
      const time = Number.isFinite(providedTime) ? providedTime : 0;
      const current = this.entries.get(ball);
      const currentState = entryState(current, time);
      const remaining = currentState.active ? currentState.remaining : 0;
      const currentMagnitude = currentState.active
        ? currentState.alpha * MAX_INTENSITY
        : 0;
      const currentAge = current ? time - current.startedAt : Infinity;
      const pendingMagnitude = currentState.active && currentAge < FADE_IN_SECONDS
        ? currentState.intensity
        : currentMagnitude;
      const profileDuration = profile.duration + FADE_IN_SECONDS + FADE_OUT_SECONDS;
      this.entries.set(ball, {
        startedAt: time,
        duration: Math.max(profileDuration, remaining),
        intensity: Math.max(profile.intensity, pendingMagnitude),
        initialMagnitude: currentMagnitude
      });
      return this.getState(ball, time);
    }

    remainingAt(ball, time = this.getTime()) {
      return this.getState(ball, time).remaining;
    }

    getAlpha(ball, time = this.getTime()) {
      return this.getState(ball, time).alpha;
    }

    getState(ball, time = this.getTime()) {
      if (!ball || typeof ball !== "object") return ZERO_STATE;
      const entry = this.entries.get(ball);
      const state = entryState(entry, time);
      if (!state.active && entry) this.entries.delete(ball);
      return state;
    }
  }

  return {
    BallDamageFlashController,
    DAMAGE_FLASH_CONSTANTS: Object.freeze({
      maxIntensity: MAX_INTENSITY,
      fadeInSeconds: FADE_IN_SECONDS,
      fadeOutSeconds: FADE_OUT_SECONDS
    }),
    ZERO_DAMAGE_FLASH_STATE: ZERO_STATE
  };
});
