# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概况

**霓虹幸存者** — Vampire-Survivors 类弹幕肉鸽。纯 Canvas2D + vanilla JS，游戏运行零依赖，双击 `index.html` 以 `file://` 直接运行（无构建、无打包、无服务器）。UI 支持中英文。

## 运行与测试

- **运行**：双击 `index.html`（file:// 直开，无任何服务端依赖）。改动后无构建步骤。
- **语法自检**：`node -e 'new Function(require("fs").readFileSync("js/<file>.js","utf8"))'`（对每个 js 文件）。
- **逻辑回归**：`node tests/logic_test_balance.js`（武器成长边界、拾取、Boss 档位与时序、新 Boss AI、暂停说明）、`node tests/logic_test_i18n.js`（中英文配置）、`node tests/sentry_multi_test.js`（多炮塔独立性）。这些测试用 Node `vm` 加载实际模块，不依赖 `/tmp`。
- **战斗行为基准**：`node tests/fusion_balance_test.js --check` 检查融合武器输出为正且有限，并打印相对输出供人工评估。`tests/weapon_balance.js` 与 `tests/weapon_balance_paired.js` 是可选的模拟审计，不以单一 DPS 值决定平衡。
- **后期平衡**：`node tests/late_balance_test.js` 覆盖难度曲线、护盾/治疗、跨来源保护、危险区、索敌、分批 Boss 与融合刃环；`node tests/late_balance_browser.js` 覆盖旧存档、排队恢复、连续缩放和实际战斗。`node tests/progression_balance.js --movement tactical` 用真实拾取和三选一完成成长压力测试，不能把脚本结果当作真人胜率。全武器与移动 Boss/支援怪群审计及复现见 `tests/late_balance_results.md`。
- **真浏览器回归**：`node tests/i18n_browser_test.js`、`node tests/save_resume_test.js`、`node tests/title_exit_test.js`。测试以 `file://` 打开游戏，检查 UI、存档恢复、移动横屏和浏览器错误。开发环境执行 `npm install --prefix tests` 安装 Playwright-core，安装 Chromium 或通过 `PLAYWRIGHT_CHROMIUM` 指定可执行文件；游戏本身不需要 npm。`tests/browser_helper.js` 也能复用现有 `/tmp/pwtest/node_modules`。
- **断言原则**：新增机制要配行为测试；平衡测试检查有限值、成长趋势、合理区间、投射物上限和可复现的战斗结果。具体伤害、冷却和 DPS 以试玩体验调节，不把旧版本的固定数值当作回归门槛。旧 `/tmp/pwtest/logic_test_balance.js` 与此前的 `tests/logic_test_balance.js` 含大量过期固定期望，不再是测试入口。
- `tests/*.ndjson`、`tests/*.tsv`、`tests/*.png` 是可再生成的审计输出，已忽略；测试脚本和文档保留在 `tests/`。

## 架构

**模块体系**：`js/*.js` 全部 IIFE 挂到共享命名空间 `window.SV`（`app.js` 里 `window.SV = window.SV || {}` 引导）。**加载顺序严格依赖**（index.html 脚本顺序）：util → config → storage → i18n → input → audio → pool → spatial → effects → entities → ai → weapons → waves → upgrades → renderer → hud → menus → auto → icon → game → app。新模块必须插在正确位置，且用 IIFE + `const SV = window.SV` 模式。

