(function initializeLiuFuQi(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js"),
      ...require("../core/knockback.js") }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLiuFuQiPlugin(dependencies) {
  "use strict";
  const { resolveArenaGeometry, registerBall, firstSegmentCircleContact, createKnockbackEffect } = dependencies;

  const EPSILON = 1e-8;
  const WIDTH = 20;
  const HEIGHT = 25;
  const PERIOD = 0.8; // Action-clock seconds; both hands stop swinging when paused.
  const AMPLITUDE = 15;
  const RELEASE_DISTANCE = 0.5;
  const COLORS = Object.freeze({ 6: "#ef404b", 7: "#3885f4" });
  // 撞出来的碎片是按"数字像素"走的：一格数字像素 = 20/8 = 2.5 单位，所以碎片
  // 边长也在这条量级上，才读得出"这块盾被敲碎了"，而不是一撮彩色沙子。
  // 三档明度渐次提亮：黑底 + 整团一起淡出，纯色碎片半秒内就暗成剪影，
  // 混一半亮色进去才能撑住"看得见"。
  const PIXEL_PALETTES = Object.freeze({
    6: Object.freeze(["#ef404b", "#ff5d67", "#ffb3b8", "#ffffff"]),
    7: Object.freeze(["#3885f4", "#5fa3ff", "#b6d8ff", "#ffffff"])
  });
  const PIXELS = Object.freeze({
    6: ["00111110", "01111111", "11000011", "11000000", "11111110",
      "11111111", "11000011", "11000011", "01111111", "00111110"],
    7: ["11111111", "11111111", "00000111", "00001110", "00011100",
      "00111000", "00111000", "01110000", "01110000", "01110000"]
  });
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const live = (entity) => entity && entity.entityActive !== false && entity.age < entity.life;

  function digitPose(ball, digit, actionAge) {
    const side = digit === 6 ? -1 : 1;
    return {
      x: ball.x + side * (ball.radius + WIDTH / 2),
      y: ball.y + side * AMPLITUDE * Math.cos(actionAge * Math.PI * 2 / PERIOD)
    };
  }

  // Exact circle/AABB contact, including a circle whose centre is inside the rectangle.
  function rectangleContact(x, y, radius) {
    const px = clamp(x, -WIDTH / 2, WIDTH / 2);
    const py = clamp(y, -HEIGHT / 2, HEIGHT / 2);
    const dx = x - px, dy = y - py;
    const distance = Math.hypot(dx, dy);
    if (distance > radius + EPSILON) return null;
    if (distance > EPSILON) {
      return { x: px, y: py, normalX: dx / distance, normalY: dy / distance,
        penetration: Math.max(0, radius - distance) };
    }
    const horizontal = WIDTH / 2 - Math.abs(x);
    const vertical = HEIGHT / 2 - Math.abs(y);
    const nx = horizontal <= vertical ? (x < 0 ? -1 : 1) : 0;
    const ny = horizontal <= vertical ? 0 : (y < 0 ? -1 : 1);
    return { x: nx ? nx * WIDTH / 2 : x, y: ny ? ny * HEIGHT / 2 : y,
      normalX: nx, normalY: ny, penetration: radius + Math.min(horizontal, vertical) };
  }

  // Sweep faces and rounded corners. An expanded box alone would falsely hit corners.
  function sweptRectangleContact(startX, startY, endX, endY, radius) {
    const initial = rectangleContact(startX, startY, radius);
    if (initial) return { ...initial, progress: 0 };
    const dx = endX - startX, dy = endY - startY;
    let first = Infinity;
    for (const sign of [-1, 1]) {
      if (Math.abs(dx) > EPSILON) {
        const t = (sign * (WIDTH / 2 + radius) - startX) / dx;
        if (t >= 0 && t <= 1 && Math.abs(startY + dy * t) <= HEIGHT / 2) first = Math.min(first, t);
      }
      if (Math.abs(dy) > EPSILON) {
        const t = (sign * (HEIGHT / 2 + radius) - startY) / dy;
        if (t >= 0 && t <= 1 && Math.abs(startX + dx * t) <= WIDTH / 2) first = Math.min(first, t);
      }
      for (const otherSign of [-1, 1]) {
        const t = firstSegmentCircleContact(startX, startY, endX, endY,
          sign * WIDTH / 2, otherSign * HEIGHT / 2, radius);
        if (t !== null) first = Math.min(first, t);
      }
    }
    if (!Number.isFinite(first)) return null;
    const contact = rectangleContact(startX + dx * first, startY + dy * first, radius + EPSILON);
    return contact ? { ...contact, progress: first } : null;
  }

  function contactWithDigit(digit, target) {
    const startX = Number.isFinite(target.prevX) ? target.prevX : target.x;
    const startY = Number.isFinite(target.prevY) ? target.prevY : target.y;
    return sweptRectangleContact(startX - digit.sweepX, startY - digit.sweepY,
      target.x - digit.x, target.y - digit.y, target.radius);
  }

  // 像素盾的碰撞碎片。旧参数（14 片 / 边长 1–3 / 0.3 秒 / 阻力 3）在 200 单位的
  // 场地上只散开十几格就消失，肉眼基本抓不到，等于没做。三件事一起放大：
  //  - 数量与尺寸：30 片、边长 2–6（一格数字像素 2.5），一片就看得清；
  //  - 射程：45–190 速 + 阻力降到 2.1，最快的碎片能飞过 60 单位（两个球径）；
  //  - 起点：不再是一个点，用 initialRadius 铺开半块盾面——撞击面积就是盾的面积。
  // 打中敌人时再顺带补一束"顺着击退方向"的碎片：碎片和被撞飞的敌人同向，
  // 撞击才有方向感，否则四周均匀炸开读起来像放礼花。
  // initialRotation 固定 0：像素不旋转，否则方形会变成斜着的碎屑，像素感立刻没了。
  // scale 给不同场合分档：打中敌人 1（再加方向束）、挡下子弹 0.7、顶到墙召唤 0.8。
  function spawnPixelBurst(services, digit, x, y, scale = 1, normal = null) {
    services.spawnParticleBurst({
      kind: "liu-fu-qi-pixels", x, y,
      count: Math.max(6, Math.round(30 * scale)),
      // 注意：核心 normalizeShape 只认 "rectangle"/"square"/"ellipse"/"oval"，
      // 传 "rect" 会静默退化成圆形（全项目 10 个球都踩了这条），这里必须写全称。
      shape: "rectangle",
      initialRotation: 0,
      initialRadius: 8 * scale,
      colors: PIXEL_PALETTES[digit],
      minDiameter: 2, maxDiameter: 6,
      minLength: 2, maxLength: 6,
      minWidth: 2, maxWidth: 6,
      minSpeed: 45 * scale, maxSpeed: 190 * scale,
      drag: 2.1, life: 0.5
    });
    if (!normal) return;
    services.spawnParticleBurst({
      kind: "liu-fu-qi-pixels", x, y, count: 14,
      shape: "rectangle",
      initialRotation: 0, initialRadius: 4,
      colors: PIXEL_PALETTES[digit],
      minDiameter: 3, maxDiameter: 8,
      minLength: 3, maxLength: 8,
      minWidth: 3, maxWidth: 8,
      minSpeed: 130, maxSpeed: 290,
      drag: 2.6, life: 0.4,
      directionAngle: Math.atan2(normal.normalY, normal.normalX),
      directionSpread: Math.PI * 1.1
    });
  }

  function drawDigit(digit, context) {
    const cells = PIXELS[digit.digit];
    const cell = WIDTH / 8;
    context.save();
    context.translate(digit.x - WIDTH / 2, digit.y - HEIGHT / 2);
    context.fillStyle = digit.hitFlash > 0 ? "#ffffff" : (digit.digit === 6 ? "#fff0f1" : "#edf5ff");
    context.beginPath();
    for (let row = 0; row < cells.length; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        if (cells[row][column] === "1") context.rect(column * cell, row * cell, cell, cell);
      }
    }
    context.fill();
    // Only the silhouette and the hole are outlined; no seams between pixel cells.
    context.beginPath();
    for (let row = 0; row < cells.length; row += 1) {
      for (let column = 0; column < 8; column += 1) {
        if (cells[row][column] !== "1") continue;
        const x = column * cell, y = row * cell;
        if (row === 0 || cells[row - 1][column] !== "1") { context.moveTo(x, y); context.lineTo(x + cell, y); }
        if (row === 9 || cells[row + 1][column] !== "1") { context.moveTo(x, y + cell); context.lineTo(x + cell, y + cell); }
        if (column === 0 || cells[row][column - 1] !== "1") { context.moveTo(x, y); context.lineTo(x, y + cell); }
        if (column === 7 || cells[row][column + 1] !== "1") { context.moveTo(x + cell, y); context.lineTo(x + cell, y + cell); }
      }
    }
    context.strokeStyle = COLORS[digit.digit];
    context.lineWidth = 1;
    context.lineJoin = "miter";
    context.stroke();
    context.restore();
  }

  function updateContacts({ entity, game, services }, dt) {
    entity.hitFlash = Math.max(0, entity.hitFlash - dt);
    const touching = new Set();
    services.forEachContactEnemy((target) => {
      const contact = contactWithDigit(entity, target);
      const current = rectangleContact(target.x - entity.x, target.y - entity.y, target.radius);
      if (!contact) {
        if (rectangleContact(target.x - entity.x, target.y - entity.y, target.radius + RELEASE_DISTANCE)) {
          touching.add(target.instanceId);
        }
        return;
      }
      touching.add(target.instanceId);
      if (services.getContactProfile(target).solid && !services.isMovementLocked(target)) {
        if (current) {
          Object.assign(target, resolveArenaGeometry(game).clampPoint(target.x + current.normalX * (current.penetration + EPSILON), target.y + current.normalY * (current.penetration + EPSILON), target.radius));
        } else if (!entity.contacts.has(target.instanceId)) {
          Object.assign(target, resolveArenaGeometry(game).clampPoint(target.prevX + (target.x - target.prevX) * contact.progress, target.prevY + (target.y - target.prevY) * contact.progress, target.radius));
        }
        const normal = current || contact;
        const incoming = target.vx * normal.normalX + target.vy * normal.normalY;
        if (incoming < 0) {
          target.vx -= 2 * incoming * normal.normalX;
          target.vy -= 2 * incoming * normal.normalY;
          target.storedVx = target.vx; target.storedVy = target.vy;
        }
      }
      if (entity.contacts.has(target.instanceId)) return;
      if (!services.dealDamage(target, entity.digit, { collisionDamage: true })) return;
      entity.hitFlash = 0.12;
      services.applyEffect(target, createKnockbackEffect({
        id: "liu-fu-qi-knockback", duration: 0.67, speedMultiplier: 6.7,
        directionX: contact.normalX, directionY: contact.normalY
      }));
      spawnPixelBurst(services, entity.digit, entity.x + contact.x, entity.y + contact.y, 1, contact);
    });
    entity.contacts = touching;

    for (const projectile of game.combatEntities) {
      if (!live(projectile) || !projectile.isProjectile || projectile.indestructible === true ||
          !services.isEnemy(projectile) || !Number.isFinite(projectile.x) || !Number.isFinite(projectile.y)) continue;
      const radius = Number.isFinite(projectile.radius) ? projectile.radius : 3;
      // Inspect both the last segment and the imminent one, so entity iteration order
      // cannot let a fast ordinary bullet damage the body before reaching the shield.
      const previousX = Number.isFinite(projectile.previousX) ? projectile.previousX : projectile.x;
      const previousY = Number.isFinite(projectile.previousY) ? projectile.previousY : projectile.y;
      const contact = sweptRectangleContact(previousX - entity.sweepX, previousY - entity.sweepY,
        projectile.x - entity.x, projectile.y - entity.y, radius) ||
        sweptRectangleContact(projectile.x - entity.x, projectile.y - entity.y,
          projectile.x + (projectile.vx || 0) * dt - entity.x,
          projectile.y + (projectile.vy || 0) * dt - entity.y, radius);
      if (!contact) continue;
      projectile.entityActive = false;
      projectile.life = 0;
      entity.hitFlash = 0.12;
      spawnPixelBurst(services, entity.digit, entity.x + contact.x, entity.y + contact.y, 0.7);
    }
    entity.sweepX = entity.x; entity.sweepY = entity.y;
  }

  function createDigit(ball, digit, actionAge) {
    const position = digitPose(ball, digit, actionAge);
    return {
      kind: "liu-fu-qi-digit", combatKind: "summon", lifecycle: "owner-bound",
      life: Number.MAX_SAFE_INTEGER, solid: true, targetable: false, indestructible: true,
      drawLayer: "background",
      width: WIDTH, height: HEIGHT, digit, damage: digit, color: COLORS[digit],
      ...position, sweepX: position.x, sweepY: position.y, hitFlash: 0,
      contacts: new Set(), wallContacts: new Set(),
      update: updateContacts,
      draw({ entity }, context) { drawDigit(entity, context); }
    };
  }

  function createDigitMinion(digit) {
    return {
      id: `liuFuQi${digit}Minion`, name: `${digit}号小球`, englishName: `Digit ${digit} Minion`,
      color: COLORS[digit], stats: { radius: 10, speed: 150, maxHp: digit },
      createBehavior() {
        return { onCollision(context, target) { context.services.dealDamage(target, 1); } };
      }
    };
  }

  const liuFuQiDefinition = {
    id: "liuFuQi", name: "刘夫妻", englishName: "Six Seven", color: "#9254cf",
    description: "67血 / 左6右7像素盾，上下交错摆动 / 数字撞击6或7伤害，击退0.67秒、6.7倍速 / 数字触墙召唤对应6或7血小球",
    rosterType: "elite",
    stats: { radius: 15, speed: 150, maxHp: 67 },
    rionCycleDuration: PERIOD * 3,
    createBehavior(services) {
      let actionAge = 0;
      const digits = [];

      function ensureDigits(ball) {
        if (digits.length > 0) return;
        for (const digit of [6, 7]) digits.push(services.spawnCombatEntity(createDigit(ball, digit, actionAge)));
      }

      function anchor(ball, resetHistory = false) {
        for (const digit of digits) {
          Object.assign(digit, digitPose(ball, digit.digit, actionAge));
          if (resetHistory) {
            digit.sweepX = digit.x; digit.sweepY = digit.y;
            digit.contacts.clear(); digit.wallContacts.clear();
          }
        }
      }

      function touchWalls({ ball, game }) {
        anchor(ball);
        const arena = resolveArenaGeometry(game);
        for (const digit of digits) {
          let distances = [digit.x - arena.left - WIDTH / 2, arena.right - digit.x - WIDTH / 2,
            digit.y - arena.top - HEIGHT / 2, arena.bottom - digit.y - HEIGHT / 2];
          let normals = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          if (arena.shape === "circle") {
            const dx = digit.x - arena.centerX, dy = digit.y - arena.centerY;
            const length = Math.hypot(dx, dy) || 1;
            let farthest = 0;
            for (const x of [-WIDTH / 2, WIDTH / 2]) for (const y of [-HEIGHT / 2, HEIGHT / 2]) {
              farthest = Math.max(farthest, Math.hypot(dx + x, dy + y));
            }
            distances = [arena.width / 2 - farthest];
            normals = [[-dx / length, -dy / length]];
          }
          let nx = 0, ny = 0, entered = false;
          for (let wall = 0; wall < distances.length; wall += 1) {
            if (distances[wall] > RELEASE_DISTANCE) digit.wallContacts.delete(wall);
            if (distances[wall] > EPSILON) continue;
            nx += normals[wall][0]; ny += normals[wall][1];
            if (!digit.wallContacts.has(wall)) entered = true;
            digit.wallContacts.add(wall);
          }
          if (!entered) continue;
          const length = Math.hypot(nx, ny);
          const point = arena.clampPoint(digit.x, digit.y, 10);
          if (arena.shape !== "circle") {
            if (nx) point.x = nx > 0 ? arena.left + 10 : arena.right - 10;
            if (ny) point.y = ny > 0 ? arena.top + 10 : arena.bottom - 10;
          }
          const { x, y } = point;
          services.spawnSummon(createDigitMinion(digit.digit), {
            x, y, vx: nx / length * 150, vy: ny / length * 150
          });
          const impact = arena.clampPoint(digit.x, digit.y);
          spawnPixelBurst(services, digit.digit, impact.x, impact.y, 0.8);
        }
      }

      function cleanup() {
        for (const digit of digits) {
          digit.entityActive = false;
          digit.contacts.clear(); digit.wallContacts.clear();
        }
        digits.length = 0;
      }

      return {
        onSpawn({ ball }) { ensureDigits(ball); },
        update({ ball }, dt) { ensureDigits(ball); actionAge = (actionAge + dt) % PERIOD; },
        afterUpdateStep: touchWalls,
        afterUpdateStepWhilePaused({ ball }) { anchor(ball); },
        onAttackTransfer({ ball }) { anchor(ball, true); },
        onBeforeDamage({ ball }, event) {
          if (["dot", "environment", "self"].includes(event.kind) || !event.actor || event.actor === ball) return event;
          const actor = event.actor;
          if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return event;
          const radius = event.entity && Number.isFinite(event.entity.radius) ? event.entity.radius : 0;
          for (const digit of digits) {
            if (!live(digit)) continue;
            const pose = digitPose(ball, digit.digit, actionAge);
            const startX = event.entity && Number.isFinite(event.entity.previousX) ? event.entity.previousX : actor.x;
            const startY = event.entity && Number.isFinite(event.entity.previousY) ? event.entity.previousY : actor.y;
            const contact = sweptRectangleContact(startX - pose.x, startY - pose.y,
              ball.x - pose.x, ball.y - pose.y, radius);
            if (!contact) continue;
            digit.hitFlash = 0.12;
            if (event.kind === "projectile" && event.entity && event.entity.indestructible !== true) {
              event.entity.entityActive = false; event.entity.life = 0;
            }
            spawnPixelBurst(services, digit.digit, pose.x + contact.x, pose.y + contact.y, 0.7);
            return { amount: 0, showHitText: false };
          }
          return event;
        },
        onDeath: cleanup,
        onBorrowEnd: cleanup,
        onAbilitySealed: cleanup,
        onBattleEnd: cleanup,
        onBattleDispose: cleanup
      };
    }
  };

  registerBall(liuFuQiDefinition);
  return { liuFuQiDefinition };
});
