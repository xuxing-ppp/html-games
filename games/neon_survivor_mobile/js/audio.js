// audio.js — SV.Audio: WebAudio 合成音效(首次手势解锁,每类节流防糊) + BGM 无缝循环
// (主路径 WebAudio BufferSource 采样级 loop;回退 HTMLAudio el.loop)
(function () {
  "use strict";
  const SV = window.SV;

  let ctx = null, master = null, sfxGain = null, muted = false, unlocked = false, musicVol = 1.0, sfxVol = 1.0;
  const MASTER_CAP = 1.0;      // SFX 总线上限(音效经此输出;BGM 走独立 musicGain 不经过)
  const SFX_SCALE = 1.0;      // SFX 总线增益(击杀音以外的音效整体提高 ~35%;击杀音已单独降 vol 抵消)
  const MUSIC_SCALE = 0.2;    // BGM 全局缩放(音乐最大音量 = musicVol 滑杆满格 × 此值;原 0.11,实测校准到 0.30)

  function ensure() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_CAP; // 总上限 + 静音目标(0 时全静)
      master.connect(ctx.destination);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = sfxVol * SFX_SCALE;    // 音效音量(0..1滑杆语义不变;总线乘 SFX_SCALE)
      sfxGain.connect(master);
    } catch (e) { ctx = null; }
  }
  function resume() {
    ensure();
    // iOS 切后台回来 state 可能是 "interrupted",一律恢复到 running
    if (ctx && ctx.state !== "running") ctx.resume();
    unlocked = true;
  }

  // 基础原语:一个带包络的振荡器
  function tone(freq, dur, opts) {
    if (!ctx || muted) return;
    opts = opts || {};
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slideTo), t0 + dur);
    if (opts.schedule) for (let i = 0; i < opts.schedule.length; i++) { const p = opts.schedule[i]; osc.frequency.setValueAtTime(p[1], t0 + p[0]); }
    const peak = opts.vol == null ? 0.25 : opts.vol;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  // 白噪声(爆炸/命中)
  function noise(dur, opts) {
    if (!ctx || muted) return;
    opts = opts || {};
    const t0 = ctx.currentTime;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = opts.filter || "bandpass"; filt.frequency.value = opts.freq || 800; filt.Q.value = opts.q || 0.8;
    const g = ctx.createGain(); g.gain.value = opts.vol == null ? 0.2 : opts.vol;
    src.connect(filt); filt.connect(g); g.connect(sfxGain);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  // 节流:同一音效在间隔内只响一次
  const _last = {};
  function throttled(key, ms) {
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (_last[key] && now - _last[key] < ms) return false;
    _last[key] = now; return true;
  }

  // ── BGM:audio/ 目录的无缝循环曲(主界面 + 四地图各一首, MP3 单格式)。
  // 主路径 WebAudio:fetch → decodeAudioData → BufferSource(loop=true) 采样级无缝。
  //   - 解码后扫描头尾亚阈值样本(-60dB)夹出循环体(loopStart/loopEnd), 兼容不同
  //     浏览器对 LAME gapless 头的处理差异与 decode 重采样。
  //   - 主界面约 3 分钟、地图约 8–9 分钟，最长单曲解码约 200MB；buffer 仅
  //     缓存当前曲，避免移动端同时驻留两首造成额外内存压力。
  // 回退 HTMLAudio:file:// 下 fetch 被 CORS 拦(或无 fetch/解码失败)时走
  //   el.loop=true;新编码带 LAME gapless 头, Chrome/FF 自动裁编码器延迟, 缝隙最小。
  // 音乐走独立 musicGain 直连 destination(不进 SFX 的 MASTER_CAP), 音量语义
  //   musicVol*MUSIC_SCALE 与旧 el.volume 完全一致。
  const BGM_FILES = {
    menu: "audio/menu_loop.mp3",
    ruins: "audio/ruins_loop.mp3",
    crimson: "audio/crimson_loop.mp3",
    frozen: "audio/frozen_loop.mp3",
    void: "audio/void_loop.mp3"
  };
  const BGM_TRIM_THRESHOLD = 0.001;   // -60dB:低于此视为编码器延迟静音
  const BGM_TRIM_MAX = 0.25;          // 单侧最多裁 0.25s(防异常文件被裁穿)

  let musicGain = null;
  let curBgm = null;
  let bgmMode = "none";               // "webaudio" | "html" | "none"(解析后定格)
  const _bgmBufs = {};                // id -> AudioBuffer(LRU 仅留当前曲)
  const _bgmOrder = [];               // LRU 序
  let _bgmSrc = null;                 // 当前 BufferSource
  let _bgmToken = 0;                  // 防陈旧 onended 误清状态
  const _bgmDead = {};                // id -> fetch/decode 失败标记(改走 HTMLAudio)
  const _tracks = {};                 // id -> HTMLAudioElement(回退路径, 懒建)

  function applyMusicGain() {
    if (musicGain) musicGain.gain.value = muted ? 0 : musicVol * MUSIC_SCALE;
  }
  function applyTrack(el) {
    if (!el) return;
    el.volume = musicVol * MUSIC_SCALE;
    el.muted = muted;
  }

  // ── WebAudio 主路径 ──────────────────────────────────────────────
  function waAvailable() {
    if (typeof fetch !== "function") return false;
    ensure();
    if (ctx && !musicGain) {
      try {
        musicGain = ctx.createGain();
        musicGain.connect(ctx.destination);   // BGM 不经 master(SFX 专用总线)
        applyMusicGain();
      } catch (e) { musicGain = null; }
    }
    return !!ctx;
  }
  function decodeBuf(ab) {
    return new Promise(function (res, rej) {
      let settled = false;
      function ok(b) { if (!settled) { settled = true; res(b); } }
      function bad(e) { if (!settled) { settled = true; rej(e || new Error("decode")); } }
      try {
        const p = ctx.decodeAudioData(ab, ok, bad);
        if (p && typeof p.then === "function") p.then(ok, bad);
      } catch (e) { bad(e); }
    });
  }
  // 扫描头尾亚阈值样本, 返回 [loopStart, loopEnd] 采样索引(不改动 buffer 本体)
  function scanLoop(buf) {
    const n = buf.length, sr = buf.sampleRate;
    const cap = Math.min(n, Math.floor(sr * BGM_TRIM_MAX));
    const L = buf.getChannelData(0);
    const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let s = 0;
    while (s < cap && (L[s] < BGM_TRIM_THRESHOLD && L[s] > -BGM_TRIM_THRESHOLD) &&
           (R[s] < BGM_TRIM_THRESHOLD && R[s] > -BGM_TRIM_THRESHOLD)) s++;
    if (s >= cap) s = 0;   // 头部全静音超过上限 → 放弃裁剪(异常保护)
    let e = n - 1;
    while (e > n - cap && (L[e] < BGM_TRIM_THRESHOLD && L[e] > -BGM_TRIM_THRESHOLD) &&
           (R[e] < BGM_TRIM_THRESHOLD && R[e] > -BGM_TRIM_THRESHOLD)) e--;
    if (e <= n - cap) e = n - 1;
    return [s, e + 1];
  }
  function cacheBuf(id, buf) {
    _bgmBufs[id] = buf;
    const i = _bgmOrder.indexOf(id);
    if (i >= 0) _bgmOrder.splice(i, 1);
    _bgmOrder.push(id);
    while (_bgmOrder.length > 1) {   // 加长曲较大，只留当前曲
      const old = _bgmOrder.shift();
      if (old !== id) delete _bgmBufs[old];
    }
  }
  function stopSource() {
    _bgmToken++;
    const src = _bgmSrc;
    _bgmSrc = null;
    if (src) {
      try { src.onended = null; src.stop(); } catch (e) {}
      try { src.disconnect(); } catch (e2) {}
    }
  }
  function playBuf(id, buf) {
    stopSource();
    if (!buf) return;
    try {
      const src = ctx.createBufferSource();
      const range = scanLoop(buf);
      src.buffer = buf;
      src.loop = true;
      src.loopStart = range[0] / buf.sampleRate;
      src.loopEnd = range[1] / buf.sampleRate;
      src.connect(musicGain || ctx.destination);
      const token = _bgmToken;
      src.onended = function () {
        if (token === _bgmToken) { _bgmSrc = null; }
      };
      src.start(0, src.loopStart);
      _bgmSrc = src;
      bgmMode = "webaudio";
    } catch (e) { _bgmSrc = null; }
  }
  function waLoad(id) {
    if (_bgmBufs[id]) return Promise.resolve(_bgmBufs[id]);
    if (_bgmDead[id]) return Promise.resolve(null);
    return fetch(BGM_FILES[id], { cache: "force-cache" })
      .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); })
      .then(decodeBuf)
      .then(function (buf) { cacheBuf(id, buf); return buf; })
      .catch(function () { _bgmDead[id] = true; return null; });
  }
  function waStart(id) {
    // 已有 buffer 直接播; 否则解码后仍处同一曲再播(期间 stopBgm/切曲则弃播)
    if (_bgmBufs[id]) { playBuf(id, _bgmBufs[id]); return; }
    waLoad(id).then(function (buf) {
      if (curBgm !== id) return;
      if (buf && !_bgmSrc) playBuf(id, buf);
      else if (!buf) htmlStart(id);   // fetch/decode 失败 → 本次会话改走 HTMLAudio
    });
  }

  // ── HTMLAudio 回退路径 ───────────────────────────────────────────
  function getTrack(id) {
    if (!_tracks[id]) {
      try {
        // 显式走 window.Audio:闭包底部 const Audio(API 对象)会遮蔽全局构造器(TDZ),
        // 直接写 new Audio(...) 实际拿到的是 API 对象 → TypeError。vm 沙箱无 Audio 时静默跳过。
        const Ctor = window.Audio;
        if (typeof Ctor !== "function") return null;
        const el = new Ctor(BGM_FILES[id]);
        el.loop = true;
        el.preload = "auto";
        _tracks[id] = el;
        applyTrack(el);
      } catch (e) { return null; }
    }
    return _tracks[id];
  }
  function htmlStart(id) {
    const el = getTrack(id);
    if (!el) { bgmMode = "none"; return; }
    bgmMode = "html";
    applyTrack(el);
    try { const p = el.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
  }

  // ── 对外入口 ─────────────────────────────────────────────────────
  function waUsable() {
    // file:// 下 fetch 必被 CORS 拦(还会打 console error 噪音),直接判定不可用;
    // http/https 下才尝试 WebAudio(真失败由 waLoad 的 catch 落到 _bgmDead 回退)
    try {
      const p = window.location && window.location.protocol;
      if (p !== "http:" && p !== "https:") return false;
    } catch (e) { return false; }
    return waAvailable();
  }
  function startBgm(id) {
    if (!BGM_FILES[id]) return;
    if (curBgm === id) {   // 同曲继续(被打断过则恢复播放)
      if (bgmMode === "webaudio") {
        if (!_bgmSrc && _bgmBufs[id]) playBuf(id, _bgmBufs[id]);
      } else if (bgmMode === "html") {
        const cur = getTrack(id);
        if (cur && cur.paused) htmlStart(id);
      }
      return;
    }
    stopBgm();
    curBgm = id;
    if (waUsable() && !_bgmDead[id]) { waStart(id); return; }
    htmlStart(id);
  }
  function stopBgm() {
    stopSource();
    if (curBgm != null) {
      const el = _tracks[curBgm];
      try { if (el) { el.pause(); try { el.currentTime = 0; } catch (e2) {} } } catch (e) {}
    }
    curBgm = null;
  }

  const Audio = {
    resume: resume,
    isUnlocked: function () { return unlocked; },
    getBgmMode: function () { return bgmMode; },   // "webaudio"|"html"|"none"(测试/调试用)
    setMuted: function (m) { muted = m; if (master) master.gain.value = m ? 0 : MASTER_CAP; applyMusicGain(); for (const k in _tracks) applyTrack(_tracks[k]); SV.Storage.setSound(!m); },
    isMuted: function () { return muted; },
    setMusicVol: function (v) { musicVol = v; applyMusicGain(); for (const k in _tracks) applyTrack(_tracks[k]); SV.Storage.set("musicVol", v); },
    setSfxVol: function (v) { sfxVol = v; if (sfxGain) sfxGain.gain.value = v * SFX_SCALE; SV.Storage.set("sfxVol", v); },
    getMusicVol: function () { return musicVol; },
    getSfxVol: function () { return sfxVol; },
    startBgm: startBgm,
    stopBgm: stopBgm,

    shoot: function () { if (throttled("shoot", 70)) tone(680, 0.06, { type: "square", slideTo: 420, vol: 0.10 }); },
    hit: function () { if (throttled("hit", 60)) tone(220, 0.05, { type: "triangle", vol: 0.08 }); },
    // 击杀音:三层叠加(①三角波下扫主体 ②中频带通质感 ③低频冲击 thump)。
    // 柔化版:方波→三角波、高频嘶声 highpass 2800 → 带通 2200 低量,去掉刺耳感;
    // vol 已按 SFX_SCALE(×1.35) 做了等响抵消,击杀音不随总线增益变响
    die: function (isBoss) {
      if (throttled("die", 55)) {
        const pv = 0.92 + Math.random() * 0.16;
        tone(560 * pv, 0.15, { type: "triangle", slideTo: 130 * pv, vol: 0.17 });  // ① 下扫主体(三角波,柔)
        noise(0.05, { filter: "bandpass", freq: 2200, vol: 0.13 });                // ② 击中质感(低量带通)
        tone(85, 0.11, { type: "sine", slideTo: 42, vol: 0.22 });                  // ③ 低频 thump
      }
      if (isBoss) {
        // Boss 击杀追加"战利品"上行琶音(不受击杀节流,必响,亮色收尾)
        tone(523, 0.5, { type: "square", vol: 0.16, schedule: [[0.09, 659], [0.18, 784], [0.28, 1047], [0.4, 1319]] });
        tone(1046, 0.4, { type: "sine", vol: 0.1, schedule: [[0.28, 1568], [0.4, 2093]] });
      }
    },
    pickup: function () { if (throttled("pickup", 40)) tone(880, 0.05, { type: "sine", slideTo: 1180, vol: 0.10 }); },
    hurt: function () { if (throttled("hurt", 120)) { tone(160, 0.16, { type: "sawtooth", slideTo: 80, vol: 0.22 }); noise(0.1, { freq: 400, vol: 0.1 }); } },
    levelup: function () { tone(523, 0.10, { type: "square", vol: 0.18, schedule: [[0.10, 659], [0.20, 784], [0.30, 1047]] }); },
    evolve: function () { tone(392, 0.12, { type: "sawtooth", vol: 0.2, schedule: [[0.12, 523], [0.24, 659], [0.36, 784], [0.50, 1047], [0.66, 1319]] }); },
    bossWarn: function () { tone(70, 0.5, { type: "sawtooth", vol: 0.3, schedule: [[0.0, 90], [0.25, 70]] }); noise(0.5, { filter: "lowpass", freq: 120, vol: 0.15 }); },
    lowHp: function () { if (throttled("lowHp", 2500)) tone(520, 0.3, { type: "square", vol: 0.16, schedule: [[0, 520], [0.1, 392], [0.2, 262]] }); },
    gameOver: function () { tone(330, 0.25, { type: "sawtooth", vol: 0.22, schedule: [[0.25, 262], [0.5, 196], [0.8, 130]] }); }
  };

  // 初始静音状态从存档读
  muted = !SV.Storage.get("soundOn");
  musicVol = SV.Storage.get("musicVol");   // DEFAULTS 保证非空(老存档自动迁移到新默认)
  sfxVol = SV.Storage.get("sfxVol");

  // iOS 切后台 AudioContext 被打断/挂起 → 回前台自动恢复(解锁过的会话)
  try {
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && ctx && ctx.state !== "running" && unlocked) ctx.resume();
    });
  } catch (e) {}

  SV.Audio = Audio;
})();
