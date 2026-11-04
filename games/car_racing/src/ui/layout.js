export function mountLayout() {
  document.body.innerHTML = `
<div id="game"></div>
<div id="splitter"></div>

<!-- HUD -->
<div id="hud" class="hidden">
  <div id="p1panel" class="sidepanel panel">
    <div class="plabel" style="color:#ff7a7a">P1</div>
    <div class="lap" id="lap1">LAP 1/3</div>
    <div class="pos" id="pos1">1st / 8</div>
    <div class="driver-feedback" id="feedback1"></div><div class="time" id="time1">0:00.0</div><div class="player-speed"><b id="speedP1">0</b><small> KM/H</small></div>
  </div>
  <div id="p2panel" class="sidepanel panel">
    <div class="plabel" style="color:#7ab4ff">P2</div>
    <div class="lap" id="lap2">LAP 1/3</div>
    <div class="pos" id="pos2">1st / 8</div>
    <div class="driver-feedback" id="feedback2"></div><div class="time" id="time2">0:00.0</div><div class="player-speed"><b id="speedP2">0</b><small> KM/H</small></div>
  </div>
  <div id="minimapWrap"><canvas id="minimap" width="160" height="160"></canvas></div>
  <div id="p1bottom" class="bottombar">
    <div class="itemSlot empty" id="item1">·</div>
    <div class="meters"><div class="barLabel">P1 氮气 BOOST</div><div class="barWrap"><div class="bar" id="boost1"></div></div></div>
  </div>
  <div id="p2bottom" class="bottombar">
    <div class="meters"><div class="barLabel">P2 氮气 BOOST</div><div class="barWrap"><div class="bar" id="boost2"></div></div></div>
    <div class="itemSlot empty" id="item2">·</div>
  </div>
</div>

<div id="countdown" class="hidden"><div class="num" id="cdNum">3</div></div>

<!-- Pause button (HUD) -->
<button id="pauseBtn" class="hidden" title="暂停 (Esc)" aria-label="暂停比赛"><span class="bars"><span></span><span></span></span></button>

<!-- Menu -->
<div id="menu" class="overlay" data-page="track">
  <header class="club-header"><span class="game-version" data-game-version="car_racing">v${globalThis.GAME_VERSION}</span><div class="menu-tools"><button id="menuHelpBtn" class="utility">玩法 ?</button><button id="menuSettingsBtn" class="utility">设置 ⚙</button></div></header>
  <main class="lobby">
    <section class="hero-copy"><h1>街机<br><em>赛车</em></h1><div class="preview-label"><strong id="previewName">蔚蓝海岸</strong><small id="trackInfo"></small></div><div id="garagePreview" class="garage-preview" aria-label="当前车漆的赛车预览"></div></section>
    <section class="race-config" aria-label="赛前准备">
      <nav class="setup-tabs" aria-label="配置分类"><button data-page="track" class="on" aria-pressed="true">赛道</button><button data-page="car" aria-pressed="false">座驾</button><button data-page="rules" aria-pressed="false">规则</button></nav>
      <div class="config-pages">
        <section class="config-page" data-config="track"><div class="section-label">选择赛道</div><div class="track-selector"><button id="trackPrev" class="track-arrow" aria-label="上一条赛道">←</button><div id="trackGrid" class="track-grid"></div><button id="trackNext" class="track-arrow" aria-label="下一条赛道">→</button></div><div class="track-pagination" id="trackPagination" aria-label="赛道编号"></div></section>
        <section class="config-page" data-config="car" hidden><div class="section-label">选择调校</div><div id="garage" class="garage"></div><div class="setup-bottom"><div id="paintPicker"></div><span id="carInfo"></span></div></section>
        <section class="config-page" data-config="rules" hidden><div class="section-label">赛道规则</div><p class="driving-summary">漂移蓄能 · 跳台起飞<br>空中点按漂移，特技落地加速</p><button id="weatherBtn" class="utility">天气：晴朗 ↻</button></section>
      </div>
      <div class="event-grid" aria-label="比赛模式"><button class="event on" data-event="race"><b>竞速大奖赛</b></button><button class="event" data-event="time"><b>计时挑战</b></button><button class="event" data-event="drift"><b>技巧挑战</b></button></div>
      <div class="players-row"><span>上场人数</span><div class="seg"><button class="segbtn on" data-mode="1p">单人</button><button class="segbtn" data-mode="2p">双人</button></div></div>
    </section>
  </main>
  <footer class="launch-row"><div><small>个人最佳</small><strong id="record">暂无纪录</strong></div><button class="btn" id="startBtn">出发 <span>↗</span></button></footer>
</div>

<!-- Pause -->
<div id="pause" class="overlay small hidden">
  <div class="card">
    <h1 style="font-size:38px"><span>进站休息</span></h1>
    <div class="sub">Esc 继续比赛</div>
    <div class="menuList">
      <button class="menuBtn primary" id="resumeBtn"><span class="ic">▶</span>继续比赛</button>
      <button class="menuBtn" id="pauseSettingsBtn"><span class="ic">⚙️</span>设置</button>
      <button class="menuBtn" id="restartBtn"><span class="ic">🔄</span>重新开始</button>
      <button class="menuBtn danger" id="toMenuBtn"><span class="ic">🏠</span>回到主菜单</button>
    </div>
  </div>
</div>

<!-- Settings -->
<div id="settings" class="overlay small hidden">
  <div class="card settingsCard">
    <h1 style="font-size:34px">⚙️ <span>设置</span></h1>
    <div class="settingRow">
      <div class="label">主音量</div>
      <div class="ctl"><input type="range" id="volMaster" min="0" max="100" value="50"><div class="val" id="volMasterVal">50</div></div>
    </div>
    <div class="settingRow">
      <div class="label">音乐音量</div>
      <div class="ctl"><input type="range" id="volMusic" min="0" max="100" value="40"><div class="val" id="volMusicVal">40</div></div>
    </div>
    <div class="settingRow">
      <div class="label">音效音量</div>
      <div class="ctl"><input type="range" id="volSfx" min="0" max="100" value="70"><div class="val" id="volSfxVal">70</div></div>
    </div>
    <div class="settingRow">
      <div class="label">静音</div>
      <div class="ctl"><div class="toggleSw" id="muteToggle"></div></div>
    </div>
    <div class="settingRow">
      <div class="label">圈数 <span id="lapsLock" class="hidden" style="color:#ff9090;font-size:11px;">(比赛中锁定)</span></div>
      <div class="ctl">
        <div class="pillGroup" id="lapsGroup">
          <div class="pill" data-laps="1">1</div>
          <div class="pill" data-laps="2">2</div>
          <div class="pill on" data-laps="3">3</div>
          <div class="pill" data-laps="4">4</div>
          <div class="pill" data-laps="5">5</div>
        </div>
      </div>
    </div>
    <div class="settingRow">
      <div class="label">AI 难度</div>
      <div class="ctl">
        <div class="pillGroup" id="diffGroup">
          <div class="pill" data-diff="novice">新手</div>
          <div class="pill" data-diff="easy">简单</div>
          <div class="pill on" data-diff="normal">普通</div>
          <div class="pill" data-diff="hard">困难</div>
          <div class="pill" data-diff="expert">极限</div>
        </div>
      </div>
    </div>
    <div class="settingRow">
      <div class="label">画质</div>
      <div class="ctl">
        <div class="pillGroup" id="qualGroup">
          <div class="pill" data-qual="low">低</div>
          <div class="pill on" data-qual="mid">中</div>
          <div class="pill" data-qual="high">高</div>
        </div>
      </div>
    </div>
    <div class="settingRow"><label for="motionToggle">减少动态效果</label><input type="checkbox" id="motionToggle"></div>
    <div class="backRow">
      <button class="menuBtn primary" id="settingsBackBtn" style="min-width:200px"><span class="ic">✓</span>返回</button>
    </div>
  </div>
</div>

<!-- Results -->
<div id="results" class="overlay hidden">
  <div class="card wide">
    <h1 id="resultTitle">🏁 完成!</h1>
    <div id="podium" class="podium"></div>
    <table id="resultTable"></table>
    <div class="backRow">
      <button class="btn" id="againBtn" style="font-size:18px;padding:12px 28px">🔄 再来一局 (R)</button>
      <button class="menuBtn" id="resultsMenuBtn" style="min-width:200px"><span class="ic">🏠</span>回到主菜单</button>
    </div>
  </div>
</div>

<div id="toast"></div>
<div id="loading">正在启动街机赛车…</div>

<div id="drivingGuide" class="overlay small hidden"><div class="card"><h1>驾驶手册</h1><div class="driving-instructions">
<p><b>漂移与下坡</b><br>按住漂移键并转向蓄能，松开获得加速。下坡能积累更高速度，上坡前尽量保持速度。</p>
<p><b>起跳与落地</b><br>黄色箭头是跳台，自动起跳。空中左右微调落点，再点按一次漂移键做特技；沿道路方向成功落地获得加速。一直按住漂移键不会自动做特技。</p>
<p><b>选路与圆环</b><br>黄色分岔箭头指向较窄的捷径。青色路缘是自动吸附路段，可沿竖直圆环和倒挂道路正常驾驶。掉落会救援，损失时间。</p>
<p><b>操作</b><br>单人：方向键 / WASD、Shift 漂移与空中特技、空格 / Enter 道具。<br>双人：P1 方向键、右 Shift、Enter；P2 WASD、左 Shift、空格。<br>C 切换视角，Esc 暂停，R 重开。计时无道具；技巧挑战90秒，漂移与成功落地共同计分，连段最高四倍。</p>
</div><button id="drivingHelpClose" class="btn">返回准备</button></div></div>`;
}
