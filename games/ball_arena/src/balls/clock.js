(function initializeClock(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
        ...require("../core/contact-model.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createClockPlugin({ registerBall, resolveArenaGeometry, firstSegmentCircleContact }) {
  const FIRE_INTERVAL = 1.5;
  const CLOCK_SPEED = 90;
  const CLOCK_RADIUS = 7;
  const ELAPSE_THRESHOLD = 24;
  const INSCRIPTION_DAMAGE = 12;
  const INSCRIPTION_FLIGHT_TIME = 0.45;
  const STUN_DURATION = 3;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function directionTo(x, y, target) {
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    return distance > EPSILON ? { x: dx / distance, y: dy / distance } : { x: 1, y: 0 };
  }

  function createClockStun() {
    return {
      id: "clock-inscription-stun",
      duration: STUN_DURATION,
      visualType: "stun",
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      onApply({ ball }) {
        ball.vx = ball.vy = 0;
      },
      update({ ball }) {
        ball.vx = ball.vy = 0;
      },
      onExpire({ ball, services }) {
        if (services.isMovementLocked(ball)) return;
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
      },
      drawBefore({ game }, context) {
        const phase = Math.floor(game.time * 48) % 4;
        context.translate(phase === 0 ? -1.4 : phase === 2 ? 1.4 : 0, phase === 1 ? -0.8 : phase === 3 ? 0.8 : 0);
      }
    };
  }

  function burst(services, x, y, inscription = false) {
    services.spawnParticleBurst({
      kind: inscription ? "clock-inscription-impact" : "clock-impact",
      x,
      y,
      colors: inscription ? ["#fff8da", "#e6c678", "#ffffff"] : ["#c5c8ce", "#f0ede3", "#686c75"],
      count: inscription ? 24 : 12,
      minDiameter: 1,
      maxDiameter: 3,
      minSpeed: 28,
      maxSpeed: inscription ? 95 : 60,
      life: inscription ? 0.45 : 0.3,
      ring: inscription ? { color: "#e6c678", lineWidth: 1, startRadius: 3, endRadius: 23 } : undefined
    });
  }

  function drawClock(entity, context) {
    context.save();
    context.translate(entity.x, entity.y);
    context.rotate(Math.sin(entity.age * 4) * 0.15);
    context.fillStyle = "#34363c";
    context.strokeStyle = "#b9bec7";
    context.lineWidth = 0.9;
    context.beginPath();
    context.arc(0, 0, CLOCK_RADIUS, 0, TWO_PI);
    context.fill();
    context.stroke();
    context.fillStyle = "#ece9df";
    context.beginPath();
    context.arc(0, 0, CLOCK_RADIUS - 1.5, 0, TWO_PI);
    context.fill();
    context.strokeStyle = "#44464d";
    context.lineWidth = 0.65;
    for (let index = 0; index < 12; index += 1) {
      const angle = index / 12 * TWO_PI;
      const inner = index % 3 === 0 ? 3.7 : 4.2;
      context.beginPath();
      context.moveTo(Math.sin(angle) * inner, -Math.cos(angle) * inner);
      context.lineTo(Math.sin(angle) * 4.8, -Math.cos(angle) * 4.8);
      context.stroke();
    }
    const minute = entity.age * 5;
    const hour = -Math.PI / 3 + entity.age * 0.45;
    context.lineWidth = 1;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(Math.sin(hour) * 2.8, -Math.cos(hour) * 2.8);
    context.lineTo(0, 0);
    context.lineTo(Math.sin(minute) * 3.8, -Math.cos(minute) * 3.8);
    context.stroke();
    context.fillStyle = "#b65648";
    context.beginPath();
    context.arc(0, 0, 0.85, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  function createClockProjectile(ball, target, arenaSize, onHit) {
    const arena = resolveArenaGeometry(arenaSize);
    const direction = directionTo(ball.x, ball.y, target);
    return {
      kind: "clock-projectile",
      life: ((arena.shape === "circle" ? arena.width : Math.hypot(arena.width, arena.height)) + CLOCK_RADIUS * 2) / CLOCK_SPEED,
      radius: CLOCK_RADIUS,
      color: "#c5c8ce",
      x: ball.x,
      y: ball.y,
      vx: direction.x * CLOCK_SPEED,
      vy: direction.y * CLOCK_SPEED,
      update({ entity, game, services }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        const hit = services.getFirstEnemyHit(startX, startY, entity.x, entity.y, entity.radius);
        if (hit) {
          const contact = firstSegmentCircleContact(startX, startY, entity.x, entity.y, hit.x, hit.y, hit.radius + entity.radius);
          entity.x = startX + (entity.x - startX) * contact;
          entity.y = startY + (entity.y - startY) * contact;
          entity.entityActive = false;
          const damage = 1 + Math.floor(Math.random() * 12);
          if (services.dealDamage(hit, damage)) onHit(13 - damage);
          burst(services, entity.x, entity.y);
          return;
        }
        if (!resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, entity.radius)) {
          entity.entityActive = false;
        }
      },
      draw({ entity }, context) {
        drawClock(entity, context);
      }
    };
  }

  function createClockInscription(ball, target) {
    const direction = directionTo(ball.x, ball.y, target);
    return {
      kind: "clock-inscription",
      life: INSCRIPTION_FLIGHT_TIME + 0.1,
      radius: 4,
      color: "#e6c678",
      damage: INSCRIPTION_DAMAGE,
      x: ball.x,
      y: ball.y,
      vx: direction.x * 400,
      vy: direction.y * 400,
      targetInstanceId: target.instanceId,
      elapsed: 0,
      update({ entity, services }, dt) {
        let target = services.getBall(entity.targetInstanceId);
        if (!target || target.hp <= 0 || target.active === false || !services.isEnemy(target)) {
          target = services.getOpponent();
          if (!target) {
            entity.entityActive = false;
            return;
          }
          entity.targetInstanceId = target.instanceId;
        }
        const startX = entity.x;
        const startY = entity.y;
        // Shrinking arrival time guarantees interception even after a dash or teleport.
        const remaining = Math.max(EPSILON, INSCRIPTION_FLIGHT_TIME - entity.elapsed);
        const progress = Math.min(1, dt / remaining);
        entity.vx = (target.x - startX) / remaining;
        entity.vy = (target.y - startY) / remaining;
        entity.x += (target.x - startX) * progress;
        entity.y += (target.y - startY) * progress;
        entity.elapsed += dt;
        const contact = firstSegmentCircleContact(startX, startY, entity.x, entity.y, target.x, target.y, target.radius + entity.radius);
        if (contact === null) return;
        entity.x = startX + (entity.x - startX) * contact;
        entity.y = startY + (entity.y - startY) * contact;
        entity.entityActive = false;
        if (services.dealDamage(target, INSCRIPTION_DAMAGE) && target.hp > 0) {
          services.applyEffect(target, createClockStun());
        }
        burst(services, entity.x, entity.y, true);
      },
      draw({ entity }, context) {
        context.save();
        context.translate(entity.x, entity.y);
        context.rotate(Math.atan2(entity.vy, entity.vx));
        context.strokeStyle = "#e6c678";
        context.lineWidth = 1;
        context.globalAlpha *= 0.45;
        context.beginPath();
        context.moveTo(-6, -2);
        context.lineTo(-19, -1);
        context.moveTo(-6, 2);
        context.lineTo(-16, 1);
        context.stroke();
        context.globalAlpha /= 0.45;
        context.fillStyle = "#555044";
        context.beginPath();
        context.moveTo(8, 0);
        context.lineTo(3, -4);
        context.lineTo(-7, -4);
        context.lineTo(-7, 4);
        context.lineTo(3, 4);
        context.closePath();
        context.fill();
        context.stroke();
        context.strokeStyle = "#fff8da";
        context.beginPath();
        context.moveTo(-4, -2);
        context.lineTo(0, 2);
        context.moveTo(-4, 2);
        context.lineTo(0, -2);
        context.moveTo(2, -2);
        context.lineTo(2, 2);
        context.moveTo(4, -1.5);
        context.lineTo(4, 1.5);
        context.stroke();
        context.restore();
      }
    };
  }

  const clockDefinition = {
    id: "clock",
    name: "\u65f6\u949f",
    englishName: "Clock",
    color: "#414247",
    description: "\u6bcf1.5\u79d2\u629b\u51fa\u65f6\u949f / 1-12\u968f\u673a\u4f24\u5bb3 / \u6d41\u901d\u70b9\u6ee124\u53d1\u5c04\u94ed\u6587\u5f39 / 12\u4f24\u5bb3\u5e763\u79d2\u98a4\u6296\u7729\u6655",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let remaining = FIRE_INTERVAL;
      let elapsePoints = 0;
      let retired = false;
      function retire() {
        retired = true;
        elapsePoints = 0;
      }
      return {
        update(context, dt) {
          if (retired) return;
          remaining = Math.max(0, remaining - dt);
        },
        afterUpdateStep({ ball, game }) {
          if (retired) return;
          const target = services.getOpponent();
          if (!target) return;
          while (elapsePoints >= ELAPSE_THRESHOLD) {
            elapsePoints -= ELAPSE_THRESHOLD;
            services.spawnProjectile(createClockInscription(ball, target));
          }
          if (remaining > EPSILON) return;
          remaining = FIRE_INTERVAL;
          services.spawnProjectile(createClockProjectile(ball, target, game.arena || game.arenaSize, (points) => {
            if (!retired) elapsePoints += points;
          }));
        },
        getNextTransitionIn() {
          return remaining > EPSILON ? remaining : undefined;
        },
        getClockState() {
          return { elapsePoints, remaining };
        },
        onDeath: retire,
        onBorrowEnd: retire
      };
    }
  };

  registerBall(clockDefinition);
  return { clockDefinition, createClockProjectile, createClockInscription, createClockStun };
});
