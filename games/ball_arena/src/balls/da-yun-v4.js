(function initializeDaYunV4(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/knockback.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDaYunV4Plugin({ registerBall, resolveArenaGeometry, createKnockbackEffect: createSharedKnockback }) {
  // 大运V2 的改版：更小的蓝色货车、伤害更低、7 秒一辆、从敌方近侧驶入。
  const TRUCK_INTERVAL = 7.2;
  // 速度与大运Boss 的大货车一致（固定 250）
  const TRUCK_SPEED = 250;
  const TRUCK_LENGTH = 300;
  const TRUCK_HEIGHT = 100;
  const TRUCK_DAMAGE = 5;
  // 击退：0.1 秒、按受害者自身速度的 2 倍推出去
  const TRUCK_KNOCKBACK_DURATION = 0.1;
  const TRUCK_KNOCKBACK_SPEED_MULTIPLIER = 2;
  const TRUCK_IMPACT_RADIUS = 25;
  const MAX_TRAVEL_PER_STEP = 6;
  // 车尾离场后再多走一点才移除
  const EXIT_MARGIN = 10;
  // 货车进场前 0.8 秒，本体右下角出现对讲机
  const RADIO_LEAD_TIME = 0.8;
  const RADIO_DROP_DURATION = 0.45;
  const RADIO_WAVE_DURATION = 0.2;
  const RADIO_FADE_DURATION = 0.25;
  const EPSILON = 1e-9;
  // 蓝色涂装
  const TRUCK_BLUE = "#2f6fb2";
  const TRUCK_BLUE_DARK = "#1d4c7f";
  const TRUCK_BLUE_LIGHT = "#5b9ad6";
  const TRUCK_GLASS = "#a8d8e4";
  const TRUCK_TRIM = "#e8eef5";
  const TRUCK_RED = "#c0392b";

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

  // 与车体的接触点与法线（法线由车面指向目标），用于击退方向和把目标顶出去。
  function truckContact(target, effect) {
    const left = effect.x - TRUCK_LENGTH / 2;
    const right = effect.x + TRUCK_LENGTH / 2;
    const top = effect.y - TRUCK_HEIGHT / 2;
    const bottom = effect.y + TRUCK_HEIGHT / 2;
    const closestX = clamp(target.x, left, right);
    const closestY = clamp(target.y, top, bottom);
    let normalX = target.x - closestX;
    let normalY = target.y - closestY;
    const distance = Math.hypot(normalX, normalY);
    if (distance > target.radius) return null;
    if (distance <= EPSILON) {
      const faces = [
        { distance: target.x - left, x: -1, y: 0, contactX: left, contactY: target.y },
        { distance: right - target.x, x: 1, y: 0, contactX: right, contactY: target.y },
        { distance: target.y - top, x: 0, y: -1, contactX: target.x, contactY: top },
        { distance: bottom - target.y, x: 0, y: 1, contactX: target.x, contactY: bottom }
      ];
      const nearest = faces.reduce((best, candidate) => (
        candidate.distance < best.distance ? candidate : best
      ));
      return {
        normalX: nearest.x,
        normalY: nearest.y,
        contactX: nearest.contactX,
        contactY: nearest.contactY
      };
    }
    return {
      normalX: normalX / distance,
      normalY: normalY / distance,
      contactX: closestX,
      contactY: closestY
    };
  }

  // 击退持续 0.1 秒、速度取受害者自身速度的 2 倍，
  // 到期只还原速度大小、保留击退方向。
  function createTruckKnockback(source, directionX, directionY) {
    return createSharedKnockback({
      id: "da-yun-v4-truck-knockback-" + source.instanceId,
      duration: TRUCK_KNOCKBACK_DURATION,
      directionX,
      directionY,
      speedMultiplier: TRUCK_KNOCKBACK_SPEED_MULTIPLIER
    });
  }
  function spawnTruckImpact(services, x, y) {
    services.spawnParticleBurst({
      kind: "da-yun-v4-truck-impact",
      x,
      y,
      minDiameter: 1,
      maxDiameter: 8,
      colors: ["#ffffff", "#9fc2e0"],
      initialRadius: TRUCK_IMPACT_RADIUS,
      life: 0.42
    });
  }

  function drawWheel(context, x, y) {
    context.fillStyle = "#111416";
    context.beginPath();
    context.arc(x, y, 15, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#050607";
    context.lineWidth = 2.5;
    context.stroke();
    context.fillStyle = "#62696d";
    context.beginPath();
    context.arc(x, y, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#b8bdc0";
    context.beginPath();
    context.arc(x, y, 2.4, 0, Math.PI * 2);
    context.fill();
  }

  // 车头永远朝向行驶方向：先按"朝右"画，向左行驶时整体镜像。
  function drawTruckBody(context) {
    // 底盘
    context.fillStyle = "#22282b";
    context.fillRect(-148, 26, 296, 16);
    context.fillStyle = "#4a5257";
    context.fillRect(-146, 40, 292, 5);

    // 货箱（蓝色）
    context.fillStyle = TRUCK_BLUE_DARK;
    context.fillRect(-150, -50, 172, 78);
    context.fillStyle = TRUCK_BLUE;
    context.fillRect(-145, -46, 162, 70);
    context.fillStyle = TRUCK_BLUE_LIGHT;
    context.fillRect(-145, -46, 162, 7);
    // 箱体加强筋
    context.fillStyle = "rgba(20, 52, 86, 0.55)";
    for (let x = -132; x <= 8; x += 34) {
      context.fillRect(x, -38, 4, 58);
    }
    // 白红腰线
    context.fillStyle = TRUCK_TRIM;
    context.fillRect(-145, 6, 162, 6);
    context.fillStyle = TRUCK_RED;
    context.fillRect(-145, 14, 162, 5);

    // 驾驶室
    context.fillStyle = TRUCK_BLUE_DARK;
    context.beginPath();
    context.moveTo(22, -50);
    context.lineTo(120, -50);
    context.lineTo(150, -14);
    context.lineTo(150, 26);
    context.lineTo(22, 26);
    context.closePath();
    context.fill();
    context.fillStyle = TRUCK_BLUE;
    context.beginPath();
    context.moveTo(27, -45);
    context.lineTo(116, -45);
    context.lineTo(144, -14);
    context.lineTo(144, 21);
    context.lineTo(27, 21);
    context.closePath();
    context.fill();
    // 风挡与侧窗
    context.fillStyle = TRUCK_GLASS;
    context.beginPath();
    context.moveTo(92, -40);
    context.lineTo(112, -40);
    context.lineTo(138, -12);
    context.lineTo(92, -12);
    context.closePath();
    context.fill();
    context.fillRect(46, -40, 40, 26);
    context.fillStyle = "#22282b";
    context.fillRect(88, -42, 3, 30);
    // 进气格栅
    context.fillStyle = "#2b3033";
    context.fillRect(124, -8, 22, 26);
    context.fillStyle = "#7d858a";
    for (let y = -4; y <= 14; y += 6) {
      context.fillRect(126, y, 18, 2.5);
    }
    // 车灯
    context.fillStyle = "#f4d55f";
    context.fillRect(138, 2, 8, 10);
    context.fillStyle = "#d7d9d7";
    context.fillRect(132, 22, 16, 6);
    // 后视镜
    context.fillStyle = "#24292b";
    context.fillRect(80, -58, 3, 14);
    context.fillRect(74, -58, 14, 5);

    // 车轮
    drawWheel(context, 118, 44);
    drawWheel(context, 76, 44);
    drawWheel(context, -44, 44);
    drawWheel(context, -86, 44);
    drawWheel(context, -124, 44);
  }

  // 对讲机：货车进场前 0.8 秒，从本体右上方"线性减速"落到右下角并渐显，
  // 落定后发出小音波，最后"线性加速"渐隐。
  function createRadioEffect(ball) {
    const life = RADIO_DROP_DURATION + RADIO_WAVE_DURATION + RADIO_FADE_DURATION;
    return {
      kind: "da-yun-v4-radio",
      life,
      draw({ effect }, context) {
        if (!context || typeof context.save !== "function" || !ball) return;
        const age = effect.age;
        const radius = Number.isFinite(ball.radius) ? ball.radius : 15;
        const restX = ball.x + radius * 0.78;
        const restY = ball.y + radius * 0.78;
        const startX = ball.x + radius * 1.6;
        const startY = ball.y - radius * 0.6;
        let x = restX;
        let y = restY;
        let alpha = 1;
        if (age < RADIO_DROP_DURATION) {
          const progress = clamp(age / RADIO_DROP_DURATION, 0, 1);
          // 线性减速：1 - (1 - t)²
          const eased = 1 - (1 - progress) * (1 - progress);
          x = startX + (restX - startX) * eased;
          y = startY + (restY - startY) * eased;
          alpha = progress;
        } else if (age > RADIO_DROP_DURATION + RADIO_WAVE_DURATION) {
          const progress = clamp(
            (age - RADIO_DROP_DURATION - RADIO_WAVE_DURATION) / RADIO_FADE_DURATION,
            0,
            1
          );
          alpha = 1 - progress * progress;
        }
        if (alpha <= 0) return;

        context.save();
        context.globalAlpha *= alpha;
        context.translate(x, y);

        // 天线
        context.strokeStyle = "#2b3033";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(3.2, -9);
        context.lineTo(5.4, -17.5);
        context.stroke();
        // 机身
        context.fillStyle = "#20262a";
        context.fillRect(-5.6, -9.4, 11.2, 19.4);
        context.fillStyle = "#4a5257";
        context.fillRect(-4.6, -8.4, 9.2, 17.4);
        // 屏幕
        context.fillStyle = "#a8d8e4";
        context.fillRect(-3.4, -7.2, 6.8, 5);
        // 喇叭格栅
        context.fillStyle = "#22282b";
        for (let index = 0; index < 3; index += 1) {
          context.fillRect(-3, -0.4 + index * 2.7, 6, 1.4);
        }
        // 指示灯
        context.fillStyle = "#e2543a";
        context.fillRect(2.2, 6.2, 2.2, 2.2);

        // 小音波
        if (
          age >= RADIO_DROP_DURATION &&
          age < RADIO_DROP_DURATION + RADIO_WAVE_DURATION
        ) {
          const waveAge = age - RADIO_DROP_DURATION;
          const phase = (waveAge % 0.12) / 0.12;
          context.lineWidth = 1.4;
          context.lineCap = "round";
          for (let index = 0; index < 2; index += 1) {
            const ring = (phase + index * 0.5) % 1;
            context.strokeStyle = "rgba(168, 216, 228, " +
              (0.75 * (1 - ring)).toFixed(3) + ")";
            context.beginPath();
            context.arc(5.5, -5, 4 + ring * 12, -1.05, 0.55);
            context.stroke();
          }
        }
        context.restore();
      }
    };
  }

  function drawTruck(context, effect) {
    context.save();
    context.translate(effect.x, effect.y);
    if (effect.direction < 0) context.scale(-1, 1);

    // 地面阴影
    context.fillStyle = "rgba(0, 0, 0, 0.32)";
    context.fillRect(-155, 52, 310, 8);

    drawTruckBody(context);
    context.restore();

    // 车身文字不参与镜像
    context.save();
    context.translate(effect.x, effect.y);
    context.fillStyle = "rgba(236, 244, 252, 0.8)";
    context.font = "700 17px 'Ball Impact', Impact, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("DAYUN V4", -64, -22);
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
      const contact = truckContact(target, effect);
      if (!truckServices.dealDamage(target, TRUCK_DAMAGE)) continue;
      if (!contact) continue;
      // 同款击退 + 冲击粒子 + 把目标顶出车体 + 反弹朝车内的速度
      truckServices.applyEffect(
        target,
        createTruckKnockback(effect, contact.normalX, contact.normalY)
      );
      spawnTruckImpact(
        truckServices,
        contact.contactX + contact.normalX * 10,
        contact.contactY + contact.normalY * 10
      );
      target.x = contact.contactX + contact.normalX * target.radius;
      target.y = contact.contactY + contact.normalY * target.radius;
      const incomingSpeed = target.vx * contact.normalX + target.vy * contact.normalY;
      if (incomingSpeed < 0) {
        target.vx -= incomingSpeed * 2 * contact.normalX;
        target.vy -= incomingSpeed * 2 * contact.normalY;
        target.storedVx = target.vx;
        target.storedVy = target.vy;
      }
    }
    effect.contacts = touchingNow;
  }

  // 敌方在左半边 → 从左侧驶出（向右开），反之从右侧驶出（向左开）。
  // 纵向瞄准敌方，但整车必须留在战场内：贴顶时下底离顶部正好 100。
  function truckSpawn(source, target, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const speed = TRUCK_SPEED;
    const fromLeft = target.x < arena.centerX;
    const direction = fromLeft ? 1 : -1;
    const centerY = Number.isFinite(target.y) && arena.height >= TRUCK_HEIGHT
      ? clamp(target.y, arena.top + TRUCK_HEIGHT / 2, arena.bottom - TRUCK_HEIGHT / 2)
      : arena.centerY;
    return {
      direction,
      speed,
      x: fromLeft ? arena.left - TRUCK_LENGTH / 2 : arena.right + TRUCK_LENGTH / 2,
      y: centerY,
      vx: direction * speed
    };
  }

  function createTruck(source, target, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const spawn = truckSpawn(source, target, arenaSize);
    return {
      kind: "da-yun-v4-truck",
      life: (arena.width + TRUCK_LENGTH) / spawn.speed + 0.25,
      drawLayer: "background",
      solid: true,
      width: TRUCK_LENGTH,
      height: TRUCK_HEIGHT,
      damage: TRUCK_DAMAGE,
      direction: spawn.direction,
      x: spawn.x,
      y: spawn.y,
      vx: spawn.vx,
      vy: 0,
      contacts: new Set(),
      update({ effect, game, services: truckServices }, dt) {
        if (game.state !== "running") {
          effect.life = 0;
          return;
        }
        let remaining = Math.max(0, dt);
        const maximumStep = MAX_TRAVEL_PER_STEP / spawn.speed;
        if (remaining <= EPSILON) updateTruckContacts(truckServices, effect);
        while (remaining > EPSILON && effect.life > 0) {
          const step = Math.min(remaining, maximumStep);
          effect.x += effect.vx * step;
          updateTruckContacts(truckServices, effect);
          // 车尾完全离场（再留一点余量）才消失，避免尾部还没出去就凭空不见
          const exited = effect.direction > 0
            ? effect.x - TRUCK_LENGTH / 2 > arena.right + EXIT_MARGIN
            : effect.x + TRUCK_LENGTH / 2 < arena.left - EXIT_MARGIN;
          if (exited) effect.life = 0;
          remaining -= step;
        }
      },
      draw({ effect }, context) {
        drawTruck(context, effect);
      }
    };
  }

  const daYunV4Definition = {
    id: "daYunV4",
    name: "\u5927\u8fd0V4",
    englishName: "Da Yun V4",
    color: TRUCK_BLUE,
    description: "7.2秒蓝色货车 300×100 / 速度250 / 碰撞-5+击退 / 从敌方近侧驶入",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: TRUCK_INTERVAL,
    createBehavior(services) {
      let truckTimer = 0;
      let radioShown = false;

      function advanceTruckTimer(dt) {
        truckTimer = Math.min(TRUCK_INTERVAL, truckTimer + Math.max(0, dt));
      }

      // 进场前 0.8 秒掏出对讲机
      function showRadio(context) {
        if (radioShown) return;
        if (truckTimer + EPSILON < TRUCK_INTERVAL - RADIO_LEAD_TIME) return;
        if (!services.getOpponent()) return;
        radioShown = true;
        services.spawnVisualEffect(
          createRadioEffect(context.ball),
          { lifecycle: "owner-bound" }
        );
      }

      function releaseTruck(context) {
        if (truckTimer + EPSILON < TRUCK_INTERVAL) return;
        truckTimer = 0;
        radioShown = false;
        const target = services.getOpponent();
        if (!target) return;
        services.spawnCombatEntity(createTruck(
          context.ball,
          target,
          context.game
        ));
      }

      function nextBoundary() {
        let boundary = TRUCK_INTERVAL - truckTimer;
        if (!radioShown && services.getOpponent()) {
          boundary = Math.min(boundary, TRUCK_INTERVAL - RADIO_LEAD_TIME - truckTimer);
        }
        return Math.max(EPSILON, boundary);
      }

      return {
        update(context, dt) {
          advanceTruckTimer(dt);
          showRadio(context);
        },
        updateWhilePaused(context, dt) {
          advanceTruckTimer(dt);
          showRadio(context);
        },
        getNextTransitionIn() {
          return nextBoundary();
        },
        getNextPausedTransitionIn() {
          return nextBoundary();
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

  registerBall(daYunV4Definition);
  return {
    daYunV4Definition,
    daYunV4TruckSpawn: truckSpawn,
    createDaYunV4RadioEffect: createRadioEffect,
    DA_YUN_V4_RADIO_LEAD_TIME: RADIO_LEAD_TIME,
    DA_YUN_V4_TRUCK_INTERVAL: TRUCK_INTERVAL,
    DA_YUN_V4_TRUCK_LENGTH: TRUCK_LENGTH,
    DA_YUN_V4_TRUCK_HEIGHT: TRUCK_HEIGHT,
    DA_YUN_V4_TRUCK_DAMAGE: TRUCK_DAMAGE,
    DA_YUN_V4_TRUCK_SPEED: TRUCK_SPEED,
    DA_YUN_V4_TRUCK_KNOCKBACK_DURATION: TRUCK_KNOCKBACK_DURATION,
    DA_YUN_V4_TRUCK_KNOCKBACK_SPEED_MULTIPLIER: TRUCK_KNOCKBACK_SPEED_MULTIPLIER
  };
});
