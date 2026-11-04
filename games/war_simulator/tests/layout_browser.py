"""Real browser coverage for the side rack, viewport fit and canvas coordinates."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
SIZES=[(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
def fit(page,scope):
    bad=page.evaluate('''scope=>{
      const bad=[];if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)bad.push('page overflow');
      for(const el of document.querySelectorAll(scope+' button,'+scope+' input,'+scope+' select,'+scope+' [role=button]')){
        if(!el.checkVisibility())continue;const r=el.getBoundingClientRect();
        if(r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)bad.push('outside '+(el.id||el.textContent));
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!el.disabled&&hit&&!el.contains(hit))bad.push('covered '+(el.id||el.textContent));
      }return bad;
    }''',scope)
    if bad:print(page.evaluate('''()=>({size:[innerWidth,innerHeight,document.documentElement.scrollWidth,document.documentElement.scrollHeight],outside:[...document.querySelectorAll('body *')].filter(e=>e.checkVisibility()&&((r)=>r.right>innerWidth+1||r.bottom>innerHeight+1)(e.getBoundingClientRect())).map(e=>[e.id||e.className,e.getBoundingClientRect().right,e.getBoundingClientRect().bottom]).slice(0,20)})'''),flush=True)
    assert not bad,bad
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['WAR_BROWSER_PATH']} if os.environ.get('WAR_BROWSER_PATH') else {}))
    page=browser.new_page(reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('WAR_TEST_URL',(Path(__file__).resolve().parents[1]/'index.html').as_uri()),wait_until='networkidle')
    for w,h in SIZES:
        page.set_viewport_size({'width':w,'height':h})
        for mode in ['Campaign','Sandbox','Experiment']:
            page.locator('#mode'+mode).click();page.wait_for_timeout(80);page.screenshot(path=f'/tmp/war-home-{w}-{h}-{mode}.png');fit(page,'#homeScreen')
    page.locator('#modeSandbox').click();page.locator('#btnEnter').click()
    for w,h in SIZES:
        page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(100)
        if w<=560 and page.locator('#deployment').is_hidden():page.locator('#btnTools').click();page.wait_for_timeout(100)
        fit(page,'#app');page.screenshot(path=f'/tmp/war-field-{w}-{h}.png')
        seen=set()
        while True:
            for card in page.locator('.unit-card:visible').all():seen.add(card.get_attribute('data-id'))
            if page.locator('#unitNext').is_disabled():break
            page.locator('#unitNext').click()
        assert len(seen)==20,(w,h,len(seen))
        page.locator('#unitSearch').fill('法师');assert page.locator('.unit-card:visible').count()==1
        page.locator('.unit-card:visible').click();assert page.locator('#selectedUnitName').inner_text()=='法师'
        if w<=560:page.locator('#btnTools').click();page.wait_for_timeout(100)
        page.locator('#unitSearch').fill('');page.locator('#unitPrev').click() if page.locator('#unitPrev').is_enabled() else None
        for tab in ['deploy','storage']:
            page.locator(f'[data-side-tab="{tab}"]').click();fit(page,'#commandPanel')
        page.locator('[data-side-tab="roster"]').click();page.locator('#btnUnitDetails').click();fit(page,'#commandPanel');page.locator('#btnCloseCommand').click()
        if w<=560:page.locator('#btnTools').click();page.wait_for_timeout(100)
        page.locator('#btnFit').click();page.wait_for_timeout(100)
        assert page.evaluate('''()=>{const c=document.querySelector('#canvas').getBoundingClientRect(),cam=W.Game.state.camera;return W.Config.CONST.BOUND_X*cam.zoom<c.width/2&&W.Config.CONST.BOUND_Y*cam.zoom<c.height/2}''')
        page.locator('#btnClear').click()
        # A click projected from world coordinates must place the unit at that point after resize.
        point=page.evaluate('''()=>{const c=document.querySelector('#canvas'),r=c.getBoundingClientRect(),cam=W.Game.state.camera;return {x:r.left+r.width/2+(-180-cam.x)*cam.zoom,y:r.top+r.height/2-cam.y*cam.zoom}}''')
        page.mouse.click(point['x'],point['y'])
        assert page.evaluate('W.Game.state.units.length')==1
        assert page.evaluate('Math.abs(W.Game.state.units[0].pos.x+180)<1&&Math.abs(W.Game.state.units[0].pos.y)<1')
    page.locator('#btnHome').click();page.locator('#modeExperiment').click();page.locator('#btnEnter').click();page.locator('#btnStart').click()
    for w,h in SIZES:
        page.set_viewport_size({'width':w,'height':h});fit(page,'#toolbar');assert page.locator('#sidebar').is_hidden()
        page.locator('#btnPause').click();assert page.evaluate('W.Game.state.paused')
        page.locator('#btnPause').click();assert not page.evaluate('W.Game.state.paused')
    # All maps create, save, resume and reload without changing the active session accidentally.
    page.locator('#btnHome').click();page.locator('#modeSandbox').click()
    page.set_viewport_size({'width':1280,'height':720})
    for map_id in ['meadow','woodland','wetlands','pass','crossings']:
        page.locator('#mapSelect').select_option(map_id);page.locator('#btnEnter').click()
        assert page.evaluate('W.Terrain.current')==map_id
        for w,h in SIZES:
            page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(60);fit(page,'#app')
            assert page.evaluate('''()=>{const c=document.querySelector('#canvas').getBoundingClientRect(),cam=W.Game.state.camera;return W.Terrain.maps[W.Terrain.current].outline.every(([x,y])=>Math.abs((x-cam.x)*cam.zoom)<c.width/2&&Math.abs((y-cam.y)*cam.zoom)<c.height/2)}''')
        page.set_viewport_size({'width':1280,'height':720});page.wait_for_timeout(100)
        page.locator('[data-side-tab="roster"]').click();page.locator('#btnRandom').click();page.wait_for_timeout(120)
        page.mouse.move(1250,10);page.screenshot(path=f'/tmp/war-map-{map_id}.png')
        page.locator('#btnHome').click();page.locator('#mapSelect').select_option('meadow');page.locator('#btnResume').click()
        assert page.evaluate('W.Terrain.current')==map_id
        if page.locator('#deployment').is_hidden():page.locator('#btnTools').click()
        page.locator('[data-side-tab="storage"]').click();page.locator('#btnSave').click()
        saved=page.evaluate('JSON.parse(localStorage.getItem("war-lab-v1"))')
        assert saved['map']==map_id and len(saved['units'])>0
        page.evaluate("W.Terrain.setMap('meadow')");page.locator('#btnLoad').click()
        assert page.evaluate('W.Terrain.current')==map_id
        assert page.evaluate('W.Game.state.units.map(u=>({typeId:u.typeId,team:u.team,x:u.pos.x,y:u.pos.y}))')==saved['units']
        page.locator('#btnStart').click();page.locator('#btnReset').click()
        assert page.evaluate('W.Terrain.current')==map_id
        assert page.evaluate('W.Game.state.units.map(u=>({typeId:u.typeId,team:u.team,x:u.pos.x,y:u.pos.y}))')==saved['units']
        page.locator('#btnHome').click()
    # A legacy save defaults to grassland. Invalid saves leave the current scene intact.
    page.locator('#btnResume').click()
    if page.locator('#deployment').is_hidden():page.locator('#btnTools').click()
    page.locator('[data-side-tab="storage"]').click()
    page.evaluate("localStorage.setItem('war-lab-v1',JSON.stringify({mode:'classic',units:[{typeId:'archer',team:'red',x:-200,y:0}]}))")
    page.locator('#btnLoad').click();assert page.evaluate('W.Terrain.current')=='meadow'
    for invalid in ['bad','__proto__']:
        page.evaluate("id=>localStorage.setItem('war-lab-v1',JSON.stringify({map:id,units:[]}))",invalid)
        page.locator('#btnLoad').click();assert page.evaluate('W.Game.state.units.length')==1
        assert page.evaluate('W.Terrain.current')=='meadow'
    page.evaluate("localStorage.setItem('war-lab-v1',JSON.stringify({map:'pass',units:[{typeId:'archer',team:'red',x:-10,y:-300}]}))")
    page.locator('#btnLoad').click();assert page.evaluate('W.Terrain.current')=='meadow'
    page.evaluate("W.Terrain.setMap('woodland');localStorage.setItem('war-lab-v1',JSON.stringify({map:'wetlands',units:[{typeId:'archer',team:'red',x:-800,y:0}]}))")
    page.locator('#btnLoad').click();assert page.evaluate('W.Terrain.current')=='wetlands'
    assert page.evaluate('W.Game.state.units[0].pos.x')==-800
    # Continuous resize across desktop, landscape and portrait breakpoints preserves the scene.
    before=page.evaluate('JSON.stringify(W.Game.state.units.map(u=>[u.typeId,u.team,u.pos.x,u.pos.y]))')
    for step in range(21):
        page.set_viewport_size({'width':1920-step*76,'height':1080-step*27});page.wait_for_timeout(35);fit(page,'#app')
    assert page.evaluate('JSON.stringify(W.Game.state.units.map(u=>[u.typeId,u.team,u.pos.x,u.pos.y]))')==before
    assert not errors,errors
    browser.close()
print('PASS: six viewport sizes, three modes, all twenty units, search, tool pages, accurate deployment after resize, pause/resume, five maps, legacy/new saves, reset and continuous resize.')
