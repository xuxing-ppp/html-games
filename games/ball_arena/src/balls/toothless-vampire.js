(function initializeToothlessVampire(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createToothlessVampirePlugin({ registerBall }) {
  // 杂鱼版吸血鬼：没有獠牙、不锁定、不持续伤害、不加冷却。
  // 首撞只在敌方接触位置留一道外环伤口，二次撞中同一处才补一口。
  const WOUND_DURATION = 5;              // 世界秒
  const WOUND_ARC = 15 * Math.PI / 180;  // 伤口在目标外环上的宽度
  const BITE_TOLERANCE = WOUND_ARC / 2;  // 复撞角差 ±7.5 度
  const BITE_DAMAGE = 3;
  const BITE_HEAL = 3;
  const HEAL_COLOR = "#39ff6a";
  const BODY_COLOR = "#ee6670";
  const WOUND_COLOR = "#8e1024";
  const WOUND_LINE_WIDTH = 2.5;
  const WOUND_ID_PREFIX = "toothless-vampire-wound-";
  const EPSILON = 1e-9;

  function normalizeAngle(angle) {
    let value = angle % (Math.PI * 2);
    if (value > Math.PI) value -= Math.PI * 2;
    if (value <= -Math.PI) value += Math.PI * 2;
    return value;
  }

  function angleGap(first, second) {
    return Math.abs(normalizeAngle(first - second));
  }

  // 伤口是附着状态：只记住角度，位置和半径每次绘制都从目标本体现取。
  function createWoundEffect(angle, sourceKey, id) {
    return {
      id,
      duration: WOUND_DURATION,
      woundSource: sourceKey,
      woundAngle: angle,
      draw({ ball }, canvasContext) {
        const ringRadius = Math.max(0.5, ball.radius - WOUND_LINE_WIDTH / 2);
        canvasContext.save();
        canvasContext.strokeStyle = WOUND_COLOR;
        canvasContext.lineWidth = WOUND_LINE_WIDTH;
        canvasContext.beginPath();
        canvasContext.arc(
          ball.x,
          ball.y,
          ringRadius,
          angle - WOUND_ARC / 2,
          angle + WOUND_ARC / 2
        );
        canvasContext.stroke();
        canvasContext.restore();
      }
    };
  }

  // 角度取「目标中心 → 攻击者中心」。接触法线的约定是由攻击者指向目标，
  // 因此取反；直接调用钩子没有接触几何时退回用两球当前位置计算。
  function biteAngle(context, target) {
    const contact = context.contact;
    if (
      contact &&
      Number.isFinite(contact.normalX) &&
      Number.isFinite(contact.normalY) &&
      Math.hypot(contact.normalX, contact.normalY) > EPSILON
    ) {
      return Math.atan2(-contact.normalY, -contact.normalX);
    }
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return null;
    return Math.atan2(context.ball.y - target.y, context.ball.x - target.x);
  }

  function findExistingWound(target, sourceKey, angle, now) {
    if (!(target.effects instanceof Map)) return null;
    let match = null;
    let smallestGap = Infinity;
    for (const effect of target.effects.values()) {
      if (!effect || effect.woundSource !== sourceKey) continue;
      if (!Number.isFinite(effect.woundAngle) || effect.expiresAt <= now) continue;
      const gap = angleGap(angle, effect.woundAngle);
      if (gap > BITE_TOLERANCE + EPSILON || gap >= smallestGap) continue;
      match = effect;
      smallestGap = gap;
    }
    return match;
  }

  const toothlessVampireDefinition = {
    id: "toothless-vampire",
    name: "无牙吸血鬼",
    englishName: "Toothless Vampire",
    color: BODY_COLOR,
    description: "杂鱼 / 首撞破皮留伤，复撞同一处 +3",
    rosterType: "zako",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior() {
      // Ownership follows this live behavior through Swap, not its current body.
      const sourceKey = Object.freeze({});
      let sourceId;
      let woundCount = 0;

      return {
        onCollision(context, target) {
          if (!context || !target || context.blockedAtContact) return;
          // 伤害和状态都必须走本次接触的源绑定服务：借用时它已指向借入方。
          const hooks = context.services;
          if (!hooks) return;
          const angle = biteAngle(context, target);
          if (angle === null) return;
          const now = context.game.time;
          // 必须先查旧伤再考虑创建：首撞只留伤，绝不咬自己刚留下的那一口。
          const wound = findExistingWound(target, sourceKey, angle, now);
          if (wound) {
            const hpBefore = target.hp;
            hooks.dealDamage(target, BITE_DAMAGE);
            // dealDamage 的返回值只表示结算被接受；只有真正掉血才回血，
            // 回血沿用原吸血鬼的直接加法，允许超过 maxHp。
            if (target.hp < hpBefore) {
              context.ball.hp += BITE_HEAL;
              hooks.spawnHitText(context.ball, `+${BITE_HEAL}`, { color: HEAL_COLOR });
            }
            // 伤口不刷新、不消耗、不重复咬：本次接触到此为止。
            return;
          }
          if (sourceId === undefined) sourceId = context.ball.instanceId;
          let id;
          do {
            id = `${WOUND_ID_PREFIX}${sourceId}-${woundCount++}`;
          } while (target.effects.has(id));
          hooks.applyEffect(target, createWoundEffect(angle, sourceKey, id));
        }
      };
    }
  };

  registerBall(toothlessVampireDefinition);
  return {
    toothlessVampireDefinition,
    TOOTHLESS_VAMPIRE_WOUND_DURATION: WOUND_DURATION,
    TOOTHLESS_VAMPIRE_WOUND_ARC: WOUND_ARC,
    TOOTHLESS_VAMPIRE_BITE_TOLERANCE: BITE_TOLERANCE,
    TOOTHLESS_VAMPIRE_BITE_DAMAGE: BITE_DAMAGE,
    TOOTHLESS_VAMPIRE_BITE_HEAL: BITE_HEAL,
    TOOTHLESS_VAMPIRE_WOUND_ID_PREFIX: WOUND_ID_PREFIX
  };
});
