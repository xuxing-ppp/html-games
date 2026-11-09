(function initializeSawV3(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("./saw-v2.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSawV3Plugin({ registerBall, SAW_V2_TOOTH_HEIGHT }) {
  const BODY_COLOR = "#e0722c";
  // 锯条尺寸按草图：长度约 1.5 倍球径，宽度约半个球径。
  const BAR_LENGTH = 46;
  const BAR_WIDTH = 16;
  // 根部往球体里多伸一段，画在球体之前 → 看起来是从本体下面伸出来的。
  const BAR_ROOT_INSET = 12;
  // 锯齿大小与锯球V2 完全一致（高 2，根宽约 2.8）。
  const TOOTH_HEIGHT = SAW_V2_TOOTH_HEIGHT;
  const TOOTH_HALF_BASE = 1.4;
  const TOOTH_SPACING = 5;
  // 链条线速度：350 单位/秒。
  const CHAIN_SPEED = 350;
  const TOOTH_DAMAGE = 1;
  // 每颗锯齿触碰 1 点：一颗锯齿过去的时间就是 spacing / speed。
  const HIT_INTERVAL = TOOTH_SPACING / CHAIN_SPEED;
  // 锯条绕本体旋转：满血 0.25 r/s，残血 2 r/s（公式参考刺客）。
  const FULL_HP_ROTATION = 0.25;
  const LOW_HP_ROTATION = 2;
  const INITIAL_ANGLE = Math.PI / 2;
  // 出血：喷溅节流 + 锯条上的血痕保留时长。
  const BLOOD_SPRAY_INTERVAL = 0.1;
  const BLOOD_FADE = 1.4;
  const BLOOD_MARK_LIMIT = 60;
  const BAR_FILL = "#9aa4b0";
  const BAR_EDGE = "#39424c";
  const TOOTH_FILL = "#cfd7e0";
  const BLOOD_DARK = "#8b0f18";
  const BLOOD_MID = "#c1121f";
  const BLOOD_BRIGHT = "#e63946";
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 刺客同款：满血为 1、残血为 0，在两个极值之间做几何插值。
  function livingHpRatio(ball) {
    return clamp((ball.hp - 1) / Math.max(1, ball.maxHp - 1), 0, 1);
  }

  function rotationRate(ball) {
    return LOW_HP_ROTATION * Math.pow(
      FULL_HP_ROTATION / LOW_HP_ROTATION,
      livingHpRatio(ball)
    );
  }

  // 锯条是一根钢板：根部平口（缩进球体里），只有伸出去的一端是圆头。
  // 链条贴着这条轮廓走，远端严丝合缝。
  function chainMetrics(radius) {
    const half = BAR_WIDTH / 2;
    const rootX = radius - BAR_ROOT_INSET;
    const tipCenter = radius + BAR_LENGTH - half;
    const straight = Math.max(0, tipCenter - rootX);
    const cap = Math.PI * half;
    const root = BAR_WIDTH;
    return { half, rootX, tipCenter, straight, cap, root, total: 2 * straight + cap + root };
  }

  // 链条回路上的点：左直边 → 前端半圆 → 右直边 → 根部平口。
  function chainPointAt(offset, radius) {
    const { half, rootX, tipCenter, straight, cap, root, total } = chainMetrics(radius);
    let cursor = ((offset % total) + total) % total;
    if (cursor < straight) {
      return { x: rootX + cursor, y: -half, normalX: 0, normalY: -1 };
    }
    cursor -= straight;
    if (cursor < cap) {
      const angle = -Math.PI / 2 + (cursor / cap) * Math.PI;
      return {
        x: tipCenter + Math.cos(angle) * half,
        y: Math.sin(angle) * half,
        normalX: Math.cos(angle),
        normalY: Math.sin(angle)
      };
    }
    cursor -= cap;
    if (cursor < straight) {
      return { x: tipCenter - cursor, y: half, normalX: 0, normalY: 1 };
    }
    cursor -= straight;
    return {
      x: rootX,
      y: half - Math.min(cursor, root),
      normalX: -1,
      normalY: 0
    };
  }

  // 敌方圆心在锯条局部坐标下的位置，以及到锯条（含锯齿）的最短距离。
  function barContact(ball, enemy, angle) {
    const deltaX = enemy.x - ball.x;
    const deltaY = enemy.y - ball.y;
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const localX = deltaX * cos - deltaY * sin;
    const localY = deltaX * sin + deltaY * cos;
    const half = BAR_WIDTH / 2;
    const closestX = clamp(localX, ball.radius, ball.radius + BAR_LENGTH);
    const closestY = clamp(localY, -half, half);
    return {
      localX,
      localY,
      closestX,
      closestY,
      distance: Math.hypot(localX - closestX, localY - closestY)
    };
  }

  function localToWorld(ball, angle, localX, localY) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: ball.x + localX * cos - localY * sin,
      y: ball.y + localX * sin + localY * cos
    };
  }

  // 电锯惊魂式出血：五道弧形血线从伤口甩出去，中间那道最亮最粗。
  function createBloodSpray(x, y, angle) {
    return {
      kind: "saw-v3-blood",
      life: 0.48,
      x,
      y,
      angle,
      draw({ effect }, canvas) {
        if (!canvas || typeof canvas.quadraticCurveTo !== "function") return;
        const progress = clamp(effect.age / effect.life, 0, 1);
        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.rotate(effect.angle);
        canvas.globalAlpha *= (1 - progress) * 0.98;
        canvas.lineCap = "round";
        for (let index = 0; index < 5; index += 1) {
          const spread = (index - 2) * 0.26;
          const length = (14 + index * 7) * (0.45 + progress * 1.5);
          const lift = (4 + index * 3) * progress;
          canvas.strokeStyle = index === 2
            ? BLOOD_BRIGHT
            : (index % 2 === 0 ? BLOOD_MID : BLOOD_DARK);
          canvas.lineWidth = 4.2 - Math.abs(index - 2) * 0.8;
          canvas.beginPath();
          canvas.moveTo(0, 0);
          canvas.quadraticCurveTo(
            Math.cos(spread) * length * 0.55,
            Math.sin(spread) * length * 0.55 - lift * 0.6,
            Math.cos(spread) * length,
            Math.sin(spread) * length - lift * 1.7
          );
          canvas.stroke();
        }
        // 伤口处的血团
        canvas.globalAlpha *= 0.85;
        canvas.fillStyle = BLOOD_MID;
        canvas.beginPath();
        canvas.arc(0, 0, 3.2 + progress * 2.4, 0, TWO_PI);
        canvas.fill();
        canvas.restore();
      }
    };
  }

  function drawSawBar(canvas, ball, angle, chainOffset, bloodMarks, time) {
    const radius = ball.radius;
    const half = BAR_WIDTH / 2;
    const rootX = radius - BAR_ROOT_INSET;
    const tip = radius + BAR_LENGTH;

    canvas.save();
    canvas.translate(ball.x, ball.y);
    canvas.rotate(angle);

    // 锯条钢板：根部平口（藏在球体下面）、只有伸出去的一端是圆头
    canvas.beginPath();
    canvas.moveTo(rootX, -half);
    canvas.lineTo(tip - half, -half);
    canvas.arc(tip - half, 0, half, -Math.PI / 2, Math.PI / 2);
    canvas.lineTo(rootX, half);
    canvas.closePath();
    canvas.fillStyle = BAR_FILL;
    canvas.fill();
    canvas.strokeStyle = BAR_EDGE;
    canvas.lineWidth = 1.2;
    canvas.stroke();

    // 链槽：中间一道细槽，两端留出链轮位置
    canvas.strokeStyle = "rgba(57, 66, 76, 0.55)";
    canvas.lineWidth = 1;
    canvas.beginPath();
    canvas.moveTo(radius + 1, 0);
    canvas.lineTo(tip - 4, 0);
    canvas.stroke();

    // 前端链轮孔（草图里的小圆）
    canvas.fillStyle = "#39424c";
    canvas.beginPath();
    canvas.arc(tip - 5.5, 0, 2.6, 0, TWO_PI);
    canvas.fill();
    canvas.strokeStyle = "rgba(220, 230, 240, 0.5)";
    canvas.lineWidth = 0.8;
    canvas.beginPath();
    canvas.arc(tip - 5.5, 0, 2.6, 0, TWO_PI);
    canvas.stroke();

    // 钢板高光
    canvas.strokeStyle = "rgba(255, 255, 255, 0.4)";
    canvas.lineWidth = 1.4;
    canvas.beginPath();
    canvas.moveTo(radius + 2, -half + 2);
    canvas.lineTo(tip - 8, -half + 2);
    canvas.stroke();

    // 链条锯齿：沿回路按链条位移排布
    const { total } = chainMetrics(radius);
    const toothCount = Math.floor(total / TOOTH_SPACING);
    canvas.fillStyle = TOOTH_FILL;
    canvas.strokeStyle = BAR_EDGE;
    canvas.lineWidth = 0.7;
    for (let index = 0; index < toothCount; index += 1) {
      const point = chainPointAt(index * TOOTH_SPACING + chainOffset, radius);
      const tangentX = -point.normalY;
      const tangentY = point.normalX;
      canvas.beginPath();
      canvas.moveTo(
        point.x + tangentX * TOOTH_HALF_BASE,
        point.y + tangentY * TOOTH_HALF_BASE
      );
      canvas.lineTo(
        point.x - tangentX * TOOTH_HALF_BASE,
        point.y - tangentY * TOOTH_HALF_BASE
      );
      canvas.lineTo(
        point.x + point.normalX * TOOTH_HEIGHT,
        point.y + point.normalY * TOOTH_HEIGHT
      );
      canvas.closePath();
      canvas.fill();
      canvas.stroke();
    }

    // 锯条上的血痕：沿着锯条抹开，慢慢干涸
    canvas.lineCap = "round";
    for (const mark of bloodMarks) {
      const fade = 1 - (time - mark.at) / BLOOD_FADE;
      if (fade <= 0) continue;
      canvas.globalAlpha = fade * 0.9;
      canvas.strokeStyle = mark.bright ? BLOOD_MID : BLOOD_DARK;
      canvas.lineWidth = 2.6 + fade * 2.2;
      canvas.beginPath();
      canvas.moveTo(mark.x - 4.6, mark.y);
      canvas.lineTo(mark.x + 4.6, mark.y);
      canvas.stroke();
      canvas.globalAlpha = fade * 0.7;
      canvas.fillStyle = BLOOD_BRIGHT;
      canvas.beginPath();
      canvas.arc(mark.x + 1.4, mark.y + 1.6, 1.3 + fade * 0.9, 0, TWO_PI);
      canvas.fill();
    }
    canvas.globalAlpha = 1;

    canvas.restore();
  }

  const sawV3Definition = {
    id: "sawV3",
    name: "锯球V3",
    englishName: "Saw Ball V3",
    color: BODY_COLOR,
    description: "手持电锯 / 每颗锯齿 1 点触碰伤害 / 链条线速度 350 / 转速随血量 0.25→2 r/s / 见血",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let ownerBall = null;
      let barAngle = INITIAL_ANGLE;
      let chainOffset = 0;
      let borrowedTravel = 0;
      let hitCount = 0;
      let sprayCount = 0;
      const lastHitAt = new Map();
      const lastSprayAt = new Map();
      const bloodMarks = [];

      function addBloodMark(contact, now) {
        bloodMarks.push({
          x: contact.closestX,
          y: contact.closestY,
          at: now,
          bright: bloodMarks.length % 3 === 0
        });
        while (bloodMarks.length > BLOOD_MARK_LIMIT) bloodMarks.shift();
      }

      function spawnWound(ball, enemy, contact, now) {
        const point = localToWorld(ball, barAngle, contact.closestX, contact.closestY);
        let dirX = contact.localX - contact.closestX;
        let dirY = contact.localY - contact.closestY;
        let magnitude = Math.hypot(dirX, dirY);
        if (magnitude <= EPSILON) {
          // 敌方正压在锯条上：按它所在的一侧甩血
          dirX = 0;
          dirY = contact.localY >= 0 ? 1 : -1;
          magnitude = 1;
        }
        dirX /= magnitude;
        dirY /= magnitude;
        // 链条把血往远端带一点
        const bladeX = Math.cos(barAngle);
        const bladeY = Math.sin(barAngle);
        let sprayX = dirX + bladeX * 0.55;
        let sprayY = dirY + bladeY * 0.55;
        const sprayLength = Math.hypot(sprayX, sprayY) || 1;
        sprayX /= sprayLength;
        sprayY /= sprayLength;
        const worldX = sprayX * Math.cos(barAngle) - sprayY * Math.sin(barAngle);
        const worldY = sprayX * Math.sin(barAngle) + sprayY * Math.cos(barAngle);
        const sprayAngle = Math.atan2(worldY, worldX);

        // 主血柱：大颗血珠往外甩
        services.spawnParticleBurst({
          x: point.x,
          y: point.y,
          count: 22,
          colors: [BLOOD_MID, BLOOD_DARK, BLOOD_BRIGHT, "#ff8f9c", "#7a0a12"],
          shape: "ellipse",
          minLength: 2,
          maxLength: 6.5,
          minWidth: 1.1,
          maxWidth: 3.2,
          minSpeed: 90,
          maxSpeed: 330,
          minRotationSpeed: -14,
          maxRotationSpeed: 14,
          directionAngle: sprayAngle,
          directionSpread: 1.7,
          gravityY: 340,
          drag: 2,
          life: 0.6
        });
        // 血雾：细密一圈，慢慢飘散
        services.spawnParticleBurst({
          x: point.x,
          y: point.y,
          count: 14,
          colors: [BLOOD_DARK, BLOOD_MID, "#5e0810"],
          minDiameter: 1,
          maxDiameter: 3,
          minSpeed: 40,
          maxSpeed: 150,
          directionAngle: sprayAngle,
          directionSpread: Math.PI,
          gravityY: 90,
          drag: 4.6,
          life: 0.7
        });

        const key = enemy.instanceId;
        const previous = lastSprayAt.get(key);
        if (previous === undefined || now - previous >= BLOOD_SPRAY_INTERVAL - EPSILON) {
          lastSprayAt.set(key, now);
          sprayCount += 1;
          services.spawnVisualEffect(createBloodSpray(point.x, point.y, sprayAngle));
        }
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          barAngle = INITIAL_ANGLE;
        },
        update(context, dt) {
          const ball = context.ball;
          ownerBall = ball;
          const elapsed = Math.max(0, dt);
          // 锯条绕本体旋转：血量越低转得越快（刺客公式）。
          const travel = rotationRate(ball) * TWO_PI * elapsed;
          barAngle += travel;
          if (services.borrowedAttackOnly) borrowedTravel += travel;
          if (barAngle > TWO_PI) barAngle -= TWO_PI;
          // 链条沿锯条运行：固定线速度 350。
          const { total } = chainMetrics(ball.radius);
          chainOffset = (chainOffset + CHAIN_SPEED * elapsed) % total;

          const now = context.game.time;
          services.forEachEnemy((enemy) => {
            if (!enemy || enemy.hp <= 0) return;
            const key = enemy.instanceId;
            const contact = barContact(ball, enemy, barAngle);
            if (contact.distance > enemy.radius + TOOTH_HEIGHT) {
              lastHitAt.delete(key);
              lastSprayAt.delete(key);
              return;
            }
            const previous = lastHitAt.get(key);
            if (previous !== undefined && now - previous < HIT_INTERVAL - EPSILON) return;
            lastHitAt.set(key, now);
            hitCount += 1;
            addBloodMark(contact, now);
            spawnWound(ball, enemy, contact, now);
            services.dealDamage(enemy, TOOTH_DAMAGE);
          });

          for (let index = bloodMarks.length - 1; index >= 0; index -= 1) {
            if (now - bloodMarks[index].at > BLOOD_FADE) bloodMarks.splice(index, 1);
          }
        },
        isAttackCycleComplete() { return borrowedTravel >= TWO_PI - EPSILON; },
        getAttackCycleTransitionIn({ ball }) {
          return Math.max(EPSILON, (TWO_PI - borrowedTravel) / (rotationRate(ball) * TWO_PI));
        },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) { this.drawBefore(context, canvasContext); },
        // 锯条挂在球身上、从本体下面伸出来：画在球体之前。
        drawBefore(context, canvas) {
          if (!canvas || typeof canvas.rotate !== "function") return;
          drawSawBar(
            canvas,
            context.ball,
            barAngle,
            chainOffset,
            bloodMarks,
            context.game.time
          );
        },
        getSawV3State() {
          const ball = ownerBall;
          return {
            barAngle,
            chainOffset,
            rotationRate: ball ? rotationRate(ball) : FULL_HP_ROTATION,
            chainSpeed: CHAIN_SPEED,
            hitInterval: HIT_INTERVAL,
            hitCount,
            sprayCount,
            bloodMarks: bloodMarks.length,
            trackedEnemies: lastHitAt.size,
            reach: ball ? ball.radius + BAR_LENGTH : 15 + BAR_LENGTH
          };
        }
      };
    }
  };

  registerBall(sawV3Definition);
  return {
    sawV3Definition,
    sawV3RotationRate: rotationRate,
    sawV3LivingHpRatio: livingHpRatio,
    sawV3ChainPointAt: chainPointAt,
    sawV3BarContact: barContact,
    createSawV3BloodSpray: createBloodSpray,
    SAW_V3_COLOR: BODY_COLOR,
    SAW_V3_BAR_LENGTH: BAR_LENGTH,
    SAW_V3_BAR_WIDTH: BAR_WIDTH,
    SAW_V3_BAR_ROOT_INSET: BAR_ROOT_INSET,
    SAW_V3_TOOTH_HEIGHT: TOOTH_HEIGHT,
    SAW_V3_TOOTH_SPACING: TOOTH_SPACING,
    SAW_V3_CHAIN_SPEED: CHAIN_SPEED,
    SAW_V3_TOOTH_DAMAGE: TOOTH_DAMAGE,
    SAW_V3_HIT_INTERVAL: HIT_INTERVAL,
    SAW_V3_BLOOD_FADE: BLOOD_FADE,
    SAW_V3_FULL_HP_ROTATION: FULL_HP_ROTATION,
    SAW_V3_LOW_HP_ROTATION: LOW_HP_ROTATION
  };
});
