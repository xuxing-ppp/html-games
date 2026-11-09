(function initializeBilliardsV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBilliardsV2Plugin({ registerBall }) {
  const TRANSFORM_CHECK_INTERVAL = 1;
  const TRANSFORM_CHANCE = 0.5;
  const SUMMON_INTERVAL = 5;
  const SPAWN_ATTEMPTS = 48;
  const SPAWN_CLEARANCE = 2;
  const TABLE_LENGTH = 80;
  const TABLE_WIDTH = 40;
  const TABLE_DAMAGE = 8;
  const POOL_COLLISION_DAMAGE = 1;
  const POOL_DECELERATION = (45 / 4) * 1.25;
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

  function tableExtents(angle) {
    const cosine = Math.abs(Math.cos(angle));
    const sine = Math.abs(Math.sin(angle));
    return {
      x: cosine * TABLE_LENGTH / 2 + sine * TABLE_WIDTH / 2,
      y: sine * TABLE_LENGTH / 2 + cosine * TABLE_WIDTH / 2
    };
  }

  function tableContact(ball, angle, target) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const deltaX = target.x - ball.x;
    const deltaY = target.y - ball.y;
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
      contactX: ball.x + closestX * cosine - closestY * sine,
      contactY: ball.y + closestX * sine + closestY * cosine
    };
  }

  function drawPoolTable(context, ball, angle) {
    context.save();
    context.translate(ball.x, ball.y);
    context.rotate(angle);
    context.shadowColor = "#50d29c";
    context.shadowBlur = 5;
    context.fillStyle = "#24150f";
    context.fillRect(-42, -22, 84, 44);
    context.fillStyle = "#704221";
    context.fillRect(-40, -20, 80, 40);
    context.fillStyle = "#113a29";
    context.fillRect(-34, -14, 68, 28);
    context.fillStyle = "#176444";
    context.fillRect(-31, -11, 62, 22);
    context.fillStyle = "rgba(163, 231, 199, 0.45)";
    context.fillRect(-31, -11, 62, 2);
    context.shadowBlur = 0;

    const pockets = [
      [-35, -15], [0, -15], [35, -15],
      [-35, 15], [0, 15], [35, 15]
    ];
    pockets.forEach(([x, y]) => {
      context.fillStyle = "#030504";
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fill();
    });
    context.strokeStyle = "#a6dec4";
    context.lineWidth = 1;
    context.strokeRect(-40, -20, 80, 40);
    context.restore();
  }

  function drawEightBall(context, ball) {
    context.save();
    context.fillStyle = "#101214";
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#555b60";
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = "#f6f3e9";
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius * 0.48, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#101214";
    context.font = "700 10px 'Ball Impact', Impact, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("8", Math.round(ball.x), Math.round(ball.y + 0.5));
    context.restore();
  }

  const poolBallDefinition = {
    id: "poolBall",
    name: "\u53f0\u7403",
    englishName: "Eight Ball",
    color: "#151719",
    rosterType: "zako",
    description: "\u516b\u53f7\u7403 / \u78b0\u649e\u63a8\u52a8 / \u901f\u5ea6\u53d8\u5316\u4f24\u5bb3",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 5,
    createBehavior(services) {
      let initialized = false;

      function stop(ball) {
        ball.vx = 0;
        ball.vy = 0;
        ball.storedVx = 0;
        ball.storedVy = 0;
      }

      return {
        update(context, dt) {
          if (!initialized) {
            initialized = true;
            stop(context.ball);
            return;
          }
          const speed = Math.hypot(context.ball.storedVx, context.ball.storedVy);
          if (speed <= EPSILON) {
            stop(context.ball);
            return;
          }
          const nextSpeed = Math.max(0, speed - POOL_DECELERATION * Math.max(0, dt));
          if (nextSpeed <= EPSILON) {
            stop(context.ball);
            return;
          }
          const scale = nextSpeed / speed;
          context.ball.storedVx *= scale;
          context.ball.storedVy *= scale;
          context.ball.vx = context.ball.storedVx;
          context.ball.vy = context.ball.storedVy;
        },
        onCollision(context, target) {
          const targetVx = Number.isFinite(target.preHitVx) ? target.preHitVx : target.vx;
          const targetVy = Number.isFinite(target.preHitVy) ? target.preHitVy : target.vy;
          const inheritedSpeed = Math.hypot(targetVx, targetVy);
          const direction = normalizeDirection(
            context.ball.vx,
            context.ball.vy,
            context.ball.x - target.x,
            context.ball.y - target.y
          );
          const nextVx = direction.x * inheritedSpeed;
          const nextVy = direction.y * inheritedSpeed;
          if (!context.blockedAtContact) {
            context.services.dealDamage(target, POOL_COLLISION_DAMAGE);
          }

          context.ball.vx = context.ball.storedVx = nextVx;
          context.ball.vy = context.ball.storedVy = nextVy;
        },
        drawBody(context, canvasContext) {
          drawEightBall(canvasContext, context.ball);
          return true;
        },
        getPoolSpeed(context) {
          return Math.hypot(context.ball.storedVx, context.ball.storedVy);
        }
      };
    }
  };

  const billiardsV2Definition = {
    id: "billiardsV2",
    name: "\u53f0\u7403\u684cV2",
    englishName: "Billiards Table V2",
    color: "#0c6543",
    description: "50%变身 / 锁血球桌 / 连续5秒召唤台球",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 12,
    createBehavior(services) {
      let transformTimer = 0;
      let summonTimer = 0;
      let transformed = false;
      let angle = 0;
      let fixedX = 0;
      let fixedY = 0;
      let savedDirectionX = 1;
      let savedDirectionY = 0;
      const contacts = new Set();

      function transform(ball, arena) {
        const direction = normalizeDirection(
          ball.storedVx || ball.vx,
          ball.storedVy || ball.vy,
          savedDirectionX,
          savedDirectionY
        );
        savedDirectionX = direction.x;
        savedDirectionY = direction.y;
        transformed = true;
        angle = Math.random() * Math.PI * 2;
        const extents = tableExtents(angle);
        if (arena.shape === "circle") {
          const dx = ball.x - arena.centerX;
          const dy = ball.y - arena.centerY;
          const distanceSquared = dx * dx + dy * dy;
          const cosine = Math.cos(angle);
          const sine = Math.sin(angle);
          const cornerProjection = Math.abs(dx * cosine + dy * sine) * TABLE_LENGTH / 2 +
            Math.abs(-dx * sine + dy * cosine) * TABLE_WIDTH / 2;
          const clearance = arena.width * arena.width / 4 - (TABLE_LENGTH * TABLE_LENGTH + TABLE_WIDTH * TABLE_WIDTH) / 4;
          const scale = distanceSquared <= EPSILON ? 1 : clearance < 0 ? 0 : clamp(
            (-cornerProjection + Math.sqrt(cornerProjection * cornerProjection + distanceSquared * clearance)) / distanceSquared,
            0, 1
          );
          ball.x = arena.centerX + dx * scale;
          ball.y = arena.centerY + dy * scale;
        } else {
          ball.x = arena.width < extents.x * 2 ? arena.centerX : clamp(ball.x, arena.left + extents.x, arena.right - extents.x);
          ball.y = arena.height < extents.y * 2 ? arena.centerY : clamp(ball.y, arena.top + extents.y, arena.bottom - extents.y);
        }
        fixedX = ball.x;
        fixedY = ball.y;
        summonTimer = 0;
        contacts.clear();
        ball.vx = ball.vy = ball.storedVx = ball.storedVy = 0;
        services.setMovementLocked(true);
      }

      function revert(ball) {
        transformed = false;
        summonTimer = 0;
        contacts.clear();
        services.setMovementLocked(false);
        const speed = ball.speed * ball.speedMultiplier;
        ball.vx = ball.storedVx = savedDirectionX * speed;
        ball.vy = ball.storedVy = savedDirectionY * speed;
      }

      function enforceFixedPosition(ball) {
        if (!transformed) return;
        ball.x = fixedX;
        ball.y = fixedY;
        ball.vx = ball.vy = ball.storedVx = ball.storedVy = 0;
      }

      function advance(context, dt) {
        const elapsed = Math.max(0, dt);
        enforceFixedPosition(context.ball);
        transformTimer = Math.min(
          TRANSFORM_CHECK_INTERVAL,
          transformTimer + elapsed
        );
        if (transformed) {
          summonTimer = Math.min(SUMMON_INTERVAL, summonTimer + elapsed);
        }
      }

      function nextTransition() {
        let boundary = TRANSFORM_CHECK_INTERVAL - transformTimer;
        if (transformed) {
          boundary = Math.min(boundary, SUMMON_INTERVAL - summonTimer);
        }
        return Math.max(EPSILON, boundary);
      }

      function resolveTransitions(context) {
        enforceFixedPosition(context.ball);
        if (transformed && summonTimer + EPSILON >= SUMMON_INTERVAL) {
          summonTimer = 0;
          summonPoolBall(context);
        }
        if (transformTimer + EPSILON >= TRANSFORM_CHECK_INTERVAL) {
          transformTimer = 0;
          const tableThisSecond = Math.random() < TRANSFORM_CHANCE;
          if (tableThisSecond && !transformed) {
            transform(context.ball, context.game.arena);
          } else if (!tableThisSecond && transformed) {
            revert(context.ball);
          }
        }
      }

      function findOpenPoolPosition(context, radius) {
        const arena = context.game.arena;
        const minimumX = arena.left + radius;
        const maximumX = arena.right - radius;
        const minimumY = arena.top + radius;
        const maximumY = arena.bottom - radius;
        if (maximumX < minimumX || maximumY < minimumY) return null;
        const actors = [context.ball, ...services.getAllies(), ...services.getEnemies()];

        function isOpen(x, y) {
          if (!arena.contains(x, y, radius)) return false;
          if (tableContact(context.ball, angle, { x, y, radius: radius + SPAWN_CLEARANCE })) {
            return false;
          }
          return actors.every((actor) => {
            if (actor === context.ball || !services.getContactProfile(actor).solid) return true;
            return Math.hypot(actor.x - x, actor.y - y) + EPSILON >= (
              actor.radius + radius + SPAWN_CLEARANCE
            );
          });
        }

        for (let attempt = 0; attempt < SPAWN_ATTEMPTS; attempt += 1) {
          const x = minimumX + Math.random() * (maximumX - minimumX);
          const y = minimumY + Math.random() * (maximumY - minimumY);
          if (isOpen(x, y)) return { x, y };
        }

        const spacing = radius * 2 + SPAWN_CLEARANCE * 2;
        const openGrid = [];
        for (let y = minimumY; y <= maximumY + EPSILON; y += spacing) {
          for (let x = minimumX; x <= maximumX + EPSILON; x += spacing) {
            if (isOpen(x, y)) openGrid.push({ x, y });
          }
        }
        if (openGrid.length === 0) return null;
        return openGrid[Math.floor(Math.random() * openGrid.length)];
      }

      function summonPoolBall(context) {
        const radius = poolBallDefinition.stats.radius;
        const position = findOpenPoolPosition(context, radius);
        if (!position) return;
        services.spawnSummon(poolBallDefinition, {
          x: position.x,
          y: position.y,
          vx: 0,
          vy: 0
        });
      }

      return {
        update(context, dt) {
          advance(context, dt);
        },
        updateWhilePaused(context, dt) {
          advance(context, dt);
        },
        getNextTransitionIn() {
          return nextTransition();
        },
        getNextPausedTransitionIn() {
          return nextTransition();
        },
        afterUpdateStep(context) {
          resolveTransitions(context);
        },
        afterUpdateStepWhilePaused(context) {
          resolveTransitions(context);
        },
        onContactUpdate(context, target) {
          if (!transformed) return;
          const key = targetKey(target);
          const contact = tableContact(context.ball, angle, target);
          if (!contact) {
            contacts.delete(key);
            return;
          }
          if (!contacts.has(key) && !context.blockedAtContact) {
            context.services.dealDamage(target, TABLE_DAMAGE);
          }
          contacts.add(key);
          if (!services.getContactProfile(target).solid) return;
          target.x = contact.contactX + contact.normalX * target.radius;
          target.y = contact.contactY + contact.normalY * target.radius;
          if (context.game.arena) Object.assign(target, context.game.arena.clampPoint(target.x, target.y, target.radius));
          const incoming = target.vx * contact.normalX + target.vy * contact.normalY;
          if (incoming < 0) {
            target.vx -= incoming * 2 * contact.normalX;
            target.vy -= incoming * 2 * contact.normalY;
            target.storedVx = target.vx;
            target.storedVy = target.vy;
          }
        },
        onBeforeDamage(_context, event) {
          return transformed
            ? { amount: 0, showHitText: false, cancelAttack: true }
            : event;
        },
        drawBody(context, canvasContext) {
          if (!transformed) return false;
          drawPoolTable(canvasContext, context.ball, angle);
          return true;
        },
        drawAfter(context, canvasContext) {
          if (!transformed) return;
          canvasContext.save();
          canvasContext.fillStyle = "#c9ffe6";
          canvasContext.font = "700 9px monospace";
          canvasContext.textAlign = "center";
          canvasContext.fillText("LOCK", Math.round(context.ball.x), Math.round(context.ball.y - 27));
          canvasContext.restore();
        },
        getTableState() {
          return {
            transformed,
            angle,
            transformTimer,
            summonTimer,
            fixedX,
            fixedY
          };
        }
      };
    }
  };

  registerBall(billiardsV2Definition);
  // 台球保留召唤物用途，同时作为独立的杂鱼角色回到选球菜单。
  registerBall(poolBallDefinition);
  return {
    billiardsV2Definition,
    poolBallDefinition
  };
});
