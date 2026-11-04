"""Practice returns to its source and cannot leak a course into the next visit."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b=p.chromium.launch(headless=True,**({'executable_path':os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}))
    page=b.new_page(viewport={'width':1280,'height':720})
    page.goto((Path(__file__).resolve().parents[1]/'index.html').as_uri(),wait_until='networkidle')
    page.evaluate('settings.reduced=true;sound.configure({music:false,sfx:false})')
    def click(q):
        page.locator(q).first.click()
        page.wait_for_function('!busy')
    click('[data-action="new"]')
    click('[data-school="finger"]')
    click('[data-action="trial"]')
    assert page.locator('[data-action="leave-practice"]').inner_text()=='返回选派'
    click('[data-lesson="7"]')
    assert page.evaluate('state.school')=='palm'
    click('[data-action="tutorial-menu"]')
    click('[data-action="leave-practice"]')
    assert page.evaluate('screen==="school"&&schoolChoice==="finger"&&state===null')
    click('[data-action="trial"]')
    click('[data-lesson="0"]')
    click('[data-action="menu"]')
    click('[data-action="home"]')
    assert page.evaluate('screen==="home"&&state===null&&practiceReturn===null')
    click('[data-action="tutorial-menu"]')
    assert page.locator('[data-action="leave-practice"]').inner_text()=='返回标题'
    click('[data-action="leave-practice"]')
    page.evaluate('state=G.enter(G.newRun({seed:42}),"1-0-1");screen="game";save();render();window.originalRun=JSON.stringify(state);openPracticeLibrary()')
    click('[data-lesson="4"]')
    click('[data-action="menu"]')
    click('[data-action="home"]')
    assert page.evaluate('screen==="home"&&JSON.stringify(state)===originalRun&&practiceReturn===null')
    click('[data-action="continue"]')
    assert page.evaluate('screen==="game"&&JSON.stringify(state)===originalRun')
    b.close()
print('PASS 7 practice navigation checks')
