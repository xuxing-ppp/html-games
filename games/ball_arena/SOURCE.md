# 发布文件来源

感谢原作者 **[Kizu_Na](https://space.bilibili.com/3546819271330077)** 创作并分享原游戏。

原游戏：小球对战（Pixel Ball Battle）
页面：https://www.bilibili.com/toy/OwWrGZ7khDfig8HV/index.html
内容页面：https://www.bilibilitoy.com/toy/OwWrGZ7khDfig8HV/index.html
采集日期：2026-11-09

src/core、src/balls、src/assets 以及 src/ui 中的绘制与音效代码来自该页面公开发布的前端文件。原注释与文件内声明保留；未发现单独的许可文件，不推定这些文件另有开源许可。新界面与扩展位于 web/。没有使用平台统计、SDK 或跳转代码。原始采集清单位于仓库外 ball-battle-extracted/download-manifest.json。

锦标赛通用模型来自同次采集的 `mobile/tournament-bracket.js`，复制为 `web/tournament-core.js`。将导出命名空间独立为 ArenaTournamentCore，并将界面规模扩为 4、8、16、32、64、128；保留原作不重复抽签、精英占位、组队容量与晋级规则。新锦标赛界面、保存验证和对局衔接由 web/tournament.js 与 web/tournament-ui.js 实现。

本作对 src/ui/canvas-renderer.js 的眩晕图标进行了表现调整：用带深色描边的连续闪电轮廓代替原像素块，其余原有状态规则不变。

1.0.1 在绘制器增加可选 teamColors 阵营轮廓，独立于角色本色和技能，目录预览默认不启用。

1.0.2 重做 1.0.1 中已有的 6 名原创角色；移除原创角色攻击冷却环与电量条。角色总数和锦标赛容量与 1.0.1 相同。

1.0.3 为原角色与原创角色补充独立的清晰化文案 `web/descriptions.js`，新增对局内角色技能面板，并按模式区分限时、限时按剩余总生命判定；未修改原作注册数据、战斗代码与素材。
