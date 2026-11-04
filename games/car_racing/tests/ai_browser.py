import os
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,**({'executable_path':os.environ['KART_BROWSER_PATH']} if os.environ.get('KART_BROWSER_PATH') else {}),args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':960,'height':540});page.add_init_script('window.requestAnimationFrame=()=>0');page.goto(os.environ.get('KART_TEST_URL','http://localhost:8000'),wait_until='networkidle');page.evaluate("async()=>{window.g=await import('/src/game.js');window.T=await import('/lib/three.module.js')}")
 page.evaluate('g.SETTINGS.laps=1;g.SETTINGS.diff="normal"')
 for i in range(12):
  page.locator(f'[data-track-jump="{i}"]').dispatch_event('click');page.locator('#startBtn').dispatch_event('click')
  result=page.evaluate('''()=>{
    for(let n=0;n<220;n++)g.updateSimulation(1/60);
    g.karts[0].isPlayer=false;g.karts[0].isAI=true;
    const dummy={mesh:{visible:false},pos:new T.Vector3(1e6,0,1e6),isPlayer:true,finished:false,motion:'grounded',coins:0,driftScore:0,combo:1,speed:0,feedback:'',feedbackTimer:0,routeId:'main',lateral:0};g.karts.push(dummy);
    for(let n=0;n<120*240&&!g.karts.slice(0,8).every(k=>k.finished);n++)g.updateSimulation(1/120);
    g.karts.pop();const result=g.karts.map(k=>({finished:k.finished,rescues:k.rescues,s:Math.round(k.roadS),route:k.routeId}));g.karts[0].isPlayer=true;g.karts[0].isAI=false;return result;
  }''')
  print('PASS eight AI on course',i,flush=True);assert all(k['finished'] for k in result),(i,result)
  page.evaluate('g.backToMenu()')
 b.close()
