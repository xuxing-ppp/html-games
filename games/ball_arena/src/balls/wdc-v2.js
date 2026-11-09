(function initializeWdcV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createWdcV2Plugin({ resolveArenaGeometry, registerBall }) {
  const NUMBER_MIN = 0;
  const NUMBER_MAX = 20;

  const DOMAIN_BACKDROP = "rgba(10, 56, 72, 0.4)";
  const DOMAIN_NUMBER_COLOR = "rgba(224, 246, 255, 0.78)";
  const ROLL_FLASH_COLOR = "rgba(240, 253, 255, 0.95)";
  const NUMBER_FONT_RATIO = 0.36;
  const POP_TIME = 0.28;
  const WALL_POINT_MARGIN = 12;
  const EPSILON = 1e-9;

  function randomInteger(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  const wdcV2Definition = {
    id: "wdcV2",
    name: "WDCV2",
    englishName: "WDC V2",
    color: "#1a9bba",
    description: "全场常开单格数字领域 / 触墙刷新0-20碰撞伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let domainNumber = randomInteger(NUMBER_MIN, NUMBER_MAX);
      let lastRollAt = null;

      function rollNumber() {
        domainNumber = randomInteger(NUMBER_MIN, NUMBER_MAX);
      }

      // 触墙点：反弹后球心离墙一个半径，按反弹轴向内收 12 单位保证特效在场内
      function wallContactPoint(context) {
        const { ball, game } = context;
        if (context.wallContacts && context.wallContacts.length) { const c = context.wallContacts[0];
          return resolveArenaGeometry(game).clampPoint(c.x + c.normalX * WALL_POINT_MARGIN, c.y + c.normalY * WALL_POINT_MARGIN); }
        return {
          x: context.bouncedX
            ? (ball.x <= ball.radius + EPSILON
              ? WALL_POINT_MARGIN
              : game.arenaSize - WALL_POINT_MARGIN)
            : ball.x,
          y: context.bouncedY
            ? (ball.y <= ball.radius + EPSILON
              ? WALL_POINT_MARGIN
              : game.arenaSize - WALL_POINT_MARGIN)
            : ball.y
        };
      }

      // 让观众看到"数字变了"和"碰到板边"是同一件事：在触墙点用统一粒子
      // 接口炸开海蓝火花与扩散环，同时把新数字弹在最旁边。
      function spawnRollFeedback(context) {
        const point = wallContactPoint(context);
        services.spawnParticleBurst({
          kind: "wdcv2-roll-burst",
          x: point.x,
          y: point.y,
          life: 0.55,
          count: 22,
          minDiameter: 1,
          maxDiameter: 4,
          minSpeed: 40,
          maxSpeed: 110,
          colors: ["#7fd8ea", "#bfeef7", "#ffffff"],
          ring: {
            color: "rgba(127, 216, 234, 0.9)",
            lineWidth: 2,
            startRadius: 6,
            endRadius: 26
          }
        });
        services.spawnVisualEffect({
          kind: "wdcv2-roll-number",
          life: 0.6,
          x: point.x,
          y: point.y,
          arenaSize: context.game.arenaSize,
          text: String(domainNumber),
          update({ effect }, dt) {
            const elapsed = Math.max(0, dt);
            effect.y -= 16 * elapsed;
            effect.x += ((effect.arenaSize / 2) - effect.x) * 0.5 * elapsed;
          },
          draw({ effect }, canvasContext) {
            const progress = Math.min(1, Math.max(0, effect.age / effect.life));
            canvasContext.save();
            canvasContext.globalAlpha *= (1 - progress) * 0.95;
            canvasContext.fillStyle = "#bff0fb";
            canvasContext.font = `700 ${Math.round(24 + 8 * progress)}px 'Ball Impact', Impact, Haettenschweiler, sans-serif`;
            canvasContext.textAlign = "center";
            canvasContext.textBaseline = "middle";
            canvasContext.fillText(effect.text, effect.x, effect.y);
            canvasContext.restore();
          }
        });
      }

      return {
        onWallBounce(context) {
          rollNumber();
          lastRollAt = context.game.time;
          spawnRollFeedback(context);
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          if (domainNumber <= 0) return; // 0 点 = 这次接触不结算，也不弹 "-0"
          context.services.dealDamage(target, domainNumber);
        },
        getWdcV2State() {
          return { active: true, number: domainNumber };
        },
        drawArenaBackground(context, canvasContext) {
          const arenaSize = context.game.arenaSize;
          // 刚掷完的短时间内中央数字放大闪光，强调"换了新数字"
          const sinceRoll = lastRollAt == null
            ? Infinity
            : context.game.time - lastRollAt;
          const pop = sinceRoll < POP_TIME ? 1 - sinceRoll / POP_TIME : 0;
          const scale = 1 + 0.45 * pop * pop;
          canvasContext.save();
          // 全场只有一格：半透明海蓝底加一个居中大数字
          canvasContext.fillStyle = DOMAIN_BACKDROP;
          canvasContext.fillRect(0, 0, arenaSize, arenaSize);
          canvasContext.fillStyle = pop > 0 ? ROLL_FLASH_COLOR : DOMAIN_NUMBER_COLOR;
          canvasContext.font = `700 ${Math.round(arenaSize * NUMBER_FONT_RATIO * scale)}px 'Ball Impact', Impact, Haettenschweiler, sans-serif`;
          canvasContext.textAlign = "center";
          canvasContext.textBaseline = "middle";
          canvasContext.fillText(String(domainNumber), arenaSize / 2, arenaSize / 2);
          canvasContext.restore();
        }
      };
    }
  };

  registerBall(wdcV2Definition);
  return {
    wdcV2Definition,
    WDCV2_NUMBER_MIN: NUMBER_MIN,
    WDCV2_NUMBER_MAX: NUMBER_MAX
  };
});
