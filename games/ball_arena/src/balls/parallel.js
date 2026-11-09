(function initializeParallel(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createParallelPlugin({ registerBall, createArenaGeometry }) {
  const LATTICE_SPACING = 100;
  const COLLISION_DAMAGE = 2;
  const EPSILON = 1e-9;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;

  function arenaForGame(game) {
    return game.arena && game.arena.size === game.arenaSize
      ? game.arena : createArenaGeometry(game.arenaSize);
  }

  function wrapCoordinate(value, arenaSize) {
    return ((value % arenaSize) + arenaSize) % arenaSize;
  }

  function shortestToroidalDelta(value, arenaSize) {
    let delta = value % arenaSize;
    if (delta > arenaSize / 2) delta -= arenaSize;
    if (delta < -arenaSize / 2) delta += arenaSize;
    return delta;
  }

  function createCloneTemplates(arena, ball) {
    const columnCount = Math.ceil(arena.width / LATTICE_SPACING);
    const rowCount = Math.ceil(arena.height / LATTICE_SPACING);
    // Keep the existing density/count rule, but close the lattice at the seam.
    // E.g. 240 / 3 = 80: fixed 100-unit offsets would leave a 40-unit seam.
    const spacingX = arena.width / columnCount;
    const spacingY = arena.height / rowCount;
    const clones = [];
    for (let row = 0; row < rowCount; row += 1) {
      for (let column = 0; column < columnCount; column += 1) {
        if (row === 0 && column === 0) continue;
        clones.push({
          key: `${row}:${column}`,
          row,
          column,
          offsetX: column * spacingX,
          offsetY: row * spacingY,
          radius: ball.radius,
          x: arena.left + wrapCoordinate(ball.x - arena.left + column * spacingX, arena.width),
          y: arena.top + wrapCoordinate(ball.y - arena.top + row * spacingY, arena.height)
        });
      }
    }
    updateClonePositions(clones, ball, arena);
    return clones;
  }

  function updateClonePositions(clones, ball, arena) {
    clones.forEach((clone) => {
      clone.x = arena.left + wrapCoordinate(ball.x - arena.left + clone.offsetX, arena.width);
      clone.y = arena.top + wrapCoordinate(ball.y - arena.top + clone.offsetY, arena.height);
      clone.withinArena = arena.shape !== "circle" || arena.contains(clone.x, clone.y, clone.radius);
    });
  }

  function drawCloneAt(canvasContext, clone, offsetX, offsetY) {
    const x = clone.x + offsetX;
    const y = clone.y + offsetY;
    canvasContext.save();
    canvasContext.globalAlpha *= 0.94;
    canvasContext.fillStyle = "#ffffff";
    canvasContext.beginPath();
    canvasContext.arc(x, y, clone.radius, 0, Math.PI * 2);
    canvasContext.fill();
    canvasContext.restore();
  }

  function drawClone(canvasContext, clone, arena) {
    if (!clone.withinArena) return;
    if (arena.shape === "circle") {
      drawCloneAt(canvasContext, clone, 0, 0);
      return;
    }
    const xOffsets = [0];
    const yOffsets = [0];
    if (clone.x - clone.radius < arena.left) xOffsets.push(arena.width);
    else if (clone.x + clone.radius > arena.right) xOffsets.push(-arena.width);
    if (clone.y - clone.radius < arena.top) yOffsets.push(arena.height);
    else if (clone.y + clone.radius > arena.bottom) yOffsets.push(-arena.height);
    xOffsets.forEach((offsetX) => {
      yOffsets.forEach((offsetY) => drawCloneAt(
        canvasContext,
        clone,
        offsetX,
        offsetY
      ));
    });
  }

  function resolveCloneCollision(clone, target, arena) {
    let dx = target.x - clone.x;
    let dy = target.y - clone.y;
    if (arena.shape !== "circle") {
      dx = shortestToroidalDelta(dx, arena.width);
      dy = shortestToroidalDelta(dy, arena.height);
    }
    let distance = Math.hypot(dx, dy);
    const minimumDistance = clone.radius + target.radius;
    if (distance >= minimumDistance) return false;

    if (distance <= EPSILON) {
      const speed = Math.hypot(target.vx, target.vy);
      if (speed > EPSILON) {
        dx = -target.vx / speed;
        dy = -target.vy / speed;
      } else {
        dx = 1;
        dy = 0;
      }
      distance = 1;
    }
    const normalX = dx / distance;
    const normalY = dy / distance;
    const overlap = minimumDistance - distance;

    if (!target.positionLocked) {
      const point = arena.clampPoint(target.x + normalX * overlap, target.y + normalY * overlap, target.radius);
      target.x = point.x;
      target.y = point.y;
    }
    const velocityDot = target.vx * normalX + target.vy * normalY;
    if (velocityDot < 0) {
      target.vx -= 2 * velocityDot * normalX;
      target.vy -= 2 * velocityDot * normalY;
    }
    const storedDot = target.storedVx * normalX + target.storedVy * normalY;
    if (storedDot < 0) {
      target.storedVx -= 2 * storedDot * normalX;
      target.storedVy -= 2 * storedDot * normalY;
    }
    return true;
  }

  const parallelDefinition = {
    id: "parallel",
    name: "\u5e73\u884c",
    englishName: "Parallel",
    color: "#ffffff",
    description: "\u8d8a\u754c\u5faa\u73af / \u5341\u5b57\u6676\u683c / \u78b0\u649e -2",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let initialized = false;
      let arenaSize = 0;
      let arenaShape = "";
      let arenaWidth = 0;
      let arenaHeight = 0;
      let radius = 0;
      let clones = [];
      let pendingAlignment = false;

      function initialize(context) {
        const arena = arenaForGame(context.game);
        if (initialized && arenaSize === context.game.arenaSize && radius === context.ball.radius &&
            arenaShape === arena.shape && arenaWidth === arena.width && arenaHeight === arena.height) return;
        initialized = true;
        pendingAlignment = true;
        arenaSize = context.game.arenaSize;
        arenaShape = arena.shape;
        arenaWidth = arena.width;
        arenaHeight = arena.height;
        radius = context.ball.radius;
        const previous = new Map(clones.map(clone => [clone.key, clone]));
        clones = createCloneTemplates(arena, context.ball).map((template) => {
          const retained = previous.get(template.key);
          if (retained && retained.entityActive !== false) {
            previous.delete(template.key);
            Object.assign(retained, template);
            if (retained.contactKeys) retained.contactKeys.clear();
            return retained;
          }
          return services.spawnCombatEntity({
            ...template,
            combatKind: "body",
            lifecycle: "owner-bound",
            life: PERMANENT_LIFE,
            drawLayer: "background",
            update({ entity, game, services: cloneServices }) {
              const arena = arenaForGame(game);
              updateClonePositions([entity], entity.owner, arena);
              updateCloneCollision(entity, cloneServices, arena);
            },
            draw({ entity, game }, canvasContext) {
              drawClone(canvasContext, entity, arenaForGame(game));
            }
          });
        });
        for (const retired of previous.values()) retired.entityActive = false;
      }

      function alignNewClones(context) {
        if (!pendingAlignment) return;
        updateClonePositions(clones, context.ball, arenaForGame(context.game));
        pendingAlignment = false;
      }

      function updateCloneCollision(clone, cloneServices, arena) {
        const activeContacts = new Set();
        if (!clone.contactKeys) clone.contactKeys = new Set();
        if (!clone.withinArena) {
          clone.contactKeys.clear();
          return;
        }
        cloneServices.forEachEnemy((target) => {
          const profile = cloneServices.getContactProfile(target);
          if (!profile.solid) return;
          if (!resolveCloneCollision(clone, target, arena)) return;
          const contactKey = target.instanceId;
          activeContacts.add(contactKey);
          if (profile.attackable && !clone.contactKeys.has(contactKey)) {
            cloneServices.dealDamage(target, COLLISION_DAMAGE);
          }
        });
        clone.contactKeys = activeContacts;
      }

      return {
        update(context) {
          initialize(context);
        },
        updateWhilePaused(context) {
          initialize(context);
        },
        afterUpdateStep: alignNewClones,
        afterUpdateStepWhilePaused: alignNewClones,
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, COLLISION_DAMAGE);
          }
        },
        onBorrowEnd() {
          for (const clone of clones) clone.entityActive = false;
          clones = [];
        },
        getWallMode() {
          return "wrap";
        },
        getCloneBodies() {
          return clones;
        }
      };
    }
  };

  registerBall(parallelDefinition);
  return { parallelDefinition };
});
