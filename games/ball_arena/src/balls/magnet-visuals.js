(function initializeMagnetVisuals(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/particle-burst.js") : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMagnetVisuals({ createParticleBurst }) {
  const TAU = Math.PI * 2;
  const BLUE = "#2673fb";
  const RED = "#ed3035";

  function polygon(context, points, color) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index][0], points[index][1]);
    }
    context.closePath();
    context.fill();
  }

  function magnetDrawMagnet({ entity }, context) {
    const halfLength = entity.length / 2;
    const halfWidth = entity.width / 2;
    const skew = entity.width * 0.32;
    const side = entity.width * 0.22;
    const throwProgress = entity.phase === "throw" ? entity.throwProgress : 1;
    context.save();
    context.translate(entity.x, entity.y - 32 * throwProgress * (1 - throwProgress));
    const scale = 0.7 + throwProgress * 0.3;
    context.scale(scale, scale);
    context.rotate(entity.angle);
    // Two flat pole colors and a narrow dark side, matching the reference bar.
    polygon(context, [
      [-halfLength, -halfWidth], [-skew / 2, -halfWidth],
      [skew / 2, halfWidth], [-halfLength + skew, halfWidth]
    ], BLUE);
    polygon(context, [
      [-skew / 2, -halfWidth], [halfLength - skew, -halfWidth],
      [halfLength, halfWidth], [skew / 2, halfWidth]
    ], RED);
    polygon(context, [
      [-halfLength + skew, halfWidth - side], [skew / 2, halfWidth - side],
      [skew / 2, halfWidth], [-halfLength + skew, halfWidth]
    ], "#154dc3");
    polygon(context, [
      [skew / 2, halfWidth - side], [halfLength - side * 0.35, halfWidth - side],
      [halfLength, halfWidth], [skew / 2, halfWidth]
    ], "#b7202c");
    if (entity.pair) {
      context.globalAlpha *= 0.32;
      context.strokeStyle = "#eeeeee";
      context.lineWidth = 0.7;
      context.beginPath();
      context.arc(0, 0, 3, 0, TAU);
      context.stroke();
    }
    context.restore();
  }

  function magnetCreateExplosion(x, y) {
    let seed = (Math.round(x * 1024) ^ Math.round(y * 4096) ^ 0x59d1) >>> 0;
    return createParticleBurst({
      kind: "magnet-explosion",
      x,
      y,
      count: 96,
      colors: ["#ffffff", "#eeeeee", "#dddddd"],
      minDiameter: 1.4,
      maxDiameter: 8,
      initialRadius: 4.5,
      minSpeed: 35,
      maxSpeed: 210,
      life: 1.05,
      drag: 1.9,
      random() {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      }
    });
  }

  return { magnetDrawMagnet, magnetCreateExplosion };
});
