(function initializeTwins(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTwinsPlugin({ resolveArenaGeometry, registerBall }) {
  const CLONE_RADIUS = 15;
  const CLONE_DAMAGE = 6;
  const BODY_HEAL = 2;
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

  function normalizeCloneSpeed(effect) {
    const direction = normalizeDirection(effect.vx, effect.vy, 1, 0);
    effect.vx = direction.x * effect.speed;
    effect.vy = direction.y * effect.speed;
  }

  function normalizeBallSpeed(ball, services) {
    const magnitude = Math.hypot(ball.vx, ball.vy);
    if (magnitude <= EPSILON || services.isMovementLocked(ball)) return;
    const speed = ball.speed * ball.speedMultiplier;
    ball.vx = ball.vx / magnitude * speed;
    ball.vy = ball.vy / magnitude * speed;
    ball.storedVx = ball.vx;
    ball.storedVy = ball.vy;
  }

  function resolveCircleCollision(effect, ball, services) {
    let deltaX = ball.x - effect.x;
    let deltaY = ball.y - effect.y;
    let distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = effect.radius + ball.radius;
    if (distance >= minimumDistance) return false;
    if (distance <= EPSILON) {
      const fallback = normalizeDirection(effect.vx - ball.vx, effect.vy - ball.vy);
      deltaX = fallback.x;
      deltaY = fallback.y;
      distance = 1;
    }
    const normalX = deltaX / distance;
    const normalY = deltaY / distance;
    const overlap = minimumDistance - distance;
    effect.x -= normalX * overlap * (ball.positionLocked ? 1 : 0.5);
    effect.y -= normalY * overlap * (ball.positionLocked ? 1 : 0.5);
    if (!ball.positionLocked) {
      ball.x += normalX * overlap * 0.5;
      ball.y += normalY * overlap * 0.5;
    }

    if (effect.arena) {
      Object.assign(effect, effect.arena.clampPoint(effect.x, effect.y, effect.radius));
      Object.assign(ball, effect.arena.clampPoint(ball.x, ball.y, ball.radius));
    }
    const cloneRadialSpeed = effect.vx * normalX + effect.vy * normalY;
    if (cloneRadialSpeed > 0) {
      effect.vx -= 2 * cloneRadialSpeed * normalX;
      effect.vy -= 2 * cloneRadialSpeed * normalY;
    }
    if (!services.isMovementLocked(ball)) {
      const ballRadialSpeed = ball.vx * normalX + ball.vy * normalY;
      if (ballRadialSpeed < 0) {
        ball.vx -= 2 * ballRadialSpeed * normalX;
        ball.vy -= 2 * ballRadialSpeed * normalY;
      }
    }
    normalizeCloneSpeed(effect);
    normalizeBallSpeed(ball, services);
    return true;
  }

  function drawClone(effect, context) {
    context.save();
    context.globalAlpha *= 0.82;
    context.fillStyle = "#77b4de";
    context.beginPath();
    context.arc(Math.round(effect.x), Math.round(effect.y), effect.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#d8f2ff";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(Math.round(effect.x), Math.round(effect.y), effect.radius - 1, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function chooseClonePosition(source, arenaSize, direction) {
    const candidates = [
      direction,
      { x: -direction.x, y: -direction.y },
      { x: -direction.y, y: direction.x },
      { x: direction.y, y: -direction.x }
    ];
    let best = null;
    let bestDistance = -Infinity;
    for (const candidate of candidates) {
      const { x, y } = resolveArenaGeometry(arenaSize).clampPoint(
        source.x + candidate.x * 60, source.y + candidate.y * 60, CLONE_RADIUS);
      const distance = Math.hypot(x - source.x, y - source.y);
      if (distance <= bestDistance) continue;
      bestDistance = distance;
      best = { x, y, direction: candidate };
    }
    return best;
  }

  function createClone(source, arenaSize) {
    const direction = normalizeDirection(
      -(source.storedVx || source.vx),
      -(source.storedVy || source.vy),
      -1,
      0
    );
    const position = chooseClonePosition(source, arenaSize, direction);
    const speed = source.speed;
    const effect = {
      kind: "twins-clone",
      life: 3600,
      solid: true,
      radius: CLONE_RADIUS,
      speed,
      x: position.x,
      y: position.y,
      vx: position.direction.x * speed,
      vy: position.direction.y * speed,
      enemyContacts: new Set(),
      bodyContact: false,
      update({ effect: clone, game, services: cloneServices }, dt) {
        if (game.state !== "running") {
          clone.life = 0;
          return;
        }
        const motion = resolveArenaGeometry(game).advanceMotion(clone, Math.max(0, dt));
        Object.assign(clone, { x: motion.x, y: motion.y, vx: motion.vx, vy: motion.vy });
        normalizeCloneSpeed(clone);

        clone.arena = resolveArenaGeometry(game);
        const nextEnemyContacts = new Set();
        cloneServices.forEachEnemy((target) => {
          if (!cloneServices.getContactProfile(target).solid) return;
          if (!resolveCircleCollision(clone, target, cloneServices)) return;
          const key = target.instanceId || target.id;
          nextEnemyContacts.add(key);
          if (clone.enemyContacts.has(key)) return;
          cloneServices.dealDamage(target, CLONE_DAMAGE);
        });
        clone.enemyContacts = nextEnemyContacts;

        const touchingBody = resolveCircleCollision(clone, source, cloneServices);
        if (touchingBody && !clone.bodyContact && source.hp > 0) {
          source.hp += BODY_HEAL;
          cloneServices.spawnHitText(source, "+2", { color: "#73ffb1" });
        }
        clone.bodyContact = touchingBody;
      },
      draw({ effect: clone }, context) {
        drawClone(clone, context);
      }
    };
    return effect;
  }

  const twinsDefinition = {
    id: "twins",
    name: "\u53cc\u5b50",
    englishName: "Twins",
    color: "#5595c4",
    description: "\u65e0\u8840\u91cf\u78b0\u649e\u5206\u8eab / \u53d7\u4f24\u6362\u4f4d",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      let clone = null;
      return {
        onSpawn(context) {
          clone = services.spawnCombatEntity(createClone(
            context.ball,
            context.game
          ));
        },
        onDamaged(context, event) {
          if (!clone || clone.life <= 0 || event.amount <= 0 || context.ball.hp <= 0) return;
          const bodyX = context.ball.x;
          const bodyY = context.ball.y;
          context.ball.x = clone.x;
          context.ball.y = clone.y;
          context.ball.prevX = clone.x;
          context.ball.prevY = clone.y;
          clone.x = bodyX;
          clone.y = bodyY;
          clone.bodyContact = false;
        },
        getTwinState() {
          return { clone };
        }
      };
    }
  };

  registerBall(twinsDefinition);
  return { twinsDefinition };
});
