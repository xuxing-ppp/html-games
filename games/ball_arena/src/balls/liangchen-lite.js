(function initializeLiangchenLite(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js"),
        ...require("./liangchen-iii.js")
      }
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenLitePlugin(dependencies) {
  "use strict";
  const { registerBall, applyDamageReduction, createBloodDroplet } = dependencies;

  const EPSILON = 1e-9;
  const RULES = Object.freeze({
    bodyDamage: 1,
    pulseInterval: 0.2,
    maxHpFraction: 0.01,
    freedomDuration: 1,
    freedomPeriodScale: 10,
    initialSurvivalFactor: 0.1,
    recoverySurvivalFactor: 0.9,
    dropletSpeed: 300,
    dropletLife: 9999,
    auraRefreshLead: 0.12,
    fieldKind: "liangchen-lite-blood-field",
    holdEffectId: "liangchen-lite-hold",
    freedomEffectId: "liangchen-lite-freedom"
  });

  function drawFreedom({ ball, effect, game }, ctx) {
    const fraction = Math.max(0, Math.min(1, (effect.expiresAt - game.time) / RULES.freedomDuration));
    ctx.save();
    ctx.strokeStyle = "#f3c778";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fraction);
    ctx.stroke();
    ctx.restore();
  }

  const liangchenLiteDefinition = {
    id: "liangchenLite",
    name: "良辰Lite",
    englishName: "Liangchen Lite",
    color: "#960c04",
    rosterType: "outOfSpec",
    description: "15血 / 1撞伤 / 初始90%减伤 / 全场每0.2秒流失1%最大血量真伤并溅血(无数量上限) / 常驻眩晕，碰撞释放1秒但攻击节奏仅10% / 血滴穿身恢复与减伤成长",
    stats: { radius: 15, speed: 150, maxHp: 15 },
    createBehavior(services) {
      let survivalFactor = RULES.initialSurvivalFactor;
      let field = null;
      const targets = new Map();

      function effectIds(ball) {
        return {
          hold: `${RULES.holdEffectId}:${ball.instanceId}`,
          freedom: `${RULES.freedomEffectId}:${ball.instanceId}`
        };
      }

      function applyControl(ball, target, state, now) {
        const ids = effectIds(ball);
        if (state.freeUntil > now + EPSILON) {
          services.clearEffect(target, ids.hold);
          services.applyEffect(target, {
            id: ids.freedom,
            duration: state.freeUntil - now,
            attackPeriodScale: RULES.freedomPeriodScale,
            draw: drawFreedom
          });
        } else {
          services.clearEffect(target, ids.freedom);
          services.applyEffect(target, {
            id: ids.hold,
            duration: RULES.auraRefreshLead,
            speedFactor: 0,
            pausesBehavior: true,
            preventsAttack: true,
            visualType: "stun"
          });
        }
      }

      function refreshControl({ ball, game }) {
        for (const [id, state] of targets) {
          if (state.target.hp <= 0 || !services.isEnemy(state.target)) {
            const ids = effectIds(ball);
            services.clearEffect(state.target, ids.hold);
            services.clearEffect(state.target, ids.freedom);
            // Retire this departed enemy's stream, including descendants, so
            // survival-mode spawns cannot leave an unbounded blood population.
            for (const entity of game.combatEntities) {
              if (entity.ownerInstanceId === ball.instanceId &&
                  entity.originTargetId === id && entity.kind === "liangchen-iii-blood-droplet") {
                entity.entityActive = false;
              }
            }
            targets.delete(id);
          }
        }
        services.forEachEnemy(target => {
          let state = targets.get(target.instanceId);
          if (!state) {
            state = { target, freeUntil: 0 };
            targets.set(target.instanceId, state);
          }
          applyControl(ball, target, state, game.time);
        });
      }

      function onDropletPass(owner, sourceServices) {
        survivalFactor *= RULES.recoverySurvivalFactor;
        owner.hp += 1;
        sourceServices.spawnHitText(owner, "+1", { color: "#81e79a" });
      }

      // 血滴没有数量上限：每次脉冲命中敌人就溅一滴（命中即被一对一换成子血滴，
      // 敌人离场时整条链一起清理，靠这两点自限，不再滚动淘汰）。
      function emitDroplet(context, target) {
        const angle = Math.random() * Math.PI * 2;
        context.services.spawnProjectile(createBloodDroplet(
          target.x + Math.cos(angle) * (target.radius + 1),
          target.y + Math.sin(angle) * (target.radius + 1),
          Math.cos(angle) * RULES.dropletSpeed,
          Math.sin(angle) * RULES.dropletSpeed,
          true, target.instanceId, onDropletPass,
          {
            life: RULES.dropletLife,
            passThroughOwner: true,
            inheritReclaim: true,
            originTargetId: target.instanceId
          }
        ));
      }

      function dispose({ ball }) {
        if (field) field.entityActive = false;
        field = null;
        const ids = effectIds(ball);
        for (const state of targets.values()) {
          services.clearEffect(state.target, ids.hold);
          services.clearEffect(state.target, ids.freedom);
        }
        targets.clear();
      }

      return {
        onSpawn({ game }) {
          let nextPulseAt = game.time + RULES.pulseInterval;
          field = services.spawnCombatEntity({
            kind: RULES.fieldKind,
            combatKind: "zone",
            attackTags: ["true-damage"],
            life: RULES.dropletLife,
            lifecycle: "owner-bound",
            targetable: false,
            update(context) {
              // Real simulation time, independent of personal attack slow/stun.
              if (context.game.time + EPSILON < nextPulseAt) return;
              while (context.game.time + EPSILON >= nextPulseAt) {
                nextPulseAt += RULES.pulseInterval;
                context.services.forEachEnemy(target => {
                  context.services.dealDamage(target, target.maxHp * RULES.maxHpFraction, {
                    accumulateHitText: true
                  });
                  if (target.hp > 0) emitDroplet(context, target);
                });
              }
            }
          });
        },
        beforeUpdateStep: refreshControl,
        afterUpdateStep: refreshControl,
        afterUpdateStepWhilePaused: refreshControl,
        update() {},
        updateWhilePaused() {},
        onCollision(context, target) {
          context.services.dealDamage(target, RULES.bodyDamage);
          if (target.hp <= 0) return;
          const state = { target, freeUntil: context.game.time + RULES.freedomDuration };
          targets.set(target.instanceId, state);
          applyControl(context.ball, target, state, context.game.time);
        },
        onBeforeDamage(_context, event) {
          return applyDamageReduction(event, 1 - survivalFactor, Math.random);
        },
        onDeath: dispose,
        onBorrowEnd: dispose,
        getLiangchenLiteState() {
          return { survivalFactor };
        }
      };
    }
  };

  registerBall(liangchenLiteDefinition);
  return { liangchenLiteDefinition, LIANGCHEN_LITE_RULES: RULES };
});
