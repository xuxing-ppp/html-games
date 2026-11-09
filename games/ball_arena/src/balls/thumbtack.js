(function initializeThumbtack(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createThumbtackPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;
  // 射速从 0.5 颗/秒（= 2 秒一颗）起步，每秒 +0.02 颗，封顶 2 颗/秒（= 0.5 秒一颗）。
  // 0.5 → 2 需要 75 秒，之后固定 0.5 秒一发。
  const FIRE_FREQUENCY_START = 0.5;
  const FIRE_FREQUENCY_ACCEL = 0.02;
  const FIRE_FREQUENCY_MAX = 2;
  const FIRE_INTERVAL = 1 / FIRE_FREQUENCY_START;
  const TACK_SPEED = 150;
  // 匀减速 200：初速 150 会在 0.75 秒里走完 56.25 个单位后停住。
  const TACK_DECEL = 200;
  // 有效直径 3：接触/伤害判定半径 1.5。外观是稍大一圈的"T"，只有针尖探出判定圆。
  const TACK_DIAMETER = 3;
  const TACK_RADIUS = TACK_DIAMETER / 2;
  const TACK_DAMAGE = 1;
  // 钉子不回收：飞停之后一直留在场上，直到这场战斗结束由引擎统一清理。
  const TACK_LIFE = 999;
  // 一帧内最多处理的墙面反弹次数：正常步长（1/60）下最多一次，大步长推演时兜底。
  const MAX_BOUNCES_PER_STEP = 8;
  const TACK_HEAD_COLOR = "#8d949c";
  // 外观是一座"T"：横过来的钉帽当横杠（垂直于航向），针杆沿航向收成尖。
  // 横杠半宽 1.45、针杆伸到 +2.02，整体落在判定圆（半径 1.5）附近，只有针尖探出一点。
  const BAR_CENTER_X = -0.88;
  const BAR_HALF_THICKNESS = 0.44;
  const BAR_HALF_LENGTH = 1.45;
  const BAR_CORNER_RADIUS = 0.42;
  const SHAFT_ROOT_X = -0.9;
  const SHAFT_ROOT_HALF_WIDTH = 0.36;
  const SHAFT_SHOULDER_X = 1.36;
  const SHAFT_SHOULDER_HALF_WIDTH = 0.15;
  const SHAFT_TIP_X = 2.08;
  const OUTLINE_COLOR = "#2f353c";
  const BAR_LIGHT_COLOR = "#ccd3d9";
  const BAR_MID_COLOR = "#9aa2aa";
  const SHAFT_LIGHT_COLOR = "#c6cdd4";
  const SHAFT_DARK_COLOR = "#5d646c";
  const TIP_COLOR = "#e9eff4";
  const HIGHLIGHT_COLOR = "rgba(244,249,253,0.55)";
  const SHAFT_RIDGE_SHADOW_COLOR = "rgba(22,26,31,0.42)";
  const BAR_SHADOW_COLOR = "rgba(22,26,31,0.5)";
  const SOCKET_SHADOW_COLOR = "rgba(18,21,25,0.45)";

  // 到最近一面墙还要走多远（按当前航向）。航向分量几乎为 0 的那条轴不参与。
  function distanceToWall(tack, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const distance = arena.movementLimit(tack.x, tack.y, tack.directionX, tack.directionY, arena.size * 2, tack.radius);
    const hit = arena.traceSegment(tack.x, tack.y, tack.x + tack.directionX * (distance + 1), tack.y + tack.directionY * (distance + 1), tack.radius);
    return hit ? { ...hit, distance } : null;
  }

  // 匀减速下走完 distance 需要的时间（取较小根）；停之前到不了就是 null。
  function timeToTravel(speed, distance) {
    if (distance <= EPSILON) return 0;
    const discriminant = speed * speed - 2 * TACK_DECEL * distance;
    if (discriminant < 0) return null;
    return (speed - Math.sqrt(discriminant)) / TACK_DECEL;
  }

  // 匀减速 + 墙面镜面反弹：一整帧里可能先撞墙再继续飞，所以按"到墙/到停"切段推进。
  function moveTack(tack, arenaSize, dt) {
    let remaining = Math.max(0, dt);
    let bounces = 0;
    while (remaining > EPSILON) {
      const speed = Math.hypot(tack.vx, tack.vy);
      if (speed <= EPSILON) {
        tack.vx = 0;
        tack.vy = 0;
        return;
      }
      const braking = Math.min(remaining, speed / TACK_DECEL);
      const wall = distanceToWall(tack, arenaSize);
      const wallTime = wall ? timeToTravel(speed, wall.distance) : null;
      if (wall && wallTime !== null && wallTime <= braking) {
        const wallTravel = speed * wallTime - 0.5 * TACK_DECEL * wallTime * wallTime;
        tack.x += tack.directionX * wallTravel;
        tack.y += tack.directionY * wallTravel;
        // 贴到墙面上再翻方向，避免下一轮算出负数距离。
        tack.x = wall.x; tack.y = wall.y;
        const dot = tack.directionX * wall.normalX + tack.directionY * wall.normalY;
        tack.directionX -= 2 * dot * wall.normalX;
        tack.directionY -= 2 * dot * wall.normalY;
        const speedAfterBounce = Math.max(0, speed - TACK_DECEL * wallTime);
        remaining -= wallTime;
        bounces += 1;
        if (speedAfterBounce <= EPSILON) {
          tack.vx = 0;
          tack.vy = 0;
          return;
        }
        tack.vx = tack.directionX * speedAfterBounce;
        tack.vy = tack.directionY * speedAfterBounce;
        // 理论上场地方形，一帧内连续撞墙有限；万一卡在角上就当场停下。
        if (bounces >= MAX_BOUNCES_PER_STEP) {
          tack.vx = 0;
          tack.vy = 0;
          return;
        }
        continue;
      }
      const travel = speed * braking - 0.5 * TACK_DECEL * braking * braking;
      tack.x += tack.directionX * travel;
      tack.y += tack.directionY * travel;
      const speedAfter = speed - TACK_DECEL * braking;
      remaining -= braking;
      if (speedAfter <= EPSILON) {
        tack.vx = 0;
        tack.vy = 0;
        return;
      }
      tack.vx = tack.directionX * speedAfter;
      tack.vy = tack.directionY * speedAfter;
    }
  }

  // 触碰伤害：每一次"贴上"结算 1 点，贴着不放不会继续掉血；分开后再碰上会重新结算。
  // 既没有次数上限也没有冷却——限制来自接触本身（进入接触的那一刻）。
  // 判定走整帧扫过的线段：既覆盖"钉子飞过去扎到球"，也覆盖"球自己压到已经停住的钉子"。
  function resolveTouchDamage(tack, startX, startY, services) {
    const touching = tack.contactScratch;
    touching.clear();
    services.forEachContactEnemy((enemy) => {
      const reach = enemy.radius + tack.radius;
      const contact = firstSegmentCircleContact(
        startX, startY, tack.x, tack.y, enemy.x, enemy.y, reach
      );
      if (contact === null) return;
      touching.add(enemy.instanceId);
      if (tack.touchingEnemyIds.has(enemy.instanceId)) return;
      services.dealDamage(enemy, TACK_DAMAGE);
    });
    // 交换两个集合：这一帧的接触名单成为下一帧的比对基准，旧集合留给下一帧重新填。
    tack.contactScratch = tack.touchingEnemyIds;
    tack.touchingEnemyIds = touching;
  }

  // 圆角横杠：钉帽被看成一块横向的金属片，两侧收圆角。inset 用来画内圈倒角。
  function traceBar(context, inset = 0) {
    const left = BAR_CENTER_X - BAR_HALF_THICKNESS + inset;
    const right = BAR_CENTER_X + BAR_HALF_THICKNESS - inset;
    const top = -BAR_HALF_LENGTH + inset;
    const bottom = BAR_HALF_LENGTH - inset;
    const radius = Math.max(0.05, Math.min(
      BAR_CORNER_RADIUS, (right - left) / 2, (bottom - top) / 2
    ));
    context.beginPath();
    context.moveTo(left + radius, top);
    context.lineTo(right - radius, top);
    context.quadraticCurveTo(right, top, right, top + radius);
    context.lineTo(right, bottom - radius);
    context.quadraticCurveTo(right, bottom, right - radius, bottom);
    context.lineTo(left + radius, bottom);
    context.quadraticCurveTo(left, bottom, left, bottom - radius);
    context.lineTo(left, top + radius);
    context.quadraticCurveTo(left, top, left + radius, top);
    context.closePath();
  }

  // 针杆：从横杠里长出来，越往前越细，最后是一根尖。
  function traceShaft(context) {
    context.beginPath();
    context.moveTo(SHAFT_ROOT_X, -SHAFT_ROOT_HALF_WIDTH);
    context.lineTo(SHAFT_SHOULDER_X, -SHAFT_SHOULDER_HALF_WIDTH);
    context.lineTo(SHAFT_TIP_X, 0);
    context.lineTo(SHAFT_SHOULDER_X, SHAFT_SHOULDER_HALF_WIDTH);
    context.lineTo(SHAFT_ROOT_X, SHAFT_ROOT_HALF_WIDTH);
    context.closePath();
  }

  // 铁质一类的横向渐变：没有 createLinearGradient 的假 canvas 退回单色。
  function metalPaint(context, top, bottom, stops, fallback) {
    if (typeof context.createLinearGradient !== "function") return fallback;
    const gradient = context.createLinearGradient(0, top, 0, bottom);
    for (const [offset, color] of stops) gradient.addColorStop(offset, color);
    return gradient;
  }

  function drawTack(tack, context) {
    const angle = Math.atan2(tack.directionY, tack.directionX);
    context.save();
    context.translate(tack.x, tack.y);
    context.rotate(angle);
    context.lineJoin = "round";
    context.lineCap = "round";

    // ── 针杆 ──
    context.fillStyle = metalPaint(context, -SHAFT_ROOT_HALF_WIDTH, SHAFT_ROOT_HALF_WIDTH, [
      [0, SHAFT_LIGHT_COLOR],
      [0.32, "#b0b7be"],
      [0.62, "#8b929a"],
      [1, SHAFT_DARK_COLOR]
    ], "#8a9199");
    traceShaft(context);
    context.fill();
    context.strokeStyle = OUTLINE_COLOR;
    context.lineWidth = 0.2;
    context.stroke();

    // 杆身是一根圆柱：偏上一条高光，偏下一条暗脊。
    context.strokeStyle = HIGHLIGHT_COLOR;
    context.lineWidth = 0.13;
    context.beginPath();
    context.moveTo(SHAFT_ROOT_X + 0.18, -SHAFT_ROOT_HALF_WIDTH * 0.4);
    context.lineTo(SHAFT_SHOULDER_X - 0.06, -SHAFT_SHOULDER_HALF_WIDTH * 0.4);
    context.lineTo(SHAFT_TIP_X - 0.2, 0);
    context.stroke();
    context.strokeStyle = SHAFT_RIDGE_SHADOW_COLOR;
    context.lineWidth = 0.11;
    context.beginPath();
    context.moveTo(SHAFT_ROOT_X + 0.18, SHAFT_ROOT_HALF_WIDTH * 0.52);
    context.lineTo(SHAFT_SHOULDER_X - 0.06, SHAFT_SHOULDER_HALF_WIDTH * 0.52);
    context.stroke();

    // 针尖：最后一段磨亮，尖端点一点反光。
    context.fillStyle = TIP_COLOR;
    context.beginPath();
    context.moveTo(SHAFT_TIP_X - 0.42, -0.075);
    context.lineTo(SHAFT_TIP_X, 0);
    context.lineTo(SHAFT_TIP_X - 0.42, 0.075);
    context.closePath();
    context.fill();
    context.globalAlpha = 0.85;
    context.beginPath();
    context.arc(SHAFT_TIP_X - 0.16, -0.05, 0.085, 0, TAU);
    context.fill();
    context.globalAlpha = 1;

    // ── 横杠（钉帽） ──
    // 顶面是一块微微拱起的金属圆盘：径向渐变从中间亮到边缘暗，读起来有弧度而不是一片平色。
    if (typeof context.createRadialGradient === "function") {
      const dome = context.createRadialGradient(
        BAR_CENTER_X, -0.28, 0.12,
        BAR_CENTER_X, -0.05, BAR_HALF_LENGTH
      );
      dome.addColorStop(0, "#dee4e9");
      dome.addColorStop(0.45, BAR_LIGHT_COLOR);
      dome.addColorStop(0.78, "#8e959e");
      dome.addColorStop(1, "#5c636c");
      context.fillStyle = dome;
    } else {
      context.fillStyle = BAR_MID_COLOR;
    }
    traceBar(context);
    context.fill();
    context.strokeStyle = OUTLINE_COLOR;
    context.lineWidth = 0.18;
    context.stroke();

    // 内圈倒角：上缘一线亮、下缘一线暗，金属片的厚度就出来了。
    context.strokeStyle = HIGHLIGHT_COLOR;
    context.lineWidth = 0.12;
    traceBar(context, 0.2);
    context.stroke();
    context.strokeStyle = BAR_SHADOW_COLOR;
    context.lineWidth = 0.14;
    traceBar(context, 0.3);
    context.stroke();

    // 中间的冲压凹点：钉帽成型的印记，顺便把视线收到中心。
    if (typeof context.createRadialGradient === "function") {
      const stamp = context.createRadialGradient(
        BAR_CENTER_X - 0.02, -0.02, 0.01, BAR_CENTER_X, 0, 0.22
      );
      stamp.addColorStop(0, "rgba(56,62,69,0.42)");
      stamp.addColorStop(1, "rgba(56,62,69,0)");
      context.fillStyle = stamp;
      context.beginPath();
      context.arc(BAR_CENTER_X, 0, 0.24, 0, TAU);
      context.fill();
    }

    // 顶上的一点镜面高光：位置略偏上偏左，符合左上来光。
    context.fillStyle = "rgba(250,253,255,0.42)";
    context.beginPath();
    context.ellipse(BAR_CENTER_X - 0.04, -0.82, 0.17, 0.34, 0, 0, TAU);
    context.fill();

    // 针杆插进钉帽的接缝：一小段暗影，避免杆和帽糊成一块。
    context.strokeStyle = SOCKET_SHADOW_COLOR;
    context.lineWidth = 0.16;
    context.beginPath();
    context.moveTo(BAR_CENTER_X + BAR_HALF_THICKNESS * 0.62, -SHAFT_ROOT_HALF_WIDTH * 0.66);
    context.lineTo(BAR_CENTER_X + BAR_HALF_THICKNESS * 0.62, SHAFT_ROOT_HALF_WIDTH * 0.66);
    context.stroke();

    context.restore();
  }

  function createThumbtackProjectile(ball) {
    const angle = Math.random() * TAU;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    return {
      kind: "thumbtack-tack",
      life: TACK_LIFE,
      radius: TACK_RADIUS,
      // 钉子躺在地上：画在球体之下，球滚过去时把它盖住，也不会压住血量数字。
      drawLayer: "background",
      color: TACK_HEAD_COLOR,
      damage: TACK_DAMAGE,
      replayDamage: TACK_DAMAGE,
      attackTags: ["physical", "piercing"],
      // 从球面出射，而不是从球心：钉帽不会一出生就被本体盖住。
      x: ball.x + directionX * ball.radius,
      y: ball.y + directionY * ball.radius,
      vx: directionX * TACK_SPEED,
      vy: directionY * TACK_SPEED,
      directionX,
      directionY,
      // 当前正贴着的敌人：用来分"刚碰上"和"一直贴着"。
      touchingEnemyIds: new Set(),
      contactScratch: new Set(),
      update({ entity, game, services }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        moveTack(entity, game, Math.max(0, dt));
        resolveTouchDamage(entity, startX, startY, services);
      },
      draw({ entity }, context) {
        drawTack(entity, context);
      }
    };
  }

  const thumbtackDefinition = {
    id: "thumbtack",
    name: "\u56fe\u9489",
    englishName: "Thumbtack",
    color: "#17b56b",
    description: "2\u79d2\u4e00\u9897\u8d77\u6b65\uff0c\u6bcf\u79d2+0.02\u9897\uff0c\u5c01\u98762\u9897/\u79d2 / \u76f4\u5f843\u3001\u521d\u901f150\u3001\u51cf\u901f200\u3001\u78b0\u5899\u53cd\u5f39 / \u98de\u505c\u540e\u7559\u5728\u573a\u4e0a / \u78b0\u5230\u62631\u70b9\uff0c\u5206\u5f00\u518d\u78b0\u518d\u6263\uff08\u65e0\u51b7\u5374\uff09",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      // 用"攒发数"推进节拍：频率线性爬升时按梯形积分累加，所以整场发数不随步长变化。
      let frequency = FIRE_FREQUENCY_START;
      let shotProgress = 0;
      let tackCount = 0;
      function remainingToNextShot() {
        return Math.max(EPSILON, (1 - shotProgress) / frequency);
      }
      return {
        update(_context, dt) {
          const step = Math.max(0, dt);
          if (!(step > 0)) return;
          const rampTime = Math.max(0, (FIRE_FREQUENCY_MAX - frequency) / FIRE_FREQUENCY_ACCEL);
          if (step <= rampTime) {
            const next = frequency + FIRE_FREQUENCY_ACCEL * step;
            shotProgress += 0.5 * (frequency + next) * step;
            frequency = next;
            return;
          }
          // 这一帧里先爬升到封顶，剩下的时间按 2 颗/秒匀速攒。
          shotProgress += 0.5 * (frequency + FIRE_FREQUENCY_MAX) * rampTime +
            FIRE_FREQUENCY_MAX * (step - rampTime);
          frequency = FIRE_FREQUENCY_MAX;
        },
        getNextTransitionIn: remainingToNextShot,
        afterUpdateStep({ ball }) {
          if (shotProgress + EPSILON < 1) return;
          // 被封攻时最多压一发在膛里，解锁之后立刻打出去（不攒成爆发）。
          if (!services.getCapabilities(ball).canDealDamage) {
            shotProgress = Math.min(shotProgress, 1);
            return;
          }
          while (shotProgress + EPSILON >= 1) {
            shotProgress -= 1;
            tackCount += 1;
            services.spawnProjectile(createThumbtackProjectile(ball));
          }
        },
        getThumbtackState() {
          return {
            frequency,
            nextShotIn: Math.max(0, (1 - shotProgress) / frequency),
            tackCount
          };
        }
      };
    }
  };

  registerBall(thumbtackDefinition);
  return {
    thumbtackDefinition,
    createThumbtackProjectile,
    moveTack,
    thumbtackRules: Object.freeze({
      // 开局节奏：1 / fireFrequencyStart = 2 秒一颗
      fireInterval: FIRE_INTERVAL,
      fireFrequencyStart: FIRE_FREQUENCY_START,
      fireFrequencyAccel: FIRE_FREQUENCY_ACCEL,
      fireFrequencyMax: FIRE_FREQUENCY_MAX,
      tackSpeed: TACK_SPEED,
      tackDecel: TACK_DECEL,
      tackDiameter: TACK_DIAMETER,
      tackRadius: TACK_RADIUS,
      tackDamage: TACK_DAMAGE,
      tackLife: TACK_LIFE
    })
  };
});
