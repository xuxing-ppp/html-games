(function initializeRevolver(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createRevolverPlugin({ resolveArenaGeometry, registerBall }) {
  const EPSILON = 1e-9;

  // 每把手枪各自 6 秒冷却。
  const PISTOL_COOLDOWN = 6;
  // 进入射线后 0.05 秒一发、连射 6 发。
  const BURST_SHOTS = 6;
  const SHOT_INTERVAL = 0.05;
  // 子弹：速度 1200、伤害 6。
  const BULLET_SPEED = 1200;
  const BULLET_DAMAGE = 6;
  const BULLET_LIFE = 1.6;
  const BULLET_RADIUS = 3;
  // 左右射线半宽（以自身中心线为基准的水平带）。
  const RAY_HALF_WIDTH = 20;
  // 枪口位置：自身体表再向外这么多。
  const MUZZLE_REACH = 16;
  const PISTOL_OFFSET = 1;
  const RECOIL_TIME = 0.08;

  // 参考「日奈」普通子弹：金黄曳光 + 白色弹芯。
  const TRACER_GOLD = "#ffd24a";
  const TRACER_GOLD_CORE = "#fff6c9";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 扫掠线段与圆形目标的碰撞（与日奈子弹同款判定）。
  function segmentHitsBall(startX, startY, endX, endY, target, radius) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((target.x - startX) * deltaX + (target.y - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    const closestX = startX + deltaX * progress;
    const closestY = startY + deltaY * progress;
    const distance = Math.hypot(target.x - closestX, target.y - closestY);
    return {
      hit: distance <= target.radius + radius,
      x: closestX,
      y: closestY
    };
  }

  function muzzlePoint(ball, side) {
    return {
      x: ball.x + side * (ball.radius + MUZZLE_REACH),
      y: ball.y
    };
  }

  // 枪口火光：与日奈普通弹同款的金黄扇形闪光。
  function createMuzzleFlash(x, y, angle) {
    return {
      kind: "revolver-muzzle-flash",
      life: 0.1,
      x,
      y,
      angle,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const alpha = 1 - progress;
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= alpha;
        const length = 12 * (1 - progress * 0.35);
        const half = 3.2 * (1 - progress * 0.2);
        context.fillStyle = TRACER_GOLD;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(length, -half);
        context.lineTo(length * 0.72, 0);
        context.lineTo(length, half);
        context.closePath();
        context.fill();
        context.fillStyle = TRACER_GOLD_CORE;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(length * 0.45, -half * 0.3);
        context.lineTo(length * 0.45, half * 0.3);
        context.closePath();
        context.fill();
        context.restore();
      }
    };
  }

  // 命中火花：与日奈普通弹同款。
  function createHitSpark(x, y, angle) {
    return {
      kind: "revolver-hit-spark",
      life: 0.16,
      x,
      y,
      angle,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const alpha = 1 - progress;
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= alpha;
        context.strokeStyle = TRACER_GOLD;
        context.lineCap = "round";
        const reach = 4 + progress * 7;
        for (let index = 0; index < 6; index += 1) {
          const spread = (index - 2.5) * 0.42;
          context.lineWidth = 1.6 - index * 0.12;
          context.beginPath();
          context.moveTo(0, 0);
          context.lineTo(
            Math.cos(spread) * reach * (index % 2 === 0 ? 1 : 0.62),
            Math.sin(spread) * reach * (index % 2 === 0 ? 1 : 0.62)
          );
          context.stroke();
        }
        context.fillStyle = TRACER_GOLD_CORE;
        context.beginPath();
        context.arc(0, 0, 2.6 * (1 - progress * 0.5), 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  // 金黄曳光弹体：外观参考日奈普通子弹。
  function createBullet(x, y, side) {
    return {
      kind: "revolver-bullet",
      life: BULLET_LIFE,
      radius: BULLET_RADIUS,
      damage: BULLET_DAMAGE,
      x,
      y,
      vx: side * BULLET_SPEED,
      vy: 0,
      hitTargets: new Set(),
      update({ effect, game, services: entityServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const hitAngle = Math.atan2(effect.vy, effect.vx);
        for (const target of entityServices.getEnemies()) {
          const targetKey = target.instanceId || target.id;
          if (effect.hitTargets.has(targetKey)) continue;
          const contact = segmentHitsBall(
            startX,
            startY,
            effect.x,
            effect.y,
            target,
            effect.radius
          );
          if (!contact.hit) continue;
          if (!entityServices.dealDamage(target, effect.damage)) continue;
          effect.hitTargets.add(targetKey);
          entityServices.spawnVisualEffect(createHitSpark(contact.x, contact.y, hitAngle));
          effect.life = 0;
          break;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, 32)
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, context) {
        const angle = Math.atan2(effect.vy, effect.vx);
        context.save();
        context.translate(effect.x, effect.y);
        context.rotate(angle);
        context.globalCompositeOperation = "lighter";
        context.fillStyle = TRACER_GOLD;
        context.globalAlpha *= 0.85;
        context.fillRect(-14, -2, 14, 4);
        context.fillStyle = TRACER_GOLD_CORE;
        context.fillRect(-7.7, -1, 9.8, 2);
        context.beginPath();
        context.arc(0, 0, 2.48, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }
    };
  }

  // 固定朝向的左轮手枪：side = -1 左手 / +1 右手，永不转向。
  function drawPistol(context, x, y, side, recoil) {
    context.save();
    context.translate(x - side * recoil, y);
    context.scale(side, 1);
    // 握把
    context.fillStyle = "#6b4634";
    context.beginPath();
    context.moveTo(-6.6, 1.2);
    context.lineTo(-1.4, 1.2);
    context.lineTo(-2.8, 8.6);
    context.lineTo(-7.4, 8.6);
    context.closePath();
    context.fill();
    // 枪身
    context.fillStyle = "#33383f";
    context.fillRect(0, -2.2, 15, 4.4);
    // 转轮
    context.beginPath();
    context.arc(0, 0, 4.6, 0, Math.PI * 2);
    context.fill();
    // 枪管高光
    context.fillStyle = "#565d66";
    context.fillRect(4, -2.2, 11, 1.4);
    context.restore();
  }

  function createPistol(side) {
    return {
      side,
      cooldown: 0,
      burstRemaining: 0,
      burstTimer: 0,
      recoil: 0,
      shots: 0,
      bursts: 0
    };
  }

  const revolverDefinition = {
    id: "revolver",
    name: "\u5de6\u8f6e",
    englishName: "Revolver",
    color: "#7a5138",
    description: "\u56fa\u5b9a\u5de6\u53f3\u53cc\u67aa / 6\u79d2\u7edf\u4e00\u51b7\u5374 / \u8fde\u5c04 6 \u53d1\u00d76",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const pistols = [createPistol(-1), createPistol(1)];
      let totalShots = 0;
      // 两把枪共用一个冷却：一次冷却结束，左右两侧同时开始各自的连射。
      let sharedCooldown = 0;

      function enemyInLane(ball, pistol, combatantServices) {
        let found = false;
        combatantServices.forEachEnemy((target) => {
          if (found || !target || target.hp <= 0) return;
          const deltaX = target.x - ball.x;
          if (pistol.side * deltaX <= 0) return;
          if (Math.abs(target.y - ball.y) > RAY_HALF_WIDTH) return;
          const profile = combatantServices.getContactProfile(target);
          if (!profile || profile.attackable === false) return;
          found = true;
        });
        return found;
      }

      function fire(ball, pistol, combatantServices) {
        const muzzle = muzzlePoint(ball, pistol.side);
        combatantServices.spawnProjectile(createBullet(muzzle.x, muzzle.y, pistol.side));
        combatantServices.spawnVisualEffect(
          createMuzzleFlash(muzzle.x, muzzle.y, pistol.side > 0 ? 0 : Math.PI)
        );
        pistol.recoil = RECOIL_TIME;
        pistol.shots += 1;
        totalShots += 1;
      }

      return {
        update(context, dt) {
          const { ball } = context;
          const combatantServices = context.services || services;
          if (!ball || ball.hp <= 0) return;

          sharedCooldown = Math.max(0, sharedCooldown - dt);
          for (const pistol of pistols) {
            if (pistol.recoil > 0) pistol.recoil = Math.max(0, pistol.recoil - dt);

            if (pistol.burstRemaining > 0) {
              pistol.burstTimer -= dt;
              while (pistol.burstRemaining > 0 && pistol.burstTimer <= EPSILON) {
                fire(ball, pistol, combatantServices);
                pistol.burstRemaining -= 1;
                pistol.burstTimer += SHOT_INTERVAL;
              }
              if (pistol.burstRemaining <= 0) {
                pistol.burstTimer = 0;
                sharedCooldown = PISTOL_COOLDOWN;
              }
              continue;
            }
          }

          // 统一冷却：任一侧射道里有敌人，左右两把枪就一起开火。
          // 连射还没打完时不重复启动（否则每帧都会把弹匣重新装满）。
          if (sharedCooldown > EPSILON) return;
          if (pistols.some((pistol) => pistol.burstRemaining > 0)) return;
          if (!enemyInLane(ball, pistols[0], combatantServices) &&
              !enemyInLane(ball, pistols[1], combatantServices)) {
            return;
          }
          for (const pistol of pistols) {
            pistol.burstRemaining = BURST_SHOTS;
            pistol.burstTimer = 0;
            pistol.bursts += 1;
          }
        },
        drawAfter({ ball }, context) {
          if (!ball || ball.hp <= 0) return;
          for (const pistol of pistols) {
            const recoil = pistol.recoil > 0 ? (pistol.recoil / RECOIL_TIME) * 4 : 0;
            drawPistol(
              context,
              ball.x + pistol.side * (ball.radius + PISTOL_OFFSET),
              ball.y,
              pistol.side,
              recoil
            );
          }
        },
        onAttackBorrowStart() {
          for (const pistol of pistols) {
            pistol.burstRemaining = BURST_SHOTS;
            pistol.burstTimer = 0;
            pistol.bursts += 1;
          }
        },
        isAttackCycleComplete() {
          return totalShots > 0 && pistols.every(pistol => pistol.burstRemaining === 0 && pistol.recoil <= EPSILON);
        },
        getAttackCycleTransitionIn() {
          const boundaries = pistols.map(pistol => pistol.burstRemaining > 0 ? pistol.burstTimer : pistol.recoil);
          return Math.max(EPSILON, Math.min(...boundaries));
        },
        drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
        getRevolverState() {
          return {
            cooldown: PISTOL_COOLDOWN,
            sharedCooldown,
            burstShots: BURST_SHOTS,
            shotInterval: SHOT_INTERVAL,
            bulletSpeed: BULLET_SPEED,
            bulletDamage: BULLET_DAMAGE,
            rayHalfWidth: RAY_HALF_WIDTH,
            totalShots,
            pistols: pistols.map((pistol) => ({
              side: pistol.side,
              burstRemaining: pistol.burstRemaining,
              shots: pistol.shots,
              bursts: pistol.bursts
            }))
          };
        }
      };
    }
  };

  registerBall(revolverDefinition);
  return {
    revolverDefinition,
    REVOLVER_PISTOL_COOLDOWN: PISTOL_COOLDOWN,
    REVOLVER_BURST_SHOTS: BURST_SHOTS,
    REVOLVER_SHOT_INTERVAL: SHOT_INTERVAL,
    REVOLVER_BULLET_SPEED: BULLET_SPEED,
    REVOLVER_BULLET_DAMAGE: BULLET_DAMAGE,
    REVOLVER_RAY_HALF_WIDTH: RAY_HALF_WIDTH
  };
});
