(function initializeBaiWanRenField(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBaiWanRenFieldApi() {
  const SIZE = 640;
  const MOTION_SIZE = 320;
  const TAU = Math.PI * 2;
  const STRIPS = 80;
  const EPSILON = 1e-9;

  // 贴边入场：小兵从边线内侧出发，方向只朝场内（±75°）。
  const EDGE_INSET = 1.5;
  const ENTRY_SPREAD = Math.PI * 0.42;

  function createVisualRandom() {
    let seed = 0x71e5ca9;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function trace(context, points) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
  }

  function createAnatomy() {
    const random = createVisualRandom();
    const vessels = [];

    function branch(x, y, angle, length, width, depth, phase) {
      const points = [{ x, y }];
      const bend = (random() - 0.5) * 1.8;
      for (let index = 1; index <= 18; index += 1) {
        const progress = index / 18;
        const heading = angle + bend * progress + Math.sin(progress * 5 + phase) * 0.22;
        x += Math.cos(heading) * length / 18;
        y += Math.sin(heading) * length / 18;
        points.push({ x, y });
      }
      vessels.push({ points, width, phase, pale: random() > 0.8 });
      if (depth <= 0) return;
      for (const at of [0.45, 0.8]) {
        const anchor = points[Math.floor(at * 18)];
        branch(anchor.x, anchor.y, angle + bend * at + (random() > 0.5 ? 1 : -1) * 0.65,
          length * (0.38 + random() * 0.22), width * 0.48, depth - 1, phase + at * 3);
      }
    }
    for (let side = 0; side < 4; side += 1) {
      for (let index = 0; index < 2; index += 1) {
        const along = SIZE * (0.14 + index * 0.5 + random() * 0.1);
        const x = side === 0 ? -12 : side === 1 ? SIZE + 12 : along;
        const y = side === 2 ? -12 : side === 3 ? SIZE + 12 : along;
        const heading = side === 0 ? 0 : side === 1 ? Math.PI : side === 2 ? Math.PI / 2 : -Math.PI / 2;
        branch(x, y, heading + (random() - 0.5) * 0.9, 165 + random() * 100,
          4 + random() * 5, 2, random() * TAU);
      }
    }
    return { vessels };
  }

  function createNoise() {
    const random = createVisualRandom();
    const grids = [8, 16, 32, 64, 128].map((size) => ({
      size, values: Float32Array.from({ length: (size + 1) * (size + 1) }, random)
    }));
    return (x, y, octave) => {
      const grid = grids[octave];
      const gx = Math.max(0, Math.min(grid.size - 0.001, x * grid.size / SIZE));
      const gy = Math.max(0, Math.min(grid.size - 0.001, y * grid.size / SIZE));
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      let tx = gx - ix;
      let ty = gy - iy;
      tx *= tx * (3 - 2 * tx);
      ty *= ty * (3 - 2 * ty);
      const at = iy * (grid.size + 1) + ix;
      const top = grid.values[at] * (1 - tx) + grid.values[at + 1] * tx;
      const bottom = grid.values[at + grid.size + 1] * (1 - tx) + grid.values[at + grid.size + 2] * tx;
      return top * (1 - ty) + bottom * ty;
    };
  }

  function drawSculptedTissue(context) {
    const noise = createNoise();
    const heights = new Float32Array(SIZE * SIZE);
    const depths = new Float32Array(SIZE * SIZE);
    const tissue = new Float32Array(SIZE * SIZE);
    const pores = new Float32Array(SIZE * SIZE);
    // A continuous, irregular lumen: relief normals provide volume and wet highlights.
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const i = y * SIZE + x;
        const n0 = noise(x, y, 0);
        const n1 = noise(x, y, 1);
        const n2 = noise(x, y, 2);
        const n3 = noise(x, y, 3);
        const n4 = noise(x, y, 4);
        const dx = (x - SIZE * 0.53 + (n0 - 0.5) * 80) * 0.91;
        const dy = (y - SIZE * 0.47 + (n1 - 0.5) * 38) * 1.08;
        const radius = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const folds = radius * 0.054 + Math.sin(angle * 3 + radius * 0.007) * 0.92 +
          Math.sin(angle * 7 - radius * 0.009) * 0.26 + (n1 - 0.5) * 1.7;
        const ridge = Math.pow(0.5 + Math.sin(folds) * 0.5, 0.63);
        const grain = Math.sin(angle * 33 + radius * 0.043 + n2 * 3.2);
        heights[i] = ridge * (22 + n0 * 16) + n2 * 6 + n3 * 2.6 +
          n4 * 0.7 + grain * 0.48;
        depths[i] = ridge;
        tissue[i] = n1 * 0.65 + n2 * 0.35;
        pores[i] = n4;
      }
    }
    const image = context.createImageData(SIZE, SIZE);
    const data = image.data;
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const i = y * SIZE + x;
        const sx = (heights[y * SIZE + Math.max(0, x - 1)] -
          heights[y * SIZE + Math.min(SIZE - 1, x + 1)]) * 1.4;
        const sy = (heights[Math.max(0, y - 1) * SIZE + x] -
          heights[Math.min(SIZE - 1, y + 1) * SIZE + x]) * 1.4;
        const normalLength = Math.hypot(sx, sy, 1);
        const diffuse = Math.max(0, (sx * -0.3 + sy * -0.4 + 0.866) / normalLength);
        const glint = Math.pow(Math.max(0, (sx * -0.155 + sy * -0.207 + 0.966) / normalLength), 28);
        const radius = Math.hypot((x - SIZE * 0.53) * 0.91, (y - SIZE * 0.47) * 1.08);
        const opening = Math.min(1, Math.max(0, (radius - 15) / 102));
        const depthLight = 0.14 + opening * 0.86;
        const shade = (0.2 + diffuse * 0.8) * (0.36 + depths[i] * 0.64) * depthLight;
        const pale = Math.max(0, tissue[i] - 0.52) * 2.1;
        const wet = glint * 148 * depthLight * (0.65 + pores[i] * 0.35);
        data[i * 4] = Math.min(255, (157 + tissue[i] * 91) * shade + wet);
        data[i * 4 + 1] = Math.min(255, (27 + tissue[i] * 45 + pale * 61) * shade + wet * 0.8);
        data[i * 4 + 2] = Math.min(255, (46 + tissue[i] * 43 + pale * 57) * shade + wet * 0.73);
        data[i * 4 + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }

  function createSurface(context, size = SIZE) {
    const ownerDocument = context.canvas && context.canvas.ownerDocument;
    const surface = ownerDocument ? ownerDocument.createElement("canvas")
      : (typeof OffscreenCanvas === "function" ? new OffscreenCanvas(size, size) : null);
    if (!surface) return null;
    surface.width = surface.height = size;
    return surface;
  }

  function drawVessel(context, vessel, time) {
    const points = vessel.points.map((point, index) => {
      const envelope = Math.sin(index / (vessel.points.length - 1) * Math.PI);
      return {
        x: point.x + Math.sin(time * 0.7 + index * 0.42 + vessel.phase) * 3.6 * envelope,
        y: point.y + Math.cos(time * 0.63 - index * 0.37 + vessel.phase) * 3 * envelope
      };
    });
    context.lineCap = "round";
    context.lineJoin = "round";
    trace(context, points);
    context.strokeStyle = "rgba(20,3,12,0.3)";
    context.lineWidth = vessel.width + 2;
    context.stroke();
    context.strokeStyle = vessel.pale ? "#674049" : "#581426";
    context.lineWidth = vessel.width + 1;
    context.stroke();
    const left = [];
    const right = [];
    for (let index = 0; index < points.length; index += 1) {
      const wave = Math.pow(Math.max(0, Math.sin(time * 2.6 - index * 0.45 + vessel.phase)), 4);
      const taper = 1 - index / points.length * 0.55;
      const radius = vessel.width * taper * (0.6 + wave * 0.52) / 2;
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      const nx = -(after.y - before.y) / length * radius;
      const ny = (after.x - before.x) / length * radius;
      left.push({ x: points[index].x + nx, y: points[index].y + ny });
      right.push({ x: points[index].x - nx, y: points[index].y - ny });
    }
    trace(context, left.concat(right.reverse()));
    context.closePath();
    context.fillStyle = vessel.pale ? "#95716e" : "#92334b";
    context.fill();
    context.save();
    context.translate(-0.7, -0.9);
    trace(context, points);
    context.lineWidth = Math.max(0.45, vessel.width * 0.12);
    context.strokeStyle = "rgba(242,176,164,0.23)";
    context.stroke();
    context.restore();
  }

  // ---------- 场地几何：边线入场口 ----------

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }


  // 贴边入场：先取边线内侧一点，再在朝内半圆里随机一个方向。方向随机，但永远不会
  // 指向场外，也不会出现先钻出场再回来的情况。random 可注入，方便确定性测试。
  function baiWanRenEdgeEntry(arenaSize, radius, random = Math.random) {
    const side = Math.floor(random() * 4);
    if (typeof arenaSize === "object") {
      const point = arenaSize.boundaryPoint(["top", "right", "bottom", "left"][side], random(), radius + EDGE_INSET);
      return { side, x: point.x, y: point.y,
        angle: Math.atan2(point.normalY, point.normalX) + (random() * 2 - 1) * ENTRY_SPREAD };
    }
    const room = Math.max(EPSILON, arenaSize - radius * 4 - EDGE_INSET);
    const along = radius * 2 + EDGE_INSET + random() * room;
    const inset = radius + EDGE_INSET;
    let x = along;
    let y = inset;
    let inward = Math.PI / 2;
    if (side === 1) {
      x = arenaSize - inset;
      y = along;
      inward = Math.PI;
    } else if (side === 2) {
      x = along;
      y = arenaSize - inset;
      inward = -Math.PI / 2;
    } else if (side === 3) {
      x = inset;
      y = along;
      inward = 0;
    }
    return {
      side,
      x: clamp(x, radius, arenaSize - radius),
      y: clamp(y, radius, arenaSize - radius),
      angle: inward + (random() * 2 - 1) * ENTRY_SPREAD
    };
  }

  function createBaiWanRenField() {
    const anatomy = createAnatomy();
    let texture = null;
    let horizontal = null;
    let frame = null;
    let frameTime = null;
    return {
      draw({ game, ball }, context) {
        if (ball.hp <= 0 || ball.active === false || ball.isModeActive === false) return;
        const time = Number.isFinite(game.time) ? game.time : 0;
        const size = game.arenaSize;
        if (!texture) {
          texture = createSurface(context);
          horizontal = createSurface(context, MOTION_SIZE);
          frame = createSurface(context, MOTION_SIZE);
          if (texture) {
            const tissue = texture.getContext("2d");
            drawSculptedTissue(tissue);
            for (const vessel of anatomy.vessels) drawVessel(tissue, vessel, 0);
          }
        }
        if (!texture || !frame) return;
        context.save();
        context.beginPath();
        context.rect(0, 0, size, size);
        context.clip();
        context.scale(size / SIZE, size / SIZE);
        context.globalAlpha *= 0.48;
        const tick = Math.floor(time * 30);
        if (frameTime !== tick) {
          const paint = frame.getContext("2d");
          const stretch = horizontal.getContext("2d");
          const visualTime = tick / 30;
          const stripHeight = SIZE / STRIPS;
          const scale = MOTION_SIZE / SIZE;
          for (let index = 0; index < STRIPS; index += 1) {
            const y = index * stripHeight;
            const shift = Math.sin(visualTime * 1.72 - y * 0.014) * 19 + Math.sin(visualTime * 0.91 + y * 0.026) * 8;
            const swell = 54 + Math.sin(visualTime * 1.92 - y * 0.011) * 24;
            stretch.drawImage(texture, 0, y, SIZE, stripHeight, (shift - swell) * scale, y * scale, (SIZE + swell * 2) * scale, stripHeight * scale + 0.5);
          }
          for (let index = 0; index < STRIPS; index += 1) {
            const x = index * stripHeight;
            const shift = Math.sin(visualTime * 1.38 - x * 0.018 + 1.1) * 17 + Math.cos(visualTime * 0.82 + x * 0.023) * 8;
            const swell = 52 + Math.sin(visualTime * 1.67 - x * 0.012 + 2) * 24;
            paint.drawImage(horizontal, x * scale, 0, stripHeight * scale, MOTION_SIZE, x * scale, (shift - swell) * scale, stripHeight * scale + 0.5, (SIZE + swell * 2) * scale);
          }
          frameTime = tick;
        }
        context.drawImage(frame, 0, 0, SIZE, SIZE);
        context.restore();
      },
      dispose() {
        texture = null;
        horizontal = null;
        frame = null;
        frameTime = null;
      }
    };
  }

  return {
    createBaiWanRenField,
    baiWanRenEdgeEntry
  };
});
