(function initializeArmor(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createArmorPlugin({ registerBall, createArenaGeometry, createKnockbackEffect: createSharedKnockback }) {
  const SHIELD_INTERVAL = 1.2;
  const MAX_SHIELDS = 3;
  const SHIELD_THICKNESS = 5;
  const SHIELD_SPAN = Math.PI / 3;
  const SHIELD_ORBIT_OFFSET = SHIELD_THICKNESS / 2;
  const SHIELD_EMERGE_DURATION = 0.25;
  const ROTATION_PERIOD = 8;
  const FUSE_DURATION = 2;
  const SHIELD_TOUCH_RADIUS = 2;
  const SHIELD_HIT_DAMAGE = 5;
  const KNOCKBACK_DURATION = 0.2;
  const KNOCKBACK_SPEED_MULTIPLIER = 1.6;
  const SHELL_SPEED = 600;
  const SHELL_DAMAGE = 7;
  const SHELL_RADIUS = 9;
  const SHELL_LIFE = 3600;
  const STUN_DURATION = 0.3;
  const STUN_SPEED_FACTOR = 0.1;
  const TRAIL_DURATION = 0.4;
  const BODY_COLOR = "#6d7d94";
  const SHIELD_COLOR = "#7d8ca3";
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function wrapAngle(angle) {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = x;
    let directionY = y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function segmentProgress(startX, startY, endX, endY, target, radius) {
    const lineX = endX - startX;
    const lineY = endY - startY;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((target.x - startX) * lineX + (target.y - startY) * lineY) /
          lengthSquared,
        0,
        1
      );
    const closestX = startX + lineX * progress;
    const closestY = startY + lineY * progress;
    return Math.hypot(target.x - closestX, target.y - closestY) <= target.radius + radius
      ? progress
      : null;
  }

  function shakeOffset(time) {
    return {
      x: Math.sin(time * 97) * 1.4,
      y: Math.cos(time * 83) * 1.4
    };
  }

  function shieldCenterAngle(rotation, shield) {
    return rotation + shield.offset;
  }

  // Distance from a point to the nearest point of a 120-degree shield arc
  // centered on `centerAngle` at radius `orbitRadius`.
  function pointToShieldArc(distance, pointAngle, centerAngle, orbitRadius) {
    const delta = Math.abs(wrapAngle(pointAngle - centerAngle));
    if (delta <= SHIELD_SPAN) {
      return Math.abs(distance - orbitRadius);
    }
    const cornerAngle = SHIELD_SPAN;
    return Math.sqrt(
      distance * distance + orbitRadius * orbitRadius -
        2 * distance * orbitRadius * Math.cos(cornerAngle)
    );
  }

  function createKnockbackEffect(source, target, normalX, normalY) {
    // The enemy is bounced off the shield first: its velocity is reflected
    // across the radial normal, then the reflected direction is accelerated.
    // Accelerating along the original heading would let the enemy push
    // straight through the shield.
    let directionX = Math.abs(target.vx) + Math.abs(target.vy) > EPSILON
      ? target.vx
      : target.storedVx;
    let directionY = Math.abs(target.vx) + Math.abs(target.vy) > EPSILON
      ? target.vy
      : target.storedVy;
    let speed = Math.hypot(directionX, directionY);
    if (speed <= EPSILON) {
      directionX = normalX;
      directionY = normalY;
      speed = target.speed * target.speedMultiplier;
    } else {
      const inwardDot = directionX * normalX + directionY * normalY;
      if (inwardDot < 0) {
        directionX -= 2 * inwardDot * normalX;
        directionY -= 2 * inwardDot * normalY;
      }
    }
    const direction = normalizeDirection(directionX, directionY, normalX, normalY);
    const knockedSpeed = speed * KNOCKBACK_SPEED_MULTIPLIER;
    return createSharedKnockback({
      id: "armor-knockback",
      duration: KNOCKBACK_DURATION,
      directionX: direction.x,
      directionY: direction.y,
      speed: knockedSpeed
    });
  }
  function createShellStun(directionX, directionY) {
    const direction = normalizeDirection(directionX, directionY);
    return {
      id: "armor-shell-stun",
      bounceCompatible: true,
      visualType: "stun",
      duration: STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      directionX: direction.x,
      directionY: direction.y,
      onApply({ ball, effect }) {
        effect.savedVx = ball.storedVx;
        effect.savedVy = ball.storedVy;
        const speed = ball.speed * ball.speedMultiplier * STUN_SPEED_FACTOR;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      update({ ball, effect }) {
        const speed = ball.speed * ball.speedMultiplier * STUN_SPEED_FACTOR;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      onWallBounce({ ball, effect }) {
        const bounced = normalizeDirection(
          ball.vx,
          ball.vy,
          effect.directionX,
          effect.directionY
        );
        effect.directionX = bounced.x;
        effect.directionY = bounced.y;
      },
      onExpire({ ball, effect }) {
        ball.vx = ball.storedVx = effect.savedVx;
        ball.vy = ball.storedVy = effect.savedVy;
      },
      drawBefore({ ball, effect, game }, context) {
        const offset = shakeOffset(game.time);
        effect.renderOffsetX = offset.x;
        effect.renderOffsetY = offset.y;
        context.translate(offset.x, offset.y);
      },
      draw({ ball, effect }, context) {
        context.save();
        context.translate(-(effect.renderOffsetX || 0), -(effect.renderOffsetY || 0));
        context.strokeStyle = "rgba(190, 200, 215, 0.75)";
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    };
  }

  function createShellTrail(state) {
    return {
      kind: "armor-shell-trail",
      life: SHELL_LIFE,
      duration: TRAIL_DURATION,
      drawLayer: "background",
      points: state.points,
      update({ effect }, dt) {
        state.time += Math.max(0, dt);
        while (
          state.points.length > 0 &&
          state.time - state.points[0].createdAt > TRAIL_DURATION + EPSILON
        ) {
          state.points.shift();
        }
        if (!state.active && state.points.length === 0) effect.life = 0;
      },
      draw(_context, canvasContext) {
        if (state.points.length < 2) return;
        canvasContext.save();
        const baseAlpha = canvasContext.globalAlpha;
        canvasContext.lineCap = "round";
        canvasContext.lineJoin = "round";
        for (let index = 1; index < state.points.length; index += 1) {
          const point = state.points[index];
          const remaining = Math.max(
            0,
            1 - (state.time - point.createdAt) / TRAIL_DURATION
          );
          canvasContext.globalAlpha = baseAlpha * remaining * 0.45;
          canvasContext.strokeStyle = "rgba(150, 160, 175, 0.9)";
          canvasContext.lineWidth = 3 + remaining * 1.5;
          canvasContext.beginPath();
          canvasContext.moveTo(state.points[index - 1].x, state.points[index - 1].y);
          canvasContext.lineTo(point.x, point.y);
          canvasContext.stroke();
        }
        canvasContext.restore();
      }
    };
  }

  function addTrailPoint(state, x, y) {
    const last = state.points[state.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) <= EPSILON) return;
    state.points.push({ x, y, createdAt: state.time });
  }

  function shellShatterOptions(x, y) {
    return {
      kind: "armor-shell-shatter",
      x,
      y,
      life: 0.65,
      density: 1.25,
      minDiameter: 1,
      maxDiameter: 5,
      minSpeed: 38,
      maxSpeed: 118,
      initialRadius: 4,
      drag: 2.5,
      gravityY: -10,
      colors: ["#d8dde3", "#7d8ca3", "#b9c2cf"]
    };
  }

  function drawShell(context, effect) {
    // The thrown shield keeps its face toward the flight direction: the arc
    // band's symmetry axis follows the shell's heading, so the convex outer
    // face leads the way. The grey trail is drawn by the separate trail effect.
    const angle = Math.atan2(effect.vy, effect.vx);
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);
    context.fillStyle = "rgba(125, 140, 160, 0.92)";
    context.beginPath();
    context.arc(0, 0, SHELL_RADIUS, -SHIELD_SPAN, SHIELD_SPAN);
    context.arc(0, 0, SHELL_RADIUS - 4, SHIELD_SPAN, -SHIELD_SPAN, true);
    context.closePath();
    context.fill();
    context.strokeStyle = "rgba(228, 236, 246, 0.85)";
    context.lineWidth = 0.9;
    context.stroke();
    context.restore();
  }

  function createShell(services, source, x, y, angle) {
    const trailState = {
      active: true,
      time: 0,
      points: [{ x, y, createdAt: 0 }]
    };
    services.spawnVisualEffect(createShellTrail(trailState));
    return {
      kind: "armor-shell",
      life: SHELL_LIFE,
      radius: SHELL_RADIUS,
      damage: SHELL_DAMAGE,
      color: SHIELD_COLOR,
      x,
      y,
      vx: Math.cos(angle) * SHELL_SPEED,
      vy: Math.sin(angle) * SHELL_SPEED,
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;

        let hit = null;
        let hitProgress = Infinity;
        entityServices.forEachEnemy((target) => {
          const progress = segmentProgress(
            startX,
            startY,
            effect.x,
            effect.y,
            target,
            SHELL_RADIUS
          );
          if (progress !== null && progress < hitProgress) {
            hit = target;
            hitProgress = progress;
          }
        });

        if (hit && entityServices.dealDamage(hit, SHELL_DAMAGE)) {
          effect.x = startX + (effect.x - startX) * hitProgress;
          effect.y = startY + (effect.y - startY) * hitProgress;
          const direction = normalizeDirection(effect.vx, effect.vy);
          entityServices.applyEffect(
            hit,
            createShellStun(direction.x, direction.y)
          );
          entityServices.spawnParticleBurst(shellShatterOptions(effect.x, effect.y));
          trailState.active = false;
          effect.life = 0;
          effect.entityActive = false;
          return;
        }

        const arena = game.arena || createArenaGeometry(game.arenaSize);
        const wall = arena.traceSegment(startX, startY, startX + effect.vx * dt, startY + effect.vy * dt, SHELL_RADIUS);
        const motion = { ...arena.clampPoint(startX + effect.vx * dt, startY + effect.vy * dt, SHELL_RADIUS), bounces: wall ? 1 : 0 };
        if (wall && arena.shape === "circle") { motion.x = wall.x; motion.y = wall.y; }
        Object.assign(effect, { x: motion.x, y: motion.y });
        if (wall) {
          if (arena.shape !== "circle" && wall.normalX && wall.normalY) { effect.vx *= -1; effect.vy *= -1; }
          else {
            const dot = effect.vx * wall.normalX + effect.vy * wall.normalY;
            effect.vx -= 2 * dot * wall.normalX; effect.vy -= 2 * dot * wall.normalY;
          }
        }
        addTrailPoint(trailState, effect.x, effect.y);
      },
      draw({ effect }, context) {
        drawShell(context, effect);
      }
    };
  }

  function drawShieldArc(context, ball, centerAngle, emergeProgress = 1) {
    const inner = ball.radius;
    const eased = 1 - Math.pow(1 - clamp(emergeProgress, 0, 1), 2);
    const outer = ball.radius + SHIELD_THICKNESS * eased;
    context.save();
    context.beginPath();
    context.arc(ball.x, ball.y, outer, centerAngle - SHIELD_SPAN, centerAngle + SHIELD_SPAN);
    context.arc(ball.x, ball.y, inner, centerAngle + SHIELD_SPAN, centerAngle - SHIELD_SPAN, true);
    context.closePath();
    context.fillStyle = "rgba(125, 140, 160, 0.88)";
    context.fill();
    context.strokeStyle = "rgba(228, 236, 246, 0.65)";
    context.lineWidth = 0.9;
    context.stroke();
    context.restore();
  }

  const armorDefinition = {
    id: "armor",
    name: "\u7532\u80c4",
    englishName: "Armor",
    color: BODY_COLOR,
    description: "\u4e09\u76fe\u73af\u8eab / \u7206\u7532\u5f39\u5c04 / \u53cd\u5f39\u788e\u51fb -7",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      const shields = [];
      const contactKeys = new Set();
      let shieldTimer = 0;
      let fuseTimer = 0;

      function rotationAt(time) {
        return (time % ROTATION_PERIOD) / ROTATION_PERIOD * Math.PI * 2;
      }

      function orbitRadius(ball) {
        return ball.radius + SHIELD_ORBIT_OFFSET;
      }

      function launchShells(ball, game) {
        const rotation = rotationAt(game.time);
        const radius = orbitRadius(ball);
        for (let index = 0; index < shields.length; index += 1) {
          const angle = shieldCenterAngle(rotation, shields[index]);
          services.spawnProjectile(createShell(
            services,
            ball,
            ball.x + Math.cos(angle) * radius,
            ball.y + Math.sin(angle) * radius,
            angle
          ));
        }
        shields.length = 0;
        fuseTimer = 0;
        shieldTimer = 0;
      }

      function updateShieldContacts(ball, game) {
        const rotation = rotationAt(game.time);
        const radius = orbitRadius(ball);
        const active = new Set();
        services.forEachEnemy((enemy) => {
          const profile = services.getContactProfile(enemy);
          if (!profile.attackable) return;
          const deltaX = enemy.x - ball.x;
          const deltaY = enemy.y - ball.y;
          const distance = Math.hypot(deltaX, deltaY);
          if (distance <= EPSILON) return;
          const pointAngle = Math.atan2(deltaY, deltaX);
          let touchingShieldIndex = -1;
          for (let index = 0; index < shields.length; index += 1) {
            if (pointToShieldArc(
              distance,
              pointAngle,
              shieldCenterAngle(rotation, shields[index]),
              radius
            ) <= enemy.radius + SHIELD_TOUCH_RADIUS) {
              touchingShieldIndex = index;
              break;
            }
          }
          if (touchingShieldIndex < 0) return;
          const key = enemy.instanceId || enemy.id;
          active.add(key);
          // The shield itself pushes the enemy out to the shield's outer edge;
          // the body never changes direction because of shield contact.
          if (!enemy.positionLocked) {
            const pushDistance = ball.radius + SHIELD_THICKNESS +
              enemy.radius + 0.5;
            const directionX = deltaX / distance;
            const directionY = deltaY / distance;
            Object.assign(enemy, (game.arena || createArenaGeometry(game.arenaSize)).clampPoint(
              ball.x + directionX * pushDistance, ball.y + directionY * pushDistance, enemy.radius));
          }
          if (contactKeys.has(key)) return;
          // Absorbing the hit breaks the touched shield.
          const broken = shields.splice(touchingShieldIndex, 1)[0];
          if (!broken) return;
          fuseTimer = 0;
          services.spawnParticleBurst(shellShatterOptions(
            ball.x + Math.cos(shieldCenterAngle(rotation, broken)) * radius,
            ball.y + Math.sin(shieldCenterAngle(rotation, broken)) * radius
          ));
          services.applyEffect(
            enemy,
            createKnockbackEffect(ball, enemy, deltaX / distance, deltaY / distance),
            ball
          );
          services.dealDamage(enemy, SHIELD_HIT_DAMAGE, ball);
        });
        contactKeys.clear();
        active.forEach((key) => contactKeys.add(key));
      }

      // Like RoundShield's defensive form, a covered direction also blocks
      // stuns and knockbacks: any movement-locking or attack-blocking effect
      // whose source sits inside a shield arc is cleared (with its onExpire
      // recovery run first, so the ball restores cleanly).
      function clearDirectionalEffects(ball, game) {
        if (shields.length === 0) return;
        const rotation = rotationAt(game.time);
        for (const [id, effect] of Array.from(ball.effects.entries())) {
          if (
            effect.locksMovement !== true &&
            effect.preventsAttack !== true &&
            effect.pausesBehavior !== true
          ) continue;
          const combatSource = effect.combatSource || null;
          const source = combatSource && (
            Number.isFinite(combatSource.credit && combatSource.credit.x)
              ? combatSource.credit
              : (combatSource.actor || null)
          );
          if (!source || !Number.isFinite(source.x) || !Number.isFinite(source.y)) {
            continue;
          }
          const attackAngle = Math.atan2(source.y - ball.y, source.x - ball.x);
          const covered = shields.some((shield) => (
            Math.abs(wrapAngle(
              attackAngle - shieldCenterAngle(rotation, shield)
            )) <= SHIELD_SPAN
          ));
          if (!covered) continue;
          if (typeof effect.onExpire !== "function") {
            ball.vx = ball.storedVx;
            ball.vy = ball.storedVy;
          }
          services.clearEffect(ball, id);
        }
      }

      function updateShieldCounters(ball, game, dt) {
        const elapsed = Math.max(0, dt);
        if (shields.length < MAX_SHIELDS) {
          shieldTimer += elapsed;
          while (shieldTimer + EPSILON >= SHIELD_INTERVAL && shields.length < MAX_SHIELDS) {
            // A regenerated shield always takes the first free angle slot so
            // two shields can never stack on the same direction.
            const usedOffsets = new Set(shields.map((shield) => shield.offset));
            let nextOffset = 0;
            while (usedOffsets.has(nextOffset)) {
              nextOffset += Math.PI * 2 / MAX_SHIELDS;
            }
            shields.push({
              emergeAt: game.time,
              offset: nextOffset
            });
            shieldTimer -= SHIELD_INTERVAL;
            fuseTimer = 0;
          }
        } else {
          fuseTimer += elapsed;
          if (fuseTimer + EPSILON >= FUSE_DURATION) {
            launchShells(ball, game);
          }
        }
      }

      return {
        update(context, dt) {
          updateShieldCounters(context.ball, context.game, dt);
          updateShieldContacts(context.ball, context.game);
          clearDirectionalEffects(context.ball, context.game);
        },
        getNextTransitionIn() {
          if (shields.length < MAX_SHIELDS) {
            return Math.max(EPSILON, SHIELD_INTERVAL - shieldTimer);
          }
          return Math.max(EPSILON, FUSE_DURATION - fuseTimer);
        },
        onBeforeDamage(context, event) {
          if (
            !event || !Number.isFinite(event.amount) || event.amount <= 0
          ) return event;
          const { ball, game } = context;
          // Wall-impact and skill damage often arrive with an effect object as
          // the actor; the credited ball still carries the world position, so
          // prefer whichever candidate actually has coordinates.
          let source = null;
          for (const candidate of [event.actor, event.credit, event.entity]) {
            if (candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)) {
              source = candidate;
              break;
            }
          }
          if (shields.length === 0 || !source) return event;
          const attackAngle = Math.atan2(source.y - ball.y, source.x - ball.x);
          const rotation = rotationAt(game.time);
          for (let index = 0; index < shields.length; index += 1) {
            if (Math.abs(wrapAngle(
              attackAngle - shieldCenterAngle(rotation, shields[index])
            )) <= SHIELD_SPAN) {
              shields.splice(index, 1);
              fuseTimer = 0;
              return { amount: 0, showHitText: false };
            }
          }
          return event;
        },
        drawAfter(context, canvasContext) {
          const ball = context.ball;
          const rotation = rotationAt(context.game.time);
          for (let index = 0; index < shields.length; index += 1) {
            const emergeProgress = (context.game.time - shields[index].emergeAt) /
              SHIELD_EMERGE_DURATION;
            drawShieldArc(
              canvasContext,
              ball,
              shieldCenterAngle(rotation, shields[index]),
              emergeProgress
            );
          }
        },
        getArmorState() {
          return {
            shieldCount: shields.length,
            shields,
            shieldTimer,
            fuseTimer,
            rotation: rotationAt(services.getTime())
          };
        }
      };
    }
  };

  registerBall(armorDefinition);
  return { armorDefinition };
});