**核心分层**：
- `config.js` — **唯一数值源**（数据驱动）：WEAPONS/WEAPON_EVOS（含融合 def）/EVOLUTIONS/FUSIONS（协同进化组合表）/PASSIVES/ENEMIES/BOSSES（含 tier）/STAGES（含 half 竞技场半宽与 Boss 排期）/CURVES（难度曲线与成长曲线参数）/DIFFICULTY/CHARACTERS/CONST。改平衡只动这里（个别机制在 weapons.js）。
- `game.js` — 状态机（menu/charselect/select/playing/paused/levelup/endlessprompt/gameover）+ 固定步长主循环。`step()` 顺序：Waves → rebuildGrid → Weapons.updateAll → updatePlayer → updateEnemies → Effects。通关（`time ≥ goalMin`）弹无尽选择而非直接结算。
- `spatial.js` — 均匀网格宽相位（唯一碰撞查询入口 `queryCircle`），每帧由 `rebuildGrid` 重建（只插敌人，不含敌方弹幕）。
- `pool.js` — 通用对象池；武器投射物用 `Weapons.mkProj()`（满 `MAX_PROJECTILES=1200` 时回收最旧，保证返回非空）。
- `entities.js` — 工厂 + 玩家/敌人积分；`mods(state)` 汇总被动数值并**缓存到 `state._mods`**。
- `weapons.js` — 武器分发与投射物推进；`stats(w, state)` 应用被动乘子。
- `ai.js` — 每敌人一种行为，负责移动与攻击时序；Boss 分支含 14 种（含磁暴引力波/镜像换位/巨像旋转激光）。
- `renderer.js` — 相机 + 缓存辉光精灵（**绝不用实时 shadowBlur**）+ 视口剔除；屏外 Boss 箭头、玩家头顶血条、竞技场边框。
- `hud.js`/`menus.js` — DOM 叠层（节流 ~120ms 刷新、pointer-events:none）+ 全屏菜单屏，`data-act` 事件委托驱动 `game.js` 的 handleAct。
- `auto.js` — **全自动模式**（`SV.Auto`，默认关，随时可切）。走位：`tick(state,dt)` 在 `step()` 的 `updatePlayer` 前覆写 `SV.Input.axis`——方向采样「最长净空跑道」(安全地板) + FLEE(随最近净空到 `SAFE` 衰减:既不贴墙逃、又让敌进入武器射程好打怪) + **宝石/特殊掉落吸引**(直接扫 `state.gems`/`state.pickups`,不在网格;安全可拾才拾) + ORBIT 轻微环绕 + STICK 防抖；bomber/eshots 加权放大半径;hazards(灼烧等)圈外膨胀、圈内降权+沿出口方向逃离偏置(防膨胀圈封死跑道致原地抽搐),圈内宝石/掉落被安全门过滤)。冻结敌仍有接触伤害(不算无害);变羊敌无接触伤害(跳过)。升级：`pickUpgrade` 打分(fuse>evolve>进化解锁铺路>magnet 协同>常规)。`init()` 在 `boot()` 里**运行时包装 `SV.HUD.showLevelUp`**(开启即渲染三张卡 + `.chosen` 高亮所选、`LV_DELAY`~1s / `LV_FAST`(级联)后自动 `onSelect(pick)`，`done` 标志防双选)。开关：`O` 键 / `#btnAuto`，偏好持久化 `Storage.autoMode`。调参只动 `config.js` 的 `AUTO` 块。**范围仅走位+升级**；通关无尽弹窗、死亡结算屏仍手动(用户决定)。

**成长体系**（三轮演进后的现状）：
- 武器等级封顶 8（`WEAPON_MAX`，兼进化阈值）；被动等级无限（99），收益按两种曲线递减：`capDim(n,cap,v1)`（有硬上限，等比收敛）与 `rootDim(n,per)`（无上限，1/√n，≈2√n 增长），都在 `Entities.mods()` 内。
- 进化：武器 L8 + 对应被动 L5 → 升级池出进化卡；**协同进化**：两把已进化武器 → `FUSIONS` 组合卡 → 合成一把融合武器（释放槽位）。

## 关键陷阱（改代码前必读）

