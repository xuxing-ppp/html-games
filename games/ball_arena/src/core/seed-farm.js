(function initializeSeedFarm(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("./deterministic-battle.js") }
    : root.BallBattle;
  const api = factory(dependencies);

  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSeedFarmApi({
  runDeterministicBattle,
  DETERMINISTIC_STEP_SECONDS
}) {
  const DEFAULT_BUDGET_MS = 4000;
  const DEFAULT_MAX_DRAWS = 400;
  const DEFAULT_MAX_SECONDS = 180;

  function defaultSeedSource(random = Math.random) {
    return Math.floor(random() * 0x100000000) >>> 0;
  }

  // 抽卡：不断换种子做无头推演，直到推演出"目标方赢"的那颗种子。
  // 时间/次数都是硬上限——到点就停，用兜底种子开打。
  function farmWinningSeed({
    registry,
    config = null,
    createBattle = null,
    isWinner,
    seedSource = defaultSeedSource,
    budgetMs = DEFAULT_BUDGET_MS,
    maxDraws = DEFAULT_MAX_DRAWS,
    maxSeconds = DEFAULT_MAX_SECONDS,
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    now = () => (typeof performance === "object" && performance.now
      ? performance.now()
      : Date.now()),
    onDraw = null
  } = {}) {
    if (!registry) throw new TypeError("Seed farm requires a registry");
    if (typeof isWinner !== "function") {
      throw new TypeError("Seed farm requires an isWinner predicate");
    }
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
      throw new TypeError("Seed farm requires a positive budget");
    }
    if (!Number.isFinite(maxDraws) || maxDraws <= 0) {
      throw new TypeError("Seed farm requires a positive draw limit");
    }
    const startedAt = now();
    let draws = 0;
    let lastResult = null;
    while (draws < Math.floor(maxDraws)) {
      const seed = seedSource() >>> 0;
      const result = runDeterministicBattle({
        registry,
        seed,
        config,
        createBattle,
        maxSeconds,
        stepSeconds
      });
      draws += 1;
      lastResult = result;
      if (onDraw) onDraw({ seed, draws, result });
      if (isWinner(result)) {
        return {
          found: true,
          seed,
          draws,
          elapsedMs: now() - startedAt,
          result
        };
      }
      if (now() - startedAt >= budgetMs) break;
    }
    return {
      found: false,
      seed: null,
      draws,
      elapsedMs: now() - startedAt,
      result: lastResult
    };
  }

  // 异步版：每跑满 sliceMs 就把控制权交回事件循环，抽卡期间界面不假死。
  // schedule 可注入，测试里用手动队列即可完全确定地驱动。
  function farmWinningSeedAsync({
    registry,
    config = null,
    createBattle = null,
    isWinner,
    seedSource = defaultSeedSource,
    budgetMs = DEFAULT_BUDGET_MS,
    maxDraws = DEFAULT_MAX_DRAWS,
    maxSeconds = DEFAULT_MAX_SECONDS,
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    now = () => (typeof performance === "object" && performance.now
      ? performance.now()
      : Date.now()),
    schedule = (callback) => setTimeout(callback, 0),
    sliceMs = 12,
    onDraw = null,
    onProgress = null
  } = {}) {
    if (!registry) throw new TypeError("Seed farm requires a registry");
    if (typeof isWinner !== "function") {
      throw new TypeError("Seed farm requires an isWinner predicate");
    }
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
      throw new TypeError("Seed farm requires a positive budget");
    }
    if (!Number.isFinite(maxDraws) || maxDraws <= 0) {
      throw new TypeError("Seed farm requires a positive draw limit");
    }
    if (typeof schedule !== "function") {
      throw new TypeError("Seed farm requires a schedule function");
    }
    const drawLimit = Math.floor(maxDraws);
    const startedAt = now();
    return new Promise((resolve, reject) => {
      let draws = 0;
      let lastResult = null;
      const finish = (found, seed) => resolve({
        found,
        seed: found ? seed : null,
        draws,
        elapsedMs: now() - startedAt,
        result: lastResult
      });
      const step = () => {
        const sliceStart = now();
        try {
          while (draws < drawLimit) {
            const seed = seedSource() >>> 0;
            const result = runDeterministicBattle({
              registry,
              seed,
              config,
              createBattle,
              maxSeconds,
              stepSeconds
            });
            draws += 1;
            lastResult = result;
            if (onDraw) onDraw({ seed, draws, result });
            if (onProgress) {
              onProgress({ seed, draws, elapsedMs: now() - startedAt, budgetMs });
            }
            if (isWinner(result)) {
              finish(true, seed);
              return;
            }
            if (now() - startedAt >= budgetMs) {
              finish(false, null);
              return;
            }
            if (now() - sliceStart >= sliceMs) {
              schedule(step);
              return;
            }
          }
          finish(false, null);
        } catch (error) {
          reject(error);
        }
      };
      step();
    });
  }

  // 做局用：指定队下标（0=左队，1=右队），返回一个"这队赢了吗"的谓词。
  function createTeamWinnerPredicate(teamIndex) {
    if (teamIndex !== 0 && teamIndex !== 1) {
      throw new TypeError("Team winner predicate requires a team index of 0 or 1");
    }
    return function isTeamWinner(result) {
      const game = result && result.engine ? result.engine.game : null;
      const team = game && game.teams ? game.teams[teamIndex] : null;
      const winnerTeam = game ? game.winnerTeam : null;
      return Boolean(team && winnerTeam && winnerTeam.id === team.id);
    };
  }

  // 节目效果清单：把一局推演压成"打了多久、双方每颗球剩多少血"，供用户挑种子。
  function summarizeBattleOutcome(result) {
    const game = result && result.engine ? result.engine.game : null;
    if (!game) return null;
    return {
      winnerTeamId: game.winnerTeam ? game.winnerTeam.id : null,
      winnerHp: game.winnerTeam
        ? game.winnerTeam.balls.reduce((sum, ball) => sum + Math.max(0, ball.hp), 0) : null,
      battleSeconds: Number(game.time.toFixed(3)),
      durationSeconds: Number.isFinite(result.seconds) ? result.seconds : game.time,
      timedOut: result.timedOut === true,
      ...("entertainment" in result ? { entertainment: result.entertainment } : {}),
      teams: game.teams.map((team) => ({
        teamId: team.id,
        balls: team.balls.map((ball) => ({
          id: ball.id,
          name: ball.name,
          hp: Math.max(0, Math.round(ball.hp)),
          maxHp: ball.maxHp
        }))
      }))
    };
  }

  // 做局：不断换种子推演，把命中"指定方赢"的种子连摘要一起收进候选池，
  // 收满 candidateLimit 就结束。budgetMs / maxDraws 传 Infinity 即不设上限
  // （界面配"停止抽卡"按钮兜底），shouldStop() 返回 true 时带现有候选提前收尾。
  function farmRiggedSeeds({
    registry,
    config = null,
    createBattle = null,
    isWinner,
    candidateLimit = 5,
    seedSource = defaultSeedSource,
    budgetMs = 10000,
    maxDraws = 400,
    maxSeconds = 180,
    stepSeconds = DETERMINISTIC_STEP_SECONDS,
    now = () => (typeof performance === "object" && performance.now
      ? performance.now()
      : Date.now()),
    schedule = (callback) => setTimeout(callback, 0),
    sliceMs = 12,
    shouldStop = null,
    onDraw = null,
    onProgress = null
  } = {}) {
    if (!registry) throw new TypeError("Seed farm requires a registry");
    if (typeof isWinner !== "function") {
      throw new TypeError("Seed farm requires an isWinner predicate");
    }
    if (!Number.isFinite(candidateLimit) || candidateLimit <= 0) {
      throw new TypeError("Rigged farm requires a positive candidate limit");
    }
    if (!(budgetMs > 0)) {
      throw new TypeError("Seed farm requires a positive budget");
    }
    if (!(maxDraws > 0)) {
      throw new TypeError("Seed farm requires a positive draw limit");
    }
    if (typeof schedule !== "function") {
      throw new TypeError("Seed farm requires a schedule function");
    }
    const drawLimit = Math.floor(maxDraws);
    const limit = Math.floor(candidateLimit);
    const startedAt = now();
    return new Promise((resolve, reject) => {
      let draws = 0;
      let stoppedEarly = false;
      const candidates = [];
      const finish = () => resolve({
        found: candidates.length > 0,
        stopped: stoppedEarly,
        candidates,
        draws,
        elapsedMs: now() - startedAt
      });
      const step = () => {
        const sliceStart = now();
        try {
          while (draws < drawLimit) {
            if (typeof shouldStop === "function" && shouldStop()) {
              stoppedEarly = true;
              finish();
              return;
            }
            const seed = seedSource() >>> 0;
            const result = runDeterministicBattle({
              registry,
              seed,
              config,
              createBattle,
              maxSeconds,
              stepSeconds
            });
            draws += 1;
            if (onDraw) onDraw({ seed, draws, result });
            if (isWinner(result)) {
              candidates.push({ seed, ...summarizeBattleOutcome(result) });
            }
            if (onProgress) {
              onProgress({
                draws,
                found: candidates.length,
                elapsedMs: now() - startedAt,
                budgetMs
              });
            }
            if (candidates.length >= limit) {
              finish();
              return;
            }
            if (now() - startedAt >= budgetMs) {
              finish();
              return;
            }
            if (now() - sliceStart >= sliceMs) {
              schedule(step);
              return;
            }
          }
          finish();
        } catch (error) {
          reject(error);
        }
      };
      step();
    });
  }

  return {
    farmWinningSeed,
    farmWinningSeedAsync,
    createTeamWinnerPredicate,
    summarizeBattleOutcome,
    farmRiggedSeeds,
    defaultSeedSource,
    SEED_FARM_DEFAULT_BUDGET_MS: DEFAULT_BUDGET_MS,
    SEED_FARM_DEFAULT_MAX_DRAWS: DEFAULT_MAX_DRAWS,
    SEED_FARM_DEFAULT_MAX_SECONDS: DEFAULT_MAX_SECONDS
  };
});
