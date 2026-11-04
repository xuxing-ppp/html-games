"""Check the copied source/delivery with their actual file:// entry points."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, sys
roots=[Path(x).resolve() for x in sys.argv[1:]] or [Path(__file__).resolve().parents[1]]
reports=[]
with sync_playwright() as p:
    b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}))
    for root in roots:
        errors=[]
        page=b.new_page(viewport={'width':1280,'height':720})
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto((root/'index.html').as_uri())
        page.wait_for_load_state('networkidle')
        assert 'Xiangqi: Beyond the River' in page.title()
        assert page.locator('[data-action="legacy"]').count()==0
        page.locator('[data-action="new"]').click()
        page.locator('[data-school="palm"]').click()
        page.locator('[data-action="depart"]').click()
        assert page.evaluate('J.total(state)')==36
        assert page.locator('.arena-outline').count()==0
        page.locator('[data-enter]').first.click()
        page.wait_for_function('state?.phase==="battle"')
        assert page.evaluate('!!state.beacon')
        assert page.evaluate('[...document.querySelectorAll(".battle-controls button")].every(e=>e.closest(".player-panel"))')
        assert page.evaluate('document.querySelector(".end-button").getBoundingClientRect().bottom<=innerHeight')
        before=page.evaluate('JSON.stringify(state)')
        hero=page.evaluate('state.hero.y*state.width+state.hero.x')
        lamp=page.evaluate('state.beacon.y*state.width+state.beacon.x')
        page.locator(f'[data-cell="{hero}"]').click()
        assert page.evaluate('selection')=='move'
        page.locator(f'[data-cell="{lamp}"]').click()
        assert page.evaluate('selection')=='beaconMove'
        page.locator(f'[data-cell="{lamp}"]').click()
        assert page.evaluate('selection') is None
        assert page.evaluate('JSON.stringify(state)')==before
        page.locator('[data-action="field-inspect"]').click()
        assert page.locator('.overlay').count()==0
        assert '涨潮' in page.locator('.inspect-panel').inner_text()
        page.locator('[data-action="field-inspect"]').click()
        page.locator('[data-read-card]').first.click()
        assert page.locator('.full-card-text').inner_text()
        assert page.evaluate('JSON.stringify(state)')==before
        page.locator('[data-action="close"]').click()
        assert page.locator('.ground-links').count()==0
        assert page.evaluate('(()=>{const r=state.river,w=state.width,a=document.querySelector(`[data-cell="${r*w}"]`).getBoundingClientRect(),b=document.querySelector(`[data-cell="${(r+1)*w}"]`).getBoundingClientRect();return b.top-a.bottom>20&&Math.abs(a.width-a.height)<1})()')
        page.locator('[data-action="beaconMove"]').click()
        page.locator('.cell.legal').first.click()
        page.wait_for_function('!busy')
        before=page.evaluate('JSON.stringify(state)')
        page.reload();page.wait_for_load_state('networkidle')
        page.locator('[data-action="continue"]').click()
        assert page.evaluate('JSON.stringify(state)')==before
        assert not errors, errors
        assert not (root/'legacy-v2').exists()
        assert (root/'index.html').exists()
        assert not (root/'game/index.html').exists()
        reports.append({'root':str(root),'fileEntry':True,'expandedRoute':True,'hiddenEncounter':True,'leftControls':True,'lampMoveAndReload':True,'riverGap':True,'unitSwitchCancel':True,'contextualFieldAndCardReader':True,'errors':errors})
        page.close()
    b.close()
for root in roots:
    (root/'work/reports').mkdir(parents=True,exist_ok=True)
    (root/'work/reports/final-smoke.json').write_text(json.dumps(reports,ensure_ascii=False,indent=2))
print(json.dumps(reports,ensure_ascii=False,indent=2))
