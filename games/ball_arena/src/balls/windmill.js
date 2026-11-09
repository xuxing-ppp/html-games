(function initializeWindmill(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createWindmillPlugin({ registerBall }) {
  // 风车：每 2 秒在**自己当时站的位置**放一架荷兰风车，风车留在原地自己转，
  // 不会跟着本体走。参数按需求固定：
  //   整机直径 70 / 自转 1 圈每秒 / 每片帆扫过 3 点伤害 / 寿命 5.3 秒。
  // 出伤节奏挂在帆上：一圈 4 片、每秒 1 圈 → 同一个目标每 1/4 秒最多挨一下，
  // 自转速度因此是真的在决定伤害频率，而不只是动画。
  // 伤害范围也挂在帆上：判定圆是帆扫过的那一圈（圆心在顶盖的轴上、半径 22），
  // 塔身只是机身——站在塔基旁边既不吃伤害也不挡路。
  // （站着不动硬吃满，是 4 × 3 = 12 dps。）
  const SPAWN_INTERVAL = 2;
  const BLADE_COUNT = 4;
  const WINDMILL_DIAMETER = 70;
  const WINDMILL_RADIUS = WINDMILL_DIAMETER / 2;
  const ROTATION_RPS = 1;
  const TURN_SPEED = Math.PI * 2 * ROTATION_RPS;
  // 单片叶子扫过同一个点的时间：一圈 4 片 × 每秒 1 圈。
  const BLADE_INTERVAL = 1 / (BLADE_COUNT * ROTATION_RPS);
  const CONTACT_DAMAGE = 3;
  const WINDMILL_LIFE = 5.3;
  // 渐隐只占寿命的最后 0.4 秒：满 5.3 秒由 EntitySystem 整体收走，
  // 不会在寿命之外再拖一条尾巴。渐隐只是画面淡出——风车没有消失，只是正在淡出，
  // 所以这 0.4 秒里它照旧在原地转、照旧出伤（和梓/冰川那种"融化即停手"的轨迹不同）。
  // 出伤窗 = 完整寿命 5.3 秒，和需求里的「寿命 5.3 秒 + 3 点接触伤害」对齐。
  const FADE_DURATION = 0.4;
  // 一架荷兰风车仍然只用一块基色，深浅档全部由它派生（和冰川同一种做法）：
  // 塔身用基色、帆布往白里拉、顶盖/腰线往黑里压，门窗和帆骨用渲染器
  // drawBallOutline 同一条「每通道 ×0.58」规则算出来的深色。全是平涂，没有渐变。
  const WINDMILL_COLOR = "#c0399f";
  const TOWER_COLOR = WINDMILL_COLOR;
  const SAIL_COLOR = mixHexWithWhite(WINDMILL_COLOR, 0.62);
  const TRIM_COLOR = mixHexWithWhite(WINDMILL_COLOR, -0.34);
  const WOOD_COLOR = darkenColor(WINDMILL_COLOR);
  const BLADE_EDGE_WIDTH = 1;
  // 正视图几何（局部坐标，y 向下，整机必须待在半径 35 的判定盘里）：
  //   塔身 从 y=-4 的窄顶收到 y=32 的宽基座，腰线是下段的一道深色带，
  //   顶盖压在塔身顶上，四片风帆的轴装在顶盖前，转到哪儿叶子就在哪儿。
  const TOWER_TOP_Y = -6;
  const TOWER_TOP_HALF_WIDTH = 6.5;
  const TOWER_BOTTOM_Y = 32.5;
  const TOWER_BOTTOM_HALF_WIDTH = 10.5;
  const GALLERY_TOP_Y = 10;
  const GALLERY_HALF_WIDTH = 10.5;
  const GALLERY_HEIGHT = 3.6;
  // 拱门：门洞从基座往上，顶上是半圆。
  const DOOR_SPRING_Y = 25.5;
  const DOOR_HALF_WIDTH = 3.2;
  // 窗开在腰线以下的塔基段：上面那半截会被风帆盖住，看不见。
  const WINDOW_Y = 17.5;
  const WINDOW_HALF_WIDTH = 2;
  const CAP_BOTTOM_Y = -6;
  const CAP_BOTTOM_HALF_WIDTH = 7.8;
  const CAP_TOP_Y = -18;
  const CAP_TOP_HALF_WIDTH = 4.2;
  // 风帆：轴心装在顶盖上，四片帆转起来顶到整机轮廓的边缘，
  // 塔身只从下面探出来，就是荷兰风车那种「大帆小塔」的剪影。
  const SAIL_HUB_Y = -12;
  const SAIL_LENGTH = 21.6;
  const SAIL_ROOT_HALF_WIDTH = 2.2;
  const SAIL_TIP_HALF_WIDTH = 3.6;
  // 危险范围就是帆扫过的那一圈：圆心在轴心（机身往上 12），半径 22。
  // 塔身只是机身——站在塔基旁边既不吃伤害也不挡路；帆的每一个角
  // （离轴最远 hypot(21.6, 3.6) = 21.9）都在这 22 里面，判定圈不会比画出来的帆大。
  const SAIL_SWEEP_RADIUS = 22;
  const SAIL_HUB_RADIUS = 3.4;
  const SAIL_SLAT_COUNT = 2;
  const SPARK_COLORS = Object.freeze([WINDMILL_COLOR, "#ffffff"]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function darkenColor(hex) {
    const channels = [1, 3, 5].map((offset) => (
      Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * 0.58)
    ));
    return `rgb(${channels.join(", ")})`;
  }

  // 把一个 #rrggbb 往白（amount > 0）或往黑（amount < 0）方向拉，得到同色系的深浅档。
  function mixHexWithWhite(hex, amount) {
    const value = clamp(amount, -1, 1);
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const mixed = value >= 0 ? channel + (1 - channel) * value : channel * (1 + value);
      return Math.round(mixed * 255).toString(16).padStart(2, "0");
    });
    return "#" + channels.join("");
  }

  // 一笔平涂 + 一圈深色描边：整个风车所有部件都走这一条。
  function paintPolygon(context, points, fill) {
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    context.closePath();
    context.fillStyle = fill;
    context.fill();
    context.stroke();
  }

  function paintRectangle(context, centerX, centerY, halfWidth, halfHeight, fill) {
    paintPolygon(context, [
      [centerX - halfWidth, centerY - halfHeight],
      [centerX + halfWidth, centerY - halfHeight],
      [centerX + halfWidth, centerY + halfHeight],
      [centerX - halfWidth, centerY + halfHeight]
    ], fill);
  }

  // 拱门：直墙到 DOOR_SPRING_Y，上面收成一个半圆。
  function paintDoor(context) {
    context.beginPath();
    context.moveTo(-DOOR_HALF_WIDTH, TOWER_BOTTOM_Y);
    context.lineTo(-DOOR_HALF_WIDTH, DOOR_SPRING_Y);
    context.arc(0, DOOR_SPRING_Y, DOOR_HALF_WIDTH, Math.PI, 0);
    context.lineTo(DOOR_HALF_WIDTH, TOWER_BOTTOM_Y);
    context.closePath();
    context.fillStyle = WOOD_COLOR;
    context.fill();
    context.stroke();
  }

  // 塔身：正视图里一定是个下宽上窄的梯形。
  function towerHalfWidthAt(y) {
    const progress = clamp(
      (y - TOWER_TOP_Y) / (TOWER_BOTTOM_Y - TOWER_TOP_Y),
      0,
      1
    );
    return TOWER_TOP_HALF_WIDTH +
      (TOWER_BOTTOM_HALF_WIDTH - TOWER_TOP_HALF_WIDTH) * progress;
  }

  function drawMillBody(context) {
    // 顶盖（先画，塔身压住它的下沿）
    paintPolygon(context, [
      [-CAP_BOTTOM_HALF_WIDTH, CAP_BOTTOM_Y],
      [CAP_BOTTOM_HALF_WIDTH, CAP_BOTTOM_Y],
      [CAP_TOP_HALF_WIDTH, CAP_TOP_Y],
      [-CAP_TOP_HALF_WIDTH, CAP_TOP_Y]
    ], TRIM_COLOR);
    // 塔身
    paintPolygon(context, [
      [-TOWER_TOP_HALF_WIDTH, TOWER_TOP_Y],
      [TOWER_TOP_HALF_WIDTH, TOWER_TOP_Y],
      [TOWER_BOTTOM_HALF_WIDTH, TOWER_BOTTOM_Y],
      [-TOWER_BOTTOM_HALF_WIDTH, TOWER_BOTTOM_Y]
    ], TOWER_COLOR);
    // 腰线：荷兰风车中段那圈外挑的平台
    paintRectangle(
      context,
      0,
      GALLERY_TOP_Y + GALLERY_HEIGHT / 2,
      GALLERY_HALF_WIDTH,
      GALLERY_HEIGHT / 2,
      TRIM_COLOR
    );
    // 门和两扇窗：深色平涂，给塔身一点人味
    paintDoor(context);
    for (const side of [-1, 1]) {
      paintRectangle(
        context,
        side * (towerHalfWidthAt(WINDOW_Y) - WINDOW_HALF_WIDTH - 1.4),
        WINDOW_Y,
        WINDOW_HALF_WIDTH,
        WINDOW_HALF_WIDTH,
        WOOD_COLOR
      );
    }
  }

  // 四片风帆：帆布是一块平涂的梯形，帆骨和横档用深色细线勾出来（不填第二块颜色）。
  function drawSails(context, bladeAngle) {
    context.save();
    context.translate(0, SAIL_HUB_Y);
    context.rotate(bladeAngle);
    for (let index = 0; index < BLADE_COUNT; index += 1) {
      context.save();
      context.rotate(index * TWO_PI / BLADE_COUNT);
      paintPolygon(context, [
        [0, -SAIL_ROOT_HALF_WIDTH],
        [SAIL_LENGTH, -SAIL_TIP_HALF_WIDTH],
        [SAIL_LENGTH, SAIL_TIP_HALF_WIDTH],
        [0, SAIL_ROOT_HALF_WIDTH]
      ], SAIL_COLOR);
      context.strokeStyle = WOOD_COLOR;
      context.lineWidth = 0.9;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(SAIL_LENGTH, 0);
      for (let slat = 1; slat <= SAIL_SLAT_COUNT; slat += 1) {
        const progress = slat / (SAIL_SLAT_COUNT + 1);
        const x = SAIL_LENGTH * progress;
        const half = SAIL_ROOT_HALF_WIDTH +
          (SAIL_TIP_HALF_WIDTH - SAIL_ROOT_HALF_WIDTH) * progress;
        context.moveTo(x, -half);
        context.lineTo(x, half);
      }
      context.stroke();
      context.restore();
    }
    context.fillStyle = WOOD_COLOR;
    context.strokeStyle = WOOD_COLOR;
    context.lineWidth = BLADE_EDGE_WIDTH;
    context.beginPath();
    context.arc(0, 0, SAIL_HUB_RADIUS, 0, TWO_PI);
    context.fill();
    context.stroke();
    context.restore();
  }

  // 四叶风车：一个原地自转的 zone。bladeAngle 从 0 开始，所有风车同相，
  // 每个 substep 只推一次角度、结算一次「这一瞬间有没有人被叶子扫到」。
  function createWindmill(x, y) {
    return {
      kind: "windmill-blade",
      combatKind: "zone",
      // 独立实体：本体死了、或者 Rion 借来的这一轮结束了，已经放下的风车
      // 照常转完自己那 5.3 秒。
      lifecycle: "independent",
      // 画在球体下面：风车是留在地上的机关，不该盖住从它身上滚过去的球。
      drawLayer: "background",
      life: WINDMILL_LIFE,
      x,
      y,
      // 判定半径 = 帆扫过的圆；整机占地（直径 70）另记在 footprintRadius 上，
      // 只用来描述画多大，不参与出伤。
      radius: SAIL_SWEEP_RADIUS,
      footprintRadius: WINDMILL_RADIUS,
      bladeAngle: 0,
      alpha: 1,
      // instanceId → 下一次可以挨打的时间。只保留还在冷却里的条目（见 update 尾部）。
      hitGates: new Map(),
      update({ entity, game, services: windmillServices }, dt) {
        const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
        entity.bladeAngle = (entity.bladeAngle + TURN_SPEED * elapsed) % TWO_PI;
        // 寿命最后一段线性渐隐；age 由 EntitySystem 在 update 之后推进，
        // 所以这里读到的是本 substep 开始时的年龄。
        entity.alpha = clamp((entity.life - entity.age) / FADE_DURATION, 0, 1);

        const now = game.time;
        // 判定圆心是风帆的轴，不是机身中心：危险的是转起来的帆，不是塔。
        const sweepX = entity.x;
        const sweepY = entity.y + SAIL_HUB_Y;
        windmillServices.forEachEnemy((target) => {
          if (!target || target.hp <= 0) return;
          // 帆扫过的圆 + 目标半径 = 一架风车真正的危险范围。
          if (
            Math.hypot(target.x - sweepX, target.y - sweepY) >
            entity.radius + target.radius
          ) return;
          const profile = windmillServices.getContactProfile(target);
          if (!profile.solid || !profile.attackable) return;
          const gate = entity.hitGates.get(target.instanceId);
          if (gate !== undefined && now + EPSILON < gate) return;
          if (!windmillServices.dealDamage(target, CONTACT_DAMAGE)) return;
          entity.hitGates.set(target.instanceId, now + BLADE_INTERVAL);
          windmillServices.spawnParticleBurst({
            kind: "windmill-hit",
            x: target.x,
            y: target.y,
            count: 8,
            minDiameter: 1,
            maxDiameter: 3.2,
            minSpeed: 40,
            maxSpeed: 130,
            initialRadius: 2,
            life: 0.3,
            colors: SPARK_COLORS
          });
        });

        // 冷却已经过去的记录没有再留着的意义：这张表最多只装
        // 「这一刻还在冷却里的目标」，不会跟着 5.3 秒一直涨。
        for (const [key, gate] of entity.hitGates) {
          if (now + EPSILON >= gate) entity.hitGates.delete(key);
        }
      },
      // 纯色绘制：塔身、顶盖、腰线、门窗、帆布全是平涂 + 一圈 1px 深色描边，
      // 深浅档由一个基色派生，和游戏默认球体（drawSmoothBall + drawBallOutline）
      // 是同一套画法——只是把这套画法用在一架正视图的荷兰风车上。
      draw({ entity }, context) {
        const alpha = context.globalAlpha * entity.alpha;
        if (alpha <= 0) return;
        context.save();
        context.translate(entity.x, entity.y);
        context.globalAlpha = alpha;
        context.strokeStyle = WOOD_COLOR;
        context.lineWidth = BLADE_EDGE_WIDTH;
        context.lineJoin = "round";
        drawMillBody(context);
        // 帆装在顶盖前、压住塔身：先塔后帆，才看得出帆在转
        drawSails(context, entity.bladeAngle);
        context.restore();
      }
    };
  }

  const windmillDefinition = {
    id: "windmill",
    name: "风车",
    englishName: "Windmill",
    color: WINDMILL_COLOR,
    description: "每2秒原地放一架荷兰风车 / 帆叶扫过3点 自转1圈每秒 / 整机直径70 存活5.3秒渐隐",
    // 普通球：一架风车对站在叶盘里的人是 4 × 3 = 12 dps，站在原地硬吃满也要 8 秒以上
    // 才掉 100 血；1v2 同时打两颗普通球是 2/8、0/8、0/8，够不上精英档。
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: SPAWN_INTERVAL,
    createBehavior(services) {
      // 开局先蓄 2 秒再放第一架；被控时整个节奏冻结（计时只在 update 里推进）。
      let spawnTimer = SPAWN_INTERVAL;

      function placeWindmill(context) {
        const ball = context.ball;
        services.spawnCombatEntity(createWindmill(ball.x, ball.y));
        services.playSound("shoot", { kind: "windmill-blade", radius: WINDMILL_RADIUS });
      }

      return {
        update(context, dt) {
          spawnTimer -= Math.max(0, Number.isFinite(dt) ? dt : 0);
          if (spawnTimer > EPSILON) return;
          spawnTimer = SPAWN_INTERVAL;
          placeWindmill(context);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, spawnTimer);
        }
        // 本体不实现 drawBody：需求是纯色，交给渲染器的 drawSmoothBall
        //（一次 #c0399f 平涂 + 全体共用的深色描边）。
      };
    }
  };

  registerBall(windmillDefinition);

  return {
    windmillDefinition,
    createWindmill,
    WINDMILL_CONSTANTS: Object.freeze({
      SPAWN_INTERVAL,
      BLADE_COUNT,
      WINDMILL_DIAMETER,
      WINDMILL_RADIUS,
      ROTATION_RPS,
      TURN_SPEED,
      BLADE_INTERVAL,
      CONTACT_DAMAGE,
      WINDMILL_LIFE,
      FADE_DURATION,
      SAIL_HUB_Y,
      SAIL_LENGTH,
      SAIL_HUB_RADIUS,
      SAIL_ROOT_HALF_WIDTH,
      SAIL_TIP_HALF_WIDTH,
      SAIL_SWEEP_RADIUS,
      TOWER_TOP_Y,
      TOWER_BOTTOM_Y,
      TOWER_BOTTOM_HALF_WIDTH,
      TOWER_TOP_HALF_WIDTH,
      GALLERY_TOP_Y,
      WINDOW_Y,
      WINDMILL_COLOR,
      TOWER_COLOR,
      SAIL_COLOR,
      TRIM_COLOR,
      WOOD_COLOR
    })
  };
});
