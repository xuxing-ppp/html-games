(function initializeCreditor(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? require("../core/ball-registry.js")
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createCreditorPlugin({ registerBall }) {
  const PRINCIPAL = 10;
  const BASE_INTEREST_RATE = 0.03;
  const COLLECTOR_INTERVAL = 4.3;
  // 收债范围：圆心距阈值 = 常量 + 目标半径（目标体积算进去，
  // 否则雪球这类长大的球贴上来时它的中心还在范围外）。
  const COLLECTOR_RANGE = 40;
  const COLLECTOR_SPEED = 150;
  const SWING_DURATION = 0.18;
  const EPSILON = 1e-9;

  function normalizeDirection(x, y, fallbackX = 1, fallbackY = 0) {
    let magnitude = Math.hypot(x, y);
    if (magnitude <= EPSILON) {
      x = fallbackX;
      y = fallbackY;
      magnitude = Math.hypot(x, y) || 1;
    }
    return { x: x / magnitude, y: y / magnitude };
  }

  function createDebtMarker(owner, target, getDebt) {
    return {
      kind: "creditor-debt-marker",
      life: 3600,
      targetInstanceId: target.instanceId,
      x: target.x,
      y: target.y - target.radius - 14,
      amount: Math.round(getDebt()),
      update({ effect }) {
        if (target.hp <= 0 || owner.hp <= 0) {
          effect.life = 0;
          return;
        }
        effect.x = target.x;
        effect.y = target.y - target.radius - 14;
        effect.amount = Math.round(getDebt());
      },
      draw({ effect }, context) {
        context.save();
        context.globalAlpha *= 0.92;
        context.font = "700 8px 'Ball Impact', Impact, monospace";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#ffe36f";
        context.fillText(`LOAN -${effect.amount}`, Math.round(effect.x), Math.round(effect.y));
        context.restore();
      }
    };
  }

  function drawCollector(context, ball, phase, swingProgress, targetAngle) {
    context.save();
    context.fillStyle = ball.color;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2d2926";
    context.beginPath();
    context.arc(ball.x, ball.y - 3, Math.max(0.05, ball.radius - 3), Math.PI, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f4d7b2";
    context.fillRect(ball.x - 6, ball.y - 2, 3, 3);
    context.fillRect(ball.x + 3, ball.y - 2, 3, 3);

    const sweep = phase === "swing" ? (-1.15 + swingProgress * 2.3) : -0.9;
    context.translate(ball.x, ball.y);
    context.rotate(targetAngle + sweep);
    context.fillStyle = "#3d2415";
    context.fillRect(0, -2.5, 27, 5);
    context.fillStyle = "#8b5b34";
    context.fillRect(2, -1.5, 22, 3);
    context.restore();
  }

  function drawCreditorBody(context, ball) {
    context.save();
    context.fillStyle = ball.color;
    context.beginPath();
    context.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha *= 0.68;
    context.fillStyle = "#fff0a3";
    context.font = "700 9px 'Ball Impact', Impact, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("$", ball.x, ball.y - 7);
    context.restore();
  }

  function createCollectorDefinition(targetInstanceId, getDebt, onCollected) {
    return {
      id: "creditor-collector",
      healthless: true,
      name: "\u8ba8\u503a\u4eba",
      color: "#80684e",
      stats: {
        radius: 15,
        speed: COLLECTOR_SPEED,
        maxHp: 1
      },
      createBehavior(services) {
        let phase = "approach";
        let phaseTime = 0;
        let targetAngle = 0;

        function currentTarget() {
          const target = services.getBall(targetInstanceId);
          return target && target.hp > 0 ? target : null;
        }

        // 收债范围要把目标体积算进去，否则长大的雪球贴上来时判不到。
        function withinCollectorRange(ball, target) {
          if (!ball || !target) return false;
          const targetRadius = Number.isFinite(target.radius) ? target.radius : 0;
          return Math.hypot(target.x - ball.x, target.y - ball.y) <=
            COLLECTOR_RANGE + targetRadius;
        }

        return {
          update(context, dt) {
            const target = currentTarget();
            if (!target) {
              context.ball.hp = 0;
              return;
            }
            targetAngle = Math.atan2(target.y - context.ball.y, target.x - context.ball.x);
            if (phase === "swing") {
              phaseTime = Math.min(SWING_DURATION, phaseTime + Math.max(0, dt));
              context.ball.vx = context.ball.vy = 0;
              return;
            }
            if (withinCollectorRange(context.ball, target)) {
              phase = "swing";
              phaseTime = 0;
              services.setMovementLocked(true);
              return;
            }
            const direction = normalizeDirection(
              target.x - context.ball.x,
              target.y - context.ball.y
            );
            context.ball.storedVx = direction.x * COLLECTOR_SPEED;
            context.ball.storedVy = direction.y * COLLECTOR_SPEED;
          },
          getNextTransitionIn() {
            if (phase !== "swing") return undefined;
            const boundary = SWING_DURATION - phaseTime;
            // 已经到期就别再返回微小步长（会让引擎空转）
            return boundary > EPSILON ? boundary : undefined;
          },
          afterUpdateStep(context) {
            if (phase !== "swing" || phaseTime + EPSILON < SWING_DURATION) return;
            const target = currentTarget();
            if (!target) {
              context.ball.hp = 0;
              return;
            }
            if (!withinCollectorRange(context.ball, target)) {
              phase = "approach";
              phaseTime = 0;
              services.setMovementLocked(false);
              return;
            }
            const amount = Math.max(1, Math.round(getDebt()));
            if (!services.dealDamage(target, amount, context.ball)) {
              phaseTime = 0;
              return;
            }
            onCollected();
            context.ball.hp = 0;
          },
          getContactProfile() {
            return { solid: false, attackable: false };
          },
          drawBody(context, canvasContext) {
            drawCollector(
              canvasContext,
              context.ball,
              phase,
              SWING_DURATION > 0 ? phaseTime / SWING_DURATION : 1,
              targetAngle
            );
            return true;
          },
          getHpDisplay() {
            return { text: "" };
          },
          getCollectorState() {
            return { phase, phaseTime, targetInstanceId };
          }
        };
      }
    };
  }

  const creditorDefinition = {
    id: "creditor",
    name: "\u503a\u4e3b",
    englishName: "Creditor",
    color: "#b69b4d",
    description: "\u590d\u5229\u8d37\u6b3e / \u8ba8\u503a\u4eba\u6728\u68cd\u6536\u6b3e",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    rionCycleDuration: 8.6,
    createBehavior(services) {
      let debt = PRINCIPAL;
      let collectorTimer = 0;
      let activeCollector = null;
      const markers = new Map();

      function refreshMarkers(ball) {
        services.forEachEnemy((target) => {
          const key = target.instanceId || target.id;
          if (markers.has(key) && markers.get(key).life > 0) return;
          markers.set(key, services.spawnVisualEffect(
            createDebtMarker(ball, target, () => debt)
          ));
        });
      }

      function resetDebt() {
        debt = PRINCIPAL;
        collectorTimer = 0;
        activeCollector = null;
      }

      function interestRate(ball) {
        return ball.hp < 40
          ? BASE_INTEREST_RATE + (40 - ball.hp) / 100
          : BASE_INTEREST_RATE;
      }

      return {
        onSpawn(context) {
          refreshMarkers(context.ball);
        },
        update(context, dt) {
          refreshMarkers(context.ball);
          if (activeCollector && activeCollector.hp <= 0) activeCollector = null;
          if (!activeCollector) {
            collectorTimer = Math.min(
              COLLECTOR_INTERVAL,
              collectorTimer + Math.max(0, dt)
            );
          }
        },
        getNextTransitionIn() {
          if (activeCollector) return undefined;
          const boundary = COLLECTOR_INTERVAL - collectorTimer;
          return boundary > EPSILON ? boundary : undefined;
        },
        afterUpdateStep(context) {
          if (activeCollector || collectorTimer + EPSILON < COLLECTOR_INTERVAL) return;
          const target = services.getOpponent();
          if (!target) return;
          collectorTimer = 0;
          activeCollector = services.spawnSummon(
            createCollectorDefinition(target.instanceId, () => debt, resetDebt),
            { x: context.ball.x, y: context.ball.y }
          );
        },
        onDamaged(context, event) {
          if (!event.actor || event.actor === context.ball || event.amount <= 0) return;
          debt *= 1 + interestRate(context.ball);
        },
        drawBody(context, canvasContext) {
          drawCreditorBody(canvasContext, context.ball);
          return true;
        },
        getDebtState() {
          return {
            debt,
            displayedDebt: Math.round(debt),
            collectorTimer,
            collectorInstanceId: activeCollector ? activeCollector.instanceId : null
          };
        }
      };
    }
  };

  registerBall(creditorDefinition);
  return { creditorDefinition };
});
