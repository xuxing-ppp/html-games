(function(root){'use strict';
const cards={};function add(key,name,cost,school,target,op,values={}){cards[key]={key,name,cost,school,target,op,...values};}
add('slash','断玉',1,'sword','adjacent','hit',{damage:6,icon:'sword',text:'相邻伤害 6。'});
add('guard','护体',1,'neutral','self','guard',{shield:5,icon:'shield',text:'护盾 5。'});
add('push','推山',1,'palm','adjacent','push',{damage:2,push:1,icon:'push',text:'伤害2，推远一格；也可迁移命灯。'});
add('dash','踏燕',1,'sword','leap','move',{range:2,icon:'swallow',text:'轻功跃至两格内，可越棋子与石障。'});
add('swap','移形',2,'neutral','enemy','swap',{range:3,icon:'swap',text:'与三格内敌棋或命灯换位。'});
add('pierce','长虹',2,'sword','line','pierce',{range:2,damage:5,icon:'sword',text:'直线两格穿刺伤害 5。'});
add('hook','牵丝',1,'palm','hook','pull',{range:3,push:1,icon:'hook',text:'拉近直线两至三格的敌棋或命灯一格。'});
add('flag','落子',1,'neutral','empty','flag',{range:3,ttl:1,icon:'flag',text:'落子作炮架或堵腿，持续一轮。'});
add('quake','破阵',2,'palm','self','quake',{damage:3,push:1,icon:'burst',text:'相邻敌棋伤害 3，推远一格。'});
add('meditate','凝神',0,'neutral','self','draw',{draw:2,exhaust:true,icon:'star',text:'抽两张。本场消耗。'});
add('heavy','崩岳',2,'palm','adjacent','hit',{damage:10,icon:'sword',text:'相邻伤害 10。'});
add('mend','回春',1,'neutral','self','heal',{heal:4,exhaust:true,icon:'heart',text:'回复生命 4。本场消耗。'});
add('double','连斩',1,'sword','adjacent','hit',{damage:4,weakBonus:4,icon:'sword',text:'伤害 4；破绽额外伤害 4。'});
add('cloud','穿云',1,'sword','line','first',{range:3,damage:5,icon:'sword',text:'直线三格首个目标伤害 5。'});
add('wind','回风',1,'sword','leap','move',{range:1,shield:3,icon:'swallow',text:'轻功一格，护盾 3。'});
add('chase','追影',1,'sword','leap','chase',{range:1,damage:3,icon:'step',text:'轻功一格，落点相邻伤害 3。'});
add('resolve','剑意',0,'sword','self','momentum',{momentum:1,exhaust:true,icon:'star',text:'获得一势。本场消耗。'});
add('blade','拔剑',2,'sword','line','pierce',{range:2,damage:8,icon:'sword',text:'直线两格伤害 8。'});
add('shove','震山',1,'palm','lineEnemy','push',{range:2,push:1,icon:'push',text:'直线两格，推远一格。'});
add('wallhit','借壁',1,'palm','adjacent','wallhit',{damage:4,bonus:4,icon:'burst',text:'伤害 4；贴障碍或边界时再伤 4。'});
add('stone','落石',1,'palm','empty','stone',{range:3,ttl:2,icon:'mountain',text:'放置生命 3 的石障，持续两轮。'});
add('thorns','拦江',1,'palm','empty','thorns',{range:3,damage:3,icon:'spike',text:'布置荆棘，进入受伤 3。'});
add('wave','翻浪',2,'palm','adjacent','push',{damage:4,push:2,icon:'push',text:'伤害 4，推远两格。'});
add('bell','金钟',2,'palm','self','guard',{shield:10,unpushable:true,icon:'shield',text:'护盾 10，本回合免推。'});
add('seal','封脉',1,'finger','enemy','seal',{range:2,damage:2,icon:'close',text:'伤害 2，封强招；首领贡献一次破绽。'});
add('expose','点星',1,'finger','enemy','expose',{range:3,icon:'star',text:'额外破绽，持续至下回合。'});
add('disrupt','截势',1,'finger','enemy','disrupt',{range:3,draw:1,icon:'close',text:'关闭本回合护阵，抽一张。'});
add('breathe','凝息',0,'finger','self','discount',{discount:1,exhaust:true,icon:'star',text:'下一张牌减费 1。本场消耗。'});
add('root','定身',1,'finger','enemy','root',{range:2,icon:'close',text:'本回合不能移动，仍可原地攻击。'});
add('needle','穿穴',2,'finger','enemy','hit',{range:2,damage:7,ignoreShield:true,icon:'sword',text:'伤害 7，忽略护盾。'});
for(const [key,name,cost,school,trigger,text]of [['flow','行云',1,'sword','身法','首次身法抽一张。'],['edge','游锋',1,'sword','渡河','首次渡河，下张剑技伤害 +3。'],['impact','震脉',1,'palm','碰撞','首次碰撞得一势。'],['mountain','护山',1,'palm','推动','首次推动敌人护盾 +3。'],['silence','封山',1,'finger','断招','首次断招，目标下次受伤 +3。'],['echo','余音',1,'finger','拆阵','首次拆阵抽一张。'],['tide','逐浪',2,'neutral','渡河','首次渡河，下张牌减费 1。'],['return','逆旅',1,'neutral','渡河','首次渡河护盾 +4。']])add(key,name,cost,school,'self','power',{power:key,trigger,icon:school==='sword'?'swallow':school==='palm'?'mountain':school==='finger'?'star':'wave',text:'心法 · '+text});
add('surf','踏浪',1,'sword','leap','move',{range:2,riverDraw:1,icon:'wave',text:'轻功两格；渡河抽一张，每回合一次。'});
add('boat','回舟',1,'neutral','leap','move',{range:1,riverEnergy:1,retain:true,icon:'wave',text:'轻功一格；渡河返一气，每回合一次。未用则保留。'});
add('across','横江',2,'sword','lineEnemy','across',{range:2,damage:6,bonus:4,icon:'sword',text:'直线伤害 6；异岸额外伤害 4。'});
add('ferry','渡厄',1,'neutral','self','ferry',{shield:5,draw:1,icon:'shield',text:'护盾 5；本回合渡河后抽一张。'});
const enemies={pawn:{name:'卒',hp:11,damage:4,glyph:'pawn'},rook:{name:'車',hp:16,damage:5,glyph:'rook'},knight:{name:'馬',hp:14,damage:5,glyph:'knight'},cannon:{name:'砲',hp:13,damage:6,glyph:'cannon'},advisor:{name:'士',hp:14,damage:4,glyph:'shield'},elephant:{name:'象',hp:18,damage:5,glyph:'mountain'},king:{name:'將',hp:46,damage:6,glyph:'king'}};
const fusions={rook_knight:{name:'車馬',parts:['rook','knight']},cannon_elephant:{name:'砲象',parts:['elephant','cannon']},rook_cannon:{name:'車砲',parts:['rook','cannon']},knight_cannon:{name:'馬砲',parts:['knight','cannon']},advisor_rook:{name:'士車',parts:['advisor','rook']},advisor_knight:{name:'士馬',parts:['advisor','knight']},knight_elephant:{name:'馬象',parts:['knight','elephant']},pawn_advisor:{name:'卒士',parts:['pawn','advisor']}};
const formations=[{key:'guard_gun',name:'士护炮',kinds:['advisor','cannon','pawn'],eye:'cannon',partners:['advisor','cannon']},{key:'pincer',name:'双卒夹锋',kinds:['pawn','pawn','knight'],eye:'pawn',partners:['pawn','pawn']},{key:'chase',name:'车马追杀',kinds:['rook','knight','pawn'],eye:'rook',partners:['rook','knight']},{key:'quell',name:'象炮镇地',kinds:['elephant','cannon','pawn'],eye:'cannon',partners:['elephant','cannon']},{key:'wall',name:'士象铁壁',kinds:['advisor','elephant','rook'],eye:'elephant',partners:['advisor','elephant']},{key:'command',name:'将卒号令',kinds:['king','pawn','advisor'],eye:'king',partners:['king','pawn']}];
const relics={heart:{name:'赤玉',icon:'heart',text:'生命上限 +8，恢复 8。'},shield:{name:'玄武印',icon:'shield',text:'护体、金钟额外护盾 3。'},impact:{name:'惊堂木',icon:'burst',text:'敌人碰撞伤害 +2。'},step:{name:'流云履',icon:'step',text:'每场首次身法牌返一气。'},sword:{name:'松纹剑',icon:'sword',text:'破绽伤害 +2。'},dart:{name:'燕尾镖',icon:'swallow',text:'首次移动，对相邻最低血敌人伤害 1。每回合一次。'},chime:{name:'断线铃',icon:'star',text:'每回合首次拆阵抽一张。'},book:{name:'残谱',icon:'stack',text:'每回合首次得势护盾 +2。'},river:{name:'河图',icon:'wave',text:'每回合首次渡河额外得一势。'},stone:{name:'山骨印',icon:'mountain',text:'每回合首次破石障返一气。'},mist:{name:'流霞佩',icon:'step',text:'每场首次凌波不耗势。'},sheath:{name:'无锋鞘',icon:'sword',text:'每场首次绝技只需二势。'}};
const mutations={armor:{name:'重甲',icon:'shield',text:'正面伤害 -2，破绽忽略。'},swift:{name:'疾行',icon:'step',text:'步行 +1，额外暴露破绽。'},watch:{name:'戒备',icon:'eye',text:'离开邻位受伤 2，每回合一次。'},reverb:{name:'回响',icon:'undo',text:'强招原区域下回合半伤余波。'}};
const schools={sword:{name:'游身剑',char:'剑',icon:'sword',text:'身法抽牌，踏隙连斩。',ultimate:'掠影'},palm:{name:'卸力掌',char:'掌',icon:'push',text:'借壁引河，推山破阵。',ultimate:'回澜'},finger:{name:'点穴指',char:'指',icon:'star',text:'封招截势，穿穴制敌。',ultimate:'截脉'}};
const layouts=['渡口','桥阵','山道','庭院','断岸','旷野'],events=['访剑','赌棋','破庙','残谱','渡口','镖局','旧棋摊','断桥'];
// Third edition: eighteen cards per school, twelve shared cards.
add('riverblade','掠江',2,'sword','leap','chase',{range:2,damage:5,riverBonus:2,icon:'wave',text:'轻功两格，相邻伤害5；渡河时伤害+2。'});
add('sheathe','藏锋',1,'sword','self','sheathe',{shield:4,bonus:3,icon:'shield',text:'护盾4，下一张伤害剑技伤害+3。'});
add('swordreturn','剑返',1,'sword','adjacent','hit',{damage:5,moveDraw:1,icon:'sword',text:'伤害5；本回合已主动移动则抽一张，每回合一次。'});
add('snow','点雪',1,'sword','line','first',{range:2,damage:4,strongBonus:2,icon:'sword',text:'直线两格首个目标伤害4；准备强招时再伤2。'});
add('shadow','流影',1,'sword','self','power',{power:'shadow',trigger:'破绽',icon:'swallow',text:'心法：首次破绽命中，本回合凌波免耗势，仍限一次。'});
add('bindhand','缠手',1,'palm','lineEnemy','pull',{range:2,damage:3,push:1,icon:'hook',text:'直线两格伤害3，再拉近一格。'});
add('shiftmount','挪山',1,'palm','adjacent','push',{push:1,shieldAfter:2,icon:'push',text:'推远相邻敌人一格，护盾2。'});
add('shatter','摧甲',1,'palm','adjacent','hit',{damage:4,strip:true,icon:'burst',text:'移除目标护盾，再伤害4。'});
add('wallburst','壁震',2,'palm','lineEnemy','push',{range:2,damage:5,push:1,collisionSplash:3,icon:'burst',text:'直线伤害5，推远一格；碰撞时相邻其他敌人伤害3。'});
add('steadymount','镇岳',1,'palm','self','guard',{shield:4,collisionShield:2,icon:'mountain',text:'护盾4；本回合碰撞再获盾2，最多两次。'});
add('backtide','回潮',1,'palm','self','power',{power:'backtide',trigger:'失阵',icon:'wave',text:'心法：每回合首次使敌人失阵抽一张。'});
add('snap','弹指',1,'finger','enemy','hit',{range:3,damage:5,icon:'star',text:'三格内伤害5。'});
add('mark','留痕',1,'finger','enemy','mark',{range:3,marks:2,icon:'star',text:'三格内增加两枚穴印；上限三枚。'});
add('stackfinger','叠指',1,'finger','enemy','hit',{range:2,damage:3,marks:1,preserveMarks:true,icon:'star',text:'伤害3，增一枚穴印；本次保留已有穴印。'});
add('pursuepoint','追穴',1,'finger','enemy','hit',{range:2,damage:4,killDraw:1,icon:'sword',text:'两格内伤害4，击杀后抽一张。'});
add('gather','凝气',1,'finger','self','gather',{shield:4,discount:1,icon:'shield',text:'护盾4，本回合下一张指技减费1。'});
add('bindpulse','缚脉',2,'finger','enemy','root',{range:2,damage:4,icon:'close',text:'两格内伤害4，本回合定身。'});
add('counter','反针',1,'finger','self','guard',{shield:5,counter:3,icon:'shield',text:'护盾5；本回合下次被攻击命中，反伤3。'});
add('sever','断络',1,'finger','enemy','disrupt',{range:3,strip:true,icon:'close',text:'三格内移除护盾，关闭本回合护阵。'});
add('returnbreath','归息',0,'finger','self','draw',{draw:1,breakShield:2,exhaust:true,icon:'star',text:'抽一张；已打断强招则护盾2。本场消耗。'});
add('silk','悬丝',1,'finger','self','power',{power:'silk',trigger:'穴印',icon:'hook',text:'心法：每回合首次消耗穴印，护盾3。'});
add('jab','试锋',1,'neutral','adjacent','hit',{damage:5,icon:'sword',text:'相邻伤害5，可攻击棋具。'});
add('hold','固守',2,'neutral','self','guard',{shield:9,stillBonus:3,icon:'shield',text:'护盾9；本回合尚未主动移动则额外护盾3。'});
add('steady','稳息',1,'neutral','self','steady',{shield:3,draw:1,icon:'star',text:'护盾3，抽一张。'});
Object.assign(schools.sword,{hp:36,passive:'游锋',passiveText:'首次主动移动后，下张伤害剑技+2。',paths:['身法连击','渡河拔剑'],starter:['slash','slash','slash','guard','guard','dash','dash','wind','double','meditate']});
Object.assign(schools.palm,{hp:40,passive:'卸势',passiveText:'首次推拉敌人获盾2，首次敌方碰撞抽一张。',paths:['借壁碰撞','引河失阵'],starter:['jab','jab','guard','guard','push','push','hook','stone','boat','meditate']});
Object.assign(schools.finger,{hp:34,passive:'留穴',passiveText:'首次成功控制或贡献断招，增加一枚穴印。',paths:['封招反击','蓄印爆发'],starter:['jab','jab','guard','guard','seal','expose','root','needle','boat','meditate']});
Object.assign(relics,{tassel:{name:'剑穗',school:'sword',icon:'sword',text:'每场首次伤害剑技抽一张。'},cloudpin:{name:'流霞扣',school:'sword',icon:'swallow',text:'每回合首次轻功落入破绽位，护盾2。'},bracelet:{name:'沉香腕',school:'palm',icon:'push',text:'每回合首次主动碰撞，敌人额外伤害1。'},tidalring:{name:'引潮环',school:'palm',icon:'wave',text:'每场首次强制敌人过河，伤害3。'},needles:{name:'银针匣',school:'finger',icon:'star',text:'每场首次增加穴印，额外一枚。'},pulsejade:{name:'息脉玉',school:'finger',icon:'star',text:'每回合首次打断强招，返一气。'}});
const chapters=[
 {id:1,name:'渡口风烟',subtitle:'借河分敌',theme:'ferry',boss:'镇河将',hp:60,layouts:['渡口','桥阵','旷野'],events:['访剑','赌棋','破庙','残谱','渡口','镖局','旧棋摊','断桥','船翁'],favored:['rook_knight','advisor_knight','pawn_advisor']},
 {id:2,name:'铁关机阵',subtitle:'拆枢开路',theme:'fort',boss:'千机侯',hp:80,layouts:['山道','庭院','城关'],events:['访剑','赌棋','破庙','残谱','渡口','镖局','旧棋摊','断桥','机关匠'],favored:['cannon_elephant','rook_cannon','advisor_rook']},
 {id:3,name:'无界残山',subtitle:'移河破局',theme:'moon',boss:'无界棋主',hp:104,layouts:['断岸','镜河','浮台'],events:['访剑','赌棋','破庙','残谱','渡口','镖局','旧棋摊','断桥','照影','问心'],favored:['knight_cannon','knight_elephant']}
];
layouts.push('城关','镜河','浮台');events.push('船翁','机关匠','照影','问心');
const bossCycles={1:['点将','蓄力','渡口强攻','收式'],2:['布枢','机关冲击','换位刺击','散热'],3:['車压阵','馬占势','蓄无界','断河','收势']};
const enemyHelp={pawn:'追击后刺击固定交点；夹锋推进后封住两侧。',rook:'直冲三格，攻击首个棋子；折冲有第二段。',knight:'走日字，蓝圈是马腿；占住马腿可堵住。',cannon:'沿固定方向隔一个炮架射击，炮架后的第一个棋子是命中目标；没炮架时会主动布架。蓄砲命中后才产生以目标为中心的十字溅射，炮架后无目标则不溅射；旁边离开炮线的侠或命灯仍可能受伤。',advisor:'同岸护阵，推拉过河使其失阵、关闭保护。',elephant:'斜跃两格，中点是象眼；镇地伤害在回合末。',king:'普通将号令与短线出招；首领按公开招式循环。'};
const lessons=[
 {title:'一 · 落子出招',subtitle:'行步与出牌',steps:['点行步，再选绿色的交点。','试锋攻击相邻的卒。','打出护体，再结束回合。']},
 {title:'二 · 护灯落位',subtitle:'一命双身，一步两用',steps:['点①車，看它正锁定谁。','点灯迁往绿点；与行步共用一次。','护体守住侠与灯，再结束回合。']},
 {title:'三 · 三种防守',subtitle:'躲、挡、先破敌',steps:['试锋击杀贴身的卒，取消其攻击。','行步离开红区，或用护体抵挡。','结束回合，对照预计与实际损失。']},
 {title:'四 · 白菱破绽',subtitle:'踏隙拆阵',steps:['点白菱，查看对应编号。','踏燕落入白菱，再以断玉击砲。','断强招，拆金线，得势。']},
 {title:'五 · 两岸分敌',subtitle:'引士过河',steps:['点士，查看守岸纹与金线。','牵丝拖士过河，让它失阵。','踏浪渡河，触发获势与抽牌。']},
 {title:'六 · 棋具拆招',subtitle:'堵腿，拆枢',steps:['点馬，蓝圈标出它的马腿。','落子堵腿，试锋击破阵枢。','点右上眼睛，逐步查看结果。']},
 {title:'七 · 借势连招',subtitle:'运转自己的武学',steps:['先运心法，再移动、碰撞或封招。','用一势凌波；每回合仅一次。','凑足三势，施展绝技。']},
 {title:'八 · 携灯入阵',subtitle:'自由破局',steps:['看敌人锁定的是侠，还是灯。','行步与迁灯共用一次，先救险处。','击破阵眼返气，借势清除余敌。']}
];
const api={cards,enemies,fusions,formations,relics,mutations,schools,layouts,events,chapters,bossCycles,enemyHelp,lessons};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.XQData=api;
})(typeof globalThis!=='undefined'?globalThis:this);

