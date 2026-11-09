(function initializeGreyDeer(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGreyDeerPlugin({ registerBall }) {
  // 每 2 秒把自己的 7 点血量打出去。
  const FIRE_INTERVAL = 2;
  const FIRE_COST = 7;
  // 打出去的小球：直径 20、速度 200、开局 7 血，场上最多 2 个。
  const SHARD_RADIUS = 10;
  const SHARD_SPEED = 200;
  const SHARD_MAX_HP = 7;
  const MAX_SHARDS = 2;
  const SHARD_SPAWN_OFFSET = 4;
  const ABSORB_TOLERANCE = 0.5;
  const GREY_DEER_COLOR = "#8f959a";
  const SHARD_COLOR = "#b8bec2";
  const SHARD_COLORS = Object.freeze(["#c6ccd0", "#b8bec2", "#9aa0a4"]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

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

  function spawnShardBurst(services, x, y, count) {
    services.spawnParticleBurst({
      x,
      y,
      count,
      colors: SHARD_COLORS,
      minDiameter: 1,
      maxDiameter: 2.6,
      minSpeed: 24,
      maxSpeed: 90,
      life: 0.36,
      drag: 3.2
    });
  }

  // 放出：本体边缘朝发射方向扩散的弧 + 向外流出的粒子。
  function createReleaseEffect(x, y, radius, directionX, directionY) {
    return {
      kind: "grey-deer-release",
      life: 0.4,
      x,
      y,
      radius,
      directionX,
      directionY,
      draw({ effect }, context) {
        const progress = Math.min(1, effect.age / effect.life);
        const angle = Math.atan2(effect.directionY, effect.directionX);
        context.save();
        context.translate(effect.x, effect.y);
        context.globalAlpha *= (1 - progress) * 0.85;
        context.strokeStyle = "#d7dde1";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(
          0,
          0,
          effect.radius + 3 + progress * 26,
          angle - 0.55,
          angle + 0.55
        );
        context.stroke();
        context.globalAlpha *= 0.75;
        context.strokeStyle = "#9aa0a4";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(0, 0, Math.max(2, effect.radius * (1 - progress)), 0, TWO_PI);
        context.stroke();
        context.restore();
      }
    };
  }

  function spawnReleaseParticles(services, x, y, directionX, directionY) {
    services.spawnParticleBurst({
      x,
      y,
      count: 10,
      colors: SHARD_COLORS,
      minDiameter: 1,
      maxDiameter: 2.6,
      minSpeed: 80,
      maxSpeed: 170,
      directionAngle: Math.atan2(directionY, directionX),
      directionSpread: 0.6,
      life: 0.35,
      drag: 2.2
    });
  }

  // 收回：干脆的"一收即合"——全程不渐隐，0.18 秒内硬边收束，
  // 到位瞬间整段消失，读起来是吸回而不是慢慢淡出。
  function createRecallEffect(x, y, radius) {
    return {
      kind: "grey-deer-recall",
      life: 0.18,
      x,
      y,
      radius,
      draw({ effect }, context) {
        const progress = Math.min(1, effect.age / effect.life);
        const approach = 1 - progress;
        context.save();
        context.translate(effect.x, effect.y);

        // 硬边收束环
        context.globalAlpha *= 0.95;
        context.strokeStyle = "#eef2f4";
        context.lineWidth = 1.6 + approach * 1.6;
        context.beginPath();
        context.arc(0, 0, effect.radius + 24 * approach, 0, TWO_PI);
        context.stroke();

        // 八条向内滑动的短线：滑到本体边缘就随特效一起消失
        context.strokeStyle = "#c6ccd0";
        context.lineWidth = 1.6;
        for (let index = 0; index < 8; index += 1) {
          const angle = index / 8 * TWO_PI;
          const directionX = Math.cos(angle);
          const directionY = Math.sin(angle);
          const outer = effect.radius + 30 * approach;
          const inner = effect.radius + 5 * approach;
          context.beginPath();
          context.moveTo(directionX * outer, directionY * outer);
          context.lineTo(directionX * inner, directionY * inner);
          context.stroke();
        }

        // 落定闪光：后半段才出现，结束时整帧消失（不淡出）
        if (progress > 0.45) {
          context.fillStyle = "#ffffff";
          context.beginPath();
          context.arc(0, 0, 3.4, 0, TWO_PI);
          context.fill();
        }
        context.restore();
      }
    };
  }

  function createGreyDeerShardDefinition() {
    return {
      id: "grey-deer-shard",
      name: "灰鹿血球",
      englishName: "Grey Deer Shard",
      color: SHARD_COLOR,
      description: "灰鹿打出的血量：撞击造成自身血量的伤害",
      stats: {
        radius: SHARD_RADIUS,
        speed: SHARD_SPEED,
        maxHp: SHARD_MAX_HP
      },
      createBehavior(services) {
        let parent = null;
        let self = null;
        let contactTargets = new Set();

        function rememberParent(context) {
          const ball = context.ball;
          self = ball;
          if (!parent && ball.summonerInstanceId) {
            parent = services.getBall(ball.summonerInstanceId);
          }
          return ball;
        }

        return {
          onSpawn(context) {
            rememberParent(context);
          },
          update(context) {
            const ball = rememberParent(context);
            if (!parent || parent.hp <= 0 || parent.active === false) return;
            const distance = Math.hypot(parent.x - ball.x, parent.y - ball.y);
            if (distance > parent.radius + ball.radius + ABSORB_TOLERANCE) return;
            // 回到本体：血球消失，本体回复它剩下的血量。
            parent.hp = Math.min(parent.maxHp, parent.hp + Math.max(0, ball.hp));
            services.spawnVisualEffect(createRecallEffect(parent.x, parent.y, parent.radius));
            // 血球是被"吸收"的，不是被打死的：跳过引擎的死亡渐隐
            // （默认会在原地慢慢淡出 1.1 秒，和"一收即合"的收回特效对不上，
            //   而且合并的瞬间它就已经变成本体血量了）。
            ball.hp = 0;
            ball.fade = 0;
            ball.deathNotified = true;
            ball.diedAt = null;
          },
          // 免伤：血球只会因为"撞到敌人"掉血，任何外来伤害都打不动它。
          onBeforeDamage() {
            return { amount: 0, showHitText: false };
          },
          // 用 onContactUpdate 而不是 onCollision：碰撞伤害是"先手"结算，
          // 否则遇到高伤害的碰撞出伤球时，血球会在还手之前先被打死、伤害打不出去。
          onContactUpdate(context, target) {
            if (!target || target.hp <= 0) return;
            const ball = context.ball;
            const key = target.instanceId;
            const distance = Math.hypot(target.x - ball.x, target.y - ball.y);
            if (distance > ball.radius + target.radius) {
              contactTargets.delete(key);
              return;
            }
            if (contactTargets.has(key)) return;
            contactTargets.add(key);
            const damage = Math.max(0, Math.round(ball.hp));
            if (damage <= 0) return;
            context.services.dealDamage(target, damage);
            // 撞击之后自身血量 -1，所以下一次伤害也跟着 -1。
            ball.hp = Math.max(0, ball.hp - 1);
            spawnShardBurst(
              context.services,
              (ball.x + target.x) / 2,
              (ball.y + target.y) / 2,
              8
            );
          },
          getGreyDeerShardState() {
            const hp = self && Number.isFinite(self.hp) ? self.hp : 0;
            return {
              hp,
              maxHp: SHARD_MAX_HP,
              collisionDamage: Math.max(0, Math.round(hp))
            };
          }
        };
      }
    };
  }

  const greyDeerDefinition = {
    id: "greyDeer",
    name: "灰鹿",
    englishName: "Grey Deer",
    color: GREY_DEER_COLOR,
    description: "每 2 秒打出 7 点血量 / 血球撞击伤害等于自身血量 / 回体回血",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services) {
      let ownerBall = null;
      let fireTimer = 0;

      function livingShards() {
        return services.getSummons("grey-deer-shard").filter((shard) => shard.hp > 0);
      }

      function fire(context) {
        const ball = context.ball;
        // 不能把最后一口气打出去，也受"场上最多 2 个"限制。
        if (ball.hp <= FIRE_COST) return false;
        if (livingShards().length >= MAX_SHARDS) return false;
        const target = services.getOpponent();
        const direction = target
          ? normalizeDirection(target.x - ball.x, target.y - ball.y)
          : normalizeDirection(ball.storedVx || ball.vx, ball.storedVy || ball.vy);
        ball.hp = Math.max(1, ball.hp - FIRE_COST);
        const offset = ball.radius + SHARD_RADIUS + SHARD_SPAWN_OFFSET;
        const vx = direction.x * SHARD_SPEED;
        const vy = direction.y * SHARD_SPEED;
        services.spawnSummon(createGreyDeerShardDefinition(), {
          x: ball.x + direction.x * offset,
          y: ball.y + direction.y * offset,
          vx,
          vy,
          storedVx: vx,
          storedVy: vy
        });
        services.spawnVisualEffect(
          createReleaseEffect(ball.x, ball.y, ball.radius, direction.x, direction.y)
        );
        spawnReleaseParticles(
          services,
          ball.x + direction.x * (ball.radius + 2),
          ball.y + direction.y * (ball.radius + 2),
          direction.x,
          direction.y
        );
        return true;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          fireTimer = 0;
        },
        update(context, dt) {
          ownerBall = context.ball;
          fireTimer += Math.max(0, dt);
          while (fireTimer + EPSILON >= FIRE_INTERVAL) {
            fireTimer -= FIRE_INTERVAL;
            fire(context);
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, FIRE_INTERVAL - fireTimer);
        },
        getGreyDeerState() {
          const shards = livingShards();
          return {
            fireTimer,
            nextFireIn: Math.max(0, FIRE_INTERVAL - fireTimer),
            fireInterval: FIRE_INTERVAL,
            fireCost: FIRE_COST,
            maxShards: MAX_SHARDS,
            shards: shards.length,
            shardHp: shards.map((shard) => shard.hp)
          };
        }
      };
    }
  };

  registerBall(greyDeerDefinition);
  return {
    greyDeerDefinition,
    createGreyDeerShardDefinition,
    GREY_DEER_FIRE_INTERVAL: FIRE_INTERVAL,
    GREY_DEER_FIRE_COST: FIRE_COST,
    GREY_DEER_MAX_SHARDS: MAX_SHARDS,
    GREY_DEER_SHARD_MAX_HP: SHARD_MAX_HP
  };
});
