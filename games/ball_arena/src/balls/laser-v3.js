(function initializeLaserV3(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLaserV3Plugin({ getArenaWallContacts, registerBall }) {
  const FIRE_INTERVAL = 1;
  const BEAM_DURATION = 0.2;
  const BEAM_WIDTH = 4;
  const BEAM_DAMAGE = 1;
  const EMITTER_WIDTH = 4;
  const EMITTER_HEIGHT = 8;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function closestPointOnSegment(pointX, pointY, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function segmentsIntersect(firstStartX, firstStartY, firstEndX, firstEndY,
    secondStartX, secondStartY, secondEndX, secondEndY) {
    const firstX = firstEndX - firstStartX;
    const firstY = firstEndY - firstStartY;
    const secondX = secondEndX - secondStartX;
    const secondY = secondEndY - secondStartY;
    const denominator = crossProduct(firstX, firstY, secondX, secondY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = secondStartX - firstStartX;
    const offsetY = secondStartY - firstStartY;
    const firstProgress = crossProduct(offsetX, offsetY, secondX, secondY) / denominator;
    const secondProgress = crossProduct(offsetX, offsetY, firstX, firstY) / denominator;
    return firstProgress >= -EPSILON && firstProgress <= 1 + EPSILON &&
      secondProgress >= -EPSILON && secondProgress <= 1 + EPSILON;
  }

  function pointSegmentDistanceSquared(pointX, pointY, startX, startY, endX, endY) {
    const closest = closestPointOnSegment(pointX, pointY, startX, startY, endX, endY);
    const deltaX = pointX - closest.x;
    const deltaY = pointY - closest.y;
    return deltaX * deltaX + deltaY * deltaY;
  }

  function sweptBeamContact(target, beam) {
    const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const previousY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    const hitRadius = target.radius + beam.width / 2;
    if (segmentsIntersect(
      previousX,
      previousY,
      target.x,
      target.y,
      beam.startX,
      beam.startY,
      beam.endX,
      beam.endY
    )) return true;
    const distanceSquared = Math.min(
      pointSegmentDistanceSquared(
        previousX, previousY, beam.startX, beam.startY, beam.endX, beam.endY
      ),
      pointSegmentDistanceSquared(
        target.x, target.y, beam.startX, beam.startY, beam.endX, beam.endY
      ),
      pointSegmentDistanceSquared(
        beam.startX, beam.startY, previousX, previousY, target.x, target.y
      ),
      pointSegmentDistanceSquared(
        beam.endX, beam.endY, previousX, previousY, target.x, target.y
      )
    );
    return distanceSquared <= hitRadius * hitRadius + EPSILON;
  }

  function drawBeam(beam, context) {
    const fade = clamp((beam.life - beam.age) / beam.life, 0, 1);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.88 * fade;
    context.shadowColor = "#ff442f";
    context.shadowBlur = 7;
    context.strokeStyle = "rgba(168, 43, 28, 0.7)";
    context.lineWidth = beam.width + 4;
    context.beginPath();
    context.moveTo(beam.startX, beam.startY);
    context.lineTo(beam.endX, beam.endY);
    context.stroke();
    context.shadowBlur = 3;
    context.strokeStyle = "#d94a35";
    context.lineWidth = beam.width;
    context.stroke();
    context.strokeStyle = "#ffd0b5";
    context.lineWidth = 1;
    context.stroke();
    context.restore();
  }

  function createBeam(emitter, arenaSize, arena) {
    let endX = emitter.x + emitter.normalX * arenaSize;
    let endY = emitter.y + emitter.normalY * arenaSize;
    if (arena && arena.shape !== "square") {
      const hit = arena.traceSegment(emitter.x, emitter.y,
        emitter.x + emitter.normalX * arenaSize * 2,
        emitter.y + emitter.normalY * arenaSize * 2);
      if (hit) { endX = hit.x; endY = hit.y; }
    }
    return {
      kind: "laser-v3-beam",
      combatKind: "zone",
      life: BEAM_DURATION,
      drawLayer: "background",
      width: BEAM_WIDTH,
      damage: BEAM_DAMAGE,
      startX: emitter.x,
      startY: emitter.y,
      endX,
      endY,
      hitTargets: new Set(),
      update({ entity: beam, services }) {
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (beam.hitTargets.has(key)) return;
          if (!services.getContactProfile(target).attackable) return;
          if (!sweptBeamContact(target, beam)) return;
          if (services.dealDamage(target, BEAM_DAMAGE)) beam.hitTargets.add(key);
        });
      },
      draw({ entity: beam }, context) {
        drawBeam(beam, context);
      }
    };
  }

  function drawEmitter(emitter, context) {
    context.save();
    context.translate(emitter.x, emitter.y);
    context.rotate(Math.atan2(emitter.normalY, emitter.normalX) - Math.PI / 2);
    context.fillStyle = "#8f392d";
    context.strokeStyle = "#e07357";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(-EMITTER_WIDTH / 2, 0);
    context.lineTo(EMITTER_WIDTH / 2, 0);
    context.lineTo(1.6, 3);
    context.lineTo(1.1, 5.5);
    context.lineTo(0, EMITTER_HEIGHT);
    context.lineTo(-1.1, 5.5);
    context.lineTo(-1.6, 3);
    context.closePath();
    context.fill();
    context.stroke();
    context.fillStyle = "#ff8666";
    context.fillRect(-1, 2, 2, 1);
    context.fillRect(-0.6, 4.5, 1.2, 1);
    context.restore();
  }

  function createEmitter(x, y, normalX, normalY, arenaSize) {
    return {
      kind: "laser-v3-emitter",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      solid: false,
      x,
      y,
      normalX,
      normalY,
      width: EMITTER_WIDTH,
      height: EMITTER_HEIGHT,
      fireTimer: 0,
      shotsFired: 0,
      update({ entity: emitter, game, services: emitterServices }, dt) {
        emitter.fireTimer += Math.max(0, dt);
        while (emitter.fireTimer + EPSILON >= FIRE_INTERVAL) {
          emitter.fireTimer = Math.max(0, emitter.fireTimer - FIRE_INTERVAL);
          emitterServices.spawnCombatEntity(createBeam(emitter, arenaSize, game.arena));
          emitterServices.playSound("ability", { cue: "beam" });
          emitter.shotsFired += 1;
        }
      },
      draw({ entity: emitter }, context) {
        drawEmitter(emitter, context);
      }
    };
  }

  function wallEmitters(context) {
    return getArenaWallContacts(context);
  }

  const laserV3Definition = {
    id: "laserV3",
    name: "\u6fc0\u5149V3",
    englishName: "Laser V3",
    color: "#9f4938",
    description: "\u78b0\u58c1\u7559\u4e0b\u6c38\u4e45\u53d1\u5c04\u5668 / \u6bcf1\u79d2\u53d1\u5c040.2\u79d2\u6fc0\u5149 / -1",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      const emitters = [];
      return {
        onWallBounce(context) {
          wallEmitters(context).forEach((placement) => {
            emitters.push(services.spawnCombatEntity(createEmitter(
              placement.x,
              placement.y,
              placement.normalX,
              placement.normalY,
              context.game.arenaSize
            )));
          });
        },
        getLaserV3State() {
          return { emitters: emitters.filter((emitter) => emitter.entityActive !== false) };
        }
      };
    }
  };

  registerBall(laserV3Definition);
  return { laserV3Definition };
});
