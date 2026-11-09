(function initializeTrapperV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTrapperV2Plugin({ resolveArenaGeometry, registerBall }) {
  const EPSILON = 1e-9;
  // 橙色布线 / 红色区域陷阱
  const LINE_COLOR = "#ff8c1a";
  const LINE_GLOW = "#ffb45c";
  const TRAP_COLOR = "#ff2d45";
  const TRAP_FILL = "#ff2948";
  const TRAP_DURATION = 5;
  const TRAP_DAMAGE = 3;
  // 一条线两侧都要留出足够宽度，敌人才可能整个人待在某个区域里
  const MIN_REGION = 46;
  // 触发时橙色十字会淡出：两条线常常在同一帧就被吃掉，留个残影才看得见布线
  const LINE_FADE = 0.55;
  // 陷阱消失后进入 2.4 秒冷却：这段时间不布线
  const LAY_COOLDOWN = 2.4;
  const TRAP_EFFECT_MIN_DURATION = 0.05;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  // 与陷阱师 V1 同一套效果：区域内不能出手、行为暂停
  function createTrapEffect(trap) {
    return {
      id: "trapper-v2-trap",
      duration: Math.max(TRAP_EFFECT_MIN_DURATION, trap.life - trap.age),
      preventsAttack: true,
      pausesBehavior: true,
      visualType: "disarm"
    };
  }

  // 一横一竖把场地切成四个矩形
  function regionRects(arenaSize, horizontalY, verticalX) {
    const {left,top,right,bottom} = resolveArenaGeometry(arenaSize);
    return [
      { left, top, right: verticalX, bottom: horizontalY },
      { left: verticalX, top, right, bottom: horizontalY },
      { left, top: horizontalY, right: verticalX, bottom },
      { left: verticalX, top: horizontalY, right, bottom }
    ];
  }

  // 整个本体都在矩形里 —— 也就是没碰到任何一条橙色线
  function isFullyInside(ball, region) {
    if (!ball || !Number.isFinite(ball.x) || !Number.isFinite(ball.y)) return false;
    const radius = Number.isFinite(ball.radius) ? ball.radius : 0;
    return (
      ball.x - radius > region.left + EPSILON &&
      ball.x + radius < region.right - EPSILON &&
      ball.y - radius > region.top + EPSILON &&
      ball.y + radius < region.bottom - EPSILON
    );
  }

  // 区域陷阱：红边 + 半透明红，关在里面的敌人撞到"非战场边缘"的内边界就扣血并弹回
  function createRegionTrap(region, arenaSize) {
    return {
      kind: "trapper-v2-red-zone",
      combatKind: "trap",
      trap: true,
      life: TRAP_DURATION,
      x: (region.left + region.right) / 2,
      y: (region.top + region.bottom) / 2,
      radius: Math.min(region.right - region.left, region.bottom - region.top) / 2,
      region: {
        left: region.left,
        top: region.top,
        right: region.right,
        bottom: region.bottom
      },
      arenaSize,
      active: false,
      capturedTargets: new Set(),
      boundaryContacts: new Set(),
      update({ effect, game, services: trapServices }) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        const area = effect.region;
        const nextContacts = new Set();
        trapServices.forEachEnemy((target) => {
          if (!trapServices.getContactProfile(target).solid) return;
          const key = targetKey(target);
          if (!effect.capturedTargets.has(key)) {
            if (!isFullyInside(target, area)) return;
            effect.capturedTargets.add(key);
            effect.active = true;
            trapServices.applyEffect(target, createTrapEffect(effect));
          }
          const radius = Number.isFinite(target.radius) ? target.radius : 0;
          const sides = [
            { key: "left", bound: area.left, axis: "x", sign: -1, edge: area.left <= resolveArenaGeometry(game).left + EPSILON },
            { key: "right", bound: area.right, axis: "x", sign: 1, edge: area.right >= resolveArenaGeometry(game).right - EPSILON },
            { key: "top", bound: area.top, axis: "y", sign: -1, edge: area.top <= resolveArenaGeometry(game).top + EPSILON },
            { key: "bottom", bound: area.bottom, axis: "y", sign: 1, edge: area.bottom >= resolveArenaGeometry(game).bottom - EPSILON }
          ];
          for (const side of sides) {
            // 战场边缘不是陷阱边界：那里照常撞墙，不扣血
            if (side.edge) continue;
            const value = side.axis === "x" ? target.x : target.y;
            const velocity = side.axis === "x" ? target.vx : target.vy;
            const stored = side.axis === "x" ? target.storedVx : target.storedVy;
            const limit = side.sign < 0 ? side.bound + radius : side.bound - radius;
            const crossed = side.sign < 0
              ? value < limit - EPSILON
              : value > limit + EPSILON;
            if (!crossed) continue;
            if (side.axis === "x") {
              target.x = limit;
            } else {
              target.y = limit;
            }
            const movingOut = side.sign < 0 ? velocity < -EPSILON : velocity > EPSILON;
            if (movingOut) {
              if (side.axis === "x") {
                target.vx = -velocity;
                target.storedVx = -stored;
              } else {
                target.vy = -velocity;
                target.storedVy = -stored;
              }
            }
            const contactKey = key + ":" + side.key;
            nextContacts.add(contactKey);
            if (effect.boundaryContacts.has(contactKey)) continue;
            trapServices.dealDamage(target, TRAP_DAMAGE);
          }
        });
        effect.boundaryContacts = nextContacts;
      },
      draw({ effect, game }, context) {
        const area = effect.region;
        const width = area.right - area.left;
        const height = area.bottom - area.top;
        const remain = clamp(1 - effect.age / effect.life, 0, 1);
        const pulse = effect.active ? 0.78 + Math.sin(game.time * 16) * 0.22 : 0.4;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= pulse * (0.45 + remain * 0.55);
        context.fillStyle = TRAP_FILL;
        context.globalAlpha *= 0.18;
        context.fillRect(area.left, area.top, width, height);
        context.globalAlpha = pulse * (0.5 + remain * 0.5);
        context.strokeStyle = TRAP_COLOR;
        context.shadowColor = TRAP_COLOR;
        context.shadowBlur = effect.active ? 9 : 0;
        context.lineWidth = effect.active ? 3 : 1.6;
        context.strokeRect(area.left, area.top, width, height);
        context.restore();
      }
    };
  }

  const trapperV2Definition = {
    id: "trapperV2",
    name: "\u9677\u9631\u5e08V2",
    englishName: "Trapper V2",
    color: "#ff8c1a",
    description: "\u649e\u5899\u5e03\u6a2a\u7ad6\u4e24\u6761\u6a59\u7ebf / \u56db\u5206\u573a\u5730 / \u654c\u4eba\u843d\u5165\u5176\u4e00\u5219\u53d8\u7ea2\u8272\u533a\u57df\u9677\u9631 5 \u79d2",
    rionCycleDuration: 8,
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let trap = null;
      let layCooldownUntil = 0;
      const attackNow = (context) => typeof services.getAttackTime === "function"
        ? services.getAttackTime() : context.game.time;
      const lines = { horizontal: null, vertical: null };
      const fadingLines = [];

      function resetLines() {
        lines.horizontal = null;
        lines.vertical = null;
      }

      function layLine(context, arenaSize) {
        const ball = context.ball;
        const margin = Math.max(MIN_REGION, (Number.isFinite(ball.radius) ? ball.radius : 0) * 2 + 8);
        const arena = resolveArenaGeometry(context.game);
        const xMargin = Math.min(margin, arena.width / 2), yMargin = Math.min(margin, arena.height / 2);
        // 撞左右板边 → 垂直于板边的横线；撞上下板边 → 竖线。
        // 同方向只允许一条：该方向已有线时这次碰撞不布线。
        if (context.bouncedY && lines.vertical === null) {
          lines.vertical = clamp(ball.x, arena.left + xMargin, arena.right - xMargin);
          return;
        }
        if (context.bouncedX && lines.horizontal === null) {
          lines.horizontal = clamp(ball.y, arena.top + yMargin, arena.bottom - yMargin);
        }
      }

      return {
        onWallBounce(context) {
          if (trap) return;
          if (attackNow(context) + EPSILON < layCooldownUntil) return;
          layLine(context, context.game.arenaSize);
        },
        afterUpdateStep(context) {
          while (
            fadingLines.length > 0 &&
            context.game.time - fadingLines[0].at >= LINE_FADE
          ) {
            fadingLines.shift();
          }
          if (trap) {
            // 陷阱消失 → 冷却 2.4 秒后才开始下一轮布线
            if (trap.entityActive === false || trap.age + EPSILON >= trap.life) {
              trap = null;
              layCooldownUntil = attackNow(context) + LAY_COOLDOWN;
            }
            return;
          }
          if (lines.horizontal === null || lines.vertical === null) return;
          const arenaSize = context.game.arenaSize;
          const regions = regionRects(context.game, lines.horizontal, lines.vertical);
          let target = null;
          context.services.forEachEnemy((enemy) => {
            if (target) return;
            for (const region of regions) {
              if (!isFullyInside(enemy, region)) continue;
              target = region;
              return;
            }
          });
          if (!target) return;
          fadingLines.push({
            horizontal: lines.horizontal,
            vertical: lines.vertical,
            at: context.game.time
          });
          resetLines();
          trap = context.services.spawnCombatEntity(createRegionTrap(target, arenaSize));
        },
        drawArenaForeground(context, canvas) {
          const arenaSize = context.game.arenaSize;
          const strokeLine = (draw, alpha = 1) => {
            canvas.save();
            canvas.lineCap = "round";
            canvas.globalAlpha *= alpha;
            canvas.globalAlpha *= 0.28;
            canvas.strokeStyle = LINE_GLOW;
            canvas.lineWidth = 7;
            draw();
            canvas.globalAlpha /= 0.28;
            canvas.strokeStyle = LINE_COLOR;
            canvas.lineWidth = 2.6;
            draw();
            canvas.restore();
          };
          if (lines.horizontal !== null) {
            strokeLine(() => {
              canvas.beginPath();
              canvas.moveTo(0, lines.horizontal);
              canvas.lineTo(arenaSize, lines.horizontal);
              canvas.stroke();
            });
          }
          if (lines.vertical !== null) {
            strokeLine(() => {
              canvas.beginPath();
              canvas.moveTo(lines.vertical, 0);
              canvas.lineTo(lines.vertical, arenaSize);
              canvas.stroke();
            });
          }
          // 触发后淡出的残影：让观众看清这次布线把场地切成了哪四块
          for (const ghost of fadingLines) {
            const alpha = Math.max(0, 1 - (context.game.time - ghost.at) / LINE_FADE);
            if (alpha <= 0) continue;
            if (ghost.horizontal !== null) {
              strokeLine(() => {
                canvas.beginPath();
                canvas.moveTo(0, ghost.horizontal);
                canvas.lineTo(arenaSize, ghost.horizontal);
                canvas.stroke();
              }, alpha);
            }
            if (ghost.vertical !== null) {
              strokeLine(() => {
                canvas.beginPath();
                canvas.moveTo(ghost.vertical, 0);
                canvas.lineTo(ghost.vertical, arenaSize);
                canvas.stroke();
              }, alpha);
            }
          }
        },
        getTrapperV2State() {
          return {
            horizontal: lines.horizontal,
            vertical: lines.vertical,
            trapActive: Boolean(trap),
            trapRegion: trap && trap.region ? { ...trap.region } : null,
            trapAge: trap ? trap.age : null,
            trapLife: trap ? trap.life : null,
            layCooldownUntil,
            canLay: !trap && layCooldownUntil <= 0
          };
        }
      };
    }
  };

  registerBall(trapperV2Definition);
  return {
    trapperV2Definition,
    createTrapperV2RegionTrap: createRegionTrap,
    TRAPPER_V2_CONSTANTS: Object.freeze({
      trapDuration: TRAP_DURATION,
      trapDamage: TRAP_DAMAGE,
      layCooldown: LAY_COOLDOWN,
      minRegion: MIN_REGION,
      lineColor: LINE_COLOR,
      trapColor: TRAP_COLOR
    })
  };
});
