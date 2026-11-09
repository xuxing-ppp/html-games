(function initializeQuicksandBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createQuicksandPlugin({ resolveArenaGeometry, registerBall }) {
  const THROW_INTERVAL = 3;
  const PREDICT_HORIZON = 1;
  const FLIGHT_TIME = 1;
  const SAND_BALL_RADIUS = 7.5;
  const TRAP_LIFE = 2;
  const TRAP_RADIUS = 30;
  const CONTACT_DAMAGE = 2;
  const DOT_INTERVAL = 0.45;
  const DOT_DAMAGE = 2;
  const PULL_TIME = 0.25;
  const SINK_RADIUS_RATIO = 0.6;
  const TRAIL_POINTS = 12;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  // 沙坑只用沙粒表达，不画底色、外圈、边界线或螺旋纹。
  const PIT_GRAIN_COUNT = 168;
  // 外缘沙粒只做缓慢环转，不向内卷，用密度和大小把 30 半径撑出来。
  const PIT_RIM_GRAIN_COUNT = 52;
  const TRAP_INTRO_DURATION = 0.12;
  const TRAP_FADE_DURATION = 0.25;
  const LANDING_GRAIN_COUNT = 20;
  const SETTLE_GRAIN_COUNT = 8;
  const SINK_ORBIT_GRAIN_COUNT = 16;
  const SINK_BURIED_GRAIN_COUNT = 8;
  // 只移动绘制，不改物理位置；让本体、血量数字和附着特效一起下沉。
  const SINK_RENDER_DEPTH = 3.2;
  const SINK_RELEASE_FADE = 0.18;

  const SAND_PARTICLE_COLORS = ["#d9b45c", "#b8903f", "#e8cf8a"];
  const PIT_INNER_COLORS = ["#6b5124", "#8a6d3a", "#b8903f"];
  const PIT_OUTER_COLORS = ["#d9b45c", "#e8cf8a", "#b8903f"];
  const SAND_FINE_COLORS = ["#f2dd9a", "#e8cf8a", "#d9b45c", "#b8903f"];
  const SAND_BALL_COLOR = "#e8c84d";
  const SAND_BALL_HIGHLIGHT = "#f5e6a8";
  const SAND_BALL_SPECK = "#2f2a1d";
  const SAND_BALL_RIM = "#8a6d3a";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function clamp01(value) {
    return clamp(value, 0, 1);
  }

  function hashText(value) {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createPitGrains(seed) {
    const grains = [];
    for (let index = 0; index < PIT_GRAIN_COUNT; index += 1) {
      const rim = index < PIT_RIM_GRAIN_COUNT;
      if (rim) {
        const radiusRatio = 0.8 + 0.18 * Math.sqrt(hashRandom(seed + index * 31));
        grains.push({
          rim: true,
          angle: hashRandom(seed + index * 17) * TWO_PI,
          radiusRatio,
          angularSpeed: 0.18 + hashRandom(seed + index * 41) * 0.5,
          phase: hashRandom(seed + index * 67),
          size: 0.9 + hashRandom(seed + index * 71) * 0.9,
          alpha: 0.5 + hashRandom(seed + index * 79) * 0.4,
          color: PIT_OUTER_COLORS[
            Math.floor(hashRandom(seed + index * 97) * PIT_OUTER_COLORS.length)
          ]
        });
      } else {
        const radiusRatio = 0.1 + 0.84 * Math.sqrt(hashRandom(seed + index * 31));
        const colors = radiusRatio < 0.52 ? PIT_INNER_COLORS : PIT_OUTER_COLORS;
        grains.push({
          rim: false,
          angle: hashRandom(seed + index * 17) * TWO_PI,
          radiusRatio,
          angularSpeed: 0.28 + hashRandom(seed + index * 41) * 0.85,
          cycleSpeed: 0.34 + hashRandom(seed + index * 53) * 0.5,
          phase: hashRandom(seed + index * 67),
          size: 0.6 + hashRandom(seed + index * 71) * 1,
          alpha: 0.4 + hashRandom(seed + index * 79) * 0.5,
          color: colors[Math.floor(hashRandom(seed + index * 97) * colors.length)]
        });
      }
    }
    // 同色相邻，绘制时少切 fillStyle。
    grains.sort((left, right) => (left.color < right.color ? -1 : (
      left.color > right.color ? 1 : 0
    )));
    return grains;
  }

  function createSinkGrains(seed) {
    const grains = [];
    for (let index = 0; index < SINK_ORBIT_GRAIN_COUNT; index += 1) {
      // 只在下半圈翻涌，避免沙粒盖到血量数字上。
      grains.push({
        buried: false,
        angle: Math.PI * hashRandom(seed + index * 19),
        phase: hashRandom(seed + index * 29),
        cycleSpeed: 0.62 + hashRandom(seed + index * 43) * 0.42,
        sway: 0.22 + hashRandom(seed + index * 59) * 0.36,
        swaySpeed: 1.1 + hashRandom(seed + index * 89) * 1.5,
        size: 0.5 + hashRandom(seed + index * 73) * 0.8,
        alpha: 0.4 + hashRandom(seed + index * 83) * 0.5,
        color: SAND_FINE_COLORS[
          Math.floor(hashRandom(seed + index * 101) * SAND_FINE_COLORS.length)
        ]
      });
    }
    for (let index = 0; index < SINK_BURIED_GRAIN_COUNT; index += 1) {
      // 贴着受害者下缘的一圈埋沙，只覆盖身体底部，不碰中心的血量数字。
      const grainIndex = index + SINK_ORBIT_GRAIN_COUNT;
      grains.push({
        buried: true,
        angle: Math.PI / 2 + (hashRandom(seed + grainIndex * 137) - 0.5) * 1.1,
        phase: hashRandom(seed + grainIndex * 149),
        radiusRatio: 0.72 + hashRandom(seed + grainIndex * 151) * 0.28,
        sway: 0.04 + hashRandom(seed + grainIndex * 157) * 0.1,
        swaySpeed: 1.2 + hashRandom(seed + grainIndex * 163) * 1.4,
        size: 0.6 + hashRandom(seed + grainIndex * 167) * 0.8,
        alpha: 0.6 + hashRandom(seed + grainIndex * 173) * 0.3,
        color: SAND_PARTICLE_COLORS[
          Math.floor(hashRandom(seed + grainIndex * 179) * SAND_PARTICLE_COLORS.length)
        ]
      });
    }
    return grains;
  }

  function createSandBallGrains(seed) {
    const grains = [];
    for (let index = 0; index < 16; index += 1) {
      const pale = hashRandom(seed + index * 107) > 0.72;
      grains.push({
        angle: hashRandom(seed + index * 11) * TWO_PI,
        distanceRatio: 0.08 + 0.66 * Math.sqrt(hashRandom(seed + index * 23)),
        size: 0.4 + hashRandom(seed + index * 37) * 0.75,
        color: pale ? "#8a6d3a" : SAND_BALL_SPECK
      });
    }
    return grains;
  }

  function sinkRenderDepth(effect, time) {
    const startedAt = effect.expiresAt - effect.duration;
    const pullProgress = clamp01((time - startedAt) / PULL_TIME);
    const eased = pullProgress * (2 - pullProgress);
    const release = clamp01((effect.expiresAt - time) / SINK_RELEASE_FADE);
    return SINK_RENDER_DEPTH * eased * release;
  }

  function predictTargetPosition(target, arenaSize, duration = PREDICT_HORIZON) {
    const { x, y } = resolveArenaGeometry(arenaSize).advanceMotion(target, duration);
    return { x, y };
  }

  function hashRandom(seed) {
    let value = (seed * 2246822519 + 374761393) | 0;
    value = (value ^ (value >> 13)) * 1274126177;
    value ^= value >> 16;
    return ((value >>> 0) % 100000) / 100000;
  }

  // 沉陷状态：困在陷阱中央，暂停行为且无法攻击；抵达中央后持续流沙伤害
  function createSinkEffect(duration, savedRadius, visualSeed = 0) {
    return {
      id: "quicksand-sink",
      duration,
      locksMovement: true,
      pausesBehavior: true,
      preventsAttack: true,
      savedRadius,
      arrived: false,
      nextDamageAt: 0,
      grains: createSinkGrains(visualSeed),
      onApply({ ball, services: effectServices }) {
        ball.vx = 0;
        ball.vy = 0;
        effectServices.spawnParticleBurst({
          kind: "quicksand-capture",
          x: ball.x,
          y: ball.y,
          count: 10,
          shape: "rect",
          colors: SAND_FINE_COLORS.slice(),
          minLength: 0.4,
          maxLength: 1.1,
          minWidth: 0.3,
          maxWidth: 0.7,
          minSpeed: 10,
          maxSpeed: 28,
          initialRadius: ball.radius * 0.7,
          gravityY: 45,
          drag: 3,
          life: 0.32
        });
      },
      update({ ball, effect, game, services: effectServices }) {
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
        if (!effect.arrived) return;
        while (
          effect.nextDamageAt > 0 &&
          game.time >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + 1e-9
        ) {
          effectServices.dealDamage(ball, DOT_DAMAGE);
          effect.nextDamageAt += DOT_INTERVAL;
        }
      },
      // 纯绘制位移：让本体、血量数字和本状态粒子一起沉下去，物理坐标不变。
      getRenderOffset({ effect, game }) {
        return { x: 0, y: sinkRenderDepth(effect, game.time) };
      },
      draw({ ball, effect, game }, context) {
        const baseAlpha = context.globalAlpha;
        const startedAt = effect.expiresAt - effect.duration;
        const elapsed = Math.max(0, game.time - startedAt);
        const fade = clamp01((effect.expiresAt - game.time) / SINK_RELEASE_FADE);
        if (fade <= 0) return;
        const motion = effect.arrived ? 1.25 : 1;
        let lastColor = "";
        context.save();
        for (const grain of effect.grains) {
          let x;
          let y;
          let alpha;
          if (grain.buried) {
            const angle = grain.angle +
              Math.sin(elapsed * grain.swaySpeed * motion + grain.phase * TWO_PI) * grain.sway;
            const radius = ball.radius * grain.radiusRatio;
            x = ball.x + Math.cos(angle) * radius * 1.05;
            y = ball.y + Math.sin(angle) * radius * 0.92;
            alpha = baseAlpha * grain.alpha * fade *
              (0.72 + 0.28 * Math.sin(elapsed * 2.1 + grain.phase * TWO_PI));
          } else {
            const cycle = (elapsed * grain.cycleSpeed * motion + grain.phase) % 1;
            const radius = ball.radius * (1.9 - 0.85 * cycle);
            const angle = grain.angle +
              Math.sin(elapsed * grain.swaySpeed * motion + grain.phase * TWO_PI) * grain.sway;
            x = ball.x + Math.cos(angle) * radius;
            y = ball.y + Math.sin(angle) * radius * 0.9 + ball.radius * 0.18;
            alpha = baseAlpha * grain.alpha * Math.sin(cycle * Math.PI) * fade;
          }
          if (alpha <= 0.01) continue;
          if (grain.color !== lastColor) {
            context.fillStyle = grain.color;
            lastColor = grain.color;
          }
          context.globalAlpha = alpha;
          context.fillRect(x - grain.size / 2, y - grain.size / 2, grain.size, grain.size);
        }
        context.restore();
      },
      onExpire({ ball, effect, services: effectServices }) {
        if (effect.savedRadius) ball.radius = effect.savedRadius;
        ball.vx = 0;
        ball.vy = 0;
        effectServices.spawnParticleBurst({
          kind: "quicksand-release",
          x: ball.x,
          y: ball.y,
          count: 8,
          shape: "rect",
          colors: SAND_FINE_COLORS.slice(),
          minLength: 0.4,
          maxLength: 1,
          minWidth: 0.3,
          maxWidth: 0.6,
          minSpeed: 8,
          maxSpeed: 24,
          initialRadius: ball.radius * 0.6,
          gravityY: 50,
          drag: 3.2,
          life: 0.3
        });
      }
    };
  }

  function releaseCapture(state) {
    if (state.target && state.savedRadius) state.target.radius = state.savedRadius;
  }

  function createTrap(x, y, arenaSize) {
    const seed = Math.floor(Math.random() * 1000000);
    return {
      kind: "quicksand-trap",
      combatKind: "zone",
      life: TRAP_LIFE,
      lifecycle: "independent",
      drawLayer: "background",
      x,
      y,
      radius: TRAP_RADIUS,
      arenaSize,
      seed,
      grains: createPitGrains(seed),
      captures: new Map(),
      update({ entity, game, services: trapServices }, dt) {
        // 收尾：受害者死亡或沉陷状态已不在时，还原半径并移除追踪
        for (const [instanceId, state] of Array.from(entity.captures)) {
          if (!state.target || state.target.hp <= 0 || state.target.effects.get("quicksand-sink") !== state.effect) {
            releaseCapture(state);
            entity.captures.delete(instanceId);
          }
        }
        // 拉拽入坑与钉在中央
        for (const state of entity.captures.values()) {
          if (state.phase === "pull") {
            state.pullTimer += dt;
            const progress = Math.min(1, state.pullTimer / PULL_TIME);
            const eased = progress * (2 - progress);
            state.target.x = state.fromX + (entity.x - state.fromX) * eased;
            state.target.y = state.fromY + (entity.y - state.fromY) * eased;
            state.target.vx = 0;
            state.target.vy = 0;
            state.target.radius = state.savedRadius * (
              SINK_RADIUS_RATIO + (1 - SINK_RADIUS_RATIO) * (1 - eased)
            );
            if (progress >= 1) {
              state.phase = "sunk";
              state.effect.arrived = true;
              state.effect.nextDamageAt = game.time + DOT_INTERVAL;
            }
          } else {
            state.target.x = entity.x;
            state.target.y = entity.y;
            state.target.vx = 0;
            state.target.vy = 0;
          }
        }
        // 新的接触者：立即 2 点伤害，拉向中央并沉陷
        trapServices.forEachEnemy((target) => {
          if (target.hp <= 0) return;
          if (entity.captures.has(target.instanceId)) return;
          if (target.effects && target.effects.has("quicksand-sink")) return;
          if (target.effects && target.effects.has("tornado-hold")) return;
          if (Math.hypot(target.x - entity.x, target.y - entity.y) > TRAP_RADIUS + target.radius) return;
          if (trapServices.dealDamage(target, CONTACT_DAMAGE) !== true) return;
          const effect = trapServices.applyEffect(target, createSinkEffect(
            TRAP_LIFE - entity.age + 0.05,
            target.radius,
            (entity.seed ^ hashText(target.instanceId)) >>> 0
          ));
          if (!effect) return;
          entity.captures.set(target.instanceId, {
            target,
            effect,
            phase: "pull",
            pullTimer: 0,
            fromX: target.x,
            fromY: target.y,
            savedRadius: target.radius
          });
        });
        if (!entity.settleBurstSpawned && entity.age + dt >= entity.life - EPSILON) {
          entity.settleBurstSpawned = true;
          trapServices.spawnParticleBurst({
            kind: "quicksand-settle",
            x: entity.x,
            y: entity.y,
            count: SETTLE_GRAIN_COUNT,
            shape: "rect",
            colors: SAND_FINE_COLORS.slice(),
            minLength: 0.4,
            maxLength: 1.1,
            minWidth: 0.3,
            maxWidth: 0.7,
            minSpeed: 6,
            maxSpeed: 20,
            initialRadius: entity.radius * 0.55,
            gravityY: 50,
            drag: 3.2,
            life: 0.34
          });
        }
      },
      draw({ entity }, context) {
        const baseAlpha = context.globalAlpha;
        const age = entity.age;
        const fade = clamp01((entity.life - age) / TRAP_FADE_DURATION);
        if (fade <= 0) return;
        const intro = clamp01(age / TRAP_INTRO_DURATION);
        // 陷得越深，沙粒吸得越快；只用颗粒表达，不画底色或任何环线。
        const motion = entity.captures.size > 0 ? 1.35 : 1;
        context.save();
        let lastColor = "";
        for (const grain of entity.grains) {
          const angle = grain.angle + age * grain.angularSpeed * motion;
          let radius;
          let alpha;
          if (grain.rim) {
            radius = entity.radius * grain.radiusRatio *
              (1 + 0.015 * Math.sin(age * 1.1 + grain.phase * TWO_PI));
            alpha = baseAlpha * grain.alpha * fade * intro *
              (0.72 + 0.28 * Math.sin(age * 1.7 + grain.phase * TWO_PI));
          } else {
            const cycle = (age * grain.cycleSpeed * motion + grain.phase) % 1;
            radius = entity.radius * (grain.radiusRatio * (1 - cycle) + 0.05);
            alpha = baseAlpha * grain.alpha * Math.sin(cycle * Math.PI) * fade * intro;
          }
          if (alpha <= 0.01) continue;
          if (grain.color !== lastColor) {
            context.fillStyle = grain.color;
            lastColor = grain.color;
          }
          context.globalAlpha = alpha;
          context.fillRect(
            entity.x + Math.cos(angle) * radius - grain.size / 2,
            entity.y + Math.sin(angle) * radius * 0.9 - grain.size / 2,
            grain.size,
            grain.size
          );
        }
        context.restore();
      }
    };
  }

  function sandBallPosition(entity, progress) {
    const x = entity.startX + (entity.landX - entity.startX) * progress;
    const groundY = entity.startY + (entity.landY - entity.startY) * progress;
    const y = groundY - entity.arcHeight * Math.sin(Math.PI * progress);
    return { x, y };
  }

  const quicksandDefinition = {
    id: "quicksand",
    name: "流沙",
    englishName: "Quicksand",
    color: "#c8a24b",
    description: "预判1秒后落点投掷沙球 / 流沙陷阱困住敌人持续伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      const attackNow = (context) => typeof services.getAttackTime === "function"
        ? services.getAttackTime() : context.game.time;
      let nextThrowAt = (typeof services.getAttackTime === "function"
        ? services.getAttackTime() : 0) + THROW_INTERVAL;

      function throwSandBall(context) {
        const arenaSize = context.game.arenaSize;
        const target = services.getOpponent();
        if (!target || target.hp <= 0) return false;
        const predicted = predictTargetPosition(target, context.game);
        const landX = predicted.x;
        const landY = predicted.y;
        const startX = context.ball.x;
        const startY = context.ball.y;
        const distance = Math.hypot(landX - startX, landY - startY);
        const seed = Math.floor(Math.random() * 1000000);
        services.spawnCombatEntity({
          kind: "quicksand-ball",
          combatKind: "projectile",
          life: FLIGHT_TIME,
          lifecycle: "independent",
          startX,
          startY,
          landX,
          landY,
          arenaSize,
          arcHeight: clamp(distance * 0.35, 18, 70),
          seed,
          grains: createSandBallGrains(seed),
          trail: [],
          update({ entity, services: ballServices }, dt) {
            // 滞空恰好 1 秒后落地生成流沙陷阱（抢在实体系统静默移除之前）
            if (entity.age + dt >= FLIGHT_TIME - EPSILON) {
              ballServices.spawnParticleBurst({
                kind: "quicksand-land",
                x: entity.landX,
                y: entity.landY,
                count: LANDING_GRAIN_COUNT,
                shape: "rect",
                colors: SAND_FINE_COLORS.slice(),
                minLength: 0.5,
                maxLength: 1.6,
                minWidth: 0.3,
                maxWidth: 0.8,
                minSpeed: 14,
                maxSpeed: 48,
                initialRadius: 4,
                gravityY: 80,
                drag: 3.6,
                life: 0.45
              });
              ballServices.spawnCombatEntity(createTrap(entity.landX, entity.landY, entity.arenaSize));
              entity.entityActive = false;
              return;
            }
            const position = sandBallPosition(entity, Math.min(1, entity.age / FLIGHT_TIME));
            entity.trail.push({ x: position.x, y: position.y });
            if (entity.trail.length > TRAIL_POINTS) entity.trail.shift();
          },
          draw({ entity }, context) {
            const progress = Math.min(1, entity.age / FLIGHT_TIME);
            const position = sandBallPosition(entity, progress);
            const baseAlpha = context.globalAlpha;
            context.save();
            // 滞空沙砾拖尾：尾巴更细、更碎。
            for (let index = 0; index < entity.trail.length; index += 1) {
              const point = entity.trail[index];
              const fade = (index + 1) / entity.trail.length;
              const size = 0.4 + fade * 1.1;
              context.globalAlpha = baseAlpha * 0.5 * fade;
              context.fillStyle = SAND_PARTICLE_COLORS[index % SAND_PARTICLE_COLORS.length];
              context.fillRect(point.x - size / 2, point.y - size / 2, size, size);
            }
            // 直径 15 的沙球：细沙粒缓慢翻滚，避免大块黑斑。
            context.globalAlpha = baseAlpha;
            context.fillStyle = SAND_BALL_COLOR;
            context.beginPath();
            context.arc(position.x, position.y, SAND_BALL_RADIUS, 0, TWO_PI);
            context.fill();
            context.globalAlpha = baseAlpha * 0.3;
            context.fillStyle = SAND_BALL_HIGHLIGHT;
            context.beginPath();
            context.arc(position.x - 1.8, position.y - 2.2, 3.1, 0, TWO_PI);
            context.fill();
            context.globalAlpha = baseAlpha;
            const rotation = entity.age * 0.9;
            for (const grain of entity.grains) {
              const angle = grain.angle + rotation;
              const dist = SAND_BALL_RADIUS * grain.distanceRatio;
              context.fillStyle = grain.color;
              context.fillRect(
                position.x + Math.cos(angle) * dist - grain.size / 2,
                position.y + Math.sin(angle) * dist - grain.size / 2,
                grain.size,
                grain.size
              );
            }
            context.globalAlpha = baseAlpha * 0.8;
            context.strokeStyle = SAND_BALL_RIM;
            context.lineWidth = 0.8;
            context.beginPath();
            context.arc(position.x, position.y, SAND_BALL_RADIUS, 0, TWO_PI);
            context.stroke();
            context.restore();
          }
        });
        return true;
      }

      return {
        update(context) {
          if (attackNow(context) + EPSILON < nextThrowAt) return;
          if (throwSandBall(context)) {
            nextThrowAt = attackNow(context) + THROW_INTERVAL;
          } else {
            nextThrowAt = attackNow(context) + 0.1;
          }
        },
        getQuicksandState() {
          return { nextThrowAt };
        }
      };
    }
  };

  registerBall(quicksandDefinition);
  return {
    quicksandDefinition,
    quicksandPredictTargetPosition: predictTargetPosition,
    quicksandCreateTrap: createTrap,
    quicksandCreateSinkEffect: createSinkEffect
  };
});
