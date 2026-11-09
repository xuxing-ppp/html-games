(function initializeBaiWanRen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js")), require("./bai-wan-ren-field.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBaiWanRenPlugin({
  registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback,
  createBaiWanRenField,
  baiWanRenEdgeEntry
}) {
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;

  // 场地系角色：本体是一颗直径 30、100 血的普通小球（速度沿用亿万人的 30），
  // 真正在打架的是整块战场 —— 血肉场地是一枚独立的 Combat Entity：
  //   · 背景那层翻涌的血肉由场地画（drawArenaBackground 不再挂在本体上）；
  //   · "每一拍、从哪条边线内侧钻进一团血肉"是场地的规则，本体只把场地排好的
  //     入场名额落成真正的召唤物（引擎的实体服务里没有 spawnSummon）；
  //   · 本体被眩晕时场地照常运转（场地不是本体的技能），只有本体退场或能力被
  //     白蛇 DISC 封印才会让整块场地停摆。
  const BODY_RADIUS = 15;
  const BODY_SPEED = 30;
  const BODY_HP = 100;
  const BODY_COLOR = "#9d1a20";

  // 召唤周期从 0.35 秒/个线性加速，15 秒后稳定在 0.1 秒/个。


  const SUMMON_RADIUS = 5;
  const SUMMON_SPEED = 50;
  const SUMMON_HP = 1;
  const CONTACT_DAMAGE = 1;
  // 每种小兵自己的行进速度：入场那一刻写进速度，之后交给引擎的直线漂移。
  const TENTACLE_SPEED = 55;
  const MAGGOT_SPEED = 45;
  const SHOOTER_SPEED = 35;
  const WHIP_SPEED = 40;
  // 贴边入场的缩进量与入场扇区搬进了场地模块（bai-wan-ren-field.js）：
  // "从哪条边进得来"本来就是场地的规则，见 baiWanRenEdgeEntry()。

  // 血肉配色：从深腔里的黑红，到翻出来的筋膜白。
  const MEAT_DEEP = "#3d060a";
  const MEAT_DARK = "#7c1219";
  const MEAT_MID = "#b32b32";
  const MEAT_LIGHT = "#e07f74";
  const MEAT_RAW = "#f2b3a4";
  const SINEW = "#ecd9c8";
  const FAT = "#f7e6da";
  const HOLE = "#140204";

  // 手臂的一半会被躯体挡住，所以长度按需求加 20。
  const TENTACLE_MAX_LENGTH = 50;
  const TENTACLE_MIN_REACH = 14;
  // 只有敌人贴到这么近才朝它甩手（攻击），平时抓点只看自己的航向。
  // 圆心距阈值 = 常量 + 目标半径（贴到「体表」就算贴到身上）。
  const TENTACLE_MELEE_RANGE = 14;
  const TENTACLE_REACH_SPEED = 140;
  // 手掌离身体还有一段就松手：手臂整场都保持着伸出去的长度，拖着躯体走才
  // 看得出来（必须小于 TENTACLE_MIN_REACH，否则刚抓住就会立刻松手）。
  const TENTACLE_RELEASE_DISTANCE = 12;
  // 被墙或别人卡住时也得松手，不然会一直贴着墙拉。
  const TENTACLE_PULL_TIMEOUT = 1.4;
  const TENTACLE_DAMAGE = 2;
  const TENTACLE_THICKNESS = 2.6;
  const TENTACLE_HIT_RADIUS = SUMMON_RADIUS + TENTACLE_THICKNESS;

  const CRAWL_DURATION = 2;
  const LUNGE_SPEED_MAX = 100;
  const LUNGE_MAX_DISTANCE = 40;
  const LUNGE_ACCELERATION = LUNGE_SPEED_MAX * LUNGE_SPEED_MAX / LUNGE_MAX_DISTANCE;
  const LUNGE_HALF_DISTANCE = LUNGE_SPEED_MAX * LUNGE_SPEED_MAX / (2 * LUNGE_ACCELERATION);
  const LUNGE_STRETCH_TIME = 2 * LUNGE_SPEED_MAX / LUNGE_ACCELERATION;
  const LUNGE_RETRACT_SPEED = 140;
  const LUNGE_HEAD_GROWTH = 0.9;
  const LUNGE_BODY_DAMAGE = 1;
  const LUNGE_KNOCKBACK_DURATION = 0.05;
  const LUNGE_KNOCKBACK_MULTIPLIER = 2;

  const FLESH_BULLET_INTERVAL = 1;
  const FLESH_BULLET_SPEED = 200;
  const FLESH_BULLET_DAMAGE = 1;
  const FLESH_BULLET_RADIUS = 2.4;
  // 子弹不会自己消失：一直飞，飞出场地才收（与碎牙同款）。
  const FLESH_BULLET_LIFE = Number.MAX_SAFE_INTEGER;

  const SPLIT_INTERVAL = 5;
  const SPLIT_CHILD_RADIUS = 3.5;
  const SPLIT_PUSH_SPEED = 70;

  const WHIP_LENGTH = 15;
  const WHIP_TURN_RATE = TAU * 3;
  const WHIP_DAMAGE = 1;
  const WHIP_THICKNESS = 2.6;
  const WHIP_BARBS = 5;

  const HOP_INTERVAL = 1;
  const HOP_RANGE = 30;
  const HOP_MIN_DISTANCE = 8;
  const HOP_ARC_HEIGHT = 26;
  const HOP_SQUASH_TIME = 0.18;
  const SHOCKWAVE_RADIUS = 20;
  const SHOCKWAVE_STUN_DURATION = 0.2;

  const FANG_RADIUS = 1.8;
  const FANG_DAMAGE = 1;
  const FANG_DROP_RADIUS = 10;
  const FANG_DROP_MIN = 1;
  const FANG_DROP_MAX = 2;
  // 本体皮肤上的牙齿：翻出牙龈的几颗碎牙。
  const BODY_TEETH = 5;
  // 接触并吞掉自己的小兵：每吃一只 +1 血，血上限一起涨 —— 没有 100 血的天花板。
  const FEED_HEAL = 1;
  const FEED_TOLERANCE = 2;
  const FEED_PULSE_TIME = 0.28;

  // ---------- 血肉场地（Combat Entity） ----------
  const FIELD_ENTITY_KIND = "bai-wan-ren-flesh-field";
  const FIELD_COMBAT_KIND = "zone";
  // 场地一拍最多补几团：卡帧拖长时把欠的批次摊到接下来的几拍，不会一次涌出一整片。
  const FIELD_ENTRY_BATCH_MAX = 4;
  // 场地最多替本体囤几团血肉：本体动不了（眩晕 / 冻结）时不会无限攒着不吐。
  const FIELD_ENTRY_QUEUE_LIMIT = 8;
  const FIELD_SPAWN_INTERVAL_START = 0.35;
  const FIELD_SPAWN_INTERVAL_END = 0.1;
  const FIELD_SPAWN_ACCELERATION_TIME = 15;
  const SPAWN_INTERVAL = FIELD_SPAWN_INTERVAL_START;

  const BODY_FIBERS = 120;
  const BODY_LOBES = 4;
  const BODY_GASHES = 5;
  const BODY_HOLES = 3;
  const BODY_SHARDS = 4;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function summonIntervalAt(elapsed) {
    const progress = clamp(elapsed / FIELD_SPAWN_ACCELERATION_TIME, 0, 1);
    return FIELD_SPAWN_INTERVAL_START + (FIELD_SPAWN_INTERVAL_END - FIELD_SPAWN_INTERVAL_START) * progress;
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

  // 入射角 = 出射角：手臂从躯体出发沿方向走完 reach 的长度，中途撞墙就按镜面
  // 反射，最后落到场内的某个点。返回抓点和反射之后的实际行进方向。
  function reflectReach(x, y, directionX, directionY, reach, minimum, maximum) {
    let currentX = clamp(x, minimum, maximum);
    let currentY = clamp(y, minimum, maximum);
    let dirX = directionX;
    let dirY = directionY;
    let remaining = Math.max(0, reach);
    for (let bounce = 0; bounce < 4 && remaining > EPSILON; bounce += 1) {
      const toWallX = dirX > EPSILON
        ? (maximum - currentX) / dirX
        : (dirX < -EPSILON ? (minimum - currentX) / dirX : Infinity);
      const toWallY = dirY > EPSILON
        ? (maximum - currentY) / dirY
        : (dirY < -EPSILON ? (minimum - currentY) / dirY : Infinity);
      const toWall = Math.min(toWallX, toWallY);
      if (!(toWall < remaining)) break;
      currentX += dirX * toWall;
      currentY += dirY * toWall;
      remaining -= toWall;
      if (toWallX <= toWallY) {
        dirX = -dirX;
        currentX = clamp(currentX, minimum, maximum);
      } else {
        dirY = -dirY;
        currentY = clamp(currentY, minimum, maximum);
      }
    }
    currentX += dirX * remaining;
    currentY += dirY * remaining;
    return {
      x: clamp(currentX, minimum, maximum),
      y: clamp(currentY, minimum, maximum),
      directionX: dirX,
      directionY: dirY
    };
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

  // 百万人不做索敌：本体和小兵都是普通小球的直线运动 + 撞墙反弹。
  // 速度只在出生的那一刻写一次，之后完全交给引擎。
  function launch(ball, directionX, directionY, speed) {
    const direction = normalizeDirection(directionX, directionY);
    ball.vx = ball.storedVx = direction.x * speed;
    ball.vy = ball.storedVy = direction.y * speed;
    ball.speedNeedsNormalization = false;
  }

  function launchRandom(ball, speed) {
    const angle = Math.random() * TAU;
    launch(ball, Math.cos(angle), Math.sin(angle), speed);
  }

  function holdStill(ball) {
    ball.vx = ball.storedVx = 0;
    ball.vy = ball.storedVy = 0;
    ball.speedNeedsNormalization = false;
  }

  function hash2(x, y, seed) {
    const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
    return value - Math.floor(value);
  }

  // ---------- 皮肤：一堆翻出来的生肉 ----------
  // 印象图是三种质感叠在一起：密到看不见底的红肌纤维、把整团肉裹住的
  // 灰白筋膜褶皱、以及几条一直黑到肉里的裂口和孔洞。这里按这个顺序画。

  function createMeatSkin(seed) {
    const fibers = [];
    for (let index = 0; index < BODY_FIBERS; index += 1) {
      const angle = hash2(index, 3.7, seed) * TAU;
      const tone = hash2(index, 11.3, seed + 2);
      fibers.push({
        angle,
        offset: (hash2(index, 5.1, seed + 4) * 2 - 1) * 0.9,
        length: 1.05 + hash2(index, 7.9, seed + 6) * 0.95,
        thickness: 0.5 + hash2(index, 13.7, seed + 8) * 1.5,
        tone,
        phase: hash2(index, 17.3, seed + 10) * TAU,
        speed: 0.5 + hash2(index, 19.9, seed + 12) * 1.3,
        nodes: 5 + Math.floor(hash2(index, 23.1, seed + 14) * 3)
      });
    }
    const lobes = [];
    for (let index = 0; index < BODY_LOBES; index += 1) {
      lobes.push({
        angle: hash2(index, 31.7, seed + 16) * TAU,
        offset: 0.15 + hash2(index, 37.1, seed + 18) * 0.55,
        size: 0.45 + hash2(index, 41.3, seed + 20) * 0.42,
        squash: 0.5 + hash2(index, 43.9, seed + 22) * 0.6,
        phase: hash2(index, 47.1, seed + 24) * TAU,
        speed: 0.3 + hash2(index, 53.3, seed + 26) * 0.5
      });
    }
    const gashes = [];
    for (let index = 0; index < BODY_GASHES; index += 1) {
      gashes.push({
        angle: hash2(index, 59.1, seed + 28) * TAU,
        offset: (hash2(index, 61.7, seed + 30) * 2 - 1) * 0.7,
        length: 0.7 + hash2(index, 67.3, seed + 32) * 0.7,
        curve: (hash2(index, 71.9, seed + 34) * 2 - 1) * 0.5,
        width: 0.9 + hash2(index, 73.7, seed + 36) * 1.8,
        phase: hash2(index, 79.1, seed + 38) * TAU,
        speed: 0.4 + hash2(index, 83.3, seed + 40) * 0.7
      });
    }
    const holes = [];
    for (let index = 0; index < BODY_HOLES; index += 1) {
      holes.push({
        angle: hash2(index, 89.3, seed + 42) * TAU,
        offset: 0.2 + hash2(index, 97.1, seed + 44) * 0.5,
        size: 0.14 + hash2(index, 101.3, seed + 46) * 0.16,
        phase: hash2(index, 103.9, seed + 48) * TAU,
        speed: 0.6 + hash2(index, 107.1, seed + 50) * 0.9
      });
    }
    const shards = [];
    for (let index = 0; index < BODY_SHARDS; index += 1) {
      shards.push({
        angle: hash2(index, 109.7, seed + 52) * TAU,
        offset: 0.3 + hash2(index, 113.3, seed + 54) * 0.55,
        size: 0.08 + hash2(index, 127.9, seed + 56) * 0.13,
        spin: (hash2(index, 131.1, seed + 58) * 2 - 1) * 0.8,
        phase: hash2(index, 137.3, seed + 60) * TAU
      });
    }
    const teeth = [];
    for (let index = 0; index < BODY_TEETH; index += 1) {
      teeth.push({
        angle: hash2(index, 139.9, seed + 62) * TAU,
        offset: 0.55 + hash2(index, 149.3, seed + 64) * 0.3,
        size: 0.12 + hash2(index, 151.1, seed + 66) * 0.14,
        tilt: (hash2(index, 157.7, seed + 68) * 2 - 1) * 0.7
      });
    }
    return { seed, fibers, lobes, gashes, holes, shards, teeth };
  }

  // 一团肉的轮廓：三个低频正弦把圆揉成会呼吸的肉块。
  function traceBodyPath(canvas, x, y, radius, time, seed) {
    const segments = 44;
    canvas.beginPath();
    for (let index = 0; index <= segments; index += 1) {
      const theta = index / segments * TAU;
      const wobble = 1
        + Math.sin(theta * 3 + time * 2.1 + seed) * 0.055
        + Math.sin(theta * 5 - time * 3.3 + seed * 1.7) * 0.032
        + Math.sin(theta * 8 + time * 1.4) * 0.018;
      const breath = 1 + Math.sin(time * 1.7 + seed) * 0.02;
      const pointRadius = radius * wobble * breath;
      const pointX = x + Math.cos(theta) * pointRadius;
      const pointY = y + Math.sin(theta) * pointRadius;
      if (index === 0) canvas.moveTo(pointX, pointY);
      else canvas.lineTo(pointX, pointY);
    }
    canvas.closePath();
  }

  function fiberColor(tone) {
    if (tone < 0.08) return SINEW;
    if (tone < 0.24) return MEAT_RAW;
    if (tone < 0.44) return MEAT_LIGHT;
    if (tone < 0.68) return MEAT_MID;
    if (tone < 0.86) return "#8f1a22";
    return "#43060c";
  }

  // 一本体的皮：纤维 + 筋膜 + 裂口 + 孔洞 + 骨渣 + 翻出的牙。
  function drawMeatBody(canvas, options) {
    const { x, y, radius, time, skin, shadowAlpha = 0.42 } = options;
    const seed = skin.seed;

    canvas.save();
    canvas.globalAlpha *= shadowAlpha;
    const shadow = canvas.createRadialGradient(x, y, radius * 0.3, x, y, radius * 1.6);
    shadow.addColorStop(0, "rgba(18, 0, 3, 0.85)");
    shadow.addColorStop(1, "rgba(18, 0, 3, 0)");
    canvas.fillStyle = shadow;
    canvas.beginPath();
    canvas.arc(x, y, radius * 1.6, 0, TAU);
    canvas.fill();
    canvas.restore();

    canvas.save();
    traceBodyPath(canvas, x, y, radius, time, seed);
    canvas.fillStyle = MEAT_DEEP;
    canvas.fill();
    canvas.clip();

    // 底肉：从边缘的暗红压向中间的亮红，读起来像被剖开的肌肉。
    const base = canvas.createRadialGradient(
      x - radius * 0.25, y - radius * 0.3, radius * 0.1,
      x, y, radius * 1.15
    );
    base.addColorStop(0, MEAT_DARK);
    base.addColorStop(0.6, "#5c0c13");
    base.addColorStop(1, MEAT_DEEP);
    canvas.fillStyle = base;
    canvas.fillRect(x - radius, y - radius, radius * 2, radius * 2);

    // 肌纤维：先用暗红压出纤维之间的沟，再在上面压一层亮纤维。
    // 两层叠出来的浓密走向才是印象图里那种「撕开的生肉」。
    canvas.lineCap = "round";
    for (let index = 0; index < skin.fibers.length; index += 1) {
      const fiber = skin.fibers[index];
      const drift = Math.sin(time * fiber.speed + fiber.phase) * 0.05;
      const directionX = Math.cos(fiber.angle + drift * 0.6);
      const directionY = Math.sin(fiber.angle + drift * 0.6);
      const normalX = -directionY;
      const normalY = directionX;
      const baseOffset = fiber.offset * radius * 0.74;
      const width = Math.max(0.5, fiber.thickness * radius * 0.085);
      const strokeFiber = (lateral) => {
        canvas.beginPath();
        for (let node = 0; node <= fiber.nodes; node += 1) {
          const progress = node / fiber.nodes;
          const along = (progress - 0.5) * fiber.length * radius * 2.05;
          const curl = Math.sin(progress * 2.6 + time * fiber.speed + fiber.phase) *
            radius * 0.08;
          const px = x + directionX * along + normalX * (baseOffset + curl + lateral);
          const py = y + directionY * along + normalY * (baseOffset + curl + lateral);
          if (node === 0) canvas.moveTo(px, py);
          else canvas.lineTo(px, py);
        }
        canvas.stroke();
      };
      canvas.globalAlpha = 0.5;
      canvas.strokeStyle = "#240205";
      canvas.lineWidth = width * 2.1;
      strokeFiber(0);
      canvas.globalAlpha = 0.62 + 0.34 * (1 - fiber.tone);
      canvas.strokeStyle = fiberColor(fiber.tone);
      canvas.lineWidth = width;
      strokeFiber(0);
      if (fiber.tone < 0.16) {
        // 挑出来的筋膜丝：细、亮、比肌肉更直。
        canvas.globalAlpha = 0.82;
        canvas.strokeStyle = SINEW;
        canvas.lineWidth = Math.max(0.4, width * 0.5);
        strokeFiber(-width * 1.2);
      }
    }
    canvas.globalAlpha = 1;

    // 筋膜与脂肪：不规则的白膜块裹在肌肉上，再叠两道褶皱线，
    // 读起来才是被撕开的膜而不是几个圆点。
    for (let index = 0; index < skin.lobes.length; index += 1) {
      const lobe = skin.lobes[index];
      const wobble = Math.sin(time * lobe.speed + lobe.phase) * 0.06;
      const lobeAngle = lobe.angle + wobble;
      const centerX = x + Math.cos(lobeAngle) * lobe.offset * radius;
      const centerY = y + Math.sin(lobeAngle) * lobe.offset * radius;
      const size = radius * (lobe.size + wobble * 0.1);
      canvas.save();
      canvas.translate(centerX, centerY);
      canvas.rotate(lobeAngle + lobe.phase * 0.2);
      canvas.globalAlpha = 0.4;
      canvas.fillStyle = FAT;
      canvas.beginPath();
      for (let point = 0; point <= 16; point += 1) {
        const theta = point / 16 * TAU;
        const bump = 1 + Math.sin(theta * 3 + lobe.phase) * 0.2
          + Math.sin(theta * 5 - lobe.phase * 2) * 0.1;
        const px = Math.cos(theta) * size * bump;
        const py = Math.sin(theta) * size * lobe.squash * bump;
        if (point === 0) canvas.moveTo(px, py);
        else canvas.lineTo(px, py);
      }
      canvas.closePath();
      canvas.fill();
      canvas.globalAlpha = 0.5;
      canvas.strokeStyle = "rgba(206, 146, 134, 0.85)";
      canvas.lineWidth = Math.max(0.35, radius * 0.032);
      canvas.stroke();
      canvas.globalAlpha = 0.36;
      canvas.strokeStyle = "rgba(255, 245, 238, 0.9)";
      for (let fold = 0; fold < 2; fold += 1) {
        const offset = (fold - 0.5) * size * 0.5;
        canvas.beginPath();
        canvas.ellipse(
          0, offset, size * 0.66, size * lobe.squash * 0.42,
          0, Math.PI * 0.12, Math.PI * 0.95
        );
        canvas.stroke();
      }
      canvas.restore();
    }
    canvas.globalAlpha = 1;

    // 裂口：两头收、中间张开的深沟。沟里是纯黑，一侧翻出湿亮的新肉。
    for (let index = 0; index < skin.gashes.length; index += 1) {
      const gash = skin.gashes[index];
      const open = 0.6 + 0.4 * Math.sin(time * gash.speed + gash.phase);
      const directionX = Math.cos(gash.angle);
      const directionY = Math.sin(gash.angle);
      const normalX = -directionY;
      const normalY = directionX;
      const half = gash.length * radius * 0.68;
      const centerX = x + normalX * gash.offset * radius;
      const centerY = y + normalY * gash.offset * radius;
      const mouth = radius * gash.width * 0.14 * open;
      const bulge = gash.curve * radius * 0.22;
      // 沟身：软边的暗红开口，两头收成一点。
      canvas.beginPath();
      canvas.moveTo(centerX - directionX * half, centerY - directionY * half);
      canvas.quadraticCurveTo(
        centerX + normalX * (mouth + bulge), centerY + normalY * (mouth + bulge),
        centerX + directionX * half, centerY + directionY * half
      );
      canvas.quadraticCurveTo(
        centerX - normalX * mouth + normalX * bulge * 0.2,
        centerY - normalY * mouth + normalY * bulge * 0.2,
        centerX - directionX * half, centerY - directionY * half
      );
      canvas.closePath();
      canvas.globalAlpha = 0.8;
      canvas.fillStyle = "#2a0407";
      canvas.fill();
      // 沟底那一道黑芯
      canvas.globalAlpha = 0.7;
      canvas.strokeStyle = "#050001";
      canvas.lineWidth = Math.max(0.5, mouth * 0.5);
      canvas.beginPath();
      canvas.moveTo(centerX - directionX * half * 0.78, centerY - directionY * half * 0.78);
      canvas.quadraticCurveTo(
        centerX + normalX * bulge, centerY + normalY * bulge,
        centerX + directionX * half * 0.78, centerY + directionY * half * 0.78
      );
      canvas.stroke();
      // 翻开的湿唇
      canvas.globalAlpha = 0.45;
      canvas.strokeStyle = MEAT_RAW;
      canvas.lineWidth = Math.max(0.4, radius * 0.028);
      canvas.beginPath();
      canvas.moveTo(centerX - directionX * half * 0.95, centerY - directionY * half * 0.95);
      canvas.quadraticCurveTo(
        centerX + normalX * (mouth * 1.5 + bulge),
        centerY + normalY * (mouth * 1.5 + bulge),
        centerX + directionX * half * 0.95, centerY + directionY * half * 0.95
      );
      canvas.stroke();
    }
    canvas.globalAlpha = 1;

    // 孔洞：越张越开的肉窟窿，里面是纯黑，边上翻出红肉。
    for (let index = 0; index < skin.holes.length; index += 1) {
      const hole = skin.holes[index];
      const open = 0.55 + 0.45 * Math.sin(time * hole.speed + hole.phase);
      const holeX = x + Math.cos(hole.angle) * hole.offset * radius;
      const holeY = y + Math.sin(hole.angle) * hole.offset * radius;
      const size = radius * hole.size * (0.7 + 0.5 * open);
      const rim = canvas.createRadialGradient(
        holeX, holeY, size * 0.75, holeX, holeY, size * 2.2
      );
      rim.addColorStop(0, "rgba(186, 56, 56, 0.95)");
      rim.addColorStop(0.45, "rgba(118, 22, 28, 0.5)");
      rim.addColorStop(1, "rgba(80, 12, 18, 0)");
      canvas.fillStyle = rim;
      canvas.beginPath();
      canvas.arc(holeX, holeY, size * 2.2, 0, TAU);
      canvas.fill();
      const hollow = canvas.createRadialGradient(holeX, holeY, 0, holeX, holeY, size);
      hollow.addColorStop(0, "#000000");
      hollow.addColorStop(0.7, HOLE);
      hollow.addColorStop(1, "rgba(70, 8, 12, 0.35)");
      canvas.fillStyle = hollow;
      canvas.beginPath();
      canvas.arc(holeX, holeY, size, 0, TAU);
      canvas.fill();
    }

    // 骨白与脂肪：几道压在肉上的细长纹理。印象图里的白是"丝"而不是"片"，
    // 所以这里画成细长的高光条，而不是几块硬边的碎骨。
    canvas.lineCap = "round";
    for (let index = 0; index < skin.shards.length; index += 1) {
      const streak = skin.shards[index];
      const angle = streak.angle + Math.sin(time * 0.5 + streak.phase) * 0.12;
      const directionX = Math.cos(angle);
      const directionY = Math.sin(angle);
      const normalX = -directionY;
      const normalY = directionX;
      const centerX = x + normalX * streak.offset * radius;
      const centerY = y + normalY * streak.offset * radius;
      const half = radius * (0.5 + streak.size * 2.4);
      const bow = streak.spin * radius * 0.32;
      canvas.globalAlpha = 0.18 + 0.18 * (index % 2);
      canvas.strokeStyle = index % 2 === 0 ? "#f2e3d6" : "#f7edd6";
      canvas.lineWidth = Math.max(0.7, radius * (0.05 + streak.size * 0.6));
      canvas.beginPath();
      canvas.moveTo(centerX - directionX * half, centerY - directionY * half);
      canvas.quadraticCurveTo(
        centerX + normalX * bow, centerY + normalY * bow,
        centerX + directionX * half, centerY + directionY * half
      );
      canvas.stroke();
    }
    canvas.globalAlpha = 1;

    // 翻出牙龈的碎牙：皮肤上直接戳出来的几颗。
    for (let index = 0; index < skin.teeth.length; index += 1) {
      const tooth = skin.teeth[index];
      const angle = tooth.angle + Math.sin(time * 0.7 + index) * 0.08;
      const toothX = x + Math.cos(angle) * tooth.offset * radius;
      const toothY = y + Math.sin(angle) * tooth.offset * radius;
      const size = radius * tooth.size * 0.85;
      canvas.save();
      canvas.translate(toothX, toothY);
      canvas.rotate(angle + tooth.tilt);
      canvas.fillStyle = "rgba(120, 24, 30, 0.9)";
      canvas.beginPath();
      canvas.ellipse(-size * 0.45, 0, size * 0.8, size * 0.6, 0, 0, TAU);
      canvas.fill();
      canvas.fillStyle = "#f3ead9";
      canvas.beginPath();
      canvas.moveTo(-size * 0.5, -size * 0.42);
      canvas.quadraticCurveTo(size * 0.9, -size * 0.3, size * 1.6, 0);
      canvas.quadraticCurveTo(size * 0.9, size * 0.3, -size * 0.5, size * 0.42);
      canvas.closePath();
      canvas.fill();
      canvas.restore();
    }

    // 湿亮：一盏贴着表面滑动的灯，让整团肉看起来一直在渗水。
    const shineAngle = -Math.PI * 0.7 + Math.sin(time * 0.9) * 0.35;
    const shineX = x + Math.cos(shineAngle) * radius * 0.42;
    const shineY = y + Math.sin(shineAngle) * radius * 0.42;
    const shine = canvas.createRadialGradient(shineX, shineY, 0, shineX, shineY, radius * 0.8);
    shine.addColorStop(0, "rgba(255, 235, 228, 0.4)");
    shine.addColorStop(0.5, "rgba(255, 214, 206, 0.12)");
    shine.addColorStop(1, "rgba(255, 214, 206, 0)");
    canvas.fillStyle = shine;
    canvas.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    canvas.restore();

    // 轮廓：外面一圈湿边，压住整个形状。
    canvas.save();
    traceBodyPath(canvas, x, y, radius, time, seed);
    canvas.strokeStyle = "rgba(28, 2, 5, 0.9)";
    canvas.lineWidth = Math.max(1, radius * 0.075);
    canvas.stroke();
    canvas.strokeStyle = "rgba(255, 196, 186, 0.35)";
    canvas.lineWidth = Math.max(0.5, radius * 0.03);
    canvas.stroke();
    canvas.restore();
  }

  // ---------- 小兵美术 ----------
  // 七种小兵各自有能一眼认出来的剪影：同样的肉，长出来的东西不一样。

  function drawFleshOrb(canvas, ball, time, options) {
    const settings = options || {};
    const radius = settings.radius || ball.radius;
    const lobes = settings.lobes || 3;
    const wobble = 1 + Math.sin(time * 5.2 + ball.x * 0.11 + ball.y * 0.07) * 0.075;
    canvas.save();
    canvas.beginPath();
    for (let index = 0; index <= 20; index += 1) {
      const theta = index / 20 * TAU;
      const bump = 1
        + Math.sin(theta * lobes + time * 2.6 + ball.y * 0.05) * 0.09
        + Math.sin(theta * (lobes + 2) - time * 1.8) * 0.05;
      const pointX = ball.x + Math.cos(theta) * radius * wobble * bump;
      const pointY = ball.y + Math.sin(theta) * radius * wobble * bump;
      if (index === 0) canvas.moveTo(pointX, pointY);
      else canvas.lineTo(pointX, pointY);
    }
    canvas.closePath();
    canvas.fillStyle = MEAT_DEEP;
    canvas.fill();
    canvas.clip();
    // 底肉：受光面朝上，下缘压到近黑。
    const base = canvas.createRadialGradient(
      ball.x - radius * 0.32, ball.y - radius * 0.42, radius * 0.12,
      ball.x, ball.y, radius * 1.15
    );
    base.addColorStop(0, settings.accent || MEAT_MID);
    base.addColorStop(0.55, MEAT_DARK);
    base.addColorStop(1, "#380509");
    canvas.fillStyle = base;
    canvas.fillRect(ball.x - radius, ball.y - radius, radius * 2, radius * 2);
    // 纤维：沿着行进方向拖出来的一束束肉丝，越靠边越细。
    const heading = Math.atan2(ball.vy || 0, ball.vx || 0);
    const headX = Math.cos(heading);
    const headY = Math.sin(heading);
    const sideX = -headY;
    const sideY = headX;
    canvas.lineCap = "round";
    for (let index = 0; index < 5; index += 1) {
      const spread = (index - 2) * radius * 0.34;
      const drift = Math.sin(time * 3.4 + index * 1.7) * radius * 0.14;
      const thin = index % 2 === 1;
      canvas.strokeStyle = thin ? SINEW : MEAT_RAW;
      canvas.globalAlpha = thin ? 0.34 : 0.44;
      canvas.lineWidth = Math.max(0.4, radius * (thin ? 0.12 : 0.2));
      canvas.beginPath();
      canvas.moveTo(
        ball.x - headX * radius * 0.9 + sideX * spread,
        ball.y - headY * radius * 0.9 + sideY * spread
      );
      canvas.quadraticCurveTo(
        ball.x + sideX * (spread + drift),
        ball.y + sideY * (spread + drift),
        ball.x + headX * radius * 0.95 + sideX * spread,
        ball.y + headY * radius * 0.95 + sideY * spread
      );
      canvas.stroke();
    }
    // 一个黑窟窿 + 一片白膜：小尺寸下这两笔决定"这是一块肉"。
    canvas.globalAlpha = 0.85;
    canvas.fillStyle = HOLE;
    canvas.beginPath();
    canvas.arc(
      ball.x + sideX * radius * 0.3 + headX * radius * 0.2,
      ball.y + sideY * radius * 0.3 + headY * radius * 0.2,
      radius * 0.26, 0, TAU
    );
    canvas.fill();
    canvas.globalAlpha = 0.32;
    canvas.fillStyle = FAT;
    canvas.beginPath();
    canvas.ellipse(
      ball.x - headX * radius * 0.28 - sideX * radius * 0.22,
      ball.y - headY * radius * 0.28 - sideY * radius * 0.22,
      radius * 0.42, radius * 0.3, heading - 0.5, 0, TAU
    );
    canvas.fill();
    canvas.globalAlpha = 1;
    canvas.restore();
    // 轮廓 + 上缘湿光
    canvas.strokeStyle = "rgba(30, 3, 6, 0.9)";
    canvas.lineWidth = Math.max(0.7, radius * 0.18);
    canvas.beginPath();
    canvas.arc(ball.x, ball.y, radius * wobble, 0, TAU);
    canvas.stroke();
    canvas.strokeStyle = "rgba(255, 214, 204, 0.35)";
    canvas.lineWidth = Math.max(0.4, radius * 0.08);
    canvas.beginPath();
    canvas.arc(ball.x, ball.y, radius * wobble * 0.92, -Math.PI * 0.95, -Math.PI * 0.35);
    canvas.stroke();
  }

  // 触手：一条从粗到细、带吸盘和裂口嘴的锥形手臂。
  function drawTentacleArm(canvas, x, y, tipX, tipY, time, thickness) {
    const deltaX = tipX - x;
    const deltaY = tipY - y;
    const length = Math.hypot(deltaX, deltaY);
    if (length <= EPSILON) {
      canvas.fillStyle = MEAT_MID;
      canvas.beginPath();
      canvas.arc(x, y, thickness * 1.6, 0, TAU);
      canvas.fill();
      return;
    }
    const directionX = deltaX / length;
    const directionY = deltaY / length;
    const normalX = -directionY;
    const normalY = directionX;
    const slack = clamp(1 - length / TENTACLE_MAX_LENGTH, 0, 1);
    const steps = 12;
    const spine = [];
    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;
      const sag = Math.sin(progress * Math.PI) * slack * thickness * 1.5 *
        Math.sin(time * 4.4 - progress * 3.6);
      spine.push({
        x: x + deltaX * progress + normalX * sag,
        y: y + deltaY * progress + normalY * sag,
        width: thickness * (1.35 - progress * 0.95)
      });
    }
    canvas.save();
    canvas.beginPath();
    canvas.moveTo(spine[0].x + normalX * spine[0].width, spine[0].y + normalY * spine[0].width);
    for (let step = 1; step <= steps; step += 1) {
      const point = spine[step];
      canvas.lineTo(point.x + normalX * point.width, point.y + normalY * point.width);
    }
    for (let step = steps; step >= 0; step -= 1) {
      const point = spine[step];
      canvas.lineTo(point.x - normalX * point.width, point.y - normalY * point.width);
    }
    canvas.closePath();
    canvas.fillStyle = MEAT_DARK;
    canvas.fill();
    canvas.strokeStyle = "rgba(40, 4, 8, 0.9)";
    canvas.lineWidth = Math.max(0.5, thickness * 0.35);
    canvas.stroke();
    // 体节环 + 内侧吸盘
    canvas.strokeStyle = "rgba(236, 189, 178, 0.5)";
    canvas.lineWidth = Math.max(0.4, thickness * 0.22);
    for (let step = 2; step < steps; step += 2) {
      const point = spine[step];
      canvas.beginPath();
      canvas.moveTo(point.x + normalX * point.width * 0.9, point.y + normalY * point.width * 0.9);
      canvas.lineTo(point.x - normalX * point.width * 0.9, point.y - normalY * point.width * 0.9);
      canvas.stroke();
    }
    for (let step = 1; step <= 5; step += 1) {
      const progress = step / 6;
      const index = Math.round(progress * steps);
      const point = spine[index];
      canvas.fillStyle = "rgba(248, 214, 202, 0.75)";
      canvas.beginPath();
      canvas.arc(
        point.x - normalX * point.width * 0.4,
        point.y - normalY * point.width * 0.4,
        Math.max(0.5, point.width * 0.3),
        0,
        TAU
      );
      canvas.fill();
    }
    // 挂着的筋：两条比手臂更松的浅色丝，沿着手臂一路连到手掌。
    canvas.strokeStyle = "rgba(236, 217, 200, 0.45)";
    canvas.lineWidth = Math.max(0.3, thickness * 0.16);
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? -1 : 1;
      canvas.beginPath();
      canvas.moveTo(spine[0].x, spine[0].y);
      for (let step = 1; step <= steps; step += 1) {
        const point = spine[step];
        const strandSag = Math.sin(step / steps * Math.PI) *
          Math.max(1.1, thickness * 0.85) * side * (1 + slack);
        canvas.lineTo(
          point.x + normalX * strandSag,
          point.y + normalY * strandSag
        );
      }
      canvas.stroke();
    }
    // 根部挂着的筋：三两截短丝把这条手臂和身体连在一起。
    canvas.strokeStyle = "rgba(232, 201, 180, 0.5)";
    canvas.lineWidth = Math.max(0.35, thickness * 0.18);
    for (let index = -1; index <= 1; index += 1) {
      const rootX = spine[0].x + normalX * thickness * 0.6 * index;
      const rootY = spine[0].y + normalY * thickness * 0.6 * index;
      canvas.beginPath();
      canvas.moveTo(rootX, rootY);
      canvas.lineTo(
        rootX - directionX * thickness * (1.6 + Math.abs(index) * 0.5) +
          normalX * index * thickness * 0.5,
        rootY - directionY * thickness * (1.6 + Math.abs(index) * 0.5) +
          normalY * index * thickness * 0.5
      );
      canvas.stroke();
    }
    // 尖端裂口
    const tip = spine[steps];
    canvas.fillStyle = "rgba(20, 2, 4, 0.9)";
    canvas.beginPath();
    canvas.ellipse(
      tip.x, tip.y, tip.width * 1.1, tip.width * 0.55,
      Math.atan2(directionY, directionX), 0, TAU
    );
    canvas.fill();
    canvas.strokeStyle = "rgba(255, 214, 204, 0.55)";
    canvas.lineWidth = Math.max(0.4, thickness * 0.18);
    canvas.beginPath();
    canvas.moveTo(tip.x + normalX * tip.width * 1.1, tip.y + normalY * tip.width * 1.1);
    canvas.lineTo(tip.x - normalX * tip.width * 1.1, tip.y - normalY * tip.width * 1.1);
    canvas.stroke();
    // 抓地的手：尖端叉出三根短指头，抓住地面的时候才读得出这是"手臂"。
    const reach = Math.atan2(directionY, directionX);
    canvas.strokeStyle = "#a5242c";
    canvas.lineWidth = Math.max(0.8, thickness * 0.5);
    for (let index = -1; index <= 1; index += 1) {
      const spread = index * 0.55;
      const rootX = tip.x + normalX * tip.width * 0.55 * index;
      const rootY = tip.y + normalY * tip.width * 0.55 * index;
      canvas.beginPath();
      canvas.moveTo(rootX, rootY);
      canvas.lineTo(
        rootX + Math.cos(reach + spread) * tip.width * 2.1,
        rootY + Math.sin(reach + spread) * tip.width * 2.1
      );
      canvas.stroke();
    }
    canvas.restore();
  }

  // 蛆：一节一节的身体，头端有口器，伸头时体节拉长。
  // 蛆：一整块被拉长又缩回去的肉 —— 不分节，就是本体被拉伸的那种感觉。
  function drawMaggotBody(canvas, options) {
    const { startX, startY, endX, endY, radius, time, headRadius, extending } = options;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    const directionX = length <= EPSILON ? 1 : deltaX / length;
    const directionY = length <= EPSILON ? 0 : deltaY / length;
    const normalX = -directionY;
    const normalY = directionX;
    const headAngle = Math.atan2(directionY, directionX);
    // 尾巴平时拖在身后一小截，拉长时几乎收进身体里。
    const tailReach = extending ? radius * 0.25 : radius * 1.05;
    // 拉得越长腰越细，缩回来时又鼓回原样。
    const stretchAmount = clamp(length / (radius * 8), 0, 1);
    const waist = radius * (1 - stretchAmount * 0.42);
    const headWidth = Math.max(radius * 0.78, headRadius * 0.92);
    const tailWidth = waist * 0.95;
    const tailX = startX - directionX * tailReach;
    const tailY = startY - directionY * tailReach;
    const sway = Math.sin(time * 5.5) * radius * 0.12 * (1 - stretchAmount);
    canvas.save();
    canvas.beginPath();
    // 尾端也要收成圆头：从尾底沿着体侧上到头部
    canvas.moveTo(
      tailX + normalX * tailWidth + directionX * sway,
      tailY + normalY * tailWidth + directionY * sway
    );
    canvas.quadraticCurveTo(
      startX + normalX * waist * 1.05, startY + normalY * waist * 1.05,
      endX + normalX * headWidth, endY + normalY * headWidth
    );
    // 头：整圈圆头
    canvas.arc(endX, endY, headWidth, headAngle + Math.PI / 2, headAngle - Math.PI / 2, true);
    canvas.quadraticCurveTo(
      startX - normalX * waist * 1.05, startY - normalY * waist * 1.05,
      tailX - normalX * tailWidth + directionX * sway,
      tailY - normalY * tailWidth + directionY * sway
    );
    // 尾巴：绕尾点补一个半圆，收成圆滚滚的屁股，而不是齐口切断。
    canvas.arc(
      tailX + directionX * sway,
      tailY + directionY * sway,
      tailWidth,
      headAngle - Math.PI / 2,
      headAngle + Math.PI / 2,
      true
    );
    canvas.closePath();
    const body = canvas.createLinearGradient(
      startX - normalX * radius, startY - normalY * radius,
      startX + normalX * radius, startY + normalY * radius
    );
    body.addColorStop(0, "#7d141b");
    body.addColorStop(0.45, "#b32b32");
    body.addColorStop(1, "#650e15");
    canvas.fillStyle = body;
    canvas.fill();
    canvas.strokeStyle = "rgba(30, 3, 7, 0.9)";
    canvas.lineWidth = Math.max(0.6, radius * 0.16);
    canvas.stroke();
    // 尾节：尾巴根部一圈浅色的褶，收口处再压一道暗环
    canvas.lineCap = "round";
    const tailRingX = tailX + directionX * (tailReach * 0.55) + directionX * sway;
    const tailRingY = tailY + directionY * (tailReach * 0.55) + directionY * sway;
    const tailRingWidth = tailWidth * 0.86;
    canvas.strokeStyle = "rgba(240, 206, 194, 0.34)";
    canvas.lineWidth = Math.max(0.4, radius * 0.09);
    canvas.beginPath();
    canvas.arc(
      tailRingX, tailRingY, tailRingWidth,
      headAngle - 1.25, headAngle + 1.25, true
    );
    canvas.stroke();
    canvas.strokeStyle = "rgba(26, 3, 6, 0.55)";
    canvas.lineWidth = Math.max(0.4, radius * 0.08);
    canvas.beginPath();
    canvas.arc(
      tailX + directionX * (tailReach * 0.2) + directionX * sway,
      tailY + directionY * (tailReach * 0.2) + directionY * sway,
      tailWidth * 0.72,
      headAngle - 1.1, headAngle + 1.1, true
    );
    canvas.stroke();
    // 绷出来的两道筋：拉得越长越明显。
    canvas.strokeStyle = "rgba(242, 214, 200, " + (0.16 + stretchAmount * 0.3).toFixed(3) + ")";
    canvas.lineWidth = Math.max(0.4, radius * 0.1);
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? -1 : 1;
      canvas.beginPath();
      canvas.moveTo(
        tailX + normalX * waist * 0.5 * side,
        tailY + normalY * waist * 0.5 * side
      );
      canvas.quadraticCurveTo(
        (startX + endX) * 0.5 + normalX * waist * 0.9 * side,
        (startY + endY) * 0.5 + normalY * waist * 0.9 * side,
        endX + normalX * headWidth * 0.55 * side,
        endY + normalY * headWidth * 0.55 * side
      );
      canvas.stroke();
    }
    // 头端那片黑口
    canvas.save();
    canvas.translate(endX, endY);
    canvas.rotate(headAngle);
    canvas.fillStyle = "#2c0306";
    canvas.beginPath();
    canvas.ellipse(headWidth * 0.35, 0, headWidth * 0.5, headWidth * 0.34, 0, 0, TAU);
    canvas.fill();
    canvas.fillStyle = "#e9d2c4";
    for (let index = 0; index < 2; index += 1) {
      const side = index === 0 ? -1 : 1;
      canvas.beginPath();
      canvas.moveTo(headWidth * 0.35, side * headWidth * 0.06);
      canvas.lineTo(headWidth * 0.95, side * headWidth * 0.3);
      canvas.lineTo(headWidth * 0.4, side * headWidth * 0.3);
      canvas.closePath();
      canvas.fill();
    }
    canvas.restore();
    canvas.restore();
  }

  // 血肉弹：一头圆一头收的肉丸，拖着一条筋。
  function drawFleshBullet(canvas, effect, time) {
    const angle = Math.atan2(effect.vy, effect.vx);
    const radius = effect.radius;
    canvas.save();
    canvas.globalAlpha *= 0.4;
    canvas.strokeStyle = MEAT_MID;
    canvas.lineWidth = radius * 1.1;
    canvas.beginPath();
    canvas.moveTo(
      effect.x - Math.cos(angle) * radius * 3.4,
      effect.y - Math.sin(angle) * radius * 3.4
    );
    canvas.lineTo(effect.x, effect.y);
    canvas.stroke();
    canvas.globalAlpha = 1;
    canvas.translate(effect.x, effect.y);
    canvas.rotate(angle + Math.sin(time * 8) * 0.12);
    canvas.fillStyle = MEAT_DARK;
    canvas.beginPath();
    canvas.ellipse(0, 0, radius * 1.2, radius * 0.95, 0, 0, TAU);
    canvas.fill();
    canvas.strokeStyle = "rgba(34, 3, 6, 0.85)";
    canvas.lineWidth = 0.8;
    canvas.stroke();
    canvas.fillStyle = SINEW;
    canvas.beginPath();
    canvas.moveTo(-radius * 1.1, -radius * 0.3);
    canvas.lineTo(-radius * 3.2, -radius * 0.1);
    canvas.lineTo(-radius * 1.1, radius * 0.26);
    canvas.closePath();
    canvas.fill();
    canvas.fillStyle = MEAT_RAW;
    canvas.beginPath();
    canvas.arc(radius * 0.28, -radius * 0.22, radius * 0.38, 0, TAU);
    canvas.fill();
    canvas.restore();
  }

  // 短触手：一根带倒刺的硬刀，绕着小兵转。
  // 短触手：一根带倒刺的硬刀，绕着小球的**外沿**转（和刺客的匕首同一个挂点），
  // 整片刀身都在球体外面扫。
  function drawBarbedWhip(canvas, ball, angle, time) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    const rootX = ball.x + directionX * ball.radius * 0.92;
    const rootY = ball.y + directionY * ball.radius * 0.92;
    const tipX = ball.x + directionX * (ball.radius + WHIP_LENGTH);
    const tipY = ball.y + directionY * (ball.radius + WHIP_LENGTH);
    canvas.save();
    canvas.lineCap = "round";
    // 刀身：根部粗、尖端收成一点
    canvas.beginPath();
    canvas.moveTo(rootX + normalX * WHIP_THICKNESS, rootY + normalY * WHIP_THICKNESS);
    canvas.lineTo(tipX + normalX * WHIP_THICKNESS * 0.18, tipY + normalY * WHIP_THICKNESS * 0.18);
    canvas.lineTo(tipX - normalX * WHIP_THICKNESS * 0.18, tipY - normalY * WHIP_THICKNESS * 0.18);
    canvas.lineTo(rootX - normalX * WHIP_THICKNESS, rootY - normalY * WHIP_THICKNESS);
    canvas.closePath();
    canvas.fillStyle = "#c33b3b";
    canvas.fill();
    canvas.strokeStyle = "rgba(26, 2, 5, 0.95)";
    canvas.lineWidth = Math.max(0.5, WHIP_THICKNESS * 0.2);
    canvas.stroke();
    // 绷在刀身上的那根筋
    canvas.strokeStyle = "rgba(250, 214, 204, 0.7)";
    canvas.lineWidth = Math.max(0.5, WHIP_THICKNESS * 0.3);
    canvas.beginPath();
    canvas.moveTo(rootX, rootY);
    canvas.lineTo(tipX, tipY);
    canvas.stroke();
    // 倒刺：从刀背往外叉的白骨刺
    for (let index = 1; index <= WHIP_BARBS; index += 1) {
      const progress = index / (WHIP_BARBS + 1);
      const baseX = rootX + (tipX - rootX) * progress;
      const baseY = rootY + (tipY - rootY) * progress;
      const barb = WHIP_THICKNESS * (1.15 - progress * 0.6);
      canvas.fillStyle = "#efe3d4";
      canvas.beginPath();
      canvas.moveTo(baseX, baseY);
      canvas.lineTo(
        baseX + normalX * barb * 2.1 - directionX * barb * 0.5,
        baseY + normalY * barb * 2.1 - directionY * barb * 0.5
      );
      canvas.lineTo(
        baseX + normalX * barb * 2.1 + directionX * barb * 0.6,
        baseY + normalY * barb * 2.1 + directionY * barb * 0.6
      );
      canvas.closePath();
      canvas.fill();
      canvas.strokeStyle = "rgba(70, 24, 26, 0.7)";
      canvas.lineWidth = 0.3;
      canvas.stroke();
    }
    canvas.restore();
  }


  // 弹跳：卷起来的弹簧肉，空中被拉长。
  function drawHopperBody(canvas, ball, time, stretch) {
    const radius = ball.radius;
    const vertical = Math.max(1, stretch);
    canvas.save();
    canvas.translate(ball.x, ball.y);
    // 跳起来的时候整团肉被拉长
    canvas.scale(1 / vertical, vertical);
    const coil = canvas.createRadialGradient(
      -radius * 0.3, -radius * 0.38, radius * 0.1, 0, 0, radius * 1.15
    );
    coil.addColorStop(0, MEAT_MID);
    coil.addColorStop(0.6, MEAT_DARK);
    coil.addColorStop(1, "#360409");
    canvas.fillStyle = coil;
    canvas.beginPath();
    canvas.arc(0, 0, radius, 0, TAU);
    canvas.fill();
    // 收在肚子上的三圈弹簧褶
    for (let index = 0; index < 3; index += 1) {
      const offset = (index - 1) * radius * 0.44;
      canvas.strokeStyle = "rgba(26, 3, 6, 0.7)";
      canvas.lineWidth = Math.max(0.5, radius * 0.11);
      canvas.beginPath();
      canvas.ellipse(0, offset, radius * 0.84, radius * 0.2, 0, 0, TAU);
      canvas.stroke();
      canvas.strokeStyle = "rgba(240, 206, 194, 0.35)";
      canvas.lineWidth = Math.max(0.35, radius * 0.06);
      canvas.beginPath();
      canvas.ellipse(0, offset, radius * 0.58, radius * 0.12, 0, 0, TAU);
      canvas.stroke();
    }
    canvas.fillStyle = "rgba(255, 226, 216, 0.42)";
    canvas.beginPath();
    canvas.arc(-radius * 0.3, -radius * 0.42, radius * 0.24, 0, TAU);
    canvas.fill();
    canvas.restore();
    canvas.strokeStyle = "rgba(30, 3, 6, 0.9)";
    canvas.lineWidth = Math.max(0.7, radius * 0.16);
    canvas.beginPath();
    canvas.ellipse(ball.x, ball.y, radius / vertical, radius * vertical, 0, 0, TAU);
    canvas.stroke();
  }

  // 碎裂尖牙：一身戳出牙的肉球。
  function drawToothyOrb(canvas, ball, time) {
    drawFleshOrb(canvas, ball, time, { lobes: 5, accent: "#8d1a22" });
    canvas.save();
    const teeth = 7;
    for (let index = 0; index < teeth; index += 1) {
      const angle = time * 0.5 + index / teeth * TAU + ball.x * 0.05;
      const size = ball.radius * 0.26;
      const baseX = ball.x + Math.cos(angle) * ball.radius * 0.95;
      const baseY = ball.y + Math.sin(angle) * ball.radius * 0.92;
      canvas.save();
      canvas.translate(baseX, baseY);
      canvas.rotate(angle);
      // 牙龈
      canvas.fillStyle = "rgba(122, 22, 28, 0.95)";
      canvas.beginPath();
      canvas.ellipse(-size * 0.3, 0, size * 0.9, size * 0.62, 0, 0, TAU);
      canvas.fill();
      // 牙
      canvas.fillStyle = "#f1e6d5";
      canvas.beginPath();
      canvas.moveTo(-size * 0.2, -size * 0.3);
      canvas.quadraticCurveTo(size * 0.9, -size * 0.24, size * 1.25, 0);
      canvas.quadraticCurveTo(size * 0.9, size * 0.24, -size * 0.2, size * 0.3);
      canvas.closePath();
      canvas.fill();
      canvas.restore();
    }
    canvas.restore();
  }

  // 落地冲击波
  function createShockwaveEffect(x, y) {
    return {
      kind: "bai-wan-ren-shockwave",
      life: 0.32,
      radius: SHOCKWAVE_RADIUS,
      x,
      y,
      update({ effect, game }) {
        if (game.state !== "running") effect.life = 0;
      },
      draw({ effect }, canvas) {
        const fade = clamp(1 - (effect.age || 0) / effect.life, 0, 1);
        const radius = SHOCKWAVE_RADIUS * (0.35 + 0.65 * (1 - fade));
        canvas.save();
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = fade * 0.6;
        canvas.strokeStyle = "#ffb7ad";
        canvas.lineWidth = 2.6;
        canvas.beginPath();
        canvas.arc(effect.x, effect.y, radius, 0, TAU);
        canvas.stroke();
        canvas.globalAlpha = fade * 0.28;
        canvas.strokeStyle = "#f2dfd2";
        canvas.lineWidth = 1.2;
        canvas.beginPath();
        canvas.arc(effect.x, effect.y, radius * 0.72, 0, TAU);
        canvas.stroke();
        // 甩出来的肉末
        for (let index = 0; index < 7; index += 1) {
          const angle = index / 7 * TAU + fade * 2;
          const distance = radius * (0.8 + (index % 3) * 0.12);
          canvas.fillStyle = index % 2 === 0 ? MEAT_MID : SINEW;
          canvas.globalAlpha = fade * 0.8;
          canvas.beginPath();
          canvas.arc(
            effect.x + Math.cos(angle) * distance,
            effect.y + Math.sin(angle) * distance,
            1.1 + (index % 2) * 0.7,
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  function createFleshPelletEntity(ball, direction) {
    return {
      kind: "bai-wan-ren-flesh-bullet",
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
          game.arena ? !game.arena.intersectsCircle(effect.x, effect.y, 24) : (
            effect.x < -24 || effect.x > game.arenaSize + 24 ||
            effect.y < -24 || effect.y > game.arenaSize + 24)
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, canvas) {
        drawFleshBullet(canvas, effect, effect.age || 0);
      }
    };
  }

  function spawnFleshBurst(services, x, y, count = 18, speed = 90) {
    services.spawnParticleBurst({
      kind: "bai-wan-ren-flesh-burst",
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
      colors: [MEAT_DARK, MEAT_MID, MEAT_RAW, MEAT_DEEP, SINEW]
    });
  }

  function createLungeKnockback(directionX, directionY) {
    return createSharedKnockback({
      id: "bai-wan-ren-lunge-knockback",
      duration: LUNGE_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: LUNGE_KNOCKBACK_MULTIPLIER
    });
  }
  function createStunEffect() {
    return {
      id: "bai-wan-ren-stun",
      visualType: "stun",
      duration: SHOCKWAVE_STUN_DURATION,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true
    };
  }

  // ---------- 小兵定义：外观一致，长出来的东西不同 ----------
  //
  // 七种小兵各自对应场上一位角色的"血肉版"。这是设计对位，不是机制复制：
  //   长触手  ← 桔梗（蜘蛛网）：丝钉在场上，碰到就掉血，同一次接触只结算一口
  //   蛆      ← 象棋：出手的那一下是无敌的，而且带击退
  //   血肉弹  ← 弓箭V2，泛指所有"能发射子弹"的角色
  //   分裂    ← 分裂球：一分为二，分身各自为战
  //   短触手  ← 刺客：绕本体外沿旋转的短剑
  //   弹跳    ← 重锤：大跳落地，冲击波把人震晕
  //   碎牙    ← 玻璃V2：碎一地，扎到就掉血，咬一口就报废

  const BAI_WAN_REN_SUMMON_ID = "baiWanRenSummon";
  const SPLIT_CHILD_ID = "baiWanRenSplitChild";

  function createSummonDefinition(minionKind, description, createBehavior, speed = SUMMON_SPEED) {
    return {
      id: BAI_WAN_REN_SUMMON_ID,
      minionKind,
      name: "\u8840\u8089\u5c0f\u5175",
      englishName: "Flesh Minion",
      color: BODY_COLOR,
      renderAboveGpuEffects: true,
      description,
      stats: {
        radius: SUMMON_RADIUS,
        speed,
        maxHp: SUMMON_HP
      },
      createBehavior
    };
  }

  const splitChildDefinition = {
    id: SPLIT_CHILD_ID,
    minionKind: "splitChild",
    name: "\u5206\u88c2\u8089\u7403",
    englishName: "Split Flesh",
    color: BODY_COLOR,
    renderAboveGpuEffects: true,
    description: "\u767e\u4e07\u4eba\u5206\u88c2\u51fa\u6765\u7684\u8089\u7403",
    stats: {
      radius: SPLIT_CHILD_RADIUS,
      speed: SUMMON_SPEED,
      maxHp: SUMMON_HP
    },
    createBehavior(services) {
      return createMinionBase(services, {
        update() {},
        render(ball, time, canvas) {
          drawFleshOrb(canvas, ball, time, { lobes: 2, accent: "#b02c33" });
          // 刚分开的那道疤：两瓣鼓出来的肉 + 中间的黑缝
          const seam = Math.sin(time * 3 + ball.x * 0.06) * 0.2;
          canvas.save();
          canvas.fillStyle = "rgba(178, 60, 62, 0.35)";
          canvas.beginPath();
          canvas.ellipse(
            ball.x - ball.radius * 0.3, ball.y - ball.radius * 0.3,
            ball.radius * 0.55, ball.radius * 0.42, seam, 0, TAU
          );
          canvas.fill();
          canvas.beginPath();
          canvas.ellipse(
            ball.x + ball.radius * 0.3, ball.y + ball.radius * 0.3,
            ball.radius * 0.55, ball.radius * 0.42, seam, 0, TAU
          );
          canvas.fill();
          canvas.strokeStyle = "rgba(20, 1, 3, 0.9)";
          canvas.lineWidth = Math.max(0.7, ball.radius * 0.26);
          canvas.beginPath();
          canvas.moveTo(ball.x - ball.radius * 0.62, ball.y - ball.radius * 0.38 + seam);
          canvas.lineTo(ball.x + ball.radius * 0.62, ball.y + ball.radius * 0.38 + seam);
          canvas.stroke();
          canvas.restore();
        },
        onCollision(context, target) {
          context.services.dealDamage(target, CONTACT_DAMAGE);
        }
      });
    }
  };

  // ---------- 肉核视效（不伤害、不碰撞、不参与索敌） ----------

  // 小兵死掉后在地上留一滩血渍：慢慢摊开、慢慢淡掉，读的就是"这地方刚死过一块肉"。
  function createGoreDecal(x, y, radius, seed) {
    const splats = [];
    for (let index = 0; index < 7; index += 1) {
      const angle = hash2(index, 3.1, seed) * TAU;
      const distance = radius * (0.15 + hash2(index, 7.7, seed + 2) * 1.2);
      splats.push({
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        radiusX: radius * (0.5 + hash2(index, 11.3, seed + 4) * 1.1),
        radiusY: radius * (0.4 + hash2(index, 13.9, seed + 6) * 0.9),
        rotation: hash2(index, 17.1, seed + 8) * TAU,
        tone: index % 3 === 0 ? "#3d060a" : "#5e0a11"
      });
    }
    return {
      kind: "bai-wan-ren-gore",
      life: 7,
      lifecycle: "independent",
      drawLayer: "background",
      x,
      y,
      radius,
      splats,
      draw({ effect }, canvas) {
        const progress = clamp((effect.age || 0) / effect.life, 0, 1);
        const fade = progress < 0.55 ? 1 : 1 - (progress - 0.55) / 0.45;
        if (fade <= 0) return;
        const spread = 1 + progress * 0.22;
        canvas.save();
        canvas.globalAlpha *= fade * 0.32;
        canvas.fillStyle = "#5e0a11";
        canvas.beginPath();
        canvas.ellipse(x, y, radius * 2 * spread, radius * 1.6 * spread, 0, 0, TAU);
        canvas.fill();
        canvas.globalAlpha *= 1.6;
        for (let index = 0; index < effect.splats.length; index += 1) {
          const splat = effect.splats[index];
          canvas.fillStyle = splat.tone;
          canvas.beginPath();
          canvas.ellipse(
            splat.x,
            splat.y,
            splat.radiusX * spread,
            splat.radiusY * spread,
            splat.rotation,
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  // 被吞掉的那一口：接触点上一个很快收掉的断面，从外到内是皮、脂肪、肌、髓腔。
  function createBiteStump(x, y, radius, angle) {
    const rings = [
      { scale: 1, color: "#7d141b" },
      { scale: 0.74, color: "#e8c9b4" },
      { scale: 0.5, color: "#b32b32" },
      { scale: 0.22, color: "#3d060a" }
    ];
    return {
      kind: "bai-wan-ren-bite",
      life: 0.3,
      lifecycle: "independent",
      drawLayer: "foreground",
      x,
      y,
      radius,
      angle,
      rings,
      draw({ effect }, canvas) {
        const progress = clamp((effect.age || 0) / effect.life, 0, 1);
        const fade = 1 - progress;
        if (fade <= 0) return;
        const scale = 0.55 + progress * 0.75;
        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.rotate(effect.angle);
        canvas.globalAlpha *= fade * 0.9;
        for (let index = 0; index < effect.rings.length; index += 1) {
          const ring = effect.rings[index];
          canvas.fillStyle = ring.color;
          canvas.beginPath();
          canvas.ellipse(
            0, 0,
            radius * ring.scale * scale,
            radius * ring.scale * scale * 0.86,
            0, 0, TAU
          );
          canvas.fill();
        }
        // 甩出来的肉末
        canvas.fillStyle = "#f0a29a";
        for (let index = 0; index < 5; index += 1) {
          const spread = (index - 2) * radius * 0.52;
          canvas.globalAlpha *= 0.92;
          canvas.beginPath();
          canvas.arc(
            progress * radius * 1.7 + radius * 0.2,
            spread * (0.5 + progress),
            Math.max(0.6, radius * 0.16),
            0,
            TAU
          );
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  // ---------- 小兵基类 ----------
  // 小兵不会自己消失：没有寿命，只有被打死才退场（尸体仍会被下一批召唤复用）。
  // 这里只负责绘制入口和血量显示，运动完全交给引擎的普通小球规则。

  function createMinionBase(services, options) {
    const update = options.update;
    const render = options.render || null;
    const getContactProfile = options.getContactProfile || null;
    const transitions = options.transitions || null;
    const deathHook = typeof options.onDeath === "function" ? options.onDeath : null;
    const hooks = {};
    for (const name of Object.keys(options)) {
      if (
        name === "update" || name === "render" || name === "getContactProfile" ||
        name === "transitions" || name === "onDeath"
      ) continue;
      if (typeof options[name] === "function") hooks[name] = options[name];
    }
    const behavior = {
      update(context, dt) {
        update(context, finiteDelta(dt));
      },
      drawBody(context, canvasContext) {
        const ball = context.ball;
        if (render) render(ball, context.game.time, canvasContext);
        else drawFleshOrb(canvasContext, ball, context.game.time, {});
        return true;
      },
      getHpDisplay() {
        return { hidden: true };
      },
      onDeath(context) {
        // 死了就地留一滩血渍（纯视效），再跑这一种小兵自己的死亡动作。
        const ball = context.ball;
        services.spawnVisualEffect(createGoreDecal(
          ball.x,
          ball.y,
          ball.radius,
          hash2(ball.x, ball.y, 9.7) * 53 + 1
        ));
        if (deathHook) deathHook(context);
      }
    };
    for (const name of Object.keys(hooks)) behavior[name] = hooks[name];
    if (getContactProfile) behavior.getContactProfile = getContactProfile;
    if (transitions) behavior.getNextTransitionIn = transitions;
    return behavior;
  }

  // 接触伤害：进入接触结算一次，离开才重新武装。
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
      if (onHit && enemy.hp > 0) onHit(enemy);
    });
  }

  // 1. 触手：拖在身后的一根长臂，端点随着移动迁移，拉满 20 就钉住等本体游回来。
  // 1. 长触手：手掌先往前探出去抓住地面，再把躯体拽过去 —— 断肢拖着躯干一步步
  //    往前爬的那种走法。抓点不会跟着身体往前挪，身体是被这条手臂拉着走的。
  // 1. 长触手：手掌先往前探出去，端点停稳抓住地面之后，躯体才被拽过去。
  //    探手的那段时间躯体是完全不动的 —— 一步步往前挪的就是这种节奏。
  function createTentacleSummonBehavior(services) {
    let tipX = null;
    let tipY = null;
    let gripX = 0;
    let gripY = 0;
    let handLength = 0;
    let planted = false;
    let pullTime = 0;
    let headingX = 1;
    let headingY = 0;
    let headingReady = false;
    const contacts = new Set();

    function aimDirection(ball) {
      // 抓点始终顺着自己上一次的航向 —— 手臂是拿来赶路的，不负责找敌人。
      // 只有敌人贴到身上（近战距离）时才朝它甩一下，这一下是攻击。
      const target = services.getOpponent();
      if (
        target &&
        Math.hypot(target.x - ball.x, target.y - ball.y) <=
          TENTACLE_MELEE_RANGE +
            (Number.isFinite(target.radius) ? target.radius : 0)
      ) {
        return normalizeDirection(target.x - ball.x, target.y - ball.y);
      }
      return { x: headingX, y: headingY };
    }

    function plantGrip(ball, arenaSize) {
      const heading = aimDirection(ball);
      const reach = TENTACLE_MIN_REACH +
        Math.random() * (TENTACLE_MAX_LENGTH - TENTACLE_MIN_REACH);
      // 抓点必须落在场内：伸手撞到墙就按入射角=出射角反射，顺着反射方向
      // 走完剩下的长度，贴墙时也不会被硬压成沿墙边滑。
      const motion = resolveArenaGeometry(arenaSize).advanceMotion({
        x: ball.x, y: ball.y, vx: heading.x, vy: heading.y, radius: ball.radius
      }, reach);
      const landed = { x: motion.x, y: motion.y, directionX: motion.vx, directionY: motion.vy };
      gripX = landed.x;
      gripY = landed.y;
      headingX = landed.directionX;
      headingY = landed.directionY;
      handLength = tipX === null ? 0 : Math.hypot(tipX - ball.x, tipY - ball.y);
      planted = false;
      pullTime = 0;
    }

    return createMinionBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        const arenaSize = context.game.arena || context.game.arenaSize;
        if (tipX === null) {
          tipX = ball.x;
          tipY = ball.y;
          headingReady = false;
        }
        if (!headingReady) {
          const initial = normalizeDirection(ball.vx, ball.vy);
          headingX = initial.x;
          headingY = initial.y;
          headingReady = true;
          plantGrip(ball, arenaSize);
        }
        if (planted) {
          // 端点已经抓住地面：躯体被这条手臂拽过去。
          pullTime += elapsed;
          const deltaX = tipX - ball.x;
          const deltaY = tipY - ball.y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance > EPSILON) {
            const pull = normalizeDirection(deltaX, deltaY);
            headingX = pull.x;
            headingY = pull.y;
            launch(ball, deltaX, deltaY, TENTACLE_SPEED);
          }
          if (
            distance <= TENTACLE_RELEASE_DISTANCE ||
            pullTime >= TENTACLE_PULL_TIMEOUT
          ) {
            plantGrip(ball, arenaSize);
          }
        } else {
          // 端点还在往前探：这一段时间躯体一步都不走。
          holdStill(ball);
          const deltaX = gripX - ball.x;
          const deltaY = gripY - ball.y;
          const distance = Math.hypot(deltaX, deltaY);
          const heading = normalizeDirection(deltaX, deltaY);
          handLength = Math.min(distance, handLength + TENTACLE_REACH_SPEED * elapsed);
          tipX = ball.x + heading.x * handLength;
          tipY = ball.y + heading.y * handLength;
          if (distance <= handLength + EPSILON) {
            // 端点停下（抓住）了，下一拍躯体才开始动。
            tipX = gripX;
            tipY = gripY;
            planted = true;
          }
        }
        sweepContactHit(services, {
          startX: ball.x,
          startY: ball.y,
          endX: tipX,
          endY: tipY,
          hitRadius: TENTACLE_HIT_RADIUS,
          damage: TENTACLE_DAMAGE,
          contacts
        });
      },
      render(ball, time, canvas) {
        const handX = tipX === null ? ball.x : tipX;
        const handY = tipY === null ? ball.y : tipY;
        drawTentacleArm(
          canvas, ball.x, ball.y, handX, handY, time,
          Math.max(1.5, ball.radius * 0.52)
        );
        drawFleshOrb(canvas, ball, time, { lobes: 4 });
      }
    });
  }


  //    往前挪了一截，而不是头伸出去又缩回原地。
  function createMaggotSummonBehavior(services) {
    const CRAWL = "crawl";
    const STRETCH = "stretch";
    const RETRACT = "retract";
    let phase = CRAWL;
    let phaseTime = 0;
    let headDistance = 0;
    let headTime = 0;
    let headingX = 1;
    let headingY = 0;
    let savedVx = 0;
    let savedVy = 0;
    const contacts = new Set();

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

    return createMinionBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        const arenaSize = context.game.arenaSize;
        phaseTime += elapsed;
        if (phase === CRAWL) {
          if (phaseTime + EPSILON >= CRAWL_DURATION) {
            phase = STRETCH;
            phaseTime = 0;
            headDistance = 0;
            headTime = 0;
            // 伸头方向朝敌人：这是攻击动作，不是赶路。
            const target = services.getOpponent();
            const direction = target
              ? normalizeDirection(target.x - ball.x, target.y - ball.y)
              : normalizeDirection(ball.vx, ball.vy);
            headingX = direction.x;
            headingY = direction.y;
            savedVx = ball.storedVx;
            savedVy = ball.storedVy;
            holdStill(ball);
          }
          return;
        }
        holdStill(ball);
        if (phase === STRETCH) {
          headTime += elapsed;
          headDistance = Math.min(LUNGE_MAX_DISTANCE, stretchDistance(headTime));
          if (headTime + EPSILON >= LUNGE_STRETCH_TIME) {
            phase = RETRACT;
            phaseTime = 0;
          }
        } else {
          // 尾巴收到头的位置：躯体整体往前挺进一截。
          const step = Math.min(headDistance, LUNGE_RETRACT_SPEED * elapsed);
          Object.assign(ball, resolveArenaGeometry(context.game).clampPoint(
            ball.x + headingX * step, ball.y + headingY * step, ball.radius));
          headDistance = Math.max(0, headDistance - step);
          if (headDistance <= EPSILON) {
            headDistance = 0;
            phase = CRAWL;
            phaseTime = 0;
            // 挺进完接着按原来的方向漂。
            ball.vx = ball.storedVx = savedVx;
            ball.vy = ball.storedVy = savedVy;
            ball.speedNeedsNormalization = false;
          }
        }
        if (headDistance <= EPSILON) {
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
          const heading = normalizeDirection(ball.vx, ball.vy);
          drawMaggotBody(canvas, {
            startX: ball.x,
            startY: ball.y,
            endX: ball.x + heading.x * ball.radius * 0.75,
            endY: ball.y + heading.y * ball.radius * 0.75,
            radius: ball.radius,
            time,
            headRadius: ball.radius,
            extending: false
          });
          return;
        }
        drawMaggotBody(canvas, {
          startX: ball.x,
          startY: ball.y,
          endX: ball.x + headingX * headDistance,
          endY: ball.y + headingY * headDistance,
          radius: ball.radius,
          time,
          headRadius: headRadiusFor(ball),
          extending: true
        });
      },
      getContactProfile() {
        // 拉长期间无敌：运动停止、不再被选为目标，但还挡路。
        return phase === CRAWL ? null : { targetable: false };
      }
    });
  }

  // 3. 血肉弹：每秒一发，速度 150，伤害 1。
  function createShooterSummonBehavior(services) {
    let timer = FLESH_BULLET_INTERVAL;
    return createMinionBase(services, {
      transitions() {
        return Math.max(SPAWN_INTERVAL, FLESH_BULLET_INTERVAL - timer);
      },
      update(context, elapsed) {
        timer += elapsed;
        while (timer + EPSILON >= FLESH_BULLET_INTERVAL) {
          timer -= FLESH_BULLET_INTERVAL;
          const ball = context.ball;
          const target = services.getOpponent();
          const direction = target
            ? normalizeDirection(target.x - ball.x, target.y - ball.y)
            : normalizeDirection(ball.vx, ball.vy);
          services.spawnProjectile(createFleshPelletEntity(ball, direction));
        }
      },
      render(ball, time, canvas) {
        drawFleshOrb(canvas, ball, time, { lobes: 3, accent: "#a8262d" });
        const angle = Math.atan2(ball.vy, ball.vx);
        canvas.save();
        canvas.translate(ball.x, ball.y);
        canvas.rotate(angle);
        // 嘴：一条黑缝，边上翻着唇肉
        canvas.fillStyle = "#1c0205";
        canvas.beginPath();
        canvas.ellipse(ball.radius * 0.62, 0, ball.radius * 0.42, ball.radius * 0.26, 0, 0, TAU);
        canvas.fill();
        canvas.strokeStyle = "rgba(244, 190, 178, 0.7)";
        canvas.lineWidth = Math.max(0.4, ball.radius * 0.1);
        canvas.beginPath();
        canvas.arc(ball.radius * 0.4, 0, ball.radius * 0.5, -0.9, 0.9);
        canvas.stroke();
        // 已经顶到嘴边的那一发
        canvas.fillStyle = MEAT_RAW;
        canvas.beginPath();
        canvas.arc(ball.radius * 0.66, 0, ball.radius * 0.24, 0, TAU);
        canvas.fill();
        canvas.restore();
      }
    });
  }

  // 4. 分裂：碰撞伤害 1，每 5 秒裂成两个。
  function createSplitSummonBehavior(services) {
    let timer = 0;
    let split = false;
    return createMinionBase(services, {
      transitions() {
        return Math.max(SPAWN_INTERVAL, SPLIT_INTERVAL - timer);
      },
      update(context, elapsed) {
        if (split) return;
        const ball = context.ball;
        timer += elapsed;
        if (timer + EPSILON < SPLIT_INTERVAL) return;
        split = true;
        for (let index = 0; index < 2; index += 1) {
          const angle = Math.random() * TAU;
          const child = placeSummon(services, splitChildDefinition, {
            x: ball.x,
            y: ball.y
          });
          if (!child) continue;
          Object.assign(child, resolveArenaGeometry(context.game).clampPoint(
            ball.x + Math.cos(angle) * 4, ball.y + Math.sin(angle) * 4, child.radius));
          child.prevX = child.x;
          child.prevY = child.y;
          launch(child, Math.cos(angle), Math.sin(angle), SPLIT_PUSH_SPEED);
        }
        spawnFleshBurst(services, ball.x, ball.y, 22, 110);
        services.spawnVisualEffect(createShockwaveEffect(ball.x, ball.y));
        ball.hp = 0;
        ball.active = false;
        ball.fade = 0;
        ball.deathNotified = true;
        ball.diedAt = null;
      },
      render(ball, time, canvas) {
        drawFleshOrb(canvas, ball, time, { lobes: 2 });
        // 正在裂开的那道口子：Y 形，越接近分裂张得越开
        const opening = clamp(timer / SPLIT_INTERVAL, 0, 1);
        const reach = ball.radius * (0.5 + opening * 0.45);
        canvas.save();
        canvas.strokeStyle = "rgba(16, 1, 3, 0.95)";
        canvas.lineWidth = 0.5 + opening * 1.1;
        canvas.lineCap = "round";
        canvas.beginPath();
        canvas.moveTo(ball.x - reach, ball.y - reach * 0.5);
        canvas.lineTo(ball.x - reach * 0.15, ball.y);
        canvas.lineTo(ball.x - reach, ball.y + reach * 0.5);
        canvas.moveTo(ball.x - reach * 0.15, ball.y);
        canvas.lineTo(ball.x + reach * 0.7, ball.y + reach * 0.35);
        canvas.stroke();
        canvas.restore();
      },
      onCollision(context, target) {
        context.services.dealDamage(target, CONTACT_DAMAGE);
      }
    });
  }

  // 5. 短触手：固态刀片绕本体转，接触伤害 1。
  function createWhipSummonBehavior(services) {
    let angle = Math.random() * TAU;
    const contacts = new Set();
    return createMinionBase(services, {
      update(context, elapsed) {
        angle = (angle + WHIP_TURN_RATE * elapsed) % TAU;
        const ball = context.ball;
        // 旋转端点在球的外沿，不是圆心：整片刀身都在球体外面扫。
        const rootX = ball.x + Math.cos(angle) * ball.radius;
        const rootY = ball.y + Math.sin(angle) * ball.radius;
        sweepContactHit(services, {
          startX: rootX,
          startY: rootY,
          endX: rootX + Math.cos(angle) * WHIP_LENGTH,
          endY: rootY + Math.sin(angle) * WHIP_LENGTH,
          hitRadius: WHIP_THICKNESS,
          damage: WHIP_DAMAGE,
          contacts
        });
      },
      render(ball, time, canvas) {
        drawBarbedWhip(canvas, ball, angle, time);
        drawFleshOrb(canvas, ball, time, { lobes: 3 });
      }
    });
  }

  // 6. 弹跳：每秒一次抛物线弹跳，落地冲击波晕 0.2 秒。
  // 6. 弹跳：一次带距离的抛物线弹跳，朝敌人跳、速度 50，跳完就顺着这一跳的
  //    方向继续走；起跳被拉长、落地压扁。
  function createHopperSummonBehavior(services) {
    let hopTimer = HOP_INTERVAL;
    let hop = null;
    let squash = 0;
    const stunnedThisLanding = new Set();
    return createMinionBase(services, {
      update(context, elapsed) {
        const ball = context.ball;
        const arenaSize = context.game.arenaSize;
        if (hop) {
          hop.elapsed += elapsed;
          const progress = clamp(hop.elapsed / hop.airTime, 0, 1);
          ball.x = hop.startX + (hop.endX - hop.startX) * progress;
          ball.y = hop.startY + (hop.endY - hop.startY) * progress;
          hop.height = HOP_ARC_HEIGHT * 4 * progress * (1 - progress);
          holdStill(ball);
          if (progress < 1) return;
          ball.x = hop.endX;
          ball.y = hop.endY;
          const hopDirectionX = hop.endX - hop.startX;
          const hopDirectionY = hop.endY - hop.startY;
          hop = null;
          stunnedThisLanding.clear();
          services.spawnVisualEffect(createShockwaveEffect(ball.x, ball.y));
          spawnFleshBurst(services, ball.x, ball.y, 16, 80);
          services.forEachEnemy((enemy) => {
            const key = creatureKey(enemy);
            if (stunnedThisLanding.has(key)) return;
            if (
              Math.hypot(enemy.x - ball.x, enemy.y - ball.y) >
              SHOCKWAVE_RADIUS + enemy.radius
            ) {
              return;
            }
            stunnedThisLanding.add(key);
            services.applyEffect(enemy, createStunEffect());
          });
          // 落地后顺着这一跳的方向继续走，速度还是 50。
          launch(ball, hopDirectionX, hopDirectionY, SUMMON_SPEED);
          squash = HOP_SQUASH_TIME;
          hopTimer = 0;
          return;
        }
        if (squash > 0) squash = Math.max(0, squash - elapsed);
        hopTimer += elapsed;
        if (hopTimer + EPSILON < HOP_INTERVAL) return;
        hopTimer = 0;
        // 朝敌人跳：跳多远，落地之后就顺着这个方向走多远。
        const target = services.getOpponent();
        const toTargetX = target ? target.x - ball.x : 1;
        const toTargetY = target ? target.y - ball.y : 0;
        const targetDistance = target ? Math.hypot(toTargetX, toTargetY) : HOP_RANGE;
        const distance = Math.max(HOP_MIN_DISTANCE, Math.min(HOP_RANGE, targetDistance));
        const angle = target
          ? Math.atan2(toTargetY, toTargetX)
          : Math.random() * TAU;
        const { x: endX, y: endY } = resolveArenaGeometry(context.game).clampPoint(
          ball.x + Math.cos(angle) * distance, ball.y + Math.sin(angle) * distance, ball.radius);
        const travelled = Math.hypot(endX - ball.x, endY - ball.y);
        hop = {
          elapsed: 0,
          startX: ball.x,
          startY: ball.y,
          endX,
          endY,
          // 速度固定 50：跳多远，空中就待多久。
          airTime: Math.max(0.12, travelled / SUMMON_SPEED),
          height: 0
        };
      },
      render(ball, time, canvas) {
        const jumpHeight = hop ? hop.height : 0;
        const squashAmount = squash > 0 ? squash / HOP_SQUASH_TIME : 0;
        // 起跳被拉长、落地压扁，就是那种一伸一缩的弹性感觉。
        const stretch = jumpHeight > 0.5
          ? 1 + (jumpHeight / HOP_ARC_HEIGHT) * 0.55
          : 1 - squashAmount * 0.35;
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
        drawHopperBody(canvas, ball, time, stretch);
        canvas.restore();
      }
    });
  }

  // 7. 碎裂尖牙：死后在半径 10 内掉 1-2 块牙。
  function createToothySummonBehavior(services) {
    let shattered = false;

    function shatter(context) {
      if (shattered) return;
      shattered = true;
      const ball = context.ball;
      const arenaSize = context.game.arenaSize;
      const drops = FANG_DROP_MIN +
        Math.floor(Math.random() * (FANG_DROP_MAX - FANG_DROP_MIN + 1));
      for (let index = 0; index < drops; index += 1) {
        const angle = Math.random() * TAU;
        const distance = FANG_DROP_RADIUS * Math.sqrt(Math.random());
        const point = resolveArenaGeometry(context.game).clampPoint(
          ball.x + Math.cos(angle) * distance, ball.y + Math.sin(angle) * distance, FANG_RADIUS);
        services.spawnCombatEntity(createFangEntity(
          point.x,
          point.y,
          Math.random() * TAU
        ));
      }
      spawnFleshBurst(services, ball.x, ball.y, 22, 110);
    }

    return createMinionBase(services, {
      update() {},
      render(ball, time, canvas) {
        drawToothyOrb(canvas, ball, time);
      },
      onDeath(context) {
        shatter(context);
      }
    });
  }

  const baiWanRenSummonDefinitions = [
    createSummonDefinition(
      "tentacle",
      "\u767e\u4e07\u4eba\uff1a\u89e6\u624b\uff08\u957f\u5ea6 50\u3001\u63a5\u89e6\u4f24\u5bb3 2\uff09",
      createTentacleSummonBehavior,
      TENTACLE_SPEED
    ),
    createSummonDefinition(
      "maggot",
      "\u767e\u4e07\u4eba\uff1a\u86c6\uff082 \u79d2\u540e\u65e0\u654c\u4f38\u8eab 40\u3001\u4f24\u5bb3 1\uff09",
      createMaggotSummonBehavior,
      MAGGOT_SPEED
    ),
    createSummonDefinition(
      "shooter",
      "\u767e\u4e07\u4eba\uff1a\u8840\u8089\u5f39\uff08\u6bcf\u79d2\u4e00\u53d1\u3001\u5b50\u5f39\u901f\u5ea6 200\u3001\u4f24\u5bb3 1\uff09",
      createShooterSummonBehavior,
      SHOOTER_SPEED
    ),
    createSummonDefinition(
      "splitter",
      "\u767e\u4e07\u4eba\uff1a\u5206\u88c2\uff08\u78b0\u649e\u4f24\u5bb3 1\u3001\u6bcf 5 \u79d2\u4e00\u5206\u4e3a\u4e8c\uff09",
      createSplitSummonBehavior
    ),
    createSummonDefinition(
      "whip",
      "\u767e\u4e07\u4eba\uff1a\u5012\u523a\u957f\u89e6\u624b\uff08\u957f\u5ea6 15\u3001\u6bcf\u79d2\u8f6c 3 \u5708\u3001\u4f24\u5bb3 1\uff09",
      createWhipSummonBehavior,
      WHIP_SPEED
    ),
    createSummonDefinition(
      "hopper",
      "\u767e\u4e07\u4eba\uff1a\u5f39\u8df3\uff08\u51b2\u51fb\u6ce2\u534a\u5f84 20\u3001\u7729\u6655 0.2 \u79d2\uff09",
      createHopperSummonBehavior
    ),
    createSummonDefinition(
      "toothy",
      "\u767e\u4e07\u4eba\uff1a\u788e\u7259\uff08\u6b7b\u540e\u6389 1-2 \u5757\u5c16\u7259\u3001\u63a5\u89e6\u4f24\u5bb3 1\uff09",
      createToothySummonBehavior
    )
  ];

  function createFangEntity(x, y, angle) {
    return {
      kind: "bai-wan-ren-fang",
      combatKind: "trap",
      trap: true,
      // 牙齿不会自己消失：咬到人之前一直躺在场上。
      life: Number.MAX_SAFE_INTEGER,
      radius: FANG_RADIUS,
      x,
      y,
      angle,
      update({ entity, game, services: entityServices }) {
        if (game.state !== "running") {
          entity.life = 0;
          return;
        }
        entityServices.forEachEnemy((enemy) => {
          if (entity.entityActive === false) return;
          if (
            Math.hypot(enemy.x - entity.x, enemy.y - entity.y) >
            FANG_RADIUS + enemy.radius
          ) {
            return;
          }
          if (!entityServices.dealDamage(enemy, FANG_DAMAGE)) return;
          entity.entityActive = false;
          spawnFleshBurst(entityServices, entity.x, entity.y, 8, 55);
        });
      },
      draw({ entity }, canvas) {
        const size = entity.radius;
        canvas.save();
        canvas.translate(entity.x, entity.y);
        canvas.rotate(entity.angle);
        // 一圈渗出来的血
        canvas.globalAlpha *= 0.5;
        canvas.fillStyle = "#3d060a";
        canvas.beginPath();
        canvas.ellipse(0, 0, size * 1.5, size * 0.9, 0, 0, TAU);
        canvas.fill();
        canvas.globalAlpha = 1;
        // 牙碎：细长、边缘是崩口的一小片
        canvas.fillStyle = "#f0e5d4";
        canvas.beginPath();
        canvas.moveTo(-size * 1.15, -size * 0.4);
        canvas.lineTo(-size * 0.35, -size * 0.62);
        canvas.lineTo(size * 0.45, -size * 0.3);
        canvas.lineTo(size * 1.5, -size * 0.02);
        canvas.lineTo(size * 0.35, size * 0.34);
        canvas.lineTo(-size * 0.5, size * 0.5);
        canvas.lineTo(-size * 1.15, size * 0.22);
        canvas.closePath();
        canvas.fill();
        canvas.strokeStyle = "rgba(96, 52, 46, 0.85)";
        canvas.lineWidth = Math.max(0.3, size * 0.16);
        canvas.stroke();
        canvas.fillStyle = "rgba(255, 255, 255, 0.45)";
        canvas.beginPath();
        canvas.moveTo(-size * 0.5, -size * 0.28);
        canvas.lineTo(size * 0.8, -size * 0.06);
        canvas.lineTo(-size * 0.4, size * 0.08);
        canvas.closePath();
        canvas.fill();
        canvas.restore();
      }
    };
  }

  // ---------- 召唤池：死掉的肉回收再用 ----------

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
    ball.spawnedAt = typeof services.getTime === "function"
      ? services.getTime()
      : ball.spawnedAt;
    ball.isSummon = true;
    return ball;
  }

  function placeSummon(services, definition, spawn) {
    const recycled = findRecyclableSummon(services, definition.id);
    if (recycled) return reviveSummon(recycled, definition, services);
    return services.spawnSummon(definition, spawn);
  }

  // 把场地排好的入场名额落成一个真正的小兵：种类在这一拍抽，位置与入场方向都是
  // 场地给的（见 createFleshFieldEntity 与 baiWanRenEdgeEntry）。
  function spawnSummonAtEntry(services, entry) {
    const definition = baiWanRenSummonDefinitions[
      Math.floor(Math.random() * baiWanRenSummonDefinitions.length)
    ];
    const summon = placeSummon(services, definition, { x: entry.x, y: entry.y });
    if (!summon) return null;
    summon.x = entry.x;
    summon.y = entry.y;
    summon.prevX = entry.x;
    summon.prevY = entry.y;
    summon.spawnX = entry.x;
    summon.spawnY = entry.y;
    summon.enteredFromEdge = true;
    // 入场那一刻的方向记在球上：小兵自己的第一帧就可能改速度（比如弹跳），
    // 所以"进场方向朝场内"这件事要留证据可查。速度取自己这一种的档位。
    const entrySpeed = definition.stats.speed;
    summon.entryVx = Math.cos(entry.angle) * entrySpeed;
    summon.entryVy = Math.sin(entry.angle) * entrySpeed;
    launch(summon, Math.cos(entry.angle), Math.sin(entry.angle), entrySpeed);
    return summon;
  }

  // ---------- 血肉场地：一枚铺满战场的 Combat Entity ----------
  //
  // 场地是"场地系"的全部内容：它自己画背景、自己数边线入场的节拍。
  // 本体只是它的心脏 —— 所以本体的眩晕不影响场地，而本体退场（死亡 / Rion 借用结束）
  // 会由 owner-bound 生命周期把场地一起带走。
  //
  // 实体服务里没有 spawnSummon，所以场地不直接造小兵：它把"这一拍该从哪条边、朝哪个
  // 方向进来"排进 pendingEntries，本体的 update / updateWhilePaused 下一拍取走并落成召唤物。场地因此完全
  // 不持有本体的服务引用，出伤也全部走它自己的 entity services（actor = 场地，kind = zone）。

  // 白蛇 DISC 抽走的是"能力"本身：封印期间整块场地停摆，不再吐小兵。
  // 引擎另有 blocksOwnedEntityDamage 会拦掉本体名下实体的出伤，这里连触发一起停，
  // 免得出现"咬了一口却不掉血"的假动作。
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

  function createFleshFieldEntity({ arenaSize }) {
    const skin = createBaiWanRenField();
    return {
      kind: FIELD_ENTITY_KIND,
      combatKind: FIELD_COMBAT_KIND,
      lifecycle: "owner-bound",
      drawLayer: "background",
      // 场地没有寿命：它跟着本体活，本体一退场就被 owner-bound 收掉。
      life: Number.MAX_SAFE_INTEGER,
      // 覆盖整个战场：半径取外接圆的一半，只是把"它占了多大"写清楚。
      radius: arenaSize * Math.SQRT1_2,
      entryClock: 0,
      spawnElapsed: 0,
      pendingEntries: [],
      // 本体来取走这一拍该入场的小兵。
      drainEntries() {
        if (this.pendingEntries.length === 0) return null;
        const entries = this.pendingEntries;
        this.pendingEntries = [];
        return entries;
      },
      update({ effect, game, services }, dt) {
        const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
        const now = Number.isFinite(game.time) ? game.time : 0;
        if (ownerIsSealed(effect.owner, now)) return;
        // 边线入场：场地的节拍。本体动不了（眩晕 / 冻结）时场地照常吐，
        // 本体的普通与暂停更新都会取走队列，上限只作积压保护。
        if (effect.pendingEntries.length < FIELD_ENTRY_QUEUE_LIMIT) {
          effect.spawnElapsed += elapsed;
          effect.entryClock += elapsed;
          let queued = 0;
          while (
            effect.entryClock + EPSILON >= summonIntervalAt(effect.spawnElapsed) &&
            queued < FIELD_ENTRY_BATCH_MAX &&
            effect.pendingEntries.length < FIELD_ENTRY_QUEUE_LIMIT
          ) {
            effect.entryClock -= summonIntervalAt(effect.spawnElapsed);
            effect.pendingEntries.push(baiWanRenEdgeEntry(game.arena || game.arenaSize, SUMMON_RADIUS));
            queued += 1;
          }
        } else {
          effect.entryClock = 0;
        }
      },
      draw({ effect, game }, canvas) {
        const owner = effect.owner;
        // 本体退场 / 被放到替补席上，整块场地一起消失。
        if (!owner || owner.hp <= 0 || owner.active === false || owner.isModeActive === false) return;
        skin.draw({ game, ball: owner }, canvas);
      },
      dispose() {
        skin.dispose();
        this.pendingEntries.length = 0;
      }
    };
  }

  // ---------- 本体：百万人 ----------

  const meatSkins = new WeakMap();

  function skinFor(ball) {
    let skin = meatSkins.get(ball);
    if (!skin) {
      skin = createMeatSkin(Math.random() * 41);
      meatSkins.set(ball, skin);
    }
    return skin;
  }

  const baiWanRenDefinition = {
    id: "baiWanRen",
    name: "\u767e\u4e07\u4eba",
    englishName: "Millions",
    color: BODY_COLOR,
    renderAboveGpuEffects: true,
    rionCycleDuration: 30,
    description: "场地系 / 整块战场就是这团血肉 / 每 0.35 秒从边线内侧钻出一团血肉（场地节拍：本体眩晕照放）/ 七种小兵 / 本体只是一颗心脏",
    stats: {
      radius: BODY_RADIUS,
      speed: BODY_SPEED,
      maxHp: BODY_HP
    },
    createBehavior(services) {
      let dripTimer = 0;
      let feedPulse = 0;
      let fleshField = null;

      // 场地是独立实体，本体只保管引用。第一次 update 才建场：那时 game.arenaSize
      function ensureFleshField(game) {
        if (fleshField && fleshField.entityActive !== false) return fleshField;
        fleshField = services.spawnCombatEntity(
          createFleshFieldEntity({ arenaSize: game.arenaSize })
        );
        return fleshField;
      }

      // 场地退场：本体死亡 / Rion 借用结束 / 换场之前先把旧的收干净。
      function retireFleshField() {
        if (!fleshField) return;
        const field = fleshField;
        fleshField = null;
        field.entityActive = false;
        if (typeof field.dispose === "function") field.dispose();
      }

      function livingSummons() {
        return services.getSummons(BAI_WAN_REN_SUMMON_ID)
          .concat(services.getSummons(SPLIT_CHILD_ID));
      }

      function releaseSummons() {
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

      // 接触到的自己的小兵会被这团肉吞掉：吃一只 +1 血，血上限跟着涨，
      // 所以血量没有 100 的天花板。吞不是杀，不触发小兵的死亡钩子。
      function feedOnOwnMinions(ball) {
        const summons = livingSummons();
        let eaten = 0;
        for (let index = 0; index < summons.length; index += 1) {
          const minion = summons[index];
          if (minion === ball || minion.active === false || minion.hp <= 0) continue;
          const reach = ball.radius + minion.radius + FEED_TOLERANCE;
          if (Math.hypot(minion.x - ball.x, minion.y - ball.y) > reach) continue;
          minion.hp = 0;
          minion.active = false;
          minion.fade = 0;
          minion.deathNotified = true;
          minion.diedAt = null;
          ball.maxHp += FEED_HEAL;
          ball.hp += FEED_HEAL;
          eaten += 1;
          const biteDirection = normalizeDirection(minion.x - ball.x, minion.y - ball.y);
          services.spawnVisualEffect(createBiteStump(
            ball.x + biteDirection.x * ball.radius * 0.95,
            ball.y + biteDirection.y * ball.radius * 0.95,
            Math.max(3, minion.radius),
            Math.atan2(biteDirection.y, biteDirection.x)
          ));
          spawnFleshBurst(services, minion.x, minion.y, 14, 70);
        }
        if (eaten > 0) feedPulse = FEED_PULSE_TIME;
        return eaten;
      }

      function drainFieldEntries(context) {
        if (ownerIsSealed(context.ball, context.game.time)) return;
        const field = ensureFleshField(context.game);
        const entries = field && typeof field.drainEntries === "function"
          ? field.drainEntries()
          : null;
        if (entries) {
          for (const entry of entries) spawnSummonAtEntry(services, entry);
        }
      }

      return {
        // 本体不索敌：不写速度，交给引擎的普通小球规则。
        update(context, dt) {
          const ball = context.ball;
          const elapsed = finiteDelta(dt);
          // 场地排好的入场名额：小兵从边线内侧钻出来，本体负责把它落成战斗单位。
          drainFieldEntries(context);
          // 挨着自己的血肉会被吞掉：吃一只 +1 血（上限一起涨）。
          feedOnOwnMinions(ball);
          if (feedPulse > 0) feedPulse = Math.max(0, feedPulse - elapsed);
          // 本体一直在渗血和组织液。
          dripTimer += elapsed;
          if (dripTimer + EPSILON >= 0.22) {
            dripTimer = 0;
            const angle = Math.random() * TAU;
            services.spawnParticleBurst({
              kind: "bai-wan-ren-drip",
              x: ball.x + Math.cos(angle) * ball.radius * 0.85,
              y: ball.y + Math.sin(angle) * ball.radius * 0.85,
              count: 3,
              minDiameter: 1,
              maxDiameter: 2.6,
              minSpeed: 8,
              maxSpeed: 30,
              initialRadius: 2,
              life: 0.55,
              drag: 3,
              gravityY: 26,
              colors: [MEAT_DARK, MEAT_MID, MEAT_RAW, SINEW]
            });
          }
        },
        updateWhilePaused(context) {
          drainFieldEntries(context);
        },
        // 本体不撞人掉血：伤害全部来自场地与小兵。
        // 背景那层血肉由场地实体自己画（drawLayer: "background"），本体不再挂
        // drawArenaBackground。
        onDeath() {
          releaseSummons();
          retireFleshField();
        },
        onBorrowEnd() {
          releaseSummons();
          retireFleshField();
        },
        drawBody(context, canvasContext) {
          const ball = context.ball;
          // 刚吞下一只的时候整团肉会鼓一下。
          const swallow = feedPulse > 0 ? feedPulse / FEED_PULSE_TIME : 0;
          drawMeatBody(canvasContext, {
            x: ball.x,
            y: ball.y,
            radius: ball.radius * (1 + swallow * 0.14),
            time: context.game.time,
            skin: skinFor(ball)
          });
          return true;
        }
      };
    }
  };

  registerBall(baiWanRenDefinition);

  return {
    baiWanRenDefinition,
    baiWanRenSummonDefinitions,
    createFleshFieldEntity,
    BAI_WAN_REN_SUMMON_ID,
    FIELD_ENTITY_KIND,
    FIELD_COMBAT_KIND,
    baiWanRenSummonInterval: summonIntervalAt
  };
});
