(function initializeSteelworks(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("./steel-coil.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSteelworksPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, steelCoilDefinition, drawSteelCoilBody } = dependencies;

  const TWO_PI = Math.PI * 2;
  const EPSILON = 1e-9;
  const PRODUCTION_INTERVAL = 2;
  const WINDUP = 0.4;
  const COOLING_DURATION = 2;
  const MINI_RADIUS = 10;
  const MINI_HP = 2;
  const MINI_CRUSH_DAMAGE = 15;

  function smooth(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function angleDelta(from, to) {
    return Math.atan2(Math.sin(to - from), Math.cos(to - from));
  }

  // Shared particles keep steam independent of combat, with buoyancy rather than gravity.
  function emitCoolingSteam(services, x, y, count) {
    services.spawnParticleBurst({
      kind: "steelworks-cooling-steam",
      x, y, count,
      colors: ["rgba(237,245,249,0.40)", "rgba(187,204,212,0.32)", "rgba(255,255,255,0.28)"],
      minDiameter: 3.5, maxDiameter: 10,
      initialRadius: 7,
      directionAngle: -Math.PI / 2, directionSpread: 0.95,
      minSpeed: 13, maxSpeed: 32,
      gravityY: -24, drag: 0.7, life: 0.9
    });
  }

  function createSteelworksCoilDefinition() {
    return {
      id: "steelworks-coil",
      name: "小钢卷",
      englishName: "Small Steel Coil",
      color: steelCoilDefinition.color,
      description: "2 血小钢卷 / 出生后冷却 2 秒期间无敌 / 连环撞击造成 15 点压扁伤害",
      stats: { radius: MINI_RADIUS, speed: steelCoilDefinition.stats.speed, maxHp: MINI_HP },
      createBehavior(services) {
        const coil = steelCoilDefinition.createBehavior(services, { crushDamage: MINI_CRUSH_DAMAGE });
        let bornAt = null;
        let nextSteamAt = 0;
        return Object.assign({}, coil, {
          onSpawn(context) {
            coil.onSpawn(context);
            bornAt = context.game.time;
            nextSteamAt = bornAt + 0.1;
          },
          onBeforeDamage(context, event) {
            if (bornAt === null || context.game.time - bornAt < COOLING_DURATION - EPSILON) {
              return { amount: 0, showHitText: false, cancelAttack: true };
            }
            return coil.onBeforeDamage(context, event);
          },
          afterUpdateStep(context) {
            coil.afterUpdateStep(context);
            const now = context.game.time;
            if (now - bornAt < COOLING_DURATION && now + EPSILON >= nextSteamAt) {
              nextSteamAt = now + 0.1;
              emitCoolingSteam(services, context.ball.x, context.ball.y - context.ball.radius * 0.4, 5);
            }
          },
          drawAfter({ ball, game }, context) {
            if (bornAt === null) return;
            const heat = 1 - Math.min(1, (game.time - bornAt) / COOLING_DURATION);
            if (heat <= 0) return;
            context.save();
            context.globalAlpha *= heat * 0.65;
            context.strokeStyle = "#ffb56a";
            context.lineWidth = 1.6;
            context.beginPath();
            context.arc(ball.x, ball.y, ball.radius - 1, 0, TWO_PI);
            context.stroke();
            context.restore();
          }
        });
      }
    };
  }

  function drawFurnaceBody(context, ball, time, heat) {
    const radius = ball.radius;
    const pulse = 0.5 + Math.sin(time * 7) * 0.22 + Math.sin(time * 13) * 0.12;
    context.save();
    context.translate(ball.x, ball.y);
    context.scale(radius / 15, radius / 15);

    // Short exhaust stack and a riveted, spherical iron jacket.
    context.fillStyle = "#252c31";
    context.fillRect(-7, -20, 7, 11);
    context.fillStyle = "#76848a";
    context.fillRect(-8, -21, 9, 2);
    context.fillStyle = "#414c54";
    context.fillRect(-6, -18, 2, 7);
    const shell = context.createLinearGradient(-13, -13, 13, 13);
    shell.addColorStop(0, "#849097");
    shell.addColorStop(0.28, "#505d65");
    shell.addColorStop(0.65, "#303940");
    shell.addColorStop(1, "#171e23");
    context.fillStyle = shell;
    context.strokeStyle = "#161b20";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(0, 0, 15, 0, TWO_PI);
    context.fill();
    context.stroke();
    context.strokeStyle = "#99a3a5";
    context.lineWidth = 0.7;
    context.beginPath();
    context.arc(0, 0, 12.5, Math.PI * 0.98, Math.PI * 1.93);
    context.stroke();

    // Recessed lower firebox, animated tongues of molten light behind its grate.
    context.fillStyle = "#14191c";
    context.beginPath();
    context.moveTo(-10, 2);
    context.quadraticCurveTo(0, -2, 10, 2);
    context.lineTo(8, 10);
    context.quadraticCurveTo(0, 15, -8, 10);
    context.closePath();
    context.fill();
    context.save();
    context.clip();
    context.fillStyle = "#6b2118";
    context.fillRect(-10, 1, 20, 13);
    for (let index = 0; index < 5; index += 1) {
      const x = -8 + index * 4;
      const height = 5 + 2 * Math.sin(time * 9 + index * 1.9) + heat * 2;
      context.fillStyle = index % 2 ? "#ffbe55" : "#ef6b28";
      context.beginPath();
      context.moveTo(x - 2.5, 13);
      context.quadraticCurveTo(x - 3, 8, x + Math.sin(time * 8 + index), 12 - height);
      context.quadraticCurveTo(x + 1, 8, x + 3, 13);
      context.fill();
    }
    context.fillStyle = "rgba(255,229,154," + (0.13 + pulse * 0.13 + heat * 0.15) + ")";
    context.fillRect(-10, 2, 20, 11);
    context.strokeStyle = "#322f2b";
    context.lineWidth = 1.2;
    for (let x = -6; x <= 6; x += 4) {
      context.beginPath();
      context.moveTo(x, 1);
      context.lineTo(x, 14);
      context.stroke();
    }
    context.restore();

    // Upper plate leaves a quiet backing for the engine's normal HP text.
    context.fillStyle = "#353f45";
    context.fillRect(-9, -5, 18, 7);
    context.strokeStyle = "#879298";
    context.lineWidth = 0.65;
    context.beginPath();
    context.moveTo(-9, -5);
    context.lineTo(9, -5);
    context.stroke();
    for (let index = 0; index < 6; index += 1) {
      const angle = index * TWO_PI / 6 + Math.PI / 6;
      const x = Math.cos(angle) * 12.9;
      const y = Math.sin(angle) * 12.9;
      context.fillStyle = "#1c2429";
      context.beginPath();
      context.arc(x, y, 1.15, 0, TWO_PI);
      context.fill();
      context.fillStyle = "#a2a9a8";
      context.beginPath();
      context.arc(x - 0.25, y - 0.3, 0.6, 0, TWO_PI);
      context.fill();
    }
    context.restore();
  }

  const steelworksDefinition = {
    id: "steelworks",
    name: "炼钢厂",
    englishName: "Steelworks",
    color: "#59636b",
    description: "每 2 秒向随机方向产出 2 血小钢卷 / 直径 20 / 连环撞击压扁 15 伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: PRODUCTION_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      let aimed = false;
      let produced = false;
      let fromAngle = 0;
      let launchAngle = 0;
      let lastProducedAt = -Infinity;
      let nextExhaustAt = 0;

      function launchDirection(ball, arenaSize) {
        let x = Math.cos(launchAngle);
        let y = Math.sin(launchAngle);
        const offset = ball.radius + MINI_RADIUS + 1;
        const arena = resolveArenaGeometry(arenaSize);
        const hit = arena.traceSegment(ball.x, ball.y, ball.x + x * offset, ball.y + y * offset, MINI_RADIUS);
        if (hit) { const dot = x * hit.normalX + y * hit.normalY; x -= 2 * dot * hit.normalX; y -= 2 * dot * hit.normalY; }
        return { x, y };
      }

      function portAngle(context) {
        if (!aimed) return launchAngle;
        const direction = context ? launchDirection(context.ball, context.game) : null;
        const targetAngle = direction ? Math.atan2(direction.y, direction.x) : launchAngle;
        return fromAngle + angleDelta(fromAngle, targetAngle) *
          smooth((timer - (PRODUCTION_INTERVAL - WINDUP)) / WINDUP);
      }

      function produce({ ball, game }) {
        const direction = launchDirection(ball, game);
        const dx = direction.x;
        const dy = direction.y;
        const offset = ball.radius + MINI_RADIUS + 1;
        // Aim back into the arena near a wall; never spawn a coil inside the furnace.
        launchAngle = Math.atan2(dy, dx);
        const coil = services.spawnSummon(createSteelworksCoilDefinition(), {
          ...resolveArenaGeometry(game).clampPoint(ball.x + dx * offset, ball.y + dy * offset, MINI_RADIUS),
          vx: dx * steelCoilDefinition.stats.speed,
          vy: dy * steelCoilDefinition.stats.speed
        });
        if (!coil) return;
        lastProducedAt = game.time;
        produced = true;
        emitCoolingSteam(services, coil.x, coil.y, 18);
        services.spawnParticleBurst({
          kind: "steelworks-tapping-sparks",
          x: ball.x + dx * ball.radius, y: ball.y + dy * ball.radius,
          count: 7, colors: ["#ffb04d", "#ffe2a1", "#e87537"],
          minDiameter: 0.6, maxDiameter: 1.5,
          minSpeed: 22, maxSpeed: 62,
          directionAngle: launchAngle, directionSpread: 0.6,
          gravityY: 25, life: 0.28, drag: 1.5
        });
      }

      function emitExhaust({ ball, game }) {
        if (game.time + EPSILON < nextExhaustAt) return;
        nextExhaustAt = game.time + 0.18;
        services.spawnParticleBurst({
          kind: "steelworks-furnace-exhaust",
          x: ball.x - ball.radius * 0.23, y: ball.y - ball.radius * 1.4,
          count: 2,
          colors: ["rgba(160,173,180,0.28)", "rgba(205,214,216,0.20)"],
          minDiameter: 3, maxDiameter: 6, initialRadius: 1,
          directionAngle: -Math.PI / 2, directionSpread: 0.5,
          minSpeed: 9, maxSpeed: 17, gravityY: -9, drag: 0.5, life: 0.75
        }, { drawLayer: "background" });
      }

      return {
        update(context, dt) {
          timer += Math.max(0, dt);
          if (!aimed && timer + EPSILON >= PRODUCTION_INTERVAL - WINDUP) {
            fromAngle = launchAngle;
            launchAngle = Math.random() * TWO_PI;
            aimed = true;
          }
          if (timer + EPSILON >= PRODUCTION_INTERVAL) {
            produce(context);
            timer = Math.max(0, timer - PRODUCTION_INTERVAL);
            aimed = false;
          }
        },
        afterUpdateStep: emitExhaust,
        afterUpdateStepWhilePaused: emitExhaust,
        getNextTransitionIn() {
          return Math.max(EPSILON, (aimed ? PRODUCTION_INTERVAL : PRODUCTION_INTERVAL - WINDUP) - timer);
        },
        isAttackCycleComplete() { return produced; },
        drawBefore({ ball, game }, context) {
          const pulse = 0.5 + Math.sin(game.time * 7) * 0.15;
          context.save();
          context.fillStyle = "rgba(255,113,34," + (0.055 + pulse * 0.035) + ")";
          context.beginPath();
          context.arc(ball.x, ball.y + ball.radius * 0.25, ball.radius * 1.22, 0, TWO_PI);
          context.fill();
          context.restore();
        },
        drawBody({ ball, game }, context) {
          drawFurnaceBody(context, ball, game.time, smooth((timer - (PRODUCTION_INTERVAL - WINDUP)) / WINDUP));
          return true;
        },
        drawAfter({ ball, game }, context) {
          const windup = aimed ? smooth((timer - (PRODUCTION_INTERVAL - WINDUP)) / WINDUP) : 0;
          const recovery = 1 - smooth((game.time - lastProducedAt) / 0.35);
          const opening = Math.max(windup, recovery);
          const angle = portAngle({ ball, game });
          context.save();
          context.translate(ball.x, ball.y);
          context.rotate(angle);
          const reach = ball.radius - 2 + opening * 3;
          context.fillStyle = "#20282d";
          context.fillRect(ball.radius - 5, -5, reach - ball.radius + 8, 10);
          context.fillStyle = "#ff9b38";
          context.globalAlpha *= 0.4 + opening * 0.6;
          context.fillRect(reach, -3.5, 2, 7);
          context.restore();
          context.save();
          context.translate(ball.x, ball.y);
          context.rotate(angle);
          context.fillStyle = "#65727a";
          context.strokeStyle = "#1b2226";
          context.lineWidth = 0.7;
          for (const side of [-1, 1]) {
            const y = side < 0 ? -5 - opening * 10 : opening * 10;
            context.fillRect(reach, y, 3, 5);
            context.strokeRect(reach, y, 3, 5);
          }
          // The glowing billet emerges continuously into the exact spawn position.
          // It is cosmetic while inside the furnace; production creates the live coil.
          if (aimed && timer > PRODUCTION_INTERVAL - 0.16) {
            const progress = smooth((timer - (PRODUCTION_INTERVAL - 0.16)) / 0.16);
            const x = ball.radius + (MINI_RADIUS + 1) * progress;
            const radius = MINI_RADIUS * (0.3 + 0.7 * progress);
            context.globalAlpha *= progress;
            drawSteelCoilBody(context, { x, y: 0, radius }, game.time);
            context.fillStyle = "rgba(255,151,62,0.45)";
            context.beginPath();
            context.arc(x, 0, radius, 0, TWO_PI);
            context.fill();
          }
          context.restore();
        },
        getSteelworksState() {
          return { nextProductionIn: Math.max(0, PRODUCTION_INTERVAL - timer), launchAngle: portAngle(), produced };
        }
      };
    }
  };

  registerBall(steelworksDefinition);
  return { steelworksDefinition, createSteelworksCoilDefinition };
});
