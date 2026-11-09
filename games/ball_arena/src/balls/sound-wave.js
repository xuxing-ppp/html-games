(function initializeSoundWave(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSoundWavePlugin({ resolveArenaGeometry, registerBall }) {
  const BODY_COLOR = "#a8a8a8"; // 灰白，比大运 #808080 更白一点
  // 参考佳代子恐惧波的环速：(60 - 15) / 0.6 = 75
  const WAVE_SPEED = 75;
  const WAVE_DAMAGE = 1;
  const WAVE_POINT_COUNT = 32;
  const WAVE_LINE_RADIUS = 1;
  const WAVE_CYCLE = 4.55;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function drawSoundWaveBody(context, canvasContext) {
    const ball = context.ball;
    canvasContext.save();
    canvasContext.fillStyle = BODY_COLOR;
    canvasContext.strokeStyle = "#3f4348";
    canvasContext.lineWidth = 1.2;
    canvasContext.beginPath();
    canvasContext.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
    canvasContext.fill();
    canvasContext.stroke();
    canvasContext.restore();
    return true;
  }

  // 把整圈波前锋渲染成首尾相连的折线环；半透明 + 背景层，避免遮挡本体/敌方
  function drawSoundWave(entity, canvasContext) {
    const points = entity.points;
    if (!points || points.length < 2) return;
    canvasContext.save();
    canvasContext.globalAlpha *= 0.32;
    canvasContext.strokeStyle = "#cfd6da";
    canvasContext.lineWidth = 1.3;
    canvasContext.beginPath();
    canvasContext.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      canvasContext.lineTo(points[index].x, points[index].y);
    }
    canvasContext.closePath();
    canvasContext.stroke();
    canvasContext.restore();
  }

  function segmentTouches(x1, y1, x2, y2, centerX, centerY, radius) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy || 1;
    const progress = clamp(
      ((centerX - x1) * dx + (centerY - y1) * dy) / lengthSquared,
      0,
      1
    );
    const closestX = x1 + dx * progress;
    const closestY = y1 + dy * progress;
    return Math.hypot(centerX - closestX, centerY - closestY) <= radius;
  }

  function createSoundWave(x, y) {
    const contactTargets = new Set();
    const points = Array.from({ length: WAVE_POINT_COUNT }, (_value, index) => {
      const angle = index / WAVE_POINT_COUNT * TWO_PI;
      return {
        x,
        y,
        prevX: x,
        prevY: y,
        dirX: Math.cos(angle),
        dirY: Math.sin(angle)
      };
    });

    return {
      kind: "sound-wave",
      combatKind: "zone",
      drawLayer: "background",
      life: PERMANENT_LIFE,
      x,
      y,
      originX: x,
      originY: y,
      radius: WAVE_LINE_RADIUS,
      points,
      contactTargets,
      update({ entity, game, services: waveServices }, dt) {
        const elapsed = Math.max(0, dt);
        const enemies = waveServices.getEnemies();
        const touchingTargets = new Map();

        for (const point of entity.points) {
          point.prevX = point.x;
          point.prevY = point.y;
          const motion = resolveArenaGeometry(game).advanceMotion({ x: point.x, y: point.y,
            vx: point.dirX * WAVE_SPEED, vy: point.dirY * WAVE_SPEED }, elapsed);
          point.x = motion.x; point.y = motion.y;
          point.dirX = motion.vx / WAVE_SPEED; point.dirY = motion.vy / WAVE_SPEED;

          for (const target of enemies) {
            const key = target.instanceId || target.id;
            if (touchingTargets.has(key)) continue;
            if (motion.segments.some(segment => segmentTouches(segment.x1, segment.y1,
              segment.x2, segment.y2, target.x, target.y, target.radius + entity.radius))) {
              touchingTargets.set(key, target);
            }
          }
        }

        // 每次“新进入波前锋”结算 1 点伤害；离开后再进入则再次结算
        for (const [key, target] of touchingTargets) {
          if (!entity.contactTargets.has(key)) {
            waveServices.dealDamage(target, WAVE_DAMAGE);
          }
        }
        entity.contactTargets = new Set(touchingTargets.keys());
      },
      draw({ entity }, canvasContext) {
        drawSoundWave(entity, canvasContext);
      }
    };
  }

  const soundWaveDefinition = {
    id: "soundWave",
    name: "音波",
    englishName: "Sound Wave",
    color: BODY_COLOR,
    description: "碰撞散发扩散音波 / 固定 1 伤且不衰减不消失 / 边缘回弹",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: WAVE_CYCLE,
    createBehavior(services) {
      let waveTimer = 0;

      return {
        update(context, dt) {
          waveTimer += dt;
          if (waveTimer + EPSILON < WAVE_CYCLE) return;
          waveTimer = 0;
          // 每 3.75 秒从本体中心自动释放一圈扩散音波
          services.playSound("shoot");
          services.spawnCombatEntity(createSoundWave(
            context.ball.x,
            context.ball.y
          ));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, WAVE_CYCLE - waveTimer);
        },
        drawBody(context, canvasContext) {
          return drawSoundWaveBody(context, canvasContext);
        }
      };
    }
  };

  registerBall(soundWaveDefinition);
  return { soundWaveDefinition };
});
