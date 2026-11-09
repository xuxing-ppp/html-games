(function initializeLiaogang(root, factory) {
  const dependencies = typeof module === "object" && module.exports ? require("../core/ball-registry.js") : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiaogangPlugin({ resolveArenaGeometry, registerBall }) {
  const INTERVAL = 3.4;
  const WORM_SPEED = 50;
  const WORM_RADIUS = 3.2;
  const WORM_LIFE = 14;
  const WORM_BODY_LENGTH = 15;
  const WORM_SEGMENTS = 6;
  const WORM_EDGE_OFFSET = 9;
  const POISON_ID = "liaogang-poison";
  const POISON_SPEED_FACTOR = 0.9;
  const EPSILON = 1e-9;

  // ------------------------------------------------------------------
  // 视觉调色板：只影响画面，不动任何数值（间隔/伤害/减速/蛆虫参数都在上面）。
  // ------------------------------------------------------------------
  const PALETTE = Object.freeze({
    pitRim: "#3a2b0f",
    pitLip: "#6d5a1c",
    pitDeep: "#5c4a13",
    pitMid: "#8a7326",
    pitSurface: "#a8912f",
    scum: "#5d7a1e",
    scumLight: "#93a832",
    debris: "#463516",
    foam: "#d8c98a",
    gas: "#ecdc9e",
    poison: "#7dff56",
    poisonBright: "#b6ff86",
    poisonDark: "#2f6b16",
    wormBody: "#f3e9c4",
    wormBodyAlt: "#e7d9aa",
    wormEdge: "rgba(178, 158, 106, 0.85)",
    wormShine: "rgba(255, 253, 232, 0.9)",
    wormMouth: "#4a3a1c"
  });
  const TAU = Math.PI * 2;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function baseAlpha(context) {
    return Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
  }

  // 渐变只是锦上添花：假 context（测试里的 stub）没有渐变 API 时退回纯色。
  function radialPaint(context, x0, y0, r0, x1, y1, r1, stops, fallback) {
    if (typeof context.createRadialGradient !== "function") return fallback;
    const gradient = context.createRadialGradient(x0, y0, r0, x1, y1, r1);
    if (!gradient || typeof gradient.addColorStop !== "function") return fallback;
    for (let index = 0; index < stops.length; index += 1) {
      gradient.addColorStop(stops[index][0], stops[index][1]);
    }
    return gradient;
  }

  function linearPaint(context, x0, y0, x1, y1, stops, fallback) {
    if (typeof context.createLinearGradient !== "function") return fallback;
    const gradient = context.createLinearGradient(x0, y0, x1, y1);
    if (!gradient || typeof gradient.addColorStop !== "function") return fallback;
    for (let index = 0; index < stops.length; index += 1) {
      gradient.addColorStop(stops[index][0], stops[index][1]);
    }
    return gradient;
  }

  function createPoisonEffect() {
    return {
      id: POISON_ID,
      duration: Number.MAX_SAFE_INTEGER,
      combatKind: "dot",
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: POISON_SPEED_FACTOR,
      // 中毒样板：贴身病气 + 脉动毒环 + 公转毒沫（含上浮毒气丝）。
      draw({ ball, game }, context) {
        const time = Number.isFinite(game && game.time) ? game.time : 0;
        const base = baseAlpha(context);
        const radius = ball.radius;
        const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
        const frame = Math.floor(time * 12);
        context.save();

        // 病气：一层很淡的绿雾，把目标染成“被泡过”的样子
        context.globalAlpha = base * (0.07 + pulse * 0.05);
        context.fillStyle = PALETTE.poison;
        context.beginPath();
        context.arc(ball.x, ball.y, radius + 2, 0, TAU);
        context.fill();

        // 毒环：呼吸式扩张
        context.globalAlpha = base * (0.2 + pulse * 0.16);
        context.strokeStyle = PALETTE.poison;
        context.lineWidth = 1.6;
        context.beginPath();
        context.arc(ball.x, ball.y, radius + 2.4 + pulse * 1.4, 0, TAU);
        context.stroke();

        for (let index = 0; index < 6; index += 1) {
          const angle = index * TAU / 6 + frame * 0.16;
          const distance = radius + 4 + ((frame + index * 3) % 4) * 0.8 + pulse;
          const x = Math.round(ball.x + Math.cos(angle) * distance);
          const y = Math.round(ball.y + Math.sin(angle) * distance);
          const size = index % 2 === 0 ? 3 : 2;

          // 毒沫：亮绿方块 + 深绿描边，保持像素味
          context.globalAlpha = base * 0.88;
          context.fillStyle = index % 2 === 0 ? PALETTE.poison : PALETTE.poisonBright;
          context.fillRect(x - size / 2, y - size / 2, size, size);
          context.globalAlpha = base * 0.55;
          context.strokeStyle = PALETTE.poisonDark;
          context.lineWidth = 0.6;
          if (typeof context.strokeRect === "function") {
            context.strokeRect(x - size / 2, y - size / 2, size, size);
          }

          // 毒气丝：一截两段地上飘
          const phase = (frame + index * 2) % 5;
          context.globalAlpha = base * (0.32 - phase * 0.055);
          context.strokeStyle = PALETTE.poison;
          context.lineWidth = 0.9;
          context.beginPath();
          context.moveTo(x, y - 1.6);
          context.lineTo(x, y - 3.2 - phase * 1.5);
          context.stroke();
        }
        context.restore();
      }
    };
  }

  // 场地：一坑稠泥。分五层画——泥浆底色、翻涌泥团、悬浮泥沙、上升沼气、表面浮渣。
  function drawMudBackground({ game }, context) {
    const arenaSize = game.arenaSize;
    const time = Number.isFinite(game && game.time) ? game.time : 0;
    const center = arenaSize / 2;
    context.save();

    // 1) 稀稠不均：中间稀（亮），四周稠（暗），再加一层上深下浅的沉积感
    context.fillStyle = radialPaint(
      context,
      center,
      center,
      arenaSize * 0.08,
      center,
      center,
      arenaSize * 0.76,
      [
        [0, "rgba(182, 154, 74, 0.10)"],
        [0.5, "rgba(158, 126, 46, 0.24)"],
        [1, "rgba(100, 78, 26, 0.32)"]
      ],
      "rgba(158, 126, 46, 0.26)"
    );
    context.fillRect(0, 0, arenaSize, arenaSize);
    context.fillStyle = linearPaint(
      context,
      0,
      0,
      0,
      arenaSize,
      [
        [0, "rgba(70, 52, 16, 0.16)"],
        [0.45, "rgba(120, 96, 34, 0.06)"],
        [1, "rgba(186, 158, 78, 0.08)"]
      ],
      "rgba(120, 96, 34, 0.08)"
    );
    context.fillRect(0, 0, arenaSize, arenaSize);

    // 2) 缓慢翻涌的浓稠泥团：换成柔边渐变，避免出现硬边大椭圆
    const swirls = [
      [0.24, 0.3, 0.27, 0.06], [0.68, 0.22, 0.22, 0.09],
      [0.42, 0.72, 0.3, 0.07], [0.86, 0.66, 0.2, 0.11]
    ];
    for (let index = 0; index < swirls.length; index += 1) {
      const [px, py, sizeRatio, speed] = swirls[index];
      const radius = sizeRatio * arenaSize;
      const x = px * arenaSize + Math.sin(time * speed + index * 1.9) * arenaSize * 0.045;
      const y = py * arenaSize + Math.cos(time * speed * 0.8 + index * 2.7) * arenaSize * 0.035;
      const darker = index % 2 === 0;
      context.fillStyle = radialPaint(
        context,
        x,
        y,
        radius * 0.12,
        x,
        y,
        radius,
        darker
          ? [[0, "rgba(84, 62, 18, 0.15)"], [0.6, "rgba(84, 62, 18, 0.08)"], [1, "rgba(84, 62, 18, 0)"]]
          : [[0, "rgba(214, 186, 104, 0.11)"], [0.6, "rgba(214, 186, 104, 0.05)"], [1, "rgba(214, 186, 104, 0)"]],
        darker ? "rgba(84, 62, 18, 0.11)" : "rgba(214, 186, 104, 0.08)"
      );
      context.beginPath();
      context.ellipse(
        x,
        y,
        radius,
        radius * (0.68 + 0.1 * Math.sin(index * 1.3 + time * 0.18)),
        index * 0.7 + time * 0.04,
        0,
        TAU
      );
      context.fill();
    }

    // 3) 悬浮泥沙：颗粒顺流向拉长，越暗的越沉
    const particles = [
      [0.18, 0.24, 2.6, 0.9], [0.36, 0.62, 3.4, 1.3], [0.58, 0.31, 2.2, 0.8],
      [0.74, 0.68, 3.0, 1.1], [0.88, 0.42, 2.4, 0.9], [0.12, 0.78, 2.0, 0.7],
      [0.47, 0.47, 2.8, 1.2], [0.65, 0.14, 2.2, 0.8], [0.27, 0.9, 2.6, 1.0],
      [0.82, 0.86, 2.2, 0.8], [0.05, 0.45, 2.4, 0.9], [0.93, 0.6, 2.8, 1.0]
    ];
    for (let index = 0; index < particles.length; index += 1) {
      const [px, py, size, speed] = particles[index];
      const driftX = Math.sin(time * speed * 0.5 + index * 1.7) * 7;
      const driftY = Math.cos(time * speed * 0.35 + index * 2.3) * 5;
      const x = ((px * arenaSize + driftX) % arenaSize + arenaSize) % arenaSize;
      const y = ((py * arenaSize + driftY) % arenaSize + arenaSize) % arenaSize;
      context.fillStyle = index % 2 === 0
        ? "rgba(96, 73, 24, 0.19)"
        : "rgba(230, 204, 124, 0.14)";
      context.beginPath();
      context.ellipse(
        x,
        y,
        size * 1.35,
        size * 0.62,
        Math.atan2(driftY, driftX),
        0,
        TAU
      );
      context.fill();
    }

    // 4) 上升沼气：变大 → 到顶破裂成一圈浮渣环
    const bubbles = [
      [0.22, 52, 0.21], [0.55, 38, 0.16], [0.79, 66, 0.24],
      [0.34, 45, 0.19], [0.9, 58, 0.17], [0.45, 34, 0.14], [0.66, 61, 0.2]
    ];
    for (let index = 0; index < bubbles.length; index += 1) {
      const [px, riseSpeed, radius] = bubbles[index];
      const cycle = (time * riseSpeed + index * 0.37) % 1;
      const popProgress = clamp((cycle - 0.88) / 0.12, 0, 1);
      const x = px * arenaSize;
      const y = arenaSize - cycle * arenaSize;
      const rise = radius * (0.7 + cycle * 0.55);
      if (popProgress > 0) {
        // 破了：一圈很小的浮渣涟漪
        context.globalAlpha = 0.5 * (1 - popProgress);
        context.strokeStyle = PALETTE.foam;
        context.lineWidth = 0.9;
        context.beginPath();
        context.arc(x, y, rise + popProgress * 7, 0, TAU);
        context.stroke();
        context.globalAlpha = 1;
        continue;
      }
      const alpha = Math.sin(clamp(cycle / 0.88, 0, 1) * Math.PI);
      context.fillStyle = `rgba(238, 214, 132, ${0.18 * alpha + 0.05})`;
      context.strokeStyle = `rgba(244, 226, 158, ${0.34 * alpha + 0.08})`;
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(x, y, rise, 0, TAU);
      context.fill();
      context.stroke();
      // 沼气顶上的高光点：一眼看出是气泡而不是圆点
      context.fillStyle = `rgba(255, 250, 220, ${0.5 * alpha})`;
      context.beginPath();
      context.arc(x - rise * 0.34, y - rise * 0.36, Math.max(0.5, rise * 0.26), 0, TAU);
      context.fill();
    }

    // 5) 表面浮渣带 + 零星草屑
    const froth = [[0.16, 0.14, 0.2], [0.46, 0.08, 0.26], [0.72, 0.19, 0.18]];
    for (let index = 0; index < froth.length; index += 1) {
      const [px, py, width] = froth[index];
      const x = ((px * arenaSize + Math.sin(time * 0.12 + index) * 9) % arenaSize + arenaSize) % arenaSize;
      const y = py * arenaSize + Math.cos(time * 0.09 + index * 2) * 5;
      context.fillStyle = index % 2 === 0
        ? "rgba(216, 201, 138, 0.14)"
        : "rgba(146, 168, 50, 0.12)";
      context.beginPath();
      context.ellipse(x, y, width * arenaSize * 0.5, 2.6, 0, 0, TAU);
      context.fill();
    }
    const debris = [[0.31, 0.52, 1.2], [0.62, 0.79, 0.8], [0.83, 0.28, 1.1], [0.09, 0.7, 0.9]];
    for (let index = 0; index < debris.length; index += 1) {
      const [px, py, speed] = debris[index];
      const angle = index * 1.1 + time * speed * 0.06;
      const x = ((px * arenaSize + Math.cos(angle) * 10) % arenaSize + arenaSize) % arenaSize;
      const y = ((py * arenaSize + Math.sin(angle * 0.9) * 8) % arenaSize + arenaSize) % arenaSize;
      context.strokeStyle = "rgba(58, 43, 15, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x - Math.cos(angle) * 4, y - Math.sin(angle) * 4);
      context.lineTo(x + Math.cos(angle) * 4, y + Math.sin(angle) * 4);
      context.stroke();
    }
    context.restore();
  }

  // 米白色蛆：一节节膨大缩小、身体随运动方向折弯。
  // stage 1 = 已咬住目标：身体绷紧、嘴部泛起吸吮绿环并轻微挣扎。
  function drawWorm(entity, context) {
    const speed = Math.hypot(entity.vx, entity.vy) || WORM_SPEED;
    const directionX = entity.vx / speed;
    const directionY = entity.vy / speed;
    const normalX = -directionY;
    const normalY = directionX;
    const angle = Math.atan2(directionY, directionX);
    const phase = Number.isFinite(entity.wormPhase) ? entity.wormPhase : 0;
    const biting = entity.stage === 1;
    const shake = biting ? Math.sin(phase * 2.6) * 0.5 : 0;
    const tailBend = Math.sin(phase * 0.85 - 5.2) * 2.1;
    context.save();
    context.globalAlpha *= 0.94;

    // 泥面影子：让蛆贴在坑里，而不是浮在坑上
    context.fillStyle = "rgba(48, 36, 12, 0.26)";
    context.beginPath();
    context.ellipse(
      entity.x - directionX * WORM_BODY_LENGTH * 0.45,
      entity.y - directionY * WORM_BODY_LENGTH * 0.45 + 1.5,
      WORM_BODY_LENGTH * 0.46,
      biting ? 2.2 : 1.7,
      angle,
      0,
      TAU
    );
    context.fill();

    // 尾巴后面拖出的一小截
    const tailX = entity.x - directionX * WORM_BODY_LENGTH + normalX * tailBend;
    const tailY = entity.y - directionY * WORM_BODY_LENGTH + normalY * tailBend;
    context.lineCap = "round";
    context.strokeStyle = "rgba(231, 217, 170, 0.45)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(tailX, tailY);
    context.lineTo(
      tailX - directionX * (3.2 + Math.sin(phase * 1.3) * 0.6),
      tailY - directionY * (3.2 + Math.sin(phase * 1.3) * 0.6)
    );
    context.stroke();

    // 从尾到头逐节绘制，蠕动波由后向前传播
    for (let index = 0; index < WORM_SEGMENTS; index += 1) {
      const progress = index / (WORM_SEGMENTS - 1); // 0 = 尾, 1 = 头
      const along = progress * WORM_BODY_LENGTH;
      const swell = Math.sin(phase - progress * 4.4);
      const squeeze = biting ? 1 - progress * 0.2 : 1;
      const halfWidth = Math.max(1.15, 2.1 + swell * 0.95 - (1 - progress) * 0.55) * squeeze;
      const halfThickness = (biting ? 1.35 : 1.25) * squeeze;
      const bend = Math.sin(phase * 0.85 - progress * 5.2) * (0.5 + progress * 2.1);
      const centerX = entity.x - directionX * along + normalX * (bend + shake * progress);
      const centerY = entity.y - directionY * along + normalY * (bend + shake * progress);

      context.beginPath();
      context.ellipse(centerX, centerY, halfWidth, halfThickness, angle, 0, TAU);
      context.fillStyle = index % 2 === 0 ? PALETTE.wormBody : PALETTE.wormBodyAlt;
      context.fill();
      context.strokeStyle = PALETTE.wormEdge;
      context.lineWidth = 0.6;
      context.stroke();

      // 背脊高光：贴着一侧上缘的细亮线，出“湿”的质感
      context.strokeStyle = PALETTE.wormShine;
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(
        centerX - normalX * halfThickness * 0.45 - directionX * halfWidth * 0.55,
        centerY - normalY * halfThickness * 0.45 - directionY * halfWidth * 0.55
      );
      context.lineTo(
        centerX - normalX * halfThickness * 0.45 + directionX * halfWidth * 0.55,
        centerY - normalY * halfThickness * 0.45 + directionY * halfWidth * 0.55
      );
      context.stroke();

      // 节间横向纹
      context.strokeStyle = "rgba(150, 131, 84, 0.55)";
      context.lineWidth = 0.6;
      context.beginPath();
      context.moveTo(centerX - normalX * halfWidth * 0.8, centerY - normalY * halfWidth * 0.8);
      context.lineTo(centerX + normalX * halfWidth * 0.8, centerY + normalY * halfWidth * 0.8);
      context.stroke();
    }

    // 头部：稍大的圆头 + 两枚口钩 + 高光（咬住时泛吸吮环）
    const headX = entity.x + directionX * shake * 0.6;
    const headY = entity.y + directionY * shake * 0.6;
    context.fillStyle = "#f7efd0";
    context.beginPath();
    context.arc(headX, headY, biting ? 2.9 : 2.7, 0, TAU);
    context.fill();
    context.strokeStyle = PALETTE.wormEdge;
    context.lineWidth = 0.6;
    context.stroke();

    context.strokeStyle = PALETTE.wormMouth;
    context.lineWidth = 0.7;
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? 1 : -1;
      context.beginPath();
      context.moveTo(
        headX + directionX * 1.1 + normalX * side * 1.4,
        headY + directionY * 1.1 + normalY * side * 1.4
      );
      context.lineTo(
        headX + directionX * 2.6 + normalX * side * 2.3,
        headY + directionY * 2.6 + normalY * side * 2.3
      );
      context.stroke();
    }

    context.fillStyle = "rgba(255, 253, 236, 0.85)";
    context.beginPath();
    context.arc(headX - normalX * 0.8, headY - normalY * 0.8, 0.7, 0, TAU);
    context.fill();

    if (biting) {
      const pulse = 0.5 + 0.5 * Math.sin(phase * 3.4);
      context.globalAlpha *= 0.5 + pulse * 0.35;
      context.strokeStyle = PALETTE.poison;
      context.lineWidth = 0.9;
      context.beginPath();
      context.arc(
        headX + directionX * 2.2,
        headY + directionY * 2.2,
        2.1 + pulse * 1.2,
        0,
        TAU
      );
      context.stroke();
    }
    context.restore();
  }

  // 球体：一口从上往下看的粪坑——土沿 → 坑壁 → 泥浆面 → 浮渣 / 沼气 / 草屑。
  function drawPitBody(ball, game, canvas) {
    const radius = ball.radius;
    const cx = ball.x;
    const cy = ball.y;
    const time = Number.isFinite(game && game.time) ? game.time : 0;
    canvas.save();

    // 1) 泥浆面直接铺满整个球：直径 30，和其它球一样大，
    //    坑沿只是压在边缘上的一圈（不再向内吃掉泥面面积）。
    canvas.beginPath();
    canvas.arc(cx, cy, radius, 0, TAU);
    canvas.fillStyle = radialPaint(
      canvas,
      cx + radius * 0.3,
      cy + radius * 0.34,
      radius * 0.08,
      cx,
      cy,
      radius * 1.04,
      [
        [0, "#3f320c"],
        [0.42, PALETTE.pitDeep],
        [0.76, PALETTE.pitMid],
        [1, PALETTE.pitSurface]
      ],
      PALETTE.pitMid
    );
    canvas.fill();

    // 2) 坑沿：内壁亮一档 + 外沿深土色，粗细和统一的球体描边看齐
    const lipWidth = Math.max(1, radius * 0.1);
    canvas.strokeStyle = PALETTE.pitLip;
    canvas.lineWidth = lipWidth;
    canvas.beginPath();
    canvas.arc(cx, cy, radius - lipWidth / 2, 0, TAU);
    canvas.stroke();
    canvas.strokeStyle = PALETTE.pitRim;
    canvas.lineWidth = Math.max(1, radius * 0.08);
    canvas.beginPath();
    canvas.arc(cx, cy, radius, 0, TAU);
    canvas.stroke();

    // 坑沿裂痕：八道短刻，像被踩塌的土边（画在泥面上，不占额外直径）
    canvas.strokeStyle = "rgba(30, 22, 6, 0.7)";
    canvas.lineWidth = Math.max(0.8, radius * 0.08);
    for (let index = 0; index < 8; index += 1) {
      const angle = index * TAU / 8 + 0.32;
      canvas.beginPath();
      canvas.moveTo(
        cx + Math.cos(angle) * radius * 0.72,
        cy + Math.sin(angle) * radius * 0.72
      );
      canvas.lineTo(
        cx + Math.cos(angle) * radius * 0.985,
        cy + Math.sin(angle) * radius * 0.985
      );
      canvas.stroke();
    }

    // 3) 浮渣：三块绿褐斑随泥面缓慢打转
    const scum = [[0.34, -0.5, 0.3, 0.19], [1.9, 0.42, 0.24, 0.15], [3.6, -0.32, 0.27, 0.17]];
    for (let index = 0; index < scum.length; index += 1) {
      const [angle, distance, sizeX, sizeY] = scum[index];
      const spin = angle + time * 0.22;
      const x = cx + Math.cos(spin) * radius * distance;
      const y = cy + Math.sin(spin) * radius * distance;
      canvas.fillStyle = index === 1 ? "rgba(147, 168, 50, 0.4)" : "rgba(93, 122, 30, 0.45)";
      canvas.beginPath();
      canvas.ellipse(x, y, radius * sizeX, radius * sizeY, spin, 0, TAU);
      canvas.fill();
      // 浮渣的硬边：一圈更深的边，看起来是一层壳而不是一块色斑
      canvas.strokeStyle = "rgba(58, 72, 16, 0.55)";
      canvas.lineWidth = Math.max(0.5, radius * 0.045);
      canvas.stroke();
    }

    // 4) 草屑：两小块深色碎屑，逆着浮渣转
    const debris = [[0.9, 0.42, 0.12, -0.3], [2.7, -0.55, 0.1, 0.34]];
    for (let index = 0; index < debris.length; index += 1) {
      const [angle, distance, size, spin] = debris[index];
      const drift = angle - time * 0.16;
      const x = cx + Math.cos(drift) * radius * distance;
      const y = cy + Math.sin(drift) * radius * distance;
      canvas.fillStyle = PALETTE.debris;
      canvas.beginPath();
      canvas.ellipse(x, y, radius * size, radius * size * 0.62, spin + time * 0.2, 0, TAU);
      canvas.fill();
    }

    // 5) 沼气：三颗泡在坑里升起、到顶破裂（破裂时只剩一圈小涟漪）
    const bubbles = [[0.7, 0.55, 0.14], [2.4, 0.4, 0.1], [4.3, 0.62, 0.12]];
    for (let index = 0; index < bubbles.length; index += 1) {
      const [angle, distance, size] = bubbles[index];
      const cycle = (time * 0.55 + index * 0.31) % 1;
      const x = cx + Math.cos(angle + time * 0.1) * radius * distance;
      const y = cy + Math.sin(angle + time * 0.1) * radius * distance;
      const rise = radius * size * (0.55 + cycle * 0.75);
      if (cycle > 0.84) {
        const pop = (cycle - 0.84) / 0.16;
        canvas.globalAlpha = 0.55 * (1 - pop);
        canvas.strokeStyle = PALETTE.foam;
        canvas.lineWidth = 0.8;
        canvas.beginPath();
        canvas.arc(x, y, rise + pop * radius * 0.22, 0, TAU);
        canvas.stroke();
        canvas.globalAlpha = 1;
        continue;
      }
      canvas.globalAlpha = 0.28 + (1 - cycle) * 0.22;
      canvas.fillStyle = PALETTE.gas;
      canvas.beginPath();
      canvas.arc(x, y, rise, 0, TAU);
      canvas.fill();
      canvas.globalAlpha = 0.2 + (1 - cycle) * 0.22;
      canvas.strokeStyle = "rgba(255, 248, 214, 0.7)";
      canvas.lineWidth = 0.6;
      canvas.beginPath();
      canvas.arc(x, y, rise, 0, TAU);
      canvas.stroke();
      canvas.globalAlpha = 0.12;
    }
    canvas.globalAlpha = 1;

    // 6) 油光：坑沿内侧一圈很淡的高光，把“液面”从坑壁里分出来
    canvas.globalAlpha = 0.1;
    canvas.strokeStyle = "#ffeeb0";
    canvas.lineWidth = Math.max(0.6, radius * 0.06);
    canvas.beginPath();
    canvas.arc(cx, cy, radius * 0.94, Math.PI * 1.08, Math.PI * 1.72);
    canvas.stroke();
    canvas.globalAlpha = 1;
    canvas.restore();
  }

  // ------------------------------------------------------------------
  // 纯视效工具箱：泥浪、破土水花、咬中泥星。都只画不动数值。
  // ------------------------------------------------------------------
  function spawnRipple(services, x, y, strength) {
    if (!services || typeof services.spawnParticleBurst !== "function") return;
    services.spawnParticleBurst({
      kind: "liaogang-ripple",
      x,
      y,
      count: 3,
      minDiameter: 0.5,
      maxDiameter: 0.5,
      minSpeed: 0,
      maxSpeed: 0,
      life: 0.8,
      drag: 0,
      colors: [PALETTE.foam],
      ring: {
        color: PALETTE.foam,
        lineWidth: 1.2 + strength * 0.35,
        startRadius: 3,
        endRadius: 20 + strength * 5
      }
    });
  }

  function spawnSurfaceSplash(services, x, y, directionX, directionY) {
    if (!services || typeof services.spawnParticleBurst !== "function") return;
    services.spawnParticleBurst({
      kind: "liaogang-splash",
      x,
      y,
      count: 7,
      colors: ["#7a6420", "#a89039", PALETTE.foam],
      minDiameter: 1.2,
      maxDiameter: 3.4,
      minSpeed: 22,
      maxSpeed: 72,
      directionAngle: Math.atan2(directionY, directionX),
      directionSpread: Math.PI * 0.7,
      initialRadius: 1.8,
      life: 0.45,
      drag: 3.2,
      gravityY: 24
    });
  }

  function spawnBiteSplash(services, x, y, directionX, directionY) {
    if (!services || typeof services.spawnParticleBurst !== "function") return;
    services.spawnParticleBurst({
      kind: "liaogang-bite",
      x,
      y,
      count: 5,
      colors: [PALETTE.poison, "#c8ff9a", "#6f5a1c"],
      minDiameter: 1,
      maxDiameter: 2.6,
      minSpeed: 26,
      maxSpeed: 64,
      directionAngle: Math.atan2(directionY, directionX),
      directionSpread: Math.PI * 2,
      initialRadius: 1.5,
      life: 0.32,
      drag: 3.6
    });
  }

  const definition = {
    id: "liaogang",
    name: "寮缸",
    englishName: "Liaogang",
    color: "#a88d22",
    description: "泥浆场地 / 中毒减速90% / 索敌蛆虫",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: INTERVAL,
    createBehavior(services) {
      let timer = 0;
      let round = 0;
      let wormRemaining = 0;
      let wormInterval = 0;
      let nextWormIn = 0;

      function clearPoison(target) {
        // 统一移除：引擎会跑 onExpire、失效缓存并立刻重新合成速度。
        services.clearEffect(target, POISON_ID);
      }

      function ensurePoisoned(target) {
        if (target.hp > 0 && !(target.effects && target.effects.has(POISON_ID))) {
          services.applyEffect(target, createPoisonEffect());
        }
      }

      function spawnSingleWorm(context) {
        const arenaSize = context.game.arenaSize;
        const target = services.getOpponent();
          const edge = Math.floor(Math.random() * 4);
          const along = 8 + Math.random() * Math.max(1, arenaSize - 16);
          let start = edge === 0
            ? { x: along, y: -WORM_EDGE_OFFSET }
            : edge === 1
              ? { x: along, y: arenaSize + WORM_EDGE_OFFSET }
              : edge === 2
                ? { x: -WORM_EDGE_OFFSET, y: along }
                : { x: arenaSize + WORM_EDGE_OFFSET, y: along };
          const arena = resolveArenaGeometry(context.game);
          if (arena.shape !== "square") {
            const boundary = arena.boundaryPoint(["top", "bottom", "left", "right"][edge],
              (edge === 1 || edge === 2 ? 1 : 0) + (edge === 1 || edge === 2 ? -1 : 1) * ((along - 8) / Math.max(1, arenaSize - 16)));
            start = { x: boundary.x - boundary.normalX * WORM_EDGE_OFFSET,
              y: boundary.y - boundary.normalY * WORM_EDGE_OFFSET };
          }
          const aimX = target ? target.x : arenaSize / 2;
          const aimY = target ? target.y : arenaSize / 2;
          let dx = aimX - start.x;
          let dy = aimY - start.y;
          const length = Math.hypot(dx, dy) || 1;
          dx /= length;
          dy /= length;
          // 朝场内小幅偏角，钻出后立即索敌
          const deviation = (Math.random() - 0.5) * 0.5;
          const cosine = Math.cos(deviation);
          const sine = Math.sin(deviation);
          const initialX = dx * cosine - dy * sine;
          const initialY = dx * sine + dy * cosine;
          // 破土水花：蛆从场外钻进来，泥点溅在最近的场边（纯视效）
          const surface = arena.clampPoint(start.x, start.y);
          spawnSurfaceSplash(
            services,
            surface.x,
            surface.y,
            initialX,
            initialY
          );
          services.spawnCombatEntity({
            kind: "liaogang-worm",
            combatKind: "projectile",
            lifecycle: "owner-bound",
            life: WORM_LIFE,
            radius: WORM_RADIUS,
            drawLayer: "foreground",
            x: start.x,
            y: start.y,
            vx: initialX * WORM_SPEED,
            vy: initialY * WORM_SPEED,
            target,
            stage: 0,
            delay: 0,
            hitOffsetX: 0,
            hitOffsetY: 0,
            wormPhase: Math.random() * Math.PI * 2,
            update({ entity, services: wormServices }, dt) {
              if (!entity.target || entity.target.hp <= 0) {
                entity.entityActive = false;
                return;
              }
              const target = entity.target;
              if (entity.stage === 0) {
                const dx = target.x - entity.x;
                const dy = target.y - entity.y;
                const distance = Math.hypot(dx, dy) || 1;
                if (distance <= target.radius + WORM_RADIUS) {
                  entity.stage = 1;
                  entity.delay = 0;
                  entity.hitOffsetX = entity.x - target.x;
                  entity.hitOffsetY = entity.y - target.y;
                  wormServices.dealDamage(target, 1);
                  // 咬中的一口泥星（纯视效）
                  const biteSpeed = Math.hypot(entity.vx, entity.vy) || 1;
                  spawnBiteSplash(
                    services,
                    entity.x,
                    entity.y,
                    entity.vx / biteSpeed,
                    entity.vy / biteSpeed
                  );
                } else {
                  entity.vx = dx / distance * WORM_SPEED;
                  entity.vy = dy / distance * WORM_SPEED;
                  entity.x += entity.vx * dt;
                  entity.y += entity.vy * dt;
                  entity.wormPhase += dt * 11;
                }
                return;
              }
              // 叮住 0.1 秒后二段伤害
              entity.x = target.x + entity.hitOffsetX;
              entity.y = target.y + entity.hitOffsetY;
              entity.wormPhase += dt * 16;
              entity.delay += dt;
              if (entity.delay + EPSILON >= 0.1) {
                wormServices.dealDamage(target, 1);
                entity.entityActive = false;
              }
            },
            draw({ entity }, canvasContext) {
              drawWorm(entity, canvasContext);
            }
          });
      }

      function beginWormWave(context) {
        const count = round * 2 - 1;
        wormRemaining = count;
        wormInterval = INTERVAL / count;
        // 把本轮的蛆均匀散布在两次攻击之间：首只在中间点位，后续按等间隔放出
        nextWormIn = wormInterval * 0.5;
        // 开轮信号：坑面荡开一圈泥浪（纯视效，轮数越高越明显）
        if (context && context.ball) {
          spawnRipple(services, context.ball.x, context.ball.y, Math.min(3, round));
        }
      }

      function releaseWorms(context, dt) {
        if (wormRemaining <= 0) return;
        nextWormIn -= dt;
        while (wormRemaining > 0 && nextWormIn <= EPSILON) {
          spawnSingleWorm(context);
          wormRemaining -= 1;
          nextWormIn += wormInterval;
        }
      }

      return {
        onSpawn() {
          services.forEachEnemy(ensurePoisoned);
        },
        update(context, dt) {
          services.forEachEnemy(ensurePoisoned);
          timer += dt;
          if (timer + EPSILON >= INTERVAL) {
            timer = 0;
            round += 1;
            beginWormWave(context);
          }
          releaseWorms(context, dt);
        },
        updateWhilePaused(context, dt) {
          services.forEachEnemy(ensurePoisoned);
          timer += dt;
          if (timer + EPSILON >= INTERVAL) {
            timer = 0;
            round += 1;
            beginWormWave(context);
          }
          releaseWorms(context, dt);
        },
        getNextTransitionIn() {
          const wormBoundary = wormRemaining > 0 ? Math.max(EPSILON, nextWormIn) : Infinity;
          return Math.max(EPSILON, Math.min(INTERVAL - timer, wormBoundary));
        },
        getNextPausedTransitionIn() {
          const wormBoundary = wormRemaining > 0 ? Math.max(EPSILON, nextWormIn) : Infinity;
          return Math.max(EPSILON, Math.min(INTERVAL - timer, wormBoundary));
        },
        drawArenaBackground(context, canvasContext) {
          drawMudBackground(context, canvasContext);
        },
        drawBody(context, canvasContext) {
          drawPitBody(context.ball, context.game, canvasContext);
          return true;
        },
        onDeath() {
          services.forEachEnemy(clearPoison);
        }
      };
    }
  };

  registerBall(definition);
  return { liaogangDefinition: definition, createLiaogangPoisonEffect: createPoisonEffect };
});
