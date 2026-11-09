(function initializeDrill(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDrillPlugin({ registerBall, resolveArenaGeometry }) {
  const INITIAL_COOLDOWN = 2.8;
  const MINIMUM_COOLDOWN = 1;
  const COOLDOWN_REDUCTION = 0.15;
  const DASH_SPEED = 450;
  const BORING_SPEED = 80;
  const BORING_DURATION = 0.75;
  const DAMAGE_INTERVAL = 0.15;
  const DAMAGE_PER_TICK = 2;
  const WEAPON_START = 7;
  const DRILL_TIP_DISTANCE = 45;
  const WEAPON_HALF_WIDTH = 5;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = x;
    let directionY = y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function pointToSegmentDistance(px, py, ax, ay, bx, by) {
    const segmentX = bx - ax;
    const segmentY = by - ay;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    const progress = lengthSquared <= EPSILON ? 0 : clamp(
      ((px - ax) * segmentX + (py - ay) * segmentY) / lengthSquared,
      0,
      1
    );
    return Math.hypot(
      px - (ax + segmentX * progress),
      py - (ay + segmentY * progress)
    );
  }

  function orientation(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const abC = orientation(ax, ay, bx, by, cx, cy);
    const abD = orientation(ax, ay, bx, by, dx, dy);
    const cdA = orientation(cx, cy, dx, dy, ax, ay);
    const cdB = orientation(cx, cy, dx, dy, bx, by);
    if (
      ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
    ) return true;
    return (
      pointToSegmentDistance(cx, cy, ax, ay, bx, by) <= EPSILON ||
      pointToSegmentDistance(dx, dy, ax, ay, bx, by) <= EPSILON ||
      pointToSegmentDistance(ax, ay, cx, cy, dx, dy) <= EPSILON ||
      pointToSegmentDistance(bx, by, cx, cy, dx, dy) <= EPSILON
    );
  }

  function segmentToSegmentDistance(ax, ay, bx, by, cx, cy, dx, dy) {
    if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
    return Math.min(
      pointToSegmentDistance(ax, ay, cx, cy, dx, dy),
      pointToSegmentDistance(bx, by, cx, cy, dx, dy),
      pointToSegmentDistance(cx, cy, ax, ay, bx, by),
      pointToSegmentDistance(dx, dy, ax, ay, bx, by)
    );
  }

  function sweptWeaponTouches(ball, target, headingX, headingY) {
    const previousBallX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
    const previousBallY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
    const previousTargetX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const previousTargetY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const relativeStartX = previousTargetX - previousBallX;
    const relativeStartY = previousTargetY - previousBallY;
    const relativeEndX = target.x - ball.x;
    const relativeEndY = target.y - ball.y;
    return segmentToSegmentDistance(
      relativeStartX,
      relativeStartY,
      relativeEndX,
      relativeEndY,
      headingX * WEAPON_START,
      headingY * WEAPON_START,
      headingX * DRILL_TIP_DISTANCE,
      headingY * DRILL_TIP_DISTANCE
    ) <= target.radius + WEAPON_HALF_WIDTH;
  }

  function setVelocity(ball, directionX, directionY, speed) {
    const direction = normalizeDirection(directionX, directionY, 1, 0);
    ball.vx = ball.storedVx = direction.x * speed;
    ball.vy = ball.storedVy = direction.y * speed;
    ball.speedNeedsNormalization = false;
  }

  function drawDrillWeapon(context, ball, angle, active, boring, time) {
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    context.lineJoin = "miter";
    context.lineCap = "butt";

    // The rear housing sits behind the shared ball body. Keeping this layer
    // flat lets the renderer own the ball fill and its standard outline.
    context.fillStyle = "#202a2f";
    context.strokeStyle = "#8b989d";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(6, -7);
    context.lineTo(25, -7);
    context.lineTo(29, -4.8);
    context.lineTo(29, 4.8);
    context.lineTo(25, 7);
    context.lineTo(6, 7);
    context.closePath();
    context.fill();
    context.stroke();

    context.fillStyle = "#445158";
    context.fillRect(17, -5.5, 4, 11);
    context.fillStyle = "#10171a";
    context.fillRect(25, -4.3, 4, 8.6);
    context.strokeStyle = "#68767c";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(17, -5.5);
    context.lineTo(17, 5.5);
    context.moveTo(21, -5.5);
    context.lineTo(21, 5.5);
    context.stroke();

    const vibration = boring ? Math.sin(time * 120) * 0.7 : 0;
    context.translate(vibration, 0);

    // A single tapered steel core gives the bit a readable drill silhouette.
    // The slanted grooves below stay inside that silhouette instead of
    // becoming disconnected white triangles around the tip.
    context.fillStyle = active ? "#657278" : "#59656a";
    context.strokeStyle = "#b5c0c4";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(28, -5.5);
    context.lineTo(33, -5);
    context.lineTo(38, -3.6);
    context.lineTo(42, -2);
    context.lineTo(DRILL_TIP_DISTANCE + 2, 0);
    context.lineTo(42, 2);
    context.lineTo(38, 3.6);
    context.lineTo(33, 5);
    context.lineTo(28, 5.5);
    context.closePath();
    context.fill();
    context.stroke();

    const grooves = [
      [[28.5, -5.2], [31.5, -5], [35, 4.3], [32, 5.1]],
      [[33.5, -4.7], [36.2, -4.1], [39.5, 3], [37.1, 3.9]],
      [[38.2, -3.4], [40.5, -2.6], [43.5, 1.4], [41.7, 2.2]]
    ];
    grooves.forEach((groove, index) => {
      context.fillStyle = index % 2 === 0 ? "#263238" : "#344147";
      context.beginPath();
      context.moveTo(groove[0][0], groove[0][1]);
      groove.slice(1).forEach(([x, y]) => context.lineTo(x, y));
      context.closePath();
      context.fill();
    });

    context.strokeStyle = "#d0d8da";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(29, -4.7);
    context.lineTo(42, -1.6);
    context.stroke();

    context.fillStyle = "#dce3e5";
    context.beginPath();
    context.moveTo(DRILL_TIP_DISTANCE - 1, -0.8);
    context.lineTo(DRILL_TIP_DISTANCE + 2, 0);
    context.lineTo(DRILL_TIP_DISTANCE - 1, 0.8);
    context.closePath();
    context.fill();
    context.restore();
  }

  const drillDefinition = {
    id: "drill",
    name: "\u94bb\u5934",
    englishName: "Drill",
    color: "#397989",
    description: "\u9501\u5b9a\u51b2\u950b / \u94bb\u5c16\u5438\u9644 / \u8fde\u7eed\u94bb\u51fb",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 3.4,
    createBehavior(services) {
      let ownerBall = null;
      let phase = "cooldown";
      let cooldownDuration = INITIAL_COOLDOWN;
      let phaseRemaining = cooldownDuration;
      let headingX = 1;
      let headingY = 0;
      let capturedTarget = null;
      let captureEffect = null;
      let boringElapsed = 0;
      let nextDamageAt = DAMAGE_INTERVAL;
      let dashWallHit = false;
      let boringWallHit = false;
      let completedDashes = 0;

      function aimAtTarget(ball) {
        const target = services.getOpponent();
        if (!target) return;
        const direction = normalizeDirection(
          target.x - ball.x,
          target.y - ball.y,
          headingX,
          headingY
        );
        headingX = direction.x;
        headingY = direction.y;
      }

      function tipPosition(ball) {
        return {
          x: ball.x + headingX * DRILL_TIP_DISTANCE,
          y: ball.y + headingY * DRILL_TIP_DISTANCE
        };
      }

      function snapTargetToTip(ball, target, arenaSize) {
        if (!target || target.hp <= 0) return;
        const tip = tipPosition(ball);
        Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(tip.x, tip.y, target.radius));
        target.prevX = target.x;
        target.prevY = target.y;
        target.vx = 0;
        target.vy = 0;
      }

      function removeCaptureEffect(target) {
        if (!target || !captureEffect) return;
        if (target.effects.get(captureEffect.id) === captureEffect) {
          services.clearEffect(target, captureEffect.id);
        }
        captureEffect = null;
      }

      function startCooldown(ball, directionX, directionY) {
        cooldownDuration = Math.max(
          MINIMUM_COOLDOWN,
          Math.round((cooldownDuration - COOLDOWN_REDUCTION) * 100) / 100
        );
        completedDashes += 1;
        phase = "cooldown";
        phaseRemaining = cooldownDuration;
        dashWallHit = false;
        boringWallHit = false;
        boringElapsed = 0;
        nextDamageAt = DAMAGE_INTERVAL;
        const speed = ball.speed * ball.speedMultiplier;
        setVelocity(ball, directionX, directionY, speed);
      }

      function releaseSuccessfulDash(ball) {
        const target = capturedTarget;
        capturedTarget = null;
        removeCaptureEffect(target);
        if (target && target.hp > 0) {
          setVelocity(
            target,
            headingX,
            headingY,
            target.speed * target.speedMultiplier
          );
        }
        startCooldown(ball, -headingX, -headingY);
      }

      function abortCapture(ball) {
        const target = capturedTarget;
        capturedTarget = null;
        removeCaptureEffect(target);
        if (target && target.hp > 0) {
          const direction = normalizeDirection(
            target.storedVx,
            target.storedVy,
            headingX,
            headingY
          );
          setVelocity(
            target,
            direction.x,
            direction.y,
            target.speed * target.speedMultiplier
          );
        }
        if (ball && ball.hp > 0) {
          setVelocity(ball, headingX, headingY, ball.speed * ball.speedMultiplier);
        }
        phase = "cooldown";
        phaseRemaining = cooldownDuration;
      }

      function createCaptureEffect(source) {
        return {
          id: `drill-capture-${source.instanceId}`,
          duration: 3600,
          locksMovement: true,
          getContactProfile() {
            return { solid: false };
          },
          update({ ball, game }) {
            if (capturedTarget !== ball || source.hp <= 0 || phase !== "boring") {
              if (capturedTarget === ball) abortCapture(source);
              return;
            }
            snapTargetToTip(source, ball, game);
          },
          onExpire({ ball }) {
            if (capturedTarget === ball) abortCapture(source);
          }
        };
      }

      function beginDash(ball) {
        aimAtTarget(ball);
        phase = "dash";
        phaseRemaining = 0;
        dashWallHit = false;
        setVelocity(ball, headingX, headingY, DASH_SPEED);
      }

      function beginBoring(context, target) {
        if (phase !== "dash" || capturedTarget) return;
        const effect = services.applyEffect(
          target,
          createCaptureEffect(context.ball),
          context.ball
        );
        if (!effect) return;
        capturedTarget = target;
        captureEffect = effect;
        phase = "boring";
        boringElapsed = 0;
        nextDamageAt = DAMAGE_INTERVAL;
        dashWallHit = false;
        setVelocity(context.ball, headingX, headingY, BORING_SPEED);
        snapTargetToTip(context.ball, target, context.game);
        const tip = tipPosition(context.ball);
        services.spawnParticleBurst({
          kind: "drill-contact-particles",
          x: tip.x,
          y: tip.y,
          count: 20,
          minDiameter: 1,
          maxDiameter: 5,
          minSpeed: 35,
          maxSpeed: 115,
          life: 0.3,
          drag: 5,
          colors: ["#ffffff", "#b9c0c3", "#737b80"]
        });
      }

      function emitDamageParticles(ball) {
        const tip = tipPosition(ball);
        services.spawnParticleBurst({
          kind: "drill-boring-particles",
          x: tip.x,
          y: tip.y,
          count: 15,
          minDiameter: 1,
          maxDiameter: 6,
          minSpeed: 30,
          maxSpeed: 125,
          life: 0.28,
          drag: 4.8,
          colors: ["#ffffff", "#d9dddf", "#8d9599", "#555d61"]
        });
      }

      function processDamageTicks(ball) {
        while (
          capturedTarget &&
          nextDamageAt <= BORING_DURATION + EPSILON &&
          boringElapsed + EPSILON >= nextDamageAt
        ) {
          services.dealDamage(capturedTarget, DAMAGE_PER_TICK, ball);
          emitDamageParticles(ball);
          nextDamageAt += DAMAGE_INTERVAL;
        }
      }

      return {
        onAttackBorrowStart(context) { phaseRemaining = 0; this.afterUpdateStep(context); },
        isAttackCycleComplete() { return completedDashes > 0 && phase === "cooldown"; },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) { this.drawBefore(context, canvasContext); },
        onSpawn(context) {
          ownerBall = context.ball;
          aimAtTarget(context.ball);
        },
        update(context, dt) {
          ownerBall = context.ball;
          const elapsed = Math.max(0, dt);
          if (phase === "cooldown") {
            aimAtTarget(context.ball);
            phaseRemaining = Math.max(0, phaseRemaining - elapsed);
          } else if (phase === "dash") {
            setVelocity(context.ball, headingX, headingY, DASH_SPEED);
          } else if (phase === "boring") {
            if (boringWallHit) {
              context.ball.vx = context.ball.storedVx = 0;
              context.ball.vy = context.ball.storedVy = 0;
            } else {
              setVelocity(context.ball, headingX, headingY, BORING_SPEED);
            }
            boringElapsed = Math.min(BORING_DURATION, boringElapsed + elapsed);
          }
        },
        getNextTransitionIn() {
          if (phase === "cooldown") return Math.max(EPSILON, phaseRemaining);
          if (phase !== "boring") return undefined;
          const untilEnd = BORING_DURATION - boringElapsed;
          const untilDamage = nextDamageAt <= BORING_DURATION + EPSILON
            ? nextDamageAt - boringElapsed
            : untilEnd;
          return Math.max(EPSILON, Math.min(untilEnd, untilDamage));
        },
        afterUpdateStep(context) {
          if (phase === "cooldown" && phaseRemaining <= EPSILON) {
            beginDash(context.ball);
            return;
          }
          if (phase === "dash" && dashWallHit) {
            startCooldown(context.ball, context.ball.vx, context.ball.vy);
            return;
          }
          if (phase !== "boring") return;
          snapTargetToTip(context.ball, capturedTarget, context.game);
          processDamageTicks(context.ball);
          if (boringElapsed + EPSILON >= BORING_DURATION) {
            releaseSuccessfulDash(context.ball);
          }
        },
        onContactUpdate(context, target) {
          if (
            phase !== "dash" || capturedTarget ||
            !context.targetContact.attackable ||
            !sweptWeaponTouches(context.ball, target, headingX, headingY)
          ) return;
          beginBoring(context, target);
        },
        onWallBounce() {
          if (phase === "dash") dashWallHit = true;
          else if (phase === "boring") boringWallHit = true;
        },
        getContactProfile() {
          if (phase === "dash" || phase === "boring") {
            return { solid: false, attackable: true };
          }
          return { solid: true, attackable: true };
        },
        drawBefore(context, canvasContext) {
          drawDrillWeapon(
            canvasContext,
            context.ball,
            Math.atan2(headingY, headingX),
            phase === "dash" || phase === "boring",
            phase === "boring",
            context.game.time
          );
        },
        onBorrowEnd(context) {
          if (capturedTarget) abortCapture(context.ball);
          else if (phase === "dash" || phase === "boring") {
            setVelocity(
              context.ball,
              headingX,
              headingY,
              context.ball.speed * context.ball.speedMultiplier
            );
          }
        },
        getDrillState() {
          return {
            phase,
            cooldownDuration,
            cooldownRemaining: phase === "cooldown" ? phaseRemaining : 0,
            headingX,
            headingY,
            speed: ownerBall ? Math.hypot(ownerBall.vx, ownerBall.vy) : 0,
            boringElapsed,
            nextDamageAt,
            capturedTarget,
            completedDashes,
            tip: ownerBall ? tipPosition(ownerBall) : null
          };
        }
      };
    }
  };

  registerBall(drillDefinition);
  return {
    drillDefinition,
    DRILL_INITIAL_COOLDOWN: INITIAL_COOLDOWN,
    DRILL_MINIMUM_COOLDOWN: MINIMUM_COOLDOWN,
    DRILL_DASH_SPEED: DASH_SPEED,
    DRILL_BORING_SPEED: BORING_SPEED,
    DRILL_BORING_DURATION: BORING_DURATION,
    DRILL_DAMAGE_INTERVAL: DAMAGE_INTERVAL,
    DRILL_DAMAGE_PER_TICK: DAMAGE_PER_TICK,
    DRILL_TIP_DISTANCE
  };
});
