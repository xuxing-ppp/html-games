"""Terrain driving regression. Run against a local server."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
OUTPUT=Path(os.environ.get('KART_TEST_OUTPUT','/tmp/kart-rush-test'));OUTPUT.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['KART_BROWSER_PATH']} if os.environ.get('KART_BROWSER_PATH') else {}),args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1440,'height':900});page.add_init_script('window.requestAnimationFrame=()=>0');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('KART_TEST_URL','http://localhost:8000'),wait_until='networkidle')
    page.evaluate("localStorage.setItem('kart-club-v2',JSON.stringify({races:7,coins:123,records:{'8:time:0:false:0:normal:1':12.3}}))")
    page.reload(wait_until='networkidle')
    page.evaluate("async()=>{window.g=await import('/src/game.js');window.d=await import('/src/world/driving.js');window.c=await import('/src/world/course.js')}")
    assert '相位' not in page.locator('body').inner_text()
    page.locator('#menuHelpBtn').click();assert page.locator('#drivingGuide').is_visible();page.keyboard.press('Escape');assert page.locator('#drivingGuide').is_hidden()
    page.locator('[data-event="time"]').click();assert page.locator('#record').inner_text()=='暂无纪录'
    page.locator('[data-event="race"]').click();page.evaluate('g.renderScene(1)');page.screenshot(path=str(OUTPUT/'menu.png'))
    for i in range(12):
        page.locator(f'[data-track-jump="{i}"]').click();page.locator('#startBtn').click()
        page.evaluate('for(let n=0;n<220;n++)g.updateSimulation(1/60)')
        info=page.evaluate('''()=>{const course=g.world.course,k=g.karts[0];d.resetDriver(k,course,course.main.jumps[0].s-22);k.speed=48;g.updateKart(k,0);g.updateCamera(g.cam1,k,1);return {jumps:course.main.jumps.length,range:Math.max(...course.main.samples.map(f=>f.pos.y))-Math.min(...course.main.samples.map(f=>f.pos.y))}}''')
        assert info['range']>9 and info['jumps']>=2
        page.evaluate('g.renderScene(1)');page.screenshot(path=str(OUTPUT/f'track-{i:02d}.png'));page.evaluate('g.backToMenu()')
    print('PASS 12 courses render from driving camera',flush=True)
    page.locator('[data-track-jump="0"]').click();page.locator('#startBtn').click();page.evaluate('for(let n=0;n<220;n++)g.updateSimulation(1/60)')
    page.keyboard.down('ArrowUp');page.wait_for_timeout(200);page.evaluate('for(let n=0;n<60;n++)g.updateSimulation(1/60)');page.keyboard.up('ArrowUp');assert page.evaluate('g.karts[0].speed')>8
    page.keyboard.press('Escape');frozen=page.evaluate('g.raceTime');page.evaluate('g.updateSimulation(.2)');assert page.evaluate('g.raceTime')==frozen;page.locator('#resumeBtn').click()
    checks=page.evaluate('''()=>{
      const k=g.karts[0],course=g.world.course,j=course.main.jumps[0];d.resetDriver(k,course,j.s-1);k.speed=45;g.keys.ArrowUp=true;g.keys.ShiftRight=true;
      for(let n=0;n<20;n++)g.updateSimulation(1/120);
      const held=k.motion==='airborne'&&!k.trick;g.keys.ShiftRight=false;g.updateSimulation(1/120);g.keys.ShiftRight=true;g.updateSimulation(1/120);const fresh=k.trick;g.keys.ShiftRight=false;
      for(let n=0;n<200;n++)g.updateSimulation(1/120);
      g.keys.ArrowUp=false;return {held,fresh,landed:k.landingCount===1,scored:k.driftScore>=180};
    }''');assert all(checks.values()),checks
    print('PASS keyboard driving, pause, actual takeoff and trick landing',flush=True)
    layers=page.evaluate('''()=>{
      const a=g.karts[0],b=g.karts[1];b.mesh.visible=true;a.routeId=b.routeId='main';a.motion=b.motion='grounded';a.pos.set(0,10,0);b.pos.set(0,40,0);a.speed=30;b.speed=50;
      g.kartKartCollisions();const cars=a.speed===30&&b.speed===50;
      const box=g.itemBoxes[0];a.item=null;a.pos.copy(box.basePos);a.pos.y+=20;g.updateItems(.01);const item=a.item===null;
      return {cars,item};
    }''');assert all(layers.values()),layers
    frames=page.evaluate('''()=>{
      const results=[];g.GAME.event='time';
      for(const hz of [30,60,144]){g.startGame();for(let n=0;n<240;n++)g.updateSimulation(1/60);
        const k=g.karts[0];d.resetDriver(k,g.world.course,g.world.course.main.jumps[0].s-20);k.speed=45;g.keys.ArrowUp=true;
        for(let n=0;n<hz*2;n++)g.updateSimulation(1/hz);
        results.push({s:k.roadS,speed:k.speed,y:k.pos.y,landing:k.landingCount});g.keys.ArrowUp=false;g.backToMenu();
      }return results;
    }''');assert all(abs(r[key]-frames[0][key])<1e-6 for r in frames for key in r),frames
    print('PASS height-separated interactions and 30/60/144Hz determinism',flush=True)

    page.evaluate('g.backToMenu()');page.locator('[data-event="time"]').click();page.locator('#startBtn').click();page.evaluate('for(let n=0;n<220;n++)g.updateSimulation(1/60)')
    result=page.evaluate('''()=>{const k=g.karts[0];k.isPlayer=false;k.isAI=true;g.karts[7].isPlayer=true;
      for(let i=0;i<120*240&&!k.finished;i++)g.updateSimulation(1/120);
      k.isPlayer=true;k.isAI=false;g.karts[7].isPlayer=false;g.updateSimulation(1/60);return {finished:k.finished,state:g.state,lap:k.lap};}''')
    assert result['finished'] and result['state']=='finished',result
    profile=page.evaluate("JSON.parse(localStorage.getItem('kart-club-v2'))");assert profile['races']==8 and profile['coins']>=123
    assert profile['records']['8:time:0:false:0:normal:1']==12.3
    assert any(key.startswith('terrain-v3:') for key in profile['records'])
    page.evaluate('g.renderScene(1)');page.screenshot(path=str(OUTPUT/'results.png'));print('PASS full lap, finish and save compatibility',flush=True)
    page.locator('#resultsMenuBtn').click();page.locator('[data-event="drift"]').click();page.locator('[data-mode="2p"]').click();page.locator('#startBtn').click();page.evaluate('for(let n=0;n<220;n++)g.updateSimulation(1/60)')
    page.evaluate('''()=>{for(const k of g.karts.slice(0,2)){d.resetDriver(k,g.world.course,g.world.course.main.jumps[0].s-1);k.speed=45;}g.keys.ArrowUp=true;g.keys.KeyW=true;for(let n=0;n<20;n++)g.updateSimulation(1/120);}''')
    page.keyboard.down('ShiftLeft');page.evaluate('g.updateSimulation(1/60)');page.keyboard.up('ShiftLeft');assert page.evaluate('g.karts[1].trick&&!g.karts[0].trick')
    page.evaluate('g.keys.ArrowUp=false;g.keys.KeyW=false');page.evaluate('g.renderScene(1)');page.screenshot(path=str(OUTPUT/'split.png'))
    page.evaluate('for(let n=0;n<5500;n++)g.updateSimulation(1/60)');assert page.evaluate('g.state')=='finished'
    assert 'P2' in page.locator('#resultExtra').inner_text();print('PASS independent split-screen tricks and 90-second challenge',flush=True)
    assert not errors,errors;browser.close()
