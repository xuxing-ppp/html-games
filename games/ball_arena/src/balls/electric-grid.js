(function initializeElectricGrid(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createElectricGridPlugin({ registerBall }) {
  // 电网：每 3 秒在电网球当前所在位置钉一个锚点，锚点永久保留、不设上限；
  // 每 3.5 秒全部锚点两两通电（完全图），被电流穿过的敌人按「穿过它的线条数」
  // 各结算一份震动；震动控制会一直持续到电流消失之后 1 秒。
  //
  // 连接方式与实体数量是这套设计的关键：一轮通电只生成 1 个
  // electric-grid-conduction 实体，它一次性画完全部连线、一次性做完判定。
  // 早先每条线一个实体的写法在锚点不设上限后会退化成一轮上千个实体。
  const ANCHOR_INTERVAL = 3;
  const CONDUCTION_INTERVAL = 3.5;
  const LINK_ACTIVE_DURATION = 0.5;
  const LINK_FADE_DURATION = 0.3;
  const LINK_LIFETIME = LINK_ACTIVE_DURATION + LINK_FADE_DURATION;
  // 电流消失之后，控制还要再留这么久才结束。
  const CONTROL_TAIL_SECONDS = 1;
  // 每次震动固定结算 4 跳。duration 随命中时刻在 1.3~1.8 秒之间浮动，
  // 固定间隔没法在两种情形下都恰好 4 跳，所以间隔由 duration 推导。
  const TREMOR_TICK_COUNT = 4;
  const TREMOR_TICK_DAMAGE = 2;
  const LINK_WIDTH = 4;
  const ANCHOR_COLOR = "#8ef3ff";
  const LINK_SEGMENT_LENGTH = 24;
  const LINK_JITTER = 10;
  // 全部连线共用一趟绘制，火花按线条数抽稀，总数封顶。
  const SPARK_LINK_BUDGET = 200;
  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function linkNoise(seed, index, frame) {
    const value = Math.sin(seed * 0.017 + index * 12.9898 + frame * 2.33) * 43758.5453;
    return value - Math.floor(value);
  }

  // 线段是否碰到以 (centerX, centerY) 为心、radius 为半径的圆。
  // 先用外扩 radius 的包围盒剔除，再比平方距离——全程标量、不分配对象。
  // 包围盒只剔除必然不碰的情况，命中结果与「求最近点再比距离」完全一致。
  function segmentReachesCircle(startX, startY, endX, endY, centerX, centerY, radius) {
    if (centerX < Math.min(startX, endX) - radius) return false;
    if (centerX > Math.max(startX, endX) + radius) return false;
    if (centerY < Math.min(startY, endY) - radius) return false;
    if (centerY > Math.max(startY, endY) + radius) return false;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    let progress = 0;
    if (lengthSquared > EPSILON) {
      progress = clamp(
        ((centerX - startX) * deltaX + (centerY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    }
    const offsetX = centerX - (startX + deltaX * progress);
    const offsetY = centerY - (startY + deltaY * progress);
    return offsetX * offsetX + offsetY * offsetY <= radius * radius;
  }

  function createTremorEffect(duration, shares) {
    const resolvedShares = Math.max(1, Math.floor(shares) || 1);
    return {
      id: "electric-grid-tremor",
      visualType: "stun",
      duration,
      tickInterval: duration / TREMOR_TICK_COUNT,
      tickDamage: TREMOR_TICK_DAMAGE * resolvedShares,
      shares: resolvedShares,
      locksMovement: true,
      preventsAttack: true,
      pausesBehavior: true,
      onApply({ ball, effect, game, isRefresh }) {
        if (!isRefresh) {
          effect.savedVx = ball.storedVx != null ? ball.storedVx : ball.vx;
          effect.savedVy = ball.storedVy != null ? ball.storedVy : ball.vy;
        }
        effect.nextDamageAt = game.time + effect.tickInterval;
        ball.vx = 0;
        ball.vy = 0;
      },
      update({ ball, effect, game, services: effectServices }) {
        while (
          effect.nextDamageAt > 0 &&
          game.time >= effect.nextDamageAt &&
          effect.nextDamageAt <= effect.expiresAt + EPSILON
        ) {
          effectServices.dealDamage(ball, effect.tickDamage);
          effect.nextDamageAt += effect.tickInterval;
        }
        if (game.time < effect.expiresAt) {
          ball.vx = 0;
          ball.vy = 0;
        }
      },
      onExpire({ ball, effect }) {
        ball.vx = effect.savedVx;
        ball.vy = effect.savedVy;
        ball.storedVx = effect.savedVx;
        ball.storedVy = effect.savedVy;
      },
      drawBefore({ effect, game }, context) {
        const frame = Math.floor(game.time * 48) % 4;
        effect.renderOffsetX = frame === 0 ? -2 : (frame === 2 ? 2 : 0);
        effect.renderOffsetY = frame === 1 ? -2 : (frame === 3 ? 2 : 0);
        context.translate(effect.renderOffsetX, effect.renderOffsetY);
      }
    };
  }

  function livingAnchors(anchors) {
    const active = [];
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];
      if (anchor && anchor.entityActive !== false) active.push(anchor);
    }
    return active;
  }

  // 锚点画在本体之前。早先每个锚点每帧各来一次 shadowBlur，实测 100 个锚点
  // 要 1.2ms；换成叠层 alpha 光环后是 0.1ms，观感基本一致。
  function createAnchor(services, x, y) {
    return services.spawnCombatEntity({
      kind: "electric-grid-anchor",
      combatKind: "zone",
      lifecycle: "owner-bound",
      life: Number.MAX_SAFE_INTEGER,
      drawLayer: "background",
      x,
      y,
      draw({ effect }, context) {
        const pulse = 0.6 + Math.sin(effect.age * 6) * 0.35;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.fillStyle = ANCHOR_COLOR;
        context.fillRect(effect.x - 1.5, effect.y - 9, 3, 10);
        context.beginPath();
        context.arc(effect.x, effect.y - 11, 3 + pulse, 0, Math.PI * 2);
        context.fill();
        context.globalAlpha *= 0.25 * pulse;
        context.strokeStyle = ANCHOR_COLOR;
        context.beginPath();
        context.arc(effect.x, effect.y - 10, 8 + pulse * 6, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }
    });
  }

  function appendLinkPath(context, first, second, seed, linkIndex, frame) {
    const startX = first.x;
    const startY = first.y;
    const deltaX = second.x - startX;
    const deltaY = second.y - startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
    const segments = Math.max(4, Math.ceil(distance / LINK_SEGMENT_LENGTH));
    const normalX = -deltaY / distance;
    const normalY = deltaX / distance;
    context.moveTo(startX, startY);
    for (let index = 1; index <= segments; index += 1) {
      const progress = index / segments;
      const offset = index === segments
        ? 0
        : (linkNoise(seed, linkIndex * 37 + index, frame) - 0.5) * LINK_JITTER;
      context.lineTo(
        startX + deltaX * progress + normalX * offset,
        startY + deltaY * progress + normalY * offset
      );
    }
  }

  function appendLinkSparks(context, first, second, seed, linkIndex, frame) {
    const startX = first.x;
    const startY = first.y;
    const deltaX = second.x - startX;
    const deltaY = second.y - startY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY) || 1;
    const segments = Math.max(4, Math.ceil(distance / LINK_SEGMENT_LENGTH));
    const normalX = -deltaY / distance;
    const normalY = deltaX / distance;
    for (let index = 1; index < segments; index += 2) {
      if (linkNoise(seed, linkIndex * 37 + index + 30, frame) < 0.6) continue;
      const progress = index / segments;
      const offset = (linkNoise(seed, linkIndex * 37 + index, frame) - 0.5) * LINK_JITTER;
      context.fillRect(
        Math.round(startX + deltaX * progress + normalX * offset) - 1,
        Math.round(startY + deltaY * progress + normalY * offset) - 1,
        3,
        3
      );
    }
  }

  // 一轮通电：锚点数组的活引用 + 自己这轮的命中名单。
  function createConduction(anchors) {
    return {
      kind: "electric-grid-conduction",
      combatKind: "zone",
      life: LINK_LIFETIME,
      activeDuration: LINK_ACTIVE_DURATION,
      anchors,
      hitTargets: new Set(),
      pairCount: 0,
      visualSeed: Math.floor(Math.random() * 0x100000000) >>> 0,
      update({ effect, services: entityServices }) {
        const active = livingAnchors(effect.anchors);
        effect.pairCount = active.length < 2
          ? 0
          : (active.length * (active.length - 1)) / 2;
        if (effect.age > effect.activeDuration + EPSILON) return;
        if (active.length < 2) return;
        entityServices.forEachEnemy((target) => {
          const key = target.instanceId;
          if (!key || effect.hitTargets.has(key)) return;
          const radius = Number.isFinite(target.radius) ? target.radius : 15;
          const reach = radius + LINK_WIDTH / 2;
          let shares = 0;
          for (let first = 0; first < active.length; first += 1) {
            const a = active[first];
            for (let second = first + 1; second < active.length; second += 1) {
              const b = active[second];
              if (segmentReachesCircle(a.x, a.y, b.x, b.y, target.x, target.y, reach)) {
                shares += 1;
              }
            }
          }
          if (shares === 0) return;
          effect.hitTargets.add(key);
          entityServices.applyEffect(target, createTremorEffect(
            (LINK_LIFETIME - effect.age) + CONTROL_TAIL_SECONDS,
            shares
          ));
        });
      },
      draw({ effect }, context) {
        const active = livingAnchors(effect.anchors);
        if (active.length < 2) return;
        const fade = effect.age <= effect.activeDuration
          ? 1
          : clamp((effect.life - effect.age) / LINK_FADE_DURATION, 0, 1);
        const frame = Math.floor(effect.age * 40);
        const pairCount = (active.length * (active.length - 1)) / 2;
        const sparkStride = Math.max(1, Math.ceil(pairCount / SPARK_LINK_BUDGET));
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= fade * 0.45;
        context.shadowColor = ANCHOR_COLOR;
        context.shadowBlur = 4;
        context.strokeStyle = "rgba(142, 243, 255, 0.3)";
        context.lineWidth = LINK_WIDTH;
        context.beginPath();
        let linkIndex = 0;
        for (let first = 0; first < active.length; first += 1) {
          for (let second = first + 1; second < active.length; second += 1) {
            appendLinkPath(
              context, active[first], active[second], effect.visualSeed, linkIndex, frame
            );
            linkIndex += 1;
          }
        }
        context.stroke();
        context.shadowBlur = 1.5;
        context.strokeStyle = "#e9fcff";
        context.lineWidth = 1.4;
        context.stroke();
        context.fillStyle = "#c9f7ff";
        linkIndex = 0;
        for (let first = 0; first < active.length; first += 1) {
          for (let second = first + 1; second < active.length; second += 1) {
            if (linkIndex % sparkStride === 0) {
              appendLinkSparks(
                context, active[first], active[second], effect.visualSeed, linkIndex, frame
              );
            }
            linkIndex += 1;
          }
        }
        context.restore();
      }
    };
  }

  const electricGridDefinition = {
    id: "electricGrid",
    name: "电网",
    englishName: "Electric Grid",
    color: "#52d9ff",
    description: "每3秒震彯电锚点 / 两点每3.5秒通电电流",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: ANCHOR_INTERVAL,
    createBehavior(services) {
      let anchorTimer = 0;
      let conductionTimer = 0;
      let lastConductionShares = 0;
      const anchors = [];

      return {
        update(_context, dt) {
          const elapsed = Math.max(0, dt);
          anchorTimer = Math.min(ANCHOR_INTERVAL, anchorTimer + elapsed);
          conductionTimer = Math.min(CONDUCTION_INTERVAL, conductionTimer + elapsed);
          for (let index = anchors.length - 1; index >= 0; index -= 1) {
            if (anchors[index].entityActive === false) anchors.splice(index, 1);
          }
        },
        getNextTransitionIn() {
          return Math.min(
            ANCHOR_INTERVAL - anchorTimer,
            anchors.length >= 2 ? CONDUCTION_INTERVAL - conductionTimer : Infinity
          );
        },
        afterUpdateStep(context) {
          if (anchorTimer + EPSILON >= ANCHOR_INTERVAL) {
            anchorTimer = 0;
            anchors.push(createAnchor(services, context.ball.x, context.ball.y));
          }
          if (
            anchors.length >= 2 &&
            conductionTimer + EPSILON >= CONDUCTION_INTERVAL
          ) {
            conductionTimer = 0;
            const conduction = services.spawnCombatEntity(createConduction(anchors));
            if (conduction) lastConductionShares = anchors.length;
          }
        },
        getGridState() {
          return {
            anchors: anchors.filter((anchor) => anchor.entityActive !== false).length,
            anchorTimer,
            conductionTimer,
            lastConductionShares
          };
        }
      };
    }
  };

  registerBall(electricGridDefinition);
  return { electricGridDefinition, createTremorEffect };
});
