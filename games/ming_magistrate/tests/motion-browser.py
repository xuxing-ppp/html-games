"""Normal-motion acceptance: stable overlays, opaque crossfades and cancellation."""
from pathlib import Path
import json,os,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('MING_URL') or (ROOT/'index.html').as_uri()
OUT=Path(tempfile.mkdtemp(prefix='ming-motion-qa-'))
KEY='jingshui.magistrate.v1'
FIXTURES=json.loads(subprocess.check_output(['node',str(ROOT/'tests/support/fixtures.mjs')],cwd=ROOT,text=True))
def ready(page):
 page.wait_for_load_state('load')
 page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
def load(page,name):
 page.evaluate('([key,g])=>{localStorage.setItem(key,JSON.stringify(g));localStorage.setItem("jingshui.reduced-motion","false")}',[KEY,FIXTURES[name]])
 page.reload();ready(page);page.get_by_role('button',name='继续游戏',exact=True).click();ready(page)
def state(page):return page.evaluate('(k)=>JSON.parse(localStorage.getItem(k))',KEY)
def remember(page):page.evaluate('window.oldArt=document.querySelector(".scene-art");window.oldSurface=document.querySelector(".game-shell");window.sceneMotions=[];window.cssMotions=[]')
def still(page,surface=True):
 if page.locator('dialog').count():assert page.locator('dialog').evaluate('(n)=>n.matches(":modal")')
 assert page.evaluate('oldArt===document.querySelector(".scene-art")')
 if surface:assert page.evaluate('oldSurface===document.querySelector(".game-shell")')
 assert page.evaluate('sceneMotions.length+cssMotions.length')==0
 assert page.locator('.scene-outgoing').count()==0
 assert page.evaluate('[...document.getAnimations()].filter(a=>a.effect?.target?.closest(".scene-art")).length')==0
