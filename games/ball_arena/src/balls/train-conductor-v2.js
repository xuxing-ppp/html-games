(function initializeTrainConductorV2(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
      {},
      Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")),
      require("./train-weapon.js")
    )
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createTrainConductorV2Plugin({ resolveArenaGeometry, registerBall, createTrainKnockback }) {
  // 列车长v2：本体是游戏默认纯色球（浅粉）。规则按需求固定：
  //   1. 每 3.8 秒往任意方向射出一节车厢（宽 20 × 长 30）；
  //   2. 车厢拥有和「望」的列车一样的击退（复用 light.js 导出的 createTrainKnockback）；
  //   3. 车厢在场内不断反弹、永不消失（life 无限）；
  //   4. 碰撞伤害 3；
  //   5. 车厢头部碰到另一节车厢尾部时挂钩连成一列，后面的车厢按前面那节运动；
  //   6. 每节车厢的主色从调色盘里随机取，五颜六色。
  const FIRE_INTERVAL = 3.8;
  const CAR_LENGTH = 30;
  const CAR_WIDTH = 20;
  const CAR_HALF_LENGTH = CAR_LENGTH / 2;
  const CAR_HALF_WIDTH = CAR_WIDTH / 2;
  const CAR_SPEED = 160;
  const CAR_DAMAGE = 3;
  const MAX_CHAIN = 16;
  const WALL_BOUNCE_GUARD = 8;
  // 仅在刚挂钩、车距未稳定时使用追赶速度。
  const FOLLOW_CATCH_UP_SPEED = 420;
  // 挂钩时的最大朝向差：差太多的不算「车头对车尾」，不硬连。
  const COUPLE_MAX_ANGLE = Math.PI * 0.6;
  const BODY_COLOR = "#f6c8dd";
  const COUPLER_COLOR = "#2a2f36";
  // 车厢主色：五颜六色，每节随机取一个。
  const CAR_COLORS = Object.freeze([
    "#e94f37", "#f0913a", "#f2d24b", "#7cc45a",
    "#3fb8d8", "#4a6fe3", "#9b5cf0", "#e969b4"
  ]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeAngle(angle) {
    let value = angle;
    while (value > Math.PI) value -= TWO_PI;
    while (value < -Math.PI) value += TWO_PI;
    return value;
  }

  // 和渲染器 drawBallOutline 同一条压暗规则：车厢描边和本体同色系。
  function darkenColor(hex) {
    const channels = [1, 3, 5].map((offset) => (
      Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * 0.58)
    ));
    return `rgb(${channels.join(", ")})`;
  }

  function mixWithWhite(hex, amount) {
    const channels = [1, 3, 5].map((offset) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const mixed = channel + (1 - channel) * clamp(amount, 0, 1);
      return Math.round(mixed * 255).toString(16).padStart(2, "0");
    });
    return "#" + channels.join("");
  }

  function carHead(car) {
    return {
      x: car.x + Math.cos(car.heading) * CAR_HALF_LENGTH,
      y: car.y + Math.sin(car.heading) * CAR_HALF_LENGTH
    };
  }

  function carTail(car) {
    return {
      x: car.x - Math.cos(car.heading) * CAR_HALF_LENGTH,
      y: car.y - Math.sin(car.heading) * CAR_HALF_LENGTH
    };
  }

  // 长方形车身在 x / y 轴上的半跨度（车头朝向决定的支撑宽度）。
  function carHalfSpanX(car) {
    return Math.abs(CAR_HALF_LENGTH * Math.cos(car.heading)) +
      Math.abs(CAR_HALF_WIDTH * Math.sin(car.heading));
  }

  function carHalfSpanY(car) {
    return Math.abs(CAR_HALF_LENGTH * Math.sin(car.heading)) +
      Math.abs(CAR_HALF_WIDTH * Math.cos(car.heading));
  }

  function distanceToSegment(px, py, ax, ay, bx, by) {
    const deltaX = bx - ax;
    const deltaY = by - ay;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(((px - ax) * deltaX + (py - ay) * deltaY) / lengthSquared, 0, 1);
    const closestX = ax + deltaX * progress;
    const closestY = ay + deltaY * progress;
    return {
      distance: Math.hypot(px - closestX, py - closestY),
      closestX,
      closestY
    };
  }

  function isLiveCar(car) {
    return car && car.entityActive !== false && !(car.age >= car.life);
  }

  function detachRetiredNeighbors(car) {
    if (car.leader && !isLiveCar(car.leader)) car.leader = null;
    if (car.follower && !isLiveCar(car.follower)) car.follower = null;
  }

  // 路径按车头到车尾排序；同一直线只保存端点，存储量不随战斗时长增长。
  function prependPathPoint(path, x, y) {
    const first = path[0];
    if (Math.hypot(x - first.x, y - first.y) <= EPSILON) return;
    const second = path[1];
    if (second) {
      const ax = x - first.x;
      const ay = y - first.y;
      const bx = first.x - second.x;
      const by = first.y - second.y;
      if (Math.abs(ax * by - ay * bx) < EPSILON && ax * bx + ay * by >= 0) {
        path[0] = { x, y };
        return;
      }
    }
    path.unshift({ x, y });
  }

  function samplePath(path, distance) {
    let remaining = Math.max(0, distance);
    for (let index = 1; index < path.length; index += 1) {
      const a = path[index - 1];
      const b = path[index];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= EPSILON) continue;
      if (remaining <= length || index === path.length - 1) {
        return {
          x: a.x + (b.x - a.x) * remaining / length,
          y: a.y + (b.y - a.y) * remaining / length,
          directionX: (a.x - b.x) / length,
          directionY: (a.y - b.y) / length
        };
      }
      remaining -= length;
    }
    return { x: path[0].x, y: path[0].y, directionX: 1, directionY: 0 };
  }

  function slicePath(path, start, end) {
    const points = [samplePath(path, start)];
    let distance = 0;
    for (let index = 1; index < path.length; index += 1) {
      distance += Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
      if (distance >= end - EPSILON) break;
      if (distance > start + EPSILON) points.push({ x: path[index].x, y: path[index].y });
    }
    points.push(samplePath(path, end));
    return points;
  }

  function getTrainMotion(car) {
    detachRetiredNeighbors(car);
    let head = car;
    while (head.leader) {
      head = head.leader;
      detachRetiredNeighbors(head);
    }
    const cars = [];
    let node = head;
    while (node && cars.length < MAX_CHAIN) {
      detachRetiredNeighbors(node);
      cars.push(node);
      node = node.follower;
    }
    const previous = head.trainMotion;
    if (previous && previous.cars.length === cars.length &&
        cars.every((member, index) => previous.cars[index] === member)) return previous;

    // 挂钩/断链只重建路径归属，不挪动车厢，也不重建战斗来源。
    const path = [{ x: head.x, y: head.y }];
    const offsets = [0];
    for (let index = 1; index < cars.length; index += 1) {
      const front = cars[index - 1];
      const rear = cars[index];
      const old = front.trainMotion;
      const frontIndex = old ? old.cars.indexOf(front) : -1;
      const rearIndex = old ? old.cars.indexOf(rear) : -1;
      const section = frontIndex >= 0 && rearIndex === frontIndex + 1
        ? slicePath(old.path, old.offsets[frontIndex], old.offsets[rearIndex])
        : [{ x: front.x, y: front.y }, { x: rear.x, y: rear.y }];
      let length = 0;
      for (let point = 1; point < section.length; point += 1) {
        length += Math.hypot(section[point].x - section[point - 1].x, section[point].y - section[point - 1].y);
        path.push(section[point]);
      }
      offsets.push(offsets[index - 1] + length);
    }
    const tail = cars[cars.length - 1];
    path.push({
      x: tail.x - Math.cos(tail.heading) * CAR_LENGTH,
      y: tail.y - Math.sin(tail.heading) * CAR_LENGTH
    });
    const motion = { cars, offsets, path };
    for (const member of cars) member.trainMotion = motion;
    return motion;
  }

  function clampCar(car, arena) {
    if (arena.shape !== "circle") return {
      x: clamp(car.x, arena.left + carHalfSpanX(car), arena.right - carHalfSpanX(car)),
      y: clamp(car.y, arena.top + carHalfSpanY(car), arena.bottom - carHalfSpanY(car))
    };
    let x = car.x, y = car.y;
    const c = Math.cos(car.heading), t = Math.sin(car.heading);
    for (let pass = 0; pass < 12; pass++) for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const dx = a * CAR_HALF_LENGTH * c - b * CAR_HALF_WIDTH * t;
      const dy = a * CAR_HALF_LENGTH * t + b * CAR_HALF_WIDTH * c;
      const point = arena.clampPoint(x + dx, y + dy);
      x = point.x - dx; y = point.y - dy;
    }
    return { x, y };
  }

  function carWallHit(car, arena, dx, dy, distance) {
    let best = null;
    const c = Math.cos(car.heading), t = Math.sin(car.heading);
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const x = car.x + a * CAR_HALF_LENGTH * c - b * CAR_HALF_WIDTH * t;
      const y = car.y + a * CAR_HALF_LENGTH * t + b * CAR_HALF_WIDTH * c;
      const hit = arena.traceSegment(x, y, x + dx * distance, y + dy * distance);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  function placeFollowers(motion, game) {
    for (let index = 1; index < motion.cars.length; index += 1) {
      const car = motion.cars[index];
      const offset = motion.offsets[index];
      const position = samplePath(motion.path, offset);
      // 与望一样，姿态取所在轨迹段的切线，到达拐点才转向。
      car.heading = Math.atan2(position.directionY, position.directionX);
      Object.assign(car, clampCar({ ...car, x: position.x, y: position.y }, resolveArenaGeometry(game)));
      car.vx = Math.cos(car.heading) * CAR_SPEED;
      car.vy = Math.sin(car.heading) * CAR_SPEED;
    }
  }

  // 每个时间步整列只推进一次；只有固定车头反弹，后车按路程延迟跟随。
  function advanceTrain(car, game, elapsed) {
    if (car.motionTime === game.time) return;
    const motion = getTrainMotion(car);
    for (const member of motion.cars) {
      member.motionTime = game.time;
      member.arenaSize = game.arenaSize;
    }
    const catchUp = (FOLLOW_CATCH_UP_SPEED - CAR_SPEED) * elapsed;
    for (let index = 1; index < motion.offsets.length; index += 1) {
      const difference = motion.offsets[index - 1] + CAR_LENGTH - motion.offsets[index];
      motion.offsets[index] += clamp(difference, -catchUp, catchUp);
    }
    car = motion.cars[0];
    let remaining = elapsed;
    let guard = 0;
    while (remaining > EPSILON && guard < WALL_BOUNCE_GUARD) {
      guard += 1;
      const speed = Math.hypot(car.vx, car.vy) || CAR_SPEED;
      const stepX = car.vx / speed;
      const stepY = car.vy / speed;
      const arena = resolveArenaGeometry(game);
      Object.assign(car, clampCar(car, arena));
      prependPathPoint(motion.path, car.x, car.y);
      const travel = speed * remaining;
      const hit = carWallHit(car, arena, stepX, stepY, travel);
      const wallDistance = hit ? travel * hit.t : travel;
      if (wallDistance >= travel) {
        car.x += stepX * travel;
        car.y += stepY * travel;
        prependPathPoint(motion.path, car.x, car.y);
        break;
      }
      car.x += stepX * wallDistance;
      car.y += stepY * wallDistance;
      prependPathPoint(motion.path, car.x, car.y);
      remaining -= wallDistance / speed;
      const dot = car.vx * hit.normalX + car.vy * hit.normalY;
      const vx = hit.normalX && hit.normalY && arena.shape !== "circle" ? -car.vx : car.vx - 2 * dot * hit.normalX;
      const vy = hit.normalX && hit.normalY && arena.shape !== "circle" ? -car.vy : car.vy - 2 * dot * hit.normalY;
      car.vx = vx;
      car.vy = vy;
      // 先按新朝向定姿态，再用这个朝向的跨度夹位置（顺序反了会漏出几单位）。
      car.heading = Math.atan2(car.vy, car.vx);
      Object.assign(car, clampCar(car, arena));
      prependPathPoint(motion.path, car.x, car.y);
    }
    placeFollowers(motion, game);
    motion.path = slicePath(motion.path, 0, motion.offsets[motion.offsets.length - 1] + CAR_LENGTH);
  }

  // 头车身后的整条链（用于成环检查和长度校验）。

  function isInFollowerChain(start, target) {
    let node = start;
    let depth = 0;
    while (node && depth <= MAX_CHAIN) {
      if (node === target) return true;
      node = node.follower;
      depth += 1;
    }
    return false;
  }

  // 整列车有多少节（先走到头车再往后数 —— 只数某一节后面的会漏掉它前面的）。
  function chainSize(car) {
    let root = car;
    let depth = 0;
    while (root.leader && depth < MAX_CHAIN) {
      root = root.leader;
      depth += 1;
    }
    let count = 0;
    let node = root;
    while (node && count < MAX_CHAIN) {
      count += 1;
      node = node.follower;
    }
    return count;
  }

  // 一列火车必须装得进场。注意这是两列车对接：挂上去之后整列 = 前车那一列
  // 加上后车这一列（后车自己也可能已经拖着几节），所以两边都要数进去。
  function chainFits(front, rear, game) {
    const total = chainSize(front) + chainSize(rear);
    return total <= MAX_CHAIN && total * CAR_LENGTH <= Math.max(resolveArenaGeometry(game).width, resolveArenaGeometry(game).height) - CAR_HALF_WIDTH * 2;
  }

  // 车头刚好贴到另一节车厢的车尾 → 挂钩连成一列。
  function tryCouple(car, game, elapsed) {
    if (car.leader) return false;
    const reach = CAR_HALF_WIDTH * 2;
    const reachSquared = reach * reach;
    for (const other of game.combatEntities) {
      if (other === car || other.kind !== "train-car") continue;
      if (!isLiveCar(other)) continue;
      advanceTrain(other, game, elapsed);
      if (other.follower) continue;
      // 不能把车挂到自己后面去（成环）。
      if (isInFollowerChain(other, car)) continue;
      if (isInFollowerChain(car, other)) continue;
      // 挂上去之后整列还得分得开（场地装不下就不再挂）。
      if (!chainFits(other, car, game)) continue;
      // 两节车厢的朝向差太多就不硬连（车头对着车尾才算挂钩）。
      if (Math.abs(normalizeAngle(car.heading - other.heading)) > COUPLE_MAX_ANGLE) continue;
      const tail = carTail(other);
      const head = carHead(car);
      const deltaX = head.x - tail.x;
      const deltaY = head.y - tail.y;
      if (deltaX * deltaX + deltaY * deltaY > reachSquared) continue;
      car.leader = other;
      other.follower = car;
      getTrainMotion(car);
      return true;
    }
    return false;
  }

  // 碰撞：整节车厢当成「车轴线段 + 半宽」的胶囊，谁进来就 -3 并吃一发列车击退。
  // 离开车身之后才重新武装，所以贴着车走不会每帧掉血。
  function crushEnemies(car, carServices) {
    const tail = carTail(car);
    const head = carHead(car);
    const seen = new Set();
    carServices.forEachEnemy((target) => {
      if (!target || target.hp <= 0) return;
      const profile = carServices.getContactProfile(target);
      if (!profile.solid || !profile.attackable) return;
      const key = target.instanceId || target.id;
      seen.add(key);
      const contact = distanceToSegment(
        target.x, target.y, tail.x, tail.y, head.x, head.y
      );
      if (contact.distance > target.radius + CAR_HALF_WIDTH) {
        car.hitTargets.delete(key);
        return;
      }
      if (car.hitTargets.has(key)) return;
      if (!carServices.dealDamage(target, CAR_DAMAGE)) return;
      car.hitTargets.add(key);
      let normalX = target.x - contact.closestX;
      let normalY = target.y - contact.closestY;
      const magnitude = Math.hypot(normalX, normalY);
      if (magnitude <= EPSILON) {
        normalX = Math.cos(car.heading);
        normalY = Math.sin(car.heading);
      } else {
        normalX /= magnitude;
        normalY /= magnitude;
      }
      // 「望」的列车同款击退（light.js 导出的那一个）。
      carServices.applyEffect(target, createTrainKnockback(car, normalX, normalY));
      carServices.spawnParticleBurst({
        kind: "train-car-impact",
        x: contact.closestX,
        y: contact.closestY,
        count: 12,
        minDiameter: 1,
        maxDiameter: 6,
        minSpeed: 60,
        maxSpeed: 200,
        initialRadius: 4,
        directionAngle: Math.atan2(normalY, normalX),
        directionSpread: 1.4,
        life: 0.42,
        drag: 2.6,
        colors: ["#ffffff", car.color, "#969ba0"]
      });
    });
    for (const key of car.hitTargets) {
      if (!seen.has(key)) car.hitTargets.delete(key);
    }
  }

  function drawTrainCar(context, car) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.heading);
    const edge = darkenColor(car.color);
    // 车身
    context.fillStyle = car.color;
    context.strokeStyle = edge;
    context.lineWidth = 1.2;
    context.beginPath();
    context.rect(-CAR_HALF_LENGTH, -CAR_HALF_WIDTH, CAR_LENGTH, CAR_WIDTH);
    context.fill();
    context.stroke();
    // 车顶（同色浅一档）
    context.fillStyle = mixWithWhite(car.color, 0.45);
    context.beginPath();
    context.rect(
      -CAR_HALF_LENGTH + 4,
      -CAR_HALF_WIDTH + 4,
      CAR_LENGTH - 8,
      CAR_WIDTH - 8
    );
    context.fill();
    // 车头挂钩
    context.fillStyle = COUPLER_COLOR;
    context.fillRect(CAR_HALF_LENGTH - 1, -3, 4, 6);
    // 车尾挂座
    context.fillRect(-CAR_HALF_LENGTH - 3, -3, 4, 6);
    context.restore();
  }

  function createTrainCar(source, angle, arenaSize = null) {
    const colorIndex = Math.floor(Math.random() * CAR_COLORS.length);
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const startDistance = source.radius + CAR_HALF_LENGTH;
    const spawnX = source.x + directionX * startDistance;
    const spawnY = source.y + directionY * startDistance;
    // 贴墙发车时起点可能落在场外：按实际朝向的跨度夹回场内。
    const spawnHalfSpanX = Math.abs(CAR_HALF_LENGTH * directionX) +
      Math.abs(CAR_HALF_WIDTH * directionY);
    const spawnHalfSpanY = Math.abs(CAR_HALF_LENGTH * directionY) +
      Math.abs(CAR_HALF_WIDTH * directionX);
    const point = arenaSize === null ? { x: spawnX, y: spawnY } : clampCar({ x: spawnX, y: spawnY, heading: angle }, resolveArenaGeometry(arenaSize));
    return {
      kind: "train-car",
      combatKind: "zone",
      // 车厢不跟着本体走：本体死了它照样在场里跑到底。
      lifecycle: "independent",
      // 永不消失。
      life: Number.MAX_SAFE_INTEGER,
      drawLayer: "background",
      x: point.x,
      y: point.y,
      vx: directionX * CAR_SPEED,
      vy: directionY * CAR_SPEED,
      heading: angle,
      color: CAR_COLORS[colorIndex],
      colorIndex,
      radius: CAR_HALF_WIDTH,
      leader: null,
      follower: null,
      trainMotion: null,
      motionTime: null,
      coupleTime: null,
      hitTargets: new Set(),
      arenaSize: Number.isFinite(arenaSize) ? arenaSize : Number.MAX_SAFE_INTEGER,
      update({ entity, game, services: carServices }, dt) {
        const elapsed = Math.max(0, Number.isFinite(dt) ? dt : 0);
        advanceTrain(entity, game, elapsed);
        const head = entity.trainMotion.cars[0];
        if (head.coupleTime !== game.time) {
          head.coupleTime = game.time;
          tryCouple(head, game, elapsed);
        }
        crushEnemies(entity, carServices);
      },
      draw({ entity }, context) {
        drawTrainCar(context, entity);
      }
    };
  }

  const trainConductorV2Definition = {
    id: "trainConductorV2",
    name: "列车长v2",
    englishName: "Train Conductor V2",
    color: BODY_COLOR,
    description: "每3.8s射出一节车厢 / 20×30 反弹不灭 / 撞人-3+列车同款击退 / 头碰尾挂成一列",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: FIRE_INTERVAL,
    createBehavior(services) {
      // 开局先蓄 3.8 秒再发第一列；被控时整个节奏冻结（计时只在 update 里推进）。
      let fireTimer = FIRE_INTERVAL;
      let fired = 0;

      function fireCar(context) {
        const angle = Math.random() * TWO_PI;
        fired += 1;
        services.spawnCombatEntity(createTrainCar(
          context.ball, angle, context.game
        ));
        services.playSound("shoot", { kind: "train-car", speed: CAR_SPEED });
      }

      return {
        update(context, dt) {
          fireTimer -= Math.max(0, Number.isFinite(dt) ? dt : 0);
          if (fireTimer > EPSILON) return;
          fireTimer = FIRE_INTERVAL;
          fireCar(context);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, fireTimer);
        },
        getTrainConductorState() {
          return { fireTimer, fired };
        }
        // 本体不实现 drawBody：需求是浅粉纯色绘制，交给渲染器的默认平涂 + 描边。
      };
    }
  };

  registerBall(trainConductorV2Definition);

  return {
    trainConductorV2Definition,
    createTrainCar,
    TRAIN_CONDUCTOR_V2_CONSTANTS: Object.freeze({
      FIRE_INTERVAL,
      CAR_LENGTH,
      CAR_WIDTH,
      CAR_SPEED,
      CAR_DAMAGE,
      BODY_COLOR,
      CAR_COLORS
    })
  };
});
