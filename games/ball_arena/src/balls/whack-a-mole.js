(function initializeWhackAMole(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createWhackAMolePlugin({ resolveArenaGeometry, registerBall }) {
  // 球体走游戏默认纯色绘制：棕色。
  const MALLET_COLOR = "#8b5a2b";
  const MALLET_HANDLE_COLOR = "#a9713a";
  const MALLET_EDGE_COLOR = "#5f3a1c";
  const MALLET_GRIP_COLOR = "#4a2d14";
  const MALLET_FLASH_COLOR = "#f5e3b8";
  // 场上 9 个直径 40 的半透明虚线圆。
  const HOLE_DIAMETER = 40;
  const HOLE_RADIUS = HOLE_DIAMETER / 2;
  const HOLE_STROKE = "rgba(139, 90, 43, 0.62)";
  const HOLE_FILL = "rgba(139, 90, 43, 0.1)";
  const HOLE_DASH = [5, 4];
  // 洞口的分布：每边取 1/6、3/6、5/6（也就是三等分的中点），比四分位线
  // 铺得开，9 个洞基本铺满整个战场而不是挤在中间。
  const HOLE_LINES = 3;
  const HOLE_DIVISIONS = 6;
  const HOLE_FLASH_DURATION = 0.45;
  // 场地特性：洞是会塌的。塌掉的那个洞不再是虚线圈，只剩一个被刨开的缺口；
  // 2 秒后一只地鼠爪子从缺口里钻出来刨土，把虚线圈一圈一圈重新挖回来。
  // （"2 秒"是约定的机制数值；挖掘时长、预警时长属于表现参数。）
  const HOLE_REPAIR_DELAY = 2;
  const HOLE_DIG_DURATION = 1.4;
  const HOLE_SCOOP_COUNT = 4;
  // 环从左上开始补，和爪子绕圈刨土的方向一致。
  const HOLE_DIG_START_ANGLE = -Math.PI * 0.75;
  // 爪子破土前的鼓包预警：最后 0.5 秒地面开始鼓起来。
  const HOLE_BULGE_LEAD = 0.5;
  // 塌陷只有两个成因，都来自敌人的身体：
  //   1. 硬扛木槌：目标不吃控制（钢卷这类），锤子砸下去它照走，洞口被碾塌。
  //      这是"正面被木槌咬住还被硬扛"，属于刻意行为，不做节流。
  //   2. 高速冲撞：身体以 HOLE_RAM_SPEED 以上的速度碾过圈边（没被整个捕获）。
  //      擦边是常态（实测 96% 的圈内接触都是擦边），所以冲撞塌陷带全场节流
  //      HOLE_RAM_COOLDOWN：地面塌过一次要先沉降，9 个洞不会被一颗球一次扫平。
  const HOLE_RAM_SPEED = 420;
  const HOLE_RAM_COOLDOWN = 6;
  const HOLE_CLAW_KIND = "whack-a-mole-mole-claw";
  // 爪子绕缺口走一圈刨土：每一圈占 1/4 圈，位置在扇区中点。
  const HOLE_CLAW_ORBIT = 11;
  const HOLE_CLAW_SINK = 17;
  // 视效比相位多活一点点，保证"洞口最后一帧还在挖"时爪子没有提前被回收。
  const HOLE_CLAW_LINGER = 0.14;
  // 缺口配色：整体比"完好"的洞口更暗更碎——坑底是一块不规则的多边形，
  // 边上带虚线崩口、塌方楔块、裂缝和碎土。
  const HOLE_CRATER_POINTS = 11;
  const CRATER_FILL = "rgba(139, 90, 43, 0.18)";
  const CRATER_SOIL = "#b08a5c";
  const CRATER_WALL = "rgba(203, 184, 154, 0.3)";
  const CRATER_RIM = "rgba(139, 90, 43, 0.55)";
  const CRATER_GHOST = "rgba(139, 90, 43, 0.3)";
  const CRATER_CRACK = "rgba(139, 90, 43, 0.42)";
  const DIRT_PALE = "#e8dccb";
  const DIRT_LIGHT = "#cbb89a";
  const FRESH_DUG = "rgba(245, 227, 184, 0.9)";
  // 地鼠爪子沿用木槌那套"纯色 + 深描边"的木头语言：皮毛棕 + 奶油色指甲。
  const MOLE_FUR = "#6f4522";
  const MOLE_FUR_LIGHT = "#a9713a";
  const MOLE_FUR_DARK = "#3f2510";
  const MOLE_PAD = "#b9835a";
  const MOLE_CLAW = "#d8c096";
  // 场地实体：打地鼠是场地系角色，9 个洞是独立的场地实体（Combat Entity），
  // 攻击来源是洞自己（combatKind "trap"），不是本体的技能。
  const HOLE_ENTITY_KIND = "whack-a-mole-hole";
  const HOLE_COMBAT_KIND = "trap";
  // 木槌：绕上方支点抡下来，用锤头砸在洞口上（不是直上直下平移）。
  const MALLET_PIVOT_HEIGHT = 48;
  const MALLET_HANDLE_LENGTH = 46;
  const MALLET_HANDLE_WIDTH = 6;
  const MALLET_HEAD_WIDTH = 32;
  const MALLET_HEAD_HEIGHT = 16;
  const MALLET_SWING_START = 1.15;
  const MALLET_SWING_DURATION = 0.12;
  const MALLET_RECOVER_DURATION = 0.16;
  const IMPACT_LIFE = 0.26;
  const WHACK_DAMAGE = 7;
  // 颤抖眩晕：持续 1 秒，期间可以移动但被压到 50% 速度（不是静止）。
  const WHACK_STUN_DURATION = 1;
  const WHACK_SLOW_FACTOR = 0.5;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 战场相邻两边（上边 + 左边）上等距取点，向场内作垂线，两组垂线的交点。
  function whackAMoleHolePositions(arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const positions = [];
    for (let row = 0; row < HOLE_LINES; row += 1) {
      const y = arena.top + (arena.height * (2 * row + 1)) / HOLE_DIVISIONS;
      for (let column = 0; column < HOLE_LINES; column += 1) {
        positions.push({
          ...arena.clampPoint(arena.left + (arena.width * (2 * column + 1)) / HOLE_DIVISIONS, y, HOLE_RADIUS)
        });
      }
    }
    return positions;
  }

  // 敌方本体"整个完全进入虚线圆"或"大到足以覆盖整个虚线圆"是同一条件：
  // 圆心距不超过两者半径之差。
  function whackAMoleCaptureRadius(enemyRadius) {
    const radius = Number.isFinite(enemyRadius) ? enemyRadius : 0;
    return Math.abs(HOLE_RADIUS - radius);
  }

  // 碎块与裂缝的"随机感"必须逐洞固定，否则每一帧都会抖。用一个由洞口序号
  // 决定的小哈希代替 Math.random，画面上就稳定了。
  function holeNoise(index, salt) {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  // 缺口半径：塌掉的洞比原来的虚线圆小一圈，边上留着崩口的碎土。
  function holeCraterRadius() {
    return HOLE_RADIUS * 0.62;
  }

  // 缺口的不规则坑沿：逐洞固定半径的 11 边形（坑是崩的，不是圆的）。
  function traceCrater(canvas, index, radius, scale) {
    canvas.beginPath();
    for (let point = 0; point < HOLE_CRATER_POINTS; point += 1) {
      const angle = (point / HOLE_CRATER_POINTS) * TWO_PI;
      const distance = radius * scale * (0.72 + 0.5 * holeNoise(index, point + 41));
      const px = Math.cos(angle) * distance;
      const py = Math.sin(angle) * distance;
      if (point === 0) canvas.moveTo(px, py);
      else canvas.lineTo(px, py);
    }
    canvas.closePath();
  }

  // 爪子绕缺口刨土的角度：第 index 下土落在哪个扇区的中点。
  function holeScoopAngle(index) {
    return HOLE_DIG_START_ANGLE + ((index + 0.5) * TWO_PI) / HOLE_SCOOP_COUNT;
  }

  function holeScoopWithin(entity) {
    const raw = clamp(entity.phaseClock / HOLE_DIG_DURATION, 0, 1);
    return (raw * HOLE_SCOOP_COUNT) % 1;
  }

  function holeScoopIndex(entity) {
    const raw = clamp(entity.phaseClock / HOLE_DIG_DURATION, 0, 1);
    return Math.min(HOLE_SCOOP_COUNT - 1, Math.floor(raw * HOLE_SCOOP_COUNT));
  }

  // 一次刨土的姿态：破土 -> 抓土 -> 甩土 -> 缩回地下。
  // depth 0 = 完全埋在地下，1 = 完全露出；curl 越大手指收得越紧。
  function holeScoopPose(entity) {
    const within = holeScoopWithin(entity);
    if (within < 0.3) {
      const t = within / 0.3;
      const eased = t * t * (3 - 2 * t);
      return { depth: eased, curl: 0.9 - 0.7 * eased, lean: -0.34 * (1 - eased), throw: 0 };
    }
    if (within < 0.55) {
      const t = (within - 0.3) / 0.25;
      return { depth: 1 - 0.14 * t, curl: 0.2 + 0.8 * t, lean: -0.34 + 0.56 * t, throw: 0 };
    }
    if (within < 0.72) {
      const t = (within - 0.55) / 0.17;
      return {
        depth: 0.86 + 0.14 * t,
        curl: 1 - 0.96 * t,
        lean: 0.22 - 0.64 * t,
        throw: t
      };
    }
    const t = (within - 0.72) / 0.28;
    const eased = t * t * (3 - 2 * t);
    return { depth: 1 - eased, curl: 0.04 + 0.6 * eased, lean: -0.42 * eased, throw: 0 };
  }

  // 虚线圈补回来的比例：每刨完一下补满 1/4 圈，所以是"阶梯式但连续"的成长。
  function holeRepairProgress(entity) {
    if (!entity || entity.phase !== "digging") return 0;
    const raw = clamp(entity.phaseClock / HOLE_DIG_DURATION, 0, 1);
    const scoopsDone = Math.floor(raw * HOLE_SCOOP_COUNT);
    const within = (raw * HOLE_SCOOP_COUNT) % 1;
    // 每一下土在这个扇区"刨起来"的前 60% 时间内补齐，之后停着等下一铲。
    const eased = clamp(within / 0.6, 0, 1);
    return clamp((scoopsDone + eased) / HOLE_SCOOP_COUNT, 0, 1);
  }

  function pointSegmentDistance(startX, startY, endX, endY, pointX, pointY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    if (lengthSquared <= EPSILON) return Math.hypot(pointX - startX, pointY - startY);
    const progress = clamp(
      ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
      0,
      1
    );
    return Math.hypot(
      pointX - (startX + deltaX * progress),
      pointY - (startY + deltaY * progress)
    );
  }

  // 白蛇 DISC 抽走的是"能力"本身：被封印期间，本体的场地也一起停摆。
  // （引擎另外还有 blocksOwnedEntityDamage 会直接拦掉本体名下实体的出伤，
  //   这里额外把触发也停掉，免得出现"锤子挥了但不掉血"的假动作。）
  function ownerIsSealed(owner, now) {
    if (!owner) return true;
    if (!(owner.effects instanceof Map)) return false;
    for (const effect of owner.effects.values()) {
      if (!effect || !(effect.expiresAt > now)) continue;
      if (effect.sealsAbilities === true) return true;
      if (effect.blocksOwnedEntityDamage === true) return true;
    }
    return false;
  }

  // 颤抖眩晕：锁攻击 / 停行为，但**不锁移动**，全程压在 50% 速度。
  function createWhackStun() {
    return {
      id: "stun",
      visualType: "stun",
      duration: WHACK_STUN_DURATION,
      // 出伤来源也归到场地类（trap），和洞口实体的 combatKind 一致。
      combatKind: HOLE_COMBAT_KIND,
      preventsAttack: true,
      pausesBehavior: true,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: WHACK_SLOW_FACTOR,
      // 颤抖：和电球一样，在画球体之前把画布平移 ±2，让球本身抖起来。
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 48) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        if (context && typeof context.translate === "function") {
          context.translate(effect.renderOffsetX, effect.renderOffsetY);
        }
      }
    };
  }

  function roundedRect(canvas, x, y, width, height, radius) {
    const corner = Math.max(0, Math.min(radius, width / 2, height / 2));
    canvas.beginPath();
    canvas.moveTo(x + corner, y);
    canvas.lineTo(x + width - corner, y);
    canvas.arcTo(x + width, y, x + width, y + corner, corner);
    canvas.lineTo(x + width, y + height - corner);
    canvas.arcTo(x + width, y + height, x + width - corner, y + height, corner);
    canvas.lineTo(x + corner, y + height);
    canvas.arcTo(x, y + height, x, y + height - corner, corner);
    canvas.lineTo(x, y + corner);
    canvas.arcTo(x, y, x + corner, y, corner);
    canvas.closePath();
  }

  // 在"支点坐标系"里画一把木槌：柄从支点伸出，槌头横在末端。
  function drawMalletAt(canvas, pivotX, pivotY, angle, alpha) {
    canvas.save();
    canvas.translate(pivotX, pivotY);
    canvas.rotate(angle);
    canvas.globalAlpha *= alpha;

    // 柄（含握把）
    canvas.fillStyle = MALLET_HANDLE_COLOR;
    roundedRect(
      canvas,
      -MALLET_HANDLE_WIDTH / 2,
      -6,
      MALLET_HANDLE_WIDTH,
      MALLET_HANDLE_LENGTH - MALLET_HEAD_HEIGHT / 2 + 6,
      2
    );
    canvas.fill();
    canvas.strokeStyle = MALLET_EDGE_COLOR;
    canvas.lineWidth = 1;
    canvas.stroke();
    canvas.fillStyle = MALLET_GRIP_COLOR;
    roundedRect(canvas, -MALLET_HANDLE_WIDTH / 2 - 0.6, -8, MALLET_HANDLE_WIDTH + 1.2, 13, 2.4);
    canvas.fill();

    // 槌头：长轴垂直于柄，落下来时是"锤面"先着地
    const headTop = MALLET_HANDLE_LENGTH - MALLET_HEAD_HEIGHT / 2;
    canvas.fillStyle = MALLET_COLOR;
    roundedRect(
      canvas,
      -MALLET_HEAD_WIDTH / 2,
      headTop,
      MALLET_HEAD_WIDTH,
      MALLET_HEAD_HEIGHT,
      3.4
    );
    canvas.fill();
    canvas.strokeStyle = MALLET_EDGE_COLOR;
    canvas.lineWidth = 1.1;
    canvas.stroke();

    // 木纹与高光
    canvas.fillStyle = "rgba(255, 224, 178, 0.45)";
    roundedRect(
      canvas,
      -MALLET_HEAD_WIDTH / 2 + 2,
      headTop + 1.6,
      MALLET_HEAD_WIDTH - 4,
      2.6,
      1.2
    );
    canvas.fill();
    canvas.strokeStyle = "rgba(95, 58, 28, 0.55)";
    canvas.lineWidth = 0.8;
    for (let index = 1; index <= 2; index += 1) {
      const lineY = headTop + (MALLET_HEAD_HEIGHT * index) / 3;
      canvas.beginPath();
      canvas.moveTo(-MALLET_HEAD_WIDTH / 2 + 2.5, lineY);
      canvas.lineTo(MALLET_HEAD_WIDTH / 2 - 2.5, lineY);
      canvas.stroke();
    }
    canvas.restore();
  }

  // 木槌绕支点抡下：加速砸到洞口，再小幅回弹；下砸过程带弧线残影。
  function createMalletVisual(x, y) {
    return {
      kind: "whack-a-mole-mallet",
      life: MALLET_SWING_DURATION + MALLET_RECOVER_DURATION,
      x,
      y,
      draw({ effect }, canvas) {
        if (!canvas || typeof canvas.rotate !== "function") return;
        const age = effect.age;
        const pivotX = effect.x;
        const pivotY = effect.y - MALLET_PIVOT_HEIGHT;
        let angle;
        let swingProgress = 1;
        if (age <= MALLET_SWING_DURATION) {
          swingProgress = clamp(age / MALLET_SWING_DURATION, 0, 1);
          const eased = swingProgress * swingProgress;
          angle = -MALLET_SWING_START * (1 - eased);
        } else {
          const progress = clamp(
            (age - MALLET_SWING_DURATION) / MALLET_RECOVER_DURATION,
            0,
            1
          );
          angle = -MALLET_SWING_START * 0.3 * 4 * progress * (1 - progress);
        }
        // 弧线残影
        if (swingProgress < 1) {
          for (let index = 3; index >= 1; index -= 1) {
            const ghostAngle = angle - index * 0.13;
            if (ghostAngle < -MALLET_SWING_START) continue;
            drawMalletAt(
              canvas,
              pivotX,
              pivotY,
              ghostAngle,
              (1 - swingProgress) * 0.16 * (4 - index) / 3
            );
          }
        }
        drawMalletAt(canvas, pivotX, pivotY, angle, 1);
      }
    };
  }

  // 砸中瞬间的冲击特效：扩散环 + 放射冲击线。
  function createImpactVisual(x, y) {
    return {
      kind: "whack-a-mole-impact",
      life: IMPACT_LIFE,
      x,
      y,
      draw({ effect }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const progress = clamp(effect.age / effect.life, 0, 1);
        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.globalAlpha *= 1 - progress;
        canvas.strokeStyle = MALLET_FLASH_COLOR;
        canvas.lineWidth = 3 - 2.2 * progress;
        canvas.beginPath();
        canvas.arc(0, 0, 7 + 46 * progress, 0, TWO_PI);
        canvas.stroke();
        canvas.strokeStyle = "rgba(255, 255, 255, 0.9)";
        canvas.lineWidth = 2 - 1.5 * progress;
        for (let index = 0; index < 8; index += 1) {
          const angle = (index * Math.PI) / 4 + 0.35;
          const inner = 6 + 16 * progress;
          const outer = inner + 13 * (1 - progress) + 4;
          canvas.beginPath();
          canvas.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
          canvas.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
          canvas.stroke();
        }
        canvas.restore();
      }
    };
  }

  // 地鼠爪子：前臂 + 宽铲形手掌 + 四根带指甲的手指，沿用木槌那套
  // "纯色填充 + 深色描边 + 奶油色高光"的画法，所以两者看起来是一家人。
  function drawClawFinger(canvas, baseX, baseY, angle, length, clawLength, clawAlpha) {
    canvas.save();
    canvas.translate(baseX, baseY);
    canvas.rotate(angle);
    canvas.fillStyle = MOLE_FUR_LIGHT;
    roundedRect(canvas, -2.4, -length, 4.8, length + 2.8, 2.2);
    canvas.fill();
    canvas.strokeStyle = MOLE_FUR_DARK;
    canvas.lineWidth = 0.9;
    canvas.stroke();
    // 指甲：短而钝的奶油色铲尖，张开时露得最完整。
    canvas.globalAlpha *= clawAlpha;
    canvas.fillStyle = MOLE_CLAW;
    canvas.beginPath();
    canvas.moveTo(-2.5, -length + 1.2);
    canvas.lineTo(-1.5, -length - clawLength);
    canvas.lineTo(1.5, -length - clawLength);
    canvas.lineTo(2.5, -length + 1.2);
    canvas.closePath();
    canvas.fill();
    canvas.strokeStyle = "rgba(74, 45, 20, 0.5)";
    canvas.lineWidth = 0.7;
    canvas.stroke();
    canvas.restore();
  }

  function drawMoleClaw(canvas, entity) {
    const pose = holeScoopPose(entity);
    if (!(pose.depth > 0.001)) return;
    const index = holeScoopIndex(entity);
    const angle = holeScoopAngle(index);
    const pawX = entity.x + Math.cos(angle) * HOLE_CLAW_ORBIT;
    const pawY = entity.y + Math.sin(angle) * HOLE_CLAW_ORBIT;
    const curl = clamp(pose.curl, 0, 1);

    canvas.save();
    // 埋进土里的部分整体往下沉，depth 到 0 时正好完全没入。
    canvas.translate(pawX, pawY + (1 - pose.depth) * HOLE_CLAW_SINK);
    // 手指朝"背离坑心"的方向：地鼠在坑里，往外刨土。
    canvas.rotate(angle + Math.PI / 2 + pose.lean);
    canvas.globalAlpha *= clamp(0.25 + 0.75 * pose.depth, 0, 1);

    // 前臂：短而粗，像是从土里顶出来的一截，不是一根杆子
    canvas.fillStyle = MOLE_FUR;
    roundedRect(canvas, -5.2, -4, 10.4, 18, 4.6);
    canvas.fill();
    canvas.strokeStyle = MOLE_FUR_DARK;
    canvas.lineWidth = 1;
    canvas.stroke();
    canvas.fillStyle = "rgba(169, 113, 58, 0.45)";
    roundedRect(canvas, -3.6, -3, 3.2, 15, 1.6);
    canvas.fill();

    // 手掌：铲形的宽掌
    canvas.fillStyle = MOLE_FUR;
    roundedRect(canvas, -9.4, -11, 18.8, 12, 5.4);
    canvas.fill();
    canvas.strokeStyle = MOLE_FUR_DARK;
    canvas.lineWidth = 1.1;
    canvas.stroke();

    // 四根手指，收拢时角度靠向掌心、伸出时摊开
    const spread = 1 - 0.5 * curl;
    const fingerLength = 6.8 - 3.2 * curl;
    const clawLength = 2.6 - 1 * curl;
    for (let finger = 0; finger < 4; finger += 1) {
      const offset = (finger - 1.5) * 4.6;
      const fingerAngle = (finger - 1.5) * 0.34 * spread;
      drawClawFinger(
        canvas,
        offset,
        -12.4,
        fingerAngle,
        fingerLength,
        clawLength,
        0.35 + 0.65 * (1 - curl)
      );
    }

    // 掌心肉垫
    canvas.fillStyle = MOLE_PAD;
    roundedRect(canvas, -4.6, -7.6, 9.2, 6.4, 3);
    canvas.fill();
    canvas.strokeStyle = "rgba(63, 37, 16, 0.45)";
    canvas.lineWidth = 0.8;
    canvas.stroke();

    // 掌上挂着的土块：甩土那一下甩掉
    if (pose.throw < 0.5) {
      canvas.globalAlpha *= 1 - pose.throw * 2;
      canvas.fillStyle = DIRT_LIGHT;
      roundedRect(canvas, -8.4, -14.6, 5.4, 3.6, 1.6);
      canvas.fill();
      roundedRect(canvas, 4.4, -12.4, 4.2, 3, 1.4);
      canvas.fill();
      canvas.strokeStyle = "rgba(95, 58, 28, 0.5)";
      canvas.lineWidth = 0.7;
      canvas.stroke();
    }
    canvas.restore();
  }

  // 爪子的视效实例只负责"什么时候画"：姿态全部从洞口实体的相位里读，
  // 所以封印（休眠）时爪子和洞口会一起停住，不会各跑各的。
  function createMoleClawVisual(hole) {
    return {
      kind: HOLE_CLAW_KIND,
      life: HOLE_DIG_DURATION + HOLE_CLAW_LINGER,
      x: hole.x,
      y: hole.y,
      holeIndex: hole.holeIndex,
      hole,
      draw({ effect }, canvas) {
        if (!canvas || typeof canvas.rotate !== "function") return;
        const entity = effect.hole;
        // 洞口修好、或者场地被撤走（睡死 / 退场）之后，爪子一律不再画。
        if (!entity || entity.entityActive === false || entity.phase !== "digging") return;
        if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return;
        drawMoleClaw(canvas, entity);
      }
    };
  }

  // 缺口：塌掉的洞只剩一个被刨开的坑——崩掉的虚线残段、几道裂缝、散落的碎土。
  // 最后 0.5 秒地面开始鼓起并抖动：爪子在下面往上顶，给一个"要出来了"的预告。
  function drawHoleCrater(canvas, entity, dormant) {
    const crater = holeCraterRadius();
    const index = entity.holeIndex;
    const bulge = clamp(
      (entity.phaseClock - (HOLE_REPAIR_DELAY - HOLE_BULGE_LEAD)) / HOLE_BULGE_LEAD,
      0,
      1
    );
    const wobble = Math.sin(entity.phaseClock * 26) * 1.5 * bulge;
    canvas.save();
    canvas.translate(entity.x, entity.y + wobble * 0.4);

    // 坑底：不规则多边形（逐洞固定），边是刨出来的毛边，不是虚线圈
    traceCrater(canvas, index, crater, 1 + 0.08 * bulge);
    canvas.fillStyle = dormant ? "rgba(120, 120, 120, 0.1)" : CRATER_FILL;
    canvas.fill();
    canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.45)" : CRATER_RIM;
    canvas.lineWidth = 1.6;
    canvas.stroke();
    // 坑壁：往里收一圈的浅色描边，读作"这是个坑，有内壁"而不是一块贴纸
    traceCrater(canvas, index, crater * 0.66, 1 + 0.08 * bulge);
    canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.28)" : CRATER_WALL;
    canvas.lineWidth = 1;
    canvas.stroke();

    // 抛出来的土：沿着坑沿堆一圈土块（"这里是挖开的"）
    for (let chunk = 0; chunk < 7; chunk += 1) {
      const angle = holeNoise(index, chunk + 131) * TWO_PI;
      const distance = crater * (0.98 + 0.36 * holeNoise(index, chunk + 141));
      const size = 1.6 + 1.4 * holeNoise(index, chunk + 151);
      canvas.save();
      canvas.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
      canvas.rotate(angle);
      canvas.globalAlpha *= dormant ? 0.35 : 0.6;
      canvas.fillStyle = CRATER_SOIL;
      roundedRect(canvas, -size / 2, -size / 3, size, size * 0.7, 0.8);
      canvas.fill();
      canvas.strokeStyle = "rgba(63, 37, 16, 0.5)";
      canvas.lineWidth = 0.6;
      canvas.stroke();
      canvas.restore();
    }

    // 崩口：原来的虚线圈只活下来三段（这才是"这里本来是洞口"的线索，
    // 半径和原来的圈一致，但只剩几个残段，和内圈的崩口形成对比）
    canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.35)" : CRATER_GHOST;
    canvas.lineWidth = 1.2;
    if (typeof canvas.setLineDash === "function") canvas.setLineDash(HOLE_DASH);
    for (let piece = 0; piece < 3; piece += 1) {
      const start = holeNoise(index, piece * 2 + 1) * TWO_PI;
      const span = 0.24 + holeNoise(index, piece * 2 + 2) * 0.3;
      canvas.beginPath();
      canvas.arc(0, 0, HOLE_RADIUS, start, start + span);
      canvas.stroke();
    }
    if (typeof canvas.setLineDash === "function") canvas.setLineDash([]);

    // 裂缝：从坑沿往外炸开，走向逐洞固定
    canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.4)" : CRATER_CRACK;
    canvas.lineWidth = 1.1;
    for (let crack = 0; crack < 5; crack += 1) {
      const angle = holeNoise(index, crack + 11) * TWO_PI;
      const midAngle = angle + (holeNoise(index, crack + 31) - 0.5) * 0.5;
      const farAngle = angle + (holeNoise(index, crack + 41) - 0.5) * 0.7;
      const midRadius = crater * (1.02 + 0.12 * holeNoise(index, crack + 51));
      const farRadius = crater * (1.16 + 0.3 * holeNoise(index, crack + 61));
      canvas.beginPath();
      canvas.moveTo(Math.cos(angle) * crater * 0.84, Math.sin(angle) * crater * 0.84);
      canvas.lineTo(Math.cos(midAngle) * midRadius, Math.sin(midAngle) * midRadius);
      canvas.lineTo(Math.cos(farAngle) * farRadius, Math.sin(farAngle) * farRadius);
      canvas.stroke();
    }

    // 碎土：散在崩口上（带一圈深描边，和木槌的木屑是同一套）
    for (let clod = 0; clod < 5; clod += 1) {
      const angle = holeNoise(index, clod + 71) * TWO_PI;
      const distance = crater * (0.6 + 0.52 * holeNoise(index, clod + 81));
      const size = 1.9 + 1.5 * holeNoise(index, clod + 91);
      canvas.save();
      canvas.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
      canvas.rotate(angle);
      canvas.globalAlpha *= 0.75 + 0.25 * holeNoise(index, clod + 111);
      canvas.fillStyle = dormant ? "rgba(150, 150, 150, 0.4)" : CRATER_SOIL;
      roundedRect(canvas, -size / 2, -size / 3, size, size * 0.66, 0.9);
      canvas.fill();
      canvas.strokeStyle = "rgba(63, 37, 16, 0.55)";
      canvas.lineWidth = 0.6;
      canvas.stroke();
      canvas.restore();
    }

    if (bulge > 0) {
      // 鼓包：土从坑里顶起来，土粒在上面跳
      canvas.fillStyle = "rgba(139, 90, 43, " + (0.28 * bulge).toFixed(3) + ")";
      canvas.beginPath();
      canvas.arc(0, 0, crater * (0.36 + 0.42 * bulge), 0, TWO_PI);
      canvas.fill();
      canvas.fillStyle = "rgba(203, 184, 154, " + (0.26 * bulge).toFixed(3) + ")";
      canvas.beginPath();
      canvas.arc(-crater * 0.14, -crater * 0.18, crater * (0.12 + 0.14 * bulge), 0, TWO_PI);
      canvas.fill();
      canvas.fillStyle = "rgba(232, 220, 203, " + (0.5 * bulge).toFixed(3) + ")";
      for (let pebble = 0; pebble < 3; pebble += 1) {
        const angle = holeNoise(index, pebble + 101) * TWO_PI;
        const hop = Math.abs(Math.sin(entity.phaseClock * 9 + pebble)) * 3.5 * bulge;
        canvas.beginPath();
        canvas.arc(
          Math.cos(angle) * crater * 0.82,
          Math.sin(angle) * crater * 0.82 - hop,
          0.8 + 0.4 * bulge,
          0,
          TWO_PI
        );
        canvas.fill();
      }
    }
    canvas.restore();
  }

  // 修复中：爪子每刨完一铲，虚线圈就往前补一段；残坑与碎土同时淡下去，
  // 洞口内部的浅色填充跟着涨回来——"洞在爪子的挖掘动作下恢复"。
  function drawHoleRecovery(canvas, entity, dormant) {
    const progress = holeRepairProgress(entity);
    const index = entity.holeIndex;
    const crater = holeCraterRadius();
    const start = HOLE_DIG_START_ANGLE;
    const tip = start + progress * TWO_PI;
    canvas.save();
    canvas.translate(entity.x, entity.y);

    // 还没挖回来的那一部分缺口：还是那个崩掉的形状，只是越挖越小、越挖越淡
    const remaining = 1 - progress;
    if (remaining > 0.001) {
      canvas.save();
      canvas.globalAlpha *= 0.35 + 0.65 * remaining;
      traceCrater(canvas, index, crater, 1 - 0.32 * progress);
      canvas.fillStyle = dormant ? "rgba(120, 120, 120, 0.1)" : CRATER_FILL;
      canvas.fill();
      canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.4)" : CRATER_RIM;
      canvas.lineWidth = 1.2;
      if (typeof canvas.setLineDash === "function") canvas.setLineDash(HOLE_DASH);
      canvas.stroke();
      if (typeof canvas.setLineDash === "function") canvas.setLineDash([]);
      canvas.fillStyle = dormant ? "rgba(150, 150, 150, 0.35)" : CRATER_SOIL;
      for (let clod = 0; clod < 4; clod += 1) {
        const angle = holeNoise(index, clod + 71) * TWO_PI;
        const distance = crater * (0.5 + 0.6 * holeNoise(index, clod + 81)) * (1 - 0.32 * progress);
        const size = 1.6 + 1.5 * holeNoise(index, clod + 91);
        canvas.save();
        canvas.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
        canvas.rotate(angle);
        canvas.globalAlpha *= dormant ? 0.35 : 0.6;
        roundedRect(canvas, -size / 2, -size / 3, size, size * 0.7, 0.8);
        canvas.fill();
        canvas.strokeStyle = "rgba(63, 37, 16, 0.5)";
        canvas.lineWidth = 0.6;
        canvas.stroke();
        canvas.restore();
      }
      canvas.restore();
    }

    if (progress > 0.001) {
      // 翻出来的松土：堆在虚线圈**外面**，别把正在补的圈盖住
      canvas.strokeStyle = "rgba(120, 76, 38, 0.32)";
      canvas.lineWidth = 3.4;
      canvas.beginPath();
      canvas.arc(0, 0, HOLE_RADIUS * 1.12, start, tip);
      canvas.stroke();

      // 洞口内部（正常洞口那层浅色填充）随进度长回来
      canvas.save();
      canvas.globalAlpha *= progress;
      canvas.fillStyle = dormant ? "rgba(120, 120, 120, 0.08)" : HOLE_FILL;
      canvas.beginPath();
      canvas.arc(0, 0, HOLE_RADIUS, 0, TWO_PI);
      canvas.fill();
      canvas.restore();
    }

    // 虚线圈：从起点补到正在挖的位置
    canvas.strokeStyle = dormant ? "rgba(140, 140, 140, 0.5)" : HOLE_STROKE;
    canvas.lineWidth = 1.2;
    if (progress > 0.001) {
      if (typeof canvas.setLineDash === "function") canvas.setLineDash(HOLE_DASH);
      canvas.beginPath();
      canvas.arc(0, 0, HOLE_RADIUS, start, tip);
      canvas.stroke();
      if (typeof canvas.setLineDash === "function") canvas.setLineDash([]);
    }
    // 正在挖的那一小截是亮的：一眼能看出"修到哪儿了"
    if (progress > 0.001 && progress < 1) {
      canvas.strokeStyle = FRESH_DUG;
      canvas.lineWidth = 2.2;
      canvas.beginPath();
      canvas.arc(0, 0, HOLE_RADIUS, tip - 0.3, tip);
      canvas.stroke();
    }
    canvas.restore();
  }

  // ——洞口的场地状态机——————————————————————————————————
  // intact  ：完整，正常触发木槌。
  // broken  ：被砸塌，只剩缺口；HOLE_REPAIR_DELAY 秒后爪子出现。
  // digging ：地鼠爪子正在刨土，虚线圈一圈一圈补回来；刨满 HOLE_DIG_DURATION 秒复原。
  function cancelDigging(entity) {
    if (entity.clawEffect) {
      entity.clawEffect.visualActive = false;
      entity.clawEffect = null;
    }
    entity.pendingScoops.length = 0;
    entity.phase = "broken";
    // 挖到一半被打断（封印）：爪子缩回地下，缺口重新等满两秒。
    entity.phaseClock = 0;
  }

  // 塌陷本身不是伤害，只是一块场地失效：闷响 + 轻微震屏 + 碎土四散。
  function collapseHole(entity, zoneServices, now, reason) {
    if (entity.phase !== "intact") return false;
    entity.phase = "broken";
    entity.phaseClock = 0;
    entity.brokenAt = now;
    entity.collapseReason = reason;
    entity.crushes += 1;
    // 原来的咬合记录作废：洞口回来时应该重新咬一次。
    entity.latched.clear();
    entity.seen.clear();
    if (typeof zoneServices.shakeArena === "function") {
      zoneServices.shakeArena({ intensity: 4.4, duration: 0.09 });
    }
    if (typeof zoneServices.playBounce === "function") zoneServices.playBounce(1.25);
    zoneServices.spawnParticleBurst({
      x: entity.x,
      y: entity.y,
      count: 16,
      colors: [MALLET_COLOR, "#b07a45", MALLET_EDGE_COLOR, DIRT_PALE],
      shape: "rect",
      minLength: 1.8,
      maxLength: 4.6,
      minWidth: 1,
      maxWidth: 2.4,
      minSpeed: 44,
      maxSpeed: 156,
      minRotationSpeed: -12,
      maxRotationSpeed: 12,
      gravityY: 210,
      drag: 3.2,
      life: 0.5
    });
    zoneServices.spawnParticleBurst({
      x: entity.x,
      y: entity.y,
      count: 12,
      colors: [DIRT_PALE, DIRT_LIGHT, MALLET_COLOR],
      minDiameter: 0.9,
      maxDiameter: 2.4,
      minSpeed: 18,
      maxSpeed: 74,
      drag: 4.4,
      life: 0.6
    });
    return true;
  }

  // 2 秒到点：爪子破土。视效实例只画姿态，相位由洞口自己推进，两者不会跑偏。
  function startDigging(entity, zoneServices, field) {
    entity.phase = "digging";
    entity.phaseClock = 0;
    entity.pendingScoops.length = 0;
    for (let scoop = 0; scoop < HOLE_SCOOP_COUNT; scoop += 1) {
      // 每一下的 55%~72% 是甩土，取 63.5% 作为出土时刻。
      entity.pendingScoops.push({
        at: (HOLE_DIG_DURATION * (scoop + 0.635)) / HOLE_SCOOP_COUNT,
        index: scoop
      });
    }
    const claw = createMoleClawVisual(entity);
    entity.clawEffect = typeof field.spawnFieldVisual === "function"
      ? field.spawnFieldVisual(claw, { lifecycle: "owner-bound" })
      : zoneServices.spawnVisualEffect(claw);
    if (!entity.clawEffect) entity.clawEffect = null;
  }

  function advanceDigging(entity, zoneServices, now) {
    // 每刨完一铲，爪子把土往外甩一把。
    for (let cursor = entity.pendingScoops.length - 1; cursor >= 0; cursor -= 1) {
      const scoop = entity.pendingScoops[cursor];
      if (entity.phaseClock + EPSILON < scoop.at) continue;
      entity.pendingScoops.splice(cursor, 1);
      const angle = holeScoopAngle(scoop.index);
      zoneServices.spawnParticleBurst({
        x: entity.x + Math.cos(angle) * HOLE_CLAW_ORBIT,
        y: entity.y + Math.sin(angle) * HOLE_CLAW_ORBIT,
        count: 10,
        colors: [DIRT_LIGHT, DIRT_PALE, MALLET_COLOR, MALLET_EDGE_COLOR],
        shape: "rect",
        minLength: 1.6,
        maxLength: 4.2,
        minWidth: 1,
        maxWidth: 2.2,
        minSpeed: 60,
        maxSpeed: 172,
        minRotationSpeed: -16,
        maxRotationSpeed: 16,
        directionAngle: angle,
        directionSpread: 1.5,
        gravityY: 230,
        drag: 2.6,
        life: 0.55
      });
    }
    if (entity.phaseClock + EPSILON < HOLE_DIG_DURATION) return;
    // 挖好了：整圈虚线圈回来了，复用触发时那圈奶油色闪光把"复原"点亮一下。
    entity.phase = "intact";
    entity.phaseClock = 0;
    entity.restoredAt = now;
    entity.repairs += 1;
    entity.flashAt = now;
    if (entity.clawEffect) {
      entity.clawEffect.visualActive = false;
      entity.clawEffect = null;
    }
    entity.pendingScoops.length = 0;
    zoneServices.spawnParticleBurst({
      x: entity.x,
      y: entity.y,
      count: 14,
      colors: [DIRT_PALE, DIRT_LIGHT, MALLET_FLASH_COLOR],
      minDiameter: 0.9,
      maxDiameter: 2.4,
      minSpeed: 26,
      maxSpeed: 98,
      drag: 4.2,
      life: 0.55
    });
  }

  // 木槌落到洞口那一帧再放冲击波、木屑和灰尘。
  // 放在相位分支之前结算：洞口就算这一帧被砸塌，已经挥出去的锤子照样要落地。
  function flushHoleImpacts(entity, zoneServices, now) {
    for (let cursor = entity.pendingImpacts.length - 1; cursor >= 0; cursor -= 1) {
      const impact = entity.pendingImpacts[cursor];
      if (now + EPSILON < impact.at) continue;
      entity.pendingImpacts.splice(cursor, 1);
      zoneServices.spawnVisualEffect(createImpactVisual(impact.x, impact.y));
      zoneServices.spawnParticleBurst({
        x: impact.x,
        y: impact.y,
        count: 14,
        colors: [MALLET_COLOR, "#b07a45", MALLET_EDGE_COLOR, DIRT_PALE],
        shape: "rect",
        minLength: 2,
        maxLength: 5.5,
        minWidth: 1.2,
        maxWidth: 2.6,
        minSpeed: 90,
        maxSpeed: 250,
        minRotationSpeed: -14,
        maxRotationSpeed: 14,
        directionAngle: -Math.PI / 2,
        directionSpread: 2.5,
        gravityY: 260,
        drag: 2.4,
        life: 0.5,
        ring: {
          color: "rgba(245, 227, 184, 0.85)",
          lineWidth: 2.5,
          startRadius: 6,
          endRadius: 40
        }
      });
      zoneServices.spawnParticleBurst({
        x: impact.x,
        y: impact.y,
        count: 18,
        colors: [DIRT_PALE, DIRT_LIGHT, MALLET_FLASH_COLOR],
        minDiameter: 0.8,
        maxDiameter: 2.2,
        minSpeed: 30,
        maxSpeed: 110,
        drag: 4.2,
        life: 0.55
      });
    }
  }

  // 以高速度碾过圈边（没被整个捕获）会把洞口撞塌。
  function tryRamCollapse(entity, zoneServices, enemy, distance, now, field) {
    if (entity.phase !== "intact") return false;
    const enemyRadius = Number.isFinite(enemy.radius) ? enemy.radius : 0;
    if (distance > HOLE_RADIUS + enemyRadius) return false;
    const speed = Math.hypot(enemy.vx, enemy.vy);
    if (!Number.isFinite(speed) || speed < HOLE_RAM_SPEED) return false;
    // 全场节流：地面塌过一次之后需要时间沉降，9 个洞不会同时被扫平。
    if (typeof field.canRamCollapse === "function" && !field.canRamCollapse(now)) return false;
    if (typeof field.noteRamCollapse === "function") field.noteRamCollapse(now);
    collapseHole(entity, zoneServices, now, "ram");
    return true;
  }

  // 一个洞口 = 一个独立场地实体：自己每帧判断、自己出伤、自己画虚线圆。
  // 本体的眩晕 / 封印都不会影响它——场地攻击是第三方攻击。
  // field：本体侧借来的只读能力查询、场地级节流与视效落点（见 createBehavior）。
  // revive：补种用。外力（钢卷那类"弱质第三方实体直接销毁"）会把场地实体整个
  // 抹掉，那种情况下实体自己没机会走"塌了→2 秒→刨回来"的分支，所以补种出来的
  // 洞口直接从 broken 起算，并把原来那块地的计数接过来。
  function createHoleZone(hole, index, field = {}, revive = null) {
    return {
      kind: HOLE_ENTITY_KIND,
      combatKind: HOLE_COMBAT_KIND,
      life: Number.MAX_SAFE_INTEGER,
      drawLayer: "background",
      x: hole.x,
      y: hole.y,
      radius: HOLE_RADIUS,
      holeIndex: index,
      latched: new Set(),
      // 敌方上一帧的位置：实体在球的积分之后才更新，引擎的 prevX 那时已经被
      // 覆盖，所以扫掠判定要自己记一份。
      seen: new Map(),
      flashAt: Number.NEGATIVE_INFINITY,
      pendingImpacts: [],
      whacks: revive ? revive.whacks : 0,
      // 场地修复状态。补种时那 2 秒的等待已经由本体替它等完了（被抹掉的实体
      // 自己没机会计时），所以 phaseClock 直接顶到 HOLE_REPAIR_DELAY：
      // 它下一帧就会进 digging，爪子照样从土里钻出来刨。
      phase: revive ? "broken" : "intact",
      phaseClock: revive ? HOLE_REPAIR_DELAY : 0,
      brokenAt: revive ? revive.destroyedAt : Number.NEGATIVE_INFINITY,
      restoredAt: revive ? revive.restoredAt : Number.NEGATIVE_INFINITY,
      collapseReason: revive ? "destroyed" : null,
      // 补种算它又塌了一次：这块地确实是被碾掉的。
      crushes: revive ? revive.crushes + 1 : 0,
      repairs: revive ? revive.repairs : 0,
      pendingScoops: [],
      clawEffect: null,
      update({ entity, services: zoneServices, game }, dt) {
        // 本体被白蛇 DISC 封印时，场地一起休眠：不触发、不挥锤。
        const owner = zoneServices.getBall(entity.ownerInstanceId);
        entity.dormant = ownerIsSealed(owner, game.time);
        if (entity.dormant) {
          // 休眠期间整块场地停摆：挖到一半的爪子缩回地下，缺口解封后重新计时。
          if (entity.phase === "digging") cancelDigging(entity);
          return;
        }
        entity.phaseClock += dt;
        flushHoleImpacts(entity, zoneServices, game.time);
        if (entity.phase === "digging") {
          advanceDigging(entity, zoneServices, game.time);
          return;
        }
        if (entity.phase === "broken") {
          // 缺口期不触发、不出伤，只在 2 秒到点时把地鼠爪子叫上来。
          if (entity.phaseClock >= HOLE_REPAIR_DELAY) startDigging(entity, zoneServices, field);
          return;
        }
        // 触发判定：敌方本体整个进入圆内，或大到覆盖整个圆。
        const inside = new Set();
        const visited = new Set();
        zoneServices.forEachEnemy((enemy) => {
          if (!enemy || enemy.hp <= 0) return;
          const key = enemy.instanceId;
          const captureRadius = whackAMoleCaptureRadius(enemy.radius);
          const previous = entity.seen.get(key);
          const startX = previous ? previous.x : enemy.x;
          const startY = previous ? previous.y : enemy.y;
          entity.seen.set(key, { x: enemy.x, y: enemy.y });
          visited.add(key);
          const distance = pointSegmentDistance(
            startX,
            startY,
            enemy.x,
            enemy.y,
            entity.x,
            entity.y
          );
          if (distance > captureRadius) {
            // 没被整个捕获，但身体确实碾过圈边：速度够高就把这块地撞塌。
            tryRamCollapse(entity, zoneServices, enemy, distance, game.time, field);
            return;
          }
          inside.add(key);
          if (entity.latched.has(key)) return;
          entity.latched.add(key);
          entity.whacks += 1;
          entity.flashAt = game.time;
          zoneServices.dealDamage(enemy, WHACK_DAMAGE);
          zoneServices.applyEffect(enemy, createWhackStun());
          zoneServices.spawnVisualEffect(createMalletVisual(entity.x, entity.y));
          entity.pendingImpacts.push({
            at: game.time + MALLET_SWING_DURATION,
            x: entity.x,
            y: entity.y
          });
          // 锤子照砸（伤害与眩晕都发出去了），但目标不吃控制（钢卷这类
          // getCapabilityOverrides 顶掉行为暂停）：它硬扛着走开，洞口被碾塌。
          const capabilities = typeof field.readCapabilities === "function"
            ? field.readCapabilities(enemy)
            : null;
          if (capabilities && capabilities.canAct === true) {
            collapseHole(entity, zoneServices, game.time, "trample");
          }
        });
        for (const key of entity.latched) {
          if (!inside.has(key)) entity.latched.delete(key);
        }
        for (const key of entity.seen.keys()) {
          if (!visited.has(key)) entity.seen.delete(key);
        }

      },
      draw({ entity, game }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const flash = Number.isFinite(entity.flashAt)
          ? 1 - clamp((game.time - entity.flashAt) / HOLE_FLASH_DURATION, 0, 1)
          : 0;
        canvas.save();
        // 休眠（被 DISC 封印）时洞口画得发灰发暗，一眼能看出场地停了。
        if (entity.dormant) canvas.globalAlpha *= 0.45;
        // 塌掉的洞只剩缺口；修复中的洞是"缺口 + 正在补回来的虚线圈"。
        if (entity.phase === "broken") {
          drawHoleCrater(canvas, entity, entity.dormant === true);
          canvas.restore();
          return;
        }
        if (entity.phase === "digging") {
          drawHoleRecovery(canvas, entity, entity.dormant === true);
          canvas.restore();
          return;
        }
        if (entity.dormant) {
          canvas.fillStyle = "rgba(120, 120, 120, 0.08)";
          canvas.strokeStyle = "rgba(140, 140, 140, 0.5)";
        } else {
          canvas.fillStyle = HOLE_FILL;
          canvas.strokeStyle = HOLE_STROKE;
        }
        canvas.lineWidth = 1.2;
        if (typeof canvas.setLineDash === "function") canvas.setLineDash(HOLE_DASH);
        canvas.beginPath();
        canvas.arc(entity.x, entity.y, HOLE_RADIUS, 0, TWO_PI);
        canvas.fill();
        canvas.stroke();
        if (flash > 0) {
          canvas.fillStyle = "rgba(245, 227, 184, " + (0.22 * flash).toFixed(3) + ")";
          canvas.beginPath();
          canvas.arc(entity.x, entity.y, HOLE_RADIUS, 0, TWO_PI);
          canvas.fill();
          canvas.strokeStyle = "rgba(245, 227, 184, " + (0.95 * flash).toFixed(3) + ")";
          canvas.lineWidth = 1.2 + 1.8 * flash;
          if (typeof canvas.setLineDash === "function") canvas.setLineDash([]);
          canvas.beginPath();
          canvas.arc(entity.x, entity.y, HOLE_RADIUS, 0, TWO_PI);
          canvas.stroke();
          canvas.strokeStyle = "rgba(245, 227, 184, " + (0.5 * flash).toFixed(3) + ")";
          canvas.lineWidth = 1.6;
          canvas.beginPath();
          canvas.arc(entity.x, entity.y, HOLE_RADIUS + (1 - flash) * 14, 0, TWO_PI);
          canvas.stroke();
        }
        if (typeof canvas.setLineDash === "function") canvas.setLineDash([]);
        canvas.restore();
      }
    };
  }

  const whackAMoleDefinition = {
    id: "whackAMole",
    name: "打地鼠",
    englishName: "Whack-a-Mole",
    color: MALLET_COLOR,
    description: "场地系 / 9 个虚线圆 / 敌方完全进入或被完全覆盖即触发 / 木槌：7 伤害 + 1 秒颤抖眩晕（期间减速 50%）/ 洞口被碾塌后 2 秒，地鼠爪子刨土把它挖回来",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let zones = [];
      // 场地级节流：洞口被高速撞塌之后地面需要时间沉降，否则一颗高速球
      // 可以把 9 个洞一次扫平。洞口自己的加固期另外算。
      let ramCollapseReadyAt = Number.NEGATIVE_INFINITY;
      // 洞口实体问不到 getCapabilities（实体服务没有这项只读查询），
      // 所以本体侧借一个查询函数给它们；不参与出伤归属，只是读能力位。
      const readCapabilities = typeof services.getCapabilities === "function"
        ? (target) => services.getCapabilities(target)
        : null;
      // 爪子的视效要挂在球体层之上（和木槌同一层），并且要跟着本体一起消失。
      const spawnFieldVisual = typeof services.spawnVisualEffect === "function"
        ? (definition, overrides) => services.spawnVisualEffect(definition, overrides)
        : null;
      const field = {
        readCapabilities,
        spawnFieldVisual,
        canRamCollapse(now) {
          return now >= ramCollapseReadyAt;
        },
        noteRamCollapse(now) {
          ramCollapseReadyAt = now + HOLE_RAM_COOLDOWN;
        }
      };

      // 场地实体的生命周期跟着本体：本体退场（死亡 / Rion 借用结束）就撤掉。
      // 但本体的眩晕、封印不影响它们——攻击来自场地本身。
      let fieldRetired = false;
      // 被外力整个抹掉的洞口：槽位 → 可以补种的时刻。实体自己已经没了，
      // 那 2 秒的等待只能记在本体这边。
      const replantAt = new Map();

      function ensureZones(context) {
        if (fieldRetired) return;
        if (!context || !context.game) return;
        const positions = whackAMoleHolePositions(context.game);
        if (zones.length === 0) {
          ramCollapseReadyAt = Number.NEGATIVE_INFINITY;
          replantAt.clear();
          zones = positions.map((hole, index) => services.spawnCombatEntity(
            createHoleZone(hole, index, field),
            { lifecycle: "owner-bound" }
          ));
          return;
        }
        const now = Number.isFinite(context.game.time) ? context.game.time : 0;
        // 钢卷那类"弱质第三方实体直接销毁"会把场地实体整个抹掉：实体当场
        // entityActive=false，根本没机会走自己那条 broken → 2 秒 → 刨土的分支。
        // 于是本体替它守着这块地：等满 HOLE_REPAIR_DELAY 秒再原样补种一块，
        // 补种出来的那一下正好接上"地鼠爪子把它挖回来"。
        for (let index = 0; index < positions.length; index += 1) {
          const zone = zones[index];
          if (zone && zone.entityActive !== false) {
            replantAt.delete(index);
            continue;
          }
          const readyAt = replantAt.get(index);
          if (readyAt === undefined) {
            replantAt.set(index, now + HOLE_REPAIR_DELAY);
            continue;
          }
          if (now + EPSILON < readyAt) continue;
          replantAt.delete(index);
          const revive = zone
            ? Object.assign({}, zone, { destroyedAt: now })
            : null;
          zones[index] = services.spawnCombatEntity(
            createHoleZone(positions[index], index, field, revive),
            { lifecycle: "owner-bound" }
          );
        }
      }

      function despawnZones() {
        fieldRetired = true;
        replantAt.clear();
        for (const zone of zones) {
          if (zone) zone.entityActive = false;
        }
        zones = [];
      }

      function liveZones() {
        return zones.filter((zone) => zone && zone.entityActive !== false);
      }

      // 场地实体在第一次 update 时才铺开：onSpawn 时引擎的 arenaSize 还是
      // 模式默认值，可能和最终战场不一致（Rion 借用时也不会触发 onSpawn）。
      return {
        update(context) {
          ensureZones(context);
        },
        updateWhilePaused(context) {
          ensureZones(context);
        },
        afterUpdateStep(context) {
          ensureZones(context);
        },
        afterUpdateStepWhilePaused(context) {
          ensureZones(context);
        },
        onDeath() {
          despawnZones();
        },
        onBorrowEnd() {
          despawnZones();
        },
        getWhackAMoleState(context) {
          const now = context && context.game && Number.isFinite(context.game.time)
            ? context.game.time
            : 0;
          const active = liveZones();
          let whacks = 0;
          let flashingHoles = 0;
          let pendingImpacts = 0;
          let brokenHoles = 0;
          let diggingHoles = 0;
          let crushes = 0;
          let repairs = 0;
          for (const zone of active) {
            whacks += zone.whacks;
            crushes += zone.crushes;
            repairs += zone.repairs;
            pendingImpacts += zone.pendingImpacts.length;
            if (zone.phase === "broken") brokenHoles += 1;
            if (zone.phase === "digging") diggingHoles += 1;
            if (now - zone.flashAt < HOLE_FLASH_DURATION) flashingHoles += 1;
          }
          return {
            holeCount: active.length,
            holeDiameter: HOLE_DIAMETER,
            whacks,
            latched: active.reduce((total, zone) => total + zone.latched.size, 0),
            pendingImpacts,
            flashingHoles,
            damage: WHACK_DAMAGE,
            stunDuration: WHACK_STUN_DURATION,
            slowFactor: WHACK_SLOW_FACTOR,
            // 场地修复状态：缺口几个、正在刨的几个、一共塌了几次、修好几回。
            brokenHoles,
            diggingHoles,
            crushes,
            repairs,
            repairDelay: HOLE_REPAIR_DELAY,
            digDuration: HOLE_DIG_DURATION,
            scoopCount: HOLE_SCOOP_COUNT,
            ramSpeed: HOLE_RAM_SPEED
          };
        }
      };
    }
  };

  registerBall(whackAMoleDefinition);
  return {
    whackAMoleDefinition,
    whackAMoleHolePositions,
    whackAMoleCaptureRadius,
    createWhackStun,
    createMalletVisual,
    createImpactVisual,
    createHoleZone,
    createMoleClawVisual,
    drawMoleClaw,
    holeCraterRadius,
    holeScoopAngle,
    holeScoopIndex,
    holeScoopPose,
    holeRepairProgress,
    collapseHole,
    startDigging,
    advanceDigging,
    flushHoleImpacts,
    tryRamCollapse,
    WHACK_A_MOLE_HOLE_REPAIR_DELAY: HOLE_REPAIR_DELAY,
    WHACK_A_MOLE_HOLE_DIG_DURATION: HOLE_DIG_DURATION,
    WHACK_A_MOLE_HOLE_SCOOP_COUNT: HOLE_SCOOP_COUNT,
    WHACK_A_MOLE_HOLE_BULGE_LEAD: HOLE_BULGE_LEAD,
    WHACK_A_MOLE_HOLE_RAM_SPEED: HOLE_RAM_SPEED,
    WHACK_A_MOLE_HOLE_RAM_COOLDOWN: HOLE_RAM_COOLDOWN,
    WHACK_A_MOLE_HOLE_CLAW_KIND: HOLE_CLAW_KIND,
    WHACK_A_MOLE_HOLE_CLAW_ORBIT: HOLE_CLAW_ORBIT,
    WHACK_A_MOLE_MOLE_FUR: MOLE_FUR,
    WHACK_A_MOLE_COLOR: MALLET_COLOR,
    WHACK_A_MOLE_HOLE_DIAMETER: HOLE_DIAMETER,
    WHACK_A_MOLE_HOLE_ENTITY_KIND: HOLE_ENTITY_KIND,
    WHACK_A_MOLE_HOLE_COMBAT_KIND: HOLE_COMBAT_KIND,
    WHACK_A_MOLE_DAMAGE: WHACK_DAMAGE,
    WHACK_A_MOLE_STUN_DURATION: WHACK_STUN_DURATION,
    WHACK_A_MOLE_SLOW_FACTOR: WHACK_SLOW_FACTOR,
    WHACK_A_MOLE_SWING_DURATION: MALLET_SWING_DURATION,
    WHACK_A_MOLE_HOLE_FLASH_DURATION: HOLE_FLASH_DURATION
  };
});
