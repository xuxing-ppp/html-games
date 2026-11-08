"""Expanded scenes, evidence and sound lifecycle acceptance; screenshots stay in temp."""
from pathlib import Path
import json, os, subprocess, tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
KEY='jingshui.magistrate.v1'
OUT=Path(tempfile.mkdtemp(prefix='ming-expanded-qa-'))
FIXTURES=json.loads(subprocess.check_output(['node',str(ROOT/'tests/support/fixtures.mjs')],text=True))
with sync_playwright() as p:
 launch={'headless':True}
 if os.environ.get('MING_BROWSER_PATH'):launch['executable_path']=os.environ['MING_BROWSER_PATH']
 browser=p.chromium.launch(**launch)
 page=browser.new_page(viewport={'width':1440,'height':900})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.add_init_script('''(()=>{const Native=window.AudioContext;window.audioAudit={starts:[],cues:[],peak:0};window.AudioContext=class extends Native{constructor(...args){super(...args);window.auditContext=this;window.auditGains=[];const makeGain=this.createGain.bind(this);this.createGain=()=>{const g=makeGain();auditGains.push(g);return g;};const native=this.createBufferSource.bind(this);this.createBufferSource=()=>{const s=native(),start=s.start.bind(s);s.start=(...args)=>{audioAudit.starts.push({loop:s.loop,duration:s.buffer?.duration});return start(...args)};return s};}}})()''')
 page.goto(os.environ.get('MING_URL',(ROOT/'index.html').as_uri()))
 def load(name,font=20):
  page.evaluate('([k,g,f])=>{localStorage.setItem(k,JSON.stringify(g));localStorage.setItem("jingshui.reading-size",String(f));localStorage.setItem("jingshui.sound",JSON.stringify({music:0,effects:100}))}',[KEY,FIXTURES[name],font])
  page.reload();page.get_by_role('button',name='继续游戏',exact=True).click()
  page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
 def bounds():
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1')
  for selector in ['.dialogue-footer','.puzzle-footer','.game-top']:
   for el in page.locator(selector).all():
    box=el.bounding_box();size=page.viewport_size
    assert box and box['x']>=-1 and box['y']>=-1 and box['x']+box['width']<=size['width']+1 and box['y']+box['height']<=size['height']+1,(selector,box,size)
 scenes=['names-side','boat-side','relief-side','escort-blocked']
 for width,height in [(1440,900),(844,390),(390,844)]:
  page.set_viewport_size({'width':width,'height':height})
  for font in [18,20,22]:
   for name in scenes+['receipt-proof','recant-check','relief-sequence','paper-dates','alibi-scope']:
    load(name,font);bounds()
    if name in scenes and font==20:page.screenshot(path=str(OUT/f'{name}-{width}.png'))
    if width==390 and name in scenes:
     assert '-portrait-ink.webp' in page.locator('.scene-art img').evaluate('(img)=>img.currentSrc')
 # Actual UI history changes produce one action cue, reader and font changes do not repeat it.
 page.set_viewport_size({'width':1440,'height':900});load('escort-blocked')
 page.wait_for_function('window.auditContext?.state==="running"')
 page.wait_for_timeout(700)
 assert page.evaluate('audioAudit.starts.filter(s=>s.loop&&s.duration===12).length')==1
 before=page.evaluate('audioAudit.starts.length')
 page.get_by_role('button',name='字体大小',exact=True).click()
 page.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 assert page.evaluate('audioAudit.starts.length')==before
 page.locator('[data-advance]').click();page.locator('button',has_text='上一段').click()
 assert page.evaluate('audioAudit.starts.length')==before
 # Exercise every added cue and measure the real mixed browser output.
 result=page.evaluate('''async()=>{const ctx=auditContext,analyser=ctx.createAnalyser();analyser.fftSize=2048;const quiet=ctx.createGain();quiet.gain.value=0;analyser.connect(quiet).connect(ctx.destination);auditGains[0].connect(analyser);let peak=0;const data=new Float32Array(2048);const timer=setInterval(()=>{analyser.getFloatTimeDomainData(data);for(const x of data)peak=Math.max(peak,Math.abs(x));},5);for(const cue of ['paper','ledger','slip','sort','select','seal','retry','knock','steps','handover','block']){Ming.sound.play(cue);await new Promise(r=>setTimeout(r,650));}clearInterval(timer);auditGains[0].disconnect(analyser);Ming.sound.set('effects',0);return {peak,volume:Ming.sound.get('effects')};}''')
 assert 0<result['peak']<.9,result
 assert result['volume']==0
 page.reload();assert page.evaluate('Ming.sound.get("effects")')==0
 # Restore effects, background suspension and same-scene re-entry.
 load('boat-side');page.wait_for_timeout(700)
 before=page.evaluate('audioAudit.starts.filter(s=>s.loop&&s.duration===12).length')
 page.evaluate('dispatchEvent(new Event("pagehide"))');page.wait_for_timeout(500)
 page.evaluate('dispatchEvent(new Event("pageshow"))');page.wait_for_timeout(700)
 assert page.evaluate('audioAudit.starts.filter(s=>s.loop&&s.duration===12).length')==before+1
 assert not errors,errors
 print('Expanded visual/audio acceptance passed; peak',round(result['peak'],4),'screenshots',OUT)
 browser.close()
