(function initializeSplitBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSplitBallPlugin({ resolveArenaGeometry, registerBall }) {
  const COLLISION_DAMAGE = 5;
  const MIN_SPLIT_HP = 1;
  const SPLIT_ANGLE = 0.35;
  // Freshly split pieces cannot fuse again until this window passes, so the
  // pair always gets a chance to separate instead of instantly re-merging.
  const MERGE_LOCK_SECONDS = 0.1;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function rotate(direction, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return {
      x: direction.x * cosine - direction.y * sine,
      y: direction.x * sine + direction.y * cosine
    };
  }

  function chooseClonePosition(ball, target, arenaSize) {
    const radius = ball.radius;
    const separation = radius * 2 + 2;
    const away = normalizeDirection(
      ball.x - target.x,
      ball.y - target.y,
      -(ball.storedVx || ball.vx),
      -(ball.storedVy || ball.vy)
    );
    // Prefer placing the clone beside the ball (along the contact surface)
    // so the two pieces visibly split apart instead of lining up behind it.
    const side = { x: -away.y, y: away.x };
    const directions = [
      side,
      { x: -side.x, y: -side.y },
      away,
      { x: -away.x, y: -away.y }
    ];
    let best = null;
    let bestScore = -Infinity;
    for (const direction of directions) {
      const { x: x, y: y } = resolveArenaGeometry(arenaSize).clampPoint(ball.x + direction.x * separation, ball.y + direction.y * separation, radius);
      const sourceDistance = Math.hypot(x - ball.x, y - ball.y);
      const enemyDistance = Math.hypot(x - target.x, y - target.y);
      const score = Math.min(sourceDistance, enemyDistance);
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, y };
    }
    return best || { x: ball.x, y: ball.y };
  }

  function createBurst(kind, x, y, color) {
    return {
      kind,
      life: 0.34,
      x,
      y,
      color,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade;
        context.strokeStyle = effect.color;
        context.lineWidth = 1.5;
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4 + (kind === "split-ball-merge" ? progress : -progress) * 0.2;
          const inner = kind === "split-ball-merge" ? 15 * (1 - progress) : 3 + progress * 4;
          const outer = kind === "split-ball-merge" ? 5 : 7 + progress * 16;
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(angle) * inner,
            effect.y + Math.sin(angle) * inner
          );
          context.lineTo(
            effect.x + Math.cos(angle) * outer,
            effect.y + Math.sin(angle) * outer
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  let splitBallDefinition;
  splitBallDefinition = {
    id: "splitBall",
    name: "\u5206\u88c2\u7403",
    englishName: "Split Ball",
    color: "#3569ad",
    description: "\u78b0\u654c -5 \u5e76\u5e73\u5206\u8840\u91cf / \u540c\u6e90\u5206\u8eab\u78b0\u649e\u878d\u5408",
    summonsCountForTeamSurvival: true,
    stats: {
      radius: 20,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 3,
    createBehavior(services) {
      let ownerBall = null;

      function ensureLineage(ball) {
        if (ball.splitLineageId) return ball.splitLineageId;
        const summoner = ball.summonerInstanceId
          ? services.getBall(ball.summonerInstanceId)
          : null;
        ball.splitLineageId = summoner && summoner.splitLineageId
          ? summoner.splitLineageId
          : ball.instanceId;
        return ball.splitLineageId;
      }

      function split(context, target) {
        const ball = context.ball;
        if (ball.hp + EPSILON < MIN_SPLIT_HP * 2) return null;
        const lowerHp = Math.max(MIN_SPLIT_HP, Math.floor(ball.hp / 2));
        const upperHp = ball.hp - lowerHp;
        if (upperHp + EPSILON < MIN_SPLIT_HP) return null;

        ensureLineage(ball);
        const position = chooseClonePosition(ball, target, context.game);
        const normal = normalizeDirection(
          ball.x - target.x,
          ball.y - target.y,
          ball.storedVx || ball.vx,
          ball.storedVy || ball.vy
        );
        // The two pieces drive apart in exactly opposite directions: one
        // follows the contact surface, the other its reverse.
        const tangent = rotate(normal, Math.PI / 2);
        const sourceDirection = rotate(tangent, SPLIT_ANGLE);
        const cloneDirection = rotate(tangent, SPLIT_ANGLE + Math.PI);
        const speed = ball.speed * ball.speedMultiplier;
        const clone = services.spawnSummon(splitBallDefinition, {
          x: position.x,
          y: position.y,
          vx: cloneDirection.x * speed,
          vy: cloneDirection.y * speed
        });
        if (!clone) return null;

        ball.hp = lowerHp;
        clone.hp = upperHp;
        clone.maxHp = ball.maxHp;
        clone.splitLineageId = ball.splitLineageId;
        const mergeLockUntil = context.game.time + MERGE_LOCK_SECONDS;
        ball.splitMergeLockUntil = mergeLockUntil;
        clone.splitMergeLockUntil = mergeLockUntil;
        ball.vx = ball.storedVx = sourceDirection.x * speed;
        ball.vy = ball.storedVy = sourceDirection.y * speed;
        services.spawnVisualEffect(createBurst(
          "split-ball-burst",
          (ball.x + clone.x) / 2,
          (ball.y + clone.y) / 2,
          "#79aaff"
        ));
        return clone;
      }

      function fuseTouchingClone(context) {
        const ball = context.ball;
        const now = context.game.time;
        if (
          ball.splitMergeLockUntil &&
          ball.splitMergeLockUntil > now
        ) return null;
        const lineage = ensureLineage(ball);
        for (const ally of services.getAllies()) {
          if (
            ally.hp <= 0 || ally.id !== splitBallDefinition.id ||
            ally.splitLineageId !== lineage ||
            ball.instanceId.localeCompare(ally.instanceId) >= 0
          ) continue;
          if (
            ally.splitMergeLockUntil &&
            ally.splitMergeLockUntil > now
          ) continue;
          if (Math.hypot(ally.x - ball.x, ally.y - ball.y) > (
            ally.radius + ball.radius + EPSILON
          )) continue;

          const ballHp = ball.hp;
          const allyHp = ally.hp;
          const totalHp = ballHp + allyHp;
          const totalWeight = Math.max(EPSILON, totalHp);
          ball.x = (ball.x * ballHp + ally.x * allyHp) / totalWeight;
          ball.y = (ball.y * ballHp + ally.y * allyHp) / totalWeight;
          const direction = normalizeDirection(
            ball.vx * ballHp + ally.vx * allyHp,
            ball.vy * ballHp + ally.vy * allyHp,
            ball.storedVx || ball.vx,
            ball.storedVy || ball.vy
          );
          ball.maxHp = Math.max(ball.maxHp, ally.maxHp);
          ball.hp = Math.min(ball.maxHp, totalHp);
          const speed = ball.speed * ball.speedMultiplier;
          ball.vx = ball.storedVx = direction.x * speed;
          ball.vy = ball.storedVy = direction.y * speed;
          ally.hp = 0;
          ally.fade = 0;
          ally.deathNotified = true;
          ally.vx = ally.vy = ally.storedVx = ally.storedVy = 0;
          services.spawnVisualEffect(createBurst(
            "split-ball-merge",
            ball.x,
            ball.y,
            "#b8d4ff"
          ));
          return ally;
        }
        return null;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          ensureLineage(context.ball);
        },
        drawBody(context, canvasContext) {
          const ball = context.ball;
          const visualRadius = 15;
          const spikeCount = 12;
          const baseHalf = 2.5;
          const rotation = (context.game ? context.game.time : 0) * 0.6;
          const centerX = ball.x;
          const centerY = ball.y;
          canvasContext.save();
          // A ring of spikes grows from the visual 15-radius body out to the
          // larger 20-radius collision edge.
          canvasContext.fillStyle = "#79aaff";
          for (let index = 0; index < spikeCount; index += 1) {
            const angle = index * Math.PI * 2 / spikeCount + rotation;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const px = -sin;
            const py = cos;
            canvasContext.beginPath();
            canvasContext.moveTo(
              centerX + cos * visualRadius + px * baseHalf,
              centerY + sin * visualRadius + py * baseHalf
            );
            canvasContext.lineTo(
              centerX + cos * ball.radius,
              centerY + sin * ball.radius
            );
            canvasContext.lineTo(
              centerX + cos * visualRadius - px * baseHalf,
              centerY + sin * visualRadius - py * baseHalf
            );
            canvasContext.closePath();
            canvasContext.fill();
          }
          canvasContext.fillStyle = ball.color;
          canvasContext.beginPath();
          canvasContext.arc(centerX, centerY, visualRadius, 0, Math.PI * 2);
          canvasContext.fill();
          canvasContext.restore();
          return true;
        },
        update(context) {
          fuseTouchingClone(context);
        },
        updateWhilePaused(context) {
          fuseTouchingClone(context);
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, COLLISION_DAMAGE);
          }
          split(context, target);
        },
        getSplitState() {
          return {
            lineageId: ownerBall ? ownerBall.splitLineageId : null,
            minimumHp: MIN_SPLIT_HP
          };
        }
      };
    }
  };

  registerBall(splitBallDefinition);
  return { splitBallDefinition };
});
