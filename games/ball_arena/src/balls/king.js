(function initializeKing(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign(
        {},
        require("../core/ball-registry.js"),
        require("../core/damage-reduction.js"),
        require("./spear.js"),
        require("./king-visuals.js")
      )
    : root.BallBattle;
  const api = factory(Object.assign({}, dependencies, typeof module === "object" && module.exports
    ? require("../core/arena-geometry.js") : root.BallBattle));
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createKingPlugin({ resolveArenaGeometry, registerBall,
  applyDamageReduction,
  createSpearWeapon,
  createKingSummonMist,
  drawKingWoodShield
}) {
  const TAU = Math.PI * 2;
  const EPSILON = 1e-9;

  // 国王本体与小兵都是纯色：大红色本体，不加任何纹样。
  const KING_COLOR = "#e60012";

  const RULES = Object.freeze({
    summonInterval: 3.8,
    baseGuardCount: 4,
    spawnDistance: 50,
    lowHpThreshold: 40,
    maxGuards: 16
  });

  const GUARD = Object.freeze({
    id: "king-guard",
    name: "国王小兵",
    englishName: "King Guard",
    radius: 10,
    maxHp: 3,
    speed: 150,
    // 小兵本体只有长矛本体 2/3 粗，武器按同一比例等比缩小。
    weaponScale: 2 / 3,
    shieldArc: Math.PI / 3,
    shieldReduction: 0.5,
    shieldOuterExtra: 6,
    shieldInnerExtra: 1.5
  });

  function wrapAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  // 国王小兵 = 等比缩小的长矛机制（碰壁加速 / 只有矛尖造成速度相关伤害）
  // + 一面一直指向最近敌人、覆盖 60° 的木盾（该扇区来的伤害减半）。
  function createKingGuardDefinition() {
    return {
      id: GUARD.id,
      name: GUARD.name,
      englishName: GUARD.englishName,
      color: KING_COLOR,
      description: "缩小长矛机制 / 60°木盾指向敌人并减免该方向一半伤害",
      stats: { radius: GUARD.radius, speed: GUARD.speed, maxHp: GUARD.maxHp },
      createBehavior(services) {
        const weapon = createSpearWeapon({
          services,
          scale: GUARD.weaponScale,
          entityKind: "king-guard-tip",
          // 长矛本体的常驻残影属于本体主题，小兵不搬过来。
          trail: null
        });
        let shieldAngle = 0;
        let shieldTargeted = false;

        function aimShield(ball) {
          let nearest = null;
          let nearestDistance = Infinity;
          services.forEachEnemy((enemy) => {
            if (!enemy || !Number.isFinite(enemy.x) || !Number.isFinite(enemy.y)) return;
            const distance = Math.hypot(enemy.x - ball.x, enemy.y - ball.y);
            if (distance >= nearestDistance) return;
            nearestDistance = distance;
            nearest = enemy;
          });
          if (nearest) {
            shieldAngle = Math.atan2(nearest.y - ball.y, nearest.x - ball.x);
            shieldTargeted = true;
          }
        }

        return {
          onSpawn(context) {
            shieldAngle = Math.atan2(context.ball.vy, context.ball.vx);
            weapon.onSpawn(context);
          },
          update(context, dt) {
            weapon.update(context, dt);
            aimShield(context.ball);
          },
          getNextTransitionIn() {
            return weapon.getNextTransitionIn();
          },
          afterUpdateStep(context) {
            weapon.afterUpdateStep(context);
          },
          onWallBounce(context) {
            weapon.onWallBounce(context);
          },
          drawBefore(context, canvasContext) {
            weapon.drawBefore(context, canvasContext);
            const ball = context.ball;
            drawKingWoodShield(
              ball,
              shieldAngle,
              GUARD.shieldArc,
              ball.radius + GUARD.shieldOuterExtra,
              ball.radius + GUARD.shieldInnerExtra,
              canvasContext
            );
          },
          onBeforeDamage(context, event) {
            if (!event || event.kind === "self" || event.actor === context.ball) return event;
            const attacker = event.entity && Number.isFinite(event.entity.x)
              ? event.entity
              : event.actor;
            if (!attacker || !Number.isFinite(attacker.x) || !Number.isFinite(attacker.y)) {
              return event;
            }
            const deltaX = attacker.x - context.ball.x;
            const deltaY = attacker.y - context.ball.y;
            if (Math.hypot(deltaX, deltaY) <= EPSILON) return event;
            const offset = wrapAngle(Math.atan2(deltaY, deltaX) - shieldAngle);
            if (Math.abs(offset) > GUARD.shieldArc / 2) return event;
            return applyDamageReduction(event, GUARD.shieldReduction, Math.random);
          },
          onBorrowEnd() {
            weapon.onBorrowEnd();
          },
          getKingGuardState() {
            return {
              shieldAngle,
              shieldTargeted,
              shieldArc: GUARD.shieldArc,
              weapon: weapon.getSpearState()
            };
          }
        };
      }
    };
  }

  const kingDefinition = {
    id: "king",
    name: "国王",
    englishName: "King",
    color: KING_COLOR,
    description: "每3.8秒在正交四向召唤4个3血小兵（各持长矛与指向敌人的60°木盾）/ 血量低于40后每轮多召1个",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    createBehavior(services) {
      let activeTime = 0;
      let nextSummonAt = RULES.summonInterval;
      let waveCount = 0;
      let extraGuards = 0;

      function livingGuardCount(ball) {
        return services.getSummons(GUARD.id).filter((guard) => (
          guard.hp > 0 && guard.summonerInstanceId === ball.instanceId
        )).length;
      }

      function summonWave(context) {
        const ball = context.ball;
        // 血量跌破阈值后，每一轮都比上一轮多一个：5、6、7……
        if (ball.hp > 0 && ball.hp < RULES.lowHpThreshold) extraGuards += 1;
        const desired = RULES.baseGuardCount + extraGuards;
        const room = Math.max(0, RULES.maxGuards - livingGuardCount(ball));
        const count = Math.min(desired, room);
        // 四个方向互相垂直、随机朝向；数量更多时按同一规则均分一周。
        const baseAngle = Math.random() * TAU;
        for (let index = 0; index < count; index += 1) {
          const angle = baseAngle + (index * TAU) / count;
          const point = resolveArenaGeometry(context.game).clampPoint(
            ball.x + Math.cos(angle) * RULES.spawnDistance,
            ball.y + Math.sin(angle) * RULES.spawnDistance,
            GUARD.radius
          );
          const { x, y } = point;
          services.spawnVisualEffect(createKingSummonMist(x, y));
          // 沿各自方向获得初速度：小兵靠碰壁持续加速，静止的长矛没有意义。
          services.spawnSummon(createKingGuardDefinition(), {
            x,
            y,
            vx: Math.cos(angle) * GUARD.speed,
            vy: Math.sin(angle) * GUARD.speed
          });
        }
        waveCount += 1;
        nextSummonAt = activeTime + RULES.summonInterval;
      }

      return {
        update(_context, dt) {
          activeTime += Math.max(0, dt);
        },
        getNextTransitionIn() {
          return Math.max(EPSILON, nextSummonAt - activeTime);
        },
        afterUpdateStep(context) {
          if (activeTime + EPSILON < nextSummonAt) return;
          summonWave(context);
        },
        getKingState() {
          return {
            activeTime,
            nextSummonAt,
            waveCount,
            extraGuards,
            lastWaveSize: RULES.baseGuardCount + extraGuards
          };
        }
      };
    }
  };

  registerBall(kingDefinition);
  return {
    kingDefinition,
    createKingGuardDefinition,
    KING_RULES: RULES,
    KING_GUARD: GUARD,
    KING_COLOR
  };
});
