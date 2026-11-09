(function initializeEmbroideryNeedle(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createEmbroideryNeedlePlugin({ registerBall, firstSegmentCircleContact, resolveArenaGeometry }) {
  const NEEDLE_SPEED = 400;
  const NEEDLE_LENGTH = 36;
  const REEL_SPEED = 70;
  const MAX_PULL_SPEED = 180;
  const WALL_REACH = 12;
  const WALL_DEPTH = 12;
  const NEEDLE_LIFE = 20;
  // 穿刺伤害：钢针扎进去的那一下（和实体上的 damage 元数据保持一致）。
  const NEEDLE_PIERCE_DAMAGE = 1;
  const BLEED_INTERVAL = 0.5;
  const BLEED_TICKS = 6;
  const EPSILON = 1e-8;

  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function isNeedleLive(needle) {
    return needle && needle.entityActive !== false && needle.life > needle.age &&
      needle.owner.hp > 0 && needle.owner.active !== false;
  }

  function spawnBlood(services, target) {
    services.spawnParticleBurst({
      kind: "embroidery-needle-blood", x: target.x, y: target.y,
      count: 10, colors: ["#b51c37", "#e54d61", "#8e1329"],
      minDiameter: 1, maxDiameter: 3, minSpeed: 24, maxSpeed: 85,
      life: 0.35, initialRadius: 3
    });
  }

  function createNeedleBleed(needle) {
    return {
      id: `embroidery-needle-bleed-${needle.instanceId}`,
      attackTags: ["bleeding"],
      combatKind: "dot",
      duration: BLEED_INTERVAL * BLEED_TICKS,
      tickTimer: 0,
      ticksRemaining: BLEED_TICKS,
      update({ ball, effect, services }, dt) {
        effect.tickTimer += dt;
        while (effect.tickTimer + EPSILON >= BLEED_INTERVAL && effect.ticksRemaining > 0 && ball.hp > 0) {
          effect.tickTimer -= BLEED_INTERVAL;
          effect.ticksRemaining -= 1;
          if (services.dealDamage(ball, 1)) spawnBlood(services, ball);
        }
      }
    };
  }

  function wallBehind(target, directionX, directionY, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const wall = arena.traceSegment(target.x, target.y,
      target.x + directionX * (WALL_REACH + EPSILON),
      target.y + directionY * (WALL_REACH + EPSILON), target.radius);
    if (!wall) return null;
    return { x: wall.x, y: wall.y, nx: wall.normalX, ny: wall.normalY,
      distance: wall.t * (WALL_REACH + EPSILON) };
  }

  function createNeedlePin(needle, wall) {
    function hold({ ball, effect, services }) {
      if (!isNeedleLive(needle)) {
        services.clearEffect(ball, effect.id);
        return;
      }
      if (services.getCapabilities(ball).canMove || ball.positionLocked) return;
      ball.x = effect.x;
      ball.y = effect.y;
      ball.vx = ball.vy = 0;
    }
    return {
      id: `embroidery-needle-wall-stun-${needle.instanceId}`,
      attackTags: ["physical", "pin"],
      duration: NEEDLE_LIFE,
      visualType: "stun",
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      x: wall.x,
      y: wall.y,
      onApply: hold,
      update: hold,
      onExpire({ ball, services }) {
        if (!services.isMovementLocked(ball)) {
          ball.vx = ball.storedVx;
          ball.vy = ball.storedVy;
        }
      }
    };
  }

  function clearPin(needle, services) {
    const id = needle.pinId;
    needle.pinId = null;
    if (id && needle.target) services.clearEffect(needle.target, id);
  }

  function beginReturn(needle, services) {
    clearPin(needle, services);
    needle.target = null;
    needle.phase = "returning";
  }

  function retireNeedle(needle, services) {
    if (!needle) return;
    beginReturn(needle, services);
    needle.entityActive = false;
    if (needle.thread) needle.thread.life = 0;
  }

  function syncNeedle(needle) {
    const target = needle.target;
    needle.x = target.x + needle.directionX * (needle.depth - target.radius);
    needle.y = target.y + needle.directionY * (needle.depth - target.radius);
  }

  function needleEye(needle) {
    return {
      x: needle.x - needle.directionX * (NEEDLE_LENGTH - 4),
      y: needle.y - needle.directionY * (NEEDLE_LENGTH - 4)
    };
  }

  function attachNeedle(needle, target, game, services) {
    if (!services.dealDamage(target, NEEDLE_PIERCE_DAMAGE) || target.hp <= 0) {
      beginReturn(needle, services);
      return;
    }
    needle.target = target;
    needle.depth = Math.min(30, target.radius * 2);
    needle.phase = "attached";
    services.applyEffect(target, createNeedleBleed(needle));
    spawnBlood(services, target);
    const wall = wallBehind(target, needle.directionX, needle.directionY, game);
    if (wall && !services.isMovementLocked(target)) {
      const pin = services.applyEffect(target, createNeedlePin(needle, wall));
      if (pin) {
        needle.pinId = pin.id;
        if (!services.getCapabilities(target).canMove) {
          needle.phase = "wall-pinned";
          needle.wall = wall;
          needle.wallDepth = WALL_DEPTH;
        } else {
          clearPin(needle, services);
        }
      }
    }
    syncNeedle(needle);
    const eye = needleEye(needle);
    needle.ropeLength = Math.hypot(eye.x - needle.owner.x, eye.y - needle.owner.y);
  }

  function pullNeedle(needle, game, services, dt) {
    const target = needle.target;
    if (!target || target.hp <= 0 || target.active === false || !services.isEnemy(target) ||
        !services.getContactProfile(target).attackable) {
      beginReturn(needle, services);
      return;
    }
    if (needle.phase === "wall-pinned" && (!target.effects.has(needle.pinId) || services.getCapabilities(target).canMove)) {
      clearPin(needle, services);
      needle.phase = "attached";
    }
    syncNeedle(needle);
    const ownerCapabilities = services.getCapabilities(needle.owner);
    if (!ownerCapabilities.canAct || !ownerCapabilities.canDealDamage) return;
    needle.ropeLength = Math.max(0, needle.ropeLength - REEL_SPEED * dt);
    const eye = needleEye(needle);
    const dx = needle.owner.x - eye.x;
    const dy = needle.owner.y - eye.y;
    const distance = Math.hypot(dx, dy);
    const tension = Math.min(MAX_PULL_SPEED * dt, Math.max(0, distance - needle.ropeLength));
    if (tension <= EPSILON) return;
    if (needle.phase === "wall-pinned") {
      // Only the component pulling out of the wall can free a pinned needle.
      const inward = Math.max(0, (dx * needle.wall.nx + dy * needle.wall.ny) / Math.max(distance, EPSILON));
      const pulled = Math.min(needle.wallDepth, tension * inward);
      needle.wallDepth -= pulled;
      const pin = target.effects.get(needle.pinId);
      Object.assign(pin, resolveArenaGeometry(game).clampPoint(pin.x + needle.wall.nx * pulled,
        pin.y + needle.wall.ny * pulled, target.radius));
      if (!target.positionLocked) {
        target.x = pin.x;
        target.y = pin.y;
      }
      if (needle.wallDepth <= EPSILON) {
        clearPin(needle, services);
        needle.phase = "attached";
      }
    } else {
      const towardX = needle.owner.x - target.x;
      const towardY = needle.owner.y - target.y;
      const bodyDistance = Math.hypot(towardX, towardY);
      const drag = Math.min(tension * 0.6, Math.max(0, bodyDistance - needle.owner.radius - target.radius));
      if (drag > EPSILON && !services.isMovementLocked(target)) {
        Object.assign(target, resolveArenaGeometry(game).clampPoint(target.x + towardX / bodyDistance * drag,
          target.y + towardY / bodyDistance * drag, target.radius));
      }
      needle.depth = Math.max(0, needle.depth - tension * 0.4);
    }
    syncNeedle(needle);
    if (needle.depth <= EPSILON) beginReturn(needle, services);
  }

  function drawNeedle(needle, context) {
    context.save();
    context.translate(needle.x, needle.y);
    context.rotate(Math.atan2(needle.directionY, needle.directionX));
    context.fillStyle = "#aab5bf";
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(-8, -0.85);
    context.lineTo(-NEEDLE_LENGTH + 3, -1.25);
    context.quadraticCurveTo(-NEEDLE_LENGTH - 1, 0, -NEEDLE_LENGTH + 3, 1.25);
    context.lineTo(-8, 0.85);
    context.closePath();
    context.fill();
    context.strokeStyle = "#f1f5f8";
    context.lineWidth = 0.45;
    context.beginPath();
    context.moveTo(-3, 0);
    context.lineTo(-NEEDLE_LENGTH + 7, -0.4);
    context.stroke();
    context.fillStyle = "#303944";
    context.beginPath();
    context.ellipse(-NEEDLE_LENGTH + 4, 0, 1.8, 0.6, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function createEmbroideryNeedle(ball, target) {
    const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    return {
      kind: "embroidery-needle", lifecycle: "owner-bound", life: NEEDLE_LIFE,
      borrowedAttackPersistence: true,
      attackTags: ["physical", "piercing"],
      radius: 1, color: "#c0c7ce", damage: NEEDLE_PIERCE_DAMAGE,
      x: ball.x + directionX * ball.radius,
      y: ball.y + directionY * ball.radius,
      vx: directionX * NEEDLE_SPEED, vy: directionY * NEEDLE_SPEED,
      directionX, directionY, phase: "flying", target: null, pinId: null,
      depth: 0, ropeLength: 0,
      update({ entity, game, services }, dt) {
        if (entity.phase === "attached" || entity.phase === "wall-pinned") {
          pullNeedle(entity, game, services, dt);
          return;
        }
        if (entity.phase === "returning") {
          const capabilities = services.getCapabilities(entity.owner);
          if (!capabilities.canAct || !capabilities.canDealDamage) return;
          const dx = entity.owner.x - entity.x;
          const dy = entity.owner.y - entity.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= NEEDLE_SPEED * dt + entity.owner.radius) {
            retireNeedle(entity, services);
            return;
          }
          entity.x += dx / distance * NEEDLE_SPEED * dt;
          entity.y += dy / distance * NEEDLE_SPEED * dt;
          return;
        }
        const startX = entity.x;
        const startY = entity.y;
        const travel = NEEDLE_SPEED * dt;
        const arena = resolveArenaGeometry(game);
        const travelToWall = arena.movementLimit(startX, startY, entity.directionX,
          entity.directionY, arena.size * 2);
        const step = Math.min(travel, travelToWall);
        entity.x += entity.directionX * step;
        entity.y += entity.directionY * step;
        const hit = services.getFirstEnemyHit(startX, startY, entity.x, entity.y, entity.radius);
        if (hit) {
          const progress = firstSegmentCircleContact(startX, startY, entity.x, entity.y, hit.x, hit.y, hit.radius + entity.radius);
          entity.x = startX + (entity.x - startX) * progress;
          entity.y = startY + (entity.y - startY) * progress;
          attachNeedle(entity, hit, game, services);
        } else if (travel + EPSILON >= travelToWall) {
          beginReturn(entity, services);
        }
      },
      draw({ entity }, context) { drawNeedle(entity, context); }
    };
  }

  function createNeedleThread(needle) {
    return {
      kind: "embroidery-needle-thread", lifecycle: "owner-bound",
      drawLayer: "background", life: NEEDLE_LIFE,
      update({ effect }) {
        if (!isNeedleLive(needle)) effect.life = 0;
      },
      draw({ game }, context) {
        if (!isNeedleLive(needle)) return;
        const eye = needleEye(needle);
        const owner = needle.owner;
        const distance = Math.hypot(eye.x - owner.x, eye.y - owner.y);
        const slack = needle.phase === "flying" || needle.phase === "returning"
          ? Math.min(9, distance * 0.08) : Math.min(18, Math.max(0, needle.ropeLength - distance) * 0.5);
        context.save();
        context.lineWidth = 0.65;
        context.strokeStyle = "#d2afb9";
        context.globalAlpha *= 0.85;
        context.beginPath();
        context.moveTo(owner.x, owner.y);
        context.quadraticCurveTo((owner.x + eye.x) / 2 + Math.sin(game.time * 8) * slack * 0.2,
          (owner.y + eye.y) / 2 + slack, eye.x, eye.y);
        context.stroke();
        context.restore();
      }
    };
  }

  const embroideryNeedleDefinition = {
    id: "embroideryNeedle",
    name: "\u7ee3\u82b1\u9488",
    englishName: "Embroidery Needle",
    color: "#b8bdc5",
    description: "\u94a2\u9488\u7a7f\u523a1\u4f24\u5bb3 / 6\u6b211\u70b9\u6d41\u8840 / \u7ec6\u7ebf\u7275\u62c9\u62d4\u9488 / \u9760\u5899\u9489\u4f4f\u5e76\u7729\u6655 / \u6536\u56de\u540e\u7acb\u5373\u518d\u6295",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let needle = null;
      let retired = false;
      function cleanStaleNeedle() {
        if (needle && !isNeedleLive(needle)) {
          retireNeedle(needle, services);
          needle = null;
        }
      }
      function retire() {
        retired = true;
        retireNeedle(needle, services);
        needle = null;
      }
      return {
        getAttackCycleDuration() { return 5; },
        drawBorrowedWeapon({ ball }, canvasContext) {
          if (!needle) {
            const target = services.getOpponent() || { x: ball.x + 1, y: ball.y };
            drawNeedle(createEmbroideryNeedle(ball, target), canvasContext);
          }
        },
        afterUpdateStep({ ball }) {
          cleanStaleNeedle();
          if (retired || needle || !services.getCapabilities(ball).canDealDamage) return;
          const target = services.getOpponent();
          if (!target) return;
          needle = services.spawnProjectile(createEmbroideryNeedle(ball, target));
          needle.thread = services.spawnVisualEffect(createNeedleThread(needle));
        },
        afterUpdateStepWhilePaused: cleanStaleNeedle,
        onDeath: retire,
        onBorrowEnd() {
          if (services.borrowedAttackOnly) retired = true;
          else retire();
        }
      };
    }
  };

  registerBall(embroideryNeedleDefinition);
  return { embroideryNeedleDefinition, createEmbroideryNeedle, createNeedleBleed, wallBehind };
});
