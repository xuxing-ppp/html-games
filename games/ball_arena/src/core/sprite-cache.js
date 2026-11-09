(function initializeSpriteCache(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpriteCacheApi() {
  "use strict";

  // 静态外观缓存：球本体、光晕这类"每帧形状完全相同、只有位置/尺寸/透明度
  // 在变"的绘制，先在离屏 canvas 上渲染一次，之后每帧只做一次 drawImage。
  // 一个半径 15 的渐变球本体，每帧重建径向渐变 + 填充比一次贴图绘制贵一个
  // 数量级；对局里每颗球每帧都要画一次，累计起来很可观。
  //
  // 贴图按"当前设备缩放"渲染，所以缩放比例变化（预览 / 录制 / 移动端）时会
  // 各自缓存一张，保证 1:1 像素映射、不会糊。

  const MAX_ENTRIES = 64;
  const TEXT_MAX_ENTRIES = 1024;
  const TEXT_MAX_PIXELS = 4 * 1024 * 1024;
  const fontRevisions = new WeakMap();

  function getFontRevision(fonts) {
    if (!fonts || typeof fonts.addEventListener !== "function") return 0;
    let state = fontRevisions.get(fonts);
    if (!state) {
      state = { revision: 0 };
      const invalidate = () => { state.revision += 1; };
      // One listener set per FontFaceSet, never one per ball or renderer.
      fonts.addEventListener("loading", invalidate);
      fonts.addEventListener("loadingdone", invalidate);
      fonts.addEventListener("loadingerror", invalidate);
      fontRevisions.set(fonts, state);
    }
    return state.revision;
  }

  function defaultCreateCanvas() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    return document.createElement("canvas");
  }

  /**
   * 当前 2D 上下文的设备缩放。拿不到（离屏 stub、Node、变换异常）时返回 null，
   * 调用方据此回退到直接绘制。
   */
  function resolveDeviceScale(context) {
    if (!context || typeof context.getTransform !== "function") return null;
    if (typeof context.drawImage !== "function") return null;
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return null;
    }
    const matrix = context.getTransform();
    if (!matrix || !Number.isFinite(matrix.a) || matrix.a <= 0) return null;
    return matrix.a;
  }

  function createSpriteCache({ createCanvas = defaultCreateCanvas,
    maxEntries = MAX_ENTRIES, maxPixels = Infinity } = {}) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
        !(maxPixels === Infinity || (Number.isSafeInteger(maxPixels) && maxPixels > 0))) {
      throw new TypeError("Sprite cache limits must be positive integers");
    }
    const entries = new Map();
    let totalPixels = 0;

    function clear() {
      entries.clear();
      totalPixels = 0;
    }

    /**
     * @param {string} keyBase 形状标识（不含尺寸与缩放）
     * @param {number} sizeWorld 贴图覆盖的世界尺寸（正方形边长）
     * @param {number} scale 设备缩放
     * @param {(context: object, centerX: number, centerY: number, size: number) => void} paint
     *   以世界坐标绘制该形状，中心点由缓存指定。
     * @returns {{ canvas: object, sizeWorld: number, worldWidth: number } | null}
     *   worldWidth 是贴图像素按 1:1 映射回世界单位后的实际边长。像素数是
     *   sizeWorld × scale 向上取整，所以 worldWidth 可能略大于 sizeWorld；
     *   按 1:1 贴着原位置绘制时应使用 worldWidth 作目标尺寸（左上角不变），
     *   否则会被压缩一点点、边缘多一次重采样。
     */
    function get(keyBase, sizeWorld, scale, paint) {
      if (!Number.isFinite(sizeWorld) || sizeWorld <= 0) return null;
      if (!Number.isFinite(scale) || scale <= 0) return null;
      const key = keyBase + "|" + sizeWorld.toFixed(2) + "|" + scale.toFixed(3);
      const cached = entries.get(key);
      if (cached) return cached;

      const pixels = Math.max(1, Math.ceil(sizeWorld * scale));
      if (pixels > 8192 || pixels * pixels > maxPixels) return null;
      const canvas = createCanvas();
      if (!canvas || typeof canvas.getContext !== "function") return null;
      canvas.width = pixels;
      canvas.height = pixels;
      const context = canvas.getContext("2d");
      if (!context) return null;
      if (typeof context.setTransform === "function") {
        context.setTransform(scale, 0, 0, scale, 0, 0);
      }
      const half = sizeWorld / 2;
      paint(context, half, half, sizeWorld);

      while (entries.size >= maxEntries || totalPixels + pixels * pixels > maxPixels) {
        const oldest = entries.keys().next().value;
        totalPixels -= entries.get(oldest).canvas.width * entries.get(oldest).canvas.height;
        entries.delete(oldest);
      }
      const entry = { canvas, sizeWorld, worldWidth: canvas.width / scale };
      entries.set(key, entry);
      totalPixels += pixels * pixels;
      return entry;
    }

    return {
      get,
      clear,
      get size() {
        return entries.size;
      }
    };
  }

  function createTextSpriteCache(options) {
    const cache = createSpriteCache({ ...options,
      maxEntries: TEXT_MAX_ENTRIES, maxPixels: TEXT_MAX_PIXELS });
    const records = new Map();
    let totalPixels = 0;
    let lastFonts;
    let lastRevision;
    let lastFontCount;

    function clear() {
      cache.clear();
      records.clear();
      totalPixels = 0;
    }

    function draw(context, text, x, y, scale) {
      if (!context || typeof context.drawImage !== "function" ||
          typeof context.measureText !== "function" ||
          !Number.isFinite(scale) || scale <= 0) return false;
      const value = String(text);
      const fonts = typeof document !== "undefined" ? document.fonts : null;
      const revision = getFontRevision(fonts);
      if (fonts !== lastFonts || revision !== lastRevision ||
          (fonts && fonts.size) !== lastFontCount) {
        clear();
        lastFonts = fonts;
        lastRevision = revision;
        lastFontCount = fonts && fonts.size;
      }
      const key = JSON.stringify([value, scale, context.font, context.textAlign,
        context.textBaseline, context.lineJoin, context.lineWidth,
        context.strokeStyle, context.fillStyle]);
      let record = records.get(key);
      // Non-browser FontFaceSet shims may not publish invalidation events.
      if (fonts && (!record || typeof fonts.addEventListener !== "function") &&
          !fonts.check(context.font, value)) return false;
      if (record) {
        context.drawImage(record.sprite.canvas, x - record.offsetX, y - record.offsetY,
          record.sprite.worldWidth, record.sprite.worldWidth);
        return true;
      }
      const fontSize = Number((/([\d.]+)px/.exec(context.font) || [])[1]);
      if (!Number.isFinite(fontSize) || fontSize <= 0) return false;
      const metrics = context.measureText(value);
      if (!metrics || !Number.isFinite(metrics.width)) return false;
      const padding = context.lineWidth + 2;
      const size = Math.max(fontSize * 2, metrics.width + padding * 2);
      const style = {
        font: context.font, textAlign: context.textAlign,
        textBaseline: context.textBaseline, lineJoin: context.lineJoin,
        lineWidth: context.lineWidth, strokeStyle: context.strokeStyle,
        fillStyle: context.fillStyle
      };
      const sprite = cache.get(key, size, scale, (spriteContext, cx, cy) => {
        Object.assign(spriteContext, style);
        const anchorX = style.textAlign === "left" ? padding : cx;
        // Rasterize every baseline at a fixed device-pixel phase. Moving a
        // glyph image must not rerun font hinting at a new fractional baseline.
        spriteContext.strokeText(value, Math.round(anchorX * scale) / scale,
          Math.round(cy * scale) / scale);
        spriteContext.fillText(value, Math.round(anchorX * scale) / scale,
          Math.round(cy * scale) / scale);
      });
      if (!sprite) return false;
      const anchorX = style.textAlign === "left" ? padding : sprite.sizeWorld / 2;
      const pixels = sprite.canvas.width * sprite.canvas.height;
      while (records.size >= TEXT_MAX_ENTRIES || totalPixels + pixels > TEXT_MAX_PIXELS) {
        const oldest = records.keys().next().value;
        const previous = records.get(oldest).sprite.canvas;
        totalPixels -= previous.width * previous.height;
        records.delete(oldest);
      }
      record = { sprite, offsetX: Math.round(anchorX * scale) / scale,
        offsetY: Math.round(sprite.sizeWorld / 2 * scale) / scale };
      records.set(key, record);
      totalPixels += pixels;
      context.drawImage(
        sprite.canvas,
        x - record.offsetX,
        y - record.offsetY,
        sprite.worldWidth,
        sprite.worldWidth
      );
      return true;
    }

    return { draw, clear };
  }

  return { createSpriteCache, createTextSpriteCache, resolveDeviceScale };
});
