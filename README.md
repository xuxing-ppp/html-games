# Games

八款独立浏览器游戏，一个在线大厅。选择游戏后在同一窗口进入，用浏览器返回回到大厅。保留每款游戏原有界面、玩法和本地运行方式。

| 游戏 | 目录 | 初始版本 | 输入 |
| --- | --- | --- | --- |
| 小球擂台 | `games/ball_arena` | 1.0.1 | 鼠标／触屏；自动对战 |
| 街机赛车 | `games/car_racing` | 0.1.0（早期开发） | 键盘；本地双人 |
| 函数导弹 | `games/function_missel` | 1.0.0 | 鼠标与键盘；本地多人 |
| 生命游戏 | `games/game_of_life` | 1.0.0 | 鼠标与键盘 |
| 大明县令 | `games/ming_magistrate` | 1.0.0 | 鼠标／触屏 |
| 霓虹幸存者 | `games/neon_survivor_mobile` | 2.10.6 | 键盘／触屏 |
| 战争沙盘 | `games/war_simulator` | 1.0.0 | 鼠标与键盘 |
| 楚河行 | `games/xiangqi_beyond_the_river` | 1.0.0 | 鼠标与键盘 |

## 文件结构

```text
Games/
└── html_games/                 项目与 Git 仓库根目录
    ├── .gitignore
    ├── AGENTS.md
    ├── README.md
    ├── index.html              游戏大厅入口
    ├── package.json
    ├── games/                  八款游戏的完整源码与各自资料
    ├── hall/                   大厅样式、逻辑和压缩预览图
    ├── tools/                  检查、本地服务和预览维护
    └── tests/                  跨游戏与大厅验证
```

本地和 GitHub Pages 使用相同的源码与 `games/` 路径；游戏保留各自的独立运行方式。

## 本地打开

在 `html_games` 项目目录运行以下命令，再打开 <http://127.0.0.1:8000/>：

```sh
npm run dev
```

需要 Node.js 22+ 和 Python 3，无须安装 npm 依赖。停止服务按 Control+C。赛车也可继续使用目录内的启动／关闭脚本；其余游戏保留双击本地 index.html 的用法，详见各游戏 README。大厅可以本地打开，但赛车需要通过服务访问。

## 提交范围

入库：代码、测试与必要测试数据、说明、维护脚本、依赖清单、Three.js 与许可证，以及游戏实际使用的 WebP／MP3／SVG。

忽略规则按目录维护：项目根 `.gitignore` 只管理系统文件、通用依赖／缓存和大厅产物；八款游戏各有自己的 `.gitignore`，管理本游戏的原图、制作中间产物、测试输出与发行包。新增游戏特有规则时写在该游戏目录。

忽略但不删除：原始绘画、参考图、媒体制作中间产物、系统文件、已安装开发依赖、测试截图与报告、缓存、生成的 ZIP。不按图片或音频扩展名统一忽略，避免游戏缺少资源。霓虹幸存者现在是普通目录，不使用子模块。

提交前检查：

```sh
npm run check
npm test
git status --short
git add --dry-run .
```

`html_games` 是项目与 Git 仓库根目录，`.gitignore` 位于此处。如果尚未初始化仓库，可在此目录运行 `git init -b main`。确认清单后由维护者 commit 并 push。运行测试不会自动提交或推送。

## 大厅游戏顺序

编辑 [hall/order.js](hall/order.js)，把想优先展示的游戏移到列表前面。大厅按文件中从上到下的顺序显示，未列出的游戏接在末尾。保存后刷新本地大厅，提交并推送后网站也会使用新顺序。

## 游戏版本

直接打开对应游戏目录里的 `version.js`，修改引号内的数字即可。例如街机赛车当前是：

```js
var GAME_VERSION = "0.1.0";
```

大厅和游戏标题页共用这一个版本值。修复增加修订号，新增功能增加次版本，重大不兼容变化增加主版本。改动后可用 `npm run check` 检查格式。版本号独立于存档格式；需要追踪一次发布的完整代码时，在 GitHub 查看对应提交。

## GitHub Pages

1. 将 `html_games` 目录内的项目提交并推送到仓库的 `main` 分支。
2. 在 **Settings → Pages → Build and deployment → Source** 选择 **Deploy from a branch**。
3. 分支选择 `main`，目录选择 `/(root)`，保存。发布完成后从 Pages 设置打开网址。

以后推送到该分支就会更新网站。GitHub Pages 使用默认流程发布该分支的静态文件。游戏网址使用 `games/<游戏目录>/`。

## 网络、存档与程序坞

网站采用普通在线加载，不提供主动离线缓存；添加到程序坞／主屏幕保留图标与独立窗口，但不保证断网打开。普通浏览器 HTTP 缓存仍由浏览器管理。

存档继续按各游戏既有规则保存在浏览器中，游戏更新不主动清除。换设备、浏览器、站点地址或网页 App 容器不会自动同步；从原霓虹幸存者网站迁到新 Pages 地址也不自动迁移存档。并非每款游戏都会保存完整对局，具体看各游戏说明。

霓虹幸存者不再注册离线 Worker。游戏目录内保留 sw.js 作为退役脚本，已有安装联网更新后停止拦截并注销；清理只作用于该游戏当前目录的旧缓存条目，不删除存档或其他路径的缓存。不对旧的独立 GitHub 仓库／站点自动发布改动。

## 开发验证

```sh
npm run check
npm test
python3 -m pip install playwright
python3 -m playwright install chromium
npm run test:browser
```

浏览器验证自行使用临时端口启动服务，覆盖根路径、仓库子路径、六种窗口、连续缩放、游戏入口、版本一致性与旧缓存退役。可通过 `PLAYWRIGHT_BROWSERS_PATH` 使用已有浏览器缓存，截图保存在系统临时目录。游戏自身回归按各项目说明执行。

更新大厅预览图：先启动本地服务，再运行 `python3 tools/capture-previews.py`，需要开发工具 Playwright、Chromium 和 cwebp。生成的是实际游戏画面的压缩 WebP，不将截图原图入库。

大明县令新克隆不包含原图，常规测试校验运行图。保有本地原图时可在其目录运行 `CHECK_SOURCE_ASSETS=1 node --test tests/art.test.mjs`。GitHub Pages 直接加载仓库中的运行资源。

## 小球擂台

190 个角色、固定对阵栏选人、4–128 强锦标赛、系列赛与可选机关。致谢原作者 [Kizu_Na](https://space.bilibili.com/3546819271330077)。独立运行、玩法与验证见 `games/ball_arena/README.md`。
