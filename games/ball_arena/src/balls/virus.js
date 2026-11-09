(function initializeVirus(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVirusPlugin({ registerBall }) {
  // The virus infects on body contact. The poison follows the Green stinger
  // recipe (1 HP per tick plus a slow) but keeps ticking ten times instead
  // of the stinger's shorter course.
  const VIRUS_TICK_INTERVAL = 0.3;
  const VIRUS_TICK_COUNT = 10;
  const VIRUS_DURATION = VIRUS_TICK_INTERVAL * VIRUS_TICK_COUNT;
  const VIRUS_DAMAGE = 1;
  const VIRUS_SPEED_FACTOR = 0.5;
  const RECOVERY_DURATION = 0.5;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const SPIKE_COUNT = 9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function createVirusPoison() {
    return {
      id: "virus-poison",
      duration: VIRUS_DURATION + RECOVERY_DURATION,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: VIRUS_SPEED_FACTOR,
      onApply({ effect, game, isRefresh }) {
        if (!isRefresh) effect.startedAt = game.time;
        effect.startedAt = game.time;
        effect.nextDamageAt = game.time + VIRUS_TICK_INTERVAL;
      },
      update({ ball, effect, game, services: effectServices }) {
        const poisonEndsAt = effect.startedAt + VIRUS_DURATION;
        while (
          effect.nextDamageAt <= poisonEndsAt + EPSILON &&
          game.time + EPSILON >= effect.nextDamageAt
        ) {
          effectServices.dealDamage(ball, VIRUS_DAMAGE);
          effect.nextDamageAt += VIRUS_TICK_INTERVAL;
        }

        const elapsed = game.time - effect.startedAt;
        effect.speedFactor = elapsed <= VIRUS_DURATION
          ? VIRUS_SPEED_FACTOR
          : VIRUS_SPEED_FACTOR + (1 - VIRUS_SPEED_FACTOR) * clamp(
            (elapsed - VIRUS_DURATION) / RECOVERY_DURATION,
            0,
            1
          );
      },
      draw({ ball, effect, game }, context) {
        const frame = Math.floor((game.time - effect.startedAt) * 12);
        context.save();
        context.fillStyle = "#7dff56";
        context.globalAlpha *= 0.75;
        for (let index = 0; index < 6; index += 1) {
          const angle = index * Math.PI * 2 / 6 + frame * 0.18;
          const distance = ball.radius + 3 + ((frame + index) % 4);
          context.fillRect(
            ball.x + Math.cos(angle) * distance - 1.5,
            ball.y + Math.sin(angle) * distance - 1.5,
            3,
            3
          );
        }
        context.restore();
      }
    };
  }

  // A green spiked core: the body circle plus a ring of stubby spikes with
  // rounded tips, matching the virus reference art.
  function drawVirusBody(context, canvasContext) {
    const ball = context.ball;
    canvasContext.save();
    canvasContext.translate(ball.x, ball.y);

    canvasContext.fillStyle = "#2f9e2f";
    for (let index = 0; index < SPIKE_COUNT; index += 1) {
      const angle = index / SPIKE_COUNT * TWO_PI;
      const tipX = Math.cos(angle) * (ball.radius + 5);
      const tipY = Math.sin(angle) * (ball.radius + 5);
      const baseX = Math.cos(angle) * (ball.radius - 2);
      const baseY = Math.sin(angle) * (ball.radius - 2);
      canvasContext.beginPath();
      canvasContext.moveTo(
        baseX + Math.cos(angle + Math.PI / 2) * 3,
        baseY + Math.sin(angle + Math.PI / 2) * 3
      );
      canvasContext.lineTo(
        baseX - Math.cos(angle + Math.PI / 2) * 3,
        baseY - Math.sin(angle + Math.PI / 2) * 3
      );
      canvasContext.lineTo(tipX, tipY);
      canvasContext.closePath();
      canvasContext.fill();
      canvasContext.beginPath();
      canvasContext.arc(tipX, tipY, 3, 0, TWO_PI);
      canvasContext.fill();
    }

    canvasContext.fillStyle = ball.color;
    canvasContext.beginPath();
    canvasContext.arc(0, 0, ball.radius, 0, TWO_PI);
    canvasContext.fill();

    canvasContext.strokeStyle = "#1f6b1f";
    canvasContext.lineWidth = 2;
    canvasContext.beginPath();
    canvasContext.arc(0, 0, ball.radius, 0, TWO_PI);
    canvasContext.stroke();
    canvasContext.restore();
    return true;
  }

  const virusDefinition = {
    id: "virus",
    name: "\u75c5\u6bd2",
    englishName: "Virus",
    color: "#52e83a",
    description: "\u89e6\u78b0\u4f20\u67d3 / \u4e2d\u6bd2 -1\u00d710 / \u51cf\u901f",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior() {
      return {
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.applyEffect(target, createVirusPoison());
        },
        drawBody(context, canvasContext) {
          return drawVirusBody(context, canvasContext);
        }
      };
    }
  };

  registerBall(virusDefinition);
  return { virusDefinition, createVirusPoison };
});
