import test from'node:test';import assert from'node:assert/strict';import{M,campaign}from'./support/game.mjs';
test('both earned careers include a ruling, enforcement and multiple realized later scenes',()=>{for(const route of ['office','letters']){const g=campaign({route}).game,raw=JSON.stringify(g),s=M.endingStory(g),text=s.acts.flatMap(a=>a.text).join('');assert.equal(s.acts.length,5);assert.equal(JSON.stringify(g),raw);for(const word of ['撤销','追缴','革职','四百石'])assert(text.includes(word));if(route==='office')for(const word of ['巡抚','循吏','图册'])assert(text.includes(word));else for(const word of ['文集','游记'])assert(text.includes(word));}});
test('partial, settlement and dismissal state real outcomes and do not receive success epilogues',()=>{for(const options of [{fail:['trial-delivery']},{fail:['trial-old','trial-delivery','trial-duty']},{trade:true}]){const g=campaign(options).game,s=M.endingStory(g);assert.equal(s.acts.length,3);assert(s.acts.flatMap(a=>a.text).join('').length>450);assert(!s.acts.some(a=>a.title==='自在的一生'));}});

test('all mixed life choices echo the actual earlier books and notes without rewriting them',()=>{const base=campaign().game;for(let bits=0;bits<32;bits++){const g=structuredClone(base);g.life=Array.from({length:5},(_,i)=>bits>>i&1?'office':'letters');for(let i=0;i<5;i++){g.answers['life-'+i]=g.life[i];g.choices['life'+i]=g.life[i];}const s=M.endingStory(g),text=s.acts.flatMap(a=>a.text).join('');assert.equal(s.route,M.lifeRoute(g));assert(text.includes(g.life[1]==='office'?'治河图册':'山川游记'));if(s.route==='office'){assert(text.includes(g.life[0]==='office'?'让别县也能少犯一次错':'你先记的是两户怎样过冬'));}else{assert(text.includes(g.life[0]==='office'?'当年先记的核户办法':'记两户怎样过冬的札记'));}}});

test('all five actual life projects pay off on both routes and non-success endings',()=>{
 const alternatives=[['核户办法寄到邻县','两户过冬的札记保留'],['治河图册上标过的险段','山川游记旁添了旧河路'],['邻县送回跨界救急路线','王氏和罗素贞核过那页'],['故人回信挑出救急办法','寄回净水的人物稿收到改字'],['县学收到办事实例','书坊先印经本人核过']];
 const base=campaign().game;
 for(let mask=0;mask<32;mask++)for(const verdict of ['complete','partial','dismissed','settlement']){
  const g=structuredClone(base);g.verdict=verdict;g.life=Array.from({length:5},(_,i)=>mask>>i&1?'office':'letters');
  const before=JSON.stringify(g),text=M.endingStory(g).acts.flatMap(a=>a.text).join('');
  alternatives.forEach((pair,i)=>{const selected=g.life[i]==='office'?0:1;assert(text.includes(pair[selected]));assert(!text.includes(pair[1-selected]));});assert.equal(JSON.stringify(g),before);
 }
});
test('trade pays this winter, review executes next spring, and consequences honor every side option',()=>{
 const trade=M.endingStory(campaign({trade:true}).game);assert.equal(trade.acts[0].art,'enforcement-grain');assert.match(trade.acts[0].text.join(''),/今冬/);assert.match(trade.acts[1].text.join(''),/复查今冬履约/);
 const full=M.endingStory(campaign().game);assert(!full.acts[0].text.join('').includes('被判徒'));assert.match(full.acts[1].text.join(''),/次年春.*终审/);
 const signals={namesApproach:{private:'自己把回话日写在呈请边上',public:'没有变成病户欠修船人的一份情',skip:'里长的另番缘由没有追问到底'},boatApproach:{separate:'补述的抄件能不能带去下一处脚行',ledger:'下埠脚夫后来来领抄件',skip:'船工下一季在哪条水路接活'},reliefApproach:{records:'林阿蘅下回到仓门',neighbours:'罗素贞后来寄出了家信',skip:'两家后来是否和好'},autumnApproach:{protect:'账房的妻子后来带走他的换洗衣物',seal:'春日复查又取那包附件',skip:'没有人因为粮案今冬结了'}};
 for(const n of M.sceneNodes.filter(n=>n.sideStory))for(const o of n.options){const g=campaign({sideChoices:{[n.id]:o.value}}).game;const text=M.endingStory(g).acts.flatMap(a=>a.text).join('');assert(text.includes(signals[n.key][o.value]));for(const other of n.options.filter(x=>x.value!==o.value))assert(!text.includes(signals[n.key][other.value]));assert(!text.includes(M.sideConsequences[n.key][o.value]),'later aftermath must not repeat the earlier closure verbatim');}
 assert.match(full.acts.at(-1).text.at(-1),/吴秋娘.*回单.*没再背种粮/);
});
