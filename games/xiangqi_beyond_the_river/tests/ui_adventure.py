from playwright.sync_api import sync_playwright
from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[1]
(root/'work/screenshots').mkdir(parents=True,exist_ok=True)
(root/'work/reports').mkdir(parents=True,exist_ok=True)
reports=json.loads((root/'work/reports/ui-fullruns.json').read_text()) if sys.argv[1:] and (root/'work/reports/ui-fullruns.json').exists() else []
with sync_playwright() as p:
 b=p.chromium.launch(headless=True)
 for school,seed,path_key in [('sword',42,'shadowblade'),('palm',103,'wallpalm'),('finger',17,'sealpoint')]:
  if sys.argv[1:] and school not in sys.argv[1:]:continue
  reports=[r for r in reports if r['school']!=school]
  page=b.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle')
  page.evaluate("([school,seed,path_key])=>{sound.configure({music:false,sfx:false});settings.reduced=true;schoolChoice=school;state=G.newRun({school,seed});state.testPath=path_key;screen='game';resetView();save();render()}",[school,seed,path_key])
  page.set_default_timeout(15000)
  script=json.loads((root/f'work/replays/{path_key}-{seed}.json').read_text())
  clicks=0
  def click(selector):
   global clicks
   el=page.locator(selector).first
   assert el.is_enabled(),(school,i,selector)
   el.evaluate('(el)=>el.scrollIntoView({block:"nearest",inline:"nearest",behavior:"instant"})')
   box=el.bounding_box();assert box and box['width']>0 and box['height']>0,(school,i,selector)
   x,y=box['x']+box['width']/2,box['y']+box['height']/2
   assert 0<=x<1440 and 0<=y<900,(school,i,selector,box)
   page.mouse.click(x,y)
   page.wait_for_function('!busy');clicks+=1

  for i,op in enumerate(script):
   old=page.evaluate('state')
   if op['kind']=='act':
    idx=op['index']
    click(f'[data-card="{idx}"]' if isinstance(idx,int) else f'[data-action="{idx}"]')
    if page.evaluate('selection!==null'):click(f'[data-cell="{op["y"]*old["width"]+op["x"]}"]')
   elif op['kind']=='end':click('[data-action="end"]')
   else:
    q=op['state'];phase=old['phase']
    if phase=='map':
     click('[data-node="'+q['nodeId']+'"]');click('[data-enter="'+q['nodeId']+'"]')
     if q.get('boss'):
      page.screenshot(path=str(root/f'work/screenshots/fullrun-{school}-boss{q["boss"]}.png'))
    elif phase=='reward':
     if not old['reward']['cardDone']:
      click('[data-offer="'+q['deck'][-1]['key']+'"]' if len(q['deck'])>len(old['deck']) else '[data-action="skip-card"]')
     elif not old['reward']['relicDone']:click('[data-reward-relic="'+next(k for k in q['relics'] if k not in old['relics'])+'"]')
     else:click('[data-action="next"]')
    elif phase=='insight':click('[data-path="'+q['insight']['draft']+'"]' if q['phase']=='insight' else '[data-action="confirm-path"]')
    elif phase=='cache':click('[data-action="leave"]' if old['cache']['claimed'] else '[data-cache="'+q['cache']['claimed']+'"]')
    elif phase=='ascend':click('[data-action="'+('ascend-next' if old['progression']['removeDone'] else 'ascend-skip')+'"]')
    elif phase=='camp':
     if q['camp'].get('draft')!=old['camp'].get('draft'):click('[data-path="'+q['camp']['draft']+'"]')
     elif old['camp']['used']:click('[data-action="leave"]')
     else:
      changed=next((c for c in q['deck'] if c['level']!=next(d for d in old['deck'] if d['id']==c['id'])['level']),None)
      if changed:click('[data-action="upgrade"]');click('[data-upgrade="'+changed['id']+'"]')
      else:click('[data-action="heal"]')
    elif phase=='shop':
     if q['phase']!='shop':click('[data-action="leave"]')
     elif not old['shop']['medicineBought'] and q['shop']['medicineBought']:click('[data-action="buy-medicine"]')
     elif not old['shop']['relicSold'] and q['shop']['relicSold']:click('[data-action="buy-relic"]')
     else:
      index=next(j for j,c in enumerate(q['shop']['cards']) if c['sold'] and not old['shop']['cards'][j]['sold']);click(f'[data-buy-card="{index}"]')
    elif phase=='event':
     e=old['event'];pending=e.get('pending')
     if e['resolved']:click('[data-action="leave"]')
     elif pending:
      if pending in ['offer','foreign','offer-wish']:click('[data-event-card="'+q['deck'][-1]['key']+'"]')
      else:
       if pending.startswith('remove'):chosen=next(c for c in old['deck'] if not any(d['id']==c['id'] for d in q['deck']))
       elif pending=='copy':chosen=next(c for c in old['deck'] if c['key']==q['deck'][-1]['key'] and c['level']==q['deck'][-1]['level'])
       else:chosen=next(c for c in q['deck'] if c['level']!=next(d for d in old['deck'] if d['id']==c['id'])['level'])
       click('[data-event-pick="'+chosen['id']+'"]')
     else:
      name=e['name'];choice={'访剑':'a' if old['gold']>=30 else 'b' if old['hero']['hp']>20 else 'leave','赌棋':'leave','破庙':'b','残谱':'a' if len(old['deck'])<17 else 'leave','渡口':'a','镖局':'b','旧棋摊':'a' if e['relic'] and old['relics'] else 'b','断桥':'b' if old['gold']>=20 else 'a' if old['hero']['hp']>20 else 'leave','船翁':'a' if old['gold']>=20 else 'b','机关匠':'a' if old['gold']>=35 and any(not c['level'] for c in old['deck']) else 'b','照影':'a' if old['gold']>=75 else 'leave','问心':'b','井泉':'b','遗阵':'a' if old['gold']>=25 else 'b' if old['hero']['hp']>15 else 'leave','灯市':'a' if old['gold']>=55 else 'b' if old['gold']>=15 else 'leave','试武':'a' if old['hero']['hp']>25 and any(not c['level'] for c in old['deck']) else 'b' if old['hero']['hp']>10 else 'leave','纸鸢':'a' if old['gold']>=25 else 'b','星坛':'a' if old['hero']['hp']>20 and e['relic'] else 'b'}[name]
      click('[data-action="event-leave"]' if choice=='leave' else '[data-event="'+choice+'"]')
    else:raise AssertionError(f'{school} step {i}: Unexpected phase {phase}')
    actual=page.evaluate('state')
    if actual!=q:
     (root/'work/reports/mismatch.json').write_text(json.dumps({'actual':actual,'expected':q},ensure_ascii=False,indent=2))
     raise AssertionError(f'{school} step {i} {phase} mismatch fields: '+str([k for k in actual if actual.get(k)!=q.get(k)]))
   assert not errors,errors
  actual=page.evaluate('state');assert actual['phase']=='victory' and actual['completed']==36,(school,actual['phase'])
  page.screenshot(path=str(root/f'work/screenshots/victory-{school}.png'))
  # A full successful run followed by restart via the real class chooser.
  click('[data-action="new"]');click('[data-school="palm"]');click('[data-action="depart"]')
  assert page.evaluate('state.school')=='palm' and page.evaluate('state.completed')==0
  reports.append({'school':school,'path':path_key,'seed':seed,'nodes':actual['completed'],'hp':actual['hero']['hp'],'plays':actual['plays'],'clicks':clicks,'errors':errors,'restart':True})
  (root/'work/reports/ui-fullruns.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));page.close();print(school,'PASS',clicks,'clicks',flush=True)
 (root/'work/reports/ui-fullruns.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2));b.close()
