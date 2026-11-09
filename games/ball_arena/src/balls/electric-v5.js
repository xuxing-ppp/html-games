(function initializeElectricV5(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricV5Plugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback }) {
  const ELECTROLYSIS_RANGE = 90;
  const ELECTROLYSIS_INTERVAL = 0.2;
  const ELECTROLYSIS_CHANCE = 0.01;
  const ELECTROLYSIS_HEAL = 1;
  const STORM_INTERVAL = 2.62;
  const STORM_POINT_COUNT = 15;
  const STORM_POINT_INTERVAL = 0.1;
  const STORM_START_DISTANCE = 100;
  const THUNDER_DESCENT_DURATION = 0.22;
  const THUNDER_LIFE = 0.4;
  const THUNDER_DAMAGE = 2;
  const THUNDER_CONTACT_RADIUS = 3;
  const EXPLOSION_RADIUS = 30;
  const EXPLOSION_DAMAGE = 3;
  const STATIC_POINT_CHANCE = 0.05;
  const STATIC_POINT_LENGTH = 8;
  const STATIC_POINT_DAMAGE = 1;
  const STATIC_KNOCKBACK_DURATION = 0.2;
  const STATIC_KNOCKBACK_SPEED = 4;
  const STATIC_STUN_DURATION = 0.9;
  const STATIC_STUN_SPEED = 0.1;
  const EPSILON = 1e-9;

  const SIDES = Object.freeze([
    { name: "top", inwardX: 0, inwardY: 1, tangentX: 1, tangentY: 0 },
    { name: "right", inwardX: -1, inwardY: 0, tangentX: 0, tangentY: 1 },
    { name: "bottom", inwardX: 0, inwardY: -1, tangentX: 1, tangentY: 0 },
    { name: "left", inwardX: 1, inwardY: 0, tangentX: 0, tangentY: 1 }
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
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

  function pointToSegmentDistanceSquared(pointX, pointY, start, end) {
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const lengthSquared = segmentX * segmentX + segmentY * segmentY;
    if (lengthSquared <= EPSILON) {
      const deltaX = pointX - start.x;
      const deltaY = pointY - start.y;
      return deltaX * deltaX + deltaY * deltaY;
    }
    const progress = clamp(
      ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) /
        lengthSquared,
      0,
      1
    );
    const closestX = start.x + segmentX * progress;
    const closestY = start.y + segmentY * progress;
    const deltaX = pointX - closestX;
    const deltaY = pointY - closestY;
    return deltaX * deltaX + deltaY * deltaY;
  }

  function pathHitsTarget(points, target, extraRadius = 0) {
    const hitDistance = target.radius + extraRadius;
    const hitDistanceSquared = hitDistance * hitDistance;
    for (let index = 1; index < points.length; index += 1) {
      if (pointToSegmentDistanceSquared(
        target.x,
        target.y,
        points[index - 1],
        points[index]
      ) <= hitDistanceSquared) return true;
    }
    return false;
  }

  function createJaggedPath(start, end, normalX, normalY, segmentCount = 8) {
    const points = [];
    let bend = 0;
    for (let index = 0; index <= segmentCount; index += 1) {
      const progress = index / segmentCount;
      const edgeFade = Math.sin(progress * Math.PI);
      bend = bend * 0.45 + (Math.random() - 0.5) * 10;
      const offset = index === 0 || index === segmentCount
        ? 0
        : clamp(bend, -9, 9) * edgeFade;
      points.push({
        x: start.x + (end.x - start.x) * progress + normalX * offset,
        y: start.y + (end.y - start.y) * progress + normalY * offset
      });
    }
    return points;
  }

  function partialPath(points, progress) {
    const clamped = clamp(progress, 0, 1);
    if (clamped >= 1) return points.slice();
    if (clamped <= 0) return [points[0]];
    const scaledIndex = clamped * (points.length - 1);
    const completed = Math.floor(scaledIndex);
    const fraction = scaledIndex - completed;
    const visible = points.slice(0, completed + 1);
    const start = points[completed];
    const end = points[completed + 1];
    visible.push({
      x: start.x + (end.x - start.x) * fraction,
      y: start.y + (end.y - start.y) * fraction
    });
    return visible;
  }

  function createElectrolysisBurst(x, y, color = "#d69aff") {
    return {
      kind: "electric-v5-electrolysis",
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
        context.lineWidth = Math.max(0.5, 2 - progress);
        context.beginPath();
        context.arc(effect.x, effect.y, 3 + progress * 7, 0, Math.PI * 2);
        context.stroke();
        context.beginPath();
        context.moveTo(effect.x - 5 * fade, effect.y);
        context.lineTo(effect.x + 5 * fade, effect.y);
        context.moveTo(effect.x, effect.y - 5 * fade);
        context.lineTo(effect.x, effect.y + 5 * fade);
        context.stroke();
        context.restore();
      }
    };
  }

  function createThunderExplosion(x, y) {
    return {
      kind: "electric-v5-thunder-explosion",
      life: 0.46,
      x,
      y,
      radius: EXPLOSION_RADIUS,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        const radius = effect.radius * (0.18 + progress * 0.82);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade;
        context.fillStyle = "rgba(164, 79, 255, 0.16)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#b86cff";
        context.lineWidth = 4 - progress * 2.5;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#f2dcff";
        context.lineWidth = 1.1;
        context.beginPath();
        context.arc(effect.x, effect.y, radius * 0.82, 0, Math.PI * 2);
        context.stroke();
        for (let index = 0; index < 8; index += 1) {
          const angle = index * Math.PI / 4;
          const inner = radius * 0.3;
          const outer = radius * (0.85 + (index % 2) * 0.1);
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

  function createThunderBolt(point, side, staticPoints) {
    const sideData = point.frame || SIDES[side];
    const start = {
      x: point.x + sideData.inwardX * STORM_START_DISTANCE,
      y: point.y + sideData.inwardY * STORM_START_DISTANCE
    };
    const path = createJaggedPath(
      start,
      point,
      -sideData.inwardY,
      sideData.inwardX,
      8
    );
    const effect = {
      kind: "electric-v5-thunder-bolt",
      life: THUNDER_LIFE,
      x: point.x,
      y: point.y,
      start,
      path,
      side,
      damage: THUNDER_DAMAGE,
      hitTargets: new Set(),
      impacted: false,
      impact(boltServices) {
        if (effect.impacted) return;
        effect.impacted = true;
        boltServices.playSound("ability", { cue: "explosion" });
        boltServices.spawnVisualEffect(createThunderExplosion(point.x, point.y));
        boltServices.forEachEnemy((target) => {
          if (Math.hypot(target.x - point.x, target.y - point.y) > (
            EXPLOSION_RADIUS + target.radius
          )) return;
          boltServices.dealDamage(target, EXPLOSION_DAMAGE);
        });
        if (Math.random() < STATIC_POINT_CHANCE) {
          staticPoints.push(boltServices.spawnCombatEntity(createStaticPoint(point, side)));
        }
      },
      update({ effect: activeEffect, services: boltServices }, dt) {
        const progress = clamp(
          (activeEffect.age + Math.max(0, dt)) / THUNDER_DESCENT_DURATION,
          0,
          1
        );
        const visiblePath = partialPath(activeEffect.path, progress);
        for (const target of boltServices.getEnemies()) {
          const key = targetKey(target);
          if (
            activeEffect.hitTargets.has(key) ||
            !pathHitsTarget(visiblePath, target, THUNDER_CONTACT_RADIUS)
          ) continue;
          if (boltServices.dealDamage(target, THUNDER_DAMAGE)) {
            activeEffect.hitTargets.add(key);
          }
        }
        if (!activeEffect.impacted && progress + EPSILON >= 1) {
          activeEffect.impact(boltServices);
        }
      },
      draw({ effect: activeEffect }, context) {
        const descentProgress = activeEffect.impacted
          ? 1
          : clamp(activeEffect.age / THUNDER_DESCENT_DURATION, 0, 1);
        const pathPoints = partialPath(activeEffect.path, descentProgress);
        const fade = activeEffect.impacted
          ? clamp(1 - Math.max(0, activeEffect.age - THUNDER_DESCENT_DURATION) / 0.18, 0, 1)
          : 1;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.shadowColor = "#b75cff";
        context.shadowBlur = 10;
        context.strokeStyle = "#8e35e8";
        context.lineWidth = 4;
        context.beginPath();
        pathPoints.forEach((pathPoint, index) => {
          if (index === 0) context.moveTo(pathPoint.x, pathPoint.y);
          else context.lineTo(pathPoint.x, pathPoint.y);
        });
        context.stroke();
        context.shadowBlur = 3;
        context.strokeStyle = "#f1dcff";
        context.lineWidth = 1.1;
        context.stroke();
        context.restore();
      }
    };
    return effect;
  }

  function createStaticBurst(point) {
    return {
      kind: "electric-v5-static-trigger",
      life: 0.3,
      x: point.x,
      y: point.y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#e7b9ff";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(effect.x, effect.y, 4 + progress * 8, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createStaticStun(directionX, directionY) {
    return {
      id: "electric-v5-static-stun",
      bounceCompatible: true,
      visualType: "stun",
      duration: STATIC_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      directionX,
      directionY,
      onApply({ ball, effect }) {
        effect.savedVx = ball.storedVx != null ? ball.storedVx : ball.vx;
        effect.savedVy = ball.storedVy != null ? ball.storedVy : ball.vy;
        effect.phase = 0;
        const direction = normalizeDirection(directionX, directionY);
        effect.directionX = direction.x;
        effect.directionY = direction.y;
        ball.vx = effect.directionX * ball.speed * ball.speedMultiplier * STATIC_STUN_SPEED;
        ball.vy = effect.directionY * ball.speed * ball.speedMultiplier * STATIC_STUN_SPEED;
      },
      update({ ball, effect, game }) {
        effect.phase += 1;
        const shake = Math.sin(game.time * 72) * 0.32;
        const direction = normalizeDirection(
          effect.directionX - effect.directionY * shake,
          effect.directionY + effect.directionX * shake
        );
        const speed = ball.speed * ball.speedMultiplier * STATIC_STUN_SPEED;
        ball.vx = direction.x * speed;
        ball.vy = direction.y * speed;
      },
      onWallBounce({ ball, effect }) {
        const direction = normalizeDirection(ball.vx, ball.vy, effect.directionX, effect.directionY);
        effect.directionX = direction.x;
        effect.directionY = direction.y;
      },
      onExpire({ ball, effect }) {
        ball.vx = ball.storedVx = effect.savedVx;
        ball.vy = ball.storedVy = effect.savedVy;
      },
      draw({ ball, effect, game }, context) {
        const flicker = Math.floor(game.time * 30) % 2 === 0 ? 1 : 0.55;
        context.save();
        context.globalAlpha *= flicker;
        context.strokeStyle = "#dfadff";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 4 + (effect.phase % 2), 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createStaticKnockback(directionX, directionY) {
    return createSharedKnockback({
      id: "electric-v5-static-knockback",
      duration: STATIC_KNOCKBACK_DURATION,
      directionX,
      directionY,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onExpire({ ball, effect, services }) {
        services.applyEffect(ball, createStaticStun(effect.directionX, effect.directionY));
      },
      speedMultiplier: STATIC_KNOCKBACK_SPEED
    });
  }
  function createStaticPoint(point, side) {
    return {
      kind: "electric-v5-static-point",
      life: Number.MAX_SAFE_INTEGER,
      trap: true,
      solid: false,
      drawLayer: "background",
      x: point.x,
      y: point.y,
      side,
      contacts: new Set(),
      frame: point.frame || SIDES[side],
      update({ effect, services: pointServices }) {
        const sideData = effect.frame;
        const half = STATIC_POINT_LENGTH / 2;
        const start = {
          x: effect.x - sideData.tangentX * half,
          y: effect.y - sideData.tangentY * half
        };
        const end = {
          x: effect.x + sideData.tangentX * half,
          y: effect.y + sideData.tangentY * half
        };
        const touching = new Set();
        for (const target of pointServices.getEnemies()) {
          const profile = pointServices.getContactProfile(target);
          if (!profile.solid || !profile.attackable) continue;
          if (!pathHitsTarget([start, end], target, 2)) continue;
          const key = targetKey(target);
          touching.add(key);
          if (effect.contacts.has(key)) continue;
          if (!pointServices.dealDamage(target, STATIC_POINT_DAMAGE)) continue;
          pointServices.spawnVisualEffect(createStaticBurst(effect));
          if (target.hp > 0) {
            pointServices.applyEffect(
              target,
              createStaticKnockback(sideData.inwardX, sideData.inwardY)
            );
          }
          effect.life = 0;
          break;
        }
        effect.contacts = touching;
      },
      draw({ effect }, context) {
        drawStaticPoints([effect], context);
      }
    };
  }

  function drawStaticPoints(points, context) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.74;
    context.strokeStyle = "#c47cff";
    context.shadowColor = "#9a3cff";
    context.shadowBlur = 5;
    context.lineWidth = 2;
    points.forEach((point) => {
      const side = point.frame || SIDES[point.side];
      const half = STATIC_POINT_LENGTH / 2;
      context.beginPath();
      context.moveTo(
        point.x - side.tangentX * half + side.inwardX * 1.5,
        point.y - side.tangentY * half + side.inwardY * 1.5
      );
      context.lineTo(
        point.x + side.tangentX * half + side.inwardX * 1.5,
        point.y + side.tangentY * half + side.inwardY * 1.5
      );
      context.stroke();
    });
    context.restore();
  }

  function drawRange(context, ball, time) {
    context.save();
    context.globalAlpha *= 0.16;
    context.strokeStyle = "#bd70ff";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(ball.x, ball.y, ELECTROLYSIS_RANGE, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha *= 0.8;
    for (let index = 0; index < 8; index += 1) {
      const angle = time * 0.8 + index * Math.PI / 4;
      const x = ball.x + Math.cos(angle) * ELECTROLYSIS_RANGE;
      const y = ball.y + Math.sin(angle) * ELECTROLYSIS_RANGE;
      context.fillStyle = "#d89aff";
      context.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }
    context.restore();
  }

  const electricV5Definition = {
    id: "electricV5",
    name: "\u7535\u7403V5",
    englishName: "Electric Ball V5",
    // 中间圆填充的紫色：移到默认纯色系统绘制后作为本体颜色
    color: "#8e4dd8",
    description: "90范围电解 / 2.62秒边缘雷暴 / 静电点",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: STORM_INTERVAL,
    createBehavior(services) {
      let elapsed = 0;
      let nextStormAt = STORM_INTERVAL;
      let storm = null;
      const staticPoints = [];
      const summonStates = new Map();
      const projectileStates = new Map();

      function heal(ball) {
        if (!ball || ball.hp <= 0) return;
        ball.hp += ELECTROLYSIS_HEAL;
        services.spawnHitText(ball, `+${ELECTROLYSIS_HEAL}`, { color: "#d7a1ff" });
      }

      function inRange(source, target) {
        return Math.hypot(target.x - source.x, target.y - source.y) <= (
          ELECTROLYSIS_RANGE + (target.radius || 0)
        );
      }

      function tryElectrolyzeSummon(source, target, state, dt) {
        if (!inRange(source, target)) {
          state.time = 0;
          return;
        }
        state.time += Math.max(0, dt);
        while (state.time + EPSILON >= ELECTROLYSIS_INTERVAL && target.hp > 0) {
          state.time = Math.max(0, state.time - ELECTROLYSIS_INTERVAL);
          if (Math.random() >= ELECTROLYSIS_CHANCE) continue;
          const previousHp = target.hp;
          const applied = services.dealDamage(
            target,
            previousHp / 2,
            source
          );
          if (!applied || target.hp >= previousHp) continue;
          services.spawnVisualEffect(createElectrolysisBurst(target.x, target.y));
          heal(source);
        }
      }

      function updateSummonElectrolysis(source, dt) {
        const living = new Set();
        for (const target of services.getEnemies()) {
          if (!target.isSummon || !Number.isFinite(target.hp)) continue;
          const key = targetKey(target);
          living.add(key);
          const state = summonStates.get(key) || { time: 0 };
          tryElectrolyzeSummon(source, target, state, dt);
          summonStates.set(key, state);
        }
        for (const key of summonStates.keys()) {
          if (!living.has(key)) summonStates.delete(key);
        }
      }

      function updateProjectileElectrolysis(source, dt) {
        for (const [projectile, state] of projectileStates.entries()) {
          if (
            !projectile || projectile.life <= 0 ||
            (Number.isFinite(projectile.age) && projectile.age >= projectile.life)
          ) {
            projectileStates.delete(projectile);
            continue;
          }
          if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.y) || !inRange(source, projectile)) {
            state.time = 0;
            continue;
          }
          state.time += Math.max(0, dt);
          while (state.time + EPSILON >= ELECTROLYSIS_INTERVAL) {
            state.time = Math.max(0, state.time - ELECTROLYSIS_INTERVAL);
            if (Math.random() >= ELECTROLYSIS_CHANCE) continue;
            projectile.life = 0;
            projectile.update = () => {};
            services.spawnVisualEffect(createElectrolysisBurst(projectile.x, projectile.y));
            heal(source);
            projectileStates.delete(projectile);
            break;
          }
        }
      }

      function beginStorm(context) {
        const side = Math.min(SIDES.length - 1, Math.floor(Math.random() * SIDES.length));
        const points = Array.from({ length: STORM_POINT_COUNT }, (_value, index) => {
          const progress = (index + 0.5) / STORM_POINT_COUNT;
          const point = resolveArenaGeometry(context.game).boundaryPoint(SIDES[side].name,
            side < 2 ? progress : 1 - progress);
          return { ...point, frame: { inwardX: point.normalX, inwardY: point.normalY,
            tangentX: point.normalY, tangentY: -point.normalX } };
        });
        storm = { side, points, shotIndex: 0, nextShotAt: elapsed };
        emitStormBolt(context);
      }

      function emitStormBolt(context) {
        if (!storm || storm.shotIndex >= storm.points.length) return;
        const point = storm.points[storm.shotIndex];
        storm.shotIndex += 1;
        services.spawnCombatEntity(createThunderBolt(point, storm.side, staticPoints));
        storm.nextShotAt = elapsed + STORM_POINT_INTERVAL;
      }

      return {
        update(context, dt) {
          elapsed += Math.max(0, dt);
          updateSummonElectrolysis(context.ball, dt);
          updateProjectileElectrolysis(context.ball, dt);
        },
        getNextTransitionIn() {
          let boundary = Math.max(EPSILON, nextStormAt - elapsed);
          if (storm && storm.shotIndex < storm.points.length) {
            boundary = Math.min(boundary, Math.max(EPSILON, storm.nextShotAt - elapsed));
          }
          return boundary;
        },
        afterUpdateStep(context) {
          while (elapsed + EPSILON >= nextStormAt) {
            nextStormAt += STORM_INTERVAL;
            beginStorm(context);
          }
          if (storm && storm.shotIndex < storm.points.length) {
            while (elapsed + EPSILON >= storm.nextShotAt) emitStormBolt(context);
          }
          if (storm && storm.shotIndex >= storm.points.length) storm = null;
        },
        onEnemyProjectileSpawned(context) {
          if (context.projectile) projectileStates.set(context.projectile, { time: 0 });
        },
        drawBefore(context, canvasContext) {
          drawRange(canvasContext, context.ball, context.game.time);
        },
        getStormState() {
          return storm
            ? { side: storm.side, shotIndex: storm.shotIndex, pointCount: storm.points.length }
            : null;
        },
        getStaticPoints() {
          return staticPoints.filter((point) => point.entityActive !== false && point.life > 0);
        }
      };
    }
  };

  registerBall(electricV5Definition);
  return { electricV5Definition };
});
