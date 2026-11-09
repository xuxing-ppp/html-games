(function initializeYiWanRen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createYiWanRenPlugin({ resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback }) {
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;

  // 普通类小球：本体和别的球一样是直径 30、100 血，只有速度按需求压到 30。
  const BODY_RADIUS = 15;
  const BODY_SPEED = 30;
  const BODY_HP = 100;
  const BODY_COLOR = "#8e1b22";
  const BODY_CONTACT_DAMAGE = 1;

  const SPAWN_INTERVAL = 0.02;
  const SUMMON_LIFESPAN = 6;
  const SUMMON_FADE = 0.8;
  const MAX_ACTIVE_SUMMONS = 40;
  // 满员期间攒下的召唤预算上限：只允许补这么多秒，避免长期满员后一次性喷发。
  const SPAWN_BACKLOG_SECONDS = 0.2;

  const SUMMON_RADIUS = 5;
  const SUMMON_SPEED = 50;
  const SUMMON_HP = 1;
  const CONTACT_DAMAGE = 1;

  const SKIN_TONES = ["#8e1b22", "#ad2b2f", "#d0565c", "#f0a29a", "#7d1219", "#c8454b"];
  const FLESH_FIBER = "#e9b7ac";

  const TENTACLE_MAX_LENGTH = 20;
  const TENTACLE_DAMAGE = 2;
  // 接触判定要把触手自身的粗细和本体的体积一起算进去：贴脸顶住敌人的那一根
  // 触手也必须算接触，否则「长度 20」的触手永远够不到被自己顶开的敌人。
  const TENTACLE_THICKNESS = 2.6;
  const TENTACLE_HIT_RADIUS = SUMMON_RADIUS + TENTACLE_THICKNESS;

  const CRAWL_DURATION = 2;
  const LUNGE_SPEED_MAX = 100;
  const LUNGE_MAX_DISTANCE = 40;
  // 头线性加速到 100、再线性刹停：对称梯形恰好在这个加速度下于 40 距离处停住。
  const LUNGE_ACCELERATION = LUNGE_SPEED_MAX * LUNGE_SPEED_MAX / LUNGE_MAX_DISTANCE;
  const LUNGE_HALF_DISTANCE = LUNGE_SPEED_MAX * LUNGE_SPEED_MAX / (2 * LUNGE_ACCELERATION);
  const LUNGE_STRETCH_TIME = 2 * LUNGE_SPEED_MAX / LUNGE_ACCELERATION;
  const LUNGE_RETRACT_SPEED = 140;
  const LUNGE_HEAD_GROWTH = 0.9;
  // 无敌伸长期间撞到敌人的碰撞伤害为 2，并追加 0.05 秒、二倍速的击退。
  const LUNGE_BODY_DAMAGE = 2;
  const LUNGE_KNOCKBACK_DURATION = 0.05;
  const LUNGE_KNOCKBACK_MULTIPLIER = 2;

  const FLESH_BULLET_INTERVAL = 1;
  const FLESH_BULLET_SPEED = 150;
  const FLESH_BULLET_DAMAGE = 1;
  const FLESH_BULLET_RADIUS = 4;
  const FLESH_BULLET_LIFE = 3;

  const SPLIT_INTERVAL = 5;
  const SPLIT_CHILD_RADIUS = 3.5;
  const SPLIT_PUSH_SPEED = 70;

  const WHIP_LENGTH = 8;
  const WHIP_TURN_RATE = TAU * 3;
  const WHIP_DAMAGE = 1;
  const WHIP_THICKNESS = 2.6;

  const HOP_INTERVAL = 1;
  const HOP_RANGE = 30;
  // 弹跳落点朝敌人偏斜，偏角限制在这个扇区里，落点仍然落在自身半径 30 的范围内。
  const HOP_SPREAD = 0.6;

  const HOP_AIR_DURATION = 0.55;
  const HOP_ARC_HEIGHT = 26;
  const SHOCKWAVE_RADIUS = 20;
  const SHOCKWAVE_STUN_DURATION = 0.2;

  // 碎裂尖牙：本体死后在半径 10 内掉落 1-2 块，敌人碰到即掉 1 血。
  const FANG_RADIUS = 3;
  const FANG_DAMAGE = 1;
  const FANG_LIFE = 7;
  const FANG_DROP_RADIUS = 10;
  const FANG_DROP_MIN = 1;
  const FANG_DROP_MAX = 2;
  const FANG_SPIN = 1.6;

  const BODY_FIELD_RESOLUTION = 28;
  const FIELD_DEEP = [86, 10, 17];
  const FIELD_MID = [162, 33, 39];
  const FIELD_LIGHT = [244, 186, 172];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteDelta(dt) {
    return Number.isFinite(dt) && dt > 0 ? dt : 0;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function directionTo(ball, target) {
    if (!target) return { x: 0, y: 0 };
    return normalizeDirection(target.x - ball.x, target.y - ball.y);
  }

  function drive(ball, direction, speed) {
    ball.vx = ball.storedVx = direction.x * speed;
    ball.vy = ball.storedVy = direction.y * speed;
    ball.speedNeedsNormalization = false;
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const deltaX = bx - ax;
    const deltaY = by - ay;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((px - ax) * deltaX + (py - ay) * deltaY) / lengthSquared, 0, 1);
    return Math.hypot(px - (ax + deltaX * progress), py - (ay + deltaY * progress));
  }

  function creatureKey(candidate) {
    return candidate.instanceId || candidate.id;
  }

  function hash2(x, y, seed) {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  function smoothNoise3(x, y, z, seed) {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const cellZ = Math.floor(z);
    const fracX = x - cellX;
    const fracY = y - cellY;
    const fracZ = z - cellZ;
    const smoothX = fracX * fracX * (3 - 2 * fracX);
    const smoothY = fracY * fracY * (3 - 2 * fracY);
    const smoothZ = fracZ * fracZ * (3 - 2 * fracZ);
    const sample = (offsetX, offsetY, offsetZ) => (
      hash2(cellX + offsetX, cellY + offsetY + (cellZ + offsetZ) * 17.31, seed)
    );
    const x00 = sample(0, 0, 0) + (sample(1, 0, 0) - sample(0, 0, 0)) * smoothX;
    const x10 = sample(0, 1, 0) + (sample(1, 1, 0) - sample(0, 1, 0)) * smoothX;
    const x01 = sample(0, 0, 1) + (sample(1, 0, 1) - sample(0, 0, 1)) * smoothX;
    const x11 = sample(0, 1, 1) + (sample(1, 1, 1) - sample(0, 1, 1)) * smoothX;
    const y0 = x00 + (x10 - x00) * smoothY;
    const y1 = x01 + (x11 - x01) * smoothY;
    return y0 + (y1 - y0) * smoothZ;
  }

  function ridgedBlob(x, y, z, seed) {
    return clamp(1 - Math.abs(smoothNoise3(x, y, z, seed) * 2 - 1), 0, 1);
  }

  function createFleshSkin({ seed = 0, resolution = BODY_FIELD_RESOLUTION } = {}) {
    const size = resolution * resolution;
    const red = new Float32Array(size);
    const green = new Float32Array(size);
    const blue = new Float32Array(size);
    let filledTime = -1;

    function fill(time) {
      const layerA = time * 0.6;
      const layerB = time * 0.94;
      for (let row = 0; row < resolution; row += 1) {
        const normalizedY = (row + 0.5) / resolution * 2 - 1;
        for (let column = 0; column < resolution; column += 1) {
          const normalizedX = (column + 0.5) / resolution * 2 - 1;
          const radial = Math.min(1, Math.hypot(normalizedX, normalizedY));
          const longitude = Math.atan2(normalizedY, normalizedX);
          const sphereZ = Math.sqrt(Math.max(0, 1 - radial * radial));
          const fiber = ridgedBlob(
            normalizedX * 3.1 + sphereZ * 1.2,
            normalizedY * 3.1 + longitude * 0.35,
            layerA + sphereZ * 0.8,
            seed
          );
          const membrane = smoothNoise3(
            normalizedX * 1.7,
            normalizedY * 1.7 + sphereZ,
            layerB,
            seed + 5.5
          );
          const fiberWeight = Math.pow(fiber, 2.2);
          const membraneWeight = Math.pow(membrane, 1.7) * 0.55;
          const light = clamp(fiberWeight * 0.8 + membraneWeight, 0, 1);
          const shade = 0.45 + 0.55 * Math.pow(1 - radial, 0.75);
          const baseR = (FIELD_DEEP[0] + (FIELD_MID[0] - FIELD_DEEP[0]) * fiber) * shade;
          const baseG = (FIELD_DEEP[1] + (FIELD_MID[1] - FIELD_DEEP[1]) * fiber) * shade;
          const baseB = (FIELD_DEEP[2] + (FIELD_MID[2] - FIELD_DEEP[2]) * fiber) * shade;
          const index = row * resolution + column;
          red[index] = baseR + (FIELD_LIGHT[0] - baseR) * light * 0.85;
          green[index] = baseG + (FIELD_LIGHT[1] - baseG) * light * 0.85;
          blue[index] = baseB + (FIELD_LIGHT[2] - baseB) * light * 0.85;
        }
      }
    }

    function snapshot(time) {
      if (time === filledTime) return;
      filledTime = time;
      fill(time);
    }

    function sample(normalizedX, normalizedY, out) {
      const column = clamp(Math.floor((normalizedX * 0.5 + 0.5) * resolution), 0, resolution - 1);
      const row = clamp(Math.floor((normalizedY * 0.5 + 0.5) * resolution), 0, resolution - 1);
      const index = row * resolution + column;
      out[0] = red[index];
      out[1] = green[index];
      out[2] = blue[index];
      return out;
    }

    return { fill, snapshot, sample, resolution };
  }

  function paintFleshLayers(context, options) {
    const {
      x,
      y,
      radius,
      angle = 0,
      time = 0,
      layerCount = 12,
      layerRadiusScale = 0.5,
      lineWidthScale = 0.04,
      scatter = 0.24
    } = options;
    for (let layer = 0; layer < layerCount; layer += 1) {
      const chatter = hash2(layer, 3.1, 91.7);
      const layerRadius = radius * layerRadiusScale * (0.35 + 0.65 * chatter);
      const centerDistance = radius * scatter * (0.2 + 0.8 * hash2(layer, 7.7, 13.3));
      const spin = time * (0.4 + 0.5 * hash2(layer, 1.3, 8.8)) + layer * 1.7 + angle;
      const centerX = x + Math.cos(spin) * centerDistance;
      const centerY = y + Math.sin(spin) * centerDistance;
      const shade = 0.7 + 0.3 * hash2(layer, 5.5, 21.9);
      const tone = SKIN_TONES[layer % SKIN_TONES.length];
      context.globalAlpha = 0.45 * shade;
      context.fillStyle = tone;
      context.beginPath();
      context.arc(centerX, centerY, layerRadius, 0, TAU);
      context.fill();
      context.globalAlpha = 0.26 * shade;
      context.strokeStyle = layer % 3 === 0 ? FLESH_FIBER : tone;
      context.lineWidth = Math.max(0.3, radius * lineWidthScale);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function drawFleshBody(context, options) {
    const {
      x,
      y,
      radius,
      time,
      seed = 0,
      field = null,
      angle = 0,
      tendrilCount = 11,
      woundCount = 5,
      shadowAlpha = 0.4
    } = options;
    const resolution = field ? field.resolution : 0;
    const quad = radius / Math.max(1, resolution);
    const color = [0, 0, 0];
    const breath = 1 + Math.sin(time * 2.1) * 0.022;

    context.save();
    context.globalAlpha *= shadowAlpha;
    const shadow = context.createRadialGradient(x, y, radius * 0.25, x, y, radius * 1.45);
    shadow.addColorStop(0, "rgba(22, 0, 4, 0.8)");
    shadow.addColorStop(1, "rgba(22, 0, 4, 0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.arc(x, y, radius * 1.45, 0, TAU);
    context.fill();
    context.restore();

    context.save();
    context.globalCompositeOperation = "lighter";
    for (let index = 0; index < tendrilCount; index += 1) {
      const baseAngle = angle + index / tendrilCount * TAU + time * 0.22;
      const wobble = Math.sin(time * 3.1 + index * 1.7) * 0.24;
      const reach = radius * (0.6 + 0.5 * (0.5 + 0.5 * Math.sin(time * 2.3 + index * 2.1)));
      context.strokeStyle = index % 3 === 0
        ? "rgba(240, 162, 154, 0.42)"
        : "rgba(146, 22, 30, 0.5)";
      context.lineWidth = Math.max(0.7, radius * 0.08);
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 1; step <= 3; step += 1) {
        const progress = step / 3;
        const stepAngle = baseAngle + wobble * progress * 2.4;
        const stepRadius = reach * progress;
        context.lineTo(
          x + Math.cos(stepAngle) * stepRadius,
          y + Math.sin(stepAngle) * stepRadius
        );
      }
      context.stroke();
    }
    context.restore();

    context.save();
    context.beginPath();
    const segments = 48;
    for (let index = 0; index <= segments; index += 1) {
      const theta = index / segments * TAU;
      const wobble = 1
        + Math.sin(theta * 3 + time * 2.4) * 0.05
        + Math.sin(theta * 5 - time * 3.7) * 0.03
        + Math.sin(theta * 7 + time * 1.7) * 0.016;
      const pointRadius = radius * wobble * breath;
      const pointX = x + Math.cos(theta) * pointRadius;
      const pointY = y + Math.sin(theta) * pointRadius;
      if (index === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fillStyle = "#300407";
    context.fill();
    context.clip();

    if (field && resolution > 0) {
      field.snapshot(time);
      for (let row = 0; row < resolution; row += 1) {
        const normalizedY = (row + 0.5) / resolution * 2 - 1;
        for (let column = 0; column < resolution; column += 1) {
          const normalizedX = (column + 0.5) / resolution * 2 - 1;
          field.sample(normalizedX, normalizedY, color);
          context.fillStyle = "rgb("
            + Math.round(clamp(color[0], 0, 255)) + ","
            + Math.round(clamp(color[1], 0, 255)) + ","
            + Math.round(clamp(color[2], 0, 255)) + ")";
          context.fillRect(
            x + normalizedX * radius - quad * 0.5,
            y + normalizedY * radius - quad * 0.5,
            quad * 1.1,
            quad * 1.1
          );
        }
      }
    }

    const shineAngle = -Math.PI * 0.72 + Math.sin(time * 1.3) * 0.12;
    const shineX = x + Math.cos(shineAngle) * radius * 0.4;
    const shineY = y + Math.sin(shineAngle) * radius * 0.4;
    const shine = context.createRadialGradient(shineX, shineY, 0, shineX, shineY, radius * 0.7);
    shine.addColorStop(0, "rgba(255, 228, 220, 0.34)");
    shine.addColorStop(1, "rgba(255, 228, 220, 0)");
    context.fillStyle = shine;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    paintFleshLayers(context, {
      x,
      y,
      radius,
      angle,
      time,
      layerCount: Math.max(8, Math.round(radius / 1.8)),
      layerRadiusScale: 0.3,
      lineWidthScale: 0.05,
      scatter: 0.22
    });

    for (let index = 0; index < woundCount; index += 1) {
      const spotAngle = time * (0.3 + 0.2 * hash2(index, 4.4, 2.2)) + index * 2.4 + seed * 0.7;
      const spotDistance = radius * (0.2 + 0.65 * hash2(index, 2.2, 44.4));
      const spotX = x + Math.cos(spotAngle) * spotDistance;
      const spotY = y + Math.sin(spotAngle) * spotDistance;
      const spotRadius = radius * (0.07 + 0.17 * hash2(index, 9.1, 3.3));
      context.globalAlpha = 0.6;
      context.fillStyle = index % 2 === 0 ? "#ff5c60" : "#56070e";
      context.beginPath();
      context.arc(spotX, spotY, spotRadius, 0, TAU);
      context.fill();
      context.globalAlpha = 0.3;
      context.fillStyle = "#ffd8cf";
      context.beginPath();
      context.arc(spotX - spotRadius * 0.28, spotY - spotRadius * 0.32, spotRadius * 0.4, 0, TAU);
      context.fill();
      context.globalAlpha = 1;
    }
    context.restore();

    context.save();
    context.lineWidth = Math.max(1.2, radius * 0.07);
    context.strokeStyle = "rgba(34, 3, 7, 0.85)";
    context.beginPath();
    context.arc(x, y, radius * breath * 0.99, 0, TAU);
    context.stroke();
    context.restore();
  }

  function drawSkinBall(context, ball, time, highlight = false) {
    const radius = ball.radius;
    const wobble = 1 + Math.sin(time * 6.2 + ball.x * 0.11) * 0.08;
    const angle = time * 0.9 + ball.y * 0.05;
    context.save();
    context.fillStyle = "#340508";
    context.beginPath();
    context.arc(ball.x, ball.y, radius * wobble, 0, TAU);
    context.fill();
    paintFleshLayers(context, {
      x: ball.x,
      y: ball.y,
      radius: radius * wobble,
      angle,
      time,
      layerCount: 5,
      layerRadiusScale: 0.72,
      lineWidthScale: 0.1,
      scatter: 0.3
    });
    context.globalAlpha = 0.5;
    context.strokeStyle = FLESH_FIBER;
    context.lineWidth = Math.max(0.5, radius * 0.2);
    context.beginPath();
    const fiberAngle = time * 1.7 + ball.y * 0.05;
    context.moveTo(
      ball.x + Math.cos(fiberAngle) * radius * 0.5,
      ball.y + Math.sin(fiberAngle) * radius * 0.5
    );
    context.lineTo(
      ball.x - Math.cos(fiberAngle) * radius * 0.6,
      ball.y - Math.sin(fiberAngle) * radius * 0.6
    );
    context.stroke();
    context.globalAlpha = 1;
    context.strokeStyle = "rgba(38, 4, 8, 0.8)";
    context.lineWidth = Math.max(0.8, radius * 0.16);
    context.beginPath();
    context.arc(ball.x, ball.y, radius, 0, TAU);
    context.stroke();
    if (highlight) {
      context.globalCompositeOperation = "lighter";
      context.globalAlpha = 0.45 + 0.3 * Math.sin(time * 12);
      context.strokeStyle = "#ffd0c6";
      context.lineWidth = 1;
      context.beginPath();
      context.arc(ball.x, ball.y, radius * 1.3, 0, TAU);
      context.stroke();
    }
    context.restore();
  }

  function drawTentacle(context, options) {
    const { x, y, tipX, tipY, time, length, maxLength, thickness, tint } = options;
    const slack = clamp(1 - length / Math.max(EPSILON, maxLength), 0, 1);
    const steps = 10;
    const normalX = length <= EPSILON ? 0 : -(tipY - y) / length;
    const normalY = length <= EPSILON ? 0 : (tipX - x) / length;
    const points = [];
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const wobble = Math.sin(progress * Math.PI) * slack * thickness * 2.4
        * Math.sin(time * 6 - progress * 4.2);
      points.push([
        x + (tipX - x) * progress + normalX * wobble,
        y + (tipY - y) * progress + normalY * wobble
      ]);
    }
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    for (let pass = 0; pass < 2; pass += 1) {
      context.strokeStyle = pass === 0 ? (tint || "#6f1119") : "#e6a89c";
      context.lineWidth = pass === 0 ? thickness : thickness * 0.42;
      context.beginPath();
      context.moveTo(points[0][0], points[0][1]);
      for (let step = 1; step <= steps; step += 1) {
        context.lineTo(points[step][0], points[step][1]);
      }
      context.stroke();
    }
    context.fillStyle = "#a5212b";
    context.beginPath();
    context.arc(tipX, tipY, thickness, 0, TAU);
    context.fill();
    context.fillStyle = "#f0b6a9";
    context.beginPath();
    context.arc(tipX - thickness * 0.2, tipY - thickness * 0.2, thickness * 0.42, 0, TAU);
    context.fill();
    context.restore();
  }

  function spawnFleshBurst(services, x, y, count = 18, speed = 90) {
    services.spawnParticleBurst({
      kind: "yi-wan-ren-flesh-burst",
      x,
      y,
      count,
      minDiameter: 1,
      maxDiameter: 4,
      minSpeed: speed * 0.4,
      maxSpeed: speed,
      initialRadius: 4,
      life: 0.42,
      drag: 3.2,
      colors: ["#8e1b22", "#d0565c", "#f0a29a", "#5e0a11"]
    });
  }

  // 0.05 秒二倍速击退：把目标沿远离头部的方向甩出去，锁住输入，
  // 效果结束后速度退回它自己的上限，所以是「击退」而不是「钉死」。
  function createLungeKnockback(directionX, directionY) {
    return createSharedKnockback({
      id: "yi-wan-ren-lunge-knockback",
      duration: LUNGE_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: LUNGE_KNOCKBACK_MULTIPLIER
    });
  }
  function createStunEffect() {
    return {
      id: "yi-wan-ren-stun",
      visualType: "stun",
      duration: SHOCKWAVE_STUN_DURATION,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true
    };
  }

  // ---------- 血肉球的定义 ----------

  const YI_WAN_REN_SUMMON_ID = "yiWanRenSummon";
  // 分裂出来的子球共用同一个定义 id：人口预算和本体死亡时的清理都要看它。
  const SPLIT_CHILD_ID = "yiWanRenSplitChild";

  // 分裂出来的两个小肉球：血量为 1、碰撞伤害为 1。
  const splitChildDefinition = {
    id: SPLIT_CHILD_ID,
    name: "\u5206\u88c2\u8089\u7403",
    englishName: "Split Flesh",
    color: BODY_COLOR,
    renderAboveGpuEffects: true,
    description: "\u4ebf\u4e07\u4eba\u5206\u88c2\u51fa\u6765\u7684\u8840\u8089\u5c0f\u7403",
    stats: {
      radius: SPLIT_CHILD_RADIUS,
      speed: SUMMON_SPEED,
      maxHp: SUMMON_HP
    },
    createBehavior(services) {
      let heading = null;
      return createSummonBase(services, {
        update(context) {
          const ball = context.ball;
          if (!heading) heading = normalizeDirection(ball.vx, ball.vy);
          // 分裂出来的肉球按自己的航向漂移，撞墙由引擎反弹。
          drive(ball, heading, ball.speed * ball.speedMultiplier);
        },
        onCollision(context, target) {
          context.services.dealDamage(target, CONTACT_DAMAGE);
        }
      });
    }
  };

  function createSummonDefinition(variant, createBehavior) {
    return {
      id: YI_WAN_REN_SUMMON_ID,
      name: "\u8840\u8089\u7403",
      englishName: "Flesh Orb",
      color: BODY_COLOR,
      renderAboveGpuEffects: true,
      description: variant,
      stats: {
        radius: SUMMON_RADIUS,
        speed: SUMMON_SPEED,
        maxHp: SUMMON_HP
      },
      createBehavior
    };
  }

  // 七种球随机出现：外观、血量、移速完全一致，只有攻击方式不同。
  const yiWanRenSummonDefinitions = [
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u89e6\u624b\uff08\u957f\u5ea6 20\u3001\u63a5\u89e6\u4f24\u5bb3 2\uff09",
      createTentacleSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u86c6\u72b6\u722c\u884c\uff082 \u79d2\u540e\u65e0\u654c\u4f38\u8eab 40\uff09",
      createCrawlerSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u8840\u8089\u5f39\uff08\u6bcf\u79d2\u4e00\u53d1\u3001\u901f\u5ea6 150\u3001\u4f24\u5bb3 1\uff09",
      createFleshBulletSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u5206\u88c2\u8840\u7403\uff08\u78b0\u649e\u4f24\u5bb3 1\u3001\u6bcf 5 \u79d2\u4e00\u5206\u4e3a\u4e8c\uff09",
      createSplitSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u77ed\u72b6\u89e6\u624b\uff08\u957f\u5ea6 8\u3001\u6bcf\u79d2\u8f6c 3 \u5708\u3001\u4f24\u5bb3 1\uff09",
      createWhipSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u5f39\u8df3\u8840\u7403\uff08\u51b2\u51fb\u6ce2\u534a\u5f84 20\u3001\u7729\u6655 0.2 \u79d2\uff09",
      createHopperSummonBehavior
    ),
    createSummonDefinition(
      "\u4ebf\u4e07\u4eba\uff1a\u788e\u88c2\u5c16\u7259\uff08\u6b7b\u540e\u5728\u534a\u5f84 10 \u5185\u6389\u843d 1-2 \u5757\u5c16\u7259\u3001\u63a5\u89e6\u4f24\u5bb3 1\uff09",
      createFangSummonBehavior
    )
  ];

  // ---------- 七种召唤体：外观一致，打法不同 ----------

  function createSummonBase(services, options = {}) {
    const {
      update,
      render = null,
      getContactProfile: contactProfile = null,
      transitions = null,
      ...hooks
    } = options;
    let reabsorbed = false;
    const behavior = {
      update(context, dt) {
        const elapsed = finiteDelta(dt);
        const ball = context.ball;
        update(context, elapsed);
        const alive = context.game.time - (ball.spawnedAt || 0);
        if (alive >= SUMMON_LIFESPAN) {
          if (!reabsorbed) {
            reabsorbed = true;
            // 寿命到点被本体吸收：需要留东西在场地上的变体在这里补上。
            if (typeof hooks.onReabsorb === "function") hooks.onReabsorb(context);
          }
          // 寿命到点后被本体吸收：先渐隐，再移除，场上始终是新钻进来的肉。
          ball.fade = clamp(1 - (alive - SUMMON_LIFESPAN) / SUMMON_FADE, 0, 1);
          if (alive >= SUMMON_LIFESPAN + SUMMON_FADE) {
            ball.hp = 0;
            ball.active = false;
            ball.fade = 0;
            ball.deathNotified = true;
            ball.diedAt = null;
          }
        }
      },
      // 绘制钩子的第二个形参才是画布，第一个是 ball/game/services 上下文。
      drawBody(context, canvasContext) {
        const ball = context.ball;
        if (typeof render === "function") render(ball, context.game.time, canvasContext);
        else drawSkinBall(canvasContext, ball, context.game.time, false);
        return true;
      },
      getHpDisplay() {
        // 1 点血的肉球不显示血条：几十个重叠的 "1" 只会糊成一团。
        return { hidden: true };
      }
    };
    // 其余钩子（onCollision / onWallBounce / onDamaged ...）原样透传给引擎。
    for (const [name, hook] of Object.entries(hooks)) {
      if (typeof hook === "function") behavior[name] = hook;
    }
    if (typeof contactProfile === "function") {
      behavior.getContactProfile = contactProfile;
    }
    if (typeof transitions === "function") {
      behavior.getNextTransitionIn = transitions;
    }
    return behavior;
  }

  function creepToward(ball, services) {
    const target = services.getOpponent();
    if (!target) return;
    drive(ball, directionTo(ball, target), SUMMON_SPEED);
  }

  // 接触伤害：和引擎的身体接触同一个语义 —— 敌人「进入」这条血肉触手的瞬间
  // 结算一次伤害，离开接触范围后才重新武装。持续贴着的敌人不会被每帧反复扣血。
  function sweepContactHit(services, options) {
    const { startX, startY, endX, endY, hitRadius, damage, contacts, onHit } = options;
    services.forEachEnemy((enemy) => {
      const key = creatureKey(enemy);
      const distance = pointToSegmentDistance(
        enemy.x, enemy.y, startX, startY, endX, endY
      );
      if (distance > enemy.radius + hitRadius) {
        contacts.delete(key);
        return;
      }
      if (contacts.has(key)) return;
      if (!services.dealDamage(enemy, damage)) return;
      contacts.add(key);
      if (typeof onHit === "function" && enemy.hp > 0) onHit(enemy);
    });
  }

  // 1. 触手：附着端点随移动方向迁移，拉满 20 之后钉在原地等本体游回来。
  function createTentacleSummonBehavior(services) {
    let anchorX = null;
    let anchorY = null;
    const contacts = new Set();

    function migrateAnchor(ball) {
      const deltaX = anchorX - ball.x;
      const deltaY = anchorY - ball.y;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance <= TENTACLE_MAX_LENGTH + EPSILON) return;
      const pull = distance - TENTACLE_MAX_LENGTH;
      anchorX -= deltaX / distance * pull;
      anchorY -= deltaY / distance * pull;
    }

    return createSummonBase(services, {
      update(context) {
        const ball = context.ball;
        if (anchorX === null) {
          const direction = normalizeDirection(ball.vx, ball.vy);
          anchorX = ball.x - direction.x * TENTACLE_MAX_LENGTH;
          anchorY = ball.y - direction.y * TENTACLE_MAX_LENGTH;
        }
        creepToward(ball, services);
        migrateAnchor(ball);
        sweepContactHit(services, {
          startX: ball.x,
          startY: ball.y,
          endX: anchorX,
          endY: anchorY,
          hitRadius: TENTACLE_HIT_RADIUS,
          damage: TENTACLE_DAMAGE,
          contacts
        });
      },
      render(ball, time, canvas) {
        const tipX = anchorX === null ? ball.x : anchorX;
        const tipY = anchorY === null ? ball.y : anchorY;
        const length = Math.hypot(tipX - ball.x, tipY - ball.y);
        drawSkinBall(canvas, ball, time, false);
        drawTentacle(canvas, {
          x: ball.x,
          y: ball.y,
          tipX,
          tipY,
          time,
          length,
          maxLength: TENTACLE_MAX_LENGTH,
          thickness: Math.max(1.6, ball.radius * 0.42),
          tint: "#761319"
        });
      }
    });
  }

  // 2. 蛆状爬行：爬 2 秒 -> 无敌停住、把头伸到 40 -> 尾部收回 -> 继续爬。
  function createCrawlerSummonBehavior(services) {
    const CRAWL = "crawl";
    const STRETCH = "stretch";
    const RETRACT = "retract";
    let phase = CRAWL;
    let phaseTime = 0;
    let headDistance = 0;
    let headSpeed = 0;
    let headTime = 0;
    let headingX = 1;
    let headingY = 0;
    let stopped = false;
    const contacts = new Set();

    function holdStill(ball) {
      stopped = true;
      ball.vx = ball.storedVx = 0;
      ball.vy = ball.storedVy = 0;
      ball.speedNeedsNormalization = false;
    }

    // 击退方向：优先沿「目标偏离头部」的方向，退化时用目标相对本体的方向。
    function knockbackDirection(ball, target, headX, headY) {
      const awayX = target.x - headX;
      const awayY = target.y - headY;
      if (Math.hypot(awayX, awayY) > EPSILON) return { x: awayX, y: awayY };
      const travelX = target.x - ball.x;
      const travelY = target.y - ball.y;
      if (Math.hypot(travelX, travelY) > EPSILON) return { x: travelX, y: travelY };
      return { x: headingX, y: headingY };
    }

    function headRadiusFor(ball) {
      return ball.radius * (1 + (headDistance / LUNGE_MAX_DISTANCE) * LUNGE_HEAD_GROWTH);
    }

    // 对称梯形：前 half 距离加速到 100，后 half 距离刹停，总时长 LUNGE_STRETCH_TIME。
    function stretchDistance(elapsedSinceStretch) {
      const accelTime = LUNGE_SPEED_MAX / LUNGE_ACCELERATION;
      if (elapsedSinceStretch <= accelTime) {
        return 0.5 * LUNGE_ACCELERATION * elapsedSinceStretch * elapsedSinceStretch;
      }
      const brakeTime = Math.min(elapsedSinceStretch - accelTime, accelTime);
      return Math.min(
        LUNGE_MAX_DISTANCE,
        LUNGE_HALF_DISTANCE + LUNGE_SPEED_MAX * brakeTime -
          0.5 * LUNGE_ACCELERATION * brakeTime * brakeTime
      );
    }

    function stretchSpeed(elapsedSinceStretch) {
      const accelTime = LUNGE_SPEED_MAX / LUNGE_ACCELERATION;
      if (elapsedSinceStretch <= accelTime) {
        return LUNGE_ACCELERATION * elapsedSinceStretch;
      }
      return Math.max(0, LUNGE_SPEED_MAX - LUNGE_ACCELERATION * (elapsedSinceStretch - accelTime));
    }

    return createSummonBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        phaseTime += elapsed;
        if (phase === CRAWL) {
          if (!stopped) creepToward(ball, services);
          if (phaseTime + EPSILON >= CRAWL_DURATION) {
            phase = STRETCH;
            phaseTime = 0;
            headDistance = 0;
            headSpeed = 0;
            headTime = 0;
            const target = services.getOpponent();
            const direction = target
              ? directionTo(ball, target)
              : normalizeDirection(ball.vx, ball.vy);
            headingX = direction.x;
            headingY = direction.y;
            holdStill(ball);
          }
          return;
        }
        holdStill(ball);
        if (phase === STRETCH) {
          // 头部速度线性提升到 100，到 40 距离时正好被线性刹停（对称梯形）。
          headTime += elapsed;
          headDistance = Math.min(LUNGE_MAX_DISTANCE, stretchDistance(headTime));
          headSpeed = stretchSpeed(elapsed);
          if (headTime + EPSILON >= LUNGE_STRETCH_TIME) {
            phase = RETRACT;
            phaseTime = 0;
            headSpeed = 0;
          }
        } else {
          headDistance = Math.max(0, headDistance - LUNGE_RETRACT_SPEED * elapsed);
          if (headDistance <= EPSILON) {
            headDistance = 0;
            phase = CRAWL;
            phaseTime = 0;
            stopped = false;
          }
        }
        // 头还在体外时，伸长的躯体带 2 点碰撞伤害与二倍速击退；
        // 尾部落回体内后这一段重新变成普通的 1 点接触伤害。
        if (headDistance <= EPSILON) {
          // 尾部落回体内：这一段结束，接触记录清空，下一次伸头重新武装。
          contacts.clear();
          return;
        }
        const headX = ball.x + headingX * headDistance;
        const headY = ball.y + headingY * headDistance;
        sweepContactHit(services, {
          startX: headX,
          startY: headY,
          endX: headX,
          endY: headY,
          hitRadius: headRadiusFor(ball),
          damage: LUNGE_BODY_DAMAGE,
          contacts,
          onHit(target) {
            const direction = knockbackDirection(ball, target, headX, headY);
            services.applyEffect(target, createLungeKnockback(direction.x, direction.y));
          }
        });
      },
      render(ball, time, canvas) {
        if (phase === CRAWL) {
          drawSkinBall(canvas, ball, time, false);
          return;
        }
        // 伸出去的身体：一串从本体到头部逐渐变粗的肉节。
        const headX = ball.x + headingX * headDistance;
        const headY = ball.y + headingY * headDistance;
        const headRadius = headRadiusFor(ball);
        canvas.save();
        for (let step = 0; step <= 8; step += 1) {
          const progress = step / 8;
          const segmentRadius = ball.radius * (0.82 + 0.3 * progress);
          canvas.fillStyle = step % 2 === 0 ? "#7c141b" : "#a2262e";
          canvas.beginPath();
          canvas.arc(
            ball.x + (headX - ball.x) * progress,
            ball.y + (headY - ball.y) * progress,
            Math.max(1.4, segmentRadius),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
        drawSkinBall(canvas, ball, time, false);
        canvas.save();
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = 0.5;
        canvas.fillStyle = "#ffb0a6";
        canvas.beginPath();
        canvas.arc(headX, headY, headRadius * 0.9, 0, TAU);
        canvas.fill();
        canvas.restore();
      },
      getContactProfile() {
        // 伸长期间无敌：运动停止，且不再被选为目标（仍然挡路）。
        return phase === CRAWL ? null : { targetable: false };
      }
    });
  }

  // 3. 发射血肉弹：每秒一发，速度 150，伤害 1。
  function createFleshBullet(ball, direction) {
    return {
      kind: "yi-wan-ren-flesh-bullet",
      life: FLESH_BULLET_LIFE,
      radius: FLESH_BULLET_RADIUS,
      damage: FLESH_BULLET_DAMAGE,
      combatKind: "projectile",
      color: BODY_COLOR,
      x: ball.x,
      y: ball.y,
      vx: direction.x * FLESH_BULLET_SPEED,
      vy: direction.y * FLESH_BULLET_SPEED,
      update({ effect, game, services: entityServices }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const hit = entityServices.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          FLESH_BULLET_RADIUS
        );
        if (hit && entityServices.dealDamage(hit, FLESH_BULLET_DAMAGE)) {
          spawnFleshBurst(entityServices, effect.x, effect.y, 10, 60);
          effect.life = 0;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, 24)
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, context) {
        const angle = Math.atan2(effect.vy, effect.vx);
        context.save();
        context.globalAlpha *= 0.45;
        context.strokeStyle = "#b32b2f";
        context.lineWidth = effect.radius * 1.6;
        context.beginPath();
        context.moveTo(
          effect.x - Math.cos(angle) * effect.radius * 3.4,
          effect.y - Math.sin(angle) * effect.radius * 3.4
        );
        context.lineTo(effect.x, effect.y);
        context.stroke();
        context.globalAlpha = 1;
        context.fillStyle = "#8e1b22";
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, TAU);
        context.fill();
        context.fillStyle = "#f0a29a";
        context.beginPath();
        context.arc(
          effect.x - effect.radius * 0.25,
          effect.y - effect.radius * 0.25,
          effect.radius * 0.45,
          0,
          TAU
        );
        context.fill();
        context.restore();
      }
    };
  }

  function createFleshBulletSummonBehavior(services) {
    // 计数器从一整秒开始：钻进场的第一步就打出第一发，之后每秒一发。
    let timer = FLESH_BULLET_INTERVAL;
    return createSummonBase(services, {
      transitions() {
        return Math.max(SPAWN_INTERVAL, FLESH_BULLET_INTERVAL - timer);
      },
      update(context, elapsed) {
        const ball = context.ball;
        creepToward(ball, services);
        timer += elapsed;
        while (timer + EPSILON >= FLESH_BULLET_INTERVAL) {
          timer -= FLESH_BULLET_INTERVAL;
          const target = services.getOpponent();
          const direction = target
            ? directionTo(ball, target)
            : normalizeDirection(ball.vx, ball.vy);
          services.spawnProjectile(createFleshBullet(ball, direction));
        }
      }
    });
  }

  // 4. 碰撞伤害 1，每 5 秒分裂成两个血量 1、碰撞伤害 1 的球。
  function createSplitSummonBehavior(services) {
    let timer = 0;
    let split = false;
    return createSummonBase(services, {
      transitions() {
        return Math.max(SPAWN_INTERVAL, SPLIT_INTERVAL - timer);
      },
      update(context, elapsed) {
        if (split) return;
        const ball = context.ball;
        creepToward(ball, services);
        timer += elapsed;
        if (timer + EPSILON < SPLIT_INTERVAL) return;
        split = true;
        const baseAngle = Math.random() * TAU;
        for (let index = 0; index < 2; index += 1) {
          const angle = baseAngle + index * Math.PI;
          const headingX = Math.cos(angle);
          const headingY = Math.sin(angle);
          const child = placeSummon(services, splitChildDefinition, {
            x: ball.x + headingX * 4,
            y: ball.y + headingY * 4,
            vx: headingX * SPLIT_PUSH_SPEED,
            vy: headingY * SPLIT_PUSH_SPEED
          });
          if (child) {
            // 复用来的子球要自己回到分裂点上。
            child.x = ball.x + headingX * 4;
            child.y = ball.y + headingY * 4;
            child.prevX = child.x;
            child.prevY = child.y;
            child.vx = child.storedVx = headingX * SPLIT_PUSH_SPEED;
            child.vy = child.storedVy = headingY * SPLIT_PUSH_SPEED;
            child.speedNeedsNormalization = false;
          }
        }
        spawnFleshBurst(services, ball.x, ball.y, 22, 110);
        services.spawnParticleBurst({
          kind: "yi-wan-ren-split-ring",
          x: ball.x,
          y: ball.y,
          count: 8,
          minDiameter: 2,
          maxDiameter: 4,
          minSpeed: 40,
          maxSpeed: 70,
          life: 0.35,
          colors: ["#e9b7ac", "#8e1b22"],
          ring: {
            color: "#ff9d94",
            lineWidth: 1.5,
            startRadius: 3,
            endRadius: 22
          }
        });
        // 一团肉裂成两团：本体原地消失，两团新的血肉接管它的位置。
        ball.hp = 0;
        ball.active = false;
        ball.fade = 0;
        ball.deathNotified = true;
        ball.diedAt = null;
      },
      onCollision(context, target) {
        context.services.dealDamage(target, CONTACT_DAMAGE);
      }
    });
  }

  // 5. 短状触手：固态，顺时针绕本体 3 圈/秒，接触伤害 1。
  function createWhipSummonBehavior(services) {
    let angle = Math.random() * TAU;
    const contacts = new Set();
    return createSummonBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        creepToward(ball, services);
        angle = (angle + WHIP_TURN_RATE * elapsed) % TAU;
        sweepContactHit(services, {
          startX: ball.x,
          startY: ball.y,
          endX: ball.x + Math.cos(angle) * WHIP_LENGTH,
          endY: ball.y + Math.sin(angle) * WHIP_LENGTH,
          hitRadius: WHIP_THICKNESS,
          damage: WHIP_DAMAGE,
          contacts
        });
      },
      render(ball, time, canvas) {
        drawSkinBall(canvas, ball, time, false);
        const tipX = ball.x + Math.cos(angle) * WHIP_LENGTH;
        const tipY = ball.y + Math.sin(angle) * WHIP_LENGTH;
        canvas.save();
        canvas.lineCap = "round";
        canvas.strokeStyle = "rgba(80, 10, 16, 0.9)";
        canvas.lineWidth = WHIP_THICKNESS * 2.2;
        canvas.beginPath();
        canvas.moveTo(ball.x, ball.y);
        canvas.lineTo(tipX, tipY);
        canvas.stroke();
        canvas.strokeStyle = "#c8454b";
        canvas.lineWidth = WHIP_THICKNESS * 1.1;
        canvas.beginPath();
        canvas.moveTo(ball.x, ball.y);
        canvas.lineTo(tipX, tipY);
        canvas.stroke();
        canvas.globalCompositeOperation = "lighter";
        canvas.strokeStyle = "rgba(255, 196, 186, 0.55)";
        canvas.lineWidth = WHIP_THICKNESS * 0.4;
        canvas.beginPath();
        canvas.moveTo(ball.x, ball.y);
        canvas.lineTo(tipX, tipY);
        canvas.stroke();
        canvas.restore();
      }
    });
  }

  // 6. 可以弹跳的小球：沿抛物线弹跳，落地冲击波让敌人眩晕 0.2 秒。
  function createHopperSummonBehavior(services) {
    let hopTimer = HOP_INTERVAL;
    let hop = null;
    const stunnedThisLanding = new Set();
    return createSummonBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        if (hop) {
          hop.elapsed += elapsed;
          const progress = clamp(hop.elapsed / HOP_AIR_DURATION, 0, 1);
          // 抛物线：水平线性推进，高度按 4h t (1-t) 起落。
          ball.x = hop.startX + (hop.endX - hop.startX) * progress;
          ball.y = hop.startY + (hop.endY - hop.startY) * progress;
          hop.height = HOP_ARC_HEIGHT * 4 * progress * (1 - progress);
          ball.vx = ball.storedVx = 0;
          ball.vy = ball.storedVy = 0;
          ball.speedNeedsNormalization = false;
          if (progress < 1) return;
          const landingX = hop.endX;
          const landingY = hop.endY;
          ball.x = landingX;
          ball.y = landingY;
          hop = null;
          stunnedThisLanding.clear();
          services.spawnVisualEffect(createShockwaveEffect(landingX, landingY));
          spawnFleshBurst(services, landingX, landingY, 16, 80);
          services.forEachEnemy((enemy) => {
            const key = creatureKey(enemy);
            if (stunnedThisLanding.has(key)) return;
            if (
              Math.hypot(enemy.x - landingX, enemy.y - landingY) >
              SHOCKWAVE_RADIUS + enemy.radius
            ) {
              return;
            }
            stunnedThisLanding.add(key);
            services.applyEffect(enemy, createStunEffect());
          });
          hopTimer = 0;
          return;
        }
        // 落地等待期里继续爬行靠近敌人。
        creepToward(ball, services);
        hopTimer += elapsed;
        if (hopTimer + EPSILON < HOP_INTERVAL) return;
        hopTimer = 0;
        // 弹跳方向朝敌人偏斜：这样落地的冲击波才真的盖住敌人，
        // 而不是把一秒一次的弹跳浪费在空地上。
        const target = services.getOpponent();
        const aim = target
          ? Math.atan2(target.y - ball.y, target.x - ball.x)
          : Math.atan2(ball.vy, ball.vx);
        const angle = aim + (Math.random() * 2 - 1) * HOP_SPREAD;
        const distance = HOP_RANGE * (0.5 + 0.5 * Math.random());
        const destination = resolveArenaGeometry(context.game).clampPoint(ball.x + Math.cos(angle) * distance, ball.y + Math.sin(angle) * distance, ball.radius);
        hop = {
          elapsed: 0,
          startX: ball.x,
          startY: ball.y,
          endX: destination.x,
          endY: destination.y,
          height: 0
        };
      },
      render(ball, time, canvas) {
        // 空中时球体抬起，下面留一条影子，读起来就是抛物线。
        const jumpHeight = hop ? hop.height : 0;
        if (jumpHeight > 0.5) {
          canvas.save();
          canvas.globalAlpha = 0.3 * (1 - jumpHeight / HOP_ARC_HEIGHT);
          canvas.fillStyle = "#1d0205";
          canvas.beginPath();
          canvas.ellipse(
            ball.x,
            ball.y + ball.radius * 1.1,
            ball.radius * 1.2,
            ball.radius * 0.4,
            0,
            0,
            TAU
          );
          canvas.fill();
          canvas.restore();
        }
        canvas.save();
        canvas.translate(0, -jumpHeight);
        drawSkinBall(canvas, ball, time, false);
        canvas.restore();
      }
    });
  }

  function createShockwaveEffect(x, y) {
    return {
      kind: "yi-wan-ren-shockwave",
      life: 0.32,
      radius: SHOCKWAVE_RADIUS,
      x,
      y,
      update({ effect, game }) {
        if (game.state !== "running") effect.life = 0;
      },
      draw({ effect }, context) {
        const fade = clamp(1 - (effect.age || 0) / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = fade * 0.75;
        context.strokeStyle = "#ffb7ad";
        context.lineWidth = 2.4;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          SHOCKWAVE_RADIUS * (0.4 + 0.6 * (1 - fade)),
          0,
          TAU
        );
        context.stroke();
        context.restore();
      }
    };
  }

  // 7. 碎裂尖牙：本体死后在半径 10 内掉落 1-2 块尖牙，敌人碰到即掉 1 血。
  function drawFang(canvas, entity, time) {
    const pulse = 1 + Math.sin(time * 5.5 + entity.x * 0.17) * 0.06;
    const length = FANG_RADIUS * 3.1 * pulse;
    const halfWidth = FANG_RADIUS * 0.72;
    canvas.save();
    canvas.translate(entity.x, entity.y);
    canvas.rotate(entity.angle);
    // 牙根那一圈血渍：告诉玩家这块牙还咬着肉。
    canvas.globalAlpha *= 0.6;
    canvas.fillStyle = "#4a0a10";
    canvas.beginPath();
    canvas.ellipse(-FANG_RADIUS * 0.2, 0, FANG_RADIUS * 1.5, FANG_RADIUS, 0, 0, TAU);
    canvas.fill();
    canvas.globalAlpha = 1;
    // 牙尖：从牙根收成一点。
    canvas.beginPath();
    canvas.moveTo(-FANG_RADIUS * 0.7, -halfWidth);
    canvas.lineTo(length, 0);
    canvas.lineTo(-FANG_RADIUS * 0.7, halfWidth);
    canvas.closePath();
    canvas.fillStyle = "#efe2d6";
    canvas.fill();
    canvas.strokeStyle = "#8c5a4d";
    canvas.lineWidth = 0.7;
    canvas.stroke();
    canvas.fillStyle = "#a5212b";
    canvas.beginPath();
    canvas.arc(-FANG_RADIUS * 0.62, 0, FANG_RADIUS * 0.5, 0, TAU);
    canvas.fill();
    canvas.restore();
  }

  // 尖牙是留在场地上的陷阱实体：碰到敌人的那一刻结算 1 点伤害并断在原地。
  function createFangEntity(x, y, angle, spin) {
    return {
      kind: "yi-wan-ren-fang",
      combatKind: "trap",
      trap: true,
      life: FANG_LIFE,
      radius: FANG_RADIUS,
      x,
      y,
      angle,
      spin,
      update({ entity, game, services: entityServices }, dt) {
        if (game.state !== "running") {
          entity.life = 0;
          return;
        }
        entity.angle += entity.spin * dt;
        entityServices.forEachEnemy((enemy) => {
          if (entity.entityActive === false) return;
          if (
            Math.hypot(enemy.x - entity.x, enemy.y - entity.y) >
            FANG_RADIUS + enemy.radius
          ) {
            return;
          }
          if (!entityServices.dealDamage(enemy, FANG_DAMAGE)) return;
          // 牙咬进肉里：命中一次就消失，同一块牙不会反复扣血。
          entity.entityActive = false;
          spawnFleshBurst(entityServices, entity.x, entity.y, 8, 55);
        });
      },
      draw({ entity }, canvas) {
        drawFang(canvas, entity, entity.age || 0);
      }
    };
  }

  function createFangSummonBehavior(services) {
    let shattered = false;

    // 碎裂只结算一次：被击杀和寿命到点都走这里。
    function shatter(context) {
      if (shattered) return;
      shattered = true;
      const ball = context.ball;
      const drops = FANG_DROP_MIN +
        Math.floor(Math.random() * (FANG_DROP_MAX - FANG_DROP_MIN + 1));
      for (let index = 0; index < drops; index += 1) {
        const angle = Math.random() * TAU;
        // sqrt 让落点铺满半径 10 的圆面，而不是挤在圆心。
        const distance = FANG_DROP_RADIUS * Math.sqrt(Math.random());
        const point = resolveArenaGeometry(context.game).clampPoint(ball.x + Math.cos(angle) * distance, ball.y + Math.sin(angle) * distance, FANG_RADIUS);
        services.spawnCombatEntity(createFangEntity(
          point.x, point.y,
          Math.random() * TAU,
          (Math.random() * 2 - 1) * FANG_SPIN
        ));
      }
      spawnFleshBurst(services, ball.x, ball.y, 22, 110);
    }

    return createSummonBase(services, {
      update(context) {
        creepToward(context.ball, services);
      },
      onDeath(context) {
        shatter(context);
      },
      onReabsorb(context) {
        shatter(context);
      }
    });
  }

  // ---------- 本体：亿万人 ----------

  const fleshSkins = new WeakMap();

  function skinFor(ball) {
    let entry = fleshSkins.get(ball);
    if (!entry) {
      entry = {
        seed: Math.random() * 37,
        field: createFleshSkin({ seed: Math.random() * 37 })
      };
      fleshSkins.set(ball, entry);
    }
    return entry;
  }

  // 复用死掉的血肉：引擎的 balls 数组只增不减，一局里每 0.02 秒新建一团会让
  // 几百具尸体永久留在逐帧遍历和回放帧里。换一个行为、洗掉状态、重置寿命，
  // 这团肉就是新的一团 —— 场上活着的数量不变，尸体不堆积。
  function findRecyclableSummon(services, id) {
    const pool = services.getSummons(id);
    for (let index = 0; index < pool.length; index += 1) {
      const candidate = pool[index];
      if (candidate.hp <= 0 || candidate.active === false) return candidate;
    }
    return null;
  }

  function reviveSummon(ball, definition, services) {
    for (const effectId of Array.from(ball.effects.keys())) {
      services.clearEffect(ball, effectId);
    }
    ball.definition = definition;
    ball.behavior = definition.createBehavior(ball.services || services);
    ball.hp = ball.maxHp;
    ball.active = true;
    ball.deathNotified = false;
    ball.diedAt = null;
    ball.fade = 1;
    ball.statusRevision = (ball.statusRevision || 0) + 1;
    ball.spawnedAt = typeof services.getTime === "function" ? services.getTime() : ball.spawnedAt;
    ball.isSummon = true;
    return ball;
  }

  function placeSummon(services, definition, spawn) {
    const recycled = findRecyclableSummon(services, definition.id);
    if (recycled) return reviveSummon(recycled, definition, services);
    return services.spawnSummon(definition, spawn);
  }

  function spawnSummonAtEdge(services, arenaSize) {
    const radius = SUMMON_RADIUS;
    const progress = Math.random();
    const side = Math.floor(Math.random() * 4);
    const arena = resolveArenaGeometry(arenaSize);
    const edge = arena.boundaryPoint(["top", "right", "bottom", "left"][side], progress);
    const x = edge.x - edge.normalX * radius, y = edge.y - edge.normalY * radius;
    const inwardX = edge.normalX, inwardY = edge.normalY;
    const magnitude = 1;
    const definition = yiWanRenSummonDefinitions[
      Math.floor(Math.random() * yiWanRenSummonDefinitions.length)
    ];
    const inwardVx = inwardX / magnitude * SUMMON_SPEED;
    const inwardVy = inwardY / magnitude * SUMMON_SPEED;
    const summon = placeSummon(services, definition, {
      x, y, vx: inwardVx, vy: inwardVy
    });
    if (!summon) return null;
    // spawnSummon 会把越界坐标夹回场内，这里放回场外：第一子步里引擎的墙面
    // 处理会把它夹到边线上、朝向不变，读起来就是从场外沿着边界钻了进来。
    // （这里不能用 arenaWrap：那会让左边缘钻进来的血肉直接瞬移到右边缘。）
    const outside = radius * 2;
    summon.x = edge.x - edge.normalX * outside;
    summon.y = edge.y - edge.normalY * outside;
    summon.prevX = summon.x;
    summon.prevY = summon.y;
    summon.spawnX = summon.x;
    summon.spawnY = summon.y;
    // 入场标记：这团血肉是从场外边缘钻进来的（供渲染/回放识别）。
    summon.enteringArena = true;
    summon.vx = summon.storedVx = inwardVx;
    summon.vy = summon.storedVy = inwardVy;
    return summon;
  }

  const yiWanRenDefinition = {
    id: "yiWanRen",
    name: "\u4ebf\u4e07\u4eba",
    rosterType: "outOfSpec",
    englishName: "Myriads",
    color: BODY_COLOR,
    renderAboveGpuEffects: true,
    rionCycleDuration: 30,
    description: "\u666e\u901a\u7403 / \u6bcf 0.02 \u79d2\u4ece\u573a\u5916\u94bb\u8fdb\u4e00\u56e2\u8840\u8089 / \u89e6\u624b\u00b7\u86c6\u00b7\u8840\u8089\u5f39\u00b7\u5206\u88c2\u00b7\u77ed\u89e6\u624b\u00b7\u5f39\u8df3\u00b7\u788e\u88c2\u5c16\u7259 \u4e03\u79cd\u5c0f\u7403 / \u672c\u4f53\u4e0d\u65ad\u8815\u52a8",
    stats: {
      radius: BODY_RADIUS,
      speed: BODY_SPEED,
      maxHp: BODY_HP
    },
    createBehavior(services) {
      let spawnTimer = 0;
      let headingAngle = 0;
      let dripTimer = 0;

      function summonList() {
        return services.getSummons(YI_WAN_REN_SUMMON_ID);
      }

      // 本体的小球、分裂出来的子球共用一份人口预算：场上活着的血肉总数
      // 就是帧成本，召唤速率再高也不会把这一条撑破。
      function livingSummons() {
        return summonList().concat(services.getSummons(SPLIT_CHILD_ID));
      }

      function activeSummonCount() {
        const summons = livingSummons();
        let count = 0;
        for (let index = 0; index < summons.length; index += 1) {
          const summon = summons[index];
          if (summon.active !== false && summon.hp > 0) count += 1;
        }
        return count;
      }

      function releaseSummons() {
        // 本体消失后，场上的血肉（连分裂出来的子球）都会跟着化掉。
        const summons = livingSummons();
        for (let index = 0; index < summons.length; index += 1) {
          const summon = summons[index];
          if (summon.active === false) continue;
          summon.hp = 0;
          summon.active = false;
          summon.fade = 0;
          summon.deathNotified = true;
          summon.diedAt = null;
        }
      }

      return {
        update(context, dt) {
          const ball = context.ball;
          const elapsed = finiteDelta(dt);
          const target = services.getOpponent();
          if (target) {
            const direction = directionTo(ball, target);
            headingAngle = Math.atan2(direction.y, direction.x);
            drive(ball, direction, ball.speed * ball.speedMultiplier);
          }
          // 每 0.02 秒从场外边缘随机一个位置钻进一团血肉。
          // 预算是按秒累计的：一帧里该钻进来几团就钻几团，所以 30 FPS 的录制
          // 同样是每秒 50 团，而不是被帧率卡在 30 团。
          spawnTimer += elapsed;
          if (spawnTimer + EPSILON < SPAWN_INTERVAL) {
            // 还没到下一次钻进来的时间。
          } else if (activeSummonCount() >= MAX_ACTIVE_SUMMONS) {
            // 满员：这一拍顺延，等场上的血肉被清掉再继续钻。
            spawnTimer = Math.min(spawnTimer, SPAWN_BACKLOG_SECONDS);
          } else {
            let budget = Math.min(spawnTimer, SPAWN_BACKLOG_SECONDS);
            spawnTimer = 0;
            let batch = Math.floor((budget + EPSILON) / SPAWN_INTERVAL);
            while (batch > 0 && activeSummonCount() < MAX_ACTIVE_SUMMONS) {
              spawnSummonAtEdge(services, context.game);
              batch -= 1;
            }
            // 多出来的余额留到下一拍继续用，不丢帧也不透支。
            if (batch > 0) spawnTimer = Math.min(batch * SPAWN_INTERVAL, SPAWN_BACKLOG_SECONDS);
          }
          // 本体自身也在渗血：偶尔甩出一小串血点。
          dripTimer += elapsed;
          if (dripTimer + EPSILON >= 0.32) {
            dripTimer = 0;
            const angle = Math.random() * TAU;
            services.spawnParticleBurst({
              kind: "yi-wan-ren-drip",
              x: ball.x + Math.cos(angle) * ball.radius * 0.85,
              y: ball.y + Math.sin(angle) * ball.radius * 0.85,
              count: 3,
              minDiameter: 1,
              maxDiameter: 2.4,
              minSpeed: 10,
              maxSpeed: 32,
              initialRadius: 2,
              life: 0.5,
              drag: 3,
              gravityY: 24,
              colors: ["#8e1b22", "#d0565c", "#f0a29a"]
            });
          }
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, BODY_CONTACT_DAMAGE);
        },
        onDeath() {
          releaseSummons();
        },
        onBorrowEnd() {
          releaseSummons();
        },
        drawBody(context, canvasContext) {
          const ball = context.ball;
          const entry = skinFor(ball);
          drawFleshBody(canvasContext, {
            x: ball.x,
            y: ball.y,
            radius: ball.radius,
            time: context.game.time,
            seed: entry.seed,
            field: entry.field,
            angle: headingAngle,
            tendrilCount: 13,
            woundCount: 6
          });
          return true;
        }
      };
    }
  };

  registerBall(yiWanRenDefinition);

  return {
    yiWanRenDefinition,
    yiWanRenSummonDefinitions,
    YI_WAN_REN_SUMMON_ID
  };
});
