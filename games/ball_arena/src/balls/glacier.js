(function initializeGlacier(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      require("../core/ball-registry.js"),
      require("../core/arena-geometry.js"),
      require("./frost-trail.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGlacierPlugin({ registerBall, createFrostTrail, resolveArenaGeometry }) {
  // 冰川：冰蓝色纯色本体的远程控场球。
  // 每 1.5 秒朝最近的敌人射出一颗冰蓝雪球；雪球本身**没有任何伤害**，
  // 撞到敌人立刻化掉（接触点之前的路照常铺完），不再穿过去，
  // 它一路飞过留下的才是威胁：轨迹宽 10、有效寿命 2.7 秒（+0.4s 融化），敌方踩进去时的出伤方式
  // 与梓的冰霜轨迹完全一致 —— 直接复用 azusa.js 的 createFrostTrail 工厂，
  // 所以「接触 → 挂冰霜 → 每 0.6→0.3 秒跳 1 点 → 线性冻结」这套曲线是同一条代码。
  // 两者共用同一个冰霜效果 id（azusa-frost）：同一时间只结算一条冻结，不会叠加成双倍跳伤。
  const VOLLEY_INTERVAL = 1.5;
  const SNOWBALL_SPEED = 300;
  const SNOWBALL_RADIUS = 6;
  // 弹体不设时间寿命：它在场地里一直飞，直到撞人融化或飞出场地。
  // （以前写死过 4 秒，那在大场地里会把还在飞的雪球凭空回收——
  //  例如 2000 单位的场地横穿要 6.4 秒。）
  const SNOWBALL_LIFE = Number.MAX_SAFE_INTEGER;
  const SNOWBALL_LAUNCH_GAP = 2;
  const TRAIL_WIDTH = 10;
  // 有效寿命（出伤窗口）= 2.7 秒；之后再融化渐隐 0.4 秒（纯视觉，出伤已经结束），
  // 所以轨迹在地面上总共存在 3.1 秒（原为 3.4 秒，按需求整体减 0.3 秒；
  // 减的是出伤窗口，融化渐隐仍是 0.4 秒）。
  const TRAIL_ACTIVE = 2.7;
  const TRAIL_MELT = 0.4;
  const TRAIL_LIFE = TRAIL_ACTIVE + TRAIL_MELT;
  const TRAIL_SEGMENT_MIN = 8;
  // 冰蓝色：本体、雪球、轨迹全部由这一个颜色派生（浅色/深色都是算出来的）。
  const ICE_BLUE = "#7fd4ff";
  const ICE_BLUE_LIGHT = mixHexWithWhite(ICE_BLUE, 0.55);
  const ICE_BLUE_SOFT = mixHexWithWhite(ICE_BLUE, 0.3);
  const ICE_BLUE_DEEP = mixHexWithWhite(ICE_BLUE, -0.3);
  const TRAIL_CRYSTALS = Object.freeze([ICE_BLUE, ICE_BLUE_SOFT, ICE_BLUE_LIGHT, ICE_BLUE_DEEP]);
  const EPSILON = 1e-9;

  // 把一个 #rrggbb 往白（amount > 0）或往黑（amount < 0）方向拉，得到同色系的深浅档。
  function mixHexWithWhite(hex, amount) {
    const value = Math.max(-1, Math.min(1, amount));
    const channels = [1, 3, 5].map((offset) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const mixed = value >= 0 ? channel + (1 - channel) * value : channel * (1 + value);
      return Math.round(mixed * 255).toString(16).padStart(2, "0");
    });
    return "#" + channels.join("");
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    const magnitude = Math.hypot(x, y);
    if (magnitude > EPSILON) return { x: x / magnitude, y: y / magnitude };
    const fallbackMagnitude = Math.hypot(fallbackX, fallbackY) || 1;
    return { x: fallbackX / fallbackMagnitude, y: fallbackY / fallbackMagnitude };
  }

  // 铺一段冰霜轨迹：正常飞行时按 TRAIL_SEGMENT_MIN 节流，融化时强制补完最后一段。
  function layTrail(entity, toX, toY, entityServices, force = false) {
    const distance = Math.hypot(toX - entity.trailX, toY - entity.trailY);
    if (distance < (force ? 1 : TRAIL_SEGMENT_MIN)) return;
    entityServices.spawnCombatEntity(createFrostTrail(
      entity.trailX,
      entity.trailY,
      toX,
      toY,
      {
        kind: "glacier-frost-trail",
        width: TRAIL_WIDTH,
        activeDuration: TRAIL_ACTIVE,
        fadeDuration: TRAIL_MELT,
        coreColor: ICE_BLUE_DEEP,
        edgeColor: ICE_BLUE_LIGHT,
        crystalColors: TRAIL_CRYSTALS
      }
    ));
    entity.trailX = toX;
    entity.trailY = toY;
  }

  // 撞人即化：用引擎的扫掠命中服务（getFirstEnemyHit）找这一帧撞上的第一个敌人。
  // 轨迹补到融化那一帧的实际位置 —— 正好压在敌人身上，不会差半个身位打不到。
  function meltOnContact(entity, fromX, fromY, entityServices) {
    const hit = entityServices.getFirstEnemyHit(fromX, fromY, entity.x, entity.y, entity.radius);
    if (!hit) return false;
    layTrail(entity, entity.x, entity.y, entityServices, true);
    entity.entityActive = false;
    return true;
  }

  // 雪球：直线飞行、无伤害、沿路铺冰霜轨迹；撞人即化、飞出场地边界即化（没有秒数寿命）。
  function createSnowball(x, y, directionX, directionY) {
    return {
      kind: "glacier-snowball",
      combatKind: "projectile",
      // 走的是引擎的弹体通道（spawnProjectile → isProjectile/kind=projectile/回放事件/
      // 敌方 onEnemyProjectileSpawned）；但弹体零伤害，回放元数据也如实写 0。
      replayDamage: 0,
      radius: SNOWBALL_RADIUS,
      color: ICE_BLUE,
      life: SNOWBALL_LIFE,
      x,
      y,
      vx: directionX * SNOWBALL_SPEED,
      vy: directionY * SNOWBALL_SPEED,
      trailX: x,
      trailY: y,
      update({ entity, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const fromX = entity.x;
        const fromY = entity.y;
        entity.x += entity.vx * elapsed;
        entity.y += entity.vy * elapsed;
        if (meltOnContact(entity, fromX, fromY, entityServices)) return;
        layTrail(entity, entity.x, entity.y, entityServices);
        const margin = entity.radius;
        if (
          !resolveArenaGeometry(game).contains(entity.x, entity.y, margin)
        ) {
          entity.entityActive = false;
        }
      },
      draw({ entity }, canvas) {
        const baseAlpha = canvas.globalAlpha;
        canvas.save();
        // 冷光拖尾
        canvas.globalAlpha = baseAlpha * 0.35;
        canvas.strokeStyle = ICE_BLUE_DEEP;
        canvas.lineWidth = SNOWBALL_RADIUS * 1.4;
        canvas.lineCap = "round";
        canvas.beginPath();
        canvas.moveTo(entity.x - entity.vx * 0.035, entity.y - entity.vy * 0.035);
        canvas.lineTo(entity.x, entity.y);
        canvas.stroke();
        // 雪球本体 + 高光
        canvas.globalAlpha = baseAlpha;
        canvas.fillStyle = ICE_BLUE;
        canvas.beginPath();
        canvas.arc(entity.x, entity.y, SNOWBALL_RADIUS, 0, Math.PI * 2);
        canvas.fill();
        canvas.fillStyle = ICE_BLUE_LIGHT;
        canvas.beginPath();
        canvas.arc(
          entity.x - SNOWBALL_RADIUS * 0.3,
          entity.y - SNOWBALL_RADIUS * 0.3,
          SNOWBALL_RADIUS * 0.42,
          0,
          Math.PI * 2
        );
        canvas.fill();
        canvas.restore();
      }
    };
  }

  const glacierDefinition = {
    id: "glacier",
    elementTags: Object.freeze(["cold"]),
    name: "冰川",
    englishName: "Glacier",
    color: ICE_BLUE,
    description: "每1.5s射出雪球 / 雪球无伤害 只留冰霜轨迹 / 轨迹宽10 出伤3s / 踩入造成冰霜伤害",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: VOLLEY_INTERVAL,
    createBehavior(services) {
      // 开局先蓄 1.5 秒再射第一颗；被控时整个节奏冻结（计时只在 update 里推进）。
      let volleyTimer = VOLLEY_INTERVAL;
      let fired = false;

      function fire(context) {
        fired = true;
        const ball = context.ball;
        const target = services.getOpponent();
        const heading = Math.hypot(ball.storedVx || ball.vx, ball.storedVy || ball.vy) > EPSILON
          ? { x: ball.storedVx || ball.vx, y: ball.storedVy || ball.vy }
          : { x: 1, y: 0 };
        const direction = target
          ? normalizeDirection(target.x - ball.x, target.y - ball.y, heading.x, heading.y)
          : normalizeDirection(heading.x, heading.y);
        const startX = ball.x + direction.x * (ball.radius + SNOWBALL_LAUNCH_GAP);
        const startY = ball.y + direction.y * (ball.radius + SNOWBALL_LAUNCH_GAP);
        services.spawnProjectile(createSnowball(startX, startY, direction.x, direction.y));
      }

      return {
        onAttackBorrowStart(context) { fire(context); },
        isAttackCycleComplete() { return fired; },
        update(context, dt) {
          volleyTimer -= Math.max(0, Number.isFinite(dt) ? dt : 0);
          if (volleyTimer > EPSILON) return;
          volleyTimer = VOLLEY_INTERVAL;
          fire(context);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, volleyTimer);
        }
        // 本体不实现 drawBody：需求是「冰蓝色纯色」，交给渲染器的纯色圆
        //（drawSmoothBall 就是一次 #7fd4ff 平涂 + 全体共用的描边），不加高光、不加贴图。
      };
    }
  };

  registerBall(glacierDefinition);

  return {
    glacierDefinition,
    createSnowball,
    GLACIER_CONSTANTS: Object.freeze({
      VOLLEY_INTERVAL,
      SNOWBALL_SPEED,
      SNOWBALL_RADIUS,
      SNOWBALL_LIFE,
      SNOWBALL_LAUNCH_GAP,
      TRAIL_WIDTH,
      TRAIL_LIFE,
      TRAIL_MELT,
      TRAIL_ACTIVE,
      TRAIL_SEGMENT_MIN,
      ICE_BLUE
    })
  };
});
