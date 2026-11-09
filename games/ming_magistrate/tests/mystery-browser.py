"""Offline scene-game acceptance. Requires optional Python Playwright, never a game dependency."""
from pathlib import Path
import os,json,subprocess,tempfile,sys
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
KEY='jingshui.magistrate.v1'
URL=os.environ.get('MING_URL',(ROOT/'index.html').as_uri())
OUT=Path(tempfile.mkdtemp(prefix='ming-scene-qa-'))
FIXTURES=json.loads(subprocess.check_output(['node',str(ROOT/'tests/support/fixtures.mjs')],cwd=ROOT,text=True))
VIEWPORTS=[(1920,1080),(1440,900),(1280,720),(1024,768),(960,540),(844,390),(768,1024),(390,844),(360,640)]
def state(page):return page.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',KEY)
def visible_char(page,selector):
 return page.locator(selector).evaluate("""(slot)=>{const top=slot.getBoundingClientRect().top+3,range=document.createRange();let offset=0;for(const n of Ming.readingTextNodes(slot)){for(let i=0;i<n.length;i++){range.setStart(n,i);range.setEnd(n,i+1);if(range.getBoundingClientRect().bottom>top)return offset+i;}offset+=n.length;}return offset;}""")
def ready(page):
 page.wait_for_load_state('load')
 page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
def load(page,name,font=20):
 page.evaluate('([k,g,f])=>{localStorage.setItem(k,JSON.stringify(g));localStorage.setItem("jingshui.reading-size",String(f))}',[KEY,FIXTURES[name],font]);page.reload();ready(page);page.get_by_role('button',name='继续游戏',exact=True).click();ready(page)
def shot(page,name):page.screenshot(path=str(OUT/(name+'.png')),animations='disabled')
def bounds(page):
 info=page.evaluate('({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight})')
 assert info['sw']<=info['w']+1 and info['sh']<=info['h']+1,info
 for n in page.locator('.dialogue-reading,.puzzle-reading,.reader-window,.library-body').all():
  if n.is_visible():assert n.bounding_box()['height']>=42,(n.get_attribute('class'),n.bounding_box())
def contained(page,selector):
 for n in page.locator(selector).all():
  if not n.is_visible():continue
  box=n.bounding_box();size=page.viewport_size
  assert box and box['width']>=24 and box['height']>=28,(selector,box)
  assert box['x']>=-1 and box['y']>=-1 and box['x']+box['width']<=size['width']+1 and box['y']+box['height']<=size['height']+1,(selector,box,size)
def solve_ui(page,p,method="click"):
 def activate(locator):
  if method=="keyboard":locator.focus();page.keyboard.press("Enter")
  elif method=="touch":locator.tap()
  else:locator.click()
 if p['kind']=='match':
  for item,target in p['answer'].items():
   activate(page.locator('[data-select-item="'+item+'"]'));activate(page.locator('[data-target="'+target+'"]'))
 elif p['kind']=='compare':
  for side,field in enumerate(p['answer']):activate(page.locator('[data-pair-side="'+str(side)+'"][data-pair-field="'+field+'"]'))
 else:
  for i,key in enumerate(p['answer']):
   for _ in range(len(p['items'])):
    order=page.evaluate('(()=>{const g=JSON.parse(localStorage.getItem("jingshui.magistrate.v1")),p=Ming.puzzles[g.node];return Ming.puzzleWork(g,p).order})()')
    if order.index(key)<=i:break
    text=next(x['text'] for x in p['items'] if x['id']==key)
    activate(page.get_by_role('button',name='上移'+text,exact=True))
 activate(page.locator('[data-submit-puzzle]'));assert state(page)['phase']=='result'
