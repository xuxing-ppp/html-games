(function initializeDeterministicBattle(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("./battle-engine.js"), ...require("./battle-entertainment.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createDeterministicBattleApi({ BattleEngine, createBattleEntertainmentTracker }) {
  // 与 scripts/simulate-battle.js 使用同一条线性同余流：同一种子 → 同一串随机数。
  const SEED_MODULUS = 0x100000000;
  const SEED_MULTIPLIER = 1664525;
  const SEED_INCREMENT = 1013904223;
  const DETERMINISTIC_STEP_SECONDS = 1 / 60;
  const MAX_CATCH_UP_SECONDS = 0.25;
  const EPSILON = 1e-9;

  function normalizeSeed(seed) {
    if (!Number.isFinite(seed)) {
      throw new TypeError("Deterministic battle requires a numeric seed");
    }
    return Math.floor(seed) >>> 0;
  }

  function createSeededRandom(seed) {
    let state = normalizeSeed(seed);
    return function seededRandom() {
      state = (state * SEED_MULTIPLIER + SEED_INCREMENT) >>> 0;
      return state / SEED_MODULUS;
    };
  }

  // 全项目有 80 多个球直接调用 Math.random（353 处），所以确定性只能靠这一层
  // 全局替换实现。句柄负责还原，绝不能把种子流留在 Math.random 上。
  function installSeededRandom(seed) {
    const random = createSeededRandom(seed);
    const previous = Math.random;
    Math.random = random;
    let restored = false;
    return {
      seed: normalizeSeed(seed),
      random,
      randomDirection() {
        const angle = random() * Math.PI * 2;
        return { x: Math.cos(angle), y: Math.sin(angle) };
      },
      restore() {
        if (restored) return false;
        restored = true;
        Math.random = previous;
        return true;
      }
    };
  }

  // 定步长推进器：只跑完整的 stepSeconds 步，余量留到下一帧。
  // 关键性质是"执行的步序列"只取决于时间总量，与调用切分方式无关，
  // 所以 farm（一次跑完）与实战（每帧一小段）会跑出完全相同的序列。
  function createFixedStepRunner(engine, {
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    maxSteps = Number.MAX_SAFE_INTEGER,
    maxCatchUpSeconds = MAX_CATCH_UP_SECONDS,
    shouldStop = null
  } = {}) {
    if (!engine || typeof engine.update !== "function") {
      throw new TypeError("Fixed step runner requires a battle engine");
    }
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new TypeError("Fixed step runner requires a positive step");
    }
    const catchUp = Math.max(
      Number.isFinite(maxCatchUpSeconds) ? maxCatchUpSeconds : MAX_CATCH_UP_SECONDS,
      stepSeconds
    );
    let accumulator = 0;
    let steps = 0;
    return {
      stepSeconds,
      get steps() {
        return steps;
      },
      get pendingSeconds() {
        return accumulator;
      },
      advance(elapsedSeconds) {
        if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return 0;
        accumulator = Math.min(accumulator + elapsedSeconds, catchUp);
        let ran = 0;
        while (accumulator + EPSILON >= stepSeconds && steps < maxSteps) {
          if (typeof shouldStop === "function" && shouldStop(engine)) break;
          engine.update(stepSeconds);
          accumulator -= stepSeconds;
          steps += 1;
          ran += 1;
        }
        return ran;
      }
    };
  }

  function readWinner(game) {
    const winnerTeam = game && game.winnerTeam ? game.winnerTeam : null;
    return {
      winnerTeamId: winnerTeam ? winnerTeam.id : null,
      winnerRole: winnerTeam ? winnerTeam.role : null
    };
  }

  // Each chunk restores Math.random, allowing independent searches and UI work
  // between chunks without consuming another battle's random stream.
  function createDeterministicBattleTask({
    registry,
    seed,
    config = null,
    createBattle = null,
    maxSeconds = 180,
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    onStep = null,
    collectEntertainment = false
  } = {}) {
    if (!registry) throw new TypeError("Deterministic battle requires a registry");
    if (!config && typeof createBattle !== "function") {
      throw new TypeError("Deterministic battle requires a config or createBattle callback");
    }
    if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
      throw new TypeError("Deterministic battle requires a positive maxSeconds");
    }
    if (typeof collectEntertainment !== "boolean") {
      throw new TypeError("Deterministic battle requires a boolean collectEntertainment flag");
    }
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new TypeError("Deterministic battle requires a positive step");
    }
    const stream = installSeededRandom(seed);
    let engine;
    let entertainment = null;
    let steps = 0;
    try {
      engine = new BattleEngine({
        registry,
        visualSeed: stream.seed,
        randomDirection: () => stream.randomDirection(),
        onCombatInteraction: collectEntertainment ? (event) => {
          if (entertainment) entertainment.observeInteraction((steps + 1) * stepSeconds, event);
        } : null
      });
      if (typeof createBattle === "function") createBattle(engine);
      else engine.createBattle(config);
      engine.beginFight();
    } finally {
      stream.restore();
    }
    entertainment = collectEntertainment ? createBattleEntertainmentTracker(engine.game) : null;
    const maxSteps = Math.max(1, Math.ceil(maxSeconds / stepSeconds));
    const done = () => steps >= maxSteps || engine.game.state === "ended";
    return {
      engine,
      get done() { return done(); },
      get steps() { return steps; },
      get seconds() { return steps * stepSeconds; },
      advance(stepCount = 32) {
        if (!Number.isInteger(stepCount) || stepCount <= 0) {
          throw new TypeError("Battle task requires a positive integer step count");
        }
        const previous = Math.random;
        Math.random = stream.random;
        try {
          const end = Math.min(maxSteps, steps + stepCount);
          while (steps < end && !done()) {
            engine.update(stepSeconds);
            steps += 1;
            if (entertainment) entertainment.sample(steps * stepSeconds, done());
            if (onStep) onStep(engine, steps);
          }
        } finally {
          Math.random = previous;
        }
        return done();
      },
      result() {
        const winner = readWinner(engine.game);
        return {
          seed: stream.seed,
          engine,
          steps,
          seconds: steps * stepSeconds,
          ended: engine.game.state === "ended",
          timedOut: steps >= maxSteps && engine.game.state !== "ended",
          winnerTeamId: winner.winnerTeamId,
          winnerRole: winner.winnerRole,
          ...(collectEntertainment ? { entertainment: entertainment ? entertainment.summarize(winner.winnerTeamId) : null } : {})
        };
      }
    };
  }

  function runDeterministicBattle(options = {}) {
    const task = createDeterministicBattleTask(options);
    task.advance(Number.MAX_SAFE_INTEGER);
    return task.result();
  }

  // 实战用：装上种子流（必须在 createBattle 之前，初始方向也要吃种子），
  // 并给出定步长 advance()。dispose() 一定要在对局结束后调用。
  //
  // 关键约束：种子流只在"引擎干活"的瞬间挂到全局 Math.random（球的行为里
  // 有 300+ 处直接调 Math.random），帧间必须摘下来——实战里音效噪声缓冲、
  // 渲染装饰都会消耗全局随机，这些消耗在无头推演里不存在，整场挂着会让
  // 种子脱轨（推演结局 ≠ 实战结局）。stream.random 是自带状态的闭包，
  // 反复挂/摘不影响引擎看到的序列。
  function createDeterministicSession({
    registry = null,
    engine: providedEngine = null,
    seed,
    setup,
    engineOptions = {},
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    maxSteps = Number.MAX_SAFE_INTEGER,
    maxCatchUpSeconds = MAX_CATCH_UP_SECONDS
  } = {}) {
    if (!registry && !providedEngine) {
      throw new TypeError("Deterministic session requires a registry or an engine");
    }
    if (typeof setup !== "function") {
      throw new TypeError("Deterministic session requires a setup callback");
    }
    const stream = installSeededRandom(seed);
    let engine = providedEngine;
    let runner = null;
    let disposed = false;
    const previousRandom = engine ? engine.random : null;
    const previousDirection = engine ? engine.randomDirection : null;
    const previousVisualSeed = engine ? engine.visualSeed : undefined;
    const previousVisualRandom = engine ? engine.visualRandom : null;
    // 引擎工作专用：把种子流挂上全局跑 fn，跑完立刻摘下。
    // beginFight 这类在 advance 之外触发随机的行为调用，也必须走这里。
    function runSeeded(fn) {
      const previous = Math.random;
      Math.random = stream.random;
      try {
        return fn();
      } finally {
        Math.random = previous;
      }
    }
    try {
      if (!engine) {
        engine = new BattleEngine({
          registry,
          ...engineOptions,
          visualSeed: stream.seed,
          randomDirection: () => stream.randomDirection()
        });
      } else {
        // 复用界面已接好音频/渲染的引擎：把内部随机源也换成种子流。
        if (typeof engine.setRandom === "function") engine.setRandom(stream.random);
        if (typeof engine.setVisualSeed === "function") engine.setVisualSeed(stream.seed);
        engine.randomDirection = () => stream.randomDirection();
      }
      setup(engine);
      runner = createFixedStepRunner(engine, { stepSeconds, maxSteps, maxCatchUpSeconds });
    } catch (cause) {
      if (engine) {
        if (typeof engine.setRandom === "function" && previousRandom) engine.setRandom(previousRandom);
        if (previousDirection) engine.randomDirection = previousDirection;
        if (previousVisualRandom) {
          engine.visualSeed = previousVisualSeed;
          engine.visualRandom = previousVisualRandom;
        }
      }
      stream.restore();
      throw cause;
    }
    // setup 跑完立刻摘下全局流：之后的帧间（渲染/音效/UI）用真随机。
    stream.restore();
    return {
      seed: stream.seed,
      engine,
      get steps() {
        return runner.steps;
      },
      get stepSeconds() {
        return runner.stepSeconds;
      },
      runSeeded,
      advance(elapsedSeconds) {
        return runSeeded(() => runner.advance(elapsedSeconds));
      },
      dispose() {
        if (disposed) return false;
        disposed = true;
        if (typeof engine.setRandom === "function" && previousRandom) {
          engine.setRandom(previousRandom);
        }
        if (previousDirection) engine.randomDirection = previousDirection;
        if (previousVisualRandom) {
          engine.visualSeed = previousVisualSeed;
          engine.visualRandom = previousVisualRandom;
        }
        return true;
      }
    };
  }

  return {
    createSeededRandom,
    installSeededRandom,
    createFixedStepRunner,
    createDeterministicBattleTask,
    runDeterministicBattle,
    createDeterministicSession,
    DETERMINISTIC_STEP_SECONDS,
    DETERMINISTIC_MAX_CATCH_UP_SECONDS: MAX_CATCH_UP_SECONDS
  };
});
