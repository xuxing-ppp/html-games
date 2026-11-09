(function initializeSlashTool(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSlashToolPlugin({ registerBall }) {
  const VISIBLE_DURATION = 3;
  const STEALTH_DURATION = 2.25;
  const STEALTH_SPEED_MULTIPLIER = 4;
  const OVERLAP_INTERVAL = 0.04;
  const TIME_EPSILON = 1e-9;
  const STEALTH_ALPHA = 0.28;
  // 隐身冲刺期间（4 倍速）挂残影拖尾：峰值透明度 30%、视觉宽度 2/3。
  const TRAIL_KIND = "hermit-trail";
  const TRAIL_MAX_ALPHA = 0.3;
  const TRAIL_WIDTH_RATIO = 2 / 3;
  const SLASH_DURATION = 0.19;
  const ARENA_EFFECT_LIFE = 0.36;
  const FRAGMENT_COUNT = 6;
  // 接触档案每步都会被引擎查一次，返回固定对象而不是每次新建字面量。
  const STEALTH_CONTACT_PROFILE = Object.freeze({ solid: false, attackable: false });
  const VISIBLE_CONTACT_PROFILE = Object.freeze({ solid: true, attackable: true });
  const WHITE_SLASH_PALETTE = Object.freeze({
    transparent: "rgba(255, 255, 255, 0)",
    dim: "rgba(235, 238, 244, 0.45)",
    core: "rgba(255, 255, 255, 1)",
    bright: "rgba(255, 255, 255, 0.68)",
    edge: "#fff",
    residual: "#cfd3da"
  });

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(from, to, progress) {
    return from + (to - from) * progress;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  function drawSlash(canvasContext, effect) {
    const progress = clamp(effect.age / SLASH_DURATION, 0, 1);
    if (progress >= 1) return;

    const headProgress = easeOutCubic(clamp(progress / 0.34, 0, 1));
    const tailProgress = easeInCubic(clamp((progress - 0.1) / 0.82, 0, 1));
    const tailX = mix(effect.startX, effect.endX, tailProgress);
    const tailY = mix(effect.startY, effect.endY, tailProgress);
    const headX = mix(effect.startX, effect.endX, headProgress);
    const headY = mix(effect.startY, effect.endY, headProgress);
    const middleX = mix(tailX, headX, 0.58);
    const middleY = mix(tailY, headY, 0.58);
    const length = Math.hypot(headX - tailX, headY - tailY);
    const bladeWidth = 2.3 * clamp(length / 24, 0, 1);
    const fade = progress < 0.68 ? 1 : 1 - (progress - 0.68) / 0.32;
    const alpha = clamp(progress / 0.05, 0, 1) * Math.max(0, fade);
    const gradient = canvasContext.createLinearGradient(tailX, tailY, headX, headY);
    gradient.addColorStop(0, effect.slashPalette.transparent);
    gradient.addColorStop(0.2, effect.slashPalette.dim);
    gradient.addColorStop(0.64, effect.slashPalette.core);
    gradient.addColorStop(0.92, effect.slashPalette.bright);
    gradient.addColorStop(1, effect.slashPalette.transparent);

    canvasContext.save();
    canvasContext.globalAlpha = alpha;
    canvasContext.fillStyle = gradient;
    canvasContext.beginPath();
    canvasContext.moveTo(tailX, tailY);
    canvasContext.lineTo(
      middleX + effect.normalX * bladeWidth,
      middleY + effect.normalY * bladeWidth
    );
    canvasContext.lineTo(headX, headY);
    canvasContext.lineTo(
      middleX - effect.normalX * bladeWidth * 0.48,
      middleY - effect.normalY * bladeWidth * 0.48
    );
    canvasContext.closePath();
    canvasContext.fill();

    canvasContext.globalAlpha = alpha * 0.66;
    canvasContext.strokeStyle = effect.slashPalette.edge;
    canvasContext.lineWidth = 0.55;
    canvasContext.lineCap = "butt";
    canvasContext.beginPath();
    canvasContext.moveTo(tailX, tailY);
    canvasContext.lineTo(headX, headY);
    canvasContext.stroke();

    if (headProgress > 0.8) {
      const residualAlpha = Math.max(0, (1 - progress) * 0.2);
      canvasContext.globalAlpha = residualAlpha;
      canvasContext.strokeStyle = effect.slashPalette.residual;
      canvasContext.lineWidth = 0.45;
      canvasContext.beginPath();
      canvasContext.moveTo(
        effect.startX + effect.normalX * 2.8,
        effect.startY + effect.normalY * 2.8
      );
      canvasContext.lineTo(
        effect.endX + effect.normalX * 2.8,
        effect.endY + effect.normalY * 2.8
      );
      canvasContext.stroke();

      canvasContext.globalAlpha = residualAlpha * 0.55;
      canvasContext.beginPath();
      canvasContext.moveTo(
        mix(effect.startX, effect.endX, 0.18) - effect.normalX * 2.2,
        mix(effect.startY, effect.endY, 0.18) - effect.normalY * 2.2
      );
      canvasContext.lineTo(
        mix(effect.startX, effect.endX, 0.76) - effect.normalX * 2.2,
        mix(effect.startY, effect.endY, 0.76) - effect.normalY * 2.2
      );
      canvasContext.stroke();
    }
    canvasContext.restore();
  }

  function drawFragments(canvasContext, effect) {
    canvasContext.save();
    canvasContext.fillStyle = effect.targetColor;
    effect.fragments.forEach((fragment) => {
      const progress = effect.age / fragment.life;
      if (progress >= 1) return;
      canvasContext.globalAlpha = progress < 0.72
        ? 1
        : 1 - (progress - 0.72) / 0.28;
      canvasContext.fillRect(
        Math.round(fragment.x),
        Math.round(fragment.y),
        fragment.size,
        fragment.size
      );
    });
    canvasContext.restore();
  }

  function createSlashEffect(target, options = {}) {
    const random = typeof options.random === "function" ? options.random : Math.random;
    const angle = Number.isFinite(options.angle)
      ? options.angle
      : random() * Math.PI;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const normalX = -directionY;
    const normalY = directionX;
    const centerX = target.x + normalX * (random() - 0.5) * 7;
    const centerY = target.y + normalY * (random() - 0.5) * 7;
    const fragments = Array.from({ length: FRAGMENT_COUNT }, (_, index) => {
      const side = index < FRAGMENT_COUNT / 2 ? -1 : 1;
      const along = (random() - 0.5) * 34;
      const speed = 44 + random() * 62;
      return {
        x: centerX + directionX * along,
        y: centerY + directionY * along,
        vx: normalX * side * speed + directionX * (random() - 0.5) * 22,
        vy: normalY * side * speed + directionY * (random() - 0.5) * 22,
        size: random() < 0.68 ? 2 : 3,
        life: 0.25 + random() * 0.11
      };
    });

    return {
      kind: options.kind || "hermit-slash",
      life: ARENA_EFFECT_LIFE,
      targetColor: options.fragmentColor || target.color,
      slashPalette: options.slashPalette || WHITE_SLASH_PALETTE,
      fragments,
      startX: centerX - directionX * 30,
      startY: centerY - directionY * 30,
      endX: centerX + directionX * 30,
      endY: centerY + directionY * 30,
      normalX,
      normalY,
      update({ effect }, dt) {
        effect.fragments.forEach((fragment) => {
          fragment.x += fragment.vx * dt;
          fragment.y += fragment.vy * dt;
        });
      },
      draw({ effect }, canvasContext) {
        drawSlash(canvasContext, effect);
        drawFragments(canvasContext, effect);
      }
    };
  }


  return {
    createSlashEffect,
    WHITE_SLASH_PALETTE
  };
});
