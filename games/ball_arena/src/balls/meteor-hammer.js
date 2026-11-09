(function initializeMeteorHammer(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js") }
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createMeteorHammerPlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact }) {
  const HANDLE_LENGTH = 10;
  const HANDLE_WIDTH = 4;
  const CHAIN_LENGTH = 40;
  const CHAIN_JOINTS = 9;
  const HEAD_RADIUS = 10;
  const WAIT = 4;
  const WINDUP = 1;
  const OMEGA = Math.PI;
  const THROW_SPEED = 300;
  const DECELERATION = 300;
  const STEP = 1 / 240;
  const EPSILON = 1e-8;
  // Two handle endpoints, nine free chain joints, chain end, head center.
  const LENGTHS = [HANDLE_LENGTH, ...Array(CHAIN_JOINTS + 1).fill(CHAIN_LENGTH / (CHAIN_JOINTS + 1)), HEAD_RADIUS];
  const REACH = HANDLE_LENGTH + CHAIN_LENGTH + HEAD_RADIUS;
  const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  const arenaOf = (game) => game && Number.isFinite(game.arenaSize) && game.arenaSize > 0
    ? resolveArenaGeometry(game) : null;

  function chainFitsArena(ball, arena, a) {
    const reach = ball.radius + REACH;
    const x = ball.x + Math.cos(a) * reach;
    const y = ball.y + Math.sin(a) * reach;
    return resolveArenaGeometry(arena).contains(x, y, HEAD_RADIUS);
  }

  // Spawn/respawn along the nearest direction whose straight chain stays on the field.
  function fittingAngle(ball, arena, preferred) {
    if (chainFitsArena(ball, arena, preferred)) return preferred;
    for (let step = 1; step <= 12; step += 1) {
      const drift = step * Math.PI / 12;
      if (chainFitsArena(ball, arena, preferred + drift)) return preferred + drift;
      if (chainFitsArena(ball, arena, preferred - drift)) return preferred - drift;
    }
    return preferred;
  }

  function closest(a, b, target) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = clamp(((target.x - a.x) * dx + (target.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return { x: a.x + dx * t, y: a.y + dy * t };
  }

  function drawWeapon(points, ctx) {
    ctx.save();
    ctx.lineCap = "round";
    const grip = points[0];
    const end = points[1];
    ctx.save();
    ctx.translate(grip.x, grip.y);
    ctx.rotate(Math.atan2(end.y - grip.y, end.x - grip.x));
    ctx.fillStyle = "#79502e";
    ctx.fillRect(0, -HANDLE_WIDTH / 2, HANDLE_LENGTH, HANDLE_WIDTH);
    ctx.strokeStyle = "#bc8951";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(1, -0.8);
    ctx.lineTo(9, -0.6);
    ctx.moveTo(2, 0.9);
    ctx.lineTo(8, 0.6);
    ctx.stroke();
    ctx.restore();
    for (let i = 1; i <= CHAIN_JOINTS + 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      ctx.save();
      ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      ctx.strokeStyle = "#343b40";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.4, i % 2 ? 1.5 : 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "#a2abb0";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.ellipse(0, -0.2, 2.2, i % 2 ? 1.3 : 0.6, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const head = points.at(-1);
    ctx.fillStyle = "#50585e";
    ctx.strokeStyle = "#24292d";
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Spikes remain inside the specified twenty-unit collision diameter.
    for (let i = 0; i < 24; i += 1) {
      const angle = i * Math.PI / 12;
      const radius = i % 3 === 0 ? HEAD_RADIUS : 7.6;
      const x = head.x + Math.cos(angle) * radius;
      const y = head.y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#a0a9ae";
    ctx.beginPath();
    ctx.arc(head.x - 0.5, head.y - 0.5, 6, Math.PI, Math.PI * 1.65);
    ctx.stroke();
    ctx.fillStyle = "#343b40";
    for (let i = 0; i < 7; i += 1) {
      const angle = i * 2.4;
      ctx.fillRect(head.x + Math.cos(angle) * 4.8, head.y + Math.sin(angle) * 4.8, 0.7, 0.7);
    }
    ctx.restore();
  }

  const meteorHammerDefinition = {
    id: "meteor-hammer",
    name: "流星锤",
    englishName: "Meteor Hammer",
    color: "#0066ff",
    rosterType: "normal",
    description: "铁链流星锤 / 旋转3伤 / 投掷10伤 / 木柄末端拾取",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 7,
    createBehavior(services) {
      let owner;
      let weapon;
      let points = [];
      let phase = "held";
      let elapsed = 0;
      let angle = 0;
      let simulatedAngle = 0;
      let previousStep = STEP;
      let speed = 0;
      let launchPending = false;
      let contacts = new Set();

      function initialize(ball, arena) {
        owner = ball;
        if (Boolean(arena)) angle = fittingAngle(ball, arena, angle);
        simulatedAngle = angle;
        let distance = ball.radius;
        points = Array.from({ length: LENGTHS.length + 1 }, (_, index) => {
          if (index > 0) distance += LENGTHS[index - 1];
          const x = ball.x + Math.cos(angle) * distance;
          const y = ball.y + Math.sin(angle) * distance;
          return { x, y, px: x, py: y };
        });
        if (Boolean(arena)) {
          points.forEach((point, index) => {
            const radius = index === points.length - 1 ? HEAD_RADIUS : 2;
            Object.assign(point, resolveArenaGeometry(arena).clampPoint(point.x, point.y, radius));
            point.px = point.x;
            point.py = point.y;
          });
        }
        contacts.clear();
      }

      function pin(a) {
        for (let i = 0; i < 2; i += 1) {
          const distance = owner.radius + i * HANDLE_LENGTH;
          points[i].x = owner.x + Math.cos(a) * distance;
          points[i].y = owner.y + Math.sin(a) * distance;
        }
      }

      function solve(held, a, arena) {
        for (let iteration = 0; iteration < 24; iteration += 1) {
          if (held) pin(a);
          for (let i = 0; i < LENGTHS.length; i += 1) {
            const left = points[i];
            const right = points[i + 1];
            const dx = right.x - left.x;
            const dy = right.y - left.y;
            const distance = Math.hypot(dx, dy) || 1;
            const correction = (distance - LENGTHS[i]) / distance;
            const leftWeight = held && i < 2 ? 0 : 1;
            const rightWeight = held && i + 1 < 2 ? 0 : 1;
            const total = leftWeight + rightWeight;
            if (total === 0) continue;
            left.x += dx * correction * leftWeight / total;
            left.y += dy * correction * leftWeight / total;
            right.x -= dx * correction * rightWeight / total;
            right.y -= dy * correction * rightWeight / total;
          }
          points.forEach((p, index) => {
            if (held && index < 2) return;
            const radius = index === points.length - 1 ? HEAD_RADIUS : 2;
            Object.assign(p, resolveArenaGeometry(arena).clampPoint(p.x, p.y, radius));
          });
        }
        if (held) pin(a);
      }

      function launch() {
        weapon.services.playSound("ability", { cue: "throw" });
        phase = "flying";
        elapsed = 0;
        speed = THROW_SPEED;
        previousStep = STEP;
        const vx = -Math.sin(angle) * speed;
        const vy = Math.cos(angle) * speed;
        for (const p of points) {
          p.px = p.x - vx * STEP;
          p.py = p.y - vy * STEP;
        }
        weapon.attachedToOwner = false;
        weapon.lifecycle = "independent";
        launchPending = false;
      }

      function pickup() {
        weapon.services.playSound("ability", { cue: "block", intensity: 0.6 });
        phase = "held";
        elapsed = 0;
        angle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
        simulatedAngle = angle;
        previousStep = STEP;
        contacts.clear();
        weapon.attachedToOwner = true;
        weapon.lifecycle = "owner-bound";
        const dx = owner.x + Math.cos(angle) * owner.radius - points[0].x;
        const dy = owner.y + Math.sin(angle) * owner.radius - points[0].y;
        for (const p of points) {
          p.x += dx;
          p.y += dy;
          p.px = p.x;
          p.py = p.y;
        }
      }

      function collide(context, previous, damage) {
        const hooks = context.services;
        const next = new Set();
        const visited = new Set();
        function visit(target) {
          if (visited.has(target.instanceId) || target.hp <= 0) return;
          visited.add(target.instanceId);
          if (target === owner && phase !== "resting") return;
          const profile = hooks.getContactProfile(target);
          if (!profile.solid && !profile.attackable) return;
          const head = points.at(-1);
          const priorHead = previous.at(-1);
          const headTouch = Math.hypot(head.x - target.x, head.y - target.y) <= HEAD_RADIUS + target.radius;
          const swept = firstSegmentCircleContact(priorHead.x, priorHead.y, head.x, head.y, target.x, target.y, HEAD_RADIUS + target.radius) !== null;
          let touch = headTouch;
          let nearest = head;
          let radius = HEAD_RADIUS;
          for (let i = 0; i < points.length - 2; i += 1) {
            const point = closest(points[i], points[i + 1], target);
            const partRadius = i === 0 ? HANDLE_WIDTH / 2 : 1.5;
            if (Math.hypot(point.x - target.x, point.y - target.y) <= target.radius + partRadius) {
              touch = true;
              if (!headTouch) { nearest = point; radius = partRadius; }
              break;
            }
          }
          const attacking = phase === "flying" ? touch || swept : headTouch || swept;
          if (attacking) next.add(target.instanceId);
          if (damage > 0 && attacking && !contacts.has(target.instanceId) && hooks.isEnemy(target)) {
            hooks.dealDamage(target, damage);
          }
          if (!touch || !profile.solid || hooks.isMovementLocked(target)) return;
          const dx = target.x - nearest.x;
          const dy = target.y - nearest.y;
          const length = Math.hypot(dx, dy);
          const nx = length > EPSILON ? dx / length : 1;
          const ny = length > EPSILON ? dy / length : 0;
          const push = Math.max(0, target.radius + radius - length);
          Object.assign(target, resolveArenaGeometry(context.game).clampPoint(target.x + nx * push, target.y + ny * push, target.radius));
          const inward = target.vx * nx + target.vy * ny;
          if (inward < 0) {
            target.vx -= 2 * inward * nx;
            target.vy -= 2 * inward * ny;
            target.storedVx = target.vx;
            target.storedVy = target.vy;
          }
        }
        hooks.forEachContactEnemy(visit);
        hooks.forEachAlly(visit);
        visit(owner);
        contacts = next;
      }

      function wielderActive() {
        return Boolean(owner && owner.hp > 0 && owner.active !== false && owner.isModeBench !== true);
      }

      function updateWeapon(context, dt) {
        if (!owner) return;
        if ((phase === "held" || phase === "windup") && !wielderActive()) {
          // A benched wielder puts the held weapon away; the next active update
          // spawns a fresh one anchored to the wielder's current position.
          contacts.clear();
          context.entity.entityActive = false;
          return;
        }
        if (phase === "resting" && wielderActive() &&
            context.services.getCapabilities(owner).canAct &&
            Math.hypot(owner.x - points[0].x, owner.y - points[0].y) <= owner.radius + HANDLE_WIDTH / 2) pickup();
        const held = phase === "held" || phase === "windup";
        let remaining = Math.max(0, dt);
        const startAngle = simulatedAngle;
        let progressed = 0;
        do {
          const step = Math.min(STEP, remaining);
          const previous = points.map(p => ({ x: p.x, y: p.y }));
          const oldSpeed = speed;
          let travelScale = 1;
          if (phase === "flying" && step > 0) {
            const movingTime = Math.min(step, oldSpeed / DECELERATION);
            const travel = oldSpeed * movingTime - DECELERATION * movingTime * movingTime / 2;
            travelScale = oldSpeed > 0 ? travel / (oldSpeed * step) : 0;
            speed = Math.max(0, oldSpeed - DECELERATION * step);
          }
          if (step > 0 && phase !== "resting") {
            for (const p of points) {
              const vx = (p.x - p.px) / previousStep;
              const vy = (p.y - p.py) / previousStep;
              p.px = p.x;
              p.py = p.y;
              const damping = held ? Math.exp(-0.5 * step) : travelScale;
              p.x += vx * step * damping;
              p.y += vy * step * damping;
            }
            progressed += step;
            solve(held, dt > 0 ? startAngle + (angle - startAngle) * progressed / dt : angle, context.game);
            if (!held) {
              const velocityScale = oldSpeed > 0 ? speed / oldSpeed / Math.max(travelScale, EPSILON) : 0;
              for (const p of points) {
                p.px = p.x - (p.x - p.px) * velocityScale;
                p.py = p.y - (p.y - p.py) * velocityScale;
              }
            }
            previousStep = step;
          }
          // The stopped weapon remains solid, but never receives a final zero-speed hit.
          if (phase === "flying" && speed <= EPSILON) {
            speed = 0;
            phase = "resting";
            for (const p of points) { p.px = p.x; p.py = p.y; }
          }
          const damage = phase === "flying" ? 10 : held && context.services.getCapabilities(owner).canAct ? 3 : 0;
          collide(context, previous, damage);
          remaining -= step;
        } while (remaining > EPSILON);
        simulatedAngle = angle;
        const head = points.at(-1);
        context.entity.x = head.x;
        context.entity.y = head.y;
        if (launchPending) launch();
      }

      function ensure(ball, arena) {
        if (weapon && weapon.entityActive !== false) return;
        initialize(ball, arena);
        const head = points.at(-1);
        weapon = services.spawnCombatEntity({
          kind: "meteor-hammer-weapon", combatKind: "zone",
          life: Number.MAX_SAFE_INTEGER, lifecycle: "owner-bound",
          attachedToOwner: true, drawLayer: "background",
          x: head.x, y: head.y, radius: HEAD_RADIUS,
          update: updateWeapon,
          draw(_context, ctx) { drawWeapon(points, ctx); }
        });
      }

      return {
        onSpawn({ ball, game }) { ensure(ball, arenaOf(game)); },
        update({ ball, game }, dt) {
          owner = ball;
          ensure(ball, arenaOf(game));
          if (phase !== "held" && phase !== "windup") return;
          const before = elapsed;
          elapsed += dt;
          if (phase === "held") {
            angle += OMEGA * dt;
            if (elapsed + EPSILON >= WAIT) { phase = "windup"; elapsed = 0; }
          } else {
            angle += OMEGA * dt + Math.PI * (elapsed * elapsed - before * before);
            if (elapsed + EPSILON >= WINDUP) launchPending = true;
          }
        },
        getNextTransitionIn() {
          if (phase === "held") return Math.max(EPSILON, WAIT - elapsed);
          if (phase === "windup") return Math.max(EPSILON, WINDUP - elapsed);
          return undefined;
        },
        onAttackTransfer({ ball, previousBall }) {
          owner = ball;
          contacts.clear();
          if (phase === "held" || phase === "windup") {
            const dx = ball.x - previousBall.x;
            const dy = ball.y - previousBall.y;
            for (const p of points) { p.x += dx; p.px += dx; p.y += dy; p.py += dy; }
            if (weapon) { weapon.x = points.at(-1).x; weapon.y = points.at(-1).y; }
          }
        },
        onBorrowEnd() { if (weapon) weapon.entityActive = false; },
        getMeteorHammerState() {
          return { phase, elapsed, angle, speed, points: points.map(p => ({ x: p.x, y: p.y })) };
        }
      };
    }
  };
  registerBall(meteorHammerDefinition);
  return { meteorHammerDefinition, METEOR_HAMMER_DIMENSIONS: Object.freeze({ handleLength: HANDLE_LENGTH, handleWidth: HANDLE_WIDTH, chainLength: CHAIN_LENGTH, chainJoints: CHAIN_JOINTS, headDiameter: HEAD_RADIUS * 2 }), METEOR_HAMMER_WINDUP: WINDUP };
});
