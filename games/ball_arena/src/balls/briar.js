(function initializeBriar(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBriarPlugin({ registerBall, resolveArenaGeometry }) {
  // The ball bounces freely around the arena and lays a full thorn line on
  // every wall hit: the thorn runs from the touch point along the reflected
  // motion to the opposite wall, so it always spans wall to wall.
  const THORN_DAMAGE = 3;
  const BODY_DAMAGE = 3;
  const MAX_THORNS = 5;
  const THORN_HALF_WIDTH = 2;
  const THORN_SPIKE_SPACING = 13;
  const THORN_FADE_DURATION = 0.35;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function wallPoint(context) {
    const { ball, game } = context;
    if (context.wallContacts && context.wallContacts.length) return context.wallContacts[0];
    const arena = resolveArenaGeometry(game);
    return {
      x: context.bouncedX
        ? (ball.x <= arena.left + ball.radius + EPSILON ? arena.left : arena.right)
        : ball.x,
      y: context.bouncedY
        ? (ball.y <= arena.top + ball.radius + EPSILON ? arena.top : arena.bottom)
        : ball.y
    };
  }

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSquared = abx * abx + aby * aby;
    if (lengthSquared <= EPSILON) return { x: ax, y: ay };
    const t = clamp(
      ((px - ax) * abx + (py - ay) * aby) / lengthSquared,
      0,
      1
    );
    return { x: ax + abx * t, y: ay + aby * t };
  }

  function drawThorn(canvasContext, entity) {
    const { start, end } = entity;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length <= EPSILON) return;
    const ux = (end.x - start.x) / length;
    const uy = (end.y - start.y) / length;
    const nx = -uy;
    const ny = ux;
    const bodyWidth = THORN_HALF_WIDTH * 2;

    canvasContext.save();
    canvasContext.strokeStyle = "#2f7d32";
    canvasContext.lineWidth = bodyWidth;
    canvasContext.lineCap = "round";
    canvasContext.beginPath();
    canvasContext.moveTo(start.x, start.y);
    canvasContext.lineTo(end.x, end.y);
    canvasContext.stroke();

    // Short spikes angled back along the stem, like the reference art.
    canvasContext.strokeStyle = "#256b28";
    canvasContext.lineWidth = 2;
    canvasContext.beginPath();
    for (let distance = 10; distance < length - 4; distance += THORN_SPIKE_SPACING) {
      const x = start.x + ux * distance;
      const y = start.y + uy * distance;
      const spike = 6 + (distance % 2) * 1.5;
      canvasContext.moveTo(x - ux * 3, y - uy * 3);
      canvasContext.lineTo(x + nx * spike, y + ny * spike);
      canvasContext.moveTo(x - ux * 3, y - uy * 3);
      canvasContext.lineTo(x - nx * spike, y - ny * spike);
    }
    canvasContext.stroke();
    canvasContext.restore();
  }

  const briarDefinition = {
    id: "briar",
    name: "\u8346\u68d8",
    englishName: "Briar",
    color: "#3a9c3a",
    description: "\u78b0\u58c1\u5e03\u8346\u68d8 / \u78b0\u5230 -3\u53cd\u5f39 / \u6700\u591a5\u6761",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services) {
      const thorns = [];
      let activeThorn = null;

      function pruneThorns() {
        while (thorns.length > 0 && thorns[0].entityActive === false) {
          thorns.shift();
        }
      }

      // Lay one thorn segment starting at the wall point with its other end
      // pinned to the ball itself, exactly like Laser V2's temp line: the
      // stem stretches and swings with the ball until the next wall hit,
      // which snaps it into a finished wall-to-wall segment and immediately
      // starts the next one from the new touch point.
      function beginSegment(context, point) {
        pruneThorns();
        if (thorns.length >= MAX_THORNS) {
          // The oldest stem fades out instead of vanishing; if it is already
          // fading, drop it for good.
          const retired = thorns.shift();
          if (retired.fadeRemaining > 0) {
            retired.entityActive = false;
          } else {
            retired.fadeRemaining = THORN_FADE_DURATION;
          }
        }
        activeThorn = services.spawnCombatEntity({
          kind: "briar-thorn",
          combatKind: "zone",
          life: PERMANENT_LIFE,
          // Independent so the stem can fade out on its own when the owner
          // dies instead of being dropped instantly by the entity system.
          lifecycle: "independent",
          drawLayer: "background",
          start: { x: point.x, y: point.y },
          end: context.ball,
          halfWidth: THORN_HALF_WIDTH,
          fadeRemaining: 0,
          wasTouching: new Set(),
          update({ entity, services: thornServices, game }, dt) {
            const owner = thornServices.getBall(entity.ownerInstanceId);
            if ((!owner || owner.hp <= 0) && entity.fadeRemaining <= 0) {
              entity.fadeRemaining = THORN_FADE_DURATION;
            }
            if (entity.fadeRemaining > 0) {
              entity.fadeRemaining = Math.max(
                0,
                entity.fadeRemaining - Math.max(0, dt)
              );
              if (entity.fadeRemaining <= 0) entity.entityActive = false;
              return;
            }
            const touching = new Set();
            thornServices.forEachContactEnemy((target) => {
              const contact = closestPointOnSegment(
                target.x,
                target.y,
                entity.start.x,
                entity.start.y,
                entity.end.x,
                entity.end.y
              );
              const deltaX = target.x - contact.x;
              const deltaY = target.y - contact.y;
              const distance = Math.hypot(deltaX, deltaY);
              const minDistance = target.radius + entity.halfWidth;
              thornServices.notifyEntityContact(target, entity, { overlapping: distance < minDistance });
              if (distance >= minDistance) return;

              if (!thornServices.getContactProfile(target).solid) return;
              if (!thornServices.isMovementLocked(target)) {
                // The stem is solid: push the ball out and reflect it.
                const nx = distance > EPSILON ? deltaX / distance : 1;
                const ny = distance > EPSILON ? deltaY / distance : 0;
                Object.assign(target, resolveArenaGeometry(game).clampPoint(
                  contact.x + nx * minDistance, contact.y + ny * minDistance, target.radius));
                const dot = target.vx * nx + target.vy * ny;
                if (dot < 0) {
                  target.vx -= 2 * dot * nx;
                  target.vy -= 2 * dot * ny;
                  target.storedVx = target.vx;
                  target.storedVy = target.vy;
                }
              }
              touching.add(target.instanceId);
              if (entity.wasTouching.has(target.instanceId)) return;
              if (thornServices.tryConsumeEntity(target, entity, { physical: true })) {
                entity.entityActive = false;
                return;
              }
              thornServices.dealDamage(target, THORN_DAMAGE);
            });
            entity.wasTouching = touching;
          },
          draw({ entity }, canvasContext) {
            canvasContext.save();
            if (entity.fadeRemaining > 0) {
              canvasContext.globalAlpha *= clamp(
                entity.fadeRemaining / THORN_FADE_DURATION,
                0,
                1
              );
            }
            drawThorn(canvasContext, entity);
            canvasContext.restore();
          }
        });
        thorns.push(activeThorn);
        return activeThorn;
      }

      return {
        onWallBounce(context) {
          const point = wallPoint(context);
          if (activeThorn) {
            // Snap the live stem off the ball and freeze it at the touch
            // point: it is now a finished wall-to-wall segment.
            activeThorn.end = { x: point.x, y: point.y };
            activeThorn = null;
          }
          beginSegment(context, point);
        },
        onCollision(context, target) {
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, BODY_DAMAGE);
          }
        },
        getBriarState() {
          pruneThorns();
          return {
            growing: activeThorn !== null && activeThorn.entityActive !== false,
            thorns: thorns.map((thorn) => ({
              start: { x: thorn.start.x, y: thorn.start.y },
              end: { x: thorn.end.x, y: thorn.end.y },
              active: thorn.entityActive !== false
            }))
          };
        }
      };
    }
  };

  registerBall(briarDefinition);
  return { briarDefinition };
});
