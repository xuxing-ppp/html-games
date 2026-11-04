import { mountLayout } from './ui/layout.js';
mountLayout();
try { await import('./game.js'); }
catch (error) {
  console.error(error);
  const loading = document.getElementById('loading');
  loading.textContent = '启动失败：请通过本地服务器打开，并确认浏览器支持 WebGL。';
}
