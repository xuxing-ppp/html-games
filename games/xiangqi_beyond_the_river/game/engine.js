/* 楚河行 — immutable public transitions, deterministic event-driven combat. */
(function(root){'use strict';
const node=typeof module!=='undefined'&&module.exports,D=node?require('./data.js'):root.XQData,J=node?require('./journey.js'):root.XQJourney,A=node?require('./arenas.js'):root.XQArenas;
const DIRS=[[0,-1],[1,0],[0,1],[-1,0]],HORSE=[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]];
const TETHER=3;
const clone=o=>JSON.parse(JSON.stringify(o)),inside=(s,x,y)=>{if(typeof s==='number'){y=x;x=s;s={width:7,height:8};}return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<(s.width||7)&&y<(s.height||8);},dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y),same=(a,b)=>a&&b&&a.x===b.x&&a.y===b.y,coord=(x,y)=>'ABCDEFGHI'[x]+(y+1);
const tile=(s,x,y)=>inside(s,x,y)?s.mask&&s.mask[y*(s.width||7)+x]===false?'void':s.board[y*(s.width||7)+x]:'wall',living=s=>s.enemies.filter(e=>e.hp>0),units=s=>[s.hero,...(s.beacon?[s.beacon]:[]),...s.enemies,...s.props].filter(e=>e.hp>0),at=(s,x,y)=>units(s).find(e=>e.x===x&&e.y===y),enemyAt=(s,x,y)=>living(s).find(e=>e.x===x&&e.y===y),wall=(s,x,y)=>tile(s,x,y)==='wall'||s.props.some(p=>p.hp>0&&['stone','breakwall'].includes(p.kind)&&p.x===x&&p.y===y);
const bank=(s,p)=>s.river===null?null:p.y<=s.river?0:1,crosses=(s,a,b)=>s.river!==null&&bank(s,a)!==bank(s,b),bridge=(s,a,b)=>a.x===b.x&&s.bridges.includes(a.x),parts=e=>D.fusions[e.kind]?.parts||[e.kind],restricted=e=>parts(e).some(k=>['advisor','elephant'].includes(k)),component=(s,e)=>D.fusions[e.kind]?parts(e)[(s.turn+e.offset)%2]:e.kind;
const allied=u=>u&&(u.id==='hero'||u.id==='beacon');
function emit(s,type,values={}){if(s.trial&&['cross','collision','interrupt','break'].includes(type)&&!s.trial.feats.includes(type))s.trial.feats.push(type);s.events.push({type,...values});if(s.events.length>250)throw Error('联动事件过多');}
function once(s,key){if(s.flags[key])return false;s.flags[key]=true;return true;}
function shield(s,n){if(n<=0||s.hero.hp<=0)return;s.hero.shield+=n;emit(s,'shield',{unit:'hero',amount:n});}
function gain(s,n){n=Math.min(n,3-s.gained,4-s.momentum);if(n<=0||s.hero.hp<=0)return;s.momentum+=n;s.gained+=n;emit(s,'momentum',{amount:n});if(s.relics.includes('book')&&once(s,'book'))shield(s,2);}
function draw(s,n){let count=0;for(let i=0;i<n;i++){if(s.hand.length>=10)break;if(!s.draw.length)s.draw=J.shuffle(s,s.discard.splice(0));if(!s.draw.length)break;s.hand.push(s.draw.pop());count++;}if(count)emit(s,'draw',{amount:count});}
function power(s,key){const p=s.powers[key];return p?p.stacks+(p.level&&!['flow','impact','silence'].includes(key)?1:0):0;}
function trigger(s,name,ctx={}){
 const fire=(key,fn)=>{const n=power(s,key),limit=['flow','impact','silence'].includes(key)&&s.powers[key]?.level?2:1;if(n&&times(s,'power-'+key,limit)){emit(s,'power',{key,amount:n});fn(n);}};
 if(name==='move'){
  s.flags.moved=true;progress(s,'move');if(s.school==='sword'&&once(s,'school-move')){s.edge+=2;emit(s,'passive',{key:'sword'});}
  fire('flow',n=>draw(s,n));
  if(s.relics.includes('dart')&&once(s,'dart')){const e=living(s).filter(e=>dist(e,s.hero)===1).sort((a,b)=>a.hp-b.hp)[0];if(e)hit(s,e,1,{relic:true});}
 }
 if(name==='cross'){
  if(once(s,'cross'))gain(s,1);progress(s,'cross');if(s.battleBoat&&!s.relicUsed.boatBless){s.relicUsed.boatBless=true;draw(s,1);}
  fire('edge',n=>s.edge+=3*n);fire('tide',n=>s.discount+=n);fire('return',n=>shield(s,4*n));
  if(s.relics.includes('river')&&once(s,'river'))gain(s,1);
 }
 if(name==='collision'){progress(s,'collision',ctx);fire('impact',n=>gain(s,n));if(s.school==='palm'&&once(s,'school-collision')){draw(s,1);emit(s,'passive',{key:'palm'});}if(s.collisionShield&&(s.flags.collisionShield||0)<2){s.flags.collisionShield=(s.flags.collisionShield||0)+1;shield(s,s.collisionShield);}}
 if(name==='push'){fire('mountain',n=>shield(s,3*n));if(s.school==='palm'&&once(s,'school-push'))shield(s,2);}
 if(name==='interrupt'){fire('silence',n=>{if(ctx.enemy)ctx.enemy.vulnerable+=3*n;});progress(s,'interrupt',ctx);}
 if(name==='break'){
  fire('echo',n=>draw(s,n));
  if(s.relics.includes('chime')&&once(s,'chime'))draw(s,1);
 }
}
function enemyUnit(u){return !!u&&(!!D.enemies[u.kind]||!!D.fusions[u.kind]);}
function pathOn(s,key,rank=1){return s.pathKey===key&&s.tier>=rank;}
function times(s,key,limit=1){const n=Number(s.flags[key]||0);if(n>=limit)return false;s.flags[key]=n+1;return true;}
function progress(s,event,ctx={}){
 if(event==='move'&&pathOn(s,'shadowblade')&&times(s,'path-moves',2)){s.edge+=2;emit(s,'path',{key:s.pathKey,event});}
 if(event==='cross'&&pathOn(s,'riverblade')&&once(s,'path-river')){draw(s,1);s.edge+=3;if(s.tier>=2){s.energy++;emit(s,'energy',{amount:1});}emit(s,'path',{key:s.pathKey,event});}
 if(event==='collision'&&pathOn(s,'wallpalm')){if(s.tier>=2&&times(s,'path-wall-shield',2))shield(s,3);if(s.tier>=3&&once(s,'path-wall-splash')){const p=ctx.at||ctx.enemy;if(p)for(const e of living(s).filter(e=>e.id!==ctx.enemy?.id&&dist(e,p)===1))hit(s,e,4,{source:'hero',echo:true});}emit(s,'path',{key:s.pathKey,event});}
 if(event==='consume'&&pathOn(s,'sealpoint',2)&&ctx.marks>=3&&once(s,'path-mark-refund')){s.energy++;emit(s,'energy',{amount:1});if(s.tier>=3){const next=living(s).filter(e=>e.id!==ctx.enemy.id&&dist(e,ctx.enemy)<=2).sort((a,b)=>dist(a,ctx.enemy)-dist(b,ctx.enemy)||a.id.localeCompare(b.id))[0];if(next)addMark(s,next,2);}emit(s,'path',{key:s.pathKey,event});}
 if(event==='interrupt'&&pathOn(s,'counterpoint')&&ctx.enemy?.plan?.strong&&once(s,'path-counter')){addMark(s,ctx.enemy,2);if(s.tier>=2){draw(s,1);shield(s,3);}if(s.tier>=3)ctx.enemy.fingerVulnerable=(ctx.enemy.fingerVulnerable||0)+6;emit(s,'path',{key:s.pathKey,event});}
}
function tideProc(s,e){if(!enemyUnit(e)||!pathOn(s,'tidepalm')||!once(s,'path-tide'))return;hit(s,e,4,{source:'hero',echo:true});if(s.tier>=2){draw(s,1);s.energy++;emit(s,'energy',{amount:1});}if(s.tier>=3){const near=living(s).filter(v=>v.id!==e.id&&dist(v,e)===1).map(v=>({id:v.id,dx:Math.sign(v.x-e.x),dy:Math.sign(v.y-e.y)}));for(const q of near){const v=living(s).find(v=>v.id===q.id);if(v)pushUnit(s,v,q.dx,q.dy,1);}}emit(s,'path',{key:s.pathKey,event:'forced-cross'});}
function blast(s,cells,damage,source){let shared=false;for(const q of cells){const u=at(s,q.x,q.y);if(!u)continue;if(allied(u)){if(shared)continue;shared=true;}hit(s,u,damage,{source});}}
function planField(s){if(s.tutorial)return;if(s.fieldPlan&&s.fieldPlan.due>=s.turn)return;s.fieldPlan=null;if(s.river===null)return;if(s.turn%3!==1)return;if(s.chapter===1){const options=s.board.map((t,i)=>({x:i%s.width,y:Math.floor(i/s.width),t})).filter(q=>q.t==='floor'&&(q.y===s.river||q.y===s.river+1)&&!s.bridges.includes(q.x));const start=(s.encounterSeed+s.turn)%Math.max(1,options.length);s.fieldPlan={kind:'tide',due:s.turn+1,damage:3,cells:options.slice(start,start+2).map(({x,y})=>({x,y}))};}if(s.chapter===3){const r=s.river>=Math.floor(s.height/2)?s.river-1:s.river+1;s.fieldPlan={kind:'river',due:s.turn+1,river:Math.max(1,Math.min(s.height-3,r)),cells:[]};}}
function applyField(s){if(s.fieldPlan?.due!==s.turn)return;if(s.fieldPlan.kind==='tide'){blast(s,s.fieldPlan.cells,3,'tide');emit(s,'tide',{cells:s.fieldPlan.cells});}else if(!s.riverShiftedTurn||s.riverShiftedTurn!==s.turn)shiftRiver(s,s.fieldPlan.river);}
function tickObjective(s){if(s.beacon)for(const q of s.shrines||[])if(!q.used&&same(s.beacon,q)){q.used=true;s.queuedEnergy=(s.queuedEnergy||0)+1;emit(s,'shrine',{at:q,amount:1});}const o=s.objective;if(!o||!s.beacon)return;if(o.kind==='hold'&&same(o,s.beacon)){o.progress++;o.complete=o.progress>=2;emit(s,'objective',{kind:o.kind,progress:o.progress});}if(o.kind==='escape'&&same(o,s.beacon)&&dist(s.hero,s.beacon)===1){o.complete=true;emit(s,'objective',{kind:o.kind,progress:1});}}

