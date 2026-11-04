"""Card reading: stable hover, readable disabled cards, complete choice faces, no gameplay side effects."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
(root/'work/screenshots').mkdir(parents=True,exist_ok=True)
checks=[]
def check(value,label):
 assert value,label
 checks.append(label)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle')
 page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')
 def inject(expr):page.evaluate('state='+expr+';screen="game";overlay=null;resetView();render()')
 def click(q):page.locator(q).first.click();page.wait_for_function('!busy')
 def hover(q):page.locator(q).first.hover();page.wait_for_selector('#card-peek')
 def fit(label):check(page.evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),label+' 无页面滚动')
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h})
  inject('(()=>{const s=G.enter(G.newRun({seed:42}),"1-0-1");s.hand=["impact","boat","jab","dash","push"].map(k=>J.card(s,k));return s})()')
  before=page.evaluate('JSON.stringify(state)');hover('[data-card="1"] .card-illustration')
  check(page.locator('.peek-rules').inner_text()==page.evaluate('cardText(state.hand[1])'),f'{w} 悬停全文无需点击')
  if w==1280:page.screenshot(path=str(root/'work/screenshots/cards-hover-1280.png'))
  for child in ['h3','.card-metrics','.cost']:
   page.locator('[data-card="1"] '+child).hover();page.wait_for_timeout(220)
   check(page.locator('#card-peek h3').inner_text()=='回舟',f'{w} 卡内跨子元素 {child} 不误关')
  page.locator('#card-peek .peek-rules').hover();page.wait_for_timeout(400)
  check(page.locator('#card-peek h3').inner_text()=='回舟',f'{w} 可移入效果继续读')
  check(page.evaluate('(()=>{const r=document.querySelector("#card-peek").getBoundingClientRect();return r.left>=11&&r.top>=11&&r.right<=innerWidth-11&&r.bottom<=innerHeight-11})()'),f'{w} 提示完整位于屏幕内')
  check(page.evaluate('document.querySelector("#card-peek").getBoundingClientRect().left>document.querySelector(".player-panel").getBoundingClientRect().right'),f'{w} 浮窗不遮住其他手牌')
  check(page.evaluate('JSON.stringify(state)')==before,f'{w} 阅读未改变资源与选牌')
  # Crossing another card briefly must not replace the effect being read.
  page.locator('[data-card="3"] h3').hover();page.wait_for_timeout(40);page.locator('#card-peek').hover();page.wait_for_timeout(220)
  check(page.locator('#card-peek h3').inner_text()=='回舟',f'{w} 路过卡牌不立即换说明')
  page.locator('[data-card="4"]').hover();page.wait_for_function('document.querySelector("#card-peek h3")?.textContent==="推山"')
  check(True,f'{w} 停留其他牌可切换')
  page.locator('.board-heading').hover();page.wait_for_timeout(380);check(page.locator('#card-peek').count()==0,f'{w} 离开卡与说明后关闭')
  page.evaluate('state.energy=0;render()');before=page.evaluate('JSON.stringify(state)')
  hover('[data-peek-key="boat"]');check(page.locator('.peek-unavailable').count()==1,f'{w} 缺气仍能读牌')
  page.locator('[data-peek-key="boat"]').click();check(page.evaluate('JSON.stringify(state)')==before and page.evaluate('selection') is None,f'{w} 缺气读牌不会出牌')
  page.evaluate('state.energy=3;render()');page.locator('[data-card="1"]').focus();page.wait_for_selector('#card-peek')
  check(page.locator('#card-peek h3').inner_text()=='回舟',f'{w} 键盘聚焦可读');page.keyboard.press('Escape');check(page.locator('#card-peek').count()==0,f'{w} Esc关闭')
  # Pending tips must not survive replacing the view.
  page.locator('[data-card="1"]').hover();page.evaluate('overlay="deck";render()');page.wait_for_timeout(350)
  check(page.locator('#card-peek').count()==0,f'{w} 换界面不残留浮窗')
  check(page.locator('.deck-grid .card-rules').count()==page.locator('.deck-grid .card').count(),f'{w} 牌库直接显示效果')
  check(page.evaluate('[...document.querySelectorAll(".deck-grid .card-rules")].every(e=>e.scrollHeight<=e.clientHeight+1)'),f'{w} 牌库效果不截断')
  fit(f'{w} 牌库');click('[data-action="close"]')
  # Every card is readable, including long rare effects and upgraded versions.
  for phase in ['reward','shop']:
   setup='s.phase="reward";J.reward(s);s.reward.cards=["boat","wave","flow"];' if phase=='reward' else 's.phase="shop";J.shop(s);s.gold=999;'
   inject('(()=>{const s=G.newRun({seed:42});'+setup+'return s})()')
   check(page.locator('.offer-grid .card-rules').count()==3,f'{w} {phase} 三张牌直接可读')
   check(page.evaluate('[...document.querySelectorAll(".offer-grid .card-rules")].every(e=>e.textContent.length>5&&e.scrollHeight<=e.clientHeight+1)'),f'{w} {phase} 全文无截断')
   fit(f'{w} {phase}')
   check(page.evaluate('(()=>{const s=document.querySelector(".room-stage").getBoundingClientRect(),a=document.querySelector(".room-heading").getBoundingClientRect(),b=document.querySelector(".room-content").getBoundingClientRect();return Math.abs((a.top+b.bottom)/2-(s.top+s.bottom)/2)<2})()'),f'{w} {phase} 整组纵向居中')
   if phase=='reward':
    if w==1280:page.screenshot(path=str(root/'work/screenshots/cards-reward-1280.png'))
    chosen=page.evaluate('state.reward.cards[0]');length=page.evaluate('state.deck.length');click('[data-offer]');check(page.evaluate('state.deck.length')==length+1,f'{w} 奖励仍可正常选择')
   else:
    gold=page.evaluate('state.gold');click('[data-buy-card="0"]');check(page.evaluate('state.gold')<gold,f'{w} 商店仍可正常购买')
  inject('(()=>{const s=G.newRun({seed:42});s.phase="event";s.event={name:"残谱",pending:"offer",offers:["boat","wave","flow"]};return s})()')
  check(page.locator('[data-event-card] .card-rules').count()==3,f'{w} 事件选牌全文直接可见');fit(f'{w} 事件选牌')
  page.evaluate('state.deck=Object.keys(D.cards).flatMap(key=>[0,1].map(level=>({key,level,id:key+level})));overlay="deck";render()')
  check(page.evaluate('[...document.querySelectorAll(".deck-grid .card-rules")].every((e,i)=>e.textContent===cardText(state.deck[i]))'),f'{w} 全66张基础与升级效果准确显示')
  check(page.evaluate('[...document.querySelectorAll(".deck-grid .card-rules")].every(e=>e.scrollHeight<=e.clientHeight+1)'),f'{w} 全卡池全文不截断');fit(f'{w} 全卡池牌库')
  inject('(()=>{const s=G.enter(G.newRun({seed:42}),"1-0-1");s.hand=[J.card(s,"boat")];return s})()')
  hover('[data-card="0"]')
  # Long effects remain scrollable under the pointer without changing to other cards.
  page.evaluate('window.originalBoat=D.cards.boat.text;D.cards.boat.text=(originalBoat+"\\n").repeat(30);dismissCardPeek()');page.mouse.move(600,80);hover('[data-card="0"]');page.locator('#card-peek').hover();page.mouse.wheel(0,800);page.wait_for_timeout(350)
  check(page.locator('#card-peek').count()==1 and page.evaluate('document.querySelector("#card-peek").scrollTop>0'),f'{w} 长效果可在浮窗内滚动不关闭')
  page.evaluate('D.cards.boat.text=originalBoat;render()');fit(f'{w} 战斗')
 # Nested generic tooltip regression (icons inside buttons).
 page.locator('[data-action="build"]').first.hover();page.wait_for_selector('#tooltip');page.locator('[data-action="build"] svg').first.hover();page.wait_for_timeout(250)
 check(page.locator('#tooltip').count()==1,'普通提示跨图标子元素不消失')
 check(not errors,'页面无异常 '+str(errors));b.close()
(root/'work/card-reading-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'checks')
