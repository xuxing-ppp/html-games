(function initializeStoneSkipping(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createStoneSkippingPlugin({ registerBall }) {
  const THROW_INTERVAL = 5;
  const STONE_SPEED_MULTIPLIER = 0.75;
  const INITIAL_LEG_DISTANCE = 30;
  const LEG_DISTANCE_DECREMENT = 2;
  const STONE_RADIUS = 4;
  const RIPPLE_DAMAGE = 3;
  const RIPPLE_MAX_RADIUS = 50;
  const RIPPLE_SPEED_MULTIPLIER = 0.5;
  const EPSILON = 1e-9;

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function createRipple(expansionSpeed, x, y) {
    const hitTargets = new Set();
    return {
      kind: "stone-skipping-ripple",
      life: RIPPLE_MAX_RADIUS / expansionSpeed + 0.05,
      drawLayer: "background",
      x,
      y,
      radius: 0,
      update({ effect, services: entityServices }, dt) {
        const previousRadius = effect.radius;
        effect.radius = Math.min(
          RIPPLE_MAX_RADIUS,
          effect.radius + expansionSpeed * Math.max(0, dt)
        );
        entityServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (hitTargets.has(key)) return;
          const distance = Math.hypot(target.x - effect.x, target.y - effect.y);
          if (
            distance + target.radius + EPSILON < previousRadius ||
            distance - target.radius - EPSILON > effect.radius
          ) return;
          hitTargets.add(key);
          entityServices.dealDamage(target, RIPPLE_DAMAGE);
        });
      },
      draw({ effect }, context) {
        const progress = Math.min(1, effect.radius / RIPPLE_MAX_RADIUS);
        context.save();
        context.globalAlpha *= 0.72 * (1 - progress * 0.7);
        context.strokeStyle = "#7de2ff";
        context.lineWidth = 2.5 - progress;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        context.stroke();
        context.globalAlpha *= 0.48;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius * 0.72, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createSkippingStone(source, target) {
    let direction = normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx,
      source.storedVy || source.vy
    );
    const speed = source.speed * STONE_SPEED_MULTIPLIER;
    const rippleExpansionSpeed = source.speed * RIPPLE_SPEED_MULTIPLIER;
    return {
      kind: "stone-skipping-stone",
      life: 4,
      radius: STONE_RADIUS,
      damage: 0,
      replayDamage: 0,
      penetrating: true,
      color: "#94a4a9",
      x: source.x,
      y: source.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      legDistance: INITIAL_LEG_DISTANCE,
      remainingDistance: INITIAL_LEG_DISTANCE,
      rippleCount: 0,
      update({ effect, services: stoneServices }, dt) {
        let remainingTime = Math.max(0, dt);
        while (remainingTime > EPSILON && effect.life > 0) {
          const travel = Math.min(effect.remainingDistance, speed * remainingTime);
          const stepTime = travel / speed;
          effect.x += direction.x * travel;
          effect.y += direction.y * travel;
          effect.remainingDistance = Math.max(0, effect.remainingDistance - travel);
          remainingTime = Math.max(0, remainingTime - stepTime);

          if (effect.remainingDistance > EPSILON) break;
          stoneServices.spawnCombatEntity(createRipple(
            rippleExpansionSpeed,
            effect.x,
            effect.y
          ));
          effect.rippleCount += 1;
          effect.legDistance -= LEG_DISTANCE_DECREMENT;
          if (effect.legDistance <= 0) {
            effect.life = 0;
            return;
          }
          const nextTarget = stoneServices.getOpponent();
          if (!nextTarget) {
            effect.life = 0;
            return;
          }
          direction = normalizeDirection(
            nextTarget.x - effect.x,
            nextTarget.y - effect.y,
            direction.x,
            direction.y
          );
          effect.vx = direction.x * speed;
          effect.vy = direction.y * speed;
          effect.remainingDistance = effect.legDistance;
        }
      },
      draw({ effect }, context) {
        const direction = normalizeDirection(effect.vx, effect.vy);
        context.save();
        context.strokeStyle = "rgba(112, 211, 241, 0.55)";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(effect.x - direction.x * 10, effect.y - direction.y * 10);
        context.lineTo(effect.x, effect.y);
        context.stroke();
        context.fillStyle = "#89989c";
        context.beginPath();
        context.ellipse(effect.x, effect.y, 5, 3, Math.atan2(effect.vy, effect.vx), 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  const stoneSkippingDefinition = {
    id: "stoneSkipping",
    name: "\u6253\u6c34\u6f02",
    englishName: "Stone Skipping",
    color: "#4eb9e5",
    description: "\u9012\u51cf\u8df3\u6ce2 / \u6c34\u7eb9\u6269\u6563 / \u77f3\u5b50\u7a7f\u900f",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: THROW_INTERVAL,
    createBehavior(services) {
      let throwTimer = 0;
      return {
        update(_context, dt) {
          throwTimer = Math.min(THROW_INTERVAL, throwTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, THROW_INTERVAL - throwTimer);
        },
        afterUpdateStep(context) {
          if (throwTimer + EPSILON < THROW_INTERVAL) return;
          throwTimer = 0;
          const target = services.getOpponent();
          if (target) {
            services.spawnProjectile(createSkippingStone(context.ball, target));
          }
        },
        drawAfter(context, canvasContext) {
          canvasContext.save();
          canvasContext.strokeStyle = "rgba(225, 250, 255, 0.9)";
          canvasContext.lineWidth = 1.5;
          for (let index = 0; index < 3; index += 1) {
            canvasContext.beginPath();
            canvasContext.arc(
              context.ball.x,
              context.ball.y + 3,
              4 + index * 4,
              0.15 * Math.PI,
              0.85 * Math.PI
            );
            canvasContext.stroke();
          }
          canvasContext.restore();
        }
      };
    }
  };

  registerBall(stoneSkippingDefinition);
  return { stoneSkippingDefinition };
});
