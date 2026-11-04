// hud.js — SV.HUD: DOM 叠层(HP/XP/等级/计时/武器图标 + 升级卡牌 + Boss 血条 + 提示)。节流刷新。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  let el = {};
  let toastTimer = null;
  let keyHandler = null;

  const HUD = {
    init: function () {
      const ids = ["hpFill", "hpText", "xpFill", "lvText", "timerText", "killText", "weaponList", "bossBars", "lowHpWarn", "toast", "levelUp", "lvCards", "lvTitle", "stageTag"];
      for (let i = 0; i < ids.length; i++) el[ids[i]] = document.getElementById(ids[i]);
    },

    refresh: function (state) {
      const p = state.player;
      const hpPct = U.clamp(p.hp / p.maxHp, 0, 1);
      el.hpFill.style.width = (hpPct * 100) + "%";
      el.hpFill.className = "hp-fill" + (hpPct < 0.3 ? " low" : "");
      el.hpText.textContent = Math.ceil(p.hp) + " / " + Math.round(p.maxHp);
      // 低血警示:蒙层 + 进入低血的瞬间响一次告警
      const low = hpPct < 0.3;
      if (low && !HUD._lowHp) SV.Audio.lowHp();
      HUD._lowHp = low;
      el.lowHpWarn.classList.toggle("hidden", !low);
      el.xpFill.style.width = (U.clamp(state.xp / state.xpNext, 0, 1) * 100) + "%";
      el.lvText.textContent = "Lv " + state.level;
      el.timerText.textContent = U.fmtTime(state.time);
      el.killText.textContent = "☠ " + state.kills;
      if (el.stageTag) {
        let tag = state.stage.name + " · " + SV.Config.DIFFICULTY[state.difficulty].name;
        const ch = SV.Config.CHARACTERS[state.charId];
        if (ch) tag += " · " + ch.name;
        if (state.endless) tag += L(" · ∞ Endless", " · ∞无尽");
        el.stageTag.textContent = tag;
      }

      // 武器图标 + 等级格
      let html = "";
      for (let i = 0; i < state.weapons.length; i++) {
        const w = state.weapons[i];
        const def = SV.Config.weaponDef(w.id);
        html += '<div class="wicon' + (def.kind === "fusion" ? " fusion" : "") + '" title="' + def.name + '">';
        html += SV.Config.weaponIconHTML(w.id, "wicon-glyph");
        const max = def.max;
        for (let k = 0; k < max; k++) html += '<i class="pip' + (k < w.level ? " on" : "") + (def.kind === "fusion" ? " fusion" : (w.evolved ? " evo" : "")) + '"></i>';
        html += "</div>";
      }
      el.weaponList.innerHTML = html;

      // 多 Boss 血条(全部存活 Boss,单行紧凑条并排 ≤6,防手机上竖向糊满屏幕)
      const bosses = [];
      for (let i = 0; i < state.enemies.length; i++) { const e = state.enemies[i]; if (e.isBoss && e.hp > 0) bosses.push(e); }
      if (bosses.length) {
        el.bossBars.classList.remove("hidden");
        let html = "";
        const n = Math.min(bosses.length, 6);
        for (let i = 0; i < n; i++) {
          const b = bosses[i];
          const def = SV.Config.BOSSES[b.bossType] || {};
          const col = def.color || "#ff5d73";
          const pct = U.clamp(b.hp / b.maxHp, 0, 1) * 100;
          const enrage = b.enrage ? L(" ⚠ ENRAGED", " ⚠狂暴") : "";
          html += '<div class="boss-row">';
          html += '<div class="boss-name" style="color:' + col + '">' + (def.icon || "☠") + " " + (def.name || b.bossType) + enrage + "</div>";
          html += '<div class="boss-track"><div class="boss-fill" style="width:' + pct + "%;background:linear-gradient(90deg," + col + ",#fff);box-shadow:0 0 12px " + col + '"></div></div>';
          html += "</div>";
        }
        el.bossBars.innerHTML = html;
      } else {
        el.bossBars.classList.add("hidden");
      }
    },

    toast: function (msg) {
      el.toast.textContent = msg;
      el.toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.toast.classList.remove("show"); }, 2200);
    },

    showLevelUp: function (choices, onSelect) {
      el.lvTitle.textContent = L("LEVEL " + SV.Game.state.level + "! CHOOSE AN UPGRADE", "升到 " + SV.Game.state.level + " 级!选择一项强化");
      let html = "";
      for (let i = 0; i < choices.length; i++) {
        const c = choices[i];
        const tag = c.kind === "evolve" ? L("EVOLUTION", "进化") : c.kind === "fuse" ? L("FUSION", "融合") : c.kind === "newweapon" ? L("NEW WEAPON", "新武器") : (c.kind === "passive" ? L("PASSIVE", "被动") : L("UPGRADE", "强化"));
        html += '<button class="card rarity-' + c.rarity + '" data-idx="' + i + '">';
        html += '<div class="card-tag">' + tag + "</div>";
        html += '<div class="card-icon">' + ((c.id && c.kind !== "passive") ? SV.Config.weaponIconHTML(c.kind === "evolve" ? SV.Config.EVOLUTIONS[c.id].to : c.id, "card-weapon-mark") : '<span style="color:' + c.color + '">' + c.icon + '</span>') + "</div>";
        html += '<div class="card-name">' + c.name + "</div>";
        if (c.trait) html += '<div class="card-trait">' + c.trait + "</div>";
        html += '<div class="card-desc">' + c.desc + "</div>";
        if (c.synergy) html += '<div class="card-syn">' + c.synergy + "</div>";
        html += '<div class="card-key">' + (i + 1) + "</div>";
        html += "</button>";
      }
      el.lvCards.innerHTML = html;
      el.levelUp.classList.remove("hidden");
      const cards = el.lvCards.querySelectorAll(".card");
      for (let i = 0; i < cards.length; i++) {
        cards[i].addEventListener("click", function () { HUD.hideLevelUp(); onSelect(choices[i]); });
      }
      // 键盘 1/2/3 与回车
      keyHandler = function (ev) {
        const k = ev.key;
        let idx = -1;
        if (k >= "1" && k <= "9") idx = parseInt(k, 10) - 1;
        else if (k === "Enter") idx = 0;
        if (idx >= 0 && idx < choices.length) { HUD.hideLevelUp(); onSelect(choices[idx]); }
      };
      window.addEventListener("keydown", keyHandler);
    },

    hideLevelUp: function () {
      el.levelUp.classList.add("hidden");
      if (keyHandler) { window.removeEventListener("keydown", keyHandler); keyHandler = null; }
    }
  };

  SV.HUD = HUD;
})();
