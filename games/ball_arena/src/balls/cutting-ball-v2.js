(function initializeCuttingBallV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCuttingBallV2Plugin({ registerBall, resolveArenaGeometry, firstSegmentCircleContact }) {
  const TAU = Math.PI * 2;
  // 开局放出的坐标球：直径 5、速度 150、永久隐身（只画贯穿战场的光束，不画球体）、没有血量。
  const NODE_RADIUS = 2.5;
  const NODE_SPEED = 150;
  // 蓝、橙各两颗，方向各自独立随机；蓝横 × 橙竖得到 4 个交点。
  const NODES_PER_AXIS = 2;
  const BEAM_WIDTH = 1.5;
  const BEAM_GLOW_WIDTH = 4.5;
  // 光束压暗一点，把视线让给红色焦点。
  const BEAM_CORE_ALPHA = 0.6;
  const BEAM_GLOW_ALPHA = 0.18;
  // 交叉点：红色激光灼烧焦点。
  const FOCUS_RADIUS = 5;
  const FOCUS_DAMAGE = 2;
  const FOCUS_DAMAGE_INTERVAL = 0.2;
  const SMOKE_INTERVAL = 0.06;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const SMOKE_COLORS = Object.freeze([
    "#ffffff",
    "#e8e8ee",
    "#b9bcc4",
    "#8d9098"
  ]);
  // 蓝色坐标球走 x 轴（横向光束），橙色坐标球走 y 轴（竖向光束）。
  const AXIS_PALETTE = Object.freeze({
    x: Object.freeze({ core: "#4d92ff", glow: "#1f4dd8" }),
    y: Object.freeze({ core: "#ff9226", glow: "#d85a10" })
  });

  function randomDirection() {
    const angle = Math.random() * TAU;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function drawBeam(entity, arenaSize, palette, context) {
    const horizontal = entity.axis === "x";
    const arena = resolveArenaGeometry(arenaSize);
    const nx = horizontal ? 1 : 0, ny = horizontal ? 0 : 1;
    const backward = arena.movementLimit(entity.x, entity.y, -nx, -ny, Infinity);
    const forward = arena.movementLimit(entity.x, entity.y, nx, ny, Infinity);
    const startX = entity.x - nx * backward, startY = entity.y - ny * backward;
    const endX = entity.x + nx * forward, endY = entity.y + ny * forward;
    const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    context.save();
    context.globalCompositeOperation = "lighter";
    // 外圈柔光 + 细内芯，整体是一条横跨/纵跨整个战场的细光束。
    context.strokeStyle = palette.glow;
    context.lineWidth = BEAM_GLOW_WIDTH;
    context.globalAlpha = baseAlpha * BEAM_GLOW_ALPHA;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.strokeStyle = palette.core;
    context.lineWidth = BEAM_WIDTH;
    context.globalAlpha = baseAlpha * BEAM_CORE_ALPHA;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
    context.restore();
  }

  // 永久隐身坐标球：没有任何 hp 字段，也没有球体绘制，只负责带着自己的光束在整个战场里弹跳。
  function createCuttingV2Node(source, axis, direction) {
    const palette = AXIS_PALETTE[axis];
    return {
      kind: `cutting-v2-${axis}-node`,
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      indestructible: true,
      solid: false,
      drawLayer: "background",
      axis,
      radius: NODE_RADIUS,
      x: source.x,
      y: source.y,
      vx: direction.x * NODE_SPEED,
      vy: direction.y * NODE_SPEED,
      update({ entity, game }, dt) {
        const step = Math.max(0, dt);
        const arena = resolveArenaGeometry(game);
        const motion = arena.advanceMotion(entity, step, { maxBounces: 0 });
        const hit = motion.segments.length && motion.segments[motion.segments.length - 1].hit;
        if (hit) {
          if (arena.shape !== "circle" && hit.normalX && hit.normalY) { motion.vx *= -1; motion.vy *= -1; }
          else {
            const dot = motion.vx * hit.normalX + motion.vy * hit.normalY;
            motion.vx -= 2 * dot * hit.normalX; motion.vy -= 2 * dot * hit.normalY;
          }
        }
        Object.assign(entity, { x: motion.x, y: motion.y, vx: motion.vx, vy: motion.vy });
      },
      draw({ entity, game }, context) {
        drawBeam(entity, game.arena || game.arenaSize, palette, context);
      }
    };
  }

  function drawFocus(entity, time, context) {
    if (entity.focusVisible === false) return;
    const baseAlpha = Number.isFinite(context.globalAlpha) ? context.globalAlpha : 1;
    const pulse = 0.85 + 0.15 * Math.sin(time * 16);
    context.save();
    context.globalCompositeOperation = "lighter";
    context.fillStyle = "#ff2a12";
    context.globalAlpha = baseAlpha * 0.42 * pulse;
    context.beginPath();
    context.arc(entity.x, entity.y, FOCUS_RADIUS, 0, TAU);
    context.fill();
    context.fillStyle = "#ff5a20";
    context.globalAlpha = baseAlpha * 0.9 * pulse;
    context.beginPath();
    context.arc(entity.x, entity.y, FOCUS_RADIUS * 0.52, 0, TAU);
    context.fill();
    context.fillStyle = "#ffe6cc";
    context.globalAlpha = baseAlpha;
    context.beginPath();
    context.arc(entity.x, entity.y, FOCUS_RADIUS * 0.24, 0, TAU);
    context.fill();
    context.restore();
  }

  // 交点焦点：位置永远是某一对「橙色竖线」与「蓝色横线」的相交点。
  function createCuttingV2Focus(blueNode, orangeNode) {
    const timers = new Map();
    return {
      kind: "cutting-v2-focus",
      combatKind: "zone",
      life: PERMANENT_LIFE,
      lifecycle: "independent",
      indestructible: true,
      drawLayer: "foreground",
      radius: FOCUS_RADIUS,
      x: orangeNode.x,
      y: blueNode.y,
      smokeTimer: 0,
      update({ entity, services, game }, dt) {
        entity.x = orangeNode.x;
        entity.y = blueNode.y;
        entity.focusVisible = resolveArenaGeometry(game).contains(entity.x, entity.y);
        if (!entity.focusVisible) { timers.clear(); return; }
        const step = Math.max(0, dt);
        const activeKeys = new Set();
        services.forEachEnemy((enemy) => {
          if (!services.getContactProfile(enemy).attackable) return;
          const previousX = Number.isFinite(enemy.prevX) ? enemy.prevX : enemy.x;
          const previousY = Number.isFinite(enemy.prevY) ? enemy.prevY : enemy.y;
          const contact = firstSegmentCircleContact(
            previousX,
            previousY,
            enemy.x,
            enemy.y,
            entity.x,
            entity.y,
            enemy.radius + FOCUS_RADIUS
          );
          if (contact === null) return;
          const key = enemy.instanceId || enemy.id;
          activeKeys.add(key);
          let timer = timers.get(key);
          if (timer === undefined) {
            // 接触到焦点的一瞬间先结算一次，此后每 0.2 秒再扣一次。
            timer = 0;
            services.dealDamage(enemy, FOCUS_DAMAGE);
          }
          timer += step;
          while (timer + EPSILON >= FOCUS_DAMAGE_INTERVAL && enemy.hp > 0) {
            timer -= FOCUS_DAMAGE_INTERVAL;
            services.dealDamage(enemy, FOCUS_DAMAGE);
          }
          timers.set(key, timer);
        });
        for (const key of timers.keys()) {
          if (!activeKeys.has(key)) timers.delete(key);
        }
        if (activeKeys.size === 0) {
          entity.smokeTimer = 0;
          return;
        }
        // 有敌人正在被焦点切割：白灰烟从灼烧点持续冒出来。
        entity.smokeTimer += step;
        while (entity.smokeTimer + EPSILON >= SMOKE_INTERVAL) {
          entity.smokeTimer -= SMOKE_INTERVAL;
          services.spawnParticleBurst({
            kind: "cutting-v2-smoke",
            x: entity.x,
            y: entity.y,
            count: 3,
            minDiameter: 2,
            maxDiameter: 5,
            minSpeed: 6,
            maxSpeed: 28,
            life: 0.55,
            drag: 1.6,
            gravityY: -10,
            initialRadius: FOCUS_RADIUS,
            colors: SMOKE_COLORS
          });
        }
      },
      draw({ entity, game }, context) {
        drawFocus(entity, game.time, context);
      }
    };
  }

  const cuttingBallV2Definition = {
    id: "cuttingBallV2",
    name: "切割球V2",
    englishName: "Cutting Ball V2",
    color: "#c8a4ff",
    description: "开局放出四颗永久隐身坐标球（蓝横/橙竖各2） / 四个交点每0.2秒-2",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 8,
    createBehavior(services) {
      let launched = false;
      let nodes = [];
      let focuses = [];

      function launch(context) {
        if (launched) return;
        launched = true;
        const ball = context.ball;
        const blueNodes = [];
        const orangeNodes = [];
        // 每颗坐标轴球开局独立随机选一个方向。
        for (let index = 0; index < NODES_PER_AXIS; index += 1) {
          blueNodes.push(services.spawnCombatEntity(
            createCuttingV2Node(ball, "x", randomDirection())
          ));
        }
        for (let index = 0; index < NODES_PER_AXIS; index += 1) {
          orangeNodes.push(services.spawnCombatEntity(
            createCuttingV2Node(ball, "y", randomDirection())
          ));
        }
        nodes = blueNodes.concat(orangeNodes);
        // 每一条蓝横线 × 每一条橙竖线 = 4 个交点焦点。
        focuses = [];
        blueNodes.forEach((blueNode) => {
          orangeNodes.forEach((orangeNode) => {
            focuses.push(services.spawnCombatEntity(
              createCuttingV2Focus(blueNode, orangeNode)
            ));
          });
        });
      }

      function despawn() {
        focuses.forEach((focus) => {
          if (focus && focus.entityActive !== false) focus.entityActive = false;
        });
        nodes.forEach((node) => {
          if (node && node.entityActive !== false) node.entityActive = false;
        });
        nodes = [];
        focuses = [];
        launched = false;
      }

      return {
        // 放在 beforeUpdateStep：开局第一帧就释放，莉音借用时同样会走到这里。
        beforeUpdateStep(context) {
          launch(context);
        },
        onBorrowEnd() {
          despawn();
        },
        getCuttingV2State() {
          return {
            nodes: nodes.filter((node) => node.entityActive !== false),
            focuses: focuses.filter((focus) => focus.entityActive !== false)
          };
        }
      };
    }
  };

  registerBall(cuttingBallV2Definition);
  return {
    cuttingBallV2Definition,
    createCuttingV2Node,
    createCuttingV2Focus,
    cuttingV2Rules: Object.freeze({
      nodeRadius: NODE_RADIUS,
      nodeSpeed: NODE_SPEED,
      nodesPerAxis: NODES_PER_AXIS,
      focusCount: NODES_PER_AXIS * NODES_PER_AXIS,
      beamWidth: BEAM_WIDTH,
      beamGlowWidth: BEAM_GLOW_WIDTH,
      beamCoreAlpha: BEAM_CORE_ALPHA,
      beamGlowAlpha: BEAM_GLOW_ALPHA,
      focusRadius: FOCUS_RADIUS,
      focusDamage: FOCUS_DAMAGE,
      focusDamageInterval: FOCUS_DAMAGE_INTERVAL,
      smokeInterval: SMOKE_INTERVAL
    })
  };
});
