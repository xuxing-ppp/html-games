// storage.js — SV.Storage: localStorage 存档(v2,按 角色×关卡×难度×无尽 分别记录最佳)
(function () {
  "use strict";
  const SV = window.SV;

  const KEY = "neon_survivor_v2";
  const DEFAULTS = {
    bests: {},                 // "stageId:diff:charId[:endless]" -> { time, level, cleared }
    totalKills: 0, totalRuns: 0, totalEvolutions: 0,
    soundOn: true, reducedFx: false,
    autoMode: false,                 // 全自动模式开关(SV.Auto)
    eshotMark: false,                // 敌方子弹标红(边缘描红,便于与己方弹幕区分)
    musicVol: 1.0, sfxVol: 1.0,   // 音乐/音效音量(0..1);默认均满档
    language: "en",              // 界面语言: en | zh-CN（旧存档缺失时默认英文）
    savedRun: null,               // 单槽局内快照（由 Game 负责版本与内容校验）
    lastStage: "ruins", lastDiff: "normal", lastChar: "bulwark",
    lastStartWeapons: {}       // charId -> 最近一次合法起手武器
  };

  let data = null;
  let dirty = false;
  let flushTimer = null;

  function load() {
    if (data) return data;
    let d = Object.assign({}, DEFAULTS);
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const parsed = JSON.parse(raw); Object.assign(d, parsed); if (!d.bests) d.bests = {}; if (!d.lastStartWeapons || typeof d.lastStartWeapons !== "object" || Array.isArray(d.lastStartWeapons)) d.lastStartWeapons = {}; }
    } catch (e) { /* 隐私模式/损坏:用默认值 */ }
    // 一次性迁移:清除旧格式(无 charId 段)的 best key——2 段(stage:diff)或 3 段且末段 endless
    if (d.bests) {
      for (const k in d.bests) {
        const p = k.split(":");
        if (p.length === 2 || (p.length === 3 && p[2] === "endless")) delete d.bests[k];
      }
    }
    data = d;
    return data;
  }
  function writeNow() {
    flushTimer = null;
    if (!data) return false;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  function scheduleFlush() {
    dirty = true;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(writeNow, 500);
  }

  function bkey(stageId, diff, charId, endless) { return stageId + ":" + diff + ":" + charId + (endless ? ":endless" : ""); }

  const Storage = {
    load: load,
    get: function (k) { return load()[k]; },
    set: function (k, v) { load()[k] = v; scheduleFlush(); },
    setSound: function (on) { this.set("soundOn", !!on); },
    setReducedFx: function (on) { this.set("reducedFx", !!on); },
    setEshotMark: function (on) { this.set("eshotMark", !!on); },
    setSelection: function (stageId, diff) { load().lastStage = stageId; load().lastDiff = diff; writeNow(); },
    setChar: function (id) { load().lastChar = id; writeNow(); },
    getStartWeapon: function (charId) { return load().lastStartWeapons[charId] || null; },
    setStartWeapon: function (charId, weaponId) { load().lastStartWeapons[charId] = weaponId; writeNow(); },
    getSavedRun: function () { return load().savedRun || null; },
    saveRun: function (snapshot) {
      const d = load(), prev = d.savedRun;
      d.savedRun = snapshot;
      if (writeNow()) return true;
      d.savedRun = prev;
      return false;
    },
    clearSavedRun: function () { load().savedRun = null; return writeNow(); },

    getBest: function (stageId, diff, charId, endless) {
      const b = load().bests[bkey(stageId, diff, charId, endless)];
      return b || { time: 0, level: 0, cleared: false };
    },

    // 记录一局;返回是否刷新该角色×该关×该难度(该无尽桶)最佳时间
    recordRun: function (stageId, diff, charId, timeSec, level, kills, evolutions, cleared, endless) {
      const d = load();
      const k = bkey(stageId, diff, charId, endless);
      const prev = d.bests[k] || { time: 0, level: 0, cleared: false };
      const isBest = timeSec > prev.time;
      d.bests[k] = {
        time: Math.max(prev.time, timeSec),
        level: Math.max(prev.level, level),
        cleared: !!prev.cleared || !!cleared
      };
      d.totalKills += kills;
      d.totalRuns += 1;
      d.totalEvolutions += evolutions;
      writeNow();
      return isBest;
    },

    // 某角色的聚合成绩(跨所有关卡×难度,含无尽):通关配置数、最佳存活时间
    charSummary: function (charId) {
      const bests = load().bests;
      let clears = 0, bestTime = 0, stages = 0;
      for (const k in bests) {
        const p = k.split(":");
        if (p[2] !== charId) continue;
        const b = bests[k];
        if (b.cleared) clears++;
        if (b.time > bestTime) bestTime = b.time;
        stages++;
      }
      return { clears: clears, bestTime: bestTime, stages: stages };
    },

    // 某角色按难度的最佳成绩(跨所有关卡,含无尽桶):{ diffId -> {bestTime, clears} }
    charSummaryByDiff: function (charId) {
      const bests = load().bests;
      const out = {};
      for (const k in bests) {
        const p = k.split(":");
        if (p[2] !== charId) continue;
        const b = bests[k];
        if (!out[p[1]]) out[p[1]] = { bestTime: 0, clears: 0 };
        if (b.time > out[p[1]].bestTime) out[p[1]].bestTime = b.time;
        if (b.cleared) out[p[1]].clears++;
      }
      return out;
    },

    // 某角色在某张地图的成绩(选角界面用):{ clears, byDiff: { diffId -> {bestTime, clears} } }
    // 无尽桶(:endless)并入同难度聚合(时长取 max、通关计数累加)
    charStageSummary: function (charId, stageId) {
      const bests = load().bests;
      const out = { clears: 0, byDiff: {} };
      for (const k in bests) {
        const p = k.split(":");
        if (p[0] !== stageId || p[2] !== charId) continue;
        const b = bests[k];
        if (!out.byDiff[p[1]]) out.byDiff[p[1]] = { bestTime: 0, clears: 0 };
        if (b.time > out.byDiff[p[1]].bestTime) out.byDiff[p[1]].bestTime = b.time;
        if (b.cleared) { out.byDiff[p[1]].clears++; out.clears++; }
      }
      return out;
    },

    flushNow: writeNow
  };

  SV.Storage = Storage;
})();
