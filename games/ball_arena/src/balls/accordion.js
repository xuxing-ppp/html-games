(function initializeAccordion(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAccordionPlugin({ registerBall, resolveArenaGeometry }) {
  const KEY_LIMIT = 6;
  const KEY_THICKNESS = 10;
  const PRESS_DURATION = 0.12;
  const WAVE_STEP = 0.04;
  const DAMAGE = 1;
  const HEALING = 1;
  const HEAL_COLOR = "#35e878";
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  const EPSILON = 1e-9;
  const BODY_COLOR = "#9a5b13";
  const EDGES = ["top", "right", "bottom", "left"];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function wallEdges(context) {
    const { ball } = context;
    const arena = resolveArenaGeometry(context.game);
    if (arena.shape === "circle") {
      const angle = Math.atan2(ball.y - arena.centerY, ball.x - arena.centerX);
      return [EDGES[((Math.floor((angle + Math.PI * 0.75) / (Math.PI / 2)) % 4) + 4) % 4]];
    }
    const edges = [];
    if (context.bouncedX) edges.push(ball.x <= arena.left + ball.radius + EPSILON ? "left" : "right");
    if (context.bouncedY) edges.push(ball.y <= arena.top + ball.radius + EPSILON ? "top" : "bottom");
    return edges;
  }

  function wallCoordinate(edge, ball, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    if (arena.shape === "circle") {
      const angle = Math.atan2(ball.y - arena.centerY, ball.x - arena.centerX);
      const start = -Math.PI * 0.75 + EDGES.indexOf(edge) * Math.PI / 2;
      return ((angle - start + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2);
    }
    if (edge === "top" || edge === "bottom") return clamp((ball.x - arena.left) / arena.width, 0, 1);
    return clamp((ball.y - arena.top) / arena.height, 0, 1);
  }

  function keyGeometry(key, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const keys = key.ownerKeys;
    const count = keys.length || 1;
    if (arena.shape === "circle") {
      const startAngle = -Math.PI * 0.75 + (EDGES.indexOf(key.edge) + key.index / count) * Math.PI / 2;
      return { arena, startAngle, endAngle: startAngle + Math.PI / 2 / count,
        point: arena.boundaryPoint(key.edge, (key.index + 0.5) / count) };
    }
    const horizontal = key.edge === "top" || key.edge === "bottom";
    const origin = horizontal ? arena.left : arena.top;
    const span = horizontal ? arena.width : arena.height;
    const start = origin + key.index * span / count;
    const end = origin + (key.index + 1) * span / count;
    if (key.edge === "top") {
      return { x: start, y: arena.top, width: end - start, height: KEY_THICKNESS,
        point: { x: (start + end) / 2, y: arena.top } };
    }
    if (key.edge === "bottom") {
      return { x: start, y: arena.bottom - KEY_THICKNESS, width: end - start,
        height: KEY_THICKNESS, point: { x: (start + end) / 2, y: arena.bottom } };
    }
    if (key.edge === "left") {
      return { x: arena.left, y: start, width: KEY_THICKNESS, height: end - start,
        point: { x: arena.left, y: (start + end) / 2 } };
    }
    return { x: arena.right - KEY_THICKNESS, y: start, width: KEY_THICKNESS,
      height: end - start, point: { x: arena.right, y: (start + end) / 2 } };
  }

  function drawKey({ entity, game }, context) {
    const key = entity.key;
    if (!key || entity.entityActive === false) return;
    const geometry = keyGeometry(key, game.arena || game.arenaSize);
    const elapsed = game.time - key.pressedAt;
    const pressed = elapsed >= 0 && elapsed < PRESS_DURATION;
    const pulse = pressed ? Math.sin(Math.PI * elapsed / PRESS_DURATION) : 0;
    const pressDepth = pulse * 4;
    context.save();
    // 琴键整体 70% 透明度
    context.globalAlpha *= 0.7;
    context.fillStyle = key.color === "black" ? "#101010" : "#f2ead3";
    // 黑键改为白色描边
    context.strokeStyle = key.color === "black" ? "#ffffff" : "#3a2618";
    context.lineWidth = key.color === "black" ? 1.4 : 1;
    if (geometry.arena) {
      const arena = geometry.arena;
      const outer = arena.width / 2;
      context.beginPath();
      context.arc(arena.centerX, arena.centerY, outer, geometry.startAngle, geometry.endAngle);
      context.arc(arena.centerX, arena.centerY, outer - KEY_THICKNESS + pressDepth, geometry.endAngle, geometry.startAngle, true);
      context.closePath(); context.fill(); context.stroke(); context.restore();
      return;
    }
    let x = geometry.x;
    let y = geometry.y;
    let width = geometry.width;
    let height = geometry.height;
    // Keep the exposed outer edge fixed and retract the key cap toward its wall.
    if (key.edge === "bottom" || key.edge === "right") {
      if (key.edge === "bottom") y += pressDepth;
      else x += pressDepth;
    }
    if (key.edge === "top" || key.edge === "bottom") height = Math.max(1, height - pressDepth);
    else width = Math.max(1, width - pressDepth);
    context.fillRect(x, y, width, height);
    context.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    if (pulse > 0) {
      context.globalAlpha *= pulse * 0.8;
      context.strokeStyle = key.color === "black" ? "#2a1800" : "#8f7858";
      context.lineWidth = 1.2;
      context.beginPath();
      if (key.edge === "top") {
        context.moveTo(geometry.x + 1, geometry.y + height);
        context.lineTo(geometry.x + geometry.width - 1, geometry.y + height);
      } else if (key.edge === "bottom") {
        context.moveTo(geometry.x + 1, geometry.y + y - geometry.y);
        context.lineTo(geometry.x + geometry.width - 1, geometry.y + y - geometry.y);
      } else if (key.edge === "left") {
        context.moveTo(geometry.x + width, geometry.y + 1);
        context.lineTo(geometry.x + width, geometry.y + geometry.height - 1);
      } else {
        context.moveTo(geometry.x + x - geometry.x, geometry.y + 1);
        context.lineTo(geometry.x + x - geometry.x, geometry.y + geometry.height - 1);
      }
      context.stroke();
    }
    context.restore();
  }

  const accordionDefinition = {
    id: "accordion",
    name: "风琴",
    englishName: "Accordion",
    color: BODY_COLOR,
    description: "撞边布置黑白琴键 / 黑键伤敌、白键回血 / 水波连携",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      const keysByEdge = new Map(EDGES.map((edge) => [edge, []]));
      let keyCount = 0;
      const nextColorByEdge = new Map(EDGES.map((edge) => [edge, "black"]));
      let pressSerial = 0;
      let ownerBall = null;

      function allKeys() {
        return EDGES.flatMap((edge) => keysByEdge.get(edge));
      }

      function refreshGeometry(arenaSize) {
        for (const key of allKeys()) {
          const entity = key.entity;
          if (!entity) continue;
          entity.shieldBreakPoints = [keyGeometry(key, arenaSize).point];
        }
      }

      function reindexEdge(edge) {
        const keys = keysByEdge.get(edge) || [];
        keys.forEach((key, index) => {
          key.index = index;
          key.ownerKeys = keys;
        });
      }

      function removeKey(key) {
        if (!key || key.removed) return;
        key.removed = true;
        const keys = keysByEdge.get(key.edge);
        const index = keys.indexOf(key);
        if (index >= 0) keys.splice(index, 1);
        reindexEdge(key.edge);
        if (key.entity) {
          key.entity.entityActive = false;
          key.entity.life = 0;
        }
        keyCount = Math.max(0, keyCount - 1);
      }

      function removeOneOfColor(color) {
        const candidates = allKeys().filter((key) => key.color === color);
        if (candidates.length > 0) removeKey(candidates[candidates.length - 1]);
      }

      function destroyPair(trigger) {
        if (trigger && !trigger.removed) removeKey(trigger);
        removeOneOfColor(trigger && trigger.color === "black" ? "white" : "black");
      }

      function activateKey(key, context, keyServices = services) {
        if (key.removed || key.lastActivatedSerial === key.pressSerial) return;
        key.lastActivatedSerial = key.pressSerial;
        if (key.color === "white") {
          if (ownerBall && ownerBall.hp > 0) {
            // 恢复不受血量上限限制（可奶过上限）
            const restored = HEALING;
            if (restored > 0) {
              ownerBall.hp += restored;
              keyServices.spawnHitText(ownerBall, `+${restored}`, { color: HEAL_COLOR });
            }
          }
          return;
        }
        keyServices.forEachEnemy((target) => {
          if (target.hp <= 0) return;
          keyServices.dealDamage(target, DAMAGE);
        });
      }

      function pressKey(edge, index, time, context) {
        const keys = keysByEdge.get(edge) || [];
        const source = keys[index];
        if (!source) return;
        pressSerial += 1;
        const serial = pressSerial;
        for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
          const key = keys[keyIndex];
          const delay = Math.abs(keyIndex - index) * WAVE_STEP;
          key.pressSerial = serial;
          key.pressedAt = time + delay;
          key.lastActivatedSerial = null;
        }
        activateKey(source, context, context.services || services);
      }

      function addKey(edge, context) {
        const edgeKeys = keysByEdge.get(edge);
        if (edgeKeys.length >= KEY_LIMIT) return null;
        const key = {
          edge,
          index: edgeKeys.length,
          color: nextColorByEdge.get(edge),
          ownerKeys: edgeKeys,
          entity: null,
          pressedAt: -Infinity,
          pressSerial: 0,
          lastActivatedSerial: 0,
          removed: false
        };
        nextColorByEdge.set(
          edge,
          nextColorByEdge.get(edge) === "black" ? "white" : "black"
        );
        edgeKeys.push(key);
        keyCount += 1;
        const entity = services.spawnCombatEntity({
          kind: "accordion-key",
          combatKind: "zone",
          lifecycle: "owner-bound",
          life: PERMANENT_LIFE,
          solid: false,
          targetable: false,
          key,
          shieldBreakRadius: 1,
          shieldBreakPoints: [keyGeometry(key, context.game.arena || context.game.arenaSize).point],
          update({ entity: keyEntity, game: entityGame, services: keyServices }) {
            if (keyEntity.entityActive === false || key.removed) return;
            keyEntity.shieldBreakPoints = [keyGeometry(key, entityGame.arena || entityGame.arenaSize).point];
            if (key.pressSerial && key.lastActivatedSerial !== key.pressSerial &&
              entityGame.time + EPSILON >= key.pressedAt) {
              activateKey(key, { game: entityGame, services: keyServices });
            }
          },
          onShieldDestroyed() {
            destroyPair(key);
            refreshGeometry(context.game.arena || context.game.arenaSize);
          },
          onHammerDispelled() {
            destroyPair(key);
            refreshGeometry(context.game.arena || context.game.arenaSize);
          },
          draw: drawKey
        });
        key.entity = entity;
        refreshGeometry(context.game.arena || context.game.arenaSize);
        return key;
      }

      return {
        onSpawn(context) {
          ownerBall = context.ball;
        },
        onWallBounce(context) {
          ownerBall = context.ball;
          for (const edge of wallEdges(context)) {
            const keys = keysByEdge.get(edge);
            if (keys.length > 0) {
              const coordinate = wallCoordinate(edge, context.ball, context.game.arena || context.game.arenaSize);
              const index = clamp(
                Math.floor(coordinate * keys.length),
                0,
                keys.length - 1
              );
              pressKey(edge, index, context.game.time, context);
            }
            addKey(edge, context);
          }
        },
        getAccordionState() {
          return {
            keyCount,
            nextColorByEdge: Object.fromEntries(nextColorByEdge),
            keys: allKeys().map((key) => ({
              edge: key.edge,
              index: key.index,
              color: key.color,
              pressedAt: key.pressedAt,
              active: !key.removed
            }))
          };
        },
      };
    }
  };

  registerBall(accordionDefinition);
  return { accordionDefinition, ACCORDION_KEY_LIMIT: KEY_LIMIT };
});
