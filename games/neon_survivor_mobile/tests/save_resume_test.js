const { chromium, chromiumExecutable, indexURL } = require('./browser_helper');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable()});
  const page=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(indexURL);
  await page.locator('[data-act="start"]').click();
  await page.locator('[data-act="toChar"]').click();
  await page.locator('[data-act="toWeapon"]').click();
  await page.locator('[data-act="beginRun"]').click();
  await page.evaluate(()=>{
    const s=SV.Game.state; s.time=137; s.level=7; s.kills=42; s.player.hp=s.player.maxHp*0.63;
    const e=SV.Entities.makeEnemy(s,'zombie',s.player.x+100,s.player.y); s.enemies.push(e);
    const p=SV.Weapons.proj.acquire(); p.x=s.player.x; p.y=s.player.y; p.vx=10; p.life=3; p.maxLife=3; p.weaponId='missile'; p.target=e;
  });
  await page.locator('#btnPause').click();
  await page.locator('[data-act="saveExit"]').click();
  const title=await page.evaluate(()=>({mode:SV.Game.mode,cont:!document.querySelector('#btnContinueRun').classList.contains('hidden'),progress:document.querySelector('#savedRunProgress').textContent,saved:!!SV.Storage.getSavedRun()}));
  if(title.mode!=='menu'||!title.cont||!title.saved||!title.progress.includes('2:17')||!title.progress.includes('Lv 7')) throw new Error('title save state '+JSON.stringify(title));
  await page.reload(); await page.waitForTimeout(150);
  if(!(await page.evaluate(()=>SV.Game.mode==='menu'&&!!SV.Storage.getSavedRun()))||!(await page.locator('#btnContinueRun').isVisible())) throw new Error('save did not persist across reload');
  for(const v of [{w:844,h:390},{w:667,h:375},{w:740,h:360}]){
    await page.setViewportSize({width:v.w,height:v.h});
    const m=await page.evaluate(()=>{const s=document.querySelector('#titleScreen'),c=s.querySelector('.screen-card'),r=c.getBoundingClientRect();return {sw:s.scrollWidth,cw:s.clientWidth,sh:s.scrollHeight,ch:s.clientHeight,top:r.top,bottom:r.bottom};});
    if(m.sw>m.cw||m.sh>m.ch||m.top<0||m.bottom>v.h+0.5) throw new Error('overflow '+JSON.stringify({v,m}));
  }
  await page.locator('#btnContinueRun').click();
  const resumed=await page.evaluate(()=>{const s=SV.Game.state,p=SV.Weapons.proj.list[0];return {mode:SV.Game.mode,time:s.time,level:s.level,kills:s.kills,enemies:s.enemies.length,projectiles:SV.Weapons.proj.list.length,targetLinked:!!p&&p.target===s.enemies[0],saveKept:!!SV.Storage.getSavedRun()};});
  if(resumed.mode!=='playing'||resumed.time<137||resumed.level!==7||resumed.kills!==42||resumed.enemies<1||resumed.projectiles<1||!resumed.targetLinked||!resumed.saveKept) throw new Error('resume '+JSON.stringify(resumed));
  await page.locator('#btnPause').click(); await page.locator('[data-act="saveExit"]').click();
  await page.locator('[data-act="start"]').click();
  if(!(await page.locator('#newGameConfirmScreen').isVisible())) throw new Error('confirm not shown');
  await page.locator('[data-act="cancelNewGame"]').click();
  if(!(await page.locator('#titleScreen').isVisible())) throw new Error('cancel did not return');
  await page.locator('[data-act="start"]').click(); await page.locator('[data-act="confirmNewGame"]').click();
  if(await page.evaluate(()=>!!SV.Storage.getSavedRun())) throw new Error('save not cleared');
  await page.locator('[data-act="toChar"]').click(); await page.locator('[data-act="toWeapon"]').click(); await page.locator('[data-act="beginRun"]').click();
  await page.locator('#btnPause').click();
  await page.evaluate(()=>{SV.Storage.saveRun=()=>false;});
  await page.locator('[data-act="saveExit"]').click();
  if(!(await page.evaluate(()=>SV.Game.mode==='paused'))||!(await page.locator('#pauseScreen').isVisible())) throw new Error('save failure exited game');
  if(errors.length) throw new Error('page errors '+errors.join('\n'));
  console.log('save/resume and mobile landscape passed');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
