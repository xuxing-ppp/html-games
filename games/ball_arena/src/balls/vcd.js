(function initializeVcd(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/damage-reduction.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVcdPlugin({ resolveArenaGeometry, registerBall, isTrueDamage }) {
  const HISTORY_DURATION = 2;
  const GHOST_DELAYS = [0.5, 1];
  const GHOST_COLORS = ["#54e6ff", "#ff4fc8"];
  const GHOST_DAMAGE = 1;
  const GHOST_DAMAGE_INTERVAL = 0.04;
  const BAD_SECTOR_INTERVAL = 4;
  const BAD_SECTOR_DAMAGE = 8;
  const BAD_SECTOR_RADIUS = 2;
  const ROLLBACK_DELAY = 1.5;
  const ROLLBACK_HP_THRESHOLD = 20;
  const ROLLBACK_COOLDOWN = 7;
  const FRAME_SKIP_DELAY = 0.5;
  const FRAME_SKIP_CHANCE = 0.3;
  const FRAME_SKIP_COOLDOWN = 0.5;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function copyState(ball, time) {
    return {
      time,
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      hp: ball.hp
    };
  }

  function sampleHistory(history, time) {
    if (history.length === 0) return null;
    if (history.length === 1 || time <= history[0].time) return { ...history[0] };
    for (let index = 1; index < history.length; index += 1) {
      const next = history[index];
      if (time > next.time) continue;
      const previous = history[index - 1];
      const duration = Math.max(EPSILON, next.time - previous.time);
      const progress = clamp((time - previous.time) / duration, 0, 1);
      return {
        time,
        x: previous.x + (next.x - previous.x) * progress,
        y: previous.y + (next.y - previous.y) * progress,
        vx: previous.vx + (next.vx - previous.vx) * progress,
        vy: previous.vy + (next.vy - previous.vy) * progress,
        hp: previous.hp + (next.hp - previous.hp) * progress
      };
    }
    return { ...history.at(-1) };
  }

  function drawGhost(context, ghost, radius, color) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.48;
    context.fillStyle = color;
    context.beginPath();
    context.arc(ghost.x, ghost.y, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha *= 0.42;
    context.fillStyle = "#e6fcff";
    for (let y = -radius + 3; y < radius; y += 5) {
      const halfWidth = Math.sqrt(Math.max(0, radius * radius - y * y));
      context.fillRect(ghost.x - halfWidth, ghost.y + y, halfWidth * 2, 1);
    }
    context.restore();
  }

  function drawVcdBody(context, ball, time, color) {
    const baseAlpha = context.globalAlpha;
    const jitter = Math.floor(time * 24) % 7 === 0 ? 1.5 : 0;
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha = baseAlpha * 0.47;
    context.fillStyle = GHOST_COLORS[1];
    context.beginPath();
    context.arc(ball.x + 2.5 + jitter, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = GHOST_COLORS[0];
    context.beginPath();
    context.arc(ball.x - 2.5 - jitter, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();

    context.globalCompositeOperation = "source-over";
    context.globalAlpha = baseAlpha * 0.9;
    context.fillStyle = color;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius - 1, 0, Math.PI * 2);
    context.fill();

    context.globalAlpha = baseAlpha * 0.24;
    context.fillStyle = "#edfaff";
    for (let y = -ball.radius + 3; y < ball.radius; y += 5) {
      const halfWidth = Math.sqrt(Math.max(0, ball.radius * ball.radius - y * y));
      context.fillRect(ball.x - halfWidth, ball.y + y, halfWidth * 2, 1);
    }
    context.restore();
  }

  function hashNoise(value) {
    const wave = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
    return wave - Math.floor(wave);
  }

  function drawPlaybackNoise(context, time, arenaSize) {
    const baseAlpha = context.globalAlpha;
    const frame = Math.floor(time * 12);
    const count = Math.max(30, Math.round(arenaSize * arenaSize / 850));
    context.save();
    context.globalAlpha = baseAlpha * 0.11;
    context.fillStyle = "#e2e3e8";
    for (let index = 0; index < count; index += 1) {
      const seed = frame * 977 + index * 37;
      const x = Math.floor(hashNoise(seed) * arenaSize);
      const y = Math.floor(hashNoise(seed + 19.7) * arenaSize);
      const width = hashNoise(seed + 41.3) > 0.91 ? 2 : 1;
      context.fillRect(x, y, width, 1);
    }

    const cycle = Math.floor(time / 3.4);
    const phase = time - cycle * 3.4;
    if (phase < 0.24) {
      const bandY = Math.floor(hashNoise(cycle * 53 + 11) * Math.max(1, arenaSize - 14));
      context.globalAlpha = baseAlpha * 0.09;
      context.fillStyle = "#cfd2d9";
      context.fillRect(0, bandY, arenaSize, 1);
      context.fillRect(0, bandY + 4, arenaSize, 2);
      context.globalAlpha = baseAlpha * 0.07;
      for (let index = 0; index < 8; index += 1) {
        const seed = cycle * 101 + index * 17;
        const x = Math.floor(hashNoise(seed) * arenaSize);
        const width = 8 + Math.floor(hashNoise(seed + 7) * 34);
        const y = bandY + Math.floor(hashNoise(seed + 13) * 10);
        context.fillRect(x, y, Math.min(width, arenaSize - x), 1);
      }
    }
    context.restore();
  }

  function drawPlaybackOsd(context, arenaSize, label) {
    const arena = resolveArenaGeometry(arenaSize);
    const x = arena.shape === "circle" ? arena.centerX + arena.width * 0.28 : arena.right - 8;
    const y = arena.shape === "circle" ? arena.centerY - arena.height * 0.28 : arena.top + 8;
    const colors = {
      "BAD SECTOR": "#ff4fc8",
      REWIND: "#54e6ff",
      "FRAME SKIP": "#f3f6ff"
    };
    context.save();
    context.globalAlpha *= 0.82;
    context.textAlign = "right";
    context.textBaseline = "top";
    context.font = '700 8px "Fusion Pixel 12 SC", "Courier New", monospace';
    context.fillStyle = colors[label] || "#d8f8ff";
    context.fillText(label, x, y);
    context.globalAlpha *= 0.64;
    context.font = '700 7px "Fusion Pixel 12 SC", "Courier New", monospace';
    context.fillStyle = "#c9cad3";
    context.fillText("DELAY 0.5s / 1.0s", x, y + 10);
    context.restore();
  }

  function segmentHitsBall(start, end, target, radius = 0) {
    const lineX = end.x - start.x;
    const lineY = end.y - start.y;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((target.x - start.x) * lineX + (target.y - start.y) * lineY) /
          lengthSquared,
        0,
        1
      );
    const closestX = start.x + lineX * progress;
    const closestY = start.y + lineY * progress;
    return Math.hypot(target.x - closestX, target.y - closestY) <= (
      target.radius + radius
    );
  }

  function createBadSectorEffect(body, ghosts) {
    const lines = ghosts.map((ghost, index) => ({
      startX: body.x,
      startY: body.y,
      endX: ghost.x,
      endY: ghost.y,
      color: GHOST_COLORS[index]
    }));
    return {
      kind: "vcd-bad-sector",
      life: 0.32,
      lines,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.setLineDash([7, 3, 2, 4]);
        effect.lines.forEach((line, lineIndex) => {
          const dx = line.endX - line.startX;
          const dy = line.endY - line.startY;
          const length = Math.hypot(dx, dy) || 1;
          const normalX = -dy / length;
          const normalY = dx / length;
          context.strokeStyle = line.color;
          context.lineWidth = 2.5;
          context.beginPath();
          context.moveTo(line.startX, line.startY);
          for (let step = 1; step < 6; step += 1) {
            const amount = step / 6;
            const tear = Math.sin((step + lineIndex * 2) * 2.7) * 3;
            context.lineTo(
              line.startX + dx * amount + normalX * tear,
              line.startY + dy * amount + normalY * tear
            );
          }
          context.lineTo(line.endX, line.endY);
          context.stroke();
        });
        context.restore();
      }
    };
  }

  function createRewindTrailEffect(path) {
    return {
      kind: "vcd-rewind-trail",
      life: 0.45,
      path: path.map((point) => ({ x: point.x, y: point.y })),
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= (1 - progress) * 0.72;
        effect.path.slice().reverse().forEach((point, index) => {
          const size = Math.max(1, 4 - index * 0.25);
          context.fillStyle = GHOST_COLORS[index % GHOST_COLORS.length];
          context.fillRect(
            Math.round(point.x - size / 2),
            Math.round(point.y - size / 2),
            size,
            size
          );
        });
        context.restore();
      }
    };
  }

  function createErrorFrameEffect(from, to, radius) {
    return {
      kind: "vcd-error-frame",
      life: 0.24,
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      radius,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= (1 - progress) * 0.65;
        [
          { color: GHOST_COLORS[1], offset: 3 },
          { color: GHOST_COLORS[0], offset: -3 }
        ].forEach(({ color, offset }) => {
          context.strokeStyle = color;
          context.lineWidth = 2;
          context.beginPath();
          context.arc(
            effect.from.x + offset,
            effect.from.y,
            effect.radius,
            0,
            Math.PI * 2
          );
          context.stroke();
        });
        context.setLineDash([3, 4]);
        context.strokeStyle = "#d9faff";
        context.beginPath();
        context.moveTo(effect.from.x, effect.from.y);
        context.lineTo(effect.to.x, effect.to.y);
        context.stroke();
        context.restore();
      }
    };
  }

  const vcdDefinition = {
    id: "vcd",
    name: "VCD",
    englishName: "VCD",
    color: "#756b86",
    description: "延迟播放 / 坏道切割 / 读取回滚",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services) {
      const history = [];
      let ghostStates = [];
      let ghostDamageTimers = GHOST_DELAYS.map(() => new Map());
      const ghostEntities = [];
      let badSectorTimer = 0;
      let rollbackReadyAt = 0;
      let frameSkipReadyAt = 0;
      let osdLabel = "VCD PLAYBACK";
      let osdUntil = 0;

      function ensureGhostEntities(context) {
        while (ghostEntities.length < GHOST_DELAYS.length) {
          const ghostIndex = ghostEntities.length;
          ghostEntities.push(services.spawnCombatEntity({
            kind: `vcd-ghost-${ghostIndex + 1}`,
            combatKind: "zone",
            lifecycle: "owner-bound",
            life: Number.MAX_SAFE_INTEGER,
            ghostIndex,
            update() {}
          }));
        }
      }

      function record(ball, time) {
        const state = copyState(ball, time);
        const latest = history.at(-1);
        if (latest && Math.abs(latest.time - time) <= EPSILON) {
          history[history.length - 1] = state;
        } else {
          history.push(state);
        }
        const cutoff = time - HISTORY_DURATION;
        while (history.length > 2 && history[1].time < cutoff) history.shift();
      }

      function updateGhosts(context, dt = 0) {
        ensureGhostEntities(context);
        record(context.ball, context.game.time);
        refreshGhostStates(context.ball, context.game.time);
        const elapsed = Math.max(0, dt);
        const nextTimers = GHOST_DELAYS.map(() => new Map());
        const enemies = services.getEnemies();
        ghostStates.forEach((ghost, ghostIndex) => {
          for (const enemy of enemies) {
            const key = enemy.instanceId || enemy.id;
            if (
              Math.hypot(enemy.x - ghost.x, enemy.y - ghost.y) >
              enemy.radius + context.ball.radius
            ) continue;
            let timer = (ghostDamageTimers[ghostIndex].get(key) || 0) + elapsed;
            while (timer + EPSILON >= GHOST_DAMAGE_INTERVAL && enemy.hp > 0) {
              ghostEntities[ghostIndex].services.dealDamage(enemy, GHOST_DAMAGE);
              timer -= GHOST_DAMAGE_INTERVAL;
            }
            nextTimers[ghostIndex].set(key, Math.max(0, timer));
          }
        });
        ghostDamageTimers = nextTimers;
      }

      function refreshGhostStates(ball, time) {
        ghostStates = GHOST_DELAYS.map((delay) => (
          sampleHistory(history, time - delay) || copyState(ball, time)
        ));
      }

      function setOsd(label, time, duration) {
        osdLabel = label;
        osdUntil = time + duration;
      }

      function rewindSharedHistory(context, seconds, restoreHp) {
        const { ball } = context;
        const now = context.game.time;
        record(ball, now);
        const earliestTime = history.length > 0 ? history[0].time : now;
        const targetTime = Math.max(earliestTime, now - seconds);
        const restored = sampleHistory(history, targetTime) || copyState(ball, now);
        const abandonedPath = history.filter((state) => (
          state.time >= targetTime - EPSILON
        ));
        const shift = now - targetTime;
        const retained = history
          .filter((state) => state.time < targetTime - EPSILON)
          .map((state) => ({ ...state, time: state.time + shift }));
        const currentHp = ball.hp;
        retained.push({
          ...restored,
          time: now,
          hp: restoreHp ? restored.hp : currentHp
        });
        history.splice(0, history.length, ...retained);

        const from = copyState(ball, now);
        ball.x = ball.prevX = restored.x;
        ball.y = ball.prevY = restored.y;
        ball.vx = ball.storedVx = restored.vx;
        ball.vy = ball.storedVy = restored.vy;
        if (restoreHp) ball.hp = restored.hp;
        refreshGhostStates(ball, now);
        ghostDamageTimers = GHOST_DELAYS.map(() => new Map());
        return { from, restored, abandonedPath };
      }

      function triggerRollback(context) {
        const result = rewindSharedHistory(context, ROLLBACK_DELAY, true);
        rollbackReadyAt = context.game.time + ROLLBACK_COOLDOWN;
        setOsd("REWIND", context.game.time, 0.85);
        services.spawnVisualEffect(createRewindTrailEffect(result.abandonedPath));
      }

      function triggerFrameSkip(context) {
        const result = rewindSharedHistory(context, FRAME_SKIP_DELAY, false);
        frameSkipReadyAt = context.game.time + FRAME_SKIP_COOLDOWN;
        setOsd("FRAME SKIP", context.game.time, 0.65);
        services.spawnVisualEffect(createErrorFrameEffect(
          result.from,
          result.restored,
          context.ball.radius
        ));
      }

      function triggerBadSector(context) {
        if (ghostStates.length !== GHOST_DELAYS.length) return;
        const body = copyState(context.ball, context.game.time);
        setOsd("BAD SECTOR", context.game.time, 0.7);
        services.spawnVisualEffect(createBadSectorEffect(body, ghostStates));
        for (const enemy of services.getEnemies()) {
          if (!ghostStates.some((ghost) => (
            segmentHitsBall(body, ghost, enemy, BAD_SECTOR_RADIUS)
          ))) continue;
          context.services.dealDamage(enemy, BAD_SECTOR_DAMAGE);
        }
      }

      function finishActiveStep(context, dt) {
        updateGhosts(context, dt);
        while (badSectorTimer + EPSILON >= BAD_SECTOR_INTERVAL) {
          badSectorTimer -= BAD_SECTOR_INTERVAL;
          triggerBadSector(context);
        }
      }

      return {
        onSpawn(context) {
          ensureGhostEntities(context);
        },
        update(_context, dt) {
          badSectorTimer += Math.max(0, dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, BAD_SECTOR_INTERVAL - badSectorTimer);
        },
        afterUpdateStep(context, dt) {
          finishActiveStep(context, dt);
        },
        afterUpdateStepWhilePaused(context, dt) {
          updateGhosts(context, dt);
        },
        onBeforeDamage(context, event) {
          if (
            !event || !event.actor || event.actor === context.ball ||
            !Number.isFinite(event.amount) || event.amount <= 0
          ) return event;

          const historical = sampleHistory(
            history,
            context.game.time - ROLLBACK_DELAY
          );
          const projectedHp = Math.max(0, context.ball.hp - event.amount);
          const lethal = projectedHp <= 0;
          const crossesThreshold = Boolean(
            historical && historical.hp - projectedHp >= ROLLBACK_HP_THRESHOLD
          );
          if (
            context.game.time + EPSILON >= rollbackReadyAt &&
            (lethal || crossesThreshold)
          ) {
            triggerRollback(context);
            return { amount: 0, showHitText: false, cancelAttack: true };
          }
          if (
            !isTrueDamage(event) && context.game.time + EPSILON >= frameSkipReadyAt &&
            Math.random() < FRAME_SKIP_CHANCE
          ) {
            triggerFrameSkip(context);
            return { amount: 0, showHitText: false, cancelAttack: true };
          }
          return event;
        },
        drawArenaBackground(context, canvasContext) {
          drawPlaybackNoise(canvasContext, context.game.time, context.game.arenaSize);
        },
        drawBefore(_context, canvasContext) {
          ghostStates.forEach((ghost, index) => {
            drawGhost(canvasContext, ghost, vcdDefinition.stats.radius, GHOST_COLORS[index]);
          });
        },
        drawBody(context, canvasContext) {
          drawVcdBody(
            canvasContext,
            context.ball,
            context.game.time,
            vcdDefinition.color
          );
          return true;
        },
        drawAfter(context, canvasContext) {
          const label = context.game.time <= osdUntil + EPSILON
            ? osdLabel
            : "VCD PLAYBACK";
          drawPlaybackOsd(canvasContext, context.game, label);
        }
      };
    }
  };

  registerBall(vcdDefinition);
  return { vcdDefinition };
});
