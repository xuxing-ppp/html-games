(function initializeVisualEffectSystem(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createVisualEffectSystemApi() {
  "use strict";

  const LIFECYCLES = new Set(["independent", "owner-bound"]);
  const COUNT_KEYS = ["active", "pending", "particles", "afterimageSamples"];
  const MAX_TIMING_KINDS = 128;

  function nowMilliseconds() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  function effectKind(effect) {
    return typeof effect.kind === "string" && effect.kind ? effect.kind : "visual-effect";
  }

  function emptyCounts() {
    return { active: 0, pending: 0, particles: 0, afterimageSamples: 0 };
  }

  class VisualEffectSystem {
    constructor({
      getOwner = () => null,
      invokeUpdate = () => {},
      now = nowMilliseconds
    } = {}) {
      if (typeof getOwner !== "function" || typeof invokeUpdate !== "function" || typeof now !== "function") {
        throw new TypeError("VisualEffectSystem requires function callbacks");
      }
      this.getOwner = getOwner;
      this.invokeUpdate = invokeUpdate;
      this.effects = [];
      this.pendingEffects = [];
      this.isUpdating = false;
      this.nextId = 1;
      this.now = now;
      this.profilingEnabled = false;
      this.resetStats();
    }

    resetStats() {
      this.counts = emptyCounts();
      this.peak = { ...emptyCounts(), total: 0 };
      this.effectCounts = new WeakMap();
      this.timings = Object.create(null);
      this.timingKindCount = 0;
    }

    setProfilingEnabled(enabled) {
      const next = Boolean(enabled);
      if (next === this.profilingEnabled) return;
      this.profilingEnabled = next;
      this.counts = emptyCounts();
      this.effectCounts = new WeakMap();
      if (next) {
        for (const effect of this.effects) {
          if (effect.visualActive !== false) this.refreshEffectCounts(effect, false);
        }
        for (const effect of this.pendingEffects) {
          if (effect.visualActive !== false) this.refreshEffectCounts(effect, true);
        }
      }
    }

    measureHook(effect, hook, callback) {
      // CPU hook time only; drawGpu submission is not a GPU execution measurement.
      if (!this.profilingEnabled) return callback();
      const started = this.now();
      try {
        return callback();
      } finally {
        const elapsed = Math.max(0, this.now() - started);
        let kind = effectKind(effect);
        if (!this.timings[kind]) {
          if (this.timingKindCount >= MAX_TIMING_KINDS) kind = "other";
          else this.timingKindCount += 1;
        }
        const kindTimings = this.timings[kind] || (this.timings[kind] = Object.create(null));
        const timing = kindTimings[hook] || (kindTimings[hook] = {
          calls: 0, totalMilliseconds: 0, maxMilliseconds: 0
        });
        timing.calls += 1;
        timing.totalMilliseconds += elapsed;
        timing.maxMilliseconds = Math.max(timing.maxMilliseconds, elapsed);
      }
    }

    observePeaks() {
      // Observe lifecycle boundaries, without constructing per-kind snapshots each frame.
      for (const key of COUNT_KEYS) {
        this.peak[key] = Math.max(this.peak[key], this.counts[key]);
      }
      this.peak.total = Math.max(this.peak.total, this.counts.active + this.counts.pending);
    }

    refreshEffectCounts(effect, pending) {
      let previous = this.effectCounts.get(effect);
      const particles = Array.isArray(effect.particles) ? effect.particles.length : 0;
      const samples = Array.isArray(effect.samples) ? effect.samples.length : 0;
      if (
        previous && previous.pending === pending &&
        previous.particles === particles && previous.afterimageSamples === samples
      ) return;
      if (!previous) {
        previous = { particles: 0, afterimageSamples: 0, pending };
        this.effectCounts.set(effect, previous);
        this.counts[pending ? "pending" : "active"] += 1;
      } else if (previous.pending !== pending) {
        this.counts[previous.pending ? "pending" : "active"] -= 1;
        this.counts[pending ? "pending" : "active"] += 1;
        previous.pending = pending;
      }
      this.counts.particles += particles - previous.particles;
      this.counts.afterimageSamples += samples - previous.afterimageSamples;
      previous.particles = particles;
      previous.afterimageSamples = samples;
      this.observePeaks();
    }

    removeEffectCounts(effect) {
      const previous = this.effectCounts.get(effect);
      if (!previous) return;
      this.counts[previous.pending ? "pending" : "active"] -= 1;
      this.counts.particles -= previous.particles;
      this.counts.afterimageSamples -= previous.afterimageSamples;
      this.effectCounts.delete(effect);
    }

    getStats() {
      // Arrays are sampled now: resident trails can feed samples between visual updates.
      const counts = emptyCounts();
      const byKind = Object.create(null);
      const collect = (effects, pending) => {
        for (const effect of effects) {
          if (effect.visualActive === false) {
            if (this.profilingEnabled) this.removeEffectCounts(effect);
            continue;
          }
          if (this.profilingEnabled) this.refreshEffectCounts(effect, pending);
          const kind = effectKind(effect);
          const entry = byKind[kind] || (byKind[kind] = emptyCounts());
          const key = pending ? "pending" : "active";
          const particles = Array.isArray(effect.particles) ? effect.particles.length : 0;
          const samples = Array.isArray(effect.samples) ? effect.samples.length : 0;
          counts[key] += 1;
          entry[key] += 1;
          counts.particles += particles;
          entry.particles += particles;
          counts.afterimageSamples += samples;
          entry.afterimageSamples += samples;
        }
      };
      collect(this.effects, false);
      collect(this.pendingEffects, true);
      for (const key of COUNT_KEYS) this.peak[key] = Math.max(this.peak[key], counts[key]);
      this.peak.total = Math.max(this.peak.total, counts.active + counts.pending);
      const timings = Object.create(null);
      for (const kind of Object.keys(this.timings)) {
        timings[kind] = Object.create(null);
        for (const hook of Object.keys(this.timings[kind])) {
          timings[kind][hook] = { ...this.timings[kind][hook] };
        }
      }
      return {
        profilingEnabled: this.profilingEnabled,
        peakScope: this.profilingEnabled ? "profiled-lifecycle-and-snapshots" : "snapshots",
        ...counts, peak: { ...this.peak }, byKind, timings
      };
    }

    beginStep() {
      this.isUpdating = true;
    }

    endStep() {
      this.isUpdating = false;
    }

    reset() {
      this.effects.length = 0;
      this.pendingEffects.length = 0;
      this.isUpdating = false;
      this.nextId = 1;
      this.resetStats();
    }

    spawn(definition, owner = null, overrides = {}) {
      if (!definition || typeof definition !== "object") {
        throw new TypeError("Visual effect requires a definition");
      }
      const effectiveDefinition = { ...definition, ...overrides };
      if (!Number.isFinite(effectiveDefinition.life) || effectiveDefinition.life <= 0) {
        throw new TypeError("Visual effect requires a positive life");
      }
      if (typeof effectiveDefinition.draw !== "function" && typeof effectiveDefinition.drawGpu !== "function") {
        throw new TypeError("Visual effect requires a draw or drawGpu function");
      }
      const lifecycle = effectiveDefinition.lifecycle === undefined
        ? "independent"
        : effectiveDefinition.lifecycle;
      if (!LIFECYCLES.has(lifecycle)) {
        throw new TypeError(`Visual effect has an invalid lifecycle: ${lifecycle}`);
      }
      if (lifecycle === "owner-bound" && !owner) {
        throw new TypeError("Owner-bound visual effect requires an owner");
      }

      const effect = {
        ...effectiveDefinition,
        instanceId: overrides.instanceId || `visual-${this.nextId++}`,
        ownerId: owner ? owner.id : null,
        ownerInstanceId: owner ? owner.instanceId : null,
        lifecycle,
        age: 0,
        visualActive: true,
        isVisualEffect: true
      };
      const destination = this.isUpdating ? this.pendingEffects : this.effects;
      destination.push(effect);
      if (this.profilingEnabled) this.refreshEffectCounts(effect, this.isUpdating);
      return effect;
    }

    update(dt) {
      const wasUpdating = this.isUpdating;
      this.isUpdating = true;
      const originalLength = this.effects.length;
      let writeIndex = 0;
      let readIndex = 0;
      try {
        for (; readIndex < originalLength; readIndex += 1) {
          const effect = this.effects[readIndex];
          const owner = effect.lifecycle === "owner-bound"
            ? this.getOwner(effect.ownerInstanceId)
            : null;
          if (
            effect.visualActive === false ||
            (effect.lifecycle === "owner-bound" && (!owner || owner.hp <= 0))
          ) {
            if (this.profilingEnabled) this.removeEffectCounts(effect);
            continue;
          }
          if (!this.profilingEnabled) {
            this.invokeUpdate(effect, dt);
          } else {
            this.refreshEffectCounts(effect, false);
            try {
              this.invokeUpdate(effect, dt);
            } finally {
              this.refreshEffectCounts(effect, false);
            }
          }
          effect.age += dt;
          if (effect.visualActive !== false && effect.age < effect.life) {
            this.effects[writeIndex] = effect;
            writeIndex += 1;
          } else {
            if (this.profilingEnabled) this.removeEffectCounts(effect);
          }
        }
        this.effects.length = writeIndex;
      } catch (cause) {
        const retained = new Set(this.effects.slice(0, writeIndex));
        for (let index = readIndex; index < originalLength; index += 1) {
          const effect = this.effects[index];
          if (!effect || retained.has(effect)) continue;
          if (effect.visualActive === false) {
            if (this.profilingEnabled) this.removeEffectCounts(effect);
            continue;
          }
          this.effects[writeIndex] = effect;
          writeIndex += 1;
          retained.add(effect);
        }
        this.effects.length = writeIndex;
        throw cause;
      } finally {
        this.isUpdating = wasUpdating;
      }
    }

    flushPending() {
      if (this.pendingEffects.length === 0) return;
      for (const effect of this.pendingEffects) {
        const owner = effect.lifecycle === "owner-bound"
          ? this.getOwner(effect.ownerInstanceId)
          : null;
        if (
          effect.visualActive === false ||
          (effect.lifecycle === "owner-bound" && (!owner || owner.hp <= 0))
        ) {
          effect.visualActive = false;
          if (this.profilingEnabled) this.removeEffectCounts(effect);
          continue;
        }
        this.effects.push(effect);
        if (this.profilingEnabled) this.refreshEffectCounts(effect, false);
      }
      this.pendingEffects.length = 0;
    }

    discardPending() {
      for (const effect of this.pendingEffects) {
        effect.visualActive = false;
        if (this.profilingEnabled) this.removeEffectCounts(effect);
      }
      this.pendingEffects.length = 0;
    }
  }

  return { VisualEffectSystem, VISUAL_EFFECT_LIFECYCLES: LIFECYCLES };
});
