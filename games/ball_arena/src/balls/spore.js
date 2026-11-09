(function initializeSpore(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSporePlugin({ resolveArenaGeometry, registerBall }) {
  const VOLLEY_INTERVAL = 4.9;
  const VOLLEY_COUNT = 5;
  const SPEED_MIN = 175;
  const SPEED_MAX = 225;
  // 速度比例减速（由高到低曲线）：speed = v0 * e^(-RATE*t)，
  // 高速段减速快、低速段减速慢，全程距离 = v0 / RATE ≈ 100。
  const DECEL_RATE = 2;
  const STOP_SPEED = 8;
  const BUBBLE_RADIUS = 6;
  const BUBBLE_LIFE = 12;
  const MUSHROOM_RADIUS = 6;
  const MUSHROOM_SPIT_INTERVAL = 6.2;
  const MUSHROOM_SPIT_COUNT = 3;
  const BUBBLE_HIT_DAMAGE = 1;
  const MUSHROOM_HIT_DAMAGE = 2;
  // 菌场硬上限：超出时最年长的蘑菇自动碎裂。
  const MAX_MUSHROOMS = 50;
  const EPSILON = 1e-9;
  const BUBBLE_COLOR = "#3ddc5f";
  const MUSHROOM_COLOR = "#2fbf5f";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function randomSpeed() {
    return SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN);
  }

  function segmentClosest(startX, startY, endX, endY, x, y) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((x - startX) * deltaX + (y - startY) * deltaY) / lengthSquared, 0, 1);
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  function popBubble(entity) {
    if (!entity || entity.entityActive === false) return;
    entity.entityActive = false;
    entity.life = 0;
  }

  function shatterParticles(entityServices, entity, kind, colors, density) {
    entityServices.spawnParticleBurst({
      kind,
      x: entity.x,
      y: entity.y,
      colors,
      density,
      minDiameter: 1,
      maxDiameter: 4,
      minSpeed: 45,
      maxSpeed: 110,
      initialRadius: 3,
      life: 0.36,
      drag: 2.6
    });
  }

  function hitEnemiesOnSegment(entity, entityServices, startX, startY, damage) {
    entityServices.forEachEnemy((target) => {
      if (entity.entityActive === false) return;
      const closest = segmentClosest(startX, startY, entity.x, entity.y, target.x, target.y);
      if (Math.hypot(target.x - closest.x, target.y - closest.y) >
        target.radius + entity.radius) return;
      entityServices.dealDamage(target, damage);
      popBubble(entity);
      shatterParticles(
        entityServices,
        entity,
        "spore-bubble-pop",
        ["#8ef0a0", "#3ddc5f", "#d8ffd8", "#eaffef"],
        0.22
      );
    });
  }

  function drawBubble(entity, context) {
    const alpha = clamp(1 - entity.age / entity.life, 0, 1);
    context.save();
    context.globalAlpha *= alpha;
    context.fillStyle = "rgba(61, 220, 95, 0.35)";
    context.strokeStyle = BUBBLE_COLOR;
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(entity.x, entity.y, entity.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.75)";
    context.beginPath();
    context.arc(entity.x - 2, entity.y - 2.4, 1.6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawMushroom(entity, context) {
    const alpha = clamp(1 - entity.age / entity.life, 0, 1);
    const width = entity.radius * 2;
    const half = width / 2;
    const sway = Math.sin(entity.age * 1.4 + entity.phase) * 0.06;
    context.save();
    context.globalAlpha *= alpha;
    context.translate(entity.x, entity.y + entity.radius * 0.9);
    context.rotate(sway);
    // 落地影
    context.fillStyle = "rgba(18, 56, 28, 0.2)";
    context.beginPath();
    context.ellipse(0, 0.7, half * 0.92, 1.5, 0, 0, Math.PI * 2);
    context.fill();
    // 菌柄：微收腰的奶油色柄
    context.fillStyle = "#f7ecc8";
    context.strokeStyle = "#d8cca4";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(-2.4, 0);
    context.bezierCurveTo(-2.3, -2.6, -1.7, -4.2, -1.9, -5.1);
    context.lineTo(1.9, -5.1);
    context.bezierCurveTo(1.7, -4.2, 2.3, -2.6, 2.4, 0);
    context.closePath();
    context.fill();
    context.stroke();
    // 菌柄菌环
    context.strokeStyle = "#c9bc94";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(-1.75, -4.15);
    context.quadraticCurveTo(0, -3.65, 1.75, -4.15);
    context.stroke();
    // 菌褶：盖底深绿椭圆 + 放射褶线
    context.fillStyle = "#22804a";
    context.beginPath();
    context.ellipse(0, -5.0, half * 0.99, 1.9, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(10, 48, 24, 0.45)";
    context.lineWidth = 0.6;
    for (let index = -3; index <= 3; index += 1) {
      context.beginPath();
      context.moveTo(0, -4.5);
      context.lineTo(index * 1.5, -5.6 + Math.abs(index) * 0.22);
      context.stroke();
    }
    // 菌盖：穹顶渐变
    const gradient = context.createLinearGradient(0, -9, 0, -4.6);
    gradient.addColorStop(0, "#53e284");
    gradient.addColorStop(0.55, "#2fbf5f");
    gradient.addColorStop(1, "#1f9448");
    context.fillStyle = gradient;
    context.strokeStyle = "#8ef0a0";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(-half, -5.0);
    context.quadraticCurveTo(-half * 0.55, -8.7, 0, -8.7);
    context.quadraticCurveTo(half * 0.55, -8.7, half, -5.0);
    context.closePath();
    context.fill();
    context.stroke();
    // 盖顶高光
    context.strokeStyle = "rgba(255, 255, 255, 0.5)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(-half * 0.62, -7.7);
    context.quadraticCurveTo(-half * 0.22, -8.5, half * 0.05, -8.4);
    context.stroke();
    // 菌盖斑点
    context.fillStyle = "#eaffef";
    const spots = [
      [-half * 0.5, -7.0, 1.15],
      [half * 0.08, -7.9, 0.9],
      [half * 0.55, -6.3, 0.95],
      [-half * 0.12, -6.1, 0.7]
    ];
    for (const [spotX, spotY, spotR] of spots) {
      context.beginPath();
      context.arc(spotX, spotY, spotR, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  function spawnBubble(state, services, x, y, speed, angle) {
    // 吐泡泡时的统一粒子特效（本体与蘑菇共用）。
    services.spawnParticleBurst({
      kind: "spore-bubble-emit",
      x,
      y,
      colors: ["#8ef0a0", "#3ddc5f", "#d8ffd8"],
      density: 0.25,
      minDiameter: 1,
      maxDiameter: 3,
      minSpeed: 24,
      maxSpeed: 70,
      initialRadius: 3,
      life: 0.32,
      drag: 2.8
    });
    const bubble = services.spawnCombatEntity({
      kind: "spore-bubble",
      combatKind: "zone",
      life: BUBBLE_LIFE,
      x,
      y,
      radius: BUBBLE_RADIUS,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      phase: Math.random() * Math.PI * 2,
      update({ entity, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        let speedNow = Math.hypot(entity.vx, entity.vy);
        if (speedNow <= STOP_SPEED) {
          // 彻底停下：原地变为蘑菇。
          entity.entityActive = false;
          entity.life = 0;
          spawnMushroom(state, entityServices, entity.x, entity.y, entity.radius, game);
          return;
        }
        const nextSpeed = speedNow * Math.exp(-DECEL_RATE * elapsed);
        const directionX = entity.vx / speedNow;
        const directionY = entity.vy / speedNow;
        entity.vx = directionX * nextSpeed;
        entity.vy = directionY * nextSpeed;
        const motion = resolveArenaGeometry(game).advanceMotion(entity, elapsed);
        Object.assign(entity, { x: motion.x, y: motion.y, vx: motion.vx, vy: motion.vy });
        for (const segment of motion.segments) {
          entity.x = segment.x2; entity.y = segment.y2;
          hitEnemiesOnSegment(entity, entityServices, segment.x1, segment.y1, BUBBLE_HIT_DAMAGE);
          if (entity.life <= 0 || entity.entityActive === false) break;
        }
        if (entity.life > 0 && entity.entityActive !== false) { entity.x = motion.x; entity.y = motion.y; }
      },
      draw({ entity }, context) {
        drawBubble(entity, context);
      }
    });
    state.bubbles.push(bubble);
    return bubble;
  }

  function createMushroomSummonDefinition(state) {
    // 每次生成独立的蘑菇定义：闭包共享同一个回合状态。
    const phase = Math.random() * Math.PI * 2;
    return {
      id: "spore-mushroom",
      name: "\u5b62\u5b50\u8611\u83c7",
      englishName: "Spore Mushroom",
      color: "#2fbf5f",
      fixedStructure: true,
      // 第三方独立单位：1 点血量，可被敌方攻击消除。
      stats: { radius: MUSHROOM_RADIUS, speed: 1, maxHp: 1 },
      createBehavior(services) {
        let spitTimer = 0;
        let ballRef = null;
        return {
          onSpawn(context) {
            ballRef = context.ball;
          },
          update(context, dt) {
            const elapsed = Math.max(0, dt);
            spitTimer += elapsed;
            while (spitTimer + EPSILON >= MUSHROOM_SPIT_INTERVAL) {
              spitTimer -= MUSHROOM_SPIT_INTERVAL;
              for (let index = 0; index < MUSHROOM_SPIT_COUNT; index += 1) {
                spawnBubble(
                  state,
                  services,
                  context.ball.x,
                  context.ball.y,
                  randomSpeed(),
                  Math.random() * Math.PI * 2
                );
              }
            }
          },
          onCollision(context, target) {
            if (context.blockedAtContact) return;
            context.services.dealDamage(target, MUSHROOM_HIT_DAMAGE);
            // 触碰即碎：血量为 1，一击消除。
            context.ball.hp = 0;
          },
          onDeath() {
            if (ballRef) {
              shatterParticles(
                services,
                ballRef,
                "spore-mushroom-shatter",
                ["#2fbf5f", "#8ef0a0", "#f7ecc8", "#eaffef"],
                0.4
              );
            }
          },
          drawBody(context, canvasContext) {
            drawMushroom(
              {
                x: context.ball.x,
                y: context.ball.y,
                radius: context.ball.radius,
                age: context.game.time,
                phase,
                life: Number.MAX_SAFE_INTEGER
              },
              canvasContext
            );
            return true;
          },
          getHpDisplay() {
            // 无血量显示：小单位不压数字。
            return { hidden: true };
          }
        };
      }
    };
  }

  function activeMushroomCount(state) {
    return state.mushrooms.reduce((count, mushroom) => (
      count + (mushroom && mushroom.hp > 0 && mushroom.active !== false ? 1 : 0)
    ), 0);
  }

  function spawnMushroom(state, services, x, y, radius, game) {
    // 蘑菇是第三方有血量单位：通过召唤服务生成（实体服务没有 spawnSummon，
    // 因此泡泡转蘑菇必须走持有者服务）。
    const summonServices = state.ownerServices || services;
    // 场地上限：超出 50 只时，最年长的蘑菇自动碎裂腾位。
    if (activeMushroomCount(state) >= MAX_MUSHROOMS) {
      const oldest = state.mushrooms.find((mushroom) => (
        mushroom && mushroom.hp > 0 && mushroom.active !== false
      ));
      if (oldest) oldest.hp = 0;
    }
    const mushroom = summonServices.spawnSummon(
      createMushroomSummonDefinition(state),
      { x, y, movementLocked: true, positionLocked: true }
    );
    if (mushroom) state.mushrooms.push(mushroom);
    return mushroom;
  }

  const sporeDefinition = {
    id: "spore",
    name: "\u5b62\u5b50",
    englishName: "Spore",
    color: "#68b96b",
    description: "\u5f39\u8df3\u6ce1\u6ce1 / \u505c\u4e0b\u53d8\u8611\u83c7 / \u78b0\u6478\u788e\u88c2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: VOLLEY_INTERVAL,
    createBehavior(services) {
      let volleyTimer = 0;
      const state = { bubbles: [], mushrooms: [], ownerServices: services };

      function prune() {
        for (let index = state.bubbles.length - 1; index >= 0; index -= 1) {
          if (state.bubbles[index].entityActive === false) state.bubbles.splice(index, 1);
        }
        for (let index = state.mushrooms.length - 1; index >= 0; index -= 1) {
          const mushroom = state.mushrooms[index];
          if (!mushroom || mushroom.hp <= 0 || mushroom.active === false) {
            state.mushrooms.splice(index, 1);
          }
        }
      }

      function fireVolley(context) {
        const ball = context.ball;
        for (let index = 0; index < VOLLEY_COUNT; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          spawnBubble(state, services, ball.x, ball.y, randomSpeed(), angle);
        }
      }

      return {
        update(context, dt) {
          const elapsed = Math.max(0, dt);
          volleyTimer = Math.min(VOLLEY_INTERVAL, volleyTimer + elapsed);
          prune();
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, VOLLEY_INTERVAL - volleyTimer);
        },
        afterUpdateStep(context) {
          if (volleyTimer + EPSILON < VOLLEY_INTERVAL) return;
          volleyTimer = 0;
          fireVolley(context);
        },
        onDeath() {
          for (const mushroom of state.mushrooms) {
            if (mushroom && mushroom.hp > 0) mushroom.hp = 0;
          }
        },
        getSporeState() {
          return {
            bubbles: state.bubbles.filter((bubble) => bubble.entityActive !== false).length,
            mushrooms: state.mushrooms.filter((mushroom) => (
              mushroom.active !== false && mushroom.hp > 0
            )).length
          };
        }
      };
    }
  };

  registerBall(sporeDefinition);
  return { sporeDefinition, spawnBubble, spawnMushroom, drawBubble, drawMushroom };
});
