// weapons.js — SV.Weapons: 21 种基础武器 + 进化/协同进化 + 投射物池与统一伤害统计。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const C = SV.Config.CONST;
  const Entities = SV.Entities;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  // ── 投射物池
  function pFactory() {
    return { x: 0, y: 0, vx: 0, vy: 0, r: 5, damage: 10, life: 1, maxLife: 1, color: "#fff",
      pierce: 0, homing: false, seek: 4, target: null, hitIds: null, shape: "dot", rot: 0, spin: 0, weaponId: "", visualStyle: "", phase: 0,
      explode: 0, vortex: false, vrad: 0, pull: 0, vtick: 0, btick: 0, tc: 0,
      chainHops: 0, chainRange: 0, splash: 0, splashMul: 0, explodeEvery: false, cluster: false, clustered: false,
      beamLen: 0, beamWidth: 0, beamDmg: 0, beamTick: 0, beamSpin: 0, beamRef: null, chaseKills: 0, chaseInfinite: false, chaseDecay: 0.85, meteor: 0, burn: 0, burnDur: 0, shockwave: null,
      sheep: false, sheepDur: 0, sheepPierce: 0, sheepFreeze: 0, sheepBomb: false, sheepBombDmg: 0, sheepBombRadius: 0,
      timestop: 0, tsFreeze: 0, shatter: false,
      grid: false, gridDir: 0, gridLen: 0, gridTick: 0, gridLife: 0, gridEvery: 0, gridWidth: 0,
      fieldR: 0, fieldPull: 0, fieldDmg: 0, fieldEvery: 0, fieldTick: 0,
      plasmaPayload: false, plasmaCore: false, coreR: 0, coreDmg: 0, coreEvery: 0, coreTick: 0, coreLife: 0,
      resonance: false, resonanceHits: 0, resonanceWindow: 0, resonanceLock: 0, chainMul: 0, vortexBurn: 0, burnR: 0, burnEvery: 0,
      vortexBomb: false, captures: null, captureMax: 0, boomBase: 0, boomPer: 0, boomR: 0, boomRPer: 0,
      returnHit: false, returnCleared: false, spreadChance: 0, spreadDur: 0,
      calibrate: 0, finalSpeed: 0, meteorHits: null, meteorPrimary: false,
      moonArc: false, moonOutbound: 0, moonMinR: 0, moonMaxR: 0, moonTrail: 0, moonTrailEvery: 0, moonTrailLife: 0, moonTrailTick: 0, moonTrailDmg: 0 };
  }
  function pReset(p) {
    p.vx = 0; p.vy = 0; p.r = 5; p.damage = 10; p.life = 1; p.maxLife = 1; p.color = "#fff";
    p.pierce = 0; p.homing = false; p.seek = 4; p.target = null; p.hitIds = null; p.shape = "dot"; p.rot = 0; p.spin = 0; p.weaponId = ""; p.visualStyle = ""; p.phase = 0;
    p.explode = 0; p.vortex = false; p.vrad = 0; p.pull = 0; p.vtick = 0; p.btick = 0; p.tc = 0;
    // 特殊机制字段必须清零,否则回收的投射物会携带上一世的残留(如 shockwave/chainHops/cluster)
    p.chainHops = 0; p.chainRange = 0; p.splash = 0; p.splashMul = 0; p.explodeEvery = false; p.cluster = false; p.clustered = false;
    if (p.beamRef) { const bi = beams.indexOf(p.beamRef); if (bi >= 0) beams.splice(bi, 1); }
    p.beamLen = 0; p.beamWidth = 0; p.beamDmg = 0; p.beamTick = 0; p.beamSpin = 0; p.beamRef = null; p.chaseKills = 0; p.chaseInfinite = false; p.chaseDecay = 0.85; p.meteor = 0; p.burn = 0; p.burnDur = 0; p.shockwave = null;
    p.sheep = false; p.sheepDur = 0; p.sheepPierce = 0; p.sheepFreeze = 0; p.sheepBomb = false; p.sheepBombDmg = 0; p.sheepBombRadius = 0;
    p.timestop = 0; p.tsFreeze = 0; p.shatter = false;
    p.grid = false; p.gridDir = 0; p.gridLen = 0; p.gridTick = 0; p.gridLife = 0; p.gridEvery = 0; p.gridWidth = 0;
    p.fieldR = 0; p.fieldPull = 0; p.fieldDmg = 0; p.fieldEvery = 0; p.fieldTick = 0;
    p.plasmaPayload = false; p.plasmaCore = false; p.coreR = 0; p.coreDmg = 0; p.coreEvery = 0; p.coreTick = 0; p.coreLife = 0;
    p.resonance = false; p.resonanceHits = 0; p.resonanceWindow = 0; p.resonanceLock = 0; p.chainMul = 0; p.vortexBurn = 0; p.burnR = 0; p.burnEvery = 0;
    p.vortexBomb = false; p.captures = null; p.captureMax = 0; p.boomBase = 0; p.boomPer = 0; p.boomR = 0; p.boomRPer = 0;
    p.returnHit = false; p.returnCleared = false; p.spreadChance = 0; p.spreadDur = 0;
    p.calibrate = 0; p.finalSpeed = 0; p.meteorHits = null; p.meteorPrimary = false;
    p.moonArc = false; p.moonOutbound = 0; p.moonMinR = 0; p.moonMaxR = 0; p.moonTrail = 0; p.moonTrailEvery = 0; p.moonTrailLife = 0; p.moonTrailTick = 0; p.moonTrailDmg = 0;
  }
  const proj = SV.Pool.create(pFactory, pReset);
  const beams = []; // {pts,life,max,color,width}
  const swings = []; // 扇形挥砍视觉 {x,y,dir,arc,radius,life,max,color}
  const arcFields = []; // 满月斩环扇地带 + 月轮残迹
  const orbitContacts = new WeakMap(); // 死亡之轮:每武器记录上一帧各敌人与哪些刀刃接触(运行时态,不进存档)
  let arcFieldSeq = 0;
  function addArcField(field) { field.fieldId = ++arcFieldSeq; arcFields.push(field); }

  // 硬上限:满则回收最旧再取,保证始终返回非空,避免子弹爆炸性增长卡死
  // 回收策略:跳过返航中的回旋镖(shape=star 且已过半程),它必须回到玩家
  function mkProj() {
    if (proj.list.length >= C.MAX_PROJECTILES) {
      let victim = -1;
      for (let i = 0; i < proj.list.length; i++) {
        const q = proj.list[i];
        if (!(q.shape === "star" && q.life < q.maxLife * 0.5) && !q.grid) { victim = i; break; }
      }
      proj.release(proj.list.splice(victim < 0 ? 0 : victim, 1)[0]);
    }
    return proj.acquire();
  }

  function weaponDef(id) { return SV.Config.weaponDef(id); }
  function characterDef(state) { return (state && SV.Config.CHARACTERS[state.charId]) || {}; }
  function hardAttackInterval(state, seconds) {
    const mech = characterDef(state).mechanics || {};
    return seconds / (state.special === "overclocker" && state.overclockActive > 0 ? (mech.frequencyMul || 1.2) : 1);
  }

  // 角色武器专精加成(每次调用现算,不缓存)。服务 arcanist(元素)/ranger(远程)。
  function applyCharWeaponSpec(s, def, state) {
    const spec = characterDef(state).weaponSpec;
    if (!spec || !def.tags || def.tags.indexOf(spec.tag) < 0) return;
    const damageKeys = ["damage", "dot", "explodeDmg", "gridDmg", "bombDmg", "beamDmg", "launchDamage", "burstDmg", "fieldDmg", "coreDmg", "pelletDamage", "childDmg", "corridorDmg", "burn", "boomBase", "boomPer", "judgeDmg", "collideDmg", "hexDmg", "echoDmg", "chainDmg"];
    const areaKeys = ["radius", "length", "expand"];
    for (let i = 0; i < damageKeys.length; i++) if (s[damageKeys[i]] != null) s[damageKeys[i]] *= spec.damageMul || 1;
    for (let i = 0; i < areaKeys.length; i++) if (s[areaKeys[i]] != null) s[areaKeys[i]] *= spec.areaMul || 1;
    if (s.cooldown != null) s.cooldown *= spec.cooldownMul || 1;
  }

  function stats(w, state) {
    const def = weaponDef(w.id);
    const base = def.stats(w.level);
    const m = Entities.mods(state);
    const s = Object.assign({}, base);
    if (base.damage != null) s.damage = base.damage * m.damageMul;
    // 纯 DoT 没有 damage 主字段；殉爆伤害也是独立字段，两者仍应吃“攻击强化”。
    if (base.dot != null) s.dot = base.dot * m.damageMul;
    if (base.explodeDmg != null) s.explodeDmg = base.explodeDmg * m.damageMul;
    if (base.cooldown != null) s.cooldown = base.cooldown * m.cdMul;
    if (base.tick != null && (def.kind === "aura" || w.id === "aura_poison")) s.tick = Math.max(0.055, base.tick * m.cdMul); // 光环与蚀界黑洞吃冷却缩减，不影响其他持续伤害
    if (base.radius != null) s.radius = base.radius * m.areaMul;
    if (base.length != null) s.length = base.length * m.areaMul;
    if (base.expand != null) s.expand = base.expand * m.areaMul;
    applyCharWeaponSpec(s, def, state); // 角色武器专精
    // 新融合的副伤害与主伤害使用同一伤害倍率,摘要展示的也是实际生效值。
    if (base.damage > 0) {
      const damageScale = s.damage / base.damage;
      const secondary = ["gridDmg", "bombDmg", "beamDmg", "launchDamage", "burstDmg", "fieldDmg", "coreDmg", "pelletDamage", "childDmg", "corridorDmg", "burn", "boomBase", "boomPer", "judgeDmg", "collideDmg", "hexDmg", "echoDmg", "chainDmg", "splashDamage", "auraDamage"];
      for (let i = 0; i < secondary.length; i++) if (base[secondary[i]] != null) s[secondary[i]] = base[secondary[i]] * damageScale;
    }
    // 超频窗口：所有武器伤害×1.2，攻击间隔÷1.2。持续时间、控制时长和 DoT 跳频不改变。
    if (state.special === "overclocker" && state.overclockActive > 0) {
      const mech = characterDef(state).mechanics || {};
      const damageKeys = ["damage", "dot", "explodeDmg", "gridDmg", "bombDmg", "beamDmg", "launchDamage", "burstDmg", "fieldDmg", "coreDmg", "pelletDamage", "childDmg", "corridorDmg", "burn", "boomBase", "boomPer", "judgeDmg", "collideDmg", "hexDmg", "echoDmg", "chainDmg", "splashDamage", "auraDamage"];
      const intervalKeys = ["cooldown", "tick", "fireCd", "hitCd", "launchCd", "beamTick", "gridTick", "corridorTick", "fieldTick", "coreTick", "bladeTick", "auraTick"];
      for (let i = 0; i < damageKeys.length; i++) if (s[damageKeys[i]] != null) s[damageKeys[i]] *= mech.damageMul || 1.2;
      for (let i = 0; i < intervalKeys.length; i++) if (s[intervalKeys[i]] != null) s[intervalKeys[i]] /= mech.frequencyMul || 1.2;
      // 死亡之轮的攻击频率完全由可见转速决定；超频必须同步加快视觉旋转。
      if (w.id === "blade_evo") s.spin *= mech.frequencyMul || 1.2;
    }
    return s;
  }

  // Initial/re-acquisition only. Damage queries and existing projectiles deliberately remain unrestricted.
  function targetCandidates(x, y, maxR, allowed) {
    const state = SV.Game.state, p = state.player;
    const cam = SV.Renderer ? SV.Renderer.cam : { x: p.x, y: p.y, zoom: 1 };
    const size = SV.Renderer ? SV.Renderer.cssSize() : { w: 0, h: 0 }, zoom = cam.zoom || 1;
    const hw = size.w / (2 * zoom), hh = size.h / (2 * zoom);
    const hasView = hw > 1 && hh > 1;
    const visible = [], nearby = [], r2 = maxR * maxR, fallback2 = C.TARGET_FALLBACK_RANGE * C.TARGET_FALLBACK_RANGE;
    for (let i = 0; i < state.enemies.length; i++) {
      const e = state.enemies[i];
      if (e.hp <= 0 || (allowed && !allowed(e)) || U.dist2(x, y, e.x, e.y) > r2) continue;
      if (hasView && Math.abs(e.x - cam.x) <= hw + e.r && Math.abs(e.y - cam.y) <= hh + e.r) visible.push(e);
      else if (U.dist2(p.x, p.y, e.x, e.y) <= fallback2) nearby.push(e);
    }
    return visible.length ? visible : nearby;
  }
  function nearest(x, y, maxR, allowed) {
    const arr = targetCandidates(x, y, maxR, allowed);
    let best = null, bd = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i], d = U.dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function aimFrom(p) {
    const tgt = nearest(p.x, p.y, 99999);
    return tgt ? U.angleTo(p.x, p.y, tgt.x, tgt.y) : p.facing;
  }
  // 轨道系索敌:枚举每个敌人的方向，优先选择预计直接贯穿最多的一条线。
  // 爆裂形态再以沿线爆炸可能覆盖的额外敌人数作为次级评分，最后才偏向 Boss/精英与近目标。
  function bestPierceAngle(state, p, len, halfW, splashR) {
    const cand = targetCandidates(p.x, p.y, len + 60);
    if (!cand.length) return p.facing;
    let bestA = U.angleTo(p.x, p.y, cand[0].x, cand[0].y), bestScore = -Infinity;
    for (let c = 0; c < cand.length; c++) {
      const a = U.angleTo(p.x, p.y, cand[c].x, cand[c].y), dx = Math.cos(a), dy = Math.sin(a);
      const direct = [], covered = {};
      let value = 0, nearestHit = Infinity;
      for (let i = 0; i < cand.length; i++) {
        const e = cand[i], ex = e.x - p.x, ey = e.y - p.y, along = ex * dx + ey * dy;
        if (along < 0 || along > len) continue;
        const side = Math.abs(ex * dy - ey * dx);
        if (side <= halfW + e.r) {
          direct.push(e); covered[e.id] = true; nearestHit = Math.min(nearestHit, along);
          value += e.isBoss ? 3 : (e.elite ? 1.5 : 1);
        }
      }
      let splash = 0;
      if (splashR > 0) for (let i = 0; i < cand.length; i++) {
        const e = cand[i]; if (covered[e.id]) continue;
        for (let j = 0; j < direct.length; j++) if (U.dist2(e.x, e.y, direct[j].x, direct[j].y) <= splashR * splashR) { covered[e.id] = true; splash++; break; }
      }
      const score = direct.length * 100000 + splash * 1000 + value * 10 - nearestHit * 0.001;
      if (score > bestScore) { bestScore = score; bestA = a; }
    }
    return bestA;
  }
  // 多龙卷优先像导弹一样分头瞄准不同近敌；目标不足时改用明显的对称扇形。
  function vortexAngles(state, p, count) {
    const base = aimFrom(p);
    if (count <= 1) return [base];
    const angles = [], locked = {};
    for (let k = 0; k < count; k++) {
      const tgt = nearestUnlocked(p.x, p.y, locked);
      if (!tgt) break;
      locked[tgt.id] = true;
      angles.push(U.angleTo(p.x, p.y, tgt.x, tgt.y));
    }
    if (angles.length === count) return angles;
    angles.length = 0;
    const spread = 1.0;
    for (let k = 0; k < count; k++) angles.push(base + (k - (count - 1) / 2) * spread);
    return angles;
  }
  // 哨卫分头锁定:找最近且未被其他塔锁定的存活目标(locked 每帧重建)
  function nearestUnlocked(x, y, locked) {
    return nearest(x, y, Infinity, function (e) { return !locked[e.id]; });
  }
  // Polymorph must not re-acquire already controlled enemies.
  function nearestFresh(x, y) {
    return nearest(x, y, Infinity, function (e) { return !(e.sheep > 0); });
  }
  function dmgEnemy(e, dmg, wid) {
    let v = e.frozen > 0 ? 1.5 : (e.sheep > 0 ? 1.3 : 1);
    if (e.armorBreak > 0) v += 0.5; // 破甲(战矛 evo 命中附加短暂易伤)
    const opts = { vuln: v };
    if (wid) opts.wid = wid; // 按武器累计伤害
    Entities.damageEnemy(SV.Game.state, e, dmg, opts);
  }
  // 控制类效果施加(冻结/变羊/减速):Boss 时长 ×CC_BOSS_MUL 大幅削减(减速强度再减半)
  const CCM = C.CC_BOSS_MUL;
  function ccFreeze(e, dur) { if (!(dur > 0)) return; e.frozen = Math.max(e.frozen, e.isBoss ? dur * CCM : dur); }
  function ccSheep(e, dur) { if (!(dur > 0)) return; e.sheep = Math.max(e.sheep, e.isBoss ? dur * CCM : dur); }
  function ccSlow(e, dur, f) {
    if (!(dur > 0)) return;
    if (e.isBoss) { dur *= CCM; f *= 0.5; }
    e.slow = Math.max(e.slow, dur); e.slowF = Math.max(e.slowF, f);
  }

  // ── 各武器开火
  function fire(state, w, def, s) {
    switch (def.kind) {
      case "missile": fireMissile(state, w, def, s); break;
      case "shotgun": fireShotgun(state, w, def, s); break;
      case "boomerang": fireBoomerang(state, w, def, s); break;
      case "chain": fireChain(state, w, def, s); break;
      case "frost": fireFrost(state, w, def, s); break;
      case "grenade": fireGrenade(state, w, def, s); break;
      case "railgun": fireRailgun(state, w, def, s); break;
      case "poison": firePoison(state, w, def, s); break;
      case "vortex": fireVortex(state, w, def, s); break;
      case "meteor": fireMeteor(state, w, def, s); break;
      case "shockwave": fireShockwave(state, w, def, s); break;
      case "hex": fireHex(state, w, def, s); break;
      case "crescent": fireCrescent(state, w, def, s); break;
      case "detonate": fireDetonate(state, w, def, s); break;
      case "spear": fireSpear(state, w, def, s); break;
      case "polymorph": firePolymorph(state, w, def, s); break;
      case "timestop": fireTimestop(state, w, def, s); break;
      // 协同进化(fire 型,按武器 id 分发——融合 def 的 kind 统一为 "fusion")
      case "fusion": {
        const fn = FUSION_FIRE[w.id];
        if (fn) fn(state, w, def, s);
        break;
      }
    }
  }
  const FUSION_FIRE = {
    missile_chain: fusionMissileChain,
    railgun_grenade: fusionRailgunGrenade,
    frost_poison: fusionFrostPoison,
    lance_vortex: fusionLanceVortex,
    shotgun_grenade: fusionShotgunGrenade,
    meteor_chain: fireMeteor,
    shockwave_frost: fireShockwave,
    hex_poison: fireHex,
    crescent_detonate: fusionCrescentDetonate,
    polymorph_timestop: fusionPolymorphTimestop,
    spear_lance: fusionSpearLance,
    missile_aura: fusionMissileAura,
    missile_railgun: fusionMissileRailgun,
    shotgun_shockwave: fusionShotgunShockwave,
    shotgun_spear: fusionShotgunSpear,
    boomerang_crescent: fusionBoomerangCrescent,
    grenade_meteor: fusionGrenadeMeteor,
    railgun_timestop: fusionRailgunTimestop,
    vortex_meteor: fusionVortexMeteor,
    vortex_detonate: fusionVortexDetonate,
    shockwave_polymorph: fusionShockwavePolymorph,
    hex_crescent: fusionHexCrescent,
    detonate_polymorph: fusionDetonatePolymorph,
    spear_timestop: fusionSpearTimestop
  };

  function fireMissile(state, w, def, s) {
    const p = state.player;
    const locked = {}; // 各弹分头锁敌:多发时尽量覆盖不同目标(对群友好)
    for (let k = 0; k < s.count; k++) {
      const tgt = nearestUnlocked(p.x, p.y, locked) || nearest(p.x, p.y, Infinity);
      if (!tgt) break;
      locked[tgt.id] = true;
      const ang = U.angleTo(p.x, p.y, tgt.x, tgt.y);
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 6; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.homing = true; pr.seek = 4.5; pr.target = tgt; pr.weaponId = w.id;
      pr.chaseKills = s.chase || 0; pr.chaseInfinite = !!s.infiniteChase; pr.chaseDecay = s.chaseDecay == null ? 0.85 : s.chaseDecay; // 处决追击:击杀后继续追猎
    }
    SV.Audio.shoot();
  }

  function fireShotgun(state, w, def, s) {
    const p = state.player;
    const dir = aimFrom(p);
    const pierce = s.pierce || 0;
    for (let k = 0; k < s.count; k++) {
      const a = dir + (k - (s.count - 1) / 2) * (s.cone / Math.max(1, s.count));
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
      pr.r = 5; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color; pr.weaponId = w.id;
      pr.pierce = pierce; if (pierce > 0) pr.hitIds = [];
    }
    SV.Audio.shoot();
  }

  function fireBoomerang(state, w, def, s) {
    const p = state.player;
    const base = aimFrom(p);
    // 收敛散射:多发时紧密排列(0.16rad),近敌/单体时多发都能命中,不再只靠 damage 硬补
    const spread = def.evo ? 0.22 : 0.16;
    for (let k = 0; k < s.count; k++) {
      const a = base + (k - (s.count - 1) / 2) * spread;
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
      pr.r = 8; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.shape = "star"; pr.spin = 14; pr.pierce = def.evo ? 99 : 2; pr.hitIds = []; pr.weaponId = w.id; pr.phase = 0;
    }
    SV.Audio.shoot();
  }

  // 连锁闪电:从 (x,y) 向周围跳链,每跳伤害 ×hopMul(融合武器复用)
  function chainBurst(state, x, y, dmg, hops, range, color, hopMul, wid, initialTarget) {
    const pts = [[x, y]];
    const visited = new Set();
    let cx = x, cy = y, lastDmg = dmg;
    for (let i = 0; i < hops; i++) {
      const near = initialTarget && i === 0 ? targetCandidates(cx, cy, range) : SV.Spatial.queryCircle(cx, cy, range);
      let best = null, bd = range * range;
      for (let j = 0; j < near.length; j++) { const e = near[j]; if (visited.has(e.id) || e.hp <= 0) continue; const d = U.dist2(cx, cy, e.x, e.y); if (d < bd) { bd = d; best = e; } }
      if (!best) break;
      visited.add(best.id);
      dmgEnemy(best, lastDmg, wid);
      SV.Effects.hit(best.x, best.y, color);
      pts.push([best.x, best.y]);
      cx = best.x; cy = best.y;
      lastDmg *= (hopMul || 1);
    }
    if (pts.length >= 2) { beams.push({ pts: pts, life: 0.12, max: 0.12, color: color, width: 3, weaponId: wid, visualStyle: "lightning" }); SV.Audio.hit(); }
  }
  function fireChain(state, w, def, s) {
    // 普通 chains 表示首击后的额外跳数；进化配置直接表示总命中数 8。
    chainBurst(state, state.player.x, state.player.y, s.damage, def.evo ? s.chains : (1 + s.chains), s.range, def.color, def.evo ? 1.1 : 1.0, w.id, true);
  }

  // 一条穿透光束的伤害(可复用,lance_evo 多束/融合共用)。周期型:线上敌人每结算一次各命中一跳。
  // 查询半径必须 ≥ 实际命中半径(halfW + 最大敌 r):Boss r≈50,否则静止大目标会漏检。
  function beamDamage(state, x0, y0, dx, dy, len, halfW, dmg, color, wid) {
    const visited = new Set();
    const steps = Math.ceil(len / 22);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const qx = x0 + dx * len * t, qy = y0 + dy * len * t;
      const near = SV.Spatial.queryCircle(qx, qy, halfW + 60);
      for (let j = 0; j < near.length; j++) {
        const e = near[j];
        if (visited.has(e.id) || e.hp <= 0) continue;
        const projLen = (e.x - x0) * dx + (e.y - y0) * dy;
        if (projLen < 0 || projLen > len) continue;
        const fx = x0 + dx * projLen, fy = y0 + dy * projLen;
        if (U.dist2(fx, fy, e.x, e.y) < (halfW + e.r) * (halfW + e.r)) {
          visited.add(e.id); dmgEnemy(e, dmg, wid); SV.Effects.hit(e.x, e.y, color);
        }
      }
    }
  }

  // 触碰型光束(基础环绕激光):判定为一条线(敌中心到线段距离 < 敌自身半径 + 2px 容差)。
  // 「一次触碰只造成一次伤害」= 边沿触发:仅当敌人本帧触碰、上一帧未触碰(新进入)时受创一次;
  // 敌人离开光束后再次被扫到(光束旋转回来/敌人走进来)会再次触发。返回本帧触碰的敌人 id 集合。
  function beamTouch(state, x0, y0, dx, dy, len, prev, dmg, color, wid) {
    const now = new Set();
    const steps = Math.ceil(len / 22);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const qx = x0 + dx * len * t, qy = y0 + dy * len * t;
      const near = SV.Spatial.queryCircle(qx, qy, 62);
      for (let j = 0; j < near.length; j++) {
        const e = near[j];
        if (e.hp <= 0 || now.has(e.id)) continue;
        const projLen = (e.x - x0) * dx + (e.y - y0) * dy;
        if (projLen < 0 || projLen > len) continue;
        const fx = x0 + dx * projLen, fy = y0 + dy * projLen;
        const hw = e.r + 2; // 线判定:+2px 容差,宽度无意义(敌人有体积即可触发)
        if (U.dist2(fx, fy, e.x, e.y) < hw * hw) {
          now.add(e.id);
          if (!prev || !prev.has(e.id)) { dmgEnemy(e, dmg, wid); SV.Effects.hit(e.x, e.y, color); }
        }
      }
    }
    return now;
  }

  // ── 环绕激光(连续型):环绕玩家旋转的贯穿光束。
  //   基础(恒单束):触碰型——边沿触发,敌人进入光束时受创一次(beamTouch 维护上一帧触碰集合);
  //   进化:两道相隔 180°、旋转较慢,线上敌人每 0.1s 持续受创(周期型多次伤害)。
  function lanceUpdate(state, w, def, dt) {
    const p = state.player;
    const s = stats(w, state);
    w.angle = (w.angle || 0) + s.spin * dt;
    const beamsN = s.beams || 1;
    if (def.evo) {
      w.cd = (w.cd || 0) - dt;
      if (w.cd <= 0) {
        w.cd = s.tick || 0.1;
        for (let b = 0; b < beamsN; b++) {
          const ang = (w.angle || 0) + b / beamsN * U.TAU;
          beamDamage(state, p.x, p.y, Math.cos(ang), Math.sin(ang), s.length, 2, s.damage, def.color, w.id);
        }
      }
      w._touch = null; // 进化后是周期型,不再使用触碰集合(进化瞬间清掉旧集合防误判)
    } else {
      const prevArr = w._touch;
      const curArr = [];
      for (let b = 0; b < beamsN; b++) {
        const ang = (w.angle || 0) + b / beamsN * U.TAU;
        curArr.push(beamTouch(state, p.x, p.y, Math.cos(ang), Math.sin(ang), s.length, prevArr ? prevArr[b] : null, s.damage, def.color, w.id));
      }
      w._touch = curArr;
    }
    for (let b = 0; b < beamsN; b++) { // 每帧补视觉(短寿命,随旋角流动;lance 光束走细化调暗渲染)
      const ang = (w.angle || 0) + b / beamsN * U.TAU;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      beams.push({ pts: [[p.x, p.y], [p.x + dx * s.length, p.y + dy * s.length]], life: 0.06, max: 0.06, color: def.color, width: s.width, lance: true, evo: !!def.evo, weaponId: w.id, visualStyle: "laser" });
    }
  }

  function fireAura(state, w) {
    const st = SV.Game.state, p = st.player;
    const def = weaponDef(w.id);
    const s = stats(w, st);
    const near = SV.Spatial.queryCircle(p.x, p.y, s.radius);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (U.dist2(p.x, p.y, e.x, e.y) <= s.radius * s.radius) {
        dmgEnemy(e, s.damage, w.id);
        if (def.evo && s.pull) {
          const a = U.angleTo(e.x, e.y, p.x, p.y);
          const d = U.dist(e.x, e.y, p.x, p.y);
          const pull = Math.min(s.pull, d * 3);
          e.x += Math.cos(a) * pull * (1 / 60); e.y += Math.sin(a) * pull * (1 / 60);
        }
      }
    }
    if (!SV.Effects.isReduced()) SV.Effects.hit(p.x, p.y, def.color);
  }

  function fireFrost(state, w, def, s) {
    const p = state.player;
    const near = SV.Spatial.queryCircle(p.x, p.y, s.radius);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (U.dist2(p.x, p.y, e.x, e.y) <= s.radius * s.radius) {
        dmgEnemy(e, s.damage, w.id);
        // 冰面残留:减速时长 +1.2s,减速更强
        ccSlow(e, s.slowDur + 1.2, 0.35);
        if (def.evo && s.freeze) {
          if (s.freezeHits) {
            // 冻结期间不为下一轮蓄层，避免高冷却缩减下形成永久冻结链。
            if (!(e.frozen > 0)) {
              e._zeroHits = (e._zeroHits || 0) + 1;
              if (e._zeroHits >= s.freezeHits) { e._zeroHits = 0; ccFreeze(e, s.freeze); }
            }
          } else ccFreeze(e, s.freeze);
        }
      }
    }
    SV.Effects.ring(p.x, p.y, def.color, 10, s.radius, 0.45, 4);
    SV.Effects.shake(3, 0.15);
  }

  // ── 榴弹(抛射 + AoE 爆炸)
  function fireGrenade(state, w, def, s) {
    const p = state.player;
    for (let k = 0; k < s.count; k++) {
      const ang = aimFrom(p) + (s.count > 1 ? (k - (s.count - 1) / 2) * 0.18 : 0);
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 7; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.explode = s.radius; pr.cluster = def.evo && s.cluster; pr.weaponId = w.id;
    }
    SV.Audio.shoot();
  }
  // 通用溅射:范围内伤害 + 爆炸特效(融合武器复用)
  function splashAt(state, x, y, r, dmg, color, count, wid) {
    const near = SV.Spatial.queryCircle(x, y, r);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (U.dist2(x, y, e.x, e.y) <= r * r) dmgEnemy(e, dmg, wid);
    }
    SV.Effects.explosion(x, y, color, count || 10);
  }
  function explodeGrenade(state, pr) {
    splashAt(state, pr.x, pr.y, pr.explode, pr.damage, pr.color, 16, pr.weaponId);
    SV.Effects.ring(pr.x, pr.y, pr.color, 6, pr.explode, 0.3, 3);
    SV.Audio.die();
    if (pr.cluster && !pr.clustered) {
      pr.clustered = true; // 贯穿弹多次爆炸时只集束一次,防弹幕增殖
      const n = typeof pr.cluster === "number" ? pr.cluster : 3;
      for (let i = 0; i < n; i++) {           // 集束改为瞬间多点 AOE(同帧 splashAt),不再 spawn 子弹药
        const a = U.rand(0, U.TAU), d = U.rand(15, pr.explode * 0.5);
        const bx = pr.x + Math.cos(a) * d, by = pr.y + Math.sin(a) * d;
        splashAt(state, bx, by, pr.explode * 0.5, pr.damage * 0.55, pr.color, 10, pr.weaponId);
        SV.Effects.ring(bx, by, pr.color, 6, pr.explode * 0.5, 0.25, 3);
      }
    }
  }

  // ── 轨道炮(超高伤贯穿弹)
  function fireRailgun(state, w, def, s) {
    const p = state.player;
    const ang = bestPierceAngle(state, p, s.speed * 0.7, 9, def.evo ? s.explode : 0);
    const pr = mkProj();
    pr.x = p.x; pr.y = p.y;
    pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
    pr.r = 9; pr.damage = s.damage; pr.life = 0.7; pr.maxLife = 0.7; pr.color = def.color;
    pr.pierce = 99; pr.hitIds = []; pr.weaponId = w.id; pr.explode = def.evo ? s.explode : 0;
    beams.push({ pts: [[p.x, p.y], [p.x + Math.cos(ang) * 60, p.y + Math.sin(ang) * 60]], life: 0.08, max: 0.08, color: def.color, width: 5 });
    SV.Audio.shoot();
    SV.Effects.shake(2, 0.1);
  }

  // ── 剧毒(给范围内敌人上 DoT)
  function firePoison(state, w, def, s) {
    const p = state.player;
    const near = SV.Spatial.queryCircle(p.x, p.y, s.radius).slice();
    let any = false;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (U.dist2(p.x, p.y, e.x, e.y) <= s.radius * s.radius) {
        // 毒叠层:每层 +40% 毒伤,≤3 层
        e.poisonStacks = Math.min(3, (e.poisonStacks || 0) + 1);
        e.poison = s.dotDur; e.poisonDmg = s.dot * (1 + 0.4 * (e.poisonStacks - 1)); e.poisonTick = 0; e.poisonWid = w.id; any = true;
        if (def.evo) ccSlow(e, s.slowDur, s.slow);
      }
    }
    // 进化:剧毒传染——每个已中毒者再传染附近敌人
    if (def.evo && any) {
      for (let i = 0; i < near.length; i++) {
        const src = near[i];
        if (src.poison <= 0) continue;
        const spread = SV.Spatial.queryCircle(src.x, src.y, 90);
        for (let j = 0; j < spread.length; j++) {
          const e2 = spread[j];
          if (e2 !== src && e2.poison <= 0) { e2.poison = s.dotDur; e2.poisonDmg = s.dot; e2.poisonTick = 0; e2.poisonWid = w.id; ccSlow(e2, s.slowDur, s.slow); }
        }
      }
    }
    SV.Effects.ring(p.x, p.y, def.color, 10, s.radius, 0.4, 3);
    if (any) SV.Audio.hit();
  }

  // ── 龙卷风(游走投射物,吸敌 + 持续伤害)
  function fireVortex(state, w, def, s) {
    const p = state.player;
    const count = s.count || 1;
    const angles = vortexAngles(state, p, count);
    for (let k = 0; k < count; k++) {
      const ang = angles[k];
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 12; pr.vrad = s.radius; pr.pull = s.pull;
      pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.vortex = true; pr.vtick = 0; pr.weaponId = w.id;
    }
    SV.Audio.shoot();
  }

  // 附近敌群的多个分散质心(陨石/时停多目标用):种子取「sep 半径内邻居最多」的敌群,
  // 使多颗落点分别砸向不同敌群而非叠在一点。minDist:候选须距玩家至少此值(让出近战范围,
  // 避免定点武器与近战抢目标);洗牌引入随机起始次序(≈随机角度起搜),质心再加抖动,
  // 两次施放不会锁定同一位置。全部候选都在 minDist 内时回退不过滤(早期仍可用)。返回质心数组(可能少于 n 个)。
  function denseClusters(p, range, n, sep, minDist) {
    const all = targetCandidates(p.x, p.y, range);
    let alive = all;
    if (minDist) {
      const md2 = minDist * minDist;
      const far = [];
      for (let i = 0; i < all.length; i++) if (U.dist2(p.x, p.y, all[i].x, all[i].y) >= md2) far.push(all[i]);
      if (far.length) alive = far; // 全被滤空才回退(全部贴脸时仍发射)
    }
    // Fisher-Yates 洗牌:随机起始次序(等价于从随机角度开始搜索)
    for (let i = alive.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = alive[i]; alive[i] = alive[j]; alive[j] = t; }
    if (alive.length > 200) alive.length = 200; // 密度估计采样上限(防爆开销)
    // 邻居计数(O(采样²),稳定排序保留洗牌随机序:平局时先洗到者优先)
    const s2 = sep * sep;
    const cnt = new Array(alive.length);
    for (let i = 0; i < alive.length; i++) {
      let c = 0;
      for (let j = 0; j < alive.length; j++) if (j !== i && U.dist2(alive[i].x, alive[i].y, alive[j].x, alive[j].y) < s2) c++;
      cnt[i] = c;
    }
    const order = [];
    for (let i = 0; i < alive.length; i++) order.push(i);
    order.sort(function (a, b) { return cnt[b] - cnt[a]; });
    const used = new Array(alive.length);
    const out = [];
    for (let oi = 0; oi < order.length && out.length < n; oi++) {
      const seed = order[oi];
      if (used[seed]) continue;
      let sx = 0, sy = 0, m = 0;
      const sxe = alive[seed].x, sye = alive[seed].y;
      for (let i = 0; i < alive.length; i++) {
        if (used[i]) continue;
        if (U.dist2(sxe, sye, alive[i].x, alive[i].y) < s2) { sx += alive[i].x; sy += alive[i].y; m++; used[i] = true; }
      }
      if (m > 0) out.push({ x: sx / m + U.rand(-20, 20), y: sy / m + U.rand(-20, 20) });
    }
    return out;
  }

  // ── 陨石(锁定多个敌群质心,延迟爆炸 + 灼烧;索敌避开玩家近旁,与近战分流)
  function fireMeteor(state, w, def, s) {
    const p = state.player;
    const clusters = denseClusters(p, 460, s.count, 170, C.AIM_MIN_DIST);
    const fallback = { x: p.x + Math.cos(aimFrom(p)) * 200, y: p.y + Math.sin(aimFrom(p)) * 200 };
    // 视口可视矩形(世界坐标):把陨石落点夹进屏幕内,否则屏外敌群会让陨石落在视野外看不见
    const cam = SV.Renderer.cam, sz = SV.Renderer.cssSize();
    const hw = sz.w / 2 / cam.zoom, hh = sz.h / 2 / cam.zoom, IN = 50;
    const clampView = hw > IN && hh > IN; // 视口有效(真浏览器)才夹;vm 沙箱无 canvas 时跳过,避免倒夹区间
    const roundHits = {};
    for (let k = 0; k < s.count; k++) {
      let c = clusters[k];
      if (!c) { // 敌群少于陨石数:在最大敌群(或瞄准方向)附近散布,避免重叠成一点
        c = clusters[0] || fallback;
        const missing = k - clusters.length, total = Math.max(1, s.count - clusters.length);
        const ang = U.TAU * missing / total + U.rand(-0.12, 0.12);
        const spread = Math.max(64, s.radius * 0.7);
        c = { x: c.x + Math.cos(ang) * spread, y: c.y + Math.sin(ang) * spread };
      }
      if (clampView) { // 落点钳到屏内(留 IN 内边距,保证爆炸圈也可见)
        c = { x: U.clamp(c.x, cam.x - hw + IN, cam.x + hw - IN),
              y: U.clamp(c.y, cam.y - hh + IN, cam.y + hh - IN) };
      }
      const pr = mkProj();
      pr.x = c.x; pr.y = c.y;
      pr.vx = 0; pr.vy = 0;
      pr.r = 11; pr.damage = s.damage; pr.life = s.arm; pr.maxLife = s.arm; pr.color = def.color;
      pr.meteor = s.radius; pr.burn = s.burn; pr.burnDur = s.burnDur; pr.cluster = def.evo && s.cluster; pr.weaponId = w.id;
      pr.meteorHits = roundHits; pr.meteorPrimary = k < clusters.length;
      if (s.chainHops && pr.meteorPrimary) { pr.chainHops = s.chainHops; pr.chainRange = s.chainRange; } // 仅真实独立敌群触发连锁
      SV.Effects.ring(pr.x, pr.y, def.color, 8, s.radius, s.arm, 4); // 落点预警圈(持续到爆炸)
    }
    SV.Audio.shoot();
  }
  // 陨石爆炸:范围伤害 + 进化/融合落地留焦土(只伤敌人的燃烧区域)
  function explodeMeteor(state, pr) {
    const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.meteor);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp <= 0 || U.dist2(pr.x, pr.y, e.x, e.y) > pr.meteor * pr.meteor) continue;
      const repeated = pr.meteorHits && pr.meteorHits[e.id];
      dmgEnemy(e, pr.damage * (repeated ? 0.5 : 1), pr.weaponId);
      if (pr.meteorHits) pr.meteorHits[e.id] = true;
    }
    SV.Effects.explosion(pr.x, pr.y, pr.color, 24); SV.Effects.ring(pr.x, pr.y, pr.color, 8, pr.meteor, 0.4, 4); SV.Effects.shake(5, 0.25); SV.Audio.die();
    if (pr.chainHops) chainBurst(state, pr.x, pr.y, pr.damage * 0.6, pr.chainHops, pr.chainRange, pr.color, 1.1, pr.weaponId); // 融合:陨雷审判
    // 进化/融合:落地留焦土(kind:"scorch",只伤敌人、无 warm;与地图灼烧区只伤玩家区分,视觉另配色)
    if (pr.burn > 0 && state.hazards.length < C.MAX_HAZARDS) {
      state.hazards.push({ x: pr.x, y: pr.y, r: pr.meteor * 0.85, dmg: pr.burn, life: pr.burnDur, max: pr.burnDur, color: "#ffae42", kind: "scorch", tick: 0.5, wid: pr.weaponId });
    }
  }
  // 时停力场落地:范围伤害 + 冻结(进化冻者碎裂溅射)
  function explodeTimestop(state, pr) {
    splashAt(state, pr.x, pr.y, pr.timestop, pr.damage, pr.color, 22, pr.weaponId);
    const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.timestop);
    let canShatter = false;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp <= 0 || U.dist2(pr.x, pr.y, e.x, e.y) > pr.timestop * pr.timestop) continue;
      ccFreeze(e, pr.tsFreeze);
      if (e.frozen > 0) canShatter = true;
    }
    // 进化时停每个力场最多碎裂一次，避免密集敌群下逐敌溅射形成平方级伤害。
    if (pr.shatter && canShatter) splashAt(state, pr.x, pr.y, 36, pr.damage * 0.5, pr.color, 10, pr.weaponId);
    SV.Effects.explosion(pr.x, pr.y, pr.color, 24); SV.Effects.ring(pr.x, pr.y, pr.color, 8, pr.timestop, 0.4, 4); SV.Effects.shake(5, 0.25); SV.Audio.die();
  }

  // ── 冲击波(扇形挥砍,伤害 + 击退;evo/融合命中冰冻/碎裂)
  function fireShockwave(state, w, def, s) {
    const p = state.player;
    const base = aimFrom(p);
    const opts = { knock: s.knock, freeze: def.evo && s.freeze, shatter: s.shatter, shatterMul: s.shatterMul, shatterBudget: s.shatter ? 4 : 0 };
    for (let k = 0; k < s.count; k++) {
      const dir = s.count > 1 ? base + k * U.TAU / s.count : base;
      swingOnce(state, w, def, s, dir, opts);
    }
    SV.Audio.shoot(); SV.Effects.shake(2, 0.12);
  }

  // ── 诅咒(锁定视野内血量最高的敌人——优先 Boss,多目标从高到低;延迟引爆 %+maxHp + 蔓延)
  function fireHex(state, w, def, s) {
    const p = state.player;
    const cand = targetCandidates(p.x, p.y, 460, function (e) { return !(e.hex > 0); });
    // Boss 优先,再按 maxHp 降序(血量最高的优先,%maxHp 才能打在 Boss 身上)
    cand.sort(function (a, b) {
      const ab = a.isBoss ? 1 : 0, bb = b.isBoss ? 1 : 0;
      if (ab !== bb) return bb - ab;
      if (a.maxHp !== b.maxHp) return b.maxHp - a.maxHp;
      return 0;
    });
    let marked = 0;
    for (let i = 0; i < cand.length && marked < s.count; i++) {
      const e = cand[i];
      e.hex = s.delay; e.hexMax = s.delay; e.hexChild = false; e.hexDmg = s.damage; e.hexFrac = s.frac; e.hexSpread = s.spread; e.hexWid = w.id;
      if (s.dot) {
        e.poisonStacks = Math.min(3, (e.poisonStacks || 0) + 1); e.poison = s.dotDur;
        e.poisonDmg = s.dot * (1 + 0.4 * ((e.poisonStacks || 1) - 1)); e.poisonTick = 0; e.poisonWid = w.id;
        e.poisonHexCut = s.fuseCut || 0; e.hexPoisonDmg = s.dot; e.hexPoisonDur = s.dotDur; e.hexFuseCut = s.fuseCut || 0;
      } // 融合:腐朽天灾
      SV.Effects.text(e.x, e.y - e.r - 6, L("HEX", "诅"), "#d0a0ff", 13);
      marked++;
    }
    if (marked) SV.Audio.hit();
  }

  // ── 扇形挥砍(近战通用):以 dir 为中心、s.arc 张角、s.radius 半径内的敌人各命中一次 + 挥砍视觉
  // opts: { knock, freeze, shatter, armorBreak, explodeChance, explodeR, explodeDmg, chainHops, onHit, hitIds }
  function swingOnce(state, w, def, s, dir, opts) {
    opts = opts || {};
    const p = state.player;
    const r = s.radius;
    const half = (s.arc || 1.2) / 2;
    const near = SV.Spatial.queryCircle(p.x, p.y, r);
    let hit = false;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp <= 0) continue;
      if (opts.hitIds && opts.hitIds[e.id]) continue;
      if (U.dist2(p.x, p.y, e.x, e.y) > r * r) continue;
      const ang = U.angleTo(p.x, p.y, e.x, e.y);
      const diff = Math.abs(Math.atan2(Math.sin(ang - dir), Math.cos(ang - dir)));
      if (diff > half) continue;
      const wasFrozen = e.frozen > 0; // 必须在本次冻结前保存:冰碎共振首击只冻结
      dmgEnemy(e, s.damage, w.id);
      if (opts.hitIds) opts.hitIds[e.id] = true;
      SV.Effects.hit(e.x, e.y, def.color);
      if (opts.knock) {
        const a = U.angleTo(p.x, p.y, e.x, e.y);
        const kb = Math.min(opts.knock, 36) / Math.max(1, e.mass * 0.5);
        e.x += Math.cos(a) * kb; e.y += Math.sin(a) * kb;
      }
      if (opts.freeze) ccFreeze(e, opts.freeze);
      if (opts.shatter && wasFrozen && opts.shatterBudget > 0) { opts.shatterBudget--; splashAt(state, e.x, e.y, opts.shatter, s.damage * (opts.shatterMul || 0.5), def.color, 10, w.id); }
      if (opts.armorBreak) e.armorBreak = Math.max(e.armorBreak || 0, opts.armorBreak);
      if (opts.explodeChance && Math.random() < opts.explodeChance && (!opts.explodeRound || opts.explodeRound.remaining > 0)) explodeAt(state, e.x, e.y, opts.explodeR, opts.explodeDmg, def.color, w.id, opts.chainHops || 0, opts.explodeRound);
      if (opts.onHit) opts.onHit(e);
      hit = true;
    }
    if (hit) SV.Audio.hit();
    swings.push({ x: p.x, y: p.y, dir: dir, arc: s.arc || 1.2, radius: r, life: 0.13, max: 0.13, color: def.color, weaponId: w.id, visualStyle: def.kind });
  }

  // 以 (x,y) 为圆心的瞬时 AoE 爆炸(不入投射物池);hops>0 时向圈内最近敌人连环引爆(衰减、终止)
  function explodeAt(state, x, y, radius, dmg, color, wid, hops, round) {
    if (round) {
      if (round.remaining <= 0) return;
      const centerKey = Math.round(x) + "," + Math.round(y);
      if (round.centers[centerKey]) return;
      round.centers[centerKey] = true; round.remaining--;
    }
    const near = SV.Spatial.queryCircle(x, y, radius);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp <= 0) continue;
      if (U.dist2(x, y, e.x, e.y) <= radius * radius) dmgEnemy(e, dmg, wid);
    }
    SV.Effects.explosion(x, y, color, 16);
    SV.Effects.ring(x, y, color, 8, radius, 0.3, 3);
    if (hops > 0) {
      let best = null, bd = radius * radius;
      for (let i = 0; i < near.length; i++) {
        const e = near[i];
        if (e.hp <= 0) continue;
        const d = U.dist2(x, y, e.x, e.y);
        const key = Math.round(e.x) + "," + Math.round(e.y);
        if ((!round || !round.centers[key]) && d < bd) { bd = d; best = e; }
      }
      if (best && bd <= radius * radius) explodeAt(state, best.x, best.y, radius * 0.8, dmg * 0.7, color, wid, hops - 1, round);
    }
  }

  // ── 月牙斩(大扇形挥砍;evo 命中留灼烧弧地)
  function fireCrescent(state, w, def, s) {
    const p = state.player;
    const base = aimFrom(p);
    const opts = {};
    for (let k = 0; k < (s.count || 1); k++) {
      const dir = (s.count || 1) > 1 ? base + (k - ((s.count || 1) - 1) / 2) * 0.6 : base;
      swingOnce(state, w, def, s, dir, opts);
      if (def.evo && s.leaveTrail) addArcField({ kind:"sector", x:p.x, y:p.y, dir:dir, arc:s.arc, inner:s.radius*0.7, outer:s.radius, damage:s.damage*0.30, life:1.2, max:1.2, every:0.4, tick:0, color:def.color, wid:w.id });
    }
    SV.Audio.shoot();
  }

  // ── 殉爆重击(多向扇形挥砍,命中按概率以敌为圆心爆炸;evo 必爆且连环)
  function fireDetonate(state, w, def, s) {
    const base = aimFrom(state.player);
    const opts = { explodeChance: s.explodeChance, explodeR: s.explodeR, explodeDmg: s.explodeDmg, chainHops: s.chainHops || 0, hitIds: {}, explodeRound: { remaining: s.explodeBudget || 2, centers: {} } };
    const cnt = s.count || 1;
    for (let k = 0; k < cnt; k++) {
      const dir = cnt > 1 ? base + k * U.TAU / cnt : base;
      swingOnce(state, w, def, s, dir, opts);
    }
    SV.Audio.shoot();
  }

  // ── 贯穿战矛(窄锥前突,沿线全员贯穿;evo 命中破甲短暂易伤)
  function fireSpear(state, w, def, s) {
    const dir = aimFrom(state.player);
    const opts = {};
    if (def.evo && s.armorBreak) opts.armorBreak = s.armorBreak;
    swingOnce(state, w, def, s, dir, opts);
    SV.Audio.shoot(); SV.Effects.shake(1, 0.08);
  }

  // ── 变形术(发射追踪弹,命中敌人变羊;弹体穿过已变羊目标只打新鲜敌人。进化/融合可穿透多发)
  function firePolymorph(state, w, def, s) {
    const p = state.player, arr = state.enemies, locked = {};
    let fired = 0;
    for (let k = 0; k < s.count; k++) {            // 各弹锁定不同的、未变羊的最近敌人
      const best = nearest(p.x, p.y, Infinity, function (e) { return !locked[e.id] && !(e.sheep > 0); });
      if (!best) break;
      locked[best.id] = true;
      const ang = U.angleTo(p.x, p.y, best.x, best.y);
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 7; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.homing = true; pr.seek = 4.5; pr.target = best; pr.weaponId = w.id;
      pr.sheep = true; pr.sheepDur = s.dur; pr.sheepPierce = s.pierce || 0; pr.hitIds = [];
      fired++;
    }
    if (fired) SV.Audio.shoot();
  }

  // ── 时停力场(锁定敌群密集处,天降延迟力场,落地范围冻结;仿陨石定点轰炸,索敌避开玩家近旁)
  function fireTimestop(state, w, def, s) {
    const p = state.player;
    const clusters = denseClusters(p, 460, s.count, 170, C.AIM_MIN_DIST);
    const fallback = { x: p.x + Math.cos(aimFrom(p)) * 200, y: p.y + Math.sin(aimFrom(p)) * 200 };
    const cam = SV.Renderer.cam, sz = SV.Renderer.cssSize();
    const hw = sz.w / 2 / cam.zoom, hh = sz.h / 2 / cam.zoom, IN = 50;
    const clampView = hw > IN && hh > IN;
    for (let k = 0; k < s.count; k++) {
      let c = clusters[k];
      if (!c) { c = clusters[0] || fallback; c = { x: c.x + U.rand(-26, 26), y: c.y + U.rand(-26, 26) }; }
      if (clampView) { c = { x: U.clamp(c.x, cam.x - hw + IN, cam.x + hw - IN), y: U.clamp(c.y, cam.y - hh + IN, cam.y + hh - IN) }; }
      const pr = mkProj();
      pr.x = c.x; pr.y = c.y; pr.vx = 0; pr.vy = 0;
      pr.r = 11; pr.damage = s.damage; pr.life = s.arm; pr.maxLife = s.arm; pr.color = def.color;
      pr.timestop = s.radius; pr.tsFreeze = s.freeze; pr.shatter = !!(def.evo && s.shatter); pr.weaponId = w.id;
      SV.Effects.ring(pr.x, pr.y, def.color, 8, s.radius, s.arm, 4); // 落点预警圈(持续到落地)
    }
    SV.Audio.shoot();
  }

  // ── 旋转光刃(连续)
  function orbit(state, w, def, dt) {
    const p = state.player;
    const s = stats(w, state);
    const blades = p.blades;
    if (blades.length !== s.count) {
      blades.length = 0;
      for (let i = 0; i < s.count; i++) blades.push({ angle: (w.angle || 0) + i / s.count * U.TAU, x: 0, y: 0 });
    }
    w.angle = (w.angle || 0) + s.spin * dt;
    const contactNow = w.id === "blade_evo" ? new Map() : null;
    const contactPrev = contactNow ? (orbitContacts.get(w) || new Map()) : null;
    const cdEvery = hardAttackInterval(state, 0.3);
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i];
      b.angle = (w.angle || 0) + i / blades.length * U.TAU;
      b.x = p.x + Math.cos(b.angle) * s.radius;
      b.y = p.y + Math.sin(b.angle) * s.radius;
      // 最大 Boss 半径为 90；查询半径必须覆盖实际命中半径 16+e.r，不能漏掉静止大目标。
      const near = SV.Spatial.queryCircle(b.x, b.y, 110);
      for (let j = 0; j < near.length; j++) {
        const e = near[j];
        if (e.hp <= 0) continue;
        if (U.dist2(b.x, b.y, e.x, e.y) < (16 + e.r) * (16 + e.r)) {
          if (contactNow) {
            const hit = contactNow.get(e.id);
            if (hit) hit.mask |= 1 << i;
            else contactNow.set(e.id, { enemy: e, mask: 1 << i });
          } else if (e.bladeCd <= 0) {
            dmgEnemy(e, s.damage, w.id); e.bladeCd = cdEvery; SV.Effects.hit(e.x, e.y, def.color); SV.Audio.hit();
          }
        }
      }
    }
    if (contactNow) {
      for (const [enemyId, hit] of contactNow) {
        const previous = contactPrev.get(enemyId);
        const entered = hit.mask & ~(previous ? previous.mask : 0);
        if (!entered) continue;
        const e = hit.enemy;
        if (!e || e.hp <= 0) continue;
        let bits = entered;
        while (bits && e.hp > 0) { dmgEnemy(e, s.damage, w.id); bits &= bits - 1; }
        SV.Effects.hit(e.x, e.y, def.color); SV.Audio.hit();
      }
      orbitContacts.set(w, contactNow);
    }
  }

  // ── 哨卫炮塔(环绕无人机,自动射击)
  function sentryUpdate(state, w, def, dt) {
    const p = state.player;
    const s = stats(w, state);
    const arr = w.sentries || (w.sentries = []);
    if (arr.length !== s.count) {
      arr.length = 0;
      for (let i = 0; i < s.count; i++) arr.push({ angle: i / s.count * U.TAU, x: 0, y: 0, cd: 0 });
    }
    w.angle = (w.angle || 0) + s.spin * dt;
    const locked = {}; // 每帧重建:各塔分头锁定不同目标
    for (let i = 0; i < arr.length; i++) {
      const dr = arr[i];
      dr.angle = (w.angle || 0) + i / arr.length * U.TAU;
      dr.x = p.x + Math.cos(dr.angle) * s.radius;
      dr.y = p.y + Math.sin(dr.angle) * s.radius;
      dr.interceptR = s.interceptR; // 供渲染层画拦截圈
      // 弹幕拦截:塔身接触即消除敌方投射物
      const es = state.eshots;
      for (let k = es.length - 1; k >= 0; k--) {
        if (U.dist2(dr.x, dr.y, es[k].x, es[k].y) < s.interceptR * s.interceptR) {
          SV.Effects.hit(es[k].x, es[k].y, def.color);
          es.splice(k, 1);
          break; // 一塔一帧一次
        }
      }
      dr.cd -= dt;
      if (dr.cd <= 0) {
        const tgt = nearestUnlocked(dr.x, dr.y, locked);
        if (tgt) {
          locked[tgt.id] = true;
          const a = U.angleTo(dr.x, dr.y, tgt.x, tgt.y);
          const pr = mkProj();
          pr.x = dr.x; pr.y = dr.y;
          pr.vx = Math.cos(a) * s.projSpeed; pr.vy = Math.sin(a) * s.projSpeed;
          pr.r = 5; pr.damage = s.damage; pr.life = 1.1; pr.maxLife = 1.1; pr.color = def.color; pr.weaponId = w.id;
          if (def.evo && s.pierce) { pr.pierce = s.pierce; pr.hitIds = []; }
          dr.cd = s.fireCd; SV.Audio.shoot();
        }
      }
    }
  }

  // ── 投射物推进与碰撞
  function updateProjectiles(state, dt) {
    const p = state.player;
    proj.sweep(function (pr) {
      pr.life -= dt;
      if (pr.life <= 0) {
        if (pr.vortexBomb) {
          const n = pr.captures ? Object.keys(pr.captures).length : 0;
          explodeAt(state, pr.x, pr.y, pr.boomR + pr.boomRPer * n, pr.boomBase + pr.boomPer * n, pr.color, pr.weaponId, 0);
        } else if (pr.meteor) explodeMeteor(state, pr); // 陨石落地爆炸
        else if (pr.timestop) explodeTimestop(state, pr); // 时停力场落地冻结
        else if (pr.explode && pr.pierce <= 0) explodeGrenade(state, pr); // 榴弹到时爆炸
        return false;
      }
      // 电浆核弹群:命中后弹体转为附着核，跟随活宿主；宿主死亡则留在最后位置继续脉冲。
      if (pr.plasmaCore) {
        if (pr.target && pr.target.hp > 0) { pr.x = pr.target.x; pr.y = pr.target.y; }
        pr.coreTick -= dt;
        if (pr.coreTick <= 0) {
          pr.coreTick += pr.coreEvery || 0.3;
          splashAt(state, pr.x, pr.y, pr.coreR, pr.coreDmg, pr.color, 10, pr.weaponId);
          SV.Effects.ring(pr.x, pr.y, pr.color, 8, pr.coreR, 0.2, 2);
        }
        return true;
      }
      // 月轮归刃:去程扩张，0.75s 后清空命中表并返航收束；两程各至多命中一次。
      if (pr.moonArc) {
        const age = pr.maxLife - pr.life;
        const returning = age >= pr.moonOutbound;
        if (returning && !pr.returnCleared) { pr.hitIds = []; pr.returnCleared = true; }
        if (!returning) {
          pr.r = U.lerp(pr.moonMinR, pr.moonMaxR, U.clamp(age / pr.moonOutbound, 0, 1));
        } else {
          const rt = U.clamp((age - pr.moonOutbound) / Math.max(0.01, pr.maxLife - pr.moonOutbound), 0, 1);
          pr.r = U.lerp(pr.moonMaxR, pr.moonMinR, rt);
          const a = U.angleTo(pr.x, pr.y, p.x, p.y);
          pr.vx = U.lerp(pr.vx, Math.cos(a) * 420, 1 - Math.exp(-14 * dt));
          pr.vy = U.lerp(pr.vy, Math.sin(a) * 420, 1 - Math.exp(-14 * dt));
          if (U.dist2(pr.x, pr.y, p.x, p.y) < 24 * 24) return false;
        }
        pr.moonTrail -= dt;
        if (pr.moonTrail <= 0) {
          pr.moonTrail += pr.moonTrailEvery;
          addArcField({ kind:"moon", x:pr.x, y:pr.y, dir:Math.atan2(pr.vy,pr.vx), inner:pr.r*0.42, outer:pr.r, damage:pr.moonTrailDmg, life:pr.moonTrailLife, max:pr.moonTrailLife, every:pr.moonTrailTick, tick:0, color:pr.color, wid:pr.weaponId });
        }
      }
      // 贯星长矛光栅:静止的短时横向切割线,每 tick 对线上每敌至多结算一次。
      if (pr.grid) {
        pr.gridTick -= dt;
        if (pr.gridTick <= 0) {
          pr.gridTick += pr.gridEvery || 0.2;
          const dx = Math.cos(pr.gridDir), dy = Math.sin(pr.gridDir);
          const x0 = pr.x - dx * pr.gridLen / 2, y0 = pr.y - dy * pr.gridLen / 2;
          beamDamage(state, x0, y0, dx, dy, pr.gridLen, pr.gridWidth / 2, pr.damage, pr.color, pr.weaponId);
          if (pr.tsFreeze) freezeLine(state, x0, y0, dx, dy, pr.gridLen, pr.gridWidth / 2, pr.tsFreeze);
        }
        return true;
      }
      // 冲击波:扩张环,前沿带内伤害 + 径向击退(命中各一次),长到 max 为止
      if (pr.shockwave) {
        const sw = pr.shockwave;
        pr.r += sw.grow * dt;
        const inner = Math.max(0, pr.r - sw.width);
        const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.r);
        for (let i = 0; i < near.length; i++) {
          const e = near[i];
          if (e.hp <= 0) continue;
          if (pr.hitIds.indexOf(e.id) >= 0) continue;
          const d2 = U.dist2(pr.x, pr.y, e.x, e.y);
          if (d2 <= pr.r * pr.r && d2 >= inner * inner) {
            pr.hitIds.push(e.id);
            dmgEnemy(e, pr.damage, pr.weaponId);
            const a = U.angleTo(pr.x, pr.y, e.x, e.y);
            const kb = Math.min(sw.kb, 36) / Math.max(1, e.mass * 0.5); // 单次击退位移上限 36px,防轻质量敌人被推飞
            e.x += Math.cos(a) * kb; e.y += Math.sin(a) * kb;
            if (sw.freeze) ccFreeze(e, sw.freeze);
            if (sw.shatter) splashAt(state, e.x, e.y, sw.shatter, pr.damage * 0.5, pr.color, 10, pr.weaponId); // 融合:冰碎共振
            SV.Effects.hit(e.x, e.y, pr.color);
          }
        }
        if (pr.r >= sw.max) return false;
        pr.life = Math.max(pr.life, 0.1); // 不因寿命消失,长到 max 为止
        return true; // 跳过追踪/子步进
      }
      // 龙卷风:吸引 + 持续伤害 + 缓慢追踪。吸力限制:Boss 不吸、按质量衰减、单帧位移 ≤90
      if (pr.vortex) {
        pr.vtick -= dt;
        const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.vrad);
        for (let i = 0; i < near.length; i++) {
          const e = near[i];
          if (e.isBoss || e.hp <= 0) continue;
          const a = U.angleTo(e.x, e.y, pr.x, pr.y);
          const d = U.dist(e.x, e.y, pr.x, pr.y) || 1;
          const f = Math.min(pr.pull, d * 4, 90) / Math.max(1, e.mass * 0.5);
          e.x += Math.cos(a) * f * dt; e.y += Math.sin(a) * f * dt;
          if (pr.vtick <= 0) dmgEnemy(e, pr.damage, pr.weaponId);
          if (pr.captures && Object.keys(pr.captures).length < pr.captureMax) pr.captures[e.id] = true;
        }
        if (pr.vtick <= 0) {
          pr.vtick = hardAttackInterval(state, 0.2); SV.Effects.ring(pr.x, pr.y, pr.color, pr.vrad, 8, 0.2, 2); // 向内收缩的环(龙卷是吸引)
        }
        if (pr.vortexBurn) {
          pr.btick -= dt;
          if (pr.btick <= 0) { pr.btick = pr.burnEvery || 0.5; if (state.hazards.length < C.MAX_HAZARDS) state.hazards.push({x:pr.x,y:pr.y,r:pr.burnR,dmg:pr.vortexBurn,life:pr.burnDur,max:pr.burnDur,color:"#ff9d55",kind:"scorch",tick:0.5,wid:pr.weaponId}); }
        }
        // 裂空风暴:双向激光以龙卷为中心旋转,不再像龙卷向外发射单束光线。
        if (pr.beamLen) {
          pr.phase = (pr.phase || 0) + (pr.beamSpin || 2) * dt;
          const dx = Math.cos(pr.phase), dy = Math.sin(pr.phase);
          const half = pr.beamLen / 2;
          pr.btick -= dt;
          if (pr.btick <= 0) {
            pr.btick = pr.beamTick || 0.1;
            beamDamage(state, pr.x - dx * half, pr.y - dy * half, dx, dy, pr.beamLen, pr.beamWidth / 2, pr.beamDmg || pr.damage, pr.color, pr.weaponId);
          }
        }
        const tgt = nearest(pr.x, pr.y, 99999);
        if (tgt) {
          const a = U.angleTo(pr.x, pr.y, tgt.x, tgt.y);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          const cur = Math.atan2(pr.vy, pr.vx);
          const turn = U.clamp(Math.atan2(Math.sin(a - cur), Math.cos(a - cur)), -1, 1) * 2;
          const ca = cur + turn * dt;
          pr.vx = Math.cos(ca) * sp; pr.vy = Math.sin(ca) * sp;
        }
      }
      // 旧版移动力场兼容分支；当前电浆核弹群不再设置 fieldR。
      if (pr.fieldR) {
        pr.fieldTick -= dt;
        const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.fieldR);
        for (let i=0;i<near.length;i++) { const e=near[i]; if(e.hp<=0)continue; const d=U.dist(e.x,e.y,pr.x,pr.y); if(d>pr.fieldR)continue; if(!e.isBoss){const a=U.angleTo(e.x,e.y,pr.x,pr.y),f=Math.min(pr.fieldPull,d*3)*dt;e.x+=Math.cos(a)*f;e.y+=Math.sin(a)*f;} if(pr.fieldTick<=0)dmgEnemy(e,pr.fieldDmg,pr.weaponId); }
        if(pr.fieldTick<=0){pr.fieldTick=pr.fieldEvery||.25;SV.Effects.ring(pr.x,pr.y,pr.color,pr.fieldR,8,.15,2);}
      }
      // 回旋镖:半程后返航(强追踪 + 返航保护:寿命钳底,必须回到玩家身边才消失)
      if (pr.shape === "star") {
        pr.rot += pr.spin * dt;
        if (pr.life < pr.maxLife * 0.5) {
          if (pr.returnHit && !pr.returnCleared) { pr.hitIds = []; pr.returnCleared = true; }
          const a = U.angleTo(pr.x, pr.y, p.x, p.y);
          pr.vx = U.lerp(pr.vx, Math.cos(a) * 380, 1 - Math.exp(-12 * dt));
          pr.vy = U.lerp(pr.vy, Math.sin(a) * 380, 1 - Math.exp(-12 * dt));
          if (U.dist2(pr.x, pr.y, p.x, p.y) < 26 * 26) return false;
          if (pr.life < 0.3) pr.life = 0.3; // 返航保护:不因寿命归零而消失
        }
      }
      // 追踪
      if (pr.homing) {
        // 目标死亡,或变形弹的目标已被变羊(常为同轮兄弟弹先命中)→ 立即重锁新鲜目标:
        // 否则弹体一路追到已变羊目标身上,穿羊不命中,整发浪费。
        if (!pr.target || pr.target.hp <= 0 || (pr.sheep && pr.target.sheep > 0)) pr.target = pr.sheep ? nearestFresh(pr.x, pr.y) : nearest(pr.x, pr.y, 99999);
        if (pr.target) {
          const a = U.angleTo(pr.x, pr.y, pr.target.x, pr.target.y);
          const sp = Math.hypot(pr.vx, pr.vy) || 1;
          // 转弯半径 = sp/seek。距离已小于转弯半径时,受限转向只会绕着目标兜圈
          // (直到寿命耗尽也打不中);此时直接令航向对准目标,保证收敛命中。
          if (U.dist(pr.x, pr.y, pr.target.x, pr.target.y) * pr.seek <= sp) {
            pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
          } else {
            const cur = Math.atan2(pr.vy, pr.vx);
            const turn = U.clamp(Math.atan2(Math.sin(a - cur), Math.cos(a - cur)), -1, 1) * pr.seek;
            const ca = cur + turn * dt;
            pr.vx = Math.cos(ca) * sp; pr.vy = Math.sin(ca) * sp;
          }
        }
      }
      // 制导天矛:低速追踪完成校准后沿当前航向骤然加速,兼具导弹制导与轨道炮贯穿感。
      if (pr.calibrate > 0) {
        pr.calibrate -= dt;
        if (pr.calibrate <= 0 && pr.finalSpeed > 0) {
          const a = Math.atan2(pr.vy, pr.vx);
          pr.vx = Math.cos(a) * pr.finalSpeed; pr.vy = Math.sin(a) * pr.finalSpeed;
          pr.homing = false; pr.target = null;
        }
      }
      // 子步进移动(防穿透)
      const sp = Math.hypot(pr.vx, pr.vy);
      const n = Math.min(8, Math.ceil(sp * dt / 6));
      let consumed = false;
      for (let si = 0; si < n; si++) {
        pr.x += pr.vx * dt / n; pr.y += pr.vy * dt / n;
        if (collideOne(state, pr)) { consumed = true; break; }
      }
      // 持续光束在移动完成后贴住龙卷的新中心；角度仍由上方逐帧推进。
      if (pr.beamRef) {
        const dx = Math.cos(pr.phase), dy = Math.sin(pr.phase), half = pr.beamLen / 2;
        pr.beamRef.pts = [[pr.x - dx * half, pr.y - dy * half], [pr.x + dx * half, pr.y + dy * half]];
      }
      if (!consumed && sp > 1 && !pr.vortex && ((pr.tc = (pr.tc || 0) + 1) % 2 === 0)) SV.Effects.trail(pr.x, pr.y, pr.color);
      return !consumed;
    });
  }

  function resonanceHit(state, e, pr) {
    if ((e._resonanceT || 0) <= 0) e._resonanceHits = 0;
    e._resonanceT = pr.resonanceWindow; e._resonanceHits = (e._resonanceHits || 0) + 1;
    if (e._resonanceHits < pr.resonanceHits || (e._resonanceLock || 0) > 0) return;
    e._resonanceHits = 0; e._resonanceLock = pr.resonanceLock;
    splashAt(state, e.x, e.y, pr.boomR, pr.boomBase, pr.color, 12, pr.weaponId);
    const near = SV.Spatial.queryCircle(e.x, e.y, pr.boomR);
    for (let i=0;i<near.length;i++) { const o=near[i],a=U.angleTo(e.x,e.y,o.x,o.y),kb=Math.min(pr.boomPer,36)/Math.max(1,o.mass*.5);o.x+=Math.cos(a)*kb;o.y+=Math.sin(a)*kb; }
  }

  function collideOne(state, pr) {
    if (pr.vortex || pr.shockwave || pr.meteor || pr.timestop || pr.plasmaCore) return false; // 持续场不硬碰撞
    const near = SV.Spatial.queryCircle(pr.x, pr.y, pr.r + (pr.moonArc ? 60 : 30));
    for (let j = 0; j < near.length; j++) {
      const e = near[j];
      if (e.hp <= 0) continue;
      if (pr.hitIds && pr.hitIds.indexOf(e.id) >= 0) continue;
      if (pr.sheep && e.sheep > 0) continue; // 变形弹穿过已变羊敌人,只打新鲜目标(不浪费弹)
      if (U.dist2(pr.x, pr.y, e.x, e.y) < (pr.r + e.r) * (pr.r + e.r)) {
        if (pr.plasmaPayload) {
          dmgEnemy(e, pr.damage, pr.weaponId); SV.Effects.hit(e.x, e.y, pr.color); SV.Audio.hit();
          pr.plasmaPayload = false; pr.plasmaCore = true; pr.homing = false; pr.target = e;
          pr.vx = 0; pr.vy = 0; pr.life = pr.coreLife; pr.maxLife = pr.life; pr.coreTick = 0;
          return false;
        }
        // 穿透类(railgun / 回旋 / 霰弹进化);回旋镖(shape=star)命中永不消失,靠 hitIds 去重
        if (pr.pierce > 0 || pr.shape === "star") {
          if (pr.hitIds) pr.hitIds.push(e.id);
          dmgEnemy(e, pr.damage, pr.weaponId); SV.Effects.hit(e.x, e.y, pr.color); SV.Audio.hit();
          if (pr.explode) { explodeGrenade(state, pr); if (!pr.explodeEvery) pr.explode = 0; } // railgun_evo 首爆一次;轨道轰炸每穿必爆
          if (pr.pierce > 0) pr.pierce--; // 仅在有界 pierce 时递减;star 恒不消亡
          if (pr.resonance) resonanceHit(state, e, pr);
          if ((pr.chaseInfinite || pr.chaseKills > 0) && e.hp <= 0) { if (!pr.chaseInfinite) pr.chaseKills--; pr.damage *= pr.chaseDecay; pr.target = null; }
          return false;
        }
        // 榴弹:碰撞即爆炸并消耗
        if (pr.explode) { explodeGrenade(state, pr); return true; }
        // 变形弹:命中变羊(+融合附冻结),进化/融合可穿透多发;穿羊逻辑由循环顶 continue 保证
        if (pr.sheep) {
          if (!pr.hitIds) pr.hitIds = [];
          pr.hitIds.push(e.id);
          dmgEnemy(e, pr.damage, pr.weaponId);
          ccSheep(e, pr.sheepDur);
          if (pr.sheepFreeze) ccFreeze(e, pr.sheepFreeze);
          if (pr.sheepBomb) {
            e.sheepBomb = true; e.sheepBombDone = false; e.sheepBombMax = e.sheep;
            e.sheepBombDmg = pr.sheepBombDmg; e.sheepBombRadius = pr.sheepBombRadius;
            e.sheepBombFreeze = pr.tsFreeze; e.sheepBombWid = pr.weaponId;
            e.sheepBombSpreadChance = pr.spreadChance || 0; e.sheepBombSpreadDur = pr.spreadDur || 0;
          }
          SV.Effects.text(e.x, e.y - e.r - 6, L("BAA", "咩"), pr.color, 13);
          if (pr.sheepPierce > 0) { pr.sheepPierce--; return false; } // 进化/融合:穿透继续
          return true;                                            // 基础:命中即消耗(单体)
        }
        // 普通命中
        dmgEnemy(e, pr.damage, pr.weaponId); SV.Effects.hit(e.x, e.y, pr.color); SV.Audio.hit();
        if (pr.resonance) resonanceHit(state, e, pr);
        // 命中连锁/溅射必须先结算:首目标被击杀也不能吞掉群攻效果。
        if (pr.chainHops > 0) chainBurst(state, e.x, e.y, pr.damage * 0.6, pr.chainHops, pr.chainRange, pr.color, 1.1, pr.weaponId);
        if (pr.splash) splashAt(state, pr.x, pr.y, pr.splash, pr.damage * pr.splashMul, pr.color, 10, pr.weaponId);
        // 处决追击:击杀目标后弹体不消失,按武器倍率重锁继续追猎。
        if ((pr.chaseInfinite || pr.chaseKills > 0) && e.hp <= 0) {
          if (!pr.chaseInfinite) pr.chaseKills--;
          pr.damage *= pr.chaseDecay;
          pr.target = null;
          return false;
        }
        return true;
      }
    }
    return false;
  }

  // ── 协同进化────────────────────────────────────
  // 湮灭之轮:8 刃环绕 + 刃刃溅射 + 黑洞聚怪(连续武器)
  function fusionBladeAura(state, w, def, dt) {
    const p = state.player;
    const s = stats(w, state);
    const blades = p.blades;
    if (blades.length !== s.count) {
      blades.length = 0;
      for (let i = 0; i < s.count; i++) blades.push({ angle: (w.angle || 0) + i / s.count * U.TAU, x: 0, y: 0 });
    }
    w.angle = (w.angle || 0) + s.spin * dt;
    // 圆盘脉冲(aura 本体功能):周期对完整刃轨道内的敌人造成伤害。
    w.cd = (w.cd || 0) - dt;
    if (w.cd <= 0) {
      w.cd = hardAttackInterval(state, s.auraTick);
      const disk = SV.Spatial.queryCircle(p.x, p.y, s.radius);
      for (let i = 0; i < disk.length; i++) {
        const e = disk[i];
        if (e.hp > 0 && U.dist2(p.x, p.y, e.x, e.y) <= s.radius * s.radius) dmgEnemy(e, s.auraDamage, w.id);
      }
    }
    p.bladeAuraVisual = { radius: s.radius, pulse: 1 - Math.max(0, w.cd) / hardAttackInterval(state, s.auraTick), color: def.color };
    // 吸力把敌人夹取到刃轨道内沿，既不会跨轨道，也不会因大 dt 越过停止点。
    const stopRadius = s.radius * s.pullStopRatio;
    const near = SV.Spatial.queryCircle(p.x, p.y, s.radius * s.pullRangeMul);
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.isBoss || e.hp <= 0) continue;
      const d = U.dist(e.x, e.y, p.x, p.y);
      if (d > stopRadius) {
        const a = U.angleTo(e.x, e.y, p.x, p.y);
        const f = Math.min(Math.min(s.pull, d * 3) * dt, d - stopRadius);
        e.x += Math.cos(a) * f; e.y += Math.sin(a) * f;
      }
    }
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i];
      b.angle = (w.angle || 0) + i / blades.length * U.TAU;
      b.x = p.x + Math.cos(b.angle) * s.radius;
      b.y = p.y + Math.sin(b.angle) * s.radius;
      const nb = SV.Spatial.queryCircle(b.x, b.y, 110).slice(); // 大体型目标 + 爆炸的嵌套网格查询
      for (let j = 0; j < nb.length; j++) {
        const e = nb[j];
        if (e.hp <= 0) continue;
        if (U.dist2(b.x, b.y, e.x, e.y) < (16 + e.r) * (16 + e.r) && e.bladeCd <= 0) {
          dmgEnemy(e, s.damage, w.id); e.bladeCd = hardAttackInterval(state, s.bladeTick);
          splashAt(state, b.x, b.y, s.splash, s.splashDamage, def.color, 10, w.id);
          SV.Effects.hit(b.x, b.y, def.color); SV.Audio.hit();
        }
      }
    }
  }
  // 雷暴蜂群:分裂追踪弹 + 命中连锁闪电
  function fusionMissileChain(state, w, def, s) {
    const p = state.player, locked = {};
    for (let k = 0; k < s.count; k++) {
      const tgt = nearestUnlocked(p.x, p.y, locked) || nearest(p.x, p.y, 99999);
      if (tgt) locked[tgt.id] = true;
      const ang = tgt ? U.angleTo(p.x, p.y, tgt.x, tgt.y) : p.facing;
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 6; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.homing = true; pr.seek = s.seek; pr.target = tgt; pr.weaponId = w.id;
      pr.chaseKills = s.chase || 0; pr.chaseDecay = s.chaseDecay == null ? 1 : s.chaseDecay;
      pr.chainHops = s.chainHops || 0; pr.chainRange = s.chainRange || 0;
    }
    SV.Audio.shoot();
  }
  // 轨道轰炸:贯穿弹 + 每穿透爆炸 + 首命中分裂子榴弹
  function fusionRailgunGrenade(state, w, def, s) {
    const p = state.player;
    const ang = bestPierceAngle(state, p, s.speed * 0.7, 9, s.explode);
    const pr = mkProj();
    pr.x = p.x; pr.y = p.y;
    pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
    pr.r = 9; pr.damage = s.damage; pr.life = 0.7; pr.maxLife = 0.7; pr.color = def.color;
    pr.pierce = 99; pr.hitIds = []; pr.weaponId = w.id;
    pr.explode = s.explode; pr.explodeEvery = true; pr.cluster = s.cluster;
    beams.push({ pts: [[p.x, p.y], [p.x + Math.cos(ang) * 60, p.y + Math.sin(ang) * 60]], life: 0.08, max: 0.08, color: def.color, width: 5 });
    SV.Audio.shoot();
    SV.Effects.shake(2, 0.1);
  }
  // 冰霜瘟疫:冰爆上毒 + 冻结(冻结目标受伤 ×1.5 由 dmgEnemy 的 vuln 天然生效)
  function fusionFrostPoison(state, w, def, s) {
    const p = state.player;
    const near = SV.Spatial.queryCircle(p.x, p.y, s.radius).slice();
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (U.dist2(p.x, p.y, e.x, e.y) <= s.radius * s.radius) {
        dmgEnemy(e, s.damage, w.id);
        ccSlow(e, s.slowDur, s.slow);
        if (!(e.frozen > 0)) {
          e._plagueHits = (e._plagueHits || 0) + 1;
          if (e._plagueHits >= (s.freezeHits || 1)) { e._plagueHits = 0; ccFreeze(e, s.freeze || 0); }
        }
        e.poisonStacks = Math.min(3, (e.poisonStacks || 0) + 1); // 毒叠层
        e.poison = s.dotDur; e.poisonDmg = s.dot * (1 + 0.4 * (e.poisonStacks - 1)); e.poisonTick = 0; e.poisonWid = w.id;
      }
    }
    SV.Effects.ring(p.x, p.y, def.color, 10, s.radius, 0.45, 4);
    SV.Effects.shake(3, 0.15);
  }
  // 裂空风暴:龙卷聚怪 + 光束绕龙卷风旋转切割(连续 fire 弹体;光束独立伤害)
  function fusionLanceVortex(state, w, def, s) {
    const p = state.player;
    const count = s.count || 1;
    const angles = vortexAngles(state, p, count);
    for (let k = 0; k < count; k++) {
      const ang = angles[k];
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 12; pr.vrad = s.vrad; pr.pull = s.pull;
      pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.vortex = true; pr.vtick = 0; pr.weaponId = w.id;
      pr.beamLen = s.beamLen; pr.beamWidth = s.beamWidth; pr.beamDmg = s.beamDmg; pr.beamTick = s.beamTick || 0.1; pr.beamSpin = s.beamSpin;
      pr.btick = 0;
      pr.beamRef = { pts: [[pr.x, pr.y], [pr.x, pr.y]], life: Infinity, max: Infinity, color: pr.color, width: pr.beamWidth, lance: true, evo: true };
      beams.push(pr.beamRef);
    }
    SV.Audio.shoot();
  }
  // 爆裂霰弹:锥形弹幕 + 每发命中溅射
  function fusionShotgunGrenade(state, w, def, s) {
    const p = state.player;
    const dir = aimFrom(p);
    for (let k = 0; k < s.count; k++) {
      const a = dir + (k - (s.count - 1) / 2) * (s.cone / Math.max(1, s.count));
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
      pr.r = 5; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color; pr.weaponId = w.id;
      pr.splash = s.splash; pr.splashMul = s.splashMul;
    }
    SV.Audio.shoot();
  }
  // 风暴哨戒:哨卫抛射去返回旋镖(连续武器)
  function fusionSentryBoomerang(state, w, def, dt) {
    const p = state.player;
    const s = stats(w, state);
    const arr = w.sentries || (w.sentries = []);
    if (arr.length !== s.count) {
      arr.length = 0;
      for (let i = 0; i < s.count; i++) arr.push({ angle: i / s.count * U.TAU, x: 0, y: 0, cd: 0 });
    }
    w.angle = (w.angle || 0) + s.spin * dt;
    const locked = {};
    for (let i = 0; i < arr.length; i++) {
      const dr = arr[i];
      dr.angle = (w.angle || 0) + i / arr.length * U.TAU;
      dr.x = p.x + Math.cos(dr.angle) * s.radius;
      dr.y = p.y + Math.sin(dr.angle) * s.radius;
      dr.interceptR = s.interceptR; // 供渲染层画拦截圈
      // 弹幕拦截:塔身接触即消除敌方投射物
      const es = state.eshots;
      for (let k = es.length - 1; k >= 0; k--) {
        if (U.dist2(dr.x, dr.y, es[k].x, es[k].y) < s.interceptR * s.interceptR) {
          SV.Effects.hit(es[k].x, es[k].y, def.color);
          es.splice(k, 1);
          break;
        }
      }
      dr.cd -= dt;
      if (dr.cd <= 0) {
        const tgt = nearestUnlocked(dr.x, dr.y, locked);
        if (tgt) {
          locked[tgt.id] = true;
          const a = U.angleTo(dr.x, dr.y, tgt.x, tgt.y);
          const pr = mkProj();
          pr.x = dr.x; pr.y = dr.y;
          pr.vx = Math.cos(a) * s.projSpeed; pr.vy = Math.sin(a) * s.projSpeed;
          pr.r = 7; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color; pr.weaponId = w.id;
          pr.shape = "star"; pr.spin = 14; pr.pierce = s.pierce; pr.hitIds = []; // spin=14 为子弹自转(与公转解耦)
          dr.cd = s.fireCd; SV.Audio.shoot();
        }
      }
    }
  }

  // ── 协同进化:两武器槽合并为一个融合武器
  function fuse(state, combo) {
    const ids = {}; ids[combo.w1] = true; ids[combo.w2] = true;
    for (let i = state.weapons.length - 1; i >= 0; i--) {
      if (ids[state.weapons[i].id]) state.weapons.splice(i, 1);
    }
    // 记录被合掉的成分 base id:不再作为新武器重发
    state.everOwned = state.everOwned || {};
    state.everOwned[combo.w1.replace(/_evo$/, "")] = true;
    state.everOwned[combo.w2.replace(/_evo$/, "")] = true;
    state.weapons.push({ id: combo.to, level: 1, cd: 0, angle: 0, evolved: true });
    // Eight evolved blades and eight fusion blades have different runtime fields despite the same count.
    if (combo.w1 === 'blade_evo' || combo.w2 === 'blade_evo') state.player.blades = [];
    state.evolutions++;
    SV.Audio.evolve();
    SV.Effects.levelBurst(state.player.x, state.player.y);
    SV.Effects.shake(8, 0.4);
  }

  // ── 进化
  function evolve(state, baseWeaponId) {
    const evo = SV.Config.EVOLUTIONS[baseWeaponId];
    if (!evo) return;
    for (let i = 0; i < state.weapons.length; i++) {
      if (state.weapons[i].id === baseWeaponId) {
        state.weapons[i].id = evo.to;
        state.weapons[i].evolved = true;
        state.weapons[i].cd = 0;
        state.evolutions++;
        SV.Audio.evolve();
        SV.Effects.levelBurst(state.player.x, state.player.y);
        SV.Effects.shake(8, 0.4);
        return;
      }
    }
  }

  // ── 血月断头台(融合:巨型挥砍,命中必爆且连环引爆)
  function fusionCrescentDetonate(state, w, def, s) {
    const base = aimFrom(state.player);
    const opts = { explodeChance: s.explodeChance || 1.0, explodeR: s.explodeR, explodeDmg: s.explodeDmg, chainHops: s.chainHops || 0, hitIds: {}, explodeRound: { remaining: s.explodeBudget || 5, centers: {} } };
    for (let k = 0; k < (s.count || 1); k++) {
      const dir = (s.count || 1) > 1 ? base + (k - ((s.count || 1) - 1) / 2) * 0.6 : base;
      swingOnce(state, w, def, s, dir, opts);
    }
    SV.Audio.shoot(); SV.Effects.shake(3, 0.15);
  }
  // ── 时之诅咒(融合:追踪弹命中同时变羊与冻结,贯穿双重禁锢)
  function fusionPolymorphTimestop(state, w, def, s) {
    const p = state.player, arr = state.enemies, locked = {};
    let fired = 0;
    for (let k = 0; k < (s.count || 1); k++) {      // 各弹锁定不同的、未变羊的最近敌人
      const best = nearest(p.x, p.y, Infinity, function (e) { return !locked[e.id] && !(e.sheep > 0); });
      if (!best) break;
      locked[best.id] = true;
      const ang = U.angleTo(p.x, p.y, best.x, best.y);
      const pr = mkProj();
      pr.x = p.x; pr.y = p.y;
      pr.vx = Math.cos(ang) * s.speed; pr.vy = Math.sin(ang) * s.speed;
      pr.r = 8; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.homing = true; pr.seek = 4.5; pr.target = best; pr.weaponId = w.id;
      pr.sheep = true; pr.sheepDur = s.dur; pr.sheepPierce = s.pierce || 1; pr.hitIds = [];
      pr.sheepBomb = true; pr.sheepBombDmg = s.bombDmg; pr.sheepBombRadius = s.bombRadius; pr.tsFreeze = s.freeze;
      fired++;
    }
    if (fired) { SV.Audio.hit(); SV.Effects.shake(4, 0.2); }
  }
  // ── 贯星长矛(融合:窄线贯刺命中沿途全员,命中点建立与矛路垂直的持续光栅)
  function fusionSpearLance(state, w, def, s) {
    const p = state.player;
    const dir = aimFrom(p);
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const mx = p.x + dx * s.radius / 2, my = p.y + dy * s.radius / 2;
    const near = SV.Spatial.queryCircle(mx, my, s.radius / 2 + 60);
    const hits = [];
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.hp <= 0) continue;
      const ex = e.x - p.x, ey = e.y - p.y;
      const along = ex * dx + ey * dy;
      if (along < 0 || along > s.radius) continue;
      const side = Math.abs(ex * dy - ey * dx);
      if (side > e.r + s.width / 2) continue;
      dmgEnemy(e, s.damage, w.id);
      e.armorBreak = Math.max(e.armorBreak || 0, s.armorBreak);
      SV.Effects.hit(e.x, e.y, def.color);
      hits.push({ e: e, along: along });
    }
    // "最靠前"按矛尖方向的投影排序,只保留推进最远的四个节点。
    hits.sort(function (a, b) { return b.along - a.along; });
    for (let i = 0; i < hits.length && i < s.gridMax; i++) {
      const pr = mkProj(), e = hits[i].e;
      pr.x = e.x; pr.y = e.y; pr.vx = 0; pr.vy = 0; pr.r = s.gridWidth / 2;
      pr.damage = s.gridDmg; pr.life = s.gridLife; pr.maxLife = s.gridLife; pr.color = def.color; pr.weaponId = w.id;
      pr.grid = true; pr.gridDir = dir + Math.PI / 2; pr.gridLen = s.gridLen; pr.gridTick = 0; pr.gridLife = s.gridLife; pr.gridEvery = s.gridTick; pr.gridWidth = s.gridWidth;
    }
    beams.push({ pts: [[p.x, p.y], [p.x + dx * s.radius, p.y + dy * s.radius]], life: 0.16, max: 0.16, color: def.color, width: s.width, weaponId: w.id, visualStyle: "spear" });
    SV.Audio.shoot(); SV.Effects.shake(2, 0.1);
  }

  // ── 新协同进化。尽量复用既有投射物、光束、挥砍与状态管线。──
  function spawnHoming(state, w, def, s, k, locked) {
    const p = state.player, tgt = (locked && nearestUnlocked(p.x, p.y, locked)) || nearest(p.x, p.y, 99999);
    if (!tgt) return null;
    if (locked) locked[tgt.id] = true;
    const step = (s.spread || 0.24) / Math.max(1, (s.count || 1) - 1);
    const a = U.angleTo(p.x, p.y, tgt.x, tgt.y) + ((k || 0) - ((s.count || 1) - 1) / 2) * step;
    const pr = mkProj();
    pr.x = p.x; pr.y = p.y; pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
    pr.r = 7; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
    pr.homing = true; pr.seek = s.seek || 5; pr.target = tgt; pr.weaponId = w.id;
    return pr;
  }
  function fusionMissileAura(state, w, def, s) {
    const locked = {};
    for (let k = 0; k < s.count; k++) {
      const pr = spawnHoming(state, w, def, s, k, locked); if (!pr) continue;
      pr.plasmaPayload = true; pr.coreR = s.coreR; pr.coreDmg = s.coreDmg;
      pr.coreEvery = s.coreTick; pr.coreLife = s.coreLife;
    }
    SV.Audio.shoot();
  }
  function fusionMissileRailgun(state, w, def, s) {
    const locked = {};
    for (let k = 0; k < s.count; k++) {
      const pr = spawnHoming(state, w, def, s, k, locked); if (!pr) continue;
      const a = Math.atan2(pr.vy, pr.vx);
      pr.vx = Math.cos(a) * s.speed * 0.36; pr.vy = Math.sin(a) * s.speed * 0.36;
      pr.calibrate = s.calibrate; pr.finalSpeed = s.speed;
      pr.pierce = s.pierce; pr.hitIds = [];
    }
    SV.Audio.shoot();
  }
  function fusionShotgunShockwave(state, w, def, s) {
    const p = state.player, dir = aimFrom(p);
    for (let k = 0; k < s.count; k++) {
      const a = dir + (k - (s.count - 1) / 2) * s.cone / Math.max(1, s.count);
      const pr = mkProj(); pr.x = p.x; pr.y = p.y; pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
      pr.r = 5; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color; pr.weaponId = w.id;
      pr.pierce = s.pierce; pr.hitIds = []; pr.resonance = true;
      pr.resonanceHits = s.resonanceHits; pr.resonanceWindow = s.resonanceWindow; pr.resonanceLock = s.resonanceLock;
      pr.boomBase = s.burstDmg; pr.boomR = s.burstR; pr.boomPer = s.knock;
    }
    SV.Audio.shoot();
  }
  function fusionShotgunSpear(state, w, def, s) {
    const p = state.player, dir = aimFrom(p), dx = Math.cos(dir), dy = Math.sin(dir);
    let made = 0;
    swingOnce(state, w, def, s, dir, { armorBreak: s.armorBreak, onHit: function (e) {
      for (let k = 0; k < s.pelletCount && made < s.pelletCap; k++, made++) {
        const a = dir + (k - (s.pelletCount - 1) / 2) * s.pelletCone / Math.max(1, s.pelletCount - 1);
        const pr = mkProj(); pr.x = e.x + dx * e.r; pr.y = e.y + dy * e.r;
        pr.vx = Math.cos(a) * s.pelletSpeed; pr.vy = Math.sin(a) * s.pelletSpeed; pr.r = 4;
        pr.damage = s.pelletDamage; pr.life = s.pelletLife; pr.maxLife = s.pelletLife; pr.color = def.color; pr.weaponId = w.id;
      }
    }});
    SV.Audio.shoot();
  }
  function fusionBoomerangCrescent(state, w, def, s) {
    const p = state.player, base = aimFrom(p);
    for (let k = 0; k < s.count; k++) {
      const a = base + (k - (s.count - 1) / 2) * s.spread;
      const pr = mkProj(); pr.x = p.x; pr.y = p.y; pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
      pr.r = s.minR; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
      pr.visualStyle = "moonArc"; pr.pierce = 99; pr.hitIds = []; pr.weaponId = w.id;
      pr.moonArc = true; pr.moonOutbound = s.outbound; pr.moonMinR = s.minR; pr.moonMaxR = s.maxR;
      pr.moonTrail = 0; pr.moonTrailEvery = s.trailEvery; pr.moonTrailLife = s.trailLife; pr.moonTrailTick = s.trailTick; pr.moonTrailDmg = s.trailDmg;
    }
    SV.Audio.shoot();
  }
  function fusionGrenadeMeteor(state, w, def, s) {
    const p = state.player, clusters = denseClusters(p, 460, s.count, 170, C.AIM_MIN_DIST);
    const a = aimFrom(p), fallback = { x: p.x + Math.cos(a) * 210, y: p.y + Math.sin(a) * 210 };
    for (let i = 0; i < s.count; i++) {
      const target = clusters[i] || clusters[0] || fallback;
      const spread = clusters.length ? i - clusters.length + 1 : i;
      const cx = clusters[i] ? target.x : target.x + spread * 140 * -Math.sin(a);
      const cy = clusters[i] ? target.y : target.y + spread * 140 * Math.cos(a);
      const parent = mkProj(); parent.x = cx; parent.y = cy; parent.r = 12; parent.damage = s.damage;
      parent.life = 0.45; parent.maxLife = 0.45; parent.color = def.color; parent.meteor = s.radius; parent.weaponId = w.id;
      SV.Effects.ring(cx, cy, def.color, 8, s.radius, 0.45, 4);
      for (let k = 0; k < s.childCount; k++) {
        const ang = k / s.childCount * U.TAU + 0.4, d = 70;
        const pr = mkProj(); pr.x = cx + Math.cos(ang) * d; pr.y = cy + Math.sin(ang) * d;
        pr.r = 10; pr.damage = s.childDmg; pr.life = 0.6 + k * s.childDelay; pr.maxLife = pr.life; pr.color = def.color;
        pr.meteor = s.childR; pr.burn = s.burn; pr.burnDur = s.burnDur; pr.weaponId = w.id;
        SV.Effects.ring(pr.x, pr.y, def.color, 8, s.childR, pr.life, 3);
      }
    }
    SV.Audio.shoot();
  }
  function freezeLine(state, x0, y0, dx, dy, len, halfW, dur) {
    const near = SV.Spatial.queryCircle(x0 + dx * len / 2, y0 + dy * len / 2, len / 2 + 70);
    for (let i = 0; i < near.length; i++) {
      const e = near[i], along = (e.x - x0) * dx + (e.y - y0) * dy;
      if (along < 0 || along > len) continue;
      const side = Math.abs((e.x - x0) * dy - (e.y - y0) * dx);
      if (side <= halfW + e.r) ccFreeze(e, dur);
    }
  }
  function fusionRailgunTimestop(state, w, def, s) {
    const p = state.player, a = bestPierceAngle(state, p, s.length, 5, 0), dx = Math.cos(a), dy = Math.sin(a);
    beamDamage(state, p.x, p.y, dx, dy, s.length, 5, s.damage, def.color, w.id);
    freezeLine(state, p.x, p.y, dx, dy, s.length, s.corridorWidth / 2, s.freeze);
    const pr = mkProj(); pr.x = p.x + dx * s.length / 2; pr.y = p.y + dy * s.length / 2; pr.r = s.corridorWidth / 2;
    pr.damage = s.corridorDmg; pr.life = s.corridorLife; pr.maxLife = pr.life; pr.color = def.color; pr.weaponId = w.id;
    pr.grid = true; pr.gridDir = a; pr.gridLen = s.length; pr.gridEvery = s.corridorTick; pr.gridTick = 0; pr.gridWidth = s.corridorWidth; pr.tsFreeze = 0.18;
    beams.push({ pts: [[p.x, p.y], [p.x + dx * s.length, p.y + dy * s.length]], life: 0.18, max: 0.18, color: def.color, width: 9, weaponId: w.id, visualStyle: "rail" });
    SV.Audio.shoot();
  }
  function makeFusionVortex(state, w, def, s, a) {
    const p = state.player;
    const pr = mkProj(); pr.x = p.x; pr.y = p.y; pr.vx = Math.cos(a) * s.speed; pr.vy = Math.sin(a) * s.speed;
    pr.r = 12; pr.damage = s.damage; pr.life = s.life; pr.maxLife = s.life; pr.color = def.color;
    pr.vortex = true; pr.vrad = s.radius; pr.pull = s.pull; pr.vtick = 0; pr.weaponId = w.id; return pr;
  }
  function fusionVortexMeteor(state, w, def, s) {
    const angles = vortexAngles(state, state.player, s.count);
    for (let k = 0; k < s.count; k++) { const pr = makeFusionVortex(state, w, def, s, angles[k]); pr.vortexBurn = s.burn; pr.burnR = s.burnR; pr.burnDur = s.burnDur; pr.burnEvery = s.trailTick; pr.btick = 0; }
    SV.Audio.shoot();
  }
  function fusionVortexDetonate(state, w, def, s) {
    const angles = vortexAngles(state, state.player, s.count);
    for (let k = 0; k < s.count; k++) { const pr = makeFusionVortex(state, w, def, s, angles[k]); pr.vortexBomb = true; pr.captures = {}; pr.captureMax = s.captureMax; pr.boomBase = s.boomBase; pr.boomPer = s.boomPer; pr.boomR = s.boomR; pr.boomRPer = s.boomRPer; }
    SV.Audio.shoot();
  }
  function fusionShockwavePolymorph(state, w, def, s) {
    const base = aimFrom(state.player), seen = {}, limit = { n: 0 };
    const onHit = function (e) {
      if (seen[e.id]) return; seen[e.id] = true;
      if (e.sheep > 0 && e._herdWid === w.id) { explodeAt(state, e.x, e.y, s.collideR, s.collideDmg, def.color, w.id, 0); e.sheep = 0; e._herdWid = ""; }
      else if (limit.n < s.sheepMax) { ccSheep(e, s.sheep); e._herdWid = w.id; limit.n++; }
    };
    for (let k = 0; k < s.count; k++) swingOnce(state, w, def, s, base + k * U.TAU / s.count, { knock: s.knock, onHit: onHit });
    SV.Audio.shoot();
  }
  function fusionHexCrescent(state, w, def, s) {
    const base = aimFrom(state.player), ids = {};
    const mark = function (e) { if (e.hex > 0) return; e.hex = s.delay; e.hexMax = s.delay; e.hexChild = false; e.hexDmg = s.hexDmg; e.hexFrac = s.frac; e.hexSpread = s.spread; e.hexWid = w.id; e.hexEchoDmg = s.echoDmg; };
    for (let k = 0; k < s.count; k++) swingOnce(state, w, def, s, base + (k - (s.count - 1) / 2) * 0.65, { hitIds: ids, onHit: mark });
    SV.Audio.shoot();
  }
  function fusionDetonatePolymorph(state, w, def, s) {
    for (let k = 0; k < s.count; k++) {
      const pr = spawnHoming(state, w, def, s, k); if (!pr) continue;
      pr.sheep = true; pr.sheepDur = s.dur; pr.sheepBomb = true; pr.sheepBombDmg = s.bombDmg; pr.sheepBombRadius = s.bombRadius; pr.tsFreeze = 0; pr.spreadChance = s.spreadChance; pr.spreadDur = s.spreadDur;
    }
    SV.Audio.shoot();
  }
  function fusionSpearTimestop(state, w, def, s) {
    const p = state.player, a = aimFrom(p), dx = Math.cos(a), dy = Math.sin(a);
    swingOnce(state, w, def, s, a, { armorBreak: s.armorBreak });
    const pr = mkProj(); pr.x = p.x + dx * s.radius / 2; pr.y = p.y + dy * s.radius / 2; pr.r = s.width / 2;
    pr.damage = s.echoDmg; pr.life = s.echoDelay + 0.02; pr.maxLife = pr.life; pr.color = def.color; pr.weaponId = w.id;
    pr.grid = true; pr.gridDir = a; pr.gridLen = s.radius; pr.gridEvery = 99; pr.gridTick = s.echoDelay; pr.gridWidth = s.width;
    pr.tsFreeze = s.freeze;
    SV.Audio.shoot();
  }

  function fusionBladeRing(state, w, def, dt, frost) {
    const p = state.player, s = stats(w, state), blades = p.blades;
    if (blades.length !== s.count) { blades.length = 0; for (let i = 0; i < s.count; i++) blades.push({ angle: i / s.count * U.TAU, x: 0, y: 0, mode:"orbit", target:null, hitIds:[] }); }
    w.angle = (w.angle || 0) + s.spin * dt; w.cd = (w.cd || 0) - dt;
    for (let i = 0; i < blades.length; i++) {
      const b = blades[i], slot = w.angle + i / blades.length * U.TAU;
      b.angle = slot;
      if (!frost && b.mode !== "orbit") {
        b.life -= dt;
        if (b.mode === "out" && (b.life <= s.life * 0.5 || !b.target || b.target.hp <= 0)) { b.mode = "return"; b.hitIds = []; }
        if (b.mode === "out" && b.target) {
          const a=U.angleTo(b.x,b.y,b.target.x,b.target.y),cur=Math.atan2(b.vy,b.vx),turn=U.clamp(Math.atan2(Math.sin(a-cur),Math.cos(a-cur)),-1,1)*6;
          const na=cur+turn*dt;b.vx=Math.cos(na)*s.speed;b.vy=Math.sin(na)*s.speed;
        } else {
          const tx=p.x+Math.cos(slot)*s.radius,ty=p.y+Math.sin(slot)*s.radius,a=U.angleTo(b.x,b.y,tx,ty);
          // Return must overtake the moving orbit slot even after area / speed upgrades.
          const returnSpeed=Math.max(s.speed*1.25,s.radius*Math.abs(s.spin)+Math.hypot(p.vx||0,p.vy||0)+s.speed*0.35);
          b.vx=Math.cos(a)*returnSpeed;b.vy=Math.sin(a)*returnSpeed;
          if(U.dist2(b.x,b.y,tx,ty)<18*18){b.mode="orbit";b.target=null;b.hitIds=[];b.x=tx;b.y=ty;}
        }
        if (b.mode !== "orbit") {
          b.x+=b.vx*dt;b.y+=b.vy*dt;
          const flyNear=SV.Spatial.queryCircle(b.x,b.y,110);
          for(let j=0;j<flyNear.length;j++){const e=flyNear[j];if(e.hp<=0||b.hitIds.indexOf(e.id)>=0)continue;if(U.dist2(b.x,b.y,e.x,e.y)<(12+e.r)*(12+e.r)){b.hitIds.push(e.id);dmgEnemy(e,s.launchDamage,w.id);SV.Effects.hit(b.x,b.y,def.color);}}
        }
      } else { b.x = p.x + Math.cos(slot) * s.radius; b.y = p.y + Math.sin(slot) * s.radius; }
      if (!frost && b.mode !== "orbit") continue;
      const near = SV.Spatial.queryCircle(b.x, b.y, 110).slice();
      for (let j = 0; j < near.length; j++) {
        const e = near[j]; if (e.hp <= 0 || U.dist2(b.x, b.y, e.x, e.y) >= (16 + e.r) * (16 + e.r) || e.bladeCd > 0) continue;
        dmgEnemy(e, s.damage, w.id); e.bladeCd = s.hitCd;
        if (frost) { ccSlow(e, s.slowDur, s.slow); e._frostBlade = (e._frostBlade || 0) + 1; if (e._frostBlade >= s.frostHits) { e._frostBlade = 0; splashAt(state, e.x, e.y, s.burstR, s.burstDmg, def.color, 12, w.id); ccFreeze(e, s.freeze); } }
      }
    }
    if (!frost && w.cd <= 0) {
      let away=0,launch=null;for(let i=0;i<blades.length;i++){if(blades[i].mode!=="orbit")away++;else if(!launch)launch=blades[i];}
      if(away<s.maxAway&&launch){const tgt=nearest(p.x,p.y,99999);if(tgt){const a=U.angleTo(launch.x,launch.y,tgt.x,tgt.y);launch.mode="out";launch.target=tgt;launch.life=s.life;launch.hitIds=[];launch.vx=Math.cos(a)*s.speed;launch.vy=Math.sin(a)*s.speed;w.cd=s.launchCd;SV.Audio.shoot();}}
    }
  }
  function fusionTurrets(state, w, def, dt, judge) {
    const p = state.player, s = stats(w, state), arr = w.sentries || (w.sentries = []);
    if (arr.length !== s.count) {
      arr.length = 0;
      for (let i = 0; i < s.count; i++) arr.push({ angle: 0, x: 0, y: 0, cd: 0 });
    }
    w.angle = (w.angle || 0) + s.spin * dt;
    const spreadLocked = {};
    let focus = null;
    if (judge) {
      const candidates = targetCandidates(p.x, p.y, Infinity);
      for (let i = 0; i < candidates.length; i++) {
        const e = candidates[i];
        const ep = (e.isBoss ? 2 : 0) + ((e._judgeHits || 0) > 0 ? 1 : 0);
        const fp = focus ? (focus.isBoss ? 2 : 0) + ((focus._judgeHits || 0) > 0 ? 1 : 0) : -1;
        if (!focus || ep > fp || (ep === fp && e.maxHp > focus.maxHp)) focus = e;
      }
    }
    for (let i = 0; i < arr.length; i++) {
      const dr = arr[i];
      dr.angle = w.angle + i / arr.length * U.TAU;
      dr.x = p.x + Math.cos(dr.angle) * s.radius; dr.y = p.y + Math.sin(dr.angle) * s.radius;
      dr.interceptR = s.interceptR; dr.cd -= dt;
      for (let k = state.eshots.length - 1; k >= 0; k--) {
        if (U.dist2(dr.x, dr.y, state.eshots[k].x, state.eshots[k].y) < s.interceptR * s.interceptR) { state.eshots.splice(k, 1); break; }
      }
      if (dr.cd > 0) continue;
      const tgt = judge && i < 2 ? focus : nearest(dr.x, dr.y, Infinity, judge ? function (e) { return e !== focus && !spreadLocked[e.id]; } : null)
        || nearest(dr.x, dr.y, Infinity);
      if (!tgt) continue;
      spreadLocked[tgt.id] = true;
      dmgEnemy(tgt, s.damage, w.id);
      beams.push({ pts: [[dr.x, dr.y], [tgt.x, tgt.y]], life: 0.1, max: 0.1, color: def.color, width: 3 });
      dr.targetId = tgt.id;
      if (judge && tgt.hp > 0) {
        tgt._judgeHits = (tgt._judgeHits || 0) + 1;
        if (tgt._judgeHits >= s.judgeHits && !(tgt._judgeLock > 0)) {
          tgt._judgeHits = 0; tgt._judgeLock = s.judgeLock;
          dmgEnemy(tgt, s.judgeDmg + tgt.maxHp * s.judgeFrac * (tgt.isBoss ? 1 / 5 : 1), w.id);
        }
      } else if (!judge) chainBurst(state, tgt.x, tgt.y, s.damage * s.chainMul, s.chainHops, s.chainRange, def.color, s.chainMul, w.id);
      dr.cd = s.fireCd;
    }
  }
  function fusionAuraPoison(state,w,def,dt){const s=stats(w,state),p=state.player;w.cd=(w.cd||0)-dt;if(w.cd>0)return;w.cd=s.tick;const near=SV.Spatial.queryCircle(p.x,p.y,s.radius);for(let i=0;i<near.length;i++){const e=near[i];if(e.hp<=0||U.dist2(p.x,p.y,e.x,e.y)>s.radius*s.radius)continue;e._corrode=Math.min(s.maxStacks,(e._corrode||0)+1);e._corrodeT=s.stackGrace;dmgEnemy(e,s.damage*(1+(e._corrode-1)*s.stackMul),w.id);const a=U.angleTo(e.x,e.y,p.x,p.y),d=U.dist(e.x,e.y,p.x,p.y);if(!e.isBoss){const f=Math.min(s.pull,d*3)*dt;e.x+=Math.cos(a)*f;e.y+=Math.sin(a)*f;}}}
  function fusionLanceChain(state,w,def,dt){const s=stats(w,state),p=state.player;w.angle=(w.angle||0)+s.spin*dt;w.cd=(w.cd||0)-dt;if(w.cd<=0){w.cd=s.tick;for(let b=0;b<s.beams;b++){const a=w.angle+b/s.beams*U.TAU,dx=Math.cos(a),dy=Math.sin(a);beamDamage(state,p.x,p.y,dx,dy,s.length,4,s.damage,def.color,w.id);let seed=null,bd=Infinity;for(let i=0;i<state.enemies.length;i++){const e=state.enemies[i],along=(e.x-p.x)*dx+(e.y-p.y)*dy,side=Math.abs((e.x-p.x)*dy-(e.y-p.y)*dx);if(e.hp>0&&along>=0&&along<=s.length&&side<=e.r+4&&along<bd){seed=e;bd=along;}}if(seed)chainBurst(state,seed.x,seed.y,s.chainDmg,s.chainHops,s.chainRange,def.color,s.chainMul,w.id);}}for(let b=0;b<s.beams;b++){const a=w.angle+b/s.beams*U.TAU;beams.push({pts:[[p.x,p.y],[p.x+Math.cos(a)*s.length,p.y+Math.sin(a)*s.length]],life:.06,max:.06,color:def.color,width:s.width,lance:true,evo:true});}}

  function updateArcFields(state, dt) {
    let out = 0;
    for (let i = 0; i < arcFields.length; i++) {
      const f = arcFields[i]; f.life -= dt; f.tick -= dt;
      if (f.tick <= 0) {
        f.tick += f.every;
        const near = SV.Spatial.queryCircle(f.x, f.y, f.outer + 60);
        for (let j = 0; j < near.length; j++) {
          const e = near[j]; if (e.hp <= 0) continue;
          const d2 = U.dist2(f.x, f.y, e.x, e.y);
          if (d2 < f.inner * f.inner || d2 > f.outer * f.outer) continue;
          if (f.kind === "sector") { const a=U.angleTo(f.x,f.y,e.x,e.y),diff=Math.abs(Math.atan2(Math.sin(a-f.dir),Math.cos(a-f.dir))); if(diff>f.arc/2)continue; }
          const hits=e._arcFieldHits||(e._arcFieldHits={}),key=f.wid+":"+f.fieldId,last=hits[key];
          if(last!=null&&(state.time||0)-last<f.every-0.02)continue;
          hits[key]=state.time||0; dmgEnemy(e,f.damage,f.wid);
        }
      }
      if (f.life > 0) { if (out !== i) arcFields[out] = f; out++; }
    }
    arcFields.length = out;
  }

  function init(state, startWeapon) {
    proj.clear();
    beams.length = 0;
    swings.length = 0;
    arcFields.length = 0;
    state.weapons = [{ id: startWeapon || C.XP_START_WEAPON, level: 1, cd: 0, angle: 0, evolved: false }];
    state.player.blades = [];
    state.player.sentries = [];
  }

  function snapshotRuntime() {
    const projectiles = [];
    for (let i = 0; i < proj.list.length; i++) {
      const src = proj.list[i], out = {};
      for (const k in src) {
        if (k === "target" || k === "beamRef") continue;
        out[k] = src[k];
      }
      out.targetId = src.target && src.target.id != null ? src.target.id : null;
      projectiles.push(out);
    }
    return { projectiles: projectiles, arcFields: JSON.parse(JSON.stringify(arcFields)) };
  }

  function restoreRuntime(state, saved) {
    proj.clear(); beams.length = 0; swings.length = 0; arcFields.length = 0;
    arcFieldSeq = 0;
    const byId = {};
    for (let i = 0; i < state.enemies.length; i++) byId[state.enemies[i].id] = state.enemies[i];
    const ps = saved && Array.isArray(saved.projectiles) ? saved.projectiles : [];
    for (let i = 0; i < ps.length && i < C.MAX_PROJECTILES; i++) {
      const src = ps[i], p = proj.acquire();
      for (const k in src) if (k !== "targetId") p[k] = src[k];
      p.target = src.targetId != null ? (byId[src.targetId] || null) : null;
      if (p.beamLen > 0) {
        p.beamRef = { pts:[[p.x,p.y],[p.x,p.y]], life:Infinity, max:Infinity, color:p.color, width:p.beamWidth, lance:true, evo:true };
        beams.push(p.beamRef);
      }
    }
    const fields = saved && Array.isArray(saved.arcFields) ? saved.arcFields : [];
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!(field.fieldId > 0)) field.fieldId = ++arcFieldSeq;
      else arcFieldSeq = Math.max(arcFieldSeq, field.fieldId);
      arcFields.push(field);
    }
    state.player.blades = [];
    state.player.sentries = [];
  }

  const Weapons = {
    proj: proj,
    beams: beams,
    swings: swings,
    arcFields: arcFields,
    init: init,
    snapshotRuntime: snapshotRuntime,
    restoreRuntime: restoreRuntime,
    stats: stats,
    updateAll: function (state, dt) {
      updateArcFields(state, dt);
      // 光束衰减
      let bw = 0;
      for (let i = 0; i < beams.length; i++) { beams[i].life -= dt; if (beams[i].life > 0) { if (bw !== i) beams[bw] = beams[i]; bw++; } }
      beams.length = bw;
      // 挥砍视觉衰减
      let swg = 0;
      for (let i = 0; i < swings.length; i++) { swings[i].life -= dt; if (swings[i].life > 0) { if (swg !== i) swings[swg] = swings[i]; swg++; } }
      swings.length = swg;

      for (let i = 0; i < state.weapons.length; i++) {
        const w = state.weapons[i];
        if (state.weaponActive) { const k = Entities.tid(w.id); state.weaponActive[k] = (state.weaponActive[k] || 0) + dt; }
        const def = weaponDef(w.id);
        if (def.kind === "orbit") { orbit(state, w, def, dt); continue; }
        if (def.kind === "sentry") { sentryUpdate(state, w, def, dt); continue; }
        if (def.kind === "lance") { lanceUpdate(state, w, def, dt); continue; }
        if (def.kind === "aura") { w.cd -= dt; if (w.cd <= 0) { fireAura(state, w); w.cd = stats(w, state).tick; } continue; }
        if (w.id === "blade_aura") { fusionBladeAura(state, w, def, dt); continue; }            // 融合:连续型(按 id)
        if (w.id === "boomerang_sentry") { fusionSentryBoomerang(state, w, def, dt); continue; }
        if (w.id === "blade_boomerang") { fusionBladeRing(state,w,def,dt,false); continue; }
        if (w.id === "blade_frost") { fusionBladeRing(state,w,def,dt,true); continue; }
        if (w.id === "chain_sentry") { fusionTurrets(state,w,def,dt,false); continue; }
        if (w.id === "sentry_hex") { fusionTurrets(state,w,def,dt,true); continue; }
        if (w.id === "aura_poison") { fusionAuraPoison(state,w,def,dt); continue; }
        if (w.id === "lance_chain") { fusionLanceChain(state,w,def,dt); continue; }
        const s = stats(w, state);
        w.cd -= dt;
        if (w.cd <= 0) { fire(state, w, def, s); w.cd = s.cooldown || 0.5; }
      }
      // Turret cooldowns belong to each weapon; the player array is only a render view.
      const visibleSentries = state.player.sentries;
      visibleSentries.length = 0;
      for (let i = 0; i < state.weapons.length; i++) {
        const arr = state.weapons[i].sentries;
        if (arr) for (let j = 0; j < arr.length; j++) visibleSentries.push(arr[j]);
      }
      updateProjectiles(state, dt);
    },
    evolve: evolve,
    fuse: fuse,
    tid: Entities.tid
  };

  SV.Weapons = Weapons;
})();
