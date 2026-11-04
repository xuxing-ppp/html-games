"""Real-browser regression for the directly served Games source.
Uses only Python stdlib plus the development-only Playwright package.
PLAYWRIGHT_BROWSERS_PATH can select an existing Chromium installation.
"""
import re
import os
import threading
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SITE = Path(os.environ.get('GAMES_SITE_ROOT', str(ROOT))).resolve()
GAME_PATH = 'games/'
OUT = Path(os.environ.get('GAMES_TEST_OUTPUT', str(Path(tempfile.gettempdir()) / 'games-hall-checks')))
OUT.mkdir(parents=True, exist_ok=True)
SIZES = [(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
GAMES = ['car_racing','function_missel','game_of_life','ming_magistrate','neon_survivor_mobile','war_simulator','xiangqi_beyond_the_river']
VERSIONS = {game: re.search(r"GAME_VERSION\s*=\s*(['\"])([^'\"]+)\1", (SITE/'games'/game/'version.js').read_text()).group(2) for game in GAMES}
legacy = set()

class Server(ThreadingHTTPServer):
    request_queue_size = 128

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def do_GET(self):
        original = self.path
        prefix = '/Games/' if self.path.startswith('/Games/') else '/'
        relative = self.path[len(prefix):].split('?',1)[0]
        if relative == GAME_PATH+'neon_survivor_mobile/legacy.html':
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers()
            self.wfile.write(b'<!doctype html><title>Legacy migration test</title>Legacy migration test');return
        if relative in [GAME_PATH+'other/sw.js',GAME_PATH+'neon_survivor_mobile/sw.js'] and (relative.startswith(GAME_PATH+'other/') or prefix in legacy):
            body = "self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));"
            if not relative.startswith(GAME_PATH+'other/'):
                body += "self.addEventListener('fetch',e=>{if(e.request.method==='GET')e.respondWith(caches.match(e.request).then(v=>v||fetch(e.request)));});"
            self.send_response(200);self.send_header('Content-Type','text/javascript');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body.encode());return
        if prefix == '/Games/': self.path = '/' + self.path[len(prefix):]
        try: super().do_GET()
        finally: self.path = original

def fit(page, selector='body'):
    errors = page.evaluate('''selector=>{
      const problems=[];
      if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)problems.push('page overflow');
      for(const el of document.querySelectorAll(selector+' button, '+selector+' a')){
        if(!el.checkVisibility()||getComputedStyle(el).visibility==='hidden')continue;
        const r=el.getBoundingClientRect();
        if(!r.width||!r.height)continue;
        if(r.left<-.5||r.top<-.5||r.right>innerWidth+1||r.bottom>innerHeight+1)problems.push('outside: '+el.textContent.trim());
        const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        if(!el.disabled&&hit&&!el.contains(hit))problems.push('covered: '+el.textContent.trim());
      }return problems;
    }''',selector)
    assert not errors, (page.url, page.viewport_size, errors)

def select(page, game):
    while not page.locator('[data-game="'+game+'"]').count():
        if not page.locator('#next').is_disabled():page.locator('#next').click()
        else:
            while not page.locator('#previous').is_disabled():page.locator('#previous').click()
    page.locator('[data-game="'+game+'"]').click()

server = Server(('127.0.0.1',0),partial(Handler,directory=str(SITE)))
threading.Thread(target=server.serve_forever,daemon=True).start()
BASE = f'http://127.0.0.1:{server.server_port}'
try:
  with sync_playwright() as p:
    browser = p.chromium.launch(headless=True,args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    for prefix in ([] if os.environ.get('GAMES_TEST_SECTION')=='retirement' else ['/', '/Games/']):
      context = browser.new_context(viewport={'width':1440,'height':900}, reduced_motion='reduce')
      page = context.new_page()
      errors=[];missing=[]
      page.on('pageerror',lambda error:errors.append(str(error)))
      page.on('response',lambda response:missing.append(response.url) if response.status>=400 else None)
      page.on('requestfailed',lambda request:missing.append((request.url,request.failure)) if request.failure!='net::ERR_ABORTED' else None)
      page.goto(BASE+prefix,wait_until='networkidle')
      assert page.locator('#game-version').inner_text()=='v'+VERSIONS['car_racing']
      for width,height in SIZES+[(390,600),(500,400),(740,560)]:
        page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(80);fit(page,'.hall')
        seen=set()
        while True:
          seen.update(page.locator('.game-choice').evaluate_all('(els)=>els.map(el=>el.dataset.game)'))
          if page.locator('#next').is_disabled():break
          page.locator('#next').click();fit(page,'.hall')
        while not page.locator('#previous').is_disabled():page.locator('#previous').click()
        assert set(GAMES)==seen
        page.screenshot(path=str(OUT/f'hall-{prefix.strip("/") or "root"}-{width}x{height}.png'))
      select(page,'xiangqi_beyond_the_river')
      for width,height in reversed(SIZES):
        page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(60);fit(page,'.hall')
        assert page.locator('#game-title').inner_text()=='楚河行'
      page.set_viewport_size({'width':1440,'height':900});page.wait_for_timeout(80)
      page.locator('[data-game="car_racing"]').focus();page.keyboard.press('End')
      assert page.locator('#game-title').inner_text()=='楚河行'
      for game in GAMES:
        print('Checking',prefix,game,flush=True)
        select(page,game)
        version=page.locator('#game-version').inner_text()
        assert version=='v'+VERSIONS[game],(game,version)
        page.locator('#play').click();page.wait_for_load_state('networkidle')
        assert page.url==BASE+prefix+GAME_PATH+game+'/index.html',page.url
        badge=page.locator('[data-game-version="'+game+'"]')
        try: badge.wait_for(state='visible',timeout=6000)
        except Exception:
          page.screenshot(path=str(OUT/'failure.png'));print(page.url,errors,missing,flush=True);raise
        assert badge.inner_text()==version,(game,badge.inner_text(),version)
        for width,height in SIZES:
          # Chu He Xing's established support is desktop; check its short desktop layout too.
          if game=='xiangqi_beyond_the_river' and width<900:continue
          # Neon supports touch play in landscape; portrait presents a rotate hint.
          if game=='neon_survivor_mobile' and width<height:continue
          page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(60)
          title_scope={'car_racing':'#menu','function_missel':'#home','game_of_life':'#home','ming_magistrate':'.title-screen','neon_survivor_mobile':'#titleScreen','war_simulator':'#homeScreen','xiangqi_beyond_the_river':'.title-page'}[game]
          fit(page,title_scope)
          box=badge.bounding_box()
          assert box and box['x']>=0 and box['y']>=0 and box['x']+box['width']<=width+1 and box['y']+box['height']<=height+1,(game,width,height,box)
          page.screenshot(path=str(OUT/f'{game}-{prefix.strip("/") or "root"}-{width}x{height}.png'))
        page.set_viewport_size({'width':1440,'height':900})
        if game=='car_racing':
          page.locator('#loading').wait_for(state='hidden',timeout=8000);page.locator('#startBtn').click();page.wait_for_timeout(500)
        elif game=='function_missel':
          page.locator('button[type=submit]').click();page.locator('#formula').fill('sin(x)');page.locator('#pause').click();page.locator('#resume').click()
        elif game=='game_of_life':
          page.locator('button[type=submit]').click();page.wait_for_function('!!LifeApp.config');page.locator('#step').click();page.wait_for_function('LifeApp.generation===1')
        elif game=='ming_magistrate':
          page.get_by_role('button',name='开始游戏',exact=True).click();page.locator('.story-stage').wait_for(state='visible')
        elif game=='neon_survivor_mobile':
          page.locator('[data-act=start]').click();page.locator('#selectScreen').wait_for(state='visible')
        elif game=='war_simulator':
          page.locator('#modeSandbox').click();page.locator('#btnEnter').click();page.locator('#app').wait_for(state='visible')
        elif game=='xiangqi_beyond_the_river':
          page.locator('[data-action=new]').click();page.locator('.selection-screen').wait_for(state='visible')
        print('Entry passed',game,flush=True)
        page.go_back(wait_until='networkidle')
        assert page.locator('#game-title').inner_text()==page.evaluate('GamesCatalog.find(g=>g.id===history.state.game).title')
        assert page.evaluate('history.state.game')==game
      assert not errors,errors
      assert not missing,missing
      assert page.evaluate('navigator.serviceWorker.getRegistrations().then(r=>r.length)')==0
      context.close()
      print('PASS entrypoints, versions, gameplay, return, layout:',prefix,flush=True)

    # Exercise a real old registration, shared legacy caches and independent registrations.
    for prefix in ['/', '/Games/']:
      context=browser.new_context();page=context.new_page();legacy.add(prefix)
      scope=BASE+prefix+GAME_PATH+'neon_survivor_mobile/'
      page.goto(scope+'legacy.html')
      page.evaluate('''async scope=>{
        localStorage.setItem('migration-save-marker','keep');
        await navigator.serviceWorker.register(scope+'sw.js',{scope});
        await navigator.serviceWorker.ready;
      }''',scope)
      page.reload();page.wait_for_function('!!navigator.serviceWorker.controller')
      page.evaluate('''async scope=>{
        await navigator.serviceWorker.register(new URL('../other/sw.js',scope),{scope:new URL('../other/',scope).href});
        const old=await caches.open('neon-survivor-v2.10.6');
        await old.put(scope+'stale.js',new Response('legacy'));
        await old.put(location.origin+'/unrelated-neon/index.html',new Response('keep'));
        const other=await caches.open('other-game-v1');await other.put(location.origin+'/other-file',new Response('keep'));
      }''',scope)
      legacy.remove(prefix)
      page.evaluate('''async scope=>{const r=await navigator.serviceWorker.getRegistration(scope);await r.update();}''',scope)
      page.wait_for_function('''async scope=>!(await navigator.serviceWorker.getRegistrations()).some(r=>r.scope===scope)''',arg=scope)
      page.goto(scope+'index.html',wait_until='networkidle')
      result=page.evaluate('''async scope=>{
        const old=await caches.open('neon-survivor-v2.10.6');
        return {old:!!await old.match(scope+'stale.js'),foreign:!!await old.match(location.origin+'/unrelated-neon/index.html'),
          other:(await caches.keys()).includes('other-game-v1'),save:localStorage.getItem('migration-save-marker'),
          registrations:(await navigator.serviceWorker.getRegistrations()).map(r=>r.scope)};
      }''',scope)
      assert not result['old'] and result['foreign'] and result['other'] and result['save']=='keep',result
      assert any('/other/' in registration for registration in result['registrations']),result
      # Unregistering does not detach an already controlled client. Verify a new window.
      fresh=context.new_page();fresh.goto(scope+'index.html',wait_until='networkidle')
      assert not fresh.evaluate('!!navigator.serviceWorker.controller')
      context.close();print('PASS real Worker retirement, cache isolation and saved storage:',prefix,flush=True)
    mobile=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    mobile_page=mobile.new_page();mobile_page.goto(BASE+'/'+GAME_PATH+'neon_survivor_mobile/index.html',wait_until='networkidle')
    assert mobile_page.locator('#rotateHint').is_visible()
    mobile.close()
    # Standalone copies continue to open through file:// without Games root dependencies.
    context=browser.new_context();page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto((SITE/'index.html').as_uri(),wait_until='networkidle')
    assert page.locator('#game-version').inner_text()=='v'+VERSIONS['car_racing']
    for game in GAMES[1:]:
      page.goto((SITE/GAME_PATH/game/'index.html').as_uri(),wait_until='networkidle')
      page.locator('[data-game-version="'+game+'"]').wait_for(state='visible')
    assert not errors,errors
    context.close();browser.close()
    print('PASS standalone file entries; screenshots:',OUT,flush=True)
finally:
    server.shutdown();server.server_close()
