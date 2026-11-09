(function initializeEffects(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createEffectsApi() {
  "use strict";

  function createEffectInstance(definition, now, previous = null) {
    if (!definition || typeof definition.id !== "string" || !definition.id.trim()) {
      throw new TypeError("Effect requires a non-empty id");
    }
    if (!Number.isFinite(definition.duration) || definition.duration <= 0) {
      throw new TypeError(`Effect ${definition.id} requires a positive duration`);
    }

    return {
      ...(previous || {}),
      ...definition,
      expiresAt: now + definition.duration
    };
  }

  return { createEffectInstance };
});
