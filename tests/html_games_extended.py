"""Large-map, fallback, storage and AI browser regression."""
import os,time,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]/'games'
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 errors=[]
 page=b.new_page(viewport={'width':1280,'height':720})
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((ROOT/'game_of_life/index.html').as_uri(),wait_until='networkidle')
 page.locator('#cols').fill('10000');page.locator('#rows').fill('10000');page.locator('#logistic').click();page.locator('button[type=submit]').click();page.wait_for_function('LifeApp.config?.rows===10000',timeout=30000)
 # Even while full-map overview is computing, the controls remain usable.
 t=time.monotonic();page.locator('#menu').click();assert time.monotonic()-t<2
 page.locator('#continue').click();page.locator('#zoom-in').click();page.locator('#fit').click();page.locator('#menu').click()
 # Test a representative larger simulation with active evolution.
 page.locator('#cols').fill('1000');page.locator('#rows').fill('1000');page.locator('button[type=submit]').click();page.wait_for_function('LifeApp.config?.rows===1000')
 page.locator('#more').click();page.locator('#random').click();page.wait_for_function('LifeApp.population>0');page.locator('#run').click();page.wait_for_function('LifeApp.generation>=1',timeout=30000)
 t=time.monotonic();page.locator('#help').click();assert time.monotonic()-t<2;page.locator('#help-close').click();page.locator('#menu').click()
 # Force worker creation and local storage to fail; offline fallback still works.
 fallback=b.new_page(viewport={'width':960,'height':540})
 fallback.on('pageerror',lambda e:errors.append(str(e)))
 fallback.add_init_script("window.Worker=function(){throw new Error('worker unavailable')};Object.defineProperty(window,'localStorage',{get(){throw new Error('storage unavailable')}})")
 fallback.goto((ROOT/'game_of_life/index.html').as_uri(),wait_until='networkidle');fallback.locator('button[type=submit]').click();fallback.wait_for_function('!!LifeApp.config')
 fallback.locator('#step').click();fallback.wait_for_function('LifeApp.generation===1')
 fallback.evaluate("LifeApp.engine.postMessage({type:'init',config:LifeApp.config,snapshot:{format:'life-lab',version:1,generation:0,speed:12,runs:[[2,2400]]}})")
 fallback.wait_for_function("document.querySelector('#notice').textContent.includes('数据无效')")
 fallback.locator('#step').click();fallback.wait_for_function('LifeApp.generation===2')
 fallback.goto((ROOT/'function_missel/index.html').as_uri(),wait_until='networkidle')
 fallback.wait_for_function("Array.from(document.querySelectorAll('script[src]')).every(s=>s.src.startsWith('file:'))")
 fallback.evaluate("window.testAudio=new Audio('sound/explosion.mp3');testAudio.load()")
 fallback.wait_for_function('testAudio.readyState>=2')
 fallback.clock.install()
 fallback.locator('#humans').fill('2');fallback.locator('#ais').fill('0');fallback.locator('button[type=submit]').click()
 fallback.clock.run_for(60200)
 assert fallback.evaluate('MissileApp.current.id')==1, 'invalid expression must skip at timeout'
 fallback.locator('#menu').click()
 fallback.locator('#humans').fill('0');fallback.locator('#ais').fill('4');fallback.locator('button[type=submit]').click();fallback.clock.run_for(1000);fallback.wait_for_function("MissileApp.state==='firing'||MissileApp.world.players.some(p=>p.moved)",timeout=10000)
 assert not errors,errors
 b.close()
print('PASS: 10000² Logistic allocation and responsive controls; 1000² simulation; worker/storage fallback; AI spectator mode.')
