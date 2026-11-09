(function initializeCocktail(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({},
      require("../core/ball-registry.js"),
      require("../core/arena-geometry.js"),
      require("../core/contact-model.js"),
      require("./cocktail-visuals.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCocktailPlugin({
  registerBall, resolveArenaGeometry, firstSegmentCircleContact, drawCocktailBottle, drawCocktailShard,
  createCocktailFireVisual, createCocktailWickVisual, createCocktailBurnVisual, createCocktailShatterVisual
}) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;
  const ARMY_GREEN = "#4b5320";

  const ATTACK_FREQUENCY_START = 0.25;
  const ATTACK_FREQUENCY_ACCELERATION = 0.05;
  const ATTACK_FREQUENCY_MAX = 1;
  const ATTACK_INTERVAL_START = 1 / ATTACK_FREQUENCY_START;
  const THROW_RECOIL_TIME = 0.18;
  const BOTTLE_SPEED = 250;
  const BOTTLE_SPINS_PER_SECOND = 1.5;
  const BOTTLE_RADIUS = 5;
  const BOTTLE_LIFE = Number.MAX_VALUE;

  const SHATTER_BASE_CHANCE = 0.25;
  const SHATTER_CHANCE_GROWTH = 0.15;
  const BOTTLE_CONTACT_DAMAGE = 1;
  const CONTACT_RELEASE_DISTANCE = 0.5;
  const CONTACT_NUDGE = 0.05;

  const FRAGMENT_MIN_COUNT = 4;
  const FRAGMENT_MAX_COUNT = 5;
  const FRAGMENT_MIN_SPEED = 50;
  const FRAGMENT_MAX_SPEED = 750;
  const FRAGMENT_DECELERATION = 500;
  const FRAGMENT_DAMAGE = 1;
  const FRAGMENT_RADIUS = 3;

  const FIRE_RADIUS = 30;
  const FIRE_LIFE = 2.8;
  const FIRE_TICK_INTERVAL = 0.3;
  const FIRE_TICK_DAMAGE = 1;
  const BURN_ID = "cocktail-fire-burn";
  const BURN_DURATION = 1;
  const BURN_TICK_INTERVAL = 0.5;
  const BURN_TICK_DAMAGE = 1;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function aimDirection(ball, target) {
    let deltaX = target.x - ball.x;
    let deltaY = target.y - ball.y;
    if (Math.hypot(deltaX, deltaY) <= EPSILON) {
      deltaX = ball.storedVx || ball.vx || 1;
      deltaY = ball.storedVy || ball.vy || 0;
    }
    const length = Math.hypot(deltaX, deltaY) || 1;
    return { x: deltaX / length, y: deltaY / length };
  }

  function createCocktailBurnEffect(ownerId) {
    return {
      id: BURN_ID + "-" + ownerId,
      combatKind: "dot",
      duration: BURN_DURATION,
      attackTags: ["heat"],
      onApply({ ball, effect, game, services }) {
        effect.nextTick = game.time + BURN_TICK_INTERVAL;
        effect.remainingTicks = 2;
        if (!effect.visual || effect.visual.visualActive === false) {
          effect.visual = services.createVisualEffect(createCocktailBurnVisual, { anchor: ball, life: BURN_DURATION });
        } else effect.visual.life = effect.visual.age + BURN_DURATION;
      },
      update({ ball, effect, game, services: bound }) {
        if (ball.hp <= 0) return;
        while (effect.remainingTicks > 0 && game.time + EPSILON >= effect.nextTick && ball.hp > 0) {
          effect.nextTick += BURN_TICK_INTERVAL;
          effect.remainingTicks -= 1;
          bound.dealDamage(ball, BURN_TICK_DAMAGE);
        }
      },
      onExpire({ effect }) {
        if (effect.visual) effect.visual.visualActive = false;
      }
    };
  }

  function heldBottlePose(ball, recoil) {
    const kick = recoil / THROW_RECOIL_TIME;
    return { x: ball.x + ball.radius * 0.92 + 4 + kick * 5,
      y: ball.y + 3 - kick * 4, spinAngle: -0.3 + kick * 0.9 };
  }

  function createCocktailShard(x, y, angle, speed) {
    return {
      kind: "cocktail-shard", x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius: FRAGMENT_RADIUS, life: Number.MAX_VALUE, replayDamage: FRAGMENT_DAMAGE, angle, shardAngle: angle,
      shapeSeed: angle * 1.7 + speed * 0.013,
      update({ entity, game, services }, dt) {
        const speedNow = Math.hypot(entity.vx, entity.vy);
        if (speedNow <= EPSILON) {
          const target = services.getFirstEnemyHit(entity.x, entity.y, entity.x, entity.y, entity.radius);
          if (target) { services.dealDamage(target, FRAGMENT_DAMAGE); entity.entityActive = false; }
          return;
        }
        const step = Math.min(dt, speedNow / FRAGMENT_DECELERATION);
        let travel = speedNow * step - FRAGMENT_DECELERATION * step * step / 2;
        let nx = entity.vx / speedNow, ny = entity.vy / speedNow;
        const arena = resolveArenaGeometry(game);
        while (travel > EPSILON) {
          const motion = arena.advanceMotion({ x: entity.x, y: entity.y, vx: nx, vy: ny, radius: entity.radius }, travel);
          for (const segment of motion.segments) {
            const target = services.getFirstEnemyHit(segment.x1, segment.y1, segment.x2, segment.y2, entity.radius);
            if (!target) continue;
            const t = firstSegmentCircleContact(segment.x1, segment.y1, segment.x2, segment.y2,
              target.x, target.y, entity.radius + target.radius);
            entity.x = segment.x1 + (segment.x2 - segment.x1) * t;
            entity.y = segment.y1 + (segment.y2 - segment.y1) * t;
            services.dealDamage(target, FRAGMENT_DAMAGE);
            entity.entityActive = false;
            return;
          }
          entity.x = motion.x; entity.y = motion.y;
          nx = motion.vx; ny = motion.vy;
          if (motion.remainingTime >= travel - EPSILON) {
            // A tangent start needs interior clearance to produce a reflected segment.
            const inside = arena.clampPoint(entity.x, entity.y, entity.radius + 1e-5);
            entity.x = inside.x; entity.y = inside.y;
          }
          travel = motion.remainingTime;
        }
        const remainingSpeed = speedNow - FRAGMENT_DECELERATION * step;
        const nextSpeed = remainingSpeed <= EPSILON ? 0 : remainingSpeed;
        const length = Math.hypot(nx, ny);
        entity.vx = nextSpeed > 0 ? nx / length * nextSpeed : 0;
        entity.vy = nextSpeed > 0 ? ny / length * nextSpeed : 0;
        entity.angle = Math.atan2(ny, nx);
        entity.shardAngle = entity.angle + (entity.age + step) * 5.2;
      },
      draw({ entity }, context) { drawCocktailShard(context, entity); }
    };
  }

  function createCocktailFire(x, y) {
    return {
      kind: "cocktail-fire", combatKind: "zone", attackTags: ["heat"], drawLayer: "background",
      life: FIRE_LIFE, radius: FIRE_RADIUS, x, y, contacts: new Map(),
      update({ entity, services }) {
        if (!entity.visual) entity.visual = services.createVisualEffect(createCocktailFireVisual, {
          x: entity.x, y: entity.y, radius: entity.radius, life: entity.life - entity.age
        });
        const touched = new Set();
        services.forEachEnemy(target => {
          if (Math.hypot(target.x - entity.x, target.y - entity.y) > entity.radius + target.radius) return;
          touched.add(target.instanceId);
          let nextTick = entity.contacts.get(target.instanceId);
          if (nextTick === undefined) nextTick = entity.age;
          while (entity.age + EPSILON >= nextTick && target.hp > 0) {
            services.dealDamage(target, FIRE_TICK_DAMAGE);
            nextTick += FIRE_TICK_INTERVAL;
          }
          entity.contacts.set(target.instanceId, nextTick);
          services.applyEffect(target, createCocktailBurnEffect(services.source.owner.instanceId));
        });
        for (const id of entity.contacts.keys()) if (!touched.has(id)) entity.contacts.delete(id);
      }
    };
  }

  function shatterBottle(entity, services) {
    const originX = entity.x;
    const originY = entity.y;
    const random = Math.random;
    const count = clamp(
      FRAGMENT_MIN_COUNT + Math.floor(random() * (FRAGMENT_MAX_COUNT - FRAGMENT_MIN_COUNT + 1)),
      FRAGMENT_MIN_COUNT,
      FRAGMENT_MAX_COUNT
    );
    for (let index = 0; index < count; index += 1) {
      const angle = random() * TAU;
      const speed = FRAGMENT_MIN_SPEED + random() * (FRAGMENT_MAX_SPEED - FRAGMENT_MIN_SPEED);
      services.spawnProjectile(createCocktailShard(originX, originY, angle, speed));
    }
    services.spawnCombatEntity(createCocktailFire(originX, originY));
    services.playSound("ability", { cue: "explosion", intensity: 0.9 });
    services.spawnVisualComposition([{ factory: createCocktailShatterVisual, options: { x: originX, y: originY } }]);
    if (entity.wick) entity.wick.visualActive = false;
    entity.entityActive = false;
  }

  function rollShatter(entity) {
    const chance = entity.shatterChance;
    const shattered = Math.random() < chance;
    entity.collisions += 1;
    if (shattered) return true;
    entity.shatterChance = clamp(chance + SHATTER_CHANCE_GROWTH, 0, 1);
    return false;
  }

  function releaseSeparatedContacts(entity, services) {
    if (entity.contacts.size === 0) return;
    for (const key of Array.from(entity.contacts)) {
      const target = services.getBall(key);
      if (!target || target.hp <= 0) {
        entity.contacts.delete(key);
        continue;
      }
      const clearance = target.radius + entity.radius + CONTACT_RELEASE_DISTANCE;
      if (Math.hypot(target.x - entity.x, target.y - entity.y) > clearance) {
        entity.contacts.delete(key);
      }
    }
  }

  function bounceOffTarget(entity, target, contactX, contactY) {
    let normalX = contactX - target.x;
    let normalY = contactY - target.y;
    let length = Math.hypot(normalX, normalY);
    if (length <= EPSILON) {
      length = Math.hypot(entity.vx, entity.vy) || 1;
      normalX = -entity.vx / length;
      normalY = -entity.vy / length;
    } else {
      normalX /= length;
      normalY /= length;
    }
    const contactDistance = target.radius + entity.radius + CONTACT_NUDGE;
    entity.x = target.x + normalX * contactDistance;
    entity.y = target.y + normalY * contactDistance;
    const approach = entity.vx * normalX + entity.vy * normalY;
    if (approach < 0) {
      entity.vx -= 2 * approach * normalX;
      entity.vy -= 2 * approach * normalY;
    }
  }

  function advanceBottle(entity, arena, services, dt) {
    let remaining = dt;
    while (remaining > EPSILON && entity.entityActive !== false) {
      releaseSeparatedContacts(entity, services);
      const endX = entity.x + entity.vx * remaining, endY = entity.y + entity.vy * remaining;
      const wall = arena.traceSegment(entity.x, entity.y, endX, endY, entity.radius);
      let progress = wall ? wall.t : 1, targetHit = null;
      services.forEachContactEnemy(target => {
        if (entity.contacts.has(target.instanceId)) return;
        const t = firstSegmentCircleContact(entity.x, entity.y, endX, endY, target.x, target.y, entity.radius + target.radius);
        if (t !== null && t <= progress) { progress = t; targetHit = target; }
      });
      entity.x += entity.vx * remaining * progress;
      entity.y += entity.vy * remaining * progress;
      remaining *= 1 - progress;
      if (!targetHit && !wall) break;
      if (targetHit) {
        entity.contacts.add(targetHit.instanceId);
        services.notifyEntityContact(targetHit, entity, { overlapping: true });
        if (rollShatter(entity)) { shatterBottle(entity, services); break; }
        services.dealDamage(targetHit, BOTTLE_CONTACT_DAMAGE);
        if (services.getContactProfile(targetHit).solid) {
          bounceOffTarget(entity, targetHit, entity.x, entity.y);
          const point = arena.clampPoint(entity.x, entity.y, entity.radius);
          entity.x = point.x; entity.y = point.y;
        }
      } else {
        if (rollShatter(entity)) { shatterBottle(entity, services); break; }
        if (arena.shape !== "circle" && wall.normalX && wall.normalY) {
          entity.vx = -entity.vx; entity.vy = -entity.vy;
        } else {
          const dot = entity.vx * wall.normalX + entity.vy * wall.normalY;
          entity.vx -= 2 * dot * wall.normalX; entity.vy -= 2 * dot * wall.normalY;
        }
      }
    }
  }

  function createCocktailBottle(x, y, direction) {
    return {
      kind: "cocktail-bottle", life: BOTTLE_LIFE, radius: BOTTLE_RADIUS, replayDamage: BOTTLE_CONTACT_DAMAGE,
      x, y, vx: direction.x * BOTTLE_SPEED, vy: direction.y * BOTTLE_SPEED,
      spinAngle: 0, shatterChance: SHATTER_BASE_CHANCE, collisions: 0, contacts: new Set(),
      update({ entity, game, services }, dt) {
        entity.spinAngle += TAU * BOTTLE_SPINS_PER_SECOND * dt;
        advanceBottle(entity, resolveArenaGeometry(game), services, dt);
        if (entity.entityActive === false) return;
        services.forEachContactEnemy(target => {
          if (Math.hypot(target.x - entity.x, target.y - entity.y) <= target.radius + entity.radius + CONTACT_RELEASE_DISTANCE)
            services.notifyEntityContact(target, entity, { overlapping: true });
        });
        if (!entity.wick) entity.wick = services.createVisualEffect(createCocktailWickVisual, { anchor: entity });
      },
      draw({ entity, game }, context) { drawCocktailBottle(context, entity.x, entity.y, entity.spinAngle, game.time); }
    };
  }

  const cocktailDefinition = {
    id: "cocktail",
    name: "扎啤",
    englishName: "Cocktail",
    color: ARMY_GREEN,
    description: "军绿燃烧瓶 / 攻击频率0.25起步、0.05/s加速至1（首击4秒） / 弹墙：25%起每次碰撞+15%碎裂 / 碎成4-5片1伤子弹与半径30火海（接触每0.3秒-1，离开后每0.5秒-1，共2次）",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let attackTimer = 0;
      let attackFrequency = ATTACK_FREQUENCY_START;
      let attackInterval = ATTACK_INTERVAL_START;
      let throwRecoil = 0;
      let heldWick = null;
      const heldAnchor = { x: 0, y: 0, spinAngle: 0, entityActive: true };
      function updateHeld(ball) { Object.assign(heldAnchor, heldBottlePose(ball, throwRecoil)); }
      function stopHeld() {
        heldAnchor.entityActive = false;
        if (heldWick) heldWick.visualActive = false;
        heldWick = null;
      }
      return {
        onSpawn({ ball }) {
          attackTimer = 0;
          attackFrequency = ATTACK_FREQUENCY_START;
          attackInterval = ATTACK_INTERVAL_START;
          updateHeld(ball);
          heldAnchor.entityActive = true;
          heldWick = services.createVisualEffect(createCocktailWickVisual, { anchor: heldAnchor }, { lifecycle: "owner-bound" });
        },
        onAttackTransfer({ ball }) { updateHeld(ball); },
        afterUpdateStepWhilePaused({ ball }) { updateHeld(ball); },
        onDeath: stopHeld,
        onBorrowEnd: stopHeld,
        onBattleEnd: stopHeld,
        onBattleDispose: stopHeld,
        update(_context, dt) {
          const step = Math.max(0, dt);
          attackFrequency = Math.min(
            ATTACK_FREQUENCY_MAX,
            attackFrequency + ATTACK_FREQUENCY_ACCELERATION * step
          );
          attackTimer = Math.min(attackInterval, attackTimer + step);
          if (throwRecoil > 0) throwRecoil = Math.max(0, throwRecoil - step);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, attackInterval - attackTimer);
        },
        afterUpdateStep(context) {
          updateHeld(context.ball);
          if (attackTimer + EPSILON < attackInterval) return;
          attackTimer = 0;
          // 下一次间隔用当前攻击频率重算；首个间隔固定为 4 秒。
          attackInterval = 1 / attackFrequency;
          const ball = context.ball;
          if (!ball || ball.hp <= 0) return;
          const target = services.getOpponent();
          if (!target) return;
          throwRecoil = THROW_RECOIL_TIME;
          updateHeld(ball);
          const arena = resolveArenaGeometry(context.game);
          const origin = arena.clampPoint(ball.x + ball.radius * 0.92 + 4, ball.y + 3, BOTTLE_RADIUS);
          services.spawnProjectile(createCocktailBottle(origin.x, origin.y, aimDirection(origin, target)));
        },
        getCocktailState() {
          return { attackTimer, attackFrequency, attackInterval, throwRecoil };
        },
        drawAfter({ ball, game }, context) {
          const pose = heldBottlePose(ball, throwRecoil);
          drawCocktailBottle(context, pose.x, pose.y, pose.spinAngle, game.time);
        }
      };
    }
  };

  registerBall(cocktailDefinition);

  return {
    cocktailDefinition,
    createCocktailBottle,
    createCocktailShard,
    createCocktailFire,
    createCocktailBurnEffect,
    cocktailRules: Object.freeze({
      attackFrequencyStart: ATTACK_FREQUENCY_START,
      attackFrequencyAcceleration: ATTACK_FREQUENCY_ACCELERATION,
      attackFrequencyMax: ATTACK_FREQUENCY_MAX,
      attackIntervalStart: ATTACK_INTERVAL_START,
      bottleSpeed: BOTTLE_SPEED,
      bottleSpinsPerSecond: BOTTLE_SPINS_PER_SECOND,
      bottleRadius: BOTTLE_RADIUS,
      bottleLife: BOTTLE_LIFE,
      shatterBaseChance: SHATTER_BASE_CHANCE,
      shatterChanceGrowth: SHATTER_CHANCE_GROWTH,
      bottleContactDamage: BOTTLE_CONTACT_DAMAGE,
      contactReleaseDistance: CONTACT_RELEASE_DISTANCE,
      fragmentMinCount: FRAGMENT_MIN_COUNT,
      fragmentMaxCount: FRAGMENT_MAX_COUNT,
      fragmentMinSpeed: FRAGMENT_MIN_SPEED,
      fragmentMaxSpeed: FRAGMENT_MAX_SPEED,
      fragmentDeceleration: FRAGMENT_DECELERATION,
      fragmentDamage: FRAGMENT_DAMAGE,
      fragmentRadius: FRAGMENT_RADIUS,
      fireRadius: FIRE_RADIUS,
      fireLife: FIRE_LIFE,
      fireTickInterval: FIRE_TICK_INTERVAL,
      fireTickDamage: FIRE_TICK_DAMAGE,
      burnId: BURN_ID,
      burnDuration: BURN_DURATION,
      burnTickInterval: BURN_TICK_INTERVAL,
      burnTickDamage: BURN_TICK_DAMAGE
    })
  };
});
