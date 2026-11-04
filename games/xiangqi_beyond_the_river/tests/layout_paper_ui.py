"""Three-column board fit and complete ten-card hand reading after scrolling."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}))
    page=browser.new_page(reduced_motion='reduce');errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(os.environ.get('XQ_TEST_URL',(Path(__file__).resolve().parents[1]/'index.html').as_uri()),wait_until='networkidle')
    page.locator('[data-action="new"]').click();page.locator('[data-school="palm"]').click();page.locator('[data-action="depart"]').click();page.locator('[data-enter]').first.click()
    page.evaluate('''()=>{sound.configure({music:false,sfx:false});state.hand=Object.keys(D.cards).slice(0,10).map(k=>J.card(state,k));state.energy=100;render()}''')
    original=page.evaluate('JSON.stringify(state)')
    for w,h in [(1280,720),(1366,768),(1440,900),(1920,1080)]:
        page.set_viewport_size({'width':w,'height':h})
        assert page.evaluate('''()=>{const l=document.querySelector('.player-panel').getBoundingClientRect(),r=document.querySelector('.enemy-panel').getBoundingClientRect(),b=document.querySelector('.board').getBoundingClientRect(),h=document.querySelector('.board-host').getBoundingClientRect();return b.left>=l.right&&b.right<=r.left&&b.top>=h.top-.5&&b.bottom<=h.bottom+.5&&Math.min(h.width/b.width,h.height/b.height)<1.02}'''),(w,h,'board fit')
        for i in range(10):
            expected=page.evaluate('i=>G.cardInfo(state.hand[i],state).name',i)
            page.locator(f'[data-card="{i}"] h3').hover()
            page.wait_for_function('name=>document.querySelector("#card-peek h3")?.textContent===name',arg=expected)
            assert page.locator('#card-peek .peek-rules').inner_text()==page.evaluate('i=>cardText(state.hand[i])',i)
        assert page.evaluate('JSON.stringify(state)')==original
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight')
    assert not errors,errors
    browser.close()
print('PASS: three columns, board fills available space, all ten cards readable after scrolling, reading preserves game state.')
