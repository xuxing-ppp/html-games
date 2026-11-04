// entities.js — SV.Entities: 工厂 + 玩家/敌人/投射物的每帧积分(仅逻辑,绘制在 renderer)
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const C = SV.Config.CONST;
  const EN = SV.Config.ENEMIES;
  const BOSSES = SV.Config.BOSSES;
  const CU = SV.Config.CURVES;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  let _id = 1;

  // ── 被动递减曲线(模块级,供 mods()/upgrades 预览共用)
  //   capDim —— 有硬上限:每级收益等比衰减,收敛到 cap(首级增量精确 = v1)。
  //   rootDim —— 无上限:每级收益 1/√k 衰减,等级大时 ≈ 2·per·√n 增长。
  function capDim(n, cap, v1) { return n <= 0 ? 0 : cap * (1 - Math.pow(1 - v1 / cap, n)); }
  function rootDim(n, per) { let s = 0; for (let k = 1; k <= n; k++) s += per / Math.sqrt(k); return s; }

  // canonical 追踪 id:进化武器(_evo)与进化前合并为同一统计桶,融合武器(无 _evo 后缀)独立成桶
  function tid(id) { return id.replace(/_evo$/, ""); }

  // ── 被动汇总(玩家与武器共用)。结果缓存到 state._mods,被动/角色变化后由 invalidateMods 失效。
  function mods(state) {
    if (state._mods) return state._mods;
    const p = state.passives;
    const cm = state.charMul || { hpMul: 1, speedMul: 1 };
    const L = function (id) { return p[id] || 0; };
    state._mods = {
      maxHp: (C.PLAYER_BASE_HP + rootDim(L("maxhp"), 28)) * cm.hpMul,
      speedMul: (1 + rootDim(L("speed"), 0.09)) * cm.speedMul,
      damageMul: 1 + rootDim(L("damage"), 0.11),
      cdMul: 1 - capDim(L("cooldown"), 0.70, 0.075),
      areaMul: 1 + rootDim(L("area"), 0.11),
      armorMul: 1 - capDim(L("armor"), 0.60, 0.095),
      regen: rootDim(L("regen"), 2),
      pickupMul: 1 + rootDim(L("magnet"), 0.45),
      xpMul: 1 + rootDim(L("magnet"), 0.09),
      luck: rootDim(L("luck"), 0.17),
      critChance: capDim(L("crit"), 1.0, 0.09),
      lifesteal: capDim(L("lifesteal"), C.LIFESTEAL_ATTR_CAP, C.LIFESTEAL_FIRST)
    };
    // 角色静态乘子(整局不变,进缓存安全)。!= null 以允许 0 值(如 berserker 清零再生)
    const cmod = state.charMods || {};
    if (cmod.pickupMul) state._mods.pickupMul *= cmod.pickupMul;
    if (cmod.regenMul != null) state._mods.regen *= cmod.regenMul;
    if (cmod.lifestealMul != null) state._mods.lifesteal *= cmod.lifestealMul;
    return state._mods;
  }
  function invalidateMods(state) { if (state) state._mods = null; }

  function characterMechanics(state) {
    const ch = state && SV.Config.CHARACTERS[state.charId];
    return (ch && ch.mechanics) || {};
  }

  // 磁芯的触发频率会随经验/怪量自然成长，所以仅它的直伤等级超过阈值后转为平方根成长。
  function collectorSkillLevel(level, cap) {
    const n = Math.max(0, level || 0);
    return n <= cap ? n : Math.sqrt(cap * n);
  }

  // ── 怪物数值预览(图鉴用,纯计算,不创建实体、不碰缓存)。返回 {hp,speed,xp,...}
  // 伤害分项:contact 接触 / boom 自爆(bomber) / proj 弹幕(炮台/狙击) / trail 毒径每跳;dmg 为旧兼容字段(取最大者)
  function previewEnemy(type, state) {
    const def = EN[type]; if (!def) return null;
    const e = makeEnemy(state, type, 0, 0);
    return {
      hp: Math.round(e.maxHp), speed: Math.round(e.speed), xp: e.xp, def: def,
      contact: Math.round(e.dmg || 0), boom: Math.round(e.boomDmg || 0), proj: Math.round(e.projDmg || 0),
      trail: Math.round((e.trailDmg || 0) * 0.5),
      dmg: Math.round(e.dmg || e.boomDmg || e.projDmg || 0)
    };
  }
  function previewBoss(bossType, state) {
    const def = BOSSES[bossType]; if (!def) return null;
    const e = makeBoss(state, bossType, 0, 0);
    const scale = def.dmg > 0 ? e.dmg / def.dmg : 1;
    const attacks = {}, src = def.attacks || {};
    for (const kind in src) attacks[kind] = src[kind].map(function (d) { return Math.round(d * scale); });
    return { hp: Math.round(e.maxHp), speed: Math.round(e.speed), dmg: Math.round(e.dmg), contact: Math.round(e.dmg), attacks: attacks, xp: e.xp, def: def };
  }

  function makePlayer() {
    return {
      x: 0, y: 0, vx: 0, vy: 0,
      r: C.PLAYER_RADIUS,
      hp: C.PLAYER_BASE_HP, maxHp: C.PLAYER_BASE_HP,
      speed: C.PLAYER_BASE_SPEED,
      facing: 0,
      iframes: 0, eshotIframe: 0, burstIframe: 0, hazardTick: 0, flash: 0,
      pickupRadius: C.PICKUP_RADIUS,
      regenAcc: 0, lsWindow: 0,
      bulwarkCd: 0,
      phantomDist: 0, phantomX: 0, phantomY: 0,
      slow: 0, slowF: 0,
      blades: []
    };
  }

  function diffOf(state) { return SV.Config.DIFFICULTY[state.difficulty] || SV.Config.DIFFICULTY.normal; }

  // 无尽模式额外倍率(通关后随超时分钟增长)
  function endlessHpMulOf(state) {
    if (state.endless && state.stage) return CU.endlessHpMul(Math.max(0, (state.time - state.stage.goalMin) / 60));
    return 1;
  }
  function endlessDmgMulOf(state) {
    if (state.endless && state.stage) return CU.endlessDmgMul(Math.max(0, (state.time - state.stage.goalMin) / 60));
    return 1;
  }

  // 敌人回血速率随时间成长,与 makeEnemy 的 maxHP 同因子(hpFactor × diff × endless)。
  // 用于血祭司光环/自愈者自回血,使其后期相对暴涨的敌血仍保持存在感。
  function healScaleOf(state) { const t = (state.time || 0) / 60; return CU.hpFactor(t) * diffOf(state).hpMul * CU.lateFactor(t, diffOf(state).lateHpMul) * endlessHpMulOf(state); }
  function healthDropLateFactor(state) {
    const t = (state.time || 0) / 60;
    return t <= 10 ? 1 : 1 / (1 + 0.15 * (t - 10));
  }
  function eliteHealthDropLateFactor(state) {
    const t = (state.time || 0) / 60;
    return t <= 10 ? 1 : 1 / (1 + 0.30 * (t - 10));
  }

  function makeEnemy(state, type, x, y) {
    const def = EN[type];
    const t = state.time / 60;
    const diff = diffOf(state);
    const hpEm = endlessHpMulOf(state), dmgEm = endlessDmgMulOf(state);
    const df = CU.dmgFactor(t);
    const hp = def.hp * CU.hpFactor(t) * diff.hpMul * CU.lateFactor(t, diff.lateHpMul) * hpEm;
    return {
      id: _id++, type: type, color: def.color, ai: def.ai,
      x: x, y: y, vx: 0, vy: 0,
      r: def.r, mass: def.ai === "tank" ? 6 : (type === "brute" ? 6 : 1),
      hp: hp, maxHp: hp,
      speed: def.speed * CU.speedFactor(t) * ((state.charMods && state.charMods.enemySpeedMul) || 1),
      // 自爆虫:接触不直接造成伤害,只在爆炸时造成 AOE
      dmg: type === "bomber" ? 0 : def.dmg * diff.dmgMul * dmgEm * df,
      boomDmg: type === "bomber" ? def.dmg * diff.dmgMul * dmgEm * df : 0,
      xp: Math.max(1, Math.round(def.xp * 1.5 * diff.xpMul / CU.earlySpawnFactor(t, state.difficulty))), projDmg: (def.projDmg || 0) * diff.dmgMul * df * dmgEm, aoe: def.aoe || 0,
      dr: def.dr || 0, regenRate: def.regenRate || 0,
      shape: def.shape || "circle", shimmer: !!def.shimmer,
      auraR: def.auraR || 0, auraDr: def.auraDr || 0, healRate: def.healRate || 0, auraSpeed: def.auraSpeed || 0,
      stealth: !!def.stealth, burstCount: def.burstCount || 0, burstType: def.burstType || "swarmer",
      trailInterval: def.trailInterval || 0, trailDur: def.trailDur || 0,
      trailDmg: (def.trailDmg || 0) * diff.dmgMul * df * dmgEm,
      revealed: false, _shieldedByAura: false, _shieldDr: 0, _speedBuff: 1, _speedBuffT: 0,
      flash: 0, slow: 0, slowF: 0, frozen: 0, bladeCd: 0,
      poison: 0, poisonDmg: 0, poisonTick: 0, poisonWid: "", poisonHexCut: 0,
      hex: 0, hexMax: 0, hexChild: false, hexDmg: 0, hexFrac: 0, hexSpread: 0, hexWid: "", hexPoisonDmg: 0, hexPoisonDur: 0, hexFuseCut: 0,
      sheep: 0, armorBreak: 0, sheepBomb: false, sheepBombDone: false, sheepBombMax: 0,
      sheepBombDmg: 0, sheepBombRadius: 0, sheepBombFreeze: 0, sheepBombWid: "",
      // ai 局部状态
      t1: 0, t2: 0, cstate: "walk", cdir: 0, ct: 0,
      isBoss: false
    };
  }

  function makeBoss(state, bossType, x, y) {
    const def = BOSSES[bossType];
    const t = state.time / 60;
    const diff = diffOf(state);
    const hpEm = endlessHpMulOf(state), dmgEm = endlessDmgMulOf(state);
    // Boss 用独立分档乘子(bossHpMul/bossDmgMul):整体上调且档差压缩,不随普通敌 dmgMul/hpMul
    const hp = def.hp * CU.bossHpFactor(t) * (diff.bossHpMul || diff.hpMul) * hpEm;
    return Object.assign(makeEnemy(state, "brute", x, y), {
      id: _id++, type: bossType, color: def.color, ai: "boss", shape: def.shape || "circle",
      r: def.r, mass: 40,
      hp: hp, maxHp: hp,
      speed: def.speed, dmg: def.dmg * (diff.bossDmgMul || diff.dmgMul) * dmgEm * CU.dmgFactor(t) * (def.tier === 3 ? C.T3_BOSS_DAMAGE_MUL : 1), xp: def.xp,
      bossType: bossType, isBoss: true, enrage: false,
      t1: U.rand(1, 3), t2: U.rand(2, 4), ct: 0, cdir: U.rand(0, U.TAU)
    });
  }

  function makeGem(x, y, value) {
    return { x: x, y: y, vx: 0, vy: 0, value: value, pulled: false, bob: U.rand(0, U.TAU) };
  }
  function makePickup(x, y, kind) { return { x: x, y: y, kind: kind, bob: U.rand(0, U.TAU), pulled: false }; }

  // 敌人可从场外入场；一旦碰撞圆完整进入竞技场，之后永久锁在边界内。
  // ghost 是奖励型逃逸目标，不受此约束。
  function enemyFullyInside(state, e) {
    if (!state || !state.stage || !e || e.type === "ghost") return false;
    const lim = state.stage.half - e.r;
    return lim >= 0 && Math.abs(e.x) <= lim && Math.abs(e.y) <= lim;
  }
  function canEnemyRanged(state, e) {
    if (e && e.type !== "ghost" && enemyFullyInside(state, e)) e._arenaEntered = true;
    return !!(e && e._arenaEntered);
  }
  function constrainEnemy(state, e, oldX, oldY) {
    if (!state || !state.stage || !e || e.type === "ghost") return;
    const lim = Math.max(0, state.stage.half - e.r);
    if (e._arenaEntered || enemyFullyInside(state, e)) {
      e._arenaEntered = true;
      e.x = U.clamp(e.x, -lim, lim); e.y = U.clamp(e.y, -lim, lim);
      return;
    }
    // 尚未完整入场时允许向内/沿边移动，但拒绝在场外继续远离。
    if (oldX != null && Math.abs(oldX) > lim && Math.abs(e.x) > Math.abs(oldX)) e.x = oldX;
    if (oldY != null && Math.abs(oldY) > lim && Math.abs(e.y) > Math.abs(oldY)) e.y = oldY;
    if (enemyFullyInside(state, e)) e._arenaEntered = true;
  }

  // 受伤(玩家)
  function damagePlayer(state, dmg, ignoreIframe, srcType, sustained) {
    const p = state.player;
    if (p.hp <= 0 || !(dmg > 0) || !Number.isFinite(dmg)) return false;
    if (!ignoreIframe && p.iframes > 0) return;
    if (!sustained && p.burstIframe > 0) return false;
    const m = mods(state);
    let armorMul = m.armorMul;
    const mech = characterMechanics(state);
    if (state.special === "bulwark") {
      // 站桩/缓行时大幅减伤,全速时回落到正常护甲
      const full = p.speed * m.speedMul;
      const norm = full > 0 ? Math.min(1, Math.hypot(p.vx, p.vy) / full) : 1;
      armorMul *= 1 - (1 - norm) * (mech.stationaryDr == null ? 0.55 : mech.stationaryDr);
    } else if (state.special === "berserker") {
      // 血怒：失血越多额外减伤越高，空血上限 40%。
      const miss = p.maxHp > 0 ? 1 - p.hp / p.maxHp : 0;
      if (miss > 0) armorMul *= 1 - miss * (mech.maxDamageReduction == null ? 0.4 : mech.maxDamageReduction);
    }
    if (state.special === "overclocker" && state.overclockActive) armorMul *= mech.incomingMul || 1.25;
    const real = dmg * armorMul;
    p.hp -= real;
    if (!sustained) p.burstIframe = diffOf(state).burstIframe;
    // 按敌人类型累计对玩家造成的伤害(图鉴"对玩家伤害"用)。srcType 为来源敌人 type/bossType
    if (srcType && state.enemyDamage) {
      state.enemyDamage[srcType] = (state.enemyDamage[srcType] || 0) + real;
    }
    if (!ignoreIframe) p.iframes = C.IFRAME;
    p.flash = 0.18;
    SV.Audio.hurt();
    SV.Effects.shake(Math.min(9, 3 + dmg * 0.2), 0.25);
    SV.Effects.text(p.x, p.y - p.r - 6, "-" + Math.round(real), SV.Config.COLORS.hp);
    if (p.hp <= 0) { p.hp = 0; SV.Game.onPlayerDeath(); }
    return true;
  }

  function healPlayer(state, amount, showText) {
    const p = state.player;
    if (!p || !(amount > 0) || p.hp >= p.maxHp) return 0;
    const mul = (state.charMods && state.charMods.healingMul != null) ? state.charMods.healingMul : 1;
    const real = Math.min(p.maxHp - p.hp, amount * mul);
    if (real <= 0) return 0;
    p.hp += real;
    if (showText) SV.Effects.text(p.x, p.y - p.r - 6, "+" + Math.round(real), "#7CFFB2");
    return real;
  }

  // 角色动态伤害乘子(每击现算,绝不写回 _mods)。
  function charDamageScale(state, e) {
    const sp = state.special;
    if (!sp || !e || e.maxHp <= 0) return 1;
    switch (sp) {
      case "assassin": {
        const mech = characterMechanics(state), ratio = e.hp / e.maxHp;
        if (ratio < (mech.lowHp == null ? 0.3 : mech.lowHp)) return mech.lowMul || 2;
        if (ratio > (mech.highHp == null ? 0.7 : mech.highHp)) return mech.highMul || 0.85;
        return 1;
      }
      case "berserker": {
        // 血怒：满血 ×0.9，随失血线性上升至空血 ×2。
        const p = state.player;
        const mech = characterMechanics(state);
        const full = mech.fullDamageMul == null ? 0.9 : mech.fullDamageMul;
        const empty = mech.emptyDamageMul == null ? 2 : mech.emptyDamageMul;
        if (p && p.maxHp > 0) return full + (1 - p.hp / p.maxHp) * (empty - full);
        return 1;
      }
      default: return 1;
    }
  }
  function burstSpecial(state, x, y, radius, damage, color, skillId) {
    const near = SV.Spatial.queryCircle(x, y, radius + 55);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp > 0 && U.dist2(x, y, e.x, e.y) <= (radius + e.r) * (radius + e.r)) damageEnemy(state, e, damage, { text: false, skill: skillId });
    }
    SV.Effects.ring(x, y, color, 8, radius, 0.32, 3);
    SV.Effects.explosion(x, y, color, 12);
  }

  function fireCollector(state) {
    const p = state.player, m = mods(state), mech = characterMechanics(state);
    const max = mech.maxCrystals || 6, crystals = Math.min(max, state.collectorCrystals || 0);
    if (!crystals) return;
    const targets = state.enemies.filter(function (e) { return e.hp > 0; }).sort(function (a, b) { return U.dist2(p.x, p.y, a.x, a.y) - U.dist2(p.x, p.y, b.x, b.y); });
    if (!targets.length) return;
    const n = Math.min(crystals, targets.length);
    const radius = (mech.radius || 28) * m.areaMul;
    const damage = ((mech.damageBase == null ? 10 : mech.damageBase) + (mech.damagePerLevel == null ? 0.9 : mech.damagePerLevel) * collectorSkillLevel(state.level, mech.levelSoftcap || 15)) * m.damageMul;
    for (let i = 0; i < crystals; i++) {
      const t = targets[i % n];
      if (t) burstSpecial(state, t.x, t.y, radius, damage, "#ffd86b", "collector");
    }
    state.collectorCrystals = 0;
  }

  function gainXP(state, amount) {
    if (!(amount > 0)) return;
    state.xp += amount;
    if (state.special === "collector") {
      const mech = characterMechanics(state), per = mech.xpPerCrystal || 13, max = mech.maxCrystals || 6;
      if (state.collectorCrystals == null) state.collectorCrystals = 0;
      state.collectorXp = (state.collectorXp || 0) + amount;
      while (state.collectorXp >= per) {
        if (state.collectorCrystals >= max) { fireCollector(state); if (state.collectorCrystals >= max) break; }
        state.collectorXp -= per; state.collectorCrystals++;
        if (state.collectorCrystals >= max) fireCollector(state);
      }
    }
    SV.Game.onXP();
  }

  // 角色状态在武器更新前统一推进，使过载窗口对所有攻击时间源一致。
  function charTick(state, dt) {
    const sp = state.special;
    if (!sp) return;
    const mech = characterMechanics(state);
    switch (sp) {
      case "collector": if (state.collectorCrystals >= (mech.maxCrystals || 6)) fireCollector(state); break;
      case "bulwark": {
        // 站定周期纯击退，无伤害。
        const p = state.player; const m = mods(state);
        const full = p.speed * m.speedMul;
        const norm = full > 0 ? Math.min(1, Math.hypot(p.vx, p.vy) / full) : 1;
        p.bulwarkCd -= dt;
        if (norm < 0.25 && p.bulwarkCd <= 0) {
          p.bulwarkCd = (mech.interval || 2.5) * m.cdMul;
          const R = (mech.radius || 95) * m.areaMul;
          const near = SV.Spatial.queryCircle(p.x, p.y, R + 55);
          for (let i = 0; i < near.length; i++) {
            const e = near[i];
            if (e.hp <= 0 || U.dist2(p.x, p.y, e.x, e.y) > (R + e.r) * (R + e.r)) continue;
            const a = U.angleTo(p.x, p.y, e.x, e.y), kb = (mech.knock || 95) / Math.max(1, e.mass || 1);
            e.x += Math.cos(a) * kb; e.y += Math.sin(a) * kb;
          }
          SV.Effects.ring(p.x, p.y, "#aab4ff", 10, R, 0.4, 4);
          SV.Effects.shake(4, 0.2);
        }
        break;
      }
      case "lingerer": {
        const m = mods(state), interval = (mech.interval || 9) * (1 - (1 - m.cdMul) * (mech.cooldownEfficiency == null ? 0.5 : mech.cooldownEfficiency));
        state.timeFractureClock = (state.timeFractureClock == null ? interval : state.timeFractureClock) - dt;
        if (state.timeFractureActive > 0) state.timeFractureActive = Math.max(0, state.timeFractureActive - dt);
        if (state.timeFractureClock <= 0) { state.timeFractureClock += interval; state.timeFractureActive = mech.duration || 2; SV.Effects.ring(state.player.x, state.player.y, "#9be7ff", 20, 180, 0.45, 4); }
        break;
      }
      case "overclocker": {
        state.overclockClock = (state.overclockClock == null ? (mech.interval || 8) : state.overclockClock) - dt;
        if (state.overclockActive > 0) state.overclockActive = Math.max(0, state.overclockActive - dt);
        if (state.overclockClock <= 0) { state.overclockClock += mech.interval || 8; state.overclockActive = mech.duration || 2.5; SV.Effects.ring(state.player.x, state.player.y, "#ffb25a", 12, 105, 0.35, 3); }
        break;
      }
      case "phantom": {
        const ghosts = state.afterimages || (state.afterimages = []), m = mods(state);
        for (let i = ghosts.length - 1; i >= 0; i--) {
          ghosts[i].delay -= dt;
          if (ghosts[i].delay <= 0) {
            const radius = (mech.radius || 70) * m.areaMul;
            const damage = ((mech.damageBase == null ? 14 : mech.damageBase) + (mech.damagePerLevel == null ? 0.7 : mech.damagePerLevel) * Math.max(0, state.level || 0)) * m.damageMul;
            burstSpecial(state, ghosts[i].x, ghosts[i].y, radius, damage, "#73dcff", "phantom"); ghosts.splice(i, 1);
          }
        }
        break;
      }
      default: break;
    }
  }

  // 受伤(敌人)。opts:{text,vuln,nocrit}
  function damageEnemy(state, e, dmg, opts) {
    opts = opts || {};
    if (e.stealth && !e.revealed) { // 潜伏者:首击破隐免疫
      e.revealed = true; e.flash = 0.3;
      SV.Effects.hit(e.x, e.y, e.color);
      SV.Effects.text(e.x, e.y - e.r - 4, L("REVEALED!", "破隐!"), "#a8e8ff", 14);
      return;
    }
    if (opts.vuln) dmg *= opts.vuln;
    const armorCap = 0.70 * CU.lateFactor(state.time / 60, diffOf(state).wardCap / 0.70);
    // Normal armor uses the same cap even outside an aura: entering a shield cannot make a troop weaker.
    let reduction = e.isBoss ? (e.dr || 0) : Math.min(armorCap, e.dr || 0);
    if (e._shieldedByAura) {
      const cap = e.isBoss ? Math.max(armorCap, reduction) : armorCap;
      reduction = Math.min(cap, 1 - (1 - reduction) * (1 - (e._shieldDr || 0)));
    }
    dmg *= 1 - reduction;
    // 暴击 + 吸血(玩家伤害)
    let real = dmg, isCrit = false;
    const p = state.player;
    if (!opts.nocrit) {
      const m = mods(state);
      if (m.critChance > 0 && U.chance(m.critChance)) { real *= 2; isCrit = true; }
      // 吸血:基于暴击前伤害(dmg),受每秒上限约束
      if (m.lifesteal > 0 && p.hp < p.maxHp) {
        const cap = m.lifesteal * m.maxHp;
        const allowed = Math.max(0, cap - (p.lsWindow || 0));
        const heal = Math.min(dmg * m.lifesteal, allowed);
        if (heal > 0) {
          const got = healPlayer(state, heal, false);
          p.lsWindow = (p.lsWindow || 0) + got;
          if (got > 0 && U.chance(0.10)) SV.Effects.text(p.x, p.y - p.r - 6, "+" + Math.round(got), "#7CFFB2");
        }
      }
    }
    real *= charDamageScale(state, e); // 角色动态伤害(处决/血怒),每击现算
    e.hp -= real;
    // 按武器累计伤害(图鉴/结算"每武器伤害"用)。opts.wid 为来源武器 id,归一到 canonical 桶
    if (opts.wid && state.weaponDamage) {
      const k = tid(opts.wid);
      state.weaponDamage[k] = (state.weaponDamage[k] || 0) + real;
      // 以该武器累计活跃时间为时钟。时间戳令跨秒/环绕时旧槽可被可靠清空。
      state.weaponRecent = state.weaponRecent || {};
      const sec = Math.floor((state.weaponActive && state.weaponActive[k]) || 0);
      const recent = state.weaponRecent[k] || (state.weaponRecent[k] = { slots: new Array(60).fill(0), stamps: new Array(60).fill(-1) });
      const slot = sec % 60;
      if (recent.stamps[slot] !== sec) { recent.stamps[slot] = sec; recent.slots[slot] = 0; }
      recent.slots[slot] += real;
    }
    if (opts.skill && state.skillDamage) state.skillDamage[opts.skill] = (state.skillDamage[opts.skill] || 0) + real;
    e.flash = 0.12;
    if (opts.text !== false && (e.isBoss || real >= 8 || U.chance(0.5) || isCrit)) {
      SV.Effects.text(e.x, e.y - e.r - 4, (isCrit ? L("CRIT ", "暴") : "") + Math.round(real), isCrit ? "#ffd86b" : "#ffe9c2", isCrit ? 18 : 14);
    }
  }

  function weaponRecentDamage(state, wid) {
    const k = tid(wid);
    const active = (state.weaponActive && state.weaponActive[k]) || 0;
    if (active < 60) return null;
    const recent = state.weaponRecent && state.weaponRecent[k];
    if (!recent) return 0;
    const sec = Math.floor(active), oldest = sec - 59;
    let total = 0;
    for (let i = 0; i < 60; i++) if (recent.stamps[i] >= oldest && recent.stamps[i] <= sec) total += recent.slots[i] || 0;
    return total;
  }

  // 诅咒引爆:对 e 结算 固定伤害+百分比maxHp 伤害(可选,引信到期 e 还活着时) + 向周围蔓延 + 视觉;清印记
  function hexDetonate(state, e, damageToo) {
    // 百分比项对 Boss ×1/5；子印记的全部载荷已在传播时减半。
    const frac = (e.hexFrac || 0) * (e.isBoss ? 1 / 5 : 1);
    const dmg = (e.hexDmg || 0) + e.maxHp * frac;
    if (damageToo) {
      damageEnemy(state, e, dmg, { text: false, wid: e.hexWid });
      SV.Effects.text(e.x, e.y - e.r - 4, Math.round(dmg), "#d0a0ff", 14);
    }
    SV.Effects.explosion(e.x, e.y, "#b06bff", 14);
    const spread = e.hexSpread || 0;
    if (spread > 0) {
      const sn = SV.Spatial.queryCircle(e.x, e.y, 110);
      let s = 0;
      for (let j = 0; j < sn.length && s < spread; j++) {
        const o = sn[j];
        if (o !== e && o.hp > 0 && !(o.hex > 0)) {
          o.hex = 0.8; o.hexMax = 0.8; o.hexChild = true; o.hexDmg = e.hexDmg * 0.5; o.hexFrac = e.hexFrac * 0.5; o.hexSpread = 0; o.hexWid = e.hexWid;
          if (e.hexEchoDmg > 0) {
            damageEnemy(state, o, e.hexEchoDmg * 0.5, { text: false, wid: e.hexWid });
            o.hexEchoDmg = e.hexEchoDmg * 0.5;
            SV.Effects.text(o.x, o.y - o.r - 6, L("MOON", "月"), "#ba8cff", 13);
          }
          // 腐朽天灾的爆炸传播同时带毒;传播印记的 spread=0,不会继续扩散。
          if (e.hexPoisonDmg > 0) {
            o.poisonStacks = Math.min(3, (o.poisonStacks || 0) + 1); o.poison = e.hexPoisonDur;
            o.poisonDmg = e.hexPoisonDmg * 0.5 * (1 + 0.4 * (o.poisonStacks - 1)); o.poisonTick = 0; o.poisonWid = e.hexWid;
            o.poisonHexCut = e.hexFuseCut || 0; o.hexPoisonDmg = e.hexPoisonDmg * 0.5; o.hexPoisonDur = e.hexPoisonDur; o.hexFuseCut = e.hexFuseCut;
          }
          s++;
        }
      }
    }
    e.hex = 0; e.hexMax = 0; e.hexChild = false; e.hexDmg = 0; e.hexFrac = 0; e.hexSpread = 0; e.hexWid = ""; e.hexPoisonDmg = 0; e.hexPoisonDur = 0; e.hexFuseCut = 0; e.hexEchoDmg = 0;
  }

  // 时之诅咒:变羊自然结束或宿主提前死亡时仅爆炸一次。控制时长对 Boss 继续套 CC_BOSS_MUL。
  function sheepBombExplode(state, e) {
    if (!e.sheepBomb || e.sheepBombDone) return;
    e.sheepBombDone = true; e.sheepBomb = false;
    const radius = e.sheepBombRadius || 90;
    const near = SV.Spatial.queryCircle(e.x, e.y, radius);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o.hp <= 0 || U.dist2(e.x, e.y, o.x, o.y) > radius * radius) continue;
      let vuln = o.frozen > 0 ? 1.5 : (o.sheep > 0 ? 1.3 : 1);
      if (o.armorBreak > 0) vuln += 0.5;
      damageEnemy(state, o, e.sheepBombDmg, { text: false, wid: e.sheepBombWid, vuln: vuln });
      const freeze = o.isBoss ? e.sheepBombFreeze * C.CC_BOSS_MUL : e.sheepBombFreeze;
      o.frozen = Math.max(o.frozen || 0, freeze);
    }
    if (e.sheepBombSpreadChance > 0 && Math.random() < e.sheepBombSpreadChance) {
      for (let i = 0; i < near.length; i++) {
        const o = near[i];
        if (o !== e && !o.isBoss && o.hp > 0 && o.sheep <= 0) { o.sheep = e.sheepBombSpreadDur; break; }
      }
    }
    SV.Effects.explosion(e.x, e.y, "#d6b3ff", 20);
    SV.Effects.ring(e.x, e.y, "#d6b3ff", 8, radius, 0.35, 4);
    SV.Effects.shake(4, 0.2);
  }

  // 击杀结算
  function killEnemy(state, e) {
    if (e.sheepBomb && !e.sheepBombDone) sheepBombExplode(state, e);
    if (e.hex > 0) hexDetonate(state, e, false); // 被提前击杀:诅咒立刻蔓延(不被抢杀浪费)
    SV.Effects.death(e.x, e.y, e.color);
    SV.Audio.die(!!e.isBoss);
    state.kills++;
    // 经验宝石
    if (e.isBoss) {
      // 单 Boss/多体 Boss/周期 Boss 波均只由组内最后死亡者掉宝箱与宝石。
      let dropReward = true;
      const rewardGroup = e.lootGroup || e.gid;
      if (rewardGroup) {
        let mateAlive = !!(e.lootGroup && (state.pendingBosses || []).some(function (b) { return b.lootGroup === e.lootGroup; }));
        for (let i = 0; i < state.enemies.length; i++) {
          const o = state.enemies[i];
          const sameGroup = e.lootGroup ? o.lootGroup === e.lootGroup : (!o.lootGroup && o.gid === e.gid);
          if (o !== e && o.isBoss && sameGroup && o.hp > 0) { mateAlive = true; break; }
        }
        if (!state._bossLoot) state._bossLoot = {};
        const rewardKey = (e.lootGroup ? "wave:" : "multi:") + rewardGroup;
        dropReward = !mateAlive && !state._bossLoot[rewardKey];
        if (dropReward) state._bossLoot[rewardKey] = true;
      }
      const periodic = e.bossSource === "late" || e.bossSource === "endless";
      if (dropReward) {
        for (let i = 0; i < 8; i++) { const a = U.rand(0, U.TAU), d = U.rand(10, 50); state.gems.push(makeGem(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, Math.max(1, Math.round(e.xp / 8)))); }
        if (!state.endless || periodic) state.pickups.push(makePickup(e.x, e.y, "treasure"));
      }
      // 周期 Boss 波中每个成员仅有衰减后的血包概率；剧情 Boss 的最终结算者仍必掉血包。
      if ((periodic && Math.random() < healthDropLateFactor(state)) || (!periodic && dropReward)) state.pickups.push(makePickup(e.x + 30, e.y, "health"));
      SV.Effects.shake(12, 0.5);
      if (e.bossType === "wraith") {
        state.bossFlags.wraithEnrage = true;
        for (let i = 0; i < state.enemies.length; i++) { const o = state.enemies[i]; if (o !== e && o.bossType === "wraith" && o.hp > 0) o.enrage = true; }
      }
      // 镜像双子:击杀其一 → 本体受 25% maxHp 伤害并狂暴(打镜像有风险收益权衡)
      if (e.bossType === "twins") {
        for (let i = 0; i < state.enemies.length; i++) {
          const o = state.enemies[i];
          if (o !== e && o.bossType === "twins" && o.hp > 0) {
            o.enrage = true;
            damageEnemy(state, o, o.maxHp * 0.25, { text: false, nocrit: true });
            SV.Effects.text(o.x, o.y - o.r - 8, L("MIRROR BACKLASH -25%", "镜像反噬 -25%"), "#ff5d73", 16);
          }
        }
      }
      state.bossFlags.count = Math.max(0, (state.bossFlags.count || 0) - 1);
    } else {
      // 精英:散落 3 颗高价值宝石 + 血包/磁铁 + 金色死亡特效。
      // 掉率基础 20%/10%(8min 精英刚出现时),此后随时间衰减(与普通掉落同 0.25/min 系数,自 8min 起算);
      // 受幸运提升;难度分档与普通掉落同用 dropMul(困难 0.6 / 噩梦 0.4)。
      if (e.elite) {
        for (let i = 0; i < 3; i++) state.gems.push(makeGem(e.x + U.rand(-14, 14), e.y + U.rand(-14, 14), Math.max(1, Math.round(e.xp / 3))));
        const luckF = 1 + mods(state).luck;
        const eDf = 1 / (1 + 0.25 * Math.max(0, state.time / 60 - 8));
        const eMul = diffOf(state).dropMul * (e.dropComp || 1);
        if (Math.random() < 0.20 * eMul * eDf * luckF * eliteHealthDropLateFactor(state)) state.pickups.push(makePickup(e.x, e.y, "health"));
        if (Math.random() < 0.10 * eMul * eDf * luckF) state.pickups.push(makePickup(e.x, e.y, "magnet"));
        SV.Effects.explosion(e.x, e.y, SV.Config.COLORS.gold, 22);
      } else {
        state.gems.push(makeGem(e.x, e.y, e.xp));
      }
      // 分裂者:死亡分裂 2 只食脑蛛
      if (e.type === "splitter") {
        for (let i = 0; i < 2; i++) { const a = U.rand(0, U.TAU); addEnemy(state, "swarmer", e.x + Math.cos(a) * 16, e.y + Math.sin(a) * 16); }
      }
      // 爆巢者:死亡爆出一群小怪
      if (e.type === "burster" && e.burstCount) {
        for (let i = 0; i < e.burstCount; i++) { const a = U.rand(0, U.TAU); addEnemy(state, e.burstType, e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18); }
        SV.Effects.explosion(e.x, e.y, e.color, 18);
      }
      // 自爆虫:死亡爆炸
      if (e.type === "bomber" && e.aoe) {
        SV.Effects.explosion(e.x, e.y, e.color, 22);
        if (U.dist(e.x, e.y, state.player.x, state.player.y) < e.aoe + state.player.r) damagePlayer(state, e.boomDmg || e.dmg, true, e.bossType || e.type);
        SV.Effects.shake(6, 0.2);
      }
      // 小概率掉落(精英另有上表,不再 roll)。概率随时间递减提高难度;难度越高概率越低。
      // 幸运提升特殊掉落率:基础已按 ÷1.5 下调,+50% 幸运时恰回到旧值(各难度 dropMul 天然分档)。
      if (!e.elite) {
        const diff = diffOf(state);
        const luckF = 1 + mods(state).luck;
        const df = diff.dropMul / (1 + 0.25 * (state.time / 60)) * luckF * (e.dropComp || 1);
        const r = Math.random(), hpP = 0.008 * df * healthDropLateFactor(state), magnetP = 0.00533 * df, bombP = 0.00134 * df;
        if (r < hpP) state.pickups.push(makePickup(e.x, e.y, "health"));
        else if (r < hpP + magnetP) state.pickups.push(makePickup(e.x, e.y, "magnet"));
        else if (r < hpP + magnetP + bombP) state.pickups.push(makePickup(e.x, e.y, "bomb"));
      }
    }
    if (state.gems.length > C.MAX_GEMS) state.gems.splice(0, state.gems.length - C.MAX_GEMS);
  }

  function addEnemy(state, type, x, y) {
    if (state.enemies.length >= C.MAX_ENEMIES) return null;
    const e = makeEnemy(state, type, x, y);
    state.enemies.push(e);
    if (state.encountered) { if (!(type in state.encountered.enemy)) state.encountered.enemy[type] = state.time; } // 图鉴(本局首次遇敌秒数)
    return e;
  }
  function addBoss(state, bossType, x, y) {
    const e = makeBoss(state, bossType, x, y);
    state.enemies.push(e);
    state.bossFlags.count = (state.bossFlags.count || 0) + 1;
    if (state.encountered) { if (!(bossType in state.encountered.boss)) state.encountered.boss[bossType] = state.time; } // 图鉴(本局)
    return e;
  }
  function addEShot(state, x, y, vx, vy, dmg, color, r, srcType) {
    if (state.eshots.length > 240) state.eshots.shift();
    const bd = srcType && BOSSES[srcType]; // Boss 弹幕:标记来源并携带专属风格(ring/bolt/rune),渲染层据此分支
    state.eshots.push({ x: x, y: y, vx: vx, vy: vy, life: 4.0, dmg: dmg, color: color || "#ff7d8e", r: r || 6, srcType: srcType || null, boss: !!bd, style: bd ? (bd.shotStyle || "ring") : null });
  }

  // 点到线段距离平方；连续毒径用胶囊碰撞，让可见路径与危险范围一致。
  function segmentDist2(px, py, a, b) {
    const dx=b.x-a.x,dy=b.y-a.y,dd=dx*dx+dy*dy;
    const t=dd>0?U.clamp(((px-a.x)*dx+(py-a.y)*dy)/dd,0,1):0;
    const x=a.x+dx*t,y=a.y+dy*t; return U.dist2(px,py,x,y);
  }

  // ── 玩家更新
  function updatePlayer(state, dt) {
    const p = state.player;
    const m = mods(state);
    const ax = SV.Input.axis.x, ay = SV.Input.axis.y;
    const moving = ax || ay;
    if (moving) p.facing = Math.atan2(ay, ax);
    const spd = p.speed * m.speedMul * (p.slow > 0 ? (1 - p.slowF) : 1);
    p.vx = ax * spd; p.vy = ay * spd;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (state.special === "phantom") {
      const mech = characterMechanics(state), step = mech.moveStep || 180, max = mech.maxAfterimages || 4, delay = mech.delay || 0.45;
      const moved = Math.hypot(p.x - p.phantomX, p.y - p.phantomY);
      p.phantomDist += moved; p.phantomX = p.x; p.phantomY = p.y;
      while (p.phantomDist >= step && state.afterimages.length < max) { p.phantomDist -= step; state.afterimages.push({ x: p.x, y: p.y, delay: delay, max: delay }); }
    }
    // 虚空引力:周期性把玩家朝随机方向牵引(边界夹取兜底,拉不出墙)
    if (state._voidPull > 0) {
      const env = state.stage && state.stage.envField;
      if (env && env.type === "gravity") {
        state._voidPull -= dt;
        const pa = state._voidPullDir || 0;
        p.x += Math.cos(pa) * env.pull * dt; p.y += Math.sin(pa) * env.pull * dt;
      }
    }
    // 竞技场边界夹取
    const half = (state.stage && state.stage.half) || 2000;
    if (p.x < -half) p.x = -half; else if (p.x > half) p.x = half;
    if (p.y < -half) p.y = -half; else if (p.y > half) p.y = half;

    if (p.iframes > 0) p.iframes -= dt;
    if ((p.eshotIframe || 0) > 0) p.eshotIframe -= dt;
    if ((p.burstIframe || 0) > 0) p.burstIframe = p.burstIframe - dt < 1e-9 ? 0 : p.burstIframe - dt;
    p.hazardTick = (p.hazardTick || 0) - dt < 1e-9 ? 0 : p.hazardTick - dt;
    if (p.slow > 0) p.slow -= dt;
    if (p.flash > 0) p.flash -= dt;
    // 吸血每秒上限的预算衰减
    if (p.lsWindow > 0) p.lsWindow = Math.max(0, p.lsWindow - m.maxHp * m.lifesteal * dt);

    // 再生
    if (m.regen > 0 && p.hp < p.maxHp) {
      p.regenAcc += dt;
      while (p.regenAcc >= 1) { p.regenAcc -= 1; healPlayer(state, m.regen, false); }
    }
    // 同步最大生命
    p.maxHp = m.maxHp;
    p.pickupRadius = C.PICKUP_RADIUS * m.pickupMul;

    // 危险区:地图灼烧/连续毒径(只伤玩家,带 warm 预警) + 陨石焦土 scorch(只伤敌人,无 warm)
    const hazards = state.hazards;
    let hazardHit = null;
    if (hazards && hazards.length) {
      // 全局 scorch tick:每 0.5s 同步触发一次,同一敌人在本 tick 内只受一个 scorch 影响(重叠区域不重复算伤害)
      if (state._scorchAccum == null) state._scorchAccum = 0;
      state._scorchAccum += dt;
      let scorchFire = false;
      if (state._scorchAccum >= 0.5) { state._scorchAccum -= 0.5; scorchFire = true; state._scorchTickId = (state._scorchTickId || 0) + 1; }
      for (let i = hazards.length - 1; i >= 0; i--) {
        const h = hazards[i];
        if (h.kind === "poisonTrail") {
          h.tick -= dt;
          const pts=h.points||[];
          for(let j=pts.length-1;j>=0;j--)pts[j].life-=dt;
          while(pts.length&&pts[0].life<=0)pts.shift();
          if(!pts.length){hazards.splice(i,1);continue;}
          h.x=pts[pts.length-1].x;h.y=pts[pts.length-1].y;
          if(h.tick<=0){
            const rr=p.r+h.r,rr2=rr*rr;let touching=U.dist2(p.x,p.y,pts[0].x,pts[0].y)<rr2;
            for(let j=1;j<pts.length&&!touching;j++)touching=segmentDist2(p.x,p.y,pts[j-1],pts[j])<rr2;
            if(touching && (!hazardHit || h.dmg > hazardHit.dmg)) hazardHit = h;
          }
          continue;
        }
        if (h.kind === "scorch") {                       // 陨石焦土:0.5s 灼烧范围内敌人(带 wid 计统计),不伤玩家;重叠去重
          h.life -= dt;
          if (h.life <= 0) { hazards.splice(i, 1); continue; }
          if (scorchFire) {
            const arr = SV.Spatial.queryCircle(h.x, h.y, h.r);
            for (let j = 0; j < arr.length; j++) {
              const en = arr[j];
              if (en.hp > 0 && en._scorchHit !== state._scorchTickId && U.dist2(h.x, h.y, en.x, en.y) < (h.r + en.r) * (h.r + en.r)) {
                en._scorchHit = state._scorchTickId;
                damageEnemy(state, en, h.dmg, { text: false, wid: h.wid });
              }
            }
          }
          continue;
        }
        if (h.warm > 0) { h.warm -= dt; continue; } // 预热期:仅提示位置,不伤害
        h.life -= dt; h.tick -= dt;
        if (h.life <= 0) { hazards.splice(i, 1); continue; }
        const rr = p.r + h.r;
        if (h.tick <= 0 && U.dist2(p.x, p.y, h.x, h.y) < rr * rr && (!hazardHit || h.dmg > hazardHit.dmg)) hazardHit = h;
      }
    }
    if (hazardHit && p.hazardTick <= 0) {
      damagePlayer(state, hazardHit.dmg, true, hazardHit.srcType || null, true);
      p.hazardTick = C.HAZARD_TICK;
    }

    // 宝石磁吸与拾取
    const pr2 = p.pickupRadius * p.pickupRadius;
    const pull = C.GEM_PULL_BASE * Math.max(1, m.pickupMul * 0.6);
    const gems = state.gems;
    const collectR = C.GEM_COLLECT_RADIUS;
    for (let i = gems.length - 1; i >= 0; i--) {
      const g = gems[i];
      const dx = p.x - g.x, dy = p.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < pr2) g.pulled = true;
      if (g.pulled) {
        const d = Math.sqrt(d2) || 1;
        // 保底速度恒快于玩家当前速度 35%+30,杜绝逃跑时经验球卡在拾取圈外死区
        const f = Math.max(spd * 1.35 + 30, Math.min(pull, d * C.GEM_PULL_NEAR_K));
        g.x += dx / d * f * dt; g.y += dy / d * f * dt;
      }
      if (d2 < collectR * collectR) {
        gainXP(state, g.value * m.xpMul);
        gems.splice(i, 1);
        SV.Audio.pickup();
      }
    }
    // 掉落物拾取(pulled:被磁铁吸附的宝箱飞向玩家,速度保底快于玩家,不会永远追不上)
    const picks = state.pickups;
    for (let i = picks.length - 1; i >= 0; i--) {
      const pk = picks[i];
      const dx = p.x - pk.x, dy = p.y - pk.y;
      const d2 = dx * dx + dy * dy;
      const healthPull = pk.kind === "health" && p.hp < p.maxHp && d2 < C.HEALTH_PULL_RADIUS * C.HEALTH_PULL_RADIUS;
      if (pk.kind === "treasure" && d2 < pr2) pk.pulled = true;
      if (pk.pulled || healthPull) {
        const d = Math.hypot(dx, dy) || 1;
        const f = pk.kind === "treasure" ? Math.max(spd * 1.35 + 30, Math.min(pull, d * C.GEM_PULL_NEAR_K)) : Math.max(spd * 1.35 + 30, 340);
        pk.x += dx / d * f * dt; pk.y += dy / d * f * dt;
      }
      if (U.dist(p.x, p.y, pk.x, pk.y) < p.r + 12) {
        applyPickup(state, pk.kind);
        picks.splice(i, 1);
        SV.Audio.pickup();
      }
    }
  }

  function applyPickup(state, kind) {
    const p = state.player;
    const m = mods(state);
    if (kind === "health") { const got = healPlayer(state, p.maxHp * 0.3, false); SV.Effects.text(p.x, p.y - 20, "+" + Math.round(got), "#7CFFB2"); }
    else if (kind === "magnet") {
      for (let i = 0; i < state.gems.length; i++) state.gems[i].pulled = true;
      for (let i = 0; i < state.pickups.length; i++) if (state.pickups[i].kind === "treasure") state.pickups[i].pulled = true; // 连 Boss 宝箱一起吸过来
      SV.Effects.text(p.x, p.y - 20, L("MAGNET!", "磁吸!"), SV.Config.COLORS.gold);
    }
    else if (kind === "treasure") { gainXP(state, C.TREASURE_XP * m.xpMul); SV.Effects.text(p.x, p.y - 20, L("CHEST!", "宝箱!"), SV.Config.COLORS.gold); }
    else if (kind === "bomb") {
      SV.Effects.shake(10, 0.4);
      for (let i = 0; i < state.enemies.length; i++) { const e = state.enemies[i]; if (!e.isBoss) { damageEnemy(state, e, e.maxHp, { text: false }); } }
      SV.Effects.text(p.x, p.y - 20, L("PURGE!", "清场!"), "#ff5d73");
    }
  }

  // ── 敌人更新(最热路径)。空间网格由 game.step 每帧先调用 rebuildGrid 构建,此处仅查询。
  function rebuildGrid(state) {
    const Sp = SV.Spatial;
    Sp.clear();
    const enemies = state.enemies;
    for (let i = 0; i < enemies.length; i++) Sp.insert(enemies[i]);
  }

  // 光环(护盾/回血/加速)节流施加:每 0.3s,先清护盾标记再让光环敌人 queryCircle 给邻居施 buff。
  // speed buff 用 0.4s 衰减窗覆盖 0.3s 重算间隙,无抖动。
  // 血祭司不治疗自己与同类(o.type !== e.type);盾卫减伤/狂热者光环半径按全局时间成长(曲线在 CURVES)。
  function tickAuras(state, dt) {
    state._auraTick = (state._auraTick || 0) - dt;
    if (state._auraTick > 0) return;
    state._auraTick = 0.3;
    const Sp = SV.Spatial, enemies = state.enemies;
    const healScale = healScaleOf(state); // 血祭司回血随时间成长(同敌人 maxHP 因子)
    const at = (state.time || 0) / 60;
    for (let i = 0; i < enemies.length; i++) { enemies[i]._shieldedByAura = false; enemies[i]._auraHeal = 0; }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp <= 0) continue;
      if (!(e.auraDr || e.healRate || e.auraSpeed)) continue;
      if (e.auraDr) e.auraDr = Math.min(CU.wardenDr(at), 0.70 * CU.lateFactor(at, diffOf(state).wardCap / 0.70));
      if (e.auraSpeed) e.auraR = CU.overdriveR(at); // 狂热者光环范围随时间扩大
      if (e.healRate) e.healRate = CU.priestHeal(at); // 血祭司治疗率随时间回升(前期弱、后期还原)
      const q = Sp.queryCircle(e.x, e.y, e.auraR);
      for (let j = 0; j < q.length; j++) {
        const o = q[j];
        if (o === e || o.hp <= 0) continue;
        if (e.auraDr) { o._shieldedByAura = true; o._shieldDr = e.auraDr; }
        if (e.healRate && o.type !== e.type) o._auraHeal = Math.max(o._auraHeal, e.healRate);
        if (e.auraSpeed) { o._speedBuff = e.auraSpeed; o._speedBuffT = 0.4; }
      }
    }
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.hp > 0 && e._auraHeal > 0) e.hp = Math.min(e.maxHp, e.hp + e._auraHeal * healScale * 0.3);
    }
  }

  function updateEnemies(state, dt) {
    const Sp = SV.Spatial;
    const AI = SV.AI;
    const enemies = state.enemies;
    const p = state.player;
    tickAuras(state, dt); // 光环(护盾/回血/加速)节流施加

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (e.type === "ghost" && state.stage && (Math.abs(e.x) > state.stage.half || Math.abs(e.y) > state.stage.half)) { e._arenaEscaped = true; continue; }
      constrainEnemy(state, e); // 收拢武器/角色等上一阶段产生的后置位移
      if (e.flash > 0) e.flash -= dt;
      if (e.slow > 0) e.slow -= dt;
      if (e.frozen > 0) e.frozen -= dt;
      if (e.sheep > 0) e.sheep -= dt;
      if (e.sheepBomb && !e.sheepBombDone && e.sheep <= 0) sheepBombExplode(state, e);
      if (e.armorBreak > 0) e.armorBreak -= dt;
      if (e.bladeCd > 0) e.bladeCd -= dt;
      if (e._judgeLock > 0) e._judgeLock -= dt;
      if (e._resonanceT > 0) e._resonanceT -= dt;
      if (e._resonanceLock > 0) e._resonanceLock -= dt;
      if (e._corrodeT > 0) e._corrodeT -= dt; else e._corrode = 0;

      // 剧毒 DoT(毒尽则叠层清零)
      if (e.poison > 0) {
        e.poison -= dt; e.poisonTick -= dt;
        if (e.poisonTick <= 0) {
          e.poisonTick = 0.5; damageEnemy(state, e, e.poisonDmg, { text: false, wid: e.poisonWid });
          if (e.poisonHexCut > 0 && e.hex > 0 && e.poisonWid === e.hexWid) {
            e.hex -= e.poisonHexCut;
            if (e.hex <= 0) hexDetonate(state, e, true);
          }
        }
      } else if (e.poisonStacks) {
        e.poisonStacks = 0; e.poisonHexCut = 0;
      }

      // 诅咒:倒计时引爆 %+maxHp + 向周围蔓延(对群友好)
      if (e.hex > 0) {
        e.hex -= dt;
        if (e.hex <= 0) hexDetonate(state, e, true);
      }

      const fractureMech = characterMechanics(state);
      const fracture = state.timeFractureActive > 0 ? (e.isBoss ? (fractureMech.bossScale || 0.70) : (fractureMech.normalScale || 0.35)) : 1;
      // 断层同比减慢 AI 行动计时与移动，不缩短 DoT/控制持续时间。
      const oldX = e.x, oldY = e.y;
      AI.update(state, e, dt * fracture);

      // 积分(受减速/冰冻影响)
      let k = 1;
      if (e.frozen > 0) k = 0;
      else if (e.slow > 0) k = 1 - e.slowF;
      if (e._speedBuffT > 0) e._speedBuffT -= dt; else e._speedBuff = 1;
      const sb = e._speedBuff || 1;
      e.x += e.vx * k * sb * dt * fracture;
      e.y += e.vy * k * sb * dt * fracture;
      constrainEnemy(state, e, oldX, oldY);
    }

    // 玩家接触判定
    if (p.iframes <= 0) {
      const near = Sp.queryCircle(p.x, p.y, p.r + 44);
      for (let i = 0; i < near.length; i++) {
        const e = near[i];
        // 变羊:无接触伤害(随机游走不伤人);冻结敌不动不射弹,但接触伤害保留(与变羊区分)
        if (e.dmg <= 0 || e.sheep > 0) continue;
        const rr = p.r + e.r;
        if (U.dist2(p.x, p.y, e.x, e.y) < rr * rr) {
          damagePlayer(state, e.dmg, false, e.bossType || e.type);
          // 击退敌人
          const a = U.angleTo(p.x, p.y, e.x, e.y);
          const kb = 90 / e.mass;
          e.x += Math.cos(a) * kb; e.y += Math.sin(a) * kb;
          constrainEnemy(state, e);
          if (p.iframes > 0) break;
        }
      }
    }

    // 敌方投射物
    const es = state.eshots;
    for (let i = es.length - 1; i >= 0; i--) {
      const s = es[i];
      const fractureMech = characterMechanics(state);
      const fracture = state.timeFractureActive > 0 ? (s.boss ? (fractureMech.bossScale || 0.70) : (fractureMech.normalScale || 0.35)) : 1;
      s.x += s.vx * dt * fracture; s.y += s.vy * dt * fracture; s.life -= dt * fracture;
      const rr = s.r + p.r;
      if (U.dist2(s.x, s.y, p.x, p.y) < rr * rr) {
        if (!(p.eshotIframe > 0)) { damagePlayer(state, s.dmg, true, s.srcType || null); p.eshotIframe = C.ESHOT_IFRAME; }
        es.splice(i, 1); continue;
      }
      if (s.life <= 0) es.splice(i, 1);
    }

    // 压缩 + 死亡结算。ghost 中心越界视为逃脱，不触发经验、掉落、击杀或死亡效果。
    const half = (state.stage && state.stage.half) || 2000;
    let w = 0;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      const escapedGhost = e.type === "ghost" && e.hp > 0 && (e._arenaEscaped || Math.abs(e.x) > half || Math.abs(e.y) > half);
      if (e.hp > 0 && !escapedGhost) {
        if (w !== i) enemies[w] = e;
        w++;
      } else {
        if (e.hp <= 0) killEnemy(state, e);
      }
    }
    enemies.length = w;
  }

  // 关卡环境机制(灼烧/冰冻/引力),周期触发,随时间增强。game.step 在 updateEnemies 后调用。
  function envTick(state, dt) {
    const env = state.stage && state.stage.envField;
    if (!env) return;
    state.envTimer -= dt;
    if (state.envTimer > 0) return;
    state.envTimer = env.interval;
    const p = state.player;
    const half = (state.stage && state.stage.half) || 2000;
    const t = state.time / 60;
    if (env.type === "burn") {
      // 灼烧区数量随时间增多(每 3min +1),上限由 MAX_HAZARDS 兜底
      const nz = Math.min(C.MAX_HAZARDS - state.hazards.length, 1 + Math.floor(t / 3));
      const burnDmg = env.dps * 0.5 * CU.dmgFactor(t);
      const mkBurn = (hx, hy) => state.hazards.push({ x: hx, y: hy, r: env.r, dmg: burnDmg, life: env.dur, max: env.dur, color: "#ff4f91", kind: "burn", tick: 0.5, warm: env.warm || 0 });
      // 采样矩形:优先视口(世界坐标,留 env.r 内边距),沙箱/视口无效时回退玩家周围固定矩形
      let minX = p.x - 560, minY = p.y - 360, maxX = p.x + 560, maxY = p.y + 360;
      try {
        const cam = SV.Renderer.cam, sz = SV.Renderer.cssSize();
        const vw = sz.w / 2 / cam.zoom, vh = sz.h / 2 / cam.zoom;
        if (vw > env.r && vh > env.r) {
          minX = cam.x - vw + env.r; maxX = cam.x + vw - env.r;
          minY = cam.y - vh + env.r; maxY = cam.y + vh - env.r;
        }
      } catch (e) {}
      const rx = function () { return U.clamp(U.rand(minX, maxX), -half + env.r, half - env.r); };
      const ry = function () { return U.clamp(U.rand(minY, maxY), -half + env.r, half - env.r); };
      // 前 4 个完全随机但两两不重合(圆心距 ≥ 2r,拒绝采样,超次数后放弃允许重叠);之后完全随机允许重叠
      const first = Math.min(nz, 4);
      for (let z = 0; z < first; z++) {
        let hx = 0, hy = 0, ok = false;
        for (let tries = 0; tries < 12 && !ok; tries++) {
          hx = rx(); hy = ry(); ok = true;
          for (let j = state.hazards.length - 1; j >= 0 && (state.hazards[j].kind === "burn"); j--) {
            const h = state.hazards[j];
            if (U.dist2(hx, hy, h.x, h.y) < (2 * env.r) * (2 * env.r)) { ok = false; break; }
          }
        }
        mkBurn(hx, hy);
      }
      for (let z = first; z < nz; z++) mkBurn(rx(), ry());
      if (nz > 0) SV.HUD.toast(L("⚠ BURN ZONES!", "⚠ 灼烧区域!"));
    } else if (env.type === "freeze") {
      // 减速时长随时间增长,上限为触发间隔的 1/3(避免无限冰冻)
      p.slow = Math.min(env.interval / 3, env.dur * (1 + 0.5 * t)); p.slowF = env.slowF;
      state._envDebuffMax = p.slow; state._envDebuffPulse = 0.45;
      SV.HUD.toast(L("❄ FREEZING BLAST!", "❄ 冰冻冲击!"));
      SV.Effects.ring(p.x, p.y, "#a8f0ff", 10, 120, 0.4, 3);
    } else if (env.type === "gravity") {
      // 随机方向牵引,时长随时间增长,上限为触发间隔的 1/3
      state._voidPullDir = U.rand(0, U.TAU);
      state._voidPull = Math.min(env.interval / 3, env.dur * (1 + 0.5 * t));
      state._envDebuffMax = state._voidPull; state._envDebuffPulse = 0.45;
      SV.HUD.toast(L("⛓ GRAVITY PULL!", "⛓ 引力牵引!"));
    }
  }

  SV.Entities = {
    mods: mods,
    updateCharacterState: charTick,
    healPlayer: healPlayer,
    gainXP: gainXP,
    envTick: envTick,
    tickAuras: tickAuras,
    invalidateMods: invalidateMods,
    capDim: capDim,
    rootDim: rootDim,
    tid: tid,
    healScale: healScaleOf,
    healthDropLateFactor: healthDropLateFactor,
    eliteHealthDropLateFactor: eliteHealthDropLateFactor,
    previewEnemy: previewEnemy,
    previewBoss: previewBoss,
    enemyFullyInside: enemyFullyInside,
    canEnemyRanged: canEnemyRanged,
    constrainEnemy: constrainEnemy,
    makePlayer: makePlayer,
    makeEnemy: makeEnemy,
    makeBoss: makeBoss,
    makeGem: makeGem,
    makePickup: makePickup,
    reserveEntityId: function (nextId) { if (isFinite(nextId) && nextId > _id) _id = Math.floor(nextId); },
    addEnemy: addEnemy,
    addBoss: addBoss,
    addEShot: addEShot,
    damagePlayer: damagePlayer,
    damageEnemy: damageEnemy,
    weaponRecentDamage: weaponRecentDamage,
    killEnemy: killEnemy,
    rebuildGrid: rebuildGrid,
    updatePlayer: updatePlayer,
    updateEnemies: updateEnemies
  };
})();
