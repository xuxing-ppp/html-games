(function initializeBlizzard(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/sprite-cache.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBlizzardPlugin({ registerBall, resolveArenaGeometry, createSpriteCache }) {
  const snowflakeSprites = createSpriteCache();
  const SPAWN_INTERVAL = 0.2;
  const SNOWFLAKE_DAMAGE = 1;
  // 每条冰寒独立存活 0.4s：它不是堆栈，到点自己解除，不刷新同伴。
  const SLOW_DURATION = 0.4;
  // 每片雪花把速度减到原来的 75%（只扣 25%）。多片并存时引擎叠乘：0.75ⁿ。
  const SLOW_FACTOR = 0.75;
  // 与移动减速相同，攻击时钟降到 75%；周期倍率为其倒数。
  const ATTACK_PERIOD_SCALE = 1 / SLOW_FACTOR;
  const ORBIT_RADIUS_GROWTH = 25;
  // 公转 0.5±0.1 r/s：周期 1.67~2.5 秒。
  const ORBIT_REV_MIN = 0.4;
  const ORBIT_REV_MAX = 0.6;
  const MIN_DIAMETER = 5;
  const MAX_DIAMETER = 8;
  const STYLE_COUNT = 7;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const SNOWFLAKE_COLOR = "#ffffff";
  // 轻微粒子拖尾：短、窄、偏淡，只让雪花在公转时留下一条白雾尾迹。
  // 不透明度调到 0.48：0.24 时尾迹几乎看不见，抬高后轮廓清晰但仍不抢雪花本体。
  const SNOWFLAKE_TRAIL_KIND = "blizzard-snowflake-trail";
  const SNOWFLAKE_TRAIL_SAMPLE_LIFE = 0.16;
  const SNOWFLAKE_TRAIL_MAX_ALPHA = 0.48;
  const SNOWFLAKE_TRAIL_MAX_SAMPLES = 10;
  const SNOWFLAKE_TRAIL_INTERVAL = 0.03;
  const SNOWFLAKE_TRAIL_MIN_SCALE = 0.3;
  const SNOWFLAKE_TRAIL_WIDTH_RATIO = 0.75;
  // 减速是「队列」不是堆栈：每片雪花挂一条独立的 0.4s 冰寒实例，
  // 各条按自己的时刻到期解除，同存的若干条由引擎叠乘（0.75ⁿ）。
  // id 前缀 + 实例序号区分每片命中，保证是新效果而非刷新同一条。
  const CHILL_EFFECT_ID = "blizzard-chill";
  const ICE_SHARD_KIND = "blizzard-ice-shard";
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function segmentDistanceToPoint(startX, startY, endX, endY, x, y) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared,
      0,
      1
    );
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    return Math.hypot(x - closestX, y - closestY);
  }

  function movingBodyDistance(startX, startY, endX, endY, target) {
    return segmentDistanceToPoint(startX, startY, endX, endY, target.x, target.y);
  }

  function randomOrbitVelocity() {
    return TWO_PI * (ORBIT_REV_MIN + Math.random() * (ORBIT_REV_MAX - ORBIT_REV_MIN));
  }

  // ------------------------------------------------------------------
  // 液氮同款冰霜特效：命中冰寒的冰环与雪花融化冰屑。
  // 视觉沿用液氮配色（#cdeeff / #e8f8ff / #9fdcff / #eefaff / #dff4ff）。
  // ------------------------------------------------------------------
  // 生成一条独立的冰寒实例：每片命中都是新队列项，不合并、不刷新。
  function createChillEffect(serial) {
    return {
      id: CHILL_EFFECT_ID + "-" + serial,
      duration: SLOW_DURATION,
      speedFactor: SLOW_FACTOR,
      attackPeriodScale: ATTACK_PERIOD_SCALE,
      attackTags: ["cold"],
      combatKind: "skill",
      onApply({ effect, game }) {
        if (!Number.isFinite(effect.startedAt)) effect.startedAt = game.time;
      },
      draw({ ball, effect, game }, canvas) {
        if (!canvas || typeof canvas.arc !== "function") return;
        const base = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
        const elapsed = Math.max(0, game.time - (effect.startedAt || 0));
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 7);
        canvas.save();
        canvas.globalAlpha = base * (0.26 + pulse * 0.18);
        canvas.strokeStyle = "#cdeeff";
        canvas.lineWidth = 1.4;
        canvas.beginPath();
        canvas.arc(ball.x, ball.y, ball.radius + 1.5, 0, TWO_PI);
        canvas.stroke();
        canvas.fillStyle = "#e8f8ff";
        for (let index = 0; index < 5; index += 1) {
          const angle = index * TWO_PI / 5 + elapsed * 0.9;
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


  // 雪花融化：冰屑四散（液氮喷雾粒子的同款配色与手感）。
  function spawnIceShards(entityServices, x, y) {
    if (!entityServices || typeof entityServices.spawnParticleBurst !== "function") return;
    entityServices.spawnParticleBurst({
      x,
      y,
      kind: ICE_SHARD_KIND,
      count: 8,
      colors: ["#ffffff", "#e2f6ff", "#a5e2ff", "#6cc6f2"],
      minDiameter: 2.5,
      maxDiameter: 5,
      minSpeed: 40,
      maxSpeed: 140,
      initialRadius: 3,
      life: 0.35,
      drag: 3
    });
  }

  function randomSpinVelocity() {
    return Math.PI * 2 * (0.2 + Math.random() * 0.3);
  }

  function drawSnowflakeTrailSample(context, sample, scale, progress, stretch, width) {
    const matrix = typeof context.getTransform === "function" ? context.getTransform() : null;
    const deviceScale = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
    const sprite = deviceScale > 0 ? snowflakeSprites.get("blizzard-soft-trail", 12, deviceScale,
      (canvas, x, y) => {
        const gradient = canvas.createRadialGradient(x, y, 0.32, x, y, 4);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(0.45, "rgba(255,255,255,0.7)");
        gradient.addColorStop(0.78, "rgba(255,255,255,0.26)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        canvas.fillStyle = gradient;
        canvas.filter = "blur(1px)";
        canvas.beginPath();
        canvas.arc(x, y, 4, 0, TWO_PI);
        canvas.fill();
      }) : null;
    context.save();
    context.translate(sample.x, sample.y);
    context.rotate(sample.heading || 0);
    const radius = Math.max(0.4, sample.radius * scale);
    if (sprite) {
      context.scale(radius * stretch / 4, radius * width / 4);
      context.drawImage(sprite.canvas, -6, -6, sprite.worldWidth, sprite.worldWidth);
    } else {
      context.scale(stretch, width);
      context.fillStyle = SNOWFLAKE_COLOR;
      context.beginPath();
      context.arc(0, 0, radius, 0, TWO_PI);
      context.fill();
    }
    context.restore();
  }

  function paintSnowflake(context, entity) {
    const radius = entity.radius;
    context.strokeStyle = SNOWFLAKE_COLOR;
    context.fillStyle = SNOWFLAKE_COLOR;
    const style = entity.styleIndex % STYLE_COUNT;
    if (style === 0) {
      // 六角放射：六条主轴，末端带 45° 分叉。
      context.lineWidth = Math.max(0.6, radius * 0.18);
      for (let arm = 0; arm < 6; arm += 1) {
        const armAngle = arm * Math.PI / 3;
        const tipX = Math.cos(armAngle) * radius;
        const tipY = Math.sin(armAngle) * radius;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(tipX, tipY);
        context.stroke();
        const branchBase = radius * 0.55;
        const baseX = Math.cos(armAngle) * branchBase;
        const baseY = Math.sin(armAngle) * branchBase;
        const branchLength = radius * 0.3;
        context.beginPath();
        context.moveTo(baseX, baseY);
        context.lineTo(
          baseX + Math.cos(armAngle + Math.PI / 4) * branchLength,
          baseY + Math.sin(armAngle + Math.PI / 4) * branchLength
        );
        context.moveTo(baseX, baseY);
        context.lineTo(
          baseX + Math.cos(armAngle - Math.PI / 4) * branchLength,
          baseY + Math.sin(armAngle - Math.PI / 4) * branchLength
        );
        context.stroke();
      }
    } else if (style === 1) {
      // 星形：十芒尖星轮廓。
      const spikes = 5;
      context.beginPath();
      for (let point = 0; point < spikes * 2; point += 1) {
        const pointAngle = point * Math.PI / spikes - Math.PI / 2;
        const pointRadius = point % 2 === 0 ? radius : radius * 0.45;
        const px = Math.cos(pointAngle) * pointRadius;
        const py = Math.sin(pointAngle) * pointRadius;
        if (point === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
    } else if (style === 2) {
      // 菱形枝晶：四条菱形臂。
      context.lineWidth = Math.max(0.6, radius * 0.16);
      for (let arm = 0; arm < 4; arm += 1) {
        const armAngle = arm * Math.PI / 2;
        const dx = Math.cos(armAngle);
        const dy = Math.sin(armAngle);
        const px = -dy;
        const py = dx;
        context.beginPath();
        context.moveTo(dx * radius * 0.2, dy * radius * 0.2);
        context.lineTo(dx * radius * 0.5 + px * radius * 0.28, dy * radius * 0.5 + py * radius * 0.28);
        context.lineTo(dx * radius, dy * radius);
        context.lineTo(dx * radius * 0.5 - px * radius * 0.28, dy * radius * 0.5 - py * radius * 0.28);
        context.closePath();
        context.fill();
      }
      context.beginPath();
      context.arc(0, 0, radius * 0.18, 0, Math.PI * 2);
      context.fill();
    } else if (style === 3) {
      // 板状雪花：实心六角板 + 外圈六个小点。
      context.beginPath();
      for (let corner = 0; corner < 6; corner += 1) {
        const cornerAngle = corner * Math.PI / 3;
        const px = Math.cos(cornerAngle) * radius * 0.55;
        const py = Math.sin(cornerAngle) * radius * 0.55;
        if (corner === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      for (let dot = 0; dot < 6; dot += 1) {
        const dotAngle = dot * Math.PI / 3;
        context.beginPath();
        context.arc(
          Math.cos(dotAngle) * radius * 0.85,
          Math.sin(dotAngle) * radius * 0.85,
          radius * 0.15,
          0,
          Math.PI * 2
        );
        context.fill();
      }
    } else if (style === 4) {
      // 针簇：十二条细针 + 中心核。
      context.lineWidth = Math.max(0.5, radius * 0.1);
      for (let needle = 0; needle < 12; needle += 1) {
        const needleAngle = needle * Math.PI / 6;
        context.beginPath();
        context.moveTo(Math.cos(needleAngle) * radius * 0.25, Math.sin(needleAngle) * radius * 0.25);
        context.lineTo(Math.cos(needleAngle) * radius, Math.sin(needleAngle) * radius);
        context.stroke();
      }
      context.beginPath();
      context.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
      context.fill();
    } else if (style === 5) {
      // 三角晶：三个交错三角形轮廓。
      context.lineWidth = Math.max(0.55, radius * 0.14);
      for (let triangle = 0; triangle < 3; triangle += 1) {
        const rotation = triangle * Math.PI / 3;
        context.beginPath();
        for (let corner = 0; corner < 3; corner += 1) {
          const cornerAngle = rotation + corner * Math.PI * 2 / 3;
          const px = Math.cos(cornerAngle) * radius;
          const py = Math.sin(cornerAngle) * radius;
          if (corner === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.stroke();
      }
    } else {
      // 环冠雪花：中心环 + 六颗末端菱片。
      context.lineWidth = Math.max(0.55, radius * 0.14);
      context.beginPath();
      context.arc(0, 0, radius * 0.35, 0, Math.PI * 2);
      context.stroke();
      for (let petal = 0; petal < 6; petal += 1) {
        const petalAngle = petal * Math.PI / 3;
        const cx = Math.cos(petalAngle) * radius * 0.78;
        const cy = Math.sin(petalAngle) * radius * 0.78;
        const size = radius * 0.22;
        const px = -Math.sin(petalAngle);
        const py = Math.cos(petalAngle);
        const dx = Math.cos(petalAngle);
        const dy = Math.sin(petalAngle);
        context.beginPath();
        context.moveTo(cx + dx * size, cy + dy * size);
        context.lineTo(cx + px * size, cy + py * size);
        context.lineTo(cx - dx * size, cy - dy * size);
        context.lineTo(cx - px * size, cy - py * size);
        context.closePath();
        context.fill();
      }
    }

  }

  function createSnowflake(source, angle, diameter, styleIndex, orbitVelocity, spinVelocity) {
    const orbitRadius = source.radius + diameter / 2;
    let trail = null;
    let sprite = null;
    let spriteScale = 0;
    // 拖尾懒生成：雪花第一次更新时才拿到 entityServices。
    function syncTrail(entityServices, entity) {
      if (!trail || trail.finished) {
        trail = entityServices.spawnAfterimageTrail({
          kind: SNOWFLAKE_TRAIL_KIND,
          color: SNOWFLAKE_COLOR,
          drawLayer: "foreground",
          radius: entity.radius,
          maxAlpha: SNOWFLAKE_TRAIL_MAX_ALPHA,
          maxSamples: SNOWFLAKE_TRAIL_MAX_SAMPLES,
          sampleInterval: SNOWFLAKE_TRAIL_INTERVAL,
          sampleLife: SNOWFLAKE_TRAIL_SAMPLE_LIFE,
          minScale: SNOWFLAKE_TRAIL_MIN_SCALE,
          widthRatio: SNOWFLAKE_TRAIL_WIDTH_RATIO,
          // 软边已烘焙进贴图，避免每条短尾迹每帧执行滤镜。
          blurRatio: 0,
          fallbackPasses: [{ alpha: 1, scale: 1 }],
          drawSample: drawSnowflakeTrailSample
        });
      }
      if (!trail) return;
      trail.emit(entity.x, entity.y, entity.radius, {
        heading: Math.atan2(entity.vy, entity.vx),
        speed: Math.hypot(entity.vx, entity.vy),
        angle: entity.spin
      });
    }
    // 硬收尾：雪花融化/离场/主人倒下时立刻清掉尾迹，不留一条停住的雾。
    function endTrail() {
      if (!trail) return;
      trail.end(true);
      trail = null;
    }
    return {
      kind: "blizzard-snowflake",
      combatKind: "body",
      lifecycle: "owner-bound",
      life: PERMANENT_LIFE,
      drawLayer: "foreground",
      radius: diameter / 2,
      styleIndex,
      orbitRadius,
      angle,
      orbitVelocity,
      spin: Math.random() * Math.PI * 2,
      spinVelocity,
      x: source.x + Math.cos(angle) * orbitRadius,
      y: source.y + Math.sin(angle) * orbitRadius,
      previousX: source.x + Math.cos(angle) * orbitRadius,
      previousY: source.y + Math.sin(angle) * orbitRadius,
      update({ entity, game, services: entityServices }, dt) {
        if (!entity.owner || entity.owner.hp <= 0) {
          endTrail();
          entity.entityActive = false;
          return;
        }
        entity.previousX = entity.x;
        entity.previousY = entity.y;
        const step = Math.max(0, dt);
        entity.angle += entity.orbitVelocity * step;
        entity.orbitRadius += ORBIT_RADIUS_GROWTH * step;
        entity.spin += entity.spinVelocity * step;
        entity.x = entity.owner.x + Math.cos(entity.angle) * entity.orbitRadius;
        entity.y = entity.owner.y + Math.sin(entity.angle) * entity.orbitRadius;
        const elapsed = Math.max(EPSILON, dt);
        entity.vx = (entity.x - entity.previousX) / elapsed;
        entity.vy = (entity.y - entity.previousY) / elapsed;
        syncTrail(entityServices, entity);
        // 公转半径超过战场对角线长度（arenaSize × √2）后消失：寿命只由自己的
        // 轨道决定，本体贴着边界时雪花不再"刚张开就被边界抹掉"。
        if (entity.orbitRadius > Math.hypot(resolveArenaGeometry(game).width, resolveArenaGeometry(game).height)) {
          endTrail();
          entity.entityActive = false;
          return;
        }
        let hit = null;
        entityServices.forEachEnemy((target) => {
          if (hit) return;
          const profile = entityServices.getContactProfile(target);
          if (profile.attackable === false) return;
          const distance = movingBodyDistance(
            entity.previousX,
            entity.previousY,
            entity.x,
            entity.y,
            target
          );
          if (distance <= entity.radius + target.radius) hit = target;
        });
        if (!hit) return;
        // 普通子弹实体：命中即融化消失，不贯穿、不重复结算。
        endTrail();
        entity.entityActive = false;
        spawnIceShards(entityServices, entity.x, entity.y);
        entityServices.dealDamage(hit, SNOWFLAKE_DAMAGE);
        // 每片命中挂一条独立的 0.4s 冰寒；id 用雪花自己的 instanceId 区分，
        // 同一子步内多片同时命中也不会撞 id（用 game.time 会退化成刷新）。
        entityServices.applyEffect(hit, createChillEffect(entity.instanceId));
      },
      draw({ entity }, context) {
        const radius = entity.radius;
        context.save();
        context.translate(entity.x, entity.y);
        context.rotate(entity.spin);
        const matrix = typeof context.getTransform === "function" ? context.getTransform() : null;
        const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
        if (scale > 0 && typeof context.drawImage === "function") {
          if (!sprite || Math.abs(spriteScale - scale) > 0.001) {
            const size = radius * 2 + 2;
            sprite = snowflakeSprites.get("blizzard-" + entity.styleIndex, size, scale,
              (canvas, x, y) => {
                canvas.translate(x, y);
                paintSnowflake(canvas, entity);
              });
            spriteScale = scale;
          }
          if (sprite) {
            context.drawImage(sprite.canvas, -sprite.sizeWorld / 2, -sprite.sizeWorld / 2,
              sprite.worldWidth, sprite.worldWidth);
          } else paintSnowflake(context, entity);
        } else paintSnowflake(context, entity);
        context.restore();
      }
    };
  }

  const blizzardDefinition = {
    id: "blizzard",
    elementTags: Object.freeze(["cold"]),
    name: "暴风雪",
    englishName: "Blizzard",
    color: "#7fd4ff",
    description: "环绕雪花 / 每0.2秒生成一片 / 命中-1且冰寒0.4s（移动速度与攻击节奏×0.75，多片并存叠乘）",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 3.6,
    createBehavior(services) {
      let spawnTimer = 0;
      const snowflakes = [];

      function reconcileSnowflakes() {
        for (let index = snowflakes.length - 1; index >= 0; index -= 1) {
          if (snowflakes[index].entityActive === false || snowflakes[index].life <= 0) {
            snowflakes.splice(index, 1);
          }
        }
      }

      function spawnSnowflake(ball) {
        reconcileSnowflakes();
        const angle = Math.random() * Math.PI * 2;
        const diameter = MIN_DIAMETER + Math.random() * (MAX_DIAMETER - MIN_DIAMETER);
        const snowflake = services.spawnCombatEntity(createSnowflake(
          ball,
          angle,
          diameter,
          Math.floor(Math.random() * STYLE_COUNT),
          randomOrbitVelocity(),
          randomSpinVelocity()
        ));
        snowflakes.push(snowflake);
      }

      return {
        update(_context, dt) {
          spawnTimer = Math.min(SPAWN_INTERVAL, spawnTimer + Math.max(0, dt));
          reconcileSnowflakes();
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, SPAWN_INTERVAL - spawnTimer);
        },
        afterUpdateStep(context) {
          if (spawnTimer + EPSILON < SPAWN_INTERVAL) return;
          spawnTimer = 0;
          spawnSnowflake(context.ball);
        },
        onBorrowEnd() {
          spawnTimer = 0;
          for (const snowflake of snowflakes) {
            snowflake.entityActive = false;
          }
          snowflakes.length = 0;
        },
        onDeath() {
          for (const snowflake of snowflakes) {
            snowflake.entityActive = false;
          }
          snowflakes.length = 0;
        },
        getSnowflakeState() {
          reconcileSnowflakes();
          return snowflakes.map((snowflake) => ({
            instanceId: snowflake.instanceId,
            x: snowflake.x,
            y: snowflake.y,
            radius: snowflake.radius,
            styleIndex: snowflake.styleIndex,
            angle: snowflake.angle,
            orbitRadius: snowflake.orbitRadius,
            orbitVelocity: snowflake.orbitVelocity,
            spin: snowflake.spin,
            spinVelocity: snowflake.spinVelocity
          }));
        }
      };
    }
  };

  registerBall(blizzardDefinition);
  return { blizzardDefinition };
});
