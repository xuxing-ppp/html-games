// config.js — SV.Config: 全部数值/内容表(数据驱动)。所有平衡只改这里。
(function () {
  "use strict";
  const SV = window.SV;
  const U = SV.Util;

  const CONST = {
    FIXED_DT: 1 / 60,
    MAX_FRAME: 0.25,
    MAX_STEPS: 5,
    // 实体上限(满则停刷,防失控)
    MAX_ENEMIES: 600,
    MAX_PROJECTILES: 1200,
    MAX_PARTICLES: 600,
    MAX_GEMS: 260,
    MAX_FLOATERS: 80,
    MAX_HAZARDS: 40,
    MAX_WEAPONS: 6,
    // 玩家
    PLAYER_BASE_HP: 100,
    PLAYER_BASE_SPEED: 165, // 略快于一切追逐者
    PLAYER_RADIUS: 14,
    PICKUP_RADIUS: 72,
    HEALTH_PULL_RADIUS: 72, // 血未满时血包的固定吸引范围(不吃磁吸属性)
    GEM_COLLECT_RADIUS: 20, // 经验球拾取半径(中心距)
    GEM_PULL_BASE: 540,     // 经验球远场牵引速度上限(受磁吸属性放大)
    GEM_PULL_NEAR_K: 10,    // 经验球近场牵引速度系数(速度 = d * K,随距离线性衰减防过冲)
    IFRAME: 0.85, // 受击无敌秒数
    ESHOT_IFRAME: 0.15, // 敌弹自身短保护；另受难度配置的跨来源 burstIframe 保护
    TARGET_FALLBACK_RANGE: 600, // 无可见目标时的屏外补选距离(不限制已发射弹体与连锁)
    LATE_BALANCE_START: 8,
    LATE_BALANCE_END: 15,
    LATE_BOSS_STAGGER: 2,
    LATE_RELIEF_SECONDS: 8,
    LATE_RELIEF_SPAWN: 0.5,
    HAZARD_TICK: 0.5,
    REGEN_INTERVAL: 1, // 回血结算间隔
    // 吸血属性采用指数收敛；当前吸血率也直接作为每秒回血预算占最大生命的比例。
    LIFESTEAL_FIRST: 0.009,
    LIFESTEAL_ATTR_CAP: 0.075,
    // 闪烁者：一个周期的最后 BLINK_WARN 秒锁定并预警落点。
    BLINK_WARN: 0.6,
    BLINK_PERIOD_MIN: 1.6,
    BLINK_PERIOD_MAX: 2.4,
    BLINK_DISTANCE: 180,
    BLINK_GAP: 40,
    // 无尽模式
    ENDLESS_BOSS_FIRST: 20.5 * 60,
    ENDLESS_BOSS_EVERY: 90, // 无尽模式从 20:30 起每 1.5min 一波
    ENDLESS_HP_PER_MIN: 0.18, // 无尽模式每分钟额外敌血倍率
    // 通关前的三次多 Boss 波
    LATE_BOSS_TIMES: [15.5 * 60, 17.5 * 60, 19 * 60],
    // 空间网格
    CELL: 48,
    // 定点轰炸索敌(时停/陨石):避开玩家近旁的最小距离(让出近战范围,索敌中远敌群)
    AIM_MIN_DIST: 200,
    // 变羊敌人随机游走速度(px/s,中等)
    SHEEP_SPEED: 90,
    // 控制类效果(冻结/变羊/减速/时停)对 Boss 的时长倍率(大幅削减)
    CC_BOSS_MUL: 0.25,
    // T3 Boss 自身伤害倍率(接触/弹幕/激光统一使用)
    T3_BOSS_DAMAGE_MUL: 1.15,
    // T3 瞄准扇射只做有限速度预判，避免高速角色被“读心枪”锁死。
    BOSS_AIM_LEAD_FACTOR: 0.45,
    BOSS_AIM_LEAD_MAX_TIME: 0.45,
    BOSS_AIM_LEAD_MAX_DIST: 90,
    // 刷怪
    SPAWN_RING_PAD: 70, // 屏外环形生成余量
    SWARM_EVERY: 90, // 集群波间隔(秒)
    SWARM_COUNT: 7,
    // 武器/被动
    WEAPON_MAX: 8,           // 武器满级(进化阈值,不设溢出)
    PASSIVE_MAX: 5,          // 被动设计满级(进化阈值)
    PASSIVE_MAX_LEVEL: 99,   // 被动实际可升级上限(收益递减)
    // 经验
    XP_START_WEAPON: "blade",
    // Boss 宝箱固定经验(不吃等级成长:后期多 Boss 波不再爆级;仍受磁吸经验加成)
    TREASURE_XP: 400
  };

  // 全自动模式参数(SV.Auto 用,数据驱动便于调参)
  const AUTO = {
    SENSE: 300,        // 敌人感知半径(px,queryCircle)
    OPEN: 600,         // 开放方向跑道封顶(须 > 最远挡道 clearance≈SENSE+R;消除斜向远墙角虚高)
    SAFE_RUNWAY: 135,  // 跑道"够用即饱和":评分里 runway 贡献封顶于此(>此值再远也没用),让 ENGAGE/拾取能在安全时把玩家拉离纯逃跑
    DIRS: 16,          // 采样方向数
    ELEAD: 0.10,       // 敌人速度前探时间(s,处理 charger/快速追逐者)
    ESHOT_LEAD: 0.18,  // 敌弹前探时间(s)
    ESHOT_W: 2.0,      // 敌弹权重(穿 i-frame,放大紧约束)
    HAZARD_W: 2.5,     // 危险区权重(穿 i-frame)
    HAZARD_PAD: 10,    // 危险区额外半径(圈外时)
    HAZARD_W_IN: 1.2,  // 已身处危险区实际伤害圈内时的降权(膨胀圈互相重叠会封死所有跑道→误判被围、原地抽搐)
    HAZARD_ESC: 90,    // 危险区逃离偏置(px 当量:身陷伤害圈内时沿出口方向强推,压过宝石/拾取吸引)
    BOMBER_PAD: 26,    // bomber 死亡 AOE 额外半径
    BOSS_PAD: 46,      // boss 接触额外半径(大 Boss r=44-50,需厚避让垫)
    BOSS_W: 3.0,       // boss 基础权重(按 dmg 自适应:×(0.6+dmg/50),介于 eshots 与 bomber)
    BOSS_SENSE: 520,   // boss 专用感知半径(普通敌仍用 SENSE;远距即可察觉大 Boss)
    BOSS_PULL_W: 1.6,  // 磁暴行者 pull 期间权重乘子(对抗引力,主动反推)
    BEAM_R: 26,        // 注入巨像激光伪威胁的单点半径(把光束当墙绕开)
    BOSS_FEAR: 280,    // boss 逼近恐惧半径:boss 净空<此值时启动 boss flee 偏置(对抗磁暴引力)
    BOSS_ESC_R: 130,   // boss 贴身逃离半径:最近 boss 净空<此值时沿远离方向强推(修贴 Boss 抖动/停留)
    BOSS_ESC: 110,     // boss 贴身逃离偏置(px 当量,>GEM 满值,压过宝石/掉落吸引)
    BOSS_LOOT_PAD: 80, // boss 周身拾取安全垫:此范围内的宝石/掉落不吸引(Boss 尸体爆的宝石不该把 AI 拉回贴脸)
    FLEE: 80,          // 远离敌群偏置(px 当量,主项:拉开距离避免被包)
    ORBIT: 20,         // 环绕偏置(px 当量,辅项:轻微绕行避免直冲墙角)
    STICK: 15,         // 航向粘滞(px 当量,防抖)
    SAFE: 80,         // 净空阈值(px):最近敌净空≥SAFE 时 FLEE 衰减为 0(转环绕/拾取,不再贴墙逃跑)
    ENGAGE: 22,       // 贴脸攻击偏置(px 当量):最近敌距离>武器射程时,朝最近敌靠近(够得着打;弱于跑道/逃命安全项)
    ENGAGE_FAR: 1.2,  // 距离> Rw×此值 才触发 ENGAGE(留一段"射程内自由环行"带)
    ENGAGE_MIN: 100,  // 武器射程需≥此值才 ENGAGE(短射程 L1 近战贴脸=送死,转纯风筝)
    BREAKOUT: 92,     // 被围判定:最佳+次佳跑道都<此值才真被围→启动突围(冲最长净空方向)
    BREAKOUT_BOOST: 3.0, // 突围时跑道权重倍子(放大"最长净空"决定性,压过环行/逃逸)
    BREAKOUT_STICK: 2.5, // 突围航向粘滞倍子(锁定突围方向,防抖防原地打转)
    GEM: 60,           // 宝石吸引(px 当量,安全方向间偏向宝石簇)
    GEM_SENSE: 420,    // 宝石感知半径(px)
    SPEC: 90,          // 特殊掉落基础吸引(px 当量)
    SPEC_HEALTH: 1.6,  // health 情境系数(×缺血程度;濒血时极高)
    SPEC_MAGNET: 0.02, // magnet 系数(×场上宝石数)
    SPEC_BOMB: 0.5,    // bomb 系数(×近身敌数;被围时极高=清场+爆宝石)
    SPEC_TREASURE: 1.2,// treasure 系数(随等级的 XP 包)
    LV_DELAY: 1000,    // 自动选卡展示时长(ms,用户要求 ~1s)
    LV_FAST: 220,      // 多重升级级联时展示时长(ms,避免总停顿过长)
    TOGGLE_KEY: "o"    // 开关键(另设 HUD 按钮)
  };

  // 霓虹配色(色相)
  const COLORS = {
    bg0: "#070611",
    bg1: "#0d0a22",
    grid: "rgba(120,90,220,0.10)",
    gridStrong: "rgba(150,110,255,0.16)",
    player: "#9be7ff",
    playerCore: "#ffffff",
    xp: "#7CFFB2",
    hp: "#ff5d73",
    gold: "#ffd86b",
    rarity: { common: "#cdd3ff", rare: "#5ad1ff", epic: "#c06bff", legend: "#ffb14d" }
  };

  // ── 武器(21 种)。每个 def 暴露 stats(level) 返回该等级基础数值(未应用被动)。
  const WEAPONS = {
    blade: {
      name: "旋转光刃", icon: "✺", color: "#8ef0ff", max: 8, kind: "orbit",
      desc: "光刃环绕身周,接触造成伤害。",
      tags: ["melee"],
      stats: function (lv) {
        return { damage: (10 + (lv - 1) * 2.6) * 1.2, count: 2 + Math.floor((lv - 1) / 2), radius: 70 + (lv - 1) * 8, spin: 2.0 + (lv - 1) * 0.3 };
      }
    },
    missile: {
      name: "追踪导弹", icon: "➤", color: "#ffb24d", max: 8, kind: "missile",
      desc: "优先锁定可见敌人发射追踪弹。",
      tags: ["ranged"],
      stats: function (lv) {
        return { damage: (11 + (lv - 1) * 3.5) * 1.1, cooldown: Math.max(0.65, 1.5 - (lv - 1) * 0.12), count: 1 + (lv >= 4 ? 1 : 0) + (lv >= 7 ? 1 : 0), speed: 260, seek: 120, life: 2.6, chase: 1 + Math.floor((lv - 1) / 3), chaseDecay: 1 };
      }
    },
    chain: {
      name: "连锁闪电", icon: "⚡", color: "#b6a6ff", max: 8, kind: "chain",
      desc: "电击最近敌人并向周围跳跃。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: (7.3 + (lv - 1) * 4.6) * 1.1, cooldown: Math.max(0.9, 0.98 + (8 - lv) * 0.096), chains: 2 + Math.floor((lv - 1) / 2), range: 185 };
      }
    },
    aura: {
      name: "等离子光环", icon: "◎", color: "#a78bfa", max: 8, kind: "aura",
      desc: "周身伤害力场,周期灼烧。",
      tags: ["melee"],
      stats: function (lv) {
        // 伤害频率(tick)在 weapons.js 受冷却缩减影响(仅光环系)
        return { damage: (5.0 + (lv - 1) * 1.0) * 1.1, radius: 80 + (lv - 1) * 10, tick: 0.48 - (lv - 1) * 0.04 };
      }
    },
    shotgun: {
      name: "霰弹散射", icon: "≣", color: "#ffd86b", max: 8, kind: "shotgun",
      desc: "朝最近敌人方向发射锥形弹丸。",
      tags: ["ranged"],
      stats: function (lv) {
        // L1 伤害 -21%,L8 精确不变;子弹存在时长(即射程)随等级成长:L8=1.69s ≈ L1(0.85s) 的 2 倍
        return { damage: 6.5 + (lv - 1) * 2.5, count: 3 + (lv - 1), cooldown: Math.max(0.6, 1.4 - (lv - 1) * 0.1), speed: 330, life: 0.80 + (lv - 1) * 0.06, cone: (35 + (lv - 1) * 3) * Math.PI / 180 };
      }
    },
    frost: {
      name: "冰霜新星", icon: "❄", color: "#7cdfff", max: 8, kind: "frost",
      desc: "周期性冰爆,减速范围内敌人。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: 9 + (lv - 1) * 3.24, radius: 110 + (lv - 1) * 15, cooldown: 1.62 - (lv - 1) * 0.07, slow: Math.min(0.75, 0.4 + (lv - 1) * 0.05), slowDur: 1.5 + (lv - 1) * 0.1, expand: 620 };
      }
    },
    lance: {
      name: "环绕激光", icon: "⟶", color: "#ff7eb6", max: 8, kind: "lance",
      desc: "环绕玩家旋转的高能激光,触碰的敌人受创一次(一次触碰仅一次,离开后再触碰可再触发)。判定为一条线,靠敌人自身体积触发。",
      tags: ["ranged"],
      stats: function (lv) {
        return { damage: 11.2 + (lv - 1) * 3, spin: 1.52 + (lv - 1) * 0.19, length: 175 + (lv - 1) * 20, width: 6 };
      }
    },
    boomerang: {
      name: "霓虹回旋镖", icon: "✦", color: "#5ad1ff", max: 8, kind: "boomerang",
      desc: "抛出回旋镖,去返皆伤敌(自动瞄准最近敌人)。",
      tags: ["ranged"],
      stats: function (lv) {
        // 弹速/射程成长强化:L1 小幅提升至 300,L8 大幅提升至 450;life 仍随等级成长
        return { damage: 12 + (lv - 1) * 3.4, count: 1 + (lv >= 3 ? 1 : 0) + (lv >= 6 ? 1 : 0), cooldown: Math.max(0.7, 1.7 - (lv - 1) * 0.085), speed: 300 + (lv - 1) * (150 / 7), life: 1.1 + (lv - 1) * 0.07, spin: 14 };
      }
    },
    grenade: {
      name: "榴弹炮", icon: "✸", color: "#ff9a3c", max: 8, kind: "grenade",
      desc: "抛射榴弹至最近敌人位置,爆炸范围伤害。",
      tags: ["ranged"],
      stats: function (lv) {
        return { damage: 10 + (lv - 1) * 3, cooldown: Math.max(0.8, 1.8 - (lv - 1) * 0.12), count: 1 + (lv >= 3 ? 1 : 0) + (lv >= 6 ? 1 : 0), radius: 60 + (lv - 1) * 6, speed: 300, life: 1.2 };
      }
    },
    railgun: {
      name: "轨道炮", icon: "⟹", color: "#ff5d73", max: 8, kind: "railgun",
      desc: "蓄能射出超高伤贯穿弹,直线穿透所有敌人。",
      tags: ["ranged"],
      stats: function (lv) {
        // 最优贯穿线提高了稳定命中数，以约 -10% 单发伤害平衡。
        return { damage: (27 + (lv - 1) * 12) * (0.78 + (lv - 1) * 0.12 / 7), cooldown: Math.max(1.7, 2.06 + (8 - lv) * 0.3), speed: 900 };
      }
    },
    poison: {
      name: "剧毒云", icon: "☣", color: "#9bff5a", max: 8, kind: "poison",
      desc: "向附近敌人注入剧毒,持续掉血。",
      tags: ["spell"],
      stats: function (lv) {
        // 纯毒伤武器:无直接攻击伤害(damage 字段已删),只有 DoT。
        return { cooldown: 2.2 - (lv - 1) * (1.2 / 7), radius: 110 + (lv - 1) * 8, dot: 6.2 + (lv - 1) * 2.1, dotDur: 2.5 + (lv - 1) * 0.2 };
      }
    },
    vortex: {
      name: "龙卷风", icon: "✯", color: "#7df9ff", max: 8, kind: "vortex",
      desc: "召唤游走龙卷,吸引并撕裂附近敌人。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: 2.5 + (lv - 1) * 1, cooldown: Math.max(1.5, 3.2 - (lv - 1) * 0.2), radius: 58 + (lv - 1) * 6, speed: 140, life: 1.5 + (lv - 1) * 0.2, pull: 170 };
      }
    },
    sentry: {
      name: "哨卫炮塔", icon: "⌖", color: "#ffd86b", max: 8, kind: "sentry",
      desc: "部署环绕炮塔,自动射击最近敌人。",
      tags: ["ranged"],
      stats: function (lv) {
        return { damage: (8 + (lv - 1) * 2.4) * 1.1, count: 1 + (lv >= 3 ? 1 : 0) + (lv >= 6 ? 1 : 0), fireCd: Math.max(0.5, 0.85 - (lv - 1) * 0.06), radius: 115, projSpeed: 380, spin: 1.0 + (lv - 1) * 0.15, interceptR: 26 + (lv - 1) * 2 };
      }
    },
    meteor: {
      name: "陨石", icon: "☄", color: "#ff7a3c", max: 8, kind: "meteor",
      desc: "锁定附近敌群最密集处,天降陨石,延迟爆炸。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: 27 + (lv - 1) * (25.5 / 7), radius: 60 + (lv - 1) * (34 / 7), cooldown: Math.max(3.4, 4.0 - (lv - 1) * (0.5 / 7)), arm: 0.55, count: 1 + (lv >= 4 ? 1 : 0) + (lv >= 7 ? 1 : 0), burn: 0, burnDur: 0 };
      }
    },
    shockwave: {
      name: "冲击波", icon: "◎", color: "#8be9ff", max: 8, kind: "shockwave",
      desc: "朝最近敌人挥出冲击扇形,击退并伤害范围内敌人。",
      tags: ["melee"],
      stats: function (lv) {
        return { damage: (13 + (lv - 1) * 4.2) * 1.2, radius: 110 + (lv - 1) * 9, cooldown: Math.max(0.9, 1.7 - (lv - 1) * 0.11), count: 1 + (lv >= 6 ? 1 : 0), arc: 0.85 + (lv - 1) * 0.03, knock: 22 + (lv - 1) * 3 };
      }
    },
    hex: {
      name: "诅咒", icon: "✟", color: "#b06bff", max: 8, kind: "hex",
      desc: "优先锁定可见高血量敌人(优先Boss),延迟引爆:固定伤害 + 百分比最大生命伤害(对Boss百分比降至1/5),目标被提前击杀则诅咒蔓延。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: (10 + (lv - 1) * 3) * 0.5625, frac: Math.min(0.12, 0.05 + (lv - 1) * 0.01), count: 1 + Math.floor((lv - 1) / 2), spread: 1 + Math.floor((lv - 1) / 3), delay: 2.2, cooldown: Math.max(0.9, 1.8 - (lv - 1) * 0.1) * 1.2 };
      }
    },
    crescent: {
      name: "月牙斩", icon: "☾", color: "#9bf0c0", max: 8, kind: "crescent",
      desc: "朝最近敌人挥出大扇形弧刃,横扫范围内敌人。",
      tags: ["melee"],
      stats: function (lv) {
        return { damage: (18.5 + (lv - 1) * 5) * 1.2, cooldown: Math.max(0.7, 1.5 - (lv - 1) * 0.075), radius: 95 + (lv - 1) * 9, arc: 1.5 + (lv - 1) * 0.06, count: 1 + (lv >= 4 ? 1 : 0) };
      }
    },
    detonate: {
      name: "殉爆重击", icon: "❋", color: "#ff8a4c", max: 8, kind: "detonate",
      desc: "挥砍命中按概率以敌人为圆心引爆,造成范围爆炸。",
      tags: ["melee"],
      stats: function (lv) {
        return { damage: (18 + (lv - 1) * 4) * 1.2, cooldown: Math.max(1.1, 2.0 - (lv - 1) * 0.08), count: 1 + (lv >= 4 ? 1 : 0) + (lv >= 7 ? 1 : 0), radius: 85 + (lv - 1) * 8, arc: 1.2 + (lv - 1) * 0.05, explodeChance: Math.min(0.8, 0.35 + (lv - 1) * 0.06), explodeR: 50 + (lv - 1) * 5, explodeDmg: (30 + (lv - 1) * 7) * 1.2, explodeBudget: 2 + Math.floor((lv - 1) * 2 / 7) };
      }
    },
    spear: {
      name: "贯穿战矛", icon: "➹", color: "#ffd27a", max: 8, kind: "spear",
      desc: "向前突刺长矛,窄锥贯穿沿途所有敌人,高单体爆发。",
      tags: ["melee"],
      stats: function (lv) {
        return { damage: (21.8 + (lv - 1) * 7) * 1.1, cooldown: Math.max(0.9, 1.9 - (lv - 1) * 0.1), radius: 130 + (lv - 1) * 14, arc: 0.20 };
      }
    },
    polymorph: {
      name: "变形术", icon: "☁", color: "#ffe9a8", max: 8, kind: "polymorph",
      desc: "发射追踪弹,命中敌人变羊:期间随机游走、不能攻击、无接触伤害,且受伤增加。弹体穿过已变羊的目标,只打新鲜敌人。",
      tags: ["spell"],
      stats: function (lv) {
        // 控制武器：基础定向伤害 +10%，进化与融合保持原有最终伤害。
        return { damage: (13 + (lv - 1) * (10 / 7)) * 1.1, cooldown: Math.max(1.7, 3.6 - (lv - 1) * 0.24), count: 1 + Math.floor(lv / 2), dur: 2.5 + (lv - 1) * 0.18, speed: 260, life: 2.7 };
      }
    },
    timestop: {
      name: "时停力场", icon: "◷", color: "#bfe9ff", max: 8, kind: "timestop",
      desc: "锁定敌群密集处,天降时停力场,延迟落地冻结范围内敌人(冻结者不动不射弹,但仍有接触伤害)。",
      tags: ["spell"],
      stats: function (lv) {
        return { damage: 10.5 + (lv - 1) * 3, cooldown: Math.max(2.6, 4.9 - (lv - 1) * 0.3), radius: 50 + (lv - 1) * 5.5, freeze: 1.0 + (lv - 1) * 0.13, arm: 0.6, count: 1 + (lv >= 3 ? 1 : 0) + (lv >= 6 ? 1 : 0) };
      }
    }
  };

  // 基础武器统一微调；进化/融合中引用基础 stats 的字段自然继承。
  for (const id in WEAPONS) {
    const rawStats = WEAPONS[id].stats;
    WEAPONS[id].stats = function (lv) {
      const s = rawStats(lv);
      for (const key of ["damage", "dot", "explodeDmg"]) if (typeof s[key] === "number") s[key] *= 1.03;
      return s;
    };
  }

  // 进化(16 对)。reqPassive 必须满级,武器满级,则在升级时以高优先级出现。
  const EVOLUTIONS = {
    blade: { to: "blade_evo", name: "死亡之轮", reqPassive: "maxhp", desc: "8 刃缓速环绕，每把刀刃按实际接触持续切割近身敌人。", color: "#ffd0a0", icon: "☀" },
    missile: { to: "missile_evo", name: "聚能核弹", reqPassive: "damage", desc: "高伤穿透核弹:击杀后在飞行时限内无限追猎,伤害不衰减。", color: "#ff9a3c", icon: "✸" },
    chain: { to: "chain_evo", name: "特斯拉风暴", reqPassive: "cooldown", desc: "连跳 8 次,每跳伤害递增。", color: "#d0c4ff", icon: "⚟" },
    aura: { to: "aura_evo", name: "黑洞光环", reqPassive: "area", desc: "吸入敌人，半径扩大，每 0.24 秒造成伤害。", color: "#c084fc", icon: "◉" },
    frost: { to: "frost_evo", name: "绝对零度", reqPassive: "speed", desc: "同一敌人累计命中 3 次后冻结 0.6s,冻结时受伤+50%(冻结者仍有接触伤害)。", color: "#a8f0ff", icon: "❅" },
    boomerang: { to: "boomerang_evo", name: "风暴手里剑", reqPassive: "crit", desc: "扇形掷出 5 发穿透回旋。", color: "#7df9ff", icon: "✪" },
    shotgun: { to: "shotgun_evo", name: "双管歼灭", reqPassive: "magnet", desc: "弹丸数翻倍、锥角扩大、可穿透 1 次。", color: "#ffe066", icon: "≣" },
    lance: { to: "lance_evo", name: "分裂激光", reqPassive: "armor", desc: "两道相隔 180° 的环绕激光,旋转较慢,线上敌人每 0.1s 持续受创(多次伤害)。", color: "#ff6b9d", icon: "⇶" },
    grenade: { to: "grenade_evo", name: "集束炸弹", reqPassive: "regen", desc: "爆炸时额外产生 1 次附近的小范围爆炸。", color: "#ffb300", icon: "✺" },
    railgun: { to: "railgun_evo", name: "爆裂贯穿", reqPassive: "luck", desc: "寻找可贯穿最多敌人的方向，命中时产生范围爆炸。", color: "#ff3d5a", icon: "⟹" },
    poison: { to: "poison_evo", name: "剧毒瘟疫", reqPassive: "crit", desc: "剧毒传染给附近敌人并减速,持续伤害更高。", color: "#b6ff5a", icon: "☣" },
    vortex: { to: "vortex_evo", name: "风暴之眼", reqPassive: "lifesteal", desc: "召唤双龙卷、吸力大增、留下伤害场。", color: "#9affff", icon: "✺" },
    sentry: { to: "sentry_evo", name: "火力堡垒", reqPassive: "area", desc: "炮塔更多、射速更快、子弹穿透。", color: "#ffe066", icon: "⌖" },
    meteor: { to: "meteor_evo", name: "星陨", reqPassive: "area", desc: "多陨齐落、范围更大,落地留下焦土持续灼烧敌群。", color: "#ffb14d", icon: "☄" },
    shockwave: { to: "shockwave_evo", name: "共振冲击", reqPassive: "cooldown", desc: "扇形更多、击退更猛、命中冰冻。", color: "#bdeeff", icon: "◎" },
    hex: { to: "hex_evo", name: "天罚瘟疫", reqPassive: "crit", desc: "标记更多、蔓延更广、引爆更快。", color: "#c89bff", icon: "✟" },
    crescent: { to: "crescent_evo", name: "满月斩", reqPassive: "lifesteal", desc: "弧刃更宽更多,挥砍留下伤害弧地。", color: "#c8f7d8", icon: "☾" },
    detonate: { to: "detonate_evo", name: "连环殉爆", reqPassive: "crit", desc: "爆炸必触发且范围更大,并可连环引爆邻居。", color: "#ffb070", icon: "❋" },
    spear: { to: "spear_evo", name: "破甲贯刺", reqPassive: "damage", desc: "每 0.8s 突刺,距离 +30%;命中施加 1.5s 破甲,期间目标承受所有伤害 +50%(再次命中刷新时间)。", color: "#ffe09a", icon: "➹" },
    polymorph: { to: "polymorph_evo", name: "贯穿变形", reqPassive: "area", desc: "弹更多、适度延长变形，每发命中后可穿透再变一只。", color: "#fff0c0", icon: "☁" },
    timestop: { to: "timestop_evo", name: "绝对静止", reqPassive: "cooldown", desc: "多场齐落、范围更大、冻者碎裂额外受伤(冻结者不动不射弹,但仍有接触伤害)。", color: "#d6f3ff", icon: "◷" }
  };
  // 进化后的武器用同名 _evo def(继承数值,kind 行为增强)。在 weapons.js 中以 evolved 标记处理。
  const WEAPON_EVOS = {
    blade_evo: Object.assign({}, WEAPONS.blade, { name: EVOLUTIONS.blade.name, color: EVOLUTIONS.blade.color, icon: EVOLUTIONS.blade.icon, evo: true, stats: function (lv) { const s = WEAPONS.blade.stats(8); return { damage: 57.84, count: 8, radius: s.radius * 1.5, spin: 3.2 }; } }),
    missile_evo: Object.assign({}, WEAPONS.missile, { name: EVOLUTIONS.missile.name, color: EVOLUTIONS.missile.color, icon: EVOLUTIONS.missile.icon, evo: true, desc: EVOLUTIONS.missile.desc, stats: function (lv) { const s = WEAPONS.missile.stats(8); return Object.assign({}, s, { damage: 150, cooldown: 1.9, count: 3, chase: 99, infiniteChase: true, chaseDecay: 1 }); } }),
    chain_evo: Object.assign({}, WEAPONS.chain, { name: EVOLUTIONS.chain.name, color: EVOLUTIONS.chain.color, icon: EVOLUTIONS.chain.icon, evo: true, stats: function (lv) { const s = WEAPONS.chain.stats(8); return Object.assign({}, s, { damage: 47.5, chains: 8, range: s.range + 60 }); } }),
    aura_evo: Object.assign({}, WEAPONS.aura, { name: EVOLUTIONS.aura.name, color: EVOLUTIONS.aura.color, icon: EVOLUTIONS.aura.icon, evo: true, stats: function (lv) { return { damage: 26, radius: 180, tick: 0.24, pull: 210 }; } }),
    frost_evo: Object.assign({}, WEAPONS.frost, { name: EVOLUTIONS.frost.name, color: EVOLUTIONS.frost.color, icon: EVOLUTIONS.frost.icon, evo: true, stats: function (lv) { const s = WEAPONS.frost.stats(8); return Object.assign({}, s, { damage: 42, cooldown: 0.94, freeze: 0.6, freezeHits: 3, freezeVuln: 1.5, slow: 0.8 }); } }),
    boomerang_evo: Object.assign({}, WEAPONS.boomerang, { name: EVOLUTIONS.boomerang.name, color: EVOLUTIONS.boomerang.color, icon: EVOLUTIONS.boomerang.icon, evo: true, stats: function (lv) { const s = WEAPONS.boomerang.stats(8); return Object.assign({}, s, { damage: 45.8, count: 5, pierce: true }); } }),
    shotgun_evo: Object.assign({}, WEAPONS.shotgun, { name: EVOLUTIONS.shotgun.name, color: EVOLUTIONS.shotgun.color, icon: EVOLUTIONS.shotgun.icon, evo: true, stats: function (lv) { const s = WEAPONS.shotgun.stats(8); return Object.assign({}, s, { damage: s.damage - 6, count: s.count * 2, cone: s.cone * 1.4, pierce: 1 }); } }),
    lance_evo: Object.assign({}, WEAPONS.lance, { name: EVOLUTIONS.lance.name, color: EVOLUTIONS.lance.color, icon: EVOLUTIONS.lance.icon, evo: true, stats: function (lv) { const s = WEAPONS.lance.stats(8); return Object.assign({}, s, { damage: 48, beams: 2, spin: 1.74, width: 8, tick: 0.1, length: Math.round(s.length * 1.15) }); } }),
    grenade_evo: Object.assign({}, WEAPONS.grenade, { name: EVOLUTIONS.grenade.name, color: EVOLUTIONS.grenade.color, icon: EVOLUTIONS.grenade.icon, evo: true, stats: function (lv) { const s = WEAPONS.grenade.stats(8); return Object.assign({}, s, { damage: s.damage + 4, count: s.count + 1, cluster: 1 }); } }),
    railgun_evo: Object.assign({}, WEAPONS.railgun, { name: EVOLUTIONS.railgun.name, color: EVOLUTIONS.railgun.color, icon: EVOLUTIONS.railgun.icon, evo: true, stats: function (lv) { const s = WEAPONS.railgun.stats(8); return Object.assign({}, s, { damage: 118, explode: 80 }); } }),
    poison_evo: Object.assign({}, WEAPONS.poison, { name: EVOLUTIONS.poison.name, color: EVOLUTIONS.poison.color, icon: EVOLUTIONS.poison.icon, evo: true, stats: function (lv) { const s = WEAPONS.poison.stats(8); return Object.assign({}, s, { dot: s.dot + 18, dotDur: s.dotDur + 1.5, spread: true, slow: 0.35, slowDur: 1.5 }); } }),
    vortex_evo: Object.assign({}, WEAPONS.vortex, { name: EVOLUTIONS.vortex.name, color: EVOLUTIONS.vortex.color, icon: EVOLUTIONS.vortex.icon, evo: true, stats: function (lv) { const s = WEAPONS.vortex.stats(8); return Object.assign({}, s, { count: 2, damage: s.damage + 0.5, pull: s.pull + 130, radius: s.radius * 1.25 }); } }),
    sentry_evo: Object.assign({}, WEAPONS.sentry, { name: EVOLUTIONS.sentry.name, color: EVOLUTIONS.sentry.color, icon: EVOLUTIONS.sentry.icon, evo: true, stats: function (lv) { const s = WEAPONS.sentry.stats(8); return Object.assign({}, s, { damage: 28.8, count: s.count + 1, fireCd: 0.5, pierce: 1, spin: s.spin + 0.6, interceptR: s.interceptR + 8 }); } }),
    meteor_evo: Object.assign({}, WEAPONS.meteor, { name: EVOLUTIONS.meteor.name, color: EVOLUTIONS.meteor.color, icon: EVOLUTIONS.meteor.icon, evo: true, stats: function (lv) { const s = WEAPONS.meteor.stats(8); return Object.assign({}, s, { damage: (s.damage + 6) * 0.9, count: s.count + 2, radius: Math.round(s.radius * 1.25), burn: 7.2, burnDur: 2.0 }); } }),
    shockwave_evo: Object.assign({}, WEAPONS.shockwave, { name: EVOLUTIONS.shockwave.name, color: EVOLUTIONS.shockwave.color, icon: EVOLUTIONS.shockwave.icon, evo: true, stats: function (lv) { const s = WEAPONS.shockwave.stats(8); return Object.assign({}, s, { damage: 56.88, count: s.count + 1, radius: Math.round(s.radius * 1.25), knock: s.knock + 28, freeze: 0.4 }); } }),
    hex_evo: Object.assign({}, WEAPONS.hex, { name: EVOLUTIONS.hex.name, color: EVOLUTIONS.hex.color, icon: EVOLUTIONS.hex.icon, evo: true, stats: function (lv) { const s = WEAPONS.hex.stats(8); return Object.assign({}, s, { damage: 20.8125, count: s.count + 2, spread: s.spread + 2, frac: Math.min(0.15, s.frac + 0.03), delay: s.delay - 0.4 }); } }),
    crescent_evo: Object.assign({}, WEAPONS.crescent, { name: EVOLUTIONS.crescent.name, color: EVOLUTIONS.crescent.color, icon: EVOLUTIONS.crescent.icon, evo: true, stats: function (lv) { const s = WEAPONS.crescent.stats(8); return { damage: 72, count: s.count + 1, radius: Math.round(s.radius * 1.2), arc: s.arc + 0.4, cooldown: s.cooldown, leaveTrail: true }; } }),
    detonate_evo: Object.assign({}, WEAPONS.detonate, { name: EVOLUTIONS.detonate.name, color: EVOLUTIONS.detonate.color, icon: EVOLUTIONS.detonate.icon, evo: true, stats: function (lv) { const s = WEAPONS.detonate.stats(8); return Object.assign({}, s, { damage: 82, count: (s.count || 1) + 1, explodeChance: 0.9, explodeDmg: 145, explodeR: s.explodeR + 10, chainHops: 2, explodeBudget: 5 }); } }),
    spear_evo: Object.assign({}, WEAPONS.spear, { name: EVOLUTIONS.spear.name, color: EVOLUTIONS.spear.color, icon: EVOLUTIONS.spear.icon, evo: true, desc: EVOLUTIONS.spear.desc, stats: function (lv) { const s = WEAPONS.spear.stats(8); return { damage: 77.76, cooldown: 0.8, radius: Math.round(s.radius * 1.3), arc: s.arc, armorBreak: 1.5 }; } }),
    polymorph_evo: Object.assign({}, WEAPONS.polymorph, { name: EVOLUTIONS.polymorph.name, color: EVOLUTIONS.polymorph.color, icon: EVOLUTIONS.polymorph.icon, evo: true, stats: function (lv) { const s = WEAPONS.polymorph.stats(8); return Object.assign({}, s, { damage: 27, count: s.count + 1, dur: 4.5, pierce: 1 }); } }),
    timestop_evo: Object.assign({}, WEAPONS.timestop, { name: EVOLUTIONS.timestop.name, color: EVOLUTIONS.timestop.color, icon: EVOLUTIONS.timestop.icon, evo: true, stats: function (lv) { const s = WEAPONS.timestop.stats(8); return Object.assign({}, s, { damage: 33.5, radius: 102, freeze: s.freeze + 0.6, count: s.count + 1, shatter: true }); } }),
    // ── 协同进化(两把已进化武器合成)。kind:"fusion" 由 weapons.js 分发双机制。
    blade_aura: Object.assign({}, WEAPONS.blade, { name: "湮灭之轮", color: "#ffd0a0", icon: "☀", evo: true, kind: "fusion", fuse: ["blade_evo", "aura_evo"], stats: function (lv) { const s = WEAPONS.blade.stats(8); return { damage: 46.2, bladeTick: 0.25, count: 8, radius: s.radius * 1.6, spin: s.spin + 1.2, splash: 26, splashDamage: 27.72, auraDamage: 27.72, auraTick: 0.4, pull: 150, pullRangeMul: 1.3, pullStopRatio: 0.96 }; } }),
    missile_chain: Object.assign({}, WEAPONS.missile, { name: "雷暴蜂群", color: "#ff9a3c", icon: "⚡", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["missile_evo", "chain_evo"], stats: function (lv) { return { damage: 43.74, cooldown: 0.9, count: 5, speed: 300, seek: 5, life: 2.2, chase: 2, chaseDecay: 1, chainHops: 3, chainRange: 180 }; } }),
    railgun_grenade: Object.assign({}, WEAPONS.railgun, { name: "轨道轰炸", color: "#ff5d73", icon: "☄", evo: true, kind: "fusion", fuse: ["railgun_evo", "grenade_evo"], stats: function (lv) { const s = WEAPONS.railgun.stats(8); return Object.assign({}, s, { damage: 223, cooldown: 1.6, explode: 58, cluster: 2 }); } }),
    frost_poison: Object.assign({}, WEAPONS.frost, { name: "冰霜瘟疫", color: "#a8f0ff", icon: "❅", evo: true, kind: "fusion", tags: ["spell"], fuse: ["frost_evo", "poison_evo"], stats: function () { return { damage: 38, radius: 215, cooldown: 0.85, slow: 0.5, slowDur: 1.4, expand: 620, dot: 24, dotDur: 4, freeze: 0.5, freezeHits: 3 }; } }),
    boomerang_sentry: Object.assign({}, WEAPONS.sentry, { name: "风暴哨戒", color: "#7df9ff", icon: "✪", evo: true, kind: "fusion", fuse: ["boomerang_evo", "sentry_evo"], stats: function (lv) { const s = WEAPONS.sentry.stats(8); return Object.assign({}, s, { count: s.count + 2, damage: 40.8, projSpeed: 380, pierce: 2, life: 1.6 }); } }),
    lance_vortex: Object.assign({}, WEAPONS.vortex, { name: "裂空风暴", color: "#ff6b9d", icon: "⇶", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["lance_evo", "vortex_evo"], stats: function () { return { damage: 19.02, cooldown: 2.4, count: 2, speed: 140, life: 4, radius: 90, vrad: 90, pull: 260, beamDmg: 31.4, beamTick: 0.12, beamLen: 220, beamWidth: 6, beamSpin: 1.8 }; } }),
    shotgun_grenade: Object.assign({}, WEAPONS.shotgun, { name: "爆裂霰弹", color: "#ffe066", icon: "≣", evo: true, kind: "fusion", fuse: ["shotgun_evo", "grenade_evo"], stats: function (lv) { const s = WEAPONS.shotgun.stats(8); return Object.assign({}, s, { damage: 65.12, cooldown: 0.8, count: s.count + 2, cone: s.cone * 1.2, splash: 28, splashMul: 0.45 }); } }),
    meteor_chain: Object.assign({}, WEAPONS.meteor, { name: "陨雷审判", color: "#ffb14d", icon: "☄", evo: true, kind: "fusion", fuse: ["meteor_evo", "chain_evo"], stats: function (lv) { const s = WEAPONS.meteor.stats(8); return Object.assign({}, s, { damage: 109.38, count: s.count + 2, radius: Math.round(s.radius * 1.2), burn: 24.5, burnDur: 2.2, chainHops: 3, chainRange: 170 }); } }),
    shockwave_frost: Object.assign({}, WEAPONS.shockwave, { name: "冰碎共振", color: "#a8f0ff", icon: "◎", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["shockwave_evo", "frost_evo"], stats: function (lv) { const s = WEAPONS.shockwave.stats(8); return Object.assign({}, s, { damage: 220, count: s.count + 1, radius: Math.round(s.radius * 1.25), knock: s.knock + 22, freeze: 1.2, shatter: 60, shatterMul: 0.5 }); } }),
    hex_poison: Object.assign({}, WEAPONS.hex, { name: "腐朽天灾", color: "#9bff5a", icon: "☣", evo: true, kind: "fusion", tags: ["spell"], fuse: ["hex_evo", "poison_evo"], stats: function (lv) { const s = WEAPONS.hex.stats(8); return Object.assign({}, s, { damage: 30, count: s.count + 7, spread: s.spread + 4, frac: 0.15, dot: 32, dotDur: 3.5, fuseCut: 0.15 }); } }),
    crescent_detonate: Object.assign({}, WEAPONS.crescent, { name: "血月断头台", color: "#ff7a8a", icon: "☾", evo: true, kind: "fusion", tags: ["melee"], fuse: ["crescent_evo", "detonate_evo"], stats: function (lv) { const s = WEAPONS.crescent.stats(8); const d = WEAPONS.detonate.stats(8); return { damage: 50.63, radius: Math.round(s.radius * 1.25), arc: s.arc + 0.4, count: s.count + 1, explodeChance: 1.0, explodeR: d.explodeR + 12, explodeDmg: 86.62, chainHops: 2, explodeBudget: 5 }; } }),
    polymorph_timestop: Object.assign({}, WEAPONS.polymorph, { name: "时之诅咒", color: "#d6b3ff", icon: "◷", evo: true, kind: "fusion", tags: ["spell"], fuse: ["polymorph_evo", "timestop_evo"], stats: function (lv) { const pp = WEAPONS.polymorph.stats(8); return { damage: 218.88, cooldown: 3.5, speed: pp.speed, life: pp.life, count: 3, dur: 2.7, bombDmg: 273.6, bombRadius: 90, freeze: 1.4, pierce: 1 }; } }),
    spear_lance: Object.assign({}, WEAPONS.spear, { name: "贯星长矛", color: "#ffd27a", icon: "➹", evo: true, kind: "fusion", tags: ["ranged", "melee"], fuse: ["spear_evo", "lance_evo"], stats: function () { return { damage: 282, cooldown: 0.8, radius: 251, width: 30, armorBreak: 1.5, gridDmg: 60, gridTick: 0.2, gridLife: 0.8, gridLen: 240, gridWidth: 18, gridMax: 4 }; } }),
    blade_boomerang: Object.assign({}, WEAPONS.blade, { name: "回旋星环", color: "#73dcff", icon: "✧", evo: true, kind: "fusion", tags: ["melee", "ranged"], fuse: ["blade_evo", "boomerang_evo"], stats: function () { return { damage: 58.82, count: 8, radius: 155, spin: 3.4, hitCd: 0.258, launchCd: 0.7, launchDamage: 69.2, speed: 350, life: 1.6, maxAway: 2 }; } }),
    blade_frost: Object.assign({}, WEAPONS.blade, { name: "极寒刀阵", color: "#a8f0ff", icon: "❉", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["blade_evo", "frost_evo"], stats: function () { return { damage: 30, count: 8, radius: 150, spin: 3.0, hitCd: 0.25, slow: 0.7, slowDur: 1, frostHits: 1, burstDmg: 50, burstR: 90, freeze: 0.6 }; } }),
    missile_aura: Object.assign({}, WEAPONS.missile, { name: "电浆核弹群", color: "#bd8cff", icon: "◈", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["missile_evo", "aura_evo"], stats: function () { return { damage: 180, cooldown: 1.3, count: 4, speed: 280, seek: 5, life: 2.6, spread: 1.4, coreR: 80, coreDmg: 32, coreTick: 0.3, coreLife: 1.5 }; } }),
    missile_railgun: Object.assign({}, WEAPONS.missile, { name: "制导天矛", color: "#ff7b68", icon: "➠", evo: true, kind: "fusion", tags: ["ranged"], fuse: ["missile_evo", "railgun_evo"], stats: function () { return { damage: 346.5, cooldown: 1.65, count: 2, speed: 700, seek: 6, life: 2.2, calibrate: 0.35, pierce: 99 }; } }),
    chain_sentry: Object.assign({}, WEAPONS.sentry, { name: "雷网堡垒", color: "#b6a6ff", icon: "⌾", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["chain_evo", "sentry_evo"], stats: function () { return { damage: 40.56, count: 5, fireCd: 0.55, radius: 125, projSpeed: 400, spin: 1.5, interceptR: 34, chainHops: 3, chainRange: 150, chainMul: 0.65 }; } }),
    aura_poison: Object.assign({}, WEAPONS.aura, { name: "蚀界黑洞", color: "#a7ff64", icon: "◉", evo: true, kind: "fusion", showPlayerRadius: true, tags: ["melee", "spell"], fuse: ["aura_evo", "poison_evo"], stats: function () { return { damage: 35, radius: 205, tick: 0.15, pull: 160, stackMul: 0.22, maxStacks: 5, stackGrace: 1 }; } }),
    shotgun_shockwave: Object.assign({}, WEAPONS.shotgun, { name: "震荡霰阵", color: "#d6ec8b", icon: "≋", evo: true, kind: "fusion", tags: ["ranged"], fuse: ["shotgun_evo", "shockwave_evo"], stats: function () { return { damage: 70.11, cooldown: 0.85, count: 12, speed: 350, life: 1.45, cone: 1.15, pierce: 1, resonanceHits: 3, resonanceWindow: 0.4, resonanceLock: 0.6, burstDmg: 125.46, burstR: 65, knock: 45 }; } }),
    shotgun_spear: Object.assign({}, WEAPONS.spear, { name: "破阵枪", color: "#ffe28a", icon: "➷", evo: true, kind: "fusion", tags: ["melee", "ranged"], fuse: ["shotgun_evo", "spear_evo"], stats: function () { return { damage: 619.92, cooldown: 0.9, radius: 245, arc: 0.48, armorBreak: 1.2, pelletDamage: 154.98, pelletCount: 4, pelletCap: 16, pelletSpeed: 360, pelletLife: 0.5, pelletCone: 0.35 }; } }),
    boomerang_crescent: Object.assign({}, WEAPONS.boomerang, { name: "月轮归刃", color: "#8fe8c8", icon: "☽", evo: true, kind: "fusion", tags: ["melee", "ranged"], fuse: ["boomerang_evo", "crescent_evo"], stats: function () { return { damage: 92, cooldown: 1.05, count: 3, speed: 300, life: 1.8, outbound: 0.75, spread: 0.38, minR: 30, maxR: 62, trailEvery: 0.18, trailLife: 0.65, trailTick: 0.3, trailDmg: 24 }; } }),
    grenade_meteor: Object.assign({}, WEAPONS.grenade, { name: "天火母弹", color: "#ff934d", icon: "☄", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["grenade_evo", "meteor_evo"], stats: function () { return { damage: 170, cooldown: 2.2, count: 2, radius: 105, speed: 300, life: 1.1, childCount: 3, childDmg: 130, childR: 65, childDelay: 0.15, burn: 18, burnDur: 1.8 }; } }),
    railgun_timestop: Object.assign({}, WEAPONS.railgun, { name: "零时轨道", color: "#e2bfff", icon: "⟾", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["railgun_evo", "timestop_evo"], stats: function () { return { damage: 335, cooldown: 1.9, speed: 900, corridorWidth: 60, corridorLife: 1, corridorDmg: 62, corridorTick: 0.2, freeze: 0.6, length: 720 }; } }),
    vortex_meteor: Object.assign({}, WEAPONS.vortex, { name: "炼狱风眼", color: "#ff9d55", icon: "♨", evo: true, kind: "fusion", tags: ["spell"], fuse: ["vortex_evo", "meteor_evo"], stats: function () { return { damage: 31.92, cooldown: 2.4, count: 2, speed: 130, life: 4, radius: 85, pull: 260, trailTick: 0.5, burn: 45.6, burnR: 55, burnDur: 1.5 }; } }),
    vortex_detonate: Object.assign({}, WEAPONS.vortex, { name: "坍缩爆心", color: "#ff7f83", icon: "✹", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["vortex_evo", "detonate_evo"], stats: function () { return { damage: 10, cooldown: 2.2, count: 2, speed: 125, life: 3.8, radius: 90, pull: 280, captureMax: 6, boomBase: 138, boomPer: 20, boomR: 100, boomRPer: 5 }; } }),
    sentry_hex: Object.assign({}, WEAPONS.sentry, { name: "裁决阵列", color: "#c99aff", icon: "⌬", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["sentry_evo", "hex_evo"], stats: function () { return { damage: 72, count: 5, fireCd: 0.50, radius: 125, projSpeed: 400, spin: 1.45, interceptR: 34, judgeHits: 5, judgeDmg: 150, judgeFrac: 0.08, judgeLock: 1.5 }; } }),
    shockwave_polymorph: Object.assign({}, WEAPONS.shockwave, { name: "牧群冲击", color: "#fff0b0", icon: "♈", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["shockwave_evo", "polymorph_evo"], stats: function () { return { damage: 145, cooldown: 1.1, count: 3, radius: 190, expand: 650, knock: 55, sheep: 1.6, sheepMax: 4, collideDmg: 131.85, collideR: 60 }; } }),
    hex_crescent: Object.assign({}, WEAPONS.crescent, { name: "蚀月刻印", color: "#ba8cff", icon: "☾", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["hex_evo", "crescent_evo"], stats: function () { return { damage: 81.48, cooldown: 1, count: 2, radius: 190, arc: 2.1, delay: 1.1, hexDmg: 61.11, frac: 0.15, spread: 1, echoDmg: 43.65 }; } }),
    detonate_polymorph: Object.assign({}, WEAPONS.polymorph, { name: "爆裂羊群", color: "#ffb079", icon: "♉", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["detonate_evo", "polymorph_evo"], stats: function () { return { damage: 77.4, cooldown: 2, count: 3, speed: 280, life: 2.7, dur: 2.2, bombDmg: 193.5, bombRadius: 85, spreadChance: 0.4, spreadDur: 1.1 }; } }),
    spear_timestop: Object.assign({}, WEAPONS.spear, { name: "时隙长枪", color: "#d7eaff", icon: "⇥", evo: true, kind: "fusion", tags: ["melee", "spell"], fuse: ["spear_evo", "timestop_evo"], stats: function () { return { damage: 241.8, cooldown: 0.9, radius: 260, width: 8, arc: 0.28, armorBreak: 1.2, echoDelay: 0.7, echoDmg: 179.8, freeze: 0.8 }; } }),
    lance_chain: Object.assign({}, WEAPONS.lance, { name: "雷霆光轨", color: "#e6a6ff", icon: "ϟ", evo: true, kind: "fusion", tags: ["ranged", "spell"], fuse: ["lance_evo", "chain_evo"], stats: function () { return { damage: 29.28, beams: 2, spin: 1.8, length: 330, width: 8, tick: 0.12, chainDmg: 25.2, chainHops: 5, chainRange: 200, chainMul: 0.75 }; } })
  };
  // ── 协同进化组合表(升级池触发:两武器均已进化)。32 组,每把基础武器至少 3 条路线。
  const FUSIONS = [
    { w1: "blade_evo", w2: "aura_evo", to: "blade_aura", name: "湮灭之轮", desc: "刃刃溅射,黑洞聚怪,近身绞杀一切。", color: "#ffd0a0", icon: "☀" },
    { w1: "missile_evo", w2: "chain_evo", to: "missile_chain", name: "雷暴蜂群", desc: "分裂追踪弹命中触发连锁闪电,自动索敌+群体。", color: "#ff9a3c", icon: "⚡" },
    { w1: "railgun_evo", w2: "grenade_evo", to: "railgun_grenade", name: "轨道轰炸", desc: "贯穿即爆，首命中额外引发两次附近爆炸。", color: "#ff5d73", icon: "☄" },
    { w1: "frost_evo", w2: "poison_evo", to: "frost_poison", name: "冰霜瘟疫", desc: "冰爆上毒并减速，同一敌人累计三击后冻结。", color: "#a8f0ff", icon: "❅" },
    { w1: "boomerang_evo", w2: "sentry_evo", to: "boomerang_sentry", name: "风暴哨戒", desc: "五座哨塔齐射去返回旋镖,穿透收割。", color: "#7df9ff", icon: "✪" },
    { w1: "lance_evo", w2: "vortex_evo", to: "lance_vortex", name: "裂空风暴", desc: "龙卷聚怪,双向激光以龙卷为中心持续旋转切割。", color: "#ff6b9d", icon: "⇶" },
    { w1: "shotgun_evo", w2: "grenade_evo", to: "shotgun_grenade", name: "爆裂霰弹", desc: "锥形弹幕,每发命中溅射开花。", color: "#ffe066", icon: "≣" },
    { w1: "meteor_evo", w2: "chain_evo", to: "meteor_chain", name: "陨雷审判", desc: "陨石落地连锁闪电,轰炸整片敌群。", color: "#ffb14d", icon: "☄" },
    { w1: "shockwave_evo", w2: "frost_evo", to: "shockwave_frost", name: "冰碎共振", desc: "冲击波冻住敌人,冰冻目标被波及即碎裂。", color: "#a8f0ff", icon: "◎" },
    { w1: "hex_evo", w2: "poison_evo", to: "hex_poison", name: "腐朽天灾", desc: "诅咒附带剧毒,引爆时瘟疫蔓延。", color: "#9bff5a", icon: "☣" },
    { w1: "crescent_evo", w2: "detonate_evo", to: "crescent_detonate", name: "血月断头台", desc: "巨型挥砍,命中必爆且连环引爆,近战清场终技。", color: "#ff7a8a", icon: "☾" },
    { w1: "polymorph_evo", w2: "timestop_evo", to: "polymorph_timestop", name: "时之诅咒", desc: "变羊结束或提前死亡时引爆时间冻结。", color: "#d6b3ff", icon: "◷" },
    { w1: "spear_evo", w2: "lance_evo", to: "spear_lance", name: "贯星长矛", desc: "贯刺沿途建立横向光栅,切割并封锁矛路。", color: "#ffd27a", icon: "➹" },
    { w1: "blade_evo", w2: "boomerang_evo", to: "blade_boomerang", name: "回旋星环", desc: "环刃轮流脱离星环,追敌后返航补位。", color: "#73dcff", icon: "✧" },
    { w1: "blade_evo", w2: "frost_evo", to: "blade_frost", name: "极寒刀阵", desc: "刀刃累积寒气,第三击引发冻结冰爆。", color: "#a8f0ff", icon: "❉" },
    { w1: "missile_evo", w2: "aura_evo", to: "missile_aura", name: "电浆核弹群", desc: "四弹分头追踪，命中后附着短时范围灼烧电浆核。", color: "#bd8cff", icon: "◈" },
    { w1: "missile_evo", w2: "railgun_evo", to: "missile_railgun", name: "制导天矛", desc: "先制导校准,再化为高速贯穿天矛。", color: "#ff7b68", icon: "➠" },
    { w1: "chain_evo", w2: "sentry_evo", to: "chain_sentry", name: "雷网堡垒", desc: "炮塔射出会跳跃的电弹,分区织成雷网。", color: "#b6a6ff", icon: "⌾" },
    { w1: "aura_evo", w2: "poison_evo", to: "aura_poison", name: "蚀界黑洞", desc: "黑洞吸住敌人,停留越久腐蚀越深。", color: "#a7ff64", icon: "◉" },
    { w1: "shotgun_evo", w2: "shockwave_evo", to: "shotgun_shockwave", name: "震荡霰阵", desc: "密集命中积累共振,从目标体内爆出冲击波。", color: "#d6ec8b", icon: "≋" },
    { w1: "shotgun_evo", w2: "spear_evo", to: "shotgun_spear", name: "破阵枪", desc: "长枪贯阵,每个贯穿点继续喷出前向碎弹。", color: "#ffe28a", icon: "➷" },
    { w1: "boomerang_evo", w2: "crescent_evo", to: "boomerang_crescent", name: "月轮归刃", desc: "宽弧月轮飞出后回归,来回各扫一次。", color: "#8fe8c8", icon: "☽" },
    { w1: "grenade_evo", w2: "meteor_evo", to: "grenade_meteor", name: "天火母弹", desc: "母弹爆开后标定落点,连续召来小陨石。", color: "#ff934d", icon: "☄" },
    { w1: "railgun_evo", w2: "timestop_evo", to: "railgun_timestop", name: "零时轨道", desc: "贯穿光轨把整条弹道冻结成静滞走廊。", color: "#e2bfff", icon: "⟾" },
    { w1: "vortex_evo", w2: "meteor_evo", to: "vortex_meteor", name: "炼狱风眼", desc: "移动火龙卷拖出焦土,把敌人卷入火径。", color: "#ff9d55", icon: "♨" },
    { w1: "vortex_evo", w2: "detonate_evo", to: "vortex_detonate", name: "坍缩爆心", desc: "卷入的敌人越多,龙卷消失时爆炸越强。", color: "#ff7f83", icon: "✹" },
    { w1: "sentry_evo", w2: "hex_evo", to: "sentry_hex", name: "裁决阵列", desc: "炮塔集火刻下印记,五次命中后执行裁决。", color: "#c99aff", icon: "⌬" },
    { w1: "shockwave_evo", w2: "polymorph_evo", to: "shockwave_polymorph", name: "牧群冲击", desc: "冲击波把敌人变羊并推飞,撞群后爆开。", color: "#fff0b0", icon: "♈" },
    { w1: "hex_evo", w2: "crescent_evo", to: "hex_crescent", name: "蚀月刻印", desc: "月牙刻下诅咒,引爆时再斩向下一目标。", color: "#ba8cff", icon: "☾" },
    { w1: "detonate_evo", w2: "polymorph_evo", to: "detonate_polymorph", name: "爆裂羊群", desc: "被变形的敌人成为会游走的限时炸弹。", color: "#ffb079", icon: "♉" },
    { w1: "spear_evo", w2: "timestop_evo", to: "spear_timestop", name: "时隙长枪", desc: "长枪穿刺后,原路径延迟重演冻结一击。", color: "#d7eaff", icon: "⇥" },
    { w1: "lance_evo", w2: "chain_evo", to: "lance_chain", name: "雷霆光轨", desc: "旋转激光扫中目标后向光束外跳出闪电。", color: "#e6a6ff", icon: "ϟ" }
  ];
  // 协同进化只有一个完成态，不参与普通武器的 1-8 级升级。
  for (const id in WEAPON_EVOS) if (WEAPON_EVOS[id].kind === "fusion") WEAPON_EVOS[id].max = 1;
  // 合并查询入口
  function weaponDef(id) { return WEAPON_EVOS[id] || WEAPONS[id]; }

  // 单一武器视觉描述源。徽章始终只显示该武器自己的一个符号。
  const WEAPON_VISUALS = {
    blade:"rotor", missile:"rocket", chain:"bolt", aura:"halo", shotgun:"scatter", frost:"crystal", lance:"laser",
    boomerang:"starblade", grenade:"fuseball", railgun:"needle", poison:"bio", vortex:"spiral", sentry:"turret",
    meteor:"comet", shockwave:"wave", hex:"sigil", crescent:"moon", detonate:"burst", spear:"spear",
    polymorph:"ramcloud", timestop:"clock"
  };
  function baseWeaponId(id) { return id && id.replace(/_evo$/, ""); }
  function weaponVisual(id) {
    const def = weaponDef(id) || {};
    if (def.kind === "fusion") return { family: "fusion", icon: def.icon || "◆", color: def.color || "#fff", fusion: true };
    const base = baseWeaponId(id);
    return { family: WEAPON_VISUALS[base] || "core", icon: def.icon || "◆", color: def.color || "#fff", evolved: /_evo$/.test(id || "") || !!def.evo };
  }
  function weaponIconHTML(id, cls) {
    const v = weaponVisual(id), cn = cls || "weapon-mark";
    return '<span class="' + cn + ' weapon-mark' + (v.fusion ? ' fusion-mark' : '') + (v.evolved ? ' evolved-mark' : '') + '" style="--c1:' + v.color + '"><i>' + v.icon + '</i></span>';
  }

  // ── 被动(11 种,等级无上限、收益递减;5 级为进化解锁阈值)
  const PASSIVES = {
    maxhp: { name: "生命强化", icon: "❤", desc: "最大生命 +28", per: "+28 上限/级", color: "#ff7d8e" },
    speed: { name: "移速强化", icon: "⚡", desc: "移动速度 +9%", per: "+9%/级", color: "#7dffce" },
    damage: { name: "攻击强化", icon: "⚔", desc: "全部武器伤害 +11%", per: "+11%/级", color: "#ff9a6b" },
    cooldown: { name: "冷却缩减", icon: "◷", desc: "武器冷却 -7.5%", per: "-7.5%/级(上限 -70%)", color: "#9be7ff" },
    area: { name: "范围强化", icon: "◯", desc: "武器范围 +11%", per: "+11%/级", color: "#c06bff" },
    armor: { name: "钢铁护甲", icon: "🛡", desc: "受伤 -9.5%", per: "-9.5%/级(上限 -60%)", color: "#aab4ff" },
    regen: { name: "生命再生", icon: "✚", desc: "每秒回 +2 生命", per: "+2 HP/s/级", color: "#7CFFB2" },
    magnet: { name: "磁吸光环", icon: "✜", desc: "拾取范围 +45%、经验 +9%", per: "+45%/+9%/级", color: "#ffd86b" },
    luck: { name: "幸运", icon: "✦", desc: "稀有强化与特殊掉落(血包/磁铁/清屏/宝箱)出现率 +17%", per: "+17%/级", color: "#ffd0a0" },
    crit: { name: "暴击", icon: "✸", desc: "+9% 暴击率,暴击造成 2 倍伤害", per: "+9%/级(上限 100%)", color: "#ffd86b" },
    lifesteal: { name: "吸血", icon: "♥", desc: "造成伤害的 0.9% 转为生命(秒回上限等于当前吸血率)", per: "+0.9%起(属性上限 7.5%)", color: "#ff5d8e" }
  };

  // 武器「数量」字段的中文量词(用于升级文案/暂停摘要)
  const COUNT_NOUN = { blade: "光刃", missile: "导弹", shotgun: "弹丸", boomerang: "回旋", sentry: "炮塔", grenade: "榴弹", meteor: "陨石", shockwave: "波", hex: "印记", crescent: "月牙", vortex: "龙卷", detonate: "殉爆", polymorph: "变形弹", polymorph_timestop: "变形弹", timestop: "力场",
    blade_boomerang: "光刃", blade_frost: "光刃", missile_aura: "导弹", missile_railgun: "天矛", chain_sentry: "炮塔", shotgun_shockwave: "弹丸", shockwave_frost: "波", boomerang_crescent: "月轮", grenade_meteor: "母弹", vortex_meteor: "龙卷", vortex_detonate: "龙卷", sentry_hex: "炮塔", shockwave_polymorph: "波", hex_crescent: "月牙", detonate_polymorph: "变形弹" };
  // 升级 delta 文案的字段→模板(N=变化量;count 用 COUNT_NOUN)
  const STAT_LABEL = {
    count: "count", damage: "伤害 +{N}", cooldown: "冷却 ↓{N}s", radius: "范围 +{N}",
    chains: "连跳 +{N}", length: "长度 +{N}", width: "宽度 +{N}", speed: "速度 +{N}", chase: "追击 +{N}",
    slow: "减速 +{N}%", slowDur: "减速时长 +{N}s", tick: "频率↑", dot: "毒伤 +{N}",
    dotDur: "毒续 +{N}s", pull: "吸力 +{N}", expand: "扩张 +{N}", fireCd: "射速↑", projSpeed: "弹速 +{N}",
    knock: "击退 +{N}", burn: "灼烧 +{N}", frac: "%生命 +{N}%", spread: "蔓延 +{N}", spin: "旋转 +{N}",
    life: "弹存 +{N}s"
  };

  // ── 可选角色(10 名):startWeapons/startWeaponTags 仅限制起手选择，局内武器池始终全开。
  const CHARACTERS = {
    bulwark: { name: "铁壁", title: "重装战士", icon: "🛡", color: "#aab4ff", startWeaponTags: ["melee"], startPassives: { armor: 1 }, hpMul: 1.2, speedMul: 0.96, special: "bulwark", mechanics: { interval: 2.5, radius: 95, knock: 95, stationaryDr: 0.55 }, ability: { trigger: "站定时每 2.5s", base: "半径95的零伤害击退波", links: "仅起手限近战；范围强化扩大半径，冷却缩减短间隔" }, desc: "HP ×1.2、移速 ×0.96；起手仅可选近战武器，站定额外减伤并周期击退敌人。", appearance: { shape: "circle", deco: "ring" } },
    arcanist: { name: "星语", title: "秘法师", icon: "✦", color: "#c06bff", startWeaponTags: ["spell"], startPassives: { area: 1 }, hpMul: 0.85, speedMul: 1.0, charMods: { pickupMul: 0.75 }, special: "arcanist", weaponSpec: { tag: "spell", damageMul: 1.2, areaMul: 1.1 }, ability: { trigger: "使用法术武器", base: "伤害 +20%、范围 +10%", links: "仅起手限法术；局内全武器开放" }, desc: "HP ×0.85、拾取 ×0.75；法术武器伤害 +20%、范围 +10%。", appearance: { shape: "diamond", deco: "spark" } },
    ranger: { name: "流光", title: "游击射手", icon: "➤", color: "#5ad1ff", startWeaponTags: ["ranged"], startPassives: { cooldown: 1 }, hpMul: 0.85, speedMul: 1.12, charMods: { pickupMul: 0.8 }, special: "ranger", weaponSpec: { tag: "ranged", damageMul: 1.15, cooldownMul: 0.9 }, ability: { trigger: "使用远程武器", base: "伤害 +15%、攻击间隔 ×0.9", links: "仅起手限远程；局内全武器开放" }, desc: "HP ×0.85、移速 ×1.12、拾取 ×0.8；远程专精并自带冷却 1 级。", appearance: { shape: "triangle", deco: "arrow" } },
    assassin: { name: "夜刃", title: "影刃刺客", icon: "✸", color: "#ff5d8e", startWeapons: ["blade", "boomerang", "railgun", "crescent", "detonate", "spear"], startPassives: { crit: 2 }, hpMul: 0.95, speedMul: 1.08, special: "assassin", mechanics: { highHp: 0.7, highMul: 0.9, lowHp: 0.3, lowMul: 2 }, ability: { trigger: "按目标当前生命", base: ">70% HP 伤害 ×0.9；<30% HP 最终伤害 ×2", links: "攻击强化、暴击和吸血均正常生效" }, desc: "HP ×0.95、移速 ×1.08；擅长收割残血，但起手伤害受到轻度抑制。", appearance: { shape: "star", deco: "dagger" } },
    collector: { name: "磁芯", title: "拾取共鸣", icon: "✜", color: "#ffd86b", startWeapons: ["aura", "missile", "chain", "vortex", "sentry", "railgun"], startPassives: { magnet: 1 }, hpMul: 1.0, speedMul: 0.98, charMods: { pickupMul: 1.15 }, special: "collector", mechanics: { xpPerCrystal: 13, maxCrystals: 6, damageBase: 10, damagePerLevel: 0.9, levelSoftcap: 15, radius: 28 }, ability: { trigger: "每获得 13 点实际经验蓄 1 枚，满6枚齐射", base: "每枚伤害 10+0.9×有效等级，爆裂半径28；15级后等效等级按平方根成长", links: "攻击、暴击、吸血、范围；磁吸经验加速充能", damageName: "磁晶齐射" }, desc: "拾取 ×1.15、移速 ×0.98；经验驱动的六枚环绕磁晶。", appearance: { shape: "circle", deco: "magnet" } },
    berserker: { name: "血怒", title: "狂战士", icon: "⚔", color: "#ff5d8e", startWeapons: ["blade", "aura", "shockwave", "crescent", "detonate", "spear"], startPassives: { damage: 1 }, hpMul: 1.0, speedMul: 1.0, charMods: { healingMul: 0.65 }, special: "berserker", mechanics: { fullDamageMul: 0.95, emptyDamageMul: 2, maxDamageReduction: 0.4 }, ability: { trigger: "随自身失血比例线性变化", base: "伤害由满血 ×0.95 至空血 ×2；额外减伤最高40%", links: "再生、吸血、血包治疗实得量 ×0.65" }, desc: "越接近绝境输出和坚韧越强，但所有治疗降至 ×0.65。", appearance: { shape: "square", deco: "rage" } },
    lingerer: { name: "时滞者", title: "时空凝滞", icon: "◷", color: "#9be7ff", startWeapons: ["frost", "vortex", "shockwave", "polymorph", "timestop", "hex"], startPassives: { cooldown: 1 }, hpMul: 1.0, speedMul: 0.96, charMods: { pickupMul: 0.95 }, special: "lingerer", mechanics: { interval: 9, duration: 2, normalScale: 0.35, bossScale: 0.7, cooldownEfficiency: 0.5 }, ability: { trigger: "每 9s 开启 2s 时间断层", base: "普通敌/弹速与计时 ×0.35；Boss/弹幕 ×0.7", links: "冷却缩减以 50% 效率缩短间隔" }, desc: "移速 ×0.96、拾取 ×0.95；周期性扭曲敌方时间。", appearance: { shape: "hex", deco: "clock" } },
    overclocker: { name: "超频者", title: "过载核心", icon: "⚡", color: "#ffb25a", startWeapons: ["missile", "chain", "shotgun", "grenade", "railgun", "meteor"], startPassives: { cooldown: 1 }, hpMul: 0.95, speedMul: 1.0, special: "overclocker", mechanics: { interval: 8, duration: 2.5, damageMul: 1.2, frequencyMul: 1.2, incomingMul: 1.15 }, ability: { trigger: "每 8s 过载 2.5s", base: "武器伤害 ×1.2、攻击频率 ×1.2、承伤 ×1.15", links: "覆盖冷却、光环、炮塔、连续命中与融合间隔；不缩短 DoT/控制" }, desc: "HP ×0.95；周期进入高输出、高风险过载窗口。", appearance: { shape: "diamond", deco: "spark" } },
    phantom: { name: "幻步", title: "残像舞者", icon: "✧", color: "#73dcff", startWeapons: ["blade", "aura", "lance", "boomerang", "vortex", "sentry"], startPassives: { speed: 1 }, hpMul: 0.95, speedMul: 1.1, special: "phantom", mechanics: { moveStep: 180, delay: 0.45, radius: 70, maxAfterimages: 4, damageBase: 14, damagePerLevel: 0.7 }, ability: { trigger: "每移动 180px 留下残像，0.45s 后爆发", base: "伤害 14+0.7×真实等级，半径70，最多4道", links: "攻击、暴击、吸血、范围；移速自然提高触发频率", damageName: "残影爆发" }, desc: "HP ×0.95、移速 ×1.1；以高速移动铺设延时爆发残像。", appearance: { shape: "star", deco: "arrow" } },
    allrounder: { name: "全能者", title: "均衡之刃", icon: "✦", color: "#b8c6ff", startPassives: { maxhp: 1, speed: 1, damage: 1, cooldown: 1, area: 1, armor: 1, regen: 1, magnet: 1, luck: 1, crit: 1, lifesteal: 1 }, hpMul: 1.0, speedMul: 1.0, ability: { trigger: "无额外机制", base: "全部被动各 1 级", links: "全部 21 把基础武器可选起手" }, desc: "开局获得全部被动各 1 级，全面成长，适合任何流派。", appearance: { shape: "circle", deco: "core" } }
  };
  const CHARACTER_ORDER = ["allrounder", "bulwark", "arcanist", "ranger", "assassin", "collector", "berserker", "lingerer", "overclocker", "phantom"];

  function startWeaponIds(ch) {
    if (typeof ch === "string") ch = CHARACTERS[ch];
    if (!ch) return [CONST.XP_START_WEAPON];
    if (ch.startWeapons && ch.startWeapons.length) return ch.startWeapons.filter(function (id) { return !!WEAPONS[id]; });
    if (ch.startWeapon && WEAPONS[ch.startWeapon]) return [ch.startWeapon];
    const tags = ch.startWeaponTags || null, pool = [];
    for (const id in WEAPONS) if (!tags || (WEAPONS[id].tags || []).some(function (t) { return tags.indexOf(t) >= 0; })) pool.push(id);
    return pool.length ? pool : [CONST.XP_START_WEAPON];
  }
  function validStartWeapon(ch, id) { return startWeaponIds(ch).indexOf(id) >= 0; }
  // 旧接口保留给 vm/外部调用；正式流程不再随机。
  function rollStartWeapon(ch) {
    const pool = startWeaponIds(ch);
    return pool[(Math.random() * pool.length) | 0];
  }
  // 起手武器展示文案(选角详情/暂停军械库):随机角色显示类别而非具体武器
  function startWeaponLabel(ch) {
    const ids = startWeaponIds(ch);
    if (ids.length === 1) {
      const d = weaponDef(ids[0]);
      return { icon: d.icon, name: d.name };
    }
    const zh = !(SV.I18n && SV.I18n.getLanguage && SV.I18n.getLanguage() === "en");
    const cn = zh ? { melee: "近战", ranged: "远程", spell: "法术" } : { melee: "Melee", ranged: "Ranged", spell: "Spell" };
    const tags = (ch && ch.startWeaponTags) || [];
    const t = tags.map(function (x) { return cn[x] || x; }).join("·");
    return { icon: "◈", name: zh ? (t ? "可选" + t + "武器" : "可选 " + ids.length + " 把武器") : (t ? t + " starting weapons" : ids.length + " starting weapons") };
  }

  // ── 敌人(20 种)。hp/speed/dmg 为分钟1 基础值,实际生成时乘难度倍率。shape 控制渲染形状,skill 为图鉴文案。
  const ENEMIES = {
    zombie: { name: "腐行者", hp: 10, speed: 55, dmg: 8, xp: 1, r: 12, color: "#7dd87a", ai: "chase", shape: "circle", skill: "直行追击玩家" },
    runner: { name: "飞刃虫", hp: 6, speed: 132, dmg: 6, xp: 1, r: 9, color: "#ff5d6c", ai: "fast", shape: "triangle", skill: "高速摇摆追击" },
    brute: { name: "重装兵", hp: 60, speed: 40, dmg: 18, xp: 5, r: 21, color: "#b06bff", ai: "tank", shape: "square", skill: "缓慢重装推进,高血量" },
    shooter: { name: "炮台", hp: 18, speed: 70, dmg: 6, projDmg: 8, shotWarn: 0.6, shotInterval: 1.9, shotSpeed: 230, shotRange: 360, xp: 3, r: 13, color: "#5ad1ff", ai: "shooter", shape: "pentagon", pattern: "barrel", skill: "中距游走,停步蓄力后远程射击(接触伤害较低)" },
    bomber: { name: "自爆虫", hp: 14, speed: 96, dmg: 14, xp: 2, r: 14, color: "#ff9a3c", ai: "bomber", aoe: 40, shape: "blob", pattern: "crack", skill: "冲撞玩家,贴身自爆(AOE)" },
    swarmer: { name: "食脑蛛", hp: 3, speed: 150, dmg: 4, xp: 1, r: 6, color: "#ffe14d", ai: "fast", shape: "triangle", skill: "成群高速蜂拥" },
    spawner: { name: "母虫巢", hp: 80, speed: 0, dmg: 8, xp: 12, r: 22, color: "#ff5dc0", ai: "spawner", shape: "hex", pattern: "cells", skill: "静止不动,持续孵化食脑蛛(接触伤害较低)" },
    charger: { name: "冲锋兽", hp: 30, speed: 60, chargeSpeed: 380, dmg: 14, xp: 4, r: 15, color: "#6ba8ff", ai: "charger", shape: "triangle", pattern: "chevron", skill: "蓄力预警后高速冲刺" },
    ghost: { name: "萤魂", hp: 25, speed: 160, dmg: 0, xp: 25, r: 10, color: "#bdf0ff", ai: "wander", shape: "star", shimmer: true, skill: "游走的高价值目标(金色闪烁,不攻击)" },
    blinker: { name: "闪烁者", hp: 16, speed: 80, dmg: 10, xp: 3, r: 12, color: "#c084fc", ai: "blink", shape: "diamond", skill: "追击中周期瞬移贴脸" },
    splitter: { name: "分裂者", hp: 42, speed: 68, dmg: 12, xp: 6, r: 18, color: "#8aff7d", ai: "splitter", shape: "blob", skill: "死亡分裂成 2 只食脑蛛" },
    shielder: { name: "盾甲兵", hp: 55, speed: 50, dmg: 16, xp: 7, r: 18, color: "#6b8aff", ai: "shield", dr: 0.55, shape: "hex", pattern: "inner_hex", skill: "自带55%护甲，后期总减伤上限随难度变化" },
    sniper: { name: "狙击手", hp: 20, speed: 60, dmg: 6, projDmg: 11, shotWarn: 0.85, shotInterval: 3.4, shotSpeed: 380, shotRange: 480, xp: 6, r: 12, color: "#ff8aff", ai: "sniper", shape: "diamond", pattern: "sight", skill: "远程站桩,停步蓄力后精确狙击(接触伤害较低)" },
    regen: { name: "自愈者", hp: 48, speed: 56, dmg: 14, xp: 6, r: 16, color: "#5affb0", ai: "regen", regenRate: 7, shape: "cross", pattern: "plus", skill: "持续回血" },
    warden: { name: "光环盾卫", hp: 52, speed: 48, dmg: 14, xp: 8, r: 19, color: "#8aa0ff", ai: "shield_aura", shape: "hex", pattern: "double_hex", auraR: 140, auraDr: 0.40, skill: "给周围敌人套护盾，后期减伤及叠加护甲上限随难度变化" },
    priest: { name: "血祭司", hp: 42, speed: 52, dmg: 12, xp: 8, r: 17, color: "#ff6b8a", ai: "heal_aura", shape: "star", pattern: "trident", auraR: 130, healRate: 4, skill: "治疗周围非祭司敌人，多个祭司仅取最高治疗率" },
    overdriver: { name: "狂热者", hp: 60, speed: 50, dmg: 12, xp: 7, r: 16, color: "#c084fc", ai: "speed_aura", shape: "triangle", pattern: "chevron", auraR: 150, auraSpeed: 1.4, skill: "加速周围敌人(光环范围随时间扩大)" },
    burster: { name: "爆巢者", hp: 40, speed: 64, dmg: 12, xp: 6, r: 18, color: "#ff7a3c", ai: "chase", shape: "blob", pattern: "cells", burstCount: 5, burstType: "swarmer", skill: "死亡爆出一群食脑蛛" },
    stalker: { name: "潜伏者", hp: 35, speed: 78, dmg: 16, xp: 7, r: 15, color: "#a8e8ff", ai: "stalker", shape: "diamond", pattern: "broken", stealth: true, skill: "隐身接近,近身现身突袭(首击破隐)" },
    slimer: { name: "腐泥", hp: 28, speed: 58, dmg: 10, xp: 5, r: 14, color: "#9bff5a", ai: "slime", shape: "blob", trailInterval: 0.30, trailDur: 3.5, trailDmg: 8, skill: "摇摆追击,路径留下连续毒径" }
  };

  // ── Boss。tier:难度级(每关按 5/9.5/13.5min 依 T1→T2→T3 递增出)。skill 为图鉴文案。
  // shotStyle:Boss 弹幕专属视觉风格(ring 空心魔环 / bolt 高速光矛 / rune 符文菱形),普通敌弹不受影响
  const BOSSES = {
    duke: { name: "肥胖公爵", icon: "☠", hp: 980, speed: 40, dmg: 21, attacks: { projectile: [10, 10] }, mechanics: { summonInterval: 5, summonCount: 3, ringInterval: 3.2, ringShots: 12, ringSpeed: 165, seamSpeed: 205 }, r: 40, color: "#d65a8a", xp: 60, tier: 1, shape: "hex", pattern: "crown", shotStyle: "ring", skill: "召唤僵尸 + 环形弹幕 + 预测封路弹" },
    wraith: { name: "双生怨灵", icon: "☾", hp: 736, speed: 100, dmg: 15, attacks: { projectile: [11] }, mechanics: { orbitRadius: 250, orbitRate: 1.3, attackInterval: 2.1, shotSpeed: 260, enragedOrbitMul: 1.6, enragedInterval: 1.2, enrageRingInterval: 5.0, enrageRingShots: 6, enrageRingSpeed: 190 }, r: 24, color: "#9b6bff", xp: 50, tier: 2, count: 2, shape: "diamond", pattern: "crescent", shotStyle: "bolt", skill: "环绕飞行 + 较缓的预测扇形弹幕(同伴死则狂暴并间歇释放六向弹环)" },
    scavenger: { name: "拾荒机兵", icon: "⚙", hp: 875, speed: 62, dmg: 19, attacks: { projectile: [10] }, mechanics: { warn: 0.9, interval: 4.5, chargeSpeed: 270, chargeDuration: 0.45, recovery: 0.75, exitShots: 5, exitSpread: 0.24, shotSpeed: 220 }, r: 35, color: "#f1ad62", xp: 55, tier: 1, shape: "square", pattern: "nodes", shotStyle: "bolt", skill: "追击 + 预警冲刺 + 冲刺终点扇射" },
    frostwarden: { name: "霜壳守卫", icon: "❄", hp: 1035, speed: 44, dmg: 18, attacks: { projectile: [9], laser: [6] }, mechanics: { warn: 0.8, beamDuration: 0.38, follow: 0.45, interval: 3.6, flankAngle: 0.34, beamLength: 600, beamWidth: 10, centerSpeed: 195 }, r: 39, color: "#8ddfff", xp: 65, tier: 1, shape: "hex", pattern: "double_hex", shotStyle: "rune", skill: "预测锁定方位，双侧冰激光封路后补中路冰弹" },
    bloodhunter: { name: "血棘猎手", icon: "✦", hp: 900, speed: 62, dmg: 17, attacks: { projectile: [9] }, mechanics: { range: 245, swayRate: 3, swayAngle: 0.38, warn: 0.75, interval: 3.6, flankDist: 210, spread: 0.34, shotSpeed: 215 }, r: 32, color: "#ff5278", xp: 60, tier: 1, shape: "triangle", pattern: "bloodthorn", shotStyle: "bolt", skill: "锁定玩家位置，从两侧发射交汇棘弹" },
    riftsentry: { name: "裂隙哨兵", icon: "◇", hp: 990, speed: 46, dmg: 18, attacks: { projectile: [8, 9] }, mechanics: { warn: 0.8, interval: 4.0, portalDist: 180, spread: 0.30, shotSpeed: 190 }, r: 38, color: "#a58bff", xp: 65, tier: 1, shape: "diamond", pattern: "rift", shotStyle: "rune", skill: "从成对裂隙向锁定位置交叉射击" },
    thornwarden: { name: "铁棘卫士", icon: "✥", hp: 1200, speed: 48, dmg: 18, attacks: { projectile: [9] }, mechanics: { warn: 0.8, recovery: 0.65, interval: 3.5, armor: 0.25, spread: 0.38, shotSpeed: 215 }, r: 37, color: "#c47a9b", xp: 65, tier: 1, shape: "hex", pattern: "shield", shotStyle: "bolt", skill: "厚重高血量，展开护甲后预测扇射，射后短暂硬直" },
    queen: { name: "蜂后", icon: "☼", hp: 2200, speed: 30, dmg: 23, attacks: { projectile: [13, 10] }, mechanics: { summonInterval: 5, summonCount: 4, ringInterval: 2.6, ringShots: 12, ringSpeed: 170, aimedShots: 1, aimedSpread: 0.24, aimedSpeed: 225 }, r: 46, color: "#ff6ab0", xp: 100, tier: 2, shape: "hex", pattern: "honey", shotStyle: "ring", skill: "召唤蜂群 + 螺旋弹幕 + 单发预测封路弹" },
    magnetwarper: { name: "磁暴行者", icon: "⚡", hp: 1500, speed: 45, dmg: 17, attacks: { projectile: [13], shock: [11] }, mechanics: { moveMul: 0.7, pullInterval: 5.2, pullWarn: 0.75, pullDuration: 1.2, pullForce: 120, ringShots: 12, ringSpeed: 175, shockInterval: 0.9, shockRange: 115, releaseShots: 8, releaseSpeed: 230 }, r: 36, color: "#8e7bff", xp: 90, tier: 2, shape: "star", pattern: "poles", shotStyle: "rune", skill: "预警后释放引力波 + 弹环 + 贴身电击圈" },
    twins: { name: "镜像双子", icon: "◐", hp: 1050, speed: 60, dmg: 13, attacks: { projectile: [12, 13] }, mechanics: { swapInterval: 6.5, swapWarn: 0.7, ringShots: 8, ringSpeed: 180, shotInterval: 1.8, shotSpeed: 260, enragedSpeedMul: 1.5 }, r: 28, color: "#7df9ff", xp: 80, tier: 2, count: 2, shape: "triangle", pattern: "split", shotStyle: "bolt", skill: "追击 + 预警换位(杀其一,本体反噬 25% 并狂暴)" },
    stormherald: { name: "雷暴使徒", icon: "⚡", hp: 1550, speed: 52, dmg: 18, attacks: { projectile: [12] }, mechanics: { range: 260, warn: 0.7, sweep: 1.05, shotInterval: 0.14, interval: 2.4, sweepAngle: 1.35, shotSpeed: 310 }, r: 34, color: "#aaa0ff", xp: 95, tier: 2, shape: "star", pattern: "storm", shotStyle: "bolt", skill: "预判绕行方向，预警后顺势扫射电弹" },
    bloodoracle: { name: "血谕祭司", icon: "✧", hp: 1650, speed: 42, dmg: 20, attacks: { projectile: [12] }, mechanics: { ritualWarn: 0.8, ritualInterval: 6, ritualShots: 3, ritualSpread: 0.2, shotSpeed: 230, boltInterval: 2.7, boltShots: 3, boltSpread: 0.28 }, r: 38, color: "#ff718e", xp: 100, tier: 2, shape: "cross", pattern: "trident", shotStyle: "ring", skill: "召唤仪式随从，从存活随从位置发射弹幕" },
    architect: { name: "架构师", icon: "⌬", hp: 1800, speed: 55, dmg: 23, attacks: { projectile: [13, 14] }, mechanics: { ringInterval: 2.0, ringShots: 10, ringSpeed: 160, turretInterval: 9, turretMax: 3, turretSpawnDist: 320, turretMinRange: 260, turretMaxRange: 360, turretWarn: 0.75, offsetInterval: 4.0, offsetWarn: 0.85, offsetDist: 240, offsetShots: 6, offsetSpeed: 150 }, r: 44, color: "#5ad1ff", xp: 120, tier: 3, shape: "square", pattern: "nodes", shotStyle: "rune", skill: "预警双源弹环 + 召唤远距预警炮台" },
    inquisitor: { name: "审判者", icon: "✠", hp: 1650, speed: 60, dmg: 21, attacks: { projectile: [13, 14] }, mechanics: { teleportMin: 2.5, teleportMax: 3.5, teleportWarn: 0.75, teleportDist: 260, ringShots: 10, ringSpeed: 150, arrivalShots: 12, arrivalSpeed: 160, boltInterval: 1.4, boltShots: 3, boltSpread: 0.3, boltSpeed: 280 }, r: 30, color: "#b06bff", xp: 90, tier: 3, shape: "cross", pattern: "judge", shotStyle: "bolt", skill: "预警传送落点 + 新旧位置弹环 + 预测扇射" },
    colossus: { name: "弹幕巨像", icon: "◎", hp: 2700, speed: 0, dmg: 23, attacks: { projectile: [14], laser: [13] }, mechanics: { sweepInterval: 9, sweepWarn: 0.9, sweepDuration: 6, sweepSpeed: 1.5, laserLength: 600, laserWidth: 16, summonInterval: 2, idleRingInterval: 3 }, r: 50, color: "#ff6b4d", xp: 140, tier: 3, shape: "circle", pattern: "reactor", shotStyle: "ring", skill: "预警旋转扫射激光 + 召唤僵尸 + 螺旋弹幕" },
    furnace: { name: "熔炉核心", icon: "✸", hp: 2450, speed: 30, dmg: 23, attacks: { projectile: [13] }, mechanics: { ringInterval: 3.8, ringShots: 12, ringSpeed: 180, hazardInterval: 5.2, hazardCount: 2, hazardOffset: 90, hazardRadius: 68, hazardDuration: 3.5, hazardWarm: 1 }, r: 46, color: "#ff8b46", xp: 130, tier: 3, shape: "hex", pattern: "reactor", shotStyle: "ring", skill: "双区预警灼烧 + 火环弹幕" },
    voidseer: { name: "虚空观测者", icon: "◈", hp: 2100, speed: 58, dmg: 22, attacks: { projectile: [14] }, mechanics: { warn: 0.7, echoDelay: 0.48, interval: 4.0, teleportDist: 300, echoShots: 8, echoSpeed: 190, arrivalShots: 6, arrivalSpeed: 210, boltInterval: 2.0, boltShots: 3, boltSpread: 0.24, boltSpeed: 280 }, r: 36, color: "#b782ff", xp: 125, tier: 3, shape: "diamond", pattern: "seer", shotStyle: "rune", skill: "预示换位落点，新旧位置夹击弹幕" },
    eclipseeye: { name: "蚀界之眼", icon: "◉", hp: 2250, speed: 48, dmg: 23, attacks: { projectile: [14, 15] }, mechanics: { orbitSpeed: 0.8, orbitRadius: 270, warn: 0.9, secondDelay: 0.55, interval: 4.2, ringShots: 16, ringSpeed: 195, gapHalf: 0.43, boltInterval: 2.0, boltShots: 3, boltSpread: 0.28, boltSpeed: 280 }, r: 42, color: "#de6bca", xp: 130, tier: 3, shape: "circle", pattern: "eclipse", shotStyle: "rune", skill: "环绕游走，追踪扇射 + 双层缺口脉冲弹环" }
  };

  function anchored(t, points) {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        const a = points[i - 1], b = points[i], x = (t - a[0]) / (b[0] - a[0]);
        const smooth = x * x * (3 - 2 * x);
        return a[1] + (b[1] - a[1]) * smooth;
      }
    }
    return points[points.length - 1][1];
  }
  const HP_RATIO = [[0, 1.15], [5, 1.30], [9.5, 1.50], [13.5, 1.55], [15.5, 1.58], [17.5, 1.62], [18, 1.63], [19, 1.64], [20, 1.65], [25, 1.70]];
  const BOSS_HP_RATIO = [[0, 1.90], [5, 2.00], [9.5, 2.25], [13.5, 2.25], [15.5, 2.27], [17.5, 2.28], [18, 2.28], [19, 2.29], [20, 2.30], [25, 2.35]];
  const DMG_POINTS = [[0, 1.00], [4, 1.00], [5, 1.10], [9.5, 1.45], [13.5, 1.75], [15.5, 1.90], [17.5, 2.02], [18, 2.05], [19, 2.10], [20, 2.20], [25, 2.70], [30, 3.10]];

  // ── 难度曲线(t=分钟)。血量以旧版基线乘锚点倍率，伤害独立温和回升。
  const CURVES = {
    lateBlend: function (t) { const x = U.clamp((t - CONST.LATE_BALANCE_START) / (CONST.LATE_BALANCE_END - CONST.LATE_BALANCE_START), 0, 1); return x * x * (3 - 2 * x); },
    lateFactor: function (t, target) { return 1 + CURVES.lateBlend(t) * ((target == null ? 1 : target) - 1); },
    eliteChance: function (t, difficulty) { return t < 8 ? 0 : Math.min(DIFFICULTY[difficulty].eliteCap, 0.08 + 0.02 * (t - 8)); },
    spawnRate: function (t) { return 1.0 + 0.7 * Math.sqrt(t); }, // 出兵更密。t=1:1.7 t=5:2.57 t=10:3.21 t=15:3.71 t=20:4.13
    hpFactor: function (t) { return (1.2 + 0.22 * t + 0.012 * t * t + 0.0004 * t * t * t) * anchored(t, HP_RATIO); },
    bossHpFactor: function (t) { return (1 + 0.2 * t + 0.006 * t * t) * anchored(t, BOSS_HP_RATIO); },
    speedFactor: function (t) { return 1 + 0.03 * t; },
    dmgFactor: function (t) { return anchored(t, DMG_POINTS); },
    xpForLevel: function (N) { return Math.floor(3 + 2.2 * N + Math.pow(N, 1.2)); },
    // 无尽模式:通关后随(超时分钟)额外敌血/敌伤倍率
    endlessHpMul: function (overMin) { return 1 + 0.22 * overMin + 0.01 * overMin * overMin; },
    endlessDmgMul: function (overMin) { return 1 + 0.04 * overMin; },
    // 光环敌人成长(t=分钟,由 entities.tickAuras 按全局时间回写):
    wardenDr: function (t) { return Math.min(0.70, 0.40 + 0.015 * t); }, // 盾卫减伤:t=0:0.40 t=5:0.475 t=10:0.55 t=15:0.625 t=20:0.70(封顶)
    overdriveR: function (t) { return 150 + 5 * t; }, // 狂热者光环半径:t=0:150 t=5:175 t=10:200 t=15:225 t=20:250
    priestHeal: function (t) { return Math.min(6, 4 + 0.15 * t); } // 血祭司治疗率(前期弱、后期还原原版 6):t=0:4 t=5:4.75 t=10:5.5 t≈13.3 追平(封顶)
  };

  // 前 2 分钟平滑减少敌人数量；t 使用分钟。经验由同一倍率的倒数补偿。
  CURVES.earlySpawnFactor = function (t, difficulty) {
    const start = { chill: 0.85, normal: 0.80, hard: 0.70, nightmare: 0.65 }[difficulty] || 0.80;
    const x = Math.max(0, Math.min(1, t / 2));
    const smooth = x * x * (3 - 2 * x);
    return start + (1 - start) * smooth;
  };

  // 按时间返回刷怪权重表(类型 -> 权重)
  function enemyWeights(t) {
    const w = { zombie: 10 };
    if (t >= 1.5) w.runner = 4;
    if (t >= 4) { w.brute = 2; w.shooter = 2; }
    if (t >= 6) { w.spawner = 0.6; w.ghost = 0.5; }
    if (t >= 8) { w.bomber = 2; w.charger = 2; }
    if (t >= 12) { w.brute += 2; w.charger += 1; }
    return w;
  }

  // 集群波只用小怪
  const SWARM_TYPES = ["swarmer", "swarmer", "swarmer", "runner", "zombie"];

  // ── 难度 4 档：起步乘子保留，8–15min 平滑引入 lateSpawnMul/lateHpMul。
  // 精英耐久与占比、护甲上限、强敌波人数各自分档；减产后的经验/掉落在 waves.js 按实际来源补偿。
  // Boss 独立分档:血量/伤害之外,移速/弹速/攻击频率小幅递增;预警和硬直不缩短。
  const DIFFICULTY = {
    chill: { name: "轻松", lateSpawnMul: 1, lateHpMul: 0.65, eliteCap: 0.10, eliteHpMul: 2.5, wardCap: 0.40, lateBossCount: 1, burstIframe: 0.2, spawnMul: 0.95, hpMul: 0.8, dmgMul: 0.68, dropMul: 1.1, xpMul: 0.95, bossDmgMul: 1.10, bossHpMul: 0.85, bossSpeedMul: 0.95, bossShotSpeedMul: 0.92, bossTempoMul: 0.94 },
    normal: { name: "普通", lateSpawnMul: 0.95, lateHpMul: 0.82, eliteCap: 0.15, eliteHpMul: 3.25, wardCap: 0.50, lateBossCount: 2, burstIframe: 0.2, spawnMul: 1.15, hpMul: 1.0, dmgMul: 0.90, dropMul: 0.85, xpMul: 0.8, bossDmgMul: 1.27, bossHpMul: 1.08, bossSpeedMul: 1.00, bossShotSpeedMul: 1.00, bossTempoMul: 1.00 },
    hard: { name: "困难", lateSpawnMul: 0.90, lateHpMul: 0.75, eliteCap: 0.20, eliteHpMul: 3.5, wardCap: 0.55, lateBossCount: 2, burstIframe: 0.2, spawnMul: 1.3, hpMul: 1.35, dmgMul: 1.17, dropMul: 0.6, xpMul: 0.81, bossDmgMul: 1.43, bossHpMul: 1.4, bossSpeedMul: 1.05, bossShotSpeedMul: 1.08, bossTempoMul: 1.06 },
    nightmare: { name: "噩梦", lateSpawnMul: 1, lateHpMul: 1, eliteCap: 0.25, eliteHpMul: 4, wardCap: 0.70, lateBossCount: 3, burstIframe: 0.12, spawnMul: 1.5, hpMul: 1.65, dmgMul: 1.44, dropMul: 0.45, xpMul: 0.66, bossDmgMul: 1.60, bossHpMul: 1.7, bossSpeedMul: 1.10, bossShotSpeedMul: 1.16, bossTempoMul: 1.12 }
  };
  const DIFFICULTY_ORDER = ["chill", "normal", "hard", "nightmare"];

  // ── 关卡配色
  const PAL = {
    ruins: { bg0: "#070611", bg1: "#0d0a22", grid: "rgba(120,90,220,0.10)", gridStrong: "rgba(150,110,255,0.16)", star: "#cfe8ff" },
    crimson: { bg0: "#14050a", bg1: "#2a0a12", grid: "rgba(220,90,90,0.10)", gridStrong: "rgba(255,110,110,0.18)", star: "#ffd0c0" },
    frozen: { bg0: "#050f14", bg1: "#0a1f2e", grid: "rgba(90,180,220,0.10)", gridStrong: "rgba(110,220,255,0.18)", star: "#e0f5ff" },
    void: { bg0: "#040208", bg1: "#0a0618", grid: "rgba(90,60,180,0.12)", gridStrong: "rgba(140,90,255,0.20)", star: "#d0c0ff" }
  };

  // ── 各关刷怪权重(t=分钟)
  function wRuins(t) {
    const w = { zombie: 10 };
    if (t >= 1.5) w.runner = 4;
    if (t >= 4) { w.brute = 2; w.shooter = 2; }
    if (t >= 6) { w.spawner = 0.6; w.ghost = 0.5; w.blinker = 1; }
    if (t >= 7) w.warden = 1.2;
    if (t >= 8) { w.bomber = 2; w.charger = 2; w.splitter = 1; }
    if (t >= 9) w.burster = 1.5;
    if (t >= 10) { w.shielder = 1.5; w.sniper = 1; w.regen = 1; }
    if (t >= 12) { w.brute += 2; w.charger += 1; }
    return w;
  }
  function wCrimson(t) {
    const w = { zombie: 6, runner: 6 };
    if (t >= 2) w.charger = 3;
    if (t >= 3.5) w.bomber = 3;
    if (t >= 4) w.slimer = 2;
    if (t >= 5) { w.brute = 2; w.shielder = 3; }
    if (t >= 6) w.priest = 1.2;
    if (t >= 7) { w.splitter = 2; w.regen = 1; w.shooter = 1; }
    if (t >= 10) { w.charger += 2; w.bomber += 1; w.shielder += 1; }
    return w;
  }
  function wFrozen(t) {
    const w = { zombie: 8 };
    if (t >= 1.5) w.blinker = 3;
    if (t >= 3) { w.shooter = 3; w.ghost = 2; }
    if (t >= 5) w.sniper = 2;
    if (t >= 6) w.stalker = 1.5;
    if (t >= 7) { w.brute = 1; w.spawner = 0.8; w.regen = 1; }
    if (t >= 9) { w.runner = 3; w.charger = 1; w.shielder = 1; }
    return w;
  }
  function wVoid(t) {
    const w = { zombie: 8, runner: 4 };
    if (t >= 1.5) { w.blinker = 2; w.charger = 2; }
    if (t >= 3) { w.brute = 2; w.shooter = 2; w.bomber = 2; }
    if (t >= 5) { w.splitter = 2; w.shielder = 2; w.sniper = 1; w.regen = 1; w.ghost = 1; w.spawner = 0.8; }
    if (t >= 6) w.overdriver = 1.2;
    if (t >= 7) w.burster = 1.5;
    if (t >= 8) for (const k in w) w[k] *= 1.3;
    if (t >= 12) for (const k in w) w[k] *= 1.3;
    return w;
  }

  // ── 关卡(全部直接可选,无需解锁)。bosses=[[候选池,min秒]],bgm=BGM 曲目 id
  const STAGES = {
    ruins: { name: "霓虹废墟", goalMin: 20 * 60, half: 1700, palette: PAL.ruins, weights: wRuins, bosses: [[['scavenger', 'duke', 'riftsentry'], 300], [['wraith', 'stormherald', 'magnetwarper'], 570], [['furnace', 'architect', 'inquisitor'], 810]], envField: null, bgm: "ruins" },
    crimson: { name: "血色荒原", goalMin: 20 * 60, half: 1500, palette: PAL.crimson, weights: wCrimson, bosses: [[['scavenger', 'thornwarden', 'bloodhunter'], 300], [['wraith', 'queen', 'bloodoracle'], 570], [['furnace', 'colossus', 'eclipseeye'], 810]], envField: { type: "burn", interval: 12, dur: 4, r: 90, dps: 14, warm: 2 }, bgm: "crimson" },
    frozen: { name: "冰封核心", goalMin: 20 * 60, half: 1600, palette: PAL.frozen, weights: wFrozen, bosses: [[['duke', 'thornwarden', 'frostwarden'], 300], [['stormherald', 'queen', 'twins'], 570], [['architect', 'colossus', 'voidseer'], 810]], envField: { type: "freeze", interval: 15, dur: 1.5, slowF: 0.35 }, bgm: "frozen" },
    void: { name: "虚空深渊", goalMin: 20 * 60, half: 1900, palette: PAL.void, weights: wVoid, bosses: [[['riftsentry', 'bloodhunter', 'frostwarden'], 300], [['magnetwarper', 'bloodoracle', 'twins'], 570], [['inquisitor', 'eclipseeye', 'voidseer'], 810]], envField: { type: "gravity", interval: 18, dur: 1.0, pull: CONST.PLAYER_BASE_SPEED * 0.7 }, bgm: "void" }
  };
  const STAGE_ORDER = ["ruins", "crimson", "frozen", "void"];

  SV.Config = {
    CONST: CONST,
    AUTO: AUTO,
    COLORS: COLORS,
    WEAPONS: WEAPONS,
    WEAPON_EVOS: WEAPON_EVOS,
    EVOLUTIONS: EVOLUTIONS,
    FUSIONS: FUSIONS,
    weaponDef: weaponDef,
    weaponVisual: weaponVisual,
    weaponIconHTML: weaponIconHTML,
    startWeaponIds: startWeaponIds,
    validStartWeapon: validStartWeapon,
    rollStartWeapon: rollStartWeapon,
    startWeaponLabel: startWeaponLabel,
    PASSIVES: PASSIVES,
    COUNT_NOUN: COUNT_NOUN,
    STAT_LABEL: STAT_LABEL,
    ENEMIES: ENEMIES,
    BOSSES: BOSSES,
    CURVES: CURVES,
    enemyWeights: enemyWeights,
    SWARM_TYPES: SWARM_TYPES,
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    STAGES: STAGES,
    STAGE_ORDER: STAGE_ORDER,
    MENU_BGM: "menu",   // 主菜单/选角/选关 BGM:audio/menu_loop.mp3
    CHARACTERS: CHARACTERS,
    CHARACTER_ORDER: CHARACTER_ORDER
  };
})();
