import os
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1];(root/'work/screenshots').mkdir(parents=True,exist_ok=True);checks=[]
def check(v,label):
 assert v,label
 checks.append(label)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle');page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')
 def click(q):page.locator(q).first.click();page.wait_for_function('!busy')
 def inject(expr):page.evaluate('state='+expr+';screen="game";overlay=null;resetView();render()')
 def fit(label):check(page.evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),label+' 无页面滚动')
 def horizontal_center(label):check(page.evaluate('(()=>{const p=document.querySelector(".room-content").getBoundingClientRect();return [...document.querySelector(".room-content").children].filter(e=>e.tagName!=="SCRIPT").every(e=>{const r=e.getBoundingClientRect();return Math.abs(r.left+r.width/2-(p.left+p.width/2))<2})})()'),label+' 选项与按钮居中')
 def center(label):
  horizontal_center(label)
  check(page.evaluate('(()=>{const stage=document.querySelector(".room-stage").getBoundingClientRect(),head=document.querySelector(".room-heading").getBoundingClientRect(),body=document.querySelector(".room-content").getBoundingClientRect();return Math.abs((head.top+body.bottom)/2-(stage.top+stage.bottom)/2)<2})()'),label+' 标题与选项整组纵向居中')
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h});inject('G.newRun({seed:42})');fit(str(w)+'路线');check(page.evaluate('J.total(state)===36&&state.maps.every(m=>Math.max(...m.map(n=>n.row))===11)'),str(w)+'三章36程');check(page.locator('.arena-outline').count()==0,str(w)+'没有战场预览');check(page.locator('.route-node.mission').count()==0,str(w)+'任务与战斗同标识');check(page.evaluate('document.querySelector(".route-scroll").scrollHeight>document.querySelector(".route-scroll").clientHeight'),str(w)+'长图仅内部滚动')
  start=page.evaluate('document.querySelector(".route-scroll").scrollTop');click('[data-action="map-top"]');check(page.evaluate('document.querySelector(".route-scroll").scrollTop')==0,str(w)+'可望首领');click('[data-action="map-current"]');check(page.evaluate('document.querySelector(".route-scroll").scrollTop')>0,str(w)+'可返回当前')
  page.locator('.route-node.boss').click();check(page.locator('[data-enter]').is_disabled(),str(w)+'不能跳关');click('[data-node="1-0-1"]');click('[data-enter]');fit(str(w)+'战斗')
  check(page.locator('.field-warning').count()>0,str(w)+'涨潮预告始终可见')
  page.evaluate('state.hand=["boat","jab","dash"].map(k=>J.card(state,k));render()');before=page.evaluate('JSON.stringify(state)');hero=page.evaluate('state.hero.y*state.width+state.hero.x');lamp=page.evaluate('state.beacon.y*state.width+state.beacon.x')
  click('[data-card="0"]');page.evaluate('window.stableCell=document.querySelector(".cell.legal")');page.locator('.cell.legal').first.hover();check(page.evaluate('window.stableCell.isConnected'),str(w)+'悬停预览保留格子节点');click(f'[data-cell="{lamp}"]');check(page.evaluate('selection')=='beaconMove',str(w)+'身法牌切迁灯');check(page.evaluate('JSON.stringify(state)')==before,str(w)+'切换不出牌')
  click('[data-card="1"]');click(f'[data-cell="{hero}"]');check(page.evaluate('selection') is None,str(w)+'攻击牌点侠取消')
  click('[data-card="2"]');click(f'[data-cell="{hero}"]');check(page.evaluate('selection') is None,str(w)+'身法牌点侠取消')
  page.evaluate('state.freeMove=false;render()');before=page.evaluate('JSON.stringify(state)');click('[data-card="0"]');page.evaluate('window.stableCell=document.querySelector(".cell.legal")');page.locator('.cell.legal').first.hover();check(page.evaluate('window.stableCell.isConnected'),str(w)+'悬停预览保留格子节点');click(f'[data-cell="{lamp}"]');check(page.evaluate('selection') is None and page.evaluate('JSON.stringify(state)')==before,str(w)+'用完行动不凭空迁灯')
  for phase in ['reward','relic','shop','camp','event','cache','insight']:
   setup={'relic':'s.phase="reward";J.reward(s);s.reward.cardDone=true;s.reward.relicDone=false;s.reward.relics=J.relicPool(s).slice(0,3);','reward':'s.phase="reward";J.reward(s);','shop':'s.phase="shop";J.shop(s);','camp':'s.phase="camp";s.camp={used:false,draft:null};','event':'s.phase="event";s.nodeId=s.maps[0].find(n=>n.type==="event").id;J.event(s);','cache':'s.phase="cache";s.cache={gold:35,relic:"heart",claimed:false};','insight':'s.row=2;s.nodeId=s.maps[0].find(n=>n.row===2).id;J.finish(s);'}[phase]
   inject('(()=>{const s=G.newRun({seed:42});'+setup+'return s})()');fit(str(w)+phase);center(str(w)+phase)
   if phase=='relic':check(page.evaluate('(()=>{const items=[...document.querySelectorAll("[data-reward-relic]")].map(e=>e.getBoundingClientRect());return items.length===3&&items.every(r=>Math.abs(r.top-items[0].top)<1)})()'),str(w)+'三件遗物对称同排')
   if phase=='reward':click('[data-action="skip-card"]');fit('继续奖励');center('继续奖励')
   if phase=='event':
    for name in ['井泉','遗阵','灯市','试武','纸鸢','星坛']:
     page.evaluate('(name)=>{state.event.name=name;state.event.resolved=false;state.event.pending=null;state.gold=200;render()}',name);check(page.locator('[data-event]').count()==2,str(w)+name+'双选项');center(name)
   if phase=='insight':
    click('[data-path="shadowblade"]');click('[data-path="riverblade"]');check(page.evaluate('state.deck.length===10&&state.insight.draft==="riverblade"'),str(w)+'悟道确认前可改');click('[data-action="confirm-path"]');check(page.evaluate('state.pathKey==="riverblade"&&state.tier===1&&state.deck.length===11'),str(w)+'不进营地也能进阶');click('[data-action="ascend-skip"]');click('[data-action="ascend-next"]');check(page.evaluate('state.completed===1&&state.phase==="map"'),str(w)+'悟道不重复计算节点')
  if w==1440:
   inject('G.newRun({seed:42})');page.screenshot(path=str(root/'work/screenshots/expanded-map.png'))
 # Cards that explicitly support the lamp remain valid tactics, rather than a mode switch.
 inject('(()=>{const s=G.tutorial(0);s.tutorial=false;s.beacon={id:"beacon",kind:"beacon",name:"命灯",x:4,y:6,hp:1,maxHp:1};s.hand=[J.card(s,"push")];s.energy=3;return s})()');click('[data-card="0"]');click('[data-cell="46"]');check(page.evaluate('state.beacon.x===5&&state.hand.length===0'),'推灯有效目标仍正常出牌')
 # Actual cause shown for damage, instead of an unexplained -3.
 inject('(()=>{const s=G.tutorial(0);s.tutorial=false;return s})()');page.evaluate('fx([{type:"hit",unit:"hero",amount:3,source:"tide",at:state.hero}],state)');check('涨潮' in page.locator('.hit-float').inner_text(),'涨潮伤害标来源')
 check(not errors,'页面无异常 '+str(errors));b.close()
(root/'work/expansion-ui.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'checks')
