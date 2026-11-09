(function initializeMedicalBall(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMedicalBallPlugin({ resolveArenaGeometry, registerBall }) {
  const FIRE_INTERVAL = 5.6;
  const PROJECTILE_SPEED_MULTIPLIER = 2.4;
  const PROJECTILE_RADIUS = 2.5;
  const TRAIL_DURATION = 1;
  const TRAIL_DRAW_BANDS = 4;
  const MAX_BOUNCES = 2;
  const HEALING = 5;
  const DAMAGE = 5;
  const EMERGENCY_HP = 40;
  const EMERGENCY_INVULNERABILITY_DURATION = 1;
  const EPSILON = 1e-9;

  function segmentProgress(startX, startY, endX, endY, target, radius) {
    const lineX = endX - startX;
    const lineY = endY - startY;
    const lengthSquared = lineX * lineX + lineY * lineY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : Math.max(0, Math.min(1, (
        (target.x - startX) * lineX + (target.y - startY) * lineY
      ) / lengthSquared));
    const closestX = startX + lineX * progress;
    const closestY = startY + lineY * progress;
    return Math.hypot(target.x - closestX, target.y - closestY) <= target.radius + radius
      ? progress
      : null;
  }

  function createMedicalTrail(state) {
    return {
      kind: "medical-round-trail",
      life: 3600,
      duration: TRAIL_DURATION,
      drawLayer: "background",
      points: state.points,
      update({ effect }, dt) {
        state.time += Math.max(0, dt);
        while (
          state.points.length > 0 &&
          state.time - state.points[0].createdAt > TRAIL_DURATION + EPSILON
        ) {
          state.points.shift();
        }
        if (!state.active && state.points.length === 0) effect.life = 0;
      },
      draw(_context, canvasContext) {
        if (state.points.length < 2) return;
        canvasContext.save();
        const baseAlpha = canvasContext.globalAlpha;
        canvasContext.lineCap = "round";
        canvasContext.lineJoin = "round";
        const segmentCount = state.points.length - 1;
        const bandCount = Math.min(TRAIL_DRAW_BANDS, segmentCount);
        for (let band = 0; band < bandCount; band += 1) {
          const startSegment = Math.floor(band * segmentCount / bandCount);
          const endSegment = Math.floor((band + 1) * segmentCount / bandCount);
          const point = state.points[endSegment];
          const remaining = Math.max(
            0,
            1 - (state.time - point.createdAt) / TRAIL_DURATION
          );
          if (remaining <= 0) continue;
          canvasContext.globalAlpha = baseAlpha * (0.12 + remaining * 0.68);
          canvasContext.strokeStyle = "#57e1bd";
          canvasContext.lineWidth = 1.2 + remaining * 1.2;
          canvasContext.beginPath();
          canvasContext.moveTo(
            state.points[startSegment].x,
            state.points[startSegment].y
          );
          for (let index = startSegment + 1; index <= endSegment; index += 1) {
            canvasContext.lineTo(state.points[index].x, state.points[index].y);
          }
          canvasContext.stroke();
        }
        canvasContext.restore();
      }
    };
  }

  function addMedicalTrailPoint(state, x, y) {
    const last = state.points[state.points.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) <= EPSILON) return;
    state.points.push({ x, y, createdAt: state.time });
  }

  function drawMedicalRound(context, effect) {
    context.save();
    context.fillStyle = "#57e1bd";
    context.beginPath();
    context.arc(effect.x, effect.y, PROJECTILE_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#edfff8";
    context.fillRect(effect.x - 0.6, effect.y - 1.7, 1.2, 3.4);
    context.fillRect(effect.x - 1.7, effect.y - 0.6, 3.4, 1.2);
    context.restore();
  }

  function drawMedicalBody(context, ball) {
    context.save();
    context.fillStyle = ball.color;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    // 默认系统描边的同款“深一档本色圆环”（纯色圆不硬画、补上描边）
    context.strokeStyle = "#1f6d5a";
    context.lineWidth = 1.25;
    context.stroke();
    context.globalAlpha *= 0.72;
    context.fillStyle = "#edfff9";
    context.fillRect(ball.x - 1.5, ball.y - 12, 3, 8);
    context.fillRect(ball.x - 4, ball.y - 9.5, 8, 3);
    context.restore();
  }

  function createMedicalRound(services, source, angle) {
    const speed = source.speed * PROJECTILE_SPEED_MULTIPLIER;
    const trailState = {
      active: true,
      time: 0,
      points: [{ x: source.x, y: source.y, createdAt: 0 }]
    };
    services.spawnVisualEffect(createMedicalTrail(trailState));
    return {
      kind: "medical-round",
      life: 12,
      radius: PROJECTILE_RADIUS,
      damage: DAMAGE,
      color: "#57e1bd",
      x: source.x,
      y: source.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      bounceCount: 0,
      armedForHealing: false,
      update({ effect, game, services: entityServices }, dt) {
        const elapsed = Math.max(0, dt);
        const startX = effect.x;
        const startY = effect.y;
        const wasArmedForHealing = effect.armedForHealing;
        effect.x += effect.vx * elapsed;
        effect.y += effect.vy * elapsed;

        if (!effect.armedForHealing && Math.hypot(
          effect.x - source.x,
          effect.y - source.y
        ) > source.radius + PROJECTILE_RADIUS + 2) {
          effect.armedForHealing = true;
        }

        let hit = null;
        let hitProgress = Infinity;
        if (wasArmedForHealing && source.hp > 0) {
          const progress = segmentProgress(
            startX, startY, effect.x, effect.y, source, PROJECTILE_RADIUS
          );
          if (progress !== null) {
            hit = source;
            hitProgress = progress;
          }
        }
        entityServices.forEachEnemy((target) => {
          const progress = segmentProgress(
            startX, startY, effect.x, effect.y, target, PROJECTILE_RADIUS
          );
          if (progress !== null && progress < hitProgress) {
            hit = target;
            hitProgress = progress;
          }
        });

        if (hit === source) {
          effect.x = startX + (effect.x - startX) * hitProgress;
          effect.y = startY + (effect.y - startY) * hitProgress;
          addMedicalTrailPoint(trailState, effect.x, effect.y);
          trailState.active = false;
          source.hp += HEALING;
          entityServices.spawnHitText(source, `+${HEALING}`, { color: "#63ffb5" });
          effect.life = 0;
          return;
        }
        if (hit && entityServices.dealDamage(hit, DAMAGE)) {
          effect.x = startX + (effect.x - startX) * hitProgress;
          effect.y = startY + (effect.y - startY) * hitProgress;
          addMedicalTrailPoint(trailState, effect.x, effect.y);
          trailState.active = false;
          effect.life = 0;
          return;
        }

        const wall = resolveArenaGeometry(game).traceSegment(startX, startY, effect.x, effect.y, effect.radius);
        const touchedWall = Boolean(wall);
        if (wall) {
          effect.x = wall.x; effect.y = wall.y;
          if (resolveArenaGeometry(game).shape !== "circle" && wall.normalX && wall.normalY) {
            effect.vx *= -1; effect.vy *= -1;
          } else {
            const dot = effect.vx * wall.normalX + effect.vy * wall.normalY;
            effect.vx -= 2 * dot * wall.normalX; effect.vy -= 2 * dot * wall.normalY;
          }
        }
        if (touchedWall) {
          if (effect.bounceCount >= MAX_BOUNCES) effect.life = 0;
          else effect.bounceCount += 1;
        }
        addMedicalTrailPoint(trailState, effect.x, effect.y);
        if (effect.life <= 0 || effect.age + elapsed >= effect.life) {
          trailState.active = false;
        }
      },
      draw({ effect }, context) {
        drawMedicalRound(context, effect);
      }
    };
  }

  const medicalBallDefinition = {
    id: "medicalBall",
    name: "\u533b\u7597\u7403",
    englishName: "Medical Ball",
    color: "#39c7a3",
    description: "\u56db\u5411\u533b\u7597\u5f39 / \u4f4e\u8840\u516b\u5411\u5e38\u9a7b",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      let fireTimer = 0;
      let emergencyMode = false;
      let invulnerableUntil = -Infinity;

      function updateEmergency(ball, game) {
        if (emergencyMode || ball.hp >= EMERGENCY_HP) return;
        emergencyMode = true;
        invulnerableUntil = game.time + EMERGENCY_INVULNERABILITY_DURATION;
      }

      return {
        update(context, dt) {
          updateEmergency(context.ball, context.game);
          fireTimer = Math.min(FIRE_INTERVAL, fireTimer + Math.max(0, dt));
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, FIRE_INTERVAL - fireTimer);
        },
        afterUpdateStep(context) {
          if (fireTimer + EPSILON < FIRE_INTERVAL) return;
          fireTimer = 0;
          const count = emergencyMode ? 8 : 4;
          for (let index = 0; index < count; index += 1) {
            services.spawnProjectile(createMedicalRound(
              services,
              context.ball,
              -Math.PI / 2 + index * Math.PI * 2 / count
            ));
          }
        },
        onBeforeDamage(context, event) {
          if (context.game.time + EPSILON < invulnerableUntil) {
            return { amount: 0, showHitText: false };
          }
          return event;
        },
        onDamaged(context) {
          updateEmergency(context.ball, context.game);
        },
        drawBody(context, canvasContext) {
          drawMedicalBody(canvasContext, context.ball);
          return true;
        },
        drawAfter(context, canvasContext) {
          canvasContext.save();
          if (emergencyMode) {
            canvasContext.strokeStyle = "#ffef73";
            canvasContext.lineWidth = 1.5;
            canvasContext.beginPath();
            canvasContext.arc(context.ball.x, context.ball.y, context.ball.radius + 4, 0, Math.PI * 2);
            canvasContext.stroke();
          }
          canvasContext.restore();
        },
        isEmergencyMode() {
          return emergencyMode;
        }
      };
    }
  };

  registerBall(medicalBallDefinition);
  return { medicalBallDefinition };
});
