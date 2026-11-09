(function initializeTrident(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/contact-model.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTridentPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const SPEED = 412.5;
  const LENGTH = 50;
  const EPSILON = 1e-9;
  const smooth = (t) => t * t * (3 - 2 * t);
  function pose(ball, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    // Like Cucumber, the grip stays beside the body in the aim's local frame.
    const side = ball.radius + 4;
    return { x: ball.x + dy * side + dx * (LENGTH - 7),
      y: ball.y - dx * side + dy * (LENGTH - 7), angle };
  }
  function drawTrident(canvas, weapon) {
    canvas.save();
    canvas.translate(weapon.x, weapon.y);
    canvas.rotate(weapon.angle);
    // Coordinates are measured from the central tip; all three tines point forward.
    canvas.lineJoin = "round";
    canvas.lineCap = "round";
    canvas.strokeStyle = "#164c50";
    canvas.lineWidth = 5;
    canvas.beginPath(); canvas.moveTo(-LENGTH, 0); canvas.lineTo(-9, 0); canvas.stroke();
    canvas.strokeStyle = "#389c9c"; canvas.lineWidth = 2.8;
    canvas.beginPath(); canvas.moveTo(-LENGTH + 2, -0.6); canvas.lineTo(-8, -0.6); canvas.stroke();
    canvas.strokeStyle = "#99e4d9"; canvas.lineWidth = 0.8;
    canvas.beginPath(); canvas.moveTo(-LENGTH + 5, -1.3); canvas.lineTo(-13, -1.3); canvas.stroke();
    canvas.strokeStyle = "#286d73"; canvas.lineWidth = 3.5;
    canvas.beginPath();
    canvas.moveTo(-13, 0); canvas.quadraticCurveTo(-16, -3, -14, -11);
    canvas.quadraticCurveTo(-13, -15, -7, -12);
    canvas.moveTo(-13, 0); canvas.quadraticCurveTo(-16, 3, -14, 11);
    canvas.quadraticCurveTo(-13, 15, -7, 12); canvas.stroke();
    canvas.strokeStyle = "#77d8cc"; canvas.lineWidth = 1.4;
    canvas.beginPath();
    canvas.moveTo(-13, -1); canvas.lineTo(-13, -10); canvas.lineTo(-8, -11);
    canvas.moveTo(-13, 1); canvas.lineTo(-13, 10); canvas.lineTo(-8, 11); canvas.stroke();
    canvas.fillStyle = "#94ede0";
    for (const tine of [{ x: 0, y: 0 }, { x: -5, y: -12 }, { x: -5, y: 12 }]) {
      canvas.beginPath(); canvas.moveTo(tine.x, tine.y);
      canvas.lineTo(tine.x - 7, tine.y - 2); canvas.lineTo(tine.x - 5, tine.y);
      canvas.lineTo(tine.x - 7, tine.y + 2); canvas.closePath(); canvas.fill();
    }
    canvas.strokeStyle = "#173c43"; canvas.lineWidth = 1.2;
    canvas.beginPath(); canvas.ellipse(-13, 0, 3, 5, 0, 0, Math.PI * 2); canvas.stroke();
    canvas.restore();
  }
  function createTridentBleed(key) {
    return { id: "trident-bleed-" + key, combatKind: "dot", attackTags: ["bleeding"],
      duration: 0.9, timer: 0, ticks: 0,
      update({ ball, effect, services }, dt) {
        effect.timer += dt;
        while (effect.timer + EPSILON >= 0.3 && effect.ticks < 3 && ball.hp > 0) {
          effect.timer -= 0.3; effect.ticks += 1;
          if (services.dealDamage(ball, 3)) services.spawnParticleBurst({
            x: ball.x, y: ball.y, count: 6, colors: ["#ba3043", "#e65a65"],
            minDiameter: 1, maxDiameter: 2.5, minSpeed: 18, maxSpeed: 55, life: 0.3
          });
        }
      }
    };
  }
  const tridentDefinition = {
    id: "trident", name: "三叉戟", englishName: "Trident", color: "#31d1c7",
    description: "3秒蓄势投戟 / 速度412.5 / 命中20伤并留戟，未命中插墙 / 靠近拔回触发3×3流血，再冷却3秒",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let weapon = null;
      let cooldown = 3;
      let serial = 0;
      function reset() {
        if (weapon) weapon.entityActive = false;
        weapon = null;
      }
      function ensure(ball) {
        if (weapon && weapon.entityActive !== false) return;
        cooldown = 3;
        weapon = services.spawnCombatEntity(Object.assign({
          kind: "trident-weapon", combatKind: "projectile", lifecycle: "owner-bound",
          drawLayer: "background", life: Number.MAX_SAFE_INTEGER, radius: 2,
          phase: "held", target: null, offsetX: 0, offsetY: 0, retrieveTime: 0,
          update({ entity, game, services: bound }, dt) {
            const owner = entity.owner;
            if (entity.phase === "held") { Object.assign(entity, pose(owner, entity.angle)); return; }
            if (entity.phase === "flight") {
              const dx = Math.cos(entity.angle), dy = Math.sin(entity.angle);
              const arena = resolveArenaGeometry(game);
              const wallDistance = arena.movementLimit(entity.x, entity.y, dx, dy, arena.size * 2);
              const distance = Math.min(SPEED * dt, wallDistance);
              const x = entity.x + dx * distance, y = entity.y + dy * distance;
              const target = bound.getFirstEnemyHit(entity.x, entity.y, x, y, entity.radius);
              if (target) {
                const t = firstSegmentCircleContact(entity.x, entity.y, x, y, target.x, target.y, target.radius + entity.radius);
                entity.x += (x - entity.x) * (t === null ? 1 : t);
                entity.y += (y - entity.y) * (t === null ? 1 : t);
                entity.x += dx * 6;
                entity.y += dy * 6;
                entity.phase = "embedded"; entity.target = target;
                entity.offsetX = entity.x - target.x; entity.offsetY = entity.y - target.y;
                bound.dealDamage(target, 20);
                bound.spawnParticleBurst({ x: entity.x, y: entity.y, count: 7,
                  colors: ["#a4eee1", "#388d90"], minSpeed: 20, maxSpeed: 65, life: 0.2 });
              } else {
                entity.x = x; entity.y = y;
                if (SPEED * dt + EPSILON >= wallDistance) {
                  entity.phase = "wall";
                  bound.spawnParticleBurst({ x, y, count: 8, colors: ["#a4eee1", "#388d90"],
                    minSpeed: 20, maxSpeed: 65, life: 0.25 });
                }
              }
              return;
            }
            if (entity.phase === "embedded") {
              if (entity.target.hp > 0 && entity.target.active !== false) {
                entity.x = entity.target.x + entity.offsetX;
                entity.y = entity.target.y + entity.offsetY;
              } else { entity.target = null; entity.phase = "wall"; }
            }
            if (entity.phase === "retrieve") {
              entity.retrieveTime = Math.min(0.22, entity.retrieveTime + dt);
              const t = smooth(entity.retrieveTime / 0.22);
              const end = pose(owner, entity.returnAngle);
              entity.x = entity.fromX + (end.x - entity.fromX) * t;
              entity.y = entity.fromY + (end.y - entity.fromY) * t;
              entity.angle = entity.fromAngle + Math.atan2(Math.sin(end.angle - entity.fromAngle),
                Math.cos(end.angle - entity.fromAngle)) * t;
              if (t >= 1) { entity.phase = "held"; cooldown = 3; }
            }
          },
          draw({ entity }, canvas) {
            drawTrident(canvas, entity.phase === "held" ? pose(entity.owner, entity.angle) : entity);
          }
        }, pose(ball, Math.PI)));
      }
      return {
        onSpawn({ ball }) { ensure(ball); },
        update({ ball, game }, dt) {
          ensure(ball);
          if (weapon.phase === "held") {
            cooldown = Math.max(0, cooldown - dt);
            const target = services.getOpponent();
            if (target) {
              const desired = Math.atan2(target.y - ball.y, target.x - ball.x);
              const delta = Math.atan2(Math.sin(desired - weapon.angle), Math.cos(desired - weapon.angle));
              weapon.angle += delta * Math.min(1, dt * 10);
            }
            Object.assign(weapon, pose(ball, weapon.angle));
            if (cooldown > EPSILON || !target) return;
            Object.assign(weapon, resolveArenaGeometry(game).clampPoint(weapon.x, weapon.y));
            weapon.angle = Math.atan2(target.y - ball.y, target.x - ball.x);
            weapon.phase = "flight";
            services.playSound("shoot");
          } else if (weapon.phase === "wall" || weapon.phase === "embedded") {
            if (weapon.phase === "embedded" && weapon.target.hp > 0) {
              weapon.x = weapon.target.x + weapon.offsetX;
              weapon.y = weapon.target.y + weapon.offsetY;
            }
            const gripX = weapon.x - Math.cos(weapon.angle) * (LENGTH - 7);
            const gripY = weapon.y - Math.sin(weapon.angle) * (LENGTH - 7);
            if (Math.hypot(ball.x - gripX, ball.y - gripY) > ball.radius + 9) return;
            if (weapon.target && weapon.target.hp > 0) {
              services.applyEffect(weapon.target, createTridentBleed(ball.instanceId + "-" + (++serial)));
            }
            weapon.target = null; weapon.phase = "retrieve"; weapon.retrieveTime = 0;
            weapon.fromX = weapon.x; weapon.fromY = weapon.y; weapon.fromAngle = weapon.angle;
            weapon.returnAngle = weapon.angle;
          }
        },
        getNextTransitionIn() { return weapon && weapon.phase === "held" && cooldown > EPSILON ? cooldown : undefined; },
        onAttackTransfer({ ball }) {
          if (weapon && weapon.phase === "held") Object.assign(weapon, pose(ball, weapon.angle));
        },
        onBorrowEnd: reset, onDeath: reset, onBattleDispose: reset,
        getTridentState() { return { phase: weapon ? weapon.phase : "none", cooldown, weapon }; }
      };
    }
  };
  registerBall(tridentDefinition);
  return { tridentDefinition, createTridentBleed };
});
