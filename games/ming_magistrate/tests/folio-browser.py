"""Intrinsic dialog sizes, dynamic biographies and resize behavior, using the real app reader."""
from pathlib import Path
import json,os,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
KEY='jingshui.magistrate.v1'
URL=os.environ.get('MING_URL',(ROOT/'index.html').as_uri())
FIXTURES=json.loads(subprocess.check_output(['node',str(ROOT/'tests/support/fixtures.mjs')],cwd=ROOT,text=True))
OUT=Path(tempfile.mkdtemp(prefix='ming-folio-qa-'))
SIZES=[(1920,1080),(1440,900),(1280,720),(1024,768),(960,540),(844,390),(768,1024),(390,844),(360,640)]
def ready(p):p.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
def load(p,name):
 p.evaluate('([k,g])=>localStorage.setItem(k,JSON.stringify(g))',[KEY,FIXTURES[name]])
 p.reload();ready(p)
 # Capture the existing reader navigation API, without replacing rendering or game state.
 p.evaluate('(()=>{const library=Ming.Library;Ming.Library=v=>{window.folioView=v;return library(v)}})()')
 p.get_by_role('button',name='继续游戏',exact=True).click();ready(p)
def open_page(p,kind,args={}):
 p.evaluate('([type,args])=>{folioView.close();folioView.push(type,args)}',[kind,args]);ready(p)
def check(p,kind):
 p.wait_for_timeout(25)
 metrics=p.locator('dialog').evaluate('''d=>{const b=d.querySelector('.library-body'),r=d.getBoundingClientRect(),s=getComputedStyle(b),child=b.firstElementChild;return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,bh:b.clientHeight,scroll:b.scrollHeight,content:child.getBoundingClientRect().height,pad:parseFloat(s.paddingTop)+parseFloat(s.paddingBottom),root:document.documentElement.scrollWidth}}''')
 assert metrics['x']>=-1 and metrics['y']>=-1 and metrics['x']+metrics['w']<=metrics['vw']+1 and metrics['y']+metrics['h']<=metrics['vh']+1,(kind,metrics)
 assert metrics['root']<=metrics['vw'],(kind,metrics)
 assert metrics['bh']>30,(kind,metrics)
 if kind!='map' and metrics['scroll']<=metrics['bh']+1:
  # Headings and the last paragraph can contribute up to two collapsed 20px margins.
  assert metrics['bh']<=metrics['content']+metrics['pad']+42,('unnecessary blank paper',kind,metrics)
 for n in p.locator('.library-header button,.library-footer button').all():
  r=n.bounding_box();assert r['y']>=0 and r['x']>=0 and r['x']+r['width']<=metrics['vw']+1 and r['y']+r['height']<=metrics['vh']+1,(kind,r,metrics)
 assert p.locator('.library-body').evaluate('(b)=>b.scrollWidth<=b.clientWidth+1'),kind
 assert p.evaluate('document.getAnimations().filter(a=>a.effect?.target?.closest(".scene-art,.dialogue-panel,.ending-panel")).length')==0,kind
 return metrics
