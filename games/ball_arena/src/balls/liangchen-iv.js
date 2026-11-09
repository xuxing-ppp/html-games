(function initializeLiangchenIV(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js")),
        ...require("../core/contact-model.js"), ...require("../core/arena-geometry.js"),
        ...require("../core/damage-reduction.js"),
        ...require("./liangchen-iii.js"),
        ...require("./hammer-v2.js")
      }
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenIVPlugin(dependencies) {
  "use strict";
  const {
    resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback,
    firstSegmentCircleContact,
    applyDamageReduction,
    createBloodDroplet,
    drawHammer,
    HAMMER_GEOMETRY
  } = dependencies;

  const RULES = Object.freeze({
    bodyDamage: 4,
    dashBodyDamage: 8,
    dashDamageReduction: 0.25,   // 冲刺期：承受伤害×0.25 = 75% 减伤（非冲刺期不减伤）
    dashInterval: 6,             // 6s 一次冲刺
    dashRampUp: 0.4,             // 冲刺：0.4s 加速到 dashSpeed
    dashCruise: 0.2,             //       0.2s 匀速
    dashRampDown: 0.4,           //       0.4s 减速回原速
    dashDuration: 1,             // = 0.4 + 0.2 + 0.4
    dashSpeed: 1000,             // 峰值速度
    auraEffectId: "liangchen-iv-blood-thin",
    auraPeriodScale: 2,             // 攻击周期 +100%
    auraTriggerChanceScale: 0.5,    // 触发型攻击概率减半
    auraRefreshLead: 0.12,       // 每帧刷新到 now+0.12s 之后
    hammerCount: 2,
    hammerAngularOffset: Math.PI,
    // 与六王球E相同的判定体积（不是 hammer-v2 的 50/40/20）
    hammerCenterDistance: 30,
    hammerHeadWidth: 24,
    hammerHeadHeight: 12,
    hammerTriggerDistance: 30,
    hammerIdleRotationPeriod: 1,                               // 1r/s
    hammerAttackRotationPeriod: 0.25,                          // 4r/s（攻击转速）
    hammerSwingWindup: 0.08,                                   // 抡起来到砸中静止锤之间至少转这么久，保证"挥锤"看得见
    hammerSwingGrace: 0.25,                                    // 挥出去之后的收招时间：敌人被撞开也不至于立刻断招
    hammerOrbitRadius: 30,                                     // 锤头到球心距离
    hammerPlacedThreshold: 1.3,                                // 敌离范围 1.3s 后放置
    hammerLaunchSpeed: 700,
    hammerLaunchSelfSpinPeriod: 0.2,                           // 5r/s
    hammerLaunchDuration: 4,
    hammerKnockbackSpeedMultiplier: 1.8,   // 只击退，不眩晕
    hammerDamage: 2,
    hammerHitCooldown: 0.18,                                   // 每锤对同一目标的最小命中间隔
    shieldMaxStack: 30                                          // 护盾上限（防御溢出保护）
  });
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // 血系配色：保留 hammer-v2 结构，换成深血色调
  const BLOOD_HAMMER_PALETTE = Object.freeze({
    outline: "#2a0d0a",
    plate: "#5a1a10",
    plateLight: "#7a2418",
    plateShade: "#4a140c",
    plateBevel: "#8d3020",
    plateRim: "#d94a3c",
    barrelEdge: "#3d0e08",
    barrel: "#960c04",
    barrelLight: "#b8231a",
    barrelMid: "#a11208",
    barrelSeam: "#ff9a8f",
    barrelSeamEdge: "#7a0a06",
    cap: "#c9b9be",
    capFace: "#ddd1d5",
    capSeam: "#6b2631",
    rivet: "#3c2a28",
    rivetHead: "#c9b9be",
    collar: "#3b211f",
    collarRim: "#5c332e",
    lens: "#cfe6ec",
    lensLight: "#eaf6f8",
    lensShade: "#a5c1c8",
    shaft: "#7a3020",
    shaftLight: "#8d4430",
    shaftStripe: "#d94a3c",
    shaftStripeSoft: "#a12315",
    shaftEdge: "#5c1f14",
    metal: "#8d95a2",
    metalDark: "#565c68",
    metalLight: "#c6ccd7",
    swingGlow: "#ff2038",     // 血红色残影光
    shadow: "#3a1510"
  });

  // ---- 吸血光环效果 ----
  // 只携带 attackPeriodScale，不减速。每帧 applyEffect 同 id 刷新 expiresAt。
  function createBloodThinAura() {
    return {
      id: RULES.auraEffectId,
      attackPeriodScale: RULES.auraPeriodScale,
      triggerChanceScale: RULES.auraTriggerChanceScale,
      duration: RULES.auraRefreshLead,   // 每帧刷新；IV 死后自然过期
      visualType: null
    };
  }

  // ---- 血锤拖尾（灭霸大刀同款扫掠缎带：把锤头两端当刃，相邻采样之间铺四边形）----
  const HAMMER_TRAIL_LIFE = 0.3;      // 灭霸是 0.1，这里拉长
  const HAMMER_TRAIL_MAX = 160;       // 灭霸是 48
  const HAMMER_TRAIL_STEP = 0.15;     // 每 0.15rad 补一个采样，高速旋转也不出折角
  const HAMMER_TRAIL_HALF = 22 * (RULES.hammerCenterDistance / 50);  // 锤头半长22 × 0.6
  const HAMMER_TRAIL_INNER = 0.45;    // 缎带只覆盖锤头外侧这一段
  const HAMMER_TRAIL_FILL = "#960c04";
  const HAMMER_TRAIL_EDGE = "#ff4a3a";

  // orbit: 绕体旋转时传 {x, y, radius}，采样按真实圆弧插值（否则高速旋转会被弦切出折角）
  function updateHammerTrail(trail, previous, geometry, dt, emitting, orbit) {
    for (const sample of trail) sample.age += dt;
    while (trail.length && trail[0].age >= HAMMER_TRAIL_LIFE) trail.shift();
    if (!emitting || dt <= 0) return;
    const start = previous || geometry;
    const turn = geometry.angle - start.angle;
    if (Math.abs(turn) > Math.PI) {
      // 换了姿态（放置→飞出/击飞→回收），旧尾巴不连续，重新起一条
      trail.length = 0;
      trail.push({ x: geometry.x, y: geometry.y, angle: geometry.angle, age: 0 });
      return;
    }
    const steps = Math.max(1, Math.ceil(Math.abs(turn) / HAMMER_TRAIL_STEP));
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      const angle = start.angle + turn * progress;
      const x = orbit
        ? orbit.x + Math.cos(angle) * orbit.radius
        : start.x + (geometry.x - start.x) * progress;
      const y = orbit
        ? orbit.y + Math.sin(angle) * orbit.radius
        : start.y + (geometry.y - start.y) * progress;
      trail.push({ x, y, angle, age: dt * (1 - progress) });
    }
    if (trail.length > HAMMER_TRAIL_MAX) trail.splice(0, trail.length - HAMMER_TRAIL_MAX);
  }

  function drawHammerTrail(ctx, trail) {
    if (trail.length < 2) return;
    ctx.save();
    const baseAlpha = ctx.globalAlpha;
    for (let index = 1; index < trail.length; index += 1) {
      const previous = trail[index - 1];
      const current = trail[index];
      const fade = Math.pow(Math.max(0, 1 - current.age / HAMMER_TRAIL_LIFE), 2);
      if (fade <= 0) continue;
      const prevAngle = previous.angle + Math.PI / 2;
      const curAngle = current.angle + Math.PI / 2;
      for (const side of [1, -1]) {
        const a = {
          x: previous.x + Math.cos(prevAngle) * HAMMER_TRAIL_HALF * side,
          y: previous.y + Math.sin(prevAngle) * HAMMER_TRAIL_HALF * side
        };
        const b = {
          x: current.x + Math.cos(curAngle) * HAMMER_TRAIL_HALF * side,
          y: current.y + Math.sin(curAngle) * HAMMER_TRAIL_HALF * side
        };
        const c = {
          x: current.x + Math.cos(curAngle) * HAMMER_TRAIL_HALF * HAMMER_TRAIL_INNER * side,
          y: current.y + Math.sin(curAngle) * HAMMER_TRAIL_HALF * HAMMER_TRAIL_INNER * side
        };
        const d = {
          x: previous.x + Math.cos(prevAngle) * HAMMER_TRAIL_HALF * HAMMER_TRAIL_INNER * side,
          y: previous.y + Math.sin(prevAngle) * HAMMER_TRAIL_HALF * HAMMER_TRAIL_INNER * side
        };
        ctx.globalAlpha = baseAlpha * fade * 0.26;
        ctx.fillStyle = HAMMER_TRAIL_FILL;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = baseAlpha * fade * 0.7;
        ctx.strokeStyle = HAMMER_TRAIL_EDGE;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ---- 血锤击退（只推不晕）----
  // 原来直接用 hammer-v2 的 createHammerDaze：它会 locksMovement/preventsAttack/pausesBehavior 0.75s
  // 并挂眩晕标记。这里只保留位移推力，其余控制一律不给。
  const HAMMER_KNOCKBACK_DISTANCE = 50;    // 与六王球E锤一致的击退距离
  const HAMMER_KNOCKBACK_DURATION = 0.3;

  function createHammerKnockback(directionX, directionY, speedMultiplier) {
    return createSharedKnockback({
      id: "liangchen-iv-hammer-knockback",
      duration: HAMMER_KNOCKBACK_DURATION,
      directionX,
      directionY,
      distance: HAMMER_KNOCKBACK_DISTANCE,
      speedMultiplier: Number.isFinite(speedMultiplier) ? speedMultiplier : 1.8
    });
  }
  // ---- 血锤 Combat Entity ----
  // angularOffset: 0 或 π；angle 每帧自行累计（owner 在场时绕 owner 转）
  // placer: { away: Set<entityId>, hammers: [] }
  //   手里永远至少留 1 柄：任意时刻最多 1 柄离手（放在地上，或被主人挥锤打飞在空中）
  function createBloodHammer(angularOffset, placer) {
    let angle = angularOffset;
    let mode = "held";          // held | placed | flying | returning
    let placedX = 0;
    let placedY = 0;
    let placeDelayTimer = 0;    // 敌出范围计时
    let launchedAt = 0;
    let flyVx = 0;
    let flyVy = 0;
    let spinAngle = angularOffset;  // flying 时自身朝向角（独立于命中方向）
    let attackSpinTime = 0;         // 本次挥锤已转的时长
    let swingGrace = 0;             // 收招剩余时间（敌出范围后仍算这一锤没打完）
    const hitCooldowns = new Map(); // targetId → 剩余冷却秒

    // 引擎会把 definition 拷贝成实体对象，所以这里只能持有"当前真实实体"的引用
    let live = null;
    const trail = [];          // 锤头扫掠拖尾采样
    let prevTrailPoint = null;

    function getHeadCenter(owner) {
      if (mode === "placed") return { x: placedX, y: placedY };
      return {
        x: owner.x + Math.cos(angle) * RULES.hammerCenterDistance,
        y: owner.y + Math.sin(angle) * RULES.hammerCenterDistance
      };
    }

    // 主人手里的另一柄血锤挥中它：静止锤被击飞（飞 hammerLaunchDuration 秒后收回）
    function strikeBySwing(dirX, dirY) {
      if (mode !== "placed") return false;
      const len = Math.hypot(dirX, dirY) || 1;
      flyVx = dirX / len * RULES.hammerLaunchSpeed;
      flyVy = dirY / len * RULES.hammerLaunchSpeed;
      spinAngle = Math.atan2(flyVy, flyVx);
      launchedAt = live ? live.age : 0;
      mode = "flying";
      if (placer.placed && placer.placed.strike === strikeBySwing) placer.placed = null;
      return true;
    }

    return {
      kind: "liangchen-iv-blood-hammer",
      life: 120,
      lifecycle: "owner-bound",
      combatKind: "zone",
      radius: RULES.hammerHeadWidth / 2 + RULES.hammerHeadHeight / 2,   // ~18
      angle,
      angularSpeed: 0,
      ownerInstanceId: null,    // 引擎会填

      update(context, dt) {
        const services = context.services;
        const entity = context.entity;
        const owner = services.getBall(entity.ownerInstanceId);
        live = entity;
        const arena = resolveArenaGeometry(context.game);
        if (!owner || owner.hp <= 0) {
          placer.away.delete(entity.instanceId);
          if (placer.placed && placer.placed.strike === strikeBySwing) placer.placed = null;
          entity.entityActive = false;
          return;
        }

        // 冷却表递减
        for (const [k, v] of hitCooldowns) {
          const nv = v - dt;
          if (nv <= 0) hitCooldowns.delete(k); else hitCooldowns.set(k, nv);
        }

        const prevX = entity.x;
        const prevY = entity.y;
        let angularSpeed = 0;

        // 敌人是否在攻击范围：锤头轨道半径 + 锤头**半对角线** + 敌半径。
        // 之前只用垂直半宽 headWidth/2，且没算敌半径，于是会出现"慢速锤已经撞到敌人、
        // 却没触发高速挥锤"的漏判——锤的扫掠半径是 12+敌半径，敌人可能站在 57 处就被撞到。
        const headHalfDiagonal = Math.hypot(
          RULES.hammerHeadWidth / 2,
          RULES.hammerHeadHeight / 2
        );
        const nearest = services.getOpponent();
        const triggerR = RULES.hammerTriggerDistance + headHalfDiagonal
          + (nearest ? nearest.radius : 0);
        const inRange = nearest
          ? Math.hypot(nearest.x - owner.x, nearest.y - owner.y) <= triggerR
          : false;
        // 主人被控（眩晕/沉默等失去行动能力）时，手里的血锤停转、也不再出伤。
        // 已经飞出去的那柄是独立投射物，照旧飞完。
        const ownerControlled = services.getCapabilities(owner).canAct === false;

        if (mode === "held") {
          const groundReach = RULES.hammerCenterDistance + RULES.hammerHeadWidth
            + RULES.hammerHeadHeight / 2;
          const groundDistance = placer.placed
            ? Math.hypot(placer.placed.x - owner.x, placer.placed.y - owner.y)
            : Infinity;
          // 刚放下时仍在身边，不能立即自动打飞；离开后重新接近才起锤。
          if (placer.placed && groundDistance > groundReach) placer.placed.approachArmed = true;
          const groundInRange = placer.placed && placer.placed.approachArmed
            && groundDistance <= groundReach;
          // 挥锤计时：敌进范围起锤，此后这一锤会走完（收招时间内继续累积）。
          // 不能只在 inRange 时累积——挥起来的锤本身会把敌人撞出范围，那样前摇永远走不完。
          if (inRange || groundInRange) swingGrace = RULES.hammerSwingGrace;
          else swingGrace = Math.max(0, swingGrace - dt);
          const swinging = (inRange || groundInRange || swingGrace > 0) && !ownerControlled;
          if (swinging) attackSpinTime += dt;
          else attackSpinTime = 0;

          // 在体侧旋转；挥锤中高速转，否则慢转；主人被控则完全停转
          const period = swinging
            ? RULES.hammerAttackRotationPeriod
            : RULES.hammerIdleRotationPeriod;
          angularSpeed = ownerControlled ? 0 : TWO_PI / period;
          const previousAngle = angle;
          angle += angularSpeed * dt;
          entity.angle = angle;

          const head = getHeadCenter(owner);
          entity.x = head.x;
          entity.y = head.y;

          // 砸中地上的静止锤：必须真的把锤抡起来了（转速拉起来 + 转够前摇）才可能触发，
          // 否则"敌人刚踏进范围的那一帧"锤子恰好搭在静止锤上就飞了，看起来像自己动的。
          if (swinging
              && attackSpinTime >= RULES.hammerSwingWindup
              && placer.placed) {
            const ground = placer.placed;
            const reach = RULES.hammerHeadWidth
              + RULES.hammerHeadHeight / 2;   // 锤头半径12 + 实体半径18
            // 沿真实圆弧细分扫掠；整帧只连一条弦会漏掉轨道外缘的静止锤。
            const turn = angle - previousAngle;
            const steps = Math.max(1, Math.ceil(Math.abs(turn) / HAMMER_TRAIL_STEP));
            const previousOwnerX = prevX - Math.cos(previousAngle) * RULES.hammerCenterDistance;
            const previousOwnerY = prevY - Math.sin(previousAngle) * RULES.hammerCenterDistance;
            let sweepX = prevX;
            let sweepY = prevY;
            let struck = false;
            for (let step = 1; step <= steps; step += 1) {
              const progress = step / steps;
              const sweepAngle = previousAngle + turn * progress;
              const nextX = previousOwnerX + (owner.x - previousOwnerX) * progress
                + Math.cos(sweepAngle) * RULES.hammerCenterDistance;
              const nextY = previousOwnerY + (owner.y - previousOwnerY) * progress
                + Math.sin(sweepAngle) * RULES.hammerCenterDistance;
              if (firstSegmentCircleContact(
                sweepX, sweepY, nextX, nextY, ground.x, ground.y, reach
              ) !== null) {
                struck = true;
                break;
              }
              sweepX = nextX;
              sweepY = nextY;
            }
            if (struck) {
              let dx = nearest ? nearest.x - ground.x : 0;
              let dy = nearest ? nearest.y - ground.y : 0;
              if (Math.hypot(dx, dy) < 1e-6) {
                // 敌人正好贴着静止锤 → 顺着力道朝球外侧打出去
                dx = ground.x - owner.x;
                dy = ground.y - owner.y;
                if (Math.hypot(dx, dy) < 1e-6) { dx = Math.cos(angle); dy = Math.sin(angle); }
              }
              if (ground.strike(dx, dy)) {
                // 击飞瞬间的血色粒子（沿击飞方向反向喷溅 + 冲击环）
                const burstAngle = Math.atan2(dy, dx);
                services.spawnParticleBurst({
                  kind: "liangchen-iv-hammer-smash",
                  x: ground.x,
                  y: ground.y,
                  count: 24,
                  minDiameter: 1,
                  maxDiameter: 4.5,
                  colors: ["#ff2038", "#960c04", "#ff6a5a"],
                  directionAngle: burstAngle + Math.PI,
                  directionSpread: Math.PI * 0.85,
                  minSpeed: 60,
                  maxSpeed: 200,
                  drag: 3.2,
                  life: 0.42,
                  ring: { color: "#ff4a3a", lineWidth: 1.2, startRadius: 6, endRadius: 28 }
                });
              }
            }
          }

          // 离范围计时 → 放置
          if (!inRange) {
            placeDelayTimer += dt;
            // 只允许一柄锤处于 placed；另一把保持 held 继续触发加速打击
            if (placeDelayTimer >= RULES.hammerPlacedThreshold && placer.away.size === 0) {
              placer.away.add(entity.instanceId);
              mode = "placed";
              placedX = head.x;
              placedY = head.y;
              placer.placed = { x: placedX, y: placedY, strike: strikeBySwing, approachArmed: false };
              entity.x = placedX;
              entity.y = placedY;
              placeDelayTimer = 0;
            }
          } else {
            placeDelayTimer = 0;
          }
        } else if (mode === "placed") {
          entity.x = placedX;
          entity.y = placedY;
          // 锤柄朝上：柄端 pseudo 位于 head 下方 → entity.angle=+π/2 让柄朝正上方
          entity.angle = Math.PI / 2;
          angularSpeed = 0;
          // 静止锤不会自己动：只有被主人手里另一柄血锤挥中（held 分支判定）才会飞出去
        } else if (mode === "flying") {
          angularSpeed = TWO_PI / RULES.hammerLaunchSelfSpinPeriod;
          spinAngle += angularSpeed * dt;
          entity.angle = spinAngle;

          entity.x += flyVx * dt;
          entity.y += flyVy * dt;
          // 供 draw 画飞行拖尾
          entity._flyVx = flyVx;
          entity._flyVy = flyVy;

          // 反弹
          const r = entity.radius;
          const wall = arena.traceSegment(prevX, prevY, entity.x, entity.y, r);
          if (wall) {
            entity.x = wall.x; entity.y = wall.y;
            if (arena.shape !== "circle" && wall.normalX && wall.normalY) { flyVx *= -1; flyVy *= -1; }
            else {
              const dot = flyVx * wall.normalX + flyVy * wall.normalY;
              flyVx -= 2 * dot * wall.normalX; flyVy -= 2 * dot * wall.normalY;
            }
          }

          // 4 秒到期 → 切 returning（寻主回收）
          if (entity.age - launchedAt >= RULES.hammerLaunchDuration) {
            mode = "returning";
          }
        } else if (mode === "returning") {
          angularSpeed = TWO_PI / RULES.hammerLaunchSelfSpinPeriod;
          spinAngle += angularSpeed * dt;
          entity.angle = spinAngle;

          const dx = owner.x - entity.x;
          const dy = owner.y - entity.y;
          const d = Math.hypot(dx, dy) || 1;
          const step = RULES.hammerLaunchSpeed * dt;
          if (d <= step + owner.radius) {
            // 回收 → 回 held（把"离手"名额交还）
            placer.away.delete(entity.instanceId);
            mode = "held";
            angle = Math.atan2(entity.y - owner.y, entity.x - owner.x);
            entity.angle = angle;
          } else {
            entity.x += dx / d * step;
            entity.y += dy / d * step;
          }
        }
        entity.angularSpeed = angularSpeed;
        entity._hammerMode = mode;

        // 拖尾采样：静止锤不画（摆在原地没有扫掠）
        const trailPoint = { x: entity.x, y: entity.y, angle: entity.angle || 0 };
        updateHammerTrail(
          trail, prevTrailPoint, trailPoint, dt, mode !== "placed",
          mode === "held"
            ? { x: owner.x, y: owner.y, radius: RULES.hammerCenterDistance }
            : null
        );
        prevTrailPoint = trailPoint;

        // 命中判定（held/placed/flying 共用扫掠线段）；
        // 被控的主人手里那柄不出伤（地上的静止锤是布置好的陷阱，照旧生效）
        if (mode !== "returning" && !(mode === "held" && ownerControlled)) {
          const hitR = RULES.hammerHeadWidth / 2;
          const hit = services.getFirstEnemyHit(prevX, prevY, entity.x, entity.y, hitR);
          if (hit && !hitCooldowns.has(hit.instanceId)) {
            hitCooldowns.set(hit.instanceId, RULES.hammerHitCooldown);
            services.dealDamage(hit, RULES.hammerDamage);
            // 敌方按伤害量溅血
            placer.spillEnemyBlood(owner, context.game, hit, RULES.hammerDamage);
            // 只击退，不眩晕
            let dirX = hit.x - entity.x;
            let dirY = hit.y - entity.y;
            if (Math.hypot(dirX, dirY) < 1e-6) {
              // 锤心正好压在敌人身上 → 朝挥锤方向推出去
              dirX = Math.cos(entity.angle || 0);
              dirY = Math.sin(entity.angle || 0);
            }
            services.applyEffect(hit, createHammerKnockback(
              dirX, dirY, RULES.hammerKnockbackSpeedMultiplier
            ));
          }
        }
      },

      draw(context, ctx) {
        const entity = context.entity;
        const owner = entity.owner;
        if (!owner) return;
        const ang = entity.angle || angle;
        // 与六王球E同尺寸的锤头：k = 30/50 = 0.6
        const k = RULES.hammerCenterDistance / 50;
        // drawHammer 内部柄按局部坐标画（在它自己的 scale 之前），锤头却按 centerDistance 的世界坐标定位；
        // 所以这里传 visualScale=1，由外层 ctx.scale 统一缩放，柄与锤头才会落在同一坐标系。
        const grip = RULES.hammerCenterDistance / k;   // 局部：握把 → 锤头
        const gripRadius = owner.radius / k;           // 局部：柄从球体边缘起画，不会穿过球心
        const phase = entity._hammerMode === "flying" ? "swing" : "idle";
        drawHammerTrail(ctx, trail);
        ctx.save();
        ctx.translate(entity.x, entity.y);
        ctx.rotate(ang);
        ctx.scale(k, k);
        drawHammer(ctx, { x: -grip, y: 0, radius: gripRadius }, 0, phase, 1, {
          palette: BLOOD_HAMMER_PALETTE,
          centerDistance: grip
        });
        ctx.restore();

        // 击出飞行时的血色拖尾
        if (phase === "swing") {
          const flyVx = entity._flyVx || 0;
          const flyVy = entity._flyVy || 0;
          const flySpeed = Math.hypot(flyVx, flyVy);
          if (flySpeed > 1) {
            const tail = Math.min(30, 12 + flySpeed * 0.02);
            ctx.save();
            ctx.translate(entity.x, entity.y);
            ctx.rotate(Math.atan2(flyVy, flyVx));
            const trail = ctx.createLinearGradient(0, 0, -tail, 0);
            trail.addColorStop(0, "rgba(217,74,60,0.55)");
            trail.addColorStop(0.5, "rgba(160,12,4,0.28)");
            trail.addColorStop(1, "rgba(120,4,20,0)");
            ctx.fillStyle = trail;
            ctx.beginPath();
            ctx.moveTo(-6, -10);
            ctx.lineTo(-tail, -1.2);
            ctx.lineTo(-tail, 1.2);
            ctx.lineTo(-6, 10);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }
      }
    };
  }

  // ---- 球本体定义 ----
  const liangchenIVDefinition = {
    id: "liangchenIV",
    name: "良辰IV",
    englishName: "Liangchen IV",
    color: "#960c04",
    description: "撞人 4 点 / 锤子转得慢 / 6 秒才冲一次 / 挨打会掉血滴，不捡就没了",
    stats: { radius: 15, speed: 150, maxHp: 25 },
    rosterType: "elite",

    createBehavior(services) {
      let shieldHp = 0;
      let dashTimer = RULES.dashInterval;
      let dashRemaining = 0;
      let dashing = false;
      let dashTrail = null;   // 冲刺拖尾（与良辰II同款 afterimage）

      function refreshAura(context) {
        services.forEachEnemy((target) => {
          if (!target || target.hp <= 0) return;
          services.applyEffect(target, {
            ...createBloodThinAura(),
            id: `${RULES.auraEffectId}:${context.ball.instanceId}`
          });
        });
      }

      // 血滴回收（自身血与敌方血共用）：血不满 +1 血，满血转 +1 盾
      function makeDropletReclaim() {
        return (owner, svc) => {
          if (owner.hp < owner.maxHp) {
            owner.hp += 1;
            svc.spawnHitText(owner, "+1", { color: "#ff9a8f" });
          } else {
            shieldHp = Math.min(RULES.shieldMaxStack, shieldHp + 1);
            svc.spawnHitText(owner, "+1", { color: "#9ad6ff" });
          }
        };
      }

      // 敌方溅血：IV 打出的伤害按点数从敌人体内弹出血滴，无数量上限。
      function emitEnemyBloodDroplets(ball, _game, hit, damage) {
        const amount = Math.max(0, Math.round(Number(damage) || 0));
        if (amount <= 0 || !ball || !hit) return;
        for (let i = 0; i < amount; i++) {
          const angle = Math.random() * TWO_PI;
          services.spawnProjectile(createBloodDroplet(
            hit.x + Math.cos(angle) * (hit.radius + 1),
            hit.y + Math.sin(angle) * (hit.radius + 1),
            Math.cos(angle) * 300,
            Math.sin(angle) * 300,
            true,                 // 敌方血
            hit.instanceId,       // 出生宽限：先飞离命中目标
            makeDropletReclaim()
          ));
        }
      }

      // 自身受击喷血：扣了多少伤害就喷多少滴，无数量上限。
      function emitDropletOnHit(ball, damage) {
        const amount = Math.max(0, Math.round(Number(damage) || 0));
        if (amount <= 0) return;
        for (let i = 0; i < amount; i++) {
          const angle = Math.random() * TWO_PI;
          const speed = 300;
          services.spawnProjectile(createBloodDroplet(
            ball.x + Math.cos(angle) * (ball.radius + 1),
            ball.y + Math.sin(angle) * (ball.radius + 1),
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
            false,
            null,
            makeDropletReclaim()
          ));
        }
      }

      function emitDashTrail(ball) {
        if (!dashTrail || dashTrail.finished) return;
        dashTrail.emit(ball.x, ball.y, ball.radius, {
          heading: Math.atan2(ball.vy, ball.vx),
          speed: Math.hypot(ball.vx, ball.vy)
        });
      }

      function endDashTrail() {
        if (dashTrail && !dashTrail.finished) dashTrail.end(true);
        dashTrail = null;
      }

      // 冲刺速度曲线：0.4s 从原速加速到 1000 → 0.2s 匀速 → 0.4s 减速回原速
      function dashSpeedAt(ball, elapsed) {
        const base = Math.max(1, ball.speed);
        const top = RULES.dashSpeed;
        if (elapsed <= 0) return base;
        if (elapsed < RULES.dashRampUp) {
          return base + (top - base) * (elapsed / RULES.dashRampUp);
        }
        if (elapsed < RULES.dashRampUp + RULES.dashCruise) return top;
        const progress = Math.min(
          1, (elapsed - RULES.dashRampUp - RULES.dashCruise) / RULES.dashRampDown
        );
        return top - (top - base) * progress;
      }

      function startDash(ball) {
        dashing = true;
        dashRemaining = RULES.dashDuration;
        // 与良辰II同款冲刺拖尾
        dashTrail = services.spawnAfterimageTrail({
          kind: "liangchen-iv-dash-trail",
          color: "#960c04",
          maxAlpha: 0.5,
          sampleLife: 0.3,
          maxSamples: 20,
          sampleInterval: 0.015,
          speedFloor: ball.speed,
          speedRamp: RULES.dashSpeed - ball.speed
        }, { lifecycle: "owner-bound" });
        const enemy = services.getOpponent();
        const dx = enemy ? enemy.x - ball.x : 1;
        const dy = enemy ? enemy.y - ball.y : 0;
        const d = Math.hypot(dx, dy) || 1;
        ball.storedVx = dx / d * RULES.dashSpeed;
        ball.storedVy = dy / d * RULES.dashSpeed;
        ball.speedNeedsNormalization = true;
        // 起步速度 = 原速，之后每帧按曲线抬升
        services.setSpeedMultiplier(dashSpeedAt(ball, 0) / Math.max(1, ball.speed));
      }

      function stopDash() {
        dashing = false;
        dashRemaining = 0;
        dashTimer = RULES.dashInterval;
        services.setSpeedMultiplier(1);
        endDashTrail();
      }

      return {
        onSpawn(context) {
          const ball = context.ball;
          // 共享状态：away = 离手的锤（地上 or 空中）；placed = 地上那柄的登记（位置 + 击飞入口）
          const placer = { away: new Set(), placed: null, spillEnemyBlood: emitEnemyBloodDroplets };
          for (let i = 0; i < RULES.hammerCount; i++) {
            const offset = i * RULES.hammerAngularOffset;
            const h = createBloodHammer(offset, placer);
            // 出生时定位到当前球边
            h.x = ball.x + Math.cos(offset) * RULES.hammerCenterDistance;
            h.y = ball.y + Math.sin(offset) * RULES.hammerCenterDistance;
            services.spawnCombatEntity(h);
          }
        },

        beforeUpdateStep: refreshAura,
        update(context, dt) {
          const ball = context.ball;


          if (dashing) {
            emitDashTrail(ball);
            dashRemaining -= dt;
            if (dashRemaining <= 0) {
              stopDash();
            } else {
              const elapsed = RULES.dashDuration - dashRemaining;
              services.setSpeedMultiplier(
                dashSpeedAt(ball, elapsed) / Math.max(1, ball.speed)
              );
            }
          } else {
            dashTimer -= dt;
            if (dashTimer <= EPSILON) startDash(ball);
          }
        },
        updateWhilePaused() {},

        getNextTransitionIn() {
          // IV 自己不吃光环 —— 返回它自己的下一事件
          if (dashing) return Math.max(EPSILON, dashRemaining);
          return Math.max(EPSILON, dashTimer);
        },

        onCollision(context, target) {
          const damage = dashing ? RULES.dashBodyDamage : RULES.bodyDamage;
          context.services.dealDamage(target, damage);
          // 敌方按伤害量溅血
          emitEnemyBloodDroplets(context.ball, context.game, target, damage);
        },

        onWallBounce(context) {
          if (!dashing) return;
          const ball = context.ball;
          const enemy = services.getOpponent();
          if (!enemy) return;
          const dx = enemy.x - ball.x;
          const dy = enemy.y - ball.y;
          const d = Math.hypot(dx, dy) || 1;
          ball.storedVx = dx / d * RULES.dashSpeed;
          ball.storedVy = dy / d * RULES.dashSpeed;
          ball.speedNeedsNormalization = true;
          // 速度大小仍由冲刺曲线每帧决定，这里只换朝向
        },

        onBeforeDamage(context, event) {
          // 冲刺期 75% 减伤，走游戏统一约定（core/damage-reduction.js）：
          // 减免后 ≥1 的部分取整，不足 1 的余数按概率扣 1 点，而不是留小数。
          // 非冲刺期不减伤。
          let resolution = event;
          if (dashing) {
            resolution = applyDamageReduction(
              event, 1 - RULES.dashDamageReduction, Math.random
            );
          }
          if (resolution.amount <= 0 || resolution.showHitText === false) {
            return resolution;
          }
          if (shieldHp > 0) {
            const absorbed = Math.min(shieldHp, resolution.amount);
            shieldHp -= absorbed;
            const rest = resolution.amount - absorbed;
            if (rest <= 0) return { amount: 0, showHitText: false };
            return { ...resolution, amount: rest };
          }
          return resolution;
        },

        onDamaged(context, event) {
          emitDropletOnHit(context.ball, event && event.amount);
        },

        getHpDisplay() {
          return shieldHp > 0 ? { shield: shieldHp } : {};
        },

        onBorrowEnd() {
          shieldHp = 0;
          dashing = false;
          dashRemaining = 0;
          dashTimer = RULES.dashInterval;
          services.setSpeedMultiplier(1);
          endDashTrail();
        },

        onDeath() {
          shieldHp = 0;
          dashing = false;
          services.setSpeedMultiplier(1);
          endDashTrail();
        },

        getLiangchenIVState() {
          return { shieldHp, dashing, dashRemaining, dashTimer };
        }
      };
    }
  };

  registerBall(liangchenIVDefinition);
  return {
    liangchenIVDefinition,
    LIANGCHEN_IV_RULES: RULES,
    BLOOD_HAMMER_PALETTE,
    // 拖尾采样/绘制对外暴露，便于单测直接验证缎带
    updateHammerTrail,
    drawHammerTrail,
    HAMMER_TRAIL_LIFE
  };
});
