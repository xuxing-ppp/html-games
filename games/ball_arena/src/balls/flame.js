(function initializeFlame(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFlamePlugin({ registerBall, resolveArenaGeometry }) {
  const TAU = Math.PI * 2;
  const ATTACK_INTERVAL = 1.2;
  const PROJECTILE_SPEED = 150;
  const PROJECTILE_RADIUS = 5;
  const DIRECT_DAMAGE = 3;
  const BURN_DURATION = 1.2;
  const BURN_TICK_INTERVAL = 0.6;
  const BURN_TICKS = 2;
  const BURN_DAMAGE = 3;
  const ORBIT_COUNT = 5;
  // 参考图测量（本体半径约 27.5px）：火焰中心到本体中心 34.5px、短棒长 18px、宽 6px，
  // 换算成本体半径 15 的比例就是下面这三个值；五根短棒均匀相隔 72°，长轴与半径垂直。
  const ORBIT_RADIUS = 18.8;
  const FLAME_LENGTH = 9.8;
  const FLAME_WIDTH = 3.3;
  const ORBIT_ROTATIONS_PER_SECOND = 1;
  const PROJECTILE_LIFE = 3;
  const TRAIL_INTERVAL = 0.04;
  const BURN_TRAIL_INTERVAL = 0.05;
  const BURN_TRAIL_COLORS = Object.freeze([
    "#fff0a0",
    "#ffd23d",
    "#ff7a20",
    "#ff3b16"
  ]);
  const EPSILON = 1e-9;
  const ORBIT_FLAME_COLOR = "#ffd83b";

  function aimAt(source, target) {
    let dx = target.x - source.x;
    let dy = target.y - source.y;
    if (Math.hypot(dx, dy) <= EPSILON) {
      dx = source.storedVx || source.vx || 1;
      dy = source.storedVy || source.vy || 0;
    }
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  function createFlameBurnEffect() {
    return {
      id: "flame-burn",
      combatKind: "dot",
      duration: BURN_DURATION,
      attackTags: ["heat"],
      onApply({ effect, game }) {
        effect.remainingTicks = BURN_TICKS;
        effect.nextTick = game.time + BURN_TICK_INTERVAL;
      },
      update({ ball, effect, game, services }, dt) {
        while (
          effect.remainingTicks > 0 &&
          game.time + EPSILON >= effect.nextTick &&
          ball.hp > 0
        ) {
          services.dealDamage(ball, BURN_DAMAGE);
          effect.remainingTicks -= 1;
          effect.nextTick += BURN_TICK_INTERVAL;
        }
        if (effect.remainingTicks === 0) effect.expiresAt = game.time;
        if (ball.hp <= 0) return;
        // 拖尾与烈焰弹共用同一套粒子爆发：粒子生成在世界坐标里自行飘散淡出，
        // 不是按帧重算位置的固定形状，所以目标移动时会自然拖出尾巴。
        effect.trailTimer = (effect.trailTimer || 0) + Math.max(0, dt);
        const velocityX = Number.isFinite(ball.vx) ? ball.vx : 0;
        const velocityY = Number.isFinite(ball.vy) ? ball.vy : 0;
        const speed = Math.hypot(velocityX, velocityY);
        const directional = speed > 1e-6
          ? {
              directionAngle: Math.atan2(velocityY, velocityX) + Math.PI,
              directionSpread: 1.3
            }
          : {};
        while (effect.trailTimer + EPSILON >= BURN_TRAIL_INTERVAL) {
          effect.trailTimer -= BURN_TRAIL_INTERVAL;
          services.spawnParticleBurst({
            kind: "flame-burn-trail",
            x: ball.x,
            y: ball.y,
            count: 3,
            minDiameter: 1,
            maxDiameter: 3,
            minSpeed: 8,
            maxSpeed: 30,
            life: 0.3,
            drag: 3,
            initialRadius: ball.radius,
            colors: BURN_TRAIL_COLORS,
            ...directional
          });
        }
      }
    };
  }

  function drawFlameProjectile(effect, context) {
    const speed = Math.hypot(effect.vx, effect.vy) || 1;
    const nx = effect.vx / speed;
    const ny = effect.vy / speed;
    const px = -ny;
    const py = nx;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.fillStyle = "#ff8a18";
    context.beginPath();
    context.moveTo(effect.x + nx * effect.radius, effect.y + ny * effect.radius);
    context.lineTo(effect.x - nx * effect.radius * 0.8 + px * effect.radius, effect.y - ny * effect.radius * 0.8 + py * effect.radius);
    context.lineTo(effect.x - nx * effect.radius * 0.8 - px * effect.radius, effect.y - ny * effect.radius * 0.8 - py * effect.radius);
    context.closePath();
    context.fill();
    context.fillStyle = "#ffe58a";
    context.beginPath();
    context.arc(effect.x + nx * 1.5, effect.y + ny * 1.5, effect.radius * 0.48, 0, TAU);
    context.fill();
    context.restore();
  }

  function createFlameProjectile(source, direction) {
    return {
      kind: "flame-shot",
      life: PROJECTILE_LIFE,
      radius: PROJECTILE_RADIUS,
      x: source.x,
      y: source.y,
      vx: direction.x * PROJECTILE_SPEED,
      vy: direction.y * PROJECTILE_SPEED,
      replayDamage: DIRECT_DAMAGE,
      trailTimer: 0,
      update({ effect, game, services }, dt) {
        const step = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * step;
        effect.y += effect.vy * step;
        effect.trailTimer += step;
        while (effect.trailTimer + EPSILON >= TRAIL_INTERVAL) {
          effect.trailTimer -= TRAIL_INTERVAL;
          services.spawnParticleBurst({
            kind: "flame-shot-trail",
            x: effect.x,
            y: effect.y,
            count: 3,
            minDiameter: 1,
            maxDiameter: 3,
            minSpeed: 8,
            maxSpeed: 30,
            life: 0.28,
            drag: 3,
            initialRadius: 2,
            directionAngle: Math.atan2(effect.vy, effect.vx) + Math.PI,
            directionSpread: 1.3,
            colors: ["#fff0a0", "#ffd23d", "#ff7a20"]
          });
        }
        const hit = services.getFirstEnemyHit(startX, startY, effect.x, effect.y, effect.radius);
        if (hit && services.dealDamage(hit, DIRECT_DAMAGE)) {
          if (hit.hp > 0) services.applyEffect(hit, createFlameBurnEffect());
          effect.life = 0;
          return;
        }
        if (
          game.arena ? !game.arena.intersectsCircle(effect.x, effect.y, effect.radius) : (
            !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, effect.radius))
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        drawFlameProjectile(effect, context);
      }
    };
  }

  // 参考图里的火焰是一根圆头短棒（胶囊）：长轴与半径垂直，长度 ~0.65、宽度 ~0.22 倍本体半径。
  function drawFlameCapsule(context, x, y, tangentX, tangentY, length, width) {
    const radius = width / 2;
    const straight = Math.max(0, (length - width) / 2);
    const angle = Math.atan2(tangentY, tangentX);
    const headX = x + tangentX * straight;
    const headY = y + tangentY * straight;
    const tailX = x - tangentX * straight;
    const tailY = y - tangentY * straight;
    context.beginPath();
    context.arc(headX, headY, radius, angle - Math.PI / 2, angle + Math.PI / 2);
    context.arc(tailX, tailY, radius, angle + Math.PI / 2, angle + Math.PI * 1.5);
    context.closePath();
    context.fill();
  }

  function drawOrbitFlames({ ball, game }, context) {
    context.save();
    context.fillStyle = ORBIT_FLAME_COLOR;
    for (let index = 0; index < ORBIT_COUNT; index += 1) {
      // 初始相位让第一根短棒落在正上方，与参考图一致。
      const angle = game.time * TAU * ORBIT_ROTATIONS_PER_SECOND +
        index * TAU / ORBIT_COUNT - Math.PI / 2;
      const radialX = Math.cos(angle);
      const radialY = Math.sin(angle);
      context.globalAlpha = 0.88 + 0.12 * Math.sin(game.time * 13 + index);
      drawFlameCapsule(
        context,
        ball.x + radialX * ORBIT_RADIUS,
        ball.y + radialY * ORBIT_RADIUS,
        -radialY,
        radialX,
        FLAME_LENGTH,
        FLAME_WIDTH
      );
    }
    context.restore();
  }

  const flameDefinition = {
    id: "flame",
    name: "烈焰",
    englishName: "Flame",
    color: "#ffe43b",
    description: "五焰环绕（1r/s） / 每1.2秒发射速度150的烈焰弹 / 命中-3并灼烧1.2秒",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: ATTACK_INTERVAL,
    createBehavior(services) {
      let attackTimer = 0;
      return {
        update(_context, dt) {
          attackTimer = Math.min(ATTACK_INTERVAL, attackTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, ATTACK_INTERVAL - attackTimer);
        },
        afterUpdateStep(context) {
          if (attackTimer + EPSILON < ATTACK_INTERVAL) return;
          attackTimer = 0;
          const target = services.getOpponent();
          if (!target) return;
          services.spawnProjectile(createFlameProjectile(context.ball, aimAt(context.ball, target)));
        },
        drawBefore: drawOrbitFlames
      };
    }
  };

  registerBall(flameDefinition);
  return {
    flameDefinition,
    createFlameProjectile,
    createFlameBurnEffect,
    flameRules: Object.freeze({
      attackInterval: ATTACK_INTERVAL,
      projectileSpeed: PROJECTILE_SPEED,
      projectileRadius: PROJECTILE_RADIUS,
      directDamage: DIRECT_DAMAGE,
      burnDuration: BURN_DURATION,
      burnTickInterval: BURN_TICK_INTERVAL,
      burnTicks: BURN_TICKS,
      burnDamage: BURN_DAMAGE,
      orbitCount: ORBIT_COUNT,
      orbitRadius: ORBIT_RADIUS,
      flameLength: FLAME_LENGTH,
      flameWidth: FLAME_WIDTH,
      orbitRotationsPerSecond: ORBIT_ROTATIONS_PER_SECOND,
      burnTrailInterval: BURN_TRAIL_INTERVAL
    })
  };
});
