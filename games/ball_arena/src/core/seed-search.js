(function initializeSeedSearch(root, factory) {
  const dependencies = typeof module === "object" && module.exports
    ? { ...require("./seed-farm.js"), ...require("./deterministic-battle.js"),
      ...require("./battle-entertainment.js") }
    : root.BallBattle;
  const api = factory(dependencies);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSeedSearchApi(dependencies) {
  "use strict";
  const { createDeterministicBattleTask, summarizeBattleOutcome,
    BATTLE_ENTERTAINMENT_VERSION } = dependencies;

  function seedSearchConcurrency({ cores = 2, mobile = false, memory = 8 } = {}) {
    const maximum = mobile ? (memory <= 2 ? 1 : 2) : 6;
    return Math.max(1, Math.min(maximum, Math.floor((Number(cores) || 2) / 2)));
  }

  // Workers own the authoritative JS engine. GPU predictions can reorder bounded
  // queues of paused tasks, but only completed CPU outcomes reach the cache/filters.
  function createSeedSearch({ registry, workerFactory = null, scripts = [], concurrency = 1,
    gpuRankerFactory = null } = {}) {
    if (!registry) throw new TypeError("Seed search requires a registry");
    if (gpuRankerFactory !== null && typeof gpuRankerFactory !== "function") {
      throw new TypeError("Seed search requires a GPU ranker factory");
    }
    const workerLimit = Math.max(1, Math.min(6, Math.floor(concurrency) || 1));
    const workers = [];
    const cache = new Map();
    let active = null;
    let serial = 0;
    let workersUnavailable = !workerFactory;
    let idleTimer = null;
    let gpuRanker = null;

    function releaseWorkers() {
      for (const slot of workers) {
        clearTimeout(slot.readyTimer);
        slot.worker.terminate();
      }
      workers.length = 0;
    }

    function warmup() {
      clearTimeout(idleTimer);
      if (workersUnavailable || workers.length) return;
      try {
        for (let index = 0; index < workerLimit; index += 1) {
          const worker = workerFactory();
          const slot = { worker, ready: false, busy: null, resumeToken: null, pendingToken: null, readyTimer: null };
          workers.push(slot);
          const failed = () => {
            if (!workers.includes(slot)) return;
            workersUnavailable = true;
            releaseWorkers();
            if (active) active.fallback();
          };
          worker.onerror = failed;
          worker.onmessageerror = failed;
          worker.onmessage = ({ data }) => {
            if (!workers.includes(slot)) return;
            if (data.type === "ready") {
              clearTimeout(slot.readyTimer);
              slot.ready = true;
              try { if (active) active.dispatch(slot); } catch (_error) { failed(); }
            } else if (active && data.id === slot.busy) {
              slot.busy = null;
              if (data.type === "error") active.fail(new Error(data.error));
              else if (data.type === "result") active.complete(data.seed, data.summary, slot);
              else if (data.type === "pruned") active.pruned(data.seed, slot);
              else if (data.type === "prepared") active.prepared(data.entries, slot);
            }
          };
          slot.readyTimer = setTimeout(failed, 10000);
          worker.postMessage({ type: "init", scripts });
        }
      } catch (_error) {
        workersUnavailable = true;
        releaseWorkers();
      }
      if (!active) idleTimer = setTimeout(releaseWorkers, 30000);
    }

    // useCache：单次抽取命中缓存时复用已验证的结局（省一次推演）。
    // preloadCached：开抽前先把缓存里"目标方赢"的种子直接填成候选。它是给
    //   "复读上一次结果"用的，交互式抽卡（做局面板点"抽种子"）必须传 false，
    //   否则第二次点击会零秒拿回上一批一模一样的候选，看起来像没抽。
    function search({ config, winnerTeamIndex, candidateLimit = 5, budgetMs = Infinity,
      maxDraws = Infinity, maxSeconds = 180, seedSource = null, onProgress = null,
      signal = null, useCache = true, preloadCached = true,
      winnerHpMin = 0, winnerHpMax = Infinity,
      durationSecondsMin = 0, durationSecondsMax = Infinity,
      entertainmentMin = 0, collectEntertainment = false, selectionMode = "first",
      gpuAcceleration = false, pruneOverDuration = false } = {}) {
      if (!config || !Array.isArray(config.teams)) throw new TypeError("Seed search requires a config");
      if (winnerTeamIndex !== null && (!Number.isInteger(winnerTeamIndex) || !config.teams[winnerTeamIndex])) {
        throw new TypeError("Seed search requires a valid winner team index");
      }
      if (!Number.isInteger(candidateLimit) || candidateLimit < 1 || !(budgetMs > 0) ||
          !(maxDraws >= 1) || !Number.isFinite(maxSeconds) || maxSeconds <= 0) {
        throw new TypeError("Seed search requires positive limits");
      }
      if (!Number.isFinite(winnerHpMin) || winnerHpMin < 0 ||
          !(Number.isFinite(winnerHpMax) || winnerHpMax === Infinity) || winnerHpMax < winnerHpMin) {
        throw new TypeError("Seed search requires an ordered non-negative winner HP range");
      }
      if (!Number.isFinite(durationSecondsMin) || durationSecondsMin < 0 ||
          !(Number.isFinite(durationSecondsMax) || durationSecondsMax === Infinity) ||
          durationSecondsMax < durationSecondsMin) {
        throw new TypeError("Seed search requires an ordered non-negative duration range");
      }
      if (!Number.isFinite(entertainmentMin) || entertainmentMin < 0 || entertainmentMin > 100 ||
          typeof collectEntertainment !== "boolean") {
        throw new TypeError("Seed search requires an entertainment threshold in 0..100 and boolean collection flag");
      }
      if (!["first", "best"].includes(selectionMode)) throw new TypeError("Unknown seed selection mode");
      if (typeof gpuAcceleration !== "boolean") throw new TypeError("GPU acceleration must be boolean");
      if (typeof pruneOverDuration !== "boolean") throw new TypeError("Duration pruning must be boolean");
      const ranked = selectionMode === "best";
      if (config.teams.length > 2 && (ranked || entertainmentMin > 0)) {
        throw new TypeError("Entertainment scoring requires exactly two teams; multi-team battles support HP, duration and winner filters");
      }
      const durationCutoff = pruneOverDuration && ranked && Number.isFinite(durationSecondsMax) &&
        durationSecondsMax < maxSeconds ? durationSecondsMax : Infinity;
      const pruningOptions = { pruneOverDuration: Number.isFinite(durationCutoff), durationSecondsMax: durationCutoff };
      if (ranked && seedSource && !Number.isFinite(maxDraws)) {
        throw new TypeError("Ranked custom seed sources require finite maxDraws for bounded deduplication");
      }
      const analyze = collectEntertainment || entertainmentMin > 0 || ranked;
      if (active) active.stop();
      clearTimeout(idleTimer);
      const key = JSON.stringify(analyze
        ? [config, maxSeconds, true, BATTLE_ENTERTAINMENT_VERSION]
        : [config, maxSeconds, false]);
      let outcomes = cache.get(key);
      if (!outcomes) outcomes = new Map();
      cache.delete(key);
      cache.set(key, outcomes);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      const targetId = winnerTeamIndex === null ? null : config.teams[winnerTeamIndex].id;
      const candidates = [];
      const selected = new Set();
      const started = performance.now();
      let seedCursor = Math.floor(Math.random() * 0x100000000) >>> 0;
      let draws = 0;
      let prunedDraws = 0;
      let issued = 0;
      let cacheHits = 0;
      const countedSeeds = new Set();
      let sampleCount = 0;
      const wins = config.teams.map(() => 0);
      let ties = 0;
      let timeouts = 0;
      const statistics = () => ({
        total: sampleCount,
        teams: config.teams.map((team, index) => ({ teamId: team.id, wins: wins[index],
          rate: sampleCount ? wins[index] / sampleCount : null })),
        ties, timeouts
      });
      let timer;
      let fallbackTimer;
      let fallbackTask = null;
      let settled = false;
      let gpuEnabled = gpuAcceleration && !!gpuRankerFactory && !workersUnavailable && config.teams.length === 2;
      const acceleration = { requested: gpuAcceleration, mode: gpuEnabled ? "initializing" :
        gpuAcceleration ? "fallback" : "cpu", reason: gpuAcceleration && !gpuEnabled ?
        "GPU prediction requires Web Workers, a GPU ranker and two teams" : null,
        adapter: null, rankedBatches: 0 };
      const accelerationSnapshot = () => ({ ...acceleration,
        adapter: acceleration.adapter ? { ...acceleration.adapter } : null });
      // Each worker drains its own four tasks before refilling. Other workers can
      // prepare/resume meanwhile; only GPU submissions are serialized.
      let preparedQueue = [];
      let unrankedQueue = [];
      let ranking = null;
      let rankScheduled = false;
      const pendingSeeds = new Map();
      let retrySeeds = [];
      let rankTimer;

      return new Promise((resolve, reject) => {
        const finish = (stopped = false, error = null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(fallbackTimer);
          clearTimeout(rankTimer);
          if (ranking && gpuRanker) {
            gpuRanker.dispose();
            gpuRanker = null;
          }
          if (acceleration.mode === "initializing") {
            acceleration.mode = "cpu";
            acceleration.reason = "Completed on CPU without GPU ranking";
          }
          fallbackTask = null;
          preparedQueue = [];
          unrankedQueue = [];
          ranking = null;
          pendingSeeds.clear();
          retrySeeds = [];
          if (signal) signal.removeEventListener("abort", stop);
          for (const slot of workers) {
            if (slot.busy !== null) slot.worker.postMessage({ type: "cancel", id: slot.busy });
            slot.worker.postMessage({ type: "reset" });
            slot.busy = null;
            slot.resumeToken = null;
            slot.pendingToken = null;
          }
          active = null;
          idleTimer = setTimeout(releaseWorkers, 30000);
          if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
          if (error) reject(error);
          else resolve({ found: candidates.length > 0, stopped, candidates, draws, prunedDraws, cacheHits, statistics: statistics(),
            elapsedMs: performance.now() - started, workers: workersUnavailable ? 0 : workers.length,
            acceleration: accelerationSnapshot() });
        };
        const stop = () => finish(true);
        const accept = (seed, summary) => {
          if (summary && !summary.timedOut &&
              config.teams.some((team) => team.id === summary.winnerTeamId) &&
              (targetId === null || summary.winnerTeamId === targetId) && !selected.has(seed)) {
            // Filter every path, including worker results, fallback and cached draws.
            // Use unrounded HP; presentation rounding must not admit an out-of-range winner.
            if ((winnerHpMin > 0 || winnerHpMax < Infinity) &&
                (!Number.isFinite(summary.winnerHp) || summary.winnerHp < winnerHpMin ||
                  summary.winnerHp > winnerHpMax)) return;
            if (!Number.isFinite(summary.durationSeconds) || summary.durationSeconds < durationSecondsMin ||
                summary.durationSeconds > durationSecondsMax) return;
            if (entertainmentMin > 0 && (!summary.entertainment ||
                summary.entertainment.score < entertainmentMin)) return;
            if (ranked && !Number.isFinite(summary.entertainment == null ? undefined : summary.entertainment.score)) return;
            selected.add(seed);
            candidates.push({ seed, ...summary });
            if (ranked) {
              candidates.sort((a, b) => b.entertainment.score - a.entertainment.score || a.seed - b.seed);
              if (candidates.length > candidateLimit) selected.delete(candidates.pop().seed);
            }
          }
        };
        const progress = () => {
          if (onProgress) onProgress({ draws, prunedDraws, found: candidates.length, cacheHits, statistics: statistics(),
            elapsedMs: performance.now() - started, candidates: candidates.slice(),
            workers: workersUnavailable ? 0 : workers.length, acceleration: accelerationSnapshot() });
        };
        const nextSeed = () => {
          issued += 1;
          seedCursor = (seedCursor + 0x9e3779b9) >>> 0;
          return seedSource ? seedSource() >>> 0 : seedCursor;
        };
        const complete = (seed, summary, slot = null) => {
          if (settled) return;
          draws += 1;
          if (summary) summary = Object.freeze({ ...summary,
            ...(summary.entertainment ? { entertainment: Object.freeze({ ...summary.entertainment,
              components: Object.freeze({ ...summary.entertainment.components }),
              ...(summary.entertainment.breakdown ? {
                breakdown: Object.freeze({ ...summary.entertainment.breakdown })
              } : {}),
              teamIds: Object.freeze(summary.entertainment.teamIds.slice()),
              curve: Object.freeze(summary.entertainment.curve.map((point) => Object.freeze(point.slice())))
            }) } : {}),
            teams: Object.freeze(summary.teams.map((team) => Object.freeze({ ...team,
              balls: Object.freeze(team.balls.map((ball) => Object.freeze({ ...ball })))
            })))
          });
          // Count all sampled outcomes before winner / HP / time / score filters.
          // Preloaded candidates and repeated identical seeds are not new evidence.
          // The default generator traverses uint32 seeds without repeats. Do not
          // retain one Set entry per draw during an indefinite ranked search.
          if (summary && (!seedSource || !countedSeeds.has(seed))) {
            if (seedSource) countedSeeds.add(seed);
            sampleCount += 1;
            const winnerIndex = config.teams.findIndex((team) => team.id === summary.winnerTeamId);
            if (winnerIndex >= 0) wins[winnerIndex] += 1;
            else if (summary.timedOut) timeouts += 1;
            else ties += 1;
          }
          outcomes.set(seed, summary);
          if (outcomes.size > 128) outcomes.delete(outcomes.keys().next().value);
          accept(seed, summary);
          progress();
          if (settled) return;
          if ((!ranked && candidates.length >= candidateLimit) || draws + prunedDraws >= Math.floor(maxDraws)) finish();
          else if (slot) dispatch(slot);
        };
        const pruned = (slot = null) => {
          if (settled) return;
          prunedDraws += 1;
          progress();
          if (settled) return;
          if (draws + prunedDraws >= Math.floor(maxDraws)) finish();
          else if (slot) dispatch(slot);
        };
        const fallBackFromGpu = (error) => {
          gpuEnabled = false;
          acceleration.mode = "fallback";
          acceleration.reason = error.message || String(error);
          if (gpuRanker) gpuRanker.dispose();
          gpuRanker = null;
        };
        const scheduleRanking = () => {
          if (settled || ranking || rankScheduled || !unrankedQueue.length) return;
          // Coalesce available prefixes without waiting for a slow worker. A
          // microtask also avoids the nested timer clamp during long searches.
          rankScheduled = true;
          queueMicrotask(() => {
            rankScheduled = false;
            rankPrepared().catch((error) => finish(false, error));
          });
        };
        const rankPrepared = async () => {
          if (settled || ranking || !unrankedQueue.length) return;
          const batch = unrankedQueue;
          unrankedQueue = [];
          ranking = batch;
          let ordered = batch;
          const entries = batch.map(({ token, seed, features }) => ({ token, seed, features }));
          if (gpuEnabled) {
            try {
              if (!gpuRanker) gpuRanker = gpuRankerFactory();
              const rankedBatch = await Promise.race([
                gpuRanker.rank(entries, { winnerTeamIndex, winnerHpMin, winnerHpMax,
                  durationSecondsMin, durationSecondsMax, entertainmentMin, selectionMode, maxSeconds }),
                new Promise((_resolve, rejectRank) => {
                  rankTimer = setTimeout(() => rejectRank(new Error("GPU prediction timed out")), 5000);
                })
              ]);
              clearTimeout(rankTimer);
              if (settled || ranking !== batch) return;
              const order = rankedBatch && rankedBatch.order;
              const tokens = new Set(entries.map((entry) => entry.token));
              if (!Array.isArray(order) || order.length !== entries.length ||
                  new Set(order).size !== tokens.size || order.some((token) => !tokens.has(token))) {
                throw new Error("GPU prediction returned an invalid candidate order");
              }
              const entriesByToken = new Map(batch.map((entry) => [entry.token, entry]));
              ordered = order.map((token) => entriesByToken.get(token));
              acceleration.mode = "gpu";
              acceleration.adapter = rankedBatch.adapter ? { ...rankedBatch.adapter } : null;
              acceleration.rankedBatches += 1;
            } catch (error) {
              if (settled || ranking !== batch) return;
              fallBackFromGpu(error);
              ordered = batch.slice().sort((a, b) => a.token - b.token);
            } finally { clearTimeout(rankTimer); }
          }
          if (settled || ranking !== batch) return;
          ranking = null;
          preparedQueue.push(...ordered);
          progress();
          for (const slot of workers) dispatch(slot);
          scheduleRanking();
        };
        const prepareWorker = (slot) => {
          const tasks = [];
          for (let index = 0; index < 4 && issued < Math.floor(maxDraws) && !settled; index += 1) {
            const seed = nextSeed();
            if (useCache && outcomes.has(seed)) {
              cacheHits += 1;
              complete(seed, outcomes.get(seed));
            } else {
              const token = ++serial;
              tasks.push({ token, seed });
              pendingSeeds.set(token, seed);
            }
          }
          if (settled) return;
          if (!tasks.length) {
            // Cached prefixes may use the whole slice. Yield before refilling
            // so repeated custom seeds cannot monopolize the renderer.
            if (issued < Math.floor(maxDraws)) {
              slot.busy = ++serial;
              setTimeout(() => {
                if (settled || !workers.includes(slot)) return;
                slot.busy = null;
                try { dispatch(slot); } catch (error) { finish(false, error); }
              }, 0);
            }
            return;
          }
          slot.busy = ++serial;
          slot.worker.postMessage({ type: "prepare", id: slot.busy, tasks, config, maxSeconds,
            prefixSeconds: Math.min(4, maxSeconds), collectEntertainment: analyze, ...pruningOptions });
        };
        const dispatch = (slot) => {
          if (settled || !workers.includes(slot) || !slot.ready || slot.busy !== null) return;
          const index = preparedQueue.findIndex((entry) => entry.slot === slot);
          if (index >= 0) {
            const [entry] = preparedQueue.splice(index, 1);
            slot.resumeToken = entry.token;
            slot.busy = ++serial;
            slot.worker.postMessage({ type: "resume", id: slot.busy, token: entry.token });
            return;
          }
          // A worker's closures cannot migrate, and a queued/ranking prefix still
          // occupies its bounded capacity even though the worker is idle.
          if (unrankedQueue.some((entry) => entry.slot === slot) ||
              (ranking && ranking.some((entry) => entry.slot === slot))) return;
          if (issued >= Math.floor(maxDraws)) return;
          if (gpuEnabled) { prepareWorker(slot); return; }
          const seed = nextSeed();
          if (useCache && outcomes.has(seed)) {
            cacheHits += 1;
            // Defer a cached draw to avoid recursion with repeating seed sources.
            slot.busy = ++serial;
            slot.pendingToken = slot.busy;
            pendingSeeds.set(slot.pendingToken, seed);
            setTimeout(() => {
              if (settled || !workers.includes(slot)) return;
              pendingSeeds.delete(slot.pendingToken);
              slot.pendingToken = null;
              slot.busy = null;
              try { complete(seed, outcomes.get(seed), slot); } catch (error) { finish(false, error); }
            }, 0);
            return;
          }
          slot.busy = ++serial;
          slot.pendingToken = slot.busy;
          pendingSeeds.set(slot.pendingToken, seed);
          slot.worker.postMessage({ type: "run", id: slot.busy, config, seed, maxSeconds, collectEntertainment: analyze, ...pruningOptions });
        };
        const tick = () => {
          if (settled) return;
          try {
            const sliceStart = performance.now();
            do {
              if (!fallbackTask) {
                if (!retrySeeds.length && issued >= Math.floor(maxDraws)) { finish(); return; }
                const seed = retrySeeds.length ? retrySeeds.shift() : nextSeed();
                if (useCache && outcomes.has(seed)) {
                  cacheHits += 1;
                  complete(seed, outcomes.get(seed));
                  continue;
                }
                fallbackTask = createDeterministicBattleTask({ registry, config, seed, maxSeconds, collectEntertainment: analyze });
              }
              const steps = Number.isFinite(durationCutoff) ? Math.max(1, Math.min(16,
                Math.floor((durationCutoff - fallbackTask.seconds) * 60) + 1)) : 16;
              fallbackTask.advance(steps);
              if (fallbackTask.done) {
                const result = fallbackTask.result();
                fallbackTask = null;
                complete(result.seed, summarizeBattleOutcome(result));
              } else if (fallbackTask.seconds > durationCutoff) {
                fallbackTask = null;
                pruned();
              }
            } while (!settled && performance.now() - sliceStart < 8);
            if (!settled) fallbackTimer = setTimeout(tick, 0);
          } catch (error) { finish(false, error); }
        };
        active = {
          stop, dispatch,
          complete(seed, summary, slot) {
            if (slot && slot.pendingToken !== null) {
              pendingSeeds.delete(slot.pendingToken);
              slot.pendingToken = null;
            }
            if (slot && slot.resumeToken !== null) {
              pendingSeeds.delete(slot.resumeToken);
              slot.resumeToken = null;
            }
            try { complete(seed, summary, slot); } catch (error) { finish(false, error); }
          },
          pruned(_seed, slot) {
            if (slot) {
              pendingSeeds.delete(slot.resumeToken === null ? slot.pendingToken : slot.resumeToken);
              slot.resumeToken = null;
              slot.pendingToken = null;
            }
            try { pruned(slot); } catch (error) { finish(false, error); }
          },
          prepared(entries, slot) {
            if (settled) return;
            try {
              const queue = [];
              for (const entry of entries) {
                if (entry.pruned) {
                  pendingSeeds.delete(entry.token);
                  pruned();
                  if (settled) return;
                } else if (entry.summary) {
                  pendingSeeds.delete(entry.token);
                  complete(entry.seed, entry.summary);
                  if (settled) return;
                } else queue.push(entry);
              }
              unrankedQueue.push(...queue.map((entry) => ({ ...entry, slot })));
              scheduleRanking();
              dispatch(slot);
            } catch (error) { finish(false, error); }
          },
          fail: (error) => finish(false, error),
          fallback() {
            // In-flight work was interrupted by a transport failure, not evaluated.
            if (pendingSeeds.size) {
              retrySeeds = Array.from(pendingSeeds.values());
              pendingSeeds.clear();
            } else issued = draws + prunedDraws;
            if (gpuAcceleration) fallBackFromGpu(new Error("Search Workers unavailable; using CPU fallback"));
            ranking = null;
            preparedQueue = [];
            unrankedQueue = [];
            clearTimeout(rankTimer);
            clearTimeout(fallbackTimer);
            fallbackTimer = setTimeout(tick, 0);
          }
        };
        if (signal) {
          signal.addEventListener("abort", stop, { once: true });
          if (signal.aborted) { stop(); return; }
        }
        try {
          if (useCache && preloadCached && !seedSource) {
            for (const [seed, summary] of outcomes) {
              if (summary && (targetId === null || summary.winnerTeamId === targetId)) {
                cacheHits += 1;
                accept(seed, summary);
                if (!ranked && candidates.length >= candidateLimit) break;
              }
            }
          }
          progress();
          if (settled) return;
          if (!ranked && candidates.length >= candidateLimit) { finish(); return; }
          if (Number.isFinite(budgetMs)) timer = setTimeout(() => finish(), budgetMs);
          warmup();
          if (workersUnavailable) active.fallback();
          else for (const slot of workers) dispatch(slot);
        } catch (error) { finish(false, error); }
      });
    }

    return Object.freeze({
      search, warmup,
      cancel() { if (active) active.stop(); },
      dispose() {
        if (active) active.stop();
        clearTimeout(idleTimer);
        releaseWorkers();
        if (gpuRanker) gpuRanker.dispose();
        gpuRanker = null;
        cache.clear();
      }
    });
  }
  return { createSeedSearch, seedSearchConcurrency };
});
