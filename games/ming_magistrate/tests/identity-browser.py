"""Check actor identity across scene, profile, index, recap and original-document entry."""
from pathlib import Path
import os,json,subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
KEY='jingshui.magistrate.v1'
URL=os.environ.get('MING_URL',(ROOT/'index.html').as_uri())
OUT=Path(tempfile.mkdtemp(prefix='ming-identity-qa-'))
SCENES=['names-intro','north-visit','south-visit','names-close','lu-dock','relief-intro','relief-visit','confession-intro','trial-intro']
script="import{M,campaign,step}from'./tests/support/game.mjs';const out={};for(const id of "+json.dumps(SCENES)+")out[id]=campaign({until:id}).game;out.office=campaign({exploreOrder:['scribe','courier','markets']}).game;console.log(JSON.stringify(out));"
FIXTURES=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],cwd=ROOT,text=True))
def ready(p):p.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
def load(p,scene,font=20):
 p.evaluate('([k,g,f])=>{localStorage.setItem(k,JSON.stringify(g));localStorage.setItem("jingshui.reading-size",String(f));localStorage.setItem("jingshui.reduced-motion","true")}',[KEY,FIXTURES[scene],font]);p.reload();ready(p)
 p.evaluate('(()=>{const old=Ming.Library;Ming.Library=v=>{window.identityView=v;return old(v)}})()')
 p.get_by_role('button',name='继续游戏',exact=True).click();ready(p)
def open_page(p,kind,args={}):p.evaluate('([type,args])=>{identityView.close();identityView.push(type,args)}',[kind,args]);ready(p)
with sync_playwright() as pw:
 launch={'headless':True}
 if os.environ.get('MING_BROWSER_PATH'):launch['executable_path']=os.environ['MING_BROWSER_PATH']
 b=pw.chromium.launch(**launch);ctx=b.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
 if URL.startswith('file:'):ctx.set_offline(True)
 p=ctx.new_page();errors=[];p.on('pageerror',lambda e:errors.append(str(e)));p.goto(URL);ready(p)
 for w,h in [(1440,900),(390,844),(844,390)]:
  p.set_viewport_size({'width':w,'height':h})
  for font in [18,20,22]:
   for scene in SCENES:
    load(p,scene,font)
    key=p.locator('.scene-art').get_attribute('data-art-key')
    source=p.locator('.scene-art img').evaluate('(n)=>n.currentSrc')
    expected=p.evaluate('(key)=>{const a=Ming.artCatalog[key],portrait=matchMedia("(max-width:600px) and (min-height:520px), (max-width:1100px) and (max-height:519px)").matches;return (portrait&&a.portrait?a.portrait:a.file)+".webp"}',key)
    assert source.endswith(expected),(scene,w,source,expected)
    advance=p.locator('[data-advance]').bounding_box();assert advance['y']+advance['height']<=h+1
    if scene=='names-close':assert p.locator('.scene-location>span').inner_text()=='北渡'
    if font==20:p.screenshot(path=str(OUT/f'{scene}-{w}.png'))
  print('SCENE IDENTITIES',w,h,'3 sizes passed',flush=True)
 p.set_viewport_size({'width':1280,'height':900});load(p,'names-intro')
 p.locator('[data-advance]').click();p.locator('[data-advance]').click()
 assert p.locator('[data-person="north"] strong').inner_text()=='吴长生'
 assert p.locator('[data-person="north"] .speaker-role').inner_text()=='北渡农户'
 p.locator('[data-person="north"]').click();assert p.locator('#library-title').inner_text()=='吴长生';assert p.locator('.person-role').inner_text()=='北渡农户'
 north=p.locator('.portrait svg').evaluate('(n)=>n.outerHTML');p.get_by_role('button',name='关闭查阅，回到游戏',exact=True).click()
 load(p,'office');before=p.evaluate('(k)=>localStorage.getItem(k)',KEY)
 p.get_by_role('button',name='案卷',exact=True).click();p.get_by_role('button',name='人物与往来',exact=True).click()
 for person,role in [('north','北渡农户'),('south','南桥农户')]:
  entry=p.locator('[data-person-id="'+person+'"]');assert entry.locator('strong').inner_text()=='吴长生';assert entry.locator('span').inner_text()==role
  entry.click();assert p.locator('#library-title').inner_text()=='吴长生';assert p.locator('.person-role').inner_text()==role
  if person=='north':assert p.locator('.portrait svg').evaluate('(n)=>n.outerHTML')==north
  p.get_by_role('button',name='← 返回人物与往来',exact=True).click();assert entry.evaluate('(n)=>n===document.activeElement')
 open_page(p,'person',{'id':'tenant'});assert p.locator('#library-title').inner_text()=='吴秋娘';assert p.locator('.portrait svg').evaluate('(n)=>n.outerHTML')!=north
 open_page(p,'recap',{'scene':'names-intro'});assert '吴长生 · 北渡农户' in p.locator('.recap-copy').inner_text()
 open_page(p,'document',{'id':'tax_receipt'});link=p.locator('.document-person');assert link.inner_text()=='吴长生 · 北渡农户';link.click();assert p.locator('.person-role').inner_text()=='北渡农户'
 p.get_by_role('button',name='← 返回材料原文',exact=True).click();assert p.locator('.document-person').evaluate('(n)=>n===document.activeElement')
 assert p.evaluate('(k)=>localStorage.getItem(k)',KEY)==before
 # Inspect all production SVG portraits side by side without substituting a different renderer.
 p.evaluate('''()=>{identityView.close();const gallery=Ming.el('section',{className:'identity-qa-gallery'},Object.keys(Ming.people).map(id=>Ming.el('div',null,Ming.Portrait({person:id}),Ming.el('p',null,Ming.personCaption(id)))));gallery.style.cssText='position:fixed;inset:0;z-index:99999;overflow:auto;display:grid;grid-template-columns:repeat(6,1fr);background:#f5f1e6;padding:15px;gap:10px';document.body.append(gallery);}''')
 p.screenshot(path=str(OUT/'portrait-identities.png'))
 assert not errors,errors
 print('ALL IDENTITY CHECKS PASSED; screenshots:',OUT,flush=True);b.close()
