(function initializeSoccer(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSoccerPlugin({ resolveArenaGeometry, registerBall }) {
  // 足球：本体碰撞伤害 3。场上每 3 秒在场地边缘随机出现一个有效长度 60 的
  // 球门；球门若一直没被射进，保持 3 秒后渐隐消失。足球本体碰到球门的有效
  // 边缘即算射进：球门渐隐并喷出彩色礼花，碰撞伤害永久 +3（本场对决内可叠加），
  // 同时速度提升到原来的 1.5 倍、持续 2 秒，加速效果可以继续叠加。
  const BASE_COLLISION_DAMAGE = 3;
  const GOAL_DAMAGE_BONUS = 3;
  const GOAL_SPAWN_INTERVAL = 3;
  const GOAL_LENGTH = 60;
  const GOAL_ACTIVE_LIFE = 3;
  const GOAL_FADE_DURATION = 0.5;
  const GOAL_SCORED_FADE_DURATION = 0.35;
  const GOAL_APPEAR_DURATION = 0.18;
  const GOAL_DEPTH = 13;
  const BOOST_STEP = 0.5;
  const BOOST_DURATION = 2;
  // 残影节奏与曲线：其余（模糊比例、拉长增益、样本上限）
  // 全部沿用 core 统一接口的默认值。
  const TRAIL_SAMPLE_INTERVAL = 0.03;
  const TRAIL_SAMPLE_LIFE = 0.25;
  const TRAIL_MAX_ALPHA = 0.4;
  const TRAIL_MIN_SCALE = 0.35;
  // 纯滚动（位移/半径）在 150 速度下是 1.6 圈/秒，花纹会闪糊；视觉自转放慢。
  const ROLL_SPIN_FACTOR = 0.22;
  const MAX_ACTIVE_GOALS = 3;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const BODY_COLOR = "#f4f2ea";
  const PATTERN_COLOR = "#20242b";
  const GOAL_ACCENT = "#ffd45e";
  const CONFETTI_COLORS = [
    "#ff5b6a",
    "#ffd45e",
    "#6ef0b8",
    "#63b8ff",
    "#ff8be6",
    "#ffffff"
  ];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function darkenColor(color, factor = 0.58) {
    const red = Math.round(Number.parseInt(color.slice(1, 3), 16) * factor);
    const green = Math.round(Number.parseInt(color.slice(3, 5), 16) * factor);
    const blue = Math.round(Number.parseInt(color.slice(5, 7), 16) * factor);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  function pointOnSegment(px, py, x0, y0, x1, y1) {
    const lineX = x1 - x0;
    const lineY = y1 - y0;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((px - x0) * lineX + (py - y0) * lineY) / lengthSquared, 0, 1);
    const closestX = x0 + lineX * progress;
    const closestY = y0 + lineY * progress;
    return {
      x: closestX,
      y: closestY,
      distance: Math.hypot(px - closestX, py - closestY)
    };
  }

  function goalEdgeGeometry(edge, along, arenaSize) {
    const half = GOAL_LENGTH / 2;
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") {
      const angle = [-Math.PI, -Math.PI / 2, 0, Math.PI / 2][edge] + (along / (arena.width / 2) - Math.PI / 4);
      const r = arena.width / 2, offset = Math.min(half, r), inset = Math.sqrt(Math.max(0, r * r - offset * offset));
      const nx = -Math.cos(angle), ny = -Math.sin(angle), tx = -ny, ty = nx;
      const centerX = arena.centerX - nx * inset, centerY = arena.centerY - ny * inset;
      return { normalX: nx, normalY: ny, centerX, centerY,
        x0: centerX - tx * offset, y0: centerY - ty * offset, x1: centerX + tx * offset, y1: centerY + ty * offset };
    }
    if (edge === 0) {
      // 左边：有效边缘贴在 x = 0 上，朝场内的法线是 +x。
      return {
        normalX: 1, normalY: 0,
        x0: arena.left, y0: along - half, x1: arena.left, y1: along + half,
        centerX: arena.left, centerY: along
      };
    }
    if (edge === 1) {
      return {
        normalX: 0, normalY: 1,
        x0: along - half, y0: arena.top, x1: along + half, y1: arena.top,
        centerX: along, centerY: arena.top
      };
    }
    if (edge === 2) {
      return {
        normalX: -1, normalY: 0,
        x0: arena.right, y0: along - half, x1: arena.right, y1: along + half,
        centerX: arena.right, centerY: along
      };
    }
    return {
      normalX: 0, normalY: -1,
      x0: along - half, y0: arena.bottom, x1: along + half, y1: arena.bottom,
      centerX: along, centerY: arena.bottom
    };
  }

  // 随机挑选场地边缘上的一个球门位置：整条 60 有效长度必须完整落在场内，
  // 并尽量不与仍然存在的球门重叠。
  function pickGoalPlacement(arenaSize, activeGoals = [], random = Math.random) {
    const half = GOAL_LENGTH / 2;
    const arena = resolveArenaGeometry(arenaSize);
    let placement = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const edge = Math.floor(random() * 4) % 4;
      const span = arena.shape === "circle" ? Math.PI * arena.width / 4 : (edge % 2 === 0 ? arena.height : arena.width);
      const low = arena.shape === "circle" ? 0 : (edge % 2 === 0 ? arena.top : arena.left) + Math.min(half, span / 2);
      const along = low + random() * (arena.shape === "circle" ? span : Math.max(0, span - GOAL_LENGTH));
      placement = { edge, along, ...goalEdgeGeometry(edge, along, arenaSize) };
      placement.angle = Math.atan2(placement.normalY, placement.normalX);
      const overlaps = activeGoals.some((goal) => (
        goal.active !== false && goal.entityActive !== false &&
        goal.edge === edge && Math.abs(goal.along - along) < GOAL_LENGTH
      ));
      if (!overlaps) break;
    }
    return placement;
  }

  function drawBallPattern(context, radius, angle) {
    // 中央五边形 + 五个被球面边缘裁切的周边色块：经典足球拼皮花纹。
    context.save();
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.clip();
    context.fillStyle = PATTERN_COLOR;
    context.beginPath();
    for (let vertex = 0; vertex < 5; vertex += 1) {
      const theta = angle - Math.PI / 2 + vertex * TWO_PI / 5;
      const x = Math.cos(theta) * radius * 0.38;
      const y = Math.sin(theta) * radius * 0.38;
      if (vertex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
    context.fill();

    const patchRadius = radius * 0.3;
    for (let patch = 0; patch < 5; patch += 1) {
      const theta = angle + Math.PI / 2 + patch * TWO_PI / 5;
      const centerX = Math.cos(theta) * radius * 0.86;
      const centerY = Math.sin(theta) * radius * 0.86;
      context.beginPath();
      for (let vertex = 0; vertex < 5; vertex += 1) {
        const vertexTheta = theta + Math.PI + vertex * TWO_PI / 5;
        const x = centerX + Math.cos(vertexTheta) * patchRadius;
        const y = centerY + Math.sin(vertexTheta) * patchRadius;
        if (vertex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
    }
    {
      // 缝合线：从中央五边形顶点射向周边色块，让球面看起来是拼皮的。
      context.strokeStyle = "rgba(32, 36, 43, 0.45)";
      context.lineWidth = Math.max(0.4, radius * 0.05);
      for (let seam = 0; seam < 5; seam += 1) {
        const theta = angle - Math.PI / 2 + seam * TWO_PI / 5;
        context.beginPath();
        context.moveTo(Math.cos(theta) * radius * 0.38, Math.sin(theta) * radius * 0.38);
        context.lineTo(Math.cos(theta) * radius * 0.62, Math.sin(theta) * radius * 0.62);
        context.stroke();
      }
    }
    context.restore();
  }

  function drawSoccerBallShape(context, x, y, radius, angle) {
    context.save();
    context.translate(x, y);
    context.fillStyle = BODY_COLOR;
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.fill();
    drawBallPattern(context, radius, angle);
    context.fillStyle = "rgba(255, 255, 255, 0.55)";
    context.beginPath();
    context.arc(-radius * 0.34, -radius * 0.4, radius * 0.16, 0, TWO_PI);
    context.fill();
    // 自定义本体自己负责描边：与共享渲染环同样的加深系数与 1px 线宽。
    context.strokeStyle = darkenColor(BODY_COLOR);
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.stroke();
    context.restore();
  }

  function drawSoccerGoal(context, goal, time) {
    if (goal.alpha <= EPSILON) return;
    const appear = clamp(goal.age / GOAL_APPEAR_DURATION, 0, 1);
    const eased = 1 - (1 - appear) * (1 - appear);
    const half = goal.halfLength * eased;
    const depth = GOAL_DEPTH * eased;
    if (half <= EPSILON) return;
    context.save();
    context.globalAlpha *= goal.alpha;
    context.translate(goal.x, goal.y);
    context.rotate(goal.angle);

    // 网内底色 + 网格：俯视角下球门向场内探出 GOAL_DEPTH。
    context.fillStyle = "rgba(16, 20, 26, 0.62)";
    context.fillRect(0, -half, depth, half * 2);
    context.strokeStyle = "rgba(226, 234, 244, 0.3)";
    context.lineWidth = 0.45;
    for (let x = 2.5; x < depth; x += 3.5) {
      context.beginPath();
      context.moveTo(x, -half);
      context.lineTo(x, half);
      context.stroke();
    }
    for (let y = -half + 3; y < half; y += 3.5) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(depth, y);
      context.stroke();
    }

    // 门框：后梁与两条侧梁。
    context.strokeStyle = "#97a0ad";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, -half);
    context.lineTo(depth, -half);
    context.lineTo(depth, half);
    context.lineTo(0, half);
    context.stroke();

    // 有效边缘：射进判定的那条线，用脉冲高亮提示“现在能得分”。
    const scoring = !goal.scored && goal.age <= GOAL_ACTIVE_LIFE + EPSILON;
    const pulse = scoring ? 0.78 + 0.22 * Math.sin(time * 7) : 1;
    context.shadowColor = goal.scored ? "#ffffff" : GOAL_ACCENT;
    context.shadowBlur = (goal.scored ? 6 : 4) * pulse;
    context.strokeStyle = goal.scored ? "#ffffff" : (scoring ? GOAL_ACCENT : "#8d8570");
    context.lineWidth = 1.6;
    context.beginPath();
    context.moveTo(0.7, -half);
    context.lineTo(0.7, half);
    context.stroke();
    context.shadowBlur = 0;

    // 门柱：有效边缘两端上的白色小方块。
    context.fillStyle = "#f7f9fc";
    context.strokeStyle = "#6c7480";
    context.lineWidth = 0.8;
    [-half, half].forEach((offset) => {
      context.beginPath();
      context.rect(-1, offset - 1.4, 3, 2.8);
      context.fill();
      context.stroke();
    });
    context.restore();
  }

  function createGoalEntity(placement, hooks) {
    return {
      kind: "soccer-goal",
      life: GOAL_ACTIVE_LIFE + GOAL_FADE_DURATION,
      drawLayer: "background",
      combatKind: "zone",
      length: GOAL_LENGTH,
      halfLength: GOAL_LENGTH / 2,
      edge: placement.edge,
      along: placement.along,
      x: placement.centerX,
      y: placement.centerY,
      x0: placement.x0,
      y0: placement.y0,
      x1: placement.x1,
      y1: placement.y1,
      normalX: placement.normalX,
      normalY: placement.normalY,
      angle: placement.angle,
      scored: false,
      scoredAt: 0,
      alpha: 1,
      update({ entity }) {
        if (entity.scored) {
          entity.alpha = clamp(
            1 - (entity.age - entity.scoredAt) / GOAL_SCORED_FADE_DURATION,
            0,
            1
          );
          return;
        }
        entity.alpha = entity.age + EPSILON < GOAL_ACTIVE_LIFE
          ? 1
          : clamp(
            1 - (entity.age - GOAL_ACTIVE_LIFE) / GOAL_FADE_DURATION,
            0,
            1
          );
        // 过了有效时间就只剩渐隐，不再算射进。
        if (entity.age > GOAL_ACTIVE_LIFE + EPSILON) return;
        hooks.checkContact(entity);
      },
      draw({ entity, game }, context) {
        drawSoccerGoal(context, entity, game && game.time ? game.time : 0);
      }
    };
  }

  const soccerDefinition = {
    id: "soccerBall",
    name: "\u8DB3\u7403",
    englishName: "Soccer Ball",
    color: BODY_COLOR,
    description: "\u5C04\u8FB9\u95E8+3\u4F24\u5BB3 / \u52A0\u901F1.5\u500D\u53EF\u53E0\u52A0",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: GOAL_SPAWN_INTERVAL,
    createBehavior(services) {
      let goalTimer = GOAL_SPAWN_INTERVAL;
      let damageBonus = 0;
      let goalsScored = 0;
      let rollAngle = 0;
      let boostCount = 0;
      let appliedMultiplier = 1;
      let ownerBall = null;
      let trail = null;
      const boostExpiries = [];
      const liveGoals = [];

      function pruneGoals() {
        for (let index = liveGoals.length - 1; index >= 0; index -= 1) {
          const goal = liveGoals[index];
          if (goal.entityActive === false || goal.age >= goal.life) {
            liveGoals.splice(index, 1);
          }
        }
      }

      function spawnGoal(arenaSize) {
        pruneGoals();
        const placement = pickGoalPlacement(arenaSize, liveGoals);
        const entity = services.spawnCombatEntity(
          createGoalEntity(placement, {
            checkContact: (goal) => checkGoalContact(goal)
          }),
          { lifecycle: "owner-bound" }
        );
        if (!entity) return null;
        liveGoals.push(entity);
        services.spawnParticleBurst({
          kind: "soccer-goal-appear",
          x: placement.centerX + placement.normalX * GOAL_DEPTH * 0.5,
          y: placement.centerY + placement.normalY * GOAL_DEPTH * 0.5,
          life: 0.32,
          density: 0.35,
          minDiameter: 1,
          maxDiameter: 3,
          minSpeed: 8,
          maxSpeed: 46,
          initialRadius: 8,
          drag: 3.4,
          colors: [GOAL_ACCENT, "#ffffff"]
        });
        return entity;
      }

      function checkGoalContact(goal) {
        const ball = ownerBall;
        if (!ball || ball.hp <= 0 || goal.scored) return;
        const touch = pointOnSegment(ball.x, ball.y, goal.x0, goal.y0, goal.x1, goal.y1);
        // 本体半径压上有效边缘即算射进。
        if (touch.distance > ball.radius + 1e-6) return;
        scoreGoal(goal, touch.x, touch.y);
      }

      function scoreGoal(goal, contactX, contactY) {
        const ball = ownerBall;
        if (!ball) return;
        goal.scored = true;
        goal.scoredAt = goal.age;
        // 渐隐一结束就回收，不等原本的 3 秒寿命。
        goal.life = goal.age + GOAL_SCORED_FADE_DURATION;
        goalsScored += 1;
        // 伤害增益：本场对决内永久保留，可以叠加。
        damageBonus += GOAL_DAMAGE_BONUS;
        const gameTime = services.getTime();
        boostExpiries.push(gameTime + BOOST_DURATION);
        refreshBoost(ball, gameTime);

        // 彩色礼花：一炸主礼花 + 一路撒落的纸屑，走统一粒子接口。
        services.spawnParticleBurst({
          kind: "soccer-goal-fireworks",
          x: contactX,
          y: contactY,
          life: 0.9,
          density: 1.8,
          minDiameter: 1,
          maxDiameter: 5,
          minSpeed: 60,
          maxSpeed: 190,
          initialRadius: 3,
          drag: 2.2,
          colors: CONFETTI_COLORS,
          ring: {
            color: "#ffffff",
            lineWidth: 2,
            startRadius: 4,
            endRadius: 34
          }
        });
        services.spawnParticleBurst({
          kind: "soccer-goal-confetti",
          x: contactX,
          y: contactY,
          life: 1.35,
          density: 1.1,
          minDiameter: 1,
          maxDiameter: 4,
          minSpeed: 22,
          maxSpeed: 120,
          initialRadius: 6,
          drag: 1.1,
          gravityY: 46,
          colors: CONFETTI_COLORS
        });
        services.spawnHitText(ball, "GOL!", { color: "#fff3b0" });
        services.shakeArena({ intensity: 3.2, duration: 0.09 });
        // 第一片残影落在球门线上，之后交给 emit 的 0.03s 节流。
        emitTrailSample(ball);
      }

      // 加速叠加：每层提供原来的 1.5 倍（即 +0.5 倍基础速度），同屏层数一起结算。
      function refreshBoost(ball, now) {
        for (let index = boostExpiries.length - 1; index >= 0; index -= 1) {
          if (boostExpiries[index] + EPSILON <= now) boostExpiries.splice(index, 1);
        }
        boostCount = boostExpiries.length;
        const multiplier = 1 + boostCount * BOOST_STEP;
        if (Math.abs(multiplier - appliedMultiplier) > EPSILON) {
          appliedMultiplier = multiplier;
          services.setSpeedMultiplier(multiplier);
        }
        if (boostCount === 0) endTrail(false);
        return boostCount;
      }

      // 拖尾走 core 的统一残影接口：句柄自带节流、软收尾与自动回收。
      function emitTrailSample(ball) {
        if (boostCount <= 0) return;
        if (!trail || trail.finished) {
          trail = services.spawnAfterimageTrail({
            kind: "soccer-speed-trail",
            color: BODY_COLOR,
            sampleInterval: TRAIL_SAMPLE_INTERVAL,
            sampleLife: TRAIL_SAMPLE_LIFE,
            maxAlpha: TRAIL_MAX_ALPHA,
            minScale: TRAIL_MIN_SCALE
          }, { lifecycle: "owner-bound" });
        }
        trail.emit(ball.x, ball.y, ball.radius, {
          // heading + speed：残影沿运动方向拉成椭圆，把定间隔的残影连成尾迹。
          heading: Math.atan2(ball.vy, ball.vx),
          speed: Math.hypot(ball.vx, ball.vy)
        });
      }

      // 加速结束只软收尾：停喂新残影，已有的继续渐隐，于是“加速完毕”与
      // “拖尾消失”之间空出 sampleLife（0.25s）的衔接。hard=true 只用于
      // 本体死亡或被复制方收手（Rion），那时不留残余残影。
      function endTrail(hard) {
        if (!trail) return;
        trail.end(hard);
        if (hard) trail = null;
      }

      function clearGoals() {
        pruneGoals();
        for (const goal of liveGoals) goal.entityActive = false;
        liveGoals.length = 0;
      }

      return {
        update(context, dt) {
          ownerBall = context.ball;
          goalTimer = Math.min(GOAL_SPAWN_INTERVAL, goalTimer + Math.max(0, dt));
          refreshBoost(context.ball, context.game.time);
        },
        updateWhilePaused(context) {
          ownerBall = context.ball;
          // 行为被控制时不产球门、不喂残影，但加速计时照常到期。
          refreshBoost(context.ball, context.game.time);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, GOAL_SPAWN_INTERVAL - goalTimer);
        },
        afterUpdateStep(context, dt) {
          const ball = context.ball;
          ownerBall = ball;
          const travelled = Math.hypot(ball.x - ball.prevX, ball.y - ball.prevY);
          if (Number.isFinite(travelled) && travelled < ball.radius * 4) {
            // 纯滚动的角位移（线位移 / 半径）在 150 速度下已达 1.6 圈/秒，
            // 拼皮花纹会糊成闪动，所以视觉自转按 ROLL_SPIN_FACTOR 放慢。
            rollAngle += (travelled / ball.radius) * ROLL_SPIN_FACTOR;
          }

          emitTrailSample(ball);

          if (goalTimer + EPSILON < GOAL_SPAWN_INTERVAL) return;
          goalTimer = 0;
          if (liveGoals.length >= MAX_ACTIVE_GOALS) return;
          spawnGoal(context.game);
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, BASE_COLLISION_DAMAGE + damageBonus);
        },
        getContactProfile() {
          // 有碰撞体积、可被攻击；伤害全部来自 onCollision。
          return { solid: true, attackable: true };
        },
        onDeath() {
          endTrail(true);
          clearGoals();
        },
        onBorrowEnd() {
          endTrail(true);
          clearGoals();
        },
        drawBody(context, canvasContext) {
          const ball = context.ball;
          drawSoccerBallShape(
            canvasContext,
            ball.x,
            ball.y,
            ball.radius,
            rollAngle
          );
          return true;
        },
        getSoccerState() {
          pruneGoals();
          return {
            damageBonus,
            goalsScored,
            boostCount,
            speedMultiplier: appliedMultiplier,
            activeGoals: liveGoals.length,
            rollAngle,
            trailSamples: trail ? trail.sampleCount : 0,
            trailDraining: Boolean(trail) && trail.draining
          };
        }
      };
    }
  };

  registerBall(soccerDefinition);

  return {
    soccerDefinition,
    soccerBalance: {
      BASE_COLLISION_DAMAGE,
      GOAL_DAMAGE_BONUS,
      GOAL_SPAWN_INTERVAL,
      GOAL_LENGTH,
      GOAL_ACTIVE_LIFE,
      GOAL_FADE_DURATION,
      GOAL_SCORED_FADE_DURATION,
      BOOST_STEP,
      BOOST_DURATION,
      TRAIL_SAMPLE_INTERVAL,
      TRAIL_SAMPLE_LIFE,
      TRAIL_MAX_ALPHA,
      TRAIL_MIN_SCALE,
      ROLL_SPIN_FACTOR
    },
    createGoalEntity,
    pickGoalPlacement,
    drawSoccerBallShape,
    drawSoccerGoal
  };
});
