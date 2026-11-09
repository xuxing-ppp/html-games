(function initializeGrenade(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGrenadePlugin({
  registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback,
  getKnockbackState, knockbackWeight, knockbackWeightIntegral
}) {
  // Every cycle lasts exactly 2.5 seconds: a 0.3s windup before the grenades
  // appear around the body, a 1s throw window that empties the hand, and a
  // 1.2s cooldown afterwards (0.3 + 1 + 1.2 = 2.5).
  const WINDUP_DURATION = 0.3;
  const THROW_DURATION = 1;
  const COOLDOWN_DURATION = 1.2;
  const CYCLE_DURATION = WINDUP_DURATION + THROW_DURATION + COOLDOWN_DURATION;
  // Each lob flies for 0.3s along a parabolic arc, then waits a 0.4s fuse.
  const FLIGHT_DURATION = 0.3;
  const FUSE_DURATION = 0.4;
  // Area explosion: effective blast diameter is 120 (radius 60).
  const BLAST_RADIUS = 60;
  const BLAST_DAMAGE = 5;
  // The blast shoves enemies at 8x speed for 0.06s.
  const KNOCKBACK_DURATION = 0.06;
  const KNOCKBACK_SPEED_MULTIPLIER = 8;
  // Held grenades are square fragmentation grenades with a visual size of 15.
  // They surround the body at fixed evenly distributed angles and stack like
  // fanned playing cards: a ring packs up to twenty overlapping grenades
  // before the next ring opens further out.
  const GRENADE_SIZE = 15;
  const ORBIT_GAP = 9;
  const RING_GAP = 16;
  const RING_CAPACITY = 20;
  const LANDING_MARGIN = 10;
  const EPSILON = 1e-9;
  const DEFAULT_PALETTE = Object.freeze({
    shadowColor: "#b8ff6e",
    shell: "#1c3a10",
    body: "#3c7a24",
    face: "#57a33a",
    grid: "rgba(15, 46, 6, 0.8)",
    accent: "#8fce61",
    fuse: "#6f736a",
    fuseDark: "#33352f",
    spark: "#ff5f30",
    bodyGrid: "rgba(16, 52, 6, 0.8)",
    bodyAccent: "#79c14c",
    bodyOutline: "#2a5c12",
    bodyGloss: "rgba(255, 255, 255, 0.5)",
    shadowFill: "rgba(10, 30, 4, 0.8)"
  });

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.lineTo(x + width - corner, y);
    context.quadraticCurveTo(x + width, y, x + width, y + corner);
    context.lineTo(x + width, y + height - corner);
    context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
    context.lineTo(x + corner, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - corner);
    context.lineTo(x, y + corner);
    context.quadraticCurveTo(x, y, x + corner, y);
    context.closePath();
  }

  // Position of the held grenade at `index` inside a hand of `count` grenades.
  // The inner ring packs up to twenty grenades at fixed evenly distributed
  // angles, so neighbours overlap like a fanned card hand; extra grenades
  // stack onto outer rings only after the inner one is full.
  function heldGrenadePosition(ball, index, count) {
    const ring = Math.floor(index / RING_CAPACITY);
    const ringStart = ring * RING_CAPACITY;
    const ringCount = Math.min(RING_CAPACITY, count - ringStart);
    const slot = index - ringStart;
    const angle = slot * (Math.PI * 2 / ringCount) + ring * 0.6;
    const distance = ball.radius + ORBIT_GAP + ring * RING_GAP;
    return {
      x: ball.x + Math.cos(angle) * distance,
      y: ball.y + Math.sin(angle) * distance,
      angle
    };
  }

  function randomLandingPoint(startX, startY, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const { x, y } = arena.samplePoint(Math.random, LANDING_MARGIN);
    if (Math.hypot(x - startX, y - startY) <= EPSILON) {
      return arena.clampPoint(startX + 1, y, LANDING_MARGIN);
    }
    return { x, y };
  }

  function advanceTargetState(state, duration, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    let remaining = Math.max(0, duration);
    while (remaining > EPSILON) {
      if (state.knockbackRemaining > EPSILON) {
        const step = Math.min(remaining, state.knockbackRemaining, 1 / 60);
        const from = state.knockbackElapsed;
        const to = from + step;
        const averageWeight = knockbackWeightIntegral(from, to, state.knockbackDuration) / step;
        const averageSpeed = state.knockbackSettleSpeed + state.knockbackExtraSpeed * averageWeight;
        state.vx = state.knockbackDirectionX * averageSpeed;
        state.vy = state.knockbackDirectionY * averageSpeed;
        const motion = arena.advanceMotion(state, step);
        state.x = motion.x;
        state.y = motion.y;
        if (averageSpeed > EPSILON) {
          state.knockbackDirectionX = motion.vx / averageSpeed;
          state.knockbackDirectionY = motion.vy / averageSpeed;
        }
        state.knockbackElapsed = to;
        const endSpeed = state.knockbackSettleSpeed + state.knockbackExtraSpeed *
          knockbackWeight(to, state.knockbackDuration);
        state.knockbackVx = state.vx = state.knockbackDirectionX * endSpeed;
        state.knockbackVy = state.vy = state.knockbackDirectionY * endSpeed;
        state.knockbackRemaining = Math.max(0, state.knockbackRemaining - step);
        remaining -= step;
        if (state.knockbackRemaining <= EPSILON) {
          const magnitude = Math.hypot(state.knockbackVx, state.knockbackVy);
          const restoreSpeed = state.restoreSpeed > EPSILON
            ? state.restoreSpeed
            : state.effectiveSpeed;
          if (magnitude > EPSILON) {
            state.vx = (state.knockbackVx / magnitude) * restoreSpeed;
            state.vy = (state.knockbackVy / magnitude) * restoreSpeed;
          } else {
            state.vx = state.vy = 0;
          }
          state.storedVx = state.vx;
          state.storedVy = state.vy;
        }
        continue;
      }

      state.vx = Number.isFinite(state.storedVx) ? state.storedVx : state.vx;
      state.vy = Number.isFinite(state.storedVy) ? state.storedVy : state.vy;
      const motion = arena.advanceMotion(state, remaining);
      state.x = motion.x;
      state.y = motion.y;
      state.vx = motion.vx;
      state.vy = motion.vy;
      state.storedVx = state.vx;
      state.storedVy = state.vy;
      remaining = 0;
    }
    return state;
  }

  function cloneTargetState(state) {
    return { ...state };
  }

  function createTargetState(enemy, now) {
    const radius = Number.isFinite(enemy.radius) ? enemy.radius : 0;
    const storedVx = Number.isFinite(enemy.storedVx)
      ? enemy.storedVx
      : (Number.isFinite(enemy.vx) ? enemy.vx : 0);
    const storedVy = Number.isFinite(enemy.storedVy)
      ? enemy.storedVy
      : (Number.isFinite(enemy.vy) ? enemy.vy : 0);
    const motion = getKnockbackState(enemy);
    const activeKnockback = motion && motion.effect.expiresAt > now ? motion.effect : null;
    const effectiveSpeed = Number.isFinite(enemy.speed) && Number.isFinite(enemy.speedMultiplier)
      ? enemy.speed * enemy.speedMultiplier
      : Math.hypot(storedVx, storedVy);
    const currentVx = activeKnockback ? activeKnockback.vx : (
      Number.isFinite(enemy.vx) ? enemy.vx : storedVx
    );
    const currentVy = activeKnockback ? activeKnockback.vy : (
      Number.isFinite(enemy.vy) ? enemy.vy : storedVy
    );
    return {
      id: enemy.instanceId || enemy.id,
      x: Number.isFinite(enemy.x) ? enemy.x : radius,
      y: Number.isFinite(enemy.y) ? enemy.y : radius,
      radius,
      hp: Number.isFinite(enemy.hp) ? enemy.hp : Infinity,
      vx: currentVx,
      vy: currentVy,
      storedVx,
      storedVy,
      effectiveSpeed,
      knockbackRemaining: activeKnockback
        ? Math.max(0, activeKnockback.expiresAt - now)
        : 0,
      knockbackVx: activeKnockback ? activeKnockback.vx : 0,
      knockbackVy: activeKnockback ? activeKnockback.vy : 0,
      knockbackDuration: activeKnockback ? motion.duration : 0,
      knockbackElapsed: activeKnockback ? Math.max(0, now - motion.startedAt) : 0,
      knockbackSettleSpeed: activeKnockback ? motion.settleSpeed : 0,
      knockbackExtraSpeed: activeKnockback ? motion.extraSpeed : 0,
      knockbackDirectionX: activeKnockback ? motion.directionX : 0,
      knockbackDirectionY: activeKnockback ? motion.directionY : 0,
      restoreSpeed: effectiveSpeed,
      attackable: true
    };
  }

  function normalizePlannedBlast(plan, defaults) {
    if (!plan || !Number.isFinite(plan.detonateAt)) return null;
    if (!Number.isFinite(plan.x) || !Number.isFinite(plan.y)) return null;
    return {
      x: plan.x,
      y: plan.y,
      detonateAt: plan.detonateAt,
      blastRadius: Number.isFinite(plan.blastRadius)
        ? plan.blastRadius
        : defaults.blastRadius,
      blastDamage: Number.isFinite(plan.blastDamage)
        ? plan.blastDamage
        : defaults.blastDamage,
      knockbackDuration: Number.isFinite(plan.knockbackDuration)
        ? plan.knockbackDuration
        : KNOCKBACK_DURATION,
      knockbackSpeedMultiplier: Number.isFinite(plan.knockbackSpeedMultiplier)
        ? plan.knockbackSpeedMultiplier
        : KNOCKBACK_SPEED_MULTIPLIER,
      coveredIds: plan.coveredIds instanceof Set
        ? plan.coveredIds
        : new Set(plan.coveredIds || [])
    };
  }

  function applySimulatedBlast(states, blast) {
    let damage = 0;
    let hits = 0;
    const coveredIds = [];
    states.forEach((state) => {
      if (state.hp <= 0 || !state.attackable) return;
      if (Math.hypot(state.x - blast.x, state.y - blast.y) > blast.blastRadius + state.radius) {
        return;
      }
      coveredIds.push(state.id);
      const dealt = Math.min(blast.blastDamage, Math.max(0, state.hp));
      if (dealt <= 0) return;
      state.hp -= dealt;
      damage += dealt;
      hits += 1;
      if (state.hp <= 0) return;

      let directionX = state.x - blast.x;
      let directionY = state.y - blast.y;
      const magnitude = Math.hypot(directionX, directionY);
      if (magnitude <= EPSILON) {
        directionX = state.storedVx || state.vx || 1;
        directionY = state.storedVy || state.vy || 0;
        const fallbackMagnitude = Math.hypot(directionX, directionY) || 1;
        directionX /= fallbackMagnitude;
        directionY /= fallbackMagnitude;
      } else {
        directionX /= magnitude;
        directionY /= magnitude;
      }
      state.restoreSpeed = state.effectiveSpeed;
      state.knockbackVx = directionX * state.effectiveSpeed * blast.knockbackSpeedMultiplier;
      state.knockbackVy = directionY * state.effectiveSpeed * blast.knockbackSpeedMultiplier;
      state.knockbackRemaining = blast.knockbackDuration;
      state.knockbackDuration = blast.knockbackDuration;
      state.knockbackElapsed = 0;
      state.knockbackSettleSpeed = state.effectiveSpeed;
      state.knockbackExtraSpeed = state.effectiveSpeed * (blast.knockbackSpeedMultiplier - 1);
      state.knockbackDirectionX = directionX;
      state.knockbackDirectionY = directionY;
      state.vx = state.knockbackVx;
      state.vy = state.knockbackVy;
    });
    return { damage, hits, coveredIds };
  }

  function simulateEvents(states, events, startTime, endTime, arenaSize, candidateEvent = null) {
    const ordered = events
      .filter((event) => event && Number.isFinite(event.detonateAt))
      .filter((event) => event.detonateAt >= startTime - EPSILON &&
        event.detonateAt <= endTime + EPSILON)
      .sort((left, right) => left.detonateAt - right.detonateAt);
    let currentTime = startTime;
    let candidateDamage = 0;
    let candidateHits = 0;
    let futureDamage = 0;
    let futureHits = 0;
    let candidateCoveredIds = [];
    ordered.forEach((event) => {
      const eventTime = Math.max(currentTime, event.detonateAt);
      advanceTargetStateForAll(states, eventTime - currentTime, arenaSize);
      currentTime = eventTime;
      const result = applySimulatedBlast(states, event);
      if (event === candidateEvent) {
        candidateDamage = result.damage;
        candidateHits = result.hits;
        candidateCoveredIds = result.coveredIds;
      } else if (candidateEvent && event.detonateAt >= candidateEvent.detonateAt - EPSILON) {
        futureDamage += result.damage;
        futureHits += result.hits;
      }
    });
    if (currentTime < endTime - EPSILON) {
      advanceTargetStateForAll(states, endTime - currentTime, arenaSize);
    }
    return {
      candidateDamage,
      candidateHits,
      futureDamage,
      futureHits,
      coveredIds: candidateCoveredIds
    };
  }

  function advanceTargetStateForAll(states, duration, arenaSize) {
    if (duration <= EPSILON) return;
    states.forEach((state) => {
      if (state.hp > 0) advanceTargetState(state, duration, arenaSize);
    });
  }

  function addCandidate(candidates, candidate, lower, upper) {
    if (!candidate || !Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return;
    const point = {
      x: clamp(candidate.x, lower, upper),
      y: clamp(candidate.y, lower, upper)
    };
    if (candidates.some((existing) => Math.hypot(existing.x - point.x, existing.y - point.y) <= 0.001)) {
      return;
    }
    candidates.push(point);
  }

  function predictiveLandingPoint({
    services,
    game,
    startX,
    startY,
    detonationDelay = FLIGHT_DURATION + FUSE_DURATION,
    blastRadius = BLAST_RADIUS,
    blastDamage = BLAST_DAMAGE,
    plannedBlasts = [],
    knockbackDuration = KNOCKBACK_DURATION,
    knockbackSpeedMultiplier = KNOCKBACK_SPEED_MULTIPLIER
  }) {
    const arenaSize = resolveArenaGeometry(game);
    const now = Number.isFinite(game.time) ? game.time : 0;
    const states = [];
    services.forEachEnemy((enemy) => {
      if (!enemy || enemy.hp <= 0) return;
      const profile = typeof services.getContactProfile === "function"
        ? services.getContactProfile(enemy)
        : null;
      if (profile && profile.attackable === false) return;
      states.push(createTargetState(enemy, now));
    });
    if (states.length === 0) return randomLandingPoint(startX, startY, arenaSize);

    const defaults = { blastRadius, blastDamage, knockbackDuration, knockbackSpeedMultiplier };
    const priorPlans = plannedBlasts
      .map((plan) => normalizePlannedBlast(plan, defaults))
      .filter((plan) => plan && plan.detonateAt >= now - EPSILON)
      .sort((left, right) => left.detonateAt - right.detonateAt);
    const candidateTime = now + Math.max(0, detonationDelay);
    const baselineStates = states.map(cloneTargetState);
    simulateEvents(
      baselineStates,
      priorPlans,
      now,
      candidateTime,
      arenaSize
    );

    const lower = LANDING_MARGIN;
    const upper = Math.max(lower, arenaSize.size - LANDING_MARGIN);
    const candidates = [];
    const liveAtCandidate = baselineStates.filter((state) => state.hp > 0);
    liveAtCandidate.forEach((state) => addCandidate(candidates, state, lower, upper));
    for (let first = 0; first < liveAtCandidate.length; first += 1) {
      for (let second = first + 1; second < liveAtCandidate.length; second += 1) {
        addCandidate(candidates, {
          x: (liveAtCandidate[first].x + liveAtCandidate[second].x) / 2,
          y: (liveAtCandidate[first].y + liveAtCandidate[second].y) / 2
        }, lower, upper);
      }
    }
    if (liveAtCandidate.length > 1) {
      const centroid = liveAtCandidate.reduce(
        (sum, state) => ({ x: sum.x + state.x, y: sum.y + state.y }),
        { x: 0, y: 0 }
      );
      addCandidate(candidates, {
        x: centroid.x / liveAtCandidate.length,
        y: centroid.y / liveAtCandidate.length
      }, lower, upper);
    }
    priorPlans.forEach((plan) => {
      if (plan.detonateAt >= candidateTime - EPSILON) {
        addCandidate(candidates, plan, lower, upper);
      }
    });

    if (candidates.length === 0) return randomLandingPoint(startX, startY, arenaSize);
    const candidateEvents = priorPlans.concat({
      x: 0,
      y: 0,
      detonateAt: candidateTime,
      blastRadius,
      blastDamage,
      knockbackDuration,
      knockbackSpeedMultiplier,
      coveredIds: new Set()
    });
    const candidateEvent = candidateEvents[candidateEvents.length - 1];
    let best = null;
    candidates.forEach((candidate) => {
      Object.assign(candidate, arenaSize.clampPoint(candidate.x, candidate.y, LANDING_MARGIN));
      candidateEvent.x = candidate.x;
      candidateEvent.y = candidate.y;
      const simulated = states.map(cloneTargetState);
      const result = simulateEvents(
        simulated,
        candidateEvents,
        now,
        Math.max(candidateTime, ...priorPlans.map((plan) => plan.detonateAt), candidateTime),
        arenaSize,
        candidateEvent
      );
      // Immediate damage is weighted heavily; later planned blasts still
      // break ties and reward a knockback that sets up the next detonation.
      const score = result.candidateDamage * 1000 +
        result.futureDamage * 10 +
        result.candidateHits * 0.1 +
        result.futureHits * 0.01;
      if (!best || score > best.score + EPSILON) {
        best = {
          x: candidate.x,
          y: candidate.y,
          score,
          coveredIds: result.coveredIds
        };
      }
    });
    return best || randomLandingPoint(startX, startY, arenaSize);
  }

  function createKnockback(source, directionX, directionY, knockbackSpeedMultiplier = KNOCKBACK_SPEED_MULTIPLIER, idPrefix = "grenade") {
    return createSharedKnockback({
      id: `${idPrefix}-knockback-${source.instanceId}`,
      duration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: knockbackSpeedMultiplier
    });
  }
  function explodeGrenade(entityServices, source, effect, options) {
    entityServices.playSound("ability", { cue: "explosion" });
    const x = effect.x;
    const y = effect.y;
    entityServices.forEachEnemy((enemy) => {
      if (Math.hypot(enemy.x - x, enemy.y - y) > options.blastRadius + enemy.radius) return;
      if (!entityServices.dealDamage(enemy, options.blastDamage)) return;
      let directionX = enemy.x - x;
      let directionY = enemy.y - y;
      const magnitude = Math.hypot(directionX, directionY);
      if (magnitude <= EPSILON) {
        directionX = enemy.storedVx || enemy.vx || 1;
        directionY = enemy.storedVy || enemy.vy || 0;
        const fallbackMagnitude = Math.hypot(directionX, directionY) || 1;
        directionX /= fallbackMagnitude;
        directionY /= fallbackMagnitude;
      } else {
        directionX /= magnitude;
        directionY /= magnitude;
      }
      entityServices.applyEffect(enemy, createKnockback(
        source,
        directionX,
        directionY,
        options.knockbackSpeedMultiplier,
        options.knockbackIdPrefix
      ));
    });
    if (options.explosionMode === "particles") {
      entityServices.spawnParticleBurst({
        kind: options.explosionKind,
        x,
        y,
        count: 35,
        minDiameter: 1,
        maxDiameter: 8,
        colors: ["#92979c", "#ffffff"],
        life: 0.42,
        minSpeed: 28,
        maxSpeed: 100
      });
    } else {
      entityServices.spawnVisualEffect(createExplosion(
        x,
        y,
        source.color,
        options.blastRadius,
        options.explosionKind
      ));
    }
  }

  function createExplosion(
    x,
    y,
    color,
    blastRadius = BLAST_RADIUS,
    kind = "grenade-explosion"
  ) {
    const rays = Array.from({ length: 10 }, (_value, index) => ({
      angle: index * Math.PI * 2 / 10 + Math.random() * 0.18,
      length: BLAST_RADIUS * (0.5 + Math.random() * 0.4)
    }));
    const shards = Array.from({ length: 14 }, (_value, index) => ({
      angle: index * Math.PI * 2 / 14 + Math.random() * 0.24,
      distance: 12 + Math.random() * 38,
      size: 2 + index % 3,
      shade: index % 3
    }));
    return {
      kind,
      life: 0.42,
      x,
      y,
      radius: blastRadius,
      color,
      rays,
      shards,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade;

        // Shockwave ring expanding to the effective blast radius.
        context.strokeStyle = "#d9ff9e";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          effect.radius * (0.18 + progress * 0.82),
          0,
          Math.PI * 2
        );
        context.stroke();

        // Hot core and green flash.
        context.fillStyle = "rgba(255, 226, 130, 0.8)";
        context.beginPath();
        context.arc(effect.x, effect.y, 4 + 11 * fade, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "rgba(140, 230, 70, 0.5)";
        context.beginPath();
        context.arc(effect.x, effect.y, 8 + 24 * fade, 0, Math.PI * 2);
        context.fill();

        // Ray burst.
        context.strokeStyle = effect.color;
        context.lineWidth = 2;
        effect.rays.forEach((ray) => {
          const start = effect.radius * 0.22;
          const end = start + ray.length * (1 - progress * 0.4);
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(ray.angle) * start,
            effect.y + Math.sin(ray.angle) * start
          );
          context.lineTo(
            effect.x + Math.cos(ray.angle) * end,
            effect.y + Math.sin(ray.angle) * end
          );
          context.stroke();
        });

        // Square fragmentation debris.
        context.globalCompositeOperation = "source-over";
        effect.shards.forEach((shard) => {
          const spread = 0.3 + progress * 0.95;
          const distance = shard.distance * spread;
          context.fillStyle = shard.shade === 0
            ? "#3c7a24"
            : (shard.shade === 1 ? "#8fce61" : "#ffb84d");
          context.fillRect(
            Math.round(effect.x + Math.cos(shard.angle) * distance - shard.size / 2),
            Math.round(effect.y + Math.sin(shard.angle) * distance - shard.size / 2),
            shard.size,
            shard.size
          );
        });
        context.restore();
      }
    };
  }

  function createLandingDust(x, y, options = {}) {
    const kind = options.kind || "grenade-landing-dust";
    const color = options.color || "#7d8a6b";
    const particles = Array.from({ length: 6 }, (_value, index) => {
      const angle = -Math.PI / 2 + (index - 2.5) * 0.5 + Math.random() * 0.3;
      return {
        vx: Math.cos(angle) * (14 + Math.random() * 20),
        vy: Math.sin(angle) * (8 + Math.random() * 14),
        size: 2 + index % 2
      };
    });
    return {
      kind,
      life: 0.28,
      x,
      y,
      particles,
      update({ effect }, dt) {
        effect.particles.forEach((particle) => {
          particle.x = (particle.x || effect.x) + particle.vx * dt;
          particle.y = (particle.y || effect.y) + particle.vy * dt;
          particle.vy += 60 * dt;
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= (1 - progress) * 0.6;
        context.fillStyle = color;
        effect.particles.forEach((particle) => {
          context.fillRect(
            Math.round(particle.x - particle.size / 2),
            Math.round(particle.y - particle.size / 2),
            particle.size,
            particle.size
          );
        });
        context.restore();
      }
    };
  }

  function createReloadPing(x, y, radius, options = {}) {
    const kind = options.kind || "grenade-reload-ping";
    const color = options.color || "#b8ff6e";
    return {
      kind,
      life: 0.28,
      x,
      y,
      radius,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = color;
        context.lineWidth = 2;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          effect.radius + 4 + progress * 14,
          0,
          Math.PI * 2
        );
        context.stroke();
        context.restore();
      }
    };
  }

  function drawGrenadeSprite(
    context,
    x,
    y,
    size,
    rotation = 0,
    fuseBlink = false,
    palette = DEFAULT_PALETTE
  ) {
    const half = size / 2;
    context.save();
    context.translate(Math.round(x), Math.round(y));
    if (rotation) context.rotate(rotation);
    context.shadowColor = palette.shadowColor;
    context.shadowBlur = 4;

    // Dark shell outline.
    context.fillStyle = palette.shell;
    roundedRectPath(context, -half - 1.5, -half - 1.5, size + 3, size + 3, 3);
    context.fill();

    // Olive body and lighter face.
    context.fillStyle = palette.body;
    roundedRectPath(context, -half, -half, size, size, 3);
    context.fill();
    context.fillStyle = palette.face;
    roundedRectPath(context, -half + 2, -half + 2, size - 4, size - 4, 2);
    context.fill();

    // Fragmentation grid.
    context.strokeStyle = palette.grid;
    context.lineWidth = 1;
    for (const offset of [-half + 5, 0, half - 5]) {
      context.beginPath();
      context.moveTo(offset, -half + 2);
      context.lineTo(offset, half - 2);
      context.stroke();
      context.beginPath();
      context.moveTo(-half + 2, offset);
      context.lineTo(half - 2, offset);
      context.stroke();
    }
    context.fillStyle = palette.accent;
    for (const offsetX of [-half + 2.5, half - 2.5]) {
      for (const offsetY of [-half + 2.5, half - 2.5]) {
        context.fillRect(offsetX - 1, offsetY - 1, 2, 2);
      }
    }

    // Fuse cap with an optional blinking spark.
    context.fillStyle = palette.fuse;
    context.fillRect(-2, -half - 4, 4, 4);
    context.fillStyle = palette.fuseDark;
    context.fillRect(-1, -half - 4, 2, 2);
    if (fuseBlink) {
      context.fillStyle = palette.spark;
      context.fillRect(-2, -half - 6, 4, 2);
    }
    context.restore();
  }

  function drawThrownGrenade(context, effect, game, palette = DEFAULT_PALETTE) {
    if (!effect.landed) {
      const progress = clamp(effect.travelElapsed / FLIGHT_DURATION, 0, 1);
      const height = 4 * effect.apex * progress * (1 - progress);

      // Ground shadow shrinks as the grenade climbs.
      context.save();
      context.globalAlpha *= clamp(0.34 - height / (effect.apex * 6 + EPSILON), 0.06, 0.34);
      context.fillStyle = palette.shadowFill;
      context.translate(effect.shadowX, effect.shadowY);
      context.scale(1, 0.45);
      context.beginPath();
      context.arc(0, 0, 5 + height * 0.02, 0, Math.PI * 2);
      context.fill();
      context.restore();

      drawGrenadeSprite(
        context,
        effect.x,
        effect.y,
        GRENADE_SIZE,
        effect.spin * progress,
        false,
        palette
      );
      return;
    }
    const blink = Math.floor(game.time * 8) % 2 === 0;
    drawGrenadeSprite(context, effect.x, effect.y, GRENADE_SIZE, 0.35, blink, palette);
  }

  function createThrownGrenade(source, startX, startY, destX, destY, options = {}) {
    const config = {
      blastDamage: BLAST_DAMAGE,
      blastRadius: BLAST_RADIUS,
      knockbackSpeedMultiplier: KNOCKBACK_SPEED_MULTIPLIER,
      knockbackIdPrefix: "grenade",
      explosionMode: "classic",
      explosionKind: "grenade-explosion",
      landingDustKind: "grenade-landing-dust",
      landingDustColor: "#7d8a6b",
      palette: DEFAULT_PALETTE,
      ...options
    };
    const deltaX = destX - startX;
    const deltaY = destY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    const apex = clamp(26 + distance * 0.18, 26, 64);
    let exploded = false;
    return {
      kind: config.entityKind || "grenade-thrown",
      life: FLIGHT_DURATION + FUSE_DURATION + 0.15,
      radius: GRENADE_SIZE / 2,
      damage: config.blastDamage,
      x: startX,
      y: startY,
      vx: deltaX / FLIGHT_DURATION,
      vy: deltaY / FLIGHT_DURATION,
      startX,
      startY,
      destX,
      destY,
      apex,
      travelElapsed: 0,
      fuseElapsed: 0,
      landed: false,
      spin: (Math.random() < 0.5 ? -1 : 1) * (4.5 + Math.random() * 3.5),
      update({ effect, services: entityServices }, dt) {
        if (exploded) return;
        const elapsed = Math.max(0, dt);
        if (!effect.landed) {
          effect.travelElapsed = Math.min(
            FLIGHT_DURATION,
            effect.travelElapsed + elapsed
          );
          const progress = effect.travelElapsed / FLIGHT_DURATION;
          const groundX = effect.startX + (effect.destX - effect.startX) * progress;
          const groundY = effect.startY + (effect.destY - effect.startY) * progress;
          const height = 4 * effect.apex * progress * (1 - progress);
          effect.shadowX = groundX;
          effect.shadowY = groundY;
          effect.x = groundX;
          effect.y = groundY - height;
          if (effect.travelElapsed + EPSILON >= FLIGHT_DURATION) {
            effect.landed = true;
            effect.x = effect.destX;
            effect.y = effect.destY;
            entityServices.spawnVisualEffect(createLandingDust(effect.destX, effect.destY, {
              kind: config.landingDustKind,
              color: config.landingDustColor
            }));
          }
          return;
        }
        effect.fuseElapsed += elapsed;
        if (effect.fuseElapsed + EPSILON >= FUSE_DURATION) {
          exploded = true;
          explodeGrenade(entityServices, source, effect, config);
          effect.life = 0;
        }
      },
      draw({ effect, game }, context) {
        drawThrownGrenade(context, effect, game, config.palette);
      }
    };
  }

  function drawGrenadeBody(context, ball, palette = DEFAULT_PALETTE) {
    const radius = ball.radius;
    context.save();
    context.translate(ball.x, ball.y);

    // Olive body.
    context.fillStyle = ball.color;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();

    // Fragmentation grid clipped inside the body circle.
    context.save();
    context.beginPath();
    context.arc(0, 0, radius - 1, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = palette.bodyGrid;
    context.lineWidth = 1.5;
    for (const offset of [-10, 0, 10]) {
      context.beginPath();
      context.moveTo(offset, -radius);
      context.lineTo(offset, radius);
      context.stroke();
      context.beginPath();
      context.moveTo(-radius, offset);
      context.lineTo(radius, offset);
      context.stroke();
    }
    context.fillStyle = palette.bodyAccent;
    for (const offsetX of [-5, 5]) {
      for (const offsetY of [-5, 5]) {
        context.fillRect(offsetX - 1, offsetY - 1, 2, 2);
      }
    }
    context.restore();

    // Shared-style dark outline.
    context.strokeStyle = palette.bodyOutline;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();

    // Top-left gloss.
    context.strokeStyle = palette.bodyGloss;
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(0, 0, radius - 3.5, Math.PI * 1.02, Math.PI * 1.5);
    context.stroke();

    // Fuse assembly on top.
    context.fillStyle = palette.fuse;
    context.fillRect(-2, -radius - 5, 4, 5);
    context.fillStyle = palette.fuseDark;
    context.fillRect(-1, -radius - 5, 2, 2);
    context.fillStyle = palette.accent;
    context.fillRect(-3, -radius - 4, 2, 2);

    context.restore();
    return true;
  }

  function createGrenadeDefinition(options = {}) {
    const config = {
      id: "grenade",
      name: "手榴弹",
      englishName: "Grenade",
      color: "#4f9e38",
      description: "2.5秒周期 / 抛物线手雷轰炸",
      stats: {
        radius: 15,
        speed: 150,
        maxHp: 100
      },
      rionCycleDuration: CYCLE_DURATION,
      blastRadius: BLAST_RADIUS,
      blastDamage: BLAST_DAMAGE,
      knockbackSpeedMultiplier: KNOCKBACK_SPEED_MULTIPLIER,
      knockbackIdPrefix: "grenade",
      explosionMode: "classic",
      explosionKind: "grenade-explosion",
      entityKind: "grenade-thrown",
      landingDustKind: "grenade-landing-dust",
      landingDustColor: "#7d8a6b",
      reloadPingKind: "grenade-reload-ping",
      reloadPingColor: "#b8ff6e",
      palette: DEFAULT_PALETTE,
      landingPointSelector({ startX, startY, game }) {
        return randomLandingPoint(startX, startY, game);
      },
      ...options
    };
    config.stats = { ...config.stats };
    config.palette = { ...DEFAULT_PALETTE, ...config.palette };

    return {
      id: config.id,
      name: config.name,
      englishName: config.englishName,
      color: config.color,
      description: config.description,
      stats: config.stats,
      rionCycleDuration: config.rionCycleDuration,
      createBehavior(services) {
        let cycleTime = 0;
        let attackCount = 1;
        let grenadesSpawned = false;
        let nextThrowIndex = 0;
        const plannedBlasts = [];

        function throwGrenade(ball, game) {
          const held = heldGrenadePosition(ball, nextThrowIndex, attackCount);
          let destination = config.landingPointSelector({
            services,
            ball,
            game,
            startX: held.x,
            startY: held.y,
            attackIndex: nextThrowIndex,
            attackCount,
            detonationDelay: FLIGHT_DURATION + FUSE_DURATION,
            blastRadius: config.blastRadius,
            blastDamage: config.blastDamage,
            knockbackDuration: KNOCKBACK_DURATION,
            knockbackSpeedMultiplier: config.knockbackSpeedMultiplier,
            currentTime: game.time,
            plannedBlasts
          });
          if (!destination || !Number.isFinite(destination.x) || !Number.isFinite(destination.y)) {
            destination = randomLandingPoint(held.x, held.y, game);
          }
          if (Math.hypot(destination.x - held.x, destination.y - held.y) <= EPSILON) {
            destination = randomLandingPoint(held.x, held.y, game);
          }
          plannedBlasts.push({
            detonateAt: game.time + FLIGHT_DURATION + FUSE_DURATION,
            x: destination.x,
            y: destination.y,
            blastRadius: config.blastRadius,
            blastDamage: config.blastDamage,
            knockbackDuration: KNOCKBACK_DURATION,
            knockbackSpeedMultiplier: config.knockbackSpeedMultiplier,
            coveredIds: new Set(destination.coveredIds || [])
          });
          services.spawnProjectile(createThrownGrenade(
            ball,
            held.x,
            held.y,
            destination.x,
            destination.y,
            config
          ));
        }

        return {
          isAttackCycleComplete() { return grenadesSpawned && nextThrowIndex >= attackCount; },
          drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
          update(_context, dt) {
            cycleTime = Math.min(CYCLE_DURATION, cycleTime + Math.max(0, dt));
          },
          getNextTransitionIn() {
            let next = CYCLE_DURATION - cycleTime;
            if (!grenadesSpawned) {
              next = Math.min(next, Math.max(0, WINDUP_DURATION - cycleTime));
            } else if (nextThrowIndex < attackCount) {
              const throwAt = WINDUP_DURATION +
                nextThrowIndex * (THROW_DURATION / attackCount);
              next = Math.min(next, Math.max(0, throwAt - cycleTime));
            }
            return Math.max(EPSILON, next);
          },
          afterUpdateStep(context) {
            const { ball, game } = context;
            while (plannedBlasts.length > 0 &&
              plannedBlasts[0].detonateAt <= game.time + EPSILON) {
              plannedBlasts.shift();
            }
            if (!grenadesSpawned && cycleTime + EPSILON >= WINDUP_DURATION) {
              grenadesSpawned = true;
              services.spawnVisualEffect(createReloadPing(ball.x, ball.y, ball.radius, {
                kind: config.reloadPingKind,
                color: config.reloadPingColor
              }));
            }
            if (grenadesSpawned) {
              while (nextThrowIndex < attackCount) {
                const throwAt = WINDUP_DURATION +
                  nextThrowIndex * (THROW_DURATION / attackCount);
                if (cycleTime + EPSILON < throwAt) break;
                throwGrenade(ball, game);
                nextThrowIndex += 1;
              }
            }
            if (cycleTime + EPSILON >= CYCLE_DURATION) {
              cycleTime = 0;
              attackCount += 1;
              grenadesSpawned = false;
              nextThrowIndex = 0;
              plannedBlasts.length = 0;
            }
          },
          drawAfter(context, canvasContext) {
            if (!grenadesSpawned) return;
            const { ball } = context;
            for (let index = nextThrowIndex; index < attackCount; index += 1) {
              const held = heldGrenadePosition(ball, index, attackCount);
              drawGrenadeSprite(
                canvasContext,
                held.x,
                held.y,
                GRENADE_SIZE,
                held.angle + Math.PI / 2,
                false,
                config.palette
              );
            }
          },
          drawBody(context, canvasContext) {
            drawGrenadeBody(canvasContext, context.ball, config.palette);
            return true;
          }
        };
      }
    };
  }

  const grenadeDefinition = createGrenadeDefinition();

  registerBall(grenadeDefinition);
  return {
    grenadeDefinition,
    createGrenadeDefinition,
    predictiveLandingPoint,
    DEFAULT_GRENADE_PALETTE: DEFAULT_PALETTE,
    GRENADE_CYCLE_DURATION: CYCLE_DURATION,
    GRENADE_WINDUP_DURATION: WINDUP_DURATION,
    GRENADE_THROW_DURATION: THROW_DURATION,
    GRENADE_COOLDOWN_DURATION: COOLDOWN_DURATION,
    GRENADE_FLIGHT_DURATION: FLIGHT_DURATION,
    GRENADE_FUSE_DURATION: FUSE_DURATION,
    GRENADE_BLAST_RADIUS: BLAST_RADIUS,
    GRENADE_KNOCKBACK_DURATION: KNOCKBACK_DURATION,
    GRENADE_KNOCKBACK_SPEED_MULTIPLIER: KNOCKBACK_SPEED_MULTIPLIER,
    heldGrenadePosition,
    createThrownGrenade,
    createGrenadeKnockback: createKnockback,
    drawGrenadeSprite
  };
});
