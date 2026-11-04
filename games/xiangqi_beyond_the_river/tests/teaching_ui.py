"""Guided lessons, animated help, state restoration, and player controls in four desktop sizes."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
shots = root / 'work/screenshots'
shots.mkdir(parents=True, exist_ok=True)
checks = []

def check(value, label):
    assert value, label
    checks.append(label)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, **({'executable_path': os.environ['XQ_BROWSER_PATH']} if os.environ.get('XQ_BROWSER_PATH') else {}))
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto((root / 'index.html').as_uri(), wait_until='networkidle')
    page.evaluate('sound.configure({music:false,sfx:false});settings.reduced=true')

    def click(selector):
        page.locator(selector).first.click()
        page.wait_for_function('!busy')

    def fit(label):
        check(page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight'), label + ' 无整页滚动')

    def normal():
        page.evaluate('state=G.enter(G.newRun({seed:42,school:"palm"}),"1-0-1");screen="game";overlay=null;state.hand=Object.keys(D.cards).slice(0,10).map(k=>J.card(state,k));state.energy=20;state.momentum=3;resetView();render()')

    for w, h in [(1280, 720), (1366, 768), (1440, 900), (1920, 1080)]:
        page.set_viewport_size({'width': w, 'height': h})
        normal()
        fit(f'{w} 战斗')
        check(page.locator('#card-detail').count() == 0, f'{w} 无重复效果区')
        check(page.locator('.enemy-footer,.optional-trial').count() == 0, f'{w} 无常驻教程与试招')
        check(page.locator('.player-panel .lamp-arts button').count() == 3, f'{w} 三诀在左')
        check(page.locator('.enemy-panel .lamp-arts').count() == 0, f'{w} 右侧仅敌情与实战规则')
        check(page.evaluate('''()=>{const p=document.querySelector('.player-panel').getBoundingClientRect();return [...document.querySelectorAll('.battle-controls button')].every(e=>{const r=e.getBoundingClientRect();return r.top>=p.top&&r.bottom<=innerHeight&&r.left>=p.left&&r.right<=p.right})}'''), f'{w} 玩家操作完整可见')
        for i in range(10):
            page.locator(f'[data-card="{i}"]').hover()
            expected = page.evaluate('i=>G.cardInfo(state.hand[i],state).name', i)
            page.wait_for_function('name=>document.querySelector("#card-peek h3")?.textContent===name', arg=expected)
            check(page.locator('.peek-rules').inner_text() == page.evaluate('i=>cardText(state.hand[i])', i), f'{w} 第{i+1}张牌全文可读')
        page.evaluate('selection=state.hand.findIndex(c=>c.key==="slash");focused=state.enemies[0].id;inspectCell=1;render();document.querySelector(".hand-grid").scrollTop=200')
        original = page.evaluate('JSON.stringify(state)')
        view = page.evaluate('JSON.stringify({selection,focused,inspectCell,overview,previewMode,forecastIndex,scroll:document.querySelector(".hand-grid").scrollTop})')
        click('[data-action="help"]')
        check(page.locator('.help-grid [data-concept]').count() == 8, f'{w} 八项帮助')
        for key in ['action', 'beacon', 'intent', 'terrain', 'river', 'weak', 'formation', 'engine']:
            click(f'.help-grid [data-concept="{key}"]')
            fit(f'{w} {key} 帮助')
            check(page.locator('.lesson-stage .board').count() == 1, f'{w} {key} 单棋盘')
            check(page.evaluate('''()=>{const m=document.querySelector('.concept-modal').getBoundingClientRect(),c=document.querySelector('.demo-controls').getBoundingClientRect(),b=document.querySelector('.lesson-stage .board').getBoundingClientRect();return m.top>=0&&m.bottom<=innerHeight&&c.bottom<=m.bottom&&b.height>=190&&b.top>=m.top&&b.bottom<=c.top}'''), f'{w} {key} 棋盘与播放器可见')
            click('[data-action="demo-next"]')
            check(page.evaluate('demo.index') == 1, f'{w} {key} 可逐步查看')
            click('[data-action="demo-prev"]')
            check(page.evaluate('demo.index') == 0, f'{w} {key} 可返回上一步')
            if key == 'engine':
                for variant in ['ultimate', 'lampGuard', 'lampDraw', 'lampEnergy']:
                    click(f'[data-demo-variant="{variant}"]')
                    click('[data-action="demo-next"]')
                    check(page.evaluate('demo.frames[demo.index].state.momentum') == 0, f'{w} {variant} 实际扣势')
                    check(page.evaluate('JSON.stringify(state)') == original, f'{w} {variant} 不改对局')
            if w == 1280 and key == 'weak':
                page.screenshot(path=str(shots / 'teaching-help-1280.png'))
            click('[data-action="help-back"]')
            check(page.locator('.help-grid').count() == 1, f'{w} {key} 返回帮助目录')
        click('[data-action="close"]')
        check(page.evaluate('JSON.stringify(state)') == original, f'{w} 帮助不改对局')
        check(page.evaluate('JSON.stringify({selection,focused,inspectCell,overview,previewMode,forecastIndex,scroll:document.querySelector(".hand-grid").scrollTop})') == view, f'{w} 恢复选牌敌情和手牌位置')
        click('[data-action="menu"]')
        click('[data-action="log"]')
        check(page.locator('.trial-record').count() == 1, f'{w} 试招可在记录中查看')
        click('[data-action="close"]')
        page.screenshot(path=str(shots / f'teaching-battle-{w}.png'))
        original = page.evaluate('JSON.stringify(state)')
        page.evaluate('openPracticeLibrary()')
        check(page.locator('.lesson-grid [data-lesson]').count() == 8, f'{w} 八课练习')
        check(page.locator('.lesson-tabs,[data-school]').count() == 0, f'{w} 无牌组选择')
        fit(f'{w} 练习目录')
        for i in range(8):
            click(f'[data-lesson="{i}"]')
            fit(f'{w} 第{i+1}课')
            check(page.locator('.lesson-required').count() == 1, f'{w} 第{i+1}课指定操作清楚')
            if w == 1280 and i == 4:
                page.screenshot(path=str(shots / 'teaching-practice-1280.png'))
            click('[data-action="tutorial-menu"]')
        click('[data-action="leave-practice"]')
        check(page.evaluate('JSON.stringify(state)') == original, f'{w} 返回原对局')

    # Execute every exercise through the same buttons as a player.
    page.set_viewport_size({'width': 1280, 'height': 720})
    page.evaluate('openPracticeLibrary()')
    for i in range(8):
        click(f'[data-lesson="{i}"]')
        initial = page.evaluate('JSON.stringify(state)')
        page.evaluate('apply("ultimate",6,7)')
        check(page.evaluate('JSON.stringify(state)') == initial, f'第{i+1}课拒绝错误操作')
        while page.evaluate('state.phase') == 'battle':
            step = page.evaluate('L.current(state)')
            old = page.evaluate('JSON.stringify(state)')
            cursor = page.evaluate('state.lessonCursor')
            if step['kind'] == 'inspect':
                click(f'[data-enemy="{step["unit"]}"]')
            elif step['kind'] == 'forecast':
                click('[data-action="preview"]')
            elif step['kind'] == 'reset':
                click('[data-action="lesson-reset-scene"]')
            elif step['kind'] == 'field':
                click('[data-action="field-inspect"]')
            elif step['key'] == 'end':
                click('[data-action="end"]')
            else:
                key = step['key']
                card_index = page.evaluate('key=>state.hand.findIndex(c=>c.key===key)', key)
                if card_index >= 0:
                    click(f'[data-card="{card_index}"]')
                else:
                    click(f'[data-action="{key}"]')
                if page.evaluate('L.current(state)?.key') == key:
                    cell = step['y'] * 7 + step['x']
                    page.locator(f'[data-cell="{cell}"]').hover()
                    check(page.evaluate('JSON.stringify(state)') == old, f'第{i+1}课步骤{cursor+1}预览不推进')
                    click(f'[data-cell="{cell}"]')
            check(page.evaluate('state.lessonCursor') == cursor + 1, f'第{i+1}课步骤{cursor+1}只推进一次')
            actual = page.evaluate('JSON.stringify(state)')
            expected = page.evaluate('''()=>JSON.stringify(L.tape(state.lesson).filter(f=>f.stage==='result')[state.lessonCursor-1].state)''')
            check(json.loads(actual) == json.loads(expected), f'第{i+1}课步骤{cursor+1}与示范相同')
            if page.evaluate('state.phase') == 'battle':
                click('[data-action="undo-lesson"]')
                check(page.evaluate('JSON.stringify(state)') == old, f'第{i+1}课步骤{cursor+1}可撤销')
                # Replay this step without duplicating UI logic on the following iteration.
                if step['kind'] == 'action':
                    page.evaluate('q=>{const r=L.act(state,D.cards[q.key]?state.hand.findIndex(c=>c.key===q.key):q.key,q.x??state.hero.x,q.y??state.hero.y);state=r.state;resetView();render()}', step)
                else:
                    page.evaluate('q=>{state=L.observe(state,q.kind,q.unit);resetView();render()}', step)
                check(page.evaluate('JSON.stringify(state)') == actual, f'第{i+1}课撤销后重放相同')
        check(page.locator('.room-heading').inner_text().find('本课完成') >= 0, f'第{i+1}课完成')
        click('[data-action="undo-lesson"]')
        check(page.evaluate('state.phase') == 'battle', f'第{i+1}课完成后仍可撤销最后一步')
        click('[data-action="reset-lesson"]')
        check(page.evaluate('JSON.stringify(state)') == initial, f'第{i+1}课重试复位')
        click('[data-action="tutorial-menu"]')
    click('[data-action="leave-practice"]')

    # A topic opened from enemy details goes back to the same details dialog.
    page.evaluate('focused=state.enemies[0].id;render()')
    original = page.evaluate('JSON.stringify(state)')
    click('[data-action="inspect-details"]')
    enemy_title = page.locator('.modal h2').inner_text()
    click('.modal [data-concept="weak"]')
    click('[data-action="help-back"]')
    check(page.locator('.modal h2').inner_text() == enemy_title, '从敌情进入帮助后返回同一敌情')
    check(page.evaluate('JSON.stringify(state)') == original, '敌情帮助不改变对局')
    click('[data-action="close"]')

    # Playback must move pieces, pause, and cancel callbacks after close or return.
    page.evaluate('settings.reduced=false;openConcept("action")')
    click('[data-action="demo-play"]')
    page.wait_for_function('demo.index===1')
    click('[data-action="demo-play"]')
    paused = page.evaluate('demo.index')
    page.wait_for_timeout(1900)
    check(page.evaluate('demo.index') == paused, '暂停后不继续播放')
    click('[data-action="demo-play"]')
    page.wait_for_function('demo.index===2')
    page.wait_for_function('document.querySelector(".lesson-stage .board")?.getAnimations({subtree:true}).length>0')
    check(True, '常速示范包含棋子移动动画')
    click('[data-action="close"]')
    before = page.evaluate('JSON.stringify(state)')
    page.wait_for_timeout(1900)
    check(page.locator('.overlay').count() == 0 and page.evaluate('demo') is None, '关闭中途播放取消后续回调')
    check(page.evaluate('JSON.stringify(state)') == before, '播放不改变正式棋局')
    page.evaluate('openConcept("river")')
    click('[data-action="demo-play"]')
    click('[data-action="help-back"]')
    page.wait_for_timeout(1900)
    check(page.locator('.help-grid').count() == 1, '返回目录取消播放')
    click('[data-action="close"]')

    # Resize without restarting an active lesson or replacing its snapshot.
    page.evaluate('beginTutorial(4)')
    original = page.evaluate('JSON.stringify(state)')
    for w, h in [(1920,1080), (1440,900), (1366,768), (1280,720), (1500,800), (1280,720)]:
        page.set_viewport_size({'width': w, 'height': h})
        fit(f'{w} 连续缩放')
        check(page.evaluate('JSON.stringify(state)') == original, f'{w} 缩放保留课程进度')
    check(not errors, '页面无异常 ' + str(errors))
    browser.close()

(root / 'work/teaching-checks.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2))
print('PASS', len(checks), 'checks')
