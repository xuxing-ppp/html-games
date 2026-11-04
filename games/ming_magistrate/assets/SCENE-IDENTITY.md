# 人物、条目与剧情配图一致性

本轮使用内置 imagegen 原图编辑，新增10份分镜（含北渡横竖两版），并维护22位人物的原生SVG小头像。PNG保存在 `assets/originals/`，运行WebP保存在 `assets/runtime/`。尺寸与校验见 `docs/asset-manifest.json`。所有最终版本保留水墨淡设色与原有光源层次，去掉不必要的衣服纹样、微小材质与喷溅碎点。

## 已修复

- 吴长生的姓名字段统一为“吴长生”，住处分列为“北渡农户／南桥农户”。索引、署名、回看及材料入口共用人物ID和称谓，身份签不附田号、已交、欠粮等判题结论。
- 22位小头像分别配置脸型、发式、服饰、姿态和必要手持物；同名农户与秋娘不再近似通用村民。多年后主角仍用同一脸型，再加自然年龄变化。
- 文书中的人物入口标明“相关人物”，与文书制作人或材料取得途径分开表达。
- 北渡送回单场景改正误标的县衙地点；复查告示到堂日期统一腊月初三；认罪状事件范围包含五月错账，初六书写、初八递交仍分开。
- 家属访谈补明罗素贞只许核家书日期、不愿当众念信的立场，与小传和后续札记对应。段落索引、材料发放、判题与存档格式均未改变。
- 账房和驿舍查簿使用文书画面，取消独自灯下写字、夜泊卸粮的错误代替；交易契不再使用秋娘递状图。

## 分镜对应

| 文件名 | 场景 | 动作与人物 |
| --- | --- | --- |
| north-hearing-ink / north-hearing-portrait-ink | 吴长生上堂 | 吴长生展收据；主角俯案；经手人侧身翻册 |
| north-repair-ink | 北渡查访、送更正回单 | 主角在修船处看凭据，吴长生离开船底答话 |
| south-doorway-ink | 南桥问户 | 主角放低文书听陈述；农户站门边，旧丧布留在凳旁 |
| estate-dock-ink | 二月陆庄西埠问账 | 主角指账；陆文谦坐案边；许慎行递单；周衡指船 |
| lin-hearing-ink | 林阿蘅递灾户合状 | 主角停笔听状；林阿蘅指向院外；差役携卷出门 |
| relief-doorway-ink | 王氏、罗素贞家访与后续 | 王氏与两个孩子在门边，林阿蘅请坐，主角落座倾听 |
| clerk-account-ink | 陶承简供述与分问 | 主角并列原纸、账册追问；陶停笔；后侧经手人另记 |
| review-hearing-ink | 三轮复审与裁定 | 顾廷章着文官服；许慎行着商人服，各陈原据 |
| enforcement-grain-ink | 次年春判决执行 | 林阿蘅核名单、主角指登记粮袋，已判徒的许慎行不再出场 |

同地点保持建筑、光影和角色身份；新场面同时安排主角、对方与后方人物，不以仅换对面人物交付。`art-data.js` 的新条目记录 cast、setting、action，供维护核对，不参与判题或给玩家提示答案。

## 实际提示集

编辑共用约束：

> Use case: identity-preserve. Edit the supplied existing Chinese ink-and-pale-color game illustration to correct the depicted event. Preserve the restrained, clean, fluid ink lines and quiet contiguous washes; no random pepper spots, chipped speckle, photorealistic skin, glossy materials or vector style. Preserve the magistrate's SAME angular 32–35-year-old face, straight brows, thin moustache, short chin beard, blue robe and black Ming cap. Preserve original light direction, color temperature, exposure, shadows, architecture and full composition except the specifically requested cast/action changes. No lettering, logos or stamps. 

### 场面调度

**north-hearing-ink**；原图：opening-scene-ink

