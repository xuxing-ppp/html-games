(function initializeGum(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGumPlugin({ registerBall, resolveArenaGeometry }) {
  const BIG_GUM_INTERVAL = 4;
  const BIG_GUM_RADIUS = 5;
  const SMALL_GUM_RADIUS = 2;
  const SMALL_GUM_PLACEMENT_RADIUS = 20;
  const BIG_HEAL = 2;
  const SMALL_HEAL = 1;
  const SMALL_DAMAGE = 1;
  const SLOW_FACTOR = 0.9;
  const SLOW_DURATION = 1;
  const SWING_CAPTURE_DURATION = 0.22;
  const SWING_ORBIT_DURATION = 0.58;
  const SWING_DURATION = SWING_CAPTURE_DURATION + SWING_ORBIT_DURATION;
  const WALL_DAMAGE = 5;
  const LAUNCH_SPEED_MULTIPLIER = 8;
  const EFFECT_LIFE = 1e9;
  const EPSILON = 1e-9;
  const GUM_BURST_LIFE = 0.34;
  const GUM_RIM = "rgba(214, 255, 247, 0.92)";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let directionX = x;
    let directionY = y;
    if (Math.hypot(directionX, directionY) <= EPSILON) {
      directionX = fallbackX;
      directionY = fallbackY;
    }
    const magnitude = Math.hypot(directionX, directionY) || 1;
    return { x: directionX / magnitude, y: directionY / magnitude };
  }

  function easeInCubic(value) {
    return value * value * value;
  }

  function easeOutCubic(value) {
    return 1 - Math.pow(1 - value, 3);
  }

  function touches(ball, x, y, radius) {
    return Math.hypot(ball.x - x, ball.y - y) <= ball.radius + radius;
  }

  function isGumSwinging(ball) {
    return Array.from(ball.effects.keys()).some((id) => (
      typeof id === "string" && id.startsWith("gum-swing-")
    ));
  }

  function heal(services, ball, amount) {
    if (amount <= 0 || ball.hp <= 0) return;
    ball.hp += amount;
    services.spawnHitText(ball, `+${amount}`, { color: "#79ffe3" });
  }

  // 服务未传 random 时使用引擎隔离的视觉流，装饰不消耗战斗 Math.random。
  function spawnGumBurst(burstServices, x, y, kind, options = {}) {
    const radius = Number.isFinite(options.radius) ? options.radius : SMALL_GUM_RADIUS;
    const ringed = options.ring === true;
    burstServices.spawnParticleBurst({
      kind,
      x,
      y,
      count: ringed ? 10 : 6,
      minDiameter: 0.8,
      maxDiameter: 2.6,
      life: GUM_BURST_LIFE,
      minSpeed: 18,
      maxSpeed: 58,
      drag: 3.8,
      initialRadius: Math.max(1, radius * 0.6),
      ring: ringed ? {
        color: "#c6fff5",
        lineWidth: 1.4,
        startRadius: radius,
        endRadius: radius * 2.6
      } : undefined,
      properties: {
        color: {
          overLife: [
            { at: 0, value: "#effffb" },
            { at: 0.45, value: "#9df6e7" },
            { at: 1, value: "#3fb9a6" }
          ]
        },
        opacity: {
          overLife: [
            { at: 0, value: 0.85 },
            { at: 0.6, value: 0.45 },
            { at: 1, value: 0 }
          ]
        },
        sizeScale: {
          overLife: [
            { at: 0, value: 0.6 },
            { at: 1, value: 1.35 }
          ]
        }
      }
    });
  }

  // 叠层减速只产出 0.9^层数的移动与动作倍率。合成、免疫与到期还原都由引擎
  // 统一处理，效果自己不再碰 ball.speedMultiplier 或速度向量。
  function applyStacks(effect, now) {
    effect.stackExpirations = effect.stackExpirations.filter((time) => (
      time > now + EPSILON
    ));
    effect.speedFactor = Math.pow(SLOW_FACTOR, effect.stackExpirations.length);
    effect.attackPeriodScale = 1 / effect.speedFactor;
  }

  function createSlowEffect(source) {
    return {
      id: `gum-slow-${source.instanceId}`,
      duration: SLOW_DURATION,
      speedFactor: 1,
      onApply({ effect, game, isRefresh }) {
        if (!isRefresh) effect.stackExpirations = [];
        effect.stackExpirations = effect.stackExpirations.filter((time) => (
          time > game.time + EPSILON
        ));
        effect.stackExpirations.push(game.time + SLOW_DURATION);
        applyStacks(effect, game.time);
      },
      update({ effect, game }) {
        applyStacks(effect, game.time);
      },

      draw({ ball, effect }, context) {
        const stacks = Math.max(1, effect.stackExpirations.length);
        context.save();
        context.fillStyle = "#9af6e7";
        context.globalAlpha *= 0.72;
        for (let index = 0; index < Math.min(6, stacks + 2); index += 1) {
          const angle = index * Math.PI * 2 / Math.min(6, stacks + 2);
          context.beginPath();
          context.arc(
            ball.x + Math.cos(angle) * (ball.radius + 4),
            ball.y + Math.sin(angle) * (ball.radius + 4),
            1.5,
            0,
            Math.PI * 2
          );
          context.fill();
        }
        context.restore();
      }
    };
  }

  function createWallLaunchEffect(source, directionX, directionY) {
    const direction = normalizeDirection(directionX, directionY);
    return {
      id: `gum-wall-launch-${source.instanceId}`,
      bounceCompatible: true,
      duration: 3,
      locksMovement: true,
      directionX: direction.x,
      directionY: direction.y,
      onApply({ ball, effect }) {
        effect.speed = ball.speed * LAUNCH_SPEED_MULTIPLIER;
        ball.vx = effect.directionX * effect.speed;
        ball.vy = effect.directionY * effect.speed;
      },
      update({ ball, effect }) {
        ball.vx = effect.directionX * effect.speed;
        ball.vy = effect.directionY * effect.speed;
      },
      onWallBounce({ ball, effect, services: effectServices }) {
        effectServices.dealDamage(ball, WALL_DAMAGE);
        effectServices.clearEffect(ball, effect.id);
      },
      onExpire({ ball, effect }) {
        const direction = normalizeDirection(
          ball.vx,
          ball.vy,
          effect.directionX,
          effect.directionY
        );
        const speed = ball.speed * ball.speedMultiplier;
        ball.vx = ball.storedVx = direction.x * speed;
        ball.vy = ball.storedVy = direction.y * speed;
      }
    };
  }

  function createSwingEffect(source, gum, target, onRelease) {
    const startDirection = normalizeDirection(
      target.x - gum.x,
      target.y - gum.y,
      target.vx,
      target.vy
    );
    const startAngle = Math.atan2(startDirection.y, startDirection.x);
    const orbitRadius = Math.max(
      BIG_GUM_RADIUS + target.radius + 2,
      Math.hypot(target.x - gum.x, target.y - gum.y)
    );
    const turnDirection = Math.random() < 0.5 ? 1 : -1;
    const orbitStartX = gum.x + Math.cos(startAngle) * orbitRadius;
    const orbitStartY = gum.y + Math.sin(startAngle) * orbitRadius;

    return {
      id: `gum-swing-${source.instanceId}`,
      duration: SWING_DURATION,
      locksMovement: true,
      startAngle,
      orbitRadius,
      turnDirection,
      orbitStartX,
      orbitStartY,
      onApply({ ball, effect, game }) {
        effect.startedAt = game.time;
        effect.captureStartX = ball.x;
        effect.captureStartY = ball.y;
        effect.captureVx = ball.vx;
        effect.captureVy = ball.vy;
        ball.vx = effect.captureVx;
        ball.vy = effect.captureVy;
      },
      update({ ball, effect, game }) {
        const elapsed = Math.max(0, game.time - effect.startedAt);
        if (elapsed < SWING_CAPTURE_DURATION) {
          const progress = clamp(elapsed / SWING_CAPTURE_DURATION, 0, 1);
          const eased = easeOutCubic(progress);
          ball.x = effect.captureStartX + (effect.orbitStartX - effect.captureStartX) * eased;
          ball.y = effect.captureStartY + (effect.orbitStartY - effect.captureStartY) * eased;
          ball.vx = effect.captureVx * (1 - progress);
          ball.vy = effect.captureVy * (1 - progress);
          effect.releaseAngle = effect.startAngle;
          return;
        }

        const progress = clamp(
          (elapsed - SWING_CAPTURE_DURATION) / SWING_ORBIT_DURATION,
          0,
          1
        );
        const orbitProgress = easeInCubic(progress);
        const angle = effect.startAngle + effect.turnDirection * Math.PI * 2 * orbitProgress;
        ball.x = gum.x + Math.cos(angle) * effect.orbitRadius;
        ball.y = gum.y + Math.sin(angle) * effect.orbitRadius;
        ball.vx = 0;
        ball.vy = 0;
        effect.releaseAngle = angle;
      },
      onExpire({ ball, effect, services: effectServices }) {
        if (typeof onRelease === "function") onRelease();
        spawnGumBurst(effectServices, ball.x, ball.y, "gum-release", {
          radius: 4,
          ring: true
        });
        const angle = effect.releaseAngle != null ? effect.releaseAngle : effect.startAngle;
        const tangentX = -Math.sin(angle) * effect.turnDirection;
        const tangentY = Math.cos(angle) * effect.turnDirection;
        effectServices.applyEffect(
          ball,
          createWallLaunchEffect(source, tangentX, tangentY)
        );
      }
    };
  }

  function drawGum(context, effect, radius) {
    const rimWidth = Math.max(0.7, radius * 0.14);
    context.save();
    context.beginPath();
    context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
    context.fillStyle = "rgba(79, 201, 182, 0.42)";
    context.fill();
    context.beginPath();
    context.arc(
      effect.x - radius * 0.08,
      effect.y - radius * 0.1,
      Math.max(0.5, radius * 0.72),
      0,
      Math.PI * 2
    );
    context.fillStyle = "rgba(131, 237, 222, 0.58)";
    context.fill();
    context.beginPath();
    context.arc(effect.x, effect.y, radius - rimWidth * 0.5, 0, Math.PI * 2);
    context.strokeStyle = GUM_RIM;
    context.lineWidth = rimWidth;
    context.stroke();
    context.beginPath();
    context.arc(
      effect.x,
      effect.y,
      Math.max(0.6, radius * 0.56),
      Math.PI * 0.15,
      Math.PI * 0.85
    );
    context.strokeStyle = "rgba(196, 255, 244, 0.5)";
    context.lineWidth = Math.max(0.5, radius * 0.12);
    context.stroke();
    context.beginPath();
    context.arc(
      effect.x - radius * 0.32,
      effect.y - radius * 0.34,
      Math.max(0.6, radius * 0.26),
      0,
      Math.PI * 2
    );
    context.fillStyle = "rgba(248, 255, 254, 0.95)";
    context.fill();
    context.restore();
  }

  // 分层弹性拉丝：中间点带轻微摆动，两端仍锚在胶团与真实目标中心。
  function drawTether(context, effect, target) {
    const deltaX = target.x - effect.x;
    const deltaY = target.y - effect.y;
    const length = Math.hypot(deltaX, deltaY) || 1;
    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    const wobble = Math.sin((effect.age || 0) * 26) * Math.min(2.4, length * 0.06) +
      Math.min(3, length * 0.02);
    const strands = [
      { width: 3.4, alpha: 0.22, bow: wobble },
      { width: 1.8, alpha: 0.5, bow: wobble * 0.6 },
      { width: 0.9, alpha: 0.85, bow: wobble * 0.25 }
    ];
    context.save();
    context.lineCap = "round";
    for (const strand of strands) {
      context.strokeStyle = `rgba(163, 250, 234, ${strand.alpha})`;
      context.lineWidth = strand.width;
      context.beginPath();
      context.moveTo(effect.x, effect.y);
      for (let step = 1; step < 4; step += 1) {
        const progress = step / 4;
        const bow = Math.sin(Math.PI * progress) * strand.bow;
        context.lineTo(
          effect.x + deltaX * progress + normalX * bow,
          effect.y + deltaY * progress + normalY * bow
        );
      }
      context.lineTo(target.x, target.y);
      context.stroke();
    }
    context.restore();
  }

  function createBigGum(source) {
    return {
      kind: "gum-big",
      life: EFFECT_LIFE,
      x: source.x,
      y: source.y,
      radius: BIG_GUM_RADIUS,
      ownerArmed: false,
      swingTarget: null,
      contacts: new Set(),
      update({ effect, services: gumServices }) {
        if (effect.swingTarget) {
          if (effect.swingTarget.hp <= 0) effect.life = 0;
          return;
        }

        const ownerTouching = touches(source, effect.x, effect.y, effect.radius);
        if (!effect.ownerArmed) {
          effect.ownerArmed = !ownerTouching;
        } else if (ownerTouching) {
          heal(gumServices, source, BIG_HEAL);
          spawnGumBurst(gumServices, effect.x, effect.y, "gum-big-reclaim", {
            radius: BIG_GUM_RADIUS,
            ring: true
          });
          effect.life = 0;
          return;
        }

        const contactTargets = [];
        gumServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
          const profile = gumServices.getContactProfile(target);
          const key = target.instanceId || target.id;
          const touching = touches(target, effect.x, effect.y, effect.radius);
          gumServices.notifyEntityContact(target, effect, { overlapping: touching });
          if (!touching) {
            effect.contacts.delete(key);
            continue;
          }
          const entered = !effect.contacts.has(key);
          effect.contacts.add(key);
          if (
            target.positionLocked ||
            !profile.solid ||
            !profile.attackable ||
            isGumSwinging(target)
          ) continue;
          if (
            entered &&
            gumServices.tryConsumeEntity(target, effect, { physical: true })
          ) {
            effect.life = 0;
            return;
          }
          effect.swingTarget = target;
          gumServices.applyEffect(
            target,
            createSwingEffect(source, effect, target, () => {
              effect.life = 0;
            })
          );
          spawnGumBurst(gumServices, target.x, target.y, "gum-capture", {
            radius: BIG_GUM_RADIUS,
            ring: true
          });
          break;
        }
      },
      draw({ effect }, context) {
        if (effect.swingTarget && effect.swingTarget.hp > 0) {
          drawTether(context, effect, effect.swingTarget);
        }
        drawGum(context, effect, BIG_GUM_RADIUS);
      }
    };
  }

  function createSmallGum(source, x, y) {
    return {
      kind: "gum-small",
      life: EFFECT_LIFE,
      x,
      y,
      radius: SMALL_GUM_RADIUS,
      ownerArmed: false,
      contacts: new Set(),
      update({ effect, services: gumServices }) {
        const ownerTouching = touches(source, effect.x, effect.y, effect.radius);
        if (!effect.ownerArmed) {
          effect.ownerArmed = !ownerTouching;
        } else if (ownerTouching) {
          heal(gumServices, source, SMALL_HEAL);
          spawnGumBurst(gumServices, effect.x, effect.y, "gum-small-reclaim");
          effect.life = 0;
          return;
        }

        const touchingNow = new Set();
        const contactTargets = [];
        gumServices.forEachContactEnemy(target => contactTargets.push(target));
        for (const target of contactTargets) {
          const profile = gumServices.getContactProfile(target);
          const key = target.instanceId || target.id;
          const touching = touches(target, effect.x, effect.y, effect.radius);
          gumServices.notifyEntityContact(target, effect, { overlapping: touching });
          if (touching) touchingNow.add(key);
          if (
            !profile.attackable ||
            !touching
          ) continue;
          if (
            !effect.contacts.has(key) &&
            gumServices.tryConsumeEntity(target, effect, { physical: true })
          ) {
            effect.life = 0;
            return;
          }
          if (gumServices.dealDamage(target, SMALL_DAMAGE)) {
            gumServices.applyEffect(target, createSlowEffect(source));
            spawnGumBurst(gumServices, effect.x, effect.y, "gum-small-hit");
            effect.life = 0;
          }
          break;
        }
        effect.contacts = touchingNow;
      },
      draw({ effect }, context) {
        drawGum(context, effect, SMALL_GUM_RADIUS);
      }
    };
  }

  const gumDefinition = {
    id: "gum",
    name: "\u53e3\u9999\u7cd6",
    englishName: "Chewing Gum",
    color: "#83edde",
    description: "\u7c98\u8fde\u7529\u6295 / \u53e0\u52a0\u51cf\u901f",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let bigGumTimer = 0;
      let bigGumPending = false;
      const activeContacts = new Set();

      function placeSmallGums(context) {
        const count = Math.random() < 0.5 ? 1 : 2;
        for (let index = 0; index < count; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * SMALL_GUM_PLACEMENT_RADIUS;
          const { x, y } = resolveArenaGeometry(context.game).clampPoint(
            context.ball.x + Math.cos(angle) * distance,
            context.ball.y + Math.sin(angle) * distance, SMALL_GUM_RADIUS);
          services.spawnCombatEntity(createSmallGum(context.ball, x, y));
          spawnGumBurst(services, x, y, "gum-small-spawn");
        }
      }

      return {
        update(_context, dt) {
          bigGumTimer = Math.min(
            BIG_GUM_INTERVAL,
            bigGumTimer + Math.max(0, dt)
          );
          bigGumPending = bigGumTimer + EPSILON >= BIG_GUM_INTERVAL;
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, BIG_GUM_INTERVAL - bigGumTimer);
        },
        afterUpdateStep(context) {
          if (!bigGumPending) return;
          bigGumPending = false;
          bigGumTimer = 0;
          services.spawnCombatEntity(createBigGum(context.ball));
          spawnGumBurst(services, context.ball.x, context.ball.y, "gum-big-spawn", {
            radius: BIG_GUM_RADIUS
          });
        },
        onContactUpdate(context, target) {
          const key = target.instanceId || target.id;
          if (!context.overlapping || !context.selfContact.solid || !context.targetContact.solid) {
            activeContacts.delete(key);
            return;
          }
          if (activeContacts.has(key)) return;
          activeContacts.add(key);
          placeSmallGums(context);
        },
        onEntityCollision(context) {
          placeSmallGums(context);
        },
        onWallBounce(context) {
          placeSmallGums(context);
          spawnGumBurst(services, context.ball.x, context.ball.y, "gum-wall", {
            radius: BIG_GUM_RADIUS * 0.6
          });
        },
        onDamaged(context, event) {
          if (event.options && event.options.wallImpact === true) {
            placeSmallGums(context);
          }
        }
      };
    }
  };

  registerBall(gumDefinition);
  return { gumDefinition };
});
