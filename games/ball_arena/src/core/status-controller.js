(function initializeStatusController(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createStatusControllerApi() {
  "use strict";

  const CAPABILITY_KEYS = Object.freeze([
    "canMove",
    "canAct",
    "canBodyAttack",
    "canDealDamage",
    "canBeSlowed"
  ]);

  function defaultCapabilities() {
    return {
      canMove: true,
      canAct: true,
      canBodyAttack: true,
      canDealDamage: true,
      canBeSlowed: true
    };
  }

  class StatusController {
    constructor({ now = () => 0, getOverrides = () => null } = {}) {
      if (typeof now !== "function" || typeof getOverrides !== "function") {
        throw new TypeError("StatusController requires function callbacks");
      }
      this.now = now;
      this.getOverrides = getOverrides;
      this.cache = new WeakMap();
    }

    invalidate(ball) {
      if (ball && typeof ball === "object") this.cache.delete(ball);
    }

    forCombatant(ball) {
      if (!ball || typeof ball !== "object") {
        throw new TypeError("Capability lookup requires a combatant");
      }
      const now = this.now();
      const revision = Number.isFinite(ball.statusRevision) ? ball.statusRevision : 0;
      const effectCount = ball.effects instanceof Map ? ball.effects.size : 0;
      const cached = this.cache.get(ball);
      if (
        cached && cached.time === now && cached.revision === revision &&
        cached.effectCount === effectCount &&
        cached.movementLocked === (ball.movementLocked === true)
      ) {
        return cached.capabilities;
      }

      const capabilities = defaultCapabilities();
      if (ball.movementLocked === true) capabilities.canMove = false;
      for (const effect of ball.effects instanceof Map ? ball.effects.values() : []) {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) continue;
        if (effect.locksMovement === true) capabilities.canMove = false;
        if (effect.pausesBehavior === true) capabilities.canAct = false;
        if (effect.preventsAttack === true) capabilities.canBodyAttack = false;
        if (effect.blocksDamageOutput === true) capabilities.canDealDamage = false;
      }

      const overrides = this.getOverrides(ball) || {};
      for (const key of CAPABILITY_KEYS) {
        if (overrides[key] === true) capabilities[key] = true;
        if (overrides[key] === false) capabilities[key] = false;
      }

      // A few control effects must be authoritative even while a ball is in
      // a phase that normally overrides its capabilities (for example a
      // domain animation).  The effect opts into this explicitly so ordinary
      // stuns retain the existing override semantics.
      for (const effect of ball.effects instanceof Map ? ball.effects.values() : []) {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) continue;
        const forced = effect.forceCapabilities;
        if (!forced || typeof forced !== "object") continue;
        for (const key of CAPABILITY_KEYS) {
          if (forced[key] === true) capabilities[key] = true;
          if (forced[key] === false) capabilities[key] = false;
        }
      }
      const frozen = Object.freeze(capabilities);
      this.cache.set(ball, {
        time: now,
        revision,
        effectCount,
        movementLocked: ball.movementLocked === true,
        capabilities: frozen
      });
      return frozen;
    }
  }

  return { CAPABILITY_KEYS, StatusController };
});
