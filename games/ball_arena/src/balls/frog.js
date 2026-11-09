(function initializeFrog(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/arena-geometry.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createFrogPlugin({ registerBall, resolveArenaGeometry }) {
  const LEAF_INTERVAL = 2;
  const LEAF_LIFETIME = 7;
  const LEAF_SINK_TIME = 0.8;
  const LEAF_MARGIN = 26;
  const LEAF_RADIUS_X = 11;
  const LEAF_RADIUS_Y = 6.6;
  const LEAF_MIN_GAP = 44;
  const LEAF_MAX = 3;
  const TONGUE_COOLDOWN = 1.2;
  const SPIT_SPEED = 220;
  const TONGUE_EXTEND_SPEED = 400;
  const TONGUE_REACH = 160;
  const TONGUE_RETRACT_SPEED = 150;
  const TONGUE_PULL_DAMAGE_DISTANCE = 35;
  const TONGUE_PULL_DAMAGE = 3;
  const TONGUE_MOUTH_DISTANCE = 18;
  const TONGUE_SWALLOW_TIME = 0.12;
  const TONGUE_GROW_TIME = 0.3;
  const TONGUE_CAPTURE_DURATION = 3;
  const DEFAULT_RADIUS = 15;
  const TONGUE_LIFETIME = TONGUE_REACH / TONGUE_RETRACT_SPEED + TONGUE_SWALLOW_TIME + TONGUE_GROW_TIME + 0.9;
  const TONGUE_WIDTH = 4.6;
  const LEAP_ATTACH_TIME = 0.08;
  const LEAP_JUMP_TIME = 0.24;
  const LEAP_ARC = 20;
  const EPSILON = 1e-9;
  const TWO_PI = Math.PI * 2;

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function normalize(x, y, fallbackX = 1, fallbackY = 0) {
    const length = Math.hypot(x, y);
    if (length <= EPSILON) return { x: fallbackX, y: fallbackY };
    return { x: x / length, y: y / length };
  }

  // 荷叶：亮绿椭圆 + 右上缺口 + 叶脉，到期慢慢沉没
  function drawLeaf(entity, context) {
    const radiusX = LEAF_RADIUS_X;
    const radiusY = LEAF_RADIUS_Y;
    const sink = entity.sinkProgress || 0;
    const sinkScale = 1 - sink * 0.45;
    const notchStart = -0.34 * Math.PI + 0.06;
    const notchEnd = -0.02 * Math.PI;
    const endX = Math.cos(notchEnd) * radiusX;
    const endY = Math.sin(notchEnd) * radiusY;
    const midAngle = (notchStart + notchEnd) / 2;
    const notchTipX = Math.cos(midAngle) * radiusX * 0.34;
    const notchTipY = Math.sin(midAngle) * radiusY * 0.34;
    context.save();
    context.translate(entity.x, entity.y + sink * 9);
    context.rotate(entity.rotation || 0);
    context.scale(sinkScale, sinkScale);
    context.globalAlpha *= 1 - sink;
    context.beginPath();
    context.ellipse(0, 0, radiusX, radiusY, 0, notchEnd, notchStart + TWO_PI);
    context.lineTo(notchTipX, notchTipY);
    context.closePath();
    context.fillStyle = "#74cf42";
    context.fill();
    context.strokeStyle = "#2f8f22";
    context.lineWidth = 1.1;
    context.stroke();
    context.strokeStyle = "rgba(226, 255, 186, 0.55)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(-radiusX * 0.7, radiusY * 0.1);
    context.lineTo(radiusX * 0.8, -radiusY * 0.3);
    context.stroke();
    context.beginPath();
    context.moveTo(-radiusX * 0.45, -radiusY * 0.55);
    context.lineTo(radiusX * 0.5, -radiusY * 0.15);
    context.stroke();
    context.beginPath();
    context.moveTo(-radiusX * 0.35, radiusY * 0.6);
    context.lineTo(radiusX * 0.6, radiusY * 0.25);
    context.stroke();
    context.restore();
  }

  // 舌头：粗粉色波浪线，从蛙嘴伸到舌尖；吞入后舌头立即收掉，不再缠绕
  function drawTongue(entity, context) {
    if (!entity.target || entity.entityActive === false) return;
    if (entity.phase === "swallow" || entity.phase === "spit") return;
    const mouthX = entity.mouthX;
    const mouthY = entity.mouthY;
    const tipX = entity.tipX;
    const tipY = entity.tipY;
    const normalX = -entity.faceY;
    const normalY = entity.faceX;
    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";
    const bowAt = (progress) => Math.sin(progress * Math.PI * 2.4 - entity.length * 0.22) * (
      1.2 + Math.sin(entity.elapsed * 16) * 0.9
    );
    // 下缘阴影
    context.strokeStyle = "#e2738f";
    context.lineWidth = TONGUE_WIDTH + 1.4;
    context.beginPath();
    for (let index = 0; index <= 14; index += 1) {
      const progress = index / 14;
      const bow = bowAt(progress);
      const x = mouthX + (tipX - mouthX) * progress + normalX * bow;
      const y = mouthY + (tipY - mouthY) * progress + normalY * bow;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    // 主体
    context.strokeStyle = "#ff8fae";
    context.lineWidth = TONGUE_WIDTH;
    context.beginPath();
    for (let index = 0; index <= 14; index += 1) {
      const progress = index / 14;
      const bow = bowAt(progress);
      const x = mouthX + (tipX - mouthX) * progress + normalX * bow;
      const y = mouthY + (tipY - mouthY) * progress + normalY * bow;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
    // 高光
    context.strokeStyle = "rgba(255, 196, 214, 0.75)";
    context.lineWidth = 1.5;
    context.beginPath();
    for (let index = 0; index <= 14; index += 1) {
      const progress = index / 14;
      const bow = bowAt(progress);
      const x = mouthX + (tipX - mouthX) * progress + normalX * bow;
      const y = mouthY + (tipY - mouthY) * progress + normalY * bow;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y - 1);
    }
    context.stroke();
    // 舌尖：卷住的圆弧（只有真的卷住目标时才画）
    if (entity.captured && entity.phase === "retract") {
      const target = entity.target;
      context.strokeStyle = "#ff8fae";
      context.lineWidth = TONGUE_WIDTH - 1;
      context.beginPath();
      context.arc(tipX, tipY, Math.max(2, target.radius * 0.55), entity.length * 2, entity.length * 2 + Math.PI * 1.5);
      context.stroke();
    } else {
      context.fillStyle = "#ffa4bb";
      context.beginPath();
      context.arc(tipX, tipY, TONGUE_WIDTH * 0.55, 0, TWO_PI);
      context.fill();
    }
    context.restore();
  }

  // 跳跃特效：起跳绿闪 + 落点涟漪
  function spawnLeapEffects(fromX, fromY, toX, toY, services) {
    services.spawnVisualEffect({
      kind: "frog-leap-vanish",
      life: 0.26,
      x: fromX,
      y: fromY,
      update({ effect }, dt) {
        effect.spin = (effect.spin || 0) + dt * 10;
      },
      draw({ effect }, context) {
        const progress = effect.age / effect.life;
        context.save();
        context.globalAlpha = 1 - progress;
        context.fillStyle = "#d8ff9f";
        for (let index = 0; index < 7; index += 1) {
          const angle = (effect.spin || 0) + index / 7 * TWO_PI;
          const distance = 2 + progress * (9 + (index % 3) * 4);
          const size = 2 - progress * 0.8;
          context.fillRect(
            effect.x + Math.cos(angle) * distance - size / 2,
            effect.y + Math.sin(angle) * distance - size / 2,
            size, size
          );
        }
        context.restore();
      }
    });
    services.spawnVisualEffect({
      kind: "frog-leap-arrive",
      life: 0.3,
      x: toX,
      y: toY,
      draw({ effect }, context) {
        const progress = effect.age / effect.life;
        context.save();
        context.globalAlpha = (1 - progress) * 0.9;
        context.strokeStyle = "#eaffc8";
        context.lineWidth = 1.6;
        context.beginPath();
        context.arc(effect.x, effect.y, 4 + progress * 12, 0, TWO_PI);
        context.stroke();
        context.fillStyle = "#cfe8a6";
        for (let index = 0; index < 5; index += 1) {
          const angle = index / 5 * TWO_PI + progress * 4;
          const distance = 3 + progress * 8;
          context.fillRect(effect.x + Math.cos(angle) * distance - 1, effect.y + Math.sin(angle) * distance * 0.55 - 1, 2, 2);
        }
        context.restore();
      }
    });
  }

  function spawnSpitBurst(x, y, services) {
    services.spawnVisualEffect({
      kind: "frog-spit-burst",
      life: 0.3,
      x,
      y,
      update({ effect }, dt) {
        effect.spin = (effect.spin || 0) + dt * 6;
      },
      draw({ effect }, context) {
        const progress = effect.age / effect.life;
        context.save();
        context.globalAlpha = 1 - progress;
        context.fillStyle = "#ffffff";
        for (let index = 0; index < 9; index += 1) {
          const angle = (effect.spin || 0) + index / 9 * TWO_PI;
          const distance = 2 + progress * (7 + (index % 3) * 5);
          const size = 1.8 + (index % 2);
          context.fillRect(
            effect.x + Math.cos(angle) * distance - size / 2,
            effect.y + Math.sin(angle) * distance - size / 2,
            size, size
          );
        }
        context.restore();
      }
    });
  }

  const frogDefinition = {
    id: "frog",
    name: "青蛙",
    englishName: "Frog",
    color: "#7dc93e",
    description: "荷叶远跳 / 舌头捕捉 / 收回时持续伤害",
    stats: { radius: 15, speed: 150, maxHp: 100 },
    rionCycleDuration: TONGUE_COOLDOWN + TONGUE_LIFETIME,
    createBehavior(services) {
      let leafTimer = LEAF_INTERVAL * 0.5;
      let tongueTimer = 0;
      let leaves = [];
      let tongue = null;
      let leap = null;
      let lastLeapLeaf = null;
      let facing = { x: 1, y: 0 };

      function spawnLeaf(game) {
        const spacing = LEAF_MARGIN;
        const arena = resolveArenaGeometry(game);
        let { x, y } = arena.samplePoint(Math.random, spacing);
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const tooClose = leaves.some((leaf) => (
            leaf.entityActive !== false &&
            Math.hypot(leaf.x - x, leaf.y - y) < LEAF_MIN_GAP
          ));
          if (!tooClose) break;
          ({ x, y } = arena.samplePoint(Math.random, spacing));
        }
        const leaf = services.spawnCombatEntity({
          kind: "frog-leaf",
          combatKind: "zone",
          lifecycle: "owner-bound",
          life: LEAF_LIFETIME + LEAF_SINK_TIME,
          drawLayer: "background",
          x,
          y,
          baseRotation: Math.random() * TWO_PI,
          rotation: 0,
          sinkProgress: 0,
          sinkFromAge: LEAF_LIFETIME,
          wavePhase: Math.random() * TWO_PI,
          update({ entity, game }) {
            entity.rotation = entity.baseRotation + Math.sin(game.time * 1.1 + entity.wavePhase) * 0.07;
            if (entity.age >= entity.sinkFromAge) {
              entity.sinkProgress = clamp((entity.age - entity.sinkFromAge) / LEAF_SINK_TIME, 0, 1);
            }
          },
          draw({ entity }, context) {
            drawLeaf(entity, context);
          }
        });
        leaves.push(leaf);
      }

      // 生成新叶时若已有 LEAF_MAX 片，让最老的叶立即开始沉没
      function sinkOldestLeaf(aliveLeaves) {
        let oldest = null;
        for (const leaf of aliveLeaves) {
          if (leaf.sinkFromAge <= leaf.age) continue; // 已在沉没中
          if (!oldest || leaf.age > oldest.age) oldest = leaf;
        }
        if (!oldest) return;
        oldest.sinkFromAge = oldest.age;
        oldest.life = Math.min(oldest.life, oldest.age + LEAF_SINK_TIME);
      }

      function currentLeaf(ball) {
        // 取最近的有效荷叶，避免重叠叶面上判断错乱
        let best = null;
        let bestDistance = Infinity;
        for (const leaf of leaves) {
          if (leaf.entityActive === false || leaf.sinkProgress >= 0.35) continue;
          const distance = Math.hypot(ball.x - leaf.x, ball.y - leaf.y);
          if (distance <= ball.radius + LEAF_RADIUS_X && distance < bestDistance) {
            best = leaf;
            bestDistance = distance;
          }
        }
        return best;
      }

      function leapTarget(fromLeaf) {
        let destination = null;
        let farthest = -1;
        for (const leaf of leaves) {
          if (leaf === fromLeaf || leaf.entityActive === false || leaf.sinkProgress >= 0.5) continue;
          const distance = Math.hypot(fromLeaf.x - leaf.x, fromLeaf.y - leaf.y);
          // 太近的叶不构成有效远跳，避免重叠叶面上来回弹跳
          if (distance < 10 || distance <= farthest) continue;
          farthest = distance;
          destination = leaf;
        }
        return destination;
      }

      // 跳跃：先吸附到荷叶中心（短暂），再跳到最远的荷叶
      function startLeap(ball, fromLeaf) {
        const destination = leapTarget(fromLeaf);
        if (!destination) return;
        leap = {
          phase: "attach",
          toLeaf: destination,
          t: 0,
          attachFromX: ball.x,
          attachFromY: ball.y,
          attachToX: fromLeaf.x,
          attachToY: fromLeaf.y,
          jumpFromX: fromLeaf.x,
          jumpFromY: fromLeaf.y,
          jumpToX: destination.x,
          jumpToY: destination.y
        };
        services.setMovementLocked(true);
      }

      function finishTongue(entity, completed = false) {
        if (!entity) return;
        entity.entityActive = false;
        entity.completed = completed;
        if (tongue === entity) tongue = null;
        const target = entity.target;
        if (entity.captureEffect && target.effects.get(entity.captureEffect.id) === entity.captureEffect) {
          services.clearEffect(target, entity.captureEffect.id);
        } else {
          restoreTarget(entity);
        }
      }

      function cleanup() {
        finishTongue(tongue);
        for (const leaf of leaves) leaf.entityActive = false;
        leaves = [];
        if (leap) services.setMovementLocked(false);
        leap = null;
      }

      function reapTongue() {
        if (tongue && (tongue.entityActive === false || tongue.age >= tongue.life)) {
          finishTongue(tongue);
        }
      }

      function startTongue(ball, target) {
        const direction = normalize(target.x - ball.x, target.y - ball.y);
        const mouthX = ball.x + direction.x * (ball.radius - 3);
        const mouthY = ball.y + direction.y * (ball.radius - 3);
        tongue = services.spawnCombatEntity({
          kind: "frog-tongue",
          combatKind: "skill",
          lifecycle: "owner-bound",
          life: TONGUE_LIFETIME,
          faceX: direction.x,
          faceY: direction.y,
          mouthX,
          mouthY,
          tipX: mouthX,
          tipY: mouthY,
          target,
          owner: ball,
          phase: "extend",
          elapsed: 0,
          retractElapsed: 0,
          length: 0,
          carryDist: 0,
          damageCount: 0,
          captured: false,
          lastDistance: 0,
          damageAccum: 0,
          update({ entity, game, services: tongueServices }, dt) {
            if (entity.entityActive === false) return;
            if (!entity.target || entity.target.hp <= 0 || entity.target.active === false) {
              finishTongue(entity);
              return;
            }
            entity.elapsed += dt;
            const target = entity.target;
            const owner = entity.owner;
            const arena = resolveArenaGeometry(game);
            if (owner && owner.hp > 0) {
              entity.mouthX = owner.x + entity.faceX * (owner.radius - 3);
              entity.mouthY = owner.y + entity.faceY * (owner.radius - 3);
            }
            const dx = target.x - entity.mouthX;
            const dy = target.y - entity.mouthY;
            const distance = Math.hypot(dx, dy) || 1;
            const dirX = dx / distance;
            const dirY = dy / distance;
            if (entity.phase === "extend") {
              entity.length = Math.min(TONGUE_REACH, entity.length + TONGUE_EXTEND_SPEED * dt);
              entity.faceX = dirX;
              entity.faceY = dirY;
              entity.tipX = entity.mouthX + dirX * Math.min(entity.length, TONGUE_REACH);
              entity.tipY = entity.mouthY + dirY * Math.min(entity.length, TONGUE_REACH);
              const tipToTarget = Math.hypot(entity.tipX - target.x, entity.tipY - target.y);
              if (tipToTarget <= target.radius * 0.6 + 3 || entity.length >= TONGUE_REACH) {
                entity.phase = "retract";
                entity.retractElapsed = 0;
                entity.carryDist = Math.max(TONGUE_MOUTH_DISTANCE, distance);
                entity.lastDistance = entity.carryDist;
                entity.damageAccum = 0;
                if (tipToTarget <= target.radius * 0.6 + 3 && !target.effects.has("frog-tongue-capture")) {
                  entity.tipX = target.x - dirX * (target.radius * 0.4);
                  entity.tipY = target.y - dirY * (target.radius * 0.4);
                  const savedCaptureState = {
                    radius: target.radius,
                    arena,
                    positionLocked: target.positionLocked === true,
                    vx: target.vx,
                    vy: target.vy,
                    storedVx: target.storedVx,
                    storedVy: target.storedVy,
                    speedMultiplier: target.speedMultiplier,
                    speedNeedsNormalization: target.speedNeedsNormalization === true
                  };
                  const capture = tongueServices.applyEffect(target, {
                    id: "frog-tongue-capture",
                    duration: TONGUE_CAPTURE_DURATION,
                    pausesBehavior: true,
                    locksMovement: true,
                    preventsAttack: true,
                    blocksDamageOutput: true,
                    blocksOwnedEntityDamage: true,
                    forceCapabilities: Object.freeze({
                      canAct: false,
                      canBodyAttack: false,
                      canDealDamage: false
                    }),
                    getContactProfile() {
                      // 仅去掉物理碰撞（防挤压/蹭墙），保留可被攻击判定，
                      // 否则舌头自己的收回伤害也会被吞掉
                      return { solid: false };
                    },
                    update({ ball }) {
                      if (entity.entityActive === false || entity.age >= entity.life ||
                          owner.hp <= 0 || owner.active === false) {
                        finishTongue(entity);
                        return;
                      }
                      ball.vx = 0;
                      ball.vy = 0;
                      ball.storedVx = 0;
                      ball.storedVy = 0;
                    },
                    onExpire() {
                      restoreTarget(entity);
                      entity.entityActive = false;
                      if (tongue === entity) tongue = null;
                    }
                  });
                  if (capture) {
                    entity.captureEffect = capture;
                    entity.captureState = savedCaptureState;
                    entity.captured = true;
                    target.positionLocked = true;
                    target.vx = target.vy = target.storedVx = target.storedVy = 0;
                  }
                } else {
                  entity.captured = false;
                }
              }
              return;
            }

            if (entity.phase === "retract") {
              if (!entity.captured) {
                // 空挥：舌尖没有碰到目标，只收回舌头，不拉人、不结算伤害
                entity.length = Math.max(0, entity.length - TONGUE_RETRACT_SPEED * dt);
                const tipDistance = Math.min(entity.length, TONGUE_REACH);
                entity.tipX = entity.mouthX + entity.faceX * tipDistance;
                entity.tipY = entity.mouthY + entity.faceY * tipDistance;
                if (entity.length <= 0.5) {
                  finishTongue(entity);
                }
                return;
              }
              entity.retractElapsed += dt;
              // 舌头以 150 速度收回到身边（拖近，不残留距离）
              const pulled = TONGUE_RETRACT_SPEED * entity.retractElapsed;
              const distance = Math.max(TONGUE_MOUTH_DISTANCE, entity.carryDist - pulled);
              const shrink = clamp((entity.carryDist - distance) / entity.carryDist, 0, 1);
              const originalRadius = entity.captureState.radius;
              target.radius = originalRadius * (1 - shrink * (1 - 8 / DEFAULT_RADIUS));
              const { x: carryX, y: carryY } = arena.clampPoint(
                entity.mouthX + dirX * distance, entity.mouthY + dirY * distance, target.radius);
              entity.length = distance;
              target.x = carryX;
              target.y = carryY;
              target.prevX = target.x;
              target.prevY = target.y;
              entity.tipX = target.x - dirX * (target.radius * 0.4);
              entity.tipY = target.y - dirY * (target.radius * 0.4);
              // 每收回 35 距离结算 3 点血；不足 35 的回收至少也结算一次 3 点
              entity.damageAccum += entity.lastDistance - distance;
              entity.lastDistance = distance;
              while (entity.damageAccum + EPSILON >= TONGUE_PULL_DAMAGE_DISTANCE) {
                entity.damageAccum -= TONGUE_PULL_DAMAGE_DISTANCE;
                entity.damageCount += 1;
                tongueServices.dealDamage(target, TONGUE_PULL_DAMAGE);
                if (target.hp <= 0 || target.active === false) {
                  finishTongue(entity);
                  return;
                }
              }
              if (distance <= TONGUE_MOUTH_DISTANCE + 0.5) {
                if (entity.damageCount === 0) {
                  entity.damageCount += 1;
                  tongueServices.dealDamage(target, TONGUE_PULL_DAMAGE);
                  if (target.hp <= 0 || target.active === false) {
                    finishTongue(entity);
                    return;
                  }
                }
                entity.phase = "swallow";
                entity.swallowTimer = 0;
                entity.swallowRadius = target.radius;
              }
              return;
            }

            if (entity.phase === "swallow") {
              entity.swallowTimer += dt;
              const progress = clamp(entity.swallowTimer / TONGUE_SWALLOW_TIME, 0, 1);
              const swallowedRadius = entity.captureState.radius * 2 / DEFAULT_RADIUS;
              target.radius = entity.swallowRadius + progress * (swallowedRadius - entity.swallowRadius);
              target.x = owner.x + (target.x - owner.x) * (1 - progress);
              target.y = owner.y + (target.y - owner.y) * (1 - progress);
              target.prevX = target.x;
              target.prevY = target.y;
              if (progress >= 1) {
                // 从青蛙体内（背后一侧）钻出：小尺寸 + 沿钻出方向弹射，边飞边变大
                const { x: spawnX, y: spawnY } = arena.clampPoint(
                  owner.x - entity.faceX * (owner.radius * 0.2),
                  owner.y - entity.faceY * (owner.radius * 0.2), swallowedRadius);
                target.x = spawnX;
                target.y = spawnY;
                target.prevX = target.x;
                target.prevY = target.y;
                target.radius = swallowedRadius;
                // Ejection is capture animation, not a permanent movement-speed change.
                entity.spitVx = -entity.faceX * SPIT_SPEED;
                entity.spitVy = -entity.faceY * SPIT_SPEED;
                entity.phase = "spit";
                entity.spitTimer = 0;
                spawnSpitBurst(spawnX, spawnY, tongueServices);
              }
              return;
            }

            if (entity.phase === "spit") {
              entity.spitTimer += dt;
              const progress = clamp(entity.spitTimer / TONGUE_GROW_TIME, 0, 1);
              target.radius = entity.captureState.radius * (2 / DEFAULT_RADIUS + progress * (1 - 2 / DEFAULT_RADIUS));
              const motion = arena.advanceMotion({ x: target.x, y: target.y, radius: target.radius,
                vx: entity.spitVx, vy: entity.spitVy }, dt);
              target.x = motion.x; target.y = motion.y;
              entity.spitVx = motion.vx; entity.spitVy = motion.vy;
              target.prevX = target.x;
              target.prevY = target.y;
              if (progress >= 1) {
                finishTongue(entity, true);
              }
              return;
            }
          },
          draw({ entity }, context) {
            drawTongue(entity, context);
          }
        });
      }

      function restoreTarget(entity) {
        const saved = entity.captureState;
        if (!saved) return;
        entity.captureState = null;
        entity.captured = false;
        const target = entity.target;
        target.radius = saved.radius;
        Object.assign(target, saved.arena.clampPoint(target.x, target.y, target.radius));
        target.prevX = target.x;
        target.prevY = target.y;
        target.positionLocked = saved.positionLocked;
        target.vx = saved.vx;
        target.vy = saved.vy;
        target.storedVx = saved.storedVx;
        target.storedVy = saved.storedVy;
        // A slow expiring during capture must still be recomposed by the engine.
        target.speedNeedsNormalization = target.speedNeedsNormalization || saved.speedNeedsNormalization;
        if (saved.speedMultiplier <= EPSILON && target.speedMultiplier > EPSILON && target.speedNeedsNormalization) {
          const heading = normalize(target.speedHeadingX || 0, target.speedHeadingY || 0);
          target.storedVx = heading.x;
          target.storedVy = heading.y;
        }
        if (entity.completed) {
          const heading = normalize(entity.spitVx, entity.spitVy);
          const speed = Math.hypot(target.storedVx, target.storedVy);
          target.speedHeadingX = heading.x;
          target.speedHeadingY = heading.y;
          target.storedVx = heading.x * speed;
          target.storedVy = heading.y * speed;
          target.vx = target.storedVx;
          target.vy = target.storedVy;
        }
        if (services.isMovementLocked(target)) target.vx = target.vy = 0;
      }

      return {
        update(context, dt) {
          const ball = context.ball;
          reapTongue();
          leafTimer += dt;
          if (!tongue) tongueTimer = Math.min(TONGUE_COOLDOWN, tongueTimer + dt);
          // 舌头冷却到期先触发（放在任何提前 return 的分支之前，防止冷却悬空导致步进卡死）
          if (!tongue && tongueTimer >= TONGUE_COOLDOWN) {
            const tongueTarget = services.getOpponent();
            if (tongueTarget) {
              tongueTimer = 0;
              startTongue(ball, tongueTarget);
            }
          }
          const aliveLeaves = leaves.filter((leaf) => leaf && leaf.entityActive !== false);
          if (leafTimer >= LEAF_INTERVAL) {
            leafTimer = 0;
            if (aliveLeaves.length >= LEAF_MAX) sinkOldestLeaf(aliveLeaves);
            spawnLeaf(context.game);
          }
          leaves = leaves.filter((leaf) => leaf && leaf.entityActive !== false);

          const enemy = services.getOpponent();
          if (enemy && Math.hypot(enemy.x - ball.x, enemy.y - ball.y) > 14) {
            facing = normalize(enemy.x - ball.x, enemy.y - ball.y);
          }

          if (leap) {
            leap.t += dt;
            if (leap.phase === "attach") {
              // 短暂吸附到荷叶中心
              const progress = clamp(leap.t / LEAP_ATTACH_TIME, 0, 1);
              ball.x = leap.attachFromX + (leap.attachToX - leap.attachFromX) * progress;
              ball.y = leap.attachFromY + (leap.attachToY - leap.attachFromY) * progress;
              ball.prevX = ball.x;
              ball.prevY = ball.y;
              if (progress >= 1) {
                leap.phase = "jump";
                leap.t = 0;
                spawnLeapEffects(leap.jumpFromX, leap.jumpFromY, leap.jumpToX, leap.jumpToY, services);
              }
              return;
            }
            // 跳跃：抛物线跳过去
            const progress = clamp(leap.t / LEAP_JUMP_TIME, 0, 1);
            ball.x = leap.jumpFromX + (leap.jumpToX - leap.jumpFromX) * progress;
            ball.y = leap.jumpFromY + (leap.jumpToY - leap.jumpFromY) * progress - Math.sin(progress * Math.PI) * LEAP_ARC;
            ball.prevX = ball.x;
            ball.prevY = ball.y;
            if (progress >= 1) {
              services.setMovementLocked(false);
              lastLeapLeaf = leap.toLeaf;
              leap = null;
            }
            return;
          }

          const onLeaf = currentLeaf(ball);
          if (onLeaf && onLeaf !== lastLeapLeaf) {
            startLeap(ball, onLeaf);
            return;
          }
        },
        updateWhilePaused(context, dt) {
          const ball = context.ball;
          reapTongue();
          // 被控状态（眩晕等）不刷新荷叶：不能使用能力；
          // 已经开始的跳跃仍照常推进，避免青蛙卡在半空
          leaves = leaves.filter((leaf) => leaf && leaf.entityActive !== false);
          const enemy = services.getOpponent();
          if (enemy && Math.hypot(enemy.x - ball.x, enemy.y - ball.y) > 14) {
            facing = normalize(enemy.x - ball.x, enemy.y - ball.y);
          }
          // 被控期间跳跃照常推进，避免蛙卡在半空
          if (leap) {
            leap.t += dt;
            if (leap.phase === "attach") {
              const progress = clamp(leap.t / LEAP_ATTACH_TIME, 0, 1);
              ball.x = leap.attachFromX + (leap.attachToX - leap.attachFromX) * progress;
              ball.y = leap.attachFromY + (leap.attachToY - leap.attachFromY) * progress;
              ball.prevX = ball.x;
              ball.prevY = ball.y;
              if (progress >= 1) {
                leap.phase = "jump";
                leap.t = 0;
                spawnLeapEffects(leap.jumpFromX, leap.jumpFromY, leap.jumpToX, leap.jumpToY, services);
              }
              return;
            }
            const progress = clamp(leap.t / LEAP_JUMP_TIME, 0, 1);
            ball.x = leap.jumpFromX + (leap.jumpToX - leap.jumpFromX) * progress;
            ball.y = leap.jumpFromY + (leap.jumpToY - leap.jumpFromY) * progress - Math.sin(progress * Math.PI) * LEAP_ARC;
            ball.prevX = ball.x;
            ball.prevY = ball.y;
            if (progress >= 1) {
              services.setMovementLocked(false);
              lastLeapLeaf = leap.toLeaf;
              leap = null;
            }
          }
        },
        getContactProfile() {
          // 跳跃期间像重锤飞行一样：无物理碰撞 + 不可被攻击（含免伤）
          return leap ? { physical: false, targetable: false } : undefined;
        },
        getNextTransitionIn() {
          // 舌头在冷却中才需要按冷却边界切步；已到冷却但可攻击目标不存在时，
          // 不应返回微小步长导致模拟空转，交给荷叶边界即可
          const tongueBoundary = tongue || tongueTimer >= TONGUE_COOLDOWN
            ? Infinity
            : TONGUE_COOLDOWN - tongueTimer;
          return Math.max(EPSILON, Math.min(
            LEAF_INTERVAL - leafTimer,
            tongueBoundary
          ));
        },

        drawBody(context, canvasContext) {
          const ball = context.ball;
          const tonguePhase = tongue ? tongue.phase : null;
          // 脸朝敌人：嘴在朝敌方向，眼睛（眼白）在敌人反方向那一侧，瞳孔固定居中
          const faceDir = tongue ? { x: tongue.faceX, y: tongue.faceY } : facing;
          const eyeDirX = -faceDir.x;
          const eyeDirY = -faceDir.y;
          const perpX = -eyeDirY;
          const perpY = eyeDirX;
          canvasContext.save();
          canvasContext.translate(ball.x, ball.y);
          // 身体
          canvasContext.fillStyle = "#7dc93e";
          canvasContext.beginPath();
          canvasContext.arc(0, 0, ball.radius, 0, TWO_PI);
          canvasContext.fill();
          canvasContext.strokeStyle = "#3c7a20";
          canvasContext.lineWidth = 1.2;
          canvasContext.stroke();
          // 嘴：朝敌方向凸出球缘，舌头从这里伸出
          const mouthX = faceDir.x * 9;
          const mouthY = faceDir.y * 9;
          if (tonguePhase === "extend" || tonguePhase === "retract" || tonguePhase === "swallow" || tonguePhase === "spit") {
            canvasContext.fillStyle = "#5e2f2c";
            canvasContext.beginPath();
            canvasContext.ellipse(mouthX, mouthY, 5.8, 4.4, Math.atan2(faceDir.y, faceDir.x), 0, TWO_PI);
            canvasContext.fill();
            canvasContext.strokeStyle = "#ff9db4";
            canvasContext.lineWidth = 1.4;
            canvasContext.stroke();
          } else {
            canvasContext.strokeStyle = "#ff9db4";
            canvasContext.lineWidth = 1.6;
            canvasContext.beginPath();
            canvasContext.arc(mouthX, mouthY, 3.4, -0.9, 0.9);
            canvasContext.stroke();
          }
          // 眼睛：眼白在敌人反方向侧、两只分开排布，瞳孔固定在眼白中心不动
          for (const side of [-1, 1]) {
            const eyeBaseX = eyeDirX * 7 + perpX * side * 4.5;
            const eyeBaseY = eyeDirY * 7 + perpY * side * 4.5;
            canvasContext.fillStyle = "#ffffff";
            canvasContext.beginPath();
            canvasContext.arc(eyeBaseX, eyeBaseY, 5, 0, TWO_PI);
            canvasContext.fill();
            canvasContext.strokeStyle = "#3c7a20";
            canvasContext.lineWidth = 1;
            canvasContext.stroke();
            canvasContext.fillStyle = "#17240f";
            canvasContext.beginPath();
            canvasContext.arc(eyeBaseX, eyeBaseY, 2.3, 0, TWO_PI);
            canvasContext.fill();
          }
          // 高光
          canvasContext.fillStyle = "rgba(255, 255, 255, 0.35)";
          canvasContext.beginPath();
          canvasContext.arc(-5, -4, 3.4, 0, TWO_PI);
          canvasContext.fill();
          canvasContext.restore();
          return true;
        },

        onDeath: cleanup,
        onBorrowEnd: cleanup
      };
    }
  };

  registerBall(frogDefinition);
  return { frogDefinition };
});
