(function initializeInternationalChess(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createInternationalChessPlugin({ registerBall, createKnockbackEffect: createSharedKnockback }) {
  const NORMAL_DURATION = 3;
  const TRANSFER_DURATION = 0.75;
  const DOMAIN_FADE_DURATION = 0.35;
  const BOARD_CELLS = 5;
  const BOARD_OPACITY = 0.58;
  // Doubled from 0.08: domain piece movement now travels at 50% of its
  // original speed (each step takes twice as long).
  const STEP_DURATION = 0.16;
  const SPARK_SPACING = 8;
  const DUST_SPACING = 7;
  // 国际象棋的走子灰尘/碎屑走黑白棋盘配色，与它的传送火花同族。
  const DUST_COLORS = Object.freeze(["#d8dce0", "#b4bcc2", "#8d959b"]);
  const IMPACT_COLORS = Object.freeze(["#ffffff", "#e8ecef", "#cbd0d3", "#9aa3a9"]);
  const INVULNERABLE_LIGHT_COLOR = "#9fe0ff";   // 领域无敌时的本体散光
  const COLLISION_DAMAGE = 5;
  const ROUTE_HITBOX_HALF_SIZE = 20;
  const KNOCKBACK_SPEED_MULTIPLIER = 10;
  // 0.08 -> 0.16：击退时长翻倍（位移 = extraSpeed × D/3，时长即距离杠杆）。
  const KNOCKBACK_DURATION = 0.16;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function point(x, y) {
    return { x, y };
  }

  function easeInOutCubic(value) {
    const progress = clamp(value, 0, 1);
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function createRayRoute(id, piece, directions) {
    const points = [point(0, 0)];
    directions.forEach(([x, y]) => {
      points.push(point(x * 2, y * 2));
      points.push(point(0, 0));
    });
    return { id, piece, points };
  }

  function createKnightHorizontalRoute() {
    const steps = [
      [-2, 0], [0, 1], [0, -1], [2, 0],
      [2, 0], [0, -1], [0, 1], [-2, 0],
      [-1, 0], [0, -2], [0, 2], [1, 0],
      [1, 0], [0, 2], [0, -2], [-1, 0]
    ];
    const points = [point(0, 0)];
    steps.forEach(([stepX, stepY]) => {
      const previous = points[points.length - 1];
      points.push(point(previous.x + stepX, previous.y + stepY));
    });
    return { id: "knight-horizontal", piece: "knight", points };
  }

  function rotateRouteClockwise(route) {
    return {
      id: "knight-vertical",
      piece: "knight",
      points: route.points.map((routePoint) => point(-routePoint.y, routePoint.x))
    };
  }

  function createInternationalChessRoutes() {
    const knightHorizontal = createKnightHorizontalRoute();
    return [
      createRayRoute("rook", "rook", [[-1, 0], [1, 0], [0, -1], [0, 1]]),
      createRayRoute("bishop", "bishop", [[-1, -1], [1, 1], [-1, 1], [1, -1]]),
      knightHorizontal,
      rotateRouteClockwise(knightHorizontal)
    ];
  }

  // A weakened domain (used by Six King E) only makes one move with the
  // selected piece before returning to the centre.  Keep the route in the
  // same coordinate system as the full routes so the renderer and timing
  // code do not need a second path representation.
  function createSingleStepRoute(piece, directionIndex, routeId = piece) {
    const directions = piece === "rook"
      ? [[-1, 0], [1, 0], [0, -1], [0, 1]]
      : piece === "bishop"
        ? [[-1, -1], [1, 1], [-1, 1], [1, -1]]
        : [
            [-1, -2], [1, -2], [-2, -1], [2, -1],
            [-2, 1], [2, 1], [-1, 2], [1, 2]
          ];
    const selectedIndex = directionIndex === undefined
      ? Math.floor(Math.random() * directions.length)
      : directionIndex;
    const safeIndex = Math.max(0, Math.min(
      directions.length - 1,
      Number.isFinite(selectedIndex) ? Math.floor(selectedIndex) : 0
    ));
    const [stepX, stepY] = directions[safeIndex];
    const distance = piece === "knight" ? 1 : 2;
    return {
      id: routeId,
      piece,
      points: [
        point(0, 0),
        point(stepX * distance, stepY * distance),
        point(0, 0)
      ]
    };
  }

  function domainCellSize(arenaSize) {
    return arenaSize / BOARD_CELLS;
  }

  function routePointToArena(routePoint, arenaSize) {
    const cellSize = domainCellSize(arenaSize);
    return {
      x: arenaSize / 2 + routePoint.x * cellSize,
      y: arenaSize / 2 + routePoint.y * cellSize
    };
  }

  function segmentDuration(start, end) {
    return Math.max(
      STEP_DURATION,
      Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) * STEP_DURATION
    );
  }

  function squareHitboxTouchesTarget(ball, target) {
    if (!target) return false;
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

  function circleHitboxTouchesTarget(ball, target, radius) {
    if (!target) return false;
    return Math.hypot(target.x - ball.x, target.y - ball.y) <= radius + target.radius;
  }

  function createKnockbackEffect(source, directionX, directionY, options = {}) {
    return createSharedKnockback({
      id: "international-chess-knockback",
      duration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: Number.isFinite(options.knockbackSpeedMultiplier) ? options.knockbackSpeedMultiplier : KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function createTransferSpark(x, y, index) {
    return {
      kind: "international-chess-transfer-spark",
      life: 0.24 + (index % 2) * 0.05,
      x,
      y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.fillStyle = index % 3 === 0 ? "#ffffff" : "#cbd0d3";
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

  // 走棋拖尾：走子时沿行进路线按固定间距落下的灰尘（纯视觉特效，贴地）。
  function spawnRouteDust(services, x, y) {
    services.spawnParticleBurst({
      kind: "international-chess-route-dust",
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

  // 撞击粒子：走棋撞到目标时在接触点炸开的碎屑（不要冲击波）。
  function spawnRouteImpact(services, ball, target) {
    const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
    services.spawnParticleBurst({
      kind: "international-chess-route-impact",
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

  function drawBoardAndRoute(context, arenaSize, route, opacity) {
    if (!route || opacity <= 0) return;
    const cellSize = domainCellSize(arenaSize);
    const boardSize = cellSize * BOARD_CELLS;
    const boardStart = (arenaSize - boardSize) / 2;
    context.save();
    context.globalAlpha *= clamp(opacity, 0, 1) * BOARD_OPACITY;
    for (let row = 0; row < BOARD_CELLS; row += 1) {
      for (let column = 0; column < BOARD_CELLS; column += 1) {
        context.fillStyle = (row + column) % 2 === 0 ? "#f0f0ea" : "#202326";
        context.fillRect(
          boardStart + column * cellSize,
          boardStart + row * cellSize,
          cellSize,
          cellSize
        );
      }
    }
    context.strokeStyle = "#8f9599";
    context.lineWidth = 1;
    context.strokeRect(boardStart, boardStart, boardSize, boardSize);
    context.restore();

    context.save();
    context.globalAlpha *= clamp(opacity, 0, 1);
    context.strokeStyle = "#ff3048";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    route.points.forEach((routePoint, index) => {
      const arenaPoint = routePointToArena(routePoint, arenaSize);
      if (index === 0) context.moveTo(arenaPoint.x, arenaPoint.y);
      else context.lineTo(arenaPoint.x, arenaPoint.y);
    });
    context.stroke();
    context.restore();
  }

  function drawPieceMarker(context, ball, piece, opacity) {
    context.save();
    context.globalAlpha *= clamp(opacity, 0, 1);
    context.translate(Math.round(ball.x), Math.round(ball.y - ball.radius - 2));
    context.fillStyle = "#f4f1df";
    context.strokeStyle = "#141719";
    context.lineWidth = 1;
    context.lineJoin = "round";

    if (piece === "rook") {
      context.fillRect(-6, -10, 12, 8);
      context.strokeRect(-6, -10, 12, 8);
      context.fillRect(-8, -3, 16, 3);
      context.strokeRect(-8, -3, 16, 3);
      [-6, -1, 4].forEach((x) => {
        context.fillRect(x, -14, 3, 5);
        context.strokeRect(x, -14, 3, 5);
      });
    } else if (piece === "bishop") {
      context.beginPath();
      context.ellipse(0, -8, 5, 7, 0, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.moveTo(-2, -12);
      context.lineTo(2, -6);
      context.stroke();
      context.fillRect(-7, -3, 14, 3);
      context.strokeRect(-7, -3, 14, 3);
    } else {
      context.beginPath();
      context.moveTo(-7, 0);
      context.lineTo(-5, -5);
      context.lineTo(-2, -8);
      context.lineTo(-4, -14);
      context.lineTo(2, -12);
      context.lineTo(6, -7);
      context.lineTo(5, -3);
      context.lineTo(8, 0);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = "#141719";
      context.beginPath();
      context.arc(1.5, -9, 1, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  const internationalChessDefinition = {
    id: "internationalChess",
    name: "\u56fd\u9645\u8c61\u68cb",
    englishName: "International Chess",
    color: "#e5e3d8",
    description: "\u8f66\u8c61\u9a6c\u8def\u5f84 / \u9ed1\u767d\u68cb\u76d8 / \u65b9\u5f62\u78b0\u649e",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 8,
    createBehavior(services, options = {}) {
      const normalDuration = Number.isFinite(options.normalDuration)
        ? options.normalDuration
        : NORMAL_DURATION;
      const collisionDamage = Number.isFinite(options.collisionDamage)
        ? options.collisionDamage
        : COLLISION_DAMAGE;
      const routeHitboxShape = options.routeHitboxShape === "circle"
        ? "circle"
        : "square";
      const routeHitboxRadius = Number.isFinite(options.routeHitboxRadius)
        ? Math.max(0, options.routeHitboxRadius)
        : ROUTE_HITBOX_HALF_SIZE;
      const singleStep = options.singleStep === true;
      const knockbackOptions = {
        knockbackSpeedMultiplier: Number.isFinite(options.knockbackSpeedMultiplier)
          ? options.knockbackSpeedMultiplier
          : KNOCKBACK_SPEED_MULTIPLIER
      };
      let phase = "normal";
      let phaseTime = 0;
      let origin = null;
      let savedVelocity = null;
      let route = null;
      let routeIndex = 0;
      let routeContacting = false;
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
        const routes = createInternationalChessRoutes();
        const selectedRoute = routes[Math.min(
          routes.length - 1,
          Math.floor(Math.random() * routes.length)
        )];
        route = singleStep
          ? createSingleStepRoute(selectedRoute.piece, undefined, selectedRoute.id)
          : selectedRoute;
        routeIndex = 0;
        routeContacting = false;
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
        routeContacting = false;
      }

      function beginExit() {
        phase = "exit";
        phaseTime = 0;
        routeContacting = false;
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
        const startArena = routePointToArena(start, game.arenaSize);
        const endArena = routePointToArena(end, game.arenaSize);
        ball.x = startArena.x + (endArena.x - startArena.x) * progress;
        ball.y = startArena.y + (endArena.y - startArena.y) * progress;
        leaveRouteDust(services, routeDustState, previousX, previousY, ball.x, ball.y);
      }

      // 领域散光强度：往中心移动时逐渐发亮，领域中段最亮，返回原位时逐渐暗下。
      function domainLightIntensity() {
        if (phase === "normal") return 0;
        if (phase === "enter") return easeInOutCubic(phaseTime / TRANSFER_DURATION);
        if (phase === "exit") return 1 - easeInOutCubic(phaseTime / TRANSFER_DURATION);
        return 1;
      }

      function attackRouteContact(ball, target) {
        if (!target) return;
        const overlapping = routeHitboxShape === "circle"
          ? circleHitboxTouchesTarget(ball, target, routeHitboxRadius)
          : squareHitboxTouchesTarget(ball, target);
        if (!overlapping) {
          routeContacting = false;
          return;
        }
        if (routeContacting) return;
        if (!services.dealDamage(target, collisionDamage, ball)) return;
        spawnRouteImpact(services, ball, target);
        routeContacting = true;
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
          createKnockbackEffect(
            ball,
            directionX / magnitude,
            directionY / magnitude,
            knockbackOptions
          ),
          ball
        );
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
          if (phase === "normal") return normalDuration - phaseTime;
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
          if (phase === "normal" && phaseTime + EPSILON >= normalDuration) {
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
            attackRouteContact(context.ball, services.getOpponent());
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
        onBeforeDamage(_context, event) {
          if (phase !== "normal") return { amount: 0, showHitText: false };
          return event;
        },
        drawBefore(context, canvasContext) {
          // 领域期间不可选中、伤害归零 → 本体向外散出浅蓝色的光表示无敌。
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
          drawBoardAndRoute(canvasContext, context.game.arenaSize, route, opacity);
        },
        drawAfter(context, canvasContext) {
          if (!route || (phase !== "reveal" && phase !== "route")) return;
          const opacity = phase === "reveal"
            ? phaseTime / DOMAIN_FADE_DURATION
            : 1;
          drawPieceMarker(canvasContext, context.ball, route.piece, opacity);
        },
        getDomainState() {
          return {
            phase,
            phaseTime,
            routeId: route ? route.id : null,
            piece: route ? route.piece : null,
            routeIndex,
            singleStep,
            routePoints: route ? route.points.map(({ x, y }) => ({ x, y })) : []
          };
        }
      };
    }
  };

  registerBall(internationalChessDefinition);
  return {
    internationalChessDefinition,
    createInternationalChessRoutes,
    createInternationalChessSingleStepRoute: createSingleStepRoute,
    createInternationalChessKnockbackEffect: createKnockbackEffect
  };
});
