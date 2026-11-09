(function initializeScarecrow(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/contact-model.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createScarecrowPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  // 金稻草本体：纯色球体，只靠 color 表达，不覆盖本体绘制。
  const STRAW_COLOR = "#e0b23c";
  // 干草叉：长 65、宽 6（前端三根齿的总跨度），握在手里做近战戳击。
  const FORK_LENGTH = 65;
  const FORK_WIDTH = 6;
  const FORK_DAMAGE = 10;
  // 冷却 1.6 秒 = 两次戳击起始的间隔，戳击动作本身占用的时间算在里面。
  // 时间字段一律走战斗员的攻击钟（行为 dt / getAttackTime），
  // 所以攻击节奏被放慢时，戳击冷却与每目标命中间隔一起变慢。
  const FORK_COOLDOWN = 1.6;
  // 戳击动作时长与逼近速率照搬黄瓜：手是指数逼近过去的，不是瞬间前推。
  const FORK_THRUST_DURATION = 0.42;
  const FORK_THRUST_DISTANCE = 20;
  const FORK_TIP_RADIUS = 3;
  const FORK_IDLE_SIDE_OFFSET = 20;
  const FORK_HOLD_RATE = 40;
  const FORK_HOLD_IDLE_RATE = 16;
  const FORK_THRUST_ANGLE_RATE = 30;
  const FORK_IDLE_ANGLE_RATE = 14;
  const FORK_HEAD_LENGTH = 13;
  const FORK_SHAFT_WIDTH = 1.6;
  const HANDLE_COLOR = "#8a6a3a";
  const HANDLE_EDGE_COLOR = "#5d4726";
  const TINE_COLOR = "#c9d3da";
  const TINE_EDGE_COLOR = "#8b98a3";
  // ── 纯表现参数：不参与任何伤害/碰撞判定，只走共享粒子工厂 ──
  // 敌人被叉中：血色粒子，沿叉身刺入方向喷出并带一点下坠。
  const BLOOD_KIND = "scarecrow-blood";
  const BLOOD_COLORS = ["#c11f2f", "#8d1520", "#e04b52"];
  const BLOOD_COUNT = 14;
  const BLOOD_LIFE = 0.45;
  const BLOOD_GRAVITY = 90;
  // 分身被攻击：长条形稻草碎片四散，随后由重力接管往下掉。
  const STRAW_KIND = "scarecrow-straw";
  const STRAW_COLORS = ["#e0b23c", "#c99a2e", "#f2d98a"];
  const STRAW_COUNT = 10;
  const STRAW_LIFE = 1.1;
  const STRAW_GRAVITY = 130;
  // 分身血量 -1（无敌）：引擎要求召唤物 maxHp > 0，且到处按 hp <= 0 判定"已死"，
  // 所以 -1 不能直接写进 hp。无敌用 onBeforeDamage 把伤害归零表达
  // （真伤按 docs 也不绕过无敌），血条则显示成用户指定的 -1。
  const CLONE_HP_TEXT = "-1";
  const CLONE_MAX_HP = 1;
  const CLONE_ID = "scarecrow-clone";
  const CLONE_NAME = "稻草人·分身";
  const CLONE_SPAWN_OFFSET = 34;
  const FORK_TIP_KIND = "scarecrow-fork-tip";
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const TWO_PI = Math.PI * 2;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function angleDifference(target, current) {
    let difference = target - current;
    while (difference > Math.PI) difference -= TWO_PI;
    while (difference < -Math.PI) difference += TWO_PI;
    return difference;
  }

  // 戳击前推用正弦脉冲：出去再收回，不会一直伸着手。
  function thrustPulse(elapsed) {
    const progress = clamp(elapsed / FORK_THRUST_DURATION, 0, 1);
    const sine = Math.sin(Math.PI * progress);
    return sine * sine;
  }

  // 最远够到的距离：前推 + 叉长 + 叉尖半径。
  function forkReach() {
    return FORK_THRUST_DISTANCE + FORK_LENGTH + FORK_TIP_RADIUS;
  }

  // 指数逼近：相位切换都从当前值出发，动作不跳变（黄瓜同款）。
  function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
  }

  function closestPointOnFork(gripX, gripY, tipX, tipY, x, y) {
    const deltaX = tipX - gripX;
    const deltaY = tipY - gripY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((x - gripX) * deltaX + (y - gripY) * deltaY) / lengthSquared, 0, 1);
    return { x: gripX + deltaX * progress, y: gripY + deltaY * progress };
  }

  // 黄瓜同款近战物理：叉身压进敌人就把人顶出去，并沿法线反弹一次速度。
  // 只有真的插进敌人身体才生效，擦过去不推。
  function resolveForkPush(target, gripX, gripY, tipX, tipY, tipVx, tipVy, game, owner) {
    if (target.positionLocked || target.movementLocked) return;
    const closest = closestPointOnFork(gripX, gripY, tipX, tipY, target.x, target.y);
    const minimumDistance = target.radius + FORK_TIP_RADIUS;
    const deltaX = target.x - closest.x;
    const deltaY = target.y - closest.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance >= minimumDistance) return;
    let normalX;
    let normalY;
    if (distance > EPSILON) {
      normalX = deltaX / distance;
      normalY = deltaY / distance;
    } else {
      // 目标正好压在叉身上：沿叉身法线往背离本体的一侧推开。
      const aimX = tipX - gripX;
      const aimY = tipY - gripY;
      const length = Math.hypot(aimX, aimY) || 1;
      const perpX = -aimY / length;
      const perpY = aimX / length;
      const side = owner && (target.x - owner.x) * perpX + (target.y - owner.y) * perpY < 0
        ? -1
        : 1;
      normalX = perpX * side;
      normalY = perpY * side;
    }
    const { x: nextX, y: nextY } = resolveArenaGeometry(game).clampPoint(closest.x + normalX * minimumDistance, closest.y + normalY * minimumDistance, target.radius);
    // 叉身只把人往外顶，绝不往回勾：收叉时叉身会从敌人身上扫回去，
    // 照顶不误就会把敌人一路带回本体怀里。
    const distanceBeforeOwner = owner ? Math.hypot(target.x - owner.x, target.y - owner.y) : Infinity;
    const distanceAfterOwner = owner ? Math.hypot(nextX - owner.x, nextY - owner.y) : Infinity;
    if (distanceAfterOwner + EPSILON >= distanceBeforeOwner) {
      target.x = nextX;
      target.y = nextY;
    }
    const relativeNormal = (target.vx - tipVx) * normalX + (target.vy - tipVy) * normalY;
    if (relativeNormal >= -EPSILON) return;
    const reflectedX = target.vx - relativeNormal * 2 * normalX;
    const reflectedY = target.vy - relativeNormal * 2 * normalY;
    const reflectedLength = Math.hypot(reflectedX, reflectedY);
    if (reflectedLength <= EPSILON) return;
    const activeSpeed = Math.hypot(target.vx, target.vy);
    const storedSpeed = Math.hypot(target.storedVx, target.storedVy);
    target.vx = reflectedX / reflectedLength * activeSpeed;
    target.vy = reflectedY / reflectedLength * activeSpeed;
    target.storedVx = reflectedX / reflectedLength * storedSpeed;
    target.storedVy = reflectedY / reflectedLength * storedSpeed;
  }

  function forkGeometry(ball, angle, forward, side) {
    const aimX = Math.cos(angle);
    const aimY = Math.sin(angle);
    const perpX = aimY;
    const perpY = -aimX;
    const grip = {
      x: ball.x + aimX * forward + perpX * side,
      y: ball.y + aimY * forward + perpY * side
    };
    return {
      angle,
      grip,
      tip: {
        x: grip.x + aimX * FORK_LENGTH,
        y: grip.y + aimY * FORK_LENGTH
      }
    };
  }

  // 叉子：木柄 + 前端横梁与三根齿，齿的跨度就是 FORK_WIDTH。
  function drawFork(canvasContext, geometry) {
    if (!canvasContext || typeof canvasContext.lineTo !== "function") return;
    const shaftEnd = FORK_LENGTH - FORK_HEAD_LENGTH;
    canvasContext.save();
    canvasContext.translate(geometry.grip.x, geometry.grip.y);
    canvasContext.rotate(geometry.angle);
    canvasContext.strokeStyle = HANDLE_COLOR;
    canvasContext.lineWidth = FORK_SHAFT_WIDTH;
    canvasContext.beginPath();
    canvasContext.moveTo(0, 0);
    canvasContext.lineTo(shaftEnd, 0);
    canvasContext.stroke();
    canvasContext.strokeStyle = TINE_EDGE_COLOR;
    canvasContext.lineWidth = 1.4;
    canvasContext.beginPath();
    canvasContext.moveTo(shaftEnd, -FORK_WIDTH / 2);
    canvasContext.lineTo(shaftEnd, FORK_WIDTH / 2);
    canvasContext.stroke();
    canvasContext.strokeStyle = TINE_COLOR;
    canvasContext.lineWidth = 1.2;
    for (const offset of [-FORK_WIDTH / 2, 0, FORK_WIDTH / 2]) {
      canvasContext.beginPath();
      canvasContext.moveTo(shaftEnd, offset);
      canvasContext.lineTo(FORK_LENGTH, offset);
      canvasContext.stroke();
    }
    canvasContext.strokeStyle = HANDLE_EDGE_COLOR;
    canvasContext.lineWidth = 2.4;
    canvasContext.beginPath();
    canvasContext.moveTo(-2, 0);
    canvasContext.lineTo(0, 0);
    canvasContext.stroke();
    canvasContext.restore();
  }

  // 血：从叉身插入敌人的那一点往外喷，方向失败时退回叉身指向。
  function spawnBloodBurst(entityServices, x, y, angle) {
    if (!entityServices || typeof entityServices.spawnParticleBurst !== "function") return;
    entityServices.spawnParticleBurst({
      x,
      y,
      kind: BLOOD_KIND,
      count: BLOOD_COUNT,
      colors: BLOOD_COLORS,
      minDiameter: 1.5,
      maxDiameter: 4,
      minSpeed: 40,
      maxSpeed: 150,
      initialRadius: 3,
      directionAngle: angle,
      directionSpread: 1.5,
      drag: 3.2,
      gravityY: BLOOD_GRAVITY,
      life: BLOOD_LIFE
    });
  }

  // 稻草碎片：长条矩形，从分身四周散开后靠重力掉下去。
  function spawnStrawFragments(ball, services) {
    if (!ball || !services || typeof services.spawnParticleBurst !== "function") return;
    services.spawnParticleBurst({
      x: ball.x,
      y: ball.y,
      kind: STRAW_KIND,
      count: STRAW_COUNT,
      // 必须写 "rectangle"：粒子工厂的 normalizeShape 不认文档里的 "rect"，
      // 传 "rect" 会被静默降级成 circle（稻草就变成圆点、length/width 全废）。
      shape: "rectangle",
      colors: STRAW_COLORS,
      minLength: 9,
      maxLength: 18,
      minWidth: 0.9,
      maxWidth: 1.6,
      minSpeed: 20,
      maxSpeed: 70,
      minRotationSpeed: -5,
      maxRotationSpeed: 5,
      initialRadius: 12,
      drag: 0.9,
      gravityY: STRAW_GRAVITY,
      life: STRAW_LIFE
    });
  }

  // 血量 -1 的分身：无敌（伤害归零）、血条显示 -1、不攻击也不参与胜负判定。
  const scarecrowCloneDefinition = {
    id: CLONE_ID,
    name: CLONE_NAME,
    englishName: "Scarecrow Clone",
    color: STRAW_COLOR,
    description: "血量-1的无敌分身 / 不攻击",
    stats: { radius: 15, speed: 150, maxHp: CLONE_MAX_HP },
    summonsCountForTeamSurvival: false,
    healthless: true,
    createBehavior() {
      return {
        // 被打就掉长条稻草。分身无敌、最终伤害为 0，而引擎只在
        // resolvedAmount > 0 时才走 afterDamage/onDamaged，所以掉落特效
        // 只能挂在这个「任何受击都会派发」的钩子上。
        onBeforeDamage(context) {
          spawnStrawFragments(context.ball, context.services);
          return { amount: 0, showHitText: false };
        },
        getHpDisplay() {
          return { text: CLONE_HP_TEXT };
        },
        update() {}
      };
    }
  };

  function spawnClone(ball) {
    const heading = Math.hypot(ball.vx, ball.vy) > EPSILON
      ? Math.atan2(ball.vy, ball.vx)
      : 0;
    const speed = Number.isFinite(ball.speed) && ball.speed > 0 ? ball.speed : 150;
    const sideX = Math.cos(heading + Math.PI / 2);
    const sideY = Math.sin(heading + Math.PI / 2);
    return ball.services.spawnSummon(scarecrowCloneDefinition, {
      x: ball.x + sideX * CLONE_SPAWN_OFFSET,
      y: ball.y + sideY * CLONE_SPAWN_OFFSET,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed
    });
  }

  const scarecrowDefinition = {
    id: "scarecrow",
    name: "稻草人",
    englishName: "Scarecrow",
    color: STRAW_COLOR,
    description: "金黄稻草纯色本体 / 手持干草叉（长65宽6）近战10点、冷却1.6秒 / 带一个血量-1的无敌分身",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 2,
    createBehavior(services) {
      let ownerBall = null;
      let clone = null;
      let tipEntity = null;
      let initialized = false;
      let phase = "idle";
      let thrustElapsed = 0;
      let thrustCooldown = 0;
      let aimAngle = 0;
      let armForward = 0;
      let armSide = FORK_IDLE_SIDE_OFFSET;
      let tick = 0;
      const forkState = { gripX: 0, gripY: 0, tipX: 0, tipY: 0 };

      function ensureClone(ball) {
        // 只有真正的稻草人才带分身：Rion 借走这套攻击时 ball.id 是 "rion"，
        // 不该白拿一个无敌分身（Rion 的 borrowedServices 也不带 borrowedAttackOnly，
        // 所以和黄瓜一样用本体 id 判断）。
        if (!ball || ball.id !== scarecrowDefinition.id) return null;
        if (services.borrowedAttackOnly) return null;
        if (clone && clone.entityActive !== false && clone.hp > 0) return clone;
        clone = spawnClone(ball);
        return clone;
      }

      // 叉尖是独立战斗实体：扫掠命中走实体服务，伤害按 zone 归属。
      function ensureTipEntity() {
        if (tipEntity && tipEntity.entityActive !== false) return tipEntity;
        const ball = ownerBall;
        if (!ball) return null;
        const geometry = forkGeometry(ball, aimAngle, armForward, armSide);
        forkState.gripX = geometry.grip.x;
        forkState.gripY = geometry.grip.y;
        forkState.tipX = geometry.tip.x;
        forkState.tipY = geometry.tip.y;
        tipEntity = services.spawnCombatEntity({
          kind: FORK_TIP_KIND,
          combatKind: "zone",
          life: PERMANENT_LIFE,
          lifecycle: "owner-bound",
          drawLayer: "foreground",
          radius: FORK_TIP_RADIUS,
          x: geometry.tip.x,
          y: geometry.tip.y,
          lastTick: tick,
          // 与黄瓜一致：武器全程是活体判定，命中按"接触进入"结算，
          // 必须分开再碰到才会再次命中；每个目标另有自己的命中间隔。
          touchingTargets: new Set(),
          lastHitAt: new Map(),
          previousTip: null,
          previousGrip: null,
          update({ entity, game, services: entityServices }, dt) {
            if (!ownerBall || ownerBall.hp <= 0) {
              entity.entityActive = false;
              return;
            }
            // 行为被暂停（眩晕等）时这一步没有推进：叉子整根冻结，不扫掠也不推人。
            if (entity.lastTick === tick) return;
            entity.lastTick = tick;
            const gripX = forkState.gripX;
            const gripY = forkState.gripY;
            const tipX = forkState.tipX;
            const tipY = forkState.tipY;
            const previousTip = entity.previousTip || { x: tipX, y: tipY };
            const previousGrip = entity.previousGrip || { x: gripX, y: gripY };
            const elapsed = Math.max(EPSILON, dt);
            entity.x = tipX;
            entity.y = tipY;
            entity.vx = (tipX - previousTip.x) / elapsed;
            entity.vy = (tipY - previousTip.y) / elapsed;
            entity.previousTip = { x: tipX, y: tipY };
            entity.previousGrip = { x: gripX, y: gripY };
            // 与戳击冷却同一个攻击钟：攻击节奏被放慢时，同一目标的重命中也会一起变慢。
            const now = services.getAttackTime();
            // 过期的命中记录不再有任何作用，顺手清掉，长局里 Map 不会无限涨。
            if (entity.lastHitAt.size > 32) {
              for (const [key, at] of entity.lastHitAt) {
                if (now - at >= FORK_COOLDOWN) entity.lastHitAt.delete(key);
              }
            }
            const nextTouching = new Set();
            entityServices.forEachEnemy((enemy) => {
              if (!enemy || enemy.hp <= 0) return;
              const profile = entityServices.getContactProfile(enemy);
              if (!profile || (!profile.solid && !profile.attackable)) return;
              const hitRadius = enemy.radius + FORK_TIP_RADIUS;
              // 整根叉子（握把到叉尖）都是命中体：65 长的武器只测叉尖会在近处漏判，
              // 叉身明明扫过敌人却打不中。同时测上一帧的叉身，避免快速挥动漏判。
              const currentHit = firstSegmentCircleContact(
                gripX, gripY, tipX, tipY, enemy.x, enemy.y, hitRadius
              );
              const sweptHit = currentHit !== null ? currentHit : firstSegmentCircleContact(
                previousGrip.x, previousGrip.y, previousTip.x, previousTip.y,
                enemy.x, enemy.y, hitRadius
              );
              if (sweptHit === null) return;
              const key = enemy.instanceId;
              nextTouching.add(key);
              if (profile.solid) {
                resolveForkPush(
                  enemy, gripX, gripY, tipX, tipY, entity.vx, entity.vy, game, ownerBall
                );
              }
              if (!profile.attackable) return;
              if (entity.touchingTargets.has(key)) return;
              const previousHit = entity.lastHitAt.get(key);
              if (previousHit !== undefined && now - previousHit < FORK_COOLDOWN - EPSILON) return;
              entity.lastHitAt.set(key, now);
              if (!entityServices.dealDamage(enemy, FORK_DAMAGE)) return;
              // 受击反馈纯视效：血从叉身刺入敌人的那一点往外喷。
              const contact = closestPointOnFork(gripX, gripY, tipX, tipY, enemy.x, enemy.y);
              const bleedX = enemy.x - contact.x;
              const bleedY = enemy.y - contact.y;
              spawnBloodBurst(
                entityServices,
                contact.x,
                contact.y,
                Math.hypot(bleedX, bleedY) > EPSILON
                  ? Math.atan2(bleedY, bleedX)
                  : Math.atan2(tipY - gripY, tipX - gripX)
              );
            });
            entity.touchingTargets = nextTouching;
          },
          draw() {}
        });
        return tipEntity;
      }

      function initialize(context) {
        if (initialized) return;
        initialized = true;
        ownerBall = context.ball;
        ensureTipEntity();
        ensureClone(context.ball);
      }

      return {
        onSpawn(context) {
          initialize(context);
        },
        update(context, dt) {
          const ball = context.ball;
          ownerBall = ball;
          initialize(context);
          ensureTipEntity();
          ensureClone(ball);
          const step = Math.max(0, dt);
          const target = services.getOpponent();
          const aim = target
            ? Math.atan2(target.y - ball.y, target.x - ball.x)
            : aimAngle;
          if (thrustCooldown > 0) thrustCooldown = Math.max(0, thrustCooldown - step);
          if (phase === "thrust") {
            thrustElapsed += step;
            if (thrustElapsed + EPSILON >= FORK_THRUST_DURATION) {
              phase = "idle";
              thrustElapsed = 0;
            }
          } else if (target && thrustCooldown <= 0) {
            const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
            if (distance <= forkReach() + target.radius) {
              phase = "thrust";
              thrustElapsed = 0;
              thrustCooldown = FORK_COOLDOWN;
            }
          }
          // 与黄瓜一致：手是指数逼近过去的，而且戳击全程继续转向敌人，
          // 不是"锁死角度 + 瞬间前推"，所以收放连续、叉身始终跟着目标扫。
          if (phase === "thrust") {
            const pulse = thrustPulse(thrustElapsed);
            armForward = approach(
              armForward, FORK_THRUST_DISTANCE * pulse, FORK_HOLD_RATE, step
            );
            armSide = approach(
              armSide, FORK_IDLE_SIDE_OFFSET * (1 - pulse), FORK_HOLD_RATE, step
            );
            aimAngle += angleDifference(aim, aimAngle) *
              (1 - Math.exp(-FORK_THRUST_ANGLE_RATE * step));
          } else {
            armForward = approach(armForward, 0, FORK_HOLD_IDLE_RATE, step);
            armSide = approach(armSide, FORK_IDLE_SIDE_OFFSET, FORK_HOLD_IDLE_RATE, step);
            aimAngle += angleDifference(aim, aimAngle) *
              (1 - Math.exp(-FORK_IDLE_ANGLE_RATE * step));
          }
          const geometry = forkGeometry(ball, aimAngle, armForward, armSide);
          forkState.gripX = geometry.grip.x;
          forkState.gripY = geometry.grip.y;
          forkState.tipX = geometry.tip.x;
          forkState.tipY = geometry.tip.y;
          tick += 1;
        },
        getNextTransitionIn() {
          if (phase === "thrust") return Math.max(EPSILON, FORK_THRUST_DURATION - thrustElapsed);
          if (thrustCooldown > EPSILON && ownerBall) {
            const target = services.getOpponent();
            if (target) {
              const distance = Math.hypot(target.x - ownerBall.x, target.y - ownerBall.y);
              if (distance <= forkReach() + target.radius) {
                return Math.max(EPSILON, thrustCooldown);
              }
            }
          }
          return undefined;
        },
        drawBefore(context, canvasContext) {
          // 绘制只读状态：直接用 context.ball，不在这里回写 ownerBall。
          drawFork(canvasContext, forkGeometry(context.ball, aimAngle, armForward, armSide));
        },
        onDeath() {
          if (clone) clone.entityActive = false;
          clone = null;
          if (tipEntity) tipEntity.entityActive = false;
          tipEntity = null;
        },
        onBorrowEnd() {
          if (tipEntity) tipEntity.entityActive = false;
          tipEntity = null;
        },
        getScarecrowState() {
          return {
            phase,
            thrustCooldown,
            grip: ownerBall
              ? { x: forkState.gripX, y: forkState.gripY }
              : null,
            tip: ownerBall
              ? { x: forkState.tipX, y: forkState.tipY }
              : null,
            forkDamage: FORK_DAMAGE,
            forkCooldown: FORK_COOLDOWN,
            forkLength: FORK_LENGTH,
            forkWidth: FORK_WIDTH,
            reach: forkReach(),
            cloneActive: Boolean(clone && clone.entityActive !== false && clone.hp > 0)
          };
        }
      };
    }
  };

  registerBall(scarecrowDefinition);
  return {
    scarecrowDefinition,
    scarecrowCloneDefinition,
    SCARECROW_COLOR: STRAW_COLOR,
    SCARECROW_FORK_LENGTH: FORK_LENGTH,
    SCARECROW_FORK_WIDTH: FORK_WIDTH,
    SCARECROW_FORK_DAMAGE: FORK_DAMAGE,
    SCARECROW_FORK_COOLDOWN: FORK_COOLDOWN,
    SCARECROW_FORK_TIP_RADIUS: FORK_TIP_RADIUS,
    SCARECROW_CLONE_HP_TEXT: CLONE_HP_TEXT,
    SCARECROW_BLOOD_KIND: BLOOD_KIND,
    SCARECROW_STRAW_KIND: STRAW_KIND,
    scarecrowForkReach: forkReach,
    spawnScarecrowClone: spawnClone
  };
});
