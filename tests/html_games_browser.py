"""Offline UI and behavior regression for both HTML ports.
PLAYWRIGHT_BROWSERS_PATH=/tmp/html-games-browser python3 tests/html_games_browser.py
"""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]/'games'
SIZES=[(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
OUT=Path(os.environ.get('HTML_GAMES_SHOTS','/tmp/html-games-shots'));OUT.mkdir(exist_ok=True)
def fit(page,scope='body'):
    errors=page.evaluate('''scope=>{const problems=[];if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)problems.push('page overflow');for(const el of document.querySelectorAll(scope+' button, '+scope+' input:not([type=file]), '+scope+' select')){if(!el.checkVisibility())continue;const r=el.getBoundingClientRect();if(r.left<0||r.top<0||r.right>innerWidth+1||r.bottom>innerHeight+1)problems.push('outside '+(el.id||el.textContent));const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);if(!el.disabled&&hit&&!el.contains(hit))problems.push('covered '+(el.id||el.textContent));}return problems;}''',scope)
    assert not errors, errors
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':900},reduced_motion='reduce',accept_downloads=True)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    requests=[];page.on('request',lambda r:requests.append(r.url) if r.url.startswith('http') else None)
    for name in ['function_missel','game_of_life']:
        page.goto((ROOT/name/'index.html').as_uri(),wait_until='networkidle')
        for w,h in SIZES:
            page.set_viewport_size({'width':w,'height':h});fit(page)
            if name=='game_of_life':
                page.locator('#logistic').click();fit(page);page.locator('#classic').click()
            page.screenshot(path=str(OUT/f'{name}-home-{w}.png'))
        page.set_viewport_size({'width':1440,'height':900})
        if name=='function_missel':
            page.locator('#humans').fill('2');page.locator('#ais').fill('0')
        page.locator('button[type=submit]').click()
        page.wait_for_function('window.MissileApp ? !MissileApp.home : !!LifeApp.config')
        if name=='function_missel':
            page.locator('#formula').fill('sin(x)');assert 'y = sin(x)' in page.locator('#message').inner_text()
            page.locator('#formula').fill('sqrt(-1)');assert page.locator('#message').evaluate("e=>e.classList.contains('error')")
            page.locator('#formula').fill('exp(x/4)');page.locator('#formula').press('p');assert not page.evaluate('MissileApp.paused')
            page.locator('#formula').fill('0.4*x')
            before=page.evaluate('JSON.stringify(MissileApp.world)')
            for w,h in SIZES:
                page.set_viewport_size({'width':w,'height':h});fit(page);assert page.evaluate('JSON.stringify(MissileApp.world)')==before
                page.screenshot(path=str(OUT/f'{name}-game-{w}.png'))
            page.locator('#pause').click();t=page.evaluate('MissileApp.remaining');page.wait_for_timeout(180);assert page.evaluate('MissileApp.remaining')==t
            fit(page,'#overlay');page.locator('#resume').click()
            page.locator('#help').click();fit(page,'#help-dialog');page.locator('#help-dialog [data-close]').click()
            page.locator('#settings').click();page.locator('#coords').check();page.locator('#volume').fill('0');page.locator('#settings-dialog [data-close]').click()
            page.locator('#mode').click();page.evaluate('''()=>{const w=MissileApp.world;for(let x=-20;x<20;x+=2)for(let y=-11;y<12;y+=2)if(Missile.valid(w,{x,y},MissileApp.current)){const p=MissileView.to({x,y}),r=document.querySelector('#board').getBoundingClientRect();window.moveTest={x,y,sx:p.x+r.left,sy:p.y+r.top};return;}}''')
            pt=page.evaluate('moveTest');page.mouse.click(pt['sx'],pt['sy']);assert page.evaluate('MissileApp.world.players[0].moved')
            page.evaluate('MissileApp.next()');assert page.locator('#mode').is_disabled()
            page.locator('#formula').fill('0');page.locator('#fire').click();assert page.evaluate('MissileApp.state')=='firing'
            page.locator('#menu').click();before=page.evaluate('JSON.stringify(MissileApp.world)');page.wait_for_timeout(100);assert page.evaluate('JSON.stringify(MissileApp.world)')==before
            page.locator('#continue').click()
            page.evaluate('''()=>{MissileApp.world.players.forEach((p,i)=>p.hp=i===0?1:0);MissileApp.next();}''');assert page.locator('#overlay').is_visible();fit(page,'#overlay');page.locator('#restart').click()
        else:
            page.wait_for_function("!document.querySelector('#lab').hidden")
            page.locator('#tools-toggle').click() if page.locator('#tools').is_hidden() else None
            page.locator('[data-pattern=Glider]').click()
            r=page.locator('#grid').bounding_box();page.mouse.click(r['x']+r['width']/2,r['y']+r['height']/2)
            page.wait_for_function('LifeApp.population===5')
            page.locator('#grid').click(position={'x':10,'y':10},button='right')
            assert page.evaluate('LifeApp.stamp===null')
            for w,h in SIZES:
                page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(70)
                if w<=1000 and page.locator('#tools').is_visible():page.locator('#tools-close').click()
                fit(page);assert page.evaluate('LifeApp.population')==5
                page.screenshot(path=str(OUT/f'{name}-game-{w}.png'))
            page.locator('#step').click();page.wait_for_function('LifeApp.generation===1')
            page.locator('#more').click()
            with page.expect_download() as download:page.locator('#export').click()
            f=OUT/'snapshot.json';download.value.save_as(str(f));snapshot=json.loads(f.read_text());assert snapshot['version']==1;assert sum(n for v,n in snapshot['runs'])==2400
            page.locator('#more').click();page.locator('#clear').click();page.wait_for_function('LifeApp.population===0')
            page.locator('#file').set_input_files(str(f));page.wait_for_function('LifeApp.population===5');assert not page.evaluate('LifeApp.running')
            page.locator('#run').click();page.wait_for_function('LifeApp.generation>=2');page.locator('#menu').click();g=page.evaluate('LifeApp.generation');page.wait_for_timeout(300);assert page.evaluate('LifeApp.generation')==g
            page.locator('#continue').click();page.wait_for_function('LifeApp.generation>'+str(g));page.locator('#run').click()
            page.locator('#menu').click();page.locator('#logistic').click();page.locator('#lam').fill('0');page.locator('button[type=submit]').click();page.wait_for_function("LifeApp.config?.mode==='logistic'")
            page.locator('#more').click();page.locator('#random').click();page.wait_for_function('LifeApp.population>0');n=page.evaluate('LifeApp.population');page.locator('#step').click();page.wait_for_function('LifeApp.generation===1');assert page.evaluate('LifeApp.population')==n
            page.locator('#tools-toggle').click();assert page.locator('#live-params').is_visible();page.locator('#live-lam').fill('.5');page.locator('#live-lam').press('Tab');page.wait_for_function('LifeApp.config.lam===.5')
            page.locator('#tools-close').click();page.locator('#help').click();fit(page,'#help-dialog');page.locator('#help-close').click()
        assert not errors,errors
    assert not requests,requests
    browser.close()
print('PASS: offline entrypoints, six sizes, resize preservation, missile input/movement/pause/settlement, Life stamp/step/snapshot/continue/Logistic, no online requests.')
