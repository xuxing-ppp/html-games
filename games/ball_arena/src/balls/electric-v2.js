(function initializeElectricV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricV2Plugin({ registerBall }) {
  const DISCHARGE_INTERVAL = 3.3;
  const MAX_COLLISIONS = 4;
  const MARKER_LIFE = 0.4;
  const ARC_LIFE = 0.24;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function createChargeMarker(target, count) {
    return {
      kind: "electric-v2-charge-marker",
      life: MARKER_LIFE,
      target,
      count,
      update({ effect, game }, dt) {
        if (!effect.target || effect.target.hp <= 0) effect.life = 0;
        else if (effect.refreshedAt + EPSILON >= game.time) effect.age = -dt;
      },
      draw({ effect }, context) {
        if (!effect.target || effect.target.hp <= 0) return;
        context.save();
        context.font = '700 11px "Courier New", Consolas, monospace';
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineWidth = 3;
        context.strokeStyle = "#4a3d00";
        context.fillStyle = "#ffe838";
        const x = Math.round(effect.target.x);
        const y = Math.round(effect.target.y - effect.target.radius - 13);
        context.strokeText(String(effect.count), x, y);
        context.fillText(String(effect.count), x, y);
        context.restore();
      }
    };
  }

  function createArc(source, target) {
    const startX = source.x;
    const startY = source.y;
    const endX = target.x;
    const endY = target.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / distance;
    const normalY = deltaX / distance;
    const segmentCount = Math.max(5, Math.min(14, Math.ceil(distance / 24)));
    const points = Array.from({ length: segmentCount + 1 }, (_, index) => {
      const progress = index / segmentCount;
      const edgeFade = Math.sin(progress * Math.PI);
      const offset = index === 0 || index === segmentCount
        ? 0
        : (Math.random() - 0.5) * Math.min(28, distance * 0.12) * edgeFade;
      return {
        x: startX + deltaX * progress + normalX * offset,
        y: startY + deltaY * progress + normalY * offset
      };
    });
    const branches = points.slice(2, -2).filter((_, index) => index % 3 === 0).map((point) => {
      const side = Math.random() < 0.5 ? -1 : 1;
      const length = 8 + Math.random() * 14;
      return {
        x: point.x,
        y: point.y,
        endX: point.x + normalX * side * length + deltaX / distance * length * 0.3,
        endY: point.y + normalY * side * length + deltaY / distance * length * 0.3
      };
    });
    return {
      kind: "electric-v2-arc",
      life: ARC_LIFE,
      points,
      branches,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const flicker = Math.floor(effect.age * 80) % 2 === 0 ? 1 : 0.68;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= (1 - progress) * flicker;
        context.lineJoin = "miter";
        context.lineCap = "butt";
        context.shadowColor = "#58ddff";
        context.shadowBlur = 10;
        context.strokeStyle = "#42cfff";
        context.lineWidth = 5 * (1 - progress * 0.55);
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
        context.shadowBlur = 4;
        context.strokeStyle = "#fffbd0";
        context.lineWidth = 1.4;
        context.stroke();
        context.strokeStyle = "#9ceeff";
        context.lineWidth = 1.2;
        effect.branches.forEach((branch) => {
          context.beginPath();
          context.moveTo(branch.x, branch.y);
          context.lineTo(branch.endX, branch.endY);
          context.stroke();
        });
        context.restore();
      }
    };
  }

  const electricV2Definition = {
    id: "electricV2",
    name: "\u7535\u7403V2",
    englishName: "Electric Ball V2",
    color: "#4edcff",
    description: "3.3秒放电 / 碰撞指数伤害",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let dischargeTimer = 0;
      let dischargePending = false;
      const collisionCounts = new Map();
      const markers = new Map();

      function countFor(target) {
        return collisionCounts.get(targetKey(target)) || 0;
      }

      function ensureMarker(target) {
        const key = targetKey(target);
        let marker = markers.get(key);
        if (!marker || marker.life <= 0 || marker.age >= marker.life) {
          marker = services.spawnVisualEffect(createChargeMarker(target, countFor(target)));
          markers.set(key, marker);
        }
        marker.age = 0;
        marker.refreshedAt = services.getTime();
        marker.count = countFor(target);
        marker.target = target;
        return marker;
      }

      function refreshMarkers() {
        const livingKeys = new Set();
        services.forEachEnemy((target) => {
          const key = targetKey(target);
          livingKeys.add(key);
          ensureMarker(target);
        });
        for (const [key, marker] of markers.entries()) {
          if (livingKeys.has(key)) continue;
          marker.life = 0;
          markers.delete(key);
          collisionCounts.delete(key);
        }
      }

      function discharge(ball) {
        services.forEachEnemy((target) => {
          const key = targetKey(target);
          const count = countFor(target);
          services.spawnVisualEffect(createArc(ball, target));
          services.dealDamage(target, Math.pow(3, count), ball);
          collisionCounts.set(key, 0);
          ensureMarker(target).count = 0;
        });
      }

      return {
        update(_context, dt) {
          dischargeTimer = Math.min(
            DISCHARGE_INTERVAL,
            dischargeTimer + Math.max(0, dt)
          );
          dischargePending = dischargeTimer + EPSILON >= DISCHARGE_INTERVAL;
          refreshMarkers();
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, DISCHARGE_INTERVAL - dischargeTimer);
        },
        afterUpdateStep(context) {
          if (!dischargePending) return;
          dischargePending = false;
          dischargeTimer = 0;
          discharge(context.ball);
        },
        onCollision(_context, target) {
          const key = targetKey(target);
          collisionCounts.set(key, Math.min(MAX_COLLISIONS, countFor(target) + 1));
          ensureMarker(target).count = countFor(target);
        }
      };
    }
  };

  registerBall(electricV2Definition);
  return { electricV2Definition };
});
