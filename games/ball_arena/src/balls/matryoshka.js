(function initializeMatryoshka(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMatryoshkaPlugin(dependencies) {
  "use strict";
  const { registerBall } = dependencies;

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  // 青色：本体走渲染器默认的纯色圆，只有颜色是这只球的身份。
  const CYAN = "#16c6d8";
  const CYAN_DARK = "#0a6f7d";
  const CYAN_LIGHT = "#b6f3fb";

  // 一层壳一档：直径 30→25→20→15，血量 100→50→25→12。
  const STAGES = Object.freeze([
    Object.freeze({ diameter: 30, hp: 100 }),
    Object.freeze({ diameter: 25, hp: 50 }),
    Object.freeze({ diameter: 20, hp: 25 }),
    Object.freeze({ diameter: 15, hp: 12 })
  ]);

  const RULES = Object.freeze({
    collisionDamage: 2,
    fragmentCount: 4,
    fragmentSpeed: 300,
    fragmentDamage: 3,
    fragmentRadius: 4,
    crackCount: 7
  });

  const CRACK_COLORS = Object.freeze([CYAN, "#5fe3f0", "#d8fbff"]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function stageAt(index) {
    return STAGES[clamp(index, 0, STAGES.length - 1)];
  }

  // 确定性伪随机：裂纹每次绘制都长在同一个位置，不会逐帧抖动。
  function pseudoRandom(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  // 一条从壳面往内裂的折线（角度 + 半径比例都是确定值，只到壳的中段）。
  function crackPath(stageIndex, crackIndex) {
    const points = [];
    let angle = pseudoRandom(stageIndex * 37 + crackIndex * 11 + 1) * TWO_PI;
    let radiusFactor = 0.97;
    const segments = 4;
    for (let step = 0; step <= segments; step += 1) {
      points.push({ angle, radiusFactor: Math.max(0.42, radiusFactor) });
      angle += (pseudoRandom(stageIndex * 53 + crackIndex * 17 + step * 5) - 0.5) * 0.85;
      radiusFactor -= 0.14 + pseudoRandom(stageIndex * 7 + crackIndex * 29 + step * 3) * 0.08;
    }
    return points;
  }

  const CRACK_PATHS = Object.freeze(STAGES.map((_stage, stageIndex) => (
    Object.freeze(Array.from({ length: RULES.crackCount }, (_unused, crackIndex) => (
      Object.freeze(crackPath(stageIndex, crackIndex))
    )))
  )));

  // 碎裂特效：外壳一点点裂开，损伤越深裂纹越多越长。
  function drawCracks(canvasContext, ball, stageIndex, damageRatio) {
    if (damageRatio <= 0.02) return;
    const paths = CRACK_PATHS[stageIndex] || CRACK_PATHS[0];
    const radius = ball.radius;
    canvasContext.save();
    canvasContext.translate(ball.x, ball.y);
    canvasContext.lineCap = "round";
    for (let index = 0; index < paths.length; index += 1) {
      const threshold = (index + 1) / (paths.length + 1);
      if (damageRatio <= threshold * 0.55) continue;
      const reveal = clamp((damageRatio - threshold * 0.55) / (1 - threshold * 0.55), 0, 1);
      const points = paths[index];
      const visible = Math.max(2, Math.ceil(points.length * (0.45 + reveal * 0.55)));
      canvasContext.globalAlpha = 0.28 + reveal * 0.62;
      canvasContext.strokeStyle = index % 3 === 0 ? CYAN_LIGHT : CYAN_DARK;
      canvasContext.lineWidth = 1 + reveal * 1.1;
      canvasContext.beginPath();
      for (let point = 0; point < visible; point += 1) {
        const { angle, radiusFactor } = points[point];
        const x = Math.cos(angle) * radiusFactor * radius;
        const y = Math.sin(angle) * radiusFactor * radius;
        if (point === 0) canvasContext.moveTo(x, y);
        else canvasContext.lineTo(x, y);
      }
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function speedOf(entity) {
    return Math.hypot(entity.vx, entity.vy);
  }

  function setSpeed(entity, directionX, directionY) {
    entity.vx = directionX * RULES.fragmentSpeed;
    entity.vy = directionY * RULES.fragmentSpeed;
  }

  // 碎壳碎片：普通子弹类实体——300 速直线飞行，碰墙反弹，命中目标结算一次 3 点伤害后立刻消耗，
  // 既不做球体碰撞（不推球、不反弹对手），也不会贯穿目标。
  function createMatryoshkaShard(ball, angle, arenaSize, arena) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const spawnDistance = ball.radius + RULES.fragmentRadius + 1;
    const spawn = arena && arena.shape !== "square"
      ? arena.clampPoint(ball.x + directionX * spawnDistance, ball.y + directionY * spawnDistance, RULES.fragmentRadius)
      : {
        x: clamp(ball.x + directionX * spawnDistance, RULES.fragmentRadius, arenaSize - RULES.fragmentRadius),
        y: clamp(ball.y + directionY * spawnDistance, RULES.fragmentRadius, arenaSize - RULES.fragmentRadius)
      };
    return {
      kind: "matryoshka-shard",
      combatKind: "projectile",
      isProjectile: true,
      life: PERMANENT_LIFE,
      radius: RULES.fragmentRadius,
      damage: RULES.fragmentDamage,
      color: CYAN,
      vx: directionX * RULES.fragmentSpeed,
      vy: directionY * RULES.fragmentSpeed,
      x: spawn.x,
      y: spawn.y,
      update({ entity, game, services: entityServices }, dt) {
        const step = Math.max(0, dt);
        if (game.arena && game.arena.shape !== "square") {
          updateShardInArena(entity, game.arena, entityServices, step);
          return;
        }
        const startX = entity.x;
        const startY = entity.y;
        const bounds = Math.max(RULES.fragmentRadius, game.arenaSize - RULES.fragmentRadius);
        let nextX = entity.x + entity.vx * step;
        let nextY = entity.y + entity.vy * step;
        // 墙是普通子弹唯一会反弹的东西：按入射角反射，速度保持 300。
        let bounced = false;
        if (nextX < RULES.fragmentRadius) {
          nextX = 2 * RULES.fragmentRadius - nextX;
          entity.vx = Math.abs(entity.vx);
          bounced = true;
        } else if (nextX > bounds) {
          nextX = 2 * bounds - nextX;
          entity.vx = -Math.abs(entity.vx);
          bounced = true;
        }
        if (nextY < RULES.fragmentRadius) {
          nextY = 2 * RULES.fragmentRadius - nextY;
          entity.vy = Math.abs(entity.vy);
          bounced = true;
        } else if (nextY > bounds) {
          nextY = 2 * bounds - nextY;
          entity.vy = -Math.abs(entity.vy);
          bounced = true;
        }
        entity.x = clamp(nextX, RULES.fragmentRadius, bounds);
        entity.y = clamp(nextY, RULES.fragmentRadius, bounds);
        if (bounced) {
          const magnitude = speedOf(entity) || 1;
          setSpeed(entity, entity.vx / magnitude, entity.vy / magnitude);
        }
        // 命中：扫掠判定出第一个目标，结算伤害后立刻消耗自己（打不穿、也不推球）。
        const target = entityServices.getFirstEnemyHit(
          startX, startY, entity.x, entity.y, entity.radius
        );
        if (!target) return;
        entityServices.dealDamage(target, entity.damage);
        entity.entityActive = false;
      },
      // 普通子弹外观：青色实心圆 + 一圈细描边，不旋转。
      draw({ entity }, context) {
        context.save();
        context.fillStyle = CYAN;
        context.beginPath();
        context.arc(entity.x, entity.y, entity.radius, 0, TWO_PI);
        context.fill();
        context.strokeStyle = CYAN_DARK;
        context.lineWidth = 1;
        context.stroke();
        context.restore();
      }
    };
  }

  // Trace every reflected segment against the actual arena, not its enclosing square.
  function updateShardInArena(entity, arena, services, dt) {
    const start = arena.clampPoint(entity.x, entity.y, entity.radius);
    entity.x = start.x;
    entity.y = start.y;
    let remaining = dt;
    do {
      const startX = entity.x, startY = entity.y;
      const endX = startX + entity.vx * remaining;
      const endY = startY + entity.vy * remaining;
      const wall = arena.traceSegment(startX, startY, endX, endY, entity.radius);
      entity.x = wall ? wall.x : endX;
      entity.y = wall ? wall.y : endY;
      const target = services.getFirstEnemyHit(startX, startY, entity.x, entity.y, entity.radius);
      if (target) {
        services.dealDamage(target, entity.damage);
        entity.entityActive = false;
        return;
      }
      if (!wall) return;
      const dot = entity.vx * wall.normalX + entity.vy * wall.normalY;
      entity.vx -= 2 * dot * wall.normalX;
      entity.vy -= 2 * dot * wall.normalY;
      remaining *= 1 - wall.t;
      // A tiny inward nudge avoids re-hitting the same floating-point boundary.
      const point = arena.clampPoint(entity.x + wall.normalX * EPSILON,
        entity.y + wall.normalY * EPSILON, entity.radius);
      entity.x = point.x;
      entity.y = point.y;
    } while (remaining > EPSILON);
  }

  const matryoshkaDefinition = {
    id: "matryoshka",
    name: "套娃",
    englishName: "Matryoshka",
    color: CYAN,
    description: "青色套娃 / 2点碰撞伤害 / 外壳100→50→25→12，直径30→25→20→15 / 每碎一层壳射出4颗青碎片：300速、3伤害、命中即消耗、碰墙反弹",
    stats: { radius: STAGES[0].diameter / 2, speed: 150, maxHp: STAGES[0].hp },
    rionCycleDuration: 5,
    createBehavior(services) {
      let owner = null;
      let stageIndex = 0;
      let stageMaxHp = STAGES[0].hp;
      let baseRadius = null;
      let baseMaxHp = null;
      let shatterCount = 0;
      // 碎裂特效是一个纯绘制视效，本体仍然走渲染器默认的纯色圆。
      let crackEffect = null;
      // Boss 模式会把本体血量整体放大十倍，那时每一层壳也要按同一比例放大，
      // 不能把运行时血量重置回 100/50/25/12 的未缩放基准。
      let hpScale = 1;
      let hpScaleCaptured = false;

      function remember(ball) {
        if (!ball) return;
        if (baseRadius === null && Number.isFinite(ball.radius)) baseRadius = ball.radius;
        if (baseMaxHp === null && Number.isFinite(ball.maxHp)) baseMaxHp = ball.maxHp;
        if (!hpScaleCaptured && Number.isFinite(ball.maxHp) && ball.maxHp > 0) {
          hpScale = ball.maxHp / matryoshkaDefinition.stats.maxHp;
          hpScaleCaptured = true;
        }
      }

      function damageRatioFor(ball) {
        if (!ball) return 0;
        return clamp(1 - ball.hp / Math.max(EPSILON, stageMaxHp), 0, 1);
      }

      function createCrackEffect() {
        return {
          kind: "matryoshka-cracks",
          life: PERMANENT_LIFE,
          lifecycle: "owner-bound",
          draw(_context, canvasContext) {
            const ball = owner;
            if (!ball || ball.hp <= 0) return;
            drawCracks(canvasContext, ball, stageIndex, damageRatioFor(ball));
          }
        };
      }

      function ensureCrackEffect() {
        if (crackEffect && crackEffect.visualActive !== false) return crackEffect;
        crackEffect = services.spawnVisualEffect(createCrackEffect(), { lifecycle: "owner-bound" });
        return crackEffect;
      }

      function clearCrackEffect() {
        if (!crackEffect) return;
        crackEffect.visualActive = false;
        crackEffect = null;
      }

      function stageHpFor(index) {
        return Math.max(1, Math.round(stageAt(index).hp * hpScale));
      }

      function applyStage(ball, index) {
        stageIndex = index;
        stageMaxHp = stageHpFor(index);
        ball.radius = stageAt(index).diameter / 2;
      }

      function shardBurst(ball, game, shardAngles) {
        const arenaSize = game && Number.isFinite(game.arenaSize) ? game.arenaSize : 200;
        for (const angle of shardAngles) {
          services.spawnProjectile(createMatryoshkaShard(ball, angle, arenaSize, game && game.arena));
        }
      }

      // 碎壳特效：本体位置一圈青色碎片 + 一道扩散环，判定交给统一粒子系统。
      function shellBreakEffect(ball, radius) {
        services.spawnParticleBurst({
          x: ball.x,
          y: ball.y,
          kind: "matryoshka-shell",
          count: 26,
          colors: CRACK_COLORS,
          shape: "rect",
          minLength: 2,
          maxLength: 7,
          minWidth: 1,
          maxWidth: 2.4,
          rotationSpeed: 12,
          minSpeed: 70,
          maxSpeed: 210,
          initialRadius: radius * 0.6,
          life: 0.6,
          drag: 2.2,
          ring: {
            color: CYAN_LIGHT,
            lineWidth: 1.6,
            startRadius: radius,
            endRadius: radius + 16
          }
        });
      }

      // 打穿一层壳：本体缩小一档、换上新壳的血量，并朝四周射出四颗碎片。
      function breakShell(ball, game) {
        const nextIndex = stageIndex + 1;
        const shatterAngle = Math.random() * TWO_PI;
        const shardAngles = [];
        for (let index = 0; index < RULES.fragmentCount; index += 1) {
          shardAngles.push(shatterAngle + index * (TWO_PI / RULES.fragmentCount));
        }
        const brokenRadius = ball.radius;
        applyStage(ball, nextIndex);
        ball.maxHp = stageMaxHp;
        ball.hp = stageMaxHp;
        shatterCount += 1;
        shellBreakEffect(ball, brokenRadius);
        shardBurst(ball, game, shardAngles);
        services.playSound("summon", { kind: "matryoshka-shell", stage: nextIndex });
      }

      return {
        onSpawn(context) {
          owner = context.ball;
          remember(owner);
          stageIndex = 0;
          applyStage(owner, 0);
          ensureCrackEffect();
        },
        update(context) {
          // 借用宿主（莉音）不会收到 onSpawn，所以每步都记住本体基线。
          owner = context.ball;
          remember(owner);
          ensureCrackEffect();
        },
        // 伤害结算前先破壳：一层壳吃掉刚好打穿它的那一段，多出来的伤害继续打进下一层，
        // 所以血量是 100/50/25/12 的整池（合计 187），大伤害可以一次碎掉好几层。
        onBeforeDamage(context, event) {
          const ball = context.ball;
          if (!ball || !event || !Number.isFinite(event.amount) || event.amount <= 0) return undefined;
          let remaining = event.amount;
          let shellsBroken = 0;
          while (
            stageIndex + 1 < STAGES.length &&
            ball.hp > 0 &&
            remaining + EPSILON >= ball.hp
          ) {
            remaining -= ball.hp;
            breakShell(ball, context.game);
            shellsBroken += 1;
          }
          if (shellsBroken === 0) return undefined;
          return { amount: Math.max(0, remaining) };
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, RULES.collisionDamage);
        },
        // 最后一层壳碎掉时补一轮更重的收尾爆散（外壳彻底散架）。
        onDeath(context) {
          const ball = context.ball;
          shellBreakEffect(ball, ball.radius);
          shellBreakEffect(ball, ball.radius * 0.6);
          clearCrackEffect();
        },
        // 莉音借用结束：把外壳尺寸与血量上限还给宿主本体（借用期的碎壳状态随借用丢弃）。
        onBorrowEnd(context) {
          const ball = context.ball;
          if (ball) {
            if (baseRadius !== null) ball.radius = baseRadius;
            if (baseMaxHp !== null) ball.maxHp = baseMaxHp;
            if (ball.hp > ball.maxHp) ball.hp = ball.maxHp;
          }
          stageIndex = 0;
          stageMaxHp = STAGES[0].hp;
          clearCrackEffect();
        },
        getMatryoshkaState() {
          return {
            stageIndex,
            stage: stageAt(stageIndex),
            stageMaxHp,
            hpScale,
            shatterCount,
            radius: owner ? owner.radius : stageAt(stageIndex).diameter / 2,
            hp: owner ? owner.hp : stageMaxHp,
            crackActive: Boolean(crackEffect && crackEffect.visualActive !== false)
          };
        }
      };
    }
  };

  registerBall(matryoshkaDefinition);
  return {
    matryoshkaDefinition,
    MATRYOSHKA_STAGES: STAGES,
    MATRYOSHKA_RULES: RULES,
    createMatryoshkaShard
  };
});
