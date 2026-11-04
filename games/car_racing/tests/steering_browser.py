"""Verify actual keyboard directions against the chase camera's screen-right vector."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['KART_BROWSER_PATH']} if os.environ.get('KART_BROWSER_PATH') else {}),args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
    page=browser.new_page(viewport={'width':1280,'height':720});page.add_init_script('window.requestAnimationFrame=()=>0')
    page.goto(os.environ.get('KART_TEST_URL','http://127.0.0.1:8000'),wait_until='networkidle')
    page.evaluate("async()=>{window.g=await import('/src/game.js');window.d=await import('/src/world/driving.js');window.c=await import('/src/world/course.js');window.T=await import('/lib/three.module.js')}")
    page.locator('[data-track-jump="0"]').click();page.locator('[data-event="time"]').click()
    for mode in ['1p','2p']:
        page.locator(f'[data-mode="{mode}"]').click();page.locator('#startBtn').click();page.evaluate('for(let n=0;n<240;n++)g.updateSimulation(1/60)')
        for player,left,right in ([(0,'ArrowLeft','ArrowRight'),(0,'KeyA','KeyD')] if mode=='1p' else [(0,'ArrowLeft','ArrowRight'),(1,'KeyA','KeyD')]):
            for surface in ['grounded','airborne']:
                results={}
                for key in [left,right]:
                    page.evaluate('''({player,surface})=>{
                        for(const key in g.keys)g.keys[key]=false;
                        const k=g.karts[player],course=g.world.course;
                        d.resetDriver(k,course,course.main.jumps[0].s-45);k.speed=35;k.steer=0;
                        if(surface==='airborne'){k.motion='airborne';k.airTime=.2;k.pos.addScaledVector(k.frame.up,6);k.velocity.copy(k.frame.forward).multiplyScalar(35);}
                        g.updateCamera(g.cam1,k,1);g.cam1.updateMatrixWorld(true);
                        window.screenRight=new T.Vector3().setFromMatrixColumn(g.cam1.matrixWorld,0);window.start=k.pos.clone();
                    }''',{'player':player,'surface':surface})
                    page.keyboard.down(key);page.evaluate('for(let n=0;n<36;n++)g.updateSimulation(1/120)');page.keyboard.up(key)
                    results[key]=page.evaluate('(i)=>g.karts[i].pos.clone().sub(start).dot(screenRight)',player)
                assert results[left]<-.15 and results[right]>.15,(mode,player,surface,results)
                print('PASS',mode,'P'+str(player+1),surface,results,flush=True)
        page.evaluate('g.backToMenu()')
    # Capture a real left-key turn, using the game camera and model orientation.
    page.locator('[data-mode="1p"]').click();page.locator('#startBtn').click();page.evaluate('for(let n=0;n<240;n++)g.updateSimulation(1/60)')
    page.evaluate('d.resetDriver(g.karts[0],g.world.course,g.world.course.main.jumps[0].s-45);g.karts[0].speed=35')
    page.keyboard.down('ArrowLeft');page.evaluate('for(let n=0;n<36;n++)g.updateSimulation(1/120)');page.keyboard.up('ArrowLeft');page.evaluate('g.updateCamera(g.cam1,g.karts[0],1);g.renderScene(.016)')
    out=Path('/tmp/kart-steering');out.mkdir(exist_ok=True);page.screenshot(path=str(out/'left-turn.png'));browser.close()
