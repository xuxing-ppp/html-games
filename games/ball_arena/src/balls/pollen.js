(function initializePollen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js") : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createPollenPlugin({ registerBall }) {
  const CLOUD_DURATION = 2;
  const SOLID_DURATION = 0.8;
  const CLOUD_RADIUS = 55;
  const DAMAGE_INTERVAL = 0.25;
  const CLOUD_DAMAGE = 2;
  const SLOW_FACTOR = 0.5;
  const EPSILON = 1e-8;
  const TWO_PI = Math.PI * 2;

  function cloudScale(age) {
    return Math.max(0, Math.min(1, 0.36 + age / 0.18 * 0.64, (CLOUD_DURATION - age) / 0.25));
  }

  function createPollenCloud(ball) {
    const particles = Array.from({ length: 110 }, (_, index) => ({
      angle: index * 2.3999632297,
      distance: Math.sqrt((index + 0.5) / 110) * CLOUD_RADIUS,
      radius: 0.65 + index % 4 * 0.28
    }));
    const contacts = new Map();
    return {
      kind: "pollen-cloud", combatKind: "zone", lifecycle: "owner-bound",
      life: CLOUD_DURATION, centerX: ball.x, centerY: ball.y, cloudRadius: CLOUD_RADIUS,
      indestructible: true, shieldBreakPoints: [], drawLayer: "background",
      update({ entity, game, services }) {
        const radius = entity.cloudRadius * cloudScale(entity.age);
        const present = new Set();
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable ||
              Math.hypot(target.x - entity.centerX, target.y - entity.centerY) > radius + target.radius) return;
          present.add(target.instanceId);
          let contact = contacts.get(target.instanceId);
          if (!contact) {
            contact = { target, nextDamageAt: game.time, slowId: `pollen-slow-${entity.instanceId}` };
            contacts.set(target.instanceId, contact);
          }
          if (!target.effects.has(contact.slowId)) {
            services.applyEffect(target, {
              id: contact.slowId, duration: CLOUD_DURATION, speedFactor: SLOW_FACTOR,
              update({ ball: victim, effect, services: effectServices }) {
                if (!entity.entityActive || entity.age >= entity.life ||
                    Math.hypot(victim.x - entity.centerX, victim.y - entity.centerY) >
                      entity.cloudRadius * cloudScale(entity.age) + victim.radius) {
                  effectServices.clearEffect(victim, effect.id);
                }
              }
            });
          }
          if (game.time + EPSILON >= contact.nextDamageAt) {
            services.dealDamage(target, CLOUD_DAMAGE);
            contact.nextDamageAt = game.time + DAMAGE_INTERVAL;
          }
        });
        for (const [id, contact] of contacts) {
          if (!present.has(id)) {
            services.clearEffect(contact.target, contact.slowId);
            if (game.time >= contact.nextDamageAt) contacts.delete(id);
          }
        }
      },
      clearSlows(services) {
        for (const contact of contacts.values()) services.clearEffect(contact.target, contact.slowId);
        contacts.clear();
      },
      draw({ entity }, context) {
        const scale = cloudScale(entity.age);
        context.save();
        context.translate(entity.centerX, entity.centerY);
        context.fillStyle = "#e7cc62";
        context.globalAlpha *= 0.08;
        context.beginPath(); context.arc(0, 0, CLOUD_RADIUS * scale, 0, TWO_PI); context.fill();
        context.globalAlpha /= 0.08;
        for (let index = 0; index < particles.length; index += 1) {
          const particle = particles[index];
          const a = particle.angle + entity.age * 0.23;
          const distance = (particle.distance + Math.sin(entity.age * 5 + index) * 1.2) * scale;
          context.fillStyle = index % 4 === 0 ? "#fff3b0" : index % 3 === 0 ? "#bfac44" : "#e7cc62";
          context.globalAlpha = 0.55 + Math.sin(entity.age * 4 + index) * 0.2;
          context.beginPath();
          context.arc(Math.cos(a) * distance, Math.sin(a) * distance, particle.radius, 0, TWO_PI);
          context.fill();
        }
        context.restore();
      }
    };
  }

  const pollenDefinition = {
    id: "pollen", name: "\u82b1\u7c89", englishName: "Pollen", color: "#e7cc62",
    description: "\u89e6\u654c\u6563\u5f002\u79d2 / \u65e0\u654c\u65e0\u78b0\u649e / \u534a\u5f8455\u82b1\u7c89\u533a\u57df / 50%\u901f\u5ea6 / \u6bcf0.25\u79d2-2 / \u805a\u56de\u540e0.8\u79d2\u518d\u6563\u5f00",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let cloud = null;
      let owner = null;
      let readyAt = 0;
      let formId = null;
      let retired = false;
      function finish(game) {
        const previous = cloud;
        cloud = null;
        if (previous) {
          previous.entityActive = false;
          previous.clearSlows(previous.services);
        }
        readyAt = (typeof services.getAttackTime === "function"
          ? services.getAttackTime() : game.time) + SOLID_DURATION;
      }
      function disperse({ ball, game }) {
        owner = ball;
        cloud = services.spawnCombatEntity(createPollenCloud(ball));
        formId = `pollen-dispersed-${ball.instanceId}`;
        const effect = services.applyEffect(ball, {
          id: formId, duration: CLOUD_DURATION, locksMovement: true, preventsAttack: true,
          getContactProfile: () => ({ physical: false, targetable: false }),
          onApply({ ball }) { ball.vx = ball.vy = 0; },
          update({ ball }) { ball.vx = ball.vy = 0; },
          onExpire({ ball, game, services: effectServices }) {
            formId = null;
            finish(game);
            if (!effectServices.isMovementLocked(ball)) { ball.vx = ball.storedVx; ball.vy = ball.storedVy; }
          }
        });
        if (!effect) { formId = null; finish(game); }
        else services.playSound("shoot", { kind: "pollen-disperse" });
      }
      function retire(context) {
        retired = true;
        if (owner && formId) services.clearEffect(owner, formId);
        if (cloud) finish(context.game);
      }
      function nextTransition({ game }) {
        const form = owner && formId && owner.effects.get(formId);
        const scale = typeof services.getAttackPeriodScale === "function"
          ? services.getAttackPeriodScale() : 1;
        return form ? Math.max(EPSILON, form.expiresAt - game.time) / scale : SOLID_DURATION;
      }
      return {
        getNextTransitionIn: nextTransition,
        getNextPausedTransitionIn: nextTransition,
        onContactUpdate(context) {
          const now = typeof services.getAttackTime === "function"
            ? services.getAttackTime() : context.game.time;
          if (retired || cloud || now + EPSILON < readyAt || !context.overlapping ||
              !context.targetContact.attackable || !services.getCapabilities(context.ball).canAct ||
              !services.getCapabilities(context.ball).canDealDamage) return;
          disperse(context);
        },
        getContactProfile() {
          return cloud ? { physical: false, targetable: false } : null;
        },
        onBeforeDamage(context, event) {
          return cloud ? { amount: 0, showHitText: false, cancelAttack: true } : event;
        },
        drawBody() { return Boolean(cloud); },
        getHpDisplay() { return cloud ? { hidden: true } : null; },
        onDeath: retire,
        onBorrowEnd: retire
      };
    }
  };
  registerBall(pollenDefinition);
  return { pollenDefinition, createPollenCloud };
});
