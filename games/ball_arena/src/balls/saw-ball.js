(function initializeSawBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("./six-zone-ultra.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSawBallPlugin(dependencies) {
  "use strict";
  const { registerBall, createSixZoneSaw, drawSixZoneSaw, SIX_ZONE_SAW_RULES } = dependencies;

  // 圆锯直接照搬六区球Ultra 的现成实现：尺寸、公转半径、伤害、实体类型、碰撞处理都用它那套，
  // 只把公转速度按需求固定成 1.4 圈/秒（六区球Ultra 是 0.5），并关掉它的冰霜拖尾。
  // 圆锯配色取自参考图：锯面主导色 #b3bcc3、锯缘/轴心暗部 #64696f 附近
  const BLADE_PALETTE = Object.freeze({
    face: "#b3bcc3",
    edge: "#565f66",
    hub: "#64696f",
    ring: "#e8edf1"
  });

  const RULES = Object.freeze({
    // 参考图里量出来：锯片平均半径 ≈13 单位、齿高 ≈2.9、约 16 齿
    bladeRadius: 14.3,
    orbitRadius: SIX_ZONE_SAW_RULES.orbitRadius,
    sawDamage: SIX_ZONE_SAW_RULES.damage,
    orbitRps: 0.6,
    bodyDamage: 1
  });

  const sawBallDefinition = {
    id: "sawBall",
    name: "锯球",
    englishName: "Saw Ball",
    // 本体颜色取自参考图里的绿色（图中主导像素 #38a24d）
    color: "#38a24d",
    description: "两片圆锯公转（固定0.6圈/秒，公转半径40） / 圆锯碰撞5伤害 / 本体碰撞1伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let blades = [];

      function sawOptions() {
        return {
          orbitRps: RULES.orbitRps,
          radius: RULES.bladeRadius,
          teeth: 16,
          toothStyle: "triangle",
          toothHeight: 2.9,
          hubRadius: 2.7,
          highlight: "arc",
          emitTrail: false,
          // 不掉六区球Ultra 的冰玻璃碎屑（那是它自己的冰霜主题）
          spawnGlassShards: false,
          kind: "saw-ball-blade",
          palette: BLADE_PALETTE
        };
      }

      // 位置完全由圆锯实体自己按 owner 计算，所以创建出来就已经挂在身体两侧，
      // 不会停在原点等第一次 update。
      function ensureBlades(ball) {
        if (!ball) return;
        if (blades.length === 2 && blades.every((blade) => blade.entityActive !== false)) return;
        blades = [
          services.spawnCombatEntity(createSixZoneSaw(-1, ball, sawOptions())),
          services.spawnCombatEntity(createSixZoneSaw(1, ball, sawOptions()))
        ];
      }

      function despawnBlades() {
        for (const blade of blades) {
          blade.entityActive = false;
          blade.life = 0;
        }
        if (!services.borrowedAttackOnly) blades = [];
      }

      return {
        getAttackCycleDuration() { return 5; },
        drawBorrowedWeapon(context, canvasContext) {
          const weapons = blades.length ? blades : [
            createSixZoneSaw(-1, context.ball, sawOptions()),
            createSixZoneSaw(1, context.ball, sawOptions())
          ];
          weapons.forEach(blade => drawSixZoneSaw(canvasContext, blade));
        },
        onSpawn(context) {
          ensureBlades(context.ball);
        },
        // 莉音借用不会派发 onSpawn，所以每步都兜一下
        update(context) {
          ensureBlades(context.ball);
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, RULES.bodyDamage);
        },
        onDeath: despawnBlades,
        onBorrowEnd: despawnBlades,
        getSawBallState() {
          return {
            rules: RULES,
            blades: blades.map((blade) => ({
              entityId: blade.instanceId,
              x: blade.x,
              y: blade.y,
              angle: blade.orbitAngle,
              radius: blade.radius
            }))
          };
        }
      };
    }
  };

  registerBall(sawBallDefinition);
  return { sawBallDefinition, SAW_BALL_RULES: RULES, SAW_BALL_PALETTE: BLADE_PALETTE };
});
