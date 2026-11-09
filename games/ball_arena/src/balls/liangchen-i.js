(function initializeLiangchenI(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenIPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, firstSegmentCircleContact } = dependencies;

  const RULES = Object.freeze({
    bulletSpeed: 685,
    bulletDamage: 1,
    bulletRadius: 2,
    shotInterval: 0.5,
    bodyDamage: 2,
    regenBelow: 40,
    regenPerSecond: 1
  });
  const EPSILON = 1e-9;
  const BLOOD = "#960c04";
  const BLOOD_LIGHT = "#c8443a";

  function unit(x, y) {
    const length = Math.hypot(x, y);
    return length > EPSILON ? { x: x / length, y: y / length } : { x: 1, y: 0 };
  }

  function createBullet(x, y, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    return {
      kind: "liangchen-i-bullet",
      combatKind: "projectile",
      life: 2.5,
      radius: RULES.bulletRadius,
      damage: RULES.bulletDamage,
      x, y,
      vx: dx * RULES.bulletSpeed,
      vy: dy * RULES.bulletSpeed,
      update({ entity, game, services }, dt) {
        const sx = entity.x, sy = entity.y;
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        const target = services.getFirstEnemyHit(sx, sy, entity.x, entity.y, entity.radius);
        if (target) {
          const t = firstSegmentCircleContact(sx, sy, entity.x, entity.y,
            target.x, target.y, target.radius + entity.radius);
          if (t !== null) {
            entity.x = sx + (entity.x - sx) * t;
            entity.y = sy + (entity.y - sy) * t;
          }
          services.dealDamage(target, entity.damage);
          services.spawnParticleBurst({
            x: entity.x, y: entity.y, count: 4,
            minDiameter: 0.6, maxDiameter: 1.5, life: 0.12,
            colors: [BLOOD_LIGHT, BLOOD], minSpeed: 18, maxSpeed: 42
          });
          entity.entityActive = false;
        }
        if (!resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, entity.radius)) {
          entity.entityActive = false;
        }
      },
      draw({ entity }, context) {
        const dir = unit(entity.vx, entity.vy);
        context.save();
        context.strokeStyle = BLOOD_LIGHT;
        context.lineWidth = 1.4;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(entity.x - dir.x * 6, entity.y - dir.y * 6);
        context.lineTo(entity.x, entity.y);
        context.stroke();
        context.fillStyle = BLOOD;
        context.beginPath();
        context.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  const liangchenIDefinition = {
    id: "liangchenI",
    name: "良辰I",
    englishName: "Liangchen I",
    color: "#960c04",
    description: "血量≤40每秒回1血 / 撞击2伤 / 0.5s一发685速1伤血弹",
    stats: { radius: 15, speed: 80, maxHp: 40 },
    createBehavior(services) {
      let shotTimer = 0;
      let regenAccumulator = 0;

      function regen(ball, dt) {
        if (ball.hp <= 0 || ball.hp >= RULES.regenBelow) {
          regenAccumulator = 0;
          return;
        }
        regenAccumulator += dt;
        if (regenAccumulator >= 1) {
          const heal = Math.floor(regenAccumulator);
          regenAccumulator -= heal;
          ball.hp = Math.min(RULES.regenBelow, ball.hp + heal);
          services.spawnHitText(ball, "+" + heal, { color: "#ff9a8f" });
        }
      }

      return {
        update({ ball, game }, dt) {
          regen(ball, dt);
          shotTimer -= Math.max(0, dt);
        },
        updateWhilePaused({ ball }, dt) {
          regen(ball, dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, shotTimer);
        },
        afterUpdateStep({ ball, game }) {
          if (!services.getCapabilities(ball).canDealDamage) return;
          if (shotTimer > EPSILON) return;
          const target = services.getOpponent();
          if (!target) return;
          const dx = target.x - ball.x, dy = target.y - ball.y;
          const dist = Math.hypot(dx, dy);
          if (dist < EPSILON) return;
          const dir = unit(dx, dy);
          const muzzle = ball.radius + 4;
          services.spawnProjectile(createBullet(
            ball.x + dir.x * muzzle,
            ball.y + dir.y * muzzle,
            Math.atan2(dy, dx)
          ));
          shotTimer = RULES.shotInterval;
          services.playSound("shoot", { intensity: 0.4 });
        },
        afterUpdateStepWhilePaused({ ball }, dt) {
          regen(ball, dt);
        },
        onCollision(context, target) {
          context.services.dealDamage(target, RULES.bodyDamage);
        },
        onBorrowEnd() {
          shotTimer = 0;
          regenAccumulator = 0;
        }
      };
    }
  };

  registerBall(liangchenIDefinition);
  return { liangchenIDefinition, LIANGCHEN_I_RULES: RULES, createBullet };
});
