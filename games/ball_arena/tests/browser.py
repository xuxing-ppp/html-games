"""Real-browser checks. Screenshots go to a temporary directory."""
import os,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(os.environ.get('BALL_ARENA_TEST_OUTPUT',str(Path(tempfile.gettempdir())/'ball-arena-checks')));OUT.mkdir(parents=True,exist_ok=True)
SIZES=[(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  if self.path.startswith('/Games/'):self.path=self.path[len('/Games'):]
  super().do_GET()
 def log_message(self,*a):pass
class Server(ThreadingHTTPServer):request_queue_size=128
server=Server(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
def fit(page,selectors):
 problems=page.evaluate('''selectors=>{const p=[];if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)p.push('document overflow');for(const selector of selectors){const el=document.querySelector(selector);if(!el||!el.checkVisibility())continue;const r=el.getBoundingClientRect();if(r.width<10||r.height<10||r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)p.push([selector,{x:r.x,y:r.y,width:r.width,height:r.height}]);}return p;}''',selectors)
 assert not problems,(page.viewport_size,problems)
def snap(page,name):page.screenshot(path=str(OUT/f'{name}.png'))
def snapshot(page):return page.evaluate('JSON.stringify(ArenaApp.engine.game.balls.map(b=>({id:b.id,hp:b.hp,x:b.x,y:b.y})))')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
  page=context.new_page();errors=[];warnings=[];missing=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('console',lambda m:warnings.append(m.text) if m.type in ('error','warning') and 'GPU stall due to ReadPixels' not in m.text else None)
  page.on('response',lambda r:missing.append((r.status,r.url)) if r.status>=400 else None)
  page.on('requestfailed',lambda r:missing.append((r.failure,r.url)) if r.failure!='net::ERR_ABORTED' else None)
  page.on('request',lambda r:external.append(r.url) if r.url.startswith('http') and not r.url.startswith(BASE) else None)
  for prefix in ['/', '/Games/']:
   page.goto(BASE+prefix+'games/ball_arena/',wait_until='networkidle')
   page.evaluate('localStorage.clear()');page.reload(wait_until='networkidle');page.click('#home-free')
   assert page.locator('.role-card').count()==190
   assert page.locator('#settings-dialog').count()==0
   page.check('#random-expanded');assert page.evaluate('ArenaApp.state.expanded');page.uncheck('#random-expanded')
   page.fill('#seed','4294967296');page.locator('#seed').blur();assert page.evaluate('ArenaApp.state.seedText')==''
   page.select_option('#physics','gyro');page.select_option('#mode','boss');assert page.locator('#physics').is_disabled();assert page.locator('#physics').input_value()=='none'
   page.check('#hazard-pads');assert page.evaluate('ArenaApp.state.physics')=='gyro';page.uncheck('#hazard-pads');page.select_option('#mode','duel');assert page.locator('#physics').input_value()=='gyro';page.select_option('#physics','none')

   for width,height in SIZES:
    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100)
    fit(page,['.masthead','#lineup','#roster','#start','.selection-footer','#search','#physics','#hazard-pads','#hazard-supplies','#hazard-laser','#seed','#random-expanded'])
    before=page.locator('#lineup').bounding_box();page.locator('#roster').evaluate('(e)=>e.scrollTop=e.scrollHeight');page.wait_for_timeout(70)
    assert page.locator('#lineup').bounding_box()==before
    fit(page,['#lineup','#start','#editing']);snap(page,f'selection-{prefix.strip("/") or "root"}-{width}x{height}')
   page.set_viewport_size({'width':1440,'height':900})
   for y in range(0,4300,190):page.locator('#roster').evaluate('(e,y)=>e.scrollTop=y',y);page.wait_for_timeout(25)
   page.click('[data-side="right"]');page.fill('#search','泡泡机');page.click('[data-pick="arenaBubble"]');assert page.evaluate('ArenaApp.state.right[0]')=='arenaBubble'
   page.click('[data-info="arenaBubble"]');assert '减速' in page.locator('#detail-content').inner_text();page.click('#detail-favorite');page.click('#detail [data-close]')
   page.click('[data-filter="favorites"]');assert page.locator('.role-card').count()==1
   page.click('[data-filter="all"]');page.fill('#search','电网');page.click('[data-info="electricGrid"]');detail=page.locator('#detail-content').inner_text();assert '电锚点' in detail and '震彯' not in detail;page.click('#detail [data-close]')
   page.fill('#search','');page.click('[data-clear="right"]');assert page.locator('#start').is_disabled();page.click('[data-random="right"]');assert page.locator('#start').is_enabled()
   page.click('#help');assert page.locator('.credit-link').inner_text()=='Kizu_Na ↗';assert page.locator('.credit-link').get_attribute('href')=='https://space.bilibili.com/3546819271330077';page.click('#help-dialog [data-close]')
   page.select_option('#mode','team')
   for side in ['left','right']:
    for _ in range(5):page.click(f'[data-count="{side}"][data-delta="1"]')
   page.click('#random-all')
   for width,height in [(844,390),(390,844)]:
    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(80);fit(page,['#lineup','#roster','#start','#editing']);snap(page,f'team-{prefix.strip("/") or "root"}-{width}x{height}')
   page.set_viewport_size({'width':1440,'height':900});page.select_option('#mode','duel');page.select_option('#series','3')
   page.select_option('#physics','bounce');page.check('#hazard-pads');page.check('#hazard-supplies');page.check('#hazard-laser');page.fill('#seed','217');page.locator('#seed').blur()
   page.evaluate("ArenaApp.state.left=['oldWoodMaster'];ArenaApp.state.right=['spiderweb'];ArenaApp.renderSelection()")
   page.locator('#roster').evaluate('(e)=>e.scrollTop=550');scroll=page.locator('#roster').evaluate('(e)=>e.scrollTop')
   page.click('#start');assert not page.evaluate('ArenaApp.paused');assert page.locator('#timer').inner_text().endswith('/ 4:00')
   fixed=page.evaluate('''()=>['match-label','skills'].map(id=>document.getElementById(id).getBoundingClientRect().x)''')
   page.evaluate('ArenaApp.advanceSteps(600)');after=page.evaluate('''()=>['match-label','skills'].map(id=>document.getElementById(id).getBoundingClientRect().x)''');assert fixed==after,(fixed,after)
   page.click('#skills');assert page.locator('#skills-dialog').is_visible();assert page.evaluate('ArenaApp.paused')
   skills_text=page.locator('#skills-body').inner_text();assert '老木师' in skills_text and '蛛网' in skills_text and 'HP' in skills_text
   page.click('#skills-dialog [data-close]');page.wait_for_timeout(40);assert not page.evaluate('ArenaApp.paused')
   page.click('#skills');assert page.locator('#skills-dialog').is_visible();page.keyboard.press('Escape');page.wait_for_timeout(40);assert not page.evaluate('ArenaApp.paused')
   page.click('[data-team-roster="1"]');assert page.locator('#lineup-detail').is_visible();assert page.evaluate('ArenaApp.paused');page.click('#lineup-detail [data-close]');page.wait_for_timeout(40);assert not page.evaluate('ArenaApp.paused')
   page.click('#pause');assert page.evaluate('ArenaApp.paused')
   page.click('#skills');assert page.locator('#skills-dialog').is_visible();page.click('#skills-dialog [data-close]');page.wait_for_timeout(40);assert page.evaluate('ArenaApp.paused')
   page.click('[data-team-roster="0"]');assert page.locator('#lineup-detail').is_visible();assert '老木师' in page.locator('#lineup-detail-body').inner_text();page.click('#lineup-detail [data-close]');assert page.evaluate('ArenaApp.paused')
   page.click('[data-speed="4"]');assert page.evaluate('ArenaApp.state.speed')==4;page.click('[data-speed="1"]')
   before=page.evaluate('ArenaApp.session.steps');page.wait_for_timeout(100);assert page.evaluate('ArenaApp.session.steps')==before;page.click('#step');assert page.evaluate('ArenaApp.session.steps')==before+1
   for width,height in SIZES:
    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(80);fit(page,['.masthead','#scoreboard','#arena-wrap','#pause','#step','#speeds','#skills','#back']);fixed=page.evaluate('''()=>['match-label','skills'].map(id=>document.getElementById(id).getBoundingClientRect().x)''');page.evaluate('ArenaApp.advanceSteps(60)');after=page.evaluate('''()=>['match-label','skills'].map(id=>document.getElementById(id).getBoundingClientRect().x)''');assert fixed==after,(width,height,fixed,after);snap(page,f'battle-{prefix.strip("/") or "root"}-{width}x{height}')
    page.click('#skills');page.wait_for_timeout(40);fit(page,['#skills-dialog']);snap(page,f'skills-{prefix.strip("/") or "root"}-{width}x{height}');page.click('#skills-dialog [data-close]');page.wait_for_timeout(30)
   page.evaluate('ArenaApp.advanceSteps(360)');first=snapshot(page);assert page.evaluate('ArenaApp.engine.arenaSize')==240
   target=page.evaluate('ArenaApp.session.steps');page.click('#restart');page.click('#pause');page.evaluate('(n)=>ArenaApp.advanceSteps(n-ArenaApp.session.steps)',target);assert snapshot(page)==first
   page.click('#back');assert abs(page.locator('#roster').evaluate('(e)=>e.scrollTop')-scroll)<2
   page.set_viewport_size({'width':1440,'height':900});page.click('#start');page.click('#restart');assert page.evaluate('ArenaApp.replaying===false');page.evaluate("ArenaApp.engine.endBattle(ArenaApp.engine.game.teams[0],ArenaApp.engine.game.teams[1]);ArenaApp.advanceSteps(0)")
   assert page.locator('#result').is_visible();assert page.evaluate('document.querySelector("#skills").disabled');assert page.evaluate('ArenaApp.series.scores[0]')==1
   page.click('#replay-result');page.evaluate("ArenaApp.engine.endBattle(ArenaApp.engine.game.teams[0],ArenaApp.engine.game.teams[1]);ArenaApp.advanceSteps(0)");assert page.evaluate('ArenaApp.series.scores[0]')==1
   page.click('#next-round');assert page.evaluate('ArenaApp.series.round')==2
   page.evaluate("ArenaApp.engine.endBattle(ArenaApp.engine.game.teams[0],ArenaApp.engine.game.teams[1]);ArenaApp.advanceSteps(0)");assert page.evaluate('ArenaApp.series.complete');assert page.locator('#next-round').is_hidden();page.click('#edit-result')
   for mode in ['team','wheel','brawl','boss']:
    page.select_option('#mode',mode)
    assert page.locator('#wheel-setting').is_visible()==(mode=='wheel')
    if mode=='wheel':
     assert page.locator('#retain-dead-skills').is_checked();page.uncheck('#retain-dead-skills');assert page.evaluate('ArenaApp.state.retainDeadSkills===false')
     for w,h in SIZES:
      page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(60);fit(page,['#wheel-setting','#start','#roster']);snap(page,f'wheel-option-{prefix.strip("/") or "root"}-{w}x{h}')
     page.set_viewport_size({'width':1440,'height':900})
    if mode=='brawl':
     for _ in range(10):page.click('[data-count="brawl"][data-delta="1"]')
    page.click('#random-all')
    if mode=='brawl':
     page.set_viewport_size({'width':390,'height':844});fit(page,['#lineup','#roster','#start']);page.set_viewport_size({'width':1440,'height':900})
    page.click('#start');limits={'team':'6:00','wheel':'10:00','brawl':'8:00','boss':'8:00'};assert page.locator('#timer').inner_text().endswith('/ '+limits[mode]);page.click('#pause');page.evaluate('ArenaApp.advanceSteps(120)');snap(page,f'mode-{prefix.strip("/") or "root"}-{mode}');assert page.evaluate('!!ArenaApp.engine')
    page.click('#skills');assert page.locator('#skills-dialog').is_visible();assert page.locator('#skills-body .skills-row').count()>=(12 if mode=='brawl' else 2);page.click('#skills-dialog [data-close]');page.wait_for_timeout(30)
    page.click('#back')
   page.reload(wait_until='networkidle');assert page.evaluate("ArenaApp.state.favorites.includes('arenaBubble')")
   dummy_setup='''(()=>{const id='browserDummy'+location.pathname.length;if(!BallBattle.ballRegistry.list().some(d=>d.id===id))BallBattle.registerBall({id,name:'测试靶',englishName:'Dummy',description:'Test',color:'#eeeeee',stats:{radius:15,speed:150,maxHp:100},createBehavior:()=>({})});const s=ArenaApp.state;s.mode='duel';s.series=5;s.left=[id];s.right=[id];s.physics='none';s.hazards={pads:false,supplies:false,laser:false};ArenaApp.startMatch();ArenaApp.pause(true);})()'''
   page.evaluate(dummy_setup)
   page.evaluate('ArenaApp.engine.game.balls[1].hp=50;ArenaApp.advanceSteps(ArenaApp.timeLimit*60)')
   assert page.locator('#result-title').inner_text()=='红方获胜';assert page.evaluate('ArenaApp.timedOut');page.click('#edit-result')
   page.evaluate(dummy_setup)
   page.evaluate('ArenaApp.advanceSteps(ArenaApp.timeLimit*60)')
   assert page.locator('#result-title').inner_text()=='本局平局'
   for _ in range(2):page.click('#next-round');page.evaluate('ArenaApp.pause(true);ArenaApp.advanceSteps(ArenaApp.timeLimit*60)')
   assert page.evaluate('ArenaApp.series.complete&&ArenaApp.series.draws===3');page.click('#edit-result')
   page.evaluate('''(()=>{const make=(suffix)=>'browserBrawl'+location.pathname.length+suffix;for(const id of [make('a'),make('b')])if(!BallBattle.ballRegistry.list().some(d=>d.id===id))BallBattle.registerBall({id,name:'混战靶'+id.slice(-1),englishName:'Brawl dummy',description:'Test',color:'#eeeeee',stats:{radius:15,speed:150,maxHp:100},createBehavior:()=>({})});const s=ArenaApp.state;s.mode='brawl';s.brawl=[make('a'),make('b')];s.physics='none';s.hazards={pads:false,supplies:false,laser:false};ArenaApp.startMatch();ArenaApp.pause(true);ArenaApp.engine.game.balls[1].hp=50;ArenaApp.advanceSteps(ArenaApp.timeLimit*60);})()''')
   assert page.locator('#result-title').inner_text()=='混战靶a获胜';assert page.evaluate('ArenaApp.timedOut&&ArenaApp.engine.game.winner.id.endsWith("a")');page.click('#edit-result')
   assert not errors,errors;assert not missing,missing;assert not external,external
  assert not warnings,warnings
  context.close()
  context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
  context.add_init_script("Storage.prototype.getItem=function(){throw Error('denied')};Storage.prototype.setItem=function(){throw Error('denied')}")
  page=context.new_page();file_errors=[];page.on('pageerror',lambda e:file_errors.append(str(e)))
  page.goto((ROOT/'games/ball_arena/index.html').as_uri(),wait_until='networkidle');page.click('#home-free');assert page.locator('.role-card').count()==190
  page.click('#start');page.click('#pause');page.evaluate('ArenaApp.advanceSteps(60)');fit(page,['#arena-wrap','#pause']);assert not file_errors,file_errors
  context.close();browser.close();print('PASS: root/subpath, six sizes, scrolling, roles, modes, replay, series, timeout, touch and denied storage; screenshots:',OUT)
finally:server.shutdown();server.server_close()