1. **mods 缓存**：`mods()` 结果缓存于 `state._mods`，任何被动/角色变化后必须 `SV.Entities.invalidateMods(state)`（`Upgrades.apply` 与 `Game.reset` 已做；测试里直改 `state.passives` 后也要手动失效，否则读旧值）。
2. **融合武器分发**：所有融合 def 的 `kind` 统一为 `"fusion"`——`weapons.js` 里按 **`w.id`** 分发（`FUSION_FIRE` 表 + updateAll 里 `w.id === "blade_aura"/"boomerang_sentry"` 特判），不能按 kind。连续型融合（刃环类）需要自己的每帧逻辑。
3. **命中 vs 查询半径**：`queryCircle` 半径必须 ≥ 实际命中半径（静止目标会漏检）。
4. **file:// 约束**：经典 `<script>` 标签（ES module 会被 file:// 的 CORS 拦截）；bootstrap 必须 `window.SV = window.SV || {}`（顶层 const 不进 window）。
5. **弹幕增殖**：爆炸/分裂类武器（grenade_evo 分裂 2 颗、融合轨道轰炸每穿爆炸）要注意 `MAX_PROJECTILES` 硬上限；`explodeGrenade` 用 `pr.clustered` 标志防重复分裂。
6. **哨卫塔数**：sentry L8 = 3 塔（sentry_evo = 5）；塔身有弹幕拦截逻辑（`sentryUpdate` 与融合版都有）。
7. **每武器伤害统计**（暂停/结算用）：武器造成伤害必须经 `weapons.js` 的 `dmgEnemy(e,dmg,wid)` 穿 `wid`（投射物命中传 `pr.weaponId`，直接伤害传 `w.id`），最终在 `Entities.damageEnemy` 累加到 `state.weaponDamage[ tid(wid) ]`。`tid(id)=id.replace(/_evo$/,"")`（进化与进化前合并、融合武器独立成桶）；`state.weaponActive[tid]` 在 `updateAll` 每帧累加。**新增武器/新增伤害点必须补传 wid**，否则该武器伤害不计入统计。DoT（毒/燃烧/咒引）需在施加时存 `e.poisonWid`/`e.hexWid`，`updateEnemies` tick 时随 `wid` 传入。`capDim/rootDim/tid/previewEnemy/previewBoss` 已经 `SV.Entities` 导出。
8. **BGM**：`audio/` 目录 5 首预生成循环曲（90s：`menu` + 四地图各一），**MP3 单格式**（112k CBR，从 `test_audio/*_loop.wav` 重编码，自动写入 Xing/Info + LAME gapless 头=编码器 delay/padding 元数据，重转用 `conda run -n game python test_audio/wav2audio.py`——改参数只动该脚本的 `MP3_ARGS`）。`audio.js` BGM 引擎**双路径**：主路径 WebAudio——`fetch → decodeAudioData → BufferSource(loop=true, loopStart/loopEnd)` **采样级无缝**，解码后 `scanLoop` 扫头尾 -60dB 亚阈值样本夹循环体（单侧上限 0.25s，兼容各浏览器对 LAME 头/重采样的处理差异）；**file:// 下 `waUsable()` 直接判否**（fetch 被 CORS 拦且打 console error 噪音），回退 HTMLAudio `el.loop=true`（Chrome/FF 按 LAME 头自动裁延迟，缝隙最小）。buffer 仅缓存当前曲+上一曲（90s 立体声解码 ~32MB/曲，LRU-2），懒解码不预建。音乐走独立 `musicGain` 直连 destination（不进 SFX 的 `MASTER_CAP=0.5` 总线），音量语义 `musicVol*MUSIC_SCALE(0.11)` 与旧 el.volume 一致。`SV.Audio.getBgmMode()` 返回 `"webaudio"|"html"|"none"`（测试/调试用；`"none"`=沙箱无 fetch/Audio 或回退失败，静默跳过）。曲目映射：`config.js` 的 `stage.bgm` / `MENU_BGM` 均为字符串 id（`"ruins"/"crimson"/"frozen"/"void"/"menu"`），`startBgm(id)` 同 id 早退防重启；`startRun` 调 `startBgm`、`endRun`/回标题调 `stopBgm`，暂停不停；iOS 切后台被打断由 audio.js 自挂的 `visibilitychange` + `resume()`（`state!=="running"` 即恢复）兜底。SFX 仍是 WebAudio 合成（shoot/hit/levelup 等），vm 沙箱测试的 `AudioContext` mock 需含 `createBuffer/createBufferSource/createBiquadFilter`（`bossWarn/die/hurt` 的 `noise()` 要用）；沙箱无 `Audio` 构造器/`fetch` 时 BGM 全部静默跳过（`window.Audio` guard——IIFE 内 `const Audio` API 对象会遮蔽全局构造器，**必须显式 `window.Audio`**）。新增音源文件需由根目录发布清单完整打包；不注册离线 Service Worker；BGM 专项测试脚本尚未迁入仓库；改动音频引擎时需补 WebAudio、file:// 回退和无音频环境断言。
9. **Boss 排期**：四张地图在 5:00/9:30/13:30 从各自 T1/T2/T3 池随机出一只 Boss；`CONST.LATE_BOSS_TIMES` 为 15:30/17:30/19:00，条目数按轻松/普通/困难/噩梦为 1/2/2/3，同波间隔 2 秒（多体 Boss 保留 count）。无尽从 20:30 起每 90 秒随机 2–3 条目。虚空没有额外终局组。`lateBossIndex/endlessBossNext/pendingBosses/lateReliefUntil` 记录进度及队列，存档保留未到场成员；同组奖励须等待队列清空，旧存档由 `game.js` 补字段。改弹幕用 `ai.js` 的 `burst/aimedSpread/ringFrom/spiralBurst`；螺旋相位用 `e.sp`，勿混用 `t1/t2/t3/cdir`。
10. **升级卡真实增量**：被动卡文案走 `Upgrades.passiveLevelText`（`magnet` 走 `magnetLevelText`），用 `capDim/rootDim` 算「下一级」真实增量（递减后小于首级），不再是 config 静态首级文案。武器卡 `levelText` 已正确（走 `Weapons.stats` diff）。
11. **环境机制随时间成长**：`envTick`（entities.js）的 burn 区数 `1+floor(t/3)`、freeze/gravity 时长 `min(interval/3, dur*(1+0.5t))`（上限为触发间隔 1/3）、gravity 方向随机存 `state._voidPullDir`。注意区分 stage envField 引力与 Boss `magnetwarper` 的引力（后者在 `ai.js`，朝 Boss）。
12. **全自动模式接入点**：`game.js step()` 里 `updatePlayer` 前一行 `if (SV.Auto && SV.Auto.enabled) SV.Auto.tick(s, dt)`、`boot()` 里 `if (SV.Auto && SV.Auto.init) SV.Auto.init()`——**两处都带 guard**，因为轻量 vm 测试可能未加载 `auto`（缺少 guard 会让 boot 抛错）。走位靠覆写 `SV.Input.axis`（由 `entities.js` 的 `updatePlayer` 读取，覆写后仍走 speed/clamp 管线）；宝石/掉落直接扫 `state.gems`/`state.pickups`（**不在空间网格**，`queryCircle` 只返敌）；升级靠**包装 `SV.HUD.showLevelUp`** 而非 handleAct（升级卡是直挂 `addEventListener`、无 `data-act`），包装内 `setTimeout` 异步自动选 → 涉及升级的 vm/Playwright 断言须 `await`/poll。调参只动 `config.js` 的 `AUTO` 块（SENSE/SAFE/GEM/SPEC/FLEE/LV_DELAY 等）。改 `step()` 顺序或 `updatePlayer` 读 axis 的位置时，须同步 `Auto.tick` 的插入点。
13. **移动端 / PWA 接入点**：
    - **浮动摇杆**（`input.js`）：触控事件源是 `<div id="stickZone">`（z-index 15，仅 `body.touch` 显示，全屏），`<div id="stick">` 仅视觉层（`pointer-events:none`，JS 用 `transform:translate()` 平移到落点）。`SV.Input.init` 接受 3 参 `(stickEl, knobEl, zoneEl)`；**zoneEl 缺失时退回固定摇杆**（旧桌面测试兼容）。多指追踪靠 `_touchId`（match `changedTouches[i].identifier`），`onInteractive(target)` 用 `closest("button,.hud-btn,[data-act],input,.card,.vol-slider,a,.screen")` 屏蔽按钮上的触摸。落点经 `_clampToSafe`（读 `#safeTest` 元素 `getComputedStyle` 的 `padding*` 即 `env(safe-area-inset-*)`）夹取到安全区内。改 z-index 时注意 stickZone(15) < hud(20) < levelup(40) < screen(50) < rotateHint(99) 的层级，否则按钮触摸会被 stickZone 截走。
    - **自动暂停**（`game.js boot()`）：`visibilitychange`（hidden 且 mode=playing → togglePause）+ `pagehide`（同）—— iOS Safari 切后台常派发 pagehide 而非 visibilitychange。改 `togglePause` 或 mode 流程时勿破坏。
    - **音频解锁**：`boot()` 末尾 `pointerdown` + `keydown` + **`touchstart`**（旧 Android webview 兜底；均 once 式自摘除）。改 `startBgm` 调用点时同步。
    - **动态图标**（`icon.js`）：`SV.Icons.draw(size)` Canvas 绘制返回 PNG dataURL；`SV.Icons.apply()` 在 `app.js go()` 里 boot 后调用，替换 `<link rel="apple-touch-icon">` 与 favicon 的 href。`manifest.json` 用静态 `icon.svg`（Android PWA 安装图标）；iOS 在「添加到主屏幕」时读实时 DOM 的 apple-touch-icon link（此时 JS 已跑过），故 dataURL 生效。**改图标设计**只动 `icon.js drawIcon` + `icon.svg`。
    - **在线加载与旧缓存退役**：页面不注册 Service Worker。`sw.js` 保留原 URL，仅供旧安装更新、注销；没有 fetch 处理器。`retire-offline.js` 只清理当前目录下 `neon-survivor-*` 缓存条目及对应注册，不清除存档，也不影响其他路径。新增资源不再维护预缓存列表。
    - **CSS 触屏分支**：所有触屏专属样式挂 `body.touch` 类（`input.js init` 检测 `isTouch` 后加到 body）。`.kbd-only` 在 `body.touch` 下 `display:none`（键盘提示隐藏）。`@media (orientation:portrait) and (pointer:coarse)` 控制竖屏旋转提示（纯 CSS，无 JS）。`env(safe-area-inset-*)` 用于 HUD 顶栏 padding、XP 条 margin-bottom；新增边角 UI 元素时记得加同款 padding。触屏按钮最小可触尺寸 44px（`.hud-btn` 等在 `body.touch` 下放大）。
    - **icon.js 可不进轻量 vm 测试**：手动加载列表可能不含 `icon`（同 `auto`），`app.js go()` 调 `SV.Icons.apply` 必须 **`if (SV.Icons && SV.Icons.apply)` guard**，否则旧测试 boot 抛错。

