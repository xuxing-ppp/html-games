(function initializeSpiderGrenade(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? {
        ...Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/knockback.js")),
        ...require("./spiderweb.js")
      }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSpiderGrenadePlugin(dependencies) {
  const {
    resolveArenaGeometry, registerBall, createKnockbackEffect: createSharedKnockback,
    spiderwebSweepTouchesSilk,
    spiderwebCurrentlyTouchesSilk
  } = dependencies;

  const WINDUP_DURATION = 0.3;
  const THROW_DURATION = 1;
  const COOLDOWN_DURATION = 3.7;
  const CYCLE_DURATION = WINDUP_DURATION + THROW_DURATION + COOLDOWN_DURATION;
  const FLIGHT_DURATION = 0.3;
  const FUSE_DURATION = 0.4;
  const BLAST_RADIUS = 50;
  const BLAST_DAMAGE = 2;
  const KNOCKBACK_DURATION = 0.06;
  const KNOCKBACK_SPEED_MULTIPLIER = 7;
  const GRENADE_SIZE = 15;
  const SILK_WIDTH = 0.9;
  const SILK_HALF_WIDTH = SILK_WIDTH / 2;
  const SILK_DEPLOY_DURATION = 0.24;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const BODY_COLOR = "#f3f5f6";

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.lineTo(x + width - corner, y);
    context.quadraticCurveTo(x + width, y, x + width, y + corner);
    context.lineTo(x + width, y + height - corner);
    context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
    context.lineTo(x + corner, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - corner);
    context.lineTo(x, y + corner);
    context.quadraticCurveTo(x, y, x + corner, y);
    context.closePath();
  }

  function heldGrenadePosition(ball, index = 0, count = 1) {
    const ringCapacity = 20;
    const ring = Math.floor(index / ringCapacity);
    const ringStart = ring * ringCapacity;
    const ringCount = Math.min(ringCapacity, Math.max(1, count - ringStart));
    const slot = index - ringStart;
    const angle = slot * (Math.PI * 2 / ringCount) + ring * 0.6;
    const distance = ball.radius + 9 + ring * 16;
    return {
      x: ball.x + Math.cos(angle) * distance,
      y: ball.y + Math.sin(angle) * distance,
      angle
    };
  }

  function randomLandingPoint(startX, startY, arenaSize) {
    const margin = 10;
    const arena = resolveArenaGeometry(arenaSize);
    const { x, y } = arena.samplePoint(Math.random, margin);
    if (Math.hypot(x - startX, y - startY) <= EPSILON) {
      return arena.clampPoint(startX + 1, y, margin);
    }
    return { x, y };
  }

  function randomEdgePoint(arenaSize) {
    const edge = Math.floor(Math.random() * 4);
    const progress = Math.random();
    const point = resolveArenaGeometry(arenaSize).boundaryPoint(["left", "right", "top", "bottom"][edge], edge === 0 || edge === 3 ? 1 - progress : progress);
    return { x: point.x, y: point.y, role: "edge" };
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
    }
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }

  function createKnockback(source, directionX, directionY) {
    return createSharedKnockback({
      id: `spider-grenade-knockback-${source.instanceId}`,
      duration: KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function drawWhiteGrenadeSprite(context, x, y, size, rotation = 0, fuseBlink = false) {
    const half = size / 2;
    context.save();
    context.translate(Math.round(x), Math.round(y));
    if (rotation) context.rotate(rotation);
    context.shadowColor = "rgba(255, 255, 255, 0.75)";
    context.shadowBlur = 4;

    context.fillStyle = "#667078";
    roundedRectPath(context, -half - 1.5, -half - 1.5, size + 3, size + 3, 3);
    context.fill();
    context.fillStyle = "#f3f5f6";
    roundedRectPath(context, -half, -half, size, size, 3);
    context.fill();
    context.fillStyle = "#dce2e5";
    roundedRectPath(context, -half + 2, -half + 2, size - 4, size - 4, 2);
    context.fill();

    context.strokeStyle = "rgba(93, 104, 111, 0.75)";
    context.lineWidth = 1;
    for (const offset of [-half + 5, 0, half - 5]) {
      context.beginPath();
      context.moveTo(offset, -half + 2);
      context.lineTo(offset, half - 2);
      context.stroke();
      context.beginPath();
      context.moveTo(-half + 2, offset);
      context.lineTo(half - 2, offset);
      context.stroke();
    }
    context.fillStyle = "#ffffff";
    for (const offsetX of [-half + 2.5, half - 2.5]) {
      for (const offsetY of [-half + 2.5, half - 2.5]) {
        context.fillRect(offsetX - 1, offsetY - 1, 2, 2);
      }
    }
    context.shadowBlur = 0;
    context.fillStyle = "#7d858a";
    context.fillRect(-2, -half - 4, 4, 4);
    context.fillStyle = "#42484c";
    context.fillRect(-1, -half - 4, 2, 2);
    if (fuseBlink) {
      context.fillStyle = "#ffffff";
      context.fillRect(-2, -half - 6, 4, 2);
    }
    context.restore();
  }

  function createLandingDust(x, y) {
    const particles = Array.from({ length: 6 }, (_value, index) => {
      const angle = -Math.PI / 2 + (index - 2.5) * 0.5 + Math.random() * 0.3;
      return {
        vx: Math.cos(angle) * (14 + Math.random() * 20),
        vy: Math.sin(angle) * (8 + Math.random() * 14),
        size: 2 + index % 2
      };
    });
    return {
      kind: "spider-grenade-landing-dust",
      life: 0.28,
      x,
      y,
      particles,
      update({ effect }, dt) {
        effect.particles.forEach((particle) => {
          particle.x = (Number.isFinite(particle.x) ? particle.x : effect.x) + particle.vx * dt;
          particle.y = (Number.isFinite(particle.y) ? particle.y : effect.y) + particle.vy * dt;
          particle.vy += 60 * dt;
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= (1 - progress) * 0.62;
        context.fillStyle = "#dce2e5";
        effect.particles.forEach((particle) => {
          context.fillRect(
            Math.round(particle.x - particle.size / 2),
            Math.round(particle.y - particle.size / 2),
            particle.size,
            particle.size
          );
        });
        context.restore();
      }
    };
  }

  function createReloadPing(x, y, radius) {
    return {
      kind: "spider-grenade-reload-ping",
      life: 0.28,
      x,
      y,
      radius,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#ffffff";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(
          effect.x,
          effect.y,
          effect.radius + 4 + progress * 14,
          0,
          Math.PI * 2
        );
        context.stroke();
        context.restore();
      }
    };
  }

  function drawFlightShadow(context, effect, height) {
    context.save();
    context.globalAlpha *= clamp(0.34 - height / (effect.apex * 6 + EPSILON), 0.06, 0.34);
    context.fillStyle = "rgba(36, 43, 47, 0.82)";
    context.translate(effect.shadowX, effect.shadowY);
    context.scale(1, 0.45);
    context.beginPath();
    context.arc(0, 0, 5 + height * 0.02, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function drawWhiteGrenadeBody(context, ball) {
    const radius = ball.radius;
    context.save();
    context.translate(ball.x, ball.y);
    context.fillStyle = BODY_COLOR;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fill();

    context.save();
    context.beginPath();
    context.arc(0, 0, radius - 1, 0, Math.PI * 2);
    context.clip();
    context.strokeStyle = "rgba(82, 92, 98, 0.72)";
    context.lineWidth = 1.5;
    for (const offset of [-10, 0, 10]) {
      context.beginPath();
      context.moveTo(offset, -radius);
      context.lineTo(offset, radius);
      context.stroke();
      context.beginPath();
      context.moveTo(-radius, offset);
      context.lineTo(radius, offset);
      context.stroke();
    }
    context.fillStyle = "#ffffff";
    for (const offsetX of [-5, 5]) {
      for (const offsetY of [-5, 5]) context.fillRect(offsetX - 1, offsetY - 1, 2, 2);
    }
    context.restore();
    context.strokeStyle = "#667078";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
    context.fillStyle = "#7d858a";
    context.fillRect(-2, -radius - 5, 4, 5);
    context.fillStyle = "#42484c";
    context.fillRect(-1, -radius - 5, 2, 2);
    context.restore();
    return true;
  }

  function createSilkDeployEffect(endpoint, anchor) {
    return {
      kind: "spider-grenade-silk-deploy",
      life: SILK_DEPLOY_DURATION,
      endpoint,
      anchor,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        context.save();
        context.globalAlpha *= 0.9 * (0.45 + progress * 0.55);
        context.strokeStyle = "#ffffff";
        context.lineWidth = 1.4;
        context.beginPath();
        context.moveTo(effect.endpoint.x, effect.endpoint.y);
        context.lineTo(
          effect.endpoint.x + (effect.anchor.x - effect.endpoint.x) * eased,
          effect.endpoint.y + (effect.anchor.y - effect.endpoint.y) * eased
        );
        context.stroke();
        context.restore();
      }
    };
  }

  function drawStaticSilk(context, entity) {
    context.save();
    context.globalAlpha *= 0.78;
    context.strokeStyle = "#ffffff";
    context.lineWidth = SILK_WIDTH;
    context.beginPath();
    context.moveTo(entity.endpoint.x, entity.endpoint.y);
    context.lineTo(entity.anchor.x, entity.anchor.y);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(entity.endpoint.x, entity.endpoint.y, 2.2, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(entity.anchor.x, entity.anchor.y, 1.7, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function spawnPermanentSilk(entityServices, endpoint, anchor, group) {
    let entity = null;
    entity = entityServices.spawnCombatEntity({
      kind: "spider-grenade-silk",
      combatKind: "zone",
      lifecycle: "independent",
      life: PERMANENT_LIFE,
      drawLayer: "background",
      color: "#ffffff",
      endpoint,
      anchor,
      anchorX: anchor.x,
      anchorY: anchor.y,
      start: endpoint,
      end: anchor,
      width: SILK_WIDTH,
      shieldBreakPoints: [endpoint, anchor],
      shieldBreakRadius: 1,
      touchingTargets: new Set(),
      onShieldDestroyed(_destroyedEntity, contact) {
        if (contact && contact.shieldBreakPoint === endpoint) {
          group.entities.forEach((silk) => {
            silk.life = 0;
            silk.entityActive = false;
          });
        } else {
          entity.life = 0;
          entity.entityActive = false;
        }
      },
      update({ entity: silk, services: silkServices }) {
        const targetTouches = new Set();
        silkServices.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          const wasTouching = silk.touchingTargets.has(key);
          const previousX = Number.isFinite(target.prevX) ? target.prevX : target.x;
          const previousY = Number.isFinite(target.prevY) ? target.prevY : target.y;
          const targetMoved = Math.hypot(target.x - previousX, target.y - previousY) > EPSILON;
          const touchRadius = target.radius + SILK_HALF_WIDTH;
          const isTouching = spiderwebCurrentlyTouchesSilk(
            target,
            silk,
            silk.endpoint,
            touchRadius
          );
          if (
            !wasTouching &&
            targetMoved &&
            (isTouching || spiderwebSweepTouchesSilk(
              target,
              silk,
              silk.endpoint,
              silk.endpoint.x,
              silk.endpoint.y,
              touchRadius
            ))
          ) {
            silkServices.dealDamage(target, 1);
          }
          if (isTouching) targetTouches.add(key);
        });
        silk.touchingTargets = targetTouches;
      },
      draw({ entity: silk }, context) {
        drawStaticSilk(context, silk);
      }
    });
    group.entities.add(entity);
    return entity;
  }

  function spawnSilks(entityServices, x, y, arenaSize) {
    const count = 1 + Math.floor(Math.random() * 3);
    const group = {
      endpoint: { x, y, role: "endpoint" },
      entities: new Set()
    };
    for (let index = 0; index < count; index += 1) {
      const anchor = randomEdgePoint(arenaSize);
      entityServices.spawnVisualEffect(createSilkDeployEffect(group.endpoint, anchor));
      spawnPermanentSilk(entityServices, group.endpoint, anchor, group);
    }
    return group;
  }

  function explode(entityServices, source, effect, game) {
    entityServices.playSound("ability", { cue: "explosion" });
    const { x, y } = effect;
    entityServices.forEachEnemy((enemy) => {
      if (Math.hypot(enemy.x - x, enemy.y - y) > BLAST_RADIUS + enemy.radius) return;
      if (!entityServices.dealDamage(enemy, BLAST_DAMAGE)) return;
      const direction = normalizeDirection(
        enemy.x - x,
        enemy.y - y,
        enemy.storedVx || enemy.vx || 1,
        enemy.storedVy || enemy.vy || 0
      );
      entityServices.applyEffect(enemy, createKnockback(source, direction.x, direction.y));
    });
    entityServices.spawnParticleBurst({
      kind: "spider-grenade-explosion",
      x,
      y,
      count: 35,
      minDiameter: 1,
      maxDiameter: 8,
      colors: ["#92979c", "#ffffff"],
      life: 0.42,
      minSpeed: 28,
      maxSpeed: 100
    });
    spawnSilks(entityServices, x, y, game);
  }

  function createThrownSpiderGrenade(source, startX, startY, destX, destY) {
    const deltaX = destX - startX;
    const deltaY = destY - startY;
    const distance = Math.hypot(deltaX, deltaY);
    const apex = clamp(26 + distance * 0.18, 26, 64);
    let exploded = false;
    return {
      kind: "spider-grenade-thrown",
      life: FLIGHT_DURATION + FUSE_DURATION + 0.15,
      radius: GRENADE_SIZE / 2,
      damage: BLAST_DAMAGE,
      color: BODY_COLOR,
      x: startX,
      y: startY,
      vx: deltaX / FLIGHT_DURATION,
      vy: deltaY / FLIGHT_DURATION,
      startX,
      startY,
      destX,
      destY,
      apex,
      travelElapsed: 0,
      fuseElapsed: 0,
      landed: false,
      shadowX: startX,
      shadowY: startY,
      spin: (Math.random() < 0.5 ? -1 : 1) * (4.5 + Math.random() * 3.5),
      update({ effect, game, services: entityServices }, dt) {
        if (exploded) return;
        const elapsed = Math.max(0, dt);
        if (!effect.landed) {
          effect.travelElapsed = Math.min(FLIGHT_DURATION, effect.travelElapsed + elapsed);
          const progress = effect.travelElapsed / FLIGHT_DURATION;
          const groundX = effect.startX + (effect.destX - effect.startX) * progress;
          const groundY = effect.startY + (effect.destY - effect.startY) * progress;
          const height = 4 * effect.apex * progress * (1 - progress);
          effect.shadowX = groundX;
          effect.shadowY = groundY;
          effect.x = groundX;
          effect.y = groundY - height;
          if (effect.travelElapsed + EPSILON >= FLIGHT_DURATION) {
            effect.landed = true;
            effect.x = effect.destX;
            effect.y = effect.destY;
            entityServices.spawnVisualEffect(createLandingDust(
              effect.destX,
              effect.destY
            ));
          }
          return;
        }
        effect.fuseElapsed += elapsed;
        if (effect.fuseElapsed + EPSILON >= FUSE_DURATION) {
          exploded = true;
          explode(entityServices, source, effect, game);
          effect.life = 0;
        }
      },
      draw({ effect, game }, context) {
        const progress = clamp(effect.travelElapsed / FLIGHT_DURATION, 0, 1);
        const height = 4 * effect.apex * progress * (1 - progress);
        if (!effect.landed) drawFlightShadow(context, effect, height);
        const fuseBlink = effect.landed && Math.floor(((game && game.time) || 0) * 8) % 2 === 0;
        drawWhiteGrenadeSprite(
          context,
          effect.x,
          effect.y,
          GRENADE_SIZE,
          effect.spin * progress,
          fuseBlink
        );
      }
    };
  }

  const spiderGrenadeDefinition = {
    id: "spiderGrenade",
    name: "蛛丝手雷",
    englishName: "Spider Grenade",
    color: BODY_COLOR,
    description: "3.7秒冷却 / 递增投掷 / 白色蛛丝手雷",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let cycleTime = 0;
      let attackCount = 1;
      let grenadesSpawned = false;
      let nextThrowIndex = 0;

      function throwGrenade(ball, game, index, count) {
        const held = heldGrenadePosition(ball, index, count);
        const destination = randomLandingPoint(held.x, held.y, game);
        services.spawnProjectile(createThrownSpiderGrenade(
          ball,
          held.x,
          held.y,
          destination.x,
          destination.y
        ));
      }

      return {
        isAttackCycleComplete() { return grenadesSpawned && nextThrowIndex >= attackCount; },
        drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
        update(_context, dt) {
          cycleTime = Math.min(CYCLE_DURATION, cycleTime + Math.max(0, dt));
        },
        getNextTransitionIn() {
          let next = CYCLE_DURATION - cycleTime;
          if (!grenadesSpawned) {
            next = Math.min(next, Math.max(0, WINDUP_DURATION - cycleTime));
          } else if (nextThrowIndex < attackCount) {
            const throwAt = WINDUP_DURATION +
              nextThrowIndex * (THROW_DURATION / attackCount);
            next = Math.min(next, Math.max(0, throwAt - cycleTime));
          }
          return Math.max(EPSILON, next);
        },
        afterUpdateStep(context) {
          if (!grenadesSpawned && cycleTime + EPSILON >= WINDUP_DURATION) {
            grenadesSpawned = true;
            services.spawnVisualEffect(createReloadPing(
              context.ball.x,
              context.ball.y,
              context.ball.radius
            ));
          }
          if (grenadesSpawned) {
            while (nextThrowIndex < attackCount) {
              const throwAt = WINDUP_DURATION +
                nextThrowIndex * (THROW_DURATION / attackCount);
              if (cycleTime + EPSILON < throwAt) break;
              throwGrenade(context.ball, context.game, nextThrowIndex, attackCount);
              nextThrowIndex += 1;
            }
          }
          if (cycleTime + EPSILON >= CYCLE_DURATION) {
            cycleTime = 0;
            attackCount += 1;
            grenadesSpawned = false;
            nextThrowIndex = 0;
          }
        },
        drawAfter(context, canvasContext) {
          if (!grenadesSpawned) return;
          for (let index = nextThrowIndex; index < attackCount; index += 1) {
            const held = heldGrenadePosition(context.ball, index, attackCount);
            drawWhiteGrenadeSprite(
              canvasContext,
              held.x,
              held.y,
              GRENADE_SIZE,
              held.angle + Math.PI / 2
            );
          }
        },
        // Renderer hooks receive the engine context first and the canvas
        // context second. Keep the drawing helper's ball argument explicit
        // so selecting this ball can render the opening frame safely.
        drawBody(context, canvasContext) {
          drawWhiteGrenadeBody(canvasContext, context.ball);
          return true;
        },
        getSpiderGrenadeState() {
          return {
            cycleTime,
            attackCount,
            grenadesSpawned,
            nextThrowIndex,
            cooldown: COOLDOWN_DURATION
          };
        }
      };
    }
  };

  registerBall(spiderGrenadeDefinition);
  return {
    spiderGrenadeDefinition,
    SPIDER_GRENADE_CYCLE_DURATION: CYCLE_DURATION,
    SPIDER_GRENADE_THROW_DURATION: THROW_DURATION,
    SPIDER_GRENADE_COOLDOWN_DURATION: COOLDOWN_DURATION,
    SPIDER_GRENADE_BLAST_DAMAGE: BLAST_DAMAGE,
    SPIDER_GRENADE_KNOCKBACK_DURATION: KNOCKBACK_DURATION,
    SPIDER_GRENADE_KNOCKBACK_SPEED_MULTIPLIER: KNOCKBACK_SPEED_MULTIPLIER,
    SPIDER_GRENADE_FLIGHT_DURATION: FLIGHT_DURATION,
    SPIDER_GRENADE_FUSE_DURATION: FUSE_DURATION,
    SPIDER_GRENADE_SILK_DEPLOY_DURATION: SILK_DEPLOY_DURATION,
    createThrownSpiderGrenade
  };
});
