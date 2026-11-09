(function initializeHydraulicPress(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createHydraulicPressPlugin({ registerBall, resolveArenaGeometry }) {
  // 液压机：场地类角色。战场上方会缓慢降下一根与战场同宽的黑黄液压柱（速度 2），
  // 把下方的自由空间越压越矮：柱体本身有 3 点碰撞伤害（进入接触时结算一次），
  // 当某个敌人的身躯半径都塞不进"柱底到地面"的剩余高度时，直接把它压成 0 HP
  //（秒杀）。本体没有任何主动能力，也不会被自己的柱子压死。
  //
  // 柱子的行程：从 0 缓慢下压到战场底部 → 停顿 PRESS_HOLD_SECONDS → 快速收回顶部
  // → 再次下压，如此循环；场地大小一律取 game.arenaSize（200/300/400 都成立）。
  const PRESS_SPEED = 2;
  const PRESS_DAMAGE = 3;
  const PRESS_HOLD_SECONDS = 1;
  const PRESS_RETRACT_SPEED = 240;
  const HAZARD_YELLOW = "#e8b31f";
  const HAZARD_DARK = "#17191c";
  const STEEL_LIGHT = "#c9cfd6";
  const STEEL_DARK = "#5c646b";
  const BODY_STRIPE_STEP = 9;
  const COLUMN_STRIPE_STEP = 16;
  const STRIPE_WIDTH = 6;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 工地黑黄斜条纹：给定矩形区域铺满 45° 条纹，调用方不必自己裁切。
  function fillHazardStripes(context, x, y, width, height, step = COLUMN_STRIPE_STEP) {
    if (width <= 0 || height <= 0) return;
    const span = step;
    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.fillStyle = HAZARD_YELLOW;
    context.fillRect(x, y, width, height);
    context.fillStyle = HAZARD_DARK;
    for (let offset = -height - span; offset < width + height + span; offset += span) {
      context.beginPath();
      context.moveTo(x + offset, y + height);
      context.lineTo(x + offset + STRIPE_WIDTH, y + height);
      context.lineTo(x + offset + STRIPE_WIDTH + height, y);
      context.lineTo(x + offset + height, y);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  // 柱体：满宽黑黄斜纹 + 两侧钢导轨 + 底部压头（一条更厚的钢带）。
  function drawPressColumn(context, entity, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const faceY = clamp(Number.isFinite(entity.faceY) ? entity.faceY - arena.top : 0, 0, arena.height);
    if (faceY <= 0.5) return;
    const width = arena.width;
    context.save();
    context.translate(arena.left, arena.top);
    fillHazardStripes(context, 0, 0, width, faceY, COLUMN_STRIPE_STEP);
    // 两侧导轨
    context.fillStyle = STEEL_DARK;
    context.fillRect(0, 0, 5, faceY);
    context.fillRect(width - 5, 0, 5, faceY);
    context.fillStyle = STEEL_LIGHT;
    context.fillRect(0, 0, 1.6, faceY);
    context.fillRect(width - 1.6, 0, 1.6, faceY);
    // 压头
    const headHeight = Math.min(10, faceY);
    context.fillStyle = STEEL_DARK;
    context.fillRect(0, faceY - headHeight, width, headHeight);
    context.fillStyle = HAZARD_DARK;
    context.fillRect(0, faceY - headHeight, width, 1.2);
    context.fillStyle = STEEL_LIGHT;
    context.fillRect(0, faceY - 2.4, width, 2.4);
    // 压头下方的阴影，读出"正在压下来"的重量
    context.globalAlpha *= 0.3;
    context.fillStyle = "#100e08";
    context.fillRect(0, faceY, width, 4);
    context.restore();
  }

  // 本体：钢圈 + 黑黄斜纹 + 上下两条液压缸钢块。本体没有任何能力，外观就是台机器。
  function drawHydraulicPressBody(ball, context) {
    const radius = ball.radius;
    context.save();
    context.translate(ball.x, ball.y);

    context.save();
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.clip();
    fillHazardStripes(context, -radius, -radius, radius * 2, radius * 2, BODY_STRIPE_STEP);
    context.restore();

    // 上下液压缸
    context.fillStyle = STEEL_DARK;
    context.fillRect(-radius * 0.86, -radius * 0.76, radius * 1.72, radius * 0.42);
    context.fillRect(-radius * 0.86, radius * 0.34, radius * 1.72, radius * 0.42);
    context.fillStyle = STEEL_LIGHT;
    context.fillRect(-radius * 0.86, -radius * 0.76, radius * 1.72, 1.3);
    context.fillRect(-radius * 0.86, radius * 0.34, radius * 1.72, 1.3);

    // 钢圈
    context.strokeStyle = STEEL_LIGHT;
    context.lineWidth = 2.4;
    context.beginPath();
    context.arc(0, 0, radius - 1.2, 0, TWO_PI);
    context.stroke();
    context.strokeStyle = "#2b2f33";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.stroke();
    context.restore();
  }

  // 撞柱反弹：柱面是水平面、柱子本身静止，法线朝下 (0, 1)。和钢卷/圆盾对大型实体
  // 的处理一致：只改方向、保持速度大小，并且同时写回 stored 速度（引擎每帧会用
  // stored 还原速度，只改 vx/vy 会被下一帧覆盖回去，这就是之前"贴在上面"的原因）。
  function bounceOffPressFace(ball) {
    if (!(ball.vy < 0)) return false;
    const speed = Math.hypot(ball.vx, ball.vy) ||
      (Number.isFinite(ball.speed) ? ball.speed * (ball.speedMultiplier || 1) : 0);
    let nextVx = ball.vx;
    let nextVy = -ball.vy;
    const magnitude = Math.hypot(nextVx, nextVy);
    if (magnitude <= EPSILON) {
      nextVx = 0;
      nextVy = speed;
    } else {
      nextVx = nextVx / magnitude * speed;
      nextVy = nextVy / magnitude * speed;
    }
    ball.vx = ball.storedVx = nextVx;
    ball.vy = ball.storedVy = nextVy;
    return true;
  }

  // 液压柱：场地实体。判定面就是 entity.faceY（柱子底面到地面的距离 = 剩余空间）。
  // 它同时是一个"大型第三方实体"：solid + 矩形接触契约（x/y + normalX/normalY +
  // width/height），所以钢卷、圆盾、美国队长盾、重锤这些自带大型实体判定的球都会
  // 把它当成火车/台球桌那类东西正常转向、不去碾碎它。
  function createPressColumnEntity(owner, arenaSize) {
    let arena = resolveArenaGeometry(arenaSize);
    return {
      kind: "hydraulic-press-column",
      combatKind: "environment",
      life: Number.MAX_SAFE_INTEGER,
      drawLayer: "foreground",
      solid: true,
      indestructible: true,
      x: arena.centerX,
      y: arena.top,
      // 矩形接触契约：从柱面 (x, y) 沿 normal 向上 height、左右 width。
      normalX: 0,
      normalY: -1,
      width: arena.width,
      height: 0,
      arenaSize: arena.size,
      arena,
      faceY: arena.top,
      phase: "descend",
      holdTimer: 0,
      touching: new Set(),
      update({ entity, game, services: entityServices }, dt) {
        const step = Math.max(0, dt);
        arena = resolveArenaGeometry(game);
        entity.arena = arena;
        entity.arenaSize = arena.size;
        entity.x = arena.centerX;
        entity.width = arena.width;
        const size = arena.bottom;

        if (entity.phase === "retract") {
          entity.faceY = Math.max(arena.top, entity.faceY - PRESS_RETRACT_SPEED * step);
          entity.touching.clear();
          entity.y = entity.faceY;
          entity.height = entity.faceY - arena.top;
          if (entity.faceY <= arena.top + EPSILON) {
            entity.faceY = arena.top;
            entity.phase = "descend";
            entity.holdTimer = 0;
          }
          return;
        }
        if (entity.phase === "hold") {
          entity.holdTimer += step;
          if (entity.holdTimer + EPSILON >= PRESS_HOLD_SECONDS) entity.phase = "retract";
        } else {
          entity.faceY = Math.min(size, entity.faceY + PRESS_SPEED * step);
          entity.holdTimer = 0;
          if (entity.faceY + EPSILON >= size) entity.phase = "hold";
        }
        entity.y = entity.faceY;
        entity.height = entity.faceY - arena.top;

        const touchingNow = new Set();
        // 被柱子顶到：把身躯压到柱面下方；空间塞不下身躯半径时直接秒杀。
        const press = (target, canCrush) => {
          if (!target || target.hp <= 0) return;
          if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
          const radius = Number.isFinite(target.radius) ? target.radius : 0;
          const floor = arena.shape === "circle"
            ? arena.centerY + Math.sqrt(Math.max(0, (arena.width / 2) ** 2 - (target.x - arena.centerX) ** 2))
            : arena.bottom;
          const remaining = floor - entity.faceY;
          const overlapping = target.y - radius <= entity.faceY + EPSILON;
          if (canCrush) entityServices.notifyEntityContact(target, entity, { overlapping });
          if (!overlapping || !entityServices.getContactProfile(target).solid) return;
          const key = target.instanceId || target.id;
          touchingNow.add(key);
          // 推出柱体（贴地时不再下移，随后会被秒杀规则处理）。
          if (!entityServices.isMovementLocked(target)) {
            Object.assign(target, arena.clampPoint(target.x, entity.faceY + radius, radius));
            if (bounceOffPressFace(target)) entityServices.playBounce(1);
          }

          if (canCrush && !entity.touching.has(key)) {
            entityServices.dealDamage(target, PRESS_DAMAGE);
          }
          if (!canCrush || target.hp <= 0) return;
          // 敌人身躯半径 = 它的自由活动高度：柱底到地面塞不下它，即秒杀。
          if (remaining <= radius + EPSILON) {
            target.hp = 0;
            // 不挂任何浮字：秒杀本身就是画面信息，飘一行"压扁"只会喧宾夺主。
            entityServices.spawnParticleBurst({
              x: target.x,
              y: target.y,
              colors: [HAZARD_YELLOW, HAZARD_DARK, STEEL_LIGHT],
              minDiameter: 1.5,
              maxDiameter: 5,
              minSpeed: 40,
              maxSpeed: 150,
              life: 0.5,
              density: 1.2
            });
          }
        };
        // 第三方结构对场上所有球体一视同仁：敌我（含本体）都会被顶下去、都会在
        // 柱面上弹开；只有敌人才吃 3 点接触伤害和秒杀。
        // 走 forEachEnemy/forEachAlly 也就顺带尊重了物理/可命中契约：虚化穿模的球
        // 本来就不与实体碰撞（physical=false），自然也不会被柱子顶住。
        entityServices.forEachContactEnemy((enemy) => press(enemy, true));
        entityServices.forEachAlly((ally) => press(ally, false));
        const selfBall = entityServices.getBall(entity.ownerInstanceId);
        if (selfBall) press(selfBall, false);
        entity.touching = touchingNow;
      },
      draw({ entity, game }, context) {
        drawPressColumn(context, entity, arena);
      }
    };
  }

  const hydraulicPressDefinition = {
    id: "hydraulicPress",
    name: "液压机",
    englishName: "Hydraulic Press",
    color: HAZARD_YELLOW,
    description: "场地黑黄液压柱 / 下压速度2 / 柱体碰撞-3 / 空间不足即秒杀",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let column = null;

      return {
        onSpawn(context) {
          const arenaSize = context.game.arena || context.game.arenaSize;
          column = services.spawnCombatEntity(
            createPressColumnEntity(context.ball, arenaSize)
          );
        },
        // 本体没有任何主动能力：不攻击、不加速、不放技能。
        update() {},
        getHydraulicPressState() {
          if (!column) return null;
          return {
            faceY: column.faceY,
            phase: column.phase,
            remaining: column.arena.bottom - column.faceY
          };
        },
        drawBody(context, canvasContext) {
          drawHydraulicPressBody(context.ball, canvasContext);
          return true;
        }
      };
    }
  };

  registerBall(hydraulicPressDefinition);
  return {
    hydraulicPressDefinition,
    createPressColumnEntity,
    drawHydraulicPressBody,
    drawPressColumn,
    fillHazardStripes,
    HYDRAULIC_PRESS_CONSTANTS: Object.freeze({
      PRESS_SPEED,
      PRESS_DAMAGE,
      PRESS_HOLD_SECONDS,
      PRESS_RETRACT_SPEED
    })
  };
});
