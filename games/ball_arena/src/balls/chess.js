(function initializeChess(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createChessPlugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback }) {
  const NORMAL_DURATION = 3;
  const TRANSFER_DURATION = 0.75;
  const DOMAIN_FADE_DURATION = 0.35;
  const GRID_MARGIN = 20;
  // Doubled from 0.08: domain piece movement now travels at 50% of its
  // original speed (each step takes twice as long).
  const STEP_DURATION = 0.16;
  const SPARK_SPACING = 8;
  const DUST_SPACING = 7;
  const DUST_COLORS = Object.freeze(["#cbbfa4", "#b3a789", "#8f8672"]);
  const IMPACT_COLORS = Object.freeze(["#ffe6a8", "#d6b75c", "#cbbfa4", "#fff6d8"]);
  const INVULNERABLE_LIGHT_COLOR = "#9fe0ff";   // 领域无敌时的本体散光
  const COLLISION_DAMAGE = 5;
  const ROUTE_HITBOX_HALF_SIZE = 20;
  const KNOCKBACK_SPEED_MULTIPLIER = 10;
  const KNOCKBACK_DURATION = 0.16;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeInOutCubic(value) {
    const progress = clamp(value, 0, 1);
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function point(x, y) {
    return { x, y };
  }

  function createHorseRoute() {
    const route = [point(0, 0)];
    [
      [-2, -1], [2, 1], [-2, 1], [2, -1],
      [-1, -2], [1, 2], [1, -2], [-1, 2]
    ].forEach(([x, y]) => {
      route.push(point(x, y));
      route.push(point(0, 0));
    });
    return { id: "horse", label: "马", points: route };
  }

  function createRayRoute(id, label, directions, distance) {
    const route = [point(0, 0)];
    directions.forEach(([x, y]) => {
      route.push(point(x * distance, y * distance));
      route.push(point(0, 0));
    });
    return { id, label, points: route };
  }

  function createRoutes() {
    const diagonals = [[-1, -1], [1, 1], [-1, 1], [1, -1]];
    const cardinals = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    return [
      createHorseRoute(),
      createRayRoute("elephant", "象", diagonals, 2),
      createRayRoute("rook", "車", cardinals, 2)
    ];
  }

  function routePointToArena(routePoint, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const spacingX = Math.max(0, arena.width - GRID_MARGIN * 2) / (arena.shape === "circle" ? 4 * Math.SQRT2 : 4);
    const spacingY = Math.max(0, arena.height - GRID_MARGIN * 2) / (arena.shape === "circle" ? 4 * Math.SQRT2 : 4);
    return arena.clampPoint(arena.centerX + routePoint.x * spacingX,
      arena.centerY + routePoint.y * spacingY, GRID_MARGIN);
  }

  function segmentDuration(start, end) {
    return Math.max(
      STEP_DURATION,
      Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * STEP_DURATION
    );
  }

  function routeHitboxTouchesTarget(ball, target) {
    const closestX = clamp(
      target.x,
      ball.x - ROUTE_HITBOX_HALF_SIZE,
      ball.x + ROUTE_HITBOX_HALF_SIZE
    );
    const closestY = clamp(
      target.y,
      ball.y - ROUTE_HITBOX_HALF_SIZE,
      ball.y + ROUTE_HITBOX_HALF_SIZE
    );
    return Math.hypot(target.x - closestX, target.y - closestY) <= target.radius;
  }

  function createKnockbackEffect(source, directionX, directionY) {
    return createSharedKnockback({
      id: "chess-knockback",
      duration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function createTransferSpark(x, y, index) {
    return {
      kind: "chess-transfer-spark",
      life: 0.24 + (index % 2) * 0.05,
      x,
      y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.fillStyle = index % 3 === 0 ? "#ffffff" : "#ffe89a";
        context.shadowColor = "#fff0b5";
        context.shadowBlur = 3;
        context.fillRect(Math.round(effect.x - 2), Math.round(effect.y), 5, 1);
        context.fillRect(Math.round(effect.x), Math.round(effect.y - 2), 1, 5);
        context.restore();
      }
    };
  }

  function leaveTransferSparks(services, state, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= EPSILON) return;
    const previousRemainder = state.remainder || 0;
    let nextDistance = SPARK_SPACING - previousRemainder;
    while (nextDistance <= distance + EPSILON) {
      const index = state.index || 0;
      const progress = clamp(nextDistance / distance, 0, 1);
      services.spawnVisualEffect(createTransferSpark(
        startX + deltaX * progress,
        startY + deltaY * progress,
        index
      ));
      state.index = index + 1;
      nextDistance += SPARK_SPACING;
    }
    state.remainder = (previousRemainder + distance) % SPARK_SPACING;
  }

  // 走棋拖尾：走子时沿行进路线按固定间距落下的灰尘。纯视觉特效
  //（drawLayer: "background"）——贴在地面、不参与战斗，落地后自行消散。
  function spawnRouteDust(services, x, y) {
    services.spawnParticleBurst({
      kind: "chess-route-dust",
      x,
      y,
      count: 3,
      minDiameter: 1,
      maxDiameter: 3,
      colors: DUST_COLORS,
      life: 0.42,
      drag: 3.4,
      gravityY: 26,
      minSpeed: 6,
      maxSpeed: 28,
      initialRadius: 3
    }, { drawLayer: "background" });
  }

  function leaveRouteDust(services, state, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= EPSILON) return;
    const previousRemainder = state.remainder || 0;
    let nextDistance = DUST_SPACING - previousRemainder;
    while (nextDistance <= distance + EPSILON) {
      const progress = clamp(nextDistance / distance, 0, 1);
      spawnRouteDust(
        services,
        startX + deltaX * progress,
        startY + deltaY * progress
      );
      nextDistance += DUST_SPACING;
    }
    state.remainder = (previousRemainder + distance) % DUST_SPACING;
  }

  // 撞击粒子：走棋撞到目标时在接触点炸开的碎屑 + 一圈冲击环。
  function spawnRouteImpact(services, ball, target) {
    const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
    services.spawnParticleBurst({
      kind: "chess-route-impact",
      x: (ball.x + target.x) / 2,
      y: (ball.y + target.y) / 2,
      count: 12,
      minDiameter: 1.5,
      maxDiameter: 4,
      colors: IMPACT_COLORS,
      life: 0.5,
      drag: 2.6,
      minSpeed: 45,
      maxSpeed: 140,
      directionAngle: angle,
      directionSpread: Math.PI * 0.7,
      initialRadius: 4
    });
  }

  function drawGridAndRoute(context, arenaSize, route, opacity) {
    if (!route || opacity <= 0) return;
    const arena = resolveArenaGeometry(arenaSize);
    const center = arena.centerX;
    const spacingX = Math.max(0, arena.width - GRID_MARGIN * 2) / (arena.shape === "circle" ? 4 * Math.SQRT2 : 4);
    const spacingY = Math.max(0, arena.height - GRID_MARGIN * 2) / (arena.shape === "circle" ? 4 * Math.SQRT2 : 4);
    context.save();
    context.globalAlpha *= clamp(opacity, 0, 1);
    if (arena.shape === "circle") { arena.tracePath(context); context.clip(); }
    context.strokeStyle = "#c4c8ca";
    context.lineWidth = 1;
    for (let index = -2; index <= 2; index += 1) {
      const offsetX = index * spacingX;
      const offsetY = index * spacingY;
      context.beginPath();
      context.moveTo(center + offsetX, arena.top);
      context.lineTo(center + offsetX, arena.bottom);
      context.stroke();
      context.beginPath();
      context.moveTo(arena.left, center + offsetY);
      context.lineTo(arena.right, center + offsetY);
      context.stroke();
    }
    context.fillStyle = "#d8dcde";
    for (let x = -2; x <= 2; x += 1) {
      for (let y = -2; y <= 2; y += 1) {
        context.fillRect(
          Math.round(center + x * spacingX - 1),
          Math.round(center + y * spacingY - 1),
          3,
          3
        );
      }
    }

    context.globalAlpha *= 0.92;
    context.strokeStyle = "#ff3048";
    context.lineWidth = 1.5;
    context.beginPath();
    route.points.forEach((routePoint, index) => {
      const arenaPoint = routePointToArena(routePoint, arenaSize);
      if (index === 0) context.moveTo(arenaPoint.x, arenaPoint.y);
      else context.lineTo(arenaPoint.x, arenaPoint.y);
    });
    context.stroke();
    context.restore();
  }

  const chessDefinition = {
    id: "chess",
    name: "象棋",
    englishName: "Chess",
    color: "#d6b75c",
    description: "三秒普通 / 五子领域",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let phase = "normal";
      let phaseTime = 0;
      let origin = null;
      let savedVelocity = null;
      let route = null;
      let routeIndex = 0;
      let routeContacts = new Set();
      let transferSparkState = { remainder: 0, index: 0 };
      let routeDustState = { remainder: 0 };

      function enterDomain(ball) {
        phase = "enter";
        phaseTime = 0;
        origin = { x: ball.x, y: ball.y };
        savedVelocity = {
          x: ball.storedVx || ball.vx,
          y: ball.storedVy || ball.vy
        };
        transferSparkState = { remainder: 0, index: 0 };
        routeDustState = { remainder: 0 };
        services.setMovementLocked(true);
        ball.positionLocked = true;
      }

      function beginReveal(ball, game) {
        const routes = createRoutes();
        const roll = Math.random();
        route = roll < 0.5
          ? routes[0]
          : (roll < 0.75 ? routes[1] : routes[2]);
        routeIndex = 0;
        routeContacts.clear();
        phase = "reveal";
        phaseTime = 0;
        ball.x = game.arenaSize / 2;
        ball.y = game.arenaSize / 2;
      }

      function beginRoute(ball, game) {
        phase = "route";
        phaseTime = 0;
        routeDustState = { remainder: 0 };
        ball.x = game.arenaSize / 2;
        ball.y = game.arenaSize / 2;
      }

      function beginConceal() {
        phase = "conceal";
        phaseTime = 0;
        routeContacts.clear();
      }

      function beginExit() {
        phase = "exit";
        phaseTime = 0;
        routeContacts.clear();
        transferSparkState = { remainder: 0, index: 0 };
      }

      function finishDomain(ball) {
        phase = "normal";
        phaseTime = 0;
        ball.x = origin.x;
        ball.y = origin.y;
        ball.positionLocked = false;
        services.setMovementLocked(false);
        ball.storedVx = savedVelocity.x;
        ball.storedVy = savedVelocity.y;
        ball.vx = savedVelocity.x;
        ball.vy = savedVelocity.y;
        origin = null;
        savedVelocity = null;
        route = null;
      }

      // 领域散光强度：往中心移动时逐渐发亮，领域中段最亮，返回原位时逐渐暗下。
      function domainLightIntensity() {
        if (phase === "normal") return 0;
        if (phase === "enter") return easeInOutCubic(phaseTime / TRANSFER_DURATION);
        if (phase === "exit") return 1 - easeInOutCubic(phaseTime / TRANSFER_DURATION);
        return 1;
      }

      function updateTransfer(ball, start, end, duration) {
        const previousX = ball.x;
        const previousY = ball.y;
        const progress = easeInOutCubic(phaseTime / duration);
        ball.x = start.x + (end.x - start.x) * progress;
        ball.y = start.y + (end.y - start.y) * progress;
        leaveTransferSparks(
          services,
          transferSparkState,
          previousX,
          previousY,
          ball.x,
          ball.y
        );
      }

      function updateRoutePosition(ball, game) {
        const previousX = ball.x;
        const previousY = ball.y;
        const start = route.points[routeIndex];
        const end = route.points[routeIndex + 1];
        const duration = segmentDuration(start, end);
        const progress = easeInOutCubic(phaseTime / duration);
        const startArena = routePointToArena(start, game.arena || game.arenaSize);
        const endArena = routePointToArena(end, game.arena || game.arenaSize);
        ball.x = startArena.x + (endArena.x - startArena.x) * progress;
        ball.y = startArena.y + (endArena.y - startArena.y) * progress;
        leaveRouteDust(services, routeDustState, previousX, previousY, ball.x, ball.y);
      }

      function attackRouteContacts(ball) {
        const activeContacts = new Set();
        services.forEachEnemy((target) => {
          if (!routeHitboxTouchesTarget(ball, target)) return;
          const contactKey = target.instanceId || target;
          if (routeContacts.has(contactKey)) {
            activeContacts.add(contactKey);
            return;
          }
          if (!services.dealDamage(target, COLLISION_DAMAGE, ball)) return;
          spawnRouteImpact(services, ball, target);
          activeContacts.add(contactKey);
          if (target.hp <= 0) return;
          let directionX = target.x - ball.x;
          let directionY = target.y - ball.y;
          if (Math.hypot(directionX, directionY) <= EPSILON) {
            directionX = savedVelocity.x || 1;
            directionY = savedVelocity.y || 0;
          }
          const magnitude = Math.hypot(directionX, directionY) || 1;
          services.applyEffect(
            target,
            createKnockbackEffect(ball, directionX / magnitude, directionY / magnitude),
            ball
          );
        });
        routeContacts = activeContacts;
      }

      return {
        update(context, dt) {
          phaseTime += Math.max(0, dt);
          if (phase === "enter") {
            updateTransfer(
              context.ball,
              origin,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 },
              TRANSFER_DURATION
            );
          } else if (phase === "route") {
            updateRoutePosition(context.ball, context.game);
          } else if (phase === "exit") {
            updateTransfer(
              context.ball,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 },
              origin,
              TRANSFER_DURATION
            );
          }
        },
        getNextTransitionIn() {
          if (phase === "normal") return NORMAL_DURATION - phaseTime;
          if (phase === "enter" || phase === "exit") {
            return TRANSFER_DURATION - phaseTime;
          }
          if (phase === "reveal" || phase === "conceal") {
            return DOMAIN_FADE_DURATION - phaseTime;
          }
          const start = route.points[routeIndex];
          const end = route.points[routeIndex + 1];
          return segmentDuration(start, end) - phaseTime;
        },
        afterUpdateStep(context) {
          if (phase === "normal" && phaseTime + EPSILON >= NORMAL_DURATION) {
            enterDomain(context.ball);
            return;
          }
          if (phase === "enter" && phaseTime + EPSILON >= TRANSFER_DURATION) {
            beginReveal(context.ball, context.game);
            return;
          }
          if (phase === "reveal" && phaseTime + EPSILON >= DOMAIN_FADE_DURATION) {
            beginRoute(context.ball, context.game);
            return;
          }
          if (phase === "route") {
            attackRouteContacts(context.ball);
            const start = route.points[routeIndex];
            const end = route.points[routeIndex + 1];
            if (phaseTime + EPSILON < segmentDuration(start, end)) return;
            phaseTime = 0;
            routeIndex += 1;
            if (routeIndex >= route.points.length - 1) beginConceal();
            return;
          }
          if (phase === "conceal" && phaseTime + EPSILON >= DOMAIN_FADE_DURATION) {
            beginExit();
            return;
          }
          if (phase === "exit" && phaseTime + EPSILON >= TRANSFER_DURATION) {
            finishDomain(context.ball);
          }
        },
        getCapabilityOverrides() {
          return phase !== "normal"
            ? { canAct: true, canBodyAttack: true, canDealDamage: true }
            : null;
        },
        getContactProfile() {
          return phase === "normal"
            ? { solid: true, attackable: true }
            : { solid: false, attackable: false };
        },
        onBeforeDamage(context, event) {
          if (phase !== "normal") return { amount: 0, showHitText: false };
          return event;
        },
        getHpDisplay() {
          return phase !== "normal" && route ? { text: route.label } : undefined;
        },
        getSelectedRouteId() {
          return route ? route.id : null;
        },
        drawBefore(context, canvasContext) {
          // 领域期间象棋不可选中、伤害归零 → 本体向外散出浅蓝色的光表示无敌。
          // 是"光"不是"环"：径向渐变从本体边缘化开，不描任何一圈线。
          const intensity = domainLightIntensity();
          if (intensity <= 0) return;
          if (typeof canvasContext.createRadialGradient !== "function") return;
          const ball = context.ball;
          const time = context.game.time;
          const pulse = 0.5 + 0.5 * Math.sin(time * 6);
          const inner = ball.radius * 0.8;
          const outer = ball.radius + 18;
          canvasContext.save();
          const glow = canvasContext.createRadialGradient(
            ball.x, ball.y, inner,
            ball.x, ball.y, outer
          );
          glow.addColorStop(0, `rgba(159,224,255,${(intensity * (0.40 + pulse * 0.16)).toFixed(3)})`);
          glow.addColorStop(0.42, `rgba(127,208,255,${(intensity * (0.15 + pulse * 0.09)).toFixed(3)})`);
          glow.addColorStop(1, "rgba(127,208,255,0)");
          canvasContext.fillStyle = glow;
          canvasContext.beginPath();
          canvasContext.arc(ball.x, ball.y, outer, 0, Math.PI * 2);
          canvasContext.fill();
          canvasContext.restore();
        },
        drawArenaBackground(context, canvasContext) {
          let opacity = 0;
          if (phase === "reveal") opacity = phaseTime / DOMAIN_FADE_DURATION;
          else if (phase === "route") opacity = 1;
          else if (phase === "conceal") opacity = 1 - phaseTime / DOMAIN_FADE_DURATION;
          drawGridAndRoute(canvasContext, context.game.arena || context.game.arenaSize, route, opacity);
        }
      };
    }
  };

  registerBall(chessDefinition);
  return { chessDefinition };
});
