(function initializeBriefcase(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createBriefcasePlugin(dependencies) {
  "use strict";
  const { registerBall, resolveArenaGeometry } = dependencies;

  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;
  const ROD_COUNT = 4;
  const PERMANENT_LIFE = Number.MAX_SAFE_INTEGER;
  // 牛皮棕：本体交给渲染器的默认纯色圆，只有颜色是这只球的身份。
  const LEATHER = "#8b5e34";

  const RULES = Object.freeze({
    // 本体与四根伸缩棒都是同一档碰撞伤害。
    collisionDamage: 3,
    rodDamage: 3,
    // 伸缩棒的判定半宽（视觉上从粗到细，判定按统一半径算）。
    rodRadius: 3.5,
    // 每 2 秒撑开一次：先在场上正常游走 2 秒。
    closedDuration: 2,
    extendDuration: 0.22,
    // 完全撑开后卡住不动 2 秒，然后收回继续运动。
    openDuration: 2,
    retractDuration: 0.18,
    minRodLength: 5,
    // 把目标推出棒体后额外留出的缝隙，避免下一帧又被判定为重叠。
    separation: 0.5
  });

  // 伸缩教鞭/收音机天线：一节节的套管，越往外越短。
  const ROD_SECTIONS = 6;
  const ROD_SECTION_RATIO = 0.74;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function smoothstep(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  // 从 (x, y) 沿单位方向走到方形战场边缘的距离。
  function wallDistance(x, y, directionX, directionY, arenaSize) {
    return resolveArenaGeometry(arenaSize).movementLimit(x, y, directionX, directionY, Infinity);
  }

  // 一根棒当前的线段几何：从本体中心指向墙边，长度按撑开进度插值。
  function rodGeometry(ball, angle, extension, arenaSize) {
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const reach = Math.max(
      RULES.minRodLength,
      wallDistance(ball.x, ball.y, directionX, directionY, arenaSize) - RULES.rodRadius
    );
    const length = reach * clamp(extension, 0, 1);
    return {
      angle,
      directionX,
      directionY,
      length,
      startX: ball.x,
      startY: ball.y,
      endX: ball.x + directionX * length,
      endY: ball.y + directionY * length
    };
  }

  function closestPointOnSegment(pointX, pointY, startX, startY, endX, endY) {
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const progress = lengthSquared <= EPSILON
      ? 0
      : clamp(
        ((pointX - startX) * deltaX + (pointY - startY) * deltaY) / lengthSquared,
        0,
        1
      );
    return {
      x: startX + deltaX * progress,
      y: startY + deltaY * progress
    };
  }

  // 球撞上棒子时把球弹开：棒是实体，不是可以穿过去的光柱。
  function resolveRodContact(target, contactX, contactY, geometry, arenaSize) {
    if (!target || target.positionLocked === true || target.movementLocked === true) return;
    const deltaX = target.x - contactX;
    const deltaY = target.y - contactY;
    const distance = Math.hypot(deltaX, deltaY);
    const normal = distance > EPSILON
      ? { x: deltaX / distance, y: deltaY / distance }
      : { x: -geometry.directionY, y: geometry.directionX };
    const minimumDistance = target.radius + RULES.rodRadius;
    Object.assign(target, resolveArenaGeometry(arenaSize).clampPoint(
      contactX + normal.x * (minimumDistance + RULES.separation),
      contactY + normal.y * (minimumDistance + RULES.separation), target.radius));
    const activeNormal = target.vx * normal.x + target.vy * normal.y;
    const storedNormal = target.storedVx * normal.x + target.storedVy * normal.y;
    if (activeNormal >= -EPSILON && storedNormal >= -EPSILON) return;
    const activeSpeed = Math.hypot(target.vx, target.vy);
    const storedSpeed = Math.hypot(target.storedVx, target.storedVy);
    const activeDirection = normalizeDirection(
      target.vx - 2 * activeNormal * normal.x,
      target.vy - 2 * activeNormal * normal.y,
      normal.x,
      normal.y
    );
    const storedDirection = normalizeDirection(
      target.storedVx - 2 * storedNormal * normal.x,
      target.storedVy - 2 * storedNormal * normal.y,
      normal.x,
      normal.y
    );
    target.vx = activeDirection.x * activeSpeed;
    target.vy = activeDirection.y * activeSpeed;
    target.storedVx = storedDirection.x * storedSpeed;
    target.storedVy = storedDirection.y * storedSpeed;
  }

  function rodSectionWeights() {
    const weights = [];
    let total = 0;
    for (let index = 0; index < ROD_SECTIONS; index += 1) {
      const weight = Math.pow(ROD_SECTION_RATIO, index);
      weights.push(weight);
      total += weight;
    }
    return weights.map((weight) => weight / total);
  }

  const ROD_SECTION_WEIGHTS = Object.freeze(rodSectionWeights());

  // 金属光泽 + 一节节变细变短的伸缩结构（棒自己作为战斗实体绘制）。
  function drawTelescopicRod(canvasContext, segment) {
    const {
      startX, startY, endX, endY, directionX, directionY, length
    } = segment;
    if (!(length > EPSILON)) return;
    const normalX = -directionY;
    const normalY = directionX;
    const baseHalfWidth = RULES.rodRadius * 1.35;
    canvasContext.save();
    canvasContext.lineJoin = "round";
    let travelled = 0;
    let halfWidth = baseHalfWidth;
    for (let index = 0; index < ROD_SECTIONS; index += 1) {
      const sectionLength = length * ROD_SECTION_WEIGHTS[index];
      const fromX = startX + directionX * travelled;
      const fromY = startY + directionY * travelled;
      const toX = fromX + directionX * sectionLength;
      const toY = fromY + directionY * sectionLength;
      travelled += sectionLength;
      const sectionHalfWidth = halfWidth;
      halfWidth = baseHalfWidth * Math.pow(0.86, index + 1);
      const sheen = canvasContext.createLinearGradient(
        fromX - normalX * sectionHalfWidth,
        fromY - normalY * sectionHalfWidth,
        fromX + normalX * sectionHalfWidth,
        fromY + normalY * sectionHalfWidth
      );
      sheen.addColorStop(0, "#f5f8f9");
      sheen.addColorStop(0.34, "#c4cdd3");
      sheen.addColorStop(0.72, "#78848c");
      sheen.addColorStop(1, "#e2e9ed");
      canvasContext.fillStyle = sheen;
      canvasContext.beginPath();
      canvasContext.moveTo(fromX - normalX * sectionHalfWidth, fromY - normalY * sectionHalfWidth);
      canvasContext.lineTo(toX - normalX * sectionHalfWidth, toY - normalY * sectionHalfWidth);
      canvasContext.lineTo(toX + normalX * sectionHalfWidth, toY + normalY * sectionHalfWidth);
      canvasContext.lineTo(fromX + normalX * sectionHalfWidth, fromY + normalY * sectionHalfWidth);
      canvasContext.closePath();
      canvasContext.fill();
      // 节与节之间的箍环
      canvasContext.strokeStyle = "#4f585e";
      canvasContext.lineWidth = 1;
      canvasContext.beginPath();
      canvasContext.moveTo(fromX - normalX * (sectionHalfWidth + 0.6), fromY - normalY * (sectionHalfWidth + 0.6));
      canvasContext.lineTo(fromX + normalX * (sectionHalfWidth + 0.6), fromY + normalY * (sectionHalfWidth + 0.6));
      canvasContext.stroke();
    }
    // 顶端圆头
    const tipHalfWidth = baseHalfWidth * Math.pow(0.86, ROD_SECTIONS);
    canvasContext.fillStyle = "#eef3f5";
    canvasContext.beginPath();
    canvasContext.arc(endX, endY, tipHalfWidth, 0, TWO_PI);
    canvasContext.fill();
    canvasContext.strokeStyle = "#5b656b";
    canvasContext.lineWidth = 0.8;
    canvasContext.stroke();
    canvasContext.restore();
  }

  const briefcaseDefinition = {
    id: "briefcase",
    name: "公文包",
    englishName: "Briefcase",
    color: LEATHER,
    description: "牛皮公文包 / 每2秒朝四个互相垂直的方向撑开伸缩铁棒直到墙边，本体卡住2秒后收回 / 本体与每根铁棒各3点碰撞伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: 5,
    createBehavior(services) {
      let owner = null;
      let phase = "closed";
      let timer = RULES.closedDuration;
      let baseAngle = 0;
      let extension = 0;
      // 四根棒各自是一个战斗实体，各自判定、各自造成伤害、各自可以被撞。
      let rodEntities = [];
      let savedMovementLocked = false;
      let ownsMovementLock = false;
      let anchorState = null;
      // 记录最近一次看到的战场尺寸，供状态查询使用（绘制与判定都走实时 game）。
      let arenaSize = 200;

      function arenaSizeOf(game) {
        if (game) arenaSize = resolveArenaGeometry(game);
        return arenaSize;
      }

      function lockInPlace(ball) {
        if (ownsMovementLock) return;
        savedMovementLocked = ball.movementLocked === true;
        anchorState = {
          x: ball.x, y: ball.y,
          positionLocked: ball.positionLocked === true,
          storedVx: ball.storedVx, storedVy: ball.storedVy
        };
        ownsMovementLock = true;
        services.setMovementLocked(true);
        pinInPlace();
      }

      function pinInPlace() {
        if (!ownsMovementLock || !anchorState || !owner) return;
        owner.x = owner.prevX = anchorState.x;
        owner.y = owner.prevY = anchorState.y;
        owner.positionLocked = true;
        owner.vx = owner.vy = 0;
        owner.storedVx = anchorState.storedVx;
        owner.storedVy = anchorState.storedVy;
      }

      function releaseMovement() {
        if (!ownsMovementLock) return;
        pinInPlace();
        owner.positionLocked = anchorState.positionLocked;
        owner.speedNeedsNormalization = true;
        anchorState = null;
        ownsMovementLock = false;
        services.setMovementLocked(savedMovementLocked);
      }

      function createRodEntity(angle) {
        return services.spawnCombatEntity({
          kind: "briefcase-rod",
          combatKind: "zone",
          life: PERMANENT_LIFE,
          lifecycle: "owner-bound",
          // 画在本体之前，棒根自然被本体盖住。
          drawLayer: "background",
          radius: RULES.rodRadius,
          angle,
          directionX: Math.cos(angle),
          directionY: Math.sin(angle),
          length: 0,
          startX: 0,
          startY: 0,
          endX: 0,
          endY: 0,
          touching: new Set(),
          update({ entity, game, services: entityServices }) {
            const ball = owner;
            if (!ball || ball.hp <= 0) {
              entity.entityActive = false;
              return;
            }
            const geometry = rodGeometry(ball, angle, extension, arenaSizeOf(game));
            entity.directionX = geometry.directionX;
            entity.directionY = geometry.directionY;
            entity.length = geometry.length;
            entity.startX = geometry.startX;
            entity.startY = geometry.startY;
            entity.endX = geometry.endX;
            entity.endY = geometry.endY;
            if (geometry.length <= EPSILON) {
              entity.touching = new Set();
              return;
            }
            // 被控制到"无法输出伤害"时棒子还在，但不再扣血。
            const canDamage = entityServices.getCapabilities(ball).canDealDamage;
            const stillTouching = new Set();
            entityServices.forEachEnemy((target) => {
              if (entityServices.getContactProfile(target).attackable !== true) return;
              const contact = closestPointOnSegment(
                target.x, target.y,
                geometry.startX, geometry.startY, geometry.endX, geometry.endY
              );
              const distance = Math.hypot(target.x - contact.x, target.y - contact.y);
              if (distance > target.radius + RULES.rodRadius) return;
              // 实体碰撞：先把目标推出棒体并弹开（封印期间棒子依然是实心的）。
              resolveRodContact(target, contact.x, contact.y, geometry, arenaSizeOf(game));
              if (!canDamage) return;
              const key = target.instanceId;
              stillTouching.add(key);
              if (entity.touching.has(key)) return;
              entityServices.dealDamage(target, RULES.rodDamage);
            });
            entity.touching = stillTouching;
          },
          draw({ entity }, canvasContext) {
            drawTelescopicRod(canvasContext, entity);
          }
        });
      }

      function deploy(ball) {
        baseAngle = Math.random() * TWO_PI;
        phase = "extending";
        timer = RULES.extendDuration;
        extension = 0;
        lockInPlace(ball);
        services.playSound("shoot", { kind: "briefcase-deploy", angle: baseAngle });
        services.spawnParticleBurst({
          x: ball.x,
          y: ball.y,
          kind: "briefcase-deploy",
          count: 10,
          colors: ["#c4cdd3", LEATHER, "#f5f8f9"],
          minDiameter: 1,
          maxDiameter: 2.6,
          minSpeed: 30,
          maxSpeed: 90,
          life: 0.4,
          drag: 3
        });
        rodEntities = [];
        for (let index = 0; index < ROD_COUNT; index += 1) {
          rodEntities.push(createRodEntity(baseAngle + index * (TWO_PI / ROD_COUNT)));
        }
      }

      function despawnRods() {
        for (const entity of rodEntities) entity.entityActive = false;
        rodEntities = [];
      }

      function retract(ball) {
        releaseMovement();
        despawnRods();
        if (ball && ball.hp > 0) services.playSound("status", { effect: "briefcase-retract" });
      }

      function step(context, dt) {
        const ball = context && context.ball ? context.ball : owner;
        if (!ball || ball.hp <= 0) return;
        owner = ball;
        const game = context ? context.game : null;
        if (game) arenaSizeOf(game);
        timer = Math.max(0, timer - Math.max(0, dt));

        if (phase === "closed") {
          extension = 0;
          if (timer <= EPSILON) deploy(ball);
          return;
        }
        if (phase === "extending") {
          extension = smoothstep(1 - timer / RULES.extendDuration);
          if (timer <= EPSILON) {
            phase = "open";
            timer = RULES.openDuration;
            extension = 1;
          }
          return;
        }
        if (phase === "open") {
          extension = 1;
          if (timer <= EPSILON) {
            phase = "retracting";
            timer = RULES.retractDuration;
          }
          return;
        }
        // retracting
        extension = smoothstep(timer / RULES.retractDuration);
        if (timer <= EPSILON) {
          extension = 0;
          phase = "closed";
          timer = RULES.closedDuration;
          retract(ball);
        }
      }

      function cleanup() {
        extension = 0;
        phase = "closed";
        timer = RULES.closedDuration;
        releaseMovement();
        despawnRods();
      }

      return {
        onSpawn(context) {
          owner = context.ball;
          phase = "closed";
          timer = RULES.closedDuration;
          extension = 0;
        },
        update(context, dt) {
          owner = context.ball;
          step(context, dt);
        },
        // 机械撑杆在普通眩晕里继续走自己的节奏，不然一根撑开的棒子会把整轮卡死。
        updateWhilePaused(context, dt) {
          owner = context.ball;
          step(context, dt);
        },
        afterUpdateStep: pinInPlace,
        afterUpdateStepWhilePaused: pinInPlace,
        getNextTransitionIn() {
          return Math.max(EPSILON, timer);
        },
        getNextPausedTransitionIn() {
          return Math.max(EPSILON, timer);
        },
        getCapabilityOverrides() {
          return ownsMovementLock ? { canMove: false } : undefined;
        },
        onCollision(context, target) {
          if (context.blockedAtContact) return;
          context.services.dealDamage(target, RULES.collisionDamage);
        },
        onDeath: cleanup,
        onBorrowEnd: cleanup,
        getBriefcaseState() {
          return {
            phase,
            timer,
            extension,
            baseAngle,
            locked: ownsMovementLock,
            damage: RULES.collisionDamage,
            rodDamage: RULES.rodDamage,
            rods: rodEntities.map((entity) => ({
              angle: entity.angle,
              length: entity.length,
              tipX: entity.endX,
              tipY: entity.endY,
              entityId: entity.instanceId
            }))
          };
        }
      };
    }
  };

  registerBall(briefcaseDefinition);
  return { briefcaseDefinition, BRIEFCASE_RULES: RULES, briefcaseRodGeometry: rodGeometry };
});