def journey(page,route):
 page.evaluate('(k)=>localStorage.removeItem(k)',KEY);page.reload();ready(page);page.get_by_role('button',name='开始游戏',exact=True).click()
 for turn in range(600):
  g=state(page)
  if g['phase']=='ending':break
  n=page.evaluate('(g)=>Ming.currentNode(g)',g)
  if g['phase']=='result':page.locator('[data-advance]').click()
  elif n['type']=='puzzle':solve_ui(page,page.evaluate('(id)=>Ming.puzzles[id]',n['puzzle']))
  elif n['type']=='map':page.locator('.place-actions .ink-action').click()
  elif n['type']=='explore':
   order=['markets','courier','scribe'] if route=='letters' else ['scribe']
   remaining=[p for p in order if p not in g['explored']]
   if remaining:
    page.locator('[data-map-list="'+remaining[0]+'"]').click();page.locator('[data-visit-place="'+remaining[0]+'"]').click()
   else:page.get_by_role('button',name='回案头整理',exact=True).click()
  elif n['type']=='choice' and g['beat']==len(n['beats'])-1 and n['id'] not in g['answers']:
   value=route if 'life' in n else 'normal' if n['key']=='receipt' and route=='letters' else 'restricted' if n['key']=='receipt' else n['options'][0]['value']
   page.locator('[data-choice-value="'+value+'"]').click()
  else:page.locator('[data-advance]').click()
  if n['id'] in ['names-close','boats-close','relief-close','autumn-close'] and g['beat']==len(n['beats'])-1:print('JOURNEY',route,n['id'],'passed',flush=True)
 else:raise AssertionError('journey did not finish')
 assert g['verdict']=='complete' and g['life']==[route]*5;assert g['hints']=={};assert not any(x.startswith('learn-') for x in g['completed'])
 before=state(page)
 for _ in range(4):page.get_by_role('button',name='下一幕',exact=True).click()
 assert ('身后留下的名字' if route=='office' else '自在的一生') in page.locator('body').inner_text()
 assert state(page)==before;shot(page,'journey-'+route)
 page.reload();page.get_by_role('button',name='继续游戏',exact=True).click();assert state(page)['verdict']=='complete'
