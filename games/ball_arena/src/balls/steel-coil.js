(function initializeSteelCoil(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...require("../core/ball-registry.js"),
        ...require("../core/damage-reduction.js"),
        ...require("../core/arena-geometry.js"),
        ...require("./train-weapon.js"),
        ...require("./shield-tool.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSteelCoilPlugin({
  registerBall,
  applyDamageReduction,
  createArenaGeometry,
  createTrainKnockback,
  getShieldEntityContact,
  isShieldOversizedEntity
}) {
  // 普通伤害减伤 60%；流血 / 灼烧 / 中毒这类"特殊效果出伤"减伤 80%。
  const DAMAGE_REDUCTION = 0.6;
  const EFFECT_DAMAGE_REDUCTION = 0.8;
  // 两次碰撞间隔小于 0.1 秒 → 压扁。
  const CONTACT_DAMAGE = 1;
  const CRUSH_WINDOW = 0.1;
  const CRUSH_DAMAGE = 30;
  const CRUSH_STUN_DURATION = 2;
  // 持续贴住钢卷的目标也要按撞击节奏被顶开，而不是只能被挤开。
  const RAM_INTERVAL = 0.2;
  const STEEL_COIL_COLOR = "#c2c8cc";
  const CRUSH_RING_COLOR = "#eef4f7";
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = Number.isFinite(x) ? x : fallbackX;
    let directionY = Number.isFinite(y) ? y : fallbackY;
    let magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
      magnitude = Math.hypot(directionX, directionY) || 1;
    }
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  // 运动静止的眩晕：锁移动 + 禁攻击 + 停行为，并带上统一眩晕标记。
  function createCrushStun() {
    return {
      id: "stun",
      visualType: "stun",
      duration: CRUSH_STUN_DURATION,
      locksMovement: true,
      preventsAttack: true,
      pausesBehavior: true,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          // 同名眩晕刷新后仍可能读取这份快照。
          effect.savedVx = ball.storedVx != null ? ball.storedVx : ball.vx;
          effect.savedVy = ball.storedVy != null ? ball.storedVy : ball.vy;
        }
        effect.nextDamageAt = game.time;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game }) {
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball }) {
        // 快照可能是击退峰值，解锁后由引擎恢复当前有效速度。
        ball.speedNeedsNormalization = true;
      }
    };
  }

  function createCrushShockwave(x, y) {
    return {
      kind: "steel-coil-crush",
      life: 0.42,
      x,
      y,
      draw({ effect }, context) {
        const progress = Math.min(1, effect.age / effect.life);
        context.save();
        context.translate(effect.x, effect.y);
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = CRUSH_RING_COLOR;
        context.lineWidth = 3 - progress * 2;
        context.beginPath();
        context.arc(0, 0, 8 + progress * 52, 0, TWO_PI);
        context.stroke();
        context.globalAlpha *= 0.7;
        context.strokeStyle = "#8f979d";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(0, 0, 4 + progress * 30, 0, TWO_PI);
        context.stroke();
        context.restore();
      }
    };
  }

  // 钢卷横截面：像真实钢卷那样一层层卷得极密。
  function drawSteelCoilBody(context, ball, time) {
    const radius = ball.radius;
    const boreRadius = radius * 0.2;
    context.save();
    context.translate(ball.x, ball.y);

    // 银白盘面
    const base = typeof context.createRadialGradient === "function"
      ? context.createRadialGradient(0, 0, boreRadius, 0, 0, radius)
      : null;
    if (base) {
      base.addColorStop(0, "#b4bbc0");
      base.addColorStop(0.45, "#e2e7ea");
      base.addColorStop(1, "#b9c0c5");
      context.fillStyle = base;
    } else {
      context.fillStyle = "#d6dbde";
    }
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.fill();

    // 极密的同心层：约 0.55 逻辑单位一圈，亮暗交替
    context.lineWidth = 0.35;
    let ring = 0;
    for (
      let ringRadius = boreRadius + 0.4;
      ringRadius < radius - 0.3;
      ringRadius += 0.55
    ) {
      context.strokeStyle = ring % 2 === 0
        ? "rgba(126, 136, 144, 0.5)"
        : "rgba(255, 255, 255, 0.7)";
      context.beginPath();
      context.arc(0, 0, ringRadius, 0, TWO_PI);
      context.stroke();
      ring += 1;
    }

    // 三道卷缝（钢板收尾的接缝）
    const seam = (time * 0.45) % TWO_PI;
    context.strokeStyle = "rgba(96, 104, 110, 0.55)";
    context.lineWidth = 0.7;
    for (let index = 0; index < 3; index += 1) {
      const angle = seam + index * TWO_PI / 3;
      context.beginPath();
      context.moveTo(Math.cos(angle) * boreRadius, Math.sin(angle) * boreRadius);
      context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
      context.stroke();
    }

    // 中心孔（卷芯）
    context.fillStyle = "#4a5155";
    context.beginPath();
    context.arc(0, 0, boreRadius, 0, TWO_PI);
    context.fill();
    context.fillStyle = "#161a1c";
    context.beginPath();
    context.arc(0, 0, boreRadius * 0.62, 0, TWO_PI);
    context.fill();
    context.strokeStyle = "rgba(240, 246, 248, 0.85)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.arc(0, 0, boreRadius, 0, TWO_PI);
    context.stroke();

    // 外缘
    context.strokeStyle = "#8d959a";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, radius, 0, TWO_PI);
    context.stroke();
    context.restore();
  }

  const steelCoilDefinition = {
    id: "steelCoil",
    name: "钢卷",
    englishName: "Steel Coil",
    color: STEEL_COIL_COLOR,
    description: "90% 减伤 / 免疫眩晕 / 撞击击退 / 连环撞击压扁",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services, { crushDamage = CRUSH_DAMAGE } = {}) {
      let ownerBall = null;
      const lastContactAt = new Map();
      // 持续接触时的撞击节奏（每 RAM_INTERVAL 秒重新顶一次）。
      const lastRamAt = new Map();
      let lastDirection = { x: 1, y: 0 };
      // 可移动目标保留入射速度；固定目标仅在本次接触中被撞毁后恢复入射速度。
      let contactVelocity = null;

      function isFixedStructure(target) {
        // 明确的扎根单位，不把普通眩晕、捕获或技能期间的静止算成建筑。
        return target.isSummon === true && target.definition &&
          target.definition.fixedStructure === true && target.positionLocked === true &&
          services.isMovementLocked(target);
      }

      // 控制类特效（眩晕等）在 onApply 时会记下目标当时的"速度/方向"，
      // 到期再把目标扭回那个方向。钢卷既然免疫眩晕、全程照常运动，
      // 就每帧把这些记录同步成"当下的朝向"，免得眩晕一结束突然转向。
      function keepOwnHeading(ball) {
        const storedVx = ball.storedVx;
        const storedVy = ball.storedVy;
        const magnitude = Math.hypot(storedVx, storedVy);
        if (magnitude > EPSILON) {
          lastDirection = { x: storedVx / magnitude, y: storedVy / magnitude };
        }
        if (services.borrowedAttackOnly || !(ball.effects instanceof Map) || ball.effects.size === 0) return;
        for (const effect of ball.effects.values()) {
          if (!effect || !Number.isFinite(effect.expiresAt)) continue;
          if (Number.isFinite(effect.savedVx) && Number.isFinite(effect.savedVy)) {
            effect.savedVx = storedVx;
            effect.savedVy = storedVy;
          }
          if (
            Number.isFinite(effect.directionX) &&
            Number.isFinite(effect.directionY)
          ) {
            effect.directionX = lastDirection.x;
            effect.directionY = lastDirection.y;
          }
        }
      }

      // 不受碰撞改向：把碰撞前的速度原样还回来（墙面反弹仍然算数）。
      function restoreHeading(ball) {
        if (!Number.isFinite(ball.preHitVx) || !Number.isFinite(ball.preHitVy)) return;
        ball.vx = ball.storedVx = ball.preHitVx;
        ball.vy = ball.storedVy = ball.preHitVy;
      }

      // 可移动目标持续接触同样不改向：被自己的撞击击退锁住移动后，引擎会把钢卷
      // 当成撞墙一样逐帧反弹，而 onCollision 只在接触进入那一帧触发，
      // 所以在帧末恢复入射速度（压扁除外）；固定结构存活时保留物理反弹。
      function restoreContactHeading(ball) {
        if (!contactVelocity) return;
        const fixedTarget = contactVelocity.fixedTarget;
        if (!fixedTarget || fixedTarget.hp <= 0 || fixedTarget.active === false) {
          ball.vx = ball.storedVx = contactVelocity.vx;
          ball.vy = ball.storedVy = contactVelocity.vy;
        }
        contactVelocity = null;
      }

      // 压扁瞬间的转向：沿接触法线反射，速度大小保持不变。
      function turnAway(ball, target) {
        const normal = normalizeDirection(ball.x - target.x, ball.y - target.y, 1, 0);
        const speed = Math.hypot(ball.vx, ball.vy) ||
          ball.speed * ball.speedMultiplier;
        const dot = ball.vx * normal.x + ball.vy * normal.y;
        let nextX = ball.vx - 2 * dot * normal.x;
        let nextY = ball.vy - 2 * dot * normal.y;
        let magnitude = Math.hypot(nextX, nextY);
        if (magnitude <= EPSILON) {
          nextX = normal.x;
          nextY = normal.y;
          magnitude = Math.hypot(nextX, nextY) || 1;
        }
        ball.vx = ball.storedVx = nextX / magnitude * speed;
        ball.vy = ball.storedVy = nextY / magnitude * speed;
      }

      // 第三方实体：圆盾同款"弱质道具直接碾碎 / 大型实体必须转向"的契约，
      // 区别是钢卷碾碎普通道具时不转向，直接压过去。
      function entityContactFor(ball, entity) {
        const contact = getShieldEntityContact(entity, ball.x, ball.y, ball.radius);
        if (contact) return contact;
        if (Number.isFinite(ball.prevX) && Number.isFinite(ball.prevY)) {
          return getShieldEntityContact(entity, ball.prevX, ball.prevY, ball.radius);
        }
        return null;
      }

      function reflectFromEntity(ball, entity, normalX, normalY) {
        const entityVx = Number.isFinite(entity.vx) ? entity.vx : 0;
        const entityVy = Number.isFinite(entity.vy) ? entity.vy : 0;
        const relative =
          (ball.vx - entityVx) * normalX + (ball.vy - entityVy) * normalY;
        if (relative >= -EPSILON) return false;
        const speed = Math.hypot(ball.vx, ball.vy) ||
          ball.speed * ball.speedMultiplier;
        let nextX = ball.vx - 2 * relative * normalX;
        let nextY = ball.vy - 2 * relative * normalY;
        let magnitude = Math.hypot(nextX, nextY);
        if (magnitude <= EPSILON) {
          nextX = normalX;
          nextY = normalY;
          magnitude = Math.hypot(nextX, nextY) || 1;
        }
        ball.vx = ball.storedVx = nextX / magnitude * speed;
        ball.vy = ball.storedVy = nextY / magnitude * speed;
        return true;
      }

      // 引擎里"效果自带的 forceCapabilities"优先级高于球自身的能力覆盖，
      // 所以只靠 getCapabilityOverrides 挡不住电击眩晕这类强行压制。
      // 每帧末尾把挂在钢卷身上的控制标记全部抹掉（伤害类效果照常保留），
      // 才真正做到"不会被眩晕/减速"。
      function shakeOffControl(ball) {
        if (services.borrowedAttackOnly || !(ball.effects instanceof Map) || ball.effects.size === 0) return;
        let changed = false;
        for (const effect of ball.effects.values()) {
          if (!effect || !Number.isFinite(effect.expiresAt)) continue;
          if (effect.locksMovement === true) {
            effect.locksMovement = false;
            changed = true;
          }
          if (effect.pausesBehavior === true) {
            effect.pausesBehavior = false;
            changed = true;
          }
          if (effect.preventsAttack === true) {
            effect.preventsAttack = false;
            changed = true;
          }
          // 输出封锁也是控制标记：直接读原始 flag 的球（例如枪手）也要看到
          // 钢卷没被压住。
          if (effect.blocksDamageOutput === true) {
            effect.blocksDamageOutput = false;
            changed = true;
          }
          if (effect.forceCapabilities) {
            effect.forceCapabilities = null;
            changed = true;
          }
        }
        if (changed) ball.statusRevision = (ball.statusRevision || 0) + 1;
      }

      function resolveEntityContacts(context) {
        const ball = context.ball;
        const game = context.game;
        for (const entity of game.combatEntities) {
          if (!entity || entity === ball || entity.isProjectile) continue;
          if (entity.entityActive === false || entity.life <= 0) continue;
          if (entity.teamId === ball.teamId) continue;
          // 持械等与本体绑定的装备不是可碾碎的第三方道具。
          if (entity.attachedToOwner === true) continue;
          const contact = entityContactFor(ball, entity);
          if (!contact) continue;

          // 大型实体（火车、台球桌等）：钢卷不得不转向。
          if (isShieldOversizedEntity(entity)) {
            if (contact.penetration > 0) {
              const arena = game.arena || createArenaGeometry(game.arenaSize);
              const point = arena.clampPoint(ball.x + contact.normalX * contact.penetration,
                ball.y + contact.normalY * contact.penetration, ball.radius);
              ball.x = point.x;
              ball.y = point.y;
            }
            const reflected = reflectFromEntity(ball, entity, contact.normalX, contact.normalY);
            if (reflected && typeof entity.onSolidImpact === "function") {
              entity.onSolidImpact({ entity, attacker: ball, contact, destroyAfterDeflection: true });
            }
            continue;
          }

          // 弱质第三方实体：碾碎，不转向。
          if (typeof entity.onShieldDestroyed === "function") {
            entity.onShieldDestroyed(entity, contact);
          }
          entity.life = 0;
          entity.entityActive = false;
          services.spawnParticleBurst({
            x: contact.x,
            y: contact.y,
            count: 12,
            colors: ["#ffffff", "#c6ccd0", "#8f979d"],
            minDiameter: 1.2,
            maxDiameter: 3.6,
            minSpeed: 60,
            maxSpeed: 190,
            life: 0.45,
            drag: 2.6
          });
        }
      }

      // 一次撞击：列车同款击退 + 灰白粒子；首次撞击额外结算 1 点碰撞伤害
      //（持续贴住时的重复撞击只负责把对手顶开，伤害仍按接触次数结算）。
      function ram(context, target, options = {}) {
        const ball = context.ball;
        if (options.damage !== false) {
          context.services.dealDamage(target, CONTACT_DAMAGE);
        }
        const direction = normalizeDirection(target.x - ball.x, target.y - ball.y);
        if (options.knockback !== false) {
          context.services.applyEffect(
            target,
            createTrainKnockback(ball, direction.x, direction.y)
          );
        }
        services.spawnParticleBurst({
          x: (ball.x + target.x) / 2,
          y: (ball.y + target.y) / 2,
          count: 12,
          colors: ["#ffffff", "#c6ccd0", "#8f979d"],
          minDiameter: 1,
          maxDiameter: 3.2,
          minSpeed: 60,
          maxSpeed: 180,
          directionAngle: Math.atan2(direction.y, direction.x),
          directionSpread: 1.2,
          life: 0.4,
          drag: 2.8
        });
      }

      function crush(context, target) {
        const ball = context.ball;
        // 压扁是主动转向，不要被帧末的"保持朝向"撤销。
        contactVelocity = null;
        context.services.dealDamage(target, crushDamage);
        turnAway(ball, target);
        services.applyEffect(target, createCrushStun());
        const middleX = (ball.x + target.x) / 2;
        const middleY = (ball.y + target.y) / 2;
        services.spawnVisualEffect(createCrushShockwave(middleX, middleY));
        services.spawnParticleBurst({
          x: middleX,
          y: middleY,
          count: 18,
          colors: ["#ffffff", "#c6ccd0", "#8f979d"],
          minDiameter: 1.4,
          maxDiameter: 4,
          minSpeed: 90,
          maxSpeed: 240,
          life: 0.5,
          drag: 2.6
        });
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
        },
        update(context) {
          ownerBall = context.ball;
          keepOwnHeading(context.ball);
        },
        updateWhilePaused(context) {
          ownerBall = context.ball;
          keepOwnHeading(context.ball);
        },
        onCollision(context, target) {
          const ball = context.ball;
          if (!target || target.hp <= 0) return;
          const fixed = isFixedStructure(target);
          // 未撞毁的固定实体保留引擎的法线反弹，不能在帧末撤销。
          if (!fixed) restoreHeading(ball);

          if (context.blockedAtContact) return;

          const key = target.instanceId;
          const now = context.game.time;
          const previous = lastContactAt.get(key);
          lastContactAt.set(key, now);

          // 两次碰撞间隔小于 0.1 秒：压扁（不再击退，直接伤害 + 转向 + 眩晕）。
          if (previous !== undefined && now - previous < CRUSH_WINDOW) {
            if (fixed) restoreHeading(ball);
            crush(context, target);
            if (fixed && target.hp <= 0) restoreHeading(ball);
            return;
          }

          // 普通撞击：1 点碰撞伤害 + "望的列车"同款击退 + 灰白粒子。
          lastRamAt.set(key, now);
          ram(context, target, { knockback: !fixed });
          if (fixed && target.hp <= 0) restoreHeading(ball);
        },
        onContactUpdate(context, target) {
          if (!context.overlapping) return;
          if (!target || target.hp <= 0) return;
          if (context.services && context.services.isEnemy(target) === false) return;
          if (isFixedStructure(target)) {
            if (context.targetContact && context.targetContact.solid) {
              contactVelocity = { vx: context.ball.vx, vy: context.ball.vy, fixedTarget: target };
            }
            return;
          }
          const ball = context.ball;
          if (!Number.isFinite(ball.vx) || !Number.isFinite(ball.vy)) return;
          if (!contactVelocity) contactVelocity = { vx: ball.vx, vy: ball.vy };
          // 贴住不放的目标：按撞击节奏继续顶开它（首次撞击由 onCollision 负责）。
          const key = target.instanceId;
          const now = context.game.time;
          const previous = lastRamAt.get(key);
          if (previous !== undefined && now - previous < RAM_INTERVAL) return;
          lastRamAt.set(key, now);
          ram(context, target, { damage: false });
        },
        afterUpdateStep(context) {
          restoreContactHeading(context.ball);
          resolveEntityContacts(context);
          shakeOffControl(context.ball);
        },
        afterUpdateStepWhilePaused(context) {
          restoreContactHeading(context.ball);
          shakeOffControl(context.ball);
        },
        // 白蛇抽 DISC 给的是"行尸走肉"式的封印效果：钢卷直接拒收，
        // 于是白蛇在它身上只剩 4 点碰撞伤害能打。
        onBeforeEffect(context, definition) {
          if (!definition) return definition;
          if (definition.id === "white-snake-weak") return false;
          if (definition.sealsAbilities === true) return false;
          return definition;
        },
        onBeforeDamage(context, event) {
          if (!event || !event.actor || event.actor === context.ball) return event;
          // 特殊效果出伤（流血/灼烧/中毒等持续伤害）减伤 80%，其余伤害减伤 60%。
          // 不做整段免疫：否则靠持续伤害吃饭的球对钢卷完全无效，强度会失衡。
          const reduction = event.kind === "dot"
            ? EFFECT_DAMAGE_REDUCTION
            : DAMAGE_REDUCTION;
          return applyDamageReduction(event, reduction, Math.random);
        },
        getCapabilityOverrides() {
          // 不会眩晕、不会被减速/冻住：任何控制效果都压不住它的行动。
          // 四个控制能力必须全部覆盖：漏掉任何一个，带该标记的攻击照样压得住它
          //（例如只带 blocksDamageOutput 的输出封锁，会让钢卷撞上去却打不出伤害）。
          // canBeSlowed 由 SpeedModifierSystem 统一解释，不需要额外代码。
          return {
            canMove: true,
            canAct: true,
            canBodyAttack: true,
            canDealDamage: true,
            canBeSlowed: false
          };
        },
        drawBody(context, canvasContext) {
          drawSteelCoilBody(canvasContext, context.ball, context.game.time);
          return true;
        },
        getSteelCoilState() {
          return {
            contactDamage: CONTACT_DAMAGE,
            damageReduction: DAMAGE_REDUCTION,
            effectDamageReduction: EFFECT_DAMAGE_REDUCTION,
            crushWindow: CRUSH_WINDOW,
            crushDamage,
            crushStunDuration: CRUSH_STUN_DURATION,
            dotReduced: true,
            slowImmune: true,
            discImmune: true,
            trackedEnemies: lastContactAt.size
          };
        }
      };
    }
  };

  registerBall(steelCoilDefinition);
  return {
    steelCoilDefinition,
    drawSteelCoilBody,
    createSteelCoilCrushStun: createCrushStun,
    STEEL_COIL_DAMAGE_REDUCTION: DAMAGE_REDUCTION,
    STEEL_COIL_EFFECT_DAMAGE_REDUCTION: EFFECT_DAMAGE_REDUCTION,
    STEEL_COIL_CONTACT_DAMAGE: CONTACT_DAMAGE,
    STEEL_COIL_CRUSH_WINDOW: CRUSH_WINDOW,
    STEEL_COIL_CRUSH_DAMAGE: CRUSH_DAMAGE
  };
});
