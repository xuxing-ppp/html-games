(function initializeDamageReduction(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDamageReductionApi() {
  "use strict";

  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeReduction(reduction) {
    if (!Number.isFinite(reduction)) {
      throw new TypeError("Damage reduction must be a finite number");
    }
    return clamp(reduction, 0, 1);
  }

  function requireRandom(random) {
    if (typeof random !== "function") {
      throw new TypeError("Damage reduction requires a random function");
    }
    return random;
  }

  // Shared target-side damage reduction convention, originally established by
  // Da Yun V3 and Red Blood:
  //   - reduced amounts of at least one are floored;
  //   - sub-one remainders become the probability of losing exactly one HP.
  function reduceDamageAmount(amount, reduction, random = Math.random) {
    if (!Number.isFinite(amount)) {
      throw new TypeError("Damage amount must be a finite number");
    }
    if (amount <= 0) return 0;
    const normalized = normalizeReduction(reduction);
    if (normalized <= 0) return amount;
    if (normalized >= 1) return 0;

    const reduced = amount * (1 - normalized);
    if (reduced >= 1 - EPSILON) return Math.max(1, Math.floor(reduced + EPSILON));
    if (requireRandom(random)() < reduced) return 1;
    return 0;
  }

  function applyDamageReduction(event, reduction, random = Math.random) {
    if (!event || !Number.isFinite(event.amount)) {
      throw new TypeError("Damage reduction requires an event with a finite amount");
    }
    if (isTrueDamage(event)) return event;
    const amount = reduceDamageAmount(event.amount, reduction, random);
    if (amount === event.amount) return event;
    if (amount <= 0) return { amount: 0, showHitText: false };
    return { ...event, amount };
  }

  // This tag bypasses numeric reduction and dodge rolls, not shields,
  // invulnerability, targetability, or lethal form transitions.
  function isTrueDamage(event) {
    return !!(event && event.attackTags && event.attackTags.includes("true-damage"));
  }

  return {
    reduceDamageAmount,
    applyDamageReduction,
    isTrueDamage,
    normalizeReduction
  };
});
