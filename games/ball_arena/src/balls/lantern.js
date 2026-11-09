(function initializeLantern(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createLanternPlugin({ resolveArenaGeometry, registerBall }) {
  // 光束每秒转 0.25 圈（4 秒一圈）。
  const ROTATION_RPS = 0.25;
  const ANGULAR_SPEED = Math.PI * 2 * ROTATION_RPS;
  // 光束是射线：长度理论上无限，只在绘制时被战场边界裁掉。
  const BEAM_LENGTH = Infinity;
  const BEAM_HALF_WIDTH = 2.5;
  // 从光源沿方向射出战场需要的距离（用于绘制）。
  function rayExitDistance(originX, originY, directionX, directionY, arenaSize) {
    return resolveArenaGeometry(arenaSize).movementLimit(originX, originY, directionX, directionY, Infinity);
  }
  // 出伤次数每达到"光束数量 × 4"就多一束光。
  const HITS_PER_BEAM = 4;
  const START_BEAM_COUNT = 1;
  const LANTERN_COLOR = "#ffb648";
  const BEAM_COLOR = "#ffd980";
  const BEAM_CORE_COLOR = "#fff6d0";
  const SPARK_COLORS = Object.freeze(["#ffe9b0", "#ffd980", "#ffb648", "#fff6d0"]);
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function normalizeAngle(value) {
    let angle = value % TWO_PI;
    if (angle < 0) angle += TWO_PI;
    return angle;
  }

  function angleDifference(a, b) {
    let difference = (a - b) % TWO_PI;
    if (difference > Math.PI) difference -= TWO_PI;
    if (difference < -Math.PI) difference += TWO_PI;
    return difference;
  }

  const lanternDefinition = {
    id: "lantern",
    name: "灯笼",
    englishName: "Lantern",
    color: LANTERN_COLOR,
    description: "旋转光束 / 触碰出伤 / 命中越多光束越多",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 6,
    createBehavior(services) {
      const state = {
        owner: null,
        beamCount: START_BEAM_COUNT,
        // 当前这一轮的出伤次数：光束 +1 后清零重新计数。
        hits: 0,
        totalHits: 0,
        rotation: -Math.PI / 2,
        beams: null
      };

      function rememberOwner(context) {
        if (context && context.ball && state.owner !== context.ball) {
          state.owner = context.ball;
        }
        return state.owner;
      }

      function beamAngles(count = state.beamCount) {
        const angles = [];
        for (let index = 0; index < count; index += 1) {
          angles.push(state.rotation + index * TWO_PI / count);
        }
        return angles;
      }

      function registerHit(target, entityServices) {
        const damage = state.beamCount;
        state.hits += 1;
        state.totalHits += 1;
        entityServices.dealDamage(target, damage);
        // 出伤次数达到 4n（n = 当前光束数量）就加一束，并把计数清零重新开始。
        if (state.hits >= HITS_PER_BEAM * state.beamCount) {
          state.beamCount += 1;
          state.hits = 0;
        }
        entityServices.spawnParticleBurst({
          x: target.x,
          y: target.y,
          count: 6,
          colors: SPARK_COLORS,
          minDiameter: 1,
          maxDiameter: 2.6,
          minSpeed: 30,
          maxSpeed: 110,
          life: 0.4,
          drag: 3
        });
      }

      function createBeamSystem() {
        return {
          kind: "lantern-beams",
          combatKind: "zone",
          lifecycle: "owner-bound",
          // 画在球体下方：光束数量多了也不会把球糊掉。
          drawLayer: "background",
          life: Number.MAX_SAFE_INTEGER,
          x: 0,
          y: 0,
          contacts: [],
          update({ effect, services: entityServices }, dt) {
            const owner = effect.owner;
            if (!owner) {
              effect.entityActive = false;
              return;
            }
            const elapsed = Math.max(0, dt);
            state.rotation = normalizeAngle(state.rotation + ANGULAR_SPEED * elapsed);
            effect.x = owner.x;
            effect.y = owner.y;

            const count = state.beamCount;
            while (effect.contacts.length < count) effect.contacts.push(new Set());
            effect.contacts.length = count;
            const angles = beamAngles(count);

            entityServices.forEachEnemy((target) => {
              if (!target || target.hp <= 0) return;
              const profile = entityServices.getContactProfile(target);
              if (profile.attackable === false) return;
              const deltaX = target.x - owner.x;
              const deltaY = target.y - owner.y;
              const distance = Math.hypot(deltaX, deltaY);
              // 射线无限长：只要目标不在光源原点上就都在光束的可达范围内。
              if (distance <= EPSILON) return;
              const angle = Math.atan2(deltaY, deltaX);
              const halfAngle = Math.asin(Math.min(
                1,
                (BEAM_HALF_WIDTH + target.radius) / Math.max(distance, EPSILON)
              ));
              for (let index = 0; index < count; index += 1) {
                const set = effect.contacts[index];
                const touching = Math.abs(angleDifference(angle, angles[index])) <= halfAngle;
                if (!touching) {
                  set.delete(target.instanceId);
                  continue;
                }
                if (set.has(target.instanceId)) continue;
                set.add(target.instanceId);
                registerHit(target, entityServices);
              }
            });
          },
          draw({ effect, game }, context) {
            const owner = effect.owner;
            if (!owner) return;
            const arenaSize = game && Number.isFinite(game.arenaSize) ? game.arenaSize : 200;
            const angles = beamAngles();
            const inner = Math.max(0, owner.radius - 2);
            context.save();
            context.globalCompositeOperation = "lighter";
            context.lineCap = "round";
            for (const angle of angles) {
              const directionX = Math.cos(angle);
              const directionY = Math.sin(angle);
              const startX = owner.x + directionX * inner;
              const startY = owner.y + directionY * inner;
              // 画到战场外一点，读作“射到场外”。
              const length = rayExitDistance(
                owner.x,
                owner.y,
                directionX,
                directionY,
                game || arenaSize
              ) + 24;
              const endX = owner.x + directionX * length;
              const endY = owner.y + directionY * length;
              // 外层暖光
              context.globalAlpha = 0.26;
              context.strokeStyle = LANTERN_COLOR;
              context.lineWidth = 5;
              context.beginPath();
              context.moveTo(startX, startY);
              context.lineTo(endX, endY);
              context.stroke();
              // 中层光束
              context.globalAlpha = 0.55;
              context.strokeStyle = BEAM_COLOR;
              context.lineWidth = 3;
              context.beginPath();
              context.moveTo(startX, startY);
              context.lineTo(endX, endY);
              context.stroke();
              // 亮芯
              context.globalAlpha = 0.9;
              context.strokeStyle = BEAM_CORE_COLOR;
              context.lineWidth = 1.2;
              context.beginPath();
              context.moveTo(startX, startY);
              context.lineTo(endX, endY);
              context.stroke();
              // 灯头光点
              context.globalAlpha = 0.85;
              context.fillStyle = BEAM_CORE_COLOR;
              context.beginPath();
              context.arc(endX, endY, 2.2, 0, TWO_PI);
              context.fill();
            }
            context.restore();
          }
        };
      }

      function ensureBeams(context) {
        if (state.beams && state.beams.entityActive !== false) return state.beams;
        state.beams = services.spawnCombatEntity(createBeamSystem());
        return state.beams;
      }

      return {
        onSpawn(context) {
          rememberOwner(context);
          ensureBeams(context);
        },
        update(context) {
          rememberOwner(context);
          ensureBeams(context);
        },
        updateWhilePaused(context) {
          rememberOwner(context);
          ensureBeams(context);
        },
        onDeath() {
          if (!state.beams) return;
          state.beams.entityActive = false;
          state.beams.life = 0;
          state.beams = null;
        },
        onBorrowEnd() {
          if (!state.beams) return;
          state.beams.entityActive = false;
          state.beams.life = 0;
          state.beams = null;
        },
        getLanternState() {
          return {
            beamCount: state.beamCount,
            hits: state.hits,
            totalHits: state.totalHits,
            rotation: state.rotation,
            nextBeamAt: HITS_PER_BEAM * state.beamCount,
            beamAngles: beamAngles()
          };
        }
      };
    }
  };

  registerBall(lanternDefinition);
  return {
    lanternDefinition,
    LANTERN_ROTATION_RPS: ROTATION_RPS,
    LANTERN_BEAM_LENGTH: BEAM_LENGTH,
    LANTERN_HITS_PER_BEAM: HITS_PER_BEAM
  };
});
