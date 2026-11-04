# 图片资源

当前保留26组运行原图与WebP，压缩运行图约9.1 MiB。`originals/`是本地维护原图（不入 Git），`runtime/`供离线游戏，质量84且不缩小原始尺寸。尺寸、字节与SHA-256见 `docs/asset-manifest.json`。另有一张旧核仓身份参考保存在`reference/`，不入 Git，也不进入运行包。

`js/ui/art-data.js`明确选择场景、人物焦点和专用竖图。舆图使用完整地图坐标，叙事画使用cover铺满。开场与海瑞会面为横竖独立构图，保持人物距离、正确视线和同一围院。

人物、夜景与结局16幅重绘为偏写意的淡设色水墨，人物与环境采用相同笔墨概括程度。减少细致皮肤、密绣纹、材质贴图和碎黑点；阴雨、室内、晴日、暮色与深夜分别安排明暗。见[统一规则](MYSTERY.md)和[实际最终提示](INK-PROMPTS.md)。生成采用内置image_gen编辑模式。

基础乡野、河岸、舆图和纸页保留对应墨色画法，早期提示见`SCENES.md`、`VARIANTS.md`。失效构图与旧运行图已移除。

精确证据由HTML/SVG呈现，全部画面离线加载，无CDN；原图不进入交付ZIP。维护命令：`python3 tools/prepare_assets.py --pack`，仅改代码用`--pack-only`。

新克隆只包含可直接运行的 WebP，无需原图。常规素材测试校验全部运行图；本地保有原图时，可执行 `CHECK_SOURCE_ASSETS=1 node --test tests/art.test.mjs` 额外校验原图。无原图时使用 `python3 tools/prepare_assets.py --pack-only` 打包。生成 ZIP 保留本地，不入 Git。
