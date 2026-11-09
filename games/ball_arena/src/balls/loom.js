(function initializeLoom(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLoomPlugin({ resolveArenaGeometry, getArenaWallContacts, registerBall }) {
  const BODY_COLOR = "#805626";
  // 布线没有时限：每碰一次壁就接着上一段拉出一根新线，一直织下去。
  // 端点从开局就在边缘上走，20 秒内线性加速到 400，之后匀速。
  const RAMP_DURATION = 25;
  const MAX_SLIDE_SPEED = 350;
  const THREAD_DAMAGE = 1;
  const THREAD_WIDTH = 2;
  const THREAD_HALF_WIDTH = THREAD_WIDTH / 2;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const EDGE_ALPHA = 0.85;
  // 暖色纱线：颜色只做编织层次，不暗示伤害；线宽始终保持 2。
  const THREAD_COLORS = Object.freeze(["#d6bd8c", "#c49a5a", "#a9793e"]);
  const THREAD_ACCENTS = Object.freeze(["#6b4a22", "#5a3a18", "#3f2a12"]);
  // 人字纹只在线宽内部展开：法向 0.55 + 半笔宽 0.275 < 1，不会把线看宽。
  const THREAD_TICK_SPACING = 4;
  const THREAD_TICK_HALF_NORMAL = 0.55;
  const THREAD_TICK_HALF_LONGITUDINAL = 0.3;
  const THREAD_TICK_WIDTH = 0.55;
  const THREAD_KNOT_RADIUS = 1.35;
  const THREAD_KNOT_WIDTH = 0.55;
  const TWO_PI = Math.PI * 2;

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function pointToSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const segmentX = endX - startX;
    const segmentY = endY - startY;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON * EPSILON) {
      const deltaX = pointX - startX;
      const deltaY = pointY - startY;
      return deltaX * deltaX + deltaY * deltaY;
    }
    const progress = Math.max(0, Math.min(1, (
      (pointX - startX) * segmentX + (pointY - startY) * segmentY
    ) / lengthSquared));
    const deltaX = pointX - (startX + segmentX * progress);
    const deltaY = pointY - (startY + segmentY * progress);
    return deltaX * deltaX + deltaY * deltaY;
  }

  function pointLiesOnSegment(pointX, pointY, startX, startY, endX, endY) {
    return (
      pointX >= Math.min(startX, endX) - EPSILON &&
      pointX <= Math.max(startX, endX) + EPSILON &&
      pointY >= Math.min(startY, endY) - EPSILON &&
      pointY <= Math.max(startY, endY) + EPSILON
    );
  }

  function segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY) {
    const abX = bX - aX;
    const abY = bY - aY;
    const cdX = dX - cX;
    const cdY = dY - cY;
    const cSide = crossProduct(abX, abY, cX - aX, cY - aY);
    const dSide = crossProduct(abX, abY, dX - aX, dY - aY);
    const aSide = crossProduct(cdX, cdY, aX - cX, aY - cY);
    const bSide = crossProduct(cdX, cdY, bX - cX, bY - cY);
    if (
      ((cSide > EPSILON && dSide < -EPSILON) || (cSide < -EPSILON && dSide > EPSILON)) &&
      ((aSide > EPSILON && bSide < -EPSILON) || (aSide < -EPSILON && bSide > EPSILON))
    ) return true;
    return (
      (Math.abs(cSide) <= EPSILON && pointLiesOnSegment(cX, cY, aX, aY, bX, bY)) ||
      (Math.abs(dSide) <= EPSILON && pointLiesOnSegment(dX, dY, aX, aY, bX, bY)) ||
      (Math.abs(aSide) <= EPSILON && pointLiesOnSegment(aX, aY, cX, cY, dX, dY)) ||
      (Math.abs(bSide) <= EPSILON && pointLiesOnSegment(bX, bY, cX, cY, dX, dY))
    );
  }

  function segmentDistanceSquared(aX, aY, bX, bY, cX, cY, dX, dY) {
    if (segmentsIntersect(aX, aY, bX, bY, cX, cY, dX, dY)) return 0;
    return Math.min(
      pointToSegmentDistanceSquared(aX, aY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(bX, bY, cX, cY, dX, dY),
      pointToSegmentDistanceSquared(cX, cY, aX, aY, bX, bY),
      pointToSegmentDistanceSquared(dX, dY, aX, aY, bX, bY)
    );
  }

  function pointLiesInTriangle(pointX, pointY, aX, aY, bX, bY, cX, cY) {
    const area = crossProduct(bX - aX, bY - aY, cX - aX, cY - aY);
    if (Math.abs(area) <= EPSILON) return false;
    const sideAB = crossProduct(bX - aX, bY - aY, pointX - aX, pointY - aY);
    const sideBC = crossProduct(cX - bX, cY - bY, pointX - bX, pointY - bY);
    const sideCA = crossProduct(aX - cX, aY - cY, pointX - cX, pointY - cY);
    const hasNegative = sideAB < -EPSILON || sideBC < -EPSILON || sideCA < -EPSILON;
    const hasPositive = sideAB > EPSILON || sideBC > EPSILON || sideCA > EPSILON;
    return !(hasNegative && hasPositive);
  }

  // 出伤判定完全对齐桔梗（spider-web）的蛛丝判定：
  // 中心穿过、身体贴到、被这一帧扫到，都算一次接触；同一次连续接触只扣一滴。
  function currentlyTouchesThread(target, segment, touchRadius) {
    return pointToSegmentDistanceSquared(
      target.x,
      target.y,
      segment.startX,
      segment.startY,
      segment.endX,
      segment.endY
    ) <= touchRadius * touchRadius;
  }

  function sweepTouchesThread(target, segment, previous, touchRadius) {
    const radiusSquared = touchRadius * touchRadius;
    const minimumX = Math.min(previous.startX, previous.endX, segment.startX, segment.endX)
      - touchRadius;
    const maximumX = Math.max(previous.startX, previous.endX, segment.startX, segment.endX)
      + touchRadius;
    const minimumY = Math.min(previous.startY, previous.endY, segment.startY, segment.endY)
      - touchRadius;
    const maximumY = Math.max(previous.startY, previous.endY, segment.startY, segment.endY)
      + touchRadius;
    if (
      Math.max(target.prevX, target.x) < minimumX ||
      Math.min(target.prevX, target.x) > maximumX ||
      Math.max(target.prevY, target.y) < minimumY ||
      Math.min(target.prevY, target.y) > maximumY
    ) return false;

    // 这根线这一帧扫过的四边形，用两个三角形描述（与蛛丝的三角形判定同源）。
    if (
      pointLiesInTriangle(
        target.prevX, target.prevY,
        previous.startX, previous.startY, previous.endX, previous.endY,
        segment.endX, segment.endY
      ) ||
      pointLiesInTriangle(
        target.prevX, target.prevY,
        previous.startX, previous.startY, segment.endX, segment.endY,
        segment.startX, segment.startY
      ) ||
      pointLiesInTriangle(
        target.x, target.y,
        previous.startX, previous.startY, previous.endX, previous.endY,
        segment.endX, segment.endY
      ) ||
      pointLiesInTriangle(
        target.x, target.y,
        previous.startX, previous.startY, segment.endX, segment.endY,
        segment.startX, segment.startY
      )
    ) return true;

    return (
      segmentDistanceSquared(
        target.prevX, target.prevY, target.x, target.y,
        previous.startX, previous.startY, previous.endX, previous.endY
      ) <= radiusSquared ||
      segmentDistanceSquared(
        target.prevX, target.prevY, target.x, target.y,
        segment.startX, segment.startY, segment.endX, segment.endY
      ) <= radiusSquared ||
      segmentDistanceSquared(
        target.prevX, target.prevY, target.x, target.y,
        previous.startX, previous.startY, segment.startX, segment.startY
      ) <= radiusSquared ||
      segmentDistanceSquared(
        target.prevX, target.prevY, target.x, target.y,
        previous.endX, previous.endY, segment.endX, segment.endY
      ) <= radiusSquared
    );
  }

  function segmentMoved(previous, segment) {
    const startX = segment.startX - previous.startX;
    const startY = segment.startY - previous.startY;
    const endX = segment.endX - previous.endX;
    const endY = segment.endY - previous.endY;
    return (
      startX * startX + startY * startY > EPSILON * EPSILON ||
      endX * endX + endY * endY > EPSILON * EPSILON
    );
  }

  // 场地边缘的弧长坐标：0 在左下角，正方向是 右 -> 上 -> 左 -> 下
  // （也就是屏幕上的逆时针一圈）。所有线的端点都钉在这条边缘上。
  function perimeterPoint(arclength, size) {
    const arena = resolveArenaGeometry(size);
    if (arena.shape === "circle") {
      const angle = Math.PI * 0.75 - arclength / (arena.width / 2);
      return { x: arena.centerX + Math.cos(angle) * arena.width / 2,
        y: arena.centerY + Math.sin(angle) * arena.width / 2 };
    }
    const perimeter = (arena.width + arena.height) * 2;
    let progress = arclength % perimeter;
    if (progress < 0) progress += perimeter;
    if (progress < arena.width) return { x: arena.left + progress, y: arena.bottom };
    progress -= arena.width;
    if (progress < arena.height) return { x: arena.right, y: arena.bottom - progress };
    progress -= arena.height;
    if (progress < arena.width) return { x: arena.right - progress, y: arena.top };
    return { x: arena.left, y: arena.top + progress - arena.width };
  }

  // 边缘点的逆运算：碰壁点 -> 弧长坐标（角点从两条边算出来是同一个值）。
  function perimeterArclength(point, size) {
    const arena = resolveArenaGeometry(size);
    if (arena.shape === "circle") {
      return (Math.PI * 0.75 - Math.atan2(point.y - arena.centerY, point.x - arena.centerX)) * arena.width / 2;
    }
    if (point.y >= arena.bottom - EPSILON) return point.x - arena.left;
    if (point.x >= arena.right - EPSILON) return arena.width + arena.bottom - point.y;
    if (point.y <= arena.top + EPSILON) return arena.width + arena.height + arena.right - point.x;
    return arena.width * 2 + arena.height + point.y - arena.top;
  }

  // 滑动距离：开局起就往前走，前 20 秒按 400 / 20 线性加速，之后维持 400。
  function slideDistance(sinceSlide) {
    if (!(sinceSlide > 0)) return 0;
    if (sinceSlide <= RAMP_DURATION) {
      return MAX_SLIDE_SPEED * sinceSlide * sinceSlide / (2 * RAMP_DURATION);
    }
    return MAX_SLIDE_SPEED * (sinceSlide - RAMP_DURATION / 2);
  }

  function wallPoint(context) {
    const { x, y } = getArenaWallContacts(context)[0];
    return { x, y };
  }

  function threadSlide(entity, time) {
    if (!Number.isFinite(entity.slideStartedAt)) return 0;
    return slideDistance(time - entity.slideStartedAt);
  }

  // 当前这一帧这根线的两个端点：生长中时末端就是本体自己（古筝的活线），
  // 冻结后两端都在边缘上，并一起沿边缘滑行。
  function threadSegment(entity, time) {
    const slide = threadSlide(entity, time);
    const start = perimeterPoint(entity.startArclength + slide, entity.size);
    if (entity.growing) {
      return {
        startX: start.x,
        startY: start.y,
        endX: entity.tip.x,
        endY: entity.tip.y
      };
    }
    const end = perimeterPoint(entity.endArclength + slide, entity.size);
    return { startX: start.x, startY: start.y, endX: end.x, endY: end.y };
  }

  // 锚点存的是"滑动起点上的弧长"：渲染时再加上当前滑动距离，
  // 于是碰壁那一刻端点正好落在碰壁点上，之后大家一起沿边缘走。
  function anchorArclength(point, size, slide) {
    return perimeterArclength(point, size) - slide;
  }

  function drawThreadKnot(context, entity, x, y) {
    context.beginPath();
    context.arc(x, y, THREAD_KNOT_RADIUS, 0, TWO_PI);
    context.strokeStyle = entity.color;
    context.lineWidth = THREAD_KNOT_WIDTH;
    context.stroke();
    context.beginPath();
    context.moveTo(
      x - THREAD_KNOT_RADIUS * 0.9,
      y + THREAD_KNOT_RADIUS * 0.9
    );
    context.lineTo(
      x + THREAD_KNOT_RADIUS * 0.9,
      y - THREAD_KNOT_RADIUS * 0.9
    );
    context.strokeStyle = entity.accent;
    context.lineWidth = 0.5;
    context.stroke();
  }

  function drawThreadLine(context, entity, segment) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const length = Math.hypot(deltaX, deltaY);
    const baseAlpha = context.globalAlpha;
    context.save();
    context.globalAlpha = baseAlpha * EDGE_ALPHA;
    context.strokeStyle = entity.color;
    context.lineWidth = THREAD_WIDTH;
    context.beginPath();
    context.moveTo(segment.startX, segment.startY);
    context.lineTo(segment.endX, segment.endY);
    context.stroke();
    if (length > 8) {
      const directionX = deltaX / length;
      const directionY = deltaY / length;
      const normalX = -directionY;
      const normalY = directionX;
      context.beginPath();
      let index = 0;
      for (let along = 2; along < length - 2; along += THREAD_TICK_SPACING) {
        const centerX = segment.startX + directionX * along;
        const centerY = segment.startY + directionY * along;
        const slant = index % 2 === 0 ? 1 : -1;
        context.moveTo(
          centerX + normalX * THREAD_TICK_HALF_NORMAL +
            directionX * THREAD_TICK_HALF_LONGITUDINAL * slant,
          centerY + normalY * THREAD_TICK_HALF_NORMAL +
            directionY * THREAD_TICK_HALF_LONGITUDINAL * slant
        );
        context.lineTo(
          centerX - normalX * THREAD_TICK_HALF_NORMAL -
            directionX * THREAD_TICK_HALF_LONGITUDINAL * slant,
          centerY - normalY * THREAD_TICK_HALF_NORMAL -
            directionY * THREAD_TICK_HALF_LONGITUDINAL * slant
        );
        index += 1;
      }
      context.globalAlpha = baseAlpha * 0.62;
      context.strokeStyle = entity.accent;
      context.lineWidth = THREAD_TICK_WIDTH;
      context.stroke();
    }
    if (length > 0.001) {
      const inwardX = deltaX / length;
      const inwardY = deltaY / length;
      const inset = THREAD_KNOT_RADIUS * 0.9;
      context.globalAlpha = baseAlpha;
      drawThreadKnot(
        context,
        entity,
        segment.startX + inwardX * inset,
        segment.startY + inwardY * inset
      );
      if (!entity.growing) {
        drawThreadKnot(
          context,
          entity,
          segment.endX - inwardX * inset,
          segment.endY - inwardY * inset
        );
      }
    }
    context.restore();
  }

  function createThread(services, start, tip, growing, arenaSize, slideStartedAt, slideNow, visualIndex) {
    const paletteIndex = visualIndex % THREAD_COLORS.length;
    return services.spawnCombatEntity({
      kind: "loom-thread",
      combatKind: "zone",
      // 织好的网和激光 V2 的永久激光一样留在场上，机主阵亡后继续滑。
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      drawLayer: "background",
      color: THREAD_COLORS[paletteIndex],
      accent: THREAD_ACCENTS[paletteIndex],
      size: arenaSize,
      growing,
      tip,
      slideStartedAt,
      // 碰壁锚点：记下它"在滑动起点处的弧长"，这样它在碰壁那一刻正好落在碰壁点上。
      startArclength: anchorArclength(start, arenaSize, slideNow),
      endArclength: growing ? null : anchorArclength(tip, arenaSize, slideNow),
      // 生长中的线只是引导线（末端跟着本体），和古筝一样不参与出伤；
      // 锚点契约也照抄激光 V2：活线只漏出碰壁锚点，冻结后两端都是断点。
      shieldBreakPoints: [start],
      shieldBreakRadius: 1,
      // 上一帧的线段（判"被扫到"用）与这一次连续接触的目标集合。
      previousSegment: null,
      touchingTargets: new Set(),
      update({ entity, game, services: threadServices }) {
        entity.size = resolveArenaGeometry(game);
        const segment = threadSegment(entity, game.time);
        const previous = entity.previousSegment || segment;
        entity.previousSegment = segment;
        entity.shieldBreakPoints = entity.growing
          ? [{ x: segment.startX, y: segment.startY }]
          : [
            { x: segment.startX, y: segment.startY },
            { x: segment.endX, y: segment.endY }
          ];
        if (entity.growing) return;
        const threadMoved = segmentMoved(previous, segment);
        threadServices.forEachEnemy((target) => {
          const targetMoveX = target.x - target.prevX;
          const targetMoveY = target.y - target.prevY;
          const geometryMoved = threadMoved || (
            targetMoveX * targetMoveX + targetMoveY * targetMoveY > EPSILON * EPSILON
          );
          const touchRadius = target.radius + THREAD_HALF_WIDTH;
          const wasTouching = entity.touchingTargets.has(target);
          const isTouching = currentlyTouchesThread(target, segment, touchRadius);
          if (
            !wasTouching &&
            geometryMoved &&
            (
              isTouching ||
              sweepTouchesThread(target, segment, previous, touchRadius)
            )
          ) {
            threadServices.dealDamage(target, THREAD_DAMAGE);
          }
          if (isTouching) entity.touchingTargets.add(target);
          else if (wasTouching) entity.touchingTargets.delete(target);
        });
      },
      draw({ entity, game }, canvasContext) {
        drawThreadLine(canvasContext, entity, threadSegment(entity, game.time));
      }
    });
  }

  const loomDefinition = {
    id: "loom",
    name: "织布机",
    englishName: "Loom",
    color: BODY_COLOR,
    description: "碰壁就从本体拉出一段线，一段接一段永不停手 / 端点开局起沿边缘逆时针滑行，20秒加速到400 / 贴线 -1，同一次接触只扣一滴",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: RAMP_DURATION,
    createBehavior(services) {
      const threads = [];
      let growingThread = null;
      let slideStartedAt = null;

      // 端点从战场一开始就动：滑动起点就是本体出生的那一刻。
      function origin(context) {
        if (slideStartedAt === null) slideStartedAt = context.game.time;
        return slideStartedAt;
      }

      function slideAt(context) {
        return slideDistance(context.game.time - origin(context));
      }

      function freeze(thread, point, slideNow) {
        thread.growing = false;
        thread.tip = { x: point.x, y: point.y };
        thread.endArclength = anchorArclength(point, thread.size, slideNow);
      }

      return {
        onSpawn(context) {
          origin(context);
        },
        // 一直布线：每次碰壁都把上一根钉在碰壁点上，再从同一点拉出新的一根。
        onWallBounce(context) {
          const startedAt = origin(context);
          const slideNow = slideAt(context);
          const point = wallPoint(context);
          const pending = growingThread;
          growingThread = null;
          if (pending && pending.entityActive !== false) freeze(pending, point, slideNow);
          const thread = createThread(
            services,
            point,
            context.ball,
            true,
            resolveArenaGeometry(context.game),
            startedAt,
            slideNow,
            threads.length
          );
          threads.push(thread);
          growingThread = thread;
        },
        onDeath(context) {
          // 机主阵亡：最后一根就地钉死，别让它一直挂在本体残骸上。
          if (growingThread && growingThread.entityActive !== false) {
            freeze(
              growingThread,
              { x: context.ball.x, y: context.ball.y },
              slideAt(context)
            );
          }
          growingThread = null;
        },
        onBorrowEnd() {
          for (const thread of threads) {
            if (thread.entityActive !== false) {
              thread.life = 0;
              thread.entityActive = false;
            }
          }
          threads.length = 0;
          growingThread = null;
          slideStartedAt = null;
        },
        getLoomState() {
          return {
            slideStartedAt,
            threads: threads.filter((thread) => thread.entityActive !== false)
          };
        }
      };
    }
  };

  registerBall(loomDefinition);
  return {
    loomDefinition,
    LOOM_BODY_COLOR: BODY_COLOR,
    LOOM_THREAD_COLORS: THREAD_COLORS.slice(),
    LOOM_RAMP_DURATION: RAMP_DURATION,
    LOOM_MAX_SLIDE_SPEED: MAX_SLIDE_SPEED,
    LOOM_THREAD_DAMAGE: THREAD_DAMAGE,
    LOOM_THREAD_WIDTH: THREAD_WIDTH,
    loomPerimeterPoint: perimeterPoint,
    loomPerimeterArclength: perimeterArclength,
    loomSlideDistance: slideDistance,
    loomThreadSegment: threadSegment
  };
});
