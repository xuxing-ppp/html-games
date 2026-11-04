import { SETTINGS, saveSettings } from './config.js';
const SND = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  eng: null, musicTimer: null, muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.applyVolumes();
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.ctx.createGain(); g.gain.value = 0;
    const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = this.ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 61;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxGain); o1.start(); o2.start();
    this.eng = { o1, o2, g, f };
    this.startMusic();
  },
  applyVolumes() {
    const m = SETTINGS.muted ? 0 : SETTINGS.master;
    if (this.master) this.master.gain.value = m;
    if (this.musicGain) this.musicGain.gain.value = SETTINGS.music;
    if (this.sfxGain) this.sfxGain.gain.value = SETTINGS.sfx;
  },
  engine(speed01, on) {
    if (!this.eng || this.muted) return;
    const base = 52 + speed01 * 210, t = this.ctx.currentTime;
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.06);
    this.eng.o2.frequency.setTargetAtTime(base * 1.01, t, 0.06);
    this.eng.g.gain.setTargetAtTime(on ? 0.10 : 0.0, t, 0.1);
    this.eng.f.frequency.setTargetAtTime(450 + speed01 * 1700, t, 0.06);
  },
  tone(freq, dur, { type = 'square', vol = 0.3, slideTo = null, when = 0, music = false } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(music ? this.musicGain : this.sfxGain); o.start(t); o.stop(t + dur + 0.03);
  },
  noise(dur, { vol = 0.3, when = 0, type = 'lowpass', freq = 1000 } = {}) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const buf = this.ctx.createBuffer(1, Math.max(1, this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain); src.start(t); src.stop(t + dur);
  },
  pickup() { this.tone(660, 0.08, { vol: 0.22 }); this.tone(990, 0.12, { vol: 0.22, when: 0.08 }); },
  boost() { this.noise(0.4, { vol: 0.3, freq: 1100, type: 'bandpass' }); this.tone(220, 0.4, { type: 'sawtooth', vol: 0.18, slideTo: 660 }); },
  shell() { this.tone(820, 0.18, { type: 'square', vol: 0.22, slideTo: 300 }); },
  banana() { this.tone(300, 0.1, { vol: 0.18 }); },
  stun() { this.noise(0.3, { vol: 0.35, freq: 380, type: 'lowpass' }); this.tone(150, 0.3, { vol: 0.22, slideTo: 70 }); },
  bump() { this.noise(0.1, { vol: 0.2, freq: 500 }); },
  beep(high) { this.tone(high ? 1320 : 523, 0.16, { vol: 0.3, type: 'square' }); },
  pad() { this.tone(880, 0.12, { vol: 0.18, slideTo: 1320, type: 'sawtooth' }); },
  go() { this.tone(1046, 0.18, { vol: 0.3 }); this.tone(1568, 0.4, { vol: 0.3, when: 0.05 }); },
  startMusic() {
    const tempo = 165;            // ms per step
    const bass = [110, 110, 146, 146, 164, 164, 146, 98];
    const lead = [440, 0, 523, 0, 587, 523, 440, 392, 440, 0, 523, 0, 659, 587, 523, 0];
    let step = 0;
    const sched = () => {
      if (!this.ctx) return;
      this.tone(bass[step % bass.length], 0.15, { type: 'triangle', vol: 0.12, music: true });
      const n = lead[step % lead.length];
      if (n) this.tone(n, 0.12, { type: 'square', vol: 0.06, music: true });
      if (step % 4 === 0) this.tone(220, 0.06, { type: 'sine', vol: 0.1, music: true }); // kick
      step++;
    };
    this.musicTimer = setInterval(sched, tempo);
  },
  toggleMute() {
    this.muted = SETTINGS.muted = !SETTINGS.muted;
    saveSettings();
    this.applyVolumes();
    if (this.eng) this.eng.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }
};


export { SND };
