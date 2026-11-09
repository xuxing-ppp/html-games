(function initializeFixed(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFixedPlugin({ registerBall, resolveArenaGeometry }) {
  const BODY_LIFETIME = 6.7;
  const BODY_DAMAGE = 5;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function resolveFixedCollision(body, target, arenaSize, services, onReflect = null) {
    const arena = resolveArenaGeometry(arenaSize);
    let deltaX = target.x - body.x;
    let deltaY = target.y - body.y;
    let distance = Math.hypot(deltaX, deltaY);
    const minimumDistance = body.radius + target.radius;
    if (distance + EPSILON >= minimumDistance) return false;
    if (distance <= EPSILON) {
      const speed = Math.hypot(target.vx, target.vy);
      deltaX = speed > EPSILON ? -target.vx / speed : 1;
      deltaY = speed > EPSILON ? -target.vy / speed : 0;
      distance = 1;
    }
    const normalX = deltaX / distance;
    const normalY = deltaY / distance;
    if (!target.positionLocked) {
      const overlap = minimumDistance - distance;
      Object.assign(target, arena.clampPoint(target.x + normalX * overlap,
        target.y + normalY * overlap, target.radius));
    }
    if (!services.isMovementLocked(target)) {
      const incoming = target.vx * normalX + target.vy * normalY;
      if (incoming < 0) {
        const reflectedX = target.vx - incoming * 2 * normalX;
        const reflectedY = target.vy - incoming * 2 * normalY;
        const magnitude = Math.hypot(reflectedX, reflectedY);
        const directionX = magnitude > EPSILON ? reflectedX / magnitude : normalX;
        const directionY = magnitude > EPSILON ? reflectedY / magnitude : normalY;
        // If the reflected heading cannot travel even one ball radius before
        // hitting an arena edge, the body and wall form a narrow channel. Do
        // not cancel velocity here: slide along the contact tangent at the
        // same speed so the ball can leave the channel on a later frame.
        const clearDistance = arena.movementLimit(target.x, target.y, directionX,
          directionY, arena.size * 2, target.radius);
        if (clearDistance < target.radius) {
          const tangentX = -normalY;
          const tangentY = normalX;
          const tangentSpeed = target.vx * tangentX + target.vy * tangentY;
          const tangentSign = tangentSpeed < -EPSILON ? -1 : 1;
          target.vx = tangentX * magnitude * tangentSign;
          target.vy = tangentY * magnitude * tangentSign;
        } else {
          target.vx = reflectedX;
          target.vy = reflectedY;
          // A real bounce off the body plays the collision sound exactly once
          // per hit; a pinned ball cancels its normal velocity instead and
          // stays quiet.
          if (typeof onReflect === "function") onReflect();
        }
        target.storedVx = target.vx;
        target.storedVy = target.vy;
      }
    }
    return true;
  }

  function drawFixedBody(body, context) {
    const remaining = clamp((body.life - body.age) / Math.min(0.35, body.life), 0, 1);
    context.save();
    context.globalAlpha *= 0.9 * remaining;
    context.fillStyle = body.color;
    context.beginPath();
    context.arc(Math.round(body.x), Math.round(body.y), body.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(220, 220, 220, 0.55)";
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  function createFixedBody(source, arenaSize) {
    return {
      kind: "fixed-collision-body",
      life: BODY_LIFETIME,
      solid: true,
      drawLayer: "background",
      radius: source.radius,
      color: source.color,
      x: source.x,
      y: source.y,
      contacts: new Set(),
      update({ effect: body, services: bodyServices }) {
        const nextContacts = new Set();
        bodyServices.forEachContactEnemy((target) => {
          const profile = bodyServices.getContactProfile(target);
          const overlapping = Math.hypot(target.x - body.x, target.y - body.y) <= target.radius + body.radius;
          bodyServices.notifyEntityContact(target, body, { overlapping });
          if (!profile.solid || !resolveFixedCollision(
            body,
            target,
            arenaSize,
            bodyServices,
            () => bodyServices.playBounce(1)
          )) return;
          const key = target.instanceId || target.id;
          nextContacts.add(key);
          if (body.contacts.has(key) || !profile.attackable) return;
          bodyServices.dealDamage(target, BODY_DAMAGE);
        });
        body.contacts = nextContacts;
      },
      draw({ effect: body }, context) {
        drawFixedBody(body, context);
      }
    };
  }

  const fixedDefinition = {
    id: "fixed",
    name: "\u56fa\u5b9a",
    englishName: "Fixed",
    color: "#808080",
    description: "\u78b0\u649e\u7559\u4e0b\u56fa\u5b9a\u5b9e\u4f53 / 6.7\u79d2 / \u78b0\u649e-5",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: BODY_LIFETIME,
    createBehavior(services) {
      const bodies = [];
      return {
        onCollision(context) {
          const body = services.spawnCombatEntity(createFixedBody(
            context.ball,
            context.game
          ));
          bodies.push(body);
        },
        onEntityCollision(context) {
          const body = services.spawnCombatEntity(createFixedBody(context.ball, context.game));
          bodies.push(body);
        },
        getFixedState() {
          return {
            bodies: bodies.filter((body) => (
              body && body.life > 0 && body.age + EPSILON < body.life
            ))
          };
        }
      };
    }
  };

  registerBall(fixedDefinition);
  return { fixedDefinition };
});
