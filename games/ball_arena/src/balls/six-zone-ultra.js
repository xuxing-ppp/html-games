(function initializeSixZoneUltra(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
        ...require("./fear-wave.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSixZoneUltraPlugin(dependencies) {
  "use strict";

  const { resolveArenaGeometry, registerBall, createFearWave } = dependencies;

  const SECTOR_COLORS = Object.freeze([
    "#86d9ff", "#2467c9", "#8b9199",
    "#ffd84a", "#eafcff", "#23835a"
  ]);
  // 圆锯调色板：默认就是六区球Ultra 原本的字面量；借用方（锯球）可以换成自己的配色。
  const SAW_PALETTE = Object.freeze({
    face: "#c9e6ee",
    edge: "#5a7d8b",
    hub: "#71919b",
    ring: "#e7fbff"
  });
  const FROST_WIDTH = 30;
  const ARROW_FROST_WIDTH = 10;
  const FROST_LIFE = 3;
  const FROST_ACTIVE_DURATION = 2.4;
  const FROST_FADE_DURATION = FROST_LIFE - FROST_ACTIVE_DURATION;
  const FROST_CONTACT_GRACE = 0.08;
  const FROST_TRAIL_EMIT_INTERVAL = 1 / 30;
  const FROST_FREEZE_DURATION = 0.6;
  const FROST_START_INTERVAL = 1;
  const FROST_MIN_INTERVAL = 0.1;
  const FROST_DAMAGE = 2;
  const SAW_RADIUS = 15;
  const SAW_ORBIT_RADIUS = 40;
  const SAW_ORBIT_RPS = 0.5;
  const SAW_DAMAGE = 5;
  const ARROW_INTERVAL = 1;
  const ARROW_SPEED = 450;
  const ARROW_DAMAGE = 1;
  // 电环判定从源点向外量，所以目标半径也要算进阈值：
  // 圆心距阈值 = 场半径 + 目标半径（增长的雪球贴上来时才电得到）。
  const ARROW_FIELD_RADIUS = 30;
  const ARROW_LIFE = 5;
  const BODY_FIELD_RADIUS = 45;
  const ELECTRIC_STUN_DURATION = 2;
  const ELECTRIC_TICK_INTERVAL = 0.4;
  const ELECTRIC_DAMAGE = 3;
  const ELECTRIC_RECOVERY = 5;
  const WAVE_CYCLE = 1;
  const WAVE_BURST_START = 0.5;
  const WAVE_BURST_INTERVAL = 0.1;
  const WAVE_BURST_COUNT = 5;
  const EFFECT_LIFE = 1e9;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = Number.isFinite(x) ? x : fallbackX;
    let directionY = Number.isFinite(y) ? y : fallbackY;
    let magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
      magnitude = Math.hypot(directionX, directionY) || 1;
    }
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function hashPixel(x, y, seed) {
    let value = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 1000) / 1000;
  }

  function pointSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const dx = endX - startX;
    const dy = endY - startY;
    const lengthSquared = dx * dx + dy * dy;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((pointX - startX) * dx + (pointY - startY) * dy) / lengthSquared, 0, 1);
    const closestX = startX + dx * progress;
    const closestY = startY + dy * progress;
    const offsetX = pointX - closestX;
    const offsetY = pointY - closestY;
    return offsetX * offsetX + offsetY * offsetY;
  }

  function segmentDistanceSquared(first, second) {
    const firstDistance = Math.min(
      pointSegmentDistanceSquared(first.startX, first.startY,
        second.startX, second.startY, second.endX, second.endY),
      pointSegmentDistanceSquared(first.endX, first.endY,
        second.startX, second.startY, second.endX, second.endY)
    );
    const secondDistance = Math.min(
      pointSegmentDistanceSquared(second.startX, second.startY,
        first.startX, first.startY, first.endX, first.endY),
      pointSegmentDistanceSquared(second.endX, second.endY,
        first.startX, first.startY, first.endX, first.endY)
    );
    return Math.min(firstDistance, secondDistance);
  }

  function circleTouchesSegment(ball, trail) {
    return pointSegmentDistanceSquared(
      ball.x,
      ball.y,
      trail.startX,
      trail.startY,
      trail.endX,
      trail.endY
    ) <= Math.pow(ball.radius + trail.width / 2, 2) + EPSILON;
  }

  function drawSixSectorBody(context, ball) {
    const start = -Math.PI / 2;
    for (let index = 0; index < SECTOR_COLORS.length; index += 1) {
      const from = start + index * Math.PI / 3;
      const to = from + Math.PI / 3;
      context.beginPath();
      context.moveTo(ball.x, ball.y);
      context.arc(ball.x, ball.y, ball.radius, from, to);
      context.closePath();
      context.fillStyle = SECTOR_COLORS[index];
      context.fill();
      if (typeof context.stroke === "function") {
        context.strokeStyle = "rgba(255, 255, 255, 0.48)";
        context.lineWidth = 0.55;
        context.stroke();
      }
    }
  }

  function createSeededRandom(startX, startY, endX, endY) {
    let state = (
      (Math.round(startX * 100) * 73856093) ^
      (Math.round(startY * 100) * 19349663) ^
      (Math.round(endX * 100) * 83492791) ^
      (Math.round(endY * 100) * 2654435761)
    ) >>> 0;
    if (state === 0) state = 0x9e3779b9;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0x100000000;
    };
  }

  function createCrystalCluster(startX, startY, endX, endY, width) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    const tangentX = length > EPSILON ? deltaX / length : 1;
    const tangentY = length > EPSILON ? deltaY / length : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const random = createSeededRandom(startX, startY, endX, endY);
    // Keep the crystal silhouette while halving path construction and fill
    // work for resident body/saw/arrow trails.
    const count = Math.max(3, Math.ceil(length / 6));
    const colors = ["#a8dcf4", "#dff8ff", "#72b8da", "#c6efff"];
    const crystals = [];
    const toWorld = (along, lateral) => ({
      x: startX + tangentX * along + normalX * lateral,
      y: startY + tangentY * along + normalY * lateral
    });

    for (let index = 0; index < count; index += 1) {
      const along = length * ((index + 0.2 + random() * 0.6) / count);
      const angle = (random() - 0.5) * 1.8;
      const axisAlong = Math.cos(angle);
      const axisLateral = Math.sin(angle);
      const halfLength = 2.5 + random() * 3.5;
      const halfWidth = 1.2 + random() * 2.2;
      const lateralExtent = Math.abs(axisLateral * halfLength) +
        Math.abs(axisAlong * halfWidth);
      const lateralLimit = Math.max(0, width / 2 - lateralExtent);
      const lateral = (random() * 2 - 1) * lateralLimit;
      const points = [
        toWorld(along - axisAlong * halfLength, lateral - axisLateral * halfLength),
        toWorld(along - axisLateral * halfWidth, lateral + axisAlong * halfWidth),
        toWorld(along + axisAlong * halfLength, lateral + axisLateral * halfLength),
        toWorld(along + axisLateral * halfWidth, lateral - axisAlong * halfWidth)
      ];
      crystals.push({
        points,
        color: colors[Math.floor(random() * colors.length)],
        opacity: 0.22 + random() * 0.2,
        meltDelay: random() * 0.32,
        driftX: (random() - 0.5) * 2,
        driftY: 1.5 + random() * 2.5
      });
    }
    return crystals;
  }

  // 冻结进度只产出 speedFactor：0 表示完全钉住。速度合成、解冻还原与免疫
  // 全部由引擎负责，这里不再直接改倍率或速度向量。
  function applyFreezeProgress(effect, progress) {
    const value = clamp(progress, 0, 1);
    effect.speedFactor = 1 - value;
    effect.freezeProgress = value;
    const frozen = effect.speedFactor <= EPSILON;
    effect.preventsAttack = frozen;
    effect.blocksDamageOutput = frozen;
    effect.pausesBehavior = frozen;
  }

  function createFrostEffect() {
    return {
      id: "six-zone-ultra-frost",
      attackTags: ["cold", "freeze"],
      duration: FROST_CONTACT_GRACE,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          // 重新接触只延续冻结进度与伤害节奏，不重置计时。
          effect.startedAt = game.time;
          effect.damageInterval = FROST_START_INTERVAL;
          // 梓的冻结阶段先完成，再等待一秒才开始第一跳伤害。
          effect.nextDamageAt = game.time + FROST_FREEZE_DURATION +
            FROST_START_INTERVAL;
        }
        applyFreezeProgress(effect, (game.time - effect.startedAt) / FROST_FREEZE_DURATION);
      },
      update({ ball, effect, game, services }) {
        while (game.time + EPSILON >= effect.nextDamageAt) {
          if (services.dealDamage(ball, FROST_DAMAGE)) {
            effect.damageInterval = Math.max(
              FROST_MIN_INTERVAL,
              effect.damageInterval * 0.75
            );
            effect.nextDamageAt += effect.damageInterval;
          } else {
            effect.nextDamageAt = game.time + effect.damageInterval;
            break;
          }
        }
        applyFreezeProgress(effect, (game.time - effect.startedAt) / FROST_FREEZE_DURATION);
      },
      draw({ ball, effect, game }, context) {
        const progress = effect.freezeProgress || clamp(
          (game.time - effect.startedAt) / FROST_FREEZE_DURATION,
          0,
          1
        );
        context.save();
        context.globalAlpha *= 0.35 + progress * 0.55;
        context.strokeStyle = "#eafaff";
        context.lineWidth = 1.4;
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI / 3 + Math.PI / 6;
          const inner = ball.radius + 2;
          const outer = inner + 3 + progress * 3;
          context.beginPath();
          context.moveTo(
            ball.x + Math.cos(angle) * inner,
            ball.y + Math.sin(angle) * inner
          );
          context.lineTo(
            ball.x + Math.cos(angle) * outer,
            ball.y + Math.sin(angle) * outer
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createFrostTrail(startX, startY, endX, endY, width = FROST_WIDTH) {
    return {
      kind: "six-zone-ultra-frost-trail",
      combatKind: "zone",
      life: FROST_LIFE,
      drawLayer: "background",
      startX,
      startY,
      endX,
      endY,
      width,
      crystals: createCrystalCluster(startX, startY, endX, endY, width),
      activeDuration: FROST_ACTIVE_DURATION,
      fadeDuration: FROST_FADE_DURATION,
      update({ effect, services }) {
        if (effect.age > effect.activeDuration + EPSILON) return;
        services.forEachEnemy((target) => {
          const profile = services.getContactProfile(target);
          if (!profile.solid || !profile.attackable || !circleTouchesSegment(target, effect)) {
            return;
          }
          services.applyEffect(target, createFrostEffect());
        });
      },
      draw({ effect }, context) {
        const meltProgress = effect.age <= effect.activeDuration
          ? 0
          : clamp((effect.age - effect.activeDuration) / effect.fadeDuration, 0, 1);
        const opacity = 1 - meltProgress;
        if (opacity <= 0) return;
        context.save();
        const inheritedAlpha = context.globalAlpha;
        for (const crystal of effect.crystals) {
          const localMelt = clamp(
            (meltProgress - crystal.meltDelay) / (1 - crystal.meltDelay),
            0,
            1
          );
          const scale = 1 - localMelt * 0.62;
          const centerX = crystal.points.reduce((sum, point) => sum + point.x, 0) /
            crystal.points.length;
          const centerY = crystal.points.reduce((sum, point) => sum + point.y, 0) /
            crystal.points.length;
          const offsetX = crystal.driftX * localMelt;
          const offsetY = crystal.driftY * localMelt;
          context.globalAlpha = inheritedAlpha * opacity * crystal.opacity *
            (1 - localMelt * 0.45);
          context.fillStyle = crystal.color;
          context.strokeStyle = "#eaffff";
          context.lineWidth = 0.45;
          context.beginPath();
          crystal.points.forEach((point, pointIndex) => {
            const x = centerX + (point.x - centerX) * scale + offsetX;
            const y = centerY + (point.y - centerY) * scale + offsetY;
            if (pointIndex === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.closePath();
          context.fill();
          context.stroke();
        }
        context.restore();
      }
    };
  }

  function createSonicWave(x, y) {
    const wave = createFearWave(
      { x, y },
      { kind: "six-zone-ultra-sonic-wave" }
    );
    wave.combatKind = "zone";
    return wave;
  }

  function createElectricStun() {
    return {
      id: "stun",
      visualType: "stun",
      duration: ELECTRIC_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      pausesBehavior: true,
      damage: ELECTRIC_DAMAGE,
      tickInterval: ELECTRIC_TICK_INTERVAL,
      // 眩晕必须能压住"领域动画"这类会强行改写自身能力的阶段
      // （六王球的棋盘/王点领域会强制 canAct/canBodyAttack = true），
      // 否则电弧眩晕对正在开领域的目标完全无效。
      forceCapabilities: Object.freeze({
        canAct: false,
        canBodyAttack: false
      }),
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          // 与电球同款取速：优先 stored，其次撞击前速度，最后当前速度。
          effect.savedVx = ball.storedVx != null
            ? ball.storedVx
            : (ball.preHitVx != null ? ball.preHitVx : ball.vx);
          effect.savedVy = ball.storedVy != null
            ? ball.storedVy
            : (ball.preHitVy != null ? ball.preHitVy : ball.vy);
          // 眩晕前本身速度为 0 且处于移动锁时给一个默认速度，
          // 否则眩晕结束后目标会永久停在原地。
          if (Math.hypot(effect.savedVx, effect.savedVy) <= EPSILON && ball.movementLocked) {
            effect.savedVx = ball.speed * (ball.speedMultiplier || 1);
            effect.savedVy = 0;
          }
        }
        effect.nextDamageAt = game.time + effect.tickInterval;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game, services }) {
        while (
          effect.nextDamageAt > 0 &&
          game.time + EPSILON >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + EPSILON
        ) {
          services.dealDamage(ball, effect.damage);
          effect.nextDamageAt += effect.tickInterval;
        }
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
      },
      // 电球同款像素抖动：被眩晕的目标本体随 4 帧循环轻微偏移。
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 48) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    };
  }

  // 复用原版“电球”的像素方块电弧语言：从场内边缘的随机点开始，
  // 以短折线向外跳动，而不是用连续的径向线段代替电弧。
  function createElectricArcVisual(x, y, radius, seed, alpha = 1) {
    const blocks = [];
    const angle = hashPixel(seed, 12, 0) * Math.PI * 2;
    const startRadius = Math.max(17, Math.min(radius - 2, 18 + hashPixel(seed, 13, 0) * 12));
    let px = x + Math.cos(angle) * startRadius;
    let py = y + Math.sin(angle) * startRadius;
    let heading = angle + (hashPixel(seed, 2, 0) - 0.5) * 0.8;
    const count = 4 + Math.floor(hashPixel(seed, 4, 0) * 4);
    for (let index = 0; index < count; index += 1) {
      if (index > 0 && index % 2 === 0) {
        const radialAngle = Math.atan2(py - y, px - x);
        heading = radialAngle + (hashPixel(seed + index, 5, 0) - 0.5) * 1.05;
      }
      px += Math.cos(heading) * 2.35;
      py += Math.sin(heading) * 2.35;
      const distance = Math.hypot(px - x, py - y);
      if (distance > radius - 2) {
        px = x + (px - x) / Math.max(distance, EPSILON) * (radius - 2);
        py = y + (py - y) / Math.max(distance, EPSILON) * (radius - 2);
      } else if (distance < 17) {
        px = x + (px - x) / Math.max(distance, EPSILON) * 17;
        py = y + (py - y) / Math.max(distance, EPSILON) * 17;
      }
      if (index % 5 !== 3) blocks.push({ x: Math.round(px), y: Math.round(py) });
    }
    return {
      kind: "six-zone-ultra-electric-arc",
      life: 0.28 + hashPixel(seed, 8, 0) * 0.14,
      drawLayer: "background",
      x,
      y,
      radius,
      alpha,
      blocks,
      draw({ effect }, context) {
        const fade = 1 - effect.age / effect.life;
        context.save();
        context.globalAlpha *= effect.alpha == null ? fade : effect.alpha * fade;
        context.fillStyle = "#9f861c";
        effect.blocks.forEach((block) => context.fillRect(block.x - 1, block.y - 1, 3, 3));
        context.fillStyle = "#ffe66a";
        effect.blocks.forEach((block, index) => {
          if (index % 3 !== 1) context.fillRect(block.x, block.y, 1, 1);
        });
        context.restore();
      }
    };
  }

  // 电击门闸：每个目标独立冷却（默认与本体电场的恢复时间一致），
  // 否则箭矢的电场每秒都能重新晕一次，目标会被永久锁住。
  function createStunGate(recovery = ELECTRIC_RECOVERY) {
    const nextStunAt = new Map();
    return {
      canStun(target, now) {
        if (!target) return false;
        const next = nextStunAt.get(target.instanceId);
        return !(Number.isFinite(next) && next > now);
      },
      markStunned(target, now) {
        if (!target) return;
        nextStunAt.set(target.instanceId, now + recovery);
      },
      prune(now) {
        for (const [key, value] of nextStunAt) {
          if (!(value > now)) nextStunAt.delete(key);
        }
      }
    };
  }

  function triggerElectric(services, target, gate = null, now = 0) {
    if (!target) return false;
    if (gate && !gate.canStun(target, now)) return false;
    const applied = services.applyEffect(target, createElectricStun());
    if (!applied) return false;
    if (gate) gate.markStunned(target, now);
    services.spawnHitText(target, "X");
    return true;
  }

  function createGlassShard(x, y) {
    const rotation = Math.random() * Math.PI * 2;
    const radii = [2, 1.35 + Math.random() * 0.35, 1.65 + Math.random() * 0.3];
    const points = [rotation, rotation + 2.05, rotation + 4.28].map((angle, index) => ({
      x: x + Math.cos(angle) * radii[index],
      y: y + Math.sin(angle) * radii[index]
    }));
    return {
      kind: "six-zone-ultra-glass-shard",
      combatKind: "trap",
      life: EFFECT_LIFE,
      x,
      y,
      radius: 2,
      points,
      update({ effect, services }) {
        services.forEachContactEnemy((target) => {
          const profile = services.getContactProfile(target);
          const overlapping = Math.hypot(target.x - effect.x, target.y - effect.y) <= target.radius + effect.radius;
          services.notifyEntityContact(target, effect, { overlapping });
          if (!profile.attackable || !overlapping) return;
          if (services.tryConsumeEntity(target, effect, { physical: true })) {
            effect.life = 0;
            return;
          }
          if (services.dealDamage(target, 1)) effect.life = 0;
        });
      },
      draw({ effect }, context) {
        context.save();
        context.globalAlpha *= 0.45;
        context.fillStyle = "#eafcff";
        context.strokeStyle = "#ffffff";
        context.lineWidth = 0.65;
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.fill();
        context.stroke();
        context.restore();
      }
    };
  }

  function spawnGlassBurst(services, x, y, arenaSize) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * 20;
      const { x: shardX, y: shardY } = resolveArenaGeometry(arenaSize).clampPoint(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 2);
      services.spawnCombatEntity(createGlassShard(shardX, shardY));
    }
  }

  function drawSaw(context, saw) {
    context.save();
    context.translate(saw.x, saw.y);
    context.rotate(saw.rotation || 0);
    const palette = saw.palette || SAW_PALETTE;
    const teeth = Number.isFinite(saw.teeth) ? saw.teeth : 8;
    const toothHeight = Number.isFinite(saw.toothHeight) ? saw.toothHeight : 3.2;
    const hubRadius = Number.isFinite(saw.hubRadius) ? saw.hubRadius : 4.5;
    context.fillStyle = palette.face;
    context.strokeStyle = palette.edge;
    context.lineWidth = 0.8;
    const rootRadius = Math.max(1, saw.radius - toothHeight);
    if (saw.toothStyle === "triangle") {
      // 圆锯盘 + 一圈独立三角齿（更接近参考图里的细齿锯片）
      context.beginPath();
      context.arc(0, 0, rootRadius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      const halfStep = Math.PI / teeth;
      for (let index = 0; index < teeth; index += 1) {
        const center = index * Math.PI * 2 / teeth;
        const left = center - halfStep * 0.95;
        const tip = center - halfStep * 0.12;
        const right = center + halfStep * 0.62;
        context.beginPath();
        context.moveTo(Math.cos(left) * rootRadius, Math.sin(left) * rootRadius);
        context.lineTo(Math.cos(tip) * saw.radius, Math.sin(tip) * saw.radius);
        context.lineTo(Math.cos(right) * (rootRadius + toothHeight * 0.15), Math.sin(right) * (rootRadius + toothHeight * 0.15));
        context.closePath();
        context.fill();
        context.stroke();
      }
    } else {
      context.beginPath();
      for (let index = 0; index < teeth * 2; index += 1) {
        const angle = index * Math.PI / teeth;
        const radius = index % 2 === 0 ? saw.radius : saw.radius - toothHeight;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.fillStyle = palette.hub;
    context.beginPath();
    context.arc(0, 0, hubRadius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = palette.ring;
    if (saw.highlight === "arc") {
      context.lineWidth = Math.max(1, saw.radius * 0.12);
      context.beginPath();
      context.arc(0, 0, saw.radius * 0.6, -2.6, -0.9);
      context.stroke();
    } else {
      context.lineWidth = 1;
      context.beginPath();
      context.arc(0, 0, 2, 0, Math.PI * 2);
      context.stroke();
    }
    context.restore();
  }

  function targetIsMovementLocked(target) {
    if (target.positionLocked || target.movementLocked) return true;
    if (!(target.effects instanceof Map)) return false;
    return Array.from(target.effects.values()).some((effect) => effect.locksMovement);
  }

  function resolveSawContact(saw, target, arenaSize) {
    let dx = target.x - saw.x;
    let dy = target.y - saw.y;
    let distance = Math.hypot(dx, dy);
    const minimumDistance = saw.radius + target.radius;
    if (distance >= minimumDistance) return false;
    if (distance <= EPSILON) {
      dx = 1;
      dy = 0;
      distance = 1;
    }
    const normalX = dx / distance;
    const normalY = dy / distance;
    const overlap = minimumDistance - distance;
    if (!targetIsMovementLocked(target)) {
      Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(target.x + normalX * overlap, target.y + normalY * overlap, target.radius));
      const velocityDot = target.vx * normalX + target.vy * normalY;
      if (velocityDot < 0) {
        target.vx -= 2 * velocityDot * normalX;
        target.vy -= 2 * velocityDot * normalY;
      }
      const storedDot = target.storedVx * normalX + target.storedVy * normalY;
      if (storedDot < 0) {
        target.storedVx -= 2 * storedDot * normalX;
        target.storedVy -= 2 * storedDot * normalY;
      }
    }
    return true;
  }

  function sawTouchesTarget(saw, target) {
    const touching = Math.hypot(target.x - saw.x, target.y - saw.y) <=
      target.radius + saw.radius + EPSILON;
    if (touching) return true;
    if (!saw.segment || !Number.isFinite(target.prevX) || !Number.isFinite(target.prevY)) {
      return false;
    }
    const targetPath = {
      startX: target.prevX,
      startY: target.prevY,
      endX: target.x,
      endY: target.y
    };
    return segmentDistanceSquared(saw.segment, targetPath) <=
      Math.pow(target.radius + saw.radius, 2) + EPSILON;
  }

  function updateSawContacts(saw, services, arenaSize) {
    const current = new Set();
    services.forEachEnemy((target) => {
      const profile = services.getContactProfile(target);
      if (!profile.solid || !sawTouchesTarget(saw, target)) return;
      const key = target.instanceId;
      current.add(key);
      resolveSawContact(saw, target, arenaSize);
      if (saw.contacts.has(key)) return;
      if (profile.attackable) {
        services.dealDamage(target, saw.damage, { collisionDamage: true });
      }
      if (saw.spawnGlassShards !== false) spawnGlassBurst(services, saw.x, saw.y, arenaSize);
    });
    saw.contacts = current;
  }

  // 公转圆锯（六区球Ultra 的现成实现）。默认参数与六区球Ultra 完全一致；
  // 借用方可以通过 options 覆盖公转速度 / 半径 / 尺寸 / 伤害 / 拖尾 / kind。
  function createSaw(side, source, options = {}) {
    const radius = Number.isFinite(options.radius) ? options.radius : SAW_RADIUS;
    const orbitRadius = Number.isFinite(options.orbitRadius) ? options.orbitRadius : SAW_ORBIT_RADIUS;
    const orbitRps = Number.isFinite(options.orbitRps) ? options.orbitRps : SAW_ORBIT_RPS;
    const damage = Number.isFinite(options.damage) ? options.damage : SAW_DAMAGE;
    const emitTrail = options.emitTrail !== false;
    return {
      kind: options.kind || "six-zone-ultra-saw",
      combatKind: "summon",
      lifecycle: "owner-bound",
      borrowedAttackClock: true,
      roundShieldResponse: "reflect",
      life: EFFECT_LIFE,
      solid: true,
      indestructible: true,
      radius,
      orbitRadius,
      orbitRps,
      damage,
      emitTrail,
      palette: options.palette || SAW_PALETTE,
      teeth: Number.isFinite(options.teeth) ? options.teeth : 8,
      toothHeight: Number.isFinite(options.toothHeight) ? options.toothHeight : 3.2,
      hubRadius: Number.isFinite(options.hubRadius) ? options.hubRadius : 4.5,
      highlight: options.highlight || "ring",
      toothStyle: options.toothStyle || "star",
      // 六区球Ultra 的冰玻璃碎屑是它的冰霜主题；借用方可以关掉
      spawnGlassShards: options.spawnGlassShards !== false,
      side,
      orbitAngle: side < 0 ? 0 : Math.PI,
      x: source.x - side * orbitRadius,
      y: source.y,
      prevX: source.x - side * orbitRadius,
      prevY: source.y,
      vx: 0,
      vy: 0,
      rotation: 0,
      trailTimer: FROST_TRAIL_EMIT_INTERVAL,
      contacts: new Set(),
      update({ effect, game, services: entityServices }, dt) {
        const owner = effect.owner;
        if (!owner) {
          effect.entityActive = false;
          return;
        }
        const elapsed = Math.max(0, dt);
        effect.prevX = effect.x;
        effect.prevY = effect.y;
        effect.orbitAngle += Math.PI * 2 * effect.orbitRps * elapsed;
        const wantedX = owner.x + Math.cos(effect.orbitAngle) * effect.orbitRadius;
        const wantedY = owner.y + Math.sin(effect.orbitAngle) * effect.orbitRadius;
        // The orbit radius is a weapon contract, so keep the saw exactly forty
        // logical units from its owner even when the outer half is clipped by
        // an arena edge.
        effect.x = wantedX;
        effect.y = wantedY;
        effect.vx = elapsed > EPSILON ? (effect.x - effect.prevX) / elapsed : 0;
        effect.vy = elapsed > EPSILON ? (effect.y - effect.prevY) / elapsed : 0;
        effect.rotation += effect.vx * elapsed / Math.max(1, effect.radius);
        effect.segment = {
          startX: effect.prevX,
          startY: effect.prevY,
          endX: effect.x,
          endY: effect.y
        };
        effect.trailTimer += elapsed;
        if (effect.emitTrail !== false &&
            effect.trailTimer + EPSILON >= FROST_TRAIL_EMIT_INTERVAL &&
            Math.hypot(effect.x - effect.prevX, effect.y - effect.prevY) > 0.5) {
          effect.trailTimer %= FROST_TRAIL_EMIT_INTERVAL;
          entityServices.spawnCombatEntity(createFrostTrail(
            effect.prevX,
            effect.prevY,
            effect.x,
            effect.y
          ));
        }
        updateSawContacts(effect, entityServices, game);
        if (
          !resolveArenaGeometry(game).contains(effect.x, effect.y, effect.radius + EPSILON)
        ) {
          if (!effect.wallContact) {
            if (effect.spawnGlassShards !== false) {
              spawnGlassBurst(entityServices, effect.x, effect.y, game);
            }
            effect.wallContact = true;
          }
        } else {
          effect.wallContact = false;
        }
      },
      draw({ effect, services: entityServices }, context) {
        if (!entityServices || !entityServices.borrowedAttackOnly) drawSaw(context, effect);
      }
    };
  }

  function createArrow(services, source, target, stunGate = null) {
    const direction = normalizeDirection(target.x - source.x, target.y - source.y);
    return {
      kind: "six-zone-ultra-arrow",
      combatKind: "projectile",
      life: ARROW_LIFE,
      radius: 2,
      damage: ARROW_DAMAGE,
      replayDamage: ARROW_DAMAGE,
      color: "#eafcff",
      x: source.x + direction.x * (source.radius + 5),
      y: source.y + direction.y * (source.radius + 5),
      vx: direction.x * ARROW_SPEED,
      vy: direction.y * ARROW_SPEED,
      sonicTimer: 0,
      electricTimer: 0,
      trailTimer: FROST_TRAIL_EMIT_INTERVAL,
      electricTargets: new Set(),
      visualSeed: 0,
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;
        effect.trailTimer += elapsed;
        if (effect.trailTimer + EPSILON >= FROST_TRAIL_EMIT_INTERVAL &&
            Math.hypot(effect.x - startX, effect.y - startY) > 0.5) {
          effect.trailTimer %= FROST_TRAIL_EMIT_INTERVAL;
          entityServices.spawnCombatEntity(createFrostTrail(
            startX,
            startY,
            effect.x,
            effect.y,
            ARROW_FROST_WIDTH
          ));
        }
        const hit = entityServices.getFirstEnemyHit(startX, startY, effect.x, effect.y, effect.radius);
        if (hit && entityServices.dealDamage(hit, effect.damage)) {
          effect.life = 0;
          return;
        }
        effect.sonicTimer += elapsed;
        while (effect.sonicTimer + EPSILON >= 0.2) {
          effect.sonicTimer -= 0.2;
          entityServices.spawnCombatEntity(createSonicWave(effect.x, effect.y));
        }
        effect.electricTimer += elapsed;
        if (effect.electricTimer >= 0.03) {
          effect.electricTimer %= 0.03;
          effect.visualSeed += 1;
          entityServices.spawnVisualEffect(createElectricArcVisual(
            effect.x,
            effect.y,
            ARROW_FIELD_RADIUS,
            effect.visualSeed,
            1
          ));
        }
        entityServices.forEachEnemy((targetCandidate) => {
          const distance = Math.hypot(
            targetCandidate.x - effect.x,
            targetCandidate.y - effect.y
          );
          const inRange = distance <=
            ARROW_FIELD_RADIUS +
              (Number.isFinite(targetCandidate.radius) ? targetCandidate.radius : 0);
          const key = targetCandidate.instanceId;
          if (!inRange) {
            effect.electricTargets.delete(key);
            return;
          }
          if (effect.electricTargets.has(key)) return;
          if (triggerElectric(entityServices, targetCandidate, stunGate, game.time)) {
            effect.electricTargets.add(key);
          }
        });
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, 8)
        ) effect.life = 0;
      },
      draw({ effect }, context) {
        const angle = Math.atan2(effect.vy, effect.vx);
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(angle);
        context.strokeStyle = "#dff8ff";
        context.lineWidth = 1.2;
        context.beginPath();
        context.moveTo(-8, 0);
        context.lineTo(7, 0);
        context.stroke();
        context.fillStyle = "#ffffff";
        context.beginPath();
        context.moveTo(9, 0);
        context.lineTo(3, -2.8);
        context.lineTo(3, 2.8);
        context.closePath();
        context.fill();
        context.restore();
      }
    };
  }

  function drawArrowCharge(context, ball, target, progress) {
    if (!target || progress <= 0) return;
    const direction = normalizeDirection(target.x - ball.x, target.y - ball.y);
    const normalX = -direction.y;
    const normalY = direction.x;
    const centerX = ball.x + direction.x * (ball.radius + 7);
    const centerY = ball.y + direction.y * (ball.radius + 7);
    context.save();
    context.globalAlpha *= 0.35 + progress * 0.65;
    context.strokeStyle = "#d8dde2";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(centerX + normalX * 6, centerY + normalY * 6);
    context.lineTo(centerX + direction.x * 4, centerY + direction.y * 4);
    context.lineTo(centerX - normalX * 6, centerY - normalY * 6);
    context.stroke();
    context.restore();
  }

  const sixZoneUltraDefinition = {
    id: "sixZoneUltra",
    name: "六区球Ultra",
    englishName: "Six Zone Ultra",
    color: SECTOR_COLORS[0],
    rosterType: "outOfSpec",
    sectorColors: SECTOR_COLORS,
    description: "未削减融合体 / 双锯冰霜 / 电弧音波箭",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let saws = [];
      let arrowTimer = 0;
      let waveTimer = 0;
      let waveShots = 0;
      let electricRecovery = 0;
      let electricVisualTimer = 0;
      let trailTimer = FROST_TRAIL_EMIT_INTERVAL;
      const electricTargets = new Set();
      const stunGate = createStunGate();
      let trailX = null;
      let trailY = null;

      function ensureSaws(context) {
        if (saws.some((saw) => saw && saw.entityActive !== false)) return;
        saws = [
          services.spawnCombatEntity(createSaw(-1, context.ball)),
          services.spawnCombatEntity(createSaw(1, context.ball))
        ].filter(Boolean);
      }

      function emitBodyTrail(context) {
        const startX = trailX === null ? context.ball.prevX : trailX;
        const startY = trailY === null ? context.ball.prevY : trailY;
        const endX = context.ball.x;
        const endY = context.ball.y;
        if (Number.isFinite(startX) && Number.isFinite(startY) &&
            Math.hypot(endX - startX, endY - startY) > 0.5) {
          services.spawnCombatEntity(createFrostTrail(startX, startY, endX, endY));
          trailX = endX;
          trailY = endY;
        }
      }

      function updateElectricTargets(context) {
        services.forEachEnemy((target) => {
          const distance = Math.hypot(target.x - context.ball.x, target.y - context.ball.y);
          const inRange = distance <=
            BODY_FIELD_RADIUS +
              (Number.isFinite(target.radius) ? target.radius : 0);
          const key = target.instanceId;
          if (!inRange) {
            electricTargets.delete(key);
            return;
          }
          if (electricTargets.has(key)) return;
          if (electricRecovery > EPSILON) return;
          if (triggerElectric(services, target, stunGate, context.game.time)) {
            electricTargets.add(key);
            electricRecovery = ELECTRIC_RECOVERY;
          }
        });
      }

      return {
        getAttackCycleDuration() { return 5; },
        drawBorrowedWeapon(context, canvasContext) {
          const weapons = saws.length ? saws : [createSaw(-1, context.ball), createSaw(1, context.ball)];
          weapons.forEach(saw => drawSaw(canvasContext, saw));
          this.drawAfter(context, canvasContext);
        },
        onSpawn(context) {
          ensureSaws(context);
          trailX = context.ball.x;
          trailY = context.ball.y;
        },
        update(context, dt) {
          ensureSaws(context);
          const elapsed = Math.max(0, dt);
          trailTimer += elapsed;
          arrowTimer = Math.min(ARROW_INTERVAL, arrowTimer + elapsed);
          waveTimer = Math.min(WAVE_CYCLE, waveTimer + elapsed);
          electricRecovery = Math.max(0, electricRecovery - elapsed);
          electricVisualTimer += elapsed;
          if (electricVisualTimer >= 0.03) {
            electricVisualTimer %= 0.03;
            services.spawnVisualEffect(createElectricArcVisual(
              context.ball.x,
              context.ball.y,
              BODY_FIELD_RADIUS,
              Math.floor(context.game.time * 1000),
              clamp(1 - electricRecovery / ELECTRIC_RECOVERY, 0, 1)
            ));
          }
          updateElectricTargets(context);
          stunGate.prune(context.game.time);
        },
        getNextTransitionIn() {
          const nextArrow = ARROW_INTERVAL - arrowTimer;
          const nextWave = waveShots < WAVE_BURST_COUNT
            ? WAVE_BURST_START + waveShots * WAVE_BURST_INTERVAL - waveTimer
            : WAVE_CYCLE - waveTimer;
          return Math.max(EPSILON, Math.min(nextArrow, nextWave));
        },
        afterUpdateStep(context) {
          if (trailTimer + EPSILON >= FROST_TRAIL_EMIT_INTERVAL) {
            trailTimer %= FROST_TRAIL_EMIT_INTERVAL;
            emitBodyTrail(context);
          }
          while (arrowTimer + EPSILON >= ARROW_INTERVAL) {
            arrowTimer -= ARROW_INTERVAL;
            const target = services.getOpponent();
            if (target) {
              services.spawnProjectile(createArrow(services, context.ball, target, stunGate));
            }
          }
          while (
            waveShots < WAVE_BURST_COUNT &&
            waveTimer + EPSILON >= WAVE_BURST_START + waveShots * WAVE_BURST_INTERVAL
          ) {
            services.spawnCombatEntity(createSonicWave(context.ball.x, context.ball.y));
            waveShots += 1;
          }
          if (waveTimer + EPSILON >= WAVE_CYCLE) {
            waveTimer = 0;
            waveShots = 0;
          }
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          if (electricRecovery <= EPSILON) {
            if (triggerElectric(context.services, target, stunGate, context.game.time)) {
              electricRecovery = ELECTRIC_RECOVERY;
            }
          }
          spawnGlassBurst(context.services, context.ball.x, context.ball.y, context.game);
        },
        onWallBounce(context) {
          spawnGlassBurst(context.services, context.ball.x, context.ball.y, context.game);
        },
        drawBody(context, canvasContext) {
          drawSixSectorBody(canvasContext, context.ball);
          return true;
        },
        drawAfter(context, canvasContext) {
          const progress = clamp(
            (arrowTimer - (ARROW_INTERVAL - 0.6)) / 0.6,
            0,
            1
          );
          drawArrowCharge(
            canvasContext,
            context.ball,
            services.getOpponent(),
            progress
          );
        },
        getSawStates() {
          return saws;
        },
        onBorrowEnd() {
          saws.forEach((saw) => {
            if (!saw) return;
            saw.entityActive = false;
            saw.life = 0;
          });
          if (!services.borrowedAttackOnly) saws = [];
        }
      };
    }
  };

  registerBall(sixZoneUltraDefinition);
  return {
    sixZoneUltraDefinition,
    createSixZoneUltraElectricStun: createElectricStun,
    createSixZoneUltraStunGate: createStunGate,
    // 现成的公转圆锯：锯球直接复用（options 可覆盖公转速度/半径/尺寸/伤害/拖尾/kind）
    createSixZoneSaw: createSaw,
    drawSixZoneSaw: drawSaw,
    SIX_ZONE_SAW_PALETTE: SAW_PALETTE,
    SIX_ZONE_SAW_RULES: Object.freeze({
      radius: SAW_RADIUS,
      orbitRadius: SAW_ORBIT_RADIUS,
      orbitRps: SAW_ORBIT_RPS,
      damage: SAW_DAMAGE
    })
  };
});
