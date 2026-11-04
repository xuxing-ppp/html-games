"""Capture actual game screens. Requires Playwright, Chromium and cwebp, not game dependencies.
Run the root server first; PLAYWRIGHT_BROWSERS_PATH can select an existing browser cache.
"""
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = os.environ.get('GAMES_TEST_URL', 'http://127.0.0.1:8000/').rstrip('/') + '/'
GAMES = ['car_racing', 'function_missel', 'game_of_life', 'ming_magistrate',
         'neon_survivor_mobile', 'war_simulator', 'xiangqi_beyond_the_river']
with sync_playwright() as p, tempfile.TemporaryDirectory() as temporary:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1120,'height':700}, reduced_motion='reduce', device_scale_factor=1)
    for game in GAMES:
        page.goto(BASE + 'games/' + game + '/index.html', wait_until='networkidle')
        page.wait_for_timeout(400)
        if game == 'car_racing':
            page.locator('#startBtn').click()
            page.wait_for_timeout(4000)
        elif game == 'function_missel':
            page.locator('button[type=submit]').click()
            page.locator('#formula').fill('sin(x)*3')
        elif game == 'game_of_life':
            page.locator('button[type=submit]').click()
            page.wait_for_function('!!LifeApp.config')
            page.locator('#more').click(); page.locator('#random').click()
            page.wait_for_timeout(150)
        elif game == 'neon_survivor_mobile':
            # The title shows the actual game identity without altering a saved run.
            pass
        elif game == 'war_simulator':
            page.locator('#modeSandbox').click(); page.locator('#btnEnter').click()
            page.locator('#btnRandom').click()
        image = Path(temporary) / (game + '.png')
        page.screenshot(path=str(image))
        subprocess.run(['cwebp','-quiet','-q','78',str(image),'-o',str(ROOT/'hall'/'previews'/(game+'.webp'))],check=True)
        print('Captured', game, flush=True)
    browser.close()
