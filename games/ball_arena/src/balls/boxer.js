(function initializeBoxer(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBoxerPlugin({ registerBall, createKnockbackEffect: createSharedKnockback }) {
  const EPSILON = 1e-9;

  // 触发圆环：自身体表向外 30 的环带。判定量的是两个球「体表之间」的距离，
  // 所以圆心距阈值 = 自身半径 + 目标半径 + 30（普通球对普通球 = 15 + 15 + 30 = 60），
  // 比人物体积大得多，才有视频里的连击空间。
  // 目标体积一样算进阈值：会长大的雪球滚到半径 50 时环带跟着涨到 95，
  // 不会出现「明明贴在一起，圆环里却判不到敌人」。
  const RING_WIDTH = 30;
  // 每拳射程 30：同样是自身体表向外 30，圆心距阈值 = 自身半径 + 目标半径 + 30，
  // 和圆环外沿完全重合 —— 踏进圆环的敌人一定在拳程内，不会出现「钉住却打不到」的空档。
  const PUNCH_REACH = 30;
  // 出拳节奏：0.02 秒一拳（实际受 60Hz 帧率限制，约每 2 帧一拳）。
  const PUNCH_INTERVAL = 0.02;

  const PUNCH_DAMAGE = 1;
  const UPPERCUT_DAMAGE = 3;

  // 普通拳的「击退」：0.2 秒僵直，把对手速度钉成它自己朝向的 0.95 倍。
  // 比对手自身速度还慢，推不开人也不让它转向 —— 对手被钉在圆环里，
  // 拳击手自己再触发 10% 减速就能连续出拳。
  const KNOCKBACK_DURATION = 0.2;
  const KNOCKBACK_SPEED_MULTIPLIER = 0.7;
  // 上勾拳击退：0.3 秒、2 倍。
  const UPPERCUT_KNOCKBACK_DURATION = 0.3;
  const UPPERCUT_KNOCKBACK_SPEED_MULTIPLIER = 2;

  // 圆环里有敌人时，拳击手自己把速度降为原本的 10%（出拳时钉在原地），
  // 圆环一空立刻恢复。触发范围是 3/4 圆环：正下方 90 度攻击死角不触发。
  const SLOW_FACTOR = 0.1;

  // 正上方 / 正下方各 90 度扇形。
  const SECTOR_HALF_ANGLE = Math.PI / 4;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 归一化到 (-PI, PI]，便于比较与正上/正下方扇形的夹角。
  function normalizeAngle(angle) {
    let result = angle % (Math.PI * 2);
    if (result > Math.PI) result -= Math.PI * 2;
    if (result <= -Math.PI) result += Math.PI * 2;
    return result;
  }

  // 屏幕坐标 y 向下：正下方 = +90°，正上方 = -90°。
  // 返回 "down"（死角，不出拳）/ "up"（上勾拳）/ "side"（左右普通拳）。
  function sectorOf(deltaX, deltaY) {
    const angle = Math.atan2(deltaY, deltaX);
    const toDown = Math.abs(normalizeAngle(angle - Math.PI / 2));
    if (toDown <= SECTOR_HALF_ANGLE) return "down";
    const toUp = Math.abs(normalizeAngle(angle + Math.PI / 2));
    if (toUp <= SECTOR_HALF_ANGLE) return "up";
    return "side";
  }

  // 圆环减速（作用在拳击手自己身上）直接走 setSpeedMultiplier 服务，而不是短时效果。
  // 短时效果有两个坑：① 效果在被刷新的那一帧若已过期，新实例会把「当前已减速的倍率」
  // 当成新基准，于是 0.2 叠成 0.04、再叠成 0.008；② 旧实例被覆盖时 onExpire 不会执行，
  // 减速就永久留在身上（打 blitz 被眩晕打断刷新后就会复现）。
  // 这里把基准倍率存在行为闭包里，只在「进入圆环」和「外部改过倍率」时重新采样。
  function updateRingSlow(ball, shouldSlow, combatantServices, state) {
    if (!shouldSlow) {
      if (state.baseSpeedMultiplier === null) return;
      combatantServices.setSpeedMultiplier(state.baseSpeedMultiplier);
      state.baseSpeedMultiplier = null;
      state.appliedMultiplier = null;
      return;
    }
    if (state.baseSpeedMultiplier === null) {
      state.baseSpeedMultiplier = ball.speedMultiplier;
    } else if (
      Number.isFinite(state.appliedMultiplier) &&
      Math.abs(ball.speedMultiplier - state.appliedMultiplier) > EPSILON
    ) {
      // 别的球改过倍率：以它为新的基准，不要覆盖别人的减速/加速。
      state.baseSpeedMultiplier = ball.speedMultiplier;
    }
    const multiplier = state.baseSpeedMultiplier * SLOW_FACTOR;
    if (Math.abs(ball.speedMultiplier - multiplier) > EPSILON) {
      combatantServices.setSpeedMultiplier(multiplier);
    }
    state.appliedMultiplier = multiplier;
  }

  // 普通拳初速 0.7 倍，上勾拳 2 倍；共享模块在 duration 内平滑回到正常速度。
  // 共用 id：新一拳刷新方向和时长，免控目标保留自身运动。
  function createKnockbackEffect(directionX, directionY, duration, multiplier) {
    return createSharedKnockback({
      id: "boxer-knockback",
      duration: duration,
      directionX,
      directionY,
      useBaseSpeed: true,
      speedMultiplier: multiplier
    });
  }
  // 出拳视效：左右交替，一拳只画那一侧的拳影，
  // 从拳击手身体那一侧沿「拳击手 → 对手」方向打出去。
  function createPunchAfterimage(ball, angle, side, kind) {
    const uppercut = kind === "uppercut";
    return {
      kind: "boxer-punch-" + kind,
      life: uppercut ? 0.28 : 0.18,
      x: ball.x,
      y: ball.y,
      radius: ball.radius,
      // 出拳朝向：0 弧度 = 正对对手。
      angle,
      side: side >= 0 ? 1 : -1,
      color: ball.color || "#f05a63",
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        const scale = uppercut ? 1.12 : 1;
        const side = effect.side >= 0 ? 1 : -1;
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        // 这一拳只画它那一侧的拳影，沿出拳方向递进、逐渐淡出。
        for (let index = 0; index < 3; index += 1) {
          const alpha = fade * (0.68 - index * 0.17);
          if (alpha <= 0) continue;
          const reach = effect.radius * 0.85 + (index * 7 + progress * 15) * scale;
          const lateral = side * effect.radius * 0.62 * (1 - index * 0.16) * scale;
          const fistRadius = (6.4 - index * 1.1) * scale;
          context.globalAlpha = alpha;
          context.fillStyle = effect.color;
          context.beginPath();
          context.arc(reach, lateral, fistRadius, 0, Math.PI * 2);
          context.fill();
          context.globalAlpha = alpha * 0.6;
          context.fillStyle = "#ffffff";
          context.beginPath();
          context.arc(reach, lateral, Math.max(0.8, fistRadius * 0.38), 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }
    };
  }

  const boxerDefinition = {
    id: "boxer",
    name: "\u62f3\u51fb\u624b",
    englishName: "Boxer",
    color: "#f05a63",
    description: "3/4 圆环 30（直径 90）内有敌人时自身速度 ×0.1 / 左右直拳 1 / 上勾拳 3 / 击退 70% / 正下方死角",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let punchTimer = 0;
      let punchCount = 0;
      // 左右交替出拳：+1 右拳 / -1 左拳。
      let punchSide = 1;
      // 圆环减速的基准倍率（null = 当前没在减速）。
      const slowState = { baseSpeedMultiplier: null, appliedMultiplier: null };
      // 不吃控制的目标（钢卷：getCapabilityOverrides 让 canMove/canAct 恒为 true，
      // 既不吃击退也不吃减速）。拳击手目前只对敌人施加击退，减速只作用在自己身上。
      const controlImmune = new Set();
      let uppercutCount = 0;
      let ringEnemies = 0;
      let anchored = false;

      // 施加击退；目标如果不吃控制（钢卷：getCapabilityOverrides 顶掉移动锁，
      // 因此它既不吃击退也不吃减速），就当场把它的运动还原、记下来，之后不再对它施加。
      function applyKnockback(ball, target, directionX, directionY, duration, multiplier, combatantServices) {
        if (controlImmune.has(target.instanceId)) return;
        const effect = combatantServices.applyEffect(
          target,
          createKnockbackEffect(directionX, directionY, duration, multiplier)
        );
        if (!effect) return;
        const capabilities = combatantServices.getCapabilities(target);
        if (!capabilities || capabilities.canMove !== true) return;
        controlImmune.add(target.instanceId);
        effect.immune = true;
        target.vx = target.storedVx = effect.savedVx;
        target.vy = target.storedVy = effect.savedVy;
        effect.expiresAt = 0;
      }

      function punchAt(ball, target, deltaX, deltaY, distance, sector, context) {
        const combatantServices = context.services || services;
        const magnitude = distance > EPSILON ? distance : 1;
        const directionX = deltaX / magnitude;
        const directionY = deltaY / magnitude;
        const angle = Math.atan2(directionY, directionX);
        punchTimer = PUNCH_INTERVAL;
        punchCount += 1;
        punchSide = -punchSide;

        if (sector === "up") {
          uppercutCount += 1;
          combatantServices.dealDamage(target, UPPERCUT_DAMAGE);
          applyKnockback(
            ball,
            target,
            directionX,
            directionY,
            UPPERCUT_KNOCKBACK_DURATION,
            UPPERCUT_KNOCKBACK_SPEED_MULTIPLIER,
            combatantServices
          );
          combatantServices.spawnVisualEffect(createPunchAfterimage(ball, angle, punchSide, "uppercut"));
          combatantServices.playSound("shoot", { kind: "boxer-uppercut" });
          return;
        }

        combatantServices.dealDamage(target, PUNCH_DAMAGE);
        applyKnockback(
          ball,
          target,
          directionX,
          directionY,
          KNOCKBACK_DURATION,
          KNOCKBACK_SPEED_MULTIPLIER,
          combatantServices
        );
        combatantServices.spawnVisualEffect(createPunchAfterimage(ball, angle, punchSide, "jab"));
        combatantServices.playSound("shoot", { kind: "boxer-jab" });
      }

      return {
        update(context, dt) {
          const { ball } = context;
          const combatantServices = context.services || services;
          if (punchTimer > 0) punchTimer = Math.max(0, punchTimer - dt);
          if (!ball || ball.hp <= 0) return;

          const ringRadius = ball.radius + RING_WIDTH;
          const punchRadius = ball.radius + PUNCH_REACH;
          ringEnemies = 0;

          combatantServices.forEachEnemy((target) => {
            if (!target || target.hp <= 0 || target === ball) return;
            const deltaX = target.x - ball.x;
            const deltaY = target.y - ball.y;
            const distance = Math.hypot(deltaX, deltaY);
            // 环带/拳程都是「自身体表向外」，所以敌人的半径也要算进阈值。
            const bodyRadius = Number.isFinite(target.radius) ? target.radius : 0;
            if (distance <= EPSILON || distance > ringRadius + bodyRadius) return;

            const sector = sectorOf(deltaX, deltaY);
            // 正下方 90 度扇形是攻击死角：不出拳，也不触发钉地。
            // 因此钉地的触发范围是 3/4 圆环。
            if (sector === "down") return;
            ringEnemies += 1;

            if (distance > punchRadius + bodyRadius) return;
            if (punchTimer > EPSILON) return;
            const profile = combatantServices.getContactProfile(target);
            if (!profile || profile.attackable === false) return;
            punchAt(ball, target, deltaX, deltaY, distance, sector, context);
          });

          // 3/4 圆环里有敌人：拳击手把自己钉在原地，自身速度降为 20%。
          anchored = ringEnemies > 0;
          updateRingSlow(ball, anchored, combatantServices, slowState);
        },
        getBoxerState() {
          return {
            punchTimer,
            punchCount,
            punchSide,
            uppercutCount,
            ringEnemies,
            anchored,
            slowMultiplier: slowState.appliedMultiplier,
            ringWidth: RING_WIDTH,
            punchReach: PUNCH_REACH,
            punchInterval: PUNCH_INTERVAL
          };
        }
      };
    }
  };

  registerBall(boxerDefinition);
  return {
    boxerDefinition,
    BOXER_RING_WIDTH: RING_WIDTH,
    BOXER_PUNCH_REACH: PUNCH_REACH,
    BOXER_PUNCH_INTERVAL: PUNCH_INTERVAL,
    BOXER_PUNCH_DAMAGE: PUNCH_DAMAGE,
    BOXER_UPPERCUT_DAMAGE: UPPERCUT_DAMAGE,
    BOXER_KNOCKBACK_DURATION: KNOCKBACK_DURATION,
    BOXER_KNOCKBACK_SPEED_MULTIPLIER: KNOCKBACK_SPEED_MULTIPLIER,
    BOXER_UPPERCUT_KNOCKBACK_DURATION: UPPERCUT_KNOCKBACK_DURATION,
    BOXER_UPPERCUT_KNOCKBACK_SPEED_MULTIPLIER: UPPERCUT_KNOCKBACK_SPEED_MULTIPLIER,
    BOXER_SLOW_FACTOR: SLOW_FACTOR
  };
});
