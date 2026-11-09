(function initializeCaterpillar(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCaterpillarPlugin({ registerBall, resolveArenaGeometry, firstSegmentCircleContact }) {
  const FUR_LIFE = 10;
  const FUR_RADIUS = 6;
  const SILENCE_DURATION = 1;
  const ITCH_INTERVAL = 0.4;
  const ITCH_TICKS = 5;
  const EPSILON = 1e-8;
  const TWO_PI = Math.PI * 2;

  function createCaterpillarItch() {
    return {
      id: "caterpillar-itch", combatKind: "dot",
      duration: ITCH_INTERVAL * ITCH_TICKS,
      ticksRemaining: ITCH_TICKS,
      onApply({ effect, game }) {
        effect.nextTickAt = game.time + ITCH_INTERVAL;
      },
      update({ ball, effect, game, services }) {
        while (effect.ticksRemaining > 0 && game.time + EPSILON >= effect.nextTickAt && ball.hp > 0) {
          effect.ticksRemaining -= 1;
          effect.nextTickAt += ITCH_INTERVAL;
          if (services.dealDamage(ball, 1)) {
            services.spawnParticleBurst({
              kind: "caterpillar-itch-flake", x: ball.x, y: ball.y,
              count: 6, colors: ["#c8df8a", "#f0efd0"],
              minDiameter: 1, maxDiameter: 2, minSpeed: 12, maxSpeed: 35,
              initialRadius: ball.radius, life: 0.25
            });
          }
        }
      },
      draw({ ball, game }, context) {
        context.save();
        context.strokeStyle = "#d5e89d";
        context.lineWidth = 0.8;
        for (let index = 0; index < 4; index += 1) {
          const angle = index * Math.PI / 2 + game.time * 1.7;
          const radius = ball.radius + 3;
          const x = ball.x + Math.cos(angle) * radius;
          const y = ball.y + Math.sin(angle) * radius;
          context.beginPath();
          context.moveTo(x - 1.5, y - 2);
          context.lineTo(x + Math.sin(game.time * 24 + index), y);
          context.lineTo(x + 1.5, y + 2);
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createCaterpillarSilence() {
    return {
      id: "caterpillar-silence", duration: SILENCE_DURATION,
      pausesBehavior: true, preventsAttack: true, blocksDamageOutput: true,
      draw({ ball }, context) {
        context.save();
        context.strokeStyle = "#cbd6ad";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(ball.x, ball.y - ball.radius - 6, 3, 0, TWO_PI);
        context.moveTo(ball.x - 2, ball.y - ball.radius - 4);
        context.lineTo(ball.x + 2, ball.y - ball.radius - 8);
        context.stroke();
        context.restore();
      }
    };
  }

  function createCaterpillarFur(ball, angle, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const speed = ball.speed * ball.speedMultiplier * 0.5;
    return {
      kind: "caterpillar-fur", combatKind: "trap", life: FUR_LIFE,
      radius: FUR_RADIUS, color: "#d4dfa5",
      ...arena.clampPoint(ball.x + Math.cos(angle) * ball.radius, ball.y + Math.sin(angle) * ball.radius, FUR_RADIUS),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      driftPhase: angle,
      update({ entity, game, services }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        const turn = Math.sin(entity.age * 2 + entity.driftPhase) * 0.55 * dt;
        const vx = entity.vx * Math.cos(turn) - entity.vy * Math.sin(turn);
        entity.vy = entity.vx * Math.sin(turn) + entity.vy * Math.cos(turn);
        entity.vx = vx;
        const motion = resolveArenaGeometry(game).advanceMotion(entity, dt);
        Object.assign(entity, { x: motion.x, y: motion.y, vx: motion.vx, vy: motion.vy });
        let first = null;
        let progress = Infinity;
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable) return;
          const hit = firstSegmentCircleContact(
            startX - (target.prevX == null ? target.x : target.prevX),
            startY - (target.prevY == null ? target.y : target.prevY),
            entity.x - target.x, entity.y - target.y, 0, 0, target.radius + entity.radius
          );
          if (hit !== null && hit < progress) { first = target; progress = hit; }
        });
        if (!first) return;
        const itch = services.applyEffect(first, createCaterpillarItch());
        if (!itch) return;
        services.applyEffect(first, createCaterpillarSilence());
        entity.entityActive = false;
        services.spawnParticleBurst({
          kind: "caterpillar-fur-contact", x: entity.x, y: entity.y,
          count: 10, colors: ["#d4dfa5", "#f2f0d8", "#7a9d57"],
          minDiameter: 1, maxDiameter: 2.5, minSpeed: 15, maxSpeed: 45, life: 0.35
        });
      },
      draw({ entity }, context) {
        context.save();
        context.translate(entity.x, entity.y);
        context.rotate(entity.driftPhase + entity.age * 0.65);
        context.globalAlpha *= Math.min(1, Math.max(0, entity.life - entity.age) / 0.5);
        context.fillStyle = "#b6c77e";
        context.beginPath();
        context.arc(0, 0, 2.8, 0, TWO_PI);
        context.fill();
        context.strokeStyle = "#e1e8bc";
        context.lineWidth = 0.55;
        for (let index = 0; index < 18; index += 1) {
          const a = index / 18 * TWO_PI;
          const tip = FUR_RADIUS + Math.sin(entity.age * 3 + index) * 0.5;
          context.beginPath();
          context.moveTo(Math.cos(a) * 1.5, Math.sin(a) * 1.5);
          context.quadraticCurveTo(Math.cos(a + 0.3) * 3.5, Math.sin(a + 0.3) * 3.5,
            Math.cos(a) * tip, Math.sin(a) * tip);
          context.stroke();
        }
        context.restore();
      }
    };
  }

  const caterpillarDefinition = {
    id: "caterpillar", name: "\u6bdb\u6bdb\u866b", englishName: "Caterpillar", color: "#87ac58",
    description: "\u6bcf\u5931\u53bb5\u8840\u8131\u843d4\u56e2\u7ed2\u6bdb / \u534a\u901f\u98d8\u52a810\u79d2 / 1\u79d2\u6c89\u9ed8 / \u7619\u75d2\u6bcf0.4\u79d2-1\uff0c\u51715\u6b21\u53ef\u91cd\u7f6e",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let damageRemainder = 0;
      let hpBeforeDamage = 0;
      return {
        onBeforeDamage({ ball }, event) {
          hpBeforeDamage = ball.hp;
          return event;
        },
        onDamaged({ ball, game }, event) {
          damageRemainder += Math.min(event.amount, hpBeforeDamage);
          while (damageRemainder + EPSILON >= 5) {
            damageRemainder -= 5;
            const offset = Math.random() * TWO_PI;
            for (let index = 0; index < 4; index += 1) {
              services.spawnCombatEntity(createCaterpillarFur(ball, offset + index * Math.PI / 2, game.arena || game.arenaSize));
            }
          }
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) context.services.dealDamage(target, 1);
        }
      };
    }
  };
  registerBall(caterpillarDefinition);
  return { caterpillarDefinition, createCaterpillarFur, createCaterpillarItch, createCaterpillarSilence };
});