with sync_playwright() as p:
 launch={'headless':True}
 if os.environ.get('MING_BROWSER_PATH'):launch['executable_path']=os.environ['MING_BROWSER_PATH']
 browser=p.chromium.launch(**launch);context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
 if URL.startswith('file:'):context.set_offline(True)
 page=context.new_page();errors=[];requests=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:errors.append(r.url+' '+str(r.failure)) if 'ERR_ABORTED' not in str(r.failure) else None);page.on('request',lambda r:requests.append(r.url))
 page.goto(URL);ready(page);shot(page,'title')
 if '--skip-journeys' not in sys.argv and '--interactions-only' not in sys.argv:
  journey(page,'office');journey(page,'letters');print('BOTH REAL UI JOURNEYS passed',flush=True)
  if '--journeys-only' in sys.argv:
   assert not errors,errors;browser.close();sys.exit(0)
 # Scene-first start, no old-save reader or archive operation; current saves still continue.
 page.evaluate('(k)=>localStorage.setItem(k,JSON.stringify({version:1,ruleset:"linked-v2"}))',KEY);page.reload()
 assert page.get_by_role('button',name='开始游戏',exact=True).count();assert not page.get_by_role('button',name='继续游戏',exact=True).count();assert '旧履职' not in page.locator('body').inner_text()
 page.get_by_role('button',name='开始游戏',exact=True).click();assert page.get_by_role('button',name='确认重新开始',exact=True).is_visible();page.get_by_role('button',name='确认重新开始',exact=True).click();assert state(page)['version']==3;assert '明朝嘉靖四十年' in page.locator('.dialogue-reading').inner_text()
 # Partial puzzle work, originals, navigation stack, font and focus restore.
 load(page,'names-match');page.locator('[data-select-item="n-field"]').click();page.locator('[data-target="south"]').click();before=state(page)
 page.get_by_role('button',name='案卷',exact=True).click();assert page.locator('dialog').get_by_role('button',name='操作说明',exact=True).count()==0
 page.get_by_role('button',name='史料笺',exact=True).click();page.get_by_role('button',name='完整书目',exact=True).click();assert page.locator('dialog a').count()==8
 page.locator('.library-body').evaluate('(n)=>n.scrollTop=260');page.wait_for_timeout(60);scroll=page.locator('.library-body').evaluate('(n)=>n.scrollTop');library_char=visible_char(page,'.library-body')
 page.locator('.library-header').get_by_role('button',name='字体大小',exact=True).click();page.locator('[data-font-size="22"]').click();page.get_by_role('button',name='← 返回完整书目',exact=True).click();page.wait_for_timeout(80);assert page.locator('.library-body').evaluate('(n)=>n.scrollTop')>0;assert abs(visible_char(page,'.library-body')-library_char)<60
 page.keyboard.press('Escape');assert page.locator('#library-title').inner_text()=='史料笺';page.keyboard.press('Escape');assert page.locator('#library-title').inner_text()=='案卷'
 page.get_by_role('button',name='案情与材料',exact=True).click();page.locator('[data-document-id="tax_receipt"]').click();assert page.get_by_role('button',name='← 返回案情与材料',exact=True).count();page.get_by_role('button',name='← 返回案情与材料',exact=True).click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();assert state(page)['puzzleWork']==before['puzzleWork'];assert page.locator('select,input[type=checkbox]').count()==0
 page.reload();page.get_by_role('button',name='继续游戏',exact=True).click();assert state(page)['puzzleWork']==before['puzzleWork']
 print('READER stack, originals, font and puzzle reload passed',flush=True)
 load(page,'limited-result');assert '有限裁定' in page.locator('.scene-location').inner_text();assert '结束本轮补证' in page.locator('.dialogue-reading').inner_text();assert page.locator('.scene-location p').count()==0
 load(page,'partial-final-result');assert '证明缺口' in page.locator('.dialogue-reading').inner_text();page.locator('[data-advance]').click();assert state(page)['verdict']=='partial'
 # First-use cues are local and disappear after an operation; no required reader tour.
 for fixture,control in [('tutorial-compare','[data-pair-side="0"][data-pair-field="status"]'),('tutorial-order','.order-tools button:not(:disabled)'),('names-match','[data-select-item="n-field"]')]:
  load(page,fixture);assert page.locator('.operation-cue').count()==1
  assert page.locator('.first-use,.guided-reader').count()==0
  page.locator(control).first.click()
  if fixture=='names-match':page.locator('[data-target="north"]').click()
  assert page.locator('.operation-cue').count()==0
  page.reload();page.get_by_role('button',name='继续游戏',exact=True).click();assert page.locator('.operation-cue').count()==0
 load(page,'read-original');assert page.locator('.scene-location p').count()==0
 for _ in range(3):page.locator('[data-advance]').click()
 assert state(page)['beat']==3 and state(page)['hints']=={} and not any(x.startswith('learn-') for x in state(page)['completed'])
 # On small screens, choosing a paper brings its actual placement actions into reach.
 for w,h in [(390,844),(360,640),(844,390)]:
  page.set_viewport_size({'width':w,'height':h});load(page,'names-match',22)
  page.locator('[data-select-item="n-field"]').click();contained(page,'.placement-controls button')
  assert page.locator('.placement-controls').is_visible()
  page.locator('[data-quick-target="north"]').click();assert state(page)['puzzleWork']['names-match']['placements']['n-field']=='north'
  assert page.locator('.placement-controls').count()==0
  page.locator('[data-select-item="s-field"]').click();page.locator('.placement-controls').get_by_role('button',name='取消',exact=True).click();assert 's-field' not in state(page)['puzzleWork']['names-match']['placements']
 page.set_viewport_size({'width':1440,'height':900})
 print('OPTIONAL teaching, local cues and clean scene headings passed',flush=True)
 # A speaker is visibly actionable; explanations live only on words present in the text.
 load(page,'read-original');assert page.locator('.word-notes').count()==0
 assert page.locator('.dialogue-reading .inline-term').count()==0
 person=page.locator('[data-person="you"]');assert '人物资料' in person.inner_text()
 person.focus();page.keyboard.press('Enter');assert page.locator('#library-title').inner_text()=='你'
 before=state(page);page.keyboard.press('Escape');assert state(page)==before
 assert page.locator('[data-person="you"]').evaluate('(n)=>document.activeElement===n')
 page.locator('[data-advance]').click();assert state(page)['beat']==1
 assert page.locator('.dialogue-reading>p').inner_text()==page.evaluate('(g)=>Ming.sceneBeats(g)[g.beat].text',state(page))
 assert page.locator('.dialogue-reading [data-term="仓书"]').count()==1
 term=page.locator('.dialogue-reading [data-term="仓书"]');term.focus();term_key=term.get_attribute('data-focus-key');before=state(page)
 page.keyboard.press('Enter');assert page.locator('dialog').count()==1
 assert page.locator('#library-title').inner_text()=='仓书';assert '粮仓' in page.locator('.term-definition').inner_text();assert page.locator('dialog').bounding_box()['height']<page.viewport_size['height']*.8;contained(page,'.library-header button')
 page.keyboard.press('Escape');assert state(page)==before
 assert page.evaluate('document.activeElement.dataset.focusKey')==term_key
 page.get_by_role('button',name='回看前文',exact=True).click();page.locator('.recap-copy [data-term="仓书"]').click()
 assert page.locator('dialog').count()==1;page.keyboard.press('Escape');assert page.locator('#library-title').inner_text()=='剧情回顾'
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 # Document words open the same reader stack, with paragraph text and source metadata intact.
 load(page,'double-compare');page.locator('[data-open-source="refund_sheet"]').click()
 assert page.locator('.document-origin').inner_text().count('三月初七')==1
 page.locator('.original-document [data-term="退补"]').click();assert page.locator('#library-title').inner_text()=='退补'
 page.get_by_role('button',name='← 返回材料原文',exact=True).click();assert page.locator('#library-title').inner_text()=='三月交付清单'
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 # Exercise character anchors across inline nodes, a font change, resize and a round trip.
 page.set_viewport_size({'width':390,'height':844});load(page,'office',22)
 page.locator('.reader-window').evaluate('(n)=>n.scrollTop=190');page.wait_for_timeout(80)
 char_before=visible_char(page,'.reader-window');assert char_before>0
 page.get_by_role('button',name='字体大小',exact=True).click();page.locator('[data-font-size="18"]').click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();page.wait_for_timeout(80)
 assert abs(visible_char(page,'.reader-window')-char_before)<45
 page.set_viewport_size({'width':844,'height':390});page.wait_for_timeout(80);assert abs(visible_char(page,'.reader-window')-char_before)<60
 page.set_viewport_size({'width':1440,'height':900})
 print('INLINE explanations, PERSON affordance, rich-text anchors and RETURN focus passed',flush=True)
 # Local hints and free wrong answers.
 load(page,'tutorial-compare');page.get_by_role('button',name='请求提示',exact=True).click();page.get_by_role('button',name='先给一点方向',exact=True).click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();page.locator('[data-pair-side="0"][data-pair-field="person"]').click();page.locator('[data-pair-side="1"][data-pair-field="person"]').click();page.locator('[data-submit-puzzle]').click();assert state(page)['phase']=='node' and state(page)['feedback']['kind']=='wrong'
 page.get_by_role('button',name='请求提示',exact=True).click()
 for text in ['再指出相关材料','看逐步做法']:page.get_by_role('button',name=text,exact=True).click()
 assert state(page)['hints']['tutorial-compare']==3;page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();solve_ui(page,page.evaluate('Ming.puzzles["tutorial-compare"]'))
 # Replay stays entirely outside current game persistence, even when placing teaching papers.
 load(page,'names-match');before=state(page);page.get_by_role('button',name='帮助与设置',exact=True).click();assert page.locator('dialog').get_by_role('button',name='史料笺',exact=True).count()==0
 page.get_by_role('button',name='重看教学',exact=True).click();page.locator('[data-advance]').click();page.get_by_role('button',name='退出教学回放',exact=True).click();assert state(page)==before;assert page.locator('#library-title').inner_text()=='帮助与设置';page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 # A long ending also retains its exact reading place across a separate teaching session.
 page.set_viewport_size({'width':390,'height':844});load(page,'office',22);page.wait_for_timeout(80);page.locator('.reader-window').evaluate('(n)=>n.scrollTop=180');page.wait_for_timeout(80);saved_read=page.locator('.reader-window').evaluate('(n)=>n.scrollTop');assert saved_read>0
 page.get_by_role('button',name='帮助与设置',exact=True).click();page.get_by_role('button',name='重看教学',exact=True).click();page.locator('[data-advance]').click();page.get_by_role('button',name='退出教学回放',exact=True).click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();page.wait_for_timeout(80);assert abs(page.locator('.reader-window').evaluate('(n)=>n.scrollTop')-saved_read)<45
 page.set_viewport_size({'width':1440,'height':900})
 # Notes remain optional, and map coordinate space follows its actual uncropped image.
 load(page,'autumn-explore');page.get_by_role('button',name='随手记',exact=True).click();page.get_by_role('textbox',name='写一条随手记',exact=True).fill('原稿可能早于初九');page.get_by_role('button',name='留下这条笔记',exact=True).click();assert state(page)['notes'][0]['text']=='原稿可能早于初九';page.get_by_role('textbox',name='编辑笔记1',exact=True).fill('保留两种解释');assert state(page)['notes'][0]['text']=='保留两种解释';page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 page.get_by_role('button',name='放大',exact=True).click();page.get_by_role('button',name='向右',exact=True).click();before=state(page)['map'];page.get_by_role('button',name='地点资料',exact=True).click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();assert state(page)['map']==before
 page.locator('[data-map-list="scribe"]').click();page.locator('[data-visit-place="scribe"]').click();assert '许家账房' in page.locator('.scene-location').inner_text();assert 'scribe' not in page.locator('.scene-location').inner_text()
 print('REPLAY, NOTES and MAP state passed',flush=True)
 # Keyboard activation works after every rerender; touch uses a real touch-enabled context.
 for fixture in ['tutorial-compare','names-match','document-order']:
  load(page,fixture);solve_ui(page,page.evaluate('(g)=>Ming.puzzles[g.node]',state(page)),method='keyboard')
 touch=browser.new_context(viewport={'width':390,'height':844},has_touch=True,reduced_motion='reduce')
 if URL.startswith('file:'):touch.set_offline(True)
 touchpage=touch.new_page();touchpage.on('pageerror',lambda e:errors.append(str(e)));touchpage.goto(URL);ready(touchpage)
 for fixture in ['tutorial-compare','names-match','document-order']:
  load(touchpage,fixture,22);solve_ui(touchpage,touchpage.evaluate('(g)=>Ming.puzzles[g.node]',state(touchpage)),method='touch');bounds(touchpage)
 load(touchpage,'read-original',22);touchpage.locator('[data-person="you"]').tap();touchpage.get_by_role('button',name='关闭查阅，回到游戏',exact=True).tap()
 touchpage.locator('[data-advance]').tap();touchpage.locator('.dialogue-reading [data-term="仓书"]').tap();assert touchpage.locator('#library-title').inner_text()=='仓书'
 touchpage.get_by_role('button',name='关闭查阅，回到游戏',exact=True).tap();assert state(touchpage)['beat']==1
 touch.close();print('KEYBOARD and REAL TOUCH puzzle operations passed',flush=True)
 for w,h in [(844,390),(390,844)]:
  page.set_viewport_size({'width':w,'height':h})
  for fixture in ['tutorial-compare','names-match','document-order']:
   load(page,fixture,22);puzzle=page.evaluate('(g)=>Ming.puzzles[g.node]',state(page));solve_ui(page,puzzle);bounds(page)
  load(page,'to-dock',22);page.get_by_role('button',name='放大',exact=True).click();page.get_by_role('button',name='复位',exact=True).click();world=page.locator('.atlas-world').bounding_box();assert abs(world['width']/world['height']-1.5)<.01;page.locator('.place-actions .ink-action').click();assert state(page)['node']=='boat-story'
  load(page,'trial-old',22);page.get_by_role('button',name='按现有范围裁定',exact=True).click();page.get_by_role('button',name='自愿结束本轮补证',exact=True).click();assert state(page)['trial'][0]['supported']==False
  load(page,'settlement-choice',22);contained(page,'[data-show-choices]');page.locator('[data-show-choices]').click();assert page.evaluate('document.activeElement.hasAttribute("data-choice-value")');page.locator('[data-choice-value="trade"]').click();page.get_by_role('button',name='接受退补交易',exact=True).click();assert state(page)['verdict']=='settlement'
  print('TOUCH/SHORT interactions',w,h,'passed',flush=True)
 count=0
 for w,h in ([] if '--interactions-only' in sys.argv else VIEWPORTS):
  page.set_viewport_size({'width':w,'height':h})
  for font in [18,20,22]:
   for name in ['arrival','boats-intro','restitution','trial-intro','qiuniang','to-dock','tutorial-compare','tutorial-order','names-match','double-compare','autumn-explore','document-order','hai-meeting','settlement-choice','trial-old','hearing-duty','corridor','delivery-result','result','office','letters']:
    
    try:load(page,name,font);page.wait_for_timeout(60);bounds(page)
    except Exception:
     print('FAILED STATE',w,h,font,name,'errors',errors,flush=True);raise
    if name in ['arrival','boats-intro','restitution','trial-intro','qiuniang','hai-meeting','result']:
     contained(page,'[data-advance]');contained(page,'.scene-quick button');assert page.locator('.scene-quick').bounding_box()['y']+page.locator('.scene-quick').bounding_box()['height']<=page.locator('.scene-art').bounding_box()['y']+page.locator('.scene-art').bounding_box()['height']+1
    if name in ['tutorial-compare','tutorial-order','names-match','double-compare','document-order','trial-old']:contained(page,'[data-submit-puzzle]')
    if name=='to-dock':contained(page,'.place-actions .ink-action')
    if name=='autumn-explore':contained(page,'.exploration-footer .ink-action')
    if name=='settlement-choice':
     contained(page,'[data-show-choices]')
     for option in page.locator('[data-choice-value]').all():option.scroll_into_view_if_needed();assert option.is_visible()
    if name in ['office','letters']:contained(page,'.ending-panel footer .ink-action')
    if name in ['arrival','boats-intro','restitution','trial-intro','qiuniang','hai-meeting','result','office','letters']:
     frame=page.locator('.scene-art').bounding_box();img=page.locator('.scene-art img').bounding_box();assert frame['width']>0 and frame['height']>0;assert abs(frame['width']-img['width'])<1 and abs(frame['height']-img['height'])<1
    if font==22 and (w,h) in [(1440,900),(844,390),(390,844)]:shot(page,f'{name}-{w}')
    count+=1
  print('LAYOUT',w,h,'passed',flush=True)
 print('MATRIX',count,'states passed',flush=True)
 load(page,'names-match');page.locator('[data-select-item="n-field"]').click();page.locator('[data-target="north"]').click();before=state(page)
 for w,h in [(1440,900),(844,390),(390,844),(960,540),(1920,1080),(360,640)]:page.set_viewport_size({'width':w,'height':h});page.wait_for_timeout(50);bounds(page)
 assert state(page)==before
 page.evaluate('(k)=>{const old=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===k)throw Error("quota");return old.call(this,key,value)}}',KEY)
 page.locator('[data-select-item="s-field"]').click();page.locator('[data-target="south"]').click();assert '未能保存' in page.locator('.save-error').inner_text()
 assert not errors,errors
 assert not any(url.startswith(('http:','https:')) for url in requests),'unexpected network request'
 print('ALL BROWSER CHECKS PASSED; screenshots:',OUT,flush=True);browser.close()

if '--skip-motion' not in sys.argv:
 subprocess.run([sys.executable,str(ROOT/'tests/motion-browser.py')],check=True)
