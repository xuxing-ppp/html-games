(function initializeBallRegistry(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBallRegistryApi() {
  "use strict";

  const BALL_ROSTER_TYPES = Object.freeze({
    NORMAL: "normal",
    // 杂鱼：战力明显低于普通球的独立档位，可手动进入普通槽位，但不属于 normal 池。
    ZAKO: "zako",
    // 精英球：几何、行为契约与普通槽位资格都和普通球一致，唯一差别是单体强度
    // 足以在同一场战斗里同时击败两颗普通球（1v2）。强度高出普通池一档就不再是
    // 「普通球」：随机抽球、借用/复制、赛事抽签都不再抽它，手动选入普通槽位与
    // 世界杯名录照旧。
    ELITE: "elite",
    // 规格外球：单体、超强、明显不该出现在随机池/赛事池里的球（六王球、六区球
    // Ultra、亿万人、日奈）。它们依然能手动选进普通对战槽位，只是不再属于
    // "普通球"这一档。再加新的强度分级时，往这里加一个值即可。
    OUT_OF_SPEC: "outOfSpec",
    BOSS: "boss"
  });

  const ROSTER_TYPE_VALUES = Object.freeze(Object.values(BALL_ROSTER_TYPES));
  const ROSTER_TYPE_NAMES = ROSTER_TYPE_VALUES.join(", ");

  function requireText(definition, field) {
    if (typeof definition[field] !== "string" || !definition[field].trim()) {
      throw new TypeError(`Ball definition requires a non-empty ${field}`);
    }
  }

  function requirePositiveStat(definition, field) {
    const value = definition.stats && definition.stats[field];
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError(`Ball ${definition.id || "<unknown>"} requires a positive ${field}`);
    }
  }

  function validateDefinition(definition) {
    if (!definition || typeof definition !== "object") {
      throw new TypeError("Ball definition must be an object");
    }

    requireText(definition, "id");
    requireText(definition, "name");
    requireText(definition, "englishName");
    requireText(definition, "description");

    if (typeof definition.color !== "string" || !/^#[0-9a-f]{6}$/i.test(definition.color)) {
      throw new TypeError(`Ball ${definition.id} requires a six-digit hex color`);
    }

    requirePositiveStat(definition, "radius");
    requirePositiveStat(definition, "speed");
    requirePositiveStat(definition, "maxHp");

    if (definition.healthless !== undefined && typeof definition.healthless !== "boolean") {
      throw new TypeError(`Ball ${definition.id} healthless must be boolean`);
    }

    if (
      definition.rosterType !== undefined &&
      !ROSTER_TYPE_VALUES.includes(definition.rosterType)
    ) {
      throw new TypeError(
        `Ball ${definition.id} rosterType must be one of: ${ROSTER_TYPE_NAMES}`
      );
    }

    if (typeof definition.createBehavior !== "function") {
      throw new TypeError(`Ball ${definition.id} requires a createBehavior function`);
    }
  }

  class BallRegistry {
    constructor() {
      this.definitions = new Map();
    }

    register(definition) {
      validateDefinition(definition);
      if (this.definitions.has(definition.id)) {
        throw new Error(`Duplicate ball ID: ${definition.id}`);
      }

      const normalized = Object.freeze({
        ...definition,
        rosterType: definition.rosterType || BALL_ROSTER_TYPES.NORMAL,
        stats: Object.freeze({ ...definition.stats })
      });
      this.definitions.set(normalized.id, normalized);
      return normalized;
    }

    get(id) {
      const definition = this.definitions.get(id);
      if (!definition) {
        throw new Error(`Unknown ball ID: ${id}`);
      }
      return definition;
    }

    list() {
      return Array.from(this.definitions.values());
    }

    listByRosterType(rosterType) {
      if (!ROSTER_TYPE_VALUES.includes(rosterType)) {
        throw new TypeError(`Ball roster type must be one of: ${ROSTER_TYPE_NAMES}`);
      }
      return this.list().filter((definition) => definition.rosterType === rosterType);
    }
  }

  const ballRegistry = new BallRegistry();

  return {
    BALL_ROSTER_TYPES,
    BallRegistry,
    ballRegistry,
    registerBall(definition) {
      return ballRegistry.register(definition);
    }
  };
});