with sync_playwright() as pw:
 launch={'headless':True}
 if os.environ.get('MING_BROWSER_PATH'):launch['executable_path']=os.environ['MING_BROWSER_PATH']
 browser=pw.chromium.launch(**launch);ctx=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='no-preference')
 if URL.startswith('file:'):ctx.set_offline(True)
 p=ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.goto(URL);ready(p);load(p,'office')
 p.get_by_role('button',name='帮助与设置',exact=True).click()
 source=p.evaluate('Object.keys(Ming.sources)[0]')
 pages=[('records',{}),('dossier',{}),('people',{}),('person',{'id':'shen'}),('recap',{}),('recap',{'scene':'arrival'}),('sources',{}),('source',{'id':source}),('bibliography',{}),('creation',{}),('help',{}),('instructions',{}),('motion',{}),('saveInfo',{}),('font',{}),('term',{'term':'仓书'}),('place',{'id':'county'}),('map',{}),('notes',{}),('restart',{}),('trade',{}),('limited',{}),('document',{'id':'tax_receipt'})]
 for w,h in SIZES:
  p.set_viewport_size({'width':w,'height':h})
  for font in [18,20,22]:
   p.evaluate('(font)=>folioView.setFont(font)',font)
   for kind,args in pages:
    open_page(p,kind,args);m=check(p,kind)
    if kind in ['term','font','help','restart'] and w>=1280 and h>=720:assert m['h']<h*.8,(kind,m)
    if kind=='map':
     world=p.locator('.atlas-world').bounding_box();assert abs(world['width']/world['height']-1.5)<.01
    if kind=='font':assert p.locator('.font-choices span').evaluate_all('(ns)=>ns.every(n=>getComputedStyle(n).writingMode==="horizontal-tb")')
    if font==22 and (w,h) in [(1440,900),(844,390),(390,844)] and kind in ['help','person','font','term','map','notes','document','restart']:p.screenshot(path=str(OUT/f'{kind}-{w}.png'))
  print('FOLIOS',w,h,'all types and sizes passed',flush=True)
 # Confirm natural resizing keeps the character anchor in a long folio.
 open_page(p,'bibliography');p.locator('.library-body').evaluate('(n)=>n.scrollTop=200');p.wait_for_timeout(60)
 for w,h in [(390,844),(844,390),(1280,720),(360,640),(1920,1080)]:
  p.set_viewport_size({'width':w,'height':h});check(p,'bibliography')
 # Ending act knowledge survives backward navigation, while a fresh continue starts with act zero.
 load(p,'office');before=p.evaluate('(k)=>localStorage.getItem(k)',KEY)
 p.get_by_role('button',name='帮助与设置',exact=True).click();open_page(p,'person',{'id':'xu'});assert '被判徒' not in p.locator('.person-reading').inner_text();p.evaluate('folioView.close()')
 p.get_by_role('button',name='下一幕',exact=True).click();p.get_by_role('button',name='上一幕',exact=True).click()
 p.get_by_role('button',name='帮助与设置',exact=True).click();open_page(p,'person',{'id':'xu'});assert '被判徒' in p.locator('.person-reading').inner_text()
 assert p.evaluate('(k)=>localStorage.getItem(k)',KEY)==before
 load(p,'office');p.get_by_role('button',name='帮助与设置',exact=True).click();open_page(p,'person',{'id':'xu'});assert '被判徒' not in p.locator('.person-reading').inner_text()
 # Hint levels expand in place and retain reachable controls, including the short viewport.
 load(p,'trial-old');p.get_by_role('button',name='请求提示',exact=True).click()
 for label in ['先给一点方向','再指出相关材料','看逐步做法']:
  p.get_by_role('button',name=label,exact=True).click();check(p,'hint')
 # Font choices retain focus; an unsubmitted private note survives reader navigation.
 open_page(p,'notes');p.get_by_role('textbox',name='写一条随手记',exact=True).fill('留到看过原稿以后再记')
 p.locator('.library-header').get_by_role('button',name='字体大小',exact=True).click();p.locator('[data-font-size="18"]').click()
 assert p.locator('[data-font-size="18"]').evaluate('(n)=>n===document.activeElement')
 p.get_by_role('button',name='← 返回随手记',exact=True).click();assert p.get_by_role('textbox',name='写一条随手记',exact=True).input_value()=='留到看过原稿以后再记'
 # Original -> biography shares the same resolver and returns to the focused document entry.
 open_page(p,'document',{'id':'tax_receipt'});p.locator('.document-person').click();assert p.locator('#library-title').inner_text()=='吴长生'
 p.get_by_role('button',name='← 返回材料原文',exact=True).click();assert p.locator('.document-person').evaluate('(n)=>n===document.activeElement')
 assert not errors,errors
 print('ALL FOLIO CHECKS PASSED; screenshots:',OUT,flush=True);browser.close()
