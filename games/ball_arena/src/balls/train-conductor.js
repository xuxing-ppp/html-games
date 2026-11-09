(function initializeTrainConductor(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
      require("../core/knockback.js"),
      require("../core/sprite-cache.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTrainConductorPlugin({ resolveArenaGeometry,
  registerBall,
  createKnockbackEffect: createSharedKnockback,
  createSpriteCache,
  resolveDeviceScale
}) {
  // 视频复刻：四次撞边铺轨，随后一列蒸汽长列车沿整条轨道驶过。
  // 和望一样，整列车离场后轨道渐隐，下一轮重新铺设。
  const REQUIRED_CONTACTS = 4;
  const TRAIN_DELAY = 0.6;
  const TRAIN_LENGTH = 440;
  const TRAIN_WIDTH = 12;
  const TRAIN_SPEED = 255;
  const TRAIN_DAMAGE = 5;
  const TRAIN_KNOCKBACK_DURATION = 0.05;
  const TRAIN_KNOCKBACK_SPEED_MULTIPLIER = 2;
  const TRAIN_IMPACT_RADIUS = 18;
  const TRAIN_FADE_DURATION = 0.6;
  const REARM_DELAY = 0;
  const CAR_LENGTH = 22;
  const CAR_PITCH = 26;
  const LOCOMOTIVE_LENGTH = 30;
  const LOCOMOTIVE_WIDTH = 13;
  const RAIL_GAUGE_HALF = 4.3;
  const RAIL_LINE_WIDTH = 1;
  const RAIL_OUTLINE_WIDTH = 2;
  const TIE_LENGTH = 19;
  const TIE_WIDTH = 2.4;
  const TIE_SPACING = 8;
  const SMOKE_INTERVAL = 0.035;
  const SMOKE_SPRITE_SIZE = 28;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  const RAIL_COLOR = "#eef0f2";
  const RAIL_OUTLINE_COLOR = "#3d4045";
  const TIE_COLOR = "#472c18";
  const TIE_TOP_COLOR = "#8a5f36";
  const TIE_GRAIN_COLOR = "#bb8b53";

  const TRAIN_COLORS = Object.freeze({
    outline: "#0d0b08",
    carBody: "#7c4a25",
    carGrain: "#542f16",
    carHighlight: "#b07a45",
    carBand: "#d9a62e",
    carBandDark: "#8a630f",
    coupler: "#c9cbce",
    couplerDark: "#43454a",
    wheel: "#151110",
    wheelHub: "#b9babd",
    locoBody: "#232a22",
    locoHighlight: "#62695f",
    locoRed: "#b52b2f",
    locoRedDark: "#74191d",
    locoGold: "#e7b936",
    lamp: "#ffe48a",
    lampCore: "#fffbe6"
  });

  const SMOKE_PALETTE = Object.freeze([
    "#f2f2f0", "#e2e2df", "#c9c9c6", "#a6a6a3", "#7c7c79"
  ]);

  const smokeSpriteCache = createSpriteCache();

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function hash01(value) {
    const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function colorWithAlpha(hex, alpha) {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function buildRoute(points) {
    const segments = [];
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      const deltaX = end.x - start.x;
      const deltaY = end.y - start.y;
      const segmentLength = Math.hypot(deltaX, deltaY);
      if (segmentLength <= EPSILON) continue;
      segments.push({
        startX: start.x,
        startY: start.y,
        endX: end.x,
        endY: end.y,
        directionX: deltaX / segmentLength,
        directionY: deltaY / segmentLength,
        startDistance: length,
        endDistance: length + segmentLength,
        length: segmentLength
      });
      length += segmentLength;
    }
    return { segments, length };
  }

  function pushTieQuad(target, centerX, centerY, directionX, directionY, halfLength, halfWidth) {
    const normalX = -directionY;
    const normalY = directionX;
    target.push(
      centerX + normalX * halfLength + directionX * halfWidth,
      centerY + normalY * halfLength + directionY * halfWidth,
      centerX - normalX * halfLength + directionX * halfWidth,
      centerY - normalY * halfLength + directionY * halfWidth,
      centerX - normalX * halfLength - directionX * halfWidth,
      centerY - normalY * halfLength - directionY * halfWidth,
      centerX + normalX * halfLength - directionX * halfWidth,
      centerY + normalY * halfLength - directionY * halfWidth
    );
  }

  function buildTieQuads(route) {
    const bases = [];
    const tops = [];
    const grains = [];
    route.segments.forEach((segment) => {
      for (
        let distance = TIE_SPACING / 2;
        distance < segment.length;
        distance += TIE_SPACING
      ) {
        const centerX = segment.startX + segment.directionX * distance;
        const centerY = segment.startY + segment.directionY * distance;
        pushTieQuad(
          bases, centerX, centerY,
          segment.directionX, segment.directionY,
          TIE_LENGTH / 2, TIE_WIDTH / 2
        );
        pushTieQuad(
          tops, centerX, centerY,
          segment.directionX, segment.directionY,
          TIE_LENGTH / 2 * 0.76, TIE_WIDTH / 2 * 0.56
        );
        pushTieQuad(
          grains, centerX, centerY,
          segment.directionX, segment.directionY,
          TIE_LENGTH / 2 * 0.5, TIE_WIDTH / 2 * 0.2
        );
      }
    });
    return { bases, tops, grains };
  }

  function buildRailLines(route) {
    const lines = [];
    for (const side of [-1, 1]) {
      const points = [];
      route.segments.forEach((segment) => {
        const offsetX = -segment.directionY * side * RAIL_GAUGE_HALF;
        const offsetY = segment.directionX * side * RAIL_GAUGE_HALF;
        points.push(
          segment.startX + offsetX,
          segment.startY + offsetY,
          segment.endX + offsetX,
          segment.endY + offsetY
        );
      });
      if (points.length > 0) lines.push(points);
    }
    return lines;
  }

  function createRailRoute(points) {
    const route = buildRoute(points);
    route.points = points.map((point) => ({ x: point.x, y: point.y }));
    const ties = buildTieQuads(route);
    route.tieBases = ties.bases;
    route.tieTops = ties.tops;
    route.tieGrains = ties.grains;
    route.railLines = buildRailLines(route);
    return route;
  }

  function fillQuads(context, quads, color) {
    if (quads.length === 0) return;
    context.beginPath();
    for (let index = 0; index < quads.length; index += 8) {
      context.moveTo(quads[index], quads[index + 1]);
      context.lineTo(quads[index + 2], quads[index + 3]);
      context.lineTo(quads[index + 4], quads[index + 5]);
      context.lineTo(quads[index + 6], quads[index + 7]);
      if (typeof context.closePath === "function") context.closePath();
    }
    context.fillStyle = color;
    context.fill();
  }

  function strokeRailLines(context, route, color, width) {
    if (route.railLines.length === 0) return;
    context.beginPath();
    for (const line of route.railLines) {
      for (let index = 0; index < line.length; index += 4) {
        context.moveTo(line[index], line[index + 1]);
        context.lineTo(line[index + 2], line[index + 3]);
      }
    }
    context.strokeStyle = color;
    context.lineWidth = width;
    if ("lineCap" in context) context.lineCap = "round";
    if ("lineJoin" in context) context.lineJoin = "round";
    context.stroke();
  }

  function drawRailRoute(context, route, opacity) {
    if (!route || route.segments.length === 0 || opacity <= 0) return;
    context.save();
    context.globalAlpha *= opacity;
    fillQuads(context, route.tieBases, TIE_COLOR);
    fillQuads(context, route.tieTops, TIE_TOP_COLOR);
    fillQuads(context, route.tieGrains, TIE_GRAIN_COLOR);
    strokeRailLines(context, route, RAIL_OUTLINE_COLOR, RAIL_OUTLINE_WIDTH);
    strokeRailLines(context, route, RAIL_COLOR, RAIL_LINE_WIDTH);
    context.restore();
  }

  function pointOnRoute(route, distance) {
    const firstSegment = route.segments[0];
    const lastSegment = route.segments[route.segments.length - 1];
    if (distance < 0) {
      return {
        x: firstSegment.startX + firstSegment.directionX * distance,
        y: firstSegment.startY + firstSegment.directionY * distance,
        directionX: firstSegment.directionX,
        directionY: firstSegment.directionY
      };
    }
    if (distance > route.length) {
      const overflow = distance - route.length;
      return {
        x: lastSegment.endX + lastSegment.directionX * overflow,
        y: lastSegment.endY + lastSegment.directionY * overflow,
        directionX: lastSegment.directionX,
        directionY: lastSegment.directionY
      };
    }
    const segment = route.segments.find((candidate) => (
      distance <= candidate.endDistance + EPSILON
    ));
    if (!segment) return null;
    const offset = distance - segment.startDistance;
    return {
      x: segment.startX + segment.directionX * offset,
      y: segment.startY + segment.directionY * offset,
      directionX: segment.directionX,
      directionY: segment.directionY
    };
  }

  function trainBodySegments(route, headDistance) {
    const tailDistance = headDistance - TRAIN_LENGTH;
    return route.segments.flatMap((segment) => {
      const startDistance = Math.max(segment.startDistance, tailDistance);
      const endDistance = Math.min(segment.endDistance, headDistance);
      if (endDistance - startDistance <= EPSILON) return [];
      const startOffset = startDistance - segment.startDistance;
      const endOffset = endDistance - segment.startDistance;
      return [{
        startX: segment.startX + segment.directionX * startOffset,
        startY: segment.startY + segment.directionY * startOffset,
        endX: segment.startX + segment.directionX * endOffset,
        endY: segment.startY + segment.directionY * endOffset,
        directionX: segment.directionX,
        directionY: segment.directionY
      }];
    });
  }

  function closestPointOnSegment(x, y, segment) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((x - segment.startX) * deltaX + (y - segment.startY) * deltaY) / lengthSquared, 0, 1);
    const pointX = segment.startX + deltaX * progress;
    const pointY = segment.startY + deltaY * progress;
    return {
      x: pointX,
      y: pointY,
      distance: Math.hypot(x - pointX, y - pointY),
      directionX: segment.directionX,
      directionY: segment.directionY
    };
  }

  function trainOpacity(route, distance) {
    const exitDistance = route.length + TRAIN_LENGTH;
    const fadeDistance = TRAIN_SPEED * TRAIN_FADE_DURATION;
    return clamp((exitDistance - distance) / fadeDistance, 0, 1);
  }

  function getSmokeSprite(context, color) {
    const scale = resolveDeviceScale(context);
    if (scale === null) return null;
    return smokeSpriteCache.get(
      `steam-train-smoke-${color}`,
      SMOKE_SPRITE_SIZE,
      scale,
      (spriteContext, centerX, centerY, size) => {
        const radius = size / 2;
        const gradient = spriteContext.createRadialGradient(
          centerX, centerY, radius * 0.1, centerX, centerY, radius
        );
        gradient.addColorStop(0, colorWithAlpha(color, 1));
        gradient.addColorStop(0.55, colorWithAlpha(color, 0.55));
        gradient.addColorStop(1, colorWithAlpha(color, 0));
        spriteContext.fillStyle = gradient;
        spriteContext.beginPath();
        spriteContext.arc(centerX, centerY, radius, 0, TWO_PI);
        spriteContext.fill();
      }
    );
  }

  // 烟团位置按 age 纯函数积分，不占用视效更新循环；绘制时只读 age。
  function createSteamPuff(options) {
    const drag = Number.isFinite(options.drag) ? options.drag : 2.4;
    return {
      kind: "steam-train-smoke",
      life: options.life,
      x: options.x,
      y: options.y,
      draw({ effect }, context) {
        const age = Math.max(0, effect.age);
        const travel = (1 - Math.exp(-drag * age)) / drag;
        const x = effect.x + options.vx * travel;
        const y = effect.y + options.vy * travel;
        const progress = clamp(age / effect.life, 0, 1);
        const size = options.fromSize + (options.toSize - options.fromSize) * Math.sqrt(progress);
        const fadeIn = clamp(progress / 0.08, 0, 1);
        const opacity = options.alpha * fadeIn * Math.pow(1 - progress, 0.8);
        if (opacity <= 0.002 || size <= 0) return;
        context.save();
        context.globalAlpha *= opacity;
        const sprite = getSmokeSprite(context, options.color);
        if (sprite && typeof context.drawImage === "function") {
          context.drawImage(
            sprite.canvas,
            x - size / 2,
            y - size / 2,
            size,
            size
          );
        } else if (typeof context.arc === "function") {
          context.fillStyle = options.color;
          context.beginPath();
          context.arc(x, y, size / 2, 0, TWO_PI);
          context.fill();
        } else if (typeof context.fillRect === "function") {
          context.fillStyle = options.color;
          context.fillRect(x - size / 4, y - size / 4, size / 2, size / 2);
        }
        context.restore();
      }
    };
  }

  function spawnTrainImpact(services, x, y, directionAngle) {
    services.spawnParticleBurst({
      kind: "steam-train-impact",
      x,
      y,
      count: 14,
      minDiameter: 1,
      maxDiameter: 7,
      minSpeed: 40,
      maxSpeed: 150,
      colors: ["#ffffff", "#d8d8d8", "#8a6a4a"],
      directionAngle,
      directionSpread: 1.6,
      initialRadius: TRAIN_IMPACT_RADIUS,
      drag: 2.8,
      life: 0.42
    });
  }

  function createTrainKnockback(source, directionX, directionY) {
    return createSharedKnockback({
      id: `steam-train-knockback-${source.instanceId}`,
      duration: TRAIN_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: TRAIN_KNOCKBACK_SPEED_MULTIPLIER
    });
  }

  function drawJointCoupler(context, fromX, fromY, toX, toY) {
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= EPSILON) return;
    const angle = Math.atan2(deltaY, deltaX);
    const normalX = -Math.sin(angle);
    const normalY = Math.cos(angle);
    // 视频里的车钩是两道交叉的银灰色拉杆（X 形），中间夹一个深色接头。
    context.save();
    context.lineCap = "round";
    for (const width of [2.6, 1.2]) {
      context.strokeStyle = width > 2 ? TRAIN_COLORS.couplerDark : TRAIN_COLORS.coupler;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(fromX + normalX * 2.1, fromY + normalY * 2.1);
      context.lineTo(toX - normalX * 2.1, toY - normalY * 2.1);
      context.moveTo(fromX - normalX * 2.1, fromY - normalY * 2.1);
      context.lineTo(toX + normalX * 2.1, toY + normalY * 2.1);
      context.stroke();
    }
    context.save();
    context.translate((fromX + toX) / 2, (fromY + toY) / 2);
    context.rotate(angle);
    context.fillStyle = TRAIN_COLORS.couplerDark;
    context.fillRect(-1.2, -1.8, 2.4, 3.6);
    context.restore();
    context.restore();
  }

  function drawWheels(context, length, width) {
    const wheelLength = 3.6;
    const wheelWidth = 2.3;
    context.fillStyle = TRAIN_COLORS.wheel;
    for (const side of [-1, 1]) {
      for (const end of [-1, 1]) {
        const x = end * length * 0.28 - wheelLength / 2;
        const y = side * (width / 2 + 0.9) - wheelWidth / 2;
        context.fillRect(x, y, wheelLength, wheelWidth);
        context.fillStyle = TRAIN_COLORS.wheelHub;
        context.fillRect(x + wheelLength / 2 - 0.55, y + wheelWidth / 2 - 0.55, 1.1, 1.1);
        context.fillStyle = TRAIN_COLORS.wheel;
      }
    }
  }

  function drawFreightCar(context, color) {
    context.save();
    context.fillStyle = TRAIN_COLORS.outline;
    context.fillRect(-CAR_LENGTH / 2 - 1.3, -TRAIN_WIDTH / 2 - 1.3, CAR_LENGTH + 2.6, TRAIN_WIDTH + 2.6);
    context.fillStyle = TRAIN_COLORS.carBody;
    context.fillRect(-CAR_LENGTH / 2, -TRAIN_WIDTH / 2, CAR_LENGTH, TRAIN_WIDTH);
    // 木纹：上缘高光、下缘暗边、两条横向木条。
    context.fillStyle = TRAIN_COLORS.carHighlight;
    context.fillRect(-CAR_LENGTH / 2 + 0.6, -TRAIN_WIDTH / 2 + 0.6, CAR_LENGTH - 1.2, 0.9);
    context.fillStyle = TRAIN_COLORS.carGrain;
    context.fillRect(-CAR_LENGTH / 2 + 0.6, TRAIN_WIDTH / 2 - 1.5, CAR_LENGTH - 1.2, 1);
    context.fillRect(-CAR_LENGTH * 0.36, -TRAIN_WIDTH * 0.18, CAR_LENGTH * 0.72, 0.7);
    context.fillRect(-CAR_LENGTH * 0.36, TRAIN_WIDTH * 0.1, CAR_LENGTH * 0.72, 0.7);
    // 两端金色包边。
    for (const side of [-1, 1]) {
      const bandX = side < 0 ? -CAR_LENGTH / 2 + 1.2 : CAR_LENGTH / 2 - 2.9;
      context.fillStyle = TRAIN_COLORS.carBand;
      context.fillRect(bandX, -TRAIN_WIDTH / 2 + 0.8, 1.7, TRAIN_WIDTH - 1.6);
      context.fillStyle = TRAIN_COLORS.carBandDark;
      context.fillRect(
        bandX + (side < 0 ? 1.7 : -0.4),
        -TRAIN_WIDTH / 2 + 0.8,
        0.4,
        TRAIN_WIDTH - 1.6
      );
    }
    context.restore();
  }

  function drawDisc(context, x, y, radius, color) {
    if (typeof context.arc === "function") {
      context.fillStyle = color;
      context.beginPath();
      context.arc(x, y, radius, 0, TWO_PI);
      context.fill();
      return;
    }
    context.fillStyle = color;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawLocomotive(context) {
    const length = LOCOMOTIVE_LENGTH;
    const width = LOCOMOTIVE_WIDTH;
    context.save();
    // 车壳
    context.fillStyle = TRAIN_COLORS.outline;
    context.fillRect(-length / 2 - 1.5, -width / 2 - 1.5, length + 3, width + 3);
    // 锅炉
    context.fillStyle = TRAIN_COLORS.locoBody;
    context.fillRect(-length / 2 + 2, -width / 2 + 1, length * 0.62, width - 2);
    context.fillStyle = TRAIN_COLORS.locoHighlight;
    context.fillRect(-length / 2 + 2, -width / 2 + 1, length * 0.62, 0.9);
    context.fillStyle = "#151a16";
    context.fillRect(-length / 2 + 2, width / 2 - 2, length * 0.62, 1);
    // 两道细金箍
    for (const progress of [0.42, 0.54]) {
      context.fillStyle = TRAIN_COLORS.locoGold;
      context.fillRect(-length / 2 + length * progress, -width / 2 + 1, 0.9, width - 2);
    }
    // 汽包
    drawDisc(context, -length / 2 + length * 0.36, -width / 2 + 2.6, 1.2, TRAIN_COLORS.locoGold);
    drawDisc(context, -length / 2 + length * 0.49, -width / 2 + 2.8, 1, TRAIN_COLORS.locoGold);
    // 侧面大轮盘（金圈 + 深色轮心）
    const wheelX = -length / 2 + length * 0.5;
    drawDisc(context, wheelX, width * 0.16, 2.7, TRAIN_COLORS.locoGold);
    drawDisc(context, wheelX, width * 0.16, 1.5, TRAIN_COLORS.locoBody);
    // 红色驾驶室
    context.fillStyle = TRAIN_COLORS.locoRed;
    context.fillRect(-length / 2 + 0.8, -width / 2 + 0.5, length * 0.31, width - 1);
    context.fillStyle = TRAIN_COLORS.locoRedDark;
    context.fillRect(-length / 2 + 0.8, -width / 2 + 0.5, 1.4, width - 1);
    context.fillStyle = TRAIN_COLORS.locoGold;
    context.fillRect(-length / 2 + length * 0.31, -width / 2 + 0.5, 0.8, width - 1);
    context.fillRect(-length / 2 + 3.4, -2.1, 2.2, 4.2);
    context.fillStyle = TRAIN_COLORS.locoRedDark;
    context.fillRect(-length / 2 + 3.9, -1.5, 1.3, 3);
    // 车头红色缓冲梁
    context.fillStyle = TRAIN_COLORS.locoRedDark;
    context.fillRect(length / 2 - 5.2, -width / 2 + 0.6, 5, width - 1.2);
    context.fillStyle = TRAIN_COLORS.locoRed;
    context.fillRect(length / 2 - 4.6, -width / 2 + 1.2, 4, width - 2.4);
    // 金色车灯
    drawDisc(context, length / 2 - 2.2, 0, 3.2, "rgba(255, 228, 138, 0.22)");
    drawDisc(context, length / 2 - 2.2, 0, 1.9, TRAIN_COLORS.lamp);
    drawDisc(context, length / 2 - 2.2, 0, 0.9, TRAIN_COLORS.lampCore);
    // 烟囱（车尾）
    context.fillStyle = TRAIN_COLORS.outline;
    context.fillRect(-length / 2 - 2.2, -2.8, 3.4, 5.6);
    context.fillStyle = "#454842";
    context.fillRect(-length / 2 - 1.5, -1.8, 1.7, 3.6);
    context.restore();
  }

  function drawTrain(context, route, headDistance, opacity) {
    if (!route || route.segments.length === 0 || opacity <= 0) return;
    context.save();
    context.globalAlpha *= opacity;
    const carCount = Math.ceil(TRAIN_LENGTH / CAR_PITCH);
    const carCenters = [];
    for (let index = 0; index < carCount; index += 1) {
      const carLength = index === 0 ? LOCOMOTIVE_LENGTH : CAR_LENGTH;
      const centerDistance = headDistance - (index * CAR_PITCH + carLength / 2);
      const center = pointOnRoute(route, centerDistance);
      if (!center) continue;
      const front = pointOnRoute(route, centerDistance + carLength * 0.35);
      const back = pointOnRoute(route, centerDistance - carLength * 0.35);
      const angle = front && back
        ? Math.atan2(front.y - back.y, front.x - back.x)
        : Math.atan2(center.directionY, center.directionX);
      carCenters.push({ x: center.x, y: center.y, angle, carLength, index });
    }
    // 车钩先画，车身压住两端。
    for (let index = 1; index < carCenters.length; index += 1) {
      const front = carCenters[index - 1];
      const rear = carCenters[index];
      const frontRearX = front.x - Math.cos(front.angle) * front.carLength / 2;
      const frontRearY = front.y - Math.sin(front.angle) * front.carLength / 2;
      const rearFrontX = rear.x + Math.cos(rear.angle) * rear.carLength / 2;
      const rearFrontY = rear.y + Math.sin(rear.angle) * rear.carLength / 2;
      drawJointCoupler(context, frontRearX, frontRearY, rearFrontX, rearFrontY);
    }
    for (const car of carCenters) {
      context.save();
      context.translate(car.x, car.y);
      context.rotate(car.angle);
      drawWheels(context, car.carLength, car.index === 0 ? LOCOMOTIVE_WIDTH : TRAIN_WIDTH);
      if (car.index === 0) drawLocomotive(context);
      else drawFreightCar(context);
      context.restore();
    }
    context.restore();
  }

  const trainConductorDefinition = {
    id: "trainConductor",
    name: "列车长",
    englishName: "Train Conductor",
    color: "#9551f1",
    description: "四次撞边铺轨 / 慢速蒸汽列车 / 木车厢金边铁轨 / 撞人 -5 击退",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let state = "laying";
      let stateTime = 0;
      let edgeContactCount = 0;
      let trackPoints = [];
      let route = null;
      let trainDistance = 0;
      let trainContacts = new Set();
      let railEntity = null;
      let liveRoute = null;
      let smokeSerial = 0;
      let smokeTimer = 0;

      function transitionTo(nextState) {
        state = nextState;
        stateTime = 0;
      }

      function recordTrackPoint(x, y) {
        const next = { x, y };
        const last = trackPoints[trackPoints.length - 1];
        if (!last) {
          trackPoints.push(next);
          return;
        }
        if (Math.hypot(next.x - last.x, next.y - last.y) <= EPSILON) return;
        const beforeLast = trackPoints[trackPoints.length - 2];
        if (beforeLast) {
          const previousX = last.x - beforeLast.x;
          const previousY = last.y - beforeLast.y;
          const nextX = next.x - last.x;
          const nextY = next.y - last.y;
          const previousLength = Math.hypot(previousX, previousY);
          const nextLength = Math.hypot(nextX, nextY);
          const cross = previousX * nextY - previousY * nextX;
          const dot = previousX * nextX + previousY * nextY;
          if (
            previousLength > EPSILON &&
            nextLength > EPSILON &&
            Math.abs(cross) <= previousLength * nextLength * 0.001 &&
            dot > 0
          ) {
            trackPoints[trackPoints.length - 1] = next;
            return;
          }
        }
        trackPoints.push(next);
      }

      function resetToLaying() {
        edgeContactCount = 0;
        trackPoints = [];
        route = null;
        liveRoute = null;
        trainDistance = 0;
        trainContacts = new Set();
        transitionTo("laying");
      }

      function beginTrain() {
        if (!route) return;
        trainDistance = 0;
        trainContacts = new Set();
        smokeSerial = 0;
        smokeTimer = 0;
        transitionTo("train");
        if (typeof services.playSound === "function") {
          services.playSound("shoot", { kind: "steam-train", speed: TRAIN_SPEED });
        }
      }

      function collideWithTrain(trainServices) {
        if (!route) return;
        const trainSegments = trainBodySegments(route, trainDistance);
        trainServices.forEachEnemy((target) => {
          if (!target || target.hp <= 0) return;
          const contactKey = target.instanceId;
          let nearest = null;
          trainSegments.forEach((segment) => {
            const candidate = closestPointOnSegment(target.x, target.y, segment);
            if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
          });
          const contactDistance = target.radius + TRAIN_WIDTH / 2;
          if (!nearest || nearest.distance >= contactDistance) {
            trainContacts.delete(contactKey);
            return;
          }
          let normalX = target.x - nearest.x;
          let normalY = target.y - nearest.y;
          const normalLength = Math.hypot(normalX, normalY);
          if (normalLength <= EPSILON) {
            normalX = -nearest.directionY;
            normalY = nearest.directionX;
          } else {
            normalX /= normalLength;
            normalY /= normalLength;
          }
          if (!trainContacts.has(contactKey)) {
            if (!trainServices.dealDamage(target, TRAIN_DAMAGE)) return;
            trainContacts.add(contactKey);
            trainServices.applyEffect(
              target,
              createTrainKnockback(railEntity, normalX, normalY)
            );
            spawnTrainImpact(
              trainServices,
              nearest.x + normalX * TRAIN_WIDTH / 2,
              nearest.y + normalY * TRAIN_WIDTH / 2,
              Math.atan2(normalY, normalX)
            );
          }
          target.x = nearest.x + normalX * contactDistance;
          target.y = nearest.y + normalY * contactDistance;
          const velocityTowardTrain = target.vx * normalX + target.vy * normalY;
          if (velocityTowardTrain < 0) {
            target.vx -= velocityTowardTrain * 2 * normalX;
            target.vy -= velocityTowardTrain * 2 * normalY;
            target.storedVx = target.vx;
            target.storedVy = target.vy;
          }
        });
      }

      function emitSmoke(trainServices, elapsed) {
        smokeTimer += elapsed;
        if (smokeTimer + EPSILON < SMOKE_INTERVAL) return;
        const emissions = Math.min(3, Math.floor((smokeTimer + EPSILON) / SMOKE_INTERVAL));
        smokeTimer -= emissions * SMOKE_INTERVAL;
        const locoCenterDistance = trainDistance - LOCOMOTIVE_LENGTH / 2;
        const center = pointOnRoute(route, locoCenterDistance);
        if (!center) return;
        const angle = Math.atan2(center.directionY, center.directionX);
        const normalX = -Math.sin(angle);
        const normalY = Math.cos(angle);
        const chimneyX = center.x - Math.cos(angle) * (LOCOMOTIVE_LENGTH * 0.45) + normalX * 1.5;
        const chimneyY = center.y - Math.sin(angle) * (LOCOMOTIVE_LENGTH * 0.45) + normalY * 1.5;
        // 蒸汽跟着车头一起走，慢慢落在后方，形成视频里贴着机车的一团白烟。
        const carryX = Math.cos(angle) * TRAIN_SPEED * 0.9;
        const carryY = Math.sin(angle) * TRAIN_SPEED * 0.9;
        for (let index = 0; index < emissions * 4; index += 1) {
          const serial = smokeSerial;
          smokeSerial += 1;
          const variance = hash01(serial * 2.13 + index * 7.7);
          const spread = hash01(serial * 5.7 + 1.3) - 0.5;
          const speed = 8 + variance * 14;
          const life = 0.45 + hash01(serial * 3.1) * 0.2;
          const dark = hash01(serial * 9.9) < 0.18;
          const colorIndex = dark ? 4 : Math.floor(hash01(serial * 4.7) * 4);
          const color = SMOKE_PALETTE[Math.min(colorIndex, SMOKE_PALETTE.length - 1)];
          trainServices.spawnVisualEffect(createSteamPuff({
            x: chimneyX + normalX * spread * 9,
            y: chimneyY + normalY * spread * 9,
            vx: carryX - Math.cos(angle) * speed + normalX * spread * 26,
            vy: carryY - Math.sin(angle) * speed + normalY * spread * 26,
            life,
            drag: 1.8,
            fromSize: 1.8 + variance * 1.4,
            toSize: 7 + variance * 4.5,
            color,
            alpha: dark ? 0.7 : 0.68 + variance * 0.22
          }));
        }
        // 每轮再补一团更大的稀薄云，给整团蒸汽一点体积。
        smokeSerial += 1;
        trainServices.spawnVisualEffect(createSteamPuff({
          x: chimneyX,
          y: chimneyY,
          vx: carryX * 0.88,
          vy: carryY * 0.88,
          life: 0.7,
          drag: 1.6,
          fromSize: 6,
          toSize: 16,
          color: SMOKE_PALETTE[1],
          alpha: 0.18
        }));
      }

      function advanceTrainState(dt) {
        if (state === "arming") {
          stateTime = Math.min(TRAIN_DELAY, stateTime + dt);
        } else if (state === "train") {
          trainDistance = Math.min(
            route.length + TRAIN_LENGTH,
            trainDistance + TRAIN_SPEED * dt
          );
        } else if (state === "fading") {
          stateTime = Math.min(TRAIN_FADE_DURATION, stateTime + dt);
        }
      }

      function resolveTrainState(trainServices) {
        if (state === "train") {
          collideWithTrain(trainServices);
          if (trainDistance + EPSILON >= route.length + TRAIN_LENGTH) {
            transitionTo("fading");
          }
        } else if (state === "arming" && stateTime + EPSILON >= TRAIN_DELAY) {
          beginTrain();
        } else if (state === "fading" && stateTime + EPSILON >= TRAIN_FADE_DURATION) {
          if (railEntity) railEntity.entityActive = false;
          railEntity = null;
          route = null;
          liveRoute = null;
          trackPoints = [];
          transitionTo("cooldown");
        }
      }

      function trainBoundary() {
        if (state === "arming") return Math.max(EPSILON, TRAIN_DELAY - stateTime);
        if (state === "train" && route) {
          return Math.max(
            EPSILON,
            (route.length + TRAIN_LENGTH - trainDistance) / TRAIN_SPEED
          );
        }
        if (state === "fading") return Math.max(EPSILON, TRAIN_FADE_DURATION - stateTime);
        return undefined;
      }

      // 已发车的这一轮独立完成行驶与渐隐，不把旧轨道留给下一轮。
      function spawnRailEntity() {
        if (railEntity && railEntity.entityActive !== false) return;
        railEntity = services.spawnCombatEntity({
          kind: "steam-train",
          combatKind: "zone",
          life: Number.MAX_SAFE_INTEGER,
          lifecycle: "independent",
          drawLayer: "background",
          update({ entity, services: trainServices }, dt) {
            if (railEntity !== entity) return;
            const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
            if (state !== "laying" && state !== "cooldown") {
              advanceTrainState(elapsed);
            }
            if (state === "arming" && stateTime + EPSILON >= TRAIN_DELAY) {
              beginTrain();
            }
            if (state === "train") {
              emitSmoke(trainServices, elapsed);
              resolveTrainState(trainServices);
            }
            if (state === "fading" && stateTime + EPSILON >= TRAIN_FADE_DURATION) {
              resolveTrainState(trainServices);
            }
          },
          draw({ entity }, canvasContext) {
            if (railEntity !== entity) return;
            const fadeProgress = clamp(stateTime / TRAIN_FADE_DURATION, 0, 1);
            const opacity = state === "fading"
              ? 1 - fadeProgress * fadeProgress * (3 - 2 * fadeProgress)
              : 1;
            if (route && state !== "cooldown") drawRailRoute(canvasContext, route, opacity);
            if (state === "laying" && liveRoute) {
              drawRailRoute(canvasContext, liveRoute, 1);
            }
            if (route && state === "train") {
              drawTrain(
                canvasContext,
                route,
                trainDistance,
                trainOpacity(route, trainDistance)
              );
            }
          }
        });
      }

      return {
        update(context, dt) {
          if (state === "cooldown") {
            stateTime = Math.min(REARM_DELAY, stateTime + Math.max(0, dt));
          }
          // 第三方技能可能清掉场上的实体；轨道物被清掉后补回来，避免列车停在半路。
          if ((!railEntity || railEntity.entityActive === false) &&
              (route || (state === "laying" && trackPoints.length > 0))) {
            spawnRailEntity();
          }
        },
        onBorrowEnd() {
          // 借来的攻击收尾时带走自己的轨道，避免替别人永久留一张路网。
          if (railEntity) railEntity.entityActive = false;
          railEntity = null;
          route = null;
          resetToLaying();
        },
        getNextPausedTransitionIn() {
          return trainBoundary();
        },
        getNextTransitionIn() {
          const boundary = trainBoundary();
          if (boundary !== undefined) return boundary;
          if (state === "cooldown") {
            return Math.max(EPSILON, REARM_DELAY - stateTime);
          }
          return undefined;
        },
        afterUpdateStep(context) {
          if (state === "laying") {
            // 与望一致：按球的实际飞行轨迹逐帧铺轨，被击退后的弯折也会留在轨上。
            if (edgeContactCount > 0) {
              recordTrackPoint(context.ball.x, context.ball.y);
              liveRoute = createRailRoute(trackPoints);
            }
            return;
          }
          if (state === "cooldown" && stateTime + EPSILON >= REARM_DELAY) {
            resetToLaying();
          }
        },
        onWallBounce(context) {
          if (state !== "laying") return;
          const { ball, game } = context;
          const wall = context.wallContacts && context.wallContacts[0];
          const firstPointX = wall ? wall.x : context.bouncedX
            ? (ball.x <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.x;
          const firstPointY = wall ? wall.y : context.bouncedY
            ? (ball.y <= ball.radius + EPSILON ? 0 : game.arenaSize)
            : ball.y;
          if (edgeContactCount === 0) {
            trackPoints = [{ x: firstPointX, y: firstPointY }];
            spawnRailEntity();
          } else {
            recordTrackPoint(ball.x, ball.y);
            recordTrackPoint(firstPointX, firstPointY);
          }
          edgeContactCount += 1;
          liveRoute = createRailRoute(trackPoints);
          if (edgeContactCount === REQUIRED_CONTACTS) {
            const nextRoute = createRailRoute(trackPoints);
            if (nextRoute.segments.length === 0) {
              resetToLaying();
              return;
            }
            route = nextRoute;
            transitionTo("arming");
          }
        },
        getTrainConductorState() {
          return {
            state,
            stateTime,
            edgeContactCount,
            trackPoints: trackPoints.map((point) => ({ ...point })),
            routeLength: route ? route.length : 0,
            railHistoryLength: route ? 1 : 0,
            trainDistance,
            trainLength: TRAIN_LENGTH,
            trainSpeed: TRAIN_SPEED,
            trainWidth: TRAIN_WIDTH,
            trainDamage: TRAIN_DAMAGE,
            carLength: CAR_LENGTH,
            carPitch: CAR_PITCH
          };
        }
      };
    }
  };

  registerBall(trainConductorDefinition);
  return {
    trainConductorDefinition,
    createSteamPuff,
    TRAIN_CONDUCTOR_CONSTANTS: Object.freeze({
      REQUIRED_CONTACTS,
      TRAIN_DELAY,
      TRAIN_LENGTH,
      TRAIN_WIDTH,
      TRAIN_SPEED,
      TRAIN_DAMAGE,
      TRAIN_KNOCKBACK_DURATION,
      TRAIN_KNOCKBACK_SPEED_MULTIPLIER
    })
  };
});
