(function initializeCuttingBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCuttingBallPlugin({ registerBall, resolveArenaGeometry }) {
  const LINE_WIDTH = 3;
  const ZONE_ACTIVE_DURATION = 4;
  const ZONE_FADE_DURATION = 0.4;
  const ZONE_DAMAGE_INTERVAL = 0.25;
  const ZONE_DAMAGE = 2;
  const EPSILON = 1e-9;

  function wallPoint(context) {
    const { ball, game } = context;
    if (context.wallContacts && context.wallContacts.length) return context.wallContacts[0];
    const arena = resolveArenaGeometry(game);
    return {
      x: context.bouncedX
        ? (ball.x <= arena.left + ball.radius + EPSILON ? arena.left : arena.right)
        : ball.x,
      y: context.bouncedY
        ? (ball.y <= arena.top + ball.radius + EPSILON ? arena.top : arena.bottom)
        : ball.y
    };
  }

  function signedDistance(point, start, end) {
    return (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
  }

  function clipPolygon(polygon, start, end, keepPositive) {
    const result = [];
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      const currentDistance = signedDistance(current, start, end);
      const nextDistance = signedDistance(next, start, end);
      const currentInside = keepPositive
        ? currentDistance >= -EPSILON
        : currentDistance <= EPSILON;
      const nextInside = keepPositive
        ? nextDistance >= -EPSILON
        : nextDistance <= EPSILON;
      if (currentInside) result.push(current);
      if (currentInside === nextInside) continue;
      const ratio = currentDistance / (currentDistance - nextDistance);
      result.push({
        x: current.x + (next.x - current.x) * ratio,
        y: current.y + (next.y - current.y) * ratio
      });
    }
    return result;
  }

  function polygonArea(polygon) {
    let area = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      area += current.x * next.y - next.x * current.y;
    }
    return Math.abs(area) / 2;
  }

  function smallerRegion(start, end, arenaSize) {
    const geometry = resolveArenaGeometry(arenaSize);
    const arena = geometry.shape === "circle"
      ? Array.from({ length: 128 }, (_, index) => ({
        x: geometry.centerX + Math.cos(index * Math.PI / 64) * geometry.width / 2,
        y: geometry.centerY + Math.sin(index * Math.PI / 64) * geometry.width / 2
      })) : [
        { x: geometry.left, y: geometry.top }, { x: geometry.right, y: geometry.top },
        { x: geometry.right, y: geometry.bottom }, { x: geometry.left, y: geometry.bottom }
      ];
    const positive = clipPolygon(arena, start, end, true);
    const negative = clipPolygon(arena, start, end, false);
    return polygonArea(positive) <= polygonArea(negative) ? positive : negative;
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
      const a = polygon[current];
      const b = polygon[previous];
      if (
        (a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x
      ) inside = !inside;
    }
    return inside;
  }

  function createCutZone(start, end, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const polygon = smallerRegion(start, end, arena);
    const centerSign = Math.sign(signedDistance({ x: arena.centerX, y: arena.centerY }, start, end)) || -1;
    return {
      kind: "cutting-ball-zone",
      life: ZONE_ACTIVE_DURATION + ZONE_FADE_DURATION,
      activeDuration: ZONE_ACTIVE_DURATION,
      start,
      end,
      polygon,
      lineWidth: LINE_WIDTH,
      damageTimers: new Map(),
      update({ effect, services: zoneServices }, dt) {
        if (effect.age > effect.activeDuration + EPSILON) return;
        const activeKeys = new Set();
        zoneServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (!(arena.shape === "circle" ? signedDistance(target, start, end) * centerSign <= EPSILON : pointInPolygon(target, effect.polygon))) {
            effect.damageTimers.delete(key);
            return;
          }
          activeKeys.add(key);
          let timer = (effect.damageTimers.get(key) || 0) + Math.max(0, dt);
          while (timer + EPSILON >= ZONE_DAMAGE_INTERVAL && target.hp > 0) {
            timer -= ZONE_DAMAGE_INTERVAL;
            zoneServices.dealDamage(target, ZONE_DAMAGE);
          }
          effect.damageTimers.set(key, timer);
        });
        for (const key of effect.damageTimers.keys()) {
          if (!activeKeys.has(key)) effect.damageTimers.delete(key);
        }
      },
      draw({ effect }, context) {
        const fade = effect.age <= effect.activeDuration
          ? 1
          : Math.max(0, (effect.life - effect.age) / ZONE_FADE_DURATION);
        context.save();
        context.globalAlpha *= fade;
        context.fillStyle = "rgba(230, 35, 48, 0.25)";
        context.beginPath();
        effect.polygon.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.fill();
        context.strokeStyle = "#e32636";
        context.lineWidth = effect.lineWidth;
        context.beginPath();
        context.moveTo(effect.start.x, effect.start.y);
        context.lineTo(effect.end.x, effect.end.y);
        context.stroke();
        context.restore();
      }
    };
  }

  const cuttingBallDefinition = {
    id: "cuttingBall",
    name: "\u5207\u5272\u7403",
    englishName: "Cutting Ball",
    color: "#d92d3f",
    description: "\u4e24\u6b21\u78b0\u58c1\u5207\u5272\u6218\u573a / \u5c0f\u533a\u57df\u6301\u7eed\u4f24\u5bb3",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      let firstPoint = null;
      const zones = [];
      return {
        update() {
          for (let index = zones.length - 1; index >= 0; index -= 1) {
            if (zones[index].age + EPSILON >= zones[index].life) zones.splice(index, 1);
          }
        },
        onWallBounce(context) {
          const point = wallPoint(context);
          if (!firstPoint) {
            firstPoint = point;
            return;
          }
          if (Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= EPSILON) return;
          zones.push(services.spawnCombatEntity(createCutZone(
            firstPoint,
            point,
            context.game.arena || context.game.arenaSize
          )));
          firstPoint = null;
        },
        drawArenaBackground(context, canvasContext) {
          if (!firstPoint) return;
          canvasContext.save();
          canvasContext.globalAlpha *= 0.85;
          canvasContext.strokeStyle = "#e32636";
          canvasContext.lineWidth = LINE_WIDTH;
          canvasContext.beginPath();
          canvasContext.moveTo(firstPoint.x, firstPoint.y);
          canvasContext.lineTo(context.ball.x, context.ball.y);
          canvasContext.stroke();
          canvasContext.restore();
        },
        getCuttingState() {
          return {
            firstPoint,
            zones,
            zone: zones.length > 0 ? zones[zones.length - 1] : null
          };
        }
      };
    }
  };

  registerBall(cuttingBallDefinition);
  return { cuttingBallDefinition };
});
