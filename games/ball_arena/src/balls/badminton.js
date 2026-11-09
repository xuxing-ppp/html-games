(function initializeBadminton(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBadmintonPlugin({ registerBall, resolveArenaGeometry }) {
  // 羽毛球：手持一支长 30 的球拍。本体碰到场上任意一只羽毛球就挥拍
  // （动作 0.2 秒，拍面走一段弧线并留下拖尾），动作结束时把那只羽毛球击出。
  //
  // - 场上羽毛球按 0s / 10s / 16s 各生成一只（共 3 只），之后不再生成。
  // - 羽毛球有效直径 3（碰撞半径 1.5），刚生成时球头朝上、静止待击。
  // - 击出后球头一直朝运动方向（停下也保持最后朝向），初速 1000、减速 100。
  // - 撞上敌方造成 5 点碰撞伤害；之后不消失、按物理反弹（敌方也会被撞得改向），
  //   并把减速提到 450，直到完全静止；再碰到本体可以击出下一轮。
  // - 它是一枚召唤物球，墙壁/球体碰撞与推挤交给引擎按当前场地模式处理
  //   （速度模型由本球自持：初速 1000、匀速衰减，见 update）。
  // - 羽毛球是不可摧毁的纯物理物体（有碰撞体积、可推挤，但不吃任何伤害）。
  const BODY_COLOR = "#f2f5f8";

  // ── 球拍几何：握点相对本体的偏移写在"瞄准坐标系"里（forward 沿瞄准方向、
  //    side 垂直它），与黄瓜同一套做法，只是长度换成 30。 ──
  const RACKET_LENGTH = 30;
  const RACKET_HANDLE_END = 12;
  const RACKET_HEAD_CENTER = 21;
  const RACKET_HEAD_HALF_LENGTH = 9;
  const RACKET_HEAD_HALF_WIDTH = 7.5;
  const IDLE_SIDE_OFFSET = 12;

  const FRAME_COLOR = "#2b3646";
  const FRAME_LIGHT = "#657a96";
  const STRING_COLOR = "#e6edf6";
  const GRIP_COLOR = "#c8572b";
  const GRIP_DARK = "#7c3115";
  const TRAIL_COLOR = "#eef4fb";

  // ── 挥拍 ──
  const SWING_DURATION = 0.2;
  const SWING_REACH = 15;
  const SWING_ARC = 1.35;
  const AIM_TURN_RATE = 12;
  const IDLE_APPROACH_RATE = 14;
  // 每片拖尾存活 0.2 秒；动作 0.2 秒内持续喂样，所以整条拖尾"从动作开始算"
  // 正好 0.4 秒后消失，不会在动作结束时瞬间断掉。
  const TRAIL_SAMPLE_LIFE = 0.2;
  const TRAIL_MAX_SAMPLES = 48;

  // ── 场上羽毛球 ──
  const SHUTTLE_ID = "badmintonShuttle";
  const SHUTTLE_RADIUS = 1.5;
  const SHUTTLE_SPAWN_SCHEDULE = Object.freeze([0, 10, 16]);
  const SHUTTLE_HIT_DAMAGE = 5;
  const SHUTTLE_LAUNCH_SPEED = 1000;
  const SHUTTLE_LAUNCH_DECELERATION = 100;
  const SHUTTLE_HIT_DECELERATION = 450;
  const SHUTTLE_FEATHER_COLOR = "#f7fafd";
  const SHUTTLE_FEATHER_EDGE = "#b8c4d2";
  const SHUTTLE_CORK_COLOR = "#e9dcc0";
  const SHUTTLE_CORK_EDGE = "#a8926a";
  // 击出后必须真正离开接触范围（多让出这么多距离）才重新武装，避免"出手那一两帧
  // 还重叠着"被判成下一次接触，变成一秒连挥好几拍。
  const SHUTTLE_SEPARATION_MARGIN = 20;

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  // -0 与 0 在 Object.is 下不相等：航向为 0 时 0 * 负数 = -0，写进速度会污染
  // 依赖严格相等的调用方（回放/测试），这里统一收敛成 +0。
  function settleZero(value) {
    return value === 0 ? 0 : value;
  }

  function angleDifference(target, current) {
    let difference = target - current;
    while (difference > Math.PI) difference -= TWO_PI;
    while (difference < -Math.PI) difference += TWO_PI;
    return difference;
  }

  function approach(current, target, rate, dt) {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, rate) * Math.max(0, dt)));
  }

  // ── 几何（与黄瓜同名同结构）：grip 是握点，tip 是拍框最远端。 ──
  function racketGeometry(ball, angle, forward, side) {
    const aimX = Math.cos(angle);
    const aimY = Math.sin(angle);
    const perpX = aimY;
    const perpY = -aimX;
    const grip = {
      x: ball.x + aimX * forward + perpX * side,
      y: ball.y + aimY * forward + perpY * side
    };
    return {
      angle,
      axisX: aimX,
      axisY: aimY,
      grip,
      tip: {
        x: grip.x + aimX * RACKET_LENGTH,
        y: grip.y + aimY * RACKET_LENGTH
      },
      head: {
        x: grip.x + aimX * RACKET_HEAD_CENTER,
        y: grip.y + aimY * RACKET_HEAD_CENTER
      }
    };
  }

  function drawRacket(canvas, geometry) {
    if (!canvas || typeof canvas.lineTo !== "function") return;
    canvas.save();
    canvas.translate(geometry.grip.x, geometry.grip.y);
    canvas.rotate(geometry.angle);

    // 拍柄：深色芯 + 缠带 + 底盖
    canvas.fillStyle = GRIP_DARK;
    canvas.fillRect(-2.4, -1.9, RACKET_HANDLE_END + 2.8, 3.8);
    canvas.fillStyle = GRIP_COLOR;
    canvas.fillRect(-1.2, -1.5, RACKET_HANDLE_END + 0.4, 3);
    canvas.strokeStyle = GRIP_DARK;
    canvas.lineWidth = 0.35;
    canvas.beginPath();
    for (let x = -0.4; x <= RACKET_HANDLE_END - 1.4; x += 1.8) {
      canvas.moveTo(x, -1.5);
      canvas.lineTo(x + 1.1, 1.5);
    }
    canvas.stroke();
    canvas.fillStyle = GRIP_DARK;
    canvas.fillRect(-3.4, -2.2, 2.4, 4.4);

    // 拍喉：两根斜梁把柄接到拍框上
    canvas.strokeStyle = FRAME_COLOR;
    canvas.lineWidth = 1.6;
    canvas.beginPath();
    canvas.moveTo(RACKET_HANDLE_END - 0.6, -1.4);
    canvas.lineTo(RACKET_HEAD_CENTER - RACKET_HEAD_HALF_LENGTH + 1.2, -4.4);
    canvas.moveTo(RACKET_HANDLE_END - 0.6, 1.4);
    canvas.lineTo(RACKET_HEAD_CENTER - RACKET_HEAD_HALF_LENGTH + 1.2, 4.4);
    canvas.stroke();

    // 拍框：外圈深色、内圈提亮
    canvas.strokeStyle = FRAME_COLOR;
    canvas.lineWidth = 2.1;
    canvas.beginPath();
    canvas.ellipse(
      RACKET_HEAD_CENTER, 0, RACKET_HEAD_HALF_LENGTH, RACKET_HEAD_HALF_WIDTH, 0, 0, TWO_PI
    );
    canvas.stroke();
    canvas.strokeStyle = FRAME_LIGHT;
    canvas.lineWidth = 0.8;
    canvas.beginPath();
    canvas.ellipse(
      RACKET_HEAD_CENTER, 0, RACKET_HEAD_HALF_LENGTH - 1, RACKET_HEAD_HALF_WIDTH - 1, 0, 0, TWO_PI
    );
    canvas.stroke();

    // 拍线：纵横各几条，按椭圆边界裁短
    canvas.strokeStyle = STRING_COLOR;
    canvas.lineWidth = 0.4;
    for (let index = -3; index <= 3; index += 1) {
      const offset = index * 2.5;
      const ratio = offset / RACKET_HEAD_HALF_LENGTH;
      const span = RACKET_HEAD_HALF_WIDTH * Math.sqrt(Math.max(0, 1 - ratio * ratio));
      if (span <= 0.25) continue;
      canvas.beginPath();
      canvas.moveTo(RACKET_HEAD_CENTER + offset, -span);
      canvas.lineTo(RACKET_HEAD_CENTER + offset, span);
      canvas.stroke();
    }
    for (let index = -2; index <= 2; index += 1) {
      const offset = index * 2.9;
      const ratio = offset / RACKET_HEAD_HALF_WIDTH;
      const span = RACKET_HEAD_HALF_LENGTH * Math.sqrt(Math.max(0, 1 - ratio * ratio));
      if (span <= 0.25) continue;
      canvas.beginPath();
      canvas.moveTo(RACKET_HEAD_CENTER - span, offset);
      canvas.lineTo(RACKET_HEAD_CENTER + span, offset);
      canvas.stroke();
    }
    canvas.restore();
  }

  // 拖尾：记录挥拍过程中拍面中心走过的位置，整体画成一条随时间变淡、变窄的带子。
  // 逐段四边形在相邻段之间会露出角缝（采样间隔恒定、带宽很宽），所以这里把整条
  // 采样折线合成一个多边形一次填充，用沿轨迹的线性渐变实现"越旧越淡"。
  function trailHalfWidth(sample) {
    const fade = Math.pow(Math.max(0, 1 - sample.age / TRAIL_SAMPLE_LIFE), 1.4);
    return RACKET_HEAD_HALF_WIDTH * 0.8 * (0.24 + 0.76 * fade);
  }

  function trailNormals(trail) {
    const normals = [];
    for (let index = 0; index < trail.length; index += 1) {
      const previous = trail[Math.max(0, index - 1)];
      const next = trail[Math.min(trail.length - 1, index + 1)];
      let deltaX = next.x - previous.x;
      let deltaY = next.y - previous.y;
      const length = Math.hypot(deltaX, deltaY);
      if (length <= EPSILON) {
        deltaX = 1;
        deltaY = 0;
      } else {
        deltaX /= length;
        deltaY /= length;
      }
      normals.push({ x: -deltaY, y: deltaX });
    }
    return normals;
  }

  function drawRacketTrail(canvas, trail) {
    if (!canvas || typeof canvas.lineTo !== "function") return;
    if (!Array.isArray(trail) || trail.length < 2) return;
    const oldest = trail[0];
    const newest = trail[trail.length - 1];
    const usesGradient = typeof canvas.createLinearGradient === "function";
    const gradient = usesGradient
      ? canvas.createLinearGradient(oldest.x, oldest.y, newest.x, newest.y)
      : null;
    if (gradient && typeof gradient.addColorStop === "function") {
      gradient.addColorStop(0, "rgba(238, 244, 251, 0)");
      gradient.addColorStop(0.55, "rgba(238, 244, 251, 0.34)");
      gradient.addColorStop(1, "rgba(238, 244, 251, 0.72)");
    }
    const normals = trailNormals(trail);
    canvas.save();
    const baseAlpha = Number.isFinite(canvas.globalAlpha) ? canvas.globalAlpha : 1;
    canvas.globalAlpha = baseAlpha * 0.55;
    canvas.fillStyle = gradient || TRAIL_COLOR;
    canvas.beginPath();
    for (let index = 0; index < trail.length; index += 1) {
      const sample = trail[index];
      const normal = normals[index];
      const half = trailHalfWidth(sample);
      const x = sample.x + normal.x * half;
      const y = sample.y + normal.y * half;
      if (index === 0) canvas.moveTo(x, y);
      else canvas.lineTo(x, y);
    }
    for (let index = trail.length - 1; index >= 0; index -= 1) {
      const sample = trail[index];
      const normal = normals[index];
      const half = trailHalfWidth(sample);
      canvas.lineTo(sample.x - normal.x * half, sample.y - normal.y * half);
    }
    canvas.closePath();
    canvas.fill();
    canvas.restore();
  }

  // ── 场上羽毛球 ──
  // 球头（软木）朝 heading，羽毛裙朝反方向张开。召唤物本体被引擎夹在场内，
  // 移动/撞墙/球体碰撞全部由引擎按当前运动模式处理。
  function drawShuttlecock(canvas, ball, headingX, headingY) {
    if (!canvas || typeof canvas.lineTo !== "function") return;
    const radius = Math.max(1, ball.radius);
    canvas.save();
    canvas.translate(ball.x, ball.y);
    canvas.rotate(Math.atan2(headingY, headingX));

    const skirtBack = -radius * 4.6;
    const skirtHalfFront = radius * 1.05;
    const skirtHalfBack = radius * 2.05;
    canvas.fillStyle = SHUTTLE_FEATHER_COLOR;
    canvas.strokeStyle = SHUTTLE_FEATHER_EDGE;
    canvas.lineWidth = Math.max(0.22, radius * 0.16);
    canvas.beginPath();
    canvas.moveTo(-radius * 0.4, -skirtHalfFront);
    canvas.lineTo(skirtBack, -skirtHalfBack);
    canvas.lineTo(skirtBack, skirtHalfBack);
    canvas.lineTo(-radius * 0.4, skirtHalfFront);
    canvas.closePath();
    canvas.fill();
    canvas.stroke();

    canvas.beginPath();
    canvas.moveTo(-radius * 0.6, 0);
    canvas.lineTo(skirtBack * 0.94, 0);
    canvas.moveTo(-radius * 0.5, -skirtHalfFront * 0.62);
    canvas.lineTo(skirtBack * 0.86, -skirtHalfBack * 0.55);
    canvas.moveTo(-radius * 0.5, skirtHalfFront * 0.62);
    canvas.lineTo(skirtBack * 0.86, skirtHalfBack * 0.55);
    canvas.stroke();

    canvas.fillStyle = SHUTTLE_CORK_COLOR;
    canvas.strokeStyle = SHUTTLE_CORK_EDGE;
    canvas.lineWidth = Math.max(0.24, radius * 0.18);
    canvas.beginPath();
    canvas.arc(radius * 0.35, 0, radius * 1.1, 0, TWO_PI);
    canvas.fill();
    canvas.stroke();
    canvas.restore();
  }

  // 碰撞体积随状态变化时要让引擎的 contact profile 缓存失效（同 heavy-hammer 的做法）。
  function touchContactProfile(ball) {
    if (ball) ball.statusRevision = (ball.statusRevision || 0) + 1;
  }

  function createShuttlecockDefinition() {
    return {
      id: SHUTTLE_ID,
      healthless: true,
      name: "羽毛球",
      englishName: "Shuttlecock",
      color: SHUTTLE_FEATHER_COLOR,
      description: "场上羽毛球 / 静止时没有碰撞体积 / 被球拍击出后 1000 初速、100 减速 / 命中敌方 5 点并改为 450 减速",
      stats: { radius: SHUTTLE_RADIUS, speed: 150, maxHp: 100 },
      createBehavior() {
        let ball = null;
        // phase: ready（刚生成、静止待击）→ flying（飞行中）→ resting（速度归零）
        let phase = "ready";
        // 刚生成时球头朝上（画布 y 轴向下，所以"上"是 -y）。
        let headingX = 0;
        let headingY = -1;
        let speed = 0;
        let deceleration = SHUTTLE_LAUNCH_DECELERATION;
        let hitEnemies = 0;

        // 速度模型由本球自持：每次把"航向 × 速度"写回 vx/vy 与 storedVx/storedVy。
        // 引擎的墙壁/球体碰撞照常改写这两组分量，下一帧从这里读回新的航向，
        // 于是"反弹改变方向、速度按减速衰减"两件事互不打架。
        function writeVelocity() {
          ball.vx = ball.storedVx = settleZero(headingX * speed);
          ball.vy = ball.storedVy = settleZero(headingY * speed);
          ball.speedNeedsNormalization = false;
        }

        return {
          onSpawn(context) {
            ball = context.ball;
            phase = "ready";
            headingX = 0;
            headingY = -1;
            speed = 0;
            deceleration = SHUTTLE_LAUNCH_DECELERATION;
            hitEnemies = 0;
            writeVelocity();
            touchContactProfile(ball);
          },
          // 由本体在挥拍动作结束时调用。
          launch(directionX, directionY) {
            const magnitude = Math.hypot(directionX, directionY) || 1;
            headingX = directionX / magnitude;
            headingY = directionY / magnitude;
            speed = SHUTTLE_LAUNCH_SPEED;
            deceleration = SHUTTLE_LAUNCH_DECELERATION;
            phase = "flying";
            if (ball) {
              writeVelocity();
              touchContactProfile(ball);
            }
          },
          update(context, dt) {
            ball = context.ball;
            if (phase !== "flying") {
              // 静止（待击 / 已停稳）：压住速度，只保留引擎自己的位置修正。
              speed = 0;
              writeVelocity();
              return;
            }
            // 从当前速度读回航向：墙壁反弹、球体碰撞与场地物理模式都写在这里。
            const magnitude = Math.hypot(ball.vx, ball.vy);
            if (magnitude > EPSILON) {
              headingX = ball.vx / magnitude;
              headingY = ball.vy / magnitude;
            }
            speed = Math.max(0, speed - deceleration * Math.max(0, dt));
            if (speed <= EPSILON) {
              speed = 0;
              phase = "resting";
              touchContactProfile(ball);
            }
            writeVelocity();
          },
          // 被眩晕等控制时行为暂停：不自推进（速度由引擎惯性保留）。
          updateWhilePaused() {},
          onCollision(context, target) {
            if (context.blockedAtContact) return;
            // 只有飞行途中撞上才算"击中"；静止的羽毛球没有碰撞体积，本来也不会
            // 走到这里（引擎那侧已经按 solid:false 跳过了）。
            if (phase !== "flying" || speed <= EPSILON) return;
            if (!context.services.dealDamage(target, SHUTTLE_HIT_DAMAGE)) return;
            hitEnemies += 1;
            deceleration = SHUTTLE_HIT_DECELERATION;
            // 羽毛球很轻：按"撞墙反弹"的方式弹开（航向关于接触法线反射），而不是
            // 走引擎的等质量速度交换（那会让自己归零、被对手甩开变成追打）。
            // 接触法线的约定是"由本球指向目标"，所以反射后正好朝反方向弹回；
            // 对手那一侧照旧由引擎的球体碰撞改写速度——它会被撞得改向。
            const contact = context.contact;
            if (
              contact &&
              Number.isFinite(contact.normalX) &&
              Number.isFinite(contact.normalY)
            ) {
              const normalX = contact.normalX;
              const normalY = contact.normalY;
              const projection = headingX * normalX + headingY * normalY;
              let reflectedX = headingX - 2 * projection * normalX;
              let reflectedY = headingY - 2 * projection * normalY;
              const magnitude = Math.hypot(reflectedX, reflectedY);
              if (magnitude > EPSILON) {
                reflectedX /= magnitude;
                reflectedY /= magnitude;
              } else {
                // 法向正对（正撞）：直接反着来。
                reflectedX = -normalX;
                reflectedY = -normalY;
              }
              headingX = reflectedX;
              headingY = reflectedY;
              writeVelocity();
            }
          },
          getContactProfile() {
            // 静止的羽毛球没有碰撞体积（待击 / 已停稳时任何球都能直接穿过去，
            // 不推挤、不反弹、也不派发碰撞事件）；只有被球拍击出、还在飞的时候
            // 才是实体，才能撞到敌方并撞墙反弹。两种状态下都不可摧毁。
            return {
              solid: phase === "flying" && speed > EPSILON,
              attackable: false
            };
          },
          getHpDisplay() {
            return { hidden: true };
          },
          drawBody(context, canvas) {
            drawShuttlecock(canvas, context.ball, headingX, headingY);
            return true;
          },
          getShuttleState() {
            return { phase, speed, headingX, headingY, deceleration, hitEnemies };
          }
        };
      }
    };
  }

  const badmintonDefinition = {
    id: "badminton",
    name: "羽毛球",
    englishName: "Badminton",
    color: BODY_COLOR,
    description: "手持球拍(长30) / 碰到场上羽毛球即挥拍0.2秒并击出 / "
      + "击出1000初速·100减速·命中5点·命中后减速450 / 0s·10s·16s各生成一只羽毛球",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let ownerBall = null;
      let initialized = false;
      // 生成时刻表：0s / 10s / 16s
      let elapsed = 0;
      let nextSpawnIndex = 0;
      const shuttles = [];
      // 每只羽毛球是否"已经离手过一次"：击出后必须先离开接触范围，回来再碰才算
      // 下一轮击出；否则出手那一两帧还在重叠，会变成一秒十几拍的连击。
      const armed = new Map();

      let swing = null;
      let racketAngle = 0;
      let racketForward = 0;
      let racketSide = IDLE_SIDE_OFFSET;
      let aimAngle = 0;
      let trail = [];
      let swingCount = 0;
      let launchCount = 0;

      function isLiveShuttle(shuttle) {
        return Boolean(
          shuttle &&
          shuttle.active !== false &&
          shuttle.hp > 0 &&
          services.getBall(shuttle.instanceId) === shuttle
        );
      }

      function aimAtNearestEnemy(ball) {
        let best = null;
        let bestDistance = Infinity;
        services.forEachEnemy((enemy) => {
          if (!enemy || enemy.hp <= 0) return;
          const distance = Math.hypot(enemy.x - ball.x, enemy.y - ball.y);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = enemy;
          }
        });
        if (best) return Math.atan2(best.y - ball.y, best.x - ball.x);
        const velocityX = ball.storedVx || ball.vx;
        const velocityY = ball.storedVy || ball.vy;
        if (Math.hypot(velocityX, velocityY) > EPSILON) {
          return Math.atan2(velocityY, velocityX);
        }
        return racketAngle;
      }

      function spawnShuttle(game) {
        const arenaSize = game && Number.isFinite(game.arenaSize) ? game.arenaSize : 200;
        const { x, y } = resolveArenaGeometry(game || arenaSize).samplePoint(Math.random, SHUTTLE_RADIUS);
        const shuttle = services.spawnSummon(createShuttlecockDefinition(), { x, y, vx: 0, vy: 0 });
        if (!shuttle) return null;
        shuttles.push(shuttle);
        armed.set(shuttle.instanceId, true);
        return shuttle;
      }

      function advanceSpawnSchedule(game, dt) {
        elapsed += Math.max(0, dt);
        // beginFight 会给场上所有球一个开局速度，所以第一只等开打后再生成。
        if (!game || game.state !== "running") return;
        while (nextSpawnIndex < SHUTTLE_SPAWN_SCHEDULE.length &&
          elapsed + EPSILON >= SHUTTLE_SPAWN_SCHEDULE[nextSpawnIndex]) {
          nextSpawnIndex += 1;
          spawnShuttle(game);
        }
      }

      // 接触判定：召唤物与自己的召唤者之间没有实体碰撞，所以这里只做距离判定。
      function touchingShuttle(ball) {
        let best = null;
        let bestDistance = Infinity;
        for (const shuttle of shuttles) {
          if (!isLiveShuttle(shuttle)) continue;
          const distance = Math.hypot(shuttle.x - ball.x, shuttle.y - ball.y);
          if (distance <= ball.radius + shuttle.radius + EPSILON && distance < bestDistance) {
            bestDistance = distance;
            best = shuttle;
          }
        }
        return best;
      }

      function startSwing(ball, shuttle) {
        const angle = aimAtNearestEnemy(ball);
        aimAngle = angle;
        swing = { elapsed: 0, shuttle, angle };
        swingCount += 1;
      }

      function emitTrailSample(geometry) {
        trail.push({ x: geometry.head.x, y: geometry.head.y, age: 0 });
        if (trail.length > TRAIL_MAX_SAMPLES) {
          trail.splice(0, trail.length - TRAIL_MAX_SAMPLES);
        }
      }

      function ageTrail(dt) {
        const step = Math.max(0, dt);
        for (const sample of trail) sample.age += step;
        while (trail.length > 0 && trail[0].age >= TRAIL_SAMPLE_LIFE) trail.shift();
      }

      function advanceSwing(ball, dt) {
        const step = Math.max(0, dt);
        if (!swing) {
          // 待机：拍面平滑回到侧挂姿势并始终朝向最近的敌人。
          aimAngle = aimAtNearestEnemy(ball);
          racketAngle += angleDifference(aimAngle, racketAngle) * (1 - Math.exp(-AIM_TURN_RATE * step));
          racketForward = approach(racketForward, 0, IDLE_APPROACH_RATE, step);
          racketSide = approach(racketSide, IDLE_SIDE_OFFSET, IDLE_APPROACH_RATE, step);
          return;
        }

        swing.elapsed += step;
        const progress = clamp(swing.elapsed / SWING_DURATION, 0, 1);
        // 拍面从瞄准角后方扫到瞄准角上（收拍时正对击出方向），中段把拍头推出去；
        // 拖尾记录拍面中心。
        racketAngle = swing.angle - SWING_ARC * (1 - progress);
        racketForward = SWING_REACH * Math.sin(Math.PI * progress);
        racketSide = approach(racketSide, 0, IDLE_APPROACH_RATE * 2, step);
        const geometry = racketGeometry(ball, racketAngle, racketForward, racketSide);
        emitTrailSample(geometry);

        if (swing.elapsed + EPSILON < SWING_DURATION) return;
        // 动作走完：把这只羽毛球沿瞄准方向击出。
        const target = swing.shuttle;
        if (isLiveShuttle(target) && typeof target.behavior.launch === "function") {
          // 让羽毛球从拍面中心飞出去（而不是从本体圆心冒出来），视觉上才是"拍到了"。
          target.x = geometry.head.x;
          target.y = geometry.head.y;
          target.prevX = target.x;
          target.prevY = target.y;
          target.behavior.launch(Math.cos(swing.angle), Math.sin(swing.angle));
          launchCount += 1;
          services.playSound("shoot", { speed: SHUTTLE_LAUNCH_SPEED });
          services.spawnParticleBurst({
            kind: "badminton-smash",
            x: target.x,
            y: target.y,
            count: 10,
            shape: "rect",
            minLength: 1.5,
            maxLength: 4.5,
            minWidth: 0.4,
            maxWidth: 1.1,
            colors: [TRAIL_COLOR, STRING_COLOR, FRAME_LIGHT],
            directionAngle: swing.angle,
            directionSpread: Math.PI * 0.8,
            minSpeed: 40,
            maxSpeed: 150,
            drag: 4,
            life: 0.24
          });
          armed.set(target.instanceId, false);
        }
        swing = null;
      }

      // 离手过的羽毛球必须真正脱离接触范围（再让出 SEPARATION_MARGIN 距离）才
      // 重新武装；还贴着的保持"已离手"状态，不会被同一段接触反复触发。
      function rearmSeparatedShuttles(ball) {
        for (const candidate of shuttles) {
          if (!isLiveShuttle(candidate)) continue;
          if (armed.get(candidate.instanceId) !== false) continue;
          const distance = Math.hypot(candidate.x - ball.x, candidate.y - ball.y);
          const threshold = ball.radius + candidate.radius + SHUTTLE_SEPARATION_MARGIN;
          if (distance > threshold) armed.set(candidate.instanceId, true);
        }
      }

      // 场上羽毛球自身不可摧毁，只随本体离场：本体阵亡 / 借用结束时一并收走。
      function retireShuttles() {
        for (const shuttle of shuttles) {
          if (!shuttle) continue;
          shuttle.hp = 0;
          shuttle.active = false;
          shuttle.fade = 0;
          shuttle.deathNotified = true;
          shuttle.diedAt = null;
        }
        shuttles.length = 0;
        armed.clear();
      }

      function advance(context, dt, paused) {
        const ball = context.ball;
        ownerBall = ball;
        if (!initialized) {
          initialized = true;
          racketAngle = aimAtNearestEnemy(ball);
          aimAngle = racketAngle;
        }
        advanceSpawnSchedule(context.game, dt);
        ageTrail(dt);
        if (paused) return;

        rearmSeparatedShuttles(ball);
        const touching = touchingShuttle(ball);
        if (!swing && touching && armed.get(touching.instanceId) !== false) {
          startSwing(ball, touching);
        }
        advanceSwing(ball, dt);
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
          initialized = false;
          advance(context, 0, false);
        },
        update(context, dt) {
          advance(context, dt, false);
        },
        updateWhilePaused(context, dt) {
          // 被眩晕等控制时不挥拍、不喂拖尾，但生成时刻表与拖尾寿命照常走。
          advance(context, dt, true);
        },
        getNextTransitionIn() {
          if (swing) return Math.max(EPSILON, SWING_DURATION - swing.elapsed);
          if (nextSpawnIndex >= SHUTTLE_SPAWN_SCHEDULE.length) return undefined;
          const remaining = SHUTTLE_SPAWN_SCHEDULE[nextSpawnIndex] - elapsed;
          // 已经到点：本步的 update 会立刻生成，不必把步长切碎。
          return remaining > EPSILON ? remaining : undefined;
        },
        getNextPausedTransitionIn() {
          if (nextSpawnIndex >= SHUTTLE_SPAWN_SCHEDULE.length) return undefined;
          const remaining = SHUTTLE_SPAWN_SCHEDULE[nextSpawnIndex] - elapsed;
          return remaining > EPSILON ? remaining : undefined;
        },
        drawBefore(context, canvas) {
          drawRacketTrail(canvas, trail);
          drawRacket(canvas, racketGeometry(context.ball, racketAngle, racketForward, racketSide));
        },
        onDeath() {
          swing = null;
          trail = [];
          retireShuttles();
        },
        onBorrowEnd() {
          // 被借用（莉音）时本体不跑自己的生命周期，借用结束把生成物清干净。
          swing = null;
          trail = [];
          retireShuttles();
        },
        getBadmintonState() {
          const ball = ownerBall;
          const geometry = ball
            ? racketGeometry(ball, racketAngle, racketForward, racketSide)
            : null;
          return {
            swingActive: Boolean(swing),
            swingElapsed: swing ? swing.elapsed : 0,
            swingCount,
            launchCount,
            racketAngle,
            racketForward,
            racketSide,
            aimAngle,
            trailSamples: trail.length,
            spawned: shuttles.length,
            nextSpawnIndex,
            nextSpawnAt: nextSpawnIndex < SHUTTLE_SPAWN_SCHEDULE.length
              ? SHUTTLE_SPAWN_SCHEDULE[nextSpawnIndex]
              : null,
            elapsed,
            grip: geometry ? { ...geometry.grip } : null,
            tip: geometry ? { ...geometry.tip } : null,
            head: geometry ? { ...geometry.head } : null,
            shuttleIds: shuttles.map((shuttle) => shuttle.instanceId),
            disarmedShuttleIds: shuttles
              .filter((shuttle) => armed.get(shuttle.instanceId) === false)
              .map((shuttle) => shuttle.instanceId)
          };
        }
      };
    }
  };

  registerBall(badmintonDefinition);

  return {
    badmintonDefinition,
    createShuttlecockDefinition,
    racketGeometry,
    drawRacket,
    drawRacketTrail,
    drawShuttlecock,
    BADMINTON_LENGTH: RACKET_LENGTH,
    BADMINTON_SHUTTLE_ID: SHUTTLE_ID,
    BADMINTON_SHUTTLE_RADIUS: SHUTTLE_RADIUS,
    BADMINTON_SWING_DURATION: SWING_DURATION,
    BADMINTON_TRAIL_SAMPLE_LIFE: TRAIL_SAMPLE_LIFE,
    BADMINTON_SPAWN_SCHEDULE: SHUTTLE_SPAWN_SCHEDULE,
    BADMINTON_HIT_DAMAGE: SHUTTLE_HIT_DAMAGE,
    BADMINTON_LAUNCH_SPEED: SHUTTLE_LAUNCH_SPEED,
    BADMINTON_LAUNCH_DECELERATION: SHUTTLE_LAUNCH_DECELERATION,
    BADMINTON_HIT_DECELERATION: SHUTTLE_HIT_DECELERATION,
    BADMINTON_IDLE_SIDE_OFFSET: IDLE_SIDE_OFFSET,
    BADMINTON_SEPARATION_MARGIN: SHUTTLE_SEPARATION_MARGIN,
    BADMINTON_BALANCE: Object.freeze({
      RACKET_LENGTH,
      RACKET_HANDLE_END,
      RACKET_HEAD_CENTER,
      RACKET_HEAD_HALF_LENGTH,
      RACKET_HEAD_HALF_WIDTH,
      IDLE_SIDE_OFFSET,
      SWING_DURATION,
      SWING_REACH,
      SWING_ARC,
      TRAIL_SAMPLE_LIFE,
      TRAIL_MAX_SAMPLES,
      SHUTTLE_ID,
      SHUTTLE_RADIUS,
      SHUTTLE_SPAWN_SCHEDULE,
      SHUTTLE_HIT_DAMAGE,
      SHUTTLE_LAUNCH_SPEED,
      SHUTTLE_LAUNCH_DECELERATION,
      SHUTTLE_HIT_DECELERATION,
      SHUTTLE_SEPARATION_MARGIN
    })
  };
});
