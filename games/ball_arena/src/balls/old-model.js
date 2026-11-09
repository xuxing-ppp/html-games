(function initializeOldModel(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOldModelPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall } = dependencies;

  const EPSILON = 1e-9;
  const RULES = Object.freeze({
    shield: 15,
    rebuildDuration: 5,
    bulletSpeed: 400,
    bulletDamage: 2,
    burstCount: 3,
    shotInterval: 0.1,
    burstCooldown: 1.8,
    collisionDamage: 5
  });
  const PLATE_COLORS = ["#a8aaa2", "#727e80", "#b08b66", "#8c9794", "#677375", "#a49b83"];

  function createOldModelBullet(ball, target, arenaSize) {
    const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
    return {
      kind: "old-model-bullet",
      life: arenaSize * Math.SQRT2 / RULES.bulletSpeed + 0.1,
      x: ball.x, y: ball.y,
      vx: Math.cos(angle) * RULES.bulletSpeed,
      vy: Math.sin(angle) * RULES.bulletSpeed,
      radius: 2,
      damage: RULES.bulletDamage,
      update({ entity, game, services }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        const target = services.getFirstEnemyHit(startX, startY, entity.x, entity.y, entity.radius);
        if (target) {
          if (!services.tryConsumeEntity(target, entity)) services.dealDamage(target, entity.damage);
          entity.entityActive = false;
          return;
        }
        if (!resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, entity.radius)) {
          entity.entityActive = false;
        }
      },
      draw({ entity }, context) {
        context.save();
        context.translate(entity.x, entity.y);
        context.rotate(Math.atan2(entity.vy, entity.vx));
        context.fillStyle = "#685541";
        context.fillRect(-6, -2, 8, 4);
        context.fillStyle = "#e7c789";
        context.fillRect(-2, -1, 5, 2);
        context.restore();
      }
    };
  }

  // The plates are body artwork, not targetable parts or combat entities.
  function drawOldModelBody({ ball, game }, context, rebuildRemaining, shieldHp) {
    const rebuilding = rebuildRemaining > 0;
    const elapsed = RULES.rebuildDuration - rebuildRemaining;
    const progress = Math.max(0, Math.min(1, elapsed / RULES.rebuildDuration));
    const spread = rebuilding
      ? Math.min(1, elapsed / 0.12) * Math.pow(1 - progress, 0.65)
      : 0;
    const r = ball.radius;
    context.save();
    context.translate(ball.x, ball.y);
    // Exposed dark motor housing remains at the actual, damageable body center.
    context.fillStyle = "#303b3b";
    context.strokeStyle = "#1a2428";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    for (let i = 0; i < PLATE_COLORS.length; i += 1) {
      const angle = i * Math.PI / 3 + 0.2;
      const offset = spread * r * (0.85 + (i % 2) * 0.3);
      context.save();
      context.rotate(angle);
      // Thin rods visually pull each mismatched panel back to the chassis.
      context.strokeStyle = "#75654e";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(r * 0.25, 0);
      context.lineTo(r * 0.7 + offset, 0);
      context.stroke();
      context.translate(offset, 0);
      context.rotate(spread * (i % 2 ? 0.45 : -0.35));
      context.fillStyle = PLATE_COLORS[i];
      context.strokeStyle = "#283338";
      context.lineWidth = 1.1;
      context.beginPath();
      context.moveTo(r * 0.18, -r * 0.12);
      context.lineTo(r * 0.54, -r * 0.79);
      context.lineTo(r * 0.9, -r * 0.43);
      context.lineTo(r, r * 0.16);
      context.lineTo(r * 0.64, r * 0.69);
      context.lineTo(r * 0.2, r * 0.2);
      context.closePath();
      context.fill();
      context.stroke();
      // Scraped edges, a rivet, and a short screwdriver slot.
      context.strokeStyle = "#d1d1bb";
      context.lineWidth = 0.7;
      context.beginPath();
      context.moveTo(r * 0.6, -r * 0.64);
      context.lineTo(r * 0.81, -r * 0.4);
      context.stroke();
      context.fillStyle = "#3c4645";
      context.beginPath();
      context.arc(r * 0.73, r * 0.12, 1.45, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#c0b79a";
      context.fillRect(r * 0.73 - 0.8, r * 0.12 - 0.3, 1.6, 0.6);
      context.restore();
    }
    // Offset amber optic leaves the shared HP/shield label legible in the center.
    context.fillStyle = rebuilding ? "#6d442e" : "#f4c36d";
    context.fillRect(-4, -r * 0.65, 8, 2);
    if (rebuilding) {
      context.strokeStyle = "#d3a364";
      context.lineWidth = 1.3;
      context.beginPath();
      context.arc(0, 0, r + 4, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      context.stroke();
    } else if (shieldHp > 0) {
      context.globalAlpha *= 0.35 + (1 + Math.sin(game.time * 5)) * 0.1;
      context.strokeStyle = "#b9d9cd";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(0, 0, r + 3, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
    return true;
  }

  const oldModelDefinition = {
    id: "oldModel",
    name: "旧型",
    englishName: "Old Model",
    color: "#8c9794",
    description: "铁皮拼装 / 15护盾 / 400弹速，2伤害×3连发，间隔0.1秒，末发后冷却1.8秒 / 碰撞5伤害 / 破盾停机5秒，重组恢复15盾，不回血",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let phase = "attack";
      let shieldHp = RULES.shield;
      let rebuildRemaining = 0;
      let shotRemaining = 0;
      let burstIndex = 0;
      let rebuildPending = false;
      let savedMovementLocked = false;
      let ownsMovementLock = false;

      function releaseMovement() {
        if (ownsMovementLock) services.setMovementLocked(savedMovementLocked);
        ownsMovementLock = false;
      }

      function startRebuild(ball) {
        phase = "rebuild";
        rebuildRemaining = RULES.rebuildDuration;
        rebuildPending = false;
        burstIndex = 0;
        shotRemaining = 0;
        savedMovementLocked = ball.movementLocked === true;
        ownsMovementLock = true;
        services.setMovementLocked(true);
      }

      function updateRebuild(dt) {
        services.setMovementLocked(true);
        rebuildRemaining = Math.max(0, rebuildRemaining - Math.max(0, dt));
        rebuildPending = rebuildRemaining <= EPSILON;
      }

      function finishRebuild({ ball }) {
        if (phase !== "rebuild" || !rebuildPending || ball.hp <= 0) return;
        phase = "attack";
        shieldHp = RULES.shield;
        rebuildRemaining = 0;
        rebuildPending = false;
        releaseMovement();
      }

      function cleanup() {
        releaseMovement();
        shieldHp = 0;
        rebuildRemaining = 0;
        rebuildPending = false;
        burstIndex = 0;
        shotRemaining = 0;
      }

      return {
        update({ ball, game }, dt) {
          if (phase === "rebuild") {
            updateRebuild(dt);
            return;
          }
          shotRemaining -= Math.max(0, dt);
          while (shotRemaining <= EPSILON) {
            const target = services.getOpponent();
            if (!target) { shotRemaining = 0; break; }
            services.spawnProjectile(createOldModelBullet(ball, target, game.arenaSize));
            burstIndex += 1;
            if (burstIndex === RULES.burstCount) {
              burstIndex = 0;
              shotRemaining += RULES.burstCooldown;
            } else {
              shotRemaining += RULES.shotInterval;
            }
          }
        },
        updateWhilePaused(context, dt) {
          // Mechanical assembly continues through ordinary stun; hard seals are
          // handled by the engine and do not dispatch either update hook.
          if (phase === "rebuild") updateRebuild(dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, phase === "rebuild" ? rebuildRemaining : shotRemaining);
        },
        getNextPausedTransitionIn() {
          return phase === "rebuild" ? Math.max(EPSILON, rebuildRemaining) : undefined;
        },
        afterUpdateStep: finishRebuild,
        afterUpdateStepWhilePaused: finishRebuild,
        getCapabilityOverrides() {
          return phase === "rebuild" ? { canMove: false, canBodyAttack: false } : undefined;
        },
        onBeforeDamage({ ball }, event) {
          if (shieldHp <= 0 || event.amount <= 0) return undefined;
          // Match Yuuka: the shield consumes the entire breaking hit, no overflow.
          shieldHp = Math.max(0, shieldHp - event.amount);
          if (shieldHp === 0) startRebuild(ball);
          return { amount: 0, showHitText: false };
        },
        onCollision(context, target) {
          if (phase !== "attack" || context.blockedAtContact) return;
          context.services.dealDamage(target, RULES.collisionDamage);
        },
        getHpDisplay() {
          return shieldHp > 0 ? { shield: shieldHp } : undefined;
        },
        drawBody(context, canvasContext) {
          return drawOldModelBody(context, canvasContext, rebuildRemaining, shieldHp);
        },
        onDeath: cleanup,
        onBorrowEnd: cleanup,
        getOldModelState() {
          return { phase, shieldHp, rebuildRemaining, shotRemaining, burstIndex };
        }
      };
    }
  };

  registerBall(oldModelDefinition);
  return { oldModelDefinition, OLD_MODEL_RULES: RULES, createOldModelBullet };
});