> Keep the original wide landscape frame and county yamen architecture, pale daylight and visual style. Re-stage this as a DIFFERENT hearing with Beidu Wu Changsheng. Remove the female petitioner. Wu is a lean sun-tanned male farmer/boat repairer about 40, angular face, sparse stubble, beige cloth headwrap tied behind, brown-gray short work tunic with rolled sleeves. He stands on the right close to the desk, unfolding a worn receipt flat across the tabletop with both work-worn hands, a plain straw hat at his side. The same magistrate on the left has now RISEN slightly from his chair and LEANS FORWARD to examine the receipt: one hand holds its far edge, the other points to the half-seal area (no painted marks or writing). Do NOT reuse the original open-palm greeting gesture. The gray-robed recorder behind is now SIDE-ON, bending over an OPEN LEDGER on a side table, turning a page rather than standing straight holding a tablet. A background attendant has paused by the courtyard gate, watching. Keep body proportions, faces, hands and gazes natural. Preserve desk inkstones, enclosed white walls, gray roofs, timber columns, courtyard gate and original light/shadow direction; adjust local shadows only as poses require. Clean deliberate washes, no speckle.

**north-hearing-portrait-ink**；原图：opening-portrait-ink

> Keep the original independent 3:4 portrait frame and SAME county yamen architecture/light/style. Compose a visibly DIFFERENT hearing rather than swapping only the petitioner. Remove the woman. On right, Beidu Wu Changsheng, lean sun-tanned male about 40, angular face, sparse stubble, beige headwrap tied behind, rolled-sleeve brown-gray tunic, leans toward desk while unfolding a worn receipt flat on it with both hands; plain straw hat hangs at his side. Magistrate on left has RISEN from chair and leans forward, one hand steadying the paper, the other indicating a spot on it; no original greeting hand pose. Recorder in gray behind is SIDE-ON at a narrow side table, turning a ledger page, not standing frontally holding a tablet. A courtyard attendant pauses to watch. Preserve SAME protagonist angular face/thin moustache/short chin beard/blue robe/black cap, natural distance and readable bodies. Keep the framed courtyard white wall, gray tiles, wooden gate and tree, sun direction and quiet pale washes. No written text or seals.

**estate-dock-ink**；原图：river-scene

> Keep 3:2 landscape, same restrained ink medium, riverside white buildings, old bridge, stone dock and boats. Re-stage the foreground as an early-second-month inquiry at a wealthy estate's west wharf, NOT autumn harvest or field measurement. A low wooden table with opened transport ledgers sits on the stone landing. The same magistrate, blue robe and black cap with thin moustache/short chin beard, stands at LEFT pointing to separate columns of two open records. At RIGHT sits Lu Wenqian, a broad-faced middle-aged estate owner with a trimmed dark beard, olive-brown well-kept robe and plain dark scholar cap, one hand resting tensely on the table. Just behind, merchant Xu Shenxing, leaner man about 40, rust-red robe and small dark soft cap, holds out his own transport slip. A gray-robed officer gestures toward moored empty cargo boats farther back. All human poses, scale and composition should read as a tense documentary inquiry, not people hauling grain. Keep distant ordinary boat traffic, the river path and architecture; cool late-winter muted greenery, no ripe fields, sheaves or golden autumn foliage. No labels or writing, no guilt symbols, no handcuffs.

**clerk-account-ink**；原图：opening-scene-ink

> Keep wide landscape frame, SAME enclosed county office courtyard, daylight direction, brush style and magistrate identity. Re-stage the desk scene as Tao Chengjian correcting an account. Remove the original female petitioner. Tao: male around 50, narrow lined face, short untidy beard, dark brown cloth cap, plain warm gray-brown robe, stands at the RIGHT with an open account book set on the desk, his brush hand paused above a line, other hand keeping the original loose receipt beside it. Magistrate sits on LEFT, body turned toward Tao and an open ledger, one hand pressing a loose original paper and the other indicating the ledger, rather than greeting. Rear recorder has moved to the left side of desk, seated sideways copying notes, not standing in the original pose. Quiet tense conversation, no grain being poured. Keep the magistrate's blue robe/black cap/thin moustache/short chin beard, yamen table/inkstone, original white wall/gate/tree/columns. No writing or seals visible.

### 南桥与灾户访谈、递状

**relief-doorway-ink**；原图：village-relief-ink

> Keep 3:2 landscape, same house doorway, river bridge, May daylight direction and quiet clean ink. Completely re-stage the foreground to match this household interview. Widow Wang is a worried 30–35-year-old woman with black hair in a low bun, plain dark-brown robe and pale collar, standing at the doorway with TWO small children just behind her. Luo Suzhen, another woman around 35 in ochre-gray robes and tidy bun, stands nearby holding a small folded private letter at her waist. Lin Aheng, woman about30 with a neat hairpin bun and gray-green robe, stands beside Wang with a petition tucked at her side, one hand inviting her to sit on a low stool. On RIGHT, the same blue-robed magistrate has put the ledger down on a low bench and BENDS SLIGHTLY to listen at the family's eye level, hands relaxed near the record, not standing upright staring down at paper as in source. No elderly basket woman, no male household head, no grain baskets being offered. A respectful unresolved conversation, not a distribution or happy ending. Preserve protagonist identity, simple faces and coherent anatomy. Preserve background building relations, not original character blocking.

