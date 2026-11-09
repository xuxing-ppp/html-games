(function initializeSkyLantern(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSkyLanternPlugin({ resolveArenaGeometry, registerBall }) {
  // 小孔明灯参数（设定）：直径25→半径12.5，速度50，血量3，自扣1血/秒，
  // 每0.5s向随机方向吐一颗火苗，消失时一次性补发3颗。
  const LITTLE_RADIUS = 12.5;
  const LITTLE_SPEED = 50;
  const LITTLE_MAX_HP = 3;
  const LITTLE_DRAIN = 1;
  const LITTLE_FIRE_INTERVAL = 0.5;
  const LITTLE_DEATH_SHOTS = 3;
  const FLAME_SPEED = 20;
  const FLAME_RADIUS = 5;
  const FLAME_LIFE = 60; // 直到飞出场外才消失（20 速下足够横穿场地）
  const BURN_DURATION = 2;
  const BURN_TICK_DAMAGE = 3;
  const BURN_TICK_INTERVAL = 1;
  const SPAWN_CONE = Math.PI / 6; // ±15°，正上方的30度扇形
  const EPSILON = 1e-9;

  // 设定图配色：灯罩外沿偏红的橙、灯身亮橙、底部开口是暖黄火口。
  const LANTERN_EDGE = "#d94f04";
  const LANTERN_BODY = "#ff8103";
  const LANTERN_MOUTH = "#ffd166";
  const LANTERN_MOUTH_CORE = "#fff3c4";

  // 火苗：🔥 形始终朝上烧（尖端向上），焰心在外焰正下方，不随飞行方向旋转。
  function drawFlame(ctx, x, y, radius) {
    const r = Math.max(0.5, radius);
    ctx.save();
    ctx.translate(x, y);
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.5);
    ctx.quadraticCurveTo(r * 0.9, -r * 0.6, r * 0.75, r * 0.25);
    ctx.quadraticCurveTo(r * 0.65, r * 0.95, 0, r * 0.95);
    ctx.quadraticCurveTo(-r * 0.65, r * 0.95, -r * 0.75, r * 0.25);
    ctx.quadraticCurveTo(-r * 0.9, -r * 0.6, 0, -r * 1.5);
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 120, 10, 0.9)";
    ctx.fill();
    // 焰心在外焰正下方。
    ctx.beginPath();
    ctx.ellipse(0, r * 0.55, r * 0.42, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#ffd166";
    ctx.fill();
    ctx.restore();
  }

  // 孔明灯灯罩：梯形（上宽下窄、顶角略尖）+ 底部发光火口。大小由 r 归一化，
  // 本体和小孔明灯共用。
  function drawLantern(ctx, x, y, r) {
    const topW = r * 1.7;
    const botW = r * 1.05;
    const h = r * 1.75;
    const top = -h * 0.52;
    const bottom = h * 0.48;
    const corner = r * 0.18;
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(-topW / 2, top + corner);
    ctx.lineTo(-topW / 2 + corner, top);
    ctx.lineTo(topW / 2 - corner, top);
    ctx.lineTo(topW / 2, top + corner);
    ctx.lineTo(botW / 2, bottom);
    ctx.lineTo(-botW / 2, bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, "#ffab4a");
    grad.addColorStop(0.55, LANTERN_BODY);
    grad.addColorStop(1, "#e06a02");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = LANTERN_EDGE;
    ctx.lineWidth = Math.max(0.6, r * 0.09);
    ctx.stroke();
    ctx.strokeStyle = "rgba(180, 80, 10, 0.45)";
    ctx.lineWidth = Math.max(0.4, r * 0.06);
    for (const frac of [-0.35, 0, 0.35]) {
      const xt = (topW / 2) * frac;
      const xb = (botW / 2) * frac;
      ctx.beginPath();
      ctx.moveTo(xt, top + corner * 0.6);
      ctx.lineTo(xb, bottom);
      ctx.stroke();
    }
    const mw = botW * 0.9;
    const mh = r * 0.5;
    const my = bottom - mh * 0.15;
    const mouthGrad = ctx.createRadialGradient(0, my, 0, 0, my, mw * 0.6);
    mouthGrad.addColorStop(0, LANTERN_MOUTH_CORE);
    mouthGrad.addColorStop(0.6, LANTERN_MOUTH);
    mouthGrad.addColorStop(1, "rgba(255, 160, 40, 0)");
    ctx.fillStyle = mouthGrad;
    ctx.beginPath();
    ctx.ellipse(0, my, mw / 2, mh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 火焰弹：命中只挂灼烧（dot 走效果绑定服务），攻击值不定即无直接命中伤害。
  function createFlame(x, y, angle, ownerInstanceId, shotIndex) {
    const vx = Math.cos(angle) * FLAME_SPEED;
    const vy = Math.sin(angle) * FLAME_SPEED;
    return {
      kind: "sky-lantern-flame",
      x,
      y,
      vx,
      vy,
      radius: FLAME_RADIUS,
      life: FLAME_LIFE,
      hit: false,
      update({ effect, game, services: entityServices }, dt) {
        if (effect.hit) {
          effect.life = 0;
          return;
        }
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const hit = entityServices.getFirstEnemyHit(
          startX, startY, effect.x, effect.y, effect.radius
        );
        if (hit) {
          effect.hit = true;
          if (hit.hp > 0) {
            entityServices.applyEffect(hit, {
              id: `sky-lantern-burn-${ownerInstanceId}-${shotIndex}`,
              attackTags: ["heat"],
              duration: BURN_DURATION,
              tickTimer: 0,
              update({ ball: target, effect: burn, services: effectServices }, step) {
                burn.tickTimer += step;
                while (burn.tickTimer >= BURN_TICK_INTERVAL) {
                  burn.tickTimer -= BURN_TICK_INTERVAL;
                  effectServices.dealDamage(target, BURN_TICK_DAMAGE);
                }
              },
              draw({ ball: target, game: g }, context) {
                const flicker = 0.75 + 0.25 * Math.sin(g.time * 25);
                context.save();
                context.translate(target.x, target.y);
                context.globalCompositeOperation = "lighter";
                context.fillStyle = `rgba(255, 129, 3, ${0.45 * flicker})`;
                context.beginPath();
                context.arc(0, 0, target.radius * 1.15, 0, Math.PI * 2);
                context.fill();
                context.restore();
              }
            });
          }
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, 32)
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, context) {
        drawFlame(context, effect.x, effect.y, effect.radius);
      }
    };
  }

  function randomDirection() {
    return Math.random() * Math.PI * 2;
  }

  // 小孔明灯：独立战斗单位（可被攻击），自动掉血；计时吐火苗。
  function createLittleLanternDefinition(ownerInstanceId) {
    return {
      id: "skyLanternLittle",
      name: "小孔明灯",
      color: LANTERN_BODY,
      stats: { radius: LITTLE_RADIUS, speed: LITTLE_SPEED, maxHp: LITTLE_MAX_HP },
      createBehavior(services) {
        let fireTimer = LITTLE_FIRE_INTERVAL;
        let drainAcc = 0;
        let shotIndex = 0;
        function shoot(ball) {
          shotIndex += 1;
          services.spawnProjectile(
            createFlame(ball.x, ball.y, randomDirection(), ownerInstanceId, ball.instanceId + "-" + shotIndex)
          );
        }
        return {
          update({ ball }, dt) {
            drainAcc += Math.max(0, dt);
            while (drainAcc >= 1) {
              drainAcc -= 1;
              ball.hp -= LITTLE_DRAIN; // 自扣血：直接改 hp（非伤害，不走 dealDamage）
            }
            fireTimer -= Math.max(0, dt);
            while (fireTimer <= EPSILON) {
              fireTimer += LITTLE_FIRE_INTERVAL;
              shoot(ball);
            }
          },
          getNextTransitionIn() {
            return Math.max(EPSILON, Math.min(fireTimer, 1 - drainAcc));
          },
          onDeath({ ball }) {
            for (let i = 0; i < LITTLE_DEATH_SHOTS; i += 1) shoot(ball);
          },
          drawBody({ ball }, ctx) {
            drawLantern(ctx, ball.x, ball.y, ball.radius);
            return true;
          }
        };
      }
    };
  }

  const skyLanternDefinition = {
    id: "skyLantern",
    name: "孔明灯",
    englishName: "Sky Lantern",
    color: "#ff8103",
    description: "碰下边缘弹出小孔明灯（HP3/自扣1/每0.5s随机吐火苗/死亡补发3颗），火苗命中灼烧2秒每秒3伤",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      return {
        // 本体不再发射火苗；只有碰到战场下边缘时在触碰点上浮一个小孔明灯。
        onWallBounce({ ball, game, bouncedY, wallContacts }) {
          const contact = wallContacts && wallContacts.find(wall => wall.normalY < -EPSILON && Math.abs(wall.normalY) >= Math.abs(wall.normalX));
          if (!contact && !bouncedY) return;
          const bottom = resolveArenaGeometry(game).bottom;
          if (!contact && ball.y < bottom - ball.radius - 2) return; // 顶边，不是下边
          const angle = -Math.PI / 2 + (Math.random() * 2 - 1) * SPAWN_CONE;
          services.spawnSummon(
            createLittleLanternDefinition(ball.instanceId),
            {
              ...resolveArenaGeometry(game).clampPoint(contact ? contact.x : ball.x,
                contact ? contact.y : bottom - LITTLE_RADIUS, LITTLE_RADIUS), // 贴着下边缘浮出
              vx: Math.cos(angle) * LITTLE_SPEED,
              vy: Math.sin(angle) * LITTLE_SPEED
            }
          );
          services.playSound("summon", { kind: "sky-lantern-little" });
        },
        drawBody({ ball }, ctx) {
          drawLantern(ctx, ball.x, ball.y, ball.radius);
          return true;
        }
      };
    }
  };

  registerBall(skyLanternDefinition);
  return { skyLanternDefinition, createLittleLanternDefinition };
});
