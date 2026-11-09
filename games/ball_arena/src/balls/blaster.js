(function initializeBlaster(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBlasterPlugin(dependencies) {
  "use strict";

  const { registerBall, createArenaGeometry } = dependencies;

  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  // ---- 数值与几何均取自参考视频实测，详见
  // docs/superpowers/specs/2026-09-25-blaster-ball-design.md ----
  const BULLET_SPEED = 320;          // 单位/秒（视频实测 250，按用户要求调快）
  const BULLET_DAMAGE = 1;
  const BULLET_RADIUS = 2.5;
  const BULLET_LIFE = 2.5;
  const BULLET_TAIL = 12;
  const FIRE_INTERVAL = 0.1;         // 每 0.1 秒一轮，两边枪口各一发
  const FIRE_REPEAT = 15;            // 重复 15 次后停火
  const FIRST_FIRE_DELAY = 0.2;
  const RELOAD_COOLDOWN = 1;         // 停火后 1 秒冷却
  const MAGAZINE_COUNT = 3;          // 场内随机 3 个弹匣
  const MAGAZINE_PICKUP_DELAY = 0.5; // 拾取后 0.5 秒开始下一轮
  const MAGAZINE_LIFE = 20;          // 弹匣最长滞留时间
  const MAGAZINE_EDGE_MARGIN = 26;   // 弹匣离墙的最小距离（单位）
  const MUZZLE_FLASH_LIFE = 0.1;
  const IMPACT_FLASH_LIFE = 0.14;
  // 吊舱：并排平行，中心线各偏 POD_OFFSET，炮口在 +POD_FORWARD 处。
  const POD_OFFSET = 22;
  const POD_FORWARD = 23.6;
  const POD_REACH = Math.hypot(POD_FORWARD, POD_OFFSET);
  const POD_HALF_LENGTH = 24.2;
  // 弹匣：视频实测约 52x46 px = 16x14 单位，取半边长 7、接触半径 9。
  const MAGAZINE_HALF = 7;
  const MAGAZINE_RADIUS = 9;

  const BODY_COLOR = "#e0382a";

  const PALETTE = Object.freeze({
    podBody: "#d81f10",
    podBodyLight: "#f4452c",
    podBodyDark: "#7d0f08",
    podGloss: "rgba(255, 176, 156, 0.42)",
    podRib: "rgba(78, 8, 4, 0.55)",
    podPanel: "#a01808",
    metalLight: "#b6b6c2",
    metal: "#8d8d99",
    metalMid: "#6e6e7a",
    metalDark: "#41414c",
    metalDeep: "#23232b",
    accent: "#c2201a",
    accentDark: "#6d0d08",
    muzzle: "#ff6a52",
    muzzleCore: "#fff2ec",
    tracer: "#ff4838",
    tracerCore: "#fff1ea"
  });

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  // 炮口在两具吊舱的钻尖上：沿挂架前向 POD_FORWARD，再向两侧偏 POD_OFFSET。
  function normalize(x, y, fallbackX, fallbackY) {
    const length = Math.hypot(x, y);
    if (!(length > EPSILON)) return { x: fallbackX, y: fallbackY };
    return { x: x / length, y: y / length };
  }

  function podMuzzle(ball, rigAngle, side) {
    const cos = Math.cos(rigAngle);
    const sin = Math.sin(rigAngle);
    const lateral = side * POD_OFFSET;
    return {
      x: ball.x + cos * POD_FORWARD - sin * lateral,
      y: ball.y + sin * POD_FORWARD + cos * lateral
    };
  }

  function createTracer(x, y, directionX, directionY) {
    return {
      kind: "blaster-tracer",
      combatKind: "projectile",
      isProjectile: true,
      life: BULLET_LIFE,
      x,
      y,
      vx: directionX * BULLET_SPEED,
      vy: directionY * BULLET_SPEED,
      radius: BULLET_RADIUS,
      damage: BULLET_DAMAGE,
      drawLayer: "background",
      update({ entity, game, services }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        const rawX = startX + entity.vx * dt;
        const rawY = startY + entity.vy * dt;
        const hit = services.getFirstEnemyHit(startX, startY, rawX, rawY, entity.radius);
        if (hit) {
          services.dealDamage(hit, entity.damage);
          services.spawnVisualEffect(createImpactFlash(hit.x, hit.y));
          entity.entityActive = false;
          return;
        }
        const arena = game.arena || createArenaGeometry(game.arenaSize);
        const wall = arena.traceSegment(startX, startY, rawX, rawY, entity.radius);
        const endX = wall ? wall.x : rawX;
        const endY = wall ? wall.y : rawY;
        const touchedWall = Boolean(wall);
        if (touchedWall) {
          // 视频实测曳光弹撞墙即消失，不反弹。
          services.spawnVisualEffect(createImpactFlash(endX, endY));
          entity.entityActive = false;
          return;
        }
        entity.x = endX;
        entity.y = endY;
      },
      draw({ entity }, canvasContext) {
        const speed = Math.hypot(entity.vx, entity.vy);
        if (!(speed > EPSILON)) return;
        const dirX = entity.vx / speed;
        const dirY = entity.vy / speed;
        const tailX = entity.x - dirX * BULLET_TAIL;
        const tailY = entity.y - dirY * BULLET_TAIL;
        canvasContext.save();
        const tail = canvasContext.createLinearGradient(tailX, tailY, entity.x, entity.y);
        tail.addColorStop(0, "rgba(255, 60, 40, 0)");
        tail.addColorStop(0.62, "rgba(255, 74, 52, 0.55)");
        tail.addColorStop(1, "rgba(255, 150, 120, 0.95)");
        canvasContext.strokeStyle = tail;
        canvasContext.lineWidth = entity.radius * 0.8;
        canvasContext.lineCap = "round";
        canvasContext.beginPath();
        canvasContext.moveTo(tailX, tailY);
        canvasContext.lineTo(entity.x, entity.y);
        canvasContext.stroke();
        canvasContext.fillStyle = PALETTE.tracer;
        canvasContext.beginPath();
        canvasContext.arc(entity.x, entity.y, entity.radius, 0, TAU);
        canvasContext.fill();
        canvasContext.fillStyle = PALETTE.tracerCore;
        canvasContext.beginPath();
        canvasContext.arc(entity.x, entity.y, entity.radius * 0.48, 0, TAU);
        canvasContext.fill();
        canvasContext.restore();
      }
    };
  }

  function createImpactFlash(x, y) {
    return {
      kind: "blaster-impact-flash",
      life: IMPACT_FLASH_LIFE,
      x,
      y,
      drawLayer: "background",
      draw({ effect }, canvasContext) {
        const progress = Math.min(1, Math.max(0, effect.age / effect.life));
        const alpha = 1 - progress;
        const radius = BULLET_RADIUS * (1.4 + progress * 3.2);
        canvasContext.save();
        canvasContext.globalAlpha *= alpha;
        canvasContext.fillStyle = PALETTE.tracer;
        canvasContext.beginPath();
        canvasContext.arc(effect.x, effect.y, radius, 0, TAU);
        canvasContext.fill();
        canvasContext.fillStyle = PALETTE.tracerCore;
        canvasContext.beginPath();
        canvasContext.arc(effect.x, effect.y, radius * 0.45, 0, TAU);
        canvasContext.fill();
        canvasContext.restore();
      }
    };
  }

  function createMuzzleFlash(x, y, angle) {
    return {
      kind: "blaster-muzzle-flash",
      life: MUZZLE_FLASH_LIFE,
      x,
      y,
      angle,
      drawLayer: "background",
      draw({ effect }, canvasContext) {
        const progress = Math.min(1, Math.max(0, effect.age / effect.life));
        const alpha = 1 - progress;
        const length = 5 + progress * 12;
        const width = 5.6 * (1 - progress * 0.45);
        canvasContext.save();
        canvasContext.translate(effect.x, effect.y);
        canvasContext.rotate(effect.angle);
        canvasContext.globalAlpha *= alpha;
        const glow = canvasContext.createLinearGradient(0, 0, length, 0);
        glow.addColorStop(0, PALETTE.muzzleCore);
        glow.addColorStop(0.35, PALETTE.muzzle);
        glow.addColorStop(1, "rgba(255, 60, 40, 0)");
        canvasContext.fillStyle = glow;
        canvasContext.beginPath();
        canvasContext.moveTo(0, -width * 0.5);
        canvasContext.lineTo(length, 0);
        canvasContext.lineTo(0, width * 0.5);
        canvasContext.closePath();
        canvasContext.fill();
        canvasContext.restore();
      }
    };
  }

  // 弹匣：红色匣体 + 灰色顶盖 + 灰色底板，匣体正面四道竖向棱。
  function createMagazine(x, y, rotation) {
    return {
      kind: "blaster-magazine",
      life: MAGAZINE_LIFE,
      x,
      y,
      radius: MAGAZINE_RADIUS,
      rotation,
      drawLayer: "background",
      draw({ entity }, canvasContext) {
        const half = MAGAZINE_HALF;
        canvasContext.save();
        canvasContext.translate(entity.x, entity.y);
        canvasContext.rotate(entity.rotation);

        // 底部灰色法兰
        canvasContext.fillStyle = PALETTE.metalDark;
        canvasContext.fillRect(-half - 1.6, half - 3.4, (half + 1.6) * 2, 4.6);
        canvasContext.fillStyle = PALETTE.metalMid;
        canvasContext.fillRect(-half - 2.4, half - 1.6, (half + 2.4) * 2, 2.6);

        // 红色匣体
        const body = canvasContext.createLinearGradient(-half, 0, half, 0);
        body.addColorStop(0, PALETTE.podBodyDark);
        body.addColorStop(0.22, PALETTE.podBody);
        body.addColorStop(0.62, PALETTE.podBodyLight);
        body.addColorStop(1, PALETTE.podBody);
        canvasContext.fillStyle = body;
        canvasContext.fillRect(-half, -half + 1.4, half * 2, half * 2 - 1.4);

        // 匣体棱线
        canvasContext.strokeStyle = PALETTE.podRib;
        canvasContext.lineWidth = 0.7;
        for (let index = 0; index < 4; index += 1) {
          const x0 = -half + 1.6 + index * (half * 2 - 3.2) / 3.4;
          canvasContext.beginPath();
          canvasContext.moveTo(x0, -half + 2.0);
          canvasContext.lineTo(x0, half - 0.4);
          canvasContext.stroke();
        }

        // 顶部灰色盖板
        const cap = canvasContext.createLinearGradient(0, -half - 2.6, 0, -half + 2.6);
        cap.addColorStop(0, PALETTE.metalLight);
        cap.addColorStop(0.5, PALETTE.metal);
        cap.addColorStop(1, PALETTE.metalDark);
        canvasContext.fillStyle = cap;
        canvasContext.fillRect(-half - 1.0, -half - 2.6, (half + 1.0) * 2, 4.6);
        canvasContext.fillStyle = PALETTE.metalDeep;
        canvasContext.fillRect(-half - 1.0, -half + 1.2, (half + 1.0) * 2, 1.0);
        canvasContext.restore();
      }
    };
  }

  // 单具钻头吊舱：局部 +X 为炮口方向，中心线 y=0，纵向 ±POD_HALF_LENGTH。
  // `outward` 是远离球心的一侧（+1 / -1）；散热百叶与红筒在靠外一侧，
  // 夹持组件与输弹鼓压在靠球心一侧，与参考图一致。
  function drawPod(canvasContext, outward) {
    // 局部坐标：+X 指向炮口，+Y 朝远离球心的一侧（乘 o 后即为外侧）。
    // 所有尺寸都按视频 t=0.033s 帧的逐列轮廓测量，见设计文档。
    const o = outward >= 0 ? 1 : -1;
    const metal = (y0, y1) => {
      const gradient = canvasContext.createLinearGradient(0, y0, 0, y1);
      gradient.addColorStop(0, PALETTE.metalLight);
      gradient.addColorStop(0.42, PALETTE.metal);
      gradient.addColorStop(1, PALETTE.metalDeep);
      return gradient;
    };
    canvasContext.save();

    // ---- 尾部圆角灰柱 ----
    // 参考图里炮管后端挂的是一小段垂直于炮管的粗灰柱（约 10x14 单位），
    // 不是横贯球体后方、把两具吊舱连起来的长杆。
    const strut = canvasContext.createLinearGradient(-22.0, 0, -12.6, 0);
    strut.addColorStop(0, PALETTE.metalDeep);
    strut.addColorStop(0.32, PALETTE.metalMid);
    strut.addColorStop(0.6, PALETTE.metal);
    strut.addColorStop(1, PALETTE.metalDark);
    canvasContext.fillStyle = strut;
    canvasContext.beginPath();
    canvasContext.moveTo(-17.0, o * 7.2);
    canvasContext.lineTo(-21.0, o * 5.6);
    canvasContext.arc(-21.0, 0, 5.6, o * Math.PI * 0.5, -o * Math.PI * 0.5, o > 0);
    canvasContext.lineTo(-17.0, -o * 7.2);
    canvasContext.arc(-17.0, 0, 7.2, -o * Math.PI * 0.5, o * Math.PI * 0.5, o < 0);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.strokeStyle = "rgba(16, 16, 20, 0.55)";
    canvasContext.lineWidth = 0.7;
    canvasContext.stroke();
    // 柱身环槽
    canvasContext.strokeStyle = "rgba(30, 30, 38, 0.45)";
    canvasContext.lineWidth = 0.55;
    for (const ringX of [-19.8, -16.2]) {
      canvasContext.beginPath();
      canvasContext.moveTo(ringX, -o * 6.4);
      canvasContext.lineTo(ringX, o * 6.4);
      canvasContext.stroke();
    }
    // 柱身外棱高光
    canvasContext.strokeStyle = "rgba(214, 214, 226, 0.35)";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.moveTo(-17.6, -o * 6.4);
    canvasContext.lineTo(-17.6, o * 6.4);
    canvasContext.stroke();

    // ---- 后盖板 ----
    canvasContext.fillStyle = PALETTE.metalDark;
    canvasContext.fillRect(-15.6, -6.2, 1.9, 12.4);

    // ---- 输弹鼓：靠球一侧的深红点纹面板 ----
    canvasContext.fillStyle = PALETTE.podPanel;
    canvasContext.beginPath();
    canvasContext.moveTo(-8.4, -o * 1.4);
    canvasContext.lineTo(-14.0, -o * 3.2);
    canvasContext.lineTo(-15.4, -o * 9.2);
    canvasContext.lineTo(-9.6, -o * 9.4);
    canvasContext.lineTo(-7.6, -o * 5.4);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.fillStyle = "rgba(255, 176, 150, 0.30)";
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        canvasContext.beginPath();
        canvasContext.arc(
          -9.4 - col * 1.9,
          -o * (3.6 + row * 1.9),
          0.5, 0, TAU
        );
        canvasContext.fill();
      }
    }

    // ---- 夹持组件（灰色枪机块，斜顶 + 下探到靠球一侧）----
    canvasContext.fillStyle = metal(-o * 6.4, o * 8.6);
    canvasContext.beginPath();
    canvasContext.moveTo(-18.0, o * 3.2);
    canvasContext.lineTo(-15.0, o * 5.6);
    canvasContext.lineTo(-7.6, o * 5.6);
    canvasContext.lineTo(-2.4, o * 2.0);
    canvasContext.lineTo(-3.0, -o * 6.6);
    canvasContext.lineTo(-9.0, -o * 8.4);
    canvasContext.lineTo(-16.6, -o * 7.0);
    canvasContext.lineTo(-19.0, -o * 3.4);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.strokeStyle = "rgba(18, 18, 22, 0.55)";
    canvasContext.lineWidth = 0.7;
    canvasContext.stroke();
    // 枪机块的分面线
    canvasContext.strokeStyle = "rgba(30, 30, 36, 0.42)";
    canvasContext.lineWidth = 0.55;
    canvasContext.beginPath();
    canvasContext.moveTo(-17.4, -o * 3.0);
    canvasContext.lineTo(-8.6, -o * 3.4);
    canvasContext.lineTo(-3.4, -o * 0.6);
    canvasContext.stroke();
    canvasContext.beginPath();
    canvasContext.moveTo(-16.2, o * 4.6);
    canvasContext.lineTo(-9.2, o * 4.6);
    canvasContext.stroke();

    // ---- 匣口指示窗：灰框 + 红色三格 ----
    canvasContext.fillStyle = PALETTE.metalDeep;
    canvasContext.fillRect(-13.4, -3.1, 7.0, 6.2);
    canvasContext.fillStyle = PALETTE.metalLight;
    canvasContext.fillRect(-12.9, -2.6, 6.0, 5.2);
    canvasContext.fillStyle = PALETTE.accent;
    for (let index = 0; index < 3; index += 1) {
      canvasContext.fillRect(-12.3 + index * 1.9, -1.9, 1.3, 3.8);
    }
    canvasContext.strokeStyle = "rgba(20, 20, 24, 0.5)";
    canvasContext.lineWidth = 0.45;
    canvasContext.strokeRect(-13.4, -3.1, 7.0, 6.2);

    // ---- 靠外一侧的红色散热百叶（亮面 + 暗面 + 三道槽）----
    canvasContext.fillStyle = PALETTE.podBodyDark;
    canvasContext.beginPath();
    canvasContext.moveTo(-1.0, o * 5.0);
    canvasContext.lineTo(-9.4, o * 9.8);
    canvasContext.lineTo(-14.6, o * 9.8);
    canvasContext.lineTo(-5.2, o * 5.0);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.fillStyle = PALETTE.podBodyLight;
    canvasContext.beginPath();
    canvasContext.moveTo(-1.0, o * 5.0);
    canvasContext.lineTo(-9.4, o * 9.8);
    canvasContext.lineTo(-14.6, o * 9.8);
    canvasContext.lineTo(-13.0, o * 8.0);
    canvasContext.lineTo(-8.8, o * 8.0);
    canvasContext.lineTo(-2.4, o * 5.0);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.strokeStyle = "rgba(64, 6, 2, 0.7)";
    canvasContext.lineWidth = 0.55;
    for (let index = 0; index < 4; index += 1) {
      const offset = 1.2 + index * 1.9;
      canvasContext.beginPath();
      canvasContext.moveTo(-2.2 - offset, o * 5.2);
      canvasContext.lineTo(-5.4 - offset, o * 9.7);
      canvasContext.stroke();
    }
    canvasContext.strokeStyle = "rgba(24, 4, 2, 0.6)";
    canvasContext.lineWidth = 0.6;
    canvasContext.beginPath();
    canvasContext.moveTo(-1.0, o * 5.0);
    canvasContext.lineTo(-9.4, o * 9.8);
    canvasContext.lineTo(-14.6, o * 9.8);
    canvasContext.stroke();

    // ---- 主储能筒 ----
    const pod = canvasContext.createLinearGradient(0, -o * 6.3, 0, o * 6.3);
    pod.addColorStop(0, PALETTE.podBodyDark);
    pod.addColorStop(0.28, PALETTE.podBody);
    pod.addColorStop(0.56, PALETTE.podBodyLight);
    pod.addColorStop(0.82, PALETTE.podBody);
    pod.addColorStop(1, PALETTE.podBodyDark);
    canvasContext.fillStyle = pod;
    canvasContext.fillRect(-6.6, -6.3, 22.2, 12.6);
    // 筒身高光：参考图是一道很宽的反光带（约占筒身上侧三分之一），不是细密滚花
    canvasContext.fillStyle = PALETTE.podGloss;
    canvasContext.fillRect(-6.0, o * 5.8, 21.2, -o * 4.4);
    canvasContext.fillStyle = "rgba(255, 226, 216, 0.55)";
    canvasContext.fillRect(-6.0, o * 5.7, 21.2, -o * 1.5);
    // 下侧暗面
    canvasContext.fillStyle = "rgba(48, 4, 2, 0.30)";
    canvasContext.fillRect(-6.0, -o * 3.9, 21.2, -o * 2.4);
    // 分模环（两道，很淡）
    canvasContext.strokeStyle = "rgba(96, 10, 6, 0.35)";
    canvasContext.lineWidth = 0.5;
    for (const ringX of [-4.2, 4.6]) {
      canvasContext.beginPath();
      canvasContext.moveTo(ringX, -o * 6.2);
      canvasContext.lineTo(ringX, o * 6.2);
      canvasContext.stroke();
    }
    // 前端窄滚花带（只在颈环前留一小段）
    canvasContext.strokeStyle = "rgba(112, 12, 6, 0.4)";
    canvasContext.lineWidth = 0.45;
    for (let offset = 0.7; offset < 3.4; offset += 0.85) {
      const x = 10.6 + offset;
      canvasContext.beginPath();
      canvasContext.moveTo(x, -o * 5.9);
      canvasContext.lineTo(x, o * 5.9);
      canvasContext.stroke();
    }
    // 筒身端面暗边
    canvasContext.fillStyle = "rgba(40, 4, 2, 0.35)";
    canvasContext.fillRect(-6.6, -6.3, 1.1, 12.6);
    canvasContext.strokeStyle = "rgba(30, 4, 2, 0.55)";
    canvasContext.lineWidth = 0.7;
    canvasContext.strokeRect(-6.6, -6.3, 22.2, 12.6);

    // ---- 前端颈环 ----
    canvasContext.fillStyle = PALETTE.metalDark;
    canvasContext.fillRect(15.4, -5.6, 2.0, 11.2);
    canvasContext.fillStyle = PALETTE.metalLight;
    canvasContext.fillRect(17.2, -5.2, 1.4, 10.4);

    // ---- 深色钻头：圆钝锥 + 三道环棱 + 圆头 ----
    const nose = canvasContext.createLinearGradient(0, -o * 5.0, 0, o * 5.0);
    nose.addColorStop(0, PALETTE.metalDeep);
    nose.addColorStop(0.34, PALETTE.metalMid);
    nose.addColorStop(0.62, PALETTE.metalDark);
    nose.addColorStop(1, PALETTE.metalDeep);
    canvasContext.fillStyle = nose;
    canvasContext.beginPath();
    canvasContext.moveTo(18.6, -o * 5.0);
    canvasContext.lineTo(22.4, -o * 3.4);
    canvasContext.arc(22.4, 0, 3.4, -o * Math.PI * 0.5, o * Math.PI * 0.5, o < 0);
    canvasContext.lineTo(18.6, o * 5.0);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.strokeStyle = "rgba(14, 14, 18, 0.6)";
    canvasContext.lineWidth = 0.7;
    canvasContext.stroke();
    canvasContext.strokeStyle = "rgba(200, 200, 212, 0.20)";
    canvasContext.lineWidth = 0.45;
    for (let offset = 1.6; offset < 4.6; offset += 1.5) {
      const half = 5.0 - offset * 0.58;
      canvasContext.beginPath();
      canvasContext.moveTo(18.6 + offset, -o * half);
      canvasContext.lineTo(18.6 + offset, o * half);
      canvasContext.stroke();
    }
    // 钻头根部亮环
    canvasContext.strokeStyle = "rgba(226, 226, 236, 0.42)";
    canvasContext.lineWidth = 0.7;
    canvasContext.beginPath();
    canvasContext.moveTo(19.2, -o * 4.6);
    canvasContext.lineTo(19.2, o * 4.6);
    canvasContext.stroke();

    // ---- 枪机后方的红色角板 ----
    canvasContext.fillStyle = PALETTE.podBody;
    canvasContext.beginPath();
    canvasContext.moveTo(-9.6, o * 5.2);
    canvasContext.lineTo(-13.4, o * 8.4);
    canvasContext.lineTo(-17.4, o * 8.4);
    canvasContext.lineTo(-15.6, o * 5.2);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.strokeStyle = "rgba(64, 6, 2, 0.6)";
    canvasContext.lineWidth = 0.5;
    canvasContext.stroke();

    // ---- 状态指示灯（参考图枪机下缘那点黄绿色亮光）----
    canvasContext.fillStyle = "rgba(206, 226, 90, 0.30)";
    canvasContext.beginPath();
    canvasContext.arc(-7.2, -o * 6.6, 2.4, 0, TAU);
    canvasContext.fill();
    canvasContext.fillStyle = "#d6e86a";
    canvasContext.beginPath();
    canvasContext.arc(-7.2, -o * 6.6, 1.05, 0, TAU);
    canvasContext.fill();
    canvasContext.fillStyle = "rgba(255, 255, 214, 0.85)";
    canvasContext.beginPath();
    canvasContext.arc(-7.5, -o * 6.9, 0.45, 0, TAU);
    canvasContext.fill();

    // ---- 铆钉：全部落在夹持组件与尾部灰柱的实体上 ----
    const RIVETS = [
      [-17.0, o * 4.4], [-17.0, -o * 4.6], [-9.8, o * 4.8],
      [-4.6, -o * 5.2], [-20.2, o * 3.2], [-20.2, -o * 3.2]
    ];
    // 阴影与高光都按 o 镜像，保证两具吊舱是完全的镜像关系
    canvasContext.fillStyle = "rgba(12, 12, 16, 0.5)";
    for (const [rx, ry] of RIVETS) {
      canvasContext.beginPath();
      canvasContext.arc(rx + 0.3, ry + 0.35 * o, 0.75, 0, TAU);
      canvasContext.fill();
    }
    canvasContext.fillStyle = PALETTE.metalLight;
    for (const [rx, ry] of RIVETS) {
      canvasContext.beginPath();
      canvasContext.arc(rx, ry, 0.7, 0, TAU);
      canvasContext.fill();
    }
    canvasContext.fillStyle = "rgba(255, 255, 255, 0.55)";
    for (const [rx, ry] of RIVETS) {
      canvasContext.beginPath();
      canvasContext.arc(rx - 0.22, ry - 0.25 * o, 0.3, 0, TAU);
      canvasContext.fill();
    }

    // ---- 整体暗色勾边 ----
    canvasContext.strokeStyle = "rgba(18, 4, 3, 0.5)";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.moveTo(-6.6, o * 6.3);
    canvasContext.lineTo(15.4, o * 6.0);
    canvasContext.lineTo(18.6, o * 5.0);
    canvasContext.lineTo(22.4, o * 3.4);
    canvasContext.stroke();

    canvasContext.restore();
  }

  const blasterDefinition = {
    id: "blaster",
    name: "爆破者",
    englishName: "Blaster",
    color: BODY_COLOR,
    description: "双钻并列挂架自动督准 / 打完抾弹匣换弹",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let rigAngle = 0;
      let phase = "firing";
      let timer = FIRST_FIRE_DELAY;
      let shotsLeft = FIRE_REPEAT;
      let shots = 0;
      let rounds = 0;
      let magazines = [];

      function clearMagazines() {
        for (const entity of magazines) {
          entity.entityActive = false;
        }
        magazines = [];
      }

      function spawnMagazines(context) {
        const arena = context.game.arena || createArenaGeometry(context.game.arenaSize);
        const chosen = [];
        for (let index = 0; index < MAGAZINE_COUNT; index += 1) {
          let point = null;
          for (let attempt = 0; attempt < 12 && !point; attempt += 1) {
            const candidate = arena.samplePoint(Math.random, MAGAZINE_EDGE_MARGIN);
            const clearOfBalls = (services.getEnemies() || []).every(
              (ball) => Math.hypot(ball.x - candidate.x, ball.y - candidate.y) > ball.radius + 60
            );
            const clearOfMates = chosen.every(
              (mate) => Math.hypot(mate.x - candidate.x, mate.y - candidate.y) > 60
            );
            if (clearOfBalls && clearOfMates) point = candidate;
          }
          if (!point) {
            point = arena.samplePoint(Math.random, MAGAZINE_EDGE_MARGIN);
          }
          chosen.push(point);
        }
        magazines = chosen.map((point, index) => services.spawnCombatEntity(
          createMagazine(point.x, point.y, index * (TAU / MAGAZINE_COUNT))
        ));
        return magazines;
      }

      function fireVolley(context) {
        const ball = context.ball;
        const target = services.getOpponent();
        // 两边枪口沿同一条「本体中心 → 敌方中心」射线开火，弹道互相平行：
        // 炮口在挂架两侧各偏 22 单位，所以两发弹会平行地掠过目标，
        // 只有目标正好落在弹道上时才命中（与视频表现一致，不做提前量）。
        const fallback = { x: Math.cos(rigAngle), y: Math.sin(rigAngle) };
        const aim = target
          ? normalize(target.x - ball.x, target.y - ball.y, fallback.x, fallback.y)
          : fallback;
        const flashAngle = Math.atan2(aim.y, aim.x);
        for (let index = 0; index < 2; index += 1) {
          const side = index === 0 ? 1 : -1;
          const muzzle = podMuzzle(ball, rigAngle, side);
          services.spawnProjectile(createTracer(muzzle.x, muzzle.y, aim.x, aim.y));
          services.spawnVisualEffect(createMuzzleFlash(muzzle.x, muzzle.y, flashAngle));
          shots += 1;
        }
      }

      function aimAtEnemy(context) {
        const target = services.getOpponent();
        if (!target) return;
        const dx = target.x - context.ball.x;
        const dy = target.y - context.ball.y;
        if (Math.hypot(dx, dy) <= EPSILON) return;
        rigAngle = Math.atan2(dy, dx);
      }

      function pickedUpMagazine(context) {
        const ball = context.ball;
        for (const entity of magazines) {
          if (entity.entityActive === false) continue;
          const reach = ball.radius + finiteOr(entity.radius, MAGAZINE_RADIUS);
          if (Math.hypot(entity.x - ball.x, entity.y - ball.y) <= reach) return true;
        }
        return false;
      }

      return {
        onAttackBorrowStart(context) { timer = 0; this.update(context, 0); },
        isAttackCycleComplete() { return shotsLeft === 0; },
        drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
        update(context, dt) {
          const step = Math.max(0, finiteOr(dt, 0));
          aimAtEnemy(context);
          timer -= step;
          if (phase === "firing") {
            while (shotsLeft > 0 && timer <= EPSILON) {
              fireVolley(context);
              shotsLeft -= 1;
              timer += FIRE_INTERVAL;
            }
            if (shotsLeft <= 0) {
              phase = "cooling";
              timer = RELOAD_COOLDOWN;
            }
            return;
          }
          if (phase === "cooling") {
            if (timer > EPSILON) return;
            magazines = [];
            spawnMagazines(context);
            phase = "seeking";
            return;
          }
          if (phase === "seeking") {
            const alive = magazines.some((entity) => entity.entityActive !== false);
            if (magazines.length > 0 && alive && !pickedUpMagazine(context)) return;
            clearMagazines();
            phase = "recovering";
            timer = MAGAZINE_PICKUP_DELAY;
            return;
          }
          // recovering：拾取后 0.5 秒开始下一轮
          if (timer > EPSILON) return;
          rounds += 1;
          shotsLeft = FIRE_REPEAT;
          timer = 0;
          phase = "firing";
        },
        drawAfter(context, canvasContext) {
          const ball = context.ball;
          canvasContext.save();
          canvasContext.translate(ball.x, ball.y);
          canvasContext.rotate(rigAngle);
          for (let index = 0; index < 2; index += 1) {
            const side = index === 0 ? 1 : -1;
            canvasContext.save();
            canvasContext.translate(0, side * POD_OFFSET);
            drawPod(canvasContext, side);
            canvasContext.restore();
          }
          canvasContext.restore();
        },
        getBlasterState() {
          return {
            rigAngle,
            phase,
            timer,
            shotsLeft,
            shots,
            rounds,
            magazines: magazines.filter((entity) => entity.entityActive !== false).length,
            muzzleReach: POD_REACH,
            podOffset: POD_OFFSET,
            podForward: POD_FORWARD,
            bulletSpeed: BULLET_SPEED,
            bulletDamage: BULLET_DAMAGE,
            fireInterval: FIRE_INTERVAL,
            fireRepeat: FIRE_REPEAT,
            reloadCooldown: RELOAD_COOLDOWN,
            pickupDelay: MAGAZINE_PICKUP_DELAY,
            magazineCount: MAGAZINE_COUNT
          };
        }
      };
    }
  };

  registerBall(blasterDefinition);
  return {
    blasterDefinition,
    BLASTER_PALETTE: PALETTE,
    BLASTER_CONSTANTS: Object.freeze({
      BULLET_SPEED,
      BULLET_DAMAGE,
      BULLET_RADIUS,
      BULLET_LIFE,
      BULLET_TAIL,
      FIRE_INTERVAL,
      FIRE_REPEAT,
      FIRST_FIRE_DELAY,
      RELOAD_COOLDOWN,
      MAGAZINE_COUNT,
      MAGAZINE_PICKUP_DELAY,
      MAGAZINE_LIFE,
      MAGAZINE_EDGE_MARGIN,
      MAGAZINE_RADIUS,
      POD_OFFSET,
      POD_FORWARD,
      POD_REACH,
      POD_HALF_LENGTH
    }),
    createBlasterTracer: createTracer,
    createBlasterMagazine: createMagazine
  };
});
