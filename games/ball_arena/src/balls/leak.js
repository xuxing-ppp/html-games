(function initializeLeak(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLeakPlugin({ resolveArenaGeometry, registerBall }) {
  const PHASE_DURATION = 0.3;
  const WALL_TICK_INTERVAL = 0.25;
  const WALL_TICK_DAMAGE = 6;
  const WALL_NEAR_DISTANCE = 30;
  const EPSILON = 1e-9;
  const WALL_GLOW_COLOR = "#3fe0ff";
  const WALL_CORE_COLOR = "#d8fbff";

  function distanceToWallEdges(target, arenaSize) {
    const radius = Number.isFinite(target.radius) ? target.radius : 0;
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") return arena.width / 2 - Math.hypot(target.x - arena.centerX, target.y - arena.centerY) - radius;
    return Math.min(
      target.x - radius - arena.left,
      arena.right - (target.x + radius),
      target.y - radius - arena.top,
      arena.bottom - (target.y + radius)
    );
  }

  function noise(seed, index, frame) {
    const value = Math.sin(seed * 0.017 + index * 12.9898 + frame * 2.33) * 43758.5453;
    return value - Math.floor(value);
  }

  function traceJagged(
    canvasContext,
    startX,
    startY,
    endX,
    endY,
    jitter,
    seed,
    frame
  ) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    const segments = Math.max(5, Math.ceil(length / 16));
    canvasContext.beginPath();
    canvasContext.moveTo(startX, startY);
    for (let index = 1; index < segments; index += 1) {
      const progress = index / segments;
      const offset = (noise(seed, index, frame) - 0.5) * jitter * 2;
      const sway = Math.sin(frame * 1.7 + index * 2.1 + seed) * jitter * 0.45;
      canvasContext.lineTo(
        startX + deltaX * progress + normalX * (offset + sway),
        startY + deltaY * progress + normalY * (offset + sway)
      );
    }
    canvasContext.lineTo(endX, endY);
  }

  function edgeGeometry(edgeIndex, arenaSize) {
    if (edgeIndex === 0) return { x: 0, y: 3, horizontal: true };
    if (edgeIndex === 1) return { x: arenaSize - 3, y: 0, horizontal: false };
    if (edgeIndex === 2) return { x: 0, y: arenaSize - 3, horizontal: true };
    return { x: 3, y: 0, horizontal: false };
  }

  function drawChargedWalls(context, canvasContext) {
    const arenaSize = context.game.arenaSize;
    const arena = resolveArenaGeometry(context.game);
    if (arena.shape !== "square") {
      canvasContext.save();
      canvasContext.globalCompositeOperation = "lighter";
      for (const [width, alpha] of [[8, 0.15], [3, 0.7], [0.8, 1]]) {
        arena.tracePath(canvasContext, 3);
        canvasContext.strokeStyle = width === 0.8 ? WALL_CORE_COLOR : WALL_GLOW_COLOR;
        canvasContext.lineWidth = width;
        canvasContext.globalAlpha *= alpha;
        canvasContext.stroke();
      }
      canvasContext.restore();
      return;
    }
    const frame = Math.floor(context.game.time * 42);
    canvasContext.save();
    canvasContext.globalCompositeOperation = "lighter";
    canvasContext.lineCap = "round";

    for (let edgeIndex = 0; edgeIndex < 4; edgeIndex += 1) {
      const edge = edgeGeometry(edgeIndex, arenaSize);
      const horizontal = edge.horizontal;
      const startX = horizontal ? 0 : edge.x;
      const startY = horizontal ? edge.y : 0;
      const endX = horizontal ? arenaSize : edge.x;
      const endY = horizontal ? edge.y : arenaSize;
      const seed = edgeIndex * 37 + 11;

      canvasContext.globalAlpha *= 0.14;
      canvasContext.strokeStyle = WALL_GLOW_COLOR;
      canvasContext.lineWidth = 9;
      canvasContext.shadowColor = WALL_GLOW_COLOR;
      canvasContext.shadowBlur = 18;
      traceJagged(canvasContext, startX, startY, endX, endY, 7, seed, frame);
      canvasContext.stroke();

      canvasContext.globalAlpha *= 1 / 0.14 * 0.42;
      canvasContext.strokeStyle = WALL_GLOW_COLOR;
      canvasContext.lineWidth = 3.4;
      canvasContext.shadowBlur = 9;
      traceJagged(canvasContext, startX, startY, endX, endY, 5, seed, frame);
      canvasContext.stroke();

      canvasContext.globalAlpha *= 1 / 0.42 * 0.92;
      canvasContext.strokeStyle = WALL_CORE_COLOR;
      canvasContext.lineWidth = 1.3;
      canvasContext.shadowBlur = 4;
      traceJagged(canvasContext, startX, startY, endX, endY, 5, seed + 4009, frame);
      canvasContext.stroke();
      canvasContext.globalAlpha *= 1 / 0.92;

      for (let dot = 0; dot < 3; dot += 1) {
        const travel = (
          context.game.time * 0.55 +
          dot / 3 +
          edgeIndex * 0.131
        ) % 1;
        const dotX = horizontal ? travel * arenaSize : edge.x;
        const dotY = horizontal ? edge.y : travel * arenaSize;
        const pulse = 0.4 + Math.sin(context.game.time * 24 + dot * 7) * 0.3;
        canvasContext.globalAlpha *= 0.5 + pulse * 0.4;
        canvasContext.fillStyle = WALL_CORE_COLOR;
        canvasContext.shadowBlur = 12;
        canvasContext.beginPath();
        canvasContext.arc(dotX, dotY, 1.6 + pulse * 0.8, 0, Math.PI * 2);
        canvasContext.fill();
        canvasContext.globalAlpha *= 1 / (0.5 + pulse * 0.4);
      }

      const arcRoll = noise(seed + 77, frame, 0);
      if (arcRoll > 0.5 && arcRoll > 0.75) {
        const along = noise(seed + 131, frame, 3);
        const anchorX = horizontal ? along * arenaSize : edge.x;
        const anchorY = horizontal ? edge.y : along * arenaSize;
        const inwardX = horizontal ? (anchorX < arenaSize / 2 ? 12 : -12) : 10;
        const inwardY = horizontal ? 10 : (anchorY < arenaSize / 2 ? 12 : -12);
        canvasContext.globalAlpha *= 0.55;
        canvasContext.strokeStyle = WALL_GLOW_COLOR;
        canvasContext.lineWidth = 1.8;
        canvasContext.shadowBlur = 8;
        traceJagged(
          canvasContext,
          anchorX,
          anchorY,
          Math.min(arenaSize, Math.max(0, anchorX + inwardX)),
          Math.min(arenaSize, Math.max(0, anchorY + inwardY)),
          6,
          seed + 991,
          frame
        );
        canvasContext.stroke();
        canvasContext.globalAlpha *= 1 / 0.55;
      }
    }

    const corners = [
      [3, 3],
      [arenaSize - 3, 3],
      [3, arenaSize - 3],
      [arenaSize - 3, arenaSize - 3]
    ];
    corners.forEach(([cornerX, cornerY], index) => {
      const flicker = 0.55 + Math.sin(frame * 1.3 + index * 2.4) * 0.4;
      if (flicker <= 0.25) return;
      canvasContext.globalAlpha *= flicker;
      canvasContext.fillStyle = WALL_CORE_COLOR;
      canvasContext.shadowColor = WALL_GLOW_COLOR;
      canvasContext.shadowBlur = 16;
      canvasContext.fillRect(cornerX - 2, cornerY - 2, 4, 4);
      canvasContext.globalAlpha *= 0.5;
      canvasContext.beginPath();
      canvasContext.arc(cornerX, cornerY, 7 + flicker * 5, 0, Math.PI * 2);
      canvasContext.stroke();
      canvasContext.globalAlpha *= 1 / (flicker * 0.5);
    });
    canvasContext.restore();
  }

  const leakDefinition = {
    id: "leak",
    name: "\u6f0f\u7535",
    englishName: "Leak",
    color: "#42b9df",
    description: "\u7a7f\u5899\u5faa\u73af / \u7a7f\u5899\u65f6\u56db\u8fb9\u5e26\u7535",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let phasing = false;
      let phaseRemaining = 0;
      let tickTimer = 0;
      let stunned = false;

      function advancePhase(context, elapsed, canAttack) {
        if (!phasing) return;
        phaseRemaining = Math.max(0, phaseRemaining - elapsed);
        if (canAttack) {
          tickTimer += elapsed;
          if (tickTimer + EPSILON >= WALL_TICK_INTERVAL) {
            tickTimer -= WALL_TICK_INTERVAL;
            const arenaSize = context.game.arenaSize;
            services.forEachEnemy((target) => {
              if (distanceToWallEdges(target, context.game) < WALL_NEAR_DISTANCE) {
                services.dealDamage(target, WALL_TICK_DAMAGE, context.ball);
              }
            });
          }
        }
        if (phaseRemaining <= EPSILON) {
          phasing = false;
          tickTimer = 0;
        }
      }

      return {
        // 平行球式穿墙：引擎在球越过边界时直接把它回卷到对侧，
        // 球体保持普通运动与普通绘制；这里只负责穿墙瞬间的带电窗口。
        getWallMode() {
          return "wrap";
        },
        update(context, dt) {
          stunned = false;
          advancePhase(context, Math.max(0, dt), true);
        },
        // 穿墙相位是进行中的物理状态：被眩晕时窗口照常走完（球仍可穿过），
        // 但墙壁通电暂停、不再结算 tick 伤害，眩晕结束后恢复正常。
        updateWhilePaused(context, dt) {
          stunned = true;
          advancePhase(context, Math.max(0, dt), false);
        },
        onArenaWrap() {
          if (phasing) return;
          phasing = true;
          phaseRemaining = PHASE_DURATION;
          tickTimer = 0;
        },
        drawArenaForeground(context, canvasContext) {
          if (phasing && !stunned) drawChargedWalls(context, canvasContext);
        },
        getLeakState() {
          return {
            phasing,
            phaseRemaining,
            tickTimer,
            stunned,
            wallsCharged: phasing && !stunned
          };
        }
      };
    }
  };

  registerBall(leakDefinition);
  return { leakDefinition, drawChargedWalls };
});
