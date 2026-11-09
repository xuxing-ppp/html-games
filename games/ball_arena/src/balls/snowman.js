(function initializeSnowman(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSnowmanPlugin({ resolveArenaGeometry, registerBall }) {
  const BODY_COLOR = "#ffffff";
  const MINION_RADIUS = 7;
  const MINION_MAX_HP = 5;
  const FIRE_INTERVAL = 0.5;
  const SNOWBALL_SPEED = 300;
  const SNOWBALL_RADIUS = 3;
  const SNOWBALL_DAMAGE = 1;
  const SHOT_COST = 1;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // 小雪人：与截图一致的纯白小球，开火时整体朝反方向轻微后坐
  function drawSmallSnowman(ball, canvasContext, aimAngle = 0, recoil = 0) {
    const recoilOffsetX = -Math.cos(aimAngle) * recoil * 1.2;
    const recoilOffsetY = -Math.sin(aimAngle) * recoil * 1.2;
    canvasContext.save();
    canvasContext.translate(recoilOffsetX, recoilOffsetY);
    canvasContext.fillStyle = BODY_COLOR;
    canvasContext.strokeStyle = "#9aa7b3";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.arc(ball.x, ball.y, ball.radius, 0, TWO_PI);
    canvasContext.fill();
    canvasContext.stroke();
    canvasContext.restore();
  }

  function drawSnowball(entity, canvasContext) {
    canvasContext.save();
    // 短白尾迹：沿着飞行方向拖出一道雪痕
    const trail = 0.035;
    const tailX = entity.x - entity.vx * trail;
    const tailY = entity.y - entity.vy * trail;
    canvasContext.strokeStyle = "rgba(255, 255, 255, 0.45)";
    canvasContext.lineWidth = entity.radius * 1.3;
    canvasContext.lineCap = "round";
    canvasContext.beginPath();
    canvasContext.moveTo(tailX, tailY);
    canvasContext.lineTo(entity.x, entity.y);
    canvasContext.stroke();

    canvasContext.fillStyle = "#ffffff";
    canvasContext.strokeStyle = "#b9c6d2";
    canvasContext.lineWidth = 0.8;
    canvasContext.beginPath();
    canvasContext.arc(entity.x, entity.y, entity.radius, 0, TWO_PI);
    canvasContext.fill();
    canvasContext.stroke();
    canvasContext.restore();
  }

  // 落雪/击中/消散用的白色雪雾粒子
  function createSnowPuffEffect(x, y, scale = 1) {
    const particles = Array.from({ length: 10 }, (_value, index) => {
      const angle = index / 10 * TWO_PI + Math.random() * 0.4;
      return {
        angle,
        speed: (18 + Math.random() * 20) * scale,
        radius: 1.2 + Math.random() * 1.8
      };
    });
    return {
      kind: "snowman-snow-puff",
      life: 0.32,
      x,
      y,
      particles,
      update({ effect }, dt) {
        for (const particle of effect.particles) {
          particle.angle += dt * 2;
        }
      },
      draw({ effect }, context) {
        const progress = effect.age / effect.life;
        context.save();
        context.globalAlpha = 1 - progress;
        context.fillStyle = "#ffffff";
        for (const particle of effect.particles) {
          const distance = particle.speed * effect.age;
          context.beginPath();
          context.arc(
            effect.x + Math.cos(particle.angle) * distance,
            effect.y + Math.sin(particle.angle) * distance,
            particle.radius * (1 - progress * 0.5),
            0,
            TWO_PI
          );
          context.fill();
        }
        context.restore();
      }
    };
  }

  function createSnowball(x, y, directionX, directionY) {
    return {
      kind: "snowman-snowball",
      combatKind: "projectile",
      life: 2.5,
      radius: SNOWBALL_RADIUS,
      x,
      y,
      vx: directionX * SNOWBALL_SPEED,
      vy: directionY * SNOWBALL_SPEED,
      update({ entity, game, services: entityServices }, dt) {
        const startX = entity.x;
        const startY = entity.y;
        entity.x += entity.vx * dt;
        entity.y += entity.vy * dt;
        const hit = entityServices.getFirstEnemyHit(
          startX,
          startY,
          entity.x,
          entity.y,
          entity.radius
        );
        if (hit && entityServices.dealDamage(hit, SNOWBALL_DAMAGE)) {
          // 统一粒子接口：雪球命中时碎裂
          entityServices.spawnParticleBurst({
            x: entity.x,
            y: entity.y,
            colors: ["#ffffff", "#dce9f7"],
            minDiameter: 1,
            maxDiameter: 4,
            minSpeed: 32,
            maxSpeed: 96,
            life: 0.5,
            density: 0.8,
            ring: {
              color: "#ffffff",
              startRadius: 3,
              endRadius: 16,
              lineWidth: 1.2
            }
          });
          entity.entityActive = false;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(entity.x, entity.y, 12)
        ) {
          entity.entityActive = false;
        }
      },
      draw({ entity }, canvasContext) {
        drawSnowball(entity, canvasContext);
      }
    };
  }

  function createSmallSnowmanDefinition() {
    return {
      id: "snowman-minion",
      elementTags: Object.freeze(["cold"]),
      name: "小雪人",
      englishName: "Small Snowman",
      color: BODY_COLOR,
      description: "每次射击消耗 1 点自身血量",
      stats: { radius: MINION_RADIUS, speed: 1, maxHp: MINION_MAX_HP },
      createBehavior(services) {
        let fireTimer = 0;
        let aimAngle = 0;
        let recoil = 0;

        return {
          onSpawn(context) {
            // 小雪人保持静止：拥有碰撞体积但不主动移动
            services.setMovementLocked(true);
            services.spawnVisualEffect(createSnowPuffEffect(
              context.ball.x,
              context.ball.y,
              0.8
            ));
          },
          update(context, dt) {
            recoil = Math.max(0, recoil - dt * 8);
            fireTimer += dt;
            const target = services.getOpponent();
            if (target && Math.hypot(target.x - context.ball.x, target.y - context.ball.y) > EPSILON) {
              aimAngle = Math.atan2(target.y - context.ball.y, target.x - context.ball.x);
            }
            if (fireTimer + EPSILON < FIRE_INTERVAL) return;
            fireTimer = 0;
            if (!target) return;
            // Anchored enemies can share this summon’s centre. Keep the last
            // heading there: the swept hit handles the starting overlap, and
            // the projectile still satisfies the non-zero velocity contract.
            services.spawnProjectile(createSnowball(
              context.ball.x,
              context.ball.y,
              Math.cos(aimAngle),
              Math.sin(aimAngle)
            ));
            recoil = 1;
            // 每发射一颗雪球，自身扣 1 血
            services.dealDamage(
              context.ball,
              SHOT_COST,
              context.ball,
              { showHitText: false }
            );
          },
          getNextTransitionIn() {
            return Math.max(EPSILON, FIRE_INTERVAL - fireTimer);
          },
          getContactProfile() {
            // 有碰撞体积、可被攻击，但自身没有碰撞伤害
            return { solid: true, attackable: true };
          },
          drawBody(context, canvasContext) {
            drawSmallSnowman(context.ball, canvasContext, aimAngle, recoil);
            return true;
          },
          onDeath(context) {
            services.spawnVisualEffect(createSnowPuffEffect(
              context.ball.x,
              context.ball.y,
              1.4
            ));
          }
        };
      }
    };
  }

  const snowmanDefinition = {
    id: "snowman",
    elementTags: Object.freeze(["cold"]),
    name: "雪人",
    englishName: "Snowman",
    color: BODY_COLOR,
    description: "碰撞/碰边布置小雪人 / 小雪人发射雪球并自损",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      function isStunned(context) {
        const now = context.game ? context.game.time : 0;
        const effects = context.ball.effects;
        if (!(effects instanceof Map)) return false;
        for (const effect of effects.values()) {
          if (
            effect && effect.expiresAt > now &&
            (effect.pausesBehavior === true || effect.preventsAttack === true)
          ) {
            return true;
          }
        }
        return false;
      }

      function contactPoint(context) {
        const contact = context.contact;
        if (!contact) {
          return { x: context.ball.x, y: context.ball.y };
        }
        const penetration = Number.isFinite(contact.penetration)
          ? contact.penetration
          : 0;
        return {
          x: contact.actor.x + contact.normalX * (contact.actor.radius - penetration / 2),
          y: contact.actor.y + contact.normalY * (contact.actor.radius - penetration / 2)
        };
      }

      function placeSnowman(context, x, y) {
        // spawnSummon 自身会把中心钳制在 [radius, arena - radius]，
        // 这里再钳一次，确保板边触发时小雪人整体可见
        const arenaSize = context.game;
        const { x: spawnX, y: spawnY } = resolveArenaGeometry(arenaSize).clampPoint(x, y, MINION_RADIUS);
        services.spawnVisualEffect(createSnowPuffEffect(spawnX, spawnY, 1));
        services.spawnSummon(createSmallSnowmanDefinition(), {
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
          storedVx: 0,
          storedVy: 0
        });
      }

      return {
        onCollision(context) {
          if (context.blockedAtContact || isStunned(context)) return;
          const point = contactPoint(context);
          placeSnowman(context, point.x, point.y);
        },
        onWallBounce(context) {
          if (isStunned(context)) return;
          placeSnowman(context, context.ball.x, context.ball.y);
        }
      };
    }
  };

  registerBall(snowmanDefinition);
  return { snowmanDefinition, createSmallSnowmanDefinition };
});
