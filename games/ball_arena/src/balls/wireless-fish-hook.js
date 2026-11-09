(function initializeWirelessFishHook(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("./fish-hook.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createWirelessFishHookPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, fishHookDrawTip, FISH_HOOK_REEL_DAMAGE_DISTANCE, FISH_HOOK_REEL_DAMAGE } = dependencies;
  const RULES = Object.freeze({ reach: 0, reelSpeed: 150, damage: FISH_HOOK_REEL_DAMAGE,
    damageDistance: FISH_HOOK_REEL_DAMAGE_DISTANCE,
    releaseAngle: 85 * Math.PI / 180, turnSpeed: Math.PI * 2 });
  const angleDifference = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const heading = (ball, fallback = 0) => Math.hypot(ball.vx, ball.vy) > 1e-6
    ? Math.atan2(ball.vy, ball.vx) : fallback;

  const wirelessFishHookDefinition = {
    id: "wirelessFishHook", name: "无线鱼钩", englishName: "Wireless Fish Hook",
    color: "#dce1e6", rosterType: "zako",
    description: "贴身后置无线鱼钩 / 收线速度150，每30距离-2 / 碰撞急转85°脱钩",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let hook = null;
      let body = null;
      let previousHeading = 0;
      let held = null;
      let released = null;

      function release() {
        const record = held;
        held = null;
        if (!record) return;
        released = record.target;
        services.clearEffect(record.target, record.id);
      }
      function cleanup() {
        release();
        if (hook) hook.entityActive = false;
        hook = null;
        released = null;
      }
      function capture(target, entityServices) {
        const record = { target, id: `wireless-hook-${hook.instanceId}`,
          remainingDistance: RULES.damageDistance };
        const effect = entityServices.applyEffect(target, {
          id: record.id, duration: Number.MAX_SAFE_INTEGER,
          locksMovement: true, pausesBehavior: true, preventsAttack: true, blocksDamageOutput: true,
          getContactProfile() { return { solid: false }; },
          onApply({ ball, effect }) {
            effect.savedVx = ball.storedVx;
            effect.savedVy = ball.storedVy;
            ball.vx = ball.vy = 0;
          },
          update({ ball, services: effectServices }) {
            if (!hook || hook.entityActive === false || !body || body.hp <= 0 ||
                body.active === false || held !== record) {
              effectServices.clearEffect(ball, record.id);
              return;
            }
            ball.vx = ball.vy = 0;
          },
          onExpire({ ball, effect }) {
            if (held === record) { held = null; released = ball; }
            ball.vx = ball.storedVx = effect.savedVx;
            ball.vy = ball.storedVy = effect.savedVy;
          }
        });
        if (effect) held = record;
      }
      function spawn(ball) {
        body = ball;
        previousHeading = heading(ball);
        const angle = previousHeading + Math.PI;
        hook = services.spawnCombatEntity({
          kind: "wireless-fish-hook", life: Number.MAX_SAFE_INTEGER,
          lifecycle: "owner-bound", attachedToOwner: true,
          radius: 7, angle,
          x: ball.x + Math.cos(angle) * (ball.radius + RULES.reach),
          y: ball.y + Math.sin(angle) * (ball.radius + RULES.reach),
          update({ entity, game, services: entityServices }, dt) {
            const capabilities = entityServices.getCapabilities(body);
            if (!capabilities.canAct || !capabilities.canDealDamage) { release(); return; }
            const beforeX = entity.x, beforeY = entity.y;
            const desired = heading(body, previousHeading) + Math.PI;
            const delta = angleDifference(desired, entity.angle);
            entity.angle += Math.max(-RULES.turnSpeed * dt, Math.min(RULES.turnSpeed * dt, delta));
            entity.x = body.x + Math.cos(entity.angle) * (body.radius + RULES.reach);
            entity.y = body.y + Math.sin(entity.angle) * (body.radius + RULES.reach);
            if (released && (released.hp <= 0 ||
                Math.hypot(released.x - entity.x, released.y - entity.y) > released.radius + entity.radius + 0.5)) released = null;
            if (held && (held.target.hp <= 0 || held.target.active === false ||
                !held.target.effects.has(held.id))) release();
            if (!held) {
              const target = entityServices.getFirstEnemyHit(beforeX, beforeY, entity.x, entity.y, entity.radius);
              if (target && target !== released) capture(target, entityServices);
            }
            if (!held) return;
            const target = held.target;
            // 钩挂位置固定在钩子的外侧：两球相切，不保留入钩偏移。
            // 随平滑转向后的钩子一起移动；收线速度只负责累计收线行程。
            const attachmentDistance = body.radius + RULES.reach + target.radius;
            Object.assign(target, resolveArenaGeometry(game).clampPoint(body.x + Math.cos(entity.angle) * attachmentDistance,
              body.y + Math.sin(entity.angle) * attachmentDistance, target.radius));
            target.prevX = target.x;
            target.prevY = target.y;
            // 本体同时放钩，钩子与本体的间距不缩短；累计的是实际收线行程。
            held.remainingDistance -= RULES.reelSpeed * dt;
            while (held && held.remainingDistance <= 1e-9) {
              held.remainingDistance += RULES.damageDistance;
              entityServices.dealDamage(target, RULES.damage);
              if (target.hp <= 0) release();
            }
          },
          draw({ entity }, context) {
            fishHookDrawTip({ x: entity.x, y: entity.y,
              vx: Math.cos(entity.angle), vy: Math.sin(entity.angle) }, context);
          }
        });
      }
      function checkTurn() {
        const next = heading(body, previousHeading);
        if (Math.abs(angleDifference(next, previousHeading)) >= RULES.releaseAngle - 1e-9) release();
        previousHeading = next;
      }
      return {
        onSpawn({ ball }) { spawn(ball); },
        update({ ball }) {
          if (!hook || hook.entityActive === false) { cleanup(); spawn(ball); }
          checkTurn();
        },
        onWallBounce() { checkTurn(); },
        onCollision() { checkTurn(); },
        onEntityCollision() { checkTurn(); },
        afterUpdateStep() { checkTurn(); },
        onAttackTransfer({ ball }) { cleanup(); spawn(ball); },
        onDeath: cleanup, onBorrowEnd: cleanup, onAbilitySealed: cleanup,
        onBattleEnd: cleanup, onBattleDispose: cleanup,
        getWirelessHookState() { return { hook, target: held ? held.target : null }; }
      };
    }
  };
  registerBall(wirelessFishHookDefinition);
  return { wirelessFishHookDefinition, WIRELESS_HOOK_RULES: RULES };
});