**south-doorway-ink**；原图：village-relief-ink

> Keep 3:2 landscape, same rural wooden door, white wall, river bridge and cool pale winter daylight, with muted winter plants instead of lush May leaves. Re-stage foreground. Remove the two basket-holding elderly people. Nanqiao Wu Changsheng is a younger male farmer about30, clean-shaven long face, dark low cloth cap, charcoal-gray plain robe, standing in his doorway with empty hands gathered at waist, speaking openly. Folded old white mourning cloth lies on a stool near the threshold. The same magistrate in blue stands to the RIGHT but now turns SIDEWAYS toward the doorway, closed document lowered to his left side while his right hand lightly indicates a place to sit. He looks at the man, not down at an open page. A grey-robed assistant waits farther behind with a closed folio. Clearly different pose and staging from the source village interview. No women, children, baskets or grain distribution. Keep same protagonist face, mustache and chin beard; clean same ink language.

**lin-hearing-ink**；原图：opening-scene-ink

> Keep the original wide landscape yamen frame, courtyard white walls, gate, columns and pale daylight. Re-stage it for an urgent May petition by Lin Aheng. Remove the brown-robed peasant woman from the original. Lin is about30, neat black hairpin bun, plain gray-green robe, wet shoes and damp lower hem. She stands near the RIGHT end of desk, placing a small stack of folded petition pages on it with one hand, the other hand gesturing back toward the courtyard as she describes waiting households. The same magistrate on LEFT sits turned toward her, has set down his brush and rests one hand on the closed ledger, listening rather than extending the original greeting palm. In the BACKGROUND the gray-robed officer is no longer standing squarely holding a tablet: he walks toward the open side corridor with a tied folio under his arm, ready to arrange a village visit. Keep protagonist angular32–35 face/thin moustache/short chin beard/blue robe/black cap. No rice bags, no triumphant resolution, no written text, no extra decorative texture.

### 复审与执行

**review-hearing-ink**；原图：mystery-review-ink

> Fix costume identity ONLY in addition to brush simplification: the man standing to the RIGHT of the magistrate in a brown fur-trimmed cape and gold-topped military hat is GU TINGZHANG, a CIVIL prefect, not a general. Replace the fur cape and gold military hat with a plain charcoal-gray civil official robe and ordinary BLACK WINGED Ming civil official cap, keep his same mature broad face, trimmed dark beard, stance and hands. Rust-red merchant beside him remains a merchant with simple dark soft cap, not an official winged hat. Keep protagonist, elderly gray-bearded seated review official and left witness/recorder unchanged. No other people, architecture or light changes. Winter courtroom remains cold, daytime. No robe patterns. Same3:2.

**enforcement-grain-ink**；原图：mystery-restitution-ink

> This painting depicts the NEXT SPRING enforcement of the judgment, not the earlier March disputed handover. Keep magistrate's same identity/blue robe but change his action: he holds a closed ledger at waist, one open hand indicating the separate sacks being registered, not scooping a handful of grain. Grain worker on right ties the filled sack neck rather than holding it open to be inspected. REPLACE the rust-red-robed merchant standing on the left (he has been convicted and must not appear supervising official enforcement) with LIN AHENG: adult woman about30, neat bun with simple hairpin, plain gray-green robe, checking an open list and brush at her side. Background porters now carry sacks in an orderly line toward the storehouse; one clerk registers a porter at a small standing desk. County granary architecture and same spring daylight remain. Every person in the same restrained ink style; no realistic fabric or rich robe motifs. No text/signatures/stamps visible. Same3:2 composition and exposure.

### 北渡修船

> Keep landscape 3:2, the same pale winter daylight, riverside stone landing, boats, white houses, bridge and distant scenery. Replace the nearest foreground cargo-lifting activity with a small upside-down timber skiff on supports and wood shavings by the shore. At the left foreground the same blue-robed magistrate reads a folded worn receipt; facing him is Beidu Wu Changsheng, lean tanned man around 40, angular cheeks, slight moustache, beige headcloth tied behind, brown-gray work tunic with rolled sleeves. He has just stepped away from repairing the skiff; a small saw lies safely on the bench. Two loose sheets in his hands can serve as the old receipt and correction. No inscribed words or painted seals. Calm early-spring scene, not autumn harvest; keep all figures at comparable brush simplification.

