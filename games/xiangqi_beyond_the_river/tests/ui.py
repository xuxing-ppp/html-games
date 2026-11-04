import os
from playwright.sync_api import sync_playwright
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
(root/'work/screenshots').mkdir(parents=True,exist_ok=True)
checks=[]
def check(v,label):
 assert v,label
 checks.append(label)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle');page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')
 def click(q):
  page.locator(q).first.click();page.wait_for_function('!busy')
 def fit(label):
  sizes=page.evaluate('({h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth,vh:innerHeight,vw:innerWidth})')
  check(sizes['h']<=sizes['vh'] and sizes['w']<=sizes['vw'],label+' 页面无滚动 '+str(sizes))
 def inject(expr):
  page.evaluate('state='+expr+';screen="game";overlay=null;resetView();render()')
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h});page.evaluate('screen="home";overlay=null;render()');fit(f'{w} 标题')
  click('[data-action="new"]');fit(f'{w} 选派');click('[data-action="depart"]');fit(f'{w} 路线');click('[data-enter]');fit(f'{w} 战斗')
  check(page.evaluate('[...document.querySelectorAll(".battle-controls button")].every(e=>e.closest(".player-panel"))'),f'{w} 操作在左')
  check(page.evaluate('document.querySelector(".end-button").getBoundingClientRect().bottom<=innerHeight'),f'{w} 结束按钮可见')
  check(page.locator("#card-detail").count()==0,f"{w} 无重复固定说明区")
  check(page.evaluate('parseFloat(getComputedStyle(document.querySelector(".piece-hp")).fontSize)>=14'),f'{w} 棋子生命字体')
  check(page.evaluate('[...document.querySelectorAll(".hand-grid .card")].every(e=>e.getBoundingClientRect().bottom<=document.querySelector(".hand-grid").getBoundingClientRect().bottom+1)'),f'{w} 首回合手牌完整可见')
  if w==1280:page.screenshot(path=str(root/'work/screenshots/battle-1280.png'))
  for chapter in [1,2,3]:
   for layout in page.evaluate(f'D.chapters[{chapter-1}].layouts'):
    inject(f'(()=>{{const s=G.newRun({{school:"palm",seed:8}});s.chapter={chapter};const n={{...s.maps[{chapter-1}].find(n=>n.type==="mission"),layout:{json.dumps(layout)}}};G.setup(s,n);return s}})()');fit(f'{w} {layout}')
    check(page.evaluate('document.querySelector(".board").getBoundingClientRect().bottom<=innerHeight'),f'{w} {layout} 棋盘完整')
   inject(f'(()=>{{const s=G.newRun({{seed:8}});s.chapter={chapter};s.phase="shop";G.J.shop(s);return s}})()');fit(f'{w} 商店')
   inject(f'(()=>{{const s=G.newRun({{seed:8}});s.chapter={chapter};s.phase="camp";s.camp={{used:false,draft:null}};return s}})()');fit(f'{w} 营地')
   inject(f'(()=>{{const s=G.newRun({{seed:8}});s.chapter={chapter};s.phase="event";s.nodeId=s.maps[{chapter-1}].find(n=>n.type==="event").id;G.J.event(s);return s}})()');fit(f'{w} 事件')
   inject(f'(()=>{{const s=G.newRun({{seed:8}});s.chapter={chapter};s.phase="reward";s.nodeId=s.maps[{chapter-1}][0].id;G.J.reward(s);return s}})()');fit(f'{w} 奖励')
  inject('(()=>{const s=G.newRun({seed:8});s.pathKey="shadowblade";s.tier=3;s.phase="ascend";s.progression={from:"boss",removeDone:false};return s})()');fit(f'{w} 进阶')
  page.evaluate('screen="lessons";render()');fit(f'{w} 教学目录')
 page.set_viewport_size({'width':1280,'height':720})
 # Guided interactions and animation are covered in teaching_ui.py.
 for i in range(8):
  page.evaluate('(i)=>beginTutorial(i)',i);fit(f'教学{i+1}')
  check(page.locator('.lesson-required').count()==1,f'教学{i+1} 指定操作清楚')
 # Live preview, damaged saves, class and path choice reversal.
 inject('G.enter(G.newRun({seed:42}),"1-0-1")');before=page.evaluate('JSON.stringify(state)');click('[data-action="beaconMove"]');page.locator('.cell.legal').first.hover();check(page.evaluate('JSON.stringify(state)')==before,'预览无副作用');check(page.locator('#preview-result').count()==1,'预览结果可读');click('.cell.legal');page.evaluate('save()');before=page.evaluate('JSON.stringify(state)');page.reload();page.wait_for_load_state('networkidle');click('[data-action="continue"]');check(page.evaluate('JSON.stringify(state)')==before,'刷新恢复进阶场地手牌')
 inject('(()=>{const s=G.newRun({seed:8});s.routeVersion=1;s.phase="camp";s.row=3;s.nodeId="1-3-1";s.camp={used:false,draft:null};return s})()');click('[data-path="shadowblade"]');click('[data-path="riverblade"]');check(page.evaluate('state.pathKey===null&&state.camp.draft==="riverblade"&&state.deck.length===10'),'营地反悔不重复领牌');click('[data-action="heal"]');click('[data-action="leave"]');check(page.evaluate('state.phase==="ascend"&&state.pathKey==="riverblade"'),'离营确认分支');click('[data-action="ascend-remove"]');click('[data-ascend-remove]');click('[data-action="ascend-next"]');check(page.evaluate('state.phase==="map"&&state.deck.length===10'),'免费删牌后前行')
 # Inspect every concept without changing the combat state.
 inject('G.enter(G.newRun({seed:9}),"1-0-1")');before=page.evaluate('JSON.stringify(state)')
 for key in page.evaluate('D.lessons.map(d=>d.concept)'):
  page.evaluate('(key)=>openConcept(key)',key);click('[data-action="demo-next"]');click('[data-action="close"]');check(page.evaluate('JSON.stringify(state)')==before,'概念示范不改正式棋局 '+key)
 # All 18 current-rank demonstrations are rule based and do not mutate the adventure.
 for key,school in page.evaluate('Object.entries(D.paths).map(([k,p])=>[k,p.school])'):
  for tier in [1,2,3]:
   inject(f'(()=>{{const s=G.newRun({{school:{json.dumps(school)},seed:8}});s.pathKey={json.dumps(key)};s.tier={tier};s.phase="ascend";s.progression={{from:"boss",removeDone:false}};return s}})()')
   before=page.evaluate('JSON.stringify(state)');click('[data-action="path-demo"]');fit(key+str(tier)+'连招示范');check(page.locator('.demo-stats span').count()==4,'连招伤害护盾资源可见 '+key+str(tier));click('[data-action="close"]');check(page.evaluate('JSON.stringify(state)')==before,'连招示范不改冒险 '+key+str(tier))
 def arena(keys,props='[]',beacon='null',objective='null',shrines='[]'):
  inject('(()=>{const s=G.tutorial(0);s.tutorial=false;s.hero.x=3;s.hero.y=5;s.enemies=s.enemies.filter(e=>e.x===6);s.props='+props+';s.beacon='+beacon+';s.objective='+objective+';s.shrines='+shrines+';s.hand='+json.dumps(keys)+'.map(k=>G.J.card(s,k));s.deck=G.clone(s.hand);s.draw=[];s.discard=[];s.energy=3;s.phase="battle";G.refresh(s,true);return s})()')
 lamp='{id:"beacon",kind:"beacon",name:"灯",x:3,y:6,hp:1,maxHp:1,shield:0}'
 arena(['guard'],beacon=lamp,objective='{kind:"hold",x:3,y:6,ids:[],progress:0}');click('[data-action="end"]');check(page.evaluate('state.objective.progress')==1,'夺渡守一轮');click('[data-action="end"]');check(page.evaluate('state.phase')=='reward','夺渡两轮获胜，无须清场')
 arena(['slash','slash'],props='[{id:"a",kind:"core",name:"枢",x:3,y:4,hp:6,maxHp:6,ttl:99},{id:"b",kind:"core",name:"枢",x:2,y:5,hp:6,maxHp:6,ttl:99}]',objective='{kind:"cores",x:1,y:1,ids:["a","b"],progress:0}')
 click('[data-card="0"]');click('[data-cell="31"]');click('[data-card="0"]');click('[data-cell="37"]');check(page.evaluate('state.phase')=='reward','破枢胜利，无须清场')
 for kind,hp,key in [('breakwall',5,'jab'),('boulder',6,'push'),('bomb',3,'jab')]:
  arena([key],props='[{id:"p",kind:'+json.dumps(kind)+',name:"物",x:3,y:4,hp:'+str(hp)+',maxHp:'+str(hp)+',ttl:99,shield:0}]');before=page.evaluate('state.hero.hp');click('[data-card="0"]')
  if kind=='bomb':
   page.locator('[data-cell="31"]').hover();check('4' in page.locator('#loss-number').inner_text(),'爆符预览包含立即自伤')
  click('[data-cell="31"]')
  check(page.evaluate('state.props[0]?.y===3' if kind=='boulder' else 'state.props.length===0'),'实操场地物件 '+kind)
  if kind=='bomb':check(page.evaluate('state.hero.hp')==before-4,'爆符实伤与预览相同')
 arena(['guard'],beacon=lamp,shrines='[{x:3,y:6,used:false}]');click('[data-action="end"]');check(page.evaluate('state.energy===4&&state.shrines[0].used'),'灵台下一回合返气')
 inject('G.enter(G.newRun({seed:9}),"1-0-1")')
 # Normal-speed enemy playback preserves order and shows individual damage.
 page.evaluate('settings.reduced=false;settings.speed=1');page.clock.install();click('[data-action="move"]');page.keyboard.press('Escape')
 page.locator('[data-action="end"]').click();page.clock.fast_forward(400);check(page.evaluate('busy'),'敌人动作有观察停顿');check(page.locator('.intent-chip.active').count()<=1,'当前行动者唯一');page.locator('[data-action="skip-animation"]').click();page.clock.fast_forward(2000);page.wait_for_function('!busy');check(page.evaluate('state.turn')==2,'快进只完成一个回合')
 check(not errors,'页面无异常 '+str(errors));(root/'work/ui-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'checks');b.close()
