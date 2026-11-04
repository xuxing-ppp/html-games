"use strict";
const {chromium,chromiumExecutable,indexURL}=require("./browser_helper");
function ok(v,m){if(!v)throw new Error(m);console.log("ok - "+m);}
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:chromiumExecutable()});
  const page=await browser.newPage({viewport:{width:844,height:390},isMobile:true,hasTouch:true});
  const errors=[]; page.on("pageerror",e=>errors.push(String(e)));
  await page.addInitScript(()=>{localStorage.clear();window.__closeCalls=0;window.close=()=>{window.__closeCalls++;};});
  await page.goto(indexURL); await page.waitForTimeout(150);
  ok(await page.locator('.title-actions [data-act="start"]').isVisible(),"new game is visible without a save");
  ok(!(await page.locator('#btnContinueRun').isVisible()),"continue is hidden without a save");
  ok(await page.locator('.title-actions [data-act="exitGame"]').isVisible(),"exit is always visible");
  await page.evaluate(()=>document.querySelector('#btnContinueRun').classList.remove('hidden'));
  for(const v of [{w:844,h:390},{w:740,h:360},{w:667,h:375}]){
    await page.setViewportSize({width:v.w,height:v.h});
    const m=await page.evaluate(()=>{
      const screen=document.querySelector('#titleScreen'),card=screen.querySelector('.screen-card');
      const ar=[...document.querySelectorAll('.title-actions button')].map(e=>e.getBoundingClientRect());
      const sr=[...document.querySelector('.settings-row').children].map(e=>e.getBoundingClientRect());
      const cr=card.getBoundingClientRect();
      const center=r=>r.top+r.height/2;
      return {overflow:screen.scrollWidth>screen.clientWidth||screen.scrollHeight>screen.clientHeight,card:[cr.top,cr.bottom],actionsSame:ar.every(r=>Math.abs(center(r)-center(ar[0]))<1),settingsSame:sr.every(r=>Math.abs(center(r)-center(sr[0]))<1),minAction:Math.min(...ar.map(r=>r.height)),minSetting:Math.min(...sr.slice(1).map(r=>r.height))};
    });
    ok(!m.overflow&&m.card[0]>=0&&m.card[1]<=v.h+.5,`${v.w}x${v.h} title fits without scrolling`);
    ok(m.actionsSame&&m.settingsSame,`${v.w}x${v.h} actions and settings remain single-row`);
    ok(m.minAction>=44&&m.minSetting>=44,`${v.w}x${v.h} controls retain 44px touch height`);
  }
  await page.evaluate(()=>{localStorage.setItem('exit-test-marker','kept');window.__stopCalls=0;const old=SV.Audio.stopBgm;SV.Audio.stopBgm=()=>{window.__stopCalls++;old();};});
  await page.locator('[data-act="exitGame"]').click();
  const exit=await page.evaluate(()=>({mode:SV.Game.mode,shown:!document.querySelector('#exitScreen').classList.contains('hidden'),titleHidden:document.querySelector('#titleScreen').classList.contains('hidden'),closeCalls:window.__closeCalls,stopCalls:window.__stopCalls,marker:localStorage.getItem('exit-test-marker')}));
  ok(exit.mode==='exited'&&exit.shown&&exit.titleHidden,"blocked close falls back to the exit screen");
  ok(exit.closeCalls===1&&exit.stopCalls===1,"exit attempts window close and stops BGM");
  ok(exit.marker==='kept',"exit preserves local storage");
  ok(errors.length===0,"no browser errors");
  await browser.close(); console.log("title layout and exit passed");
})().catch(e=>{console.error(e);process.exit(1);});
