(function initializeElectricV3(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricV3Plugin({ registerBall, createArenaGeometry }) {
  const ORB_FIRE_INTERVAL = 7.3;
  const ORB_RADIUS = 10;
  const ORB_SPEED_MULTIPLIER = 1;
  const ORB_FIELD_RADIUS = 43;
  const ORB_TICK_INTERVAL = 0.4;
  const ORB_TICK_DAMAGE = 3;
  const ORB_EXPLOSION_CONTACT = 2;
  const EXPLOSION_RADIUS = 146 / 2;
  const EXPLOSION_DAMAGE = 13;
  const EXPLOSION_STUN_DURATION = 1.5;
  const BASE_FIELD_RADIUS = 81;
  const BASE_DAMAGE = 1;
  const BASE_MIN_FREQUENCY = 1;
  const BASE_MAX_FREQUENCY = 50;
  const BASE_RAMP_DURATION = 18;
  const ARC_LIFE = 0.18;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function targetKey(target) {
    return target.instanceId || target.id;
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function frequencyAt(exposure) {
    const progress = clamp(exposure / BASE_RAMP_DURATION, 0, 1);
    return BASE_MIN_FREQUENCY +
      (BASE_MAX_FREQUENCY - BASE_MIN_FREQUENCY) * progress;
  }

  function integratedFrequency(fromExposure, toExposure) {
    const start = clamp(fromExposure, 0, BASE_RAMP_DURATION);
    const end = clamp(toExposure, 0, BASE_RAMP_DURATION);
    const slope = (BASE_MAX_FREQUENCY - BASE_MIN_FREQUENCY) / BASE_RAMP_DURATION;
    let cycles = BASE_MIN_FREQUENCY * (end - start) +
      slope * (end * end - start * start) / 2;
    if (toExposure > BASE_RAMP_DURATION) {
      cycles += BASE_MAX_FREQUENCY * (
        toExposure - Math.max(fromExposure, BASE_RAMP_DURATION)
      );
    }
    return Math.max(0, cycles);
  }

  function createArc(source, target, options = {}) {
    const startX = source.x;
    const startY = source.y;
    const endX = target.x;
    const endY = target.y;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / distance;
    const normalY = deltaX / distance;
    const segmentCount = Math.max(4, Math.min(12, Math.ceil(distance / 18)));
    const points = Array.from({ length: segmentCount + 1 }, (_value, index) => {
      const progress = index / segmentCount;
      const edgeFade = Math.sin(progress * Math.PI);
      const offset = index === 0 || index === segmentCount
        ? 0
        : (Math.random() - 0.5) * Math.min(22, distance * 0.18) * edgeFade;
      return {
        x: startX + deltaX * progress + normalX * offset,
        y: startY + deltaY * progress + normalY * offset
      };
    });
    return {
      kind: options.kind || "electric-v3-arc",
      life: ARC_LIFE,
      points,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const flicker = Math.floor(effect.age * 90) % 2 === 0 ? 1 : 0.62;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= (1 - progress) * flicker;
        context.lineJoin = "miter";
        context.lineCap = "butt";
        context.shadowColor = "#55dfff";
        context.shadowBlur = 8;
        context.strokeStyle = options.outerColor || "#278bd8";
        context.lineWidth = options.outerWidth || 4;
        context.beginPath();
        effect.points.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.stroke();
        context.shadowBlur = 3;
        context.strokeStyle = options.innerColor || "#d9fbff";
        context.lineWidth = options.innerWidth || 1.2;
        context.stroke();
        context.restore();
      }
    };
  }

  function createExplosionStun() {
    return {
      id: "electric-v3-explosion-stun",
      visualType: "stun",
      duration: EXPLOSION_STUN_DURATION,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
    };
  }

  function createShockwave(x, y) {
    const fragments = Array.from({ length: 18 }, (_value, index) => ({
      angle: index * Math.PI * 2 / 18,
      distance: 20 + index % 4 * 5,
      size: 2 + index % 2
    }));
    return {
      kind: "electric-v3-shockwave",
      life: 0.48,
      x,
      y,
      maxRadius: EXPLOSION_RADIUS,
      fragments,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const radius = effect.maxRadius * (1 - Math.pow(1 - progress, 3));
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.fillStyle = "rgba(71, 183, 255, 0.14)";
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = "#52caff";
        context.lineWidth = 5 - progress * 3;
        context.beginPath();
        context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
        context.stroke();
        context.strokeStyle = "#e5fdff";
        context.lineWidth = 1.2;
        context.stroke();
        effect.fragments.forEach((fragment) => {
          const distance = fragment.distance + progress * 65;
          context.fillStyle = "#71ddff";
          context.fillRect(
            effect.x + Math.cos(fragment.angle) * distance - fragment.size / 2,
            effect.y + Math.sin(fragment.angle) * distance - fragment.size / 2,
            fragment.size,
            fragment.size
          );
        });
        context.restore();
      }
    };
  }

  function drawBallLightning(context, effect, time) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.shadowColor = "#54dfff";
    context.shadowBlur = 12;
    context.fillStyle = "rgba(55, 159, 229, 0.12)";
    context.beginPath();
    context.arc(effect.x, effect.y, ORB_FIELD_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 7;
    context.fillStyle = "#4cc8f2";
    context.beginPath();
    context.arc(effect.x, effect.y, ORB_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#d9fbff";
    context.lineWidth = 1.4;
    context.stroke();
    context.shadowBlur = 2;
    context.strokeStyle = "#164f9d";
    context.lineWidth = 1.3;
    const phase = time * 13;
    for (let index = 0; index < 4; index += 1) {
      const angle = phase + index * Math.PI / 2;
      context.beginPath();
      context.moveTo(
        effect.x + Math.cos(angle) * 3,
        effect.y + Math.sin(angle) * 3
      );
      context.lineTo(
        effect.x + Math.cos(angle + 0.35) * 7,
        effect.y + Math.sin(angle + 0.35) * 7
      );
      context.lineTo(
        effect.x + Math.cos(angle - 0.15) * 10,
        effect.y + Math.sin(angle - 0.15) * 10
      );
      context.stroke();
    }
    context.restore();
  }

  function resolvePhysicalContact(effect, target) {
    let deltaX = target.x - effect.x;
    let deltaY = target.y - effect.y;
    let distance = Math.hypot(deltaX, deltaY);
    if (distance <= EPSILON) {
      const fallback = normalizeDirection(effect.vx, effect.vy);
      deltaX = fallback.x;
      deltaY = fallback.y;
      distance = 1;
    }
    const normalX = deltaX / distance;
    const normalY = deltaY / distance;
    const overlap = ORB_RADIUS + target.radius - distance;
    if (overlap > 0) {
      effect.x -= normalX * overlap * 0.5;
      effect.y -= normalY * overlap * 0.5;
      target.x += normalX * overlap * 0.5;
      target.y += normalY * overlap * 0.5;
    }

    const effectNormal = effect.vx * normalX + effect.vy * normalY;
    const targetNormal = target.vx * normalX + target.vy * normalY;
    if (effectNormal - targetNormal <= EPSILON) return;
    const relativeNormal = effectNormal - targetNormal;
    effect.vx -= 2 * relativeNormal * normalX;
    effect.vy -= 2 * relativeNormal * normalY;
  }

  function createBallLightning(services, source, target) {
    const direction = normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx,
      source.storedVy || source.vy
    );
    const speed = source.speed * ORB_SPEED_MULTIPLIER;
    return {
      kind: "electric-v3-ball-lightning",
      life: 3600,
      radius: ORB_RADIUS,
      color: "#4cc8f2",
      x: source.x,
      y: source.y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      contactCount: 0,
      contacts: new Set(),
      proximityTimes: new Map(),
      explode(effect, entityServices) {
        if (effect.life <= 0) return;
        effect.life = 0;
        entityServices.playSound("ability", { cue: "explosion" });
        entityServices.spawnVisualEffect(createShockwave(effect.x, effect.y));
        entityServices.forEachEnemy((enemy) => {
          if (Math.hypot(enemy.x - effect.x, enemy.y - effect.y) > (
            EXPLOSION_RADIUS + enemy.radius
          )) return;
          if (!entityServices.dealDamage(enemy, EXPLOSION_DAMAGE)) return;
          if (enemy.hp > 0) {
            entityServices.applyEffect(enemy, createExplosionStun());
          }
        });
      },
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const arena = game.arena || createArenaGeometry(game.arenaSize);
        const wall = arena.traceSegment(effect.x, effect.y, effect.x + effect.vx * elapsed, effect.y + effect.vy * elapsed, ORB_RADIUS);
        const motion = { ...arena.clampPoint(effect.x + effect.vx * elapsed, effect.y + effect.vy * elapsed, ORB_RADIUS), bounces: wall ? 1 : 0 };
        if (wall && arena.shape === "circle") { motion.x = wall.x; motion.y = wall.y; }
        Object.assign(effect, { x: motion.x, y: motion.y });
        if (wall) {
          if (arena.shape !== "circle" && wall.normalX && wall.normalY) { effect.vx *= -1; effect.vy *= -1; }
          else {
            const dot = effect.vx * wall.normalX + effect.vy * wall.normalY;
            effect.vx -= 2 * dot * wall.normalX; effect.vy -= 2 * dot * wall.normalY;
          }
        }

        const touching = new Set();
        const targets = [];
        entityServices.forEachContactEnemy(target => targets.push(target));
        for (const enemy of targets) {
          const key = targetKey(enemy);
          const profile = entityServices.getContactProfile(enemy);
          const distance = Math.hypot(enemy.x - effect.x, enemy.y - effect.y);
          entityServices.notifyEntityContact(enemy, effect, { overlapping: distance < ORB_RADIUS + enemy.radius });
          if (distance < ORB_RADIUS + enemy.radius && profile.solid) {
            touching.add(key);
            if (!effect.contacts.has(key)) {
              if (
                profile.attackable &&
                entityServices.tryConsumeEntity(enemy, effect, { physical: true })
              ) {
                effect.life = 0;
                return;
              }
              effect.contactCount += 1;
              effect.contacts.add(key);
              if (effect.contactCount >= ORB_EXPLOSION_CONTACT) {
                effect.explode(effect, entityServices);
                return;
              }
            }
            resolvePhysicalContact(effect, enemy);
          }

          if (!profile.attackable || distance > ORB_FIELD_RADIUS + enemy.radius) {
            effect.proximityTimes.delete(key);
            continue;
          }
          let proximityTime = (effect.proximityTimes.get(key) || 0) + elapsed;
          while (proximityTime + EPSILON >= ORB_TICK_INTERVAL && enemy.hp > 0) {
            proximityTime = Math.max(0, proximityTime - ORB_TICK_INTERVAL);
            if (!entityServices.dealDamage(enemy, ORB_TICK_DAMAGE)) break;
            entityServices.spawnVisualEffect(createArc(effect, enemy, {
              kind: "electric-v3-orb-arc"
            }));
            if (effect.life <= 0) return;
          }
          if (enemy.hp > 0) effect.proximityTimes.set(key, proximityTime);
          else effect.proximityTimes.delete(key);
        }
        for (const key of effect.contacts) {
          if (!touching.has(key)) effect.contacts.delete(key);
        }
      },
      draw({ effect, game }, context) {
        drawBallLightning(context, effect, game.time);
        context.save();
        context.font = "400 9px 'Ball Impact', Impact, Haettenschweiler, sans-serif";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.lineJoin = "round";
        context.lineWidth = 1.4;
        context.strokeStyle = "rgba(24, 55, 87, 0.9)";
        context.fillStyle = "#ffffff";
        const remaining = Math.max(0, ORB_EXPLOSION_CONTACT - 1 - effect.contactCount);
        context.strokeText(String(remaining), Math.round(effect.x), Math.round(effect.y));
        context.fillText(String(remaining), Math.round(effect.x), Math.round(effect.y));
        context.restore();
      }
    };
  }

  const electricV3Definition = {
    id: "electricV3",
    name: "\u7535\u7403V3",
    englishName: "Electric Ball V3",
    color: "#8bdcf4",
    description: "\u7403\u72b6\u95ea\u7535 / \u4e24\u89e6\u7206\u7834 / \u8303\u56f4\u52a0\u901f\u653e\u7535",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: ORB_FIRE_INTERVAL,
    createBehavior(services) {
      let orbTimer = 0;
      const baseStates = new Map();

      function updateBaseAttacks(context, dt) {
        const livingKeys = new Set();
        services.forEachEnemy((enemy) => {
          const key = targetKey(enemy);
          livingKeys.add(key);
          const profile = services.getContactProfile(enemy);
          const inRange = profile.attackable && Math.hypot(
            enemy.x - context.ball.x,
            enemy.y - context.ball.y
          ) <= BASE_FIELD_RADIUS + enemy.radius;
          if (!inRange) {
            baseStates.delete(key);
            return;
          }

          const state = baseStates.get(key) || { exposure: 0, cycles: 0 };
          const previousExposure = state.exposure;
          state.exposure += Math.max(0, dt);
          state.cycles += integratedFrequency(previousExposure, state.exposure);
          while (state.cycles + EPSILON >= 1 && enemy.hp > 0) {
            state.cycles = Math.max(0, state.cycles - 1);
            if (!services.dealDamage(enemy, BASE_DAMAGE, context.ball)) break;
            services.spawnVisualEffect(createArc(context.ball, enemy, {
              kind: "electric-v3-base-arc",
              outerColor: "#174c91",
              outerWidth: 3
            }));
          }
          if (enemy.hp > 0) baseStates.set(key, state);
          else baseStates.delete(key);
        });
        for (const key of baseStates.keys()) {
          if (!livingKeys.has(key)) baseStates.delete(key);
        }
      }

      return {
        update(_context, dt) {
          orbTimer = Math.min(ORB_FIRE_INTERVAL, orbTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, ORB_FIRE_INTERVAL - orbTimer);
        },
        afterUpdateStep(context, dt) {
          updateBaseAttacks(context, dt);
          if (orbTimer + EPSILON < ORB_FIRE_INTERVAL) return;
          orbTimer = 0;
          const target = services.getOpponent();
          if (!target) return;
          services.spawnProjectile(createBallLightning(services, context.ball, target));
        },
        getBaseAttackState(target) {
          const state = target ? baseStates.get(targetKey(target)) : null;
          return state
            ? {
              exposure: state.exposure,
              frequency: frequencyAt(state.exposure),
              interval: 1 / frequencyAt(state.exposure),
              cycleProgress: state.cycles
            }
            : null;
        }
      };
    }
  };

  registerBall(electricV3Definition);
  return { electricV3Definition };
});
