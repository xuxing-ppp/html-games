(function initializeAfterimageTrail(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./visual-properties.js") : root.BallBattle);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAfterimageTrailApi(dependencies) {
  "use strict";
  const { createVisualPropertyAnimation } = dependencies;

  // 统一残影拖尾视效：与粒子爆炸同级，任何小球都能用
  // services.spawnAfterimageTrail(options) 拿到一条拖尾。
  //
  // 每片残影同时叠三条曲线，共用一个周期 sampleLife：
  // 1. 逐渐透明：出生 maxAlpha 线性降到 0；
  // 2. 逐渐缩小面积：半径线性降到 minScale；
  // 3. 模糊：Canvas filter blur，出生即为残影半径的 blurRatio 倍，随缩小同步减弱。
  //    模糊不够强就会露出残影边缘，看着像一串小球而不是一条拖尾。
  // 另外按速度把残影沿运动方向拉长成椭圆，让固定间隔的残影连成尾迹；
  // widthRatio 单独收窄垂直方向，speedFloor/speedRamp 让拖尾只在速度
  // 超过阈值后从零淡入 —— 常驻型小球（长矛、锯球V2）因此在基础
  // 150 速度下完全看不见拖尾。
  //
  // 纯视效：没有战斗来源、不参与碰撞、不能造成伤害或施加状态。

  const DEFAULTS = Object.freeze({
    sampleLife: 0.25,
    maxAlpha: 0.4,
    minScale: 0.35,
    blurRatio: 0.3,
    blurDecay: 0.25,
    stretchGain: 1 / 240,
    maxStretch: 2.6,
    sampleInterval: 0.03,
    maxSamples: 32,
    widthRatio: 1,
    speedFloor: 0,
    speedRamp: 0
  });

  // 没有 ctx.filter 的环境：同形状多层放大 + 低透明叠加，近似软边。
  const FALLBACK_PASSES = Object.freeze([
    { alpha: 0.5, scale: 1 },
    { alpha: 0.28, scale: 1.22 },
    { alpha: 0.16, scale: 1.45 }
  ]);

  // 模糊层的像素上限：超过就退回逐片模糊，避免为一条拖尾申请超大离屏。
  const MAX_BLUR_LAYER_PIXELS = 4096;
  // 离屏层尺寸按此粒度向上取整：canvas 每次 width/height 赋值都要重分配后备
  // 存储，逐帧 ±几个像素地改尺寸是纯浪费，对齐后同一场对局里基本只分配一次。
  const BLUR_LAYER_BUCKET = 128;
  // 只在需求面积远小于当前（3 倍以上）时才回收尺寸，避免大小来回抖动。
  const BLUR_LAYER_SHRINK_RATIO = 3;
  // 形状自中心向外的默认延伸（相对残影半径）。注入的 drawSample 可能画到
  // 半径之外，调用方可以用 sampleExtent 声明真实范围，避免模糊层裁掉边缘。
  const DEFAULT_EXTENT_RATIO = 1.25;
  // 模糊外溢系数：高斯模糊的有效半径约为 3σ。
  const BLUR_SPREAD = 3;

  // 同一帧的所有残影共用一块离屏层（绘制是同步的，下一帧才复用）。
  const sharedBlurLayer = { canvas: null };
  let blurFilterSupport = null;

  function acquireBlurLayer(width, height) {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    const bucketWidth = Math.ceil(width / BLUR_LAYER_BUCKET) * BLUR_LAYER_BUCKET;
    const bucketHeight = Math.ceil(height / BLUR_LAYER_BUCKET) * BLUR_LAYER_BUCKET;
    if (bucketWidth > MAX_BLUR_LAYER_PIXELS || bucketHeight > MAX_BLUR_LAYER_PIXELS) {
      return null;
    }
    if (!sharedBlurLayer.canvas) sharedBlurLayer.canvas = document.createElement("canvas");
    const canvas = sharedBlurLayer.canvas;
    if (canvas.width < bucketWidth || canvas.width > bucketWidth * BLUR_LAYER_SHRINK_RATIO) {
      canvas.width = bucketWidth;
    }
    if (canvas.height < bucketHeight || canvas.height > bucketHeight * BLUR_LAYER_SHRINK_RATIO) {
      canvas.height = bucketHeight;
    }
    const context = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    return context ? { canvas, context } : null;
  }

  /**
   * ctx.filter 存在但被忽略的环境（赋值后读回仍是 none）必须走逐片回退，
   * 否则拖尾会突然变锐。检测一次后缓存结果。
   */
  function supportsBlurFilter(context) {
    if (blurFilterSupport !== null) return blurFilterSupport;
    const original = context.filter;
    context.filter = "blur(1px)";
    blurFilterSupport = context.filter !== "none" && context.filter !== original;
    context.filter = original;
    return blurFilterSupport;
  }

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeColor(color, fallback) {
    return typeof color === "string" && color ? color : fallback;
  }

  function withAlpha(color, alpha) {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return color;
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return "rgba(" + red + ", " + green + ", " + blue + ", " +
      clamp(alpha, 0, 1).toFixed(3) + ")";
  }

  /**
   * 默认残影形状：径向渐变软边椭圆块，外缘一路降到完全透明，
   * 所以强模糊之后仍是一团 smear，不会露出硬轮廓。
   * 想换形状（保留本体花纹、刀光、色带）就传 options.drawSample。
   */
  function drawSoftBlobSample(context, x, y, radius, color, heading, stretch, width) {
    const safeRadius = Math.max(0.4, radius);
    context.save();
    context.translate(x, y);
    if (Number.isFinite(heading)) context.rotate(heading);
    const along = Number.isFinite(stretch) && stretch > 1 ? stretch : 1;
    const across = Number.isFinite(width) ? width : 1;
    if (along !== 1 || across !== 1) context.scale(along, across);
    if (typeof context.createRadialGradient === "function") {
      const gradient = context.createRadialGradient(
        0, 0, safeRadius * 0.08,
        0, 0, safeRadius
      );
      gradient.addColorStop(0, withAlpha(color, 1));
      gradient.addColorStop(0.45, withAlpha(color, 0.7));
      gradient.addColorStop(0.78, withAlpha(color, 0.26));
      gradient.addColorStop(1, withAlpha(color, 0));
      context.fillStyle = gradient;
    } else {
      context.fillStyle = color;
    }
    context.beginPath();
    context.arc(0, 0, safeRadius, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  function normalizeFallbackPasses(passes) {
    if (!Array.isArray(passes) || passes.length === 0) return FALLBACK_PASSES;
    const normalized = passes
      .filter((pass) => pass && typeof pass === "object")
      .map((pass) => ({
        alpha: clamp(finiteOr(pass.alpha, 0.5), 0, 1),
        scale: Math.max(0.1, finiteOr(pass.scale, 1))
      }));
    return normalized.length > 0 ? normalized : FALLBACK_PASSES;
  }

  /**
   * @param {object} [options] 可调整数据：sampleLife（周期，秒）、maxAlpha（峰值透明度）、
   *   minScale（半径收缩终点）、blurRatio（出生模糊 = 残影半径 × 此值）、blurDecay、
   *   maxBlur（绝对模糊，覆盖 blurRatio）、stretchGain（每单位速度拉长增益）、
   *   maxStretch、widthRatio（垂直视觉宽度倍率）、speedFloor（低于此速度不可见）、
   *   speedRamp（超过 floor 后淡入满 alpha 所需的速度差）、sampleInterval（emit 节流）、
   *   maxSamples（同屏残影上限）、color/radius（默认取色与半径）、drawSample（形状注入）、
   *   fallbackPasses（无 filter 环境的软边近似层）、kind、drawLayer
   * @returns {object} 视效定义 + 拖尾句柄（push/emit/end/sampleCount/active/draining/finished）
   */
  function createAfterimageTrail(options = {}) {
    const sampleLife = Math.max(0.01, finiteOr(options.sampleLife, DEFAULTS.sampleLife));
    const maxAlpha = clamp(finiteOr(options.maxAlpha, DEFAULTS.maxAlpha), 0, 1);
    const minScale = clamp(finiteOr(options.minScale, DEFAULTS.minScale), 0, 1);
    const animation = createVisualPropertyAnimation({
      opacity: { type: "number", default: 1, min: 0, max: 1 },
      sizeScale: { type: "number", default: 1, min: 0 }
    }, {
      label: "afterimage-trail",
      defaultProperties: {
        opacity: { value: maxAlpha, combine: "multiply",
          overLife: [{ at: 0, value: 1 }, { at: 1, value: 0 }] },
        sizeScale: { overLife: [{ at: 0, value: 1 }, { at: 1, value: minScale }] }
      },
      properties: options.properties,
      metadata: options.metadata,
      mapProperties: options.mapAppearance,
      followMetadata: options.followMetadata
    });
    const blurRatio = clamp(finiteOr(options.blurRatio, DEFAULTS.blurRatio), 0, 2);
    const blurDecay = clamp(finiteOr(options.blurDecay, DEFAULTS.blurDecay), 0, 1);
    const stretchGain = Math.max(0, finiteOr(options.stretchGain, DEFAULTS.stretchGain));
    const maxStretch = clamp(finiteOr(options.maxStretch, DEFAULTS.maxStretch), 1, 6);
    const sampleInterval = Math.max(
      0.001,
      finiteOr(options.sampleInterval, DEFAULTS.sampleInterval)
    );
    const maxSamples = Math.max(
      1,
      Math.round(finiteOr(options.maxSamples, DEFAULTS.maxSamples))
    );
    const defaultRadius = Math.max(0.5, finiteOr(options.radius, 8));
    const widthRatio = clamp(finiteOr(options.widthRatio, DEFAULTS.widthRatio), 0.05, 2);
    const speedFloor = Math.max(0, finiteOr(options.speedFloor, DEFAULTS.speedFloor));
    const speedRamp = Math.max(0, finiteOr(options.speedRamp, DEFAULTS.speedRamp));
    const gated = speedFloor > 0 || speedRamp > 0;

    // 速度门控：低于 floor 完全不可见，之后按 ramp 线性淡入到满 alpha。
    function speedGate(speed) {
      if (!gated) return 1;
      const observed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
      if (speedRamp <= 0) return observed >= speedFloor ? 1 : 0;
      return clamp((observed - speedFloor) / speedRamp, 0, 1);
    }
    const absoluteBlur = Number.isFinite(options.maxBlur)
      ? Math.max(0, options.maxBlur)
      : null;
    // 形状自中心向外的最大延伸（世界单位）。默认按"半径 × 拉伸"估算，
    // 形状带长尾巴的调用方（例如雷电残影）应该显式声明，否则模糊层会把
    // 尾巴裁掉。
    const sampleExtent = Number.isFinite(options.sampleExtent) && options.sampleExtent > 0
      ? options.sampleExtent
      : 0;
    const defaultColor = normalizeColor(options.color, "#ffffff");
    const fallbackPasses = normalizeFallbackPasses(options.fallbackPasses);
    const drawSample = typeof options.drawSample === "function"
      ? options.drawSample
      : (context, sample, scale, progress, stretch, width) => {
          drawSoftBlobSample(
            context,
            sample.x,
            sample.y,
            sample.radius * scale,
            sample.color,
            sample.heading,
            stretch,
            width
          );
        };

    const state = {
      time: 0,
      samples: [],
      active: true,
      finished: false,
      lastEmittedAt: -Infinity
    };

    // 强制立刻布置一片（不受 sampleInterval 节流）。
    function push(x, y, radius, extra) {
      if (state.finished) return false;
      const detail = extra && typeof extra === "object" ? extra : {};
      const safeRadius = Math.max(
        0.5,
        finiteOr(radius, finiteOr(detail.radius, defaultRadius))
      );
      state.samples.push({
        x: finiteOr(x, 0),
        y: finiteOr(y, 0),
        radius: safeRadius,
        heading: finiteOr(detail.heading, Number.NaN),
        speed: finiteOr(detail.speed, Number.NaN),
        angle: finiteOr(detail.angle, Number.NaN),
        color: normalizeColor(detail.color, defaultColor),
        createdAt: finiteOr(detail.createdAt, state.time)
      });
      while (state.samples.length > maxSamples) state.samples.shift();
      return true;
    }

    // 每帧调用即可：到 sampleInterval 才真正落一片，调用方不必自己攒时间。
    function emit(x, y, radius, extra) {
      if (state.finished) return false;
      if (state.time - state.lastEmittedAt + EPSILON < sampleInterval) return false;
      state.lastEmittedAt = state.time;
      state.active = true;
      return push(x, y, radius, extra);
    }

    // 软收尾：停喂新残影，已有残影按各自寿命继续渐隐。
    // hard=true 立刻清空并自毁（本体死亡、被复制方收手时用）。
    function end(hard) {
      state.active = false;
      if (hard === true) {
        state.samples.length = 0;
        state.finished = true;
      }
    }

    // 每片残影的几何与透明度：渐隐、缩小、模糊、拉伸共用同一个周期。
    function sampleGeometry(sample, progress) {
      const appearance = animation.sample(progress);
      const shapeScale = appearance.sizeScale;
      const radius = Math.max(0.5, sample.radius * shapeScale);
      const stretch = stretchGain > 0 && Number.isFinite(sample.speed)
        ? clamp(1 + sample.speed * stretchGain, 1, maxStretch)
        : 1;
      return {
        scale: shapeScale,
        radius,
        stretch,
        width: shapeScale * widthRatio,
        alpha: appearance.opacity * speedGate(sample.speed),
        // 出生即强糊（随残影一起缩小、并略降），保证看不见硬边。
        blur: (absoluteBlur === null ? radius * blurRatio : absoluteBlur)
          * (1 - blurDecay * progress)
      };
    }

    /**
     * 把整条拖尾先合成到一张离屏贴图上，再只做一次模糊。
     * 逐片各做一次 ctx.filter 模糊时，每片都要申请一层覆盖整幅画布的合成层，
     * 十几片叠起来足以把一帧拖到几百毫秒；合并成一次之后开销与拖尾范围成正比。
     * 模糊半径统一取各片最大值（略微更糊但不会露出硬边）。
     * @returns {boolean} true 表示已经画完（或本来无内容）；false 表示需要回退。
     */
    function drawBlurLayer(canvasContext, baseAlpha) {
      if (typeof canvasContext.getTransform !== "function") return false;
      if (typeof canvasContext.drawImage !== "function") return false;
      if (typeof canvasContext.filter !== "string") return false;
      if (!supportsBlurFilter(canvasContext)) return false;
      // 只处理纯缩放 + 平移的画布变换；带旋转/斜切时退回逐片绘制。
      const matrix = canvasContext.getTransform();
      if (!matrix || !Number.isFinite(matrix.a) || matrix.a <= 0) return false;
      if (Math.abs(matrix.b) > EPSILON || Math.abs(matrix.c) > EPSILON) return false;
      const deviceScale = matrix.a;

      const entries = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxObservedBlur = 0;
      for (let index = 0; index < state.samples.length; index += 1) {
        const sample = state.samples[index];
        const progress = clamp((state.time - sample.createdAt) / sampleLife, 0, 1);
        const geometry = sampleGeometry(sample, progress);
        if (geometry.alpha <= EPSILON || geometry.scale <= EPSILON) continue;
        const heading = Number.isFinite(sample.heading) ? sample.heading : 0;
        // ctx.filter 的模糊半径按设备像素解释（不随画布变换缩放），所以外溢
        // 也要换算回世界单位，否则离屏层会被撑大数倍。
        const spill = geometry.blur * BLUR_SPREAD / deviceScale;
        const baseExtent = sampleExtent > 0
          ? sampleExtent
          : geometry.radius * DEFAULT_EXTENT_RATIO;
        const along = Math.max(baseExtent, geometry.radius * geometry.stretch) + spill;
        const across = Math.max(baseExtent, geometry.radius * Math.max(1, geometry.width)) + spill;
        const cosine = Math.abs(Math.cos(heading));
        const sine = Math.abs(Math.sin(heading));
        const extentX = along * cosine + across * sine;
        const extentY = along * sine + across * cosine;
        minX = Math.min(minX, sample.x - extentX);
        maxX = Math.max(maxX, sample.x + extentX);
        minY = Math.min(minY, sample.y - extentY);
        maxY = Math.max(maxY, sample.y + extentY);
        maxObservedBlur = Math.max(maxObservedBlur, geometry.blur);
        entries.push({ sample, geometry, progress });
      }
      if (entries.length === 0) return true;
      if (!(maxX > minX) || !(maxY > minY)) return true;

      const deviceWidth = Math.ceil((maxX - minX) * deviceScale);
      const deviceHeight = Math.ceil((maxY - minY) * deviceScale);
      if (deviceWidth <= 0 || deviceHeight <= 0) return true;
      if (deviceWidth > MAX_BLUR_LAYER_PIXELS || deviceHeight > MAX_BLUR_LAYER_PIXELS) {
        return false;
      }
      const layer = acquireBlurLayer(deviceWidth, deviceHeight);
      if (!layer) return false;
      const layerContext = layer.context;
      layerContext.setTransform(1, 0, 0, 1, 0, 0);
      layerContext.globalCompositeOperation = "source-over";
      layerContext.globalAlpha = 1;
      layerContext.clearRect(0, 0, deviceWidth, deviceHeight);
      layerContext.setTransform(
        deviceScale,
        0,
        0,
        deviceScale,
        -minX * deviceScale,
        -minY * deviceScale
      );
      for (const entry of entries) {
        layerContext.globalAlpha = baseAlpha * entry.geometry.alpha;
        drawSample(
          layerContext,
          entry.sample,
          entry.geometry.scale,
          entry.progress,
          entry.geometry.stretch,
          entry.geometry.width
        );
      }
      layerContext.setTransform(1, 0, 0, 1, 0, 0);
      layerContext.globalAlpha = 1;
      layerContext.globalCompositeOperation = "source-over";

      canvasContext.save();
      canvasContext.globalAlpha = 1;
      if (maxObservedBlur > EPSILON) {
        canvasContext.filter = "blur(" + maxObservedBlur.toFixed(2) + "px)";
      }
      // 共享离屏层按 128 的倍数扩容，实际只用到左上角 deviceWidth×deviceHeight，
      // 必须显式取子矩形，否则会把上次留下的旧内容一起贴上来。
      canvasContext.drawImage(
        layer.canvas,
        0,
        0,
        deviceWidth,
        deviceHeight,
        minX,
        minY,
        deviceWidth / deviceScale,
        deviceHeight / deviceScale
      );
      canvasContext.restore();
      return true;
    }

    return {
      kind: options.kind || "afterimage-trail",
      life: sampleLife,
      drawLayer: options.drawLayer || "background",
      samples: state.samples,
      interval: sampleInterval,
      // 调参快照：测试与其他系统据此确认某条球用的是哪一档配置。
      sampleLife,
      maxAlpha,
      minScale,
      blurRatio,
      widthRatio,
      speedFloor,
      speedRamp,
      push,
      emit,
      end,
      get sampleCount() {
        return state.samples.length;
      },
      get active() {
        return state.active;
      },
      get draining() {
        return !state.active && state.samples.length > 0;
      },
      get finished() {
        return state.finished;
      },
      update({ effect }, dt) {
        animation.updateMetadata();
        state.time += Math.max(0, dt);
        // 直接拿句柄驱动时没有 age，兜底成 0，避免 NaN 写进 life。
        const age = finiteOr(effect.age, 0);
        while (
          state.samples.length > 0 &&
          state.time - state.samples[0].createdAt >= sampleLife - EPSILON
        ) {
          state.samples.shift();
        }
        if (!state.active && state.samples.length === 0) {
          state.finished = true;
          effect.life = Math.min(finiteOr(effect.life, age), age);
          return;
        }
        // 只需比“最后一片残影的寿命”长一点，生命周期始终有界。
        effect.life = Math.max(finiteOr(effect.life, sampleLife), age + sampleLife);
      },
      draw({ effect }, canvasContext) {
        if (state.samples.length === 0) return;
        const baseAlpha = canvasContext.globalAlpha;
        if (state.samples.length > 1 && drawBlurLayer(canvasContext, baseAlpha)) return;
        for (let index = 0; index < state.samples.length; index += 1) {
          const sample = state.samples[index];
          const progress = clamp(
            (state.time - sample.createdAt) / sampleLife,
            0,
            1
          );
          const geometry = sampleGeometry(sample, progress);
          if (geometry.alpha <= EPSILON || geometry.scale <= EPSILON) continue;
          let blurred = false;
          if (geometry.blur > EPSILON && typeof canvasContext.filter === "string") {
            canvasContext.save();
            canvasContext.filter = "blur(" + geometry.blur.toFixed(2) + "px)";
            blurred = canvasContext.filter !== "none";
            if (!blurred) canvasContext.restore();
          }
          if (blurred) {
            canvasContext.globalAlpha = baseAlpha * geometry.alpha;
            drawSample(
              canvasContext,
              sample,
              geometry.scale,
              progress,
              geometry.stretch,
              geometry.width
            );
            canvasContext.restore();
          } else {
            for (let pass = 0; pass < fallbackPasses.length; pass += 1) {
              const layer = fallbackPasses[pass];
              canvasContext.save();
              canvasContext.globalAlpha = baseAlpha * geometry.alpha * layer.alpha;
              drawSample(
                canvasContext,
                sample,
                geometry.scale * layer.scale,
                progress,
                geometry.stretch * (1 + (layer.scale - 1) * 0.5),
                geometry.width * (1 + (layer.scale - 1) * 0.5)
              );
              canvasContext.restore();
            }
          }
        }
        canvasContext.globalAlpha = baseAlpha;
      }
    };
  }

  return {
    createAfterimageTrail,
    drawSoftBlobSample,
    AFTERIMAGE_TRAIL_DEFAULTS: DEFAULTS,
    AFTERIMAGE_TRAIL_FALLBACK_PASSES: FALLBACK_PASSES
  };
});
