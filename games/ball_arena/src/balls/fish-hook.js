(function initializeFishHook(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFishHookPlugin({ registerBall, resolveArenaGeometry }) {
  const FIRE_INTERVAL = 3;
  const HOOK_SPEED = 250;
  const MAX_OUTWARD_LENGTH = 800;
  const REEL_DAMAGE_DISTANCE = 30;
  const REEL_DAMAGE = 2;
  const HOOK_RADIUS = 3;
  const LINE_WIDTH = 1.2;
  const ENTITY_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const BODY_COLOR = "#3da9b6";
  const LINE_COLOR = "#d7f4f5";
  const LINE_SHADOW = "#238392";
  const HOOK_COLOR = "#d8e2e5";
  const BLOOD_COLORS = ["#d51f3d", "#ff5b6e", "#a80f2a", "#ffd0d5"];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function reflectHook(entity, hit, arena) {
    if (arena.shape !== "circle" && hit.normalX && hit.normalY) {
      entity.vx *= -1; entity.vy *= -1;
    } else {
      const dot = entity.vx * hit.normalX + entity.vy * hit.normalY;
      entity.vx -= 2 * dot * hit.normalX;
      entity.vy -= 2 * dot * hit.normalY;
    }
  }

  function appendPoint(path, x, y) {
    const previous = path.at(-1);
    if (!previous || Math.hypot(previous.x - x, previous.y - y) > EPSILON) {
      path.push({ x, y });
    }
  }

  function polylineLength(path) {
    let length = 0;
    for (let index = 1; index < path.length; index += 1) {
      length += Math.hypot(
        path[index].x - path[index - 1].x,
        path[index].y - path[index - 1].y
      );
    }
    return length;
  }

  function pointOnReversedPath(path, distance) {
    let remaining = Math.max(0, distance);
    for (let index = path.length - 1; index > 0; index -= 1) {
      const end = path[index];
      const start = path[index - 1];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (segmentLength <= EPSILON) continue;
      if (remaining <= segmentLength + EPSILON) {
        const progress = clamp(remaining / segmentLength, 0, 1);
        return {
          x: end.x + (start.x - end.x) * progress,
          y: end.y + (start.y - end.y) * progress,
          directionX: (start.x - end.x) / segmentLength,
          directionY: (start.y - end.y) / segmentLength
        };
      }
      remaining -= segmentLength;
    }
    const first = path[0] || { x: 0, y: 0 };
    return { x: first.x, y: first.y, directionX: 0, directionY: 0 };
  }

  function drawRouteToDistance(context, path, distance) {
    if (!path || path.length === 0) return;
    context.moveTo(path[0].x, path[0].y);
    let remaining = Math.max(0, distance);
    for (let index = 1; index < path.length; index += 1) {
      const start = path[index - 1];
      const end = path[index];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
      if (segmentLength <= EPSILON) continue;
      if (remaining + EPSILON >= segmentLength) {
        context.lineTo(end.x, end.y);
        remaining -= segmentLength;
        continue;
      }
      const progress = clamp(remaining / segmentLength, 0, 1);
      context.lineTo(
        start.x + (end.x - start.x) * progress,
        start.y + (end.y - start.y) * progress
      );
      break;
    }
  }

  // The geometric segment query deliberately does not decide whether an
  // enemy is targetable. Filter through the shared contact profile so
  // invisible/phased targets cannot be hooked, while a visible target farther
  // along the same segment is still considered.
  function firstAttackableEnemyHit(entityServices, startX, startY, endX, endY, radius) {
    const lineX = endX - startX;
    const lineY = endY - startY;
    const lengthSquared = lineX * lineX + lineY * lineY;
    let first = null;
    let firstProgress = Infinity;
    entityServices.forEachEnemy((enemy) => {
      const profile = entityServices.getContactProfile(enemy);
      if (!profile || profile.attackable === false) return;
      const progress = lengthSquared <= EPSILON
        ? 0
        : clamp(
          ((enemy.x - startX) * lineX + (enemy.y - startY) * lineY) / lengthSquared,
          0,
          1
        );
      const closestX = startX + lineX * progress;
      const closestY = startY + lineY * progress;
      if (
        Math.hypot(enemy.x - closestX, enemy.y - closestY) <= enemy.radius + radius &&
        progress < firstProgress
      ) {
        first = enemy;
        firstProgress = progress;
      }
    });
    return first;
  }

  function drawFishHookLine(entity, context) {
    if (!entity) return;
    const path = entity.path || [];
    if (path.length === 0) return;
    const endpoint = { x: entity.x, y: entity.y };
    const route = path.slice();
    const isReeling = entity.phase === "reel" && Number.isFinite(entity.totalPathLength);
    if (!isReeling) appendPoint(route, endpoint.x, endpoint.y);
    const visibleLength = isReeling
      ? clamp(entity.totalPathLength - entity.reelDistance, 0, entity.totalPathLength)
      : polylineLength(route);
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.shadowColor = LINE_SHADOW;
    context.shadowBlur = 3;
    context.strokeStyle = "rgba(35, 131, 146, 0.72)";
    context.lineWidth = LINE_WIDTH + 2;
    context.beginPath();
    drawRouteToDistance(context, route, visibleLength);
    context.stroke();
    context.shadowBlur = 0;
    context.strokeStyle = LINE_COLOR;
    context.lineWidth = LINE_WIDTH;
    context.beginPath();
    drawRouteToDistance(context, route, visibleLength);
    context.stroke();
    context.restore();
  }

  function drawFishHookTip(entity, context) {
    if (!entity) return;
    const endpoint = { x: entity.x, y: entity.y };
    const angle = Number.isFinite(entity.latchedAngle)
      ? entity.latchedAngle : Math.atan2(entity.vy, entity.vx);
    context.save();
    context.translate(endpoint.x, endpoint.y);
    context.rotate(angle);
    context.strokeStyle = HOOK_COLOR;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(-1, -1);
    context.lineTo(7, 0);
    context.arc(7, 3.5, 3.5, -Math.PI / 2, Math.PI * 0.72);
    context.lineTo(3.5, 3.2);
    context.stroke();
    context.restore();
  }

  function spawnBlood(entityServices, target) {
    entityServices.spawnParticleBurst({
      kind: "fish-hook-blood-splash",
      x: target.x,
      y: target.y,
      count: 14,
      minDiameter: 1,
      maxDiameter: 4,
      minSpeed: 55,
      maxSpeed: 180,
      initialRadius: 2,
      life: 0.42,
      drag: 2.8,
      colors: BLOOD_COLORS
    });
  }

  function createReelEffect(entity, target) {
    const id = `fish-hook-reel-${entity.instanceId}-${target.instanceId}`;
    return {
      id,
      duration: Number.MAX_SAFE_INTEGER,
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      blocksOwnedEntityDamage: true,
      forceCapabilities: Object.freeze({
        canBodyAttack: false,
        canDealDamage: false
      }),
      getContactProfile() {
        // A carried target should not create a second body collision while it
        // is attached to the hook, matching the anchor's capture behavior.
        return { solid: false };
      }
    };
  }

  // 同一个目标可能被两根（甚至更多）钩子同时钩住。原始移动状态必须只在
  // 「第一个按住它的钩子」手里存一次，并且只有「最后一个松手的钩子」才还原：
  // 否则第二根钩子会把「已经被第一根锁住」的状态当成原始状态存下来，两根都收完线
  // 之后目标就被永久 positionLocked，卡在原地再也不动。
  const reelHolds = new WeakMap();

  function latchReelTarget(entity, target, entityServices) {
    if (!target || target.hp <= 0) return;
    if (!entity.reelTargets.has(target.instanceId)) {
      // 一根钩子最多带几个目标：鱼塘是 1（一个鱼钩钩住一个敌方），
      // 鱼钩本体不限（它本来就是乱抛的大钩）。
      const capacity = Number.isFinite(entity.maxReelTargets)
        ? entity.maxReelTargets
        : Infinity;
      if (entity.reelTargets.size >= capacity) return;
      // 已经被别的钩子钩住的目标不再重复上钩：否则第二根钩子会当场转入收线，
      // 一路打不出伤害，还把自己白白收没了。
      const held = reelHolds.get(target);
      if (held && held.count > 0) return;
      const effect = entityServices && typeof entityServices.applyEffect === "function"
        ? entityServices.applyEffect(target, createReelEffect(entity, target))
        : null;
      if (!effect) return;
      // 钩住时保留入钩朝向；收线速度反向不代表钩尖翻转。
      if (!Number.isFinite(entity.latchedAngle)) {
        entity.latchedAngle = Math.atan2(entity.vy, entity.vx);
      }
      let hold = reelHolds.get(target);
      if (!hold) {
        hold = {
          count: 0,
          saved: {
            positionLocked: target.positionLocked === true,
            vx: target.vx,
            vy: target.vy,
            storedVx: target.storedVx,
            storedVy: target.storedVy,
            speedNeedsNormalization: target.speedNeedsNormalization === true
          }
        };
        reelHolds.set(target, hold);
      }
      hold.count += 1;
      entity.reelTargets.set(target.instanceId, {
        target,
        effectId: effect ? effect.id : null,
        nextDamageDistance: entity.reelDistance + REEL_DAMAGE_DISTANCE
      });
      // The hook owns the target's position for the duration of the return.
      target.positionLocked = true;
      target.vx = 0;
      target.vy = 0;
      target.storedVx = 0;
      target.storedVy = 0;
      target.speedNeedsNormalization = false;
      target.prevX = target.x;
      target.prevY = target.y;
    }
    entity.reelTarget = target;
  }

  function releaseReelTargets(entity) {
    if (!entity || !(entity.reelTargets instanceof Map)) return;
    // 统一走 releaseReelTarget：还原原始状态这件事由「最后一个松手的钩子」负责，
    // 这里再写一遍内联还原就会把别的钩子还按着的目标提前放开。
    for (const instanceId of Array.from(entity.reelTargets.keys())) {
      releaseReelTarget(entity, instanceId);
    }
    entity.reelTarget = null;
  }

  function dragReelTargets(entity, game) {
    if (!(entity.reelTargets instanceof Map)) return;
    for (const [instanceId, record] of entity.reelTargets) {
      const target = record.target;
      if (!target || target.hp <= 0 || target.active === false) {
        releaseReelTarget(entity, instanceId);
        continue;
      }
      Object.assign(target, resolveArenaGeometry(game).clampPoint(entity.x, entity.y, target.radius));
      target.prevX = target.x;
      target.prevY = target.y;
      target.vx = 0;
      target.vy = 0;
      target.storedVx = 0;
      target.storedVy = 0;
    }
  }

  function releaseReelTarget(entity, instanceId) {
    const record = entity.reelTargets && entity.reelTargets.get(instanceId);
    if (!record) return;
    const target = record.target;
    if (target) {
      entity.services.clearEffect(target, record.effectId);
      const hold = reelHolds.get(target);
      if (hold) {
        hold.count -= 1;
        if (hold.count <= 0) {
          // 最后一根钩子松手：这才把原始移动状态还回去。
          reelHolds.delete(target);
          const saved = hold.saved;
          // A pre-existing anchor can end while carried (for example retracting rods).
          // Do not resurrect that expired lock when the hook releases its own hold.
          target.positionLocked = saved.positionLocked && target.positionLocked === true;
          target.vx = Number.isFinite(saved.vx) ? saved.vx : 0;
          target.vy = Number.isFinite(saved.vy) ? saved.vy : 0;
          target.storedVx = Number.isFinite(saved.storedVx) ? saved.storedVx : target.vx;
          target.storedVy = Number.isFinite(saved.storedVy) ? saved.storedVy : target.vy;
          target.speedNeedsNormalization = saved.speedNeedsNormalization;
        }
      }
    }
    entity.reelTargets.delete(instanceId);
    if (entity.reelTarget === target) entity.reelTarget = null;
  }

  function restoreOwnerState(entity) {
    const source = entity && entity.owner;
    const state = entity && entity.ownerState;
    if (!source || !state) return;
    source.x = state.x;
    source.y = state.y;
    source.prevX = state.x;
    source.prevY = state.y;
    source.vx = state.vx;
    source.vy = state.vy;
    source.storedVx = state.storedVx;
    source.storedVy = state.storedVy;
    source.speedNeedsNormalization = state.speedNeedsNormalization;
    source.positionLocked = state.positionLocked;
    source.movementLocked = state.movementLocked;
  }

  function pinOwner(entity) {
    const source = entity && entity.owner;
    const state = entity && entity.ownerState;
    if (!source || !state) return;
    source.x = state.x;
    source.y = state.y;
    source.prevX = state.x;
    source.prevY = state.y;
    source.vx = 0;
    source.vy = 0;
    source.storedVx = state.storedVx;
    source.storedVy = state.storedVy;
    source.speedNeedsNormalization = false;
    source.positionLocked = true;
    source.movementLocked = true;
  }

  // 收线伤害：被钩住的目标每前进 REEL_DAMAGE_DISTANCE 挨一次 REEL_DAMAGE。
  // 鱼塘的下沉钩用的是同一个函数 —— 「伤害机制和鱼钩完全相同」就是这一句。
  function damageReelTargets(entity, hookServices) {
    if (!(entity.reelTargets instanceof Map)) return;
    for (const [instanceId, record] of entity.reelTargets) {
      if (!record.target || record.target.hp <= 0) {
        releaseReelTarget(entity, instanceId);
        continue;
      }
      while (entity.reelDistance + EPSILON >= record.nextDamageDistance) {
        if (hookServices.dealDamage(record.target, REEL_DAMAGE)) {
          spawnBlood(hookServices, record.target);
        }
        record.nextDamageDistance += REEL_DAMAGE_DISTANCE;
      }
    }
  }

  // 钩子后面那根线：单独一条背景视效，跟着钩子画到它当前位置。
  // 生命周期必须由调用方按**这根钩子实体的**生命周期传进来（见 createHookEntity）：
  // 线比钩子先死就会剩下一根没线的空钩飘在场上，线比钩子后死就会留下一条
  // 指向虚空的长线。两者都只能靠「线跟着钩子走」来保证。
  function spawnHookLineVisual(services, hook, lifecycle = "owner-bound") {
    const line = services.spawnVisualEffect({
      kind: "fish-hook-line",
      lifecycle,
      drawLayer: "background",
      life: ENTITY_LIFE,
      hook,
      update({ effect }) {
        // 钩子被别的东西吃掉、或被外力提前失效时（entityActive 被置 false），
        // 这条独立的线自己不会知道 —— 钩子没了就立刻跟着收掉。
        if (!effect.hook || effect.hook.entityActive === false) {
          effect.visualActive = false;
        }
      },
      draw({ effect }, context) {
        drawFishHookLine(effect.hook, context);
      }
    });
    hook.lineEffect = line;
    return line;
  }

  // 甩钩实体。默认就是鱼钩本体的那一根：250 速度抛出、撞墙反弹、最长 800、
  // 然后沿原路收线，收线路上每 30 距离对被钩住的目标 -2。
  // options 让同一根钩子换个抛法（鱼塘就是「竖直缓降 + 碰底即收」），
  // 收线/上钩/拖拽/出伤这一段两边完全共用。
  function createHookEntity(services, source, direction, ownerState, onComplete, options = {}) {
    const kind = options.kind || "fish-hook";
    const lifecycle = options.lifecycle || "owner-bound";
    const outwardSpeed = Number.isFinite(options.speed) ? options.speed : HOOK_SPEED;
    // 收线速度：钩到东西往回拉（鱼钩本体是 250）。
    const reelSpeed = Number.isFinite(options.reelSpeed) ? options.reelSpeed : outwardSpeed;
    const maxOutwardLength = Number.isFinite(options.maxOutwardLength)
      ? options.maxOutwardLength
      : MAX_OUTWARD_LENGTH;
    // 碰到墙就地停下，不再反弹（鱼塘的下沉钩）。
    const stopAtWall = options.stopAtWall === true;
    // 停下之后是「原地待命」而不是收线：没钩到人就一直停在那儿，
    // 有谁撞上来才上钩收线（鱼塘的下边沿就是一片钩子）。
    const restAtWall = options.restAtWall === true;
    // 是否把甩钩的本体钉在原地：鱼钩本体甩钩时会定住，鱼塘本体照常乱弹。
    const pinsOwner = options.pinOwner !== false;
    // 一根钩子最多拖几个目标（鱼塘设 1；不设就是不限）。
    const maxReelTargets = Number.isFinite(options.maxReelTargets)
      ? options.maxReelTargets
      : Infinity;
    const path = [{ x: source.x, y: source.y }];
    const hook = services.spawnCombatEntity({
      kind,
      combatKind: "projectile",
      borrowedAttackClock: pinsOwner,
      lifecycle,
      life: ENTITY_LIFE,
      isProjectile: true,
      solid: false,
      targetable: false,
      radius: HOOK_RADIUS,
      x: source.x,
      y: source.y,
      ownerState,
      outwardSpeed,
      reelSpeed,
      stopAtWall,
      restAtWall,
      pinsOwner,
      maxReelTargets,
      // 收线开始：记下路线全长，沿原路往回拉。
      beginReel() {
        this.totalPathLength = polylineLength(this.path);
        this.phase = "reel";
        this.reelDistance = 0;
      },
      // 放线结束（放到头或碰到墙）：钩到人走 beginReel；
      // 鱼塘那种「停下待命」的钩子在这里转入 rest，不收线。
      endPayout() {
        this.totalPathLength = polylineLength(this.path);
        this.reelDistance = 0;
        if (this.restAtWall) {
          this.phase = "rest";
          return;
        }
        this.beginReel();
      },
      vx: direction.x * outwardSpeed,
      vy: direction.y * outwardSpeed,
      path,
      phase: "outward",
      outwardLength: 0,
      maxOutwardLength,
      reelDistance: 0,
      reelTarget: null,
      reelTargets: new Map(),
      totalPathLength: 0,
      update({ entity, game, services: hookServices }, dt) {
        // Keep the thrower's anchor fixed even when a knockback effect or a
        // collision tried to move it after the ball phase.
        if (entity.pinsOwner !== false) {
          pinOwner(entity);
          const ownerCapabilities = typeof services.getCapabilities === "function"
            ? services.getCapabilities(source)
            : null;
          if (ownerCapabilities && ownerCapabilities.canAct === false) return;
        }
        const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
        let remainingTime = elapsed;
        const arena = resolveArenaGeometry(game);
        if (entity.phase === "outward") {
          while (remainingTime > EPSILON && entity.phase === "outward") {
            const beforeX = entity.x;
            const beforeY = entity.y;
            const maxRemaining = entity.maxOutwardLength - entity.outwardLength;
            if (maxRemaining <= EPSILON) {
              appendPoint(entity.path, entity.x, entity.y);
              entity.endPayout();
              break;
            }
            const wall = arena.traceSegment(entity.x, entity.y,
              entity.x + entity.vx / entity.outwardSpeed * arena.size * 2,
              entity.y + entity.vy / entity.outwardSpeed * arena.size * 2);
            const wallDistance = wall ? wall.t * arena.size * 2 : Infinity;
            const stepDistance = Math.min(
              entity.outwardSpeed * remainingTime,
              maxRemaining,
              wallDistance
            );
            if (stepDistance <= EPSILON) {
              if (wallDistance <= EPSILON) {
                if (entity.stopAtWall) {
                  // 贴到墙就不再放线：把端点记进路线。
                  Object.assign(entity, arena.clampPoint(entity.x, entity.y));
                  appendPoint(entity.path, entity.x, entity.y);
                  // 停在墙边待命（rest）还是直接收线（reel），由钩子自己决定。
                  entity.endPayout();
                  break;
                }
                reflectHook(entity, wall, arena);
                entity.x += wall.normalX * EPSILON;
                entity.y += wall.normalY * EPSILON;
                continue;
              }
              break;
            }
            entity.x += entity.vx / entity.outwardSpeed * stepDistance;
            entity.y += entity.vy / entity.outwardSpeed * stepDistance;
            entity.outwardLength += stepDistance;
            remainingTime -= stepDistance / entity.outwardSpeed;

            const hit = firstAttackableEnemyHit(
              hookServices,
              beforeX,
              beforeY,
              entity.x,
              entity.y,
              HOOK_RADIUS
            );
            if (hit) {
              latchReelTarget(entity, hit, hookServices);
              // 一上钩就收线：和鱼钩本体一样，钩到鱼立刻停止放线往回拉。
              appendPoint(entity.path, entity.x, entity.y);
              entity.beginReel();
              break;
            }

            if (wall && wallDistance <= stepDistance + EPSILON) {
              Object.assign(entity, arena.clampPoint(entity.x, entity.y));
              appendPoint(entity.path, entity.x, entity.y);
              if (entity.stopAtWall) entity.endPayout();
              else reflectHook(entity, wall, arena);
            }
            if (entity.outwardLength + EPSILON >= entity.maxOutwardLength) {
              // Keep the terminal point in the route. Otherwise an
              // unobstructed 800-unit throw would have a zero-length reel.
              appendPoint(entity.path, entity.x, entity.y);
              entity.endPayout();
            }
          }
        }

        if (entity.phase === "rest") {
          // 停在墙边：谁撞上来就钩谁，钩到就立刻收线；
          // 没钩到就一直停在这里（这就是「没有勾不到就收线这一过程」）。
          const resting = firstAttackableEnemyHit(
            hookServices,
            entity.x,
            entity.y,
            entity.x,
            entity.y,
            HOOK_RADIUS
          );
          if (resting) {
            latchReelTarget(entity, resting, hookServices);
            entity.beginReel();
          }
        }
        if (entity.phase !== "reel") {
          // 还在放线：已经上钩的目标跟着钩子一起走。鱼钩本体一上钩就转收线，
          // 所以这一句对它永远是空操作。
          dragReelTargets(entity, game);
          return;
        }
        const reelElapsed = remainingTime;
        const previous = { x: entity.x, y: entity.y };
        const nextDistance = Math.min(
          entity.totalPathLength,
          entity.reelDistance + entity.reelSpeed * reelElapsed
        );
        const next = pointOnReversedPath(entity.path, nextDistance);
        entity.x = next.x;
        entity.y = next.y;
        entity.vx = next.directionX * entity.reelSpeed;
        entity.vy = next.directionY * entity.reelSpeed;

        const hit = firstAttackableEnemyHit(
          hookServices,
          previous.x,
          previous.y,
          entity.x,
          entity.y,
          HOOK_RADIUS
        );
        if (hit) {
          latchReelTarget(entity, hit, hookServices);
        }

        entity.reelDistance = nextDistance;
        damageReelTargets(entity, hookServices);
        dragReelTargets(entity, game);

        if (entity.reelDistance + EPSILON >= entity.totalPathLength) {
          entity.x = entity.path[0].x;
          entity.y = entity.path[0].y;
          releaseReelTargets(entity);
          entity.entityActive = false;
          entity.life = 0;
          if (typeof onComplete === "function") onComplete(entity);
        }
      },
      draw({ entity }, context) {
        drawFishHookTip(entity, context);
      }
    });
    spawnHookLineVisual(services, hook, lifecycle);
    return hook;
  }

  const fishHookDefinition = {
    id: "fishHook",
    name: "鱼钩",
    englishName: "Fish Hook",
    color: BODY_COLOR,
    description: "每3秒投出反弹鱼钩 / 最长800 / 收线每30距离-2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    // Rion must leave enough time for the longest legal throw and its return;
    // the ordinary behavior still waits exactly three seconds between throws.
    rionCycleDuration: FIRE_INTERVAL + (MAX_OUTWARD_LENGTH * 2) / HOOK_SPEED,
    createBehavior(services) {
      let phase = "cooldown";
      let cooldown = 0;
      let activeHook = null;
      let ownerBall = null;
      let completedAttack = false;

      function finishHook() {
        completedAttack = true;
        if (activeHook) {
          releaseReelTargets(activeHook);
          restoreOwnerState(activeHook);
          if (activeHook.lineEffect) activeHook.lineEffect.visualActive = false;
        }
        activeHook = null;
        phase = "cooldown";
        cooldown = 0;
      }

      function launch(context) {
        const angle = Math.random() * Math.PI * 2;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        const ownerState = {
          x: context.ball.x,
          y: context.ball.y,
          vx: context.ball.vx,
          vy: context.ball.vy,
          storedVx: context.ball.storedVx,
          storedVy: context.ball.storedVy,
          speedNeedsNormalization: context.ball.speedNeedsNormalization === true,
          positionLocked: context.ball.positionLocked === true,
          movementLocked: context.ball.movementLocked === true
        };
        phase = "casting";
        cooldown = 0;
        services.setMovementLocked(true);
        context.ball.positionLocked = true;
        activeHook = createHookEntity(
          services,
          context.ball,
          direction,
          ownerState,
          finishHook
        );
      }

      function advanceCooldown(context, dt) {
        if (phase !== "cooldown") return;
        cooldown = Math.min(FIRE_INTERVAL, cooldown + Math.max(0, dt));
        if (cooldown + EPSILON >= FIRE_INTERVAL) launch(context);
      }

      function releaseInterruptedHook() {
        if (phase === "casting" && activeHook && (
          activeHook.entityActive === false || activeHook.age >= activeHook.life
        )) finishHook();
      }

      return {
        onAttackBorrowStart(context) { launch(context); },
        isAttackCycleComplete() { return completedAttack; },
        drawBorrowedWeapon(context, canvasContext) {
          if (!activeHook) drawFishHookTip({ x: context.ball.x, y: context.ball.y, vx: 1, vy: 0 }, canvasContext);
        },
        onSpawn(context) {
          ownerBall = context.ball;
        },
        update(context, dt) {
          ownerBall = context.ball;
          releaseInterruptedHook();
          advanceCooldown(context, dt);
        },
        updateWhilePaused(context) {
          ownerBall = context.ball;
          releaseInterruptedHook();
        },
        getNextTransitionIn() {
          if (phase !== "cooldown") return undefined;
          return Math.max(EPSILON, FIRE_INTERVAL - cooldown);
        },
        onDeath() {
          if (activeHook) {
            releaseReelTargets(activeHook);
            restoreOwnerState(activeHook);
            if (activeHook.lineEffect) activeHook.lineEffect.visualActive = false;
            activeHook.entityActive = false;
            activeHook.life = 0;
          }
          activeHook = null;
          phase = "cooldown";
          cooldown = 0;
        },
        onBorrowEnd() {
          if (activeHook) {
            releaseReelTargets(activeHook);
            restoreOwnerState(activeHook);
            if (activeHook.lineEffect) activeHook.lineEffect.visualActive = false;
            activeHook.entityActive = false;
            activeHook.life = 0;
          }
          activeHook = null;
          phase = "cooldown";
          cooldown = 0;
          services.setMovementLocked(false);
        },
        getFishHookState() {
          return {
            phase,
            cooldown,
            hook: activeHook,
            owner: ownerBall
          };
        }
      };
    }
  };

  registerBall(fishHookDefinition);
  return {
    fishHookDefinition,
    FISH_HOOK_FIRE_INTERVAL: FIRE_INTERVAL,
    FISH_HOOK_MAX_LENGTH: MAX_OUTWARD_LENGTH,
    FISH_HOOK_REEL_DAMAGE_DISTANCE: REEL_DAMAGE_DISTANCE,
    FISH_HOOK_SPEED: HOOK_SPEED,
    // 鱼塘的下沉钩复用这一整套：命中查询、上钩、拖拽、每 30 距离 -2 的收线伤害，
    // 以及钩尖和钓线的绘制。区别只在「钩子怎么动」。
    FISH_HOOK_REEL_DAMAGE: REEL_DAMAGE,
    FISH_HOOK_RADIUS: HOOK_RADIUS,
    fishHookFirstEnemyHit: firstAttackableEnemyHit,
    fishHookLatchTarget: latchReelTarget,
    fishHookReleaseTargets: releaseReelTargets,
    fishHookDragTargets: dragReelTargets,
    fishHookDamageTargets: damageReelTargets,
    fishHookDrawTip: drawFishHookTip,
    fishHookDrawLine: drawFishHookLine,
    fishHookSpawnLineVisual: spawnHookLineVisual,
    // 整根甩钩实体（含抛出、撞墙/碰底判定、收线、上钩、拖拽、出伤、绘制）。
    createFishHookEntity: createHookEntity
  };
});
