(function initializeCocktailVisuals(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/visual-properties.js")
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCocktailVisualsPlugin(dependencies) {
  "use strict";

  const { createVisualPropertyAnimation } = dependencies || {};
  if (typeof createVisualPropertyAnimation !== "function") {
    throw new Error("扎啤视效需要先加载 src/core/visual-properties.js");
  }

  const TAU = Math.PI * 2;
  const EPSILON = 1e-6;

  const BOTTLE_LENGTH = 20;
  const BOTTLE_WIDTH = 7;
  const BOTTLE_HALF = BOTTLE_WIDTH * 0.5;
  const BOTTLE_NECK = BOTTLE_WIDTH * 0.19;
  const BOTTLE_BASE_Y = BOTTLE_LENGTH * 0.43;
  const BOTTLE_SHOULDER_Y = -BOTTLE_LENGTH * 0.13;
  const BOTTLE_MOUTH_Y = -BOTTLE_LENGTH * 0.44;

  const GLASS_DARK = "#1b2f1e";
  const GLASS_LIP = "#152516";
  const GLASS_SHEEN = "rgba(132,186,120,0.26)";
  const GLASS_EDGE = "rgba(126,172,116,0.40)";
  const FUEL_FILL = "rgba(132,78,30,0.55)";
  const LABEL_PAPER = "#cbbd8d";
  const LABEL_EDGE = "rgba(150,132,90,0.65)";
  const LABEL_INK = "rgba(92,72,44,0.45)";
  const LABEL_STAR = "#a8271d";
  const RAG_CLOTH = "#4d463c";
  const RAG_LIT = "rgba(178,136,78,0.65)";

  const FLAME_DEEP = "#e6401a";
  const FLAME_BODY = "#ff7a26";
  const FLAME_HOT = "#ffc24d";
  const FLAME_CORE = "#fff3c8";
  const FIRE_TONES = Object.freeze([FLAME_DEEP, FLAME_BODY, FLAME_HOT]);
  const FIRE_GLOW = "#ff5c10";
  const SPARK_COLORS = Object.freeze(["#ffe9a8", "#ffc24d", "#ff8a33", "#ff5a1a"]);
  const EMBER_COLORS = Object.freeze(["#ffb347", "#ff6a1f", "#c9390f"]);
  const PUDDLE_CHAR = "rgba(24,16,11,0.72)";
  const PUDDLE_DARK = "rgba(78,40,15,0.72)";
  const PUDDLE_BODY = "rgba(122,62,19,0.66)";
  const GLASS_SHARD = "rgba(52,86,60,0.68)";
  const GLASS_SHARD_EDGE = "rgba(152,190,160,0.55)";
  const GLASS_SHARD_FACET = "rgba(20,42,26,0.45)";
  const GLASS_SHARD_HOT = "rgba(255,176,86,0.55)";
  const WICK_TRAIL_SMOKE = "rgba(150,128,104,0.42)";
  const WICK_TRAIL_EMBER = "rgba(255,160,80,0.85)";
  const LIQUID_SPLASH = Object.freeze(["#b85a1a", "#e08a2a", "#8a3a12"]);

  function clamp(value, minimum, maximum) {
    return value < minimum ? minimum : value > maximum ? maximum : value;
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function requireRandom(random) {
    if (typeof random !== "function") {
      throw new TypeError("扎啤视效需要公共引擎注入的 random");
    }
    return random;
  }

  function pickColor(random, colors) {
    return colors[Math.min(colors.length - 1, Math.floor(random() * colors.length))];
  }

  function withAlpha(color, alpha) {
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);
    return "rgba(" + red + "," + green + "," + blue + "," + alpha.toFixed(3) + ")";
  }

  function paintLick(canvas, x, y, height, width, time, phase, color) {
    const sway = Math.sin(time * 3.4 + phase) * width * 1.6;
    canvas.strokeStyle = color;
    canvas.lineCap = "round";
    canvas.lineWidth = width * 1.9;
    canvas.beginPath();
    canvas.moveTo(x, y);
    canvas.quadraticCurveTo(x - width * 0.5, y - height * 0.52, x + sway, y - height * 0.78);
    canvas.stroke();
    canvas.lineWidth = Math.max(0.6, width * 0.75);
    canvas.beginPath();
    canvas.moveTo(x + sway * 0.15, y - height * 0.34);
    canvas.quadraticCurveTo(x + sway * 0.6, y - height * 0.7, x + sway, y - height);
    canvas.stroke();
  }

  function createPuddlePolygon(centerX, centerY, radiusX, radiusY, points, random) {
    const polygon = [];
    for (let index = 0; index < points; index += 1) {
      const angle = index / points * TAU;
      const radial = 0.74 + 0.26 * random();
      polygon.push({
        x: centerX + Math.cos(angle) * radiusX * radial,
        y: centerY + Math.sin(angle) * radiusY * radial
      });
    }
    return polygon;
  }

  function fillPuddlePolygon(canvas, polygon) {
    canvas.beginPath();
    for (let index = 0; index < polygon.length; index += 1) {
      if (index === 0) canvas.moveTo(polygon[index].x, polygon[index].y);
      else canvas.lineTo(polygon[index].x, polygon[index].y);
    }
    canvas.closePath();
    canvas.fill();
  }

  function paintBottle(canvas, time) {
    const baseAlpha = finiteOr(canvas.globalAlpha, 1);
    canvas.globalAlpha = baseAlpha;
    canvas.fillStyle = GLASS_DARK;
    canvas.beginPath();
    canvas.moveTo(-BOTTLE_HALF + 0.8, BOTTLE_BASE_Y);
    canvas.lineTo(BOTTLE_HALF - 0.8, BOTTLE_BASE_Y);
    canvas.quadraticCurveTo(BOTTLE_HALF, BOTTLE_BASE_Y, BOTTLE_HALF, BOTTLE_BASE_Y - 1);
    canvas.lineTo(BOTTLE_HALF, BOTTLE_SHOULDER_Y + 1.6);
    canvas.quadraticCurveTo(BOTTLE_HALF, BOTTLE_SHOULDER_Y, BOTTLE_NECK, BOTTLE_SHOULDER_Y - 0.7);
    canvas.lineTo(BOTTLE_NECK, BOTTLE_MOUTH_Y);
    canvas.lineTo(-BOTTLE_NECK, BOTTLE_MOUTH_Y);
    canvas.lineTo(-BOTTLE_NECK, BOTTLE_SHOULDER_Y - 0.7);
    canvas.quadraticCurveTo(-BOTTLE_HALF, BOTTLE_SHOULDER_Y, -BOTTLE_HALF, BOTTLE_SHOULDER_Y + 1.6);
    canvas.lineTo(-BOTTLE_HALF, BOTTLE_BASE_Y - 1);
    canvas.quadraticCurveTo(-BOTTLE_HALF, BOTTLE_BASE_Y, -BOTTLE_HALF + 0.8, BOTTLE_BASE_Y);
    canvas.closePath();
    canvas.fill();
    canvas.strokeStyle = GLASS_EDGE;
    canvas.lineWidth = 0.6;
    canvas.stroke();

    canvas.fillStyle = FUEL_FILL;
    canvas.fillRect(-BOTTLE_HALF + 0.7, -0.4, BOTTLE_HALF * 2 - 1.4, BOTTLE_BASE_Y - 0.6);
    canvas.fillStyle = GLASS_SHEEN;
    canvas.fillRect(-BOTTLE_HALF + 0.7, BOTTLE_SHOULDER_Y + 1.5, 1, BOTTLE_BASE_Y - BOTTLE_SHOULDER_Y - 3.2);

    canvas.globalAlpha = baseAlpha * 0.85;
    canvas.fillStyle = LABEL_PAPER;
    canvas.fillRect(-BOTTLE_HALF + 0.35, -2.1, BOTTLE_HALF * 2 - 0.7, 4.3);
    canvas.fillStyle = LABEL_EDGE;
    canvas.fillRect(-BOTTLE_HALF + 0.35, 1.85, BOTTLE_HALF * 2 - 0.7, 0.35);
    canvas.fillStyle = LABEL_INK;
    canvas.fillRect(-1.5, -1.6, 3, 0.4);
    canvas.fillStyle = LABEL_STAR;
    const starRadius = 1.5;
    canvas.beginPath();
    for (let point = 0; point < 5; point += 1) {
      const outer = -Math.PI / 2 + point * (TAU / 5);
      const inner = outer + TAU / 10;
      const outerX = Math.cos(outer) * starRadius;
      const outerY = Math.sin(outer) * starRadius + 0.2;
      const innerX = Math.cos(inner) * starRadius * 0.45;
      const innerY = Math.sin(inner) * starRadius * 0.45 + 0.2;
      if (point === 0) canvas.moveTo(outerX, outerY);
      else canvas.lineTo(outerX, outerY);
      canvas.lineTo(innerX, innerY);
    }
    canvas.closePath();
    canvas.fill();

    canvas.globalAlpha = baseAlpha;
    canvas.fillStyle = GLASS_LIP;
    canvas.fillRect(-BOTTLE_NECK - 0.35, BOTTLE_MOUTH_Y - 0.9, BOTTLE_NECK * 2 + 0.7, 1.1);

    const sway = Math.sin(time * 6.6) * 0.7;
    canvas.fillStyle = RAG_CLOTH;
    canvas.beginPath();
    canvas.moveTo(-BOTTLE_NECK - 0.7, BOTTLE_MOUTH_Y + 0.4);
    canvas.lineTo(-BOTTLE_NECK - 0.5, BOTTLE_MOUTH_Y - 1.5);
    canvas.lineTo(BOTTLE_NECK + 0.5 + sway * 0.3, BOTTLE_MOUTH_Y - 2.2);
    canvas.lineTo(BOTTLE_NECK + 0.9, BOTTLE_MOUTH_Y - 0.6);
    canvas.lineTo(BOTTLE_NECK + 0.7, BOTTLE_MOUTH_Y + 0.5);
    canvas.closePath();
    canvas.fill();
    canvas.strokeStyle = RAG_LIT;
    canvas.lineWidth = 0.7;
    canvas.beginPath();
    canvas.moveTo(-BOTTLE_NECK - 0.5, BOTTLE_MOUTH_Y - 1.2);
    canvas.quadraticCurveTo(0, BOTTLE_MOUTH_Y - 2.5, BOTTLE_NECK + 0.5 + sway * 0.3, BOTTLE_MOUTH_Y - 1.9);
    canvas.stroke();
    canvas.fillStyle = "rgba(255,168,86,0.5)";
    canvas.beginPath();
    canvas.arc(sway * 0.3, BOTTLE_MOUTH_Y - 1.9, 0.85, 0, TAU);
    canvas.fill();
  }

  function drawCocktailBottle(context, x, y, angle, time) {
    if (!context) return;
    context.save();
    context.translate(finiteOr(x, 0), finiteOr(y, 0));
    context.rotate(finiteOr(angle, 0));
    paintBottle(context, finiteOr(time, 0));
    context.restore();
  }

  function drawCocktailShard(context, entity) {
    if (!context || !entity) return;
    const size = Math.max(0.8, finiteOr(entity.radius, 3));
    const speed = Math.hypot(finiteOr(entity.vx, 0), finiteOr(entity.vy, 0));
    let angle;
    if (speed > EPSILON) {
      angle = Math.atan2(entity.vy, entity.vx) + finiteOr(entity.age, 0) * finiteOr(entity.shardTumble, 5.2);
    } else {
      angle = finiteOr(entity.shardAngle, finiteOr(entity.angle, 0));
    }
    const baseAlpha = finiteOr(context.globalAlpha, 1);
    context.save();
    context.translate(entity.x, entity.y);
    context.rotate(angle);
    context.globalAlpha = baseAlpha * 0.9;
    // 不规则的凹口玻璃碎片：带缺口和斜折面，避免拉成细长叶形或规整宝石。
    const baseShape = [
      [-1.25, -0.15], [-0.35, -0.9], [0.85, -0.4],
      [1.2, 0.25], [0.78, 0.38], [0.45, 0.8], [-0.65, 0.55]
    ];
    const seed = finiteOr(entity.shapeSeed, 0);
    const shape = baseShape.map((point, index) => {
      const scale = size * (1 + 0.16 * Math.sin(seed * 5.3 + index * 2.1));
      return [point[0] * scale, point[1] * scale];
    });
    context.fillStyle = GLASS_SHARD;
    context.beginPath();
    for (let index = 0; index < shape.length; index += 1) {
      if (index === 0) context.moveTo(shape[index][0], shape[index][1]);
      else context.lineTo(shape[index][0], shape[index][1]);
    }
    context.closePath();
    context.fill();
    context.strokeStyle = GLASS_SHARD_EDGE;
    context.lineWidth = 0.55;
    context.stroke();
    context.strokeStyle = GLASS_SHARD_FACET;
    context.lineWidth = 0.4;
    context.beginPath();
    context.moveTo(shape[4][0], shape[4][1]);
    context.lineTo(shape[1][0], shape[1][1]);
    context.stroke();
    context.beginPath();
    context.moveTo(shape[4][0], shape[4][1]);
    context.lineTo(shape[3][0], shape[3][1]);
    context.stroke();
    if (finiteOr(entity.age, 0) < 0.18) {
      context.strokeStyle = GLASS_SHARD_HOT;
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(shape[0][0], shape[0][1]);
      context.lineTo(shape[1][0], shape[1][1]);
      context.stroke();
    }
    context.restore();
  }

  function createFireAppearance() {
    return createVisualPropertyAnimation({
      intensity: { type: "number", default: 1, min: 0, max: 1 },
      spread: { type: "number", default: 1, min: 0, max: 2 },
      soot: { type: "color", default: "#8b8176" }
    }, {
      label: "cocktail-fire",
      properties: {
        intensity: { overLife: [
          { at: 0, value: 0.2 },
          { at: 0.05, value: 0.86 },
          { at: 0.16, value: 1 },
          { at: 0.52, value: 0.9 },
          { at: 0.8, value: 0.58 },
          { at: 1, value: 0.03 }
        ] },
        spread: { overLife: [
          { at: 0, value: 0.6 },
          { at: 0.2, value: 1 },
          { at: 0.6, value: 1.05 },
          { at: 1, value: 0.84 }
        ] },
        soot: { overLife: [
          { at: 0, value: "#cdc4b5" },
          { at: 1, value: "#8b8378" }
        ] }
      }
    });
  }

  // 近俯视的圆形火场。参考火山裂缝：火焰做成几条弯曲火脉，
  // 火脉上密布小火粒、整体缓慢摆动，中心是热核；不做竖直火柱。
  function createFireParticles(radius, random) {
    const groups = [[], [], []]; // 深红、橙、亮黄，按这个顺序绘制

    function pushParticle(x, y, distanceRatio, sizeScale, branch) {
      const heat = 1 - distanceRatio + (random() - 0.5) * 0.4;
      const tone = heat > 0.6 ? 2 : heat > 0.18 ? 1 : 0;
      const flicker = random() < 0.16;
      const polar = branch
        ? { angle: Math.atan2(y, x), distance: Math.hypot(x, y) }
        : null;
      groups[tone].push({
        x, y, polar, branch,
        size: radius * (0.024 + 0.026 * random()) * sizeScale * (flicker ? 1.3 : 1),
        wx: 1.4 + 2.4 * random(),
        wy: 1.4 + 2.4 * random(),
        px: random() * TAU,
        py: random() * TAU,
        ax: radius * (0.008 + 0.018 * random()),
        ay: radius * (0.008 + 0.018 * random()),
        wr: 2 + 4 * random(),
        pr: random() * TAU,
        pulse: flicker ? 0.28 + 0.22 * random() : 0.08 + 0.14 * random()
      });
    }

    // 中心热核：火眼，不要铺成实心亮块。
    for (let index = 0; index < 40; index += 1) {
      const angle = random() * TAU;
      const distance = Math.sqrt(random()) * radius * 0.2;
      pushParticle(Math.cos(angle) * distance, Math.sin(angle) * distance, distance / radius, 0.95);
    }

    // 弯曲火脉：从中心向外爬，沿途撒下密集小火粒。
    const branchCount = 6;
    const rotation = random() * TAU;
    for (let branchIndex = 0; branchIndex < branchCount; branchIndex += 1) {
      const baseAngle = rotation + branchIndex * (TAU / branchCount) + (random() - 0.5) * 0.5;
      const branch = {
        rate: 0.8 + 0.8 * random(),
        phase: random() * TAU
      };
      const length = radius * (0.45 + 0.4 * random());
      let heading = baseAngle;
      let x = Math.cos(baseAngle) * radius * 0.05;
      let y = Math.sin(baseAngle) * radius * 0.05;
      let travelled = 0;
      while (travelled < length) {
        const step = 0.9 + 1.1 * random();
        travelled += step;
        const t = Math.min(1, travelled / length);
        // 蛇形拐弯，同时被主方向轻轻拉回，避免卷成一团。
        heading += (random() - 0.5) * 0.7 * (1 - t * 0.4);
        const pull = Math.atan2(Math.sin(baseAngle - heading), Math.cos(baseAngle - heading));
        heading += pull * 0.08;
        x += Math.cos(heading) * step;
        y += Math.sin(heading) * step;
        const reach = Math.hypot(x, y);
        if (reach > radius * 0.9) break;
        const lateral = 0.6 + 2 * (1 - t);
        const count = t < 0.3 ? 3 : t < 0.65 ? 2 : 1;
        for (let index = 0; index < count; index += 1) {
          const offset = (random() - 0.5) * lateral;
          pushParticle(
            x - Math.sin(heading) * offset,
            y + Math.cos(heading) * offset,
            reach / radius,
            1.25 - 0.45 * t,
            branch
          );
        }
      }
    }

    // 稀疏底火：只填火脉之间的暗部，不铺成一整坨。
    for (let index = 0; index < 70; index += 1) {
      const angle = random() * TAU;
      const distance = Math.sqrt(random()) * radius * 0.88;
      pushParticle(Math.cos(angle) * distance, Math.sin(angle) * distance, distance / radius, 0.7);
    }

    return groups;
  }

  function createCocktailFireVisual(options = {}) {
    const random = requireRandom(options.random);
    const x = finiteOr(options.x, 0);
    const y = finiteOr(options.y, 0);
    const radius = Math.max(4, finiteOr(options.radius, 30));
    const life = Math.max(0.2, finiteOr(options.life, 2.8));
    const appearance = createFireAppearance();
    const fireParticles = createFireParticles(radius, random);

    const sparks = Array.from({ length: 16 }, () => ({
      x: (random() - 0.5) * radius * 0.9,
      y: (random() - 0.5) * radius * 0.9,
      lift: radius * (0.5 + 0.85 * random()),
      drift: (random() - 0.5) * radius * 0.8,
      cycle: 0.5 + 0.55 * random(),
      offset: random(),
      size: 0.6 + 0.9 * random(),
      color: pickColor(random, SPARK_COLORS)
    }));

    const puffs = Array.from({ length: 5 }, () => ({
      offsetX: (random() - 0.5) * radius * 0.7,
      rise: radius * (0.8 + 0.7 * random()),
      cycle: life * (0.8 + 0.35 * random()),
      offset: random(),
      size: radius * (0.035 + 0.025 * random()),
      drift: (random() - 0.5) * radius * 0.5
    }));

    const groundEmbers = Array.from({ length: 12 }, () => {
      const angle = random() * TAU;
      const distance = radius * (0.35 + 0.55 * Math.sqrt(random()));
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 0.7 + 1.5 * random(),
        rate: 2.2 + 3.4 * random(),
        phase: random() * TAU,
        color: pickColor(random, EMBER_COLORS)
      };
    });

    // 火场就是伤害判定用的半径 30 圆，不做透视压扁。
    const puddle = {
      char: createPuddlePolygon(0, 0, radius * 1.02, radius * 1.02, 14, random),
      blobs: Array.from({ length: 4 }, (_, index) => {
        const angle = random() * TAU;
        const distance = radius * (0.12 + 0.26 * Math.sqrt(random()));
        return {
          points: createPuddlePolygon(
            Math.cos(angle) * distance,
            Math.sin(angle) * distance,
            radius * (0.24 + 0.18 * random()),
            radius * (0.24 + 0.18 * random()),
            8,
            random
          ),
          color: index % 2 === 0 ? PUDDLE_DARK : PUDDLE_BODY
        };
      })
    };

    return {
      kind: "cocktail-fire",
      life,
      x,
      y,
      radius,
      drawLayer: "background",
      draw({ effect }, canvas) {
        const look = appearance.sample(clamp(effect.age / effect.life, 0, 1));
        const intensity = look.intensity;
        const baseAlpha = finiteOr(canvas.globalAlpha, 1);
        const spreadRadius = effect.radius * look.spread;
        const time = effect.age;
        const centerX = effect.x;
        const baseY = effect.y;

        const puddleScale = 0.82 + 0.18 * look.spread;
        canvas.save();
        canvas.globalAlpha = baseAlpha * intensity;
        canvas.translate(centerX, effect.y);
        canvas.scale(puddleScale, puddleScale);
        canvas.fillStyle = PUDDLE_CHAR;
        fillPuddlePolygon(canvas, puddle.char);
        for (const blob of puddle.blobs) {
          canvas.fillStyle = blob.color;
          fillPuddlePolygon(canvas, blob.points);
        }
        canvas.restore();

        canvas.save();
        for (const puff of puffs) {
          const phase = ((time + puff.offset * puff.cycle) % puff.cycle) / puff.cycle;
          const alpha = Math.sin(Math.PI * Math.min(1, phase * 1.08)) * 0.09 * intensity;
          if (alpha <= 0.005) continue;
          canvas.globalAlpha = baseAlpha * alpha;
          canvas.fillStyle = look.soot;
          canvas.beginPath();
          canvas.arc(
            centerX + puff.offsetX + puff.drift * phase,
            baseY - spreadRadius * 0.3 - puff.rise * phase,
            puff.size * (0.8 + 0.8 * phase),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();

        canvas.save();
        canvas.translate(centerX, baseY);
        // 黑底战场：先用平面圆点叠一层暖色光晕，再画实体火粒。
        canvas.globalCompositeOperation = "lighter";
        for (let tone = 0; tone < FIRE_TONES.length; tone += 1) {
          const group = fireParticles[tone];
          canvas.fillStyle = FIRE_GLOW;
          canvas.globalAlpha = baseAlpha * intensity * (0.08 + tone * 0.03);
          canvas.beginPath();
          for (const particle of group) {
            let x;
            let y;
            if (particle.polar) {
              const sway = Math.sin(time * particle.branch.rate + particle.branch.phase) *
                0.03 * (particle.polar.distance / radius);
              const angle = particle.polar.angle + sway;
              const distance = particle.polar.distance +
                Math.sin(time * particle.wx + particle.px) * particle.ax;
              x = Math.cos(angle) * distance * puddleScale;
              y = Math.sin(angle) * distance * puddleScale;
            } else {
              x = particle.x * puddleScale +
                Math.sin(time * particle.wx + particle.px) * particle.ax;
              y = particle.y * puddleScale +
                Math.cos(time * particle.wy + particle.py) * particle.ay;
            }
            const size = Math.max(0.3, particle.size * puddleScale * 2.1);
            canvas.moveTo(x + size, y);
            canvas.arc(x, y, size, 0, TAU);
          }
          canvas.fill();
        }
        canvas.globalCompositeOperation = "source-over";
        for (let tone = 0; tone < FIRE_TONES.length; tone += 1) {
          const group = fireParticles[tone];
          canvas.fillStyle = FIRE_TONES[tone];
          canvas.globalAlpha = baseAlpha * intensity * (0.78 + tone * 0.08);
          canvas.beginPath();
          for (const particle of group) {
            let x;
            let y;
            if (particle.polar) {
              const sway = Math.sin(time * particle.branch.rate + particle.branch.phase) *
                0.03 * (particle.polar.distance / radius);
              const angle = particle.polar.angle + sway;
              const distance = particle.polar.distance +
                Math.sin(time * particle.wx + particle.px) * particle.ax;
              x = Math.cos(angle) * distance * puddleScale;
              y = Math.sin(angle) * distance * puddleScale;
            } else {
              x = particle.x * puddleScale +
                Math.sin(time * particle.wx + particle.px) * particle.ax;
              y = particle.y * puddleScale +
                Math.cos(time * particle.wy + particle.py) * particle.ay;
            }
            const size = Math.max(0.3, particle.size * puddleScale *
              (1 + particle.pulse * Math.sin(time * particle.wr + particle.pr)));
            canvas.moveTo(x + size, y);
            canvas.arc(x, y, size, 0, TAU);
          }
          canvas.fill();
        }
        canvas.restore();

        canvas.save();
        for (const ember of groundEmbers) {
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(time * ember.rate + ember.phase));
          const alpha = baseAlpha * 0.55 * pulse * intensity;
          if (alpha <= 0.02) continue;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = ember.color;
          canvas.beginPath();
          canvas.arc(centerX + ember.x, baseY + ember.y - 1, ember.size * (0.7 + 0.5 * pulse), 0, TAU);
          canvas.fill();
        }
        for (const spark of sparks) {
          const phase = ((time + spark.offset * spark.cycle) % spark.cycle) / spark.cycle;
          const alpha = baseAlpha * (1 - phase) * 0.85 * intensity;
          if (alpha <= 0.03) continue;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = spark.color;
          canvas.beginPath();
          canvas.arc(
            centerX + spark.x + spark.drift * phase,
            baseY + spark.y - spark.lift * phase,
            spark.size * (1 - 0.4 * phase),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  function createCocktailWickVisual(options = {}) {
    const random = requireRandom(options.random);
    const anchor = options.anchor || null;
    const life = Math.max(0.2, finiteOr(options.life, Number.MAX_VALUE));
    const angle = finiteOr(anchor && anchor.spinAngle, 0);
    const mouthY = BOTTLE_MOUTH_Y - 1.3;

    const trail = Array.from({ length: 3 }, (_, index) => ({
      offset: random(),
      size: 0.7 + 0.9 * random(),
      drift: (random() - 0.5) * 2,
      smoke: index !== 1
    }));

    return {
      kind: "cocktail-wick",
      life,
      anchor,
      angle,
      x: finiteOr(anchor && anchor.x, 0),
      y: finiteOr(anchor && anchor.y, 0),
      flickerSeed: random() * TAU,
      sparkSeed: random() * TAU,
      trail,
      update({ effect }) {
        const target = effect.anchor;
        if (!target || target.entityActive === false) {
          effect.visualActive = false;
          return;
        }
        effect.angle = finiteOr(target.spinAngle, effect.angle);
        effect.x = finiteOr(target.x, 0);
        effect.y = finiteOr(target.y, 0);
      },
      draw({ effect }, canvas) {
        const baseAlpha = finiteOr(canvas.globalAlpha, 1);
        const time = effect.age;
        const flicker = 0.76 + 0.16 * Math.sin(time * 13.7 + effect.flickerSeed) +
          0.08 * Math.sin(time * 29.3 + effect.flickerSeed * 2.3);

        // 只给飞行的瓶子加短余烬/细烟尾迹；持瓶时速度为 0，不画。
        const velocityX = finiteOr(effect.anchor && effect.anchor.vx, 0);
        const velocityY = finiteOr(effect.anchor && effect.anchor.vy, 0);
        const speed = Math.hypot(velocityX, velocityY);
        if (speed > 30) {
          const mouthWorldX = effect.x - Math.sin(effect.angle) * mouthY;
          const mouthWorldY = effect.y + Math.cos(effect.angle) * mouthY;
          const backX = -velocityX / speed;
          const backY = -velocityY / speed;
          const sideX = -backY;
          const sideY = backX;
          const strength = clamp(speed / 250, 0, 1);
          canvas.save();
          canvas.globalCompositeOperation = "source-over";
          for (const puff of effect.trail) {
            const phase = ((time * 2.6 + puff.offset) % 0.3) / 0.3;
            // 从瓶口继续往瓶身/瓶底后方拖，避免尾迹被瓶子自己盖住。
            const distance = 12 + phase * 14;
            const alpha = (1 - phase) * 0.34 * strength;
            if (alpha <= 0.01) continue;
            canvas.globalAlpha = baseAlpha * alpha;
            canvas.fillStyle = puff.smoke ? WICK_TRAIL_SMOKE : WICK_TRAIL_EMBER;
            canvas.beginPath();
            canvas.arc(
              mouthWorldX + backX * distance + sideX * puff.drift * phase,
              mouthWorldY + backY * distance + sideY * puff.drift * phase,
              puff.size * (0.7 + phase * 0.8),
              0,
              TAU
            );
            canvas.fill();
          }
          // 最末尾留一颗小余烬，保证尾迹在瓶身后面仍能看出来。
          canvas.globalAlpha = baseAlpha * 0.7 * strength;
          canvas.fillStyle = WICK_TRAIL_EMBER;
          canvas.beginPath();
          canvas.arc(
            mouthWorldX + backX * 25 + sideX * 1.2,
            mouthWorldY + backY * 25 + sideY * 1.2,
            1.3,
            0,
            TAU
          );
          canvas.fill();
          canvas.restore();
        }

        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.rotate(effect.angle);
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = baseAlpha;
        if (typeof canvas.createRadialGradient === "function") {
          const glowRadius = 7.5 * flicker;
          const gradient = canvas.createRadialGradient(0, mouthY - 2, 0.4, 0, mouthY - 2, glowRadius);
          gradient.addColorStop(0, "rgba(255,176,92,0.34)");
          gradient.addColorStop(1, "rgba(255,120,40,0)");
          canvas.fillStyle = gradient;
          canvas.beginPath();
          canvas.arc(0, mouthY - 2, glowRadius, 0, TAU);
          canvas.fill();
        }
        canvas.globalAlpha = baseAlpha * 0.5;
        paintLick(canvas, 0, mouthY, 8.6 * flicker, 1.9, time, effect.flickerSeed, FLAME_DEEP);
        canvas.globalAlpha = baseAlpha * 0.6;
        paintLick(canvas, 0.35, mouthY, 6.4 * flicker, 1.2, time * 1.4, effect.flickerSeed + 2.2, FLAME_BODY);
        canvas.globalAlpha = baseAlpha * 0.7;
        paintLick(canvas, -0.3, mouthY, 4.2 * flicker, 0.75, time * 1.9, effect.flickerSeed + 4.4, FLAME_CORE);
        for (let index = 0; index < 2; index += 1) {
          const cycle = 0.42 + index * 0.16;
          const phase = ((time + index * 0.21 + effect.sparkSeed) % cycle) / cycle;
          const alpha = baseAlpha * (1 - phase) * 0.75;
          if (alpha <= 0.02) continue;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = index === 0 ? FLAME_HOT : FLAME_CORE;
          canvas.beginPath();
          canvas.arc(
            Math.sin(time * 4.6 + effect.sparkSeed + index * 2.4) * (0.6 + phase * 1.5),
            mouthY - 1.4 - phase * 7.2,
            0.6 - 0.25 * phase,
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  function createCocktailBurnVisual(options = {}) {
    const random = requireRandom(options.random);
    const anchor = options.anchor || null;
    const life = Math.max(0.05, finiteOr(options.life, 1));
    const appearance = createVisualPropertyAnimation({
      intensity: { type: "number", default: 1, min: 0, max: 1 },
      ember: { type: "color", default: "#ff9a42" }
    }, {
      label: "cocktail-burn",
      properties: {
        intensity: { overLife: [
          { at: 0, value: 0 },
          { at: 0.12, value: 1 },
          { at: 0.6, value: 0.82 },
          { at: 1, value: 0 }
        ] },
        ember: { overLife: [
          { at: 0, value: "#ffd08a" },
          { at: 0.5, value: "#ff8a33" },
          { at: 1, value: "#8c3410" }
        ] }
      }
    });
    const specks = Array.from({ length: 9 }, () => ({
      spread: (random() - 0.5) * 1.9,
      cycle: 0.16 + 0.22 * random(),
      offset: random(),
      drift: 1.4 + 3.4 * random(),
      size: 0.5 + 0.9 * random(),
      lift: 0.4 + 1.6 * random(),
      color: random() < 0.4 ? FLAME_CORE : pickColor(random, EMBER_COLORS)
    }));
    return {
      kind: "cocktail-burn",
      life,
      anchor,
      x: finiteOr(anchor && anchor.x, 0),
      y: finiteOr(anchor && anchor.y, 0),
      radius: Math.max(2, finiteOr(anchor && anchor.radius, 8)),
      trailAngle: Math.PI,
      specks,
      update({ effect }) {
        const target = effect.anchor;
        if (!target || target.entityActive === false) {
          effect.visualActive = false;
          return;
        }
        if (Number.isFinite(target.hp) && target.hp <= 0) {
          effect.visualActive = false;
          return;
        }
        effect.x = finiteOr(target.x, effect.x);
        effect.y = finiteOr(target.y, effect.y);
        effect.radius = Math.max(2, finiteOr(target.radius, effect.radius));
        const velocityX = finiteOr(target.vx, 0);
        const velocityY = finiteOr(target.vy, 0);
        if (Math.hypot(velocityX, velocityY) > 2) {
          effect.trailAngle = Math.atan2(-velocityY, -velocityX);
        }
      },
      draw({ effect }, canvas) {
        const look = appearance.sample(clamp(effect.age / effect.life, 0, 1));
        const intensity = look.intensity;
        if (intensity <= 0.01) return;
        const baseAlpha = finiteOr(canvas.globalAlpha, 1);
        const time = effect.age;
        const radius = effect.radius;
        canvas.save();
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = baseAlpha;
        if (typeof canvas.createRadialGradient === "function") {
          const heatX = effect.x + Math.cos(effect.trailAngle) * radius * 0.6;
          const heatY = effect.y + Math.sin(effect.trailAngle) * radius * 0.6;
          const gradient = canvas.createRadialGradient(heatX, heatY, 0.5, heatX, heatY, radius * 1.1);
          gradient.addColorStop(0, withAlpha(look.ember, 0.16 * intensity));
          gradient.addColorStop(1, withAlpha(look.ember, 0));
          canvas.fillStyle = gradient;
          canvas.beginPath();
          canvas.arc(heatX, heatY, radius * 1.1, 0, TAU);
          canvas.fill();
        }
        for (const speck of effect.specks) {
          const phase = ((time + speck.offset * speck.cycle) % speck.cycle) / speck.cycle;
          const alpha = baseAlpha * Math.min(1, phase * 5) * (1 - phase) * 0.7 * intensity;
          if (alpha <= 0.01) continue;
          const angle = effect.trailAngle + speck.spread;
          const distance = radius * 0.9 + speck.drift * phase;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = speck.color;
          canvas.beginPath();
          canvas.arc(
            effect.x + Math.cos(angle) * distance,
            effect.y + Math.sin(angle) * distance - speck.lift * phase,
            speck.size * (1 - 0.35 * phase),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  function createCocktailShatterVisual(options = {}) {
    const random = requireRandom(options.random);
    const x = finiteOr(options.x, 0);
    const y = finiteOr(options.y, 0);
    const life = Math.max(0.1, finiteOr(options.life, 0.62));
    const appearance = createVisualPropertyAnimation({
      flash: { type: "number", default: 1, min: 0, max: 1 },
      spark: { type: "color", default: "#ffb04a" }
    }, {
      label: "cocktail-shatter",
      properties: {
        flash: { overLife: [{ at: 0, value: 1 }, { at: 0.22, value: 0.45 }, { at: 1, value: 0 }] },
        spark: { overLife: [
          { at: 0, value: "#fff2c4" },
          { at: 0.4, value: "#ff9a3d" },
          { at: 1, value: "#8c3410" }
        ] }
      }
    });
    const sparks = Array.from({ length: 20 }, () => {
      const angle = random() * TAU;
      const speed = 45 + 235 * random() * random();
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        size: 0.6 + 1.1 * random(),
        drag: 2.2 + 2.4 * random(),
        color: pickColor(random, SPARK_COLORS)
      };
    });
    const chips = Array.from({ length: 9 }, () => {
      const angle = random() * TAU;
      const speed = 30 + 150 * random();
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        size: 0.9 + 1.4 * random(),
        rotation: random() * TAU,
        spin: (random() - 0.5) * 12,
        delay: random() * 0.08
      };
    });
    const puffs = Array.from({ length: 3 }, () => ({
      driftX: (random() - 0.5) * 16,
      rise: 14 + 20 * random(),
      size: 7 + 8 * random(),
      offset: random() * 0.2
    }));
    const liquid = Array.from({ length: 6 }, () => {
      const angle = random() * TAU;
      const speed = 30 + 120 * random();
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        angle,
        size: 0.8 + 1.2 * random(),
        drag: 3 + 2 * random(),
        color: pickColor(random, LIQUID_SPLASH)
      };
    });

    return {
      kind: "cocktail-shatter",
      life,
      x,
      y,
      sparks,
      chips,
      puffs,
      liquid,
      draw({ effect }, canvas) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const look = appearance.sample(progress);
        const baseAlpha = finiteOr(canvas.globalAlpha, 1);
        const time = effect.age;

        canvas.save();
        canvas.globalAlpha = baseAlpha;
        for (const puff of puffs) {
          const phase = clamp((time - puff.offset) / (effect.life * 0.7), 0, 1);
          if (phase <= 0 || phase >= 1) continue;
          const alpha = Math.sin(Math.PI * phase) * 0.09;
          const puffX = effect.x + puff.driftX * phase;
          const puffY = effect.y - puff.rise * phase;
          const size = puff.size * (0.5 + phase);
          if (typeof canvas.createRadialGradient === "function") {
            const gradient = canvas.createRadialGradient(puffX, puffY, size * 0.15, puffX, puffY, size);
            gradient.addColorStop(0, "rgba(158,148,132," + alpha.toFixed(3) + ")");
            gradient.addColorStop(1, "rgba(158,148,132,0)");
            canvas.fillStyle = gradient;
          } else {
            canvas.fillStyle = "rgba(158,148,132," + (alpha * 0.4).toFixed(3) + ")";
          }
          canvas.beginPath();
          canvas.arc(puffX, puffY, size, 0, TAU);
          canvas.fill();
        }
        canvas.restore();

        canvas.save();
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = baseAlpha;
        if (look.flash > 0.01 && typeof canvas.createRadialGradient === "function") {
          const flashRadius = 16 + 20 * progress;
          const gradient = canvas.createRadialGradient(effect.x, effect.y, 1, effect.x, effect.y, flashRadius);
          gradient.addColorStop(0, withAlpha(look.spark, 0.5 * look.flash));
          gradient.addColorStop(1, withAlpha(look.spark, 0));
          canvas.fillStyle = gradient;
          canvas.beginPath();
          canvas.arc(effect.x, effect.y, flashRadius, 0, TAU);
          canvas.fill();
        }
        for (const spark of effect.sparks) {
          const travel = (1 - Math.exp(-spark.drag * time)) / spark.drag;
          const alpha = baseAlpha * Math.pow(1 - progress, 1.6) * 0.9;
          if (alpha <= 0.02) continue;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = spark.color;
          canvas.beginPath();
          canvas.arc(
            effect.x + spark.vx * travel,
            effect.y + spark.vy * travel + 40 * travel * time,
            spark.size * (1 - 0.45 * progress),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();

        canvas.save();
        canvas.globalAlpha = baseAlpha * 0.75 * (1 - progress);
        for (const chip of effect.chips) {
          const effort = Math.max(0, time - chip.delay);
          if (effort <= 0) continue;
          const travel = effort * 0.6;
          canvas.save();
          canvas.translate(effect.x + chip.vx * travel, effect.y + chip.vy * travel + 26 * travel * effort);
          canvas.rotate(chip.rotation + chip.spin * effort);
          canvas.fillStyle = GLASS_SHARD;
          canvas.beginPath();
          canvas.moveTo(-chip.size * 1.1, -chip.size * 0.2);
          canvas.lineTo(-chip.size * 0.3, -chip.size * 0.8);
          canvas.lineTo(chip.size * 0.9, -chip.size * 0.25);
          canvas.lineTo(chip.size * 0.3, chip.size * 0.15);
          canvas.lineTo(chip.size * 0.5, chip.size * 0.7);
          canvas.lineTo(-chip.size * 0.5, chip.size * 0.5);
          canvas.closePath();
          canvas.fill();
          canvas.strokeStyle = GLASS_SHARD_EDGE;
          canvas.lineWidth = 0.4;
          canvas.stroke();
          canvas.restore();
        }
        canvas.restore();

        canvas.save();
        for (const drop of effect.liquid) {
          const travel = (1 - Math.exp(-drop.drag * time)) / drop.drag;
          const alpha = baseAlpha * (1 - progress) * 0.8;
          if (alpha <= 0.02) continue;
          canvas.globalAlpha = alpha;
          canvas.fillStyle = drop.color;
          canvas.beginPath();
          canvas.ellipse(
            effect.x + drop.vx * travel,
            effect.y + drop.vy * travel + 30 * travel * time,
            drop.size * 1.4,
            drop.size * 0.65,
            drop.angle,
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  return {
    COCKTAIL_VISUAL_COLORS: Object.freeze({
      glassShard: GLASS_SHARD,
      glassShardEdge: GLASS_SHARD_EDGE,
      glassShardHot: GLASS_SHARD_HOT,
      puddleChar: PUDDLE_CHAR,
      puddleBody: PUDDLE_BODY,
      wickTrailEmber: WICK_TRAIL_EMBER,
      flameDeep: FLAME_DEEP,
      flameBody: FLAME_BODY,
      flameHot: FLAME_HOT
    }),
    drawCocktailBottle,
    drawCocktailShard,
    createCocktailFireVisual,
    createCocktailWickVisual,
    createCocktailBurnVisual,
    createCocktailShatterVisual
  };
});
