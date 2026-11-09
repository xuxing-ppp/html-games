(function initializeZombieMode(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createZombieModeApi() {
  "use strict";

  const ZOMBIE_MODE_ID = "zombie";
  const ZOMBIE_ARENA_SIZE = 400;
  const ZOMBIE_ROUND_SECONDS = 10;
  const ZOMBIE_SPAWN_WINDOW_SECONDS = 5;
  const ZOMBIE_RADIUS = 10;
  const ZOMBIE_SPEED = 30;
  const ZOMBIE_MIN_SPEED = 20;
  const ZOMBIE_MAX_SPEED = 40;
  const ZOMBIE_ATTRACTION_SPEED = 36;
  const ZOMBIE_CONTACT_RELEASE_SECONDS = 0.35;
  const ZOMBIE_CONTACT_DAMAGE = 1;
  const ZOMBIE_RANGED_HP_THRESHOLD = 10;
  const ZOMBIE_RANGED_CHANCE = 0.5;
  const ZOMBIE_RANGED_SHOT_INTERVAL = 5;
  const ZOMBIE_RANGED_BULLET_SPEED = 450;
  const ZOMBIE_RANGED_BULLET_DAMAGE = 1;
  const ZOMBIE_RANGED_BULLET_RADIUS = 3;
  const ZOMBIE_RANGED_BULLET_LIFE = 2;
  const MEDICAL_BALL_RADIUS = 5;
  const MEDICAL_BALL_HEALING = 10;
  const EPSILON = 1e-9;

  const ZOMBIE_MODE_CONSTANTS = Object.freeze({
    arenaSize: ZOMBIE_ARENA_SIZE,
    roundSeconds: ZOMBIE_ROUND_SECONDS,
    spawnWindowSeconds: ZOMBIE_SPAWN_WINDOW_SECONDS,
    zombieRadius: ZOMBIE_RADIUS,
    zombieSpeed: ZOMBIE_SPEED,
    zombieMinSpeed: ZOMBIE_MIN_SPEED,
    zombieMaxSpeed: ZOMBIE_MAX_SPEED,
    zombieAttractionSpeed: ZOMBIE_ATTRACTION_SPEED,
    zombieContactReleaseSeconds: ZOMBIE_CONTACT_RELEASE_SECONDS,
    zombieContactDamage: ZOMBIE_CONTACT_DAMAGE,
    rangedZombieHpThreshold: ZOMBIE_RANGED_HP_THRESHOLD,
    rangedZombieChance: ZOMBIE_RANGED_CHANCE,
    rangedZombieShotInterval: ZOMBIE_RANGED_SHOT_INTERVAL,
    rangedZombieBulletSpeed: ZOMBIE_RANGED_BULLET_SPEED,
    rangedZombieBulletDamage: ZOMBIE_RANGED_BULLET_DAMAGE,
    rangedZombieBulletRadius: ZOMBIE_RANGED_BULLET_RADIUS,
    medicalBallRadius: MEDICAL_BALL_RADIUS,
    medicalBallHealing: MEDICAL_BALL_HEALING
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeRound(round) {
    return Math.max(1, Math.floor(Number.isFinite(round) ? round : 1));
  }

  function zombieRoundAt(elapsedSeconds) {
    const elapsed = Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0);
    return Math.floor(elapsed / ZOMBIE_ROUND_SECONDS) + 1;
  }

  function zombieRoundForSpawn(spawnTime) {
    return Math.max(1, Math.ceil(Math.max(0, spawnTime) / ZOMBIE_ROUND_SECONDS));
  }

  function zombieSpawnRate(round) {
    return (normalizeRound(round) + 3) / ZOMBIE_SPAWN_WINDOW_SECONDS;
  }

  function zombieSpawnInterval(round) {
    return 1 / zombieSpawnRate(round);
  }

  function zombieHpForRound(round) {
    return normalizeRound(round) + 3;
  }

  function drawMedicalBall(item, context) {
    if (!item || !context) return;
    const radius = item.radius;
    context.save();
    context.fillStyle = item.color;
    context.beginPath();
    context.arc(Math.round(item.x), Math.round(item.y), radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#145c2f";
    context.lineWidth = 1;
    context.stroke();
    context.fillStyle = "#ffffff";
    const bar = Math.max(2, radius * 0.42);
    const length = radius * 1.35;
    context.fillRect(item.x - bar / 2, item.y - length / 2, bar, length);
    context.fillRect(item.x - length / 2, item.y - bar / 2, length, bar);
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

  function drawRangedZombieBullet({ effect }, context) {
    context.save();
    context.globalAlpha *= 0.95;
    context.shadowColor = "#b7ff72";
    context.shadowBlur = 5;
    context.fillStyle = "#d8ff9a";
    context.beginPath();
    context.arc(
      Math.round(effect.x),
      Math.round(effect.y),
      effect.radius,
      0,
      Math.PI * 2
    );
    context.fill();
    context.restore();
  }

  function createRangedZombieBullet(source, target) {
    const direction = aimAt(source, target);
    return {
      kind: "zombie-ranged-bullet",
      life: ZOMBIE_RANGED_BULLET_LIFE,
      radius: ZOMBIE_RANGED_BULLET_RADIUS,
      damage: ZOMBIE_RANGED_BULLET_DAMAGE,
      color: "#d8ff9a",
      x: source.x,
      y: source.y,
      vx: direction.x * ZOMBIE_RANGED_BULLET_SPEED,
      vy: direction.y * ZOMBIE_RANGED_BULLET_SPEED,
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
        drawRangedZombieBullet(context, canvasContext);
      }
    };
  }

  const ZOMBIE_DEFINITION = Object.freeze({
    id: "zombie-mode-zombie",
    name: "\u4e27\u5c38",
    englishName: "Zombie",
    color: "#43a047",
    description: "\u968f\u673a\u6e38\u8d70 / \u5f15\u529b\u8ffd\u654c / \u78b0\u649e -1",
    stats: Object.freeze({
      radius: ZOMBIE_RADIUS,
      speed: ZOMBIE_SPEED,
      maxHp: zombieHpForRound(1)
    }),
    createBehavior(services) {
      let rangedShotTimer = 0;

      function updateRangedAttack(context, dt) {
        if (!context.ball.isRanged) return;
        rangedShotTimer += Math.max(0, Number.isFinite(dt) ? dt : 0);
        while (rangedShotTimer + EPSILON >= ZOMBIE_RANGED_SHOT_INTERVAL) {
          rangedShotTimer -= ZOMBIE_RANGED_SHOT_INTERVAL;
          const target = services.getOpponent();
          if (target) {
            services.spawnProjectile(createRangedZombieBullet(context.ball, target));
          }
        }
      }

      return {
        update: updateRangedAttack,
        onCollision(context, target) {
          const zombie = context.ball;
          zombie.attractionCooldown = Math.max(
            zombie.attractionCooldown || 0,
            ZOMBIE_CONTACT_RELEASE_SECONDS
          );
          let awayX = zombie.x - target.x;
          let awayY = zombie.y - target.y;
          let distance = Math.hypot(awayX, awayY);
          if (distance <= EPSILON) {
            awayX = zombie.preHitVx || zombie.storedVx || 1;
            awayY = zombie.preHitVy || zombie.storedVy || 0;
            distance = Math.hypot(awayX, awayY) || 1;
          }
          const speed = zombie.speed * zombie.speedMultiplier;
          zombie.vx = zombie.storedVx = awayX / distance * speed;
          zombie.vy = zombie.storedVy = awayY / distance * speed;
          zombie.speedNeedsNormalization = false;
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, ZOMBIE_CONTACT_DAMAGE);
          }
        }
      };
    }
  });

  const MEDICAL_BALL_DEFINITION = Object.freeze({
    id: "zombie-mode-medical-ball",
    kind: "zombie-mode-medical-ball",
    color: "#36b85f",
    radius: MEDICAL_BALL_RADIUS,
    healing: MEDICAL_BALL_HEALING,
    draw({ entity, effect }, context) {
      drawMedicalBall(entity || effect, context);
    }
  });

  class ZombieModeController {
    constructor({
      engine,
      game,
      random = Math.random,
      arenaSize = ZOMBIE_ARENA_SIZE,
      playerTeamId = null,
      zombieTeamId = null
    } = {}) {
      if (!engine || !game) {
        throw new TypeError("Zombie mode requires an engine and game");
      }
      if (typeof random !== "function") {
        throw new TypeError("Zombie mode random source must be a function");
      }
      if (!Number.isFinite(arenaSize) || arenaSize <= ZOMBIE_RADIUS * 2) {
        throw new TypeError("Zombie mode requires a valid arena size");
      }

      const primaryTeam = game.teams && game.teams[0];
      const hordeTeam = game.teams && game.teams[1];
      this.engine = engine;
      this.game = game;
      this.random = random;
      this.arenaSize = arenaSize;
      this.playerTeamId = playerTeamId || (primaryTeam && primaryTeam.id) || "left";
      this.zombieTeamId = zombieTeamId || (hordeTeam && hordeTeam.id) || "zombies";
      this.elapsed = Math.max(0, Number.isFinite(game.time) ? game.time : 0);
      this.round = zombieRoundAt(this.elapsed);
      this.nextZombieSpawnAt = zombieSpawnInterval(this.round);
      this.nextMedicalSpawnAt = ZOMBIE_ROUND_SECONDS;
      this.nextUnitId = 1;
      this.nextMedicalId = 1;
      this.units = [];
      this.medicalBalls = [];
      this.entities = [];
      this.modeEntities = this.entities;
      this.contactPairs = new Set();
      this.nextContactPairs = new Set();
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
        throw new TypeError("Zombie visitor must be a function");
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
        this.nextZombieSpawnAt,
        this.nextMedicalSpawnAt
      ) - this.elapsed);
    }

    randomCoordinate(radius) {
      return radius + this.random() * (this.arenaSize - radius * 2);
    }

    spawnZombie(round = this.round, position = null) {
      const spawnRound = normalizeRound(round);
      const hp = zombieHpForRound(spawnRound);
      const radius = ZOMBIE_RADIUS;
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
      const instanceId = `${this.zombieTeamId}-zombie-${this.nextUnitId++}`;
      const angle = this.random() * Math.PI * 2;
      const speed = ZOMBIE_MIN_SPEED + this.random() * (
        ZOMBIE_MAX_SPEED - ZOMBIE_MIN_SPEED
      );
      const isRanged = hp > ZOMBIE_RANGED_HP_THRESHOLD &&
        this.random() < ZOMBIE_RANGED_CHANCE;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const unit = {
        definition: ZOMBIE_DEFINITION,
        id: ZOMBIE_DEFINITION.id,
        instanceId,
        teamId: this.zombieTeamId,
        isBoss: false,
        isModeUnit: true,
        modeEntityType: "zombie",
        name: ZOMBIE_DEFINITION.name,
        color: ZOMBIE_DEFINITION.color,
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
        isRanged,
        zombieType: isRanged ? "ranged" : "collision"
      };
      unit.services = this.engine.createServices(unit);
      unit.behavior = ZOMBIE_DEFINITION.createBehavior(unit.services);
      this.units.push(unit);
      this.entities.push(unit);
      if (this.game.ballByInstanceId) this.game.ballByInstanceId.set(instanceId, unit);
      this.engine.invokeHook(unit, "onSpawn");
      return unit;
    }

    spawnMedicalBall(position = null) {
      const radius = MEDICAL_BALL_RADIUS;
      const item = {
        ...MEDICAL_BALL_DEFINITION,
        instanceId: `zombie-medical-${this.nextMedicalId++}`,
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
        ZOMBIE_ATTRACTION_SPEED * unit.speedMultiplier * dt
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
          player.hp = Math.min(player.maxHp, player.hp + MEDICAL_BALL_HEALING);
          const restored = player.hp - before;
          if (restored > 0) {
            this.engine.spawnHitText(player.x, player.y, `+${restored}`, { color: "#70ff91" });
          }
          item.entityActive = false;
          break;
        }
      }
    }

    spawnScheduledEntities(endTime) {
      while (this.nextZombieSpawnAt <= endTime + EPSILON) {
        const eventTime = this.nextZombieSpawnAt;
        this.spawnZombie(zombieRoundForSpawn(eventTime));
        const followingRound = zombieRoundAt(eventTime + EPSILON);
        this.nextZombieSpawnAt = eventTime + zombieSpawnInterval(followingRound);
      }
      while (this.nextMedicalSpawnAt <= endTime + EPSILON) {
        this.spawnMedicalBall();
        this.nextMedicalSpawnAt += ZOMBIE_ROUND_SECONDS;
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
        const active = entity.modeEntityType === "zombie"
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
      this.round = zombieRoundAt(this.elapsed);
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
      this.contactPairs.clear();
      this.nextContactPairs.clear();
    }

    getState() {
      return Object.freeze({
        elapsed: this.elapsed,
        round: this.round,
        nextZombieSpawnAt: this.nextZombieSpawnAt,
        nextMedicalSpawnAt: this.nextMedicalSpawnAt,
        zombieCount: this.units.length,
        medicalBallCount: this.medicalBalls.length
      });
    }
  }

  function createZombieModeController(engine, game, options = {}) {
    return new ZombieModeController({ engine, game, ...options });
  }

  return {
    ZOMBIE_MODE_ID,
    ZOMBIE_MODE_CONSTANTS,
    ZOMBIE_DEFINITION,
    MEDICAL_BALL_DEFINITION,
    ZombieModeController,
    createZombieModeController,
    zombieRoundAt,
    zombieSpawnRate,
    zombieSpawnInterval,
    zombieHpForRound
  };
});
