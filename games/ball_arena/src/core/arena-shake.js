(function initializeArenaShake(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createArenaShakeApi() {
  "use strict";

  const MIN_DISTANCE = 1;
  const MIN_DURATION_SECONDS = 0.05;
  const MAX_DURATION_SECONDS = 0.1;
  const DEFAULT_DURATION_SECONDS = 0.075;
  const DEFAULT_MAX_DISTANCE = 6;
  const SAMPLE_RATE = 60;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
  const ZERO_OFFSET = Object.freeze({ x: 0, y: 0 });

  const ARENA_SHAKE_CONSTANTS = Object.freeze({
    minDistance: MIN_DISTANCE,
    minDurationSeconds: MIN_DURATION_SECONDS,
    maxDurationSeconds: MAX_DURATION_SECONDS,
    defaultDurationSeconds: DEFAULT_DURATION_SECONDS,
    defaultMaxDistance: DEFAULT_MAX_DISTANCE
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDuration(value, fallback = DEFAULT_DURATION_SECONDS) {
    return clamp(
      Number.isFinite(value) ? value : fallback,
      MIN_DURATION_SECONDS,
      MAX_DURATION_SECONDS
    );
  }

  function normalizeIntensity(value, fallback = MIN_DISTANCE) {
    return Number.isFinite(value) && value > 0
      ? Math.max(MIN_DISTANCE, value)
      : fallback;
  }

  function createArenaShakeProfile(amount, customization) {
    const damage = Number.isFinite(amount) ? Math.max(0, amount) : 0;
    if (damage <= 0 || customization === false) return null;
    if (customization && customization.enabled === false) return null;

    const profile = {
      intensity: Math.max(
        MIN_DISTANCE,
        Math.min(DEFAULT_MAX_DISTANCE, Math.sqrt(damage))
      ),
      duration: MIN_DURATION_SECONDS +
        Math.min(1, damage / 20) * (MAX_DURATION_SECONDS - MIN_DURATION_SECONDS)
    };
    if (Number.isFinite(customization)) {
      profile.intensity = normalizeIntensity(customization, profile.intensity);
    } else if (customization && typeof customization === "object") {
      if (Number.isFinite(customization.intensity)) {
        profile.intensity = normalizeIntensity(customization.intensity, profile.intensity);
      }
      if (Number.isFinite(customization.duration)) {
        profile.duration = normalizeDuration(customization.duration, profile.duration);
      }
    }
    return profile;
  }

  function normalizeArenaShakeOptions(options = {}) {
    if (options === false) return null;
    if (Number.isFinite(options)) {
      return {
        intensity: normalizeIntensity(options),
        duration: DEFAULT_DURATION_SECONDS
      };
    }
    const source = options && typeof options === "object" ? options : {};
    if (source.enabled === false) return null;
    return {
      intensity: normalizeIntensity(source.intensity),
      duration: normalizeDuration(source.duration)
    };
  }

  class ArenaShakeController {
    constructor({ getTime = () => 0 } = {}) {
      if (typeof getTime !== "function") {
        throw new TypeError("Arena shake requires a time provider");
      }
      this.getTime = getTime;
      this.reset();
    }

    reset() {
      this.sequence = 0;
      this.startedAt = 0;
      this.duration = 0;
      this.intensity = 0;
    }

    remainingAt(time) {
      if (this.duration <= 0 || !Number.isFinite(time)) return 0;
      return Math.max(0, this.startedAt + this.duration - time);
    }

    trigger(options = {}) {
      const profile = normalizeArenaShakeOptions(options);
      if (!profile) return null;
      const providedTime = this.getTime();
      const time = Number.isFinite(providedTime) ? providedTime : 0;
      const current = this.getOffset(time);
      const remaining = this.remainingAt(time);
      this.sequence += 1;
      this.startedAt = time;
      this.duration = Math.max(profile.duration, remaining);
      this.intensity = Math.max(
        profile.intensity,
        Math.hypot(current.x, current.y)
      );
      return this.getState(time);
    }

    getOffset(time = this.getTime()) {
      if (!Number.isFinite(time) || this.duration <= 0) return ZERO_OFFSET;
      const age = time - this.startedAt;
      if (age < 0 || age >= this.duration) return ZERO_OFFSET;
      const progress = clamp(age / this.duration, 0, 1);
      const sample = Math.floor(age * SAMPLE_RATE);
      const angle = (this.sequence + sample) * GOLDEN_ANGLE;
      const magnitude = this.intensity * Math.pow(1 - progress, 1.35);
      return { x: Math.cos(angle) * magnitude, y: Math.sin(angle) * magnitude };
    }

    getState(time = this.getTime()) {
      return {
        active: this.remainingAt(time) > 0,
        intensity: this.intensity,
        duration: this.duration,
        remaining: this.remainingAt(time),
        offset: this.getOffset(time)
      };
    }
  }

  return {
    ARENA_SHAKE_CONSTANTS,
    ArenaShakeController,
    createArenaShakeProfile,
    normalizeArenaShakeOptions
  };
});
