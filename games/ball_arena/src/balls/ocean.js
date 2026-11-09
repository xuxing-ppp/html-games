(function initializeOcean(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOceanPlugin({ resolveArenaGeometry, registerBall }) {
  const BUBBLE_INTERVAL = 0.6;
  const BUBBLE_RADIUS = 4;
  const BUBBLE_SPEED = 45;
  const BUBBLE_HEAL = 1;
  const SCHOOL_INTERVAL = 2.7;
  const SCHOOL_SPEED = 120;
  const SCHOOL_DAMAGE = 2;
  const FISH_WIDTH = 10;
  const FISH_HEIGHT = 2;
  const EDGE_MARGIN = 34;
  const EPSILON = 1e-9;
  const FORMATION = Object.freeze([
    [0, 0],
    [-12, -6], [-12, 6],
    [-24, 0],
    [-27, -11], [-27, 11],
    [-39, -5], [-39, 5],
    [-48, -14], [-48, 14]
  ]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function effectIsAlive(effect) {
    return effect && effect.life > 0 && effect.age + EPSILON < effect.life;
  }

  function drawOceanBackground({ game }, context) {
    const arenaSize = game.arenaSize;
    context.save();
    context.fillStyle = "rgba(16, 109, 171, 0.28)";
    context.fillRect(0, 0, arenaSize, arenaSize);
    context.strokeStyle = "rgba(110, 205, 235, 0.13)";
    context.lineWidth = 1;
    for (let row = 0; row < 6; row += 1) {
      const baseY = (row + 0.65) * arenaSize / 6;
      context.beginPath();
      context.moveTo(0, baseY);
      for (let x = 20; x <= arenaSize + 20; x += 20) {
        context.lineTo(
          Math.min(x, arenaSize),
          baseY + Math.sin(game.time * 1.4 + x * 0.035 + row * 1.7) * 2.2
        );
      }
      context.stroke();
    }
    context.restore();
  }

  function drawBubble(effect, context) {
    context.save();
    context.globalAlpha *= 0.68;
    context.fillStyle = "rgba(111, 220, 255, 0.18)";
    context.strokeStyle = "#8edfff";
    context.lineWidth = 1;
    context.beginPath();
    context.arc(effect.x, effect.y, effect.radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "rgba(235, 252, 255, 0.8)";
    context.beginPath();
    context.arc(effect.x - 1.3, effect.y - 1.4, 0.9, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function createBubble(source, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const point = arena.boundaryPoint("bottom", 1 - Math.random(), BUBBLE_RADIUS);
    const x = point.x;
    const phase = Math.random() * Math.PI * 2;
    return {
      kind: "ocean-bubble",
      drawLayer: "background",
      life: (arena.size + BUBBLE_RADIUS * 2) / BUBBLE_SPEED + 1,
      radius: BUBBLE_RADIUS,
      x,
      y: point.y,
      vy: -BUBBLE_SPEED,
      phase,
      update({ effect, services: bubbleServices }, dt) {
        const elapsed = Math.max(0, dt);
        effect.y += effect.vy * elapsed;
        effect.x += Math.sin(effect.age * 2.1 + effect.phase) * 6 * elapsed;
        if (arena.shape !== "circle") effect.x = clamp(effect.x, arena.left + effect.radius, arena.right - effect.radius);
        if (!arena.intersectsCircle(effect.x, effect.y, effect.radius)) {
          effect.life = 0;
          return;
        }
        const touchesBubble = (ball) => Math.hypot(
          ball.x - effect.x,
          ball.y - effect.y
        ) <= ball.radius + effect.radius;
        let recipient = source.hp > 0 && touchesBubble(source) ? source : null;
        if (!recipient) {
          bubbleServices.forEachAlly((ally) => {
            if (!recipient && touchesBubble(ally)) recipient = ally;
          });
        }
        if (!recipient) return;
        recipient.hp += BUBBLE_HEAL;
        bubbleServices.spawnHitText(recipient, `+${BUBBLE_HEAL}`, { color: "#8de8ff" });
        effect.life = 0;
      },
      draw({ effect }, context) {
        drawBubble(effect, context);
      }
    };
  }

  function schoolPath(arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape !== "square") {
      const edge = Math.min(3, Math.floor(Math.random() * 4));
      const sides = ["left", "right", "top", "bottom"];
      const progress = Math.random();
      const endProgress = clamp(1 - progress + (Math.random() - 0.5) * 0.35, 0.1, 0.9);
      const start = arena.boundaryPoint(sides[edge], progress);
      const end = arena.boundaryPoint(sides[edge ^ 1], endProgress);
      return { startX: start.x - start.normalX * EDGE_MARGIN, startY: start.y - start.normalY * EDGE_MARGIN,
        endX: end.x - end.normalX * EDGE_MARGIN, endY: end.y - end.normalY * EDGE_MARGIN };
    }
    arenaSize = arena.size;
    const edge = Math.min(3, Math.floor(Math.random() * 4));
    const startAlong = 30 + Math.random() * (arenaSize - 60);
    const endAlong = clamp(
      startAlong + (Math.random() - 0.5) * arenaSize * 0.35,
      20,
      arenaSize - 20
    );
    if (edge === 0) return {
      startX: -EDGE_MARGIN, startY: startAlong,
      endX: arenaSize + EDGE_MARGIN, endY: endAlong
    };
    if (edge === 1) return {
      startX: arenaSize + EDGE_MARGIN, startY: startAlong,
      endX: -EDGE_MARGIN, endY: endAlong
    };
    if (edge === 2) return {
      startX: startAlong, startY: -EDGE_MARGIN,
      endX: endAlong, endY: arenaSize + EDGE_MARGIN
    };
    return {
      startX: startAlong, startY: arenaSize + EDGE_MARGIN,
      endX: endAlong, endY: -EDGE_MARGIN
    };
  }

  function updateFishPositions(school) {
    const normalX = -school.directionY;
    const normalY = school.directionX;
    const formationPulse = (1 - Math.cos(school.schoolTime * 1.65)) / 2;
    const lateralSpread = 0.55 + formationPulse * 1.1;
    const longitudinalSpread = 0.9 + formationPulse * 0.3;
    school.fish.forEach((fish) => {
      const along = fish.baseAlong * longitudinalSpread + Math.sin(
        school.schoolTime * 2.3 + fish.phase
      ) * 1.8;
      const lateral = fish.baseLateral * lateralSpread + Math.sin(
        school.schoolTime * 3.1 + fish.phase
      ) * 2.4;
      fish.x = school.leaderX + school.directionX * along + normalX * lateral;
      fish.y = school.leaderY + school.directionY * along + normalY * lateral;
      fish.angle = school.angle + Math.sin(
        school.schoolTime * 7.5 + fish.phase
      ) * 0.075;
    });
  }

  function fishTouchesTarget(fish, target) {
    const cosine = Math.cos(fish.angle);
    const sine = Math.sin(fish.angle);
    const deltaX = target.x - fish.x;
    const deltaY = target.y - fish.y;
    const localX = deltaX * cosine + deltaY * sine;
    const localY = -deltaX * sine + deltaY * cosine;
    const closestX = clamp(localX, -fish.width / 2, fish.width / 2);
    const closestY = clamp(localY, -fish.height / 2, fish.height / 2);
    return Math.hypot(localX - closestX, localY - closestY) <= target.radius;
  }

  function drawFish(fish, schoolTime, context) {
    const tailSwing = Math.sin(schoolTime * 12 + fish.phase) * 1.25;
    context.save();
    context.translate(fish.x, fish.y);
    context.rotate(fish.angle);
    context.fillStyle = "#9ccbd5";
    context.strokeStyle = "rgba(218, 246, 249, 0.72)";
    context.lineWidth = 0.7;
    context.beginPath();
    context.moveTo(5.2, 0);
    context.quadraticCurveTo(0.5, -2.1, -4.2, 0);
    context.quadraticCurveTo(0.5, 2.1, 5.2, 0);
    context.fill();
    context.stroke();
    context.fillStyle = "#6ba7b8";
    context.beginPath();
    context.moveTo(-3.8, 0);
    context.lineTo(-7.2, -2.6 + tailSwing);
    context.lineTo(-6.3, 0);
    context.lineTo(-7.2, 2.6 + tailSwing);
    context.closePath();
    context.fill();
    context.fillStyle = "#152f38";
    context.beginPath();
    context.arc(3.2, -0.55, 0.55, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  function createSchool(arenaSize) {
    const path = schoolPath(arenaSize);
    const deltaX = path.endX - path.startX;
    const deltaY = path.endY - path.startY;
    const distance = Math.hypot(deltaX, deltaY) || 1;
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    const school = {
      kind: "ocean-sardine-school",
      drawLayer: "background",
      life: distance / SCHOOL_SPEED + 1,
      schoolTime: 0,
      leaderX: path.startX,
      leaderY: path.startY,
      directionX,
      directionY,
      angle: Math.atan2(directionY, directionX),
      vx: directionX * SCHOOL_SPEED,
      vy: directionY * SCHOOL_SPEED,
      fish: FORMATION.map(([baseAlong, baseLateral], index) => ({
        width: FISH_WIDTH,
        height: FISH_HEIGHT,
        baseAlong,
        baseLateral,
        phase: index * 1.73,
        x: path.startX,
        y: path.startY,
        angle: Math.atan2(directionY, directionX),
        hitTargets: new Set()
      })),
      update({ effect, services: schoolServices }, dt) {
        const elapsed = Math.max(0, dt);
        effect.schoolTime += elapsed;
        effect.leaderX += effect.vx * elapsed;
        effect.leaderY += effect.vy * elapsed;
        updateFishPositions(effect);
        for (const fish of effect.fish) {
          schoolServices.forEachEnemy((target) => {
            const key = target.instanceId || target.id;
            if (
              fish.hitTargets.has(key) ||
              !schoolServices.getContactProfile(target).attackable ||
              !fishTouchesTarget(fish, target)
            ) return;
            fish.hitTargets.add(key);
            schoolServices.dealDamage(target, SCHOOL_DAMAGE);
          });
        }
      },
      draw({ effect }, context) {
        context.save();
        context.globalAlpha *= 0.9;
        for (const fish of effect.fish) drawFish(fish, effect.schoolTime, context);
        context.restore();
      }
    };
    updateFishPositions(school);
    return school;
  }

  const oceanDefinition = {
    id: "ocean",
    name: "\u6d77\u6d0b",
    englishName: "Ocean",
    color: "#2b91c9",
    description: "\u6c14\u6ce1+1 / 2.7\u79d2\u6c99\u4e01\u9c7c\u7fa4 / \u5355\u9c7c-2",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: SCHOOL_INTERVAL,
    createBehavior(services) {
      let bubbleTimer = 0;
      let schoolTimer = 0;
      const bubbles = [];
      const schools = [];

      function advanceFieldTimers(dt) {
        const elapsed = Math.max(0, dt);
        bubbleTimer = Math.min(BUBBLE_INTERVAL, bubbleTimer + elapsed);
        schoolTimer = Math.min(SCHOOL_INTERVAL, schoolTimer + elapsed);
      }

      function releaseFieldEntities(context) {
        if (bubbleTimer + EPSILON >= BUBBLE_INTERVAL) {
          bubbleTimer = 0;
          bubbles.push(services.spawnCombatEntity(createBubble(
            context.ball,
            context.game
          )));
        }
        if (schoolTimer + EPSILON >= SCHOOL_INTERVAL) {
          schoolTimer = 0;
          schools.push(services.spawnCombatEntity(createSchool(context.game)));
        }
      }

      function nextFieldTransition() {
        return Math.max(EPSILON, Math.min(
          BUBBLE_INTERVAL - bubbleTimer,
          SCHOOL_INTERVAL - schoolTimer
        ));
      }

      return {
        update(_context, dt) {
          advanceFieldTimers(dt);
        },
        updateWhilePaused(_context, dt) {
          advanceFieldTimers(dt);
        },
        getNextTransitionIn() {
          return nextFieldTransition();
        },
        getNextPausedTransitionIn() {
          return nextFieldTransition();
        },
        afterUpdateStep(context) {
          releaseFieldEntities(context);
        },
        afterUpdateStepWhilePaused(context) {
          releaseFieldEntities(context);
        },
        drawArenaBackground(context, canvasContext) {
          drawOceanBackground(context, canvasContext);
        },
        getOceanState() {
          return {
            bubbleTimer,
            schoolTimer,
            bubbles: bubbles.filter(effectIsAlive),
            schools: schools.filter(effectIsAlive)
          };
        }
      };
    }
  };

  registerBall(oceanDefinition);
  return { oceanDefinition };
});