/* Run growth and illustrated battlefields. */
(function(root){const D=root.XQData;
D.signatures={sword:'flow',palm:'impact',finger:'silence'};
for(const [k,v] of Object.entries(D.schools)){const i=v.starter.indexOf('guard');v.starter=[...v.starter];v.starter[i]=D.signatures[k];}
D.paths={
 shadowblade:{school:'sword',name:'连影',core:'chase',icon:'swallow',tags:['dash','chase','wind','flow','double','swordreturn','shadow'],stages:['前两次身法：下张剑技＋2','前两张剑技：下张身法减费1','第三张剑技：追加半伤剑影'],chain:'行云 → 踏燕 → 追影 → 剑返 → 剑影'},
 riverblade:{school:'sword',name:'渡江',core:'surf',icon:'wave',tags:['surf','boat','edge','across','riverblade','tide','ferry'],stages:['首次渡河：抽1，剑技＋3','首次渡河：再返1气','首次异岸命中：身后两格剑波4'],chain:'踏浪 → 游锋 → 横江 → 贯岸剑波'},
 wallpalm:{school:'palm',name:'借壁',core:'wallburst',icon:'mountain',tags:['push','wallhit','stone','wallburst','impact','mountain','steadymount'],stages:['首次敌方碰撞：伤害＋2','前两次碰撞：各获盾3','首次碰撞：向邻敌溅伤4'],chain:'落石堵线 → 推山碰撞 → 壁震扩散'},
 tidepalm:{school:'palm',name:'引河',core:'wave',icon:'wave',tags:['hook','wave','backtide','shove','bindhand','boat','quake'],stages:['首次强制敌人过河：伤害4','该次过河：抽1，返1气','落点邻敌：向外推1格'],chain:'牵丝过河 → 失阵 → 翻浪 → 连锁推阵'},
 sealpoint:{school:'finger',name:'蓄印',core:'mark',icon:'star',tags:['mark','stackfinger','needle','silk','gather','snap','pursuepoint'],stages:['穴印上限提升至5','首次消耗至少3印：返1气','同时向两格内最近另一敌转2印'],chain:'留痕 → 叠指 → 穿穴 → 转印续爆'},
 counterpoint:{school:'finger',name:'截势',core:'expose',icon:'star',tags:['seal','expose','silence','echo','sever','returnbreath','disrupt'],stages:['首次完整断强招：加2印','同次断招：抽1，获盾3','目标下一次受指技额外＋6'],chain:'点星 → 踏隙 → 封脉 → 截脉爆发'}
};
D.chapters[0].layouts=['狭渡','双桥','曲岸','洲渡','芦汀','回湾'];D.chapters[1].layouts=['关道','折巷','缺庭','环堡','齿门','曲廊'];D.chapters[2].layouts=['双岛','阶台','十字','残环','悬桥','孤峰'];
D.objectives={hold:{name:'夺渡',icon:'flag',text:'命灯停在渡符，累计守住两轮；或清场。'},cores:{name:'破枢',icon:'star',text:'击破两座阵枢；或清场。'},escape:{name:'护灯撤离',icon:'lantern',text:'灯到出口，侠在灯旁结束回合；或清场。'}};
D.props={breakwall:{name:'破墙',char:'墙',hp:5,text:'挡路挡射线。击破后开放通路。'},boulder:{name:'滚石',char:'石',hp:6,text:'能推，能碰撞，能堵腿，也可作炮架。'},bomb:{name:'爆符',char:'爆',hp:3,text:'击破后，对自身和四邻格造成4伤。双方均可利用。'},shrine:{name:'灵台',char:'灵',text:'命灯回合末停驻，下一回合额外1气。每座每战一次。'}};
D.concepts={
 action:{name:'行步与出牌',text:'每回合气力支付牌费。行步一格或迁灯两格，共用一次普通行动。先看结果，再结束回合。'},
 beacon:{name:'一命双身',text:'侠与命灯共用生命和护盾，最多相隔三格。同一段攻击覆盖两者只受伤一次；不同招式分别受伤。'},
 intent:{name:'敌方预告',text:'红区是本回合伤害位置。点选敌棋，展开它的蓝色移动箭头、落点残影与伤害数字；时钟表示后续危险。悬停格子可看伤害来源。右侧可逐步预演，或用全览比较全部预告。'},
 terrain:{name:'地形与棋具',text:'山壁和边缘石堤挡路，推动撞击伤2；荆棘进入伤3；裂隙和悬空不能步行进入，强推会坠落。破墙、滚石、爆符与灵台可以改变战局。'},
 weak:{name:'白菱 · 破绽',text:'点选敌人或准备出招时显示白菱。白菱是你的出手站位，不是敌人弱点所在格。站入白菱，用伤害招式命中对应编号敌人，可打断强招并得势。首领强招需同回合两次。'},
 formation:{name:'金圈与金线',text:'金圈标出阵眼。点选关联敌棋时，金线显示当前有效协作；全览可展开全部关系。打断阵眼、分离队友或拆炮架可断线。精英阵眼倒下会返气、令余敌露绽；仍须清场。'},
 river:{name:'河界与失阵',text:'步行非桥渡河多耗1气，轻功免河费。首次主动渡河得势。士象不能主动离开所属岸；强推过河会失阵，停止护阵并优先归岸。'},
 engine:{name:'运转武学',text:'心法打出后本场生效。先搭心法，再用身法、碰撞或断招触发收益。每回合最多得3势，存4势；凌波1势，绝技3势。'},
 objective:{name:'不同的胜法',text:'夺渡守住渡符两轮，破枢击破两座机关，撤离让灯抵达出口、侠贴近护送。三种任务都可以选择清场获胜。'},
 growth:{name:'武学进阶',text:'第一章营地选路线，出营前可改。前两章首领后升阶，并增加气力或抽牌。进阶提供一次免费删牌；不影响本次营地的调息或升级。'}
};
const specs=[['落子出招','action',['看牌费与相邻目标','行步到绿点，再试锋','护体后结束回合']],['护灯落位','beacon',['蓝箭锁定的是命灯','迁灯两步，躲开冲线','对比护灯前后的预计失血']],['看清一招','intent',['点①車，查看移动和攻击','逐步预演，看红区的伤害','行步脱险，结束回合核对']],['借地制敌','terrain',['看爆符：击破会伤邻格','试锋引爆，再推敌入荆棘','观察伤害，可以撤销重试']],['白菱破绽','weak',['白菱是侠客的站位','踏燕落入白菱','断玉命中对应敌人，断招得势']],['金线棋阵','formation',['金圈是阵眼，金线是协作','牵丝分离护阵双方','金线断开，保护同时消失']],['借河分敌','river',['士的底纹标明所属岸','牵丝拖它过河，观察失阵','踏浪渡河触发身法与得势']],['一套武学','engine',['先打出本派心法','用身法、碰撞或断招触发','凌波后，攒势施展绝技']],['另一种胜法','objective',['灯笼出口是撤离目标','迁灯到出口，侠贴近护送','结束回合完成撤离']],['携灯入阵','growth',['选择一种解局思路','行步、迁灯、拆线配合','自由清场，不限定出牌顺序']]];
D.lessons=specs.map(([title,concept,steps],i)=>({title:`${i+1} · ${title}`,subtitle:D.concepts[concept].name,concept,steps}));
})(typeof globalThis!=='undefined'?globalThis:this);

(function(D){D.formationHelp={guard_gun:'距离不超过2、同岸且有炮架。合式会预告侧路镇地2；士的护阵正面减伤2。',pincer:'距离不超过3。合式让同伴推进；分离双方或打断阵眼即可拆开。',chase:'距离不超过4。合式额外预告侧路镇地2；分离双方或打断阵眼即可拆开。',quell:'距离不超过4且有炮架。合式预告侧路镇地2；堵象眼、拆架或分离可破。',wall:'距离不超过2且同岸。合式为近邻增加护盾2；诱士象失阵或分离可破。',command:'距离不超过2且同岸。合式推进同伴；阵旗还能为附近其他敌棋增伤1。'};})(globalThis.XQData);

globalThis.XQData.layouts=globalThis.XQData.chapters.flatMap(c=>c.layouts);

/* Optional discoveries on the longer journey. */
(function(D){D.events.push('井泉','遗阵','灯市','试武','纸鸢','星坛');D.chapters[0].events.push('井泉','遗阵');D.chapters[1].events.push('灯市','试武');D.chapters[2].events.push('纸鸢','星坛');})(globalThis.XQData);
