(function initializeCloud(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js")), require("../core/sprite-cache.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCloudPlugin({ registerBall, resolveArenaGeometry, createSpriteCache, resolveDeviceScale }) {
  const CLOUD_SETTINGS = Object.freeze({
    spawnInterval: 1.6,
    maxClouds: 6,
    minSpeed: 20,
    maxSpeed: 50,
    minRadius: 22,
    maxRadius: 102,
    contactInterval: 0.05,
    areaInterval: 1,
    opacity: 0.55,
    blur: 1.2,
    stealthAlpha: 0.2
  });
  const EPSILON = 1e-9;
  const TAU = Math.PI * 2;
  const HIDDEN_PROFILE = Object.freeze({ solid: false, attackable: false });
  const VISIBLE_PROFILE = Object.freeze({ solid: true, attackable: true });
  const cloudSprites = createSpriteCache();

  function createCloudLobes(seed) {
    let state = seed >>> 0;
    function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    }
    const count = 5 + Math.floor(random() * 6);
    const circles = Array.from({ length: count }, (_, index) => ({
      x: -0.72 + 1.44 * index / (count - 1) + (random() - 0.5) * 0.12,
      y: (random() - 0.5) * 0.5,
      radius: 0.36 + random() * 0.24
    }));
    const left = Math.min(...circles.map(lobe => lobe.x - lobe.radius));
    const right = Math.max(...circles.map(lobe => lobe.x + lobe.radius));
    const top = Math.min(...circles.map(lobe => lobe.y - lobe.radius));
    const bottom = Math.max(...circles.map(lobe => lobe.y + lobe.radius));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const halfWidth = (right - left) / 2;
    const halfHeight = (bottom - top) / 2;
    return circles.map(lobe => ({
      x: (lobe.x - centerX) / halfWidth, y: (lobe.y - centerY) / halfHeight,
      radiusX: lobe.radius / halfWidth, radiusY: lobe.radius / halfHeight
    }));
  }

  function paintCloud(context, centerX, centerY, size, patch) {
    const radius = size / 2;
    context.save();
    context.filter = `blur(${CLOUD_SETTINGS.blur * (resolveDeviceScale(context) || 1)}px)`;
    context.translate(centerX, centerY);
    context.scale(radius, radius * patch.radiusY / patch.radiusX);
    for (const lobe of patch.lobes) {
      context.save();
      context.translate(lobe.x, lobe.y);
      context.scale(lobe.radiusX, lobe.radiusY);
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, "rgba(250, 253, 255, 0.88)");
      gradient.addColorStop(0.48, "rgba(235, 246, 255, 0.7)");
      gradient.addColorStop(0.76, "rgba(207, 228, 244, 0.3)");
      gradient.addColorStop(1, "rgba(195, 218, 239, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, 1, 0, TAU);
      context.fill();
      context.restore();
    }
    context.restore();
  }

  function drawCloud(context, patch) {
    const size = patch.radiusX * 2;
    const spriteSize = size + CLOUD_SETTINGS.blur * 6;
    const scale = resolveDeviceScale(context);
    const sprite = scale && cloudSprites.get(`cloud-bank-${patch.shapeSeed}-${patch.radiusY}`,
      spriteSize, scale, (canvasContext, x, y) => paintCloud(canvasContext, x, y, size, patch));
    context.save();
    context.globalAlpha *= CLOUD_SETTINGS.opacity;
    if (sprite) {
      context.drawImage(sprite.canvas, patch.x - spriteSize / 2, patch.y - spriteSize / 2,
        sprite.worldWidth, sprite.worldWidth);
    } else {
      paintCloud(context, patch.x, patch.y, size, patch);
    }
    context.restore();
  }

  function overlapsCloud(ball, patch) {
    return patch.lobes.some(lobe => {
      const dx = (ball.x - patch.x - lobe.x * patch.radiusX) /
        (lobe.radiusX * patch.radiusX + ball.radius);
      const dy = (ball.y - patch.y - lobe.y * patch.radiusY) /
        (lobe.radiusY * patch.radiusY + ball.radius);
      return dx * dx + dy * dy <= 1;
    });
  }

  const cloudDefinition = {
    id: "cloud",
    name: "云朵",
    englishName: "Cloud",
    color: "#d5efff",
    description: "云层从两侧漂入，每块云对其中的敌人每秒造成1点伤害。身处云层时隐身，与敌方重叠每0.05秒造成1点伤害。",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rosterType: "normal",
    rionCycleDuration: 8,
    createBehavior(services) {
      let owner = null;
      let field = null;
      const contacts = new Map();
      const cloudContacts = new Map();

      function ownerActive() {
        return Boolean(owner && owner.hp > 0 && owner.active !== false && owner.isModeBench !== true);
      }

      function covered() {
        return Boolean(ownerActive() && field && field.entityActive !== false &&
          !services.isAbilitySealed(owner) && field.patches.some(patch => overlapsCloud(owner, patch)));
      }

      function addCloud(entity, arenaSize, direction) {
        const arena = resolveArenaGeometry(arenaSize);
        const radiusX = CLOUD_SETTINGS.minRadius +
          Math.random() * (CLOUD_SETTINGS.maxRadius - CLOUD_SETTINGS.minRadius);
        const radiusY = radiusX * (0.38 + Math.random() * 0.5);
        const speed = CLOUD_SETTINGS.minSpeed +
          Math.random() * (CLOUD_SETTINGS.maxSpeed - CLOUD_SETTINGS.minSpeed);
        const sign = direction || (Math.random() < 0.5 ? 1 : -1);
        const shapeSeed = Math.floor(Math.random() * 4294967296);
        entity.patches.push({
          x: sign > 0 ? arena.left - radiusX : arena.right + radiusX,
          y: arena.top + Math.min(radiusY, arena.height / 2) + Math.random() * Math.max(0, arena.height - radiusY * 2),
          radiusX, radiusY, vx: sign * speed, shapeSeed, lobes: createCloudLobes(shapeSeed)
        });
        entity.services.playSound("ability", { cue: "wind" });
      }

      function updateCloudDamage(context, dt) {
        if (services.isAbilitySealed(owner)) { cloudContacts.clear(); return; }
        const active = new Set(context.entity.patches);
        for (const patch of cloudContacts.keys()) if (!active.has(patch)) cloudContacts.delete(patch);
        for (const patch of context.entity.patches) {
          let clocks = cloudContacts.get(patch);
          if (!clocks) { clocks = new Map(); cloudContacts.set(patch, clocks); }
          const touching = new Set();
          context.services.forEachEnemy(target => {
            if (!overlapsCloud(target, patch)) return;
            touching.add(target.instanceId);
            let elapsed = (clocks.get(target.instanceId) || 0) + dt;
            while (elapsed + EPSILON >= CLOUD_SETTINGS.areaInterval && target.hp > 0) {
              elapsed = Math.max(0, elapsed - CLOUD_SETTINGS.areaInterval);
              if (!context.services.dealDamage(target, 1)) { elapsed = 0; break; }
            }
            if (target.hp > 0) clocks.set(target.instanceId, elapsed);
            else clocks.delete(target.instanceId);
          });
          for (const key of clocks.keys()) if (!touching.has(key)) clocks.delete(key);
        }
      }

      function updateField(context, dt) {
        const entity = context.entity;
        if (!ownerActive()) {
          contacts.clear();
          cloudContacts.clear();
          entity.entityActive = false;
          return;
        }
        for (const patch of entity.patches) patch.x += patch.vx * dt;
        entity.patches = entity.patches.filter(patch => patch.vx > 0
          ? patch.x - patch.radiusX <= resolveArenaGeometry(context.game).right
          : patch.x + patch.radiusX >= resolveArenaGeometry(context.game).left);
        entity.spawnElapsed += dt;
        while (entity.spawnElapsed + EPSILON >= CLOUD_SETTINGS.spawnInterval) {
          entity.spawnElapsed = Math.max(0, entity.spawnElapsed - CLOUD_SETTINGS.spawnInterval);
          if (entity.patches.length < CLOUD_SETTINGS.maxClouds) addCloud(entity, context.game.arena || context.game.arenaSize);
        }

        updateCloudDamage(context, dt);
        const capabilities = context.services.getCapabilities(owner);
        if (!covered() || !capabilities.canAct || !capabilities.canBodyAttack || !capabilities.canDealDamage) {
          contacts.clear();
          return;
        }
        const touching = new Set();
        context.services.forEachEnemy(target => {
          const radius = owner.radius + target.radius;
          if (Math.hypot(target.x - owner.x, target.y - owner.y) >= radius) return;
          touching.add(target.instanceId);
          let elapsed = (contacts.get(target.instanceId) || 0) + dt;
          while (elapsed + EPSILON >= CLOUD_SETTINGS.contactInterval && target.hp > 0) {
            elapsed = Math.max(0, elapsed - CLOUD_SETTINGS.contactInterval);
            if (!context.services.dealDamage(target, 1)) {
              elapsed = 0;
              break;
            }
          }
          if (target.hp > 0) contacts.set(target.instanceId, elapsed);
          else contacts.delete(target.instanceId);
        });
        for (const key of contacts.keys()) if (!touching.has(key)) contacts.delete(key);
      }

      function ensure(context) {
        owner = context.ball;
        if (!ownerActive() || (field && field.entityActive !== false)) return;
        contacts.clear();
        cloudContacts.clear();
        field = services.spawnCombatEntity({
          kind: "cloud-field", combatKind: "zone", lifecycle: "owner-bound",
          life: Number.MAX_SAFE_INTEGER, drawLayer: "background",
          x: 0, y: 0, patches: [], spawnElapsed: 0,
          update: updateField,
          draw({ entity }, canvasContext) {
            for (const patch of entity.patches) drawCloud(canvasContext, patch);
          }
        });
        addCloud(field, context.game.arena || context.game.arenaSize, 1);
        addCloud(field, context.game.arena || context.game.arenaSize, -1);
      }

      function retire() {
        if (field) field.entityActive = false;
        field = null;
        contacts.clear();
        cloudContacts.clear();
      }

      return {
        onSpawn: ensure,
        beforeUpdateStep: ensure,
        update: ensure,
        updateWhilePaused: ensure,
        getContactProfile() { return covered() ? HIDDEN_PROFILE : VISIBLE_PROFILE; },
        drawBefore(context, canvasContext) {
          if (covered()) canvasContext.globalAlpha *= CLOUD_SETTINGS.stealthAlpha;
        },
        onAttackTransfer(context) {
          owner = context.ball;
          contacts.clear();
          cloudContacts.clear();
        },
        onAbilitySealed() { contacts.clear(); cloudContacts.clear(); },
        onBorrowEnd: retire,
        onDeath: retire,
        onBattleEnd: retire,
        onBattleDispose: retire,
        getCloudState() {
          return {
            hidden: covered(),
            spawnElapsed: field ? field.spawnElapsed : 0,
            patches: field ? field.patches.map(patch => ({
              ...patch, lobes: patch.lobes.map(lobe => ({ ...lobe }))
            })) : []
          };
        }
      };
    }
  };

  registerBall(cloudDefinition);
  return { cloudDefinition, CLOUD_SETTINGS };
});
