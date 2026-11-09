(function initializeZaoPepper(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createZaoPepperPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const BATCH_INTERVAL = 5;
  const BOTTLE_COUNT = 5;
  const BOTTLE_RADIUS = 7;
  const BOTTLE_LIFE = 5;
  const OPEN_DURATION = 0.6;
  const PATCH_LIFE = 4.5;
  const PATCH_RADIUS = 48;
  const DAMAGE_INTERVAL = 0.4;
  const EPSILON = 1e-8;
  const TWO_PI = Math.PI * 2;
  const live = (entity) => entity && entity.entityActive !== false && entity.age < entity.life;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createPepperPatch(x, y, hitTimes = new Map()) {
    const pieces = Array.from({ length: 70 }, (_, index) => {
      const angle = index * 2.3999632297;
      const distance = PATCH_RADIUS * Math.sqrt((index + 0.5) / 70);
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance,
        angle: angle + index, length: 2 + index % 4 };
    });
    return {
      kind: "zao-pepper-patch", combatKind: "zone", life: PATCH_LIFE,
      x, y, radius: PATCH_RADIUS, color: "#c84337", drawLayer: "background",
      update({ entity, game, services }) {
        for (const [id, nextAt] of hitTimes) if (nextAt < game.time - DAMAGE_INTERVAL) hitTimes.delete(id);
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable ||
              Math.hypot(target.x - entity.x, target.y - entity.y) > entity.radius + target.radius) return;
          if (hitTimes.has(target.instanceId) && game.time + EPSILON < hitTimes.get(target.instanceId)) return;
          if (services.dealDamage(target, 1)) hitTimes.set(target.instanceId, game.time + DAMAGE_INTERVAL);
        });
      },
      draw({ entity }, context) {
        const spread = Math.min(1, 0.35 + entity.age / 0.16 * 0.65);
        context.save();
        context.translate(entity.x, entity.y);
        context.globalAlpha *= Math.min(1, (entity.life - entity.age) / 0.6);
        context.fillStyle = "rgba(168, 45, 33, 0.16)";
        context.beginPath();
        context.arc(0, 0, entity.radius * spread, 0, TWO_PI);
        context.fill();
        pieces.forEach((piece, index) => {
          context.save();
          context.translate(piece.x * spread, piece.y * spread);
          context.rotate(piece.angle);
          context.fillStyle = ["#da4e3c", "#aa312b", "#ed8052", "#a9b15b"][index % 4];
          context.fillRect(-piece.length / 2, -0.8, piece.length, 1.6);
          if (index % 5 === 0) {
            context.fillStyle = "#f4dba0";
            context.beginPath();
            context.ellipse(2, 2, 1.1, 0.65, 0, 0, TWO_PI);
            context.fill();
          }
          context.restore();
        });
        context.restore();
      }
    };
  }

  function createPepperBottle(x, y) {
    return {
      kind: "zao-pepper-bottle", combatKind: "trap", lifecycle: "owner-bound",
      life: BOTTLE_LIFE, x, y, radius: BOTTLE_RADIUS, color: "#c84337", opening: 0,
      draw({ entity }, context) {
        context.save();
        context.translate(entity.x, entity.y);
        context.globalAlpha *= Math.min(1, Math.max(0, entity.life - entity.age) / 0.3);
        context.fillStyle = "#823c30";
        context.strokeStyle = "#d8aa85";
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(-3.8, -5);
        context.lineTo(-6, -2.5);
        context.lineTo(-6, 5);
        context.quadraticCurveTo(0, 7, 6, 5);
        context.lineTo(6, -2.5);
        context.lineTo(3.8, -5);
        context.closePath();
        context.fill();
        context.stroke();
        context.fillStyle = "#d45a3c";
        for (let index = 0; index < 7; index += 1) {
          context.fillRect(-4 + (index % 3) * 3, -2 + Math.floor(index / 3) * 2.3, 2, 1.5);
        }
        context.fillStyle = "#efd5a3";
        context.fillRect(-3, -1, 6, 3.5);
        context.strokeStyle = "#bc4c35";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(-1.4, 0);
        context.quadraticCurveTo(2, 0.4, -0.8, 1.5);
        context.stroke();
        context.translate(0, -5.5 - entity.opening * 4);
        context.rotate(Math.sin(entity.opening * TWO_PI * 2) * 0.22);
        context.fillStyle = "#a9b580";
        context.fillRect(-4.8, -1.4, 9.6, 2.8);
        context.strokeStyle = "#e0e5b9";
        context.lineWidth = 0.5;
        for (let index = -3; index <= 3; index += 2) {
          context.beginPath(); context.moveTo(index, -1); context.lineTo(index, 1); context.stroke();
        }
        context.restore();
      }
    };
  }

  const zaoPepperDefinition = {
    id: "zaoPepper", name: "\u7cdf\u8fa3\u6912", englishName: "Zao Pepper", color: "#c84337",
    description: "\u5f00\u573a5\u74f6 / \u6bcf5\u79d2\u8865\u5145 / \u89e6\u74f6\u65e0\u654c\u62e7\u76d60.6\u79d2 / \u8fa3\u6912\u5730\u6bcf0.4\u79d2-1\uff0c\u5b58\u75594.5\u79d2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: BATCH_INTERVAL,
    createBehavior(services) {
      let bottles = [];
      let batchRemaining = 0;
      let opening = null;
      let owner = null;
      let retired = false;
      const hitTimes = new Map();
      function cancelOpening() {
        const previous = opening;
        opening = null;
        for (const bottle of bottles) bottle.opening = 0;
        if (previous && owner) services.clearEffect(owner, previous.effectId);
      }
      function retire() {
        retired = true;
        cancelOpening();
        for (const bottle of bottles) bottle.entityActive = false;
        bottles = [];
      }
      function spawnBatch({ ball, game }) {
        const margin = BOTTLE_RADIUS + 4;
        const angle = Math.atan2(ball.storedVy, ball.storedVx);
        for (let index = 0; index < BOTTLE_COUNT; index += 1) {
          const point = index === 0 ? resolveArenaGeometry(game).clampPoint(ball.x + Math.cos(angle) * 55, ball.y + Math.sin(angle) * 55, margin) : resolveArenaGeometry(game).samplePoint(Math.random, margin);
          bottles.push(services.spawnCombatEntity(createPepperBottle(
            point.x, point.y
          )));
        }
        batchRemaining = BATCH_INTERVAL;
      }
      function startOpening(ball, bottle) {
        const effectId = `zao-pepper-opening-${ball.instanceId}`;
        opening = { bottle, remaining: OPEN_DURATION, effectId };
        const effect = services.applyEffect(ball, {
          id: effectId, duration: BOTTLE_LIFE, locksMovement: true, preventsAttack: true,
          getContactProfile: () => ({ targetable: false }),
          onApply({ ball }) { ball.vx = ball.vy = 0; },
          update({ ball }) { ball.vx = ball.vy = 0; },
          onExpire({ ball, services: effectServices }) {
            opening = null;
            if (!effectServices.isMovementLocked(ball)) { ball.vx = ball.storedVx; ball.vy = ball.storedVy; }
          }
        });
        if (!effect) opening = null;
      }
      function prune() {
        bottles = bottles.filter(live);
        if (opening && !live(opening.bottle)) cancelOpening();
      }
      return {
        update({ ball }, dt) {
          owner = ball;
          if (retired) return;
          batchRemaining = Math.max(0, batchRemaining - dt);
          if (opening) {
            opening.remaining = Math.max(0, opening.remaining - dt);
            for (const bottle of bottles) bottle.opening = 1 - opening.remaining / OPEN_DURATION;
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, opening
            ? Math.min(batchRemaining || BATCH_INTERVAL, opening.remaining)
            : batchRemaining);
        },
        afterUpdateStep(context) {
          if (retired) return;
          owner = context.ball;
          prune();
          if (opening && opening.remaining <= EPSILON) {
            for (const bottle of bottles) {
              if (!live(bottle)) continue;
              bottle.services.spawnCombatEntity(createPepperPatch(bottle.x, bottle.y, hitTimes));
              bottle.services.spawnParticleBurst({
                kind: "zao-pepper-burst", x: bottle.x, y: bottle.y,
                count: 24, colors: ["#c84337", "#f08045", "#eacb8a", "#bdd0ba"],
                shape: "rect", minLength: 2, maxLength: 5, minWidth: 1, maxWidth: 2,
                minSpeed: 35, maxSpeed: 115, life: 0.4
              });
              bottle.entityActive = false;
            }
            cancelOpening();
            bottles = [];
            services.playSound("hit", { kind: "zao-pepper-burst" });
          }
          if (!opening && batchRemaining <= EPSILON) spawnBatch(context);
          if (opening || !services.getCapabilities(owner).canAct) return;
          for (const bottle of bottles) {
            const hit = firstSegmentCircleContact(owner.prevX == null ? owner.x : owner.prevX,
              owner.prevY == null ? owner.y : owner.prevY,
              owner.x, owner.y, bottle.x, bottle.y, owner.radius + bottle.radius);
            if (hit !== null) { startOpening(owner, bottle); break; }
          }
        },
        afterUpdateStepWhilePaused: prune,
        onBeforeDamage(context, event) {
          return opening ? { amount: 0, showHitText: false, cancelAttack: true } : event;
        },
        onCollision(context, target) {
          if (!context.blockedAtContact && !opening) context.services.dealDamage(target, 1);
        },
        onDeath: retire,
        onBorrowEnd: retire
      };
    }
  };
  registerBall(zaoPepperDefinition);
  return { zaoPepperDefinition, createPepperBottle, createPepperPatch };
});
