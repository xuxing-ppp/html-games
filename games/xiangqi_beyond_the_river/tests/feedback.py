import os
"""Actual animation and feedback checks; run after the main rules and UI suite."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json
root=Path(__file__).resolve().parents[1]
(root/'work/screenshots').mkdir(parents=True,exist_ok=True)
checks=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}));page=b.new_page(viewport={'width':1440,'height':900});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto((root/'index.html').as_uri());page.wait_for_load_state('networkidle');page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=false;settings.speed=1')
 page.screenshot(path=str(root/'work/screenshots/title-final.png'))
 page.evaluate('state=G.tutorial(2);state.tutorial=false;screen="game";overlay=null;resetView();render()');before=page.evaluate('JSON.stringify(state)');page.locator('[data-action="preview"]').click();page.locator('[data-action="frame-next"]').click();page.locator('[data-action="move"]').click();assert page.evaluate('!previewMode&&selection==="move"');assert page.evaluate('JSON.stringify(state)')==before;page.keyboard.press('Escape');checks.append('选择实战操作退出预演，不在未来棋面误出招')
 page.evaluate('state=G.tutorial(3);state.tutorial=false;screen="game";overlay=null;resetView();render()')
 page.locator('[data-card="0"]').click();page.locator('[data-cell="31"]').click()
 page.wait_for_selector('.player-strike');assert page.locator('.death-echo').count()>0;assert page.locator('.impact-ring.explode').count()>0;assert page.locator('.hit-float').count()>0
 page.screenshot(path=str(root/'work/screenshots/attack-feedback.png'));checks.append('玩家轨迹、死亡折纸、爆符与逐次伤害可见');page.wait_for_function('!busy')
 page.evaluate('state=G.tutorial(1);state.tutorial=false;screen="game";overlay=null;resetView();render()')
 page.locator('[data-card="0"]').click();page.wait_for_function('!busy');hp=page.evaluate('state.hero.hp');page.locator('[data-action="end"]').click()
 page.wait_for_selector('.shield-shatter',timeout=10000);assert page.locator('.strike-svg').count()>0;assert page.locator('.intent-chip.active').count()==1
 page.screenshot(path=str(root/'work/screenshots/enemy-feedback.png'));checks.append('敌人行动者、攻击轨迹与护盾破裂按步骤可见');page.wait_for_function('!busy');assert page.evaluate('state.hero.hp')==hp;checks.append('动画结算与预演相同，无重复伤害')
 for chapter,layout in [(1,'曲岸'),(2,'环堡'),(3,'十字')]:
  page.evaluate('([c,layout])=>{const s=G.newRun({school:"palm",seed:42});s.chapter=c;s.pathKey="wallpalm";s.tier=c;const n={...s.maps[c-1].find(n=>n.type==="elite"),layout};G.setup(s,n);state=s;screen="game";overlay=null;resetView();render()}',[chapter,layout]);page.screenshot(path=str(root/f'work/screenshots/arena-chapter-{chapter}.png'))
 page.evaluate('state.pathKey="sealpoint";state.school="finger";state.tier=3;overlay="path-demo";render()');page.screenshot(path=str(root/'work/screenshots/path-demo.png'))
 assert not errors,errors
 checks.append('三章场景与当前阶位演练可展示');(root/'work/feedback.json').write_text(json.dumps(checks,ensure_ascii=False,indent=2));print('PASS',len(checks),'feedback checks');b.close()
