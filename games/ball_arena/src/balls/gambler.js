(function initializeGambler(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createGamblerPlugin({ registerBall, resolveArenaGeometry }) {
  // The gambler fills its whole hand in a fixed 2s window (cards appear one
  // by one inside it, no matter how large the hand grows), pauses 1s to aim,
  // then fans the hand at the enemy before a 1s cooldown. The hand starts at
  // three cards and grows by one each round.
  const FILL_DURATION = 2;
  const AIM_WAIT = 1;
  const COOLDOWN_DURATION = 1;
  const INITIAL_HAND = 3;
  const FIRE_AT = FILL_DURATION + AIM_WAIT;
  const ROUND_END = FIRE_AT + COOLDOWN_DURATION;
  // Cards are bullets: 25 long, 18 wide, launched at speed 300.
  const CARD_SPEED = 300;
  const CARD_LENGTH = 25;
  const CARD_WIDTH = 18;
  const CARD_PROJECTILE_RADIUS = 7;
  // Held cards sit on a ring 35 units from the body center, 15 degrees apart.
  const RING_RADIUS = 35;
  const CARD_ANGLE_STEP = 15 * Math.PI / 180;
  const EPSILON = 1e-9;

  const RANK_LABELS = Object.freeze([
    "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"
  ]);
  const SUIT_SYMBOLS = Object.freeze(["\u2660", "\u2665", "\u2666", "\u2663"]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function roundedRectPath(context, x, y, width, height, radius) {
    const corner = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + corner, y);
    context.lineTo(x + width - corner, y);
    context.quadraticCurveTo(x + width, y, x + width, y + corner);
    context.lineTo(x + width, y + height - corner);
    context.quadraticCurveTo(x + width, y + height, x + width - corner, y + height);
    context.lineTo(x + corner, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - corner);
    context.lineTo(x, y + corner);
    context.quadraticCurveTo(x, y, x + corner, y);
    context.closePath();
  }

  function fillCardAt(index, count) {
    return (index + 1) * FILL_DURATION / count;
  }

  function isRedSuit(suit) {
    return suit === 1 || suit === 2;
  }

  function drawCard(context, x, y, rank, suit, rotation = 0) {
    const halfLength = CARD_LENGTH / 2;
    const halfWidth = CARD_WIDTH / 2;
    const label = RANK_LABELS[rank - 1];
    const symbol = SUIT_SYMBOLS[suit];
    const ink = isRedSuit(suit) ? "#c8102e" : "#23211c";

    context.save();
    context.translate(Math.round(x), Math.round(y));
    if (rotation) context.rotate(rotation);

    // Card face and frame.
    context.fillStyle = "#f6f2e8";
    roundedRectPath(context, -halfLength, -halfWidth, CARD_LENGTH, CARD_WIDTH, 2);
    context.fill();
    context.strokeStyle = "#23211c";
    context.lineWidth = 1;
    context.stroke();

    // The rank is written vertically (rotated 90 degrees) so a single glyph
    // spans the card's long axis and stays readable at card scale.
    context.save();
    context.rotate(-Math.PI / 2);
    context.fillStyle = ink;
    context.font = label.length > 1
      ? "700 13px 'Courier New', Consolas, monospace"
      : "700 15px 'Courier New', Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 0, 0);
    context.restore();

    // Small suit pip near the trailing edge.
    context.fillStyle = ink;
    context.font = "700 7px 'Courier New', Consolas, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(symbol, -halfLength + 5, 0);

    context.restore();
  }

  function createCardProjectile(source, startX, startY, angle, rank, suit) {
    return {
      kind: "gambler-card",
      life: 2.2,
      radius: CARD_PROJECTILE_RADIUS,
      damage: rank,
      rank,
      suit,
      x: startX,
      y: startY,
      vx: Math.cos(angle) * CARD_SPEED,
      vy: Math.sin(angle) * CARD_SPEED,
      update({ effect, game, services: entityServices }, dt) {
        const startX = effect.x;
        const startY = effect.y;
        effect.x += effect.vx * dt;
        effect.y += effect.vy * dt;
        const hit = entityServices.getFirstEnemyHit(
          startX,
          startY,
          effect.x,
          effect.y,
          effect.radius
        );
        if (hit && entityServices.dealDamage(hit, effect.damage)) {
          effect.life = 0;
          return;
        }
        if (
          game.arena ? !game.arena.intersectsCircle(effect.x, effect.y, CARD_LENGTH) : (
            !resolveArenaGeometry(game).intersectsCircle(effect.x, effect.y, CARD_LENGTH))
        ) {
          effect.life = 0;
        }
      },
      draw({ effect }, context) {
        drawCard(
          context,
          effect.x,
          effect.y,
          effect.rank,
          effect.suit,
          Math.atan2(effect.vy, effect.vx)
        );
      }
    };
  }

  const gamblerDefinition = {
    id: "gambler",
    name: "赌徒",
    englishName: "Gambler",
    color: "#ff0000",
    description: "手牌填充 / 扑克牌扇形射击",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    // Rion borrows the gambler just long enough to fill and fan a starting hand.
    rionCycleDuration: FIRE_AT,
    createBehavior(services) {
      let cycleTime = 0;
      let attackCount = INITIAL_HAND;
      let nextCardIndex = 0;
      let heldCards = [];
      let fired = false;

      function newCard() {
        const rank = 1 + Math.floor(Math.random() * RANK_LABELS.length);
        const suit = Math.floor(Math.random() * SUIT_SYMBOLS.length);
        return { rank, suit };
      }

      function aimAngleFrom(originX, originY, ball) {
        const enemy = services.getOpponent();
        const fallbackX = ball.storedVx || ball.vx || 1;
        const fallbackY = ball.storedVy || ball.vy || 0;
        if (enemy) {
          let directionX = enemy.x - originX;
          let directionY = enemy.y - originY;
          const magnitude = Math.hypot(directionX, directionY);
          if (magnitude <= EPSILON) {
            return Math.atan2(fallbackY, fallbackX);
          }
          return Math.atan2(directionY, directionX);
        }
        return Math.atan2(fallbackY, fallbackX);
      }

      function cardAngle(index) {
        return (index - (attackCount - 1) / 2) * CARD_ANGLE_STEP;
      }

      function fireAll(ball) {
        const baseAngle = aimAngleFrom(ball.x, ball.y, ball);
        const cards = heldCards;
        heldCards = [];
        for (let index = 0; index < cards.length; index += 1) {
          const angle = baseAngle + cardAngle(index);
          const startX = ball.x + Math.cos(angle) * RING_RADIUS;
          const startY = ball.y + Math.sin(angle) * RING_RADIUS;
          services.spawnProjectile(createCardProjectile(
            ball,
            startX,
            startY,
            angle,
            cards[index].rank,
            cards[index].suit
          ));
        }
      }

      return {
        isAttackCycleComplete() { return fired; },
        drawBorrowedWeapon(context, canvasContext) { this.drawAfter(context, canvasContext); },
        update(_context, dt) {
          cycleTime = Math.min(ROUND_END, cycleTime + Math.max(0, dt));
        },
        getNextTransitionIn() {
          let next = ROUND_END - cycleTime;
          if (nextCardIndex < attackCount) {
            next = Math.min(
              next,
              Math.max(0, fillCardAt(nextCardIndex, attackCount) - cycleTime)
            );
          } else if (!fired) {
            next = Math.min(next, Math.max(0, FIRE_AT - cycleTime));
          }
          return Math.max(EPSILON, next);
        },
        afterUpdateStep(context) {
          const { ball } = context;
          if (nextCardIndex < attackCount) {
            while (nextCardIndex < attackCount) {
              if (cycleTime + EPSILON < fillCardAt(nextCardIndex, attackCount)) break;
              heldCards.push(newCard());
              nextCardIndex += 1;
            }
          }
          if (
            !fired &&
            nextCardIndex >= attackCount &&
            cycleTime + EPSILON >= FIRE_AT
          ) {
            fired = true;
            fireAll(ball);
          }
          if (cycleTime + EPSILON >= ROUND_END) {
            cycleTime = 0;
            attackCount += 1;
            nextCardIndex = 0;
            heldCards = [];
            fired = false;
          }
        },
        drawAfter(context, canvasContext) {
          if (heldCards.length === 0) return;
          const { ball } = context;
          const baseAngle = aimAngleFrom(ball.x, ball.y, ball);
          for (let index = 0; index < heldCards.length; index += 1) {
            const angle = baseAngle + cardAngle(index);
            const x = ball.x + Math.cos(angle) * RING_RADIUS;
            const y = ball.y + Math.sin(angle) * RING_RADIUS;
            // Each card points from its own centre straight at the enemy.
            drawCard(
              canvasContext,
              x,
              y,
              heldCards[index].rank,
              heldCards[index].suit,
              aimAngleFrom(x, y, ball)
            );
          }
        }
      };
    }
  };

  registerBall(gamblerDefinition);
  return {
    gamblerDefinition,
    GAMBLER_FILL_DURATION: FILL_DURATION,
    GAMBLER_AIM_WAIT: AIM_WAIT,
    GAMBLER_COOLDOWN_DURATION: COOLDOWN_DURATION,
    GAMBLER_INITIAL_HAND: INITIAL_HAND,
    GAMBLER_CARD_SPEED: CARD_SPEED,
    GAMBLER_RING_RADIUS: RING_RADIUS,
    GAMBLER_CARD_ANGLE_STEP: CARD_ANGLE_STEP,
    GAMBLER_FIRE_TIME: FIRE_AT,
    createCardProjectile,
    drawCard
  };
});
