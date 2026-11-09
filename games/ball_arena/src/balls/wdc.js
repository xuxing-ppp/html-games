(function initializeWdc(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? Object.assign({}, require("../core/ball-registry.js"), require("../core/arena-geometry.js"))
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createWdcPlugin({ resolveArenaGeometry, registerBall }) {
  const NORMAL_DURATION = 2.5;
  const DOMAIN_DURATION = 3.5;
  const TRANSITION_DURATION = 0.45;
  const GRID_SIZE = 3;
  const EPSILON = 1e-9;

  const DOMAIN_BACKDROP = "rgba(30, 41, 59, 0.45)";
  const DOMAIN_GRID_LINE = "rgba(148, 163, 184, 0.55)";
  const DOMAIN_NUMBER_COLOR = "rgba(232, 238, 245, 0.72)";
  const DOMAIN_NUMBER_FONT = "700 18px 'Ball Impact', Impact, Haettenschweiler, sans-serif";
  const CELL_FLASH_COLOR = "#bfdbfe";
  const CELL_FLASH_DURATION = 0.25;

  const LATER_NUMBER_GROUPS = [
    [1, 15, 5],
    [16, 30, 3],
    [30, 45, 1]
  ];

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function randomInteger(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function shuffle(values) {
    const shuffled = values.slice();
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
  }

  function createFirstDomainNumbers() {
    return shuffle(Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => index + 1));
  }

  function createLaterDomainNumbers() {
    const numbers = LATER_NUMBER_GROUPS.flatMap(([min, max, count]) => (
      Array.from({ length: count }, () => randomInteger(min, max))
    ));
    return shuffle(numbers);
  }

  function createBinaryDomainNumbers() {
    return Array.from({ length: GRID_SIZE * GRID_SIZE }, () => (
      Math.random() < 0.5 ? 0 : 1
    ));
  }

  function gridOpacity(phase, phaseTime, completedDomains) {
    if (phase === "domain") return 1;
    if (completedDomains > 0 && phaseTime < TRANSITION_DURATION) {
      return 1 - phaseTime / TRANSITION_DURATION;
    }
    if (phaseTime > NORMAL_DURATION - TRANSITION_DURATION) {
      return (phaseTime - (NORMAL_DURATION - TRANSITION_DURATION)) / TRANSITION_DURATION;
    }
    return 0;
  }

  function cellIndexAt(x, y, arenaSize) {
    const arena = resolveArenaGeometry(arenaSize);
    const column = Math.floor(clamp(x - arena.left, 0, arena.width - EPSILON) / (arena.width / GRID_SIZE));
    const row = Math.floor(clamp(y - arena.top, 0, arena.height - EPSILON) / (arena.height / GRID_SIZE));
    return row * GRID_SIZE + column;
  }

  function drawDomainGrid(canvasContext, arenaSize, values, opacity, flashes = [], now = 0) {
    if (opacity <= 0) return;

    const arena = resolveArenaGeometry(arenaSize);
    const cellWidth = arena.width / GRID_SIZE, cellHeight = arena.height / GRID_SIZE;
    const gridAlpha = clamp(opacity, 0, 1);
    canvasContext.save();
    canvasContext.globalAlpha *= gridAlpha;

    // Dark blue-gray semi-transparent backdrop.
    canvasContext.fillStyle = DOMAIN_BACKDROP;
    canvasContext.fillRect(arena.left, arena.top, arena.width, arena.height);

    // Semi-transparent blue-gray grid lines.
    canvasContext.strokeStyle = DOMAIN_GRID_LINE;
    canvasContext.lineWidth = 1.5;
    canvasContext.beginPath();
    for (let line = 1; line < GRID_SIZE; line += 1) {
      const x = arena.left + Math.round(cellWidth * line) + 0.5;
      const y = arena.top + Math.round(cellHeight * line) + 0.5;
      canvasContext.moveTo(x, arena.top);
      canvasContext.lineTo(x, arena.bottom);
      canvasContext.moveTo(arena.left, y);
      canvasContext.lineTo(arena.right, y);
    }
    canvasContext.stroke();

    // Light up the cells hit by a recent collision-triggered attack.
    for (const flash of flashes) {
      const age = now - flash.time;
      if (age < 0 || age >= CELL_FLASH_DURATION) continue;
      const column = flash.index % GRID_SIZE;
      const row = Math.floor(flash.index / GRID_SIZE);
      canvasContext.globalAlpha = gridAlpha * (1 - age / CELL_FLASH_DURATION) * 0.85;
      canvasContext.fillStyle = CELL_FLASH_COLOR;
      canvasContext.fillRect(arena.left + column * cellWidth, arena.top + row * cellHeight, cellWidth, cellHeight);
    }
    canvasContext.globalAlpha = gridAlpha;

    // Cell values use the same Impact face as the HP readout.
    canvasContext.fillStyle = DOMAIN_NUMBER_COLOR;
    canvasContext.font = DOMAIN_NUMBER_FONT;
    canvasContext.textAlign = "center";
    canvasContext.textBaseline = "middle";
    values.forEach((value, index) => {
      const column = index % GRID_SIZE;
      const row = Math.floor(index / GRID_SIZE);
      canvasContext.fillText(
        String(value),
        Math.round(arena.left + (column + 0.5) * cellWidth),
        Math.round(arena.top + (row + 0.5) * cellHeight)
      );
    });
    canvasContext.restore();
  }

  const wdcDefinition = {
    id: "wdc",
    name: "WDC",
    englishName: "WDC",
    color: "#9ba7b7",
    description: "2.5秒普通 / 3.5秒九宫格领域",
    stats: {
      radius: 15,
      speed: 150,
      maxHp: 100
    },
    createBehavior(services, options = {}) {
      const alwaysDomain = options.alwaysDomain === true;
      const refreshInterval = Number.isFinite(options.refreshInterval) &&
        options.refreshInterval > 0
        ? options.refreshInterval
        : DOMAIN_DURATION;
      const createNumbers = typeof options.createDomainNumbers === "function"
        ? options.createDomainNumbers
        : (alwaysDomain ? createBinaryDomainNumbers : createFirstDomainNumbers);
      let phase = alwaysDomain ? "domain" : "normal";
      let phaseTime = 0;
      let refreshTime = 0;
      let completedDomains = 0;
      let nextNumbersPrepared = true;
      let domainNumbers = createNumbers();
      let cellFlashes = [];
      let lastTime = 0;

      function recordCellFlash(index, time) {
        cellFlashes = cellFlashes.filter((flash) => (
          time - flash.time < CELL_FLASH_DURATION
        ));
        cellFlashes.push({ index, time });
      }

      function transition(ball) {
        if (phase === "normal") {
          phase = "domain";
          phaseTime = 0;
          return;
        }

        phase = "normal";
        phaseTime = 0;
        completedDomains += 1;
        nextNumbersPrepared = false;
      }

      return {
        update(context, dt) {
          lastTime = context.game.time;
          const elapsed = Math.max(0, dt);
          if (alwaysDomain) {
            phaseTime += elapsed;
            refreshTime += elapsed;
            while (refreshTime + EPSILON >= refreshInterval) {
              refreshTime -= refreshInterval;
              domainNumbers = createNumbers();
              cellFlashes = [];
            }
            return;
          }
          const duration = phase === "normal" ? NORMAL_DURATION : DOMAIN_DURATION;
          phaseTime = Math.min(duration, phaseTime + elapsed);

          if (
            phase === "normal" &&
            completedDomains > 0 &&
            !nextNumbersPrepared &&
            phaseTime >= TRANSITION_DURATION
          ) {
            domainNumbers = createLaterDomainNumbers();
            nextNumbersPrepared = true;
          }
        },
        getNextTransitionIn() {
          if (alwaysDomain) return Math.max(EPSILON, refreshInterval - refreshTime);
          return (phase === "normal" ? NORMAL_DURATION : DOMAIN_DURATION) - phaseTime;
        },
        afterUpdateStep(context) {
          if (alwaysDomain) return;
          const duration = phase === "normal" ? NORMAL_DURATION : DOMAIN_DURATION;
          if (phaseTime + EPSILON >= duration) {
            transition(context.ball);
          }
        },
        onCollision(context, target) {
          if (phase !== "domain" || context.blockedAtContact) return;
          const hitX = (context.ball.x + target.x) / 2;
          const hitY = (context.ball.y + target.y) / 2;
          const index = cellIndexAt(hitX, hitY, context.game);
          const damage = domainNumbers[index];
          if (damage <= 0) return;
          if (context.services.dealDamage(target, damage)) {
            recordCellFlash(index, context.game.time);
          }
        },
        getWdcDomainState() {
          const cutoff = lastTime - CELL_FLASH_DURATION;
          return {
            active: phase === "domain",
            phase,
            phaseTime,
            completedDomains,
            numbers: domainNumbers.slice(),
            recentHitIndices: cellFlashes
              .filter((flash) => flash.time > cutoff)
              .map((flash) => flash.index)
          };
        },
        getWdcDamageAt(_context, x, y, arenaSize) {
          if (phase !== "domain") return null;
          return domainNumbers[cellIndexAt(x, y, arenaSize)];
        },
        recordWdcCellHit(_context, x, y, arenaSize) {
          if (phase !== "domain") return;
          recordCellFlash(cellIndexAt(x, y, arenaSize), lastTime);
        },
        drawArenaBackground(context, canvasContext) {
          drawDomainGrid(
            canvasContext,
            context.game,
            domainNumbers,
            gridOpacity(phase, phaseTime, completedDomains),
            cellFlashes,
            context.game.time
          );
        }
      };
    }
  };

  registerBall(wdcDefinition);
  return {
    wdcDefinition,
    cellIndexAt,
    drawDomainGrid,
    createBinaryDomainNumbers,
    CELL_FLASH_DURATION
  };
});
