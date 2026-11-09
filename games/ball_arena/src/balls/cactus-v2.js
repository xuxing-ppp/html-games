(function initializeCactusV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
        ...require("../core/contact-model.js"),
        ...require("./cactus.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCactusV2Plugin({
  registerBall, resolveArenaGeometry,
  firstSegmentCircleContact,
  drawCactusBodyShape,
  drawCactusPlant,
  drawCactusSeed,
  spawnCactusBloodBurst
}) {
  // 抛种速率：开场 0.25 个/s，线性加速 0.1 个/s（每秒），上限 3 个/s。
  const SEED_START_RATE = 0.25;
  const SEED_ACCELERATION = 0.1;
  const SEED_MAX_RATE = 3;
  const RAMP_SECONDS = (SEED_MAX_RATE - SEED_START_RATE) / SEED_ACCELERATION;
  const RAMP_SEEDS = SEED_START_RATE * RAMP_SECONDS +
    0.5 * SEED_ACCELERATION * RAMP_SECONDS * RAMP_SECONDS;
  const SEED_FLIGHT = 0.6;
  const SEED_TRAIL_SIZE = 2.2;
  const THROW_PULSE = 0.35;
  const CATCHUP_WINDOW = 0.25;

  // 跳：每 4.8 秒起跳，0.5 秒落地，最高 125，腾空全程无敌。
  const JUMP_INTERVAL = 4.8;
  const JUMP_DURATION = 0.5;
  const JUMP_HEIGHT = 125;

  // 第三方仙人掌：2 点碰撞伤害、2 血、扎根不动；被移除或打碎才退场。
  const PLANT_ID = "cactus-v2-plant";
  const PLANT_DAMAGE = 2;
  const PLANT_HP = 2;
  const PLANT_RADIUS = 12;
  const PLANT_BASE_Y = 11;
  const MAX_PLANTS = 16;
  const RETIRE_DURATION = 0.45;

  // 落地感应：全部仙人掌扭动身体，然后各自朝随机方向射出 5 根穿透尖刺。
  const SENSE_DURATION = 0.42;
  const SENSE_FIRE_MIN = 0.14;
  const SENSE_FIRE_MAX = 0.38;
  const SPINE_COUNT = 5;
  const SPINE_SPEED = 300;
  const SPINE_DAMAGE = 2;
  const SPINE_RADIUS = 2.4;
  const SPINE_LIFE = 1.2;

  // 更艳丽的花：高饱和玫红外层 6 瓣 + 浅粉内层 5 瓣 + 金色花心 + 柔光。
  const FLOWER_OUTER = "#ff4d7e";
  const FLOWER_OUTER_EDGE = "#c9164f";
  const FLOWER_INNER = "#ff9dbb";
  const FLOWER_INNER_LIGHT = "#ffd0de";
  const FLOWER_CORE = "#ffe066";
  const FLOWER_CORE_EDGE = "#f2a71b";
  const FLOWER_GLOW = "rgba(255, 77, 126, 0.3)";
  const FLOWER_SCALE = 0.52;

  const DUST_COLORS = ["#8a7a4a", "#b6a06a", "#6f8f3a", "#c8bb86"];
  const SPINE_COLORS = ["#9fd823", "#c9f24d", "#5fae2a", "#eaffc8"];
  const SHATTER_COLORS = ["#9fd823", "#5fae2a", "#c9f24d", "#3f7a24"];
  const SENSE_RING_COLOR = "#bff06a";

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  const CACTUS_V2_RULES = Object.freeze({
    seedStartRate: SEED_START_RATE,
    seedAcceleration: SEED_ACCELERATION,
    seedMaxRate: SEED_MAX_RATE,
    seedFlight: SEED_FLIGHT,
    jumpInterval: JUMP_INTERVAL,
    jumpDuration: JUMP_DURATION,
    jumpHeight: JUMP_HEIGHT,
    plantDamage: PLANT_DAMAGE,
    plantHp: PLANT_HP,
    plantRadius: PLANT_RADIUS,
    maxPlants: MAX_PLANTS,
    spineCount: SPINE_COUNT,
    spineSpeed: SPINE_SPEED,
    spineDamage: SPINE_DAMAGE,
    spineLife: SPINE_LIFE
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 累计抛出量 N(t) = 0.25t + 0.05t²（到 3 个/s 之后转为线性）；这里求第 index+1 颗种子的时刻。
  function seedTimeFor(index) {
    const target = index + 1;
    if (target <= RAMP_SEEDS) {
      return (
        -SEED_START_RATE +
        Math.sqrt(SEED_START_RATE * SEED_START_RATE + 2 * SEED_ACCELERATION * target)
      ) / SEED_ACCELERATION;
    }
    return RAMP_SECONDS + (target - RAMP_SEEDS) / SEED_MAX_RATE;
  }

  function seedRateAt(elapsed) {
    return Math.min(
      SEED_MAX_RATE,
      SEED_START_RATE + SEED_ACCELERATION * Math.max(0, elapsed)
    );
  }

  function jumpHeightAt(progress) {
    if (!(progress > 0 && progress < 1)) return 0;
    return JUMP_HEIGHT * 4 * progress * (1 - progress);
  }

  function drawCactusV2Flower(canvas, x, y, size) {
    canvas.save();
    canvas.globalAlpha *= 0.55;
    canvas.fillStyle = FLOWER_GLOW;
    canvas.beginPath();
    canvas.arc(x, y, size * 0.95, 0, TWO_PI);
    canvas.fill();
    canvas.restore();

    // 外层：六片高饱和玫红花瓣。
    canvas.strokeStyle = FLOWER_OUTER_EDGE;
    canvas.lineWidth = Math.max(0.5, size * 0.07);
    for (let index = 0; index < 6; index += 1) {
      const angle = -Math.PI / 2 + index * TWO_PI / 6;
      canvas.fillStyle = FLOWER_OUTER;
      canvas.beginPath();
      canvas.arc(
        x + Math.cos(angle) * size * 0.5,
        y + Math.sin(angle) * size * 0.5,
        size * 0.42,
        0,
        TWO_PI
      );
      canvas.fill();
      canvas.stroke();
    }
    // 内层：错开角度的浅粉花瓣，做出重瓣的层次。
    canvas.fillStyle = FLOWER_INNER;
    for (let index = 0; index < 5; index += 1) {
      const angle = -Math.PI / 2 + Math.PI / 5 + index * TWO_PI / 5;
      canvas.beginPath();
      canvas.arc(
        x + Math.cos(angle) * size * 0.28,
        y + Math.sin(angle) * size * 0.28,
        size * 0.27,
        0,
        TWO_PI
      );
      canvas.fill();
    }
    canvas.fillStyle = FLOWER_INNER_LIGHT;
    canvas.beginPath();
    canvas.arc(x - size * 0.16, y - size * 0.2, size * 0.28, 0, TWO_PI);
    canvas.fill();

    canvas.fillStyle = FLOWER_CORE;
    canvas.strokeStyle = FLOWER_CORE_EDGE;
    canvas.lineWidth = Math.max(0.4, size * 0.06);
    canvas.beginPath();
    canvas.arc(x, y, size * 0.24, 0, TWO_PI);
    canvas.fill();
    canvas.stroke();
  }

  function drawCactusV2Body(context, canvas, throwPulse = 0) {
    const ball = context.ball;
    const radius = ball.radius;
    canvas.save();
    canvas.translate(ball.x, ball.y);
    if (throwPulse > 0) {
      const elapsed = 1 - clamp(throwPulse / THROW_PULSE, 0, 1);
      const squash = Math.sin(elapsed * Math.PI);
      canvas.scale(1 + 0.08 * squash, 1 - 0.07 * squash);
    }
    drawCactusBodyShape(canvas, radius);
    drawCactusV2Flower(canvas, 0, -radius * 0.95, radius * FLOWER_SCALE);
    canvas.restore();
    return true;
  }

  // 起跳/落地的尘土：向上抛的碎屑，落地那一下额外带一圈扩散环。
  function spawnHopBurst(spawnServices, x, y, { count, speed, ring }) {
    spawnServices.spawnParticleBurst({
      kind: "cactus-v2-hop-dust",
      x,
      y: y + 6,
      colors: DUST_COLORS,
      count,
      minDiameter: 1.2,
      maxDiameter: 3.6,
      minSpeed: speed * 0.5,
      maxSpeed: speed,
      directionAngle: -Math.PI / 2,
      directionSpread: Math.PI * 1.25,
      initialRadius: 3,
      life: 0.44,
      drag: 2.6,
      gravityY: 70,
      ring: ring
        ? { color: "#d8cfa0", lineWidth: 1.5, startRadius: 6, endRadius: 34 }
        : null
    });
  }

  // 落地信号：一圈向外扩散的绿光，示意“所有仙人掌都感应到了”。
  function createSenseRingEffect(x, y) {
    return {
      kind: "cactus-v2-sense-ring",
      life: 0.55,
      x,
      y,
      draw({ effect }, canvas) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        canvas.save();
        canvas.strokeStyle = SENSE_RING_COLOR;
        canvas.globalAlpha *= (1 - progress) * 0.85;
        canvas.lineWidth = 2.6 - progress * 1.8;
        canvas.beginPath();
        canvas.arc(x, y, 10 + progress * 96, 0, TWO_PI);
        canvas.stroke();
        canvas.globalAlpha *= 0.6;
        canvas.lineWidth = 1.2;
        canvas.beginPath();
        canvas.arc(x, y, Math.max(0, 10 + (progress - 0.2) * 96), 0, TWO_PI);
        canvas.stroke();
        canvas.restore();
      }
    };
  }

  // 单颗抛种：抛物线 + 绿色尾迹，落地那一帧才种下仙人掌。
  function createSingleSeedEffect({ from, ballRadius, target, radius }) {
    const landingY = target.y + radius * (PLANT_BASE_Y / 13);
    const deltaX = target.x - from.x;
    const deltaY = landingY - from.y;
    const span = Math.hypot(deltaX, deltaY) || 1;
    const launch = Math.max(0, ballRadius * 0.7);
    const startX = from.x + deltaX / span * launch;
    const startY = from.y + deltaY / span * launch;
    const controlX = (startX + target.x) / 2;
    const controlY = (startY + landingY) / 2 - (span * 0.3 + 12);
    const spin = Math.random() * TWO_PI;
    const pointAt = (progress) => {
      const inverse = 1 - progress;
      return {
        x: inverse * inverse * startX + 2 * inverse * progress * controlX +
          progress * progress * target.x,
        y: inverse * inverse * startY + 2 * inverse * progress * controlY +
          progress * progress * landingY
      };
    };
    return {
      kind: "cactus-v2-seed",
      life: SEED_FLIGHT,
      drawLayer: "background",
      draw({ effect }, canvas) {
        const progress = clamp(effect.age / SEED_FLIGHT, 0, 1);
        canvas.save();
        canvas.fillStyle = "#8ede4a";
        for (let index = 4; index >= 1; index -= 1) {
          const point = pointAt(clamp(progress - index * 0.05, 0, 1));
          canvas.globalAlpha *= 1;
          canvas.save();
          canvas.globalAlpha = canvas.globalAlpha * (0.1 * (5 - index));
          canvas.beginPath();
          canvas.arc(point.x, point.y, SEED_TRAIL_SIZE * (0.85 - index * 0.13), 0, TWO_PI);
          canvas.fill();
          canvas.restore();
        }
        canvas.restore();
        const head = pointAt(progress);
        drawCactusSeed(canvas, head.x, head.y, spin + progress * 10);
      }
    };
  }

  // 穿透仙人掌刺：不因命中而消失，同一目标只结算一次，撞墙才碎。
  function createSpineDefinition({ x, y, angle }) {
    return {
      kind: "cactus-v2-spine",
      life: SPINE_LIFE,
      radius: SPINE_RADIUS,
      x,
      y,
      vx: Math.cos(angle) * SPINE_SPEED,
      vy: Math.sin(angle) * SPINE_SPEED,
      hits: new Set(),
      update({ entity, services: spineServices, game }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        const step = Math.max(0, dt);
        entity.x += entity.vx * step;
        entity.y += entity.vy * step;
        const direction = Math.atan2(entity.vy, entity.vx);
        spineServices.forEachContactEnemy((target) => {
          if (entity.hits.has(target.instanceId)) return;
          const contact = firstSegmentCircleContact(
            startX,
            startY,
            entity.x,
            entity.y,
            target.x,
            target.y,
            target.radius + entity.radius
          );
          if (contact === null) return;
          entity.hits.add(target.instanceId);
          const hitX = startX + (entity.x - startX) * contact;
          const hitY = startY + (entity.y - startY) * contact;
          // 出伤特效沿用 V1 的血色粒子。
          if (spineServices.dealDamage(target, SPINE_DAMAGE)) {
            spawnCactusBloodBurst(spineServices, { x: hitX, y: hitY, angle: direction });
          }
          spineServices.spawnParticleBurst({
            kind: "cactus-v2-spine-spark",
            x: hitX,
            y: hitY,
            colors: SPINE_COLORS,
            count: 5,
            minDiameter: 0.8,
            maxDiameter: 1.8,
            minSpeed: 24,
            maxSpeed: 60,
            initialRadius: 1,
            life: 0.18,
            drag: 3
          });
        });
        const margin = entity.radius;
        if (!resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, margin)) {
          spineServices.spawnParticleBurst({
            kind: "cactus-v2-spine-wall",
            ...resolveArenaGeometry(game).clampPoint(entity.x, entity.y),
            colors: SPINE_COLORS,
            count: 6,
            minDiameter: 0.9,
            maxDiameter: 2.2,
            minSpeed: 20,
            maxSpeed: 54,
            initialRadius: 1.4,
            life: 0.22,
            drag: 3
          });
          entity.entityActive = false;
        }
      },
      draw({ entity }, canvas) {
        canvas.save();
        canvas.translate(entity.x, entity.y);
        canvas.rotate(Math.atan2(entity.vy, entity.vx));
        canvas.save();
        canvas.globalAlpha *= 0.4;
        canvas.fillStyle = "#bff06a";
        canvas.beginPath();
        canvas.ellipse(-SPINE_RADIUS * 3.4, 0, SPINE_RADIUS * 2.8, SPINE_RADIUS * 0.5, 0, 0, TWO_PI);
        canvas.fill();
        canvas.restore();
        canvas.fillStyle = "#2f5e12";
        canvas.beginPath();
        canvas.ellipse(0, 0, SPINE_RADIUS * 2.2, SPINE_RADIUS * 0.9, 0, 0, TWO_PI);
        canvas.fill();
        canvas.fillStyle = "#9fd823";
        canvas.beginPath();
        canvas.ellipse(0, 0, SPINE_RADIUS * 1.75, SPINE_RADIUS * 0.66, 0, 0, TWO_PI);
        canvas.fill();
        canvas.fillStyle = "#eaffc8";
        canvas.beginPath();
        canvas.ellipse(SPINE_RADIUS * 0.35, 0, SPINE_RADIUS * 0.95, SPINE_RADIUS * 0.28, 0, 0, TWO_PI);
        canvas.fill();
        canvas.restore();
      }
    };
  }

  // 第三方仙人掌：本体是召唤物（有血、扎根、能被打掉），外观沿用 V1 的植株画法。
  function createCactusV2PlantDefinition(shared) {
    return {
      id: PLANT_ID,
      name: "仙人掌",
      englishName: "Cactus",
      color: "#9fd823",
      fixedStructure: true,
      drawLayer: "background",
      stats: {
        radius: PLANT_RADIUS,
        speed: 1,
        maxHp: PLANT_HP
      },
      createBehavior(services) {
        let ball = null;
        let age = 0;
        let senseRemaining = 0;
        let fireDelay = 0;
        let fired = true;
        let sway = 0;
        let retireRemaining = 0;
        const spawnBurst = (kind, count, speed) => {
          if (!ball) return;
          services.spawnParticleBurst({
            kind,
            x: ball.x,
            y: ball.y,
            colors: SHATTER_COLORS,
            count,
            minDiameter: 1.2,
            maxDiameter: 3.4,
            minSpeed: speed * 0.4,
            maxSpeed: speed,
            initialRadius: 3,
            life: 0.4,
            drag: 2.4,
            gravityY: 80
          });
        };

        function fireSpines() {
          if (!ball || ball.hp <= 0) return;
          for (let index = 0; index < SPINE_COUNT; index += 1) {
            const angle = Math.random() * TWO_PI;
            const muzzle = ball.radius * 0.75;
            services.spawnProjectile(createSpineDefinition({
              x: ball.x + Math.cos(angle) * muzzle,
              y: ball.y + Math.sin(angle) * muzzle,
              angle
            }));
          }
        }

        return {
          get alive() {
            return Boolean(ball && ball.hp > 0 && ball.active !== false);
          },
          get retiring() {
            return retireRemaining > 0;
          },
          // 感应到本体落地：开始扭动，扭到一半左右再射出尖刺。
          sense() {
            if (retireRemaining > 0) return;
            senseRemaining = SENSE_DURATION;
            fireDelay = SENSE_FIRE_MIN + Math.random() * (SENSE_FIRE_MAX - SENSE_FIRE_MIN);
            fired = false;
          },
          // 让位退场：先放完枯萎动画再消失。
          retire() {
            if (retireRemaining <= 0) retireRemaining = RETIRE_DURATION;
          },
          onSpawn(context) {
            ball = context.ball;
            shared.register(this);
          },
          update(context, dt) {
            const step = Math.max(0, dt);
            age += step;
            if (retireRemaining > 0) {
              // 让位退场：沿用 V1 的枯萎表现，动画结束才真正消失。
              retireRemaining = Math.max(0, retireRemaining - step);
              sway = 0;
              if (retireRemaining <= 0 && ball && ball.hp > 0) ball.hp = 0;
              return;
            }
            if (senseRemaining <= 0) return;
            senseRemaining = Math.max(0, senseRemaining - step);
            const progress = 1 - senseRemaining / SENSE_DURATION;
            // 扭动：先一缩，再左右摇摆，幅度随包络衰减。
            sway = Math.sin(progress * Math.PI * 7) * Math.sin(progress * Math.PI);
            if (!fired && progress * SENSE_DURATION >= fireDelay) {
              fired = true;
              fireSpines();
            }
            if (senseRemaining <= 0) {
              sway = 0;
              fired = true;
            }
          },
          onBeforeDamage(context, event) {
            // 撞碎植株仍会接触到尖刺；在致命身体攻击结算前补上刺伤。
            if (event.kind !== "body" || event.amount < context.ball.hp || !event.actor) return;
            const capabilities = services.getCapabilities(context.ball);
            if (!capabilities.canBodyAttack || !capabilities.canDealDamage) return;
            services.dealDamage(event.actor, PLANT_DAMAGE, context.ball);
          },
          onCollision(context, target) {
            if (context.blockedAtContact) return;
            if (!context.services.dealDamage(target, PLANT_DAMAGE)) return;
            // 出伤特效沿用 V1 的血色粒子。
            const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
            const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
            const surface = Math.max(0, Math.min(ball.radius, distance - target.radius));
            spawnCactusBloodBurst(context.services, {
              x: ball.x + Math.cos(angle) * surface,
              y: ball.y + Math.sin(angle) * surface,
              angle
            });
          },
          onDeath() {
            shared.unregister(this);
            // 被打碎的仙人掌炸成绿屑；让位枯萎的那株只是静静退场。
            if (retireRemaining <= 0) spawnBurst("cactus-v2-plant-shatter", 16, 110);
            else spawnBurst("cactus-v2-plant-dust", 8, 46);
          },
          getContactProfile() {
            return retireRemaining > 0 ? { solid: false, targetable: false } : undefined;
          },
          // 植株直径 24，够大，直接显示 2 点血（渲染器默认绘制）。
          drawBody(context, canvas) {
            drawCactusPlant(canvas, {
              x: ball.x,
              y: ball.y,
              radius: ball.radius,
              age,
              // 常驻植株不会自己枯萎，只有让位退场时才有枯萎进度。
              witherAt: Infinity,
              wither: retireRemaining > 0
                ? 1 - retireRemaining / RETIRE_DURATION
                : 0,
              sway
            });
            return true;
          }
        };
      }
    };
  }

  const cactusV2Definition = {
    id: "cactusV2",
    name: "仙人掌V2",
    englishName: "Cactus V2",
    color: "#71a146",
    description: "抛种速度从0.25个/s线性加速到3个/s；种出2伤/2血的第三方仙人掌；每4.8秒起跳落地，腾空无敌，落地后全场仙人掌扭动并各自射出5根穿透尖刺",
    // 普通池：1v2 复测为 39.6%（12 组对手 × 8 种子，n=96），低于精英档 75–90% 的区间。
    rosterType: "normal",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    // 一轮完整循环：第一颗种子 2.62 秒，第一次起跳 4.8 秒 + 0.5 秒落地。
    rionCycleDuration: 5.6,
    createBehavior(services) {
      let spawnTime = 0;
      let skippedAttackTime = 0;
      const scheduleNow = (game) => (typeof services.getAttackTime === "function"
        ? services.getAttackTime() + skippedAttackTime : game.time);
      let ballRef = null;
      let seedIndex = 0;
      let nextJumpAt = JUMP_INTERVAL;
      let jumpStartedAt = null;
      let throwPulse = 0;
      const pendingSeeds = [];
      // 和重锤一致的暂停语义：暂停/眩晕期间错过的排程不补做。
      // 这株球的仙人掌花名册：按种植顺序，超出上限时最老的一株让位枯萎。
      const shared = {
        plants: [],
        register(plant) {
          shared.plants.push(plant);
        },
        unregister(plant) {
          const index = shared.plants.indexOf(plant);
          if (index >= 0) shared.plants.splice(index, 1);
        },
        senseAll() {
          for (const plant of shared.plants.slice()) {
            if (plant.alive) plant.sense();
          }
        }
      };

      function randomSpot(arenaSize, radius) {
        return resolveArenaGeometry(arenaSize).samplePoint(Math.random, radius + 1);
      }

      function throwSeed(ball, game) {
        const radius = PLANT_RADIUS;
        const point = randomSpot(game.arena || game.arenaSize, radius);
        pendingSeeds.push({ point, at: game.time + SEED_FLIGHT });
        throwPulse = THROW_PULSE;
        services.spawnVisualEffect(createSingleSeedEffect({
          from: { x: ball.x, y: ball.y },
          ballRadius: ball.radius,
          target: point,
          radius
        }), { lifecycle: "owner-bound" });
      }

      function plantSeed(point) {
        // 场上上限：最老的一株先枯萎让位。退场动画期间它仍占一个残影位，
        // 所以实体总数最多是 maxPlants + 2（0.45 秒枯萎 × 3 个/s）。
        const field = shared.plants.filter((plant) => plant.alive && !plant.retiring);
        if (field.length >= MAX_PLANTS) field[0].retire();
        return services.spawnSummon(createCactusV2PlantDefinition(shared), {
          x: point.x,
          y: point.y,
          movementLocked: true,
          positionLocked: true
        });
      }

      function takeOff(ball) {
        spawnHopBurst(services, ball.x, ball.y, { count: 10, speed: 54, ring: false });
      }

      function land(ball) {
        spawnHopBurst(services, ball.x, ball.y, { count: 18, speed: 96, ring: true });
        services.shakeArena({ intensity: 5, duration: 0.1 });
        services.spawnVisualEffect(createSenseRingEffect(ball.x, ball.y));
        shared.senseAll();
      }

      return {
        onSpawn({ game }) {
          skippedAttackTime = 0;
          spawnTime = scheduleNow(game);
          seedIndex = 0;
          nextJumpAt = spawnTime + JUMP_INTERVAL;
          jumpStartedAt = null;
          throwPulse = 0;
          pendingSeeds.length = 0;
          shared.plants.length = 0;
        },
        updateWhilePaused(context, dt) {
          // 保留错过排程不补做的规则；dt 已按攻击周期缩放，不能累计世界时间。
          skippedAttackTime += Math.max(0, dt);
        },
        update({ ball, game }, dt) {
          const now = scheduleNow(game);
          ballRef = ball;
          const step = Math.max(0, dt);
          throwPulse = Math.max(0, throwPulse - step);

          // 抛种：速率随时间线性上升；暂停/眩晕错过的种子不再补投。
          while (now + EPSILON >= spawnTime + seedTimeFor(seedIndex)) {
            const scheduledAt = spawnTime + seedTimeFor(seedIndex);
            seedIndex += 1;
            if (now - scheduledAt <= CATCHUP_WINDOW) throwSeed(ball, game);
          }
          for (let index = pendingSeeds.length - 1; index >= 0; index -= 1) {
            if (game.time + EPSILON < pendingSeeds[index].at) continue;
            const seed = pendingSeeds[index];
            pendingSeeds.splice(index, 1);
            plantSeed(seed.point);
          }

          // 跳：每 4.8 秒起跳，0.5 秒后落地。和抛种同一条catch-up 规则：
          // 被暂停/眩晕整段错过的跳不再补跳（否则会冒出一记零长度的"幽灵跳"，
          // 落地还会立刻触发全场齐射）。重锤在暂停期间直接冻结跳跃计时，
          // 这里用绝对时间表 + 丢弃过期边界达到同样的效果。
          while (jumpStartedAt === null && now + EPSILON >= nextJumpAt) {
            const scheduledAt = nextJumpAt;
            nextJumpAt += JUMP_INTERVAL;
            if (now - scheduledAt > CATCHUP_WINDOW) continue;
            jumpStartedAt = game.time - Math.max(0, now - scheduledAt);
            takeOff(ball);
          }
          if (jumpStartedAt !== null && game.time + EPSILON >= jumpStartedAt + JUMP_DURATION) {
            jumpStartedAt = null;
            land(ball);
          }
        },
        getNextTransitionIn({ game }) {
          const scale = typeof services.getAttackPeriodScale === "function"
            ? services.getAttackPeriodScale() : 1;
          const boundaries = [
            spawnTime + seedTimeFor(seedIndex) - scheduleNow(game),
            jumpStartedAt === null
              ? nextJumpAt - scheduleNow(game)
              : (jumpStartedAt + JUMP_DURATION - game.time) / scale
          ];
          for (const seed of pendingSeeds) boundaries.push((seed.at - game.time) / scale);
          const remaining = Math.min(...boundaries.filter((value) => Number.isFinite(value)));
          return remaining > EPSILON ? remaining : undefined;
        },
        // 腾空无敌：和重锤同一套判定——physical=false 不参与实体碰撞（从别人头上飞过），
        // targetable=false 不可被选中（吃不到伤害与选中类效果）。
        getContactProfile() {
          return jumpStartedAt === null ? undefined : { physical: false, targetable: false };
        },
        // 通用离地位移：本体、血量数字与附着特效一起抬起，地面投影仍在原地画。
        getRenderOffset({ game }) {
          if (jumpStartedAt === null) return null;
          const height = jumpHeightAt((game.time - jumpStartedAt) / JUMP_DURATION);
          return height > 0 ? { x: 0, y: -height } : null;
        },
        drawArenaBackground({ ball, game }, canvas) {
          if (jumpStartedAt === null) return;
          const height = jumpHeightAt((game.time - jumpStartedAt) / JUMP_DURATION);
          const ratio = clamp(height / JUMP_HEIGHT, 0, 1);
          canvas.save();
          // 地面投影：越高越小越淡。
          canvas.globalAlpha *= 0.34 * (1 - ratio * 0.65);
          canvas.fillStyle = "#16310a";
          canvas.beginPath();
          canvas.ellipse(
            ball.x,
            ball.y + ball.radius * 0.72,
            ball.radius * (1 - ratio * 0.45),
            ball.radius * 0.42 * (1 - ratio * 0.45),
            0,
            0,
            TWO_PI
          );
          canvas.fill();
          // 起跳气流：地面到本体的淡绿竖痕。
          canvas.globalAlpha *= 0.5;
          canvas.strokeStyle = "#bff06a";
          canvas.lineWidth = 3;
          canvas.beginPath();
          canvas.moveTo(ball.x, ball.y);
          canvas.lineTo(ball.x, ball.y - height);
          canvas.stroke();
          canvas.restore();
        },
        drawBody(context, canvas) {
          return drawCactusV2Body(context, canvas, throwPulse);
        },
        onBorrowEnd() {
          for (const plant of shared.plants.slice()) {
            if (plant.alive) plant.retire();
          }
        },
        getCactusV2State() {
          const elapsed = scheduleNow({ time: services.getTime() }) - spawnTime;
          return {
            seedIndex,
            rate: seedRateAt(elapsed),
            airborne: jumpStartedAt !== null,
            height: jumpStartedAt === null
              ? 0
              : jumpHeightAt((services.getTime() - jumpStartedAt) / JUMP_DURATION),
            pendingSeeds: pendingSeeds.length,
            plants: shared.plants.filter((plant) => plant.alive).length
          };
        }
      };
    }
  };

  registerBall(cactusV2Definition);
  return {
    cactusV2Definition,
    createCactusV2PlantDefinition,
    createSpineDefinition,
    createSingleSeedEffect,
    createSenseRingEffect,
    seedTimeFor,
    seedRateAt,
    jumpHeightAt,
    CACTUS_V2_RULES
  };
});
