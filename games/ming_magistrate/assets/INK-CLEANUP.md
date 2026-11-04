# 水墨清稿记录

本轮使用内置 imagegen，以各自原图为编辑目标，逐张清理26份在用PNG。最终文件保存在 `assets/originals/<文件名>.png`，对应运行文件为 `assets/runtime/<文件名>.webp`。没有使用CLI生成、全局提亮、模糊滤镜、降噪滤镜或缩放代替清稿。原尺寸、横竖比例及场景裁切映射保留。

核仓、灯下案头、乡间赈济分别确定日景、夜景与户外的清稿尺度：去掉墙面、纸面、肤色和衣物上的随机碎点；成片墨色、轮廓、枯笔及晕染继续承担造型。夜景保留冷暗环境与小范围暖灯，阴雨仍为冷灰。保留树叶、瓦口、米粒等有形体意义的细节，不把它们一律抹平。

## 提示集

首组三幅原图编辑使用以下提示：

> Edit the supplied illustration, not a new composition. This is a restrained Chinese ink-and-pale-color hand-painted Ming county magistrate game scene. Clean the image's dirty pepper specks, random black spatter, chipped blotches and unnecessarily busy dry-brush texture, especially on skin, robes, walls, floor, furniture and blank paper. Replace those incidental flecks with coherent fluid brush contours and quiet contiguous ink washes. Preserve expressive intentional brush strokes, important dark outlines, facial features, foliage shapes and ink diffusion. Keep every person, face identity, age, thin moustache and short chin beard, pose, gesture, object, architecture, perspective, layout and crop exactly as the source. Preserve the original light direction, local light sources, shadow placement, color temperature, dark/light hierarchy and overall exposure. Absolutely do not globally brighten or wash out the scene to remove dirt. Keep night scenes genuinely dark with their small warm lamp and cool dark exterior; keep daylight scenes at their original brightness. People and background must have the same understated ink-wash simplification; no realistic skin or material microtexture, no vector/cartoon transformation, no glossy surfaces. Same landscape aspect ratio and full composition. No writing, stamps, new objects or new detail. Only clean and unify the existing painting.

其余逐张编辑共用提示：

> Use case: identity-preserve. Edit target: the supplied existing Ming county ink painting. Only clean random dirty black specks, fragmented chipped texture and pepper spatter on faces, robes, walls, floor and furniture. Replace that noise with quiet contiguous pale-color washes and coherent expressive ink lines. Preserve Chinese ink-and-pale-color medium, intentional dry brush and natural ink diffusion, not vector art, not realism. Keep every face identity/age/facial hair, figure, pose, object, architecture, perspective, placement and full crop exactly as supplied. Keep the SAME original aspect ratio. Preserve lighting direction, shadows, original exposure and color temperature; do not brighten globally or flatten dark ink to clean it. Main young magistrate keeps his thin moustache and short chin beard. No new text, objects or details. Make people and architecture equally restrained in brush detail.

在共用提示后按图片追加以下约束：

- 县境、案头、春秋田间、米行：`Keep distant foliage as masses, not pepper-dot clusters. Preserve all surface shapes and the paper's subtle warmth.` 案头另加 `Remove distracting crumple mottling from the blank central paper; preserve its aged warm color, not increased exposure.`
- 退补、复审、巡抚、书斋、冬赈：`The winter scene remains cold and pale with unpainted snow, never warmer or brighter.` 巡抚及书斋另加 `Preserve older protagonists' same facial structure, grey temples, moustache and short chin beard.`
- 三幅原有结局、夜泊、风雨：`The rain scene must remain grey, overcast and muted. The river night and evening town must stay dark blue with only localized warm lantern light; retain dark shadow values exactly. Straw capes and water ripples keep structured brush marks but no random pepper speckles.`
- 舆图：`This is an interactive map: exactly lock coastlines, river bends, all buildings and landmarks at the SAME image coordinates and same 3:2 framing. No repositioning, no crop, no terrain redesign. Only simplify tiny pepper marks within existing color areas.`
- 信笺：`Keep the blank page's boundary, folds and pen unchanged, but subdue dirty mottling on the blank sheet; preserve its warm old ivory value, no exposure lift.`
- 河埠：`Keep stone-block contours but replace fussy gritty spots with broad muted ink shapes.`
- 宣纸：`This is a quiet square paper texture, no scene or figures. Preserve warm off-white value exactly, soften over-crumpled relief and dirty tiny flecks into subtle flat xuan paper fibers; no dark blotches, gradients, painted objects, lettering or edges.`

