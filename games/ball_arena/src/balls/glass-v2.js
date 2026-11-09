(function initializeGlassV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGlassV2Plugin({ registerBall, resolveArenaGeometry }) {
  const BODY_COLOR = "#9edff2";
  const SHARD_COLOR = "#e9fbff";
  const SHARD_RADIUS = 2;
  const SHARD_TARGET_RADIUS = 4;
  const SHARD_LENGTH = 5;
  const PLACEMENT_RADIUS = 20;
  const SHARD_DAMAGE = 1;
  // 一次碰撞掉 2~3 片，每片的位置各自在放置半径内随机。
  const SHARD_DROP_MIN = 2;
  const SHARD_DROP_MAX = 3;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const COLLISION_DIRECTION_COSINE = Math.cos(Math.PI / 6);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function drawGlassBody(context, ball) {
    context.save();
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.48;
    context.fillStyle = BODY_COLOR;
    context.strokeStyle = "#e9fbff";
    context.lineWidth = 1.2;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.restore();

    const crackX = ball.x + 2;
    const crackY = ball.y + 1;
    for (const [color, alpha, width] of [
      ["#4f9eb9", 0.52, 1.05],
      ["#f4fdff", 0.58, 0.42]
    ]) {
      context.save();
      context.globalAlpha *= alpha;
      context.strokeStyle = color;
      context.lineWidth = width;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.beginPath();
      context.moveTo(crackX, crackY);
      context.lineTo(ball.x - 1, ball.y - 4);
      context.lineTo(ball.x - 5, ball.y - 7);
      context.lineTo(ball.x - 7, ball.y - 11);
      context.moveTo(ball.x - 1, ball.y - 4);
      context.lineTo(ball.x + 1, ball.y - 8);
      context.lineTo(ball.x + 4, ball.y - 10);
      context.moveTo(crackX, crackY);
      context.lineTo(ball.x + 6, ball.y - 2);
      context.lineTo(ball.x + 10, ball.y - 5);
      context.lineTo(ball.x + 12, ball.y - 5);
      context.moveTo(ball.x + 6, ball.y - 2);
      context.lineTo(ball.x + 8, ball.y + 1);
      context.moveTo(crackX, crackY);
      context.lineTo(ball.x + 1, ball.y + 5);
      context.lineTo(ball.x - 1, ball.y + 9);
      context.lineTo(ball.x - 4, ball.y + 11);
      context.moveTo(ball.x + 1, ball.y + 5);
      context.lineTo(ball.x + 5, ball.y + 7);
      context.lineTo(ball.x + 7, ball.y + 10);
      context.moveTo(crackX, crackY);
      context.lineTo(ball.x - 4, ball.y + 3);
      context.lineTo(ball.x - 8, ball.y + 5);
      context.lineTo(ball.x - 11, ball.y + 4);
      context.moveTo(ball.x - 8, ball.y + 5);
      context.lineTo(ball.x - 9, ball.y + 8);
      context.stroke();
      context.restore();
    }
  }

  function drawShard(context, x, y, rotation) {
    context.save();
    context.translate(x, y);
    context.rotate(rotation);
    context.globalCompositeOperation = "lighter";
    context.globalAlpha *= 0.68;
    context.fillStyle = SHARD_COLOR;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 0.55;
    context.beginPath();
    context.moveTo(SHARD_LENGTH / 2, 0);
    context.lineTo(-SHARD_LENGTH / 2, -1.45);
    context.lineTo(-SHARD_LENGTH * 0.2, 1.25);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  function createShatterEffect(x, y) {
    const particles = Array.from({ length: 8 }, (_value, index) => {
      const angle = index * Math.PI * 2 / 8 + (Math.random() - 0.5) * 0.35;
      const speed = 22 + Math.random() * 24;
      return {
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: angle,
        spin: (Math.random() - 0.5) * 9
      };
    });
    return {
      kind: "glass-v2-shatter",
      life: 0.32,
      x,
      y,
      particles,
      update({ effect }, dt) {
        const elapsed = Math.max(0, dt);
        const drag = Math.exp(-4 * elapsed);
        effect.particles.forEach((particle) => {
          particle.x += particle.vx * elapsed;
          particle.y += particle.vy * elapsed;
          particle.vx *= drag;
          particle.vy *= drag;
          particle.rotation += particle.spin * elapsed;
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalAlpha *= 1 - progress;
        context.fillStyle = SHARD_COLOR;
        effect.particles.forEach((particle) => {
          context.save();
          context.translate(effect.x + particle.x, effect.y + particle.y);
          context.rotate(particle.rotation);
          context.beginPath();
          context.ellipse(0, 0, 2.5, 0.5, 0, 0, Math.PI * 2);
          context.fill();
          context.restore();
        });
        context.restore();
      }
    };
  }

  function pointsTowardCollision(attachmentAngle, directionX, directionY) {
    const magnitude = Math.hypot(directionX, directionY);
    if (magnitude <= EPSILON) return false;
    return (
      Math.cos(attachmentAngle) * directionX / magnitude +
      Math.sin(attachmentAngle) * directionY / magnitude
    ) >= COLLISION_DIRECTION_COSINE;
  }

  function breakAttachedShard(shard) {
    if (!shard || shard.hp <= 0) return false;
    return shard.services.dealDamage(
      shard,
      shard.hp,
      shard,
      { showHitText: false }
    );
  }

  function createImpaledShardEffect(shard, attachmentAngle) {
    function impaleHost({ ball, effect, game, services }) {
      if (!shard || shard.hp <= 0) {
        effect.expiresAt = game.time;
        return;
      }
      if (!services.dealDamage(ball, SHARD_DAMAGE)) return;
      breakAttachedShard(shard);
      effect.expiresAt = game.time;
    }

    return {
      id: `glass-v2-attachment-${shard.instanceId}`,
      duration: PERMANENT_LIFE,
      update({ effect, game }) {
        if (!shard || shard.hp <= 0) effect.expiresAt = game.time;
      },
      onCollision(context) {
        const contact = context.contact;
        if (!contact || !pointsTowardCollision(
          attachmentAngle,
          contact.normalX,
          contact.normalY
        )) return;
        impaleHost(context);
      },
      onWallBounce(context) {
        const directions = [];
        if (context.bouncedX) {
          directions.push({
            x: context.ball.x <= context.ball.radius + EPSILON ? -1 : 1,
            y: 0
          });
        }
        if (context.bouncedY) {
          directions.push({
            x: 0,
            y: context.ball.y <= context.ball.radius + EPSILON ? -1 : 1
          });
        }
        if (!directions.some((direction) => pointsTowardCollision(
          attachmentAngle,
          direction.x,
          direction.y
        ))) return;
        impaleHost(context);
      }
    };
  }

  function createAttachedShardDefinition(host, attachmentAngle) {
    return {
      id: "glass-v2-attached-shard",
      name: "玻璃渣",
      englishName: "Glass Shard",
      color: SHARD_COLOR,
      description: "扎入目标边缘 / 被攻击一次后碎裂",
      stats: { radius: SHARD_TARGET_RADIUS, speed: 1, maxHp: 1 },
      createBehavior(services) {
        let sweepStartX = null;
        let sweepStartY = null;

        function followHost(ball, preserveSweep = false) {
          if (preserveSweep) {
            sweepStartX = ball.x;
            sweepStartY = ball.y;
          }
          const distance = host.radius + SHARD_LENGTH / 2;
          ball.x = host.x + Math.cos(attachmentAngle) * distance;
          ball.y = host.y + Math.sin(attachmentAngle) * distance;
          if (!preserveSweep) {
            ball.prevX = ball.x;
            ball.prevY = ball.y;
          }
        }

        return {
          onSpawn(context) {
            followHost(context.ball);
          },
          update(context) {
            if (!host || host.hp <= 0) {
              context.ball.hp = 0;
              return;
            }
            followHost(context.ball, true);
          },
          afterUpdateStep(context) {
            if (sweepStartX === null || sweepStartY === null) return;
            context.ball.prevX = sweepStartX;
            context.ball.prevY = sweepStartY;
          },
          getContactProfile() {
            return { solid: false, attackable: true };
          },
          getHpDisplay() {
            return { hidden: true };
          },
          drawBody(context, canvasContext) {
            drawShard(canvasContext, context.ball.x, context.ball.y, attachmentAngle);
            return true;
          },
          onBeforeEffect(context) {
            breakAttachedShard(context.ball);
            return false;
          },
          onDamaged(context) {
            services.spawnVisualEffect(createShatterEffect(
              context.ball.x,
              context.ball.y
            ));
          }
        };
      }
    };
  }

  function attachmentAngleFor(target, shard) {
    const deltaX = shard.x - target.x;
    const deltaY = shard.y - target.y;
    if (Math.hypot(deltaX, deltaY) > EPSILON) return Math.atan2(deltaY, deltaX);
    const velocityX = target.storedVx || target.vx;
    const velocityY = target.storedVy || target.vy;
    return Math.hypot(velocityX, velocityY) > EPSILON
      ? Math.atan2(-velocityY, -velocityX)
      : 0;
  }

  function createGroundShard(onAttach, x, y) {
    const rotation = Math.random() * Math.PI * 2;
    return {
      kind: "glass-v2-ground-shard",
      combatKind: "trap",
      life: PERMANENT_LIFE,
      x,
      y,
      radius: SHARD_RADIUS,
      rotation,
      update({ effect, services }) {
        for (const target of services.getEnemies()) {
          if (Math.hypot(target.x - effect.x, target.y - effect.y) > (
            target.radius + effect.radius
          )) continue;
          if (!services.getContactProfile(target).attackable) continue;
          if (!services.dealDamage(target, SHARD_DAMAGE)) continue;
          onAttach(target, attachmentAngleFor(target, effect));
          effect.life = 0;
          effect.entityActive = false;
          return;
        }
      },
      draw({ effect }, context) {
        drawShard(context, effect.x, effect.y, effect.rotation);
      }
    };
  }

  const glassV2Definition = {
    id: "glassV2",
    name: "玻璃V2",
    englishName: "Glass V2",
    color: BODY_COLOR,
    description: "碰撞散落玻璃渣 / 扎入目标后可被索敌击碎",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      function attachShard(target, angle) {
        const shard = services.spawnSummon(
          createAttachedShardDefinition(target, angle),
          { x: target.x, y: target.y, positionLocked: true }
        );
        if (shard) {
          services.applyEffect(
            target,
            createImpaledShardEffect(shard, angle),
            shard
          );
        }
      }

      function placeShard(context) {
        const count = SHARD_DROP_MIN +
          Math.floor(Math.random() * (SHARD_DROP_MAX - SHARD_DROP_MIN + 1));
        for (let index = 0; index < count; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * PLACEMENT_RADIUS;
          const { x, y } = resolveArenaGeometry(context.game).clampPoint(
            context.ball.x + Math.cos(angle) * distance,
            context.ball.y + Math.sin(angle) * distance, SHARD_RADIUS);
          services.spawnCombatEntity(createGroundShard(attachShard, x, y));
        }
      }

      return {
        onEntityCollision(context) {
          placeShard(context);
        },
        onCollision(context) {
          placeShard(context);
        },
        onWallBounce(context) {
          placeShard(context);
        },
        drawBody(context, canvasContext) {
          drawGlassBody(canvasContext, context.ball);
          return true;
        }
      };
    }
  };

  registerBall(glassV2Definition);
  return {
    glassV2Definition,
    GLASS_V2_PLACEMENT_RADIUS: PLACEMENT_RADIUS,
    GLASS_V2_SHARD_DAMAGE: SHARD_DAMAGE,
    GLASS_V2_SHARD_DROP_MIN: SHARD_DROP_MIN,
    GLASS_V2_SHARD_DROP_MAX: SHARD_DROP_MAX
  };
});
