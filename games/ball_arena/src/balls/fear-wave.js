(function initializeFearWave(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFearWavePlugin({ registerBall }) {
  const WAVE_CYCLE = 1;
  const BURST_START = 0.5;
  const BURST_INTERVAL = 0.1;
  const BURST_COUNT = 5;
  const WAVE_LIFE = 0.6;
  const WAVE_MIN_RADIUS = 15;
  const WAVE_MAX_RADIUS = 60;
  const HIGH_DAMAGE_END = 30;
  const MEDIUM_DAMAGE_END = 45;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function damageAtDistance(contactRadius) {
    if (contactRadius <= HIGH_DAMAGE_END) return 3;
    if (contactRadius <= MEDIUM_DAMAGE_END) return 2;
    return 1;
  }

  function createFearWave(source, options = {}) {
    const hitTargets = new Set();
    return {
      kind: options.kind || "kayoko-fear-wave",
      life: WAVE_LIFE,
      x: source.x,
      y: source.y,
      radius: WAVE_MIN_RADIUS,
      minRadius: WAVE_MIN_RADIUS,
      maxRadius: WAVE_MAX_RADIUS,
      hitTargets,
      update({ effect, services: waveServices }, dt) {
        const previousRadius = effect.radius;
        const progress = clamp((effect.age + Math.max(0, dt)) / effect.life, 0, 1);
        effect.radius = WAVE_MIN_RADIUS + (
          WAVE_MAX_RADIUS - WAVE_MIN_RADIUS
        ) * progress;

        waveServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (effect.hitTargets.has(key)) return;
          const distance = Math.hypot(target.x - effect.x, target.y - effect.y);
          const nearEdge = distance - target.radius;
          const farEdge = distance + target.radius;
          const sweptByRing = (
            farEdge + EPSILON >= previousRadius &&
            nearEdge <= effect.radius + EPSILON &&
            farEdge + EPSILON >= WAVE_MIN_RADIUS
          );
          if (!sweptByRing) return;
          const contactRadius = Math.max(WAVE_MIN_RADIUS, nearEdge);
          if (waveServices.dealDamage(target, damageAtDistance(contactRadius))) {
            effect.hitTargets.add(key);
          }
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const opacity = Math.pow(1 - progress, 1.25);
        context.save();
        context.globalAlpha *= opacity * 0.78;
        context.strokeStyle = "#aeb5ba";
        context.shadowColor = "#d8dde0";
        context.shadowBlur = 5;
        context.lineWidth = Math.max(0.8, 2.4 - progress * 1.4);
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
        context.stroke();
        context.shadowBlur = 0;
        context.globalAlpha *= 0.42;
        context.strokeStyle = "#727b82";
        context.lineWidth = 1;
        context.beginPath();
        context.arc(effect.x, effect.y, Math.max(0, effect.radius - 4), 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }


  return {
    // Qin reuses the established Kayoko wave geometry and damage profile.
    createFearWave
  };
});
