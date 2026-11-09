(function initializeSawV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSawV2Plugin({ resolveArenaGeometry, registerBall }) {
  const BASE_SPEED = 150;
  const SPEED_GAIN = 20;
  const DAMAGE_SPEED_STEP = 15;
  const ACTIVE_BOOST_INITIAL_COOLDOWN = 3;
  const ACTIVE_BOOST_COOLDOWN_REDUCTION = 0.2;
  const ACTIVE_BOOST_MINIMUM_COOLDOWN = 0.5;
  const ACTIVE_BOOST_DURATION = 0.15;
  const WALL_EFFECT_DURATION = 0.22;
  const BOOST_TRAIL_DURATION = 0.24;
  // 常驻残影拖尾：锯球V2 靠碰边与主动蓄速提速，基础 150 速度下要完全
  // 看不出拖尾，所以用速度门控淡入，峰值透明度 15%、视觉宽度 2/3。
  const TRAIL_KIND = "saw-v2-trail";
  const TRAIL_MAX_ALPHA = 0.15;
  const TRAIL_WIDTH_RATIO = 2 / 3;
  const TRAIL_SPEED_FLOOR = 150;
  const TRAIL_SPEED_RAMP = 100;
  const BLADE_COUNT = 30;
  const TOOTH_HEIGHT = 2;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    x = Number.isFinite(x) ? x : 0;
    y = Number.isFinite(y) ? y : 0;
    fallbackX = Number.isFinite(fallbackX) ? fallbackX : 1;
    fallbackY = Number.isFinite(fallbackY) ? fallbackY : 0;
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function movementDirection(ball) {
    return normalizeDirection(
      ball.storedVx || ball.vx,
      ball.storedVy || ball.vy,
      1,
      0
    );
  }

  function setMovementSpeed(ball, speed, direction = movementDirection(ball)) {
    ball.storedVx = direction.x * speed;
    ball.storedVy = direction.y * speed;
    if (!ball.movementLocked && !ball.positionLocked) {
      ball.vx = ball.storedVx;
      ball.vy = ball.storedVy;
    }
    ball.speedNeedsNormalization = false;
  }

  function impactSpeed(ball) {
    const preHit = Math.hypot(ball.preHitVx, ball.preHitVy);
    if (preHit > EPSILON) return preHit;
    const stored = Math.hypot(ball.storedVx, ball.storedVy);
    if (stored > EPSILON) return stored;
    return BASE_SPEED;
  }

  function damageForSpeed(speed) {
    const gain = Math.max(0, speed - BASE_SPEED);
    return 2 + Math.floor(gain / DAMAGE_SPEED_STEP);
  }

  function wallImpactPoint(context) {
    const { ball, game } = context;
    if (context.wallContacts && context.wallContacts.length) return context.wallContacts[0];
    return {
      x: context.bouncedX
        ? (ball.x <= ball.radius + EPSILON ? 0 : game.arenaSize)
        : ball.x,
      y: context.bouncedY
        ? (ball.y <= ball.radius + EPSILON ? 0 : game.arenaSize)
        : ball.y
    };
  }

  function drawSawTeeth(context, ball, rotation) {
    // The renderer draws the ordinary radius-fifteen body afterward. This
    // hook only adds the external teeth, so they never become body volume.
    const bladeRoot = ball.radius;
    const bladeTip = ball.radius + TOOTH_HEIGHT;
    const halfStep = Math.PI / BLADE_COUNT;

    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(rotation);
    context.fillStyle = "#9098a5";
    context.strokeStyle = "#363c46";
    context.lineWidth = 1;
    for (let index = 0; index < BLADE_COUNT; index += 1) {
      const center = index * Math.PI * 2 / BLADE_COUNT;
      const leftAngle = center - halfStep;
      const tipAngle = center - halfStep * 0.16;
      const rightAngle = center + halfStep * 0.74;
      const leftX = Math.cos(leftAngle) * bladeRoot;
      const leftY = Math.sin(leftAngle) * bladeRoot;
      const tipX = Math.cos(tipAngle) * bladeTip;
      const tipY = Math.sin(tipAngle) * bladeTip;
      const rightX = Math.cos(rightAngle) * bladeRoot;
      const rightY = Math.sin(rightAngle) * bladeRoot;

      // Keep every tooth as its own triangle. The root edge stays exactly on
      // the collision body's circumference, so the body remains a plain
      // radius-fifteen disc and the teeth only add an external visual rim.
      context.beginPath();
      context.moveTo(leftX, leftY);
      context.lineTo(tipX, tipY);
      context.lineTo(rightX, rightY);
      context.closePath();
      context.fill();
      context.stroke();
    }

    context.restore();
  }

  function createWallBurst(point, bouncedX, bouncedY) {
    return {
      kind: "saw-v2-wall-boost",
      life: WALL_EFFECT_DURATION,
      x: point.x,
      y: point.y,
      bouncedX,
      bouncedY,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const alpha = 1 - progress;
        context.save();
        context.globalAlpha *= alpha;
        context.strokeStyle = "#f4f7fb";
        context.lineWidth = 1.2;
        context.lineCap = "round";
        const drawEdgeBurst = (axis) => {
          for (let index = -2; index <= 2; index += 1) {
            const spread = index * 3.2;
            const length = 6 + (2 - Math.abs(index)) * 2 + progress * 5;
            context.beginPath();
            if (axis === "x") {
              const direction = effect.x <= EPSILON ? 1 : -1;
              context.moveTo(effect.x + direction * 1.5, effect.y + spread);
              context.lineTo(effect.x + direction * length, effect.y + spread * 1.4);
            } else {
              const direction = effect.y <= EPSILON ? 1 : -1;
              context.moveTo(effect.x + spread, effect.y + direction * 1.5);
              context.lineTo(effect.x + spread * 1.4, effect.y + direction * length);
            }
            context.stroke();
          }
        };
        if (effect.bouncedX) drawEdgeBurst("x");
        if (effect.bouncedY) drawEdgeBurst("y");
        context.restore();
      }
    };
  }

  function createBoostTrail(ball, direction) {
    const normalX = -direction.y;
    const normalY = direction.x;
    const originX = ball.x;
    const originY = ball.y;
    const points = Array.from({ length: 7 }, (_, index) => {
      const lateral = (index % 2 === 0 ? -1 : 1) * (2 + index * 0.25);
      const distance = 5 + index * 2.6;
      return {
        x: originX - direction.x * distance + normalX * lateral,
        y: originY - direction.y * distance + normalY * lateral
      };
    });
    return {
      kind: "saw-v2-active-boost",
      life: BOOST_TRAIL_DURATION,
      points,
      originX,
      originY,
      directionX: direction.x,
      directionY: direction.y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        // A layered tapered streak gives the acceleration a sense of travel;
        // the short residual marks below keep the pixel-art breakup visible.
        const length = 34 + progress * 10;
        const wide = 5.5 * (1 - progress * 0.35);
        const startX = effect.originX - effect.directionX * 4;
        const startY = effect.originY - effect.directionY * 4;
        const endX = effect.originX - effect.directionX * length;
        const endY = effect.originY - effect.directionY * length;
        context.fillStyle = "rgba(198, 207, 218, 0.34)";
        context.beginPath();
        context.moveTo(startX + normalX * wide, startY + normalY * wide);
        context.lineTo(endX, endY);
        context.lineTo(startX - normalX * wide, startY - normalY * wide);
        context.closePath();
        context.fill();
        context.fillStyle = "rgba(244, 247, 251, 0.24)";
        context.beginPath();
        context.moveTo(startX + normalX * wide * 0.42, startY + normalY * wide * 0.42);
        context.lineTo(endX, endY);
        context.lineTo(startX - normalX * wide * 0.42, startY - normalY * wide * 0.42);
        context.closePath();
        context.fill();
        context.strokeStyle = "#d9e0e9";
        context.fillStyle = "#f7f9fc";
        context.lineCap = "round";
        effect.points.forEach((point, index) => {
          const length = 3 + (effect.points.length - index) * 0.7;
          context.lineWidth = Math.max(0.6, 1.5 - index * 0.1);
          context.beginPath();
          context.moveTo(point.x, point.y);
          context.lineTo(
            point.x - effect.directionX * length,
            point.y - effect.directionY * length
          );
          context.stroke();
          if (index % 2 === 0) {
            context.beginPath();
            context.arc(point.x, point.y, 0.8, 0, Math.PI * 2);
            context.fill();
          }
        });
        context.restore();
      }
    };
  }

  const sawV2Definition = {
    id: "sawV2",
    name: "锯球V2",
    englishName: "Saw Ball V2",
    color: "#8f97a4",
    description: "碰边与主动蓄速 / 撞击伤害随额外速度提高 / 命中后复原",
    stats: { radius: 15, speed: BASE_SPEED, maxHp: 100 },
    rionCycleDuration: ACTIVE_BOOST_INITIAL_COOLDOWN + ACTIVE_BOOST_DURATION,
    createBehavior(services) {
      let ownerBall = null;
      let phase = "waiting";
      let phaseElapsed = 0;
      let boostStartSpeed = BASE_SPEED;
      let boostDirection = { x: 1, y: 0 };
      let rotation = 0;
      let wallBoostCount = 0;
      let activeBoostCount = 0;
      let trail = null;
      let lastImpactSpeed = BASE_SPEED;
      let lastDamage = 2;

      function activeBoostCooldown() {
        return Math.max(
          ACTIVE_BOOST_MINIMUM_COOLDOWN,
          ACTIVE_BOOST_INITIAL_COOLDOWN -
            activeBoostCount * ACTIVE_BOOST_COOLDOWN_REDUCTION
        );
      }

      function syncTrail(ball) {
        if (!trail || trail.finished) {
          trail = services.spawnAfterimageTrail({
            kind: TRAIL_KIND,
            color: sawV2Definition.color,
            maxAlpha: TRAIL_MAX_ALPHA,
            widthRatio: TRAIL_WIDTH_RATIO,
            speedFloor: TRAIL_SPEED_FLOOR,
            speedRamp: TRAIL_SPEED_RAMP
          }, { lifecycle: "owner-bound" });
        }
        trail.emit(ball.x, ball.y, ball.radius, {
          heading: Math.atan2(ball.vy, ball.vx),
          speed: Math.hypot(ball.vx, ball.vy)
        });
      }

      function endTrail(hard) {
        if (!trail) return;
        trail.end(hard);
        if (hard) trail = null;
      }

      function beginActiveBoost(ball) {
        phase = "accelerating";
        phaseElapsed = 0;
        boostStartSpeed = Math.max(BASE_SPEED, Math.hypot(ball.storedVx, ball.storedVy));
        boostDirection = movementDirection(ball);
        services.spawnVisualEffect(createBoostTrail(ball, boostDirection));
      }

      function updateActiveBoost(ball, dt) {
        const elapsed = Math.max(0, dt);
        if (phase === "waiting") {
          phaseElapsed = Math.min(activeBoostCooldown(), phaseElapsed + elapsed);
          return;
        }
        phaseElapsed = Math.min(ACTIVE_BOOST_DURATION, phaseElapsed + elapsed);
        const progress = phaseElapsed / ACTIVE_BOOST_DURATION;
        setMovementSpeed(
          ball,
          boostStartSpeed + SPEED_GAIN * progress,
          boostDirection
        );
      }

      function finishActiveBoost(ball) {
        setMovementSpeed(ball, boostStartSpeed + SPEED_GAIN, boostDirection);
        activeBoostCount += 1;
        phase = "waiting";
        phaseElapsed = 0;
      }

      function resetAfterImpact(ball) {
        const direction = normalizeDirection(
          ball.vx || ball.storedVx,
          ball.vy || ball.storedVy,
          ball.preHitVx,
          ball.preHitVy
        );
        setMovementSpeed(ball, BASE_SPEED, direction);
        phase = "waiting";
        phaseElapsed = 0;
        boostStartSpeed = BASE_SPEED;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
        },
        update(context, dt) {
          ownerBall = context.ball;
          updateActiveBoost(context.ball, dt);
          const currentSpeed = Math.hypot(
            context.ball.storedVx,
            context.ball.storedVy
          );
          rotation += (5 + currentSpeed / 28) * Math.max(0, dt);
        },
        getNextTransitionIn() {
          return phase === "accelerating"
            ? Math.max(EPSILON, ACTIVE_BOOST_DURATION - phaseElapsed)
            : Math.max(EPSILON, activeBoostCooldown() - phaseElapsed);
        },
        afterUpdateStep(context) {
          if (
            phase === "waiting" &&
            phaseElapsed + EPSILON >= activeBoostCooldown()
          ) {
            beginActiveBoost(context.ball);
            return;
          }
          if (phase === "accelerating" && phaseElapsed + EPSILON >= ACTIVE_BOOST_DURATION) {
            finishActiveBoost(context.ball);
          }
          // 常驻拖尾：是否可见完全交给速度门控。
          syncTrail(context.ball);
        },
        onWallBounce(context) {
          const direction = movementDirection(context.ball);
          const currentSpeed = Math.max(
            BASE_SPEED,
            Math.hypot(context.ball.storedVx, context.ball.storedVy)
          );
          setMovementSpeed(context.ball, currentSpeed + SPEED_GAIN, direction);
          wallBoostCount += 1;
          if (phase === "accelerating") {
            boostDirection = direction;
            boostStartSpeed = currentSpeed + SPEED_GAIN -
              SPEED_GAIN * (phaseElapsed / ACTIVE_BOOST_DURATION);
          }
          services.spawnVisualEffect(createWallBurst(
            wallImpactPoint(context),
            context.bouncedX,
            context.bouncedY
          ));
        },
        onCollision(context, target) {
          if (context.blockedAtContact) {
            resetAfterImpact(context.ball);
            return;
          }
          lastImpactSpeed = impactSpeed(context.ball);
          lastDamage = damageForSpeed(lastImpactSpeed);
          context.services.dealDamage(target, lastDamage);
          resetAfterImpact(context.ball);
        },
        getAttackCycleDuration() { return 5; },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) { this.drawBefore(context, canvasContext); },
        drawBefore(context, canvasContext) {
          drawSawTeeth(canvasContext, context.ball, rotation);
        },
        onBorrowEnd(context) {
          endTrail(true);
          resetAfterImpact(context.ball);
        },
        getSawV2State() {
          const speed = ownerBall
            ? Math.hypot(ownerBall.storedVx, ownerBall.storedVy)
            : BASE_SPEED;
          return {
            phase,
            phaseElapsed,
            activeBoostCooldown: activeBoostCooldown(),
            speed,
            nextDamage: damageForSpeed(speed),
            wallBoostCount,
            activeBoostCount,
            lastImpactSpeed,
            lastDamage,
            rotation
          };
        }
      };
    }
  };

  registerBall(sawV2Definition);
  return {
    sawV2Definition,
    SAW_V2_BASE_SPEED: BASE_SPEED,
    SAW_V2_SPEED_GAIN: SPEED_GAIN,
    SAW_V2_DAMAGE_SPEED_STEP: DAMAGE_SPEED_STEP,
    SAW_V2_BLADE_COUNT: BLADE_COUNT,
    SAW_V2_TOOTH_HEIGHT: TOOTH_HEIGHT,
    SAW_V2_ACTIVE_BOOST_INITIAL_COOLDOWN: ACTIVE_BOOST_INITIAL_COOLDOWN,
    SAW_V2_ACTIVE_BOOST_COOLDOWN_REDUCTION: ACTIVE_BOOST_COOLDOWN_REDUCTION,
    SAW_V2_ACTIVE_BOOST_MINIMUM_COOLDOWN: ACTIVE_BOOST_MINIMUM_COOLDOWN,
    SAW_V2_ACTIVE_BOOST_DURATION: ACTIVE_BOOST_DURATION,
    damageForSpeed
  };
});
