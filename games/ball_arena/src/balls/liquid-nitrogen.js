(function initializeLiquidNitrogen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiquidNitrogenPlugin({ registerBall }) {
  // ------------------------------------------------------------------
  // 玩法契约：喷口前方 45° 扇区，半径 35，每秒 2 点持续伤害；
  // 每秒叠一层 1 秒 / 50% 减速；叠满 4 层（累计减速 4 秒）冻结 3 秒。
  // 喷口特效只有蓝白粒子，不再画扇形/直线雾。
  // ------------------------------------------------------------------
  const CONE_HALF_ANGLE = Math.PI / 8;
  const CONE_RADIUS = 35;
  const DAMAGE_PER_SECOND = 2;
  const SLOW_SPEED_FACTOR = 0.5;
  const SLOW_DURATION = 1;
  const SLOW_APPLY_INTERVAL = 1;
  const SLOW_STACK_LIMIT = 4;
  const FREEZE_DURATION = 3;
  const AIM_TURN_RATE = Math.PI * 3;
  const BURST_INTERVAL = 0.07;
  const TARGET_STATE_TTL = 2.5;
  // 减速每 0.25 秒续一次命（单层时长 1 秒），所以刷新永远落在过期之前；
  // 叠层仍按每秒 +1 层结算，玩家看到的就是「一秒叠一层」。
  const SPRAY_TICK_INTERVAL = 0.25;
  const MAX_SPRAY_TICKS_PER_STEP = 24;
  const SLOW_EFFECT_ID = "liquid-nitrogen-slow";
  const FREEZE_EFFECT_ID = "liquid-nitrogen-freeze";
  const SPRAY_PARTICLE_KIND = "liquid-nitrogen-spray";
  const FROST_BURST_KIND = "liquid-nitrogen-frost";
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // ------------------------------------------------------------------
  // 美术：按参考图（球半径 R ≈ 307px）量出的包围盒换算成 R 单位，
  //       逐块 1:1 复刻罐体、双软管、卡箍、金环与喇叭喷口。
  //       +x = 喷口朝向，+y = 参考图里武器偏低的那一侧。
  // ------------------------------------------------------------------
  const ART = Object.freeze({
    tank: Object.freeze({ left: -2.18, right: -1.40, top: -1.23, bottom: 1.13, corner: 0.40 }),
    tankCap: Object.freeze({ left: -2.08, right: -1.50, top: -1.12, bottom: -0.62, corner: 0.30 }),
    tankPanel: Object.freeze({ left: -2.10, right: -1.48, top: -0.25, bottom: 0.16, corner: 0.07 }),
    tankPanelWindow: Object.freeze({ left: -2.02, right: -1.56, top: -0.16, bottom: 0.06, corner: 0.03 }),
    bandUpper: Object.freeze({ left: -2.42, right: -1.16, top: -0.73, bottom: -0.55, corner: 0.09 }),
    bandLower: Object.freeze({ left: -2.42, right: -1.16, top: 0.48, bottom: 0.66, corner: 0.09 }),
    hoseUpper: Object.freeze({ fromX: -1.37, fromY: -1.00, toX: -0.44, toY: -0.86, width: 0.135, ribs: 9 }),
    hoseLower: Object.freeze({ fromX: -1.37, fromY: 0.94, toX: -0.46, toY: 0.82, width: 0.135, ribs: 9 }),
    mount: Object.freeze({ left: 0.84, right: 1.12, top: 0.38, bottom: 0.85, corner: 0.07 }),
    barrel: Object.freeze({ left: 1.06, right: 1.48, top: 0.44, bottom: 0.79, corner: 0.06 }),
    goldRing: Object.freeze({ left: 1.49, right: 1.79, top: 0.30, bottom: 0.92, corner: 0.07 }),
    neck: Object.freeze({ left: 1.77, right: 2.29, halfLeft: 0.175, halfRight: 0.120, axis: 0.60 }),
    funnel: Object.freeze({ left: 2.27, right: 2.92, halfLeft: 0.120, halfRight: 0.400, axis: 0.60 }),
    muzzle: Object.freeze({ x: 2.92, y: 0.60 })
  });

  const OUTLINE_RATIO = 0.052;
  const RIG_OUTLINE = "#08315c";
  const STEEL_OUTLINE = "#525f76";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function angleDifference(left, right) {
    let delta = (left - right) % TWO_PI;
    if (delta > Math.PI) delta -= TWO_PI;
    if (delta < -Math.PI) delta += TWO_PI;
    return delta;
  }

  function turnToward(current, target, maximumStep) {
    const delta = angleDifference(target, current);
    if (Math.abs(delta) <= maximumStep) return target;
    return current + Math.sign(delta) * maximumStep;
  }

  // ------------------------------------------------------------------
  // 命中判定
  // ------------------------------------------------------------------
  function nozzleTip(ball, angle) {
    const radius = Number.isFinite(ball.radius) && ball.radius > 0 ? ball.radius : 15;
    const localX = ART.muzzle.x * radius;
    const localY = ART.muzzle.y * radius;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: ball.x + localX * cos - localY * sin,
      y: ball.y + localX * sin + localY * cos
    };
  }

  // 圆与扇形相交：外半径把目标半径算进去，角度按目标张角放宽，
  // 这样贴边的敌人不会被一条数学中线判掉。
  function circleInSector(apex, angle, radius, halfAngle, target) {
    const deltaX = target.x - apex.x;
    const deltaY = target.y - apex.y;
    const distance = Math.hypot(deltaX, deltaY);
    const targetRadius = Number.isFinite(target.radius) ? Math.max(0, target.radius) : 0;
    if (distance - targetRadius > radius + EPSILON) return false;
    if (distance <= targetRadius + EPSILON) return true;
    const bearing = Math.atan2(deltaY, deltaX);
    const spread = Math.asin(Math.min(1, targetRadius / distance));
    return Math.abs(angleDifference(bearing, angle)) <= halfAngle + spread + EPSILON;
  }

  // ------------------------------------------------------------------
  // 绘图原语
  // ------------------------------------------------------------------
  function roundedRectPath(canvas, x, y, width, height, corner) {
    const radius = Math.max(
      0,
      Math.min(corner, Math.abs(width) / 2, Math.abs(height) / 2)
    );
    canvas.beginPath();
    canvas.moveTo(x + radius, y);
    canvas.lineTo(x + width - radius, y);
    canvas.quadraticCurveTo(x + width, y, x + width, y + radius);
    canvas.lineTo(x + width, y + height - radius);
    canvas.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    canvas.lineTo(x + radius, y + height);
    canvas.quadraticCurveTo(x, y + height, x, y + height - radius);
    canvas.lineTo(x, y + radius);
    canvas.quadraticCurveTo(x, y, x + radius, y);
    canvas.closePath();
  }

  function linearPaint(canvas, x, top, bottom, stops, fallback) {
    if (typeof canvas.createLinearGradient !== "function") return fallback;
    const gradient = canvas.createLinearGradient(x, top, x, bottom);
    if (!gradient || typeof gradient.addColorStop !== "function") return fallback;
    for (let index = 0; index < stops.length; index += 1) {
      gradient.addColorStop(stops[index][0], stops[index][1]);
    }
    return gradient;
  }

  function fillRounded(canvas, box, scale, paint, outline, outlineRatio) {
    const x = box.left * scale;
    const y = box.top * scale;
    const width = (box.right - box.left) * scale;
    const height = (box.bottom - box.top) * scale;
    roundedRectPath(canvas, x, y, width, height, box.corner * scale);
    canvas.fillStyle = paint;
    canvas.fill();
    if (outline) {
      canvas.lineWidth = outlineRatio * scale;
      canvas.strokeStyle = outline;
      canvas.stroke();
    }
  }

  function segment(canvas, fromX, fromY, toX, toY) {
    canvas.beginPath();
    canvas.moveTo(fromX, fromY);
    canvas.lineTo(toX, toY);
    canvas.stroke();
  }

  // 罐体：参考图左侧的立式液氮罐 + 两道金属卡箍 + 中央蓝色面板。
  function drawTank(canvas, scale) {
    const { tank, tankCap, tankPanel, tankPanelWindow, bandUpper, bandLower } = ART;
    const tankTop = tank.top * scale;
    const tankBottom = tank.bottom * scale;
    fillRounded(canvas, tank, scale, linearPaint(canvas, 0, tankTop, tankBottom, [
      [0, "#6fcbff"],
      [0.16, "#28a9fb"],
      [0.62, "#0199f8"],
      [1, "#0070cf"]
    ], "#0199f8"), RIG_OUTLINE, OUTLINE_RATIO);

    // 顶部柔光（参考图里罐体上缘更亮，没有硬边高光条）
    roundedRectPath(
      canvas,
      tankCap.left * scale,
      tankCap.top * scale,
      (tankCap.right - tankCap.left) * scale,
      (tankCap.bottom - tankCap.top) * scale,
      tankCap.corner * scale
    );
    canvas.globalAlpha *= 0.42;
    canvas.fillStyle = "#7fd4ff";
    canvas.fill();
    canvas.globalAlpha /= 0.42;

    // 面板
    fillRounded(canvas, tankPanel, scale, "#118bf0", RIG_OUTLINE, OUTLINE_RATIO * 0.7);
    fillRounded(canvas, tankPanelWindow, scale, linearPaint(
      canvas,
      0,
      tankPanelWindow.top * scale,
      tankPanelWindow.bottom * scale,
      [[0, "#66c8ff"], [0.28, "#1ba7fb"], [1, "#0f8ade"]],
      "#1ba7fb"
    ), "#0a4a86", OUTLINE_RATIO * 0.55);

    for (const band of [bandUpper, bandLower]) {
      fillRounded(canvas, band, scale, linearPaint(
        canvas,
        0,
        band.top * scale,
        band.bottom * scale,
        [
          [0, "#ffffff"],
          [0.32, "#e8eef8"],
          [0.68, "#c2cee0"],
          [1, "#96a4ba"]
        ],
        "#c4cfdf"
      ), STEEL_OUTLINE, OUTLINE_RATIO * 0.8);
      canvas.strokeStyle = "#f7fbff";
      canvas.lineWidth = (band.bottom - band.top) * scale * 0.16;
      segment(
        canvas,
        (band.left + (band.right - band.left) * 0.08) * scale,
        (band.top + (band.bottom - band.top) * 0.26) * scale,
        (band.right - (band.right - band.left) * 0.08) * scale,
        (band.top + (band.bottom - band.top) * 0.26) * scale
      );
    }
  }

  // 波纹软管：底管 + 交替明暗环纹 + 顶部高光。
  function drawHose(canvas, scale, hose) {
    const fromX = hose.fromX * scale;
    const fromY = hose.fromY * scale;
    const toX = hose.toX * scale;
    const toY = hose.toY * scale;
    const width = hose.width * scale;
    const deltaX = toX - fromX;
    const deltaY = toY - fromY;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const unitX = deltaX / length;
    const unitY = deltaY / length;
    const normalX = -unitY;
    const normalY = unitX;

    canvas.lineCap = "round";
    canvas.strokeStyle = "#6b370f";
    canvas.lineWidth = width * 1.12;
    segment(canvas, fromX, fromY, toX, toY);
    canvas.strokeStyle = "#a45f24";
    canvas.lineWidth = width * 0.94;
    segment(canvas, fromX, fromY, toX, toY);

    const ribs = Math.max(2, Math.round(hose.ribs));
    for (let index = 1; index < ribs; index += 1) {
      const progress = index / ribs;
      const centerX = fromX + unitX * length * progress;
      const centerY = fromY + unitY * length * progress;
      const half = width * 0.47;
      canvas.strokeStyle = index % 2 === 0 ? "#e8964a" : "#6f3a12";
      canvas.lineWidth = index % 2 === 0 ? width * 0.30 : width * 0.46;
      segment(
        canvas,
        centerX - normalX * half,
        centerY - normalY * half,
        centerX + normalX * half,
        centerY + normalY * half
      );
    }

    canvas.strokeStyle = "#e5a765";
    canvas.lineWidth = width * 0.18;
    segment(
      canvas,
      fromX - normalX * width * 0.24,
      fromY - normalY * width * 0.24,
      toX - normalX * width * 0.24,
      toY - normalY * width * 0.24
    );
  }

  // 喷射器：卡座 → 枪管 → 金环 → 收缩颈 → 喇叭口（比例照参考图）。
  function drawLauncher(canvas, scale) {
    const { mount, barrel, goldRing, neck, funnel } = ART;

    fillRounded(canvas, mount, scale, linearPaint(
      canvas,
      0,
      mount.top * scale,
      mount.bottom * scale,
      [[0, "#f2f7fd"], [0.42, "#c8d3e3"], [1, "#8d99ad"]],
      "#c8d3e3"
    ), STEEL_OUTLINE, OUTLINE_RATIO);

    fillRounded(canvas, barrel, scale, linearPaint(
      canvas,
      0,
      barrel.top * scale,
      barrel.bottom * scale,
      [[0, "#eef4fc"], [0.36, "#c4d0e1"], [1, "#7f8b9f"]],
      "#c4d0e1"
    ), STEEL_OUTLINE, OUTLINE_RATIO);

    const ringTop = goldRing.top * scale;
    const ringBottom = goldRing.bottom * scale;
    fillRounded(canvas, goldRing, scale, linearPaint(canvas, 0, ringTop, ringBottom, [
      [0, "#ffe992"],
      [0.24, "#fcd353"],
      [0.62, "#e5a72c"],
      [1, "#a96c12"]
    ], "#e5a72c"), "#6d4405", OUTLINE_RATIO);
    canvas.strokeStyle = "rgba(255, 255, 255, 0.72)";
    canvas.lineWidth = (goldRing.right - goldRing.left) * scale * 0.12;
    segment(
      canvas,
      (goldRing.left + (goldRing.right - goldRing.left) * 0.22) * scale,
      (goldRing.top + (goldRing.bottom - goldRing.top) * 0.10) * scale,
      (goldRing.left + (goldRing.right - goldRing.left) * 0.22) * scale,
      (goldRing.top + (goldRing.bottom - goldRing.top) * 0.90) * scale
    );

    const axisY = neck.axis * scale;
    canvas.beginPath();
    canvas.moveTo(neck.left * scale, axisY - neck.halfLeft * scale);
    canvas.lineTo(neck.right * scale, axisY - neck.halfRight * scale);
    canvas.lineTo(neck.right * scale, axisY + neck.halfRight * scale);
    canvas.lineTo(neck.left * scale, axisY + neck.halfLeft * scale);
    canvas.closePath();
    canvas.fillStyle = linearPaint(
      canvas,
      0,
      axisY - neck.halfLeft * scale,
      axisY + neck.halfLeft * scale,
      [[0, "#dfe8f5"], [0.4, "#b6c2d5"], [1, "#78859a"]],
      "#b6c2d5"
    );
    canvas.fill();
    canvas.lineWidth = OUTLINE_RATIO * scale;
    canvas.strokeStyle = STEEL_OUTLINE;
    canvas.stroke();

    const funnelAxisY = funnel.axis * scale;
    canvas.beginPath();
    canvas.moveTo(funnel.left * scale, funnelAxisY - funnel.halfLeft * scale);
    canvas.lineTo(funnel.right * scale, funnelAxisY - funnel.halfRight * scale);
    canvas.lineTo(funnel.right * scale, funnelAxisY + funnel.halfRight * scale);
    canvas.lineTo(funnel.left * scale, funnelAxisY + funnel.halfLeft * scale);
    canvas.closePath();
    canvas.fillStyle = linearPaint(
      canvas,
      0,
      funnelAxisY - funnel.halfRight * scale,
      funnelAxisY + funnel.halfRight * scale,
      [[0, "#e4edfa"], [0.38, "#bccbe2"], [1, "#8291a9"]],
      "#bccbe2"
    );
    canvas.fill();
    canvas.lineWidth = OUTLINE_RATIO * scale;
    canvas.strokeStyle = STEEL_OUTLINE;
    canvas.stroke();

    // 口部内壁：深一档的金属环，喷口从这里往外喷。
    canvas.beginPath();
    canvas.ellipse(
      funnel.right * scale - funnel.halfRight * scale * 0.12,
      funnelAxisY,
      funnel.halfRight * scale * 0.16,
      funnel.halfRight * scale * 0.72,
      0,
      0,
      TWO_PI
    );
    canvas.fillStyle = "rgba(66, 80, 102, 0.85)";
    canvas.fill();
  }

  function drawBackRig(canvas, scale) {
    drawTank(canvas, scale);
    drawHose(canvas, scale, ART.hoseUpper);
    drawHose(canvas, scale, ART.hoseLower);
  }

  function drawFrontRig(canvas, scale) {
    drawLauncher(canvas, scale);
  }

  // ------------------------------------------------------------------
  // 状态：减速（可叠加） → 叠满 4 层冻结 3 秒
  // ------------------------------------------------------------------
  function createLiquidNitrogenFreezeEffect() {
    return {
      id: FREEZE_EFFECT_ID,
      attackTags: ["cold", "freeze"],
      duration: FREEZE_DURATION,
      combatKind: "skill",
      // 冻结走引擎的「倍率 0」通道：速度归零，解冻时引擎按记录的朝向恢复。
      // 刻意不写 locksMovement —— 引擎会为被锁住的球跳过速度归一化，
      // 那样冻结中的球反而会保持原速继续飞。
      speedFactor: 0,
      pausesBehavior: true,
      preventsAttack: true,
      visualType: "freeze",
      onApply({ effect, game }) {
        effect.frozenAt = game.time;
      },
      draw({ ball, game }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const base = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
        const radius = ball.radius + 1;
        const pulse = 0.5 + 0.5 * Math.sin(game.time * 5.5);
        canvas.save();
        canvas.globalAlpha = base * (0.30 + pulse * 0.12);
        canvas.fillStyle = "#9fdcff";
        canvas.beginPath();
        canvas.arc(ball.x, ball.y, radius, 0, TWO_PI);
        canvas.fill();
        canvas.globalAlpha = base * 0.9;
        canvas.fillStyle = "#eefaff";
        for (let index = 0; index < 6; index += 1) {
          const angle = index * TWO_PI / 6 + 0.35;
          const inner = radius * 0.66;
          const outer = radius * 1.12;
          const halfWidth = radius * 0.2;
          const tipX = ball.x + Math.cos(angle) * outer;
          const tipY = ball.y + Math.sin(angle) * outer;
          const baseX = ball.x + Math.cos(angle) * inner;
          const baseY = ball.y + Math.sin(angle) * inner;
          const normalX = -Math.sin(angle) * halfWidth;
          const normalY = Math.cos(angle) * halfWidth;
          canvas.beginPath();
          canvas.moveTo(tipX, tipY);
          canvas.lineTo(baseX + normalX, baseY + normalY);
          canvas.lineTo(baseX - normalX, baseY - normalY);
          canvas.closePath();
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  function createLiquidNitrogenSlowEffect(stackNow = true) {
    return {
      id: SLOW_EFFECT_ID,
      attackTags: ["cold"],
      duration: SLOW_DURATION,
      combatKind: "skill",
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略。
      speedFactor: SLOW_SPEED_FACTOR,
      stackNow: stackNow === true,
      onApply({ effect, game, isRefresh }) {
        if (!isRefresh || !Number.isFinite(effect.stacks)) {
          effect.stacks = 0;
          effect.startedAt = game.time;
          effect.freezePending = false;
        }
        if (effect.stackNow === true) {
          // 可叠加：每叠一层就把剩余时长往上加满一层，上限 4 层。
          effect.stacks = Math.min(SLOW_STACK_LIMIT, effect.stacks + 1);
          effect.expiresAt = game.time + effect.stacks * SLOW_DURATION;
          if (effect.stacks >= SLOW_STACK_LIMIT) effect.freezePending = true;
        } else {
          // 同一次喷射里的高频续命：只保活，不叠层，也不缩短已叠的时长。
          effect.expiresAt = Math.max(effect.expiresAt, game.time + SLOW_DURATION);
        }
        if (effect.stacks < 1) effect.stacks = 1;
      },
      update({ ball, effect, game, services: effectServices }) {
        if (!effect.freezePending) return;
        effect.freezePending = false;
        effect.stacks = 0;
        // 叠满即冻结；冻结期间喷射照旧叠减速，所以计数器归零后继续累。
        effect.expiresAt = Math.max(effect.expiresAt, game.time + SLOW_DURATION);
        if (!effectServices || typeof effectServices.applyEffect !== "function") return;
        effectServices.applyEffect(ball, createLiquidNitrogenFreezeEffect());
        effectServices.spawnVisualEffect({
          kind: FROST_BURST_KIND,
          life: 0.55,
          x: ball.x,
          y: ball.y,
          radius: ball.radius,
          draw({ effect: burst }, canvas) {
            if (!canvas || typeof canvas.arc !== "function") return;
            const base = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
            const progress = clamp(burst.age / burst.life, 0, 1);
            canvas.save();
            canvas.globalAlpha = base * (1 - progress) * 0.8;
            canvas.strokeStyle = "#dff4ff";
            canvas.lineWidth = 1.6;
            canvas.beginPath();
            canvas.arc(
              burst.x,
              burst.y,
              burst.radius + 2 + progress * burst.radius * 1.8,
              0,
              TWO_PI
            );
            canvas.stroke();
            canvas.restore();
          }
        });
      },
      draw({ ball, effect, game }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const base = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
        const pulse = 0.5 + 0.5 * Math.sin((game.time - (effect.startedAt || 0)) * 7);
        canvas.save();
        canvas.globalAlpha = base * (0.26 + pulse * 0.18);
        canvas.strokeStyle = "#cdeeff";
        canvas.lineWidth = 1.4;
        canvas.beginPath();
        canvas.arc(ball.x, ball.y, ball.radius + 1.5, 0, TWO_PI);
        canvas.stroke();
        canvas.fillStyle = "#e8f8ff";
        for (let index = 0; index < 5; index += 1) {
          const angle = index * TWO_PI / 5 + (game.time - (effect.startedAt || 0)) * 0.9;
          const distance = ball.radius + 3 + ((index % 3) + 1);
          canvas.fillRect(
            Math.round(ball.x + Math.cos(angle) * distance),
            Math.round(ball.y + Math.sin(angle) * distance),
            2,
            2
          );
        }
        canvas.restore();
      }
    };
  }

  const liquidNitrogenDefinition = {
    id: "liquidNitrogen",
    elementTags: Object.freeze(["cold"]),
    name: "液氮",
    englishName: "Liquid Nitrogen",
    color: "#61caff",
    description: "喷口 45 度冷冻扇形 / 每秒 2 点持续伤害 / 减速可叠加 / 叠满 4 秒冻结 3 秒",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 6,
    createBehavior(services) {
      const state = {
        ball: null,
        seed: 0,
        aimAngle: 0,
        aimReady: false,
        nextBurstAt: 0,
        targets: new Map()
      };

      function sprayOn(enemy, time, step) {
        const key = enemy.instanceId || enemy.id;
        let entry = state.targets.get(key);
        if (!entry) {
          entry = {
            damagePool: 0,
            nextSlowAt: time,
            nextRefreshAt: time,
            lastSeenAt: time
          };
          state.targets.set(key, entry);
        }
        entry.lastSeenAt = time;
        // 每秒 2 点：按整数点结算，避免刷屏与小数血量。
        entry.damagePool += DAMAGE_PER_SECOND * step;
        const whole = Math.floor(entry.damagePool + 1e-6);
        if (whole > 0) {
          entry.damagePool = Math.max(0, entry.damagePool - whole);
          services.dealDamage(enemy, whole);
        }
        // 一次 update 可能带着好几秒的 dt（引擎允许大步长），所以按节拍补齐
        // 漏掉的续命/叠层，而不是只结算一次。
        let ticks = 0;
        while (time + EPSILON >= entry.nextRefreshAt && ticks < MAX_SPRAY_TICKS_PER_STEP) {
          const stackNow = time + EPSILON >= entry.nextSlowAt;
          if (stackNow) entry.nextSlowAt += SLOW_APPLY_INTERVAL;
          entry.nextRefreshAt += SPRAY_TICK_INTERVAL;
          ticks += 1;
          services.applyEffect(enemy, createLiquidNitrogenSlowEffect(stackNow));
        }
        if (time + EPSILON >= entry.nextRefreshAt) entry.nextRefreshAt = time + SPRAY_TICK_INTERVAL;
        if (time + EPSILON >= entry.nextSlowAt) entry.nextSlowAt = time + SLOW_APPLY_INTERVAL;
      }

      function emitSprayBurst(apex) {
        services.spawnParticleBurst({
          x: apex.x,
          y: apex.y,
          kind: SPRAY_PARTICLE_KIND,
          count: 8,
          colors: ["#ffffff", "#e2f6ff", "#a5e2ff", "#6cc6f2"],
          minDiameter: 2.5,
          maxDiameter: 9,
          minSpeed: 90,
          maxSpeed: 320,
          directionAngle: state.aimAngle,
          directionSpread: Math.PI * 0.5,
          initialRadius: 4,
          life: 0.5,
          drag: 2.8,
          gravityX: Math.cos(state.aimAngle) * 30,
          gravityY: Math.sin(state.aimAngle) * 30
        });
      }

      function pruneTargets(time) {
        if (state.targets.size === 0) return;
        for (const [key, entry] of state.targets) {
          if (time - entry.lastSeenAt > TARGET_STATE_TTL) state.targets.delete(key);
        }
      }

      return {
        update(context, dt) {
          const ball = context.ball;
          const game = context.game;
          const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
          if (state.ball !== ball) {
            state.ball = ball;
            state.aimReady = false;
            state.targets.clear();
          }

          const opponent = services.getOpponent();
          if (opponent) {
            const desired = Math.atan2(opponent.y - ball.y, opponent.x - ball.x);
            state.aimAngle = state.aimReady
              ? turnToward(state.aimAngle, desired, AIM_TURN_RATE * step)
              : desired;
            state.aimReady = true;
          } else if (!state.aimReady) {
            const speed = Math.hypot(ball.vx, ball.vy);
            state.aimAngle = speed > EPSILON ? Math.atan2(ball.vy, ball.vx) : 0;
            state.aimReady = true;
          }

          const apex = nozzleTip(ball, state.aimAngle);
          let spraying = false;
          services.forEachEnemy((enemy) => {
            if (!enemy || enemy.hp <= 0) return;
            if (!circleInSector(apex, state.aimAngle, CONE_RADIUS, CONE_HALF_ANGLE, enemy)) {
              return;
            }
            spraying = true;
            sprayOn(enemy, game.time, step);
          });

          const attackTime = typeof services.getAttackTime === "function"
            ? services.getAttackTime() : game.time;
          if (spraying && attackTime + EPSILON >= state.nextBurstAt) {
            state.nextBurstAt = attackTime + BURST_INTERVAL;
            emitSprayBurst(apex);
          }
          pruneTargets(game.time);
        },
        getAttackCycleDuration() { return 5; },
        borrowedWeaponLayer: "both",
        drawBorrowedWeapon(context, canvas, layer) {
          if (layer === "before") this.drawBefore(context, canvas);
          else this.drawAfter(context, canvas);
        },
        // 罐体与软管画在球体之前，接头被球面盖住（和参考图一致的层次）。
        drawBefore(context, canvas) {
          if (!canvas || typeof canvas.save !== "function") return;
          const ball = context.ball;
          canvas.save();
          canvas.lineJoin = "round";
          canvas.translate(ball.x, ball.y);
          canvas.rotate(state.aimAngle);
          drawBackRig(canvas, ball.radius);
          canvas.restore();
        },
        // 喷射器画在球体之后，喷口永远压在球面外侧；
        // 喷射特效只由粒子视效表现，这里不再画扇形/直线雾。
        drawAfter(context, canvas) {
          if (!canvas || typeof canvas.save !== "function") return;
          const ball = context.ball;
          canvas.save();
          canvas.lineJoin = "round";
          canvas.translate(ball.x, ball.y);
          canvas.rotate(state.aimAngle);
          drawFrontRig(canvas, ball.radius);
          canvas.restore();
        }
      };
    }
  };

  registerBall(liquidNitrogenDefinition);

  return {
    liquidNitrogenDefinition,
    createLiquidNitrogenSlowEffect,
    createLiquidNitrogenFreezeEffect,
    LIQUID_NITROGEN_RULES: Object.freeze({
      CONE_HALF_ANGLE,
      CONE_RADIUS,
      DAMAGE_PER_SECOND,
      SLOW_SPEED_FACTOR,
      SLOW_DURATION,
      SLOW_APPLY_INTERVAL,
      SLOW_STACK_LIMIT,
      FREEZE_DURATION,
      SLOW_EFFECT_ID,
      FREEZE_EFFECT_ID,
      SPRAY_PARTICLE_KIND,
      FROST_BURST_KIND
    })
  };
});
