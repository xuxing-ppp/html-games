// menus.js — SV.Menus: 标题/选关/暂停/结算 叠层,data-act 事件委托(支持动态生成的卡片)。
(function () {
  "use strict";
  const SV = window.SV;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  let screens = {};
  let onActFn = null;
  let charSelStage = "ruins"; // 选角界面当前所属地图(时长成绩按 图×难度 区分)

  const STAGE_ICON = { ruins: "◈", crimson: "▲", frozen: "❄", void: "✸" };

  function statTile(label, val) {
    return '<div class="ars-stat"><span class="ars-stat-n">' + val + '</span><span class="ars-stat-l">' + label + '</span></div>';
  }
  function pct(v) { return (v >= 0 ? "+" : "") + Math.round(v * 100) + "%"; }
  // 紧凑数字:统一用 k(千)。1234→1.2k,12000→12.0k,150000→150.0k
  function fmtNum(n) { n = Math.round(n); if (n >= 1000) return (n / 1000).toFixed(1) + "k"; return "" + n; }
  // 某武器的累计伤害与每分钟伤害(进化合并、融合独立,经 tid 归一)
  function weaponDmg(state, wid) {
    const k = SV.Entities.tid(wid);
    const total = (state.weaponDamage && state.weaponDamage[k]) || 0;
    const active = (state.weaponActive && state.weaponActive[k]) || 0;
    return { total: total, perMin: active > 0 ? total / active * 60 : 0, recent: SV.Entities.weaponRecentDamage(state, k) };
  }
  // 怪物图鉴条目(本局已遇)。敌人展示初始→当前值。dmgToMe: {total} 或 null
  // 伤害分项标注:接触 / 自爆 / 弹幕·狙击 / 毒径 各列各的(特殊机制伤害与接触伤害分开)
  function enemyDmgSegs(def, cur) {
    const isBomber = def.ai === "bomber";
    const segs = [];
    const conI = isBomber ? 0 : (def.dmg || 0), conC = cur.contact || 0;
    if (conI > 0 || conC > 0) segs.push(L("Contact ", "接触 ") + fmtNum(conI) + "→" + fmtNum(conC));
    const boomI = isBomber ? (def.dmg || 0) : 0, boomC = cur.boom || 0;
    if (boomI > 0 || boomC > 0) segs.push(L("Explosion ", "自爆 ") + fmtNum(boomI) + "→" + fmtNum(boomC));
    const projI = def.projDmg || 0, projC = cur.proj || 0;
    if (projI > 0 || projC > 0) segs.push((def.ai === "sniper" ? L("Snipe ", "狙击 ") : L("Projectile ", "弹幕 ")) + fmtNum(projI) + "→" + fmtNum(projC));
    const tr = cur.trail || Math.round((def.trailDmg || 0) * 0.5);
    if (tr > 0) segs.push(L("Toxic trail ", "毒径 ") + fmtNum(tr) + L("/tick", "/跳"));
    return segs.length ? segs.join(" · ") : L("No attacks", "无攻击");
  }
  function bossDmgSegs(def, cur) {
    const zhLabels = { projectile: "弹幕", shock: "电击", laser: "激光" };
    const labels = { projectile: L("Projectile", zhLabels.projectile), shock: L("Shock", zhLabels.shock), laser: L("Laser", zhLabels.laser) };
    const segs = [L("Contact ", "接触 ") + fmtNum(def.dmg || 0) + "→" + fmtNum(cur.contact || cur.dmg || 0)];
    const attacks = def.attacks || {}, scaled = cur.attacks || {};
    function range(vals) {
      if (!vals || !vals.length) return "0";
      let lo = vals[0], hi = vals[0];
      for (let i = 1; i < vals.length; i++) { lo = Math.min(lo, vals[i]); hi = Math.max(hi, vals[i]); }
      return lo === hi ? fmtNum(lo) : fmtNum(lo) + "~" + fmtNum(hi);
    }
    for (const kind in attacks) segs.push((labels[kind] || kind) + " " + range(attacks[kind]) + "→" + range(scaled[kind]));
    return segs.join(" · ");
  }
  function bestiaryRow(def, cur, withElite, dmgToMe, isBoss) {
    const initHp = def.hp;
    const curHp = cur.hp;
    let html = '<div class="ars-row" style="flex-direction:column;align-items:flex-start;gap:2px">';
    html += '<div style="display:flex;width:100%;justify-content:space-between;align-items:center">';
    html += '<span><canvas class="ars-ic" width="22" height="22" data-shape="' + (def.shape || "circle") + '" data-color="' + def.color + '" data-pattern="' + (def.pattern || "") + '" data-boss="' + (isBoss ? "1" : "0") + '"></canvas><span class="ars-name">' + def.name + "</span></span>";
    html += '<span class="ars-lv">HP ' + fmtNum(initHp) + "→" + fmtNum(curHp) + " · " + (isBoss ? bossDmgSegs(def, cur) : enemyDmgSegs(def, cur)) + L(" · XP ", " · 经验 ") + (cur.xp || def.xp) + "</span>";
    html += "</div>";
    let eff = def.skill || "";
    // 对玩家伤害统计:普通敌与 Boss 均只显示累计总伤。
    if (dmgToMe && dmgToMe.total > 0) {
      const seg = L("Damage to player ", "对玩家 总伤 ") + fmtNum(dmgToMe.total);
      eff += " · <span style='color:#ff8a8a'>" + seg + "</span>";
    }
    html += '<span class="ars-eff" style="font-size:11px">' + eff + "</span>";
    html += "</div>";
    return html;
  }

  // 把图鉴里的 canvas.ars-ic 按各自 shape/color 绘成真实形状(与游戏内一致;复用 Renderer.drawShapePath)
  function drawBestiaryIcons(wrap) {
    if (!wrap || !wrap.querySelectorAll) return;
    let cans;
    try { cans = wrap.querySelectorAll('canvas.ars-ic'); } catch (e) { return; }
    for (let i = 0; i < cans.length; i++) {
      const cv = cans[i];
      let ctx = null;
      try { ctx = cv.getContext && cv.getContext("2d"); } catch (e) { ctx = null; }
      if (!ctx) continue;
      const shape = cv.getAttribute("data-shape") || "circle";
      const color = cv.getAttribute("data-color") || "#fff";
      if (ctx.clearRect) ctx.clearRect(0, 0, 22, 22);
      if (SV.Renderer && SV.Renderer.drawEnemyPortrait) {
        SV.Renderer.drawEnemyPortrait(ctx, { shape:shape, color:color, pattern:cv.getAttribute("data-pattern") || "" }, 11, 11, 7, { boss:cv.getAttribute("data-boss") === "1", reduced:true });
        continue;
      }
      ctx.fillStyle = color; ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5;
      if (SV.Renderer && SV.Renderer.drawShapePath) {
        SV.Renderer.drawShapePath(ctx, 11, 11, 7, shape);
        if (ctx.fill) ctx.fill();
        if (ctx.stroke) ctx.stroke();
      }
    }
  }

  const Menus = {
    init: function () {
      screens.title = document.getElementById("titleScreen");
      screens.exit = document.getElementById("exitScreen");
      screens.newgameconfirm = document.getElementById("newGameConfirmScreen");
      screens.charselect = document.getElementById("charSelectScreen");
      screens.weaponselect = document.getElementById("weaponSelectScreen");
      screens.select = document.getElementById("selectScreen");
      screens.pause = document.getElementById("pauseScreen");
      screens.restartconfirm = document.getElementById("restartConfirmScreen");
      screens.gameover = document.getElementById("gameoverScreen");
      screens.endlessprompt = document.getElementById("endlessPromptScreen");
      // 事件委托:对动态生成的关卡卡同样生效
      document.addEventListener("click", function (ev) {
        const t = ev.target.closest("[data-act]");
        if (t && onActFn) onActFn(t.getAttribute("data-act"), t);
      });
      // 音量滑块(input 事件不走上面的 click 委托,单独挂;class 选择器覆盖标题+暂停两屏)
      function wireVol(selector, kind) {
        const els = document.querySelectorAll(selector);
        for (let i = 0; i < els.length; i++) {
          els[i].addEventListener("input", function () {
            const v = Number(els[i].value) / 100;
            if (kind === "music") SV.Audio.setMusicVol(v);
            else { SV.Audio.setSfxVol(v); SV.Audio.hit(); } // 音效滑块拖动实时预览(throttled)
          });
        }
      }
      wireVol(".vol-music", "music");
      wireVol(".vol-sfx", "sfx");
    },
    onAct: function (fn) { onActFn = fn; },
    show: function (name) {
      for (const k in screens) if (screens[k]) screens[k].classList.add("hidden");
      if (screens[name]) screens[name].classList.remove("hidden");
    },
    hideAll: function () { for (const k in screens) if (screens[k]) screens[k].classList.add("hidden"); },

    // ── 选角界面(10 名角色，图标列表 + 常驻详情)
    showCharSelect: function (sel) {
      charSelStage = sel.stage || charSelStage;
      this.setDiffHighlight(sel.diff);
      // 图标网格:每个角色一个紧凑图标块(选中金色描边)
      const wrap = document.getElementById("charCards");
      const order = SV.Config.CHARACTER_ORDER;
      const cur = sel.char;
      let grid = "";
      for (let i = 0; i < order.length; i++) {
        const id = order[i], ch = SV.Config.CHARACTERS[id];
        grid += '<button class="char-tile' + (id === cur ? " selected" : "") + '" data-act="pickChar" data-char="' + id + '" style="border-color:' + ch.color + '">';
        grid += '<div class="tile-icon" style="color:' + ch.color + '">' + ch.icon + "</div>";
        grid += '<div class="tile-name">' + ch.name + "</div>";
        grid += "</button>";
      }
      wrap.innerHTML = grid;
      // 常驻详情面板:显示当前选中角色的完整介绍
      this.renderCharDetail(cur);
      this.show("charselect");
    },
    // 渲染详情面板(左头像列 + 右正文列)
    renderCharDetail: function (id) {
      const ch = SV.Config.CHARACTERS[id];
      const wrap = document.getElementById("charDetail");
      if (!ch || !wrap) return;
      const startW = SV.Config.startWeaponLabel(ch);
      let chips = "";
      function mulChip(label, value) {
        if (value == null || Math.abs(value - 1) < 1e-9) return;
        chips += '<span class="char-chip">' + label + " ×" + value + "</span>";
      }
      mulChip("HP", ch.hpMul);
      mulChip(L("Speed", "移速"), ch.speedMul);
      const cmod = ch.charMods || {};
      mulChip(L("Pickup", "拾取范围"), cmod.pickupMul);
      const healingMul = cmod.healingMul == null ? 1 : cmod.healingMul;
      mulChip(L("Regeneration", "生命再生"), healingMul * (cmod.regenMul == null ? 1 : cmod.regenMul));
      mulChip(L("Life-steal healing", "吸血治疗"), healingMul * (cmod.lifestealMul == null ? 1 : cmod.lifestealMul));
      mulChip(L("Medkit healing", "血包治疗"), healingMul);
      const spec = ch.weaponSpec || {};
      const specName = spec.tag === "spell" ? L("Spell", "法术") : spec.tag === "ranged" ? L("Ranged", "远程") : spec.tag === "melee" ? L("Melee", "近战") : L("Specialist", "专精武器");
      mulChip(specName + L(" damage", "伤害"), spec.damageMul);
      mulChip(specName + L(" area", "范围"), spec.areaMul);
      mulChip(specName + L(" interval", "攻击间隔"), spec.cooldownMul);
      chips += '<span class="char-chip">' + (startW.icon || "◆") + " " + startW.name + "</span>";
      const passiveIds = Object.keys(SV.Config.PASSIVES);
      const hasAllLv1 = passiveIds.length > 0 && passiveIds.every(function (pid) { return ch.startPassives[pid] === 1; });
      if (hasAllLv1) {
        chips += '<span class="char-chip char-chip-all" title="' + passiveIds.map(function (pid) { return SV.Config.PASSIVES[pid].name; }).join(L(", ", "、")) + '">' + L("✦ All passives ×1", "✦ 全部被动 ×1") + '</span>';
      } else {
        for (const pid in ch.startPassives) {
          const pd = SV.Config.PASSIVES[pid];
          if (pd) chips += '<span class="char-chip">' + pd.icon + " " + pd.name + "×" + ch.startPassives[pid] + "</span>";
        }
      }
      let html = '<div class="cd-head">';
      html += '<div class="cd-icon" style="color:' + ch.color + '">' + ch.icon + "</div>";
      html += '<div class="cd-name" style="color:' + ch.color + '">' + ch.name + "</div>";
      html += '<div class="cd-title">' + ch.title + "</div></div>";
      html += '<div class="cd-body">';
      html += '<div class="cd-desc">' + ch.desc + "</div>";
      if (ch.ability) html += '<div class="cd-ability"><b>' + ch.ability.trigger + "</b> · " + ch.ability.base + '<br><span>' + ch.ability.links + "</span></div>";
      html += '<div class="cd-chips">' + chips + "</div>";
      // 按难度分档列出「当前所选地图」的最佳成绩(时长随地图变化;无尽桶已并入同难度聚合)
      const cs = SV.Storage.charStageSummary ? SV.Storage.charStageSummary(id, charSelStage) : { clears: 0, byDiff: {} };
      const stage = SV.Config.STAGES[charSelStage] || SV.Config.STAGES.ruins;
      const order = SV.Config.DIFFICULTY_ORDER || Object.keys(SV.Config.DIFFICULTY);
      let dh = "";
      for (let i = 0; i < order.length; i++) {
        const dn = (SV.Config.DIFFICULTY[order[i]] || {}).name || order[i];
        const dd = cs.byDiff[order[i]];
        dh += (i ? " · " : "") + (dd && dd.bestTime > 0
          ? dn + " " + SV.Util.fmtTime(dd.bestTime) + (dd.clears > 0 ? "(" + dd.clears + "✓)" : "")
          : dn + " —");
      }
      html += '<div class="cd-best">' + stage.name + " ✓" + cs.clears + L(" clears · ", " 通关 · ") + dh + "</div>";
      html += "</div>";
      wrap.innerHTML = html;
      wrap.scrollTop = 0;
      const body = wrap.querySelector(".cd-body");
      if (body) body.scrollTop = 0;
    },
    // 点图标:只切 .selected + 刷详情(不重建网格,顺滑无闪烁)
    selectChar: function (id) {
      const tiles = document.getElementById("charCards").children;
      for (let i = 0; i < tiles.length; i++) {
        tiles[i].classList.toggle("selected", tiles[i].getAttribute("data-char") === id);
      }
      this.renderCharDetail(id);
    },

    // ── 起手武器终端：固定详情面板，左侧列表只显示当前角色的合法起手池。
    showWeaponSelect: function (sel) {
      const ch = SV.Config.CHARACTERS[sel.char];
      const ids = SV.Config.startWeaponIds(ch);
      const wrap = document.getElementById("startWeaponList");
      let html = "";
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i], d = SV.Config.WEAPONS[id];
        html += '<button class="start-weapon' + (id === sel.weapon ? " selected" : "") + '" data-act="pickStartWeapon" data-weapon="' + id + '" style="--weapon-color:' + d.color + '">';
        html += SV.Config.weaponIconHTML(id, "start-weapon-icon") + '<span>' + d.name + "</span></button>";
      }
      wrap.innerHTML = html;
      this.renderStartWeaponDetail(sel.char, sel.weapon || ids[0]);
      this.show("weaponselect");
    },
    selectStartWeapon: function (charId, wid) {
      const wrap = document.getElementById("startWeaponList");
      const bs = wrap ? wrap.children : [];
      for (let i = 0; i < bs.length; i++) bs[i].classList.toggle("selected", bs[i].getAttribute("data-weapon") === wid);
      this.renderStartWeaponDetail(charId, wid);
    },
    renderStartWeaponDetail: function (charId, wid) {
      const wrap = document.getElementById("startWeaponDetail"), ch = SV.Config.CHARACTERS[charId], def = SV.Config.WEAPONS[wid];
      if (!wrap || !ch || !def) return;
      const st = { charId: charId, charMul: { hpMul: ch.hpMul, speedMul: ch.speedMul }, charMods: ch.charMods || {}, special: ch.special || null, passives: Object.assign({}, ch.startPassives), player: { hp: 100, maxHp: 100 } };
      const s1 = SV.Weapons.stats({ id: wid, level: 1 }, st);
      const s8 = SV.Weapons.stats({ id: wid, level: 8 }, st);
      const evo = SV.Config.EVOLUTIONS[wid], req = evo && SV.Config.PASSIVES[evo.reqPassive];
      function fmt(s) {
        const p = [];
        if (s.damage != null) p.push(L("Damage ", "伤害 ") + Math.round(s.damage * 10) / 10);
        if (s.dot != null) p.push(L("Poison ", "毒伤 ") + Math.round(s.dot * 10) / 10 + L("/tick", "/跳"));
        if (s.cooldown != null) p.push(L("Interval ", "间隔 ") + Math.round(s.cooldown * 100) / 100 + "s");
        if (s.tick != null) p.push(L("Interval ", "间隔 ") + Math.round(s.tick * 100) / 100 + "s");
        if (s.count != null) p.push(L("Count ", "数量 ") + s.count);
        if (s.radius != null) p.push(L("Radius ", "半径 ") + Math.round(s.radius));
        if (s.length != null) p.push(L("Length ", "长度 ") + Math.round(s.length));
        return p.join(" · ") || def.desc;
      }
      const trait = SV.Upgrades.traitLabel(wid) || L("General", "通用");
      let html = '<div class="swd-head">' + SV.Config.weaponIconHTML(wid, "swd-icon") + '<div><div class="swd-name" style="color:' + def.color + '">' + def.name + '</div><div class="ars-trait">' + trait + "</div></div></div>";
      html += '<div class="swd-mechanic">' + def.desc + "</div>";
      html += '<div class="swd-level"><b>' + L("L1 ACTUAL", "L1 实际") + '</b><span>' + fmt(s1) + "</span></div>";
      html += '<div class="swd-level"><b>' + L("L8 FINAL", "L8 终点") + '</b><span>' + fmt(s8) + "</span></div>";
      if (evo) html += '<div class="swd-evo"><b>' + L("EVOLUTION: ", "进化：") + evo.name + "</b><span>" + def.name + " L8 + " + (req ? req.name : evo.reqPassive) + " L5</span><span>" + evo.desc + "</span></div>";
      const spec = ch.special === "arcanist" && (def.tags || []).indexOf("spell") >= 0 ? L("Starcaller's spell mastery included", "已计入星语法术专精") : ch.special === "ranger" && (def.tags || []).indexOf("ranged") >= 0 ? L("Gleam's ranged mastery included", "已计入流光远程专精") : L("Starting passive included", "已计入角色起手被动");
      html += '<div class="swd-note">' + spec + L(" · All base weapons can appear during the run", " · 局内可获得全部基础武器") + "</div>";
      wrap.innerHTML = html;
      wrap.scrollTop = 0;
    },

    // ── 无尽模式确认(通关后弹出)
    showEndlessPrompt: function (state) {
      const t = document.getElementById("endlessInfo");
      if (t) t.textContent = state.stage.name + " · " + SV.Config.DIFFICULTY[state.difficulty].name + L(" · Survived ", " · 存活 ") + SV.Util.fmtTime(state.time);
      const s = document.getElementById("endlessStats");
      if (s) s.textContent = "Lv " + state.level + " · ☠ " + state.kills + L(" · ✦ Evolutions ", " · ✦ 进化 ") + state.evolutions;
      this.show("endlessprompt");
    },

    // ── 选关界面(第一步:只选图,不显示最佳——此时尚未选角色/难度)
    showSelect: function (sel) {
      const wrap = document.getElementById("selectStages");
      const order = SV.Config.STAGE_ORDER;
      const cur = sel.stage;
      let html = "";
      for (let i = 0; i < order.length; i++) {
        const id = order[i], st = SV.Config.STAGES[id];
        const pal = st.palette;
        html += '<button class="card stage-card' + (id === cur ? " selected" : "") + '" data-act="pickStage" data-stage="' + id + '" style="border-color:' + pal.gridStrong + '">';
        html += '<div class="card-icon" style="color:' + (pal.star || "#fff") + '">' + (STAGE_ICON[id] || "◆") + "</div>";
        html += '<div class="card-name">' + st.name + "</div>";
        html += '<div class="card-desc">' + L("Survive ", "存活 ") + Math.round(st.goalMin / 60) + L(" minutes", " 分钟") + "</div>";
        html += "</button>";
      }
      wrap.innerHTML = html;
      this.show("select");
    },
    setDiffHighlight: function (diff) {
      const btns = document.querySelectorAll("[data-diff]");
      for (let i = 0; i < btns.length; i++) {
        const id = btns[i].getAttribute("data-diff");
        btns[i].classList.toggle("active", id === diff);
        if (SV.Config.DIFFICULTY[id]) btns[i].textContent = SV.Config.DIFFICULTY[id].name;
      }
    },

    // ── 结算(失败/胜利)
    setGameOver: function (stats) {
      const title = document.getElementById("goTitle");
      if (title) title.textContent = stats.won ? L("STAGE CLEARED!", "通关胜利!") : L("YOU HAVE FALLEN", "你倒下了");
      const sub = document.getElementById("goStage");
      if (sub) sub.textContent = (stats.charName || "") + " · " + stats.stageName + " · " + stats.diffName + (stats.endless ? L(" · ∞ Endless", " · ∞无尽") : "");
      document.getElementById("goTime").textContent = SV.Util.fmtTime(stats.time);
      document.getElementById("goLevel").textContent = stats.level;
      document.getElementById("goKills").textContent = stats.kills;
      document.getElementById("goEvo").textContent = stats.evolutions;
      document.getElementById("goBest").textContent = SV.Util.fmtTime(stats.best);
      const nb = document.getElementById("goNewBest");
      if (nb) { nb.textContent = stats.won ? L("★ CLEARED! ★", "★ 通关!★") : L("★ NEW RECORD! ★", "★ 新纪录!★"); nb.style.display = stats.isBest ? "" : "none"; }
      // 每武器伤害明细(进化合并、融合独立),按总伤害降序
      const gw = document.getElementById("goWeapons");
      if (gw) {
        const wd = stats.weaponDamage || {}, wa = stats.weaponActive || {};
        const rows = [];
        for (const id in wd) {
          if (!(wd[id] > 0)) continue;
          const def = SV.Config.weaponDef(id) || SV.Config.WEAPONS[id];
          const active = wa[id] || 0;
          rows.push({ id: id, name: def ? def.name : id, color: def ? def.color : "#fff", icon: def ? (def.icon || "◆") : "◆", total: wd[id], active: active, perMin: active > 0 ? wd[id] / active * 60 : 0 });
        }
        rows.sort(function (a, b) { return b.total - a.total; });
        let h = "";
        if (rows.length) {
          h += '<div class="ars-section"><div class="ars-title">' + L("WEAPON DAMAGE · TOTAL / PER MINUTE", "武器伤害明细 · 总伤害 / 每分钟") + '</div>';
          for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            h += '<div class="ars-row">' + SV.Config.weaponIconHTML(r.id, "ars-ic") +
              '<span class="ars-name">' + r.name + "</span>" +
              '<span class="ars-lv">' + L("Active ", "用时 ") + SV.Util.fmtTime(r.active) + "</span>" +
              '<span class="ars-eff">' + L("Total ", "总伤 ") + fmtNum(r.total) + " · " + fmtNum(r.perMin) + "/min</span></div>";
          }
          h += "</div>";
        }
        gw.innerHTML = h;
      }
    },

    setSoundToggle: function (muted) {
      const on = !muted;
      // 标题屏(旧 #titleSound)+ 暂停屏(.btn-sound-toggle)统一用 class 同步
      const t = document.getElementById("titleSound");
      if (t) { t.textContent = muted ? L("🔇 SFX: OFF", "🔇 音效:关") : L("🔊 SFX: ON", "🔊 音效:开"); t.classList.toggle("on", on); }
      const btns = document.querySelectorAll(".btn-sound-toggle");
      for (let i = 0; i < btns.length; i++) {
        btns[i].textContent = muted ? L("🔇 SFX: OFF", "🔇 音效:关") : L("🔊 SFX: ON", "🔊 音效:开");
        btns[i].classList.toggle("on", on);
      }
    },
    setFxToggle: function (reduced) {
      const t = document.getElementById("titleFx");
      if (t) { t.textContent = reduced ? L("🔋 SAVER: ON", "🔋 省电:开") : L("⚡ SAVER: OFF", "⚡ 省电:关"); t.classList.toggle("on", reduced); }
      const btns = document.querySelectorAll(".btn-fx-toggle");
      for (let i = 0; i < btns.length; i++) {
        btns[i].textContent = reduced ? L("🔋 SAVER: ON", "🔋 省电:开") : L("⚡ SAVER: OFF", "⚡ 省电:关");
        btns[i].classList.toggle("on", reduced);
      }
    },
    setAutoToggle: function (enabled) {
      const btns = document.querySelectorAll(".auto-toggle");
      for (let i = 0; i < btns.length; i++) {
        btns[i].textContent = enabled ? L("🤖 AUTO: ON", "🤖 全自动:开") : L("🤖 AUTO: OFF", "🤖 全自动:关");
        btns[i].classList.toggle("on", !!enabled);
      }
    },
    setEshotToggle: function (on) {
      const btns = document.querySelectorAll(".eshot-toggle");
      for (let i = 0; i < btns.length; i++) {
        btns[i].textContent = on ? L("🔴 BULLET MARKS: ON", "🔴 敌弹标红:开") : L("🔴 BULLET MARKS: OFF", "🔴 敌弹标红:关");
        btns[i].classList.toggle("on", !!on);
      }
    },
    // 把存档音量回填到所有音量滑块(标题屏 + 暂停屏)
    setVolUI: function (music, sfx) {
      const ms = document.querySelectorAll(".vol-music");
      for (let i = 0; i < ms.length; i++) ms[i].value = Math.round(music * 100);
      const ss = document.querySelectorAll(".vol-sfx");
      for (let i = 0; i < ss.length; i++) ss[i].value = Math.round(sfx * 100);
    },

    // ── 暂停面板:装备 + 基础数值
    populatePause: function (state) {
      const wrap = document.getElementById("pauseArsenal");
      if (!wrap) return;
      // 同步右侧设置开关的当前状态(打开暂停屏的瞬间)
      if (SV.Audio) this.setSoundToggle(SV.Audio.isMuted());
      if (SV.Effects) this.setFxToggle(SV.Effects.isReduced());
      if (SV.Auto) this.setAutoToggle(!!SV.Auto.enabled);
      if (SV.Renderer && SV.Renderer.getEshotMark) this.setEshotToggle(SV.Renderer.getEshotMark());
      if (SV.Audio) this.setVolUI(SV.Audio.getMusicVol(), SV.Audio.getSfxVol());
      let html = "";
      // 角色(被动技能说明)
      const ch = SV.Config.CHARACTERS[state.charId];
      if (ch) {
        const startW = SV.Config.startWeaponLabel(ch);
        const startId = state.startWeaponId || (state.weapons[0] && state.weapons[0].id);
        const startDef = startId && SV.Config.weaponDef(startId);
        html += '<div class="ars-section"><div class="ars-title">' + L("CHARACTER", "角色") + '</div>';
        html += '<div class="ars-row"><span class="ars-ic" style="color:' + ch.color + '">' + ch.icon + "</span>" +
          '<span class="ars-name">' + ch.name + " · " + ch.title + "</span>" +
          '<span class="ars-lv">HP ×' + ch.hpMul + L(" · Speed ×", " · 移速 ×") + ch.speedMul + "</span></div>";
        html += '<div class="ars-row" style="flex-direction:column;align-items:flex-start;gap:2px">' +
          '<span class="ars-eff" style="font-size:12px;color:var(--dim)">' + ch.desc + "</span>" +
          (ch.ability ? '<span class="ars-eff" style="font-size:12px"><b>' + ch.ability.trigger + "</b> · " + ch.ability.base + " · " + ch.ability.links + "</span>" : "") +
          (ch.ability && ch.ability.damageName ? '<span class="ars-dmg" style="font-size:12px">⚔ ' + ch.ability.damageName + L(" total ", " 总伤 ") + fmtNum((state.skillDamage && state.skillDamage[state.charId]) || 0) + " · " + fmtNum(state.time > 0 ? ((state.skillDamage && state.skillDamage[state.charId]) || 0) / state.time * 60 : 0) + "/min</span>" : "") +
          '<span class="ars-eff" style="font-size:12px">' + L("Starting weapon: ", "本局起手:") + (startDef ? startDef.icon + " " + startDef.name : (startW.icon || "◆") + " " + startW.name) + "</span></div>";
        html += "</div>";
      }
      // 武器
      html += '<div class="ars-section"><div class="ars-title">' + L("WEAPONS", "武器") + '</div>';
      if (!state.weapons.length) html += '<div class="ars-empty">' + L("None", "无") + '</div>';
      for (let i = 0; i < state.weapons.length; i++) {
        const w = state.weapons[i], def = SV.Config.weaponDef(w.id);
        const dm = weaponDmg(state, w.id);
        const trait = SV.Upgrades.traitLabel(w.id);
        const evo = SV.Config.EVOLUTIONS[w.id];
        const req = evo && SV.Config.PASSIVES[evo.reqPassive];
        html += '<div class="ars-row">' + SV.Config.weaponIconHTML(w.id, "ars-ic") +
          '<span class="ars-name">' + def.name + (w.evolved ? ' <i class="evo-star">★</i>' : "") + "</span>" +
          (trait ? '<span class="ars-trait">' + trait + "</span>" : "") +
          '<span class="ars-lv">Lv ' + w.level + "/" + def.max + "</span>" +
          '<span class="ars-eff">' + SV.Upgrades.summary(w, state) + "</span>" +
          (req ? '<span class="ars-eff">' + L("Evolution requirement: ", "进化条件：") + req.name + " Lv5</span>" : "") +
          (dm.total > 0 ? '<span class="ars-dmg">⚔ ' + L("Total ", "总") + fmtNum(dm.total) + L(", ", "，") + fmtNum(dm.perMin) + "/min" + (dm.recent == null ? "" : L(", recent ", "，最近") + fmtNum(dm.recent) + "/min") + "</span>" : "") +
          "</div>";
      }
      html += "</div>";
      // 被动
      html += '<div class="ars-section"><div class="ars-title">' + L("PASSIVES", "被动") + '</div>';
      let anyP = false;
      for (const id in state.passives) {
        const lv = state.passives[id];
        if (lv > 0) { anyP = true; const def = SV.Config.PASSIVES[id];
          html += '<div class="ars-row"><span class="ars-ic passive-mark" style="color:' + def.color + '">' + def.icon + '</span>' +
            '<span class="ars-name">' + def.name + "</span>" + '<span class="ars-lv">Lv ' + lv + "</span>" +
            '<span class="ars-eff">' + def.per + "</span></div>"; }
      }
      if (!anyP) html += '<div class="ars-empty">' + L("None", "无") + '</div>';
      html += "</div>";
      // 基础数值
      const m = SV.Entities.mods(state);
      html += '<div class="ars-section"><div class="ars-title">' + L("BASE STATS", "基础数值") + '</div><div class="ars-stats">';
      html += statTile(L("HP", "生命"), Math.round(m.maxHp));
      html += statTile(L("Speed", "移速"), pct(m.speedMul - 1));
      html += statTile(L("Damage", "伤害"), pct(m.damageMul - 1));
      html += statTile(L("Cooldown", "冷却"), "-" + Math.round((1 - m.cdMul) * 100) + "%");
      html += statTile(L("Area", "范围"), pct(m.areaMul - 1));
      html += statTile(L("Reduction", "减伤"), "-" + Math.round((1 - m.armorMul) * 100) + "%");
      html += statTile(L("Regen", "再生"), Number(m.regen).toFixed(1) + "/s");
      html += statTile(L("Critical", "暴击"), Math.round(m.critChance * 100) + "%");
      html += statTile(L("Life steal", "吸血"), (Math.round(m.lifesteal * 1000) / 10) + "%");
      html += statTile(L("Life-steal cap", "吸血秒回上限"), (Math.round(m.lifesteal * 1000) / 10) + L("% max HP/s", "%最大生命/s"));
      html += statTile(L("Pickup", "拾取"), pct(m.pickupMul - 1));
      html += statTile(L("XP", "经验"), pct(m.xpMul - 1));
      html += statTile(L("Luck", "幸运"), pct(m.luck));
      html += "</div></div>";
      // 怪物图鉴(本局已遇到,数值按当前时间实时缩放;附带"对玩家伤害"统计)
      const enc = state.encountered || { enemy: {}, boss: {} };
      const edmg = state.enemyDamage || {};
      const tmin = state.time / 60;
      const showElite = tmin >= 8;
      let encN = 0;
      for (const k in enc.enemy) if (enc.enemy[k] != null) encN++;
      for (const k in enc.boss) if (enc.boss[k] != null) encN++;
      function dmgToMe(id) { return { total: edmg[id] || 0 }; }
      if (encN > 0) {
        html += '<div class="ars-section"><div class="ars-title">' + L("BESTIARY · " + encN + " encountered" + (showElite ? " (Elite mutation active: HP×4 / DMG×1.5 / Size×1.4)" : ""), "怪物图鉴 · 本局 " + encN + " 种" + (showElite ? "（已现精英变异：HP×4 / 伤×1.5 / 体型×1.4）" : "")) + '</div>';
        for (const id in enc.boss) {
          if (enc.boss[id] == null) continue;
          const def = SV.Config.BOSSES[id]; if (!def) continue;
          const cur = SV.Entities.previewBoss(id, state); if (!cur) continue;
          html += bestiaryRow(def, cur, false, dmgToMe(id, enc.boss[id]), true);
        }
        for (const id in enc.enemy) {
          if (enc.enemy[id] == null) continue;
          const def = SV.Config.ENEMIES[id]; if (!def) continue;
          const cur = SV.Entities.previewEnemy(id, state); if (!cur) continue;
          html += bestiaryRow(def, cur, showElite, dmgToMe(id, enc.enemy[id]), false);
        }
        html += "</div>";
      }
      wrap.innerHTML = html;
      drawBestiaryIcons(wrap);
    }
  };

  SV.Menus = Menus;
})();
