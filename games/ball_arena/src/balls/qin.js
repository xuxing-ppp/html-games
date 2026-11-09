(function initializeQin(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
      ...require("../core/ball-registry.js"),
      ...require("./fear-wave.js")
    }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createQinPlugin({ getArenaWallContacts, registerBall, createFearWave }) {
  const LINE_WIDTH = 2;
  const GUZHENG_BODY_COLOR = "#6b4226";
  const GUZHENG_STRING_COLOR = "#c9372c";
  const GUZHENG_STRING_GLOW = "#f16b5f";
  const QIN_BODY_COLOR = "#8f5b63";
  const QIN_STRING_COLOR = "#f0c978";
  const QIN_STRING_GLOW = "#ffe7a3";
  const PLUCK_DURATION = 0.3;
  const QIN_VIBRATION_DURATION = 0.1;
  const QIN_STRING_DAMAGE = 3;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;

  function crossProduct(ax, ay, bx, by) {
    return ax * by - ay * bx;
  }

  function crossesLine(target, line) {
    const pathX = target.x - target.prevX;
    const pathY = target.y - target.prevY;
    const lineX = line.end.x - line.start.x;
    const lineY = line.end.y - line.start.y;
    const denominator = crossProduct(pathX, pathY, lineX, lineY);
    if (Math.abs(denominator) <= EPSILON) return false;
    const offsetX = line.start.x - target.prevX;
    const offsetY = line.start.y - target.prevY;
    const pathProgress = crossProduct(offsetX, offsetY, lineX, lineY) / denominator;
    const lineProgress = crossProduct(offsetX, offsetY, pathX, pathY) / denominator;
    return pathProgress > EPSILON && pathProgress <= 1 + EPSILON &&
      lineProgress >= -EPSILON && lineProgress <= 1 + EPSILON;
  }

  function wallPoint(context) {
    const { x, y } = getArenaWallContacts(context)[0];
    return { x, y };
  }

  function drawPluckedString(
    canvasContext,
    line,
    time,
    stringColor,
    stringGlow,
    duration = PLUCK_DURATION
  ) {
    const dx = line.end.x - line.start.x;
    const dy = line.end.y - line.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const pluckProgress = line.pluckStartedAt === null
      ? 1
      : (time - line.pluckStartedAt) / duration;
    const active = pluckProgress >= 0 && pluckProgress < 1;
    const envelope = active ? Math.sin(Math.PI * pluckProgress) : 0;
    const amplitude = envelope * 8;
    const pluckPosition = Number.isFinite(line.pluckPosition)
      ? line.pluckPosition
      : 0.5;

    // A soft under-glow, bright core, and a traveling harmonic make the
    // string read as a taut instrument string instead of a static laser.
    canvasContext.save();
    canvasContext.globalAlpha *= active ? 0.3 + envelope * 0.34 : 0.22;
    canvasContext.strokeStyle = stringGlow;
    canvasContext.shadowColor = stringGlow;
    canvasContext.shadowBlur = active ? 10 : 3;
    canvasContext.lineWidth = active ? 6 : 3.5;
    canvasContext.beginPath();
    canvasContext.moveTo(line.start.x, line.start.y);
    canvasContext.lineTo(line.end.x, line.end.y);
    canvasContext.stroke();
    canvasContext.restore();

    canvasContext.save();
    canvasContext.globalAlpha *= active ? 0.88 + envelope * 0.12 : 0.88;
    canvasContext.strokeStyle = stringColor;
    canvasContext.shadowColor = stringGlow;
    canvasContext.shadowBlur = active ? 5 : 1.5;
    canvasContext.lineWidth = LINE_WIDTH;
    canvasContext.beginPath();
    const segments = active ? 28 : 2;
    for (let index = 0; index <= segments; index += 1) {
      const progress = index / segments;
      const distanceFromPluck = progress - pluckPosition;
      const localEnvelope = Math.exp(-Math.abs(distanceFromPluck) * 8);
      const standingWave = Math.sin(progress * Math.PI * 2) * amplitude * 0.35;
      const travelingWave = active
        ? Math.sin(distanceFromPluck * Math.PI * 10 - pluckProgress * Math.PI * 8) *
          amplitude * localEnvelope
        : 0;
      const offset = standingWave + travelingWave;
      const x = line.start.x + dx * progress + nx * offset;
      const y = line.start.y + dy * progress + ny * offset;
      if (index === 0) canvasContext.moveTo(x, y);
      else canvasContext.lineTo(x, y);
    }
    canvasContext.stroke();

    if (active) {
      const pulseX = line.start.x + dx * pluckPosition;
      const pulseY = line.start.y + dy * pluckPosition;
      canvasContext.globalAlpha *= 0.8 * envelope;
      canvasContext.fillStyle = "#fff4c4";
      canvasContext.shadowColor = stringGlow;
      canvasContext.shadowBlur = 8;
      canvasContext.beginPath();
      canvasContext.arc(pulseX, pulseY, 2.2 + envelope * 2.5, 0, Math.PI * 2);
      canvasContext.fill();
    }
    canvasContext.restore();
  }

  function createStringEntity(services, start, end, growing, colors) {
    return services.spawnCombatEntity({
      kind: "qin-string",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      drawLayer: "background",
      start,
      end,
      growing,
      // Match Laser V2's endpoint-only destruction contract. A growing string
      // exposes only its wall anchor; a frozen string exposes both endpoints.
      shieldBreakPoints: growing ? [start] : [start, end],
      shieldBreakRadius: 1,
      pluckedUntil: -Infinity,
      pluckStartedAt: null,
      pluckPosition: 0.5,
      armedAt: services.getTime ? services.getTime() : 0,
      update({ entity, game, services: stringServices }) {
        const owner = entity.owner;
        if (game.state !== "running") {
          // Victory and defeat fades are presentation-only; stop all Qin
          // waves once the battle has ended, even when Qin is the winner.
          game.combatEntities.forEach((other) => {
            if (
              other.kind === "qin-sonic-wave" &&
              other.ownerInstanceId === entity.ownerInstanceId
            ) {
              other.entityActive = false;
            }
          });
          return;
        }
        // Completed strings remain as scenery after defeat, but a dead Qin
        // can no longer pluck them during the loser fade. This also prevents
        // the death-frame position jump from spawning a burst of waves.
        if (!owner || owner.hp <= 0 || owner.prevX === undefined) return;
        if (entity.growing) {
          // The end is a live reference to the owner while the current string
          // is being laid. It becomes frozen on the next wall bounce.
          return;
        }
        // Only the Qin body can play a string. Enemy centers crossing it are
        // deliberately ignored and never receive contact damage.
        // Do not interpret the movement that created a new string as a
        // separate pluck. Entity-system spawns normally defer this naturally;
        // the timestamp guard also keeps direct hook calls deterministic.
        if (game.time <= entity.armedAt + EPSILON) return;
        if (crossesLine(owner, entity)) {
          const lineX = entity.end.x - entity.start.x;
          const lineY = entity.end.y - entity.start.y;
          const lengthSquared = lineX * lineX + lineY * lineY || 1;
          entity.pluckPosition = Math.max(0, Math.min(1,
            ((owner.x - entity.start.x) * lineX +
              (owner.y - entity.start.y) * lineY) / lengthSquared
          ));
          entity.pluckStartedAt = game.time;
          entity.pluckedUntil = game.time + PLUCK_DURATION;
          const wave = createFearWave(
            { x: owner.x, y: owner.y },
            { kind: "qin-sonic-wave" }
          );
          stringServices.spawnCombatEntity(wave);
        }
      },
      draw({ entity, game }, canvasContext) {
        drawPluckedString(
          canvasContext,
          entity,
          game.time,
          colors.stringColor,
          colors.stringGlow
        );
      }
    });
  }

  const guzhengDefinition = {
    id: "guzheng",
    name: "\u53e4\u7b5d",
    englishName: "Guzheng",
    color: GUZHENG_BODY_COLOR,
    description: "\u5e03\u7f6e\u6731\u7ea2\u7434\u5f26 / \u672c\u4f53\u62e8\u5f26\u91ca\u653e\u58f0\u6ce2",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let firstPoint = null;
      let firstLineEntity = null;
      const lines = [];

      function lineGeometry(line) {
        return {
          start: { x: line.start.x, y: line.start.y },
          end: { x: line.end.x, y: line.end.y }
        };
      }

      return {
        onWallBounce(context) {
          const point = wallPoint(context);
          if (firstLineEntity && firstLineEntity.entityActive !== false) {
            if (Math.hypot(point.x - firstLineEntity.start.x, point.y - firstLineEntity.start.y) > EPSILON) {
              firstLineEntity.end = { x: point.x, y: point.y };
              firstLineEntity.growing = false;
              firstLineEntity.shieldBreakPoints = [
                firstLineEntity.start,
                firstLineEntity.end
              ];
            }
          }
          firstLineEntity = createStringEntity(
            services,
            point,
            context.ball,
            true,
            { stringColor: GUZHENG_STRING_COLOR, stringGlow: GUZHENG_STRING_GLOW }
          );
          lines.push(firstLineEntity);
        },
        getQinState() {
          const activeLines = lines.filter((line) => line.entityActive !== false);
          return {
            growing: Boolean(firstLineEntity && firstLineEntity.growing),
            lines: activeLines.map(lineGeometry)
          };
        },
        onDeath(context) {
          // A loser fade should not replay already-active instrument waves.
          // Mark only this Qin's waves inactive; the string scenery itself is
          // allowed to remain visible until the normal entity cleanup.
          context.game.combatEntities.forEach((entity) => {
            if (
              entity.kind === "qin-sonic-wave" &&
              entity.ownerInstanceId === context.ball.instanceId
            ) {
              entity.entityActive = false;
            }
          });
        },
      };
    }
  };

  function lineGeometry(line) {
    return {
      start: line.start,
      end: { x: line.end.x, y: line.end.y }
    };
  }

  function setQinVibration(lines, time, owner) {
    for (const line of lines) {
      if (!line || line.entityActive === false) continue;
      const geometry = lineGeometry(line);
      const lineX = geometry.end.x - geometry.start.x;
      const lineY = geometry.end.y - geometry.start.y;
      const lengthSquared = lineX * lineX + lineY * lineY || 1;
      line.pluckPosition = Math.max(0, Math.min(1,
        ((owner.x - geometry.start.x) * lineX +
          (owner.y - geometry.start.y) * lineY) / lengthSquared
      ));
      line.pluckStartedAt = time;
      line.pluckedUntil = time + QIN_VIBRATION_DURATION;
    }
  }

  function createQinStringEntity(services, start, end, growing, triggerVibration) {
    return services.spawnCombatEntity({
      kind: "qin-string",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: growing ? "owner-bound" : "independent",
      drawLayer: "background",
      start,
      end,
      growing,
      shieldBreakPoints: growing ? [start] : [start, end],
      shieldBreakRadius: 1,
      pluckedUntil: -Infinity,
      pluckStartedAt: null,
      pluckPosition: 0.5,
      // 正在跨越弦的目标：跨进去时结算一次，离开后重新武装。
      hitTargets: new Set(),
      update({ entity, game, services: stringServices }) {
        const owner = entity.owner;
        if (!owner || owner.hp <= 0 || game.state !== "running") return;
        // The first wall-to-wall segment is only a live layout guide. It is
        // not a finished string until the second wall contact freezes it.
        if (entity.growing) return;
        // 本体过弦 → 全弦振动，并开启短暂的伤害窗口。
        if (owner.prevX !== undefined && crossesLine(owner, lineGeometry(entity))) {
          triggerVibration(game.time);
        }
        if (entity.pluckStartedAt === null || game.time < entity.pluckStartedAt ||
          game.time >= entity.pluckedUntil) {
          entity.hitTargets.clear();
          return;
        }
        const seen = new Set();
        stringServices.forEachEnemy((target) => {
          const profile = stringServices.getContactProfile(target);
          if (!profile.attackable) return;
          const key = target.instanceId || target.id;
          seen.add(key);
          if (!crossesLine(target, lineGeometry(entity))) {
            // 这一侧没有跨越发生 → 重新武装，下一次穿线会再结算一次。
            entity.hitTargets.delete(key);
            return;
          }
          // 同一次跨越只结算一次：引擎每个 substep 都会刷新 prev 位置，
          // 这里再兜一道，位移没变就不会重复扣血。
          if (entity.hitTargets.has(key)) return;
          if (stringServices.dealDamage(target, QIN_STRING_DAMAGE)) {
            entity.hitTargets.add(key);
          }
        });
        for (const key of entity.hitTargets) {
          if (!seen.has(key)) entity.hitTargets.delete(key);
        }
      },
      draw({ entity, game }, canvasContext) {
        drawPluckedString(
          canvasContext,
          entity,
          game.time,
          QIN_STRING_COLOR,
          QIN_STRING_GLOW,
          QIN_VIBRATION_DURATION
        );
      }
    });
  }

  const qinDefinition = {
    id: "qin",
    name: "\u7434",
    englishName: "Qin",
    color: QIN_BODY_COLOR,
    description: "\u6fc0\u5149V2\u5f0f\u5e03\u7ebf / \u9707\u52a8\u65f6\u8de8\u7ebf -3 / \u672c\u4f53\u8fc7\u5f26\u5168\u5f26\u9707\u52a8",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 4,
    createBehavior(services) {
      let firstPoint = null;
      let firstLineEntity = null;
      let currentOwner = null;
      let lastVibrationAt = -Infinity;
      const lines = [];

      function pruneLines() {
        while (lines.length > 0 && lines[0].entityActive === false) lines.shift();
      }

      function triggerVibration(time) {
        if (Math.abs(time - lastVibrationAt) <= EPSILON || !currentOwner) return;
        lastVibrationAt = time;
        setQinVibration(lines, time, currentOwner);
      }

      return {
        onSpawn(context) {
          currentOwner = context.ball;
        },
        onWallBounce(context) {
          currentOwner = context.ball;
          const point = wallPoint(context);
          pruneLines();
          if (firstLineEntity && firstLineEntity.entityActive === false) {
            firstPoint = null;
            firstLineEntity = null;
          }
          if (!firstPoint) {
            firstPoint = point;
            firstLineEntity = createQinStringEntity(
              services,
              point,
              context.ball,
              true,
              triggerVibration
            );
            const pendingLine = firstLineEntity;
            pendingLine.onShieldDestroyed = () => {
              if (firstLineEntity !== pendingLine) return;
              firstPoint = null;
              firstLineEntity = null;
            };
            lines.push(firstLineEntity);
            return;
          }
          if (Math.hypot(point.x - firstPoint.x, point.y - firstPoint.y) <= EPSILON) return;
          firstLineEntity.entityActive = false;
          const finishedLine = createQinStringEntity(
            services,
            { x: firstPoint.x, y: firstPoint.y },
            { x: point.x, y: point.y },
            false,
            triggerVibration
          );
          lines.push(finishedLine);
          firstPoint = null;
          firstLineEntity = null;
        },
        getQinState() {
          pruneLines();
          return {
            firstPoint,
            lines: lines.filter((line) => line.entityActive !== false).map(lineGeometry)
          };
        },
      };
    }
  };

  registerBall(guzhengDefinition);
  registerBall(qinDefinition);
  return { guzhengDefinition, qinDefinition };
});
