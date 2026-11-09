(function initializeHammerV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createHammerV2Plugin({ registerBall, createKnockbackEffect: createSharedKnockback }) {
  const NORMAL_ROTATION_PERIOD = 1.5;
  const NORMAL_ANGULAR_SPEED = Math.PI * 2 / NORMAL_ROTATION_PERIOD;
  const ATTACK_SPEED_MULTIPLIER = 7.6;
  const ATTACK_ANGULAR_SPEED = NORMAL_ANGULAR_SPEED * ATTACK_SPEED_MULTIPLIER;
  const TRIGGER_DISTANCE = 75;
  const WINDUP_DURATION = 0.15;
  const RECOVERY_DURATION = 0.8;
  const ATTACK_COOLDOWN_DURATION = 0.15;
  const BACKSWING_ANGLE = Math.PI / 8;
  const MISS_OVERSHOOT = Math.PI / 4;
  const CONNECTED_SWING_TRAVEL = Math.PI * 2;
  const HAMMER_CENTER_DISTANCE = 50;
  const HAMMER_HEAD_WIDTH = 40;
  const HAMMER_HEAD_HEIGHT = 20;
  const SWEEP_STEP = Math.PI / 36;
  const DAMAGE = 10;
  const KNOCKBACK_DISTANCE = 50;
  const KNOCKBACK_SPEED_MULTIPLIER = 3.6;
  const DAZE_DURATION = 1.1;
  const DAZE_SPEED_FACTOR = 0.4;
  const DUST_SPACING = 8;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeAngle(angle) {
    let normalized = angle;
    while (normalized > Math.PI) normalized -= Math.PI * 2;
    while (normalized < -Math.PI) normalized += Math.PI * 2;
    return normalized;
  }

  function angleDifference(target, source) {
    return normalizeAngle(target - source);
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    const magnitude = Math.hypot(x, y);
    if (magnitude > EPSILON) return { x: x / magnitude, y: y / magnitude };
    const fallbackMagnitude = Math.hypot(fallbackX, fallbackY) || 1;
    return {
      x: fallbackX / fallbackMagnitude,
      y: fallbackY / fallbackMagnitude
    };
  }

  function hammerHead(ball, angle, centerDistance = HAMMER_CENTER_DISTANCE) {
    return {
      x: ball.x + Math.cos(angle) * centerDistance,
      y: ball.y + Math.sin(angle) * centerDistance
    };
  }

  function hammerTouchesTarget(
    ball,
    angle,
    target,
    centerDistance = HAMMER_CENTER_DISTANCE,
    headWidth = HAMMER_HEAD_WIDTH,
    headHeight = HAMMER_HEAD_HEIGHT
  ) {
    const head = hammerHead(ball, angle, centerDistance);
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const tangentX = -radialY;
    const tangentY = radialX;
    const deltaX = target.x - head.x;
    const deltaY = target.y - head.y;
    const localX = deltaX * tangentX + deltaY * tangentY;
    const localY = deltaX * radialX + deltaY * radialY;
    const closestX = clamp(
      localX,
      -headWidth / 2,
      headWidth / 2
    );
    const closestY = clamp(
      localY,
      -headHeight / 2,
      headHeight / 2
    );
    return Math.hypot(localX - closestX, localY - closestY) <= target.radius;
  }

  function createHammerDaze(directionX, directionY, options = {}) {
    const direction = normalizeDirection(directionX, directionY);
    const dazeDuration = Number.isFinite(options.dazeDuration)
      ? options.dazeDuration
      : DAZE_DURATION;
    const knockbackSpeedMultiplier = Number.isFinite(options.knockbackSpeedMultiplier)
      ? options.knockbackSpeedMultiplier
      : KNOCKBACK_SPEED_MULTIPLIER;
    return createSharedKnockback({
      id: "hammer-v2-daze",
      duration: dazeDuration,
      directionX: direction.x,
      directionY: direction.y,
      speedMultiplier: knockbackSpeedMultiplier,
      distance: KNOCKBACK_DISTANCE,
      settleSpeedMultiplier: DAZE_SPEED_FACTOR,
      visualType: "stun",
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 52) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    });
  }
  function createDustPuff(x, y, index) {
    return {
      kind: "hammer-v2-dust",
      life: 0.42 + index % 3 * 0.04,
      x,
      y,
      size: 3 + index % 3,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= (1 - progress) * 0.58;
        context.fillStyle = index % 2 === 0 ? "#a89b8b" : "#746b63";
        context.beginPath();
        context.arc(
          effect.x,
          effect.y - progress * 4,
          effect.size + progress * 4,
          0,
          Math.PI * 2
        );
        context.fill();
        context.restore();
      }
    };
  }

  function createImpact(x, y, color) {
    const particles = Array.from({ length: 10 }, (_value, index) => {
      const angle = index / 10 * Math.PI * 2;
      return {
        angle,
        distance: 8 + index % 3 * 4,
        color: index % 2 === 0 ? color : "#d5d8da"
      };
    });
    return {
      kind: "hammer-v2-impact",
      life: 0.32,
      x,
      y,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#f4e1c1";
        context.lineWidth = 3 - progress;
        context.beginPath();
        context.arc(effect.x, effect.y, 6 + progress * 24, 0, Math.PI * 2);
        context.stroke();
        effect.particles.forEach((particle) => {
          const distance = particle.distance + progress * 24;
          context.fillStyle = particle.color;
          context.fillRect(
            effect.x + Math.cos(particle.angle) * distance - 1.5,
            effect.y + Math.sin(particle.angle) * distance - 1.5,
            3,
            3
          );
        });
        context.restore();
      }
    };
  }

  function drawAmbientSmoke(context, ball, angle, time, centerDistance, visualScale) {
    const head = hammerHead(ball, angle, centerDistance);
    context.save();
    const baseAlpha = context.globalAlpha;
    const puffCount = 5;
    for (let index = 0; index < puffCount; index += 1) {
      const phase = time * 1.8 + index * 1.37;
      const drift = 4 + ((phase * 7 + index * 3) % 9);
      const radius = (2.5 + ((phase * 3 + index) % 3)) * visualScale;
      const x = head.x - Math.cos(angle) * drift * visualScale + Math.cos(phase) * 2;
      const y = head.y - Math.sin(angle) * drift * visualScale - 7 * visualScale + Math.sin(phase * 1.2) * 2;
      context.fillStyle = index % 2 === 0 ? "#d9dde0" : "#8e969a";
      context.globalAlpha = baseAlpha * (0.16 + (index % 3) * 0.05);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }

  // Visual layout of the reference hammer: a slate metal slab with white
  // striking caps on both ends, a red two-lobed barrel with a pale seam
  // highlight, a dark collar ring with a pale lens over the handle joint,
  // rivet heads, and a red shaft with paired light stripes plus a metal
  // ferrule/cap. The local frame is +x radial outward (head side) and +y
  // tangent, so the handle sits on the -x side of the head.
  const HAMMER_PALETTE = {
    outline: "#2a2d35",
    plate: "#5b6270",
    plateLight: "#707786",
    plateShade: "#646b79",
    plateBevel: "#7d8490",
    plateRim: "#b7bdc9",
    barrelEdge: "#7d262b",
    barrel: "#c2382e",
    barrelLight: "#d94a3c",
    barrelMid: "#d2453a",
    barrelSeam: "#f2c0be",
    barrelSeamEdge: "#8d2727",
    cap: "#dde1ea",
    capFace: "#f0f1f6",
    capSeam: "#a6aeb9",
    rivet: "#3c404a",
    rivetHead: "#b6bcc7",
    collar: "#3b332f",
    collarRim: "#5c4d46",
    lens: "#cfe6ec",
    lensLight: "#eaf6f8",
    lensShade: "#a5c1c8",
    shaft: "#a8404e",
    shaftLight: "#bb535d",
    shaftStripe: "#ddd1d5",
    shaftStripeSoft: "#c9b9be",
    shaftEdge: "#6b2631",
    metal: "#8d95a2",
    metalDark: "#565c68",
    metalLight: "#c6ccd7"
  };
  const HEAD_HALF_LENGTH = 22;
  const HEAD_HALF_THICKNESS = 13.5;
  const HEAD_CORNER_RADIUS = 3.2;
  const HEAD_CAP_INNER = 15;
  const HEAD_BARREL_HALF_LENGTH = 9;
  const HEAD_BARREL_HALF_THICKNESS = 10.5;
  const HEAD_RING_OFFSET = -7;
  const HEAD_RING_RADIUS = 3.3;
  const HEAD_LENS_RADIUS = 2.15;
  const HEAD_RIVETS = [
    [7.2, -11.6], [7.2, 11.6], [-7.2, -11.6], [-7.2, 11.6], [8.6, 0]
  ];
  const SHAFT_HALF_WIDTH = 5.5;
  const SHAFT_CAP_HALF_WIDTH = 6.9;
  const SHAFT_CAP_LENGTH = 3.6;
  const SHAFT_STRIPE_PERIOD = 6;
  const SHAFT_STRIPE_WIDTH = 1.6;
  const SHAFT_STRIPE_THIN_WIDTH = 0.58;

  function traceRoundedRect(context, x, y, width, height, radius) {
    const limit = Math.min(width, height) / 2;
    const r = clamp(radius, 0, limit);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function fillRoundedRect(context, x, y, width, height, radius, color) {
    traceRoundedRect(context, x, y, width, height, radius);
    context.fillStyle = color;
    context.fill();
  }

  function fillCircle(context, x, y, radius, color) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  }

  function strokeHammerPath(context, color, lineWidth) {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.stroke();
  }

  function traceStrikingCap(context, thickness, innerEdge, outerEdge) {
    const direction = outerEdge >= innerEdge ? 1 : -1;
    const r = Math.min(3, Math.abs(outerEdge - innerEdge) / 2);
    context.beginPath();
    context.moveTo(-thickness, innerEdge);
    context.lineTo(thickness, innerEdge);
    context.lineTo(thickness, outerEdge - direction * r);
    context.quadraticCurveTo(thickness, outerEdge, thickness - r, outerEdge);
    context.lineTo(-thickness + r, outerEdge);
    context.quadraticCurveTo(-thickness, outerEdge, -thickness, outerEdge - direction * r);
    context.lineTo(-thickness, innerEdge);
    context.closePath();
  }

  function drawStrikingCap(context, innerEdge, outerEdge, visualScale) {
    const thickness = HEAD_HALF_THICKNESS;
    const direction = outerEdge >= innerEdge ? 1 : -1;
    const faceDepth = clamp(3.4 * visualScale, 2.2, 4.2);
    const faceEdge = outerEdge - direction * faceDepth;
    traceStrikingCap(context, thickness, innerEdge, outerEdge);
    context.fillStyle = HAMMER_PALETTE.cap;
    context.fill();
    strokeHammerPath(context, HAMMER_PALETTE.outline, 1.1);

    traceStrikingCap(context, thickness - 0.45, faceEdge, outerEdge);
    context.fillStyle = HAMMER_PALETTE.capFace;
    context.fill();

    context.fillStyle = HAMMER_PALETTE.capSeam;
    context.fillRect(
      -thickness + 0.6,
      faceEdge - (direction > 0 ? 0.6 : 0),
      2 * thickness - 1.2,
      0.6
    );
  }

  function drawHead(context, phase, visualScale, palette = HAMMER_PALETTE) {
    const P = palette;
    const T = HEAD_HALF_THICKNESS;
    const L = HEAD_HALF_LENGTH;
    context.save();

    const plateFill = typeof context.createLinearGradient === "function"
      ? context.createLinearGradient(-T, 0, T, 0)
      : null;
    if (plateFill) {
      plateFill.addColorStop(0, P.plateLight);
      plateFill.addColorStop(0.3, P.plate);
      plateFill.addColorStop(0.72, P.plate);
      plateFill.addColorStop(1, P.plateShade);
    }
    traceRoundedRect(context, -T, -L, 2 * T, 2 * L, HEAD_CORNER_RADIUS);
    context.fillStyle = plateFill || P.plate;
    context.fill();
    traceRoundedRect(context, -T + 1.2, -L + 1.2, 2 * T - 2.4, 2 * L - 2.4, 2.4);
    strokeHammerPath(context, P.plateBevel, 0.9);
    fillRoundedRect(
      context,
      T - 3.5,
      -L + 3,
      1.9,
      2 * L - 6,
      0.9,
      P.plateRim
    );
    fillRoundedRect(
      context,
      -T + 1.6,
      -L + 3,
      1.9,
      2 * L - 6,
      0.9,
      P.plateBevel
    );

    const barrelHalfLength = HEAD_BARREL_HALF_LENGTH;
    const barrelHalfThickness = HEAD_BARREL_HALF_THICKNESS;
    fillRoundedRect(
      context,
      -barrelHalfThickness,
      -barrelHalfLength,
      2 * barrelHalfThickness,
      2 * barrelHalfLength,
      6.2,
      P.barrelEdge
    );
    const barrelFill = typeof context.createLinearGradient === "function"
      ? context.createLinearGradient(0, -barrelHalfLength, 0, barrelHalfLength)
      : null;
    if (barrelFill) {
      barrelFill.addColorStop(0, P.barrelEdge);
      barrelFill.addColorStop(0.2, P.barrelLight);
      barrelFill.addColorStop(0.5, P.barrelMid);
      barrelFill.addColorStop(0.8, P.barrelLight);
      barrelFill.addColorStop(1, P.barrelEdge);
    }
    fillRoundedRect(
      context,
      -barrelHalfThickness + 1.1,
      -barrelHalfLength + 1.1,
      2 * (barrelHalfThickness - 1.1),
      2 * (barrelHalfLength - 1.1),
      5.2,
      barrelFill || P.barrel
    );
    const seamHalfWidth = 1.5;
    const seamHalfLength = barrelHalfThickness - 0.7;
    fillRoundedRect(
      context,
      -seamHalfLength,
      -seamHalfWidth,
      2 * seamHalfLength,
      2 * seamHalfWidth,
      1.3,
      P.barrelSeam
    );
    context.fillStyle = P.barrelSeamEdge;
    context.fillRect(
      -seamHalfLength,
      -seamHalfWidth - 0.55,
      2 * seamHalfLength,
      0.55
    );
    context.fillRect(
      -seamHalfLength,
      seamHalfWidth,
      2 * seamHalfLength,
      0.55
    );

    const ringRadius = HEAD_RING_RADIUS;
    fillCircle(context, HEAD_RING_OFFSET, 0, ringRadius, P.collar);
    fillCircle(context, HEAD_RING_OFFSET, 0, ringRadius - 0.35, P.collarRim);
    fillCircle(context, HEAD_RING_OFFSET, 0, HEAD_LENS_RADIUS, P.lens);
    fillCircle(
      context,
      HEAD_RING_OFFSET - 0.6,
      -0.7,
      HEAD_LENS_RADIUS * 0.62,
      P.lensLight
    );
    fillCircle(
      context,
      HEAD_RING_OFFSET + 0.7,
      0.8,
      HEAD_LENS_RADIUS * 0.42,
      P.lensShade
    );

    for (const [rivetX, rivetY] of HEAD_RIVETS) {
      fillCircle(context, rivetX, rivetY, 1, P.rivet);
      fillCircle(context, rivetX - 0.12, rivetY - 0.12, 0.38, P.rivetHead);
    }

    drawStrikingCap(context, HEAD_CAP_INNER, L, visualScale);
    drawStrikingCap(context, -HEAD_CAP_INNER, -L, visualScale);

    traceRoundedRect(context, -T, -L, 2 * T, 2 * L, HEAD_CORNER_RADIUS);
    strokeHammerPath(context, P.outline, 1.3);

    if (phase === "swing") {
      const baseAlpha = context.globalAlpha;
      context.globalAlpha = baseAlpha * 0.35;
      traceRoundedRect(context, -T + 1.2, -L + 1.2, 2 * T - 2.4, 2 * L - 2.4, 2.4);
      strokeHammerPath(context, "#f3cda4", 1.4);
      context.globalAlpha = baseAlpha;
    }
    context.restore();
  }

  function drawShaft(context, ball, palette = HAMMER_PALETTE, centerDistance = HAMMER_CENTER_DISTANCE) {
    const P = palette;
    const start = Math.max(6, ball.radius - 1);
    const end = centerDistance - HEAD_HALF_THICKNESS + 1;
    context.save();
    const shaftFill = typeof context.createLinearGradient === "function"
      ? context.createLinearGradient(0, -SHAFT_HALF_WIDTH, 0, SHAFT_HALF_WIDTH)
      : null;
    if (shaftFill) {
      shaftFill.addColorStop(0, P.shaftEdge);
      shaftFill.addColorStop(0.34, P.shaftLight);
      shaftFill.addColorStop(0.66, P.shaft);
      shaftFill.addColorStop(1, P.shaftEdge);
    }
    fillRoundedRect(
      context,
      start,
      -SHAFT_HALF_WIDTH,
      Math.max(4, end - start),
      2 * SHAFT_HALF_WIDTH,
      1.4,
      shaftFill || P.shaft
    );
    const stripeStart = start + 3.6;
    const stripeEnd = end - 1.2;
    for (let stripe = stripeStart; stripe < stripeEnd; stripe += SHAFT_STRIPE_PERIOD) {
      const wideX = stripe;
      const thinX = stripe + SHAFT_STRIPE_PERIOD * 0.5;
      if (wideX + SHAFT_STRIPE_WIDTH < stripeEnd) {
        fillRoundedRect(
          context,
          wideX,
          -SHAFT_HALF_WIDTH + 0.55,
          SHAFT_STRIPE_WIDTH,
          2 * (SHAFT_HALF_WIDTH - 0.55),
          0.5,
          P.shaftStripe
        );
      }
      if (thinX + SHAFT_STRIPE_THIN_WIDTH < stripeEnd) {
        fillRoundedRect(
          context,
          thinX,
          -SHAFT_HALF_WIDTH + 0.55,
          SHAFT_STRIPE_THIN_WIDTH,
          2 * (SHAFT_HALF_WIDTH - 0.55),
          0.3,
          P.shaftStripeSoft
        );
      }
    }
    traceRoundedRect(
      context,
      start,
      -SHAFT_HALF_WIDTH,
      Math.max(4, end - start),
      2 * SHAFT_HALF_WIDTH,
      1.4
    );
    strokeHammerPath(context, P.shaftEdge, 0.9);

    const capStart = start - 0.6;
    const capEnd = start + SHAFT_CAP_LENGTH;
    fillRoundedRect(
      context,
      capStart,
      -SHAFT_CAP_HALF_WIDTH,
      capEnd - capStart,
      2 * SHAFT_CAP_HALF_WIDTH,
      1.1,
      P.metal
    );
    context.fillStyle = P.metalLight;
    context.fillRect(capStart + 0.9, -SHAFT_CAP_HALF_WIDTH + 0.9, 1.2, 2 * SHAFT_CAP_HALF_WIDTH - 1.8);
    context.fillStyle = P.metalDark;
    context.fillRect(capEnd - 1.1, -SHAFT_CAP_HALF_WIDTH + 0.4, 0.9, 2 * SHAFT_CAP_HALF_WIDTH - 0.8);
    traceRoundedRect(
      context,
      capStart,
      -SHAFT_CAP_HALF_WIDTH,
      capEnd - capStart,
      2 * SHAFT_CAP_HALF_WIDTH,
      1.1
    );
    strokeHammerPath(context, P.outline, 1);
    context.restore();
  }

  function drawHammer(context, ball, angle, phase, visualScale = 1, options = {}) {
    const palette = options.palette || HAMMER_PALETTE;
    const centerDistance = Number.isFinite(options.centerDistance)
      ? options.centerDistance
      : HAMMER_CENTER_DISTANCE;
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    if (visualScale !== 1 && typeof context.scale === "function") {
      context.scale(visualScale, visualScale);
    }
    context.shadowColor = phase === "swing" ? (palette.swingGlow || "#f3cda4") : (palette.shadow || "#453733");
    context.shadowBlur = phase === "swing" ? 7 : 2;

    drawShaft(context, ball, palette, centerDistance);
    context.translate(centerDistance, 0);
    context.shadowBlur = phase === "swing" ? 6 : 1.5;
    drawHead(context, phase, visualScale, palette);
    context.restore();
  }

  const hammerV2Definition = {
    id: "hammerV2",
    name: "\u9524\u5b50V2",
    englishName: "Hammer V2",
    color: "#f04432",
    description: "\u611f\u5e94\u84c4\u529b / 7.6\u500d\u65cb\u9524 / \u51fb\u9000\u7729\u6655",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services, options = {}) {
      const centerDistance = Number.isFinite(options.centerDistance)
        ? options.centerDistance
        : HAMMER_CENTER_DISTANCE;
      const headWidth = Number.isFinite(options.headWidth)
        ? options.headWidth
        : HAMMER_HEAD_WIDTH;
      const headHeight = Number.isFinite(options.headHeight)
        ? options.headHeight
        : HAMMER_HEAD_HEIGHT;
      const normalAngularSpeed = Number.isFinite(options.normalRotationPeriod)
        ? Math.PI * 2 / options.normalRotationPeriod
        : NORMAL_ANGULAR_SPEED;
      const attackAngularSpeed = normalAngularSpeed * (
        Number.isFinite(options.attackSpeedMultiplier)
          ? options.attackSpeedMultiplier
          : ATTACK_SPEED_MULTIPLIER
      );
      const triggerDistance = Number.isFinite(options.triggerDistance)
        ? options.triggerDistance
        : TRIGGER_DISTANCE;
      const damage = Number.isFinite(options.damage) ? options.damage : DAMAGE;
      const dazeOptions = {
        dazeDuration: Number.isFinite(options.dazeDuration)
          ? options.dazeDuration
          : DAZE_DURATION,
        knockbackSpeedMultiplier: Number.isFinite(options.knockbackSpeedMultiplier)
          ? options.knockbackSpeedMultiplier
          : KNOCKBACK_SPEED_MULTIPLIER
      };
      const visualScale = Number.isFinite(options.visualScale)
        ? options.visualScale
        : centerDistance / HAMMER_CENTER_DISTANCE;
      const contactAttack = options.contactAttack === true;
      const smokeAlways = options.smokeAlways === true;
      let ownerBall = null;
      let phase = "normal";
      let angle = -Math.PI / 2;
      let phaseTime = 0;
      let windupStartAngle = angle;
      let swingSign = 1;
      let aimAngle = angle;
      let swingTravel = 0;
      let swingRequired = 0;
      let swingConnected = false;
      let targetInstanceId = null;
      let pendingSweep = null;
      let dustRemainder = 0;
      let dustIndex = 0;
      let dustStartedForSwing = false;
      const contactTargets = new Set();

      function currentTarget() {
        if (!targetInstanceId) return null;
        const target = services.getBall(targetInstanceId);
        return target && target.hp > 0 ? target : null;
      }

      function beginWindup(context, target) {
        ownerBall = context.ball;
        phase = "windup";
        phaseTime = 0;
        windupStartAngle = angle;
        targetInstanceId = target.instanceId;
        aimAngle = Math.atan2(target.y - context.ball.y, target.x - context.ball.x);
        const difference = angleDifference(aimAngle, angle);
        swingSign = Math.abs(difference) <= EPSILON ? 1 : Math.sign(difference);
        swingTravel = 0;
        swingRequired = 0;
        swingConnected = false;
        pendingSweep = null;
        dustRemainder = 0;
        dustStartedForSwing = false;
      }

      function beginSwing(context) {
        const target = currentTarget();
        if (target) {
          aimAngle = Math.atan2(target.y - context.ball.y, target.x - context.ball.x);
        }
        const difference = angleDifference(aimAngle, angle);
        if (Math.abs(difference) > EPSILON) swingSign = Math.sign(difference);
        swingTravel = 0;
        swingRequired = Math.abs(difference) + MISS_OVERSHOOT;
        phase = "swing";
        phaseTime = 0;
      }

      function enterRecovery() {
        phase = "recovery";
        phaseTime = 0;
        pendingSweep = null;
        targetInstanceId = null;
      }

      function advance(context, dt) {
        ownerBall = context.ball;
        const elapsed = Math.max(0, dt);
        if (phase === "normal") {
          angle = normalizeAngle(angle + normalAngularSpeed * elapsed);
          return;
        }
        if (phase === "windup") {
          phaseTime = Math.min(WINDUP_DURATION, phaseTime + elapsed);
          const linear = clamp(phaseTime / WINDUP_DURATION, 0, 1);
          const eased = linear * linear * (3 - 2 * linear);
          angle = normalizeAngle(
            windupStartAngle - swingSign * BACKSWING_ANGLE * eased
          );
          if (phaseTime + EPSILON >= WINDUP_DURATION) beginSwing(context);
          return;
        }
        if (phase === "recovery") {
          angle = normalizeAngle(angle + normalAngularSpeed * elapsed);
          phaseTime = Math.min(RECOVERY_DURATION, phaseTime + elapsed);
          if (phaseTime + EPSILON >= RECOVERY_DURATION) {
            phase = "cooldown";
            phaseTime = 0;
          }
          return;
        }
        if (phase === "cooldown") {
          angle = normalizeAngle(angle + normalAngularSpeed * elapsed);
          phaseTime = Math.min(ATTACK_COOLDOWN_DURATION, phaseTime + elapsed);
          if (phaseTime + EPSILON >= ATTACK_COOLDOWN_DURATION) {
            phase = "normal";
            phaseTime = 0;
          }
          return;
        }

        const travel = Math.min(
          attackAngularSpeed * elapsed,
          Math.max(0, swingRequired - swingTravel)
        );
        const startAngle = angle;
        angle = normalizeAngle(angle + swingSign * travel);
        swingTravel += travel;
        pendingSweep = {
          startAngle,
          travel,
          completesSwing: swingTravel + EPSILON >= swingRequired
        };
      }

      function findTrigger(context) {
        if (phase !== "normal") return;
        let nearest = null;
        let nearestDistance = Infinity;
        for (const target of services.getEnemies()) {
          if (!services.getContactProfile(target).attackable) continue;
          const distance = Math.hypot(
            target.x - context.ball.x,
            target.y - context.ball.y
          );
          if (distance > triggerDistance + EPSILON || distance >= nearestDistance) continue;
          nearest = target;
          nearestDistance = distance;
        }
        if (nearest) beginWindup(context, nearest);
      }

      function leaveDust(context, sampleAngle, angularStep) {
        dustRemainder += Math.abs(angularStep) * centerDistance;
        if (dustRemainder + EPSILON < DUST_SPACING) return;
        dustRemainder %= DUST_SPACING;
        const head = hammerHead(context.ball, sampleAngle, centerDistance);
        services.spawnVisualEffect(createDustPuff(head.x, head.y, dustIndex));
        dustIndex += 1;
      }

      function hitAtAngle(context, sampleAngle) {
        if (swingConnected) return false;
        for (const target of services.getEnemies()) {
          if (!hammerTouchesTarget(
            context.ball,
            sampleAngle,
            target,
            centerDistance,
            headWidth,
            headHeight
          )) continue;
          if (!services.dealDamage(target, damage, context.ball)) continue;
          swingConnected = true;
          swingRequired = Math.max(swingRequired, CONNECTED_SWING_TRAVEL);
          const knockbackDirection = normalizeDirection(
            target.x - context.ball.x,
            target.y - context.ball.y,
            Math.cos(sampleAngle),
            Math.sin(sampleAngle)
          );
          const head = hammerHead(context.ball, sampleAngle, centerDistance);
          services.spawnVisualEffect(createImpact(head.x, head.y, target.color));
          if (target.hp > 0) {
            services.applyEffect(
              target,
              createHammerDaze(
                knockbackDirection.x,
                knockbackDirection.y,
                dazeOptions
              ),
              context.ball
            );
          }
          return true;
        }
        return false;
      }

      function hitOnContact(context, target) {
        const targetKey = target.instanceId;
        if (!hammerTouchesTarget(
          context.ball,
          angle,
          target,
          centerDistance,
          headWidth,
          headHeight
        )) {
          contactTargets.delete(targetKey);
          return false;
        }
        if (contactTargets.has(targetKey)) return true;
        if (!services.getContactProfile(target).attackable) {
          contactTargets.delete(targetKey);
          return false;
        }
        if (!services.dealDamage(target, damage, context.ball)) return false;
        contactTargets.add(targetKey);
        const knockbackDirection = normalizeDirection(
          target.x - context.ball.x,
          target.y - context.ball.y,
          Math.cos(angle),
          Math.sin(angle)
        );
        const head = hammerHead(context.ball, angle, centerDistance);
        services.spawnVisualEffect(createImpact(head.x, head.y, target.color));
        if (target.hp > 0) {
          services.applyEffect(
            target,
            createHammerDaze(
              knockbackDirection.x,
              knockbackDirection.y,
              dazeOptions
            ),
            context.ball
          );
        }
        return true;
      }

      function resolveContactAttack(context) {
        for (const target of services.getEnemies()) {
          hitOnContact(context, target);
        }
        for (const targetKey of Array.from(contactTargets)) {
          const target = services.getBall(targetKey);
          if (!target || target.hp <= 0) contactTargets.delete(targetKey);
        }
      }

      function resolveSwing(context) {
        if (!pendingSweep) return false;
        const sweep = pendingSweep;
        pendingSweep = null;
        if (!dustStartedForSwing) {
          const head = hammerHead(context.ball, sweep.startAngle, centerDistance);
          services.spawnVisualEffect(createDustPuff(head.x, head.y, dustIndex));
          dustIndex += 1;
          dustStartedForSwing = true;
        }
        if (sweep.travel <= EPSILON) {
          if (swingTravel + EPSILON >= swingRequired) enterRecovery();
          return phase === "recovery";
        }
        let covered = 0;
        while (covered < sweep.travel - EPSILON) {
          const step = Math.min(SWEEP_STEP, sweep.travel - covered);
          covered += step;
          const sampleAngle = normalizeAngle(
            sweep.startAngle + swingSign * covered
          );
          leaveDust(context, sampleAngle, step);
          hitAtAngle(context, sampleAngle);
        }
        if (swingTravel + EPSILON >= swingRequired) {
          enterRecovery();
          return true;
        }
        return false;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
        },
        update(context, dt) {
          advance(context, dt);
        },
        getNextTransitionIn() {
          if (phase === "windup") {
            return Math.max(EPSILON, WINDUP_DURATION - phaseTime);
          }
          if (phase === "recovery") {
            return Math.max(EPSILON, RECOVERY_DURATION - phaseTime);
          }
          if (phase === "cooldown") {
            return Math.max(EPSILON, ATTACK_COOLDOWN_DURATION - phaseTime);
          }
          return undefined;
        },
        afterUpdateStep(context) {
          if (contactAttack) {
            resolveContactAttack(context);
            return;
          }
          const finishedSwing = resolveSwing(context);
          if (!finishedSwing) findTrigger(context);
        },
        drawBefore(context, canvasContext) {
          ownerBall = context.ball;
          if (smokeAlways) {
            drawAmbientSmoke(
              canvasContext,
              context.ball,
              angle,
              context.game.time,
              centerDistance,
              visualScale
            );
          }
          drawHammer(canvasContext, context.ball, angle, phase, visualScale);
        },
        onAttackBorrowStart(context) {
          if (!contactAttack) {
            const target = services.getOpponent();
            if (target) beginWindup(context, target);
          }
        },
        isAttackCycleComplete() {
          return contactAttack ? undefined : phase === "cooldown";
        },
        getAttackCycleDuration() { return 5; },
        getAttackCycleTransitionIn() {
          if (phase === "swing") return Math.max(EPSILON, (swingRequired - swingTravel) / attackAngularSpeed);
          return undefined;
        },
        drawBorrowedWeapon(context, canvasContext) {
          drawHammer(canvasContext, context.ball, angle, phase, visualScale);
        },
        getHammerState() {
          const head = ownerBall ? hammerHead(ownerBall, angle, centerDistance) : null;
          return {
            phase,
            angle,
            angularSpeed: phase === "swing"
              ? attackAngularSpeed
              : ((phase === "normal" || phase === "recovery" || phase === "cooldown")
                ? normalAngularSpeed
                : 0),
            swingSign,
            aimAngle,
            swingTravel,
            swingRequired,
            swingConnected,
            targetInstanceId,
            contactAttack,
            smokeAlways,
            head
          };
        }
      };
    }
  };

  registerBall(hammerV2Definition);
  return {
    hammerV2Definition,
    createHammerDaze,
    hammerHead,
    hammerTouchesTarget,
    drawHammer,
    HAMMER_PALETTE,
    HAMMER_GEOMETRY: Object.freeze({
      centerDistance: HAMMER_CENTER_DISTANCE,
      headWidth: HAMMER_HEAD_WIDTH,
      headHeight: HAMMER_HEAD_HEIGHT
    })
  };
});
