(function initializeScan(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createScanPlugin({ resolveArenaGeometry, registerBall }) {
  const SCAN_DAMAGE = 1;
  const LINE_WIDTH = 2;
  const LINE_ACTIVE_DURATION = 1.5;
  const LINE_FADE_DURATION = 0.5;
  const LINE_SPREAD_DURATION = 1;
  const ROUND_COOLDOWN = 1;
  const LINE_COLOR = "#ff00ff";
  const LINE_HALO = "rgba(255, 0, 255, 0.28)";
  const EPSILON = 1e-9;

  function drawScanLine(line, context) {
    const remaining = line.life - line.age;
    const fade = Math.max(0, Math.min(1, remaining / LINE_FADE_DURATION));
    context.save();
    context.globalAlpha *= fade;
    context.beginPath();
    context.moveTo(line.x, line.topY);
    context.lineTo(line.x, line.bottomY);
    context.strokeStyle = LINE_HALO;
    context.lineWidth = LINE_WIDTH + 6;
    context.stroke();
    context.strokeStyle = LINE_COLOR;
    context.lineWidth = LINE_WIDTH;
    context.stroke();
    context.restore();
  }

  function intervalOverlapsBand(low, high, lineX, halfBand) {
    return low <= lineX + halfBand + EPSILON && high >= lineX - halfBand - EPSILON;
  }

  // 每子步的位移段（prevX→x）与竖线检测带求交，高速目标跨线也不会漏判；
  // 环形竞技场 wrap 会在一帧内从一边界跳到另一边界，按两侧路径分段检查。
  function targetPathOverlapsLine(target, line) {
    const halfBand = target.radius + line.width / 2;
    const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const currentX = target.x;
    const arenaSize = line.arenaSize;
    const left = line.left || 0, right = line.right || arenaSize;
    if (Math.abs(currentX - previousX) <= arenaSize / 2) {
      return intervalOverlapsBand(
        Math.min(previousX, currentX),
        Math.max(previousX, currentX),
        line.x,
        halfBand
      );
    }
    const crossedRightEdge = previousX > (left + right) / 2;
    const legs = crossedRightEdge
      ? [[previousX, right], [left, currentX]]
      : [[left, previousX], [currentX, right]];
    return legs.some(([low, high]) => intervalOverlapsBand(low, high, line.x, halfBand));
  }

  function createScanLine(x, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const span = arena.shape === "circle" ? Math.sqrt(Math.max(0, (arena.width / 2) ** 2 - (x - arena.centerX) ** 2)) : arena.height / 2;
    return {
      kind: "scan-line",
      combatKind: "zone",
      life: LINE_ACTIVE_DURATION + LINE_FADE_DURATION,
      drawLayer: "background",
      x,
      arenaSize: arena.width,
      left: arena.left, right: arena.right,
      topY: arena.centerY - span,
      bottomY: arena.centerY + span,
      width: LINE_WIDTH,
      damage: SCAN_DAMAGE,
      // 与蛛网一致：按“当前接触”去重，而不是整条线只命中一次。
      // 敌方离开扫描线后再次进入时，应重新结算一次伤害。
      touchingTargets: new Set(),
      update({ entity: line, services }) {
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          const wasTouching = line.touchingTargets.has(key);
          const isTouching = intervalOverlapsBand(
            target.x,
            target.x,
            line.x,
            target.radius + line.width / 2
          );
          if (
            !wasTouching &&
            (isTouching || targetPathOverlapsLine(target, line))
          ) {
            services.dealDamage(target, SCAN_DAMAGE);
          }
          if (isTouching) line.touchingTargets.add(key);
          else if (wasTouching) line.touchingTargets.delete(key);
        });
      },
      draw({ entity: line }, context) {
        drawScanLine(line, context);
      }
    };
  }

  const scanDefinition = {
    id: "scan",
    name: "扫描",
    englishName: "Scan",
    color: LINE_COLOR,
    description: "周期扫描 / 开局中心1道竖线 每轮+1道 1s内从左到右铺开 / 接触-1 维持1.5s后渐隐",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const state = {
        round: 0,
        lineInterval: 0,
        linesLeft: 0,
        nextLineIn: 0,
        nextRoundIn: 0
      };

      function spawnLine(context, lineIndex) {
        const arena = resolveArenaGeometry(context.game);
        const x = arena.left + arena.width * (lineIndex + 1) / (state.round + 1);
        services.spawnCombatEntity(createScanLine(x, arena));
      }

      function beginNextRound(context) {
        state.round += 1;
        state.lineInterval = LINE_SPREAD_DURATION / state.round;
        state.linesLeft = state.round;
        state.nextLineIn = 0;
        state.nextRoundIn = LINE_SPREAD_DURATION * (state.round - 1) / state.round
          + LINE_ACTIVE_DURATION + ROUND_COOLDOWN;
      }

      return {
        onSpawn(context) {
          beginNextRound(context);
        },
        update(context, dt) {
          const step = Math.max(0, dt);
          state.nextLineIn -= step;
          while (state.linesLeft > 0 && state.nextLineIn <= EPSILON) {
            spawnLine(context, state.round - state.linesLeft);
            state.linesLeft -= 1;
            state.nextLineIn += state.lineInterval;
          }
          state.nextRoundIn -= step;
          if (state.linesLeft === 0 && state.nextRoundIn <= EPSILON) {
            beginNextRound(context);
          }
        }
      };
    }
  };

  registerBall(scanDefinition);
  return { scanDefinition };
});
