(function initializeVolcano(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVolcanoPlugin({ resolveArenaGeometry, registerBall }) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // 参数取自参考视频逐帧测量（陷阱师对决火山）：
  // - 停球：约 0.42 秒内从满速线性减到 0，然后完全静止；裂缝消失后再用同样长
  //   的时间逐渐加速回满速。这两段斜坡都不算进技能的持续 / 冷却。
  // - 技能节奏：开场冷却 2 秒，之后「裂缝 4 秒 → 冷却 4 秒」循环。
  // - 裂缝：停住约 0.26 秒后由内向外炸开，前锋沿折线以约 420 单位/秒推进。
  // - 岩浆球：本体附近平均半径约 1.8（直径 3.6，不足 4），越往外平均体型越小，
  //   末端只剩三成；球与球之间的距离同步变大，所以近端糊成一条亮带，远端散成点。
  const OPENING_COOLDOWN = 2;
  const COOLDOWN = 4;
  const SKILL_DURATION = 4;
  const BRAKE_TIME = 0.42;
  const HOLD_TIME = 0.26;
  const RAMP_UP_TIME = 0.42;
  // 两次 update 之间正常最多只差一个引擎子步（1/60）；超过这个间隔说明行为被
  // 暂停或封印过，多出来的时间要从技能流程里扣掉。
  const NOMINAL_STEP = 1 / 60;
  const MAX_ADVANCE_GAP = 0.05;
  // SpeedModifierSystem 只接受正倍率，这里用一个足够小的值代替「完全停住」，
  // 真正钉死位移的是 setMovementLocked。
  const STOPPED_SPEED_MULTIPLIER = 1e-4;

  const CRACK_GROW_SPEED = 420;
  const MAGMA_FADE = 0.35;
  // 单颗岩浆球的寿命由技能总时长倒推：最后一颗正好在 4 秒整熄灭。
  const MIN_MAGMA_LIFE = 1;
  // 单颗岩浆球的半径上限：直径 3.96，满足「不足 4」的要求。
  const MAGMA_RADIUS = 1.98;
  const MAGMA_TIP_SCALE = 0.3;
  // 抖动只往下取，所以最大一颗就是 MAGMA_RADIUS（1.98 * 2 = 3.96）。
  const MAGMA_SIZE_JITTER = 0.1;
  const MAGMA_START_GAP = 2;
  // 体型变化参考的射程：到这个距离时平均体型只剩 MAGMA_TIP_SCALE。
  const MAGMA_SIZE_REACH = 150;

  const SPACING_NEAR = 0.9;
  const SPACING_FAR = 2.2;
  const WRIGGLE_NEAR = 0.18;
  const WRIGGLE_FAR = 0.46;
  // 根部额外向两侧铺开的半宽：裂缝近端因此比单串珠子厚一倍左右。
  const LATERAL_NEAR = 2;

  const BRANCH_MIN = 6;
  const BRANCH_MAX = 8;
  const SECTOR_JITTER = 0.92;
  const BRANCH_MIN_LENGTH = 70;
  const BRANCH_MAX_LENGTH = 230;
  // 折线节奏：靠近本体拐得又急又密（岩浆球互相压叠成一条厚带），越往外越平缓
  // （只剩一条细的串珠线）。参考视频里近端明显更"糊"，远端更"点"。
  const SEGMENT_NEAR = 3;
  const SEGMENT_FAR = 9;
  const KINK_NEAR = 0.9;
  const KINK_FAR = 0.4;
  const PULLBACK = 0.3;
  const PATH_STEP = 0.25;

  const HIT_NODE_SPACING = 1.8;
  const CRACK_DAMAGE = 3;
  const CRACK_HIT_COOLDOWN = 0.45;

  // 踩着裂缝：减速到原速度的 20%。贴着裂缝时不断续期，离开后很快自然到期。
  const SLOW_ID = "volcano-crack-slow";
  const SLOW_DURATION = 0.2;
  const SLOW_FACTOR = 0.2;
  // 离开裂缝：挂上灼烧，每秒 -2，持续 2 秒（4 跳 × 1 点）。
  const BURN_ID = "volcano-crack-burn";
  const BURN_DURATION = 2;
  const BURN_TICK_INTERVAL = 0.5;
  const BURN_TICKS = Math.round(BURN_DURATION / BURN_TICK_INTERVAL);
  const BURN_DAMAGE_PER_TICK = 1;

  const ALPHA_BUCKETS = 12;
  const MAGMA_TONES = Object.freeze(["#ff7a14", "#ffa42a", "#ffd06a"]);
  const MAGMA_GLOW = "#ff5c10";
  const GLOW_SCALE = 2.4;
  const GLOW_ALPHA = 0.3;

  function createRandom(seed) {
    let state = seed >>> 0;
    return function random() {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 踩在裂缝上的减速：单纯的 speedFactor，由 SpeedModifierSystem 统一合成，
  // 贴着裂缝时不断被续期，离开后最迟 0.2 秒自然到期。
  function createVolcanoSlow() {
    return {
      id: SLOW_ID,
      duration: SLOW_DURATION,
      speedFactor: SLOW_FACTOR
    };
  }

  // 离开裂缝后的灼烧：每秒 -2 点，持续 2 秒（0.5 秒一跳、每跳 1 点，共 4 点）。
  // 走效果自己的 dot 通道，裂缝本体已经消失也照样烧完。
  function createVolcanoBurn() {
    return {
      id: BURN_ID,
      combatKind: "dot",
      duration: BURN_DURATION,
      attackTags: ["heat"],
      onApply({ effect, game }) {
        // 每次被重新点上火都从满额开始，所以"离开的那一刻"起整整烧 2 秒。
        effect.remainingTicks = BURN_TICKS;
        effect.nextTick = game.time + BURN_TICK_INTERVAL;
      },
      update({ ball, effect, game, services: bound }) {
        while (effect.remainingTicks > 0 && game.time + EPSILON >= effect.nextTick) {
          bound.dealDamage(ball, BURN_DAMAGE_PER_TICK);
          effect.remainingTicks -= 1;
          effect.nextTick += BURN_TICK_INTERVAL;
        }
      },
      // 渲染器只调用效果上的 draw / drawBefore，所以灼烧的视觉写在这里。
      // 外圈热晕 + 贴着球面的亮环，再甩几颗往上飘的小岩浆点。
      draw({ ball, game }, context) {
        const baseAlpha = context.globalAlpha;
        const flicker = 0.72 + 0.28 * Math.sin(game.time * 17 + ball.x * 0.7);
        const ring = ball.radius + 2;
        context.save();
        context.globalCompositeOperation = "lighter";
        // 宽而淡的热晕打底，紧贴球面的一条亮环才是"火"本身。
        context.globalAlpha = baseAlpha * 0.22 * flicker;
        context.strokeStyle = "#ff5c10";
        context.lineWidth = 7;
        context.beginPath();
        context.arc(ball.x, ball.y, ring, 0, TAU);
        context.stroke();
        context.globalAlpha = baseAlpha * flicker;
        context.strokeStyle = "#ffae2e";
        context.lineWidth = 3.2;
        context.beginPath();
        context.arc(ball.x, ball.y, ring, 0, TAU);
        context.stroke();
        for (let index = 0; index < 6; index += 1) {
          const cycle = 0.5 + (index % 3) * 0.16;
          const t = ((game.time + index * 0.21) % cycle) / cycle;
          const angle = index * (TAU / 6) + game.time * 1.5;
          const distance = ball.radius + 2 + t * 7;
          context.globalAlpha = baseAlpha * flicker * (1 - t);
          context.fillStyle = index % 2 ? "#ffd76a" : "#ff8a1e";
          context.beginPath();
          context.arc(
            ball.x + Math.cos(angle) * distance,
            ball.y + Math.sin(angle) * distance,
            1.6 * (1 - t * 0.4), 0, TAU
          );
          context.fill();
        }
        context.restore();
      }
    };
  }

  // 一条裂缝折线：从本体边缘出发，按固定小步长前进，每隔几单位随机拐一次弯，
  // 同时被主轴轻轻往回拉，避免整条分支卷成一团。沿途按"距离越远、间距越大"
  // 撒下岩浆球，并按固定间距留下判定用的节点。
  function buildCrack(random, originX, originY, arenaSize, startRadius, duration) {
    const branches = BRANCH_MIN + Math.floor(random() * (BRANCH_MAX - BRANCH_MIN + 1));
    const sector = TAU / branches;
    const rotation = random() * TAU;
    const magmas = [];
    const nodes = [];

    function emitMagma(px, py, spawnAt, wriggle) {
      if (!resolveArenaGeometry(arenaSize).contains(px, py)) return;
      // 体型只看这颗球自己离本体多远，所以横向铺开的那两颗也自动更小。
      const ownReach = clamp(
        Math.hypot(px - originX, py - originY) / MAGMA_SIZE_REACH, 0, 1
      );
      const sizeRoll = 1 - random() * MAGMA_SIZE_JITTER;
      const toneRoll = random() - ownReach * 0.18;
      const radius = MAGMA_RADIUS * (1 - (1 - MAGMA_TIP_SCALE) * ownReach) * sizeRoll;
      magmas.push({
        x: px, y: py, cx: px, cy: py,
        radius,
        cr: radius,
        tone: toneRoll > 0.62 ? 2 : (toneRoll > 0.22 ? 1 : 0),
        spawnAt,
        dieAt: 0,
        alpha: 1,
        wx: 2.1 + random() * 2.6,
        wy: 2.1 + random() * 2.6,
        px: random() * TAU,
        py: random() * TAU,
        ax: wriggle * (0.7 + random() * 0.6),
        ay: wriggle * (0.7 + random() * 0.6),
        wr: 1.4 + random() * 1.6,
        pr: random() * TAU
      });
    }

    for (let branch = 0; branch < branches; branch += 1) {
      const baseAngle = rotation + sector * branch +
        (random() - 0.5) * sector * SECTOR_JITTER;
      const pathLength = BRANCH_MIN_LENGTH +
        random() * (BRANCH_MAX_LENGTH - BRANCH_MIN_LENGTH);
      let direction = baseAngle;
      let x = originX + Math.cos(baseAngle) * startRadius;
      let y = originY + Math.sin(baseAngle) * startRadius;
      let travelled = 0;
      let sinceMagma = SPACING_NEAR;
      let sinceNode = HIT_NODE_SPACING;
      let nextKinkAt = 0;

      while (travelled < pathLength) {
        // 折线进度：既决定拐弯的疏密，也决定每颗岩浆球的间距。
        const t = clamp(travelled / pathLength, 0, 1);
        if (travelled + EPSILON >= nextKinkAt) {
          nextKinkAt += SEGMENT_NEAR + (SEGMENT_FAR - SEGMENT_NEAR) * t;
          let aligned = direction - baseAngle;
          aligned = Math.atan2(Math.sin(aligned), Math.cos(aligned));
          direction = baseAngle + aligned * (1 - PULLBACK) +
            (random() - 0.5) * (KINK_NEAR + (KINK_FAR - KINK_NEAR) * t);
        }
        const step = Math.min(PATH_STEP, pathLength - travelled);
        x += Math.cos(direction) * step;
        y += Math.sin(direction) * step;
        travelled += step;
        sinceMagma += step;
        sinceNode += step;

        if (!resolveArenaGeometry(arenaSize).contains(x, y)) break;

        // 体型按"离本体的距离"收，不按走了多远的折线：要求是越远平均越小。
        const reach = clamp(
          Math.hypot(x - originX, y - originY) / MAGMA_SIZE_REACH, 0, 1
        );
        const spawnAt = travelled / CRACK_GROW_SPEED;
        const wriggle = WRIGGLE_NEAR + (WRIGGLE_FAR - WRIGGLE_NEAR) * t;

        if (sinceNode + EPSILON >= HIT_NODE_SPACING) {
          sinceNode = 0;
          nodes.push({
            x, y, cx: x, cy: y,
            radius: MAGMA_RADIUS * (1 - (1 - MAGMA_TIP_SCALE) * reach) + HIT_NODE_SPACING * 0.5,
            spawnAt,
            dieAt: 0,
            wx: 2.1 + random() * 2.6,
            wy: 2.1 + random() * 2.6,
            px: random() * TAU,
            py: random() * TAU,
            ax: wriggle * 0.5,
            ay: wriggle * 0.5
          });
        }

        const spacing = SPACING_NEAR + (SPACING_FAR - SPACING_NEAR) * t;
        if (sinceMagma + EPSILON < spacing) continue;
        sinceMagma = 0;

        emitMagma(x, y, spawnAt, wriggle);
        // 近端再往两侧各撒一颗，让裂缝根部鼓成一条厚带；越往外铺得越窄，
        // 末端只剩中轴那一串——单颗岩浆球的直径始终不足 4。
        const lateral = LATERAL_NEAR * (1 - t) * (1 - reach);
        if (lateral <= 0.2) continue;
        const flankCount = random() < 0.55 ? 2 : 1;
        for (let flank = 0; flank < flankCount; flank += 1) {
          const side = flank === 0 ? 1 : -1;
          const offset = lateral * (0.35 + random() * 0.65) * side;
          emitMagma(
            x - Math.sin(direction) * offset,
            y + Math.cos(direction) * offset,
            spawnAt, wriggle
          );
        }
      }
    }

    magmas.sort((left, right) => left.spawnAt - right.spawnAt);
    nodes.sort((left, right) => left.spawnAt - right.spawnAt);
    // 每颗岩浆球的寿命 = 技能总时长 − 它自己的出生时刻，所以整条裂缝正好在
    // 4 秒整燃尽；晚出生的那几颗活得更短，符合"由内到外一层层熄掉"。
    const lastSpawnAt = Math.max(
      magmas.length ? magmas[magmas.length - 1].spawnAt : 0,
      nodes.length ? nodes[nodes.length - 1].spawnAt : 0
    );
    const life = Math.max(MIN_MAGMA_LIFE, duration - lastSpawnAt);
    for (const magma of magmas) magma.dieAt = magma.spawnAt + life;
    for (const node of nodes) node.dieAt = node.spawnAt + life;
    return { magmas, nodes, duration };
  }

  // 一条裂缝就是一个 zone 实体：自己推进生长、自己判定接触、自己消失。
  // 视觉与判定分开维护——判定节点走在折线中轴上，岩浆球在它周围蠕动。
  function createVolcanoCrack(originX, originY, options = {}) {
    const arenaSize = options.arena || options.arenaSize || 200;
    const startRadius = Number.isFinite(options.startRadius) ? options.startRadius : 17;
    const seed = Number.isFinite(options.seed)
      ? options.seed >>> 0
      : (Math.random() * 0x100000000) >>> 0;
    const duration = Number.isFinite(options.duration) && options.duration > 0
      ? options.duration
      : SKILL_DURATION;
    const { magmas, nodes } = buildCrack(
      createRandom(seed), originX, originY, arenaSize, startRadius, duration
    );
    const buckets = [];
    for (let index = 0; index < ALPHA_BUCKETS * MAGMA_TONES.length; index += 1) {
      buckets.push([]);
    }
    // instanceId → { target, nextHitAt }：记下"此刻还踩着裂缝"的敌人，用来
    // 在它离开的那一刻补上灼烧。
    const contacts = new Map();
    const present = new Set();

    return {
      kind: "volcano-crack",
      combatKind: "zone",
      attackTags: ["heat", "area"],
      drawLayer: "foreground",
      // 实体寿命就是技能时长：最后一颗岩浆球熄灭的同一刻整条裂缝退场，
      // 不会留下一段"看不见但还存在"的尾巴。
      life: duration,
      duration,
      x: originX,
      y: originY,
      magmas,
      nodes,
      buckets,
      visibleMagmas: 0,
      firstAliveMagma: 0,
      visibleNodes: 0,
      firstAliveNode: 0,

      update({ entity, game, services }) {
        if (entity.entityActive === false) return;
        const age = entity.age;
        const magmasList = entity.magmas;
        let visible = entity.visibleMagmas;
        while (visible < magmasList.length && magmasList[visible].spawnAt <= age) {
          visible += 1;
        }
        entity.visibleMagmas = visible;
        let firstAlive = entity.firstAliveMagma;
        while (firstAlive < visible && magmasList[firstAlive].dieAt <= age) firstAlive += 1;
        entity.firstAliveMagma = firstAlive;

        for (let index = firstAlive; index < visible; index += 1) {
          const magma = magmasList[index];
          const remaining = magma.dieAt - age;
          const alpha = remaining >= MAGMA_FADE
            ? 1
            : clamp(remaining / MAGMA_FADE, 0, 1);
          magma.alpha = alpha;
          // 蠕动：每颗球在自己的小范围里绕着出生点晃，不是整条裂缝一起平移。
          magma.cx = magma.x + Math.sin(age * magma.wx + magma.px) * magma.ax;
          magma.cy = magma.y + Math.cos(age * magma.wy + magma.py) * magma.ay;
          magma.cr = magma.radius * (1 + 0.1 * Math.sin(age * magma.wr + magma.pr)) *
            (0.4 + 0.6 * alpha);
        }

        const nodeList = entity.nodes;
        let visibleNodes = entity.visibleNodes;
        while (visibleNodes < nodeList.length && nodeList[visibleNodes].spawnAt <= age) {
          visibleNodes += 1;
        }
        entity.visibleNodes = visibleNodes;
        let firstNode = entity.firstAliveNode;
        while (firstNode < visibleNodes && nodeList[firstNode].dieAt <= age) firstNode += 1;
        entity.firstAliveNode = firstNode;

        if (visibleNodes <= firstNode) {
          // 裂缝在脚下烧完了：这一批还踩在上面的敌人也算「离开」，一样点火。
          for (const contact of contacts.values()) {
            services.applyEffect(contact.target, createVolcanoBurn());
          }
          contacts.clear();
          return;
        }
        const now = game.time;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let index = firstNode; index < visibleNodes; index += 1) {
          const node = nodeList[index];
          node.cx = node.x + Math.sin(age * node.wx + node.px) * node.ax;
          node.cy = node.y + Math.cos(age * node.wy + node.py) * node.ay;
          const reach = node.radius;
          if (node.cx - reach < minX) minX = node.cx - reach;
          if (node.cx + reach > maxX) maxX = node.cx + reach;
          if (node.cy - reach < minY) minY = node.cy - reach;
          if (node.cy + reach > maxY) maxY = node.cy + reach;
        }
        present.clear();
        services.forEachEnemy((target) => {
          if (!services.getContactProfile(target).attackable) return;
          // 先用整条裂缝的外接框粗略排除，再做逐节点判定。
          if (target.x + target.radius < minX || target.x - target.radius > maxX) return;
          if (target.y + target.radius < minY || target.y - target.radius > maxY) return;
          let touching = false;
          for (let index = firstNode; index < visibleNodes; index += 1) {
            const node = nodeList[index];
            const reach = node.radius + target.radius;
            const dx = target.x - node.cx;
            const dy = target.y - node.cy;
            if (dx * dx + dy * dy <= reach * reach) {
              touching = true;
              break;
            }
          }
          if (!touching) return;
          present.add(target.instanceId);
          const effects = target.effects instanceof Map ? target.effects : null;
          // 重新踩进裂缝就把身上的灼烧清掉：裂缝里不吃持续灼烧伤害，
          // 下一轮要等它再次离开裂缝时才重新点火。
          if (effects && effects.has(BURN_ID)) services.clearEffect(target, BURN_ID);
          // 踩在裂缝上：减速到原速度的 20%，贴着的时候不断续期。
          const slow = effects ? effects.get(SLOW_ID) : null;
          if (!slow || slow.expiresAt - now < SLOW_DURATION * 0.5) {
            services.applyEffect(target, createVolcanoSlow());
          }
          let contact = contacts.get(target.instanceId);
          if (!contact) {
            // 第一次压上裂缝立刻结算，之后每 0.45 秒一跳。
            contact = { target, nextHitAt: now };
            contacts.set(target.instanceId, contact);
          }
          contact.target = target;
          if (now + EPSILON < contact.nextHitAt) return;
          services.dealDamage(target, CRACK_DAMAGE);
          contact.nextHitAt = now + CRACK_HIT_COOLDOWN;
        });
        for (const [instanceId, contact] of contacts) {
          if (present.has(instanceId)) continue;
          contacts.delete(instanceId);
          // 离开裂缝：重新点一次火。每次离开都是满满 2 秒，
          // 中途钻进别的裂缝会被清掉、下次出来再重新计时。
          services.applyEffect(contact.target, createVolcanoBurn());
        }
      },

      draw({ entity }, context) {
        const first = entity.firstAliveMagma;
        const last = entity.visibleMagmas;
        if (last <= first) return;
        const buckets = entity.buckets;
        for (let index = 0; index < buckets.length; index += 1) buckets[index].length = 0;
        const magmasList = entity.magmas;
        for (let index = first; index < last; index += 1) {
          const magma = magmasList[index];
          const bucket = Math.min(
            ALPHA_BUCKETS - 1,
            Math.floor(magma.alpha * ALPHA_BUCKETS)
          );
          buckets[bucket * MAGMA_TONES.length + magma.tone].push(magma);
        }
        context.save();
        context.globalCompositeOperation = "lighter";
        context.fillStyle = MAGMA_GLOW;
        for (let bucket = 0; bucket < ALPHA_BUCKETS; bucket += 1) {
          const alpha = ((bucket + 1) / ALPHA_BUCKETS) * GLOW_ALPHA;
          let drawn = false;
          context.beginPath();
          for (let tone = 0; tone < MAGMA_TONES.length; tone += 1) {
            const group = buckets[bucket * MAGMA_TONES.length + tone];
            for (let index = 0; index < group.length; index += 1) {
              const magma = group[index];
              const radius = magma.cr * GLOW_SCALE;
              context.moveTo(magma.cx + radius, magma.cy);
              context.arc(magma.cx, magma.cy, radius, 0, TAU);
              drawn = true;
            }
          }
          if (!drawn) continue;
          context.globalAlpha = alpha;
          context.fill();
        }
        context.globalCompositeOperation = "source-over";
        for (let bucket = 0; bucket < ALPHA_BUCKETS; bucket += 1) {
          const alpha = (bucket + 1) / ALPHA_BUCKETS;
          for (let tone = 0; tone < MAGMA_TONES.length; tone += 1) {
            const group = buckets[bucket * MAGMA_TONES.length + tone];
            if (group.length === 0) continue;
            context.globalAlpha = alpha;
            context.fillStyle = MAGMA_TONES[tone];
            context.beginPath();
            for (let index = 0; index < group.length; index += 1) {
              const magma = group[index];
              context.moveTo(magma.cx + magma.cr, magma.cy);
              context.arc(magma.cx, magma.cy, magma.cr, 0, TAU);
            }
            context.fill();
          }
        }
        context.restore();
      }
    };
  }

  // 状态机：moving(冷却) → braking → holding → erupting → ramping(逐渐加速) → moving。
  // 两段速度斜坡都不算进技能的 4 秒持续 / 4 秒冷却，开场冷却单独设为 2 秒。
  function createVolcanoBehavior(services) {
    let phase = "moving";
    let ready = false;
    let attackAt = 0;
    const attackNow = (context) => typeof services.getAttackTime === "function"
      ? services.getAttackTime() : context.game.time;
    let brakeEndsAt = 0;
    let holdEndsAt = 0;
    let eruptEndsAt = 0;
    let rampEndsAt = 0;
    // 最后一次真正推进状态机的时刻。被眩晕 / 定身 / 行为封印而漏掉的这段时间
    // 不算进攻击流程：恢复时把截止时刻整体后移，攻击中「必须停住」的状态不会
    // 因为一段控制时间被偷偷走完。
    let lastAdvanceAt = null;
    // 停住前的朝向，收招时用它重建速度，不会被别的控制效果改写过的 storedV 带偏。
    let headingX = null;
    let headingY = null;

    function rememberHeading(ball) {
      const magnitude = Math.hypot(ball.storedVx, ball.storedVy);
      if (magnitude > 1e-6) {
        headingX = ball.storedVx / magnitude;
        headingY = ball.storedVy / magnitude;
        return;
      }
      if (Number.isFinite(ball.speedHeadingX) && Number.isFinite(ball.speedHeadingY)) {
        headingX = ball.speedHeadingX;
        headingY = ball.speedHeadingY;
      }
    }

    function startHolding(ball, now) {
      phase = "holding";
      holdEndsAt = now + HOLD_TIME;
      rememberHeading(ball);
      services.setSpeedMultiplier(STOPPED_SPEED_MULTIPLIER);
      services.setMovementLocked(true);
    }

    function startRamping(ball, now) {
      // 眩晕类控制会在解除时把自己的速度写回 storedV；先按停住前的朝向重建，
      // 再松开移动锁，免得收招后莫名其妙走成一条直线。
      if (Number.isFinite(headingX) && Number.isFinite(headingY) &&
          Math.hypot(headingX, headingY) > 0.5) {
        ball.storedVx = headingX * ball.speed;
        ball.storedVy = headingY * ball.speed;
      }
      services.setMovementLocked(false);
      phase = "ramping";
      rampEndsAt = now + RAMP_UP_TIME;
    }

    function finishRamping(now) {
      services.setSpeedMultiplier(1);
      phase = "moving";
      attackAt = now + COOLDOWN;
    }

    function advance(context) {
      const now = context.game.time;
      if (lastAdvanceAt !== null) {
        const gap = now - lastAdvanceAt;
        if (gap > MAX_ADVANCE_GAP) {
          // 间隔超过一个正常子步，说明中间被停过：只有那一步照常算进流程，
          // 剩下的时间原样还给技能。
          const carry = gap - NOMINAL_STEP;
          brakeEndsAt += carry;
          holdEndsAt += carry;
          eruptEndsAt += carry;
          rampEndsAt += carry;
        }
      }
      lastAdvanceAt = now;
      if (!ready) {
        ready = true;
        attackAt = attackNow(context) + OPENING_COOLDOWN;
      }
      if (phase === "moving") {
        if (attackNow(context) + EPSILON < attackAt) return;
        phase = "braking";
        brakeEndsAt = now + BRAKE_TIME;
      }
      if (phase === "braking") {
        const remaining = Math.max(0, brakeEndsAt - now);
        const progress = 1 - remaining / BRAKE_TIME;
        services.setSpeedMultiplier(
          Math.max(STOPPED_SPEED_MULTIPLIER, 1 - progress)
        );
        if (remaining > EPSILON) return;
        startHolding(context.ball, now);
      }
      if (phase === "holding") {
        // 普通模式的积分器只认 vx，移动锁本身并不会拦住位移。眩晕类控制解除时
        // 会把自己的速度写回 vx，所以攻击中每帧都要重新断言「我是停住的」。
        services.setMovementLocked(true);
        if (now + EPSILON < holdEndsAt) return;
        const ball = context.ball;
        const crack = createVolcanoCrack(ball.x, ball.y, {
          arenaSize: context.game.arena || context.game.arenaSize,
          startRadius: ball.radius + MAGMA_START_GAP,
          duration: SKILL_DURATION
        });
        services.spawnCombatEntity(crack);
        services.playSound("shoot");
        eruptEndsAt = now + crack.duration;
        phase = "erupting";
      }
      if (phase === "erupting") {
        services.setMovementLocked(true);
        if (now + EPSILON < eruptEndsAt) return;
        startRamping(context.ball, now);
      }
      if (phase === "ramping") {
        const remaining = Math.max(0, rampEndsAt - now);
        const progress = 1 - remaining / RAMP_UP_TIME;
        services.setSpeedMultiplier(clamp(progress, STOPPED_SPEED_MULTIPLIER, 1));
        if (remaining > EPSILON) return;
        finishRamping(attackNow(context));
      }
    }

    function nextBoundary(context) {
      if (!ready) return OPENING_COOLDOWN;
      const now = context.game.time;
      if (phase === "moving") return Math.max(EPSILON, attackAt - attackNow(context));
      const scale = typeof services.getAttackPeriodScale === "function"
        ? services.getAttackPeriodScale() : 1;
      if (phase === "braking") return Math.max(EPSILON, brakeEndsAt - now) / scale;
      if (phase === "holding") return Math.max(EPSILON, holdEndsAt - now) / scale;
      if (phase === "ramping") return Math.max(EPSILON, rampEndsAt - now) / scale;
      return Math.max(EPSILON, eruptEndsAt - now) / scale;
    }

    return {
      // 本体不需要自定义绘制：默认的纯色圆就是参考视频里的样子。
      update(context) {
        advance(context);
      },
      // 刻意不实现 updateWhilePaused / getNextPausedTransitionIn：被眩晕、
      // 定身或封印期间攻击流程整个冻结（见 advance 里的时间补偿），
      // 这样"攻击中必须停住"不会因为一段控制时间被走完。
      getNextTransitionIn(context) {
        return nextBoundary(context);
      },
      onBorrowEnd(context) {
        services.setMovementLocked(false);
        services.setSpeedMultiplier(1);
        phase = "moving";
        attackAt = attackNow(context) + COOLDOWN;
      }
    };
  }

  const volcanoDefinition = {
    id: "volcano",
    name: "火山",
    englishName: "Volcano",
    color: "#f77b16",
    description: "开场2秒后停0.4秒裂开岩浆缝，持续4秒、冷却4秒 / 裂缝上-3每0.45秒并减速到20% / 离开后灼烧每秒-2共2秒，再踩回裂缝即清火 / 岩浆球直径<4越远越小",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: OPENING_COOLDOWN + BRAKE_TIME + HOLD_TIME +
      SKILL_DURATION + RAMP_UP_TIME,
    createBehavior: createVolcanoBehavior
  };

  registerBall(volcanoDefinition);
  return {
    volcanoDefinition,
    createVolcanoBehavior,
    createVolcanoCrack,
    createVolcanoRandom: createRandom,
    createVolcanoSlow,
    createVolcanoBurn,
    VOLCANO_OPENING_COOLDOWN: OPENING_COOLDOWN,
    VOLCANO_COOLDOWN: COOLDOWN,
    VOLCANO_SKILL_DURATION: SKILL_DURATION,
    VOLCANO_BRAKE_TIME: BRAKE_TIME,
    VOLCANO_HOLD_TIME: HOLD_TIME,
    VOLCANO_RAMP_UP_TIME: RAMP_UP_TIME,
    VOLCANO_STOPPED_SPEED_MULTIPLIER: STOPPED_SPEED_MULTIPLIER,
    VOLCANO_CRACK_GROW_SPEED: CRACK_GROW_SPEED,
    VOLCANO_MAGMA_FADE: MAGMA_FADE,
    VOLCANO_SLOW_ID: SLOW_ID,
    VOLCANO_SLOW_FACTOR: SLOW_FACTOR,
    VOLCANO_SLOW_DURATION: SLOW_DURATION,
    VOLCANO_BURN_ID: BURN_ID,
    VOLCANO_BURN_DURATION: BURN_DURATION,
    VOLCANO_BURN_TICK_INTERVAL: BURN_TICK_INTERVAL,
    VOLCANO_BURN_TICKS: BURN_TICKS,
    VOLCANO_BURN_DAMAGE_PER_TICK: BURN_DAMAGE_PER_TICK,
    VOLCANO_MAGMA_RADIUS: MAGMA_RADIUS,
    VOLCANO_MAGMA_TIP_SCALE: MAGMA_TIP_SCALE,
    VOLCANO_MAGMA_SIZE_REACH: MAGMA_SIZE_REACH,
    VOLCANO_MAGMA_START_GAP: MAGMA_START_GAP,
    VOLCANO_SPACING_NEAR: SPACING_NEAR,
    VOLCANO_SPACING_FAR: SPACING_FAR,
    VOLCANO_HIT_NODE_SPACING: HIT_NODE_SPACING,
    VOLCANO_DAMAGE: CRACK_DAMAGE,
    VOLCANO_HIT_COOLDOWN: CRACK_HIT_COOLDOWN,
    VOLCANO_MAGMA_TONES: MAGMA_TONES,
    VOLCANO_ALPHA_BUCKETS: ALPHA_BUCKETS
  };
});
