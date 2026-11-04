"""Every comparison frame fits; actual arrows end with the intended direction."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
shots=root/'work/screenshots'
shots.mkdir(parents=True,exist_ok=True)
checks=[]
def check(value,label):
    assert value,label
    checks.append(label)
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}))
    page=b.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto((root/'index.html').as_uri(),wait_until='networkidle')
    page.evaluate('settings.reduced=true;sound.configure({music:false,sfx:false})')
    for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
        page.set_viewport_size({'width':w,'height':h})
        for i,key in [(2,'intent'),(4,'river'),(5,'weak'),(6,'formation'),(7,'engine')]:
            page.evaluate('key=>openConcept(key)',key)
            for n in range(page.evaluate('demo.frames.length')):
                page.evaluate('n=>{demo.index=n;render()}',n)
                check(page.evaluate('''()=>{const m=document.querySelector('.concept-modal').getBoundingClientRect(),c=document.querySelector('.demo-controls').getBoundingClientRect(),a=document.querySelector('.lesson-stage .board').getBoundingClientRect(),body=document.querySelector('.modal-body');return !(demo.key==='weak'&&demo.frames[demo.index].stage==='result'&&demo.frames[demo.index].step?.key==='end'&&document.querySelector('.lesson-stage .demo-weak'))&&a.height>=180&&a.top>=m.top&&a.bottom<=c.top&&c.bottom<=m.bottom&&body.scrollHeight<=body.clientHeight+2}'''),f'{w} {key} 帧{n+1} 图示和操作完整')
            check(page.locator('.lesson-player .lesson-evidence').count()==(0 if i==7 else 1),f'{w} {key} 结算对比可见')
            if w==1280:
                page.screenshot(path=str(shots/f'comparison-{key}-1280.png'))
            page.locator('[data-action="close"]').click()
            page.evaluate('i=>{window.lessonResults=L.tape(i).filter(f=>f.stage==="result");screen="game"}',i)
            for n in range(page.evaluate('lessonResults.length')):
                page.evaluate('n=>{state=G.clone(lessonResults[n].state);overlay=null;resetView();render()}',n)
                check(page.evaluate('''()=>{const root=document.documentElement;if(root.scrollHeight>innerHeight||root.scrollWidth>innerWidth)return false;const elements=state.phase==='battle'?[document.querySelector('.board'),document.querySelector('.end-button'),...document.querySelectorAll('.lesson-hint .btn')]:[...document.querySelectorAll('.inline-actions .btn')];return elements.every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})}'''),f'{w} {key} 步骤{n+1} 界面完整')
            if w==1280 and i==6:
                page.screenshot(path=str(shots/'comparison-formation-complete.png'))
        page.evaluate('state=G.enter(G.newRun({seed:42}),"1-0-1");screen="game";overlay=null;resetView();render()')
        check('侠与命灯相距' in page.locator('.board-footer').inner_text() and '最多3格' in page.locator('.board-footer').inner_text(),f'{w} 系灯限制使用明确文字')

    page.set_viewport_size({'width':1280,'height':720})
    for dx,dy in [(0,1),(0,-1),(1,0),(-1,0)]:
        page.evaluate('''([dx,dy])=>{const s=G.tutorial(0);s.tutorial=false;s.river=null;s.bridges=[];s.hero.x=6;s.hero.y=7;s.enemies=[G.newEnemy(s,'rook',3,3)];const e=s.enemies[0],dest={x:3+dx*2,y:3+dy*2};e.plan={kind:'rook',origin:{x:3,y:3},aim:{x:6,y:7},targetId:'hero',dir:[dx,dy],strong:false,label:'移动',steps:[{type:'move',path:[{x:3+dx,y:3+dy},dest],dest}]};G.refresh(s);state=s;screen='game';overlay=null;resetView();focused=e.id;render()}''',[dx,dy])
        check(page.evaluate('''([dx,dy])=>{const line=document.querySelector('.move-route'),p=line.points,a=p.getItem(p.numberOfItems-2),b=p.getItem(p.numberOfItems-1);return Math.sign(b.x-a.x)===dx&&Math.sign(b.y-a.y)===dy&&line.getAttribute('marker-end')==='url(#move-arrow)'}''',[dx,dy]),f'实际移动路线朝向 {dx},{dy}')
        check(page.locator('.board-footer').inner_text()=='','没有命灯时不显示无意义距离符号')
        if dy==1:
            page.screenshot(path=str(shots/'comparison-arrow-down.png'))
    check(not errors,'无页面异常 '+str(errors))
    b.close()
print('PASS',len(checks),'comparison and arrow checks')
