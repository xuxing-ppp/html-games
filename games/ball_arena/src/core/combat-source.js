(function initializeCombatSource(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCombatSourceApi() {
  "use strict";

  const COMBAT_KINDS = new Set([
    "body", "skill", "projectile", "summon", "trap", "zone", "dot", "environment", "self"
  ]);

  const NO_ATTACK_TAGS = Object.freeze([]);

  function normalizeAttackTags(tags) {
    if (tags === undefined || tags === null) return NO_ATTACK_TAGS;
    if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !/^[a-z][a-z-]*$/.test(tag))) {
      throw new TypeError("Attack tags must be an array of lowercase identifiers");
    }
    return tags.length ? Object.freeze(Array.from(new Set(tags))) : NO_ATTACK_TAGS;
  }

  function createCombatSource(definition) {
    if (!definition || !definition.actor) {
      throw new TypeError("Combat source requires an actor");
    }
    if (definition.teamId === undefined || definition.teamId === null) {
      throw new TypeError("Combat source requires a teamId");
    }
    if (!definition.credit) {
      throw new TypeError("Combat source requires credit");
    }
    if (!COMBAT_KINDS.has(definition.kind)) {
      throw new TypeError("Combat source has an invalid kind");
    }

    const owner = definition.owner || null;
    const inheritedForcedTarget = owner && owner.forcedTargetInstanceId
      ? owner.forcedTargetInstanceId
      : null;
    const targetPolicyDefinition = Object.prototype.hasOwnProperty.call(definition, "targetPolicy")
      ? definition.targetPolicy : (
      inheritedForcedTarget ? { forcedTargetInstanceId: inheritedForcedTarget } : null
    );
    const targetPolicy = targetPolicyDefinition && typeof targetPolicyDefinition === "object"
      ? Object.freeze({ ...targetPolicyDefinition })
      : targetPolicyDefinition;
    return Object.freeze({
      actor: definition.actor,
      owner,
      credit: definition.credit,
      teamId: definition.teamId,
      kind: definition.kind,
      attackTags: normalizeAttackTags(definition.attackTags),
      entity: definition.entity || null,
      contact: definition.contact || null,
      targetPolicy: targetPolicy || null,
      damageOutputScale: Number.isFinite(definition.damageOutputScale)
        ? definition.damageOutputScale
        : (Number.isFinite(definition.credit.damageOutputScale)
          ? definition.credit.damageOutputScale
          : 1)
    });
  }

  function sourceForCombatant(combatant, overrides = {}) {
    return createCombatSource({
      actor: combatant,
      owner: combatant,
      credit: combatant,
      teamId: combatant.teamId,
      kind: overrides.kind || "skill",
      attackTags: overrides.attackTags,
      contact: overrides.contact || null,
      targetPolicy: overrides.targetPolicy || combatant.targetPolicy || (
        combatant.forcedTargetInstanceId
          ? { forcedTargetInstanceId: combatant.forcedTargetInstanceId }
          : null
      ),
      damageOutputScale: Number.isFinite(overrides.damageOutputScale)
        ? overrides.damageOutputScale
        : combatant.damageOutputScale
    });
  }

  return {
    COMBAT_KINDS,
    normalizeAttackTags,
    createCombatSource,
    sourceForCombatant
  };
});
