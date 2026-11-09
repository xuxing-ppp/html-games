(function initializeOrder(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createOrderPlugin({ registerBall }) {
  const NORMAL_DURATION = 3.5;
  const TRANSFER_DURATION = 0.75;
  const COURT_FADE_DURATION = 0.35;
  const GAVEL_DURATION = 0.55;
  const GAVEL_STRIKE_TIME = 0.32;
  const ATTACK_DAMAGE = 25;
  const COLLISION_DAMAGE = 15;
  const ARROW_DAMAGE = 20;
  const SIGN_ALPHA = 0.34;
  const SPARK_SPACING = 9;
  const EPSILON = 1e-9;
  const SIGNS = Object.freeze([
    { id: "no-attack", kind: "attack", prohibited: true },
    { id: "no-collision", kind: "collision", prohibited: true },
    { id: "right", kind: "arrow", x: 1, y: 0 },
    { id: "down", kind: "arrow", x: 0, y: 1 },
    { id: "left", kind: "arrow", x: -1, y: 0 },
    { id: "up", kind: "arrow", x: 0, y: -1 }
  ]);

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function easeInOutCubic(value) {
    const progress = clamp(value, 0, 1);
    return progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
  }

  function mix(from, to, progress) {
    return from + (to - from) * progress;
  }

  function chooseSign() {
    const index = Math.min(SIGNS.length - 1, Math.floor(Math.random() * SIGNS.length));
    return SIGNS[index];
  }

  function createTransferSpark(x, y, index) {
    return {
      kind: "order-transfer-spark",
      life: 0.28,
      x,
      y,
      size: index % 3 === 0 ? 4 : 3,
      diagonal: index % 2 === 0,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const size = effect.size * (1 - progress * 0.35);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#f3f6fa";
        context.lineWidth = 1;
        context.beginPath();
        if (effect.diagonal) {
          context.moveTo(effect.x - size, effect.y - size);
          context.lineTo(effect.x + size, effect.y + size);
          context.moveTo(effect.x + size, effect.y - size);
          context.lineTo(effect.x - size, effect.y + size);
        } else {
          context.moveTo(effect.x - size, effect.y);
          context.lineTo(effect.x + size, effect.y);
          context.moveTo(effect.x, effect.y - size);
          context.lineTo(effect.x, effect.y + size);
        }
        context.stroke();
        context.restore();
      }
    };
  }

  function createCrossSlash(target) {
    const baseAngle = Math.random() * Math.PI;
    const fragments = Array.from({ length: 8 }, (_, index) => {
      const angle = baseAngle + (index % 2) * Math.PI / 2 + (Math.random() - 0.5) * 0.5;
      const speed = 55 + Math.random() * 80;
      return {
        x: target.x + (Math.random() - 0.5) * target.radius,
        y: target.y + (Math.random() - 0.5) * target.radius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: index % 3 === 0 ? 3 : 2
      };
    });
    return {
      kind: "order-cross-slash",
      life: 0.38,
      x: target.x,
      y: target.y,
      baseAngle,
      fragments,
      update({ effect }, dt) {
        effect.fragments.forEach((fragment) => {
          fragment.x += fragment.vx * dt;
          fragment.y += fragment.vy * dt;
        });
      },
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        const head = 1 - Math.pow(1 - clamp(progress / 0.28, 0, 1), 3);
        const tail = Math.pow(clamp((progress - 0.08) / 0.78, 0, 1), 3);
        const alpha = progress < 0.68 ? 1 : (1 - progress) / 0.32;
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= Math.max(0, alpha);
        context.lineCap = "butt";
        for (let index = 0; index < 2; index += 1) {
          const angle = effect.baseAngle + index * Math.PI / 2;
          const directionX = Math.cos(angle);
          const directionY = Math.sin(angle);
          const startDistance = mix(-36, 36, tail);
          const endDistance = mix(-36, 36, head);
          const gradient = context.createLinearGradient(
            effect.x + directionX * startDistance,
            effect.y + directionY * startDistance,
            effect.x + directionX * endDistance,
            effect.y + directionY * endDistance
          );
          gradient.addColorStop(0, "rgba(100, 0, 10, 0)");
          gradient.addColorStop(0.45, "rgba(255, 18, 42, 0.72)");
          gradient.addColorStop(0.78, "rgba(255, 220, 225, 1)");
          gradient.addColorStop(1, "rgba(255, 30, 50, 0)");
          context.strokeStyle = gradient;
          context.lineWidth = 4;
          context.beginPath();
          context.moveTo(
            effect.x + directionX * startDistance,
            effect.y + directionY * startDistance
          );
          context.lineTo(
            effect.x + directionX * endDistance,
            effect.y + directionY * endDistance
          );
          context.stroke();
        }
        context.fillStyle = "#a90020";
        effect.fragments.forEach((fragment) => {
          context.globalAlpha = Math.max(0, 1 - progress);
          context.fillRect(fragment.x, fragment.y, fragment.size, fragment.size);
        });
        context.restore();
      }
    };
  }

  function createGavelImpact(x, y) {
    return {
      kind: "order-gavel-impact",
      life: 0.3,
      x,
      y,
      draw({ effect }, context) {
        const progress = clamp(effect.age / effect.life, 0, 1);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha *= 1 - progress;
        context.strokeStyle = "#ffd49a";
        context.lineWidth = 3 * (1 - progress * 0.5);
        context.beginPath();
        context.ellipse(
          effect.x,
          effect.y,
          8 + progress * 28,
          3 + progress * 9,
          0,
          0,
          Math.PI * 2
        );
        context.stroke();
        context.restore();
      }
    };
  }

  function drawSword(context, size) {
    context.save();
    context.rotate(-Math.PI / 4);
    context.fillStyle = "#dfe5ec";
    context.beginPath();
    context.moveTo(0, -size * 0.58);
    context.lineTo(size * 0.1, -size * 0.12);
    context.lineTo(0, size * 0.08);
    context.lineTo(-size * 0.1, -size * 0.12);
    context.closePath();
    context.fill();
    context.fillStyle = "#808995";
    context.fillRect(-size * 0.22, size * 0.06, size * 0.44, size * 0.08);
    context.fillRect(-size * 0.055, size * 0.12, size * 0.11, size * 0.34);
    context.restore();
  }

  function drawCollision(context, size) {
    context.strokeStyle = "#e1e6ec";
    context.lineWidth = Math.max(2, size * 0.035);
    context.beginPath();
    context.arc(-size * 0.18, 0, size * 0.22, 0, Math.PI * 2);
    context.arc(size * 0.18, 0, size * 0.22, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-size * 0.52, -size * 0.2);
    context.lineTo(-size * 0.34, -size * 0.1);
    context.moveTo(size * 0.52, size * 0.2);
    context.lineTo(size * 0.34, size * 0.1);
    context.stroke();
  }

  function drawArrow(context, sign, size) {
    const angle = Math.atan2(sign.y, sign.x);
    context.save();
    context.rotate(angle);
    context.fillStyle = "#e3e8ee";
    context.beginPath();
    context.moveTo(size * 0.52, 0);
    context.lineTo(size * 0.12, -size * 0.28);
    context.lineTo(size * 0.12, -size * 0.11);
    context.lineTo(-size * 0.48, -size * 0.11);
    context.lineTo(-size * 0.48, size * 0.11);
    context.lineTo(size * 0.12, size * 0.11);
    context.lineTo(size * 0.12, size * 0.28);
    context.closePath();
    context.fill();
    context.restore();
  }

  function drawProhibition(context, size) {
    context.strokeStyle = "#ef2438";
    context.lineWidth = Math.max(4, size * 0.07);
    context.beginPath();
    context.arc(0, 0, size * 0.48, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(-size * 0.34, -size * 0.34);
    context.lineTo(size * 0.34, size * 0.34);
    context.stroke();
  }

  function drawJudgeProps(context, ball, opacity, gavelProgress, weaponOnly = false) {
    if (opacity <= 0) return;
    const strikeProgress = GAVEL_STRIKE_TIME / GAVEL_DURATION;
    let angle;
    if (gavelProgress <= strikeProgress) {
      angle = mix(
        -0.78,
        0.55,
        Math.pow(clamp(gavelProgress / strikeProgress, 0, 1), 3)
      );
    } else {
      const rebound = clamp((gavelProgress - strikeProgress) / (1 - strikeProgress), 0, 1);
      angle = 0.55 - Math.sin(rebound * Math.PI) * 0.1 * (1 - rebound);
    }

    context.save();
    context.globalAlpha *= opacity;
    context.translate(ball.x, ball.y);

    context.fillStyle = "#eef1f4";
    context.strokeStyle = "#aeb6c0";
    context.lineWidth = 1;
    const curls = [
      [-14, -19, 7], [-7, -23, 8], [1, -24, 8], [9, -22, 8], [15, -17, 7],
      [-17, -11, 7], [17, -10, 7], [-14, -5, 6], [15, -4, 6]
    ];
    if (!weaponOnly) curls.forEach(([x, y, radius]) => {
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });

    context.fillStyle = "#6d3f20";
    context.strokeStyle = "#3c2415";
    context.lineWidth = 2;
    context.beginPath();
    context.ellipse(61, 31, 20, 7, 0, 0, Math.PI * 2);
    context.fill();
    context.stroke();
    context.fillStyle = "#9a5d2d";
    context.fillRect(43, 24, 36, 7);

    context.save();
    context.translate(25, 0);
    context.rotate(angle);
    context.fillStyle = "#9d6334";
    context.strokeStyle = "#432817";
    context.lineWidth = 2;
    context.fillRect(0, -3, 43, 6);
    context.strokeRect(0, -3, 43, 6);
    context.fillStyle = "#754421";
    context.fillRect(36, -11, 18, 22);
    context.strokeRect(36, -11, 18, 22);
    context.fillStyle = "#b77a43";
    context.fillRect(39, -8, 12, 5);
    context.restore();

    context.restore();
  }

  function drawSign(context, sign, arenaSize, opacity) {
    if (!sign || opacity <= 0) return;
    const size = Math.min(120, arenaSize * 0.32);
    context.save();
    context.translate(arenaSize / 2, arenaSize / 2);
    context.globalAlpha *= opacity;
    context.globalCompositeOperation = "lighter";
    if (sign.kind === "attack") drawSword(context, size);
    else if (sign.kind === "collision") drawCollision(context, size);
    else drawArrow(context, sign, size);
    if (sign.prohibited) drawProhibition(context, size);
    context.restore();
  }

  const orderDefinition = {
    id: "order",
    name: "\u6cd5\u5b98",
    englishName: "Judge",
    color: "#c8ced8",
    description: "\u9886\u57df\u89c4\u5219 / \u516d\u79cd\u6807\u5fd7",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services) {
      let phase = "normal";
      let phaseTime = 0;
      let sign = chooseSign();
      let signOpacity = SIGN_ALPHA;
      let courtOpacity = 0;
      let gavelProgress = 0;
      let judgmentApplied = false;
      let completedAttack = false;
      let origin = null;
      let savedVelocity = null;
      let damageSources = new Set();
      let collisionSources = new Set();
      let sparkRemainder = 0;
      let sparkIndex = 0;

      function resetRuleTracking() {
        damageSources = new Set();
        collisionSources = new Set();
      }

      function damageEnemy(target, amount, ball) {
        if (!target || target.hp <= 0) return;
        if (!services.dealDamage(target, amount, ball, { orderRuleDamage: true })) return;
        services.spawnVisualEffect(createCrossSlash(target));
      }

      function targetKey(target) {
        return target.instanceId || target.id;
      }

      function applyJudgment(ball) {
        if (judgmentApplied) return;
        judgmentApplied = true;
        services.forEachEnemy((target) => {
          const key = targetKey(target);
          if (sign.id === "no-attack" && damageSources.has(key)) {
            damageEnemy(target, ATTACK_DAMAGE, ball);
          } else if (sign.id === "no-collision" && collisionSources.has(key)) {
            damageEnemy(target, COLLISION_DAMAGE, ball);
          } else if (
            sign.kind === "arrow" &&
            target.vx * sign.x + target.vy * sign.y < -EPSILON
          ) {
            damageEnemy(target, ARROW_DAMAGE, ball);
          }
        });
        services.spawnVisualEffect(createGavelImpact(
          ball.x + 61,
          ball.y + 31
        ));
      }

      function enterDomain(ball) {
        phase = "enter";
        phaseTime = 0;
        origin = { x: ball.x, y: ball.y };
        savedVelocity = {
          x: ball.storedVx || ball.vx,
          y: ball.storedVy || ball.vy
        };
        sparkRemainder = 0;
        sparkIndex = 0;
        courtOpacity = 0;
        gavelProgress = 0;
        judgmentApplied = false;
        services.setMovementLocked(true);
      }

      function beginCourt(ball, game) {
        phase = "court-in";
        phaseTime = 0;
        courtOpacity = 0;
        gavelProgress = 0;
        ball.x = game.arenaSize / 2;
        ball.y = game.arenaSize / 2;
      }

      function beginGavel() {
        phase = "gavel";
        phaseTime = 0;
        courtOpacity = 1;
        gavelProgress = 0;
      }

      function beginCourtFade() {
        phase = "court-out";
        phaseTime = 0;
        courtOpacity = 1;
        gavelProgress = 1;
      }

      function beginExit() {
        phase = "exit";
        phaseTime = 0;
        courtOpacity = 0;
        signOpacity = 0;
        sparkRemainder = 0;
        sparkIndex = 0;
      }

      function finishDomain(ball) {
        completedAttack = true;
        phase = "normal";
        phaseTime = 0;
        ball.x = origin.x;
        ball.y = origin.y;
        ball.storedVx = savedVelocity.x;
        ball.storedVy = savedVelocity.y;
        ball.vx = savedVelocity.x;
        ball.vy = savedVelocity.y;
        services.setMovementLocked(false);
        origin = null;
        savedVelocity = null;
        sign = chooseSign();
        signOpacity = SIGN_ALPHA;
        courtOpacity = 0;
        gavelProgress = 0;
        judgmentApplied = false;
        resetRuleTracking();
      }

      function leaveTransferSparks(ball, previousX, previousY) {
        const deltaX = ball.x - previousX;
        const deltaY = ball.y - previousY;
        const distance = Math.hypot(deltaX, deltaY);
        if (distance <= EPSILON) return;
        const directionX = deltaX / distance;
        const directionY = deltaY / distance;
        let next = SPARK_SPACING - sparkRemainder;
        while (next <= distance + EPSILON) {
          services.spawnVisualEffect(createTransferSpark(
            previousX + directionX * next,
            previousY + directionY * next,
            sparkIndex
          ));
          sparkIndex += 1;
          next += SPARK_SPACING;
        }
        sparkRemainder = (sparkRemainder + distance) % SPARK_SPACING;
      }

      function updateTransfer(ball, start, end) {
        const previousX = ball.x;
        const previousY = ball.y;
        const progress = easeInOutCubic(phaseTime / TRANSFER_DURATION);
        ball.x = mix(start.x, end.x, progress);
        ball.y = mix(start.y, end.y, progress);
        leaveTransferSparks(ball, previousX, previousY);
      }

      function anchorDomainPosition(ball, game) {
        const center = { x: game.arenaSize / 2, y: game.arenaSize / 2 };
        if (phase === "enter") {
          const progress = easeInOutCubic(phaseTime / TRANSFER_DURATION);
          ball.x = mix(origin.x, center.x, progress);
          ball.y = mix(origin.y, center.y, progress);
        } else if (phase === "exit") {
          const progress = easeInOutCubic(phaseTime / TRANSFER_DURATION);
          ball.x = mix(center.x, origin.x, progress);
          ball.y = mix(center.y, origin.y, progress);
        } else {
          ball.x = center.x;
          ball.y = center.y;
        }
        ball.vx = 0;
        ball.vy = 0;
      }

      return {
        isAttackCycleComplete() { return completedAttack; },
        drawBorrowedWeapon(context, canvasContext) {
          drawJudgeProps(canvasContext, context.ball, 1, gavelProgress, true);
        },
        update(context, dt) {
          phaseTime += Math.max(0, dt);
          if (phase === "enter") {
            signOpacity = SIGN_ALPHA;
            updateTransfer(
              context.ball,
              origin,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 }
            );
          } else if (phase === "court-in") {
            courtOpacity = clamp(phaseTime / COURT_FADE_DURATION, 0, 1);
            gavelProgress = 0;
          } else if (phase === "gavel") {
            courtOpacity = 1;
            gavelProgress = clamp(phaseTime / GAVEL_DURATION, 0, 1);
          } else if (phase === "court-out") {
            const progress = clamp(phaseTime / COURT_FADE_DURATION, 0, 1);
            courtOpacity = 1 - progress;
            signOpacity = SIGN_ALPHA * (1 - progress);
          } else if (phase === "exit") {
            updateTransfer(
              context.ball,
              { x: context.game.arenaSize / 2, y: context.game.arenaSize / 2 },
              origin
            );
          }
        },
        getNextTransitionIn() {
          if (phase === "normal") return NORMAL_DURATION - phaseTime;
          if (phase === "court-in" || phase === "court-out") {
            return COURT_FADE_DURATION - phaseTime;
          }
          if (phase === "gavel") {
            if (!judgmentApplied) return GAVEL_STRIKE_TIME - phaseTime;
            return GAVEL_DURATION - phaseTime;
          }
          return TRANSFER_DURATION - phaseTime;
        },
        afterUpdateStep(context) {
          if (phase === "normal") {
            if (phaseTime + EPSILON >= NORMAL_DURATION) {
              enterDomain(context.ball);
            }
            return;
          }
          anchorDomainPosition(context.ball, context.game);
          if (phase === "enter" && phaseTime + EPSILON >= TRANSFER_DURATION) {
            beginCourt(context.ball, context.game);
          } else if (phase === "court-in" && phaseTime + EPSILON >= COURT_FADE_DURATION) {
            beginGavel();
          } else if (phase === "gavel" && !judgmentApplied && phaseTime + EPSILON >= GAVEL_STRIKE_TIME) {
            applyJudgment(context.ball);
          } else if (phase === "gavel" && phaseTime + EPSILON >= GAVEL_DURATION) {
            beginCourtFade();
          } else if (phase === "court-out" && phaseTime + EPSILON >= COURT_FADE_DURATION) {
            beginExit();
          } else if (phase === "exit" && phaseTime + EPSILON >= TRANSFER_DURATION) {
            finishDomain(context.ball);
          }
        },
        getContactProfile() {
          return phase === "normal"
            ? { solid: true, attackable: true }
            : { solid: false, attackable: false };
        },
        getCapabilityOverrides() {
          return phase !== "normal"
            ? { canAct: true, canBodyAttack: true, canDealDamage: true }
            : null;
        },
        onBeforeDamage(context, event) {
          if (phase !== "normal") return { amount: 0, showHitText: false };
          return event;
        },
        onDamaged(context, event) {
          if (
            phase !== "normal" ||
            !event.credit ||
            event.actor === context.ball ||
            event.options.orderRuleDamage
          ) return;
          damageSources.add(targetKey(event.credit));
        },
        onCollision(context, target) {
          if (phase !== "normal") return;
          collisionSources.add(targetKey(target));
        },
        drawArenaBackground(context, canvasContext) {
          drawSign(canvasContext, sign, context.game.arenaSize, signOpacity);
        },
        drawAfter(context, canvasContext) {
          drawJudgeProps(
            canvasContext,
            context.ball,
            courtOpacity,
            gavelProgress
          );
        }
      };
    }
  };

  registerBall(orderDefinition);
  return { orderDefinition };
});
