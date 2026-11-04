// game.js — SV.Game: 状态机 + 固定步长循环 + 选关/难度/胜利/复位。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const C = SV.Config.CONST;
  const CU = SV.Config.CURVES;
  const STAGES = SV.Config.STAGES;
  const SAVE_VERSION = 1;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  const Game = {
    state: null,
    mode: "menu" // menu | select | charselect | weaponselect | playing | paused | restartconfirm | levelup | endlessprompt | gameover | exited
  };

  let selStage = "ruins", selDiff = "normal", selChar = "bulwark", selStartWeapon = null;

  function cloneRunState(state) {
    const copy = Object.assign({}, state);
    delete copy.stage; delete copy._mods; delete copy.hudAccum; delete copy.ended;
    copy.player = Object.assign({}, state.player, { blades: [], sentries: [] });
    return JSON.parse(JSON.stringify(copy));
  }

  function createSaveSnapshot() {
    const s = Game.state;
    return JSON.parse(JSON.stringify({
      version: SAVE_VERSION,
      savedAt: Date.now(),
      summary: { stageId:s.stageId, difficulty:s.difficulty, charId:s.charId, time:s.time, level:s.level, kills:s.kills, hp:s.player.hp, maxHp:s.player.maxHp },
      state: cloneRunState(s),
      runtime: SV.Weapons.snapshotRuntime()
    }));
  }

  function validSnapshot(save) {
    if (!save || save.version !== SAVE_VERSION || !save.state || !save.runtime) return false;
    const s = save.state;
    return !!(STAGES[s.stageId] && SV.Config.DIFFICULTY[s.difficulty] && SV.Config.CHARACTERS[s.charId] &&
      s.player && Array.isArray(s.enemies) && Array.isArray(s.weapons) && isFinite(s.time) && isFinite(s.level));
  }

  function getSavedRun() {
    const save = SV.Storage.getSavedRun ? SV.Storage.getSavedRun() : null;
    if (validSnapshot(save)) return save;
    if (save && SV.Storage.clearSavedRun) SV.Storage.clearSavedRun();
    return null;
  }

  function resolveStartWeapon() {
    const ch = SV.Config.CHARACTERS[selChar] || SV.Config.CHARACTERS.bulwark;
    const remembered = selStartWeapon || (SV.Storage.getStartWeapon && SV.Storage.getStartWeapon(selChar));
    const pool = SV.Config.startWeaponIds(ch);
    const valid = SV.Config.validStartWeapon(ch, remembered);
    selStartWeapon = valid ? remembered : pool[0];
    if (!valid && SV.Storage.setStartWeapon) SV.Storage.setStartWeapon(selChar, selStartWeapon);
    return selStartWeapon;
  }

  // ── 复位一局(按所选角色/关卡/难度)
  function reset() {
    const s = Game.state;
    s.stageId = selStage;
    s.difficulty = selDiff;
    s.stage = STAGES[selStage];
    const ch = SV.Config.CHARACTERS[selChar] || SV.Config.CHARACTERS.bulwark;
    s.charId = selChar;
    s.charMul = { hpMul: ch.hpMul, speedMul: ch.speedMul };
    s.charMods = ch.charMods || {};   // 角色静态乘子(拾取/再生/吸血/敌速/刷怪)
    s.special = ch.special || null;   // 角色动态机制路由 key
    SV.Renderer.setPalette(s.stage.palette);
    s.player = SV.Entities.makePlayer();
    s.enemies = [];
    s.gems = [];
    s.pickups = [];
    s.eshots = [];
    s.weapons = [];
    s.hazards = [];
    s.envTimer = (s.stage && s.stage.envField) ? s.stage.envField.interval : 0;
    s._voidPull = 0;
    s._voidPullDir = 0;
    s.collectorXp = 0;
    s.collectorCrystals = 0;
    s.timeFractureClock = s.special === "lingerer" && ch.mechanics ? ch.mechanics.interval : 9;
    s.timeFractureActive = 0;
    s.overclockClock = s.special === "overclocker" && ch.mechanics ? ch.mechanics.interval : 8;
    s.overclockActive = 0;
    s.afterimages = [];
    s.passives = Object.assign({}, ch.startPassives); // 起手被动
    s.endless = false;
    s.level = 1;
    s.xp = 0;
    s.xpNext = CU.xpForLevel(1);
    s.time = 0;
    s.kills = 0;
    s.evolutions = 0;
    s.encountered = { enemy: {}, boss: {} }; // 图鉴(本局遇敌记录)
    s.weaponDamage = {};                     // 每武器累计伤害(键=canonical id)
    s.weaponActive = {};                     // 每武器累计活跃秒数(键=canonical id)
    s.weaponRecent = {};                     // 每武器最近 60 个活跃秒的一秒伤害槽
    s.skillDamage = {};                      // 角色独立伤害技能累计伤害(不并入武器桶)
    s.enemyDamage = {};                      // 每敌人类型对玩家累计伤害(键=type/bossType)
    s.bossFlags = { count: 0, wraithEnrage: false };
    s._bossLoot = {};  // 多体 Boss 掉落去重(gid → 已掉过)
    s._bossGid = 0;    // 多体 Boss 组 id 计数(waves.spawnBoss 分配)
    s._bossWaveGid = 0; // 后期/无尽 Boss 波奖励组 id
    s.hudAccum = 0;
    s.ended = false;
    SV.Entities.invalidateMods(s);    // 清跨局残留的 mods 缓存
    const startW = resolveStartWeapon();
    s.startWeaponId = startW;
    SV.Weapons.init(s, startW);
    s.everOwned = {}; s.everOwned[startW] = true; // 武器历史(记解析后的具体 id):防止融合/进化后被当新武器重发
    // 起手满血(含角色 hpMul)
    const m = SV.Entities.mods(s);
    s.player.maxHp = m.maxHp;
    s.player.hp = m.maxHp;
    SV.Waves.reset(s);
    SV.Effects.clear();
    SV.Renderer.snapCam(s.player.x, s.player.y);
  }

  function showHud(on) {
    const hud = document.getElementById("hud");
    if (hud) hud.classList.toggle("hidden", !on);
  }

  function startRun(clearSave) {
    if (clearSave && SV.Storage.clearSavedRun) SV.Storage.clearSavedRun();
    reset();
    Game.mode = "playing";
    SV.Menus.hideAll();
    showHud(true);
    SV.HUD.refresh(Game.state);
    SV.Audio.startBgm(Game.state.stage && Game.state.stage.bgm);
  }

  function continueSavedRun() {
    const save = getSavedRun();
    if (!save) { refreshTitleBest(); return false; }
    const saved = JSON.parse(JSON.stringify(save.state));
    selStage = saved.stageId; selDiff = saved.difficulty; selChar = saved.charId; selStartWeapon = saved.startWeaponId || null;
    reset();
    const s = Game.state;
    for (const k in s) delete s[k];
    for (const k in saved) s[k] = saved[k];
    const ch = SV.Config.CHARACTERS[s.charId];
    s.stage = STAGES[s.stageId];
    s.charMul = { hpMul:ch.hpMul, speedMul:ch.speedMul };
    s.charMods = ch.charMods || {};
    s.special = ch.special || null;
    s.hudAccum = 0; s.ended = false; s._mods = null;
    // 旧存档没有绝对时间波次游标；已过的波次不在读档时补刷。
    if (!Number.isInteger(s.lateBossIndex)) s.lateBossIndex = C.LATE_BOSS_TIMES.filter(function (at) { return at <= s.time; }).length;
    if (!Number.isFinite(s.endlessBossNext)) {
      const elapsed = Math.max(0, s.time - C.ENDLESS_BOSS_FIRST);
      s.endlessBossNext = C.ENDLESS_BOSS_FIRST + (Math.floor(elapsed / C.ENDLESS_BOSS_EVERY) + (s.time >= C.ENDLESS_BOSS_FIRST ? 1 : 0)) * C.ENDLESS_BOSS_EVERY;
    }
    if (!Number.isFinite(s._bossWaveGid)) s._bossWaveGid = 0;
    if (!Array.isArray(s.pendingBosses)) s.pendingBosses = [];
    if (!Number.isFinite(s.lateReliefUntil)) s.lateReliefUntil = 0;
    if (!Number.isFinite(s.player.burstIframe)) s.player.burstIframe = 0;
    if (!Number.isFinite(s.player.hazardTick)) s.player.hazardTick = 0;
    if (!s.player.blades) s.player.blades = [];
    if (!s.player.sentries) s.player.sentries = [];
    SV.Weapons.restoreRuntime(s, save.runtime);
    let maxId = 0;
    for (let i = 0; i < s.enemies.length; i++) if (s.enemies[i].id > maxId) maxId = s.enemies[i].id;
    if (SV.Entities.reserveEntityId) SV.Entities.reserveEntityId(maxId + 1);
    SV.Entities.invalidateMods(s);
    SV.Entities.rebuildGrid(s);
    SV.Effects.clear();
    SV.Renderer.setPalette(s.stage.palette);
    SV.Renderer.snapCam(s.player.x, s.player.y);
    Game.mode = "playing";
    SV.Menus.hideAll(); showHud(true); SV.HUD.refresh(s);
    SV.Audio.startBgm(s.stage.bgm);
    return true;
  }

  function saveAndExit() {
    if (Game.mode !== "paused") return false;
    let snapshot;
    try { snapshot = createSaveSnapshot(); } catch (e) { snapshot = null; }
    if (!snapshot || !SV.Storage.saveRun || !SV.Storage.saveRun(snapshot)) {
      SV.HUD.toast(L("Save failed — storage is unavailable or full", "保存失败：存储不可用或空间不足"));
      return false;
    }
    Game.mode = "menu";
    reset();
    SV.Audio.startBgm(SV.Config.MENU_BGM);
    refreshTitleBest();
    SV.Menus.show("title"); showHud(false);
    return true;
  }

  function exitGame() {
    Game.mode = "exited";
    SV.Audio.stopBgm();
    showHud(false);
    SV.Menus.hideAll();
    try { if (typeof window.close === "function") window.close(); } catch (e) {}
    // 普通浏览器通常拒绝关闭并非由脚本打开的标签页，显示明确的只读降级页。
    SV.Menus.show("exit");
  }

  function showCharSelect() {
    Game.mode = "charselect";
    SV.Menus.showCharSelect({ stage: selStage, diff: selDiff, char: selChar });
    showHud(false);
  }

  function showWeaponSelect() {
    Game.mode = "weaponselect";
    const wid = resolveStartWeapon();
    SV.Menus.showWeaponSelect({ stage: selStage, diff: selDiff, char: selChar, weapon: wid });
    showHud(false);
  }

  function showSelect() {
    Game.mode = "select";
    SV.Menus.showSelect({ stage: selStage, diff: selDiff, char: selChar });
    showHud(false);
  }

  // ── 通关:弹出无尽选择(冻结模拟),确认后进入无尽模式
  function openEndlessPrompt() {
    Game.mode = "endlessprompt";
    SV.Menus.showEndlessPrompt(Game.state);
    showHud(false);
    SV.Audio.evolve();
  }
  function enterEndless() {
    if (Game.mode !== "endlessprompt") return;
    Game.state.endless = true;
    Game.mode = "playing";
    SV.Menus.hideAll();
    showHud(true);
    SV.HUD.refresh(Game.state);
    SV.HUD.toast(L("∞ Endless Mode! Enemies will keep growing stronger", "∞ 无尽模式!敌人将不断增强"));
  }

  function togglePause() {
    if (Game.mode === "playing") {
      Game.mode = "paused";
      if (SV.Input && SV.Input.cancelPointer) SV.Input.cancelPointer();
      SV.Menus.populatePause(Game.state); SV.Menus.show("pause");
    }
    else if (Game.mode === "paused") { Game.mode = "playing"; SV.Menus.hideAll(); }
  }

  function openRestartConfirm() {
    if (Game.mode !== "paused") return;
    Game.mode = "restartconfirm";
    SV.Menus.show("restartconfirm");
  }
  function cancelRestart() {
    if (Game.mode !== "restartconfirm") return;
    Game.mode = "paused";
    SV.Menus.populatePause(Game.state);
    SV.Menus.show("pause");
  }

  // ── 升级流程
  function openLevelUp() {
    Game.mode = "levelup";
    const choices = SV.Upgrades.rollChoices(Game.state);
    if (!choices.length) { Game.mode = "playing"; return; }
    SV.Audio.levelup();
    SV.Effects.levelBurst(Game.state.player.x, Game.state.player.y);
    SV.HUD.showLevelUp(choices, onChoose);
  }
  function levelUpOnce() {
    const s = Game.state;
    s.level++; s.xp -= s.xpNext; s.xpNext = CU.xpForLevel(s.level);
    openLevelUp();
  }
  function onChoose(choice) {
    SV.Upgrades.apply(Game.state, choice);
    if (Game.state.xp >= Game.state.xpNext) levelUpOnce();
    else { Game.mode = "playing"; SV.HUD.refresh(Game.state); }
  }

  Game.onXP = function () {
    if (Game.mode === "playing" && Game.state.xp >= Game.state.xpNext) levelUpOnce();
  };
  Game.onPlayerDeath = function () {
    if (Game.mode !== "gameover") endRun(false);
  };

  // ── 结算(失败/胜利)
  function endRun(won) {
    if (Game.state.ended) return;
    Game.state.ended = true;
    if (SV.Storage.clearSavedRun) SV.Storage.clearSavedRun();
    Game.mode = "gameover";
    SV.Audio.stopBgm();
    const s = Game.state;
    const endless = !!s.endless;
    const isBest = SV.Storage.recordRun(s.stageId, s.difficulty, s.charId, s.time, s.level, s.kills, s.evolutions, won, endless);
    SV.Menus.setGameOver({
      won: won, endless: endless, charName: SV.Config.CHARACTERS[s.charId].name, stageName: s.stage.name, diffName: SV.Config.DIFFICULTY[s.difficulty].name,
      time: s.time, level: s.level, kills: s.kills, evolutions: s.evolutions,
      weaponDamage: s.weaponDamage || {}, weaponActive: s.weaponActive || {},
      best: SV.Storage.getBest(s.stageId, s.difficulty, s.charId, endless).time, isBest: isBest
    });
    SV.Menus.show("gameover");
    showHud(false);
    if (won) SV.Audio.evolve(); else SV.Audio.gameOver();
    SV.Effects.shake(14, 0.6);
    SV.Effects.explosion(s.player.x, s.player.y, won ? SV.Config.COLORS.gold : SV.Config.COLORS.player, 30);
  }

  // ── 菜单/按钮动作
  function handleAct(act, el) {
    if (act === "start" || act === "newGame") {
      if (getSavedRun()) SV.Menus.show("newgameconfirm");
      else showSelect();
    }
    else if (act === "confirmNewGame") { if (SV.Storage.clearSavedRun) SV.Storage.clearSavedRun(); refreshTitleBest(); showSelect(); }
    else if (act === "cancelNewGame") SV.Menus.show("title");
    else if (act === "continueRun") continueSavedRun();
    else if (act === "pickStage") { // 选图:只选中并重绘,留在本屏
      selStage = el.getAttribute("data-stage");
      SV.Storage.setSelection(selStage, selDiff);
      SV.Menus.showSelect({ stage: selStage, diff: selDiff, char: selChar });
    }
    else if (act === "toChar") showCharSelect(); // 选图屏「继续」→ 选角屏
    else if (act === "pickChar") { // 选角:只切选中 + 刷详情,留在本屏(不重建网格)
      selChar = el.getAttribute("data-char");
      selStartWeapon = null;
      SV.Storage.setChar(selChar);
      SV.Menus.selectChar(selChar);
    }
    else if (act === "setDiff") { // 切难度:只切换高亮,留在本屏
      selDiff = el.getAttribute("data-diff");
      SV.Storage.setSelection(selStage, selDiff);
      SV.Menus.setDiffHighlight(selDiff);
    }
    else if (act === "toStage") showSelect(); // 选角屏「返回选关」→ 选图屏
    else if (act === "toWeapon") showWeaponSelect();
    else if (act === "pickStartWeapon") {
      const wid = el.getAttribute("data-weapon");
      if (SV.Config.validStartWeapon(selChar, wid)) {
        selStartWeapon = wid;
        SV.Storage.setStartWeapon(selChar, wid);
        SV.Menus.selectStartWeapon(selChar, wid);
      }
    }
    else if (act === "toCharBack") showCharSelect();
    else if (act === "beginRun") startRun(true);
    else if (act === "endlessYes") enterEndless();
    else if (act === "endlessNo") endRun(true);
    else if (act === "restart") { if (Game.mode === "paused") openRestartConfirm(); else startRun(true); }
    else if (act === "confirmRestart") { if (Game.mode === "restartconfirm") startRun(true); }
    else if (act === "cancelRestart") cancelRestart();
    else if (act === "pause" || act === "resume") togglePause();
    else if (act === "saveExit") saveAndExit();
    else if (act === "exitGame") exitGame();
    else if (act === "menu") { Game.mode = "menu"; reset(); SV.Audio.startBgm(SV.Config.MENU_BGM); refreshTitleBest(); SV.Menus.show("title"); showHud(false); }
    else if (act === "toggleSound") { const m = !SV.Audio.isMuted(); SV.Audio.setMuted(m); SV.Menus.setSoundToggle(m); }
    else if (act === "setLanguage") {
      const lang = el.getAttribute("data-lang");
      if (SV.I18n) SV.I18n.setLanguage(lang);
      SV.Menus.setDiffHighlight(selDiff);
      SV.Menus.setSoundToggle(SV.Audio.isMuted());
      SV.Menus.setFxToggle(SV.Effects.isReduced());
      if (SV.Menus.setAutoToggle && SV.Auto) SV.Menus.setAutoToggle(!!SV.Auto.enabled);
      if (SV.Menus.setEshotToggle && SV.Renderer) SV.Menus.setEshotToggle(SV.Renderer.getEshotMark());
      refreshTitleBest();
    }
    else if (act === "toggleFx") {
      const v = !SV.Storage.get("reducedFx"); SV.Storage.setReducedFx(v); SV.Effects.setReducedFx(v);
      SV.Menus.setFxToggle(v);
      SV.HUD.toast(v ? L("Battery Saver enabled", "已开启省电模式") : L("Battery Saver disabled", "已关闭省电模式"));
    }
    else if (act === "toggleAuto") { if (SV.Auto && SV.Auto.toggle) SV.Auto.toggle(); }
    else if (act === "toggleEshotMark") {
      const v = !SV.Renderer.getEshotMark();
      SV.Renderer.setEshotMark(v);
      SV.Storage.setEshotMark(v);
      SV.Menus.setEshotToggle(v);
      SV.HUD.toast(v ? L("Enemy bullet markers enabled", "敌弹标红已开启") : L("Enemy bullet markers disabled", "敌弹标红已关闭"));
    }
  }

  function refreshTitleBest() {
    const tb = document.getElementById("titleBest");
    if (!tb) return;
    const ch = SV.Config.CHARACTERS[selChar] || SV.Config.CHARACTERS.bulwark;
    const st = STAGES[selStage] || STAGES.ruins;
    const df = SV.Config.DIFFICULTY[selDiff] || SV.Config.DIFFICULTY.normal;
    const best = SV.Storage.getBest(selStage, selDiff, selChar).time;
    tb.textContent = ch.name + " · " + st.name + " · " + df.name + " · " + U.fmtTime(best);
    const save = getSavedRun();
    const btn = document.getElementById("btnContinueRun"), progress = document.getElementById("savedRunProgress");
    const actions = document.querySelector("#titleScreen .title-actions");
    if (actions) actions.classList.toggle("has-save", !!save);
    if (btn) btn.classList.toggle("hidden", !save);
    if (progress) {
      progress.classList.toggle("hidden", !save);
      if (save) {
        const q = save.summary || save.state, sch = SV.Config.CHARACTERS[q.charId], sst = STAGES[q.stageId], sdf = SV.Config.DIFFICULTY[q.difficulty];
        const hp = Math.max(0, Math.round((q.hp || 0) / Math.max(1, q.maxHp || 1) * 100));
        progress.textContent = "▣ " + sch.name + " · " + sst.name + " · " + sdf.name + " · " + U.fmtTime(q.time) + " · " + L("Lv ", "等级 ") + q.level + " · " + L("HP ", "生命 ") + hp + "%";
      }
    }
  }

  // ── 每帧输入(始终运行)
  function handleInputs() {
    if (SV.Input.consumePause()) {
      if (Game.mode === "playing" || Game.mode === "paused") togglePause();
      else if (Game.mode === "restartconfirm") cancelRestart();
    }
    if (SV.Input.consumeMute()) { const m = !SV.Audio.isMuted(); SV.Audio.setMuted(m); SV.Menus.setSoundToggle(m); }
    if (SV.Input.consumeConfirm()) {
      if (Game.mode === "menu") { if (getSavedRun()) continueSavedRun(); else showSelect(); }
      else if (Game.mode === "endlessprompt") enterEndless(); // 回车默认进入无尽
      else if (Game.mode === "gameover") startRun(true);
      else if (Game.mode === "paused") togglePause();
    }
  }

  // ── 固定步长模拟(仅 playing)
  function step(dt) {
    const s = Game.state;
    s.time += dt;
    // 通关判定(无尽模式已开启则继续,不再重复弹窗)
    if (s.time >= s.stage.goalMin && !s.endless) { openEndlessPrompt(); return; }
    SV.Waves.update(s, dt);
    SV.Entities.rebuildGrid(s);
    SV.Entities.updateCharacterState(s, dt);
    SV.Weapons.updateAll(s, dt);
    if (SV.Auto && SV.Auto.enabled) SV.Auto.tick(s, dt);   // 全自动走位(grid 刚刷新、updatePlayer 未读 axis)
    SV.Entities.updatePlayer(s, dt);
    SV.Entities.updateEnemies(s, dt);
    SV.Entities.envTick(s, dt);
    SV.Effects.update(dt);
    SV.Renderer.followCam(s, dt);
    s.hudAccum += dt;
    if (s.hudAccum >= 0.12) { s.hudAccum = 0; SV.HUD.refresh(s); }
  }

  // ── 主循环
  let _last = 0, _acc = 0;
  function frame(now) {
    if (!_last) _last = now;
    let ft = (now - _last) / 1000; _last = now;
    if (ft > C.MAX_FRAME) ft = C.MAX_FRAME;

    SV.Input.update();
    handleInputs();

    if (Game.mode === "playing") {
      _acc += ft;
      let steps = 0;
      while (_acc >= C.FIXED_DT && steps < C.MAX_STEPS) { step(C.FIXED_DT); _acc -= C.FIXED_DT; steps++; }
      if (steps === C.MAX_STEPS) _acc = 0;
    } else if (Game.mode === "gameover") {
      SV.Effects.update(ft);
    }

    SV.Renderer.render(Game.state);
    requestAnimationFrame(frame);
  }

  // ── 启动
  Game.boot = function () {
    Game.state = {};
    if (SV.I18n && SV.I18n.init) SV.I18n.init();
    selStage = SV.Storage.get("lastStage") || "ruins";
    selDiff = SV.Storage.get("lastDiff") || "normal";
    selChar = SV.Storage.get("lastChar") || "bulwark";
    if (!SV.Config.CHARACTERS[selChar]) selChar = "bulwark";
    selStartWeapon = null;
    const canvas = document.getElementById("game");
    SV.Renderer.init(canvas);
    SV.Input.init(document.getElementById("stick"), document.getElementById("knob"), document.getElementById("stickZone"));
    SV.HUD.init();
    SV.Menus.init();
    SV.Effects.init();
    SV.Menus.setSoundToggle(SV.Audio.isMuted());
    SV.Menus.setFxToggle(SV.Effects.isReduced());
    SV.Menus.setVolUI(SV.Audio.getMusicVol(), SV.Audio.getSfxVol());
    if (SV.Menus && SV.Menus.setAutoToggle && SV.Auto) SV.Menus.setAutoToggle(!!SV.Storage.get("autoMode"));
    if (SV.Renderer && SV.Renderer.setEshotMark) SV.Renderer.setEshotMark(!!SV.Storage.get("eshotMark"));
    SV.Menus.onAct(handleAct);
    if (SV.Auto && SV.Auto.init) SV.Auto.init();   // 全自动模式:包装升级入口、绑定开关、还原偏好

    reset();
    Game.mode = "menu";
    showHud(false);
    refreshTitleBest();
    SV.Menus.show("title");

    window.addEventListener("resize", function () { SV.Renderer.resize(); });
    // iOS Safari 旋转:orientationchange 比 resize 早派发且带新尺寸,但有时 resize 仍拿到旧值 → 加 100ms 延迟兜底
    window.addEventListener("orientationchange", function () { setTimeout(function () { SV.Renderer.resize(); }, 120); });
    // Safari URL 栏自动隐藏/出现会改变视觉视口,ResizeObserver 比 resize 更可靠捕捉
    try {
      if (window.ResizeObserver) {
        const ro = new ResizeObserver(function () { SV.Renderer.resize(); });
        ro.observe(canvas);
      }
    } catch (e) {}
    // 从后台返回时重测(可能切应用期间旋转过)
    document.addEventListener("visibilitychange", function () { if (!document.hidden) SV.Renderer.resize(); });

    // 移动端:切后台/锁屏/通知中心时自动暂停(rAF 被节流会导致固定步长大 catch-up;
    // iOS Safari 常触发 pagehide,Android Chrome 触发 visibilitychange,两者都监听)
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && Game.mode === "playing") togglePause();
    });
    window.addEventListener("pagehide", function () {
      if (Game.mode === "playing") togglePause();
    });

    // 音频解锁:首次手势(用户交互)后才能 startBgm。
    // pointerdown 覆盖现代浏览器;touchstart 兜底旧 Android webview;iOS Safari 两者都派发。
    const unlock = function () {
      SV.Audio.resume();
      SV.Audio.startBgm(SV.Config.MENU_BGM);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    window.addEventListener("touchstart", unlock, { passive: true });

    requestAnimationFrame(frame);
  };

  Game.createSaveSnapshot = createSaveSnapshot;
  Game.continueSavedRun = continueSavedRun;
  Game.saveAndExit = saveAndExit;
  Game.exitGame = exitGame;

  SV.Game = Game;
})();
