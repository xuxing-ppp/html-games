(function initializeLiangchenIII(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js"), ...require("../core/contact-model.js"), ...require("./slash-tool.js") }
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiangchenIIIPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, firstSegmentCircleContact, createSlashEffect } = dependencies;

  const RULES = Object.freeze({
    bodyDamage: 4,
    boostBodyDamage: 16,
    boostSpeed: 750,
    boostInterval: 4,
    dropletInterval: 0.2,
    dropletSpeed: 300,
    dropletDamage: 1,
    dropletRadius: 2,
    dropletLife: 30,
    dropletArc: 90,
    reclaimHealChance: 0.75
  });
  const EPSILON = 1e-9;

  // 血滴细长拖尾（灭霸刀刃式）：沿速度方向从头部向后拉一条渐隐缎带，
  // 不是离散点——每帧在 draw 里直接沿运动向量铺渐窄渐隐的锥形。
  // 每个战场/时刻只扫描一次；敌我关系由每颗血滴自行判断，不能跨阵营或跨局缓存。
  const projectileCaches = new WeakMap();

  function projectilesForStep(game) {
    let cache = projectileCaches.get(game);
    if (!cache || cache.time !== game.time || cache.entities !== game.combatEntities) {
      cache = {
        time: game.time,
        entities: game.combatEntities,
        projectiles: game.combatEntities.filter(entity => entity && entity.isProjectile === true)
      };
      projectileCaches.set(game, cache);
    }
    return cache.projectiles;
  }

  // options（可选，缺省保持原有行为）：
  //   life              —— 覆盖寿命（良辰V·E 用"近乎无限"）
  //   passThroughOwner  —— 穿过本体：回血但不被消耗，离开后再次进入可再回一次
  //   shootable === false —— 关掉"被敌方子弹打散"
  //   inheritReclaim   —— 让命中敌人后弹出的子血滴继承 onReclaim（良辰V·E 用）
  function createBloodDroplet(x, y, vx, vy, fromEnemy, ignoreTargetId, onReclaim, options = {}) {
    const life = Number.isFinite(options.life) && options.life > 0
      ? options.life
      : RULES.dropletLife;
    const passThroughOwner = options.passThroughOwner === true;
    const shootable = options.shootable !== false;
    return {
      kind: "liangchen-iii-blood-droplet",
      life,
      damage: RULES.dropletDamage,
      radius: RULES.dropletRadius,
      x, y, vx, vy,
      fromEnemy: !!fromEnemy,
      // Optional emitter identity persists through one-for-one child drops.
      originTargetId: options.originTargetId || null,
      // 出生重叠保护：从敌方体内弹出的新滴需要飞出去，不能立刻重命中同一目标
      ignoreTargetId: ignoreTargetId || null,
      ignoreTargetFor: ignoreTargetId ? 0.3 : 0,
      update(context, dt) {
        const services = context.services;
        const arena = resolveArenaGeometry(context.game);
        const entity = context.entity;
        const r = entity.radius;

        // 弧线：垂直于速度方向的恒定侧向加速度
        const speed = Math.hypot(entity.vx, entity.vy) || 1;
        const px = -entity.vy / speed;
        const py = entity.vx / speed;
        entity.vx += px * RULES.dropletArc * dt;
        entity.vy += py * RULES.dropletArc * dt;
        const s2 = Math.hypot(entity.vx, entity.vy) || 1;
        entity.vx = entity.vx / s2 * RULES.dropletSpeed;
        entity.vy = entity.vy / s2 * RULES.dropletSpeed;

        const prevX = entity.x;
        const prevY = entity.y;
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;

        // 细长拖尾在 draw 里沿速度向量直接绘制（不做离散点）
        // 边界反弹
        const wall = arena.traceSegment(prevX, prevY, entity.x, entity.y, r);
        if (wall) {
          entity.x = wall.x; entity.y = wall.y;
          if (arena.shape !== "circle" && wall.normalX && wall.normalY) { entity.vx *= -1; entity.vy *= -1; }
          else {
            const dot = entity.vx * wall.normalX + entity.vy * wall.normalY;
            entity.vx -= 2 * dot * wall.normalX; entity.vy -= 2 * dot * wall.normalY;
          }
        }

        // 被敌方子弹打散（同丝状雷电）：血滴碎裂，那颗子弹也一并被打掉
        if (shootable) {
          for (const projectile of projectilesForStep(context.game)) {
            if (!projectile || projectile.isProjectile !== true || projectile.life <= 0
                || projectile.entityActive === false || !services.isEnemy(projectile)) continue;
            // 钩尖等不可攻击的附属武器并非普通子弹，血滴不能把整套攻击打断。
            if (projectile.targetable === false || projectile.indestructible === true) continue;
            if (Number.isFinite(projectile.age) && projectile.age >= projectile.life) continue;
            if (!Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) continue;
            const reach = r + (Number.isFinite(projectile.radius) ? projectile.radius : 3);
            if (firstSegmentCircleContact(
              prevX, prevY, entity.x, entity.y, projectile.x, projectile.y, reach
            ) === null) continue;
            projectile.life = 0;
            projectile.update = () => {};
            entity.entityActive = false;
            services.spawnParticleBurst({
              kind: "liangchen-iii-droplet-shatter",
              x: entity.x,
              y: entity.y,
              count: 10,
              minDiameter: 0.8,
              maxDiameter: 2.6,
              colors: ["#ff2038", "#960c04"],
              minSpeed: 40,
              maxSpeed: 130,
              drag: 3.6,
              life: 0.3
            });
            return;
          }
        }

        // 本体接触（用 ownerInstanceId 拿 owner ball）—— 出生宽限避开发射重叠
        const owner = services.getBall(entity.ownerInstanceId);
        if (owner && owner.hp > 0 && entity.age > 0.08) {
          const dx = owner.x - entity.x;
          const dy = owner.y - entity.y;
          const touching = dx * dx + dy * dy <= (owner.radius + r) * (owner.radius + r);
          if (passThroughOwner) {
            // 穿过本体：回血但不消耗，继续飞出去打人；离开后再进入才算新的一次
            if (touching) {
              if (entity.passedOwner !== true) {
                entity.passedOwner = true;
                if (typeof onReclaim === "function") {
                  onReclaim(owner, services);
                } else {
                  owner.hp = Math.min(owner.maxHp, owner.hp + 1);
                  services.spawnHitText(owner, "+1", { color: "#ff9a8f" });
                }
              }
            } else {
              entity.passedOwner = false;
            }
          } else if (touching) {
            entity.entityActive = false;
            if (Math.random() < RULES.reclaimHealChance) {
              if (typeof onReclaim === "function") {
                onReclaim(owner, services);
              } else {
                owner.hp = Math.min(owner.maxHp, owner.hp + 1);
                services.spawnHitText(owner, "+1", { color: "#ff9a8f" });
              }
            }
            return;
          }
        }

        // 命中敌方（出生期内跳过父目标）
        if (entity.ignoreTargetFor > 0) entity.ignoreTargetFor -= dt;
        let hit = services.getFirstEnemyHit(prevX, prevY, entity.x, entity.y, r);
        if (hit && entity.ignoreTargetFor > 0 && hit.instanceId === entity.ignoreTargetId) hit = null;
        if (hit) {
          services.dealDamage(hit, RULES.dropletDamage);
          // 每个滴只带出一次：防止指数连锁
          if (!entity._spawnedChild) {
            entity._spawnedChild = true;
            // 从敌方体内弹出新血滴，替代本次命中的血滴。
            const angle = Math.random() * Math.PI * 2;
            const ex = hit.x + Math.cos(angle) * (hit.radius + 1);
            const ey = hit.y + Math.sin(angle) * (hit.radius + 1);
            services.spawnProjectile(createBloodDroplet(
              ex, ey,
              Math.cos(angle) * RULES.dropletSpeed,
              Math.sin(angle) * RULES.dropletSpeed,
              true,
              hit.instanceId,
              options.inheritReclaim === true ? onReclaim : undefined,
              options
            ));
          }
          services.createVisualEffect(({ random }) => createSlashEffect(hit, {
            kind: "liangchen-iii-slash",
            fragmentColor: "#960c04",
            random
          }));
          entity.entityActive = false;
        }
      },
      draw({ entity: e }, ctx) {
        const r = e.radius;
        const sp = Math.hypot(e.vx, e.vy) || 1;
        const dx = e.vx / sp;
        const dy = e.vy / sp;
        // 拖尾长度随速度取，反方向延伸；细长、向后渐窄渐隐
        const tailLen = Math.min(18, 6 + sp * 0.02);
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(Math.atan2(dy, dx));
        // 缎带：头端接近本体半径，尾端收尖
        const headW = r * 0.85;
        const g = ctx.createLinearGradient(0, 0, -tailLen, 0);
        g.addColorStop(0, "rgba(200,20,40,0.55)");
        g.addColorStop(0.55, "rgba(160,10,30,0.28)");
        g.addColorStop(1, "rgba(120,4,20,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-r * 0.4, -headW);
        ctx.lineTo(-tailLen, -0.4);
        ctx.lineTo(-tailLen, 0.4);
        ctx.lineTo(-r * 0.4, headW);
        ctx.closePath();
        ctx.fill();
        // 本体血滴：小圆+中心亮点
        ctx.fillStyle = "#960c04";
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ff8a8a";
        ctx.beginPath();
        ctx.arc(-0.5, -0.6, r * 0.42, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    };
  }

  const liangchenIIIDefinition = {
    id: "liangchenIII",
    name: "良辰III",
    englishName: "Liangchen III",
    color: "#960c04",
    description: "4撞伤 / 每0.2s血滴(无数量上限/反弹弧线红尾/命中再弹射) / 收回75%回1血 / 每4s冲刺750速16撞伤",
    stats: { radius: 15, speed: 150, maxHp: 30 },
    createBehavior(services) {
      let dropletTimer = 0;
      let boostTimer = RULES.boostInterval;
      let boosting = false;
      let boostAge = 0;
      let boostTrail = null;   // 冲刺拖尾（与良辰II同款 afterimage）

      function isBoosting() { return boosting; }

      function emitDroplet(ball, context) {
        const enemy = services.getOpponent();
        if (!enemy) return;
        const angle = Math.atan2(enemy.y - ball.y, enemy.x - ball.x) + (Math.random() - 0.5) * 0.4;
        services.spawnProjectile(createBloodDroplet(
          ball.x, ball.y,
          Math.cos(angle) * RULES.dropletSpeed,
          Math.sin(angle) * RULES.dropletSpeed,
          false
        ));
      }

      function emitBoostTrail(ball) {
        if (!boostTrail || boostTrail.finished) return;
        boostTrail.emit(ball.x, ball.y, ball.radius, {
          heading: Math.atan2(ball.vy, ball.vx),
          speed: Math.hypot(ball.vx, ball.vy)
        });
      }

      function endBoostTrail() {
        if (boostTrail && !boostTrail.finished) boostTrail.end(true);
        boostTrail = null;
      }

      function startBoost(ball) {
        boosting = true;
        boostAge = 0;
        // 与良辰II同款冲刺拖尾
        boostTrail = services.spawnAfterimageTrail({
          kind: "liangchen-iii-boost-trail",
          color: "#960c04",
          maxAlpha: 0.5,
          sampleLife: 0.3,
          maxSamples: 20,
          sampleInterval: 0.015,
          speedFloor: ball.speed,
          speedRamp: RULES.boostSpeed - ball.speed
        }, { lifecycle: "owner-bound" });
        const enemy = services.getOpponent();
        const dx = enemy ? enemy.x - ball.x : 1;
        const dy = enemy ? enemy.y - ball.y : 0;
        const d = Math.hypot(dx, dy) || 1;
        // 直接给 storedVx/Vy（引擎下一步 normalize 会用 effectiveSpeed=speed*mult 覆盖大小）
        ball.storedVx = dx / d * RULES.boostSpeed;
        ball.storedVy = dy / d * RULES.boostSpeed;
        ball.speedNeedsNormalization = true;
        services.setSpeedMultiplier(RULES.boostSpeed / Math.max(1, ball.speed));
      }

      function stopBoost(ball) {
        boosting = false;
        boostTimer = RULES.boostInterval;
        services.setSpeedMultiplier(1);
        endBoostTrail();
      }

      return {
        update(context, dt) {
          const ball = context.ball;
          const arena = resolveArenaGeometry(context.game);
          if (!boosting) {
            dropletTimer += dt;
            if (dropletTimer >= RULES.dropletInterval) {
              dropletTimer -= RULES.dropletInterval;
              emitDroplet(ball, context);
            }
          }

          if (boosting) {
            boostAge += dt;
            emitBoostTrail(ball);
            const r = ball.radius;
            // 出生贴墙不算"撞到边缘"——冲刺启动后须先离开墙再判停
            if (boostAge > 0.05 &&
                !arena.contains(ball.x, ball.y, r + EPSILON * 2)) {
              stopBoost(ball);
            }
            // boostTimer 在冲刺期间不走，撞墙后才重新计4s
          } else {
            boostTimer -= dt;
            if (boostTimer <= EPSILON) startBoost(ball);
          }
        },
        updateWhilePaused() {},
        getNextTransitionIn() {
          if (boosting) return undefined;
          return Math.max(EPSILON, boostTimer);
        },
        onCollision(context, target) {
          context.services.dealDamage(target,
            boosting ? RULES.boostBodyDamage : RULES.bodyDamage);
        },
        onWallBounce(context) {
          if (boosting && boostAge > 0.05) stopBoost(context.ball);
        },
        onBorrowEnd() {
          dropletTimer = 0;
          boostTimer = RULES.boostInterval;
          boosting = false;
          endBoostTrail();
        },

        onDeath() {
          endBoostTrail();
        },
        getLiangchenIIIState() {
          return { dropletTimer, boostTimer, boosting };
        }
      };
    }
  };

  registerBall(liangchenIIIDefinition);
  return { liangchenIIIDefinition, LIANGCHEN_III_RULES: RULES, createBloodDroplet };
});
