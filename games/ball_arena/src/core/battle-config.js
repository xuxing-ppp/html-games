(function initializeBattleConfig(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("./arena-geometry.js") : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBattleConfigApi(dependencies) {
  "use strict";
  const { normalizeArenaDescriptor, createArenaGeometry } = dependencies;

  const MODE_RULES = Object.freeze({
    "1v1": Object.freeze({
      arenaSize: 200,
      teamSizes: Object.freeze([1, 1])
    }),
    bounce: Object.freeze({
      arenaSize: 240,
      teamSizes: Object.freeze([1, 1])
    }),
    gyro: Object.freeze({
      arenaSize: 240,
      teamSizes: Object.freeze([1, 1])
    }),
    // NVN 吸收了原 1V1：人数由场地实际容量约束。内核的 "1v1" 规则
    // 仍然保留给引擎默认建局、录制与脚本使用，只是选择页不再单独暴露入口。
    nvn: Object.freeze({
      arenaSize: 200,
      teamSizes: Object.freeze([null, null]),
      teamSizeLimits: Object.freeze([
        Object.freeze({ min: 1, max: Infinity }),
        Object.freeze({ min: 1, max: Infinity })
      ])
    }),
    boss: Object.freeze({
      arenaSize: 300,
      teamSizes: Object.freeze([1, null]),
      teamSizeLimits: Object.freeze([
        null,
        Object.freeze({ min: 1, max: 6 })
      ])
    }),
    totalwar: Object.freeze({
      arenaSize: 300,
      teamSizes: Object.freeze([1, null]),
      teamSizeLimits: Object.freeze([
        null,
        Object.freeze({ min: 1, max: 6 })
      ])
    }),
    zombie: Object.freeze({
      arenaSize: 400,
      teamSizes: Object.freeze([1, 0])
    }),
    zombiehell: Object.freeze({
      arenaSize: 400,
      teamSizes: Object.freeze([1, 0])
    }),
    wheel: Object.freeze({
      arenaSize: 200,
      teamSizes: Object.freeze([null, null]),
      teamSizeLimits: Object.freeze([
        Object.freeze({ min: 1, max: 6 }),
        Object.freeze({ min: 1, max: 6 })
      ]),
      sequential: true,
      preserveHpOnAdvance: true
    }),
    brawl: Object.freeze({
      arenaSize: 200,
      teamSizes: Object.freeze([null, 0]),
      teamSizeLimits: Object.freeze([
        Object.freeze({ min: 1, max: 25 }),
        Object.freeze({ min: 0, max: 0 })
      ]),
      freeForAll: true,
      maxBalls: 25
    }),
    coop: Object.freeze({
      arenaSize: 200,
      teamSizes: Object.freeze([null, null]),
      teamSizeLimits: Object.freeze([
        Object.freeze({ min: 1, max: 6 }),
        Object.freeze({ min: 1, max: 6 })
      ]),
      sequential: true,
      preserveHpOnAdvance: true,
      playerCanSwitch: true,
      enemyRosterModes: Object.freeze(["random", "custom"])
    })
  });

  const VARIABLE_TEAM_MODES = new Set(["wheel", "brawl", "coop"]);
  // Bounce and gyro are alternate physics presentations for ordinary 200×200
  // arenas. Derive eligibility from the canonical mode size so a future 200-unit
  // mode automatically gets the same toggles without another UI-specific list.
  const BOUNCE_ARENA_SIZE = 240;
  // Gyro mode reuses the same board size as bounce; both are 240×240 fields.
  const GYRO_ARENA_SIZE = 240;
  // The three positions of the arena-physics slider: plain straight-line
  // physics, downward gravity, and centre-of-arena gravity.
  const ARENA_PHYSICS_OPTIONS = Object.freeze(["none", "bounce", "gyro"]);
  const BOSS_BATTLE_MODES = new Set(["boss", "totalwar"]);
  const BOSS_SPAWN_CLEARANCE = 2;
  // Allocation safety for serialized roster expansion, NOT a gameplay count
  // limit: estimate UTF-16 IDs plus modifier/object/reference overhead across
  // all teams before duplicating roster descriptions in memory.
  const MAX_CONFIG_EXPANSION_BYTES = 4 * 1024 * 1024;
  const EXPANDED_ROSTER_ENTRY_OVERHEAD_BYTES = 128;

  function isVariableMode(mode) {
    return VARIABLE_TEAM_MODES.has(mode);
  }

  function getTeamSizeLimit(mode, teamIndex) {
    const rule = MODE_RULES[mode];
    if (!rule || !Array.isArray(rule.teamSizeLimits)) return null;
    return rule.teamSizeLimits[mode === "nvn" ? 0 : teamIndex] || null;
  }

  function isSurvivalMode(mode) {
    return mode === "zombie" || mode === "zombiehell";
  }

  function isBossBattleMode(mode) {
    return BOSS_BATTLE_MODES.has(mode);
  }

  function isArenaPhysicsEligibleMode(mode) {
    const rule = MODE_RULES[mode];
    return Boolean(rule && rule.arenaSize === 200);
  }

  function isBounceEligibleMode(mode) {
    return mode !== "bounce" && isArenaPhysicsEligibleMode(mode);
  }

  function isBounceConfig(config) {
    return Boolean(config && (
      config.mode === "bounce" ||
      (config.modeOptions && config.modeOptions.bounce === true)
    ));
  }

  function isGyroEligibleMode(mode) {
    return mode !== "gyro" && isArenaPhysicsEligibleMode(mode);
  }

  function isGyroConfig(config) {
    return Boolean(config && (
      config.mode === "gyro" ||
      (config.modeOptions && config.modeOptions.gyro === true)
    ));
  }

  function getBattleSlotRosterType(mode, teamIndex) {
    if (!MODE_RULES[mode]) throw new Error(`Unknown battle mode: ${mode}`);
    if (!Number.isInteger(teamIndex) || teamIndex < 0 || (mode !== "nvn" && teamIndex > 1)) {
      throw new RangeError(mode === "nvn" ? "NVN team index must be a non-negative integer" : "Battle team index must be zero or one");
    }
    return mode === "totalwar" && teamIndex === 0 ? "boss" : "normal";
  }

  // 普通槽位接受杂鱼、普通球、精英球和规格外球；各档位仍保留独立的池与筛选语义。
  // Boss 槽位仍然只认 Boss 球。
  const ORDINARY_ROSTER_TYPES = Object.freeze(["normal", "zako", "elite", "outOfSpec"]);

  function isOrdinaryRosterType(rosterType) {
    return ORDINARY_ROSTER_TYPES.includes(rosterType || "normal");
  }

  function rosterTypeFitsSlot(rosterType, slotRosterType) {
    const actual = rosterType || "normal";
    if (slotRosterType === "boss") return actual === "boss";
    return isOrdinaryRosterType(actual);
  }

  function createModeBattleConfig(mode, leftIds, rightIds, options = {}) {
    const rule = MODE_RULES[mode];
    if (!rule) throw new Error(`Unknown battle mode: ${mode}`);
    if (!Array.isArray(leftIds) || !Array.isArray(rightIds)) {
      throw new TypeError("Battle team selections must be arrays");
    }
    if (!options || typeof options !== "object") options = {};

    const leftRole = mode === "coop"
      ? "player"
      : mode === "brawl" ? "brawl" : "team";
    const rightRole = mode === "coop"
      ? "enemy"
      : mode === "brawl" ? "brawl" : "team";
    const config = {
      mode,
      arenaSize: rule.arenaSize,
      bossTeamId: isBossBattleMode(mode) ? "left" : null,
      teams: [
        {
          id: "left",
          role: isBossBattleMode(mode) ? "boss" : (isSurvivalMode(mode) ? "survivor" : leftRole),
          ...createTeamSelection(mode, leftIds)
        },
        {
          id: "right",
          role: isBossBattleMode(mode) ? "challengers" : (isSurvivalMode(mode) ? "horde" : rightRole),
          ...createTeamSelection(mode, rightIds)
        }
      ]
    };

    if (mode === "wheel") {
      config.modeOptions = {
        sequential: true,
        preserveHpOnAdvance: true
      };
    } else if (mode === "brawl") {
      config.modeOptions = {
        freeForAll: true,
        maxBalls: 25
      };
    } else if (mode === "coop") {
      const enemyRosterMode = options.enemyRosterMode || options.enemyMode ||
        options.enemyTeamMode || "custom";
      if (!rule.enemyRosterModes.includes(enemyRosterMode)) {
        throw new Error(`Unknown cooperative enemy roster mode: ${enemyRosterMode}`);
      }
      const requestedEnemyCount = (options.enemyTeamSize === undefined || options.enemyTeamSize === null) &&
        (options.enemyCount === undefined || options.enemyCount === null)
        ? (enemyRosterMode === "random" ? 1 : rightIds.length)
        : ((options.enemyTeamSize === undefined || options.enemyTeamSize === null)
          ? options.enemyCount
          : options.enemyTeamSize);
      const enemyTeamSize = Number.isInteger(requestedEnemyCount)
        ? requestedEnemyCount
        : 1;
      config.modeOptions = {
        enemyRosterMode,
        enemyTeamSize,
        playerCanSwitch: true,
        sequential: true,
        preserveHpOnAdvance: true
      };
    }

    if (options.bounce === true) {
      if (!isBounceEligibleMode(mode)) {
        throw new Error(`${mode} does not support bounce arena physics`);
      }
      config.arenaSize = BOUNCE_ARENA_SIZE;
      config.modeOptions = {
        ...(config.modeOptions || {}),
        bounce: true
      };
    }

    if (options.gyro === true) {
      if (options.bounce === true) {
        throw new Error("Bounce and gyro arena physics cannot be combined");
      }
      if (!isGyroEligibleMode(mode)) {
        throw new Error(`${mode} does not support gyro arena physics`);
      }
      config.arenaSize = GYRO_ARENA_SIZE;
      config.modeOptions = {
        ...(config.modeOptions || {}),
        gyro: true
      };
    }

    if (options.arena !== undefined) {
      if (mode !== "nvn") throw new Error("Custom arenas are only supported in NVN mode");
      config.arena = normalizeArenaDescriptor(options.arena, config.arenaSize);
      config.arenaSize = Math.max(config.arena.width, config.arena.height);
    }
    if (options.spawnLayout !== undefined) {
      if (mode !== "nvn") throw new Error("Custom spawn layouts are only supported in NVN mode");
      validateSpawnLayout(options.spawnLayout);
      config.spawnLayout = options.spawnLayout;
    }
    return config;
  }

  // Arbitrary teams share the same roster, arena and physics contract as NVN's
  // legacy left/right factory. Team IDs survive normalization and recording.
  function createNvnBattleConfig(teams, options = {}) {
    if (!Array.isArray(teams) || teams.length < 2) throw new Error("NVN requires at least two teams");
    const config = createModeBattleConfig("nvn", [], [], options);
    config.teams = teams.map((team) => {
      if (!team || (team.entries !== undefined && team.ballTypeIds !== undefined)) {
        throw new TypeError("Teams require either entries or ballTypeIds");
      }
      const selections = team.entries === undefined ? team.ballTypeIds : team.entries;
      if (!Array.isArray(selections)) throw new TypeError("Teams require entries or ballTypeIds arrays");
      return { id: team.id, role: "team", ...createTeamSelection("nvn", selections),
        ...(team.ballModifiers !== undefined ? { ballModifiers: team.ballModifiers.map(value => ({ ...value })) } : {}) };
    });
    return config;
  }

  function normalizeEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("Roster entries must be objects");
    }
    const { typeId, count = 1, hpMultiplier = 1, attackMultiplier = 1 } = entry;
    if (typeof typeId !== "string" || !typeId.length) throw new TypeError("Ball type IDs must be non-empty strings");
    if (!Number.isSafeInteger(count) || count < 1) throw new RangeError("Roster count must be a positive safe integer");
    if (!Number.isFinite(hpMultiplier) || hpMultiplier <= 0) throw new RangeError("HP multiplier must be finite and positive");
    if (!Number.isFinite(attackMultiplier) || attackMultiplier < 0) throw new RangeError("Attack multiplier must be finite and non-negative");
    return { typeId, count, hpMultiplier, attackMultiplier };
  }

  function createTeamSelection(mode, selections) {
    if (selections.some((entry) => typeof entry !== "string")) {
      if (mode !== "nvn") throw new Error("Compact roster entries are only supported in NVN mode");
      return { entries: selections.map((entry) => normalizeEntry(typeof entry === "string" ? { typeId: entry } : entry)) };
    }
    return { ballTypeIds: selections.slice() };
  }

  function validateSpawnLayout(layout) {
    if (layout !== "split" && layout !== "surround") throw new Error("Spawn layout must be split or surround");
  }

  function validateScaledStats(definition, modifier) {
    const maxHp = definition.stats == null ? undefined : definition.stats.maxHp;
    if (maxHp !== undefined && (!Number.isFinite(maxHp * modifier.hpMultiplier) || maxHp * modifier.hpMultiplier <= 0)) {
      throw new RangeError(`HP multiplier for ${definition.id} produces invalid maximum HP`);
    }
    const baseDamageScale = Number.isFinite(definition.damageOutputScale) ? definition.damageOutputScale : 1;
    if (!Number.isFinite(baseDamageScale * modifier.attackMultiplier) || baseDamageScale * modifier.attackMultiplier < 0) {
      throw new RangeError(`Attack multiplier for ${definition.id} produces invalid damage output scale`);
    }
  }

  function validateExpansionBudget(teams) {
    let estimatedBytes = 0;
    for (const team of teams) {
      const compact = team && team.entries !== undefined;
      const selections = compact ? team.entries : team && team.ballTypeIds;
      if (!Array.isArray(selections)) continue; // The normal shape validator supplies its specific error.
      for (const selection of selections) {
        const entry = compact ? normalizeEntry(selection) : { typeId: selection, count: 1 };
        if (typeof entry.typeId !== "string") throw new TypeError("Ball type IDs must be non-empty strings");
        estimatedBytes += entry.count * (EXPANDED_ROSTER_ENTRY_OVERHEAD_BYTES + entry.typeId.length * 2);
        if (!Number.isFinite(estimatedBytes) || estimatedBytes > MAX_CONFIG_EXPANSION_BYTES) {
          throw new RangeError("Battle configuration exceeds safe expansion budget; reduce quantity");
        }
      }
    }
  }

  function validateTeamSize(mode, teamIndex, count) {
    const rule = MODE_RULES[mode];
    const expected = rule.teamSizes[teamIndex];
    const limit = getTeamSizeLimit(mode, teamIndex);
    if (limit) {
      if (count < limit.min || count > limit.max) {
        if (isBossBattleMode(mode) && teamIndex === 1) {
          throw new Error(`${mode === "totalwar" ? "Total War" : "Boss"} mode requires one to six challengers`);
        }
        if (limit.max === Infinity) throw new Error(`${mode} team ${teamIndex + 1} requires at least ${limit.min} ball`);
        throw new Error(
          `${mode} team ${teamIndex + 1} requires ${limit.min} to ${limit.max} balls`
        );
      }
      return;
    }
    if (count !== expected) {
      throw new Error(`${mode} team ${teamIndex + 1} requires exactly ${expected} balls`);
    }
  }

  function normalizeBattleConfig(config, registry) {
    if (!config || typeof config !== "object") {
      throw new TypeError("Battle configuration must be an object");
    }
    const rule = MODE_RULES[config.mode];
    if (!rule) throw new Error(`Unknown battle mode: ${config.mode}`);
    const bounceEnabled = isBounceConfig(config);
    const gyroEnabled = isGyroConfig(config);
    if (bounceEnabled && gyroEnabled) {
      throw new Error("Bounce and gyro arena physics cannot be combined");
    }
    if (bounceEnabled && config.mode !== "bounce" && !isBounceEligibleMode(config.mode)) {
      throw new Error(`${config.mode} does not support bounce arena physics`);
    }
    if (gyroEnabled && config.mode !== "gyro" && !isGyroEligibleMode(config.mode)) {
      throw new Error(`${config.mode} does not support gyro arena physics`);
    }
    const expectedArenaSize = bounceEnabled
      ? BOUNCE_ARENA_SIZE
      : gyroEnabled ? GYRO_ARENA_SIZE : rule.arenaSize;
    const arena = config.arena === undefined ? null
      : normalizeArenaDescriptor(config.arena, expectedArenaSize);
    if (arena && config.mode !== "nvn") throw new Error("Custom arenas are only supported in NVN mode");
    const arenaSize = arena ? Math.max(arena.width, arena.height) : expectedArenaSize;
    if (config.arenaSize !== arenaSize) {
      throw new Error(`${config.mode} requires a ${expectedArenaSize} arena`);
    }
    if (!Array.isArray(config.teams) || (config.mode === "nvn" ? config.teams.length < 2 : config.teams.length !== 2)) {
      throw new Error(config.mode === "nvn" ? "NVN requires at least two teams" : "Battle configuration requires exactly two teams");
    }
    if (!registry || typeof registry.get !== "function") {
      throw new TypeError("Battle configuration requires a ball registry");
    }
    if (config.spawnLayout !== undefined) {
      if (config.mode !== "nvn") throw new Error("Custom spawn layouts are only supported in NVN mode");
      validateSpawnLayout(config.spawnLayout);
      if (config.spawnLayout === "surround" && config.teams.length !== 2) {
        throw new Error("Surround layout requires exactly two teams");
      }
    }

    const ids = config.teams.map((team) => team && team.id);
    if (ids.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new Error("Every team requires an ID");
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error("Battle configuration requires unique team IDs");
    }

    if (isBossBattleMode(config.mode)) {
      if (config.bossTeamId !== config.teams[0].id || config.teams[0].role !== "boss") {
        throw new Error("Boss team must be the first team and match bossTeamId");
      }
      if (config.teams[1].role !== "challengers") {
        throw new Error("Boss mode requires a challenger team");
      }
    } else if (isSurvivalMode(config.mode)) {
      if (config.bossTeamId !== null || config.teams[0].role !== "survivor" ||
          config.teams[1].role !== "horde") {
        throw new Error(`${config.mode} requires a survivor team and a horde team`);
      }
    } else if (config.bossTeamId !== null) {
      throw new Error("Ordinary modes cannot define a Boss team");
    }

    const modeOptions = config.modeOptions && typeof config.modeOptions === "object"
      ? config.modeOptions
      : null;
    if (config.mode === "wheel") {
      if (config.teams.some((team) => team.role !== "team")) {
        throw new Error("Wheel mode requires two team roles");
      }
    } else if (config.mode === "brawl") {
      if (config.teams[0].role !== "brawl" || config.teams[1].role !== "brawl") {
        throw new Error("Brawl mode requires brawl teams");
      }
    } else if (config.mode === "coop") {
      if (config.teams[0].role !== "player" || config.teams[1].role !== "enemy") {
        throw new Error("Cooperative mode requires player and enemy teams");
      }
      if (!modeOptions) {
        throw new Error("Cooperative mode requires enemy roster options");
      }
      if (!MODE_RULES.coop.enemyRosterModes.includes(modeOptions.enemyRosterMode)) {
        throw new Error(`Unknown cooperative enemy roster mode: ${modeOptions.enemyRosterMode}`);
      }
      if (!Number.isInteger(modeOptions.enemyTeamSize) ||
          modeOptions.enemyTeamSize < 1 || modeOptions.enemyTeamSize > 6) {
        throw new Error("Cooperative enemy team size must be one to six");
      }
      if (modeOptions.playerCanSwitch !== true) {
        throw new Error("Cooperative mode requires a switchable player roster");
      }
      const configuredEnemyCount = config.teams[1] && Array.isArray(config.teams[1].ballTypeIds)
        ? config.teams[1].ballTypeIds.length
        : -1;
      if (modeOptions.enemyRosterMode === "random" && configuredEnemyCount !== 0) {
        throw new Error("Random cooperative enemy rosters must not contain fixed IDs");
      }
      if (modeOptions.enemyRosterMode === "custom" &&
          configuredEnemyCount !== modeOptions.enemyTeamSize) {
        throw new Error("Custom cooperative enemy roster size must match its IDs");
      }
    }

    if (config.mode === "nvn") validateExpansionBudget(config.teams);
    const teams = config.teams.map((team, teamIndex) => {
      const compact = team && team.entries !== undefined;
      let modifiers = team && team.ballModifiers;
      if (compact) {
        if (config.mode !== "nvn" || !Array.isArray(team.entries) || team.ballTypeIds !== undefined) {
          throw new TypeError("Compact NVN teams require entries without ballTypeIds");
        }
        const entries = team.entries.map(normalizeEntry);
        const geometry = createArenaGeometry(arena || arenaSize);
        let count = 0;
        let diskArea = 0;
        for (const entry of entries) {
          const definition = registry.get(entry.typeId);
          validateScaledStats(definition, entry);
          const radius = definition.stats == null ? undefined : definition.stats.radius;
          if (!Number.isFinite(radius) || radius <= 0) throw new Error("Compact roster entries require valid ball radii");
          const availableWidth = geometry.width * (config.teams.length > 2 || config.spawnLayout === "surround" ? 1 : 0.5);
          if (radius * 2 > availableWidth || radius * 2 > geometry.height) {
            throw new Error(`NVN team ${teamIndex + 1} cannot fit in the arena: a ball diameter exceeds the available width or height`);
          }
          count += entry.count;
          diskArea += Math.PI * radius * radius * entry.count;
        }
        const availableArea = geometry.area * (config.teams.length > 2 || config.spawnLayout === "surround" ? 1 : 0.5);
        if (!Number.isSafeInteger(count) || count > 4294967295 || diskArea > availableArea) {
          throw new Error(`NVN team ${teamIndex + 1} cannot fit in the arena: required ball area exceeds available space`);
        }
        const ballTypeIds = [];
        modifiers = [];
        for (const entry of entries) {
          for (let index = 0; index < entry.count; index += 1) {
            ballTypeIds.push(entry.typeId);
            modifiers.push({ hpMultiplier: entry.hpMultiplier, attackMultiplier: entry.attackMultiplier });
          }
        }
        team = { ...team, ballTypeIds };
      }
      if (!team || !Array.isArray(team.ballTypeIds)) {
        throw new TypeError("Every team requires a ballTypeIds array");
      }
      const isRandomCoopEnemy = config.mode === "coop" && teamIndex === 1 &&
        modeOptions && modeOptions.enemyRosterMode === "random";
      if (!(isRandomCoopEnemy && team.ballTypeIds.length === 0)) {
        validateTeamSize(config.mode, teamIndex, team.ballTypeIds.length);
      }
      const ballTypeIds = team.ballTypeIds.map((typeId) => {
        if (typeof typeId !== "string" || typeId.length === 0) {
          throw new TypeError("Ball type IDs must be non-empty strings");
        }
        const definition = registry.get(typeId);
        const actualRosterType = definition.rosterType || "normal";
        const requiredRosterType = getBattleSlotRosterType(config.mode, teamIndex);
        if (!rosterTypeFitsSlot(actualRosterType, requiredRosterType)) {
          if (requiredRosterType === "boss") {
            throw new Error("Total War Boss team requires Boss roster balls");
          }
          if (actualRosterType === "boss") {
            throw new Error("Boss roster balls are only allowed on the Total War Boss team");
          }
          throw new Error(`Unsupported ball roster type: ${actualRosterType}`);
        }
        return typeId;
      });
      const normalizedTeam = {
        id: team.id,
        role: team.role,
        ballTypeIds: Object.freeze(ballTypeIds)
      };
      if (modifiers !== undefined) {
        if (config.mode !== "nvn" || !Array.isArray(modifiers) || modifiers.length !== ballTypeIds.length) {
          throw new Error("Ball modifiers must align with NVN ballTypeIds");
        }
        normalizedTeam.ballModifiers = Object.freeze(modifiers.map((modifier, index) => {
          const entry = normalizeEntry({ ...modifier, typeId: ballTypeIds[index], count: 1 });
          validateScaledStats(registry.get(entry.typeId), entry);
          return Object.freeze({ hpMultiplier: entry.hpMultiplier, attackMultiplier: entry.attackMultiplier });
        }));
      }
      return Object.freeze(normalizedTeam);
    });

    const normalized = {
      mode: config.mode,
      arenaSize,
      bossTeamId: isBossBattleMode(config.mode) ? config.bossTeamId : null,
      teams: Object.freeze(teams)
    };
    if (arena) normalized.arena = Object.freeze(arena);
    if (config.spawnLayout !== undefined) normalized.spawnLayout = config.spawnLayout;
    if (config.mode === "nvn") {
      if (teams.some(team => team.role !== "team")) throw new Error("NVN requires team roles");
      const radii = teams.map((team) => team.ballTypeIds.map((id) => {
        const stats = registry.get(id).stats;
        return stats == null ? undefined : stats.radius;
      }));
      if (radii.every((team) => team.every((radius) => Number.isFinite(radius) && radius > 0))) {
        spawnPointsForBattle(normalized, radii);
      }
    }
    if (isVariableMode(config.mode) ||
        (bounceEnabled && config.mode !== "bounce") ||
        (gyroEnabled && config.mode !== "gyro")) {
      normalized.modeOptions = Object.freeze({ ...modeOptions });
    }
    return Object.freeze(normalized);
  }

  function stableCoordinate(value) {
    const rounded = Math.round(value);
    return Math.abs(value - rounded) <= 1e-12 ? rounded : value;
  }

  function clampCoordinate(value, radius, arenaSize) {
    return Math.max(radius, Math.min(arenaSize - radius, value));
  }

  function spawnPointsForBattle(config, teamRadii) {
    if (config.mode !== "nvn") {
      return teamRadii.map((radii, teamIndex) => spawnPointsForTeam(config, teamIndex, radii, teamRadii[1 - teamIndex]));
    }
    const geometry = createArenaGeometry(config.arena || config.arenaSize);
    const descriptor = config.arena || { shape: "square", width: config.arenaSize, height: config.arenaSize };
    const left = (geometry.size - descriptor.width) / 2;
    const top = (geometry.size - descriptor.height) / 2;
    const center = geometry.size / 2;
    const right = left + descriptor.width;
    const bottom = top + descriptor.height;
    for (const radii of teamRadii) {
      if (!Array.isArray(radii) || radii.some((radius) => !Number.isFinite(radius) || radius <= 0)) {
        throw new RangeError("Spawn radii must be finite and positive");
      }
    }
    const separated = (point, radius, placed) => placed.every((other) =>
      Math.hypot(point.x - other.x, point.y - other.y) + 1e-9 >= radius + other.radius);
    const fits = (point, radius, minX, maxX, placed) =>
      point.x - radius >= minX - 1e-9 && point.x + radius <= maxX + 1e-9 &&
      geometry.contains(point.x, point.y, radius) && separated(point, radius, placed);

    function balancedPositions(radii, minX, maxX) {
      if (!radii.length) return [];
      const maxRadius = radii.reduce((maximum, radius) => Math.max(maximum, radius), 0) + 1;
      const suggestedColumns = Math.max(1, Math.round(Math.sqrt(radii.length * (maxX - minX) / descriptor.height)));
      const columnCandidates = new Set([suggestedColumns]);
      for (let offset = 1; offset <= 3; offset += 1) {
        columnCandidates.add(Math.max(1, suggestedColumns - offset));
        columnCandidates.add(Math.min(radii.length, suggestedColumns + offset));
      }
      for (const columns of columnCandidates) {
        const rows = Math.ceil(radii.length / columns);
        const points = [];
        let remaining = radii.length;
        for (let row = 0; row < rows; row += 1) {
          const rowCount = Math.ceil(remaining / (rows - row));
          const y = top + descriptor.height * (row + 0.5) / rows;
          let rowLeft = minX + maxRadius;
          let rowRight = maxX - maxRadius;
          if (descriptor.shape === "circle") {
            const chordSquared = (descriptor.width / 2 - maxRadius) ** 2 - (y - center) ** 2;
            if (chordSquared < 0) break;
            const halfChord = Math.sqrt(chordSquared);
            rowLeft = Math.max(rowLeft, center - halfChord);
            rowRight = Math.min(rowRight, center + halfChord);
          }
          if (rowRight < rowLeft) break;
          for (let column = 0; column < rowCount; column += 1) {
            points.push({
              x: stableCoordinate(rowCount === 1 ? (rowLeft + rowRight) / 2
                : rowLeft + (rowRight - rowLeft) * column / (rowCount - 1)),
              y: stableCoordinate(y)
            });
          }
          remaining -= rowCount;
        }
        const placed = [];
        if (points.length === radii.length && points.every((point, index) => {
          const radius = radii[index] + 1;
          if (!fits(point, radius, minX, maxX, placed)) return false;
          placed.push({ ...point, radius });
          return true;
        })) return points;
      }
      return null;
    }

    function pack(radii, minX, maxX, obstacles = [], preferred = null) {
      if (radii.some(radius => radius * 2 > maxX - minX + 1e-9 || radius * 2 > bottom - top + 1e-9)) {
        throw new Error("NVN balls cannot fit in the arena: a ball diameter exceeds the available width or height");
      }
      const placed = obstacles.slice();
      if (preferred && preferred.every((point, index) => {
        if (!fits(point, radii[index], minX, maxX, placed)) return false;
        placed.push({ ...point, radius: radii[index] });
        return true;
      })) return preferred;
      placed.length = 0;
      placed.push(...obstacles);
      const result = new Array(radii.length);
      const sorted = radii.map((radius, index) => ({ radius, index })).sort((a, b) => b.radius - a.radius || a.index - b.index);
      let rowTop = top;
      let rowHeight = 0;
      let cursorX = minX;
      for (const { radius, index } of sorted) {
        let point = null;
        // Every retry must advance to a row or past a known obstacle, never scan
        // a number of empty rows proportional to a numeric arena dimension.
        let rowAttempts = 0;
        while (!point && rowTop + radius * 2 <= bottom + 1e-9 && rowAttempts++ <= placed.length + 2) {
          if (!rowHeight) rowHeight = radius * 2;
          if (cursorX === minX && descriptor.shape === "circle") {
            const closestX = Math.max(minX + radius, Math.min(maxX - radius, center));
            const availableRadius = descriptor.width / 2 - radius;
            const heightSquared = availableRadius ** 2 - (closestX - center) ** 2;
            if (heightSquared < 0) break;
            rowTop = Math.max(rowTop, center - Math.sqrt(heightSquared) - rowHeight / 2);
          }
          const y = rowTop + rowHeight / 2;
          let x = cursorX + radius;
          if (descriptor.shape === "circle") {
            const availableRadius = descriptor.width / 2 - radius;
            const halfChord = Math.sqrt(Math.max(0, availableRadius * availableRadius - (y - center) ** 2));
            x = Math.max(x, center - halfChord);
          }
          while (x + radius <= maxX + 1e-9) {
            const candidate = { x: stableCoordinate(x), y: stableCoordinate(y) };
            if (fits(candidate, radius, minX, maxX, placed)) {
              point = candidate;
              break;
            }
            // Jump beyond the circles blocking this row instead of sampling a pixel grid.
            let nextX = x;
            for (const other of placed) {
              const reach = radius + other.radius;
              const dy = Math.abs(y - other.y);
              if (dy < reach && Math.abs(x - other.x) < reach) {
                nextX = Math.max(nextX, other.x + Math.sqrt(reach * reach - dy * dy));
              }
            }
            if (nextX <= x + 1e-9) break;
            x = nextX;
          }
          if (!point) {
            if (cursorX > minX) {
              rowTop += rowHeight;
            } else {
              let nextRowY = Infinity;
              for (const other of placed) {
                const belowObstacleY = other.y + other.radius + radius;
                if (belowObstacleY > y + 1e-9) nextRowY = Math.min(nextRowY, belowObstacleY);
              }
              if (!Number.isFinite(nextRowY)) break;
              rowTop = nextRowY - radius;
            }
            rowHeight = 0;
            cursorX = minX;
          }
        }
        if (!point) throw new Error("NVN balls cannot fit in the arena without overlapping; enlarge the arena or reduce the roster");
        result[index] = point;
        placed.push({ ...point, radius });
        cursorX = point.x + radius;
      }
      return result;
    }

    if (teamRadii.length > 2) {
      if (config.spawnLayout === "surround") throw new Error("Surround layout requires exactly two teams");
      const flatRadii = teamRadii.flat();
      const maxRadius = flatRadii.reduce((maximum, radius) => Math.max(maximum, radius), 0);
      // Equal-radius seats allow spatial reassignment without introducing overlap.
      // Fall back to heterogeneous packing when large/small bodies need tighter fit.
      let seats = balancedPositions(flatRadii.map(() => maxRadius), left, right);
      if (!seats) {
        const packed = pack(flatRadii, left, right);
        let offset = 0;
        return teamRadii.map(radii => { const points = packed.slice(offset, offset + radii.length); offset += radii.length; return points; });
      }
      return teamRadii.map((radii, teamIndex) => {
        const angle = Math.PI + teamIndex * Math.PI * 2 / teamRadii.length;
        const anchorX = center + Math.cos(angle) * descriptor.width * 0.32;
        const anchorY = center + Math.sin(angle) * descriptor.height * 0.32;
        seats.sort((a, b) => Math.hypot(a.x - anchorX, a.y - anchorY) - Math.hypot(b.x - anchorX, b.y - anchorY) || a.y - b.y || a.x - b.x);
        return seats.splice(0, radii.length);
      });
    }

    if (config.spawnLayout === "surround") {
      if (teamRadii[0].length !== 1) throw new Error("Surround layout requires exactly one ball on the left team");
      const bossRadius = teamRadii[0][0];
      const boss = { x: center, y: center };
      if (!geometry.contains(center, center, bossRadius)) throw new Error("Center ball cannot fit in the arena");
      const radii = teamRadii[1];
      const maxRadius = radii.reduce((maximum, radius) => Math.max(maximum, radius), 0);
      const ringRadius = Math.max(bossRadius + maxRadius + BOSS_SPAWN_CLEARANCE, Math.min(100, descriptor.width / 2 - maxRadius));
      const preferred = radii.map((radius, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radii.length;
        return { x: stableCoordinate(center + Math.cos(angle) * ringRadius), y: stableCoordinate(center + Math.sin(angle) * ringRadius) };
      });
      return [[boss], pack(radii, left, right, [{ ...boss, radius: bossRadius }], preferred)];
    }
    return teamRadii.map((radii, teamIndex) => {
      const minX = teamIndex === 0 ? left : center;
      const maxX = teamIndex === 0 ? center : right;
      const legacyPreferred = radii.map((radius, index) => ({
        x: stableCoordinate((minX + maxX) / 2),
        y: stableCoordinate(top + descriptor.height * (index + 1) / (radii.length + 1))
      }));
      const preferred = config.arena ? balancedPositions(radii, minX, maxX) : legacyPreferred;
      return pack(radii, minX, maxX, [], preferred);
    });
  }

  function spawnPointsForTeam(config, teamIndex, radii, opposingRadii = []) {
    if (!Array.isArray(radii) || radii.length === 0) return [];
    if (config.mode === "nvn") {
      if (config.teams && config.teams.length > 2) throw new Error("Multi-team NVN spawning requires spawnPointsForBattle with all team radii");
      return spawnPointsForBattle(config, teamIndex === 0 ? [radii, opposingRadii] : [opposingRadii, radii])[teamIndex];
    }
    const arenaSize = config.arenaSize;

    if (isBossBattleMode(config.mode)) {
      const center = arenaSize / 2;
      if (teamIndex === 0) {
        if (Math.max(...radii) > center) {
          throw new Error("Boss radius does not fit in the arena");
        }
        return [{ x: center, y: center }];
      }
      const challengerRadius = Math.max(...radii);
      const bossRadius = opposingRadii.length > 0 ? Math.max(...opposingRadii) : 0;
      const minimumRingRadius = bossRadius + challengerRadius + BOSS_SPAWN_CLEARANCE;
      const maximumRingRadius = center - challengerRadius;
      if (minimumRingRadius > maximumRingRadius) {
        throw new Error("Boss and challengers do not fit in the arena");
      }
      const ringRadius = Math.min(
        maximumRingRadius,
        Math.max(100, minimumRingRadius)
      );
      return radii.map((radius, index) => {
        const angle = -Math.PI / 2 + index * Math.PI * 2 / radii.length;
        return {
          x: stableCoordinate(clampCoordinate(center + Math.cos(angle) * ringRadius, radius, arenaSize)),
          y: stableCoordinate(clampCoordinate(center + Math.sin(angle) * ringRadius, radius, arenaSize))
        };
      });
    }

    const x = arenaSize * (teamIndex === 0 ? 0.25 : 0.75);
    return radii.map((radius, index) => ({
      x: stableCoordinate(clampCoordinate(x, radius, arenaSize)),
      y: stableCoordinate(clampCoordinate(
        arenaSize * (index + 1) / (radii.length + 1),
        radius,
        arenaSize
      ))
    }));
  }

  function summarizeTeamTypes(balls) {
    const grouped = new Map();
    for (const ball of balls || []) {
      if (!ball) continue;
      const key = JSON.stringify([ball.id, ball.name]);
      const entry = grouped.get(key);
      if (entry) {
        entry.count += 1;
      } else {
        grouped.set(key, { name: ball.name, count: 1 });
      }
    }
    return Array.from(grouped.values(), ({ name, count }) => (
      count > 1 ? `${name}x${count}` : name
    )).join(" + ");
  }

  return {
    createNvnBattleConfig,
    MODE_RULES,
    MAX_CONFIG_EXPANSION_BYTES,
    BOUNCE_ARENA_SIZE,
    GYRO_ARENA_SIZE,
    ARENA_PHYSICS_OPTIONS,
    isArenaPhysicsEligibleMode,
    isBounceEligibleMode,
    isBounceConfig,
    isGyroEligibleMode,
    isGyroConfig,
    createModeBattleConfig,
    getBattleSlotRosterType,
    ORDINARY_ROSTER_TYPES,
    isOrdinaryRosterType,
    rosterTypeFitsSlot,
    normalizeBattleConfig,
    spawnPointsForBattle,
    spawnPointsForTeam,
    summarizeTeamTypes
  };
});
