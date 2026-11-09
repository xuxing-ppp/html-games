(function initializeSeedSearchGpu(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createSeedSearchGpuApi() {
  "use strict";
  const MAX_BATCH = 32;
  const LIMIT = 1e12;

  // This is an extrapolation heuristic, not a learned battle model. The GPU
  // orders a bounded batch only; every candidate still needs full CPU simulation.
  // Features: initial HP (two teams), current HP, observed HP loss/second,
  // elapsed unscaled simulation-input seconds, and the observed entertainment
  // score (0..100). Time-control abilities can invalidate this extrapolation.
  const SEED_SEARCH_GPU_SHADER = `
struct Features { hp: vec4f, progress: vec4f }
@group(0) @binding(0) var<storage, read> entries: array<Features>;
@group(0) @binding(1) var<storage, read> criteria: array<f32>;
@group(0) @binding(2) var<storage, read_write> scores: array<f32>;
fn outside(value: f32, low: f32, high: f32) -> f32 {
  return max(low - value, 0.0) + max(value - high, 0.0);
}
@compute @workgroup_size(32)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let index = id.x;
  if (index >= u32(criteria[0])) { return; }
  let f = entries[index];
  let rate0 = f.progress.x;
  let rate1 = f.progress.y;
  if (rate0 == 0.0 && rate1 == 0.0) { scores[index] = 1000000.0; return; }
  var until0 = 1000000000000.0;
  var until1 = 1000000000000.0;
  if (rate0 > 0.0) { until0 = min(f.hp.z / rate0, 1000000000000.0); }
  if (rate1 > 0.0) { until1 = min(f.hp.w / rate1, 1000000000000.0); }
  let remaining = max(criteria[8] - f.progress.z, 0.0);
  let defeat = min(until0, until1);
  var winner = -1.0;
  var winnerHp = 0.0;
  if (defeat <= remaining && until0 != until1) {
    if (until1 < until0) { winner = 0.0; winnerHp = max(f.hp.z - rate0 * defeat, 0.0); }
    else { winner = 1.0; winnerHp = max(f.hp.w - rate1 * defeat, 0.0); }
  }
  let duration = f.progress.z + min(defeat, remaining);
  var score = outside(winnerHp, criteria[2], criteria[3]) / max(max(f.hp.x, f.hp.y), 1.0) * 20.0;
  score += outside(duration, criteria[4], criteria[5]) / max(criteria[8], 1.0) * 20.0;
  score += max(criteria[6] - f.progress.w, 0.0) * 0.2;
  if (criteria[1] >= 0.0 && winner != criteria[1]) { score += 100.0; }
  if (winner < 0.0) { score += 50.0; }
  score += 2.0 / (1.0 + f.progress.z);
  if (criteria[7] > 0.0) { score -= f.progress.w * 0.01; }
  scores[index] = score;
}`;

  function finite(value, name, { positive = false, maximum = LIMIT } = {}) {
    if (!Number.isFinite(value) || value < 0 || (positive && value === 0) || value > maximum) {
      throw new TypeError(`Seed search GPU: invalid ${name}`);
    }
    return value;
  }

  function prepare(entries, criteria = {}) {
    if (!Array.isArray(entries) || entries.length > MAX_BATCH) throw new TypeError("Seed search GPU: batch must contain at most 32 entries");
    const tokens = new Set();
    const snapshots = entries.map((entry) => {
      if (!entry || !["string", "number"].includes(typeof entry.token) ||
          (typeof entry.token === "number" && !Number.isFinite(entry.token)) || tokens.has(entry.token)) {
        throw new TypeError("Seed search GPU: unique finite numeric or string tokens required");
      }
      tokens.add(entry.token);
      if (!Number.isInteger(entry.seed) || entry.seed < 0 || entry.seed > 0xffffffff) throw new TypeError("Seed search GPU: invalid seed");
      if (!Array.isArray(entry.features) || entry.features.length !== 8) throw new TypeError("Seed search GPU: eight features required");
      const features = entry.features.map((value, index) => Math.fround(finite(value, `feature ${index}`, {
        positive: index < 2, maximum: index === 7 ? 100 : LIMIT
      })));
      return { token: entry.token, features };
    });
    if (!criteria || typeof criteria !== "object") throw new TypeError("Seed search GPU: criteria required");
    const { winnerTeamIndex = null, winnerHpMin = 0, winnerHpMax = Infinity,
      durationSecondsMin = 0, durationSecondsMax = Infinity, entertainmentMin = 0,
      selectionMode = "first", maxSeconds = 120 } = criteria;
    if (![null, 0, 1].includes(winnerTeamIndex) || !["first", "best"].includes(selectionMode)) throw new TypeError("Seed search GPU: invalid winner or selection mode");
    const upper = (value, name) => value === Infinity ? LIMIT : finite(value, name);
    const values = [entries.length, winnerTeamIndex === null ? -1 : winnerTeamIndex,
      finite(winnerHpMin, "winnerHpMin"), upper(winnerHpMax, "winnerHpMax"),
      finite(durationSecondsMin, "durationSecondsMin"), upper(durationSecondsMax, "durationSecondsMax"),
      finite(entertainmentMin, "entertainmentMin", { maximum: 100 }), selectionMode === "best" ? 1 : 0,
      finite(maxSeconds, "maxSeconds", { positive: true })];
    if (values[2] > values[3] || values[4] > values[5]) throw new TypeError("Seed search GPU: reversed criteria range");
    return { snapshots, values: values.map(Math.fround) };
  }

  // CPU reference for shader parity tests and diagnostics, never an outcome test.
  function scoreSeedSearchGpuFeatures(features, criteria = {}) {
    const { snapshots, values: p } = prepare([{ token: 0, seed: 0, features }], criteria);
    const [initial0, initial1, hp0, hp1, rate0, rate1, elapsed, drama] = snapshots[0].features;
    if (rate0 === 0 && rate1 === 0) return 1000000;
    const until0 = rate0 > 0 ? Math.min(hp0 / rate0, LIMIT) : LIMIT;
    const until1 = rate1 > 0 ? Math.min(hp1 / rate1, LIMIT) : LIMIT;
    const remaining = Math.max(p[8] - elapsed, 0);
    const defeat = Math.min(until0, until1);
    let winner = -1;
    let winnerHp = 0;
    if (defeat <= remaining && until0 !== until1) {
      winner = until1 < until0 ? 0 : 1;
      winnerHp = Math.max(winner === 0 ? hp0 - rate0 * defeat : hp1 - rate1 * defeat, 0);
    }
    const outside = (value, low, high) => Math.max(low - value, 0) + Math.max(value - high, 0);
    let score = outside(winnerHp, p[2], p[3]) / Math.max(initial0, initial1, 1) * 20;
    score += outside(elapsed + Math.min(defeat, remaining), p[4], p[5]) / Math.max(p[8], 1) * 20;
    score += Math.max(p[6] - drama, 0) * 0.2;
    if (p[1] >= 0 && winner !== p[1]) score += 100;
    if (winner < 0) score += 50;
    score += 2 / (1 + elapsed);
    if (p[7] > 0) score -= drama * 0.01;
    return Math.fround(score);
  }

  function createSeedSearchGpuRanker({ gpu = globalThis.navigator && globalThis.navigator.gpu, timeoutMs = 5000 } = {}) {
    finite(timeoutMs, "timeoutMs", { positive: true, maximum: 30000 });
    let disposed = false;
    let failure = null;
    let device = null;
    let resources = null;
    let initialization = null;
    let busy = false;
    const cancellations = new Set();

    function destroyResources() {
      if (resources) {
        for (const buffer of resources.buffers) { try { buffer.destroy(); } catch (_error) { /* continue releasing the rest */ } }
        resources = null;
      }
      if (device) { try { device.destroy(); } catch (_error) { /* remaining handles are already released */ } finally { device = null; } }
    }
    function fail(error) {
      if (!failure) failure = error;
      for (const reject of cancellations) reject(failure);
      destroyResources();
    }
    function bounded(operation, label) {
      let timer;
      let cancel;
      const stopped = new Promise((_resolve, reject) => {
        cancel = reject;
        cancellations.add(cancel);
        timer = setTimeout(() => fail(new Error(`Seed search GPU: ${label} timed out`)), timeoutMs);
      });
      return Promise.race([operation, stopped]).finally(() => {
        clearTimeout(timer);
        cancellations.delete(cancel);
      });
    }
    function check() {
      if (disposed) throw new Error("Seed search GPU: disposed");
      if (failure) throw failure;
    }
    async function initialize() {
      if (!gpu || typeof gpu.requestAdapter !== "function") throw new Error("Seed search GPU: WebGPU unavailable");
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      check();
      if (!adapter) throw new Error("Seed search GPU: no adapter available");
      const acquired = await adapter.requestDevice();
      if (disposed || failure) { acquired.destroy(); check(); }
      device = acquired;
      device.lost.then((info) => { if (!disposed && !failure) fail(new Error(`Seed search GPU: device lost (${info.message || info.reason || "unknown"})`)); });
      const module = device.createShaderModule({ label: "Seed candidate heuristic", code: SEED_SEARCH_GPU_SHADER });
      const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
      check();
      const buffers = [];
      resources = { buffers };
      // WebGPU flag values are standardized; numeric flags also allow this UMD
      // module to be loaded in Node without browser GPU globals.
      const input = device.createBuffer({ size: MAX_BATCH * 8 * 4, usage: 128 | 8 }); buffers.push(input);
      const params = device.createBuffer({ size: 9 * 4, usage: 128 | 8 }); buffers.push(params);
      const output = device.createBuffer({ size: MAX_BATCH * 4, usage: 128 | 4 }); buffers.push(output);
      const readback = device.createBuffer({ size: MAX_BATCH * 4, usage: 1 | 8 }); buffers.push(readback);
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: params } },
        { binding: 2, resource: { buffer: output } }
      ] });
      const info = adapter.info || {};
      Object.assign(resources, { input, params, output, readback, pipeline, bindGroup,
        adapter: Object.fromEntries(["vendor", "architecture", "device", "description"].map((key) => [key, String(info[key] || "")])) });
    }

    async function rank(entries, criteria) {
      check();
      const { snapshots, values } = prepare(entries, criteria);
      if (busy) throw new Error("Seed search GPU: rank already in progress");
      busy = true;
      try {
        if (!initialization) initialization = bounded(initialize(), "initialization");
        await initialization;
        check();
        const r = resources;
        if (!snapshots.length) return { order: [], adapter: { ...r.adapter } };
        const operation = (async () => {
          device.queue.writeBuffer(r.input, 0, new Float32Array(snapshots.flatMap((entry) => entry.features)));
          device.queue.writeBuffer(r.params, 0, new Float32Array(values));
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginComputePass();
          pass.setPipeline(r.pipeline);
          pass.setBindGroup(0, r.bindGroup);
          pass.dispatchWorkgroups(1);
          pass.end();
          encoder.copyBufferToBuffer(r.output, 0, r.readback, 0, snapshots.length * 4);
          device.queue.submit([encoder.finish()]);
          await r.readback.mapAsync(1);
          check();
          let scores;
          try { scores = new Float32Array(r.readback.getMappedRange()).slice(0, snapshots.length); }
          finally { r.readback.unmap(); }
          if (scores.length !== snapshots.length || Array.from(scores).some((score) => !Number.isFinite(score))) throw new Error("Seed search GPU: invalid scores returned");
          const indices = snapshots.map((_entry, index) => index).sort((a, b) => scores[a] - scores[b] || a - b);
          return { order: indices.map((index) => snapshots[index].token), adapter: { ...r.adapter } };
        })();
        return await bounded(operation, "ranking");
      } catch (error) {
        fail(error);
        throw error;
      } finally { busy = false; }
    }
    return { rank, dispose() {
      if (disposed) return;
      disposed = true;
      fail(new Error("Seed search GPU: disposed"));
    } };
  }

  return { createSeedSearchGpuRanker, scoreSeedSearchGpuFeatures, SEED_SEARCH_GPU_SHADER };
});
