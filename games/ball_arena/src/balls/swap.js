(function initializeSwap(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSwapPlugin(dependencies) {
  "use strict";

  const { registerBall } = dependencies;

  const EPSILON = 1e-9;
  // 首次/无候选等 6 秒；成功后原身 3 秒 / 交换 3 秒交替。两段按战场时间计，
  // 因此时停演出耗掉的时间不会被从周期里扣掉。
  const SELF_DURATION = 3;
  const CYCLE_DURATION = 6;
  const SWAPPED_DURATION = 3;
  // 一次换位演出：画面逐渐慢下来 -> 双方消解成拖尾圆点互换位置 -> 逐渐加速回原速。
  const SLOW_DURATION = 0.4;
  const DOTS_DURATION = 0.75;
  const RESUME_DURATION = 0.4;
  const DOTS_START = SLOW_DURATION;
  const DOTS_END = SLOW_DURATION + DOTS_DURATION;
  const ANIMATION_DURATION = DOTS_END + RESUME_DURATION;
  // 换位弧是 45° 的圆弧：弦长决定半径，因此半径天然随双方距离缩放。
  const ARC_HALF_ANGLE = Math.PI / 8;
  const ARC_ALPHA = 0.22;
  // 消解出来的粒子：每颗都有自己的出发延迟、速度、轨迹弯曲与尺寸，各自带一条
  // 锥形拖尾——不是"一圈点整体平移"。
  const PARTICLES_PER_STREAM = 42;
  const PARTICLE_DELAY_MAX = 0.32;
  const PARTICLE_ARRIVAL_MIN = 0.82;
  const PARTICLE_BOW = 12;
  const PARTICLE_SIZE_MIN = 1.1;
  const PARTICLE_SIZE_MAX = 3;
  const PARTICLE_TAIL_STEP = 0.05 / 0.75;
  const PARTICLE_TAIL_MAX = 26;
  const PASSIVE_EFFECT_ID = "swap-passive";
  // 交换球自己不带任何攻击手段：镜像对局里借过来也还是一套没有攻击的套件
  // （和莉音 RECURSIVE_IDS 同一条思路——不嵌套借用）。
  const NON_ATTACK_KITS = new Set(["swap"]);
  // 交换期借来的攻击：只转发攻击与表现相关的钩子，防守和身份仍然属于本体自己。
  const FORWARDED_HOOKS = Object.freeze([
    "beforeUpdateStep", "update", "updateWhilePaused",
    "afterUpdateStep", "afterUpdateStepWhilePaused",
    "getNextTransitionIn", "getNextPausedTransitionIn", "onCollision", "onContactUpdate", "onEntityCollision", "onWallBounce",
    "getTimeControl", "getTimeDilation", "getNextTimeControlTransitionIn", "getTimeSkipRemaining", "updatePresentation",
    "onArenaWrap", "onDamaged", "onDamageObserved", "onEnemyProjectileSpawned", "getPrescribedMotion",
    "drawArenaBackground", "drawArenaForeground", "drawBefore", "drawAfter", "getRenderOffset"
  ]);

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  // 稳定散布：圆点的偏移只由序号决定，同一次演出逐帧一致（不会抖成噪点）。
  function scatter(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
  }

  function isControlEffect(effect) {
    return Boolean(effect && (
      effect.visualType === "stun" ||
      effect.locksMovement === true ||
      effect.pausesBehavior === true ||
      effect.preventsAttack === true ||
      effect.blocksDamageOutput === true ||
      effect.sealsAbilities === true
    ));
  }

  // 45° 圆弧：圆心在弦的另一侧，弧凸向 side 那一面。两条弧各占一侧即互不重叠。
  function createArc(from, to, side) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const chord = Math.hypot(dx, dy);
    if (!Number.isFinite(chord) || chord <= EPSILON) return null;
    const radius = chord / (2 * Math.sin(ARC_HALF_ANGLE));
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const normalX = -dy / chord;
    const normalY = dx / chord;
    const apothem = radius * Math.cos(ARC_HALF_ANGLE);
    const centerX = midX - normalX * apothem * side;
    const centerY = midY - normalY * apothem * side;
    const startAngle = Math.atan2(from.y - centerY, from.x - centerX);
    const endAngle = Math.atan2(to.y - centerY, to.x - centerX);
    let delta = endAngle - startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < EPSILON) return null;
    return {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      centerX, centerY, radius, startAngle, delta, side
    };
  }

  function pointOnArc(arc, t) {
    const angle = arc.startAngle + arc.delta * t;
    return {
      x: arc.centerX + Math.cos(angle) * arc.radius,
      y: arc.centerY + Math.sin(angle) * arc.radius,
      normalX: Math.cos(angle),
      normalY: Math.sin(angle)
    };
  }

  const swapDefinition = {
    id: "swap",
    name: "交换",
    englishName: "Swap",
    color: "#2fbf8f",
    description: "每 6 秒与最近攻击过自己的敌方交换归属 3 秒 / 换位演出期间对战时间静止 / 交换后本体用敌方的攻击节奏反打，敌方只能被动承受（优先于眩晕）",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let owner = null;
      let phase = "self";              // self 原身 / swapped 交换中
      let deadline = 0;                // 当前阶段的结束时刻（战场时间）
      let attackers = [];              // 最近造成过伤害的敌方单位，最新在前
      let partner = null;              // 交换中的敌方本体
      let animation = null;            // { kind, partner, startedAt, applied, captured, upper, geometry }
      let borrow = null;               // 借来的敌方攻击套件
      let passiveEffect = null;        // 敌方身上的"被动"效果
      let hiddenPartner = null;        // 演出期间被藏起来的敌方本体
      let speeds = null;               // 交换前后的速度属性/自身倍率（收场时还原）
      let retired = false;
      let passiveId = PASSIVE_EFFECT_ID;

      function own(context) {
        if (!owner && context && context.ball) {
          owner = context.ball;
          passiveId = `${PASSIVE_EFFECT_ID}:${owner.instanceId}`;
        }
        return owner;
      }

      function aliveBall(ball) {
        return Boolean(ball && ball.hp > 0 && ball.active !== false &&
          services.getBall(ball.instanceId) === ball);
      }

      // ---------------------------------------------------------------- 攻击者记录

      function ballFor(source) {
        if (!source || typeof source !== "object") return null;
        if (typeof source.instanceId !== "string" || !source.instanceId) return null;
        const ball = services.getBall(source.instanceId);
        if (!ball) return null;
        // 召唤物/子弹的账记在它的主人头上：交换的对象始终是一位敌方本体。
        let candidate = ball;
        const visited = new Set();
        while (candidate && candidate.isSummon && !visited.has(candidate)) {
          visited.add(candidate);
          candidate = services.getBall(candidate.summonerInstanceId);
        }
        return candidate && !candidate.isSummon ? candidate : null;
      }

      function rememberAttacker(event) {
        if (!event || !owner) return;
        const candidate = ballFor(event.credit) || ballFor(event.owner) || ballFor(event.actor);
        if (!candidate || candidate === owner) return;
        if (!services.isEnemy(candidate)) return;
        attackers = attackers.filter((entry) => aliveBall(entry.ball) && entry.instanceId !== candidate.instanceId);
        attackers.unshift({ instanceId: candidate.instanceId, ball: candidate });
      }

      // 最新造成伤害的敌方单位优先；它已经退场就顺延到下一个候选。
      function pickTarget() {
        for (const entry of attackers) {
          const ball = entry.ball;
          if (!ball || ball.isSummon) continue;
          if (aliveBall(ball) && services.isEnemy(ball) && services.canBorrowAttack(ball)) return ball;
        }
        return null;
      }

      // ---------------------------------------------------------------- 交换内容

      function swapMotion(left, right) {
        const fields = [
          "x", "y", "prevX", "prevY", "vx", "vy", "storedVx", "storedVy",
          // 弹跳/陀螺模式的姿态记录跟着速度一起走，否则换位后会被判成"刚转向"。
          "bounceVelocityInitialized", "bounceHorizontalSpeedRandomized",
          "bounceLastStoredVx", "bounceLastStoredVy", "gyroLastStoredVx", "gyroLastStoredVy"
        ];
        for (const field of fields) {
          const value = left[field];
          left[field] = right[field];
          right[field] = value;
        }
      }

      function swapControlEffects(left, right) {
        services.exchangeEffects(left, right, (effect) => (
          isControlEffect(effect) && effect.sealsAbilities !== true && effect.id !== passiveId
        ));
      }

      function applyPassive(target) {
        passiveEffect = services.applyEffect(target, {
          id: passiveId,
          // Release owns the end of the lease, including the return animation.
          duration: SWAPPED_DURATION + ANIMATION_DURATION * 2,
          pausesBehavior: true,
          preventsAttack: true,
          blocksDamageOutput: true,
          blocksOwnedEntityDamage: true,
          forceCapabilities: { canAct: false, canBodyAttack: false, canDealDamage: false }
        }, null);
        return passiveEffect;
      }

      function clearPassive(target) {
        if (target && target.effects.get(passiveId) === passiveEffect) {
          services.clearEffect(target, passiveId);
        }
        passiveEffect = null;
      }

      // The engine lends the existing instance, including its closure state.
      // Calling createBehavior/onSpawn here would reset growth and cooldowns.
      function startBorrow(context, target) {
        borrow = NON_ATTACK_KITS.has(target.id) ? null : services.borrowAttack(target);
        return Boolean(borrow) || NON_ATTACK_KITS.has(target.id);
      }

      function finishBorrow() {
        const previous = borrow;
        borrow = null;
        if (previous) previous.release();
      }

      function forwardBorrowed(name, context, ...args) {
        return borrow ? borrow.invoke(name, context, ...args) : undefined;
      }

      // ---------------------------------------------------------------- 演出与状态机

      function livePartner() {
        const target = animation ? animation.partner : partner;
        return aliveBall(target) ? target : null;
      }

      function swallowedByBattle() {
        // 敌方全灭：战斗即将结束，不再补一段换回演出，直接收场。
        return services.getEnemies().length === 0;
      }

      function buildGeometry(upper) {
        if (!owner || !animation) return null;
        const target = animation.partner;
        if (!target) return null;
        if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
        const from = { x: owner.x, y: owner.y };
        const to = { x: target.x, y: target.y };
        // 两条弧用同一个 side：方向相反，因此凸向也相反——互不重叠。
        const side = upper ? 1 : -1;
        return {
          selfArc: createArc(from, to, side),
          partnerArc: createArc(to, from, side)
        };
      }

      function dissolved() {
        if (!animation || !animation.captured) return false;
        const elapsed = services.getClockTime() - animation.startedAt;
        return elapsed >= DOTS_START && elapsed < DOTS_END;
      }

      // 消解只对还活着的伙伴做：已经退场的身体归死亡淡出管，别去动它的淡出。
      function hidePartner() {
        const target = animation && animation.partner;
        if (!target || hiddenPartner === target || !aliveBall(target)) return;
        hiddenPartner = target;
        target.fade = 0;
      }

      function showPartner() {
        if (hiddenPartner) {
          if (hiddenPartner.diedAt === null) hiddenPartner.fade = 1;
          hiddenPartner = null;
        }
      }

      function releaseAnimation() {
        showPartner();
        animation = null;
      }

      function applySwap(context) {
        const target = animation.partner;
        if (!aliveBall(target) || !services.canBorrowAttack(target)) return false;
        speeds = {
          owner: owner.speed,
          partner: target.speed,
          ownerMultiplier: owner.speedMultiplierBase,
          partnerMultiplier: target.speedMultiplierBase,
          movementLocked: owner.movementLocked,
          positionLocked: owner.positionLocked
        };
        swapMotion(owner, target);
        owner.speed = speeds.partner;
        target.speed = speeds.owner;
        if (!startBorrow(context, target)) {
          swapMotion(owner, target);
          owner.speed = speeds.owner;
          target.speed = speeds.partner;
          speeds = null;
          return false;
        }
        swapControlEffects(owner, target);
        applyPassive(target);
        partner = target;
        return true;
      }

      function undoSwap(context) {
        const target = animation ? animation.partner : partner;
        if (!target) return;
        clearPassive(target);
        // 控制状态再搬一次就回到原本的归属；位置与速度同样换回去。
        swapControlEffects(owner, target);
        swapMotion(owner, target);
        finishBorrow(context);
        if (speeds) {
          owner.speed = speeds.owner;
          target.speed = speeds.partner;
          // 自身倍率走 services（绑定在本体上），敌方的倍率直接写字段——
          // 它的合成结果由引擎每帧的 refreshSpeedMultiplier 统一落地。
          services.setSpeedMultiplier(speeds.ownerMultiplier);
          services.setMovementLocked(speeds.movementLocked);
          owner.positionLocked = speeds.positionLocked;
          if (Number.isFinite(speeds.partnerMultiplier) && speeds.partnerMultiplier > 0) {
            target.speedMultiplierBase = speeds.partnerMultiplier;
          }
          speeds = null;
        }
        partner = null;
      }

      function finishAnimation(context) {
        const kind = animation.kind;
        showPartner();
        animation = null;
        if (kind === "out") {
          phase = "swapped";
        } else {
          phase = "self";
          partner = null;
        }
        deadline = services.getTime() + (kind === "out" ? SWAPPED_DURATION : SELF_DURATION);
      }

      function startAnimation(kind, target) {
        if (!target) return false;
        // 出去换位必须有一个活着的对手；换回来只要求那具身体还在场上。
        if (kind === "out" && !aliveBall(target)) return false;
        const seed = Math.random() * 1000;
        animation = {
          kind,
          partner: target,
          startedAt: services.getClockTime(),
          applied: false,
          captured: false,
          // 上/下弧随机分派：两条弧分处连线两侧，因此互不重叠。
          upper: Math.random() < 0.5,
          geometry: null,
          particles: {
            self: buildParticles(seed, owner.radius, target.radius),
            partner: buildParticles(seed + 3.7, target.radius, owner.radius)
          }
        };
        return true;
      }

      function resolveImmediately(context) {
        if (partner || (animation && animation.applied)) undoSwap(context);
        releaseAnimation();
        phase = "self";
        partner = null;
        deadline = services.getTime() + SELF_DURATION;
      }

      function advanceAnimation(context) {
        const elapsed = services.getClockTime() - animation.startedAt;
        if (!animation.captured) {
          // 慢下来的这一段：弧线跟着双方的实时位置长出来。
          animation.geometry = buildGeometry(animation.upper);
          if (elapsed >= DOTS_START) {
            // 消解瞬间定格：之后世界是静止的，圆点就沿这两点之间的弧走。
            animation.captured = true;
            hidePartner();
          }
        }
        if (!animation.applied && elapsed >= DOTS_END) {
          if (animation.kind === "out" && !aliveBall(animation.partner)) {
            // 目标在演出途中退场：本次交换作废，直接收场。
            releaseAnimation();
            phase = "self";
            deadline = services.getTime() + SELF_DURATION;
            return;
          }
          if (animation.kind === "out" && !applySwap(context)) {
            releaseAnimation();
            phase = "self";
            deadline = services.getTime() + CYCLE_DURATION;
            return;
          }
          else if (animation.kind === "back") undoSwap(context);
          animation.applied = true;
          // 两具本体在换位落地那一刻同时显形：消解只覆盖圆点互换的那一段。
          showPartner();
        }
        if (elapsed >= ANIMATION_DURATION) finishAnimation(context);
      }

      function tick(context, dt) {
        if (retired || !owner || owner.hp <= 0) return;
        if (animation) {
          advanceAnimation(context);
        } else if (phase === "self") {
          if (services.getTime() + EPSILON >= deadline) {
            const target = pickTarget();
            if (!startAnimation("out", target)) {
              // 没有可交换的候选：本轮跳过，计时重来。
              deadline = services.getTime() + CYCLE_DURATION;
            }
          }
        } else if (services.getTime() + EPSILON >= deadline || !livePartner()) {
          if (!livePartner() && swallowedByBattle()) resolveImmediately(context);
          else if (!startAnimation("back", partner)) resolveImmediately(context);
        }
      }

      // ---------------------------------------------------------------- 渲染

      function drawArcPath(canvasContext, arc, color, alpha) {
        if (!arc || alpha <= 0) return;
        canvasContext.save();
        try {
          canvasContext.globalAlpha *= alpha;
          canvasContext.strokeStyle = color;
          canvasContext.lineWidth = 1.5;
          if (typeof canvasContext.setLineDash === "function") canvasContext.setLineDash([]);
          canvasContext.beginPath();
          const steps = 24;
          for (let index = 0; index <= steps; index += 1) {
            const point = pointOnArc(arc, index / steps);
            if (index === 0) canvasContext.moveTo(point.x, point.y);
            else canvasContext.lineTo(point.x, point.y);
          }
          canvasContext.stroke();
        } finally {
          canvasContext.restore();
        }
      }

      function discOffset(seedA, seedB, radius) {
        // 圆面内均匀取点：角度随机、半径按 sqrt 分布。
        const angle = scatter(seedA) * Math.PI * 2;
        const distance = Math.sqrt(scatter(seedB)) * radius;
        return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
      }

      // 每颗粒子一副自己的参数：从本体圆面里的某一点出发、落在交换位圆面里的某一点，
      // 出发时刻 / 各自速度 / 轨迹弯曲 / 尺寸都不同。
      function buildParticles(seed, sourceRadius, targetRadius) {
        const particles = [];
        let lastArrival = 0;
        for (let index = 0; index < PARTICLES_PER_STREAM; index += 1) {
          const from = discOffset(seed + index * 7.13, seed + index * 4.31, sourceRadius);
          const to = discOffset(seed + index * 11.37, seed + index * 9.19, targetRadius);
          const arrival = PARTICLE_ARRIVAL_MIN +
            scatter(seed + index * 3.71) * (1 - PARTICLE_ARRIVAL_MIN);
          lastArrival = Math.max(lastArrival, arrival);
          particles.push({
            startX: from.x,
            startY: from.y,
            endX: to.x,
            endY: to.y,
            arrival,
            delay: 0,
            bow: (scatter(seed + index * 13.9) - 0.5) * 2 * PARTICLE_BOW,
            size: PARTICLE_SIZE_MIN +
              scatter(seed + index * 2.31) * (PARTICLE_SIZE_MAX - PARTICLE_SIZE_MIN),
            alpha: 0.5 + scatter(seed + index * 5.19) * 0.5
          });
        }
        // 归一化：最后一颗粒子正好在圆点段收尾时落位，早到的先落、晚到的还在飞。
        for (const particle of particles) {
          particle.arrival /= lastArrival;
          const delay = scatter(seed + particle.size * 97 + particle.bow) * PARTICLE_DELAY_MAX;
          particle.delay = Math.min(delay, particle.arrival - 0.25);
          particle.pace = particle.arrival - particle.delay;
        }
        return particles;
      }

      // 一粒子的位置：沿 45° 弧走自己的行程，起点与终点分别是两个圆面里的随机点。
      function particlePoint(arc, particle, progress) {
        if (progress < particle.delay) return null;
        const travel = clamp01((progress - particle.delay) / particle.pace);
        const base = pointOnArc(arc, travel);
        const toward = travel * travel * (3 - 2 * travel);
        const bell = Math.sin(Math.PI * travel);
        return {
          x: base.x +
            particle.startX * (1 - toward) + particle.endX * toward +
            base.normalX * particle.bow * bell,
          y: base.y +
            particle.startY * (1 - toward) + particle.endY * toward +
            base.normalY * particle.bow * bell,
          travel
        };
      }

      function drawParticleStream(canvasContext, arc, color, particles, progress, alpha) {
        if (!arc || !particles || particles.length === 0 || alpha <= 0) return;
        canvasContext.save();
        try {
          canvasContext.fillStyle = color;
          for (const particle of particles) {
            const head = particlePoint(arc, particle, progress);
            if (!head) continue;
            const fadeIn = Math.min(1, head.travel / 0.12);
            const fadeOut = head.travel > 0.82 ? 1 - (head.travel - 0.82) / 0.18 : 1;
            const particleAlpha = alpha * particle.alpha * clamp01(fadeIn) * clamp01(fadeOut);
            if (particleAlpha <= 0.02) continue;
            canvasContext.globalAlpha = particleAlpha;
            // 拖尾是这颗粒子自己的速度方向与长度：回看它自己的轨迹一小段。
            const tail = particlePoint(
              arc, particle, Math.max(particle.delay, progress - PARTICLE_TAIL_STEP)
            );
            if (tail) {
              const dx = head.x - tail.x;
              const dy = head.y - tail.y;
              const length = Math.hypot(dx, dy);
              if (length > 1.5) {
                const scale = Math.min(length, PARTICLE_TAIL_MAX) / length;
                const normalX = -dy / length;
                const normalY = dx / length;
                const halfWidth = Math.max(0.5, particle.size * 0.8);
                canvasContext.beginPath();
                canvasContext.moveTo(head.x + normalX * halfWidth, head.y + normalY * halfWidth);
                canvasContext.lineTo(head.x - normalX * halfWidth, head.y - normalY * halfWidth);
                canvasContext.lineTo(head.x - dx * scale, head.y - dy * scale);
                canvasContext.closePath();
                canvasContext.fill();
              }
            }
            canvasContext.beginPath();
            canvasContext.arc(head.x, head.y, particle.size, 0, Math.PI * 2);
            canvasContext.fill();
          }
        } finally {
          canvasContext.restore();
        }
      }

      function drawSwapAnimation(canvasContext) {
        if (!animation || !owner || !canvasContext || !animation.geometry) return;
        const elapsed = services.getClockTime() - animation.startedAt;
        if (elapsed < 0) return;
        const target = animation.partner;
        const selfColor = owner.color;
        const partnerColor = target && target.color ? target.color : "#ffffff";
        let pathAlpha = ARC_ALPHA;
        let dotAlpha = 1;
        if (elapsed < DOTS_START) {
          pathAlpha *= clamp01(elapsed / SLOW_DURATION);
          dotAlpha = 0;
        } else if (elapsed >= DOTS_END) {
          const fade = 1 - clamp01((elapsed - DOTS_END) / RESUME_DURATION);
          pathAlpha *= fade;
          dotAlpha = fade;
        }
        const geometry = animation.geometry;
        const progress = clamp01((elapsed - DOTS_START) / DOTS_DURATION);
        drawArcPath(canvasContext, geometry.selfArc, selfColor, pathAlpha);
        drawArcPath(canvasContext, geometry.partnerArc, partnerColor, pathAlpha);
        if (dotAlpha > 0) {
          drawParticleStream(canvasContext, geometry.selfArc, selfColor,
            animation.particles.self, progress, dotAlpha);
          drawParticleStream(canvasContext, geometry.partnerArc, partnerColor,
            animation.particles.partner, progress, dotAlpha);
        }
      }

      // ---------------------------------------------------------------- 行为接口

      const behavior = {
        onSpawn(context) {
          own(context);
          phase = "self";
          deadline = services.getTime() + CYCLE_DURATION;
        },

        beforeUpdateStep(context) {
          own(context);
          forwardBorrowed("beforeUpdateStep", context);
        },

        update(context, dt) {
          // 交换与回归的节拍都按战场时间走：时停期间 game.time 不动，周期因此
          // 不会被演出时间扣掉。
          own(context);
          tick(context, dt);
          forwardBorrowed("update", context, dt);
        },

        updateWhilePaused(context, dt) {
          // 优先于眩晕：本体被眩晕/冻结时，交换的节拍与演出照常推进。
          own(context);
          tick(context, dt);
          forwardBorrowed("updateWhilePaused", context, dt);
        },

        updatePresentation(context, dt) {
          if (animation) advanceAnimation(context);
          else forwardBorrowed("updatePresentation", context, dt);
        },

        onAbilitySealed(context) {
          resolveImmediately(context);
        },

        onBattleEnd(context) {
          resolveImmediately(context);
        },

        onBattleDispose(context) {
          resolveImmediately(context);
        },

        afterUpdateStep(context, dt) {
          forwardBorrowed("afterUpdateStep", context, dt);
        },

        afterUpdateStepWhilePaused(context, dt) {
          forwardBorrowed("afterUpdateStepWhilePaused", context, dt);
        },

        // 世界时间缩放：演出期间把整场对战的时间拉慢到停住，演出自己走实时时钟。
        getTimeControl(context) {
          // The exchange cinematic is an all-world freeze, never a borrowed
          // caster's self-exempt stop. Once settled, the live kit owns time.
          if (animation) return { scale: behavior.getTimeDilation(context) };
          return forwardBorrowed("getTimeControl", context);
        },
        getTimeSkipRemaining(context) {
          return animation ? undefined : forwardBorrowed("getTimeSkipRemaining", context);
        },

        getNextTimeControlTransitionIn(context) {
          if (!animation) return forwardBorrowed("getNextTimeControlTransitionIn", context);
          const elapsed = services.getClockTime() - animation.startedAt;
          const boundary = [DOTS_START, DOTS_END, ANIMATION_DURATION]
            .find((at) => at - elapsed > EPSILON);
          return boundary === undefined ? undefined : boundary - elapsed;
        },

        getTimeDilation(context) {
          if (!animation) {
            const borrowed = forwardBorrowed("getTimeDilation", context);
            return borrowed === undefined ? 1 : borrowed;
          }
          const elapsed = services.getClockTime() - animation.startedAt;
          if (!Number.isFinite(elapsed) || elapsed < 0) return 1;
          if (elapsed >= ANIMATION_DURATION) return 1;
          if (elapsed >= DOTS_START && elapsed < DOTS_END) return 0;
          if (elapsed < DOTS_START) {
            // 画面逐渐慢下来
            return 0.5 + 0.5 * Math.cos(Math.PI * clamp01(elapsed / SLOW_DURATION));
          }
          // 画面逐渐加速回原速
          return 0.5 - 0.5 * Math.cos(
            Math.PI * clamp01((elapsed - DOTS_END) / RESUME_DURATION)
          );
        },

        getNextTransitionIn(context) {
          const borrowed = forwardBorrowed("getNextTransitionIn", context);
          const own = animation ? Infinity : Math.max(EPSILON, deadline - services.getTime()) /
            services.getAttackPeriodScale();
          const candidates = [borrowed, own]
            .filter((value) => Number.isFinite(value) && value > EPSILON);
          if (!candidates.length) return undefined;
          return Math.min(...candidates);
        },

        getNextPausedTransitionIn(context) {
          const borrowed = forwardBorrowed("getNextPausedTransitionIn", context);
          const own = animation ? Infinity : Math.max(EPSILON, deadline - services.getTime()) /
            services.getAttackPeriodScale();
          const boundary = Math.min(own, Number.isFinite(borrowed) && borrowed > EPSILON ? borrowed : Infinity);
          return Number.isFinite(boundary) ? boundary : undefined;
        },

        onDamaged(context, event) {
          forwardBorrowed("onDamaged", context, event);
        },

        onDamageObserved(context, event) {
          rememberAttacker(event);
          forwardBorrowed("onDamageObserved", context, event);
        },

        getPrescribedMotion(context) {
          return forwardBorrowed("getPrescribedMotion", context);
        },

        onEntityCollision(context) {
          return forwardBorrowed("onEntityCollision", context);
        },
        onCollision(context, target) {
          return forwardBorrowed("onCollision", context, target);
        },

        onContactUpdate(context, target, dt) {
          return forwardBorrowed("onContactUpdate", context, target, dt);
        },

        onWallBounce(context) {
          return forwardBorrowed("onWallBounce", context);
        },

        onArenaWrap(context) {
          return forwardBorrowed("onArenaWrap", context);
        },

        onEnemyProjectileSpawned(context) {
          return forwardBorrowed("onEnemyProjectileSpawned", context);
        },

        onDeath(context) {
          // 本体退场：已经没有本体可以演出了，直接收场（把敌方原样还回去）。
          retired = true;
          resolveImmediately(context);
        },

        drawBody() {
          // 圆点已经代替了本体：消解期间不画纯色球体。
          return dissolved() ? true : undefined;
        },

        getRenderOffset(context) {
          return dissolved() ? null : forwardBorrowed("getRenderOffset", context);
        },

        getHpDisplay() {
          return dissolved() ? { hidden: true } : null;
        },

        drawArenaBackground(context, canvasContext) {
          forwardBorrowed("drawArenaBackground", context, canvasContext);
        },

        drawArenaForeground(context, canvasContext) {
          forwardBorrowed("drawArenaForeground", context, canvasContext);
          drawSwapAnimation(canvasContext);
        },

        drawBefore(context, canvasContext) {
          forwardBorrowed("drawBefore", context, canvasContext);
        },

        drawAfter(context, canvasContext) {
          forwardBorrowed("drawAfter", context, canvasContext);
        },

        // 演出粒子的布局（测试与诊断用）：每颗的起点/终点都在对应本体的圆面内。
        getDissolveParticles() {
          if (!animation || !animation.particles) return null;
          return {
            selfRadius: owner ? owner.radius : 0,
            partnerRadius: animation.partner ? animation.partner.radius : 0,
            self: animation.particles.self.map((particle) => ({ ...particle })),
            partner: animation.particles.partner.map((particle) => ({ ...particle }))
          };
        },

        getSwapState() {
          const target = animation ? animation.partner : partner;
          return {
            phase,
            remaining: Math.max(0, deadline - services.getTime()),
            animating: Boolean(animation),
            animationKind: animation ? animation.kind : null,
            animationElapsed: animation ? services.getClockTime() - animation.startedAt : 0,
            applied: Boolean(animation ? animation.applied : phase === "swapped"),
            partnerId: target ? target.id : null,
            borrowedId: borrow ? borrow.definition.id : null,
            attackerCount: attackers.length,
            dilation: behavior.getTimeDilation({ ball: owner, game: { time: services.getTime() }, services })
          };
        }
      };

      return behavior;
    }
  };

  registerBall(swapDefinition);
  return {
    swapDefinition,
    createSwapArc: createArc,
    swapArcHalfAngle: ARC_HALF_ANGLE,
    swapForwardedHooks: FORWARDED_HOOKS
  };
});