## 移动端 / PWA

- **核心约束**：网站采用在线加载；`manifest.json` 与 `icon.js`/`icon.svg` 保留独立窗口、主屏幕／程序坞图标和全屏体验，不提供网站离线缓存。版本来源为本目录 `version.js`，与存档格式独立。
- **file:// 仍可用**：完整下载本目录后，双击 `index.html` 仍能玩；旧缓存退役脚本在 file:// 下静默跳过。网站的在线加载不改变本地文件玩法。
- **真机调试**：电脑跑 `python3 -m http.server 8000`，手机浏览器访问 `http://<局域网IP>:8000`。线上统一部署到 Games 的 GitHub Pages，步骤见项目根目录的 [README.md](../../README.md)。
- **移动端测试**：`node tests/save_resume_test.js` 覆盖触屏横屏布局和存档恢复；`node tests/title_exit_test.js` 覆盖多种移动横屏尺寸、44px 按钮和退出流程。改浮动摇杆、旋转提示或 PWA 时，应补相应专项断言；原 `/tmp/pwtest/features_mobile_test.js` 和 `/tmp/pwtest/mobile_smoke.js` 当前环境中不存在。
- **图标资源**：本项目**不打包任何 PNG**（零资源）。`icon.svg` 是手写 SVG 文本（Android PWA 安装图标 + favicon）；iOS apple-touch-icon 由 `icon.js` 在客户端 Canvas 运行时生成 dataURL 替换。要换设计：编辑 `icon.svg` + `icon.js drawIcon` 即可，无需准备 PNG。
