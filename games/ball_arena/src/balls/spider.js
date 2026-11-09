(function initializeSpider(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpiderPlugin({ registerBall }) {
  const BODY_COLOR = "#183a62";
  const CARAPACE_COLOR = "#214f7c";
  const BODY_RIM_COLOR = "#2f6f9e";
  const EYE_COLOR = "#dff4ff";
  const MARK_COLOR = "#7fb4d8";
  const WEB_UNDER_COLOR = "#7fa7c2";
  const WEB_CORE_COLOR = "#c9e2f1";
  const WEB_TRAPPED_UNDER_COLOR = "#b7dcef";
  const WEB_TRAPPED_CORE_COLOR = "#e9f8ff";
  const WEB_TETHER_COLOR = "#8fc6e6";
  const WEB_INTERVAL = 1.5;
  const WEB_RADIUS = 30;
  const WEB_SPEED_MULTIPLIER = 1;
  const SLOW_FACTOR = 0.05;
  const BITE_INTERVAL = 0.2;
  const BITE_DAMAGE = 1;
  // 咬的射程：圆心距阈值 = 常量 + 目标半径（目标体积算进射程，
  // 否则长大的雪球贴到身上时它的中心还在阈值外）。
  const BITE_RANGE = 45;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const WEB_SPOKE_COUNT = 12;
  const WEB_FADE_LIFE = 0.24;
  const WEB_SNAP_DURATION = 0.16;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  // 视觉几何的确定性种子：不消耗战斗随机流。
  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function hashUnit(seed) {
    let value = seed >>> 0;
    value ^= value >>> 16;
    value = Math.imul(value, 0x7feb352d);
    value ^= value >>> 15;
    value = Math.imul(value, 0x846ca68b);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967296;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function createWebGeometry(radius, seed) {
    const hubX = (hashUnit(seed + 1) - 0.5) * 5;
    const hubY = (hashUnit(seed + 2) - 0.5) * 5;
    const angles = [];
    const spokes = [];
    const broken = [];
    for (let index = 0; index < WEB_SPOKE_COUNT; index += 1) {
      const angle = index / WEB_SPOKE_COUNT * TWO_PI +
        (hashUnit(seed + 17 + index * 13) - 0.5) * 0.18;
      angles.push(angle);
      const isBroken = hashUnit(seed + 101 + index * 19) < 0.13;
      broken.push(isBroken);
      const reach = isBroken
        ? 0.55 + hashUnit(seed + 211 + index * 23) * 0.2
        : 0.94 + hashUnit(seed + 307 + index * 29) * 0.06;
      const startX = hubX + (hashUnit(seed + 401 + index * 31) - 0.5) * 1.2;
      const startY = hubY + (hashUnit(seed + 503 + index * 37) - 0.5) * 1.2;
      const midRadius = radius * (0.42 + hashUnit(seed + 601 + index * 41) * 0.14);
      const bend = (hashUnit(seed + 701 + index * 43) - 0.5) * 5;
      spokes.push({
        startX,
        startY,
        controlX: Math.cos(angle) * midRadius - Math.sin(angle) * bend,
        controlY: Math.sin(angle) * midRadius + Math.cos(angle) * bend,
        endX: Math.cos(angle) * radius * reach,
        endY: Math.sin(angle) * radius * reach
      });
    }
    const ringRatios = [0.28, 0.46, 0.64, 0.82, 0.98];
    const rings = ringRatios.map((ratio, ringIndex) => {
      const anchors = angles.map((angle, index) => {
        const radial = 1 + (hashUnit(seed + 809 + ringIndex * 47 + index * 53) - 0.5) * 0.06;
        return {
          x: Math.cos(angle) * radius * ratio * radial,
          y: Math.sin(angle) * radius * ratio * radial
        };
      });
      const outer = ringIndex === ringRatios.length - 1;
      const segments = [];
      for (let index = 0; index < WEB_SPOKE_COUNT; index += 1) {
        const next = (index + 1) % WEB_SPOKE_COUNT;
        if (!outer && hashUnit(seed + 907 + ringIndex * 59 + index * 61) < 0.06) continue;
        if (!outer && ratio > 0.6 && (broken[index] || broken[next])) continue;
        const start = anchors[index];
        const end = anchors[next];
        const sag = 1 - (0.02 + hashUnit(seed + 1009 + ringIndex * 67 + index * 71) * 0.04);
        segments.push({
          startX: start.x,
          startY: start.y,
          controlX: (start.x + end.x) / 2 * sag,
          controlY: (start.y + end.y) / 2 * sag,
          endX: end.x,
          endY: end.y
        });
      }
      if (!outer && segments.length === WEB_SPOKE_COUNT) {
        segments.splice(
          Math.floor(hashUnit(seed + 1103 + ringIndex * 73) * segments.length),
          1
        );
      }
      return { anchors, segments };
    });
    const outerAnchors = rings[rings.length - 1].anchors;
    const knots = [];
    for (let index = 0; index < WEB_SPOKE_COUNT; index += 3) {
      knots.push(outerAnchors[index]);
    }
    return {
      spokes,
      rings,
      knots,
      hubArms: [
        {
          startX: hubX - 2.4, startY: hubY - 0.8,
          controlX: hubX - 0.9, controlY: hubY - 1.4,
          endX: hubX + 0.8, endY: hubY + 0.6
        },
        {
          startX: hubX + 2.2, startY: hubY - 1.1,
          controlX: hubX + 0.6, controlY: hubY - 0.4,
          endX: hubX - 0.4, endY: hubY + 1.5
        },
        {
          startX: hubX - 0.2, startY: hubY + 2.2,
          controlX: hubX + 1.1, controlY: hubY + 0.7,
          endX: hubX - 1.4, endY: hubY - 0.6
        }
      ]
    };
  }

  function drawWebShape(context, web, { gameTime, trapped, alpha = 1, snap = true }) {
    const geometry = web.geometry;
    if (!geometry) return;
    const pulse = trapped
      ? 0.9 + Math.sin(gameTime * 12) * 0.08
      : 0.82 + Math.sin(gameTime * 2.3) * 0.04;
    let scale = 1;
    if (snap && web.caughtAt) {
      const progress = clamp01((gameTime - web.caughtAt) / WEB_SNAP_DURATION);
      scale = 1 - 0.08 * Math.sin(progress * Math.PI);
    }
    const seed = web.visualSeed || 0;
    const wobbleX = trapped ? Math.sin(gameTime * 13 + seed % 7) * 0.18 : 0;
    const wobbleY = trapped ? Math.cos(gameTime * 11 + seed % 5) * 0.18 : 0;
    context.save();
    context.translate(web.x + wobbleX, web.y + wobbleY);
    context.scale(scale, scale);
    context.beginPath();
    for (const spoke of geometry.spokes) {
      context.moveTo(spoke.startX, spoke.startY);
      context.quadraticCurveTo(spoke.controlX, spoke.controlY, spoke.endX, spoke.endY);
    }
    for (const ring of geometry.rings) {
      for (const segment of ring.segments) {
        context.moveTo(segment.startX, segment.startY);
        context.quadraticCurveTo(
          segment.controlX, segment.controlY,
          segment.endX, segment.endY
        );
      }
    }
    context.globalAlpha = alpha * (trapped ? 0.22 : 0.16) * pulse;
    context.strokeStyle = trapped ? WEB_TRAPPED_UNDER_COLOR : WEB_UNDER_COLOR;
    context.lineWidth = trapped ? 3.2 : 2.4;
    context.stroke();
    context.globalAlpha = alpha * (trapped ? 0.94 : 0.78) * pulse;
    context.strokeStyle = trapped ? WEB_TRAPPED_CORE_COLOR : WEB_CORE_COLOR;
    context.lineWidth = trapped ? 1.1 : 0.85;
    context.stroke();
    context.beginPath();
    for (const arm of geometry.hubArms) {
      context.moveTo(arm.startX, arm.startY);
      context.quadraticCurveTo(arm.controlX, arm.controlY, arm.endX, arm.endY);
    }
    context.globalAlpha = alpha * (trapped ? 0.9 : 0.65) * pulse;
    context.strokeStyle = trapped ? WEB_TRAPPED_CORE_COLOR : WEB_CORE_COLOR;
    context.lineWidth = trapped ? 1 : 0.8;
    context.stroke();
    context.globalAlpha = alpha * (trapped ? 0.9 : 0.6);
    context.fillStyle = trapped ? WEB_TRAPPED_CORE_COLOR : WEB_CORE_COLOR;
    for (const knot of geometry.knots) {
      context.fillRect(knot.x - 0.7, knot.y - 0.7, 1.4, 1.4);
    }
    context.restore();
  }

  function drawWebTether(context, ball, web, target, trapped, gameTime, alpha = 1) {
    let endX = web.x;
    let endY = web.y;
    if (target) {
      const targetDeltaX = target.x - ball.x;
      const targetDeltaY = target.y - ball.y;
      const targetDistance = Math.hypot(targetDeltaX, targetDeltaY);
      const targetRadius = Number.isFinite(target.radius) ? target.radius : 0;
      if (targetDistance > targetRadius + 1) {
        endX = target.x - targetDeltaX / targetDistance * targetRadius;
        endY = target.y - targetDeltaY / targetDistance * targetRadius;
      } else {
        endX = target.x;
        endY = target.y;
      }
    }
    const deltaX = endX - ball.x;
    const deltaY = endY - ball.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance < 6) return;
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    const startX = ball.x + directionX * 11;
    const startY = ball.y + directionY * 11;
    const seed = web.visualSeed || 0;
    const sag = (trapped ? 2.6 : 5.4) +
      Math.sin(gameTime * 6.5 + (seed % 1000) * 0.01) * 0.35;
    const controlX = (startX + endX) / 2 - directionY * sag;
    const controlY = (startY + endY) / 2 + directionX * sag;
    const control2X = (startX + endX) / 2 - directionY * sag * 0.55;
    const control2Y = (startY + endY) / 2 + directionX * sag * 0.55 + 1.2;
    context.save();
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(controlX, controlY, endX, endY);
    context.moveTo(startX, startY);
    context.quadraticCurveTo(control2X, control2Y, endX, endY);
    context.globalAlpha = alpha * 0.22;
    context.strokeStyle = WEB_UNDER_COLOR;
    context.lineWidth = 2.4;
    context.stroke();
    context.globalAlpha = alpha * (trapped ? 0.95 : 0.75);
    context.strokeStyle = WEB_TETHER_COLOR;
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  function createWebFadeEffect(web, now) {
    const snapshot = {
      x: web.x,
      y: web.y,
      geometry: web.geometry,
      caughtAt: 0,
      visualSeed: web.visualSeed || 0,
      trapped: Boolean(web.caughtAt)
    };
    return {
      kind: "spider-web-fade",
      life: WEB_FADE_LIFE,
      drawLayer: "background",
      draw({ effect }, context) {
        const progress = clamp01(effect.age / effect.life);
        drawWebShape(context, snapshot, {
          gameTime: now + effect.age,
          trapped: snapshot.trapped,
          alpha: 1 - progress,
          snap: false
        });
      }
    };
  }

  function createBindingGeometry(seed) {
    const spokes = [];
    for (let index = 0; index < 6; index += 1) {
      spokes.push({
        angle: index / 6 * TWO_PI +
          (hashUnit(seed + 31 + index * 17) - 0.5) * 0.24,
        start: 0.12 + hashUnit(seed + 41 + index * 19) * 0.12,
        reach: 1.02 + hashUnit(seed + 53 + index * 23) * 0.24,
        bend: (hashUnit(seed + 67 + index * 29) - 0.5) * 0.25
      });
    }
    const rings = [0.72, 0.98, 1.18].map((ratio, ringIndex) => {
      const anchors = [];
      for (let index = 0; index < 6; index += 1) {
        const angle = index / 6 * TWO_PI +
          (hashUnit(seed + 79 + ringIndex * 31 + index * 37) - 0.5) * 0.2;
        const radial = 1 +
          (hashUnit(seed + 97 + ringIndex * 41 + index * 43) - 0.5) * 0.08;
        anchors.push({
          x: Math.cos(angle) * ratio * radial,
          y: Math.sin(angle) * ratio * radial
        });
      }
      const segments = [];
      for (let index = 0; index < 6; index += 1) {
        if (ringIndex < 2 &&
            hashUnit(seed + 113 + ringIndex * 47 + index * 53) < 0.12) continue;
        const next = (index + 1) % 6;
        const start = anchors[index];
        const end = anchors[next];
        const sag = 1 - (0.03 + hashUnit(seed + 131 + ringIndex * 59 + index * 61) * 0.04);
        segments.push({
          startX: start.x,
          startY: start.y,
          controlX: (start.x + end.x) / 2 * sag,
          controlY: (start.y + end.y) / 2 * sag,
          endX: end.x,
          endY: end.y
        });
      }
      return { anchors, segments };
    });
    return {
      spokes,
      rings,
      strands: [
        {
          startAngle: 0.12 * Math.PI, endAngle: 0.88 * Math.PI,
          controlAngle: 0.5 * Math.PI, controlRadius: 1.22
        },
        {
          startAngle: 0.62 * Math.PI, endAngle: 1.12 * Math.PI,
          controlAngle: 0.88 * Math.PI, controlRadius: 1.2
        },
        {
          startAngle: -0.1 * Math.PI, endAngle: 0.38 * Math.PI,
          controlAngle: 0.14 * Math.PI, controlRadius: 1.2
        }
      ]
    };
  }

  function drawBindingUnder(context, ball, geometry, gameTime, seed) {
    const radius = ball.radius;
    const pulse = 0.86 + Math.sin(gameTime * 4 + (seed % 1000) * 0.01) * 0.12;
    context.save();
    context.translate(ball.x, ball.y);
    context.beginPath();
    for (const spoke of geometry.spokes) {
      const startRadius = radius * spoke.start;
      const endRadius = radius * spoke.reach;
      const midRadius = (startRadius + endRadius) / 2;
      context.moveTo(
        Math.cos(spoke.angle) * startRadius,
        Math.sin(spoke.angle) * startRadius
      );
      context.quadraticCurveTo(
        Math.cos(spoke.angle) * midRadius - Math.sin(spoke.angle) * spoke.bend * radius,
        Math.sin(spoke.angle) * midRadius + Math.cos(spoke.angle) * spoke.bend * radius,
        Math.cos(spoke.angle) * endRadius,
        Math.sin(spoke.angle) * endRadius
      );
    }
    for (const ring of geometry.rings) {
      for (const segment of ring.segments) {
        context.moveTo(segment.startX * radius, segment.startY * radius);
        context.quadraticCurveTo(
          segment.controlX * radius,
          segment.controlY * radius,
          segment.endX * radius,
          segment.endY * radius
        );
      }
    }
    context.globalAlpha = 0.34 * pulse;
    context.strokeStyle = WEB_UNDER_COLOR;
    context.lineWidth = 1.3;
    context.stroke();
    context.globalAlpha = 0.5 * pulse;
    context.strokeStyle = WEB_CORE_COLOR;
    context.lineWidth = 0.6;
    context.stroke();
    context.restore();
  }

  function drawBindingOver(context, ball, geometry, gameTime, seed) {
    const radius = ball.radius;
    const pulse = 0.84 + Math.sin(gameTime * 4 + (seed % 1000) * 0.01) * 0.16;
    const knots = [];
    context.save();
    context.translate(ball.x, ball.y);
    context.beginPath();
    for (const strand of geometry.strands) {
      const startX = Math.cos(strand.startAngle) * radius * 0.98;
      const startY = Math.sin(strand.startAngle) * radius * 0.98;
      const endX = Math.cos(strand.endAngle) * radius * 0.98;
      const endY = Math.sin(strand.endAngle) * radius * 0.98;
      const controlX = Math.cos(strand.controlAngle) * radius * strand.controlRadius;
      const controlY = Math.sin(strand.controlAngle) * radius * strand.controlRadius;
      context.moveTo(startX, startY);
      context.quadraticCurveTo(controlX, controlY, endX, endY);
      knots.push([startX, startY], [endX, endY]);
    }
    context.globalAlpha = 0.2 * pulse;
    context.strokeStyle = WEB_UNDER_COLOR;
    context.lineWidth = 1.8;
    context.stroke();
    context.globalAlpha = 0.72 * pulse;
    context.strokeStyle = WEB_CORE_COLOR;
    context.lineWidth = 0.7;
    context.stroke();
    context.globalAlpha = 0.7 * pulse;
    context.fillStyle = WEB_CORE_COLOR;
    for (const [x, y] of knots) {
      context.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
    }
    context.restore();
  }

  function createWebSlowEffect(source, visualSeed = 0) {
    const binding = createBindingGeometry(visualSeed);
    return {
      id: `spider-web-slow-${source.instanceId}`,
      duration: Number.MAX_SAFE_INTEGER,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      // 唯一的减速接口：因子交给引擎统一合成，免疫减速的目标自动忽略它。
      speedFactor: SLOW_FACTOR,
      drawBefore({ ball, game }, context) {
        drawBindingUnder(context, ball, binding, game.time, visualSeed);
      },
      draw({ ball, game }, context) {
        drawBindingOver(context, ball, binding, game.time, visualSeed);
      }
    };
  }

  function relativeTravelContact(web, target) {
    const targetPrevX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const targetPrevY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const startX = web.prevX - targetPrevX;
    const startY = web.prevY - targetPrevY;
    const endX = web.x - target.x;
    const endY = web.y - target.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        -(startX * deltaX + startY * deltaY) / lengthSquared,
        0,
        1
      );
    const distance = Math.hypot(
      startX + deltaX * progress,
      startY + deltaY * progress
    );
    return distance <= WEB_RADIUS ? progress : null;
  }

  function trappedWebContains(web, target) {
    // The web only holds a target whose centre is still inside it.
    return Math.hypot(target.x - web.x, target.y - web.y) <= WEB_RADIUS;
  }

  function drawSpiderBody(context, ball, state, gameTime) {
    const biteProgress = state.biting
      ? clamp(state.biteTimer / BITE_INTERVAL, 0, 1)
      : 0;
    const lunge = state.biting ? Math.sin(biteProgress * Math.PI) * 5 : 0;
    const renderX = ball.x + Math.cos(state.targetAngle) * lunge;
    const renderY = ball.y + Math.sin(state.targetAngle) * lunge;
    const speed = Math.hypot(ball.vx || 0, ball.vy || 0);
    const gait = Math.min(1, speed / Math.max(1, ball.speed || 150));
    const brace = state.biting ? Math.sin(biteProgress * Math.PI) : 0;
    const baseAlpha = context.globalAlpha;

    context.save();
    context.translate(renderX, renderY);
    context.rotate(state.targetAngle);

    // 关节腿先画，身体压在腿根上。
    context.strokeStyle = "#102944";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    const legJoints = [];
    for (const side of [-1, 1]) {
      for (let index = 0; index < 4; index += 1) {
        const phase = gameTime * 12 + index * 1.1 + (side > 0 ? Math.PI : 0);
        const swing = Math.sin(phase) * 2.1 * gait;
        const lift = Math.max(0, Math.sin(phase)) * 1.3 * gait;
        const front = index === 3 ? brace * 2 : 0;
        const baseX = -8 + index * 4.8;
        const kneeX = baseX - 1.5 + (index - 1.5) * 0.8 + front * 0.8;
        const kneeY = side * (10.5 + (index % 2) * 1.5 + front * 1.2);
        const footX = baseX + 1 + (index - 1.5) * 2.4 + swing + front * 3;
        const footY = side * (19 + (index % 2) * 2) - side * lift + side * front * 1.5;
        context.moveTo(baseX, side * 4.6);
        context.lineTo(kneeX, kneeY);
        context.lineTo(footX, footY);
        legJoints.push([kneeX, kneeY]);
      }
    }
    context.stroke();
    context.fillStyle = BODY_RIM_COLOR;
    context.globalAlpha = baseAlpha * 0.75;
    for (const [kneeX, kneeY] of legJoints) {
      context.fillRect(kneeX - 0.7, kneeY - 0.7, 1.4, 1.4);
    }
    context.globalAlpha = baseAlpha;

    // 腹部：深蓝底、浅蓝描边和两侧纹样。
    context.fillStyle = BODY_COLOR;
    context.beginPath();
    context.ellipse(-4.2, 0, 11.2, 10.5, 0, 0, TWO_PI);
    context.fill();
    context.strokeStyle = BODY_RIM_COLOR;
    context.lineWidth = 1.1;
    context.stroke();
    context.fillStyle = MARK_COLOR;
    context.globalAlpha = baseAlpha * 0.48;
    context.beginPath();
    context.ellipse(-5.5, -7.2, 1.4, 0.7, -0.45, 0, TWO_PI);
    context.ellipse(-5.5, 7.2, 1.4, 0.7, 0.45, 0, TWO_PI);
    context.fill();
    context.globalAlpha = baseAlpha;

    // 头胸部。
    context.fillStyle = CARAPACE_COLOR;
    context.beginPath();
    context.ellipse(7, 0, 7.5, 6.8, 0, 0, TWO_PI);
    context.fill();
    context.strokeStyle = BODY_RIM_COLOR;
    context.lineWidth = 1.1;
    context.stroke();

    // 副眼与主眼。
    context.fillStyle = "#9fc8e2";
    context.beginPath();
    context.arc(8.6, -4.4, 0.8, 0, TWO_PI);
    context.arc(8.6, 4.4, 0.8, 0, TWO_PI);
    context.fill();
    context.fillStyle = EYE_COLOR;
    context.beginPath();
    context.arc(10.8, -2.4, 1.35, 0, TWO_PI);
    context.arc(10.8, 2.4, 1.35, 0, TWO_PI);
    context.fill();

    // 口器：咬合时轻微开合。
    const snap = state.biting ? Math.sin(biteProgress * Math.PI) : 0;
    context.strokeStyle = "#9fc8e2";
    context.lineWidth = 1.1;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(12.2, -1.2 - snap * 0.8);
    context.lineTo(14.2, -2.2 - snap * 0.9);
    context.moveTo(12.2, 1.2 + snap * 0.8);
    context.lineTo(14.2, 2.2 + snap * 0.9);
    context.stroke();

    context.restore();
  }

  const spiderDefinition = {
    id: "spider",
    name: "\u8718\u86db",
    englishName: "Spider",
    color: BODY_COLOR,
    description: "1.5\u79d2\u6295\u63b7\u76f8\u5bf9\u5f80\u8fd4\u86db\u7f51 / \u7f51\u51850.05\u500d\u901f\u65e0\u6cd5\u653b\u51fb / \u722c\u7ebf\u6495\u54ac",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services) {
      let phase = "cooldown";
      let cooldown = 0;
      let web = null;
      let trappedTarget = null;
      let slowEffect = null;
      let biteTimer = 0;
      let biting = false;
      let spiderLocked = false;
      let targetAngle = 0;

      function setSpiderLocked(locked) {
        if (spiderLocked === locked) return;
        spiderLocked = locked;
        services.setMovementLocked(locked);
      }

      function releaseSlow(context) {
        if (!slowEffect) return;
        // 借用（交换换位）会把状态挪到另一具身体上，所以按 id 在可能的持有者
        // 上找回来清除。id 带投掷者的 instanceId，只可能清掉自己这张网。
        const holders = [trappedTarget];
        if (context) holders.push(context.ball, context.previousBall);
        for (const holder of holders) {
          if (!holder || !holder.effects || !holder.effects.has(slowEffect.id)) continue;
          // 统一移除：引擎跑完 onExpire、失效缓存并立刻重新合成速度。
          services.clearEffect(holder, slowEffect.id);
          break;
        }
        slowEffect = null;
      }

      function fadeWeb() {
        if (!web || !web.geometry) return;
        services.spawnVisualEffect(createWebFadeEffect(web, services.getTime()));
      }

      function resetCycle(context) {
        fadeWeb();
        releaseSlow(context);
        setSpiderLocked(false);
        phase = "cooldown";
        cooldown = 0;
        web = null;
        trappedTarget = null;
        biteTimer = 0;
        biting = false;
      }

      function launchWeb(ball, target, now) {
        phase = "outbound";
        cooldown = 0;
        biteTimer = 0;
        biting = false;
        const visualSeed = hashText([
          ball.instanceId,
          target.instanceId,
          Math.round(ball.x * 10),
          Math.round(ball.y * 10),
          Math.round(target.x * 10),
          Math.round(target.y * 10),
          Math.floor((Number.isFinite(now) ? now : 0) * 1000)
        ].join("|"));
        web = {
          x: ball.x,
          y: ball.y,
          prevX: ball.x,
          prevY: ball.y,
          offsetX: 0,
          offsetY: 0,
          lockedOffsetX: target.x - ball.x,
          lockedOffsetY: target.y - ball.y,
          lockedX: target.x,
          lockedY: target.y,
          radius: WEB_RADIUS,
          speed: ball.speed * WEB_SPEED_MULTIPLIER,
          visualSeed,
          geometry: createWebGeometry(WEB_RADIUS, visualSeed),
          caughtAt: 0
        };
      }

      function moveWebOffsetToward(ball, offsetX, offsetY, dt) {
        web.prevX = web.x;
        web.prevY = web.y;
        const distance = Math.hypot(offsetX - web.offsetX, offsetY - web.offsetY);
        const travel = web.speed * Math.max(0, dt);
        if (distance <= travel + EPSILON) {
          web.offsetX = offsetX;
          web.offsetY = offsetY;
          web.x = ball.x + web.offsetX;
          web.y = ball.y + web.offsetY;
          return true;
        }
        const direction = normalizeDirection(
          offsetX - web.offsetX,
          offsetY - web.offsetY
        );
        web.offsetX += direction.x * travel;
        web.offsetY += direction.y * travel;
        web.x = ball.x + web.offsetX;
        web.y = ball.y + web.offsetY;
        return false;
      }

      function catchTarget(source, target, now) {
        const profile = services.getContactProfile(target);
        if (profile.solid === false || profile.attackable === false) return false;
        phase = "trapped";
        trappedTarget = target;
        biteTimer = 0;
        biting = false;
        slowEffect = services.applyEffect(
          target,
          createWebSlowEffect(source, web.visualSeed),
          source
        );
        if (!slowEffect) return false;
        web.caughtAt = now;
        services.spawnParticleBurst({
          kind: "spider-web-catch",
          x: web.x,
          y: web.y,
          count: 10,
          shape: "rect",
          colors: [WEB_TRAPPED_CORE_COLOR, WEB_CORE_COLOR, WEB_UNDER_COLOR],
          minLength: 0.4,
          maxLength: 1.2,
          minWidth: 0.3,
          maxWidth: 0.7,
          minSpeed: 12,
          maxSpeed: 36,
          initialRadius: 4,
          gravityY: 20,
          drag: 3,
          life: 0.28
        });
        return true;
      }

      function findTravelContact() {
        let caught = null;
        let earliestProgress = Infinity;
        services.forEachEnemy((target) => {
          const profile = services.getContactProfile(target);
          if (profile.solid === false || profile.attackable === false) return;
          const progress = relativeTravelContact(web, target);
          if (progress === null || progress >= earliestProgress) return;
          caught = target;
          earliestProgress = progress;
        });
        return caught ? { target: caught, progress: earliestProgress } : null;
      }

      function updateTravel(context, dt) {
        web.lockedX = context.ball.x + web.lockedOffsetX;
        web.lockedY = context.ball.y + web.lockedOffsetY;
        // The web is only ever thrown out: once it reaches its locked point
        // it simply vanishes instead of being pulled back.
        if (phase !== "outbound") {
          resetCycle();
          return;
        }
        if (moveWebOffsetToward(
          context.ball,
          web.lockedOffsetX,
          web.lockedOffsetY,
          dt
        )) {
          resetCycle();
          return;
        }
        const contact = findTravelContact();
        if (contact) {
          web.x = web.prevX + (web.x - web.prevX) * contact.progress;
          web.y = web.prevY + (web.y - web.prevY) * contact.progress;
          if (catchTarget(context.ball, contact.target, context.game.time)) return;
        }
      }

      function updateTrapped(context, dt) {
        const target = trappedTarget;
        const profile = target && target.hp > 0
          ? services.getContactProfile(target)
          : null;
        if (
          !target || target.hp <= 0 || !profile ||
          profile.solid === false || profile.attackable === false ||
          !trappedWebContains(web, target)
        ) {
          resetCycle();
          return;
        }

        targetAngle = Math.atan2(target.y - context.ball.y, target.x - context.ball.x);
        const distance = Math.hypot(target.x - context.ball.x, target.y - context.ball.y);
        const targetRadius = Number.isFinite(target.radius) ? target.radius : 0;
        biting = distance <= BITE_RANGE + targetRadius;
        if (!biting) {
          setSpiderLocked(false);
          const direction = normalizeDirection(
            target.x - context.ball.x,
            target.y - context.ball.y
          );
          const speed = context.ball.speed * WEB_SPEED_MULTIPLIER;
          context.ball.vx = context.ball.storedVx = direction.x * speed;
          context.ball.vy = context.ball.storedVy = direction.y * speed;
          return;
        }

        setSpiderLocked(true);
        biteTimer += Math.max(0, dt);
        while (biteTimer + EPSILON >= BITE_INTERVAL && target.hp > 0) {
          biteTimer -= BITE_INTERVAL;
          services.dealDamage(target, BITE_DAMAGE, context.ball);
        }
      }

      function updateFacing(ball) {
        const target = trappedTarget && trappedTarget.hp > 0
          ? trappedTarget
          : services.getOpponent();
        if (!target) return;
        targetAngle = Math.atan2(target.y - ball.y, target.x - ball.x);
      }

      return {
        update(context, dt) {
          const step = Math.max(0, dt);
          updateFacing(context.ball);
          if (phase === "cooldown") {
            cooldown = Math.min(WEB_INTERVAL, cooldown + step);
            return;
          }
          if (phase === "outbound") return;
          updateTrapped(context, step);
        },
        getNextTransitionIn() {
          return phase === "cooldown"
            ? Math.max(EPSILON, WEB_INTERVAL - cooldown)
            : undefined;
        },
        afterUpdateStep(context, dt) {
          if (phase === "outbound") {
            updateTravel(context, Math.max(0, dt));
            return;
          }
          if (phase === "cooldown" && cooldown + EPSILON >= WEB_INTERVAL) {
            const target = services.getOpponent();
            if (target) launchWeb(context.ball, target, context.game.time);
          }
        },
        onDeath(context) {
          resetCycle(context);
        },
        onAbilitySealed(context) {
          resetCycle(context);
        },
        onBorrowEnd(context) {
          resetCycle(context);
        },
        onAttackTransfer(context) {
          // 网是挂在投掷者身上的：借用开始/归还时都不属于新本体，直接收掉。
          resetCycle(context);
        },
        drawArenaBackground(context, canvasContext) {
          if (!web) return;
          const trapped = phase === "trapped";
          drawWebShape(canvasContext, web, {
            gameTime: context.game.time,
            trapped,
            alpha: 1,
            snap: true
          });
          // 拖丝压在蛛网上，避免被网丝吞掉；两层都在球下方，不会遮血量。
          drawWebTether(
            canvasContext,
            context.ball,
            web,
            trapped ? trappedTarget : null,
            trapped,
            context.game.time
          );
        },
        drawBody(context, canvasContext) {
          drawSpiderBody(canvasContext, context.ball, {
            biting,
            biteTimer,
            targetAngle
          }, context.game.time);
          return true;
        },
        getSpiderState() {
          return {
            phase,
            cooldown,
            web,
            trappedTarget,
            slowEffect,
            biteTimer,
            biting,
            spiderLocked,
            targetAngle
          };
        }
      };
    }
  };

  registerBall(spiderDefinition);
  return { spiderDefinition };
});
