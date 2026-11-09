(function initializeDisco(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDiscoPlugin({ registerBall, resolveArenaGeometry }) {
  const FIRE_INTERVAL = 3;
  const DOMAIN_COOLDOWN = 4;
  const DOMAIN_TRANSFER_DURATION = 0.75;
  const DOMAIN_DURATION = 1.3;
  const GRID_SIZE = 3;
  const BULLET_MIN_COUNT = 5;
  const BULLET_MAX_COUNT = 10;
  const BULLET_SPEED = 420;
  const BULLET_RADIUS = 4;
  const BULLET_LIFE = 2.5;
  const DANCE_DURATION = 1.8;
  const DANCE_TICK_INTERVAL = 0.6;
  const DANCE_TICK_DAMAGE = 1;
  const DANCE_NOTE_INTERVAL = 0.16;
  const CELL_FLASH_DURATION = 0.3;
  const EPSILON = 1e-9;

  const DISCO_COLORS = Object.freeze([
    "#ff4f72",
    "#ffcf4a",
    "#3ce6a0",
    "#42d9ff",
    "#a77bff",
    "#ff8edb",
    "#f4ef73",
    "#73a9ff",
    "#ff8b45"
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function randomInteger(minimum, maximum) {
    return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
  }

  function shuffle(values) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }
    return result;
  }

  function easeInOutCubic(value) {
    const progress = clamp(value, 0, 1);
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function cellIndexAt(x, y, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const boundedX = clamp(x - arena.left, 0, arena.width - EPSILON);
    const boundedY = clamp(y - arena.top, 0, arena.height - EPSILON);
    return Math.floor(boundedY / (arena.height / GRID_SIZE)) * GRID_SIZE +
      Math.floor(boundedX / (arena.width / GRID_SIZE));
  }

  function createDanceNote(x, y, index) {
    const angle = Math.random() * Math.PI * 2;
    const shape = index % 3;
    return {
      kind: "disco-dance-note",
      life: 0.72 + (index % 3) * 0.08,
      x,
      y,
      vx: Math.cos(angle) * (10 + Math.random() * 20),
      vy: -18 - Math.random() * 24,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 5,
      color: DISCO_COLORS[index % DISCO_COLORS.length],
      shape,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.translate(effect.x, effect.y);
        context.rotate(effect.rotation + effect.age * effect.rotationSpeed);
        context.fillStyle = effect.color;
        context.strokeStyle = "rgba(255,255,255,0.72)";
        context.lineWidth = 0.65;
        context.beginPath();
        if (effect.shape === 0) {
          context.moveTo(0, -4);
          context.lineTo(3.2, 0);
          context.lineTo(0, 4);
          context.lineTo(-3.2, 0);
        } else if (effect.shape === 1) {
          context.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI * 2);
        } else {
          context.moveTo(-3, -3);
          context.lineTo(3, -3);
          context.lineTo(3, 3);
          context.lineTo(-3, 3);
        }
        context.closePath();
        context.fill();
        context.stroke();
        context.restore();
      },
      update({ effect }, dt) {
        const elapsed = Math.max(0, dt);
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;
        effect.vy += 8 * elapsed;
      }
    };
  }

  function createDanceEffect() {
    return {
      id: "disco-dance",
      duration: DANCE_DURATION,
      locksMovement: true,
      preventsAttack: true,
      blocksDamageOutput: true,
      pausesBehavior: true,
      visualType: "disco-dance",
      onApply({ ball, effect, isRefresh, services }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx;
          effect.savedVy = ball.storedVy;
          // Domain behaviors restore their own velocity after releasing a position lock.
          effect.positionLockedAtApply = ball.positionLocked === true;
          effect.phaseOffset = Math.random() * Math.PI * 2;
        }
        effect.tickTimer = 0;
        effect.noteTimer = 0;
        effect.tickCount = 0;
        ball.vx = 0;
        ball.vy = 0;
        for (let index = 0; index < 5; index += 1) {
          services.spawnVisualEffect(createDanceNote(
            ball.x + (Math.random() - 0.5) * ball.radius * 1.4,
            ball.y + (Math.random() - 0.5) * ball.radius * 1.4,
            index
          ));
        }
      },
      update({ ball, effect, services }, dt) {
        const elapsed = Math.max(0, dt);
        ball.vx = 0;
        ball.vy = 0;
        effect.tickTimer += elapsed;
        while (
          effect.tickCount < 3 &&
          effect.tickTimer + EPSILON >= DANCE_TICK_INTERVAL
        ) {
          effect.tickTimer -= DANCE_TICK_INTERVAL;
          effect.tickCount += 1;
          services.dealDamage(ball, DANCE_TICK_DAMAGE);
        }
        effect.noteTimer += elapsed;
        while (effect.noteTimer + EPSILON >= DANCE_NOTE_INTERVAL) {
          effect.noteTimer -= DANCE_NOTE_INTERVAL;
          services.spawnVisualEffect(createDanceNote(
            ball.x + (Math.random() - 0.5) * ball.radius * 1.4,
            ball.y + (Math.random() - 0.5) * ball.radius * 1.4,
            effect.tickCount + Math.floor(effect.noteTimer * 100)
          ));
        }
      },
      onExpire({ ball, effect }) {
        if (effect.positionLockedAtApply) return;
        ball.vx = ball.storedVx = effect.savedVx || 0;
        ball.vy = ball.storedVy = effect.savedVy || 0;
      },
      drawBefore({ effect, game }, context) {
        const sway = Math.sin(game.time * 18 + effect.phaseOffset) * 3.5;
        context.translate(sway, Math.cos(game.time * 13 + effect.phaseOffset) * 1.2);
      }
    };
  }

  function drawDiscoBullet(context, effect) {
    const angle = Math.atan2(effect.vy, effect.vx);
    context.save();
    context.translate(effect.x, effect.y);
    context.rotate(angle);

    context.globalAlpha *= 0.7;
    context.strokeStyle = effect.color;
    context.lineWidth = 6;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-28, 0);
    context.lineTo(-4, 0);
    context.stroke();
    context.globalAlpha *= 1.35;
    context.lineWidth = 1.5;
    for (let index = 0; index < 5; index += 1) {
      context.strokeStyle = DISCO_COLORS[(effect.colorIndex + index) % DISCO_COLORS.length];
      context.beginPath();
      context.moveTo(-26 + index * 5, -2.2);
      context.lineTo(-23 + index * 5, 2.2);
      context.stroke();
    }

    context.globalAlpha = 1;
    context.fillStyle = "#ffffff";
    context.shadowColor = effect.color;
    context.shadowBlur = 4;
    context.beginPath();
    context.arc(0, 0, BULLET_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function createDiscoBullet(source, angle, colorIndex) {
    return {
      kind: "disco-bullet",
      life: BULLET_LIFE,
      radius: BULLET_RADIUS,
      damage: 0,
      replayDamage: 0,
      color: DISCO_COLORS[colorIndex % DISCO_COLORS.length],
      colorIndex,
      x: source.x + Math.cos(angle) * (source.radius + 7),
      y: source.y + Math.sin(angle) * (source.radius + 7),
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      update({ effect, game, services }, dt) {
        const elapsed = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;
        const target = services.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          BULLET_RADIUS
        );
        if (target) {
          services.applyEffect(target, createDanceEffect());
          effect.life = 0;
          effect.entityActive = false;
          return;
        }
        if (
          !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, BULLET_RADIUS)
        ) {
          effect.life = 0;
          effect.entityActive = false;
        }
      },
      draw({ effect }, context) {
        drawDiscoBullet(context, effect);
      }
    };
  }

  function createLaunchParticles(x, y, angles) {
    const particles = [];
    angles.forEach((angle, angleIndex) => {
      for (let index = 0; index < 4; index += 1) {
        const particleAngle = angle + (Math.random() - 0.5) * 0.28;
        particles.push({
          x,
          y,
          vx: Math.cos(particleAngle) * (90 + Math.random() * 190),
          vy: Math.sin(particleAngle) * (90 + Math.random() * 190),
          angle: particleAngle,
          length: 3 + Math.random() * 5,
          width: 1 + Math.random() * 2,
          color: DISCO_COLORS[(angleIndex * 4 + index) % DISCO_COLORS.length]
        });
      }
    });
    return {
      kind: "disco-launch-particles",
      life: 0.55,
      x,
      y,
      particles,
      update({ effect }, dt) {
        const elapsed = Math.max(0, dt);
        effect.particles.forEach((particle) => {
          particle.x += particle.vx * elapsed;
          particle.y += particle.vy * elapsed;
          particle.vx *= Math.exp(-2.6 * elapsed);
          particle.vy *= Math.exp(-2.6 * elapsed);
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        effect.particles.forEach((particle) => {
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(particle.angle);
          context.fillStyle = particle.color;
          if (typeof context.ellipse === "function") {
            context.beginPath();
            context.ellipse(0, 0, particle.length, particle.width, 0, 0, Math.PI * 2);
            context.fill();
          } else {
            context.fillRect(-particle.length, -particle.width, particle.length * 2, particle.width * 2);
          }
          context.restore();
        });
        context.restore();
      }
    };
  }

  function createTransferSpark(x, y, index) {
    return {
      kind: "disco-domain-spark",
      life: 0.25 + (index % 3) * 0.04,
      x,
      y,
      color: DISCO_COLORS[index % DISCO_COLORS.length],
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.fillStyle = effect.color;
        context.translate(Math.round(effect.x), Math.round(effect.y));
        context.rotate(Math.PI / 4);
        context.fillRect(-2, -2, 4, 4);
        context.restore();
      }
    };
  }

  function leaveTransferSparks(services, state, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= EPSILON) return;
    let nextDistance = 8 - (state.remainder || 0);
    while (nextDistance <= distance + EPSILON) {
      const progress = nextDistance / distance;
      services.spawnVisualEffect(createTransferSpark(
        startX + deltaX * progress,
        startY + deltaY * progress,
        state.index || 0
      ));
      state.index = (state.index || 0) + 1;
      nextDistance += 8;
    }
    state.remainder = (state.remainder + distance) % 8;
  }

  function drawDiscoBody(context, ball) {
    const radius = ball.radius;
    const centerX = ball.x;
    const centerY = ball.y;
    context.save();
    context.translate(centerX, centerY);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.clip();
    context.fillStyle = "#103b59";
    context.fillRect(-radius, -radius, radius * 2, radius * 2);
    for (let index = 0; index < 12; index += 1) {
      const start = index * Math.PI * 2 / 12;
      const end = start + Math.PI * 2 / 12;
      context.beginPath();
      context.moveTo(0, 0);
      context.arc(0, 0, radius + 1, start, end);
      context.closePath();
      context.fillStyle = DISCO_COLORS[(index + 3) % DISCO_COLORS.length];
      context.globalAlpha = 0.32;
      context.fill();
    }
    context.globalAlpha = 0.7;
    context.strokeStyle = "#a8f4ff";
    context.lineWidth = 0.7;
    for (let offset = -radius; offset <= radius; offset += 5) {
      context.beginPath();
      context.moveTo(-radius, offset);
      context.lineTo(radius, offset * 0.42);
      context.stroke();
      context.beginPath();
      context.moveTo(offset, -radius);
      context.lineTo(offset * 0.42, radius);
      context.stroke();
    }
    context.globalAlpha = 1;
    context.fillStyle = "#ecffff";
    [[-6, -7], [4, -4], [7, 3], [-2, 7]].forEach(([x, y], index) => {
      context.fillStyle = DISCO_COLORS[(index + 3) % DISCO_COLORS.length];
      context.fillRect(x, y, 2, 2);
    });
    context.restore();

    context.save();
    context.strokeStyle = "#a8f4ff";
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawDomainGrid(context, arenaSize, values, opacity, flashes, now) {
    if (opacity <= 0 || !values) return;
    const arena = resolveArenaGeometry(arenaSize);
    const cellWidth = arena.width / GRID_SIZE, cellHeight = arena.height / GRID_SIZE;
    context.save();
    context.globalAlpha *= clamp(opacity, 0, 1);
    for (let index = 0; index < GRID_SIZE * GRID_SIZE; index += 1) {
      const column = index % GRID_SIZE;
      const row = Math.floor(index / GRID_SIZE);
      context.fillStyle = DISCO_COLORS[index % DISCO_COLORS.length];
      context.globalAlpha = clamp(opacity, 0, 1) * 0.2;
      context.fillRect(arena.left + column * cellWidth, arena.top + row * cellHeight, cellWidth, cellHeight);
    }
    for (const flash of flashes) {
      const age = now - flash.time;
      if (age < 0 || age >= CELL_FLASH_DURATION) continue;
      const column = flash.index % GRID_SIZE;
      const row = Math.floor(flash.index / GRID_SIZE);
      context.globalAlpha = clamp(opacity, 0, 1) * (1 - age / CELL_FLASH_DURATION) * 0.78;
      context.fillStyle = "#ffffff";
      context.fillRect(arena.left + column * cellWidth, arena.top + row * cellHeight, cellWidth, cellHeight);
    }
    context.globalAlpha = clamp(opacity, 0, 1) * 0.88;
    context.strokeStyle = "rgba(255,255,255,0.82)";
    context.lineWidth = 1.5;
    context.beginPath();
    for (let line = 1; line < GRID_SIZE; line += 1) {
      const x = arena.left + Math.round(cellWidth * line) + 0.5;
      const y = arena.top + Math.round(cellHeight * line) + 0.5;
      context.moveTo(x, arena.top);
      context.lineTo(x, arena.bottom);
      context.moveTo(arena.left, y);
      context.lineTo(arena.right, y);
    }
    context.stroke();
    context.globalAlpha = clamp(opacity, 0, 1) * 0.92;
    context.fillStyle = "#ffffff";
    context.font = '700 18px "Ball Impact", Impact, "Arial Black", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    values.forEach((value, index) => {
      const column = index % GRID_SIZE;
      const row = Math.floor(index / GRID_SIZE);
      context.fillText(
        String(value),
        arena.left + (column + 0.5) * cellWidth,
        arena.top + (row + 0.5) * cellHeight
      );
    });
    context.restore();
  }

  const discoDefinition = {
    id: "disco",
    name: "迪斯科",
    englishName: "Disco",
    color: "#49c8e8",
    description: "3秒彩色环射 / 舞动音符 / 4秒九宫格领域",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let fireTimer = 0;
      let domainCooldown = 0;
      let phase = "normal";
      let phaseTime = 0;
      let origin = null;
      let savedVelocity = null;
      let domainNumbers = shuffle(Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => index + 1));
      let domainTargetCells = new Map();
      let cellFlashes = [];
      let transferSparkState = { remainder: 0, index: 0 };
      let lastTime = 0;
      // 领域只接管自己造成的锁定：进场前若已被别的机制钉住，退场要把原值还回去。
      let lockedBeforeDomain = { position: false, movement: false };

      function recordCellFlash(index, time) {
        cellFlashes = cellFlashes.filter((flash) => time - flash.time < CELL_FLASH_DURATION);
        cellFlashes.push({ index, time });
      }

      function updateTransfer(ball, start, end) {
        const previousX = ball.x;
        const previousY = ball.y;
        const progress = easeInOutCubic(phaseTime / DOMAIN_TRANSFER_DURATION);
        ball.x = start.x + (end.x - start.x) * progress;
        ball.y = start.y + (end.y - start.y) * progress;
        leaveTransferSparks(
          services,
          transferSparkState,
          previousX,
          previousY,
          ball.x,
          ball.y
        );
      }

      function enterDomain(ball) {
        phase = "enter";
        phaseTime = 0;
        origin = { x: ball.x, y: ball.y };
        savedVelocity = {
          x: ball.storedVx || ball.vx,
          y: ball.storedVy || ball.vy
        };
        domainNumbers = shuffle(Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => index + 1));
        domainTargetCells = new Map();
        cellFlashes = [];
        transferSparkState = { remainder: 0, index: 0 };
        lockedBeforeDomain = {
          position: ball.positionLocked === true,
          movement: ball.movementLocked === true
        };
        services.setMovementLocked(true);
        ball.positionLocked = true;
      }

      function beginDomain() {
        phase = "domain";
        phaseTime = 0;
      }

      function beginExit() {
        phase = "exit";
        phaseTime = 0;
        transferSparkState = { remainder: 0, index: 0 };
      }

      function finishDomain(ball) {
        phase = "normal";
        phaseTime = 0;
        ball.x = origin.x;
        ball.y = origin.y;
        ball.positionLocked = lockedBeforeDomain.position;
        services.setMovementLocked(lockedBeforeDomain.movement);
        lockedBeforeDomain = { position: false, movement: false };
        ball.storedVx = savedVelocity.x;
        ball.storedVy = savedVelocity.y;
        ball.vx = savedVelocity.x;
        ball.vy = savedVelocity.y;
        domainCooldown = DOMAIN_COOLDOWN;
        origin = null;
        savedVelocity = null;
        domainTargetCells = new Map();
      }

      function launchVolley(ball) {
        const count = randomInteger(BULLET_MIN_COUNT, BULLET_MAX_COUNT);
        const offset = Math.random() * Math.PI * 2;
        const angles = Array.from({ length: count }, (_, index) => (
          offset + index * Math.PI * 2 / count
        ));
        angles.forEach((angle, index) => {
          services.spawnProjectile(createDiscoBullet(ball, angle, index));
        });
        services.spawnVisualEffect(createLaunchParticles(ball.x, ball.y, angles));
        return count;
      }

      function updateDomainContacts(context) {
        if (phase !== "domain") return;
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          const index = cellIndexAt(target.x, target.y, context.game);
          if (domainTargetCells.get(key) === index) return;
          domainTargetCells.set(key, index);
          if (services.dealDamage(target, domainNumbers[index], context.ball)) {
            recordCellFlash(index, context.game.time);
          }
        });
      }

      return {
        update(context, dt) {
          const elapsed = Math.max(0, dt);
          lastTime = context.game.time;
          fireTimer += elapsed;
          domainCooldown = Math.max(0, domainCooldown - elapsed);
          if (phase === "enter") {
            phaseTime += elapsed;
            updateTransfer(
              context.ball,
              origin,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 }
            );
          } else if (phase === "domain") {
            phaseTime += elapsed;
            context.ball.x = context.game.arenaSize / 2;
            context.ball.y = context.game.arenaSize / 2;
          } else if (phase === "exit") {
            phaseTime += elapsed;
            updateTransfer(
              context.ball,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 },
              origin
            );
          }
        },
        getNextTransitionIn() {
          const boundaries = [Math.max(EPSILON, FIRE_INTERVAL - fireTimer)];
          if (phase === "enter" || phase === "domain" || phase === "exit") {
            const duration = phase === "domain" ? DOMAIN_DURATION : DOMAIN_TRANSFER_DURATION;
            boundaries.push(Math.max(EPSILON, duration - phaseTime));
          }
          return Math.min(...boundaries);
        },
        afterUpdateStep(context) {
          if (fireTimer + EPSILON >= FIRE_INTERVAL) {
            fireTimer -= FIRE_INTERVAL;
            launchVolley(context.ball);
            if (phase === "normal" && domainCooldown <= EPSILON) enterDomain(context.ball);
          }
          if (phase === "enter" && phaseTime + EPSILON >= DOMAIN_TRANSFER_DURATION) {
            context.ball.x = context.game.arenaSize / 2;
            context.ball.y = context.game.arenaSize / 2;
            beginDomain();
          } else if (phase === "domain") {
            updateDomainContacts(context);
            if (phaseTime + EPSILON >= DOMAIN_DURATION) beginExit();
          } else if (phase === "exit" && phaseTime + EPSILON >= DOMAIN_TRANSFER_DURATION) {
            finishDomain(context.ball);
          }
        },
        getCapabilityOverrides() {
          return phase === "normal"
            ? null
            : { canAct: true, canBodyAttack: true, canDealDamage: true };
        },
        getContactProfile() {
          return phase === "normal"
            ? { solid: true, attackable: true }
            : { solid: false, attackable: false };
        },
        onBeforeDamage(_context, event) {
          if (phase !== "normal") return { amount: 0, showHitText: false };
          return event;
        },
        drawBody(_context, canvasContext) {
          drawDiscoBody(canvasContext, _context.ball);
          return true;
        },
        drawArenaBackground(context, canvasContext) {
          let opacity = 0;
          if (phase === "enter") opacity = phaseTime / DOMAIN_TRANSFER_DURATION;
          else if (phase === "domain") opacity = 1;
          else if (phase === "exit") opacity = 1 - phaseTime / DOMAIN_TRANSFER_DURATION;
          drawDomainGrid(
            canvasContext,
            context.game,
            domainNumbers,
            opacity,
            cellFlashes,
            lastTime
          );
        },
        getDiscoState() {
          return {
            fireTimer,
            domainCooldown,
            phase,
            phaseTime,
            domainNumbers: domainNumbers.slice(),
            recentHitIndices: cellFlashes.map((flash) => flash.index)
          };
        }
      };
    }
  };

  registerBall(discoDefinition);
  return {
    discoDefinition,
    DISCO_FIRE_INTERVAL: FIRE_INTERVAL,
    DISCO_DOMAIN_COOLDOWN: DOMAIN_COOLDOWN,
    DISCO_DOMAIN_DURATION: DOMAIN_DURATION,
    DISCO_BULLET_SPEED: BULLET_SPEED,
    DISCO_BULLET_MIN_COUNT: BULLET_MIN_COUNT,
    DISCO_BULLET_MAX_COUNT: BULLET_MAX_COUNT,
    DISCO_DANCE_DURATION: DANCE_DURATION,
    DISCO_DANCE_TICK_INTERVAL: DANCE_TICK_INTERVAL,
    DISCO_DANCE_TICK_DAMAGE: DANCE_TICK_DAMAGE,
    DISCO_DOMAIN_GRID_SIZE: GRID_SIZE,
    cellIndexAt,
    drawDiscoBody,
    drawDomainGrid
  };
});
