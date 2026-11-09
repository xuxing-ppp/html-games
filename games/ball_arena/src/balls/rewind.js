(function initializeRewind(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createRewindPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, firstSegmentCircleContact } = dependencies;
  const EPSILON = 1e-8;
  const REWIND_SETTINGS = Object.freeze({
    phaseSeconds: 3, shotInterval: 0.5, bulletSpeed: 450,
    bulletDamage: 2, returnDamageMultiplier: 2, bulletRadius: 2,
    maxHistoryFrames: 2048
  });
  const DURATION = REWIND_SETTINGS.phaseSeconds;

  // These are mechanic-owned trajectories, not visual snapshots or a world save.
  // Bound history even when another ability introduces tiny simulation substeps.
  function recordFrame(frames, time, body) {
    const frame = { time, x: body.x, y: body.y, vx: body.vx, vy: body.vy };
    if (frames.length && Math.abs(frames.at(-1).time - time) < EPSILON) frames[frames.length - 1] = frame;
    else frames.push(frame);
    if (frames.length > REWIND_SETTINGS.maxHistoryFrames) {
      let write = 1;
      for (let read = 2; read < frames.length - 1; read += 2) frames[write++] = frames[read];
      frames[write++] = frames.at(-1);
      frames.length = write;
    }
  }

  function sampleFrame(frames, time) {
    if (time <= frames[0].time) return frames[0];
    if (time >= frames.at(-1).time) return frames.at(-1);
    let low = 0;
    let high = frames.length - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (frames[mid].time <= time) low = mid;
      else high = mid;
    }
    const a = frames[low];
    const b = frames[high];
    const p = (time - a.time) / (b.time - a.time);
    return { time, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p,
      vx: a.vx + (b.vx - a.vx) * p, vy: a.vy + (b.vy - a.vy) * p };
  }

  function drawBullet({ effect }, context) {
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(Math.atan2(effect.vy, effect.vx));
    context.fillStyle = effect.returning ? "#e1fff8" : "#78ddd1";
    context.fillRect(-7, -1, 7, 2);
    context.beginPath();
    context.arc(0, 0, effect.radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function createForwardBullet(record, x, y, vx, vy) {
    return {
      kind: "rewind-bullet", life: DURATION + 0.1,
      x, y, vx, vy, radius: REWIND_SETTINGS.bulletRadius,
      damage: REWIND_SETTINGS.bulletDamage,
      update({ effect, game, services }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        const endX = startX + effect.vx * dt;
        const endY = startY + effect.vy * dt;
        const arena = resolveArenaGeometry(game);
        const wall = arena.traceSegment(startX, startY, endX, endY, effect.radius);
        let fraction = wall ? wall.t : 1;
        let hit = null;
        services.forEachEnemy((target) => {
          const p = firstSegmentCircleContact(startX, startY, endX, endY,
            target.x, target.y, target.radius + effect.radius);
          if (p !== null && p <= fraction && (!hit || p < fraction)) { hit = target; fraction = p; }
        });
        effect.x = startX + (endX - startX) * fraction;
        effect.y = startY + (endY - startY) * fraction;
        if (record.recording) recordFrame(record.frames, game.time, effect);
        if (hit) {
          if (!services.tryConsumeEntity(hit, effect)) services.dealDamage(hit, effect.damage);
          effect.life = 0;
        } else if (fraction < 1 || !arena.contains(endX, endY, effect.radius)) {
          effect.life = 0;
        }
        if (effect.life === 0 && record.recording) record.endedAt = game.time;
      },
      draw: drawBullet
    };
  }

  function createReturnBullet(record, rewindStartedAt, forwardStartedAt) {
    const end = record.frames.at(-1);
    // Interceptors may have stopped a projectile before consuming it. A return
    // still has a valid launch signature; actual movement is sampled below.
    const launch = Math.hypot(end.vx, end.vy) > EPSILON ? end : record.frames[0];
    const finishesAt = rewindStartedAt + DURATION - (record.bornAt - forwardStartedAt);
    const appearsAt = rewindStartedAt + DURATION - (record.endedAt - forwardStartedAt);
    let previousTime = record.endedAt;
    const hitTargets = new Set();
    return {
      kind: "rewind-return-bullet", returning: true, lifecycle: "owner-bound",
      life: Math.max(EPSILON, finishesAt - appearsAt + 0.05),
      x: end.x, y: end.y, vx: -launch.vx, vy: -launch.vy,
      radius: REWIND_SETTINGS.bulletRadius,
      damage: REWIND_SETTINGS.bulletDamage * REWIND_SETTINGS.returnDamageMultiplier,
      // Preserve this shot's forced-target/output policy; current kit holder is
      // supplied by the spawning service (including live attack transfers).
      targetPolicy: record.entity.combatSource.targetPolicy,
      damageOutputScale: record.entity.combatSource.damageOutputScale,
      update({ effect, game, services }) {
        const cursor = Math.max(record.bornAt,
          forwardStartedAt + DURATION - (game.time - rewindStartedAt));
        const sample = sampleFrame(record.frames, cursor);
        let from = sampleFrame(record.frames, previousTime);
        function sweep(to) {
          services.forEachEnemy((target) => {
            if (effect.entityActive === false || hitTargets.has(target.instanceId)) return;
            const p = firstSegmentCircleContact(from.x, from.y, to.x, to.y,
              target.x, target.y, target.radius + effect.radius);
            if (p === null) return;
            if (services.tryConsumeEntity(target, effect)) return;
            if (services.dealDamage(target, effect.damage)) hitTargets.add(target.instanceId);
          });
          from = to;
        }
        // Traverse every recorded bend, not the chord across a reflected path.
        for (let i = record.frames.length - 1; i >= 0; i -= 1) {
          const frame = record.frames[i];
          if (frame.time < previousTime - EPSILON && frame.time > cursor + EPSILON) sweep(frame);
        }
        sweep(sample); // Zero-length first contact is deliberately a valid hit.
        effect.x = sample.x;
        effect.y = sample.y;
        effect.vx = -sample.vx;
        effect.vy = -sample.vy;
        previousTime = cursor;
        if (game.time >= finishesAt - EPSILON) effect.life = 0;
      },
      draw: drawBullet
    };
  }

  const rewindDefinition = {
    id: "rewind", name: "倒流", englishName: "Rewind", color: "#55c9c4",
    description: "正向3秒 / 倒流3秒 / 子弹回溯双倍贯穿 / 返还历史伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services) {
      let phase = "forward";
      let phaseStartedAt = null;
      let forwardStartedAt = 0;
      let nextShotAt = 0;
      let frames = [];
      let shots = [];
      let injuries = [];
      let motion = null;
      let bodyInterrupted = false;
      let trail = null;
      let completedCycles = 0;

      function endTrail(hard = false) {
        if (trail) trail.end(hard);
        trail = null;
      }

      function releaseHistory() {
        for (const shot of shots) {
          shot.recording = false;
          if (shot.returnEntity) shot.returnEntity.entityActive = false;
        }
        frames = [];
        shots = [];
        injuries = [];
        motion = null;
        endTrail();
      }

      function startForward(context, start = context.game.time) {
        releaseHistory();
        phase = "forward";
        phaseStartedAt = forwardStartedAt = start;
        nextShotAt = start;
        bodyInterrupted = false;
        recordFrame(frames, start, context.ball);
        context.ball.speedNeedsNormalization = true;
      }

      function closeShot(shot, time) {
        if (shot.endedAt === null && (!shot.entity.entityActive || shot.entity.life <= shot.entity.age)) {
          recordFrame(shot.frames, time, shot.entity);
          shot.endedAt = time;
        }
      }

      function startReverse(context) {
        const end = phaseStartedAt + DURATION;
        recordFrame(frames, end, context.ball);
        phase = "reverse";
        phaseStartedAt = end;
        for (const shot of shots) {
          closeShot(shot, end);
          if (shot.endedAt === null) {
            recordFrame(shot.frames, end, shot.entity);
            shot.endedAt = end;
          }
          shot.recording = false;
          shot.entity.entityActive = false;
        }
        injuries.sort((a, b) => a.time - b.time);
        services.playSound("ability", { cue: "wind", intensity: 0.65 });
      }

      function prepare(context) {
        if (phaseStartedAt === null) startForward(context);
        const now = context.game.time;
        if (now >= phaseStartedAt + DURATION - EPSILON) {
          if (phase === "forward") startReverse(context);
          else {
            completedCycles += 1;
            startForward(context, phaseStartedAt + DURATION);
          }
        }
        if (phase === "forward") {
          // beginFight/legacy arena setup can finalize position and velocity
          // after onSpawn. Capture the actual first simulation boundary.
          if (Math.abs(now - forwardStartedAt) < EPSILON) recordFrame(frames, now, context.ball);
          for (const shot of shots) closeShot(shot, now);
        } else {
          for (const shot of shots) {
            const appearsAt = phaseStartedAt + DURATION - (shot.endedAt - forwardStartedAt);
            if (!shot.returnEntity && now >= appearsAt - EPSILON) {
              shot.returnEntity = services.spawnProjectile(createReturnBullet(shot, phaseStartedAt, forwardStartedAt));
            }
          }
        }
      }

      function update(context, mayFire) {
        if (phaseStartedAt === null) startForward(context);
        const { ball, game } = context;
        motion = null;
        if (phase === "forward") {
          if (game.time < phaseStartedAt + DURATION - EPSILON && game.time >= nextShotAt - EPSILON) {
            nextShotAt = game.time + REWIND_SETTINGS.shotInterval;
            const target = mayFire ? services.getOpponent() : null;
            if (target) {
              const dx = target.x - ball.x;
              const dy = target.y - ball.y;
              const length = Math.hypot(dx, dy);
              const directionX = length > EPSILON ? dx / length : 1;
              const directionY = length > EPSILON ? dy / length : 0;
              const reach = ball.radius + REWIND_SETTINGS.bulletRadius;
              const { x, y } = resolveArenaGeometry(game).clampPoint(
                ball.x + directionX * reach, ball.y + directionY * reach, REWIND_SETTINGS.bulletRadius);
              const vx = directionX * REWIND_SETTINGS.bulletSpeed;
              const vy = directionY * REWIND_SETTINGS.bulletSpeed;
              const shot = { bornAt: game.time, endedAt: null, frames: [], recording: true, returnEntity: null };
              recordFrame(shot.frames, game.time, { x, y, vx, vy });
              const first = shot.frames[0];
              shot.entity = services.spawnProjectile(createForwardBullet(shot, x, y, first.vx, first.vy));
              shots.push(shot);
            }
          }
          return;
        }
        const cursor = Math.max(forwardStartedAt, forwardStartedAt + DURATION - (game.time - phaseStartedAt));
        // New control can interrupt the body path, never confer control immunity
        // or cause a catch-up teleport when released. Independent return bullets
        // and the world-timed cycle continue; the next cycle records a fresh path.
        if (!mayFire || services.isMovementLocked(ball) || services.getCapabilities(ball).canMove === false) {
          bodyInterrupted = true;
        }
        if (!bodyInterrupted) {
          const sample = sampleFrame(frames, cursor);
          motion = { x: sample.x, y: sample.y, vx: -sample.vx, vy: -sample.vy };
        }
        let recovered = 0;
        while (injuries.length && injuries.at(-1).time >= cursor - EPSILON) {
          const injury = injuries.pop();
          if (ball.hp <= 0) break;
          const amount = Math.min(injury.amount, Math.max(0, ball.maxHp - ball.hp));
          ball.hp += amount;
          recovered += amount;
        }
        if (recovered > EPSILON) {
          services.spawnHitText(ball, `+${Math.round(recovered * 100) / 100}`, { color: "#80edb6" });
          services.playSound("ability", { cue: "heal", intensity: 0.4 });
        }
      }

      function recordBody(context) {
        if (phase === "forward") recordFrame(frames, context.game.time, context.ball);
        else {
          const capabilities = services.getCapabilities(context.ball);
          if (capabilities.canMove === false || capabilities.canAct === false || context.ball.positionLocked) {
            bodyInterrupted = true;
            motion = null;
            endTrail();
          }
          if (!motion || bodyInterrupted) return;
          if (!trail) trail = services.spawnAfterimageTrail({
            kind: "rewind-body-trail", color: rewindDefinition.color,
            maxAlpha: 0.16, sampleLife: 0.14, maxSamples: 8
          }, { lifecycle: "owner-bound" });
          trail.emit(context.ball.x, context.ball.y, context.ball.radius, {
            heading: Math.atan2(context.ball.vy, context.ball.vx),
            speed: Math.hypot(context.ball.vx, context.ball.vy)
          });
        }
      }

      function stop() {
        endTrail(true);
        releaseHistory();
        phaseStartedAt = null;
      }

      return {
        onSpawn: startForward,
        beforeUpdateStep: prepare,
        update(context) { update(context, true); },
        updateWhilePaused(context) { update(context, false); },
        afterUpdateStep: recordBody,
        afterUpdateStepWhilePaused: recordBody,
        getPrescribedMotion() { return motion; },
        getNextTransitionIn(context) {
          if (phaseStartedAt === null) return undefined;
          let remaining = phaseStartedAt + DURATION - context.game.time;
          if (phase === "forward" && nextShotAt > context.game.time + EPSILON) {
            remaining = Math.min(remaining, nextShotAt - context.game.time);
          }
          if (phase === "reverse") {
            for (const shot of shots) {
              if (!shot.returnEntity) {
                const until = phaseStartedAt + DURATION - (shot.endedAt - forwardStartedAt) - context.game.time;
                if (until > EPSILON) remaining = Math.min(remaining, until);
              }
            }
          }
          return Math.max(EPSILON, remaining) / services.getAttackPeriodScale();
        },
        getNextPausedTransitionIn(context) { return this.getNextTransitionIn(context); },
        onDamageObserved(context, event) {
          if (phaseStartedAt !== null && phase === "forward" && context.ball.hp > 0 &&
              !services.isAbilitySealed(context.ball) && event.amount > 0) {
            const previous = injuries.at(-1);
            if (previous && Math.abs(previous.time - context.game.time) < EPSILON) previous.amount += event.amount;
            else injuries.push({ time: context.game.time, amount: event.amount });
            if (injuries.length > REWIND_SETTINGS.maxHistoryFrames) {
              injuries[1].amount += injuries[0].amount;
              injuries.shift();
            }
          }
        },
        onAttackTransfer(context) {
          // Cooldown and projectile history belong to the live kit. Body wounds
          // do not: never heal the borrower using damage suffered by the donor.
          injuries = [];
          frames = [];
          recordFrame(frames, phaseStartedAt === null ? context.game.time : forwardStartedAt, context.ball);
          recordFrame(frames, context.game.time, context.ball);
          bodyInterrupted = phase === "reverse";
          motion = null;
          endTrail(true);
        },
        onAbilitySealed: stop,
        onDeath: stop,
        onBattleEnd: stop,
        onBattleDispose: stop,
        onBorrowEnd: stop,
        getRewindState() {
          return { phase, phaseStartedAt, completedCycles, bodyInterrupted,
            bodyFrames: frames.length, shotCount: shots.length, injuryCount: injuries.length,
            projectileFrames: shots.reduce((sum, shot) => sum + shot.frames.length, 0) };
        }
      };
    }
  };
  registerBall(rewindDefinition);
  return { rewindDefinition, REWIND_SETTINGS, createRewindReturnBullet: createReturnBullet };
});
