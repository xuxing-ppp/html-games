(function initializeRock(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createRockPlugin({ resolveArenaGeometry, registerBall }) {
  // 岩石：撞墙时从墙面长出一根横贯场地的岩柱。柱子宽度固定为三个小球，
  // 长度持续增长，顶到对面墙（或另一根柱子的侧面）就碎掉。
  // 岩柱本身只有碰撞体积，不造成任何伤害；只有把敌人挤压到无处可去时才
  // 会碾压（13 点伤害），并立刻碎裂。
  const CRUSH_DAMAGE = 13;
  // 宽度 = 三个小球（球体直径 30，与 roster 尺寸契约一致）。
  const BALL_DIAMETER = 30;
  const PILLAR_HALF_WIDTH = BALL_DIAMETER * 3 / 2;
  const GROWTH_SPEED = 190;
  // 贴墙残留余量：小球必须真的被顶在墙上才算被挤压，而不是恰好路过。
  const ESCAPE_CLEARANCE = 0.5;
  // 柱体碰撞响应把小球分离到表面距离，浮点误差与一步推进量都在这个量级内，
  // 所以"贴着柱体表面"的判定要留一点容差。
  const SEPARATION_TOLERANCE = 0.05;
  const MAX_PILLAR_LIFE_SECONDS = 6;
  // 碾压是岩石唯一的攻击动作：一次短促重震把"压碎"和普通顶墙碎裂区分开。
  // 震动时长上限由 ArenaShake 钳在 0.1s，这里直接取满。
  const CRUSH_SHAKE_INTENSITY = 5.5;
  const CRUSH_SHAKE_SECONDS = 0.1;
  const EPSILON = 1e-9;
  // 柱子是刚体：整根从墙里被挤出来，岩面跟着柱头一起平移（见 drawStoneStrata
  // 的 offsetX）。所以"柱身拖尾"这种说法不成立——刚体表面不会往后流。
  // 位移证据只有两种，都在柱身之外：贴在柱体两侧落地的碎屑（留在生成位置不
  // 再动），以及柱头正前方被顶碎的新屑。数量与相位由 age / growRate 推导，
  // 不持有状态、不消费随机。
  const WAKE_TRAIL_SPACING = 14;
  const WAKE_TRAIL_COUNT = 8;
  const WAKE_TRAIL_LIFE = 0.34;
  const HEAD_SPRAY_CYCLE = 0.16;
  const HEAD_DEPTH_MIN = 10;
  const HEAD_DEPTH_MAX = 22;

  // 纯色球体保留；岩柱用偏暖的玄武岩切面与冷暗断层统一材质。
  const BODY_COLOR = "#777b72";
  const ROCK_BASE = "#646b62";
  const ROCK_LIGHT = "#b8b5a1";
  const ROCK_DARK = "#38433d";
  const ROCK_FACETS = ["#929083", "#a6a190", "#838779", "#6b7465", "#596252"];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function pillarSeed(entity) {
    const text = String(entity.instanceId || "rock-pillar");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    let state = hash >>> 0 || 1;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  // 绘制期用的稳定哈希：同一根柱子的同一缕尘土每帧都落在同一位置，
  // 否则拖尾会自己抖成一团噪点。不读 Math.random。
  // 末尾必须做一次 avalanche：FNV 的原始值高位对"最后一个字符"几乎不敏感，
  // 直接取高位会让所有 index 判到同一侧（拖尾全堆在柱体一边）。
  function hashUnit(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 2246822507);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  function stonePolygon(context, points, color) {
    context.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();
    context.fillStyle = color;
    context.fill();
  }

  // 天然断层使用错位种子切出不规则岩面。只在出生时生成一次，之后既不重算
  // 也不随柱长拉伸：柱身是一整块刚性岩体，绘制时整体跟着柱头平移（岩体从
  // 墙里被挤出来），所以纹样要往墙内多铺一截，负方向也要有料。
  function createStoneFacets(seed, extent) {
    const random = pillarSeed(seed);
    const half = seed.halfWidth;
    const sites = [];
    for (let row = 0; row < 4; row += 1) {
      let x = -extent * 0.62 + random() * 20;
      while (x < extent + 55) {
        sites.push({ x, y: -half + row * half * 2 / 3 + (random() - 0.5) * 24,
          tone: Math.floor(random() * ROCK_FACETS.length), detail: random() });
        x += 24 + random() * 35;
      }
    }
    const facets = [];
    const left = -extent * 0.62 - 60;
    for (const site of sites) {
      let points = [[left, -half], [extent + 60, -half],
        [extent + 60, half], [left, half]];
      for (const other of sites) {
        if (other === site) continue;
        const nx = other.x - site.x;
        const ny = other.y - site.y;
        const limit = (other.x * other.x + other.y * other.y -
          site.x * site.x - site.y * site.y) / 2;
        const clipped = [];
        for (let index = 0; index < points.length; index += 1) {
          const a = points[index];
          const b = points[(index + 1) % points.length];
          const da = a[0] * nx + a[1] * ny - limit;
          const db = b[0] * nx + b[1] * ny - limit;
          if (da <= 0) clipped.push(a);
          if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
            const t = da / (da - db);
            clipped.push([a[0] + (b[0] - a[0]) * t,
              a[1] + (b[1] - a[1]) * t]);
          }
        }
        points = clipped;
        if (points.length === 0) break;
      }
      if (points.length < 3) continue;
      const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length;
      const inner = points.map(([x, y]) => [cx + (x - cx) * 0.93,
        cy + (y - cy) * 0.93]);
      facets.push({ points, inner, cx, cy, tone: site.tone, detail: site.detail,
        minX: Math.min(...points.map(point => point[0])),
        maxX: Math.max(...points.map(point => point[0])) });
    }
    return facets;
  }

  // 岩面整体平移 offsetX：柱身作为刚体跟着柱头走，纹样不是"刷"出来的，
  // 而是从墙里被挤出来的。平移量不会改任何 facet 数据，也不缩放纹理。
  function drawStoneStrata(context, facets, visibleLength, offsetX = 0) {
    context.save();
    context.translate(offsetX, 0);
    for (const facet of facets) {
      if (facet.minX > visibleLength - offsetX) continue;
      if (facet.maxX < -offsetX) continue;
      const { points, inner, cx, cy, tone } = facet;
      stonePolygon(context, points, ROCK_DARK);
      stonePolygon(context, inner, ROCK_FACETS[tone]);
      // 不同朝向的斜切面：大片平面 + 少量锐利折面，而不是规则砖缝。
      for (let index = 0; index < points.length; index += 1) {
        const next = (index + 1) % points.length;
        const a = points[index];
        const b = points[next];
        const isLit = (b[0] - a[0]) - (b[1] - a[1]) > 0;
        stonePolygon(context, [a, b, inner[next], inner[index]],
          isLit ? "#b3ab99" : "#434942");
      }
      if (facet.detail > 0.38) {
        const a = inner[0];
        const b = inner[1];
        stonePolygon(context, [a, b, [cx + 3, cy - 2]],
          tone % 2 ? "#79796d" : "#9d9788");
      }
      if (facet.detail < 0.24) {
        context.beginPath();
        context.moveTo(cx - 8, cy - 4);
        context.lineTo(cx - 2, cy - 1);
        context.lineTo(cx + 4, cy - 3);
        context.lineTo(cx + 8, cy + 1);
        context.strokeStyle = "rgba(32, 36, 31, 0.48)";
        context.lineWidth = 0.6;
        context.stroke();
      }
    }
    context.restore();
  }

  // 完全无战斗身份的破岩残片；初始位置覆盖整根柱身，而不是中心撒纸屑。
  function createRockDebris(entity) {
    const random = pillarSeed(entity);
    const count = Math.min(42, Math.max(10, Math.ceil(entity.length / 7)));
    const fragments = [];
    for (let index = 0; index < count; index += 1) {
      const along = random() * entity.length;
      const across = (random() * 2 - 1) * entity.halfWidth;
      const angle = random() * Math.PI * 2;
      const speed = 22 + random() * 54;
      fragments.push({
        x: entity.baseX + entity.axisX * along - entity.axisY * across,
        y: entity.baseY + entity.axisY * along + entity.axisX * across,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: angle,
        spin: (random() - 0.5) * 5,
        size: 4 + random() * 8,
        color: ROCK_FACETS[index % ROCK_FACETS.length]
      });
    }
    return {
      kind: "rock-pillar-fragments",
      life: 0.65,
      drawLayer: "background",
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const travel = (1 - Math.exp(-effect.age * 3)) / 3;
        context.save();
        context.globalAlpha *= Math.pow(1 - progress, 1.5);
        for (const fragment of fragments) {
          context.save();
          context.translate(fragment.x + fragment.vx * travel,
            fragment.y + fragment.vy * travel);
          context.rotate(fragment.rotation + fragment.spin * effect.age);
          const size = fragment.size * (1 - progress * 0.35);
          stonePolygon(context, [[-size, -size * 0.3], [-size * 0.2, -size * 0.75],
            [size * 0.8, -size * 0.4], [size * 0.6, size * 0.55],
            [-size * 0.5, size * 0.6]], fragment.color);
          stonePolygon(context, [[-size * 0.2, -size * 0.75], [size * 0.8, -size * 0.4],
            [size * 0.6, 0], [-size * 0.1, -size * 0.25]], ROCK_LIGHT);
          context.restore();
        }
        context.restore();
      }
    };
  }

  // 碾压瞬间的冲击波。被压的球总在柱头正前方，所以"朝场内"就是生长方向的
  // 反方向：冲击环、石裂与碎石都必须往这一侧走，否则会直接画进墙里被裁掉。
  // 环心从球心往场内偏一点，避免整圈被球体压住；裂缝压在球底，只露出球缘外
  // 的部分。所有随机都在生成时用完，draw 不碰战斗随机。
  function createCrushImpact(entity, victim) {
    const heading = Math.atan2(entity.axisY, entity.axisX) + Math.PI;
    const centreX = victim.x + Math.cos(heading) * victim.radius * 0.55;
    const centreY = victim.y + Math.sin(heading) * victim.radius * 0.55;
    const random = pillarSeed({ instanceId: `${entity.instanceId}:crush-impact` });
    // 冲击环不做成完美圆弧：预生成一圈固定抖动，扩散时整体放大，
    // 保持"同一块岩石裂开"的形状而不是几何圆。
    const ring = [];
    for (let index = 0; index <= 14; index += 1) {
      ring.push({
        angle: heading - Math.PI * 0.56 + index / 14 * Math.PI * 1.12,
        jitter: 0.9 + random() * 0.2
      });
    }
    const cracks = [];
    for (let index = 0; index < 7; index += 1) {
      const angle = heading + (index / 6 - 0.5) * Math.PI * 0.9;
      const start = victim.radius * 0.8 + random() * 3;
      const reach = 20 + random() * 30;
      const points = [];
      for (let step = 0; step <= 3; step += 1) {
        const distance = start + (reach - start) * step / 3;
        const drift = (random() - 0.5) * 8 * step;
        points.push([
          Math.cos(angle) * distance - Math.sin(angle) * drift,
          Math.sin(angle) * distance + Math.cos(angle) * drift
        ]);
      }
      cracks.push(points);
    }
    return {
      kind: "rock-crush-impact",
      life: 0.4,
      drawLayer: "background",
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const ease = 1 - Math.pow(1 - progress, 2);
        context.save();
        context.globalAlpha *= Math.pow(1 - progress, 1.2);
        // 贴地半环：从球面外冲到半个身位外，同时快速变细。
        context.strokeStyle = "rgba(226, 217, 190, 0.95)";
        context.lineWidth = 4.4 - ease * 3;
        context.beginPath();
        const ringRadius = victim.radius * 0.6 + ease * 44;
        ring.forEach((segment, index) => {
          const radius = ringRadius * segment.jitter;
          const x = centreX + Math.cos(segment.angle) * radius;
          const y = centreY + Math.sin(segment.angle) * radius;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
        // 向外炸开的石裂：起点压在球体内，只露出球缘之外的部分。
        context.strokeStyle = "rgba(52, 58, 48, 0.75)";
        context.lineWidth = 1.6 - progress * 0.4;
        for (const points of cracks) {
          context.beginPath();
          context.moveTo(centreX + points[0][0], centreY + points[0][1]);
          for (let index = 1; index < points.length; index += 1) {
            context.lineTo(centreX + points[index][0], centreY + points[index][1]);
          }
          context.stroke();
        }
        context.restore();
      }
    };
  }

  // 柱体：从 base 沿 +axis 延伸 length，宽度固定 3 个小球。
  // 几何用轴对齐矩形描述：矩形是干净的碰撞体，圆角只在绘制时使用。
  function pillarBox(entity) {
    const axisX = entity.axisX;
    const axisY = entity.axisY;
    const halfWidth = entity.halfWidth;
    const tipX = entity.baseX + axisX * entity.length;
    const tipY = entity.baseY + axisY * entity.length;
    if (axisX !== 0) {
      return {
        minX: Math.min(entity.baseX, tipX),
        maxX: Math.max(entity.baseX, tipX),
        minY: entity.baseY - halfWidth,
        maxY: entity.baseY + halfWidth
      };
    }
    return {
      minX: entity.baseX - halfWidth,
      maxX: entity.baseX + halfWidth,
      minY: Math.min(entity.baseY, tipY),
      maxY: Math.max(entity.baseY, tipY)
    };
  }

  // 柱体视觉上可以越过墙面画出去，但碰撞体只在场内生效：否则贴墙柱子的
  // 侧向宽度会延伸到场外，把"贴着这面墙"的小球误判成四个方向都走不动。
  function clampBoxToArena(box, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    return { minX: Math.max(box.minX, arena.left), maxX: Math.min(box.maxX, arena.right),
      minY: Math.max(box.minY, arena.top), maxY: Math.min(box.maxY, arena.bottom) };
  }

  // 柱体作为胶囊（长轴线段 + 半柱宽），用于判定小球是"在柱头正前方"
  // 还是"贴着柱身侧面"。
  function pillarCapsule(entity, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const start = arena.clampPoint(entity.baseX, entity.baseY);
    const length = arena.movementLimit(start.x, start.y, entity.axisX, entity.axisY, entity.length);
    return { startX: start.x, startY: start.y, endX: start.x + entity.axisX * length,
      endY: start.y + entity.axisY * length };
  }

  function closestPointOnBox(pointX, pointY, box) {
    return {
      x: clamp(pointX, box.minX, box.maxX),
      y: clamp(pointY, box.minY, box.maxY)
    };
  }

  // 岩柱是实心轴对齐矩形碰撞体。小球与矩形重叠时按下面三条把它顶回柱体外面：
  //   1. 球心落在柱体走廊里，而且柱体已经扫到它（球心在矩形内，或贴住柱头面）
  //      → 沿生长方向顶出去。柱体是一面推进中的墙，挤压方向就是生长方向。
  //   2. 球心落在走廊里，但柱体还没扫到它（球心在长轴之外）→ 从较近的那条
  //      长边顶回走廊外，长轴坐标不变。
  //   3. 球心在走廊之外擦到柱身 → 同样从较近的那条长边弹开，长轴坐标不变；
  //      所以从侧面撞上来的小球只会被弹开，不会被柱子顺着拖走。
  // 只有角落接触（圆心与矩形两轴都不重叠）才用最近点法线分离。
  // 返回 null 表示没有重叠。
  function pillarSolidCollision(ball, entity, box) {
    const alongAxisX = entity.axisX !== 0;
    // 出生瞬间长度还是 0，没有体积可言；退化的矩形不可能真的压住东西。
    if (box.maxX - box.minX <= EPSILON || box.maxY - box.minY <= EPSILON) return null;
    const insideX = ball.x >= box.minX && ball.x <= box.maxX;
    const insideY = ball.y >= box.minY && ball.y <= box.maxY;
    const lateralLowDistance = (alongAxisX
      ? ball.y - box.minY
      : ball.x - box.minX) + ball.radius;
    const lateralHighDistance = (alongAxisX
      ? box.maxY - ball.y
      : box.maxX - ball.x) + ball.radius;
    if (!insideX && !insideY) {
      // 角落接触：按最近点法线分离。横向分离距离非正说明根本没有重叠。
      const closestX = clamp(ball.x, box.minX, box.maxX);
      const closestY = clamp(ball.y, box.minY, box.maxY);
      const dx = ball.x - closestX;
      const dy = ball.y - closestY;
      const length = Math.hypot(dx, dy);
      if (length >= ball.radius - EPSILON) return null;
      if (lateralLowDistance <= 0 || lateralHighDistance <= 0) return null;
      if (length <= EPSILON) {
        const distance = Math.min(lateralLowDistance, lateralHighDistance);
        const sign = lateralLowDistance < lateralHighDistance ? -1 : 1;
        return alongAxisX
          ? { nx: 0, ny: sign, distance }
          : { nx: sign, ny: 0, distance };
      }
      return { nx: dx / length, ny: dy / length, distance: ball.radius - length };
    }
    const alongMin = alongAxisX ? box.minX : box.minY;
    const alongMax = alongAxisX ? box.maxX : box.maxY;
    const alongValue = alongAxisX ? ball.x : ball.y;
    const tipIsHigh = entity.axisX > 0 || entity.axisY > 0;
    const tip = tipIsHigh ? alongMax : alongMin;
    // 长轴坐标换算到"朝柱头为正"的坐标系。
    const tipGap = tipIsHigh ? tip - alongValue : alongValue - tip;
    // 球心是否落在柱体的横向走廊里。
    const lateralMin = alongAxisX ? box.minY : box.minX;
    const lateralMax = alongAxisX ? box.maxY : box.maxX;
    const lateralValue = alongAxisX ? ball.y : ball.x;
    const inBand = lateralValue >= lateralMin && lateralValue <= lateralMax;
    const exitHigh = lateralHighDistance < lateralLowDistance;
    const exitSign = exitHigh ? 1 : -1;
    const exitDistance = exitHigh ? lateralHighDistance : lateralLowDistance;

    // 球心落在柱体走廊里：柱体是一面沿生长方向推进的墙，整颗球只能被它往前
    // 顶着走（从走廊里横着把球挤出去不是这根柱子的行为）。
    if (inBand) {
      const alongDistance = tipGap + ball.radius;
      if (alongDistance <= EPSILON) return null;
      // 球心已经被柱体包住（柱体扫过它，或者它就贴在柱头面上）：柱体是一面
      // 沿生长方向推进的墙，它只能被往前顶。
      const enclosed = insideX && insideY;
      if (enclosed || (tipGap >= -ball.radius && tipGap <= ball.radius)) {
        return {
          nx: alongAxisX ? (tipIsHigh ? 1 : -1) : 0,
          ny: alongAxisX ? 0 : (tipIsHigh ? 1 : -1),
          distance: alongDistance
        };
      }
      // 球心还在柱体长轴之外（横向撞进来的半成品重叠）：从较近的那条长边
      // 把它弹回走廊外，不改变长轴坐标。
    } else if (lateralLowDistance <= 0 || lateralHighDistance <= 0) {
      return null;
    }
    // 球心在走廊之外擦到柱身：从较近的那条长边把它弹开，不改变长轴坐标。
    if (lateralLowDistance <= 0 || lateralHighDistance <= 0) return null;
    return alongAxisX
      ? { nx: 0, ny: exitSign, distance: exitDistance }
      : { nx: exitSign, ny: 0, distance: exitDistance };
  }

  // 小球有没有真的贴上柱体表面（含恰好贴合：碰撞响应把球分离到表面距离，
  // 所以要留一点容差，否则刚好被顶开的小球永远等不到碾压判定）。
  function isTouchingPillar(ball, box) {
    const closestX = clamp(ball.x, box.minX, box.maxX);
    const closestY = clamp(ball.y, box.minY, box.maxY);
    return Math.hypot(ball.x - closestX, ball.y - closestY) <=
      ball.radius + SEPARATION_TOLERANCE;
  }

  const rockDefinition = {
    id: "rock",
    name: "\u5ca9\u77f3",
    englishName: "Rock",
    color: BODY_COLOR,
    description: "撞墙长出岩柱 / 只挤不伤 / 无路可逃时碾压13",
    stats: {
      radius: 15,
      speed: 160,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      // 同一颗岩石的所有岩柱共享这一份列表：新柱子判定"顶到另一根柱子
      // 侧面"时用它，柱子碎裂时把自己摘掉。
      const pillars = [];

      function prunePillars() {
        for (let index = pillars.length - 1; index >= 0; index -= 1) {
          if (pillars[index].entityActive === false) pillars.splice(index, 1);
        }
      }

      // 生长段是否顶到另一根柱子的侧面。两根柱子都是轴对齐的长条，所以按
      // 长轴参数化：只要生长段在对方长轴上的投影落进对方的实体范围，并且在
      // 宽度方向真的挨上（中心距 < 两者半宽之和），就是"顶到侧面了"。
      function growthBlocked(entity, fromX, fromY, toX, toY) {
        prunePillars();
        for (const other of pillars) {
          if (other === entity || other.entityActive === false) continue;
          const box = pillarBox(other);
          const axisX = entity.axisX !== 0;
          const otherAxisX = other.axisX !== 0;
          // 沿本柱长轴：本柱这一段（到柱头 to 为止）在长轴上的区间。
          const tip = axisX ? toX : toY;
          const start = axisX ? fromX : fromY;
          // 另一根柱子在宽度方向占用的区间（它的中线和半宽，垂直于它的长轴）。
          const laneCentre = otherAxisX
            ? (box.minY + box.maxY) / 2
            : (box.minX + box.maxX) / 2;
          const laneHalf = otherAxisX
            ? (box.maxY - box.minY) / 2
            : (box.maxX - box.minX) / 2;
          // 本柱自身的走廊中线与另一根柱子的走廊中线：中心距必须小于两者半宽
          // 之和，才算真的在宽度方向挨上。
          const ownCentre = axisX ? fromY : fromX;
          if (Math.abs(ownCentre - laneCentre) >= entity.halfWidth + laneHalf) continue;
          // 另一根柱子沿本柱长轴覆盖的实体区间（柱根到柱头，都是实体）。
          const otherTip = otherAxisX
            ? box.maxX * Math.sign(other.axisX)
            : box.maxY * Math.sign(other.axisY);
          const otherBase = otherAxisX
            ? (other.axisX > 0 ? box.minX : box.maxX)
            : (other.axisY > 0 ? box.minY : box.maxY);
          const solidLow = Math.min(otherBase, otherTip);
          const solidHigh = Math.max(otherBase, otherTip);
          if (tip < solidLow || start > solidHigh) continue;
          return true;
        }
        return false;
      }

      // 小球朝 direction 方向还能走多远：负值表示已经贴在墙或柱子侧面上。
      function escapeDistance(ball, entity, directionX, directionY, arenaSize) {
        let distance = resolveArenaGeometry(arenaSize).movementLimit(ball.x, ball.y, directionX, directionY, Infinity);
        for (const other of pillars) {
          if (other === entity || other.entityActive === false) continue;
          const box = pillarBox(other);
          // 只有柱子真的挡在行进轴上时才算阻挡。
          if (directionX !== 0 && ball.y >= box.minY && ball.y <= box.maxY) {
            const limit = directionX > 0 ? box.minX : box.maxX;
            distance = Math.min(distance, (limit - ball.x) * directionX);
          }
          if (directionY !== 0 && ball.x >= box.minX && ball.x <= box.maxX) {
            const limit = directionY > 0 ? box.minY : box.maxY;
            distance = Math.min(distance, (limit - ball.y) * directionY);
          }
        }
        return distance;
      }

      // 退路只考虑四个正交方向：岩柱是轴对齐的实体，斜向让位仍然会被柱体
      // 压住，不属于"有路可走"。
      const ESCAPE_DIRECTIONS = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ];

      // 柱头最远够得着的地方：柱头前方"一个生长步 + 两个球半径"以内都算
      // 正在被顶——柱子下一步就会压上来。不在柱体走廊里的小球返回 false。
      function isInPillarPath(ball, entity, arenaSize) {
        const capsule = pillarCapsule(entity, arenaSize);
        const tipX = capsule.endX;
        const tipY = capsule.endY;
        const alongOffset = entity.axisX !== 0
          ? (tipX - ball.x) * entity.axisX
          : (tipY - ball.y) * entity.axisY;
        const lateralOffset = entity.axisX !== 0
          ? Math.abs(ball.y - capsule.startY)
          : Math.abs(ball.x - capsule.startX);
        // 只算"球心落在柱体走廊内"的小球：走廊边上擦过去的球不会被压住。
        if (lateralOffset > entity.halfWidth) return false;
        const reach = entity.growthSpeed * (1 / 60) + ball.radius * 2 + ESCAPE_CLEARANCE;
        return alongOffset >= -ball.radius && alongOffset <= reach;
      }

      // 从 (x, y) 放下一个球心位置的圆，会不会碰到墙或任何一根柱子。
      // 用精确的"点到柱体矩形 + 半径"判定：柱体表面就是碰撞面，圆柱头部分
      // 也自然包含在内。
      function clearAt(x, y, radius, arenaSize, ignore) {
        if (!resolveArenaGeometry(arenaSize).contains(x, y, radius)) return false;
        for (const pillar of pillars) {
          if (pillar === ignore || pillar.entityActive === false) continue;
          const box = pillarBox(pillar);
          const closestX = clamp(x, box.minX, box.maxX);
          const closestY = clamp(y, box.minY, box.maxY);
          if (Math.hypot(x - closestX, y - closestY) < radius - EPSILON) return false;
        }
        return true;
      }

      // 小球朝 direction 让开 distance 之后，落脚点是不是完全空着。
      // 判定时忽略本柱：小球本来就压在它身上，让开正是要离开它。
      function canEscape(ball, entity, directionX, directionY, distance, arenaSize) {
        return clearAt(
          ball.x + directionX * distance,
          ball.y + directionY * distance,
          ball.radius,
          arenaSize,
          entity
        );
      }

      // 小球在"柱体推进的那条轴"上朝着 direction 还能走多远，只看墙和别的
      // 柱子——本柱正是推它的那一根，不该再算成障碍。
      function obstacleRoom(ball, entity, directionX, directionY, arenaSize) {
        let room = resolveArenaGeometry(arenaSize).movementLimit(ball.x, ball.y, directionX, directionY, Infinity);
        for (const other of pillars) {
          if (other === entity || other.entityActive === false) continue;
          const box = pillarBox(other);
          if (directionX !== 0 && ball.y >= box.minY && ball.y <= box.maxY) {
            room = Math.min(room, ((directionX > 0 ? box.minX : box.maxX) - ball.x) * directionX);
          }
          if (directionY !== 0 && ball.x >= box.minX && ball.x <= box.maxX) {
            room = Math.min(room, ((directionY > 0 ? box.minY : box.maxY) - ball.y) * directionY);
          }
        }
        return room;
      }

      // 小球是否已经被这根岩柱碾死。按需求的两句话判定：
      //  - 岩柱正在挤压它：柱体已经贴上它，而且它就落在柱头的行进走廊里；
      //  - 它无处可去：在挤压轴上，身后被墙（或另一根柱子的侧面）挡住，
      //    连一个球半径的退路都没有；前方同样放不下整颗球。
      // 只要还能被柱头推着走，哪怕只是沿柱身滑开，都不算碾压。
      // 小球朝 direction 挪一个球半径，会不会被墙或别的柱子挡住。
      // 只看本柱之外的障碍：本柱正是把它顶住的那一根，小球挪开就是要离开它。
      function displacementBlocked(ball, entity, directionX, directionY, arenaSize) {
        // 允许 ESCAPE_CLEARANCE 的贴合余量：紧贴墙面的小球正好只剩一个球半径
        // 可以走，那就是"已经到头了"，不该算还有身位。
        return obstacleRoom(ball, entity, directionX, directionY, arenaSize) <
          ball.radius + ESCAPE_CLEARANCE;
      }

      // 小球是否已经被这根岩柱碾死。按需求的两句话判定：
      //  - 岩柱正在挤压它：柱体已经贴上它，而且它就卡在柱头的行进走廊里；
      //  - 它无处可去：四个正交方向里至少有一个整颗球退不开——被墙或另一根
      //    柱子的侧面堵死，柱子把它压在那上面。
      // 四周都还有身位的小球只是被推开，不算碾压。
      function isPinned(ball, entity, arenaSize) {
        if (!isInPillarPath(ball, entity, arenaSize)) return false;
        if (!isTouchingPillar(ball, pillarBox(entity))) return false;
        for (const [directionX, directionY] of ESCAPE_DIRECTIONS) {
          if (displacementBlocked(ball, entity, directionX, directionY, arenaSize)) {
            return true;
          }
        }
        return false;
      }

      function shatterPillar(entity, reason, victim) {
        if (entity.entityActive === false) return;
        entity.entityActive = false;
        prunePillars();
        services.spawnVisualEffect(createRockDebris(entity));
        const tipX = entity.baseX + entity.axisX * entity.length;
        const tipY = entity.baseY + entity.axisY * entity.length;
        // 碾压是命中：碎石从被压球表面朝场内炸开，再叠一次重震与贴地冲击。
        // 顶墙/顶柱子只是柱体寿终，保持原来的轻量碎裂。
        const crush = reason === "crush" && Boolean(victim);
        services.spawnParticleBurst({
          kind: "rock-pillar-shatter",
          x: crush ? victim.x : tipX,
          y: crush ? victim.y : tipY,
          colors: [ROCK_LIGHT, ROCK_DARK],
          shape: crush ? "rect" : "circle",
          count: crush ? 26 : 12,
          minDiameter: 0.8,
          maxDiameter: crush ? 3.2 : 2.2,
          initialRadius: crush ? victim.radius + 3 : 2,
          minSpeed: crush ? 46 : 24,
          maxSpeed: crush ? 118 : 70,
          life: crush ? 0.5 : 0.35,
          drag: crush ? 3.2 : 4,
          // 碾压时碎石往场内炸；顶墙/顶柱子的普通碎裂保持原来的全向四散。
          directionAngle: Math.atan2(entity.axisY, entity.axisX) + (crush ? Math.PI : 0),
          directionSpread: Math.PI,
          random: pillarSeed(crush
            ? { instanceId: `${entity.instanceId}:crush-burst` }
            : entity)
        }, { drawLayer: "background" });
        if (crush) {
          services.shakeArena({
            intensity: CRUSH_SHAKE_INTENSITY,
            duration: CRUSH_SHAKE_SECONDS
          });
          services.spawnVisualEffect(createCrushImpact(entity, victim));
        }
      }

      function spawnPillar(ball, axisX, axisY, arenaSize) {
        // 柱根贴墙：柱子必须真的从墙面长出来。撞墙那一步引擎把球心修正到了
        // radius 处，所以柱子中线要按半柱宽往里收，否则贴墙的柱子会把整条
        // 柱宽伸到场外，贴墙的小球也永远等不到柱体压过来。
        // 沿生长方向的那一轴取墙面坐标，另一轴取收进来的中线坐标。
        const halfWidth = PILLAR_HALF_WIDTH;
        const arena = resolveArenaGeometry(arenaSize);
        const lane = arena.clampPoint(ball.x, ball.y, halfWidth);
        const reach = arena.movementLimit(lane.x, lane.y, -axisX, -axisY, Infinity);
        const baseX = lane.x - axisX * reach;
        const baseY = lane.y - axisY * reach;
        const entity = services.spawnCombatEntity({
          kind: "rock-pillar",
          combatKind: "zone",
          // 按生长速度估算的最长存活时间，保证任何情况下都会自然收掉，
          // 而不是靠 MAX_SAFE_INTEGER 永久留场。
          life: MAX_PILLAR_LIFE_SECONDS,
          // 独立生命周期：岩柱是场上的实体障碍，碎裂与岩石本体生死无关。
          lifecycle: "independent",
          drawLayer: "background",
          axisX,
          axisY,
          baseX,
          baseY,
          length: 0,
          halfWidth: PILLAR_HALF_WIDTH,
          growthSpeed: GROWTH_SPEED,
          ownerBall: ball,
          stoneFacets: createStoneFacets({
            instanceId: `${ball.instanceId}:${axisX}:${axisY}:${services.getTime()}`,
            halfWidth
          }, arena.size * 2),
          update({ entity: pillar, game }, dt) {
            updatePillar(pillar, game, dt);
          },
          draw({ entity: pillar }, canvasContext) {
            drawPillar(pillar, canvasContext);
          }
        });
        if (entity) {
          pillars.push(entity);
          services.spawnParticleBurst({
            kind: "rock-pillar-spawn",
            x: baseX,
            y: baseY,
            colors: [ROCK_LIGHT, ROCK_DARK],
            shape: "rect",
            count: 16,
            minDiameter: 1,
            maxDiameter: 3.4,
            initialRadius: halfWidth * 0.65,
            minSpeed: 22,
            maxSpeed: 58,
            life: 0.42,
            drag: 3.6,
            directionAngle: Math.atan2(axisY, axisX),
            directionSpread: Math.PI * 0.7,
            random: pillarSeed(entity)
          }, { drawLayer: "background" });
          // 贴墙根扬起的细尘：让"破墙起柱"有落点，而不是一簇石头凭空出现。
          services.spawnParticleBurst({
            kind: "rock-pillar-dust",
            x: baseX,
            y: baseY,
            colors: ["#8f8b7d", "#71766a"],
            count: 18,
            minDiameter: 1.4,
            maxDiameter: 4.2,
            initialRadius: halfWidth * 0.55,
            minSpeed: 12,
            maxSpeed: 38,
            life: 0.55,
            drag: 5.5,
            directionAngle: Math.atan2(axisY, axisX),
            directionSpread: Math.PI * 0.55,
            random: pillarSeed({ instanceId: `${entity.instanceId}:dust` })
          }, { drawLayer: "background" });
        }
        return entity;
      }

      function updatePillar(entity, game, dt) {
        const step = Math.max(0, dt);
        const arenaSize = resolveArenaGeometry(game);
        const halfWidth = entity.halfWidth;
        const previousLength = entity.length;

        if (entity.shattered !== true) {
          const startTipX = entity.baseX + entity.axisX * entity.length;
          const startTipY = entity.baseY + entity.axisY * entity.length;
          const growth = entity.growthSpeed * step;
          const nextLength = Math.min(entity.length + growth, arenaSize.size * 2);
          const nextTipX = entity.baseX + entity.axisX * nextLength;
          const nextTipY = entity.baseY + entity.axisY * nextLength;
          if (growthBlocked(entity, startTipX, startTipY, nextTipX, nextTipY)) {
            // 顶到另一根柱子的侧面：只碎自己，被顶的那根毫发无伤。
            entity.length = nextLength;
            shatterPillar(entity, "pillar");
          } else {
            entity.length = nextLength;
            const wallDistance = arenaSize.movementLimit(entity.baseX, entity.baseY, entity.axisX, entity.axisY, Infinity);
            if (entity.length >= wallDistance + halfWidth) shatterPillar(entity, "wall");
          }
          // 绘制用的真实推进速度：拖尾强度直接跟着它走。柱子被冻结（测试或
          // 外部停表）时归零，拖尾自动消失，不会留一圈悬空的尘。
          entity.growRate = step > EPSILON
            ? Math.max(0, entity.length - previousLength) / step
            : 0;
          // 用刚长出来的几何体立刻结算一次接触：小球在这一步的位移积分与碰墙
          // 处理之前就知道柱头已经推进到了哪里。
          if (entity.entityActive !== false) {
            resolvePillarContacts(entity, arenaSize, step);
          }
        }
      }

      // 岩石本体 update 先处理已有重叠，岩柱实体 update 再处理积分后与生长后的接触。
      // 每次都只反射入射速度，避免同一步的再次分离把出射方向翻回去。
      function resolvePillarContacts(entity, arenaSize, dt) {
        if (entity.entityActive === false) return;
        entity.contactsResolvedAt = services.getTime();
        const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
        const box = clampBoxToArena(pillarBox(entity), arenaSize);
        const owner = entity.ownerBall;
        services.forEachContactEnemy((ball) => {
          // 岩石本体不进这张表：柱子是它自己从脚下长出来的，压不到自己。
          if (ball === owner || ball.hp <= 0) return;
          // 场外的小球不参与柱体碰撞（正常玩法中不会出现）。
          if (!resolveArenaGeometry(arenaSize).contains(ball.x, ball.y)) return;
          // 实心矩形碰撞体：没有重叠就不做任何事。
          const separation = pillarSolidCollision(ball, entity, box);
          if (!separation) return;

          // 挤压 = 柱体正挤着它，而且四个方向都没有退路：前后是墙或别的柱子，
          // 两侧同样被堵死。这时小球被岩柱压死在墙上（或另一根柱子的侧面上），
          // 碾压 13 点并立刻碎裂。
          if (isInPillarPath(ball, entity, arenaSize) &&
              isPinned(ball, entity, arenaSize)) {
              services.dealDamage(ball, CRUSH_DAMAGE);
            shatterPillar(entity, "crush", ball);
            return;
          }

          // 碾压规则不变；普通接触的物理响应遵守引擎的移动/位置锁。
          if (services.isMovementLocked(ball)) return;

          // 仅反射正在撞入柱面的速度，切向速度与速率不变；柱子生长推到静止或
          // 已离开的球时仍只做位置分离，不持续加速或把出射速度翻回柱体。
          const incoming = ball.vx * separation.nx + ball.vy * separation.ny;
          if (incoming < 0) {
            ball.vx -= 2 * incoming * separation.nx;
            ball.vy -= 2 * incoming * separation.ny;
            ball.storedVx = ball.vx;
            ball.storedVy = ball.vy;
            const speed = Math.hypot(ball.vx, ball.vy);
            ball.speedHeadingX = ball.vx / speed;
            ball.speedHeadingY = ball.vy / speed;
            if (ball.bounceVelocityInitialized) {
              ball.bounceHeadingX = ball.speedHeadingX;
              ball.bounceHeadingY = ball.speedHeadingY;
            }
          }

          // 还有退路：把小球挤出实心柱体，保持"只挤不伤"。平面接触只修正法线轴，
          // 角落接触则同时修正两轴，保证下一步开始时球已完整分离。
          Object.assign(ball, resolveArenaGeometry(arenaSize).clampPoint(
            ball.x + separation.nx * separation.distance,
            ball.y + separation.ny * separation.distance, ball.radius));
        });
      }

      // 柱子从墙里挤出来时，两侧被刮落的碎屑落在地上，落在哪就不再动。
      // 它不是"柱身的拖尾"（刚体表面没有流），而是柱子走过之后留在场上的证物：
      // 位置按"生成里程"定死，柱子继续前进不会带走它。
      //  - 落点必须在柱体外侧（y 从 half 起往外飘），否则会被柱体盖掉；
      //  - 场地是纯黑底，尘必须比底色亮才看得见，深色只会被当成柱子投下的影子。
      function drawPillarWake(canvasContext, entity, half, length, growRate) {
        const intensity = clamp(growRate / GROWTH_SPEED, 0, 1);
        if (intensity <= 0.02) return;
        const id = entity.instanceId;
        // 侧向崩落的碎屑：按固定的"生成里程"铺在走过的路上。
        const trailStart = Math.floor(length / WAKE_TRAIL_SPACING) * WAKE_TRAIL_SPACING;
        for (let index = 0; index < WAKE_TRAIL_COUNT; index += 1) {
          const emit = trailStart - index * WAKE_TRAIL_SPACING;
          if (emit < 6) continue;
          const chipAge = (length - emit) / Math.max(growRate, 1);
          if (chipAge > WAKE_TRAIL_LIFE) continue;
          const noise = hashUnit(`${id}:trail:${emit}`);
          const side = noise > 0.5 ? 1 : -1;
          const drift = (1 - Math.exp(-chipAge * 3.2)) / 3.2;
          const x = emit - drift * 18;
          const y = side * (half + 1 + drift * (40 + noise * 34));
          const size = (1.8 + noise * 2.2) * (1 - chipAge / 0.62);
          const alpha = Math.pow(1 - chipAge / WAKE_TRAIL_LIFE, 0.6) * 0.95 * intensity;
          canvasContext.save();
          canvasContext.translate(x, y);
          canvasContext.rotate(side * (chipAge * 9 + noise * 3));
          stonePolygon(canvasContext, [[-size, -size * 0.4], [size * 0.25, -size * 0.9],
            [size, -size * 0.1], [size * 0.4, size * 0.8], [-size * 0.7, size * 0.5]],
            `rgba(176, 180, 162, ${alpha})`);
          stonePolygon(canvasContext, [[-size, -size * 0.4], [size * 0.25, -size * 0.9],
            [size * 0.3, -size * 0.15], [-size * 0.6, size * 0.1]],
            `rgba(246, 240, 214, ${alpha * 0.9})`);
          canvasContext.restore();
        }
      }

      // 柱头后面这一段的"刚被压碎"区：细碎岩屑全部锚在柱头上，跟着柱头一起
      // 平移。整面岩体本来就在平移（drawStoneStrata 的 offsetX），这里是把
      // "刚被撞开"的亮度信息集中在柱头后一小段，让柱头一带最亮、往后逐级变暗。
      function drawFreshRubble(canvasContext, entity, half, length) {
        const id = entity.instanceId;
        const band = Math.min(84, length * 0.55);
        if (band < 18) return;
        for (let index = 0; index < 30; index += 1) {
          const noise = hashUnit(`${id}:rubble:${index}`);
          const along = Math.pow(noise, 0.75) * band;
          const x = length - 6 - along;
          if (x < 2) continue;
          const y = (hashUnit(`${id}:rubbleY:${index}`) * 2 - 1) * (half - 2);
          const size = 1.4 + hashUnit(`${id}:rubbleS:${index}`) * 3.4;
          const tone = hashUnit(`${id}:rubbleT:${index}`);
          const color = tone > 0.66 ? "#b9b49c" : tone > 0.33 ? "#79796c" : "#4f5a4c";
          canvasContext.save();
          canvasContext.translate(x, y);
          canvasContext.rotate(noise * 6.28);
          stonePolygon(canvasContext, [[-size, -size * 0.5], [size * 0.4, -size],
            [size, 0], [size * 0.3, size * 0.9], [-size * 0.8, size * 0.4]], color);
          canvasContext.restore();
        }
      }

      // 柱头正前方被顶碎的细屑：画在柱体之后，才不会被柱身吞掉。
      function drawHeadSpray(canvasContext, entity, half, length, age, growRate) {
        const intensity = clamp(growRate / GROWTH_SPEED, 0, 1);
        if (intensity <= 0.02) return;
        const id = entity.instanceId;
        for (let index = 0; index < 5; index += 1) {
          const phase = (age / HEAD_SPRAY_CYCLE + index / 5) % 1;
          const noise = hashUnit(`${id}:spray:${index}`);
          const side = index % 2 ? 1 : -1;
          const x = length + phase * (7 + noise * 9);
          const y = side * half * (0.35 + phase * 0.5);
          const size = (1.8 + noise * 1.8) * (1 - phase * 0.7);
          const alpha = (1 - phase) * 0.62 * intensity;
          stonePolygon(canvasContext, [[x - size, y - size * 0.5], [x + size * 0.6, y - size],
            [x + size, y + size * 0.3], [x - size * 0.3, y + size * 0.8]], index % 2
            ? `rgba(216, 209, 186, ${alpha})`
            : `rgba(148, 154, 137, ${alpha})`);
        }
      }

      // 柱头：从一个 9px 的斜角升级成有厚度、有新鲜断口的楔形岩块。
      // 断面顶在碰撞面上（视觉不越过 90 宽的实体），侧面留缺口，读起来是
      // 一块正被往前压碎的岩体，而不是柱子磨平的方角。
      function drawPillarHead(canvasContext, entity, half, length) {
        const depth = Math.min(HEAD_DEPTH_MAX, Math.max(HEAD_DEPTH_MIN, length * 0.4));
        if (length <= depth + 4) {
          // 刚冒头的一小截还没有完整的柱头，但推进面本身要有一道独立笔触。
          canvasContext.beginPath();
          canvasContext.moveTo(length - 1, -half + 2);
          canvasContext.lineTo(length - 3, 0);
          canvasContext.lineTo(length - 1, half - 2);
          canvasContext.strokeStyle = "rgba(24, 36, 26, 0.7)";
          canvasContext.lineWidth = 1.1;
          canvasContext.stroke();
          return;
        }
        const tip = length - depth;
        const random = pillarSeed({ instanceId: `${entity.instanceId}:head` });
        // 柱头后方的压缩阴影：受力区，越靠近断面越暗。
        stonePolygon(canvasContext, [[tip - 5, -half], [tip + 2, -half * 0.94],
          [tip + 2, half * 0.94], [tip - 5, half]], "rgba(24, 31, 25, 0.3)");
        // 新鲜断面附近的岩体整体提亮：一条跟着柱头走的"新岩带"。
        // 柱子是刚体、岩面不动，这条亮带是少数"整段都在位移"的东西，
        // 它扫过哪里，眼睛就读到哪里在被撞开。
        const fresh = Math.min(64, length * 0.5);
        for (let index = 0; index < 7; index += 1) {
          const near = tip - index * fresh / 7;
          const far = near - fresh / 7;
          if (far < 0) break;
          stonePolygon(canvasContext, [[far, -half], [near, -half], [near, half], [far, half]],
            `rgba(232, 224, 198, ${0.15 - index * 0.019})`);
        }
        // 撞头：只比柱身多出一道断面斜角 + 一个缺口，主体仍是柱身那套岩面。
        // 它跟着岩面一起平移，本身不需要画得多夸张——位移由整面岩体承担。
        // 色调刻意比柱身亮一档：断口是刚被压开的新岩，风化层已经被撞掉了。
        const cap = [
          [tip, -half],
          [tip + depth * 0.35, -half * 0.8],
          [length - depth * 0.2, -half * 0.3],
          [length, -half * 0.06],
          [length - depth * 0.3, half * 0.34],
          [tip + depth * 0.4, half * 0.76],
          [tip, half]
        ];
        stonePolygon(canvasContext, cap, "#78806c");
        stonePolygon(canvasContext, [[tip, -half], [tip + depth * 0.35, -half * 0.8],
          [length - depth * 0.16, -half * 0.24], [tip + depth * 0.5, -half * 0.2]],
          "#c6bda2");
        stonePolygon(canvasContext, [[tip + depth * 0.5, -half * 0.2],
          [length - depth * 0.16, -half * 0.24], [length, -half * 0.06],
          [length - depth * 0.34, half * 0.02]], "#9aa18a");
        stonePolygon(canvasContext, [[tip + depth * 0.5, half * 0.02],
          [length - depth * 0.34, half * 0.02], [length - depth * 0.3, half * 0.34],
          [tip + depth * 0.4, half * 0.76], [tip, half]], "#6a7362");
        // 新鲜断口的高光：只描朝前的断面。
        canvasContext.beginPath();
        canvasContext.moveTo(tip + depth * 0.35, -half * 0.8);
        canvasContext.lineTo(length, -half * 0.06);
        canvasContext.lineTo(length - depth * 0.3, half * 0.34);
        canvasContext.strokeStyle = "rgba(234, 228, 206, 0.5)";
        canvasContext.lineWidth = 1.2;
        canvasContext.stroke();
        // 柱头和柱身之间的挤压缝。
        canvasContext.beginPath();
        canvasContext.moveTo(tip, -half + 2);
        canvasContext.lineTo(tip - 3, -half * 0.24);
        canvasContext.lineTo(tip + 2, half * 0.18);
        canvasContext.lineTo(tip, half - 2);
        canvasContext.strokeStyle = "rgba(14, 20, 15, 0.82)";
        canvasContext.lineWidth = 1.7;
        canvasContext.stroke();
        // 从柱头往回延伸的新裂缝：跟着柱头一起走，读作"边走边裂"。
        for (let index = 0; index < 3; index += 1) {
          const baseY = -half * 0.52 + index * half * 0.52;
          const reach = 10 + random() * 15;
          canvasContext.beginPath();
          canvasContext.moveTo(tip + 3, baseY);
          canvasContext.lineTo(tip - reach * 0.5, baseY + (random() - 0.5) * 9);
          canvasContext.lineTo(tip - reach, baseY + (random() - 0.5) * 11);
          canvasContext.strokeStyle = "rgba(30, 37, 29, 0.5)";
          canvasContext.lineWidth = 0.9;
          canvasContext.stroke();
        }
      }

      function drawPillar(entity, canvasContext) {
        const length = entity.length;
        if (length <= EPSILON) return;
        const half = entity.halfWidth;
        const age = Number.isFinite(entity.age) ? entity.age : 0;
        const growRate = Number.isFinite(entity.growRate) ? entity.growRate : 0;
        const bevel = Math.min(4, length / 2);
        canvasContext.save();
        canvasContext.translate(entity.baseX, entity.baseY);
        canvasContext.rotate(Math.atan2(entity.axisY, entity.axisX));
        // 两侧碎屑先画：贴着柱体那部分会被柱身盖掉，只在柱体外侧留下
        // 已经落地的碎块——柱子走过的地方才有，柱子本身不带。
        drawPillarWake(canvasContext, entity, half, length, growRate);
        const outline = [[0, -half]];
        // 小崩口始终收在原来的90宽碰撞面内；步距不跟着柱长一起拉伸。
        // 每 7 个采样点咬掉一块更深的缺口，让侧影整条都是碎的——矩形轮廓
        // 是"纹理笔"观感的主要来源之一。
        const random = pillarSeed(entity);
        let sample = 0;
        for (let x = 18; x < length - bevel; x += 18) {
          const bite = sample % 7 === 3 ? 3 + random() * 4 : 0;
          outline.push([x, -half + random() * 4.2 + bite]);
          sample += 1;
        }
        // 柱头那一端不能切平：平口会从柱头两侧露出来，读成"被锯断的方块"，
        // 位移感立刻消失。这里用一排带 x 抖动的断点收尾，柱头再压在中间。
        const endRandom = pillarSeed({ instanceId: `${entity.instanceId}:end` });
        for (let step = 0; step < 5; step += 1) {
          const y = -half + bevel + step / 4 * (half * 2 - bevel * 2);
          outline.push([Math.max(1, length - 1 - endRandom() * 9), y]);
        }
        const lowerRandom = pillarSeed({ instanceId: `${entity.instanceId}:lower` });
        const lowerEdge = [];
        sample = 0;
        for (let x = 18; x < length - bevel; x += 18) {
          const bite = sample % 9 === 5 ? 3 + lowerRandom() * 5 : 0;
          lowerEdge.push([x, half - lowerRandom() * 4 - bite]);
          sample += 1;
        }
        outline.push(...lowerEdge.reverse());
        outline.push([0, half]);
        stonePolygon(canvasContext, outline, ROCK_BASE);
        canvasContext.strokeStyle = ROCK_DARK;
        canvasContext.lineWidth = 1.2;
        canvasContext.stroke();
        canvasContext.save();
        canvasContext.clip();
        drawStoneStrata(canvasContext, entity.stoneFacets, length, length);
        drawFreshRubble(canvasContext, entity, half, length);
        // 明暗侧缘给出厚度；不使用贯穿全长的胶囊描边或中轴高光。
        stonePolygon(canvasContext, [[0, -half], [length, -half],
          [length - bevel, -half + 3], [0, -half + 3]], ROCK_LIGHT);
        stonePolygon(canvasContext, [[0, half - 6], [length, half - 6],
          [length, half], [0, half]], ROCK_DARK);
        canvasContext.restore();
        drawPillarHead(canvasContext, entity, half, length);
        // 柱头画在柱体裁剪之外：断口的缺口要能压到柱身轮廓以外一点，
        // 才读得出"这里是被撞碎的边"，而不是柱子尽头的花纹。
        drawHeadSpray(canvasContext, entity, half, length, age, growRate);
        canvasContext.restore();
      }

      return {
        update(context, dt) {
          // 岩柱的碰撞响应必须排在引擎的位移积分与碰墙处理之前。正常生长的
          // 柱子已经在 updatePillar 里结算过；这里补上本步没有推进的柱子
          // （例如生长速度被外部冻结），保证静止的柱子同样是实体障碍。
          prunePillars();
          const arenaSize = context.game.arenaSize;
          const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / 60;
          for (const pillar of pillars) {
            if (pillar.contactsResolvedAt === context.game.time) continue;
            resolvePillarContacts(pillar, context.game, step);
          }
        },
        onWallBounce(context) {
          const ball = context.ball;
          const arenaSize = context.game.arenaSize;
          const bouncedX = context.bouncedX === true;
          const bouncedY = context.bouncedY === true;
          if (!bouncedX && !bouncedY) return;
          let axisX = 0;
          let axisY = 0;
          if (bouncedX && !bouncedY) {
            axisX = ball.x <= arenaSize / 2 ? 1 : -1;
          } else if (bouncedY && !bouncedX) {
            axisY = ball.y <= arenaSize / 2 ? 1 : -1;
          } else {
            // 角落同时撞两面墙：沿入射速度更大的那个轴生长。
            const horizontalSpeed = Math.abs(ball.storedVx);
            const verticalSpeed = Math.abs(ball.storedVy);
            if (horizontalSpeed >= verticalSpeed) {
              axisX = ball.x <= arenaSize / 2 ? 1 : -1;
            } else {
              axisY = ball.y <= arenaSize / 2 ? 1 : -1;
            }
          }
          spawnPillar(ball, axisX, axisY, context.game);
        },
        onDeath() {
          for (const pillar of pillars) pillar.entityActive = false;
          pillars.length = 0;
        },
        onBorrowEnd() {
          for (const pillar of pillars) pillar.entityActive = false;
          pillars.length = 0;
        },
        getRockState() {
          prunePillars();
          return {
            pillars: pillars.map((pillar) => ({
              axisX: pillar.axisX,
              axisY: pillar.axisY,
              baseX: pillar.baseX,
              baseY: pillar.baseY,
              length: pillar.length,
              halfWidth: pillar.halfWidth,
              active: pillar.entityActive !== false
            }))
          };
        }
      };
    }
  };

  registerBall(rockDefinition);

  return { rockDefinition, ROCK_CRUSH_DAMAGE: CRUSH_DAMAGE };
});
