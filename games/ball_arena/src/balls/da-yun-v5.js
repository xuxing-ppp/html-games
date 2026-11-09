(function initializeDaYunV5(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunV5Plugin({ registerBall, applyDamageReduction }) {
  const SURVIVAL_FACTOR_PER_LOST_HP = 0.97; // 每扣 1 血，受伤率（1-减伤率）× 97/100
  const HARDEN_PULSE_SECONDS = 0.3;         // 每次掉血的淬火反馈时长
  const STAGE_UP_SECONDS = 0.45;            // 跨档（装甲真的厚了一级）的爆发时长
  const SPARK_MIN = 4;                      // 刚受伤时的火花数
  const SPARK_MAX = 16;                     // 快满硬时的火花数

  const STEEL_BRIGHT = "#d7dee6"; // 淬火高光
  const STEEL_MID = "#9aa3ad";    // 装甲主色
  const STEEL_DARK = "#6b7480";   // 装甲暗环

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 减伤率 = 1 - 0.97^已扣血：受伤率随扣血指数衰减。
  function currentReduction(ball) {
    if (!ball) return 0;
    const maxHp = Number.isFinite(ball.maxHp) ? ball.maxHp : 100;
    const lost = clamp(maxHp - Math.max(0, ball.hp), 0, maxHp);
    if (lost <= 0) return 0;
    return clamp(1 - Math.pow(SURVIVAL_FACTOR_PER_LOST_HP, lost), 0, 1);
  }

  // 碰撞伤害按血量十位分档：伤害与十位数互补为 10。
  //   hp≥90 → 1，80~89 → 2，70~79 → 3，……，10~19 → 9，1~9 → 10。
  // hp=100 的十位是 0，但按"从 90 血开始计档"的语义满血仍为 1。
  function currentContactDamage(ball) {
    if (!ball) return 1;
    const hp = Math.max(1, Math.floor(ball.hp));
    if (hp >= 100) return 1;
    return Math.max(1, 10 - Math.floor(hp / 10));
  }

  // 装甲阶段：减伤每 25% 一档，共 0~3 档，档位越高装甲越厚。
  function armorTier(reduction) {
    return clamp(Math.floor(reduction * 4), 0, 3);
  }

  // 硬度：已扣血占上限的比例（0~1）。档位只有 4 级，是结构件（环、铆钉）的开关；
  // 观众要的是"每掉一点血都更硬一点"，所以视觉强度走这条连续量。
  function hardnessOf(ball) {
    if (!ball) return 0;
    const maxHp = Number.isFinite(ball.maxHp) ? ball.maxHp : 100;
    if (maxHp <= 0) return 0;
    const lost = clamp(maxHp - Math.max(0, ball.hp), 0, maxHp);
    return clamp(lost / maxHp, 0, 1);
  }

  // 受击反馈：一圈亮环从外缘收缩贴合，甩出火花。
  // 强度全随硬度长大 —— 火花 4→16 根、外圈从 1 圈加到 2 圈、被完全挡下再加白芯。
  function createHardenClangEffect(x, y, radius, fullyBlocked, hardness) {
    const value = clamp(Number.isFinite(hardness) ? hardness : 0, 0, 1);
    const sparks = [];
    const sparkCount = Math.round(SPARK_MIN + (SPARK_MAX - SPARK_MIN) * value) +
      (fullyBlocked ? 2 : 0);
    for (let index = 0; index < sparkCount; index += 1) {
      const angle = (Math.PI * 2 * index) / sparkCount + Math.random() * 0.6;
      sparks.push({
        angle,
        distance: radius + 4 + Math.random() * (4 + value * 8),
        length: 3.2 + value * 4.2 + (fullyBlocked ? 1.4 : 0)
      });
    }
    return {
      kind: "daYunV5HardenClang",
      life: HARDEN_PULSE_SECONDS * (0.85 + value * 0.55),
      x,
      y,
      radius,
      fullyBlocked,
      hardness: value,
      sparks,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const power = 0.55 + effect.hardness * 0.75;
        context.save();
        context.globalAlpha *= (1 - progress * 0.85) * (effect.fullyBlocked ? 1 : 0.8) * power;
        // 收缩环：从外缘收回到贴合球面，像装甲正在合拢
        context.strokeStyle = effect.fullyBlocked ? STEEL_BRIGHT : STEEL_MID;
        context.lineWidth = (effect.fullyBlocked ? 2.5 : 1.6) + effect.hardness * 1.4;
        context.beginPath();
        context.arc(effect.x, effect.y, effect.radius + (1 - progress) * 14 + 2, 0, Math.PI * 2);
        context.stroke();
        // 硬到一半以后，外面再套一圈：合拢的层次越多，看起来越厚
        if (effect.hardness >= 0.5) {
          context.globalAlpha *= 0.7;
          context.strokeStyle = STEEL_DARK;
          context.lineWidth = 1.1 + effect.hardness;
          context.beginPath();
          context.arc(
            effect.x,
            effect.y,
            effect.radius + 4 + (1 - progress) * (12 + effect.hardness * 8),
            0,
            Math.PI * 2
          );
          context.stroke();
        }
        // 完全挡下：中间补一圈白芯，"叮"得更实
        if (effect.fullyBlocked) {
          context.globalAlpha *= 0.85;
          context.strokeStyle = STEEL_BRIGHT;
          context.lineWidth = 1.4;
          context.beginPath();
          context.arc(effect.x, effect.y, effect.radius * (0.55 + 0.35 * progress), 0, Math.PI * 2);
          context.stroke();
        }
        // 火花：数量与长度都随硬度长
        context.strokeStyle = STEEL_BRIGHT;
        context.lineWidth = 1.2;
        for (const spark of effect.sparks) {
          const inner = spark.distance - progress * 5;
          const outer = inner + spark.length * (1 - progress);
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(spark.angle) * inner,
            effect.y + Math.sin(spark.angle) * inner
          );
          context.lineTo(
            effect.x + Math.cos(spark.angle) * outer,
            effect.y + Math.sin(spark.angle) * outer
          );
          context.stroke();
        }
        context.restore();
      }
    };
  }

  // 跨档爆发：装甲真的厚了一级 —— 外扩钢环 + 崩出来的钢片。
  function createHardenStageUpEffect(x, y, radius, tier) {
    const stage = clamp(Number.isFinite(tier) ? tier : 1, 1, 3);
    const shards = [];
    const shardCount = 6 + stage * 3;
    for (let index = 0; index < shardCount; index += 1) {
      const angle = (Math.PI * 2 * index) / shardCount + Math.random() * 0.35;
      shards.push({ angle, length: 4 + Math.random() * 5 + stage });
    }
    return {
      kind: "daYunV5HardenStageUp",
      life: STAGE_UP_SECONDS,
      x,
      y,
      radius,
      tier: stage,
      shards,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        context.save();
        context.globalAlpha *= fade * 0.95;
        context.strokeStyle = STEEL_BRIGHT;
        context.lineWidth = 2.8 - progress * 1.5;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          effect.radius + 3 + progress * (10 + effect.tier * 4),
          0,
          Math.PI * 2
        );
        context.stroke();
        context.globalAlpha *= 0.6;
        context.strokeStyle = STEEL_DARK;
        context.lineWidth = 1.5;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          effect.radius + 6 + progress * (7 + effect.tier * 3),
          0,
          Math.PI * 2
        );
        context.stroke();
        context.globalAlpha = fade * 0.9;
        context.fillStyle = STEEL_BRIGHT;
        for (const shard of effect.shards) {
          const inner = effect.radius + 2 + progress * (6 + effect.tier * 2);
          const outer = inner + shard.length * (1 - progress);
          context.beginPath();
          context.moveTo(
            effect.x + Math.cos(shard.angle) * inner,
            effect.y + Math.sin(shard.angle) * inner
          );
          context.lineTo(
            effect.x + Math.cos(shard.angle + 0.12) * outer,
            effect.y + Math.sin(shard.angle + 0.12) * outer
          );
          context.lineTo(
            effect.x + Math.cos(shard.angle - 0.12) * outer,
            effect.y + Math.sin(shard.angle - 0.12) * outer
          );
          context.closePath();
          context.fill();
        }
        context.restore();
      }
    };
  }

  const daYunV5Definition = {
    id: "daYunV5",
    name: "大运V5",
    englishName: "Da Yun V5",
    color: "#b5ab7a",
    description: "撞伤与血量十位互补为10 / 每扣 1 血受伤率×97/100 / 受击淬火硬化，掉血越多越像一块钢",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let ownerBall = null;
      let hardenPulseUntil = 0;
      let stageUpUntil = 0;
      let lastTier = 0;

      function spawnVisual(context, definition) {
        if (!context.services || typeof context.services.spawnVisualEffect !== "function") {
          return false;
        }
        context.services.spawnVisualEffect(definition);
        return true;
      }

      function spawnQuench(context, ball, fullyBlocked, hardness) {
        hardenPulseUntil = context.game.time + HARDEN_PULSE_SECONDS;
        spawnVisual(context, createHardenClangEffect(
          ball.x,
          ball.y,
          ball.radius,
          fullyBlocked,
          hardness
        ));
      }

      function spawnStageUp(context, ball, tier) {
        stageUpUntil = context.game.time + STAGE_UP_SECONDS;
        spawnVisual(context, createHardenStageUpEffect(ball.x, ball.y, ball.radius, tier));
        if (context.services && typeof context.services.shakeArena === "function") {
          context.services.shakeArena({
            intensity: 0.3 + tier * 0.12,
            duration: 90 + tier * 30
          });
        }
        if (context.services && typeof context.services.spawnHitText === "function") {
          const marks = tier >= 3 ? "III" : (tier === 2 ? "II" : "I");
          context.services.spawnHitText(ball.x, ball.y - ball.radius - 6, "淬火 " + marks);
        }
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          lastTier = armorTier(currentReduction(context.ball));
        },
        update(context) {
          ownerBall = context.ball;
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, currentContactDamage(context.ball));
        },
        onBeforeDamage(context, event) {
          ownerBall = context.ball;
          if (!event) return event;
          const ball = context.ball;
          const reduction = currentReduction(ball);
          if (reduction <= 0) return event;
          const reduced = applyDamageReduction(event, reduction);
          if (reduced.amount < event.amount && reduced.amount <= 0) {
            // 完全挡下：这一下不掉血，也就不会有 onDamaged，
            // 所以"叮"在这里打，而且是最亮的那一档。
            spawnQuench(context, ball, true, hardnessOf(ball));
          }
          return reduced;
        },
        onDamaged(context) {
          ownerBall = context.ball;
          const ball = context.ball;
          if (!ball || ball.hp <= 0) return;
          // 每次掉血都来一发淬火反馈，强度随硬度长大。
          const hardness = hardnessOf(ball);
          spawnQuench(context, ball, false, hardness);
          // 跨档：减伤又过了一个 25%，装甲真的厚了一级，补一发大的。
          const tier = armorTier(currentReduction(ball));
          if (tier > lastTier) {
            lastTier = tier;
            spawnStageUp(context, ball, tier);
          }
        },
        drawAfter(context, canvasContext) {
          const ball = context.ball || ownerBall;
          // 这里不能写可选链：Chromium 79 的系统 WebView 解析不了它，整个包
          // 会直接白屏。等价的空值判断拆成两步。
          if (!ball || !canvasContext || typeof canvasContext.arc !== "function") return;
          const reduction = currentReduction(ball);
          const hardness = hardnessOf(ball);
          const tier = armorTier(reduction);
          if (hardness <= 0 && tier <= 0) return;
          const pulse = clamp(
            (hardenPulseUntil - context.game.time) / HARDEN_PULSE_SECONDS,
            0,
            1
          );
          const stage = clamp(
            (stageUpUntil - context.game.time) / STAGE_UP_SECONDS,
            0,
            1
          );
          canvasContext.save();

          // 一、淬火面：越硬，球面越像一块抛过光的钢（贴着球面裁剪后再叠冷却纹）
          canvasContext.save();
          canvasContext.beginPath();
          canvasContext.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
          canvasContext.clip();
          const sheen = canvasContext.createRadialGradient(
            ball.x - ball.radius * 0.35,
            ball.y - ball.radius * 0.45,
            ball.radius * 0.12,
            ball.x,
            ball.y,
            ball.radius * 1.02
          );
          sheen.addColorStop(0, "rgba(233, 241, 248, " + (0.08 + hardness * 0.44).toFixed(3) + ")");
          sheen.addColorStop(0.55, "rgba(154, 163, 173, " + (0.05 + hardness * 0.26).toFixed(3) + ")");
          sheen.addColorStop(1, "rgba(82, 90, 100, " + (0.05 + hardness * 0.34).toFixed(3) + ")");
          canvasContext.fillStyle = sheen;
          canvasContext.fillRect(
            ball.x - ball.radius,
            ball.y - ball.radius,
            ball.radius * 2,
            ball.radius * 2
          );
          // 冷却纹：从边缘往里蔓延的暗线，越硬越多越清楚
          const veins = 3 + Math.round(hardness * 5);
          canvasContext.strokeStyle = "rgba(70, 78, 88, " + (0.18 + hardness * 0.42).toFixed(3) + ")";
          canvasContext.lineWidth = 1;
          for (let index = 0; index < veins; index += 1) {
            const angle = (Math.PI * 2 * index) / veins + hardness * 1.4;
            const inner = ball.radius * (0.22 + (index % 3) * 0.14);
            canvasContext.beginPath();
            canvasContext.moveTo(
              ball.x + Math.cos(angle) * ball.radius,
              ball.y + Math.sin(angle) * ball.radius
            );
            canvasContext.lineTo(
              ball.x + Math.cos(angle + 0.9) * inner,
              ball.y + Math.sin(angle + 0.9) * inner
            );
            canvasContext.stroke();
          }
          canvasContext.restore();

          // 二、装甲环：档位决定圈数与厚度，硬度决定亮度
          const flash = Math.max(pulse, stage);
          canvasContext.globalAlpha *= (0.55 + 0.45 * hardness) * (1 + flash * 0.6);
          canvasContext.strokeStyle = flash > 0.4 ? STEEL_BRIGHT : STEEL_MID;
          canvasContext.lineWidth = 1 + tier * 0.8 + hardness * 0.8;
          canvasContext.beginPath();
          canvasContext.arc(ball.x, ball.y, ball.radius + 3, 0, Math.PI * 2);
          canvasContext.stroke();
          if (tier >= 2) {
            canvasContext.globalAlpha *= 0.85;
            canvasContext.strokeStyle = STEEL_DARK;
            canvasContext.lineWidth = 1.2 + hardness * 0.6;
            canvasContext.beginPath();
            canvasContext.arc(ball.x, ball.y, ball.radius + 5.5, 0, Math.PI * 2);
            canvasContext.stroke();
          }
          // 三、外压光环：越硬越往外顶、越亮 —— "变硬"最直观的一层
          canvasContext.globalAlpha = (0.1 + hardness * 0.42) * (0.55 + 0.45 * flash);
          canvasContext.strokeStyle = STEEL_BRIGHT;
          canvasContext.lineWidth = 1.3 + hardness * 2 + flash * 1.2;
          canvasContext.beginPath();
          canvasContext.arc(
            ball.x,
            ball.y,
            ball.radius + 7 + hardness * 6 + (1 - pulse) * 2.5,
            0,
            Math.PI * 2
          );
          canvasContext.stroke();
          // 四、铆钉：3 档（减伤 ≥75%）满甲，八向铆钉锁边
          if (tier >= 3) {
            canvasContext.globalAlpha = 0.75 + 0.25 * hardness;
            canvasContext.fillStyle = STEEL_BRIGHT;
            for (let index = 0; index < 8; index += 1) {
              const angle = (Math.PI * 2 * index) / 8;
              canvasContext.beginPath();
              canvasContext.arc(
                ball.x + Math.cos(angle) * (ball.radius + 3),
                ball.y + Math.sin(angle) * (ball.radius + 3),
                1 + hardness * 0.6,
                0,
                Math.PI * 2
              );
              canvasContext.fill();
            }
          }
          canvasContext.restore();
        },
        getDaYunV5State() {
          const reduction = currentReduction(ownerBall);
          return {
            reduction,
            contactDamage: currentContactDamage(ownerBall),
            armorTier: armorTier(reduction),
            hardness: hardnessOf(ownerBall)
          };
        }
      };
    }
  };

  registerBall(daYunV5Definition);
  return {
    daYunV5Definition,
    daYunV5Hardness: hardnessOf,
    DA_YUN_V5_CONSTANTS: Object.freeze({
      survivalFactorPerLostHp: SURVIVAL_FACTOR_PER_LOST_HP,
      hardenPulseSeconds: HARDEN_PULSE_SECONDS,
      stageUpSeconds: STAGE_UP_SECONDS,
      sparkMin: SPARK_MIN,
      sparkMax: SPARK_MAX
    })
  };
});
