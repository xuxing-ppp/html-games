(function initializeAudio(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createAudioApi() {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  class BounceAudio {
    constructor({
      AudioConstructor = globalThis.AudioContext || globalThis.webkitAudioContext
    } = {}) {
      this.AudioConstructor = AudioConstructor;
      this.audioContext = null;
      this.captureDestination = null;
      this.lastBounceSoundAt = 0;
    }

    ensureContext() {
      if (!this.audioContext) {
        if (!this.AudioConstructor) return null;
        this.audioContext = new this.AudioConstructor();
      }
      if (
        !this.captureDestination &&
        typeof this.audioContext.createMediaStreamDestination === "function"
      ) {
        this.captureDestination = this.audioContext.createMediaStreamDestination();
      }
      return this.audioContext;
    }

    getCaptureStream() {
      this.ensureContext();
      return this.captureDestination ? this.captureDestination.stream : null;
    }

    play(ball, intensity = 1) {
      try {
        const audioContext = this.ensureContext();
        if (!audioContext) return;
        // Combat entities have no ball.speed; fall back to the base pitch.
        const speed = ball && Number.isFinite(ball.speed) ? ball.speed : 150;
        const pitch = clamp(speed / 150, 0.8, 1.2);

        const activate = () => {
          try {
            const now = audioContext.currentTime;
            if (now - this.lastBounceSoundAt < 0.045) return;
            this.lastBounceSoundAt = now;

            const gain = audioContext.createGain();
            const oscillator = audioContext.createOscillator();
            const filter = audioContext.createBiquadFilter();
            oscillator.type = "square";
            oscillator.frequency.setValueAtTime(240 * pitch, now);
            oscillator.frequency.exponentialRampToValueAtTime(120 * pitch, now + 0.08);
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(1400, now);
            filter.frequency.exponentialRampToValueAtTime(420, now + 0.08);
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(0.08 * intensity, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
            oscillator.connect(filter);
            filter.connect(gain);
            gain.connect(audioContext.destination);
            if (this.captureDestination) gain.connect(this.captureDestination);
            oscillator.start(now);
            oscillator.stop(now + 0.1);
          } catch (_error) {
            // Audio is optional and must never stop the battle loop.
          }
        };

        if (audioContext.state === "suspended") {
          audioContext.resume().then(activate).catch(() => {});
        } else {
          activate();
        }
      } catch (_error) {
        // Browser audio setup can fail independently of game simulation.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // BattleAudio: procedural sound system for the full battle.
  //
  // Design rules (mirroring the recorder contract in AGENTS.md):
  // - every audible sound is routed to both the speakers and the shared
  //   MediaStreamDestination, so recordings hear exactly what players hear;
  // - no microphone, desktop, or system capture APIs are ever used;
  // - audio synthesis is best effort: any failure is swallowed and can never
  //   interrupt the battle simulation;
  // - sounds are synthesized (no asset files), so the no-bundler UMD loading
  //   order in index.html stays untouched.
  //
  // The engine emits neutral events (physical impacts via onBounce plus
  // shoot/hit/death/status/summon via onSound). This layer owns presentation:
  // each roster ball maps to a voice family, a personal pitch, and a
  // signature tint so every ball sounds unique; control effects pick a
  // thematic recipe from their effect id; and damage events layer severity
  // accents while boss and summon subjects get their own death/spawn cues.
  // ---------------------------------------------------------------------------

  const NEUTRAL = { family: "ball", pitch: 1, tint: null };

  function subjectKeyOf(subject) {
    if (!subject || typeof subject !== "object") return "anon";
    return String(subject.instanceId || subject.id || "anon");
  }

  // Shared synthesis primitives. All nodes end in audio.master; the master
  // bus fans out to the speakers and the capture destination.
  function tone(audio, t0, {
    type = "sine",
    from,
    to = null,
    at = 0,
    duration = 0.1,
    gain = 0.1,
    attack = 0.004,
    filter = null,
    filterFrom = 8000,
    filterTo = null
  } = {}) {
    const ctx = audio.audioContext;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const nodes = [oscillator, gainNode];
    const start = t0 + at;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(24, from), start);
    if (to !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, to), start + duration);
    }
    let head = oscillator;
    if (filter) {
      const filterNode = ctx.createBiquadFilter();
      nodes.push(filterNode);
      filterNode.type = filter;
      filterNode.frequency.setValueAtTime(Math.max(40, filterFrom), start);
      if (filterTo !== null) {
        filterNode.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), start + duration);
      }
      oscillator.connect(filterNode);
      head = filterNode;
    }
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + attack + duration);
    head.connect(gainNode);
    gainNode.connect(audio.master);
    audio.trackSource(oscillator, nodes, start + attack + duration + 0.05);
    oscillator.start(start);
    oscillator.stop(start + attack + duration + 0.05);
  }

  function noiseBurst(audio, t0, {
    at = 0,
    duration = 0.1,
    gain = 0.08,
    attack = 0.003,
    filter = "lowpass",
    from,
    to = null,
    q = 0.9
  } = {}) {
    if (!audio.noiseBuffer) return;
    const ctx = audio.audioContext;
    const source = ctx.createBufferSource();
    source.buffer = audio.noiseBuffer;
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = filter;
    const gainNode = ctx.createGain();
    const start = t0 + at;
    filterNode.frequency.setValueAtTime(Math.max(40, from), start);
    if (to !== null) {
      filterNode.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + duration);
    }
    if (filterNode.Q && typeof filterNode.Q === "object") {
      filterNode.Q.value = q;
    }
    gainNode.gain.setValueAtTime(0.0001, start);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, start + attack + duration);
    source.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(audio.master);
    audio.trackSource(source, [source, filterNode, gainNode], start + attack + duration + 0.05);
    source.start(start);
    source.stop(start + attack + duration + 0.05);
  }

  // Recipe library. Each recipe draws one short synthesized sound; `gain`
  // scales the mix, `pitch` transposes the tonal parts.
  const RECIPES = {
    // Physical impact base: the established wall-bounce square blip.
    blip(audio, t0, { pitch = 1, gain = 1 } = {}) {
      const ctx = audio.audioContext;
      const oscillator = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gainNode = ctx.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(240 * pitch, t0);
      oscillator.frequency.exponentialRampToValueAtTime(120 * pitch, t0 + 0.08);
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(1400, t0);
      filter.frequency.exponentialRampToValueAtTime(420, t0 + 0.08);
      gainNode.gain.setValueAtTime(0.0001, t0);
      gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.08 * gain), t0 + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      oscillator.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(audio.master);
      audio.trackSource(oscillator, [oscillator, filter, gainNode], t0 + 0.1);
      oscillator.start(t0);
      oscillator.stop(t0 + 0.1);
    },
    pop(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 460 * pitch, to: 190, duration: 0.07, gain: 0.1 * gain
      });
    },
    thud(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 130 * pitch, to: 48, duration: 0.16, gain: 0.16 * gain, attack: 0.006
      });
      noiseBurst(audio, t0, { duration: 0.08, gain: 0.08 * gain, from: 300, to: 90 });
    },
    clang(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 520 * pitch, duration: 0.2, gain: 0.05 * gain, filter: "bandpass", filterFrom: 1600
      });
      tone(audio, t0, {
        type: "square", from: 793 * pitch, duration: 0.14, gain: 0.03 * gain, filter: "bandpass", filterFrom: 2200
      });
      noiseBurst(audio, t0, { duration: 0.03, gain: 0.05 * gain, filter: "highpass", from: 3000 });
    },
    pool(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 1900 * pitch, to: 1500 * pitch, duration: 0.03, gain: 0.09 * gain
      });
      noiseBurst(audio, t0, { duration: 0.02, gain: 0.06 * gain, filter: "highpass", from: 4000 });
    },
    wood(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 340 * pitch, to: 180, duration: 0.09, gain: 0.12 * gain
      });
      noiseBurst(audio, t0, { duration: 0.05, gain: 0.07 * gain, filter: "bandpass", from: 900 });
    },
    click(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 1700 * pitch, duration: 0.025, gain: 0.06 * gain
      });
      noiseBurst(audio, t0, { duration: 0.02, gain: 0.04 * gain, filter: "highpass", from: 3000 });
    },
    squish(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 260 * pitch, to: 60, duration: 0.13, gain: 0.12 * gain, attack: 0.008
      });
      noiseBurst(audio, t0, { duration: 0.1, gain: 0.05 * gain, from: 500, to: 200 });
    },
    splat(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.22, gain: 0.14 * gain, from: 800, to: 120 });
      tone(audio, t0, {
        type: "sine", from: 180 * pitch, to: 50, duration: 0.15, gain: 0.08 * gain
      });
    },
    boing(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 140 * pitch, to: 100 * pitch, duration: 0.2, gain: 0.11 * gain, attack: 0.01
      });
      tone(audio, t0, {
        type: "sine", from: 320 * pitch, to: 130 * pitch, at: 0.02, duration: 0.12, gain: 0.05 * gain
      });
    },
    snap(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.045, gain: 0.12 * gain, filter: "bandpass", from: 2500 });
      tone(audio, t0, {
        type: "square", from: 900 * pitch, to: 200, duration: 0.05, gain: 0.05 * gain
      });
    },
    rustle(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.14, gain: 0.07 * gain, filter: "bandpass", from: 3800, to: 2200
      });
    },
    fizz(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.3, gain: 0.05 * gain, filter: "highpass", from: 3200 });
      tone(audio, t0, {
        type: "sine", from: 500 * pitch, to: 240, duration: 0.25, gain: 0.04 * gain, attack: 0.02
      });
    },
    bubble(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 220 * pitch, to: 620 * pitch, duration: 0.09, gain: 0.07 * gain
      });
    },
    splash(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.2, gain: 0.1 * gain, from: 1400, to: 300 });
      tone(audio, t0, {
        type: "sine", from: 300 * pitch, to: 90, duration: 0.12, gain: 0.06 * gain
      });
    },
    zap(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 900 * pitch, to: 540 * pitch, duration: 0.11,
        gain: 0.08 * gain, filter: "highpass", filterFrom: 300
      });
      noiseBurst(audio, t0, { duration: 0.06, gain: 0.05 * gain, filter: "highpass", from: 3800 });
    },
    laser(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 1750 * pitch, to: 170, duration: 0.17, gain: 0.08 * gain
      });
      tone(audio, t0, {
        type: "square", from: 1750 * pitch, to: 176, duration: 0.17, gain: 0.03 * gain
      });
    },
    buzz(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 145 * pitch, to: 132 * pitch, duration: 0.28,
        gain: 0.1 * gain, filter: "lowpass", filterFrom: 520
      });
    },
    grind(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 95 * pitch, to: 70, duration: 0.2,
        gain: 0.1 * gain, filter: "lowpass", filterFrom: 350
      });
      noiseBurst(audio, t0, {
        duration: 0.15, gain: 0.06 * gain, filter: "bandpass", from: 700, to: 400
      });
    },
    boom(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.5, gain: 0.22 * gain, from: 1000, to: 70 });
      tone(audio, t0, {
        type: "sine", from: 150 * pitch, to: 38, duration: 0.4, gain: 0.18 * gain, attack: 0.006
      });
    },
    gun(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.07, gain: 0.13 * gain, filter: "bandpass", from: 1800, to: 500
      });
      tone(audio, t0, {
        type: "square", from: 210 * pitch, to: 80, duration: 0.05, gain: 0.07 * gain
      });
    },
    cannon(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.35, gain: 0.18 * gain, from: 700, to: 90 });
      tone(audio, t0, {
        type: "sine", from: 110 * pitch, to: 35, duration: 0.3, gain: 0.14 * gain
      });
    },
    twang(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 380 * pitch, to: 250 * pitch, duration: 0.16, gain: 0.09 * gain
      });
      tone(audio, t0, {
        type: "triangle", from: 384 * pitch, to: 252 * pitch, duration: 0.16, gain: 0.05 * gain
      });
      noiseBurst(audio, t0, { duration: 0.05, gain: 0.04 * gain, filter: "bandpass", from: 1200 });
    },
    swish(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.11, gain: 0.09 * gain, filter: "bandpass", from: 2400, to: 600
      });
    },
    whoosh(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.22, gain: 0.1 * gain, filter: "bandpass", from: 400, to: 1600
      });
    },
    chime(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 880 * pitch, duration: 0.5, gain: 0.07 * gain, attack: 0.008
      });
      tone(audio, t0, {
        type: "sine", from: 1318 * pitch, at: 0.03, duration: 0.45, gain: 0.045 * gain, attack: 0.008
      });
    },
    sparkle(audio, t0, { pitch = 1, gain = 1 } = {}) {
      [1450, 1820, 2210].forEach((freq, index) => {
        tone(audio, t0, {
          type: "sine", from: freq * pitch, at: index * 0.05, duration: 0.16, gain: 0.05 * gain
        });
      });
    },
    pluck(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 440 * pitch, to: 428 * pitch, duration: 0.25, gain: 0.09 * gain
      });
      noiseBurst(audio, t0, { duration: 0.02, gain: 0.04 * gain, filter: "lowpass", from: 2000 });
    },
    sonic(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 240 * pitch, to: 60, duration: 0.3, gain: 0.12 * gain
      });
      noiseBurst(audio, t0, { duration: 0.25, gain: 0.08 * gain, from: 900, to: 200 });
    },
    note(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 660 * pitch, duration: 0.09, gain: 0.06 * gain
      });
      tone(audio, t0, {
        type: "square", from: 990 * pitch, at: 0.08, duration: 0.09, gain: 0.05 * gain
      });
    },
    squeak(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 900 * pitch, to: 1400 * pitch, duration: 0.08, gain: 0.06 * gain
      });
    },
    chomp(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 300 * pitch, to: 90, duration: 0.07, gain: 0.1 * gain
      });
      noiseBurst(audio, t0, { duration: 0.05, gain: 0.06 * gain, filter: "bandpass", from: 600 });
    },
    punch(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 220 * pitch, to: 60, duration: 0.09, gain: 0.14 * gain
      });
      noiseBurst(audio, t0, { duration: 0.06, gain: 0.09 * gain, from: 900, to: 200 });
    },
    crackle(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.22, gain: 0.06 * gain, filter: "highpass", from: 2600 });
      noiseBurst(audio, t0, { duration: 0.2, gain: 0.05 * gain, from: 500, to: 150 });
    },
    frost(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.18, gain: 0.06 * gain, filter: "bandpass", from: 5200, to: 2400
      });
      tone(audio, t0, {
        type: "sine", from: 2600 * pitch, to: 2100 * pitch, duration: 0.12, gain: 0.03 * gain
      });
    },
    icetink(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 1850 * pitch, to: 1600 * pitch, duration: 0.14, gain: 0.05 * gain
      });
      noiseBurst(audio, t0, { duration: 0.03, gain: 0.04 * gain, filter: "highpass", from: 5000 });
    },
    icecrack(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.2, gain: 0.1 * gain, filter: "bandpass", from: 3000, to: 800
      });
      tone(audio, t0, {
        type: "sine", from: 2200 * pitch, to: 900, duration: 0.12, gain: 0.05 * gain
      });
    },
    glitch(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 800 * pitch, to: 300 * pitch, duration: 0.18, gain: 0.06 * gain
      });
      tone(audio, t0, {
        type: "square", from: 1200 * pitch, at: 0.09, duration: 0.09, gain: 0.04 * gain
      });
      noiseBurst(audio, t0, { duration: 0.15, gain: 0.04 * gain, filter: "bandpass", from: 1000 });
    },
    shatter(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.18, gain: 0.09 * gain, filter: "highpass", from: 2800 });
      [2400, 1900, 1500].forEach((freq, index) => {
        tone(audio, t0, {
          type: "sine", from: freq * pitch, at: 0.02 + index * 0.04, duration: 0.1, gain: 0.04 * gain
        });
      });
    },
    ghost(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 460 * pitch, to: 180, duration: 0.4, gain: 0.07 * gain, attack: 0.06
      });
      tone(audio, t0, {
        type: "sine", from: 464 * pitch, to: 184, duration: 0.4, gain: 0.05 * gain, attack: 0.06
      });
    },
    rumble(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.4, gain: 0.14 * gain, from: 240, to: 60 });
      tone(audio, t0, {
        type: "sine", from: 65 * pitch, to: 45, duration: 0.35, gain: 0.1 * gain
      });
    },
    horn(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 92 * pitch, to: 70, duration: 0.35,
        gain: 0.1 * gain, filter: "lowpass", filterFrom: 400
      });
    },
    wilt(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 320 * pitch, to: 60, duration: 0.35, gain: 0.07 * gain, attack: 0.05
      });
    },
    down(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 420 * pitch, to: 110, duration: 0.28, gain: 0.1 * gain
      });
    },
    crash(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.3, gain: 0.12 * gain, from: 2500, to: 200 });
      tone(audio, t0, {
        type: "square", from: 480 * pitch, to: 220, duration: 0.2, gain: 0.06 * gain
      });
    },
    toggle(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "square", from: 640 * pitch, to: 880 * pitch, duration: 0.06, gain: 0.05 * gain
      });
      tone(audio, t0, {
        type: "square", from: 880 * pitch, to: 620 * pitch, at: 0.07, duration: 0.07, gain: 0.045 * gain
      });
    },

    // --- status channel recipes -------------------------------------------
    // Control effects carry their effect id in the event; the status channel
    // picks a thematic recipe from it before falling back to the voice family.
    stunzap(audio, t0, { pitch = 1, gain = 1 } = {}) {
      for (let index = 0; index < 3; index += 1) {
        tone(audio, t0, {
          type: "sawtooth",
          from: 1200 * pitch,
          to: (700 - index * 100) * pitch,
          at: index * 0.07,
          duration: 0.05,
          gain: (0.07 - index * 0.01) * gain,
          filter: "highpass",
          filterFrom: 400
        });
      }
    },
    knockback(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.18, gain: 0.11 * gain, filter: "bandpass", from: 500, to: 2000
      });
      tone(audio, t0, {
        type: "sine", from: 150 * pitch, to: 55, duration: 0.16,
        gain: 0.13 * gain, attack: 0.005
      });
    },
    poisoned(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 320 * pitch, to: 110, duration: 0.22,
        gain: 0.08 * gain, attack: 0.02
      });
      noiseBurst(audio, t0, {
        at: 0.05, duration: 0.2, gain: 0.05 * gain, filter: "lowpass", from: 900, to: 300
      });
    },
    sear(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.28, gain: 0.09 * gain, filter: "bandpass", from: 1800, to: 700
      });
      tone(audio, t0, {
        type: "sawtooth", from: 240 * pitch, to: 90, duration: 0.2,
        gain: 0.04 * gain, filter: "lowpass", filterFrom: 900
      });
    },
    freezefx(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, {
        duration: 0.2, gain: 0.07 * gain, filter: "bandpass", from: 5200, to: 2600
      });
      [2093, 1568].forEach((freq, index) => {
        tone(audio, t0, {
          type: "sine", from: freq * pitch, at: 0.03 + index * 0.05,
          duration: 0.14, gain: 0.045 * gain
        });
      });
    },
    dancebeat(audio, t0, { pitch = 1, gain = 1 } = {}) {
      for (let index = 0; index < 4; index += 1) {
        tone(audio, t0, {
          type: "square", from: (index % 2 ? 220 : 165) * pitch,
          at: index * 0.09, duration: 0.05, gain: 0.05 * gain
        });
        noiseBurst(audio, t0, {
          at: index * 0.09 + 0.045, duration: 0.03, gain: 0.03 * gain,
          filter: "highpass", from: 5000
        });
      }
    },
    dread(audio, t0, { pitch = 1, gain = 1 } = {}) {
      [110, 116].forEach((base, index) => {
        tone(audio, t0, {
          type: "sawtooth", from: base * pitch, to: base * 0.5 * pitch,
          duration: 0.45, gain: (0.07 - index * 0.02) * gain, attack: 0.08,
          filter: "lowpass", filterFrom: 500
        });
      });
    },
    sludge(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 420 * pitch, to: 70, duration: 0.3,
        gain: 0.09 * gain, attack: 0.03
      });
      noiseBurst(audio, t0, {
        duration: 0.24, gain: 0.04 * gain, filter: "lowpass", from: 600, to: 150
      });
    },
    sealed(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.05, gain: 0.1 * gain, filter: "bandpass", from: 2200 });
      tone(audio, t0, {
        type: "square", from: 660 * pitch, to: 130, duration: 0.09, gain: 0.06 * gain
      });
    },

    // --- special channel recipes -------------------------------------------
    summonpop(audio, t0, { pitch = 1, gain = 1 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 300 * pitch, to: 720 * pitch, duration: 0.08,
        gain: 0.06 * gain
      });
      tone(audio, t0, {
        type: "sine", from: 600 * pitch, to: 900 * pitch, at: 0.05,
        duration: 0.07, gain: 0.035 * gain
      });
    },
    bossfall(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.7, gain: 0.2 * gain, from: 1200, to: 60 });
      tone(audio, t0, {
        type: "sine", from: 120 * pitch, to: 30, duration: 0.65,
        gain: 0.16 * gain, attack: 0.008
      });
      tone(audio, t0, {
        type: "sawtooth", from: 90 * pitch, to: 40, at: 0.1, duration: 0.5,
        gain: 0.07 * gain, filter: "lowpass", filterFrom: 300
      });
    },
    crit(audio, t0, { pitch = 1, gain = 1 } = {}) {
      noiseBurst(audio, t0, { duration: 0.3, gain: 0.16 * gain, from: 1600, to: 120 });
      tone(audio, t0, {
        type: "sine", from: 170 * pitch, to: 42, duration: 0.28,
        gain: 0.14 * gain, attack: 0.005
      });
    }
  };

  // Signature tints: a short per-ball decoration layered over the family
  // recipe. Family + pitch + tint together form a ball's voice signature, so
  // two balls in the same family never sound identical. Every tint is drawn
  // at the ball's personal pitch and the event gain.
  const VOICE_TINTS = {
    // Beating dual sines: magical, energetic shimmer.
    detune(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.12 } = {}) {
      const base = 620 * pitch;
      tone(audio, t0, { type: "sine", from: base, at, duration, gain: 0.035 * gain });
      tone(audio, t0, { type: "sine", from: base * 1.028, at, duration, gain: 0.03 * gain });
    },
    // Sub-octave thump: weight and mass.
    sub(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.18 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 92 * pitch, to: 55 * pitch, at, duration,
        gain: 0.07 * gain, attack: 0.006
      });
    },
    // Bright octave sparkle: quick and light.
    octave(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.09 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 1320 * pitch, to: 1180 * pitch, at, duration, gain: 0.03 * gain
      });
    },
    // Open fifth horn interval: epic, heroic.
    fifth(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.16 } = {}) {
      [294, 440].forEach((freq, index) => {
        tone(audio, t0, {
          type: "triangle", from: freq * pitch, at, duration,
          gain: (0.04 - index * 0.005) * gain, attack: 0.01
        });
      });
    },
    // Fast two-note flourish: playful, tricky.
    trill(audio, t0, { pitch = 1, gain = 1, at = 0 } = {}) {
      tone(audio, t0, {
        type: "square", from: 720 * pitch, at, duration: 0.035, gain: 0.028 * gain
      });
      tone(audio, t0, {
        type: "square", from: 960 * pitch, at: at + 0.045, duration: 0.035,
        gain: 0.024 * gain
      });
    },
    // Alternating pitch dip and rise: quirky, unstable.
    wobble(audio, t0, { pitch = 1, gain = 1, at = 0 } = {}) {
      tone(audio, t0, {
        type: "triangle", from: 520 * pitch, to: 430 * pitch, at, duration: 0.07,
        gain: 0.03 * gain
      });
      tone(audio, t0, {
        type: "triangle", from: 430 * pitch, to: 540 * pitch, at: at + 0.07,
        duration: 0.07, gain: 0.03 * gain
      });
    },
    // Breathy noise wash: ghostly, soft, gaseous.
    airy(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.16 } = {}) {
      noiseBurst(audio, t0, {
        at, duration, gain: 0.03 * gain, filter: "bandpass",
        from: 2600 * pitch, to: 1500
      });
    },
    // Low sawtooth grit: aggressive, beastly.
    growl(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.14 } = {}) {
      tone(audio, t0, {
        type: "sawtooth", from: 130 * pitch, to: 96 * pitch, at, duration,
        gain: 0.045 * gain, filter: "lowpass", filterFrom: 420
      });
    },
    // Inharmonic bell partials: mechanical, mystic.
    chime(audio, t0, { pitch = 1, gain = 1, at = 0, duration = 0.2 } = {}) {
      tone(audio, t0, {
        type: "sine", from: 1240 * pitch, at, duration, gain: 0.03 * gain, attack: 0.006
      });
      tone(audio, t0, {
        type: "sine", from: 1712 * pitch, at, duration: duration * 0.7,
        gain: 0.018 * gain, attack: 0.006
      });
    },
    // Hard onset transient: precise, military.
    bite(audio, t0, { pitch = 1, gain = 1, at = 0 } = {}) {
      noiseBurst(audio, t0, {
        at, duration: 0.018, gain: 0.05 * gain, filter: "highpass", from: 4200
      });
      tone(audio, t0, {
        type: "square", from: 2100 * pitch, at, duration: 0.016, gain: 0.03 * gain
      });
    }
  };

  // Voice families: per event type, which recipe plays. Physical impacts
  // (wall bounce / body collision) intentionally keep one uniform sound for
  // every ball; per-ball identity lives in the attack channels instead.
  const VOICE_FAMILIES = {
    ball: { shoot: "swish", hit: "pop", death: "down" },
    metal: { shoot: "whoosh", hit: "clang", death: "crash" },
    blunt: { shoot: "whoosh", hit: "thud", death: "down" },
    heavy: { shoot: "whoosh", hit: "thud", death: "boom" },
    pool: { shoot: "pool", hit: "pool", death: "down" },
    wood: { shoot: "swish", hit: "wood", death: "wood" },
    paper: { shoot: "swish", hit: "rustle", death: "rustle" },
    blade: { shoot: "swish", hit: "snap", death: "down" },
    bow: { shoot: "twang", hit: "snap", death: "down" },
    gun: { shoot: "gun", hit: "snap", death: "down" },
    cannon: { shoot: "cannon", hit: "boom", death: "boom" },
    explosive: { shoot: "whoosh", hit: "boom", death: "boom" },
    electric: { shoot: "zap", hit: "zap", death: "zap" },
    laser: { shoot: "laser", hit: "laser", death: "down" },
    ice: { shoot: "frost", hit: "icetink", death: "icecrack" },
    water: { shoot: "bubble", hit: "splash", death: "splat" },
    soft: { shoot: "bubble", hit: "squish", death: "splat" },
    poison: { shoot: "fizz", hit: "squish", death: "fizz" },
    rot: { shoot: "fizz", hit: "squish", death: "wilt" },
    plant: { shoot: "rustle", hit: "snap", death: "wilt" },
    silk: { shoot: "rustle", hit: "snap", death: "rustle" },
    snake: { shoot: "snap", hit: "snap", death: "down" },
    beast: { shoot: "snap", hit: "chomp", death: "splat" },
    flesh: { shoot: "punch", hit: "punch", death: "splat" },
    rubber: { shoot: "boing", hit: "boing", death: "down" },
    ghost: { shoot: "ghost", hit: "ghost", death: "ghost" },
    cursed: { shoot: "swish", hit: "snap", death: "ghost" },
    holy: { shoot: "sparkle", hit: "chime", death: "chime" },
    magic: { shoot: "sparkle", hit: "sparkle", death: "ghost" },
    music: { shoot: "note", hit: "note", death: "down" },
    sonic: { shoot: "sonic", hit: "sonic", death: "down" },
    toy: { shoot: "squeak", hit: "pop", death: "squeak" },
    glass: { shoot: "shatter", hit: "shatter", death: "shatter" },
    mech: { shoot: "click", hit: "clang", death: "crash" },
    drill: { shoot: "buzz", hit: "grind", death: "crash" },
    fire: { shoot: "crackle", hit: "boom", death: "boom" },
    glitch: { shoot: "glitch", hit: "glitch", death: "glitch" }
  };
  const DEFAULT_STATUS_RECIPE = "toggle";

  // Control-effect channel: the engine passes the effect id with the status
  // event, so the presentation layer can pick a thematic recipe instead of
  // one generic toggle for every stun, poison, and dance.
  const STATUS_EFFECT_RECIPES = [
    [/dance|disco/, "dancebeat"],
    [/poison|toxic|venom|acid|virus|miasma|spore/, "poisoned"],
    [/burn|fire|flame|scorch|blaze|ignite/, "sear"],
    [/freez|frost|ice|chill|snow|glacier/, "freezefx"],
    [/knock|repel|shove|push|launch|smash/, "knockback"],
    [/void|blind|dark|shadow|curse|fear|hex|nightmare/, "dread"],
    [/stun|shock|zap|static|electric|paraly|discharge|filament/, "stunzap"],
    [/slow|snare|root|web|sticky|suppression|gravity|heavy|tar/, "sludge"],
    [/seal|silence|bind|captur|swallow|disc|tongue|pin|nest|cage/, "sealed"]
  ];

  function statusRecipeFor(effectId) {
    if (typeof effectId !== "string" || effectId.length === 0) return null;
    const id = effectId.toLowerCase();
    for (const [pattern, recipeName] of STATUS_EFFECT_RECIPES) {
      if (pattern.test(id)) return recipeName;
    }
    return null;
  }

  // Hit-severity tiers for the damage accent layers: a solid hit adds a thud
  // accent and a heavy hit adds the full crit accent on top of the family
  // recipe. Damage-over-time hits stay flat so ticking dots never roar.
  const SOLID_HIT_AMOUNT = 10;
  const HEAVY_HIT_AMOUNT = 25;

  // Explicit action cues are shared by mechanics, not selected by character ID.
  // Ordinary damage/projectile events retain their family-specific voices.
  const SOUND_CUES = Object.freeze({
    "wood-build": { recipe: "wood", gain: 0.7 },
    "wood-impact": { recipe: "wood", gain: 0.55 },
    "wood-break": { recipe: "crash", gain: 0.65, priority: true },
    explosion: { recipe: "boom", gain: 0.9, priority: true },
    charge: { recipe: "laser", gain: 0.45 },
    transform: { recipe: "glitch", gain: 0.6, priority: true },
    wind: { recipe: "whoosh", gain: 0.3 },
    beam: { recipe: "laser", gain: 0.7 },
    slash: { recipe: "swish", gain: 1.1 },
    throw: { recipe: "whoosh", gain: 0.65 },
    truck: { recipe: "cannon", gain: 0.6, priority: true },
    land: { recipe: "thud", gain: 0.65 },
    heal: { recipe: "sparkle", gain: 0.6 },
    block: { recipe: "clang", gain: 0.5 }
  });

  // Per-ball voice table: every registered roster ball maps to a family, a
  // personal pitch, and a signature tint. Family + pitch + tint must stay
  // unique per ball so every attack channel sounds distinct; the contract
  // test enforces it.
  const BALL_VOICE_PROFILES = {
    rewind: ["glitch", 0.93, "airy"],
    cloud: ["ghost", 1.16, "airy"],
    disguise: ["glitch", 1.14, "detune"],
    manhole: ["heavy", 0.83, "bite"],
    "meteor-hammer": ["metal", 0.87, "sub"],
    rollingLog: ["wood", 0.78, "growl"],
    "toothless-vampire": ["beast", 1.17, "bite"],
    acid: ["poison", 1.0, "growl"],
    alice: ["holy", 1.05, "chime"],
    anchor: ["metal", 0.8, "sub"],
    angel: ["holy", 1.0, "fifth"],
    apple: ["plant", 1.1, "bite"],
    lemon: ["plant", 1.24, "trill"],
    armor: ["metal", 0.9, "chime"],
    assassin: ["blade", 1.15, "bite"],
    assassinV2: ["blade", 1.37, "bite"],
    whiteAlbum: ["blade", 0.73, "detune"],
    stopBall: ["blade", 0.81, "detune"],
    azusa: ["ice", 1.05, "chime"],
    billiardsV2: ["pool", 0.9, "bite"],
    poolBall: ["pool", 1.0, "trill"],
    billiards: ["pool", 0.95, "octave"],
    blitz: ["electric", 1.2, "fifth"],
    bowV2: ["bow", 1.0, "trill"],
    boxer: ["blunt", 1.15, "bite"],
    briefcase: ["mech", 1.12, "bite"],
    matryoshka: ["wood", 0.9, "sub"],
    sawBall: ["drill", 1.18, "bite"],
    briar: ["plant", 1.0, "growl"],
    quicksand: ["heavy", 0.9, "airy"],
    cable: ["electric", 0.85, "wobble"],
    captainAmerica: ["metal", 1.0, "fifth"],
    chess: ["wood", 1.0, "chime"],
    cornPult: ["plant", 1.15, "trill"],
    hydraulicPress: ["mech", 0.85, "sub"],
    creditor: ["wood", 0.95, "bite"],
    blaster: ["drill", 0.86, "growl"],
    cuttingBall: ["blade", 1.0, "detune"],
    cuttingBallV2: ["laser", 0.9, "bite"],
    david: ["gun", 1.08, "detune"],
    daYunV2: ["heavy", 0.95, "growl"],
    daYunV3: ["heavy", 0.85, "wobble"],
    daYunBoss: ["heavy", 0.72, "sub"],
    blackHole: ["heavy", 0.72, "detune"],
    daYunV4: ["heavy", 0.9, "growl"],
    daYun: ["blunt", 0.9, "sub"],
    disco: ["music", 1.0, "trill"],
    charge: ["electric", 1.28, "sub"],
    leak: ["water", 0.88, "wobble"],
    electricGrid: ["electric", 1.32, "octave"],
    spore: ["plant", 0.82, "airy"],
    spikeV2: ["blade", 1.28, "detune"],
    drill: ["drill", 1.0, "growl"],
    electricPrime: ["electric", 1.0, "chime"],
    electricV2: ["electric", 1.1, "detune"],
    electricV3: ["electric", 0.95, "trill"],
    electricV4: ["electric", 1.15, "octave"],
    electricV5: ["electric", 0.9, "growl"],
    electricV6: ["electric", 1.05, "bite"],
    electricBlueberry: ["electric", 1.22, "bite"],
    electric: ["electric", 1.0, "detune"],
    fiberOptic: ["glass", 1.1, "airy"],
    fishHook: ["water", 1.12, "bite"],
    wirelessFishHook: ["water", 1.13, "bite"],
    fixed: ["mech", 1.0, "chime"],
    fragment: ["glass", 1.05, "chime"],
    frog: ["beast", 1.05, "growl"],
    greyDeer: ["beast", 0.92, "chime"],
    gambler: ["paper", 1.0, "trill"],
    glassV2: ["glass", 0.95, "trill"],
    gojo: ["cursed", 0.8, "fifth"],
    greedySnake: ["snake", 0.9, "growl"],
    softSnake: ["snake", 1.0, "wobble"],
    greenDays: ["rot", 0.8, "growl"],
    green: ["plant", 1.05, "airy"],
    grenade: ["explosive", 1.0, "growl"],
    gunnerA: ["gun", 1.12, "trill"],
    gunnerD: ["gun", 1.22, "airy"],
    gunnerG: ["gun", 1.18, "chime"],
    gunnerH: ["gun", 0.78, "fifth"],
    gunnerK: ["gun", 0.95, "wobble"],
    gunnerX: ["gun", 1.26, "octave"],
    gunnerV2: ["gun", 1.3, "growl"],
    gum: ["soft", 1.1, "wobble"],
    hammerV2: ["blunt", 1.0, "bite"],
    hanako: ["water", 0.95, "airy"],
    roundShield: ["metal", 0.95, "detune"],
    heavyHammer: ["blunt", 0.8, "sub"],
    hermit: ["cursed", 0.9, "chime"],
    hifumi: ["toy", 1.1, "trill"],
    hikari: ["heavy", 1.1, "chime"],
    hina: ["gun", 1.05, "bite"],
    hoshino: ["gun", 0.85, "sub"],
    hoshinoTerror: ["laser", 0.76, "growl"],
    internationalChess: ["wood", 1.05, "trill"],
    daYunV5: ["metal", 0.92, "chime"],
    iroha: ["cannon", 0.9, "sub"],
    izumi: ["beast", 1.0, "trill"],
    sukuna: ["cursed", 0.75, "growl"],
    sukunaBoss: ["cursed", 0.68, "sub"],
    izuna: ["blade", 1.1, "trill"],
    julie: ["rot", 1.0, "wobble"],
    kashimo: ["electric", 1.38, "octave"],
    kingCrimson: ["cursed", 0.72, "octave"],
    spiderMan: ["silk", 0.92, "octave"],
    kayoko: ["ghost", 0.9, "airy"],
    kuroko: ["gun", 1.0, "detune"],
    kurokoBoss: ["gun", 0.9, "growl"],
    yiWanRen: ["flesh", 1.0, "growl"],
    baiWanRen: ["flesh", 0.92, "sub"],
    laserV2: ["laser", 1.0, "detune"],
    laserV3: ["laser", 1.05, "trill"],
    liaogang: ["rot", 0.85, "sub"],
    light: ["heavy", 1.0, "octave"],
    liquidNitrogen: ["ice", 0.98, "sub"],
    loom: ["silk", 0.9, "wobble"],
    maLiang: ["paper", 1.05, "airy"],
    mary: ["holy", 1.1, "octave"],
    medicalBall: ["holy", 1.15, "trill"],
    mj: ["flesh", 1.13, "detune"],
    mika: ["flesh", 1.05, "sub"],
    militaryGrenade: ["explosive", 0.95, "sub"],
    momoi: ["toy", 1.2, "octave"],
    mutsuki: ["explosive", 1.05, "bite"],
    ocean: ["water", 0.9, "sub"],
    orbital: ["mech", 1.0, "detune"],
    order: ["holy", 0.9, "sub"],
    parallel: ["glass", 1.0, "detune"],
    planetaryWave: ["explosive", 0.85, "fifth"],
    guzheng: ["music", 1.05, "chime"],
    qin: ["music", 0.95, "detune"],
    accordion: ["music", 0.88, "wobble"],
    fractal: ["laser", 1.08, "airy"],
    ramStick: ["mech", 1.05, "bite"],
    redBlood: ["flesh", 0.9, "wobble"],
    orb: ["laser", 1.0, "chime"],
    revolver: ["gun", 0.92, "fifth"],
    roamingRevolver: ["gun", 1.34, "fifth"],
    rion: ["ball", 1.0, "chime"],
    baiBianXingJun: ["ball", 1.17, "chime"],
    swap: ["glitch", 0.95, "detune"],
    copy: ["ball", 0.9, "sub"],
    rubberBand: ["rubber", 1.0, "wobble"],
    sawV2: ["drill", 1.05, "bite"],
    scan: ["laser", 1.15, "chime"],
    wdc: ["mech", 0.95, "sub"],
    wdcV2: ["mech", 1.15, "octave"],
    spiderweb: ["silk", 1.0, "airy"],
    sixKing: ["heavy", 0.8, "fifth"],
    sixKingE: ["heavy", 0.86, "detune"],
    sixZone: ["electric", 0.9, "airy"],
    sixZoneUltra: ["electric", 0.98, "fifth"],
    slime: ["soft", 1.15, "trill"],
    snake: ["snake", 0.95, "trill"],
    snowman: ["ice", 0.9, "airy"],
    snowball: ["ice", 1.12, "chime"],
    soccerBall: ["blunt", 1.0, "trill"],
    badminton: ["wood", 1.21, "airy"],
    // 场上羽毛球是召唤物（不进花名册），单独给一个更细更高的木声。
    badmintonShuttle: ["wood", 1.44, "airy"],
    soundWave: ["sonic", 1.0, "wobble"],
    soundSpear: ["sonic", 1.12, "trill"],
    flame: ["fire", 1.2, "trill"],
    cocktail: ["fire", 1.12, "growl"],
    sparkler: ["fire", 1.1, "airy"],
    splitBallV2: ["soft", 1.12, "growl"],
    lantern: ["fire", 0.92, "chime"],
    spear: ["blade", 0.9, "sub"],
    giantYokan: ["heavy", 1.08, "chime"],
    cucumber: ["plant", 1.12, "trill"],
    steelCoil: ["metal", 0.86, "sub"],
    steelworks: ["metal", 0.92, "sub"],
    whackAMole: ["wood", 0.88, "growl"],
    sawV3: ["drill", 0.92, "growl"],
    meatGrinder: ["metal", 0.84, "growl"],
    spiderGrenade: ["explosive", 1.1, "trill"],
    spider: ["silk", 1.05, "trill"],
    spike: ["metal", 1.05, "bite"],
    splitBall: ["soft", 1.0, "octave"],
    starfield: ["magic", 1.0, "detune"],
    stars: ["magic", 1.17, "detune"],
    trident: ["metal", 1.13, "airy"],
    gratefulDead: ["metal", 0.73, "airy"],
    pond: ["metal", 0.81, "airy"],
    mahito: ["metal", 0.67, "airy"],
    stoneSkipping: ["water", 1.05, "trill"],
    throwingAxe: ["blade", 0.85, "growl"],
    daredevil: ["metal", 1.09, "bite"],
    tigerTalisman: ["magic", 0.95, "growl"],
    tornado: ["sonic", 0.95, "airy"],
    trapper: ["mech", 1.0, "wobble"],
    trapperV2: ["mech", 0.92, "fifth"],
    tsurugi: ["blade", 1.05, "fifth"],
    vampire: ["cursed", 0.84, "bite"],
    oasis: ["blade", 1.05, "detune"],
    twins: ["glass", 1.0, "wobble"],
    vcd: ["glitch", 1.0, "wobble"],
    videotape: ["glitch", 0.9, "airy"],
    virus: ["rot", 1.1, "airy"],
    whiteSnake: ["cursed", 1.0, "detune"],
    cMoon: ["cursed", 0.88, "wobble"],
    yona: ["gun", 0.8, "octave"],
    yondu: ["bow", 1.1, "octave"],
    yuuka: ["gun", 1.1, "trill"],
    oldModel: ["metal", 0.83, "detune"],
    yuzu: ["explosive", 1.05, "wobble"],
    zeusV2: ["electric", 0.85, "fifth"],
    glacier: ["ice", 0.86, "trill"],
    blizzard: ["ice", 1.2, "wobble"],
    windmill: ["toy", 1.3, "wobble"],
    clock: ["metal", 0.94, "chime"],
    embroideryNeedle: ["blade", 1.28, "airy"],
    aoiTodo: ["cursed", 0.93, "bite"],
    akira: ["gun", 1.16, "chime"],
    sentinel: ["mech", 0.71, "growl"],
    caterpillar: ["rot", 1.17, "airy"],
    zaoPepper: ["glass", 0.91, "bite"],
    pollen: ["plant", 1.18, "airy"],
    jelly: ["soft", 1.23, "wobble"],
    lavaBall: ["flesh", 0.76, "growl"],
    magma: ["flesh", 0.77, "growl"],
    volcano: ["fire", 0.72, "sub"],
    projection: ["soft", 0.73, "trill"],
    tomato: ["soft", 1.29, "wobble"],
    module: ["soft", 0.69, "octave"],
    choso: ["flesh", 0.84, "bite"],
    mizushi: ["cursed", 0.7, "wobble"],
    fishPond: ["water", 0.94, "airy"],
    trainConductor: ["metal", 0.9, "fifth"],
    trainConductorV2: ["mech", 0.88, "wobble"],
    thanos: ["heavy", 0.68, "bite"],
    thor: ["electric", 0.73, "sub"],
    hammerCaptain: ["electric", 1.07, "bite"],
    liuFuQi: ["toy", 1.13, "wobble"],
    lightYagami: ["cursed", 0.67, "chime"],
    madeInHeaven: ["metal", 1.73, "chime"],
    mk85: ["laser", 0.82, "chime"],
    vision: ["laser", 1.07, "chime"],
    urchin: ["water", 1.06, "bite"],
    mooncake: ["wood", 0.96, "fifth"],
    skyLantern: ["fire", 0.86, "airy"],
    liangchenI: ["flesh", 0.82, "detune"],
    liangchenII: ["flesh", 0.78, "growl"],
    liangchenIII: ["flesh", 0.74, "bite"],
    liangchenIV: ["flesh", 0.70, "wobble"],
    liangchenVE: ["flesh", 0.66, "sub"],
    rock: ["heavy", 1.15, "growl"],
    liangchenLite: ["flesh", 0.62, "sub"],
    youRen: ["blade", 1.17, "airy"],
    cactus: ["plant", 0.88, "growl"],
    cactusV2: ["plant", 0.94, "fifth"],
    hiveV2: ["toy", 0.94, "trill"],
    oldWoodMaster: ["wood", 0.93, "octave"],
    magnet: ["metal", 1.14, "detune"],
    king: ["holy", 0.82, "octave"],
    kingGuard: ["wood", 1.18, "bite"],
    peeler: ["metal", 1.17, "bite"],
    scarecrow: ["plant", 0.83, "wobble"],
    onion: ["plant", 1.07, "wobble"],
    miwa: ["blade", 1.09, "detune"],
    snowflake: ["ice", 1.18, "trill"],
    snowFight: ["ice", 0.79, "wobble"],
    thumbtack: ["metal", 1.02, "chime"]
  };

  class BattleAudio {
    constructor({
      AudioConstructor = globalThis.AudioContext || globalThis.webkitAudioContext,
      voiceLimit = 48,
      offlineContext = null,
      getTime = null
    } = {}) {
      this.AudioConstructor = AudioConstructor;
      this.audioContext = offlineContext;
      this.offlineContext = offlineContext;
      if (getTime !== null && typeof getTime !== "function") throw new TypeError("getTime must be a function");
      if (offlineContext && !getTime) throw new TypeError("Offline audio requires a presentation clock");
      this.getTime = getTime;
      this.captureDestination = null;
      this.master = null;
      this.noiseBuffer = null;
      if (!Number.isInteger(voiceLimit) || voiceLimit < 1) {
        throw new TypeError("voiceLimit must be a positive integer");
      }
      this.voiceLimit = voiceLimit;
      this.activeVoices = [];
      this.currentVoice = null;
      this.channelBursts = new Map();
      this.lastSoundAt = new Map();
      this.resumePromise = null;
      this.pendingSounds = new Map();
      this.diagnostics = { played: 0, throttled: 0, voiceLimited: 0, unsupported: 0, failed: 0 };
    }

    ensureContext() {
      if (!this.audioContext) {
        if (!this.AudioConstructor) return null;
        this.audioContext = new this.AudioConstructor();
      }
      if (!this.master) {
        const ctx = this.audioContext;
        const master = ctx.createGain();
        master.gain.value = 1;
        let tail = master;
        if (typeof ctx.createDynamicsCompressor === "function") {
          try {
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = -18;
            compressor.knee.value = 24;
            compressor.ratio.value = 6;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            master.connect(compressor);
            tail = compressor;
          } catch (_error) {
            // Fall back to uncompressed output.
          }
        }
        if (typeof ctx.createMediaStreamDestination === "function") {
          this.captureDestination = ctx.createMediaStreamDestination();
          tail.connect(ctx.destination);
          tail.connect(this.captureDestination);
        } else {
          tail.connect(ctx.destination);
        }
        this.master = master;
      }
      if (!this.noiseBuffer && typeof this.audioContext.createBuffer === "function") {
        try {
          const length = Math.max(1, Math.floor(this.audioContext.sampleRate * 0.5));
          const buffer = this.audioContext.createBuffer(1, length, this.audioContext.sampleRate);
          const data = buffer.getChannelData(0);
          // Never consume the simulation's temporarily scoped Math.random.
          let seed = 0x6d2b79f5;
          for (let index = 0; index < data.length; index += 1) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            data[index] = (seed >>> 0) / 0x100000000 * 2 - 1;
          }
          this.noiseBuffer = buffer;
        } catch (_error) {
          this.noiseBuffer = null;
        }
      }
      return this.audioContext;
    }

    getCaptureStream() {
      this.ensureContext();
      return this.captureDestination ? this.captureDestination.stream : null;
    }

    voiceProfileFor(subject) {
      const id = subject && typeof subject === "object"
        ? subject.id
        : (typeof subject === "string" ? subject : null);
      const profile = id ? BALL_VOICE_PROFILES[id] : null;
      if (!profile) return { ...NEUTRAL };
      const [family, pitch, tint] = profile;
      return {
        family: VOICE_FAMILIES[family] ? family : NEUTRAL.family,
        pitch: Number.isFinite(pitch) && pitch > 0 ? pitch : NEUTRAL.pitch,
        tint: VOICE_TINTS[tint] ? tint : null
      };
    }

    // Throttle helper: returns false when any key fired too recently,
    // otherwise records now for every key. Keeps Map bounded.
    currentTime() {
      return this.getTime ? this.getTime() : (this.audioContext ? this.audioContext.currentTime : 0);
    }

    reserveThrottle(keys) {
      const now = this.currentTime();
      for (const { key, interval } of keys) {
        // Allow simultaneous actors; still cap a dense channel-wide burst.
        if (key.startsWith("g:")) {
          const burst = this.channelBursts.get(key);
          if (burst && now - burst.time < interval && burst.count >= 6) {
            this.diagnostics.throttled += 1;
            return false;
          }
          continue;
        }
        const last = this.lastSoundAt.get(key);
        if (last !== undefined && now - last < interval) {
          this.diagnostics.throttled += 1;
          return false;
        }
      }
      for (const { key, interval } of keys) {
        if (key.startsWith("g:")) {
          const burst = this.channelBursts.get(key);
          this.channelBursts.set(key, burst && now - burst.time < interval
            ? { time: burst.time, count: burst.count + 1 } : { time: now, count: 1 });
          continue;
        }
        this.lastSoundAt.delete(key);
        this.lastSoundAt.set(key, now);
      }
      while (this.lastSoundAt.size > 512) {
        this.lastSoundAt.delete(this.lastSoundAt.keys().next().value);
      }
      return true;
    }

    trackSource(source, nodes, end) {
      if (this.currentVoice) this.currentVoice.end = Math.max(this.currentVoice.end, end);
      source.onended = () => {
        for (const node of nodes) {
          try { if (typeof node.disconnect === "function") node.disconnect(); }
          catch (_error) { /* Continue cleaning the remaining nodes. */ }
        }
        source.onended = null;
      };
    }

    renderVoice(callback, important = false) {
      const now = this.currentTime();
      this.activeVoices = this.activeVoices.filter(voice => voice.end > now);
      const reserved = Math.min(4, Math.floor(this.voiceLimit / 4));
      const limit = important ? this.voiceLimit : this.voiceLimit - reserved;
      if (this.activeVoices.length >= limit) {
        this.diagnostics.voiceLimited += 1;
        return;
      }
      const voice = { end: now };
      this.activeVoices.push(voice);
      this.currentVoice = voice;
      try {
        callback();
        this.diagnostics.played += 1;
      } catch (_error) {
        this.diagnostics.failed += 1;
      } finally {
        this.currentVoice = null;
      }
    }

    getDiagnostics() {
      return { ...this.diagnostics, pending: this.pendingSounds.size,
        active: this.activeVoices.filter(voice => voice.end > this.currentTime()).length };
    }

    scheduleRecipe(recipeName, { pitch = 1, gain = 1 } = {}) {
      const recipe = RECIPES[recipeName];
      if (!recipe) return;
      recipe(this, this.currentTime(), { pitch, gain });
    }

    activate(activateCallback, key = "event", important = false) {
      const audioContext = this.audioContext;
      if (!this.offlineContext && audioContext.state === "suspended") {
        // One resume request and a bounded, coalesced queue, not one promise
        // per projectile while the device is suspended.
        this.pendingSounds.delete(key);
        this.pendingSounds.set(key, { activateCallback, important });
        while (this.pendingSounds.size > 32) {
          this.pendingSounds.delete(this.pendingSounds.keys().next().value);
        }
        if (!this.resumePromise) {
          this.resumePromise = audioContext.resume().then(() => {
            const pending = Array.from(this.pendingSounds.values());
            this.pendingSounds.clear();
            for (const sound of pending) this.renderVoice(sound.activateCallback, sound.important);
          }).catch(() => {
            this.diagnostics.failed += 1;
            this.pendingSounds.clear();
          }).finally(() => { this.resumePromise = null; });
        }
      } else {
        this.renderVoice(activateCallback, important);
      }
    }

    // Physical impact channel (wall bounce, body collisions, service calls).
    // One uniform classic bounce blip for every ball; per-ball voice identity
    // lives in the attack channels (shoot/hit/death) instead.
    impact(ball, intensity = 1) {
      try {
        const audioContext = this.ensureContext();
        if (!audioContext) return;
        // Combat entities have no ball.speed; fall back to the base pitch.
        const speed = ball && Number.isFinite(ball.speed) ? ball.speed : 150;
        const pitch = clamp(speed / 150, 0.8, 1.2);
        if (!this.reserveThrottle([
          { key: "g:bounce", interval: 0.025 },
          { key: `bounce:${subjectKeyOf(ball)}`, interval: 0.04 }
        ])) return;

        this.activate(() => {
          this.scheduleRecipe("blip", { pitch, gain: clamp(intensity, 0.2, 1.5) });
        }, `impact:${subjectKeyOf(ball)}`);
      } catch (_error) {
        this.diagnostics.failed += 1;
        // Browser audio setup can fail independently of game simulation.
      }
    }

    // Event channel for engine-emitted battle sounds.
    // event: { type: "shoot"|"hit"|"death"|"status"|"summon"|"warning"|"ability"|"start"|"win",
    //          subject, target, amount, kind, speed, effect }
    // The engine names the acting ball `subject`; `ball` stays accepted as an
    // alias for older direct callers.
    playEvent(event) {
      try {
        if (!event || typeof event !== "object") return;
        const audioContext = this.ensureContext();
        if (!audioContext) return;
        if (event.type === "start") {
          this.activate(() => {
            this.scheduleRecipe("drumstart", { pitch: 1, gain: 1 });
          }, "start", true);
          return;
        }
        if (event.type === "win") {
          this.activate(() => {
            this.scheduleRecipe("fanfare", { pitch: 1, gain: 1 });
          }, "win", true);
          return;
        }

        const subject = event.subject || event.ball;
        const profile = this.voiceProfileFor(subject);
        const family = VOICE_FAMILIES[profile.family] || VOICE_FAMILIES.ball;
        const subjectKey = subjectKeyOf(subject);
        let recipeName = null;
        let gain = 1;
        let pitch = profile.pitch;
        let tintName = profile.tint;
        let throttleKeys = null;
        let important = event.type === "death" && !(subject && subject.isSummon);

        if (event.type === "ability") {
          const cue = SOUND_CUES[event.cue];
          if (!cue) { this.diagnostics.unsupported += 1; return; }
          recipeName = cue.recipe;
          gain = cue.gain;
          important = cue.priority === true;
          tintName = null;
          throttleKeys = [
            { key: important ? "g:important-ability" : "g:ability", interval: 0.035 },
            { key: `ability:${subjectKey}:${event.cue}`, interval: 0.07 }
          ];
        } else if (event.type === "summon") {
          recipeName = "summonpop";
          gain = 0.8;
          tintName = null;
          throttleKeys = [{ key: "g:summon", interval: 0.07 }];
        } else if (event.type === "shoot") {
          recipeName = family.shoot;
          gain = 0.9;
          // Faster projectiles read as brighter attack sounds.
          const speed = Number(event.speed);
          if (Number.isFinite(speed) && speed > 0) {
            pitch = profile.pitch * clamp((speed / 260) ** 0.35, 0.85, 1.25);
          }
          throttleKeys = [
            { key: "g:shoot", interval: 0.035 },
            { key: `shoot:${subjectKey}`, interval: 0.07 }
          ];
        } else if (event.type === "hit") {
          recipeName = family.hit;
          const amount = Number(event.amount);
          gain = Number.isFinite(amount) && amount > 0
            ? clamp(0.55 + Math.sqrt(amount) / 8, 0.55, 1.15)
            : 0.8;
          // Ticking damage-over-time stays quieter than strike damage.
          if (event.kind === "dot") gain *= 0.7;
          throttleKeys = [
            { key: "g:hit", interval: 0.03 },
            { key: `hit:${subjectKey}`, interval: 0.055 }
          ];
        } else if (event.type === "death") {
          if (subject && subject.isSummon) {
            // Summons bow out with a small reversed pop instead of the full
            // family death cry, keeping horde deaths out of the way.
            recipeName = "summonpop";
            gain = 0.5;
            pitch = profile.pitch * 0.8;
            tintName = null;
          } else {
            recipeName = family.death;
            gain = 1;
          }
          throttleKeys = [
            { key: "g:death", interval: 0.09 },
            { key: `death:${subjectKey}`, interval: 0.2 }
          ];
        } else if (event.type === "status") {
          recipeName = statusRecipeFor(event.effect) ||
            family.status || DEFAULT_STATUS_RECIPE;
          gain = 0.7;
          tintName = null;
          throttleKeys = [
            { key: "g:status", interval: 0.12 },
            { key: `status:${subjectKey}:${event.effect || "generic"}`, interval: 0.25 }
          ];
        } else if (event.type === "warning") {
          recipeName = "blip";
          gain = 0.55;
          pitch = profile.pitch * clamp(Number(event.pitch) || 1, 0.75, 1.5);
          tintName = null;
          throttleKeys = [
            { key: "g:warning", interval: 0.08 },
            { key: `warning:${subjectKey}`, interval: 0.12 }
          ];
        }
        if (!recipeName || !RECIPES[recipeName]) { this.diagnostics.unsupported += 1; return; }
        // `volume` is a legacy alias. Zero really means silent.
        const intensity = event.intensity == null ? (event.volume == null ? 1 : event.volume) : event.intensity;
        if (!Number.isFinite(intensity) || intensity < 0) {
          this.diagnostics.unsupported += 1;
          return;
        }
        if (intensity === 0) return;
        gain *= clamp(intensity, 0, 2);
        if (!this.reserveThrottle(throttleKeys)) return;

        this.activate(() => {
          const t0 = this.currentTime();
          RECIPES[recipeName](this, t0, { pitch, gain });
          const tint = tintName ? VOICE_TINTS[tintName] : null;
          if (tint) {
            tint(this, t0, event.type === "death"
              ? { pitch, gain: gain * 1.1, duration: 0.2 }
              : { pitch, gain });
          }
          if (event.type === "hit") {
            const amount = Number(event.amount);
            if (Number.isFinite(amount) && amount > 0 && event.kind !== "dot") {
              if (amount >= HEAVY_HIT_AMOUNT) {
                RECIPES.crit(this, t0, {
                  pitch, gain: clamp(amount / 45, 0.6, 1.2) * clamp(intensity, 0, 2)
                });
              } else if (amount >= SOLID_HIT_AMOUNT) {
                RECIPES.thud(this, t0, { pitch, gain: 0.55 * clamp(intensity, 0, 2) });
              }
            }
          }
          if (event.type === "death" && subject && subject.isBoss) {
            RECIPES.bossfall(this, t0, { pitch: profile.pitch, gain: clamp(intensity, 0, 2) });
          }
        }, `${event.type}:${subjectKey}:${event.cue || ""}`, important);
      } catch (_error) {
        this.diagnostics.failed += 1;
        // Browser audio setup can fail independently of game simulation.
      }
    }
  }

  // Battle start / victory jingles.
  RECIPES.drumstart = function drumstart(audio, t0) {
    RECIPES.thud(audio, t0, { pitch: 1, gain: 1 });
    RECIPES.thud(audio, t0 + 0.14, { pitch: 0.85, gain: 1 });
    RECIPES.thud(audio, t0 + 0.28, { pitch: 1.1, gain: 0.9 });
    noiseBurst(audio, t0, {
      duration: 0.3, gain: 0.06, filter: "bandpass", from: 400, to: 1600
    });
    tone(audio, t0, {
      type: "triangle", from: 330, to: 660, at: 0.3, duration: 0.22,
      gain: 0.06, attack: 0.02
    });
  };

  RECIPES.fanfare = function fanfare(audio, t0) {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      tone(audio, t0, {
        type: "triangle", from: frequency, at: index * 0.12, duration: 0.38,
        gain: 0.07, attack: 0.01
      });
    });
    RECIPES.sparkle(audio, t0 + 0.24, { pitch: 1, gain: 0.8 });
    tone(audio, t0 + 0.36, {
      type: "sine", from: 130.81, to: 65.41, duration: 0.5, gain: 0.1, attack: 0.008
    });
    noiseBurst(audio, t0 + 0.36, {
      duration: 0.4, gain: 0.05, from: 1000, to: 200
    });
  };

  return {
    BounceAudio,
    BattleAudio,
    RECIPES,
    VOICE_FAMILIES,
    VOICE_TINTS,
    BALL_VOICE_PROFILES,
    SOUND_CUES,
    statusRecipeFor
  };
});
