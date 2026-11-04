"""Viewport and navigation regression. Run against the local game server."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
SIZES=[(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
def fit(page,scope):
    errors=page.evaluate('''scope=>{
      const problems=[];if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)problems.push('page overflow');
      for(const el of document.querySelectorAll(scope+' button')){
        if(!el.checkVisibility())continue;const r=el.getBoundingClientRect();
        if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)problems.push('outside '+(el.id||el.textContent));
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!el.disabled&&hit&&!el.contains(hit))problems.push('covered '+(el.id||el.textContent));
      }return problems;
    }''',scope)
    assert not errors,errors
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['KART_BROWSER_PATH']} if os.environ.get('KART_BROWSER_PATH') else {}),args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('KART_TEST_URL','http://localhost:8000'),wait_until='networkidle')
    page.evaluate("async()=>{window.g=await import(new URL('src/game.js',location.href).href)}")
    page.locator('#menuHelpBtn').click();assert page.locator('#drivingGuide').is_visible()
    page.keyboard.press('Escape');assert page.locator('#drivingGuide').is_hidden()
    assert page.locator('#menuHelpBtn').evaluate('(e)=>e===document.activeElement')
    seen=set()
    for i in range(12):
        seen.add(page.locator('.trackBtn.on').get_attribute('data-track'));page.locator('#trackNext').click()
    assert len(seen)==12
    page.locator('.setup-tabs [data-page="car"]').click();page.locator('[data-car="2"]').click();page.locator('[data-paint="1"]').click()
    page.locator('.setup-tabs [data-page="rules"]').click();page.locator('#weatherBtn').click();page.locator('[data-mode="2p"]').click()
    settings=page.evaluate('JSON.stringify([g.GAME.track,g.GAME.car,g.GAME.paint,g.GAME.weather,g.GAME.mode])')
    for w,h in SIZES:
        page.set_viewport_size({'width':w,'height':h})
        for tab in ['track','car','rules']:
            page.locator(f'.setup-tabs [data-page="{tab}"]').click();fit(page,'#menu')
        assert page.evaluate('JSON.stringify([g.GAME.track,g.GAME.car,g.GAME.paint,g.GAME.weather,g.GAME.mode])')==settings
    page.locator('#startBtn').click();page.evaluate('for(let i=0;i<220;i++)g.updateSimulation(1/60)')
    for w,h in SIZES:
        page.set_viewport_size({'width':w,'height':h});fit(page,'#hud')
        assert page.locator('#p1panel').is_visible() and page.locator('#p2panel').is_visible()
        assert page.evaluate('g.GAME.mode')=='2p'
    assert not errors,errors
    browser.close()
print('PASS: six viewport sizes, all configuration pages, twelve-track navigation, resize preserves choices, two-player HUD.')
