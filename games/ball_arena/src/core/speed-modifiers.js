(function initializeSpeedModifiers(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpeedModifiersApi() {
  "use strict";

  // 一个效果对速度的贡献因子允许的范围。0 表示完全钉住（冰冻类），负数没有
  // 意义所以会被忽略；上界只是防止数值事故，不参与任何平衡。
  const SPEED_FACTOR_MIN = 0;
  const SPEED_FACTOR_MAX = 8;

  function normalizeSpeedFactor(factor) {
    if (!Number.isFinite(factor) || factor < 0) return null;
    return Math.min(SPEED_FACTOR_MAX, factor);
  }

  // 与 StatusController 保持同一套"活跃效果"判据：没有绝对到期时间的对象
  // 不是普通状态效果，不参与速度合成。
  function isActiveEffect(effect, now) {
    if (!effect || !Number.isFinite(effect.expiresAt)) return false;
    return effect.expiresAt > now;
  }

  /**
   * 统一的移动速度合成器。
   *
   * 速度只由两个通道决定，并且是可交换的乘法，没有先后顺序问题：
   *
   * - 自身通道 `ball.speedMultiplierBase`：小球自己的位移机制（冲刺、悬停、
   *   体积决定的速度、借用别人的速度等），通过 `services.setSpeedMultiplier`。
   * - 效果通道 `effect.speedFactor`：任何来自状态效果的速度因子，包括减缓和
   *   增益。所有会减速的小球都必须走这一条，不再各自改 vx/vy 或倍率。
   *
   * `ball.speedMultiplier` 是两者的乘积（合成结果），全项目只读它。
   *
   * 免疫：`getCapabilityOverrides()` 返回 `canBeSlowed: false` 的小球会忽略
   * 一切小于 1 的因子（已经在身上的也一样忽略，解除免疫后自动恢复），大于 1
   * 的增益照常生效。免疫只在合成层生效，因此不会篡改挂上来的效果本身。
   */
  class SpeedModifierSystem {
    constructor({ now = () => 0, canBeSlowed = () => true } = {}) {
      if (typeof now !== "function" || typeof canBeSlowed !== "function") {
        throw new TypeError("SpeedModifierSystem requires function callbacks");
      }
      this.now = now;
      this.canBeSlowed = canBeSlowed;
    }

    baseMultiplier(ball) {
      const base = ball && ball.speedMultiplierBase;
      return Number.isFinite(base) && base > 0 ? base : 1;
    }

    setBaseMultiplier(ball, multiplier) {
      if (!Number.isFinite(multiplier) || multiplier <= 0) {
        throw new TypeError("Speed multiplier must be positive");
      }
      if (!ball || typeof ball !== "object") {
        throw new TypeError("Speed multiplier requires a combatant");
      }
      ball.speedMultiplierBase = multiplier;
    }

    effectFactor(effect, now) {
      if (!isActiveEffect(effect, now)) return null;
      return normalizeSpeedFactor(effect.speedFactor);
    }

    // 所有小于 1 的效果因子之积；没有减速时为 1。免疫者恒为 1。
    slowFactor(ball) {
      if (!ball || !(ball.effects instanceof Map) || ball.effects.size === 0) return 1;
      if (!this.canBeSlowed(ball)) return 1;
      const now = this.now();
      let value = 1;
      for (const effect of ball.effects.values()) {
        const factor = this.effectFactor(effect, now);
        if (factor === null || factor >= 1) continue;
        value *= factor;
      }
      return value;
    }

    isSlowed(ball) {
      return this.slowFactor(ball) < 1;
    }

    // 合成后的移动倍率：自身通道 × 所有效果因子。免疫小球忽略一切小于 1 的
    // 因子（自身通道不受影响），因此钢卷这类目标既不会被减速也不会被冻住。
    multiplier(ball) {
      const now = this.now();
      const immune = !this.canBeSlowed(ball);
      let value = this.baseMultiplier(ball);
      if (ball && ball.effects instanceof Map) {
        for (const effect of ball.effects.values()) {
          const factor = this.effectFactor(effect, now);
          if (factor === null) continue;
          if (immune && factor < 1) continue;
          value *= factor;
        }
      }
      if (!Number.isFinite(value) || value < 0) return 0;
      return Math.min(value, SPEED_FACTOR_MAX * SPEED_FACTOR_MAX);
    }
  }

  return {
    SPEED_FACTOR_MIN,
    SPEED_FACTOR_MAX,
    normalizeSpeedFactor,
    SpeedModifierSystem
  };
});
