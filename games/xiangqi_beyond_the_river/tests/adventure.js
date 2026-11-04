const G=require('../game/engine'),P=require('./planner'),fs=require('node:fs'),path=require('node:path');
const school=process.argv[2]||'sword',seed=Number(process.argv[3]||42),risk=process.argv[4]==='risk',width=Number(process.argv[5]||4);
let s=G.newRun({school,seed});s.testPath=process.argv[6]||Object.keys(G.D.paths).find(k=>G.D.paths[k].school===school);let step=0,record=null,script=[],battles=[];
while(!['victory','defeat'].includes(s.phase)&&step++<1200){const before=G.clone(s);
 if(s.phase==='battle'){
  if(!record||record.node!==s.nodeId){record={node:s.nodeId,chapter:s.chapter,kind:s.boss?'boss':s.elite?'elite':s.objective?'mission':'normal',layout:s.layout,tier:s.tier,turns:0,damage:0,blocked:0,viaLamp:0,used:[]};battles.push(record);}
  const result=P.bestTurn(s,width,5);
  const count=()=>{for(const e of s.events.filter(e=>e.type==='hit'&&e.unit==='hero')){record.damage+=e.amount;record.blocked+=e.blocked;if(e.via==='beacon')record.viaLamp+=e.amount;}};
  for(const a of result.actions){record.used.push(typeof a.index==='number'?s.hand[a.index].key:a.index);script.push({kind:'act',...a});s=G.act(s,a.index,a.x,a.y).state;count();}
  if(s.phase==='battle'){s=G.endTurn(s);script.push({kind:'end'});count();}record.turns++;if(record.turns>=45&&s.phase==='battle')break;
 }else{if(risk&&s.phase==='map'){const choices=G.J.available(s),n=choices.find(n=>n.type==='mission')||choices.find(n=>n.type==='elite')||P.selectNode(s);s=G.enter(s,n.id);}else s=P.advance(s,school);script.push({kind:'advance',state:s});}
 if(JSON.stringify(before)===JSON.stringify(s)){console.log('STUCK',s.phase,s.event);break;}
}
const name=`${s.testPath}-${seed}`,report={school,path:s.testPath,seed,risk,phase:s.phase,hp:s.hero.hp,completed:s.completed,plays:s.plays,battles,deck:s.deck.map(c=>c.key)};
fs.mkdirSync(path.join(__dirname,'../work/reports'),{recursive:true});fs.mkdirSync(path.join(__dirname,'../work/replays'),{recursive:true});fs.writeFileSync(path.join(__dirname,`../work/reports/run-${name}.json`),JSON.stringify(report,null,2));fs.writeFileSync(path.join(__dirname,`../work/replays/${name}.json`),JSON.stringify(script));console.log(JSON.stringify(report));