### 统一笔墨、控制噪点

> Use case: style-transfer / identity-preserve. Image 1 is the EDIT TARGET, Image 2 is brushwork/style reference only. Keep the exact framing, all figures, facial identities, ages, poses and gaze, body proportions, architecture, objects, light direction, shadow hierarchy, exposure and colors of Image 1. Repaint people AND background in restrained clean xieyi Chinese ink-and-pale-color language consistent with Image 2: decisive but irregular ink contours, quiet contiguous washes, a few expressive fold strokes, selective soft diffusion and unpainted paper. REMOVE all small decorative brocade, floral/leaf/scroll designs, fabric weave and microtexture from EVERY robe; the blue magistrate and brown farmer/clerk wear plain cloth. Simplify realistic skin shading, hairs, leaves, stones and etched wood detail into larger brush shapes. No realistic illustration finish, no filter simulation, no new story details. Absolutely no pepper flecks, spatter, chipped dry brush crumbs, busy mottled noise, crumple grain, global brightening, sharpening or blur. Protagonist keeps angular face, thin moustache, short chin beard, black cap. Leave faint blank ruling on documents but remove all readable writing, painted signatures, marks or seals. Same input aspect ratio. 

### 陆庄问账水墨重整

> Use case: style-transfer / identity-preserve. Image 1 is the EDIT TARGET, a correctly staged riverside ledger inquiry. Image 2 is STYLE REFERENCE ONLY for restrained Chinese ink and pale-color brushwork. Repaint Image 1 into the same simplified, expressive xieyi ink-wash language as Image 2. Keep Image 1's exact composition, all character identities and ages, gestures, positions, gazes, table, ledger, boats, dock, bridge, architecture, crop and 3:2 aspect. The BLUE magistrate keeps his angular face, thin moustache, short chin beard and pointing hand. Merchant in rust red and landowner in olive brown keep their identities and poses; officer still points toward boats. Important style correction: remove realistic face shading, tiny individual hairs, detailed fabric weave, brocade and robe motifs. Use a few decisive facial lines, soft flat skin wash, simple broad robe washes with expressive fold strokes. Background must have SAME simplified ink treatment as people: group willow leaves, tiles, boat wood and stones into coherent brush masses, omit etched microdetail, allow quiet untouched paper and soft diffusion at selected edges. This must look visibly more ink-wash and less polished realistic illustration, not a watercolor filter over detailed drawing. Keep original daylight direction, exposure, cold muted color temperature and shadow hierarchy; do not brighten globally. Absolutely NO pepper specks, spatter, dappled black noise, chipped dry-brush crumbs, gritty aging, crumpled texture, over-sharpening or blur filter. Retain clean intentional dark outlines and natural larger wet washes. Ledger may have faint blank ruling only, no readable text, seals, symbols or new evidence. No new characters, objects or story details.

### 商人帽式修订

> Precise identity/costume correction to the supplied Chinese ink-wash illustration. Change ONLY the HAT on the rust-red-robed merchant at the FAR RIGHT EDGE. He is Xu Shenxing, a civilian grain merchant, not a government officer. REMOVE the long horizontal black official hat wings from HIS hat and replace HIS hat with a small plain dark soft cloth merchant cap tied close to the head, with NO wings and NO gold ornaments. Keep his same face, beard, expression, red robe, body, position and hands. Do not alter the black winged official cap of the DARK-GRAY-ROBED prefect immediately to his left, or the BLUE magistrate, or seated gray-bearded reviewer. All other people, objects, architecture, composition, original 3:2 dimensions, palette and light must remain unchanged. Preserve existing clean broad xieyi ink-and-pale-color brushwork, no added speckles, realistic shading, fabric texture, patterns, text or symbols. Only far-right merchant's hat.

北渡横竖清理另加约束：收据约前臂宽，不画作铺满整桌的舆图；保持主角俯身与经手人侧向翻册。所有候选均先看原尺寸，最终版本再核三档字号、桌面、手机与短横屏中的实际裁切。未选的候选不加入项目和离线包。

