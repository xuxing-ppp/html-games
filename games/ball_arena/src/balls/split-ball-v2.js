(function initializeSplitBallV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSplitBallV2Plugin({ resolveArenaGeometry, registerBall }) {
  // ------------------------------------------------------------------
  // 玩法契约：受伤即分裂（不再是碰撞触发）；分裂后 1.8 秒内禁止复合；
  // 分身两两相连成红线，穿过红线的敌人吃 1 点接触伤害。
  // 与 v1 相同的部分：碰敌 -5、血量对半平分、同源分身接触后融合。
  // ------------------------------------------------------------------
  const COLLISION_DAMAGE = 2;
  const MIN_SPLIT_HP = 1;
  // 连线是两两相连（n 个分身就有 n(n-1)/2 条），所以片数必须封顶：
  // 20 片 = 190 条线，每帧只算一次线段并只描两次边（发光层 + 实线层）。
  const MAX_PIECES = 20;
  const SPLIT_ANGLE = 0.35;
  const MERGE_LOCK_SECONDS = 1.8;
  const LINK_DAMAGE = 1;
  const LINK_HALF_WIDTH = 0.6;
  const LINK_COLOR = "#ff2b3d";
  const LINK_GLOW = "rgba(255, 43, 61, 0.32)";
  const BURST_COLOR = "#ff6a78";
  const WEB_KIND = "split-v2-web";
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
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

  // 伤害来源的坐标（DoT / 环境伤害可能没有实体坐标，那就退回小球自身）。
  function sourcePositionFrom(event, ball) {
    const candidates = [
      event && event.credit,
      event && event.actor,
      event && event.owner,
      event && event.entity
    ];
    for (const candidate of candidates) {
      if (
        candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
      ) return candidate;
    }
    return { x: ball.x, y: ball.y };
  }

  function chooseClonePosition(ball, source, arenaSize) {
    const radius = ball.radius;
    const separation = radius * 2 + 2;
    const away = normalizeDirection(
      ball.x - source.x,
      ball.y - source.y,
      -(ball.storedVx || ball.vx),
      -(ball.storedVy || ball.vy)
    );
    // 分身摆在侧面（切向），避免和本体前后排成一条线。
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
      const sourceGap = Math.hypot(x - source.x, y - source.y);
      const score = Math.min(sourceDistance, sourceGap);
      if (score <= bestScore) continue;
      bestScore = score;
      best = { x, y };
    }
    return best || { x: ball.x, y: ball.y };
  }

  // 点到线段的距离平方：接触判定和扫掠判定共用。
  function pointSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    const offsetX = pointX - (startX + deltaX * progress);
    const offsetY = pointY - (startY + deltaY * progress);
    return offsetX * offsetX + offsetY * offsetY;
  }

  function orientation(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function segmentsCross(aX, aY, bX, bY, cX, cY, dX, dY) {
    const first = orientation(cX, cY, dX, dY, aX, aY);
    const second = orientation(cX, cY, dX, dY, bX, bY);
    const third = orientation(aX, aY, bX, bY, cX, cY);
    const fourth = orientation(aX, aY, bX, bY, dX, dY);
    return ((first > 0 && second < 0) || (first < 0 && second > 0)) &&
      ((third > 0 && fourth < 0) || (third < 0 && fourth > 0));
  }

  // 两条线段的最短距离平方。
  function segmentDistanceSquared(aX, aY, bX, bY, cX, cY, dX, dY) {
    if (segmentsCross(aX, aY, bX, bY, cX, cY, dX, dY)) return 0;
    return Math.min(
      pointSegmentDistanceSquared(aX, aY, cX, cY, dX, dY),
      pointSegmentDistanceSquared(bX, bY, cX, cY, dX, dY),
      pointSegmentDistanceSquared(cX, cY, aX, aY, bX, bY),
      pointSegmentDistanceSquared(dX, dY, aX, aY, bX, bY)
    );
  }

  // 线段与圆是否相交（用来判定敌人有没有压在那条红线上）。
  function segmentTouchesCircle(startX, startY, endX, endY, target) {
    const targetRadius = Number.isFinite(target.radius) ? Math.max(0, target.radius) : 0;
    const reach = targetRadius + LINK_HALF_WIDTH;
    return (
      pointSegmentDistanceSquared(target.x, target.y, startX, startY, endX, endY) <=
      reach * reach + EPSILON
    );
  }

  // 每帧只算一次线段表：两端都裁到球面上（画出来和打到的是同一段），
  // 顺带存好包围盒，穿线判定先用包围盒排除绝大多数线段。
  function buildSegments(pieces, into) {
    into.length = 0;
    for (let first = 0; first < pieces.length; first += 1) {
      const from = pieces[first];
      for (let second = first + 1; second < pieces.length; second += 1) {
        const to = pieces[second];
        const deltaX = to.x - from.x;
        const deltaY = to.y - from.y;
        const length = Math.hypot(deltaX, deltaY);
        if (length <= EPSILON) continue;
        const unitX = deltaX / length;
        const unitY = deltaY / length;
        const startX = from.x + unitX * from.radius;
        const startY = from.y + unitY * from.radius;
        const endX = to.x - unitX * to.radius;
        const endY = to.y - unitY * to.radius;
        into.push({
          key: [from.instanceId, to.instanceId].sort().join(":"),
          from,
          to,
          startX,
          startY,
          endX,
          endY,
          minX: Math.min(startX, endX) - LINK_HALF_WIDTH,
          maxX: Math.max(startX, endX) + LINK_HALF_WIDTH,
          minY: Math.min(startY, endY) - LINK_HALF_WIDTH,
          maxY: Math.max(startY, endY) + LINK_HALF_WIDTH
        });
      }
    }
    return into;
  }

  function traceSegments(canvas, segments) {
    canvas.beginPath();
    for (let index = 0; index < segments.length; index += 1) {
      const link = segments[index];
      canvas.moveTo(link.startX, link.startY);
      canvas.lineTo(link.endX, link.endY);
    }
  }

  // 发光层 + 实线层各描一次边：20 片 190 条线也只有两次 stroke。
  function drawLinks(canvas, segments, pulse) {
    if (!canvas || typeof canvas.beginPath !== "function") return;
    if (!Array.isArray(segments) || segments.length === 0) return;
    const base = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
    canvas.save();
    canvas.globalCompositeOperation = "lighter";
    canvas.lineCap = "round";

    canvas.globalAlpha = base * (0.32 + pulse * 0.16);
    canvas.strokeStyle = LINK_GLOW;
    canvas.lineWidth = 5;
    traceSegments(canvas, segments);
    canvas.stroke();

    canvas.globalAlpha = base * (0.75 + pulse * 0.25);
    canvas.strokeStyle = LINK_COLOR;
    canvas.lineWidth = 1.6;
    traceSegments(canvas, segments);
    canvas.stroke();

    canvas.restore();
  }

  function createSplitBurst(x, y) {
    return {
      kind: "split-v2-burst",
      life: 0.34,
      x,
      y,
      color: BURST_COLOR,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = effect.color;
        context.lineWidth = 1.5;
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4 - progress * 0.2;
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(angle) * (3 + progress * 4),
            effect.y + Math.sin(angle) * (3 + progress * 4)
          );
          context.lineTo(
            effect.x + Math.cos(angle) * (7 + progress * 16),
            effect.y + Math.sin(angle) * (7 + progress * 16)
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  // 连线是独立的战斗实体：它在场上持续追踪这一脉的所有分身，
  // 画它们的连线，也负责“穿线 -1”的接触伤害。
  function createSplitV2Web(lineageId) {
    let touching = new Map();

    function prunePieces(pieces) {
      for (let index = pieces.length - 1; index >= 0; index -= 1) {
        const piece = pieces[index];
        if (!piece || piece.hp <= 0 || piece.fade <= 0) pieces.splice(index, 1);
      }
    }

    // 每条连线独立判定接触，并检测敌人与连线端点的同步移动。
    //
    // 结算规则和蛛网（桔梗）一致：进入接触扣 1 点，同一次接触只扣一次，离开
    // 就立刻重新武装，没有任何冷却；不同连线不共享接触锁。
    function linkTouchesTarget(link, target, reachSquared, previousX, previousY) {
      if (segmentTouchesCircle(link.startX, link.startY, link.endX, link.endY, target)) {
        return true;
      }
      const stepX = target.x - previousX;
      const stepY = target.y - previousY;
      const from = link.from;
      const to = link.to;
      const fromX = Number.isFinite(from.prevX) ? from.prevX : from.x;
      const fromY = Number.isFinite(from.prevY) ? from.prevY : from.y;
      const toX = Number.isFinite(to.prevX) ? to.prevX : to.x;
      const toY = Number.isFinite(to.prevY) ? to.prevY : to.y;
      if (fromX === from.x && fromY === from.y && toX === to.x && toY === to.y) {
        return segmentDistanceSquared(
          link.startX, link.startY, link.endX, link.endY,
          previousX, previousY, target.x, target.y
        ) <= reachSquared + EPSILON;
      }
      // 同步插值敌人与两个端点，避免把不同时间的位置当成一次碰撞。
      const speedBound = Math.max(
        Math.hypot(from.x - fromX - stepX, from.y - fromY - stepY),
        Math.hypot(to.x - toX - stepX, to.y - toY - stepY)
      );
      if (speedBound <= EPSILON) return false;
      const reach = Math.sqrt(reachSquared);
      let time = 0;
      for (let iteration = 0; iteration < 80 && time <= 1; iteration += 1) {
        const ax = fromX + (from.x - fromX) * time;
        const ay = fromY + (from.y - fromY) * time;
        const bx = toX + (to.x - toX) * time;
        const by = toY + (to.y - toY) * time;
        const length = Math.hypot(bx - ax, by - ay);
        if (length <= from.radius + to.radius + EPSILON) {
          // 重叠球体之间没有可见连线。
          time += 0.01;
          continue;
        }
        const ux = (bx - ax) / length;
        const uy = (by - ay) / length;
        const distance = Math.sqrt(pointSegmentDistanceSquared(
          previousX + stepX * time, previousY + stepY * time,
          ax + ux * from.radius, ay + uy * from.radius,
          bx - ux * to.radius, by - uy * to.radius
        ));
        if (distance <= reach + 0.001) return true;
        // 裁切端点旋转的速度也计入上界。
        time += Math.max(0.00001, (distance - reach) / (speedBound * 3));
      }
      return false;
    }

    function damageCrossingEnemies(entity, webServices) {
      const segments = entity.segments;
      const nextTouching = new Map();
      webServices.forEachEnemy((enemy) => {
        if (!enemy || enemy.hp <= 0) return;
        const key = enemy.instanceId;
        const previousContacts = touching.get(key);
        const currentContacts = new Set();
        const reach = (Number.isFinite(enemy.radius) ? enemy.radius : 0) + LINK_HALF_WIDTH;
        const reachSquared = reach * reach;
        const previousX = Number.isFinite(enemy.prevX) ? enemy.prevX : enemy.x;
        const previousY = Number.isFinite(enemy.prevY) ? enemy.prevY : enemy.y;
        const minimumX = Math.min(enemy.x, previousX) - reach;
        const maximumX = Math.max(enemy.x, previousX) + reach;
        const minimumY = Math.min(enemy.y, previousY) - reach;
        const maximumY = Math.max(enemy.y, previousY) + reach;
        for (let index = 0; index < segments.length; index += 1) {
          const link = segments[index];
          const from = link.from;
          const to = link.to;
          const prevFromX = Number.isFinite(from.prevX) ? from.prevX : from.x;
          const prevFromY = Number.isFinite(from.prevY) ? from.prevY : from.y;
          const prevToX = Number.isFinite(to.prevX) ? to.prevX : to.x;
          const prevToY = Number.isFinite(to.prevY) ? to.prevY : to.y;
          if (Math.max(link.maxX, prevFromX, prevToX) < minimumX ||
              Math.min(link.minX, prevFromX, prevToX) > maximumX) continue;
          if (Math.max(link.maxY, prevFromY, prevToY) < minimumY ||
              Math.min(link.minY, prevFromY, prevToY) > maximumY) continue;
          if (segmentTouchesCircle(link.startX, link.startY, link.endX, link.endY, enemy)) {
            currentContacts.add(link.key);
          }
          if (linkTouchesTarget(link, enemy, reachSquared, previousX, previousY)) {
            if (!previousContacts || !previousContacts.has(link.key)) {
              webServices.dealDamage(enemy, LINK_DAMAGE);
            }
          }
        }
        if (currentContacts.size) nextTouching.set(key, currentContacts);
      });
      touching = nextTouching;
    }

    return {
      kind: WEB_KIND,
      combatKind: "trap",
      trap: true,
      life: PERMANENT_LIFE,
      drawLayer: "background",
      color: LINK_COLOR,
      damage: LINK_DAMAGE,
      lineageId,
      pieces: [],
      segments: [],
      update({ entity, game, services: webServices }, dt) {
        const pieces = entity.pieces;
        if (!Array.isArray(pieces)) {
          entity.entityActive = false;
          return;
        }
        prunePieces(pieces);
        if (pieces.length < 2) {
          // 只剩一块（或全灭）：连线没有意义了，自己退场。
          entity.entityActive = false;
          return;
        }
        buildSegments(pieces, entity.segments);
        damageCrossingEnemies(entity, webServices);
      },
      draw({ entity, game }, canvas) {
        const time = Number.isFinite(game && game.time) ? game.time : 0;
        // 帧内线段已在 update 里算好；首帧之前（还没 update 过）就地补算一次。
        const segments = Array.isArray(entity.segments) && entity.segments.length > 0
          ? entity.segments
          : buildSegments(Array.isArray(entity.pieces) ? entity.pieces : [], []);
        drawLinks(canvas, segments, 0.5 + 0.5 * Math.sin(time * 6));
      }
    };
  }

  let splitBallV2Definition;
  splitBallV2Definition = {
    id: "splitBallV2",
    name: "分裂v2",
    englishName: "Split V2",
    color: "#e60012",
    description: "无实体推挤，接触敌人 -5，仍承受碰撞伤害 / 受伤即分裂 / 分裂后 1.8 秒不能复合 / 分身连线，穿线 -1",
    summonsCountForTeamSurvival: true,
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
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

      function livePieces(ball) {
        const web = ball.splitV2Web;
        if (!web || !Array.isArray(web.pieces)) return [ball];
        return web.pieces.filter((piece) => piece && piece.hp > 0);
      }

      // 建立或延长这一脉的连线网，所有分身共享同一个 web 实体。
      function attachWeb(ball, pieces) {
        let web = ball.splitV2Web;
        if (!web || web.entityActive === false) {
          web = services.spawnCombatEntity(createSplitV2Web(ball.splitLineageId), {
            pieces: pieces.slice()
          });
        } else {
          for (const piece of pieces) {
            if (!web.pieces.includes(piece)) web.pieces.push(piece);
          }
        }
        for (const piece of pieces) piece.splitV2Web = web;
        return web;
      }

      function split(context, event) {
        const ball = context.ball;
        const now = context.game.time;
        if (livePieces(ball).length >= MAX_PIECES) return null;
        if (ball.hp + EPSILON < MIN_SPLIT_HP * 2) return null;
        const lowerHp = Math.max(MIN_SPLIT_HP, Math.floor(ball.hp / 2));
        const upperHp = ball.hp - lowerHp;
        if (upperHp + EPSILON < MIN_SPLIT_HP) return null;

        ensureLineage(ball);
        const source = sourcePositionFrom(event, ball);
        const position = chooseClonePosition(ball, source, context.game);
        const normal = normalizeDirection(
          ball.x - source.x,
          ball.y - source.y,
          ball.storedVx || ball.vx,
          ball.storedVy || ball.vy
        );
        // 两片沿受击面的切向反向弹开：像被一刀劈成两半。
        const tangent = rotate(normal, Math.PI / 2);
        const sourceDirection = rotate(tangent, SPLIT_ANGLE);
        const cloneDirection = rotate(tangent, SPLIT_ANGLE + Math.PI);
        const speed = ball.speed * ball.speedMultiplier;
        const clone = services.spawnSummon(splitBallV2Definition, {
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
        // 分裂后 1.8 秒内禁止复合：两条命都要等够时间。
        const mergeLockUntil = now + MERGE_LOCK_SECONDS;
        ball.splitMergeLockUntil = mergeLockUntil;
        clone.splitMergeLockUntil = mergeLockUntil;
        ball.vx = ball.storedVx = sourceDirection.x * speed;
        ball.vy = ball.storedVy = sourceDirection.y * speed;
        attachWeb(ball, [ball, clone]);
        services.spawnVisualEffect(createSplitBurst(
          (ball.x + clone.x) / 2,
          (ball.y + clone.y) / 2
        ));
        return clone;
      }

      function fuseTouchingPiece(context) {
        const ball = context.ball;
        const now = context.game.time;
        if (ball.splitMergeLockUntil && ball.splitMergeLockUntil > now) return null;
        const lineage = ensureLineage(ball);
        for (const ally of services.getAllies()) {
          if (ally.hp <= 0 || ally.id !== splitBallV2Definition.id) continue;
          if (ally.splitLineageId !== lineage) continue;
          if (ball.instanceId.localeCompare(ally.instanceId) >= 0) continue;
          if (ally.splitMergeLockUntil && ally.splitMergeLockUntil > now) continue;
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
          services.spawnVisualEffect(createSplitBurst(ball.x, ball.y));
          return ally;
        }
        return null;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          ensureLineage(context.ball);
        },
        update(context) {
          fuseTouchingPiece(context);
        },
        updateWhilePaused(context) {
          fuseTouchingPiece(context);
        },
        // 触发条件从「碰撞」改成「受到伤害」。
        onDamaged(context, event) {
          split(context, event);
        },
        getContactProfile() {
          return { solid: false, attackable: true, bodyContact: true };
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, COLLISION_DAMAGE);
          }
        },
        getLineageId() {
          return ownerBall ? ownerBall.splitLineageId : null;
        }
      };
    }
  };

  registerBall(splitBallV2Definition);
  return {
    splitBallV2Definition,
    createSplitV2Web,
    splitV2SegmentTouchesCircle: segmentTouchesCircle,
    SPLIT_V2_RULES: Object.freeze({
      COLLISION_DAMAGE,
      MIN_SPLIT_HP,
      MAX_PIECES,
      MERGE_LOCK_SECONDS,
      LINK_DAMAGE,
      LINK_HALF_WIDTH,
      LINK_COLOR,
      WEB_KIND
    })
  };
});
