(function initializeSoundSpear(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("./fear-wave.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSoundSpearPlugin({ resolveArenaGeometry, registerBall, createFearWave }) {
  // 银灰纯色本体 + 手持银色长矛。
  // 武器几何照长矛：长度 35 按需求短 3 点 → 32，握把/后座/矛尖比例与侧挂偏移不变。
  const SPEAR_LENGTH = 32;
  const SPEAR_BUTT_LENGTH = 13;
  const SPEAR_BUTT_TIP_LENGTH = 4;
  const SPEAR_TIP_LENGTH = 8;
  const SPEAR_TIP_RADIUS = 3;
  const IDLE_SIDE_OFFSET = 19;
  const THRUST_DISTANCE = 21;
  // 戳击动作本身仍是黄瓜同款快戳（0.4 秒），收招后另有 0.4 秒冷却 → 近战周期 0.8 秒。
  const THRUST_DURATION = 0.4;
  const THRUST_COOLDOWN = 0.4;
  const STAB_DAMAGE = 3;
  // 同一次戳击内不重复命中同一目标（跨次戳击由 0.8 秒周期自然隔开）。
  const STAB_HIT_INTERVAL = 0.4;
  // 够不到敌人时按黄瓜的节奏投矛（出手动作从计时阈值里扣掉）。
  const THROW_INTERVAL = 1.5;
  const WINDUP_DURATION = 0.42;
  const RELEASE_DURATION = 0.16;
  const REGROW_DURATION = 0.3;
  const RELEASE_POINT = 0.42;
  const PULL_BACK_DISTANCE = 32;
  const RELEASE_EXTEND = 28;
  const WINDUP_TILT = 0.55;
  const THROW_WINDUP_LEAD = WINDUP_DURATION + RELEASE_POINT * RELEASE_DURATION;
  const THROW_CYCLE_LEAD = WINDUP_DURATION + RELEASE_DURATION;
  const FIRST_THROW_TRIGGER_AT = THROW_INTERVAL - THROW_WINDUP_LEAD;
  const REPEAT_THROW_TRIGGER_AT = THROW_INTERVAL - THROW_CYCLE_LEAD;
  const THROW_DAMAGE = 2;
  const PROJECTILE_SPEED = 250;
  const PROJECTILE_RADIUS = 5;
  // 扎住的矛需要敌方命中 2 次才消失：计的是"攻击次数"，不是伤害量。
  const SPEAR_BREAK_HITS = 2;
  const INSERT_DEPTH = 6;
  const SPAN = SPEAR_LENGTH + SPEAR_BUTT_LENGTH + SPEAR_BUTT_TIP_LENGTH;
  const HALF_SPAN = SPAN / 2;
  const GRIP_FROM_CENTER = (SPEAR_LENGTH - SPEAR_BUTT_LENGTH - SPEAR_BUTT_TIP_LENGTH) / 2;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const TWO_PI = Math.PI * 2;
  const EPSILON = 1e-9;

  const BODY_COLOR = "#c2c7cc";
  const GRIP_COLOR = "#4a5057";
  const SHAFT_COLOR = "#aab3ba";
  const BUTT_COLOR = "#dfe5e9";
  const BUTT_EDGE = "#767f86";
  const COLLAR_COLOR = "#e8edf1";
  const TIP_COLOR = "#f3f7f9";
  const TIP_EDGE = "#848d94";
  const GLINT_COLOR = "#f6fbfd";
  const SPARK_COLORS = ["#f3f7f9", "#ccd4da", "#9aa4ac", "#ffffff"];
  const SHATTER_COLORS = ["#f3f7f9", "#d5dde2", "#b3bcc3", "#ffffff"];

  const THROWN_ID = "sound-spear-thrown";
  const WAVE_KIND = "sound-spear-wave";
  // 碰墙齐射的可视化（走引擎统一的 visual effect 通道）。
  const WALL_RESONANCE_KIND = "sound-spear-wall-resonance";
  const SPEAR_RESONANCE_KIND = "sound-spear-resonance";
  const RESONANCE_COLOR = "#f2f7fa";
  const RESONANCE_EDGE = "#9fb0bb";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalize(x, y, fallbackX = 1, fallbackY = 0) {
    let length = Math.hypot(x, y);
    if (length <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      length = Math.hypot(x, y) || 1;
    }
    return { x: x / length, y: y / length };
  }

  function angleDifference(target, current) {
    let difference = target - current;
    while (difference > Math.PI) difference -= TWO_PI;
    while (difference < -Math.PI) difference += TWO_PI;
    return difference;
  }

  // 指数逼近：任何相位切换都从当前值出发，动作不会跳变。
  function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
  }

  function thrustPulse(elapsed, duration = THRUST_DURATION) {
    const progress = clamp(elapsed / duration, 0, 1);
    const sine = Math.sin(Math.PI * progress);
    return sine * sine;
  }

  function easeInQuad(value) {
    return value * value;
  }

  function easeOutCubic(value) {
    const inverse = 1 - value;
    return 1 - inverse * inverse * inverse;
  }

  function smoothStep(value) {
    return value * value * (3 - 2 * value);
  }

  // 矛尖（搬运中的圆点）与目标之间的扫掠接触，与长矛/黄瓜同一套几何。
  function movingTipContact(previousTip, currentTip, target) {
    const targetStartX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const targetStartY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const startX = previousTip.x - targetStartX;
    const startY = previousTip.y - targetStartY;
    const endX = currentTip.x - target.x;
    const endY = currentTip.y - target.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(-(startX * deltaX + startY * deltaY) / lengthSquared, 0, 1);
    const relativeX = startX + deltaX * progress;
    const relativeY = startY + deltaY * progress;
    const distance = Math.hypot(relativeX, relativeY);
    if (distance <= EPSILON) {
      const fallback = normalize(target.x - currentTip.x, target.y - currentTip.y);
      return { distance, normalX: fallback.x, normalY: fallback.y };
    }
    return { distance, normalX: -relativeX / distance, normalY: -relativeY / distance };
  }

  function resolveTipCollision(entity, target, contact, game, owner) {
    const minimumDistance = target.radius + SPEAR_TIP_RADIUS;
    const deltaX = target.x - entity.x;
    const deltaY = target.y - entity.y;
    const currentDistance = Math.hypot(deltaX, deltaY);
    if (currentDistance < minimumDistance && !target.positionLocked && !target.movementLocked) {
      const normal = currentDistance <= EPSILON
        ? { x: contact.normalX, y: contact.normalY }
        : { x: deltaX / currentDistance, y: deltaY / currentDistance };
      const { x: nextX, y: nextY } = resolveArenaGeometry(game).clampPoint(entity.x + normal.x * minimumDistance, entity.y + normal.y * minimumDistance, target.radius);
      // 矛尖只把人往外顶，绝不往回勾：收矛时矛尖从敌人身上抽走，
      // 不能把敌人一路带回本体怀里。
      const distanceBeforeOwner = owner
        ? Math.hypot(target.x - owner.x, target.y - owner.y)
        : Infinity;
      const distanceAfterOwner = owner
        ? Math.hypot(nextX - owner.x, nextY - owner.y)
        : Infinity;
      if (distanceAfterOwner + EPSILON >= distanceBeforeOwner) {
        target.x = nextX;
        target.y = nextY;
      }
    }
    if (target.positionLocked || target.movementLocked) return;
    const tipVx = Number.isFinite(entity.vx) ? entity.vx : 0;
    const tipVy = Number.isFinite(entity.vy) ? entity.vy : 0;
    const relativeNormal =
      (target.vx - tipVx) * contact.normalX +
      (target.vy - tipVy) * contact.normalY;
    if (relativeNormal >= -EPSILON) return;
    const reflectedX = target.vx - relativeNormal * 2 * contact.normalX;
    const reflectedY = target.vy - relativeNormal * 2 * contact.normalY;
    const reflected = normalize(reflectedX, reflectedY, contact.normalX, contact.normalY);
    const activeSpeed = Math.hypot(target.vx, target.vy);
    const storedSpeed = Math.hypot(target.storedVx, target.storedVy);
    target.vx = reflected.x * activeSpeed;
    target.vy = reflected.y * activeSpeed;
    target.storedVx = reflected.x * storedSpeed;
    target.storedVy = reflected.y * storedSpeed;
  }

  // 长矛的几何：grip 起点 + 沿方向 length，握把偏移写在瞄准坐标系里
  // （forward 沿矛指向、side 垂直于它）。scale=1 时与长矛逐位同形，只是短 3。
  function spearGeometry(ball, angle, forward, side, scale = 1) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const perpX = directionY;
    const perpY = -directionX;
    const grip = {
      x: ball.x + directionX * forward + perpX * side,
      y: ball.y + directionY * forward + perpY * side
    };
    const base = {
      x: grip.x - directionX * SPEAR_BUTT_LENGTH * scale,
      y: grip.y - directionY * SPEAR_BUTT_LENGTH * scale
    };
    const buttTip = {
      x: base.x - directionX * SPEAR_BUTT_TIP_LENGTH * scale,
      y: base.y - directionY * SPEAR_BUTT_TIP_LENGTH * scale
    };
    const spearLength = SPEAR_LENGTH * scale;
    const tipLength = SPEAR_TIP_LENGTH * scale;
    return {
      grip,
      base,
      buttTip,
      shaftEnd: {
        x: grip.x + directionX * (spearLength - tipLength),
        y: grip.y + directionY * (spearLength - tipLength)
      },
      tip: {
        x: grip.x + directionX * spearLength,
        y: grip.y + directionY * spearLength
      },
      directionX,
      directionY,
      angle
    };
  }

  // 扎住的矛：以矛身中点为锚算几何，尖端仍落在 tip 一侧。
  function anchoredGeometry(x, y, angle) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    return spearGeometry(
      { x: x - directionX * GRIP_FROM_CENTER, y: y - directionY * GRIP_FROM_CENTER },
      angle,
      0,
      0
    );
  }

  // 银灰长矛：杆、后座、接环、矛尖四段，配色换成银色系，几何与长矛一致。
  function drawSpearShape(canvasContext, geometry, attackBlend, time, scale = 1) {
    const { grip, base, buttTip, shaftEnd, tip, directionX, directionY } = geometry;
    const normalX = -directionY;
    const normalY = directionX;
    const halfButt = 2.8 * scale;
    const halfCollar = 2 * scale;
    const halfTip = 4.2 * scale;

    canvasContext.save();
    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";

    canvasContext.strokeStyle = GRIP_COLOR;
    canvasContext.lineWidth = 5 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(base.x, base.y);
    canvasContext.lineTo(shaftEnd.x, shaftEnd.y);
    canvasContext.stroke();

    canvasContext.fillStyle = BUTT_COLOR;
    canvasContext.strokeStyle = BUTT_EDGE;
    canvasContext.lineWidth = 1 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(buttTip.x, buttTip.y);
    canvasContext.lineTo(base.x + normalX * halfButt, base.y + normalY * halfButt);
    canvasContext.lineTo(base.x - normalX * halfButt, base.y - normalY * halfButt);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.strokeStyle = SHAFT_COLOR;
    canvasContext.lineWidth = 3 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(base.x, base.y);
    canvasContext.lineTo(shaftEnd.x, shaftEnd.y);
    canvasContext.stroke();

    canvasContext.strokeStyle = COLLAR_COLOR;
    canvasContext.lineWidth = 1.2 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(grip.x + normalX * halfCollar, grip.y + normalY * halfCollar);
    canvasContext.lineTo(grip.x - normalX * halfCollar, grip.y - normalY * halfCollar);
    canvasContext.stroke();

    canvasContext.fillStyle = TIP_COLOR;
    canvasContext.strokeStyle = TIP_EDGE;
    canvasContext.lineWidth = 1 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(tip.x, tip.y);
    canvasContext.lineTo(shaftEnd.x + normalX * halfTip, shaftEnd.y + normalY * halfTip);
    canvasContext.lineTo(shaftEnd.x - normalX * halfTip, shaftEnd.y - normalY * halfTip);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    // 出手时的一点冷光，不改变几何，也不留常驻光晕。
    if (attackBlend > 0.08) {
      canvasContext.globalAlpha = 0.3 + 0.2 * Math.sin(time * 24);
      canvasContext.strokeStyle = GLINT_COLOR;
      canvasContext.lineWidth = 1 * scale;
      canvasContext.beginPath();
      canvasContext.moveTo(
        grip.x + directionX * 8 * scale + normalX * 5 * scale,
        grip.y + directionY * 8 * scale + normalY * 5 * scale
      );
      canvasContext.lineTo(
        shaftEnd.x + normalX * 5 * scale,
        shaftEnd.y + normalY * 5 * scale
      );
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function stabReach() {
    return THRUST_DISTANCE + SPEAR_LENGTH + SPEAR_TIP_RADIUS;
  }

  function spawnSonicWave(services, x, y) {
    // 音波几何与伤害分档完全复用佳代子（Qin 也是同一条路径）。
    services.spawnCombatEntity(createFearWave({ x, y }, { kind: WAVE_KIND }));
  }

  function createShatterBurst(services, x, y, angle) {
    services.spawnParticleBurst({
      x,
      y,
      count: 16,
      colors: SHATTER_COLORS,
      shape: "rect",
      minLength: 3,
      maxLength: 8,
      minWidth: 1.5,
      maxWidth: 3.5,
      minSpeed: 60,
      maxSpeed: 230,
      minRotationSpeed: -14,
      maxRotationSpeed: 14,
      directionAngle: angle,
      directionSpread: 2.4,
      drag: 3.4,
      life: 0.45
    });
  }

  // —— 碰墙齐射的可视化 ——
  // 碰墙本身在引擎里是无声无画的，观众看到"所有矛突然一起发声波"会不知道是谁触发的。
  // 这里补两个视觉效果（都用 services.spawnVisualEffect 这条统一通道）：
  //   ① 撞墙点：一声"轰鸣" —— 沿墙面拉开的共鸣弧 + 放射碎片 + 一次轻微板震，
  //      把"音波是被这次撞击唤醒的"讲清楚；
  //   ② 每根被唤醒的矛：沿矛身扫过的一道白光 + 一圈小共鸣环，和音波同一帧出现，
  //      让观众看见"根根矛都在响"。

  // 共鸣分两层画：① 以本体为中心的冲击波（告诉观众"这里出事了"）；
  // ② 贴在这次撞上的那面墙上的共振弧（告诉观众"撞的是墙"）。
  // 贴墙那层往场内退几像素，完全贴边会被裁掉一半、又被本体盖住。
  function wallResonancePlacement(ball, arenaSize, bouncedX, bouncedY) {
    if (arenaSize && typeof arenaSize === "object") {
      const arena = resolveArenaGeometry(arenaSize);
      const dx = ball.x - arena.centerX, dy = ball.y - arena.centerY;
      const length = Math.hypot(dx, dy) || 1;
      const hit = arena.traceSegment(ball.x, ball.y, ball.x + dx / length * arena.size * 2, ball.y + dy / length * arena.size * 2);
      const point = hit ? arena.clampPoint(hit.x + hit.normalX * 6, hit.y + hit.normalY * 6) : ball;
      return { x: ball.x, y: ball.y, wallX: point.x, wallY: point.y, stretchX: bouncedX ? 0.5 : 1, stretchY: bouncedY ? 0.5 : 1 };
    }
    const mid = arenaSize / 2;
    const inset = 6;
    const x = ball.x;
    const y = ball.y;
    if (bouncedX && bouncedY) {
      return {
        x,
        y,
        wallX: x <= mid ? inset : arenaSize - inset,
        wallY: y <= mid ? inset : arenaSize - inset,
        stretchX: 0.5,
        stretchY: 0.5
      };
    }
    if (bouncedX) {
      // 竖直墙：贴墙那层沿 x 压扁，声波贴着墙面朝 y 方向散开。
      return {
        x,
        y,
        wallX: x <= mid ? inset : arenaSize - inset,
        wallY: y,
        stretchX: 0.5,
        stretchY: 1
      };
    }
    if (bouncedY) {
      return {
        x,
        y,
        wallX: x,
        wallY: y <= mid ? inset : arenaSize - inset,
        stretchX: 1,
        stretchY: 0.5
      };
    }
    return { x, y, wallX: x, wallY: y, stretchX: 1, stretchY: 1 };
  }

  function createWallResonance(ball, arenaSize, bouncedX, bouncedY) {
    const placement = wallResonancePlacement(ball, arenaSize, bouncedX, bouncedY);
    // 贴体亮环要顺着本体半径走；这一层画在所有球之后，环内必须留空，
    // 否则实心亮核会把本体中心的血量数字整个盖掉。
    const bodyRadius = Number.isFinite(ball && ball.radius) ? ball.radius : 15;
    return {
      kind: WALL_RESONANCE_KIND,
      life: 0.55,
      x: placement.x,
      y: placement.y,
      radius: bodyRadius,
      wallX: placement.wallX,
      wallY: placement.wallY,
      stretchX: placement.stretchX,
      stretchY: placement.stretchY,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = Math.pow(1 - progress, 1.5);
        context.save();
        context.globalCompositeOperation = "lighter";

        // ① 冲击波：本体那里炸开的两圈大环，把这一下推到观众眼前。
        for (let index = 0; index < 2; index += 1) {
          const spread = clamp(progress * 1.5 - index * 0.22, 0, 1);
          if (spread <= 0 || spread >= 0.999) continue;
          const radius = 16 + spread * 116;
          context.globalAlpha = fade * (1 - spread) * (index === 0 ? 0.9 : 0.42);
          context.strokeStyle = index === 0 ? RESONANCE_COLOR : RESONANCE_EDGE;
          context.lineWidth = Math.max(0.8, (3.2 - spread * 2.4) * (index === 0 ? 1 : 0.7));
          context.beginPath();
          context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
          context.stroke();
        }

        // ② 贴墙的共振弧：中心在墙面内侧，沿墙面方向拉开。
        context.save();
        context.translate(effect.wallX, effect.wallY);
        context.scale(effect.stretchX, effect.stretchY);
        for (let index = 0; index < 3; index += 1) {
          const spread = clamp(progress * 2 - index * 0.18, 0, 1);
          if (spread <= 0 || spread >= 0.999) continue;
          const radius = 12 + spread * 92;
          context.globalAlpha = fade * (1 - spread) * (index === 0 ? 0.85 : 0.45);
          context.strokeStyle = index === 0 ? RESONANCE_COLOR : RESONANCE_EDGE;
          context.lineWidth = Math.max(0.8, (2.8 - spread * 2) * (index === 0 ? 1 : 0.7));
          context.beginPath();
          context.arc(0, 0, radius, 0, Math.PI * 2);
          context.stroke();
        }
        context.restore();

        // ③ 贴着球体的亮环：这一下的"起爆感"。原本是实心亮核，但它画在所有球之后，
        //    会把本体中心的血量数字整个盖住——改成贴着球面的一圈环，观感一样炸，血量还看得见。
        const flash = Math.pow(1 - progress, 2.4);
        if (flash > 0.01) {
          const bodyRadius = Number.isFinite(effect.radius) ? effect.radius : 15;
          context.globalAlpha = flash * 0.9;
          context.strokeStyle = RESONANCE_COLOR;
          context.lineWidth = 1.2 + flash * 2.8;
          context.beginPath();
          context.arc(effect.x, effect.y, bodyRadius + 1 + flash * 3, 0, Math.PI * 2);
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createSpearResonance(x, y, angle, span) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const half = (Number.isFinite(span) ? span : SPAN) * 0.5;
    return {
      kind: SPEAR_RESONANCE_KIND,
      life: 0.34,
      x,
      y,
      angle,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = Math.pow(1 - progress, 1.7);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        // 沿矛身扫过一遍的白光：观众能直接看出"是这根矛在响"。
        const sweep = Math.sin(Math.PI * progress);
        context.globalAlpha = fade * Math.min(1, sweep * 1.9) * 0.9;
        context.strokeStyle = RESONANCE_COLOR;
        context.lineWidth = 3.4;
        context.beginPath();
        context.moveTo(x - directionX * half, y - directionY * half);
        context.lineTo(x + directionX * half, y + directionY * half);
        context.stroke();
        // 再叠一圈很快扩散的小共鸣环。
        const radius = 5 + progress * 24;
        context.globalAlpha = fade * 0.5;
        context.strokeStyle = RESONANCE_EDGE;
        context.lineWidth = Math.max(0.6, 2 - progress * 1.3);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  // 撞墙点的碎屑：跟着共鸣一起迸出来，强化"撞击"这一下。
  function spawnWallResonanceDebris(services, placement) {
    services.spawnParticleBurst({
      x: placement.x,
      y: placement.y,
      count: 12,
      colors: SPARK_COLORS,
      shape: "rect",
      minLength: 2,
      maxLength: 6,
      minWidth: 0.8,
      maxWidth: 2,
      minSpeed: 40,
      maxSpeed: 170,
      minRotationSpeed: -12,
      maxRotationSpeed: 12,
      drag: 3.6,
      life: 0.4
    });
  }

  // 投出的矛：三种状态共用同一个召唤物 —— flying 直飞 / impaled 扎在敌人身上
  // / anchored 扎在板边上，后两者保留下来并被敌方攻击，命中 2 次后碎裂。
  function createThrownSpearDefinition(ownerServices, launch) {
    return {
      id: THROWN_ID,
      name: "投出的音矛",
      englishName: "Thrown Sound Spear",
      color: TIP_COLOR,
      description: "扎住的银色长矛 / 被攻击两次后碎裂",
      // 渲染器先画 drawLayer === "background" 的球，再画普通球：投出的矛永远
      // 压在所有本体与敌人之下，不会遮住任何一颗球。物理与判定顺序不受影响。
      drawLayer: "background",
      stats: { radius: PROJECTILE_RADIUS, speed: 1, maxHp: 1 },
      createBehavior(summonServices) {
        let state = "flying";
        const velocityX = launch.directionX * PROJECTILE_SPEED;
        const velocityY = launch.directionY * PROJECTILE_SPEED;
        let angle = Math.atan2(launch.directionY, launch.directionX);
        let host = null;
        let hits = 0;
        let broken = false;

        function placeImpaled(ball) {
          const inwardX = Math.cos(angle);
          const inwardY = Math.sin(angle);
          // 矛尖插进身体 6 点，矛身从入射那一侧露出来。
          const tipX = host.x + inwardX * (host.radius - INSERT_DEPTH);
          const tipY = host.y + inwardY * (host.radius - INSERT_DEPTH);
          ball.x = tipX - inwardX * HALF_SPAN;
          ball.y = tipY - inwardY * HALF_SPAN;
        }

        // 扎在板边上：矛尖顶到墙，矛身留在场内。
        function placeAnchored(ball, boundaryX, boundaryY) {
          Object.assign(ball, resolveArenaGeometry(launch.arena || launch.arenaSize).clampPoint(boundaryX - Math.cos(angle) * HALF_SPAN, boundaryY - Math.sin(angle) * HALF_SPAN, PROJECTILE_RADIUS));
        }
        function breakSpear(ball) {
          if (broken) return;
          broken = true;
          createShatterBurst(summonServices, ball.x, ball.y, angle);
          // 走引擎的死亡流程：淡出、清理，和玻璃渣碎裂同一条路。
          ball.hp = 0;
        }

        return {
          update(context, dt) {
            const ball = context.ball;
            if (broken) return;
            if (state === "impaled") {
              if (!host || host.hp <= 0 || host.active === false) {
                breakSpear(ball);
                return;
              }
              placeImpaled(ball);
              return;
            }
            if (state === "anchored") return;
            const step = Math.max(0, dt);
            const startX = ball.x;
            const startY = ball.y;
            const endX = startX + velocityX * step;
            const endY = startY + velocityY * step;
            const target = ownerServices.getFirstEnemyHit(
              startX,
              startY,
              endX,
              endY,
              PROJECTILE_RADIUS
            );
            if (target && ownerServices.dealDamage(target, THROW_DAMAGE)) {
              // 矛保持飞行朝向插上去：尖端抵在目标圆心一侧，矛身从入射侧露出来。
              state = "impaled";
              host = target;
              placeImpaled(ball);
              return;
            }
            // 板边：与宙斯V2 一样按最早到达的墙时刻停住，而不是穿墙飞出。
            // 召唤物本体也被引擎夹在 [radius, arenaSize - radius] 里，所以飞行
            // 判定用"本体贴到墙"的平面，落位再换成真正的墙面（0 / arenaSize），
            // 这样矛尖正好顶在墙上。
            const arena = resolveArenaGeometry(launch.arena || launch.arenaSize);
            const boundary = arena.traceSegment(startX, startY, startX + velocityX * step, startY + velocityY * step, PROJECTILE_RADIUS);
            ball.x = boundary ? boundary.x : startX + velocityX * step;
            ball.y = boundary ? boundary.y : startY + velocityY * step;
            if (boundary) {
              state = "anchored";
              placeAnchored(ball, boundary.x - boundary.normalX * PROJECTILE_RADIUS, boundary.y - boundary.normalY * PROJECTILE_RADIUS);
            }
          },
          getContactProfile() {
            // 飞行中是一枚投射物；扎住之后才成为可被攻击的目标。
            return { solid: false, attackable: state !== "flying" };
          },
          getHpDisplay() {
            return { hidden: true };
          },
          onBeforeDamage(context, event) {
            const ball = context.ball;
            if (broken) return { amount: 0, showHitText: false };
            hits += 1;
            createShatterBurst(summonServices, ball.x, ball.y, angle);
            if (hits >= SPEAR_BREAK_HITS) breakSpear(ball);
            // 矛的存亡由"被打了几次"决定，不吃伤害数值：3 点一刀和 1 点一刀
            // 都要打满两次才消失。
            return { amount: 0, showHitText: false };
          },
          drawBody({ ball }, canvasContext) {
            drawSpearShape(canvasContext, anchoredGeometry(ball.x, ball.y, angle), 0, 0);
            return true;
          },
          // 本体碰墙齐射时读它拿矛的朝向，好把"共鸣白光"沿着矛身画出来。
          getSpearState() {
            return { state, angle, hits, broken };
          }
        };
      }
    };
  }

  function createSoundSpearWeapon(services) {
    let ownerBall = null;
    let tipEntity = null;
    let weaponEntity = null;
    // idle（侧挂待机）/ thrust（戳击）/ windup（后拉）/ release（前抛）/ regrow（重新长出来）
    let phase = "idle";
    let phaseElapsed = 0;
    let thrustElapsed = 0;
    let stabCooldown = 0;
    let throwTimer = 0;
    let throwTriggerAt = FIRST_THROW_TRIGGER_AT;
    let throwArmed = false;
    let released = false;
    let armForward = 0;
    let armSide = IDLE_SIDE_OFFSET;
    let weaponAngle = 0;
    let aimAngle = 0;
    let phaseStartForward = 0;
    let phaseStartAngle = 0;
    let attackAngle = 0;
    let spinTick = 0;
    let holdScale = 1;
    let thrownCount = 0;
    let stabCount = 0;
    let completedAttacks = 0;
    let touchingTargets = new Set();
    let lastStabAt = new Map();
    // 投出去的矛：扎在身上/墙上的都留在这张表里，供"碰板边齐射音波"遍历。
    const thrownSpears = [];

    function weaponGeometry(ball) {
      return spearGeometry(ball, weaponAngle, armForward, armSide);
    }

    function aimDirection(ball) {
      let target = services.getOpponent();
      let nearest = Infinity;
      services.forEachEnemy((enemy) => {
        const distance = Math.hypot(enemy.x - ball.x, enemy.y - ball.y);
        if (distance < nearest) { target = enemy; nearest = distance; }
      });
      if (target) {
        const direction = normalize(
          target.x - ball.x,
          target.y - ball.y,
          Math.cos(aimAngle),
          Math.sin(aimAngle)
        );
        aimAngle = Math.atan2(direction.y, direction.x);
        return { target, direction, distance: nearest };
      }
      const fallback = normalize(
        ball.storedVx || ball.vx,
        ball.storedVy || ball.vy,
        Math.cos(aimAngle),
        Math.sin(aimAngle)
      );
      aimAngle = Math.atan2(fallback.y, fallback.x);
      return { target: null, direction: fallback, distance: Infinity };
    }

    function canStab(target, distance) {
      if (!target || !Number.isFinite(distance)) return false;
      return distance <= stabReach() + target.radius;
    }

    function enterPhase(next) {
      phase = next;
      phaseElapsed = 0;
      phaseStartForward = armForward;
      phaseStartAngle = weaponAngle;
      if (next === "thrust" || next === "windup") attackAngle = aimAngle;
    }

    function idleTargets() {
      return { forward: 0, side: IDLE_SIDE_OFFSET, angle: aimAngle, rate: 16, angleRate: 14 };
    }

    function windupTargets() {
      const pull = easeInQuad(clamp(phaseElapsed / WINDUP_DURATION, 0, 1));
      return {
        forward: -PULL_BACK_DISTANCE * pull,
        side: IDLE_SIDE_OFFSET * (1 - pull),
        angle: aimAngle - WINDUP_TILT * pull,
        rate: 13,
        angleRate: 11
      };
    }

    function releaseTargets() {
      const swing = easeOutCubic(clamp(phaseElapsed / RELEASE_DURATION, 0, 1));
      return {
        forward: -PULL_BACK_DISTANCE + (PULL_BACK_DISTANCE + RELEASE_EXTEND) * swing,
        side: 0,
        angle: aimAngle,
        rate: 60,
        angleRate: 60
      };
    }

    function regrowTargets() {
      const progress = clamp(phaseElapsed / REGROW_DURATION, 0, 1);
      return {
        forward: RELEASE_EXTEND * (1 - easeOutCubic(progress)),
        side: IDLE_SIDE_OFFSET * easeOutCubic(progress),
        angle: aimAngle,
        rate: 17,
        angleRate: 20
      };
    }

    function advanceArm(dt, targets) {
      armForward = approach(armForward, targets.forward, targets.rate, dt);
      armSide = approach(armSide, targets.side, targets.rate, dt);
      weaponAngle += angleDifference(targets.angle, weaponAngle) *
        (1 - Math.exp(-Math.max(0, targets.angleRate) * Math.max(0, dt)));
    }

    function throwSpear(aim, geometry) {
      const origin = geometry.tip;
      const direction = aim.target
        ? normalize(
          aim.target.x - origin.x,
          aim.target.y - origin.y,
          aim.direction.x,
          aim.direction.y
        )
        : aim.direction;
      const spear = services.spawnSummon(
        createThrownSpearDefinition(services, {
          directionX: direction.x,
          directionY: direction.y,
          arenaSize: aim.arenaSize,
          arena: aim.arena
        }),
        { x: origin.x, y: origin.y, positionLocked: true, movementLocked: true }
      );
      if (spear) thrownSpears.push(spear);
      thrownCount += 1;
      throwTriggerAt = REPEAT_THROW_TRIGGER_AT;
      // 手里的矛飞出去了：手先空着，随后重新长一根。
      holdScale = 0;
    }

    // 手持的银矛：本体自己的 drawBefore 会把它画进"球与球"之间的层里，于是
    // 矛尖会盖到旁边的敌人身上。改由独立的背景实体来画 —— 渲染器先铺
    // drawLayer === "background" 的实体，再画任何一颗球，矛就永远在下层。
    function drawHeldSpear(canvasContext, time) {
      const ball = ownerBall;
      if (!ball || holdScale <= 0.01) return;
      const fade = Number.isFinite(ball.fade) ? ball.fade : 1;
      if (fade <= 0) return;
      const geometry = weaponGeometry(ball);
      const attackBlend = phase === "thrust" ? thrustPulse(thrustElapsed) : 0;
      const scaled = holdScale < 0.999;
      if (fade >= 1 && !scaled) {
        drawSpearShape(canvasContext, geometry, attackBlend, time);
        return;
      }
      canvasContext.save();
      if (fade < 1) {
        canvasContext.globalAlpha =
          (Number.isFinite(canvasContext.globalAlpha) ? canvasContext.globalAlpha : 1) * fade;
      }
      if (scaled) {
        canvasContext.translate(geometry.grip.x, geometry.grip.y);
        canvasContext.scale(holdScale, holdScale);
        canvasContext.translate(-geometry.grip.x, -geometry.grip.y);
      }
      drawSpearShape(canvasContext, geometry, attackBlend, time);
      canvasContext.restore();
    }

    function ensureWeaponEntity() {
      if (weaponEntity && weaponEntity.entityActive !== false) return weaponEntity;
      weaponEntity = services.spawnCombatEntity({
        kind: "sound-spear-weapon",
        combatKind: "zone",
        life: PERMANENT_LIFE,
        lifecycle: "owner-bound",
        // 所有本体与敌人之下的那一层。
        drawLayer: "background",
        radius: SPEAR_TIP_RADIUS,
        x: ownerBall ? ownerBall.x : 0,
        y: ownerBall ? ownerBall.y : 0,
        update({ entity }) {
          if (!ownerBall || ownerBall.hp <= 0) {
            entity.entityActive = false;
            return;
          }
          entity.x = ownerBall.x;
          entity.y = ownerBall.y;
        },
        draw(context, canvasContext) {
          drawHeldSpear(canvasContext, context && context.game ? context.game.time : 0);
        }
      });
      return weaponEntity;
    }

    function ensureTipEntity() {
      if (tipEntity && tipEntity.entityActive !== false) return tipEntity;
      const initial = weaponGeometry(ownerBall).tip;
      tipEntity = services.spawnCombatEntity({
        kind: "sound-spear-tip",
        combatKind: "zone",
        life: PERMANENT_LIFE,
        lifecycle: "owner-bound",
        drawLayer: "foreground",
        radius: SPEAR_TIP_RADIUS,
        x: initial.x,
        y: initial.y,
        // 与当前计数对齐：眩晕中创建时不会多跑一步。
        lastTick: spinTick,
        previousTip: null,
        update({ entity, game, services: entityServices }, dt) {
          if (!ownerBall || ownerBall.hp <= 0) {
            entity.entityActive = false;
            return;
          }
          // 行为被暂停（眩晕等）时这一步没有推进：整根矛冻结。
          if (entity.lastTick === spinTick) return;
          entity.lastTick = spinTick;

          const geometry = weaponGeometry(ownerBall);
          const previous = entity.previousTip || geometry.tip;
          const current = geometry.tip;
          const elapsed = Math.max(EPSILON, dt);
          entity.x = current.x;
          entity.y = current.y;
          entity.vx = (current.x - previous.x) / elapsed;
          entity.vy = (current.y - previous.y) / elapsed;
          entity.previousTip = { x: current.x, y: current.y };
          // 只有正在戳击、而且手里有矛的时候矛尖才吃判定。
          entity.bladeReady = holdScale > 0.99 && phase === "thrust";
          if (!entity.bladeReady) {
            touchingTargets = new Set();
            return;
          }

          const now = game.time;
          const nextTouching = new Set();
          entityServices.forEachEnemy((target) => {
            if (!target || target.hp <= 0) return;
            const profile = entityServices.getContactProfile(target);
            if (!profile.solid && !profile.attackable) return;
            const contact = movingTipContact(previous, current, target);
            if (contact.distance > target.radius + SPEAR_TIP_RADIUS) return;
            const key = target.instanceId;
            nextTouching.add(key);
            if (profile.solid) {
              resolveTipCollision(entity, target, contact, game, ownerBall);
            }
            if (touchingTargets.has(key)) return;
            const previousHit = lastStabAt.get(key);
            if (previousHit !== undefined && now - previousHit < STAB_HIT_INTERVAL - EPSILON) return;
            lastStabAt.set(key, now);
            if (!profile.attackable) return;
            if (entityServices.dealDamage(target, STAB_DAMAGE)) {
              stabCount += 1;
              // 戳中了说明够得到：投掷计时清零。
              throwTimer = 0;
              // 戳击命中：矛尖就地释放一次佳代子式音波。
              spawnSonicWave(services, current.x, current.y);
            }
          });
          touchingTargets = nextTouching;
        },
        draw() {}
      });
      return tipEntity;
    }

    function updatePhase(ball, aim, dt) {
      if (stabCooldown > 0) stabCooldown = Math.max(0, stabCooldown - dt);
      const stabReachable = canStab(aim.target, aim.distance);
      const canReachNow = phase === "idle" && stabReachable;

      if (phase === "thrust") {
        const pulse = thrustPulse(thrustElapsed);
        armForward = approach(armForward, THRUST_DISTANCE * pulse, 40, dt);
        armSide = approach(armSide, IDLE_SIDE_OFFSET * (1 - pulse), 40, dt);
        weaponAngle += angleDifference(aimAngle, weaponAngle) *
          (1 - Math.exp(-30 * Math.max(0, dt)));
      } else if (phase === "windup") {
        advanceArm(dt, windupTargets());
      } else if (phase === "release") {
        advanceArm(dt, releaseTargets());
      } else if (phase === "regrow") {
        advanceArm(dt, regrowTargets());
      } else {
        advanceArm(dt, idleTargets());
      }

      // 投掷计时：够得到就清零；够不到就一直攒。
      // 出手动作已从计时阈值中扣除，第一发与之后每发都落在 1.5 秒上。
      if (aim.target && !stabReachable) {
        throwArmed = phase === "idle";
        if (phase === "idle" || phase === "regrow") {
          throwTimer = Math.min(throwTriggerAt, throwTimer + dt);
        }
      } else {
        throwArmed = false;
        if (aim.target) throwTimer = 0;
      }

      phaseElapsed += dt;
      switch (phase) {
        case "idle": {
          if (throwArmed && throwTimer + EPSILON >= throwTriggerAt) {
            enterPhase("windup");
            throwArmed = false;
            break;
          }
          if (canReachNow && stabCooldown <= EPSILON) {
            enterPhase("thrust");
            thrustElapsed = 0;
          }
          break;
        }
        case "thrust": {
          thrustElapsed += dt;
          // 收招后进入冷却，动作 0.4s + 冷却 0.4s = 近战周期 0.8s。
          if (thrustElapsed + EPSILON >= THRUST_DURATION) {
            enterPhase("idle");
            thrustElapsed = 0;
            stabCooldown = THRUST_COOLDOWN;
            completedAttacks += 1;
          }
          break;
        }
        case "windup": {
          if (phaseElapsed + EPSILON >= WINDUP_DURATION) {
            enterPhase("release");
            released = false;
          }
          break;
        }
        case "release": {
          const geometry = weaponGeometry(ball);
          if (!released && phaseElapsed + EPSILON >= RELEASE_POINT * RELEASE_DURATION) {
            released = true;
            throwSpear(aim, geometry);
            throwTimer = 0;
          }
          if (phaseElapsed + EPSILON >= RELEASE_DURATION) {
            enterPhase("regrow");
          }
          break;
        }
        case "regrow": {
          const progress = clamp(phaseElapsed / REGROW_DURATION, 0, 1);
          holdScale = clamp(easeOutCubic(progress) * 1.06, 0, 1);
          if (phaseElapsed + EPSILON >= REGROW_DURATION) {
            holdScale = 1;
            completedAttacks += 1;
            enterPhase("idle");
          }
          break;
        }
        default:
      }
    }

    function liveThrownSpears() {
      let writeIndex = 0;
      for (let index = 0; index < thrownSpears.length; index += 1) {
        const spear = thrownSpears[index];
        if (spear && spear.hp > 0 && spear.active !== false) {
          thrownSpears[writeIndex] = spear;
          writeIndex += 1;
        }
      }
      thrownSpears.length = writeIndex;
      return thrownSpears;
    }

    return {
      onAttackBorrowStart(context) {
        ownerBall = context.ball;
        ensureTipEntity();
        ensureWeaponEntity();
      },
      isAttackCycleComplete() { return completedAttacks > 0; },
      onSpawn(context) {
        ownerBall = context.ball;
        ensureTipEntity();
        ensureWeaponEntity();
      },
      update(context, dt) {
        const ball = context.ball;
        ownerBall = ball;
        // 莉音借用时不会派发 onSpawn：懒创建让正常/借用两条路都能拿到武器。
        ensureTipEntity();
        ensureWeaponEntity();
        const elapsed = Math.max(0, dt);
        const aim = aimDirection(ball);
        aim.arenaSize = context.game ? context.game.arenaSize : 200;
        aim.arena = resolveArenaGeometry(context.game || 200);
        updatePhase(ball, aim, elapsed);
        spinTick += 1;
      },
      getNextTransitionIn() {
        switch (phase) {
          case "thrust":
            return Math.max(EPSILON, THRUST_DURATION - thrustElapsed);
          case "windup":
            return Math.max(EPSILON, WINDUP_DURATION - phaseElapsed);
          case "release": {
            const remaining = RELEASE_DURATION - phaseElapsed;
            if (released) return Math.max(EPSILON, remaining);
            return Math.max(
              EPSILON,
              Math.min(remaining, RELEASE_POINT * RELEASE_DURATION - phaseElapsed)
            );
          }
          case "regrow":
            return Math.max(EPSILON, REGROW_DURATION - phaseElapsed);
          default: {
            // 只把真正会改变状态的边界交出去，避免每一步都被切碎。
            let next;
            if (stabCooldown > EPSILON) next = stabCooldown;
            if (throwArmed) {
              const remaining = Math.max(EPSILON, throwTriggerAt - throwTimer);
              next = next === undefined ? remaining : Math.min(next, remaining);
            }
            return next;
          }
        }
      },
      onWallBounce(context) {
        // 每碰一次板边：所有投出的矛（含飞行中的）各释放一次音波。
        const spears = liveThrownSpears();
        // 场上没有矛时这次撞墙不会有任何音波，就不放"触发"演出，免得误导观众。
        if (spears.length === 0) return;
        const ball = (context && context.ball) || ownerBall;
        const arenaSize = context && context.game && Number.isFinite(context.game.arenaSize)
          ? context.game
          : 200;
        if (ball) {
          // ① 撞墙点：这次撞击就是音波的源头，先把它讲清楚。
          const placement = wallResonancePlacement(
            ball,
            arenaSize,
            Boolean(context && context.bouncedX),
            Boolean(context && context.bouncedY)
          );
          services.spawnVisualEffect(createWallResonance(
            ball,
            arenaSize,
            Boolean(context && context.bouncedX),
            Boolean(context && context.bouncedY)
          ));
          spawnWallResonanceDebris(services, placement);
          services.shakeArena({ intensity: 2.6, duration: 0.08 });
        }
        for (const spear of spears) {
          const spearState = spear.behavior && typeof spear.behavior.getSpearState === "function"
            ? spear.behavior.getSpearState()
            : null;
          // ② 每根被唤醒的矛：沿矛身扫一道白光，和音波同一帧出现。
          services.spawnVisualEffect(createSpearResonance(
            spear.x,
            spear.y,
            spearState && Number.isFinite(spearState.angle) ? spearState.angle : 0,
            SPAN
          ));
          spawnSonicWave(services, spear.x, spear.y);
        }
      },
      onBorrowEnd() {
        if (tipEntity) tipEntity.entityActive = false;
        tipEntity = null;
        if (weaponEntity) weaponEntity.entityActive = false;
        weaponEntity = null;
      },
      getSoundSpearState() {
        const ball = ownerBall;
        const geometry = ball ? weaponGeometry(ball) : null;
        return {
          phase,
          weaponAngle,
          aimAngle,
          armForward,
          armSide,
          holdScale,
          stabCooldown,
          thrustElapsed,
          throwTimer,
          throwArmed,
          thrownCount,
          stabCount,
          completedAttacks,
          stabDamage: STAB_DAMAGE,
          throwDamage: THROW_DAMAGE,
          stabReach: stabReach(),
          thrownSpears: liveThrownSpears().slice(),
          grip: geometry ? { ...geometry.grip } : null,
          tip: geometry ? { ...geometry.tip } : null
        };
      }
    };
  }

  const soundSpearDefinition = {
    id: "soundSpear",
    name: "音矛",
    englishName: "Sound Spear",
    color: BODY_COLOR,
    description: "银色长矛 / 近战戳击3点·冷却0.8秒，命中即在矛尖释放音波 / 射程外250速投矛2点，扎在敌人或板边上不消失、被攻击2次才碎 / 每碰一次板边所有投出的矛各放一次音波",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      return createSoundSpearWeapon(services);
    }
  };

  registerBall(soundSpearDefinition);
  return {
    soundSpearDefinition,
    createSoundSpearWeapon,
    createThrownSpearDefinition,
    soundSpearGeometry: spearGeometry,
    drawSoundSpear: drawSpearShape,
    soundSpearStabReach: stabReach,
    createSoundSpearWallResonance: createWallResonance,
    createSoundSpearResonance: createSpearResonance,
    SOUND_SPEAR_LENGTH: SPEAR_LENGTH,
    SOUND_SPEAR_TIP_RADIUS: SPEAR_TIP_RADIUS,
    SOUND_SPEAR_IDLE_SIDE_OFFSET: IDLE_SIDE_OFFSET,
    SOUND_SPEAR_THRUST_DISTANCE: THRUST_DISTANCE,
    SOUND_SPEAR_THRUST_DURATION: THRUST_DURATION,
    SOUND_SPEAR_THRUST_COOLDOWN: THRUST_COOLDOWN,
    SOUND_SPEAR_STAB_DAMAGE: STAB_DAMAGE,
    SOUND_SPEAR_STAB_HIT_INTERVAL: STAB_HIT_INTERVAL,
    SOUND_SPEAR_THROW_INTERVAL: THROW_INTERVAL,
    SOUND_SPEAR_THROW_DAMAGE: THROW_DAMAGE,
    SOUND_SPEAR_PROJECTILE_SPEED: PROJECTILE_SPEED,
    SOUND_SPEAR_PROJECTILE_RADIUS: PROJECTILE_RADIUS,
    SOUND_SPEAR_BREAK_HITS: SPEAR_BREAK_HITS,
    SOUND_SPEAR_THROWN_ID: THROWN_ID,
    SOUND_SPEAR_WAVE_KIND: WAVE_KIND,
    SOUND_SPEAR_WALL_RESONANCE_KIND: WALL_RESONANCE_KIND,
    SOUND_SPEAR_RESONANCE_KIND: SPEAR_RESONANCE_KIND
  };
});
