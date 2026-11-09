(function initializeCactus(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCactusPlugin({ registerBall, resolveArenaGeometry }) {
  // 参考图配色：本体是橄榄绿球体 + 顶边一朵粉色五瓣花，球面点缀浅色刺纹；
  // 召唤出来的仙人掌是亮黄绿的像素株（有效直径 20~30，即碰撞圆半径 10~15）。
  const BALL_FILL = "#71a146";
  const BALL_RIM = "#4f6d29";
  const SPINE_COLOR = "#d2fabe";
  const FLOWER_PETAL = "#fda7b2";
  const FLOWER_PETAL_LIGHT = "#ffc9d0";
  const FLOWER_PETAL_EDGE = "#ef8b9a";
  const FLOWER_CORE = "#fee9cd";

  const PLANT_BODY = "#9fd823";
  const PLANT_LIGHT = "#c9f24d";
  const PLANT_SHADE = "#77b70f";
  const PLANT_EDGE = "#2f5e12";
  // 枯萎期的干黄配色：只在淡出前几帧用得到。
  const DRY_BODY = "#8d8a3c";
  const DRY_LIGHT = "#b0a75c";
  const DRY_SHADE = "#6d6627";
  const DRY_EDGE = "#45401a";

  const SEED_BODY = "#7fd02f";
  const SEED_LIGHT = "#c9f24d";
  const SEED_EDGE = "#2f5e12";

  // 血色粒子：命中时从接触点溅出，带一点重力让血滴下落。
  const BLOOD_COLORS = ["#8f1414", "#c2202c", "#ff4d5e", "#5e0b0b"];

  const FIRST_SUMMON_DELAY = 3;
  const FIRST_ROUND_COUNT = 6;
  const LATER_ROUND_COUNT = 7;
  const PLANT_LIFE = 5;
  const ROUND_COOLDOWN = 3;
  const PLANT_DAMAGE = 3;
  const MIN_DIAMETER = 20;
  const MAX_DIAMETER = 30;
  const PLANT_EDGE_PADDING = 1;
  const POSITION_CANDIDATES = 6;

  // 召唤动画：本体先甩出一把种子（0.6 秒抛物线落地），种子落地处才抽出仙人掌。
  const SEED_FLIGHT = 0.6;
  const SEED_LAUNCH_WINDOW = 0.24;
  const SEED_SIZE = 2.6;
  const THROW_PULSE = 0.35;
  // 仙人掌的出生与死亡动画：抽出 0.25 秒，枯萎 0.45 秒（枯萎期不再出伤、不再挡人）。
  const SPROUT_DURATION = 0.25;
  const WITHER_DURATION = 0.45;

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  // 像素株的格子：宽 18、高 26，根部落在 y = 11。
  const PLANT_BASE_Y = 11;

  // 参考图测量：球面浅色刺纹落在这些半径比例 / 角度上（角度以向右为 0，屏幕坐标顺时针为正）。
  const SPINE_MARKS = Object.freeze([
    [0.36, 88], [0.70, -54], [0.59, -12], [0.58, -169], [0.74, 78],
    [0.78, 105], [0.57, 144], [0.63, -91], [0.69, -130]
  ]);

  const CACTUS_RULES = Object.freeze({
    firstSummonDelay: FIRST_SUMMON_DELAY,
    firstRoundCount: FIRST_ROUND_COUNT,
    laterRoundCount: LATER_ROUND_COUNT,
    plantLife: PLANT_LIFE,
    roundCooldown: ROUND_COOLDOWN,
    plantDamage: PLANT_DAMAGE,
    minDiameter: MIN_DIAMETER,
    maxDiameter: MAX_DIAMETER,
    seedFlight: SEED_FLIGHT,
    sproutDuration: SPROUT_DURATION,
    witherDuration: WITHER_DURATION
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function mixHex(from, to, amount) {
    const progress = clamp(amount, 0, 1);
    const first = parseInt(from.slice(1), 16);
    const second = parseInt(to.slice(1), 16);
    const channel = (shift) => {
      const a = (first >> shift) & 255;
      const b = (second >> shift) & 255;
      return Math.round(a + (b - a) * progress);
    };
    return `#${[16, 8, 0].map((shift) => (
      channel(shift).toString(16).padStart(2, "0")
    )).join("")}`;
  }

  function roundRectPath(canvas, x, y, width, height, cornerRadius) {
    const corner = Math.max(0, Math.min(cornerRadius, width / 2, height / 2));
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

  function drawCactusFlower(canvas, x, y, size) {
    const petalRadius = size * 0.52;
    const orbit = size * 0.48;
    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI / 2 + index * TWO_PI / 5;
      const petalX = x + Math.cos(angle) * orbit;
      const petalY = y + Math.sin(angle) * orbit;
      canvas.fillStyle = FLOWER_PETAL;
      canvas.lineWidth = Math.max(0.4, size * 0.06);
      canvas.strokeStyle = FLOWER_PETAL_EDGE;
      canvas.beginPath();
      canvas.arc(petalX, petalY, petalRadius, 0, TWO_PI);
      canvas.fill();
      canvas.stroke();
      canvas.fillStyle = FLOWER_PETAL_LIGHT;
      canvas.beginPath();
      canvas.arc(
        petalX - petalRadius * 0.16,
        petalY - petalRadius * 0.2,
        petalRadius * 0.6,
        0,
        TWO_PI
      );
      canvas.fill();
    }
    canvas.fillStyle = FLOWER_CORE;
    canvas.beginPath();
    canvas.arc(x, y, size * 0.26, 0, TWO_PI);
    canvas.fill();
  }

  // 本体外观：只画参考图里的花纹，血量数字与受击闪白仍由渲染器负责。
  // throwPulse > 0 时是抛种起手的一下挤压回弹。
  // 共享的球体本体：橄榄绿球 + 深色圈 + 浅色刺纹（V2 沿用同一套，只换花）。
  function drawCactusBodyShape(canvas, radius) {
    canvas.fillStyle = BALL_FILL;
    canvas.beginPath();
    canvas.arc(0, 0, radius, 0, TWO_PI);
    canvas.fill();
    const rimWidth = Math.max(1, radius * 0.09);
    canvas.lineWidth = rimWidth;
    canvas.strokeStyle = BALL_RIM;
    canvas.beginPath();
    canvas.arc(0, 0, radius - rimWidth / 2, 0, TWO_PI);
    canvas.stroke();

    canvas.strokeStyle = SPINE_COLOR;
    canvas.lineWidth = Math.max(0.8, radius * 0.075);
    canvas.lineCap = "round";
    canvas.lineJoin = "round";
    for (const mark of SPINE_MARKS) {
      const angle = mark[1] * Math.PI / 180;
      const centerX = Math.cos(angle) * radius * mark[0];
      const centerY = Math.sin(angle) * radius * mark[0];
      const half = radius * 0.12;
      const drop = radius * 0.08;
      canvas.beginPath();
      canvas.moveTo(centerX - half, centerY - drop);
      canvas.lineTo(centerX, centerY + drop);
      canvas.lineTo(centerX + half, centerY - drop);
      canvas.stroke();
    }
  }

  function drawCactusBall(context, canvas, throwPulse = 0) {
    const ball = context.ball;
    const radius = ball.radius;
    canvas.save();
    canvas.translate(ball.x, ball.y);
    // 抛种起手的一下挤压回弹。
    if (throwPulse > 0) {
      const elapsed = 1 - clamp(throwPulse / THROW_PULSE, 0, 1);
      const squash = Math.sin(elapsed * Math.PI);
      canvas.scale(1 + 0.08 * squash, 1 - 0.07 * squash);
    }
    drawCactusBodyShape(canvas, radius);
    // 花心落在球体上边缘，花瓣有一半探出本体，和参考图一致。
    drawCactusFlower(canvas, 0, -radius * 0.95, radius * 0.42);
    canvas.restore();
    return true;
  }

  // 召唤物：竖长像素仙人掌。格子 18x26，高 26 格正好等于有效直径；
  // 抽芽从根部顶出来，枯萎时缩回、歪倒、褪成干黄再淡出。
  // plant: { x, y, radius, age, witherAt?, wither?, sway? }
  // witherAt 是开始枯萎的年龄（V1 为 5 秒；V2 的植株常驻，只有被移除或被打碎时才传显式 wither）。
  function drawCactusPlant(canvas, plant) {
    const age = Math.max(0, Number.isFinite(plant.age) ? plant.age : 0);
    const witherAt = Number.isFinite(plant.witherAt) ? plant.witherAt : PLANT_LIFE;
    const witherDuration = Number.isFinite(plant.witherDuration)
      ? plant.witherDuration
      : WITHER_DURATION;
    const sprout = clamp(age / SPROUT_DURATION, 0, 1);
    const wither = Number.isFinite(plant.wither)
      ? clamp(plant.wither, 0, 1)
      : clamp((age - witherAt) / witherDuration, 0, 1);
    // 扭动：感应到本体落地后左右摇摆的角度（-1 ~ 1）。
    const sway = Number.isFinite(plant.sway) ? clamp(plant.sway, -1, 1) : 0;
    const sproutScale = 0.3 + 0.7 * (1 - Math.pow(1 - sprout, 3));
    const scale = sproutScale * (1 - 0.5 * wither);
    const bodyColor = mixHex(PLANT_BODY, DRY_BODY, wither);
    const lightColor = mixHex(PLANT_LIGHT, DRY_LIGHT, wither);
    const shadeColor = mixHex(PLANT_SHADE, DRY_SHADE, wither);
    const edgeColor = mixHex(PLANT_EDGE, DRY_EDGE, wither);

    const unit = plant.radius / 13;
    const column = { x: -3.4, y: -12.4, width: 6.8, height: 23.4, corner: 3 };
    const leftArm = { x: -8.4, y: -3.6, width: 4.2, height: 8.4, corner: 2 };
    const leftElbow = { x: -5.6, y: 0.8, width: 4.6, height: 4, corner: 1.4 };
    const rightArm = { x: 4.2, y: -5.6, width: 4.2, height: 8.6, corner: 2 };
    const rightElbow = { x: 1.8, y: -0.8, width: 4.6, height: 4, corner: 1.4 };
    const base = { x: -5.2, y: 10.2, width: 10.4, height: 2.6, corner: 1.2 };
    const parts = [base, leftElbow, leftArm, rightElbow, rightArm, column];

    canvas.save();
    // 以根部为支点缩放/倾斜，抽芽和倒伏才像从土里长出来的。
    canvas.translate(plant.x, plant.y + plant.radius * (PLANT_BASE_Y / 13));
    canvas.scale(unit * scale, unit * scale);
    // 枯萎倒伏 + 感应扭动
    canvas.rotate(wither * 0.24 + sway * 0.26);
    canvas.translate(Math.sin(sway * Math.PI) * 1.2 * Math.abs(sway), -PLANT_BASE_Y);
    canvas.globalAlpha *= 1 - Math.pow(wither, 1.4);
    canvas.lineJoin = "round";

    canvas.fillStyle = edgeColor;
    for (const part of parts) {
      roundRectPath(
        canvas,
        part.x - 0.7,
        part.y - 0.7,
        part.width + 1.4,
        part.height + 1.4,
        part.corner + 0.5
      );
      canvas.fill();
    }
    canvas.fillStyle = bodyColor;
    for (const part of parts) {
      roundRectPath(canvas, part.x, part.y, part.width, part.height, part.corner);
      canvas.fill();
    }
    // 受光面：中间一条浅色高光，右侧压暗。
    canvas.fillStyle = lightColor;
    canvas.fillRect(-1.8, -9.6, 2.4, 17.4);
    canvas.fillRect(-7.6, -2.2, 1.8, 5.6);
    canvas.fillRect(4.6, -4.2, 1.6, 5.4);
    canvas.fillStyle = shadeColor;
    canvas.fillRect(1.4, -8.6, 2, 17.6);
    canvas.fillRect(7.2, -1.6, 1.4, 5.2);
    canvas.fillRect(-7.8, 2.6, 1.6, 4.4);
    canvas.fillStyle = shadeColor;
    canvas.fillRect(-5.2, 11.4, 3.6, 1.4);
    canvas.restore();
  }

  // 种子外观（V2 的单颗抛种也用它，保证同源）。
  function drawCactusSeed(canvas, x, y, rotation) {
    canvas.save();
    canvas.translate(x, y);
    canvas.rotate(rotation);
    canvas.fillStyle = SEED_BODY;
    canvas.strokeStyle = SEED_EDGE;
    canvas.lineWidth = 0.45;
    canvas.beginPath();
    canvas.ellipse(0, 0, SEED_SIZE, SEED_SIZE * 0.62, 0, 0, TWO_PI);
    canvas.fill();
    canvas.stroke();
    canvas.fillStyle = SEED_LIGHT;
    canvas.beginPath();
    canvas.ellipse(
      -SEED_SIZE * 0.22,
      -SEED_SIZE * 0.16,
      SEED_SIZE * 0.42,
      SEED_SIZE * 0.26,
      0,
      0,
      TWO_PI
    );
    canvas.fill();
    canvas.restore();
  }

  // 抛种动画：每颗种子沿抛物线从本体飞到自己的落点，先后离手、同时落地（落地那一帧植株才出现）。
  function createSeedVolleyEffect({ from, ballRadius, targets }) {
    const seeds = targets.map((target, index) => {
      const landingY = target.y + target.radius * (PLANT_BASE_Y / 13);
      const deltaX = target.x - from.x;
      const deltaY = landingY - from.y;
      const span = Math.hypot(deltaX, deltaY) || 1;
      const launch = Math.max(0, ballRadius * 0.7);
      const startX = from.x + deltaX / span * launch;
      const startY = from.y + deltaY / span * launch;
      const delay = targets.length <= 1
        ? 0
        : index / targets.length * SEED_LAUNCH_WINDOW;
      return {
        delay,
        startX,
        startY,
        controlX: (startX + target.x) / 2,
        controlY: (startY + landingY) / 2 - (span * 0.28 + 10),
        endX: target.x,
        endY: landingY,
        spin: Math.random() * TWO_PI
      };
    });

    return {
      kind: "cactus-seed-volley",
      life: SEED_FLIGHT,
      // 种子和仙人掌都画在球下面：本体的血量数字永远不被召唤物挡住。
      drawLayer: "background",
      seeds,
      draw({ effect }, canvas) {
        const elapsed = Math.max(0, effect.age);
        for (const seed of seeds) {
          const duration = SEED_FLIGHT - seed.delay;
          const progress = (elapsed - seed.delay) / duration;
          if (progress < 0 || progress > 1) continue;
          const inverse = 1 - progress;
          const x = inverse * inverse * seed.startX +
            2 * inverse * progress * seed.controlX +
            progress * progress * seed.endX;
          const y = inverse * inverse * seed.startY +
            2 * inverse * progress * seed.controlY +
            progress * progress * seed.endY;
          drawCactusSeed(canvas, x, y, seed.spin + progress * 9);
        }
      }
    };
  }

  // 血色粒子：命中点溅血。V1 的碰撞出伤与 V2 的仙人掌刺沿用同一套特效。
  function spawnCactusBloodBurst(spawnServices, { x, y, angle }) {
    spawnServices.spawnParticleBurst({
      kind: "cactus-blood",
      x,
      y,
      colors: BLOOD_COLORS,
      count: 9,
      minDiameter: 1.2,
      maxDiameter: 3.4,
      minSpeed: 22,
      maxSpeed: 76,
      directionAngle: angle,
      directionSpread: Math.PI * 0.9,
      initialRadius: 1.5,
      life: 0.42,
      drag: 2.2,
      gravityY: 90
    });
  }

  function createCactusPlantDefinition({ x, y, radius }) {
    return {
      kind: "cactus-plant",
      combatKind: "trap",
      // 有效寿命仍是 5 秒：多出来的 0.45 秒只是枯萎动画，期间不出伤也不挡人。
      life: PLANT_LIFE + WITHER_DURATION,
      // 独立生命周期：本体死亡不会让已经长出来的仙人掌提前消失。
      lifecycle: "independent",
      // 画在球下面，本体的血量显示不会被植株遮住。
      drawLayer: "background",
      x,
      y,
      radius,
      touching: new Set(),
      update({ entity, services: plantServices, game }) {
        // 枯萎的仙人掌已经不算实体障碍了。
        if (entity.age >= PLANT_LIFE) return;
        const touching = new Set();
        plantServices.forEachContactEnemy((target) => {
          const deltaX = target.x - entity.x;
          const deltaY = target.y - entity.y;
          const distance = Math.hypot(deltaX, deltaY);
          const minDistance = entity.radius + target.radius;
          if (distance >= minDistance) return;
          const normalX = distance > EPSILON ? deltaX / distance : 1;
          const normalY = distance > EPSILON ? deltaY / distance : 0;
          // 仙人掌是扎在地上的实体：撞上它的球被顶到接触面上并反弹，
          // 修正全部落在来撞的球身上（仙人掌不动）。移动锁定的球只挨打不位移。
          if (plantServices.getContactProfile(target).solid &&
            !plantServices.isMovementLocked(target)) {
            Object.assign(target, resolveArenaGeometry(game).clampPoint(
              entity.x + normalX * minDistance, entity.y + normalY * minDistance, target.radius));
            const velocityDot = target.vx * normalX + target.vy * normalY;
            if (velocityDot < 0) {
              target.vx -= 2 * velocityDot * normalX;
              target.vy -= 2 * velocityDot * normalY;
            }
            const storedDot = target.storedVx * normalX + target.storedVy * normalY;
            if (storedDot < 0) {
              target.storedVx -= 2 * storedDot * normalX;
              target.storedVy -= 2 * storedDot * normalY;
            }
          }
          touching.add(target.instanceId);
          // 一次碰撞只结算一次；分开后再撞上才算新的一次碰撞。
          if (entity.touching.has(target.instanceId)) return;
          const angle = Math.atan2(normalY, normalX);
          if (plantServices.dealDamage(target, PLANT_DAMAGE)) {
            const surface = Math.max(0, Math.min(entity.radius, distance - target.radius));
            spawnCactusBloodBurst(plantServices, {
              x: entity.x + Math.cos(angle) * surface,
              y: entity.y + Math.sin(angle) * surface,
              angle
            });
          }
        });
        entity.touching = touching;
      },
      draw({ entity }, canvas) {
        drawCactusPlant(canvas, entity);
      }
    };
  }

  function randomPlantRadius() {
    return (MIN_DIAMETER + Math.random() * (MAX_DIAMETER - MIN_DIAMETER)) / 2;
  }

  function randomPlantPoint(arenaSize, radius) {
    return resolveArenaGeometry(arenaSize).samplePoint(Math.random, radius + PLANT_EDGE_PADDING);
  }

  // 位置是随机的，但一轮里的几株尽量分开：每个位置抽几个候选，取离已有植株最远的那个。
  function planPlantPoints(arenaSize, radii) {
    const placed = [];
    for (const radius of radii) {
      let best = null;
      for (let attempt = 0; attempt < POSITION_CANDIDATES; attempt += 1) {
        const point = randomPlantPoint(arenaSize, radius);
        let spread = Infinity;
        for (const other of placed) {
          spread = Math.min(spread, Math.hypot(other.x - point.x, other.y - point.y));
        }
        if (!best || spread > best.spread) best = { x: point.x, y: point.y, spread };
      }
      placed.push({ x: best.x, y: best.y });
    }
    return placed;
  }

  const cactusDefinition = {
    id: "cactus",
    name: "仙人掌",
    englishName: "Cactus",
    color: BALL_FILL,
    description: "开场3秒吐出6颗种子，0.6秒落地长出仙人掌：直径20-30、碰到-3；5秒后枯萎并进入3秒冷却，之后每轮7株",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    // 一轮完整循环是 3 秒等待 + 0.6 秒抛种 + 5 秒存在，借用的角色至少要看完整轮。
    rionCycleDuration: FIRST_SUMMON_DELAY + SEED_FLIGHT + PLANT_LIFE,
    createBehavior(services) {
      // Only the body schedule uses this clock; seeds and plants keep world lifetimes.
      const attackNow = (game) => typeof services.getAttackTime === "function"
        ? services.getAttackTime() : game.time;
      let phase = "waiting";
      let nextAt = FIRST_SUMMON_DELAY;
      let round = 0;
      let throwPulse = 0;
      let volley = null;
      const plants = [];

      function prunePlants() {
        for (let index = plants.length - 1; index >= 0; index -= 1) {
          if (plants[index].entityActive === false) plants.splice(index, 1);
        }
      }

      // 抛种：先把这一轮的落点和半径定下来，再把种子甩出去。
      function startVolley(ball, game) {
        const count = round === 0 ? FIRST_ROUND_COUNT : LATER_ROUND_COUNT;
        const radii = [];
        for (let index = 0; index < count; index += 1) radii.push(randomPlantRadius());
        const points = planPlantPoints(game.arena || game.arenaSize, radii);
        volley = { points, radii };
        round += 1;
        throwPulse = THROW_PULSE;
        services.spawnVisualEffect(createSeedVolleyEffect({
          from: { x: ball.x, y: ball.y },
          ballRadius: ball.radius,
          targets: points.map((point, index) => ({
            x: point.x,
            y: point.y,
            radius: radii[index]
          }))
        }), { lifecycle: "owner-bound" });
      }

      // 种子落地：落点处抽出仙人掌。
      function plantVolley() {
        if (!volley) return;
        for (let index = 0; index < volley.points.length; index += 1) {
          const plant = services.spawnCombatEntity(createCactusPlantDefinition({
            x: volley.points[index].x,
            y: volley.points[index].y,
            radius: volley.radii[index]
          }));
          if (plant) plants.push(plant);
        }
        volley = null;
      }

      return {
        onSpawn({ game }) {
          phase = "waiting";
          round = 0;
          throwPulse = 0;
          volley = null;
          plants.length = 0;
          nextAt = attackNow(game) + FIRST_SUMMON_DELAY;
        },
        update({ ball, game }, dt) {
          throwPulse = Math.max(0, throwPulse - Math.max(0, dt));
          const now = attackNow(game);
          while (Number.isFinite(nextAt) && now + EPSILON >= nextAt) {
            if (phase === "seeding") {
              plantVolley();
              phase = "growing";
              nextAt = now + PLANT_LIFE;
            } else if (phase === "growing") {
              phase = "cooldown";
              nextAt = now + ROUND_COOLDOWN;
            } else {
              startVolley(ball, game);
              phase = "seeding";
              nextAt = now + SEED_FLIGHT;
            }
          }
        },
        getNextTransitionIn({ game }) {
          const remaining = nextAt - attackNow(game);
          return remaining > EPSILON ? remaining : undefined;
        },
        drawBody(context, canvas) {
          return drawCactusBall(context, canvas, throwPulse);
        },
        getCactusState() {
          prunePlants();
          return {
            phase,
            round,
            nextAt,
            seeding: volley !== null,
            throwPulse,
            plants: plants.map((plant) => ({
              instanceId: plant.instanceId,
              x: plant.x,
              y: plant.y,
              radius: plant.radius,
              age: plant.age,
              active: plant.entityActive !== false
            }))
          };
        }
      };
    }
  };

  registerBall(cactusDefinition);
  return {
    cactusDefinition,
    createCactusPlantDefinition,
    createSeedVolleyEffect,
    planPlantPoints,
    CACTUS_RULES,
    // V2 复用的共享外观与出伤特效。
    drawCactusBodyShape,
    drawCactusPlant,
    drawCactusSeed,
    spawnCactusBloodBurst
  };
});
