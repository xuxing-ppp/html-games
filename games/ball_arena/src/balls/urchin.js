(function initializeUrchin(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createUrchinPlugin({ registerBall }) {
  // 海胆：深蓝色纯色本体，全身 50 根等角度分布的尖刺。
  //
  // - 每 0.6 秒刺出一下：0.06s 撑到满长、0.14s 收回，剩下的 0.4s 静静收着。
  // - 收着的时候刺不会消失，只是缩回球面外露出 4px 的小尖尖（真海胆的形状）；
  //   刺出时才整根弹出去，伸出长度 50 —— 刺尖离球心 = 本体半径 15 + 50 = 65。
  // - 每根刺各有 1 点触碰伤害。判定用的是**画出来的那根刺**：从埋在本体里的
  //   根部到刺尖那条线段，和"目标圆"求最近距离；不是只判敌方圆心是否压在刺上
  //   —— 目标半径要算进去，体型越大越容易被戳到。
  // - 判定松紧跟着刺伸出的程度走：刺还蜷在本体里时小尖尖要扎进对方身体
  //   `SPIKE_INSERTION_DEPTH` 那么深才算碰到（普通球基本够不着），整根弹出去
  //   之后只要刺身贴到球面就算。少了这一条，贴在一起时收着不动的海胆和伸满 50
  //   算出来一样是 9 根 —— 伤害和"刺出"这个动作完全脱钩，看上去就是
  //   "刺还没伸出来却一次掉 9 血"。
  //   判定线段还必须从刺的根部（球面内侧）量起，不能从球心量起：球心到球面
  //   那 15px 本来是空的，算进去就成了"一圈看不见的棍子"，贴身时全部命中。
  // - 同一根刺在同一轮里对同一个目标只结算一次，下一轮刺出时重新计数。
  //
  // 本体不实现 drawBody：需求是深蓝色游戏默认纯色绘制，交给渲染器的
  // drawSmoothBall + drawBallOutline（一次平涂 + 自动深色描边）。
  const SPIKE_COUNT = 50;
  const SPIKE_LENGTH = 50;
  // 收起来时也要露在球面外的一小截：完全藏起来就不是海胆了。
  const SPIKE_MIN_LENGTH = 4;
  const SPIKE_HALF_WIDTH = 2.2;
  const SPIKE_DAMAGE = 1;
  // 刺收着时（progress = 0）要求的插入深度，伸出过程中线性放松到 0。
  const SPIKE_INSERTION_DEPTH = 8;
  const CYCLE_DURATION = 0.6;
  const EXTEND_DURATION = 0.06;
  const RETRACT_DURATION = 0.14;
  // 刺的根部埋进本体，本体随后绘制时正好压住接缝。
  const SPIKE_ROOT_INSET = 6;
  const BODY_DEEP_BLUE = "#16309b";
  const SPIKE_BLUE = "#3155d8";
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 三次缓出：t=0 → 0，t=1 → 1，起步快、末端慢。刺出用这条曲线，收回用它
  // 的镜像（1 - 缓出），两段手感对称：都是"啪"地弹出去 / 弹回来。
  function easeOutCubic(t) {
    const inverse = 1 - clamp(t, 0, 1);
    return 1 - inverse * inverse * inverse;
  }

  // 线段是否够得着以 (x, y) 为心、reach 为半径的目标。
  // 内联的平方距离比较，不分配中间对象——旧写法每次都 new 一个 {x, y}，
  // 50 根刺 × 敌人数 每帧就是几百个短命对象，在老机器上是 GC 压力。
  // 与「求最近点再比 Math.hypot(...) > reach」逐位等价。
  function segmentReachesCircle(startX, startY, endX, endY, x, y, reach) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    let progress = 0;
    if (lengthSquared > EPSILON) {
      progress = clamp(
        ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    }
    const offsetX = x - (startX + deltaX * progress);
    const offsetY = y - (startY + deltaY * progress);
    return offsetX * offsetX + offsetY * offsetY <= reach * reach;
  }

  // 50 根刺的固定方向：均匀铺满一圈。做成模块级常量，免得每帧重算三角函数。
  const SPIKE_DIRECTIONS = [];
  for (let index = 0; index < SPIKE_COUNT; index += 1) {
    const angle = (index / SPIKE_COUNT) * Math.PI * 2;
    SPIKE_DIRECTIONS.push(Object.freeze({
      x: Math.cos(angle),
      y: Math.sin(angle)
    }));
  }
  Object.freeze(SPIKE_DIRECTIONS);

  // 一轮里的刺出进度：0 = 收着（只剩小尖尖），1 = 伸到满长。
  function spikeProgress(elapsed) {
    const time = elapsed - Math.floor(elapsed / CYCLE_DURATION) * CYCLE_DURATION;
    if (time < EXTEND_DURATION) return easeOutCubic(time / EXTEND_DURATION);
    const retractElapsed = time - EXTEND_DURATION;
    if (retractElapsed < RETRACT_DURATION) {
      return 1 - easeOutCubic(retractElapsed / RETRACT_DURATION);
    }
    return 0;
  }

  // 某根刺这一刻伸出球面多少：收着时是 4px 的小尖尖，伸满时是 50。
  function spikeLengthAt(progress) {
    return SPIKE_MIN_LENGTH + (SPIKE_LENGTH - SPIKE_MIN_LENGTH) * progress;
  }

  // 刺画在本体之前（drawBefore）：本体随后盖住刺根，看起来就是从身上长出来的。
  function drawSpikes(canvasContext, ball, progress) {
    if (!canvasContext || typeof canvasContext.beginPath !== "function") return;
    const tipDistance = ball.radius + spikeLengthAt(progress);
    const rootDistance = Math.max(0, ball.radius - SPIKE_ROOT_INSET);
    canvasContext.save();
    canvasContext.fillStyle = SPIKE_BLUE;
    // 收着的小尖尖偏淡、弹出时实心，让"唰"地伸出去这一下更明显。
    canvasContext.globalAlpha *= 0.75 + 0.25 * progress;
    canvasContext.beginPath();
    for (let index = 0; index < SPIKE_COUNT; index += 1) {
      const direction = SPIKE_DIRECTIONS[index];
      const normalX = -direction.y;
      const normalY = direction.x;
      const rootX = ball.x + direction.x * rootDistance;
      const rootY = ball.y + direction.y * rootDistance;
      canvasContext.moveTo(
        rootX + normalX * SPIKE_HALF_WIDTH,
        rootY + normalY * SPIKE_HALF_WIDTH
      );
      canvasContext.lineTo(
        ball.x + direction.x * tipDistance,
        ball.y + direction.y * tipDistance
      );
      canvasContext.lineTo(
        rootX - normalX * SPIKE_HALF_WIDTH,
        rootY - normalY * SPIKE_HALF_WIDTH
      );
    }
    canvasContext.fill();
    canvasContext.restore();
  }

  const urchinDefinition = {
    id: "urchin",
    name: "海胆",
    englishName: "Sea Urchin",
    color: BODY_DEEP_BLUE,
    description: "每秒整批弹出50根刺 / 每根刺 -1 / 伸出50 收起露尖",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: CYCLE_DURATION,
    createBehavior(services) {
      // 每根刺一套"本轮已经刺中谁"的集合，惰性创建：同一轮里同一根刺对同一个
      // 目标只结算一次，下一轮刺出时整批清空。
      const piercedBySpike = [];
      for (let index = 0; index < SPIKE_COUNT; index += 1) {
        piercedBySpike.push(null);
      }
      let cycleTimer = 0;
      let progress = 0;
      // 下一轮刺出的时刻（写在 cycleTimer 的时间轴上，开局先来一下）。
      let nextVolleyAt = 0;
      let volleys = 0;
      let hitsThisCycle = 0;

      function resetPierced() {
        for (let index = 0; index < SPIKE_COUNT; index += 1) {
          const pierced = piercedBySpike[index];
          if (pierced && pierced.size > 0) pierced.clear();
        }
        hitsThisCycle = 0;
      }

      function pierceEnemies(ball) {
        const enemies = services.getEnemies();
        if (enemies.length === 0) return;
        const spikeLength = spikeLengthAt(progress);
        const tipDistance = ball.radius + spikeLength;
        // 判定线段就是画出来的那根刺：根部埋在本体里（本体随后盖住接缝），
        // 从那儿量到刺尖 —— 不能从球心量起，否则球心到球面那 15px 也成了"刺"，
        // 贴身的敌人会被一圈根本不存在的棍子捅穿。
        const rootDistance = Math.max(0, ball.radius - SPIKE_ROOT_INSET);
        // 伸出程度 0 ～ 1：0 是收着的小尖尖，1 是整根弹出去。
        const extension = clamp(
          (spikeLength - SPIKE_MIN_LENGTH) / (SPIKE_LENGTH - SPIKE_MIN_LENGTH),
          0,
          1
        );
        for (let index = 0; index < SPIKE_COUNT; index += 1) {
          const direction = SPIKE_DIRECTIONS[index];
          const rootX = ball.x + direction.x * rootDistance;
          const rootY = ball.y + direction.y * rootDistance;
          const tipX = ball.x + direction.x * tipDistance;
          const tipY = ball.y + direction.y * tipDistance;
          let pierced = piercedBySpike[index];
          for (let enemyIndex = 0; enemyIndex < enemies.length; enemyIndex += 1) {
            const target = enemies[enemyIndex];
            if (pierced && pierced.has(target.instanceId)) continue;
            const contact = services.getContactProfile(target);
            if (!contact.solid || !contact.attackable) continue;
            const targetRadius = Number.isFinite(target.radius) ? target.radius : 15;
            // 目标半径必须算进去（雪球这类会长大的球全靠这一项）。再按伸出程度
            // 扣掉插入深度：刺蜷着的时候要扎得够深才算碰到，弹出去之后才放松到
            // "刺身贴到球面就算"。
            const reach = Math.max(
              0,
              targetRadius +
                SPIKE_HALF_WIDTH -
                SPIKE_INSERTION_DEPTH * (1 - extension)
            );
            if (!segmentReachesCircle(rootX, rootY, tipX, tipY, target.x, target.y, reach)) {
              continue;
            }
            if (!pierced) {
              pierced = new Set();
              piercedBySpike[index] = pierced;
            }
            pierced.add(target.instanceId);
            hitsThisCycle += 1;
            services.dealDamage(target, SPIKE_DAMAGE);
          }
        }
      }

      return {
        getAttackCycleDuration() { return EXTEND_DURATION + RETRACT_DURATION; },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) { this.drawBefore(context, canvasContext); },
        update(context, dt) {
          const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
          cycleTimer += step;
          progress = spikeProgress(cycleTimer);
          if (cycleTimer >= nextVolleyAt) {
            // 新的一轮：旧记录清空，50 根刺整批弹出只响一声。
            resetPierced();
            volleys += 1;
            nextVolleyAt += CYCLE_DURATION;
            services.playSound("shoot", { kind: "urchin-spikes" });
          }
          // 小尖尖一直算刺：贴着本体的目标每轮都会被扎一次。
          pierceEnemies(context.ball);
        },
        drawBefore(context, canvasContext) {
          drawSpikes(canvasContext, context.ball, progress);
        },
        getUrchinState() {
          return {
            spikeCount: SPIKE_COUNT,
            spikeLength: SPIKE_LENGTH,
            minSpikeLength: SPIKE_MIN_LENGTH,
            currentSpikeLength: spikeLengthAt(progress),
            spikeDamage: SPIKE_DAMAGE,
            insertionDepth: SPIKE_INSERTION_DEPTH,
            cycleDuration: CYCLE_DURATION,
            extendDuration: EXTEND_DURATION,
            retractDuration: RETRACT_DURATION,
            cycleTimer,
            progress,
            volleys,
            hitsThisCycle,
            directions: SPIKE_DIRECTIONS.map((direction) => ({
              x: direction.x,
              y: direction.y
            }))
          };
        }
      };
    }
  };

  registerBall(urchinDefinition);

  return {
    urchinDefinition,
    segmentReachesCircle,
    URCHIN_CONSTANTS: Object.freeze({
      SPIKE_COUNT,
      SPIKE_LENGTH,
      SPIKE_MIN_LENGTH,
      SPIKE_HALF_WIDTH,
      SPIKE_DAMAGE,
      SPIKE_INSERTION_DEPTH,
      CYCLE_DURATION,
      EXTEND_DURATION,
      RETRACT_DURATION,
      BODY_DEEP_BLUE,
      SPIKE_BLUE
    })
  };
});
