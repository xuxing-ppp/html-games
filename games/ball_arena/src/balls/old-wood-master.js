(function initializeOldWoodMaster(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOldWoodMasterPlugin({ registerBall, firstSegmentCircleContact, createArenaGeometry }) {
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // ── 玩法契约 ───────────────────────────────────────────────────────────
  // 木板的"血量"就是它能挨的撞击次数：每块板挨满 3 次受击/碰撞才彻底碎裂，
  // 每次被敌方小球撞上还回敬 2 点碰撞伤害。血量不参与渲染（渲染器只给小球
  // 画血量数字），破损程度完全由板面外观表达：完好 → 细裂 → 分叉开裂。
  const PLANK_HITS = 3;
  const PLANK_COLLISION_DAMAGE = 2;
  const PLANK_MIN_THICKNESS = 5;
  const PLANK_MAX_THICKNESS = 80;
  const PLANK_MIN_LENGTH = 5;
  const PLANK_MAX_LENGTH = 80;
  // 木板不许叠放在同一处：撞到已经有板的墙段时，新板钉在旧板"上面"
  //（贴着旧板朝场地那一面再往外一层），所以两块板永远不占同一块地方。
  // 层数不设上限：只要叠出来的板、建造者的退路和场地空间仍然装得下，就能继续加层。
  const PLANK_DEPTH_MARGIN = 1;
  // 挨过一次撞击之后要先真正离开板面，才允许再记一次撞击：
  // 贴着板面蹭或者被挤住时不会连着扣掉三次。
  const PLANK_RELEASE_DISTANCE = 4;

  // ── 钉板动作 ───────────────────────────────────────────────────────────
  // 撞墙当帧老木师停在墙边干活：三次落锤（0.5 秒）之后木板才落位，
  // 随后按撞墙时被反射出去的方向继续飞。干活期间速度被扣住，这是动作的代价。
  const NAIL_DURATION = 0.5;
  const NAIL_STRIKE_FRACTIONS = [0.2, 0.45, 0.72];
  const HAMMER_WINDOW = 0.15;
  // 相对"朝向墙里"的角度：先抡到上方抬起，再砸下来（屏幕坐标 y 向下）。
  const HAMMER_COCKED_ANGLE = 1.15;
  const HAMMER_STRIKE_ANGLE = -0.24;
  const HIT_FLASH_DURATION = 0.16;
  const NAIL_TRAVEL_DURATION = 0.09;

  const PLANK_KIND = "old-wood-master-plank";
  const PLANK_PREVIEW_KIND = "old-wood-master-plank-preview";
  const NAIL_KIND = "old-wood-master-nail";

  // ── 木色 ───────────────────────────────────────────────────────────────
  const BODY_COLOR = "#a9713c";
  const WOOD_LIGHT = "#dcb079";
  const WOOD_MID = "#bb8544";
  const WOOD_DARK = "#8a5a29";
  const WOOD_RING = "#7c4a1d";
  const WOOD_EDGE = "#43280f";
  const PLANK_FACE = "#cf9d5c";
  const PLANK_FACE_DARK = "#a1703a";
  const PLANK_GRAIN = "rgba(112, 66, 25, 0.35)";
  const PLANK_SPLIT = "#5d3512";
  const NAIL_COLOR = "#cfd5da";
  const NAIL_DARK = "#5d646a";
  const SAWDUST_COLORS = ["#f0d3a3", "#d9ab6c", "#b07c3f"];
  const SPLINTER_COLORS = ["#e0b578", "#c08a47", "#8f5c26"];
  const NAIL_SPARK_COLORS = ["#e6ebee", "#aeb6bc", "#7c848a"];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function battleArena(game) {
    return game.arena || createArenaGeometry(game.arenaSize || 200);
  }

  function easeOutCubic(value) {
    const inverse = 1 - clamp(value, 0, 1);
    return 1 - inverse * inverse * inverse;
  }

  function randomSize(minimum, maximum) {
    return Math.round(minimum + Math.random() * (maximum - minimum));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = Number.isFinite(x) ? x : fallbackX;
    let directionY = Number.isFinite(y) ? y : fallbackY;
    let magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
      magnitude = Math.hypot(directionX, directionY) || 1;
    }
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  // 世界坐标 → 板面局部（局部 x 沿板长、局部 y 沿板厚）。
  function toPlankLocal(spec, x, y) {
    const cos = Math.cos(spec.angle);
    const sin = Math.sin(spec.angle);
    const dx = x - spec.x;
    const dy = y - spec.y;
    return {
      x: dx * cos + dy * sin,
      y: -dx * sin + dy * cos,
      cos,
      sin
    };
  }

  function toPlankWorld(spec, localX, localY) {
    const cos = Math.cos(spec.angle);
    const sin = Math.sin(spec.angle);
    return {
      x: spec.x + localX * cos - localY * sin,
      y: spec.y + localX * sin + localY * cos
    };
  }

  // 板面贴着墙的那一面在局部坐标里的 y；另一面就是挨打的那一面。
  function plankInnerFaceY(spec) {
    return -spec.wallSide * spec.width / 2;
  }

  // 圆（小球/子弹）与斜置矩形的接触：返回最早的交点法线与穿透深度。
  function plankContact(spec, x, y, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    const local = toPlankLocal(spec, x, y);
    const clampedX = clamp(local.x, -halfLength, halfLength);
    const clampedY = clamp(local.y, -halfWidth, halfWidth);
    const offsetX = local.x - clampedX;
    const offsetY = local.y - clampedY;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance > radius) return null;

    let normalLocalX = 0;
    let normalLocalY = 0;
    let penetration = 0;
    if (distance > EPSILON) {
      normalLocalX = offsetX / distance;
      normalLocalY = offsetY / distance;
      penetration = radius - distance;
    } else {
      // 圆心已经落在板面里（例如新板落位时正好罩住某颗球）：
      // 一律沿"受击面"推出去，绝不把球往墙里塞。
      normalLocalX = 0;
      normalLocalY = -spec.wallSide;
      penetration = radius + (local.y - plankInnerFaceY(spec)) * spec.wallSide;
    }

    return {
      normalX: normalLocalX * local.cos - normalLocalY * local.sin,
      normalY: normalLocalX * local.sin + normalLocalY * local.cos,
      penetration: Math.max(0, penetration),
      contactX: spec.x + clampedX * local.cos - clampedY * local.sin,
      contactY: spec.y + clampedX * local.sin + clampedY * local.cos,
      distance
    };
  }

  // Sweep the circle against the four faces and rounded corners, not just endpoints.
  function plankSweptContact(spec, target, radius) {
    const current = plankContact(spec, target.x, target.y, radius);
    if (!Number.isFinite(target.prevX) || !Number.isFinite(target.prevY)) return current;
    if (plankContact(spec, target.prevX, target.prevY, radius + EPSILON)) return current;
    const start = toPlankLocal(spec, target.prevX, target.prevY);
    const end = toPlankLocal(spec, target.x, target.y);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const hx = spec.length / 2;
    const hy = spec.width / 2;
    let first = Infinity;
    for (const sign of [-1, 1]) {
      if (Math.abs(dx) > EPSILON) {
        const t = (sign * (hx + radius) - start.x) / dx;
        if (t >= 0 && t <= 1 && Math.abs(start.y + dy * t) <= hy + EPSILON) first = Math.min(first, t);
      }
      if (Math.abs(dy) > EPSILON) {
        const t = (sign * (hy + radius) - start.y) / dy;
        if (t >= 0 && t <= 1 && Math.abs(start.x + dx * t) <= hx + EPSILON) first = Math.min(first, t);
      }
      for (const otherSign of [-1, 1]) {
        const t = firstSegmentCircleContact(start.x, start.y, end.x, end.y, sign * hx, otherSign * hy, radius);
        if (t !== null) first = Math.min(first, t);
      }
    }
    if (!Number.isFinite(first)) return current;
    const x = target.prevX + (target.x - target.prevX) * first;
    const y = target.prevY + (target.y - target.prevY) * first;
    const contact = plankContact(spec, x, y, radius + 1e-7);
    return contact ? Object.assign(contact, { sweptX: x, sweptY: y, progress: first }) : current;
  }

  function plankNailLocalPositions(spec) {
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    const pad = Math.min(Math.max(halfLength * 0.18, 1.5), Math.max(halfLength - 0.5, 0.5));
    const inset = Math.min(1.8, Math.max(halfWidth * 0.45, 0.6));
    const nailY = plankInnerFaceY(spec) + spec.wallSide * inset;
    return [-halfLength + pad, 0, halfLength - pad].map((localX) => ({
      localX,
      localY: nailY
    }));
  }

  function plankNailWorldPosition(spec, index) {
    const positions = plankNailLocalPositions(spec);
    const nail = positions[clamp(index, 0, positions.length - 1)];
    return toPlankWorld(spec, nail.localX, nail.localY);
  }

  // ── 木板占位：不许叠放，但可以钉在旧板上面 ──────────────────────────────
  // 圆场的木板沿切线放置，包围盒须包含旋转后的四个顶点。
  function plankWorldBox(plank) {
    const halfLength = plank.length / 2;
    const halfWidth = plank.width / 2;
    const halfX = Math.abs(Math.cos(plank.angle)) * halfLength + Math.abs(Math.sin(plank.angle)) * halfWidth;
    const halfY = Math.abs(Math.sin(plank.angle)) * halfLength + Math.abs(Math.cos(plank.angle)) * halfWidth;
    return {
      minX: plank.x - halfX,
      maxX: plank.x + halfX,
      minY: plank.y - halfY,
      maxY: plank.y + halfY
    };
  }

  // 这块板从"我这一面墙"往里量有多远（外沿到墙面的距离）。
  function inwardExtent(frame, box) {
    if (frame.side === "left") return box.maxX - frame.arena.left;
    if (frame.side === "right") return frame.arena.right - box.minX;
    if (frame.side === "top") return box.maxY - frame.arena.top;
    return frame.arena.bottom - box.minY;
  }

  function spansOverlap(left, right) {
    return Math.min(left.max, right.max) - Math.max(left.min, right.min) > EPSILON;
  }

  function isLivePlank(entity) {
    return Boolean(
      entity &&
      entity.kind === PLANK_KIND &&
      entity.entityActive !== false &&
      entity.life > 0
    );
  }

  // ── 板面轮廓与外观 ─────────────────────────────────────────────────────
  // 缺口都开在"挨打那一面"：破损越重，崩口越多越深。
  function plankBites(spec, damage) {
    if (damage <= 0) return [];
    const halfLength = spec.length / 2;
    const halfWidth = spec.width / 2;
    if (damage === 1) {
      return [{
        at: 0.84,
        span: Math.min(halfLength * 0.22, 7),
        depth: Math.min(halfWidth * 0.55, 6)
      }];
    }
    return [
      {
        at: 0.16,
        span: Math.min(halfLength * 0.2, 6),
        depth: Math.min(halfWidth * 0.4, 5)
      },
      {
        at: 0.55,
        span: Math.min(halfLength * 0.3, 9),
        depth: Math.min(halfWidth * 0.68, 9)
      },
      {
        at: 0.88,
        span: Math.min(halfLength * 0.24, 7),
        depth: Math.min(halfWidth * 0.5, 6.5)
      }
    ];
  }

  function plankOutline(spec, damage) {
    const halfLength = spec.length / 2;
    const inner = plankInnerFaceY(spec);
    const outer = spec.wallSide * spec.width / 2;
    const points = [
      { x: -halfLength, y: outer },
      { x: -halfLength, y: inner }
    ];
    const bites = plankBites(spec, damage).sort((left, right) => left.at - right.at);
    for (const bite of bites) {
      const centerX = -halfLength + spec.length * bite.at;
      const span = Math.min(bite.span, Math.max(halfLength * 0.4, 0.4));
      // Shallow chipped edges retain the rectangular support silhouette.
      const depth = Math.min(bite.depth, spec.width * 0.06, 0.8);
      points.push({ x: centerX - span, y: inner });
      points.push({ x: centerX - span * 0.45, y: inner + spec.wallSide * depth * 0.6 });
      points.push({ x: centerX + span * 0.12, y: inner + spec.wallSide * depth });
      points.push({ x: centerX + span * 0.6, y: inner + spec.wallSide * depth * 0.45 });
      points.push({ x: centerX + span, y: inner });
    }
    points.push({ x: halfLength, y: inner });
    points.push({ x: halfLength, y: outer });
    return points;
  }

  function tracePath(canvasContext, points) {
    points.forEach((point, index) => {
      if (index === 0) canvasContext.moveTo(point.x, point.y);
      else canvasContext.lineTo(point.x, point.y);
    });
    canvasContext.closePath();
  }

  // 顺板长走的木纹：一条微微起伏的线，不到头才像木头。
  function traceGrainLine(canvasContext, spec, offsetY, seed) {
    const halfLength = spec.length / 2;
    const steps = 12;
    for (let step = 0; step <= steps; step += 1) {
      const ratio = step / steps;
      const x = -halfLength * 0.94 + spec.length * 0.94 * ratio;
      const wave = Math.sin(ratio * 6.2 + seed) * Math.min(spec.length * 0.02, 1.1)
        + Math.sin(ratio * 11.5 + seed * 1.7) * Math.min(spec.length * 0.012, 0.6);
      const y = offsetY + wave;
      if (step === 0) canvasContext.moveTo(x, y);
      else canvasContext.lineTo(x, y);
    }
  }

  function drawWoodFracture(ctx, spec, damage, seed) {
    const count = Math.min(2, damage);
    for (let index = 0; index < count; index += 1) {
      const hit = spec.hitPoints && spec.hitPoints[index];
      const originX = hit ? clamp(hit.x, -spec.length * 0.43, spec.length * 0.43) : spec.length * (index ? -0.22 : 0.24);
      const originY = hit ? clamp(hit.y, -spec.width * 0.32, spec.width * 0.32) : spec.width * (index ? 0.18 : -0.16);
      const opening = Math.min(spec.width * 0.07, damage === 1 ? 0.8 : 1.35);
      for (const direction of [-1, 1]) {
        const end = clamp(originX + direction * spec.length * (damage === 1 ? 0.3 : 0.5), -spec.length * 0.48, spec.length * 0.48);
        const points = [];
        for (let step = 0; step <= 5; step += 1) {
          const t = step / 5;
          points.push({ x: originX + (end - originX) * t,
            y: originY + Math.sin(seed + index * 2 + step * 2.7) * spec.width * 0.035 * t });
        }
        ctx.beginPath();
        points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        for (let step = 5; step >= 0; step -= 1) {
          ctx.lineTo(points[step].x, points[step].y + opening * (1 - step / 5));
        }
        ctx.closePath();
        ctx.fillStyle = "#4c2c16";
        ctx.fill();
        ctx.beginPath();
        points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y - 0.22) : ctx.moveTo(p.x, p.y - 0.22));
        ctx.strokeStyle = "rgba(255,218,156,0.75)";
        ctx.lineWidth = 0.35;
        ctx.stroke();
        const branch = points[2];
        ctx.beginPath();
        ctx.moveTo(branch.x, branch.y);
        ctx.lineTo(branch.x + direction * spec.length * 0.06, branch.y - spec.width * 0.08);
        ctx.lineTo(branch.x + direction * spec.length * 0.16, branch.y - spec.width * 0.11);
        ctx.strokeStyle = PLANK_SPLIT;
        ctx.lineWidth = 0.4;
        ctx.stroke();
      }
    }
  }

  function drawPlankBoard(canvasContext, spec, options = {}) {
    const scale = Number.isFinite(options.scale) ? Math.max(0.05, options.scale) : 1;
    const alpha = Number.isFinite(options.alpha) ? clamp(options.alpha, 0, 1) : 1;
    const flash = Number.isFinite(options.flash) ? clamp(options.flash, 0, 1) : 0;
    const hp = Number.isFinite(options.hp)
      ? options.hp
      : (Number.isFinite(spec.hp) ? spec.hp : PLANK_HITS);
    const damage = Number.isFinite(options.damage)
      ? options.damage
      : clamp(PLANK_HITS - hp, 0, PLANK_HITS);
    const drivenNails = Number.isFinite(options.nails)
      ? clamp(options.nails, 0, 3)
      : 3;
    const offsetX = Number.isFinite(options.offsetX) ? options.offsetX : 0;
    const offsetY = Number.isFinite(options.offsetY) ? options.offsetY : 0;
    const seed = Number.isFinite(spec.grainSeed) ? spec.grainSeed : 0;
    const scaled = {
      x: spec.x,
      y: spec.y,
      angle: spec.angle,
      length: spec.length * scale,
      width: spec.width * scale,
      wallSide: spec.wallSide,
      hitPoints: spec.hitPoints
    };
    const inner = plankInnerFaceY(scaled);
    const outer = scaled.wallSide * scaled.width / 2;

    canvasContext.save();
    canvasContext.globalAlpha *= alpha;
    canvasContext.translate(spec.x + offsetX, spec.y + offsetY);
    canvasContext.rotate(spec.angle);

    const outline = plankOutline(scaled, damage);
    canvasContext.beginPath();
    tracePath(canvasContext, outline);
    const fill = typeof canvasContext.createLinearGradient === "function"
      ? canvasContext.createLinearGradient(0, outer, 0, inner)
      : null;
    if (fill) {
      fill.addColorStop(0, PLANK_FACE_DARK);
      fill.addColorStop(0.45, PLANK_FACE);
      fill.addColorStop(1, "#d9ac6c");
      canvasContext.fillStyle = fill;
    } else {
      canvasContext.fillStyle = PLANK_FACE;
    }
    canvasContext.fill();

    // 木纹、木节与裂缝都裁在板面里，崩口处不能漏出纹路。
    canvasContext.save();
    canvasContext.beginPath();
    tracePath(canvasContext, outline);
    canvasContext.clip();
    canvasContext.strokeStyle = PLANK_GRAIN;
    canvasContext.lineWidth = Math.max(0.4, scaled.width * 0.035);
    const grainRows = 4;
    for (let row = 0; row < grainRows; row += 1) {
      const ratio = (row + 1) / (grainRows + 1);
      const offsetY2 = outer + (inner - outer) * ratio;
      canvasContext.beginPath();
      traceGrainLine(canvasContext, scaled, offsetY2, seed + row * 2.3);
      canvasContext.stroke();
    }
    // 两个木节：一小圈深色年轮。
    for (let knot = 0; knot < 2; knot += 1) {
      const knotX = (knot === 0 ? -0.24 : 0.31) * scaled.length
        + Math.sin(seed + knot * 3.1) * scaled.length * 0.05;
      const knotY = outer + (inner - outer) * (knot === 0 ? 0.34 : 0.68);
      const knotRadius = Math.min(Math.max(scaled.width * 0.11, 0.6), 1.7);
      canvasContext.beginPath();
      canvasContext.arc(knotX, knotY, knotRadius, 0, TWO_PI);
      canvasContext.fillStyle = "rgba(90, 52, 18, 0.75)";
      canvasContext.fill();
      canvasContext.beginPath();
      canvasContext.arc(knotX, knotY, knotRadius * 1.9, 0, TWO_PI);
      canvasContext.strokeStyle = "rgba(112, 66, 25, 0.45)";
      canvasContext.lineWidth = Math.max(0.3, knotRadius * 0.45);
      canvasContext.stroke();
    }
    if (damage >= 1) drawWoodFracture(canvasContext, scaled, damage, seed);
    canvasContext.restore();

    canvasContext.strokeStyle = WOOD_EDGE;
    canvasContext.lineWidth = Math.max(0.6, scaled.width * 0.05);
    canvasContext.beginPath();
    tracePath(canvasContext, outline);
    canvasContext.stroke();

    if (flash > 0) {
      canvasContext.beginPath();
      tracePath(canvasContext, outline);
      canvasContext.fillStyle = "rgba(255, 243, 220, " + (0.32 * flash).toFixed(3) + ")";
      canvasContext.fill();
    }

    // Nails remain seated in solid wood; no detached nail heads floating in space.
    const nails = plankNailLocalPositions(scaled);
    for (let index = 0; index < nails.length; index += 1) {
      if (index >= drivenNails) continue;
      const nail = nails[index];
      const nailX = nail.localX;
      const nailY = nail.localY;
      const nailRadius = Math.min(Math.max(scaled.width * 0.07, 0.55), 1.15);
      canvasContext.beginPath();
      canvasContext.arc(nailX, nailY, nailRadius, 0, TWO_PI);
      canvasContext.fillStyle = NAIL_COLOR;
      canvasContext.fill();
      canvasContext.strokeStyle = NAIL_DARK;
      canvasContext.lineWidth = Math.max(0.3, nailRadius * 0.5);
      canvasContext.stroke();
      canvasContext.beginPath();
      canvasContext.arc(nailX - nailRadius * 0.3, nailY - nailRadius * 0.3, nailRadius * 0.32, 0, TWO_PI);
      canvasContext.fillStyle = "#f2f6f8";
      canvasContext.fill();
    }

    canvasContext.restore();
  }

  // ── 本体：木纹圆盘 ─────────────────────────────────────────────────────
  function drawWoodDisc(canvasContext, ball) {
    const radius = ball.radius;
    canvasContext.save();
    canvasContext.translate(ball.x, ball.y);

    canvasContext.beginPath();
    canvasContext.arc(0, 0, radius, 0, TWO_PI);
    const base = typeof canvasContext.createLinearGradient === "function"
      ? canvasContext.createLinearGradient(-radius, -radius, radius * 0.7, radius)
      : null;
    if (base) {
      base.addColorStop(0, WOOD_LIGHT);
      base.addColorStop(0.45, WOOD_MID);
      base.addColorStop(1, WOOD_DARK);
      canvasContext.fillStyle = base;
    } else {
      canvasContext.fillStyle = WOOD_MID;
    }
    canvasContext.fill();

    canvasContext.save();
    canvasContext.beginPath();
    canvasContext.arc(0, 0, radius, 0, TWO_PI);
    canvasContext.clip();
    // 偏心年轮：几圈微微起伏的弧，越往外越疏。
    const centerX = -radius * 0.2;
    const centerY = -radius * 0.16;
    canvasContext.strokeStyle = "rgba(124, 74, 29, 0.55)";
    canvasContext.lineWidth = 0.5;
    for (let ring = 0; ring < 7; ring += 1) {
      const ringRadius = 2 + ring * 1.78;
      canvasContext.beginPath();
      for (let step = 0; step <= 26; step += 1) {
        const angle = step / 26 * TWO_PI;
        const wobble = Math.sin(angle * 3 + ring * 1.7) * 0.5
          + Math.sin(angle * 5 + ring * 0.9) * 0.24;
        const px = centerX + Math.cos(angle) * (ringRadius + wobble);
        const py = centerY + Math.sin(angle) * (ringRadius + wobble) * 0.93;
        if (step === 0) canvasContext.moveTo(px, py);
        else canvasContext.lineTo(px, py);
      }
      canvasContext.stroke();
    }
    // 木节
    canvasContext.beginPath();
    canvasContext.arc(radius * 0.34, -radius * 0.3, radius * 0.12, 0, TWO_PI);
    canvasContext.fillStyle = "rgba(74, 42, 16, 0.8)";
    canvasContext.fill();
    canvasContext.beginPath();
    canvasContext.arc(radius * 0.34, -radius * 0.3, radius * 0.24, 0, TWO_PI);
    canvasContext.strokeStyle = "rgba(124, 74, 29, 0.5)";
    canvasContext.lineWidth = 0.5;
    canvasContext.stroke();
    // 两条干裂纹：老木头才有的放射状开裂。
    canvasContext.strokeStyle = "rgba(67, 40, 15, 0.75)";
    canvasContext.lineWidth = 0.65;
    for (const crack of [
      { angle: -0.42, from: 0.42, to: 0.98 },
      { angle: 2.45, from: 0.3, to: 0.96 }
    ]) {
      canvasContext.beginPath();
      canvasContext.moveTo(
        Math.cos(crack.angle) * radius * crack.from,
        Math.sin(crack.angle) * radius * crack.from
      );
      canvasContext.lineTo(
        Math.cos(crack.angle + 0.12) * radius * (crack.from + crack.to) * 0.5,
        Math.sin(crack.angle + 0.12) * radius * (crack.from + crack.to) * 0.5
      );
      canvasContext.lineTo(
        Math.cos(crack.angle + 0.05) * radius * crack.to,
        Math.sin(crack.angle + 0.05) * radius * crack.to
      );
      canvasContext.stroke();
    }
    canvasContext.restore();

    canvasContext.strokeStyle = WOOD_EDGE;
    canvasContext.lineWidth = 1.1;
    canvasContext.beginPath();
    canvasContext.arc(0, 0, radius, 0, TWO_PI);
    canvasContext.stroke();
    canvasContext.restore();
  }

  // 槌头落点：抡到哪由 swing 决定，但头不许抡出场地外——贴着墙干活时
  // 槌子会自动收短，总比半个槌子画到画布外面强。画槌与"钉飞出去"共用这里。
  function hammerHeadPosition(ball, nailing) {
    const radius = ball.radius;
    const frame = nailing.frame;
    const direction = normalizeDirection(
      -frame.normalX,
      -frame.normalY,
      -frame.normalX,
      -frame.normalY
    );
    const baseAngle = Math.atan2(direction.y, direction.x);
    // 屏幕坐标 y 向下：朝左抡是"左上抬起 → 左下砸下"，朝右抡要镜像过来。
    const mirror = Math.cos(baseAngle) >= 0 ? -1 : 1;
    const swing = hammerSwing(nailing.elapsed, nailing.duration);
    const angle = baseAngle + mirror * swing;
    const shoulderX = ball.x + direction.x * radius * 0.66;
    const shoulderY = ball.y + direction.y * radius * 0.66;
    const reach = radius * 1.18;
    const margin = radius * 0.18;
    const head = frame.arena.clampPoint(shoulderX + Math.cos(angle) * reach,
      shoulderY + Math.sin(angle) * reach, margin);
    const headX = head.x;
    const headY = head.y;
    const armLength = Math.hypot(headX - shoulderX, headY - shoulderY);
    return {
      shoulderX,
      shoulderY,
      headX,
      headY,
      armLength,
      angle: Math.atan2(headY - shoulderY, headX - shoulderX),
      headHalf: Math.min(radius * 0.4, Math.max(armLength * 0.75, radius * 0.2))
    };
  }

  // 0 = 抡到上方抬起，1 = 砸在板面上；待机时只是握着槌轻轻晃。
  function hammerSwing(elapsed, duration) {
    let strike = 0;
    for (const fraction of NAIL_STRIKE_FRACTIONS) {
      const local = elapsed - duration * fraction;
      if (local < -HAMMER_WINDOW * 0.55 || local > HAMMER_WINDOW) continue;
      const progress = clamp(
        (local + HAMMER_WINDOW * 0.55) / (HAMMER_WINDOW * 1.55),
        0,
        1
      );
      const value = progress < 0.38
        ? easeOutCubic(progress / 0.38)
        : 1 - easeOutCubic((progress - 0.38) / 0.62) * 0.94;
      strike = Math.max(strike, value);
    }
    const idle = Math.sin(elapsed * 5.4) * 0.05 * (1 - strike);
    return HAMMER_COCKED_ANGLE
      + (HAMMER_STRIKE_ANGLE - HAMMER_COCKED_ANGLE) * strike
      + idle;
  }

  // 手里的木槌：柄从肩点伸出，槌头横在末端，落锤时绕肩点抡下去。
  function drawHammer(canvasContext, ball, nailing) {
    const radius = ball.radius;
    const {
      shoulderX,
      shoulderY,
      headX,
      headY,
      angle,
      headHalf
    } = hammerHeadPosition(ball, nailing);

    canvasContext.save();
    // 柄
    canvasContext.strokeStyle = "#8d6136";
    canvasContext.lineWidth = radius * 0.17;
    canvasContext.beginPath();
    canvasContext.moveTo(shoulderX, shoulderY);
    canvasContext.lineTo(headX, headY);
    canvasContext.stroke();
    canvasContext.strokeStyle = "rgba(60, 36, 14, 0.55)";
    canvasContext.lineWidth = radius * 0.05;
    canvasContext.beginPath();
    canvasContext.moveTo(
      shoulderX + Math.cos(angle + Math.PI / 2) * radius * 0.05,
      shoulderY + Math.sin(angle + Math.PI / 2) * radius * 0.05
    );
    canvasContext.lineTo(
      headX + Math.cos(angle + Math.PI / 2) * radius * 0.05,
      headY + Math.sin(angle + Math.PI / 2) * radius * 0.05
    );
    canvasContext.stroke();
    // 槌头：横在柄端的木块 + 两端铁箍
    canvasContext.save();
    canvasContext.translate(headX, headY);
    canvasContext.rotate(angle);
    canvasContext.fillStyle = "#6f4a24";
    canvasContext.fillRect(-headHalf * 0.9, -headHalf, headHalf * 1.8, headHalf * 2);
    canvasContext.fillStyle = "#3f2711";
    canvasContext.fillRect(-headHalf * 0.9, -headHalf, headHalf * 0.34, headHalf * 2);
    canvasContext.fillRect(headHalf * 0.56, -headHalf, headHalf * 0.34, headHalf * 2);
    canvasContext.strokeStyle = "#2c1a09";
    canvasContext.lineWidth = 0.6;
    canvasContext.strokeRect(-headHalf * 0.9, -headHalf, headHalf * 1.8, headHalf * 2);
    canvasContext.restore();

    // 肩点：让"手"看起来是握着柄根
    canvasContext.beginPath();
    canvasContext.arc(shoulderX, shoulderY, radius * 0.2, 0, TWO_PI);
    canvasContext.fillStyle = WOOD_LIGHT;
    canvasContext.fill();
    canvasContext.strokeStyle = WOOD_EDGE;
    canvasContext.lineWidth = 0.7;
    canvasContext.stroke();
    canvasContext.restore();
  }

  // ── 视效 ───────────────────────────────────────────────────────────────
  // 钉板预告：板子从墙里"长"出来，每落一锤多一颗钉。
  function createPlankPreview(spec, construction) {
    return {
      kind: PLANK_PREVIEW_KIND,
      life: construction ? Number.MAX_SAFE_INTEGER : NAIL_DURATION,
      drawLayer: "background",
      x: spec.x,
      y: spec.y,
      angle: spec.angle,
      length: spec.length,
      width: spec.width,
      wallSide: spec.wallSide,
      grainSeed: spec.grainSeed,
      draw({ effect }, canvasContext) {
        const progress = construction
          ? clamp(construction.elapsed / construction.duration, 0, 1)
          : clamp(effect.age / effect.life, 0, 1);
        let driven = 0;
        for (const fraction of NAIL_STRIKE_FRACTIONS) {
          if (progress + EPSILON >= fraction) driven += 1;
        }
        const growth = easeOutCubic(progress);
        const growing = Object.assign({}, effect, {
          width: Math.max(0.1, spec.width * growth),
          x: spec.x - spec.normalX * spec.width * (1 - growth) / 2,
          y: spec.y - spec.normalY * spec.width * (1 - growth) / 2
        });
        drawPlankBoard(canvasContext, growing, {
          alpha: 0.42 + 0.5 * progress,
          nails: driven
        });
      }
    };
  }

  // 钉子飞出去：从槌头飞到板面上那一颗钉的位置。
  function createNailFlight(fromX, fromY, toX, toY) {
    return {
      kind: NAIL_KIND,
      life: NAIL_TRAVEL_DURATION,
      draw({ effect }, canvasContext) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const x = fromX + (toX - fromX) * progress;
        const y = fromY + (toY - fromY) * progress;
        const direction = normalizeDirection(toX - fromX, toY - fromY, 1, 0);
        canvasContext.save();
        canvasContext.globalAlpha *= 1 - progress * 0.35;
        canvasContext.strokeStyle = NAIL_COLOR;
        canvasContext.lineWidth = 0.9;
        canvasContext.beginPath();
        canvasContext.moveTo(x - direction.x * 2.2, y - direction.y * 2.2);
        canvasContext.lineTo(x + direction.x * 1.4, y + direction.y * 1.4);
        canvasContext.stroke();
        canvasContext.beginPath();
        canvasContext.arc(x + direction.x * 1.4, y + direction.y * 1.4, 0.75, 0, TWO_PI);
        canvasContext.fillStyle = "#eef3f6";
        canvasContext.fill();
        canvasContext.restore();
      }
    };
  }

  function spawnWoodDebris(services, x, y, spread, count) {
    services.spawnParticleBurst({
      x,
      y,
      kind: "old-wood-master-debris",
      shape: "rect",
      count,
      colors: SPLINTER_COLORS,
      minLength: Math.max(1, spread * 0.28),
      maxLength: Math.max(2, spread * 0.62),
      minWidth: 0.8,
      maxWidth: Math.max(1, spread * 0.14),
      minSpeed: 45,
      maxSpeed: 170,
      rotationSpeed: 7,
      initialRadius: spread * 0.35,
      life: 0.55,
      drag: 2.8
    });
  }

  function spawnSawdust(services, x, y, directionX, directionY) {
    services.spawnParticleBurst({
      x,
      y,
      kind: "old-wood-master-sawdust",
      count: 6,
      colors: SAWDUST_COLORS,
      minDiameter: 0.6,
      maxDiameter: 1.9,
      minSpeed: 30,
      maxSpeed: 95,
      directionAngle: Math.atan2(directionY, directionX),
      directionSpread: 1.5,
      life: 0.32,
      drag: 3.2
    });
  }

  function spawnPlankShatter(services, entity) {
    const spread = Math.max(entity.length, entity.width);
    spawnWoodDebris(services, entity.x, entity.y, spread, 16);
    services.spawnParticleBurst({
      x: entity.x,
      y: entity.y,
      kind: "old-wood-master-nails",
      count: 3,
      colors: NAIL_SPARK_COLORS,
      minDiameter: 1.1,
      maxDiameter: 2.1,
      minSpeed: 60,
      maxSpeed: 180,
      initialRadius: spread * 0.3,
      life: 0.5,
      drag: 2.4
    });
  }

  // ── 木板实体 ───────────────────────────────────────────────────────────
  function createPlankEntity(spec) {
    const plank = {
      kind: PLANK_KIND,
      // 第三方实体语言里的"场地陷阱"：贴上去就会被木板撞一下。
      combatKind: "trap",
      // 板是已经钉好的场地设施，不跟着建造者死亡退场：老木师死后它仍按
      // 生成时捕获的 teamId/credit 继续挡路、弹人、出伤。未完工的施工和
      // 预告板仍由行为自己的 onDeath 取消，不在实体层继承这个责任。
      lifecycle: "independent",
      life: Number.MAX_SAFE_INTEGER,
      drawLayer: "background",
      solid: true,
      x: spec.x,
      y: spec.y,
      angle: spec.angle,
      length: spec.length,
      width: spec.width,
      wallSide: spec.wallSide,
      // 钉在哪面墙、外沿离墙面多远（0 = 直接钉在墙上，>0 = 钉在旧板上面）。
      wall: spec.wall,
      depth: Number.isFinite(spec.depth) ? spec.depth : 0,
      normalX: spec.normalX,
      normalY: spec.normalY,
      grainSeed: Number.isFinite(spec.grainSeed) ? spec.grainSeed : Math.random() * TWO_PI,
      // 血量就是"还能挨几次撞击"；不参与渲染，只驱动板面破损状态。
      maxHp: PLANK_HITS,
      hp: PLANK_HITS,
      contacts: new Map(),
      hitPoints: [],
      projectileContacts: new Set(),
      pendingImpacts: [],
      stackLevel: spec.stackLevel || 1,
      hitFlash: 0,

      onShieldDeflected({ entity, shield, contact }) {
        entity.pendingImpacts.push({ attacker: shield, contact, crush: false });
      },
      onSolidImpact({ entity, attacker, contact, destroyAfterDeflection }) {
        entity.pendingImpacts.push({ attacker, contact, crush: destroyAfterDeflection === true });
      },

      update(context, dt) {
        const entity = context.entity;
        const entityServices = context.services;
        if (entity.hitFlash > 0) {
          entity.hitFlash = Math.max(0, entity.hitFlash - Math.max(0, dt) / HIT_FLASH_DURATION);
        }
        for (const impact of entity.pendingImpacts.splice(0)) {
          if (entity.entityActive === false) return;
          const contact = Object.assign({}, impact.contact, {
            contactX: impact.contact.x,
            contactY: impact.contact.y
          });
          if (impact.crush) {
            entityServices.dealDamage(impact.attacker, PLANK_COLLISION_DAMAGE);
            entity.hp = 1;
          }
          registerPlankHit(entity, entityServices, contact, impact.attacker);
        }
        if (entity.entityActive === false) return;
        resolveBallContacts(context, entity, entityServices);
        if (entity.entityActive === false) return;
        absorbProjectiles(context, entity, entityServices);
      },

      draw({ entity }, canvasContext) {
        const flash = clamp(entity.hitFlash, 0, 1);
        drawPlankBoard(canvasContext, entity, {
          flash
        });
      }
    };
    return plank;
  }

  function registerPlankHit(entity, services, contact, attacker) {
    if (entity.entityActive === false || entity.hp <= 0) return true;
    entity.hp = Math.max(0, entity.hp - 1);
    entity.hitPoints.push(toPlankLocal(entity, contact.contactX, contact.contactY));
    entity.hitFlash = 1;
    services.playSound("ability", { cue: entity.hp > 0 ? "wood-impact" : "wood-break" });
    spawnWoodDebris(services, contact.contactX, contact.contactY, Math.min(entity.width, 10), 5);
    if (entity.hp > 0) return false;
    services.reportCombatInteraction("obstacle-destroyed", attacker);
    spawnPlankShatter(services, entity);
    entity.entityActive = false;
    entity.life = 0;
    return true;
  }

  function pushTargetOut(spec, target, contact, arena) {
    if (Number.isFinite(contact.sweptX)) {
      target.x = contact.sweptX;
      target.y = contact.sweptY;
    }
    if (!(contact.penetration > 0)) return;
    const point = arena.clampPoint(target.x + contact.normalX * contact.penetration,
      target.y + contact.normalY * contact.penetration, target.radius);
    target.x = point.x;
    target.y = point.y;
  }

  // 板是实体：撞上来就按墙面镜面反射。已经在往外飞的球不改向。
  function deflectTarget(spec, target, contact) {
    const incoming = target.vx * contact.normalX + target.vy * contact.normalY;
    if (incoming >= -EPSILON) return false;
    target.vx -= 2 * incoming * contact.normalX;
    target.vy -= 2 * incoming * contact.normalY;
    target.storedVx = target.vx;
    target.storedVy = target.vy;
    return true;
  }

  function resolveBallContacts(context, entity, entityServices) {
    const arena = battleArena(context.game);
    const touching = new Set();
    entityServices.forEachContactEnemy((ball) => {
      if (!ball || ball.hp <= 0 || entity.entityActive === false) return;
      const contact = plankSweptContact(entity, ball, ball.radius);
      const key = ball.instanceId;
      if (!contact) {
        if (plankContact(entity, ball.x, ball.y, ball.radius + PLANK_RELEASE_DISTANCE)) touching.add(key);
        else entity.contacts.delete(key);
        return;
      }
      touching.add(key);
      if (!entityServices.isMovementLocked(ball)) {
        pushTargetOut(entity, ball, contact, arena);
        if (deflectTarget(entity, ball, contact)) entityServices.reportCombatInteraction("block", ball);
      }
      if (entity.contacts.has(key)) return;
      entity.contacts.set(key, true);
      entityServices.dealDamage(ball, PLANK_COLLISION_DAMAGE);
      registerPlankHit(entity, entityServices, contact, ball);
    });
    for (const key of Array.from(entity.contacts.keys())) {
      if (!touching.has(key)) entity.contacts.delete(key);
    }
  }

  // 板也是实体：敌方子弹打在板上会被挡住，同样算一次受击。
  function absorbProjectiles(context, entity, entityServices) {
    const entities = context.game.combatEntities;
    if (!Array.isArray(entities)) return;
    const live = new Set();
    for (const other of entities) {
      if (!other || other === entity || !other.isProjectile) continue;
      if (other.entityActive === false || other.life <= 0) continue;
      if (!entityServices.isEnemy(other)) continue;
      live.add(other);
      const radius = Number.isFinite(other.radius) ? other.radius : 3;
      const motion = Object.assign({}, other, {
        prevX: Number.isFinite(other.previousX) ? other.previousX : other.prevX,
        prevY: Number.isFinite(other.previousY) ? other.previousY : other.prevY
      });
      const contact = plankSweptContact(entity, motion, radius);
      if (!plankContact(entity, other.x, other.y, radius + PLANK_RELEASE_DISTANCE)) {
        entity.projectileContacts.delete(other);
      }
      if (!contact) continue;
      if (entity.projectileContacts.has(other)) continue;
      entity.projectileContacts.add(other);
      const chipX = contact.contactX;
      const chipY = contact.contactY;
      if (other.indestructible !== true) {
        entityServices.reportCombatInteraction("block", other);
        other.life = 0;
        other.entityActive = false;
      }
      entityServices.spawnParticleBurst({
        x: chipX,
        y: chipY,
        kind: "old-wood-master-block",
        count: 8,
        colors: NAIL_SPARK_COLORS,
        minDiameter: 0.7,
        maxDiameter: 2.2,
        minSpeed: 60,
        maxSpeed: 170,
        life: 0.35,
        drag: 3
      });
      if (registerPlankHit(entity, entityServices, contact, other)) return;
    }
    for (const other of entity.projectileContacts) if (!live.has(other)) entity.projectileContacts.delete(other);
  }

  // ── 球本体 ─────────────────────────────────────────────────────────────
  const oldWoodMasterDefinition = {
    id: "oldWoodMaster",
    name: "老木师",
    englishName: "Old Wood Master",
    color: BODY_COLOR,
    description: "撞墙或木板表面钉板 / 板厚 5-80、板长 5-80 / 贴面搭建，层数取决于场地空间 / 受击三次碎裂，钢卷先改向再撞碎 / 碰撞伤害 2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let nailing = null;
      // 已经落下的锤数（收工之后仍然保留，便于观察与测试）。
      let strikesDone = 0;
      const planks = [];
      const supportContacts = new Set();

      function alivePlanks() {
        for (let index = planks.length - 1; index >= 0; index -= 1) {
          const plank = planks[index];
          if (!plank || plank.entityActive === false || plank.life <= 0) planks.splice(index, 1);
        }
        return planks;
      }

      // 撞墙当帧定下"板钉在哪一面墙、钉在哪个位置、板面朝哪"。
      function wallFrame(ball, context) {
        const arenaSize = context.game.arenaSize;
        const arena = battleArena(context.game);
        const radius = ball.radius;
        if (arena.shape === "circle") {
          const outward = normalizeDirection(ball.x - arena.centerX, ball.y - arena.centerY);
          return {
            side: "circle", horizontal: false, outwardX: outward.x, outwardY: outward.y,
            normalX: -outward.x, normalY: -outward.y,
            angle: Math.atan2(outward.x, -outward.y), wallSide: -1,
            arena, arenaSize,
            wallX: arena.centerX + outward.x * arena.width / 2,
            wallY: arena.centerY + outward.y * arena.width / 2
          };
        }
        const distances = {
          left: ball.x - radius - arena.left,
          right: (arena.right - radius) - ball.x,
          top: ball.y - radius - arena.top,
          bottom: (arena.bottom - radius) - ball.y
        };
        let side = null;
        if (context.bouncedX && context.bouncedY) {
          // 角落：钉在更贴近的那一面墙上。
          const horizontal = distances.left <= distances.right ? "left" : "right";
          const vertical = distances.top <= distances.bottom ? "top" : "bottom";
          side = distances[horizontal] <= distances[vertical] ? horizontal : vertical;
        } else if (context.bouncedX) {
          side = distances.left <= distances.right ? "left" : "right";
        } else if (context.bouncedY) {
          side = distances.top <= distances.bottom ? "top" : "bottom";
        } else {
          // 引擎没报反弹轴（陀螺模式的盘壁等）：退化成"离球最近的一面轴墙"。
          side = Object.entries(distances).sort((left, right) => left[1] - right[1])[0][0];
        }

        const horizontal = side === "left" || side === "right";
        const outwardX = side === "left" ? -1 : side === "right" ? 1 : 0;
        const outwardY = side === "top" ? -1 : side === "bottom" ? 1 : 0;
        // 长边沿墙：竖直墙 → 板长走 y（角度 90°）；水平墙 → 板长走 x（角度 0）。
        const angle = horizontal ? Math.PI / 2 : 0;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        // 贴墙那一面在局部坐标里的方向（局部 y 是板厚方向）。
        const wallSide = Math.sign(-outwardX * sin + outwardY * cos) || 1;
        return {
          side,
          horizontal,
          outwardX,
          outwardY,
          normalX: -outwardX,
          normalY: -outwardY,
          angle,
          wallSide,
          arena,
          arenaSize
        };
      }

      // 板沿墙的落点：以撞墙位置为中心，夹到板能整个装进场地的范围里。
      function nailSpanFor(frame, ball, length) {
        const half = length / 2;
        const arena = frame.arena;
        const limit = Math.min(half, (frame.horizontal ? arena.height : arena.width) / 2);
        const center = frame.horizontal
          ? clamp(ball.y, arena.top + limit, arena.bottom - limit)
          : clamp(ball.x, arena.left + limit, arena.right - limit);
        return { center, min: center - half, max: center + half };
      }

      // 板心位置：从墙面往里退 depth（0 = 贴墙，>0 = 摞在旧板上面）。
      function nailAnchorFor(frame, ball, thickness, length, depth) {
        if (frame.side === "circle") {
          const radius = frame.arena.width / 2;
          const sagitta = radius - Math.sqrt(Math.max(0, radius * radius - length * length / 4));
          const inset = sagitta + depth + thickness / 2;
          return { x: frame.wallX + frame.normalX * inset, y: frame.wallY + frame.normalY * inset };
        }
        if (frame.support) {
          return { x: frame.support.x + frame.normalX * (frame.support.width + thickness) / 2,
            y: frame.support.y + frame.normalY * (frame.support.width + thickness) / 2 };
        }
        const span = nailSpanFor(frame, ball, length);
        if (frame.horizontal) {
          return {
            x: frame.side === "left"
              ? frame.arena.left + depth + thickness / 2
              : frame.arena.right - depth - thickness / 2,
            y: span.center
          };
        }
        return {
          x: span.center,
          y: frame.side === "top"
            ? frame.arena.top + depth + thickness / 2
            : frame.arena.bottom - depth - thickness / 2
        };
      }

      // Validate the actual new rectangle; distant walls are not supporting layers.
      function placementFits(context, spec) {
        const box = plankWorldBox(spec);
        const arena = battleArena(context.game);
        for (const x of [-spec.length / 2, spec.length / 2]) {
          for (const y of [-spec.width / 2, spec.width / 2]) {
            const worldX = spec.x + Math.cos(spec.angle) * x - Math.sin(spec.angle) * y;
            const worldY = spec.y + Math.sin(spec.angle) * x + Math.cos(spec.angle) * y;
            if (!arena.contains(worldX, worldY)) return false;
          }
        }
        for (const entity of context.game.combatEntities) {
          if (!isLivePlank(entity)) continue;
          const other = plankWorldBox(entity);
          if (spansOverlap({ min: box.minX, max: box.maxX }, { min: other.minX, max: other.maxX }) &&
              spansOverlap({ min: box.minY, max: box.maxY }, { min: other.minY, max: other.maxY })) return false;
        }
        return true;
      }

      // 干活期间把速度扣住：老木师是"停在墙边钉完再走"的。
      function holdBall(ball) {
        services.setMovementLocked(true);
        ball.vx = 0;
        ball.vy = 0;
        ball.storedVx = 0;
        ball.storedVy = 0;
      }

      // 只恢复朝向，由引擎按当前倍率和控制状态决定恢复速度的时机。
      function releaseHeading(ball, released) {
        const magnitude = Math.hypot(released.x, released.y);
        if (magnitude <= EPSILON) return;
        ball.storedVx = released.x / magnitude;
        ball.storedVy = released.y / magnitude;
        ball.speedNeedsNormalization = true;
        services.setSpeedMultiplier(ball.speedMultiplierBase);
      }

      function releaseBall(ball, force) {
        if (!nailing) return;
        const released = nailing.velocity;
        if (nailing.preview) nailing.preview.life = 0;
        nailing = null;
        services.setMovementLocked(false);
        if (!ball || !released) return;
        // 已经被别的机制带起来了（击退位移等）：别拿施工前的朝向去覆盖它。
        if (!force && Math.hypot(ball.vx, ball.vy) > 1) return;
        releaseHeading(ball, released);
      }

      // 租借（交换）会把整套动作搬到另一具身体上：半成品钉子钉在"原来那具
      // 身体"的墙面上，不能把新身体拖过去。取消施工，并把被扣住的移动还给
      // 真正发起施工的那具身体——此刻 services 已经绑定到新身体了。
      function cancelNailing() {
        if (!nailing) return;
        const body = nailing.body;
        const released = nailing.velocity;
        if (nailing.preview) nailing.preview.life = 0;
        nailing = null;
        if (!body) return;
        body.movementLocked = false;
        if (released && Math.hypot(body.vx, body.vy) <= 1) {
          body.vx = body.storedVx = released.x;
          body.vy = body.storedVy = released.y;
        }
      }

      function startNailing(context, support, contact) {
        const ball = context.ball;
        if (nailing || services.isMovementLocked(ball) || !services.getCapabilities(ball).canAct) return false;
        let frame = wallFrame(ball, context);
        let depth = 0;
        const stackLevel = support ? (support.stackLevel || 1) + 1 : 1;
        if (support) {
          const horizontal = Math.abs(contact.normalX) >= Math.abs(contact.normalY);
          const normalX = horizontal ? Math.sign(contact.normalX) : 0;
          const normalY = horizontal ? 0 : Math.sign(contact.normalY);
          const side = horizontal ? (normalX > 0 ? "left" : "right") : (normalY > 0 ? "top" : "bottom");
          const angle = horizontal ? Math.PI / 2 : 0;
          frame = { side, horizontal, normalX, normalY, outwardX: -normalX, outwardY: -normalY,
            angle, wallSide: horizontal ? normalX : -normalY, arenaSize: context.game.arenaSize,
            arena: battleArena(context.game) };
          depth = inwardExtent(frame, plankWorldBox(support));
          if (frame.arena.shape === "circle") {
            const direction = normalizeDirection(contact.normalX, contact.normalY);
            frame.normalX = direction.x;
            frame.normalY = direction.y;
            frame.outwardX = -direction.x;
            frame.outwardY = -direction.y;
            frame.angle = Math.atan2(-direction.x, direction.y);
            frame.wallSide = -1;
            frame.support = support;
            depth = support.width;
          }
        }
        const thickness = randomSize(PLANK_MIN_THICKNESS, PLANK_MAX_THICKNESS);
        const length = randomSize(PLANK_MIN_LENGTH, PLANK_MAX_LENGTH);
        if (depth + thickness + ball.radius * 2 + PLANK_DEPTH_MARGIN >
            (frame.horizontal ? frame.arena.width : frame.arena.height)) return false;
        const anchor = nailAnchorFor(frame, ball, thickness, length, depth);
        const velocity = {
          x: Number.isFinite(ball.storedVx) ? ball.storedVx : ball.vx,
          y: Number.isFinite(ball.storedVy) ? ball.storedVy : ball.vy
        };
        const spec = {
          x: anchor.x,
          y: anchor.y,
          angle: frame.angle,
          length,
          width: thickness,
          wall: frame.side,
          depth,
          stackLevel,
          wallSide: frame.wallSide,
          normalX: frame.normalX,
          normalY: frame.normalY,
          grainSeed: Math.random() * TWO_PI
        };
        if (!placementFits(context, spec)) return false;
        // Reserve the builder's retreat too: a fitting board must not push its
        // maker into a different board across a narrow passage.
        const retreatDistance = frame.side === "circle"
          ? thickness + frame.arena.width / 2 - Math.sqrt(Math.max(0, frame.arena.width ** 2 / 4 - length ** 2 / 4))
          : thickness;
        const retreat = {
          prevX: ball.x, prevY: ball.y,
          x: ball.x + frame.normalX * retreatDistance,
          y: ball.y + frame.normalY * retreatDistance
        };
        if (!frame.arena.contains(retreat.x, retreat.y, ball.radius)) return false;
        for (const entity of context.game.combatEntities) {
          if (!isLivePlank(entity) || entity === support) continue;
          if (plankSweptContact(entity, retreat, ball.radius - 1e-6)) return false;
        }
        strikesDone = 0;
        nailing = {
          body: ball,
          spec,
          frame,
          anchorX: anchor.x,
          anchorY: anchor.y,
          duration: NAIL_DURATION,
          retreatDistance,
          elapsed: 0,
          strikes: 0,
          velocity,
          support,
          startX: ball.x,
          startY: ball.y,
          preview: null
        };
        holdBall(ball);
        // 预告板：干活期间以半透明的方式"长"在墙上，每落一锤多一颗钉。
        nailing.preview = services.spawnVisualEffect(createPlankPreview(spec, nailing), { lifecycle: "owner-bound" });
        spawnSawdust(services, anchor.x, anchor.y, frame.normalX, frame.normalY);
        return true;
      }

      function touchPlanks(context, canBuild) {
        const ball = context.ball;
        if (nailing || services.isMovementLocked(ball)) return;
        const touched = new Set();
        const contacts = [];
        for (const plank of context.game.combatEntities) {
          if (!isLivePlank(plank)) continue;
          if (plankContact(plank, ball.x, ball.y, ball.radius + PLANK_RELEASE_DISTANCE)) touched.add(plank);
          const contact = plankSweptContact(plank, ball, ball.radius);
          if (contact) contacts.push({ plank, contact });
        }
        contacts.sort((a, b) => (a.contact.progress || 0) - (b.contact.progress || 0));
        for (const { plank, contact } of contacts) {
          pushTargetOut(plank, ball, contact, battleArena(context.game));
          const reflected = deflectTarget(plank, ball, contact);
          if (!supportContacts.has(plank) && reflected && canBuild) {
            supportContacts.add(plank);
            if (startNailing(context, plank, contact)) break;
          }
          supportContacts.add(plank);
        }
        for (const plank of supportContacts) {
          if (!touched.has(plank)) supportContacts.delete(plank);
        }
      }

      function performStrike(context) {
        const ball = context.ball;
        const index = nailing.strikes;
        nailing.strikes += 1;
        strikesDone = nailing.strikes;
        const growth = easeOutCubic(nailing.elapsed / nailing.duration);
        const nailSpec = Object.assign({}, nailing.spec, {
          width: Math.max(0.1, nailing.spec.width * growth),
          x: nailing.spec.x - nailing.frame.normalX * nailing.spec.width * (1 - growth) / 2,
          y: nailing.spec.y - nailing.frame.normalY * nailing.spec.width * (1 - growth) / 2
        });
        const nail = plankNailWorldPosition(nailSpec, index);
        const head = hammerHeadPosition(ball, nailing);
        services.spawnVisualEffect(createNailFlight(
          head.headX,
          head.headY,
          nail.x,
          nail.y
        ));
        spawnSawdust(services, nail.x, nail.y, nailing.frame.normalX, nailing.frame.normalY);
        services.playSound("ability", { cue: "wood-build" });
      }

      function finishNailing(context) {
        const ball = context.ball;
        const spec = nailing.spec;
        if ((nailing.support && !isLivePlank(nailing.support)) || !placementFits(context, spec)) {
          releaseBall(ball, false);
          return;
        }
        const plank = services.spawnCombatEntity(createPlankEntity(spec));
        if (plank) planks.push(plank);
        services.spawnParticleBurst({
          x: spec.x,
          y: spec.y,
          kind: "old-wood-master-settle",
          count: 8,
          colors: SAWDUST_COLORS,
          minDiameter: 0.8,
          maxDiameter: 2.4,
          minSpeed: 40,
          maxSpeed: 120,
          initialRadius: Math.max(spec.length, spec.width) * 0.35,
          life: 0.4,
          drag: 2.8
        });
        services.playSound("ability", { cue: "wood-build", intensity: 1.2 });
        releaseBall(ball, false);
      }

      return {
        onSpawn(context) {
        },
        update(context, dt) {
          if (!nailing) return;
          if (nailing.support && !isLivePlank(nailing.support)) {
            releaseBall(context.ball, false);
            return;
          }
          const step = Math.max(0, dt);
          nailing.elapsed += step;
          holdBall(context.ball);
          const shift = nailing.retreatDistance * easeOutCubic(nailing.elapsed / nailing.duration);
          context.ball.x = nailing.startX + nailing.frame.normalX * shift;
          context.ball.y = nailing.startY + nailing.frame.normalY * shift;
          while (nailing.strikes < NAIL_STRIKE_FRACTIONS.length &&
            nailing.elapsed + EPSILON >= nailing.duration * NAIL_STRIKE_FRACTIONS[nailing.strikes]) {
            performStrike(context);
          }
          if (nailing.elapsed + EPSILON >= nailing.duration) finishNailing(context);
        },
        updateWhilePaused(context) {
          // 被控住的时候钉板动作也停住：干活是要花时间的。
          if (nailing) holdBall(context.ball);
        },
        afterUpdateStep(context) { touchPlanks(context, true); },
        afterUpdateStepWhilePaused(context) { touchPlanks(context, false); },
        // 套件换手（交换租借）：施工状态、贴板节流都是上一具身体的历史，
        // 必须立即作废，否则移动锁会留在原身、木块也不再推它。
        onAttackTransfer() {
          supportContacts.clear();
          cancelNailing();
        },
        // 落锤与收工都是精确的时间边界：让引擎在这些时刻切步。
        getNextTransitionIn(context) {
          if (!nailing) return undefined;
          let boundary = nailing.duration - nailing.elapsed;
          for (let index = nailing.strikes; index < NAIL_STRIKE_FRACTIONS.length; index += 1) {
            boundary = Math.min(
              boundary,
              nailing.duration * NAIL_STRIKE_FRACTIONS[index] - nailing.elapsed
            );
          }
          return Math.max(1e-3, boundary);
        },
        onWallBounce(context) {
          // 一次只干一件活：正在钉板时撞墙不会叠加新板。
          if (nailing) return;
          startNailing(context);
        },
        onDeath(context) {
          // 死了就不再落板，也不要把速度还给一具尸体。
          if (nailing && nailing.preview) nailing.preview.life = 0;
          nailing = null;
          services.setMovementLocked(false);
        },
        // 莉音借用结束时必须收手并把自己放回场上，否则借来的身体会停死在原地。
        onBorrowEnd(context) {
          if (!nailing) return;
          releaseBall(context.ball, true);
        },
        drawBody(context, canvasContext) {
          drawWoodDisc(canvasContext, context.ball);
          if (nailing) drawHammer(canvasContext, context.ball, nailing);
          return true;
        },
        getOldWoodMasterState() {
          return {
            plankHits: PLANK_HITS,
            collisionDamage: PLANK_COLLISION_DAMAGE,
            nailDuration: NAIL_DURATION,
            minThickness: PLANK_MIN_THICKNESS,
            maxThickness: PLANK_MAX_THICKNESS,
            minLength: PLANK_MIN_LENGTH,
            maxLength: PLANK_MAX_LENGTH,
            nailing: nailing !== null,
            strikes: strikesDone,
            elapsed: nailing ? nailing.elapsed : 0,
            planks: alivePlanks().length
          };
        }
      };
    }
  };

  registerBall(oldWoodMasterDefinition);

  return {
    oldWoodMasterDefinition,
    createOldWoodMasterPlank: createPlankEntity,
    createOldWoodMasterPlankPreview: createPlankPreview,
    createOldWoodMasterNailFlight: createNailFlight,
    OLD_WOOD_MASTER_PLANK_KIND: PLANK_KIND,
    OLD_WOOD_MASTER_PLANK_PREVIEW_KIND: PLANK_PREVIEW_KIND,
    OLD_WOOD_MASTER_PLANK_HITS: PLANK_HITS,
    OLD_WOOD_MASTER_PLANK_COLLISION_DAMAGE: PLANK_COLLISION_DAMAGE,
    OLD_WOOD_MASTER_PLANK_MIN_THICKNESS: PLANK_MIN_THICKNESS,
    OLD_WOOD_MASTER_PLANK_MAX_THICKNESS: PLANK_MAX_THICKNESS,
    OLD_WOOD_MASTER_PLANK_MIN_LENGTH: PLANK_MIN_LENGTH,
    OLD_WOOD_MASTER_PLANK_MAX_LENGTH: PLANK_MAX_LENGTH,
    OLD_WOOD_MASTER_NAIL_DURATION: NAIL_DURATION,
    OLD_WOOD_MASTER_PLANK_RELEASE_DISTANCE: PLANK_RELEASE_DISTANCE,
    OLD_WOOD_MASTER_PLANK_DEPTH_MARGIN: PLANK_DEPTH_MARGIN
  };
});
