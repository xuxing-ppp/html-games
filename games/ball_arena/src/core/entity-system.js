(function initializeEntitySystem(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./combat-source.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createEntitySystemApi(dependencies) {
  "use strict";

  const { createCombatSource } = dependencies;

  const LIFECYCLES = new Set(["independent", "owner-bound"]);

  class EntitySystem {
    constructor({
      getTime = () => 0,
      getOwner = () => null,
      invokeUpdate = () => {},
      getDelta = (entity, dt) => dt,
      onRemove = () => {}
    } = {}) {
      if (
        typeof getTime !== "function" ||
        typeof getOwner !== "function" ||
        typeof invokeUpdate !== "function" ||
        typeof getDelta !== "function" ||
        typeof onRemove !== "function"
      ) {
        throw new TypeError("EntitySystem requires function callbacks");
      }
      this.getTime = getTime;
      this.getOwner = getOwner;
      this.invokeUpdate = invokeUpdate;
      this.getDelta = getDelta;
      this.onRemove = onRemove;
      this.entities = [];
      this.pendingEntities = [];
      this.entitiesById = new Map();
      this.nextId = 1;
      this.isUpdating = false;
    }

    beginStep() {
      this.isUpdating = true;
    }

    endStep() {
      this.isUpdating = false;
    }

    reset() {
      this.entities.length = 0;
      this.pendingEntities.length = 0;
      this.entitiesById.clear();
      this.nextId = 1;
      this.isUpdating = false;
    }

    spawn(definition, owner, overrides = {}) {
      const parentSource = owner && owner.actor ? owner : null;
      if (parentSource) owner = parentSource.owner || parentSource.credit;
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Combat entity requires a definition");
      }
      if (!Number.isFinite(definition.life) || definition.life <= 0) {
        throw new TypeError("Combat entity requires a positive life");
      }
      const kind = overrides.combatKind || definition.combatKind || overrides.kind || definition.kind;
      if (typeof kind !== "string" || !kind) {
        throw new TypeError("Combat entity requires a kind");
      }
      const lifecycle = overrides.lifecycle || definition.lifecycle || "independent";
      if (!LIFECYCLES.has(lifecycle)) {
        throw new TypeError(`Combat entity has an invalid lifecycle: ${lifecycle}`);
      }
      if (!owner || owner.teamId === undefined) {
        throw new TypeError("Combat entity requires an owner with a teamId");
      }

      const credit = overrides.credit || definition.credit || (parentSource && parentSource.credit) || owner;
      const instanceId = overrides.instanceId || `${owner.instanceId}-entity-${this.nextId++}`;
      const entity = {
        ...definition,
        ...overrides,
        instanceId,
        ownerInstanceId: owner.instanceId,
        creditInstanceId: credit.instanceId,
        teamId: overrides.teamId === undefined
          ? (parentSource ? parentSource.teamId : owner.teamId) : overrides.teamId,
        lifecycle,
        age: 0,
        entityActive: true,
        isCombatEntity: true,
        owner,
        combatSource: null
      };
      entity.combatSource = createCombatSource({
        actor: entity,
        owner,
        credit,
        teamId: entity.teamId,
        kind,
        entity,
        attackTags: entity.attackTags,
        targetPolicy: Object.prototype.hasOwnProperty.call(overrides, "targetPolicy")
          ? overrides.targetPolicy
          : (Object.prototype.hasOwnProperty.call(definition, "targetPolicy")
            ? definition.targetPolicy
            : (parentSource ? parentSource.targetPolicy : owner.targetPolicy || (
              owner.forcedTargetInstanceId ? { forcedTargetInstanceId: owner.forcedTargetInstanceId } : null
            ))),
        damageOutputScale: Number.isFinite(overrides.damageOutputScale)
          ? overrides.damageOutputScale
          : (Number.isFinite(definition.damageOutputScale)
            ? definition.damageOutputScale
            : (parentSource ? parentSource.damageOutputScale : owner.damageOutputScale))
      });
      this.entitiesById.set(entity.instanceId, entity);
      const destination = this.isUpdating ? this.pendingEntities : this.entities;
      destination.push(entity);
      return entity;
    }

    get(instanceId) {
      return this.entitiesById.get(instanceId) || null;
    }

    update(dt) {
      const wasUpdating = this.isUpdating;
      this.isUpdating = true;
      const originalLength = this.entities.length;
      let writeIndex = 0;
      let readIndex = 0;
      try {
        for (; readIndex < originalLength; readIndex += 1) {
          const entity = this.entities[readIndex];
          const owner = entity.lifecycle === "owner-bound"
            ? this.getOwner(entity.ownerInstanceId)
            : null;
          const ownerRetiredForCompetitiveMode = owner && owner.competitiveRetired === true;
          const ownerDiedDuringCompetitiveStep = owner && owner.isModeActive === true &&
            owner.competitiveMode && (owner.competitiveMode === "wheel" || owner.competitiveMode === "coop") &&
            owner.hp <= 0;
          if (entity.entityActive === false || entity.age >= entity.life || (entity.lifecycle === "owner-bound" &&
            (!owner || (owner.hp <= 0 && !ownerRetiredForCompetitiveMode && !ownerDiedDuringCompetitiveStep)))) {
            this.removeEntity(entity);
            continue;
          }
          const entityDt = this.getDelta(entity, dt);
          if (entityDt !== null) {
            this.invokeUpdate(entity, entityDt);
            entity.age += entityDt;
          }
          if (entity.entityActive !== false && entity.age < entity.life) {
            this.entities[writeIndex] = entity;
            writeIndex += 1;
          } else {
            this.removeEntity(entity);
          }
        }
        this.entities.length = writeIndex;
      } catch (cause) {
        const retained = new Set(this.entities.slice(0, writeIndex));
        for (let index = readIndex; index < originalLength; index += 1) {
          const entity = this.entities[index];
          if (!entity || retained.has(entity)) continue;
          if (entity.entityActive === false) {
            this.removeEntity(entity);
            continue;
          }
          this.entities[writeIndex] = entity;
          writeIndex += 1;
          retained.add(entity);
        }
        this.entities.length = writeIndex;
        throw cause;
      } finally {
        this.isUpdating = wasUpdating;
      }
    }

    flushPending() {
      if (this.pendingEntities.length === 0) return;
      for (const entity of this.pendingEntities) {
        const owner = entity.lifecycle === "owner-bound"
          ? this.getOwner(entity.ownerInstanceId)
          : null;
        if (
          entity.entityActive === false ||
          (entity.lifecycle === "owner-bound" && (!owner ||
            (owner.hp <= 0 && owner.competitiveRetired !== true &&
              !(owner.isModeActive === true && owner.competitiveMode &&
                (owner.competitiveMode === "wheel" || owner.competitiveMode === "coop")))))
        ) {
          this.removeEntity(entity);
          continue;
        }
        this.entities.push(entity);
      }
      this.pendingEntities.length = 0;
    }

    discardPending() {
      for (const entity of this.pendingEntities) this.removeEntity(entity);
      this.pendingEntities.length = 0;
    }

    removeEntity(entity) {
      if (!entity || !this.entitiesById.has(entity.instanceId)) return false;
      this.entitiesById.delete(entity.instanceId);
      entity.entityActive = false;
      this.onRemove(entity);
      return true;
    }
  }

  return { EntitySystem, ENTITY_LIFECYCLES: LIFECYCLES };
});
