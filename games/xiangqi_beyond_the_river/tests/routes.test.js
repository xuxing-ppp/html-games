'use strict';
const {test}=require('node:test'),A=require('node:assert/strict'),G=require('../game/engine'),J=G.J;
test('1000种子：路线全可达、分岔汇合、无交叉，36程、可选营地与商店保证',()=>{
 for(let seed=0;seed<1000;seed++){
  const s=G.newRun({seed});s.pathKey='shadowblade';s.tier=1;for(const map of s.maps){
   const rows=Array.from({length:12},(_,i)=>map.filter(n=>n.row===i).sort((a,b)=>a.lane-b.lane));
   A.equal(rows[0].length,1);A.equal(rows[11].length,1);A.ok(rows[3].some(n=>n.type==='camp'));A.ok(rows[3].some(n=>n.type!=='camp'));let bypass=rows[0][0];for(let r=1;r<12;r++){bypass=rows[r].filter(n=>J.links(bypass,n)&&n.type!=='camp').at(-1);A.ok(bypass,'可避开所有营地');}
   const reached=new Set([rows[0][0].id]);let fork=false,merge=false,restriction=false;
   for(let r=0;r<11;r++){
    const a=rows[r],b=rows[r+1];for(const n of a){A.ok(reached.has(n.id));const next=b.filter(q=>J.links(n,q));A.ok(next.length);if(next.length>1)fork=true;if(next.length<b.length)restriction=true;next.forEach(q=>reached.add(q.id));
     for(const m of a)for(const q of next)for(const v of b.filter(v=>J.links(m,v)))A.ok((n.lane-m.lane)*(q.lane-v.lane)>=0);
    }
    for(const n of b){A.ok(reached.has(n.id));if(a.filter(q=>J.links(q,n)).length>1)merge=true;}
   }
   A.equal(reached.size,map.length);A.ok(fork&&merge&&restriction);A.ok(rows[2].some(n=>n.type==='shop'));A.ok(rows[6].some(n=>n.type==='shop'));A.ok(rows[6].some(n=>n.type==='cache'));A.ok(rows[4].some(n=>n.type==='mission'));
   for(const n of map){const [x,y]=J.position(n);A.ok(x>=50&&x<=510&&y>=60&&y<=1360);}
  }
  // Traverse graph through real availability; chapter transitions retain 12 steps.
  for(let i=0;i<36;i++){const options=J.available(s);A.ok(options.length);const n=options[seed%options.length];s.nodeId=n.id;s.row=n.row;s.lane=n.lane;n.visited=true;J.finish(s);}
  A.equal(s.completed,36);A.equal(s.phase,'victory');
 }
});
test('选路只开放相连节点，存档序列化保留道路；旧图仍可继续',()=>{
 let s=G.newRun({seed:42}),map=s.maps[0];const n=map.find(n=>n.row===1&&n.next.length<map.filter(q=>q.row===2).length);s.row=1;s.nodeId=n.id;
 A.deepEqual(J.available(s).map(q=>q.id).sort(),n.next.slice().sort());A.deepEqual(J.available(JSON.parse(JSON.stringify(s))),J.available(s));
 const locked=map.find(q=>q.row===2&&!n.next.includes(q.id));A.deepEqual(G.enter(s,locked.id),s);
 for(const m of s.maps)for(const n of m){delete n.next;delete n.mapX;delete n.mapY;}
 A.equal(J.available(s).length,map.filter(q=>q.row===2).length);A.ok(G.validSave(s));
});
test('跳过营地也有一阶：第三程悟道可改选、只领一次核心牌与删牌',()=>{let s=G.newRun({seed:3});s.row=2;s.completed=2;s.nodeId=s.maps[0].find(n=>n.row===2).id;J.finish(s);A.equal(s.phase,'insight');A.equal(s.completed,2);A.ok(G.validSave(s));s=G.insight(s,'draft','shadowblade');s=G.insight(s,'draft','riverblade');A.equal(s.deck.length,10);s=G.insight(s,'confirm');A.equal(s.pathKey,'riverblade');A.equal(s.deck.length,11);A.equal(s.tier,1);A.deepEqual(G.insight(s,'confirm'),s);s=G.ascend(s,'skip');s=G.ascend(s,'continue');A.equal(s.completed,3);A.equal(s.phase,'map');A.ok(G.validSave(s));});
test('营地选择不绑进阶，宝匣只能取一种奖励且可保存恢复',()=>{let s=G.newRun({seed:4});s.phase='camp';s.camp={used:false,draft:null};A.deepEqual(G.camp(s,'path','shadowblade'),s);s=G.camp(s,'heal');s=G.leave(s);A.equal(s.phase,'map');s.phase='cache';s.cache={gold:35,relic:'heart',claimed:false};const gold=s.gold;s=G.openCache(s,'gold');A.equal(s.gold,gold+35);A.deepEqual(G.openCache(s,'relic'),s);A.ok(G.validSave(s));s=G.leave(s);A.equal(s.phase,'map');});
test('六个新事件的两条分支、代价与待选牌结算完整',()=>{for(const name of ['井泉','遗阵','灯市','试武','纸鸢','星坛'])for(const choice of ['a','b']){let s=G.newRun({seed:5});s.phase='event';s.gold=200;s.hero.hp=s.hero.maxHp;s.event={name,resolved:false,relic:'heart',offers:['guard'],foreign:['slash'],remaining:0};s=G.eventChoice(s,choice);if(s.event.pending){const id=s.event.pending.includes('upgrade')?s.deck.find(c=>!c.level).id:s.deck[0].id;s=G.eventChoice(s,choice,id);}A.ok(s.event.resolved,name+choice);A.ok(s.hero.hp>0&&s.gold>=0);}});
test('版本6旧路网继续按七程结章，不强制悟道或改写道路',()=>{let s=G.newRun({seed:22});delete s.routeVersion;s.maps=s.maps.map(map=>map.filter(n=>n.row<=6).map(n=>{const q={...n};delete q.next;delete q.mapX;delete q.mapY;if(q.row===6)q.type='boss';return q;}));A.equal(J.total(s),21);A.ok(G.validSave(s));s.row=2;J.finish(s);A.equal(s.phase,'map');s.pathKey='shadowblade';s.tier=1;s.row=6;s.phase='reward';s.reward={cardDone:true,relicDone:true};s=G.next(s);A.equal(s.phase,'ascend');s=G.ascend(s,'skip');s=G.ascend(s,'continue');A.equal(s.chapter,2);A.equal(s.row,-1);});
test('三点场地伤害标明涨潮、荆棘或镇地来源，日志保留具体机制',()=>{let s=G.tutorial(0);s.tutorial=false;s.hero.shield=0;s.fieldPlan={kind:'tide',due:s.turn,damage:3,cells:[{x:s.hero.x,y:s.hero.y}]};let n=G.finishTurn(s);A.ok(n.events.some(e=>e.type==='hit'&&e.source==='tide'&&e.amount===3));A.ok(n.log.some(t=>t.includes('涨潮')));s.fieldPlan=null;s.board[(s.hero.y-1)*s.width+s.hero.x]='spikes';n=G.act(s,'move',s.hero.x,s.hero.y-1).state;A.ok(n.events.some(e=>e.type==='hit'&&e.source==='spikes'));s.hazards=[{cells:[{x:s.hero.x,y:s.hero.y}],damage:3,source:'e0',label:'象·镇地',starts:s.turn,expires:s.turn+1}];n=G.finishTurn(s);A.ok(n.events.some(e=>e.type==='hit'&&e.cause==='象·镇地'&&e.amount===3));});

test('路网适度收疏且节点错落，保留全部节点与道路坐标',()=>{
 let extra=0,chapters=0;
 for(let seed=0;seed<100;seed++)for(const map of G.newRun({seed}).maps){
  const rows=Array.from({length:12},(_,r)=>map.filter(n=>n.row===r));
  const minimum=rows.slice(0,-1).reduce((sum,row,r)=>sum+Math.max(row.length,rows[r+1].length),0);
  extra+=map.reduce((sum,n)=>sum+n.next.length,0)-minimum;chapters++;
  const offsets=map.filter(n=>n.row>0&&n.row<11).map(n=>n.mapY-(1340-n.row*112));
  A.ok(Math.max(...offsets)-Math.min(...offsets)>30,'纵向有可见错落');
  for(const row of rows)for(let i=1;i<row.length;i++)A.ok(row[i].mapX-row[i-1].mapX>=43,'同程节点不重叠');
 }
 A.ok(extra/chapters<10,'每章额外岔线保持克制');
});
