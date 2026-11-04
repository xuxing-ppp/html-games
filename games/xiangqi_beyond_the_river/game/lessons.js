/* One deterministic script drives the guided exercises and the read-only player. */
(function(root){'use strict';
const node=typeof module!=='undefined'&&module.exports,G=node?require('./engine.js'):root.Gambit,D=G.D;
const action=(key,x,y,label,result,events=[],prepare=null)=>({kind:'action',key,x,y,label,result,events,prepare});
const inspect=(label,result)=>({kind:'inspect',unit:'e0',label,result});
const forecast=(label,result)=>({kind:'forecast',label,result});
const measured=(step,label,metric,unit)=>({...step,evidence:{label,metric,unit}});
const reset=(label,result,scene='')=>({kind:'reset',label,result,prepare:s=>restoreScene(s,scene)});
const field={kind:'field',label:'点棋盘下方的“涨潮”，查看时间和位置。',result:'时钟标记下一回合末涨潮的格子，现在站上去不会立即受伤。'};
function plan(s,e,label,steps,strong=false){e.plan={kind:e.kind,origin:{x:e.x,y:e.y},aim:{x:s.hero.x,y:s.hero.y},targetId:'hero',dir:[0,1],label,steps,strong};G.refresh(s);}
const courses=[
 {title:'行步与出牌',concept:'action',school:'sword',keys:['jab','guard','dash'],summary:'行步和迁灯共用一次普通行动；出牌支付气力。结束回合后换手、补气，旧护盾清除。',steps:[
  action('move',2,6,'点“行步”，再点 C7。','普通行步不耗气，普通行动已用。',['move']),
  action('jab',2,5,'打出“试锋”，攻击 C6 的卒。','支付1气，伤害牌进入弃牌堆。',['card','hit']),
  action('guard',2,6,'打出“护体”。','获得5护盾，护盾会先抵挡伤害。',['shield']),
  action('end',null,null,'点“结束回合”，观察换手。','新回合补回气力、抽牌，上一回合护盾清除。',['turn'])]},
 {title:'命灯与防护',concept:'beacon',school:'sword',keys:['guard','boat'],summary:'侠与命灯共用生命和护盾，最多相隔三格。行步或迁灯共用一次普通行动；同一段攻击覆盖两者只受伤一次，不同招式分别受伤。',steps:[
  inspect('点右侧的車，查看它锁定的命灯。','攻击沿原来的直线前进；只移动侠客救不了灯。'),
  action('beaconMove',4,6,'点“迁灯”，将灯移到 E7。','命灯离开冲线，与侠相距2格；本回合不能再普通行步。',['beacon-move']),
  action('end',null,null,'结束回合，确认命灯避开直冲。','直冲落空。接着观察一次同时覆盖侠与灯的横扫。',['turn'],s=>plan(s,s.enemies[0],'横扫 · 同段伤害7',[{type:'attack',cells:[{x:2,y:6},{x:4,y:6}],damage:7}],true)),
  forecast('点右上方“逐步预演”，查看这次横扫。','两身都在红区，但共用生命只结算一次7伤害。'),
  action('guard',2,6,'打出“护体”，抵挡其中5点伤害。','共享5护盾，预计失血从7降到2。',['shield']),
  action('end',null,null,'结束回合，核对共享承伤。','护盾抵挡5，生命只扣2，没有因两身同时中招扣两次。',['hit','turn'])]},
 {title:'敌方预告与套路',concept:'intent',school:'finger',keys:['guard','boat'],summary:'砲沿固定方向找目标：第一个棋子是炮架，炮架后第一个棋子才是命中目标。蓄砲先布架蓄势，下一回合命中后才产生十字溅射。目标移走、炮线再无第二个棋子时，整次溅射都不会发生；若还有目标，旁边离线的侠仍可能被溅射。',steps:[
  inspect('点砲，查看它的炮线与蓄势。','砲先布置炮架。这一回合不会立即攻击，时钟表示后续危险。'),
  forecast('点“逐步预演”，查看布架与蓄势的顺序。','先布架，再蓄势；下一回合才会寻找命中目标。'),
  action('end',null,null,'结束回合，观察砲布架并蓄势。','D4 是炮架，D7 的侠是炮架后的命中目标；十字以 D7 为中心。',['spawn','prepare','turn']),
  inspect('再次点砲，查看当前十字与目标。','这是“若现在结算”的溅射范围，不是固定在地上的爆炸区。'),
  measured(action('end',null,null,'先留在 D7，结束回合观察命中。','砲越过炮架命中侠，产生十字溅射，生命实际减少8。',['hit','turn']),'留在炮线','loss'),
  reset('恢复到同一蓄砲局面，试试移走目标。','生命、位置和蓄势已恢复；刚才的实算结果保留在对比栏。','charged'),
  action('move',2,6,'行步到 C7：这里刚才也在十字里。','侠离开炮线后，炮架后没有第二个棋子，找不到命中目标；整片十字溅射因此消失。',['move']),
  forecast('查看移动后的逐步预演。','不是走出旧十字才安全，而是没有命中目标，根本不再产生十字。'),
  measured(action('end',null,null,'结束回合，核对没有目标时的结果。','原来覆盖 C7 的十字没有发生，生命损失为0。',['turn']),'移走且无目标','loss'),
  reset('再恢复局面，这次在 D6 加一枚滚石。','滚石成为炮架后的第一个命中目标；新的十字以 D6 为中心。','rock'),
  action('move',2,6,'先行步到 C7。','侠离开直线，但滚石还在，砲仍能命中并产生溅射。',['move']),
  action('boat',2,5,'用“回舟”移到 C6，站在滚石旁边。','C6 不在炮线上，却在命中滚石后产生的十字里。',['move']),
  forecast('预演确认：这次离开炮线仍会失血8。','有实际命中目标时，必须同时避开围绕目标的十字溅射。'),
  measured(action('end',null,null,'结束回合，观察命中滚石与溅射。','砲先命中滚石，再溅射邻格的侠；离线仍失血8。',['hit','turn']),'离线但邻近目标','loss')]},
 {title:'地形与棋具',concept:'terrain',school:'palm',keys:['guard','jab','shove','shove'],summary:'爆符击破后伤自身及四邻格4点；荆棘进入伤3；推动撞上山壁或石堤再伤2。地形与棋具对敌我都有效。',steps:[
  action('guard',3,5,'先打出“护体”。','爆符也会伤到邻近的侠，先用护盾防护。',['shield']),
  action('jab',3,4,'用“试锋”击破 D5 的爆符。','爆符向四邻格爆炸，伤害4；侠的护盾抵挡这次伤害。',['explode']),
  action('move',4,5,'点“行步”，移到 E6。','站到卒的下方，准备向上推动。',['move']),
  action('shove',4,4,'用“震山”推动 E5 的卒。','卒进入荆棘，额外受伤3；未碰到障碍时不会产生碰撞。',['hit']),
  action('end',null,null,'结束回合，补回气力。','下一回合继续观察同一枚卒和山壁。',['turn'],s=>plan(s,s.enemies[0],'守势',[])),
  action('shove',4,3,'再用“震山”推动 E4 的卒。','山壁挡住去路，卒留在原格，受到2点碰撞伤害。',['collision'])]},
 {title:'河界与涨潮',concept:'river',school:'sword',keys:['dash','dash','guard'],summary:'桥渡不加费；非桥步行或迁灯每次额外耗1气；轻功只付牌费。侠每回合首次主动渡河得1势，同回合再渡、迁灯和推拉敌人不重复获得这份势。士象守岸，强制过河会失阵并优先归岸。涨潮提前一回合标格，预告回合末伤3；移河改变两岸归属，不算主动渡河。',steps:[
  measured(action('move',3,3,'先沿木桥，从 D5 行步到 D4。','桥渡只消耗普通行动，气仍为3；侠首次主动渡河获得1势。',['cross','momentum']),'步行走桥','energy'),
  reset('恢复局面，改从没有桥的 C5 过河。','已恢复3气、0势和普通行动；对比同样一格的渡河费用。','water'),
  field,
  measured(action('move',2,3,'从 C5 行步到 C4，直接涉水过河。','这次额外扣1气，剩2气；首次主动渡河同样获得1势。',['cross','momentum']),'步行涉水','energy'),
  action('dash',2,4,'同回合用“踏燕”回到 C5。','只付1气牌费，不另收河费；本回合已经靠渡河得过势，这次不再得势。',['cross']),
  action('end',null,null,'结束回合，观察涨潮时机与资源恢复。','现在进入第2回合，补回3气；涨潮从“下回合”变为“本回合末”。',['turn']),
  action('move',3,4,'先在南岸行步到 D5。','同一岸的普通行步不耗气；不会触发渡河得势。',['move']),
  measured(action('dash',2,3,'用“踏燕”轻功跃至 C4，跨过没有桥的河段。','轻功跨非桥河段只付1气牌费；新回合首次渡河再得1势。',['cross','momentum']),'轻功跨河','energy'),
  action('dash',1,3,'用第二张“踏燕”离开 C4 的涨潮标记，落到 B4。','这一步在同岸，只付1气牌费，不触发渡河奖励；侠已离开涨潮标记。',['move']),
  action('end',null,null,'结束回合，核对涨潮结算。','侠已离开涨潮标记，生命不受伤；涨潮不因过河或走桥而取消。',['tide','turn']),
  reset('换到迁灯例子：侠在 D5，命灯在 C5。','这是独立的迁灯对比；命灯与侠仍须保持最多三格距离。','lamp'),
  action('beaconMove',2,3,'把命灯从 C5 迁到没有桥的 C4。','命灯涉水也额外花1气，但不触发“侠首次主动渡河”的得势；迁灯占用本回合普通行动。',['beacon-move'])]},
 {title:'破绽与打断',concept:'weak',school:'finger',keys:['boat','snap','guard'],summary:'白菱是侠的出手站位，对应特定敌人。普通命中只造成伤害；从白菱命中能打断强招并得势。本例攻击锁定命灯，灯始终不移动，用来证明免伤来自打断。破绽不是所有牌的通用增伤；首领强招需同回合两次破绽命中。',steps:[
  inspect('点車，查看白菱和它将攻击的命灯。','D2 是侠的出手位，D4 的命灯会受5伤；侠离开红区也救不了原地的灯。'),
  action('snap',3,2,'先留在 C3，用“弹指”攻击 D3 的車。','普通命中伤害5，但强招没有取消，命灯仍将受5伤。',['hit']),
  measured(action('end',null,null,'结束回合，让未被打断的强招结算。','車命中原地的灯，共享生命实际减少5；造成伤害并不等于打断。',['hit','turn']),'普通命中后','loss'),
  reset('恢复到同一局面，这次从白菱出手。','侠、灯和敌人的原始位置已恢复，命灯仍在 D4；保留刚才的结算结果。'),
  action('move',2,1,'先行步到 C2，准备绕到車的身后。','命灯始终没有移动，仍处于敌人的攻击位置。',['move']),
  action('boat',3,1,'用“回舟”移到 D2 的白菱。','现在站入这枚車的出手位；仅站进白菱，还没有取消它的攻击。',['move']),
  action('snap',3,2,'从白菱，用同一张“弹指”攻击車。','同样伤害5，但这次强招被打断，并获得1势。',['interrupt','momentum']),
  forecast('查看预演，确认原地的命灯不再受伤。','命灯位置完全没变，预计失血从5变为0；区别来自破绽命中的打断。'),
  measured(action('end',null,null,'结束回合，核对打断后的结果。','車不再攻击，灯停在原处也安全，实际失血0。',['turn']),'破绽命中后','loss')]},
 {title:'金线与破阵',concept:'formation',school:'palm',keys:['snap','hook','snap'],summary:'金圈标阵眼，金线表示当前有效协作，具体效果要看阵法。本例士与砲同岸，士的正面护阵让砲少受2伤；把士拉过河使其失阵，保护便消失。分离成员或打断阵眼可以断线，断线不等于所有战斗立即获胜。',steps:[
  inspect('点士，查看它与金圈阵眼砲之间的金线。','这是士护砲：士在同岸提供护阵，正面攻击砲会被减伤2。'),
  measured(action('snap',3,2,'先用“弹指”攻击 D3 的砲。','牌面伤害5，护阵减伤2，砲实际只掉3生命。',['hit']),'护阵有效时','damage','e1'),
  action('hook',3,3,'用“牵丝”将 D4 的士拉过河。','士失阵后不能继续护阵，金线断开并得势；它将优先归岸。',['dislocate','break','momentum']),
  measured(action('snap',3,2,'在同一位置，再用“弹指”攻击同一枚砲。','这次没有护阵减伤，砲实际掉5生命。金线的变化确实影响伤害。',['hit']),'拉士断阵后','damage','e1')]},
 {title:'势与心法',concept:'engine',school:'palm',keys:['impact','breathe','hook','dash','jab','resolve','push','resolve','resolve','guard','guard'],opening:6,summary:'本课综合使用破阵、渡河、破绽打断与心法碰撞来得势，再实际使用灯诀、凌波和绝技。势可跨回合保留，每回合最多获得3势，最多储存4势；凌波花1势，绝技花3势，三种灯诀花2势且每战共用一次。',steps:[
  action('impact',3,5,'从0势开始，先打出心法“震脉”。','震脉本场持续有效，每回合首次敌方碰撞可以获得1势。',['power-on']),
  action('breathe',3,5,'用“凝息”让下一张牌减费1。','下一张牵丝费用变为0，为本回合留出移动和攻击的气力。',['card']),
  action('hook',3,3,'用免费的“牵丝”将 D4 的士拉过河。','破阵获得1势。推拉敌人过河本身不算侠主动渡河。',['break','momentum']),
  action('dash',3,3,'用“踏燕”跃至 D4，侠主动渡河。','本回合首次主动渡河，再得1势，目前2势；落点也是砲的白菱。',['cross','momentum']),
  action('jab',3,2,'从白菱用“试锋”命中砲，打断强招。','打断再得1势，目前3势。本回合已从破阵、渡河、打断合计获得3势。',['interrupt','momentum']),
  action('resolve',3,3,'打出0气的“剑意”，试着再获得1势。','势仍为3：储存还没满，但本回合已获得3势，不能继续增加。',['card']),
  action('end',null,null,'结束回合，观察势和心法是否保留。','3势与震脉保留；补回气力，本回合得势计数清零。守岸敌人会尝试归岸。',['turn']),
  action('push',4,3,'用“推山”把 E4 的車推向山壁。','碰撞触发震脉，本回合得1势，储存从3升到4。',['collision','momentum']),
  action('resolve',3,3,'再次打出“剑意”，试着超过4势。','势仍为4：这次是储存上限，虽然本回合只获得1势，也不能继续存。',['card']),
  action('lampEnergy',3,3,'使用左侧灯诀“续焰”。','实际消耗2势，4降到2，并获得1气；三诀共用的每战次数已用。',['lamp-art']),
  action('flowstep',3,4,'用“凌波”移到南岸 D5。','先花1势，再因新回合首次主动渡河得1势，因此仍是2势；普通行动还在。',['cross','momentum']),
  action('resolve',3,4,'再用“剑意”补足施展绝技所需的势。','从2升到3势，本回合累计获得3势。',['momentum']),
  action('move',4,4,'用保留的普通行动行步到 E5。','凌波没有占用普通行动；现在站到車的下方。',['move']),
  action('ultimate',4,3,'施展卸力掌绝技“回澜”，攻击 E4 的車。','实际消耗3势，并按真实规则伤害、推动敌人。你已练习得势、保留、上限与三种消费方式。',['ultimate'])]}

];
D.lessons=courses.map((c,i)=>({...c,title:c.title,number:i+1,subtitle:D.schools[c.school].name}));
for(const c of courses)D.concepts[c.concept]={name:c.title,text:c.summary};
D.concepts.growth.text='第一章第三程后选择进阶；前两章首领后升阶并增加气力或抽牌。每次进阶可免费删一牌，营地可选择调息或磨剑。';
function create(index=0,scene=''){
 index=Math.max(0,Math.min(courses.length-1,index));const c=courses[index],s=G.tutorial(0,c.school);
 s.guided=true;s.lessonLamp=index===7;s.lessonEvidence=[];s.lesson=index;s.lessonCursor=0;s.lessonProgress={};s.enemies=[];s.props=[];s.beacon=null;s.formation=null;s.river=null;s.bridges=[];s.fieldPlan=null;s.skirmish=null;s.trial=null;s.hero.x=3;s.hero.y=6;s.hero.shield=0;s.energy=3;s.momentum=0;s.gained=0;s.freeMove=true;s.edge=0;s.flags={};s.log=[];
 const enemy=(kind,x,y,hp=40)=>{const e=G.newEnemy(s,kind,x,y);e.id='e'+s.enemies.length;e.hp=e.maxHp=hp;s.enemies.push(e);plan(s,e,'守势',[]);return e;};
 if(index===0)enemy('pawn',2,5,5);
 if(index===1){s.hero.x=2;s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:3,y:6,hp:1,maxHp:1,shield:0};const e=enemy('rook',3,3);plan(s,e,'直冲 · 锁定命灯',[{type:'chargewalk',dir:[0,1],max:3,damage:5}]);e.plan.targetId='beacon';G.refresh(s);}
 if(index===2){const e=enemy('cannon',3,2);plan(s,e,'蓄砲',[{type:'buildframe',dir:[0,1],targetId:'hero'},{type:'charge',charge:{geometry:'cannon',dir:[0,1],damage:8,blast:true}}],true);}
 if(index===3){s.hero.y=5;enemy('pawn',4,4);s.props=[{id:'bomb',kind:'bomb',name:'爆符',x:3,y:4,hp:3,maxHp:3,shield:0,ttl:99}];s.board[3*7+4]='spikes';s.board[2*7+4]='wall';}
 if(index===4){s.hero.x=scene==='water'?2:3;s.hero.y=4;s.river=3;s.bridges=[3];s.fieldPlan={kind:'tide',due:2,damage:3,cells:[{x:2,y:3}]};if(scene==='lamp'){s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:2,y:4,hp:1,maxHp:1,shield:0};s.fieldPlan=null;}}
 if(index===5){s.hero.x=2;s.hero.y=2;s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:3,y:3,hp:1,maxHp:1,shield:0};const e=enemy('rook',3,2);plan(s,e,'折冲 · 锁定命灯',[{type:'chargewalk',dir:[0,1],max:3,damage:5,second:[1,0]}],true);e.plan.targetId='beacon';e.plan.aim={x:3,y:3};G.refresh(s);}
 if(index===6){s.hero.y=5;s.river=3;s.bridges=[3];enemy('advisor',3,3);enemy('cannon',3,2);s.formation={key:'guard_gun',name:'士护炮',ids:s.enemies.map(e=>e.id),eye:'e1',active:false,brokenTurn:-1};s.enemies[0].plan.protect=true;G.refresh(s);}
 if(index===7){s.hero.y=5;s.river=3;s.bridges=[3];s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:1,y:4,hp:1,maxHp:1,shield:0};enemy('advisor',3,3);const e=enemy('cannon',3,2);s.props=[{id:'practice-frame',kind:'flag',name:'炮架',x:3,y:1,hp:2,maxHp:2,shield:0,ttl:99},{id:'practice-target',kind:'boulder',name:'滚石',x:3,y:0,hp:30,maxHp:30,shield:0,ttl:99}];e.charge={geometry:'cannon',dir:[0,-1],damage:8,blast:true};plan(s,e,'强招待发',[{type:'release'}],true);e.plan.dir=[0,-1];enemy('rook',4,3);s.board[3*7+5]='wall';s.board[2*7+4]='wall';s.formation={key:'guard_gun',name:'士护炮',ids:['e0','e1'],eye:'e1',active:false,brokenTurn:-1};s.enemies[0].plan.protect=true;}
 s.deck=c.keys.map(k=>G.J.card(s,k));s.hand=G.clone(s.deck.slice(0,c.opening||c.keys.length));s.draw=G.clone(s.deck.slice(s.hand.length).reverse());s.discard=[];s.exhaust=[];s.events=[];G.refresh(s);if(index===2&&scene){const n=G.endTurn(s);n.events=[];if(scene==='rock')n.props.push({id:'target-rock',kind:'boulder',name:'滚石',x:3,y:5,hp:30,maxHp:30,shield:0,ttl:99});G.refresh(n);return n;}return s;
}
function restoreScene(s,scene){const cursor=s.lessonCursor,evidence=G.clone(s.lessonEvidence);Object.assign(s,create(s.lesson,scene),{lessonCursor:cursor,lessonEvidence:evidence});}

