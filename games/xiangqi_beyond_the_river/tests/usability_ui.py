import os
"""Regressions reported by players: grid/river, contextual help, mover switching, card reading."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1];(root/'work/screenshots').mkdir(parents=True,exist_ok=True)
checks=[]
def check(v,label):
 assert v,label
 checks.append(label)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle');page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')
 def inject(expr):page.evaluate('state='+expr+';screen="game";overlay=null;resetView();render()')
 def click(q):page.locator(q).first.click();page.wait_for_function('!busy')
 for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
  page.set_viewport_size({'width':w,'height':h})
  for chapter in [1,2,3]:
   for layout in page.evaluate(f'D.chapters[{chapter-1}].layouts'):
    inject(f'(()=>{{const s=G.newRun({{seed:42}});s.chapter={chapter};G.setup(s,{{...s.maps[{chapter-1}].find(n=>n.type==="battle"),layout:{json.dumps(layout)}}});return s}})()')
    check(page.evaluate('document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth'),f'{w} {layout} 无页面滚动')
    check(page.evaluate('(()=>{const r=document.querySelector(".cell:not(.void)").getBoundingClientRect();return Math.abs(r.width-r.height)<1})()'),f'{w} {layout} 真正方格')
    check(page.evaluate('(()=>{const n=state.river,up=document.querySelector(`[data-cell="${n*state.width+2}"]`).getBoundingClientRect(),down=document.querySelector(`[data-cell="${(n+1)*state.width+2}"]`).getBoundingClientRect(),band=document.querySelector(".river-band").getBoundingClientRect();const px=up.height*.7;return Math.abs(down.top-up.bottom-px)<1&&Math.abs(band.y-(up.bottom+px/2))<1})()'),f'{w} {layout} 河道位于两岸间隔')
    check(page.locator('.ground-links').count()==0,f'{w} {layout} 无旧交点连线')
  inject('G.enter(G.newRun({seed:42}),"1-0-1")');before=page.evaluate('JSON.stringify(state)')
  hero=page.evaluate('state.hero.y*state.width+state.hero.x');lamp=page.evaluate('state.beacon.y*state.width+state.beacon.x')
  click(f'[data-cell="{hero}"]');check(page.evaluate('selection')=='move',f'{w} 点击侠进入行步')
  click(f'[data-cell="{lamp}"]');check(page.evaluate('selection')=='beaconMove',f'{w} 侠切灯')
  click(f'[data-cell="{lamp}"]');check(page.evaluate('selection') is None,f'{w} 再点灯取消')
  click(f'[data-cell="{lamp}"]');click(f'[data-cell="{hero}"]');check(page.evaluate('selection')=='move',f'{w} 灯切侠')
  click(f'[data-cell="{hero}"]');check(page.evaluate('selection') is None,f'{w} 再点侠取消')
  check(page.evaluate('JSON.stringify(state)')==before,f'{w} 切换取消不消耗资源')
  click('[data-action="field-inspect"]');check(page.locator('.overlay').count()==0,f'{w} 涨潮不弹教学');check('涨潮' in page.locator('.inspect-panel').inner_text() and '3' in page.locator('.inspect-panel').inner_text(),f'{w} 涨潮说明具体伤害');check(page.locator('.field-warning').count()>0,f'{w} 涨潮标出实际位置');check(page.evaluate('JSON.stringify(state)')==before,f'{w} 场地查看不改局面')
  click('[data-action="field-inspect"]')
  shrine=page.evaluate('state.shrines[0].y*state.width+state.shrines[0].x');click(f'[data-cell="{shrine}"]');check(page.locator('.overlay').count()==0 and '灵台' in page.locator('.inspect-panel').inner_text() and '1气' in page.locator('.inspect-panel').inner_text(),f'{w} 灵台直接显示用途');check(page.get_by_text('查看场地规则',exact=True).count()==0,f'{w} 去除重复泛用入口')
  # Hand crafted fixed hand, no resources or actions changed by inspection.
  page.evaluate('state.hand=["impact","boat","jab","jab","push"].map(k=>J.card(state,k));resetView();render()');before=page.evaluate('JSON.stringify(state)')
  page.locator('[data-card="1"]').hover();page.wait_for_selector('#card-peek');check('未用则保留' in page.locator('#card-peek').inner_text(),f'{w} 悬停显示回舟全文')
  page.locator('[data-card="3"]').hover();page.wait_for_function('document.querySelector("#card-peek h3")?.textContent==="试锋"');check(page.locator('#card-detail').count()==0,f'{w} 只保留浮动完整说明')
  card_id=page.evaluate('state.hand[1].id');click(f'[data-read-card="{card_id}"]');check(page.locator('.full-card-text').inner_text()==page.evaluate('cardText(state.hand[1])'),f'{w} 固定详情显示完整效果');check(page.evaluate('JSON.stringify(state)')==before,f'{w} 看卡不出牌')
  check(page.evaluate('(()=>{const p=document.querySelector(".full-card-text"),m=document.querySelector(".modal");return p.scrollHeight<=p.clientHeight&&m.getBoundingClientRect().bottom<=innerHeight})()'),f'{w} 详情完整无需局部滚动')
  click('[data-action="close"]');click('[data-card="1"]');selected=page.evaluate('selection');page.locator('[data-card="3"]').hover();page.wait_for_selector('#card-peek');check(page.evaluate('selection')==selected,f'{w} 悬停不改变待出牌');page.keyboard.press('Escape')
 # Verify drawn paths and effects use the same coordinates as their target cell.
 page.set_viewport_size({'width':1440,'height':900});inject('G.tutorial(2)');page.evaluate('state.tutorial=false;render()');click('[data-enemy]')
 check(page.evaluate('(()=>{const r=document.querySelector(".move-route"),a=state.enemies[0].intent.routes.find(q=>q.kind==="move"),point=r.points.getItem(r.points.numberOfItems-1),g=V.geometry(state).center(a.to);return point.x===g.x&&point.y===g.y})()'),'渡河路径落点与方格中心一致')
 page.screenshot(path=str(root/'work/screenshots/river-gap.png'))
 # Hit numbers on the south bank: pixel y must include river spacing.
 page.evaluate('fx([{type:"hit",unit:"hero",amount:3,at:{...state.hero}}],state)');check(page.evaluate('(()=>{const p=document.querySelector(".hit-float"),g=V.geometry(state),expected=(g.top(state.hero.y)/100+.2)*document.querySelector(".board").clientHeight/g.rows;return Math.abs(parseFloat(p.style.top)-expected)<1})()'),'受击数字包含河道间隔')
 # No river and a planned river shift remain aligned and usable.
 inject('(()=>{const s=G.tutorial(2);s.tutorial=false;s.river=null;s.bridges=[];G.refresh(s);return s})()');check(page.locator('.river-art').count()==0,'无河场地不插河道');check(page.evaluate('V.geometry(state).rows===state.height'),'无河无多余空行')
 inject('(()=>{const s=G.tutorial(2);s.tutorial=false;s.chapter=3;s.fieldPlan={kind:"river",due:2,river:2,cells:[]};return s})()');click('[data-action="field-inspect"]');check('移河' in page.locator('.inspect-panel').inner_text() and page.locator('.river-shift').count()==1 and page.locator('.overlay').count()==0,'移河就地说明与落线')
 check(not errors,'页面无异常 '+str(errors));b.close()
(root/'work/usability-checks.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'checks')
