(function initializeDamageResolver(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./combat-source.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDamageResolverApi(dependencies) {
  "use strict";

  const { sourceForCombatant, createCombatSource } = dependencies;

  const EPSILON = 1e-9;

  function normalizeKind(options) {
    if (options && options.kind) return options.kind;
    return "skill";
  }

  function normalizeSource(source, options = {}) {
    if (source && source.actor && source.credit && source.teamId !== undefined) {
      if (options.attackTags !== undefined && options.attackTags !== source.attackTags) {
        return createCombatSource({ ...source, attackTags: options.attackTags });
      }
      return source;
    }
    if (!source) return null;
    return sourceForCombatant(source, {
      kind: normalizeKind(options),
      attackTags: options.attackTags,
      contact: options.contact || null
    });
  }

  class DamageResolver {
    constructor({
      areEnemies,
      canTarget,
      canExecuteTarget = () => false,
      getCapabilities,
      getContactProfile,
      beforeDamage,
      afterDamage,
      recordReplay,
      spawnHitText,
      blocksOwnedEntityDamage = () => false,
      onDefense = null
    } = {}) {
      for (const [name, callback] of Object.entries({
        areEnemies,
        canTarget,
        getCapabilities,
        getContactProfile,
        beforeDamage,
        afterDamage,
        recordReplay,
        spawnHitText,
        blocksOwnedEntityDamage
      })) {
        if (typeof callback !== "function") {
          throw new TypeError(`DamageResolver requires ${name} callback`);
        }
      }
      this.areEnemies = areEnemies;
      this.canTarget = canTarget;
      if (typeof canExecuteTarget !== "function") throw new TypeError("DamageResolver requires canExecuteTarget callback");
      this.canExecuteTarget = canExecuteTarget;
      this.getCapabilities = getCapabilities;
      this.getContactProfile = getContactProfile;
      this.beforeDamage = beforeDamage;
      this.afterDamage = afterDamage;
      this.recordReplay = recordReplay;
      this.spawnHitText = spawnHitText;
      this.blocksOwnedEntityDamage = blocksOwnedEntityDamage;
      if (onDefense !== null && typeof onDefense !== "function") throw new TypeError("DamageResolver requires an optional onDefense callback");
      this.onDefense = onDefense;
      this.hitTextRemainders = new WeakMap();
    }

    resolve(target, amount, source, options = {}) {
      if (!target || target.hp <= 0) return false;
      const combatSource = normalizeSource(source, options);
      if (!combatSource) return false;
      const actor = combatSource.actor;
      const isSelfDamage = actor === target;
      if (!isSelfDamage && !this.areEnemies(combatSource, target)) return false;
      if (!isSelfDamage && !this.canTarget(combatSource, target)) return false;

      const capabilities = this.getCapabilities(actor);
      if (
        !isSelfDamage && capabilities && capabilities.canDealDamage === false
      ) {
        return false;
      }
      if (
        !isSelfDamage && combatSource.owner &&
        this.blocksOwnedEntityDamage(combatSource.owner, combatSource) === true
      ) {
        return false;
      }

      let outgoingAmount = amount;
      const scale = combatSource.damageOutputScale;
      if (!isSelfDamage && Number.isFinite(scale) && scale !== 1 && Number.isFinite(outgoingAmount)) {
        if (outgoingAmount === 1 && scale === 0.5) {
          if (Math.random() >= 0.5) outgoingAmount = 0;
        } else {
          outgoingAmount = Math.floor(outgoingAmount * scale);
        }
      }

      const targetProfile = this.getContactProfile(target);
      const requiresTargetable = !["dot", "environment", "self"].includes(combatSource.kind);
      if (
        outgoingAmount > 0 &&
        requiresTargetable &&
        targetProfile.attackable === false
      ) return false;

      const event = {
        combatSource,
        actor,
        owner: combatSource.owner,
        credit: combatSource.credit,
        entity: combatSource.entity,
        kind: combatSource.kind,
        attackTags: combatSource.attackTags,
        amount: Math.max(0, outgoingAmount),
        options
      };

      const requestedAmount = event.amount;
      const resolution = this.beforeDamage(target, event) || event;
      const resolvedAmount = resolution.amount === undefined
        ? event.amount
        : resolution.amount;
      if (!Number.isFinite(resolvedAmount) || resolvedAmount < 0) {
        throw new TypeError(`Ball ${target.id || "<unknown>"} returned an invalid damage resolution`);
      }
      if (this.onDefense && !isSelfDamage && Number.isFinite(requestedAmount) && requestedAmount > 0 &&
          (resolution.cancelAttack === true || resolvedAmount < requestedAmount)) {
        this.onDefense(target, combatSource);
      }
      if (resolution.cancelAttack === true) return false;

      return this.commitDamage(target, event, resolution, resolvedAmount);
    }

    // Explicit lethal settlement, not an ordinary hit with defense-skip flags.
    // Target identity/health, team, captured policy and source permissions still
    // apply. Target armor, dodge, phase immunity and lethal interception do not.
    execute(target, source) {
      if (!target || !Number.isFinite(target.hp) || target.hp <= 0) return false;
      const combatSource = normalizeSource(source);
      if (!combatSource || !this.areEnemies(combatSource, target) ||
          !this.canExecuteTarget(combatSource, target)) return false;
      const capabilities = this.getCapabilities(combatSource.actor);
      if (capabilities && capabilities.canDealDamage === false) return false;
      if (combatSource.owner && this.blocksOwnedEntityDamage(combatSource.owner, combatSource)) return false;
      const event = {
        combatSource, actor: combatSource.actor, owner: combatSource.owner,
        credit: combatSource.credit, entity: combatSource.entity,
        kind: combatSource.kind, attackTags: combatSource.attackTags,
        amount: target.hp, options: Object.freeze({ execution: true })
      };
      const result = this.commitDamage(target, event, { amount: target.hp }, target.hp);
      // Damage observers still receive the lethal event, but reactive healing
      // during that callback cannot undo an explicit execution settlement.
      target.hp = 0;
      return result;
    }

    commitDamage(target, event, resolution, resolvedAmount) {
      const { combatSource, options } = event;
      const isSelfDamage = combatSource.actor === target;
      target.hp = Math.max(0, target.hp - resolvedAmount);
      // Repeated fractional ticks must not leave 9.000000000000004 displaying
      // as 10 (or a microscopic survivor instead of zero).
      const nearestHp = Math.round(target.hp);
      if (resolvedAmount > 0 && Math.abs(target.hp - nearestHp) < EPSILON) target.hp = nearestHp;
      if (options.showHitText !== false && resolution.showHitText !== false) {
        if (options.accumulateHitText === true) {
          const total = (this.hitTextRemainders.get(target) || 0) + resolvedAmount;
          const displayed = Math.floor(total + EPSILON);
          this.hitTextRemainders.set(target, Math.max(0, total - displayed));
          if (displayed > 0) this.spawnHitText(target.x, target.y, `-${displayed}`);
        } else {
          this.spawnHitText(target.x, target.y, `-${resolvedAmount}`);
        }
      }
      if (resolvedAmount > 0) {
        this.afterDamage(target, {
          ...event,
          amount: resolvedAmount,
          resolution
        });
      }
      if (
        resolvedAmount > 0 &&
        !isSelfDamage &&
        this.areEnemies(combatSource, target) &&
        options.replayAttack !== true
      ) {
        this.recordReplay(combatSource, target, resolvedAmount);
      }
      return true;
    }
  }

  return { DamageResolver, normalizeDamageSource: normalizeSource };
});
