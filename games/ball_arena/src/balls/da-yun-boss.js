(function initializeDaYunBoss(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js")),
        ...require("../core/damage-reduction.js"), ...require("../core/arena-geometry.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunBossPlugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback, applyDamageReduction }) {
  const BOSS_COLOR = "#808080";
  const DAMAGE_REDUCTION = 0.95;
  const BODY_DAMAGE = 2;
  const BOSS_STUN_FACTOR = 0.2;
  const EPSILON = 1e-9;

  const BIG_TRUCK_INTERVAL = 20;
  const BIG_TRUCK_LENGTH = 400;
  const BIG_TRUCK_HEIGHT = 150;
  const BIG_TRUCK_SPEED = 250;
  const BIG_TRUCK_DAMAGE = 1;
  const BIG_TRUCK_ZOMBIE_COUNT = 5;

  const SMALL_TRUCK_INTERVAL = 2;
  const SMALL_TRUCK_LENGTH = 100;
  const SMALL_TRUCK_HEIGHT = 50;
  const SMALL_TRUCK_SPEED = 100;
  const SMALL_TRUCK_DAMAGE = 1;
  const SMALL_TRUCK_ZOMBIE_COUNT = 1;
  const SMALL_TRUCK_LANES = 6;

  const TRUCK_KNOCKBACK_DURATION = 0.05;
  const TRUCK_KNOCKBACK_SPEED_MULTIPLIER = 2;
  const TRUCK_IMPACT_RADIUS = 25;

  const CHARGE_INTERVAL = 15;
  const CHARGE_DURATION = 15;
  const BASE_SPEED = 100;
  const MAX_SPEED = 300;
  const SHOCKWAVE_RADIUS = 100;
  const SHOCKWAVE_DAMAGE = 5;
  const SHOCKWAVE_STUN = 5.6;
  const SHOCKWAVE_LIFE = 0.36;

  const ZOMBIE_RADIUS = 10;
  const ZOMBIE_SPEED = 30;
  const ZOMBIE_HP = 5;
  const ZOMBIE_DAMAGE = 1;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteDt(dt) {
    return Number.isFinite(dt) ? Math.max(0, dt) : 0;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = Number.isFinite(x) ? x : 0;
    let directionY = Number.isFinite(y) ? y : 0;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function directionTo(source, target) {
    return normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx || 1,
      source.storedVy || source.vy || 0
    );
  }

  function rectangleContact(target, entity) {
    const left = entity.x - entity.width / 2;
    const right = entity.x + entity.width / 2;
    const top = entity.y - entity.height / 2;
    const bottom = entity.y + entity.height / 2;
    const closestX = clamp(
      target.x,
      left,
      right
    );
    const closestY = clamp(
      target.y,
      top,
      bottom
    );
    let normalX = target.x - closestX;
    let normalY = target.y - closestY;
    const distance = Math.hypot(normalX, normalY);
    if (distance > target.radius) return null;
    if (distance <= EPSILON) {
      const distances = [
        { distance: target.x - left, x: -1, y: 0, contactX: left, contactY: target.y },
        { distance: right - target.x, x: 1, y: 0, contactX: right, contactY: target.y },
        { distance: target.y - top, x: 0, y: -1, contactX: target.x, contactY: top },
        { distance: bottom - target.y, x: 0, y: 1, contactX: target.x, contactY: bottom }
      ];
      const nearest = distances.reduce((best, candidate) => (
        candidate.distance < best.distance ? candidate : best
      ));
      normalX = nearest.x;
      normalY = nearest.y;
      return {
        normalX,
        normalY,
        contactX: nearest.contactX,
        contactY: nearest.contactY
      };
    }
    normalX /= distance;
    normalY /= distance;
    return { normalX, normalY, contactX: closestX, contactY: closestY };
  }

  function createTruckKnockback(source, directionX, directionY) {
    return createSharedKnockback({
      id: `da-yun-boss-truck-knockback-${source.instanceId}`,
      duration: TRUCK_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: TRUCK_KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function spawnTruckImpact(services, x, y) {
    services.spawnParticleBurst({
      kind: "da-yun-boss-truck-impact",
      x,
      y,
      minDiameter: 1,
      maxDiameter: 8,
      colors: ["#ffffff", "#969ba0"],
      initialRadius: TRUCK_IMPACT_RADIUS,
      life: 0.42
    });
  }

  function createSlowStun(duration) {
    return {
      id: "da-yun-boss-slow-stun",
      visualType: "stun",
      duration,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: 0.1
    };
  }

  function applyEntityHit(services, target, entity, damage, stunDuration) {
    if (
      services.getContactProfile(target).attackable &&
      services.tryConsumeEntity(target, entity, { physical: true })
    ) {
      return true;
    }
    if (!services.dealDamage(target, damage)) return false;
    if (target.hp > 0) services.applyEffect(target, createSlowStun(stunDuration));
    return false;
  }

  function applyTruckHit(services, target, entity, damage) {
    const contact = rectangleContact(target, entity);
    if (!contact) return false;
    if (
      services.getContactProfile(target).attackable &&
      services.tryConsumeEntity(target, entity, { physical: true })
    ) {
      return true;
    }
    if (!services.dealDamage(target, damage)) return false;
    services.applyEffect(
      target,
      createTruckKnockback(entity, contact.normalX, contact.normalY)
    );
    spawnTruckImpact(
      services,
      contact.contactX + contact.normalX * 10,
      contact.contactY + contact.normalY * 10
    );
    const contactDistance = target.radius;
    target.x = contact.contactX + contact.normalX * contactDistance;
    target.y = contact.contactY + contact.normalY * contactDistance;
    const incomingSpeed = target.vx * contact.normalX + target.vy * contact.normalY;
    if (incomingSpeed < 0) {
      target.vx -= incomingSpeed * 2 * contact.normalX;
      target.vy -= incomingSpeed * 2 * contact.normalY;
      target.storedVx = target.vx;
      target.storedVy = target.vy;
    }
    return false;
  }

  function drawTruck(context, entity, label) {
    const scale = entity.width / BIG_TRUCK_LENGTH;
    const halfHeight = entity.height / 2;
    const left = entity.x - entity.width / 2;
    const top = entity.y - halfHeight;
    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    context.fillRect(left - 4 * scale, top + entity.height - 2, entity.width + 8 * scale, 7 * scale);
    context.fillStyle = "#15191b";
    context.fillRect(left + entity.width * 0.25, top, entity.width * 0.74, entity.height * 0.72);
    context.fillStyle = "#a9342e";
    context.fillRect(left + entity.width * 0.27, top + 4 * scale, entity.width * 0.7, entity.height * 0.64);
    context.fillStyle = "#c84b3d";
    context.fillRect(left + entity.width * 0.3, top + 9 * scale, entity.width * 0.64, 10 * scale);
    context.fillStyle = "#7d2422";
    for (let x = left + entity.width * 0.34; x < left + entity.width * 0.94; x += 24 * scale) {
      context.fillRect(x, top + 25 * scale, Math.max(1, 2 * scale), entity.height * 0.42);
    }
    context.fillStyle = "#15191b";
    context.beginPath();
    context.moveTo(left + 2 * scale, top + entity.height * 0.72);
    context.lineTo(left + 2 * scale, top + entity.height * 0.28);
    context.lineTo(left + entity.width * 0.16, top + 5 * scale);
    context.lineTo(left + entity.width * 0.27, top + 5 * scale);
    context.lineTo(left + entity.width * 0.3, top + entity.height * 0.72);
    context.closePath();
    context.fill();
    context.fillStyle = "#c33d33";
    context.fillRect(left + 7 * scale, top + 15 * scale, entity.width * 0.2, entity.height * 0.43);
    context.fillStyle = "#9fd3dc";
    context.fillRect(left + 13 * scale, top + 12 * scale, entity.width * 0.1, entity.height * 0.2);
    context.fillRect(left + 35 * scale, top + 12 * scale, entity.width * 0.06, entity.height * 0.2);
    context.fillStyle = "#f4d55f";
    context.fillRect(left + 2 * scale, top + entity.height * 0.45, 5 * scale, 8 * scale);
    context.fillStyle = "#2b3033";
    context.fillRect(left + 2 * scale, top + entity.height * 0.7, entity.width - 4 * scale, 8 * scale);
    context.fillStyle = "#697175";
    context.fillRect(left + entity.width * 0.27, top + entity.height * 0.7, entity.width * 0.7, 4 * scale);
    const wheelRadius = Math.max(3, 20 * scale);
    context.fillStyle = "#111416";
    [0.13, 0.34, 0.72, 0.9].forEach((position) => {
      context.beginPath();
      context.arc(left + entity.width * position, top + entity.height * 0.83, wheelRadius, 0, Math.PI * 2);
      context.fill();
    });
    if (label && entity.width >= 160) {
      context.fillStyle = "rgba(245, 220, 196, 0.72)";
      context.font = "700 12px Impact, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, left + entity.width * 0.56, top + entity.height * 0.35);
    }
    context.restore();
  }

  function createTruckEntity({
    arenaSize,
    y,
    width,
    height,
    speed,
    damage,
    kind,
    label,
    dropCount = 0,
    dropSpacing = resolveArenaGeometry(arenaSize).width,
    onPass = null
  }) {
    const arena = resolveArenaGeometry(arenaSize);
    return {
      kind,
      life: (arena.width + width) / speed + 0.3,
      drawLayer: "background",
      solid: true,
      width,
      height,
      damage,
      x: arena.right + width / 2,
      y,
      vx: -speed,
      vy: 0,
      distanceTravelled: 0,
      nextDropDistance: width + Math.max(1, dropSpacing),
      dropIndex: 0,
      dropCount,
      dropSpacing,
      contacts: new Set(),
      update({ effect, game, services }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        let remaining = finiteDt(dt);
        const maximumStep = 6 / speed;
        if (remaining <= EPSILON) remaining = 0;
        do {
          const step = Math.min(remaining, maximumStep);
          effect.x += effect.vx * step;
          effect.distanceTravelled += Math.abs(effect.vx) * step;
          while (
            effect.dropIndex < effect.dropCount &&
            effect.distanceTravelled + EPSILON >= effect.nextDropDistance
          ) {
            if (typeof effect.onPass === "function") {
              effect.onPass({
                entity: effect,
                arenaSize,
                dropIndex: effect.dropIndex,
                dropCount: effect.dropCount,
                x: effect.x + width / 2,
                y: effect.y,
                services
              });
            }
            effect.dropIndex += 1;
            effect.nextDropDistance += Math.max(1, effect.dropSpacing);
          }
          const touchingNow = new Set();
          let consumed = false;
          services.forEachContactEnemy((target) => {
            const contact = rectangleContact(target, effect);
            services.notifyEntityContact(target, effect, { overlapping: Boolean(contact) });
            if (!contact) return;
            const key = target.instanceId || target.id;
            touchingNow.add(key);
            if (effect.contacts.has(key)) return;
            effect.contacts.add(key);
            if (applyTruckHit(services, target, effect, damage)) consumed = true;
          });
          effect.contacts = touchingNow;
          if (consumed) {
            effect.life = 0;
            return;
          }
          if (effect.x + width / 2 < 0) {
            effect.life = 0;
            return;
          }
          remaining -= step;
        } while (remaining > EPSILON);
      },
      draw({ effect }, context) {
        drawTruck(context, effect, label);
      },
      onPass
    };
  }

  function createShockwaveEntity(x, y) {
    return {
      kind: "da-yun-boss-shockwave",
      life: SHOCKWAVE_LIFE,
      radius: SHOCKWAVE_RADIUS,
      diameter: SHOCKWAVE_RADIUS * 2,
      initialLife: SHOCKWAVE_LIFE,
      x,
      y,
      contacts: new Set(),
      damageApplied: false,
      update({ effect, game, services }) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        if (effect.damageApplied) return;
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (effect.contacts.has(key)) return;
          if (Math.hypot(target.x - effect.x, target.y - effect.y) > SHOCKWAVE_RADIUS + target.radius) return;
          effect.contacts.add(key);
          applyEntityHit(services, target, effect, SHOCKWAVE_DAMAGE, SHOCKWAVE_STUN);
        });
        effect.damageApplied = true;
      },
      draw({ effect }, context) {
        // Combat entities advance `age` and keep `life` as their fixed
        // lifetime. Use that clock so the ring visibly expands before fading.
        const progress = clamp(
          (Number.isFinite(effect.age) ? effect.age : 0) / effect.life,
          0,
          1
        );
        context.save();
        context.globalAlpha *= 0.68 * (1 - progress);
        context.strokeStyle = "#d7d7d7";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(effect.x, effect.y, SHOCKWAVE_RADIUS * (0.35 + progress * 0.65), 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  const bossZombieDefinition = {
    id: "da-yun-boss-zombie",
    name: "丧尸",
    englishName: "Zombie",
    color: "#43a047",
    description: "大运召唤的近战丧尸",
    stats: {
      radius: ZOMBIE_RADIUS,
      speed: ZOMBIE_SPEED,
      maxHp: ZOMBIE_HP
    },
    createBehavior(services) {
      return {
        update({ ball }) {
          const target = services.getOpponent();
          if (!target) return;
          const direction = directionTo(ball, target);
          const speed = ball.speed * ball.speedMultiplier;
          ball.vx = ball.storedVx = direction.x * speed;
          ball.vy = ball.storedVy = direction.y * speed;
          ball.speedNeedsNormalization = false;
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) context.services.dealDamage(target, ZOMBIE_DAMAGE);
        }
      };
    }
  };

  const daYunBossDefinition = {
    id: "daYunBoss",
    name: "大运Boss",
    englishName: "Da Yun Boss",
    color: BOSS_COLOR,
    rosterType: "boss",
    description: "总力战专用 / 货车、冲击波、尸群 / 95%减伤",
    stats: {
      radius: 22.5,
      speed: BASE_SPEED,
      maxHp: 100
    },
    createBehavior(services) {
      let bigTruckTimer = 0;
      let smallTruckTimer = 0;
      let chargeTimer = 0;
      let chargeElapsed = 0;
      let chargeActive = false;
      let chargeComplete = false;
      let chargeTrail = null;

      function targetSpeed() {
        if (!chargeActive) return BASE_SPEED;
        return BASE_SPEED + (MAX_SPEED - BASE_SPEED) * Math.sqrt(
          Math.min(1, chargeElapsed / CHARGE_DURATION)
        );
      }

      function syncMovement(context) {
        const ball = context.ball;
        ball.speed = targetSpeed();
        const magnitude = Math.hypot(ball.storedVx, ball.storedVy);
        if (magnitude > EPSILON && ball.speed > EPSILON) {
          ball.storedVx = ball.storedVx / magnitude * ball.speed;
          ball.storedVy = ball.storedVy / magnitude * ball.speed;
        } else if (ball.speed > EPSILON) {
          const direction = normalizeDirection(ball.vx, ball.vy);
          ball.storedVx = direction.x * ball.speed;
          ball.storedVy = direction.y * ball.speed;
        }
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
        ball.speedNeedsNormalization = false;
        if (chargeActive && !chargeTrail) {
          chargeTrail = services.spawnAfterimageTrail({
            kind: "da-yun-boss-charge-trail",
            color: BOSS_COLOR,
            radius: ball.radius,
            maxAlpha: 0.2,
            maxSamples: 10,
            sampleInterval: 0.03,
            sampleLife: 0.25,
            minScale: 0.45,
            speedFloor: BASE_SPEED,
            speedRamp: MAX_SPEED - BASE_SPEED
          }, { lifecycle: "owner-bound" });
        }
        if (chargeTrail && chargeActive) {
          chargeTrail.emit(ball.x, ball.y, ball.radius, {
            color: BOSS_COLOR,
            speed: ball.speed,
            heading: Math.atan2(ball.vy, ball.vx)
          });
        }
      }

      function advance(dt) {
        const elapsed = finiteDt(dt);
        bigTruckTimer += elapsed;
        smallTruckTimer += elapsed;
        if (chargeActive) {
          chargeElapsed = Math.min(CHARGE_DURATION, chargeElapsed + elapsed);
          chargeComplete = chargeElapsed + EPSILON >= CHARGE_DURATION;
        } else {
          chargeTimer += elapsed;
          if (chargeTimer + EPSILON >= CHARGE_INTERVAL) {
            chargeTimer = 0;
            chargeElapsed = 0;
            chargeComplete = false;
            chargeActive = true;
          }
        }
      }

      function spawnZombie(x, y) {
        const angle = Math.random() * Math.PI * 2;
        return services.spawnSummon(bossZombieDefinition, {
          x,
          y,
          vx: Math.cos(angle) * ZOMBIE_SPEED,
          vy: Math.sin(angle) * ZOMBIE_SPEED
        });
      }

      function spawnTruckZombie({
        arenaSize,
        dropIndex,
        dropCount,
        x,
        y,
        entity
      }) {
        const spread = entity.height * 0.65;
        const progress = dropCount <= 1 ? 0.5 : dropIndex / (dropCount - 1);
        const { x: spawnX, y: spawnY } = resolveArenaGeometry(arenaSize).clampPoint(
          x + ZOMBIE_RADIUS * 1.5, y + (progress - 0.5) * spread, ZOMBIE_RADIUS);
        spawnZombie(spawnX, spawnY);
      }

      function spawnBigTruck(context) {
        if (bigTruckTimer + EPSILON < BIG_TRUCK_INTERVAL) return;
        while (bigTruckTimer + EPSILON >= BIG_TRUCK_INTERVAL) bigTruckTimer -= BIG_TRUCK_INTERVAL;
        const arenaSize = resolveArenaGeometry(context.game);
        const upper = Math.random() < 0.5;
        const y = arenaSize.top + arenaSize.height * (upper ? 0.25 : 0.75);
        services.playSound("ability", { cue: "truck" });
        services.spawnCombatEntity(createTruckEntity({
          arenaSize,
          y,
          width: BIG_TRUCK_LENGTH,
          height: BIG_TRUCK_HEIGHT,
          speed: BIG_TRUCK_SPEED,
          damage: BIG_TRUCK_DAMAGE,
          kind: "da-yun-boss-big-truck",
          label: "DAYUN BOSS",
          dropCount: BIG_TRUCK_ZOMBIE_COUNT,
          dropSpacing: arenaSize.width / BIG_TRUCK_ZOMBIE_COUNT,
          onPass: spawnTruckZombie
        }));
      }

      function spawnSmallTruck(context) {
        if (smallTruckTimer + EPSILON < SMALL_TRUCK_INTERVAL) return;
        while (smallTruckTimer + EPSILON >= SMALL_TRUCK_INTERVAL) smallTruckTimer -= SMALL_TRUCK_INTERVAL;
        const arenaSize = resolveArenaGeometry(context.game);
        const lanes = Math.max(1, Math.floor(arenaSize.height / SMALL_TRUCK_HEIGHT));
        const lane = Math.min(
          lanes - 1,
          Math.floor(Math.random() * lanes)
        );
        const y = arenaSize.top + (lane + 0.5) * arenaSize.height / lanes;
        services.playSound("ability", { cue: "truck", intensity: 0.65 });
        services.spawnCombatEntity(createTruckEntity({
          arenaSize,
          y,
          width: SMALL_TRUCK_LENGTH,
          height: SMALL_TRUCK_HEIGHT,
          speed: SMALL_TRUCK_SPEED,
          damage: SMALL_TRUCK_DAMAGE,
          kind: "da-yun-boss-small-truck",
          label: "",
          dropCount: SMALL_TRUCK_ZOMBIE_COUNT,
          // The spacing only positions the single drop, keeping it where the
          // first zombie of the old three-zombie spread appeared.
          dropSpacing: arenaSize.width / 3,
          onPass: spawnTruckZombie
        }));
      }

      function releaseEntities(context) {
        spawnBigTruck(context);
        spawnSmallTruck(context);
      }

      function nextTransitionIn() {
        const chargeBoundary = chargeActive && !chargeComplete
          ? Math.max(EPSILON, CHARGE_DURATION - chargeElapsed)
          : (chargeActive
            ? Number.POSITIVE_INFINITY
            : Math.max(EPSILON, CHARGE_INTERVAL - chargeTimer));
        return Math.max(EPSILON, Math.min(
          BIG_TRUCK_INTERVAL - bigTruckTimer,
          SMALL_TRUCK_INTERVAL - smallTruckTimer,
          chargeBoundary
        ));
      }

      return {
        onSpawn(context) {
          context.ball.speed = BASE_SPEED;
        },
        update(context, dt) {
          advance(dt);
          syncMovement(context);
        },
        updateWhilePaused(context, dt) {
          advance(dt);
          syncMovement(context);
        },
        afterUpdateStep(context) {
          releaseEntities(context);
        },
        afterUpdateStepWhilePaused(context) {
          releaseEntities(context);
        },
        getNextTransitionIn() {
          return nextTransitionIn();
        },
        getNextPausedTransitionIn() {
          return nextTransitionIn();
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) context.services.dealDamage(target, BODY_DAMAGE);
        },
        onBeforeDamage(_context, event) {
          if (!event.actor || event.actor === _context.ball) return event;
          return applyDamageReduction(event, DAMAGE_REDUCTION, Math.random);
        },
        onBeforeEffect(_context, definition) {
          if (!definition || definition.visualType !== "stun") return definition;
          return {
            ...definition,
            duration: definition.duration * BOSS_STUN_FACTOR
          };
        },
        onWallBounce(context) {
          if (!chargeActive || !chargeComplete) return;
          services.spawnCombatEntity(createShockwaveEntity(context.ball.x, context.ball.y));
          services.playSound("ability", { cue: "explosion" });
          services.spawnParticleBurst({
            kind: "da-yun-boss-shockwave-dust",
            x: context.ball.x,
            y: context.ball.y,
            count: 140,
            density: 4,
            minDiameter: 1,
            maxDiameter: 5,
            minSpeed: 80,
            maxSpeed: 220,
            initialRadius: 12,
            life: 0.9,
            drag: 2.2,
            gravityY: 18,
            colors: ["#b9b9b9", "#dddddd", "#8c8c8c"]
          });
          if (chargeTrail) chargeTrail.end();
          chargeTrail = null;
          chargeActive = false;
          chargeComplete = false;
          chargeElapsed = 0;
          chargeTimer = 0;
          context.ball.speed = BASE_SPEED;
          context.ball.speedNeedsNormalization = true;
        },
        onDeath() {
          if (chargeTrail) chargeTrail.end(true);
          chargeTrail = null;
        },
        getChargeState() {
          return {
            active: chargeActive,
            complete: chargeComplete,
            elapsed: chargeElapsed,
            speed: chargeActive ? targetSpeed() : BASE_SPEED
          };
        }
      };
    }
  };

  registerBall(daYunBossDefinition);
  return { daYunBossDefinition, daYunBossZombieDefinition: bossZombieDefinition };
});
