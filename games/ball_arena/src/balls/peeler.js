(function initializePeelerBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("./peeler-visuals.js"))
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createPeelerPlugin({ resolveArenaGeometry, registerBall, peelerDrawKnife, peelerDrawShell, peelerCreatePeelEffect,
  peelerShellFormation, peelerShellBreak
}) {
  const RULES = Object.freeze({ shellHp: 5, strokeDuration: 0.36 });
  // Presentation only: how close an enemy surface must be before the knife is raised.
  const READY_DISTANCE = 36;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function giveShellHealth(ball) {
    let hp = clamp(ball.hp, 0, RULES.shellHp);
    // Form changes and attached healing must not restore the original's HP pool.
    // Keep this rule local to the peeled combatant, including writes from effects.
    Object.defineProperties(ball, {
      maxHp: { enumerable: true, configurable: true, get() { return RULES.shellHp; }, set() {} },
      hp: {
        enumerable: true, configurable: true,
        get() { return hp; },
        set(value) { hp = clamp(value, 0, RULES.shellHp); }
      }
    });
  }

  function drawOutsideShell(context, canvasContext, callback, behavior, alpha = 1) {
    const ball = context.ball;
    canvasContext.save();
    try {
      canvasContext.globalAlpha *= alpha;
      // Preserve copied weapons, but never let copied body art fill the hollow core.
      canvasContext.beginPath();
      canvasContext.rect(-context.game.arenaSize, -context.game.arenaSize,
        context.game.arenaSize * 3, context.game.arenaSize * 3);
      const innerRadius = Math.max(0, ball.radius - 1.2);
      canvasContext.moveTo(ball.x + innerRadius, ball.y);
      canvasContext.arc(ball.x, ball.y, innerRadius, 0, Math.PI * 2);
      canvasContext.clip("evenodd");
      callback.call(behavior, context, canvasContext);
    } finally {
      canvasContext.restore();
    }
  }

  function createPeeledDefinition(target) {
    const source = target.definition.peelerSourceDefinition || target.definition;
    const color = target.color;
    return Object.assign({}, source, {
      id: source.id,
      name: `${target.name}·皮壳`,
      description: "5血空心皮壳 / 复刻原角色技能 / 为削皮刀一方作战",
      color,
      peelerSourceDefinition: source,
      summonsCountForTeamSurvival: false,
      forcedTargetInstanceId: null,
      replayTargetInstanceId: null,
      isReplayActor: false,
      stats: { radius: target.radius, speed: source.stats.speed, maxHp: RULES.shellHp },
      createBehavior(services) {
        let shell = null;
        let spawnedAt = 0;
        let seamAngle = 0;
        function formation(game) {
          return peelerShellFormation(game.time - spawnedAt);
        }
        function belongsToShell(candidate) {
          let current = candidate;
          while (current && current.summonerInstanceId) {
            if (shell && current.summonerInstanceId === shell.instanceId) return true;
            current = services.getBall(current.summonerInstanceId);
          }
          return false;
        }
        const copiedServices = Object.freeze(Object.assign({}, services, {
          // Some summon skills query by type across the whole battle. Their copied
          // cleanup/counting must not consume the original enemy's summons.
          getSummons(id) { return services.getSummons(id).filter(belongsToShell); }
        }));
        const copied = source.createBehavior(copiedServices);
        const behavior = Object.assign({}, copied);
        behavior.onSpawn = function onSpawn(context) {
          shell = context.ball;
          spawnedAt = context.game.time;
          // The peeled strip arrives on the side facing the victim; the ring closes from there.
          seamAngle = Math.atan2(target.y - shell.y, target.x - shell.x);
          giveShellHealth(shell);
          if (typeof copied.onSpawn === "function") copied.onSpawn.call(behavior, context);
        };
        for (const hook of ["drawBefore", "drawAfter"]) {
          if (typeof copied[hook] !== "function") continue;
          behavior[hook] = function drawCopiedWeapon(context, canvasContext) {
            drawOutsideShell(context, canvasContext, copied[hook], behavior, formation(context.game));
          };
        }
        behavior.drawBody = function drawPeeledBody(context, canvasContext) {
          const ball = context.ball;
          const form = formation(context.game);
          if (typeof copied.drawBody === "function") {
            drawOutsideShell(context, canvasContext, copied.drawBody, behavior, form);
          }
          return peelerDrawShell({
            ball, color, seamAngle, formation: form,
            breakProgress: Number.isFinite(ball.diedAt) && ball.hp <= 0
              ? Math.max(1e-6, peelerShellBreak(context.game.time - ball.diedAt)) : 0
          }, canvasContext);
        };
        behavior.getHpDisplay = function getShellHpDisplay() { return null; };
        return behavior;
      }
    });
  }

  function shellSpawn(ball, target, arenaSize, heading, speed) {
    const radius = target.radius;
    const distance = radius * 2 + 2;
    const normalX = -Math.sin(heading);
    const normalY = Math.cos(heading);
    let best = null;
    let bestClearance = -Infinity;
    for (const sign of [1, -1]) {
      const { x, y } = resolveArenaGeometry(arenaSize).clampPoint(target.x + normalX * distance * sign,
        target.y + normalY * distance * sign, radius);
      const clearance = Math.min(
        Math.hypot(x - target.x, y - target.y) - radius - target.radius,
        Math.hypot(x - ball.x, y - ball.y) - radius - ball.radius
      );
      if (clearance <= bestClearance) continue;
      best = { x, y };
      bestClearance = clearance;
    }
    const dx = target.x - best.x;
    const dy = target.y - best.y;
    const length = Math.hypot(dx, dy);
    const vx = length > EPSILON ? dx / length * speed : Math.cos(heading) * speed;
    const vy = length > EPSILON ? dy / length * speed : Math.sin(heading) * speed;
    return { x: best.x, y: best.y, vx, vy };
  }

  const peelerDefinition = {
    id: "peeler",
    name: "削皮刀",
    englishName: "Peeler",
    color: "#b49580",
    description: "接触削皮 / 剥出5血空心敌方复制体，复刻技能并倒戈作战",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let heading = 0;
      let strokeElapsed = RULES.strokeDuration;
      let peelCount = 0;
      // Presentation state: the drawn aim turns smoothly and the knife rises as enemies close in.
      let aim = 0;
      let readiness = 0;
      let strikeReadiness = 0;
      let clock = 0;
      return {
        update({ ball }, dt) {
          const step = Math.max(0, dt);
          clock += step;
          strokeElapsed = Math.min(RULES.strokeDuration, strokeElapsed + step);
          const striking = strokeElapsed < RULES.strokeDuration;
          let readyGoal = 0;
          if (!striking) {
            const target = services.getOpponent();
            if (target) {
              heading = Math.atan2(target.y - ball.y, target.x - ball.x);
              const gap = Math.hypot(target.x - ball.x, target.y - ball.y) - ball.radius - target.radius;
              readyGoal = clamp(1 - gap / READY_DISTANCE, 0, 1);
            }
          }
          readiness += (readyGoal - readiness) * Math.min(1, step * (striking ? 6 : 10));
          const turn = Math.atan2(Math.sin(heading - aim), Math.cos(heading - aim));
          aim += turn * Math.min(1, step * 14);
        },
        onCollision(context, target) {
          if (context.blockedAtContact || !target || target.hp <= 0) return;
          const { ball, game } = context;
          heading = Math.atan2(target.y - ball.y, target.x - ball.x);
          const definition = createPeeledDefinition(target);
          const shell = services.spawnSummon(definition,
            shellSpawn(ball, target, game, heading, definition.stats.speed));
          if (!shell) return;
          strokeElapsed = 0;
          strikeReadiness = readiness;
          aim = heading;
          peelCount += 1;
          services.spawnVisualEffect(peelerCreatePeelEffect(target, shell, heading));
          services.playSound("shoot");
        },
        drawAfter({ ball }, canvasContext) {
          peelerDrawKnife({
            ball, heading: aim, readiness, strikeReadiness, clock,
            strokeProgress: strokeElapsed < RULES.strokeDuration
              ? strokeElapsed / RULES.strokeDuration : null
          }, canvasContext);
        },
        drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
        getAttackCycleDuration() { return 5; },
        onBorrowEnd() { strokeElapsed = RULES.strokeDuration; readiness = 0; },
        getPeelerState() { return { heading, strokeElapsed, peelCount, aim, readiness }; }
      };
    }
  };

  registerBall(peelerDefinition);
  return { peelerDefinition, PEELER_RULES: RULES, peelerCreatePeeledDefinition: createPeeledDefinition };
});