with sync_playwright() as p:
 launch={'headless':True}
 if os.environ.get('MING_BROWSER_PATH'):launch['executable_path']=os.environ['MING_BROWSER_PATH']
 browser=p.chromium.launch(**launch)
 context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='no-preference')
 if URL.startswith('file:'):context.set_offline(True)
 page=context.new_page();errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''window.sceneMotions=[];window.cssMotions=[];
 const nativeAnimate=Element.prototype.animate;
 Element.prototype.animate=function(...args){if(this.closest('.scene-art'))sceneMotions.push({key:this.closest('.scene-art').dataset.artKey,time:performance.now()});return nativeAnimate.apply(this,args);};
 addEventListener('animationstart',e=>{if(e.target.closest('.scene-art,.dialogue-panel,.ending-panel'))cssMotions.push(e.animationName);});''')
 page.goto(URL);ready(page);load(page,'read-original');remember(page);before=state(page)
 for name in ['帮助与设置','操作说明']:
  page.get_by_role('button',name=name,exact=True).click();still(page)
 assert page.locator('.operation-reference>div').count()==3
 assert page.locator('.instructions-copy details').get_attribute('open') is None
 assert len(page.locator('.instructions-copy').inner_text())<150
 page.get_by_text('键盘操作',exact=True).click();still(page)
 page.locator('.library-header').get_by_role('button',name='字体大小',exact=True).click();page.locator('[data-font-size="22"]').click();still(page)
 page.keyboard.press('Escape');assert page.locator('.instructions-copy details').get_attribute('open') is not None;still(page)
 page.keyboard.press('Escape');page.get_by_role('button',name='减少动态效果',exact=True).click();still(page)
 page.get_by_role('button',name='减少动态效果：关',exact=True).click();still(page)
 page.get_by_role('button',name='减少动态效果：开',exact=True).click();still(page)
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();still(page)
 page.locator('[data-person="you"]').click();page.keyboard.press('Escape');still(page)
 page.locator('[data-advance]').click();still(page,surface=False);page.evaluate('oldSurface=document.querySelector(".game-shell")')
 page.locator('[data-term="仓书"]').click();page.keyboard.press('Escape');still(page)
 # Advancing within the same illustrated scene reuses the picture, without replaying motion.
 expected=state(page);page.get_by_role('button',name='回看前文',exact=True).click();page.keyboard.press('Escape');still(page);assert state(page)==expected
 page.get_by_role('button',name='案卷',exact=True).click();page.get_by_role('button',name='史料笺',exact=True).click();page.get_by_role('button',name='创作说明',exact=True).click();still(page)
 creation=page.locator('.library-body');assert creation.locator('p').count()==1
 assert not any(x in creation.inner_text() for x in ['北方任职','唐顺之','不安排','不冒称'])
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();still(page)
 page.get_by_role('button',name='打开舆图',exact=True).click();page.get_by_role('button',name='放大',exact=True).click();still(page)
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();still(page,surface=False)
 load(page,'tutorial-compare');remember(page)
 page.get_by_role('button',name='请求提示',exact=True).click();page.get_by_role('button',name='先给一点方向',exact=True).click();still(page)
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click();still(page)
 page.locator('[data-pair-side="0"][data-pair-field="status"]').click();still(page,surface=False)
 load(page,'names-match');remember(page);page.locator('[data-select-item="n-field"]').click();still(page,surface=False);page.locator('[data-target="north"]').click();still(page,surface=False)
 load(page,'tutorial-order');remember(page);page.locator('.order-tools button:not(:disabled)').first.click();still(page,surface=False)
 print('NORMAL MOTION: settings, reader navigation, type size, terms, hints, map and material operations stay still',flush=True)
 # Collect real animation frames; an opaque loaded old image must cover every blend frame.
 load(page,'life-0');page.locator('[data-choice-value="office"]').click();remember(page)
 page.evaluate('''window.motionFrames=[];window.sampling=true;
 function sample(){const art=document.querySelector('.story-stage>.scene-art');if(art){const layers=[...art.querySelectorAll(':scope>picture')].map(p=>({opacity:Number(getComputedStyle(p).opacity),loaded:p.querySelector('img').complete&&p.querySelector('img').naturalWidth>0}));motionFrames.push({key:art.dataset.artKey,layers});}if(sampling)requestAnimationFrame(sample);}requestAnimationFrame(sample);''')
 page.locator('[data-advance]').click()
 for i in range(5):
  page.locator('.scene-art').screenshot(path=str(OUT/f'transition-{i}.png'),animations='allow');page.wait_for_timeout(20)
 page.wait_for_timeout(260);page.evaluate('sampling=false')
 assert page.evaluate('sceneMotions.length')==1
 frames=page.evaluate('motionFrames.filter(f=>f.key==="hai")');assert len(frames)>5
 assert all(any(p['loaded'] and p['opacity']>=.999 for p in f['layers']) for f in frames),frames
 assert any(any(0<p['opacity']<1 for p in f['layers']) for f in frames),frames
 assert page.locator('.scene-outgoing').count()==0
 print('CROSSFADE: one 220 ms transition; intermediate frames remain covered by a loaded opaque picture',flush=True)
 # Delay decoding while the player continues through multiple scenes, then release out of order.
 load(page,'life-0');page.locator('[data-choice-value="office"]').click()
 page.evaluate('''window.pendingDecodes=[];window.nativeDecode=HTMLImageElement.prototype.decode;
 HTMLImageElement.prototype.decode=function(){const decoded=nativeDecode.call(this);const gate=new Promise(resolve=>pendingDecodes.push(resolve));return Promise.all([decoded,gate]);};window.sceneMotions=[];''')
 page.locator('[data-advance]').click()
 page.evaluate('''for(let i=0;i<4;i++)document.querySelector('[data-advance]').click();document.querySelector('[data-choice-value="relief"]').click();document.querySelector('[data-advance]').click();document.querySelector('[data-advance]').click();''')
 assert state(page)['node']=='boats-intro';assert page.locator('.scene-art').get_attribute('data-art-key')=='granary-audit'
 assert page.evaluate('pendingDecodes.length')>=2
 page.evaluate('()=>{for(const resolve of pendingDecodes.reverse())resolve();HTMLImageElement.prototype.decode=nativeDecode;}')
 page.wait_for_timeout(350);ready(page)
 assert page.locator('.scene-art').get_attribute('data-art-key')=='granary-audit'
 assert page.locator('.scene-outgoing').count()==0
 assert page.evaluate('sceneMotions.map(x=>x.key)')==['granary-audit']
 print('RAPID INPUT: obsolete decodes cannot animate or overwrite the latest scene',flush=True)
 # App and system motion preferences both act immediately, even while a transition is running.
 load(page,'life-0');page.locator('[data-choice-value="office"]').click();page.locator('[data-advance]').click()
 page.emulate_media(reduced_motion='reduce');page.wait_for_function('document.getElementById("root").dataset.reduced==="true"')
 assert page.locator('.scene-outgoing').count()==0
 assert page.evaluate('[...document.getAnimations()].filter(a=>a.effect?.target?.closest(".scene-art")).length')==0
 page.emulate_media(reduced_motion='no-preference');page.wait_for_function('document.getElementById("root").dataset.reduced==="false"')
 load(page,'life-0');page.get_by_role('button',name='帮助与设置',exact=True).click();page.get_by_role('button',name='减少动态效果',exact=True).click();page.get_by_role('button',name='减少动态效果：关',exact=True).click();page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 page.locator('[data-choice-value="office"]').click();page.evaluate('sceneMotions=[]');page.locator('[data-advance]').click();page.wait_for_timeout(260)
 assert page.evaluate('sceneMotions.length')==0 and page.locator('.scene-outgoing').count()==0
 assert not errors,errors
 print('REDUCED MOTION: app setting and live system preference cancel or suppress transitions',flush=True)
 print('ALL MOTION CHECKS PASSED; real transition frames:',OUT,flush=True)
 browser.close()
