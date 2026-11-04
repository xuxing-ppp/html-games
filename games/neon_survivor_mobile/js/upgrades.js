// upgrades.js — SV.Upgrades: 升级三选一(稀有度加权,优先出进化)
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const C = SV.Config.CONST;
  const CFG = SV.Config;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  function ownedSet(state) {
    const s = {};
    for (let i = 0; i < state.weapons.length; i++) s[state.weapons[i].id] = true;
    return s;
  }

  // 计算某武器「从 from 升到 from+1」的具体收益文案(走 Weapons.stats,溢出递减期显示真实收益)
  function levelText(state, w) {
    const def = CFG.weaponDef(w.id);
    const from = w.level;
    const mk = function (lv) { return SV.Weapons.stats({ id: w.id, level: lv, cd: 0, angle: 0, evolved: !!w.evolved }, state); };
    const a = mk(from), b = mk(from + 1);
    const CL = CFG.STAT_LABEL, CN = CFG.COUNT_NOUN;
    const noun = CN[w.id] || CN[w.id.replace(/_evo$/, "")] || L("Count", "数量");
    const parts = []; let milestone = false;
    for (const k in b) {
      const av = a[k], bv = b[k];
      if (av === bv || typeof bv !== "number") continue;
      const d = bv - av;
      if (k === "count") { parts.push(noun + " +" + d); milestone = true; continue; }
      const tpl = CL[k];
      if (!tpl) continue;
      let n;
      if (k === "slow") n = Math.round(d * 100);
      else if (k === "cooldown" || k === "tick" || k === "fireCd") n = Math.round(-d * 100) / 100;
      else n = Math.abs(d) < 10 ? Math.round(d * 10) / 10 : Math.round(d); // 溢出递减期显示一位小数
      if (tpl.indexOf("{N}") >= 0 && n === 0) continue; // 跳过四舍五入为 0 的噪声字段
      parts.push(tpl.replace("{N}", n));
      if (k === "chains" || k === "tick" || k === "fireCd" || k === "beams") milestone = true;
    }
    if (!parts.length) {
      const dd = (b.damage || 0) - (a.damage || 0);
      if (Math.abs(dd) >= 0.05) parts.push(L("Damage +", "伤害 +") + (Math.abs(dd) < 1 ? Math.round(dd * 10) / 10 : Math.round(dd)));
    }
    return { text: parts.join(" · "), milestone: milestone };
  }

  // 多伤害来源武器的补充说明(暂停面板用):把每种伤害成分的数值分别说清楚
  function extraSummary(id, s) {
    if (SV.I18n && SV.I18n.getLanguage() === "en") return extraSummaryEn(id, s);
    const R = Math.round;
    const F10 = function (v) { return Math.round((v || 0) * 100) / 100; };
    const out = [];
    switch (id) {
      case "meteor_evo": case "meteor_chain":
        if (s.burn) out.push("焦土 " + R(s.burn) + "/0.5s×" + F10(s.burnDur) + "s");
        if (id === "meteor_chain") out.push("落地连锁×" + (s.chainHops || 0));
        break;
      case "lance":
        out.push("一次触碰受创一次");
        break;
      case "lance_evo":
        out.push("线上每0.1s受创(多次伤害)");
        break;
      case "lance_vortex":
        out.push("卷伤 " + R(s.damage) + "/0.2s · 环绕激光 " + R(s.beamDmg || 0) + "/" + F10(s.beamTick || 0.1) + "s");
        break;
      case "spear_evo":
        if (s.armorBreak) out.push("破甲 " + (Math.round(s.armorBreak * 10) / 10) + "s(受伤+50%,命中刷新)");
        break;
      case "missile_chain":
        out.push("命中闪电 " + R(s.damage * 0.6) + "/跳×" + (s.chainHops || 3));
        out.push("击杀追击 " + (s.chase || 0) + " 次");
        break;
      case "frost_poison":
        if (s.freeze) out.push("每敌第" + (s.freezeHits || 1) + "击冻结 " + F10(s.freeze) + "s(受伤+50%)");
        if (s.dot) out.push("命中上毒 " + R(s.dot) + "/0.5s×" + F10(s.dotDur) + "s");
        break;
      case "shotgun_grenade":
        if (s.splash) out.push("每颗命中溅射 " + R(s.damage * s.splashMul) + "(半径" + R(s.splash) + ")");
        break;
      case "grenade_evo":
        out.push("子爆 " + R(s.damage * 0.55) + "×" + (typeof s.cluster === "number" ? s.cluster : 2));
        break;
      case "railgun_evo": case "railgun_grenade":
        if (s.explode) out.push("贯穿爆 " + R(s.damage) + "·半径" + R(s.explode));
        if (id === "railgun_grenade") out.push("每次贯穿触发 · 首次分裂" + (s.cluster || 0) + "颗");
        break;
      case "detonate": case "detonate_evo": case "crescent_detonate":
        if (s.explodeDmg) out.push("命中殉爆 " + R(s.explodeDmg) + "(半径" + R(s.explodeR) + ",概率" + Math.round((s.explodeChance || 0) * 100) + "%)" + (s.chainHops ? " · 连爆" + s.chainHops + "跳" : ""));
        break;
      case "shockwave_frost":
        if (s.freeze) out.push("冻结 " + (Math.round(s.freeze * 10) / 10) + "s");
        if (s.shatter) out.push("再次命中碎裂50%伤害(半径" + R(s.shatter) + ")");
        break;
      case "polymorph_timestop":
        out.push("结束/死亡爆炸 " + R(s.bombDmg) + "(半径" + R(s.bombRadius) + ") · 冻结" + F10(s.freeze) + "s");
        break;
      case "timestop_evo":
        if (s.shatter) out.push("碎裂 " + R(s.damage * 0.5));
        if (s.freeze) out.push("落地冻结 " + (Math.round(s.freeze * 10) / 10) + "s");
        break;
      case "blade_aura":
        out.push("光刃 " + F10(s.damage) + "/" + F10(s.bladeTick) + "s");
        out.push("命中溅射 " + F10(s.splashDamage) + "(半径" + R(s.splash) + ")");
        out.push("圆盘 " + F10(s.auraDamage) + "/" + F10(s.auraTick) + "s(半径" + R(s.radius) + ")");
        out.push("吸力停止于刃轨道 " + Math.round(s.pullStopRatio * 100) + "%");
        break;
      case "crescent_evo":
        if (s.leaveTrail) out.push("弧地 " + R(s.damage * 0.25) + "/0.5s×1.2s · 70%–100%半径带");
        break;
      case "chain_evo":
        out.push("每跳伤害 ×1.1");
        break;
      case "hex_poison":
        out.push("毒 " + R(s.dot) + "/0.5s×" + (Math.round(s.dotDur * 10) / 10) + "s");
        out.push("每跳缩短引信 " + s.fuseCut + "s");
        out.push("引爆传播诅咒+毒");
        if (s.frac) out.push("引爆 +" + Math.round(s.frac * 100) + "%maxHp(Boss÷5) · 子印记伤害50%");
        break;
      case "hex": case "hex_evo":
        if (s.frac) out.push("引爆 +" + Math.round(s.frac * 100) + "%maxHp(Boss÷5) · 子印记伤害50%");
        if (s.delay) out.push("引信 " + F10(s.delay) + "s · 引爆传播最多" + (s.spread || 0) + "个");
        break;
      case "missile_evo": out.push("飞行时限内无限追击 · 伤害不衰减"); break;
      case "boomerang_evo": out.push("去返贯穿"); break;
      case "shotgun_evo": case "polymorph_evo": out.push("每弹穿透 " + (s.pierce || 0) + " 次"); break;
      case "sentry_evo": out.push("炮弹穿透 " + (s.pierce || 0) + " 次"); break;
      case "frost_evo": out.push("每敌第" + (s.freezeHits || 1) + "次命中冻结 " + (Math.round(s.freeze * 10) / 10) + "s(受伤+50%)"); break;
      case "poison_evo": out.push("持续 " + (Math.round(s.dotDur * 10) / 10) + "s · 传染并减速" + Math.round(s.slow * 100) + "%/" + (Math.round(s.slowDur * 10) / 10) + "s"); break;
      case "vortex_evo": out.push("卷伤每0.2s×" + (Math.round(s.life * 10) / 10) + "s · 吸力" + R(s.pull)); break;
      case "shockwave_evo": out.push("命中冻结 " + (Math.round(s.freeze * 10) / 10) + "s"); break;
      case "boomerang_sentry": out.push("每塔" + (Math.round(s.fireCd * 100) / 100) + "s发射 · 去返穿透" + (s.pierce || 0) + "次"); break;
      case "blade_evo": out.push("每把刀刃按实际接触造成伤害"); break;
      case "blade_boomerang": out.push("环刃轮流离阵追敌并返航 · 环触间隔" + F10(s.hitCd) + "s"); break;
      case "blade_frost": out.push("每敌第" + s.frostHits + "击冰爆" + R(s.burstDmg) + "(半径" + R(s.burstR) + ") · 冻结" + F10(s.freeze) + "s"); break;
      case "missile_aura": out.push("分头追踪 · 命中附着电浆核" + F10(s.coreLife) + "s · 半径" + R(s.coreR) + " · " + R(s.coreDmg) + "/" + F10(s.coreTick) + "s"); break;
      case "missile_railgun": out.push("制导 " + (Math.round(s.calibrate * 100) / 100) + "s 后高速无限贯穿"); break;
      case "chain_sentry": out.push("每塔" + F10(s.fireCd) + "s发射 · 电弹连跳" + s.chainHops + "次"); break;
      case "aura_poison": out.push("停留叠加腐蚀至" + s.maxStacks + "层 · 每层伤害+" + Math.round(s.stackMul * 100) + "%"); break;
      case "shotgun_shockwave": out.push(s.resonanceHits + "次命中触发共振爆" + R(s.burstDmg) + "(半径" + R(s.burstR) + ")"); break;
      case "shotgun_spear": out.push("贯刺点喷出" + s.pelletCount + "枚碎弹 · 每轮最多" + s.pelletCap + "枚"); break;
      case "boomerang_crescent": out.push("去返各命中一次 · 0.75s折返 · 外径"+s.minR+"→"+s.maxR+" · 残迹"+R(s.trailDmg)+"/"+F10(s.trailTick)+"s×"+F10(s.trailLife)+"s"); break;
      case "grenade_meteor": out.push("每轮" + s.count + "枚母弹 · 每枚母爆" + R(s.damage) + "后召来" + s.childCount + "颗小陨石×" + R(s.childDmg)); break;
      case "railgun_timestop": out.push("光轨伤" + R(s.damage) + " · 静滞走廊" + R(s.corridorDmg) + "/" + F10(s.corridorTick) + "s · 冻结" + F10(s.freeze) + "s"); break;
      case "vortex_meteor": out.push("卷伤" + R(s.damage) + "/0.2s · 沿途焦土" + R(s.burn) + "/0.5s"); break;
      case "vortex_detonate": out.push("消失爆炸" + R(s.boomBase) + "+每卷入1敌人" + R(s.boomPer) + " · 最多计" + s.captureMax + "个"); break;
      case "sentry_hex": out.push("2塔集火 + 3塔分散 · " + s.judgeHits + "击裁决" + R(s.judgeDmg) + "+" + Math.round(s.judgeFrac * 100) + "%maxHp(Boss÷5) · 锁定"+F10(s.judgeLock)+"s"); break;
      case "shockwave_polymorph": out.push("首波变羊" + F10(s.sheep) + "s · 再次冲击触发碰撞爆" + R(s.collideDmg)); break;
      case "hex_crescent": out.push("月牙刻印 · 引爆" + R(s.hexDmg) + "+" + Math.round(s.frac * 100) + "%maxHp并回斩传播"); break;
      case "detonate_polymorph": out.push("变羊结束/死亡爆炸" + R(s.bombDmg) + " · " + Math.round(s.spreadChance * 100) + "%扩散一次"); break;
      case "spear_timestop": out.push("原路径" + F10(s.echoDelay) + "s后重演" + R(s.echoDmg) + "伤害并冻结" + F10(s.freeze) + "s"); break;
      case "lance_chain": out.push("每束每" + F10(s.tick) + "s扫击 · 命中外跳" + s.chainHops + "次闪电"); break;
    }
    return out;
  }

  function extraSummaryEn(id, s) {
    const R=Math.round, F=function(v){return Math.round((v||0)*100)/100;}, out=[];
    switch(id){
      case "meteor_evo": case "meteor_chain": if(s.burn)out.push("Scorch "+R(s.burn)+"/0.5s×"+F(s.burnDur)+"s");if(id==="meteor_chain")out.push("Impact chains×"+(s.chainHops||0));break;
      case "lance":out.push("One hit per contact");break; case "lance_evo":out.push("Beam hits every 0.1s");break;
      case "lance_vortex":out.push("Vortex "+R(s.damage)+"/0.2s · Laser "+R(s.beamDmg||0)+"/"+F(s.beamTick||.1)+"s");break;
      case "spear_evo":if(s.armorBreak)out.push("Armor break "+F(s.armorBreak)+"s (+50% damage, refreshes)");break;
      case "missile_chain":out.push("Impact lightning "+R(s.damage*.6)+"/jump×"+(s.chainHops||3));out.push("Kill pursuit "+(s.chase||0));break;
      case "frost_poison":if(s.freeze)out.push("Every "+(s.freezeHits||1)+" hits freezes "+F(s.freeze)+"s (+50% damage)");if(s.dot)out.push("Poison "+R(s.dot)+"/0.5s×"+F(s.dotDur)+"s");break;
      case "shotgun_grenade":if(s.splash)out.push("Each hit splashes "+R(s.damage*s.splashMul)+" (radius "+R(s.splash)+")");break;
      case "grenade_evo":out.push("Sub-blast "+R(s.damage*.55)+"×"+(typeof s.cluster==="number"?s.cluster:2));break;
      case "railgun_evo":case "railgun_grenade":if(s.explode)out.push("Pierce blast "+R(s.damage)+" · radius "+R(s.explode));if(id==="railgun_grenade")out.push("Every pierce triggers; first splits "+(s.cluster||0));break;
      case "detonate":case "detonate_evo":case "crescent_detonate":if(s.explodeDmg)out.push("Detonation "+R(s.explodeDmg)+" (radius "+R(s.explodeR)+", "+Math.round((s.explodeChance||0)*100)+"%)"+(s.chainHops?" · "+s.chainHops+" chains":""));break;
      case "shockwave_frost":if(s.freeze)out.push("Freeze "+F(s.freeze)+"s");if(s.shatter)out.push("Re-hit shatters for 50% (radius "+R(s.shatter)+")");break;
      case "polymorph_timestop":out.push("End/death blast "+R(s.bombDmg)+" (radius "+R(s.bombRadius)+") · Freeze "+F(s.freeze)+"s");break;
      case "timestop_evo":if(s.shatter)out.push("Shatter "+R(s.damage*.5));if(s.freeze)out.push("Impact freeze "+F(s.freeze)+"s");break;
      case "blade_aura":out.push("Blade "+F(s.damage)+"/"+F(s.bladeTick)+"s");out.push("Hit splash "+F(s.splashDamage)+" (radius "+R(s.splash)+")");out.push("Disk "+F(s.auraDamage)+"/"+F(s.auraTick)+"s (radius "+R(s.radius)+")");out.push("Pull stops at "+Math.round(s.pullStopRatio*100)+"% of blade orbit");break;
      case "crescent_evo":if(s.leaveTrail)out.push("Arc field "+R(s.damage*.25)+"/0.5s×1.2s");break;
      case "chain_evo":out.push("Damage ×1.1 per jump");break;
      case "hex_poison":out.push("Poison "+R(s.dot)+"/0.5s×"+F(s.dotDur)+"s");out.push("Fuse -"+s.fuseCut+"s per jump");out.push("Blast spreads hex + poison");if(s.frac)out.push("Blast +"+Math.round(s.frac*100)+"% max HP (Boss ÷5)");break;
      case "hex":case "hex_evo":if(s.frac)out.push("Blast +"+Math.round(s.frac*100)+"% max HP (Boss ÷5)");if(s.delay)out.push("Fuse "+F(s.delay)+"s · spreads to "+(s.spread||0));break;
      case "missile_evo":out.push("Unlimited pursuit during lifetime · no decay");break; case "boomerang_evo":out.push("Pierces outbound and returning");break;
      case "shotgun_evo":case "polymorph_evo":out.push("Pierces "+(s.pierce||0)+" per shot");break;case "sentry_evo":out.push("Turret rounds pierce "+(s.pierce||0));break;
      case "frost_evo":out.push("Every "+(s.freezeHits||1)+" hits freezes "+F(s.freeze)+"s (+50% damage)");break;case "poison_evo":out.push(F(s.dotDur)+"s · spreads and slows "+Math.round(s.slow*100)+"%/"+F(s.slowDur)+"s");break;
      case "vortex_evo":out.push("Vortex damage every 0.2s×"+F(s.life)+"s · Pull "+R(s.pull));break;case "shockwave_evo":out.push("Hit freezes "+F(s.freeze)+"s");break;
      case "boomerang_sentry":out.push("Each turret fires every "+F(s.fireCd)+"s · pierce "+(s.pierce||0));break;case "blade_evo":out.push("Each blade deals damage on actual contact");break;
      case "blade_boomerang":out.push("Blades hunt and return in sequence · ring interval "+F(s.hitCd)+"s");break;case "blade_frost":out.push("Every "+s.frostHits+" hits: ice burst "+R(s.burstDmg)+" (radius "+R(s.burstR)+") · freeze "+F(s.freeze)+"s");break;
      case "missile_aura":out.push("Split tracking · attached plasma core "+F(s.coreLife)+"s · radius "+R(s.coreR)+" · "+R(s.coreDmg)+"/"+F(s.coreTick)+"s");break;case "missile_railgun":out.push("Guides for "+F(s.calibrate)+"s, then pierces infinitely");break;
      case "chain_sentry":out.push("Each turret fires every "+F(s.fireCd)+"s · "+s.chainHops+" jumps");break;case "aura_poison":out.push("Corrosion stacks to "+s.maxStacks+" · +"+Math.round(s.stackMul*100)+"% damage each");break;
      case "shotgun_shockwave":out.push(s.resonanceHits+" hits trigger "+R(s.burstDmg)+" resonance (radius "+R(s.burstR)+")");break;case "shotgun_spear":out.push(s.pelletCount+" fragments per pierce · max "+s.pelletCap+" per volley");break;
      case "boomerang_crescent":out.push("Hits out and back · 0.75s turn · radius "+s.minR+"→"+s.maxR+" · trail "+R(s.trailDmg)+"/"+F(s.trailTick)+"s");break;
      case "grenade_meteor":out.push(s.count+" carriers · each blast "+R(s.damage)+" summons "+s.childCount+" meteors×"+R(s.childDmg));break;
      case "railgun_timestop":out.push("Beam "+R(s.damage)+" · corridor "+R(s.corridorDmg)+"/"+F(s.corridorTick)+"s · freeze "+F(s.freeze)+"s");break;
      case "vortex_meteor":out.push("Vortex "+R(s.damage)+"/0.2s · scorch "+R(s.burn)+"/0.5s");break;case "vortex_detonate":out.push("Final blast "+R(s.boomBase)+" + "+R(s.boomPer)+" per capture, max "+s.captureMax);break;
      case "sentry_hex":out.push("2 focus + 3 spread · judgment after "+s.judgeHits+" hits: "+R(s.judgeDmg)+" + "+Math.round(s.judgeFrac*100)+"% max HP");break;
      case "shockwave_polymorph":out.push("First wave polymorphs "+F(s.sheep)+"s · next impact blasts "+R(s.collideDmg));break;case "hex_crescent":out.push("Moon brand · blast "+R(s.hexDmg)+" + "+Math.round(s.frac*100)+"% max HP and spreads");break;
      case "detonate_polymorph":out.push("End/death blast "+R(s.bombDmg)+" · "+Math.round(s.spreadChance*100)+"% one-time spread");break;case "spear_timestop":out.push("Replay after "+F(s.echoDelay)+"s for "+R(s.echoDmg)+" and freeze "+F(s.freeze)+"s");break;
      case "lance_chain":out.push("Each beam sweeps every "+F(s.tick)+"s · lightning jumps "+s.chainHops);break;
    } return out;
  }

  // 武器当前生效数值摘要(暂停面板用)
  function summary(w, state) {
    const def = CFG.weaponDef(w.id);
    const s = SV.Weapons.stats(w, state);
    const F = function (v, n) { const m = Math.pow(10, n == null ? 2 : n); return Math.round(v * m) / m; };
    const CN = CFG.COUNT_NOUN;
    const noun = CN[w.id] || CN[w.id.replace(/_evo$/, "")] || "";
    const p = [];
    if (s.count != null && noun) p.push(s.count + " " + noun);
    if (s.damage != null) p.push(Math.round(s.damage) + L(" damage", " 伤害"));
    if (s.cooldown != null) p.push("CD " + (Math.round(s.cooldown * 100) / 100) + "s");
    if (s.radius != null) p.push(L("Radius ", "半径 ") + Math.round(s.radius));
    if (s.vrad != null) p.push(L("Vortex radius ", "卷半径 ") + Math.round(s.vrad));
    if (s.length != null) p.push(L("Length ", "长 ") + Math.round(s.length));
    if (s.beams != null) p.push(s.beams + L(" beams", " 光束"));
    if (s.chains != null) p.push(L("Chains ", "连跳 ") + (s.chains >= 99 ? "∞" : s.chains));
    if (s.chase != null) p.push(L("Pursuits ", "追击 ") + (s.chase >= 99 ? "∞" : s.chase));
    if (s.dot != null) p.push(L("Poison ", "毒 ") + Math.round(s.dot) + L("/tick", "/跳"));
    if (s.fireCd != null) p.push(L("Fire interval ", "射速 ") + (Math.round(s.fireCd * 100) / 100) + "s");
    if (s.tick != null) p.push(L("Every ", "每 ") + (Math.round(s.tick * 100) / 100) + "s");
    if (s.slow != null) p.push(L("Slow ", "减速 ") + Math.round(s.slow * 100) + "%");
    if (s.dur != null) p.push(L("Polymorph ", "变形 ") + (Math.round(s.dur * 10) / 10) + "s");
    if (s.interceptR != null) p.push(L("Intercept radius ", "拦截半径 ") + F(s.interceptR));
    if (w.id === "spear_lance") p.push(L("Grid ", "光栅 ")+F(s.gridDmg)+"/"+F(s.gridTick)+"s×"+F(s.gridLife)+"s · "+L("length ","长")+F(s.gridLen)+" · "+L("max ","最多")+s.gridMax+L(" lines","条"));
    const ex = extraSummary(w.id, s);
    for (let i = 0; i < ex.length; i++) p.push(ex[i]);
    return p.join(" · ") || def.desc;
  }

  // 各被动在 Entities.mods() 中的曲线参数(与 entities.js 保持一致),用于计算"下一级真实增量"。
  // 收益递减(rootDim/capDim)后,实际增量小于首级——升级卡需展示真实增量而非首级文案。
  const PASSIVE_CURVE = {
    maxhp:     { kind: "root", per: 28,    mul: "hp", fmt: function (d) { return L("Max HP +", "最大生命 +") + Math.round(d); } },
    speed:     { kind: "root", per: 0.09,  fmt: function (d) { return L("Speed +", "移速 +") + Math.round(d * 100) + "%"; } },
    damage:    { kind: "root", per: 0.11,  fmt: function (d) { return L("Damage +", "伤害 +") + Math.round(d * 100) + "%"; } },
    cooldown:  { kind: "cap", cap: 0.70, v1: 0.075, fmt: function (d) { return L("Cooldown -", "冷却 -") + Math.round(d * 100) + "%"; } },
    area:      { kind: "root", per: 0.11,  fmt: function (d) { return L("Area +", "范围 +") + Math.round(d * 100) + "%"; } },
    armor:     { kind: "cap", cap: 0.60, v1: 0.095, fmt: function (d) { return L("Damage taken -", "减伤 -") + Math.round(d * 100) + "%"; } },
    regen:     { kind: "root", per: 2,     fmt: function (d) { return L("Regen +", "再生 +") + (Math.round(d * 10) / 10) + "/s"; } },
    luck:      { kind: "root", per: 0.17,  fmt: function (d) { return L("Luck +", "幸运 +") + Math.round(d * 100) + "%"; } },
    crit:      { kind: "cap", cap: 1.0, v1: 0.09, fmt: function (d) { return L("Critical +", "暴击 +") + Math.round(d * 100) + "%"; } },
    lifesteal: { kind: "cap", cap: C.LIFESTEAL_ATTR_CAP, v1: C.LIFESTEAL_FIRST, fmt: function (d) { return L("Life steal +", "吸血 +") + (Math.round(d * 1000) / 10) + "%"; } }
  };
  // 计算某被动「从当前级升到下一级」的真实增量文案(无递减则退回静态文案)
  function passiveLevelText(state, id) {
    const E = SV.Entities;
    const curve = PASSIVE_CURVE[id];
    if (!curve) return null;
    const lvl = state.passives[id] || 0;
    let txt;
    if (curve.kind === "root") {
      let d = E.rootDim(lvl + 1, curve.per) - E.rootDim(lvl, curve.per);
      if (curve.mul === "hp") d *= ((state.charMul && state.charMul.hpMul) || 1);
      txt = curve.fmt(d);
    } else if (curve.kind === "cap") {
      const d = E.capDim(lvl + 1, curve.cap, curve.v1) - E.capDim(lvl, curve.cap, curve.v1);
      txt = curve.fmt(d);
    } else {
      txt = null;
    }
    if (id === "lifesteal") {
      const next = E.capDim(lvl + 1, C.LIFESTEAL_ATTR_CAP, C.LIFESTEAL_FIRST);
      txt += L(" · healing cap rises to ", " · 秒回上限升至 ") + (Math.round(next * 1000) / 10) + L("% max HP/s", "%最大生命/s");
    }
    return txt;
  }
  // magnet 同时影响拾取范围与经验,单独处理
  function magnetLevelText(state, id) {
    if (id !== "magnet") return null;
    const E = SV.Entities;
    const lvl = state.passives[id] || 0;
    const dp = (E.rootDim(lvl + 1, 0.45) - E.rootDim(lvl, 0.45)) * 100;
    const dx = (E.rootDim(lvl + 1, 0.09) - E.rootDim(lvl, 0.09)) * 100;
    return L("Pickup +", "拾取 +") + Math.round(dp) + L("% · XP +", "% · 经验 +") + Math.round(dx) + "%";
  }

  function canEvolve(state, baseId) {
    const evo = CFG.EVOLUTIONS[baseId];
    if (!evo) return false;
    for (let i = 0; i < state.weapons.length; i++) {
      const w = state.weapons[i];
      if (w.id === baseId && w.level >= C.WEAPON_MAX && ((state.passives[evo.reqPassive] || 0) >= C.PASSIVE_MAX || !passiveAllowed(state, evo.reqPassive))) return true;
    }
    return false;
  }

  // 协同进化:两把武器均已进化
  function canFuse(state, combo) {
    let a = false, b = false;
    for (let i = 0; i < state.weapons.length; i++) {
      const w = state.weapons[i];
      if (w.id === combo.w1 && w.evolved) a = true;
      if (w.id === combo.w2 && w.evolved) b = true;
    }
    return a && b;
  }

  // 协同提示:只说明存在路线。组合增多后不在普通武器卡上泄漏某一个随机命中的融合名。
  function synergyOf(state, baseId) {
    const evoId = baseId + "_evo";
    for (let i = 0; i < CFG.FUSIONS.length; i++) {
      const fu = CFG.FUSIONS[i];
      let other = null;
      if (fu.w1 === evoId) other = fu.w2;
      else if (fu.w2 === evoId) other = fu.w1;
      else continue;
      const otherBase = other.replace(/_evo$/, "");
      for (let j = 0; j < state.weapons.length; j++) {
        const w = state.weapons[j];
        if (w.id === other || w.id === otherBase) return L("⚭ Fusion route available", "⚭ 有协同进化");
      }
    }
    return null;
  }
  // 进化卡提示:组合另一方已进化 → 进化后即可合成
  function evolveSynergy(state, baseId) {
    const evoId = baseId + "_evo";
    for (let i = 0; i < CFG.FUSIONS.length; i++) {
      const fu = CFG.FUSIONS[i];
      let other = null;
      if (fu.w1 === evoId) other = fu.w2;
      else if (fu.w2 === evoId) other = fu.w1;
      else continue;
      for (let j = 0; j < state.weapons.length; j++) {
        if (state.weapons[j].id === other && state.weapons[j].evolved) return L("⚭ Enables fusion after evolution", "⚭ 进化后可协同进化");
      }
    }
    return null;
  }

  // 角色主题仅限制起手；局内所有基础武器、进化与融合全开。
  function weaponAllowed() { return true; }
  // 通用被动禁用入口。disabledPassives 为新结构，charMods.*Mul=0 仅保留旧配置兼容。
  function passiveAllowed(state, id) {
    const ch = CFG.CHARACTERS[state.charId] || {};
    if ((ch.disabledPassives || []).indexOf(id) >= 0) return false;
    const cmod = state.charMods || {};
    return cmod[id + "Mul"] !== 0; // undefined !== 0 为 true ⇒ 无对应清零项则放行
  }
  // 武器特性标签:按 tags 返回裸标签(近战/远程/元素/远程·元素),供卡片 badge 与暂停行展示
  function traitLabel(id) {
    const def = CFG.weaponDef(id);
    const t = def && def.tags;
    if (!t || !t.length) return "";
    const map = { melee: L("Melee", "近战"), ranged: L("Ranged", "远程"), spell: L("Spell", "法术") };
    const parts = [];
    for (let i = 0; i < t.length; i++) if (map[t[i]]) parts.push(map[t[i]]);
    return parts.join("·");
  }
  function buildPool(state) {
    const pool = [];
    const owned = ownedSet(state);
    const luck = SV.Entities.mods(state).luck;

    // 1) 协同进化(最高优先):两把已进化武器合成
    for (let i = 0; i < CFG.FUSIONS.length; i++) {
      const fu = CFG.FUSIONS[i];
      if (canFuse(state, fu) && weaponAllowed(state, CFG.weaponDef(fu.to))) {
        const left = CFG.weaponDef(fu.w1), right = CFG.weaponDef(fu.w2);
        const source = L("⚭ Sources: ", "⚭ 来源：") + (left ? left.name : fu.w1) + " + " + (right ? right.name : fu.w2);
        pool.push({ c: { kind: "fuse", id: fu.to, combo: fu, name: fu.name + " ⚭", desc: fu.desc, trait: traitLabel(fu.to), icon: fu.icon, color: fu.color, rarity: "legend", synergy: source }, weight: 300 });
      }
    }
    // 2) 进化
    for (const baseId in CFG.EVOLUTIONS) {
      if (canEvolve(state, baseId) && weaponAllowed(state, CFG.weaponDef(CFG.EVOLUTIONS[baseId].to))) {
        const evo = CFG.EVOLUTIONS[baseId];
        const syn = evolveSynergy(state, baseId);
        const exempt = !passiveAllowed(state, evo.reqPassive);
        pool.push({ c: { kind: "evolve", id: baseId, name: evo.name, desc: evo.desc + (exempt ? L(" · Character exemption: passive not required", " · 角色豁免：无需对应被动") : ""), trait: traitLabel(evo.to), icon: evo.icon, color: evo.color, rarity: "legend", synergy: exempt ? ((syn ? syn + " · " : "") + L("Character exemption", "角色豁免")) : syn }, weight: 200 });
      }
    }
    // 3) 已有武器升级(显示该级具体收益)
    for (let i = 0; i < state.weapons.length; i++) {
      const w = state.weapons[i];
      const def = CFG.weaponDef(w.id);
      if (w.level < def.max) {
        const lt = levelText(state, w);
        if (!lt.text) continue; // 融合武器/满级武器无收益卡
        const rar = lt.milestone ? (w.level >= 5 ? "epic" : "rare") : (w.level >= 6 ? "rare" : "common");
        pool.push({ c: { kind: "weapon", id: w.id, name: def.name + " Lv" + (w.level + 1) + (lt.milestone ? " ✦" : ""), desc: lt.text, trait: traitLabel(w.id), icon: def.icon, color: def.color, rarity: rar }, weight: Math.max(2, 26 - w.level) });
      }
    }
    // 3) 新武器(只发从未获得过的——融合/进化移除的成分武器不再重发)
    if (state.weapons.length < C.MAX_WEAPONS) {
      const ever = state.everOwned || {};
      for (const id in CFG.WEAPONS) {
        if (owned[id] || ever[id]) continue;
        const def = CFG.WEAPONS[id];
        if (!weaponAllowed(state, def)) continue;
        const syn = synergyOf(state, id);
        pool.push({ c: { kind: "newweapon", id: id, name: def.name + L(" (NEW)", " (新)"), desc: def.desc, trait: traitLabel(id), icon: def.icon, color: def.color, rarity: "epic", synergy: syn }, weight: 12 + luck * 30 });
      }
    }
    // 4) 被动升级(超设计满级后为递减的溢出强化)
    for (const id in CFG.PASSIVES) {
      if (!passiveAllowed(state, id)) continue; // 角色禁用项(如 berserker 的 regen/lifesteal)不出卡
      const lvl = state.passives[id] || 0;
      if (lvl < C.PASSIVE_MAX_LEVEL) {
        const def = CFG.PASSIVES[id];
        const inc = passiveLevelText(state, id) || magnetLevelText(state, id);
        pool.push({ c: { kind: "passive", id: id, name: def.name + " Lv" + (lvl + 1), desc: inc ? (L("This level: ", "本次:") + inc + (lvl >= 1 ? L(" (diminishing)", "(递减中)") : "")) : (def.desc + " (" + def.per + ")"), icon: def.icon, color: def.color, rarity: lvl >= 3 ? "rare" : "common" }, weight: Math.max(2, 22 - lvl) });
      }
    }
    return pool;
  }

  function rollChoices(state) {
    let pool = buildPool(state);
    const out = [];
    const take = Math.min(3, pool.length);
    for (let n = 0; n < take; n++) {
      if (!pool.length) break;
      const pick = U.weighted(pool);
      out.push(pick.c);
      // 从池中移除该项(按引用)
      for (let i = 0; i < pool.length; i++) { if (pool[i].c === pick.c) { pool.splice(i, 1); break; } }
    }
    return out;
  }

  function apply(state, choice) {
    SV.Entities.invalidateMods(state); // 被动/武器变化 → 失效 mods 缓存
    if (choice.kind === "fuse") { SV.Weapons.fuse(state, choice.combo); return; }
    if (choice.kind === "evolve") { SV.Weapons.evolve(state, choice.id); return; }
    if (choice.kind === "weapon") {
      for (let i = 0; i < state.weapons.length; i++) {
        if (state.weapons[i].id === choice.id) { state.weapons[i].level = Math.min(C.WEAPON_MAX, state.weapons[i].level + 1); return; }
      }
    }
    if (choice.kind === "newweapon") {
      state.weapons.push({ id: choice.id, level: 1, cd: 0, angle: 0, evolved: false });
      state.everOwned = state.everOwned || {};
      state.everOwned[choice.id] = true; // 记录历史:融合/进化移除后不再当新武器重发
      return;
    }
    if (choice.kind === "passive") {
      const cur = state.passives[choice.id] || 0;
      state.passives[choice.id] = Math.min(C.PASSIVE_MAX_LEVEL, cur + 1);
      if (choice.id === "maxhp") {
        // 按实际 maxHp 增量同步回血(适配任意 per 值)
        const before = state.player.maxHp;
        const newMax = SV.Entities.mods(state).maxHp; // 函数顶部已 invalidateMods
        state.player.hp = Math.min(newMax, state.player.hp + (newMax - before));
      }
      return;
    }
  }

  SV.Upgrades = { buildPool: buildPool, weaponAllowed: weaponAllowed, passiveAllowed: passiveAllowed, rollChoices: rollChoices, apply: apply, canEvolve: canEvolve, levelText: levelText, summary: summary, passiveLevelText: passiveLevelText, traitLabel: traitLabel };
})();
