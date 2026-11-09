(function initializeBlitz(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js")), require("../core/sprite-cache.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBlitzPlugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback, createTextSpriteCache }) {
  // The values are intentionally grouped here: Blitz is a timing-heavy ball,
  // so balance changes should not require touching collision or renderer code.
  const BASE_SPEED = 150;
  const CHARGE_DURATION = 3;
  const ATTACK_DURATION = 1.8;
  const ATTACK_COOLDOWN = 1;
  const ATTACK_SPEED = 900;
  const BODY_DAMAGE = 2;
  const HIT_DAMAGE = 10;
  const HIT_INTERVAL = 0.12;
  const HIT_STUN_DURATION = 0.65;
  const CHARGE_BEEP_START_INTERVAL = 0.75;
  const CHARGE_BEEP_END_INTERVAL = 0.24;
  const WALL_BLAST_RADIUS = 38;
  const WALL_BLAST_DAMAGE = 6;
  const WALL_KNOCKBACK_DURATION = 0.16;
  const WALL_KNOCKBACK_SPEED = 620;
  const RICOCHET_BOUNCES = 4;
  // 路线点都落在墙上：引擎把本体钳到 radius 之后，位置和路线点常差零点几个单位，
  // 用精确相等判定会永远推进不了，本体就会贴着墙来回冲。这里给一个到达容差，
  // 并且允许「在路线点所在的那面墙上、已经越过它」的情况（沿墙越过时下一步会倒着回来）。
  const WAYPOINT_REACH = 2.5;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = Number.isFinite(x) ? x : 0;
    let directionY = Number.isFinite(y) ? y : 0;
    let magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
      magnitude = Math.hypot(directionX, directionY) || 1;
    }
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  // Swept relative motion prevents a 900-unit/s Blitz from tunnelling through
  // a moving target between two simulation steps.
  function movingCircleContact(startX, startY, endX, endY, target, radius) {
    const targetStartX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const targetStartY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const relativeStartX = startX - targetStartX;
    const relativeStartY = startY - targetStartY;
    const relativeDeltaX = (endX - target.x) - relativeStartX;
    const relativeDeltaY = (endY - target.y) - relativeStartY;
    const lengthSquared = relativeDeltaX ** 2 + relativeDeltaY ** 2;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        -(
          relativeStartX * relativeDeltaX +
          relativeStartY * relativeDeltaY
        ) / lengthSquared,
        0,
        1
      );
    const closestX = relativeStartX + relativeDeltaX * progress;
    const closestY = relativeStartY + relativeDeltaY * progress;
    return Math.hypot(closestX, closestY) <= target.radius + radius;
  }

  function mirroredCoordinate(coordinate, span, tile) {
    return tile * span + (Math.abs(tile % 2) === 0 ? coordinate : span - coordinate);
  }

  function foldCoordinate(coordinate, span) {
    const period = span * 2;
    const wrapped = ((coordinate % period) + period) % period;
    return wrapped <= span ? wrapped : period - wrapped;
  }

  function appendBoundaryEvents(events, start, end, span, tile, axis) {
    const delta = end - start;
    if (Math.abs(delta) <= EPSILON || tile === 0) return;
    if (tile > 0) {
      for (let step = 1; step <= tile; step += 1) {
        const progress = (step * span - start) / delta;
        if (progress > EPSILON && progress < 1 - EPSILON) {
          events.push({ progress, axis });
        }
      }
      return;
    }
    for (let step = 0; step < Math.abs(tile); step += 1) {
      const progress = (-step * span - start) / delta;
      if (progress > EPSILON && progress < 1 - EPSILON) {
        events.push({ progress, axis });
      }
    }
  }

  // Mirror-space ray casting turns a straight line to a reflected target into
  // an exact wall-bounce route in the real arena. Among the three-bounce
  // candidates that use both axes, Blitz selects the shortest one.
  function createRicochetRoute(ball, target, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") {
      let bestRoute = null;
      let bestScore = Infinity;
      for (let index = 0; index < 720; index += 1) {
        const angle = index * Math.PI / 360;
        let x = ball.x, y = ball.y, vx = Math.cos(angle), vy = Math.sin(angle);
        const route = [{ x, y }];
        for (let bounce = 0; bounce < RICOCHET_BOUNCES; bounce += 1) {
          const distance = arena.movementLimit(x, y, vx, vy, Infinity, ball.radius);
          x += vx * distance; y += vy * distance;
          route.push({ x, y });
          const length = Math.hypot(x - arena.centerX, y - arena.centerY) || 1;
          const nx = (arena.centerX - x) / length, ny = (arena.centerY - y) / length;
          const dot = vx * nx + vy * ny;
          vx -= 2 * dot * nx; vy -= 2 * dot * ny;
        }
        const tx = target.x - x, ty = target.y - y;
        const ahead = tx * vx + ty * vy;
        const score = Math.abs(tx * vy - ty * vx) + (ahead < 0 ? arena.size * 4 : 0);
        if (score < bestScore) { bestScore = score; bestRoute = route; }
      }
      bestRoute.push(arena.clampPoint(target.x, target.y, ball.radius));
      return bestRoute;
    }
    const spanX = arena.width - ball.radius * 2, spanY = arena.height - ball.radius * 2;
    if (Math.min(spanX, spanY) <= EPSILON) return [{ x: ball.x, y: ball.y }, { x: target.x, y: target.y }];
    const originX = arena.left + ball.radius, originY = arena.top + ball.radius;
    const startX = clamp(ball.x - originX, 0, spanX);
    const startY = clamp(ball.y - originY, 0, spanY);
    const targetX = clamp(target.x - originX, 0, spanX);
    const targetY = clamp(target.y - originY, 0, spanY);
    let best = null;

    for (let tileX = -RICOCHET_BOUNCES + 1; tileX < RICOCHET_BOUNCES; tileX += 1) {
      const tileYMagnitude = RICOCHET_BOUNCES - Math.abs(tileX);
      if (tileX === 0 || tileYMagnitude === 0) continue;
      for (const tileY of [-tileYMagnitude, tileYMagnitude]) {
        const imageX = mirroredCoordinate(targetX, spanX, tileX);
        const imageY = mirroredCoordinate(targetY, spanY, tileY);
        const distance = Math.hypot(imageX - startX, imageY - startY);
        if (best && distance >= best.distance - EPSILON) continue;
        best = { tileX, tileY, imageX, imageY, distance };
      }
    }

    if (!best) return [{ x: ball.x, y: ball.y }, { x: target.x, y: target.y }];
    const events = [];
    appendBoundaryEvents(events, startX, best.imageX, spanX, best.tileX, "x");
    appendBoundaryEvents(events, startY, best.imageY, spanY, best.tileY, "y");
    events.sort((left, right) => left.progress - right.progress);
    const mergedProgress = [];
    for (const event of events) {
      const previous = mergedProgress[mergedProgress.length - 1];
      if (previous !== undefined && Math.abs(previous - event.progress) <= 1e-7) continue;
      mergedProgress.push(event.progress);
    }
    const deltaX = best.imageX - startX;
    const deltaY = best.imageY - startY;
    const points = [{ x: ball.x, y: ball.y }];
    for (const progress of mergedProgress) {
      const virtualX = startX + deltaX * progress;
      const virtualY = startY + deltaY * progress;
      points.push({
        x: originX + foldCoordinate(virtualX, spanX),
        y: originY + foldCoordinate(virtualY, spanY)
      });
    }
    points.push({ x: target.x, y: target.y });
    return points;
  }

  function createBlitzStun() {
    return {
      id: "blitz-stun",
      visualType: "stun",
      duration: HIT_STUN_DURATION,
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true
    };
  }

  function createWallKnockback(directionX, directionY) {
    return createSharedKnockback({
      id: "blitz-wall-knockback",
      duration: WALL_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speed: WALL_KNOCKBACK_SPEED
    });
  }
  function drawTargetingLine(context, route, phase, time) {
    if (!route || route.length < 2 || typeof context.beginPath !== "function") return;
    const amplitude = phase === "attack" ? 2.2 : 2.8;
    const color = phase === "attack" ? "#ff3b35" : "#ffe052";
    const pulse = phase === "attack" ? 0.92 : 0.48 + 0.18 * Math.sin(time * 8);

    context.save();
    context.globalAlpha *= pulse;
    context.strokeStyle = color;
    context.lineWidth = phase === "attack" ? 1.4 : 1.1;
    context.beginPath();
    context.moveTo(route[0].x, route[0].y);
    let zigzagIndex = 0;
    for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
      const start = route[routeIndex - 1];
      const end = route[routeIndex];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= EPSILON) continue;
      const normalX = -dy / distance;
      const normalY = dx / distance;
      const segments = Math.max(2, Math.min(14, Math.ceil(distance / 16)));
      for (let index = 1; index <= segments; index += 1) {
        const progress = index / segments;
        const endpoint = index === segments;
        const offset = endpoint ? 0 : (++zigzagIndex % 2 === 0 ? amplitude : -amplitude);
        context.lineTo(
          start.x + dx * progress + normalX * offset,
          start.y + dy * progress + normalY * offset
        );
      }
    }
    context.stroke();
    context.restore();
  }

  function drawBlitzBody(context, ball, phase) {
    if (typeof context.arc !== "function") return;
    const attacking = phase === "attack";
    const outline = attacking ? "#ff3b35" : "#ffe052";
    const fill = attacking ? "#260b0d" : "#08090c";
    context.save();
    context.shadowColor = outline;
    context.shadowBlur = attacking ? 8 : 4;
    context.fillStyle = fill;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = outline;
    context.lineWidth = 2;
    context.stroke();
    context.restore();
  }

  function drawBlitzParticles(context, ball, phase, time) {
    if (typeof context.fillRect !== "function") return;
    const color = phase === "attack" ? "#ff453d" : "#ffe45c";
    context.save();
    context.fillStyle = color;
    for (let index = 0; index < 10; index += 1) {
      const angle = time * (phase === "attack" ? 18 : 8) + index * 2.399;
      const orbit = ball.radius + 4 + (index % 3) * 3;
      const size = index % 4 === 0 ? 2 : 1;
      context.globalAlpha = phase === "attack" ? 0.84 : 0.48 + (index % 3) * 0.1;
      context.fillRect(
        Math.round(ball.x + Math.cos(angle) * orbit - size / 2),
        Math.round(ball.y + Math.sin(angle) * orbit - size / 2),
        size,
        size
      );
    }
    context.restore();
  }

  function drawBlitzHp(context, ball, phase, hpTextCache, scale) {
    if (typeof context.fillText !== "function") return;
    context.save();
    context.font = "400 10px 'Ball Impact', Impact, Haettenschweiler, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    context.lineWidth = 1;
    context.strokeStyle = "rgba(25, 25, 25, 0.86)";
    context.fillStyle = phase === "attack" ? "#ff3b35" : "#ffe052";
    const text = String(Math.ceil(ball.hp));
    if (!hpTextCache.draw(context, text, ball.x, ball.y, scale)) {
      context.strokeText(text, ball.x, ball.y);
      context.fillText(text, ball.x, ball.y);
    }
    context.restore();
  }

  const blitzDefinition = {
    id: "blitz",
    name: "布利茨",
    englishName: "Blitz",
    color: "#f4d21f",
    description: "蓄力锁定 / 超高速折返冲刺 / 路径连击与撞墙爆破",
    stats: {
      radius: 15,
      speed: BASE_SPEED,
      maxHp: 100
    },
    rionCycleDuration: CHARGE_DURATION + ATTACK_DURATION + ATTACK_COOLDOWN,
    createBehavior(services) {
      let ownerBall = null;
      let phase = "charge";
      let phaseTime = 0;
      let targetInstanceId = null;
      let aimX = 0;
      let aimY = 0;
      let baseSpeed = BASE_SPEED;
      let plannedRoute = [];
      let routeIndex = 0;
      let waypointDistance = Infinity;
      let attackTrail = null;
      let lastWallImpactAt = -Infinity;
      let beepTimer = 0;
      const nextHitAt = new Map();
      const hpTextCache = createTextSpriteCache();

      function currentTarget() {
        if (!targetInstanceId) return null;
        const target = services.getBall(targetInstanceId);
        return target && target.hp > 0 ? target : null;
      }

      function chooseTarget(context) {
        const target = services.getOpponent();
        if (target && target.hp > 0) {
          targetInstanceId = target.instanceId;
          aimX = target.x;
          aimY = target.y;
          plannedRoute = createRicochetRoute(
            context.ball,
            target,
            context.game.arena || context.game.arenaSize
          );
        } else {
          targetInstanceId = null;
          plannedRoute = [];
        }
        return target;
      }

      function setVelocity(ball, directionX, directionY, speed) {
        const direction = normalizeDirection(
          directionX,
          directionY,
          ball.storedVx || ball.vx || 1,
          ball.storedVy || ball.vy || 0
        );
        const magnitude = speed * ball.speedMultiplier;
        ball.storedVx = direction.x * magnitude;
        ball.storedVy = direction.y * magnitude;
        ball.vx = ball.storedVx;
        ball.vy = ball.storedVy;
        ball.speedNeedsNormalization = false;
      }

      function beginAttack(context) {
        const ball = context.ball;
        const target = currentTarget() || chooseTarget(context);
        if (!target) {
          phase = "charge";
          phaseTime = 0;
          return false;
        }
        plannedRoute = createRicochetRoute(ball, target, context.game.arena || context.game.arenaSize);
        phase = "attack";
        phaseTime = 0;
        aimX = target.x;
        aimY = target.y;
        routeIndex = 1;
        waypointDistance = Infinity;
        lastWallImpactAt = -Infinity;
        ball.speed = ATTACK_SPEED;
        const waypoint = plannedRoute[routeIndex] || { x: aimX, y: aimY };
        setVelocity(ball, waypoint.x - ball.x, waypoint.y - ball.y, ATTACK_SPEED);
        attackTrail = services.spawnAfterimageTrail({
          kind: "blitz-attack-trail",
          color: "#ff3b35",
          radius: ball.radius,
          maxAlpha: 0.42,
          maxSamples: 16,
          sampleInterval: 0.02,
          sampleLife: 0.24,
          minScale: 0.25,
          widthRatio: 0.58,
          speedFloor: BASE_SPEED,
          speedRamp: ATTACK_SPEED - BASE_SPEED
        }, { lifecycle: "owner-bound" });
        return true;
      }

      function finishAttack(ball) {
        phase = "cooldown";
        phaseTime = 0;
        targetInstanceId = null;
        nextHitAt.clear();
        plannedRoute = [];
        routeIndex = 0;
        waypointDistance = Infinity;
        if (attackTrail) attackTrail.end();
        attackTrail = null;
        ball.speed = baseSpeed;
        ball.speedNeedsNormalization = true;
      }

      function finishCooldown(context) {
        phase = "charge";
        phaseTime = 0;
        beepTimer = 0;
        targetInstanceId = null;
        chooseTarget(context);
      }

      function hitPathTargets(context) {
        const ball = context.ball;
        const startX = Number.isFinite(ball.prevX) ? ball.prevX : ball.x;
        const startY = Number.isFinite(ball.prevY) ? ball.prevY : ball.y;
        const now = context.game.time;
        const seen = new Set();
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable) return;
          const key = target.instanceId;
          seen.add(key);
          const nextAllowed = nextHitAt.get(key) || 0;
          if (now + EPSILON < nextAllowed) return;
          if (!movingCircleContact(startX, startY, ball.x, ball.y, target, ball.radius)) return;
          if (!services.dealDamage(target, HIT_DAMAGE)) return;
          nextHitAt.set(key, now + HIT_INTERVAL);
          if (target.hp > 0) services.applyEffect(target, createBlitzStun());
          services.spawnParticleBurst({
            kind: "blitz-hit",
            x: target.x,
            y: target.y,
            count: 12,
            minDiameter: 1,
            maxDiameter: 4,
            minSpeed: 55,
            maxSpeed: 180,
            initialRadius: 2,
            life: 0.28,
            colors: [target.color, "#ffffff"]
          });
          services.shakeArena({ intensity: 2.5, duration: 0.06 });
        });
        for (const key of nextHitAt.keys()) {
          if (!seen.has(key)) nextHitAt.delete(key);
        }
      }

      function wallImpact(context) {
        const ball = context.ball;
        services.forEachEnemy((target) => {
          const dx = target.x - ball.x;
          const dy = target.y - ball.y;
          const distance = Math.hypot(dx, dy);
          if (distance > WALL_BLAST_RADIUS + target.radius) return;
          if (!services.getContactProfile(target).attackable) return;
          if (!services.dealDamage(target, WALL_BLAST_DAMAGE)) return;
          if (target.hp <= 0) return;
          const direction = normalizeDirection(dx, dy, context.bouncedX ? -1 : 0, context.bouncedY ? -1 : 0);
          services.applyEffect(target, createWallKnockback(direction.x, direction.y));
        });
        services.spawnParticleBurst({
          kind: "blitz-wall-impact",
          x: ball.x,
          y: ball.y,
          count: 36,
          minDiameter: 1,
          maxDiameter: 5,
          minSpeed: 80,
          maxSpeed: 260,
          initialRadius: 5,
          life: 0.5,
          colors: ["#ffe052", "#ff453d", "#ffffff"]
        });
        services.shakeArena({ intensity: 5, duration: 0.09 });
      }

      function wallImpactOnce(context) {
        if (Math.abs(context.game.time - lastWallImpactAt) <= EPSILON) return;
        lastWallImpactAt = context.game.time;
        wallImpact(context);
      }

      function updateChargeBeep() {
        const progress = clamp(phaseTime / CHARGE_DURATION, 0, 1);
        const interval = CHARGE_BEEP_START_INTERVAL +
          (CHARGE_BEEP_END_INTERVAL - CHARGE_BEEP_START_INTERVAL) * progress;
        if (beepTimer + EPSILON < interval) return;
        beepTimer %= interval;
        services.playSound("warning", {
          intensity: 0.38 + progress * 0.48,
          pitch: 0.82 + progress * 0.48
        });
      }

      // 本体是否已经算到达这个路线点：贴墙点被钳住时距离差零点几，
      // 沿墙越过时则表现为「同一面墙上、距离反而变远」。
      function routeWaypointReached(ball, waypoint, arenaSize) {
        const distance = Math.hypot(waypoint.x - ball.x, waypoint.y - ball.y);
        if (distance <= WAYPOINT_REACH) return true;
        if (distance <= waypointDistance + EPSILON) return false;
        const arena = resolveArenaGeometry(arenaSize);
        if (arena.shape === "circle") return !arena.contains(ball.x, ball.y, ball.radius + WAYPOINT_REACH) &&
          !arena.contains(waypoint.x, waypoint.y, ball.radius + WAYPOINT_REACH) && distance <= ATTACK_SPEED * 0.35;
        const minimum = arena.left + ball.radius + WAYPOINT_REACH;
        const maximum = arena.right - ball.radius - WAYPOINT_REACH;
        const minimumY = arena.top + ball.radius + WAYPOINT_REACH;
        const maximumY = arena.bottom - ball.radius - WAYPOINT_REACH;
        const onWaypointWall =
          (waypoint.x <= minimum && ball.x <= minimum) ||
          (waypoint.x >= maximum && ball.x >= maximum) ||
          (waypoint.y <= minimumY && ball.y <= minimumY) ||
          (waypoint.y >= maximumY && ball.y >= maximumY);
        return onWaypointWall && distance <= ATTACK_SPEED * 0.35;
      }

      function advanceRoute(context) {
        const ball = context.ball;
        while (phase === "attack" && routeIndex < plannedRoute.length) {
          const waypoint = plannedRoute[routeIndex];
          const distance = Math.hypot(waypoint.x - ball.x, waypoint.y - ball.y);
          const reached = routeWaypointReached(ball, waypoint, context.game.arena || context.game.arenaSize);
          waypointDistance = distance;
          if (!reached) break;
          if (routeIndex < plannedRoute.length - 1) {
            wallImpactOnce(context);
            routeIndex += 1;
            continue;
          }
          finishAttack(ball);
        }
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          baseSpeed = context.ball.speed || BASE_SPEED;
          phase = "charge";
          phaseTime = 0;
          beepTimer = 0;
          chooseTarget(context);
        },
        update(context, dt) {
          ownerBall = context.ball;
          const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
          phaseTime += elapsed;
          if (phase === "charge") {
            beepTimer += elapsed;
            updateChargeBeep();
            chooseTarget(context);
            return;
          }
          if (phase === "attack") {
            context.ball.speed = ATTACK_SPEED;
            const waypoint = plannedRoute[routeIndex] || { x: aimX, y: aimY };
            setVelocity(
              context.ball,
              waypoint.x - context.ball.x,
              waypoint.y - context.ball.y,
              ATTACK_SPEED
            );
          }
        },
        afterUpdateStep(context) {
          if (phase === "charge" && phaseTime + EPSILON >= CHARGE_DURATION) {
            beginAttack(context);
            return;
          }
          if (phase === "attack") {
            hitPathTargets(context);
            if (attackTrail) {
              attackTrail.emit(context.ball.x, context.ball.y, context.ball.radius, {
                color: "#ff3b35",
                speed: ATTACK_SPEED,
                heading: Math.atan2(context.ball.vy, context.ball.vx)
              });
            }
            advanceRoute(context);
            if (phaseTime + EPSILON >= ATTACK_DURATION) finishAttack(context.ball);
            return;
          }
          if (phase === "cooldown" && phaseTime + EPSILON >= ATTACK_COOLDOWN) {
            finishCooldown(context);
          }
        },
        getNextTransitionIn() {
          if (phase === "charge") return Math.max(EPSILON, CHARGE_DURATION - phaseTime);
          if (phase === "attack") {
            const phaseBoundary = Math.max(EPSILON, ATTACK_DURATION - phaseTime);
            const waypoint = plannedRoute[routeIndex];
            if (!ownerBall || !waypoint) return phaseBoundary;
            const distance = Math.hypot(waypoint.x - ownerBall.x, waypoint.y - ownerBall.y);
            const speed = ATTACK_SPEED * ownerBall.speedMultiplier;
            return Math.max(EPSILON, Math.min(phaseBoundary, distance / speed));
          }
          return Math.max(EPSILON, ATTACK_COOLDOWN - phaseTime);
        },
        onWallBounce(context) {
          if (phase !== "attack") return;
          wallImpactOnce(context);
          // 路线点就是撞墙点：引擎把本体钳在墙上时在这里补一次推进，
          // 否则本体可能贴着墙一直来回冲。
          const waypoint = plannedRoute[routeIndex] || context.ball;
          waypointDistance = Math.hypot(
            waypoint.x - context.ball.x,
            waypoint.y - context.ball.y
          ) + EPSILON * 10;
          advanceRoute(context);
        },
        onBeforeDamage(context, event) {
          if (phase !== "attack" || event.actor === context.ball) return event;
          return { amount: 0, showHitText: false };
        },
        getCapabilityOverrides() {
          if (phase !== "attack") return null;
          return {
            canMove: true,
            canAct: true,
            canBodyAttack: true,
            canDealDamage: true
          };
        },
        getContactProfile() {
          return phase === "attack"
            ? { solid: false, attackable: false }
            : { solid: true, attackable: true };
        },
        onCollision(context, target) {
          if (phase !== "attack" && !context.blockedAtContact) {
            context.services.dealDamage(target, BODY_DAMAGE);
          }
        },
        drawBefore(context, canvasContext) {
          if ((phase === "charge" || phase === "attack") && plannedRoute.length > 1) {
            const route = phase === "attack"
              ? [
                { x: context.ball.x, y: context.ball.y },
                ...plannedRoute.slice(routeIndex)
              ]
              : plannedRoute.map((point, index) => (
                index === 0 ? { x: context.ball.x, y: context.ball.y } : point
              ));
            drawTargetingLine(canvasContext, route, phase, context.game.time);
          }
        },
        drawBody(context, canvasContext) {
          drawBlitzBody(canvasContext, context.ball, phase);
          return true;
        },
        drawAfter(context, canvasContext) {
          drawBlitzParticles(canvasContext, context.ball, phase, context.game.time);
          const scale = canvasContext.canvas
            ? canvasContext.canvas.width / context.game.arenaSize
            : undefined;
          drawBlitzHp(canvasContext, context.ball, phase, hpTextCache, scale);
        },
        getHpDisplay() {
          return { hidden: true };
        },
        onDeath() {
          nextHitAt.clear();
          if (attackTrail) attackTrail.end(true);
          attackTrail = null;
        },
        onBorrowEnd() {
          nextHitAt.clear();
          if (attackTrail) attackTrail.end(true);
          attackTrail = null;
          ownerBall = null;
        },
        getBlitzState() {
          return {
            phase,
            phaseTime,
            targetInstanceId,
            routeIndex,
            route: plannedRoute.map((point) => ({ ...point })),
            attackSpeed: ATTACK_SPEED,
            hitDamage: HIT_DAMAGE,
            hitInterval: HIT_INTERVAL
          };
        }
      };
    }
  };

  registerBall(blitzDefinition);
  return {
    blitzDefinition,
    createBlitzStun,
    createWallKnockback,
    BLITZ_CONSTANTS: Object.freeze({
      BASE_SPEED,
      CHARGE_DURATION,
      ATTACK_DURATION,
      ATTACK_COOLDOWN,
      ATTACK_SPEED,
      BODY_DAMAGE,
      HIT_DAMAGE,
      HIT_INTERVAL,
      HIT_STUN_DURATION,
      CHARGE_BEEP_START_INTERVAL,
      CHARGE_BEEP_END_INTERVAL,
      WALL_BLAST_RADIUS,
      WALL_BLAST_DAMAGE,
      WALL_KNOCKBACK_DURATION,
      WALL_KNOCKBACK_SPEED,
      RICOCHET_BOUNCES
    }),
    createRicochetRoute
  };
});
