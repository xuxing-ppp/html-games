(function initializeBilliards(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBilliardsPlugin({ registerBall }) {
  const ATTACK_INTERVAL = 2.85;
  const COUNTER_CHANCE = 0.02;
  const SLOW_CHANCE = 0.6;
  const TABLE_LENGTH = 80;
  const TABLE_WIDTH = 40;
  const SLOW_SPEED_MULTIPLIER = 2;
  const FAST_SPEED_MULTIPLIER = 0.5;
  const SLOW_ROTATION_PERIOD = 1.5;
  const FAST_ROTATION_PERIOD = 0.3;
  const SLOW_DAMAGE = 5;
  const COUNTER_DAMAGE = 2;
  const WALL_DAMAGE = 3;
  const COUNTER_BOUNCES = 5;
  const DAZE_DURATION = 1;
  const DAZE_SPEED_FACTOR = 1 / 8;
  const EPSILON = 1e-9;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
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

  function aimAt(source, target) {
    return normalizeDirection(
      target.x - source.x,
      target.y - source.y,
      source.storedVx || source.vx,
      source.storedVy || source.vy
    );
  }

  function tableExtents(angle) {
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    return {
      x: cosine * TABLE_LENGTH / 2 + sine * TABLE_WIDTH / 2,
      y: sine * TABLE_LENGTH / 2 + cosine * TABLE_WIDTH / 2
    };
  }

  function clampCircularTable(effect, arena) {
    const dx = effect.x - arena.centerX;
    const dy = effect.y - arena.centerY;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= EPSILON) return;
    const cosine = Math.cos(effect.angle);
    const sine = Math.sin(effect.angle);
    const cornerProjection = Math.abs(dx * cosine + dy * sine) * TABLE_LENGTH / 2 +
      Math.abs(-dx * sine + dy * cosine) * TABLE_WIDTH / 2;
    const clearance = arena.width * arena.width / 4 - (TABLE_LENGTH * TABLE_LENGTH + TABLE_WIDTH * TABLE_WIDTH) / 4;
    const scale = clearance < 0 ? 0 : clamp(
      (-cornerProjection + Math.sqrt(cornerProjection * cornerProjection + distanceSquared * clearance)) / distanceSquared,
      0, 1
    );
    effect.x = arena.centerX + dx * scale;
    effect.y = arena.centerY + dy * scale;
  }

  function tableContact(effect, target) {
    const cosine = Math.cos(effect.angle);
    const sine = Math.sin(effect.angle);
    const deltaX = target.x - effect.x;
    const deltaY = target.y - effect.y;
    const localX = deltaX * cosine + deltaY * sine;
    const localY = -deltaX * sine + deltaY * cosine;
    let closestX = clamp(localX, -TABLE_LENGTH / 2, TABLE_LENGTH / 2);
    let closestY = clamp(localY, -TABLE_WIDTH / 2, TABLE_WIDTH / 2);
    let normalLocalX = localX - closestX;
    let normalLocalY = localY - closestY;
    let distance = Math.hypot(normalLocalX, normalLocalY);

    if (distance <= EPSILON) {
      const horizontalGap = TABLE_LENGTH / 2 - Math.abs(localX);
      const verticalGap = TABLE_WIDTH / 2 - Math.abs(localY);
      if (horizontalGap < verticalGap) {
        normalLocalX = localX < 0 ? -1 : 1;
        normalLocalY = 0;
        closestX = normalLocalX * TABLE_LENGTH / 2;
      } else {
        normalLocalX = 0;
        normalLocalY = localY < 0 ? -1 : 1;
        closestY = normalLocalY * TABLE_WIDTH / 2;
      }
      distance = 0;
    } else {
      normalLocalX /= distance;
      normalLocalY /= distance;
    }

    if (distance > target.radius) return null;
    return {
      normalX: normalLocalX * cosine - normalLocalY * sine,
      normalY: normalLocalX * sine + normalLocalY * cosine,
      contactX: effect.x + closestX * cosine - closestY * sine,
      contactY: effect.y + closestX * sine + closestY * cosine
    };
  }

  function smokeBurstOptions(x, y, color) {
    return {
      kind: "billiards-smoke",
      x,
      y,
      life: 0.65,
      density: 1.25,
      minDiameter: 1,
      maxDiameter: 5,
      minSpeed: 38,
      maxSpeed: 118,
      initialRadius: 4,
      drag: 2.5,
      gravityY: -10,
      colors: ["#d8ddd8", "#7c8580", color]
    };
  }

  function createDazeEffect(directionX, directionY) {
    const direction = normalizeDirection(directionX, directionY);
    return {
      id: "billiards-daze",
      bounceCompatible: true,
      visualType: "stun",
      duration: DAZE_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      directionX: direction.x,
      directionY: direction.y,
      onApply({ ball, effect, isRefresh }) {
        if (!isRefresh) {
          const recovery = normalizeDirection(
            ball.storedVx,
            ball.storedVy,
            effect.directionX,
            effect.directionY
          );
          effect.recoveryX = recovery.x;
          effect.recoveryY = recovery.y;
        }
        const speed = ball.speed * ball.speedMultiplier * DAZE_SPEED_FACTOR;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      update({ ball, effect }) {
        const speed = ball.speed * ball.speedMultiplier * DAZE_SPEED_FACTOR;
        ball.vx = effect.directionX * speed;
        ball.vy = effect.directionY * speed;
      },
      onWallBounce({ ball, effect }) {
        const direction = normalizeDirection(
          ball.vx,
          ball.vy,
          effect.directionX,
          effect.directionY
        );
        effect.directionX = direction.x;
        effect.directionY = direction.y;
      },
      onExpire({ ball, effect }) {
        const direction = normalizeDirection(
          effect.recoveryX,
          effect.recoveryY,
          effect.directionX,
          effect.directionY
        );
        const speed = ball.speed * ball.speedMultiplier;
        ball.vx = ball.storedVx = direction.x * speed;
        ball.vy = ball.storedVy = direction.y * speed;
      },
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 50) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -1 : (frame === 3 ? 1 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    };
  }

  function createWallLaunchEffect(source, directionX, directionY, speed) {
    const direction = normalizeDirection(directionX, directionY);
    let completed = false;

    function enterDaze(ball, effectServices) {
      if (completed) return;
      completed = true;
      const rebound = normalizeDirection(ball.vx, ball.vy, -direction.x, -direction.y);
      effectServices.dealDamage(ball, WALL_DAMAGE);
      effectServices.spawnParticleBurst(smokeBurstOptions(ball.x, ball.y, source.color));
      if (ball.hp > 0) {
        effectServices.applyEffect(ball, createDazeEffect(rebound.x, rebound.y));
      }
    }

    return {
      id: "billiards-wall-launch",
      bounceCompatible: true,
      duration: 2,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      onApply({ ball, effect }) {
        effect.speed = speed;
        ball.vx = direction.x * speed;
        ball.vy = direction.y * speed;
      },
      update({ ball, effect }) {
        ball.vx = direction.x * effect.speed;
        ball.vy = direction.y * effect.speed;
      },
      onWallBounce({ ball, effect, services: effectServices }) {
        enterDaze(ball, effectServices);
        effectServices.clearEffect(ball, effect.id);
      },
      onExpire({ ball, services: effectServices }) {
        if (!completed && ball.hp > 0) enterDaze(ball, effectServices);
      }
    };
  }

  function drawPoolTable(context, effect) {
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(effect.angle);
    context.globalAlpha *= effect.solid ? 1 : 0.82;
    context.shadowColor = effect.variant === "fast" ? "#d8ff83" : "#5ee2aa";
    context.shadowBlur = effect.variant === "fast" ? 8 : 4;
    context.fillStyle = "#24150f";
    context.fillRect(-42, -22, 84, 44);
    context.fillStyle = "#714322";
    context.fillRect(-40, -20, 80, 40);
    context.fillStyle = "#123e2c";
    context.fillRect(-34, -14, 68, 28);
    context.fillStyle = "#176444";
    context.fillRect(-31, -11, 62, 22);
    context.fillStyle = "#70a88b";
    context.fillRect(-31, -11, 62, 2);
    context.fillRect(-31, 9, 62, 2);

    const pockets = [
      [-35, -15], [0, -15], [35, -15],
      [-35, 15], [0, 15], [35, 15]
    ];
    context.shadowBlur = 0;
    pockets.forEach(([x, y]) => {
      context.fillStyle = "#050605";
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#a36c39";
      context.fillRect(x - 1, y - 3, 2, 1);
    });

    const ballColors = ["#f8f1d5", "#ffd644", "#e84848", "#4c8ff0"];
    ballColors.forEach((color, index) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(-9 + index * 6, index % 2 === 0 ? -2 : 3, 2.2, 0, Math.PI * 2);
      context.fill();
    });
    context.strokeStyle = effect.variant === "fast" ? "#e8ff9a" : "#b7ead2";
    context.lineWidth = 1;
    context.strokeRect(-40, -20, 80, 40);
    context.restore();
  }

  function isOutsideArena(effect, arena) {
    if (arena.shape === "circle") {
      return !tableContact(effect, {
        x: arena.centerX, y: arena.centerY, radius: arena.width / 2
      });
    }
    const extent = tableExtents(effect.angle);
    return (
      effect.x + extent.x < arena.left || effect.x - extent.x > arena.right ||
      effect.y + extent.y < arena.top || effect.y - extent.y > arena.bottom
    );
  }

  function bounceCounterTable(effect, arena, previousX, previousY) {
    if (effect.escaping) return;
    if (arena.shape === "circle") {
      const cosine = Math.cos(effect.angle);
      const sine = Math.sin(effect.angle);
      let hit = null;
      for (const x of [-TABLE_LENGTH / 2, TABLE_LENGTH / 2]) {
        for (const y of [-TABLE_WIDTH / 2, TABLE_WIDTH / 2]) {
          const offsetX = x * cosine - y * sine;
          const offsetY = x * sine + y * cosine;
          const candidate = arena.traceSegment(
            previousX + offsetX, previousY + offsetY,
            effect.x + offsetX, effect.y + offsetY
          );
          if (candidate && (!hit || candidate.t < hit.t)) hit = candidate;
        }
      }
      if (!hit) return;
      effect.x = previousX + (effect.x - previousX) * hit.t;
      effect.y = previousY + (effect.y - previousY) * hit.t;
      const incoming = effect.vx * hit.normalX + effect.vy * hit.normalY;
      if (incoming < 0) {
        effect.vx -= 2 * incoming * hit.normalX;
        effect.vy -= 2 * incoming * hit.normalY;
      }
      effect.angle = Math.atan2(effect.vy, effect.vx);
      // Reflection rotates the table as well as its flight direction.
      // Keep every corner inside after that instantaneous rotation.
      clampCircularTable(effect, arena);
      effect.bounceCount += 1;
      if (effect.bounceCount >= COUNTER_BOUNCES) effect.escaping = true;
      return;
    }
    const extent = tableExtents(effect.angle);
    let bounced = false;
    if (effect.x - extent.x < arena.left) {
      effect.x = arena.left + extent.x;
      effect.vx = Math.abs(effect.vx);
      bounced = true;
    } else if (effect.x + extent.x > arena.right) {
      effect.x = arena.right - extent.x;
      effect.vx = -Math.abs(effect.vx);
      bounced = true;
    }
    if (effect.y - extent.y < arena.top) {
      effect.y = arena.top + extent.y;
      effect.vy = Math.abs(effect.vy);
      bounced = true;
    } else if (effect.y + extent.y > arena.bottom) {
      effect.y = arena.bottom - extent.y;
      effect.vy = -Math.abs(effect.vy);
      bounced = true;
    }
    if (!bounced) return;
    effect.angle = Math.atan2(effect.vy, effect.vx);
    effect.bounceCount += 1;
    if (effect.bounceCount >= COUNTER_BOUNCES) effect.escaping = true;
  }

  function resolveCounterContact(tableServices, effect, target, contact, arena) {
    const key = target.instanceId || target.id;
    if (!tableServices.getContactProfile(target).solid) {
      effect.contacts.delete(key);
      return;
    }
    if (!effect.contacts.has(key)) {
      if (!tableServices.dealDamage(target, COUNTER_DAMAGE)) return;
      effect.contacts.add(key);
    }
    target.x = contact.contactX + contact.normalX * target.radius;
    target.y = contact.contactY + contact.normalY * target.radius;
    if (arena) Object.assign(target, arena.clampPoint(target.x, target.y, target.radius));
    const incoming = target.vx * contact.normalX + target.vy * contact.normalY;
    if (incoming < 0) {
      target.vx -= incoming * 2 * contact.normalX;
      target.vy -= incoming * 2 * contact.normalY;
      target.storedVx = target.vx;
      target.storedVy = target.vy;
    }
  }

  function updateContacts(tableServices, effect, arena) {
    const touching = new Set();
    const targets = [];
    tableServices.forEachContactEnemy(target => targets.push(target));
    for (const target of targets) {
      const contact = tableContact(effect, target);
      tableServices.notifyEntityContact(target, effect, { overlapping: effect.solid && Boolean(contact) });
      if (!contact) continue;
      const key = target.instanceId || target.id;
      touching.add(key);
      const profile = tableServices.getContactProfile(target);
      if (
        effect.solid &&
        profile.attackable &&
        !effect.contacts.has(key) &&
        tableServices.tryConsumeEntity(target, effect, { physical: true })
      ) {
        effect.contacts.add(key);
        effect.life = 0;
        return;
      }
      if (effect.variant === "counter") {
        resolveCounterContact(tableServices, effect, target, contact, arena);
        continue;
      }
      if (effect.variant === "slow") {
        if (!profile.attackable) continue;
        if (!tableServices.dealDamage(target, SLOW_DAMAGE)) continue;
        tableServices.spawnParticleBurst(smokeBurstOptions(
          effect.x,
          effect.y,
          effect.owner.color
        ));
        if (target.hp > 0) {
          const direction = normalizeDirection(target.vx, target.vy, effect.vx, effect.vy);
          tableServices.applyEffect(target, createDazeEffect(direction.x, direction.y));
        }
        effect.life = 0;
        return;
      }
      if (!profile.solid) continue;
      if (effect.contacts.has(key)) continue;
      effect.contacts.add(key);
      let radialX = target.x - effect.x;
      let radialY = target.y - effect.y;
      if (Math.hypot(radialX, radialY) <= EPSILON) {
        radialX = Math.cos(effect.angle);
        radialY = Math.sin(effect.angle);
      }
      const tangentX = effect.spinSign > 0 ? -radialY : radialY;
      const tangentY = effect.spinSign > 0 ? radialX : -radialX;
      const launchDirection = normalizeDirection(tangentX, tangentY, effect.vx, effect.vy);
      const launchSpeed = Math.max(
        target.speed * 4,
        Math.abs(effect.angularVelocity) * TABLE_LENGTH / 2
      );
      tableServices.applyEffect(
        target,
        createWallLaunchEffect(
          effect.owner,
          launchDirection.x,
          launchDirection.y,
          launchSpeed
        )
      );
    }
    if (effect.variant === "counter" || effect.variant === "fast") {
      for (const key of effect.contacts) {
        if (!touching.has(key)) effect.contacts.delete(key);
      }
    }
  }

  function advanceTable(tableServices, effect, game, dt) {
    if (game.state !== "running") {
      effect.life = 0;
      return;
    }
    let remaining = Math.max(0, dt);
    if (remaining <= EPSILON) {
      updateContacts(tableServices, effect, game.arena);
      return;
    }
    const speed = Math.hypot(effect.vx, effect.vy);
    const rotationSpeed = Math.abs(effect.angularVelocity || 0);
    const maxStep = Math.min(
      0.025,
      speed > EPSILON ? 5 / speed : 0.025,
      rotationSpeed > EPSILON ? Math.PI / 18 / rotationSpeed : 0.025
    );
    while (remaining > EPSILON && effect.life > 0) {
      const step = Math.min(remaining, maxStep);
      const previousX = effect.x;
      const previousY = effect.y;
      effect.x += effect.vx * step;
      effect.y += effect.vy * step;
      if (effect.variant === "counter") {
        effect.angle = Math.atan2(effect.vy, effect.vx);
        bounceCounterTable(effect, game.arena, previousX, previousY);
      } else {
        effect.angle += effect.angularVelocity * step;
      }
      updateContacts(tableServices, effect, game.arena);
      if (effect.escaping && isOutsideArena(effect, game.arena)) effect.life = 0;
      if (effect.variant !== "counter" && isOutsideArena(effect, game.arena)) {
        effect.life = 0;
      }
      remaining -= step;
    }
  }

  function createTable(source, options) {
    const direction = options.direction;
    return {
      kind: `billiards-${options.variant}-table`,
      life: options.variant === "counter" ? 30 : 8,
      variant: options.variant,
      solid: options.solid,
      length: TABLE_LENGTH,
      width: TABLE_WIDTH,
      x: source.x,
      y: source.y,
      vx: direction.x * options.speed,
      vy: direction.y * options.speed,
      angle: Math.atan2(direction.y, direction.x),
      angularVelocity: options.angularVelocity || 0,
      spinSign: options.spinSign || 0,
      bounceCount: 0,
      escaping: false,
      contacts: new Set(),
      update({ effect, game, services: tableServices }, dt) {
        advanceTable(tableServices, effect, game, dt);
      },
      draw({ effect }, context) {
        drawPoolTable(context, effect);
      }
    };
  }

  const billiardsDefinition = {
    id: "billiards",
    name: "\u53f0\u7403\u684c",
    englishName: "Billiards Table",
    color: "#0b5d3b",
    description: "\u5b50\u5f39\u53cd\u5236 / \u4f4e\u901f\u7206\u70b8 / \u9ad8\u901f\u65cb\u8f6c\u51fb\u98de",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let attackTimer = 0;

      function fireActiveTable(ball, target) {
        const direction = aimAt(ball, target);
        const slow = Math.random() < SLOW_CHANCE;
        const spinSign = Math.random() < 0.5 ? -1 : 1;
        const rotationPeriod = slow ? SLOW_ROTATION_PERIOD : FAST_ROTATION_PERIOD;
        services.spawnCombatEntity(createTable(ball, {
          variant: slow ? "slow" : "fast",
          solid: !slow,
          direction,
          speed: ball.speed * (slow ? SLOW_SPEED_MULTIPLIER : FAST_SPEED_MULTIPLIER),
          angularVelocity: spinSign * Math.PI * 2 / rotationPeriod,
          spinSign
        }));
      }

      return {
        update(_context, dt) {
          attackTimer = Math.min(ATTACK_INTERVAL, attackTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, ATTACK_INTERVAL - attackTimer);
        },
        afterUpdateStep(context) {
          if (attackTimer + EPSILON < ATTACK_INTERVAL) return;
          attackTimer = 0;
          const target = services.getOpponent();
          if (target) fireActiveTable(context.ball, target);
        },
        onEnemyProjectileSpawned(context) {
          const attackBlocked = Array.from(context.ball.effects.values()).some((effect) => (
            effect.preventsAttack && effect.expiresAt > context.game.time
          ));
          if (attackBlocked || Math.random() >= COUNTER_CHANCE) return;
          const target = context.source;
          const direction = target
            ? aimAt(context.ball, target)
            : normalizeDirection(context.projectile.vx, context.projectile.vy);
          services.spawnCombatEntity(createTable(context.ball, {
            variant: "counter",
            solid: true,
            direction,
            speed: context.speed
          }));
        }
      };
    }
  };

  registerBall(billiardsDefinition);
  return { billiardsDefinition };
});