春秋田间两幅清稿后单独补齐主角面部连续性，以已清稿图为编辑目标：

> Use case: identity-preserve. Edit target: the supplied cleaned Chinese ink-and-pale-color illustration. One precise continuity correction only: the YOUNG magistrate in BLUE/SLATE robes and BLACK scholar cap, standing beside the peasant, must have the same very thin moustache and short pointed chin beard as the other magistrate paintings. Add only a few restrained ink strokes of facial hair. Keep his same angular face, age 32–35, expression, eyes, hat, hair, body, pose and all framing. Keep the peasant's face unchanged. Do not add hair to other people. Keep every background, object, existing brushstroke, colors, original lighting, shadows and exposure unchanged. Maintain exactly the same dimensions and 3:2 composition. Do not introduce texture, black speckles, words or extra detail. This is a tiny face-only correction to an existing image.

## 逐图检查要点

| 文件名 | 主要清理与保留内容 |
| --- | --- |
| county-atlas | 细碎树石墨点归整；河道、城门、桥、粮仓及渡口位置保留，交互坐标仍用原图3:2空间 |
| county-ink | 远山树丛碎点收拢，保留雾气、河面留白与城墙层次 |
| desk-night-ink | 桌面、衣袍与墙面碎纹理归整；夜空、暗角与灯下局部暖色保留 |
| desk-scene | 纸面斑驳减轻，保留窗格投影、纸色与笔砚位置 |
| ending-exile-ink | 墙、衣袍与湿地碎斑归整，保留雨势、蓑衣结构与阴冷明暗 |
| ending-justice-ink | 石阶、衣袖和围墙清理，保留交付文卷的动作、门楼与石狮 |
| ending-town-ink | 人物衣服与岸边碎点归整，保留傍晚冷蓝、店铺灯火及水面倒影 |
| farmland-autumn-consistent | 秋田与衣袍碎点归整，保留收割层次；主角薄髭、短颏须与其他场景衔接 |
| farmland-scene-consistent | 田埂、衣服与石界清理，保留春田水光；主角薄髭、短颏须与其他场景衔接 |
| granary-audit-ink | 粮袋、蓝袍、肤色与地面清理，保留核仓动作、粮粒与透窗日光 |
| hai-meeting-ink | 桌面、脸与衣袍归整；横版三人、门、廊柱及视线关系保留 |
| hai-portrait-ink | 同一会面竖版独立构图清理，人物与横版成组核对 |
| letter-folio | 空白纸面的斑驳减轻，保留折痕、纸边、笔及河景 |
| market-scene | 衣物、街面与墙面碎点归整，保留檐下阴影、米筐与买卖人物 |
| mystery-governor-ink | 衣袍、石岸与舆图碎斑归整，保留自然衰老的脸型及河工关系 |
| mystery-restitution-ink | 粮袋、衣袍与仓院清理，保留验粮动作及红衣来人 |
| mystery-review-ink | 人物、桌面与庭院碎斑归整，保留堂上人物立场与冬日层次 |
| mystery-writer-ink | 桌面、书卷与衣物清理，保留老年人物面貌、茶叙动作与湖景 |
| opening-portrait-ink | 衣袍、桌案、院地清理，竖版递状距离与门廊保留 |
| opening-scene-ink | 与竖版成组核对，薄髭短颏须、人物动作与院落结构保留 |
| river-night-ink | 石阶、粮袋、船篷碎点归整，冷蓝深夜与暖灯范围保留 |
| river-rain | 衣物、草木与泥岸碎点归整，保留冷灰风雨、浑水及抢护动作 |
| river-scene | 石岸、衣物与船身碎斑归整，保留河埠搬粮、木板与船只位置 |
| village-relief-ink | 墙面、肤色、蓝袍与空地清理，保留问话动作、竹篱与远村 |
| winter-relief-ink | 墙面、袍服与粮袋碎斑归整，保留寒冷白雪、递粮动作与人群 |
| xuan-paper | 检查纸纤维与折皱，不引入黑斑、渐变或可辨图案；纸色延续原值 |

所有最终PNG与WebP的尺寸、字节数和SHA-256见 `docs/asset-manifest.json`。原尺寸观察、缩略图对照及运行时裁切检查分开进行；前两项用于人物、笔墨和光影，运行检查用于构图焦点与横竖版本切换。
