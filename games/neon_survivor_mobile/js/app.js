// app.js — 入口:DOM 就绪后启动游戏(脚本顺序最后加载)。
// 保留应用图标与独立窗口入口；网站使用在线加载，不注册离线 Worker。
(function () {
  "use strict";
  function go() {
    const versionEl = document.getElementById("titleVersion");
    if (versionEl) versionEl.textContent = 'v' + globalThis.GAME_VERSION;
    SV.Game.boot();
    // 运行时 PNG 图标(iOS apple-touch-icon + 浏览器 favicon);失败不阻断游戏
    try { if (SV.Icons && SV.Icons.apply) SV.Icons.apply(); } catch (e) {}

  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();
