/* Only the current scene campaign is supported. */
(() => {
 'use strict';const M=globalThis.Ming,KEY='jingshui.magistrate.v1';
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x),unique=a=>Array.isArray(a)&&new Set(a).size===a.length,ints=(x,a,b)=>Number.isInteger(x)&&x>=a&&x<=b;
 function parseState(g){
  const fail=()=>{throw Error('当前进度无法继续，请重新开始游戏。');};
  if(!object(g)||g.version!==2||g.ruleset!=='scene-mystery'||!M.sceneById[g.node]||g.chapter!==M.sceneById[g.node].chapter||!['node','result','ending'].includes(g.phase)||!ints(g.beat,0,30))fail();
  for(const k of ['documents','facts','puzzleWork','hints','answers','choices','read','map'])if(!object(g[k]))fail();
  for(const k of ['solved','life','trial','outcomes','completed','history','seenNodes','people','terms','knownPlaces','visitedPlaces','explored','notes'])if(!Array.isArray(g[k]))fail();
  const max=M.sceneById[g.node].index;if(!unique(g.seenNodes)||g.seenNodes.length!==max+1||g.seenNodes.some((id,i)=>id!==M.sceneNodes[i].id)||g.seenNodes.some(id=>!M.sceneById[id]||M.sceneById[id].index>max)||!g.seenNodes.includes(g.node))fail();
  const allowed=new Set(g.seenNodes.flatMap(id=>M.sceneById[id].grant??[]));
  for(const id of g.explored){if(!M.explorationVisits[id]||g.chapter<3)fail();for(const d of M.explorationVisits[id].grant)allowed.add(d);}
  if([...allowed].some(id=>!g.documents[id]))fail();
  for(const[id,d]of Object.entries(g.documents))if(!allowed.has(id)||!M.mysteryDocuments[id]||!object(d)||!ints(d.chapter,0,g.chapter)||typeof d.via!=='string'||typeof d.acquired!=='string')fail();
  for(const earlier of M.sceneNodes.slice(0,max))if(earlier.type==='puzzle'&&!g.solved.includes(earlier.id)&&!g.trial.some(r=>!r.supported&&r.round===['old','delivery','responsibility'][M.puzzles[earlier.id].trialRound]))fail();
  for(const[id,w]of Object.entries(g.puzzleWork)){const p=M.puzzles[id];if(!p||!g.seenNodes.includes(id)||!object(w))fail();if(p.kind==='order'&&(!unique(w.order)||w.order.length!==p.items.length||w.order.some(id=>!p.items.some(i=>i.id===id))))fail();if(p.kind==='match'&&(!object(w.placements)||Object.entries(w.placements).some(([i,t])=>!p.items.some(x=>x.id===i)||!p.targets.some(x=>x.id===t))))fail();if(p.kind==='compare'&&(!Array.isArray(w.pair)||w.pair.length!==2||w.pair.some((id,i)=>id!==null&&!p.panels[i].fields.some(f=>f.id===id))))fail();}
  if(!unique(g.solved)||g.solved.some(id=>!M.puzzles[id]||!g.seenNodes.includes(id)||!M.gradePuzzle(M.puzzles[id],g.puzzleWork[id]??{})))fail();
  for(const[id,f]of Object.entries(g.facts))if(!M.factDefinitions[id]||!object(f)||!g.solved.includes(f.via)||!M.puzzles[f.via].facts.includes(id)||!unique(f.sources)||f.sources.some(id=>!g.documents[id])||JSON.stringify(f.sources)!==JSON.stringify(M.puzzleSources(g,M.puzzles[f.via])))fail();
  for(const id of g.solved)if(M.puzzles[id].facts.some(id=>!g.facts[id]))fail();
  if(!unique(g.completed)||g.completed.some(id=>!['winter','learn-document','learn-records','learn-recap'].includes(id)))fail();
  if(g.life.length>5||g.life.some((x,i)=>!['office','letters'].includes(x)||g.answers['life-'+i]!==x))fail();
  for(const[id,a]of Object.entries(g.answers)){const n=M.sceneById[id];if(!n?.options?.some(o=>o.value===a)||!g.seenNodes.includes(id))fail();}
  for(const[id,h]of Object.entries(g.hints))if(!M.puzzles[id]||!g.seenNodes.includes(id)||!ints(h,0,3))fail();
  if(g.explorationFocus!==null&&(!M.explorationVisits[g.explorationFocus]||g.node!=='autumn-explore'||!g.explored.includes(g.explorationFocus)))fail();
  const n=M.currentNode(g),len=M.sceneBeats(g).length;if(len&&g.beat>=len)fail();
  if(g.phase==='result'&&(n.type!=='puzzle'||!g.feedback||!['correct','limited'].includes(g.feedback.kind)||g.feedback.kind==='correct'&&!g.solved.includes(n.puzzle)))fail();
  if(g.trial.length>3||g.trial.some((r,i)=>r.round!==['old','delivery','responsibility'][i]||typeof r.supported!=='boolean'||!unique(r.evidence)||r.evidence.some(id=>!g.documents[id])||r.supported!==g.solved.includes(['trial-old','trial-delivery','trial-duty'][i])))fail();
  if(g.phase==='ending'){
   if(!['complete','partial','dismissed','settlement'].includes(g.verdict)||g.life.length!==5)fail();
   if(g.verdict==='settlement'){if(!g.choices.trade||g.answers.settlement!=='trade')fail();}
   else{const supported=g.trial.filter(r=>r.supported).length;if(g.trial.length!==3||g.verdict!==(supported===3?'complete':supported?'partial':'dismissed'))fail();}
  }else if(g.verdict!==null)fail();
  if(!['x','y','zoom'].every(k=>Number.isFinite(g.map[k]))||g.map.zoom<1||g.map.zoom>3||Math.abs(g.map.x)>1500||Math.abs(g.map.y)>1500||!g.knownPlaces.includes(g.map.selected))fail();
  for(const k of ['people','terms','knownPlaces','visitedPlaces','explored'])if(!unique(g[k]))fail();
  if(g.people.some(p=>!M.people[p])||g.terms.some(t=>!M.terms[t])||g.knownPlaces.some(p=>!M.places[p])||g.visitedPlaces.some(p=>!g.knownPlaces.includes(p)))fail();
  if(g.notes.length>120||!ints(g.nextNote,1,10000)||new Set(g.notes.map(n=>n.id)).size!==g.notes.length||g.notes.some(n=>!ints(n.id,1,g.nextNote-1)||typeof n.text!=='string'||n.text.length>2000||n.document!==null&&!g.documents[n.document]))fail();
  if(g.history.length>1000||g.history.some(h=>!object(h)||!ints(h.chapter,0,4)||['date','title','text'].some(k=>typeof h[k]!=='string'||h[k].length>10000)))fail();
  for(const[id,c]of Object.entries(g.read)){const base=M.sceneById[id],v=id.startsWith('visit-')?M.explorationVisits[id.slice(6)]:null;if(!base&&!v||!ints(c,1,30)||base&&!g.seenNodes.includes(id)||v&&!g.explored.includes(id.slice(6)))fail();}
  return g;
 }
 function readSave(){try{const raw=localStorage.getItem(KEY);return {saved:raw?parseState(JSON.parse(raw)):null,error:''};}catch{return {saved:null,error:'当前进度无法继续，可以重新开始游戏。'};}}
 function writeSave(g){try{parseState(g);const raw=JSON.stringify(g);localStorage.setItem(KEY,raw);if(localStorage.getItem(KEY)!==raw)throw Error();return '';}catch{return '本次进度未能保存，请保留当前页面；关闭后可能丢失。';}}
 Object.assign(M,{KEY,parseState,parseSave:raw=>parseState(JSON.parse(raw)),readSave,writeSave});
})();
