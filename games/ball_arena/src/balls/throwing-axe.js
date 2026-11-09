(function initializeThrowingAxe(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
        ...require("./slash-tool.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createThrowingAxePlugin({ resolveArenaGeometry, registerBall, createSlashEffect }) {
  // 飞斧：本体是一颗纯大红球（正常碰撞实体，自己不造成碰撞伤害）。
  // 它手里一直握着一把长 40 的斧头 —— 握持状态也是有战斗实体的，斧刃压到
  // 敌人一样能砍到；开局朝最近的敌人扔出，斧头沿一条大回旋环线（椭圆）
  // 飞出又飞回，回到手上进入 2 秒冷却。
  // 斧头"本体没有碰撞体积"指的是斧柄：只有末端 15×15 的斧刃参与命中判定，
  // 一次接触 4 点伤害，并触发一次与若藻同款的斩击特效；飞行途中拖灰尘。
  const BODY_COLOR = "#ff0000";
  const HANDLE_COLOR = "#8a5a2b";
  const HANDLE_DARK = "#54371a";
  const HEAD_COLOR = "#cfd6dd";
  const HEAD_DARK = "#79828d";
  const DUST_COLORS = ["#d8d2c4", "#b3a893", "#8a8f86"];

  const AXE_LENGTH = 40;
  const BLADE_SIZE = 15;
  const BLADE_OFFSET = AXE_LENGTH / 2 - BLADE_SIZE / 2;
  const SPIN_REVOLUTIONS_PER_SECOND = 8;
  const SPIN_RATE = SPIN_REVOLUTIONS_PER_SECOND * Math.PI * 2;
  // 回旋环线：出手点在本体前方，先向外摆开，再绕一圈收回。它不是僵硬的
  // 完美椭圆，而是一个经过轻微前后扫动、上下宽度变化的闭合曲线；这样连续
  // 投掷时轨迹更像回旋镖，也不会每次都画出完全重合的机械圆轨道。
  const LOOP_A = 72;
  const LOOP_B = 36;
  // LOOP_PERIOD 是正常场地的名义时长。实际时长由曲线弧长计算，所以贴墙
  // 缩短环线后会自然更快收回，不能再把它当作每次投掷的硬编码时长。
  const LOOP_PERIOD = 1.5;
  const FLIGHT_PATH_SPEED = 205;
  const MIN_FLIGHT_DURATION = 0.65;
  const MAX_FLIGHT_DURATION = 1.8;
  const PATH_SAMPLES = 96;
  const PATH_FORWARD_CROWN = 0.1;
  const PATH_FORWARD_SWEEP = 0.08;
  const PATH_LATERAL_TAPER = 0.18;
  // 用于边界估计的保守包围盒系数。真实曲线的最大偏差约为 1.02 倍，
  // 留一点余量可以避免用硬钳位切断曲线。
  const PATH_FORWARD_EXTENT = 1.04;
  const PATH_LATERAL_EXTENT = 1.03;
  const LOOP_LAUNCH_PAD = 4;
  const THROW_COOLDOWN = 2;
  const GRAB_DISTANCE = 20;
  const ARENA_MARGIN = 3;
  const WALL_RESTITUTION = 0.45;
  // 握持姿态：斧心在本体侧前方，刃口朝向敌人；侧向偏移略大于球半径，
  // 让柄整体贴在球外（低位持武器），不会埋在球里/架在头顶。
  const HELD_SIDE_OFFSET = 16;
  const HELD_FORWARD_OFFSET = 3;
  const DUST_INTERVAL = 0.09;
  const BLADE_DAMAGE = 4;
  const SLASH_KIND = "throwing-axe-slash";
  const DUST_KIND = "throwing-axe-dust";
  const HELD_MODE = "held";
  const FLYING_MODE = "flying";
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  // 斧刃中心：从斧心沿柄方向外移 12.5，正好覆盖末端 15×15。
  function bladeCenter(x, y, angle) {
    return {
      x: x + Math.cos(angle) * BLADE_OFFSET,
      y: y + Math.sin(angle) * BLADE_OFFSET
    };
  }

  // 圆 vs 随斧头自转的 15×15 方形斧刃：命中判定只认这块面积。
  function bladeContact(bladeX, bladeY, angle, target) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const deltaX = target.x - bladeX;
    const deltaY = target.y - bladeY;
    const localX = deltaX * cosine + deltaY * sine;
    const localY = -deltaX * sine + deltaY * cosine;
    const half = BLADE_SIZE / 2;
    const closestX = clamp(localX, -half, half);
    const closestY = clamp(localY, -half, half);
    let normalLocalX = localX - closestX;
    let normalLocalY = localY - closestY;
    let distance = Math.hypot(normalLocalX, normalLocalY);
    if (distance <= EPSILON) {
      const gapX = half - Math.abs(localX);
      const gapY = half - Math.abs(localY);
      if (gapX < gapY) {
        normalLocalX = localX < 0 ? -1 : 1;
        normalLocalY = 0;
      } else {
        normalLocalX = 0;
        normalLocalY = localY < 0 ? -1 : 1;
      }
      distance = 0;
    } else {
      normalLocalX /= distance;
      normalLocalY /= distance;
    }
    if (distance > target.radius) return null;
    return {
      depth: target.radius - distance,
      normalX: normalLocalX * cosine - normalLocalY * sine,
      normalY: normalLocalX * sine + normalLocalY * cosine
    };
  }

  function isInsideArena(axe, arenaSize) {
    return resolveArenaGeometry(arenaSize).contains(axe.x, axe.y);
  }

  // 以本体为参照的径向距离与相对径向速度（>0 表示还在远离本体）。
  function relativeToBall(axe, ball) {
    const deltaX = axe.x - ball.x;
    const deltaY = axe.y - ball.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= EPSILON) return { distance: 0, ux: 1, uy: 0, radialSpeed: 0 };
    const ux = deltaX / distance;
    const uy = deltaY / distance;
    return {
      distance,
      ux,
      uy,
      radialSpeed: (axe.vx - (ball.vx || 0)) * ux + (axe.vy - (ball.vy || 0)) * uy
    };
  }

  // 场地边界软反弹：斧头撞到战场边缘被弹回场内，"大部分时间都在战场内"
  // 因此是硬保证，而不是靠回拽刚度慢慢往外拖。
  function bounceOffArena(axe, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const point = arena.clampPoint(axe.x, axe.y, ARENA_MARGIN);
    const dx = point.x - axe.x, dy = point.y - axe.y, distance = Math.hypot(dx, dy);
    if (distance <= EPSILON) return;
    axe.x = point.x; axe.y = point.y;
    if (arena.shape !== "circle") {
      if (dx && axe.vx * dx < 0) axe.vx *= -WALL_RESTITUTION;
      if (dy && axe.vy * dy < 0) axe.vy *= -WALL_RESTITUTION;
    } else {
      const nx = dx / distance, ny = dy / distance, dot = axe.vx * nx + axe.vy * ny;
      if (dot < 0) { axe.vx -= (1 + WALL_RESTITUTION) * dot * nx; axe.vy -= (1 + WALL_RESTITUTION) * dot * ny; }
    }
  }

  // 握持位：斧头永远垂在球的下半侧（像手提着），而不是顶在头顶上。
  // 垂直于瞄准线的“侧向”分量可能朝上（比如敌人正好在左侧），
  // 这里把它翻到屏幕下方，保证握持姿态是低位持武器。
  function heldAnchor(ball, angle) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    let sideX = -directionY * HELD_SIDE_OFFSET;
    let sideY = directionX * HELD_SIDE_OFFSET;
    if (sideY < 0) {
      sideX = -sideX;
      sideY = -sideY;
    }
    return {
      x: ball.x + sideX + directionX * HELD_FORWARD_OFFSET,
      y: ball.y + sideY + directionY * HELD_FORWARD_OFFSET
    };
  }

  // 曲线在自身坐标系中的位置。forward 沿瞄准方向，lateral 垂直于瞄准方向。
  // 两个附加项在起点和终点都为零，且一阶导数连续，因此收回时不会突然折返。
  function pathCoordinates(a, b, phase) {
    const cosine = Math.cos(phase);
    const sine = Math.sin(phase);
    const forward = a * (
      cosine - PATH_FORWARD_CROWN * (Math.cos(phase * 2) - 1) +
      PATH_FORWARD_SWEEP * sine * (1 + cosine)
    );
    const lateral = b * sine * (1 - PATH_LATERAL_TAPER * cosine);
    return { forward, lateral };
  }

  function createPathProfile(a, b, loopDirection) {
    const phases = new Array(PATH_SAMPLES + 1);
    const distances = new Array(PATH_SAMPLES + 1);
    phases[0] = Math.PI;
    distances[0] = 0;
    let previous = pathCoordinates(a, b, phases[0]);
    for (let index = 1; index <= PATH_SAMPLES; index += 1) {
      const progress = index / PATH_SAMPLES;
      const phase = Math.PI + loopDirection * TWO_PI * progress;
      const current = pathCoordinates(a, b, phase);
      phases[index] = phase;
      distances[index] = distances[index - 1] + Math.hypot(
        current.forward - previous.forward,
        current.lateral - previous.lateral
      );
      previous = current;
    }
    return {
      phases,
      distances,
      length: distances[PATH_SAMPLES]
    };
  }

  function phaseAtProgress(profile, progress) {
    const normalized = clamp(progress, 0, 1);
    const targetDistance = normalized * profile.length;
    let low = 0;
    let high = PATH_SAMPLES;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (profile.distances[middle] < targetDistance) low = middle + 1;
      else high = middle;
    }
    const upper = clamp(low, 1, PATH_SAMPLES);
    const lower = upper - 1;
    const segmentLength = profile.distances[upper] - profile.distances[lower];
    const segmentProgress = segmentLength <= EPSILON
      ? 0
      : (targetDistance - profile.distances[lower]) / segmentLength;
    return profile.phases[lower] +
      (profile.phases[upper] - profile.phases[lower]) * segmentProgress;
  }

  function pathPosition(ball, geometry, progress) {
    const phase = phaseAtProgress(geometry.pathProfile, progress);
    const coordinates = pathCoordinates(geometry.a, geometry.b, phase);
    const centerX = ball.x + geometry.dirX * (geometry.a + geometry.launch);
    const centerY = ball.y + geometry.dirY * (geometry.a + geometry.launch);
    return {
      x: centerX + geometry.dirX * coordinates.forward + geometry.perpX * coordinates.lateral,
      y: centerY + geometry.dirY * coordinates.forward + geometry.perpY * coordinates.lateral
    };
  }

  // 回旋环几何：曲线近端 = 本体前方 launch 处，主轴沿瞄准方向指向敌人。
  // 贴墙时按可用空间缩放整条曲线，优先保持连续轨迹而不是硬钳位。
  function computeBoomerangGeometry(ball, arenaSize, aimAngle, loopDirection = 1) {
    const dirX = Math.cos(aimAngle);
    const dirY = Math.sin(aimAngle);
    const perpX = -dirY;
    const perpY = dirX;
    const margin = ARENA_MARGIN + 2;
    // 敌人在墙边时，按固定的 19 逻辑距离出手会把斧头第一帧直接放到墙外。
    // 缩短出手距离，让它仍从本体前方飞出，再根据剩余空间缩小回旋半径。
    const arena = resolveArenaGeometry(arenaSize);
    const rayClearance = arena.movementLimit(ball.x, ball.y, dirX, dirY, arena.size * 2, margin);
    const launch = Math.max(
      2,
      Math.min(ball.radius + LOOP_LAUNCH_PAD, Number.isFinite(rayClearance)
        ? rayClearance * 0.65
        : ball.radius + LOOP_LAUNCH_PAD)
    );
    let a = LOOP_A;
    let b = LOOP_B;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const centerX = ball.x + dirX * (a + launch);
      const centerY = ball.y + dirY * (a + launch);
      const halfX = Math.hypot(
        a * PATH_FORWARD_EXTENT * dirX,
        b * PATH_LATERAL_EXTENT * perpX
      );
      const halfY = Math.hypot(
        a * PATH_FORWARD_EXTENT * dirY,
        b * PATH_LATERAL_EXTENT * perpY
      );
      const fits = arena.shape === "circle"
        ? Array.from({ length: 64 }, (_, index) => { const angle = index * Math.PI * 2 / 64;
          return arena.contains(centerX + Math.cos(angle) * a * PATH_FORWARD_EXTENT * dirX + Math.sin(angle) * b * PATH_LATERAL_EXTENT * perpX,
            centerY + Math.cos(angle) * a * PATH_FORWARD_EXTENT * dirY + Math.sin(angle) * b * PATH_LATERAL_EXTENT * perpY, margin); }).every(Boolean)
        : centerX - halfX >= arena.left + margin && centerX + halfX <= arena.right - margin &&
          centerY - halfY >= arena.top + margin && centerY + halfY <= arena.bottom - margin;
      if (fits) break;
      a *= 0.85;
      b *= 0.85;
    }
    // 只有在几乎贴墙、确实没有完整大环空间时才会落到这里；不强行维持
    // 原来的最小椭圆，否则会再次依赖硬钳位制造折线。
    a = Math.max(1.5, a);
    b = Math.max(1, b);
    const pathProfile = createPathProfile(a, b, loopDirection);
    const flightDuration = clamp(
      pathProfile.length / FLIGHT_PATH_SPEED,
      MIN_FLIGHT_DURATION,
      MAX_FLIGHT_DURATION
    );
    return {
      dirX,
      dirY,
      perpX,
      perpY,
      a,
      b,
      launch,
      loopDirection,
      pathProfile,
      flightDuration
    };
  }

  // 斧头造型：一根长木柄 + 装在柄端的单刃斧头。
  // 判定上能砍人的“斧刃”就是柄端那块 15×15 的方框，所以整块斧头都压在这
  // 个方框里 —— 看上去能砍到的，就是画出来的那一块。
  // 自身坐标系：+x 沿柄指向斧头端，+y 是刃口展开的一侧。
  // 让人一眼认出“这是斧头”靠四件事：柄又长又直、握把缠皮；斧头装在柄端而
  // 不是柄中间；刃口垂直于柄铺开成一条外凸大弧（而不是顺着柄尖伸出去的矛
  // 尖）；刃口背面留一小块方钝的斧背，柄从斧眼里穿过去。
  function drawAxeShape(context, length) {
    const half = length / 2;
    const tailX = -half + 0.6;
    const tipX = BLADE_OFFSET + 1.7;
    const eyeX = BLADE_OFFSET - 0.3;
    const eyeHalfX = 2.9;
    const eyeHalfY = 2.05;
    const pollLeftY = -4.3;
    const pollRightY = -3.8;

    // 斧眼暗底：柄填不满的那一小格透出阴影，不会漏出背景。
    context.fillStyle = "#2b3137";
    context.beginPath();
    context.moveTo(eyeX + eyeHalfX + 0.6, 0);
    context.ellipse(eyeX, 0, eyeHalfX + 0.6, eyeHalfY + 0.55, 0, 0, TWO_PI);
    context.fill();

    // 木柄：柄尾一个圆头，中段略微鼓肚，一直插进斧眼里。
    context.beginPath();
    context.moveTo(tailX - 0.5, 0);
    context.quadraticCurveTo(tailX - 0.9, -2.75, tailX + 1.6, -2.05);
    context.quadraticCurveTo(0, -2.78, tipX - 2.2, -2.45);
    context.quadraticCurveTo(tipX + 0.9, -2.5, tipX + 0.9, 0);
    context.quadraticCurveTo(tipX + 0.9, 2.5, tipX - 2.2, 2.45);
    context.quadraticCurveTo(0, 2.78, tailX + 1.6, 2.05);
    context.quadraticCurveTo(tailX - 0.9, 2.75, tailX - 0.5, 0);
    context.closePath();
    const wood = typeof context.createLinearGradient === "function"
      ? context.createLinearGradient(0, -2.8, 0, 2.8)
      : null;
    if (wood) {
      wood.addColorStop(0, "#6b441c");
      wood.addColorStop(0.28, "#a9743a");
      wood.addColorStop(0.6, HANDLE_COLOR);
      wood.addColorStop(1, "#4a3017");
      context.fillStyle = wood;
    } else {
      context.fillStyle = HANDLE_COLOR;
    }
    context.fill();
    context.strokeStyle = HANDLE_DARK;
    context.lineWidth = 1;
    context.stroke();

    // 木纹：两条顺柄走的细线，别让柄看起来像根塑料管。
    context.strokeStyle = "rgba(74, 46, 20, 0.45)";
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(tailX + 2.6, -0.5);
    context.quadraticCurveTo(-6, -0.15, tipX - 3.6, -0.8);
    context.moveTo(tailX + 3.1, 0.8);
    context.quadraticCurveTo(-4, 1.3, tipX - 3.0, 0.7);
    context.stroke();

    // 握把缠皮：柄尾一段深色皮革，里面压斜向绑绳。
    const gripStart = tailX + 1.5;
    const gripEnd = -4.6;
    context.save();
    context.beginPath();
    context.moveTo(gripStart, -2.05);
    context.lineTo(gripEnd, -2.2);
    context.lineTo(gripEnd, 2.2);
    context.lineTo(gripStart, 2.05);
    context.closePath();
    context.fillStyle = "#52361a";
    context.fill();
    context.clip();
    context.strokeStyle = "rgba(30, 19, 9, 0.85)";
    context.lineWidth = 0.95;
    context.beginPath();
    for (let index = 0; index < 9; index += 1) {
      const x = gripStart + 0.6 + index * 1.8;
      context.moveTo(x, -2.5);
      context.lineTo(x + 1.5, 2.5);
    }
    context.stroke();
    context.restore();
    context.strokeStyle = "rgba(26, 16, 7, 0.9)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(gripStart, -2.05);
    context.lineTo(gripEnd, -2.2);
    context.lineTo(gripEnd, 2.2);
    context.lineTo(gripStart, 2.05);
    context.closePath();
    context.stroke();
    context.strokeStyle = "rgba(255, 214, 160, 0.2)";
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(gripStart + 0.5, -1.3);
    context.lineTo(gripEnd - 0.4, -1.45);
    context.stroke();

    // 斧头本体：平口斧背 → 内凹的颈 → 外凸的刃口 → 下垂的胡须回到斧背。
    context.beginPath();
    context.moveTo(eyeX - 2.6, pollLeftY);
    context.lineTo(eyeX + 2.7, pollRightY);
    context.quadraticCurveTo(eyeX + 2.2, 0.9, eyeX + 7.4, 6.2);
    context.quadraticCurveTo(eyeX + 0.3, 9.0, eyeX - 7.2, 5.4);
    context.quadraticCurveTo(eyeX - 8.0, 1.4, eyeX - 2.6, pollLeftY);
    context.closePath();
    // 斧眼：第二条子路径，用 evenodd 挖空，让底下的木柄从眼里透出来。
    context.moveTo(eyeX + eyeHalfX, 0);
    context.ellipse(eyeX, 0, eyeHalfX, eyeHalfY, 0, 0, TWO_PI);
    const steel = typeof context.createLinearGradient === "function"
      ? context.createLinearGradient(0, pollLeftY, 0, 7.4)
      : null;
    if (steel) {
      steel.addColorStop(0, "#7f8994");
      steel.addColorStop(0.34, HEAD_COLOR);
      steel.addColorStop(0.74, "#e3e9ef");
      steel.addColorStop(1, "#a9b3be");
      context.fillStyle = steel;
    } else {
      context.fillStyle = HEAD_COLOR;
    }
    context.fill("evenodd");
    context.strokeStyle = HEAD_DARK;
    context.lineWidth = 1.1;
    context.stroke();

    // 斧背高光：平口上压一条亮边，把“背”和“刃”分开。
    context.strokeStyle = "rgba(255, 255, 255, 0.38)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(eyeX - 2.1, pollLeftY + 0.75);
    context.lineTo(eyeX + 2.4, pollRightY + 0.75);
    context.stroke();
    // 内侧暗面：顺着胡须压一道，免得整块钢看起来像一块平板。
    context.strokeStyle = "rgba(88, 98, 110, 0.45)";
    context.lineWidth = 0.9;
    context.beginPath();
    context.moveTo(eyeX - 6.2, 4.0);
    context.quadraticCurveTo(eyeX - 7.0, 1.2, eyeX - 2.2, -3.4);
    context.stroke();

    // 刃口：亮斜面 + 分界暗线 + 极亮的刃线，三段都收在外缘以内。
    context.strokeStyle = "rgba(255, 255, 255, 0.5)";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(eyeX + 6.5, 4.9);
    context.quadraticCurveTo(eyeX + 0.3, 7.5, eyeX - 6.5, 4.1);
    context.stroke();
    context.strokeStyle = "rgba(96, 106, 118, 0.5)";
    context.lineWidth = 0.75;
    context.beginPath();
    context.moveTo(eyeX + 6.0, 3.5);
    context.quadraticCurveTo(eyeX + 0.3, 6.1, eyeX - 6.1, 2.8);
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(eyeX + 7.0, 5.9);
    context.quadraticCurveTo(eyeX + 0.3, 8.4, eyeX - 6.9, 5.1);
    context.stroke();

    // 斧眼：压一圈暗边，再在斧眼旁点两颗铆钉，坐实“柄穿过斧头”。
    context.strokeStyle = "rgba(26, 32, 38, 0.85)";
    context.lineWidth = 0.9;
    context.beginPath();
    context.moveTo(eyeX + eyeHalfX, 0);
    context.ellipse(eyeX, 0, eyeHalfX, eyeHalfY, 0, 0, TWO_PI);
    context.stroke();
    // 柄端楔子：木柄穿过斧眼后露头的那一小段端面。
    context.strokeStyle = "rgba(38, 24, 10, 0.9)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(tipX - 0.7, -1.5);
    context.lineTo(tipX - 0.5, 1.5);
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.5)";
    for (const rivetY of [-1.5, 1.5]) {
      context.beginPath();
      context.arc(eyeX - 3.7, rivetY, 0.5, 0, TWO_PI);
      context.fill();
    }
  }

  // 飞行中补一道很淡的旋转残影：8 圈/秒在 30fps 下每帧要转将近 100°，没有
  // 这道弧线看起来只是“一闪一闪”，而不是“在飞、在转”。
  function drawSpinSmear(context, entity) {
    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.13)";
    context.lineWidth = 3.2;
    context.lineCap = "round";
    context.beginPath();
    context.arc(0, 0, BLADE_OFFSET + 1.5, entity.spin - 2.1, entity.spin);
    context.stroke();
    context.restore();
  }

  function drawAxe(context, entity) {
    context.save();
    context.translate(Math.round(entity.x), Math.round(entity.y));
    if (entity.mode === FLYING_MODE) drawSpinSmear(context, entity);
    context.rotate(entity.spin);
    drawAxeShape(context, AXE_LENGTH);
    context.restore();
  }

  const throwingAxeDefinition = {
    id: "throwingAxe",
    name: "飞斧",
    englishName: "Throwing Axe",
    color: BODY_COLOR,
    description: "扔回旋斧 / 只有斧刃能砍人 / 回旋轨迹随场地空间调整 / 收回冷却2s",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    // Rion 借用时按最长可能的飞行时长预留窗口，短轨迹仍会正常提前收回。
    rionCycleDuration: MAX_FLIGHT_DURATION + THROW_COOLDOWN,
    createBehavior(services) {
      let ownerBall = null;
      let axeEntity = null;
      let phase = "ready";
      let cooldownElapsed = 0;
      let aimAngle = 0;
      let throwCount = 0;

      function aimDirection(ball) {
        const target = services.getOpponent();
        if (target) {
          return normalizeDirection(
            target.x - ball.x,
            target.y - ball.y,
            ball.storedVx || ball.vx,
            ball.storedVy || ball.vy
          );
        }
        return normalizeDirection(
          ball.storedVx || ball.vx,
          ball.storedVy || ball.vy,
          Math.cos(aimAngle),
          Math.sin(aimAngle)
        );
      }

      function updateAim(ball) {
        const direction = aimDirection(ball);
        aimAngle = Math.atan2(direction.y, direction.x);
      }

      // 斧头一直是有实体的战斗实体：握在手里时也能用斧刃砍到人。
      function ensureAxeEntity(ball) {
        if (axeEntity && axeEntity.entityActive !== false) return axeEntity;
        const anchor = heldAnchor(ball, aimAngle);
        axeEntity = services.spawnCombatEntity({
          kind: "throwing-axe",
          combatKind: "projectile",
          lifecycle: "owner-bound",
          borrowedAttackClock: true,
          drawLayer: "foreground",
          life: PERMANENT_LIFE,
          radius: BLADE_SIZE / 2,
          length: AXE_LENGTH,
          bladeSize: BLADE_SIZE,
          bladeOffset: BLADE_OFFSET,
          mode: HELD_MODE,
          x: anchor.x,
          y: anchor.y,
          vx: 0,
          vy: 0,
          spin: aimAngle,
          airTime: 0,
          flightDuration: LOOP_PERIOD,
          loopDirection: 1,
          pathProfile: null,
          dustTimer: DUST_INTERVAL,
          maxExcursion: 0,
          insideTime: 0,
          outsideTime: 0,
          contacts: new Set(),
          update({ entity, game, services: axeServices }, dt) {
            advanceAxe(entity, game, dt, axeServices);
          },
          draw({ entity }, canvasContext) {
            if (!services.borrowedAttackOnly) drawAxe(canvasContext, entity);
          }
        });
        return axeEntity;
      }

      function resetBladeWindow(axe) {
        axe.contacts.clear();
        axe.airTime = 0;
        axe.maxExcursion = 0;
        axe.insideTime = 0;
        axe.outsideTime = 0;
        axe.dustTimer = DUST_INTERVAL;
      }

      function throwAxe(ball, arenaSize) {
        const direction = aimDirection(ball);
        aimAngle = Math.atan2(direction.y, direction.x);
        const axe = ensureAxeEntity(ball);
        if (!axe) return;
        // 交替左右绕行：同一个敌人连续被追击时，飞斧不会在同一条机械轨道上
        // 重复叠画，回旋的观感更接近真正的回旋镖。
        const loopDirection = throwCount % 2 === 0 ? 1 : -1;
        const geometry = computeBoomerangGeometry(ball, arenaSize, aimAngle, loopDirection);
        resetBladeWindow(axe);
        axe.mode = FLYING_MODE;
        axe.spin = aimAngle;
        // 回旋环线的近端 = 本体前方一点点（出手点），整个环沿瞄准方向扫向敌人。
        axe.loopDirX = geometry.dirX;
        axe.loopDirY = geometry.dirY;
        axe.loopPerpX = geometry.perpX;
        axe.loopPerpY = geometry.perpY;
        axe.loopA = geometry.a;
        axe.loopB = geometry.b;
        axe.launch = geometry.launch;
        axe.loopDirection = geometry.loopDirection;
        axe.pathProfile = geometry.pathProfile;
        axe.flightDuration = geometry.flightDuration;
        const launchPosition = pathPosition(ball, geometry, 0);
        axe.x = launchPosition.x;
        axe.y = launchPosition.y;
        // 速度由曲线的局部弧长决定，而不是椭圆参数角。这样在长轴/短轴之间
        // 转弯时不会忽快忽慢，同时保留本体移动带来的整体速度。
        axe.vx = ball.vx || 0;
        axe.vy = ball.vy || 0;
        throwCount += 1;
        phase = "flying";
      }

      function retrieveAxe() {
        const axe = axeEntity;
        const ball = ownerBall;
        if (!axe || !ball) return;
        axe.mode = HELD_MODE;
        resetBladeWindow(axe);
        // 接住的同一帧就把手位摆好，避免下一帧才吸附造成半帧错位。
        const anchor = heldAnchor(ball, aimAngle);
        axe.x = anchor.x;
        axe.y = anchor.y;
        axe.spin = aimAngle;
        axe.vx = ball.vx || 0;
        axe.vy = ball.vy || 0;
        axe.pathProfile = null;
        axe.flightDuration = LOOP_PERIOD;
        phase = "cooling";
        cooldownElapsed = 0;
      }

      function advanceAxe(axe, arenaSize, dt, axeServices) {
        const ball = ownerBall;
        if (!ball || ball.hp <= 0) {
          axe.entityActive = false;
          axeEntity = null;
          return;
        }
        if (axe.mode === FLYING_MODE) {
          const elapsed = Math.max(0, dt);
          axe.airTime += elapsed;
          const duration = Math.max(EPSILON, axe.flightDuration || LOOP_PERIOD);
          const progress = clamp(axe.airTime / duration, 0, 1);
          if (axe.loopA > 0 && axe.pathProfile) {
            const geometry = {
              dirX: axe.loopDirX,
              dirY: axe.loopDirY,
              perpX: axe.loopPerpX,
              perpY: axe.loopPerpY,
              a: axe.loopA,
              b: axe.loopB,
              launch: axe.launch,
              pathProfile: axe.pathProfile
            };
            const position = pathPosition(ball, geometry, progress);
            axe.x = position.x;
            axe.y = position.y;

            // 用很小的中心差分读取曲线切线，避免为弧长重参数化再维护一套容易
            // 出错的解析导数。它也能自然包含曲线的前后扫动与左右绕行。
            const sample = Math.min(0.01, 0.25 / duration);
            const beforeProgress = Math.max(0, progress - sample);
            const afterProgress = Math.min(1, progress + sample);
            const before = pathPosition(ball, geometry, beforeProgress);
            const after = pathPosition(ball, geometry, afterProgress);
            const denominator = Math.max(EPSILON, (afterProgress - beforeProgress) * duration);
            axe.vx = (ball.vx || 0) + (after.x - before.x) / denominator;
            axe.vy = (ball.vy || 0) + (after.y - before.y) / denominator;
          } else {
            // 测试或外部调试可以把斧头钉在当前位置（loopA=0）；这种状态
            // 仍然允许斧刃做命中判定，但不能尝试读取不存在的路径表。
            axe.vx = ball.vx || 0;
            axe.vy = ball.vy || 0;
          }
          // 几何包围盒已提前避开边界；这里仅作极端传送/换场地时的最后保险，
          // 正常轨迹不会走到硬钳位分支。
          bounceOffArena(axe, arenaSize);
          // 飞行中持续自转，8 圈/秒；spin 单调累加，便于按角度测速。
          axe.spin += SPIN_RATE * elapsed;
          const relative = relativeToBall(axe, ball);
          axe.maxExcursion = Math.max(axe.maxExcursion, relative.distance);
          if (isInsideArena(axe, arenaSize)) axe.insideTime += elapsed;
          else axe.outsideTime += elapsed;
          emitDust(axe, ball, dt, axeServices);
          resolveBladeContacts(axe, axeServices);
          // 一次完整环线后近端就回到本体前方，收手。
          if (axe.airTime + EPSILON >= duration) retrieveAxe();
          return;
        }
        // 握持：斧头跟着本体走，刃口朝当前瞄准方向，同样参与命中判定。
        const anchor = heldAnchor(ball, aimAngle);
        axe.x = anchor.x;
        axe.y = anchor.y;
        axe.vx = ball.vx || 0;
        axe.vy = ball.vy || 0;
        axe.spin = aimAngle;
        resolveBladeContacts(axe, axeServices);
      }

      function emitDust(axe, ball, dt, axeServices) {
        axe.dustTimer += Math.max(0, dt);
        if (axe.dustTimer < DUST_INTERVAL) return;
        axe.dustTimer = 0;
        const tail = normalizeDirection(-axe.vx, -axe.vy, ball.x - axe.x, ball.y - axe.y);
        axeServices.spawnParticleBurst({
          kind: DUST_KIND,
          x: axe.x + tail.x * 6,
          y: axe.y + tail.y * 6,
          life: 0.34,
          density: 0.2,
          minDiameter: 1,
          maxDiameter: 3,
          minSpeed: 5,
          maxSpeed: 26,
          initialRadius: 3,
          drag: 2.8,
          colors: DUST_COLORS
        });
      }

      // 只有 15×15 的斧刃能造成伤害；一次接触结算一次，脱离后再接触才算下一次。
      function resolveBladeContacts(axe, axeServices) {
        const blade = bladeCenter(axe.x, axe.y, axe.spin);
        const touching = new Set();
        axeServices.forEachEnemy((target) => {
          if (!axeServices.getContactProfile(target).attackable) return;
          if (!bladeContact(blade.x, blade.y, axe.spin, target)) return;
          const key = target.instanceId;
          touching.add(key);
          if (axe.contacts.has(key)) return;
          axe.contacts.add(key);
          const dealt = axeServices.dealDamage(target, BLADE_DAMAGE);
          if (dealt) {
            // 与若藻同款的斩击特效：复用她的视效工厂，只换个归属 kind。
            axeServices.createVisualEffect(
              ({ random }) => createSlashEffect(target, { kind: SLASH_KIND, random })
            );
          }
        });
        for (const key of axe.contacts) {
          if (!touching.has(key)) axe.contacts.delete(key);
        }
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          updateAim(context.ball);
          ensureAxeEntity(context.ball);
        },
        update(context, dt) {
          // Rion 不会派发 onSpawn，这里懒初始化保证两种路径都拿得到斧头。
          if (!ownerBall) ownerBall = context.ball;
          updateAim(context.ball);
          ensureAxeEntity(context.ball);
          if (phase !== "cooling") return;
          cooldownElapsed = Math.min(THROW_COOLDOWN, cooldownElapsed + Math.max(0, dt));
        },
        getNextTransitionIn() {
          if (phase !== "cooling") return undefined;
          return Math.max(EPSILON, THROW_COOLDOWN - cooldownElapsed);
        },
        afterUpdateStep(context) {
          const ball = context.ball;
          ownerBall = ball;
          if (phase === "ready") {
            throwAxe(ball, context.game);
            return;
          }
          if (phase === "cooling" && cooldownElapsed + EPSILON >= THROW_COOLDOWN) {
            phase = "ready";
            cooldownElapsed = 0;
            throwAxe(ball, context.game);
          }
        },
        getContactProfile() {
          // 本体是一颗正常的球：有碰撞体积、可以被攻击；
          // 只是自己不造成碰撞伤害，伤害全部来自斧刃。
          return { solid: true, attackable: true };
        },
        onBorrowEnd() {
          if (axeEntity) {
            axeEntity.entityActive = false;
            axeEntity = null;
          }
          phase = "cooling";
          cooldownElapsed = 0;
        },
        onAttackBorrowStart(context) { throwAxe(context.ball, context.game); },
        isAttackCycleComplete() { return throwCount > 0 && phase === "cooling"; },
        drawBorrowedWeapon(context, canvasContext) {
          if (axeEntity) drawAxe(canvasContext, axeEntity);
          else {
            const anchor = heldAnchor(context.ball, aimAngle);
            drawAxe(canvasContext, { x: anchor.x, y: anchor.y, mode: HELD_MODE,
              spin: aimAngle, length: AXE_LENGTH });
          }
        },
        getAxeState() {
          const ball = ownerBall;
          const axe = axeEntity;
          const blade = axe ? bladeCenter(axe.x, axe.y, axe.spin) : null;
          return {
            phase,
            mode: axe ? axe.mode : null,
            cooldownElapsed,
            cooldownRemaining: phase === "cooling"
              ? Math.max(0, THROW_COOLDOWN - cooldownElapsed)
              : 0,
            throwCount,
            aimAngle,
            spin: axe ? axe.spin : null,
            airTime: axe && axe.mode === FLYING_MODE ? axe.airTime : 0,
            flightDuration: axe && axe.mode === FLYING_MODE ? axe.flightDuration : 0,
            loopDirection: axe && axe.mode === FLYING_MODE ? axe.loopDirection : 0,
            distance: axe && ball ? Math.hypot(axe.x - ball.x, axe.y - ball.y) : 0,
            maxExcursion: axe ? axe.maxExcursion : 0,
            insideTime: axe ? axe.insideTime : 0,
            outsideTime: axe ? axe.outsideTime : 0,
            axe: axe ? { x: axe.x, y: axe.y } : null,
            blade
          };
        }
      };
    }
  };

  registerBall(throwingAxeDefinition);

  return {
    throwingAxeDefinition,
    throwingAxeGeometry: Object.freeze({
      AXE_LENGTH,
      BLADE_SIZE,
      BLADE_OFFSET,
      SPIN_RATE,
      SPIN_REVOLUTIONS_PER_SECOND,
      THROW_COOLDOWN,
      BLADE_DAMAGE,
      LOOP_A,
      LOOP_B,
      LOOP_PERIOD,
      FLIGHT_PATH_SPEED,
      MIN_FLIGHT_DURATION,
      MAX_FLIGHT_DURATION,
      PATH_SAMPLES
    }),
    bladeContact,
    bladeCenter,
    heldAnchor
  };
});
