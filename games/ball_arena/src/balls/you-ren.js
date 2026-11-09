(function initializeYouRen(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/contact-model.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createYouRenPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, firstSegmentCircleContact } = dependencies;
  const RULES = Object.freeze({
    damage: 2, bladeCount: 5, bladeLength: 24, bladeRadius: 2,
    thrustSpeed: 520, returnSpeed: 660, reach: 145, thrustInterval: 0.18,
    thrustRamp: 0.075, returnRamp: 0.09, swordQiLife: 0.2,
    equipTime: 0.06, minimumPark: 0.18, maximumPark: 1.1,
    stepMultiplier: 3.6, stepTime: 0.13, stepCooldown: 0.48, thinkInterval: 0.06
  });
  const EPSILON = 1e-7;
  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const live = (entity) => entity && entity.entityActive !== false && entity.age < entity.life;

  function unit(x, y) {
    const distance = Math.hypot(x, y);
    return distance > EPSILON ? { x: x / distance, y: y / distance } : { x: 1, y: 0 };
  }

  function predict(ball, time, size) {
    const motion = resolveArenaGeometry(size).advanceMotion({ x: ball.x, y: ball.y, vx: ball.vx || 0, vy: ball.vy || 0, radius: ball.radius }, time);
    return { x: motion.x, y: motion.y };
  }

  function readyPosition(owner, index, angle) {
    const fanAngle = angle + Math.PI + (index - (RULES.bladeCount - 1) / 2) * 0.46;
    return { x: owner.x + Math.cos(fanAngle) * 27,
      y: owner.y + Math.sin(fanAngle) * 27 };
  }

  // Integrate a trapezoidal velocity profile exactly; short flights use a triangle.
  function sampleYouRenFlight(distance, maxSpeed, rampTime, age) {
    if (distance <= EPSILON) return { distance: 0, speed: 0, duration: 0 };
    const acceleration = maxSpeed / rampTime;
    const ramp = Math.min(rampTime, Math.sqrt(distance / acceleration));
    const peak = acceleration * ramp;
    const cruise = Math.max(0, (distance - peak * ramp) / peak);
    const duration = ramp * 2 + cruise;
    const time = clamp(age, 0, duration);
    if (time >= duration) return { distance, speed: 0, duration };
    if (time < ramp) return { distance: acceleration * time * time / 2, speed: acceleration * time, duration };
    if (time < ramp + cruise) return { distance: peak * (time - ramp / 2), speed: peak, duration };
    const remaining = duration - time;
    return { distance: distance - acceleration * remaining * remaining / 2, speed: acceleration * remaining, duration };
  }

  function travelTime(distance, returning) {
    return sampleYouRenFlight(distance, returning ? RULES.returnSpeed : RULES.thrustSpeed,
      returning ? RULES.returnRamp : RULES.thrustRamp, 0).duration;
  }

  function startFlight(blade, destination) {
    blade.flightX = blade.x; blade.flightY = blade.y;
    blade.flightDistance = Math.hypot(destination.x - blade.x, destination.y - blade.y);
    blade.flightAge = 0; blade.motionSpeed = 0;
  }

  function turnToward(angle, target, dt, turnSpeed = 18) {
    const difference = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
    return angle + clamp(difference, -turnSpeed * dt, turnSpeed * dt);
  }

  function launchYouRenBlade(blade, destination) {
    if (!live(blade) || blade.phase !== "ready" || blade.equip > 0) return false;
    blade.phase = "outbound";
    blade.endX = destination.x; blade.endY = destination.y;
    startFlight(blade, destination);
    blade.hits.clear();
    return true;
  }

  function recallYouRenBlade(blade) {
    if (!live(blade) || blade.phase !== "parked") return false;
    blade.phase = "returning";
    startFlight(blade, readyPosition(blade.owner, blade.index, blade.formationAngle));
    blade.hits.clear();
    return true;
  }

  function drawSwordQi(entity, context) {
    context.save();
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const sample of entity.trail) {
      const fade = clamp(sample.life / RULES.swordQiLife, 0, 1);
      const dx = sample.endX - sample.x, dy = sample.endY - sample.y;
      const direction = unit(dx, dy);
      const width = (1.5 + sample.power * 4.5) * fade;
      const nx = -direction.y * width, ny = direction.x * width;
      const startFade = clamp((sample.life - sample.dt) / RULES.swordQiLife, 0, 1);
      const startWidth = (1.5 + sample.startPower * 4.5) * startFade;
      const startNx = -direction.y * startWidth, startNy = direction.x * startWidth;
      context.globalAlpha = fade * 0.2;
      context.fillStyle = sample.returning ? "#eac989" : "#7ce6d0";
      context.beginPath();
      context.moveTo(sample.x - startNx, sample.y - startNy);
      context.lineTo(sample.endX - nx, sample.endY - ny);
      context.lineTo(sample.endX + nx, sample.endY + ny);
      context.lineTo(sample.x + startNx, sample.y + startNy);
      context.closePath(); context.fill();
      context.globalAlpha = fade * 0.58;
      context.strokeStyle = sample.returning ? "#fff0c7" : "#d4fff4";
      context.lineWidth = 0.4 + fade * sample.power * 1.1;
      context.beginPath(); context.moveTo(sample.x, sample.y);
      context.lineTo(sample.endX, sample.endY); context.stroke();
    }
    if (entity.phase === "outbound" || entity.phase === "returning") {
      const power = clamp(entity.motionSpeed / (entity.phase === "returning" ? RULES.returnSpeed : RULES.thrustSpeed), 0, 1);
      context.translate(entity.x, entity.y); context.rotate(entity.motionAngle);
      context.globalAlpha = power * 0.15;
      context.fillStyle = entity.phase === "returning" ? "#ffe1a0" : "#84ffe1";
      context.beginPath(); context.moveTo(18, 0);
      context.quadraticCurveTo(-3, -9, -26 - power * 14, 0);
      context.quadraticCurveTo(-3, 9, 18, 0); context.fill();
      context.globalAlpha = power * 0.8;
      context.strokeStyle = entity.phase === "returning" ? "#fff1c7" : "#d9fff5";
      context.lineWidth = 0.8;
      for (const sign of [-1, 1]) {
        context.beginPath(); context.moveTo(-24 - power * 10, sign * 2);
        context.quadraticCurveTo(-2, sign * (5 + power * 3), 16, 0); context.stroke();
      }
    }
    context.restore();
  }

  function createBlade(owner, index, angle) {
    const position = readyPosition(owner, index, angle);
    return {
      kind: "you-ren-blade", combatKind: "skill", lifecycle: "owner-bound", life: 86400,
      indestructible: true, targetable: false, damage: RULES.damage,
      // Fixed weapons have no breakable surface for the shield/steel-coil prop solver.
      shieldBreakPoints: [],
      attackTags: ["physical", "piercing"], radius: RULES.bladeRadius,
      x: position.x, y: position.y, index, angle, readyAngle: angle, formationAngle: angle,
      flightAge: 0, motionSpeed: 0, motionAngle: angle,
      phase: "ready", equip: 0, parkedAge: 0, hits: new Set(), trail: [],
      update({ entity, game, services }, dt) {
        const owner = entity.owner;
        entity.equip = Math.max(0, entity.equip - dt);
        entity.formationAngle = turnToward(entity.formationAngle, entity.readyAngle, dt);
        for (const sample of entity.trail) sample.life -= dt;
        entity.trail = entity.trail.filter(sample => sample.life > 0);
        if (entity.phase === "ready") {
          const point = readyPosition(owner, entity.index, entity.formationAngle);
          entity.x = point.x; entity.y = point.y;
          entity.angle = turnToward(entity.angle, entity.formationAngle, dt);
          return;
        }
        if (entity.phase === "parked") { entity.parkedAge += dt; return; }
        const returning = entity.phase === "returning";
        const destination = returning ? readyPosition(owner, entity.index, entity.formationAngle) : { x: entity.endX, y: entity.endY };
        entity.flightAge += dt;
        const sample = sampleYouRenFlight(entity.flightDistance, returning ? RULES.returnSpeed : RULES.thrustSpeed,
          returning ? RULES.returnRamp : RULES.thrustRamp, entity.flightAge);
        const progress = entity.flightDistance > EPSILON ? sample.distance / entity.flightDistance : 1;
        const startX = entity.x, startY = entity.y;
        // A moving return endpoint blends into the ready slot with matching velocity, not a catch teleport.
        entity.x = entity.flightX + (destination.x - entity.flightX) * progress;
        entity.y = entity.flightY + (destination.y - entity.flightY) * progress;
        const direction = unit(entity.x - startX, entity.y - startY);
        entity.motionAngle = Math.atan2(direction.y, direction.x);
        const previousSpeed = entity.motionSpeed;
        entity.motionSpeed = sample.speed;
        let angle = entity.motionAngle;
        if (returning && progress > 0.75) {
          const settle = (progress - 0.75) / 0.25;
          angle += Math.atan2(Math.sin(entity.formationAngle - angle), Math.cos(entity.formationAngle - angle)) * settle;
        }
        entity.angle = turnToward(entity.angle, angle, dt, 36);
        entity.trail.push({ x: startX, y: startY, endX: entity.x, endY: entity.y,
          power: clamp(sample.speed / (returning ? RULES.returnSpeed : RULES.thrustSpeed), 0, 1),
          startPower: clamp(previousSpeed / (returning ? RULES.returnSpeed : RULES.thrustSpeed), 0, 1),
          returning, dt, life: RULES.swordQiLife });
        if (entity.trail.length > 24) entity.trail.shift();
        // Sweep the visible blade, not a large circular approximation of its length.
        const half = RULES.bladeLength / 2;
        services.forEachEnemy(target => {
          if (entity.hits.has(target.instanceId) || !services.getContactProfile(target).attackable) return;
          const hit = firstSegmentCircleContact(startX - direction.x * half, startY - direction.y * half,
            entity.x + direction.x * half, entity.y + direction.y * half,
            target.x, target.y, target.radius + RULES.bladeRadius);
          if (hit === null) return;
          entity.hits.add(target.instanceId);
          if (services.dealDamage(target, RULES.damage)) {
            services.spawnParticleBurst({ x: target.x, y: target.y, count: 4,
              minDiameter: 0.5, maxDiameter: 1.3, life: 0.12,
              colors: ["#d6fff1", "#e4cf91"], minSpeed: 18, maxSpeed: 45 });
          }
        });
        if (returning && progress >= 1) {
          entity.phase = "ready"; entity.equip = RULES.equipTime;
          entity.hits.clear();
        } else if (!returning && progress >= 1) {
          entity.phase = "parked"; entity.parkedAge = 0;
          Object.assign(entity, resolveArenaGeometry(game).clampPoint(entity.x, entity.y, half));
        }
      },
      draw({ entity }, context) {
        context.save();
        drawSwordQi(entity, context);
        context.globalAlpha = 1;
        context.translate(entity.x, entity.y); context.rotate(entity.angle);
        context.lineWidth = 0.65; context.strokeStyle = "#344b48";
        context.fillStyle = entity.phase === "returning" ? "#fff0c6" : "#deefeb";
        context.beginPath(); context.moveTo(12, 0); context.lineTo(6, -2);
        context.lineTo(-7, -2); context.lineTo(-7, 2); context.lineTo(6, 2);
        context.closePath(); context.fill(); context.stroke();
        context.strokeStyle = "#ffffff"; context.lineWidth = 0.5;
        context.beginPath(); context.moveTo(-6, 0); context.lineTo(11, 0); context.stroke();
        context.fillStyle = "#ccae68"; context.fillRect(-8, -3.2, 1.5, 6.4);
        context.fillStyle = "#528e82"; context.fillRect(-12, -1.3, 4, 2.6);
        if (entity.phase === "parked") {
          context.globalAlpha = 0.35 + Math.sin(entity.parkedAge * 8) * 0.12;
          context.strokeStyle = "#84d8bd"; context.lineWidth = 0.65;
          context.beginPath(); context.arc(0, 0, 5, 0, TAU); context.stroke();
        }
        context.restore();
      }
    };
  }

  function incomingShots(game, services) {
    return game.combatEntities.filter(entity => live(entity) && entity.isProjectile &&
      entity.damage > 0 && Number.isFinite(entity.vx) && Number.isFinite(entity.vy) && services.isEnemy(entity));
  }

  function movementRisk(ball, x, y, time, enemies, shots, size) {
    let risk = 0;
    for (const enemy of enemies) {
      for (const fraction of [0.35, 0.7, 1]) {
        const point = predict(enemy, time * fraction, size);
        const gap = Math.hypot(ball.x + (x - ball.x) * fraction - point.x,
          ball.y + (y - ball.y) * fraction - point.y) - ball.radius - enemy.radius;
        if (gap < 12) risk += (12 - gap) * 4;
      }
    }
    for (const shot of shots) {
      const intersection = firstSegmentCircleContact(shot.x - ball.x, shot.y - ball.y,
        shot.x + shot.vx * time - x, shot.y + shot.vy * time - y, 0, 0,
        ball.radius + (shot.radius || 2) + 3);
      if (intersection !== null) risk += 100;
    }
    return risk;
  }

  function chooseWalkingDirection(ball, target, game, services, sign) {
    const radial = unit(target.x - ball.x, target.y - ball.y);
    const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
    const approach = clamp((distance - 68) / 24, -2, 2);
    const preferred = Math.atan2(radial.y * approach + radial.x * sign, radial.x * approach - radial.y * sign);
    const enemies = services.getEnemies(), shots = incomingShots(game, services);
    const time = 0.16, travel = ball.speed * ball.speedMultiplier * time;
    const future = predict(target, time, game);
    let best = null;
    for (let i = 0; i < 12; i++) {
      const angle = preferred + i * TAU / 12;
      const dx = Math.cos(angle), dy = Math.sin(angle);
      const x = ball.x + dx * travel, y = ball.y + dy * travel;
      if (!resolveArenaGeometry(game).contains(x, y, ball.radius + 1)) continue;
      const score = Math.cos(angle - preferred) * 8 - Math.abs(Math.hypot(x - future.x, y - future.y) - 68) * 0.3 -
        movementRisk(ball, x, y, time, enemies, shots, game);
      if (!best || score > best.score) best = { x: dx, y: dy, score };
    }
    return best || unit(game.arenaSize / 2 - ball.x, game.arenaSize / 2 - ball.y);
  }

  // Compare a bounded set of reachable positions. No hidden knowledge of an enemy's next decision.
  function chooseYouRenStep(ball, target, blades, game, services) {
    const enemies = services.getEnemies();
    const parked = blades.filter(blade => live(blade) && blade.phase === "parked" && blade.parkedAge >= RULES.minimumPark);
    const shots = incomingShots(game, services);
    const travel = ball.speed * ball.speedMultiplier * RULES.stepMultiplier * RULES.stepTime;
    const heading = Math.atan2(target.y - ball.y, target.x - ball.x);
    function evaluate(x, y, time) {
      const risk = movementRisk(ball, x, y, time, enemies, shots, game);
      let score = 0;
      const recall = [], angles = [];
      for (const blade of parked) {
        let hits = 0;
        const dock = readyPosition({ x, y }, blade.index, blade.formationAngle);
        for (const enemy of enemies) {
          const flight = travelTime(Math.hypot(enemy.x - blade.x, enemy.y - blade.y), true);
          const future = predict(enemy, time + flight, game);
          if (firstSegmentCircleContact(blade.x, blade.y, dock.x, dock.y,
            future.x, future.y, enemy.radius + RULES.bladeRadius) !== null) hits++;
        }
        if (hits) { recall.push(blade); score += hits * 70; angles.push(Math.atan2(blade.y - target.y, blade.x - target.x)); }
      }
      for (let i = 1; i < angles.length; i++) score += Math.abs(Math.sin(angles[i] - angles[0])) * 15;
      const future = predict(target, time, game);
      score -= Math.abs(Math.hypot(x - future.x, y - future.y) - 68) * 0.35;
      score -= risk;
      return { x, y, recall, score, risk };
    }
    const baselinePoint = resolveArenaGeometry(game).clampPoint(ball.x + ball.vx * RULES.stepTime, ball.y + ball.vy * RULES.stepTime, ball.radius);
    const baseline = evaluate(baselinePoint.x, baselinePoint.y, RULES.stepTime);
    let best = null;
    for (const length of [travel * 0.5, travel]) {
      for (let index = 0; index < 12; index++) {
        const angle = heading + index * TAU / 12;
        const { x: x, y: y } = resolveArenaGeometry(game).clampPoint(ball.x + Math.cos(angle) * length, ball.y + Math.sin(angle) * length, ball.radius + 2);
        if (Math.hypot(x - ball.x, y - ball.y) < 20) continue;
        const candidate = evaluate(x, y, RULES.stepTime * length / Math.max(travel, EPSILON));
        if (!best || candidate.score > best.score) best = candidate;
      }
    }
    return best && (best.score > baseline.score + 8 || (baseline.risk > 20 && best.risk < baseline.risk * 0.6)) ? best : null;
  }

  const youRenDefinition = {
    id: "youRen", name: "游刃", englishName: "You Ren", color: "#639f93", rosterType: "elite",
    collisionDamage: RULES.damage,
    description: "五剑加速突刺、减速留场 / 侧步避险调整剑路 / 交叉回收 / 碰撞与每次剑击均为2伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let blades = [], baseMultiplier = 1, shotTimer = 0, thinkTimer = 0, stepTimer = 0;
      let step = null, retired = false, orbitSign = 1, walk = { x: 1, y: 0 };
      let trail = null;
      const counts = { thrusts: 0, recalls: 0, steps: 0, crossedRecalls: 0 };
      function speed(ball, multiplier) {
        const value = baseMultiplier * multiplier;
        if (Math.abs(ball.speedMultiplierBase - value) > EPSILON) services.setSpeedMultiplier(value);
      }
      function steer(ball, x, y) {
        if (services.isMovementLocked(ball)) return;
        const direction = unit(x, y), value = ball.speed * ball.speedMultiplier;
        ball.vx = ball.storedVx = direction.x * value;
        ball.vy = ball.storedVy = direction.y * value;
      }
      function recall(selected) {
        const capabilities = blades.length ? services.getCapabilities(blades[0].owner) : null;
        if (!capabilities || !capabilities.canAct || !capabilities.canDealDamage) return;
        let recalled = 0;
        for (const blade of selected) if (recallYouRenBlade(blade)) { counts.recalls++; recalled++; }
        if (recalled > 1) counts.crossedRecalls++;
        if (recalled) services.playSound("shoot", { intensity: 0.5 });
      }
      function stop({ ball }) { step = null; speed(ball, 1); }
      function retire(context) {
        retired = true; stop(context);
        if (trail) trail.end(true);
        for (const blade of blades) { blade.entityActive = false; blade.hits.clear(); }
      }
      return {
        onSpawn({ ball }) {
          baseMultiplier = ball.speedMultiplierBase;
          const target = services.getOpponent();
          const angle = target ? Math.atan2(target.y - ball.y, target.x - ball.x) : Math.atan2(ball.vy, ball.vx);
          blades = Array.from({ length: RULES.bladeCount }, (_, index) => services.spawnCombatEntity(createBlade(ball, index, angle)));
          trail = services.spawnAfterimageTrail({ kind: "you-ren-step-trail", color: youRenDefinition.color,
            sampleLife: 0.12, sampleInterval: 0.02, maxSamples: 8, maxAlpha: 0.22,
            widthRatio: 0.65, maxStretch: 1.5 }, { lifecycle: "owner-bound" });
        },
        update({ ball, game }, dt) {
          if (retired) return;
          shotTimer = Math.max(0, shotTimer - dt);
          thinkTimer = Math.max(0, thinkTimer - dt);
          stepTimer = Math.max(0, stepTimer - dt);
          const target = services.getOpponent();
          if (!target || services.isMovementLocked(ball)) { stop({ ball }); return; }
          if (step) {
            step.remaining -= dt;
            if (Math.hypot(step.x - ball.x, step.y - ball.y) < 6) {
              recall(step.recall); stop({ ball }); thinkTimer = 0;
            } else { steer(ball, step.x - ball.x, step.y - ball.y); return; }
          }
          if (thinkTimer <= EPSILON) {
            thinkTimer = RULES.thinkInterval;
            walk = chooseWalkingDirection(ball, target, game, services, orbitSign);
            const plan = stepTimer <= EPSILON ? chooseYouRenStep(ball, target, blades, game, services) : null;
            if (plan) {
              step = plan;
              speed(ball, RULES.stepMultiplier);
              step.remaining = Math.min(RULES.stepTime, Math.hypot(plan.x - ball.x, plan.y - ball.y) /
                Math.max(1, ball.speed * ball.speedMultiplier)) - dt;
              stepTimer = RULES.stepCooldown; counts.steps++;
              steer(ball, plan.x - ball.x, plan.y - ball.y);
              return;
            }
            const useful = blades.filter(blade => {
              if (blade.phase !== "parked" || blade.parkedAge < RULES.minimumPark) return false;
              const future = predict(target, travelTime(Math.hypot(target.x - blade.x, target.y - blade.y), true), game);
              const dock = readyPosition(ball, blade.index, blade.formationAngle);
              return blade.parkedAge >= RULES.maximumPark || firstSegmentCircleContact(blade.x, blade.y,
                dock.x, dock.y, future.x, future.y, target.radius + RULES.bladeRadius) !== null;
            });
            recall(useful);
          }
          steer(ball, walk.x, walk.y);
        },
        afterUpdateStep({ ball, game }) {
          if (retired) return;
          if (services.isMovementLocked(ball)) { stop({ ball }); return; }
          if (step) {
            trail.emit(ball.x, ball.y, ball.radius, { heading: Math.atan2(ball.vy, ball.vx), speed: Math.hypot(ball.vx, ball.vy) });
            if (step.remaining <= EPSILON) { recall(step.recall); stop({ ball }); thinkTimer = 0; }
          }
          if (!services.getCapabilities(ball).canDealDamage) return;
          const target = services.getOpponent();
          if (!target) return;
          const angle = Math.atan2(target.y - ball.y, target.x - ball.x);
          for (const blade of blades) blade.readyAngle = angle;
          if (shotTimer > EPSILON) return;
          const blade = blades.find(candidate => candidate.phase === "ready" && candidate.equip <= EPSILON);
          if (!blade) return;
          let future = predict(target, travelTime(Math.hypot(target.x - blade.x, target.y - blade.y), false), game);
          future = predict(target, travelTime(Math.hypot(future.x - blade.x, future.y - blade.y), false), game);
          const aim = unit(future.x - blade.x, future.y - blade.y);
          if (Math.hypot(future.x - blade.x, future.y - blade.y) > RULES.reach + target.radius) return;
          const travel = Math.min(RULES.reach, Math.hypot(future.x - blade.x, future.y - blade.y) + target.radius + 24);
          const half = RULES.bladeLength / 2;
          if (launchYouRenBlade(blade, resolveArenaGeometry(game).clampPoint(blade.x + aim.x * travel, blade.y + aim.y * travel, half))) {
            shotTimer = RULES.thrustInterval; counts.thrusts++; services.playSound("shoot", { intensity: 0.5 });
          }
        },
        getNextTransitionIn() { return step ? Math.max(EPSILON, step.remaining) : undefined; },
        updateWhilePaused: stop,
        afterUpdateStepWhilePaused: stop,
        onWallBounce() { orbitSign *= -1; },
        onArenaWrap: stop,
        onCollision(context, target) { context.services.dealDamage(target, RULES.damage); },
        onDeath: retire,
        onBorrowEnd: retire,
        getYouRenState() { return Object.assign({}, counts, { stepping: Boolean(step), phases: blades.map(blade => blade.phase) }); }
      };
    }
  };
  registerBall(youRenDefinition);
  return { youRenDefinition, YOU_REN_RULES: RULES, launchYouRenBlade, recallYouRenBlade, chooseYouRenStep, sampleYouRenFlight };
});