function cardInfo(c,s){if(typeof c==='string')c={key:c,level:0};const d={...D.cards[c.key],level:c.level||0};if(d.level){if(d.op==='power'){if(d.power==='shadow')d.cost=0;}else if(d.op==='thorns')d.range++;else if(['flag','stone'].includes(d.op))d.ttl++;else if(d.damage)d.damage+=2;else if(d.shield)d.shield+=3;else if(d.heal)d.heal+=2;else if(d.draw)d.draw++;else if(d.marks)d.marks++;else if(d.range)d.range++;else if(d.push)d.push++;else if(d.momentum)d.momentum++;else if(d.discount)d.discount++;}d.actualCost=s?Math.max(0,d.cost-s.discount-(d.school==='finger'?(s.fingerDiscount||0):0)-(['move','chase'].includes(d.op)?s.bodyDiscount||0:0)):d.cost;return d;}
function ray(s,p,dx,dy,max=8){const out=[];if(!dx&&!dy)return out;for(let i=1;i<=max;i++){const q={x:p.x+dx*i,y:p.y+dy*i};if(!inside(s,q.x,q.y))break;if(wall(s,q.x,q.y)){if(s.props.some(p=>['stone','breakwall'].includes(p.kind)&&same(p,q)))out.push(q);break;}out.push(q);}return out;}
function route(s,start,max=99,{returning=false,enemy=false}={}){
 const seen=new Map([[start.y*(s.width||7)+start.x,0]]),q=[{x:start.x,y:start.y,cost:0,toll:0,path:[]}];
 for(let i=0;i<q.length;i++){const p=q[i];for(const [dx,dy]of DIRS){const n={x:p.x+dx,y:p.y+dy};if(!inside(s,n.x,n.y)||wall(s,n.x,n.y)||['pit','void'].includes(tile(s,n.x,n.y))||at(s,n.x,n.y))continue;if(start.kind==='beacon'&&dist(s.hero,n)>TETHER)continue;if(enemy&&restricted(start)&&!returning&&s.river!==null&&bank(s,n)!==start.home)continue;const cost=p.cost+1+(enemy&&crosses(s,p,n)&&!bridge(s,p,n)?1:0),k=n.y*(s.width||7)+n.x;if(cost>max)continue;const toll=(p.toll||0)+(start.kind==='beacon'&&crosses(s,p,n)&&!bridge(s,p,n)?1:0),quality=start.kind==='beacon'?cost*10+toll:cost;if(seen.has(k)&&seen.get(k)<=quality)continue;seen.set(k,quality);q.push({...n,cost,toll,path:[...p.path,n]});}}
 return q.slice(1).filter(p=>start.kind!=='beacon'||seen.get(p.y*(s.width||7)+p.x)===p.cost*10+p.toll);
}
function weakPoints(s,e,plan){if(!plan.strong&&!e.exposed)return [];const [dx,dy]=plan.dir;const opts=[{x:e.x-dx,y:e.y-dy},{x:e.x-dy,y:e.y+dx},{x:e.x+dy,y:e.y-dx},...DIRS.map(([x,y])=>({x:e.x+x,y:e.y+y}))];const out=[];for(const p of opts)if(inside(s,p.x,p.y)&&!wall(s,p.x,p.y)&&!['pit','void'].includes(tile(s,p.x,p.y))&&!out.some(q=>same(p,q))){out.push(p);if(out.length>=(e.mutation==='swift'||e.exposed||plan.recover?2:1))break;}return out;}
function connected(s){const f=s.formation;if(!f||f.brokenTurn===s.turn||!living(s).some(e=>e.id===f.eye))return false;const es=f.ids.map(id=>living(s).find(e=>e.id===id));if(es.some(e=>!e||e.dislocated||e.cancelled||e.suppressed))return false;const max=['chase','quell'].includes(f.key)?4:f.key==='pincer'?3:2;if(dist(es[0],es[1])>max)return false;if(['guard_gun','quell'].includes(f.key)){const gun=es.find(e=>component(s,e)==='cannon');if(gun){const points=ray(s,gun,...gun.plan.dir);const screen=points.find(q=>at(s,q.x,q.y));if(!screen||same(screen,s.hero)||!points.some(q=>dist(q,gun)>dist(screen,gun)))return false;}}if(['guard_gun','wall','command'].includes(f.key)&&s.river!==null&&bank(s,es[0])!==bank(s,es[1]))return false;return true;}
function breakFormation(s){const f=s.formation;if(!f||f.brokenTurn===s.turn)return;f.brokenTurn=s.turn;f.active=false;emit(s,'break',{name:f.name});if(!s.actionRewarded){gain(s,1);s.actionRewarded=true;}trigger(s,'break');}
function interrupt(s,e,force=false){if(e.cancelled||e.hp<=0)return;e.breakHits++;const threshold=e.boss?2:1;if(e.breakHits>=threshold&&(!e.boss||e.plan?.strong)){e.cancelled=true;e.charge=null;s.flags.interrupted=true;if(s.relics.includes('pulsejade')&&once(s,'pulsejade')){s.energy++;emit(s,'energy',{amount:1});}emit(s,'interrupt',{unit:e.id});trigger(s,'interrupt',{enemy:e});if(s.formation?.eye===e.id)breakFormation(s);}if(!e.rewarded){e.rewarded=true;schoolControl(s,e);if(!s.actionRewarded){gain(s,1);s.actionRewarded=true;}}}
function guardCover(s,e){return living(s).some(g=>g.id!==e.id&&parts(g).includes('advisor')&&!g.dislocated&&!g.cancelled&&!g.suppressed&&g.plan?.protect&&dist(g,e)<=2&&(s.river===null||bank(s,g)===bank(s,e)));}
function isWeak(s,e){return e.intent?.weak?.some(p=>same(p,s.hero));}
function addMark(s,e,n=1){if(!e||e.hp<=0||!(D.enemies[e.kind]||D.fusions[e.kind]))return;if(s.relics.includes('needles')&&!s.relicUsed.needles){s.relicUsed.needles=true;n++;}const amount=Math.min((pathOn(s,'sealpoint')?5:3)-(e.marks||0),n);if(amount<=0)return;e.marks=(e.marks||0)+amount;emit(s,'mark',{unit:e.id,amount});}
function schoolControl(s,e){if(s.school==='finger'&&once(s,'school-control'))addMark(s,e,1);}
function hit(s,u,n,ctx={}){
 if(!u||u.hp<=0||n<=0)return;if(u.kind==='beacon'){if(ctx.card)return;hit(s,s.hero,n,{...ctx,via:'beacon',hitAt:{x:u.x,y:u.y}});return;}const oldVulnerable=ctx.card?(u.vulnerable||0):0;if(oldVulnerable)u.vulnerable=0;const fingerBonus=ctx.card&&ctx.school==='finger'?(u.fingerVulnerable||0):0;if(fingerBonus)u.fingerVulnerable=0;const hero=u===s.hero,enemy=D.enemies[u.kind]||D.fusions[u.kind],weak=!!(ctx.card&&enemy&&isWeak(s,u));
 n+=fingerBonus;if(ctx.card&&ctx.school==='finger'&&!ctx.preserveMarks&&u.marks){const marks=u.marks;u.marks=0;n+=marks*2;emit(s,'consume-marks',{unit:u.id,amount:marks});progress(s,'consume',{enemy:u,marks});const stack=power(s,'silk');if(stack&&once(s,'power-silk')){shield(s,3*stack);emit(s,'power',{key:'silk',amount:stack});}}
 if(weak){n+=s.relics.includes('sword')?2:0;interrupt(s,u);const stack=power(s,'shadow');if(stack&&once(s,'power-shadow')){s.flowFree=true;emit(s,'power',{key:'shadow',amount:stack});}}
 if(ctx.card&&oldVulnerable)n+=oldVulnerable;
 if(enemy){const p=u.plan?.dir||[0,1],front=(s.hero.x-u.x)*p[0]+(s.hero.y-u.y)*p[1]>=0,coreArmor=u.boss===2&&!u.plan?.recover&&s.props.some(p=>p.kind==='core'&&p.owner===u.id&&p.hp>0);const eliteCover=u.elite&&s.formation?.active&&s.formation.eye===u.id;if(ctx.card&&!weak&&(eliteCover||front&&(u.mutation==='armor'||guardCover(s,u)||coreArmor)))n=Math.max(0,n-2);}
 const blocked=ctx.ignoreShield?0:Math.min(u.shield||0,n);u.shield=Math.max(0,(u.shield||0)-blocked);u.hp=Math.max(0,u.hp-n+blocked);emit(s,'hit',{unit:u.id,cause:ctx.cause||null,source:ctx.source||s.activeSource||'hero',amount:n-blocked,blocked,weak,targetKind:u.kind,killed:u.hp<=0,via:ctx.via||null,at:ctx.hitAt||{x:u.x,y:u.y}});
 if(hero&&ctx.attack&&s.hero.counter&&once(s,'counter')){const attacker=units(s).find(e=>e.id===ctx.source);if(attacker)hit(s,attacker,s.hero.counter,{source:'hero'});s.hero.counter=0;}
 if(!u.hp&&u.kind==='bomb'&&!u.detonated){u.detonated=true;emit(s,'explode',{at:{x:u.x,y:u.y},unit:u.id});blast(s,area(s,u,1),4,'bomb');}
 if(!u.hp&&u.kind==='stone'&&s.relics.includes('stone')&&once(s,'stone')){s.energy++;emit(s,'energy',{amount:1});}
}
function terrain(s,u){if(u.hp<=0)return;const t=tile(s,u.x,u.y);if(t==='spikes')hit(s,u,3,{source:'spikes'});if(['pit','void'].includes(t)){u.hp=0;emit(s,'fall',{unit:u.id,at:{x:u.x,y:u.y}});}}
function dislocate(s,u){if(restricted(u)&&s.river!==null&&bank(s,u)!==u.home&&!u.dislocated){u.dislocated=true;u.cancelled=false;u.charge=null;if(s.activeSource==='hero'){const n=power(s,'backtide');if(n&&once(s,'power-backtide')){draw(s,n);emit(s,'power',{key:'backtide',amount:n});}}emit(s,'dislocate',{unit:u.id});if(s.formation?.ids.includes(u.id))breakFormation(s);}}
function moveUnit(s,u,p,{active=false,forced=false}={}){
 if(!inside(s,p.x,p.y)||wall(s,p.x,p.y)||at(s,p.x,p.y)||u.kind==='beacon'&&(dist(s.hero,p)>TETHER||['pit','void'].includes(tile(s,p.x,p.y))))return false;const old={x:u.x,y:u.y};
 if(u===s.hero&&active){for(const e of living(s))if(e.mutation==='watch'&&!e.cancelled&&dist(e,old)===1&&dist(e,p)>1&&!e.watched){e.watched=true;hit(s,u,2);}if(u.hp<=0)return false;}
 if(['pit','void'].includes(tile(s,p.x,p.y))&&(u.kind==='king'||u.brace)){if(u.brace)u.brace=0;hit(s,u,8);emit(s,'brace',{unit:u.id});return true;}
 u.x=p.x;u.y=p.y;emit(s,'move',{unit:u.id,from:old,to:{...p},forced});terrain(s,u);
 if(u.kind==='beacon'){if(forced)emit(s,'beacon-move');return true;}
 if(u!==s.hero){if(forced){if(enemyUnit(u)){s.forceSteps=s.forceSteps||{};s.forceSteps[u.id]=(s.forceSteps[u.id]||0)+1;if(crosses(s,old,p)||s.river===null&&s.forceSteps[u.id]>=2)tideProc(s,u);}if(crosses(s,old,p)){emit(s,'forced-cross',{unit:u.id});if(s.relics.includes('tidalring')&&!s.relicUsed.tidalring){s.relicUsed.tidalring=true;hit(s,u,3);}}dislocate(s,u);}return true;}
 if(active&&u.hp>0){trigger(s,'move');if(crosses(s,old,p)){emit(s,'cross',{from:old,to:{...p}});trigger(s,'cross');}}
 return true;
}
function pushUnit(s,u,dx,dy,n=1){if(!u||u.hp<=0||['stone','breakwall','banner','core','escort','bomb'].includes(u.kind))return;if(u===s.hero&&s.hero.unpushable)return;if(enemyUnit(u))trigger(s,'push');for(let i=0;i<n&&u.hp>0;i++){const p={x:u.x+dx,y:u.y+dy},other=at(s,p.x,p.y);if(!inside(s,p.x,p.y)||wall(s,p.x,p.y)||other){const enemyCollision=enemyUnit(u)||enemyUnit(other),pathExtra=enemyCollision&&pathOn(s,'wallpalm')&&once(s,'path-wall-damage')?2:0,extra=enemyCollision?pathExtra+(s.relics.includes('impact')?2:0)+(s.relics.includes('bracelet')&&once(s,'bracelet')?1:0):0;hit(s,u,2+(!allied(u)?extra:0));if(other&&!(allied(u)&&allied(other)))hit(s,other,2+(!allied(other)?extra:0));emit(s,'collision',{unit:u.id});if(enemyCollision)trigger(s,'collision',{enemy:enemyUnit(u)?u:other,at:{x:u.x,y:u.y}});if(s.pendingCollisionSplash)for(const v of living(s).filter(v=>v.id!==u.id&&dist(v,u)===1))hit(s,v,s.pendingCollisionSplash,{card:true,school:'palm'});break;}if(!moveUnit(s,u,p,{forced:true}))break;}}
function toward(a,b){const dx=b.x-a.x,dy=b.y-a.y;return Math.abs(dx)>Math.abs(dy)?[Math.sign(dx)||1,0]:[0,Math.sign(dy)||1];}
function area(s,p,r=1,source=null){const out=[];for(let y=p.y-r;y<=p.y+r;y++)for(let x=p.x-r;x<=p.x+r;x++)if(inside(s,x,y)&&Math.abs(x-p.x)+Math.abs(y-p.y)<=r&&!wall(s,x,y)&&(!source||!restricted(source)||s.river===null||bank(s,{x,y})===source.home))out.push({x,y});return out;}
function lineCells(s,p,dir,max=3){return ray(s,p,...dir,max);}
function approach(s,e,aim,budget=2){return route(s,e,budget,{enemy:true}).sort((a,b)=>dist(a,aim)-dist(b,aim)||a.cost-b.cost)[0]||null;}
function putProp(s,kind,p,hp=3,ttl=99,owner=null){if(!inside(s,p.x,p.y)||at(s,p.x,p.y)||wall(s,p.x,p.y)||tile(s,p.x,p.y)!=='floor')return null;const q={id:'p'+s.serial++,kind,name:D.props[kind]?.char||{stone:'石',flag:'子',banner:'旗',core:'枢',escort:'镖'}[kind],x:p.x,y:p.y,hp,maxHp:hp,ttl,shield:0,owner};s.props.push(q);emit(s,'spawn',{kind,to:{x:q.x,y:q.y}});return q;}
function jumpPlan(s,e,kind,aim){const offsets=kind==='knight'?HORSE:[[2,2],[-2,2],[2,-2],[-2,-2]],opts=[];for(const [dx,dy]of offsets){const dest={x:e.x+dx,y:e.y+dy},leg=kind==='knight'?{x:e.x+(Math.abs(dx)===2?Math.sign(dx):0),y:e.y+(Math.abs(dy)===2?Math.sign(dy):0)}:{x:e.x+dx/2,y:e.y+dy/2};if(!inside(s,dest.x,dest.y)||wall(s,dest.x,dest.y)||['pit','void'].includes(tile(s,dest.x,dest.y))||restricted(e)&&s.river!==null&&bank(s,dest)!==e.home)continue;const blocked=at(s,leg.x,leg.y)||wall(s,leg.x,leg.y);opts.push({dest,leg,value:dist(dest,aim)+(blocked?5:0)});}return opts.sort((a,b)=>a.value-b.value)[0]||null;}
function targetFor(s,e){if(!s.beacon)return s.hero;const k=component(s,e),b=s.beacon,h=s.hero;if(e.boss){const phase=(s.turn-1)%D.bossCycles[e.boss].length;return e.boss===1?(phase===1?b:h):e.boss===2?((Math.floor(s.turn/4)%2)?h:b):(phase===0||phase===2?b:h);}if(['pawn','cannon','king'].includes(k))return b;if(['advisor','elephant'].includes(k)){const available=[h,b].filter(q=>s.river===null||bank(s,q)===e.home);return available.sort((a,b)=>dist(a,e)-dist(b,e))[0]||h;}if(k==='rook')return (s.turn+e.offset)%3===0?h:b;return (s.turn+e.offset)%2===0?b:h;}
function newPlan(s,e,i,allowStrong=false){
 const h=targetFor(s,e);
 const escort=s.props.find(p=>p.kind==='escort'),aim=escort&&i%3===2?escort:h,k=component(s,e),dir=toward(e,aim),p={kind:k,targetId:aim.id||h.id,aim:{x:aim.x,y:aim.y},dir,origin:{x:e.x,y:e.y},strong:allowStrong,steps:[],label:'守势',recover:false};
 const move=q=>{if(q)p.steps.push({type:'move',budget:q.cost||q.path?.length||1,path:q.path||[q.dest||{x:q.x,y:q.y}],dest:q.dest||{x:q.x,y:q.y},jump:!!q.leg,leg:q.leg||null});};
 const attack=(cells,damage,extra={})=>p.steps.push({type:'attack',cells,damage,...extra});
 const damage=(D.enemies[k]?.damage||5)+Math.floor((s.chapter-1)/2)+(e.elite?2:0);
 if(e.boss){
  const cycle=D.bossCycles[e.boss],stage=(s.turn-1)%cycle.length;p.stage=stage;p.label=cycle[stage];p.kind=e.boss===3?(stage===0?(e.phase2?'knight':'rook'):stage===1?(e.phase2?'rook':'knight'):'king'):'king';p.strong=false;
  if(e.boss===1){
   if(stage===0){move(approach(s,e,aim,2));p.steps.push({type:'banner'});attack([] ,6,{geometry:'ray',dir,range:3});}
   if(stage===1){p.strong=true;const cells=area(s,aim,2).filter(q=>!wall(s,q.x,q.y));p.steps.push({type:'charge',charge:{cells,damage:10,requires:'banner'}});}
   if(stage===2){p.strong=true;if(e.charge)p.steps.push({type:'release'});else p.label='旗令已断';}
   if(stage===3){p.recover=true;p.steps.push({type:'guard',amount:0});}
  }
  if(e.boss===2){
   if(stage===0){p.strong=true;p.steps.push({type:'cores',aim:{...aim}});}
   if(stage===1){p.strong=true;if(e.charge)p.steps.push({type:'release'});else p.label='机关已破';}
   if(stage===2){const q=approach(s,e,aim,3);move(q);if(dist(q||e,aim)===1)attack([{...aim},{x:aim.x-dir[1],y:aim.y+dir[0]},{x:aim.x+dir[1],y:aim.y-dir[0]}],5,{reach:1});}
   if(stage===3){p.recover=true;p.steps.push({type:'guard',amount:0});}
  }
  if(e.boss===3){
   if(stage===0||stage===1){if(p.kind==='rook')p.steps.push({type:'chargewalk',dir,max:2,damage:8,second:dir[0]?[0,Math.sign(aim.y-e.y)||1]:[Math.sign(aim.x-e.x)||1,0]});else{const q=jumpPlan(s,e,'knight',aim);if(q){move(q);const sides=area(s,q.dest,1);attack(sides,8,{afterJump:true});}}}
   if(stage===2){p.strong=true;const vertical=((s.encounterSeed+Math.floor(s.turn/5))%2)===1,cells=[];for(const offset of [0,-2])for(const along of [-1,0,1]){const q=vertical?{x:aim.x+offset,y:aim.y+along}:{x:aim.x+along,y:aim.y+offset};if(inside(s,q.x,q.y)&&!wall(s,q.x,q.y)&&!cells.some(r=>same(r,q)))cells.push(q);}const river=[2,3,4].find(r=>r!==s.river&&r!==s.previousRiver)??3;p.steps.push({type:'charge',charge:{cells,damage:12,river}});if(living(s).filter(q=>!q.boss).length<2)p.steps.push({type:'reinforce'});}
   if(stage===3){p.strong=true;if(e.charge)p.steps.push({type:'release'});}
   if(stage===4){p.recover=true;p.steps.push({type:'guard',amount:0});}
  }return p;
 }
 if(e.charge){p.strong=true;p.label='轰阵';p.steps.push({type:'release'});return p;}
 if(k==='pawn'){
  if(allowStrong){p.label='夹锋';const q=dist(e,aim)>1?approach(s,e,aim,2):null;move(q);const from=q||e;if(dist(from,aim)<=2){const perpendicular=dir[0]?[0,1]:[1,0];const cells=[{...aim},{x:aim.x+perpendicular[0],y:aim.y+perpendicular[1]},{x:aim.x-perpendicular[0],y:aim.y-perpendicular[1]}].filter(p=>!same(p,from));attack(cells,damage+1,{reach:2});}}
  else{const q=approach(s,e,aim,2+(e.mutation==='swift'?1:0));if(dist(e,aim)>1)move(q);if(dist(dist(e,aim)>1?q||e:e,aim)===1)attack([{...aim}],damage,{reach:1});p.label=p.steps.some(a=>a.type==='move')?'移→刺':'刺击';}
 }
 if(k==='advisor'){
  p.protect=(s.turn+e.offset)%2===0||allowStrong;if(p.protect){p.label='护阵';p.steps.push({type:'protect',amount:3});if(e.kind==='pawn_advisor'){const ally=living(s).find(a=>a.id!==e.id&&parts(a).includes('pawn')&&dist(a,e)<=2);if(ally){const q=approach(s,ally,aim,1);if(q)p.steps.push({type:'allymove',id:ally.id,path:q.path});}}}
  else{const opts=[[1,1],[-1,1],[1,-1],[-1,-1]].map(([dx,dy])=>({x:e.x+dx,y:e.y+dy})).filter(q=>inside(s,q.x,q.y)&&!wall(s,q.x,q.y)&&!['pit','void'].includes(tile(s,q.x,q.y))&&(s.river===null||bank(s,q)===e.home)).sort((a,b)=>dist(a,aim)-dist(b,aim));const q=opts.find(q=>!at(s,q.x,q.y));if(Math.max(Math.abs(e.x-aim.x),Math.abs(e.y-aim.y))===1)attack([{...aim}],damage,{diagonalReach:true});else move(q);p.label='斜行';}
 }
 if(k==='rook'){p.label=allowStrong?'折冲':'直冲';p.steps.push({type:'chargewalk',dir,max:3+(e.mutation==='swift'?1:0),damage,second:allowStrong?(dir[0]?[0,Math.sign(aim.y-e.y)||1]:[Math.sign(aim.x-e.x)||1,0]):null});}
 if(k==='knight'||k==='elephant'){const q=jumpPlan(s,e,k,aim);if(q){move(q);const facing=toward(q.dest,aim),sweep=allowStrong?area(s,q.dest,1,e):k==='knight'?[q.dest,{x:q.dest.x+facing[0],y:q.dest.y+facing[1]}]:[q.dest];attack(sweep,damage+(allowStrong?1:0),{afterJump:true});if(allowStrong&&k==='elephant')p.steps.push({type:'hazard',cells:area(s,q.dest,1,e),damage:3,afterJump:true});}p.label=k==='knight'?(allowStrong?'踏阵':'跃击'):(allowStrong?'镇地':'象步');}
 if(k==='cannon'){
  let usesRearFrame=false;if(['rook_cannon','knight_cannon','cannon_elephant'].includes(e.kind)&&e.previousPosition){const rear=toward(e,e.previousPosition);usesRearFrame=ray(s,e,...rear).some(q=>same(q,aim));if(usesRearFrame)p.dir=rear;}
  let from=e;if(!(e.x===aim.x||e.y===aim.y)&&!usesRearFrame){const aligned=route(s,e,2,{enemy:true}).filter(q=>q.x===aim.x||q.y===aim.y).sort((a,b)=>a.cost-b.cost||dist(a,aim)-dist(b,aim))[0];if(aligned){move(aligned);from=aligned;p.dir=toward(from,aim);}}
  const points=ray(s,from,...p.dir),screen=points.map(q=>at(s,q.x,q.y)).find(u=>u&&u.id!==e.id),needsFrame=!screen||screen.id===p.targetId;
  if(dist(from,aim)===1){p.label='近砲';attack([{...aim}],4,{reach:1});}
  else if(allowStrong){p.label='蓄砲';p.steps.push({type:'buildframe',dir:p.dir,targetId:p.targetId});p.steps.push({type:'charge',charge:{geometry:'cannon',dir:p.dir,damage:damage+2,blast:true}});}
  else if(!needsFrame){p.label='隔山砲';attack([],damage,{geometry:'cannon',dir:p.dir,range:8});}
  else{p.steps.push({type:'buildframe',dir:p.dir,targetId:p.targetId});p.label=p.steps.some(a=>a.type==='move')?'移砲布架':'布架';}
 }
 if(e.elite&&allowStrong&&p.steps.some(a=>a.type==='attack'||a.type==='chargewalk'))p.steps.push({type:'hazard',cells:area(s,aim,2),damage:3,label:'追阵',requiresAttack:true});
 if(k==='king'){if((s.turn+e.offset)%3===1){p.label='号令';p.steps.push({type:'protect',amount:2});p.steps.push({type:'banner'});}else{p.label='将锋';attack([],6+Math.floor((s.chapter-1)/2),{geometry:'ray',dir,range:3});}}
 return p;
}
function makeIntent(s,e){
 const p=e.plan,actions=[],routes=[],legs=[],screens=[],future=[];let origin={x:e.x,y:e.y},blocked=false,jumpOK=true,crossed=false;
 if(e.cancelled)return {actions,routes,legs,screens,future,cells:[],weak:[],strong:false,blocked:true,label:'断招',damage:0};
 if(e.dislocated&&s.river!==null){const q=route(s,e,30,{returning:true,enemy:true}).filter(q=>bank(s,q)===e.home).sort((a,b)=>a.cost-b.cost)[0];if(q){const path=q.path.slice(0,2);actions.push({type:'move',path,dest:path.at(-1)});routes.push({kind:'move',from:origin,to:path.at(-1),path});}else actions.push({type:'guard',amount:3});return {actions,routes,legs,screens,future,cells:[],weak:weakPoints(s,e,{...p,strong:true}),strong:false,blocked:!q,label:q?'失阵 · 归岸':'失阵 · 无路',damage:0};}
 const occupant=q=>{const u=at(s,q.x,q.y);return u?.id===e.id?null:u;};
 const strike=a=>{if(a.reach&&dist(origin,p.aim)>a.reach||a.diagonalReach&&Math.max(Math.abs(origin.x-p.aim.x),Math.abs(origin.y-p.aim.y))>1){blocked=true;return;}let cells=a.cells||[],from=a.source?s.props.find(q=>q.id===a.source):origin;if(!from)return;let frame=null,impact=null;if(a.geometry==='ray'||a.geometry==='cannon'){
   const points=ray(s,from,...a.dir,a.range||8);if(a.geometry==='ray'){cells=[];for(const q of points){cells.push(q);if(occupant(q))break;}}
   else{cells=[];for(const q of points){if(!frame){if(occupant(q))frame=q;}else if(occupant(q)){impact=q;cells=a.blast?area(s,q,1):[q];break;}}if(frame)screens.push(frame);}
   if(cells.length)routes.push({kind:a.geometry==='cannon'?'cannon':'attack',from:{x:from.x,y:from.y},to:impact||cells.at(-1),path:points,screen:frame});
  }if(restricted(e)&&s.river!==null)cells=cells.filter(q=>bank(s,q)===e.home);cells=cells.filter((q,i,a)=>inside(s,q.x,q.y)&&!wall(s,q.x,q.y)&&a.findIndex(r=>same(r,q))===i);if(cells.length)actions.push({...a,damage:a.damage+(s.props.some(q=>q.kind==='banner'&&q.owner!==e.id&&dist(q,origin)<=2)?1:0),cells,source:a.source||e.id});};
 for(const step of p.steps||[]){const a=clone(step);if(a.combo&&!s.formation?.active)continue;
  if(a.type==='move'){
   if(e.rooted){blocked=true;jumpOK=false;continue;}
   if(a.jump){const bad=wall(s,a.leg.x,a.leg.y)||!!occupant(a.leg)||!same(e,p.origin),dest=a.dest;legs.push({...a.leg,blocked:bad});routes.push({kind:'leap',from:origin,to:dest,path:[a.leg,dest],blocked:bad});jumpOK=!bad&&(s.river===null||!restricted(e)||bank(s,dest)===e.home);if(jumpOK){actions.push({type:'land',dest,attackFirst:true});origin={...dest};}else blocked=true;}
   else{let prev=origin,path=[],cost=0;for(const q of a.path){const diagonal=p.kind==='advisor'&&Math.abs(q.x-prev.x)===1&&Math.abs(q.y-prev.y)===1;if((dist(prev,q)!==1&&!diagonal)||wall(s,q.x,q.y)||['pit','void'].includes(tile(s,q.x,q.y))||occupant(q)||restricted(e)&&s.river!==null&&bank(s,q)!==e.home)break;const stepCost=1+(crosses(s,prev,q)&&!bridge(s,prev,q)?1:0);if(cost+stepCost>(a.budget??99))break;cost+=stepCost;path.push(q);prev=q;}if(path.length){actions.push({type:'move',path,dest:path.at(-1)});routes.push({kind:'move',from:origin,to:path.at(-1),path});origin=path.at(-1);}else blocked=true;}
  }else if(a.type==='chargewalk'){
   if(e.rooted){blocked=true;continue;}const path=[];let from=origin,target=null;for(const q of ray(s,origin,...a.dir,a.max)){if(['pit','void'].includes(tile(s,q.x,q.y))||restricted(e)&&s.river!==null&&bank(s,q)!==e.home)break;if(occupant(q)){target=q;break;}path.push(q);if(crosses(s,from,q)&&!bridge(s,from,q)){crossed=true;break;}from=q;}
   if(path.length){actions.push({type:'move',path,dest:path.at(-1)});routes.push({kind:'move',from:origin,to:path.at(-1),path});origin=path.at(-1);}if(target&&!crossed)strike({type:'attack',cells:[target],damage:a.damage});if(a.second&&!crossed)strike({type:'attack',geometry:'ray',dir:a.second,range:2,damage:a.damage});
  }else if(a.type==='attack'){if(a.afterJump&&!jumpOK)continue;strike(a);}
  else if(a.type==='release'){
   const charge=e.charge;if(!charge){blocked=true;continue;}if(charge.requires==='banner'&&!s.props.some(q=>q.kind==='banner'&&q.owner===e.id&&q.hp>0)||charge.source&&!s.props.some(q=>q.id===charge.source&&q.hp>0)){blocked=true;continue;}
   if(charge.river!==undefined)actions.push({type:'river',river:charge.river});strike({type:'attack',...charge});actions.push({type:'clearCharge'});
  }else if(a.type==='charge'){future.push({...a.charge});actions.push(a);}
  else if(a.type==='cores'){const spots=coreSpots(s,e,a.aim);const existing=s.props.filter(q=>q.kind==='core'&&q.owner===e.id);const source=existing[Math.floor(s.turn/4)%Math.max(1,existing.length)]||spots[0];if(source){const cells=ray(s,source,...toward(source,a.aim),4);future.push({cells,damage:9,source:source.id||null});}actions.push({...a,spots});}
  else if(a.type==='protect'){if(!e.suppressed)actions.push({...a,ids:living(s).filter(q=>q.id!==e.id&&dist(q,e)<=2&&(s.river===null||bank(s,q)===e.home)).map(q=>q.id)});}
  else if(a.afterJump&&!jumpOK||a.requiresAttack&&!actions.some(a=>a.type==='attack'))continue;
  else actions.push(a);
 }
 // Jump attacks resolve before landing, and each target is hit once per attack step.
 for(let i=0;i<actions.length;i++)if(actions[i].type==='land'&&actions[i+1]?.afterJump){const land=actions.splice(i,1)[0];let j=i;while(j<actions.length&&actions[j].afterJump)j++;actions.splice(j,0,land);}
 const cells=actions.filter(a=>a.type==='attack').flatMap(a=>a.cells),weak=weakPoints(s,e,{...p,strong:p.strong||p.recover});
 return {actions,routes,legs,screens,future,cells,weak,strong:p.strong,blocked,label:blocked&&p.steps.some(a=>a.type==='release')?'强招已拆':p.combo&&!s.formation?.active?p.baseLabel:p.label,damage:Math.max(0,...actions.filter(a=>a.type==='attack').map(a=>a.damage))};
}
function coreSpots(s,e,aim){return s.board.map((t,i)=>({x:i%s.width,y:Math.floor(i/s.width),t})).filter(q=>q.t==='floor'&&!at(s,q.x,q.y)&&dist(e,q)<=4&&dist(e,q)>1).sort((a,b)=>dist(a,aim)-dist(b,aim)).slice(0,Math.max(0,2-s.props.filter(q=>q.kind==='core'&&q.owner===e.id).length));}
function prepareCombo(s,e){
 const f=s.formation,p=e.plan;if(e.boss||!f||f.eye!==e.id||!p.strong||!connected(s))return;
 p.baseLabel=p.label;p.combo=f.key;p.label={guard_gun:'护砲合式',pincer:'夹锋合式',chase:'追杀合式',quell:'镇河合式',wall:'铁壁合式',command:'号令合式'}[f.key];
 const bonus=a=>p.steps.push({...a,combo:true});
 if(['guard_gun','quell'].includes(f.key))bonus({type:'hazard',cells:area(s,p.aim,1).filter(q=>q.x!==p.aim.x),damage:2});
 if(['pincer','command'].includes(f.key)){const ally=living(s).find(a=>f.ids.includes(a.id)&&a.id!==e.id),q=ally&&approach(s,ally,p.aim,1);if(q)bonus({type:'allymove',id:ally.id,path:q.path});}
 if(f.key==='chase')bonus({type:'hazard',cells:[{x:p.aim.x-p.dir[1],y:p.aim.y+p.dir[0]},{x:p.aim.x+p.dir[1],y:p.aim.y-p.dir[0]}].filter(q=>inside(s,q.x,q.y)&&!wall(s,q.x,q.y)),damage:2});
 if(f.key==='wall')bonus({type:'protect',amount:2});
}
function refresh(s,fresh=false){if(s.phase!=='battle')return;if(fresh){const strongCap=s.chapter===3&&(s.elite||s.boss)?2:1;let reserved=living(s).filter(e=>e.charge||e.boss&&(s.turn-1)%D.bossCycles[e.boss].length!==0).length;for(const [i,e]of living(s).entries()){if(e.boss===3&&e.hp<=e.maxHp/2&&!e.phase2){e.phase2=true;emit(s,'phase',{unit:e.id,phase:2});}const strong=reserved<strongCap&&!e.boss&&(e.elite?(s.turn+e.offset)%2===0:(s.turn+e.offset)%3===0);if(strong)reserved++;e.plan=newPlan(s,e,i,strong);}for(const e of living(s))prepareCombo(s,e);}
 const was=s.formation?.active;if(s.formation)s.formation.active=connected(s);if(was&&!s.formation.active&&s.actionRewarded!==undefined&&s.actionRewarded!==null)breakFormation(s);for(const e of living(s)){if(!e.plan)e.plan={kind:e.kind,dir:[0,1],origin:{x:e.x,y:e.y},steps:[],label:'下回合行动',strong:false};e.intent=makeIntent(s,e);}
}
function record(s){s.lastUnits=clone(units(s));}
function newEnemy(s,kind,x,y,{elite=false,mutation=null,boss=0}={}){const f=D.fusions[kind],base=D.enemies[kind]||D.enemies[f.parts[0]],hp=boss?D.chapters[boss-1].hp:f?28+s.chapter*8:(kind==='king'?22:base.hp+1)+(s.chapter-1)*2;return {id:'e'+s.serial++,kind,name:boss?D.chapters[boss-1].boss:f?.name||base.name,x,y,hp,maxHp:hp,shield:0,home:s.river===null?null:bank(s,{x,y}),offset:Math.floor(J.rand(s)*3),elite,boss,brace:elite||boss?1:0,mutation:f?null:mutation,cancelled:false,dislocated:false,rooted:false,suppressed:false,exposed:0,breakHits:0,rewarded:false,vulnerable:0,watched:false,marks:0,charge:null,previousPosition:null,phase2:false};}
const LAMP_ARTS={lampGuard:{name:'照夜',text:'获得5护盾',icon:'shield'},lampDraw:{name:'问心',text:'抽2张牌',icon:'draw'},lampEnergy:{name:'续焰',text:'获得1气',icon:'energy'}};
const TRIALS=[{name:'疾风过河',text:'在第5回合结束前获胜',goal:5},{name:'拆局有方',text:'触发打断或破阵，并赢得本战',goal:1},{name:'行云流水',text:'渡河、碰撞、打断、破阵中完成两种，并获胜',goal:2}];
function trialProgress(s){const t=s.trial;if(!t)return 0;return t.kind===0?s.turn:t.kind===1?Number(t.feats.some(k=>['interrupt','break'].includes(k))):t.feats.length;}
function lamp(s,key){const fail=reason(s,key,s.hero.x,s.hero.y);if(fail)return {ok:false,reason:fail,state:s};const n=clone(s);n.events=[];n.momentum-=2;n.lampUsed=true;if(key==='lampGuard')shield(n,5);if(key==='lampDraw')draw(n,2);if(key==='lampEnergy'){n.energy++;emit(n,'energy',{amount:1});}emit(n,'lamp-art',{name:LAMP_ARTS[key].name});chronicle(n);return {ok:true,state:n};}
const SKIRMISHES={hunt:{name:'猎首',text:'击败金圈阵眼即获胜，不必追杀余兵。'},powder:{name:'火攻',text:'新增连环爆符；击破伤及四邻，敌我都受伤。'},duel:{name:'双雄',text:'仅两名敌棋，各增20%生命。集中破招，快速决胜。'}};
function reshapeBattle(s,n){s.skirmish=null;s.redrawUsed=false;if(s.tutorial||n.type!=='battle')return;const kind=['hunt','powder','duel'][(Math.abs(Math.trunc(n.seed||0))+(n.row||0))%3];s.skirmish=kind;
 for(const e of s.enemies)e.hp=e.maxHp=Math.ceil(e.maxHp*.8);
 if(kind==='hunt'){s.huntTarget=s.formation.eye;s.objectiveId=s.huntTarget;}
 if(kind==='duel'){const eye=s.enemies.find(e=>e.id===s.formation.eye),partner=s.enemies.find(e=>e.id!==eye.id&&s.formation.ids.includes(e.id))||s.enemies.find(e=>e.id!==eye.id);s.enemies=[eye,partner].filter(Boolean);s.formation.ids=s.enemies.map(e=>e.id);for(const e of s.enemies){e.hp=e.maxHp=Math.ceil(e.maxHp*1.2);}}
 if(kind==='powder'){const candidates=s.board.map((t,i)=>({x:i%s.width,y:Math.floor(i/s.width),t})).filter(q=>q.t==='floor'&&!at(s,q.x,q.y)&&dist(q,s.hero)>1&&dist(q,s.beacon)>1&&!s.shrines.some(v=>same(v,q))).sort((a,b)=>Math.min(...s.enemies.map(e=>dist(e,a)))-Math.min(...s.enemies.map(e=>dist(e,b)))||dist(a,s.hero)-dist(b,s.hero));for(const q of candidates.slice(0,3))putProp(s,'bomb',q,D.props.bomb.hp,99);}
}
function advanceOpening(s){if(!s.skirmish||!s.beacon)return;const h={x:s.hero.x,y:s.hero.y-1},b={x:s.beacon.x,y:s.beacon.y-1};const safe=q=>inside(s,q.x,q.y)&&tile(s,q.x,q.y)==='floor'&&!wall(s,q.x,q.y)&&(!at(s,q.x,q.y)||allied(at(s,q.x,q.y)))&&living(s).every(e=>dist(e,q)>=2)&&s.props.filter(p=>p.kind==='bomb').every(p=>dist(p,q)>1);if(safe(h)&&safe(b)){const oldH={x:s.hero.x,y:s.hero.y},oldB={x:s.beacon.x,y:s.beacon.y};Object.assign(s.hero,h);Object.assign(s.beacon,b);if(targets(s,'move').length<3){Object.assign(s.hero,oldH);Object.assign(s.beacon,oldB);}}}
function redraw(s){if(s.phase!=='battle'||s.tutorial||s.redrawUsed||!s.hand.length||s.draw.length+s.discard.length<s.hand.length)return {ok:false,reason:'每战变招一次，牌堆与弃牌须够换出等量手牌',state:s};const n=clone(s),old=n.hand.splice(0);n.events=[];n.redrawUsed=true;draw(n,old.length);n.discard.push(...old);emit(n,'redraw');chronicle(n);return {ok:true,state:n};}
function setup(s,n){
 const arena=A.shape(n.layout,n.seed);for(const key of ['width','height','board','mask'])s[key]=arena[key];s.phase='battle';s.layout=n.layout;s.river=s.override?.noRiver?null:s.override?.river??n.river;s.river=s.river===null?null:Math.max(1,Math.min(s.height-3,s.river));s.bridges=s.river===null?[]:[Math.floor(s.width/2),...new Set((s.override?.bridges||n.bridges||[]).map(x=>Math.min(s.width-2,x)))];s.bridges=[...new Set(s.bridges)];s.override=null;s.turn=0;s.serial=0;s.hero.x=arena.hero.x;s.hero.y=arena.hero.y;s.beacon={id:'beacon',kind:'beacon',name:'命灯',...arena.beacon,hp:1,maxHp:1,shield:0};s.hero.shield=0;s.hero.unpushable=false;s.momentum=0;s.gained=0;s.energy=3;s.freeMove=true;s.flowUsed=false;s.relicUsed={};s.flags={};s.enemyPhaseTurn=0;s.discount=0;s.bodyDiscount=0;s.edge=0;s.powers={};s.activeCards=[];s.draw=J.shuffle(s,clone(s.deck));s.hand=[];s.discard=[];s.exhaust=[];s.enemies=[];s.props=[];s.hazards=[];s.echoes=[];s.events=[];s.lastUnits=null;s.reward=null;s.boss=n.type==='boss'?s.chapter:0;s.elite=n.type==='elite';s.objectiveId=null;s.actionRewarded=null;s.encounterSeed=n.seed||0;s.fingerDiscount=0;s.flowFree=false;s.collisionShield=0;s.pendingCollisionSplash=0;s.fieldPlan=null;s.riverShiftedTurn=0;s.queuedEnergy=0;s.shrines=[];s.objective=n.objective?{kind:n.objective,progress:0,ids:[],...{x:Math.floor(s.width/2)-1,y:1}}:null;
 s.lampUsed=false;s.trial=s.tutorial?null:{kind:Math.abs(Math.trunc(n.seed||0))%3,feats:[],paid:0};
 const form=D.formations.find(f=>f.key===n.formation)||D.formations[0];let kinds=[...form.kinds];if(s.elite)kinds=[n.fusion,...form.kinds.slice(0,s.chapter===1?2:3)];else if(s.boss)kinds=['king',...(s.boss===1?['advisor','cannon']:s.boss===2?['rook','elephant']:['advisor','knight'])];else if(s.chapter>=2||n.row>=4)kinds.push(J.choose(s,['pawn','rook','knight','cannon','advisor','elephant']));
 const cx=Math.floor(s.width/2),spots=[{x:cx,y:s.boss?0:2},{x:Math.max(1,cx-2),y:2},{x:Math.min(s.width-2,cx+2),y:3},{x:cx-1,y:Math.max(2,s.height-4)},{x:1,y:1}];
 kinds.forEach((kind,i)=>{const desired=spots[i],q=s.board.map((t,k)=>({x:k%s.width,y:Math.floor(k/s.width),t})).filter(q=>q.t==='floor'&&!at(s,q.x,q.y)&&dist(q,s.hero)>=3&&dist(q,s.beacon)>=3).sort((a,b)=>dist(a,desired)-dist(b,desired))[0];if(q)s.enemies.push(newEnemy(s,kind,q.x,q.y,{elite:s.elite&&i===0,mutation:s.elite&&i===1?n.mutation:null,boss:kind==='king'?s.boss:0}));});
 if(s.elite)s.objectiveId=s.enemies[0].id;const ids=[];for(const kind of form.partners){const e=s.enemies.find(e=>parts(e).includes(kind)&&!ids.includes(e.id));if(e)ids.push(e.id);}if(ids.length<2)for(const e of s.enemies)if(!ids.includes(e.id)&&ids.length<2)ids.push(e.id);const eye=s.elite?s.enemies[0]:s.enemies.find(e=>parts(e).includes(form.eye))||s.enemies[0];s.formation={key:form.key,name:form.name,ids,eye:eye.id,active:false,brokenTurn:-1};
 const free=()=>s.board.map((t,i)=>({x:i%s.width,y:Math.floor(i/s.width),t})).filter(q=>q.t==='floor'&&!at(s,q.x,q.y)&&dist(q,s.hero)>2&&dist(q,s.beacon)>2);
 if(s.objective?.kind==='cores'){for(const desired of [{x:1,y:1},{x:s.width-2,y:1}]){const q=free().sort((a,b)=>dist(a,desired)-dist(b,desired))[0];const c=q&&putProp(s,'core',q,6,99,'mission');if(c)s.objective.ids.push(c.id);}}
 const kindsOfProps=s.chapter===1?['breakwall','boulder']:s.chapter===2?['breakwall','breakwall','boulder','bomb','bomb']:['boulder','bomb'];for(const kind of kindsOfProps){const opts=free().filter(q=>q.x!==cx&&q.x!==cx-1&&(!s.objective||!same(q,s.objective)));const q=opts[(n.seed+s.serial*7)%Math.max(1,opts.length)];if(q)putProp(s,kind,q,D.props[kind].hp,99);}
 const shrine=free().filter(q=>q.x===cx-1).sort((a,b)=>Math.abs(a.y-Math.floor(s.height/2))-Math.abs(b.y-Math.floor(s.height/2)))[0];if(shrine)s.shrines=[{x:shrine.x,y:shrine.y,used:false}];
 if(s.objective){if(s.objective.kind==='escape'){s.objective.x=cx;s.objective.y=0;}if(s.objective.kind!=='cores'){const blocking=at(s,s.objective.x,s.objective.y);if(blocking){const q=free()[0];if(q){blocking.x=q.x;blocking.y=q.y;}}s.board[s.objective.y*s.width+s.objective.x]='floor';s.mask[s.objective.y*s.width+s.objective.x]=true;}}
 if(s.quest){const q={x:cx-1,y:s.height-1};if(!at(s,q.x,q.y))s.props.push({id:'escort',kind:'escort',name:'镖',...q,hp:10,maxHp:10,ttl:99,shield:0});}
 reshapeBattle(s,n);advanceOpening(s);startTurn(s);if(s.provisions.shield>0){shield(s,s.provisions.shield);s.provisions.shield=0;}s.battleBoat=s.provisions.boat>0;if(s.battleBoat)s.provisions.boat--;emit(s,'encounter',{name:form.name});
}
function startTurn(s){s.turn++;s.energy=(s.chapter>=2?4:3)+(s.queuedEnergy||0);s.queuedEnergy=0;s.bodyDiscount=0;s.forceSteps={};s.freeMove=true;s.flowUsed=false;s.flags={};s.gained=0;s.hero.shield=0;s.hero.unpushable=false;s.hero.counter=0;s.collisionShield=0;s.fingerDiscount=0;s.flowFree=false;s.actionRewarded=null;
 for(const e of living(s)){e.cancelled=false;e.rooted=false;e.suppressed=false;e.watched=false;e.rewarded=false;e.breakHits=0;if(e.exposed)e.exposed--;}
 if(s.turn===1){const key=D.signatures[s.school],i=s.draw.findIndex(c=>c.key===key);if(i>=0)s.hand.push(s.draw.splice(i,1)[0]);}draw(s,(s.chapter>=3?6:5)-s.hand.length);planField(s);refresh(s,true);
}
function settle(s){
 const dead=s.enemies.filter(e=>e.hp<=0);s.kills+=dead.length;s.enemies=s.enemies.filter(e=>e.hp>0);s.props=s.props.filter(p=>p.hp>0);
 if(s.hero.hp<=0){s.phase='defeat';return;}
 if(s.elite&&dead.some(e=>e.id===s.objectiveId)){s.energy++;if(s.formation){s.formation.active=false;s.formation.brokenTurn=s.turn;}for(const e of living(s)){e.shield=0;e.exposed=2;}emit(s,'eye-break',{energy:1});}
 const missionWon=s.objective&&(s.objective.kind==='cores'?s.objective.ids.length===2&&s.objective.ids.every(id=>!s.props.some(p=>p.id===id)):s.objective.complete);const hunted=s.skirmish==='hunt'&&s.formation?.eye===s.huntTarget&&dead.some(e=>e.id===s.huntTarget);const won=hunted|| (s.boss?!s.enemies.some(e=>e.boss):!s.enemies.length||missionWon);
 if(won&&!s.guided){s.momentum=0;if(s.tutorial){s.phase='lesson';return;}J.reward(s);if(s.trial){const t=s.trial,p=trialProgress(s),done=t.kind===0?p<=5:p>=TRIALS[t.kind].goal;s.trialPurse=s.trialPurse||{};const used=s.trialPurse[s.chapter]||0;t.paid=done?Math.max(0,Math.min(8,24-used)):0;t.complete=done;s.trialPurse[s.chapter]=used+t.paid;s.gold+=t.paid;s.reward.gold+=t.paid;if(t.paid)emit(s,'gold',{amount:t.paid});}if(s.quest){const escort=s.props.find(p=>p.kind==='escort');if(escort&&escort.hp>0){s.gold+=s.quest.reward||40;emit(s,'gold',{amount:s.quest.reward||40});}s.quest=null;}s.phase='reward';}
}
function actionDef(s,index){if(index==='beaconMove')return s.beacon?{key:'beaconMove',target:'beaconStep',range:2,actualCost:0}:null;if(index==='move')return {key:'move',target:'step',range:1,actualCost:0};if(index==='flowstep')return {key:'flowstep',target:'leap',range:1,actualCost:0};if(index==='ultimate')return {key:'ultimate',target:s.school==='sword'?'leap':s.school==='palm'?'lineEnemy':'enemy',range:s.school==='finger'?3:2,actualCost:0};return s.hand[index]?cardInfo(s.hand[index],s):null;}
function movementCost(s,index,x,y){const source=index==='beaconMove'?s.beacon:s.hero;if(!source)return 0;if(index==='beaconMove')return route(s,source,2).find(q=>q.x===x&&q.y===y)?.toll||0;return crosses(s,source,{x,y})&&!bridge(s,source,{x,y})?1:0;}
function attackable(s,x,y){const u=at(s,x,y);return u&&!allied(u)?u:null;}
function reason(s,index,x,y){
 if(s.phase!=='battle')return '当前不在对局中';if(Object.hasOwn(LAMP_ARTS,index)){if(s.tutorial&&!s.lessonLamp)return '试剑中不使用灯诀';if(!s.beacon)return '需要命灯';if(s.lampUsed)return '本战已用过灯诀';if(s.momentum<2)return '灯诀需要两势';if(index==='lampDraw'&&(s.hand.length>=10||!s.draw.length&&!s.discard.length))return '没有可抽取的牌或手牌已满';return '';}if(!inside(s,x,y))return '请选择交点';const d=actionDef(s,index);if(!d)return '没有这张牌';const h=index==='beaconMove'?s.beacon:s.hero,p={x,y},u=at(s,x,y),distance=dist(h,p),enemy=enemyAt(s,x,y),e=u?.kind==='beacon'&&['push','pull','swap'].includes(d.op)?u:d.damage||['hit','wallhit','pierce','first','across'].includes(d.op)?attackable(s,x,y):enemy||(['push','pull'].includes(d.op)&&['flag','boulder'].includes(u?.kind)?u:null);
 if(['move','beaconMove'].includes(index)&&!s.freeMove)return '行步与迁灯共用一次，已用完';if(index==='flowstep'&&(s.flowUsed||s.momentum<1&&!s.flowFree&&!(s.relics.includes('mist')&&!s.relicUsed.mist)))return s.flowUsed?'凌波每回合一次':'需要一势';if(index==='ultimate'&&s.momentum<(s.relics.includes('sheath')&&!s.relicUsed.sheath?2:3))return '势不足';if(d.actualCost>s.energy)return '气力不足';
 if(u?.kind==='beacon'&&['push','pull'].includes(d.op)){const sign=d.op==='pull'?-1:1,q={x:u.x+Math.sign(u.x-s.hero.x)*sign,y:u.y+Math.sign(u.y-s.hero.y)*sign};if(['pit','void'].includes(tile(s,q.x,q.y)))return '命灯不能进入裂隙';if(dist(s.hero,q)>TETHER)return '系灯三格，不能再推远';}
 if(d.op==='power'&&((s.powers[d.power]?.stacks||0)>=2||!s.powers[d.power]&&Object.keys(s.powers).length>=3))return '最多三种心法，同名两层';
 if(d.target==='self')return same(h,p)?'':'此招用于自身';
 if(s.beacon&&index!=='beaconMove'&&(['step','leap'].includes(d.target)||d.op==='swap')&&dist(p,d.op==='swap'&&u?.kind==='beacon'?s.hero:s.beacon)>TETHER)return '系灯三格，请先迁灯';
 if(d.target==='beaconStep'){const q=route(s,h,2).find(q=>same(q,p));if(!q)return '迁灯两步内，与侠相隔不超过三格';let from=h,cost=0;for(const p of q.path){if(crosses(s,from,p)&&!bridge(s,from,p))cost++;from=p;}return s.energy>=cost?'':'涉河额外一气，或从桥渡河';}
 if(d.target==='step'){if(distance!==1||u||wall(s,x,y)||['pit','void'].includes(tile(s,x,y)))return '需要相邻空交点';if(crosses(s,h,p)&&!bridge(s,h,p)&&s.energy<1)return '涉河额外一气，或从桥渡河';return '';}
 if(d.target==='leap')return distance>0&&distance<=d.range&&!u&&!wall(s,x,y)&&!['pit','void'].includes(tile(s,x,y))?'':'需要范围内的合法空落点';
 if(d.target==='adjacent')return e&&distance===1?'':'需要相邻敌棋或可攻击棋具';
 if(d.target==='enemy')return e&&distance<=d.range?'':'需要范围内的敌棋';
 if(d.target==='empty')return distance<=d.range&&!u&&tile(s,x,y)==='floor'?'':'需要范围内的普通空交点';
 if(['line','lineEnemy','hook'].includes(d.target)){if(!(x===h.x||y===h.y)||!distance||distance>d.range||d.target==='hook'&&distance<2)return '需要直线范围内目标';const path=ray(s,h,Math.sign(x-h.x),Math.sign(y-h.y),d.range);if(!path.some(q=>same(q,p)))return '石障阻挡路径';if(d.target!=='line'&&!e)return '请选择敌棋或可攻击棋具';if(d.target==='hook')for(const q of path.slice(0,distance-1))if(at(s,q.x,q.y))return '牵丝路径被挡住';return '';}
 return '目标无效';
}
function targets(s,index){const out=[];for(let y=0;y<(s.height||8);y++)for(let x=0;x<(s.width||7);x++)if(!reason(s,index,x,y))out.push({x,y});return out;}
function act(s,index,x,y){
 if(index==='redraw')return redraw(s);
 if(Object.hasOwn(LAMP_ARTS,index))return lamp(s,index);
 const invalid=reason(s,index,x,y);if(invalid)return {ok:false,reason:invalid,state:s};const n=clone(s);n.events=[];n.forceSteps={};n.actionRewarded=false;n.activeSource='hero';n.swordHits=[];const d=actionDef(n,index),h=n.hero,e=attackable(n,x,y)||(n.beacon&&same(n.beacon,{x,y})?n.beacon:null),p={x,y},oldPos={x:h.x,y:h.y},previousBank=bank(n,h);let bonus=0;
 if(index==='beaconMove'){const path=route(n,n.beacon,2).find(q=>same(q,p)).path;n.freeMove=false;for(const q of path){if(crosses(n,n.beacon,q)&&!bridge(n,n.beacon,q)){n.energy--;emit(n,'energy',{amount:-1});}moveUnit(n,n.beacon,q);}emit(n,'beacon-move');}
 else if(index==='move'){n.freeMove=false;if(crosses(n,h,p)&&!bridge(n,h,p)){n.energy--;emit(n,'energy',{amount:-1});}moveUnit(n,h,p,{active:true});}
 else if(index==='flowstep'){n.flowUsed=true;if(n.flowFree)n.flowFree=false;else if(n.relics.includes('mist')&&!n.relicUsed.mist)n.relicUsed.mist=true;else n.momentum--;moveUnit(n,h,p,{active:true});}
 else if(index==='ultimate'){
  n.momentum-=n.relics.includes('sheath')&&!n.relicUsed.sheath?2:3;n.relicUsed.sheath=true;emit(n,'ultimate',{school:n.school});
  if(n.school==='sword'){moveUnit(n,h,p,{active:true});refresh(n);for(const u of units(n).filter(u=>!allied(u)&&dist(u,h)===1))hit(n,u,4,{card:true,school:'sword'});}
  if(n.school==='palm'){hit(n,e,4,{card:true,school:'palm'});pushUnit(n,e,Math.sign(x-h.x),Math.sign(y-h.y),2);}
  if(n.school==='finger'){hit(n,e,6,{card:true,school:'finger'});if(e.hp>0&&e.plan?.strong)interrupt(n,e,true);}
 }else{
  const c=n.hand.splice(index,1)[0];n.energy-=d.actualCost;n.discount=0;if(['move','chase'].includes(d.op))n.bodyDiscount=0;if(d.school==='finger')n.fingerDiscount=0;n.plays++;if(d.op==='power')n.activeCards.push(c);else(d.exhaust?n.exhaust:n.discard).push(c);emit(n,'card',{key:c.key,level:c.level});
  if(d.school==='sword'&&d.damage){bonus=n.edge;n.edge=0;if(n.relics.includes('tassel')&&!n.relicUsed.tassel){n.relicUsed.tassel=true;draw(n,1);}}
  const attack=(u,amount=d.damage||0)=>{if(d.strip&&u)u.shield=0;const raw=amount+bonus+(d.strongBonus&&u?.plan?.strong?d.strongBonus:0);hit(n,u,raw,{card:true,school:d.school,ignoreShield:d.ignoreShield,preserveMarks:d.preserveMarks});if(u&&d.school==='sword'){n.swordHits.push({id:u.id,raw});if(pathOn(n,'riverblade',3)&&crosses(n,n.hero,u)&&once(n,'path-river-wave')){const dir=toward(n.hero,u);emit(n,'sword-wave',{at:{x:u.x,y:u.y},dir});for(const q of ray(n,u,...dir,2)){const v=at(n,q.x,q.y);if(v&&!allied(v))hit(n,v,4,{source:'hero',echo:true});}}}};
  if(d.op==='hit'){attack(e,(d.damage||0)+(d.weakBonus&&isWeak(n,e)?d.weakBonus:0));if(d.marks)addMark(n,e,d.marks);if(d.moveDraw&&n.flags.moved&&once(n,'swordreturn'))draw(n,d.moveDraw);if(d.killDraw&&e.hp<=0)draw(n,d.killDraw);}
  if(['guard','sheathe','gather','steady'].includes(d.op)){shield(n,d.shield+(d.stillBonus&&!n.flags.moved?d.stillBonus:0)+(n.relics.includes('shield')&&['guard','bell'].includes(c.key)?3:0));if(d.unpushable)h.unpushable=true;if(d.counter)h.counter=d.counter;if(d.collisionShield)n.collisionShield=d.collisionShield;if(d.op==='sheathe')n.edge+=d.bonus;if(d.op==='gather')n.fingerDiscount+=d.discount;if(d.op==='steady')draw(n,d.draw);}
  if(d.op==='push'||d.op==='pull'){if(d.damage)attack(e);n.pendingCollisionSplash=d.collisionSplash||0;pushUnit(n,e,d.op==='pull'?Math.sign(h.x-x):Math.sign(x-h.x),d.op==='pull'?Math.sign(h.y-y):Math.sign(y-h.y),d.push);n.pendingCollisionSplash=0;if(d.shieldAfter)shield(n,d.shieldAfter);}
  if(['move','chase'].includes(d.op)){
   moveUnit(n,h,p,{active:true});refresh(n);if(d.shield)shield(n,d.shield);if(n.relics.includes('cloudpin')&&living(n).some(u=>isWeak(n,u))&&once(n,'cloudpin'))shield(n,2);
   if(d.op==='chase'&&h.hp>0)for(const u of units(n).filter(u=>!allied(u)&&dist(u,h)===1))attack(u,d.damage+(d.riverBonus&&crosses(n,oldPos,h)?d.riverBonus:0));
   if(crosses(n,oldPos,h)&&h.hp>0){if(d.riverDraw&&once(n,'surf'))draw(n,d.riverDraw);if(d.riverEnergy&&once(n,'boat')){n.energy+=d.riverEnergy;emit(n,'energy',{amount:d.riverEnergy});}}
   if(n.relics.includes('step')&&!n.relicUsed.step){n.relicUsed.step=true;n.energy++;emit(n,'energy',{amount:1});}
  }
  if(d.op==='swap'){h.x=p.x;h.y=p.y;e.x=oldPos.x;e.y=oldPos.y;emit(n,'move',{unit:h.id,from:oldPos,to:{...p}});emit(n,'move',{unit:e.id,from:p,to:oldPos,forced:true});if(enemyUnit(e)&&crosses(n,p,oldPos))tideProc(n,e);if(e.kind!=='beacon'&&crosses(n,p,oldPos)){emit(n,'forced-cross',{unit:e.id});if(n.relics.includes('tidalring')&&!n.relicUsed.tidalring){n.relicUsed.tidalring=true;hit(n,e,3);}}terrain(n,h);terrain(n,e);dislocate(n,e);if(h.hp>0){trigger(n,'move');if(previousBank!==bank(n,h)&&n.river!==null){emit(n,'cross');trigger(n,'cross');}}}
  if(['pierce','first','across'].includes(d.op))for(const q of ray(n,h,Math.sign(x-h.x),Math.sign(y-h.y),d.range)){const u=at(n,q.x,q.y);if(u){attack(u,d.damage+(d.op==='across'&&crosses(n,h,u)?d.bonus:0));if(['first','across'].includes(d.op))break;}}
  if(['flag','stone'].includes(d.op))putProp(n,d.op,p,d.op==='stone'?3:1,d.ttl);
  if(d.op==='thorns')n.board[y*n.width+x]='spikes';
  if(d.op==='quake')for(const u of units(n).filter(u=>!allied(u)&&dist(u,h)===1)){attack(u);pushUnit(n,u,Math.sign(u.x-h.x),Math.sign(u.y-h.y),d.push);}
  if(d.op==='draw'){draw(n,d.draw);if(d.breakShield&&n.flags.interrupted)shield(n,d.breakShield);}
  if(d.op==='heal'){const amount=Math.min(d.heal,h.maxHp-h.hp);h.hp+=amount;emit(n,'heal',{unit:h.id,amount});}
  if(d.op==='momentum')gain(n,d.momentum);if(d.op==='discount')n.discount+=d.discount;
  if(d.op==='wallhit'){const touch=DIRS.some(([dx,dy])=>!inside(s,e.x+dx,e.y+dy)||wall(n,e.x+dx,e.y+dy));attack(e,d.damage+(touch?d.bonus:0));}
  if(d.op==='seal'){attack(e);if(e.hp>0&&e.plan?.strong)interrupt(n,e,true);schoolControl(n,e);}
  if(d.op==='expose'){e.exposed=2;emit(n,'expose',{unit:e.id});schoolControl(n,e);}
  if(d.op==='disrupt'){if(d.strip)e.shield=0;e.suppressed=true;if(d.draw)draw(n,d.draw);schoolControl(n,e);}
  if(d.op==='root'){if(d.damage)attack(e);if(e.hp>0){e.rooted=true;emit(n,'root',{unit:e.id});schoolControl(n,e);}}
  if(d.op==='mark')addMark(n,e,d.marks);
  if(d.op==='power'){if(!n.powers[d.power])n.powers[d.power]={stacks:0,level:0};n.powers[d.power].stacks++;n.powers[d.power].level=Math.max(n.powers[d.power].level,c.level);emit(n,'power-on',{key:d.power});}
  if(d.op==='ferry'){shield(n,d.shield);if(n.flags.cross)draw(n,d.draw);}
 }
 if(typeof index==='number'&&d.school==='sword'&&d.damage){const count=(n.flags['path-swords']||0)+1;n.flags['path-swords']=count;if(pathOn(n,'shadowblade',2)&&count<=2)n.bodyDiscount++;if(pathOn(n,'shadowblade',3)&&count===3){emit(n,'sword-echo');for(const h of n.swordHits){const u=units(n).find(u=>u.id===h.id);if(u&&!allied(u))hit(n,u,Math.max(1,Math.floor(h.raw/2)),{source:'hero',echo:true});}}}delete n.swordHits;record(n);settle(n);if(n.phase==='battle')refresh(n);lessonUpdate(n);n.actionRewarded=null;n.activeSource=null;chronicle(n);return {ok:true,state:n};
}
function chronicle(s){for(const e of s.events){let text={cross:'渡河得势',dislocate:'敌棋失阵',break:'棋阵已断',interrupt:'强招已断',ultimate:'绝技出手',fall:'坠入裂隙',phase:'首领进入第二阶段'}[e.type];if(e.type==='redraw')text='变招 · 换去整手牌';if(e.type==='lamp-art')text='命灯 · '+e.name;if(e.type==='card')text='打出「'+D.cards[e.key].name+'」';if(e.type==='hit')text=(e.via==='beacon'?'命灯':e.unit==='hero'?'侠':e.unit)+' '+(e.cause||({tide:'涨潮',spikes:'荆棘',echo:'回响',bomb:'爆符'})[e.source]||'受击')+' −'+e.amount;if(text)s.log.push(text);}s.log=s.log.slice(-60);}
function shiftRiver(s,r){if(s.riverShiftedTurn===s.turn)return;s.riverShiftedTurn=s.turn;r=Math.max(1,Math.min(s.height-3,r));s.previousRiver=s.river;s.river=r;if(!s.bridges.length)s.bridges=[3];for(const x of s.bridges){s.board[r*(s.width||7)+x]='floor';s.board[(r+1)*(s.width||7)+x]='floor';}for(const e of living(s))dislocate(s,e);emit(s,'river',{river:r});}
function position(s){return clone({width:s.width,height:s.height,mask:s.mask,objective:s.objective,shrines:s.shrines,fieldPlan:s.fieldPlan,hero:s.hero,beacon:s.beacon,enemies:s.enemies,props:s.props,board:s.board,river:s.river,bridges:s.bridges,hazards:s.hazards,echoes:s.echoes,formation:s.formation,turn:s.turn});}
function resolveEnemy(n,id,frames=null){
 n.events=[];if(n.phase==='battle'&&n.enemyPhaseTurn!==n.turn){n.enemyPhaseTurn=n.turn;for(const e of living(n))e.shield=0;}n.actionRewarded=null;if(n.phase!=='battle')return;refresh(n);const e=living(n).find(e=>e.id===id);if(!e)return;const it=clone(e.intent),origin={x:e.x,y:e.y};n.activeSource=e.id;emit(n,'enemy',{unit:e.id,label:it.label});
 for(const a of it.actions){if(e.hp<=0||n.hero.hp<=0)break;const before=frames?position(n):null,start=n.events.length;
  if(a.type==='move'){for(const q of a.path||[a.dest]){if(!moveUnit(n,e,q))break;if(e.dislocated&&bank(n,e)===e.home)e.dislocated=false;}}
  if(a.type==='attack'){let sharedHit=false;for(const q of a.cells){const u=at(n,q.x,q.y);if(allied(u)){if(sharedHit)continue;sharedHit=true;}if(u&&u.id!==e.id)hit(n,u,a.damage,{attack:true,source:a.source||e.id});if(n.hero.hp<=0)break;}if(e.mutation==='reverb'&&it.strong)n.echoes.push({cells:a.cells,damage:Math.ceil(a.damage/2),due:n.turn+1});}
  if(a.type==='land'&&!at(n,a.dest.x,a.dest.y)&&!e.rooted)moveUnit(n,e,a.dest);
  if(a.type==='guard')e.shield+=a.amount;
  if(a.type==='protect')for(const target of a.ids){const u=living(n).find(u=>u.id===target);if(u)u.shield+=a.amount;}
  if(a.type==='allymove'){const ally=living(n).find(q=>q.id===a.id);if(ally)for(const q of a.path){if(!moveUnit(n,ally,q))break;}}
  if(a.type==='spawn')putProp(n,a.kind,a.dest,a.hp,a.ttl,e.id);
  if(a.type==='banner'&&!n.props.some(q=>q.kind==='banner'&&q.owner===e.id)){const dest=DIRS.map(([dx,dy])=>({x:e.x+dx,y:e.y+dy})).find(q=>inside(n,q.x,q.y)&&!at(n,q.x,q.y)&&tile(n,q.x,q.y)==='floor');if(dest)putProp(n,'banner',dest,5,12,e.id);}
  if(a.type==='buildframe'){const points=ray(n,e,...a.dir),first=points.map(q=>at(n,q.x,q.y)).find(Boolean);if(!first||first.id===a.targetId){const stop=first?dist(e,first):99,dest=points.find(q=>dist(e,q)<stop&&!at(n,q.x,q.y)&&tile(n,q.x,q.y)==='floor');if(dest)putProp(n,'flag',dest,2,3,e.id);}}
  if(a.type==='charge'){e.charge=clone(a.charge);emit(n,'prepare',{unit:e.id,...a.charge});}
  if(a.type==='cores'){for(const q of a.spots)putProp(n,'core',q,6,99,e.id);const cores=n.props.filter(q=>q.kind==='core'&&q.owner===e.id),source=cores[Math.floor(n.turn/4)%Math.max(1,cores.length)];if(source){e.charge={cells:ray(n,source,...toward(source,a.aim),4),damage:9,source:source.id};emit(n,'prepare',{unit:e.id,...e.charge});}}
  if(a.type==='clearCharge')e.charge=null;
  if(a.type==='reinforce'){const q=[{x:1,y:2},{x:5,y:2},{x:3,y:2}].find(q=>!at(n,q.x,q.y)&&tile(n,q.x,q.y)==='floor');if(q&&living(n).filter(q=>!q.boss).length<2)n.enemies.push(newEnemy(n,'pawn',q.x,q.y));}
  if(a.type==='hazard'){const h={cells:a.cells,damage:a.damage,label:e.name+'·'+(a.label||'镇地'),starts:n.turn+1,expires:n.turn+(e.elite?2:1),source:e.id};n.hazards.push(h);emit(n,'hazard',h);}
  if(a.type==='river')shiftRiver(n,a.river);
  if(frames&&a.type!=='clearCharge')frames.push({actorId:e.id,name:e.name,label:it.label,action:clone(a),before,position:position(n),events:clone(n.events.slice(start)),future:it.future,order:frames.length});
 }
 if(['rook_cannon','knight_cannon','cannon_elephant'].includes(e.kind)&&!same(origin,e)){e.previousPosition=origin;if(!at(n,origin.x,origin.y)&&tile(n,origin.x,origin.y)==='floor')putProp(n,'flag',origin,2,3,e.id);}
 record(n);settle(n);if(n.phase==='battle')refresh(n);n.activeSource=null;chronicle(n);
}
function executeEnemy(s,id){const n=clone(s);resolveEnemy(n,id);return n;}
function finishTurn(s){const n=clone(s);n.events=[];if(n.phase!=='battle')return n;
 applyField(n);for(const h of n.hazards)if((h.starts||0)<=n.turn&&h.cells.some(p=>same(p,n.hero)||same(p,n.beacon))){const via=h.cells.some(p=>same(p,n.hero))?null:'beacon';hit(n,n.hero,h.damage,{source:h.source||'terrain',cause:h.label||'镇地',via,hitAt:via?{x:n.beacon.x,y:n.beacon.y}:null});}
 for(const echo of n.echoes)if(echo.due===n.turn){let sharedHit=false;for(const p of echo.cells){const u=at(n,p.x,p.y);if(allied(u)){if(sharedHit)continue;sharedHit=true;}if(u)hit(n,u,echo.damage,{source:'echo'});}}
 n.echoes=n.echoes.filter(e=>e.due>n.turn);n.hazards=n.hazards.filter(h=>h.expires>n.turn);
 for(const p of n.props)p.ttl--;n.props=n.props.filter(p=>p.hp>0&&p.ttl>0);record(n);settle(n);
 if(n.phase==='battle'){const retained=n.hand.filter(c=>D.cards[c.key].retain);n.discard.push(...n.hand.filter(c=>!D.cards[c.key].retain));n.hand=retained;startTurn(n);emit(n,'turn',{turn:n.turn});}lessonUpdate(n);chronicle(n);return n;
}
function forecast(s,withFrames=true){let n=clone(s),events=[],frames=[];if(s.phase!=='battle')return {state:n,frames,loss:0};n.events=[];const opening=position(n);tickObjective(n);settle(n);events.push(...n.events);if(n.events.length&&withFrames)frames.push({actorId:'objective',name:'命灯',label:'场地目标',action:{type:'objective'},before:opening,position:position(n),events:clone(n.events),future:[],order:0});if(n.phase!=='battle'){n.events=events;return {state:n,frames,loss:Math.max(0,s.hero.hp-n.hero.hp)};}for(const id of living(s).map(e=>e.id)){resolveEnemy(n,id,withFrames?frames:null);events.push(...n.events);if(n.phase!=='battle')break;}
 if(n.phase==='battle'){const before=withFrames?position(n):null;n=finishTurn(n);events.push(...n.events);if(withFrames)frames.push({actorId:'round',name:'回合末',label:'地形 · 换手',action:{type:'round',cells:[...s.hazards.filter(h=>(h.starts||0)<=s.turn),...s.echoes.filter(h=>h.due===s.turn)].flatMap(h=>h.cells)},before,position:position(n),events:clone(n.events),future:[],order:frames.length});}n.events=events;return {state:n,frames,loss:Math.max(0,s.hero.hp-n.hero.hp)};
}
function endTurn(s){return forecast(s,false).state;}
function newRun(options={}){if(typeof options==='number')options={seed:options,school:'sword'};const school=options.school||'sword';if(!D.schools[school])throw Error('未知武学');const seed=options.seed??Date.now(),hp=D.schools[school].hp;
 const s={version:6,width:7,height:8,mask:Array(56).fill(true),pathKey:null,tier:0,bodyDiscount:0,queuedEnergy:0,forceSteps:{},fieldPlan:null,shrines:[],objective:null,rng:seed>>>0,school,schoolChosen:true,phase:'map',cardSerial:0,deck:[],relics:[],beacon:null,hero:{id:'hero',kind:'hero',name:'侠',x:3,y:6,hp,maxHp:hp,shield:0,unpushable:false,counter:0},enemies:[],props:[],board:Array(56).fill('floor'),river:3,bridges:[2,4],layout:'渡口',turn:0,serial:0,momentum:0,energy:3,gained:0,freeMove:true,flowUsed:false,flowFree:false,flags:{},powers:{},activeCards:[],hand:[],draw:[],discard:[],exhaust:[],hazards:[],echoes:[],events:[],log:[],kills:0,plays:0,relicUsed:{},enemyPhaseTurn:0,discount:0,fingerDiscount:0,edge:0,formation:null,boss:0,elite:false,tutorial:false,actionRewarded:null,activeSource:null,collisionShield:0,pendingCollisionSplash:0,encounterSeed:0};
 J.newAdventure(s);for(const key of D.schools[school].starter)s.deck.push(J.card(s,key));return s;
}
function enter(s,id){if(s.phase!=='map')return s;const next=J.available(s).find(n=>n.id===id);if(!next)return s;const n=clone(s),chosen=n.maps.flat().find(q=>q.id===id);chosen.visited=true;n.row=chosen.row;n.lane=chosen.lane;n.nodeId=chosen.id;n.path.push(chosen.id);n.events=[];
 if(['battle','elite','boss','mission'].includes(chosen.type))setup(n,chosen);if(chosen.type==='shop'){n.phase='shop';J.shop(n);}if(chosen.type==='cache'){n.phase='cache';n.cache={gold:35,relic:J.choose(n,J.relicPool(n)),claimed:false};}if(chosen.type==='event'){n.phase='event';J.event(n);}if(chosen.type==='camp'){n.phase='camp';n.camp={used:false,draft:n.pathKey};}return n;
}
function addRelic(s,id){if(!id||s.relics.includes(id)||!D.relics[id])return;s.relics.push(id);if(id==='heart'){s.hero.maxHp+=8;s.hero.hp=Math.min(s.hero.maxHp,s.hero.hp+8);}}
function choose(s,kind,id){const n=clone(s);if(n.phase!=='reward')return s;const r=n.reward;if(kind==='card'&&!r.cardDone&&(id===null||r.cards.includes(id))){if(id)n.deck.push(J.card(n,id));r.cardDone=true;}if(kind==='relic'&&!r.relicDone&&r.relics.includes(id)){addRelic(n,id);r.relicDone=true;}return n;}
function next(s){if(s.phase!=='reward'||!s.reward.cardDone||!s.reward.relicDone)return s;const n=clone(s);if(J.isBoss(n)&&n.chapter<3){n.tier=Math.min(3,(n.tier||1)+1);n.phase='ascend';n.progression={from:'boss',removed:false,removeDone:false};}else J.finish(n);return n;}
function insight(s,action,id){if(s.phase!=='insight')return s;const n=clone(s);if(action==='draft'&&D.paths[id]?.school===s.school){n.insight.draft=id;return n;}if(action!=='confirm'||!D.paths[n.insight.draft])return s;n.pathKey=n.insight.draft;n.tier=1;n.deck.push(J.card(n,D.paths[n.pathKey].core));n.insight=null;n.phase='ascend';n.progression={from:'insight',removed:false,removeDone:false};return n;}
function openCache(s,kind){if(s.phase!=='cache'||s.cache.claimed||!['gold','relic'].includes(kind))return s;const n=clone(s);if(kind==='relic'){if(!n.cache.relic)return s;addRelic(n,n.cache.relic);}else n.gold+=n.cache.gold;n.cache.claimed=kind;return n;}
function buy(s,kind,index){if(s.phase!=='shop')return s;const n=clone(s),shop=n.shop;
 if(kind==='card'||kind==='borrow'){const offer=kind==='borrow'?shop.borrow:shop.cards[index];if(!offer||offer.sold||n.gold<offer.price)return s;n.gold-=offer.price;n.deck.push(J.card(n,offer.key));offer.sold=true;}
 else if(kind==='relic'){if(!shop.relic||shop.relicSold||n.gold<110)return s;n.gold-=110;addRelic(n,shop.relic);shop.relicSold=true;}
 else if(kind==='medicine'){if(shop.medicineBought||n.gold<25||n.hero.hp>=n.hero.maxHp)return s;n.gold-=25;n.hero.hp=Math.min(n.hero.maxHp,n.hero.hp+8);shop.medicineBought=true;}
 else if(kind==='remove'){const c=n.deck.find(c=>c.id===index);if(!c||n.deck.length<=5||shop.removed||n.gold<n.removeCost)return s;n.gold-=n.removeCost;n.removeCost+=25;n.deck=n.deck.filter(c=>c.id!==index);shop.removed=true;}else return s;return n;
}
function camp(s,action,id){if(s.phase!=='camp')return s;const n=clone(s);if(action==='path'){if(n.routeVersion===2||n.chapter!==1||n.pathKey||D.paths[id]?.school!==n.school)return s;n.camp.draft=id;return n;}if(s.camp.used)return s;if(action==='heal'){n.hero.hp=Math.min(n.hero.maxHp,n.hero.hp+Math.ceil(n.hero.maxHp*.25));n.camp.used=true;}else if(action==='upgrade'){const c=n.deck.find(c=>c.id===id);if(!c||c.level)return s;c.level=1;n.camp.used=true;}else return s;return n;}
function ascend(s,action,id){if(s.phase!=='ascend')return s;const n=clone(s);if(action==='remove'&&!n.progression.removeDone&&n.deck.length>5){if(!n.deck.some(c=>c.id===id))return s;n.deck=n.deck.filter(c=>c.id!==id);n.progression.removed=true;n.progression.removeDone=true;}else if(action==='skip')n.progression.removeDone=true;else if(action==='continue'&&n.progression.removeDone){n.progression=null;J.finish(n);}else return s;return n;}
function leave(s){if(!['camp','shop','event','cache'].includes(s.phase)||s.phase==='cache'&&!s.cache.claimed||s.phase==='event'&&!s.event.resolved||s.phase==='camp'&&!s.camp.used)return s;const n=clone(s);if(s.phase==='camp'&&s.routeVersion!==2&&s.chapter===1&&!s.pathKey){if(!D.paths[s.camp.draft])return s;n.pathKey=s.camp.draft;n.tier=1;n.deck.push(J.card(n,D.paths[n.pathKey].core));n.phase='ascend';n.progression={from:'camp',removed:false,removeDone:false};}else J.finish(n);return n;}
function eventChoice(s,choice,id){if(s.phase!=='event'||s.event.resolved)return s;const n=clone(s),e=n.event,finish=text=>{e.resolved=true;e.pending=null;e.message=text;},payHp=cost=>{if(n.hero.hp<=cost)return false;n.hero.hp-=cost;return true;},select=(pending)=>{e.pending=pending;};
 if(choice==='leave'){finish('另寻前路。');return n;}
 if(e.name==='井泉'){if(choice==='a'){n.hero.hp=Math.min(n.hero.maxHp,n.hero.hp+8);finish('井泉清冽，回复8生命。');}else{n.hero.maxHp+=4;n.hero.hp+=4;finish('饮尽泉心，生命上限与当前生命各加4。');}}
 if(e.name==='遗阵'){if(choice==='a'){if(n.gold<25)return s;n.gold-=25;n.provisions.shield+=8;finish('下一战开局护盾8。');}else{if(!payHp(4))return s;n.gold+=40;finish('拆阵失4生命，得到40金。');}}
 if(e.name==='灯市'){const cost=choice==='a'?55:15;if(n.gold<cost)return s;n.gold-=cost;if(choice==='a'){n.hero.maxHp+=4;n.hero.hp+=4;finish('添灯油：生命上限与当前生命各加4。');}else{n.hero.hp=Math.min(n.hero.maxHp,n.hero.hp+6);finish('暖灯汤：回复6生命。');}}
 if(e.name==='试武'){if(choice==='b'){if(!payHp(3))return s;n.gold+=25;finish('应邀演武，失3生命、得25金。');}else{if(!id){if(n.hero.hp<=6||!n.deck.some(c=>!c.level))return s;select('upgrade-spar');return n;}const c=n.deck.find(c=>c.id===id&&!c.level);if(!c||!payHp(6))return s;c.level=1;finish('以6生命磨成一式。');}}
 if(e.name==='纸鸢'){if(choice==='a'){if(n.gold<25)return s;n.gold-=25;n.provisions.boat+=3;finish('接下来三战首次渡河各抽一张。');}else{n.gold+=15;finish('拾纸修鸢，得到15金。');}}
 if(e.name==='星坛'){if(choice==='a'){if(!e.relic||!payHp(7))return s;addRelic(n,e.relic);finish('失7生命，得到'+D.relics[e.relic].name+'。');}else{if(n.deck.length<=5)return s;if(!id){select('remove-free');return n;}if(!n.deck.some(c=>c.id===id))return s;n.deck=n.deck.filter(c=>c.id!==id);finish('卸下旧念，忘却一式。');}}
 if(e.name==='访剑'){if(choice==='a'&&n.gold<30||choice==='b'&&n.hero.hp<=4)return s;if(!id){select(choice==='a'?'upgrade-gold':'upgrade-hp');return n;}const c=n.deck.find(c=>c.id===id&&!c.level);if(!c)return s;if(choice==='a')n.gold-=30;else n.hero.hp-=4;c.level=1;finish('磨剑出锋。');}
 if(e.name==='赌棋'){if(n.gold<20)return s;n.gold-=20;if(e.roll<.5){n.gold+=60;finish('胜局，获得六十金。');}else finish('惜败，失去二十金。');}
 if(e.name==='破庙'){if(choice==='a'){if(!payHp(4))return s;if(e.relic){addRelic(n,e.relic);finish('供血四点，得到'+D.relics[e.relic].name+'。');}else{n.gold+=70;finish('获得七十金。');}}else{n.hero.hp=Math.min(n.hero.maxHp,n.hero.hp+6);finish('回复六点生命。');}}
 if(e.name==='残谱'){if(choice==='a'||choice==='c'){if(choice==='c'&&n.gold<30)return s;if(!id){select(choice==='c'?'foreign':'offer');return n;}const offers=choice==='c'?e.foreign:e.offers;if(!offers.includes(id))return s;if(choice==='c')n.gold-=30;n.deck.push(J.card(n,id));finish('收下招式。');}else{if(n.gold<35||n.deck.length<=5)return s;if(!id){select('remove');return n;}if(!n.deck.some(c=>c.id===id))return s;n.gold-=35;n.deck=n.deck.filter(c=>c.id!==id);finish('忘却一式。');}}
 if(e.name==='渡口'){n.override={river:choice==='a'?2:4,bridges:choice==='a'?[1,5]:[2,4]};finish(choice==='a'?'下一阵选北渡，桥在两翼。':'下一阵选南渡，桥在中路。');}
 if(e.name==='镖局'){if(choice==='a'){n.quest={type:'escort',reward:40};finish('下一阵护住镖印，额外四十金；损毁则无额外奖励。');}else{n.gold+=10;finish('收下十金路费。');}}
 if(e.name==='旧棋摊'){if(choice==='a'){if(!e.relic)return s;if(n.relics.length){const old=id||n.relics[0];if(!n.relics.includes(old))return s;n.relics=n.relics.filter(k=>k!==old);if(old==='heart'){n.hero.maxHp-=8;n.hero.hp=Math.min(n.hero.hp,n.hero.maxHp);}addRelic(n,e.relic);finish('以旧换新，获得'+D.relics[e.relic].name+'。');}else{if(n.gold<55)return s;n.gold-=55;addRelic(n,e.relic);finish('购得'+D.relics[e.relic].name+'。');}}else{n.gold+=15;finish('得十五金。');}}
 if(e.name==='断桥'){if(choice==='a'){if(!payHp(5))return s;n.gold+=35;finish('涉险失五血，得三十五金。');}else{if(n.gold<20)return s;n.gold-=20;n.override={bridges:[2,4]};finish('修好下一阵的两座桥。');}}
 if(e.name==='船翁'){if(choice==='a'){if(n.gold<20)return s;n.gold-=20;n.provisions.boat+=2;finish('接下来两场，每场首次渡河抽一张。');}else{n.gold+=10;finish('帮忙摆渡，得十金。');}}
 if(e.name==='机关匠'){if(choice==='a'){if(n.gold<35)return s;if(!id){select('upgrade-artisan');return n;}const c=n.deck.find(c=>c.id===id&&!c.level);if(!c)return s;n.gold-=35;c.level=1;finish('精进一式。');}else{n.provisions.shield=6;finish('下一场开局护盾6。');}}
 if(e.name==='照影'){if(choice==='a'){if(n.gold<75)return s;if(!id){select('copy');return n;}const c=n.deck.find(c=>c.id===id);if(!c)return s;n.gold-=75;n.deck.push(J.card(n,c.key,c.level));finish('照影成双。');}else{if(n.hero.hp<=5)return s;if(!id){select('upgrade-mirror');return n;}const c=n.deck.find(c=>c.id===id&&!c.level);if(!c)return s;n.hero.hp-=5;c.level=1;finish('以五血精进一式。');}}
 if(e.name==='问心'){if(choice==='a'){if(!e.pending&&!n.relics.length)return s;if(!e.pending){const old=n.relics.shift();if(old==='heart'){n.hero.maxHp-=8;n.hero.hp=Math.min(n.hero.hp,n.hero.maxHp);}e.remaining=2;select('offer-wish');e.offers=J.offers(n);return n;}if(!e.offers.includes(id))return s;n.deck.push(J.card(n,id));e.remaining--;if(e.remaining){e.offers=J.offers(n);return n;}finish('换得两式，继续前行。');}else{if(n.deck.length<=5)return s;if(!id){select('remove-free');return n;}if(!n.deck.some(c=>c.id===id))return s;n.deck=n.deck.filter(c=>c.id!==id);finish('放下一式。');}}
 return n;
}
// Compatibility arenas for rule/feedback tests and path previews; guided courses live in lessons.js.
function tutorial(index=0,school='sword'){
 index=Math.max(0,Math.min(9,index));const s=newRun({seed:900+index,school});s.rng=(900+index)>>>0;s.tutorial=true;s.lesson=index;s.lessonProgress={};setup(s,{type:'battle',river:3,bridges:[3],layout:'试剑',formation:'guard_gun',row:0,seed:900+index});s.width=7;s.height=8;s.mask=Array(56).fill(true);s.board=Array(56).fill('floor');s.hero.x=3;s.hero.y=6;s.beacon=null;s.enemies=[];s.props=[];s.shrines=[];s.fieldPlan=null;s.objective=null;s.boss=0;s.elite=false;s.formation=null;s.objectiveId=null;s.serial=0;s.events=[];s.tier=0;s.pathKey=null;
 const enemy=(kind,x,y,hp)=>{const e=newEnemy(s,kind,x,y);if(hp)e.hp=e.maxHp=hp;s.enemies.push(e);return e;};let keys=[];
 if(index===0){enemy('pawn',2,5,5);enemy('pawn',6,0,30);keys=['jab','guard','dash'];}
 if(index===1){s.hero.x=2;s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:3,y:6,hp:1,maxHp:1,shield:0};enemy('rook',3,3);enemy('pawn',6,0,30);keys=['guard','boat','jab'];}
 if(index===2){enemy('rook',3,3);enemy('pawn',6,0,30);keys=['guard','jab','boat'];}
 if(index===3){s.hero.y=5;enemy('pawn',4,4,20);enemy('pawn',6,0,30);putProp(s,'bomb',{x:3,y:4},3,99);s.board[3*7+4]='spikes';keys=['jab','shove','guard'];}
 if(index===4){s.hero.y=4;enemy('cannon',3,2);enemy('pawn',6,0,30);keys=['dash','slash','guard'];}
 if(index===5){s.hero.y=5;s.river=null;s.bridges=[];enemy('advisor',3,3);enemy('cannon',3,1);enemy('pawn',6,0,30);s.formation={key:'guard_gun',name:'士护炮',ids:s.enemies.slice(0,2).map(e=>e.id),eye:s.enemies[1].id,active:false,brokenTurn:-1};keys=['hook','guard','boat'];}
 if(index===6){s.hero.y=5;enemy('advisor',3,3);enemy('cannon',3,1);enemy('pawn',6,0,30);s.formation={key:'guard_gun',name:'士护炮',ids:s.enemies.slice(0,2).map(e=>e.id),eye:s.enemies[1].id,active:false,brokenTurn:-1};keys=['hook','surf','guard'];}
 if(index===7){s.hero.y=4;s.momentum=2;enemy('rook',3,2,40);enemy('pawn',6,0,30);if(school==='sword'){keys=['flow','dash','slash','resolve','guard'];}else if(school==='palm'){s.enemies[0].y=3;s.board[2*7+3]='wall';keys=['impact','mountain','push','resolve','guard'];}else keys=['silence','expose','seal','resolve','needle','guard'];}
 if(index===8){s.hero.x=2;s.hero.y=5;s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:3,y:5,hp:1,maxHp:1,shield:0};enemy('pawn',6,0,30);s.objective={kind:'escape',x:3,y:4,progress:0,ids:[]};keys=['guard','boat','jab'];}
 if(index===9){s.beacon={id:'beacon',kind:'beacon',name:'命灯',x:3,y:7,hp:1,maxHp:1,shield:0};enemy('pawn',2,4,10);enemy('rook',3,3,12);enemy('cannon',5,1,12);keys=[...D.schools[school].starter];}
 s.deck=keys.map(k=>J.card(s,k));s.hand=clone(s.deck.slice(0,index===9?5:keys.length));s.draw=clone(s.deck.slice(s.hand.length));s.discard=[];s.exhaust=[];s.activeCards=[];s.powers={};refresh(s,true);
 if(index===4){s.enemies[0].plan={kind:'cannon',origin:{x:3,y:2},dir:[0,-1],aim:{x:3,y:0},targetId:'hero',strong:true,label:'蓄砲',steps:[{type:'charge',charge:{cells:[{x:3,y:0}],damage:8}}]};refresh(s);}
 if([5,6].includes(index)){s.enemies[0].plan.protect=true;refresh(s);}
 if(index===7&&school==='finger'){s.enemies[0].plan.strong=true;refresh(s);}
 s.events=[];return s;
}
function lessonUpdate(s){if(!s.tutorial||s.guided||s.phase!=='battle')return;const p=s.lessonProgress;for(const e of s.events){if(e.type==='move'&&e.unit==='hero')p.move=true;if(e.type==='beacon-move')p.beaconMove=true;if(e.type==='card')p.card=true;if(e.type==='hit'&&e.source==='hero')p.attack=true;if(e.type==='shield')p.shield=true;if(e.type==='turn')p.round=true;if(e.type==='interrupt')p.interrupted=true;if(e.type==='break')p.break=true;if(e.type==='collision')p.collision=true;if(e.type==='cross')p.cross=true;if(e.type==='dislocate')p.dislocate=true;if(e.type==='power')p.power=true;if(e.type==='explode')p.explode=true;if(e.type==='hit'&&e.at&&tile(s,e.at.x,e.at.y)==='spikes'&&e.amount>0)p.spikes=true;if(e.type==='ultimate')p.ultimate=true;}
 const done=[p.move&&p.attack&&p.round,p.inspect&&p.beaconMove&&p.round,p.inspect&&p.forecast&&p.move&&p.round,p.explode&&p.spikes,p.interrupted,p.inspect&&p.break,p.dislocate&&p.cross,p.power&&p.ultimate,false,false][s.lesson];if(done)s.phase='lesson';}
