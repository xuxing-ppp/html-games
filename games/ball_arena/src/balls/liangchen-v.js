(function initializeLiangchenV(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js"),
        ...require("./liangchen-iii.js")
      }
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenVPlugin(dependencies) {
  "use strict";
  const { registerBall, applyDamageReduction, createBloodDroplet } = dependencies;

  const RULES = Object.freeze({
    bodyDamage: 2,               // 唯一出伤方式：碰撞 2 点（没有冲刺）
    // 三段血域梯度（以自身为圆心）
    holdRadius: 75,              // ≤75：被控，无法行动
    slowNearRadius: 150,         // 75~150：行动速度 10% → 攻击周期 ×10
    slowNearPeriodScale: 10,
    slowFarPeriodScale: 4,       // >150：行动速度 25% → 攻击周期 ×4
    recoverySurvivalFactor: 0.9, // 血滴触发恢复时，自身受伤率 ×90%（同大运V5 的指数受伤率口径）
    holdEffectId: "liangchen-ve-blood-hold",
    slowNearEffectId: "liangchen-ve-blood-slow-near",
    slowFarEffectId: "liangchen-ve-blood-slow-far",
    auraRefreshLead: 0.12,       // 每帧刷新；良辰V·E 死后自然过期
    dropletSpeed: 300,
    dropletPassHeal: 1,
    // "寿命无限"：引擎要求 life 是有限正数，取一个远超对局时长的值
    dropletLife: 9999
  });
  const TWO_PI = Math.PI * 2;

  // ---- 血域：范围内控住 ----
  function createBloodHold() {
    return {
      id: RULES.holdEffectId,
      duration: RULES.auraRefreshLead,
      // 走引擎的「倍率 0」通道停住它，解控时引擎按记录的朝向恢复原速。
      // 刻意不写 locksMovement —— 引擎会为带 locksMovement 的球跳过速度归一化，
      // 那样被控住的球反而保持原速继续飞（liquid-nitrogen 的冻结效果里记着同一个坑）。
      speedFactor: 0,
      pausesBehavior: true,
      preventsAttack: true,
      visualType: "stun"
    };
  }

  // ---- 血域：中段迟缓（只拉长攻击周期，仍可行动）----
  function createBloodSlow(periodScale) {
    return {
      id: periodScale === RULES.slowNearPeriodScale
        ? RULES.slowNearEffectId
        : RULES.slowFarEffectId,
      duration: RULES.auraRefreshLead,
      attackPeriodScale: periodScale,
      visualType: null
    };
  }

  const liangchenVEDefinition = {
    id: "liangchenVE",
    name: "良辰V·E",
    englishName: "Liangchen V E",
    color: "#960c04",
    rosterType: "outOfSpec",
    description: "血只有 20 / 撞人只有 2 点 / 没有冲刺 / 掉的血滴穿身而过，它也不捡",
    stats: { radius: 15, speed: 150, maxHp: 20 },

    createBehavior(services) {
      let survivalFactor = 1;        // 受伤率：每次血滴触发恢复 ×0.9，越回越硬

      // 血域是按位置生效的常驻场：自己被打断时长也照样维持
      function refreshAura(context) {
        const ball = context.ball;
        const ids = {
          hold: `${RULES.holdEffectId}:${ball.instanceId}`,
          near: `${RULES.slowNearEffectId}:${ball.instanceId}`,
          far: `${RULES.slowFarEffectId}:${ball.instanceId}`
        };
        services.forEachEnemy((target) => {
          if (!target || target.hp <= 0) return;
          const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
          if (distance <= RULES.holdRadius) {
            // 内圈：强控，同时清掉两档减速
            services.applyEffect(target, { ...createBloodHold(), id: ids.hold });
            services.clearEffect(target, ids.near);
            services.clearEffect(target, ids.far);
          } else if (distance <= RULES.slowNearRadius) {
            // 中圈：10% 行动速度
            services.applyEffect(target, { ...createBloodSlow(RULES.slowNearPeriodScale), id: ids.near });
            services.clearEffect(target, ids.hold);
            services.clearEffect(target, ids.far);
          } else {
            // 外圈：25% 行动速度
            services.applyEffect(target, { ...createBloodSlow(RULES.slowFarPeriodScale), id: ids.far });
            services.clearEffect(target, ids.hold);
            services.clearEffect(target, ids.near);
          }
        });
      }

      // 血滴穿过本体：回血；血满则转盾（溢出恢复没有上限）。
      // 每次触发恢复都把受伤率乘 0.9 —— 和大运V5 同口径（受伤率指数衰减，走 applyDamageReduction）。
      function onDropletPass(owner, svc) {
        survivalFactor *= RULES.recoverySurvivalFactor;
        // 血量恢复没有上限：直接加，可以超过 maxHp（不转护盾）
        owner.hp += RULES.dropletPassHeal;
        svc.spawnHitText(owner, "+1", { color: "#ff9a8f" });
      }

      // 敌方溅血：V·E 打出的伤害同样按点数从敌人体内弹出血滴
      // （碰撞 2 点 → 2 滴；与自身血滴同款：穿过本体回血、不被消耗、寿命无限）
      function emitEnemyBloodDroplets(ball, hit, damage) {
        const amount = Math.max(0, Math.round(Number(damage) || 0));
        if (amount <= 0 || !ball || !hit) return;
        for (let i = 0; i < amount; i++) {
          const angle = Math.random() * TWO_PI;
          services.spawnProjectile(createBloodDroplet(
            hit.x + Math.cos(angle) * (hit.radius + 1),
            hit.y + Math.sin(angle) * (hit.radius + 1),
            Math.cos(angle) * RULES.dropletSpeed,
            Math.sin(angle) * RULES.dropletSpeed,
            true,                 // 敌方血
            hit.instanceId,       // 出生宽限：先飞离命中目标
            onDropletPass,
            {
              life: RULES.dropletLife,
              passThroughOwner: true,
              inheritReclaim: true
            }
          ));
        }
      }

      // 只有"朴素的撞击"才出自身血滴：不主动发射，受多少伤害喷多少滴
      function emitDropletOnHit(ball, damage) {
        const amount = Math.max(0, Math.round(Number(damage) || 0));
        if (amount <= 0) return;
        for (let i = 0; i < amount; i++) {
          const angle = Math.random() * TWO_PI;
          services.spawnProjectile(createBloodDroplet(
            ball.x + Math.cos(angle) * (ball.radius + 1),
            ball.y + Math.sin(angle) * (ball.radius + 1),
            Math.cos(angle) * RULES.dropletSpeed,
            Math.sin(angle) * RULES.dropletSpeed,
            false,
            null,
            onDropletPass,
            {
              life: RULES.dropletLife,
              passThroughOwner: true,
              inheritReclaim: true
            }
          ));
        }
      }

      return {
        beforeUpdateStep: refreshAura,
        update() {},
        updateWhilePaused() {},

        // ---- 血域外围视觉（画在小球身后）----
        drawArenaBackground(context, ctx) {
          const ball = context.ball;
          if (!ball || ball.hp <= 0) return false;
          const time = context.game.time;
          const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);
          const outer = RULES.slowNearRadius;
          const inner = RULES.holdRadius;
          ctx.save();
          const canGradient = typeof ctx.createRadialGradient === "function";

          // 1) 血雾本体：中心浓、向外化开，没有硬边
          if (canGradient) {
            const mist = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, outer);
            mist.addColorStop(0, "rgba(122,8,16,0.34)");
            mist.addColorStop(0.42, "rgba(108,10,26,0.19)");
            mist.addColorStop(0.76, "rgba(88,8,24,0.07)");
            mist.addColorStop(1, "rgba(80,6,20,0)");
            ctx.fillStyle = mist;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, outer, 0, Math.PI * 2);
            ctx.fill();
            // 2) 强控核心：一小团更浓的血雾（同样不画硬边）
            const core = ctx.createRadialGradient(ball.x, ball.y, 0, ball.x, ball.y, inner);
            core.addColorStop(0, "rgba(255,64,72," + (0.12 + pulse * 0.07).toFixed(3) + ")");
            core.addColorStop(0.68, "rgba(168,16,28,0.09)");
            core.addColorStop(1, "rgba(140,10,24,0)");
            ctx.fillStyle = core;
            ctx.beginPath();
            ctx.arc(ball.x, ball.y, inner, 0, Math.PI * 2);
            ctx.fill();
          }

          // 3) 外膜：起伏的血色薄膜（正弦扰动的闭合曲线，不是正圆）
          const segments = 72;
          const rippleAt = (angle) => 1
            + 0.032 * Math.sin(angle * 3 + time * 0.9)
            + 0.020 * Math.sin(angle * 5 - time * 1.3);
          ctx.beginPath();
          for (let i = 0; i <= segments; i += 1) {
            const a = (i / segments) * Math.PI * 2;
            const radius = outer * rippleAt(a);
            const x = ball.x + Math.cos(a) * radius;
            const y = ball.y + Math.sin(a) * radius;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          // 柔光层 + 亮边层
          ctx.globalAlpha = 0.10 + pulse * 0.09;
          ctx.strokeStyle = "#c81f2e";
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.globalAlpha = 0.26 + pulse * 0.20;
          ctx.strokeStyle = "#d92b3a";
          ctx.lineWidth = 1.3;
          ctx.stroke();

          // 4) 内部血纹：几条缓慢漂移的弧
          ctx.globalAlpha = 0.14 + pulse * 0.11;
          ctx.strokeStyle = "#ff4a3a";
          ctx.lineWidth = 1;
          for (let k = 0; k < 3; k += 1) {
            const radius = inner + (outer - inner) * (0.28 + k * 0.24);
            const start = time * (0.22 + k * 0.11) + k * 2.1;
            ctx.beginPath();
            ctx.arc(
              ball.x, ball.y, radius,
              start, start + 1.05 + 0.22 * Math.sin(time * 0.8 + k)
            );
            ctx.stroke();
          }
          ctx.restore();
          return true;
        },

        onCollision(context, target) {
          context.services.dealDamage(target, RULES.bodyDamage);
          // 碰撞 2 点 → 敌方溅 2 滴血
          emitEnemyBloodDroplets(context.ball, target, RULES.bodyDamage);
        },

        onDamaged(context, event) {
          emitDropletOnHit(context.ball, event && event.amount);
        },

        onBeforeDamage(context, event) {
          const reduction = Math.min(1, Math.max(0, 1 - survivalFactor));
          if (reduction <= 0) return event;
          return applyDamageReduction(event, reduction, Math.random);
        },

        getHpDisplay() {
          return {};
        },

        onBorrowEnd() {
          survivalFactor = 1;
        },

        onDeath() {},

        getLiangchenVEState() {
          return { survivalFactor };
        }
      };
    }
  };

  registerBall(liangchenVEDefinition);
  return { liangchenVEDefinition, LIANGCHEN_VE_RULES: RULES };
});
