(function initializeTrapper(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTrapperPlugin({ resolveArenaGeometry, registerBall }) {
  const TRAP_INTERVAL = 6;
  const TRAP_COUNT = 3;
  const TRAP_RADIUS = 35;
  const TRAP_DURATION = 4;
  const TRAP_DAMAGE = 1;
  const TRAP_DISARM_MIN_DURATION = 0.05;
  const PLACEMENT_ATTEMPTS = 64;
  const EPSILON = 1e-9;

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function createTrapDisarmEffect(trap) {
    return {
      id: "trapper-trap-disarm",
      trappingEntityInstanceId: trap.instanceId,
      duration: Math.max(
        TRAP_DISARM_MIN_DURATION,
        trap.life - trap.age
      ),
      preventsAttack: true,
      pausesBehavior: true,
      visualType: "disarm"
    };
  }

  function createTrap(x, y) {
    return {
      kind: "trapper-red-trap",
      life: TRAP_DURATION,
      x,
      y,
      radius: TRAP_RADIUS,
      active: false,
      capturedTargets: new Set(),
      boundaryContacts: new Set(),
      update({ effect, game, services: trapServices }) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        const nextContacts = new Set();
        trapServices.forEachEnemy((target) => {
          if (!trapServices.getContactProfile(target).solid) return;
          const key = targetKey(target);
          let deltaX = target.x - effect.x;
          let deltaY = target.y - effect.y;
          let distance = Math.hypot(deltaX, deltaY);
          const innerLimit = effect.radius - target.radius;
          if (innerLimit < 0) return;
          if (!effect.capturedTargets.has(key) && distance <= innerLimit + EPSILON) {
            effect.capturedTargets.add(key);
            effect.active = true;
            trapServices.applyEffect(target, createTrapDisarmEffect(effect));
          }
          if (!effect.capturedTargets.has(key)) return;
          if (distance <= EPSILON) {
            deltaX = target.vx || 1;
            deltaY = target.vy || 0;
            distance = Math.hypot(deltaX, deltaY) || 1;
          }
          const normalX = deltaX / distance;
          const normalY = deltaY / distance;
          const radialSpeed = target.vx * normalX + target.vy * normalY;
          const colliding = distance >= innerLimit - EPSILON && radialSpeed > EPSILON;
          if (distance > innerLimit) {
            target.x = effect.x + normalX * innerLimit;
            target.y = effect.y + normalY * innerLimit;
          }
          if (!colliding) return;
          nextContacts.add(key);
          target.vx -= 2 * radialSpeed * normalX;
          target.vy -= 2 * radialSpeed * normalY;
          const storedRadial = target.storedVx * normalX + target.storedVy * normalY;
          if (storedRadial > 0) {
            target.storedVx -= 2 * storedRadial * normalX;
            target.storedVy -= 2 * storedRadial * normalY;
          }
          if (effect.boundaryContacts.has(key)) return;
          trapServices.dealDamage(target, TRAP_DAMAGE);
        });
        effect.boundaryContacts = nextContacts;
      },
      draw({ effect, game }, context) {
        const pulse = effect.active ? 0.82 + Math.sin(game.time * 18) * 0.18 : 0.38;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= pulse;
        context.strokeStyle = effect.active ? "#ff2d45" : "#b82747";
        context.shadowColor = effect.active ? "#ff1838" : "transparent";
        context.shadowBlur = effect.active ? 9 : 0;
        context.lineWidth = effect.active ? 3 : 1.5;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        context.stroke();
        if (effect.active) {
          context.globalAlpha *= 0.18;
          context.fillStyle = "#ff2948";
          context.beginPath();
          context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }
    };
  }

  function positionIsOpen(x, y, existing) {
    return existing.every((trap) => Math.hypot(trap.x - x, trap.y - y) >= (
      trap.radius + TRAP_RADIUS
    ));
  }

  function findPosition(arenaSize, existing) {
    const arena = resolveArenaGeometry(arenaSize);
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      const { x, y } = arena.samplePoint(Math.random, TRAP_RADIUS);
      if (arena.contains(x, y, TRAP_RADIUS) && positionIsOpen(x, y, existing)) return { x, y };
    }
    const spacing = TRAP_RADIUS * 2;
    for (let y = arena.top + TRAP_RADIUS; y <= arena.bottom - TRAP_RADIUS + EPSILON; y += spacing) {
      for (let x = arena.left + TRAP_RADIUS; x <= arena.right - TRAP_RADIUS + EPSILON; x += spacing) {
        if (arena.contains(x, y, TRAP_RADIUS) && positionIsOpen(x, y, existing)) return { x, y };
      }
    }
    return null;
  }

  const trapperDefinition = {
    id: "trapper",
    name: "\u9677\u9631\u5e08",
    englishName: "Trapper",
    color: "#7844a8",
    description: "6\u79d23\u4e2a\u7ea2\u8272\u5706\u9677\u9631 / \u8fb9\u7f18\u78b0\u649e -1",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: TRAP_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      const traps = [];
      return {
        update(_context, dt) {
          timer = Math.min(TRAP_INTERVAL, timer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, TRAP_INTERVAL - timer);
        },
        afterUpdateStep(context) {
          if (timer + EPSILON < TRAP_INTERVAL) return;
          timer = 0;
          for (let index = traps.length - 1; index >= 0; index -= 1) {
            if (traps[index].age + EPSILON >= traps[index].life) traps.splice(index, 1);
          }
          const existing = traps.slice();
          for (let index = 0; index < TRAP_COUNT; index += 1) {
            const position = findPosition(context.game, existing);
            if (!position) break;
            const trap = services.spawnCombatEntity(createTrap(position.x, position.y));
            existing.push(trap);
            traps.push(trap);
          }
        }
      };
    }
  };

  registerBall(trapperDefinition);
  return { trapperDefinition, createTrapperTrap: createTrap };
});
