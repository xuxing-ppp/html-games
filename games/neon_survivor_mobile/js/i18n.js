// i18n.js — SV.I18n: 中英文界面、数据文案与语言偏好。
(function () {
  "use strict";
  const SV = window.SV;
  let language = "en";
  let captured = false;
  const original = {};

  const UI = {
    en: {
      "meta.title": "Neon Survivor",
      "meta.description": "Survive the endless horde, collect XP, and evolve your weapons.",
      "rotate.title": "Landscape recommended", "rotate.sub": "Rotate your device for the best experience",
      "hud.pause": "Pause (P)", "hud.low": "⚠ CRITICAL HEALTH!", "level.hint": "Click a card or press 1 / 2 / 3",
      "title.logo": "Neon <span>Survivor</span>",
      "title.start": "▶ START GAME", "title.new": "＋ NEW GAME", "title.continue": "▶ CONTINUE GAME", "title.exit": "× EXIT GAME", "title.best": "BEST:", "title.move": "Move: WASD / Arrow Keys / Joystick",
      "title.pause": "Pause: P", "title.mute": "Mute: M", "title.auto": "Auto: O",
      "settings.music": "🎵 Music", "settings.sfx": "🔊 SFX", "settings.language": "Language",
      "char.title": "SELECT CHARACTER & DIFFICULTY", "char.difficulty": "Difficulty",
      "char.hint": "Tap an icon for details · Character themes only restrict starting weapons",
      "char.next": "▶ NEXT: SELECT WEAPON", "char.back": "◀ BACK TO STAGES",
      "weapon.title": "NEON ARMORY TERMINAL", "weapon.start": "▶ START GAME", "weapon.back": "◀ BACK TO CHARACTERS",
      "stage.title": "SELECT STAGE", "stage.hint": "Choose a stage, then press Continue",
      "common.continue": "▶ CONTINUE", "common.title": "⌂ BACK TO TITLE",
      "endless.title": "🎉 STAGE CLEARED!", "endless.desc": "Enter Endless Mode? Enemies keep growing stronger and Boss waves return periodically.",
      "endless.yes": "∞ ENTER ENDLESS MODE", "endless.no": "✓ END RUN",
      "pause.title": "PAUSED", "pause.resume": "▶ RESUME", "pause.restart": "↻ RESTART", "pause.saveExit": "▣ SAVE & EXIT",
      "restart.confirmTitle": "RESTART THIS RUN?", "restart.confirmText": "Current progress will be lost. This cannot be undone.",
      "restart.confirm": "↻ RESTART RUN", "restart.cancel": "KEEP PLAYING",
      "save.confirmTitle": "OVERWRITE SAVED RUN?", "save.confirmText": "Starting a new game will delete the current saved run.",
      "save.confirmNew": "＋ START NEW GAME", "save.cancel": "CANCEL",
      "exit.title": "GAME EXITED", "exit.message": "You can now close this browser tab.",
      "gameover.dead": "YOU HAVE FALLEN", "gameover.newbest": "★ NEW RECORD! ★",
      "gameover.time": "SURVIVAL TIME", "gameover.level": "LEVEL", "gameover.kills": "KILLS", "gameover.evos": "EVOLUTIONS",
      "gameover.best": "PERSONAL BEST:", "gameover.again": "↻ PLAY AGAIN"
    },
    "zh-CN": {
      "meta.title": "霓虹幸存者 · Neon Survivor",
      "meta.description": "在潮水般的敌人中存活，收集经验，进化你的武器。",
      "rotate.title": "建议横屏游玩", "rotate.sub": "旋转设备以获得最佳体验",
      "hud.pause": "暂停 (P)", "hud.low": "⚠ 生命危急!", "level.hint": "点击卡片 或 按 1 / 2 / 3",
      "title.logo": "霓虹<span>幸存者</span>",
      "title.start": "▶ 开始游戏", "title.new": "＋ 新游戏", "title.continue": "▶ 继续游戏", "title.exit": "× 退出游戏", "title.best": "最佳记录:", "title.move": "移动:WASD / 方向键 / 摇杆",
      "title.pause": "暂停:P", "title.mute": "静音:M", "title.auto": "全自动:O",
      "settings.music": "🎵 音乐", "settings.sfx": "🔊 音效", "settings.language": "语言",
      "char.title": "选择角色与难度", "char.difficulty": "难度",
      "char.hint": "点击图标查看角色详情 · 角色主题只限制起手武器",
      "char.next": "▶ 下一步：选择武器", "char.back": "◀ 返回选关",
      "weapon.title": "霓虹军械终端", "weapon.start": "▶ 开始游戏", "weapon.back": "◀ 返回选角",
      "stage.title": "选择关卡", "stage.hint": "选择关卡后点击「继续」",
      "common.continue": "▶ 继续", "common.title": "⌂ 返回标题",
      "endless.title": "🎉 通关胜利!", "endless.desc": "进入无尽模式?敌人将不断变强,且每隔一段时间会有 Boss 波来袭。",
      "endless.yes": "∞ 进入无尽模式", "endless.no": "✓ 结束本局",
      "pause.title": "已暂停", "pause.resume": "▶ 继续", "pause.restart": "↻ 重新开始", "pause.saveExit": "▣ 保存并退出",
      "restart.confirmTitle": "重新开始本局？", "restart.confirmText": "当前局内进度将全部丢失，且无法恢复。",
      "restart.confirm": "↻ 确认重新开始", "restart.cancel": "返回暂停界面",
      "save.confirmTitle": "覆盖当前存档？", "save.confirmText": "开始新游戏将删除当前保存的进度。",
      "save.confirmNew": "＋ 开始新游戏", "save.cancel": "取消",
      "exit.title": "已退出游戏", "exit.message": "现在可以关闭此浏览器页面。",
      "gameover.dead": "你倒下了", "gameover.newbest": "★ 新纪录!★",
      "gameover.time": "存活时间", "gameover.level": "等级", "gameover.kills": "击杀", "gameover.evos": "进化",
      "gameover.best": "历史最佳:", "gameover.again": "↻ 再来一局"
    }
  };

  const EN = {
    weapons: {
      blade:["Orbiting Blades","Blades orbit you and damage enemies on contact."], missile:["Homing Missile","Prefer visible enemies when launching homing missiles."], chain:["Chain Lightning","Shock the nearest enemy and arc to nearby targets."], aura:["Plasma Aura","A damage field that periodically scorches nearby enemies."], shotgun:["Scattershot","Fire a cone of pellets toward the nearest enemy."], frost:["Frost Nova","Periodic frost blasts slow enemies in range."], lance:["Orbit Laser","A high-energy laser circles you and damages each enemy once per contact."], boomerang:["Neon Boomerang","Throw an auto-aimed boomerang that damages outbound and returning."], grenade:["Grenade Launcher","Lob a grenade at the nearest enemy for area damage."], railgun:["Railgun","Charge and fire a devastating round through every enemy in its path."], poison:["Toxic Cloud","Poison nearby enemies for damage over time."], vortex:["Vortex","Summon a roaming tornado that pulls and shreds nearby enemies."], sentry:["Sentry Turret","Deploy orbiting turrets that automatically fire at nearby enemies."], meteor:["Meteor","Call a delayed meteor strike on the densest nearby enemy cluster."], shockwave:["Shockwave","Swing a shockwave cone at the nearest enemy, damaging and knocking back targets."], hex:["Hex","Prefer visible high-HP enemies when marking, prioritizing Bosses, then detonate for flat and max-HP damage. The hex spreads if its target dies early."], crescent:["Crescent Slash","Sweep a broad crescent blade through enemies near the closest target."], detonate:["Detonating Blow","Slashes can detonate enemies, dealing area damage around them."], spear:["Piercing Spear","Thrust a narrow spear through every enemy in its path for high focused damage."], polymorph:["Polymorph","Homing shots turn enemies into harmless wandering sheep that take extra damage."], timestop:["Time-Stop Field","Drop delayed fields on dense groups, freezing movement and attacks while contact damage remains."]
    },
    evolutions: {
      blade:["Wheel of Death","Eight blades, +50% orbit radius, and relentless close-range cutting."], missile:["Nova Warhead","A piercing warhead that hunts new targets after kills without losing damage."], chain:["Tesla Storm","Arc eight times, gaining damage with every jump."], aura:["Black-Hole Aura","Pull enemies inward and deal damage every 0.24 seconds."], frost:["Absolute Zero","Every third hit freezes a target for 0.6s and makes it take +50% damage."], boomerang:["Storm Shuriken","Throw five piercing shuriken in a fan."], shotgun:["Twin-Barrel Eradicator","Double the pellets, widen the cone, and pierce once."], lance:["Split Laser","Two slower counter-facing lasers repeatedly damage enemies along their beams."], grenade:["Cluster Bomb","Each blast triggers an extra nearby explosion."], railgun:["Explosive Penetrator","Aims along the most crowded line; every pierced target explodes."], poison:["Virulent Plague","Poison spreads to nearby enemies, slows them, and deals more damage."], vortex:["Eye of the Storm","Summon two stronger vortexes that leave damaging fields."], sentry:["Firepower Bastion","More turrets, faster fire, and piercing rounds."], meteor:["Starfall","Drop more, larger meteors that leave scorching ground."], shockwave:["Resonant Impact","More waves, stronger knockback, and freezing hits."], hex:["Plague of Judgment","Mark more targets, spread farther, and detonate sooner."], crescent:["Full-Moon Slash","More and wider arcs leave damaging crescent trails."], detonate:["Chain Detonation","Larger guaranteed explosions chain into nearby enemies."], spear:["Armor-Piercing Thrust","Thrust every 0.8s with +30% reach and apply 1.5s armor break for +50% incoming damage."], polymorph:["Piercing Polymorph","More shots, moderately longer transformation, and one extra target pierced per shot."], timestop:["Absolute Stasis","More and larger fields shatter frozen enemies for bonus damage."]
    },
    fusions: {
      blade_aura:["Annihilation Wheel","Splashing blades pull clustered enemies into a close-range maelstrom."], missile_chain:["Thunder Swarm","Splitting homing missiles trigger chain lightning on impact."], railgun_grenade:["Orbital Bombardment","Every penetration explodes; the first also splits into two nearby blasts."], frost_poison:["Frost Plague","Poisoning frost slows enemies and freezes each target every third hit."], boomerang_sentry:["Stormwatch","Five sentries fire piercing boomerangs in unison."], lance_vortex:["Riftstorm","Twin lasers rotate around enemy-pulling vortexes."], shotgun_grenade:["Burstshot","Every pellet in the cone blooms into splash damage."], meteor_chain:["Thunderfall Judgment","Meteor impacts arc lightning across entire crowds."], shockwave_frost:["Shatter Resonance","Shockwaves freeze enemies and shatter already-frozen targets."], hex_poison:["Blight Cataclysm","Hexes carry poison and spread the plague when detonated."], crescent_detonate:["Blood-Moon Guillotine","Massive slashes guarantee chained explosions."], polymorph_timestop:["Temporal Curse","Sheep explode into a freezing time blast when the effect ends or they die."], spear_lance:["Star-Piercing Lance","Each thrust builds crosswise laser grids along its path."], blade_boomerang:["Returning Star Ring","Eight orbiting blades take turns hunting enemies before returning to their open slots."], blade_frost:["Glacial Blade Array","Every third blade hit triggers a freezing burst."], missile_aura:["Plasma-Core Swarm","Four missiles split up and attach short-lived damaging plasma cores on impact."], missile_railgun:["Guided Sky-Spear","Calibrate on target, then become a high-speed infinite penetrator."], chain_sentry:["Thunderweb Bastion","Turrets fire bouncing bolts to weave a divided lightning web."], aura_poison:["Corrosive Singularity","Enemies trapped in the black hole accumulate deeper corrosion."], shotgun_shockwave:["Resonance Barrage","Repeated pellet hits build resonance and burst from within targets."], shotgun_spear:["Formation Breaker","Each spear penetration sprays more forward fragments."], boomerang_crescent:["Returning Moonblade","A broad moonblade sweeps once outbound and once on return."], grenade_meteor:["Skyfire Carrier","The carrier blast marks repeated small-meteor strikes."], railgun_timestop:["Zero-Hour Rail","A piercing beam freezes its entire path into a stasis corridor."], vortex_meteor:["Inferno Eye","A moving fire tornado drags enemies through scorched ground."], vortex_detonate:["Collapse Core","The more enemies it captures, the stronger its final explosion."], sentry_hex:["Judgment Array","Focused turret fire marks targets for judgment on the fifth hit."], shockwave_polymorph:["Stampede Impact","Shockwaves turn enemies into sheep and launch them into explosive collisions."], hex_crescent:["Eclipsed Brand","Crescents apply hexes that slash onward when detonated."], detonate_polymorph:["Explosive Flock","Transformed enemies become wandering timed bombs."], spear_timestop:["Rift Spear","A delayed replay follows the spear path with a freezing strike."], lance_chain:["Thunder Rail","Rotating lasers throw lightning outward from every target hit."]
    },
    passives: {
      maxhp:["Vitality","Max HP +28","+28 max HP/level"], speed:["Haste","Move speed +9%","+9%/level"], damage:["Power","All weapon damage +11%","+11%/level"], cooldown:["Cooldown","Weapon cooldown -7.5%","-7.5%/level (cap -70%)"], area:["Amplify","Weapon area +11%","+11%/level"], armor:["Iron Armor","Damage taken -9.5%","-9.5%/level (cap -60%)"], regen:["Regeneration","Recover 2 HP per second","+2 HP/s/level"], magnet:["Magnetic Aura","Pickup range +45%, XP +9%","+45%/+9% per level"], luck:["Luck","Rare upgrades and special drops appear 17% more often","+17%/level"], crit:["Critical Strike","+9% critical chance; critical hits deal 2× damage","+9%/level (cap 100%)"], lifesteal:["Life Steal","Convert 0.9% of damage to HP, capped per second at the current rate","Starts +0.9% (attribute cap 7.5%)"]
    },
    characters: {
      bulwark:["Bulwark","Heavy Vanguard","HP ×1.2, speed ×0.96; melee starts only, with extra stationary defense and periodic knockback.",["Every 2.5s while stationary","A zero-damage knockback wave with radius 95","Melee starts only; Area increases radius and Cooldown shortens the interval"]],
      arcanist:["Starcaller","Arcanist","HP ×0.85, pickup ×0.75; spell damage +20% and area +10%.",["With spell weapons","Damage +20%, area +10%","Spell starts only; all weapons remain available during the run"]],
      ranger:["Gleam","Skirmisher","HP ×0.85, speed ×1.12, pickup ×0.8; ranged specialist with Cooldown level 1.",["With ranged weapons","Damage +15%, attack interval ×0.9","Ranged starts only; all weapons remain available during the run"]],
      assassin:["Nightblade","Shadow Assassin","HP ×0.95, speed ×1.08; excels at finishing weakened targets but starts with mildly reduced damage.",["Based on target's current HP",">70% HP: damage ×0.9; <30% HP: final damage ×2","Power, critical strikes, and life steal apply normally"]],
      collector:["Magnet Core","Pickup Resonance","Pickup ×1.15, speed ×0.98; XP charges six orbiting magnetic crystals.",["Gain 1 crystal per 13 actual XP; fire at 6","Each deals 10 + 0.9× effective level in radius 28","Power, crit, life steal, and area apply; bonus XP charges faster","Magnetic Crystal Volley"]],
      berserker:["Bloodrage","Berserker","Damage and toughness rise near death, but all healing is reduced to ×0.65.",["Scales linearly with missing HP","Damage ranges from ×0.95 at full HP to ×2 near zero; up to 40% extra reduction","Regeneration, life steal, and medkits heal at ×0.65"]],
      lingerer:["Lingerer","Temporal Stasis","Speed ×0.96, pickup ×0.95; periodically distorts enemy time.",["Every 9s for 2s","Normal enemies and timers ×0.35; Bosses and projectiles ×0.7","Cooldown shortens the interval at 50% efficiency"]],
      overclocker:["Overclocker","Overload Core","HP ×0.95; periodically enters a high-output, high-risk overload.",["Every 8s for 2.5s","Weapon damage ×1.2, attack frequency ×1.2, damage taken ×1.15","Affects cooldowns, auras, turrets, continuous hits, and fusions; not DoT or control"]],
      phantom:["Phantom Step","Afterimage Dancer","HP ×0.95, speed ×1.1; high-speed movement plants delayed explosive afterimages.",["Every 180px moved; erupts after 0.45s","Damage 14 + 0.7× true level, radius 70, up to 4","Power, crit, life steal, and area apply; speed raises trigger frequency","Afterimage Burst"]],
      allrounder:["All-Rounder","Balanced Edge","Start with every passive at level 1 for flexible growth and any build.",["No extra mechanic","Every passive starts at level 1","All 21 base weapons are available as starting weapons"]]
    },
    enemies: {
      zombie:["Rotwalker","Moves straight toward the player"], runner:["Bladebug","Fast weaving pursuit"], brute:["Heavy Trooper","Slow armored advance with high HP"], shooter:["Gunner","Keeps mid-range, stops to charge, then fires; low contact damage"], bomber:["Bombbug","Charges the player and explodes at close range"], swarmer:["Brain Spider","Swarms rapidly in groups"], spawner:["Brood Nest","Stationary; continually spawns Brain Spiders"], charger:["Ravager","Telegraphs, then charges at high speed"], ghost:["Will-o'-Wisp","Roaming high-value target; does not attack"], blinker:["Blinker","Periodically teleports into close range"], splitter:["Splitter","Splits into two Brain Spiders on death"], shielder:["Shield Trooper","55% armor; late total reduction cap depends on difficulty"], sniper:["Sniper","Stops to charge before firing a precise long-range shot"], regen:["Regenerator","Continuously restores HP"], warden:["Aura Warden","Shields nearby enemies; late reduction and combined armor cap depend on difficulty"], priest:["Blood Priest","Heals nearby non-priest enemies; overlapping priests use only the strongest healing rate"], overdriver:["Zealot","Speeds nearby enemies; aura grows over time"], burster:["Burst Nest","Releases a swarm of Brain Spiders on death"], stalker:["Stalker","Approaches cloaked and ambushes at close range"], slimer:["Blight Slime","Weaves after the player and leaves a toxic trail"]
    },
    bosses: {
      duke:["Bloated Duke","Summons Rotwalkers + radial barrages with a predictive seam shot"], wraith:["Twin Wraiths","Orbit + measured predictive fans; the survivor enrages and periodically releases a six-way ring"], queen:["Brood Queen","Summons swarms + spiral barrages with one predictive seam shot"], magnetwarper:["Magnet Warper","Warned gravity waves pull inward + release barrages + close-range shocks"], twins:["Mirror Twins","Pursue, fire predictive volleys, and visibly warn before swapping"], architect:["The Architect","Warned flanking rings + summoned long-range warning turrets"], inquisitor:["Inquisitor","Warns its teleport destination before old/new-position barrages"], colossus:["Bullet Colossus","Warned rotating lasers + summons + spiral barrages"],
      scavenger:["Scavenger Automaton","Predictive telegraphed charges followed by a high-speed fan volley"], frostwarden:["Frost Warden","Predicts your path, seals both flanks with warned ice lasers, then fires down the center"], bloodhunter:["Bloodthorn Hunter","Marks your position, then fires converging thorn bolts from both flanks"], riftsentry:["Rift Sentry","Opens paired rifts and crossfires from both sides"], thornwarden:["Ironthorn Warden","Armors up and predicts a fan volley, then briefly recovers"], stormherald:["Storm Herald","Warns and sweeps electric bolts along your circling direction"], bloodoracle:["Blood Oracle","Summons ritual followers and fires predictive volleys"], furnace:["Furnace Core","Twin warned burn zones + fiery spiral barrages"], voidseer:["Void Seer","Marks a teleport destination and crossfires from its old and new positions"], eclipseeye:["Eclipse Eye","Orbits with aimed volleys + two pulse rings with a safe gap"]
    },
    difficulty:{chill:"Chill",normal:"Normal",hard:"Hard",nightmare:"Nightmare"},
    stages:{ruins:"Neon Ruins",crimson:"Crimson Wastes",frozen:"Frozen Core",void:"Void Abyss"}
  };

  const COUNT_EN = { blade:"blades",missile:"missiles",shotgun:"pellets",boomerang:"boomerangs",sentry:"turrets",grenade:"grenades",meteor:"meteors",shockwave:"waves",hex:"marks",crescent:"crescents",vortex:"vortexes",detonate:"detonations",polymorph:"bolts",polymorph_timestop:"bolts",timestop:"fields",blade_boomerang:"blades",blade_frost:"blades",missile_aura:"missiles",missile_railgun:"sky-spears",chain_sentry:"turrets",shotgun_shockwave:"pellets",shockwave_frost:"waves",boomerang_crescent:"moonblades",grenade_meteor:"carriers",vortex_meteor:"vortexes",vortex_detonate:"vortexes",sentry_hex:"turrets",shockwave_polymorph:"waves",hex_crescent:"crescents",detonate_polymorph:"bolts" };
  const STAT_EN = { count:"count",damage:"Damage +{N}",cooldown:"Cooldown ↓{N}s",radius:"Area +{N}",chains:"Chains +{N}",length:"Length +{N}",width:"Width +{N}",speed:"Speed +{N}",chase:"Pursuits +{N}",slow:"Slow +{N}%",slowDur:"Slow duration +{N}s",tick:"Frequency ↑",dot:"Poison +{N}",dotDur:"Poison duration +{N}s",pull:"Pull +{N}",expand:"Expansion +{N}",fireCd:"Fire rate ↑",projSpeed:"Projectile speed +{N}",knock:"Knockback +{N}",burn:"Burn +{N}",frac:"% HP +{N}%",spread:"Spread +{N}",spin:"Spin +{N}",life:"Lifetime +{N}s" };

  function cloneFields(obj, fields) {
    const out = {};
    for (const id in obj) { out[id] = {}; for (let i=0;i<fields.length;i++) if (obj[id] && obj[id][fields[i]] != null) out[id][fields[i]] = obj[id][fields[i]]; }
    return out;
  }
  function capture() {
    if (captured) return;
    const C = SV.Config;
    original.weapons=cloneFields(C.WEAPONS,["name","desc"]); original.evolutions=cloneFields(C.EVOLUTIONS,["name","desc"]);
    original.weaponEvos=cloneFields(C.WEAPON_EVOS,["name","desc"]); original.passives=cloneFields(C.PASSIVES,["name","desc","per"]);
    original.characters=cloneFields(C.CHARACTERS,["name","title","desc"]); original.enemies=cloneFields(C.ENEMIES,["name","skill"]);
    original.bosses=cloneFields(C.BOSSES,["name","skill"]); original.difficulty=cloneFields(C.DIFFICULTY,["name"]); original.stages=cloneFields(C.STAGES,["name"]);
    original.fusions={}; for(let i=0;i<C.FUSIONS.length;i++) original.fusions[C.FUSIONS[i].to]={name:C.FUSIONS[i].name,desc:C.FUSIONS[i].desc};
    original.abilities={}; for(const id in C.CHARACTERS){const a=C.CHARACTERS[id].ability;if(a) original.abilities[id]={trigger:a.trigger,base:a.base,links:a.links,damageName:a.damageName};}
    original.count=Object.assign({},C.COUNT_NOUN); original.stat=Object.assign({},C.STAT_LABEL); captured=true;
  }
  function assign(obj, vals) { if(!obj||!vals)return; for(const k in vals) if(vals[k]!=null)obj[k]=vals[k]; }
  function applyConfig(lang) {
    capture(); const C=SV.Config, zh=lang==="zh-CN";
    for(const id in C.WEAPONS) assign(C.WEAPONS[id],zh?original.weapons[id]:{name:EN.weapons[id][0],desc:EN.weapons[id][1]});
    for(const id in C.EVOLUTIONS) assign(C.EVOLUTIONS[id],zh?original.evolutions[id]:{name:EN.evolutions[id][0],desc:EN.evolutions[id][1]});
    for(const id in C.WEAPON_EVOS){const base=id.replace(/_evo$/,""), fu=EN.fusions[id], ev=EN.evolutions[base], src=fu||ev||EN.weapons[base];assign(C.WEAPON_EVOS[id],zh?original.weaponEvos[id]:{name:src?src[0]:C.WEAPON_EVOS[id].name,desc:src?src[1]:C.WEAPON_EVOS[id].desc});}
    for(const id in C.PASSIVES){const v=EN.passives[id];assign(C.PASSIVES[id],zh?original.passives[id]:{name:v[0],desc:v[1],per:v[2]});}
    for(const id in C.CHARACTERS){const v=EN.characters[id];assign(C.CHARACTERS[id],zh?original.characters[id]:{name:v[0],title:v[1],desc:v[2]});const a=C.CHARACTERS[id].ability;if(a){const av=zh?original.abilities[id]:v[3];assign(a,zh?av:{trigger:av[0],base:av[1],links:av[2],damageName:av[3]});}}
    for(const id in C.ENEMIES){const v=EN.enemies[id];assign(C.ENEMIES[id],zh?original.enemies[id]:{name:v[0],skill:v[1]});}
    for(const id in C.BOSSES){const v=EN.bosses[id];assign(C.BOSSES[id],zh?original.bosses[id]:{name:v[0],skill:v[1]});}
    for(const id in C.DIFFICULTY) C.DIFFICULTY[id].name=zh?original.difficulty[id].name:EN.difficulty[id];
    for(const id in C.STAGES) C.STAGES[id].name=zh?original.stages[id].name:EN.stages[id];
    for(let i=0;i<C.FUSIONS.length;i++){const f=C.FUSIONS[i],v=zh?original.fusions[f.to]:EN.fusions[f.to];assign(f,zh?v:{name:v[0],desc:v[1]});}
    assign(C.COUNT_NOUN,zh?original.count:COUNT_EN); assign(C.STAT_LABEL,zh?original.stat:STAT_EN);
  }
  function format(str, params) { return String(str).replace(/\{(\w+)\}/g,function(_,k){return params&&params[k]!=null?params[k]:"";}); }
  function t(key, params) { const table=UI[language]||UI.en; return format(table[key]!=null?table[key]:(UI.en[key]!=null?UI.en[key]:key),params); }
  function pick(en, zh) { return language==="zh-CN"?zh:en; }
  function applyDocument() {
    document.documentElement.lang=language;
    document.title=t("meta.title");
    const desc=document.querySelector&&document.querySelector('meta[name="description"]'); if(desc) desc.setAttribute("content",t("meta.description"));
    const apple=document.querySelector&&document.querySelector('meta[name="apple-mobile-web-app-title"]'); if(apple) apple.setAttribute("content",t("meta.title"));
    const nodes=document.querySelectorAll?document.querySelectorAll("[data-i18n]"):[];
    for(let i=0;i<nodes.length;i++) nodes[i].textContent=t(nodes[i].getAttribute("data-i18n"));
    const html=document.querySelectorAll?document.querySelectorAll("[data-i18n-html]"):[];
    for(let i=0;i<html.length;i++) html[i].innerHTML=t(html[i].getAttribute("data-i18n-html"));
    const titles=document.querySelectorAll?document.querySelectorAll("[data-i18n-title]"):[];
    for(let i=0;i<titles.length;i++) titles[i].setAttribute("title",t(titles[i].getAttribute("data-i18n-title")));
    const aria=document.querySelectorAll?document.querySelectorAll("[data-i18n-aria]"):[];
    for(let i=0;i<aria.length;i++) aria[i].setAttribute("aria-label",t(aria[i].getAttribute("data-i18n-aria")));
    const langs=document.querySelectorAll?document.querySelectorAll("[data-lang]"):[];
    for(let i=0;i<langs.length;i++) { const active=langs[i].getAttribute("data-lang")===language; langs[i].classList.toggle("active",active); langs[i].setAttribute("aria-pressed",active?"true":"false"); }
  }
  function setLanguage(next, persist) {
    language=next==="zh-CN"?"zh-CN":"en"; applyConfig(language); applyDocument();
    if(persist!==false&&SV.Storage&&SV.Storage.set) {
      SV.Storage.set("language",language);
      if(SV.Storage.flushNow) SV.Storage.flushNow();
    }
    return language;
  }
  function init(){const saved=SV.Storage&&SV.Storage.get?SV.Storage.get("language"):"en";return setLanguage(saved,false);}
  SV.I18n={init:init,getLanguage:function(){return language;},setLanguage:setLanguage,t:t,pick:pick,applyDocument:applyDocument};
})();
