(function initializeTornadoBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTornadoPlugin({ resolveArenaGeometry, registerBall }) {
  const THROW_INTERVAL = 2;
  const TORNADO_RADIUS = 25;
  const TORNADO_SPEED = 65;
  // 索敌转向角速度（弧度/秒）。从 1.5π 降到 0.6π：风眼追敌转弯半径
  // 从 ~14 拉到 ~35，先绕弧形再接近，不再瞬间转向直奔敌人。
  const TORNADO_TURN_RATE = Math.PI * 0.6;
  // 急转弯惯性：转向越急速度上限越低（重物转弯感），直线飞行按
  // TORNADO_REGAIN_RATE 恢复满速，避免索敌阶段瞬间拉近敌人。
  const TORNADO_TURN_DRAG = 0.45;
  const TORNADO_REGAIN_RATE = 170;
  const SPIN_START_REV = 1;
  const SPIN_ACCEL_REV = 2;
  const REVOLUTION_DAMAGE = 2;
  const SEEK_LIFE = 4;
  const FADE_TIME = 0.5;
  const CAPTURE_DURATION = 1.5;
  const PULL_TIME = 0.2;
  const HOLD_EFFECT_EXTRA = 0.05;
  const ARM_COUNT = 3;
  const ARM_STEPS = 30;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  const SPIRAL_MAIN_COLOR = "#c3ced4";
  const SPIRAL_BRIGHT_COLOR = "#eef3f5";
  const SPIRAL_EYE_COLOR = "#5c7682";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= TWO_PI;
    while (value < -Math.PI) value += TWO_PI;
    return value;
  }

  function rotateToward(current, target, maximumStep) {
    const difference = normalizeAngle(target - current);
    return current + clamp(difference, -maximumStep, maximumStep);
  }

  function hashRandom(seed) {
    let value = (seed * 2246822519 + 374761393) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 100000) / 100000;
  }

  // 被卷入状态：锁移动、暂停行为且无法攻击；解除时恢复被卷走前的速度
  function createHoldEffect(duration) {
    return {
      id: "tornado-hold",
      duration,
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      savedVx: 0,
      savedVy: 0,
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx != null
            ? ball.storedVx
            : (ball.preHitVx != null ? ball.preHitVx : ball.vx);
          effect.savedVy = ball.storedVy != null
            ? ball.storedVy
            : (ball.preHitVy != null ? ball.preHitVy : ball.vy);
        }
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game }) {
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
      }
    };
  }

  function createSpiralArms(seed) {
    const arms = [];
    for (let arm = 0; arm < ARM_COUNT; arm += 1) {
      const points = [];
      const phase = (arm / ARM_COUNT) * TWO_PI + hashRandom(seed + arm * 13) * 0.7;
      const turns = 1.55 + hashRandom(seed + arm * 29) * 0.5;
      for (let index = 0; index <= ARM_STEPS; index += 1) {
        const progress = index / ARM_STEPS;
        const angle = phase + progress * turns * TWO_PI;
        const radius = TORNADO_RADIUS * (1 - progress * 0.87);
        points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      }
      arms.push(points);
    }
    return arms;
  }

  function strokeArm(context, points) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.stroke();
  }

  function createTornado(x, y, vx, vy, arenaSize) {
    const seed = Math.floor(Math.random() * 1000000);
    return {
      kind: "tornado-vortex",
      combatKind: "zone",
      // 兜底寿命：空转 4 + 渐隐 0.5 或最晚 4 秒卷入 + 磨 1.5，正常路径都会提前自灭
      life: SEEK_LIFE + FADE_TIME + CAPTURE_DURATION + 0.5,
      lifecycle: "independent",
      drawLayer: "background",
      x,
      y,
      vx,
      vy,
      radius: TORNADO_RADIUS,
      arenaSize,
      seed,
      arms: createSpiralArms(seed),
      phase: "seek",
      alpha: 1,
      seekElapsed: 0,
      fadeElapsed: 0,
      grindElapsed: 0,
      spinAngle: hashRandom(seed + 7) * TWO_PI,
      heading: Math.atan2(vy, vx),
      speed: Math.hypot(vx, vy),
      orbitAngle: 0,
      captureDist: 0,
      revolutionProgress: 0,
      victim: null,
      holdEffect: null,
      update({ entity, game, services: vortexServices }, dt) {
        if (entity.phase === "fade") {
          entity.fadeElapsed += dt;
          entity.spinAngle += SPIN_START_REV * TWO_PI * dt;
          entity.alpha = Math.max(0, 1 - entity.fadeElapsed / FADE_TIME);
          if (entity.fadeElapsed >= FADE_TIME - EPSILON) entity.entityActive = false;
          return;
        }
        if (entity.phase === "grind") {
          entity.grindElapsed += dt;
          const angularSpeed = (SPIN_START_REV + SPIN_ACCEL_REV * entity.grindElapsed) * TWO_PI;
          entity.spinAngle += angularSpeed * dt;
          const victim = entity.victim;
          if (
            !victim || victim.hp <= 0 ||
            !victim.effects || victim.effects.get("tornado-hold") !== entity.holdEffect
          ) {
            // 受害者先没了：风继续自旋，直到固定的 2 秒结束
            entity.victim = null;
          } else {
            entity.orbitAngle += angularSpeed * dt;
            entity.revolutionProgress += angularSpeed * dt;
            while (entity.revolutionProgress >= TWO_PI) {
              entity.revolutionProgress -= TWO_PI;
              vortexServices.dealDamage(victim, REVOLUTION_DAMAGE);
            }
            // 外壁贴着风壁旋转：轨道半径 = 风半径 - 本体半径
            const orbitRadius = Math.max(TORNADO_RADIUS - victim.radius, 0);
            let orbitDistance = orbitRadius;
            if (entity.grindElapsed < PULL_TIME) {
              const progress = entity.grindElapsed / PULL_TIME;
              const eased = progress * (2 - progress);
              orbitDistance = entity.captureDist + (orbitRadius - entity.captureDist) * eased;
            }
            victim.x = entity.x + Math.cos(entity.orbitAngle) * orbitDistance;
            victim.y = entity.y + Math.sin(entity.orbitAngle) * orbitDistance;
            victim.vx = 0;
            victim.vy = 0;
          }
          if (entity.grindElapsed >= CAPTURE_DURATION - EPSILON) {
            entity.entityActive = false;
          }
          return;
        }
        // 寻敌阶段：索敌追踪，最多 4 秒，之后原地渐隐
        entity.seekElapsed += dt;
        entity.spinAngle += SPIN_START_REV * TWO_PI * dt;
        if (entity.seekElapsed >= SEEK_LIFE - EPSILON) {
          entity.phase = "fade";
          entity.fadeElapsed = 0;
          return;
        }
        let best = null;
        let bestDistance = Infinity;
        vortexServices.forEachEnemy((enemy) => {
          if (enemy.hp <= 0) return;
          const distance = Math.hypot(enemy.x - entity.x, enemy.y - entity.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = enemy;
          }
        });
        if (best) {
          const targetAngle = Math.atan2(best.y - entity.y, best.x - entity.x);
          const elapsed = Math.max(0, dt);
          const previousHeading = entity.heading;
          entity.heading = rotateToward(
            entity.heading,
            targetAngle,
            TORNADO_TURN_RATE * elapsed
          );
          // 转向惯性：按本步实际转过的角度占比计算速度上限，急转即掉速；
          // 速度本身也平滑逼近目标值（不会瞬变），直线时恢复满速。
          const turnFraction = elapsed > EPSILON
            ? clamp(Math.abs(normalizeAngle(entity.heading - previousHeading)) / (TORNADO_TURN_RATE * elapsed), 0, 1)
            : 0;
          const desiredSpeed = TORNADO_SPEED * (1 - TORNADO_TURN_DRAG * turnFraction);
          const maxStep = TORNADO_REGAIN_RATE * elapsed;
          entity.speed = clamp(
            entity.speed + clamp(desiredSpeed - entity.speed, -maxStep, maxStep),
            TORNADO_SPEED * (1 - TORNADO_TURN_DRAG),
            TORNADO_SPEED
          );
          entity.vx = Math.cos(entity.heading) * entity.speed;
          entity.vy = Math.sin(entity.heading) * entity.speed;
        }
        Object.assign(entity, resolveArenaGeometry(game).clampPoint(entity.x + entity.vx * dt, entity.y + entity.vy * dt, TORNADO_RADIUS));
        vortexServices.forEachEnemy((target) => {
          if (entity.phase !== "seek") return; // 一条龙卷风只卷一个敌人
          if (target.hp <= 0) return;
          if (
            target.effects &&
            (target.effects.has("tornado-hold") || target.effects.has("quicksand-sink"))
          ) return;
          const distance = Math.hypot(target.x - entity.x, target.y - entity.y);
          if (distance > TORNADO_RADIUS + target.radius) return;
          const holdEffect = vortexServices.applyEffect(
            target,
            createHoldEffect(CAPTURE_DURATION + HOLD_EFFECT_EXTRA)
          );
          if (!holdEffect) return;
          entity.phase = "grind";
          entity.victim = target;
          entity.holdEffect = holdEffect;
          entity.grindElapsed = 0;
          entity.revolutionProgress = 0;
          entity.captureDist = distance;
          entity.orbitAngle = Math.atan2(target.y - entity.y, target.x - entity.x);
          entity.vx = 0;
          entity.vy = 0;
        });
      },
      draw({ entity }, context) {
        const baseAlpha = context.globalAlpha * entity.alpha;
        context.save();
        context.translate(entity.x, entity.y);
        context.rotate(entity.spinAngle);
        context.globalAlpha = baseAlpha * 0.5;
        context.fillStyle = SPIRAL_EYE_COLOR;
        context.beginPath();
        context.arc(0, 0, 5, 0, TWO_PI);
        context.fill();
        for (const arm of entity.arms) {
          context.globalAlpha = baseAlpha * 0.45;
          context.strokeStyle = SPIRAL_MAIN_COLOR;
          context.lineWidth = 3;
          strokeArm(context, arm);
        }
        for (const arm of entity.arms) {
          context.globalAlpha = baseAlpha * 0.85;
          context.strokeStyle = SPIRAL_BRIGHT_COLOR;
          context.lineWidth = 1.2;
          strokeArm(context, arm);
        }
        context.restore();
      }
    };
  }

  const tornadoDefinition = {
    id: "tornado",
    name: "龙卷风",
    englishName: "Tornado",
    color: "#578896",
    description: "每2秒释放索敌龙卷风 / 卷入敌人旋转磨血每圈2点",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const attackNow = (context) => typeof services.getAttackTime === "function"
        ? services.getAttackTime() : context.game.time;
      let nextThrowAt = (typeof services.getAttackTime === "function"
        ? services.getAttackTime() : 0) + THROW_INTERVAL;

      function releaseTornado(context) {
        const target = services.getOpponent();
        if (!target || target.hp <= 0) return false;
        const deltaX = target.x - context.ball.x;
        const deltaY = target.y - context.ball.y;
        const distance = Math.hypot(deltaX, deltaY);
        const dirX = distance > EPSILON ? deltaX / distance : 1;
        const dirY = distance > EPSILON ? deltaY / distance : 0;
        services.spawnCombatEntity(createTornado(
          context.ball.x,
          context.ball.y,
          dirX * TORNADO_SPEED,
          dirY * TORNADO_SPEED,
          context.game.arenaSize
        ));
        return true;
      }

      return {
        update(context) {
          if (attackNow(context) + EPSILON < nextThrowAt) return;
          if (releaseTornado(context)) {
            nextThrowAt = attackNow(context) + THROW_INTERVAL;
          } else {
            nextThrowAt = attackNow(context) + 0.1;
          }
        },
        getTornadoState() {
          return { nextThrowAt };
        }
      };
    }
  };

  registerBall(tornadoDefinition);
  return {
    tornadoDefinition,
    tornadoCreateTornado: createTornado,
    tornadoCreateHoldEffect: createHoldEffect
  };
});
