(function initializeStars(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/contact-model.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createStarsPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const RADIUS = 1.5;
  const SPACING = 45;
  const FADE_DURATION = 0.3;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // 星点数量会随星链增长：按相位合并成一个路径批次，避免逐点贴图/渐变/
  // shadowBlur 带来的大面积透明像素填充。
  const SOLID_ALPHA = 0.98;
  const GHOST_ALPHA = 0.5;
  const SOLID_HALO_COLOR = "#bdeaff";
  const SOLID_HALO_RADIUS = 3.2;
  const SOLID_HALO_ALPHA = 0.14;
  const SOLID_CROSS_ARM = 4.0;
  const GHOST_CROSS_ARM = 2.4;
  const STAR_CROSS_COLOR = "#eaf9ff";
  const GHOST_CROSS_COLOR = "#9fdcff";
  const STAR_CORE_COLOR = "#ffffff";
  const GHOST_CORE_COLOR = "#cdeeff";
  const SOLID_CORE_RADIUS = 1.7;
  const GHOST_CORE_RADIUS = 1.1;
  const BIRTH_FLASH_DURATION = 0.2;
  const HIT_FLASH_DURATION = 0.12;
  const COMET_TAIL_LIFE = 0.35;
  const COMET_TAIL_LENGTH = 11;
  const COMET_TAIL_COLOR = "#bdeaff";
  const IGNITE_COLORS = Object.freeze(["#ffffff", "#dff6ff", "#9fdcff"]);

  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    return value < 0 ? 0 : (value > 1 ? 1 : value);
  }

  // 只用于视觉相位，不消耗战斗随机数。
  function hash01(value) {
    const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  function visualSeedFor(point) {
    const direction = Number.isFinite(point.direction) ? point.direction : 0;
    return hash01(point.x * 12.9898 + point.y * 78.233 + direction * 37.719);
  }

  function starElapsed(entity) {
    return Number.isFinite(entity.elapsed) ? Math.max(0, entity.elapsed) : 0;
  }

  function starTwinkleScale(entity, elapsed) {
    const seed = Number.isFinite(entity.visualSeed) ? entity.visualSeed : 0;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * (2.4 + seed * 1.2) + seed * TWO_PI);
    const birth = clamp01(1 - elapsed / BIRTH_FLASH_DURATION);
    const base = entity.phase === "ghost" ? 0.02 : 0.05;
    return (1 + base * (pulse - 0.5)) * (1 + birth * 0.25);
  }

  function drawCometTail(canvas, entity, baseAlpha, elapsed) {
    if (!(entity.chainAge < 1 - EPSILON)) return;
    if (!(elapsed < COMET_TAIL_LIFE)) return;
    if (entity.phase !== "solid") return;
    const fade = 1 - elapsed / COMET_TAIL_LIFE;
    const length = COMET_TAIL_LENGTH * fade;
    if (length <= 0.2) return;
    const direction = Number.isFinite(entity.direction) ? entity.direction : 0;
    const tipX = entity.x - Math.cos(direction) * length;
    const tipY = entity.y - Math.sin(direction) * length;
    canvas.globalAlpha = baseAlpha * SOLID_ALPHA * 0.45 * fade;
    canvas.strokeStyle = COMET_TAIL_COLOR;
    canvas.lineCap = "round";
    canvas.lineWidth = 0.8;
    canvas.beginPath();
    canvas.moveTo(tipX, tipY);
    canvas.lineTo(entity.x, entity.y);
    canvas.stroke();
  }

  function drawHaloPass(canvas, entities, phase, radius, alpha, color, baseAlpha) {
    canvas.globalAlpha = baseAlpha * alpha;
    canvas.fillStyle = color;
    canvas.beginPath();
    let any = false;
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase !== phase || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      const scaled = radius * starTwinkleScale(entity, starElapsed(entity));
      canvas.moveTo(entity.x + scaled, entity.y);
      canvas.arc(entity.x, entity.y, scaled, 0, TWO_PI);
      any = true;
    }
    if (any) canvas.fill();
  }

  function drawStarGroup(canvas, entities, phase, baseAlpha) {
    const ghost = phase === "ghost";
    let matched = false;
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase === phase && Number.isFinite(entity.x) && Number.isFinite(entity.y)) {
        matched = true;
        break;
      }
    }
    if (!matched) return;

    // The ghost phase stays compact (core + short cross). Only solid stars
    // pay for a halo fill, which keeps dense late-game fields affordable.
    if (!ghost) {
      drawHaloPass(
        canvas, entities, phase,
        SOLID_HALO_RADIUS, SOLID_HALO_ALPHA, SOLID_HALO_COLOR, baseAlpha
      );
    }

    canvas.globalAlpha = baseAlpha * (ghost ? GHOST_ALPHA : SOLID_ALPHA);
    canvas.strokeStyle = ghost ? GHOST_CROSS_COLOR : STAR_CROSS_COLOR;
    canvas.lineWidth = ghost ? 0.34 : 0.42;
    canvas.lineCap = "round";
    canvas.beginPath();
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase !== phase || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      const arm = (ghost ? GHOST_CROSS_ARM : SOLID_CROSS_ARM) *
        starTwinkleScale(entity, starElapsed(entity));
      canvas.moveTo(entity.x - arm, entity.y);
      canvas.lineTo(entity.x + arm, entity.y);
      canvas.moveTo(entity.x, entity.y - arm);
      canvas.lineTo(entity.x, entity.y + arm);
    }
    canvas.stroke();

    canvas.fillStyle = ghost ? GHOST_CORE_COLOR : STAR_CORE_COLOR;
    canvas.beginPath();
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase !== phase || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      const radius = (ghost ? GHOST_CORE_RADIUS : SOLID_CORE_RADIUS) *
        starTwinkleScale(entity, starElapsed(entity));
      canvas.moveTo(entity.x + radius, entity.y);
      canvas.arc(entity.x, entity.y, radius, 0, TWO_PI);
    }
    canvas.fill();
  }

  function drawFadingStar(canvas, entity, baseAlpha) {
    if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return;
    const elapsed = starElapsed(entity);
    const progress = clamp01((elapsed - entity.fadeStarted) / FADE_DURATION);
    const alpha = (Number.isFinite(entity.fadeAlpha) ? entity.fadeAlpha : 1) * (1 - progress);
    if (alpha <= 0.004) return;
    const scale = 0.65 + 0.35 * (1 - progress);
    const cool = entity.fadeAlpha < 1;
    canvas.globalAlpha = baseAlpha * alpha;
    canvas.strokeStyle = cool ? GHOST_CROSS_COLOR : STAR_CROSS_COLOR;
    canvas.lineWidth = cool ? 0.34 : 0.42;
    canvas.lineCap = "round";
    const arm = (cool ? GHOST_CROSS_ARM : SOLID_CROSS_ARM) * scale;
    canvas.beginPath();
    canvas.moveTo(entity.x - arm, entity.y);
    canvas.lineTo(entity.x + arm, entity.y);
    canvas.moveTo(entity.x, entity.y - arm);
    canvas.lineTo(entity.x, entity.y + arm);
    canvas.stroke();
    const radius = (cool ? GHOST_CORE_RADIUS : SOLID_CORE_RADIUS) * scale;
    canvas.fillStyle = cool ? GHOST_CORE_COLOR : STAR_CORE_COLOR;
    canvas.beginPath();
    canvas.moveTo(entity.x + radius, entity.y);
    canvas.arc(entity.x, entity.y, radius, 0, TWO_PI);
    canvas.fill();
  }

  function drawHitFlash(canvas, entity, baseAlpha, elapsed) {
    const remaining = entity.hitFlashUntil - elapsed;
    if (!(remaining > EPSILON)) return;
    const intensity = clamp01(remaining / HIT_FLASH_DURATION);
    const arm = 4.2 + (1 - intensity) * 2;
    canvas.globalAlpha = baseAlpha * intensity * 0.9;
    canvas.strokeStyle = "#ffffff";
    canvas.lineWidth = 0.55;
    canvas.lineCap = "round";
    canvas.beginPath();
    canvas.moveTo(entity.x - arm, entity.y);
    canvas.lineTo(entity.x + arm, entity.y);
    canvas.moveTo(entity.x, entity.y - arm);
    canvas.lineTo(entity.x, entity.y + arm);
    canvas.stroke();
  }

  // All star points share this drawBatch so the renderer can combine adjacent
  // ones into a single hook and a handful of path fills per phase.
  function drawStarBatch({ entities }, canvas) {
    drawStars(canvas, entities);
  }

  function drawStars(canvas, entities) {
    if (!entities || entities.length === 0) return;
    const baseAlpha = canvas.globalAlpha;
    canvas.save();
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (!Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      drawCometTail(canvas, entity, baseAlpha, starElapsed(entity));
    }
    drawStarGroup(canvas, entities, "solid", baseAlpha);
    drawStarGroup(canvas, entities, "ghost", baseAlpha);
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase === "fading") drawFadingStar(canvas, entity, baseAlpha);
    }
    for (let index = 0; index < entities.length; index += 1) {
      const entity = entities[index];
      if (entity.phase === "fading" || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) continue;
      drawHitFlash(canvas, entity, baseAlpha, starElapsed(entity));
    }
    canvas.restore();
  }

  function nextPoint(origin, arenaSize, spacing = SPACING, services, chainAge = 0) {
    const extending = Number.isFinite(origin.direction);
    const pursuing = extending && chainAge < 1 - EPSILON;
    let direction;
    if (pursuing) {
      direction = origin.direction;
      let nearestDistance = Infinity;
      services.forEachEnemy((target) => {
        const dx = target.x - origin.x;
        const dy = target.y - origin.y;
        const distance = Math.hypot(dx, dy);
        if (distance > EPSILON && distance < nearestDistance) {
          nearestDistance = distance;
          direction = Math.atan2(dy, dx);
        }
      });
      spacing *= Math.random();
    } else {
      direction = Math.random() * Math.PI * 2;
    }
    if (extending && !pursuing) {
      // Square-root sampling spreads points uniformly across the disk's area.
      spacing *= Math.sqrt(Math.random());
    }
    const x = origin.x + Math.cos(direction) * spacing;
    const y = origin.y + Math.sin(direction) * spacing;
    if (!resolveArenaGeometry(arenaSize).contains(x, y, RADIUS)) return null;
    return { x, y, direction, chainAge };
  }

  function createStarPoint(point) {
    return {
      kind: "stars-point", combatKind: "trap", lifecycle: "independent",
      life: Number.MAX_SAFE_INTEGER, drawLayer: "background",
      drawBatch: drawStarBatch,
      x: point.x, y: point.y, direction: point.direction, radius: RADIUS, solid: true,
      chainAge: point.chainAge || 0,
      phase: "solid", elapsed: 0, nextDecision: 1, extended: false,
      fadeStarted: 0, fadeAlpha: 1, contacts: new Set(),
      visualSeed: visualSeedFor(point),
      hitFlashUntil: 0,
      update({ entity, services, game }, dt) {
        entity.elapsed += dt;
        if (!entity.extended && entity.elapsed + EPSILON >= 0.2) {
          entity.extended = true;
          const next = nextPoint(entity, game, SPACING, services, entity.chainAge + entity.elapsed);
          if (next) services.spawnCombatEntity(createStarPoint(next));
        }
        while (entity.phase !== "fading" && entity.elapsed + EPSILON >= entity.nextDecision) {
          const roll = Math.random();
          const deadline = entity.nextDecision;
          if ((entity.phase === "solid" && roll < 0.25) ||
              (entity.phase === "ghost" && roll >= 0.75)) {
            entity.fadeAlpha = entity.phase === "ghost" ? 0.5 : 1;
            entity.phase = "fading";
            entity.solid = false;
            entity.fadeStarted = deadline;
            entity.contacts.clear();
          } else if (entity.phase === "solid" && roll >= 0.5) {
            entity.phase = "ghost";
            entity.solid = false;
            entity.nextDecision = deadline + 1;
          } else {
            entity.nextDecision = deadline + 1;
          }
        }
        if (entity.phase === "fading") {
          if (entity.elapsed + EPSILON >= entity.fadeStarted + FADE_DURATION) entity.entityActive = false;
          return;
        }
        const touching = new Set();
        services.forEachContactEnemy((target) => {
          const profile = services.getContactProfile(target);
          const radius = target.radius + RADIUS;
          const px = Number.isFinite(target.prevX) ? target.prevX : target.x;
          const py = Number.isFinite(target.prevY) ? target.prevY : target.y;
          const t = firstSegmentCircleContact(px, py, target.x, target.y, entity.x, entity.y, radius);
          const key = target.instanceId;
          if (t === null) {
            if (Math.hypot(target.x - entity.x, target.y - entity.y) <= radius + 0.5 &&
                entity.contacts.has(key)) touching.add(key);
            return;
          }
          touching.add(key);
          if (entity.solid && profile.solid !== false && !services.isMovementLocked(target)) {
            const cx = px + (target.x - px) * t;
            const cy = py + (target.y - py) * t;
            const length = Math.hypot(cx - entity.x, cy - entity.y);
            const nx = length > EPSILON ? (cx - entity.x) / length : 1;
            const ny = length > EPSILON ? (cy - entity.y) / length : 0;
            Object.assign(target, resolveArenaGeometry(game).clampPoint(entity.x + nx * (radius + 0.01), entity.y + ny * (radius + 0.01), target.radius));
            const incoming = target.vx * nx + target.vy * ny;
            if (incoming < 0) {
              target.vx -= 2 * incoming * nx;
              target.vy -= 2 * incoming * ny;
              target.storedVx = target.vx;
              target.storedVy = target.vy;
            }
          }
          if (!entity.contacts.has(key) && services.dealDamage(target, 1)) {
            entity.hitFlashUntil = entity.elapsed + HIT_FLASH_DURATION;
          }
        });
        entity.contacts = touching;
      },
      draw({ entity }, canvas) {
        drawStars(canvas, [entity]);
      }
    };
  }

  const starsDefinition = {
    id: "stars", name: "群星", englishName: "Stars", color: "#ffffff",
    description: "每1秒点亮星链 / 每0.2秒延伸，前1秒追敌0～45距离，随后半径45内随机 / 实体星点接触1伤，随后随机消散或转为半透明",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 4,
    createBehavior(services) {
      let remaining = 1;
      return {
        update({ ball, game }, dt) {
          remaining -= dt;
          if (remaining > EPSILON) return;
          remaining += 1;
          const point = nextPoint(ball, game, 30);
          if (!point) return;
          services.spawnCombatEntity(createStarPoint(point));
          services.spawnParticleBurst({
            kind: "stars-ignite",
            x: point.x,
            y: point.y,
            count: 7,
            colors: IGNITE_COLORS.slice(),
            minDiameter: 0.5,
            maxDiameter: 1.6,
            minSpeed: 8,
            maxSpeed: 34,
            initialRadius: 1.5,
            drag: 3.6,
            life: 0.3
          });
        },
        getNextTransitionIn() { return Math.max(EPSILON, remaining); }
      };
    }
  };

  registerBall(starsDefinition);
  return { starsDefinition, createStarPoint };
});
