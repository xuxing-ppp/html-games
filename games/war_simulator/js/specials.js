// specials.js —— 特殊能力 (从 ai.js 钩子调用；全局命名空间 W)
(function(){
  const CFG = W.Config.UNIT_TYPES;

  /** 牧师：周期治疗光环。t 未使用(光环无目标)，u.healCd 懒初始化。 */
  function heal_aura(u, t, dt){
    const s = CFG[u.typeId].special;
    if (u.healCd === undefined) u.healCd = 0;
    u.healCd -= dt;
    if (u.healCd > 0) return;
    u.healCd = s.interval;
    const R = s.radius, R2 = R*R, H = s.heal, units = W.Game.state.units;
    for (let i=0;i<units.length;i++){
      const a = units[i];
      if (!a.alive || a.team !== u.team || a === u || a.hp >= a.maxHp) continue;
      const dx=a.pos.x-u.pos.x, dy=a.pos.y-u.pos.y;
      if (dx*dx+dy*dy <= R2) W.Physics.heal(a, H);
    }
  }

  /** 狂战士：血越低移速/攻击越高(被动)。rage 覆盖 u.moveSpeed(由 ai 读) + u.attackMult(由 weaponCollide 读)。 */
  function rage(u, t, dt){
    const r = W.Util.clamp(1 - u.hp/u.maxHp, 0, 1);   // 0满血 .. 1空血
    const cfg = CFG[u.typeId];
    u.moveSpeed  = cfg.moveSpeed * (1 + r*0.6);        // 至多 ×1.6
    u.attackMult = 1 + r*0.5;                           // 至多 ×1.5
  }

  W.Specials = { heal_aura, rage };
})();
