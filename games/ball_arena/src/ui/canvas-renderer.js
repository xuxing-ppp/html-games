(function initializeCanvasRenderer(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("../core/sprite-cache.js") : root.BallBattle);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCanvasRendererApi(dependencies) {
  "use strict";
  const { createTextSpriteCache } = dependencies;

  const HP_FONT = "400 10px 'Ball Impact', Impact, Haettenschweiler, sans-serif";
  const HIT_TEXT_FONT = "400 14px 'Ball Impact', Impact, Haettenschweiler, sans-serif";
  const HP_OUTLINE_COLOR = "rgba(40, 40, 40, 0.78)";
  const HP_OUTLINE_WIDTH = 1;
  const BALL_OUTLINE_WIDTH = 1;
  const DAMAGE_FLASH_BODY_ALPHA = 0.3;
  const DAMAGE_FLASH_RIM_WHITE_GAIN = 2;
  const DAMAGE_FLASH_RIM_WIDTH_PIXELS = 1.6;
  const DAMAGE_FLASH_RIM_MAX_LOGICAL_WIDTH = 0.95;
  const DAMAGE_FLASH_RIM_RADIUS_RATIO = 0.14;
  const STUN_MARKER_COLOR = "#ffe45c";
  const STUN_MARKER_TOP_OFFSET = 17;
  // 连续的锯齿闪电轮廓：尖端、折角和深色描边在缩小后仍可辨识。
  const STUN_MARKER_POINTS = Object.freeze([
    [3, -10], [-6, 2], [-1, 2], [-4, 11], [7, -3], [1, -3]
  ]);
  // 缴械标记：白色小剑 + 红色禁止圈。
  const DISARM_MARKER_COLOR = "#ff3b30";
  const DISARM_MARKER_WIDTH = 12;
  const DISARM_MARKER_HEIGHT = 20;
  const DISARM_MARKER_STROKE = 1.5;
  const DISARM_MARKER_RING_RADIUS = (DISARM_MARKER_WIDTH - DISARM_MARKER_STROKE) / 2;

  function darkenBallColor(color) {
    const match = /^#([0-9a-f]{6})$/i.exec(typeof color === "string" ? color : "");
    if (!match) return "rgba(0, 0, 0, 0.48)";
    const red = Math.round(Number.parseInt(match[1].slice(0, 2), 16) * 0.58);
    const green = Math.round(Number.parseInt(match[1].slice(2, 4), 16) * 0.58);
    const blue = Math.round(Number.parseInt(match[1].slice(4, 6), 16) * 0.58);
    return `rgb(${red}, ${green}, ${blue})`;
  }

  const GPU_VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    out vec2 vTextureCoordinate;

    void main() {
      vTextureCoordinate = vec2((aPosition.x + 1.0) * 0.5, (1.0 - aPosition.y) * 0.5);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const GPU_FRAGMENT_SHADER = `#version 300 es
    precision mediump float;
    uniform sampler2D uTexture;
    in vec2 vTextureCoordinate;
    out vec4 outputColor;

    void main() {
      outputColor = texture(uTexture, vTextureCoordinate);
    }
  `;

  const GPU_PRIMITIVE_VERTEX_SHADER = `#version 300 es
    in vec2 aPosition;
    in vec4 aColor;
    uniform float uArenaSize;
    out vec4 vColor;
    out vec2 vArenaPosition;

    void main() {
      vec2 normalized = aPosition / uArenaSize;
      gl_Position = vec4(
        normalized.x * 2.0 - 1.0,
        1.0 - normalized.y * 2.0,
        0.0,
        1.0
      );
      vColor = aColor;
      vArenaPosition = aPosition;
    }
  `;

  const GPU_PRIMITIVE_FRAGMENT_SHADER = `#version 300 es
    precision mediump float;
    in vec4 vColor;
    in vec2 vArenaPosition;
    uniform vec4 uArenaBounds;
    uniform float uArenaCircle;
    out vec4 outputColor;

    void main() {
      if (vArenaPosition.x < uArenaBounds.x || vArenaPosition.y < uArenaBounds.y ||
          vArenaPosition.x > uArenaBounds.z || vArenaPosition.y > uArenaBounds.w) discard;
      if (uArenaCircle > 0.5 && distance(vArenaPosition, (uArenaBounds.xy + uArenaBounds.zw) * 0.5) >
          (uArenaBounds.z - uArenaBounds.x) * 0.5) discard;
      outputColor = vColor;
    }
  `;

  const GPU_VERTEX_COMPONENTS = 6;
  const GPU_VERTEX_BYTES = GPU_VERTEX_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;
  const GPU_DISC_POINTS = Array.from({ length: 9 }, (_value, index) => {
    const angle = Math.PI * 2 * index / 8;
    return [Math.cos(angle), Math.sin(angle)];
  });

  class GpuPrimitiveBatch {
    constructor(initialCapacity = 32768) {
      this.data = new Float32Array(initialCapacity);
      this.length = 0;
      this.offsetX = 0;
      this.offsetY = 0;
    }

    reset() {
      this.length = 0;
    }

    setOffset(x = 0, y = 0) {
      this.offsetX = Number.isFinite(x) ? x : 0;
      this.offsetY = Number.isFinite(y) ? y : 0;
    }

    ensure(additionalValues) {
      const required = this.length + additionalValues;
      if (required <= this.data.length) return;
      let capacity = this.data.length;
      while (capacity < required) capacity *= 2;
      const next = new Float32Array(capacity);
      next.set(this.data);
      this.data = next;
    }

    addVertex(x, y, red, green, blue, alpha) {
      const offset = this.length;
      this.data[offset] = x + this.offsetX;
      this.data[offset + 1] = y + this.offsetY;
      this.data[offset + 2] = red;
      this.data[offset + 3] = green;
      this.data[offset + 4] = blue;
      this.data[offset + 5] = alpha;
      this.length += GPU_VERTEX_COMPONENTS;
    }

    addLineWithNormal(
      x1,
      y1,
      x2,
      y2,
      width,
      unitNormalX,
      unitNormalY,
      red,
      green,
      blue,
      alpha
    ) {
      const halfWidth = width * 0.5;
      const normalX = unitNormalX * halfWidth;
      const normalY = unitNormalY * halfWidth;
      const ax = x1 + normalX;
      const ay = y1 + normalY;
      const bx = x1 - normalX;
      const by = y1 - normalY;
      const cx = x2 + normalX;
      const cy = y2 + normalY;
      const dx = x2 - normalX;
      const dy = y2 - normalY;
      this.addVertex(ax, ay, red, green, blue, alpha);
      this.addVertex(bx, by, red, green, blue, alpha);
      this.addVertex(cx, cy, red, green, blue, alpha);
      this.addVertex(cx, cy, red, green, blue, alpha);
      this.addVertex(bx, by, red, green, blue, alpha);
      this.addVertex(dx, dy, red, green, blue, alpha);
    }

    addLine(x1, y1, x2, y2, width, red, green, blue, alpha) {
      if (width <= 0 || alpha <= 0) return;
      const deltaX = x2 - x1;
      const deltaY = y2 - y1;
      const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (magnitude <= 1e-6) return;
      this.ensure(GPU_VERTEX_COMPONENTS * 6);
      this.addLineWithNormal(
        x1,
        y1,
        x2,
        y2,
        width,
        -deltaY / magnitude,
        deltaX / magnitude,
        red,
        green,
        blue,
        alpha
      );
    }

    addLinePair(
      x1,
      y1,
      x2,
      y2,
      outerWidth,
      outerAlpha,
      innerWidth,
      innerAlpha,
      red,
      green,
      blue,
      innerRed = red,
      innerGreen = green,
      innerBlue = blue
    ) {
      if ((outerWidth <= 0 || outerAlpha <= 0) &&
          (innerWidth <= 0 || innerAlpha <= 0)) return;
      const deltaX = x2 - x1;
      const deltaY = y2 - y1;
      const magnitude = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (magnitude <= 1e-6) return;
      const unitNormalX = -deltaY / magnitude;
      const unitNormalY = deltaX / magnitude;
      this.ensure(GPU_VERTEX_COMPONENTS * 12);
      if (outerWidth > 0 && outerAlpha > 0) {
        this.addLineWithNormal(
          x1, y1, x2, y2, outerWidth, unitNormalX, unitNormalY,
          red, green, blue, outerAlpha
        );
      }
      if (innerWidth > 0 && innerAlpha > 0) {
        this.addLineWithNormal(
          x1, y1, x2, y2, innerWidth, unitNormalX, unitNormalY,
          innerRed, innerGreen, innerBlue, innerAlpha
        );
      }
    }

    addDisc(centerX, centerY, radius, red, green, blue, alpha) {
      if (radius <= 0 || alpha <= 0) return;
      this.ensure(GPU_VERTEX_COMPONENTS * 8 * 3);
      let previousX = centerX + GPU_DISC_POINTS[0][0] * radius;
      let previousY = centerY + GPU_DISC_POINTS[0][1] * radius;
      for (let index = 1; index < GPU_DISC_POINTS.length; index += 1) {
        const nextX = centerX + GPU_DISC_POINTS[index][0] * radius;
        const nextY = centerY + GPU_DISC_POINTS[index][1] * radius;
        this.addVertex(centerX, centerY, red, green, blue, alpha);
        this.addVertex(previousX, previousY, red, green, blue, alpha);
        this.addVertex(nextX, nextY, red, green, blue, alpha);
        previousX = nextX;
        previousY = nextY;
      }
    }

    get vertexCount() {
      return this.length / GPU_VERTEX_COMPONENTS;
    }
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertexShader || !fragmentShader) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  function createGpuPresenter(canvas, { preserveDrawingBuffer = true } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") return null;

    let gl;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: false,
        antialias: false,
        depth: false,
        powerPreference: "high-performance",
        premultipliedAlpha: false,
        preserveDrawingBuffer,
        stencil: false
      });
    } catch (_error) {
      return null;
    }
    if (
      !gl ||
      typeof gl.createShader !== "function" ||
      typeof gl.createVertexArray !== "function"
    ) {
      return null;
    }

    const program = createProgram(gl, GPU_VERTEX_SHADER, GPU_FRAGMENT_SHADER);
    const primitiveProgram = createProgram(
      gl,
      GPU_PRIMITIVE_VERTEX_SHADER,
      GPU_PRIMITIVE_FRAGMENT_SHADER
    );
    if (!program || !primitiveProgram) return null;

    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    const overlayTexture = gl.createTexture();
    const primitiveVertexArray = gl.createVertexArray();
    const primitiveBuffer = gl.createBuffer();
    if (
      !vertexArray || !vertexBuffer || !texture || !overlayTexture ||
      !primitiveVertexArray || !primitiveBuffer
    ) return null;

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1
      ]),
      gl.STATIC_DRAW
    );
    const positionLocation = gl.getAttribLocation(program, "aPosition");
    if (positionLocation < 0) return null;
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    for (const targetTexture of [texture, overlayTexture]) {
      gl.bindTexture(gl.TEXTURE_2D, targetTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "uTexture"), 0);
    gl.useProgram(null);

    gl.bindVertexArray(primitiveVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, primitiveBuffer);
    const primitivePositionLocation = gl.getAttribLocation(
      primitiveProgram,
      "aPosition"
    );
    const primitiveColorLocation = gl.getAttribLocation(primitiveProgram, "aColor");
    if (primitivePositionLocation < 0 || primitiveColorLocation < 0) return null;
    gl.enableVertexAttribArray(primitivePositionLocation);
    gl.vertexAttribPointer(
      primitivePositionLocation,
      2,
      gl.FLOAT,
      false,
      GPU_VERTEX_BYTES,
      0
    );
    gl.enableVertexAttribArray(primitiveColorLocation);
    gl.vertexAttribPointer(
      primitiveColorLocation,
      4,
      gl.FLOAT,
      false,
      GPU_VERTEX_BYTES,
      2 * Float32Array.BYTES_PER_ELEMENT
    );
    gl.bindVertexArray(null);
    return {
      gl,
      program,
      vertexArray,
      texture,
      overlayTexture,
      primitiveProgram,
      primitiveVertexArray,
      primitiveBuffer,
      primitiveArenaSizeLocation: gl.getUniformLocation(
        primitiveProgram,
        "uArenaSize"
      ),
      primitiveArenaBoundsLocation: gl.getUniformLocation(primitiveProgram, "uArenaBounds"),
      primitiveArenaCircleLocation: gl.getUniformLocation(primitiveProgram, "uArenaCircle"),
      primitiveCapacityBytes: 0,
      width: 0,
      height: 0
    };
  }

  class CanvasRenderer {
    constructor(
      canvas,
      engine,
      {
        renderScale = 4,
        targetPixelSize = null,
        preserveDrawingBuffer = true,
        enableGpu = true,
        teamColors = null
      } = {}
    ) {
      this.canvas = canvas;
      this.engine = engine;
      this.teamColors = teamColors;
      this.defaultRenderScale = renderScale;
      this.targetPixelSize = Number.isFinite(targetPixelSize) && targetPixelSize > 0
        ? Math.round(targetPixelSize)
        : null;
      this.preserveDrawingBuffer = preserveDrawingBuffer !== false;
      this.renderScale = renderScale;
      this.gpu = enableGpu === false
        ? null
        : createGpuPresenter(canvas, {
            preserveDrawingBuffer: this.preserveDrawingBuffer
          });
      this.sourceCanvas = this.gpu && typeof document !== "undefined"
        ? document.createElement("canvas")
        : canvas;
      this.context = this.sourceCanvas && typeof this.sourceCanvas.getContext === "function"
        ? this.sourceCanvas.getContext("2d", {
            alpha: false
          })
        : null;
      if (!this.context) {
        throw new Error("Canvas 2D rendering is unavailable");
      }
      this.gpuBatch = this.gpu ? new GpuPrimitiveBatch() : null;
      this.overlayCanvas = null;
      this.overlayContext = null;
      this.hpTextCache = createTextSpriteCache();
      this.sourceScale = renderScale;
      this.renderBackend = this.gpu ? "webgl2" : "canvas2d";
      if (this.gpu && typeof this.canvas.addEventListener === "function") {
        this.canvas.addEventListener("webglcontextlost", (event) => {
          event.preventDefault();
        });
        this.canvas.addEventListener("webglcontextrestored", () => {
          this.gpu = createGpuPresenter(this.canvas, {
            preserveDrawingBuffer: this.preserveDrawingBuffer
          });
          this.gpuBatch = this.gpu ? new GpuPrimitiveBatch() : null;
          this.renderBackend = this.gpu ? "webgl2" : "unavailable";
          if (this.gpu) this.configureCanvas();
        });
      }
      this.configureCanvas();
    }

    configureCanvas() {
      this.hpTextCache.clear();
      const arenaSize = this.engine.arenaSize;
      const outputPixelSize = this.targetPixelSize || Math.round(
        arenaSize * this.defaultRenderScale
      );
      this.renderScale = outputPixelSize / arenaSize;
      // Rasterize Canvas 2D content at the same resolution as the WebGL target.
      // A lower-resolution intermediate texture makes text and curved bodies
      // permanently soft before the recorder ever sees the frame.
      this.sourceScale = this.renderScale;
      this.canvas.width = outputPixelSize;
      this.canvas.height = outputPixelSize;
      this.sourceCanvas.width = outputPixelSize;
      this.sourceCanvas.height = outputPixelSize;
      this.context.setTransform(this.sourceScale, 0, 0, this.sourceScale, 0, 0);
      this.context.imageSmoothingEnabled = true;
      if (this.overlayCanvas && this.overlayContext) {
        this.overlayCanvas.width = this.engine.arenaSize * this.sourceScale;
        this.overlayCanvas.height = this.engine.arenaSize * this.sourceScale;
        this.overlayContext.setTransform(
          this.sourceScale,
          0,
          0,
          this.sourceScale,
          0,
          0
        );
        this.overlayContext.imageSmoothingEnabled = true;
      }
      if (this.gpu) {
        this.gpu.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gpu.width = this.sourceCanvas.width;
        this.gpu.height = this.sourceCanvas.height;
      }
      this.configuredArenaSize = this.engine.arenaSize;
    }

    draw() {
      if (this.configuredArenaSize !== this.engine.arenaSize) {
        this.configureCanvas();
      }
      const { context } = this;
      const shakeOffset = this.readArenaShakeOffset();
      if (this.gpuBatch) this.gpuBatch.reset();
      if (this.gpuBatch) this.gpuBatch.setOffset(shakeOffset.x, shakeOffset.y);
      context.clearRect(0, 0, this.engine.arenaSize, this.engine.arenaSize);
      context.fillStyle = "#000";
      context.fillRect(0, 0, this.engine.arenaSize, this.engine.arenaSize);
      if (!this.engine.game) {
        this.presentGpuFrame();
        return;
      }
      const {
        balls,
        visualEffects = [],
        combatEntities = [],
        modeEntities = [],
        hitEffects
      } = this.engine.game;
      const arena = this.engine.arena;
      const customOutline = arena && arena.shape !== "square";
      if (customOutline) {
        context.save();
        arena.tracePath(context);
        context.clip();
      }
      const hasShakeOffset = shakeOffset.x !== 0 || shakeOffset.y !== 0;
      const canTranslate = hasShakeOffset &&
        typeof context.save === "function" &&
        typeof context.restore === "function" &&
        typeof context.translate === "function";
      if (canTranslate) {
        context.save();
        context.translate(shakeOffset.x, shakeOffset.y);
      }
      try {
        for (const ball of balls) {
          if (this.isRenderableBall(ball)) {
            this.engine.invokeHook(ball, "drawArenaBackground", null, context);
          }
        }
        for (const effect of visualEffects) {
          if (effect.visualActive !== false && effect.drawLayer === "background") {
            this.engine.invokeVisualEffectHook(effect, "draw", null, context);
          }
        }
        this.drawCombatEntityLayer(combatEntities, context, "background");
        for (const entity of modeEntities) {
          if (entity.drawLayer !== "background") continue;
          if (entity.modeEntityType === "zombie" || entity.modeEntityType === "hell-demon") {
            if (entity.fade > 0) this.drawBall(entity);
          } else if (entity.entityActive !== false && typeof entity.draw === "function") {
            entity.draw({ entity, effect: entity, game: this.engine.game }, context);
          }
        }
        // Anchored summon art can sit below ordinary bodies without changing physics order.
        for (const ball of balls) {
          if (this.isRenderableBall(ball) && ball.definition &&
              ball.definition.drawLayer === "background") this.drawBall(ball);
        }
        for (const ball of balls) {
          if (this.isRenderableBall(ball) && !(ball.definition &&
              ball.definition.drawLayer === "background")) this.drawBall(ball);
        }
        for (const entity of modeEntities) {
          if (entity.drawLayer === "background") continue;
          if (entity.modeEntityType === "zombie" || entity.modeEntityType === "hell-demon") {
            if (entity.fade > 0) this.drawBall(entity);
          } else if (entity.entityActive !== false && typeof entity.draw === "function") {
            entity.draw({ entity, effect: entity, game: this.engine.game }, context);
          }
        }
        for (const ball of balls) {
          if (this.isRenderableBall(ball)) {
            this.engine.invokeHook(ball, "drawArenaForeground", null, context);
          }
        }
        for (const effect of visualEffects) {
          if (effect.visualActive !== false && effect.drawLayer !== "background") {
            if (this.gpuBatch && typeof effect.drawGpu === "function") {
              this.engine.invokeVisualEffectHook(effect, "drawGpu", null, this.gpuBatch);
            } else {
              this.engine.invokeVisualEffectHook(effect, "draw", null, context);
            }
          }
        }
        this.drawCombatEntityLayer(combatEntities, context, "foreground");
        for (const effect of hitEffects) this.drawHitEffect(effect);
      } finally {
        if (canTranslate) context.restore();
        if (customOutline) context.restore();
      }
      if (customOutline) this.drawArenaOutline(context);
      this.presentGpuFrame();
      this.presentGpuPrimitives();
      this.presentGpuForegroundBalls(balls, shakeOffset);
    }

    drawArenaOutline(context) {
      const arena = this.engine.arena;
      if (!arena || arena.shape === "square") return;
      context.save();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2 / this.sourceScale;
      arena.tracePath(context, 1 / this.sourceScale);
      context.stroke();
      context.restore();
    }

    readArenaShakeOffset() {
      if (typeof this.engine.getArenaShakeOffset !== "function") {
        return { x: 0, y: 0 };
      }
      const offset = this.engine.getArenaShakeOffset();
      return {
        x: offset && Number.isFinite(offset.x) ? offset.x : 0,
        y: offset && Number.isFinite(offset.y) ? offset.y : 0
      };
    }

    drawCombatEntityLayer(entities, context, layer) {
      for (let index = 0; index < entities.length; index += 1) {
        const entity = entities[index];
        if (entity.entityActive === false ||
            (entity.drawLayer === "background") !== (layer === "background")) continue;
        if (typeof entity.drawBatch !== "function" ||
            typeof this.engine.invokeCombatEntityHook !== "function") {
          this.drawCombatEntity(entity, context);
          continue;
        }
        // Only combine adjacent compatible entities, preserving source-over
        // ordering relative to every other entity and the body/background layers.
        const batch = [entity];
        while (index + 1 < entities.length) {
          const next = entities[index + 1];
          if (next.entityActive === false || next.drawBatch !== entity.drawBatch ||
              (next.drawLayer === "background") !== (layer === "background")) break;
          batch.push(next);
          index += 1;
        }
        this.engine.invokeCombatEntityHook(entity, "drawBatch", { entities: batch }, context);
      }
    }

    drawCombatEntity(entity, context) {
      if (typeof this.engine.invokeCombatEntityHook === "function") {
        if (this.gpuBatch && typeof entity.drawGpu === "function") {
          this.engine.invokeCombatEntityHook(entity, "drawGpu", null, this.gpuBatch);
        } else {
          this.engine.invokeCombatEntityHook(entity, "draw", null, context);
        }
        return;
      }
      entity.draw({ entity, effect: entity, game: this.engine.game }, context);
    }

    ballRenderOffset(ball) {
      let x = 0;
      let y = 0;
      const behaviorOffset = typeof this.engine.invokeHook === "function"
        ? this.engine.invokeHook(ball, "getRenderOffset")
        : null;
      if (behaviorOffset && typeof behaviorOffset === "object") {
        if (Number.isFinite(behaviorOffset.x)) x += behaviorOffset.x;
        if (Number.isFinite(behaviorOffset.y)) y += behaviorOffset.y;
      }
      // 附着状态可以追加纯绘制位移，让本体、血量数字和附着特效一起移动；
      // 物理位置仍由战斗状态决定，这里只是渲染平移。
      if (ball.effects instanceof Map && ball.effects.size > 0 &&
          typeof this.engine.invokeEffectHook === "function") {
        for (const effect of ball.effects.values()) {
          if (!effect || effect.visualActive === false ||
              typeof effect.getRenderOffset !== "function") continue;
          const offset = this.engine.invokeEffectHook(ball, effect, "getRenderOffset");
          if (!offset || typeof offset !== "object") continue;
          if (Number.isFinite(offset.x)) x += offset.x;
          if (Number.isFinite(offset.y)) y += offset.y;
        }
      }
      return { x, y };
    }

    isRenderableBall(ball) {
      // Historical corpses and reserves retain their effects/identity, but
      // must not walk status maps on every render layer of a long wheel match.
      if (!ball || ball.fade <= 0 ||
          (ball.active === false && !(ball.competitiveState === "defeated" && ball.hp <= 0))) return false;
      if (ball.effects instanceof Map) {
        for (const effect of ball.effects.values()) {
          if (effect.hidesCombatant === true && effect.expiresAt > this.engine.game.time) return false;
        }
      }
      return Boolean(
        ball && ball.fade > 0 &&
        (ball.active !== false || (ball.competitiveState === "defeated" && ball.hp <= 0))
      );
    }

    drawBall(ball) {
      if (!this.isRenderableBall(ball)) return;
      if (
        typeof this.engine.getWallMode === "function" &&
        this.engine.getWallMode(ball) === "wrap"
      ) {
        const arenaSize = this.engine.arenaSize;
        const arena = this.engine.arena;
        if (arena && arena.shape === "circle") {
          this.drawBallAt(ball, 0, 0);
          return;
        }
        const left = arena ? arena.left : 0;
        const top = arena ? arena.top : 0;
        const width = arena ? arena.width : arenaSize;
        const height = arena ? arena.height : arenaSize;
        const offsetX = ball.x - ball.radius < left
          ? width
          : (ball.x + ball.radius > left + width ? -width : 0);
        const offsetY = ball.y - ball.radius < top
          ? height
          : (ball.y + ball.radius > top + height ? -height : 0);
        this.drawBallAt(ball, 0, 0);
        if (offsetY !== 0) this.drawBallAt(ball, 0, offsetY);
        if (offsetX !== 0) this.drawBallAt(ball, offsetX, 0);
        if (offsetX !== 0 && offsetY !== 0) this.drawBallAt(ball, offsetX, offsetY);
        return;
      }
      this.drawBallAt(ball, 0, 0);
    }

    presentGpuFrame() {
      if (!this.gpu) return;
      const { gl, program, vertexArray, texture } = this.gpu;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      // The fullscreen triangle covers every pixel of the opaque target. A
      // separate clear only adds a full-frame GPU pass before the texture is
      // drawn, which is especially costly on mobile tile-based GPUs.
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (this.gpu.uploadedWidth !== this.sourceCanvas.width ||
          this.gpu.uploadedHeight !== this.sourceCanvas.height) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.sourceCanvas
        );
        this.gpu.uploadedWidth = this.sourceCanvas.width;
        this.gpu.uploadedHeight = this.sourceCanvas.height;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.sourceCanvas
        );
      }
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
    }

    presentGpuPrimitives() {
      if (!this.gpu || !this.gpuBatch || this.gpuBatch.vertexCount === 0) return;
      const {
        gl,
        primitiveProgram,
        primitiveVertexArray,
        primitiveBuffer,
        primitiveArenaSizeLocation
      } = this.gpu;
      const requiredBytes = this.gpuBatch.length * Float32Array.BYTES_PER_ELEMENT;
      gl.bindBuffer(gl.ARRAY_BUFFER, primitiveBuffer);
      if (requiredBytes > this.gpu.primitiveCapacityBytes) {
        this.gpu.primitiveCapacityBytes = this.gpuBatch.data.byteLength;
        gl.bufferData(
          gl.ARRAY_BUFFER,
          this.gpu.primitiveCapacityBytes,
          gl.DYNAMIC_DRAW
        );
      }
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.gpuBatch.data,
        0,
        this.gpuBatch.length
      );
      gl.useProgram(primitiveProgram);
      gl.uniform1f(primitiveArenaSizeLocation, this.engine.arenaSize);
      const arena = this.engine.arena;
      gl.uniform4f(this.gpu.primitiveArenaBoundsLocation,
        arena ? arena.left : 0, arena ? arena.top : 0,
        arena ? arena.right : this.engine.arenaSize, arena ? arena.bottom : this.engine.arenaSize);
      gl.uniform1f(this.gpu.primitiveArenaCircleLocation, arena && arena.shape === "circle" ? 1 : 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.bindVertexArray(primitiveVertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, this.gpuBatch.vertexCount);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    ensureOverlayCanvas() {
      if (this.overlayCanvas && this.overlayContext) return true;
      if (!this.gpu || typeof document === "undefined") return false;
      const overlayCanvas = document.createElement("canvas");
      const overlayContext = overlayCanvas.getContext("2d", {
        alpha: true
      });
      if (!overlayContext) return false;
      this.overlayCanvas = overlayCanvas;
      this.overlayContext = overlayContext;
      this.overlayCanvas.width = this.engine.arenaSize * this.sourceScale;
      this.overlayCanvas.height = this.engine.arenaSize * this.sourceScale;
      this.overlayContext.setTransform(
        this.sourceScale,
        0,
        0,
        this.sourceScale,
        0,
        0
      );
      this.overlayContext.imageSmoothingEnabled = true;
      return true;
    }

    presentGpuForegroundBalls(balls, shakeOffset = { x: 0, y: 0 }) {
      if (!this.gpuBatch || this.gpuBatch.vertexCount === 0) return;
      let hasForegroundBall = false;
      for (const ball of balls) {
        if (this.isRenderableBall(ball) && ball.definition.renderAboveGpuEffects === true) {
          hasForegroundBall = true;
          break;
        }
      }
      if (!hasForegroundBall || !this.ensureOverlayCanvas()) return;

      this.overlayContext.clearRect(0, 0, this.engine.arenaSize, this.engine.arenaSize);
      const baseContext = this.context;
      this.context = this.overlayContext;
      const customOutline = this.engine.arena && this.engine.arena.shape !== "square";
      if (customOutline) {
        this.overlayContext.save();
        this.engine.arena.tracePath(this.overlayContext);
        this.overlayContext.clip();
      }
      const hasShakeOffset = shakeOffset.x !== 0 || shakeOffset.y !== 0;
      const canTranslate = hasShakeOffset &&
        typeof this.overlayContext.save === "function" &&
        typeof this.overlayContext.restore === "function" &&
        typeof this.overlayContext.translate === "function";
      try {
        if (canTranslate) {
          this.overlayContext.save();
          this.overlayContext.translate(shakeOffset.x, shakeOffset.y);
        }
        for (const ball of balls) {
          if (this.isRenderableBall(ball) && ball.definition.renderAboveGpuEffects === true) {
            this.drawBall(ball);
          }
        }
      } finally {
        if (canTranslate) this.overlayContext.restore();
        if (customOutline) this.overlayContext.restore();
        this.context = baseContext;
      }
      this.presentGpuOverlay();
    }

    presentGpuOverlay() {
      if (!this.gpu || !this.overlayCanvas) return;
      const { gl, program, vertexArray, overlayTexture } = this.gpu;
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, overlayTexture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (this.gpu.overlayWidth !== this.overlayCanvas.width ||
          this.gpu.overlayHeight !== this.overlayCanvas.height) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.overlayCanvas
        );
        this.gpu.overlayWidth = this.overlayCanvas.width;
        this.gpu.overlayHeight = this.overlayCanvas.height;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.overlayCanvas
        );
      }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(vertexArray);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
    }

    getDiagnostics() {
      return {
        backend: this.renderBackend,
        sourceScale: this.sourceScale,
        outputScale: this.renderScale,
        gpu: Boolean(this.gpu)
      };
    }

    drawBallAt(ball, offsetX = 0, offsetY = 0) {
      const { context } = this;
      // 通用离地位移（例如跳跃类机制）：本体、血量数字与附着特效一起抬起，
      // 地面投影由角色自己在 drawArenaBackground 里画。
      const lift = this.ballRenderOffset(ball);
      context.save();
      if (offsetX !== 0 || offsetY !== 0 || lift.x !== 0 || lift.y !== 0) {
        context.translate(offsetX + lift.x, offsetY + lift.y);
      }
      this.alignBallToOutputPixels(ball);
      context.globalAlpha = ball.fade;
      this.engine.invokeHook(ball, "drawBefore", null, context);
      for (const effect of ball.effects.values()) {
        this.engine.invokeEffectHook(ball, effect, "drawBefore", null, context);
      }
      // An attached status may deform only the body (e.g. tidal stretching);
      // HP text, status markers and drawAfter weapons stay undistorted.
      const deform = this.ballBodyDeform(ball);
      if (deform) {
        context.save();
        this.applyBodyDeform(ball, deform);
      }
      const customBodyDrawn = this.engine.invokeHook(ball, "drawBody", null, context) === true;
      if (!customBodyDrawn) {
        // The dark outline lives on the same layer as the plain monochrome
        // body it belongs to. Custom bodies draw their own art (and their
        // own outline) so the shared ring must not be stamped on top of
        // them.
        this.drawSmoothBall(ball.x, ball.y, ball.radius, ball.color);
        this.drawBallOutline(ball.x, ball.y, ball.radius, ball.color);
      }
      this.drawBallDamageFlash(ball);
      if (deform) context.restore();
      this.drawTeamOutline(ball);
      this.drawBallStatusVisuals(ball);
      const hpDisplay = this.engine.invokeHook(ball, "getHpDisplay") || null;
      if (hpDisplay && hpDisplay.hidden === true) {
        // Tiny targetable combatants can opt out of an unreadable HP label.
      } else if (hpDisplay && Number.isFinite(hpDisplay.shield)) {
        this.drawShieldHpText(Math.ceil(hpDisplay.shield), ball.x, ball.y);
      } else if (hpDisplay && hpDisplay.text !== undefined) {
        this.drawHpText(String(hpDisplay.text), ball.x, ball.y);
      } else {
        this.drawHpText(String(Math.ceil(ball.hp)), ball.x, ball.y);
      }
      for (const effect of ball.effects.values()) {
        this.engine.invokeEffectHook(ball, effect, "draw", null, context);
      }
      this.engine.invokeHook(ball, "drawAfter", null, context);
      context.restore();
    }

    // Effects may return { angle, stretch, squash, shift } from getBodyDeform:
    // stretch/squash scale along/across `angle`, shift moves the body along it.
    // The strongest deformation wins; a neutral or invalid result is ignored.
    ballBodyDeform(ball) {
      if (!(ball.effects instanceof Map) || ball.effects.size === 0) return null;
      let best = null;
      let bestStrength = 0;
      for (const effect of ball.effects.values()) {
        if (!effect || typeof effect.getBodyDeform !== "function") continue;
        const result = this.engine.invokeEffectHook(ball, effect, "getBodyDeform");
        if (!result || typeof result !== "object") continue;
        const stretch = Number.isFinite(result.stretch) ? Math.min(4, Math.max(0.2, result.stretch)) : 1;
        const squash = Number.isFinite(result.squash) ? Math.min(4, Math.max(0.2, result.squash)) : 1;
        const shift = Number.isFinite(result.shift) ? result.shift : 0;
        const angle = Number.isFinite(result.angle) ? result.angle : 0;
        const strength = Math.abs(stretch - 1) + Math.abs(squash - 1) + Math.abs(shift) / Math.max(1, ball.radius);
        if (strength <= 1e-4 || strength <= bestStrength) continue;
        best = { angle, stretch, squash, shift };
        bestStrength = strength;
      }
      return best;
    }

    applyBodyDeform(ball, deform) {
      const { context } = this;
      if (typeof context.translate !== "function" || typeof context.rotate !== "function" ||
          typeof context.scale !== "function") return;
      context.translate(
        ball.x + Math.cos(deform.angle) * deform.shift,
        ball.y + Math.sin(deform.angle) * deform.shift
      );
      context.rotate(deform.angle);
      context.scale(deform.stretch, deform.squash);
      context.rotate(-deform.angle);
      context.translate(-ball.x, -ball.y);
    }

    alignBallToOutputPixels(ball) {
      const { context } = this;
      if (typeof context.getTransform !== "function" ||
          typeof context.translate !== "function") return;
      const matrix = context.getTransform();
      if (!matrix) return;
      const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-10) return;
      const pixelX = matrix.a * ball.x + matrix.c * ball.y + matrix.e;
      const pixelY = matrix.b * ball.x + matrix.d * ball.y + matrix.f;
      const dx = Math.round(pixelX) - pixelX;
      const dy = Math.round(pixelY) - pixelY;
      // Snap the whole drawing group by at most half an output pixel. Keep
      // world positions intact and include arena shake and wrapping offsets.
      context.translate(
        (matrix.d * dx - matrix.c * dy) / determinant,
        (matrix.a * dy - matrix.b * dx) / determinant
      );
    }

    // 阵营环独立于角色本色；召唤物沿用实际归属，混战不虚构红蓝队伍。
    drawTeamOutline(ball) {
      if (!this.teamColors || this.engine.game?.config.mode === "brawl") return;
      const color = this.teamColors[ball.teamId];
      if (!color) return;
      const context = this.context;
      context.save();
      context.beginPath();
      context.arc(ball.x, ball.y, ball.radius + 2.4, 0, Math.PI * 2);
      context.strokeStyle = "rgba(10, 12, 16, 0.9)";
      context.lineWidth = 3.1;
      context.stroke();
      context.strokeStyle = color;
      context.lineWidth = 1.7;
      context.stroke();
      context.restore();
    }

    drawBallStatusVisuals(ball) {
      if (!(ball.effects instanceof Map) || ball.effects.size === 0) return;
      const now = this.engine.game && Number.isFinite(this.engine.game.time)
        ? this.engine.game.time
        : 0;
      let stunned = false;
      let disarmed = false;
      for (const effect of ball.effects.values()) {
        if (!effect) continue;
        if (Number.isFinite(effect.expiresAt) && effect.expiresAt <= now) continue;
        if (effect.visualType === "stun") {
          stunned = true;
          break;
        }
        if (effect.visualType === "disarm") disarmed = true;
      }
      if (stunned) {
        this.drawStunMarker(ball);
        return;
      }
      if (disarmed) this.drawDisarmMarker(ball);
    }

    drawStunMarker(ball) {
      const { context } = this;
      context.save();
      context.translate(Math.round(ball.x), Math.round(ball.y - ball.radius - 12));
      context.fillStyle = STUN_MARKER_COLOR;
      context.strokeStyle = "#3b2b09";
      context.lineWidth = 1.8;
      context.lineJoin = "round";
      context.beginPath();
      STUN_MARKER_POINTS.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
      context.stroke();
      context.fill();
      context.restore();
    }

    drawDisarmMarker(ball) {
      const { context } = this;
      if (typeof context.arc !== "function" || typeof context.beginPath !== "function") return;
      const centerX = ball.x;
      const centerY = ball.y - ball.radius - STUN_MARKER_TOP_OFFSET + DISARM_MARKER_HEIGHT / 2;
      context.save();
      context.lineJoin = "round";
      context.lineCap = "round";

      // 白色小剑：深色描边让它在亮色特效上方也能读出来。
      context.beginPath();
      context.moveTo(centerX, centerY - 8);
      context.lineTo(centerX + 0.95, centerY - 6.4);
      context.lineTo(centerX + 0.95, centerY + 1.2);
      context.lineTo(centerX - 0.95, centerY + 1.2);
      context.lineTo(centerX - 0.95, centerY - 6.4);
      context.closePath();
      context.fillStyle = "#f4f7fa";
      context.strokeStyle = "rgba(14, 18, 22, 0.9)";
      context.lineWidth = 0.9;
      context.fill();
      context.stroke();

      context.beginPath();
      context.moveTo(centerX - 2.5, centerY + 1.9);
      context.lineTo(centerX + 2.5, centerY + 1.9);
      context.strokeStyle = "rgba(14, 18, 22, 0.9)";
      context.lineWidth = 2.2;
      context.stroke();
      context.strokeStyle = "#f4f7fa";
      context.lineWidth = 1.1;
      context.stroke();

      context.beginPath();
      context.moveTo(centerX, centerY + 2.2);
      context.lineTo(centerX, centerY + 4.8);
      context.strokeStyle = "rgba(14, 18, 22, 0.9)";
      context.lineWidth = 1.8;
      context.stroke();
      context.strokeStyle = "#c9d3da";
      context.lineWidth = 0.8;
      context.stroke();

      context.beginPath();
      context.arc(centerX, centerY + 5.1, 1.0, 0, Math.PI * 2);
      context.fillStyle = "rgba(14, 18, 22, 0.9)";
      context.fill();
      context.beginPath();
      context.arc(centerX, centerY + 5.1, 0.55, 0, Math.PI * 2);
      context.fillStyle = "#f4f7fa";
      context.fill();

      // 红色禁止圈 + 斜杠压在小剑上。
      context.lineCap = "butt";
      context.strokeStyle = DISARM_MARKER_COLOR;
      context.lineWidth = DISARM_MARKER_STROKE;
      context.beginPath();
      context.arc(centerX, centerY, DISARM_MARKER_RING_RADIUS, 0, Math.PI * 2);
      context.stroke();
      const slash = DISARM_MARKER_RING_RADIUS / Math.SQRT2;
      context.beginPath();
      context.moveTo(centerX - slash, centerY - slash);
      context.lineTo(centerX + slash, centerY + slash);
      context.stroke();
      context.restore();
    }

    drawBallDamageFlash(ball) {
      if (typeof this.engine.getBallDamageFlashAlpha !== "function") return;
      const alpha = this.engine.getBallDamageFlashAlpha(ball);
      if (!Number.isFinite(alpha) || alpha <= 0) return;
      const { context } = this;
      if (typeof context.arc !== "function") return;
      context.save();
      context.globalCompositeOperation = "lighter";
      context.fillStyle = `rgba(255, 255, 255, ${DAMAGE_FLASH_BODY_ALPHA * alpha})`;
      context.beginPath();
      context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
      context.fill();
      const sourceScale = Number.isFinite(this.sourceScale) && this.sourceScale > 0
        ? this.sourceScale
        : 1;
      const rimWidth = Math.min(
        DAMAGE_FLASH_RIM_MAX_LOGICAL_WIDTH,
        DAMAGE_FLASH_RIM_WIDTH_PIXELS / sourceScale,
        ball.radius * DAMAGE_FLASH_RIM_RADIUS_RATIO
      );
      const rimWhiteAlpha = Math.min(1, DAMAGE_FLASH_RIM_WHITE_GAIN * alpha);
      context.strokeStyle = `rgba(255, 255, 255, ${rimWhiteAlpha})`;
      context.lineWidth = rimWidth;
      context.beginPath();
      context.arc(
        ball.x,
        ball.y,
        Math.max(0, ball.radius - rimWidth / 2),
        0,
        Math.PI * 2
      );
      context.stroke();
      context.restore();
    }

    drawSmoothBall(centerX, centerY, radius, color) {
      const { context } = this;
      context.save();
      context.fillStyle = color;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    drawBallOutline(centerX, centerY, radius, color) {
      const { context } = this;
      if (
        !context ||
        typeof context.beginPath !== "function" ||
        typeof context.arc !== "function" ||
        typeof context.stroke !== "function"
      ) return;
      context.save();
      context.strokeStyle = darkenBallColor(color);
      context.lineWidth = BALL_OUTLINE_WIDTH;
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    drawHitEffect(effect) {
      const progress = effect.age / effect.life;
      this.context.save();
      this.context.globalAlpha = 1 - progress;
      this.context.font = HIT_TEXT_FONT;
      this.context.textAlign = "center";
      this.context.textBaseline = "middle";
      this.context.fillStyle = effect.color || "#ff2020";
      this.context.fillText(String(effect.text), Math.round(effect.x), Math.round(effect.y));
      this.context.restore();
    }

    getHpTextY(y) {
      return y;
    }

    drawHpText(text, x, y) {
      const { context } = this;
      const hpY = this.getHpTextY(y);
      context.save();
      context.font = HP_FONT;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.lineWidth = HP_OUTLINE_WIDTH;
      context.strokeStyle = HP_OUTLINE_COLOR;
      context.fillStyle = "#ffffff";
      if (!this.hpTextCache.draw(context, text, x, hpY, this.sourceScale)) {
        context.strokeText(String(text), x, hpY);
        context.fillText(String(text), x, hpY);
      }
      context.restore();
    }

    drawShieldHpText(value, x, y) {
      const { context } = this;
      const shieldX = x - 7;
      const shieldY = this.getHpTextY(y - 6);
      const hpY = this.getHpTextY(y);
      context.save();
      context.lineJoin = "round";
      context.lineWidth = 1.5;
      context.strokeStyle = "#d5f5ff";
      context.fillStyle = "#68c9ed";
      context.beginPath();
      context.moveTo(shieldX, shieldY - 3);
      context.lineTo(shieldX + 5, shieldY - 1);
      context.lineTo(shieldX + 4, shieldY + 5);
      context.lineTo(shieldX, shieldY + 8);
      context.lineTo(shieldX - 4, shieldY + 5);
      context.lineTo(shieldX - 5, shieldY - 1);
      context.closePath();
      context.fill();
      context.stroke();
      context.font = HP_FONT;
      context.textAlign = "left";
      context.textBaseline = "middle";
      context.lineWidth = HP_OUTLINE_WIDTH;
      context.strokeStyle = HP_OUTLINE_COLOR;
      context.fillStyle = "#ffffff";
      if (!this.hpTextCache.draw(context, value, x + 1, hpY, this.sourceScale)) {
        context.strokeText(String(value), x + 1, hpY);
        context.fillText(String(value), x + 1, hpY);
      }
      context.restore();
    }
  }

  return { CanvasRenderer };
});
