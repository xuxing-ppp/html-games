(function initializeMeatGrinder(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("./saw-v3.js")
      }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMeatGrinderPlugin({ resolveArenaGeometry, registerBall, createSawV3BloodSpray }) {
  // 纯肉色本体；刀片从中心向两侧伸出，被本体盖住根部。
  const BODY_COLOR = "#e8a08e";
  const BLADE_EDGE = "#454e59";
  const BLADE_HIGHLIGHT = "rgba(236, 244, 252, 0.95)";
  const BLADE_FACE = "#b7c1cd";
  // 刀尖到球心的距离：整把双头刀的范围半径。
  const BLADE_REACH = 35;
  // 刀翼最宽处（从转轴算）的半宽；判定按它收窄一点。
  const BLADE_HALF_WIDTH = 7.0;
  const BLADE_CONTACT_HALF_WIDTH = 6.2;
  const BLADE_ROOT_INSET = 5;
  const BLADE_DAMAGE = 1;

  // 刺客同款曲线：满血 5 秒一圈（0.2 r/s），残血 15 圈/秒。
  const FULL_HP_ROTATION = 1 / 5;
  const LOW_HP_ROTATION = 15;
  // 移速方向相反：满血 150，残血 50。
  const FULL_HP_SPEED = 150;
  const LOW_HP_SPEED = 50;

  // 一次刀刃扫过算一次接触：两片刀刃、每转两刀。
  const SWEEP_STEP_RADIANS = 0.09;
  const SWEEP_STEP_LIMIT = 96;

  const MEAT_BULLET_CHANCE = 0.2;
  const MEAT_BULLET_DAMAGE = 2;
  const MEAT_BULLET_RADIUS = 6;
  const MEAT_BULLET_MIN_SPEED = 150;
  const MEAT_BULLET_MAX_SPEED = 420;
  const MEAT_BULLET_LIMIT = 10;
  const MEAT_BULLET_ARM_DISTANCE = 24;
  const MEAT_BULLET_MAX_STEP = 1 / 120;

  // 血：命中喷溅节流、刀身血痕保留时长。
  const BLOOD_SPRAY_INTERVAL = 0.1;
  const BLOOD_FADE = 1.4;
  const BLOOD_MARK_LIMIT = 48;
  const BLOOD_DARK = "#8b0f18";
  const BLOOD_MID = "#c1121f";
  const BLOOD_BRIGHT = "#e63946";

  // 拖尾只在刀片真正转起来之后出现（约 1 r/s，对应残血 55% 以下）。
  const TRAIL_MIN_ROTATION = 1;
  // 残影只保留最近这一段角度：15 r/s 时约 190°，读成一道扫过的刀光，
  // 而不是绕满一圈的"花瓣"。
  const TRAIL_SAMPLE_LIFE = 0.035;
  const TRAIL_MAX_SAMPLES = 30;
  // 一帧最多能转过 90°：按角度补片，否则相邻残影之间会露出空档，看着像几把刀。
  const TRAIL_ANGLE_STEP = 0.12;
  const TRAIL_SUBSAMPLE_LIMIT = 12;
  const TRAIL_COLOR = "#e3eaf2";

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  if (typeof createSawV3BloodSpray !== "function") {
    throw new TypeError("meatGrinder requires saw-v3's blood spray");
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 纯视觉细节用稳定哈希：肉块外形/自转不能消费战斗随机流。
  function hashUnit(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 2246822507);
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 3266489909);
    hash ^= hash >>> 16;
    return (hash >>> 0) / 4294967296;
  }

  function livingHpRatio(ball) {
    return clamp((ball.hp - 1) / Math.max(1, ball.maxHp - 1), 0, 1);
  }

  // 与刺客相同的几何插值：满血取 FULL，残血取 LOW。
  function rotationRate(ball) {
    return LOW_HP_ROTATION * Math.pow(
      FULL_HP_ROTATION / LOW_HP_ROTATION,
      livingHpRatio(ball)
    );
  }

  function movementSpeed(ball) {
    return LOW_HP_SPEED * Math.pow(
      FULL_HP_SPEED / LOW_HP_SPEED,
      livingHpRatio(ball)
    );
  }

  // 两片刀刃每转各扫过一次；这把"每次接触"的节拍就是半圈的时间。
  function hitInterval(ball) {
    return 1 / (2 * rotationRate(ball));
  }

  function updateMovementSpeed(ball) {
    const nextSpeed = movementSpeed(ball);
    if (Math.abs(ball.speed - nextSpeed) <= EPSILON) return;
    ball.speed = nextSpeed;
    ball.speedNeedsNormalization = true;
  }

  function bladeTipSpeed(rate) {
    return rate * TWO_PI * BLADE_REACH;
  }

  // 肉弹速度跟着转速走：满血 150，最高 420，和转速同为几何插值。
  function meatBulletSpeed(ball) {
    const ratio = livingHpRatio(ball);
    return MEAT_BULLET_MAX_SPEED * Math.pow(
      MEAT_BULLET_MIN_SPEED / MEAT_BULLET_MAX_SPEED,
      ratio
    );
  }

  // 刀刃在 angle / angle+π 两个方向；返回离敌人最近的一次接触。
  function bladeContact(ball, enemy, angle) {
    let best = null;
    for (const offset of [0, Math.PI]) {
      const heading = angle + offset;
      const directionX = Math.cos(heading);
      const directionY = Math.sin(heading);
      const startX = ball.x + directionX * BLADE_ROOT_INSET;
      const startY = ball.y + directionY * BLADE_ROOT_INSET;
      const endX = ball.x + directionX * BLADE_REACH;
      const endY = ball.y + directionY * BLADE_REACH;
      const segmentX = endX - startX;
      const segmentY = endY - startY;
      const lengthSquared = segmentX * segmentX + segmentY * segmentY;
      const progress = lengthSquared <= EPSILON ? 0 : clamp(
        ((enemy.x - startX) * segmentX + (enemy.y - startY) * segmentY) /
          lengthSquared,
        0,
        1
      );
      const pointX = startX + segmentX * progress;
      const pointY = startY + segmentY * progress;
      const distance = Math.hypot(enemy.x - pointX, enemy.y - pointY);
      if (distance > enemy.radius + BLADE_CONTACT_HALF_WIDTH) continue;
      if (best && distance >= best.distance) continue;
      let normalX = enemy.x - pointX;
      let normalY = enemy.y - pointY;
      const normalLength = Math.hypot(normalX, normalY);
      if (normalLength > EPSILON) {
        normalX /= normalLength;
        normalY /= normalLength;
      } else {
        // 敌人圆心正好压在刀身上：按刀身侧面法线甩血。
        normalX = -directionY;
        normalY = directionX;
      }
      best = {
        distance,
        pointX,
        pointY,
        normalX,
        normalY,
        heading,
        progress
      };
    }
    return best;
  }

  function shadeColor(color, amount) {
    const match = /^#([0-9a-f]{6})$/i.exec(typeof color === "string" ? color : "");
    const base = match ? match[1] : "c96a5f";
    const value = Number.parseInt(base, 16);
    const mix = clamp(amount, -1, 1);
    const target = mix >= 0 ? 255 : 0;
    const strength = Math.abs(mix);
    const channel = (shift) => {
      const source = (value >> shift) & 0xff;
      return Math.round(source + (target - source) * strength);
    };
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  function createMeatChunkShape(seed) {
    const points = [];
    const count = 10;
    for (let index = 0; index < count; index += 1) {
      const angle = index / count * TWO_PI;
      const radius = MEAT_BULLET_RADIUS * (0.8 + hashUnit(seed + ":r" + index) * 0.32);
      points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
    return points;
  }

  function drawMeatChunk(canvas, effect) {
    if (!canvas || typeof canvas.rotate !== "function") return;
    const points = effect.shape;
    if (!Array.isArray(points) || points.length < 3) return;
    canvas.save();
    canvas.translate(effect.x, effect.y);
    canvas.rotate(effect.rotation);
    canvas.beginPath();
    canvas.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      canvas.lineTo(points[index].x, points[index].y);
    }
    canvas.closePath();
    canvas.fillStyle = effect.chunkColor;
    canvas.fill();
    canvas.strokeStyle = effect.edgeColor;
    canvas.lineWidth = 1.2;
    canvas.stroke();
    // 削开的断面：一小块偏肉色的切面，避免整块读成石头。
    canvas.fillStyle = effect.cutColor;
    canvas.beginPath();
    canvas.arc(-1.1, -1, MEAT_BULLET_RADIUS * 0.46, 0, TWO_PI);
    canvas.fill();
    // 筋膜斑点：仍以敌方本色为主。
    canvas.fillStyle = effect.mottleColor;
    canvas.beginPath();
    canvas.arc(1.9, 1.4, 1.2, 0, TWO_PI);
    canvas.fill();
    canvas.restore();
  }

  function createMeatChunk({ owner, angle, speed, seed }) {
    const chunkColor = typeof owner.color === "string" ? owner.color : BODY_COLOR;
    const spawnDistance = owner.radius + MEAT_BULLET_RADIUS + 1;
    const spawnX = owner.x + Math.cos(angle) * spawnDistance;
    const spawnY = owner.y + Math.sin(angle) * spawnDistance;
    return {
      kind: "meat-grinder-chunk",
      lifecycle: "owner-bound",
      life: Number.MAX_SAFE_INTEGER,
      radius: MEAT_BULLET_RADIUS,
      damage: MEAT_BULLET_DAMAGE,
      replayDamage: MEAT_BULLET_DAMAGE,
      color: chunkColor,
      drawLayer: "foreground",
      x: spawnX,
      y: spawnY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      chunkColor,
      edgeColor: "#6b2a22",
      mottleColor: shadeColor(chunkColor, 0.42),
      cutColor: "rgba(224, 150, 130, 0.6)",
      shape: createMeatChunkShape(seed),
      rotation: hashUnit(seed + ":rot") * TWO_PI,
      spin: (hashUnit(seed + ":dir") < 0.5 ? -1 : 1) *
        (2.2 + hashUnit(seed + ":spin") * 2.4),
      ignoreInstanceId: owner.instanceId,
      travelled: 0,
      bounceCount: 0,
      update({ effect, game, services: entityServices }, dt) {
        let remaining = Math.max(0, dt);
        while (remaining > EPSILON && effect.entityActive !== false && effect.life > 0) {
          const step = Math.min(MEAT_BULLET_MAX_STEP, remaining);
          const startX = effect.x;
          const startY = effect.y;
          effect.x += effect.vx * step;
          effect.y += effect.vy * step;
          effect.travelled += Math.hypot(effect.x - startX, effect.y - startY);
          effect.rotation += effect.spin * step;

          let hit = null;
          let hitProgress = Infinity;
          let hitRadius = 0;
          entityServices.forEachEnemy((target) => {
            if (!target || target.hp <= 0) return;
            if (!entityServices.getContactProfile(target).attackable) return;
            const armed = effect.travelled > MEAT_BULLET_ARM_DISTANCE ||
              target.instanceId !== effect.ignoreInstanceId;
            if (!armed) return;
            const progress = segmentCircleProgress(
              startX, startY, effect.x, effect.y,
              target.x, target.y, target.radius + effect.radius
            );
            if (progress === null || progress >= hitProgress) return;
            hit = target;
            hitProgress = progress;
            hitRadius = target.radius;
          });

          if (hit) {
            if (entityServices.dealDamage(hit, MEAT_BULLET_DAMAGE)) {
              effect.x = startX + (effect.x - startX) * hitProgress;
              effect.y = startY + (effect.y - startY) * hitProgress;
              effect.life = 0;
              effect.entityActive = false;
              spawnMeatSplat(entityServices, effect, hit, hitRadius);
              return;
            }
            // 被无敌/免伤挡住：肉块继续飞，不重复结算。
            effect.ignoreInstanceId = null;
          }

          const wall = resolveArenaGeometry(game).traceSegment(startX, startY, effect.x, effect.y, effect.radius);
          if (wall) {
            effect.x = wall.x; effect.y = wall.y;
            if (resolveArenaGeometry(game).shape !== "circle" && wall.normalX && wall.normalY) {
              effect.vx *= -1; effect.vy *= -1;
            } else {
              const dot = effect.vx * wall.normalX + effect.vy * wall.normalY;
              effect.vx -= 2 * dot * wall.normalX; effect.vy -= 2 * dot * wall.normalY;
            }
            effect.bounceCount += 1;
          }

          remaining -= step;
        }
      },
      draw({ effect }, canvas) {
        drawMeatChunk(canvas, effect);
      }
    };
  }

  function segmentCircleProgress(startX, startY, endX, endY, centerX, centerY, radius) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((centerX - startX) * deltaX + (centerY - startY) * deltaY) / lengthSquared,
      0, 1
    );
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    return Math.hypot(centerX - closestX, centerY - closestY) <= radius
      ? progress
      : null;
  }

  function spawnMeatSplat(entityServices, chunk, target, targetRadius) {
    const angle = Math.atan2(chunk.vy, chunk.vx);
    entityServices.spawnParticleBurst({
      x: target.x + Math.cos(angle + Math.PI) * targetRadius * 0.6,
      y: target.y + Math.sin(angle + Math.PI) * targetRadius * 0.6,
      count: 10,
      colors: [chunk.chunkColor, chunk.edgeColor, BLOOD_MID],
      minDiameter: 1.2,
      maxDiameter: 3.6,
      minSpeed: 50,
      maxSpeed: 170,
      directionAngle: angle + Math.PI,
      directionSpread: 1.4,
      gravityY: 140,
      drag: 3,
      life: 0.4
    });
  }

  // 绞肉机刀片（俯视）：一片从轮毂伸出的扇形刀翼，背面是厚的钝弧，
  // 前缘（+y，也就是转向的前方）是磨薄的刃口；两片按 180° 点对称。
  // 真实绞肉机刀是平的一整块钢板，所以刀身不做中脊，只留刃口高光和背缘暗线。
  function drawBladeHalf(canvas, sign, radius) {
    const root = Math.max(radius - BLADE_ROOT_INSET, 4);
    const tip = BLADE_REACH;
    const px = (value) => sign * value;
    const py = (value) => sign * value;

    // 刀翼轮廓：背缘是厚的钝边，刀尖收成锐角，前缘一条外凸的弧当刃口。
    canvas.beginPath();
    canvas.moveTo(px(root), py(-3.6));
    canvas.quadraticCurveTo(px(root + 9), py(-5.8), px(tip - 7), py(-3.6));
    canvas.quadraticCurveTo(px(tip - 3), py(-2.4), px(tip), py(0));
    canvas.lineTo(px(tip - 5), py(1.4));
    canvas.quadraticCurveTo(px(tip - 11), py(3.8), px(root + 7), py(6.2));
    canvas.quadraticCurveTo(px(root + 2), py(7.0), px(root), py(4.4));
    canvas.closePath();
    canvas.fillStyle = BLADE_FACE;
    canvas.fill();
    canvas.strokeStyle = BLADE_EDGE;
    canvas.lineWidth = 1.2;
    canvas.stroke();

    // 磨出来的刃口：沿刀锋内侧的一条亮带，而不是一根发光细线。
    canvas.strokeStyle = BLADE_HIGHLIGHT;
    canvas.lineWidth = 2.6;
    canvas.beginPath();
    canvas.moveTo(px(tip - 2), py(0.4));
    canvas.lineTo(px(tip - 5.4), py(1.7));
    canvas.quadraticCurveTo(px(tip - 11), py(3.5), px(root + 7.5), py(5.5));
    canvas.stroke();

    // 背缘厚度：深一档的窄带，读得出这是有厚度的钢板而不是纸片。
    canvas.strokeStyle = "rgba(72, 81, 93, 0.55)";
    canvas.lineWidth = 2.2;
    canvas.beginPath();
    canvas.moveTo(px(root + 1), py(-2.6));
    canvas.quadraticCurveTo(px(root + 10), py(-4.8), px(tip - 8), py(-3.0));
    canvas.stroke();
  }

  function drawBlades(canvas, ball, angle, bloodMarks, now) {
    if (!canvas || typeof canvas.rotate !== "function") return;
    if (typeof canvas.quadraticCurveTo !== "function") return;
    const baseAlpha = canvas.globalAlpha;
    canvas.save();
    canvas.translate(ball.x, ball.y);
    canvas.rotate(angle);
    drawBladeHalf(canvas, 1, ball.radius);
    drawBladeHalf(canvas, -1, ball.radius);
    // 轮毂（被本体盖住，只用来保证两片刀在视觉上连成一体）
    canvas.fillStyle = BLADE_EDGE;
    canvas.beginPath();
    canvas.arc(0, 0, Math.max(4, ball.radius * 0.42), 0, TWO_PI);
    canvas.fill();
    // 刀身血痕：跟着刀一起转，慢慢干涸。
    canvas.lineCap = "round";
    for (const mark of bloodMarks) {
      const fade = 1 - (now - mark.at) / BLOOD_FADE;
      if (fade <= 0) continue;
      canvas.globalAlpha = baseAlpha * fade * 0.9;
      canvas.strokeStyle = mark.bright ? BLOOD_MID : BLOOD_DARK;
      canvas.lineWidth = 2.4 + fade * 2;
      canvas.beginPath();
      canvas.moveTo(mark.x - 4.2, mark.y);
      canvas.lineTo(mark.x + 4.2, mark.y);
      canvas.stroke();
      canvas.globalAlpha = baseAlpha * fade * 0.7;
      canvas.fillStyle = BLOOD_BRIGHT;
      canvas.beginPath();
      canvas.arc(mark.x + 1.2, mark.y + 1.4, 1.2 + fade * 0.8, 0, TWO_PI);
      canvas.fill();
    }
    canvas.globalAlpha = baseAlpha;
    canvas.restore();
  }

  // 拖尾残影片：整把双头刀在历史角度上的剪影，跟着本体位置一起留在原地。
  function drawBladeGhost(canvas, sample, scale) {
    if (!canvas || typeof canvas.rotate !== "function") return;
    if (typeof canvas.quadraticCurveTo !== "function") return;
    const angle = Number.isFinite(sample.angle)
      ? sample.angle
      : (Number.isFinite(sample.heading) ? sample.heading : 0);
    const shape = Math.max(0.2, scale);
    const tip = BLADE_REACH;
    canvas.save();
    canvas.translate(sample.x, sample.y);
    canvas.rotate(angle);
    canvas.scale(shape, shape);
    canvas.beginPath();
    for (const sign of [1, -1]) {
      const px = (value) => sign * value;
      const py = (value) => sign * value;
      canvas.moveTo(px(10), py(-3.6));
      canvas.quadraticCurveTo(px(19), py(-5.8), px(tip - 7), py(-3.6));
      canvas.quadraticCurveTo(px(tip - 3), py(-2.4), px(tip), py(0));
      canvas.lineTo(px(tip - 5), py(1.4));
      canvas.quadraticCurveTo(px(tip - 11), py(3.8), px(17), py(6.2));
      canvas.quadraticCurveTo(px(12), py(7.0), px(10), py(4.4));
      canvas.closePath();
    }
    canvas.fillStyle = TRAIL_COLOR;
    canvas.fill();
    canvas.restore();
  }

  const meatGrinderDefinition = {
    id: "meatGrinder",
    name: "绞肉机",
    englishName: "Meat Grinder",
    color: BODY_COLOR,
    description: "双头刀片半径35 / 刀刃1点接触伤害 / 转速随失血0.2→15r/s、移速150→50 / 削肉弹20%概率2伤",
    stats: { radius: 15, speed: FULL_HP_SPEED, maxHp: 100 },
    createBehavior(services) {
      let bladeAngle = -Math.PI / 2;
      let borrowedTravel = 0;
      let trail = null;
      let ownerBall = null;
      let hitCount = 0;
      let bulletCount = 0;
      let sprayCount = 0;
      const lastHitAt = new Map();
      const lastSprayAt = new Map();
      const bloodMarks = [];
      const liveBullets = new Set();

      function pruneBullets() {
        for (const bullet of Array.from(liveBullets)) {
          if (!bullet || bullet.entityActive === false || bullet.life <= 0) {
            liveBullets.delete(bullet);
          }
        }
      }

      function ensureTrail() {
        if (trail && !trail.finished && trail.active) return;
        if (trail) trail.end(true);
        trail = services.spawnAfterimageTrail({
          kind: "meat-grinder-blade-trail",
          drawLayer: "background",
          color: TRAIL_COLOR,
          radius: BLADE_REACH,
          sampleLife: TRAIL_SAMPLE_LIFE,
          sampleInterval: 0.01,
          maxSamples: TRAIL_MAX_SAMPLES,
          maxAlpha: 0.5,
          minScale: 0.95,
          // 刀影不做硬边：整条残影走引擎的离屏合成 + 一次高斯模糊，
          // 50% 半透明叠加后读成扫过的刀光。
          blurRatio: 0.1,
          widthRatio: 1,
          sampleExtent: BLADE_REACH + BLADE_HALF_WIDTH,
          drawSample: drawBladeGhost
        }, { lifecycle: "owner-bound" });
      }

      function recordBloodMark(ball, contact, now) {
        const cosine = Math.cos(bladeAngle);
        const sine = Math.sin(bladeAngle);
        const worldX = contact.pointX - ball.x;
        const worldY = contact.pointY - ball.y;
        const localX = worldX * cosine + worldY * sine;
        const localY = -worldX * sine + worldY * cosine;
        bloodMarks.push({
          x: clamp(localX, -BLADE_REACH + 4, BLADE_REACH - 4),
          y: clamp(localY, -BLADE_HALF_WIDTH * 0.72, BLADE_HALF_WIDTH * 0.72),
          at: now,
          bright: bloodMarks.length % 3 === 0
        });
        while (bloodMarks.length > BLOOD_MARK_LIMIT) bloodMarks.shift();
      }

      function spawnWound(ball, enemy, contact, now) {
        // 血从刀口甩出去：切向为主，再朝体外偏一点，不从伤口往身体里灌。
        const tangentX = -Math.sin(contact.heading);
        const tangentY = Math.cos(contact.heading);
        let sprayX = tangentX * 0.9 - contact.normalX * 0.5;
        let sprayY = tangentY * 0.9 - contact.normalY * 0.5;
        const sprayLength = Math.hypot(sprayX, sprayY) || 1;
        sprayX /= sprayLength;
        sprayY /= sprayLength;
        const sprayAngle = Math.atan2(sprayY, sprayX);

        // 刀尖扎进球体时，接触点在敌方内部；把出血点抬到球面上，
        // 否则血弧会从球心糊出来、盖掉血条数字。
        const offsetX = contact.pointX - enemy.x;
        const offsetY = contact.pointY - enemy.y;
        const offsetLength = Math.hypot(offsetX, offsetY);
        let originX = contact.pointX;
        let originY = contact.pointY;
        if (offsetLength < enemy.radius) {
          const scale = offsetLength > 1
            ? enemy.radius / offsetLength
            : 0;
          originX = scale > 0
            ? enemy.x + offsetX * scale
            : contact.pointX + tangentX * enemy.radius * 0.6;
          originY = scale > 0
            ? enemy.y + offsetY * scale
            : contact.pointY + tangentY * enemy.radius * 0.6;
        }

        const key = enemy.instanceId;
        const previous = lastSprayAt.get(key);
        if (previous !== undefined && now - previous < BLOOD_SPRAY_INTERVAL - EPSILON) {
          return;
        }
        lastSprayAt.set(key, now);
        sprayCount += 1;

        services.spawnParticleBurst({
          x: originX,
          y: originY,
          count: 20,
          colors: [BLOOD_MID, BLOOD_DARK, BLOOD_BRIGHT, "#ff8f9c", "#7a0a12"],
          shape: "ellipse",
          minLength: 2,
          maxLength: 6.5,
          minWidth: 1.1,
          maxWidth: 3.2,
          minSpeed: 90,
          maxSpeed: 320,
          minRotationSpeed: -14,
          maxRotationSpeed: 14,
          directionAngle: sprayAngle,
          directionSpread: 1.6,
          gravityY: 340,
          drag: 2,
          life: 0.6
        });
        services.spawnParticleBurst({
          x: originX,
          y: originY,
          count: 12,
          colors: [BLOOD_DARK, BLOOD_MID, "#5e0810"],
          minDiameter: 1,
          maxDiameter: 3,
          minSpeed: 40,
          maxSpeed: 140,
          directionAngle: sprayAngle,
          directionSpread: Math.PI,
          gravityY: 90,
          drag: 4.6,
          life: 0.7
        });
        services.spawnVisualEffect(createSawV3BloodSpray(originX, originY, sprayAngle));
      }

      function launchMeatBullet(ball, enemy) {
        if (Math.random() >= MEAT_BULLET_CHANCE * services.getTriggerChanceScale()) return;
        pruneBullets();
        if (liveBullets.size >= MEAT_BULLET_LIMIT) {
          const oldest = liveBullets.values().next().value;
          if (oldest) {
            oldest.life = 0;
            oldest.entityActive = false;
            liveBullets.delete(oldest);
          }
        }
        const angle = Math.random() * TWO_PI;
        const chunk = createMeatChunk({
          owner: enemy,
          angle,
          speed: meatBulletSpeed(ball),
          seed: `${enemy.instanceId || enemy.id}:${bulletCount}:${ball.instanceId || ball.id}`
        });
        const bullet = services.spawnProjectile(chunk);
        if (!bullet) return;
        liveBullets.add(bullet);
        bulletCount += 1;
      }

      function strike(ball, enemy, contact, now) {
        if (!services.dealDamage(enemy, BLADE_DAMAGE, ball)) return;
        hitCount += 1;
        recordBloodMark(ball, contact, now);
        spawnWound(ball, enemy, contact, now);
        launchMeatBullet(ball, enemy);
      }

      function sweepHits(ball, travel, now) {
        if (travel <= EPSILON) return;
        const interval = hitInterval(ball);
        const steps = clamp(
          Math.ceil(travel / SWEEP_STEP_RADIANS),
          1,
          SWEEP_STEP_LIMIT
        );
        services.forEachEnemy((enemy) => {
          if (!enemy || enemy.hp <= 0) return;
          if (!services.getContactProfile(enemy).attackable) return;
          const key = enemy.instanceId;
          let contact = null;
          for (let index = 1; index <= steps; index += 1) {
            contact = bladeContact(ball, enemy, bladeAngle - travel + travel * index / steps);
            if (contact) break;
          }
          if (!contact) {
            // 刀刃已经离开：下一次扫过是新的接触，立刻可以出伤。
            lastHitAt.delete(key);
            lastSprayAt.delete(key);
            return;
          }
          const previous = lastHitAt.get(key);
          if (previous !== undefined && now - previous < interval - EPSILON) return;
          lastHitAt.set(key, now);
          strike(ball, enemy, contact, now);
        });
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          bladeAngle = -Math.PI / 2;
          borrowedTravel = 0;
        },
        update(context, dt) {
          const ball = context.ball;
          ownerBall = ball;
          const step = Math.max(0, dt);
          updateMovementSpeed(ball);
          const rate = rotationRate(ball);
          const travel = rate * TWO_PI * step;
          bladeAngle = (bladeAngle + travel) % TWO_PI;
          if (services.borrowedAttackOnly) borrowedTravel += travel;

          if (rate >= TRAIL_MIN_ROTATION) {
            ensureTrail();
            if (trail && !trail.finished) {
              const speed = bladeTipSpeed(rate);
              const samples = clamp(
                Math.ceil(travel / TRAIL_ANGLE_STEP),
                1,
                TRAIL_SUBSAMPLE_LIMIT
              );
              for (let index = 1; index <= samples; index += 1) {
                const sampleAngle = bladeAngle - travel + travel * index / samples;
                trail.push(ball.x, ball.y, BLADE_REACH, {
                  angle: sampleAngle,
                  heading: sampleAngle,
                  speed
                });
              }
            }
          } else if (trail && trail.active) {
            trail.end();
          }

          const now = context.game.time;
          sweepHits(ball, travel, now);
          pruneBullets();

          for (let index = bloodMarks.length - 1; index >= 0; index -= 1) {
            if (now - bloodMarks[index].at > BLOOD_FADE) bloodMarks.splice(index, 1);
          }
        },
        isAttackCycleComplete() { return borrowedTravel >= TWO_PI - EPSILON; },
        getAttackCycleTransitionIn({ ball }) {
          return Math.max(
            EPSILON,
            (TWO_PI - borrowedTravel) / (rotationRate(ball) * TWO_PI)
          );
        },
        // 刀刃在本体下面，和锯球V3一样从球体下方伸出来。
        drawBefore(context, canvas) {
          if (!canvas || typeof canvas.rotate !== "function") return;
          drawBlades(canvas, context.ball, bladeAngle, bloodMarks, context.game.time);
        },
        drawBorrowedWeapon(context, canvas) { this.drawBefore(context, canvas); },
        onDeath() { if (trail) trail.end(true); trail = null; },
        onBorrowEnd() {
          borrowedTravel = 0;
          if (trail) trail.end(true);
          trail = null;
        },
        getMeatGrinderState() {
          const ball = ownerBall;
          return {
            bladeAngle,
            rotationRate: ball ? rotationRate(ball) : FULL_HP_ROTATION,
            movementSpeed: ball ? movementSpeed(ball) : FULL_HP_SPEED,
            hitInterval: ball ? hitInterval(ball) : 1 / (2 * FULL_HP_ROTATION),
            reach: BLADE_REACH,
            hitCount,
            bulletCount,
            sprayCount,
            bloodMarks: bloodMarks.length,
            liveBullets: liveBullets.size,
            trailActive: Boolean(trail && !trail.finished && trail.active),
            trailSamples: trail ? trail.sampleCount : 0
          };
        }
      };
    }
  };

  registerBall(meatGrinderDefinition);
  return {
    meatGrinderDefinition,
    meatGrinderRotationRate: rotationRate,
    meatGrinderMovementSpeed: movementSpeed,
    meatGrinderHitInterval: hitInterval,
    meatGrinderBulletSpeed: meatBulletSpeed,
    meatGrinderBladeContact: bladeContact,
    MEAT_GRINDER_COLOR: BODY_COLOR,
    MEAT_GRINDER_BLADE_REACH: BLADE_REACH,
    MEAT_GRINDER_BLADE_HALF_WIDTH: BLADE_HALF_WIDTH,
    MEAT_GRINDER_BLADE_DAMAGE: BLADE_DAMAGE,
    MEAT_GRINDER_FULL_HP_ROTATION: FULL_HP_ROTATION,
    MEAT_GRINDER_LOW_HP_ROTATION: LOW_HP_ROTATION,
    MEAT_GRINDER_FULL_HP_SPEED: FULL_HP_SPEED,
    MEAT_GRINDER_LOW_HP_SPEED: LOW_HP_SPEED,
    MEAT_GRINDER_BULLET_CHANCE: MEAT_BULLET_CHANCE,
    MEAT_GRINDER_BULLET_DAMAGE: MEAT_BULLET_DAMAGE,
    MEAT_GRINDER_BULLET_RADIUS: MEAT_BULLET_RADIUS,
    MEAT_GRINDER_BULLET_MIN_SPEED: MEAT_BULLET_MIN_SPEED,
    MEAT_GRINDER_BULLET_MAX_SPEED: MEAT_BULLET_MAX_SPEED,
    MEAT_GRINDER_BULLET_LIMIT: MEAT_BULLET_LIMIT,
    MEAT_GRINDER_TRAIL_MIN_ROTATION: TRAIL_MIN_ROTATION
  };
});
