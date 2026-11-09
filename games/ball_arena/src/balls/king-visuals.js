(function initializeKingVisuals(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/particle-burst.js") : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createKingVisuals({ createParticleBurst }) {
  // 木盾配色：深棕为轮廓与板缝，中棕为板面，浅棕为板芯高光。
  const SHIELD_WOOD = "#8a5a2b";
  const SHIELD_WOOD_DARK = "#4f3116";
  const SHIELD_WOOD_LIGHT = "#b57f45";

  // 仿磁力球的爆炸特效，但收成"小范围"：粒子数约三分之一、初速更低、
  // 雾团更短命，颜色只保留白到浅灰，读起来是一团白雾而不是爆点。
  function createKingSummonMist(x, y) {
    let seed = (Math.round(x * 1024) ^ Math.round(y * 4096) ^ 0x4b17) >>> 0;
    return createParticleBurst({
      kind: "king-summon-mist",
      x,
      y,
      count: 30,
      colors: ["#ffffff", "#f3f3f3", "#e4e4e4"],
      minDiameter: 1.2,
      maxDiameter: 5,
      initialRadius: 3,
      minSpeed: 10,
      maxSpeed: 64,
      life: 0.72,
      drag: 2.4,
      // 与磁力球爆炸一样使用局部确定性随机流，避免吃掉对局种子。
      random() {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      }
    });
  }

  // 木盾：以 shieldAngle 为中轴的扇形弧带，覆盖 spread 弧度。
  // 内弧紧贴本体、外弧伸出一点，中间用木纹分隔线切成三块木板。
  function drawKingWoodShield(ball, shieldAngle, spread, outerRadius, innerRadius, canvasContext) {
    const half = spread / 2;
    const plank = spread / 6;
    const midRadius = (outerRadius + innerRadius) / 2;
    canvasContext.save();
    canvasContext.translate(ball.x, ball.y);
    canvasContext.rotate(shieldAngle);

    canvasContext.beginPath();
    canvasContext.arc(0, 0, outerRadius, -half, half);
    canvasContext.arc(0, 0, innerRadius, half, -half, true);
    canvasContext.closePath();
    canvasContext.fillStyle = SHIELD_WOOD;
    canvasContext.fill();

    canvasContext.strokeStyle = SHIELD_WOOD_DARK;
    canvasContext.lineWidth = 1.2;
    canvasContext.stroke();

    // 两条板缝把弧带切成三块木板，读起来像盾而不是一段弧。
    canvasContext.strokeStyle = SHIELD_WOOD_DARK;
    canvasContext.lineWidth = 0.8;
    for (const offset of [-plank, plank]) {
      canvasContext.beginPath();
      canvasContext.moveTo(
        Math.cos(offset) * innerRadius,
        Math.sin(offset) * innerRadius
      );
      canvasContext.lineTo(
        Math.cos(offset) * outerRadius,
        Math.sin(offset) * outerRadius
      );
      canvasContext.stroke();
    }

    // 中段高光：薄薄一道，避免整块盾变成死板的纯色。
    canvasContext.strokeStyle = SHIELD_WOOD_LIGHT;
    canvasContext.lineWidth = 1;
    canvasContext.beginPath();
    canvasContext.arc(0, 0, midRadius, -half * 0.86, half * 0.86);
    canvasContext.stroke();

    canvasContext.restore();
  }

  return {
    createKingSummonMist,
    drawKingWoodShield,
    KING_SUMMON_MIST_COLORS: Object.freeze(["#ffffff", "#f3f3f3", "#e4e4e4"]),
    KING_SHIELD_COLORS: Object.freeze({
      wood: SHIELD_WOOD,
      dark: SHIELD_WOOD_DARK,
      light: SHIELD_WOOD_LIGHT
    })
  };
});
