(function initializeDaYunV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunV2Plugin({ registerBall, resolveArenaGeometry }) {
  const TRUCK_INTERVAL = 30;
  const TRUCK_SPEED_MULTIPLIER = 2.5;
  const TRUCK_LENGTH = 400;
  const TRUCK_HEIGHT = 150;
  const TRUCK_DAMAGE = 100;
  const MAX_TRAVEL_PER_STEP = 6;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function circleTouchesTruck(target, effect) {
    const closestX = clamp(
      target.x,
      effect.x - TRUCK_LENGTH / 2,
      effect.x + TRUCK_LENGTH / 2
    );
    const closestY = clamp(
      target.y,
      effect.y - TRUCK_HEIGHT / 2,
      effect.y + TRUCK_HEIGHT / 2
    );
    return Math.hypot(target.x - closestX, target.y - closestY) <= target.radius;
  }

  function drawWheel(context, x, y) {
    context.fillStyle = "#111416";
    context.beginPath();
    context.arc(x, y, 20, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#050607";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = "#62696d";
    context.beginPath();
    context.arc(x, y, 9, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#b8bdc0";
    context.beginPath();
    context.arc(x, y, 3, 0, Math.PI * 2);
    context.fill();
  }

  function drawTruck(context, effect) {
    context.save();
    context.translate(effect.x, effect.y);

    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    context.fillRect(-205, 62, 410, 9);

    context.fillStyle = "#15191b";
    context.fillRect(-108, -72, 311, 111);
    context.fillStyle = "#9f2f2a";
    context.fillRect(-104, -68, 303, 101);
    context.fillStyle = "#c54236";
    context.fillRect(-98, -62, 291, 10);
    context.fillStyle = "#7d2422";
    for (let x = -78; x <= 172; x += 50) {
      context.fillRect(x, -51, 3, 81);
    }
    context.fillStyle = "rgba(245, 220, 196, 0.72)";
    context.font = "700 18px 'Ball Impact', Impact, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("DAYUN V2", 50, -13);

    context.fillStyle = "#15191b";
    context.beginPath();
    context.moveTo(-202, 36);
    context.lineTo(-202, -29);
    context.lineTo(-174, -63);
    context.lineTo(-104, -63);
    context.lineTo(-94, 36);
    context.closePath();
    context.fill();
    context.fillStyle = "#c33d33";
    context.beginPath();
    context.moveTo(-197, 31);
    context.lineTo(-197, -25);
    context.lineTo(-170, -58);
    context.lineTo(-109, -58);
    context.lineTo(-100, 31);
    context.closePath();
    context.fill();

    context.fillStyle = "#9fd3dc";
    context.beginPath();
    context.moveTo(-188, -25);
    context.lineTo(-166, -52);
    context.lineTo(-142, -52);
    context.lineTo(-142, -24);
    context.closePath();
    context.fill();
    context.fillRect(-136, -52, 21, 28);
    context.fillStyle = "#22282b";
    context.fillRect(-139, -55, 3, 34);
    context.fillStyle = "#f4d55f";
    context.fillRect(-201, 7, 7, 12);
    context.fillStyle = "#d7d9d7";
    context.fillRect(-205, 28, 13, 7);
    context.fillStyle = "#24292b";
    context.fillRect(-110, -20, 9, 4);

    context.fillStyle = "#2b3033";
    context.fillRect(-202, 28, 401, 13);
    context.fillStyle = "#697175";
    context.fillRect(-99, 34, 298, 6);

    drawWheel(context, -163, 43);
    drawWheel(context, -78, 43);
    drawWheel(context, 119, 43);
    drawWheel(context, 169, 43);

    context.strokeStyle = "rgba(208, 215, 218, 0.38)";
    context.lineWidth = 2;
    [9, 22, 35].forEach((offset) => {
      context.beginPath();
      context.moveTo(202 + offset, -28 + offset * 0.25);
      context.lineTo(244 + offset, -28 + offset * 0.25);
      context.stroke();
    });
    context.restore();
  }

  function updateTruckContacts(truckServices, effect) {
    const touchingNow = new Set();
    const targets = [];
    truckServices.forEachContactEnemy(target => targets.push(target));
    for (const target of targets) {
      const overlapping = circleTouchesTruck(target, effect);
      truckServices.notifyEntityContact(target, effect, { overlapping });
      if (!overlapping) continue;
      const key = target.instanceId || target.id;
      touchingNow.add(key);
      if (effect.contacts.has(key)) continue;
      effect.contacts.add(key);
      if (
        truckServices.getContactProfile(target).attackable &&
        truckServices.tryConsumeEntity(target, effect, { physical: true })
      ) {
        effect.life = 0;
        return;
      }
      truckServices.dealDamage(target, TRUCK_DAMAGE);
    }
    effect.contacts = touchingNow;
  }

  function createTruck(source, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const speed = source.speed * TRUCK_SPEED_MULTIPLIER;
    return {
      kind: "da-yun-v2-truck",
      life: (arena.width + TRUCK_LENGTH) / speed + 0.25,
      drawLayer: "background",
      solid: true,
      width: TRUCK_LENGTH,
      height: TRUCK_HEIGHT,
      damage: TRUCK_DAMAGE,
      x: arena.right + TRUCK_LENGTH / 2,
      y: arena.height >= TRUCK_HEIGHT ? arena.bottom - TRUCK_HEIGHT / 2 : arena.centerY,
      vx: -speed,
      vy: 0,
      contacts: new Set(),
      update({ effect, game, services: truckServices }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        let remaining = Math.max(0, dt);
        const maximumStep = MAX_TRAVEL_PER_STEP / speed;
        if (remaining <= EPSILON) updateTruckContacts(truckServices, effect);
        while (remaining > EPSILON && effect.life > 0) {
          const step = Math.min(remaining, maximumStep);
          effect.x += effect.vx * step;
          updateTruckContacts(truckServices, effect);
          if (effect.x + TRUCK_LENGTH / 2 < 0) effect.life = 0;
          remaining -= step;
        }
      },
      draw({ effect }, context) {
        drawTruck(context, effect);
      }
    };
  }

  const daYunV2Definition = {
    id: "daYunV2",
    name: "\u5927\u8fd0V2",
    englishName: "Da Yun V2",
    color: "#747a7e",
    description: "30秒大货车 / 2.5倍速 / 碰撞-100",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: TRUCK_INTERVAL,
    createBehavior(services) {
      let truckTimer = 0;
      function advanceTruckTimer(dt) {
        truckTimer = Math.min(TRUCK_INTERVAL, truckTimer + Math.max(0, dt));
      }
      function releaseTruck(context) {
        if (truckTimer + EPSILON < TRUCK_INTERVAL) return;
        truckTimer = 0;
        services.spawnCombatEntity(createTruck(context.ball, context.game));
        services.playSound("ability", { cue: "truck" });
      }
      return {
        update(_context, dt) {
          advanceTruckTimer(dt);
        },
        updateWhilePaused(_context, dt) {
          advanceTruckTimer(dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, TRUCK_INTERVAL - truckTimer);
        },
        getNextPausedTransitionIn() {
          return Math.max(EPSILON, TRUCK_INTERVAL - truckTimer);
        },
        afterUpdateStep(context) {
          releaseTruck(context);
        },
        afterUpdateStepWhilePaused(context) {
          releaseTruck(context);
        },
        getTruckTimer() {
          return truckTimer;
        }
      };
    }
  };

  registerBall(daYunV2Definition);
  return { daYunV2Definition };
});
