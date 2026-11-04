const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium, chromiumExecutable, indexURL } = require('./browser_helper');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable()});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720}}), errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(indexURL);await page.waitForLoadState('networkidle');
    await page.locator('[data-act="start"]').click();await page.locator('[data-act="toChar"]').click();
    await page.locator('[data-act="toWeapon"]').click();await page.locator('[data-act="beginRun"]').click();
    await page.locator('#btnPause').click();
    const saved = await page.evaluate(()=>{
      const s=SV.Game.state;s.time=930;s.difficulty='normal';s.bossSpawned=s.stage.bosses.map(()=>true);
      s.enemies=[];s.lateBossIndex=0;s.pendingBosses=[];s.lateReliefUntil=0;
      SV.Waves.update(s,1/60);
      return SV.Game.createSaveSnapshot();
    });
    assert.equal(saved.state.pendingBosses.length,1);
    const restored=await page.evaluate(save=>{
      SV.Storage.saveRun(save);SV.Game.continueSavedRun();SV.Game.mode='paused';
      const s=SV.Game.state,queued=s.pendingBosses.length;
      s.time=932;SV.Waves.update(s,1/60);
      return {queued,pending:s.pendingBosses.length,bosses:s.enemies.filter(e=>e.isBoss).length};
    },saved);
    assert.equal(restored.queued,1);assert.equal(restored.pending,0);assert(restored.bosses>=2);
    // Legacy snapshots omit every new field; resume must not replay a wave already passed.
    const legacy=JSON.parse(JSON.stringify(saved));
    delete legacy.state.pendingBosses;delete legacy.state.lateReliefUntil;delete legacy.state.lateBossIndex;
    delete legacy.state.player.burstIframe;delete legacy.state.player.hazardTick;
    const legacyResult=await page.evaluate(save=>{
      SV.Storage.saveRun(save);SV.Game.continueSavedRun();SV.Game.mode='paused';const s=SV.Game.state;
      return {pending:s.pendingBosses.length,index:s.lateBossIndex,burst:s.player.burstIframe,hazard:s.player.hazardTick};
    },legacy);
    assert.deepEqual(legacyResult,{pending:0,index:1,burst:0,hazard:0});
    // Continuous resizing keeps combat state; targeting follows the real camera/viewport, not a stale rectangle.
    for(const [width,height] of [[1920,1080],[1280,720],[960,540],[844,390],[740,360],[1280,720]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>new Promise(requestAnimationFrame));
      const result=await page.evaluate(()=>{
        const s=SV.Game.state;s.player.x=s.player.y=0;SV.Renderer.snapCam(0,0);
        s.enemies=[];s.weapons=[];SV.Weapons.init(s,'missile');
        const cam=SV.Renderer.cam,sz=SV.Renderer.cssSize(),hh=sz.h/2/cam.zoom;
        const off=SV.Entities.addEnemy(s,'zombie',0,hh+50);
        const visible=SV.Entities.addEnemy(s,'zombie',Math.min(450,sz.w/2/cam.zoom-40),0);
        off.hp=visible.hp=1e8;
        SV.Entities.rebuildGrid(s);SV.Weapons.updateAll(s,1/60);
        const pr=SV.Weapons.proj.list[0];SV.Renderer.render(s);SV.HUD.refresh(s);
        const r=document.querySelector('#btnPause').getBoundingClientRect();
        return {visible:pr.target===visible,time:s.time,level:s.level,pause:r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight};
      });
      assert(result.visible&&result.pause);assert.equal(result.time,930);assert.equal(result.level,saved.state.level);
      if(width===844||width===1280)await page.screenshot({path:path.join(__dirname,`late_balance_${width}.png`)});
    }
    const endless=await page.evaluate(()=>{
      const s=SV.Game.state;s.endless=true;s.time=1230;s.endlessBossNext=1230;
      const before=s.enemies.length;SV.Waves.update(s,1/60);
      return {added:s.enemies.length-before,next:s.endlessBossNext};
    });
    assert(endless.added>=2);assert.equal(endless.next,1320);
    // Render a real late combat scene, then drive it with keyboard input (Auto stays off).
    await page.evaluate(()=>{
      const s=SV.Game.state;s.time=1080;s.endless=false;s.level=100;s.xp=0;s.xpNext=100000;
      s.enemies=[];s.eshots=[];s.hazards=[];s.player.x=s.player.y=0;
      s.passives={maxhp:5,armor:5,regen:5,speed:3,damage:5,cooldown:5,area:3};SV.Entities.invalidateMods(s);
      s.player.hp=s.player.maxHp=SV.Entities.mods(s).maxHp;
      SV.Weapons.init(s,'blade_evo');s.weapons[0].level=8;
      s.weapons.push({id:'sentry_hex',level:1,cd:0,angle:0,evolved:true},{id:'shotgun_evo',level:8,cd:0,angle:0,evolved:true});
      for(let i=0;i<36;i++) {
        const a=i/36*Math.PI*2,r=180+(i%4)*70;
        SV.Entities.addEnemy(s,['zombie','runner','shielder','warden'][i%4],Math.cos(a)*r,Math.sin(a)*r);
      }
      const boss=SV.Entities.addBoss(s,'frostwarden',330,30);boss.t1=.01;boss.t2=.01;
      SV.Renderer.snapCam(0,0);SV.Auto.enabled=false;SV.Game.mode='playing';
    });
    await page.keyboard.down('d');await page.waitForTimeout(450);await page.keyboard.up('d');
    assert(await page.evaluate(()=>SV.Game.state.player.x>20),'manual input moves the late-game player');
    for(const [width,height] of [[1280,720],[844,390]]) {
      await page.setViewportSize({width,height});await page.waitForTimeout(250);
      await page.screenshot({path:path.join(__dirname,`late_combat_${width}.png`)});
    }
    await page.locator('#btnPause').click();
    const paused=await page.evaluate(()=>SV.Game.state.time);await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>SV.Game.state.time),paused);
    await page.evaluate(()=>SV.Effects.setReducedFx(true));
    assert.deepEqual(errors,[]);
    console.log('late_balance_browser: save/legacy/stagger/resize/visible targeting/endless OK');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
