(function initializeAnchor(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAnchorPlugin({ registerBall, createArenaGeometry }) {
  const CHAIN_LINK_COUNT = 14;
  const CHAIN_LENGTH = 90;
  const LINK_LENGTH = CHAIN_LENGTH / CHAIN_LINK_COUNT;
  // Idle motion: a pinned-end flick every 0.4s instead of a continuous motor.
  // The world-space Verlet links react to both the flick and the body rebound.
  const FLICK_INTERVAL = 0.25;
  const FLICK_DURATION = 0.05;
  const INITIAL_BEND = -0.06;
  const INITIAL_WAVE_AMPLITUDE = 0.12;
  const INITIAL_WAVE_STEP = 1.1;
  const CHAIN_SUBSTEP = 1 / 120;
  const CHAIN_DRAG = 2.2;
  const CHAIN_CONSTRAINT_ITERATIONS = 4;
  const TAUT_RESPONSE = 26;
  const MAX_TIP_PATH = 24;
  const CLAW_CAPTURE_RADIUS = 12;
  const CAPTURE_ANGULAR_SPEED = Math.PI * 2.5;
  const CAPTURE_TRAVEL = Math.PI * 2;
  const WALL_DAMAGE = 3;
  const RECAPTURE_DELAY = 0.25;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function hash01(value) {
    const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    }
    return (hash >>> 0) / 4294967296;
  }

  function shortestAngleDelta(from, to) {
    let delta = to - from;
    while (delta > Math.PI) delta -= TWO_PI;
    while (delta < -Math.PI) delta += TWO_PI;
    return delta;
  }

  function segmentTouchesCircle(ax, ay, bx, by, target, radius) {
    const abX = bx - ax;
    const abY = by - ay;
    const lengthSq = abX * abX + abY * abY;
    const t = lengthSq <= EPSILON
      ? 0
      : clamp(((target.x - ax) * abX + (target.y - ay) * abY) / lengthSq, 0, 1);
    return Math.hypot(
      target.x - (ax + abX * t),
      target.y - (ay + abY * t)
    ) <= radius;
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function createWallImpact(x, y, color) {
    const particles = Array.from({ length: 12 }, (_value, index) => {
      const particleAngle = index / 12 * Math.PI * 2 + (index % 2) * 0.16;
      const speed = 62 + (index % 4) * 18;
      return {
        color,
        x,
        y,
        vx: Math.cos(particleAngle) * speed,
        vy: Math.sin(particleAngle) * speed,
        size: 1.5 + index % 3
      };
    });
    return {
      kind: "anchor-wall-impact",
      life: 0.48,
      x,
      y,
      particles,
      update({ effect }, dt) {
        const drag = Math.exp(-4.5 * Math.max(0, dt));
        effect.particles.forEach((particle) => {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= drag;
          particle.vy *= drag;
        });
      },
      draw({ effect }, context) {
        const progress = Math.max(0, Math.min(1, effect.age / effect.life));
        context.save();
        const flash = 1 - progress;
        if (flash > 0.02) {
          const arm = 5 + progress * 9;
          context.globalAlpha *= flash * 0.9;
          context.strokeStyle = "#eef7fa";
          context.lineWidth = 1.5;
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(effect.x - arm, effect.y);
          context.lineTo(effect.x + arm, effect.y);
          context.moveTo(effect.x, effect.y - arm);
          context.lineTo(effect.x, effect.y + arm);
          context.stroke();
          context.fillStyle = "#ffffff";
          context.beginPath();
          context.arc(effect.x, effect.y, 2.4 * (1 - progress), 0, Math.PI * 2);
          context.fill();
        }
        effect.particles.forEach((particle) => {
          context.globalAlpha = 1 - progress;
          context.fillStyle = particle.color;
          context.beginPath();
          context.arc(particle.x, particle.y, particle.size * (1 - progress * 0.45), 0, Math.PI * 2);
          context.fill();
        });
        context.restore();
      }
    };
  }

  function drawChainRing(canvasContext, start, end, index, captured) {
    const centerX = (start.x + end.x) * 0.5;
    const centerY = (start.y + end.y) * 0.5;
    const angle = Math.atan2(end.y - start.y, end.x - start.x);
    const even = index % 2 === 0;
    const radiusX = even ? 4.35 : 3.65;
    const radiusY = even ? 2.5 : 2.85;
    canvasContext.save();
    canvasContext.translate(centerX, centerY);
    canvasContext.rotate(angle);
    canvasContext.strokeStyle = "#1b262d";
    canvasContext.lineWidth = 5.2;
    canvasContext.beginPath();
    canvasContext.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    canvasContext.stroke();
    canvasContext.strokeStyle = captured ? "#d8e8ed" : "#8799a2";
    canvasContext.lineWidth = 2.2;
    canvasContext.beginPath();
    canvasContext.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
    canvasContext.stroke();
    canvasContext.strokeStyle = captured ? "#f4fdff" : "#d9e3e7";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.ellipse(0, 0, radiusX, radiusY, 0, -2.5, -0.8);
    canvasContext.stroke();
    canvasContext.strokeStyle = "rgba(8, 13, 17, 0.55)";
    canvasContext.lineWidth = 1.1;
    canvasContext.beginPath();
    canvasContext.ellipse(0, 0, radiusX, radiusY, 0, 0.7, 2.4);
    canvasContext.stroke();
    canvasContext.restore();
  }

  function drawClawTip(canvasContext, points, captured) {
    const tip = points.at(-1);
    const previous = points.at(-2);
    const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    canvasContext.save();
    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";

    canvasContext.fillStyle = "#1b262d";
    canvasContext.beginPath();
    canvasContext.arc(tip.x, tip.y, 3.2, 0, Math.PI * 2);
    canvasContext.fill();
    canvasContext.strokeStyle = captured ? "#d8e8ed" : "#aebdc3";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.arc(tip.x, tip.y, 3.2, 0, Math.PI * 2);
    canvasContext.stroke();

    for (const offset of [-0.62, 0, 0.62]) {
      const startX = tip.x + normalX * offset * 2.5;
      const startY = tip.y + normalY * offset * 2.5;
      const midX = tip.x + directionX * 6 + normalX * offset * 8;
      const midY = tip.y + directionY * 6 + normalY * offset * 8;
      const endX = tip.x + directionX * 10 + normalX * offset * 12;
      const endY = tip.y + directionY * 10 + normalY * offset * 12;
      canvasContext.strokeStyle = "#1b262d";
      canvasContext.lineWidth = 4.2;
      canvasContext.beginPath();
      canvasContext.moveTo(startX, startY);
      canvasContext.quadraticCurveTo(midX, midY, endX, endY);
      canvasContext.stroke();
      canvasContext.strokeStyle = captured ? "#e6f7ff" : "#aebdc3";
      canvasContext.lineWidth = 1.6;
      canvasContext.beginPath();
      canvasContext.moveTo(startX, startY);
      canvasContext.quadraticCurveTo(midX, midY, endX, endY);
      canvasContext.stroke();
    }

    canvasContext.strokeStyle = captured ? "#f4fdff" : "#e8eff1";
    canvasContext.lineWidth = 0.65;
    canvasContext.beginPath();
    canvasContext.moveTo(tip.x, tip.y);
    canvasContext.quadraticCurveTo(
      tip.x + directionX * 6,
      tip.y + directionY * 6,
      tip.x + directionX * 10,
      tip.y + directionY * 10
    );
    canvasContext.stroke();
    canvasContext.restore();
  }

  function drawCaptureClamp(canvasContext, ball, source, time) {
    const angle = Math.atan2(ball.y - source.y, ball.x - source.x);
    const pulse = 0.72 + 0.18 * (0.5 + 0.5 * Math.sin(time * 9));
    const radius = ball.radius + 2.5;
    canvasContext.save();
    canvasContext.globalAlpha *= pulse;
    canvasContext.strokeStyle = "#dcefff";
    canvasContext.lineWidth = 1.5;
    canvasContext.lineCap = "round";
    canvasContext.beginPath();
    canvasContext.arc(
      ball.x, ball.y, radius,
      angle + Math.PI - 0.82,
      angle + Math.PI + 0.82
    );
    canvasContext.stroke();
    for (const offset of [-0.62, 0, 0.62]) {
      const facing = angle + Math.PI + offset;
      const startX = ball.x + Math.cos(facing) * (radius + 3);
      const startY = ball.y + Math.sin(facing) * (radius + 3);
      const endX = ball.x + Math.cos(facing) * (radius - 2);
      const endY = ball.y + Math.sin(facing) * (radius - 2);
      canvasContext.beginPath();
      canvasContext.moveTo(startX, startY);
      canvasContext.lineTo(endX, endY);
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function drawClaw(canvasContext, points, captured) {
    canvasContext.save();
    canvasContext.lineCap = "round";
    canvasContext.lineJoin = "round";
    for (let index = 0; index < points.length - 1; index += 1) {
      drawChainRing(canvasContext, points[index], points[index + 1], index, captured);
    }
    canvasContext.restore();
    drawClawTip(canvasContext, points, captured);
  }

  function createReleaseFlash(x, y, angle, color) {
    return {
      kind: "anchor-release",
      life: 0.28,
      x,
      y,
      angle,
      color,
      draw({ effect }, context) {
        const fade = 1 - effect.age / effect.life;
        const directionX = Math.cos(effect.angle);
        const directionY = Math.sin(effect.angle);
        const normalX = -directionY;
        const normalY = directionX;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= Math.max(0, fade);
        context.lineCap = "round";
        for (const offset of [-1, 0, 1]) {
          const length = offset === 0 ? 12 : 8;
          context.strokeStyle = offset === 0 ? "#eef7fa" : effect.color;
          context.lineWidth = offset === 0 ? 1.6 : 1;
          context.beginPath();
          context.moveTo(effect.x, effect.y);
          context.lineTo(
            effect.x + directionX * length + normalX * offset * 4,
            effect.y + directionY * length + normalY * offset * 4
          );
          context.stroke();
        }
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.arc(effect.x, effect.y, 2.2, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  const anchorDefinition = {
    id: "anchor",
    name: "\u951a",
    englishName: "Anchor",
    color: "#667784",
    description: "\u5341\u56db\u8282\u677e\u94fe\u94c1\u722a / \u6355\u83b7\u7ed5\u884c / \u649e\u5899 -3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services) {
      const releasedUntil = new Map();
      let angle = 0;
      let capturedTarget = null;
      let capturedTravel = 0;
      let captureEffectId = null;
      let ownerBall = null;
      const chainPoints = [];
      const tipPath = [];
      let flickActive = false;
      let flickStartAt = 0;
      let flickStartAngle = 0;
      let flickDelta = 0;
      let nextFlickAt = FLICK_INTERVAL;
      let flickIndex = 0;

      function angularSpeed() {
        return capturedTarget ? CAPTURE_ANGULAR_SPEED : 0;
      }

      function chainTip() {
        return chainPoints.length > 0 ? chainPoints[chainPoints.length - 1] : null;
      }

      function resetChain(ball) {
        chainPoints.length = 0;
        tipPath.length = 0;
        angle = 0;
        capturedTarget = null;
        capturedTravel = 0;
        captureEffectId = null;
        flickActive = false;
        flickStartAt = 0;
        flickStartAngle = 0;
        flickDelta = 0;
        nextFlickAt = FLICK_INTERVAL;
        flickIndex = 0;
        chainPoints.push(...initialChainPoints(ball));
      }

      function setChainBase(ball) {
        if (chainPoints.length < 2) return;
        const base = chainPoints[0];
        const shiftX = ball.x - base.x;
        const shiftY = ball.y - base.y;
        if (Math.hypot(shiftX, shiftY) > LINK_LENGTH * 2) {
          // A teleport (test setup / forced reposition) must not leave the
          // world-space chain stretched across the arena.
          for (const point of chainPoints) {
            point.x += shiftX;
            point.y += shiftY;
            point.prevX += shiftX;
            point.prevY += shiftY;
          }
        }
        base.x = ball.x;
        base.y = ball.y;
        base.prevX = ball.x;
        base.prevY = ball.y;
        const first = chainPoints[1];
        first.x = ball.x + Math.cos(angle) * LINK_LENGTH;
        first.y = ball.y + Math.sin(angle) * LINK_LENGTH;
        first.prevX = first.x;
        first.prevY = first.y;
      }

      function solveChain() {
        for (let iteration = 0; iteration < CHAIN_CONSTRAINT_ITERATIONS; iteration += 1) {
          for (let index = 1; index < chainPoints.length - 1; index += 1) {
            const a = chainPoints[index];
            const b = chainPoints[index + 1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= EPSILON) continue;
            const correction = (distance - LINK_LENGTH) / distance;
            if (index === 1) {
              b.x -= dx * correction;
              b.y -= dy * correction;
            } else {
              const half = correction * 0.5;
              a.x += dx * half;
              a.y += dy * half;
              b.x -= dx * half;
              b.y -= dy * half;
            }
          }
        }
      }

      function stepChain(h, ball, captured) {
        setChainBase(ball);
        const drag = Math.exp(-CHAIN_DRAG * h);
        for (let index = 2; index < chainPoints.length; index += 1) {
          const point = chainPoints[index];
          const vx = point.x - point.prevX;
          const vy = point.y - point.prevY;
          point.prevX = point.x;
          point.prevY = point.y;
          point.x += vx * drag;
          point.y += vy * drag;
        }
        if (captured) {
          const blend = 1 - Math.exp(-TAUT_RESPONSE * h);
          const directionX = Math.cos(angle);
          const directionY = Math.sin(angle);
          for (let index = 2; index < chainPoints.length; index += 1) {
            const point = chainPoints[index];
            const targetX = ball.x + directionX * LINK_LENGTH * index;
            const targetY = ball.y + directionY * LINK_LENGTH * index;
            point.x += (targetX - point.x) * blend;
            point.y += (targetY - point.y) * blend;
          }
        }
        solveChain();
      }

      function advanceDrive(time, h) {
        if (capturedTarget) {
          angle += CAPTURE_ANGULAR_SPEED * h;
          capturedTravel += CAPTURE_ANGULAR_SPEED * h;
          return;
        }
        if (flickActive) {
          const t = clamp((time + h - flickStartAt) / FLICK_DURATION, 0, 1);
          angle = flickStartAngle + flickDelta * (1 - Math.pow(1 - t, 3));
          if (t >= 1) {
            flickActive = false;
            nextFlickAt = flickStartAt + FLICK_INTERVAL;
          }
          return;
        }
        if (time + h + EPSILON >= nextFlickAt) {
          const startAt = Math.max(time, nextFlickAt);
          flickActive = true;
          flickStartAt = startAt;
          flickStartAngle = angle;
          flickIndex += 1;
          const key = ownerBall && ownerBall.instanceId ? ownerBall.instanceId : "anchor";
          const roll = hash01(hashString(key) * 37.71 + flickIndex * 17.13);
          const targetAngle = roll * TWO_PI;
          flickDelta = shortestAngleDelta(flickStartAngle, targetAngle);
          const t = clamp((time + h - flickStartAt) / FLICK_DURATION, 0, 1);
          angle = flickStartAngle + flickDelta * (1 - Math.pow(1 - t, 3));
          if (t >= 1) {
            flickActive = false;
            nextFlickAt = flickStartAt + FLICK_INTERVAL;
          }
        }
      }

      function initialChainPoints(ball) {
        const points = [{
          x: ball.x, y: ball.y,
          prevX: ball.x, prevY: ball.y
        }];
        let cumulative = 0;
        for (let index = 0; index < CHAIN_LINK_COUNT; index += 1) {
          if (index > 0) {
            cumulative += INITIAL_BEND +
              INITIAL_WAVE_AMPLITUDE * Math.sin(index * INITIAL_WAVE_STEP);
          }
          const previous = points[points.length - 1];
          const x = previous.x + Math.cos(cumulative) * LINK_LENGTH;
          const y = previous.y + Math.sin(cumulative) * LINK_LENGTH;
          points.push({ x, y, prevX: x, prevY: y });
        }
        return points;
      }

      function clawPoints(ball) {
        return chainPoints.length ? chainPoints : initialChainPoints(ball);
      }

      function releaseTarget(target, wallContact = null) {
        if (!target || capturedTarget !== target) return;
        const releasedEffectId = captureEffectId;
        capturedTarget = null;
        if (releasedEffectId) services.clearEffect(target, releasedEffectId);
        const releaseAngle = angle;
        let directionX = -Math.sin(releaseAngle);
        let directionY = Math.cos(releaseAngle);
        if (wallContact && wallContact.bouncedX) {
          directionX = target.x <= target.radius + EPSILON ? Math.abs(directionX) : -Math.abs(directionX);
        }
        if (wallContact && wallContact.bouncedY) {
          directionY = target.y <= target.radius + EPSILON ? Math.abs(directionY) : -Math.abs(directionY);
        }
        const magnitude = Math.hypot(directionX, directionY) || 1;
        const speed = target.speed * target.speedMultiplier;
        target.vx = target.storedVx = directionX / magnitude * speed;
        target.vy = target.storedVy = directionY / magnitude * speed;
        const tip = chainTip();
        if (tip && ownerBall && ownerBall.hp > 0 && target.hp > 0) {
          services.spawnVisualEffect(createReleaseFlash(
            tip.x,
            tip.y,
            Math.atan2(target.vy, target.vx),
            target.color
          ));
        }
        releasedUntil.set(targetKey(target), services.getTime() + RECAPTURE_DELAY);
        capturedTarget = null;
        capturedTravel = 0;
        captureEffectId = null;
        flickActive = false;
        nextFlickAt = services.getTime() + FLICK_INTERVAL;
      }

      function createCaptureEffect(source) {
        const id = `anchor-capture-${source.instanceId}`;
        return {
          id,
          duration: 3600,
          locksMovement: true,
          wallContactKey: null,
          getContactProfile() {
            return { solid: false };
          },
          update({ ball, effect, game, services: effectServices }) {
            if (source.hp <= 0 || capturedTarget !== ball) {
              releaseTarget(ball);
              return;
            }
            const tip = chainTip();
            const arena = game.arena || createArenaGeometry(game.arenaSize);
            const wallSides = [];
            if (arena.shape === "circle") {
              if (!arena.contains(tip.x, tip.y, ball.radius)) wallSides.push("circle");
            } else {
              if (tip.x < arena.left + ball.radius) wallSides.push("left");
              else if (tip.x > arena.right - ball.radius) wallSides.push("right");
              if (tip.y < arena.top + ball.radius) wallSides.push("top");
              else if (tip.y > arena.bottom - ball.radius) wallSides.push("bottom");
            }
            const wallContactKey = wallSides.join("|") || null;
            const position = arena.clampPoint(tip.x, tip.y, ball.radius);
            ball.x = position.x;
            ball.y = position.y;
            ball.vx = 0;
            ball.vy = 0;
            if (!wallContactKey) {
              effect.wallContactKey = null;
              return;
            }
            if (effect.wallContactKey === wallContactKey) return;
            effect.wallContactKey = wallContactKey;
            effectServices.dealDamage(ball, WALL_DAMAGE, { wallImpact: true });
            effectServices.spawnVisualEffect(createWallImpact(
              ball.x,
              ball.y,
              ball.color
            ));
          },
          draw({ ball, game }, context) {
            drawCaptureClamp(context, ball, source, game.time);
          },
          onExpire({ ball }) {
            releaseTarget(ball);
          }
        };
      }

      function captureTarget(context, target) {
        capturedTarget = target;
        capturedTravel = 0;
        captureEffectId = `anchor-capture-${context.ball.instanceId}`;
        services.applyEffect(target, createCaptureEffect(context.ball), context.ball);
      }

      function advance(context, dt) {
        const total = Math.max(0, dt);
        if (total <= EPSILON) {
          tipPath.length = 0;
          setChainBase(context.ball);
          solveChain();
          return;
        }
        tipPath.length = 0;
        const before = chainTip();
        if (before) tipPath.push({ x: before.x, y: before.y });
        const startTime = context.game.time - total;
        let remaining = total;
        let elapsed = 0;
        let guard = 0;
        while (remaining > EPSILON && guard < 600) {
          const h = Math.min(remaining, CHAIN_SUBSTEP);
          const time = startTime + elapsed;
          advanceDrive(time, h);
          stepChain(h, context.ball, Boolean(capturedTarget));
          const tip = chainTip();
          if (tip) {
            tipPath.push({ x: tip.x, y: tip.y });
            if (tipPath.length > MAX_TIP_PATH) tipPath.shift();
          }
          elapsed += h;
          remaining -= h;
          guard += 1;
          if (capturedTarget && capturedTravel + EPSILON >= CAPTURE_TRAVEL) {
            releaseTarget(capturedTarget);
          }
        }
      }

      function findCapture(context) {
        if (capturedTarget) return;
        const tip = chainTip();
        if (!tip) return;
        for (const target of services.getEnemies()) {
          const profile = services.getContactProfile(target);
          const blockedUntil = releasedUntil.get(targetKey(target)) || 0;
          const alreadyCaptured = Array.from(target.effects.keys()).some((id) => (
            id.startsWith("anchor-capture-")
          ));
          if (
            !profile.solid ||
            !profile.attackable ||
            target.positionLocked ||
            alreadyCaptured ||
            services.getTime() + EPSILON < blockedUntil
          ) continue;
          const radius = target.radius + CLAW_CAPTURE_RADIUS;
          let touched = Math.hypot(target.x - tip.x, target.y - tip.y) <= radius;
          if (!touched) {
            for (let index = 1; index < tipPath.length; index += 1) {
              if (segmentTouchesCircle(
                tipPath[index - 1].x,
                tipPath[index - 1].y,
                tipPath[index].x,
                tipPath[index].y,
                target,
                radius
              )) {
                touched = true;
                break;
              }
            }
          }
          if (!touched) continue;
          captureTarget(context, target);
          break;
        }
      }

      return {
        update(context, dt) {
          advance(context, dt);
        },
        updateWhilePaused(context, dt) {
          advance(context, dt);
        },
        afterUpdateStep(context) {
          findCapture(context);
        },
        drawBefore(context, canvasContext) {
          drawClaw(
            canvasContext,
            clawPoints(context.ball),
            Boolean(capturedTarget)
          );
        },
        borrowedWeaponLayer: "before",
        drawBorrowedWeapon(context, canvasContext) { this.drawBefore(context, canvasContext); },
        getAttackCycleDuration() { return 5; },
        onBorrowEnd() {
          if (capturedTarget) releaseTarget(capturedTarget);
          releasedUntil.clear();
        },
        getClawState() {
          return {
            angle,
            angularSpeed: angularSpeed(),
            capturedTarget,
            capturedTravel,
            points: ownerBall ? chainPoints.map((point) => ({ x: point.x, y: point.y })) : []
          };
        },
        onSpawn(context) {
          ownerBall = context.ball;
          resetChain(context.ball);
        }
      };
    }
  };

  registerBall(anchorDefinition);
  return { anchorDefinition };
});
