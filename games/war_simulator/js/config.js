// config.js —— 配置表+常量 (从原单文件拆出; 全局命名空间 W)
(function(){
  /** 全局调参常量（纯 2D 弹珠，无击飞/z） */
  const CONST = {
    FIXED_DT: 1/60, MAX_FRAME: 0.25, MAX_STEPS: 5,        // 定步长循环
    THRUST_SCALE: 1.7,        // AI 推力倍率(大→冲锋更猛更快)
    STAND_FRICTION: 0.992,    // 站立摩擦(低→碰撞反弹滑行久，弹珠感)
    CHARGE_MULT: 2.8,         // 限速 = moveSpeed * 此值(只削碰撞超速，不削冲锋)
    ANG_FRICTION_STAND: 0.985,// 站立旋转衰减(低→旋转持续久)
    TURN_RATE: 0,             // 朝敌转向速率(=0 不刻意朝敌，靠碰撞旋转甩武器随机命中)
    COLLIDE_RESTITUTION_STAND: 0.95,  // 台球式高弹性(撞后干脆弹开，不黏)
    COLLIDE_RESTITUTION_RAG: 0.35,    // 含尸体的弹性
    COLLIDE_FRICTION: 0.85,   // 切向摩擦冲量上限(大→碰撞产生强旋转)
    INERTIA_FACTOR: 0.22,     // 转动惯量 I = 此值*m*r²(小→更易转)
    MELEE_SPIN: 5.0,          // 近战主动旋转的目标角速度(rad/s)
    SPIN_ACCEL: 4.0,          // 角速度趋向目标的加速率(碰撞减速后再加速，往复)
    WEAPON_HALF_THICKNESS: 3, // 武器棍半厚(碰撞容差+视觉宽度)
    WMASS: 0.2, WSPIN_OMEGA: 4, WSPIN_ZETA: 0.3, WSPIN_INIT: 4, WSUBSTEPS: 2, WREST: 0.4, WEAPON_CLASH: 3, WEAPON_TRANSFER: 0.3,  // 武器铰链(弹簧刚性+低阻尼；拼刀推开；弹性铰链传递比例)
    DRAG_FRICTION: 0.86, ANGULAR_FRICTION: 0.90,  // 尸体摩擦/旋转衰减
    SETTLE_TIME: 1.2, CORPSE_FADE: 3.0,
    RANGED_RETREAT_FRAC: 0.55, RANGED_RETREAT_SPEED: 0.7, RANGED_STALEMATE_TIME: 2.5,  // 远程风筝/反僵局
    PAN_SPEED: 600,
    BOUND_X: 840, BOUND_Y: 420,  // 地图边界(单位碰边界反弹)
    MAX_UNITS: 250, MAX_PROJECTILES: 400, MAX_CORPSES: 60, GRID_SIZE: 16, BUDGET_CAP: null,
    PARTICLE_G: 900,          // 命中粒子的视觉重力
  };

  /** 兵种配置表。近战 range=武器物理长度；远程 projectile 平直飞行(lifetime 决定射程)。 */
  const UNIT_TYPES = {
    tribesman: { name:'部落野人', nameEn:'Tribesman', cost:10, hp:40, attack:12, attackInterval:0.7, moveSpeed:62, range:15, mass:1.0, radius:12, kind:'melee', knockback:48, weapon:'club', accent:'#d9a066', projectile:null, special:null, desc:'廉价快速的炮灰，量大管饱。' },
    roman_swordsman: { name:'罗马剑士', nameEn:'Roman Swordsman', cost:30, hp:90, attack:22, attackInterval:0.8, moveSpeed:48, range:17, mass:1.3, radius:12, kind:'melee', knockback:68, weapon:'sword', accent:'#b8c0cc', projectile:null, special:null, desc:'均衡的核心近战，盾剑在手。' },
    spartan_spearman: { name:'斯巴达长矛兵', nameEn:'Spartan Spearman', cost:45, hp:110, attack:26, attackInterval:1.0, moveSpeed:44, range:22, mass:1.5, radius:12, kind:'melee', knockback:88, weapon:'spear', accent:'#d4af37', projectile:null, special:null, desc:'超长武器，隔友军戳刺。' },
    archer: { name:'弓箭手', nameEn:'Archer', cost:35, hp:50, attack:20, attackInterval:1.1, moveSpeed:30, range:240, mass:0.9, radius:12, kind:'ranged', knockback:28, weapon:'bow', accent:'#8b5a2b', projectile:{ speed:260, damage:20, knockback:30, lifetime:0.9, spread:0.2, kind:'arrow' }, special:null, desc:'远程平箭，风筝首选。' },
    heavy_knight: { name:'重甲骑士', nameEn:'Heavy Knight', cost:90, hp:220, attack:42, attackInterval:1.1, moveSpeed:36, range:19, mass:2.6, radius:14, kind:'melee', knockback:150, weapon:'greatsword', accent:'#dde3ec', projectile:null, special:null, desc:'重甲坦克，极难被击退。' },
    slinger: { name:'投石兵', nameEn:'Slinger', cost:25, hp:45, attack:25, attackInterval:1.3, moveSpeed:28, range:200, mass:0.9, radius:12, kind:'ranged', knockback:70, weapon:'sling', accent:'#b3b3b3', projectile:{ speed:220, damage:25, knockback:70, lifetime:0.9, spread:0.22, kind:'stone' }, special:null, helmet:true, desc:'抛掷石块，命中带强力击退。' },
    berserker: { name:'狂战士', nameEn:'Berserker', cost:40, hp:70, attack:24, attackInterval:0.5, moveSpeed:72, range:15, mass:1.0, radius:12, kind:'melee', knockback:40, weapon:'axe', accent:'#c0392b', projectile:null, special:{kind:'rage'}, helmet:false, desc:'狂化近战，血量越低移速攻速越快，玻璃大炮。' },
    mage: { name:'法师', nameEn:'Mage', cost:70, hp:45, attack:18, attackInterval:1.6, moveSpeed:26, range:220, mass:0.9, radius:12, kind:'ranged', knockback:0, weapon:'staff', accent:'#9b59b6', projectile:{ speed:200, damage:18, knockback:40, lifetime:1.1, spread:0.05, kind:'fireball', aoe:{radius:42, damage:12, kb:60} }, special:null, helmet:false, desc:'发射火球，命中爆炸范围伤害，溅射无视盾，极脆。' },
    priest: { name:'牧师', nameEn:'Priest', cost:50, hp:60, attack:8, attackInterval:1.4, moveSpeed:30, range:180, mass:0.9, radius:12, kind:'ranged', knockback:10, weapon:'staff', accent:'#f0e68c', projectile:{ speed:240, damage:8, knockback:10, lifetime:0.8, spread:0.1, kind:'holy' }, special:{kind:'heal_aura', radius:70, heal:6, interval:1.0}, helmet:false, desc:'后方治疗光环，周期性治疗附近友军；自身仅弱攻击走位。' },
    shielder: { name:'盾兵', nameEn:'Shielder', cost:60, hp:160, attack:16, attackInterval:0.9, moveSpeed:34, range:16, mass:1.8, radius:13, kind:'melee', knockback:60, weapon:'sword', accent:'#7d9bb5', projectile:null, special:{kind:'shield'}, helmet:true, desc:'举盾推进，正面减伤90%(含挡箭)，侧后与范围伤害克制。' },
    giant: { name:'巨人', nameEn:'Giant', cost:140, hp:400, attack:55, attackInterval:1.3, moveSpeed:26, range:26, mass:4.0, radius:20, kind:'melee', knockback:180, weapon:'club', accent:'#8e7355', projectile:null, special:null, helmet:false, desc:'庞然大物，高血高质高击退，一击扫飞一片，造价高昂。' },
    mounted_archer: { name:'弓骑兵', nameEn:'Mounted Archer', cost:55, hp:55, attack:16, attackInterval:0.9, moveSpeed:64, range:210, mass:1.1, radius:13, kind:'ranged', knockback:20, weapon:'bow', accent:'#d2b48c', projectile:{ speed:280, damage:16, knockback:20, lifetime:0.85, spread:0.18, kind:'arrow' }, special:null, helmet:true, desc:'骑马弓手，高机动风筝，打了就跑。' },
  };

  const TEAM_COLORS = { red:{main:'#e5484d',glow:'rgba(229,72,77,0.10)'}, blue:{main:'#4a90e2',glow:'rgba(74,144,226,0.10)'} };
  W.Config = { CONST, UNIT_TYPES, TEAM_COLORS };
})();
