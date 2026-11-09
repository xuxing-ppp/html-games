(function initializeLavaPack(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js"),
        ...require("../core/contact-model.js"),
        ...require("./meteor-burn.js")
      } : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLavaPack({ resolveArenaGeometry, registerBall, firstSegmentCircleContact, createBurnEffect }) {
  const TAU = Math.PI * 2;
  const EPS = 1e-8;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function createLavaBurn() {
    return {
      id: "lava-burn", combatKind: "dot", duration: 0.601,
      attackTags: ["heat"],
      onApply({ effect, game, isRefresh }) {
        effect.remainingTicks = 3;
        if (!isRefresh) effect.nextTick = game.time + 0.2;
      },
      update({ ball, effect, game, services: bound }) {
        while (effect.remainingTicks > 0 && game.time + EPS >= effect.nextTick) {
          bound.dealDamage(ball, 1); effect.remainingTicks -= 1; effect.nextTick += 0.2;
        }
      },
      // 渲染器只调用效果上的 `draw` / `drawBefore`；写成 drawAfter 的话这段视觉永远不会被画出来。
      // 只留一圈随呼吸闪烁的灼烧光环，不画火苗。
      draw({ ball, game }, ctx) {
        const flicker = 0.75 + Math.sin(game.time * 22) * 0.25;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // 灼烧光环
        ctx.strokeStyle = "rgba(255,150,40," + (0.32 * flicker) + ")";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius + 2.5, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    };
  }

  function burn(services, target) {
    services.applyEffect(target, createLavaBurn());
    services.applyEffect(target, { id: "lava-heat-speed", duration: 0.06, speedFactor: 1.1 });
  }

  // 直接借用行星波动的灼烧：同一套 DoT（0.9 秒内 3×3）+ 减速 + 火焰环视觉。
  function applyHotBurn(services, source, target) {
    services.applyEffect(target, createBurnEffect(services, source, "lava-hot-burn", 1));
  }

  // 熔岩：亮核 → 橙 → 深红的径向渐变 + 流动的暗壳纹 + 上浮热泡 + additive 外发光；
  // 凝固后是深色玄武岩 + 慢慢暗下去的余烬纹。（不再画深色碎块，避免像曲奇。）
  function drawLava(ctx, x, y, radius, time, rock = false, glow = 1) {
    ctx.save(); ctx.translate(x, y);
    if (!rock && glow > 0) {
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(0, 0, radius * 0.55, 0, 0, radius * 1.5);
      halo.addColorStop(0, `rgba(255,140,36,${0.30 * glow})`);
      halo.addColorStop(0.6, `rgba(255,84,14,${0.14 * glow})`);
      halo.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, radius * 1.5, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    const body = ctx.createRadialGradient(-radius * 0.22, -radius * 0.28, radius * 0.06, 0, 0, radius);
    if (rock) {
      body.addColorStop(0, "#6b6c74");
      body.addColorStop(0.55, "#3e4047");
      body.addColorStop(1, "#22242b");
    } else {
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.1);
      body.addColorStop(0, "#fff3ac");
      body.addColorStop(0.3 + pulse * 0.08, "#ffb42a");
      body.addColorStop(0.72, "#f2540c");
      body.addColorStop(1, "#8d1206");
    }
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.clip();
    // 壳纹：熔岩是流动的暗红脉络，凝固后是余烬
    const veins = rock ? 3 : 5;
    for (let i = 0; i < veins; i++) {
      const drift = time * (rock ? 0.14 : 0.55) + i * 1.7;
      const start = i * TAU / veins + drift * 0.22;
      ctx.strokeStyle = rock
        ? `rgba(255,124,40,${0.14 + 0.06 * Math.sin(time * 1.5 + i)})`
        : `rgba(96,20,8,${0.48 + 0.18 * Math.sin(time * 2.2 + i)})`;
      ctx.lineWidth = rock ? 1.1 : 1.5 + 0.5 * Math.sin(time * 2 + i * 2);
      ctx.beginPath();
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        const angle = start + t * 1.9;
        const r = radius * (0.12 + t * 0.95) + Math.sin(t * 6 + drift) * radius * 0.07;
        const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
        if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // 熔岩表面往上浮的热泡
    if (!rock) {
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) {
        const t = (time * 0.55 + i / 4) % 1;
        const angle = i * 2.2 + Math.sin(time * 1.3 + i) * 0.4;
        const r = radius * (0.22 + t * 0.62);
        ctx.globalAlpha = 0.45 * (1 - t);
        ctx.fillStyle = i % 2 ? "#ffd76a" : "#ff9a2e";
        ctx.beginPath();
        ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, Math.max(0.8, radius * 0.12 * (1 - t * 0.5)), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.restore();
    ctx.strokeStyle = rock ? "rgba(152,154,162,0.45)" : "rgba(255,198,96,0.72)";
    ctx.lineWidth = rock ? 1 : 1.4;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(0, radius - 0.4), 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // 岩浆池上方的烟雾：纯绘制的循环烟团，越升越淡越大。凝固成岩石后调用方不再画它。
  function drawLavaSmoke(ctx, x, y, radius, time) {
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const t = (time * 0.32 + i / 6) % 1;
      const rise = radius * (0.45 + t * 2.6);
      const drift = Math.sin(time * 0.9 + i * 1.7) * radius * 0.5;
      const puff = radius * (0.22 + t * 0.5);
      // 刚离池面时带一点热气暖色，升高后转为灰烟
      const warm = Math.max(0, 1 - t * 3);
      ctx.globalAlpha = 0.32 * (1 - t) * Math.min(1, t * 6);
      ctx.fillStyle = warm > 0.5 ? "#a8917c" : (i % 2 ? "#8d8f96" : "#6f7178");
      ctx.beginPath();
      ctx.arc(x + drift, y - rise, puff, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // 确定性哈希：所有"不规则"形状都按位置取值，帧间稳定、不抖。
  function hash2(x, y, k) {
    const n = Math.sin(x * 127.1 + y * 311.7 + k * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  // 冷却壳块布局（半径比例坐标，预计算一次）：中心 1 块 + 内圈 5 块 + 外圈 7 块。
  // 板与板之间刻意留一线空隙，底下那层亮熔岩就是"发光缝"。
  const CRUST_PLATES = (() => {
    const hash = (k) => { const n = Math.sin(k * 12.9898 + 4.1) * 43758.5453; return n - Math.floor(n); };
    const plates = [];
    let seed = 1;
    const rings = [
      { count: 1, distance: 0, size: 0.37 },
      { count: 5, distance: 0.56, size: 0.35 },
      { count: 7, distance: 0.96, size: 0.42 }
    ];
    for (const ring of rings) {
      for (let i = 0; i < ring.count; i += 1) {
        const base = ring.count === 1 ? 0.4 : i * TAU / ring.count + hash(seed) * 0.35;
        const vertices = [];
        for (let v = 0; v < 6; v += 1) {
          vertices.push({
            angle: v * TAU / 6 + (hash(seed + v * 3) - 0.5) * 0.24,
            radius: ring.size * (0.9 + hash(seed + v * 7) * 0.22)
          });
        }
        plates.push({
          x: Math.cos(base) * ring.distance,
          y: Math.sin(base) * ring.distance,
          vertices,
          tint: hash(seed + 2)
        });
        seed += 11;
      }
    }
    return Object.freeze(plates.map((plate) => Object.freeze({
      tint: plate.tint, x: plate.x, y: plate.y, vertices: Object.freeze(plate.vertices)
    })));
  })();

  // 壳块上的短裂缝（板内裂开、透出熔岩）
  const PLATE_CRACKS = Object.freeze([
    Object.freeze([{ x: -0.22, y: -0.1 }, { x: -0.05, y: 0.04 }, { x: -0.16, y: 0.2 }]),
    Object.freeze([{ x: 0.34, y: -0.5 }, { x: 0.5, y: -0.36 }, { x: 0.4, y: -0.2 }]),
    Object.freeze([{ x: -0.62, y: 0.3 }, { x: -0.44, y: 0.42 }, { x: -0.58, y: 0.56 }])
  ]);

  // 岩浆球本体：深色冷却壳 + 缝隙里透出的亮黄熔岩（参考图的样子）。
  function drawCrustBall(ctx, x, y, radius, time) {
    ctx.save();
    ctx.translate(x, y);
    // 外发光
    ctx.globalCompositeOperation = "lighter";
    const halo = ctx.createRadialGradient(0, 0, radius * 0.7, 0, 0, radius * 1.3);
    halo.addColorStop(0, "rgba(255,148,38,0.20)");
    halo.addColorStop(1, "rgba(255,70,0,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, radius * 1.42, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // 底下的熔岩：壳块之间漏出来的就是它
    const molten = ctx.createRadialGradient(0, -radius * 0.15, radius * 0.05, 0, 0, radius);
    molten.addColorStop(0, "#fff5c4");
    molten.addColorStop(0.5, "#ffc733");
    molten.addColorStop(1, "#ff7f0c");
    ctx.fillStyle = molten;
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.clip();
    ctx.rotate(time * 0.12);
    // 冷却壳块：板与板之间留一线缝，缝里透出上面的亮熔岩
    for (const plate of CRUST_PLATES) {
      ctx.save();
      ctx.translate(plate.x * radius, plate.y * radius);
      ctx.scale(radius * 0.94, radius * 0.94);
      ctx.beginPath();
      plate.vertices.forEach((vertex, index) => {
        const px = Math.cos(vertex.angle) * vertex.radius;
        const py = Math.sin(vertex.angle) * vertex.radius;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = plate.tint > 0.5 ? "#3d2716" : "#2a1a10";
      ctx.fill();
      ctx.restore();
      // 板沿的斜光：让冷却壳有厚度
      ctx.save();
      ctx.translate(plate.x * radius, plate.y * radius);
      ctx.scale(radius * 0.94, radius * 0.94);
      ctx.beginPath();
      plate.vertices.forEach((vertex, index) => {
        const px = Math.cos(vertex.angle) * vertex.radius;
        const py = Math.sin(vertex.angle) * vertex.radius;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.strokeStyle = "rgba(126,88,50,0.5)";
      ctx.lineWidth = 0.055;
      ctx.stroke();
      ctx.restore();
    }
    // 板内短裂缝：亮黄透光
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const crack of PLATE_CRACKS) {
      ctx.strokeStyle = "rgba(255,188,60,0.85)";
      ctx.lineWidth = radius * 0.055;
      ctx.beginPath();
      crack.forEach((point, index) => {
        const px = point.x * radius, py = point.y * radius;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,246,205,0.8)";
      ctx.lineWidth = radius * 0.022;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
    // 边缘暖光
    ctx.strokeStyle = "rgba(255,182,74,0.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, Math.max(0, radius - 0.6), 0, TAU); ctx.stroke();
    ctx.restore();
  }

  // 岩浆球本体（对外沿用旧名字）：壳 + 缝里透光的熔岩。
  function drawMoltenBall(ctx, ball, time) {
    drawCrustBall(ctx, ball.x, ball.y, ball.radius, time);
  }

  // 岩浆滩：轨迹就是一路掉下来的一个个独立小池子，各自有不规则外形、各自的寿命。
  // 直径 8~15 的小岩浆滩：靠更密的落点补回面积；寿命 3 秒，最后 0.5 秒才渐隐。
  const PUDDLE_MIN_RADIUS = 4;
  const PUDDLE_MAX_RADIUS = 7.5;
  const PUDDLE_LIFE = 3;
  const PUDDLE_FADE = 0.5;

  function tracePuddleShape(ctx, radius, seedX, seedY, vertices = 10) {
    ctx.beginPath();
    for (let i = 0; i < vertices; i += 1) {
      const angle = i * TAU / vertices + (hash2(seedX, seedY, i + 91) - 0.5) * 0.22;
      const r = radius * (0.68 + hash2(seedX, seedY, i) * 0.46);
      const px = Math.cos(angle) * r, py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // 一滩小岩浆：不规则外形 + 熔岩渐变 + 火舌 + 火花。
  // 前 2.5 秒完全实心（判定范围看得见），只有最后 0.5 秒渐隐并略微缩小。
  function drawLavaPuddle(ctx, x, y, radius, seedX, seedY, age, life, time) {
    const t = clamp(age / life, 0, 1);
    const fadeStart = Math.max(0, (life - PUDDLE_FADE) / life);
    const fade = t <= fadeStart ? 1 : clamp((1 - t) / (1 - fadeStart), 0, 1);
    if (fade <= 0.02) return;
    const scale = 1 - 0.3 * (1 - fade);
    ctx.save();
    ctx.globalAlpha *= fade;
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(hash2(seedX, seedY, 61) * TAU);
    const vertices = 8 + Math.floor(hash2(seedX, seedY, 67) * 5);
    ctx.save();
    tracePuddleShape(ctx, radius, seedX, seedY, vertices);
    ctx.clip();
    const molten = ctx.createRadialGradient(-radius * 0.25, -radius * 0.3, radius * 0.08, 0, 0, radius * 1.1);
    molten.addColorStop(0, "#fff1ac");
    molten.addColorStop(0.45, "#ffab22");
    molten.addColorStop(1, "#c22f07");
    ctx.fillStyle = molten;
    ctx.fillRect(-radius * 1.4, -radius * 1.4, radius * 2.8, radius * 2.8);
    ctx.restore();
    tracePuddleShape(ctx, radius, seedX, seedY, vertices);
    ctx.strokeStyle = "rgba(56,22,10,0.65)";
    ctx.lineWidth = 1.6;
    ctx.stroke();
    // 火舌：从池面往上舔，随年龄变短
    ctx.globalCompositeOperation = "lighter";
    const tongues = 2 + Math.floor(hash2(seedX, seedY, 71) * 2);
    for (let i = 0; i < tongues; i += 1) {
      const angle = hash2(seedX, seedY, i + 31) * TAU;
      const offset = radius * (0.15 + hash2(seedX, seedY, i + 41) * 0.6);
      const px = Math.cos(angle) * offset, py = Math.sin(angle) * offset;
      const height = radius * (0.55 + hash2(seedX, seedY, i + 51) * 0.8) * (1 - t * 0.6);
      ctx.strokeStyle = i % 2 ? "rgba(255,196,70,0.5)" : "rgba(255,140,30,0.45)";
      ctx.lineWidth = Math.max(1.2, radius * 0.22);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + radius * 0.18, py - height * 0.6, px - radius * 0.1, py - height);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
    drawSparks(ctx, x, y - radius * 0.3, radius * 0.55, seedX + seedY, time, fade, 2);
  }

  // 一滩独立岩浆池实体：自己判定接触、自己到期消失。
  function createLavaPuddle(x, y) {
    return {
      kind: "lava-puddle", combatKind: "trap", life: PUDDLE_LIFE, drawLayer: "background",
      x, y,
      // 每滩直径 8~15 不等：判定半径与外观一致
      radius: PUDDLE_MIN_RADIUS + hash2(x, y, 3) * (PUDDLE_MAX_RADIUS - PUDDLE_MIN_RADIUS),
      offsetX: (hash2(x, y, 7) - 0.5) * PUDDLE_MAX_RADIUS * 0.9,
      offsetY: (hash2(x, y, 11) - 0.5) * PUDDLE_MAX_RADIUS * 0.9,
      update({ entity: e, services }) {
        if (e.entityActive === false) return;
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable) return;
          if (Math.hypot(target.x - e.x, target.y - e.y) > target.radius + e.radius) return;
          hotContact(services, target, 0.8, 2, "trail");
        });
      },
      draw({ entity: e, game }, ctx) {
        drawLavaPuddle(ctx, e.x + e.offsetX, e.y + e.offsetY, e.radius, e.x, e.y, e.age, e.life, game.time);
      }
    };
  }


  // 火花与岩浆滴：亮点往上飘，液滴抛起来再落回，都由时间确定性驱动。
  function drawSparks(ctx, x, y, radius, seed, time, fade, count = 5) {
    if (fade <= 0) return;
    ctx.save();
    const baseAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i += 1) {
      const cycle = 1 + hash2(seed, i, 31) * 0.9;
      const t = ((time + hash2(seed, i, 37) * cycle) % cycle) / cycle;
      const angle = hash2(seed, i, 41) * TAU;
      const spread = radius * (0.2 + hash2(seed, i, 43) * 0.9);
      const px = x + Math.cos(angle) * spread;
      const droplet = hash2(seed, i, 47) > 0.55;
      const lift = droplet
        ? radius * 2.2 * 4 * t * (1 - t)
        : radius * 1.9 * t;
      const py = y - lift;
      ctx.globalAlpha = baseAlpha * fade * (1 - t) * 0.9;
      if (droplet) {
        ctx.fillStyle = "#ffb43a";
        ctx.beginPath(); ctx.ellipse(px, py, 1.6, 2.4, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = "#fff0b0";
        ctx.beginPath(); ctx.arc(px, py, 0.8, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = i % 2 ? "#ffd76a" : "#ffe9a8";
        ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
      }
    }
    ctx.restore();
  }

  // 抛投中的高热岩浆：拉长的熔岩团 + 余烬拖尾 + 空中光晕。
  function drawLavaLob(ctx, x, y, altitude, directionX, directionY, time) {
    const bodyY = y - altitude;
    const speed = Math.hypot(directionX, directionY) || 1;
    const ux = directionX / speed, uy = directionY / speed;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      ctx.globalAlpha = 0.28 * (1 - t);
      ctx.fillStyle = i < 3 ? "#ff8a2a" : "#ffc667";
      ctx.beginPath();
      ctx.arc(x - ux * t * 22, bodyY - uy * t * 22, 7 * (1 - t * 0.5), 0, TAU);
      ctx.fill();
    }
    const halo = ctx.createRadialGradient(x, bodyY, 2, x, bodyY, 16);
    halo.addColorStop(0, "rgba(255,198,102,0.5)");
    halo.addColorStop(0.55, "rgba(255,110,26,0.26)");
    halo.addColorStop(1, "rgba(255,70,0,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(x, bodyY, 16, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.translate(x, bodyY);
    ctx.rotate(Math.atan2(uy, ux));
    ctx.scale(1.22, 0.86);
    ctx.translate(-x, -bodyY);
    drawLava(ctx, x, bodyY, 7, time, false, 0.7);
    ctx.restore();
    drawSparks(ctx, x, bodyY, 8, x + y, time, 1, 3);
  }

  function hotContact(services, target, interval, damage, label) {
    burn(services, target);
    const id = `lava-contact-${label}`;
    const existing = target.effects.get(id);
    if (!existing || existing.expiresAt <= services.getTime()) {
      services.dealDamage(target, damage, { attackTags: ["heat", "area"] });
      services.applyEffect(target, { id, duration: interval });
    }
  }

  function createLavaPool(x, y) {
    const contacts = new Set();
    return {
      kind: "lava-pool", combatKind: "trap", life: Number.MAX_SAFE_INTEGER,
      x, y, radius: 17.5, drawLayer: "background", rock: false,
      update({ entity: e, game, services }) {
        e.rock = e.age + EPS >= 3.3;
        const present = new Set();
        services.forEachContactEnemy(target => {
          if(e.entityActive===false)return;
          const profile = services.getContactProfile(target);
          const dx = target.x - e.x, dy = target.y - e.y;
          const distance = Math.hypot(dx, dy), reach = target.radius + e.radius;
          const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
          const previousY = Number.isFinite(target.prevY) ? target.prevY : target.y;
          const swept = firstSegmentCircleContact(previousX, previousY,
            target.x, target.y, e.x, e.y, reach);
          const overlapping = distance <= reach + 0.1 || swept !== null;
          services.notifyEntityContact(target, e, { overlapping: e.rock && overlapping });
          if (!overlapping || (!e.rock && !profile.attackable)) return;
          if (e.rock && !profile.solid) return;
          if (services.tryConsumeEntity(target, e, { physical: true })) return;
          if (!e.rock) { hotContact(services, target, 0.3, 1, "pool"); return; }
          present.add(target.instanceId);
          if (!contacts.has(target.instanceId)) services.dealDamage(target, 2, { attackTags: ["physical", "impact"] });
          if (!services.isMovementLocked(target)) {
            const contactX=swept!==null?previousX+(target.x-previousX)*swept:target.x;
            const contactY=swept!==null?previousY+(target.y-previousY)*swept:target.y;
            const hitDistance=Math.hypot(contactX-e.x,contactY-e.y);
            const nx=hitDistance>EPS?(contactX-e.x)/hitDistance:1,ny=hitDistance>EPS?(contactY-e.y)/hitDistance:0;
            Object.assign(target, resolveArenaGeometry(game).clampPoint(e.x + nx * (reach + 0.05),
              e.y + ny * (reach + 0.05), target.radius));
            const dot = target.vx * nx + target.vy * ny;
            if (dot < 0) {
              target.vx = target.storedVx = target.vx - 2 * dot * nx;
              target.vy = target.storedVy = target.vy - 2 * dot * ny;
            }
          }
        });
        contacts.clear(); for (const id of present) contacts.add(id);
      },
      draw({ entity: e, game }, ctx) {
        drawLava(ctx, e.x, e.y, e.radius, game.time, e.rock);
        // 还在熔融状态才有烟和火花；3.3 秒凝固成岩石后两者一起消失。
        if (!e.rock) {
          drawSparks(ctx, e.x, e.y - e.radius * 0.2, e.radius * 0.85, e.x + e.y, game.time, 1, 7);
          drawLavaSmoke(ctx, e.x, e.y, e.radius, game.time);
        }
      }
    };
  }

  function drawTomato(ctx, x, y, radius) {
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = "#e8382e";
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#8e2022"; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.fillStyle = "#468c3c"; ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = radius * (i % 2 ? 0.18 : 0.65), a = i * Math.PI / 5;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r - radius * 0.4);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  function createLob(ball, x, y, tomato = false) {
    const duration = tomato ? 0.6 : 1;
    return {
      kind: tomato ? "tomato-lob" : "magma-lob", combatKind: "projectile", life: duration + 0.05,
      x: ball.x, y: ball.y, startX: ball.x, startY: ball.y, targetX: x, targetY: y,
      flightDuration: duration, arcHeight: tomato ? 50 : 150, landed: false,
      update({ entity: e, services }) {
        const p = clamp(e.age / duration, 0, 1);
        e.x = e.startX + (e.targetX - e.startX) * p;
        e.y = e.startY + (e.targetY - e.startY) * p;
        if (p < 1 || e.landed) return;
        e.landed = true;
        if (tomato) {
          services.forEachEnemy(target => {
            if (Math.hypot(target.x - e.x, target.y - e.y) <= 30 + target.radius) services.dealDamage(target, 2);
          });
          // 直径60的溅射只用粒子表达：果肉铺满整片圆，汁水朝边缘飞溅，不再画红色范围圆。
          services.spawnParticleBurst({ kind: "tomato-splash", x: e.x, y: e.y,
            count: 64, colors: ["#ed3325", "#a71c26", "#7d1420"], shape: "ellipse",
            minLength: 2, maxLength: 8, minWidth: 1.4, maxWidth: 3.4, rotationSpeed: 9,
            initialRadius: 30, minSpeed: 6, maxSpeed: 30, life: 0.55, drag: 5 });
          services.spawnParticleBurst({ kind: "tomato-juice", x: e.x, y: e.y,
            count: 30, colors: ["#ff5a3c", "#ff9a3c", "#ffd078"],
            minDiameter: 1, maxDiameter: 3, initialRadius: 6,
            minSpeed: 90, maxSpeed: 190, life: 0.32, drag: 6.5 });
        } else services.spawnCombatEntity(createLavaPool(e.x, e.y));
        e.entityActive = false;
      },
      draw({ entity: e, game }, ctx) {
        const p = clamp(e.age / duration, 0, 1), altitude = 4 * e.arcHeight * p * (1 - p);
        ctx.save(); ctx.globalAlpha *= 0.3; ctx.fillStyle = "#ff6620";
        ctx.beginPath(); ctx.ellipse(e.x, e.y, 7, 2.5, 0, 0, TAU); ctx.fill(); ctx.restore();
        if (tomato) drawTomato(ctx, e.x, e.y - altitude, 6);
        else drawLavaLob(ctx, e.x, e.y, altitude, e.targetX - e.startX, e.targetY - e.startY, game.time);
      }
    };
  }

  function createProjection(x,y) {
    const nextHits = new Map();
    return {
      kind: "projection-zone", combatKind: "zone", x,y, radius: 15, life: 4.6, drawLayer: "background",
      update({ entity:e, game, services }) {
        const present = new Set();
        services.forEachEnemy(target => {
          if (!services.getContactProfile(target).attackable || Math.hypot(target.x-x,target.y-y) > target.radius+e.radius) return;
          present.add(target.instanceId);
          const cachedNext = nextHits.get(target.instanceId);
          let next = cachedNext === undefined ? game.time : cachedNext;
          while (game.time + EPS >= next) { services.dealDamage(target,1); next += 0.06; }
          nextHits.set(target.instanceId,next);
        });
        for (const [id,next] of nextHits) if (!present.has(id) && next <= game.time) nextHits.delete(id);
      },
      draw({ entity:e, game },ctx) {
        // 渐隐：出现时 0.18 秒淡入，消失前 0.5 秒淡出
        const appear = Math.min(1, e.age / 0.18);
        const fadeOut = Math.min(1, Math.max(0, (e.life - e.age) / 0.5));
        ctx.save();
        ctx.globalAlpha *= Math.min(appear, fadeOut);
        ctx.translate(x,y); ctx.beginPath();ctx.arc(0,0,15,0,TAU);ctx.clip();
        const colors = ["#dddcd5","#eddb35","#35ceca","#40b54e","#bb379e","#d53c35","#3848aa"];
        colors.forEach((c,i)=>{ctx.fillStyle=c;ctx.fillRect(-15+i*30/7,-15,30/7+0.2,24);});
        ctx.fillStyle="#202127";ctx.fillRect(-15,9,30,6);
        const frame=Math.floor(game.time*24);
        for(let i=0;i<45;i++) {
          const n=(i*7919+frame*104729)%997;
          ctx.fillStyle=i%2?"rgba(0,0,0,0.45)":"rgba(255,255,255,0.6)";
          ctx.fillRect((n%30)-15,((n*17)%30)-15,1+(n%4),0.6);
        }
        ctx.fillStyle="rgba(15,8,20,0.6)";ctx.fillRect(-15,(frame%28)-14,30,1.2);
        ctx.restore();
      }
    };
  }

  const lavaBallDefinition = {
    id:"lavaBall",name:"岩浆球",englishName:"Lava Ball",color:"#e94812",
    description:"跑动一路丢下岩浆滩（每滩3秒 / 接触每0.8秒-2） / 本体碰撞附带灼烧 / 敌人1.1倍速",
    stats:{radius:15,speed:150,maxHp:100},
    createBehavior(services) {
      // 每走 20 单位丢一滩：轨迹由一滩滩独立的岩浆池组成，各自计时、各自消失。
      let previousX=null,previousY=null,travelled=0,nextGap=6+Math.random()*6;
      return {
        afterUpdateStep({ball}) {
          if (previousX === null) { previousX=ball.x; previousY=ball.y; return; }
          travelled+=Math.hypot(ball.x-previousX,ball.y-previousY);
          previousX=ball.x; previousY=ball.y;
          if (travelled < nextGap) return;
          travelled=0;
          nextGap=6+Math.random()*6;
          services.spawnCombatEntity(createLavaPuddle(ball.x,ball.y));
        },
        onArenaWrap(){previousX=null;previousY=null;travelled=0;},
        drawBody({ball,game},ctx){drawMoltenBall(ctx,ball,game.time);return true;},
        onCollision(context,target){
          context.services.dealDamage(target,1);
          applyHotBurn(context.services,context.ball,target);
        }
      };
    }
  };
  const magmaDefinition = {
    id:"magma",name:"岩浆",englishName:"Magma",color:"#fa791f",
    description:"每3.8秒抛投岩浆 / 直径35 / 接触每0.3秒-1 / 3.3秒后凝为碰撞伤害2的岩石 / 本体碰撞附带灼烧",
    stats:{radius:15,speed:150,maxHp:100},rionCycleDuration:6,
    createBehavior(services) {
      let timer=3.8;
      return {update({ball,game},dt){timer-=dt;if(timer>EPS)return;timer+=3.8;
        const margin=17.5;
        const point=resolveArenaGeometry(game).samplePoint(Math.random,margin);
        services.spawnCombatEntity(createLob(ball,point.x,point.y));
        services.playSound("shoot");},
        getNextTransitionIn(){return Math.max(EPS,timer);},
        onCollision(context,target){
          context.services.dealDamage(target,1);
          applyHotBurn(context.services,context.ball,target);
        }};
    }
  };
  const projectionDefinition = {
    id:"projection",name:"投影",englishName:"Projection",color:"#39101c",
    description:"碰撞留下直径30检修信号 / 存在4.6秒 / 每0.06秒-1",
    stats:{radius:15,speed:150,maxHp:100},
    createBehavior(services){return {onCollision(context,target){context.services.dealDamage(target,1);
      services.spawnCombatEntity(createProjection(context.ball.x,context.ball.y));}};}
  };
  const tomatoDefinition = {
    id:"tomato",name:"番茄",englishName:"Tomato",color:"#e53c30",
    description:"投掷番茄 / 落点战场内随机 / 直径60溅射-2 / 冷却2.3秒每次减少0.3秒最低0.05秒",
    stats:{radius:15,speed:150,maxHp:100},
    createBehavior(services){let timer=2.3, cooldown=2.3;
      return {update({ball,game},dt){timer-=dt;if(timer>EPS)return;
        // 落点改为战场内随机：留出溅射半径，整片直径60都落在场内。
        const margin=Math.min(30,game.arenaSize/2);
        const {x,y}=resolveArenaGeometry(game).samplePoint(Math.random,margin);
        services.spawnCombatEntity(createLob(ball,x,y,true));
        cooldown=Math.max(0.05,cooldown-0.3);timer+=cooldown;services.playSound("shoot");},
        getNextTransitionIn(){return Math.max(EPS,timer);},
        onCollision(context,target){context.services.dealDamage(target,1);}};
    }
  };
  for(const definition of [lavaBallDefinition,magmaDefinition,projectionDefinition,tomatoDefinition])registerBall(definition);
  return {lavaBallDefinition,magmaDefinition,projectionDefinition,tomatoDefinition,
    createLavaPuddle,createLavaPool,createProjection,createLob,drawLava,drawCrustBall,drawMoltenBall,
    drawLavaLob,drawLavaPuddle,drawSparks,drawLavaSmoke,applyHotBurn,createLavaBurn,
    PUDDLE_MIN_RADIUS,PUDDLE_MAX_RADIUS,PUDDLE_LIFE,PUDDLE_FADE};
});
