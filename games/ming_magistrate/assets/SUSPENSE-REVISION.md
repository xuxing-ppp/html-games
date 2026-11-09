# v1.1 分镜与声音

使用内置图像生成工具，以已查看的运行图作参考。四个场景各有独立横版和3:4竖版；未替换旧图。原图为 `assets/originals/{以下文件名}.png`，运行版为 `assets/runtime/{以下文件名}.webp`。执行 prepare_assets.py 更新现用图片的尺寸与校验，实际数量见素材清单。

| 文件名前缀（均另有 -portrait-ink） | 参考 | 新分镜 |
| --- | --- | --- |
| names-dispute-ink | south-doorway-ink | 冬日南桥门前，两户与里长争执，县令居中示意停争；北渡头巾与南桥低帽分清 |
| boat-recant-ink | granary-audit-ink、river-night-ink | 次日晨河埠，船工守着修篙补述，雇主站后方，县令听问、典史持册 |
| relief-dispute-ink | relief-doorway-ink | 五月阴天，王氏拒签，罗氏持碗，邻人索还，林阿蘅隔开劝问 |
| escort-night-ink | granary-audit-ink、river-night-ink | 深夜灯下，典史摊手阻拦绳者，账房在后，县令持封包，无战斗或伤亡 |

## 生成提示集

共同提示：Historical-scene, landscape 3:2 illustration for the same Ming Zhejiang game. Match reference identities, simple plain clothes, village architectural relations and clean restrained xieyi Chinese ink with pale color. Newly staged dramatic conversation, expressive gestures with natural distance. Broad contiguous quiet washes, few decisive irregular ink lines. No realistic skin/hair, fabric patterns, paper grain, pepper specks, spatter, stippling, aging, tiny leaves, mottled texture, text, evidence marks or signatures.

各场景提示按上表主体、时节、动作构建。主角限定32–35、棱角脸、薄髭短颏须、蓝袍黑官帽。夜景另限定：large coherent gray-blue darkness, small warm lantern pool, no global brightening。其余角色分别保持原图服色、年龄与身份；船工雇主为匿名脚行人，不是许慎行。夜间拉绳者身份未明，不绘许家标记。

竖版提示：Make a NEW independently staged 3:4 portrait composition of the SAME scene. Preserve every character identity, age, beard, hats, plain robe colors, time of day, architecture, story action and natural interpersonal distances. Arrange group in depth, keep principal gestures central rather than cropping the wide picture. Same clean restrained xieyi ink and pale colors; no dots, grain, aging, etched texture, realistic faces, embroidery, text or seals. Night stays dark gray-blue.

验图：全部原尺寸查看；横竖均保留分工与人物距离。新图大面积墨层干净，未添加噪点或全图滤镜。手机实际构图另以浏览器截图检查。

## 声音事件

保留音乐。paper／ledger为翻纸与展卷；slip／sort／select为落签、排序与选取；seal／retry为提交后反馈；knock／steps／handover／block为敲门、脚步、递封包、拦路动静。事件只由状态推进到带cue的段落时播放一次；已有阅读位置返回、调字号和查阅重绘不重复。快速同类声音间隔至少85ms。

river／rain／night／river-night使用本地合成的12秒环境循环，淡入600ms、淡出450ms，归音效滑杆；后台及静音停止，回来恢复当前环境，不补播旧动作。只有场景发生真实变化才切换。室内默认无环境声，案头夜间使用很轻的风虫声。