function lessonStep(s){const p=s.lessonProgress||{};return s.lesson===0?(!p.move?0:!p.attack?1:2):s.lesson===1?(!p.inspect?0:!p.beaconMove?1:2):s.lesson===2?(!p.inspect?0:!p.forecast?1:2):s.lesson===3?(!p.explode?0:!p.collision?1:2):s.lesson===4?(!p.move?0:!p.interrupted?1:2):s.lesson===5?(!p.inspect?0:!p.break?1:2):s.lesson===6?(!p.dislocate?0:!p.cross?1:2):s.lesson===7?(!p.power?0:!p.move&&!p.interrupted&&!p.collision?1:2):s.lesson===8?(!p.beaconMove?0:1):0;}
function lessonInspect(s,what){if(!s.tutorial||s.phase!=='battle')return s;const n=clone(s);n.lessonProgress[what]=true;lessonUpdate(n);return n;}
function demo(index,school='sword'){
 let s=tutorial(index,school),before=clone(s);const steps=[];
 const act=(i,x,y)=>{const r=typeof i==='string'&&D.cards[i]?s.hand.findIndex(c=>c.key===i):i,res=Gact(s,r,x??s.hero.x,y??s.hero.y);if(res.ok){s=res.state;steps.push({index:r,x:x??before.hero.x,y:y??before.hero.y});}};const Gact=actRule;
 if(index===0){act('move',2,6);act('jab',2,5);act('guard');s=endTurn(s);}
 if(index===1){s=lessonInspect(s,'inspect');act('beaconMove',4,6);act('guard');s=endTurn(s);}
 if(index===2){s=lessonInspect(s,'inspect');s=lessonInspect(s,'forecast');act('move',2,6);s=endTurn(s);}
 if(index===3){act('guard');act('jab',3,4);act('move',4,5);act('shove',4,4);}
 if(index===4){act('dash',3,3);act('slash',3,2);}
 if(index===5){s=lessonInspect(s,'inspect');act('hook',3,3);}
 if(index===6){act('hook',3,3);act('surf',3,3);}
 if(index===7){if(school==='sword'){act('flow');act('dash',3,3);act('flowstep',2,3);act('resolve');act('ultimate',2,2);}else if(school==='palm'){act('impact');act('mountain');act('push',3,3);act('flowstep',3,5);act('resolve');act('ultimate',3,3);}else{act('silence');act('expose',3,2);act('seal',3,2);act('flowstep',2,4);act('resolve');act('ultimate',3,2);}}
 if(index===8){act('beaconMove',3,4);act('boat',2,4);s=endTurn(s);}
 if(index===9){const p=targets(s,'beaconMove')[0];if(p)act('beaconMove',p.x,p.y);}
 return {before,after:s,steps,caption:['行步出招，护盾承伤','灯离开车线，共享生命未受伤','预告锁定位置，移动后不暗改','爆符伤4，推入荆棘伤3','白菱出剑，强招取消','分离护阵，金线断开','士被拖过河，失阵归岸','心法触发，再借势施展绝技','侠贴近灯，撤离成功','自由组合，先处理两处危险'][index]};
}
const actRule=act;
function pathDemo(key,tier=1){const p=D.paths[key];if(!p)return null;let s=tutorial(0,p.school);s.tutorial=false;s.phase='battle';s.pathKey=key;s.tier=tier;s.energy=tier>=2?4:3;s.momentum=0;s.river=null;s.bridges=[];s.beacon=null;s.hero.x=3;s.hero.y=5;s.enemies=[];s.props=[];s.serial=0;s.formation=null;s.flags={};s.exhaust=[];s.discard=[];s.powers={};s.activeCards=[];s.objective=null;s.fieldPlan=null;s.shrines=[];let keys=[],actions=[];
 const e=newEnemy(s,'rook',3,3);e.hp=e.maxHp=100;s.enemies.push(e);const other=newEnemy(s,'pawn',4,3);other.hp=other.maxHp=100;s.enemies.push(other);
 if(key==='shadowblade'){keys=['dash','slash','dash','slash','slash'];actions=[['dash',3,4],['slash',3,3],['dash',2,4],['move',2,3],['slash',3,3],['slash',3,3]];}
 if(key==='riverblade'){s.river=3;s.bridges=[1];e.y=2;other.x=3;other.y=1;keys=['surf','cloud'];actions=[['surf',3,3],['move',3,4],['cloud',3,2]];}
 if(key==='wallpalm'){s.hero.y=4;s.board[2*7+3]='wall';keys=['push','push'];actions=[['push',3,3],['push',3,3]];}
 if(key==='tidepalm'){s.river=3;s.bridges=[1];e.y=4;keys=['wave'];actions=[['wave',3,4]];}
 if(key==='sealpoint'){s.hero.y=4;e.marks=2;keys=['mark','needle'];actions=[['mark',3,3],['needle',3,3]];}
 if(key==='counterpoint'){s.hero.y=4;keys=['seal','needle'];actions=[['seal',3,3],['needle',3,3]];}
 s.deck=keys.map(k=>J.card(s,k));s.hand=clone(s.deck);s.draw=[J.card(s,'guard'),J.card(s,'guard')];refresh(s,true);if(key==='counterpoint'){e.plan.strong=true;refresh(s);}s.events=[];const before=clone(s),events=[];let count=0;
 for(const [key,x,y]of actions){const idx=key==='move'?key:s.hand.findIndex(c=>c.key===key),r=act(s,idx,x,y);if(!r.ok)break;s=r.state;events.push(...s.events);count++;}s.events=events;return {before,after:s,events,count,caption:p.stages[tier-1],chain:p.chain};
}
function validSave(s){try{
 const number=(n,a=0,b=1e6)=>Number.isFinite(n)&&n>=a&&n<=b,point=p=>p&&inside(s,p.x,p.y),card=c=>c&&typeof c.id==='string'&&D.cards[c.key]&&[0,1].includes(c.level);
 if(!s||s.version!==6||s.tutorial||!['map','battle','reward','shop','event','camp','ascend','insight','cache','victory','defeat'].includes(s.phase)||!D.schools[s.school])return false;
 if(!Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<6||s.width>9||s.height<6||s.height>9||s.board.length!==s.width*s.height||s.mask.length!==s.board.length)return false;
 if(!s.board.every(t=>['floor','wall','spikes','pit','void'].includes(t))||!s.mask.every(b=>typeof b==='boolean'))return false;
 if(!s.hero||!number(s.hero.hp,0,s.hero.maxHp)||!point(s.hero)||!number(s.hero.shield)||s.beacon&&(!point(s.beacon)||dist(s.hero,s.beacon)>TETHER))return false;
 if(!Array.isArray(s.enemies)||s.enemies.some(e=>!point(e)||!number(e.hp)||!D.enemies[e.kind]&&!D.fusions[e.kind]))return false;
 if(!Array.isArray(s.props)||s.props.some(p=>!point(p)||!number(p.hp)))return false;
 if(!Array.isArray(s.maps)||s.maps.length!==3||s.maps.some(m=>!Array.isArray(m)||!m.some(n=>n.row===Math.max(...m.map(q=>q.row))&&n.type==='boss')))return false;
 if(!number(s.completed,0,J.total(s))||!number(s.chapter,1,3)||!number(s.row,-1,J.lastRow(s))||!number(s.gold)||!number(s.energy,0,40)||!number(s.momentum,0,4)||!number(s.gained,0,3))return false;
 if(s.pathKey&&D.paths[s.pathKey]?.school!==s.school||!number(s.tier,0,3))return false;
 if(!Array.isArray(s.deck)||!s.deck.every(card)||!['hand','draw','discard','exhaust','activeCards'].every(k=>Array.isArray(s[k])&&s[k].length<=100&&s[k].every(card)))return false;
 if(!Array.isArray(s.relics)||!s.relics.every(k=>D.relics[k])||!s.flags||!s.powers||Object.keys(s.powers).length>3||Object.values(s.powers).some(p=>!number(p.stacks,1,2)))return false;
 if(s.river!==null&&(!Number.isInteger(s.river)||s.river<1||s.river>s.height-3)||!s.bridges.every(x=>Number.isInteger(x)&&x>=0&&x<s.width))return false;
 if(typeof s.freeMove!=='boolean'||typeof s.flowUsed!=='boolean'||!number(s.hero.maxHp,1,1000)||s.enemies.some(e=>!number(e.maxHp,1,1000)||e.hp>e.maxHp||!number(e.marks||0,0,5)))return false;
 if(s.phase==='reward'&&(!s.reward||!Array.isArray(s.reward.cards)||!s.reward.cards.every(k=>D.cards[k])||!Array.isArray(s.reward.relics)||!s.reward.relics.every(k=>D.relics[k])||typeof s.reward.cardDone!=='boolean'||typeof s.reward.relicDone!=='boolean'))return false;
 if(s.phase==='shop'&&(!s.shop||!Array.isArray(s.shop.cards)||!s.shop.cards.every(c=>D.cards[c.key]&&number(c.price))||!D.cards[s.shop.borrow?.key]))return false;
 if(s.phase==='insight'&&(!s.insight||s.insight.draft&&D.paths[s.insight.draft]?.school!==s.school))return false;
 if(s.phase==='cache'&&(!s.cache||!number(s.cache.gold)||s.cache.relic&&!D.relics[s.cache.relic]))return false;
 if(s.phase==='camp'&&(!s.camp||typeof s.camp.used!=='boolean'||s.camp.draft&&D.paths[s.camp.draft]?.school!==s.school))return false;
 if(s.phase==='event'&&(!s.event||!D.events.includes(s.event.name)||!Array.isArray(s.event.offers)||!s.event.offers.every(k=>D.cards[k])))return false;
 if(Object.entries(s.powers).some(([k,p])=>D.cards[k]?.op!=='power'||![0,1].includes(p.level)))return false;
 if(s.phase==='ascend'&&(!s.progression||!s.pathKey||typeof s.progression.removeDone!=='boolean'))return false;
 if(s.objective&&(!D.objectives[s.objective.kind]||!point(s.objective)))return false;
 return true;
 }catch{return false;}}
const api={SKIRMISHES,redraw,LAMP_ARTS,TRIALS,trialProgress,TETHER,D,J,A,demo,pathDemo,pathOn,ascend,planField,tickObjective,allied,targetFor,CARDS:D.cards,ENEMIES:D.enemies,RELICS:D.relics,clone,inside,dist,same,coord,tile,wall,bank,crosses,bridge,living,units,at,enemyAt,attackable,parts,restricted,component,cardInfo,route,ray,newRun,enter,act,reason,targets,movementCost,refresh,makeIntent,newEnemy,setup,tutorial,lessonUpdate,lessonInspect,lessonStep,executeEnemy,finishTurn,endTurn,forecast,position,simulateEnemyPhase:endTurn,choose,next,insight,openCache,buy,camp,leave,eventChoice,validSave};
if(node)module.exports=api;root.Gambit=api;
})(typeof globalThis!=='undefined'?globalThis:this);
