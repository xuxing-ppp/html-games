# 开发验证

游戏运行不需要依赖。验证工具需要Node.js；浏览器验证另需Python、Playwright及其Chromium。

```sh
node --test tests/*.test.js
python3 tests/ui.py
python3 tests/map_ui.py
python3 tests/usability_ui.py
python3 tests/expansion_ui.py
python3 tests/card_reading_ui.py
python3 tests/layout_paper_ui.py
python3 tests/teaching_ui.py
python3 tests/teaching_comparison_ui.py
python3 tests/practice_navigation_ui.py
python3 tests/feedback.py
```

生成六条路线的完整冒险报告与回放（有限搜索，不修改生命或资源来通关）：

```sh
node tests/adventure.js sword 42 risk 3 shadowblade
node tests/adventure.js sword 7 risk 3 riverblade
node tests/adventure.js palm 103 risk 3 wallpalm
node tests/adventure.js palm 5 risk 3 tidepalm
node tests/adventure.js finger 17 risk 3 sealpoint
node tests/adventure.js finger 12 risk 3 counterpoint
```

随后运行三派36程真实按钮回放，流程转换时核对完整状态：

```sh
python3 tests/ui_adventure.py
python3 tests/final_smoke.py
```

`ui_adventure.py sword`、`palm`或`finger`可单独重放一派。修改规则后先重新生成对应冒险回放。`planner.js`仅供验证，不是游戏内提示或敌方AI。

运行时生成 `work/`。截图、报告、完整冒险回放都可删除并再生；固定教学的脚本与局面定义保存在 `game/lessons.js`，由练习与动画共同使用。项目交付时清理无用临时文件。

`card_reading_ui.py` 专门检查完整卡牌阅读：跨子元素悬停、移入说明、路过其他卡、长说明滚动、缺气读牌、键盘、清理计时器，以及四种尺寸下全部66张基础／升级卡的全文、奖励、商店、事件和牌库。

`tests/lessons.test.js` 检查八门固定课程、逐步结算一致性、非指定操作拒绝、查看与预览不推进、撤销重放，以及炮击有无目标的溅射、桥渡费用、共享承伤、破绽免伤、阵法减伤和综合得势／上限／消费。`tests/teaching_ui.py` 在四种桌面尺寸下实际点击完整课程，检查只读帮助、动画暂停与取消、返回原局、左侧三诀、十张手牌及连续缩放。

浏览器脚本可设置 `XQ_BROWSER_PATH` 复用已有 Chromium；全部通过真实 `file://` 入口运行，无需服务器。

`tests/practice_navigation_ui.py` 检查选派与标题两个练习入口，以及练习内通过暂停菜单返回标题后正常继续原对局。

`tests/teaching_comparison_ui.py` 逐帧检查五门扩展教程在四种桌面尺寸下的棋盘、说明、实算对比与按钮边界，并核对真实渲染的四向移动路线和明确的系灯距离文案。
