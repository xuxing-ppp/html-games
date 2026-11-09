(function initializeGreedySnake(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGreedySnakePlugin({ registerBall, resolveArenaGeometry }) {
  const GROWTH_STAGES = 3;
  const INITIAL_SEGMENTS = 2;
  const FIRST_SEGMENT_DIAMETER = 29;
  const MIN_SEGMENT_DIAMETER = 6;
  const COLLISION_DAMAGE = 5;
  const MAX_SEGMENTS = 30;
  // 青苹果：场内每 0.7s 在随机位置生成一枚，蛇头吃掉成长一次，
  // 敌方碰到则受到 3 点伤害。苹果无自然寿命，被吃或主人死亡才消失，
  // 同时用场上数量上限防止无限堆积。
  const APPLE_INTERVAL = 0.7;
  const APPLE_RADIUS = 10;
  const APPLE_DAMAGE = 1;
  const APPLE_MARGIN = 14;
  const APPLE_MIN_GAP = 36;
  const APPLE_BALL_GAP = 28;
  const APPLE_MAX = 6;
  const APPLE_LIFE = 3600;
  const APPLE_COLOR = "#59c93c";
  const APPLE_OUTLINE = "#2e7d1e";
  // Open-space links recover to exact touching distance. Near walls they may
  // compress, preserving continuity instead of flipping to the other side.
  const SEGMENT_GAP = 0;
  const TRAIL_MARGIN = 40;
  const TRAIL_SMOOTHING_DISTANCE = 8;
  const SWAY_ANGLE = 0.16;
  const SWAY_SPEED = 5;
  const SWAY_PHASE = 0.95;
  const TAIL_EXPAND_SPEED = 90;
  const MAX_TAIL_NODE_SPEED = 330;
  const BODY_COLOR = "#35c759";
  const TAIL_COLOR = "#16833a";
  const SOFT_BODY_COLOR = "#39f06f";
  const SOFT_TAIL_COLOR = "#16ad52";
  const SOFT_SWAY_ANGLE = 0.42;
  const SOFT_SWAY_SPEED = 8.5;
  const SOFT_WAVE_SPEED_MULTIPLIER = 1;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function targetKey(target) {
    return target.instanceId || target;
  }

  // Direction the tail trails away from the head (opposite of travel).
  function headBackAngle(ball, game) {
    const vx = Math.abs(ball.vx) + Math.abs(ball.vy) > EPSILON
      ? ball.vx
      : ball.storedVx;
    const vy = Math.abs(ball.vx) + Math.abs(ball.vy) > EPSILON
      ? ball.vy
      : ball.storedVy;
    if (Math.hypot(vx, vy) <= EPSILON) {
      return ball.x < game.arenaSize / 2 ? 0 : Math.PI;
    }
    return Math.atan2(-vy, -vx);
  }

  function segmentDiameter(index) {
    return Math.max(MIN_SEGMENT_DIAMETER, FIRST_SEGMENT_DIAMETER - index);
  }

  function maximumArenaSpacing(parent, radius, angle, arenaSize) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const arena = resolveArenaGeometry(arenaSize);
    return arena.movementLimit(parent.x, parent.y, directionX, directionY, arena.size * 2, radius);
  }

  function sampleTrail(path, distance, fallbackX, fallbackY) {
    let remaining = Math.max(0, distance);
    for (let index = path.length - 1; index > 0; index -= 1) {
      const newer = path[index];
      const older = path[index - 1];
      const deltaX = older.x - newer.x;
      const deltaY = older.y - newer.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length <= EPSILON) continue;
      if (remaining <= length) {
        const progress = remaining / length;
        return {
          x: newer.x + deltaX * progress,
          y: newer.y + deltaY * progress
        };
      }
      remaining -= length;
    }
    const oldest = path[0];
    return {
      x: oldest.x + fallbackX * remaining,
      y: oldest.y + fallbackY * remaining
    };
  }

  function sampleSmoothedTrail(path, distance, fallbackX, fallbackY) {
    const before = sampleTrail(
      path,
      Math.max(0, distance - TRAIL_SMOOTHING_DISTANCE),
      fallbackX,
      fallbackY
    );
    const center = sampleTrail(path, distance, fallbackX, fallbackY);
    const after = sampleTrail(
      path,
      distance + TRAIL_SMOOTHING_DISTANCE,
      fallbackX,
      fallbackY
    );
    return {
      x: before.x * 0.25 + center.x * 0.5 + after.x * 0.25,
      y: before.y * 0.25 + center.y * 0.5 + after.y * 0.25
    };
  }

  function resolveTailOverlap(segment, target, arenaSize) {
    let dx = target.x - segment.x;
    let dy = target.y - segment.y;
    let distance = Math.hypot(dx, dy);
    const minimumDistance = segment.radius + target.radius;
    if (distance >= minimumDistance) return false;

    if (distance <= EPSILON) {
      const velocityMagnitude = Math.hypot(target.vx, target.vy);
      if (velocityMagnitude > EPSILON) {
        dx = -target.vx / velocityMagnitude;
        dy = -target.vy / velocityMagnitude;
      } else {
        dx = 1;
        dy = 0;
      }
      distance = 1;
    }
    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minimumDistance - distance;
    if (!target.positionLocked) {
      Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(
        target.x + nx * overlap, target.y + ny * overlap, target.radius));
    }

    const velocityDot = target.vx * nx + target.vy * ny;
    if (velocityDot < 0) {
      target.vx -= 2 * velocityDot * nx;
      target.vy -= 2 * velocityDot * ny;
    }
    const storedDot = target.storedVx * nx + target.storedVy * ny;
    if (storedDot < 0) {
      target.storedVx -= 2 * storedDot * nx;
      target.storedVy -= 2 * storedDot * ny;
    }
    return true;
  }

  function drawTail(canvasContext, segments, tailColor) {
    canvasContext.save();
    canvasContext.shadowBlur = 3;
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      const segment = segments[index];
      canvasContext.fillStyle = tailColor;
      canvasContext.shadowColor = tailColor;
      canvasContext.beginPath();
      canvasContext.arc(segment.x, segment.y, segment.radius, 0, Math.PI * 2);
      canvasContext.fill();
    }
    canvasContext.restore();
  }

  // 青苹果：亮绿果身 + 深绿描边 + 右上一片小叶子 + 棕色果柄 + 高光渐变，
  // 带轻微呼吸缩放，直径约 20（半径 10）。
  function drawApple(entity, context) {
    const radius = APPLE_RADIUS;
    const breath = 1 + Math.sin(entity.age * 3.2 + entity.wavePhase) * 0.03;
    context.save();
    context.translate(entity.x, entity.y);
    context.scale(breath, breath);
    // 果柄
    context.strokeStyle = "#7a4a21";
    context.lineWidth = 1.7;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(0, -radius * 0.66);
    context.quadraticCurveTo(
      radius * 0.14,
      -radius * 1.05,
      radius * 0.42,
      -radius * 1.28
    );
    context.stroke();
    // 叶子
    context.fillStyle = "#2f9e44";
    context.beginPath();
    context.ellipse(
      radius * 0.52,
      -radius * 1.02,
      radius * 0.42,
      radius * 0.2,
      -0.55,
      0,
      Math.PI * 2
    );
    context.fill();
    // 果身
    context.fillStyle = APPLE_COLOR;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = APPLE_OUTLINE;
    context.lineWidth = 1.2;
    context.stroke();
    // 高光 + 底部微暗
    const shine = context.createRadialGradient(
      -radius * 0.35,
      -radius * 0.4,
      radius * 0.1,
      0,
      0,
      radius * 1.05
    );
    shine.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    shine.addColorStop(0.4, "rgba(255, 255, 255, 0.1)");
    shine.addColorStop(1, "rgba(20, 90, 10, 0.14)");
    context.fillStyle = shine;
    context.beginPath();
    context.arc(0, 0, radius - 0.7, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  // 青苹果被吃时的绿色粒子迸发
  function spawnAppleBurst(x, y, burstServices) {
    burstServices.spawnParticleBurst({
      x,
      y,
      colors: ["#8ff06b", "#4cae3d", "#d9ffc2"],
      count: 14,
      minDiameter: 1,
      maxDiameter: 3.5,
      minSpeed: 26,
      maxSpeed: 82,
      life: 0.45
    });
  }

  function createSnakeBehavior(services, options = {}) {
      const softTail = options.softTail === true;
      const appleGrowth = options.appleGrowth === true;
      const collisionDamage = Number.isFinite(options.collisionDamage)
        ? options.collisionDamage
        : COLLISION_DAMAGE;
      const tailColor = options.tailColor || TAIL_COLOR;
      const segments = [];
      const headTrail = [];
      const tailContacts = new Set();
      const lastHeadContactAt = new Map();
      const apples = [];
      let appleTimer = APPLE_INTERVAL * 0.5;
      let motionInitialized = false;
      let contactCount = 0;
      let initialized = false;
      let activeBall = null;

      function pruneApples() {
        for (let index = apples.length - 1; index >= 0; index -= 1) {
          if (!apples[index] || apples[index].entityActive === false) {
            apples.splice(index, 1);
          }
        }
      }

      function aliveAppleCount() {
        let count = 0;
        for (const apple of apples) {
          if (apple && apple.entityActive !== false) count += 1;
        }
        return count;
      }

      // 随机位置生成一枚青苹果：留出墙边距，避开已有苹果与其他球
      function spawnApple(ball, game) {
        const spacing = APPLE_MARGIN;
        const arena = resolveArenaGeometry(game);
        let { x, y } = arena.samplePoint(Math.random, spacing);
        const nearbyBalls = [ball, ...services.getAllies(), ...services.getEnemies()];
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const tooCloseToApple = apples.some((apple) => (
            apple.entityActive !== false &&
            Math.hypot(apple.x - x, apple.y - y) < APPLE_MIN_GAP
          ));
          const tooCloseToBall = nearbyBalls.some((target) => (
            Math.hypot(target.x - x, target.y - y) <
              target.radius + APPLE_RADIUS + APPLE_BALL_GAP
          ));
          if (!tooCloseToApple && !tooCloseToBall) break;
          ({ x, y } = arena.samplePoint(Math.random, spacing));
        }
        const apple = services.spawnCombatEntity({
          kind: "greedy-snake-apple",
          combatKind: "zone",
          lifecycle: "owner-bound",
          life: APPLE_LIFE,
          x,
          y,
          wavePhase: Math.random() * Math.PI * 2,
          update({ entity, services: appleServices }) {
            if (entity.entityActive === false) return;
            let consumed = false;
            appleServices.forEachEnemy((target) => {
              if (consumed || entity.entityActive === false) return;
              if (
                Math.hypot(target.x - entity.x, target.y - entity.y) >
                target.radius + APPLE_RADIUS
              ) {
                return;
              }
              consumed = true;
              entity.entityActive = false;
              appleServices.dealDamage(target, APPLE_DAMAGE);
              spawnAppleBurst(entity.x, entity.y, appleServices);
            });
          },
          draw({ entity }, context) {
            drawApple(entity, context);
          }
        });
        apples.push(apple);
      }

      // 蛇头吃掉：成长一次 + 绿色迸发
      function eatApplesAtHead(ball, game) {
        for (const apple of apples) {
          if (!apple || apple.entityActive === false) continue;
          if (
            Math.hypot(ball.x - apple.x, ball.y - apple.y) >
            ball.radius + APPLE_RADIUS
          ) {
            continue;
          }
          apple.entityActive = false;
          advanceTailGrowth(ball, game);
          spawnAppleBurst(apple.x, apple.y, services);
        }
      }

      function constrainPoint(x, y, radius, game) {
        return softTail ? { x, y } : resolveArenaGeometry(game).clampPoint(x, y, radius);
      }

      function tailWave(time, trailDistance, index, ball) {
        if (!softTail) {
          return Math.sin(time * SWAY_SPEED - index * SWAY_PHASE) * SWAY_ANGLE;
        }
        const propagationSpeed = Math.max(
          EPSILON,
          ball.speed * SOFT_WAVE_SPEED_MULTIPLIER
        );
        const phase = time * SOFT_SWAY_SPEED -
          trailDistance * SOFT_SWAY_SPEED / propagationSpeed;
        const amplitude = SOFT_SWAY_ANGLE * (1 + Math.min(index, 8) * 0.12);
        return Math.sin(phase) * amplitude;
      }

      function recordHeadTrail(ball) {
        const latest = headTrail.at(-1);
        if (!latest || Math.hypot(ball.x - latest.x, ball.y - latest.y) > EPSILON) {
          headTrail.push({ x: ball.x, y: ball.y });
        }
        const requiredDistance = segments.reduce((total, segment, index) => (
          total + (index === 0 ? ball.radius : segments[index - 1].radius) +
            segment.radius + SEGMENT_GAP
        ), 0) + TRAIL_MARGIN;
        let retainedDistance = 0;
        let firstRetained = headTrail.length - 1;
        for (let index = headTrail.length - 1; index > 0; index -= 1) {
          retainedDistance += Math.hypot(
            headTrail[index].x - headTrail[index - 1].x,
            headTrail[index].y - headTrail[index - 1].y
          );
          firstRetained = index - 1;
          if (retainedDistance >= requiredDistance) break;
        }
        if (firstRetained > 0) headTrail.splice(0, firstRetained);
      }

      // Position is the only movement state. Every node approaches a nearby
      // target on the head trail with a strict per-frame speed cap. The link is
      // pulled back only when stretched beyond full length; when space is tight
      // it may compress and keeps squeezing through on the same side.
      function positionSegments(ball, game, dt = 0) {
        recordHeadTrail(ball);
        const moving = Math.hypot(ball.vx, ball.vy) > EPSILON ||
          Math.hypot(ball.storedVx, ball.storedVy) > EPSILON;
        if (dt > 0 && moving && !motionInitialized) {
          motionInitialized = true;
          const backAngle = headBackAngle(ball, game);
          let parent = { x: ball.x, y: ball.y, radius: ball.radius };
          let initialTrailDistance = 0;
          segments.forEach((segment, index) => {
            segment.angle = backAngle;
            const spacing = parent.radius + segment.radius + SEGMENT_GAP;
            initialTrailDistance += spacing;
            segment.sway = tailWave(
              services.getTime(),
              initialTrailDistance,
              index,
              ball
            );
            segment.spacing = spacing;
            Object.assign(segment, constrainPoint(parent.x + Math.cos(backAngle) * spacing,
              parent.y + Math.sin(backAngle) * spacing, segment.radius, game));
            parent = segment;
          });
        }

        let parent = { x: ball.x, y: ball.y, radius: ball.radius };
        let trailDistance = 0;
        const time = services.getTime();
        const backAngle = headBackAngle(ball, game);
        const fallbackX = Math.cos(backAngle);
        const fallbackY = Math.sin(backAngle);
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index];
          const fullSpacing = parent.radius + segment.radius + SEGMENT_GAP;
          trailDistance += fullSpacing;
          const trailTarget = sampleSmoothedTrail(
            headTrail,
            trailDistance,
            fallbackX,
            fallbackY
          );
          const ahead = sampleSmoothedTrail(
            headTrail,
            Math.max(0, trailDistance - 3),
            fallbackX,
            fallbackY
          );
          const behind = sampleSmoothedTrail(
            headTrail,
            trailDistance + 3,
            fallbackX,
            fallbackY
          );
          const tangentX = ahead.x - behind.x;
          const tangentY = ahead.y - behind.y;
          const tangentLength = Math.hypot(tangentX, tangentY) || 1;
          const wave = tailWave(time, trailDistance, index, ball);
          segment.sway = wave;
          const swayPixels = softTail
            ? wave * (12 + Math.min(index, 8) * 2.2)
            : wave * (5 + Math.min(index, 5) * 0.7);
          const targetX = trailTarget.x - tangentY / tangentLength * swayPixels;
          const targetY = trailTarget.y + tangentX / tangentLength * swayPixels;

          let deltaX = targetX - segment.x;
          let deltaY = targetY - segment.y;
          const targetTravel = Math.hypot(deltaX, deltaY);
          const maximumTravel = (
            softTail
              ? ball.speed * SOFT_WAVE_SPEED_MULTIPLIER
              : MAX_TAIL_NODE_SPEED
          ) * Math.max(0, dt);
          if (dt <= 0) {
            deltaX = 0;
            deltaY = 0;
          } else if (targetTravel > maximumTravel && targetTravel > EPSILON) {
            const scale = maximumTravel / targetTravel;
            deltaX *= scale;
            deltaY *= scale;
          }

          let { x, y } = constrainPoint(segment.x + deltaX, segment.y + deltaY, segment.radius, game);
          let parentDeltaX = x - parent.x;
          let parentDeltaY = y - parent.y;
          let spacing = Math.hypot(parentDeltaX, parentDeltaY);
          if (spacing > fullSpacing && spacing > EPSILON) {
            const scale = fullSpacing / spacing;
            ({ x, y } = constrainPoint(parent.x + parentDeltaX * scale,
              parent.y + parentDeltaY * scale, segment.radius, game));
            parentDeltaX = x - parent.x;
            parentDeltaY = y - parent.y;
            spacing = Math.hypot(parentDeltaX, parentDeltaY);
          }
          if (spacing > EPSILON && spacing < fullSpacing) {
            const angle = Math.atan2(parentDeltaY, parentDeltaX);
            if (softTail || maximumArenaSpacing(
              parent,
              segment.radius,
              angle,
              game
            ) + EPSILON >= fullSpacing) {
              const recoveredSpacing = Math.min(
                fullSpacing,
                spacing + TAIL_EXPAND_SPEED * Math.max(0, dt)
              );
              x = parent.x + Math.cos(angle) * recoveredSpacing;
              y = parent.y + Math.sin(angle) * recoveredSpacing;
              parentDeltaX = x - parent.x;
              parentDeltaY = y - parent.y;
              spacing = recoveredSpacing;
            }
          }

          segment.x = x;
          segment.y = y;
          segment.spacing = spacing;
          if (spacing > EPSILON) {
            segment.angle = Math.atan2(parentDeltaY, parentDeltaX);
          }
          parent = segment;
        }
      }

      function initialize(ball, game) {
        activeBall = ball;
        if (initialized) return;
        initialized = true;
        const backAngle = headBackAngle(ball, game);
        headTrail.push({ x: ball.x, y: ball.y });
        motionInitialized = false;
        for (let index = 0; index < INITIAL_SEGMENTS; index += 1) {
          const fullDiameter = segmentDiameter(index);
          segments.push({
            fullDiameter,
            stage: GROWTH_STAGES,
            radius: fullDiameter / 2,
            angle: backAngle,
            sway: 0,
            spacing: 0,
            x: ball.x,
            y: ball.y
          });
        }
        positionSegments(ball, game, 0);
      }

      function addGrowingSegment(ball, game) {
        const fullDiameter = segmentDiameter(segments.length);
        const parent = segments.at(-1);
        const angle = parent ? parent.angle : headBackAngle(ball, game);
        const radius = fullDiameter / GROWTH_STAGES / 2;
        const parentX = parent ? parent.x : ball.x;
        const parentY = parent ? parent.y : ball.y;
        const parentRadius = parent ? parent.radius : ball.radius;
        const spacing = parentRadius + radius + SEGMENT_GAP;
        segments.push({
          fullDiameter,
          stage: 1,
          radius,
          angle,
          sway: parent ? parent.sway : 0,
          spacing,
          ...constrainPoint(parentX + Math.cos(angle) * spacing,
            parentY + Math.sin(angle) * spacing, radius, game)
        });
        positionSegments(ball, game, 0);
      }

      function advanceTailGrowth(ball, game) {
        initialize(ball, game);
        const growingSegment = segments.at(-1);
        if (growingSegment.stage >= GROWTH_STAGES) {
          if (segments.length >= MAX_SEGMENTS) return;
          addGrowingSegment(ball, game);
        } else {
          growingSegment.stage += 1;
          growingSegment.radius = (
            growingSegment.fullDiameter * growingSegment.stage / GROWTH_STAGES / 2
          );
          positionSegments(ball, game, 0);
        }
      }

      function registerContact(context, target, canAttack = true) {
        contactCount += 1;
        // 贪吃蛇：成长只来自青苹果，碰撞不再触发成长（软蛇保持旧机制）
        if (!appleGrowth) advanceTailGrowth(context.ball, context.game);
        if (!canAttack || !services.getContactProfile(target).attackable) return;
        services.dealDamage(target, collisionDamage, context.ball);
      }

      function updateTailContacts(context, canAttack) {
        const activeContacts = new Set();
        const growthAllowed = services.getContactProfile(context.ball).solid;
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).solid) return;
          let touching = false;
          for (const segment of segments) {
            if (resolveTailOverlap(segment, target, context.game)) {
              touching = true;
            }
          }
          if (!touching) return;

          const key = targetKey(target);
          activeContacts.add(key);
          if (!growthAllowed || tailContacts.has(key)) return;
          const headContactTime = lastHeadContactAt.get(key);
          if (
            headContactTime === undefined ||
            Math.abs(headContactTime - services.getTime()) > EPSILON
          ) {
            registerContact(context, target, canAttack);
          }
        });
        tailContacts.clear();
        activeContacts.forEach((key) => tailContacts.add(key));
      }

      function updateTail(context, dt, canAttack) {
        initialize(context.ball, context.game);
        positionSegments(context.ball, context.game, dt);
        updateTailContacts(context, canAttack);
      }

      return {
        onSpawn(context) {
          initialize(context.ball, context.game);
        },
        update(context, dt) {
          if (!appleGrowth) return;
          appleTimer += dt;
          if (appleTimer >= APPLE_INTERVAL) {
            appleTimer = 0;
            if (aliveAppleCount() < APPLE_MAX) spawnApple(context.ball, context.game);
          }
          pruneApples();
          // 被动吃苹果：即使被控期间蛇身仍在移动，头部碰到的苹果依然算吃掉
          eatApplesAtHead(context.ball, context.game);
        },
        updateWhilePaused(context, dt) {
          if (!appleGrowth) return;
          pruneApples();
          eatApplesAtHead(context.ball, context.game);
        },
        onCollision(context, target) {
          initialize(context.ball, context.game);
          lastHeadContactAt.set(targetKey(target), services.getTime());
          registerContact(context, target, !context.blockedAtContact);
        },
        afterUpdateStep(context, dt) {
          updateTail(context, dt, true);
        },
        afterUpdateStepWhilePaused(context, dt) {
          updateTail(context, dt, false);
        },
        drawBefore(context, canvasContext) {
          initialize(context.ball, context.game);
          drawTail(canvasContext, segments, tailColor);
        },
        getTailSegments() {
          return segments;
        },
        getApples() {
          return apples.filter((apple) => apple && apple.entityActive !== false);
        },
        getContactCount() {
          return contactCount;
        },
        getWavePropagationSpeed() {
          return softTail && activeBall ? activeBall.speed * SOFT_WAVE_SPEED_MULTIPLIER : null;
        },
        onDeath() {
          apples.length = 0;
        }
      };
  }

  const sharedStats = Object.freeze({
    radius: 15,
    speed: 150,
    maxHp: 100
  });

  const greedySnakeDefinition = {
    id: "greedySnake",
    name: "\u8d2a\u5403\u86c7",
    englishName: "Greedy Snake",
    color: BODY_COLOR,
    description: "初始两节尾巴 / 蛇行摆动 / 青苹果成长（0.7s一枚，敌吃-1HP） / 碰撞 -4HP",
    stats: sharedStats,
    rionCycleDuration: 5,
    createBehavior(services) {
      return createSnakeBehavior(services, {
        tailColor: TAIL_COLOR,
        appleGrowth: true,
        collisionDamage: 4
      });
    }
  };

  const softSnakeDefinition = {
    id: "softSnake",
    name: "\u86c7",
    englishName: "Snake",
    color: SOFT_BODY_COLOR,
    description: "\u67d4\u6027\u8d8a\u754c\u86c7\u5c3e / 1\u500d\u901f\u6ce2\u52a8\u4f20\u5bfc / \u78b0\u649e -5HP",
    stats: sharedStats,
    rionCycleDuration: 5,
    createBehavior(services) {
      return createSnakeBehavior(services, {
        softTail: true,
        tailColor: SOFT_TAIL_COLOR
      });
    }
  };

  registerBall(greedySnakeDefinition);
  registerBall(softSnakeDefinition);
  return {
    greedySnakeDefinition,
    softSnakeDefinition,
    MAX_SEGMENTS,
    APPLE_INTERVAL,
    APPLE_RADIUS,
    APPLE_DAMAGE,
    APPLE_MAX
  };
});
