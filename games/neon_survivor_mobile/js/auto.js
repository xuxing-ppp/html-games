// auto.js — SV.Auto: 全自动模式(走位 AI + 升级自动选择)。默认关闭,开启后接管走位与升级卡选择。
// 走位:方向采样"最长净空跑道"+环绕偏置+航向粘滞,目标=尽量别死。升级:启发式打分取最优卡。
// 范围:仅局内走位与升级;通关「无尽选择」与死亡结算屏仍由玩家手动操作。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;
  const A = SV.Config.AUTO;
  const CC = SV.Config.CONST;
  function L(en, zh) { return SV.I18n ? SV.I18n.pick(en, zh) : zh; }

  const Auto = {
    enabled: false,
    _wrapped: false,
    _lvTimer: null,  // 自动选卡展示定时器(防双选/级联)
    _lx: 0, _ly: 0   // 上一帧选定的单位航向(用于航向粘滞防抖)
  };

  // 玩家武器"贴脸射程":位置型(近战/光环/范围)取其 radius;纯远程(导/喷/光/哨等)取中距离 150。
  // AI 用 Rw 判断"够不够得着":最近敌距>Rw×ENGAGE_FAR 时主动靠近,避免老在外围打不到。
  function weaponRange(state) {
    let posR = 0, anyRanged = false;
    const POSITIONAL = { orbit: 1, aura: 1, frost: 1, poison: 1, shockwave: 1, crescent: 1, detonate: 1, spear: 1, vortex: 1, lance: 1 };
    for (let i = 0; i < state.weapons.length; i++) {
      const w = state.weapons[i];
      let def = null;
      try { def = SV.Config.weaponDef(w.id); } catch (e) { def = null; }
      if (!def) continue;
      let st = null;
      try { st = def.stats(w.level); } catch (e) { st = null; }
      if (!st) continue;
      const k = def.kind;
      if (k === "fusion") {
        // 融合:有 radius/vrad/beamLen 的按位置型处理
        const r = Math.max(st.radius || 0, st.vrad || 0, st.beamLen || 0);
        if (r > 0) posR = Math.max(posR, r);
        else anyRanged = true;
      } else if (POSITIONAL[k]) {
        posR = Math.max(posR, st.radius || st.length || 0);
      } else {
        anyRanged = true;
      }
    }
    if (posR > 0) return posR;
    return anyRanged ? 150 : 120;
  }

  // ── 走位 AI:每步在 step() 里、updatePlayer 之前调用(grid 已刷新)。
  //   直接覆写 SV.Input.axis,沿用既有 speed/clamp 管线。
  //   目标优先级:不撞死(跑道地板) > 被围突围(冲最弱阻挡) > 贴脸射程(够得着打) > 捡高价值掉落/宝石 > 风筝环绕敌群。
  function tick(state, dt) {
    const p = state.player;
    if (!p) return;
    const half = (state.stage && state.stage.half) || 2000;
    const Sp = SV.Spatial;

    // 1) 收集威胁(相对玩家坐标 tx/ty、危险半径 tR、权重 tw)。
    //    queryCircle 返回的是模块内复用 scratch 数组——立即消费,本函数内不再二次查询。
    const tx = [], ty = [], tR = [], tw = [];
    const near = Sp.queryCircle(p.x, p.y, A.SENSE);
    let cx = 0, cy = 0, cCount = 0;   // 近敌质心(用于环绕切向/密度)
    let nearDist = Infinity;           // 最近敌中心距(用于 ENGAGE 贴脸判断)
    let nearEX = 0, nearEY = 0;        // 最近敌相对位置(ENGAGE 朝它靠近,而非朝质心扎堆)
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (e.sheep > 0) continue;                       // 变羊:无接触伤,暂时无害(冻结敌仍有接触伤,仍算威胁)
      let R, w;
      if (e.aoe > 0) {                                // bomber:死亡 AOE 穿 i-frame,优先远离
        R = e.aoe + p.r + A.BOMBER_PAD; w = 3.5;
      } else if (e.isBoss) {
        continue;                                    // Boss 由专用扫描处理(远距感知 + 自适应权重 + 引力/激光)
      } else if (e.dmg > 0) {
        R = p.r + e.r; w = 1.0;
      } else continue;                                // 无接触伤敌(ghost)不计;炮台/狙击/母虫巢已有较低接触伤
      // 速度前探:charger/快速追逐者按速度方向预测落点,自然横向躲开(冻结敌 vx=0,前探无害)
      const ex = e.x + e.vx * A.ELEAD, ey = e.y + e.vy * A.ELEAD;
      tx.push(ex - p.x); ty.push(ey - p.y); tR.push(R); tw.push(w);
      cx += ex - p.x; cy += ey - p.y; cCount++;
      const dd = Math.hypot(ex - p.x, ey - p.y);
      if (dd < nearDist) { nearDist = dd; nearEX = ex - p.x; nearEY = ey - p.y; }
    }
    // Boss 专用扫描(不走网格):远距感知(BOSS_SENSE)+ 按 dmg 自适应权重 + 磁暴引力放大 + 巨像激光注入。
    // Boss 单独贡献 flee 方向(bcx/bcy),不被杂兵质心稀释——即使被围也强推离 Boss。
    let bcx = 0, bcy = 0, bwSum = 0, bossClear = Infinity;
    let nbX = 0, nbY = 0;                              // 最近 Boss 位置(贴身逃离用;对侧双 Boss 不抵消)
    const bs2 = A.BOSS_SENSE * A.BOSS_SENSE;
    const enemies = state.enemies;
    if (enemies) {
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.isBoss || e.hp <= 0 || e.sheep > 0) continue;
        const dx = e.x - p.x, dy = e.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > bs2) continue;
        const pull = (e.bossType === "magnetwarper" && e.cstate === "pull") ? A.BOSS_PULL_W : 1;
        const w = A.BOSS_W * (0.6 + (e.dmg || 0) / 50) * pull;
        const R = p.r + e.r + A.BOSS_PAD;
        const ex = e.x + e.vx * A.ELEAD, ey = e.y + e.vy * A.ELEAD;
        tx.push(ex - p.x); ty.push(ey - p.y); tR.push(R); tw.push(w);
        const dm = Math.sqrt(d2) || 1;
        bcx += (-dx / dm) * w; bcy += (-dy / dm) * w; bwSum += w;   // 远离 Boss 单位向量 × 权重
        const cl = dm - R;
        if (cl < bossClear) { bossClear = cl; nbX = dx; nbY = dy; }
        // 巨像扫射激光:沿 e.cdir 把光束采成一串伪威胁(AI 当墙绕开;原 beams 不入 eshots/hazards)
        if (e.bossType === "colossus" && e.cstate === "sweep") {
          const cdx = Math.cos(e.cdir), cdy = Math.sin(e.cdir);
          for (let d = 60; d <= 600; d += 90) {
            tx.push(e.x + cdx * d - p.x); ty.push(e.y + cdy * d - p.y);
            tR.push(A.BEAM_R + p.r); tw.push(A.ESHOT_W);
          }
        }
      }
    }
    // 敌弹(穿 i-frame,前探落点)
    const es = state.eshots;
    if (es && es.length) {
      for (let i = 0; i < es.length; i++) {
        const s = es[i];
        tx.push((s.x + s.vx * A.ESHOT_LEAD) - p.x);
        ty.push((s.y + s.vy * A.ESHOT_LEAD) - p.y);
        tR.push(s.r + p.r); tw.push(A.ESHOT_W);
      }
    }
    // 危险区(穿 i-frame,warm 预警区也计入)。区分圈内/圈外:
    //   圈外:膨胀半径(HAZARD_PAD)+ 满权重,正常绕行;
    //   圈内(已身处实际伤害圈):不再膨胀并降权——膨胀圈互相重叠会封死所有方向的跑道,
    //   误判被围后原地抽搐(灼烧区 bug 根因);同时记录区内偏移,供逃离偏置(见 HAZARD_ESC)。
    const hz = state.hazards;
    let hazInX = 0, hazInY = 0, hazInN = 0;
    if (hz && hz.length) {
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        if (h.kind === "scorch") continue;            // 陨石焦土只伤敌人,不躲(否则乱绕自己武器)
        const dxh = h.x - p.x, dyh = h.y - p.y;
        const rr = h.r + p.r;
        tx.push(dxh); ty.push(dyh);
        if (dxh * dxh + dyh * dyh < rr * rr) {
          tR.push(rr); tw.push(A.HAZARD_W_IN || 1.2);
          hazInX += dxh; hazInY += dyh; hazInN++;
        } else {
          tR.push(rr + A.HAZARD_PAD); tw.push(A.HAZARD_W);
        }
      }
    }
    // 危险区内目标判定(宝石/特殊掉落安全门):位于任一伤害圈(含 26px 边缘带)内则不值得冒险去捡
    const inHazard = function (x, y) {
      if (!hz || !hz.length) return false;
      for (let i = 0; i < hz.length; i++) {
        const h = hz[i];
        if (h.kind === "scorch") continue;
        const rr = h.r + 26;
        if (U.dist2(x, y, h.x, h.y) < rr * rr) return true;
      }
      return false;
    };
    // Boss 周身拾取安全门:Boss 接触半径+BOSS_LOOT_PAD 内的宝石/掉落不吸引。
    // Boss 尸体爆的宝石/宝箱会把 AI 反复拉回贴脸(尤其 Boss 密集的后期),该圈内不值得冒险。
    const inBossZone = function (x, y) {
      if (!bwSum || !enemies) return false;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (!e.isBoss || e.hp <= 0) continue;
        const rr = e.r + (A.BOSS_LOOT_PAD || 80);
        if (U.dist2(x, y, e.x, e.y) < rr * rr) return true;
      }
      return false;
    };

    // 减速时膨胀危险半径(更保守);gentle,防冻住时过激
    const slowScale = 1 + (p.slow > 0 ? (p.slowF || 0) : 0) * 0.8;

    // 最近威胁净空(用于 FLEE 衰减):净空≥SAFE → 不再贴墙逃,转环绕/拾取
    let nearClear = Infinity;
    for (let i = 0; i < tx.length; i++) {
      const cl = Math.hypot(tx[i], ty[i]) - tR[i] * slowScale;
      if (cl < nearClear) nearClear = cl;
    }

    // 2) 宝石吸引:Σ 单位向量·价值·距离衰减 → 方向 + 密度(扫 state.gems,不在网格)
    let gvx = 0, gvy = 0, gemCount = 0;
    const gems = state.gems;
    const gs2 = A.GEM_SENSE * A.GEM_SENSE;
    if (gems && gems.length) {
      for (let i = 0; i < gems.length; i++) {
        const g = gems[i];
        const dx = g.x - p.x, dy = g.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > gs2 || d2 < 1) continue;
        if (inHazard(g.x, g.y)) continue;             // 危险区内的宝石不吸(否则把玩家拉回灼烧圈里反复横跳)
        if (inBossZone(g.x, g.y)) continue;           // Boss 周身的宝石不吸(否则贴脸捡尸反复挨打)
        const d = Math.sqrt(d2);
        const w = (g.value || 1) * (1 - d / A.GEM_SENSE);   // 越近越权重高
        gvx += dx / d * w; gvy += dy / d * w; gemCount++;
      }
    }
    let gemDirX = 0, gemDirY = 0, gemMag = 0;
    const gm = Math.hypot(gvx, gvy);
    if (gm > 1e-3) { gemDirX = gvx / gm; gemDirY = gvy / gm; gemMag = Math.min(gm, 2); }

    // 3) 特殊掉落吸引:取价值最高的单个目标(health/magnet/bomb/treasure,情境加权)
    let specDirX = 0, specDirY = 0, specVal = 0, specCount = 0;
    const picks = state.pickups;
    if (picks && picks.length) {
      const dense = cCount;                                // 近身敌密度(bomb 用)
      const gemN = gems ? gems.length : 0;                 // 场上宝石数(magnet 用)
      const miss = p.maxHp > 0 ? 1 - p.hp / p.maxHp : 1;   // 缺血程度(health 用)
      let bestV = -1;
      for (let i = 0; i < picks.length; i++) {
        const pk = picks[i];
        const dx = pk.x - p.x, dy = pk.y - p.y, d = Math.hypot(dx, dy);
        if (d > A.GEM_SENSE || d < 1) continue;
        if (inHazard(pk.x, pk.y)) continue;           // 危险区内的掉落不抢(等区域消失或磁铁吸)
        if (inBossZone(pk.x, pk.y)) continue;         // Boss 周身的掉落不抢(含 Boss 宝箱,磁铁可吸)
        let v;
        if (pk.kind === "health") v = A.SPEC * A.SPEC_HEALTH * (0.3 + miss * 1.5);
        else if (pk.kind === "magnet") v = A.SPEC * (0.6 + Math.min(2.0, gemN * A.SPEC_MAGNET));
        else if (pk.kind === "bomb") v = A.SPEC * (0.6 + Math.min(3.0, dense * A.SPEC_BOMB));
        else if (pk.kind === "treasure") v = A.SPEC * A.SPEC_TREASURE;
        else continue;
        v /= 1 + d / 300;                                  // 远的打折
        if (v > bestV) { bestV = v; specDirX = dx / d; specDirY = dy / d; specVal = v; specCount = 1; }
      }
    }

    // 4) 近敌质心方向:away=背离敌群(flee 向)、tangent=垂直(orbit 向)
    let tanX = 0, tanY = 0, awX = 0, awY = 0, cMag = 0;
    if (cCount > 0) {
      cx /= cCount; cy /= cCount;
      cMag = Math.hypot(cx, cy);
      if (cMag > 1) { tanX = -cy / cMag; tanY = cx / cMag; awX = -cx / cMag; awY = -cy / cMag; }
    }

    // FLEE 随最近净空衰减:敌贴近=满 FLEE;敌到 SAFE 外=0(转环绕/拾取,不再一路贴墙)
    // 缺血时 SAFE 扩大(从更远就开始撤,保命优先)
    const hpFrac = p.maxHp > 0 ? p.hp / p.maxHp : 1;
    const safeR = A.SAFE * (1 + Math.max(0, 0.5 - hpFrac) * 2.0);
    const fleeW = (nearClear < Infinity) ? A.FLEE * U.clamp((safeR - nearClear) / safeR, 0, 1) : 0;
    // Boss 专属 flee:boss 净空<BOSS_FEAR 时启动,沿"远离 Boss"方向加偏置(对抗磁暴引力、防贴脸)
    let bossAwayX = 0, bossAwayY = 0, bossFleeW = 0;
    if (bwSum > 0) {
      bossAwayX = bcx / bwSum; bossAwayY = bcy / bwSum;
      bossFleeW = A.FLEE * 1.2 * U.clamp((A.BOSS_FEAR - bossClear) / A.BOSS_FEAR, 0, 1);
    }
    // Boss 贴身逃离:最近 boss 净空<BOSS_ESC_R 时沿"远离最近 Boss"方向强推(压过宝石/拾取吸引)。
    // 与 bossFleeW 互补:flee 方向是全部 Boss 加权和,对侧双 Boss 会抵消;此偏置只看最近一只,永远有明确出口。
    let bossEscX = 0, bossEscY = 0, bossEscW = 0;
    if (bossClear < (A.BOSS_ESC_R || 130)) {
      const bm = Math.hypot(nbX, nbY) || 1;
      bossEscX = -nbX / bm; bossEscY = -nbY / bm;
      bossEscW = A.BOSS_ESC || 110;
    }
    // 危险区逃离偏置:身处伤害圈内时,沿「区内位置 → 区外」方向强推(压过宝石/拾取吸引,对抗进出抖动)
    let hazEscX = 0, hazEscY = 0, hazEscW = 0;
    if (hazInN > 0) {
      const hm = Math.hypot(hazInX, hazInY) || 1;
      hazEscX = -hazInX / hm; hazEscY = -hazInY / hm;
      hazEscW = A.HAZARD_ESC || 90;
    }

    // ENGAGE 贴脸:最近敌距离>武器射程×ENGAGE_FAR 且射程足够安全(≥ENGAGE_MIN)时,朝最近敌靠近。
    // 射程过短(L1 近战 r70)贴脸=送死,此时转纯风筝;武器长大后或远程武器才积极贴脸。
    // 缺血时几乎关闭(保命优先)。朝最近敌而非质心,避免扎进怪堆。
    const Rw = weaponRange(state);
    let engageX = 0, engageY = 0, engageW = 0;
    if (nearDist < Infinity && nearDist > Rw * A.ENGAGE_FAR && Rw >= (A.ENGAGE_MIN || 100)) {
      const nd = Math.hypot(nearEX, nearEY) || 1;
      engageX = nearEX / nd; engageY = nearEY / nd;
      const hpGate = hpFrac > 0.5 ? 1 : (hpFrac > 0.3 ? 0.35 : 0.05);
      engageW = A.ENGAGE * hpGate;
    }

    const nT = tx.length;
    const K = A.DIRS;

    // 4a) 预扫各方向跑道,判断是否被围(最佳+次佳跑道都过短=真被围→启动突围)
    const runways = new Array(K);
    let r1 = -1, r2 = -1, r1Ang = Auto._lastAng || 0;
    for (let k = 0; k < K; k++) {
      const ang = (U.TAU * k) / K;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let runway = Infinity;
      for (let i = 0; i < nT; i++) {
        const R = tR[i] * slowScale;
        const along = tx[i] * dx + ty[i] * dy;
        if (along > -R) {
          const perp = Math.abs(tx[i] * dy - ty[i] * dx);
          if (perp < R) {
            const clearance = (along + R) / tw[i];
            if (clearance < runway) runway = clearance;
          }
        }
      }
      let wall = Infinity;
      if (dx > 1e-4) wall = Math.min(wall, (half - p.x) / dx);
      else if (dx < -1e-4) wall = Math.min(wall, (-half - p.x) / dx);
      if (dy > 1e-4) wall = Math.min(wall, (half - p.y) / dy);
      else if (dy < -1e-4) wall = Math.min(wall, (-half - p.y) / dy);
      if (wall < runway) runway = wall;
      if (runway < 0) runway = 0;
      if (runway > A.OPEN) runway = A.OPEN;
      runways[k] = runway;
      if (runway > r1) { r2 = r1; r1 = runway; r1Ang = ang; }
      else if (runway > r2) { r2 = runway; }
    }
    const surrounded = (r1 < A.BREAKOUT) && (r2 < A.BREAKOUT * 1.25) && (nT > 0); // 最佳+次佳都短=真被围
    const bDirX = Math.cos(r1Ang), bDirY = Math.sin(r1Ang);

    let bestScore = -Infinity, bestAng = Auto._lastAng || 0;
    for (let k = 0; k < K; k++) {
      const ang = (U.TAU * k) / K;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const runway = runways[k];

      let score;
      // 跑道饱和:ENGAGE 开启(长射程+健康)时封顶,让贴脸/拾取能把玩家从纯逃跑拉回战场;
      // ENGAGE 关闭(短射程/缺血)时用原始跑道,贪心风筝保命。
      const srun = engageW > 0 ? Math.min(runway, A.SAFE_RUNWAY) : runway;
      if (surrounded) {
        // 突围:只信跑道 + 锁定最长净空方向。丢弃 FLEE/ORBIT/ENGAGE(原地环行=送死),全力冲最弱阻挡。
        score = srun * A.BREAKOUT_BOOST;
        score += A.STICK * A.BREAKOUT_STICK * (dx * bDirX + dy * bDirY);
        if (gemMag > 0) score += A.GEM * gemMag * 0.3 * (dx * gemDirX + dy * gemDirY); // 宝石吸引大幅衰减(逃命优先)
        if (specVal > 0) score += specVal * 0.3 * (dx * specDirX + dy * specDirY);
        if (hazEscW > 0) score += hazEscW * 0.8 * (dx * hazEscX + dy * hazEscY);      // 身陷危险区:优先冲出
        if (bossEscW > 0) score += bossEscW * 0.8 * (dx * bossEscX + dy * bossEscY);   // 贴 Boss 时:沿出口先拉出再谈别的
      } else {
        score = srun;
        if (awX || awY) score += fleeW * (dx * awX + dy * awY);                  // 主:远离敌群(随净空衰减)
        if (bossFleeW > 0) score += bossFleeW * (dx * bossAwayX + dy * bossAwayY); // Boss 专属 flee
        if (bossEscW > 0) score += bossEscW * (dx * bossEscX + dy * bossEscY);   // Boss 贴身逃离(不被宝石/宝箱拉回去)
        if (hazEscW > 0) score += hazEscW * (dx * hazEscX + dy * hazEscY);       // 危险区逃离(不被宝石吸引拉回去)
        if (engageW > 0) score += engageW * (dx * engageX + dy * engageY);        // 贴脸:朝最近敌靠近到射程
        if (tanX || tanY) score += A.ORBIT * Math.abs(dx * tanX + dy * tanY);    // 辅:轻微环绕
        score += A.STICK * (dx * Auto._lx + dy * Auto._ly);                      // 航向粘滞(防抖)
        if (gemMag > 0) score += A.GEM * gemMag * (dx * gemDirX + dy * gemDirY); // 宝石吸引
        if (specVal > 0) score += specVal * (dx * specDirX + dy * specDirY);     // 特殊掉落吸引
      }

      if (score > bestScore) { bestScore = score; bestAng = ang; }
    }

    // 5) 决定航向与量级:有威胁/有可拾物 → 全速沿最佳方向;全无 → 原地待机(武器照常开火)
    let ax = Math.cos(bestAng), ay = Math.sin(bestAng);
    let mag = 1;
    if (nT === 0 && gemCount === 0 && specCount === 0) { ax = 0; ay = 0; mag = 0; }
    Auto._lx = Math.cos(bestAng); Auto._ly = Math.sin(bestAng); // 粘滞用单位航向(不受 mag 影响)
    Auto._lastAng = bestAng;
    SV.Input.axis.x = ax * mag;
    SV.Input.axis.y = ay * mag;
  }

  // ── 升级 AI:给每张卡打分取最高(平局:先到先得 + rarity 已并入分数)。
  function pickUpgrade(state, choices) {
    if (!choices || !choices.length) return null;
    if (choices.length === 1) return choices[0];
    const EVO = SV.Config.EVOLUTIONS;
    const WMAX = CC.WEAPON_MAX;        // 8(进化阈值)
    const PMAX = CC.PASSIVE_MAX;       // 5(进化解锁阈值)
    const MAXW = CC.MAX_WEAPONS;       // 6
    const t = state.time || 0;

    function wlevel(id) { for (let i = 0; i < state.weapons.length; i++) if (state.weapons[i].id === id) return state.weapons[i].level; return 0; }
    function passiveLvl(id) { return (state.passives && state.passives[id]) || 0; }
    // 该被动升到 after 级后,是否能为某把接近满级的武器解锁进化
    function passiveUnlocksEvo(id, after) {
      for (const baseId in EVO) {
        if (EVO[baseId].reqPassive === id) {
          const wl = wlevel(baseId);
          if (after >= PMAX && wl >= WMAX) return true;     // 武器已满 + 被动达标
          if (after >= PMAX && wl >= WMAX - 1) return true; // 武器差一级,提前铺路
        }
      }
      return false;
    }
    const rar = { common: 0, rare: 8, epic: 16, legend: 28 };
    const surv = { maxhp: 1, armor: 1, speed: 1, regen: 1, magnet: 1 };

    let best = null, bestScore = -Infinity;
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      let s = 0;
      if (c.kind === "fuse") s = 1000;                              // 协同进化:几乎总该拿(释放槽+强武器)
      else if (c.kind === "evolve") s = 800;                        // 进化:质变
      else if (c.kind === "newweapon") {
        s = 100;
        if (state.weapons.length < 3) s += 60;                      // 早填槽
        else if (state.weapons.length >= MAXW - 1) s -= 40;         // 接近满槽避免摊薄
      } else if (c.kind === "weapon") {
        s = 70;
        const lv = wlevel(c.id);
        if (lv >= WMAX - 2) s += 30;                                // 推向 L8
        const evo = EVO[c.id];
        if (evo && lv + 1 >= WMAX && passiveLvl(evo.reqPassive) >= PMAX) s += 120; // 即可触发进化
        const wd = state.weaponDamage && state.weaponDamage[c.id.replace(/_evo$/, "")];
        if (wd) s += Math.min(20, wd / 200);                        // 主力 DPS 小幅加权
      } else if (c.kind === "passive") {
        s = 50;
        const cur = passiveLvl(c.id);
        if (surv[c.id] && t < 180) s += 35;                         // 前期生存被动
        if (passiveUnlocksEvo(c.id, cur + 1)) s += 80;              // 进化解锁铺路
        if (c.id === "magnet" && cur < 3) s += 25;                  // 磁吸:pickupRadius↑ 与自动拾取强协同
        s -= cur * 2;                                               // 高级小递减
      }
      s += rar[c.rarity] || 0;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best || choices[0];
  }

  // ── 开关 / 持久化 / UI
  function syncButton() {
    // 旧 #btnAuto(已从 HUD 移除,此处保留兼容)+ 新 .auto-toggle(标题屏 / 暂停屏)
    const btn = document.getElementById("btnAuto");
    if (btn) btn.classList.toggle("on", Auto.enabled);
    const btns = document.querySelectorAll(".auto-toggle");
    for (let i = 0; i < btns.length; i++) btns[i].classList.toggle("on", Auto.enabled);
    // 同步文案(由 Menus.setAutoToggle 负责,但为防 Menus 未就绪也兜底)
    if (SV.Menus && SV.Menus.setAutoToggle) SV.Menus.setAutoToggle(Auto.enabled);
  }
  function setEnabled(b) {
    Auto.enabled = !!b;
    SV.Storage.set("autoMode", Auto.enabled);
    syncButton();
    if (SV.HUD && SV.HUD.toast) SV.HUD.toast(Auto.enabled ? L("Auto Mode enabled", "已开启全自动模式") : L("Auto Mode disabled", "已关闭全自动模式"));
  }
  function toggle() { setEnabled(!Auto.enabled); }

  function init() {
    Auto.enabled = !!SV.Storage.get("autoMode");
    // 包装升级入口:开启时渲染三张卡 + 高亮所选 + 短暂展示后自动确认(级联时缩短);用户可在展示期间手选覆盖
    if (!Auto._wrapped && SV.HUD && SV.HUD.showLevelUp) {
      const _orig = SV.HUD.showLevelUp;
      SV.HUD.showLevelUp = function (choices, onSelect) {
        if (!Auto.enabled) return _orig(choices, onSelect);            // 关闭:原样手动
        const pick = Auto.pickUpgrade(SV.Game.state, choices) || choices[0];
        const pickIdx = choices.indexOf(pick);
        let done = false;
        const wrapped = function (c) {                                  // 防双选(自动到时/用户手点/按键 任一触发一次)
          if (done) return; done = true;
          if (Auto._lvTimer) { clearTimeout(Auto._lvTimer); Auto._lvTimer = null; }
          const panel = document.getElementById("levelUp"); if (panel) panel.classList.remove("auto");
          SV.HUD.hideLevelUp();
          onSelect(c);                                                  // = onChoose: apply + 级联 + 恢复 playing
        };
        _orig(choices, wrapped);                                        // 渲染三张卡 + 挂 click/keydown(均走 wrapped)
        const panel = document.getElementById("levelUp"); if (panel) panel.classList.add("auto");
        if (pickIdx >= 0 && typeof document.querySelector === "function") {
          const card = document.querySelector('#lvCards .card[data-idx="' + pickIdx + '"]');
          if (card) card.classList.add("chosen");
        }
        // 每张升级卡均展示 LV_DELAY(用户要求每级 ~1s,即使连续多次升级也每张都停留)
        Auto._lvTimer = setTimeout(function () { wrapped(pick); }, A.LV_DELAY);
      };
      Auto._wrapped = true;
    }
    // 开关键(默认 O)
    const key = String(A.TOGGLE_KEY || "o").toLowerCase();
    window.addEventListener("keydown", function (ev) {
      if (ev.defaultPrevented) return;
      if (String(ev.key || "").toLowerCase() === key) { toggle(); ev.preventDefault(); }
    });
    // HUD 按钮
    const btn = document.getElementById("btnAuto");
    if (btn) btn.addEventListener("click", function (ev) { ev.preventDefault(); toggle(); });
    syncButton();
  }

  Auto.tick = tick;
  Auto.pickUpgrade = pickUpgrade;
  Auto.init = init;
  Auto.toggle = toggle;
  Auto.setEnabled = setEnabled;

  SV.Auto = Auto;
})();