function current(s){return s?.guided&&s.phase==='battle'?courses[s.lesson].steps[s.lessonCursor]:null;}
function allowed(s,index,x,y){const step=current(s);if(!step)return !s?.guided;const key=typeof index==='number'?s.hand[index]?.key:index;return step.kind==='action'&&key===step.key&&(key==='end'||step.x==null||step.x===x&&step.y===y);}
function selectable(s,index){if(!s?.guided)return true;const step=current(s),key=typeof index==='number'?s.hand[index]?.key:index;return step?.kind==='action'&&step.key===key;}
function advance(s,step,before){if(step.evidence){const {label,metric,unit}=step.evidence;const amount=metric==='loss'?before.hero.hp-s.hero.hp:metric==='damage'?s.events.filter(e=>e.type==='hit'&&e.unit===unit).reduce((n,e)=>n+e.amount,0):before.energy-s.energy;const value=metric==='energy'?`花费${amount}气，得势${s.momentum-before.momentum}`:metric==='damage'?`实际伤害${amount}`:`实际失血${amount}`;s.lessonEvidence=[...s.lessonEvidence.filter(e=>e.label!==label),{label,value,amount}];}s.lessonCursor++;if(step.prepare)step.prepare(s);if(s.lessonCursor===courses[s.lesson].steps.length)s.phase='lesson';return s;}
function act(s,index,x,y){if(!s.guided)return G.act(s,index,x,y);const step=current(s);if(!allowed(s,index,x,y))return {ok:false,state:s,reason:step?.label||'本课已完成'};const key=typeof index==='number'?s.hand[index]?.key:index,r=key==='end'?{ok:true,state:G.endTurn(s)}:G.act(s,typeof index==='string'&&D.cards[index]?s.hand.findIndex(c=>c.key===index):index,x,y);if(!r.ok)return r;for(const type of step.events)if(!r.state.events.some(e=>e.type===type))throw Error('教学步骤未产生预期结果：'+step.label+' / '+type);advance(r.state,step,s);return r;}
function observe(s,kind,unit){const step=current(s);if(!step||step.kind!==kind||step.unit&&step.unit!==unit)return s;const n=G.clone(s);n.events=[];return advance(n,step,s);}
function tape(index=0,variant=''){
 let s=create(index);const frames=[];
 if(variant){s=create(7);s.hero.x=3;s.hero.y=4;s.formation=null;s.river=null;s.bridges=[];s.enemies=[];s.props=[];s.board=Array(56).fill('floor');const e=G.newEnemy(s,'rook',3,3);s.enemies=[e];plan(s,e,'守势',[]);s.board[2*7+3]='wall';s.tutorial=false;s.guided=false;s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:2,y:4,hp:1,maxHp:1,shield:0};s.momentum=variant==='ultimate'?3:2;s.draw=[G.J.card(s,'guard'),G.J.card(s,'jab')];const x=variant==='ultimate'?3:s.hero.x,y=variant==='ultimate'?3:s.hero.y;const label=variant==='ultimate'?'已有3势，施展卸力掌绝技“回澜”。':`已有2势，使用命灯“${G.LAMP_ARTS[variant].name}”。`;frames.push({state:G.clone(s),label,stage:'cue',step:{kind:'action',key:variant,x,y}});const r=G.act(s,variant,x,y);if(!r.ok)throw Error(r.reason);frames.push({state:r.state,label:variant==='ultimate'?'消耗3势。绝技的目标和效果取决于门派。':`消耗2势，${G.LAMP_ARTS[variant].text}；三诀共用每战一次，不占普通行动。`,stage:'result',events:r.state.events});return frames;}
 while(current(s)){const step=current(s);const label=step.kind==='inspect'?`观察${s.enemies.find(e=>e.id===step.unit)?.name||'敌人'}的预告与标记。`:step.kind==='forecast'?'观察预告的行动顺序与伤害位置。':step.kind==='field'?'观察涨潮标记和结算时间。':step.label;frames.push({state:G.clone(s),label,stage:'cue',step});let n;if(step.kind==='action'){
   if(step.key==='end'){const forecast=G.forecast(s);for(const f of forecast.frames)if(f.action.type!=='round')frames.push({state:{...G.clone(s),...f.position},label:`${f.name} · ${f.label}`,stage:'enemy',events:f.events,enemyFrame:f});}
   const index=D.cards[step.key]?s.hand.findIndex(c=>c.key===step.key):step.key;const r=act(s,index,step.x??s.hero.x,step.y??s.hero.y);if(!r.ok)throw Error('无法执行教学：'+step.label+' '+r.reason);n=r.state;
  }else n=observe(s,step.kind,step.unit);
  frames.push({state:G.clone(n),label:step.result,stage:'result',events:n.events,step});s=n;
 }return frames;
}
function cannonTrace(s,e=s.enemies.find(e=>G.parts(e).includes('cannon'))){if(!e)return null;const a=e.charge||e.plan?.steps.find(a=>a.type==='charge')?.charge||e.plan?.steps.find(a=>a.geometry==='cannon');if(a?.geometry!=='cannon')return null;const from=e.intent?.routes.find(a=>a.kind==='cannon')?.from||e,occupied=G.ray(s,from,...a.dir,a.range||8).map(q=>G.at(s,q.x,q.y)).filter(u=>u&&u.id!==e.id);return {screen:occupied[0]||null,target:occupied[1]||null};}
const api={cannonTrace,courses,create,current,allowed,selectable,act,observe,tape};if(node)module.exports=api;root.XQLessons=api;
})(typeof globalThis!=='undefined'?globalThis:this);
