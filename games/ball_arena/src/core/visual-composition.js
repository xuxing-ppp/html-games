(function initializeVisualComposition(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVisualCompositionApi() {
  "use strict";

  let nextVisualSeed = 0;

  // Never sample Math.random here: construction can run inside a seeded battle.
  function createVisualRandom(seed = (Date.now() + nextVisualSeed++)) {
    if (!Number.isFinite(seed)) throw new TypeError("Visual random requires a numeric seed");
    let state = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
    return function visualRandom() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  // Children remain ordinary visuals in the existing queue and layer order.
  function spawnVisualComposition(entries, spawnEntry) {
    if (!Array.isArray(entries)) throw new TypeError("Visual composition requires entries");
    const effects = [];
    let draining = false;
    let stopped = false;
    const endChildren = (immediate) => {
      let failure;
      let failed = false;
      for (const effect of effects) {
        try {
          if (typeof effect.end === "function") effect.end(immediate);
        } catch (cause) {
          if (!failed) failure = cause;
          failed = true;
        }
      }
      if (failed) throw failure;
    };
    const stop = () => {
      if (stopped) return false;
      stopped = true;
      for (const effect of effects) effect.visualActive = false;
      endChildren(true);
      return true;
    };
    try {
      for (const entry of entries) effects.push(spawnEntry(entry));
    } catch (cause) {
      // Roll back every created child without masking the original spawn failure.
      try { stop(); } catch (cleanupFailure) {}
      throw cause;
    }
    return Object.freeze({
      effects: Object.freeze(effects),
      stop,
      drain() {
        if (draining || stopped) return false;
        draining = true;
        endChildren();
        return true;
      }
    });
  }

  return { createVisualRandom, spawnVisualComposition };
});
