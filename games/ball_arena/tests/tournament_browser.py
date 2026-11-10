"""Tournament menus, capacity limits, bracket progression, persistence and viewport checks."""
import os,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[3]
OUT=Path(os.environ.get('BALL_ARENA_TEST_OUTPUT',str(Path(tempfile.gettempdir())/'ball-arena-tournament-checks')));OUT.mkdir(parents=True,exist_ok=True)
SIZES=[(1920,1080),(1440,900),(1280,720),(960,540),(844,390),(390,844)]
class Server(ThreadingHTTPServer):request_queue_size=128
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def do_GET(self):
  if self.path.startswith('/Games/'):self.path=self.path[len('/Games'):]
  super().do_GET()
 def log_message(self,*a):pass
server=Server(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{server.server_port}'
def fit(page,selectors):
 problems=page.evaluate('''selectors=>{const errors=[];if(document.documentElement.scrollWidth>innerWidth+1||document.documentElement.scrollHeight>innerHeight+1)errors.push('page overflow');for(const selector of selectors){for(const e of document.querySelectorAll(selector)){if(!e.checkVisibility())continue;const r=e.getBoundingClientRect();if(r.width<5||r.height<5||r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5)errors.push([selector,{x:r.x,y:r.y,w:r.width,h:r.height}]);if(e.tagName==='BUTTON'&&!e.disabled){const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(hit&&!e.contains(hit))errors.push('covered '+selector);}}}return errors;}''',selectors)
 assert not problems,(page.viewport_size,problems)
def snap(page,name):page.screenshot(path=str(OUT/(name+'.png')))
def settle(page,side=0):page.evaluate('(side)=>{const e=ArenaApp.engine;e.endBattle(side===null?null:e.game.teams[side],side===null?null:e.game.teams[1-side]);ArenaApp.advanceSteps(0)}',side)
def played(page):return page.evaluate('ArenaTournament.tournamentProgress(ArenaTournamentUI.run.bracket).playedCount')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  for prefix in ['/', '/Games/']:
   context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce');page=context.new_page();errors=[];missing=[]
   page.on('pageerror',lambda e:errors.append(str(e)));page.on('response',lambda r:missing.append(r.url) if r.status>=400 else None)
   page.goto(BASE+prefix+'games/ball_arena/',wait_until='networkidle');assert page.locator('#home').is_visible();assert page.locator('#version').inner_text()=='v1.0.2';assert page.locator('.hall-link').count()==0
   for w,h in SIZES:
    page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(90);fit(page,['#home-free','#home-tournament','#version','#help','#sound']);assert page.evaluate("(()=>{const e=document.querySelector('.home-arena');return Math.abs(e.clientWidth-e.clientHeight)<2})()");snap(page,f'home-{prefix.strip("/") or "root"}-{w}x{h}')
   page.click('#home-tournament');assert page.locator('[data-tournament-size]').count()==6
   page.click('[data-tournament-size="64"]');page.click('[data-team-size="3"]');assert page.locator('[data-tournament-size="64"]').is_disabled();assert page.locator('[data-tournament-size="128"]').is_disabled();assert page.locator('#tournament-play').is_disabled();assert '60 队' in page.locator('#tournament-capacity').inner_text()
   page.check('#tournament-filter-elite');assert '58 队' in page.locator('#tournament-capacity').inner_text();page.uncheck('#tournament-filter-elite')
   page.click('[data-team-size="2"]');assert page.locator('[data-tournament-size="64"]').is_enabled();assert page.locator('[data-tournament-size="128"]').is_disabled()
   page.click('[data-team-size="1"]');page.click('[data-tournament-size="128"]')
   for w,h in SIZES:
    page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(70);fit(page,['#home-back','#tournament-teams button','#tournament-sizes button','#tournament-play','#tournament-filter-elite']);snap(page,f'setup-{prefix.strip("/") or "root"}-{w}x{h}')
   page.click('#tournament-play');assert page.evaluate('ArenaTournamentUI.run.bracket.size')==128;assert page.locator('[data-tournament-match]').count()==64
   for w,h in SIZES:
    page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(70);fit(page,['#home-back','#tournament-heading','#tournament-rounds','#tournament-matches','#tournament-play']);before=page.locator('.tournament-heading').bounding_box();page.locator('#tournament-matches').evaluate('(e)=>e.scrollTop=e.scrollHeight');assert page.locator('.tournament-heading').bounding_box()==before;snap(page,f'bracket128-{prefix.strip("/") or "root"}-{w}x{h}')
   page.set_viewport_size({'width':1440,'height':900});page.click('#tournament-play');page.click('#pause');page.evaluate('ArenaApp.advanceSteps(30)');firstseed=page.evaluate('ArenaApp.seed');steps=page.evaluate('ArenaApp.session.steps')
   page.click('#back');assert page.locator('#tournament').is_visible();assert page.locator('#tournament-play').inner_text()=='继续当前比赛 ↗';page.wait_for_timeout(80);assert page.evaluate('ArenaApp.session.steps')==steps
   page.click('#home-back');assert page.locator('#home-continue-tournament').is_visible();page.click('#home-continue-tournament');page.click('#tournament-play');page.click('#pause');assert page.evaluate('ArenaApp.seed')==firstseed
   page.reload(wait_until='networkidle');page.click('#home-continue-tournament');page.click('#tournament-play');page.click('#pause');assert page.evaluate('ArenaApp.seed')==firstseed;assert page.evaluate('ArenaApp.session.steps')<30
   settle(page);assert played(page)==1;page.click('#edit-result');page.click('[data-tournament-match="r0-m0"]');page.click('#tournament-detail-watch');page.click('#pause');settle(page);assert played(page)==1;page.click('#edit-result')
   # A replay is a transient session: leaving it must not block the next official match.
   assert page.evaluate('ArenaApp.session===null');assert page.evaluate('ArenaApp.context===null');assert page.evaluate('ArenaApp.replaying===false');assert page.locator('#tournament-play').inner_text()=='开始下一场 ↗'
   page.click('#tournament-play');page.click('#pause');assert page.evaluate('ArenaApp.replaying===false');page.click('#back');assert page.locator('#tournament-play').inner_text()=='继续当前比赛 ↗'
   # Reset is explicitly confirmed and cancel preserves results.
   page.click('#tournament-reset');page.click('#tournament-reset-dialog [data-close]');assert played(page)==1;page.click('#tournament-reset');page.click('#tournament-reset-confirm');assert page.locator('#tournament-setup').is_visible()
   page.click('[data-team-size="3"]');page.click('[data-tournament-size="4"]');page.click('#tournament-play');assert page.evaluate('ArenaTournamentUI.run.bracket.teamSize')==3
   page.click('#tournament-play');page.click('#pause');firstseed=page.evaluate('ArenaApp.seed');settle(page,None);assert played(page)==0;assert page.locator('#next-round').inner_text()=='平局重赛'
   page.click('#replay-result');page.click('#pause');settle(page,None);assert played(page)==0;page.click('#edit-result');assert page.evaluate('ArenaApp.session===null');assert page.locator('#tournament-play').inner_text()=='开始下一场 ↗';page.click('#tournament-play');page.click('#pause');assert page.evaluate('ArenaApp.seed')!=firstseed;settle(page,0);assert played(page)==1
   # Replay from the result dialog also ends on exit and leaves the next match available.
   page.click('#replay-result');page.click('#pause');settle(page,0);assert played(page)==1;assert page.evaluate('ArenaApp.replaying===true');page.click('#edit-result')
   assert page.evaluate('ArenaApp.session===null');assert page.evaluate('ArenaApp.replaying===false');assert page.locator('#tournament-play').inner_text()=='开始下一场 ↗'
   page.click('#tournament-play');page.click('#pause');assert page.evaluate('ArenaApp.replaying===false');settle(page,0);assert played(page)==2
   for n in [3]:
    # Pause in the same turn as starting so combat cannot damage entrants before the reset assertion.
    page.evaluate("document.querySelector('#next-round').click();ArenaApp.pause(true)");assert page.evaluate('ArenaApp.engine.game.balls.every(b=>b.hp===b.maxHp)');settle(page,0);assert played(page)==n
   assert '夺冠' in page.locator('#result-title').inner_text();page.click('#next-round');assert page.locator('#tournament-champion').is_visible()
   for w,h in SIZES:
    page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(70);fit(page,['#tournament-champion','#tournament-rounds','#tournament-matches','#tournament-play']);snap(page,f'champion-{prefix.strip("/") or "root"}-{w}x{h}')
   page.reload(wait_until='networkidle');assert page.locator('#home-continue-tournament').inner_text()=='查看锦标赛结果';page.click('#home-continue-tournament');assert played(page)==3;assert page.locator('#tournament-champion').is_visible()
   # Existing free play and main-menu resume remain usable after a tournament.
   page.click('#home-back');page.click('#home-free');assert page.locator('#selection').is_visible();page.click('#start');page.click('#pause');steps=page.evaluate('ArenaApp.session.steps');page.click('#home-back');assert page.locator('#home-continue-free').is_visible();page.click('#home-continue-free');page.click('#pause');assert page.evaluate('ArenaApp.session.steps')>=steps
   assert not errors,errors;assert not missing,missing;context.close();print('PASS tournament:',prefix,flush=True)
  # Denied storage works with direct-file touch interaction.
  context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);context.add_init_script("Storage.prototype.getItem=function(){throw Error('denied')};Storage.prototype.setItem=function(){throw Error('denied')};Storage.prototype.removeItem=function(){throw Error('denied')}");page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto((ROOT/'games/ball_arena/index.html').as_uri(),wait_until='networkidle');page.click('#home-tournament');page.click('[data-tournament-size="4"]');page.click('#tournament-play');page.click('#tournament-play');page.click('#pause');settle(page,0);assert played(page)==1;assert not errors,errors;context.close()
  # Ordinary browser Back returns directly to the hall; in-game menus add no history entries.
  context=browser.new_context();page=context.new_page();page.goto(BASE+'/',wait_until='networkidle');page.goto(BASE+'/games/ball_arena/',wait_until='networkidle');page.click('#home-tournament');page.click('#home-back');page.click('#home-free');page.go_back(wait_until='networkidle');assert page.url==BASE+'/';context.close();browser.close();print('PASS menu, 4–128 brackets, weighted teams, capacity, draw retry, replay, champion, persistence, browser Back and touch; screenshots:',OUT)
finally:server.shutdown();server.server_close()
