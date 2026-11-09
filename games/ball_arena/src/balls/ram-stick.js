(function initializeRamStick(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createRamStickPlugin({ resolveArenaGeometry, registerBall }) {
  const FIRE_INTERVAL = 1.1;
  const SPEED_MULTIPLIER = 3;
  const PROJECTILE_RADIUS = 4;
  const EPSILON = 1e-9;
  const CAPACITIES = [2, 4, 8, 16, 32];
  const CUMULATIVE_PROBABILITIES = [0.5, 0.75, 0.875, 0.9375, 1];

  function chooseCapacity(randomValue = Math.random()) {
    for (let index = 0; index < CAPACITIES.length; index += 1) {
      if (randomValue < CUMULATIVE_PROBABILITIES[index]) return CAPACITIES[index];
    }
    return 32;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function drawRam(context, effect) {
    const angle = Math.atan2(effect.vy, effect.vx);
    const length = 18 + Math.log2(effect.capacity) * 2.5;
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);
    context.shadowColor = "#7effa9";
    context.shadowBlur = 5;
    context.fillStyle = "#163f28";
    context.fillRect(-length / 2, -5, length, 10);
    context.fillStyle = "#2ea861";
    context.fillRect(-length / 2 + 1, -4, length - 2, 8);
    context.fillStyle = "#102318";
    for (let x = -length / 2 + 4; x < length / 2 - 4; x += 6) {
      context.fillRect(x, -2.5, 4, 5);
    }
    context.fillStyle = "#e5c35a";
    for (let x = -length / 2 + 2; x < length / 2 - 1; x += 3) {
      context.fillRect(x, 4, 2, 2);
    }
    context.shadowBlur = 0;
    context.fillStyle = "#ffffff";
    context.font = "700 7px 'Ball Impact', Impact, monospace";
    context.textAlign = "center";
    context.textBaseline = "bottom";
    context.fillText(`${effect.capacity}G`, 0, -7);
    context.restore();
  }

  function createRamProjectile(services, source, target, capacity) {
    const direction = normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx,
      source.storedVy || source.vy
    );
    const speed = source.speed * SPEED_MULTIPLIER;
    return {
      kind: "ram-stick-projectile",
      life: 4,
      radius: PROJECTILE_RADIUS,
      damage: capacity,
      replayDamage: capacity,
      capacity,
      color: "#42d779",
      x: source.x,
      y: source.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      update({ effect, game, services: entityServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * Math.max(0, dt);
        effect.y += effect.vy * Math.max(0, dt);
        const targetHit = entityServices.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          PROJECTILE_RADIUS
        );
        if (targetHit && entityServices.dealDamage(targetHit, capacity)) {
          effect.life = 0;
          return;
        }
        const margin = 24;
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, margin)
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        drawRam(context, effect);
      }
    };
  }

  const ramStickDefinition = {
    id: "ramStick",
    name: "\u5185\u5b58\u6761",
    englishName: "RAM Stick",
    color: "#2b9d59",
    description: "2G-32G\u52a0\u6743\u5c04\u51fb / 1G=1\u4f24\u5bb3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      let fireTimer = 0;
      let fired = false;
      return {
        onAttackBorrowStart(context) { fireTimer = FIRE_INTERVAL; this.afterUpdateStep(context); },
        isAttackCycleComplete() { return fired; },
        update(_context, dt) {
          fireTimer = Math.min(FIRE_INTERVAL, fireTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, FIRE_INTERVAL - fireTimer);
        },
        afterUpdateStep(context) {
          if (fireTimer + EPSILON < FIRE_INTERVAL) return;
          fireTimer = 0;
          const target = services.getOpponent();
          if (!target) return;
          fired = true;
          const capacity = chooseCapacity();
          services.spawnProjectile(createRamProjectile(
            services,
            context.ball,
            target,
            capacity
          ));
        },
        drawAfter(context, canvasContext) {
          canvasContext.save();
          canvasContext.font = '700 5px "Fusion Pixel 12 SC", monospace';
          canvasContext.textAlign = "center";
          canvasContext.textBaseline = "middle";
          canvasContext.lineJoin = "round";
          canvasContext.lineWidth = 1.5;
          canvasContext.strokeStyle = "#12351f";
          canvasContext.fillStyle = "#d8ffe5";
          const x = Math.round(context.ball.x);
          const y = Math.round(context.ball.y - 8);
          canvasContext.strokeText("RAM", x, y);
          canvasContext.fillText("RAM", x, y);
          canvasContext.restore();
        }
      };
    }
  };

  registerBall(ramStickDefinition);
  return { ramStickDefinition, chooseCapacity };
});
