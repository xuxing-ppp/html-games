(function initializeCopy(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCopyPlugin({ registerBall, resolveArenaGeometry }) {
  // 每 8 秒吐出一批复制体。
  const SPAWN_INTERVAL = 8;
  const SPAWN_COUNT = 20;
  // 复制体：直径 20、5 血、速度 150、没有碰撞实体，但和分裂 V2 一样通过
  // bodyContact 参与接触攻击：攻击方的 onCollision 照常执行，结算真实伤害与效果。
  const MINION_RADIUS = 10;
  const MINION_MAX_HP = 5;
  const MINION_SPEED = 150;
  // 每秒自动扣 1 血 → 默认 5 秒后消失。
  const MINION_DECAY_INTERVAL = 1;
  const MINION_DECAY_DAMAGE = 1;
  // 短剑：长 20，绕身旋转，周期固定 1 秒，触碰伤害 3。
  const BLADE_LENGTH = 18;
  const BLADE_DAMAGE = 3;
  // 0.8 圈/秒 → 一圈 1.25 秒
  const BLADE_PERIOD = 1.25;
  const BLADE_ANGULAR_SPEED = Math.PI * 2 / BLADE_PERIOD;
  const COPY_COLOR = "#9aa0a4";
  const MINION_COLOR = "#767d81";
  const PARTICLE_COLORS = Object.freeze(["#c6ccd0", "#9aa0a4", "#767d81", "#e2e6e8"]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function bladeSegment(ball, angle) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    return {
      startX: ball.x + directionX * ball.radius,
      startY: ball.y + directionY * ball.radius,
      endX: ball.x + directionX * (ball.radius + BLADE_LENGTH),
      endY: ball.y + directionY * (ball.radius + BLADE_LENGTH)
    };
  }

  function pointToSegmentDistance(x, y, segment) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((x - segment.startX) * deltaX + (y - segment.startY) * deltaY) / lengthSquared,
      0,
      1
    );
    return Math.hypot(
      x - (segment.startX + deltaX * progress),
      y - (segment.startY + deltaY * progress)
    );
  }

  // 等比缩小的刺客短剑：灰白配色。
  function drawBlade(context, ball, angle) {
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    context.lineJoin = "round";

    context.strokeStyle = "#1c2024";
    context.lineWidth = 3.5;
    context.lineCap = "butt";
    context.beginPath();
    context.moveTo(ball.radius, 0);
    context.lineTo(ball.radius + 3, 0);
    context.stroke();

    context.strokeStyle = "#8b8f93";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(ball.radius + 3, -3.2);
    context.lineTo(ball.radius + 3, 3.2);
    context.stroke();

    context.fillStyle = "#b9c0c4";
    context.strokeStyle = "#f2f6f8";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(ball.radius + 4, -2.4);
    context.lineTo(ball.radius + BLADE_LENGTH, 0);
    context.lineTo(ball.radius + 4, 2.4);
    context.closePath();
    context.fill();
    context.stroke();

    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(ball.radius + 5, -1);
    context.lineTo(ball.radius + BLADE_LENGTH - 3, -0.2);
    context.stroke();
    context.restore();
  }

  function createCopyMinionDefinition() {
    return {
      id: "copy-minion",
      name: "复制体",
      englishName: "Copy",
      color: MINION_COLOR,
      description: "复制体：短剑环绕 / 每秒掉 1 血",
      stats: {
        radius: MINION_RADIUS,
        speed: MINION_SPEED,
        maxHp: MINION_MAX_HP
      },
      createBehavior(services) {
        let angle = 0;
        let ownerBall = null;
        let decayTimer = 0;
        let overlappingTargets = new Set();

        function checkBladeHits(ball) {
          if (!ball || ball.hp <= 0) return;
          const segment = bladeSegment(ball, angle);
          const nextOverlaps = new Set();
          services.forEachEnemy((target) => {
            if (!target || target.hp <= 0) return;
            const profile = services.getContactProfile(target);
            if (!profile || profile.attackable === false) return;
            if (pointToSegmentDistance(target.x, target.y, segment) > target.radius) return;
            const key = target.instanceId;
            nextOverlaps.add(key);
            if (!overlappingTargets.has(key)) {
              services.dealDamage(target, BLADE_DAMAGE, ball);
            }
          });
          overlappingTargets = nextOverlaps;
        }

        return {
          onSpawn(context) {
            ownerBall = context.ball;
            decayTimer = 0;
            angle = Math.random() * TWO_PI;
          },
          // 没有碰撞实体：不参与物理碰撞，但和分裂 V2 一样用 bodyContact
          // 让敌方的碰撞钩子照常结算真实伤害与附带效果；自身被封印也照样吃伤害。
          getContactProfile() {
            return { solid: false, attackable: true, bodyContact: true };
          },
          update(context, dt) {
            ownerBall = context.ball;
            const elapsed = Math.max(0, dt);
            angle = (angle + BLADE_ANGULAR_SPEED * elapsed) % TWO_PI;
            decayTimer += elapsed;
            while (
              decayTimer + EPSILON >= MINION_DECAY_INTERVAL &&
              context.ball.hp > 0
            ) {
              decayTimer -= MINION_DECAY_INTERVAL;
              context.ball.hp = Math.max(0, context.ball.hp - MINION_DECAY_DAMAGE);
            }
          },
          afterUpdateStep(context) {
            checkBladeHits(context.ball);
          },
          drawAfter(context, canvasContext) {
            drawBlade(canvasContext, context.ball, angle);
          },
          getCopyMinionState() {
            return {
              angle,
              decayTimer,
              hp: ownerBall ? ownerBall.hp : 0,
              bladeLength: BLADE_LENGTH,
              period: BLADE_PERIOD,
              bladeDamage: BLADE_DAMAGE
            };
          }
        };
      }
    };
  }

  function spawnSpawnBurst(services, x, y) {
    services.spawnParticleBurst({
      x,
      y,
      count: 10,
      colors: PARTICLE_COLORS,
      minDiameter: 1,
      maxDiameter: 2.8,
      minSpeed: 24,
      maxSpeed: 90,
      life: 0.36,
      drag: 3.2
    });
  }

  const copyDefinition = {
    id: "copy",
    name: "复制",
    englishName: "Copy",
    color: COPY_COLOR,
    description: "每 8 秒散落 20 个持剑复制体",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let ownerBall = null;
      let spawnTimer = 0;
      // 开局立刻放第一波，之后每 8 秒一波。
      let firstWavePending = true;

      function spawnWave(context) {
        const arena = resolveArenaGeometry(context.game);
        for (let index = 0; index < SPAWN_COUNT; index += 1) {
          const { x, y } = arena.samplePoint(Math.random, MINION_RADIUS);
          const heading = Math.random() * TWO_PI;
          const vx = Math.cos(heading) * MINION_SPEED;
          const vy = Math.sin(heading) * MINION_SPEED;
          services.spawnSummon(createCopyMinionDefinition(), {
            x,
            y,
            vx,
            vy,
            storedVx: vx,
            storedVy: vy
          });
          spawnSpawnBurst(services, x, y);
        }
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          spawnTimer = 0;
          firstWavePending = true;
        },
        update(context, dt) {
          ownerBall = context.ball;
          if (firstWavePending) {
            firstWavePending = false;
            spawnTimer = 0;
            spawnWave(context);
          }
          spawnTimer += Math.max(0, dt);
          while (spawnTimer + EPSILON >= SPAWN_INTERVAL) {
            spawnTimer -= SPAWN_INTERVAL;
            spawnWave(context);
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, SPAWN_INTERVAL - spawnTimer);
        },
        isAttackCycleComplete() { return !firstWavePending; },
        getCopyState() {
          const summons = services.getSummons("copy-minion");
          return {
            spawnTimer,
            firstWavePending,
            nextSpawnIn: Math.max(0, SPAWN_INTERVAL - spawnTimer),
            spawnInterval: SPAWN_INTERVAL,
            spawnCount: SPAWN_COUNT,
            minions: summons.length
          };
        }
      };
    }
  };

  registerBall(copyDefinition);
  return {
    copyDefinition,
    createCopyMinionDefinition,
    COPY_SPAWN_INTERVAL: SPAWN_INTERVAL,
    COPY_SPAWN_COUNT: SPAWN_COUNT,
    COPY_MINION_BLADE_LENGTH: BLADE_LENGTH
  };
});
