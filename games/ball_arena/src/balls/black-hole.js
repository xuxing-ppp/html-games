(function initializeBlackHole(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBlackHolePlugin({ registerBall, createArenaGeometry }) {
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  const HOLE_INTERVAL = 2;              // 每 2 秒召唤一个黑洞
  const HOLE_LIFE = 3;                  // 每个黑洞存在 3 秒
  const HOLE_RADIUS = 26;               // 洞的视觉半径
  const RIM_RATIO = 0.6;                // 中空比例
  const SPIN_RATE = 2;                  // 洞自身转速 2 r/s
  // 被吸入后绕洞旋转 1.1 r/s：慢一点，拉长的身体才看得清；且 0.8 秒一跳不会整圈对齐，
  // 每次结算的猛拽落在不同方位
  const ORBIT_RATE = 1.1;
  // 没有引力场：洞只吃真正贴上来的目标，不再隔着半个场地拉人。
  const CAPTURE_RADIUS = 30;
  const CAPTURE_PULL_TIME = 0.3;        // 被拉到轨道上的过渡时间
  const INNER_ORBIT = HOLE_RADIUS - 12; // 轨道随时间向内螺旋收紧到这里
  const ORBIT_SHRINK_TIME = 2;
  // 潮汐拉长（纯视觉）：沿指向洞心的轴拉长、横向变细，结算时再猛地一抻
  const STRETCH_GROW_TIME = 0.45;
  const STRETCH_BASE = 0.4;
  const STRETCH_DEEPEN = 0.25;
  const STRETCH_PULSE = 0.3;
  const PULSE_TIME = 0.24;
  const TIDAL_LEAN = 0.3;               // 拉长轴略微落后于公转方向，像被卷进去
  const REBOUND_TIME = 0.45;            // 放出后弹回原形的抖动时长
  const TICK_INTERVAL = 0.8;            // 被吸住后每 0.8 秒结算一次
  const TICK_DAMAGE = 5;                // 每次 5 点（与转速无关）
  const HOLD_EXTRA = 0.05;
  const SPAWN_FX_TIME = 0.5;
  const COLLAPSE_FX_TIME = 0.42;
  const SPAWN_MARGIN = 4;               // 生成点离板边的额外距离（越小越铺满全场）
  // 连续两个洞至少隔开这么多（按场地边长取比例），否则会出现"每次都刷在旁边"
  const MIN_HOLE_GAP_RATIO = 0.45;
  const SPAWN_ATTEMPTS = 24;
  const COLOR = "#2f0a45";              // 黑紫（球本体与环）
  const RIM_COLOR = "#c9b6ff";          // 内侧撕裂亮边
  const RIM_DARK = "#150520";           // 外缘暗描边
  const SPECKS = Object.freeze([
    [0.92, 0.2, 1.5], [-0.6, 0.78, 1.2], [0.35, -0.94, 1.4],
    [-0.86, -0.5, 1.1], [0.72, 0.68, 1.3], [-0.25, -0.45, 1.0]
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // 确定性伪随机：撕裂边不能吃种子随机流（会打乱确定性对局的推演）
  function hash01(seed) {
    const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
    return value - Math.floor(value);
  }

  function smoothStep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  // 视觉随机：粒子用独立的确定性序列，不消耗对局的种子随机流
  function createVisualRandom(seed) {
    let index = 0;
    return () => {
      index += 1;
      return hash01(seed * 97.13 + index * 7.31);
    };
  }

  // 潮汐形变：只读洞心位置和时间，返回给渲染器的 { angle, stretch, squash, shift }
  function tidalDeform(effect, ball, time) {
    if (!Number.isFinite(effect.holeX) || !Number.isFinite(effect.capturedAt)) return null;
    const elapsed = Math.max(0, time - effect.capturedAt);
    const grow = smoothStep(elapsed / STRETCH_GROW_TIME);
    const deepen = clamp(elapsed / HOLE_LIFE, 0, 1);
    const pulseAge = time - effect.lastTickAt;
    const pulse = pulseAge >= 0 && pulseAge < PULSE_TIME ? Math.pow(1 - pulseAge / PULSE_TIME, 2) : 0;
    const stretch = 1 + grow * (STRETCH_BASE + STRETCH_DEEPEN * deepen) + pulse * STRETCH_PULSE;
    const angle = Math.atan2(effect.holeY - ball.y, effect.holeX - ball.x) - TIDAL_LEAN;
    return {
      angle,
      stretch,
      squash: 1 / Math.pow(stretch, 0.75),
      // 近洞一端被拽得更远：整体朝洞心挪半个伸长量
      shift: (stretch - 1) * ball.radius * 0.5
    };
  }

  // 放出后的回弹：没有任何控制标记的纯形变状态，沿最后的拉长轴阻尼抖动
  function createReboundEffect(angle, amplitude) {
    return {
      id: "black-hole-rebound",
      duration: REBOUND_TIME,
      angle,
      amplitude,
      startedAt: 0,
      onApply({ effect, game }) {
        effect.startedAt = game.time;
      },
      getBodyDeform({ effect, game }) {
        const t = clamp((game.time - effect.startedAt) / REBOUND_TIME, 0, 1);
        const wobble = effect.amplitude * Math.cos(t * Math.PI * 3.2) * Math.pow(1 - t, 2);
        const stretch = Math.max(0.6, 1 + wobble);
        return { angle: effect.angle, stretch, squash: 1 / Math.pow(stretch, 0.75), shift: 0 };
      }
    };
  }

  // 被吸住的状态：锁移动 + 暂停行为 + 无法攻击；解除时把速度还回去
  function createHoldEffect(duration) {
    return {
      id: "black-hole-hold",
      duration,
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      savedVx: 0,
      savedVy: 0,
      // 由黑洞实体在吸住时写入，形变只读这些字段
      holeX: NaN,
      holeY: NaN,
      capturedAt: NaN,
      lastTickAt: -Infinity,
      getBodyDeform({ ball, effect, game }) {
        return tidalDeform(effect, ball, game.time);
      },
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = Number.isFinite(ball.storedVx) ? ball.storedVx : ball.vx;
          effect.savedVy = Number.isFinite(ball.storedVy) ? ball.storedVy : ball.vy;
        }
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game }) {
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect, game, services: effectServices }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
        const last = tidalDeform(effect, ball, game.time);
        if (last && ball.hp > 0 && effectServices && typeof effectServices.applyEffect === "function") {
          effectServices.applyEffect(ball, createReboundEffect(last.angle, Math.min(0.6, last.stretch - 1)));
        }
      }
    };
  }

  // 生成特效：外圈星尘向内收束 + 一圈撕开的冲击环
  function createHoleSpawnEffect(x, y) {
    return {
      kind: "black-hole-spawn",
      life: SPAWN_FX_TIME,
      x,
      y,
      draw({ effect }, canvas) {
        const baseAlpha = canvas.globalAlpha;
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = baseAlpha * fade * 0.9;
        canvas.strokeStyle = RIM_COLOR;
        canvas.lineWidth = 2 + fade * 1.4;
        canvas.beginPath();
        canvas.arc(0, 0, HOLE_RADIUS * (2.6 - progress * 1.6), 0, TWO_PI);
        canvas.stroke();
        canvas.fillStyle = RIM_COLOR;
        for (let index = 0; index < 10; index += 1) {
          const angle = index * (TWO_PI / 10) + progress * 1.2;
          const distance = HOLE_RADIUS * (0.7 + (1 - progress) * 1.9);
          canvas.globalAlpha = baseAlpha * fade * (0.4 + (index % 3) * 0.2);
          canvas.beginPath();
          canvas.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, 1.4, 0, TWO_PI);
          canvas.fill();
        }
        canvas.restore();
      }
    };
  }

  // 消失特效：整圈向内塌缩 + 一次亮闪
  function createHoleCollapseEffect(x, y) {
    return {
      kind: "black-hole-collapse",
      life: COLLAPSE_FX_TIME,
      x,
      y,
      draw({ effect }, canvas) {
        const baseAlpha = canvas.globalAlpha;
        const progress = clamp(effect.age / effect.life, 0, 1);
        const fade = 1 - progress;
        canvas.save();
        canvas.translate(effect.x, effect.y);
        canvas.globalCompositeOperation = "lighter";
        canvas.globalAlpha = baseAlpha * fade;
        canvas.strokeStyle = RIM_COLOR;
        canvas.lineWidth = 2.4 * fade + 0.6;
        canvas.beginPath();
        canvas.arc(0, 0, HOLE_RADIUS * (0.2 + fade * 0.9), 0, TWO_PI);
        canvas.stroke();
        canvas.fillStyle = "#ffffff";
        canvas.globalAlpha = baseAlpha * fade * fade * 0.85;
        canvas.beginPath();
        canvas.arc(0, 0, 3 + progress * 5, 0, TWO_PI);
        canvas.fill();
        canvas.restore();
      }
    };
  }

  // 黑洞：原地旋转的引力洞。吸入后锁住目标绕着转，每 0.8 秒扣 5 点。
  function createBlackHole(x, y, arenaSize) {
    return {
      kind: "black-hole-vortex",
      combatKind: "zone",
      // 画在球下面：被拉长的身体探进洞口，血量数字不被黑环盖住
      drawLayer: "background",
      life: HOLE_LIFE,
      x,
      y,
      radius: HOLE_RADIUS,
      arenaSize,
      seed: 1,
      spin: 0,
      victim: null,
      holdEffect: null,
      orbitAngle: 0,
      orbitRadius: HOLE_RADIUS - 6,
      captureDistance: 0,
      captureElapsed: 0,
      nextTickAt: 0,
      lastTickAt: -Infinity,
      tickCount: 0,
      collapsing: false,
      update({ effect, game, services: holeServices }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        const step = Math.max(0, Math.min(dt, 0.05));
        effect.spin += TWO_PI * SPIN_RATE * step;
        const remaining = effect.life - effect.age;

        // 消失前：塌缩特效 + 放人
        if (!effect.collapsing && remaining <= step + EPSILON) {
          effect.collapsing = true;
          holeServices.spawnVisualEffect(createHoleCollapseEffect(effect.x, effect.y));
        }

        // 吸入：只有踏进捕获半径的目标才会被吸住
        holeServices.forEachEnemy((target) => {
          if (target.hp <= 0 || effect.victim) return;
          const dx = effect.x - target.x;
          const dy = effect.y - target.y;
          const distance = Math.hypot(dx, dy);
          if (distance > CAPTURE_RADIUS + target.radius) return;
          const holdEffect = holeServices.applyEffect(
            target,
            createHoldEffect(Math.max(0.05, remaining + HOLD_EXTRA))
          );
          if (!holdEffect) return;
          effect.victim = target;
          effect.holdEffect = holdEffect;
          holdEffect.holeX = effect.x;
          holdEffect.holeY = effect.y;
          holdEffect.capturedAt = game.time;
          holdEffect.lastTickAt = -Infinity;
          effect.orbitAngle = Math.atan2(target.y - effect.y, target.x - effect.x);
          effect.captureDistance = distance;
          effect.captureElapsed = 0;
          effect.nextTickAt = game.time + TICK_INTERVAL;
          target.vx = 0;
          target.vy = 0;
        });

        // 被吸住的目标：绕洞旋转 + 按时间结算伤害（与转速无关）
        const victim = effect.victim;
        if (victim && victim.hp > 0 && victim.effects && victim.effects.get("black-hole-hold") === effect.holdEffect) {
          effect.captureElapsed += step;
          effect.orbitAngle += TWO_PI * ORBIT_RATE * step;
          // 轨道随被吸住的时间向内螺旋收紧
          let orbitDistance = effect.orbitRadius + (INNER_ORBIT - effect.orbitRadius) *
            smoothStep(effect.captureElapsed / ORBIT_SHRINK_TIME);
          if (effect.captureElapsed < CAPTURE_PULL_TIME) {
            const progress = effect.captureElapsed / CAPTURE_PULL_TIME;
            const eased = progress * (2 - progress);
            orbitDistance = effect.captureDistance + (orbitDistance - effect.captureDistance) * eased;
          }
          victim.x = effect.x + Math.cos(effect.orbitAngle) * orbitDistance;
          victim.y = effect.y + Math.sin(effect.orbitAngle) * orbitDistance;
          victim.vx = 0;
          victim.vy = 0;
          if (game.time + EPSILON >= effect.nextTickAt) {
            effect.nextTickAt += TICK_INTERVAL;
            holeServices.dealDamage(victim, TICK_DAMAGE);
            effect.lastTickAt = game.time;
            effect.holdEffect.lastTickAt = game.time;
            effect.tickCount += 1;
            // 被撕下的碎屑朝洞心飞去
            const inward = Math.atan2(effect.y - victim.y, effect.x - victim.x);
            holeServices.spawnParticleBurst({
              kind: "black-hole-shred",
              x: victim.x + Math.cos(inward) * victim.radius * 0.6,
              y: victim.y + Math.sin(inward) * victim.radius * 0.6,
              count: 10,
              minDiameter: 1,
              maxDiameter: 3,
              colors: [victim.color, RIM_COLOR, victim.color],
              directionAngle: inward,
              directionSpread: 0.9,
              minSpeed: 40,
              maxSpeed: 95,
              drag: 3.2,
              life: 0.32,
              random: createVisualRandom(effect.seed * 31 + effect.tickCount)
            });
          }
          return;
        }
        if (victim) {
          effect.victim = null;
          effect.holdEffect = null;
        }
      },
      draw({ effect, game }, context) {
        // 中空的深紫外环 + 内侧撕裂亮边，整体按 2 r/s 旋转；外面一圈吸积旋臂往里卷
        const radius = effect.radius;
        const seed = Number.isFinite(effect.seed) ? effect.seed : 1;
        const spin = effect.spin || 0;
        const remain = clamp(1 - effect.age / effect.life, 0, 1);
        const now = game && Number.isFinite(game.time) ? game.time : 0;
        const pulseAge = now - (Number.isFinite(effect.lastTickAt) ? effect.lastTickAt : -Infinity);
        const pulse = pulseAge >= 0 && pulseAge < PULSE_TIME ? 1 - pulseAge / PULSE_TIME : 0;
        const baseAlpha = context.globalAlpha;
        context.save();
        context.translate(effect.x, effect.y);

        // 引力透镜：一圈很淡的外晕
        context.globalAlpha = baseAlpha * 0.28 * remain;
        context.strokeStyle = RIM_COLOR;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(0, 0, radius * 1.22, 0, TWO_PI);
        context.stroke();

        context.globalAlpha = baseAlpha * 0.96;
        context.fillStyle = COLOR;
        context.beginPath();
        context.arc(0, 0, radius, 0, TWO_PI);
        context.arc(0, 0, radius * RIM_RATIO, 0, TWO_PI, true);
        context.fill();

        // 吸积旋臂：三条从外晕卷进内缘的螺线，随洞一起转
        context.globalCompositeOperation = "lighter";
        context.strokeStyle = RIM_COLOR;
        context.lineWidth = 1.3;
        for (let arm = 0; arm < 3; arm += 1) {
          const start = spin * 0.8 + arm * (TWO_PI / 3);
          context.globalAlpha = baseAlpha * (0.32 + pulse * 0.3) * remain;
          context.beginPath();
          for (let step = 0; step <= 10; step += 1) {
            const u = step / 10;
            const distance = radius * (1.18 - u * (1.18 - RIM_RATIO));
            const angle = start + u * 1.5;
            const px = Math.cos(angle) * distance;
            const py = Math.sin(angle) * distance;
            if (step === 0) context.moveTo(px, py);
            else context.lineTo(px, py);
          }
          context.stroke();
        }
        context.globalCompositeOperation = "source-over";

        context.save();
        context.rotate(spin);
        const points = 22;
        context.globalAlpha = baseAlpha;
        context.strokeStyle = RIM_COLOR;
        context.lineWidth = 1.7 + pulse * 1.3;
        context.beginPath();
        for (let index = 0; index <= points; index += 1) {
          const angle = (index / points) * TWO_PI;
          const scale = RIM_RATIO + 0.05 + hash01(seed * 13 + index) * 0.1 +
            Math.sin(spin * 3 + index * 1.7) * 0.02;
          const px = Math.cos(angle) * radius * scale;
          const py = Math.sin(angle) * radius * scale;
          if (index === 0) context.moveTo(px, py);
          else context.lineTo(px, py);
        }
        context.closePath();
        context.stroke();
        context.restore();

        // 环上的星尘：边转边往里掉，掉到内缘再从外圈补上
        context.globalCompositeOperation = "lighter";
        for (let index = 0; index < SPECKS.length; index += 1) {
          const [sx, sy, size] = SPECKS[index];
          const fall = (spin * 0.12 + index / SPECKS.length) % 1;
          const angle = spin * 1.4 + Math.atan2(sy, sx) + fall * 1.2;
          const distance = radius * (1.15 - fall * (1.15 - RIM_RATIO));
          context.globalAlpha = baseAlpha * (effect.victim ? 0.85 : 0.5) * remain * (1 - fall * 0.5);
          context.fillStyle = index % 2 === 0 ? RIM_COLOR : "#ffffff";
          context.beginPath();
          context.arc(Math.cos(angle) * distance, Math.sin(angle) * distance, size, 0, TWO_PI);
          context.fill();
        }

        // 结算闪光：内缘一圈白光向外一跳
        if (pulse > 0) {
          context.globalAlpha = baseAlpha * pulse * 0.8;
          context.strokeStyle = "#ffffff";
          context.lineWidth = 1.5 * pulse + 0.4;
          context.beginPath();
          context.arc(0, 0, radius * (RIM_RATIO + (1 - pulse) * 0.5), 0, TWO_PI);
          context.stroke();
        }
        context.globalCompositeOperation = "source-over";

        context.globalAlpha = baseAlpha * 0.8;
        context.strokeStyle = RIM_DARK;
        context.lineWidth = 1.2;
        context.beginPath();
        context.arc(0, 0, radius, 0, TWO_PI);
        context.stroke();
        context.restore();
      }
    };
  }

  const blackHoleDefinition = {
    id: "blackHole",
    name: "\u9ed1\u6d1e",
    englishName: "Black Hole",
    color: COLOR,
    description: "\u6bcf2\u79d2\u53ec\u5524\u4e00\u4e2a\u65cb\u8f6c\u9ed1\u6d1e\uff082r/s\uff09/ \u5438\u5165\u540e\u6bcf0.8\u79d2\u62635\u70b9 / \u5b58\u57283\u79d2",
    rionCycleDuration: HOLE_INTERVAL + HOLE_LIFE,
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let nextHoleAt = (typeof services.getAttackTime === "function" ? services.getAttackTime() : 0) + HOLE_INTERVAL;
      let holeCount = 0;
      let lastHole = null;

      function releaseHole(context) {
        const arenaSize = context.game.arenaSize;
        const arena = context.game.arena || createArenaGeometry(arenaSize);
        const margin = HOLE_RADIUS + SPAWN_MARGIN;
        const minimumGap = arenaSize * MIN_HOLE_GAP_RATIO;
        // 随机撒点，但要求离上一个洞足够远；实在抽不到就取最远的那个
        let best = arena.samplePoint(Math.random, margin);
        let bestGap = -1;
        for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
          const candidate = arena.samplePoint(Math.random, margin);
          if (!lastHole) {
            best = candidate;
            break;
          }
          const gap = Math.hypot(candidate.x - lastHole.x, candidate.y - lastHole.y);
          if (gap >= minimumGap) {
            best = candidate;
            break;
          }
          if (gap > bestGap) {
            bestGap = gap;
            best = candidate;
          }
        }
        const x = best.x;
        const y = best.y;
        lastHole = { x, y };
        holeCount += 1;
        const entity = services.spawnCombatEntity(createBlackHole(x, y, arenaSize));
        if (entity) entity.seed = holeCount;
        services.spawnVisualEffect(createHoleSpawnEffect(x, y));
        return entity;
      }

      return {
        onAttackBorrowStart(context) { releaseHole(context); },
        isAttackCycleComplete() { return holeCount > 0; },
        update(context) {
          const now = typeof services.getAttackTime === "function"
            ? services.getAttackTime() : context.game.time;
          if (now + EPSILON < nextHoleAt) return;
          nextHoleAt = now + HOLE_INTERVAL;
          releaseHole(context);
        },
        getBlackHoleState() {
          return {
            nextHoleAt,
            holeCount,
            lastHole: lastHole ? { ...lastHole } : null
          };
        }
      };
    }
  };

  registerBall(blackHoleDefinition);
  return {
    blackHoleDefinition,
    createBlackHoleVortex: createBlackHole,
    blackHoleCreateHoldEffect: createHoldEffect,
    blackHoleCreateSpawnEffect: createHoleSpawnEffect,
    blackHoleCreateCollapseEffect: createHoleCollapseEffect,
    BLACK_HOLE_CONSTANTS: Object.freeze({
      interval: HOLE_INTERVAL,
      radius: HOLE_RADIUS,
      life: HOLE_LIFE,
      spinRate: SPIN_RATE,
      orbitRate: ORBIT_RATE,
      captureRadius: CAPTURE_RADIUS,
      tickInterval: TICK_INTERVAL,
      damage: TICK_DAMAGE,
      spawnMargin: HOLE_RADIUS + SPAWN_MARGIN,
      minHoleGapRatio: MIN_HOLE_GAP_RATIO,
      color: COLOR
    })
  };
});
