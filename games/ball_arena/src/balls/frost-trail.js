(function initializeFrostTrail(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFrostTrailPlugin({ registerBall }) {
  const TRAIL_WIDTH = 25;
  const TRAIL_ACTIVE_DURATION = 2.6;
  const TRAIL_FADE_DURATION = 0.6;
  const FREEZE_DURATION = 0.6;
  const CONTACT_GRACE = 0.08;
  // 冻在冰面上越久，下一次伤害来得越快：0.6 → 0.5 → 0.4 → 0.3 封底。
  // 这是一条"同一段冻结内不断加速"的节奏，重新冻上又是从 0.6 开始。
  const DAMAGE_INTERVAL_START = 0.6;
  const DAMAGE_INTERVAL_STEP = 0.1;
  const DAMAGE_INTERVAL_MIN = 0.3;
  const DAMAGE = 1;
  const MIN_SEGMENT_LENGTH = 0.5;
  // 晶体按 (颜色, 量化透明度) 分桶后一次性填充/描边。桶内用第一颗晶体的精确
  // 透明度，所以单晶体桶与原实现逐像素一致，只有同桶晶体之间相差 1/32 以内。
  const CRYSTAL_ALPHA_STEPS = 32;
  const BAND_OPACITY_STEPS = 32;
  const EPSILON = 1e-9;
  const DEFAULT_CRYSTAL_COLORS = Object.freeze(["#a8dcf4", "#dff8ff", "#72b8da", "#c6efff"]);
  const DEFAULT_CORE_COLOR = "#72c5ea";
  const DEFAULT_EDGE_COLOR = "#eaffff";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function createCrystalCluster(startX, startY, endX, endY, options = {}) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    const tangentX = length > EPSILON ? deltaX / length : 1;
    const tangentY = length > EPSILON ? deltaY / length : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const random = createSeededRandom(startX, startY, endX, endY);
    const count = Math.max(3, Math.ceil(length / 3));
    const colors = Array.isArray(options.colors) && options.colors.length > 0
      ? options.colors
      : DEFAULT_CRYSTAL_COLORS;
    const bandWidth = Number.isFinite(options.width) ? options.width : TRAIL_WIDTH;
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
      const lateralLimit = Math.max(0, bandWidth / 2 - lateralExtent);
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

  // 线段是否够得着球体：reach 由调用方给出（球半径 + 轨迹半宽）。
  function segmentReachesBall(segment, ball, width) {
    const deltaX = segment.endX - segment.startX;
    const deltaY = segment.endY - segment.startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((ball.x - segment.startX) * deltaX + (ball.y - segment.startY) * deltaY) /
          lengthSquared,
        0,
        1
      );
    const closestX = segment.startX + deltaX * progress;
    const closestY = segment.startY + deltaY * progress;
    const halfWidth = (Number.isFinite(width) ? width : TRAIL_WIDTH) / 2;
    return Math.hypot(ball.x - closestX, ball.y - closestY) <= ball.radius + halfWidth;
  }

  // 段落当前的融化进度：有效期恒为 0，融化期线性走到 1。
  function segmentMeltProgress(age, activeDuration, fadeDuration) {
    if (age <= activeDuration || fadeDuration <= EPSILON) return 0;
    return clamp((age - activeDuration) / fadeDuration, 0, 1);
  }

  // 一段轨迹的几何与晶体。晶体只由端点决定（种子随机），
  // 所以按段聚合不会改变任何一颗晶体的形状、配色与漂移。
  function createTrailSegment(startX, startY, endX, endY, width, crystalColors) {
    return {
      startX,
      startY,
      endX,
      endY,
      crystals: createCrystalCluster(startX, startY, endX, endY, {
        width,
        colors: crystalColors
      })
    };
  }

  // 轨迹的批量绘制：把这一批段落里的晶体按 (颜色, 量化透明度) 分桶，
  // 每个桶只做一次 beginPath/fill（描边同理）。
  //
  // 逐晶体绘制一帧要发出上千次 2D 调用，梓的轨迹（每帧铺一段、场上近两百段）
  // 会周期性把「离屏画布 → WebGL 纹理」这条呈现路径顶到 ~90ms 的卡顿上，
  // 分桶后填充/描边次数由「晶体数」降到「桶数」。几何、配色与逐晶体的
  // 融化动画都保留：桶内用第一颗晶体的精确透明度，只有同桶晶体相差 1/32 以内。
  function drawTrailSegments(context, segments, style) {
    const bands = new Map();
    const fills = new Map();
    const strokes = new Map();
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const meltProgress = segmentMeltProgress(
        segment.age,
        style.activeDuration,
        style.fadeDuration
      );
      const opacity = 1 - meltProgress;
      if (opacity <= 0) continue;
      const bandKey = style.coreColor + "|" + Math.round(opacity * BAND_OPACITY_STEPS);
      let band = bands.get(bandKey);
      if (!band) {
        band = { color: style.coreColor, opacity, points: [] };
        bands.set(bandKey, band);
      }
      band.points.push(segment.startX, segment.startY, segment.endX, segment.endY);

      const crystals = segment.crystals;
      for (let crystalIndex = 0; crystalIndex < crystals.length; crystalIndex += 1) {
        const crystal = crystals[crystalIndex];
        const localMelt = clamp(
          (meltProgress - crystal.meltDelay) / (1 - crystal.meltDelay),
          0,
          1
        );
        const scale = 1 - localMelt * 0.62;
        const points = crystal.points;
        const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
        const centerY = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
        const offsetX = crystal.driftX * localMelt;
        const offsetY = crystal.driftY * localMelt;
        const alpha = opacity * crystal.opacity * (1 - localMelt * 0.45);
        const alphaKey = Math.round(alpha * CRYSTAL_ALPHA_STEPS);
        const fillKey = crystal.color + "|" + alphaKey;
        let fill = fills.get(fillKey);
        if (!fill) {
          fill = { color: crystal.color, alpha, points: [] };
          fills.set(fillKey, fill);
        }
        const strokeKey = style.edgeColor + "|" + alphaKey;
        let stroke = strokes.get(strokeKey);
        if (!stroke) {
          stroke = { color: style.edgeColor, alpha, points: [] };
          strokes.set(strokeKey, stroke);
        }
        for (let pointIndex = 0; pointIndex < 4; pointIndex += 1) {
          const point = points[pointIndex];
          const x = centerX + (point.x - centerX) * scale + offsetX;
          const y = centerY + (point.y - centerY) * scale + offsetY;
          fill.points.push(x, y);
          stroke.points.push(x, y);
        }
      }
    }

    const inheritedAlpha = context.globalAlpha;
    context.save();
    context.lineCap = "round";
    for (const band of bands.values()) {
      context.globalAlpha = inheritedAlpha * band.opacity * 0.08;
      context.strokeStyle = band.color;
      context.lineWidth = 8;
      const points = band.points;
      context.beginPath();
      for (let index = 0; index < points.length; index += 4) {
        context.moveTo(points[index], points[index + 1]);
        context.lineTo(points[index + 2], points[index + 3]);
      }
      context.stroke();
    }
    for (const fill of fills.values()) {
      context.globalAlpha = inheritedAlpha * fill.alpha;
      context.fillStyle = fill.color;
      const points = fill.points;
      context.beginPath();
      for (let index = 0; index < points.length; index += 8) {
        context.moveTo(points[index], points[index + 1]);
        context.lineTo(points[index + 2], points[index + 3]);
        context.lineTo(points[index + 4], points[index + 5]);
        context.lineTo(points[index + 6], points[index + 7]);
      }
      context.fill();
    }
    for (const stroke of strokes.values()) {
      context.globalAlpha = inheritedAlpha * stroke.alpha;
      context.strokeStyle = stroke.color;
      context.lineWidth = 0.45;
      const points = stroke.points;
      context.beginPath();
      for (let index = 0; index < points.length; index += 8) {
        context.moveTo(points[index], points[index + 1]);
        context.lineTo(points[index + 2], points[index + 3]);
        context.lineTo(points[index + 4], points[index + 5]);
        context.lineTo(points[index + 6], points[index + 7]);
        context.closePath();
      }
      context.stroke();
    }
    context.restore();
  }

  // 冻结进度只产出 speedFactor：0 表示完全钉住。速度的合成、免疫与解冻
  // 全部由引擎负责，这里不再直接改倍率或速度向量。
  function applyFreezeProgress(effect, time) {
    const progress = clamp((time - effect.startedAt) / FREEZE_DURATION, 0, 1);
    effect.speedFactor = 1 - progress;
    effect.freezeProgress = progress;
    const frozen = effect.speedFactor <= EPSILON;
    effect.preventsAttack = frozen;
    effect.blocksDamageOutput = frozen;
    effect.pausesBehavior = frozen;
  }

  function createFrostEffect() {
    return {
      id: "azusa-frost",
      attackTags: ["cold", "freeze"],
      duration: CONTACT_GRACE,
      // 唯一的减速接口：0 → 1 的线性解冻曲线由引擎统一合成。
      speedFactor: 1,
      onApply({ effect, game, isRefresh }) {
        // 重新接触（isRefresh）只延续冻结进度，不重置计时。
        if (!isRefresh) {
          effect.startedAt = game.time;
          effect.damageInterval = DAMAGE_INTERVAL_START;
          effect.nextDamageAt = game.time + effect.damageInterval;
        }
        applyFreezeProgress(effect, game.time);
      },
      update({ ball, effect, game, services: effectServices }) {
        const stillOnFrost = game.time + EPSILON < effect.expiresAt;
        if (stillOnFrost) {
          while (game.time + EPSILON >= effect.nextDamageAt) {
            effectServices.dealDamage(ball, DAMAGE);
            const current = Number.isFinite(effect.damageInterval)
              ? effect.damageInterval
              : DAMAGE_INTERVAL_START;
            effect.damageInterval = Math.max(
              DAMAGE_INTERVAL_MIN,
              current - DAMAGE_INTERVAL_STEP
            );
            effect.nextDamageAt += effect.damageInterval;
          }
        }
        applyFreezeProgress(effect, game.time);
      },
      draw({ ball, effect, game }, context) {
        const progress = effect.freezeProgress || clamp(
          (game.time - effect.startedAt) / FREEZE_DURATION,
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

  // 冰霜轨迹的通用工厂：默认就是梓的那一条（宽 25、2.6s 出伤 + 0.6s 融化）。
  // 出伤、判定、冻结曲线都由这里统一负责，其它球（例如冰川的雪球轨迹）只换参数：
  // width / activeDuration / fadeDuration / 配色 / kind。
  // 每段仍然是一个独立实体（冰川的雪球就是一段一段铺的）；梓那种"一直铺"的
  // 写法用下面的 createFrostTrailBand，把整条直段合成一个实体。
  function createFrostTrail(startX, startY, endX, endY, options = {}) {
    const width = Number.isFinite(options.width) ? options.width : TRAIL_WIDTH;
    const activeDuration = Number.isFinite(options.activeDuration)
      ? options.activeDuration
      : TRAIL_ACTIVE_DURATION;
    const fadeDuration = Number.isFinite(options.fadeDuration)
      ? options.fadeDuration
      : TRAIL_FADE_DURATION;
    const segment = createTrailSegment(
      startX,
      startY,
      endX,
      endY,
      width,
      options.crystalColors
    );
    const definition = {
      kind: options.kind || "azusa-frost-trail",
      attackTags: ["cold", "area"],
      drawLayer: "background",
      life: activeDuration + fadeDuration,
      width,
      activeDuration,
      fadeDuration,
      coreColor: options.coreColor || DEFAULT_CORE_COLOR,
      edgeColor: options.edgeColor || DEFAULT_EDGE_COLOR,
      startX,
      startY,
      endX,
      endY,
      crystals: segment.crystals,
      update({ effect, services: trailServices }) {
        if (effect.age > effect.activeDuration + EPSILON) return;
        trailServices.forEachEnemy((target) => {
          const profile = trailServices.getContactProfile(target);
          if (!profile.solid || !profile.attackable) return;
          if (!segmentReachesBall(effect, target, effect.width)) return;
          trailServices.applyEffect(target, createFrostEffect());
        });
      }
    };
    if (options.painted !== true) {
      // 一段一个实体的用法（冰川的雪球轨迹）自己逐段绘制。
      // 梓这种一直铺的用法把绘制交给 createFrostTrailBand 统一批量处理。
      definition.draw = ({ effect }, context) => {
        // 复用同一个数组，避免每帧给批量绘制分配新容器。
        const batch = effect.trailBatch || (effect.trailBatch = [effect]);
        drawTrailSegments(context, batch, effect);
      };
    }
    return definition;
  }

  // 轨迹画笔：一个纯视觉实体（Visual Effect），把梓这条轨迹上所有存活段落的
  // 晶体一次性批量画出来。段落本身仍然是独立的战斗实体 —— 接触、出伤、生命周期
  // 以及其它球（日奈的差避、模组的来源判定、枪手的威胁模型）读到的几何都和以前
  // 逐位一致，只有"谁来画"变了：逐段逐晶体绘制时，满场近两百段会让一帧发出上千次
  // 2D 调用，周期性把「离屏画布 → WebGL 纹理」这条呈现路径顶到 ~90ms 的卡顿上。
  function createFrostTrailBand(segments) {
    return {
      kind: "azusa-frost-trail-band",
      drawLayer: "background",
      // 最后一段消失时靠 visualActive 退场，所以寿命只需要一个足够大的有限值。
      life: Number.MAX_SAFE_INTEGER,
      segments,
      update({ effect }) {
        const list = effect.segments;
        let writeIndex = 0;
        for (let index = 0; index < list.length; index += 1) {
          const segment = list[index];
          if (segment.entityActive === false) continue;
          list[writeIndex] = segment;
          writeIndex += 1;
        }
        list.length = writeIndex;
        if (writeIndex === 0) effect.visualActive = false;
      },
      draw({ effect }, context) {
        const list = effect.segments;
        if (list.length === 0) return;
        // 同一名角色铺下的段落共用同一套时长与配色，取第一段当样式来源。
        drawTrailSegments(context, list, list[0]);
      }
    };
  }


  return {
    createFrostEffect,
    createFrostTrail,
    createFrostTrailBand,
    FROST_CONSTANTS: Object.freeze({
      TRAIL_WIDTH,
      TRAIL_ACTIVE_DURATION,
      TRAIL_FADE_DURATION,
      FREEZE_DURATION,
      CONTACT_GRACE,
      DAMAGE_INTERVAL_START,
      DAMAGE_INTERVAL_STEP,
      DAMAGE_INTERVAL_MIN,
      DAMAGE,
      MIN_SEGMENT_LENGTH,
      CRYSTAL_ALPHA_STEPS
    })
  };
});
