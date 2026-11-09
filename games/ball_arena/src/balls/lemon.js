(function initializeLemon(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLemonPlugin({ registerBall }) {
  const LEMON_ID = "lemon";
  const DROP_INTERVAL = 1.2;
  const LEMON_RADIUS = 12.5;
  const MAX_LEMONS = 7;
  // 柠檬就掉在脚下、而捡取判定比球体大得多：不给一小段"未成熟"时间，柠檬球
  // 会在下一子步立刻吃掉自己刚放下的柠檬，七个上限与最先消失的规则就永远不会生效。
  const ARM_DELAY = 0.4;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  // 全表普通小球的基础速度都是 150，苹果也是 150。所以"加速至苹果同款速度"只能
  // 指苹果吃到苹果时的那一档：2 倍 / 1 秒。柠檬的加速照抄苹果的 apple-boost ——
  // 同一个效果通道、同样的 2 倍、同样的 1 秒、同样可刷新，只是拖尾换成柠檬黄。
  const LEMON_SPEED = 150;
  const BOOST_FACTOR = 2;
  const BOOST_DURATION = 1;
  const SELF_HEAL = 3;
  const ENEMY_BITE_DAMAGE = 3;
  // 酸性刺激：2 秒减速，期间每秒 3 点伤害（共两跳）。
  const ACID_SLOW_FACTOR = 0.5;
  const ACID_TICK_INTERVAL = 1;
  const ACID_TICK_COUNT = 2;
  const ACID_TICK_DAMAGE = 3;
  const ACID_DURATION = ACID_TICK_INTERVAL * ACID_TICK_COUNT;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  // 游戏默认纯色绘制：本体色 + 描边。描边取本体色的 0.58，与 CanvasRenderer
  // 的 darkenBallColor 一致。
  const LEMON_COLOR = "#F4EA42";
  const LEMON_OUTLINE = "#8e8826";
  // —— 掉落柠檬的外观 ——
  // 下面这套几何与配色不是"看着像"画出来的，是按参考图逐像素量出来的：
  // 参考图 519x519 里果实实体（黄 + 橘）占 x 189..366 / y 194..356，整簇（含叶、
  // 果柄）占 x 151..367 / y 176..356。取色：#fcc219 果身、#f8932b 底部橘层、
  // #94a61e 叶面亮部、#75803e 叶面暗部与果柄、#ffebca 高光。
  // 这里把果实实体宽度映射成 23 个世界单位（命中半径仍是 12.5），叶片与果柄就会
  // 像参考图那样探出果身之外。
  const REF_CENTER_X = 277.5;
  const REF_CENTER_Y = 275;
  const REF_UNIT_SCALE = 23 / 178;
  const LEMON_BODY = "#fcc219";
  const LEMON_SHADE = "#f8932b";
  const LEMON_LEAF = "#94a61e";
  const LEMON_LEAF_DARK = "#75803e";
  const LEMON_HIGHLIGHT = "#ffebca";
  // 参考图像素坐标 → 以果实实体中心为原点的世界坐标
  function refX(pixel) {
    return (pixel - REF_CENTER_X) * REF_UNIT_SCALE;
  }
  function refY(pixel) {
    return (pixel - REF_CENTER_Y) * REF_UNIT_SCALE;
  }
  const SELF_BURST_COLORS = ["#fff9b0", "#f4ea42", "#ffffff"];
  const ENEMY_BURST_COLORS = ["#f4ea42", "#c8d13f", "#f6ffd2"];

  const RUSH_EFFECT_ID = "lemon-citrus-rush";
  // 与苹果 apple-boost 完全同一档的拖尾参数：命中后 2 倍速期间一直拖尾。
  const RUSH_TRAIL_ALPHA = 0.4;
  const RUSH_TRAIL_SAMPLE_LIFE = 1 / 6;

  function createAcidStingEffect() {
    return {
      id: "lemon-acid-sting",
      duration: ACID_DURATION,
      // 减速只允许通过效果因子表达，由引擎统一合成，免疫者自动忽略。
      speedFactor: ACID_SLOW_FACTOR,
      onApply({ effect, game }) {
        effect.startedAt = game.time;
        effect.nextDamageAt = game.time + ACID_TICK_INTERVAL;
        effect.ticksRemaining = ACID_TICK_COUNT;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          effect.ticksRemaining > 0 &&
          game.time + EPSILON >= effect.nextDamageAt &&
          ball.hp > 0
        ) {
          effectServices.dealDamage(ball, ACID_TICK_DAMAGE);
          effect.nextDamageAt += ACID_TICK_INTERVAL;
          effect.ticksRemaining -= 1;
        }
        // 跳完就收：减速与"每秒扣血"同时结束。
        if (effect.ticksRemaining === 0) effect.expiresAt = game.time;
      },
      draw({ ball, effect, game }, context) {
        const frame = Math.floor((game.time - effect.startedAt) * 12);
        context.save();
        context.fillStyle = "#f2e35a";
        context.globalAlpha *= 0.8;
        for (let index = 0; index < 4; index += 1) {
          const angle = index * Math.PI / 2 + frame * 0.22;
          const distance = ball.radius + 4 + ((frame + index) % 3);
          context.fillRect(
            Math.round(ball.x + Math.cos(angle) * distance),
            Math.round(ball.y + Math.sin(angle) * distance),
            2,
            2
          );
        }
        context.restore();
      }
    };
  }

  // 速度门控：只有真的超过自身基础速度时才看得见残影。被减速到 150 以下的球
  // （中酸蚀、踩蛛网）不会挂着一串与事实不符的尾迹。
  function syncRushTrail(ball, effect) {
    if (!effect.trail || effect.trail.finished) {
      // 与苹果一样把拖尾挂在吃到柠檬的球身上：owner-bound 让本体倒下时残影
      // 立刻跟着消失，而不是留在场上走完自己的寿命。
      effect.trail = ball.services.spawnAfterimageTrail({
        kind: "lemon-speed-trail",
        color: LEMON_COLOR,
        maxAlpha: RUSH_TRAIL_ALPHA,
        sampleLife: RUSH_TRAIL_SAMPLE_LIFE,
        speedFloor: Math.max(1, ball.speed),
        speedRamp: 10
      }, { lifecycle: "owner-bound" });
    }
    effect.trail.emit(ball.x, ball.y, ball.radius, {
      heading: Math.atan2(ball.vy, ball.vx),
      speed: Math.hypot(ball.vx, ball.vy)
    });
  }

  // 苹果 apple-boost 的同一套写法：速度走效果通道的 speedFactor（2 倍），持续
  // 1 秒，期间持续喂共享残影拖尾，到期软收尾。重复吃到柠檬按引擎规则刷新时长。
  function createCitrusRushEffect() {
    return {
      id: RUSH_EFFECT_ID,
      duration: BOOST_DURATION,
      speedFactor: BOOST_FACTOR,
      onApply({ ball, effect }) {
        syncRushTrail(ball, effect);
      },
      update({ ball, effect }) {
        syncRushTrail(ball, effect);
      },
      onExpire({ effect }) {
        if (effect.trail) effect.trail.end(false);
      }
    };
  }

  function spawnBiteBurst(lemonServices, x, y, kind, colors, options) {
    lemonServices.spawnParticleBurst({
      kind,
      x,
      y,
      colors,
      density: 0.6,
      ...options
    });
  }

  function touchesLemon(effect, target) {
    return Boolean(
      target && target.hp > 0 &&
      Math.hypot(target.x - effect.x, target.y - effect.y) <=
        target.radius + LEMON_RADIUS + EPSILON
    );
  }

  // "场上已经七个柠檬"指的是整场，而不是每一颗柠檬球各自计数：多人队、大混战和
  // 莉音借用都会同时存在多个投放者，上限必须落在场上的柠檬总数上。实体列表里只
  // 有还活着的柠檬，最早的年龄最大。
  function oldestLiveLemon(game) {
    const entities = game.combatEntities;
    let oldest = null;
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.kind !== "lemon-pickup" || entity.entityActive === false) continue;
      if (!oldest || entity.age > oldest.age) oldest = entity;
    }
    return oldest;
  }

  function liveLemonCount(game) {
    let count = 0;
    const entities = game.combatEntities;
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.kind === "lemon-pickup" && entity.entityActive !== false) count += 1;
    }
    return count;
  }

  // 投放者自己吃才回血加速。回血是显式治疗，直接加 hp；加速走吃到者自己的
  // services 挂上苹果那一档的加速效果——applyEffect 只放行"自身效果与敌方效果"，
  // 用实体或旁观者的服务对象挂己方增益会被直接丢掉。
  function eatAsOwner(effect, owner, lemonServices) {
    if (!owner || !owner.services || !touchesLemon(effect, owner)) return false;
    effect.entityActive = false;
    owner.hp += SELF_HEAL;
    lemonServices.spawnHitText(owner, `+${SELF_HEAL}`, { color: "#fff59a" });
    owner.services.applyEffect(owner, createCitrusRushEffect());
    spawnBiteBurst(lemonServices, effect.x, effect.y, "lemon-owner-bite", SELF_BURST_COLORS, {
      minDiameter: 1.5,
      maxDiameter: 4,
      minSpeed: 20,
      maxSpeed: 60,
      initialRadius: 2,
      life: 0.55
    });
    return true;
  }

  function eatAsEnemy(effect, target, lemonServices) {
    if (!touchesLemon(effect, target)) return false;
    effect.entityActive = false;
    lemonServices.dealDamage(target, ENEMY_BITE_DAMAGE);
    if (target.hp > 0) lemonServices.applyEffect(target, createAcidStingEffect());
    spawnBiteBurst(lemonServices, effect.x, effect.y, "lemon-enemy-bite", ENEMY_BURST_COLORS, {
      minDiameter: 3,
      maxDiameter: 6,
      minSpeed: 10,
      maxSpeed: 30,
      initialRadius: 3,
      life: 0.7
    });
    return true;
  }

  function createLemon(x, y) {
    return {
      kind: "lemon-pickup",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      radius: LEMON_RADIUS,
      x,
      y,
      update({ effect, services: lemonServices }) {
        if (effect.entityActive === false) return;
        // 未成熟期间谁也不能吃，柠檬球才能把它留在身后。
        if (effect.age + EPSILON < ARM_DELAY) return;
        if (eatAsOwner(
          effect,
          lemonServices.getBall(effect.ownerInstanceId),
          lemonServices
        )) return;
        let consumed = false;
        lemonServices.forEachEnemy((target) => {
          if (consumed) return;
          consumed = eatAsEnemy(effect, target, lemonServices);
        });
      },
      draw({ effect }, context) {
        drawLemon(effect, context);
      }
    };
  }

  // —— 掉落柠檬的外观：轮廓直接来自参考图的像素 ——
  // 下面四组点不是"照着画"的近似值，是把参考图逐像素扫描出来的轮廓，按弧长均匀
  // 重采样后的像素坐标：整簇剪影（果身 + 橘层）14 点、橘色月牙 16 点、叶片 10 点、
  // 叶面暗部 10 点；果柄是从 (178,179) 到 (192,204)、宽约 13px 的粗短柄。
  // 运行时由 traceSmoothPath 用 Catmull-Rom 转成平滑闭合路径，再经 refX/refY 换成
  // 世界单位，所以果形、叶形、橘色月牙的位置都跟参考图一致。
  // 果身是参考图里纯黄色的那一层（y 195..341），橘色月牙才能从它下面露出来。
  const REF_BODY_OUTLINE = [
    [265, 195], [303.5, 203.2], [335.8, 224.8], [354, 256.7], [360, 293.7],
    [364, 330.6], [330.5, 339.9], [291, 339.1], [253.5, 327.8], [221.5, 305.5],
    [199.3, 275.3], [192, 238.9], [206, 213.6], [225.7, 197]
  ];
  // 橘色月牙：外缘取整簇剪影（y 195..355）的左下/底缘，内缘取黄色果身在同一段弧上的
  // 边界；(194,264) 是它开始露出的那一行，(359,340) 是它与果身底缘汇合的地方。
  const REF_ORANGE_OUTLINE = [
    [194, 264], [198, 288.9], [209, 310.9], [226, 330], [247, 345.5], [272.2, 353.5],
    [298.7, 355], [324.8, 351], [351.1, 348.9], [344.8, 341], [318.4, 339.6],
    [291.8, 339.1], [266.2, 333.1], [242.4, 321.7], [221.6, 305.6], [205, 286]
  ];
  // 叶片：整片用暗色起形，再把外侧（左侧）的亮面盖上去，和参考图一样是折光的两块。
  const REF_LEAF_BLADE_OUTLINE = [
    [204, 214], [187, 225], [191, 247.2], [193, 272.3], [199, 296.5], [191, 318.3],
    [176, 328.9], [162.7, 307.7], [153, 285], [154, 259.5], [164, 236.9], [178.8, 216.2]
  ];
  const REF_LEAF_LIGHT_OUTLINE = [
    [186, 214], [175.4, 236.6], [172, 262], [172.7, 288.7], [175.5, 314.5],
    [172, 322.7], [159, 301.2], [152, 277.2], [156.1, 251.9], [168, 230]
  ];
  const REF_STEM = { fromX: 178, fromY: 179, toX: 192, toY: 204, width: 13 };
  // 高光：参考图实测中心 (270,224)、长半轴约 32px、短半轴约 14.5px、右倾约 0.4rad
  const REF_HIGHLIGHT = { x: 270, y: 224, radiusX: 32, radiusY: 14.5, rotation: 0.4 };

  // 参考图像素点集 → 闭合平滑路径（Catmull-Rom 转三次贝塞尔）
  function traceSmoothPath(context, points) {
    const count = points.length;
    context.beginPath();
    context.moveTo(refX(points[0][0]), refY(points[0][1]));
    for (let index = 0; index < count; index += 1) {
      const previous = points[(index - 1 + count) % count];
      const current = points[index];
      const next = points[(index + 1) % count];
      const after = points[(index + 2) % count];
      context.bezierCurveTo(
        refX(current[0] + (next[0] - previous[0]) / 6),
        refY(current[1] + (next[1] - previous[1]) / 6),
        refX(next[0] - (after[0] - current[0]) / 6),
        refY(next[1] - (after[1] - current[1]) / 6),
        refX(next[0]),
        refY(next[1])
      );
    }
    context.closePath();
  }

  function drawLemonStem(context) {
    const stem = REF_STEM;
    context.strokeStyle = LEMON_LEAF_DARK;
    context.lineWidth = stem.width * REF_UNIT_SCALE;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(refX(stem.fromX), refY(stem.fromY));
    context.lineTo(refX(stem.toX), refY(stem.toY));
    context.stroke();
  }

  // 层序与参考图一致：叶片（亮面 + 暗面）→ 果柄 → 橘色月牙 → 果身 → 高光。
  // 参考图本身没有描边，所以这里也不描边。
  function drawLemon(effect, context) {
    // 成熟动画：0.4 秒内从 62% 弹到原大、透明度同步拉满，落地的那一颗看得清。
    const armProgress = ARM_DELAY > 0
      ? Math.min(1, Math.max(0, effect.age) / ARM_DELAY)
      : 1;
    const grow = 0.62 + 0.38 * armProgress;
    context.save();
    context.globalAlpha *= 0.72 + 0.28 * armProgress;
    context.translate(effect.x, effect.y);
    context.scale(grow, grow);
    traceSmoothPath(context, REF_LEAF_BLADE_OUTLINE);
    context.fillStyle = LEMON_LEAF_DARK;
    context.fill();
    traceSmoothPath(context, REF_LEAF_LIGHT_OUTLINE);
    context.fillStyle = LEMON_LEAF;
    context.fill();
    drawLemonStem(context);
    traceSmoothPath(context, REF_ORANGE_OUTLINE);
    context.fillStyle = LEMON_SHADE;
    context.fill();
    traceSmoothPath(context, REF_BODY_OUTLINE);
    context.fillStyle = LEMON_BODY;
    context.fill();
    context.fillStyle = LEMON_HIGHLIGHT;
    context.beginPath();
    context.ellipse(
      refX(REF_HIGHLIGHT.x),
      refY(REF_HIGHLIGHT.y),
      REF_HIGHLIGHT.radiusX * REF_UNIT_SCALE,
      REF_HIGHLIGHT.radiusY * REF_UNIT_SCALE,
      REF_HIGHLIGHT.rotation,
      0,
      TWO_PI
    );
    context.fill();
    context.restore();
  }

  const lemonDefinition = {
    id: LEMON_ID,
    name: "\u67e0\u6aac",
    englishName: "Lemon",
    color: LEMON_COLOR,
    description: "\u6bcf1\u79d2\u811a\u4e0b\u751f\u6210\u67e0\u6aac\u6700\u591a7\u4e2a / \u654c\u65b9\u5403-3\u5e76\u9178\u8680\u51cf\u901f2\u79d2\u6bcf\u79d2-3 / \u81ea\u8eab\u5403+3\u52a0\u901f2\u500d1\u79d2\uff08\u82f9\u679c\u540c\u6b3e\uff09",
    stats: {
      radius: 15,
      speed: LEMON_SPEED,
      maxHp: 100
    },
    rionCycleDuration: DROP_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      const lemons = [];
      return {
        update(_context, dt) {
          timer = Math.min(DROP_INTERVAL, timer + Math.max(0, dt));
          for (let index = lemons.length - 1; index >= 0; index -= 1) {
            if (lemons[index].entityActive === false) lemons.splice(index, 1);
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, DROP_INTERVAL - timer);
        },
        afterUpdateStep(context) {
          if (timer + EPSILON < DROP_INTERVAL) return;
          timer = 0;
          // 场上最多七个：满了就先撤掉最早生成的那个。
          while (liveLemonCount(context.game) >= MAX_LEMONS) {
            const oldest = oldestLiveLemon(context.game);
            if (!oldest) break;
            oldest.entityActive = false;
          }
          const ball = context.ball;
          lemons.push(services.spawnCombatEntity(createLemon(ball.x, ball.y)));
        },
        getLemonState() {
          return {
            timer,
            lemons: lemons.filter((lemon) => lemon.entityActive !== false)
          };
        }
      };
    }
  };

  registerBall(lemonDefinition);
  return { lemonDefinition, createLemon };
});