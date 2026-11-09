(function initializeRubberBand(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createRubberBandPlugin({ getArenaWallContacts, registerBall }) {
  const BODY_COLOR = "#c6a437";
  const BAND_DARK = "#665218";
  const BAND_MID = "#a88725";
  const BAND_LIGHT = "#e2c760";
  const BAND_LIFE = Number.MAX_SAFE_INTEGER;
  const LINE_COOLDOWN = 10;
  const RION_CYCLE_DURATION = 5;
  const BAND_WIDTH = 5;
  const BAND_HALF_WIDTH = BAND_WIDTH / 2;
  const MIN_STRETCH_DURATION = 0.5;
  const MAX_STRETCH_DURATION = 1.2;
  const MIN_STRETCH_SPEED = 0.1;
  const LAUNCH_SPEED_MULTIPLIER = 5;
  const WALL_DAMAGE = 6;
  const MAX_LAUNCH_DURATION = 3;
  const SHIELD_DEFLECTION_DURATION = 0.12;
  const SHIELD_DEFLECTION_DISTANCE = 10;
  const IMPACT_RING_RED = 238 / 255;
  const IMPACT_RING_GREEN = 228 / 255;
  const IMPACT_RING_BLUE = 191 / 255;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
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

  function wallPoint(context) {
    const { x, y } = getArenaWallContacts(context)[0];
    return { x, y };
  }

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function decorateLineGeometry(line) {
    const deltaX = line.end.x - line.start.x;
    const deltaY = line.end.y - line.start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const length = Math.sqrt(lengthSquared) || 1;
    line.deltaX = deltaX;
    line.deltaY = deltaY;
    line.length = length;
    line.lengthSquared = lengthSquared;
    line.normalX = -deltaY / length;
    line.normalY = deltaX / length;
    return line;
  }

  function pathCrossesBand(target, line) {
    const pathX = target.x - target.prevX;
    const pathY = target.y - target.prevY;
    const denominator = crossProduct(pathX, pathY, line.deltaX, line.deltaY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = line.start.x - target.prevX;
    const offsetY = line.start.y - target.prevY;
    const pathProgress = crossProduct(offsetX, offsetY, line.deltaX, line.deltaY) / denominator;
    const lineProgress = crossProduct(offsetX, offsetY, pathX, pathY) / denominator;
    return pathProgress >= -EPSILON && pathProgress <= 1 + EPSILON &&
      lineProgress >= -EPSILON && lineProgress <= 1 + EPSILON;
  }

  function bandProgress(x, y, line) {
    return line.lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((x - line.start.x) * line.deltaX + (y - line.start.y) * line.deltaY) /
          line.lengthSquared,
        0,
        1
      );
  }

  function distanceSquaredToBand(x, y, line) {
    const progress = bandProgress(x, y, line);
    const distanceX = x - (line.start.x + line.deltaX * progress);
    const distanceY = y - (line.start.y + line.deltaY * progress);
    return distanceX * distanceX + distanceY * distanceY;
  }

  function signedDistanceToBand(x, y, line) {
    const progress = bandProgress(x, y, line);
    return (x - (line.start.x + line.deltaX * progress)) * line.normalX +
      (y - (line.start.y + line.deltaY * progress)) * line.normalY;
  }

  function touchesBand(target, line) {
    const touchRadius = target.radius + BAND_HALF_WIDTH;
    return distanceSquaredToBand(target.x, target.y, line) <= touchRadius * touchRadius ||
      pathCrossesBand(target, line);
  }

  function stretchDirection(target, line) {
    const velocityX = target.storedVx || target.vx;
    const velocityY = target.storedVy || target.vy;
    let side = velocityX * line.normalX + velocityY * line.normalY;
    if (Math.abs(side) <= EPSILON) side = signedDistanceToBand(target.x, target.y, line);
    if (Math.abs(side) <= EPSILON) side = 1;
    return { x: line.normalX * Math.sign(side), y: line.normalY * Math.sign(side) };
  }

  function createWallImpact(x, y) {
    const particles = Array.from({ length: 15 }, (_value, index) => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 5 + Math.random() * 20;
      return {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 2 + index % 4,
        shade: index % 3
      };
    });
    return {
      kind: "rubber-band-wall-impact",
      life: 0.65,
      x,
      y,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#eee4bf";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(effect.x, effect.y, 8 + progress * 28, 0, Math.PI * 2);
        context.stroke();
        const spread = 0.45 + progress * 0.9;
        for (let index = 0; index < effect.particles.length; index += 1) {
          const particle = effect.particles[index];
          context.fillStyle = particle.shade === 0
            ? "#d8d0b5"
            : (particle.shade === 1 ? "#786e4c" : BODY_COLOR);
          context.fillRect(
            Math.round(effect.x + particle.x * spread - particle.size / 2),
            Math.round(effect.y + particle.y * spread - particle.size / 2 - progress * 7),
            particle.size,
            particle.size
          );
        }
        context.restore();
      },
      drawGpu({ effect }, batch) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        const radius = 8 + progress * 28;
        const rotationCosine = 0.9238795325;
        const rotationSine = 0.3826834324;
        let unitX = 1;
        let unitY = 0;
        let previousX = effect.x + radius;
        let previousY = effect.y;
        for (let index = 0; index < 16; index += 1) {
          const nextUnitX = unitX * rotationCosine - unitY * rotationSine;
          const nextUnitY = unitX * rotationSine + unitY * rotationCosine;
          const nextX = effect.x + nextUnitX * radius;
          const nextY = effect.y + nextUnitY * radius;
          batch.addLine(
            previousX,
            previousY,
            nextX,
            nextY,
            2,
            IMPACT_RING_RED,
            IMPACT_RING_GREEN,
            IMPACT_RING_BLUE,
            fade
          );
          unitX = nextUnitX;
          unitY = nextUnitY;
          previousX = nextX;
          previousY = nextY;
        }
        const spread = 0.45 + progress * 0.9;
        for (let index = 0; index < effect.particles.length; index += 1) {
          const particle = effect.particles[index];
          const red = particle.shade === 0
            ? 216 / 255
            : (particle.shade === 1 ? 120 / 255 : 198 / 255);
          const green = particle.shade === 0
            ? 208 / 255
            : (particle.shade === 1 ? 110 / 255 : 164 / 255);
          const blue = particle.shade === 0
            ? 181 / 255
            : (particle.shade === 1 ? 76 / 255 : 55 / 255);
          batch.addDisc(
            effect.x + particle.x * spread,
            effect.y + particle.y * spread - progress * 7,
            particle.size * 0.5,
            red,
            green,
            blue,
            fade
          );
        }
      }
    };
  }

  function strokeBandPath(
    context,
    startX,
    startY,
    middleX,
    middleY,
    endX,
    endY,
    color,
    width,
    alpha
  ) {
    const baseAlpha = context.globalAlpha;
    context.globalAlpha = baseAlpha * alpha;
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.moveTo(startX, startY);
    if (Number.isFinite(middleX) && Number.isFinite(middleY)) {
      context.lineTo(middleX, middleY);
    }
    context.lineTo(endX, endY);
    context.stroke();
    context.globalAlpha = baseAlpha;
  }

  function drawBandPath(
    context,
    startX,
    startY,
    middleX,
    middleY,
    endX,
    endY,
    tension = 0
  ) {
    strokeBandPath(
      context,
      startX,
      startY,
      middleX,
      middleY,
      endX,
      endY,
      BAND_DARK,
      BAND_WIDTH + 3,
      0.72
    );
    strokeBandPath(
      context,
      startX,
      startY,
      middleX,
      middleY,
      endX,
      endY,
      BAND_MID,
      BAND_WIDTH,
      1
    );
    strokeBandPath(
      context,
      startX,
      startY,
      middleX,
      middleY,
      endX,
      endY,
      BAND_LIGHT,
      1.4 + tension * 0.6,
      0.78 + tension * 0.18
    );
  }

  function restoreNormalSpeed(ball, directionX, directionY) {
    const direction = normalizeDirection(
      directionX,
      directionY,
      ball.storedVx || ball.vx,
      ball.storedVy || ball.vy
    );
    const speed = ball.speed * ball.speedMultiplier;
    ball.vx = ball.storedVx = direction.x * speed;
    ball.vy = ball.storedVy = direction.y * speed;
  }

  function createPullEffect(line, target) {
    const key = targetKey(target);
    const direction = stretchDirection(target, line);
    const savedDirection = normalizeDirection(
      target.storedVx || target.vx,
      target.storedVy || target.vy,
      direction.x,
      direction.y
    );
    const chargeDuration = MIN_STRETCH_DURATION +
      Math.random() * (MAX_STRETCH_DURATION - MIN_STRETCH_DURATION);
    let completed = false;

    function detach(effect) {
      if (effect.line && effect.line.pullTargets) effect.line.pullTargets.delete(key);
    }

    function cancel(ball, effect, effectServices) {
      if (completed) return;
      completed = true;
      detach(effect);
      restoreNormalSpeed(ball, effect.savedDirectionX, effect.savedDirectionY);
      effectServices.clearEffect(ball, effect.id);
    }

    function launch(ball, effect) {
      effect.phase = "launch";
      effect.progress = 1;
      detach(effect);
      effect.launchX = effect.releaseX;
      effect.launchY = effect.releaseY;
      const speed = ball.speed * ball.speedMultiplier * LAUNCH_SPEED_MULTIPLIER;
      ball.vx = effect.launchX * speed;
      ball.vy = effect.launchY * speed;
    }

    return {
      id: `rubber-band-pull-${line.ownerInstanceId}`,
      bounceCompatible: true,
      duration: chargeDuration + MAX_LAUNCH_DURATION,
      locksMovement: true,
      phase: "stretch",
      elapsed: 0,
      progress: 0,
      chargeDuration,
      stretchX: direction.x,
      stretchY: direction.y,
      releaseX: -direction.x,
      releaseY: -direction.y,
      savedDirectionX: savedDirection.x,
      savedDirectionY: savedDirection.y,
      line,
      onApply({ effect }) {
        line.pullTargets.set(key, { target, pull: effect });
      },
      update({ ball, effect, game, services: effectServices }, dt) {
        const contactProfile = effectServices.getContactProfile(ball);
        if (
          effect.line.entityActive === false || !effect.line.active ||
          contactProfile.solid === false || contactProfile.attackable === false
        ) {
          cancel(ball, effect, effectServices);
          return;
        }
        if (effect.phase === "stretch") {
          effect.elapsed += Math.max(0, dt);
          effect.progress = clamp(effect.elapsed / effect.chargeDuration, 0, 1);
          if (effect.progress + EPSILON >= 1) {
            launch(ball, effect);
            return;
          }
          const speedFactor = 1 - (1 - MIN_STRETCH_SPEED) * effect.progress;
          const speed = ball.speed * ball.speedMultiplier * speedFactor;
          ball.vx = effect.stretchX * speed;
          ball.vy = effect.stretchY * speed;
          return;
        }
        const speed = ball.speed * ball.speedMultiplier * LAUNCH_SPEED_MULTIPLIER;
        ball.vx = effect.launchX * speed;
        ball.vy = effect.launchY * speed;
      },
      onWallBounce({ ball, effect, game, bouncedX, bouncedY, services: effectServices }) {
        if (effect.phase === "stretch") {
          const reflectedX = bouncedX ? -effect.stretchX : effect.stretchX;
          const reflectedY = bouncedY ? -effect.stretchY : effect.stretchY;
          const inward = normalizeDirection(ball.vx, ball.vy, reflectedX, reflectedY);
          effect.stretchX = inward.x;
          effect.stretchY = inward.y;
          effect.releaseX = inward.x;
          effect.releaseY = inward.y;
          const speedFactor = 1 - (1 - MIN_STRETCH_SPEED) * effect.progress;
          const speed = ball.speed * ball.speedMultiplier * speedFactor;
          ball.vx = effect.stretchX * speed;
          ball.vy = effect.stretchY * speed;
          return;
        }
        if (effect.phase !== "launch" || completed) return;
        completed = true;
        detach(effect);
        effectServices.dealDamage(ball, WALL_DAMAGE);
        effectServices.spawnVisualEffect(createWallImpact(ball.x, ball.y));
        restoreNormalSpeed(ball, ball.vx, ball.vy);
        effectServices.clearEffect(ball, effect.id);
      },
      onExpire({ ball, effect }) {
        detach(effect);
        if (!completed && ball.hp > 0) {
          restoreNormalSpeed(ball, effect.savedDirectionX, effect.savedDirectionY);
        }
      },
      drawBefore({ ball, effect }, context) {
        if (effect.phase !== "launch") return;
        const normalX = -effect.launchY;
        const normalY = effect.launchX;
        const tailLength = ball.radius + 18;
        context.save();
        context.lineCap = "round";
        for (let index = -1; index <= 1; index += 1) {
          const sideOffset = index * 4;
          const alpha = index === 0 ? 0.72 : 0.34;
          context.globalAlpha *= alpha;
          context.strokeStyle = index === 0 ? BAND_LIGHT : BAND_MID;
          context.lineWidth = index === 0 ? 2.2 : 1.2;
          context.beginPath();
          context.moveTo(
            ball.x + normalX * sideOffset - effect.launchX * ball.radius * 0.4,
            ball.y + normalY * sideOffset - effect.launchY * ball.radius * 0.4
          );
          context.lineTo(
            ball.x + normalX * sideOffset - effect.launchX * tailLength,
            ball.y + normalY * sideOffset - effect.launchY * tailLength
          );
          context.stroke();
          context.globalAlpha /= alpha;
        }
        context.restore();
      },
      draw({ ball, effect }, context) {
        if (effect.phase !== "stretch") return;
        const pulse = 0.45 + effect.progress * 0.55;
        context.save();
        context.globalAlpha *= pulse;
        context.strokeStyle = BAND_LIGHT;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 4 + effect.progress * 3, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createBandLine(start, end) {
    return decorateLineGeometry({
      kind: "rubber-band-line",
      life: BAND_LIFE,
      permanent: true,
      active: true,
      roundShieldResponse: "reflect",
      shieldDeflection: null,
      start,
      end,
      width: BAND_WIDTH,
      contacts: new Set(),
      touchingContacts: new Set(),
      pullTargets: new Map(),
      drawLayer: "background",
      onShieldDeflected({ entity, contact, game, directionX, directionY }) {
        entity.shieldDeflection = {
          startedAt: game.time,
          endsAt: game.time + SHIELD_DEFLECTION_DURATION,
          x: contact.x,
          y: contact.y,
          directionX,
          directionY
        };
      },
      update({ effect, services: lineServices }) {
        const touching = effect.touchingContacts;
        touching.clear();
        lineServices.forEachEnemy((target) => {
          const key = targetKey(target);
          const contactProfile = lineServices.getContactProfile(target);
          if (contactProfile.solid === false || contactProfile.attackable === false) {
            effect.contacts.delete(key);
            return;
          }
          if (!touchesBand(target, effect)) {
            effect.contacts.delete(key);
            return;
          }
          touching.add(key);
          if (effect.contacts.has(key)) return;
          effect.contacts.add(key);
          if (target.effects.has(`rubber-band-pull-${effect.ownerInstanceId}`)) return;
          lineServices.applyEffect(target, createPullEffect(effect, target));
        });
        for (const key of effect.contacts) {
          if (!touching.has(key)) effect.contacts.delete(key);
        }
      },
      draw({ effect, game }, context) {
        let stretched = null;
        for (const entry of effect.pullTargets.values()) {
          if (
            entry.target.hp > 0 && entry.pull.phase === "stretch" &&
            (!stretched || entry.pull.progress > stretched.pull.progress)
          ) stretched = entry;
        }
        const shieldDeflection = effect.shieldDeflection &&
          effect.shieldDeflection.endsAt > game.time
          ? effect.shieldDeflection
          : null;
        if (!shieldDeflection) effect.shieldDeflection = null;
        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.shadowColor = BAND_LIGHT;
        context.shadowBlur = stretched ? 4 : 0;
        if (stretched) {
          const shake = Math.sin(game.time * (24 + stretched.pull.progress * 22)) *
            (1 - stretched.pull.progress) * 2.2;
          drawBandPath(
            context,
            effect.start.x,
            effect.start.y,
            stretched.target.x + effect.normalX * shake,
            stretched.target.y + effect.normalY * shake,
            effect.end.x,
            effect.end.y,
            stretched.pull.progress
          );
        } else if (shieldDeflection) {
          const tension = clamp(
            (shieldDeflection.endsAt - game.time) / SHIELD_DEFLECTION_DURATION,
            0,
            1
          );
          drawBandPath(
            context,
            effect.start.x,
            effect.start.y,
            shieldDeflection.x +
              shieldDeflection.directionX * SHIELD_DEFLECTION_DISTANCE * tension,
            shieldDeflection.y +
              shieldDeflection.directionY * SHIELD_DEFLECTION_DISTANCE * tension,
            effect.end.x,
            effect.end.y,
            tension
          );
        } else {
          drawBandPath(
            context,
            effect.start.x,
            effect.start.y,
            null,
            null,
            effect.end.x,
            effect.end.y,
            0
          );
        }
        context.restore();
      }
    });
  }

  const rubberBandDefinition = {
    id: "rubberBand",
    name: "\u6a61\u80f6\u5e26",
    englishName: "Rubber Band",
    color: BODY_COLOR,
    description: "\u4e24\u6b21\u78b0\u58c1\u5e03\u7f6e\u6c38\u4e45\u6a61\u80f6\u5e26 / 10\u79d2\u540e\u53ef\u518d\u6b21\u5e03\u7ebf / \u649e\u5899 -4",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: RION_CYCLE_DURATION,
    createBehavior(services) {
      let firstPoint = null;
      let cooldown = 0;
      const lines = [];

      return {
        update(_context, dt) {
          cooldown = Math.max(0, cooldown - Math.max(0, dt));
        },
        onWallBounce(context) {
          if (cooldown > EPSILON) return;
          const point = wallPoint(context);
          if (!firstPoint) {
            firstPoint = point;
            return;
          }
          if (Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= EPSILON) return;
          lines.push(services.spawnCombatEntity(createBandLine(
            firstPoint,
            point
          )));
          firstPoint = null;
          cooldown = LINE_COOLDOWN;
        },
        drawArenaBackground(context, canvasContext) {
          if (!firstPoint) return;
          canvasContext.save();
          canvasContext.lineCap = "round";
          canvasContext.lineJoin = "round";
          canvasContext.shadowColor = BAND_LIGHT;
          canvasContext.shadowBlur = 2;
          drawBandPath(
            canvasContext,
            firstPoint.x,
            firstPoint.y,
            null,
            null,
            context.ball.x,
            context.ball.y,
            0
          );
          canvasContext.restore();
        },
        getRubberBandState() {
          return {
            firstPoint,
            lines,
            activeLine: lines.length > 0 ? lines[lines.length - 1] : null,
            cooldown
          };
        }
      };
    }
  };

  registerBall(rubberBandDefinition);
  return { rubberBandDefinition };
});
