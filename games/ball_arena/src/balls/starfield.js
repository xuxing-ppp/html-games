(function initializeStarfield(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
      require("../core/sprite-cache.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createStarfieldPlugin({ resolveArenaGeometry,
  registerBall,
  createSpriteCache,
  resolveDeviceScale
}) {
  const SPREAD_DEGREES = 15;
  const SPREAD_RADIANS = SPREAD_DEGREES * Math.PI / 180;
  const METEOR_RADIUS = 4;
  // Meteors always fly at this fixed speed, independent of the body's own
  // speed and of any speed changes applied to the launching ball.
  const METEOR_SPEED = 150;
  const METEOR_DAMAGE = 3;
  // A candidate direction is rejected when the meteor would reach an arena
  // edge within this distance from its spawn point. Retrying keeps the random
  // spread while never launching straight out of the arena.
  const MIN_CLEAR_DISTANCE = 10;
  const MAX_DIRECTION_ATTEMPTS = 6;
  const TRAIL_DURATION = 0.35;
  const METEOR_LIFE = 3600;
  // Chance that a meteor splits into a new one when it bounces off an edge.
  const SPLIT_CHANCE = 0.06;
  const SPLASH_LIFE = 0.4;
  const SPLASH_PARTICLE_COUNT = 10;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // The head is baked once; the meteor count stays low, but per-frame
  // gradients plus halo draws would still be wasteful during dense splits.
  const METEOR_SPRITE_WORLD = 13;
  const METEOR_GLOW_RADIUS = 6;
  const METEOR_GOLD_RADIUS = 3.6;
  const METEOR_CORE_RADIUS = 1.55;
  const METEOR_HOT_COLOR = "#fff8d6";
  const METEOR_GOLD_COLOR = "#ffd75e";
  const METEOR_AMBER_COLOR = "#ff9d3c";
  const TRAIL_MAX_WIDTH = 3.2;
  const TRAIL_CORE_WIDTH = 0.8;
  const SPLIT_FLASH_LIFE = 0.28;
  const IMPACT_FLASH_LIFE = 0.24;
  const SPLIT_BURST_COLORS = Object.freeze(["#fff8d6", "#ffd75e", "#ff9d3c"]);
  const IMPACT_BURST_COLORS = Object.freeze(["#ffffff", "#fff8d6", "#ffd75e", "#ff9d3c"]);

  const meteorSprites = createSpriteCache();

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function drawSoftSpark(context, x, y, radius, color, alpha) {
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.beginPath();
    if (typeof context.ellipse === "function") {
      context.ellipse(x, y, radius * 1.7, radius, 0, 0, TWO_PI);
    } else {
      context.arc(x, y, radius, 0, TWO_PI);
    }
    context.fill();
  }

  function paintMeteorSprite(context, centerX, centerY, size) {
    const glow = METEOR_GLOW_RADIUS;
    const gradient = context.createRadialGradient(
      centerX, centerY, 0,
      centerX, centerY, glow
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.98)");
    gradient.addColorStop(0.18, "rgba(255, 248, 214, 0.92)");
    gradient.addColorStop(0.4, "rgba(255, 215, 94, 0.62)");
    gradient.addColorStop(0.72, "rgba(255, 157, 60, 0.2)");
    gradient.addColorStop(1, "rgba(255, 107, 44, 0)");
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(centerX, centerY, glow, 0, TWO_PI);
    context.fill();

    context.strokeStyle = METEOR_GOLD_COLOR;
    context.lineWidth = 0.7;
    context.beginPath();
    context.arc(centerX, centerY, METEOR_GOLD_RADIUS, 0, TWO_PI);
    context.stroke();

    context.fillStyle = METEOR_HOT_COLOR;
    context.beginPath();
    context.arc(centerX, centerY, METEOR_CORE_RADIUS, 0, TWO_PI);
    context.fill();

    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(centerX, centerY, METEOR_CORE_RADIUS * 0.62, 0, TWO_PI);
    context.fill();
  }

  function meteorDrawScale(canvas, game) {
    // The renderer's world transform is canvas.width / arenaSize (configureCanvas).
    const arenaSize = game && game.arenaSize;
    const canvasWidth = canvas && canvas.canvas && canvas.canvas.width;
    if (Number.isFinite(arenaSize) && arenaSize > 0 &&
        Number.isFinite(canvasWidth) && canvasWidth > 0) {
      return canvasWidth / arenaSize;
    }
    return typeof resolveDeviceScale === "function"
      ? resolveDeviceScale(canvas)
      : null;
  }

  function createStarGlint(x, y, angle, color, scale, kind) {
    return {
      kind,
      life: kind === "starfield-impact-glint" ? IMPACT_FLASH_LIFE : SPLIT_FLASH_LIFE,
      x,
      y,
      angle,
      color,
      scale,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const alpha = (1 - progress) * 0.9;
        const arm = (4 + progress * 10) * effect.scale;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= alpha;
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        context.strokeStyle = effect.color;
        context.lineWidth = 1.4 * (1 - progress) + 0.3;
        context.lineCap = "round";
        context.beginPath();
        context.moveTo(-arm, 0);
        context.lineTo(arm, 0);
        context.moveTo(0, -arm);
        context.lineTo(0, arm);
        context.stroke();
        context.restore();
      }
    };
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

  // Distance along `angle` from (x, y) until the meteor's center reaches an
  // arena edge. Negative when the direction points straight outside.
  function clearFlightDistance(x, y, angle, radius, arenaSize) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const arena = resolveArenaGeometry(arenaSize);
    if (!arena.contains(x, y)) return -1;
    return arena.movementLimit(x, y, directionX, directionY, arena.size * 2, radius);
  }

  function chooseMeteorAngle(contactX, contactY, baseAngle, arenaSize) {
    for (let attempt = 0; attempt < MAX_DIRECTION_ATTEMPTS; attempt += 1) {
      const angle = baseAngle + (Math.random() * 2 - 1) * SPREAD_RADIANS;
      if (clearFlightDistance(
        contactX,
        contactY,
        angle,
        METEOR_RADIUS,
        arenaSize
      ) >= MIN_CLEAR_DISTANCE) {
        return angle;
      }
    }
    // The post-bounce direction always points back into the arena, so it is a
    // guaranteed-safe fallback when every random candidate would exit.
    return baseAngle;
  }

  function createEdgeSplash(contactX, contactY, baseAngle) {
    const particles = Array.from({ length: SPLASH_PARTICLE_COUNT }, (_, index) => ({
      // Spread across roughly a 140-degree fan centered on the post-bounce
      // direction, so the yellow sparks fly back into the arena.
      angle: baseAngle + (Math.random() * 2 - 1) * 1.2,
      distance: 6 + Math.random() * 14,
      size: 1.5 + Math.random() * 2,
      delay: index * 0.015
    }));
    return {
      kind: "starfield-edge-splash",
      life: SPLASH_LIFE,
      particles,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";

        const flare = 1 - progress;
        if (flare > 0.02) {
          const tail = 5 + progress * 8;
          context.globalAlpha = 0.85 * flare;
          context.strokeStyle = "#fff3c4";
          context.lineWidth = 2.4 * flare + 0.4;
          context.lineCap = "round";
          context.beginPath();
          context.moveTo(
            contactX - Math.cos(baseAngle) * tail,
            contactY - Math.sin(baseAngle) * tail
          );
          context.lineTo(
            contactX + Math.cos(baseAngle) * (6 + progress * 10),
            contactY + Math.sin(baseAngle) * (6 + progress * 10)
          );
          context.stroke();
        }

        for (const particle of effect.particles) {
          if (effect.age < particle.delay) continue;
          const particleProgress = clamp(
            (effect.age - particle.delay) / (effect.life - particle.delay),
            0,
            1
          );
          const fade = 1 - particleProgress;
          const distance = particle.distance * (0.3 + particleProgress * 0.7);
          const size = particle.size * (1 - particleProgress * 0.5);
          const sparkX = contactX + Math.cos(particle.angle) * distance;
          const sparkY = contactY + Math.sin(particle.angle) * distance;
          drawSoftSpark(
            context, sparkX, sparkY, size * 1.9,
            METEOR_GOLD_COLOR, 0.18 * fade * fade
          );
          drawSoftSpark(
            context, sparkX, sparkY, size,
            particleProgress < 0.5 ? "#fff8d6" : METEOR_GOLD_COLOR,
            0.95 * fade * fade
          );
        }
        context.restore();
      }
    };
  }

  function fillTrailLayer(canvas, points, remaining, width, color, alpha, baseAlpha) {
    const count = points.length;
    if (count < 2) return;
    const halfWidths = new Array(count);
    for (let index = 0; index < count; index += 1) {
      halfWidths[index] = width * Math.max(0, remaining[index]) * 0.5;
    }
    canvas.globalAlpha = baseAlpha * alpha;
    canvas.fillStyle = color;
    canvas.beginPath();
    let leftX = 0;
    let leftY = 0;
    for (let index = 0; index < count; index += 1) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(count - 1, index + 1)];
      let dx = next.x - previous.x;
      let dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) {
        dx = 1;
        dy = 0;
      } else {
        dx /= length;
        dy /= length;
      }
      leftX = point.x - dy * halfWidths[index];
      leftY = point.y + dx * halfWidths[index];
      if (index === 0) canvas.moveTo(leftX, leftY);
      else canvas.lineTo(leftX, leftY);
    }
    for (let index = count - 1; index >= 0; index -= 1) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(count - 1, index + 1)];
      let dx = next.x - previous.x;
      let dy = next.y - previous.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) {
        dx = 1;
        dy = 0;
      } else {
        dx /= length;
        dy /= length;
      }
      canvas.lineTo(
        point.x + dy * halfWidths[index],
        point.y - dx * halfWidths[index]
      );
    }
    canvas.closePath();
    canvas.fill();
  }

  function createMeteorTrail(state) {
    return {
      kind: "starfield-meteor-trail",
      life: METEOR_LIFE,
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
        const remaining = state.points.map((point) => clamp(
          1 - (state.time - point.createdAt) / TRAIL_DURATION,
          0,
          1
        ));
        canvasContext.save();
        canvasContext.globalCompositeOperation = "lighter";
        const baseAlpha = canvasContext.globalAlpha;
        fillTrailLayer(
          canvasContext, state.points, remaining,
          TRAIL_MAX_WIDTH * 2, METEOR_AMBER_COLOR, 0.35, baseAlpha
        );
        fillTrailLayer(
          canvasContext, state.points, remaining,
          TRAIL_MAX_WIDTH * 1.15, METEOR_GOLD_COLOR, 0.85, baseAlpha
        );
        fillTrailLayer(
          canvasContext, state.points, remaining,
          TRAIL_CORE_WIDTH, METEOR_HOT_COLOR, 0.95, baseAlpha
        );
        canvasContext.restore();
      }
    };
  }

  function addMeteorTrailPoint(state, x, y) {
    const last = state.points[state.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) <= EPSILON) return;
    state.points.push({ x, y, createdAt: state.time });
  }

  function drawMeteor(context, effect, game) {
    const scale = meteorDrawScale(context, game);
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const pulse = 1 + 0.03 * Math.sin(age * 12);
    if (scale !== null && typeof context.drawImage === "function") {
      const sprite = meteorSprites.get(
        "starfield-meteor",
        METEOR_SPRITE_WORLD,
        scale,
        (spriteContext, centerX, centerY) => (
          paintMeteorSprite(spriteContext, centerX, centerY, METEOR_SPRITE_WORLD)
        )
      );
      if (sprite) {
        const size = METEOR_SPRITE_WORLD * pulse;
        const blit = size * (sprite.worldWidth / sprite.sizeWorld);
        context.save();
        context.globalAlpha *= 0.98;
        context.drawImage(
          sprite.canvas,
          effect.x - blit / 2,
          effect.y - blit / 2,
          blit,
          blit
        );
        context.restore();
        return;
      }
    }

    context.save();
    const baseAlpha = context.globalAlpha;
    context.globalAlpha = baseAlpha * 0.28;
    context.fillStyle = METEOR_AMBER_COLOR;
    context.beginPath();
    context.arc(effect.x, effect.y, METEOR_GLOW_RADIUS * 0.8 * pulse, 0, TWO_PI);
    context.fill();
    context.globalAlpha = baseAlpha * 0.92;
    context.fillStyle = METEOR_GOLD_COLOR;
    context.beginPath();
    context.arc(effect.x, effect.y, METEOR_GOLD_RADIUS * pulse, 0, TWO_PI);
    context.fill();
    context.fillStyle = METEOR_HOT_COLOR;
    context.beginPath();
    context.arc(effect.x, effect.y, METEOR_CORE_RADIUS * pulse, 0, TWO_PI);
    context.fill();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(effect.x, effect.y, METEOR_CORE_RADIUS * 0.62 * pulse, 0, TWO_PI);
    context.fill();
    context.restore();
  }

  function createMeteor(services, source, contactX, contactY, angle, arenaSize) {
    const speed = METEOR_SPEED;
    const { x: spawnX, y: spawnY } = resolveArenaGeometry(arenaSize).clampPoint(contactX + Math.cos(angle) * (METEOR_RADIUS + 1), contactY + Math.sin(angle) * (METEOR_RADIUS + 1), METEOR_RADIUS);
    const trailState = {
      active: true,
      time: 0,
      points: [{ x: spawnX, y: spawnY, createdAt: 0 }]
    };
    services.spawnVisualEffect(createMeteorTrail(trailState));
    return {
      kind: "starfield-meteor",
      life: METEOR_LIFE,
      radius: METEOR_RADIUS,
      damage: METEOR_DAMAGE,
      color: "#ffd75e",
      x: spawnX,
      y: spawnY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        const motion = resolveArenaGeometry(game).advanceMotion(effect, elapsed);
        effect.x = motion.x; effect.y = motion.y;
        effect.vx = motion.vx; effect.vy = motion.vy;

        let hit = null;
        let hitProgress = Infinity, hitPoint = null;
        const segments = motion.segments.length ? motion.segments : [{ x1: startX, y1: startY, x2: effect.x, y2: effect.y, t0: 0, t1: elapsed }];
        entityServices.forEachEnemy((target) => {
          for (const segment of segments) {
            const progress = segmentProgress(segment.x1, segment.y1, segment.x2, segment.y2, target, METEOR_RADIUS);
            const time = progress === null ? Infinity : segment.t0 + (segment.t1 - segment.t0) * progress;
            if (time < hitProgress) {
              hit = target; hitProgress = time;
              hitPoint = { x: segment.x1 + (segment.x2 - segment.x1) * progress, y: segment.y1 + (segment.y2 - segment.y1) * progress };
            }
          }
        });

        if (hit && entityServices.dealDamage(hit, METEOR_DAMAGE)) {
          effect.x = hitPoint.x;
          effect.y = hitPoint.y;
          addMeteorTrailPoint(trailState, effect.x, effect.y);
          const angle = Math.atan2(effect.vy, effect.vx);
          entityServices.spawnVisualEffect(createStarGlint(
            effect.x, effect.y, angle, METEOR_HOT_COLOR, 1.25, "starfield-impact-glint"
          ));
          entityServices.spawnParticleBurst({
            kind: "starfield-impact",
            x: effect.x,
            y: effect.y,
            count: 8,
            colors: IMPACT_BURST_COLORS.slice(),
            minDiameter: 0.7,
            maxDiameter: 2.4,
            minSpeed: 40,
            maxSpeed: 160,
            directionAngle: angle + Math.PI,
            directionSpread: TWO_PI,
            initialRadius: 1.5,
            drag: 3.2,
            life: 0.34
          });
          trailState.active = false;
          effect.life = 0;
          return;
        }

        // The meteor keeps bouncing off arena edges until it hits an enemy.
        const bouncedX = motion.bounces > 0, bouncedY = false;
        if ((bouncedX || bouncedY)
            && Math.random() < SPLIT_CHANCE * entityServices.getTriggerChanceScale()) {
          const contact = motion.segments.find(segment => segment.hit).hit;
          const splitX = contact.x - contact.normalX * METEOR_RADIUS;
          const splitY = contact.y - contact.normalY * METEOR_RADIUS;
          const splitAngle = Math.atan2(effect.vy, effect.vx);
          // Same direction rules as a body launch: the bouncing meteor's own
          // post-bounce direction, spread by fifteen degrees and kept inside
          // the arena.
          entityServices.spawnProjectile(createMeteorAt(
            entityServices,
            effect,
            splitX,
            splitY,
            splitAngle,
            game
          ));
          entityServices.spawnVisualEffect(createStarGlint(
            splitX, splitY, splitAngle, METEOR_GOLD_COLOR, 1, "starfield-split-glint"
          ));
          entityServices.spawnParticleBurst({
            kind: "starfield-split",
            x: splitX,
            y: splitY,
            count: 6,
            colors: SPLIT_BURST_COLORS.slice(),
            minDiameter: 0.6,
            maxDiameter: 2,
            minSpeed: 25,
            maxSpeed: 90,
            directionAngle: splitAngle,
            directionSpread: TWO_PI,
            initialRadius: 1.2,
            drag: 3.4,
            life: 0.3
          });
        }
        addMeteorTrailPoint(trailState, effect.x, effect.y);
      },
      draw({ effect, game }, context) {
        drawMeteor(context, effect, game);
      }
    };
  }

  function createMeteorAt(services, source, contactX, contactY, baseAngle, arenaSize) {
    const angle = chooseMeteorAngle(contactX, contactY, baseAngle, arenaSize);
    return createMeteor(services, source, contactX, contactY, angle, arenaSize);
  }

  const starfieldDefinition = {
    id: "starfield",
    name: "\u7e41\u661f",
    englishName: "Starfield",
    color: "#f7d154",
    description: "\u78b0\u8fb9\u53d1\u5c04\u6d41\u661f / \u8fb9\u7f18\u53cd\u5f39 / \u547d\u4e2d -3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      return {
        onWallBounce(context) {
          const { ball, game, bouncedX, bouncedY } = context;
          const arenaSize = game.arenaSize;
          const wall = context.wallContacts && context.wallContacts[0];
          const contactX = wall ? wall.x : bouncedX
            ? (ball.x < arenaSize / 2 ? 0 : arenaSize)
            : ball.x;
          const contactY = wall ? wall.y : bouncedY
            ? (ball.y < arenaSize / 2 ? 0 : arenaSize)
            : ball.y;
          const baseAngle = Math.atan2(ball.storedVy, ball.storedVx);
          services.spawnProjectile(createMeteorAt(
            services,
            ball,
            contactX,
            contactY,
            baseAngle,
            game
          ));
          services.spawnVisualEffect(createEdgeSplash(contactX, contactY, baseAngle));
        },
      };
    }
  };

  registerBall(starfieldDefinition);
  return { starfieldDefinition };
});
