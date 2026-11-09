(function initializeZombieHellMode(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("./zombie-mode.js"),
        ...require("./damage-reduction.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createZombieHellModeApi(dependencies) {
  "use strict";

  const {
    ZOMBIE_MODE_CONSTANTS,
    MEDICAL_BALL_DEFINITION,
    applyDamageReduction,
    isTrueDamage
  } = dependencies;

  const ZOMBIE_HELL_MODE_ID = "zombiehell";
  const HELL_ARENA_SIZE = 400;
  const HELL_ROUND_SECONDS = 6;
  const HELL_DEMON_SPAWN_INTERVAL_SECONDS = 3;
  const HELL_MEDICAL_INTERVAL_SECONDS = 12;

  const HELL_GRID_SIZE = 20;
  const HELL_BLOCK_SIZE = 20;
  const HELL_CELL_COUNT = HELL_GRID_SIZE * HELL_GRID_SIZE;

  const HELL_LAVA_COVERAGE = 0.2;
  const HELL_LAVA_TICK_SECONDS = 0.4;
  const HELL_LAVA_DAMAGE = 1;
  const HELL_LAVA_TRANSITION_SECONDS = 0.8;

  const HELL_DEMON_RADIUS = 10;
  const HELL_DEMON_COLOR = "#ff2a1f";
  const HELL_DEMON_BASE_COLLISION_DAMAGE = 1;
  const HELL_DEMON_HEAVY_COLLISION_DAMAGE = 2;
  const HELL_DEMON_BASE_BULLET_DAMAGE = 1;
  const HELL_DEMON_HEAVY_BULLET_DAMAGE = 2;
  const HELL_DEMON_BULLET_INTERVAL_SECONDS = 3;
  const HELL_DEMON_BULLET_SPEED = 450;
  const HELL_DEMON_BULLET_RADIUS = 3;
  const HELL_DEMON_BULLET_LIFE = 2;
  const HELL_FLAME_BULLET_COLOR = "#ff3b1f";
  const HELL_FLAME_CORE_COLOR = "#ffd27a";

  const HELL_MEDICAL_BALL_HEALING = 10;

  const HELL_NETHER_ALPHA = 0.34;
  const HELL_LAVA_ALPHA = 0.62;
  const NETHER_PALETTE = Object.freeze([
    Object.freeze([66, 17, 13]),
    Object.freeze([78, 20, 15]),
    Object.freeze([56, 14, 11]),
    Object.freeze([88, 23, 16]),
    Object.freeze([70, 18, 14]),
    Object.freeze([49, 12, 10])
  ]);
  const LAVA_BASE_COLOR = Object.freeze([255, 104, 32]);
  const LAVA_GLOW_COLOR = Object.freeze([255, 160, 64]);

  const EPSILON = 1e-9;

  const ZOMBIE_HELL_MODE_CONSTANTS = Object.freeze({
    modeId: ZOMBIE_HELL_MODE_ID,
    arenaSize: HELL_ARENA_SIZE,
    roundSeconds: HELL_ROUND_SECONDS,
    demonSpawnIntervalSeconds: HELL_DEMON_SPAWN_INTERVAL_SECONDS,
    medicalIntervalSeconds: HELL_MEDICAL_INTERVAL_SECONDS,
    gridSize: HELL_GRID_SIZE,
    blockSize: HELL_BLOCK_SIZE,
    cellCount: HELL_CELL_COUNT,
    lavaCoverage: HELL_LAVA_COVERAGE,
    lavaTickSeconds: HELL_LAVA_TICK_SECONDS,
    lavaDamage: HELL_LAVA_DAMAGE,
    lavaTransitionSeconds: HELL_LAVA_TRANSITION_SECONDS,
    demonRadius: HELL_DEMON_RADIUS,
    demonColor: HELL_DEMON_COLOR,
    demonMinSpeed: ZOMBIE_MODE_CONSTANTS.zombieMinSpeed,
    demonMaxSpeed: ZOMBIE_MODE_CONSTANTS.zombieMaxSpeed,
    demonAttractionSpeed: ZOMBIE_MODE_CONSTANTS.zombieAttractionSpeed,
    demonContactReleaseSeconds: ZOMBIE_MODE_CONSTANTS.zombieContactReleaseSeconds,
    demonBaseCollisionDamage: HELL_DEMON_BASE_COLLISION_DAMAGE,
    demonHeavyCollisionDamage: HELL_DEMON_HEAVY_COLLISION_DAMAGE,
    demonBaseBulletDamage: HELL_DEMON_BASE_BULLET_DAMAGE,
    demonHeavyBulletDamage: HELL_DEMON_HEAVY_BULLET_DAMAGE,
    demonBulletIntervalSeconds: HELL_DEMON_BULLET_INTERVAL_SECONDS,
    demonBulletSpeed: HELL_DEMON_BULLET_SPEED,
    demonBulletRadius: HELL_DEMON_BULLET_RADIUS,
    demonBulletLife: HELL_DEMON_BULLET_LIFE,
    medicalBallHealing: HELL_MEDICAL_BALL_HEALING,
    netherAlpha: HELL_NETHER_ALPHA,
    lavaAlpha: HELL_LAVA_ALPHA
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeRound(round) {
    return Math.max(1, Math.floor(Number.isFinite(round) ? round : 1));
  }

  function hellRoundAt(elapsedSeconds) {
    const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
    return Math.floor(elapsed / HELL_ROUND_SECONDS) + 1;
  }

  function hellRoundForSpawn(spawnTime) {
    return hellRoundAt(spawnTime);
  }

  function hellLavaCoverage(_round) {
    return HELL_LAVA_COVERAGE;
  }

  function hellLavaTickSeconds(_round) {
    return HELL_LAVA_TICK_SECONDS;
  }

  function hellLavaDamage(_round) {
    return HELL_LAVA_DAMAGE;
  }

  function hellDemonDamageReduction(round) {
    const normalized = normalizeRound(round);
    if (normalized <= 1) return 0;
    if (normalized === 2) return 0.5;
    return 0.9;
  }

  function hellDemonDodgeChance(round) {
    const normalized = normalizeRound(round);
    if (normalized < 4) return 0;
    if (normalized === 4) return 0.5;
    return 0.9;
  }

  function hellDemonCollisionDamage(round) {
    return normalizeRound(round) >= 6
      ? HELL_DEMON_HEAVY_COLLISION_DAMAGE
      : HELL_DEMON_BASE_COLLISION_DAMAGE;
  }

  function hellDemonBulletDamage(round) {
    return normalizeRound(round) >= 7
      ? HELL_DEMON_HEAVY_BULLET_DAMAGE
      : HELL_DEMON_BASE_BULLET_DAMAGE;
  }

  // Demons per three-second window and demon HP share the same strength
  // curve: floor(sqrt(round)). Spawning is averaged over the window like the
  // classic Zombie mode instead of releasing one batch at the interval edge.
  function hellDemonStrength(round) {
    const normalized = normalizeRound(round);
    return Math.max(1, Math.floor(Math.sqrt(normalized) + EPSILON));
  }

  function hellDemonSpawnRate(round) {
    return hellDemonStrength(round) / HELL_DEMON_SPAWN_INTERVAL_SECONDS;
  }

  function hellDemonSpawnInterval(round) {
    return HELL_DEMON_SPAWN_INTERVAL_SECONDS / hellDemonStrength(round);
  }

  function hellCellHash(column, row) {
    let value = (column * 0x9E3779B1) ^ (row * 0x85EBCA6B);
    value = Math.imul(value ^ (value >>> 13), 0x7FEB352D);
    value ^= value >>> 16;
    return (value >>> 0) / 0x100000000;
  }

  function lerpChannel(start, end, progress) {
    return Math.round(start + (end - start) * progress);
  }

  function lerpColor(start, end, progress) {
    return `rgb(${lerpChannel(start[0], end[0], progress)}, ` +
      `${lerpChannel(start[1], end[1], progress)}, ` +
      `${lerpChannel(start[2], end[2], progress)})`;
  }

  function createHellCells() {
    return Array.from({ length: HELL_CELL_COUNT }, (_unused, index) => {
      const column = index % HELL_GRID_SIZE;
      const row = Math.floor(index / HELL_GRID_SIZE);
      const seed = hellCellHash(column, row);
      const netherColor = NETHER_PALETTE[
        Math.floor(seed * NETHER_PALETTE.length) % NETHER_PALETTE.length
      ];
      return {
        index,
        column,
        row,
        x: column * HELL_BLOCK_SIZE,
        y: row * HELL_BLOCK_SIZE,
        seed,
        netherColor,
        lavaPulse: seed * Math.PI * 2,
        lava: false,
        transitionStartedAt: null
      };
    });
  }

  function selectHellLavaIndices(total, count, random) {
    const safeTotal = Math.max(0, Math.floor(total));
    const safeCount = clamp(Math.floor(Number.isFinite(count) ? count : 0), 0, safeTotal);
    const indices = Array.from({ length: safeTotal }, (_unused, index) => index);
    for (let index = safeTotal - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const temporary = indices[index];
      indices[index] = indices[swapIndex];
      indices[swapIndex] = temporary;
    }
    return indices.slice(0, safeCount);
  }

  function cellTransitionProgress(cell, time) {
    if (!Number.isFinite(cell.transitionStartedAt)) return 1;
    return clamp(
      (time - cell.transitionStartedAt) / HELL_LAVA_TRANSITION_SECONDS,
      0,
      1
    );
  }

  function lavaColorAt(cell, time) {
    const wave = 0.5 + 0.5 * Math.sin(time * 2.2 + cell.lavaPulse);
    return lerpColor(LAVA_BASE_COLOR, LAVA_GLOW_COLOR, wave * 0.45);
  }

  function cellDisplayColor(cell, time) {
    const nether = `rgb(${cell.netherColor.join(", ")})`;
    const lava = lavaColorAt(cell, time);
    if (cell.lava) {
      const progress = cellTransitionProgress(cell, time);
      return progress >= 1 ? lava : lerpColor(cell.netherColor, LAVA_BASE_COLOR, progress);
    }
    if (!Number.isFinite(cell.transitionStartedAt)) return nether;
    const progress = cellTransitionProgress(cell, time);
    return progress >= 1 ? nether : lerpColor(LAVA_BASE_COLOR, cell.netherColor, progress);
  }

  function cellDisplayAlpha(cell, time) {
    const targetAlpha = cell.lava ? HELL_LAVA_ALPHA : HELL_NETHER_ALPHA;
    const oppositeAlpha = cell.lava ? HELL_NETHER_ALPHA : HELL_LAVA_ALPHA;
    const progress = cellTransitionProgress(cell, time);
    const alpha = oppositeAlpha + (targetAlpha - oppositeAlpha) * progress;
    if (!cell.lava) return alpha;
    return alpha + (progress >= 1 ? 0.1 * Math.sin(time * 3 + cell.lavaPulse) : 0);
  }

  function drawHellBackdrop(entity, context) {
    if (!entity || !entity.cells || !context) return;
    const time = typeof entity.getTime === "function" ? entity.getTime() : 0;
    context.save();
    for (const cell of entity.cells) {
      context.globalAlpha = cellDisplayAlpha(cell, time);
      context.fillStyle = cellDisplayColor(cell, time);
      context.fillRect(
        cell.x + 0.4,
        cell.y + 0.4,
        HELL_BLOCK_SIZE - 0.8,
        HELL_BLOCK_SIZE - 0.8
      );
    }
    context.restore();
  }

  function aimAt(source, target) {
    let directionX = target.x - source.x;
    let directionY = target.y - source.y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = source.storedVx || source.vx || 1;
      directionY = source.storedVy || source.vy || 0;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return {
      x: directionX / magnitude,
      y: directionY / magnitude
    };
  }

  function drawHellFlameBullet(bullet, context) {
    if (!bullet || !context) return;
    context.save();
    context.globalAlpha *= 0.95;
    context.globalCompositeOperation = "lighter";
    context.fillStyle = HELL_FLAME_BULLET_COLOR;
    context.beginPath();
    context.arc(
      Math.round(bullet.x),
      Math.round(bullet.y),
      bullet.radius + 1.5,
      0,
      Math.PI * 2
    );
    context.fill();
    context.fillStyle = HELL_FLAME_CORE_COLOR;
    context.beginPath();
    context.arc(
      Math.round(bullet.x),
      Math.round(bullet.y),
      Math.max(1, bullet.radius * 0.55),
      0,
      Math.PI * 2
    );
    context.fill();
    context.restore();
  }

  function createHellFlameBullet(source, target) {
    const direction = aimAt(source, target);
    return {
      kind: "zombie-hell-flame-bullet",
      life: HELL_DEMON_BULLET_LIFE,
      radius: HELL_DEMON_BULLET_RADIUS,
      damage: Number.isFinite(source.bulletDamage)
        ? source.bulletDamage
        : HELL_DEMON_BASE_BULLET_DAMAGE,
      color: HELL_FLAME_BULLET_COLOR,
      x: source.x,
      y: source.y,
      vx: direction.x * HELL_DEMON_BULLET_SPEED,
      vy: direction.y * HELL_DEMON_BULLET_SPEED,
      update({ effect, game, services }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const targetHit = services.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          effect.radius
        );
        if (targetHit && services.dealDamage(targetHit, effect.damage)) {
          effect.life = 0;
          return;
        }
        if (
          effect.x < -effect.radius || effect.x > game.arenaSize + effect.radius ||
          effect.y < -effect.radius || effect.y > game.arenaSize + effect.radius
        ) {
          effect.life = 0;
        }
      },
      draw(context, canvasContext) {
        drawHellFlameBullet(context.entity || context.effect, canvasContext);
      }
    };
  }

  const HELL_DEMON_DEFINITION = Object.freeze({
    id: "zombie-hell-demon",
    name: "\u6076\u9b54",
    englishName: "Hell Demon",
    color: HELL_DEMON_COLOR,
    description: "\u7ea2\u8272\u6076\u9b54 / 3\u79d2\u706b\u7130\u5f39 / \u78b0\u649e\u4f24\u5bb3",
    stats: Object.freeze({
      radius: HELL_DEMON_RADIUS,
      speed: ZOMBIE_MODE_CONSTANTS.zombieSpeed,
      maxHp: 1
    }),
    createBehavior(services) {
      let shotTimer = 0;

      return {
        update(context, dt) {
          const demon = context.ball;
          shotTimer += Math.max(0, Number.isFinite(dt) ? dt : 0);
          while (shotTimer + EPSILON >= HELL_DEMON_BULLET_INTERVAL_SECONDS) {
            shotTimer -= HELL_DEMON_BULLET_INTERVAL_SECONDS;
            const target = services.getOpponent();
            if (target) {
              services.spawnProjectile(createHellFlameBullet(demon, target));
            }
          }
        },
        onCollision(context, target) {
          const demon = context.ball;
          demon.attractionCooldown = Math.max(
            demon.attractionCooldown || 0,
            ZOMBIE_MODE_CONSTANTS.zombieContactReleaseSeconds
          );
          let awayX = demon.x - target.x;
          let awayY = demon.y - target.y;
          let distance = Math.hypot(awayX, awayY);
          if (distance <= EPSILON) {
            awayX = demon.preHitVx || demon.storedVx || 1;
            awayY = demon.preHitVy || demon.storedVy || 0;
            distance = Math.hypot(awayX, awayY) || 1;
          }
          const speed = demon.speed * demon.speedMultiplier;
          demon.vx = demon.storedVx = awayX / distance * speed;
          demon.vy = demon.storedVy = awayY / distance * speed;
          demon.speedNeedsNormalization = false;
          if (!context.blockedAtContact) {
            context.services.dealDamage(
              target,
              Number.isFinite(demon.collisionDamage)
                ? demon.collisionDamage
                : HELL_DEMON_BASE_COLLISION_DAMAGE
            );
          }
        },
        onBeforeDamage(context, event) {
          const demon = context.ball;
          const random = typeof demon.hellRandom === "function"
            ? demon.hellRandom
            : Math.random;
          const dodgeChance = Number.isFinite(demon.dodgeChance)
            ? demon.dodgeChance
            : 0;
          if (!isTrueDamage(event) && dodgeChance > 0 && random() < dodgeChance) {
            context.services.spawnHitText(demon, "MISS", { color: "#ffe08a" });
            return { cancelAttack: true };
          }
          const reduction = Number.isFinite(demon.damageReduction)
            ? demon.damageReduction
            : 0;
          return applyDamageReduction(event, reduction, random);
        }
      };
    }
  });

  function circleTouchesCell(cell, x, y, radius) {
    const nearestX = clamp(x, cell.x, cell.x + HELL_BLOCK_SIZE);
    const nearestY = clamp(y, cell.y, cell.y + HELL_BLOCK_SIZE);
    const deltaX = x - nearestX;
    const deltaY = y - nearestY;
    return deltaX * deltaX + deltaY * deltaY <= radius * radius + EPSILON;
  }

  class ZombieHellModeController {
    constructor({
      engine,
      game,
      random = Math.random,
      arenaSize = HELL_ARENA_SIZE,
      playerTeamId = null,
      hordeTeamId = null
    } = {}) {
      if (!engine || !game) {
        throw new TypeError("Zombie Hell mode requires an engine and game");
      }
      if (typeof random !== "function") {
        throw new TypeError("Zombie Hell mode random source must be a function");
      }
      if (!Number.isFinite(arenaSize) || arenaSize <= HELL_DEMON_RADIUS * 2) {
        throw new TypeError("Zombie Hell mode requires a valid arena size");
      }

      const primaryTeam = game.teams && game.teams[0];
      const hordeTeam = game.teams && game.teams[1];
      this.engine = engine;
      this.game = game;
      this.random = random;
      this.arenaSize = arenaSize;
      this.playerTeamId = playerTeamId || (primaryTeam && primaryTeam.id) || "left";
      this.zombieTeamId = hordeTeamId || (hordeTeam && hordeTeam.id) || "horde";
      this.elapsed = Math.max(0, Number.isFinite(game.time) ? game.time : 0);
      this.round = hellRoundAt(this.elapsed);
      this.nextDemonSpawnAt = HELL_DEMON_SPAWN_INTERVAL_SECONDS;
      this.nextMedicalSpawnAt = HELL_MEDICAL_INTERVAL_SECONDS;
      this.nextLavaRollAt = this.round * HELL_ROUND_SECONDS;
      this.nextUnitId = 1;
      this.nextMedicalId = 1;
      this.units = [];
      this.medicalBalls = [];
      this.cells = createHellCells();
      this.lavaTickTimers = new Map();
      this.entities = [];
      this.modeEntities = this.entities;
      this.contactPairs = new Set();
      this.nextContactPairs = new Set();

      const backdrop = {
        instanceId: `${this.zombieTeamId}-hell-backdrop`,
        isModeEntity: true,
        modeEntityType: "zombie-hell-backdrop",
        drawLayer: "background",
        entityActive: true,
        cells: this.cells,
        getTime: () => this.game.time,
        draw(context, canvasContext) {
          drawHellBackdrop(context.entity || context.effect, canvasContext);
        }
      };
      this.entities.push(backdrop);
      this.rollLavaForRound(this.round, this.elapsed);
    }

    livingPlayers() {
      const candidates = this.game.ballsByTeamId && this.game.ballsByTeamId.get(this.playerTeamId);
      const source = candidates || (this.game.teams || [])
        .filter((team) => team.id === this.playerTeamId)
        .flatMap((team) => team.balls || []);
      const living = [];
      for (const player of source || []) {
        if (player && player.hp > 0 && player.isReplayActor !== true) living.push(player);
      }
      return living;
    }

    forEachLivingUnit(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Demon visitor must be a function");
      }
      let count = 0;
      for (const unit of this.units) {
        if (unit.hp <= 0) continue;
        callback(unit);
        count += 1;
      }
      return count;
    }

    nextTransitionIn() {
      return Math.max(EPSILON, Math.min(
        this.nextDemonSpawnAt,
        this.nextMedicalSpawnAt,
        this.nextLavaRollAt
      ) - this.elapsed);
    }

    randomCoordinate(radius) {
      return radius + this.random() * (this.arenaSize - radius * 2);
    }

    spawnDemon(round = this.round, position = null) {
      const spawnRound = normalizeRound(round);
      const hp = hellDemonStrength(spawnRound);
      const radius = HELL_DEMON_RADIUS;
      const x = clamp(
        position && Number.isFinite(position.x) ? position.x : this.randomCoordinate(radius),
        radius,
        this.arenaSize - radius
      );
      const y = clamp(
        position && Number.isFinite(position.y) ? position.y : this.randomCoordinate(radius),
        radius,
        this.arenaSize - radius
      );
      const instanceId = `${this.zombieTeamId}-hell-demon-${this.nextUnitId++}`;
      const angle = this.random() * Math.PI * 2;
      const speed = ZOMBIE_MODE_CONSTANTS.zombieMinSpeed + this.random() * (
        ZOMBIE_MODE_CONSTANTS.zombieMaxSpeed - ZOMBIE_MODE_CONSTANTS.zombieMinSpeed
      );
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const unit = {
        definition: HELL_DEMON_DEFINITION,
        id: HELL_DEMON_DEFINITION.id,
        instanceId,
        teamId: this.zombieTeamId,
        isBoss: false,
        isModeUnit: true,
        modeEntityType: "hell-demon",
        name: HELL_DEMON_DEFINITION.name,
        color: HELL_DEMON_DEFINITION.color,
        radius,
        x,
        y,
        prevX: x,
        prevY: y,
        vx,
        vy,
        storedVx: vx,
        storedVy: vy,
        speed,
        speedMultiplier: 1,
        speedNeedsNormalization: false,
        movementLocked: false,
        positionLocked: false,
        hp,
        maxHp: hp,
        effects: new Map(),
        behavior: null,
        fade: 1,
        deathNotified: false,
        diedAt: null,
        replayFrames: [],
        replayEvents: [],
        forcedTargetInstanceId: null,
        damageOutputScale: 1,
        attractionCooldown: 0,
        spawnRound,
        bulletDamage: hellDemonBulletDamage(spawnRound),
        collisionDamage: hellDemonCollisionDamage(spawnRound),
        damageReduction: hellDemonDamageReduction(spawnRound),
        dodgeChance: hellDemonDodgeChance(spawnRound),
        hellRandom: () => this.random()
      };
      unit.services = this.engine.createServices(unit);
      unit.behavior = HELL_DEMON_DEFINITION.createBehavior(unit.services);
      this.units.push(unit);
      this.entities.push(unit);
      if (this.game.ballByInstanceId) this.game.ballByInstanceId.set(instanceId, unit);
      this.engine.invokeHook(unit, "onSpawn");
      return unit;
    }

    spawnMedicalBall(position = null) {
      const radius = ZOMBIE_MODE_CONSTANTS.medicalBallRadius;
      const item = {
        ...MEDICAL_BALL_DEFINITION,
        instanceId: `zombie-hell-medical-${this.nextMedicalId++}`,
        isModeEntity: true,
        modeEntityType: "medical-ball",
        entityActive: true,
        x: clamp(
          position && Number.isFinite(position.x) ? position.x : this.randomCoordinate(radius),
          radius,
          this.arenaSize - radius
        ),
        y: clamp(
          position && Number.isFinite(position.y) ? position.y : this.randomCoordinate(radius),
          radius,
          this.arenaSize - radius
        )
      };
      this.medicalBalls.push(item);
      this.entities.push(item);
      return item;
    }

    nearestPlayer(unit, players) {
      let nearest = null;
      let nearestDistanceSquared = Infinity;
      for (const player of players) {
        const dx = player.x - unit.x;
        const dy = player.y - unit.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared < nearestDistanceSquared) {
          nearest = player;
          nearestDistanceSquared = distanceSquared;
        }
      }
      return nearest;
    }

    applyAttraction(unit, target, dt) {
      if (!target || dt <= 0) return;
      const dx = target.x - unit.x;
      const dy = target.y - unit.y;
      const distance = Math.hypot(dx, dy);
      const stopDistance = unit.radius + target.radius;
      if (distance <= stopDistance + EPSILON) return;
      const travel = Math.min(
        distance - stopDistance,
        ZOMBIE_MODE_CONSTANTS.zombieAttractionSpeed * unit.speedMultiplier * dt
      );
      unit.x += dx / distance * travel;
      unit.y += dy / distance * travel;
    }

    updateUnit(unit, players, dt) {
      const paused = this.engine.isBehaviorPaused(unit);
      const actionDt = this.engine.combatantActionDelta(unit, dt);
      if (!paused && !this.engine.isAbilitySealed(unit)) {
        unit.attackTime = (unit.attackTime || 0) + actionDt;
        this.engine.invokeHook(unit, "update", null, actionDt);
      } else if (!this.engine.isAbilitySealed(unit)) this.engine.invokeHook(unit, "updateWhilePaused", null, actionDt);
      this.engine.updateEffects(unit, dt);
      if (unit.hp <= 0) return;
      dt *= this.engine.combatantTimeScale(unit);
      unit.attractionCooldown = Math.max(0, unit.attractionCooldown - dt);

      if (unit.positionLocked) {
        unit.vx = 0;
        unit.vy = 0;
      } else if (this.engine.hasKnockbackMotion(unit)) {
        if (this.engine.isPhysicsMovementLocked(unit)) {
          unit.vx = 0;
          unit.vy = 0;
        }
      } else if (!this.engine.hasMovementLock(unit)) {
        if (unit.speedNeedsNormalization) {
          this.engine.normalizeStoredVelocity(unit);
          unit.speedNeedsNormalization = false;
        }
        unit.vx = unit.storedVx;
        unit.vy = unit.storedVy;
      }
      unit.prevX = unit.x;
      unit.prevY = unit.y;
      unit.x += unit.vx * dt;
      unit.y += unit.vy * dt;
      this.engine.applyKnockbackStep(unit);
      if (
        unit.attractionCooldown <= EPSILON &&
        !unit.positionLocked && !this.engine.hasMovementLock(unit)
      ) {
        this.applyAttraction(unit, this.nearestPlayer(unit, players), dt);
      }
      this.engine.bounceFromWalls(unit);
      if (this.engine.isAbilitySealed(unit)) return;
      if (!paused && !this.engine.isBehaviorPaused(unit)) {
        this.engine.invokeHook(unit, "afterUpdateStep", null, actionDt);
      } else {
        this.engine.invokeHook(unit, "afterUpdateStepWhilePaused", null, actionDt);
      }
    }

    resolvePlayerContacts(players, dt) {
      const previousPairs = this.contactPairs;
      const activePairs = this.nextContactPairs;
      activePairs.clear();
      for (const player of players) {
        if (player.hp <= 0) continue;
        for (const unit of this.units) {
          if (unit.hp <= 0) continue;
          this.engine.handleBallPair(player, unit, dt, previousPairs, activePairs);
        }
      }
      this.contactPairs = activePairs;
      this.nextContactPairs = previousPairs;
    }

    collectMedicalBalls(players) {
      for (const item of this.medicalBalls) {
        if (item.entityActive === false) continue;
        for (const player of players) {
          const dx = player.x - item.x;
          const dy = player.y - item.y;
          const radius = player.radius + item.radius;
          if (dx * dx + dy * dy > radius * radius) continue;
          const before = player.hp;
          player.hp = Math.min(player.maxHp, player.hp + HELL_MEDICAL_BALL_HEALING);
          const restored = player.hp - before;
          if (restored > 0) {
            this.engine.spawnHitText(player.x, player.y, `+${restored}`, { color: "#70ff91" });
          }
          item.entityActive = false;
          break;
        }
      }
    }

    rollLavaForRound(round = this.round, time = this.elapsed) {
      const coverage = hellLavaCoverage(round);
      const count = Math.round(HELL_CELL_COUNT * coverage);
      const selected = new Set(selectHellLavaIndices(HELL_CELL_COUNT, count, this.random));
      for (const cell of this.cells) {
        const shouldBeLava = selected.has(cell.index);
        if (cell.lava !== shouldBeLava) {
          cell.lava = shouldBeLava;
          cell.transitionStartedAt = time;
        }
      }
    }

    isPlayerTouchingLava(player) {
      const minColumn = Math.max(0, Math.floor((player.x - player.radius) / HELL_BLOCK_SIZE));
      const maxColumn = Math.min(
        HELL_GRID_SIZE - 1,
        Math.floor((player.x + player.radius) / HELL_BLOCK_SIZE)
      );
      const minRow = Math.max(0, Math.floor((player.y - player.radius) / HELL_BLOCK_SIZE));
      const maxRow = Math.min(
        HELL_GRID_SIZE - 1,
        Math.floor((player.y + player.radius) / HELL_BLOCK_SIZE)
      );
      for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
          const cell = this.cells[row * HELL_GRID_SIZE + column];
          if (cell.lava && circleTouchesCell(cell, player.x, player.y, player.radius)) {
            return true;
          }
        }
      }
      return false;
    }

    applyLavaDamage(players, dt) {
      const tickSeconds = hellLavaTickSeconds(this.round);
      const damage = hellLavaDamage(this.round);
      for (const player of players) {
        let timer = this.lavaTickTimers.get(player.instanceId) || 0;
        if (player.hp <= 0 || !this.isPlayerTouchingLava(player)) {
          if (timer !== 0) this.lavaTickTimers.set(player.instanceId, 0);
          continue;
        }
        timer += Math.max(0, dt);
        let resolvedTicks = 0;
        while (
          timer + EPSILON >= tickSeconds &&
          player.hp > 0 &&
          resolvedTicks < 64
        ) {
          timer -= tickSeconds;
          resolvedTicks += 1;
          this.engine.dealDamage(player, damage, player, { kind: "environment" });
        }
        this.lavaTickTimers.set(player.instanceId, Math.max(0, timer));
      }
    }

    spawnScheduledEntities(endTime) {
      while (this.nextDemonSpawnAt <= endTime + EPSILON) {
        const eventTime = this.nextDemonSpawnAt;
        this.spawnDemon(hellRoundForSpawn(eventTime));
        const followingRound = hellRoundAt(eventTime + EPSILON);
        this.nextDemonSpawnAt = eventTime + hellDemonSpawnInterval(followingRound);
      }
      while (this.nextMedicalSpawnAt <= endTime + EPSILON) {
        this.spawnMedicalBall();
        this.nextMedicalSpawnAt += HELL_MEDICAL_INTERVAL_SECONDS;
      }
    }

    removeDefeatedUnits(players) {
      let writeIndex = 0;
      for (const unit of this.units) {
        if (unit.hp > 0) {
          this.units[writeIndex++] = unit;
          continue;
        }
        unit.hp = 0;
        unit.fade = 0;
        unit.vx = unit.vy = unit.storedVx = unit.storedVy = 0;
        if (!unit.deathNotified) {
          unit.deathNotified = true;
          unit.diedAt = this.elapsed;
          this.engine.invokeHook(unit, "onDeath", {
            winner: this.nearestPlayer(unit, players)
          });
        }
        if (this.game.ballByInstanceId) this.game.ballByInstanceId.delete(unit.instanceId);
      }
      this.units.length = writeIndex;
    }

    compactEntities() {
      let entityWriteIndex = 0;
      for (const entity of this.entities) {
        const active = entity.modeEntityType === "hell-demon"
          ? entity.hp > 0
          : entity.entityActive !== false;
        if (active) this.entities[entityWriteIndex++] = entity;
      }
      this.entities.length = entityWriteIndex;

      let medicalWriteIndex = 0;
      for (const item of this.medicalBalls) {
        if (item.entityActive !== false) this.medicalBalls[medicalWriteIndex++] = item;
      }
      this.medicalBalls.length = medicalWriteIndex;
    }

    update(dt) {
      const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
      if (this.game.state !== "running") return;
      const players = this.livingPlayers();
      for (const unit of this.units) {
        if (unit.hp > 0) this.updateUnit(unit, players, elapsed);
      }
      this.resolvePlayerContacts(players, elapsed);
      this.collectMedicalBalls(players);
      this.elapsed += elapsed;
      const nextRound = hellRoundAt(this.elapsed);
      if (nextRound !== this.round) {
        this.round = nextRound;
        this.rollLavaForRound(this.round, this.elapsed);
        this.nextLavaRollAt = this.round * HELL_ROUND_SECONDS;
      }
      this.applyLavaDamage(players, elapsed);
      this.spawnScheduledEntities(this.elapsed);
      this.removeDefeatedUnits(players);
      this.compactEntities();
    }

    dispose() {
      for (const unit of this.units) {
        if (this.game.ballByInstanceId) this.game.ballByInstanceId.delete(unit.instanceId);
      }
      this.units.length = 0;
      this.medicalBalls.length = 0;
      this.entities.length = 0;
      this.lavaTickTimers.clear();
      this.contactPairs.clear();
      this.nextContactPairs.clear();
    }

    getState() {
      return Object.freeze({
        elapsed: this.elapsed,
        round: this.round,
        nextDemonSpawnAt: this.nextDemonSpawnAt,
        nextMedicalSpawnAt: this.nextMedicalSpawnAt,
        nextLavaRollAt: this.nextLavaRollAt,
        demonCount: this.units.length,
        medicalBallCount: this.medicalBalls.length,
        lavaCellCount: this.cells.filter((cell) => cell.lava).length
      });
    }
  }

  function createZombieHellModeController(engine, game, options = {}) {
    return new ZombieHellModeController({ engine, game, ...options });
  }

  return {
    ZOMBIE_HELL_MODE_ID,
    ZOMBIE_HELL_MODE_CONSTANTS,
    HELL_DEMON_DEFINITION,
    ZombieHellModeController,
    createZombieHellModeController,
    hellRoundAt,
    hellRoundForSpawn,
    hellLavaCoverage,
    hellLavaTickSeconds,
    hellLavaDamage,
    hellDemonDamageReduction,
    hellDemonDodgeChance,
    hellDemonCollisionDamage,
    hellDemonBulletDamage,
    hellDemonStrength,
    hellDemonSpawnRate,
    hellDemonSpawnInterval,
    selectHellLavaIndices,
    drawHellBackdrop
  };
});
