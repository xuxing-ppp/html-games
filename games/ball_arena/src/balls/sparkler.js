(function initializeSparkler(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSparklerPlugin({ registerBall }) {
  const BURST_INTERVAL = 0.02;
  const SPARKS_PER_BURST = 3;
  const FIELD_RADIUS = 150;
  const SPARK_RADIUS = 5;
  const SPARK_DAMAGE = 3;
  const SPARK_LIFE = 0.27;
  const EPSILON = 1e-9;
  const CONNECTION_EVEN = [1, 0.918, 0.627];
  const CONNECTION_ODD = [1, 0.847, 0.416];
  const RAY_WHITE = [1, 0.992, 0.945];
  const RAY_GOLD = [1, 0.914, 0.525];
  const RAY_AMBER = [1, 0.788, 0.239];
  const DIRECTION_TABLE_SIZE = 2048;
  const DIRECTION_TABLE_MASK = DIRECTION_TABLE_SIZE - 1;
  const DIRECTION_COSINES = new Float32Array(DIRECTION_TABLE_SIZE);
  const DIRECTION_SINES = new Float32Array(DIRECTION_TABLE_SIZE);
  for (let index = 0; index < DIRECTION_TABLE_SIZE; index += 1) {
    const angle = Math.PI * 2 * index / DIRECTION_TABLE_SIZE;
    DIRECTION_COSINES[index] = Math.cos(angle);
    DIRECTION_SINES[index] = Math.sin(angle);
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function createSparkVisual(point, index) {
    const rayCount = 7 + index % 4;
    const rays = Array.from({ length: rayCount }, (_value, rayIndex) => {
      const direction = Math.random();
      const angle = direction * Math.PI * 2;
      const directionIndex = (direction * DIRECTION_TABLE_SIZE + 0.5) &
        DIRECTION_TABLE_MASK;
      return {
        angle,
        directionIndex,
        length: 5 + Math.random() * 10,
        width: rayIndex % 3 === 0 ? 1.15 : 0.65,
        shade: (index + rayIndex) % 3,
        drift: (Math.random() - 0.5) * 4
      };
    });
    return {
      ...point,
      rays,
      phase: Math.random() * Math.PI * 2,
      coreSize: 1.2 + Math.random() * 1.5
    };
  }

  function createSparkBatch(center, points) {
    const sparks = points.map(createSparkVisual);
    return {
      kind: "sparkler-micro-burst",
      life: SPARK_LIFE,
      effectiveRadius: SPARK_RADIUS,
      centerX: center.x,
      centerY: center.y,
      sparks,
      pendingHits: true,
      update({ effect, services: entityServices }) {
        if (!effect.pendingHits) return;
        effect.pendingHits = false;
        effect.sparks.forEach((spark) => {
          entityServices.forEachEnemy((enemy) => {
            if (Math.hypot(enemy.x - spark.x, enemy.y - spark.y) > (
              SPARK_RADIUS + enemy.radius
            )) return;
            entityServices.dealDamage(enemy, SPARK_DAMAGE);
          });
        });
      },
      draw({ effect, game }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const flare = progress < 0.16 ? progress / 0.16 : 1;
        const fade = Math.max(0, 1 - progress);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.lineCap = "round";
        effect.sparks.forEach((spark, sparkIndex) => {
          const deltaX = spark.x - effect.centerX;
          const deltaY = spark.y - effect.centerY;
          const distance = Math.hypot(deltaX, deltaY) || 1;
          const normalX = -deltaY / distance;
          const normalY = deltaX / distance;
          const bend = Math.sin(spark.phase + progress * 5) * Math.min(4, distance * 0.035);
          const middleX = effect.centerX + deltaX * 0.52 + normalX * bend;
          const middleY = effect.centerY + deltaY * 0.52 + normalY * bend;
          context.globalAlpha = flare * fade * (sparkIndex % 2 === 0 ? 0.58 : 0.42);
          context.shadowColor = "#fff0a0";
          context.shadowBlur = 4 * fade;
          context.strokeStyle = sparkIndex % 2 === 0 ? "#ffeaa0" : "#ffd86a";
          context.lineWidth = 0.62 * fade;
          context.beginPath();
          context.moveTo(effect.centerX, effect.centerY);
          context.lineTo(middleX, middleY);
          context.lineTo(spark.x, spark.y);
          context.stroke();
        });

        context.globalAlpha = flare * fade * 0.9;
        context.shadowColor = "#fff6bf";
        context.shadowBlur = 9 * fade;
        context.fillStyle = "#fffdf0";
        context.beginPath();
        context.arc(effect.centerX, effect.centerY, 1.5 + fade * 1.3, 0, Math.PI * 2);
        context.fill();

        effect.sparks.forEach((spark, sparkIndex) => {
          const flicker = 0.72 + 0.28 * Math.sin(
            game.time * 90 + spark.phase + sparkIndex
          );
          const alpha = flare * fade * flicker;
          context.shadowColor = "#fff4a8";
          context.shadowBlur = 7 * fade;
          spark.rays.forEach((ray) => {
            const travel = 0.3 + progress * 0.78;
            const inner = ray.length * Math.max(0, progress - 0.18) * 0.35;
            const outer = ray.length * travel;
            const angle = ray.angle + ray.drift * progress * 0.04;
            const cosine = Math.cos(angle);
            const sine = Math.sin(angle);
            context.globalAlpha = alpha * (ray.shade === 0 ? 1 : 0.76);
            context.strokeStyle = ray.shade === 0
              ? "#fffdf1"
              : (ray.shade === 1 ? "#ffe986" : "#ffc93d");
            context.lineWidth = ray.width * fade;
            context.beginPath();
            context.moveTo(
              spark.x + cosine * inner,
              spark.y + sine * inner
            );
            context.lineTo(
              spark.x + cosine * outer,
              spark.y + sine * outer
            );
            context.stroke();

            if (ray.shade !== 0 || progress < 0.18) return;
            const tipX = spark.x + cosine * outer;
            const tipY = spark.y + sine * outer;
            const starSize = (1.6 + ray.width) * fade;
            context.lineWidth = 0.7 * fade;
            context.beginPath();
            context.moveTo(tipX - starSize, tipY);
            context.lineTo(tipX + starSize, tipY);
            context.moveTo(tipX, tipY - starSize);
            context.lineTo(tipX, tipY + starSize);
            context.stroke();
          });

          context.globalAlpha = alpha;
          context.shadowBlur = 10 * fade;
          context.fillStyle = "#fffef2";
          context.beginPath();
          context.arc(
            spark.x,
            spark.y,
            spark.coreSize * (0.65 + fade * 0.55),
            0,
            Math.PI * 2
          );
          context.fill();
          context.globalAlpha = alpha * 0.72;
          context.fillStyle = "#ffe45f";
          context.fillRect(
            spark.x - SPARK_RADIUS * fade,
            spark.y - 0.35,
            SPARK_RADIUS * 2 * fade,
            0.7
          );
          context.fillRect(
            spark.x - 0.35,
            spark.y - SPARK_RADIUS * fade,
            0.7,
            SPARK_RADIUS * 2 * fade
          );
        });
        context.restore();
      },
      drawGpu({ effect, game }, batch) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const flare = progress < 0.16 ? progress / 0.16 : 1;
        const fade = Math.max(0, 1 - progress);
        const travel = 0.3 + progress * 0.78;
        const innerScale = Math.max(0, progress - 0.18) * 0.35;

        for (let sparkIndex = 0; sparkIndex < effect.sparks.length; sparkIndex += 1) {
          const spark = effect.sparks[sparkIndex];
          const deltaX = spark.x - effect.centerX;
          const deltaY = spark.y - effect.centerY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
          const normalX = -deltaY / distance;
          const normalY = deltaX / distance;
          const bend = Math.sin(spark.phase + progress * 5) *
            Math.min(4, distance * 0.035);
          const middleX = effect.centerX + deltaX * 0.52 + normalX * bend;
          const middleY = effect.centerY + deltaY * 0.52 + normalY * bend;
          const connection = sparkIndex % 2 === 0 ? CONNECTION_EVEN : CONNECTION_ODD;
          const alpha = flare * fade * (sparkIndex % 2 === 0 ? 0.58 : 0.42);
          const glowWidth = Math.max(0.8, 3.8 * fade);
          const coreWidth = Math.max(0.35, 0.62 * fade);
          batch.addLinePair(
            effect.centerX, effect.centerY, middleX, middleY,
            glowWidth, alpha * 0.16, coreWidth, alpha,
            connection[0], connection[1], connection[2]
          );
          batch.addLinePair(
            middleX, middleY, spark.x, spark.y,
            glowWidth, alpha * 0.16, coreWidth, alpha,
            connection[0], connection[1], connection[2]
          );
        }

        const centerAlpha = flare * fade * 0.9;
        batch.addDisc(
          effect.centerX,
          effect.centerY,
          6 + fade * 4,
          1,
          0.965,
          0.749,
          centerAlpha * 0.12
        );
        batch.addDisc(
          effect.centerX,
          effect.centerY,
          1.5 + fade * 1.3,
          1,
          0.992,
          0.941,
          centerAlpha
        );

        for (let sparkIndex = 0; sparkIndex < effect.sparks.length; sparkIndex += 1) {
          const spark = effect.sparks[sparkIndex];
          const flicker = 0.72 + 0.28 * Math.sin(
            game.time * 90 + spark.phase + sparkIndex
          );
          const alpha = flare * fade * flicker;
          for (let rayIndex = 0; rayIndex < spark.rays.length; rayIndex += 1) {
            const ray = spark.rays[rayIndex];
            const drift = ray.drift * progress * 0.04;
            const baseCosine = DIRECTION_COSINES[ray.directionIndex];
            const baseSine = DIRECTION_SINES[ray.directionIndex];
            const cosine = baseCosine - baseSine * drift;
            const sine = baseSine + baseCosine * drift;
            const inner = ray.length * innerScale;
            const outer = ray.length * travel;
            const startX = spark.x + cosine * inner;
            const startY = spark.y + sine * inner;
            const endX = spark.x + cosine * outer;
            const endY = spark.y + sine * outer;
            const color = ray.shade === 0
              ? RAY_WHITE
              : (ray.shade === 1 ? RAY_GOLD : RAY_AMBER);
            const rayAlpha = alpha * (ray.shade === 0 ? 1 : 0.76);
            const rayWidth = Math.max(0.3, ray.width * fade);
            batch.addLinePair(
              startX,
              startY,
              endX,
              endY,
              rayWidth + 3.2 * fade,
              rayAlpha * 0.14,
              rayWidth,
              rayAlpha,
              color[0],
              color[1],
              color[2]
            );

            if (ray.shade === 0 && progress >= 0.18) {
              const starSize = (1.6 + ray.width) * fade;
              const starWidth = Math.max(0.3, 0.7 * fade);
              batch.addLine(
                endX - starSize,
                endY,
                endX + starSize,
                endY,
                starWidth,
                1,
                0.992,
                0.945,
                rayAlpha * 0.86
              );
              batch.addLine(
                endX,
                endY - starSize,
                endX,
                endY + starSize,
                starWidth,
                1,
                0.992,
                0.945,
                rayAlpha * 0.86
              );
            }
          }

          const coreRadius = spark.coreSize * (0.65 + fade * 0.55);
          batch.addDisc(
            spark.x,
            spark.y,
            coreRadius + 5 * fade,
            1,
            0.957,
            0.659,
            alpha * 0.13
          );
          batch.addDisc(spark.x, spark.y, coreRadius, 1, 0.996, 0.949, alpha);
          const crossRadius = SPARK_RADIUS * fade;
          const crossWidth = Math.max(0.3, 0.7 * fade);
          batch.addLine(
            spark.x - crossRadius,
            spark.y,
            spark.x + crossRadius,
            spark.y,
            crossWidth,
            1,
            0.894,
            0.373,
            alpha * 0.72
          );
          batch.addLine(
            spark.x,
            spark.y - crossRadius,
            spark.x,
            spark.y + crossRadius,
            crossWidth,
            1,
            0.894,
            0.373,
            alpha * 0.72
          );
        }
      }
    };
  }

  function randomPointAround(ball) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * FIELD_RADIUS;
    return {
      x: ball.x + Math.cos(angle) * radius,
      y: ball.y + Math.sin(angle) * radius
    };
  }

  const sparklerDefinition = {
    id: "sparkler",
    name: "\u4ed9\u5973\u68d2",
    englishName: "Sparkler",
    color: "#ffe43b",
    description: "0.03\u79d23\u70b9\u5fae\u578b\u706b\u5149 / \u534a\u5f84150\u968f\u673a\u7206\u95ea",
    renderAboveGpuEffects: true,
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 3,
    createBehavior(services) {
      let burstTimer = 0;
      return {
        update(_context, dt) {
          burstTimer = Math.min(BURST_INTERVAL, burstTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, BURST_INTERVAL - burstTimer);
        },
        afterUpdateStep(context) {
          if (burstTimer + EPSILON < BURST_INTERVAL) return;
          burstTimer = 0;
          const points = Array.from(
            { length: SPARKS_PER_BURST },
            () => randomPointAround(context.ball)
          );
          services.spawnCombatEntity(createSparkBatch({
            x: context.ball.x,
            y: context.ball.y
          }, points));
        }
      };
    }
  };

  registerBall(sparklerDefinition);
  return { sparklerDefinition };
});
