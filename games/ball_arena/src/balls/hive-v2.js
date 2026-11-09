(function initializeHiveV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"),
      require("../core/arena-geometry.js"),
      require("../core/contact-model.js"), require("./hive-v2-visuals.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createHiveV2Plugin({
  registerBall, createArenaGeometry, firstSegmentCircleContact, HIVE_V2_VISUAL_COLORS,
  drawHiveV2Body, drawHiveV2Nest, drawHiveV2Aura, drawHiveV2Bee
}) {
  const EPSILON = 1e-9;
  const hiveV2Config = Object.freeze({
    THROW_INTERVAL: 4,
    THROW_DURATION: 0.45,
    THROW_HEIGHT: 35,
    NEST_HP: 8,
    NEST_RADIUS: 10,
    AURA_RADIUS: 50,
    DWELL_INTERVAL: 0.2,
    BEE_SPEED: 240,
    BEE_RADIUS: 3,
    BEE_LIFE: 3,
    BEE_DAMAGE: 1,
    POISON_DURATION: 3,
    POISON_INTERVAL: 1,
    POISON_DAMAGE: 1
  });
  const RULES = hiveV2Config;

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function createHiveV2PoisonEffect() {
    return {
      id: "hive-v2-poison",
      duration: RULES.POISON_DURATION,
      attackTags: ["poison"],
      onApply({ effect, game, isRefresh }) {
        // A single shared status: frequent stings extend expiry, not the tick clock.
        if (!isRefresh) {
          effect.startedAt = game.time;
          effect.nextDamageAt = game.time + RULES.POISON_INTERVAL;
        }
      },
      update({ ball, effect, game, services }) {
        while (ball.hp > 0 && game.time + EPSILON >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + EPSILON) {
          services.dealDamage(ball, RULES.POISON_DAMAGE);
          effect.nextDamageAt += RULES.POISON_INTERVAL;
        }
        if (game.time + EPSILON >= effect.expiresAt) effect.expiresAt = game.time;
      },
      draw({ ball, effect, game }, ctx) {
        const phase = (game.time - effect.startedAt) * 2.4;
        ctx.save();
        ctx.fillStyle = "#a8ce62";
        ctx.globalAlpha *= 0.75;
        for (let index = 0; index < 4; index += 1) {
          const angle = phase + index * Math.PI / 2;
          const distance = ball.radius + 3 + Math.sin(phase + index) * 1.5;
          ctx.beginPath();
          ctx.arc(ball.x + Math.cos(angle) * distance,
            ball.y + Math.sin(angle) * distance, 0.8, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    };
  }

  function createHiveV2Bee(nest, target, metadata = {}) {
    const x = nest.x + 0.3;
    const y = nest.y + 3.6;
    const angle = Math.atan2(target.y - y, target.x - x);
    return {
      kind: "hive-v2-bee",
      attackTags: ["physical", "piercing"],
      life: RULES.BEE_LIFE,
      radius: RULES.BEE_RADIUS,
      damage: RULES.BEE_DAMAGE,
      color: HIVE_V2_VISUAL_COLORS.bee,
      x, y,
      vx: Math.cos(angle) * RULES.BEE_SPEED,
      vy: Math.sin(angle) * RULES.BEE_SPEED,
      targetInstanceId: target.instanceId,
      credit: metadata.credit || nest,
      targetPolicy: metadata.targetPolicy || null,
      damageOutputScale: Number.isFinite(metadata.damageOutputScale)
        ? metadata.damageOutputScale : nest.damageOutputScale,
      update({ entity, services }, dt) {
        let enemy = services.getBall(entity.targetInstanceId);
        if (!enemy || enemy.hp <= 0 || enemy.active === false || enemy.isModeBench === true ||
          !services.isEnemy(enemy) ||
          !services.getContactProfile(enemy).attackable) enemy = services.getOpponent();
        if (!enemy) {
          entity.entityActive = false;
          return;
        }
        entity.targetInstanceId = enemy.instanceId;
        const heading = Math.atan2(enemy.y - entity.y, enemy.x - entity.x);
        entity.vx = Math.cos(heading) * RULES.BEE_SPEED;
        entity.vy = Math.sin(heading) * RULES.BEE_SPEED;
        const startX = entity.x;
        const startY = entity.y;
        const travelTime = Math.min(Math.max(0, dt), Math.max(0, entity.life - entity.age));
        const endX = startX + entity.vx * travelTime;
        const endY = startY + entity.vy * travelTime;
        const hit = services.getFirstEnemyHit(startX, startY, endX, endY, entity.radius);
        entity.x = endX;
        entity.y = endY;
        if (!hit) return;
        if (services.tryConsumeEntity(hit, entity)) {
          entity.entityActive = false;
          return;
        }
        entity.entityActive = false;
        if (services.dealDamage(hit, RULES.BEE_DAMAGE)) {
          services.applyEffect(hit, createHiveV2PoisonEffect());
          services.spawnParticleBurst({
            kind: "hive-v2-sting", x: hit.x, y: hit.y, count: 8,
            minDiameter: 0.6, maxDiameter: 1.7, minSpeed: 18, maxSpeed: 50,
            colors: ["#f2d984", "#da8a27", "#a8ce62"], life: 0.24
          });
        }
      },
      draw({ entity }, ctx) {
        drawHiveV2Bee({ x: entity.x, y: entity.y,
          angle: Math.atan2(entity.vy, entity.vx), age: entity.age }, ctx);
      }
    };
  }

  function createHiveV2NestDefinition(options = {}) {
    const thrown = Number.isFinite(options.targetX) && Number.isFinite(options.targetY);
    return {
      id: "hive-v2-nest",
      name: "蜜蜂巢穴",
      color: HIVE_V2_VISUAL_COLORS.hive,
      fixedStructure: true,
      stats: { radius: RULES.NEST_RADIUS, speed: 1, maxHp: RULES.NEST_HP },
      createBehavior(services) {
        let flightElapsed = thrown ? 0 : RULES.THROW_DURATION;
        let landedAt = null;
        let justLanded = false;
        let startX;
        let startY;
        let targetX;
        let targetY;
        let nest;
        const dwell = new Map();
        const children = new Set();
        const metadata = {
          credit: options.credit,
          targetPolicy: options.targetPolicy || null,
          damageOutputScale: options.damageOutputScale
        };

        function pruneBees() {
          for (const bee of children) {
            if (!bee || bee.entityActive === false || bee.age >= bee.life) children.delete(bee);
          }
        }

        return {
          onSpawn({ ball, game }) {
            nest = ball;
            startX = Number.isFinite(options.startX) ? options.startX : ball.x;
            startY = Number.isFinite(options.startY) ? options.startY : ball.y;
            const arena = game.arena || createArenaGeometry(game.arenaSize);
            const destination = arena.clampPoint(thrown ? options.targetX : ball.x,
              thrown ? options.targetY : ball.y, ball.radius);
            targetX = destination.x;
            targetY = destination.y;
            if (!thrown) landedAt = game.time;
          },
          update({ ball, game }, dt) {
            pruneBees();
            if (flightElapsed >= RULES.THROW_DURATION) return;
            flightElapsed = Math.min(RULES.THROW_DURATION, flightElapsed + Math.max(0, dt));
            const progress = flightElapsed / RULES.THROW_DURATION;
            ball.x = startX + (targetX - startX) * progress;
            ball.y = startY + (targetY - startY) * progress;
            if (flightElapsed + EPSILON >= RULES.THROW_DURATION) {
              flightElapsed = RULES.THROW_DURATION;
              ball.x = targetX;
              ball.y = targetY;
              landedAt = game.time;
              justLanded = true;
              services.spawnParticleBurst({
                kind: "hive-v2-landing", x: ball.x, y: ball.y + 8, count: 10,
                colors: ["#f2d984", "#da8a27"], minDiameter: 0.6, maxDiameter: 1.5,
                minSpeed: 10, maxSpeed: 30, life: 0.3
              }, { drawLayer: "background" });
            }
          },
          getNextTransitionIn() {
            if (flightElapsed < RULES.THROW_DURATION) {
              return Math.max(EPSILON, RULES.THROW_DURATION - flightElapsed);
            }
            let boundary = RULES.DWELL_INTERVAL;
            for (const entry of dwell.values()) {
              boundary = Math.min(boundary, RULES.DWELL_INTERVAL - entry.elapsed);
            }
            return Math.max(EPSILON, boundary);
          },
          getContactProfile() {
            const landed = flightElapsed >= RULES.THROW_DURATION;
            return { physical: landed, targetable: landed };
          },
          afterUpdateStep({ ball, game }, dt) {
            if (flightElapsed < RULES.THROW_DURATION) return;
            // A planted nest is anchored even when alternate arena physics separates bodies.
            ball.x = targetX;
            ball.y = targetY;
            if (justLanded) {
              justLanded = false;
              return;
            }
            services.forEachEnemy((enemy) => {
              const fromX = Number.isFinite(enemy.prevX) ? enemy.prevX : enemy.x;
              const fromY = Number.isFinite(enemy.prevY) ? enemy.prevY : enemy.y;
              const radius = RULES.AURA_RADIUS + enemy.radius;
              const enter = firstSegmentCircleContact(fromX, fromY, enemy.x, enemy.y,
                ball.x, ball.y, radius);
              const reverse = firstSegmentCircleContact(enemy.x, enemy.y, fromX, fromY,
                ball.x, ball.y, radius);
              if (enter === null || reverse === null) return;
              const startsInside = Math.hypot(fromX - ball.x, fromY - ball.y) <= radius + EPSILON;
              const endsInside = Math.hypot(enemy.x - ball.x, enemy.y - ball.y) <= radius + EPSILON;
              const prior = dwell.get(enemy.instanceId);
              const entry = prior && startsInside ? prior : { elapsed: 0, seenAt: game.time };
              entry.elapsed += Math.max(0, 1 - enter - reverse) * Math.max(0, dt);
              entry.seenAt = game.time;
              while (entry.elapsed + EPSILON >= RULES.DWELL_INTERVAL) {
                entry.elapsed = Math.max(0, entry.elapsed - RULES.DWELL_INTERVAL);
                const bee = services.spawnProjectile(createHiveV2Bee(ball, enemy, metadata));
                children.add(bee);
              }
              if (endsInside) dwell.set(enemy.instanceId, entry);
              else dwell.delete(enemy.instanceId);
            });
            for (const [id, entry] of dwell) {
              if (entry.seenAt !== game.time) dwell.delete(id);
            }
          },
          afterUpdateStepWhilePaused({ ball }) {
            if (flightElapsed >= RULES.THROW_DURATION) {
              ball.x = targetX;
              ball.y = targetY;
            }
          },
          onDeath({ ball }) {
            dwell.clear();
            services.spawnParticleBurst({
              kind: "hive-v2-nest-break", x: ball.x, y: ball.y, count: 16,
              colors: ["#da8a27", "#bf7420", "#edae59"],
              minDiameter: 0.8, maxDiameter: 2.8, life: 0.45
            });
          },
          hasLiveBees() {
            pruneBees();
            return children.size > 0;
          },
          retireForBorrowEnd() {
            dwell.clear();
            for (const bee of children) bee.entityActive = false;
            children.clear();
            if (nest) nest.hp = 0;
          },
          drawBefore({ ball, game }, ctx) {
            if (flightElapsed >= RULES.THROW_DURATION) {
              drawHiveV2Aura({ x: ball.x, y: ball.y, auraRadius: RULES.AURA_RADIUS,
                phase: game.time * 2 }, ctx);
              return;
            }
            const progress = flightElapsed / RULES.THROW_DURATION;
            ctx.save();
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.beginPath();
            ctx.ellipse(ball.x, ball.y + 10, 8, 2.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            // Renderer restores the group; this raises both the nest and its default HP.
            ctx.translate(0, -Math.sin(progress * Math.PI) * RULES.THROW_HEIGHT);
          },
          drawBody({ ball, game }, ctx) {
            const age = landedAt === null ? 1 : Math.max(0, game.time - landedAt);
            const squash = age < 0.2 ? Math.sin(age / 0.2 * Math.PI) * 0.1 : 0;
            ctx.save();
            ctx.translate(ball.x, ball.y + 12);
            ctx.scale(1 + squash, 1 - squash);
            drawHiveV2Nest({ x: 0, y: -12, radius: ball.radius }, ctx);
            ctx.restore();
            return true;
          }
        };
      }
    };
  }

  const hiveV2Definition = {
    id: "hiveV2",
    name: "蜂巢V2",
    englishName: "Hive V2",
    color: HIVE_V2_VISUAL_COLORS.body,
    description: "每4秒抛巢 / 巢穴8血永久存在 / 光环停留0.2秒出追踪蜂 / 蜂伤1+中毒1×3（不叠加）",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let timer = 0;
      const nests = new Set();
      return {
        onAttackBorrowStart(context) {
          timer = RULES.THROW_INTERVAL;
          this.afterUpdateStep(context);
        },
        isAttackCycleComplete() { return nests.size > 0; },
        update(_context, dt) {
          timer = Math.min(RULES.THROW_INTERVAL, timer + Math.max(0, dt));
          for (const nest of nests) {
            if (nest.hp <= 0 && !nest.behavior.hasLiveBees()) nests.delete(nest);
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, RULES.THROW_INTERVAL - timer);
        },
        afterUpdateStep({ ball }) {
          if (timer + EPSILON < RULES.THROW_INTERVAL) return;
          timer = 0;
          const enemy = services.getOpponent();
          if (!enemy) return;
          const nest = services.spawnSummon(createHiveV2NestDefinition({
            startX: ball.x, startY: ball.y, targetX: enemy.x, targetY: enemy.y,
            credit: ball,
            targetPolicy: ball.targetPolicy || (ball.forcedTargetInstanceId
              ? { forcedTargetInstanceId: ball.forcedTargetInstanceId } : null),
            damageOutputScale: ball.damageOutputScale
          }), { x: ball.x, y: ball.y, movementLocked: true, positionLocked: true });
          if (nest) nests.add(nest);
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, 1, { attackTags: ["physical", "impact"] });
          }
        },
        onBorrowEnd() {
          if (!services.borrowedAttackOnly) {
            for (const nest of nests) nest.behavior.retireForBorrowEnd();
          }
          nests.clear();
          timer = 0;
        },
        drawBody: drawHiveV2Body
      };
    }
  };

  registerBall(hiveV2Definition);
  return { hiveV2Definition, hiveV2Config, createHiveV2NestDefinition,
    createHiveV2Bee, createHiveV2PoisonEffect };
});
