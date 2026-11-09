(function initializeManhole(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"),
      require("../core/contact-model.js"), require("../core/visual-properties.js"))
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createManholePlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact,
  createVisualPropertyAnimation }) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;
  const RULES = Object.freeze({ fade: 0.6, entry: 0.3, burrow: 2, jump: 0.8, height: 200,
    cooldown: 5, blastRadius: 75, blastDamage: 20, mudMin: 10, mudMax: 20,
    mudMinDiameter: 5, mudMaxDiameter: 20, mudLife: 5, mudDamage: 1,
    slow: 0.75, adhesion: 0.25 });
  const HIDDEN = Object.freeze({ solid: false, attackable: false });
  const VISIBLE = Object.freeze({ solid: true, attackable: true });
  const SMOKE_PROPERTIES = Object.freeze({
    color: { overLife: [{ at: 0, value: "#ffffff" }, { at: 0.24, value: "#e1e4e6" },
      { at: 1, value: "#777d82" }] },
    opacity: { overLife: [{ at: 0, value: 1 }, { at: 0.48, value: 0.5 },
      { at: 1, value: 0 }] },
    sizeScale: { overLife: [{ at: 0, value: 0.35 }, { at: 0.35, value: 1 },
      { at: 1, value: 1.6 }] }
  });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const liftAt = (progress, height) => 4 * height * clamp(progress, 0, 1) *
    (1 - clamp(progress, 0, 1));

  function paintMud(context, x, y, radius, seed = 0) {
    context.beginPath();
    for (let i = 0; i <= 32; i += 1) {
      const angle = i / 32 * TAU;
      const r = radius * (0.86 + 0.09 * Math.cos(angle * 5 + seed) +
        0.05 * Math.sin(angle * 3 - seed));
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fillStyle = "#615246";
    context.fill();
    context.strokeStyle = "#403c37";
    context.lineWidth = 0.45;
    context.stroke();
    context.fillStyle = "#a6957d";
    context.beginPath();
    context.ellipse(x - radius * 0.22, y - radius * 0.24,
      radius * 0.32, radius * 0.12, -0.4, 0, TAU);
    context.fill();
  }

  function createManholeSmoke({ x, y, random, eruption = true }) {
    const count = eruption ? 30 : 4;
    const animation = createVisualPropertyAnimation({
      color: { type: "color" }, opacity: { type: "number", min: 0, max: 1 },
      sizeScale: { type: "number", min: 0 }
    }, { properties: SMOKE_PROPERTIES });
    const particles = Array.from({ length: count }, (_, i) => {
      const angle = i / count * TAU + random() * 0.3;
      const speed = eruption ? 28 + random() * 90 : 6 + random() * 12;
      return { x: x + Math.cos(angle) * (eruption ? 3 : 10),
        y: y + Math.sin(angle) * (eruption ? 3 : 10),
        vx: Math.cos(angle) * speed, vy: eruption ? Math.sin(angle) * speed : -speed,
        radius: eruption ? 7 + random() * 7 : 2 + random() * 3 };
    });
    return {
      kind: eruption ? "manhole-explosion-smoke" : "manhole-steam",
      x, y, life: eruption ? 1.05 : 0.55, particles, drawLayer: "foreground",
      update({ effect }, dt) {
        for (const particle of effect.particles) {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          const drag = Math.exp(-2 * dt);
          particle.vx *= drag;
          particle.vy *= drag;
        }
      },
      draw({ effect }, context) {
        const appearance = animation.sample(effect.age / effect.life);
        context.save();
        context.globalAlpha *= appearance.opacity;
        for (const particle of effect.particles) {
          const radius = particle.radius * appearance.sizeScale;
          const gradient = context.createRadialGradient(particle.x, particle.y, 0,
            particle.x, particle.y, radius);
          gradient.addColorStop(0, appearance.color);
          gradient.addColorStop(0.58, appearance.color);
          gradient.addColorStop(1, "rgba(119,125,130,0)");
          context.fillStyle = gradient;
          context.beginPath();
          context.arc(particle.x, particle.y, radius, 0, TAU);
          context.fill();
        }
        context.restore();
      }
    };
  }

  function createMudCoating(radius, angle) {
    return {
      id: "manhole-mud", duration: RULES.adhesion, speedFactor: RULES.slow,
      onApply({ effect, game }) { effect.startedAt = game.time; },
      draw({ ball, effect, game }, context) {
        context.save();
        context.globalAlpha *= clamp(1 - (game.time - effect.startedAt) / RULES.adhesion, 0, 1);
        paintMud(context, ball.x + Math.cos(angle) * ball.radius * 0.7,
          ball.y + Math.sin(angle) * ball.radius * 0.7, radius, angle);
        context.restore();
      }
    };
  }

  function createManholeMud({ x, y, targetX, targetY, radius, delay, duration, height }) {
    return {
      kind: "manhole-mud", combatKind: "trap", lifecycle: "independent",
      x, y, startX: x, startY: y, targetX, targetY, radius,
      delay, duration, height, landed: false, drawLayer: "foreground",
      life: delay + duration + RULES.mudLife,
      update({ entity, services }, dt) {
        const age = entity.age + dt;
        if (age + EPSILON < entity.delay) return;
        const progress = clamp((age - entity.delay) / entity.duration, 0, 1);
        entity.x = entity.startX + (entity.targetX - entity.startX) * progress;
        entity.y = entity.startY + (entity.targetY - entity.startY) * progress;
        if (progress + EPSILON < 1) return;
        const justLanded = !entity.landed;
        entity.landed = true;
        entity.drawLayer = "background";
        let first = null;
        let earliest = Infinity;
        services.forEachEnemy((target) => {
          const startX = justLanded ? target.x : (target.prevX == null ? target.x : target.prevX);
          const startY = justLanded ? target.y : (target.prevY == null ? target.y : target.prevY);
          const progress = firstSegmentCircleContact(startX, startY, target.x, target.y,
            entity.x, entity.y, entity.radius + target.radius);
          if (progress !== null && progress < earliest) { earliest = progress; first = target; }
        });
        if (!first || !services.dealDamage(first, RULES.mudDamage)) return;
        services.applyEffect(first, createMudCoating(entity.radius,
          Math.atan2(entity.y - first.y, entity.x - first.x)));
        entity.entityActive = false;
      },
      draw({ entity }, context) {
        if (entity.age < entity.delay) return;
        const progress = clamp((entity.age - entity.delay) / entity.duration, 0, 1);
        const height = liftAt(progress, entity.height);
        context.save();
        if (!entity.landed) {
          context.globalAlpha *= 0.15;
          context.fillStyle = "#202020";
          context.beginPath();
          context.ellipse(entity.x, entity.y, entity.radius * 0.8,
            entity.radius * 0.35, 0, 0, TAU);
          context.fill();
          context.globalAlpha /= 0.15;
        }
        const fade = clamp((entity.life - entity.age) / 0.35, 0, 1);
        context.globalAlpha *= fade;
        const pop = entity.landed ? clamp(0.7 + (entity.age - entity.delay -
          entity.duration) * 3, 0.7, 1) : 0.8;
        paintMud(context, entity.x, entity.y - height, entity.radius * pop, entity.radius);
        context.restore();
      }
    };
  }

  function drawCover({ entity }, context) {
    const radius = entity.radius;
    const charge = clamp(entity.charge || 0, 0, 1);
    const strength = charge * charge * 2.3;
    const entry = clamp(entity.entryProgress === undefined ? 1 : entity.entryProgress, 0, 1);
    const lift = Math.sin(Math.PI * entry);
    const shakeX = Math.sin(entity.age * 89) * strength;
    const shakeY = Math.cos(entity.age * 113) * strength * 0.6;

    function disc(r, fill) {
      context.fillStyle = fill;
      context.beginPath();
      context.arc(0, 0, r, 0, TAU);
      context.fill();
    }
    function ring(r, color, width, start = 0, end = TAU) {
      context.strokeStyle = color;
      context.lineWidth = width;
      context.beginPath();
      context.arc(0, 0, r, start, end);
      context.stroke();
    }
    function metal(light, mid, dark) {
      const gradient = context.createLinearGradient(-0.8, -0.95, 0.75, 0.9);
      gradient.addColorStop(0, light);
      gradient.addColorStop(0.4, mid);
      gradient.addColorStop(1, dark);
      return gradient;
    }

    context.save();
    context.globalAlpha *= clamp(entity.age / RULES.fade, 0, 1);
    context.translate(entity.x, entity.y);
    context.scale(radius, radius);
    context.lineCap = "round";
    context.lineJoin = "round";

    // The embedded frame and dark well remain fixed as the lid briefly tilts.
    disc(1, "#202428");
    disc(0.975, metal("#82888b", "#50565a", "#2a2e31"));
    disc(0.885, "#14181b");
    ring(0.958, "#a1a5a6", 0.022, Math.PI * 1.04, Math.PI * 1.73);
    ring(0.934, "#292e31", 0.025);
    ring(0.868, "#080b0e", 0.052);
    if (lift > 0.001) {
      const well = context.createRadialGradient(-0.12, -0.18, 0.08, 0, 0, 0.86);
      well.addColorStop(0, "#030507");
      well.addColorStop(0.8, "#080b0d");
      well.addColorStop(1, "#252b2e");
      disc(0.85, well);
      ring(0.825, "#343a3d", 0.04, Math.PI * 0.06, Math.PI * 0.92);
    }

    context.save();
    context.translate(shakeX / radius + lift * 0.13, shakeY / radius - lift * 0.23);
    context.scale(1, 1 - lift * 0.47);
    // A narrow lower edge gives the casting real thickness without enlarging it.
    context.save();
    context.translate(0, 0.065);
    disc(0.914, "#202529");
    ring(0.891, "#353b3e", 0.035, 0.1, Math.PI - 0.1);
    context.restore();
    disc(0.914, metal("#9a9e9f", "#62686a", "#343a3e"));
    ring(0.899, "#b2b5b4", 0.023, Math.PI * 1.05, Math.PI * 1.68);
    ring(0.873, "#363c3f", 0.026);
    disc(0.839, metal("#72797b", "#50585b", "#353d40"));
    ring(0.821, "#242b2e", 0.032);
    ring(0.792, "#808789", 0.016, Math.PI * 1.04, Math.PI * 1.8);
    ring(0.778, "#353d40", 0.02);

    // Raised radial tread has a shadowed foot and a restrained upper-left bevel.
    const treadMetal = metal("#929899", "#737b7e", "#4b5457");
    function tread(angle, inner, outer, width) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      context.strokeStyle = "#2d3538";
      context.lineWidth = width + 0.025;
      context.beginPath();
      context.moveTo(dx * inner + 0.014, dy * inner + 0.025);
      context.lineTo(dx * outer + 0.014, dy * outer + 0.025);
      context.stroke();
      context.strokeStyle = treadMetal;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(dx * inner, dy * inner);
      context.lineTo(dx * outer, dy * outer);
      context.stroke();
      context.strokeStyle = "#a1a7a7";
      context.lineWidth = 0.012;
      context.beginPath();
      context.moveTo(dx * inner - 0.012, dy * inner - 0.019);
      context.lineTo(dx * outer - 0.012, dy * outer - 0.019);
      context.stroke();
    }
    for (let i = 0; i < 28; i += 1) {
      const angle = (i + 0.5) / 28 * TAU;
      if (Math.abs(Math.sin(angle)) < 0.2) continue;
      tread(angle, 0.49, 0.711, 0.035);
    }
    ring(0.433, "#30383b", 0.032);
    ring(0.413, "#858d8f", 0.014, Math.PI * 1.03, Math.PI * 1.9);
    for (let i = 0; i < 12; i += 1) tread((i + 0.5) / 12 * TAU, 0.2, 0.343, 0.032);
    disc(0.137, metal("#7d8586", "#5d6769", "#343d40"));
    ring(0.143, "#2e373a", 0.024);
    ring(0.117, "#9ba1a0", 0.015, Math.PI * 1.06, Math.PI * 1.74);

    // Opposed lifting pockets: deep, dark slots with a worn lip and inset floor.
    for (const side of [-1, 1]) {
      const x = side * 0.535;
      context.strokeStyle = "#92999a";
      context.lineWidth = 0.126;
      context.beginPath();
      context.moveTo(x - 0.095, -0.018);
      context.lineTo(x + 0.095, -0.018);
      context.stroke();
      context.strokeStyle = "#1c2326";
      context.lineWidth = 0.104;
      context.beginPath();
      context.moveTo(x - 0.09, 0.002);
      context.lineTo(x + 0.09, 0.002);
      context.stroke();
      context.strokeStyle = "#080e11";
      context.lineWidth = 0.045;
      context.beginPath();
      context.moveTo(x - 0.073, -0.01);
      context.lineTo(x + 0.073, -0.01);
      context.stroke();
    }

    // Four recessed fasteners sit in the smooth ring, away from the traction ribs.
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + i * Math.PI / 2;
      context.save();
      context.translate(Math.cos(angle) * 0.747, Math.sin(angle) * 0.747);
      disc(0.052, "#272f32");
      disc(0.034, metal("#959b9b", "#687174", "#3b4447"));
      context.strokeStyle = "#252d30";
      context.lineWidth = 0.016;
      context.beginPath();
      context.moveTo(-0.024, 0.012);
      context.lineTo(0.024, -0.012);
      context.stroke();
      context.restore();
    }
    context.restore();
    context.restore();
  }

  const manholeDefinition = {
    id: "manhole", name: "井盖", englishName: "Manhole", color: "#71777d",
    description: "钻入井盖蓄力，爆炸跃出并洒落减速泥浆。",
    rosterType: "normal", stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 10,
    createBehavior(services) {
      let owner = null;
      let cover = null;
      let phase = "waiting";
      let charge = 0;
      let steamTime = 0;
      let jumpStartedAt = null;
      let nextCoverAt = null;
      let entryOffsetX = 0;
      let entryOffsetY = 0;
      const muds = [];

      function entryProgress() { return clamp(charge / RULES.entry, 0, 1); }

      function hidden() { return phase === "underground" || phase === "airborne"; }
      function makeCover(context) {
        const radius = context.ball.radius;
        const position = resolveArenaGeometry(context.game).samplePoint(Math.random, radius);
        cover = services.spawnCombatEntity({
          kind: "manhole-cover", combatKind: "trap", lifecycle: "owner-bound",
          x: position.x, y: position.y, radius, charge: 0,
          createdAt: context.game.time, entryProgress: 1,
          life: Number.MAX_SAFE_INTEGER, drawLayer: "background", draw: drawCover,
          update({ entity }) {
            if (entity.owner && entity.owner.active === false) entity.entityActive = false;
          }
        });
        phase = "waiting";
        nextCoverAt = null;
      }

      function eruption(context) {
        const { ball, game } = context;
        const x = cover.x;
        const y = cover.y;
        cover.entityActive = false;
        cover = null;
        phase = "airborne";
        services.playSound("ability", { cue: "explosion" });
        jumpStartedAt = game.time;
        nextCoverAt = game.time + RULES.cooldown;
        services.forEachEnemy((target) => {
          if (Math.hypot(target.x - x, target.y - y) <= RULES.blastRadius + target.radius) {
            services.dealDamage(target, RULES.blastDamage, ball);
          }
        });
        services.createVisualEffect(createManholeSmoke, { x, y });
        services.spawnParticleBurst({ kind: "manhole-flash", x, y, count: 18,
          minDiameter: 1, maxDiameter: 3, minSpeed: 60, maxSpeed: 180, life: 0.25,
          properties: { color: { value: "#ffffff" }, opacity: { overLife: [
            { at: 0, value: 1 }, { at: 0.4, value: 0.5 }, { at: 1, value: 0 }] } } });
        const count = RULES.mudMin + Math.floor(Math.random() * (RULES.mudMax - RULES.mudMin + 1));
        for (let i = 0; i < count; i += 1) {
          const radius = (RULES.mudMinDiameter + Math.random() *
            (RULES.mudMaxDiameter - RULES.mudMinDiameter)) / 2;
          const landing = resolveArenaGeometry(game).samplePoint(Math.random, radius);
          muds.push(services.spawnCombatEntity(createManholeMud({ x, y, radius,
            targetX: landing.x, targetY: landing.y,
            delay: Math.random() * 0.14, duration: 0.66 + Math.random() * 0.28,
            height: 160 + Math.random() * 80 })));
        }
      }

      function syncWorld(context) {
        owner = context.ball;
        // Fresh borrowed behaviors do not receive onSpawn.
        if (!cover && phase === "waiting" && nextCoverAt === null &&
          owner.hp > 0 && owner.active !== false) makeCover(context);
        for (let i = muds.length - 1; i >= 0; i -= 1) {
          if (muds[i].entityActive === false || muds[i].age >= muds[i].life) muds.splice(i, 1);
        }
        if (cover && cover.entityActive === false) {
          cover = null;
          phase = "cooldown";
          nextCoverAt = context.game.time + RULES.cooldown;
        }
        if (phase === "airborne" && context.game.time + EPSILON >= jumpStartedAt + RULES.jump) {
          phase = "cooldown";
          jumpStartedAt = null;
        }
        if (!cover && phase !== "airborne" && nextCoverAt !== null &&
          context.game.time + EPSILON >= nextCoverAt && owner.hp > 0 && owner.active !== false) {
          makeCover(context);
        }
      }

      function advance(context, dt) {
        syncWorld(context);
        if (phase !== "underground") return;
        charge = Math.min(RULES.burrow, charge + dt);
        cover.charge = charge / RULES.burrow;
        cover.entryProgress = entryProgress();
        steamTime += dt;
        const interval = 0.18 - cover.charge * 0.13;
        if (steamTime + EPSILON >= interval) {
          steamTime = 0;
          services.createVisualEffect(createManholeSmoke,
            { x: cover.x, y: cover.y, eruption: false });
        }
      }

      function finishStep(context) {
        if (phase === "underground" && charge + EPSILON >= RULES.burrow) {
          eruption(context);
        } else if (phase === "waiting" && cover &&
          context.game.time + EPSILON >= cover.createdAt + RULES.fade &&
          !services.isMovementLocked(context.ball) && services.getCapabilities(context.ball).canAct) {
          const ball = context.ball;
          const t = firstSegmentCircleContact(ball.prevX, ball.prevY, ball.x, ball.y,
            cover.x, cover.y, ball.radius + cover.radius);
          if (t === null) return;
          entryOffsetX = ball.x - cover.x;
          entryOffsetY = ball.y - cover.y;
          ball.x = ball.prevX = cover.x;
          ball.y = ball.prevY = cover.y;
          phase = "underground";
          services.playSound("ability", { cue: "charge" });
          charge = 0;
          cover.entryProgress = 0;
          steamTime = 0;
        }
      }

      function nextTransition(context) {
        if (phase === "underground") return Math.max(EPSILON, RULES.burrow - charge);
        const now = context.game.time;
        let remaining = Infinity;
        if (cover && phase === "waiting" && cover.createdAt + RULES.fade > now + EPSILON) {
          remaining = cover.createdAt + RULES.fade - now;
        }
        if (jumpStartedAt !== null) remaining = jumpStartedAt + RULES.jump - now;
        if (nextCoverAt !== null) remaining = Math.min(remaining, nextCoverAt - now);
        return Number.isFinite(remaining)
          ? Math.max(EPSILON, remaining / services.getAttackPeriodScale()) : undefined;
      }

      function cleanup() {
        if (cover) cover.entityActive = false;
        cover = null;
        phase = "cooldown";
        charge = 0;
        entryOffsetX = entryOffsetY = 0;
        jumpStartedAt = null;
        nextCoverAt = services.getTime() + RULES.cooldown;
      }

      return {
        onSpawn: syncWorld,
        onAttackBorrowStart: syncWorld,
        beforeUpdateStep: syncWorld,
        update: advance,
        afterUpdateStep: finishStep,
        updateWhilePaused: syncWorld,
        getNextTransitionIn: nextTransition,
        getNextPausedTransitionIn(context) {
          return phase === "underground" ? undefined : nextTransition(context);
        },
        getCapabilityOverrides() { return phase === "underground" ? { canMove: false } : {}; },
        getContactProfile() { return hidden() ? HIDDEN : VISIBLE; },
        getRenderOffset(context) {
          if (phase === "underground") {
            const progress = entryProgress();
            const remaining = 1 - progress * progress * (3 - 2 * progress);
            return { x: entryOffsetX * remaining, y: entryOffsetY * remaining };
          }
          return { x: 0, y: jumpStartedAt === null ? 0 : -liftAt(
            (context.game.time - jumpStartedAt) / RULES.jump, RULES.height) };
        },
        drawBefore({ ball }, canvas) {
          if (phase !== "underground") return;
          const progress = entryProgress();
          if (progress >= 1) { canvas.globalAlpha = 0; return; }
          if (progress <= 0) return;
          const eased = progress * progress * (3 - 2 * progress);
          canvas.translate(ball.x, ball.y + ball.radius * 0.3 * eased);
          canvas.scale(1 - eased * 0.8, 1 - eased * 0.95);
          canvas.translate(-ball.x, -ball.y);
          canvas.globalAlpha *= 1 - progress * progress * progress;
        },
        drawArenaBackground({ ball, game }, canvas) {
          if (jumpStartedAt === null) return;
          const height = liftAt((game.time - jumpStartedAt) / RULES.jump, RULES.height);
          canvas.save();
          canvas.globalAlpha *= 0.25 - 0.15 * height / RULES.height;
          canvas.fillStyle = "#20262a";
          canvas.beginPath();
          canvas.ellipse(ball.x, ball.y, ball.radius * (1 - 0.3 * height / RULES.height),
            ball.radius * 0.35, 0, 0, TAU);
          canvas.fill();
          canvas.restore();
        },
        onAttackTransfer(context) {
          owner = context.ball;
          entryOffsetX = entryOffsetY = 0;
          if (phase === "underground" && cover) {
            cover.x = owner.x;
            cover.y = owner.y;
          }
        },
        onAbilitySealed: cleanup,
        onDeath: cleanup,
        onBorrowEnd() { cleanup(); for (const mud of muds) mud.entityActive = false; muds.length = 0; },
        onBattleEnd: cleanup,
        onBattleDispose: cleanup,
        getManholeState() {
          return { phase, charge, jumpStartedAt, nextCoverAt,
            entryProgress: phase === "underground" ? entryProgress() : 1,
            height: jumpStartedAt === null ? 0 : liftAt(
              (services.getTime() - jumpStartedAt) / RULES.jump, RULES.height),
            cover: cover ? { x: cover.x, y: cover.y, radius: cover.radius,
              age: cover.age, charge: cover.charge } : null,
            muds: muds.map((mud) => ({ x: mud.x, y: mud.y, radius: mud.radius,
              targetX: mud.targetX, targetY: mud.targetY, delay: mud.delay,
              duration: mud.duration, height: mud.height, landed: mud.landed })) };
        }
      };
    }
  };
  registerBall(manholeDefinition);
  return { manholeDefinition, MANHOLE_RULES: RULES, createManholeMud,
    createManholeSmoke, MANHOLE_SMOKE_PROPERTIES: SMOKE_PROPERTIES };
});
