import http from 'node:http';
import { readFile, writeFile, unlink, realpath, stat } from 'node:fs/promises';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootId = createHash('sha256').update(root).digest('hex').slice(0, 20);
const stateFile = process.env.KART_DEV_STATE_FILE || resolve(tmpdir(), `kart-racing-${rootId}.json`);
const app = 'kart-racing-dev';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.ico':'image/x-icon', '.mp3':'audio/mpeg', '.wav':'audio/wav' };

function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host:'127.0.0.1', port, path, method:options.method || 'GET', headers:options.headers }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status:res.statusCode, body }));
    });
    req.setTimeout(1000, () => req.destroy(new Error('timeout')));
    req.on('error', reject); req.end();
  });
}
async function runningInstance() {
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    const res = await request(saved.port, '/__kart_dev/status');
    const status = JSON.parse(res.body);
    if (res.status === 200 && status.app === app && status.rootId === rootId) return saved;
  } catch { /* A stale state file is harmless; never stop an unrelated server. */ }
  return null;
}
function openBrowser(url) {
  if (process.argv.includes('--no-open')) return;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  execFile(command, [url], error => { if (error) console.log(`请在浏览器打开：${url}`); });
}
function announce(port, reused = false) {
  const url = `http://localhost:${port}`;
  console.log(`${reused ? '游戏已经启动，直接打开。' : '游戏已启动。'}\n${url}\n关闭游戏：双击“关闭游戏.command”，或运行 npm run stop。`);
  if (!reused) console.log('也可以在此窗口按 Control + C 停止。');
  openBrowser(url);
}
async function stop() {
  const saved = await runningInstance();
  if (!saved) { console.log('游戏已经关闭。'); return; }
  const res = await request(saved.port, '/__kart_dev/stop', { method:'POST', headers:{ 'x-kart-token':saved.token } });
  if (res.status !== 200) throw new Error('未能关闭游戏，请在启动窗口按 Control + C。');
  // Wait for the actual listener to close before reporting completion.
  for (let i=0; i<30; i++) {
    if (!await runningInstance()) { console.log('游戏已关闭，下次双击“启动游戏.command”即可。'); return; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('游戏仍在关闭中，请稍后重试。');
}
async function start() {
  const existing = await runningInstance();
  if (existing) { announce(existing.port, true); return; }
  const token = randomBytes(24).toString('hex');
  let shuttingDown = false;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/__kart_dev/status') {
      res.setHeader('Content-Type', 'application/json');res.end(JSON.stringify({ app, rootId }));return;
    }
    if (url.pathname === '/__kart_dev/stop') {
      if (req.method !== 'POST' || req.headers['x-kart-token'] !== token) { res.writeHead(403);res.end();return; }
      res.end('closed');setImmediate(shutdown);return;
    }
    if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405);res.end();return; }
    try {
      const pathname = decodeURIComponent(url.pathname);
      let path = resolve(root, `.${pathname}`);
      if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403);res.end();return; }
      if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      path = await realpath(path);
      if (!path.startsWith(root + sep)) { res.writeHead(403);res.end();return; }
      const content = await readFile(path);
      res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
      res.setHeader('Content-Length', content.length);
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch { res.writeHead(404);res.end('文件不存在'); }
  });
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try { const current = JSON.parse(await readFile(stateFile,'utf8'));if (current.token === token) await unlink(stateFile); } catch {}
    server.close(() => { console.log('游戏已关闭。'); });
    server.closeAllConnections?.();
  }
  for (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.once(signal, shutdown);
  const preferred = Number(process.env.KART_DEV_PORT ?? 8000);
  if (!Number.isInteger(preferred) || preferred < 0 || preferred > 65535) throw new Error('端口设置无效。');
  let port = preferred;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const error = err => { server.off('listening', ready);reject(err); };
        const ready = () => { server.off('error', error);resolve(); };
        server.once('error', error);server.once('listening', ready);server.listen(port, '127.0.0.1');
      });
      break;
    } catch (error) {
      if (error.code !== 'EADDRINUSE' || port >= Math.min(preferred + 100, 65535)) throw error;
      port++;
    }
  }
  port = server.address().port;
  try { await writeFile(stateFile, JSON.stringify({ port, token }), { mode:0o600 }); }
  catch (error) { await shutdown();throw error; }
  if (port !== preferred && preferred !== 0) console.log(`${preferred}端口被其他程序使用，已自动换一个可用地址。`);
  announce(port);
}
try { if (process.argv.includes('--stop')) await stop();else await start(); }
catch (error) { console.error(`无法${process.argv.includes('--stop')?'关闭':'启动'}游戏：${error.message}`);process.exitCode=1; }
