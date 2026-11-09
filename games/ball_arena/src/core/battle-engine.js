(function initializeBattleEngine(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("./ball-registry.js"),
        ...require("./effects.js"),
        ...require("./knockback.js"),
        ...require("./battle-config.js"),
        ...require("./arena-geometry.js"),
        ...require("./combat-source.js"),
        ...require("./status-controller.js"),
        ...require("./speed-modifiers.js"),
        ...require("./damage-resolver.js"),
        ...require("./contact-model.js"),
        ...require("./entity-system.js"),
        ...require("./visual-effect-system.js"),
        ...require("./visual-composition.js"),
        ...require("./arena-shake.js"),
        ...require("./damage-flash.js"),
        ...require("./particle-burst.js"),
        ...require("./afterimage-trail.js"),
        ...require("./bounce-physics.js"),
        ...require("./gyro-physics.js"),
        ...require("./zombie-mode.js"),
        ...require("./zombie-hell-mode.js"),
        ...require("./competitive-mode.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBattleEngineApi(dependencies) {
  "use strict";

  const {
    ballRegistry,
    createEffectInstance,
    getKnockbackState,
    startKnockback,
    advanceKnockback,
    redirectKnockback,
    finishKnockback,
    createModeBattleConfig,
    isBounceConfig,
    isGyroConfig,
    normalizeBattleConfig,
    spawnPointsForTeam,
    spawnPointsForBattle,
    createArenaGeometry,
    COMBAT_KINDS,
    createCombatSource,
    StatusController,
    SpeedModifierSystem,
    DamageResolver,
    normalizeDamageSource,
    createContactEvent,
    firstSegmentCircleContact,
    EntitySystem,
    VisualEffectSystem,
    createVisualRandom,
    spawnVisualComposition,
    ArenaShakeController,
    createArenaShakeProfile,
    BallDamageFlashController,
    createParticleBurst,
    createAfterimageTrail,
    createBouncePhysics,
    createGyroPhysics,
    createZombieModeController,
    createZombieHellModeController,
    createCompetitiveModeController
  } = dependencies;

  const HIT_EFFECT_LIFE = 0.7;
  // Bounce-mode hits give the victim a tiny, fixed positional nudge. This is
  // deliberately separate from arena shake: it has no intensity tiers and
  // does not alter the attack's damage or movement speed.
  const DAMAGE_KNOCKBACK_DISTANCE = 1.5;
  const LOSER_FADE_DURATION = 1.1;
  const UPDATE_EPSILON = 1e-9;
  const WALL_CONTACT_RELEASE_DISTANCE = 0.5;
  const REPLAY_HISTORY_LIMIT = 3.25;
  const REPLAY_PRUNE_BATCH = 32;
  const MAX_SIMULATION_STEP_SECONDS = 1 / 60;
  // 有的球在计时器刚好到期时会返回 EPSILON 级别的转换边界（"转换就在此刻"）。
  // 1/60 的步长下这种边界没有意义，却会让 update() 的切步循环退化成上千万次
  // 微步——表现为画面卡死 + 内存爆炸。给切步加一个下限后，转换最多晚 1 毫秒落地。
  const MIN_TRANSITION_STEP_SECONDS = 0.001;
  const MAX_FRAME_CATCH_UP_SECONDS = 0.25;
  const DEFAULT_CONTACT_PROFILE = Object.freeze({ solid: true, attackable: true });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randomUnitVector() {
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function advanceSimulation(engine, elapsedSeconds) {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
    if (!engine || typeof engine.update !== "function") {
      throw new TypeError("Simulation advancement requires an engine update function");
    }

    const advancedSeconds = Math.min(elapsedSeconds, MAX_FRAME_CATCH_UP_SECONDS);
    let remaining = advancedSeconds;
    while (remaining > UPDATE_EPSILON) {
      const step = Math.min(remaining, MAX_SIMULATION_STEP_SECONDS);
      engine.update(step);
      remaining = Math.max(0, remaining - step);
    }
    return advancedSeconds;
  }

  // A status is worth an audible cue when it changes what its target can do
  // (movement lock, behavior pause, attack/damage suppression) — damage-over
  // -time refreshes stay silent and speak through their hit sounds instead.
  function isControlEffectDefinition(definition) {
    return Boolean(definition && (
      definition.visualType === "stun" ||
      definition.locksMovement === true ||
      definition.pausesBehavior === true ||
      definition.preventsAttack === true ||
      definition.blocksDamageOutput === true
    ));
  }

  function pruneReplayHistory(history, cutoff) {
    let removeCount = 0;
    while (
      removeCount + 1 < history.length &&
      history[removeCount + 1].time < cutoff
    ) {
      removeCount += 1;
    }
    if (removeCount >= REPLAY_PRUNE_BATCH) history.splice(0, removeCount);
  }

  class CombatSourceServices {
    constructor(engine, source) {
      this.engine = engine;
      this.source = source;
      Object.freeze(this);
    }

    dealDamage(target, amount, options = {}) {
      return this.engine.dealDamage(target, amount, this.source, options);
    }

    canExecuteTarget(target) {
      return this.engine.canExecuteTarget(this.source, target);
    }

    executeTarget(target) {
      return this.engine.damageResolver.execute(target, this.source);
    }

    applyEffect(target, definition) {
      return this.engine.applyEffect(target, definition, this.source);
    }

    clearEffect(target, id) {
      return this.engine.removeEffect(target, id);
    }

    transformCombatant(target, definitionId) {
      return this.engine.queueCombatantTransformation(target, definitionId, this.source);
    }

    getCapabilities(target) {
      return this.engine.getCapabilities(target);
    }

    isMovementLocked(target) {
      return Boolean(target && (target.positionLocked || this.engine.isPhysicsMovementLocked(target)));
    }

    isFieldPhysicsMode() {
      return this.engine.isFieldPhysicsMode();
    }

    spawnHitText(target, text, options = {}) {
      return this.engine.spawnHitText(target.x, target.y, text, options);
    }

    spawnVisualEffect(definition) {
      return this.engine.spawnVisualEffect(definition, this.source.credit);
    }

    spawnParticleBurst(options = {}) {
      return this.engine.spawnParticleBurst(options, this.source.credit);
    }

    createVisualEffect(factory, options = {}, overrides = {}) {
      return this.engine.createVisualEffect(factory, options, this.source.credit, overrides);
    }

    spawnVisualComposition(entries, overrides = {}) {
      return this.engine.spawnVisualComposition(entries, this.source.credit, overrides);
    }

    // 残影拖尾返回句柄本身（不只是视效副本）：调用方还要继续 push/emit。
    spawnAfterimageTrail(options = {}) {
      const trail = createAfterimageTrail(options);
      this.spawnVisualEffect(trail, this.source.credit);
      return trail;
    }

    spawnCombatEntity(definition, overrides = {}) {
      return this.engine.spawnCombatEntity(definition, this.source, overrides);
    }

    spawnProjectile(definition) {
      return this.engine.spawnProjectile(definition, this.source);
    }

    notifyEntityContact(target, entity, options = {}) {
      return this.engine.notifyEntityContact(target, entity, this.source, options);
    }

    tryConsumeEntity(target, entity, options = {}) {
      return this.engine.tryConsumeEntity(target, entity, this.source, options);
    }

    reportCombatInteraction(type, target) {
      return this.engine.reportCombatInteraction(type, target, this.source);
    }

    getOpponent() {
      return this.engine.getOpponent(this.source);
    }

    // 攻击触发概率光环系数：效果字段 triggerChanceScale 的乘积（默认1）。
    // 掷骰方用它乘在 Math.random() < P 的 P 上实现"触发概率减半"类被动。
    getTriggerChanceScale(target) {
      return this.engine.triggerChanceScale(target || this.source.actor);
    }

    getEnemies() {
      return this.engine.getLivingEnemies(this.source);
    }

    getAllies() {
      return this.engine.getLivingAllies(this.source);
    }

    forEachEnemy(callback) {
      return this.engine.forEachLivingEnemy(this.source, callback);
    }

    forEachContactEnemy(callback) {
      return this.engine.forEachLivingEnemy(this.source, callback,
        (target) => this.engine.canContact(this.source, target));
    }

    forEachAlly(callback) {
      return this.engine.forEachLivingAlly(this.source, callback);
    }

    getBall(instanceId) {
      return this.engine.getBall(instanceId);
    }

    isEnemy(target) {
      return this.engine.areEnemies(this.source, target);
    }

    getFirstEnemyHit(startX, startY, endX, endY, radius = 0) {
      return this.engine.getFirstEnemyHit(
        this.source, startX, startY, endX, endY, radius
      );
    }

    getContactProfile(target) {
      return this.engine.getContactProfile(target);
    }

    playBounce(intensity = 1) {
      // Combat entities have no ball.speed; the audio layer falls back to the
      // base pitch automatically.
      return this.engine.playBounce(this.source.actor, intensity);
    }

    playSound(type, detail = {}) {
      return this.engine.playSound(type, this.source.credit, detail);
    }

    shakeArena(options = {}) {
      return this.engine.shakeArena(options);
    }

    getTime() {
      return this.engine.game ? this.engine.game.time : 0;
    }
  }

  class BattleEngine {
    constructor({
      registry = ballRegistry,
      arenaSize = 200,
      randomDirection = randomUnitVector,
      random = Math.random,
      visualSeed,
      visualEffectProfiling = false,
      onBounce = () => {},
      onSound = () => {},
      onCombatInteraction = null
    } = {}) {
      if (onCombatInteraction !== null && typeof onCombatInteraction !== "function") {
        throw new TypeError("BattleEngine requires an optional onCombatInteraction callback");
      }
      this.onCombatInteraction = onCombatInteraction;
      this.registry = registry;
      this.arenaSize = arenaSize;
      this.arena = createArenaGeometry(arenaSize);
      this.legacyArenaSize = arenaSize;
      this.randomDirection = randomDirection;
      this.random = random;
      this.visualSeed = visualSeed;
      this.visualRandom = createVisualRandom(visualSeed);
      this.hiddenAudioStep = null;
      this.publishBounce = onBounce;
      this.publishSound = onSound;
      this.onBounce = (...args) => {
        if (this.hiddenAudioStep) this.hiddenAudioStep.push({ bounce: true, args });
        else onBounce(...args);
      };
      this.onSound = (event) => {
        if (this.hiddenAudioStep) this.hiddenAudioStep.push({ bounce: false, event });
        else onSound(event);
      };
      this.bouncePhysics = createBouncePhysics({ random });
      this.gyroPhysics = createGyroPhysics({ random });
      this.game = null;
      this.arenaShake = new ArenaShakeController({
        getTime: () => (this.game ? this.game.time : 0)
      });
      this.damageFlash = new BallDamageFlashController({
        getTime: () => (this.game ? this.game.time : 0)
      });
      this.isUpdatingGame = false;
      // 不受全局时间缩放影响的实时时钟（单调递增，跨局不清零）。需要"世界停住、
      // 但演出照常走"的能力（例如交换的换位动画）读它来推进自己的演出。
      this.clockTime = 0;
      this.timeStopActors = null;
      this.combatantTimeControls = null;
      this.sampledWorldTimeControl = null;
      this.behaviorBindings = new WeakMap();
      this.attackLeases = new WeakMap();
      this.pendingTransformations = new Map();
      this.pausedAtStepStart = new Set();
      this.prescribedMotionActors = new Set();
      this.behaviorDeltas = new Map();
      this.ballHookContexts = new WeakMap();
      this.entityContacts = new WeakMap();
      this.entityContactReports = new WeakMap();
      this.effectHookContexts = new WeakMap();
      this.visualEffectHookContexts = new WeakMap();
      this.combatEntityHookContexts = new WeakMap();
      this.contactProfileCache = new WeakMap();
      this.statusController = new StatusController({
        now: () => (this.game ? this.game.time : 0),
        getOverrides: (ball) => this.invokeHook(ball, "getCapabilityOverrides") || null
      });
      this.speedModifiers = new SpeedModifierSystem({
        now: () => (this.game ? this.game.time : 0),
        canBeSlowed: (ball) => (
          !ball || !(ball.effects instanceof Map) ||
          this.statusController.forCombatant(ball).canBeSlowed
        )
      });
      this.damageResolver = new DamageResolver({
        areEnemies: (left, right) => this.areEnemies(left, right),
        canTarget: (source, target) => this.canTarget(source, target),
        canExecuteTarget: (source, target) => this.canExecuteTarget(source, target),
        getCapabilities: (actor) => this.getCapabilities(actor),
        blocksOwnedEntityDamage: (owner) => this.ownerBlocksEntityDamage(owner),
        onDefense: onCombatInteraction ? (target, source) => (
          this.reportCombatInteraction("block", source.actor, target, source.teamId)
        ) : null,
        getContactProfile: (target) => this.getContactProfile(target),
        beforeDamage: (target, event) => (
          this.isAbilitySealed(target) ? null : this.invokeHook(
            target,
            "onBeforeDamage",
            {
              combatSource: event.combatSource,
              actor: event.actor,
              owner: event.owner,
              credit: event.credit,
              entity: event.entity,
              kind: event.kind,
              amount: event.amount,
              options: event.options
            },
            event
          )
        ),
        afterDamage: (target, event) => {
          this.playSound("hit", event.credit || event.owner || event.actor, {
            target,
            amount: event.amount,
            kind: event.kind
          });
          const shake = createArenaShakeProfile(
            event.amount,
            event.options && event.options.arenaShake
          );
          if (shake) this.shakeArena(shake);
          const flash = createArenaShakeProfile(
            event.amount,
            event.options && event.options.damageFlash
          );
          if (flash) this.damageFlash.trigger(target, flash);
          this.applyDamageKnockback(target, event);
          // Accounting hooks observe successful damage even under a hard seal.
          // Offensive/reactive onDamaged remains gated below.
          this.invokeHook(target, "onDamageObserved", null, event);
          if (this.isAbilitySealed(target) || this.isTimeFrozen(target)) return event;
          return this.invokeHook(
            target,
            "onDamaged",
            {
              combatSource: event.combatSource,
              actor: event.actor,
              owner: event.owner,
              credit: event.credit,
              entity: event.entity,
              kind: event.kind,
              amount: event.amount,
              options: event.options
            },
            event
          );
        },
        recordReplay: (source, target, amount) => {
          const origin = [source.actor, source.entity, source.owner, source.credit].find((candidate) => (
            candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
          )) || target;
          const distance = Math.hypot(target.x - origin.x, target.y - origin.y);
          this.recordReplayEvent(source.credit, {
            type: "strike",
            damage: amount,
            range: distance + target.radius,
            color: origin.color || source.credit.color
          });
        },
        spawnHitText: (x, y, text) => this.spawnHitText(x, y, text)
      });
      this.entitySystem = new EntitySystem({
        getTime: () => (this.game ? this.game.time : 0),
        getOwner: (instanceId) => this.getBall(instanceId),
        invokeUpdate: (entity, dt) => this.updateCombatEntity(entity, dt),
        getDelta: (entity, dt) => this.isTimeFrozen(entity) ? null : dt
      });
      this.visualEffectSystem = new VisualEffectSystem({
        getOwner: (instanceId) => this.getBall(instanceId),
        invokeUpdate: (effect, dt) => this.invokeVisualEffectHook(effect, "update", null, dt)
      });
      this.visualEffectSystem.setProfilingEnabled(visualEffectProfiling);
      const engine = this;
      this.pluginGameView = Object.freeze({
        get time() {
          return engine.game ? engine.game.time : 0;
        },
        get state() {
          return engine.game ? engine.game.state : "idle";
        },
        get arenaSize() {
          return engine.arenaSize;
        },
        get arena() {
          return engine.arena;
        },
        get combatEntities() {
          return engine.game ? engine.game.combatEntities : [];
        }
      });
    }

    // 确定性对局需要把引擎内部的随机源换成种子流（弹跳/陀螺物理与随机 roster 都吃它）。
    // 传入原来的函数即可还原。
    setRandom(random) {
      if (typeof random !== "function") {
        throw new TypeError("Engine random source must be a function");
      }
      this.random = random;
      this.bouncePhysics = createBouncePhysics({ random });
      this.gyroPhysics = createGyroPhysics({ random });
      return this;
    }

    setVisualSeed(seed) {
      this.visualRandom = createVisualRandom(seed);
      this.visualSeed = seed;
      return this;
    }

    createGame(typeOneId, typeTwoId) {
      return this.initializeBattle(createModeBattleConfig("1v1", [typeOneId], [typeTwoId]), this.legacyArenaSize);
    }

    createBattle(config) {
      return this.initializeBattle(config);
    }

    initializeBattle(config, legacyArenaSize) {
      // Validate geometry/capacity before disposing the currently loaded battle.
      const normalized = normalizeBattleConfig(config, this.registry);
      const nvnSpawns = normalized.mode === "nvn" ? spawnPointsForBattle(normalized,
        normalized.teams.map(team => team.ballTypeIds.map(id => this.registry.get(id).stats.radius))) : null;
      this.pendingTransformations.clear();
      if (this.game) {
        for (const ball of this.game.balls) this.invokeHook(ball, "onBattleDispose");
        for (const ball of this.game.balls) {
          const lease = this.attackLeases.get(ball);
          if (lease) lease.release();
        }
      }
      const previousModeController = this.activeModeController();
      if (previousModeController) previousModeController.dispose();
      this.entitySystem.reset();
      this.visualEffectSystem.reset();
      this.visualRandom = createVisualRandom(this.visualSeed);
      this.arenaShake.reset();
      this.damageFlash.reset();
      const teams = normalized.teams.map((teamConfig, teamIndex) => {
        let ballTypeIds = teamConfig.ballTypeIds;
        if (
          normalized.mode === "coop" &&
          teamIndex === 1 &&
          normalized.modeOptions &&
          normalized.modeOptions.enemyRosterMode === "random"
        ) {
          const definitions = this.listRosterDefinitions("normal");
          const count = normalized.modeOptions.enemyTeamSize;
          if (definitions.length === 0) throw new Error("Cannot draw a random enemy roster without balls");
          ballTypeIds = Array.from({ length: count }, () => (
            definitions[Math.floor(Math.random() * definitions.length)].id
          ));
        }
        const radii = ballTypeIds.map((typeId) => (
          this.registry.get(typeId).stats.radius
        ));
        const opposingRadii = normalized.teams[teamIndex === 0 ? 1 : 0].ballTypeIds
          .map((typeId) => this.registry.get(typeId).stats.radius);
        const spawnPoints = nvnSpawns ? nvnSpawns[teamIndex] : spawnPointsForTeam(
          normalized,
          teamIndex,
          radii,
          opposingRadii
        );
        const team = {
          id: teamConfig.id,
          role: teamConfig.role,
          balls: []
        };
        team.balls = ballTypeIds.map((typeId, memberIndex) => (
          this.createBallInstance(
            typeId,
            team,
            memberIndex,
            spawnPoints[memberIndex],
            normalized,
            null,
            teamConfig.ballModifiers && teamConfig.ballModifiers[memberIndex]
          )
        ));
        return team;
      });
      const balls = teams.flatMap((team) => team.balls);
      const ballByInstanceId = new Map(balls.map((ball) => [ball.instanceId, ball]));
      const ballsByTeamId = new Map(teams.map((team) => [team.id, team.balls.slice()]));
      this.arenaSize = legacyArenaSize == null ? normalized.arenaSize : legacyArenaSize;
      this.arena = createArenaGeometry(legacyArenaSize == null ? (normalized.arena == null ? normalized.arenaSize : normalized.arena) : legacyArenaSize);
      this.game = {
        config: normalized,
        teams,
        balls,
        ballByInstanceId,
        ballsByTeamId,
        summons: [],
        summonsById: new Map(),
        state: "ready",
        time: 0,
        // 场上几何的唯一真源：插件视图、判定与模式控制器都读同一个值。
        arenaSize: this.arenaSize,
        arena: this.arena,
        wasColliding: false,
        contactPairs: new Set(),
        nextContactPairs: new Set(),
        hitEffects: [],
        combatEntities: this.entitySystem.entities,
        pendingCombatEntities: this.entitySystem.pendingEntities,
        visualEffects: this.visualEffectSystem.effects,
        pendingVisualEffects: this.visualEffectSystem.pendingEffects,
        modeEntities: [],
        modeController: null,
        zombieMode: null,
        hellMode: null,
        nextSummonId: 1,
        nextReplayEventId: 1,
        endedAt: null,
        winnerTeam: null,
        loserTeam: null,
        winner: null,
        loser: null
      };
      if (normalized.mode === "zombie") {
        this.game.modeController = createZombieModeController(this, this.game, {
          arenaSize: normalized.arenaSize,
          playerTeamId: teams[0].id,
          zombieTeamId: teams[1].id
        });
        this.game.zombieMode = this.game.modeController;
      } else if (normalized.mode === "zombiehell") {
        this.game.modeController = createZombieHellModeController(this, this.game, {
          arenaSize: normalized.arenaSize,
          playerTeamId: teams[0].id,
          hordeTeamId: teams[1].id
        });
        this.game.hellMode = this.game.modeController;
      } else if (normalized.mode === "wheel" || normalized.mode === "brawl" || normalized.mode === "coop") {
        this.game.modeController = createCompetitiveModeController({
          engine: this,
          game: this.game,
          mode: normalized.mode,
          onSwitch: (event) => this.handleCompetitiveSwitch(event)
        });
      }
      if (this.game.modeController) {
        this.game.modeEntities = this.game.modeController.entities;
      }
      // Legacy callers must expose their final geometry and positions before skills capture them.
      if (Number.isFinite(legacyArenaSize)) {
        this.game.legacyArenaSize = legacyArenaSize;
        if (legacyArenaSize !== 200) {
          const [left, right] = balls;
          left.x = left.prevX = left.radius + 28;
          right.x = right.prevX = legacyArenaSize - right.radius - 28;
          left.y = left.prevY = legacyArenaSize / 2;
          right.y = right.prevY = legacyArenaSize / 2;
        }
      }
      balls.forEach((ball) => {
        this.invokeHook(ball, "onPrepare");
        if (this.isBallActive(ball)) {
          ball.modeSpawned = true;
          this.invokeHook(ball, "onSpawn");
        }
      });
      return this.game;
    }

    createBallInstance(typeId, team, memberIndex, spawnPoint, config, reuse = null, modifiers = null) {
      const definition = this.registry.get(typeId);
      const radius = definition.stats.radius;
      const isBoss = config.bossTeamId === team.id;
      const hpMultiplier = modifiers ? modifiers.hpMultiplier : (isBoss && config.mode === "boss" ? 10 : 1);
      const attackMultiplier = modifiers ? modifiers.attackMultiplier : 1;
      const maxHp = definition.stats.maxHp * hpMultiplier;
      const { x, y } = spawnPoint;
      const ball = Object.assign(reuse || {}, {
        definition,
        id: definition.id,
        instanceId: `${team.id}-${memberIndex}`,
        teamId: team.id,
        isBoss,
        name: definition.name,
        color: definition.color,
        radius,
        x,
        y,
        prevX: x,
        prevY: y,
        spawnX: x,
        spawnY: y,
        vx: 0,
        vy: 0,
        storedVx: 0,
        storedVy: 0,
        speed: definition.stats.speed,
        speedMultiplier: 1,
        speedMultiplierBase: 1,
        speedNeedsNormalization: false,
        bounceVelocityInitialized: false,
        bounceHorizontalSpeedRandomized: false,
        bounceLastStoredVx: 0,
        bounceLastStoredVy: 0,
        gyroLastStoredVx: 0,
        gyroLastStoredVy: 0,
        movementLocked: false,
        hp: maxHp,
        maxHp,
        hpMultiplier,
        attackMultiplier,
        attackTime: 0,
        effects: new Map(),
        behavior: null,
        fade: 1,
        active: true,
        modeSpawned: false,
        deathNotified: false,
        diedAt: null,
        replayFrames: [],
        replayEvents: [],
        forcedTargetInstanceId: definition.forcedTargetInstanceId || null,
        damageOutputScale: (Number.isFinite(definition.damageOutputScale)
          ? definition.damageOutputScale
          : 1) * attackMultiplier
      });

      let behavior;
      ball.services = this.createServices(ball);
      try {
        behavior = definition.createBehavior(ball.services);
      } catch (cause) {
        throw new Error(`Ball ${ball.id} failed in createBehavior`, { cause });
      }
      if (!behavior || typeof behavior !== "object") {
        throw new TypeError(`Ball ${ball.id} createBehavior must return an object`);
      }
      ball.behavior = behavior;
      return ball;
    }

    createServices(owner) {
      const originalOwner = owner;
      let attackOffset = 0;
      this.behaviorBindings.set(originalOwner, {
        bind(recipient, offset = 0) { owner = recipient; attackOffset = offset; }
      });
      return Object.freeze({
        dealDamage: (target, amount, source = owner, options = {}) => (
          this.dealDamage(target, amount, source === originalOwner ? owner : source, options)
        ),
        canExecuteTarget: (target) => this.canExecuteTarget(owner, target),
        executeTarget: (target) => this.damageResolver.execute(target, owner),
        applyEffect: (target, effect, source = owner) => this.applyEffect(
          target, effect, source === originalOwner ? owner : source
        ),
        spawnHitText: (target, text, options = {}) => (
          this.spawnHitText(target.x, target.y, text, options)
        ),
        spawnVisualEffect: (definition, overrides = {}) => (
          this.spawnVisualEffect(definition, owner, overrides)
        ),
        spawnParticleBurst: (options = {}, overrides = {}) => (
          this.spawnParticleBurst(options, owner, overrides)
        ),
        createVisualEffect: (factory, options = {}, overrides = {}) => (
          this.createVisualEffect(factory, options, owner, overrides)
        ),
        spawnVisualComposition: (entries, overrides = {}) => (
          this.spawnVisualComposition(entries, owner, overrides)
        ),
        spawnAfterimageTrail: (options = {}, overrides = {}) => {
          // 返回句柄而不是视效副本：拖尾需要被持续喂样、软收尾。
          const trail = createAfterimageTrail(options);
          this.spawnVisualEffect(trail, owner, overrides);
          return trail;
        },
        spawnCombatEntity: (definition, overrides = {}) => (
          this.spawnCombatEntity(definition, owner, overrides)
        ),
        spawnProjectile: (definition) => this.spawnProjectile(definition, owner),
        spawnSummon: (definition, spawn = {}) => (
          this.spawnSummon(owner, definition, spawn)
        ),
        getSummons: (id) => this.getSummons(id),
        isBounceMode: () => this.isBounceMode(),
        isFieldPhysicsMode: () => this.isFieldPhysicsMode(),
        setSpeedMultiplier: (multiplier) => this.setSpeedMultiplier(owner, multiplier),
        getSlowFactor: (target) => this.getSlowFactor(target),
        isSlowed: (target) => this.isSlowed(target),
        clearEffect: (target, id) => this.removeEffect(target, id),
        exchangeEffects: (left, right, predicate) => this.exchangeEffects(left, right, predicate),
        transformCombatant: (target, definitionId) => this.queueCombatantTransformation(target, definitionId, owner),
        borrowAttack: (target) => this.borrowAttack(target, owner),
        canBorrowAttack: (target) => Boolean(target && !this.attackLeases.has(target)),
        isAbilitySealed: (target) => this.isAbilitySealed(target),
        setMovementLocked: (locked) => this.setMovementLocked(owner, locked),
        getContactProfile: (target) => this.getContactProfile(target),
        getCapabilities: (target) => this.getCapabilities(target),
        isMovementLocked: (target) => Boolean(target && (
          target.positionLocked || this.isPhysicsMovementLocked(target)
        )),
        getNextTransitionIn: (target) => this.getNextTransitionIn(target),
        notifyEntityContact: (target, entity, options = {}) => (
          this.notifyEntityContact(target, entity, owner, options)
        ),
        tryConsumeEntity: (target, entity, options = {}) => (
          this.tryConsumeEntity(target, entity, owner, options)
        ),
        reportCombatInteraction: (type, target) => this.reportCombatInteraction(type, target, owner),
        getOpponent: () => this.getOpponent(owner),
        getTriggerChanceScale: (target) => this.triggerChanceScale(target || owner),
        getEnemies: () => this.getLivingEnemies(owner),
        getAllies: () => this.getLivingAllies(owner),
        forEachEnemy: (callback) => this.forEachLivingEnemy(owner, callback),
        forEachContactEnemy: (callback) => this.forEachLivingEnemy(owner, callback,
          (target) => this.canContact(owner, target)),
        forEachAlly: (callback) => this.forEachLivingAlly(owner, callback),
        getBallDefinitions: (rosterType = "normal") => rosterType === "all"
          ? this.registry.list() : this.listRosterDefinitions(rosterType),
        getBall: (instanceId) => this.getBall(instanceId),
        getReplayWindow: (target, duration) => this.getReplayWindow(target, duration),
        isEnemy: (target) => this.areEnemies(owner, target),
        getFirstEnemyHit: (startX, startY, endX, endY, radius = 0) => (
          this.getFirstEnemyHit(owner, startX, startY, endX, endY, radius)
        ),
        shakeArena: (options = {}) => this.shakeArena(options),
        playSound: (type, detail = {}) => this.playSound(type, owner, detail),
        getAttackTime: () => owner.attackTime + attackOffset,
        getAttackPeriodScale: () => this.attackPeriodScale(owner) / this.combatantStepScale(owner),
        getTime: () => (this.game ? this.game.time : 0),
        getClockTime: () => this.clockTime
      });
    }

    queueCombatantTransformation(target, definitionId, source) {
      this.registry.get(definitionId); // Validate before accepting the request.
      const origin = normalizeDamageSource(source, { kind: "skill" });
      if (!target || target.hp <= 0 || !this.isBallActive(target) || !origin ||
          !this.areEnemies(origin, target) || !this.canTarget(origin, target) ||
          this.ownerBlocksEntityDamage(origin.owner)) return false;
      // Commit after all attacks in this substep, so contact retaliation keeps
      // the behavior which actually made contact rather than a newly rolled kit.
      this.pendingTransformations.set(target, definitionId);
      return true;
    }

    flushCombatantTransformations() {
      const pending = Array.from(this.pendingTransformations);
      this.pendingTransformations.clear();
      for (const [ball, definitionId] of pending) {
        if (ball.hp <= 0 || !this.isBallActive(ball)) continue;
        const oldId = ball.id;
        const ratio = ball.hp / ball.maxHp;
        const lease = this.attackLeases.get(ball);
        if (lease) lease.release();
        const failures = [];
        for (const hook of ["onBorrowEnd", "onBattleDispose"]) {
          try { this.invokeHook(ball, hook); } catch (error) { failures.push(error); }
        }
        for (const effect of Array.from(ball.effects.values())) {
          if (effect.combatSource && effect.combatSource.owner === ball) {
            try { this.removeEffect(ball, effect.id); } catch (error) { failures.push(error); }
          }
        }
        for (const entity of this.entitySystem.entities.concat(this.entitySystem.pendingEntities)) {
          if (entity.ownerInstanceId === ball.instanceId && entity.lifecycle === "owner-bound") entity.entityActive = false;
        }
        if (failures.length) throw new AggregateError(failures, `Ball ${oldId} failed transformation cleanup`);
        const saved = {};
        for (const key of ["instanceId", "teamId", "isBoss", "isSummon", "summonerInstanceId", "spawnedAt", "summonOrder",
          "isReplayActor", "replayTargetInstanceId", "isModeUnit", "modeEntityType", "spawnRound", "attractionCooldown",
          "active", "modeSpawned", "effects", "knockbackState", "replayFrames", "replayEvents", "forcedTargetInstanceId", "damageOutputScale", "hpMultiplier", "attackMultiplier"]) {
          if (Object.prototype.hasOwnProperty.call(ball, key)) saved[key] = ball[key];
        }
        const position = { x: ball.x, y: ball.y };
        const angle = Math.atan2(ball.storedVy || ball.vy, ball.storedVx || ball.vx);
        for (const key of Object.keys(ball)) delete ball[key];
        this.ballHookContexts.delete(ball);
        this.contactProfileCache.delete(ball);
        this.statusController.invalidate(ball);
        this.createBallInstance(definitionId, { id: saved.teamId }, 0, position,
          { ...this.game.config, bossTeamId: saved.isBoss ? saved.teamId : null }, ball,
          { hpMultiplier: saved.hpMultiplier == null ? 1 : saved.hpMultiplier, attackMultiplier: saved.attackMultiplier == null ? 1 : saved.attackMultiplier });
        Object.assign(ball, saved);
        Object.assign(ball, this.arena.clampPoint(ball.x, ball.y, ball.radius));
        ball.prevX = ball.x;
        ball.prevY = ball.y;
        ball.vx = ball.storedVx = Math.cos(angle) * ball.speed;
        ball.vy = ball.storedVy = Math.sin(angle) * ball.speed;
        ball.speedNeedsNormalization = true;
        if (ball.isSummon) {
          const old = this.game.summonsById.get(oldId);
          if (old) { const index = old.indexOf(ball); if (index >= 0) old.splice(index, 1); }
          if (!this.game.summonsById.has(ball.id)) this.game.summonsById.set(ball.id, []);
          this.game.summonsById.get(ball.id).push(ball);
        }
        this.invokeHook(ball, "onPrepare");
        this.invokeHook(ball, "onSpawn");
        ball.hp = ball.maxHp * ratio;
        this.refreshSpeedMultiplier(ball);
      }
    }

    borrowAttack(donor, recipient) {
      if (!donor || !recipient || donor === recipient || donor.hp <= 0 || recipient.hp <= 0 ||
          !this.isBallActive(donor) || !this.isBallActive(recipient) ||
          this.attackLeases.has(donor) || this.attackLeases.has(recipient) ||
          !this.areEnemies(donor, recipient)) return null;
      const binding = this.behaviorBindings.get(donor);
      if (!binding || !recipient.services) return null;
      const behavior = donor.behavior;
      const donorClock = donor.attackTime;
      const recipientClock = recipient.attackTime;
      const attackTime = () => donorClock + Math.max(0, recipient.attackTime - recipientClock);
      const services = Object.freeze({ ...recipient.services, getAttackTime: attackTime });
      const entities = [];
      const trackedEntities = new Set();
      let live = true;
      const invalidate = (ball) => {
        this.ballHookContexts.delete(ball);
        this.contactProfileCache.delete(ball);
        this.statusController.invalidate(ball);
      };
      const moveEntity = (entity, owner, source) => {
        entity.owner = owner;
        entity.ownerInstanceId = owner.instanceId;
        entity.creditInstanceId = source.credit.instanceId;
        entity.teamId = source.teamId;
        entity.combatSource = createCombatSource({ ...source, actor: entity, entity, owner });
        entity.services = this.createEntityServices(entity);
        this.combatEntityHookContexts.delete(entity);
      };
      const lease = {
        donor,
        definition: donor.definition,
        trackEntity: (entity, originalSource = null) => {
          if (!live || trackedEntities.has(entity)) return;
          trackedEntities.add(entity);
          entities.push({ entity, source: originalSource || createCombatSource({
            ...entity.combatSource, owner: donor, credit: donor, teamId: donor.teamId,
            targetPolicy: donor.targetPolicy || null, damageOutputScale: donor.damageOutputScale
          }) });
        },
        invoke: (hook, context, ...args) => {
          if (!live || typeof behavior[hook] !== "function") return undefined;
          try {
            return behavior[hook].call(behavior, {
              ...context, ball: recipient,
              services: context && context.services && context.services.source ? context.services : services
            }, ...args);
          } catch (cause) {
            throw new Error(`Borrowed ball ${donor.id} failed in ${hook}`, { cause });
          }
        },
        release: () => {
          if (!live) return;
          live = false;
          donor.attackTime = attackTime();
          binding.bind(donor);
          donor.behavior = behavior;
          this.attackLeases.delete(donor);
          this.attackLeases.delete(recipient);
          for (const entry of entities) {
            if (entry.entity.entityActive !== false) moveEntity(entry.entity, donor, entry.source);
          }
          entities.length = 0;
          trackedEntities.clear();
          invalidate(donor);
          invalidate(recipient);
          this.invokeHook(donor, "onAttackTransfer", { previousBall: recipient });
          if (donor.hp <= 0 && donor.deathNotified) this.invokeHook(donor, "onDeath");
        }
      };
      binding.bind(recipient, donorClock - recipientClock);
      // The original instance lives in the lease; no paused, reactive or draw
      // hook may keep operating a second copy on the disarmed body.
      donor.behavior = {};
      this.attackLeases.set(donor, lease);
      this.attackLeases.set(recipient, lease);
      for (const entity of this.entitySystem.entities.concat(this.entitySystem.pendingEntities)) {
        if (entity.entityActive === false || entity.ownerInstanceId !== donor.instanceId) continue;
        lease.trackEntity(entity, entity.combatSource);
        moveEntity(entity, recipient, {
          ...entity.combatSource, credit: recipient, teamId: recipient.teamId,
          targetPolicy: recipient.targetPolicy || null, damageOutputScale: recipient.damageOutputScale
        });
      }
      invalidate(donor);
      invalidate(recipient);
      try {
        lease.invoke("onAttackTransfer", { game: this.gameView(), previousBall: donor });
      } catch (cause) {
        lease.release();
        throw cause;
      }
      return Object.freeze(lease);
    }

    listRosterDefinitions(rosterType = "normal") {
      if (typeof this.registry.listByRosterType === "function") {
        return this.registry.listByRosterType(rosterType);
      }
      return this.registry.list().filter((definition) => (
        (definition.rosterType || "normal") === rosterType
      ));
    }

    createEntityServices(entity) {
      if (!entity || !entity.combatSource) {
        throw new TypeError("Entity services require a combat entity");
      }
      return new CombatSourceServices(this, entity.combatSource);
    }

    spawnSummon(owner, definition, spawn = {}) {
      if (!this.game || !owner || !this.isBallActive(owner) || owner.hp <= 0) return null;
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Summon requires a definition");
      }
      const stats = definition.stats || {};
      if (
        typeof definition.id !== "string" || !definition.id ||
        typeof definition.name !== "string" || !definition.name ||
        typeof definition.color !== "string" || !definition.color ||
        !Number.isFinite(stats.radius) || stats.radius <= 0 ||
        !Number.isFinite(stats.speed) || stats.speed <= 0 ||
        !Number.isFinite(stats.maxHp) || stats.maxHp <= 0 ||
        typeof definition.createBehavior !== "function" ||
        (definition.healthless !== undefined && typeof definition.healthless !== "boolean")
      ) {
        throw new TypeError("Summon definition is invalid");
      }

      const radius = stats.radius;
      const { x, y } = this.arena.clampPoint(
        Number.isFinite(spawn.x) ? spawn.x : owner.x,
        Number.isFinite(spawn.y) ? spawn.y : owner.y, radius);
      const vx = Number.isFinite(spawn.vx) ? spawn.vx : 0;
      const vy = Number.isFinite(spawn.vy) ? spawn.vy : 0;
      const summonOrder = this.game.nextSummonId++;
      const summon = {
        definition,
        id: definition.id,
        instanceId: `${owner.instanceId}-summon-${summonOrder}`,
        teamId: owner.teamId,
        isBoss: false,
        isSummon: true,
        isReplayActor: definition.isReplayActor === true || owner.isReplayActor === true,
        replayTargetInstanceId: spawn.replayTargetInstanceId ||
          definition.replayTargetInstanceId || owner.replayTargetInstanceId || null,
        summonerInstanceId: owner.instanceId,
        spawnedAt: this.game.time,
        summonOrder,
        name: definition.name,
        color: definition.color,
        radius,
        x,
        y,
        prevX: x,
        prevY: y,
        vx,
        vy,
        storedVx: vx,
        storedVy: vy,
        speed: stats.speed,
        speedMultiplier: 1,
        speedMultiplierBase: 1,
        speedNeedsNormalization: false,
        bounceVelocityInitialized: false,
        bounceHorizontalSpeedRandomized: false,
        bounceLastStoredVx: vx,
        bounceLastStoredVy: vy,
        gyroLastStoredVx: vx,
        gyroLastStoredVy: vy,
        movementLocked: spawn.movementLocked === true,
        positionLocked: spawn.positionLocked === true,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        attackTime: 0,
        effects: new Map(),
        behavior: null,
        fade: 1,
        deathNotified: false,
        diedAt: null,
        replayFrames: [],
        replayEvents: [],
        forcedTargetInstanceId: spawn.forcedTargetInstanceId ||
          definition.forcedTargetInstanceId || owner.forcedTargetInstanceId || null,
        damageOutputScale: Number.isFinite(spawn.damageOutputScale)
          ? spawn.damageOutputScale
          : (Number.isFinite(definition.damageOutputScale)
            ? definition.damageOutputScale
            : (Number.isFinite(owner.damageOutputScale) ? owner.damageOutputScale : 1))
      };

      let behavior;
      summon.services = this.createServices(summon);
      try {
        behavior = definition.createBehavior(summon.services);
      } catch (cause) {
        throw new Error(`Summon ${summon.id} failed in createBehavior`, { cause });
      }
      if (!behavior || typeof behavior !== "object") {
        throw new TypeError(`Summon ${summon.id} createBehavior must return an object`);
      }
      summon.behavior = behavior;
      this.game.balls.push(summon);
      this.game.ballByInstanceId.set(summon.instanceId, summon);
      const teamBalls = this.game.ballsByTeamId.get(summon.teamId);
      if (teamBalls) teamBalls.push(summon);
      this.game.summons.push(summon);
      const sameType = this.game.summonsById.get(summon.id);
      if (sameType) {
        sameType.push(summon);
      } else {
        this.game.summonsById.set(summon.id, [summon]);
      }
      this.invokeHook(summon, "onSpawn");
      this.playSound("summon", summon);
      return summon;
    }

    beginFight() {
      if (!this.game || this.game.state !== "ready") return false;
      this.game.state = "running";
      this.game.balls.forEach((ball) => {
        ball.initialMaxHp = ball.maxHp;
        if (!this.isBallActive(ball)) {
          ball.vx = 0;
          ball.vy = 0;
          ball.storedVx = 0;
          ball.storedVy = 0;
          return;
        }
        const direction = this.randomDirection();
        const magnitude = Math.hypot(direction.x, direction.y) || 1;
        const speed = this.effectiveSpeed(ball);
        ball.vx = (direction.x / magnitude) * speed;
        ball.vy = (direction.y / magnitude) * speed;
        ball.storedVx = ball.vx;
        ball.storedVy = ball.vy;
        ball.speedNeedsNormalization = false;
        if (this.isBounceMode()) {
          this.bouncePhysics.randomizeHorizontalSpeed(ball);
          ball.bounceVelocityInitialized = true;
          ball.bounceLastStoredVx = ball.storedVx;
          ball.bounceLastStoredVy = ball.storedVy;
          this.bouncePhysics.adoptHeading(ball);
        } else if (this.isGyroMode()) {
          // 陀螺模式自己接管开局速度：两颗球朝同一旋向起旋，速度里再掺一份
          // 有界随机采样（与弹跳模式的墙弹冲量同一个采样器）。
          this.gyroPhysics.seedOrbit(ball, this.arenaSize, speed);
        }
      });
      if (!this.activeModeController()) this.recordReplayFrames();
      return true;
    }

    restartFight() {
      if (!this.game) return null;
      const legacyArenaSize = this.game.legacyArenaSize;
      return this.initializeBattle(this.game.config, legacyArenaSize);
    }

    update(dt) {
      if (!this.game) return;
      if (this.isUpdatingGame) {
        throw new Error("BattleEngine.update cannot be called reentrantly");
      }
      this.isUpdatingGame = true;
      try {
        let realRemaining = Number.isFinite(dt) ? Math.max(0, dt) : 0;
        const skipBudget = { remaining: 5, steps: 0 };
        const presentationActive = this.game.balls.some((ball) => (
          ball.hp > 0 && this.isBallActive(ball) && typeof ball.behavior.updatePresentation === "function"
        ));
        const timeControlActive = this.game.balls.some((ball) => (
          ball.hp > 0 && this.isBallActive(ball) && (typeof ball.behavior.getTimeControl === "function" ||
            typeof ball.behavior.getTimeDilation === "function" ||
            typeof ball.behavior.getNextTimeControlTransitionIn === "function" ||
            typeof ball.behavior.getTimeSkipRemaining === "function")
        ));
        do {
          const initialControl = this.simulationTimeControl();
          if (initialControl.scale === 0) this.timeStopActors = initialControl.exempt;
          try {
            if (timeControlActive && (realRemaining > 0 || initialControl.scale > 0)) this.prepareUpdateStep();
          }
          finally { this.timeStopActors = null; }
          const control = this.simulationTimeControl();
          this.combatantTimeControls = control.combatants;
          this.sampledWorldTimeControl = control;
          let realDelta = presentationActive || timeControlActive
            ? Math.min(realRemaining, MAX_SIMULATION_STEP_SECONDS / Math.max(1, control.scale))
            : realRemaining;
          if (control.scale > 0 && control.scale < 1) {
            for (const request of control.worldRequests) {
              if (!request.exemptSelf || request.scale >= 1) continue;
              const actorRate = control.scale * this.combatantStepScale(request.owner);
              realDelta = Math.min(realDelta, MAX_SIMULATION_STEP_SECONDS / Math.max(1, actorRate));
            }
          }
          if (control.transition !== Infinity) realDelta = Math.min(realDelta, control.transition);
          if (timeControlActive && control.scale > 0 && realDelta > 0) {
            realDelta = this.nextUpdateStep(realDelta * control.scale) / control.scale;
          } else if (control.scale === 0 && control.exempt.size > 0 && realDelta > 0) {
            realDelta = this.nextStoppedUpdateStep(realDelta, control.exempt);
          }
          this.clockTime += realDelta;
          const dilation = control.scale;
          let remaining = realDelta * dilation;
          if (realDelta === 0 && dilation > 0) {
            if (!timeControlActive) this.prepareUpdateStep();
            this.updateGame(0);
          }
          // A cinematic stop advances presentation only. A true stop runs the
          // explicit caster and opted-in weapons, without advancing world time.
          if (dilation === 0 && control.exempt.size > 0 && realDelta > 0) {
            this.timeStopActors = control.exempt;
            try { this.updateGame(realDelta); }
            finally { this.timeStopActors = null; }
          }
          let firstWorldStep = true;
          while (remaining > UPDATE_EPSILON) {
            if (!timeControlActive || !firstWorldStep) this.prepareUpdateStep();
            firstWorldStep = false;
            const step = this.nextUpdateStep(timeControlActive
              ? Math.min(remaining, MAX_SIMULATION_STEP_SECONDS) : remaining);
            this.updateGame(step);
            this.entitySystem.flushPending();
            this.visualEffectSystem.flushPending();
            remaining = Math.max(0, remaining - step);
          }
          if (presentationActive && realDelta > 0 && this.game.state === "running") {
            for (const ball of this.game.balls) {
              if (this.isBallActive(ball) && ball.hp > 0 && !this.isAbilitySealed(ball)) {
                this.invokeHook(ball, "updatePresentation", null, realDelta);
              }
            }
          }
          this.entitySystem.flushPending();
          this.visualEffectSystem.flushPending();
          if (timeControlActive) this.advanceRequestedTimeSkip(skipBudget);
          realRemaining = Math.max(0, realRemaining - realDelta);
        } while (realRemaining > UPDATE_EPSILON);
      } catch (cause) {
        this.entitySystem.discardPending();
        this.visualEffectSystem.discardPending();
        throw cause;
      } finally {
        this.timeStopActors = null;
        this.combatantTimeControls = null;
        this.sampledWorldTimeControl = null;
        this.hiddenAudioStep = null;
        this.isUpdatingGame = false;
      }
    }

    // World rates are bounded to 0..8. Stops/slowdowns outrank acceleration;
    // otherwise the strongest acceleration wins. Stop exemptions intersect:
    // exemptSelf is permission from that request, not immunity to other stops.
    simulationDilation() {
      return this.simulationTimeControl().scale;
    }

    requestedTimeSkip() {
      if (!this.game || this.game.state !== "running") return 0;
      let remaining = 0;
      for (const ball of this.game.balls) {
        if (ball.hp <= 0 || !this.isBallActive(ball) || this.isAbilitySealed(ball)) continue;
        const requested = this.invokeHook(ball, "getTimeSkipRemaining");
        if (requested === undefined) continue;
        if (!Number.isFinite(requested) || requested <= 0) {
          throw new TypeError(`Ball ${ball.id} returned an invalid time skip remaining`);
        }
        remaining = Math.max(remaining, requested);
      }
      return remaining;
    }

    advanceRequestedTimeSkip(budget) {
      let finalAudio = null;
      try {
        while (budget.remaining > UPDATE_EPSILON && budget.steps < 600) {
          if (this.simulationDilation() < 1) break;
          let requested = this.requestedTimeSkip();
          if (requested <= UPDATE_EPSILON) break;
          this.hiddenAudioStep = [];
          this.prepareUpdateStep();
          const control = this.simulationTimeControl();
          if (control.scale < 1) break;
          this.combatantTimeControls = control.combatants;
          this.sampledWorldTimeControl = control;
          requested = this.requestedTimeSkip();
          if (requested <= UPDATE_EPSILON) break;
          const step = this.nextUpdateStep(Math.min(requested, budget.remaining, MAX_SIMULATION_STEP_SECONDS));
          this.updateGame(step);
          this.entitySystem.flushPending();
          this.visualEffectSystem.flushPending();
          finalAudio = this.hiddenAudioStep;
          budget.remaining = Math.max(0, budget.remaining - step);
          budget.steps += 1;
        }
      } finally {
        this.hiddenAudioStep = null;
      }
      if (finalAudio) {
        for (const sound of finalAudio) {
          if (sound.bounce) this.publishBounce(...sound.args);
          else {
            // Match playSound's existing non-fatal audio callback boundary.
            try { this.publishSound(sound.event); } catch (error) { /* presentation only */ }
          }
        }
      }
    }

    simulationTimeControl() {
      const result = { scale: 1, exempt: new Set(), transition: Infinity, combatants: [], worldRequests: [] };
      if (!this.game || this.game.state !== "running") return result;
      let slowest = 1;
      let fastest = 1;
      let legacyStop = false;
      for (const ball of this.game.balls) {
        if (ball.hp <= 0 || !this.isBallActive(ball) || this.isAbilitySealed(ball)) continue;
        const requested = this.invokeHook(ball, "getTimeDilation");
        if (Number.isFinite(requested) && requested >= 0 && requested <= 8) {
          result.worldRequests.push({ owner: ball, scale: requested, exemptSelf: false });
          slowest = Math.min(slowest, requested);
          fastest = Math.max(fastest, requested);
          if (requested === 0) legacyStop = true;
        }
        const control = this.invokeHook(ball, "getTimeControl");
        if (control !== undefined) {
          if (!control || !Number.isFinite(control.scale) || control.scale < 0 || control.scale > 8) {
            throw new TypeError(`Ball ${ball.id} returned an invalid time control`);
          }
          if (control.scope !== undefined && control.scope !== "world" && control.scope !== "combatants") {
            throw new TypeError(`Ball ${ball.id} returned an invalid time control scope`);
          }
          if (control.scope === "combatants") {
            if (control.scale <= 0 || control.scale > 1 ||
                (control.exemptSelf !== undefined && typeof control.exemptSelf !== "boolean") ||
                (control.healthBearingOnly !== undefined && typeof control.healthBearingOnly !== "boolean")) {
              throw new TypeError(`Ball ${ball.id} returned an invalid combatant time control`);
            }
            result.combatants.push({ owner: ball, scale: control.scale,
              exemptSelf: control.exemptSelf === true, healthBearingOnly: control.healthBearingOnly === true });
          } else {
            if (control.exemptSelf !== undefined && typeof control.exemptSelf !== "boolean") {
              throw new TypeError(`Ball ${ball.id} returned an invalid world time exemption`);
            }
            result.worldRequests.push({ owner: ball, scale: control.scale, exemptSelf: control.exemptSelf === true });
            slowest = Math.min(slowest, control.scale);
            fastest = Math.max(fastest, control.scale);
            if (control.scale === 0) {
              if (result.exempt.size > 0 || control.exemptSelf !== true) legacyStop = true;
              if (control.exemptSelf === true) result.exempt.add(ball);
            }
          }
        }
        const transition = this.invokeHook(ball, "getNextTimeControlTransitionIn");
        if (transition !== undefined) {
          if (!Number.isFinite(transition) || transition <= 0) {
            throw new TypeError(`Ball ${ball.id} returned an invalid time control transition`);
          }
          result.transition = Math.min(result.transition, Math.max(MIN_TRANSITION_STEP_SECONDS, transition));
        }
      }
      result.scale = slowest < 1 ? slowest : fastest;
      if (legacyStop || result.scale !== 0) result.exempt.clear();
      return result;
    }

    // Personal action/motion rates are sampled once per input interval. They do
    // not redefine world time, independent projectiles, statuses or mode waves.
    combatantTimeScale(ball) {
      let rate = 1;
      const controls = this.combatantTimeControls || this.simulationTimeControl().combatants;
      for (const control of controls) {
        if (control.owner.hp <= 0 || !this.isBallActive(control.owner) || this.isAbilitySealed(control.owner)) continue;
        if (control.exemptSelf && ball === control.owner) continue;
        if (control.healthBearingOnly && (!ball || !Number.isFinite(ball.hp) || ball.hp <= 0 ||
            (ball.definition && ball.definition.healthless === true))) continue;
        rate = Math.min(rate, control.scale);
      }
      return rate;
    }

    combatantActionDelta(ball, worldDt) {
      return worldDt * this.combatantStepScale(ball) / this.attackPeriodScale(ball);
    }

    // Cancel only this actor's self-exempt slowdown. Other world requests still
    // arbitrate normally, and personal dilation multiplies the resulting rate.
    combatantStepScale(ball) {
      const personalRate = this.combatantTimeScale(ball);
      const control = this.sampledWorldTimeControl || this.simulationTimeControl();
      if (control.scale <= 0 || control.scale >= 1 ||
          !control.worldRequests.some(request => request.owner === ball && request.exemptSelf && request.scale < 1)) {
        return personalRate;
      }
      let slowest = 1;
      let fastest = 1;
      for (const request of control.worldRequests) {
        if (request.owner === ball && request.exemptSelf && request.scale < 1) continue;
        slowest = Math.min(slowest, request.scale);
        fastest = Math.max(fastest, request.scale);
      }
      return personalRate * (slowest < 1 ? slowest : fastest) / control.scale;
    }

    isTimeFrozen(ball) {
      if (!this.timeStopActors) return false;
      if (ball && ball.isCombatEntity === true) {
        const owner = this.getBall(ball.ownerInstanceId);
        return !(ball.timeStopExempt === true && this.timeStopActors.has(owner) &&
          owner.hp > 0 && !this.isAbilitySealed(owner));
      }
      return !this.timeStopActors.has(ball);
    }

    nextStoppedUpdateStep(remaining, actors) {
      let step = remaining;
      for (const ball of actors) {
        const hook = this.isBehaviorPaused(ball) ? "getNextPausedTransitionIn" : "getNextTransitionIn";
        const boundary = this.invokeHook(ball, hook);
        if (boundary === undefined) continue;
        if (!Number.isFinite(boundary) || boundary <= 0) {
          throw new TypeError(`Ball ${ball.id} returned an invalid stopped transition boundary`);
        }
        step = Math.min(step, boundary * this.attackPeriodScale(ball) / this.combatantStepScale(ball));
      }
      return Math.min(remaining, Math.max(MIN_TRANSITION_STEP_SECONDS, step));
    }

    prepareUpdateStep() {
      if (this.game.state !== "running") return;
      for (const ball of this.game.balls) {
        if (ball.hp > 0 && this.isBallActive(ball) && !this.isAbilitySealed(ball) && !this.isTimeFrozen(ball)) {
          this.invokeHook(ball, "beforeUpdateStep");
        }
      }
    }

    nextUpdateStep(remaining) {
      if (this.game.state !== "running") return remaining;

      let step = remaining;
      let effectBoundary = remaining;
      const balls = this.game.balls;
      const ballCount = balls.length;
      for (let index = 0; index < ballCount; index += 1) {
        const ball = balls[index];
        if (ball.hp <= 0 || !this.isBallActive(ball)) continue;
        const motion = getKnockbackState(ball);
        if (motion) {
          const phaseBoundary = motion.startedAt + motion.duration - this.game.time;
          if (phaseBoundary > UPDATE_EPSILON) effectBoundary = Math.min(effectBoundary, phaseBoundary);
          const expiryBoundary = motion.effect.expiresAt - this.game.time;
          if (expiryBoundary > UPDATE_EPSILON) effectBoundary = Math.min(effectBoundary, expiryBoundary);
        }
        for (const effect of ball.effects.values()) {
          if (Number.isFinite(effect.attackPeriodScale) && effect.attackPeriodScale > 0 &&
              effect.expiresAt - this.game.time > UPDATE_EPSILON) {
            effectBoundary = Math.min(effectBoundary, effect.expiresAt - this.game.time);
          }
        }
        const pauseBoundary = this.behaviorPauseRemaining(ball);
        const attackPeriodScale = this.attackPeriodScale(ball);
        const timeRate = this.combatantStepScale(ball);
        if (pauseBoundary > UPDATE_EPSILON) {
          step = Math.min(step, pauseBoundary);
          const pausedBoundary = this.invokeHook(ball, "getNextPausedTransitionIn");
          if (pausedBoundary !== undefined) {
            if (!Number.isFinite(pausedBoundary) || pausedBoundary <= 0) {
              throw new TypeError(`Ball ${ball.id} returned an invalid paused transition boundary`);
            }
            step = Math.min(step, pausedBoundary * attackPeriodScale / timeRate);
          }
          continue;
        }
        const boundary = this.invokeHook(ball, "getNextTransitionIn");
        if (boundary === undefined) continue;
        if (!Number.isFinite(boundary) || boundary <= 0) {
          throw new TypeError(`Ball ${ball.id} returned an invalid transition boundary`);
        }
        step = Math.min(step, boundary * attackPeriodScale / timeRate);
      }
      const modeController = this.activeModeController();
      if (modeController) {
        step = Math.min(step, modeController.nextTransitionIn());
      }
      if (step < MIN_TRANSITION_STEP_SECONDS) {
        step = Math.min(remaining, MIN_TRANSITION_STEP_SECONDS);
      }
      return Math.min(step, effectBoundary);
    }

    updateGame(dt) {
      const behaviorDeltas = this.behaviorDeltas;
      behaviorDeltas.clear();
      const behaviorPausedAtStepStart = this.pausedAtStepStart;
      behaviorPausedAtStepStart.clear();
      this.prescribedMotionActors.clear();
      const modeController = this.activeModeController();
      const balls = this.game.balls;
      this.entitySystem.beginStep();
      this.visualEffectSystem.beginStep();
      try {
      if (this.game.state === "running") {
        const pauseCheckCount = balls.length;
        for (let index = 0; index < pauseCheckCount; index += 1) {
          const ball = balls[index];
          if (ball.hp <= 0 || !this.isBallActive(ball)) continue;
          if (!this.isTimeFrozen(ball)) {
            const behaviorDt = this.combatantActionDelta(ball, dt);
            behaviorDeltas.set(ball, behaviorDt);
            if (!this.isBehaviorPaused(ball) && !this.isAbilitySealed(ball)) {
              ball.attackTime += behaviorDt;
            }
          }
          if (this.isBehaviorPaused(ball)) {
            behaviorPausedAtStepStart.add(ball);
          }
        }
      }
      if (!this.timeStopActors) this.game.time += dt;

      if (this.game.state === "running") {
        const movementCount = balls.length;
        for (let index = 0; index < movementCount; index += 1) {
          const ball = balls[index];
          if (ball.hp <= 0 || !this.isBallActive(ball) || this.isTimeFrozen(ball)) continue;
          const movementDt = dt * this.combatantStepScale(ball);
          if (this.isAbilitySealed(ball)) {
            // 行尸走肉：跳过 update / updateWhilePaused，行为完全冻结
          } else if (!behaviorPausedAtStepStart.has(ball)) {
            this.invokeHook(ball, "update", null, behaviorDeltas.get(ball) || 0);
          } else {
            this.invokeHook(ball, "updateWhilePaused", null, behaviorDeltas.get(ball) || 0);
          }
          const hadFieldPhysicsKnockback = this.hasFieldPhysicsKnockback(ball);
          if (!this.timeStopActors) this.updateEffects(ball, dt);
          const fieldPhysicsKnockback = hadFieldPhysicsKnockback ||
            this.hasFieldPhysicsKnockback(ball);
          const fieldMovementLocked = this.isFieldPhysicsMovementLocked(ball);
          // A trajectory supplies this step's position, not an extra displacement.
          // External controls still win; contacts can hit it but cannot push it
          // off the sampled path. Ordinary physics resumes on the next step
          // without a request. No character-specific policy belongs here.
          const prescribed = !ball.positionLocked && !fieldMovementLocked &&
            this.getCapabilities(ball).canMove !== false &&
            !this.isAbilitySealed(ball) && !this.isBehaviorPaused(ball)
            ? this.invokeHook(ball, "getPrescribedMotion") : undefined;
          if (prescribed != null) {
            if (![prescribed.x, prescribed.y, prescribed.vx, prescribed.vy].every(Number.isFinite)) {
              throw new TypeError(`Ball ${ball.id} returned invalid prescribed motion`);
            }
            ball.prevX = ball.x;
            ball.prevY = ball.y;
            Object.assign(ball, this.arena.clampPoint(prescribed.x, prescribed.y, ball.radius));
            ball.vx = ball.storedVx = prescribed.vx;
            ball.vy = ball.storedVy = prescribed.vy;
            const prescribedSpeed = Math.hypot(prescribed.vx, prescribed.vy);
            if (prescribedSpeed > UPDATE_EPSILON) {
              ball.speedHeadingX = prescribed.vx / prescribedSpeed;
              ball.speedHeadingY = prescribed.vy / prescribedSpeed;
            }
            if (this.isBounceMode()) this.bouncePhysics.commitVelocity(ball);
            if (this.isGyroMode()) this.gyroPhysics.commitVelocity(ball);
            this.prescribedMotionActors.add(ball);
            continue;
          }
          if (ball.positionLocked) {
            ball.vx = 0;
            ball.vy = 0;
            ball.storedVx = 0;
            ball.storedVy = 0;
          } else if (this.hasKnockbackMotion(ball)) {
            if (fieldMovementLocked) {
              ball.vx = 0;
              ball.vy = 0;
            } else if (this.isBounceMode()) {
              this.bouncePhysics.commitVelocity(ball);
            } else if (this.isGyroMode()) {
              this.gyroPhysics.commitVelocity(ball);
            }
          } else if (!fieldMovementLocked) {
            if (this.isBounceMode()) {
              // Special knockback effects historically write their impulse to
              // vx/vy while holding a movement lock. Capture that impulse as
              // the current bounce velocity before gravity integrates it.
              if (fieldPhysicsKnockback) this.bouncePhysics.commitVelocity(ball);
              this.bouncePhysics.randomizeHorizontalSpeed(ball);
              this.bouncePhysics.prepareVelocity(ball, (target) => (
                this.normalizeStoredVelocity(target)
              ));
            } else if (this.isGyroMode()) {
              // 陀螺模式同样是"场物理"：兼容冲量先把冲量记成当前速度，
              // 再由中心重力与盘心接管后续轨迹。
              if (fieldPhysicsKnockback) this.gyroPhysics.commitVelocity(ball);
              this.gyroPhysics.prepareVelocity(ball, (target) => (
                this.normalizeStoredVelocity(target)
              ));
            } else {
              if (ball.speedNeedsNormalization) {
                this.normalizeStoredVelocity(ball);
                ball.speedNeedsNormalization = false;
              }
              ball.vx = ball.storedVx;
              ball.vy = ball.storedVy;
            }
          }

          ball.prevX = ball.x;
          ball.prevY = ball.y;
          if (this.isBounceMode()) {
            // A regular movement lock is a real physics lock in bounce mode:
            // do not fall through to the ordinary straight-line integrator.
            // Explicitly bounce-compatible knockback effects opt back into
            // gravity integration and wall/ball collision response.
            if (!ball.positionLocked && !fieldMovementLocked) {
              this.bouncePhysics.integrate(ball, movementDt);
            }
          } else if (this.isGyroMode()) {
            // 陀螺模式同理：移动锁期间不做中心重力积分，兼容冲量例外。
            if (!ball.positionLocked && !fieldMovementLocked) {
              this.gyroPhysics.integrate(ball, movementDt, this.arenaSize);
            }
          } else if (!ball.positionLocked) {
            ball.x += ball.vx * movementDt;
            ball.y += ball.vy * movementDt;
          }
          if (!this.timeStopActors) this.applyKnockbackStep(ball);
        }

        const wallCount = balls.length;
        for (let index = 0; index < wallCount; index += 1) {
          const ball = balls[index];
          if (ball.hp > 0 && this.isBallActive(ball) && !this.isTimeFrozen(ball) &&
              !this.prescribedMotionActors.has(ball)) this.bounceFromWalls(ball);
        }
        this.handleBallCollisions(dt, behaviorDeltas);
        if (this.timeStopActors && modeController && typeof modeController.resolvePlayerContacts === "function") {
          modeController.resolvePlayerContacts(Array.from(this.timeStopActors), dt);
        }
        const afterUpdateCount = balls.length;
        for (let index = 0; index < afterUpdateCount; index += 1) {
          const ball = balls[index];
          if (ball.hp <= 0 || !this.isBallActive(ball) || this.isTimeFrozen(ball) ||
              this.isAbilitySealed(ball)) continue;
          if (
            !behaviorPausedAtStepStart.has(ball) &&
            !this.isBehaviorPaused(ball)
          ) {
            this.invokeHook(ball, "afterUpdateStep", null, behaviorDeltas.get(ball) || 0);
          } else {
            this.invokeHook(ball, "afterUpdateStepWhilePaused", null, behaviorDeltas.get(ball) || 0);
          }
        }
      }

      if (modeController && !this.timeStopActors) modeController.update(dt);

      this.entitySystem.update(dt);
      this.flushCombatantTransformations();
      // Older capture/teleport skills may write body positions after the wall
      // phase. The arena, rather than each skill, owns final containment.
      if (this.arena.shape !== "square" || this.game.config.mode === "nvn") {
        for (const ball of balls) {
          if (!this.isBallActive(ball) || ball.hp <= 0 || this.isTimeFrozen(ball)) continue;
          const wrap = this.getWallMode(ball) === "wrap";
          if (!this.arena.contains(ball.x, ball.y, wrap ? 0 : ball.radius)) {
            Object.assign(ball, wrap
              ? this.arena.wrapPoint(ball.x, ball.y, ball.vx, ball.vy)
              : this.arena.clampPoint(ball.x, ball.y, ball.radius));
          }
        }
      }
      if (!this.timeStopActors) this.visualEffectSystem.update(dt);
      if (!modeController) this.recordReplayFrames();
      this.notifyNewDeaths();
      if (!this.timeStopActors && modeController && typeof modeController.afterDeaths === "function") {
        modeController.afterDeaths();
      }
      if (this.game.state === "running") {
        this.checkWinner();
      }
      this.updateDeathFades();
      if (!this.timeStopActors) this.updateHitEffects(dt);
      } finally {
        this.entitySystem.endStep();
        this.visualEffectSystem.endStep();
        behaviorDeltas.clear();
        this.prescribedMotionActors.clear();
      }
    }

    gameView() {
      return this.pluginGameView;
    }

    activeModeController() {
      if (!this.game) return null;
      return this.game.modeController || this.game.hellMode || this.game.zombieMode || null;
    }

    switchCoopPlayer(instanceId) {
      const controller = this.activeModeController();
      if (!controller || !this.game || this.game.config.mode !== "coop" ||
          typeof controller.switchPlayer !== "function") return false;
      if (this.game.state !== "running") return false;
      return controller.switchPlayer(instanceId);
    }

    isBallActive(ball) {
      return Boolean(ball && ball.active !== false && ball.isModeBench !== true);
    }

    isCombatSourceActive(actor) {
      if (this.isTimeFrozen(actor)) return false;
      // EntitySystem owns dispatch eligibility. A hit may mark its projectile
      // consumed before resolving that final hit; local `active` is mechanic state.
      if (actor && actor.isCombatEntity === true) return true;
      if (this.isBallActive(actor)) return true;
      // Competitive mode benches stop simulating their body, but entities
      // already emitted by them may outlive a switch. Keep their captured
      // services useful without making the defeated body targetable again.
      return Boolean(
        actor && actor.competitiveRetired === true &&
        this.game && (this.game.config.mode === "wheel" || this.game.config.mode === "coop")
      );
    }

    handleCompetitiveSwitch(event) {
      if (!event || !event.current) return;
      const current = event.current;
      const previous = event.previous;
      const isDefeatAdvance = event.reason === "defeat";
      const source = previous || current;
      const directionX = Number.isFinite(source.vx) && Math.abs(source.vx) > UPDATE_EPSILON
        ? source.vx
        : source.storedVx;
      const directionY = Number.isFinite(source.vy) && Math.abs(source.vy) > UPDATE_EPSILON
        ? source.vy
        : source.storedVy;
      const directionMagnitude = Math.hypot(directionX || 0, directionY || 0) || 1;

      if (isDefeatAdvance) {
        current.hp = current.maxHp;
        current.effects.clear();
        current.statusRevision = (current.statusRevision || 0) + 1;
        current.movementLocked = false;
        current.positionLocked = false;
        current.deathNotified = false;
        current.diedAt = null;
        current.fade = 1;
        current.x = current.spawnX;
        current.y = current.spawnY;
      } else if (previous) {
        current.x = previous.x;
        current.y = previous.y;
      }

      const speed = this.effectiveSpeed(current);
      current.vx = (directionX || 1) / directionMagnitude * speed;
      current.vy = (directionY || 0) / directionMagnitude * speed;
      current.storedVx = current.vx;
      current.storedVy = current.vy;
      current.speedNeedsNormalization = false;
      delete current.competitiveRetired;
      current.active = true;
      if (event.entryEffect) this.applyEffect(current, event.entryEffect);
      if (!current.modeSpawned) {
        current.modeSpawned = true;
        this.invokeHook(current, "onSpawn");
      }

      if (previous && previous !== current) {
        previous.competitiveRetired = true;
        previous.active = false;
        previous.vx = 0;
        previous.vy = 0;
        previous.storedVx = 0;
        previous.storedVy = 0;
      }
      this.game.contactPairs.clear();
      this.game.nextContactPairs.clear();
      this.game.wasColliding = false;
    }

    getBall(instanceId) {
      if (!this.game || typeof instanceId !== "string") return null;
      return this.game.ballByInstanceId.get(instanceId) || null;
    }

    getSummons(id) {
      if (!this.game) return [];
      if (id === undefined) return this.game.summons.slice();
      const summons = this.game.summonsById.get(id);
      return summons ? summons.slice() : [];
    }

    replayRootFor(ball) {
      if (!ball || !this.game) return null;
      if (!ball.isSummon || !ball.summonerInstanceId) return ball;
      return this.getBall(ball.summonerInstanceId) || ball;
    }

    recordReplayFrames() {
      if (!this.game) return;
      const cutoff = this.game.time - REPLAY_HISTORY_LIMIT;
      for (const ball of this.game.balls) {
        if (ball.isReplayActor) continue;
        const frame = {
          time: this.game.time,
          x: ball.x,
          y: ball.y,
          vx: ball.vx,
          vy: ball.vy
        };
        const previous = ball.replayFrames.at(-1);
        if (previous && Math.abs(previous.time - frame.time) <= UPDATE_EPSILON) {
          ball.replayFrames[ball.replayFrames.length - 1] = frame;
        } else {
          ball.replayFrames.push(frame);
        }
        pruneReplayHistory(ball.replayFrames, cutoff);
        pruneReplayHistory(ball.replayEvents, cutoff);
      }
    }

    recordReplayEvent(source, event) {
      if (
        !this.game || this.game.state !== "running" || this.activeModeController() ||
        !source || source.isReplayActor
      ) {
        return null;
      }
      const root = this.replayRootFor(source);
      if (!root || root.isReplayActor) return null;
      const recorded = {
        id: this.game.nextReplayEventId++,
        time: this.game.time,
        sourceInstanceId: source.instanceId,
        ...event
      };
      root.replayEvents.push(recorded);
      return recorded;
    }

    getReplayWindow(target, duration = 3) {
      if (!this.game || !target || !Number.isFinite(duration) || duration <= 0) {
        return null;
      }
      const start = this.game.time - duration;
      const frames = target.replayFrames
        .filter((frame) => frame.time + UPDATE_EPSILON >= start)
        .map((frame) => ({
          time: clamp(frame.time - start, 0, duration),
          x: frame.x,
          y: frame.y,
          vx: frame.vx,
          vy: frame.vy
        }));
      if (frames.length === 0) {
        frames.push({
          time: 0,
          x: target.x,
          y: target.y,
          vx: target.vx,
          vy: target.vy
        });
      } else if (frames[0].time > UPDATE_EPSILON) {
        frames.unshift({ ...frames[0], time: 0 });
      }
      const events = target.replayEvents
        .filter((event) => event.time + UPDATE_EPSILON >= start)
        .map((event) => ({
          ...event,
          time: clamp(event.time - start, 0, duration)
        }));
      return Object.freeze({
        duration,
        targetInstanceId: target.instanceId,
        targetName: target.name,
        targetColor: target.color,
        targetRadius: target.radius,
        frames,
        events
      });
    }

    getOpponent(ball) {
      if (!this.game) return null;
      // Keep the established owner-relative distance while using the attack's
      // captured team and targeting policy to decide which enemies qualify.
      const origin = ball && ball.actor ? ball.credit : ball;
      let nearest = null;
      let nearestDistance = Infinity;
      this.forEachLivingEnemy(ball, (candidate) => {
        const dx = candidate.x - origin.x;
        const dy = candidate.y - origin.y;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
          nearest = candidate;
          nearestDistance = distance;
        }
      });
      return nearest;
    }

    getCapabilities(ball) {
      if (this.isTimeFrozen(ball)) {
        const capabilities = ball && ball.effects instanceof Map
          ? this.statusController.forCombatant(ball) : { canBeSlowed: true };
        return Object.freeze({ ...capabilities, canMove: false, canAct: false,
          canBodyAttack: false, canDealDamage: false });
      }
      if (!ball || !(ball.effects instanceof Map)) {
        return Object.freeze({
          canMove: true,
          canAct: true,
          canBodyAttack: true,
          canDealDamage: true,
          canBeSlowed: true
        });
      }
      return this.statusController.forCombatant(ball);
    }

    // 攻击周期倍率：效果字段 effect.attackPeriodScale（>0 有效，可乘法叠加）。
    // 按子步缩放行为 dt、接触 dt 和本体攻击时钟；行为边界换算回世界时间。
    // 不改变世界时钟、移动速度、投射物速度或已生成攻击的物理。
    attackPeriodScale(ball) {
      if (!ball || !(ball.effects instanceof Map) || ball.effects.size === 0) return 1;
      const now = this.game ? this.game.time : 0;
      let scale = 1;
      for (const effect of ball.effects.values()) {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) continue;
        const s = effect.attackPeriodScale;
        if (!Number.isFinite(s) || s <= 0) continue;
        scale *= s;
      }
      return scale;
    }

    // 触发概率倍率：效果字段 effect.triggerChanceScale（>0 有效，乘法叠加）。
    // 攻击方掷骰 Math.random() < P 决定是否触发额外攻击/穿透/分支时，
    // 各球可用 services.getTriggerChanceScale(ball) 取得系数并乘在 P 上。
    triggerChanceScale(ball) {
      if (!ball || !(ball.effects instanceof Map) || ball.effects.size === 0) return 1;
      const now = this.game ? this.game.time : 0;
      let scale = 1;
      for (const effect of ball.effects.values()) {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) continue;
        const s = effect.triggerChanceScale;
        if (!Number.isFinite(s) || s <= 0) continue;
        scale *= s;
      }
      return scale;
    }

    getNextTransitionIn(ball) {
      if (!ball || !ball.behavior || !this.game || !this.isBallActive(ball) || ball.hp <= 0) {
        return null;
      }
      const hook = this.isBehaviorPaused(ball)
        ? "getNextPausedTransitionIn"
        : "getNextTransitionIn";
      try {
        const value = this.invokeHook(ball, hook);
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch (_error) {
        return null;
      }
    }

    getLivingEnemies(ball) {
      const enemies = [];
      this.forEachLivingEnemy(ball, (candidate) => enemies.push(candidate));
      return enemies;
    }

    getLivingAllies(ball) {
      const allies = [];
      this.forEachLivingAlly(ball, (candidate) => allies.push(candidate));
      return allies;
    }

    forEachLivingEnemy(ball, callback, contactFilter = null) {
      if (typeof callback !== "function") {
        throw new TypeError("Enemy visitor must be a function");
      }
      if (!this.game || !ball) return 0;
      const modeController = this.activeModeController();
      if (modeController && this.game.config.mode === "brawl") {
        let count = 0;
        const livingBalls = typeof modeController.getBrawlLivingBalls === "function"
          ? modeController.getBrawlLivingBalls()
          : this.game.balls;
        for (const candidate of livingBalls) {
          if (
            !this.areEnemies(ball, candidate) || !this.isBallActive(candidate) ||
            !(contactFilter ? contactFilter(candidate) : this.canAcquireTarget(ball, candidate))
          ) continue;
          callback(candidate);
          count += 1;
        }
        return count;
      }
      let count = 0;
      for (const [teamId, candidates] of this.game.ballsByTeamId) {
        if (teamId === ball.teamId) continue;
        const candidateCount = candidates.length;
        for (let index = 0; index < candidateCount; index += 1) {
          const candidate = candidates[index];
          if (
            candidate.hp <= 0 || candidate.isReplayActor || !this.isBallActive(candidate) ||
            !this.areEnemies(ball, candidate) ||
            !(contactFilter ? contactFilter(candidate) : this.canAcquireTarget(ball, candidate))
          ) {
            continue;
          }
          callback(candidate);
          count += 1;
        }
      }
      if (
        modeController &&
        ball.teamId !== modeController.zombieTeamId &&
        typeof modeController.forEachLivingUnit === "function"
      ) {
        modeController.forEachLivingUnit((candidate) => {
          if (!this.areEnemies(ball, candidate) ||
              !(contactFilter ? contactFilter(candidate) : this.canAcquireTarget(ball, candidate))) return;
          callback(candidate);
          count += 1;
        });
      }
      return count;
    }

    forEachLivingAlly(ball, callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Ally visitor must be a function");
      }
      if (!this.game || !ball) return 0;
      const candidates = this.game.ballsByTeamId.get(ball.teamId) || [];
      if (this.game.config.mode === "brawl") return 0;
      let count = 0;
      const candidateCount = candidates.length;
      for (let index = 0; index < candidateCount; index += 1) {
        const candidate = candidates[index];
        if (candidate === (ball.credit || ball) || !this.isBallActive(candidate) || candidate.hp <= 0) continue;
        callback(candidate);
        count += 1;
      }
      return count;
    }

    areEnemies(left, right) {
      const modeController = this.activeModeController();
      if (modeController && this.game && this.game.config.mode === "brawl") {
        return modeController.isBrawlEnemy(left, right);
      }
      return Boolean(
        left && right && left !== right &&
        left.teamId !== undefined && right.teamId !== undefined &&
        left.teamId !== right.teamId
      );
    }

    canTarget(source, target) {
      const actor = source && source.actor ? source.actor : source;
      const policy = source && source.targetPolicy;
      const forcedTargetInstanceId = policy && policy.forcedTargetInstanceId
        ? policy.forcedTargetInstanceId
        : source && !source.actor && source.forcedTargetInstanceId;
      const sourceKind = source && source.actor ? source.kind : null;
      const targetabilityRequired = !["dot", "environment", "self"].includes(sourceKind);
      return Boolean(
        actor && target && this.isCombatSourceActive(actor) && this.isBallActive(target) && (
          !forcedTargetInstanceId ||
          forcedTargetInstanceId === target.instanceId
        ) &&
        (!targetabilityRequired || this.getContactProfile(target).attackable !== false)
      );
    }

    canAcquireTarget(source, target) {
      return this.canTarget(source, target) &&
        this.getContactProfile(target).targetable !== false;
    }

    canContact(source, target) {
      const actor = source && source.actor ? source.actor : source;
      if (source && source.actor && target === source.owner) return false;
      const policy = source && source.targetPolicy;
      const forcedId = policy && policy.forcedTargetInstanceId
        ? policy.forcedTargetInstanceId : source && !source.actor && source.forcedTargetInstanceId;
      if (!actor || !target || !this.isCombatSourceActive(actor) || !this.isBallActive(target) ||
          (forcedId && forcedId !== target.instanceId)) return false;
      const profile = this.getContactProfile(target);
      return profile.solid || profile.attackable;
    }

    canExecuteTarget(source, target) {
      const actor = source && source.actor ? source.actor : source;
      const policy = source && source.targetPolicy;
      const forcedId = policy && policy.forcedTargetInstanceId
        ? policy.forcedTargetInstanceId : source && !source.actor && source.forcedTargetInstanceId;
      return Boolean(actor && target && this.isCombatSourceActive(actor) &&
        (this.getBall(actor.instanceId) !== actor || actor.hp > 0) &&
        this.isBallActive(target) && this.getBall(target.instanceId) === target &&
        target.definition && target.definition.healthless !== true &&
        typeof target.name === "string" && target.name.trim() &&
        Number.isFinite(target.hp) && target.hp > 0 &&
        this.areEnemies(source, target) && (!forcedId || forcedId === target.instanceId));
    }

    getFirstEnemyHit(owner, startX, startY, endX, endY, radius = 0) {
      let first = null;
      let firstProgress = Infinity;
      let candidateProgress = null;
      this.forEachLivingEnemy(owner, (enemy) => {
        first = enemy;
        firstProgress = candidateProgress;
      }, (enemy) => {
        candidateProgress = firstSegmentCircleContact(
          startX, startY, endX, endY, enemy.x, enemy.y, enemy.radius + radius
        );
        // Target policies are only relevant for a geometrical hit that can
        // replace the current nearest candidate. Equal hits retain roster order.
        return candidateProgress !== null && candidateProgress < firstProgress &&
          this.canTarget(owner, enemy);
      });
      return first;
    }

    invokeHook(ball, hook, details = null, firstArg, secondArg) {
      const callback = ball && ball.behavior && ball.behavior[hook];
      if (typeof callback !== "function") return undefined;

      try {
        let context;
        if (details === null) {
          context = this.ballHookContexts.get(ball);
          if (!context) {
            context = {
              ball,
              game: this.gameView(),
              services: ball.services || this.createServices(ball)
            };
            this.ballHookContexts.set(ball, context);
          }
        } else {
          context = {
            ball,
            game: this.gameView(),
            services: ball.services || this.createServices(ball),
            ...details
          };
        }
        if (arguments.length <= 3) return callback.call(ball.behavior, context);
        if (arguments.length === 4) {
          return callback.call(ball.behavior, context, firstArg);
        }
        return callback.call(ball.behavior, context, firstArg, secondArg);
      } catch (cause) {
        throw new Error(`Ball ${ball.id} failed in ${hook}`, { cause });
      } finally {
        if (!hook.startsWith("get") && !hook.startsWith("draw")) {
          this.contactProfileCache.delete(ball);
          this.statusController.invalidate(ball);
        }
      }
    }

    invokeEffectHook(ball, effect, hook, details = null, firstArg) {
      const callback = effect && effect[hook];
      if (typeof callback !== "function") return undefined;

      try {
        let context;
        if (details === null) {
          context = this.effectHookContexts.get(effect);
          if (!context || context.ball !== ball || context.services !== (effect.services || null)) {
            context = {
              ball,
              effect,
              game: this.gameView(),
              services: effect.services || null
            };
            this.effectHookContexts.set(effect, context);
          }
        } else {
          context = {
            ball,
            effect,
            game: this.gameView(),
            services: effect.services || null,
            ...details
          };
        }
        if (arguments.length <= 4) return callback(context);
        return callback(context, firstArg);
      } catch (cause) {
        throw new Error(`Effect ${effect.id} on ball ${ball.id} failed in ${hook}`, { cause });
      } finally {
        if (!hook.startsWith("get") && !hook.startsWith("draw")) {
          this.contactProfileCache.delete(ball);
          this.statusController.invalidate(ball);
        }
      }
    }

    invokeVisualEffectHook(effect, hook, details = null, firstArg) {
      const callback = effect && effect[hook];
      if (typeof callback !== "function") return undefined;

      try {
        let context;
        if (details === null) {
          context = this.visualEffectHookContexts.get(effect);
          if (!context) {
            context = { effect, game: this.gameView() };
            this.visualEffectHookContexts.set(effect, context);
          }
        } else {
          context = { effect, game: this.gameView(), ...details };
        }
        const hasArgument = arguments.length > 3;
        if (!this.visualEffectSystem.profilingEnabled) {
          return hasArgument ? callback(context, firstArg) : callback(context);
        }
        return this.visualEffectSystem.measureHook(effect, hook, () => (
          hasArgument ? callback(context, firstArg) : callback(context)
        ));
      } catch (cause) {
        throw new Error(
          `Visual effect ${effect.instanceId || "<unknown>"} failed in ${hook}`,
          { cause }
        );
      }
    }

    getContactProfile(ball) {
      if (!(ball.effects instanceof Map)) {
        return DEFAULT_CONTACT_PROFILE;
      }
      if (ball.effects.size === 0 &&
          typeof (ball.behavior && ball.behavior.getContactProfile) !== "function") {
        return DEFAULT_CONTACT_PROFILE;
      }
      const now = this.game.time;
      const revision = Number.isFinite(ball.statusRevision) ? ball.statusRevision : 0;
      const effectCount = ball.effects.size;
      const cached = this.contactProfileCache.get(ball);
      if (
        cached && cached.time === now && cached.revision === revision &&
        cached.effectCount === effectCount
      ) {
        return cached.profile;
      }
      const provided = this.invokeHook(ball, "getContactProfile") || {};
      let physical = provided.physical === undefined
        ? provided.solid !== false
        : provided.physical !== false;
      let attackable = provided.attackable === undefined
        ? provided.targetable !== false
        : provided.attackable !== false;
      let targetable = provided.targetable === undefined
        ? attackable
        : provided.targetable !== false;
      for (const effect of ball.effects.values()) {
        if (effect.expiresAt <= this.game.time) continue;
        const effectProfile = this.invokeEffectHook(
          ball,
          effect,
          "getContactProfile"
        ) || {};
        if (effectProfile.physical === false || effectProfile.solid === false) {
          physical = false;
        }
        if (effectProfile.targetable === false || effectProfile.attackable === false) {
          attackable = false;
          targetable = false;
        }
      }
      const contactProfile = { solid: physical, attackable };
      if (targetable !== attackable) contactProfile.targetable = targetable;
      // Some targetable bodies allow contact attacks without physical separation.
      if (provided.bodyContact === true) contactProfile.bodyContact = true;
      // A body whose contact hook is only passive damage reception (not an
      // action) keeps it under a behaviour seal, so control never grants
      // immunity to a body that damages itself on behalf of its attacker.
      if (provided.passiveContactReaction === true) {
        contactProfile.passiveContactReaction = true;
      }
      const profile = Object.freeze(contactProfile);
      this.contactProfileCache.set(ball, { time: now, revision, effectCount, profile });
      return profile;
    }

    getPhysicsProfile(ball) {
      return this.getContactProfile(ball).solid;
    }

    getTargetProfile(ball) {
      return this.getContactProfile(ball).attackable;
    }

    getWallMode(ball) {
      return this.invokeHook(ball, "getWallMode") === "wrap" ? "wrap" : "bounce";
    }

    isBounceMode() {
      return Boolean(this.game && isBounceConfig(this.game.config));
    }

    isGyroMode() {
      return Boolean(this.game && isGyroConfig(this.game.config));
    }

    // 弹跳与陀螺都是"场物理"模式：重力/场力自己演变速度，墙与球体的碰撞
    // 交给场而不是直线模式。共享同一套"移动锁=真锁、兼容冲量=可继续被场驱动"
    // 的约定，所以下面两个判定不再只看弹跳。
    isFieldPhysicsMode() {
      return this.isBounceMode() || this.isGyroMode();
    }

    effectiveSpeed(ball) {
      return ball.speed * ball.speedMultiplier;
    }

    // 自身通道：小球自己的位移机制（冲刺、悬停、体积速度、借用速度）改自己的
    // 基础倍率。减速不走这条，走效果的 speedFactor，由 SpeedModifierSystem 合成。
    setSpeedMultiplier(ball, multiplier) {
      this.speedModifiers.setBaseMultiplier(ball, multiplier);
      this.applySpeedMultiplier(ball, this.speedModifiers.multiplier(ball));
    }

    // 把合成结果落到场上。只置 speedNeedsNormalization，不直接写 vx/vy：
    // 被锁移动 / 停住的小球由引擎在解除锁定的那一刻统一归一化，
    // 减速效果因此不可能把一个停住的小球推起来。
    applySpeedMultiplier(ball, multiplier) {
      const previous = ball.speedMultiplier;
      ball.speedMultiplier = multiplier;
      ball.speedNeedsNormalization = true;
      if (this.hasMovementLock(ball) || getKnockbackState(ball)) return;
      // 从完全钉住（冰冻的倍率 0）恢复时，按最后记下的朝向重建速度向量。
      // 普通静止的小球没有这个 0 → 正 的跳变，不会被推着走。
      if (previous <= UPDATE_EPSILON && multiplier > UPDATE_EPSILON) {
        this.restoreStoredHeading(ball);
      }
      this.normalizeStoredVelocity(ball);
      ball.speedNeedsNormalization = false;
      ball.vx = ball.storedVx;
      ball.vy = ball.storedVy;
    }

    restoreStoredHeading(ball) {
      if (Math.hypot(ball.storedVx, ball.storedVy) > 0.001) return;
      const headingX = ball.speedHeadingX;
      const headingY = ball.speedHeadingY;
      if (!Number.isFinite(headingX) || !Number.isFinite(headingY)) return;
      if (Math.hypot(headingX, headingY) <= 0.5) return;
      ball.storedVx = headingX;
      ball.storedVy = headingY;
    }

    // 每帧根据当前生效的效果重新合成。没有变化就不动场上状态。
    refreshSpeedMultiplier(ball) {
      const multiplier = this.speedModifiers.multiplier(ball);
      if (Math.abs(multiplier - ball.speedMultiplier) <= UPDATE_EPSILON) return false;
      this.applySpeedMultiplier(ball, multiplier);
      return true;
    }

    // 统一的减速查询：任何"我是否被减速 / 它会不会被我减速"都读这里。
    getSlowFactor(ball) {
      return this.speedModifiers.slowFactor(ball);
    }

    isSlowed(ball) {
      return this.speedModifiers.isSlowed(ball);
    }

    setMovementLocked(ball, locked) {
      if (typeof locked !== "boolean") {
        throw new TypeError("Movement lock must be a boolean");
      }

      ball.movementLocked = locked;
      if (locked) {
        ball.vx = 0;
        ball.vy = 0;
      }
    }

    normalizeStoredVelocity(ball) {
      const magnitude = Math.hypot(ball.storedVx, ball.storedVy);
      if (magnitude <= 0.001) return;
      // 记下最后一次真实朝向：倍率 0 的冰冻会把速度向量清零，解冻时要沿它恢复，
      // 否则小球会永久停在原地。
      ball.speedHeadingX = ball.storedVx / magnitude;
      ball.speedHeadingY = ball.storedVy / magnitude;
      const speed = this.effectiveSpeed(ball);
      ball.storedVx = ball.speedHeadingX * speed;
      ball.storedVy = ball.speedHeadingY * speed;
    }

    applyDamageKnockback(target, event) {
      if (!target || this.isTimeFrozen(target) || !event || event.amount <= 0 ||
        !Number.isFinite(target.x) || !Number.isFinite(target.y) ||
        !this.isFieldPhysicsMode() || target.positionLocked === true) return false;
      const source = event.combatSource;
      if (!source || source.actor === target || source.kind === "self") return false;

      // Body contacts already carry the collision normal. Other attacks use
      // the first source object with a world position (projectile, entity,
      // effect owner, then credited ball) to push away from the impact point.
      let directionX = Number.isFinite(source.contact && source.contact.normalX)
        ? source.contact.normalX
        : 0;
      let directionY = Number.isFinite(source.contact && source.contact.normalY)
        ? source.contact.normalY
        : 0;
      if (Math.hypot(directionX, directionY) <= UPDATE_EPSILON) {
        const candidates = [source.actor, source.entity, source.owner, source.credit];
        for (const origin of candidates) {
          if (!origin || origin === target ||
            !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) continue;
          directionX = target.x - origin.x;
          directionY = target.y - origin.y;
          if (Math.hypot(directionX, directionY) > UPDATE_EPSILON) break;
        }
      }
      const magnitude = Math.hypot(directionX, directionY);
      if (magnitude <= UPDATE_EPSILON) return false;
      directionX /= magnitude;
      directionY /= magnitude;

      target.x += directionX * DAMAGE_KNOCKBACK_DISTANCE;
      target.y += directionY * DAMAGE_KNOCKBACK_DISTANCE;
      const radius = Number.isFinite(target.radius) ? target.radius : 0;
      Object.assign(target, this.arena.clampPoint(target.x, target.y, radius));
      return true;
    }

    hasFieldPhysicsKnockback(ball) {
      if (!this.isFieldPhysicsMode() || !ball || !(ball.effects instanceof Map)) return false;
      const now = this.game ? this.game.time : 0;
      for (const effect of ball.effects.values()) {
        if (
          effect && effect.bounceCompatible === true &&
          Number.isFinite(effect.expiresAt) && effect.expiresAt > now
        ) return true;
      }
      return false;
    }

    isFieldPhysicsMovementLocked(ball) {
      if (ball && this.getSlowFactor(ball) <= UPDATE_EPSILON) return true;
      if (!ball || !this.hasMovementLock(ball)) return false;
      let unifiedKnockback = false;
      if (ball && ball.effects instanceof Map) {
        for (const effect of ball.effects.values()) {
          if (effect && effect.knockback) { unifiedKnockback = true; break; }
        }
      }
      if ((!this.isFieldPhysicsMode() && !unifiedKnockback) || !ball) return this.hasMovementLock(ball);
      // A compatible knockback is allowed to move through field physics, but it
      // must not cancel an unrelated generic movement lock layered on top
      // (for example a capture or a position-control effect).
      if (ball.movementLocked === true) return true;
      const now = this.game ? this.game.time : 0;
      let compatibleLock = false;
      if (!(ball.effects instanceof Map)) return true;
      for (const effect of ball.effects.values()) {
        if (!effect || !Number.isFinite(effect.expiresAt) || effect.expiresAt <= now) continue;
        if (effect.forceCapabilities && effect.forceCapabilities.canMove === false) return true;
        if (effect.locksMovement !== true) continue;
        if (effect.knockback) {
          compatibleLock = true;
          continue;
        }
        if (effect.bounceCompatible !== true) return true;
        compatibleLock = true;
      }
      return !compatibleLock;
    }

    isPhysicsMovementLocked(ball) {
      return this.prescribedMotionActors.has(ball) || this.isTimeFrozen(ball) || this.isFieldPhysicsMovementLocked(ball);
    }

    hasKnockbackMotion(ball) {
      return Boolean(getKnockbackState(ball));
    }

    applyKnockbackStep(ball) {
      const step = ball.knockbackStep;
      if (!step || step.time !== this.game.time || ball.positionLocked ||
          this.isPhysicsMovementLocked(ball)) return;
      const timeRate = this.combatantStepScale(ball);
      ball.x += step.x * timeRate;
      ball.y += step.y * timeRate;
    }

    dealDamage(target, amount, source = null, options = {}) {
      if (!target || this.getBall(target.instanceId) !== target || !this.isBallActive(target) || target.hp <= 0) return false;
      const combatSource = normalizeDamageSource(source, options);
      if (combatSource && combatSource.actor && !this.isCombatSourceActive(combatSource.actor)) return false;
      return this.damageResolver.resolve(target, amount, combatSource, options);
    }

    notifyEntityContact(target, entity, source = null, options = {}) {
      if (!target || !entity || typeof entity !== "object") return false;
      let contacts = this.entityContacts.get(entity);
      const reported = this.entityContactReports.get(entity);
      if (options.overlapping === false) {
        if (contacts) contacts.delete(target);
        if (reported) reported.delete(target);
        return false;
      }
      if (!this.isBallActive(target) || this.getBall(target.instanceId) !== target ||
          target.hp <= 0 || entity.entityActive === false ||
          !source || !this.areEnemies(source, target) || !this.canContact(source, target)) return false;
      if (!contacts) {
        contacts = new WeakSet();
        this.entityContacts.set(entity, contacts);
      }
      if (reported) reported.add(target);
      if (contacts.has(target)) return false;
      contacts.add(target);
      if (!this.getContactProfile(target).solid || this.isAbilitySealed(target) ||
          this.isTimeFrozen(target) || this.isAttackBlocked(target)) return false;
      this.invokeHook(target, "onEntityCollision", { entity, source });
      return true;
    }

    // Telemetry only: a destroyed obstacle remains the actor; target caused its
    // destruction. Sources retain their captured team and forced-target policy.
    reportCombatInteraction(type, target, source, targetTeamId) {
      if (!this.onCombatInteraction) return false;
      if (type !== "block" && type !== "obstacle-destroyed") return false;
      const bound = normalizeDamageSource(source);
      const actor = bound && bound.actor;
      const isKnown = (candidate) => candidate && typeof candidate.instanceId === "string" && (
        this.getBall(candidate.instanceId) === candidate || this.entitySystem.get(candidate.instanceId) === candidate
      );
      if (!isKnown(actor) || !isKnown(target) || actor === target) return false;
      const opposingTeamId = targetTeamId === undefined ? target.teamId : targetTeamId;
      if (opposingTeamId === undefined || bound.teamId === opposingTeamId) return false;
      const policy = bound.targetPolicy;
      if (policy && policy.forcedTargetInstanceId && policy.forcedTargetInstanceId !== target.instanceId) return false;
      this.onCombatInteraction({ type, actorId: actor.instanceId, targetId: target.instanceId,
        teamId: bound.teamId, targetTeamId: opposingTeamId });
      return true;
    }

    tryConsumeEntity(target, entity, source = null, options = {}) {
      if (!target || target.hp <= 0 || !entity || typeof entity !== "object") return false;
      if (source && source !== target && !this.areEnemies(source, target)) return false;
      if (entity.indestructible === true) return false;
      if (this.isAbilitySealed(target)) return false;
      return this.invokeHook(target, "onBeforeEntityContact", {
        source,
        entity,
        options
      }, {
        source,
        entity,
        options
      }) === true;
    }

    applyEffect(target, definition, source = null) {
      if (!this.game) {
        throw new Error("Cannot apply an effect before creating a game");
      }
      if (!target || this.getBall(target.instanceId) !== target || !this.isBallActive(target) || target.hp <= 0) return null;
      const originSource = normalizeDamageSource(source, { kind: "skill" });
      const isSelfEffect = originSource && originSource.actor === target;
      if (originSource && !isSelfEffect && !this.areEnemies(originSource, target)) {
        return null;
      }
      if (originSource && !isSelfEffect && !this.canTarget(originSource, target)) {
        return null;
      }
      // An explicit attack-seal status (such as White Snake's DISC or Frog's
      // tongue capture) also suppresses effects already emitted by the owner.
      // Ordinary stuns do not opt in, so their independent effects keep their
      // established lifecycle.
      if (
        originSource && !isSelfEffect &&
        this.ownerBlocksEntityDamage(originSource.owner)
      ) return null;
      let effectDefinition = definition;
      if (originSource && !isSelfEffect && !this.isAbilitySealed(target)) {
        const beforeEffect = this.invokeHook(target, "onBeforeEffect", {
          source: originSource.credit,
          combatSource: originSource,
          definition
        }, definition);
        if (beforeEffect === false) return null;
        if (beforeEffect && typeof beforeEffect === "object") {
          effectDefinition = beforeEffect;
        }
      }
      let existing = target.effects.get(effectDefinition.id) || null;
      if (existing && existing.expiresAt <= this.game.time) {
        this.removeEffect(target, existing.id);
        existing = target.effects.get(effectDefinition.id) || null;
      }
      const isRefresh = Boolean(existing && existing.expiresAt > this.game.time);
      const effect = createEffectInstance(effectDefinition, this.game.time, existing);
      if (originSource) {
        effect.instanceId = effect.instanceId || `${target.instanceId}-effect-${effect.id}`;
        effect.teamId = originSource.teamId;
        effect.combatSource = createCombatSource({
          actor: effect,
          owner: originSource.owner || originSource.actor,
          credit: originSource.credit,
          teamId: originSource.teamId,
          kind: effectDefinition.combatKind || "dot",
          entity: effect,
          attackTags: effectDefinition.attackTags,
          targetPolicy: originSource.targetPolicy,
          damageOutputScale: originSource.damageOutputScale
        });
        effect.services = this.createEffectServices(effect);
      }
      target.effects.set(effect.id, effect);
      target.statusRevision = (target.statusRevision || 0) + 1;
      this.statusController.invalidate(target);
      if (effect.knockback) {
        effect.savedVx = target.storedVx;
        effect.savedVy = target.storedVy;
        effect.savedSpeed = Math.hypot(target.storedVx, target.storedVy);
      }
      this.invokeEffectHook(target, effect, "onApply", {
        source: originSource ? originSource.credit : null,
        combatSource: effect.combatSource || null,
        isRefresh
      });
      if (effect.knockback && !target.positionLocked && this.getSlowFactor(target) > UPDATE_EPSILON &&
          !this.isPhysicsMovementLocked(target) &&
          this.getCapabilities(target).canMove === false) {
        startKnockback(target, effect, this.game.time, this.isFieldPhysicsMode(), this.effectiveSpeed(target));
      }
      if (!isRefresh && isControlEffectDefinition(effectDefinition)) {
        this.playSound("status", target, { effect: effect.id });
      }
      this.refreshSpeedMultiplier(target);
      if (effect.sealsAbilities === true) this.invokeHook(target, "onAbilitySealed");
      return effect;
    }

    // Move the live instances, with their tick deadlines and remaining life.
    // This is a transfer, not expiry/reapplication: onApply must not restart a DOT.
    exchangeEffects(left, right, predicate) {
      if (!this.game || !left || !right || left === right || typeof predicate !== "function" ||
          !(left.effects instanceof Map) || !(right.effects instanceof Map)) return;
      const now = this.game.time;
      const moved = [];
      let failure = null;
      for (const [from, to] of [[left, right], [right, left]]) {
        for (const effect of Array.from(from.effects.values())) {
          if (effect.expiresAt <= now || !predicate(effect)) continue;
          const motion = from.knockbackState && from.knockbackState.effect === effect
            ? from.knockbackState : null;
          moved.push({ from, to, effect, motion });
        }
      }
      for (const { from, effect, motion } of moved) {
        from.effects.delete(effect.id);
        if (motion) {
          from.knockbackState = null;
          from.knockbackStep = null;
        }
      }
      try {
        for (const { from, to, effect, motion } of moved) {
          // Unselected same-ID effects go through normal cleanup, never a silent overwrite.
          if (to.effects.has(effect.id)) {
            try { this.removeEffect(to, effect.id); }
            catch (cause) { failure = failure || cause; }
          }
          if (effect.combatSource) {
            const previous = effect.combatSource;
            effect.teamId = from.teamId;
            effect.combatSource = createCombatSource({
              ...previous, actor: effect, entity: effect, owner: from, credit: from,
              teamId: from.teamId, targetPolicy: null, damageOutputScale: from.damageOutputScale
            });
            effect.services = this.createEffectServices(effect);
          }
          this.effectHookContexts.delete(effect);
          to.effects.set(effect.id, effect);
          if (motion) to.knockbackState = motion;
        }
        // Publish both sides before callbacks, so a reentrant query cannot see
        // only half the exchange and an error cannot orphan the other effects.
        for (const ball of [left, right]) {
          ball.statusRevision = (ball.statusRevision || 0) + 1;
          this.statusController.invalidate(ball);
          this.contactProfileCache.delete(ball);
        }
        for (const { from, to, effect } of moved) {
          try { this.invokeEffectHook(to, effect, "onTransfer", { previousBall: from }); }
          catch (cause) { failure = failure || cause; }
        }
      } finally {
        for (const ball of [left, right]) {
          ball.statusRevision = (ball.statusRevision || 0) + 1;
          this.statusController.invalidate(ball);
          this.contactProfileCache.delete(ball);
          this.refreshSpeedMultiplier(ball);
        }
      }
      if (failure) throw failure;
    }

    createEffectServices(effect) {
      return new CombatSourceServices(this, effect.combatSource);
    }

    spawnVisualEffect(definition, owner = null, overrides = {}) {
      if (!this.game) {
        throw new Error("Cannot create a visual effect before creating a game");
      }
      return this.visualEffectSystem.spawn(definition, owner, overrides);
    }

    createVisualEffect(factory, options = {}, owner = null, overrides = {}) {
      if (typeof factory !== "function") throw new TypeError("Visual effect requires a factory");
      return this.spawnVisualEffect(factory({ ...options, random: this.visualRandom }), owner, overrides);
    }

    spawnParticleBurst(options = {}, owner = null, overrides = {}) {
      // Explicit random remains available for standalone factory tests.
      const random = typeof options.random === "function" ? options.random : this.visualRandom;
      return this.spawnVisualEffect(createParticleBurst({ ...options, random }), owner, overrides);
    }

    spawnVisualComposition(entries, owner = null, overrides = {}) {
      return spawnVisualComposition(entries, (entry) => {
        if (!entry || typeof entry !== "object") throw new TypeError("Visual composition requires visual entries");
        const childOverrides = { ...overrides, ...entry.overrides };
        if (entry.factory) return this.createVisualEffect(entry.factory, entry.options, owner, childOverrides);
        if (entry.particleBurst) return this.spawnParticleBurst(entry.particleBurst, owner, childOverrides);
        return this.spawnVisualEffect(entry, owner, childOverrides);
      });
    }

    getVisualEffectStats() {
      return this.visualEffectSystem.getStats();
    }

    spawnProjectile(definition, owner) {
      const speed = Math.hypot(definition && definition.vx, definition && definition.vy);
      if (!Number.isFinite(speed) || speed <= UPDATE_EPSILON) {
        throw new TypeError("Projectile requires a finite non-zero velocity");
      }
      const projectile = this.spawnCombatEntity({
        ...definition,
        isProjectile: true,
        combatKind: "projectile"
      }, owner);
      const credit = projectile.combatSource.credit;
      const replayEvent = this.recordReplayEvent(credit, {
        type: "projectile",
        kind: definition.kind || "projectile",
        speed,
        radius: Number.isFinite(definition.radius) ? definition.radius : 3,
        life: Number.isFinite(definition.life) ? definition.life : 2,
        damage: Number.isFinite(definition.replayDamage)
          ? definition.replayDamage
          : (Number.isFinite(definition.damage) ? definition.damage : 1),
        color: definition.color || (credit && credit.color) || "#ffffff"
      });
      if (replayEvent) projectile.replayEvent = replayEvent;
      this.forEachLivingEnemy(projectile.combatSource, (target) => {
        if (this.isAbilitySealed(target) || this.isTimeFrozen(target)) return;
        this.invokeHook(target, "onEnemyProjectileSpawned", {
          projectile,
          source: credit,
          speed
        });
      }, (target) => (
        typeof (target.behavior && target.behavior.onEnemyProjectileSpawned) === "function" &&
        this.canAcquireTarget(projectile.combatSource, target)
      ));
      return projectile;
    }

    spawnCombatEntity(definition, owner, overrides = {}) {
      const requestedKind = overrides.combatKind || definition.combatKind;
      const combatKind = COMBAT_KINDS.has(requestedKind)
        ? requestedKind
        : (definition.isProjectile === true
          ? "projectile"
          : (definition.trap === true ? "trap" : "zone"));
      const entity = this.entitySystem.spawn(definition, owner, {
        ...overrides,
        combatKind
      });
      entity.services = this.createEntityServices(entity);
      const credit = entity.combatSource.credit;
      const lease = this.attackLeases.get(credit);
      if (lease && lease.donor !== credit) lease.trackEntity(entity);
      // Both projectile creation routes share audio. Do not reinterpret a held
      // weapon as a launch just because its damage kind is "projectile".
      const launchSpeed = Math.hypot(entity.vx, entity.vy);
      if (combatKind === "projectile" && Number.isFinite(launchSpeed) && launchSpeed > UPDATE_EPSILON) {
        entity.services.playSound("shoot", { speed: launchSpeed });
      }
      return entity;
    }

    updateCombatEntity(entity, dt) {
      if (entity.isProjectile === true) {
        entity.previousX = entity.x;
        entity.previousY = entity.y;
      }
      const reported = new WeakSet();
      this.entityContactReports.set(entity, reported);
      try {
        this.invokeCombatEntityHook(entity, "update", null, dt);
      } finally {
        this.entityContacts.set(entity, reported);
        this.entityContactReports.delete(entity);
      }
    }

    invokeCombatEntityHook(entity, hook, details = null, firstArg) {
      const callback = entity && entity[hook];
      if (typeof callback !== "function") return undefined;
      try {
        let context;
        if (details === null) {
          context = this.combatEntityHookContexts.get(entity);
          if (!context) {
            context = {
              entity,
              effect: entity,
              game: this.gameView(),
              services: entity.services || this.createEntityServices(entity)
            };
            this.combatEntityHookContexts.set(entity, context);
          }
        } else {
          context = {
            entity,
            effect: entity,
            game: this.gameView(),
            services: entity.services || this.createEntityServices(entity),
            ...details
          };
        }
        if (arguments.length <= 3) return callback(context);
        return callback(context, firstArg);
      } catch (cause) {
        throw new Error(`Combat entity ${entity.instanceId} failed in ${hook}`, { cause });
      }
    }

    // Detach before callbacks so cleanup can re-enter or replace the same ID.
    removeEffect(ball, id) {
      if (!ball || !(ball.effects instanceof Map)) return false;
      const effect = ball.effects.get(id);
      if (!effect) return false;
      ball.effects.delete(id);
      ball.statusRevision = (ball.statusRevision || 0) + 1;
      this.statusController.invalidate(ball);
      this.contactProfileCache.delete(ball);
      try {
        finishKnockback(ball, effect, this.effectiveSpeed(ball), this.isPhysicsMovementLocked(ball));
        this.invokeEffectHook(ball, effect, "onExpire");
      } finally {
        this.statusController.invalidate(ball);
        this.contactProfileCache.delete(ball);
        this.refreshSpeedMultiplier(ball);
      }
      return true;
    }

    updateEffects(ball, dt) {
      advanceKnockback(ball, this.game.time, dt,
        ball.positionLocked || this.isPhysicsMovementLocked(ball), this.effectiveSpeed(ball));
      if (ball.effects.size > 0) {
        for (const [id, effect] of Array.from(ball.effects.entries())) {
          if (ball.effects.get(id) !== effect) continue;
          this.invokeEffectHook(ball, effect, "update", null, dt);
          if (ball.effects.get(id) === effect && this.game.time >= effect.expiresAt) {
            this.removeEffect(ball, id);
          }
        }
      }
      // 效果增减与斜坡都由这里统一结算，减速者不需要自己还原倍率。
      this.refreshSpeedMultiplier(ball);
    }

    hasMovementLock(ball) {
      return !this.statusController.forCombatant(ball).canMove;
    }

    hasAttackBlock(ball) {
      return !this.statusController.forCombatant(ball).canBodyAttack;
    }

    isAttackBlocked(ball) {
      return !this.statusController.forCombatant(ball).canBodyAttack;
    }

    isBehaviorPaused(ball) {
      return this.behaviorPauseRemaining(ball) > UPDATE_EPSILON;
    }

    behaviorPauseRemaining(ball) {
      if (this.statusController.forCombatant(ball).canAct) return 0;
      let remaining = Infinity;
      for (const effect of ball.effects.values()) {
        if (!effect.pausesBehavior || effect.expiresAt <= this.game.time) continue;
        remaining = Math.min(remaining, effect.expiresAt - this.game.time);
      }
      return remaining === Infinity ? 0 : remaining;
    }

    hasDamageOutputBlock(ball) {
      return !this.statusController.forCombatant(ball).canDealDamage;
    }

    // 硬能力封印（如白蛇 DISC 抽出后的“行尸走肉”状态）：
    // 除物理运动/被动属性外，行为与动作钩子都不再执行
    isAbilitySealed(ball) {
      if (!ball || !(ball.effects instanceof Map)) return false;
      const now = this.game ? this.game.time : 0;
      for (const effect of ball.effects.values()) {
        if (effect && effect.expiresAt > now && effect.sealsAbilities === true) {
          return true;
        }
      }
      return false;
    }

    keepsPassiveContactReaction(ball) {
      return this.getContactProfile(ball).passiveContactReaction === true;
    }

    ownerBlocksEntityDamage(owner) {
      if (!owner || !(owner.effects instanceof Map)) return false;
      const lease = this.attackLeases.get(owner);
      if (lease && lease.donor === owner) return true;
      // A summoned actor keeps its own source, but a borrowed-away arsenal must
      // not keep attacking through its creator's pre-existing summons.
      if (owner.isSummon) {
        let ancestor = owner;
        const visited = new Set();
        while (ancestor.isSummon && !visited.has(ancestor)) {
          visited.add(ancestor);
          ancestor = this.getBall(ancestor.summonerInstanceId);
          if (!ancestor) break;
          const ancestorLease = this.attackLeases.get(ancestor);
          if (ancestorLease && ancestorLease.donor === ancestor) return true;
        }
      }
      const now = this.game ? this.game.time : 0;
      for (const effect of owner.effects.values()) {
        if (
          effect && effect.expiresAt > now &&
          effect.blocksOwnedEntityDamage === true
        ) return true;
      }
      return false;
    }

    wrapThroughWalls(ball) {
      const point = this.arena.wrapPoint(ball.x, ball.y, ball.vx, ball.vy);
      const wrappedX = Math.abs(point.x - ball.x) > UPDATE_EPSILON;
      const wrappedY = Math.abs(point.y - ball.y) > UPDATE_EPSILON;
      ball.x = point.x;
      ball.y = point.y;

      if ((wrappedX || wrappedY) && !this.isAbilitySealed(ball)) {
        this.invokeHook(ball, "onArenaWrap", { wrappedX, wrappedY });
      }
    }

    resolveStraightWallAxis(ball, axis, previousAxis, velocityAxis, storedAxis, lowBit, highBit) {
      const low = (axis === "x" ? this.arena.left : this.arena.top) + ball.radius;
      const high = (axis === "x" ? this.arena.right : this.arena.bottom) - ball.radius;
      const position = ball[axis];
      const previous = Number.isFinite(ball[previousAxis]) ? ball[previousAxis] : position;
      let contacts = ball.straightWallContacts || 0;
      if (Math.max(previous, position) > low + WALL_CONTACT_RELEASE_DISTANCE) contacts &= ~lowBit;
      if (Math.min(previous, position) < high - WALL_CONTACT_RELEASE_DISTANCE) contacts &= ~highBit;

      const side = position <= low ? lowBit : position >= high ? highBit : 0;
      let bounced = false;
      if (side) {
        ball[axis] = side === lowBit ? low : high;
        const inward = side === lowBit ? 1 : -1;
        // Boundary correction is silent; only incoming motion starts an impact.
        if (ball[velocityAxis] * inward < -UPDATE_EPSILON) {
          bounced = (contacts & side) === 0;
          ball[velocityAxis] = inward * Math.abs(ball[velocityAxis]);
          ball[storedAxis] = inward * Math.abs(ball[storedAxis] || ball[velocityAxis]);
        }
        contacts |= side;
      }
      ball.straightWallContacts = contacts;
      return bounced;
    }

    resolveCircularWall(ball) {
      const { centerX, centerY, width } = this.arena;
      const limit = Math.max(0, width / 2 - ball.radius);
      const distance = Math.hypot(ball.x - centerX, ball.y - centerY);
      const previousDistance = Math.hypot(ball.prevX - centerX, ball.prevY - centerY);
      if (Math.min(distance, previousDistance) < limit - WALL_CONTACT_RELEASE_DISTANCE) {
        ball.straightWallContacts = 0;
      }
      if (distance < limit || distance <= UPDATE_EPSILON) return false;
      let nx = (ball.x - centerX) / distance;
      let ny = (ball.y - centerY) / distance;
      // Use the first swept crossing for the reflection normal, not the end of
      // an overshot step. This matters for fast, glancing hits on curved walls.
      const dx = ball.x - ball.prevX;
      const dy = ball.y - ball.prevY;
      const travel = Math.hypot(dx, dy);
      let hitX = centerX + nx * limit;
      let hitY = centerY + ny * limit;
      let remaining = 0;
      if (previousDistance <= limit + UPDATE_EPSILON && travel > UPDATE_EPSILON) {
        const untilWall = this.arena.movementLimit(ball.prevX, ball.prevY, dx / travel, dy / travel, travel, ball.radius);
        hitX = ball.prevX + dx * untilWall / travel;
        hitY = ball.prevY + dy * untilWall / travel;
        const normalLength = Math.hypot(hitX - centerX, hitY - centerY);
        if (normalLength > UPDATE_EPSILON) {
          nx = (hitX - centerX) / normalLength;
          ny = (hitY - centerY) / normalLength;
        }
        remaining = travel - untilWall;
      }
      const outward = ball.vx * nx + ball.vy * ny;
      const hit = outward > UPDATE_EPSILON && !(ball.straightWallContacts & 16);
      if (outward > UPDATE_EPSILON) {
        ball.vx -= 2 * outward * nx;
        ball.vy -= 2 * outward * ny;
        const storedOutward = ball.storedVx * nx + ball.storedVy * ny;
        if (storedOutward > 0) {
          ball.storedVx -= 2 * storedOutward * nx;
          ball.storedVy -= 2 * storedOutward * ny;
        }
      }
      const speed = Math.hypot(ball.vx, ball.vy);
      const point = this.arena.clampPoint(
        hitX + (speed > UPDATE_EPSILON ? ball.vx / speed * remaining : 0),
        hitY + (speed > UPDATE_EPSILON ? ball.vy / speed * remaining : 0), ball.radius);
      ball.x = point.x;
      ball.y = point.y;
      ball.straightWallContacts = 16;
      return hit;
    }

    bounceFromWalls(ball) {
      if (this.getWallMode(ball) === "wrap") {
        ball.straightWallContacts = 0;
        this.wrapThroughWalls(ball);
        return;
      }
      let bouncedX = false;
      let bouncedY = false;
      const incomingVx = ball.vx;
      const incomingVy = ball.vy;
      const boundaryHit = this.arena.shape === "circle"
        ? this.arena.traceSegment(ball.prevX, ball.prevY, ball.x, ball.y, ball.radius) : null;
      if (this.isBounceMode()) {
        ({ bouncedX, bouncedY } = this.bouncePhysics.resolveWalls(ball, this.arena));
        if (this.arena.shape === "circle") {
          if (bouncedX || bouncedY) this.onBounce(ball, 0.9);
        } else {
          if (bouncedX) this.onBounce(ball, 0.7);
          if (bouncedY) this.onBounce(ball, 0.9);
        }
      } else if (this.isGyroMode()) {
        // 陀螺模式的盘壁：普通反射 + 墙平行分量重采样。场地中央是空的（没有实体、
        // 也没有绘制），小球会直接穿过重心飞到对面。
        ({ bouncedX, bouncedY } = this.gyroPhysics.resolveWalls(ball, this.arena));
        if (this.arena.shape === "circle") {
          if (bouncedX || bouncedY) this.onBounce(ball, 0.7);
        } else {
          if (bouncedX) this.onBounce(ball, 0.7);
          if (bouncedY) this.onBounce(ball, 0.7);
        }
      } else if (this.arena.shape === "circle") {
        const hit = this.resolveCircularWall(ball);
        bouncedX = hit && Math.abs(ball.vx - incomingVx) > UPDATE_EPSILON;
        bouncedY = hit && Math.abs(ball.vy - incomingVy) > UPDATE_EPSILON;
        if (hit) this.onBounce(ball, 0.7);
      } else {
        bouncedX = this.resolveStraightWallAxis(ball, "x", "prevX", "vx", "storedVx", 1, 2);
        bouncedY = this.resolveStraightWallAxis(ball, "y", "prevY", "vy", "storedVy", 4, 8);
        if (bouncedX) this.onBounce(ball, 0.7);
        if (bouncedY) this.onBounce(ball, 0.7);
      }

      if (Math.abs(ball.vx - incomingVx) > UPDATE_EPSILON ||
          Math.abs(ball.vy - incomingVy) > UPDATE_EPSILON) {
        redirectKnockback(ball, this.game.time);
      }
      if ((bouncedX || bouncedY) && !this.isAbilitySealed(ball)) {
        const wallContacts = [];
        if (this.arena.shape === "circle") {
          const point = boundaryHit || { x: ball.x, y: ball.y };
          const length = Math.hypot(point.x - this.arena.centerX, point.y - this.arena.centerY);
          const normalX = boundaryHit ? boundaryHit.normalX : (this.arena.centerX - point.x) / Math.max(length, UPDATE_EPSILON);
          const normalY = boundaryHit ? boundaryHit.normalY : (this.arena.centerY - point.y) / Math.max(length, UPDATE_EPSILON);
          wallContacts.push({ x: point.x - normalX * ball.radius, y: point.y - normalY * ball.radius, normalX, normalY });
        } else {
          if (bouncedX) wallContacts.push({
            x: ball.vx > 0 ? this.arena.left : this.arena.right, y: ball.y,
            normalX: ball.vx > 0 ? 1 : -1, normalY: 0
          });
          if (bouncedY) wallContacts.push({
            x: ball.x, y: ball.vy > 0 ? this.arena.top : this.arena.bottom,
            normalX: 0, normalY: ball.vy > 0 ? 1 : -1
          });
        }
        const target = this.getOpponent(ball);
        const wallVelocityX = ball.storedVx;
        const wallVelocityY = ball.storedVy;
        this.invokeHook(ball, "onWallBounce", {
          bouncedX,
          bouncedY,
          wallContacts,
          // 陀螺模式的盘壁不提供"起跳冲量"，小球自己的墙弹机制照常生效，
          // 所以这个标记仍然只代表弹跳模式。
          bouncePhysics: this.isBounceMode()
        }, target);
        for (const effect of ball.effects.values()) {
          if (effect.knockback && (!getKnockbackState(ball) || getKnockbackState(ball).effect !== effect)) continue;
          this.invokeEffectHook(ball, effect, "onWallBounce", {
            bouncedX,
            bouncedY,
            wallContacts,
            target
          });
        }
        if (
          this.isBounceMode() &&
          (Math.abs(ball.storedVx - wallVelocityX) > UPDATE_EPSILON ||
            Math.abs(ball.storedVy - wallVelocityY) > UPDATE_EPSILON)
        ) {
          this.bouncePhysics.adoptHeading(ball);
        }
      }
    }

    pairKey(a, b) {
      return a.instanceId < b.instanceId
        ? `${a.instanceId}|${b.instanceId}`
        : `${b.instanceId}|${a.instanceId}`;
    }

    handleBallCollisions(dt, behaviorDeltas) {
      const balls = this.game.balls;
      const previousPairs = this.game.contactPairs;
      if (this.game.wasColliding === false) previousPairs.clear();
      const activeKeys = this.game.nextContactPairs;
      activeKeys.clear();
      for (let leftIndex = 0; leftIndex < balls.length; leftIndex += 1) {
        const left = balls[leftIndex];
        if (left.hp <= 0 || !this.isBallActive(left)) continue;
        for (let rightIndex = leftIndex + 1; rightIndex < balls.length; rightIndex += 1) {
          const right = balls[rightIndex];
          if (right.hp <= 0 || !this.isBallActive(right)) continue;
          // Read live geometry for each pair: earlier contacts can move or grow
          // any body. Observers and frozen contact latches retain full dispatch.
          if (!this.timeStopActors &&
              typeof (left.behavior && left.behavior.onContactUpdate) !== "function" &&
              typeof (right.behavior && right.behavior.onContactUpdate) !== "function") {
            const dx = right.x - left.x;
            const dy = right.y - left.y;
            const radius = left.radius + right.radius;
            if (dx * dx + dy * dy >= radius * radius) continue;
          }
          this.handleBallPair(
            left,
            right,
            dt,
            previousPairs,
            activeKeys,
            behaviorDeltas
          );
        }
      }
      this.game.contactPairs = activeKeys;
      this.game.nextContactPairs = previousPairs;
      this.game.wasColliding = activeKeys.size > 0;
    }

    handleBallPair(a, b, dt, previousPairs, activeKeys, behaviorDeltas) {
      if (!this.isBallActive(a) || !this.isBallActive(b) || a.hp <= 0 || b.hp <= 0) return;
      if (this.isTimeFrozen(a) && this.isTimeFrozen(b)) {
        const frozenKey = this.pairKey(a, b);
        if (previousPairs.has(frozenKey)) activeKeys.add(frozenKey);
        return;
      }
      const enemies = this.areEnemies(a, b);
      // 召唤物不与自己的召唤者、也不与同源召唤物发生实体碰撞
      // （例如雪人的主体不会推挤自己生成的各座小雪人）
      const summonerLink = (
        (a.isSummon && a.summonerInstanceId === b.instanceId) ||
        (b.isSummon && b.summonerInstanceId === a.instanceId) ||
        (a.isSummon && b.isSummon && a.summonerInstanceId === b.summonerInstanceId)
      );
      if (summonerLink) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const minDistance = a.radius + b.radius;
      const distanceSquared = dx * dx + dy * dy;
      const overlapping = distanceSquared < minDistance * minDistance;
      const distance = overlapping ? Math.sqrt(distanceSquared) || 0.0001 : 0;
      const aTracksContact = enemies &&
        typeof (a.behavior && a.behavior.onContactUpdate) === "function" &&
        a.hp > 0 && b.hp > 0 &&
        !this.isTimeFrozen(a) &&
        (!this.isAbilitySealed(a) || this.keepsPassiveContactReaction(a)) &&
        this.canTarget(a, b);
      const bTracksContact = enemies &&
        typeof (b.behavior && b.behavior.onContactUpdate) === "function" &&
        b.hp > 0 && a.hp > 0 &&
        !this.isTimeFrozen(b) &&
        (!this.isAbilitySealed(b) || this.keepsPassiveContactReaction(b)) &&
        this.canTarget(b, a);
      if (!overlapping && !aTracksContact && !bTracksContact) return;
      const aContact = this.getContactProfile(a);
      const bContact = this.getContactProfile(b);

      if (a.isReplayActor || b.isReplayActor) {
        this.handleReplayPair(
          a,
          b,
          { enemies, dx, dy, distance, minDistance, overlapping, aContact, bContact },
          dt,
          previousPairs,
          activeKeys
        );
        return;
      }

      if (aTracksContact) {
        this.invokeHook(a, "onContactUpdate", {
          overlapping,
          selfContact: aContact,
          targetContact: bContact
        }, b, behaviorDeltas && behaviorDeltas.has(a)
          ? behaviorDeltas.get(a) : this.combatantActionDelta(a, dt));
      }
      if (bTracksContact) {
        this.invokeHook(b, "onContactUpdate", {
          overlapping,
          selfContact: bContact,
          targetContact: aContact
        }, a, behaviorDeltas && behaviorDeltas.has(b)
          ? behaviorDeltas.get(b) : this.combatantActionDelta(b, dt));
      }

      const physicalContact = aContact.solid && bContact.solid;
      // bodyContact 让没有碰撞体的目标也能被接触攻击：只要某一方显式声明，
      // 且另一方仍是可被打到的目标即可。不能要求攻击者自身 attackable——
      // 飞行中的羽毛球这类"实心但不可索敌"的攻击者本来就能撞出伤害。
      const nonPhysicalBodyContact = enemies &&
        (aContact.bodyContact === true || bContact.bodyContact === true) &&
        (aContact.attackable !== false || bContact.attackable !== false);
      if (!overlapping || (!physicalContact && !nonPhysicalBodyContact)) {
        return;
      }

      const key = this.pairKey(a, b);
      activeKeys.add(key);

      const nx = dx / distance;
      const ny = dy / distance;
      const overlap = minDistance - distance;
      a.preHitVx = a.vx;
      a.preHitVy = a.vy;
      b.preHitVx = b.vx;
      b.preHitVy = b.vy;
      if (physicalContact) {
        this.resolveOverlap(a, b, nx, ny, overlap);
        this.resolveVelocities(a, b, nx, ny);
      }

      if (enemies && !previousPairs.has(key)) {
        const contactEventA = createContactEvent({
          actor: a, target: b, overlapping, normalX: dx / distance,
          normalY: dy / distance, penetration: minDistance - distance, distance
        });
        const contactEventB = createContactEvent({
          actor: b, target: a, overlapping, normalX: -dx / distance,
          normalY: -dy / distance, penetration: minDistance - distance, distance
        });
        const aBlockedAtContact = this.isAttackBlocked(a);
        const bBlockedAtContact = this.isAttackBlocked(b);
        // Both attacks belong to this contact. A lethal first hit must not
        // cancel the other participant's already-triggered collision hook.
        const aCanCollide = a.hp > 0 && b.hp > 0 && this.canTarget(a, b) && !this.isAbilitySealed(a) && !this.isTimeFrozen(a);
        const bCanCollide = b.hp > 0 && a.hp > 0 && this.canTarget(b, a) && !this.isAbilitySealed(b) && !this.isTimeFrozen(b);
        if (aCanCollide) {
          const source = normalizeDamageSource(a, { kind: "body", contact: contactEventA });
          this.invokeHook(a, "onCollision", {
            blockedAtContact: aBlockedAtContact,
            contact: contactEventA,
            combatSource: source,
            services: new CombatSourceServices(this, source)
          }, b);
          for (const effect of this.timeStopActors ? [] : Array.from(a.effects.values())) {
            this.invokeEffectHook(a, effect, "onCollision", {
              blockedAtContact: aBlockedAtContact,
              contact: contactEventA,
              combatSource: source
            }, b);
          }
        }
        if (bCanCollide) {
          const source = normalizeDamageSource(b, { kind: "body", contact: contactEventB });
          this.invokeHook(b, "onCollision", {
            blockedAtContact: bBlockedAtContact,
            contact: contactEventB,
            combatSource: source,
            services: new CombatSourceServices(this, source)
          }, a);
          for (const effect of this.timeStopActors ? [] : Array.from(b.effects.values())) {
            this.invokeEffectHook(b, effect, "onCollision", {
              blockedAtContact: bBlockedAtContact,
              contact: contactEventB,
              combatSource: source
            }, a);
          }
        }
      }
    }

    handleReplayPair(a, b, contact, dt, previousPairs, activeKeys) {
      const replay = a.isReplayActor ? a : b;
      const target = replay === a ? b : a;
      if (
        !contact.enemies || target.instanceId !== replay.replayTargetInstanceId ||
        !(this.isTimeFrozen(replay) ? this.canTarget(target, replay) : this.canTarget(replay, target))
      ) return;

      const replayContact = replay === a ? contact.aContact : contact.bContact;
      const targetContact = replay === a ? contact.bContact : contact.aContact;
      if (replay.hp > 0 && target.hp > 0 && !this.isTimeFrozen(replay)) {
        this.invokeHook(replay, "onContactUpdate", {
          overlapping: contact.overlapping,
          selfContact: replayContact,
          targetContact
        }, target, dt);
      }
      if (
        !contact.overlapping || !contact.aContact.solid || !contact.bContact.solid
      ) return;

      const key = this.pairKey(a, b);
      activeKeys.add(key);
      const nx = contact.dx / contact.distance;
      const ny = contact.dy / contact.distance;
      const overlap = contact.minDistance - contact.distance;
      this.resolveOverlap(a, b, nx, ny, overlap);
      this.resolveVelocities(a, b, nx, ny);
      if (!previousPairs.has(key) && replay.hp > 0 && target.hp > 0 && !this.isTimeFrozen(replay)) {
        const direction = replay === a ? 1 : -1;
        const contactEvent = createContactEvent({
          actor: replay,
          target,
          overlapping: contact.overlapping,
          normalX: direction * contact.dx / contact.distance,
          normalY: direction * contact.dy / contact.distance,
          penetration: contact.minDistance - contact.distance,
          distance: contact.distance
        });
        const source = normalizeDamageSource(replay, {
          kind: "body",
          contact: contactEvent
        });
        this.invokeHook(replay, "onCollision", {
          blockedAtContact: this.isAttackBlocked(replay),
          contact: contactEvent,
          combatSource: source,
          services: new CombatSourceServices(this, source)
        }, target);
      }
    }

    overlapMovementLimit(ball, nx, ny, distance) {
      if (ball.positionLocked || this.isPhysicsMovementLocked(ball)) return 0;
      if (this.getWallMode(ball) === "wrap") return distance;
      return this.arena.movementLimit(ball.x, ball.y, nx, ny, distance, ball.radius);
    }

    resolveOverlap(a, b, nx, ny, overlap) {
      if (!this.isFieldPhysicsMode()) {
        // Transfer correction blocked by a wall/lock to the other body.
        const aLimit = this.overlapMovementLimit(a, -nx, -ny, overlap);
        const bLimit = this.overlapMovementLimit(b, nx, ny, overlap);
        let aMove = Math.min(overlap * 0.5, aLimit);
        const bMove = Math.min(overlap - aMove, bLimit);
        aMove = Math.min(overlap - bMove, aLimit);
        a.x -= nx * aMove;
        a.y -= ny * aMove;
        b.x += nx * bMove;
        b.y += ny * bMove;
        return;
      }
      const aLocked = this.isPhysicsMovementLocked(a);
      const bLocked = this.isPhysicsMovementLocked(b);

      if (aLocked && !bLocked) {
        b.x += nx * overlap;
        b.y += ny * overlap;
      } else if (bLocked && !aLocked) {
        a.x -= nx * overlap;
        a.y -= ny * overlap;
      } else if (!aLocked && !bLocked) {
        a.x -= nx * overlap * 0.5;
        a.y -= ny * overlap * 0.5;
        b.x += nx * overlap * 0.5;
        b.y += ny * overlap * 0.5;
      }
    }

    resolveVelocities(a, b, nx, ny) {
      const straight = !this.isFieldPhysicsMode();
      const aLocked = this.isPhysicsMovementLocked(a);
      const bLocked = this.isPhysicsMovementLocked(b);
      if (aLocked && bLocked) return;

      if (aLocked || bLocked) {
        const mover = aLocked ? b : a;
        const sign = mover === a ? 1 : -1;
        const dot = mover.vx * nx * sign + mover.vy * ny * sign;
        const impact = dot > UPDATE_EPSILON;
        if (straight && !impact) {
          mover.storedVx = mover.vx;
          mover.storedVy = mover.vy;
          return;
        }
        mover.vx -= 2 * dot * nx * sign;
        mover.vy -= 2 * dot * ny * sign;
        if (this.isBounceMode()) {
          this.bouncePhysics.commitVelocity(mover);
          this.bouncePhysics.adoptHeading(mover);
        } else if (this.isGyroMode()) {
          this.gyroPhysics.commitVelocity(mover);
        } else {
          mover.storedVx = mover.vx;
          mover.storedVy = mover.vy;
        }
        if (impact) this.onBounce(mover, 0.9);
        redirectKnockback(mover, this.game.time);
        return;
      }

      const tx = -ny;
      const ty = nx;
      const aNormal = a.vx * nx + a.vy * ny;
      const aTangent = a.vx * tx + a.vy * ty;
      const bNormal = b.vx * nx + b.vy * ny;
      const bTangent = b.vx * tx + b.vy * ty;
      const impact = aNormal - bNormal > UPDATE_EPSILON;
      if (straight && !impact) return;
      a.vx = bNormal * nx + aTangent * tx;
      a.vy = bNormal * ny + aTangent * ty;
      b.vx = aNormal * nx + bTangent * tx;
      b.vy = aNormal * ny + bTangent * ty;
      if (this.isBounceMode()) {
        this.bouncePhysics.commitVelocity(a);
        this.bouncePhysics.commitVelocity(b);
        this.bouncePhysics.adoptHeading(a);
        this.bouncePhysics.adoptHeading(b);
      } else if (this.isGyroMode()) {
        // 陀螺模式保留碰撞后的真实速度：把速度归一化回 150 会把刚被盘心甩出来的
        // 高速轨迹抹平，那种"陀螺对撞"就没了。
        this.gyroPhysics.commitVelocity(a);
        this.gyroPhysics.commitVelocity(b);
      } else {
        this.normalizeVelocity(a);
        this.normalizeVelocity(b);
      }
      if (impact) this.onBounce(a, 1);
      redirectKnockback(a, this.game.time);
      redirectKnockback(b, this.game.time);
    }

    normalizeVelocity(ball) {
      if (getKnockbackState(ball)) {
        ball.storedVx = ball.vx;
        ball.storedVy = ball.vy;
        return;
      }
      const magnitude = Math.hypot(ball.vx, ball.vy);
      if (magnitude <= 0.001) return;
      const speed = this.effectiveSpeed(ball);
      ball.vx = (ball.vx / magnitude) * speed;
      ball.vy = (ball.vy / magnitude) * speed;
      ball.storedVx = ball.vx;
      ball.storedVy = ball.vy;
      ball.speedNeedsNormalization = false;
    }

    playBounce(source, intensity = 1) {
      this.onBounce(source, intensity);
    }

    playSound(type, subject, detail = {}) {
      try {
        // Callers describe presentation, never override the bound attribution.
        this.onSound({ ...detail, type, subject });
      } catch (_error) {
        // Sound is presentation and must never break the simulation loop.
      }
    }

    shakeArena(options = {}) {
      return this.arenaShake.trigger(options);
    }

    getArenaShakeOffset() {
      return this.arenaShake.getOffset();
    }

    getArenaShakeState() {
      return this.arenaShake.getState();
    }

    getBallDamageFlashAlpha(ball, time = this.game ? this.game.time : 0) {
      return this.damageFlash.getAlpha(ball, time);
    }

    getBallDamageFlashState(ball, time = this.game ? this.game.time : 0) {
      return this.damageFlash.getState(ball, time);
    }

    spawnHitText(x, y, text, options = {}) {
      if (!this.game) return;
      this.game.hitEffects.push({
        x,
        y,
        text,
        color: options.color,
        age: 0,
        life: HIT_EFFECT_LIFE
      });
    }

    updateHitEffects(dt) {
      const effects = this.game.hitEffects;
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < effects.length; readIndex += 1) {
        const effect = effects[readIndex];
        effect.age += dt;
        effect.y -= 32 * dt;
        if (effect.age < effect.life) {
          effects[writeIndex] = effect;
          writeIndex += 1;
        }
      }
      effects.length = writeIndex;
    }

    notifyNewDeaths() {
      for (const ball of this.game.balls) {
        if (ball.hp > 0 || ball.deathNotified || !this.isBallActive(ball)) continue;
        ball.hp = 0;
        ball.deathNotified = true;
        ball.diedAt = this.game.time;
        ball.vx = 0;
        ball.vy = 0;
        ball.storedVx = 0;
        ball.storedVy = 0;
        this.invokeHook(ball, "onDeath", { winner: this.getOpponent(ball) });
        this.playSound("death", ball);
      }
    }

    updateDeathFades() {
      for (const ball of this.game.balls) {
        if (ball.diedAt === null || ball.fade <= 0) continue;
        ball.fade = clamp(
          1 - (this.game.time - ball.diedAt) / LOSER_FADE_DURATION,
          0,
          1
        );
      }
    }

    checkWinner() {
      const modeController = this.activeModeController();
      if (modeController && typeof modeController.checkWinner === "function") {
        const result = modeController.checkWinner();
        if (result) {
          this.endBattle(result.winnerTeam || null, result.loserTeam || null, result.winner || null);
        }
        return;
      }
      if (modeController) {
        const survivorTeam = this.game.teams[0];
        if (this.teamHasLivingCombatant(survivorTeam)) return;
        this.endBattle(this.game.teams[1], survivorTeam);
        return;
      }
      const livingTeams = this.game.teams.filter(team => this.teamHasLivingCombatant(team));
      if (livingTeams.length > 1) return;
      const winnerTeam = livingTeams[0] || null;
      this.endBattle(winnerTeam, winnerTeam ? this.game.teams.find(team => team !== winnerTeam) : null);
    }

    endBattle(winnerTeam, loserTeam, winner = null) {
      this.game.state = "ended";
      for (const ball of this.game.balls) this.invokeHook(ball, "onBattleEnd");
      for (const ball of this.game.balls) {
        const lease = this.attackLeases.get(ball);
        if (lease) lease.release();
      }
      this.game.endedAt = this.game.time;
      this.game.winnerTeam = winnerTeam;
      this.game.loserTeam = loserTeam;
      this.game.winner = winner || (
        winnerTeam && winnerTeam.balls.length === 1 ? winnerTeam.balls[0] : null
      );
      this.game.loser = loserTeam && loserTeam.balls.length === 1 ? loserTeam.balls[0] : null;
      this.game.balls.forEach((ball) => {
        ball.hp = Math.max(0, ball.hp);
        ball.vx = 0;
        ball.vy = 0;
        ball.storedVx = 0;
        ball.storedVy = 0;
      });
    }

    teamHasLivingCombatant(team) {
      const runtimeBalls = this.game.ballsByTeamId.get(team.id) || team.balls;
      return runtimeBalls.some((ball) => (
        this.isBallActive(ball) && ball.hp > 0 && (
          !ball.isSummon ||
          (Boolean(ball.definition) && ball.definition.summonsCountForTeamSurvival === true)
        )
      ));
    }

    runtimeBallsOfTeam(team) {
      return this.game.ballsByTeamId.get(team.id) || team.balls;
    }

    // 剩余血量评分：队伍当前总血量 / 开战时冻结的队伍设定总血量。
    teamHpScore(team) {
      let hp = 0;
      let initialMaxHp = 0;
      for (const ball of this.runtimeBallsOfTeam(team)) {
        const currentHp = Math.max(0, ball.hp);
        const limit = Number.isFinite(ball.initialMaxHp) && ball.initialMaxHp > 0
          ? ball.initialMaxHp
          : (Number.isFinite(ball.maxHp) && ball.maxHp > 0 ? ball.maxHp : currentHp);
        hp += currentHp;
        initialMaxHp += limit;
      }
      return {
        hp,
        maxHp: initialMaxHp,
        ratio: initialMaxHp > 0 ? hp / initialMaxHp : 0
      };
    }

    // 直接判定：双方迟迟分不出胜负（或玩家主动叫停）时按剩余血量百分比判胜。
    // 判负方不触发 onDeath，只做"败者淡出"，这样复活 / 召唤类机制不会把判负
    // 结果翻回来，allLoserFadesComplete() 也能正常推进（锦标赛轮询依赖它）。
    resolveByHp() {
      if (!this.game || this.game.state !== "running") return null;
      const teams = this.game.teams;
      if (!Array.isArray(teams) || teams.length === 0) return null;

      let winnerTeam = null;
      let winnerScore = null;
      for (const team of teams) {
        const score = this.teamHpScore(team);
        if (winnerScore === null || score.ratio > winnerScore.ratio) {
          winnerTeam = team;
          winnerScore = score;
        }
      }
      if (!winnerTeam || winnerScore === null) return null;

      const loserTeams = teams.filter((team) => team !== winnerTeam);
      const winnerBall = winnerTeam.balls.length === 1 ? winnerTeam.balls[0] : null;
      this.endBattle(winnerTeam, loserTeams[0] || null, winnerBall);
      for (const loserTeam of loserTeams) {
        for (const ball of this.runtimeBallsOfTeam(loserTeam)) {
          if (ball.hp <= 0 || ball.deathNotified) continue;
          ball.deathNotified = true;
          ball.diedAt = this.game.time;
        }
      }
      return {
        winnerTeamId: winnerTeam.id,
        winnerBallId: winnerBall ? winnerBall.id : null,
        winnerHp: winnerScore.hp,
        winnerMaxHp: winnerScore.maxHp
      };
    }

    allLoserFadesComplete() {
      if (!this.game || this.game.state !== "ended") return false;
      // A draw has no loserTeam, but both defeated bodies still need their
      // fade. UI and recording share this completion contract.
      if (!this.game.loserTeam) {
        return this.game.balls.every((ball) => ball.diedAt === null || ball.fade <= 0);
      }
      if (this.game.teams.length > 2) {
        return this.game.balls.every(ball => ball.teamId === this.game.winnerTeam.id ||
          (ball.isSummon && !ball.definition.summonsCountForTeamSurvival) ||
          (ball.active === false && ball.hp > 0) || ball.fade <= 0);
      }
      const runtimeBalls = this.game.ballsByTeamId.get(this.game.loserTeam.id) ||
        this.game.loserTeam.balls;
      return runtimeBalls.every((ball) => (
        (
          ball.isSummon &&
          !(Boolean(ball.definition) && ball.definition.summonsCountForTeamSurvival === true)
        ) || (ball.active === false && ball.hp > 0) || ball.fade <= 0
      ));
    }
  }

  return {
    BattleEngine,
    MAX_FRAME_CATCH_UP_SECONDS,
    MAX_SIMULATION_STEP_SECONDS,
    advanceSimulation
  };
});
