# 图片资源

当前保留41组在用原图与WebP，运行图合计约10.9 MiB。`originals/`是本地维护原图（不入 Git），`runtime/`供游戏加载；质量84且不缩小原始尺寸。尺寸、字节与SHA-256见 `docs/asset-manifest.json`。仅保留实际场景、横竖构图、舆图及纸面所需图片。

`js/ui/art-data.js`明确选择场景、人物焦点和专用竖图。舆图使用完整地图坐标，叙事画使用cover铺满。开场与海瑞会面为横竖独立构图，保持人物距离、正确视线和同一围院。

人物、夜景与结局统一为偏写意的淡设色水墨，人物与环境采用相同笔墨概括程度。减少细致皮肤、密绣纹、材质贴图和碎黑点；阴雨、室内、晴日、暮色与深夜分别安排明暗。见[统一规则](MYSTERY.md)和[实际最终提示](INK-PROMPTS.md)。生成采用内置image_gen编辑模式。

河岸、风雨、舆图和纸页保留对应墨色画法，现用基础提示集中在 `SCENES.md`。旧田间场景、被替代的赈济与复审底图、旧身份参考已清理。

精确证据由 HTML/SVG 呈现。GitHub Pages 从仓库加载 WebP，无 CDN 依赖。更新原图后运行 `python3 tools/prepare_assets.py`。

新克隆只包含可直接运行的 WebP，无需原图。常规素材测试校验全部运行图；本地保有原图时，可执行 `CHECK_SOURCE_ASSETS=1 node --test tests/art.test.mjs` 额外校验原图。
