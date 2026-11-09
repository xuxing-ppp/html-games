(function initializeAngel(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAngelPlugin({ registerBall, resolveArenaGeometry }) {
  const HOLY_LIGHT_CHARGE = 0.8;
  const HOLY_LIGHT_HOLD = 0.4;
  const HOLY_LIGHT_DAMAGE = 9;
  const CROSS_HALF_WIDTH = 3;
  const CROSS_HALF_HEIGHT = 4;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function segmentIntersectsRect(
    x1, y1, x2, y2,
    minX, minY, maxX, maxY
  ) {
    let tMin = 0;
    let tMax = 1;
    const deltas = [
      { delta: x2 - x1, origin: x1, low: minX, high: maxX },
      { delta: y2 - y1, origin: y1, low: minY, high: maxY }
    ];
    for (const { delta, origin, low, high } of deltas) {
      if (Math.abs(delta) <= EPSILON) {
        if (origin < low || origin > high) return false;
        continue;
      }
      let t1 = (low - origin) / delta;
      let t2 = (high - origin) / delta;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return false;
    }
    return true;
  }

  function insideHolyLightRegion(target, light) {
    if (light.arena && light.arena.shape === "circle") {
      const project = (x, y) => x * light.tangentX + y * light.tangentY;
      const current = project(target.x, target.y);
      const previous = project(Number.isFinite(target.previousX) ? target.previousX : target.x,
        Number.isFinite(target.previousY) ? target.previousY : target.y);
      return Math.max(previous, current) + target.radius >= light.from && Math.min(previous, current) - target.radius <= light.to;
    }
    let minX;
    let minY;
    let maxX;
    let maxY;
    if (light.edge === "top" || light.edge === "bottom") {
      minX = Math.min(light.from, light.to);
      maxX = Math.max(light.from, light.to);
      minY = light.arena.top;
      maxY = light.arena.bottom;
    } else {
      minY = Math.min(light.from, light.to);
      maxY = Math.max(light.from, light.to);
      minX = light.arena.left;
      maxX = light.arena.right;
    }
    const previousX = Number.isFinite(target.previousX) ? target.previousX : target.x;
    const previousY = Number.isFinite(target.previousY) ? target.previousY : target.y;
    // Contact semantics: the ball's body counts, so the region is expanded
    // by the target radius (edge grazing hits, not just center crossings).
    const radius = Number.isFinite(target.radius) ? target.radius : 0;
    return segmentIntersectsRect(
      previousX, previousY, target.x, target.y,
      minX - radius, minY - radius, maxX + radius, maxY + radius
    );
  }

  function drawCross(cross, context) {
    context.save();
    if (Number.isFinite(cross.rotation)) {
      context.translate(cross.x, cross.y); context.rotate(cross.rotation);
      context.fillStyle = "rgba(240, 236, 228, 0.92)";
      context.fillRect(-CROSS_HALF_WIDTH, -1, CROSS_HALF_WIDTH * 2, 2);
      context.fillRect(-1, -CROSS_HALF_HEIGHT, 2, CROSS_HALF_HEIGHT * 2);
      context.restore(); return;
    }
    context.fillStyle = "rgba(240, 236, 228, 0.92)";
    if (cross.edge === "top" || cross.edge === "bottom") {
      // Vertical arm stands upright from the edge into the arena.
      context.fillRect(
        Math.round(cross.x - CROSS_HALF_WIDTH),
        Math.round(cross.y - 1),
        CROSS_HALF_WIDTH * 2,
        2
      );
      context.fillRect(
        Math.round(cross.x - 1),
        Math.round(cross.y - CROSS_HALF_HEIGHT),
        2,
        CROSS_HALF_HEIGHT * 2
      );
    } else {
      // Rotated: the long arm runs from the edge into the arena.
      context.fillRect(
        Math.round(cross.x - 1),
        Math.round(cross.y - CROSS_HALF_WIDTH),
        2,
        CROSS_HALF_WIDTH * 2
      );
      context.fillRect(
        Math.round(cross.x - CROSS_HALF_HEIGHT),
        Math.round(cross.y - 1),
        CROSS_HALF_HEIGHT * 2,
        2
      );
    }
    context.restore();
  }

  function createCross(x, y, edge, rotation) {
    return {
      kind: "angel-cross",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      solid: false,
      x,
      y,
      edge, rotation,
      draw({ entity: cross }, context) {
        drawCross(cross, context);
      }
    };
  }

  function createHolyLight(edge, firstX, secondX, firstY, secondY, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const normalLength = Math.hypot(arena.centerX - (firstX + secondX) / 2, arena.centerY - (firstY + secondY) / 2) || 1;
    const normalX = (arena.centerX - (firstX + secondX) / 2) / normalLength;
    const normalY = (arena.centerY - (firstY + secondY) / 2) / normalLength;
    const tangentX = normalY, tangentY = -normalX;
    const a = firstX * tangentX + firstY * tangentY, b = secondX * tangentX + secondY * tangentY;
    const from = arena.shape === "circle" ? Math.min(a, b) : edge === "top" || edge === "bottom" ? firstX : firstY;
    const to = arena.shape === "circle" ? Math.max(a, b) : edge === "top" || edge === "bottom" ? secondX : secondY;
    return {
      kind: "angel-holy-light",
      combatKind: "zone",
      life: HOLY_LIGHT_CHARGE + HOLY_LIGHT_HOLD,
      lifecycle: "independent",
      solid: false,
      drawLayer: "background",
      edge,
      from,
      to,
      arenaSize: arena.size, arena, normalX, normalY, tangentX, tangentY,
      hitTargets: new Set(),
      update({ entity: light, services }) {
        if (light.age < HOLY_LIGHT_CHARGE) return;
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (light.hitTargets.has(key)) return;
          if (!services.getContactProfile(target).attackable) return;
          if (!insideHolyLightRegion(target, light)) return;
          if (services.dealDamage(target, HOLY_LIGHT_DAMAGE)) {
            light.hitTargets.add(key);
          }
        });
      },
      draw({ entity: light }, context) {
        const elapsed = light.age;
        let alpha;
        if (elapsed < HOLY_LIGHT_CHARGE) {
          alpha = (elapsed / HOLY_LIGHT_CHARGE) * 0.6;
        } else {
          const holdProgress = (elapsed - HOLY_LIGHT_CHARGE) / HOLY_LIGHT_HOLD;
          alpha = 0.6 * (1 - holdProgress);
        }
        alpha = clamp(alpha, 0, 1);
        if (light.arena.shape === "circle") {
          context.save(); light.arena.tracePath(context); context.clip();
          context.globalCompositeOperation = "lighter"; context.globalAlpha *= alpha * 0.85;
          context.transform(light.tangentX, light.tangentY, light.normalX, light.normalY, 0, 0);
          context.fillStyle = "rgba(255, 250, 240, 0.7)";
          context.fillRect(light.from, -light.arena.size * 2, light.to - light.from, light.arena.size * 4);
          context.restore(); return;
        }

        let minX;
        let maxX;
        let minY;
        let maxY;
        if (light.edge === "top" || light.edge === "bottom") {
          minX = Math.min(light.from, light.to);
          maxX = Math.max(light.from, light.to);
          minY = light.arena.top;
          maxY = light.arena.bottom;
        } else {
          minY = Math.min(light.from, light.to);
          maxY = Math.max(light.from, light.to);
          minX = light.arena.left;
          maxX = light.arena.right;
        }

        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= alpha * 0.85;
        context.shadowColor = "#fff7e8";
        context.shadowBlur = 14;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        const gradient = context.createLinearGradient(
          light.edge === "left" ? 0 : (light.edge === "right" ? light.arenaSize : midX),
          light.edge === "top" ? 0 : (light.edge === "bottom" ? light.arenaSize : midY),
          light.edge === "left" ? light.arenaSize : (light.edge === "right" ? 0 : midX),
          light.edge === "top" ? light.arenaSize : (light.edge === "bottom" ? 0 : midY)
        );
        gradient.addColorStop(0, "rgba(255, 250, 240, 0.9)");
        gradient.addColorStop(1, "rgba(255, 250, 240, 0.05)");
        context.fillStyle = gradient;
        context.fillRect(minX, minY, maxX - minX, maxY - minY);
        context.restore();
      }
    };
  }

  function wallCrosses(context) {
    const { ball, game } = context;
    const arena = resolveArenaGeometry(game);
    if (arena.shape === "circle") {
      const contact = (context.wallContacts || [])[0];
      const length = Math.hypot(ball.x - arena.centerX, ball.y - arena.centerY) || 1;
      const nx = contact ? contact.normalX : (arena.centerX - ball.x) / length;
      const ny = contact ? contact.normalY : (arena.centerY - ball.y) / length;
      const x = contact ? contact.x : ball.x - nx * ball.radius;
      const y = contact ? contact.y : ball.y - ny * ball.radius;
      const angle = Math.atan2(y - arena.centerY, x - arena.centerX);
      const edge = ["top", "right", "bottom", "left"][((Math.floor((angle + Math.PI * 0.75) / (Math.PI / 2)) % 4) + 4) % 4];
      return [{ x: x + nx * CROSS_HALF_HEIGHT, y: y + ny * CROSS_HALF_HEIGHT, edge, rotation: Math.atan2(ny, nx) - Math.PI / 2 }];
    }
    const placements = [];
    if (context.bouncedX) {
      const left = ball.x <= arena.left + ball.radius + EPSILON;
      placements.push({
        x: left ? arena.left + CROSS_HALF_HEIGHT : arena.right - CROSS_HALF_HEIGHT,
        y: ball.y,
        edge: left ? "left" : "right"
      });
    }
    if (context.bouncedY) {
      const top = ball.y <= arena.top + ball.radius + EPSILON;
      placements.push({
        x: ball.x,
        y: top ? arena.top + CROSS_HALF_HEIGHT : arena.bottom - CROSS_HALF_HEIGHT,
        edge: top ? "top" : "bottom"
      });
    }
    return placements;
  }

  const angelDefinition = {
    id: "angel",
    name: "\u5929\u4f7f",
    englishName: "Angel",
    color: "#e9e4da",
    description: "\u78b0\u58c1\u7559\u4e0b\u5c0f\u5341\u5b57\u67b6 / \u540c\u8fb9\u53cc\u5341\u5b57\u964d\u4e0b\u5723\u5149 -9",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const crossesByEdge = {
        top: [],
        bottom: [],
        left: [],
        right: []
      };

      return {
        onWallBounce(context) {
          const arenaSize = context.game.arena || context.game.arenaSize;
          wallCrosses(context).forEach((placement) => {
            const crosses = crossesByEdge[placement.edge];
            if (crosses.length === 0) {
              const cross = services.spawnCombatEntity(createCross(
                placement.x,
                placement.y,
                placement.edge,
                placement.rotation
              ));
              crosses.push(cross);
              return;
            }
            const first = crosses[0];
            services.spawnCombatEntity(createHolyLight(
              placement.edge,
              first.x,
              placement.x,
              first.y,
              placement.y,
              arenaSize
            ));
            first.entityActive = false;
            crosses.length = 0;
          });
        },
        getAngelState() {
          return {
            crosses: {
              top: crossesByEdge.top.length,
              bottom: crossesByEdge.bottom.length,
              left: crossesByEdge.left.length,
              right: crossesByEdge.right.length
            }
          };
        }
      };
    }
  };

  registerBall(angelDefinition);
  return { angelDefinition };
});
