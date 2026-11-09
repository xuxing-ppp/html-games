(function initializeApple(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createApplePlugin({ registerBall, createArenaGeometry }) {
  const DROP_INTERVAL = 0.8;
  const APPLE_RADIUS = 12.5;
  const APPLE_VISIBLE_LIFE = 3.5;
  const APPLE_FADE_LIFE = 0.5;
  const APPLE_LIFE = APPLE_VISIBLE_LIFE + APPLE_FADE_LIFE;
  // 果柄和叶片最高点约在圆心上方15.5，留出边距让整颗苹果都落在场内。
  const SPAWN_MARGIN = APPLE_RADIUS + 4;
  const ENEMY_BITE_DAMAGE = 5;
  const ALLY_BITE_HEALING = 3;
  const BITE_EFFECT_DURATION = 1;
  const ENEMY_SLOW_FACTOR = 0.75;
  const ALLY_BOOST_FACTOR = 1.5;
  const TRAIL_MAX_ALPHA = 0.4;
  // 两倍速(150x2=300)下残影存活1/6秒，拖尾长度约50。
  const TRAIL_SAMPLE_LIFE = 1 / 6;
  const ENEMY_BITE_COLORS = ["#49d95f", "#a6ffb8", "#eafff0"];
  const ALLY_BITE_COLORS = ["#ff5148", "#ffd9d4", "#ffffff"];
  const EPSILON = 1e-9;

  // 减速与加速都只是效果上的 speedFactor，由引擎统一合成：不再需要下面
  // 每个效果各自维护的"基线倍率 / 后来者 rebase"补丁，因子是可交换的乘法。
  function createSlowEffect() {
    return {
      id: "apple-slow",
      duration: BITE_EFFECT_DURATION,
      speedFactor: ENEMY_SLOW_FACTOR
    };
  }

  function syncBiteTrail(ball, effect, services) {
    if (!effect.trail || effect.trail.finished) {
      effect.trail = services.spawnAfterimageTrail({
        kind: "apple-speed-trail",
        color: "#ff0000",
        maxAlpha: TRAIL_MAX_ALPHA,
        sampleLife: TRAIL_SAMPLE_LIFE
      });
    }
    effect.trail.emit(ball.x, ball.y, ball.radius, {
      heading: Math.atan2(ball.vy, ball.vx),
      speed: Math.hypot(ball.vx, ball.vy)
    });
  }

  function createBoostEffect() {
    return {
      id: "apple-boost",
      duration: BITE_EFFECT_DURATION,
      speedFactor: ALLY_BOOST_FACTOR,
      onApply({ ball, effect, services }) {
        syncBiteTrail(ball, effect, services);
      },
      update({ ball, effect, services }) {
        syncBiteTrail(ball, effect, services);
      },
      onExpire({ effect }) {
        // 软收尾：已落下的残影按 1/6 秒寿命自然散尽。
        if (effect.trail) effect.trail.end(false);
      }
    };
  }

  function spawnBiteBurst(appleServices, x, y, kind, colors, options) {
    appleServices.spawnParticleBurst({
      kind,
      x,
      y,
      colors,
      density: 0.6,
      ...options
    });
  }

  function touchesApple(effect, target) {
    return Boolean(
      target && target.hp > 0 &&
      Math.hypot(target.x - effect.x, target.y - effect.y) <=
        target.radius + APPLE_RADIUS + EPSILON
    );
  }

  function eatAsAlly(effect, target, appleServices) {
    if (!touchesApple(effect, target)) return false;
    effect.entityActive = false;
    target.hp += ALLY_BITE_HEALING;
    appleServices.spawnHitText(target, `+${ALLY_BITE_HEALING}`, { color: "#ff8a7a" });
    // 己方增益必须走吃到者自己的 services：applyEffect 只放行自身效果与敌方效果。
    target.services.applyEffect(target, createBoostEffect());
    spawnBiteBurst(appleServices, effect.x, effect.y, "apple-ally-bite", ALLY_BITE_COLORS, {
      minDiameter: 1.5,
      maxDiameter: 4,
      minSpeed: 20,
      maxSpeed: 60,
      initialRadius: 2,
      life: 0.55
    });
    return true;
  }

  function eatAsEnemy(effect, target, appleServices) {
    if (!touchesApple(effect, target)) return false;
    effect.entityActive = false;
    appleServices.dealDamage(target, ENEMY_BITE_DAMAGE);
    if (target.hp > 0) appleServices.applyEffect(target, createSlowEffect());
    spawnBiteBurst(appleServices, effect.x, effect.y, "apple-enemy-bite", ENEMY_BITE_COLORS, {
      // 绿白色大颗粒、小范围慢速散开。
      minDiameter: 3,
      maxDiameter: 6,
      minSpeed: 10,
      maxSpeed: 30,
      initialRadius: 3,
      life: 0.7
    });
    return true;
  }

  function createApple(x, y) {
    return {
      kind: "apple-pickup",
      combatKind: "zone",
      life: APPLE_LIFE,
      radius: APPLE_RADIUS,
      x,
      y,
      update({ effect, services: appleServices }) {
        if (effect.entityActive === false) return;
        // 己方优先：投放者自己 → 队友 → 敌人；任何人咬到苹果即消失。
        if (eatAsAlly(effect, appleServices.getBall(effect.ownerInstanceId), appleServices)) {
          return;
        }
        let consumed = false;
        appleServices.forEachAlly((target) => {
          if (consumed) return;
          consumed = eatAsAlly(effect, target, appleServices);
        });
        if (consumed) return;
        appleServices.forEachEnemy((target) => {
          if (consumed) return;
          consumed = eatAsEnemy(effect, target, appleServices);
        });
      },
      draw({ effect }, context) {
        drawApple(effect, context);
      }
    };
  }

  function drawApple(effect, context) {
    const remaining = effect.life - effect.age;
    const fade = remaining >= APPLE_FADE_LIFE
      ? 1
      : Math.max(0, remaining / APPLE_FADE_LIFE);
    context.save();
    context.globalAlpha *= fade;
    context.fillStyle = "#7c4a1e";
    context.fillRect(
      Math.round(effect.x - 1),
      Math.round(effect.y - APPLE_RADIUS - 3),
      2,
      5
    );
    context.fillStyle = "#3fae4a";
    context.beginPath();
    context.ellipse(
      effect.x + 4,
      effect.y - APPLE_RADIUS - 1.5,
      3.4,
      1.8,
      -0.5,
      0,
      Math.PI * 2
    );
    context.fill();
    context.fillStyle = "#ff0000";
    context.beginPath();
    context.arc(effect.x, effect.y, APPLE_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#b30000";
    context.lineWidth = 1.2;
    context.stroke();
    context.globalAlpha *= 0.55;
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.ellipse(
      effect.x - 4,
      effect.y - 4.5,
      2.6,
      1.6,
      -0.7,
      0,
      Math.PI * 2
    );
    context.fill();
    context.restore();
  }

  const appleDefinition = {
    id: "apple",
    name: "\u82f9\u679c",
    englishName: "Apple",
    color: "#ff0000",
    description: "每0.8秒随机空投苹果 / 3.5秒后渐隐消失 / 敌方吃-5减速25%1秒 / 己方吃+3加速1.5倍1秒",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: DROP_INTERVAL,
    createBehavior(services) {
      let timer = 0;
      const apples = [];
      return {
        onAttackBorrowStart(context) { timer = DROP_INTERVAL; this.afterUpdateStep(context); },
        isAttackCycleComplete() { return apples.length > 0; },
        update(_context, dt) {
          timer = Math.min(DROP_INTERVAL, timer + Math.max(0, dt));
          for (let index = apples.length - 1; index >= 0; index -= 1) {
            if (apples[index].entityActive === false) apples.splice(index, 1);
          }
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, DROP_INTERVAL - timer);
        },
        afterUpdateStep(context) {
          if (timer + EPSILON < DROP_INTERVAL) return;
          timer = 0;
          const arena = context.game.arena || createArenaGeometry(context.game.arenaSize);
          const point = arena.samplePoint(Math.random, SPAWN_MARGIN);
          const { x, y } = point;
          apples.push(services.spawnCombatEntity(createApple(x, y)));
        }
      };
    }
  };

  registerBall(appleDefinition);
  return { appleDefinition };
});
