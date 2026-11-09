(function(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js"), ...require("../core/contact-model.js") } : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  function domainWave(services, x, y, radius) {
    services.spawnVisualEffect({ kind: "pond-domain-wave", life: .8, drawLayer: "background",
      draw({ effect }, ctx) {
        const p = effect.age / effect.life;
        ctx.save(); ctx.strokeStyle = "#a6eff4";
        const alpha = ctx.globalAlpha;
        for (let i = 0; i < 3; i++) {
          const t = clamp(p * 1.35 - i * .14, 0, 1);
          ctx.globalAlpha = alpha * (1 - t) * .48;
          ctx.lineWidth = 2.5 * (1 - t) + .3;
          ctx.beginPath(); ctx.arc(x, y, 10 + radius * t, 0, TAU); ctx.stroke();
        }
        ctx.restore();
      }
    });
    services.spawnParticleBurst({ kind: "pond-domain-splash", x, y, count: 20,
      colors: ["#dcffff", "#74cfdc", "#388cbd"], minDiameter: 1, maxDiameter: 3,
      minSpeed: 25, maxSpeed: 85, life: .5, drag: 3 });
  }

  function drawPondWater(field, ctx) {
    const size = field.arenaSize, time = field.flowTime, power = field.visualSurge;
    ctx.save();
    const depth = ctx.createRadialGradient(size * .4, size * .35, 0, size * .5, size * .5, size * .75);
    depth.addColorStop(0, `rgba(35,112,137,${.35 + power * .15})`);
    depth.addColorStop(.65, "rgba(15,69,93,.48)");
    depth.addColorStop(1, "rgba(5,30,59,.65)");
    ctx.fillStyle = depth; ctx.fillRect(0, 0, size, size);
    // Distorted cells form moving underwater caustics, with no gameplay RNG.
    const cell = size / 7;
    for (let row = -1; row < 8; row++) for (let col = -1; col < 8; col++) {
      const phase = row * 2.3 + col * 1.7;
      const cx = (col + .5) * cell + Math.sin(time * .4 + row) * cell * .23;
      const cy = (row + .5) * cell + Math.cos(time * .32 + col) * cell * .22;
      const alpha = .035 + (Math.sin(time + phase) + 1) * .018 + power * .025;
      ctx.beginPath();
      // Midpoint curves keep refracted highlights rounded, without tile-like corners.
      const points = [];
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU, r = cell * (.58 + .13 * Math.sin(phase + a * 2 + time));
        points.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * .8 });
      }
      ctx.moveTo((points[7].x + points[0].x) / 2, (points[7].y + points[0].y) / 2);
      for (let i = 0; i < 8; i++) {
        const p = points[i], next = points[(i + 1) % 8];
        ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
      }
      ctx.closePath(); ctx.strokeStyle = `rgba(92,209,215,${alpha * .35})`;
      ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = `rgba(142,233,229,${alpha})`;
      ctx.lineWidth = .55 + power * .25; ctx.stroke();
    }
    // Broken spiral streams make the active domain readable across the arena.
    if (power > .01) {
      ctx.translate(size / 2, size / 2);
      for (let arm = 0; arm < 7; arm++) {
        ctx.beginPath();
        for (let step = 0; step <= 28; step++) {
          const t = step / 28, r = 22 + t * size * .6;
          const a = arm / 7 * TAU + time * .7 + t * 2;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (!step) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(108,218,235,${power * .16})`; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = `rgba(211,255,255,${power * .34})`; ctx.lineWidth = .65; ctx.stroke();
      }
    }
    ctx.restore();
  }

  function ripple(services, x, y, color = "#a3e6ef") {
    services.spawnVisualEffect({ kind: "pond-ripple", x, y, life: 0.7,
      draw({ effect }, ctx) {
        ctx.save(); ctx.globalAlpha *= (1 - effect.age / effect.life) * 0.45;
        ctx.strokeStyle = color; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.ellipse(x, y, 2 + effect.age * 17, 1 + effect.age * 9, 0, 0, TAU);
        ctx.stroke(); ctx.restore();
      }
    });
  }

  function createPondBait(ball, x, y) {
    return { kind: "pond-bait", life: 4, x: ball.x, y: ball.y,
      fromX: ball.x, fromY: ball.y, targetX: x, targetY: y, landed: false,
      update({ entity, services }) {
        const t = Math.min(1, entity.age / 0.28);
        entity.x = entity.fromX + (entity.targetX - entity.fromX) * t;
        entity.y = entity.fromY + (entity.targetY - entity.fromY) * t;
        if (t === 1 && !entity.landed) {
          entity.landed = true; ripple(services, entity.x, entity.y);
          services.spawnParticleBurst({ kind: "pond-bait-splash", x: entity.x, y: entity.y, count: 6,
            colors: ["#d5f8f3", "#78c3d5"], minDiameter: .6, maxDiameter: 1.5,
            minSpeed: 5, maxSpeed: 17, life: .3, drag: 3 });
        }
      },
      draw({ entity }, ctx) {
        const t = Math.min(1, entity.age / 0.28);
        ctx.save(); ctx.fillStyle = "#d4ac62";
        ctx.beginPath(); ctx.arc(entity.x, entity.y - Math.sin(t * Math.PI) * 20, 1.5, 0, TAU);
        ctx.fill(); ctx.restore();
      }
    };
  }

  function drawKoi({ entity: fish }, ctx) {
    const length = fish.length;
    const bend = t => Math.sin(fish.swimPhase - t * 3.8) * length * .115 * t * t;
    const tail = bend(1);
    ctx.save(); ctx.translate(fish.x, fish.y); ctx.rotate(fish.angle);
    ctx.save(); ctx.translate(1.5, 2.3); ctx.fillStyle = "rgba(0,20,38,.28)";
    ctx.beginPath(); ctx.ellipse(0, 0, length * .4, length * .13, 0, 0, TAU); ctx.fill(); ctx.restore();
    // Translucent fins and a forked tail flex behind the body.
    ctx.fillStyle = fish.red ? "rgba(240,130,110,0.65)" : "rgba(224,241,245,0.7)";
    ctx.beginPath(); ctx.moveTo(-length * 0.35, tail);
    ctx.lineTo(-length * 0.5, tail - length * 0.12);
    ctx.quadraticCurveTo(-length * 0.42, tail, -length * 0.5, tail + length * 0.12);
    ctx.closePath(); ctx.fill();
    for (const sign of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(length * 0.13, sign * length * 0.065);
      ctx.quadraticCurveTo(-length * 0.04, sign * length * 0.26, -length * 0.12, sign * length * 0.085);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = fish.red ? "rgba(250,196,155,.38)" : "rgba(255,255,246,.5)";
      ctx.lineWidth = .25;
      for (let ray = 0; ray < 4; ray++) {
        ctx.beginPath(); ctx.moveTo(length * .1, sign * length * .065);
        ctx.lineTo(length * (-.1 + ray * .035), sign * length * (.11 + ray * .018)); ctx.stroke();
      }
    }
    ctx.beginPath();
    for (const side of [-1, 1]) for (let i = 0; i <= 16; i++) {
      const t = side === -1 ? i / 16 : 1 - i / 16;
      const width = length * (.014 + .115 * Math.pow(Math.sin(Math.PI * t), .8) * (1.15 - .6 * t));
      const x = length * (.49 - .86 * t), y = bend(t) + width * side;
      if (side === -1 && !i) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    const sheen = ctx.createLinearGradient(0, -length * .14, 0, length * .14);
    sheen.addColorStop(0, fish.red ? "#813835" : "#8ea7ae");
    sheen.addColorStop(.32, fish.red ? "#ef8060" : "#fffdeb");
    sheen.addColorStop(.58, fish.red ? "#cc4b43" : "#dde8df");
    sheen.addColorStop(1, fish.red ? "#8d343e" : "#9bbabd");
    ctx.fillStyle = sheen; ctx.fill();
    ctx.strokeStyle = fish.red ? "#9d3c3b" : "#aac8c5"; ctx.lineWidth = 0.4; ctx.stroke();
    ctx.save(); ctx.clip(); ctx.lineWidth = .25;
    ctx.strokeStyle = fish.red ? "rgba(255,201,149,.35)" : "rgba(89,138,154,.3)";
    for (let row = 0; row < 7; row++) {
      const t = .22 + row * .09, x = length * (.49 - .86 * t), y = bend(t);
      for (let col = -2; col <= 2; col++) {
        ctx.beginPath(); ctx.arc(x + (col % 2) * length * .025, y + col * length * .04,
          length * .038, -.8, .8); ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = fish.red ? "#943e3b" : "#8aa6a6"; ctx.lineWidth = .5;
    for (const sign of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(length * .29, sign * length * .028);
      ctx.quadraticCurveTo(length * .19, sign * length * .06, length * .24, sign * length * .1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(length * .46, sign * length * .02);
      ctx.quadraticCurveTo(length * .51, sign * length * .07, length * .43, sign * length * .09); ctx.stroke();
    }
    ctx.strokeStyle = fish.red ? "rgba(255,183,139,.65)" : "rgba(255,255,255,.85)";
    ctx.beginPath(); ctx.moveTo(length * 0.36, -length * 0.025);
    ctx.quadraticCurveTo(0, -length * 0.06, -length * 0.23, tail * 0.2); ctx.stroke();
    ctx.fillStyle = "#25393b";
    for (const sign of [-1, 1]) {
      ctx.beginPath(); ctx.arc(length * 0.32, sign * length * 0.055, 0.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function createPondKoi(owner, field, options = {}) {
    const size = field.arenaSize;
    const length = options.length == null ? 25 + Math.random() * 15 : options.length;
    const entryEdge = Math.floor(Math.random() * 4);
    const entryOffset = size * (0.15 + Math.random() * 0.7);
    const exitOffset = size * (0.15 + Math.random() * 0.7);
    const outside = length / 2 + 2;
    const edgePoint = (edge, offset, inset) => [
      { x: inset, y: offset }, { x: offset, y: inset },
      { x: size - inset, y: offset }, { x: offset, y: size - inset }
    ][edge];
    const start = edgePoint(entryEdge, entryOffset, -outside);
    const entryPoint = edgePoint(entryEdge, entryOffset, length * 0.7);
    const exitPoint = edgePoint((entryEdge + 2) % 4, exitOffset, -length);
    const angle = options.angle == null ? Math.atan2(entryPoint.y - start.y, entryPoint.x - start.x) : options.angle;
    const baseSpeed = options.speed == null ? 22 + Math.random() * 16 : options.speed;
    if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(length) || length <= 0 || length > size ||
        !Number.isFinite(angle) || !Number.isFinite(baseSpeed) || baseSpeed <= 0 ||
        (options.x !== undefined && !Number.isFinite(options.x)) ||
        (options.y !== undefined && !Number.isFinite(options.y)) ||
        (options.red !== undefined && typeof options.red !== "boolean")) throw new TypeError("Invalid pond koi parameters");
    return { kind: "pond-koi", life: 1e9, drawLayer: "background",
      x: options.x == null ? start.x : options.x, y: options.y == null ? start.y : options.y,
      phase: options.x !== undefined && options.y !== undefined ? "cruising" : "entering",
      entryPoint, exitPoint, cruiseTime: 0, cruiseDuration: 4 + Math.random() * 4,
      red: options.red == null ? Math.random() < 0.2 : options.red, length, angle, baseSpeed, speed: baseSpeed,
      wanderAngle: angle, turnTimer: 0, swimPhase: Math.random() * TAU, wakeTime: 0, contacts: new Set(),
      update({ entity: fish, services }, dt) {
        const strong = field.surge;
        const oldX = fish.x, oldY = fish.y;
        if (fish.phase === "entering" && Math.hypot(fish.x - entryPoint.x, fish.y - entryPoint.y) < 3) {
          fish.phase = "cruising";
        }
        if (fish.phase === "cruising") {
          fish.cruiseTime += dt;
          if (fish.cruiseTime >= fish.cruiseDuration) fish.phase = "exiting";
        }
        fish.turnTimer -= dt;
        if (fish.turnTimer <= 0) {
          fish.turnTimer = 0.7 + Math.random() * 0.9;
          fish.wanderAngle = fish.angle + (Math.random() - 0.5) * 1.6;
        }
        let desired = fish.wanderAngle;
        let nearest = null, distance = 85;
        for (const bait of fish.phase === "cruising" ? field.baits : []) {
          if (bait.entityActive === false || !bait.landed) continue;
          const d = Math.hypot(bait.x - fish.x, bait.y - fish.y);
          if (d < distance) { nearest = bait; distance = d; }
        }
        if (nearest) {
          desired = Math.atan2(nearest.y - fish.y, nearest.x - fish.x);
          if (distance < length * 0.3) { nearest.entityActive = false; ripple(services, nearest.x, nearest.y); }
        } else if (strong && fish.phase === "cruising") {
          const current = Math.atan2(fish.y - size / 2, fish.x - size / 2) + Math.PI / 2;
          desired += wrap(current - desired) * 0.55;
        }
        const margin = length * 0.6 + 9;
        let wallX = 0, wallY = 0;
        if (fish.x < margin) wallX += (margin - fish.x) / margin;
        if (fish.x > size - margin) wallX -= (fish.x - size + margin) / margin;
        if (fish.y < margin) wallY += (margin - fish.y) / margin;
        if (fish.y > size - margin) wallY -= (fish.y - size + margin) / margin;
        if (fish.phase === "cruising") {
          if (wallX || wallY) desired = Math.atan2(Math.sin(desired) + wallY * 6, Math.cos(desired) + wallX * 6);
        } else {
          const destination = fish.phase === "entering" ? entryPoint : exitPoint;
          desired = Math.atan2(destination.y - fish.y, destination.x - fish.x);
        }
        fish.angle += clamp(wrap(desired - fish.angle), -2.7 * dt, 2.7 * dt);
        const targetSpeed = baseSpeed * (strong ? 2.8 : nearest ? 1.35 : 1);
        fish.speed += (targetSpeed - fish.speed) * (1 - Math.exp(-dt * 3));
        fish.x += Math.cos(fish.angle) * fish.speed * dt;
        fish.y += Math.sin(fish.angle) * fish.speed * dt;
        if (fish.phase === "cruising") {
          fish.x = clamp(fish.x, length / 2, size - length / 2);
          fish.y = clamp(fish.y, length / 2, size - length / 2);
        }
        if (fish.phase === "exiting" && (fish.x < -outside || fish.y < -outside ||
            fish.x > size + outside || fish.y > size + outside)) {
          fish.contacts.clear(); fish.entityActive = false; return;
        }
        fish.swimPhase += dt * (6 + fish.speed * 0.12);
        fish.wakeTime += dt;
        if (fish.wakeTime >= (strong ? .2 : .45) && fish.x > 0 && fish.y > 0 && fish.x < size && fish.y < size) {
          fish.wakeTime = 0;
          services.spawnParticleBurst({ kind: "pond-koi-wake", x: fish.x - Math.cos(fish.angle) * length * .4,
            y: fish.y - Math.sin(fish.angle) * length * .4, count: 2,
            colors: ["#76afba", "#b7e1dd"], minDiameter: .4, maxDiameter: 1,
            minSpeed: 1, maxSpeed: 4, life: .45, drag: 2 });
        }
        const contacts = new Set();
        function touches(target) {
          const half = length * 0.32, radius = target.radius + length * 0.105;
          const dx = Math.cos(fish.angle) * half, dy = Math.sin(fish.angle) * half;
          return firstSegmentCircleContact(fish.x - dx, fish.y - dy, fish.x + dx, fish.y + dy,
            target.x, target.y, radius) !== null ||
            firstSegmentCircleContact(oldX - (target.prevX == null ? target.x : target.prevX), oldY - (target.prevY == null ? target.y : target.prevY),
              fish.x - target.x, fish.y - target.y, 0, 0, radius) !== null;
        }
        services.forEachEnemy(target => {
          if (!touches(target)) return;
          contacts.add(target.instanceId);
          if (!fish.contacts.has(target.instanceId)) services.dealDamage(target, fish.red ? 1 : (strong ? 3 : 2));
        });
        const body = services.getBall(services.source.credit.instanceId);
        if (fish.red && body && body.hp > 0 && touches(body)) {
          contacts.add(body.instanceId);
          if (!fish.contacts.has(body.instanceId)) {
            const previousHp = body.hp;
            body.hp = Math.min(body.maxHp, body.hp + 1);
            if (body.hp > previousHp) services.spawnHitText(body, "+1", { color: "#35e878" });
            ripple(services, body.x, body.y, "#93e8b1");
          }
        }
        fish.contacts = contacts;
      }, draw: drawKoi
    };
  }

  const pondDefinition = {
    id: "pond", name: "池塘", englishName: "Pond", color: "#123969",
    description: "每秒生成鲤鱼 / 红白概率1:4 / 领域收回后冷却6.7秒 / 中心领域2秒 / 投饵与急流 / 红鲤回复1血",
    stats: { radius: 15, speed: 150, maxHp: 100 }, rionCycleDuration: 8,
    createBehavior(services) {
      let field = null, water = null, fishTimer = 0, domainTimer = 0, phase = "normal", phaseTime = 0;
      let origin = null, velocity = null, baitTimer = 0, fish = [];
      let lockedBody = null, previousPositionLocked = false;
      let trail = null;
      function startTrail(ball) {
        if (trail) trail.end(true);
        trail = services.spawnAfterimageTrail({ kind: "pond-domain-trail", color: "#8cddec",
          sampleLife: .32, maxAlpha: .55, widthRatio: .75, sampleInterval: .018,
          maxSamples: 24, minScale: .2 }, { lifecycle: "owner-bound" });
        trail.emit(ball.x, ball.y, ball.radius);
      }
      function initialize({ game }) {
        field = { arenaSize: game.arenaSize, surge: false, baits: [], flowTime: 0, visualSurge: 0 };
        water = services.spawnCombatEntity({ kind: "pond-water", life: 1e9, lifecycle: "owner-bound", drawLayer: "background",
          update({ services: fieldServices }, dt) {
            // World-timed presentation, independent of the caster's attack clock.
            field.visualSurge += ((field.surge ? 1 : 0) - field.visualSurge) * (1 - Math.exp(-dt * 7));
            field.flowTime += dt * (1 + field.visualSurge * 2);
            fishTimer += dt;
            while (fishTimer + 1e-9 >= 1) {
              fishTimer -= 1;
              fish.push(fieldServices.spawnCombatEntity(createPondKoi(fieldServices.source.credit, field)));
            }
            field.baits = field.baits.filter(b => b.entityActive !== false && b.age < b.life);
            fish = fish.filter(f => f.entityActive !== false);
          },
          draw(_context, ctx) { drawPondWater(field, ctx); }
        });
      }
      function unlockBody() {
        if (lockedBody) {
          lockedBody.positionLocked = previousPositionLocked;
          if (velocity) {
            lockedBody.vx = lockedBody.storedVx = velocity.x;
            lockedBody.vy = lockedBody.storedVy = velocity.y;
          }
          lockedBody = null;
        }
      }
      function lockBody(ball) {
        lockedBody = ball; previousPositionLocked = ball.positionLocked === true;
        velocity = { x: ball.storedVx || ball.vx, y: ball.storedVy || ball.vy };
        ball.positionLocked = true;
      }
      function release() {
        unlockBody();
        if (trail) trail.end();
        // Cooldown is action time spent outside the domain, including neither transfer.
        domainTimer = 0; phaseTime = 0;
        phase = "normal"; if (field) field.surge = false;
      }
      function cleanup(context) {
        release(context);
        if (trail) trail.end(true);
        trail = null;
        if (water) water.entityActive = false;
        for (const item of fish.concat(field ? field.baits : [])) item.entityActive = false;
        fish = []; field = null; water = null;
      }
      return {
        onSpawn: initialize,
        update(context, dt) {
          if (!field) initialize(context);
          const { ball, game } = context;
          if (phase === "normal") domainTimer += dt;
          if (phase === "normal" && domainTimer + 1e-9 >= 6.7) {
            domainTimer -= 6.7; phase = "enter"; phaseTime = 0;
            origin = { x: ball.x, y: ball.y };
            lockBody(ball);
            startTrail(ball);
            domainWave(services, ball.x, ball.y, 48);
            services.playSound("summon");
          } else if (phase !== "normal") {
            phaseTime += dt;
            if (phase === "enter" || phase === "exit") {
              const oldX = ball.x, oldY = ball.y;
              const p = clamp(phaseTime / 0.55, 0, 1), smooth = p * p * (3 - 2 * p);
              const t = phase === "enter" ? smooth : 1 - smooth;
              ball.x = origin.x + (game.arenaSize / 2 - origin.x) * t;
              ball.y = origin.y + (game.arenaSize / 2 - origin.y) * t;
              if (trail) trail.emit(ball.x, ball.y, ball.radius, {
                speed: dt > 0 ? Math.hypot(ball.x - oldX, ball.y - oldY) / dt : 0,
                heading: Math.atan2(ball.y - oldY, ball.x - oldX) });
              if (p === 1) {
                if (phase === "enter") {
                  phase = "domain"; phaseTime = 0; baitTimer = 0; field.surge = true;
                  if (trail) trail.end();
                  domainWave(services, ball.x, ball.y, game.arenaSize * .65);
                } else {
                  ripple(services, ball.x, ball.y);
                  release();
                }
              }
            } else {
              baitTimer += dt;
              if (baitTimer + 1e-9 >= 0.35) {
                baitTimer -= 0.35;
                const margin = 12;
                const point = resolveArenaGeometry(game).samplePoint(Math.random, margin);
                field.baits.push(services.spawnCombatEntity(createPondBait(ball, point.x, point.y)));
              }
              if (phaseTime + 1e-9 >= 2) {
                phase = "exit"; phaseTime = 0; field.surge = false;
                startTrail(ball); domainWave(services, ball.x, ball.y, 48);
              }
            }
          }
        },
        getNextTransitionIn() {
          return Math.max(1e-9,
            phase === "normal" ? 6.7 - domainTimer : phase === "domain" ? Math.min(2 - phaseTime, 0.35 - baitTimer) : 0.55 - phaseTime);
        },
        getContactProfile() { return phase === "normal" ? { solid: true, attackable: true } : { solid: false, attackable: false }; },
        getCapabilityOverrides() { return phase === "normal" ? null : { canAct: true, canMove: false }; },
        onBeforeDamage(context, event) { return phase === "normal" ? event : { ...event, amount: 0, showHitText: false }; },
        drawBefore({ ball }, ctx) {
          if (phase === "normal") return;
          ctx.save(); ctx.translate(ball.x, ball.y);
          const time = field.flowTime;
          for (let i = 0; i < 3; i++) {
            const angle = time * (i % 2 ? -1.5 : 1) + i * 2.1;
            ctx.strokeStyle = i === 0 ? "#c9ffff" : "rgba(112,223,240,.65)";
            ctx.lineWidth = i === 0 ? 1.5 : .8;
            ctx.beginPath(); ctx.arc(0, 0, ball.radius + 5 + i * 4, angle, angle + Math.PI * 1.3); ctx.stroke();
          }
          ctx.restore();
        },
        onDeath() { release(); if (trail) trail.end(true); },
        onAbilitySealed() { release(); if (trail) trail.end(true); },
        onBorrowEnd: cleanup, onBattleDispose: cleanup,
        onAttackTransfer({ ball, game }) {
          // Live borrowing preserves the fish, current phase and all timers.
          unlockBody();
          if (trail) trail.end(true);
          trail = null;
          if (phase !== "normal") {
            origin = { x: ball.x, y: ball.y }; lockBody(ball);
            if (phase === "domain") ball.x = ball.y = game.arenaSize / 2;
            else startTrail(ball);
          }
        },
        getPondState() { return { phase, phaseTime, cooldownRemaining: 6.7 - domainTimer, fish, field }; }
      };
    }
  };
  registerBall(pondDefinition);
  return { pondDefinition, createPondKoi, createPondBait };
});
