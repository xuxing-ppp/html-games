# 三幅配图定向修整

本轮使用内置 imagegen 原图编辑，替换以下三份PNG；运行WebP、图片校验清单与离线包同步更新。未改剧情、证据、场景标识、存档或裁切焦点。

| 文件 | 修改重点 | 保留内容 |
| --- | --- | --- |
| north-repair-ink | 用核仓图对齐写意程度，归整木船、绳索、衣袍、柳叶和水纹的细密刻画 | 北渡人物身份、修船工具、对收据的动作、河埠构图及原有日光 |
| ending-town-ink | 清理石阶、岸墙、衣物及远山的细碎斑驳，改为连贯墨面 | 冷蓝暮色、暗部、局部暖灯与倒影；不靠全图提亮去噪 |
| ending-justice-ink | 主角对齐核仓图的脸型、眉眼、薄髭与短颏须；沈砚对齐开场的成熟面容和短须 | 数年后自然成熟，保留交卷动作、角色位置、建筑和日光 |

原图：`assets/originals/<文件名>.png`；运行图：`assets/runtime/<文件名>.webp`；尺寸与SHA-256：`docs/asset-manifest.json`。

## 最终提示集

### north-repair-ink

编辑目标与参考顺序：`north-repair-ink.png`、`granary-audit-ink.png`。

> Use case: style-transfer. Image 1 is the EDIT TARGET, the existing north dock boat-repair scene; image 2 is a STYLE AND MAGISTRATE IDENTITY reference only. Repaint image 1 with the noticeably more loose, hand-brushed Chinese xieyi ink-and-pale-color character of image 2. Retain image 1's entire 3:2 landscape composition: magistrate in blue and black official cap at left reading the receipt, brown-clad tan boat repairer in beige headwrap facing him holding his papers, overturned boat on trestles and saw bench at right foreground, river, stone steps, willow, two bridges, boats and village. Keep all actual figure poses, actions, scale, anatomy, props and architecture placements. Transform the drawing language throughout BOTH people and background: expressive variable ink contours, selectively soft lost edges, broader flowing washes of blue/gray/earth color and economical brush indications. Simplify carefully etched timber, rope braiding, dense willow leaves, roof tiles, every little wave and wood shavings into coherent hand-painted shapes. No smooth digital realism, comic outlines, meticulously rendered face shading or fabric texture. Main magistrate remains the SAME angular lean-faced man about 32–35 with high cheekbones, straight brows, calm narrow eyes, thin moustache and short pointed chin beard from image 2; repairer keeps his own tanned face and stubble. Preserve original daylight direction, muted color temperature, paper warmth, shadows and exposure; do not brighten or bleach the picture. Clean quiet connected washes, NO pepper noise, black spatter, grunge, scattered flecks or new paper mottling. Meaningful ink marks may remain but no texture over faces, sky or robes. Do not add or remove characters/objects, no lettering, no new decoration. Keep 1536x1024 landscape composition.

### ending-town-ink

编辑目标与参考顺序：`ending-town-ink.png`。

> Use case: identity-preserve. Edit only the supplied evening canal-town Chinese ink-and-pale-color painting. Clean the excessive dirty speckles and mottled fragmented brush-noise, especially the foreground stone steps and parapets, white plaster walls, people's clothing and skin, distant hills and water. Replace random black chips, tiny dabs and stains with coherent gently diffused ink washes and a few purposeful brush contours. Retain the same restrained xieyi ink painting, lively meaningful brushwork and all faces, ages, poses and objects exactly: family carrying kindling and vegetable baskets up the foreground steps, boatman, other pedestrians, canal, bridge, white houses, rooftops, willow and red plum. Preserve original 3:2 composition, perspective, proportions and all placements. CRITICAL LIGHTING LOCK: this is cool blue-gray dusk, NOT daytime. Retain the source's dark cool hills, blue-gray canal, original shadow values and overall exposure. Only existing lanterns/windows make small warm amber pools and short reflections. Do not raise brightness or whiten/bleach the stone, walls or paper while cleaning. Keep shadow planes of foreground steps softly gray and robes their original middle-to-dark values. No global exposure change, no milky veil, no new lights or expanded glow. Broad quiet connected washes instead of surface grit; do not flatten all ink into vector fills or add realistic textures. No pepper specks, spatter, stippling, extra grain, text or new detail. Maintain 1536x1024 landscape.

### ending-justice-ink

编辑目标与参考顺序：`ending-justice-ink.png`、`granary-audit-ink.png`、`opening-scene-ink.png`。

> Use case: identity-preserve. Image 1 is the EDIT TARGET, the existing official delivering a tied packet at stone steps. Image 2 supplies the canonical BLUE-ROBED MAGISTRATE FACE; image 3 supplies the magistrate again plus SHEN YAN, the gray-robed moustached adviser standing directly behind him. Correct character identity continuity in image 1 ONLY, in the same understated Chinese ink-and-pale-color medium. The central blue-robed official must clearly be the same lean angular man from images 2/3: high cheekbones, straight brows, calm narrow eyes, slightly sun-tanned face, same nose/jaw, very thin moustache and SHORT pointed chin beard. This scene is a few years after his county term, about late 30s/early 40s, subtly more mature, not a different round-faced youth or an elderly long-bearded man. Keep existing hat, blue official robe, small chest emblem, posture and packet handover. The light gray-robed adviser immediately BEHIND him must be Shen Yan from image 3: mature lean face, narrow eyes, thin moustache and small short chin beard, same plain dark scholar cap, slightly older than the magistrate, no boyish clean-shaven face. Keep his existing position, body, clothing and gesture. Other residents, messenger in straw cape and figures stay their own distinct people; do not give everyone the protagonist's face. Lock the entire existing image-1 composition, building gate/walls, stone lions, autumn trees, steps, canal, bridges, boats, all figures and props and poses. Match ink simplification of reference paintings in the corrected faces: a few expressive strokes, no realistic skin or hair rendering. Preserve original daylight, local shadows, color temperature and exposure without brightening. Keep calm washes and no newly added black specks, paper noise, stippling or embroidery. Preserve 1536x1024 landscape. No text or new objects.

