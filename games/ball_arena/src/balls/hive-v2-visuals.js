(function initializeHiveV2Visuals(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createHiveV2Visuals() {
  // Interior samples from the keeper and hive reference images.
  const HIVE_V2_VISUAL_COLORS = Object.freeze({
    body: "#f2d984",
    hat: "#828388",
    brim: "#97989a",
    band: "#1e2223",
    hive: "#da8a27",
    hiveShade: "#bf7420",
    hiveHighlight: "#edae59",
    hiveRib: "#723600",
    bee: "#cf9b56",
    beeStripe: "#371700",
    wing: "#a8cbdc"
  });

  function drawHiveV2Body({ ball }, ctx) {
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.scale(ball.radius / 15, ball.radius / 15);

    // The mesh hangs behind the plain yellow ball, leaving its HP unobscured.
    ctx.beginPath();
    ctx.moveTo(-15.7, -8.1);
    ctx.bezierCurveTo(-16.5, -1, -15.2, 8.1, -16.4, 11.1);
    ctx.quadraticCurveTo(-17.1, 12.4, -15.2, 12.8);
    ctx.quadraticCurveTo(0, 16.3, 16.2, 12.5);
    ctx.quadraticCurveTo(17, 12, 16.1, 10.9);
    ctx.bezierCurveTo(15.2, 6.6, 16.5, -1.2, 16.4, -7.6);
    ctx.closePath();
    ctx.fillStyle = "rgba(133, 139, 133, 0.21)";
    ctx.strokeStyle = "rgba(154, 157, 147, 0.4)";
    ctx.lineWidth = 0.38;
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = "rgba(125, 133, 121, 0.34)";
    ctx.lineWidth = 0.16;
    ctx.beginPath();
    for (let x = -18; x <= 18; x += 1.8) {
      ctx.moveTo(x, -9);
      ctx.lineTo(x + 3, 16);
      ctx.moveTo(x + 3, -9);
      ctx.lineTo(x, 16);
    }
    for (let y = -7; y <= 16; y += 1.8) {
      ctx.moveTo(-18, y);
      ctx.quadraticCurveTo(0, y + 2.4, 18, y);
    }
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = "rgba(151, 154, 153, 0.72)";
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(19.5, -6.6);
    ctx.bezierCurveTo(20.9, -2.1, 19.9, -0.2, 18.9, 3.1);
    ctx.bezierCurveTo(18.1, 6.4, 20.3, 8.8, 22.5, 8.5);
    ctx.bezierCurveTo(24, 8.4, 22.5, 4.9, 22.1, 2.7);
    ctx.bezierCurveTo(21.6, -0.6, 21.4, -4.4, 19.5, -6.6);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 15, 0, Math.PI * 2);
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.body;
    ctx.strokeStyle = "#6e6234";
    ctx.lineWidth = 0.55;
    ctx.fill();
    ctx.stroke();

    // Crown, broad curved brim and dark hatband follow the measured silhouette.
    ctx.beginPath();
    ctx.moveTo(-11.6, -11.7);
    ctx.bezierCurveTo(-11.1, -15.5, -9.7, -21.9, -8.2, -24);
    ctx.quadraticCurveTo(-7.6, -25, -4.4, -25);
    ctx.lineTo(5.6, -24.7);
    ctx.quadraticCurveTo(7.6, -24.7, 8, -22.8);
    ctx.bezierCurveTo(8.6, -19.2, 10, -16.3, 9.8, -11.3);
    ctx.closePath();
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.hat;
    ctx.strokeStyle = "#a7a8a9";
    ctx.lineWidth = 0.35;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-22, -12);
    ctx.bezierCurveTo(-18.7, -13.5, -18.6, -10.9, -12.9, -11.9);
    ctx.bezierCurveTo(-7.5, -12.8, 2.7, -12.4, 9.1, -11.2);
    ctx.bezierCurveTo(13.1, -9.4, 18.3, -8.7, 20.3, -6.9);
    ctx.quadraticCurveTo(21.2, -5.9, 19.6, -6.3);
    ctx.bezierCurveTo(13.6, -7.8, 11.3, -6.1, 6.6, -7.2);
    ctx.bezierCurveTo(-0.9, -8.9, -4.5, -8.6, -9.3, -7.8);
    ctx.bezierCurveTo(-15, -6.9, -20.1, -7.4, -22.1, -8.8);
    ctx.quadraticCurveTo(-23.8, -10.2, -22, -12);
    ctx.closePath();
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.brim;
    ctx.strokeStyle = "#c0c1be";
    ctx.lineWidth = 0.4;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-13.1, -12);
    ctx.quadraticCurveTo(-2, -12.5, 10.6, -11.5);
    ctx.lineTo(10.6, -10.7);
    ctx.quadraticCurveTo(-1.4, -11.9, -13.1, -11.5);
    ctx.closePath();
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.band;
    ctx.fill();
    ctx.restore();
    return true;
  }

  function drawHiveBand(ctx, width, y, height, color) {
    ctx.beginPath();
    ctx.ellipse(0, y, width, height, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.strokeStyle = HIVE_V2_VISUAL_COLORS.hiveRib;
    ctx.lineWidth = 0.34;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-width * 0.83, y - height * 0.48);
    ctx.quadraticCurveTo(0, y - height * 1.17, width * 0.8, y - height * 0.44);
    ctx.strokeStyle = HIVE_V2_VISUAL_COLORS.hiveHighlight;
    ctx.lineWidth = 0.38;
    ctx.stroke();
  }

  function drawHiveV2Nest({ x, y, radius = 10, scale = 1, opacity = 1 }, ctx) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radius / 10 * scale, radius / 10 * scale);
    ctx.globalAlpha *= opacity;
    drawHiveBand(ctx, 4.1, -10.7, 2.3, HIVE_V2_VISUAL_COLORS.hive);
    drawHiveBand(ctx, 6.7, -7.4, 2.8, HIVE_V2_VISUAL_COLORS.hive);
    drawHiveBand(ctx, 8.7, -3.5, 3.2, HIVE_V2_VISUAL_COLORS.hive);
    drawHiveBand(ctx, 10, 0.8, 3.5, HIVE_V2_VISUAL_COLORS.hive);
    drawHiveBand(ctx, 9.3, 5.2, 3.3, HIVE_V2_VISUAL_COLORS.hiveShade);
    drawHiveBand(ctx, 7.5, 8.7, 2.9, HIVE_V2_VISUAL_COLORS.hive);
    drawHiveBand(ctx, 4.8, 11, 2, HIVE_V2_VISUAL_COLORS.hiveShade);
    ctx.beginPath();
    ctx.ellipse(0.3, 3.6, 3.4, 5.3, 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "#070605";
    ctx.strokeStyle = "#663708";
    ctx.lineWidth = 0.65;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawHiveV2Aura({ x, y, auraRadius = 50, phase = 0 }, ctx) {
    ctx.save();
    ctx.globalAlpha *= 0.94 + Math.sin(phase) * 0.06;
    const haze = ctx.createRadialGradient(x, y, auraRadius * 0.45, x, y, auraRadius);
    haze.addColorStop(0, "rgba(184, 164, 121, 0.015)");
    haze.addColorStop(0.8, "rgba(184, 164, 121, 0.025)");
    haze.addColorStop(0.94, "rgba(184, 164, 121, 0.085)");
    haze.addColorStop(1, "rgba(184, 164, 121, 0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(x, y, auraRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawHiveV2Bee({ x, y, angle = 0, age = 0, scale = 1 }, ctx) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    const flap = 0.74 + Math.abs(Math.sin(age * 58)) * 0.36;
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.wing;
    ctx.globalAlpha *= 0.86;
    ctx.beginPath();
    ctx.ellipse(-1.1, -1.5, 1.65, 0.85 * flap, -0.4, 0, Math.PI * 2);
    ctx.ellipse(0.5, -1.7, 1.45, 0.8 * flap, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha /= 0.86;

    ctx.beginPath();
    ctx.ellipse(-0.3, 0, 3, 1.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.bee;
    ctx.strokeStyle = "#563515";
    ctx.lineWidth = 0.27;
    ctx.fill();
    ctx.stroke();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = HIVE_V2_VISUAL_COLORS.beeStripe;
    ctx.fillRect(-2.2, -2, 0.7, 4);
    ctx.fillRect(-0.7, -2, 0.75, 4);
    ctx.fillRect(0.9, -2, 0.7, 4);
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(2.7, 0, 1.05, 1.15, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#77553b";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3.03, -0.4, 0.23, 0, Math.PI * 2);
    ctx.fillStyle = "#16110a";
    ctx.fill();
    ctx.strokeStyle = "#cfc9aa";
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(3.1, -0.9);
    ctx.lineTo(3.8, -1.35);
    ctx.moveTo(3.5, 0.4);
    ctx.lineTo(4.1, 0.65);
    ctx.stroke();
    ctx.restore();
  }

  return {
    HIVE_V2_VISUAL_COLORS,
    drawHiveV2Body,
    drawHiveV2Nest,
    drawHiveV2Aura,
    drawHiveV2Bee
  };
});
