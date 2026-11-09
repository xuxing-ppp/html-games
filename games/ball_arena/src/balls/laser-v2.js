(function initializeLaserV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLaserV2Plugin({ getArenaWallContacts, registerBall }) {
  const LINE_WIDTH = 3;
  const CROSSING_DAMAGE = 2;
  const EPSILON = 1e-9;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function crossesLine(target, line) {
    const pathX = target.x - target.prevX;
    const pathY = target.y - target.prevY;
    const lineX = line.end.x - line.start.x;
    const lineY = line.end.y - line.start.y;
    const denominator = crossProduct(pathX, pathY, lineX, lineY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = line.start.x - target.prevX;
    const offsetY = line.start.y - target.prevY;
    const pathProgress = crossProduct(offsetX, offsetY, lineX, lineY) / denominator;
    const lineProgress = crossProduct(offsetX, offsetY, pathX, pathY) / denominator;
    return pathProgress > EPSILON && pathProgress <= 1 + EPSILON &&
      lineProgress >= -EPSILON && lineProgress <= 1 + EPSILON;
  }

  function wallPoint(context) {
    const { x, y } = getArenaWallContacts(context)[0];
    return { x, y };
  }

  const laserV2Definition = {
    id: "laserV2",
    name: "\u6fc0\u5149V2",
    englishName: "Laser V2",
    color: "#a82cff",
    description: "\u4e24\u6b21\u78b0\u58c1\u751f\u6210\u6c38\u4e45\u6fc0\u5149 / \u8de8\u7ebf -2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      let firstPoint = null;
      let firstLineEntity = null;
      const lines = [];

      function lineGeometry(line) {
        return {
          start: line.start,
          end: { x: line.end.x, y: line.end.y }
        };
      }

      function drawLine(canvasContext, line) {
        canvasContext.save();
        canvasContext.globalAlpha *= 0.82;
        canvasContext.strokeStyle = "#bd42ff";
        canvasContext.shadowColor = "#aa24ff";
        canvasContext.shadowBlur = 5;
        canvasContext.lineWidth = LINE_WIDTH;
        canvasContext.beginPath();
        canvasContext.moveTo(line.start.x, line.start.y);
        canvasContext.lineTo(line.end.x, line.end.y);
        canvasContext.stroke();
        canvasContext.restore();
      }

      function spawnLine(context, start, end, lifecycle) {
        return services.spawnCombatEntity({
          kind: "laser-v2-line",
          combatKind: "zone",
          life: PERMANENT_LIFE,
          lifecycle,
          drawLayer: "background",
          start,
          end,
          shieldBreakPoints: lifecycle === "owner-bound" ? [start] : [start, end],
          shieldBreakRadius: 1,
          update({ entity, services: lineServices }) {
            lineServices.forEachEnemy((target) => {
              if (crossesLine(target, lineGeometry(entity))) {
                lineServices.dealDamage(target, CROSSING_DAMAGE);
              }
            });
          },
          draw({ entity }, canvasContext) {
            drawLine(canvasContext, entity);
          }
        });
      }

      return {
        onWallBounce(context) {
          const point = wallPoint(context);
          if (firstPoint && (!firstLineEntity || firstLineEntity.entityActive === false)) {
            firstPoint = null;
            firstLineEntity = null;
          }
          if (!firstPoint) {
            firstPoint = point;
            firstLineEntity = spawnLine(context, firstPoint, context.ball, "owner-bound");
            const pendingLine = firstLineEntity;
            pendingLine.onShieldDestroyed = () => {
              if (firstLineEntity !== pendingLine) return;
              firstPoint = null;
              firstLineEntity = null;
            };
            return;
          }
          if (Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= EPSILON) return;
          firstLineEntity.entityActive = false;
          lines.push(spawnLine(context, firstPoint, point, "independent"));
          firstPoint = null;
          firstLineEntity = null;
        },
        getLaserState() {
          return {
            firstPoint,
            lines: lines.filter((line) => line.entityActive !== false).map(lineGeometry)
          };
        }
      };
    }
  };

  registerBall(laserV2Definition);
  return { laserV2Definition };
});
