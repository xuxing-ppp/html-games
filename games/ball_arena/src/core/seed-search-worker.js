"use strict";

(function initializeSeedSearchWorker(root) {
  let send;
  let listen;
  if (typeof module === "object" && module.exports) {
    const { parentPort } = require("node:worker_threads");
    const fs = require("node:fs");
    const path = require("node:path");
    require("./seed-farm.js");
    for (const file of fs.readdirSync(path.join(__dirname, "../balls")).filter((file) => file.endsWith(".js")).sort()) {
      require("../balls/" + file);
    }
    send = (message) => parentPort.postMessage(message);
    listen = (callback) => parentPort.on("message", callback);
  } else {
    send = (message) => root.postMessage(message);
    listen = (callback) => { root.onmessage = (event) => callback(event.data); };
  }

  const MAX_PREPARED_TASKS = 4;
  const retained = new Map();
  let job = null;
  let yieldCount = 0;
  let yieldChannel = null;
  const continuations = [];

  function yieldTask(tick) {
    // Break the browser's nested-timer chain before its 4ms clamp, while keeping
    // ordinary task yields for cancel/reset messages. Never use microtasks here:
    // they would keep the worker from receiving those messages between slices.
    if (++yieldCount % 4 !== 0 || typeof root.MessageChannel !== "function") {
      setTimeout(tick, 0);
      return;
    }
    if (!yieldChannel) {
      yieldChannel = new root.MessageChannel();
      yieldChannel.port1.onmessage = () => {
        const next = continuations.shift();
        if (next) next();
      };
    }
    continuations.push(tick);
    yieldChannel.port2.postMessage(null);
  }

  function describeError(error) {
    const causes = [];
    const seen = new Set();
    for (let cause = error; cause && !seen.has(cause) && causes.length < 8; cause = cause.cause) {
      seen.add(cause);
      causes.push(cause.stack || String(cause));
    }
    return causes.join("\nCaused by: ") || String(error);
  }

  function cutoff(message) {
    return message.pruneOverDuration === true && Number.isFinite(message.durationSecondsMax)
      ? message.durationSecondsMax : Infinity;
  }

  function advanceTask(task, limit, maximum = 32) {
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(maximum,
      Math.floor((limit - task.seconds) / root.BallBattle.DETERMINISTIC_STEP_SECONDS) + 1)) : maximum;
    task.advance(count);
  }

  const isPruned = (task, limit) => !task.done && task.seconds > limit;

  function createTask(message, seed) {
    return root.BallBattle.createDeterministicBattleTask({
      registry: root.BallBattle.ballRegistry,
      config: message.config,
      seed,
      maxSeconds: message.maxSeconds,
      collectEntertainment: message.collectEntertainment === true
    });
  }

  function health(task) {
    return task.engine.game.teams.slice(0, 2).map((team) =>
      team.balls.reduce((sum, ball) => sum + Math.max(0, ball.hp), 0));
  }

  function schedule(current, advance) {
    job = current;
    const tick = () => {
      if (job !== current) return;
      try {
        const start = performance.now();
        do {
          if (advance()) {
            if (job === current) job = null;
            return;
          }
        } while (performance.now() - start < 12);
        yieldTask(tick);
      } catch (error) {
        if (job !== current) return;
        job = null;
        for (const token of current.tokens || []) retained.delete(token);
        send({ type: "error", id: current.id, error: describeError(error) });
      }
    };
    tick();
  }

  function runTask(current) {
    schedule(current, () => {
      advanceTask(current.task, current.cutoff);
      if (isPruned(current.task, current.cutoff)) {
        send({ type: "pruned", id: current.id, seed: current.seed });
        return true;
      }
      if (!current.task.done) return false;
      const result = current.task.result();
      send({ type: "result", id: current.id, seed: result.seed,
        summary: root.BallBattle.summarizeBattleOutcome(result) });
      return true;
    });
  }

  listen((message) => {
    try {
      if (!message || typeof message !== "object") throw new TypeError("Worker requires a message object");
      if (message.type === "init") {
        if (typeof root.importScripts === "function") root.importScripts(...message.scripts);
        send({ type: "ready" });
      } else if (message.type === "cancel") {
        if (job && job.id === message.id) {
          for (const token of job.tokens || []) retained.delete(token);
          job = null;
        }
        for (const [token, entry] of retained) {
          if (entry.id === message.id) retained.delete(token);
        }
      } else if (message.type === "reset") {
        job = null;
        retained.clear();
      } else if (message.type === "prepare") {
        if (job) throw new Error("Worker is busy");
        if (!Array.isArray(message.tasks) || message.tasks.length < 1 ||
            message.tasks.length > MAX_PREPARED_TASKS ||
            retained.size + message.tasks.length > MAX_PREPARED_TASKS) {
          throw new RangeError("Prepare requires capacity for 1 to 4 tasks");
        }
        if (message.maxSeconds !== undefined && (!Number.isFinite(message.maxSeconds) ||
            message.maxSeconds <= 0)) {
          throw new RangeError("Prepare maxSeconds must be positive");
        }
        if (!Number.isFinite(message.prefixSeconds) || message.prefixSeconds <= 0 ||
            message.prefixSeconds > (message.maxSeconds === undefined ? 180 : message.maxSeconds)) {
          throw new RangeError("prefixSeconds must be positive and at most maxSeconds");
        }
        if (message.collectEntertainment !== undefined && typeof message.collectEntertainment !== "boolean") {
          throw new TypeError("collectEntertainment must be boolean");
        }
        const tokens = new Set();
        for (const entry of message.tasks) {
          if (!entry || !Number.isSafeInteger(entry.token) || entry.token <= 0 ||
              tokens.has(entry.token) || retained.has(entry.token)) {
            throw new TypeError("Prepare requires unique positive safe integer tokens");
          }
          if (!Number.isFinite(entry.seed)) throw new TypeError("Prepare requires numeric seeds");
          tokens.add(entry.token);
        }
        const entries = message.tasks.map(({ token, seed }) => {
          const task = createTask(message, seed);
          if (task.engine.game.teams.length !== 2) throw new Error("Prepare requires two named teams");
          return { token, seed: seed >>> 0, task, steps: 0, initialHp: health(task), id: message.id, cutoff: cutoff(message) };
        });
        for (const entry of entries) retained.set(entry.token, entry);
        const prefixSteps = Math.ceil(message.prefixSeconds / root.BallBattle.DETERMINISTIC_STEP_SECONDS);
        let index = 0;
        const prepared = [];
        schedule({ id: message.id, tokens: [...tokens] }, () => {
          const entry = entries[index];
          if (!entry.task.done && entry.steps < prefixSteps) {
            const stepCount = Math.min(32, prefixSteps - entry.steps);
            advanceTask(entry.task, entry.cutoff, stepCount);
            entry.steps = entry.task.steps;
          }
          if (isPruned(entry.task, entry.cutoff)) {
            prepared.push({ token: entry.token, seed: entry.seed, pruned: true });
            retained.delete(entry.token);
            index += 1;
            if (index < entries.length) return false;
            send({ type: "prepared", id: message.id, entries: prepared });
            return true;
          }
          if (!entry.task.done && entry.steps < prefixSteps) return false;
          const result = entry.task.result();
          const hp = health(entry.task);
          const elapsed = result.seconds;
          prepared.push({ token: entry.token, seed: result.seed,
            features: [...entry.initialHp, ...hp,
              ...hp.map((value, teamIndex) => elapsed > 0 ? Math.max(0, entry.initialHp[teamIndex] - value) / elapsed : 0),
              elapsed, result.entertainment ? result.entertainment.score : 0],
            ...(entry.task.done ? { summary: root.BallBattle.summarizeBattleOutcome(result) } : {}) });
          if (entry.task.done) retained.delete(entry.token);
          index += 1;
          if (index < entries.length) return false;
          send({ type: "prepared", id: message.id, entries: prepared });
          return true;
        });
      } else if (message.type === "resume") {
        if (job) throw new Error("Worker is busy");
        const entry = retained.get(message.token);
        if (!entry) throw new Error("Unknown prepared task token");
        retained.delete(message.token);
        runTask({ id: message.id, task: entry.task, seed: entry.seed, cutoff: entry.cutoff });
      } else if (message.type === "run") {
        const current = {
          id: message.id,
          seed: message.seed >>> 0,
          cutoff: cutoff(message),
          task: createTask(message, message.seed)
        };
        runTask(current);
      }
    } catch (error) {
      send({ type: "error", id: message && message.id, error: describeError(error) });
    }
  });
})((typeof globalThis === "object" && globalThis) || self);
