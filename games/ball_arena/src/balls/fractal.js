(function initializeFractal(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFractalPlugin({ registerBall, resolveArenaGeometry }) {
  const PHASE_DURATION = 2;
  const PHASE_COUNT = 4;
  const LINE_WIDTH = 1.5;
  const LINE_DAMAGE = 1;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const BODY_COLOR = "#ffffff";
  const LINE_COLOR = "#d9344f";

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function crossesLine(target, line) {
    const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const previousY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const pathX = target.x - previousX;
    const pathY = target.y - previousY;
    const lineX = line.end.x - line.start.x;
    const lineY = line.end.y - line.start.y;
    const denominator = crossProduct(pathX, pathY, lineX, lineY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = line.start.x - previousX;
    const offsetY = line.start.y - previousY;
    const pathProgress = crossProduct(offsetX, offsetY, lineX, lineY) / denominator;
    const lineProgress = crossProduct(offsetX, offsetY, pathX, pathY) / denominator;
    return pathProgress > EPSILON && pathProgress <= 1 + EPSILON &&
      lineProgress >= -EPSILON && lineProgress <= 1 + EPSILON;
  }

  function line(startX, startY, endX, endY) {
    return { start: { x: startX, y: startY }, end: { x: endX, y: endY } };
  }

  function phaseLines(phase, geometry) {
    const arena = resolveArenaGeometry(geometry);
    const arenaSize = arena.size;
    const lines = [];
    if (phase === 0 || phase === 1) {
      lines.push(line(0, 0, arenaSize, arenaSize));
      lines.push(line(arenaSize, 0, 0, arenaSize));
    }
    if (phase === 1) {
      lines.push(line(arenaSize / 2, 0, arenaSize / 2, arenaSize));
      lines.push(line(0, arenaSize / 2, arenaSize, arenaSize / 2));
    }
    if (phase === 2) {
      const half = arenaSize / 2;
      lines.push(line(half, 0, half, arenaSize));
      lines.push(line(0, half, arenaSize, half));
      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 2; column += 1) {
          const x = column * half;
          const y = row * half;
          lines.push(line(x, y, x + half, y + half));
          lines.push(line(x + half, y, x, y + half));
        }
      }
    }
    if (phase === 3) {
      const cell = arenaSize / 3;
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const x = column * cell;
          const y = row * cell;
          lines.push(line(x, y, x + cell, y + cell));
          lines.push(line(x + cell, y, x, y + cell));
        }
      }
      lines.push(line(cell, 0, cell, arenaSize));
      lines.push(line(cell * 2, 0, cell * 2, arenaSize));
      lines.push(line(0, cell, arenaSize, cell));
      lines.push(line(0, cell * 2, arenaSize, cell * 2));
    }
    for (const segment of lines) {
      for (const point of [segment.start, segment.end]) {
        point.x = arena.left + point.x / arenaSize * arena.width;
        point.y = arena.top + point.y / arenaSize * arena.height;
      }
    }
    return lines;
  }

  function drawFractalBody({ ball }, context) {
    context.save();
    context.fillStyle = BODY_COLOR;
    context.strokeStyle = "#262626";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.strokeStyle = LINE_COLOR;
    context.lineWidth = 1.6;
    context.beginPath();
    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      context.moveTo(ball.x, ball.y);
      context.lineTo(
        ball.x + Math.cos(angle) * (ball.radius - 2),
        ball.y + Math.sin(angle) * (ball.radius - 2)
      );
    }
    context.stroke();
    context.restore();
    return true;
  }

  const fractalDefinition = {
    id: "fractal",
    name: "分形",
    englishName: "Fractal",
    color: BODY_COLOR,
    description: "每2秒变换一次的米字红线 / 过线 -1",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: PHASE_DURATION,
    createBehavior(services) {
      let field = null;
      let ownerBall = null;
      return {
        onSpawn(context) {
          ownerBall = context.ball;
          field = services.spawnCombatEntity({
            kind: "fractal-lines",
            combatKind: "zone",
            lifecycle: "owner-bound",
            life: PERMANENT_LIFE,
            solid: false,
            targetable: false,
            drawLayer: "background",
            phase: 0,
            lines: phaseLines(0, context.game),
            update({ entity, game, services: lineServices }) {
              const phase = Math.floor(game.time / PHASE_DURATION) % PHASE_COUNT;
              if (phase !== entity.phase) {
                entity.phase = phase;
                entity.lines = phaseLines(phase, game);
              }
              lineServices.forEachEnemy((target) => {
                if (!lineServices.getContactProfile(target).attackable) return;
                for (const currentLine of entity.lines) {
                  if (crossesLine(target, currentLine)) lineServices.dealDamage(target, LINE_DAMAGE);
                }
              });
            },
            draw({ entity }, context2d) {
              context2d.save();
              context2d.globalAlpha *= 0.92;
              context2d.strokeStyle = LINE_COLOR;
              context2d.shadowColor = "rgba(217, 52, 79, 0.55)";
              context2d.shadowBlur = 2;
              context2d.lineWidth = LINE_WIDTH;
              for (const currentLine of entity.lines) {
                context2d.beginPath();
                context2d.moveTo(currentLine.start.x, currentLine.start.y);
                context2d.lineTo(currentLine.end.x, currentLine.end.y);
                context2d.stroke();
              }
              context2d.restore();
            }
          });
        },
        drawBody: drawFractalBody,
        getFractalState() {
          return {
            phase: field ? field.phase : 0,
            lines: field ? field.lines.map((currentLine) => ({
              start: { ...currentLine.start },
              end: { ...currentLine.end }
            })) : [],
            active: Boolean(field && field.entityActive !== false),
            owner: ownerBall
          };
        }
      };
    }
  };

  registerBall(fractalDefinition);
  return {
    fractalDefinition,
    FRACTAL_PHASE_DURATION: PHASE_DURATION,
    createFractalPhaseLines: phaseLines,
    fractalCrossesLine: crossesLine
  };
});
