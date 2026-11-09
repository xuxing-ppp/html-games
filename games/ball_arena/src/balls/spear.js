(function initializeSpear(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpearPlugin({ resolveArenaGeometry, registerBall }) {
  const SPEAR_LENGTH = 35;
  const SPEAR_BUTT_LENGTH = 13;
  const SPEAR_BUTT_TIP_LENGTH = 4;
  const SPEAR_TIP_LENGTH = 8;
  const SPEAR_TIP_RADIUS = 3;
  const IDLE_SIDE_OFFSET = 19;
  const THRUST_DISTANCE = 21;
  const THRUST_DURATION = 0.48;
  const ANGLE_SPRING_FREQUENCY = 18;
  const OFFSET_SPRING_FREQUENCY = 22;
  const SPRING_DAMPING = 0.72;
  const MAX_SPRING_STEP = 1 / 120;
  const EPSILON = 1e-9;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  // 常驻残影拖尾：长矛靠碰壁加速，基础 150 速度下必须看不出拖尾，
  // 因此用速度门控从 floor 起淡入，并把峰值透明度压到 15%、宽度 2/3。
  const TRAIL_KIND = "spear-trail";
  const TRAIL_MAX_ALPHA = 0.15;
  const TRAIL_WIDTH_RATIO = 2 / 3;
  const TRAIL_SPEED_FLOOR = 150;
  const TRAIL_SPEED_RAMP = 100;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalize(x, y, fallbackX = 1, fallbackY = 0) {
    let length = Math.hypot(x, y);
    if (length <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      length = Math.hypot(x, y) || 1;
    }
    return { x: x / length, y: y / length };
  }

  function angleDifference(target, current) {
    let difference = target - current;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    return difference;
  }

  function thrustPulse(elapsed) {
    const progress = clamp(elapsed / THRUST_DURATION, 0, 1);
    const sine = Math.sin(Math.PI * progress);
    return sine * sine;
  }

  function movingTipContact(previousTip, currentTip, target) {
    const targetStartX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const targetStartY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const startX = previousTip.x - targetStartX;
    const startY = previousTip.y - targetStartY;
    const endX = currentTip.x - target.x;
    const endY = currentTip.y - target.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(-(startX * deltaX + startY * deltaY) / lengthSquared, 0, 1);
    const relativeX = startX + deltaX * progress;
    const relativeY = startY + deltaY * progress;
    const distance = Math.hypot(relativeX, relativeY);
    let normalX = -relativeX;
    let normalY = -relativeY;
    if (distance <= EPSILON) {
      normalX = target.x - currentTip.x;
      normalY = target.y - currentTip.y;
      const fallbackLength = Math.hypot(normalX, normalY);
      if (fallbackLength <= EPSILON) {
        normalX = 1;
        normalY = 0;
      } else {
        normalX /= fallbackLength;
        normalY /= fallbackLength;
      }
    } else {
      normalX /= distance;
      normalY /= distance;
    }
    return { distance, normalX, normalY };
  }

  function resolveTipCollision(entity, target, contact, game) {
    const minimumDistance = target.radius + entity.radius;
    const deltaX = target.x - entity.x;
    const deltaY = target.y - entity.y;
    const currentDistance = Math.hypot(deltaX, deltaY);
    if (currentDistance < minimumDistance && !target.positionLocked && !target.movementLocked) {
      const normal = currentDistance <= EPSILON
        ? { x: contact.normalX, y: contact.normalY }
        : { x: deltaX / currentDistance, y: deltaY / currentDistance };
      Object.assign(target, resolveArenaGeometry(game).clampPoint(entity.x + normal.x * minimumDistance, entity.y + normal.y * minimumDistance, target.radius));
    }

    if (target.positionLocked || target.movementLocked) return;
    const tipVx = Number.isFinite(entity.vx) ? entity.vx : 0;
    const tipVy = Number.isFinite(entity.vy) ? entity.vy : 0;
    const relativeNormal =
      (target.vx - tipVx) * contact.normalX +
      (target.vy - tipVy) * contact.normalY;
    if (relativeNormal >= -EPSILON) return;

    const reflectedX = target.vx - relativeNormal * 2 * contact.normalX;
    const reflectedY = target.vy - relativeNormal * 2 * contact.normalY;
    const reflected = normalize(
      reflectedX,
      reflectedY,
      contact.normalX,
      contact.normalY
    );
    const activeSpeed = Math.hypot(target.vx, target.vy);
    const storedSpeed = Math.hypot(target.storedVx, target.storedVy);
    target.vx = reflected.x * activeSpeed;
    target.vy = reflected.y * activeSpeed;
    target.storedVx = reflected.x * storedSpeed;
    target.storedVy = reflected.y * storedSpeed;
  }

  // 一律按 scale 等比缩放长度，调用方负责把偏移量也换算成同一尺度，
  // 缩放为 1 时与原长矛逐位一致。
  function spearGeometry(ball, angle, offsetX, offsetY, scale = 1) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const spearLength = SPEAR_LENGTH * scale;
    const buttLength = SPEAR_BUTT_LENGTH * scale;
    const buttTipLength = SPEAR_BUTT_TIP_LENGTH * scale;
    const tipLength = SPEAR_TIP_LENGTH * scale;
    const grip = {
      x: ball.x + offsetX,
      y: ball.y + offsetY
    };
    const base = {
      x: grip.x - directionX * buttLength,
      y: grip.y - directionY * buttLength
    };
    const buttTip = {
      x: base.x - directionX * buttTipLength,
      y: base.y - directionY * buttTipLength
    };
    return {
      grip,
      base,
      buttTip,
      shaftEnd: {
        x: grip.x + directionX * (spearLength - tipLength),
        y: grip.y + directionY * (spearLength - tipLength)
      },
      tip: {
        x: grip.x + directionX * spearLength,
        y: grip.y + directionY * spearLength
      },
      directionX,
      directionY,
      length: spearLength + buttLength + buttTipLength
    };
  }

  function drawSpear(canvasContext, ball, angle, offsetX, offsetY, attackBlend, time, scale = 1) {
    const geometry = spearGeometry(ball, angle, offsetX, offsetY, scale);
    const { grip, base, buttTip, shaftEnd, tip, directionX, directionY } = geometry;
    const normalX = -directionY;
    const normalY = directionX;
    const collar = grip;
    const halfButt = 2.8 * scale;
    const halfCollar = 2 * scale;
    const halfTip = 4.2 * scale;

    canvasContext.save();
    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";

    // The spear sits just outside the body, with a short wooden grip and a
    // layered bronze shaft. It is intentionally matte rather than glossy.
    canvasContext.strokeStyle = "#3d2417";
    canvasContext.lineWidth = 5 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(base.x, base.y);
    canvasContext.lineTo(shaftEnd.x, shaftEnd.y);
    canvasContext.stroke();

    canvasContext.fillStyle = "#cbd5c9";
    canvasContext.strokeStyle = "#6f7d73";
    canvasContext.lineWidth = 1 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(buttTip.x, buttTip.y);
    canvasContext.lineTo(base.x + normalX * halfButt, base.y + normalY * halfButt);
    canvasContext.lineTo(base.x - normalX * halfButt, base.y - normalY * halfButt);
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    canvasContext.strokeStyle = "#9b6b35";
    canvasContext.lineWidth = 3 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(base.x, base.y);
    canvasContext.lineTo(shaftEnd.x, shaftEnd.y);
    canvasContext.stroke();

    canvasContext.strokeStyle = "#e0ad50";
    canvasContext.lineWidth = 1.2 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(collar.x + normalX * halfCollar, collar.y + normalY * halfCollar);
    canvasContext.lineTo(collar.x - normalX * halfCollar, collar.y - normalY * halfCollar);
    canvasContext.stroke();

    canvasContext.fillStyle = "#dce5d7";
    canvasContext.strokeStyle = "#7e8e82";
    canvasContext.lineWidth = 1 * scale;
    canvasContext.beginPath();
    canvasContext.moveTo(tip.x, tip.y);
    canvasContext.lineTo(
      shaftEnd.x + normalX * halfTip,
      shaftEnd.y + normalY * halfTip
    );
    canvasContext.lineTo(
      shaftEnd.x - normalX * halfTip,
      shaftEnd.y - normalY * halfTip
    );
    canvasContext.closePath();
    canvasContext.fill();
    canvasContext.stroke();

    // A restrained motion mark makes the lunge readable without changing the
    // collision geometry or adding a permanent glow.
    if (attackBlend > 0.08) {
      const pulse = 0.3 + 0.2 * Math.sin(time * 24);
      canvasContext.globalAlpha = pulse;
      canvasContext.strokeStyle = "#e8f4d7";
      canvasContext.lineWidth = 1 * scale;
      canvasContext.beginPath();
      canvasContext.moveTo(
        grip.x + directionX * 8 * scale + normalX * 5 * scale,
        grip.y + directionY * 8 * scale + normalY * 5 * scale
      );
      canvasContext.lineTo(
        shaftEnd.x + normalX * 5 * scale,
        shaftEnd.y + normalY * 5 * scale
      );
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function damageFor(ball) {
    return Math.floor(ball.speed / 50);
  }

  const SPEAR_COLOR = "#58c943";
  const SPEAR_TRAIL = Object.freeze({
    kind: TRAIL_KIND,
    color: SPEAR_COLOR,
    maxAlpha: TRAIL_MAX_ALPHA,
    widthRatio: TRAIL_WIDTH_RATIO,
    speedFloor: TRAIL_SPEED_FLOOR,
    speedRamp: TRAIL_SPEED_RAMP
  });

  // 长矛本体与"借用长矛机制"的其他单位共用这一套武器：几何按 scale 等比缩放，
  // 弹簧频率、突刺时长、矛尖判定规则保持不变。trail 传 null 表示不生成残影拖尾。
  function createSpearWeapon({
    services,
    scale = 1,
    entityKind = "spear-tip",
    trail: trailConfig = SPEAR_TRAIL
  }) {
    const entityRadius = SPEAR_TIP_RADIUS * scale;
    const idleSideOffset = IDLE_SIDE_OFFSET * scale;
    const thrustDistance = THRUST_DISTANCE * scale;
    const trailEnabled = Boolean(trailConfig && typeof services.spawnAfterimageTrail === "function");
    let ownerBall = null;
    let spearEntity = null;
    let weaponAngle = Math.PI / 2;
    let targetAngle = Math.PI / 2;
    let weaponAngularVelocity = 0;
    // The reference starts with a vertical spear on the body's right. After
    // play begins, the grip is a floating spring relative to the body rather
    // than a fixed side mount.
    let weaponOffsetX = idleSideOffset;
    let weaponOffsetY = 0;
    let weaponOffsetVx = 0;
    let weaponOffsetVy = 0;
    let thrustActive = false;
    let thrustElapsed = 0;
    let trail = null;
    let touchingTargets = new Set();

    function syncTrail(ball) {
      if (!trailEnabled) return;
      if (!trail || trail.finished) {
        trail = services.spawnAfterimageTrail({
          kind: trailConfig.kind || TRAIL_KIND,
          color: trailConfig.color,
          maxAlpha: trailConfig.maxAlpha,
          widthRatio: trailConfig.widthRatio,
          speedFloor: trailConfig.speedFloor,
          speedRamp: trailConfig.speedRamp
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

    function speedDirection(ball) {
      const velocity = normalize(
        ball.storedVx || ball.vx,
        ball.storedVy || ball.vy,
        Math.cos(targetAngle),
        Math.sin(targetAngle)
      );
      return velocity;
    }

    function setMotionSpeed(ball) {
      const direction = speedDirection(ball);
      const speed = ball.speed * ball.speedMultiplier;
      ball.storedVx = direction.x * speed;
      ball.storedVy = direction.y * speed;
      if (!ball.movementLocked) {
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
      }
    }

    function advanceWeapon(ball, dt) {
      const direction = speedDirection(ball);
      targetAngle = Math.atan2(direction.y, direction.x);
      let remaining = Math.max(0, dt);
      while (remaining > EPSILON) {
        const step = Math.min(MAX_SPRING_STEP, remaining);
        const sampleElapsed = thrustActive
          ? Math.min(THRUST_DURATION, thrustElapsed + step * 0.5)
          : 0;
        const attackBlend = thrustActive ? thrustPulse(sampleElapsed) : 0;
        const idleBlend = 1 - attackBlend;
        const sideX = direction.y;
        const sideY = -direction.x;

        const angleAcceleration =
          ANGLE_SPRING_FREQUENCY * ANGLE_SPRING_FREQUENCY *
            angleDifference(targetAngle, weaponAngle) -
          2 * SPRING_DAMPING * ANGLE_SPRING_FREQUENCY * weaponAngularVelocity;
        weaponAngularVelocity += angleAcceleration * step;
        weaponAngle += weaponAngularVelocity * step;

        const targetOffsetX =
          sideX * idleSideOffset * idleBlend +
          direction.x * thrustDistance * attackBlend;
        const targetOffsetY =
          sideY * idleSideOffset * idleBlend +
          direction.y * thrustDistance * attackBlend;
        const offsetAccelerationX =
          OFFSET_SPRING_FREQUENCY * OFFSET_SPRING_FREQUENCY *
            (targetOffsetX - weaponOffsetX) -
          2 * SPRING_DAMPING * OFFSET_SPRING_FREQUENCY * weaponOffsetVx;
        const offsetAccelerationY =
          OFFSET_SPRING_FREQUENCY * OFFSET_SPRING_FREQUENCY *
            (targetOffsetY - weaponOffsetY) -
          2 * SPRING_DAMPING * OFFSET_SPRING_FREQUENCY * weaponOffsetVy;
        weaponOffsetVx += offsetAccelerationX * step;
        weaponOffsetVy += offsetAccelerationY * step;
        weaponOffsetX += weaponOffsetVx * step;
        weaponOffsetY += weaponOffsetVy * step;

        if (thrustActive) {
          thrustElapsed += step;
          if (thrustElapsed + EPSILON >= THRUST_DURATION) {
            thrustActive = false;
            thrustElapsed = 0;
          }
        }
        remaining -= step;
      }
    }

    function startThrust(ball) {
      targetAngle = Math.atan2(
        ball.storedVy || ball.vy,
        ball.storedVx || ball.vx
      );
      thrustActive = true;
      thrustElapsed = 0;
    }

    function checkTipContacts(entity, ball, game, entityServices, dt) {
      const geometry = spearGeometry(
        ball,
        weaponAngle,
        weaponOffsetX,
        weaponOffsetY,
        scale
      );
      const previous = entity.previousTip || geometry.tip;
      const current = geometry.tip;
      const elapsed = Math.max(EPSILON, dt);
      entity.x = current.x;
      entity.y = current.y;
      entity.vx = (current.x - previous.x) / elapsed;
      entity.vy = (current.y - previous.y) / elapsed;
      const nextTouching = new Set();
      const damage = damageFor(ball);
      entityServices.forEachContactEnemy((target) => {
        const profile = entityServices.getContactProfile(target);
        if (!profile.solid && !profile.attackable) return;
        const contact = movingTipContact(previous, current, target);
        const overlapping = contact.distance <= target.radius + entityRadius;
        entityServices.notifyEntityContact(target, entity, { overlapping });
        if (!overlapping) return;
        const key = target.instanceId;
        nextTouching.add(key);
        if (profile.solid) resolveTipCollision(entity, target, contact, game);
        if (touchingTargets.has(key)) return;
        if (profile.attackable && damage > 0) entityServices.dealDamage(target, damage);
      });
      touchingTargets = nextTouching;
      entity.previousTip = { x: current.x, y: current.y };
    }

    function createSpearEntity() {
      return services.spawnCombatEntity({
        kind: entityKind,
        combatKind: "zone",
        life: PERMANENT_LIFE,
        lifecycle: "owner-bound",
        drawLayer: "foreground",
        radius: entityRadius,
        previousTip: null,
        update({ entity, game, services: entityServices }, dt) {
          if (!ownerBall || ownerBall.hp <= 0) {
            entity.entityActive = false;
            return;
          }
          checkTipContacts(entity, ownerBall, game, entityServices, dt);
        },
        draw() {}
      });
    }

    function ensureSpearEntity(ball) {
      if (spearEntity && spearEntity.entityActive !== false) return;
      spearEntity = createSpearEntity();
      const geometry = spearGeometry(
        ball,
        weaponAngle,
        weaponOffsetX,
        weaponOffsetY,
        scale
      );
      spearEntity.previousTip = { ...geometry.tip };
    }

    return {
      onAttackTransfer(context) {
        ownerBall = context.ball;
        touchingTargets.clear();
        if (spearEntity) {
          const geometry = spearGeometry(ownerBall, weaponAngle, weaponOffsetX, weaponOffsetY, scale);
          spearEntity.previousTip = { ...geometry.tip };
        }
      },
      onSpawn(context) {
        ownerBall = context.ball;
        ensureSpearEntity(ownerBall);
      },
      update(context, dt) {
        ownerBall = context.ball;
        // Rion creates borrowed behaviors without dispatching onSpawn. Lazy
        // creation keeps the weapon available for both normal and borrowed
        // spear cycles while preserving the same owner-bound source.
        ensureSpearEntity(ownerBall);
        advanceWeapon(context.ball, dt);
      },
      getNextTransitionIn() {
        if (!thrustActive) return undefined;
        return Math.max(EPSILON, THRUST_DURATION - thrustElapsed);
      },
      afterUpdateStep(context) {
        // 常驻拖尾：每帧一片（按 0.03s 节流），是否可见交给速度门控。
        syncTrail(context.ball);
      },
      onWallBounce({ ball }) {
        ball.speed += 5;
        ball.speedNeedsNormalization = false;
        setMotionSpeed(ball);
        startThrust(ball);
      },
      drawBefore(context, canvasContext) {
        drawSpear(
          canvasContext,
          context.ball,
          weaponAngle,
          weaponOffsetX,
          weaponOffsetY,
          thrustActive ? thrustPulse(thrustElapsed) : 0,
          context.game.time,
          scale
        );
      },
      onBorrowEnd() {
        endTrail(true);
        if (spearEntity) spearEntity.entityActive = false;
        spearEntity = null;
      },
      onAttackBorrowStart(context) { startThrust(context.ball); },
      isAttackCycleComplete() { return !thrustActive; },
      drawBorrowedWeapon(context, canvasContext) {
        this.drawBefore(context, canvasContext);
      },
      getSpearState() {
        const ball = ownerBall;
        const attackBlend = thrustActive ? thrustPulse(thrustElapsed) : 0;
        const extension = thrustDistance * attackBlend;
        const geometry = ball
          ? spearGeometry(ball, weaponAngle, weaponOffsetX, weaponOffsetY, scale)
          : null;
        return {
          phase: thrustActive ? "thrusting" : "idle",
          weaponAngle,
          targetAngle,
          attackBlend,
          extension,
          offsetX: weaponOffsetX,
          offsetY: weaponOffsetY,
          speed: ball ? Math.hypot(ball.storedVx, ball.storedVy) : 0,
          damage: ball ? damageFor(ball) : 1,
          grip: geometry ? { ...geometry.grip } : null,
          base: geometry ? { ...geometry.base } : null,
          tip: geometry ? { ...geometry.tip } : null
        };
      }
    };
  }

  const spearDefinition = {
    id: "spear",
    name: "长矛",
    englishName: "Spear",
    color: SPEAR_COLOR,
    description: "鲜绿色长矛 / 碰壁加速 / 只有矛尖造成速度相关伤害",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services) {
      return createSpearWeapon({ services, scale: 1, entityKind: "spear-tip" });
    }
  };

  registerBall(spearDefinition);
  return {
    spearDefinition,
    createSpearWeapon,
    drawSpear,
    spearGeometry,
    SPEAR_LENGTH,
    SPEAR_TIP_RADIUS,
    THRUST_DISTANCE,
    THRUST_DURATION
  };
});
