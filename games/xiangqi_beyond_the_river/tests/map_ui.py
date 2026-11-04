import os
"""Route graph and restrained combat overlays, through the offline entry."""
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
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle');page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h});page.evaluate('state=G.newRun({seed:42});screen="game";overlay=null;resetView();render()')
  check(page.evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),str(w)+'路线页面无滚动')
  check(page.evaluate('state.maps[0].length===document.querySelectorAll("[data-node]").length'),str(w)+'全部分支可查看')
  check(page.evaluate('(()=>{const box=document.querySelector(".route").getBoundingClientRect(),height=box.height;return [...document.querySelectorAll("[data-node]")].every(el=>{const n=state.maps[0].find(n=>n.id===el.dataset.node),p=J.position(n),b=el.getBoundingClientRect();return Math.abs(b.x+b.width/2-box.x-p[0]/560*box.width)<2&&Math.abs(b.y+b.height/2-box.y-p[1]/height*box.height)<2})})()'),str(w)+'节点与道路坐标对齐')
  check(page.evaluate('[...document.querySelectorAll(".route-node.available")].every(e=>{const r=e.getBoundingClientRect();return r.top>=58&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})'),str(w)+'节点全部可见')
  before=page.evaluate('JSON.stringify(state)');scroll=page.locator('.route-scroll').evaluate('(e)=>e.scrollTop')
  for kind in ['battle','elite','event','shop','camp','cache','boss']:
   key=page.locator(f'[data-map-highlight="{kind}"]');key.click()
   check(key.get_attribute('aria-pressed')=='true',str(w)+kind+'图例按下状态')
   check(page.evaluate('(kind)=>[...document.querySelectorAll("[data-node]")].every(e=>e.classList.contains("legend-match")===e.classList.contains(kind))',kind),str(w)+kind+'同类全部强调')
   check(page.locator('.route-scroll').evaluate('(e)=>e.scrollTop')==scroll,str(w)+kind+'强调保留阅图位置')
  page.keyboard.press('Enter');check(page.locator('.legend-match,.legend-muted').count()==0,str(w)+'键盘再次点击取消强调')
  page.locator('[data-map-highlight="shop"]').click()
  if w==1440:page.screenshot(path=str(root/'work/screenshots/route-legend.png'))
  page.locator('.route-node.available').first.click()
  check(page.locator('[data-map-highlight="shop"]').get_attribute('aria-pressed')=='true',str(w)+'查看节点保留强调类型')
  check(page.evaluate('JSON.stringify(state)')==before,str(w)+'图例查看不改变存档与路线')
  page.locator('[data-map-highlight="shop"]').click()
  page.locator('.route-node.boss').click();check(page.locator('[data-enter]').is_disabled(),str(w)+'可远望首领但不可跳关')
  page.locator('[data-node="1-0-1"]').click();page.locator('[data-enter]').click();page.evaluate('G.setup(state,{...state.maps[0][0],formation:"guard_gun"});state.enemies[0].exposed=2;G.refresh(state);state.formation.active=true;render()')
  check(page.locator('.move-route,.attack-route,.intent-ghost,.weak-marker,.formation-link,.future-warning').count()==0,str(w)+'默认收起附加图层')
  check(page.locator('.river-art text').all_text_contents()==['楚河','汉界'],str(w)+'河界双侧清楚标名')
  check(page.evaluate('parseInt(getComputedStyle(document.querySelector(".board-art")).zIndex)>parseInt(getComputedStyle(document.querySelector(".ground")).zIndex)&&parseInt(getComputedStyle(document.querySelector(".piece")).zIndex)>parseInt(getComputedStyle(document.querySelector(".board-art")).zIndex)'),str(w)+'河流在地面之上棋子之下')
  before=page.evaluate('JSON.stringify(state)');page.locator('[data-enemy]').first.click();check(page.locator('.weak-marker').count()>0,str(w)+'选中敌人展开破绽');check(page.evaluate('JSON.stringify(state)')==before,str(w)+'查看不改战局')
  page.keyboard.press('Escape');check(page.locator('.weak-marker,.formation-link').count()==0,str(w)+'取消后恢复安静视图')
  page.locator('[data-action="overview"]').click();check(page.locator('.formation-link').count()>0,str(w)+'全览可比较棋阵');page.locator('[data-action="overview"]').click()
  page.locator('[data-action="overview"]').click();page.locator('[data-action="beaconMove"]').click();page.locator('.cell.legal').first.click();page.wait_for_function('!busy');check(page.evaluate('!state.freeMove'),str(w)+'新分层不阻挡移动点击');check(page.evaluate('overview'),str(w)+'全览在本场操作后保留')
  if w==1440:
   page.evaluate('state=G.newRun({seed:42});resetView();render()');page.screenshot(path=str(root/'work/screenshots/new-route.png'))
   page.evaluate('state=G.enter(state,"1-0-1");G.setup(state,{...state.maps[0][0],formation:"guard_gun"});resetView();render()');page.screenshot(path=str(root/'work/screenshots/quiet-board.png'))
 # The three travel states must remain distinct even with an unrelated legend active.
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h})
  page.evaluate('state=G.newRun({seed:42});const n=state.maps[0][0];n.visited=true;state.nodeId=n.id;state.row=0;state.completed=1;resetView();render()')
  page.locator('[data-map-highlight="elite"]').click()
  check(page.locator('.route-node.available .route-status').all_text_contents()==['可前往']*page.locator('.route-node.available').count(),str(w)+'全部可走点直接标明可前往')
  check(page.evaluate('[...document.querySelectorAll(".route-node.available")].every(e=>getComputedStyle(e).opacity==="1"&&getComputedStyle(e).backgroundColor!==getComputedStyle(document.querySelector(".route-node.locked")).backgroundColor)'),str(w)+'图例不削弱可走点')
  check(page.locator('.route-node.visited .route-done').count()==1,str(w)+'已走地点有独立勾记')
  check(page.locator('.route-lines .next-step').count()==page.locator('.route-node.available').count(),str(w)+'当前可走连线醒目')
  before=page.evaluate('JSON.stringify(state)')
  page.locator('.route-node.current').click()
  check(page.locator('[data-enter]').is_disabled() and page.locator('[data-enter]').inner_text()=='已行过' and '已行过' in page.locator('#toast').inner_text(),str(w)+'已走点击反馈仅供回看')
  page.locator('.route-node.locked.elite').first.click()
  check(page.locator('[data-enter]').is_disabled() and page.locator('[data-enter]').inner_text()=='暂不可前往' and '暂不可前往' in page.locator('#toast').inner_text(),str(w)+'未到地点反馈仅供远望')
  page.locator('.route-node.available').first.click()
  check(page.locator('[data-enter]').is_enabled() and 'visible' not in page.locator('#toast').get_attribute('class'),str(w)+'可走地点选中后允许前往并清除旧提示')
  check(page.evaluate('JSON.stringify(state)')==before,str(w)+'三种查看操作不改旅程')
  if w==1440:
   page.wait_for_function('getComputedStyle(document.querySelector("#toast")).opacity==="0"')
   page.screenshot(path=str(root/'work/screenshots/route-travel-states.png'))
 # Complete an actual room through buttons: the next map forgets the legend.
 page.evaluate('state=G.newRun({seed:42});state.maps[0][0].type="camp";resetView();render()')
 page.locator('[data-map-highlight="elite"]').click();page.locator('[data-enter]').click()
 page.locator('[data-action="heal"]').click();page.locator('[data-action="leave"]').click()
 check(page.locator('[data-map-highlight][aria-pressed="true"]').count()==0 and page.locator('.legend-match,.legend-muted').count()==0,'走完地点返回地图自动清空图例强调')
 check(page.locator('.route-node.available').count()>1 and page.locator('.route-node.selected.available').count()==1,'返回地图默认选择可前往地点')
 # Resize the existing map without recreating the run or clearing the legend.
 page.evaluate('state=G.newRun({seed:42});resetView();render()');page.locator('[data-map-highlight="camp"]').click()
 before=page.evaluate('JSON.stringify(state)')
 for w,h in [(1920,1080),(1440,900),(1366,768),(1280,720),(1440,900)]:
  page.set_viewport_size({'width':w,'height':h})
  page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  check(page.evaluate('[...document.querySelectorAll("[data-map-highlight], [data-enter]")].every(e=>{const b=e.getBoundingClientRect();return b.top>=0&&b.bottom<=innerHeight&&b.left>=0&&b.right<=innerWidth})'),str(w)+'连续缩放图例与前往完整可见')
  check(page.locator('[data-map-highlight="camp"]').get_attribute('aria-pressed')=='true' and page.evaluate('JSON.stringify(state)')==before,str(w)+'连续缩放保留强调与游戏进度')
 # A real fork offers only its linked successors; no enemy type leakage from elite map details.
 page.evaluate('state=G.newRun({seed:42});const n=state.maps[0].find(n=>n.row===1&&n.next.length<state.maps[0].filter(q=>q.row===2).length);state.nodeId=n.id;state.row=n.row;n.visited=true;resetView();render()')
 check(page.evaluate('document.querySelectorAll(".route-node.available").length===J.available(state).length'), '前进选择受实际连线约束')
 page.locator('.route-node.elite').first.click();check(not any(k in page.locator('.node-card').inner_text() for k in ['車馬','砲象','車砲','馬砲','士車','士馬','馬象','卒士']), '险节点隐藏具体融合类型')
 # Locked attacks remain readable by zone, focused path and hover source.
 page.evaluate('state=G.tutorial(2);state.tutorial=false;resetView();render()');before=page.evaluate('JSON.stringify(state)');check(page.locator('.danger').count()>0,'默认当前伤害区域可见')
 idx=page.locator('.danger').first.get_attribute('data-cell');page.locator(f'[data-cell="{idx}"]').hover();check('伤害' in page.locator('.inspect-panel').inner_text(),'悬停危险格显示伤害来源')
 page.locator('[data-enemy]').first.click();check(page.locator('.move-route').count()>0,'选中显示移动路径');check(page.locator('.danger-number').count()>0,'选中显示精确伤害');page.screenshot(path=str(root/'work/screenshots/selected-threat.png'))
 check(page.evaluate('JSON.stringify(state)')==before,'全套查看操作只读');check(not errors,'页面无异常 '+str(errors));b.close()
(root/'work/map-ui-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'checks')
