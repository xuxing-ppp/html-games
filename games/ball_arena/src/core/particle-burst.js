(function initializeParticleBurst(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? require("./visual-properties.js") : root.BallBattle);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createParticleBurstApi(dependencies) {
  "use strict";
  const { createVisualPropertyAnimation } = dependencies;

  const DEFAULT_PARTICLE_COUNT = 28;
  const DEFAULT_MIN_DIAMETER = 1;
  const DEFAULT_MAX_DIAMETER = 5;
  const DEFAULT_MIN_SPEED = 28;
  const DEFAULT_MAX_SPEED = 92;
  const DEFAULT_LIFE = 0.65;
  const DEFAULT_DRAG = 2.4;
  const DEFAULT_SHAPE = "circle";
  const DEFAULT_DIRECTION_SPREAD = Math.PI * 2;
  const TWO_PI = Math.PI * 2;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finiteOr(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function normalizeColors(colors) {
    const source = Array.isArray(colors) ? colors : [colors];
    const normalized = source.filter((color) => typeof color === "string" && color);
    return normalized.length > 0 ? normalized : ["#ffffff"];
  }

  function normalizeShape(value) {
    const shape = String(value === undefined ? DEFAULT_SHAPE : value).toLowerCase();
    if (shape === "rect" || shape === "rectangle" || shape === "square") return "rect";
    if (shape === "ellipse" || shape === "oval") return "ellipse";
    return "circle";
  }

  function particleDiameter(index, random, minimum, maximum) {
    if (index === 0) return minimum;
    if (index === 1) return maximum;
    return minimum + random() * (maximum - minimum);
  }

  function createParticleBurst(options = {}) {
    // Legacy options are adapters only; all animation evaluation lives in the shared sampler.
    const animation = createVisualPropertyAnimation({
      color: { type: "color" },
      opacity: { type: "number", default: 1, min: 0, max: 1 },
      sizeScale: { type: "number", default: 1, min: 0 }
    }, {
      label: "particle-burst",
      defaultProperties: {
        color: { overLife: options.colorOverLife },
        opacity: {
          value: options.opacity,
          overLife: options.opacityOverLife === undefined
            ? [{ at: 0, value: 1 }, { at: 1, value: 0 }] : options.opacityOverLife,
          combine: "multiply"
        }
      },
      properties: options.properties,
      metadata: options.metadata,
      mapProperties: options.mapAppearance,
      followMetadata: options.followMetadata
    });
    const random = typeof options.random === "function" ? options.random : Math.random;
    const x = finiteOr(options.x, 0);
    const y = finiteOr(options.y, 0);
    const life = Math.max(0.05, finiteOr(options.life, DEFAULT_LIFE));
    const count = Math.max(2, Math.round(finiteOr(
      options.count,
      DEFAULT_PARTICLE_COUNT * Math.max(0.1, finiteOr(options.density, 1))
    )));
    const minimumDiameter = Math.max(0.5, finiteOr(
      options.minDiameter,
      DEFAULT_MIN_DIAMETER
    ));
    const maximumDiameter = Math.max(
      minimumDiameter,
      finiteOr(options.maxDiameter, DEFAULT_MAX_DIAMETER)
    );
    const minimumSpeed = Math.max(0, finiteOr(options.minSpeed, DEFAULT_MIN_SPEED));
    const maximumSpeed = Math.max(
      minimumSpeed,
      finiteOr(options.maxSpeed, DEFAULT_MAX_SPEED)
    );
    const colors = normalizeColors(options.colors || options.color);
    const initialRadius = Math.max(0, finiteOr(options.initialRadius, 2));
    const shape = normalizeShape(options.shape);
    const minimumLength = Math.max(0.5, finiteOr(options.minLength, minimumDiameter));
    const maximumLength = Math.max(
      minimumLength,
      finiteOr(options.maxLength, maximumDiameter)
    );
    const minimumWidth = Math.max(0.25, finiteOr(options.minWidth, minimumLength));
    const maximumWidth = Math.max(
      minimumWidth,
      finiteOr(options.maxWidth, maximumLength)
    );

    let minimumRotationSpeed = 0;
    let maximumRotationSpeed = 0;
    if (
      Number.isFinite(options.minRotationSpeed) ||
      Number.isFinite(options.maxRotationSpeed)
    ) {
      minimumRotationSpeed = Math.max(0, finiteOr(options.minRotationSpeed, 0));
      maximumRotationSpeed = Math.max(
        minimumRotationSpeed,
        finiteOr(options.maxRotationSpeed, minimumRotationSpeed)
      );
    } else if (Number.isFinite(options.rotationSpeed)) {
      minimumRotationSpeed = Math.max(0, options.rotationSpeed);
      maximumRotationSpeed = minimumRotationSpeed;
    }

    const directionAngle = Number.isFinite(options.directionAngle)
      ? options.directionAngle
      : null;
    const directionSpread = clamp(
      finiteOr(options.directionSpread, DEFAULT_DIRECTION_SPREAD),
      0,
      TWO_PI
    );

    function sampleDirection() {
      if (directionAngle === null || directionSpread + EPSILON >= TWO_PI) {
        return random() * TWO_PI;
      }
      return directionAngle + (random() - 0.5) * directionSpread;
    }

    const particles = Array.from({ length: count }, (_, index) => {
      const diameter = particleDiameter(
        index,
        random,
        minimumDiameter,
        maximumDiameter
      );
      const sizeProgress = maximumDiameter === minimumDiameter
        ? 0
        : (diameter - minimumDiameter) / (maximumDiameter - minimumDiameter);
      const length = minimumLength +
        (maximumLength - minimumLength) * sizeProgress;
      const width = minimumWidth +
        (maximumWidth - minimumWidth) * sizeProgress;
      const speed = maximumSpeed + (minimumSpeed - maximumSpeed) * sizeProgress;
      const positionAngle = random() * TWO_PI;
      const positionDistance = random() * initialRadius;
      const angle = sampleDirection();
      const rotation = Number.isFinite(options.initialRotation)
        ? options.initialRotation
        : random() * TWO_PI;
      const rotationSpeed = minimumRotationSpeed +
        random() * (maximumRotationSpeed - minimumRotationSpeed);
      return {
        x: x + Math.cos(positionAngle) * positionDistance,
        y: y + Math.sin(positionAngle) * positionDistance,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        diameter,
        speed,
        color: colors[index % colors.length],
        shape,
        length,
        width,
        rotation,
        rotationSpeed
      };
    });
    const ring = options.ring && typeof options.ring === "object"
      ? {
          color: options.ring.color || "#ffffff",
          lineWidth: Math.max(0.5, finiteOr(options.ring.lineWidth, 2)),
          startRadius: Math.max(0, finiteOr(options.ring.startRadius, 8)),
          endRadius: Math.max(0, finiteOr(options.ring.endRadius, 36))
        }
      : null;

    return {
      kind: options.kind || "particle-burst",
      life,
      x,
      y,
      particles,
      ring,
      drag: Math.max(0, finiteOr(options.drag, DEFAULT_DRAG)),
      gravityX: finiteOr(options.gravityX, 0),
      gravityY: finiteOr(options.gravityY, 0),
      update({ effect }, dt) {
        animation.updateMetadata();
        const elapsed = Math.max(0, dt);
        const drag = Math.exp(-effect.drag * elapsed);
        effect.particles.forEach((particle) => {
          particle.vx += effect.gravityX * elapsed;
          particle.vy += effect.gravityY * elapsed;
          particle.x += particle.vx * elapsed;
          particle.y += particle.vy * elapsed;
          particle.vx *= drag;
          particle.vy *= drag;
          particle.rotation += particle.rotationSpeed * elapsed;
        });
      },
      draw({ effect }, context) {
        const progress = clamp((effect.age || 0) / effect.life, 0, 1);
        const appearance = animation.sample(progress);
        const particleColor = appearance.color;
        const sizeScale = appearance.sizeScale;
        context.save();
        context.globalAlpha *= appearance.opacity;
        if (effect.ring) {
          context.strokeStyle = effect.ring.color;
          context.lineWidth = effect.ring.lineWidth;
          context.beginPath();
          context.arc(
            effect.x,
            effect.y,
            effect.ring.startRadius +
              (effect.ring.endRadius - effect.ring.startRadius) * progress,
            0,
            TWO_PI
          );
          context.stroke();
        }
        effect.particles.forEach((particle) => {
          if (sizeScale === 0) return;
          // Circles are the common path for gameplay bursts. Keep them in
          // world coordinates to avoid a save/translate/restore trip per
          // particle on Canvas-backed WebGL frames.
          if (particle.shape === "circle") {
            context.fillStyle = particleColor || particle.color;
            context.beginPath();
            context.arc(
              particle.x,
              particle.y,
              particle.diameter * 0.5 * sizeScale,
              0,
              TWO_PI
            );
            context.fill();
            return;
          }
          context.save();
          context.translate(Math.round(particle.x), Math.round(particle.y));
          if (sizeScale !== 1) context.scale(sizeScale, sizeScale);
          context.fillStyle = particleColor || particle.color;
          if (particle.shape === "rect") {
            context.rotate(particle.rotation);
            context.fillRect(
              -particle.length / 2,
              -particle.width / 2,
              particle.length,
              particle.width
            );
          } else if (particle.shape === "ellipse") {
            context.rotate(particle.rotation);
            const baseRadius = Math.max(0.5, particle.diameter * 0.5);
            context.scale(
              particle.length / (particle.diameter || 1),
              particle.width / (particle.diameter || 1)
            );
            context.beginPath();
            context.arc(0, 0, baseRadius, 0, TWO_PI);
            context.fill();
          } else {
            context.beginPath();
            context.arc(0, 0, particle.diameter * 0.5, 0, TWO_PI);
            context.fill();
          }
          context.restore();
        });
        context.restore();
      }
    };
  }

  return {
    createParticleBurst,
    PARTICLE_BURST_DEFAULTS: Object.freeze({
      count: DEFAULT_PARTICLE_COUNT,
      minDiameter: DEFAULT_MIN_DIAMETER,
      maxDiameter: DEFAULT_MAX_DIAMETER,
      minSpeed: DEFAULT_MIN_SPEED,
      maxSpeed: DEFAULT_MAX_SPEED,
      life: DEFAULT_LIFE,
      shape: DEFAULT_SHAPE,
      directionSpread: DEFAULT_DIRECTION_SPREAD
    })
  };
});
