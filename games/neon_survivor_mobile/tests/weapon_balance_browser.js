const { chromium, chromiumExecutable, indexURL } = require('./browser_helper');
(async () => {
  const browser = await chromium.launch({ executablePath: chromiumExecutable() });
  const page = await browser.newPage({ viewport: { width: 1180, height: 700 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(indexURL);
  const result = await page.evaluate(() => {
    const ids = ['blade', 'railgun', 'frost', 'poison_evo', 'aura_evo', 'frost_poison',
      'blade_boomerang', 'missile_aura', 'railgun_timestop',
      'shotgun_spear', 'aura_poison', 'grenade_meteor', 'hex_poison', 'sentry_hex'];
    const result = {};
    for (const id of ids) {
      const s = SV.Game.state;
      SV.Weapons.init(s, id);
      s.weapons[0].level = 8;
      s.weaponDamage = {}; s.weaponActive = {};
      s.time = (id.endsWith('_evo') ? 14 : SV.Config.WEAPONS[id] ? 10 : 18) * 60;
      s.player.x = 0; s.player.y = 0;
      s.enemies = [];
      for (let i = 0; i < 30; i++) {
        const a = i * Math.PI * 2 / 30, r = 50 + (i % 5) * 37;
        const e = SV.Entities.makeEnemy(s, 'brute', Math.cos(a) * r, Math.sin(a) * r);
        e.hp = 1e9; e.speed = 0; e.dmg = 0; e.regenRate = 0;
        s.enemies.push(e);
      }
      let start = performance.now();
      let peak = 0;
      for (let i = 0; i < 600; i++) {
        SV.Entities.rebuildGrid(s);
        SV.Weapons.updateAll(s, 1 / 60);
        SV.Entities.updateEnemies(s, 1 / 60);
        peak = Math.max(peak, SV.Weapons.proj.list.length);
      }
      SV.Renderer.render(s);
      const canvas = document.getElementById('game');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      result[id] = { damage: s.weaponDamage[SV.Entities.tid(id)] || 0,
        ms: performance.now() - start, peak,
        visual: pixels.some((v, i) => i % 4 !== 3 && v > 80) };
    }
    // 轨道炮应忽略右侧最近单敌，改向上贯穿三敌。
    const s = SV.Game.state; SV.Weapons.init(s, 'railgun'); s.weapons[0].level = 8;
    s.player.x = 0; s.player.y = 0; s.player.facing = 0; s.enemies = [];
    for (const pos of [[50,0],[0,120],[0,180],[0,240]]) { const e=SV.Entities.makeEnemy(s,'brute',pos[0],pos[1]);e.hp=1e6;e.speed=0;e.dmg=0;s.enemies.push(e); }
    SV.Entities.rebuildGrid(s); SV.Weapons.updateAll(s, 1/60);
    const rail = SV.Weapons.proj.list[0];
    const railBestLine = !!rail && Math.abs(rail.vx) < Math.abs(rail.vy) * 0.1;
    // 冰霜瘟疫第三击才冻结。
    SV.Weapons.init(s, 'frost_poison'); s.weapons[0].level=8;s.enemies=[];
    const plague=SV.Entities.makeEnemy(s,'brute',40,0);plague.hp=1e6;plague.speed=0;plague.dmg=0;s.enemies.push(plague);
    const plagueFrozen=[];for(let i=0;i<3;i++){s.weapons[0].cd=0;SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.01);plagueFrozen.push(plague.frozen>0);}
    // 回旋星环保留八刃，且真实离阵不超过两枚。
    SV.Weapons.init(s,'blade_boomerang');s.enemies=[];const ringFoe=SV.Entities.makeEnemy(s,'brute',240,0);ringFoe.hp=1e6;ringFoe.speed=0;ringFoe.dmg=0;s.enemies.push(ringFoe);
    for(let i=0;i<60;i++){SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);}const ringRuntimeCount=s.player.blades.length,away=s.player.blades.filter(b=>b.mode!=="orbit").length;
    // 电浆导弹命中后转为附着核，不再携带引力场。
    SV.Weapons.init(s,'missile_aura');s.enemies=[];const coreFoe=SV.Entities.makeEnemy(s,'brute',35,0);coreFoe.hp=1e6;coreFoe.speed=0;coreFoe.dmg=0;s.enemies.push(coreFoe);
    for(let i=0;i<20;i++){SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,.02);}const attached=SV.Weapons.proj.list.filter(p=>p.plasmaCore);
    // 配置半径内缺血时吸引，满血或圈外不吸引；不锁定旧版 140px 常数。
    const healthR=SV.Config.CONST.HEALTH_PULL_RADIUS,inside=healthR-10,outside=healthR+10;
    s.pickups=[SV.Entities.makePickup(inside,0,'health')];s.player.x=0;s.player.y=0;s.player.hp=s.player.maxHp-10;SV.Entities.updatePlayer(s,.02);const pulledX=s.pickups[0].x;
    s.pickups=[SV.Entities.makePickup(inside,0,'health')];s.player.hp=s.player.maxHp;SV.Entities.updatePlayer(s,.02);const fullX=s.pickups[0].x;
    s.pickups=[SV.Entities.makePickup(outside,0,'health')];s.player.hp=s.player.maxHp-10;SV.Entities.updatePlayer(s,.02);const outsideX=s.pickups[0].x;
    result._mechanics = {
      railBestLine,
      plagueThird: !plagueFrozen[0] && !plagueFrozen[1] && plagueFrozen[2],
      ringRuntime: ringRuntimeCount === 8 && away > 0 && away <= 2,
      plasmaAttached: attached.length > 0 && attached.every(p=>!p.fieldR),
      healthPull: pulledX < inside && fullX === inside && outsideX === outside,
      healthRadius: SV.Config.CONST.HEALTH_PULL_RADIUS,
      plagueHits: SV.Config.WEAPON_EVOS.frost_poison.stats(8).freezeHits,
      ringCount: SV.Config.WEAPON_EVOS.blade_boomerang.stats(8).count,
      core: SV.Config.WEAPON_EVOS.missile_aura.stats(8),
      corridor: SV.Config.WEAPON_EVOS.railgun_timestop.stats(8).corridorWidth,
      overclock: SV.Config.CHARACTERS.overclocker.mechanics,
      shockCounts: [SV.Config.WEAPONS.shockwave.stats(5).count,SV.Config.WEAPONS.shockwave.stats(6).count],
      hexSpread: [SV.Config.WEAPONS.hex.stats(1).spread,SV.Config.WEAPONS.hex.stats(8).spread,SV.Config.WEAPON_EVOS.hex_crescent.stats(8).spread],
      polymorphDur: [SV.Config.WEAPONS.polymorph.stats(1).dur,SV.Config.WEAPONS.polymorph.stats(8).dur,SV.Config.WEAPON_EVOS.polymorph_evo.stats(8).dur],
      skyfire: SV.Config.WEAPON_EVOS.grenade_meteor.stats(8),
      lateHealth: [SV.Entities.healthDropLateFactor({time:600}),SV.Entities.healthDropLateFactor({time:1200})]
    };
    return result;
  });
  const mechanics = result._mechanics; delete result._mechanics;
  for (const [id, value] of Object.entries(result)) {
    if (!(value.damage > 0 && value.ms < 10000 && value.peak <= 1200 && value.visual))
      throw Error(id + ': ' + JSON.stringify(value));
  }
  if (!(mechanics.railBestLine && mechanics.plagueThird && mechanics.ringRuntime && mechanics.plasmaAttached && mechanics.healthPull &&
      mechanics.healthRadius > 26 && mechanics.plagueHits === 3 &&
      mechanics.ringCount === 8 && mechanics.core.coreR === 80 && mechanics.core.coreLife === 1.5 &&
      mechanics.corridor === 60 && mechanics.overclock.damageMul === 1.2 && mechanics.overclock.frequencyMul === 1.2 &&
      mechanics.shockCounts[0] === 1 && mechanics.shockCounts[1] === 2 && mechanics.hexSpread.join(',') === '1,3,1' &&
      mechanics.polymorphDur.join(',') === '2.5,3.76,4.5' && mechanics.skyfire.damage > 0 && mechanics.skyfire.childDmg > 0 && mechanics.skyfire.childCount > 0 &&
      mechanics.skyfire.burn === 18 && mechanics.lateHealth[0] === 1 && Math.abs(mechanics.lateHealth[1]-0.4)<1e-9))
    throw Error('new balance mechanics: ' + JSON.stringify(mechanics));
  const radii = await page.evaluate(() => ({
    aura: SV.Config.WEAPONS.aura.stats(8).radius,
    evo: SV.Config.WEAPON_EVOS.aura_evo.stats(8).radius,
    fusion: SV.Config.WEAPON_EVOS.aura_poison.stats(8).radius
  }));
  if (!(radii.aura === 150 && radii.evo === 180 && radii.fusion === 205))
    throw Error('aura visual radius: ' + JSON.stringify(radii));
  if (errors.length) throw Error(errors.join('\n'));
  console.log(JSON.stringify(result));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
