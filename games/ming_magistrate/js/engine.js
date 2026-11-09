/* Deterministic scene and puzzle rules. No clock, budget, text grading or old-save branch. */
(() => {
 'use strict';const M=globalThis.Ming,copy=x=>structuredClone(x);
 const own=(g,id)=>Object.hasOwn(g.documents,id);
 const current=g=>M.sceneById[g.node];
 const visit=g=>g.explorationFocus?M.explorationVisits[g.explorationFocus]:null;
 function node(g){const v=visit(g);return v?{...v,id:`visit-${g.explorationFocus}`,type:'visit',chapter:3,date:'九月',goal:'听完原话，再回舆图选择下一步'}:current(g);}
 function beats(g){const n=node(g),reply=n.options?.find(o=>o.value===g.answers[n.id])?.reply??[];return [...(n.beats??[]),...reply.map(b=>({speaker:b[0],text:b[1]}))].map(b=>({...b,text:b.variable==='receipt'?M.receiptReplies[g.choices.receipt]:b.choiceEcho?M.sideConsequences[b.choiceEcho][g.choices[b.choiceEcho]]:b.text}));}
 function record(g){const n=node(g),b=beats(g)[g.beat];if(!b)return;g.read[n.id]=Math.max(g.read[n.id]??0,g.beat+1);if(b.speaker&&b.speaker!=='narrator'&&!g.people.includes(b.speaker))g.people.push(b.speaker);}
 function grant(g,ids=[],via){for(const id of ids)if(!own(g,id))g.documents[id]={chapter:g.chapter,via,acquired:node(g).date};}
 function enter(g,id){
  const n=M.sceneById[id];if(!n)return false;g.node=id;g.chapter=n.chapter;g.beat=0;g.phase='node';g.feedback=null;g.explorationFocus=null;
  if(!g.seenNodes.includes(id))g.seenNodes.push(id);grant(g,n.grant,n.title);
  for(const place of n.places??[])if(!g.knownPlaces.includes(place))g.knownPlaces.push(place);
  for(const place of n.visitPlaces??[])if(!g.visitedPlaces.includes(place))g.visitedPlaces.push(place);
  for(const p of n.people??[])if(!g.people.includes(p))g.people.push(p);
  for(const t of n.terms??[])if(!g.terms.includes(t))g.terms.push(t);
  for(const c of n.completed??[])if(!g.completed.includes(c))g.completed.push(c);
  if(n.target&&!g.knownPlaces.includes(n.target))g.knownPlaces.push(n.target);
  if(n.type==='explore')for(const p of Object.keys(M.explorationVisits))if(!g.knownPlaces.includes(p))g.knownPlaces.push(p);
  record(g);return true;
 }
 function initial(){const g={version:3,contentRevision:'mystery-expanded.2',ruleset:'scene-mystery',node:'arrival',chapter:0,phase:'node',beat:0,documents:{},facts:{},puzzleWork:{},solved:[],hints:{},answers:{},choices:{},life:[],trial:[],outcomes:[],completed:[],history:[],read:{},seenNodes:[],people:['you','shen'],terms:[],knownPlaces:['county','yamen','warehouse'],visitedPlaces:[],explored:[],explorationFocus:null,map:{zoom:1,x:0,y:0,selected:'county'},notes:[],nextNote:1,feedback:null,verdict:null};enter(g,'arrival');return g;}
 function sources(g,p){const ids=p.sources.filter(id=>own(g,id));if(p.id==='document-order'&&!own(g,'courier_register'))for(const id of ['scribe_statement','clerk_alibi'])if(own(g,id))ids.push(id);return [...new Set(ids)];}
 function work(g,p){return g.puzzleWork[p.id]??(p.kind==='order'?{order:p.items.map(i=>i.id)}:p.kind==='match'?{placements:{}}:{pair:[null,null]});}
 function grade(p,w){if(p.kind==='order')return Array.isArray(w.order)&&p.answer.length===w.order.length&&p.answer.every((x,i)=>x===w.order[i]);if(p.kind==='compare')return Array.isArray(w.pair)&&p.answer.every((x,i)=>x===w.pair[i]);return p.items.every(i=>w.placements?.[i.id]===p.answer[i.id]);}
 function exploreReady(g){return M.puzzles['document-order'].requiresAny.some(b=>b.every(id=>own(g,id)));}
 function log(g,title,text){g.history.push({chapter:g.chapter,date:node(g).date,title,text});}
 function end(g,type){g.verdict=type;g.phase='ending';g.feedback=null;log(g,'复审裁定',type==='complete'?'三轮事实相接，撤销相关指控，分别审办追缴。':type==='partial'?'按已证范围部分昭雪，未证责任留缺。':type==='settlement'?'接受限定责任的退补契，补粮赔偿与调任按契执行。':'三轮均未完整证明，交印离任，材料留待后查。');}
 function advance(g){const n=current(g);
  if(n.caseClose!==undefined&&!g.outcomes.some(o=>o.chapter===n.caseClose)){g.outcomes.push({chapter:n.caseClose,level:'full'});log(g,n.title,'已按原据办理，更正、收领和补给分别落实。');}
  if(n.index===M.sceneNodes.length-1){end(g,g.trial.every(r=>r.supported)?'complete':g.trial.some(r=>r.supported)?'partial':'dismissed');return;}
  enter(g,M.sceneNodes[n.index+1].id);
 }
 function saveWork(g,p){g.puzzleWork[p.id]??=copy(work(g,p));return g.puzzleWork[p.id];}
 function trialRecord(g,p,supported){g.trial.push({round:['old','delivery','responsibility'][p.trialRound],supported,evidence:supported?sources(g,p):[]});}
 function reduce(g,a){
  if(!g||typeof a?.type!=='string'||g.phase==='ending')return g;
  const n=node(g),p=n.type==='puzzle'?M.puzzles[n.puzzle]:null;
  if(a.type==='previousBeat'&&['scene','choice','visit'].includes(n.type)&&g.beat>0&&g.phase==='node'){const h=copy(g);h.beat--;return h;}
  if(a.type==='advance'){
   const h=copy(g);
   if(g.phase==='result'){advance(h);return h;}
   if(n.type==='map'){if(!h.visitedPlaces.includes(n.target))h.visitedPlaces.push(n.target);advance(h);return h;}
   if(!['scene','choice','visit'].includes(n.type))return g;
   if(g.beat<beats(g).length-1){h.beat++;record(h);return h;}
   if(n.type==='choice'&&g.answers[n.id]===undefined)return g;
   if(n.type==='visit'){h.explorationFocus=null;h.beat=0;h.feedback=null;return h;}
   advance(h);return h;
  }
  if(a.type==='choose'&&n.type==='choice'&&g.phase==='node'&&g.beat===n.beats.length-1&&g.answers[n.id]===undefined){
   const o=n.options.find(o=>o.value===a.value);if(!o)return g;if(n.id==='settlement'&&o.value==='trade'&&!a.confirmed)return g;
   const h=copy(g);h.answers[n.id]=o.value;h.choices[n.key]=o.value;grant(h,o.grant,`${n.title}：${o.label}`);
   if(n.life!==undefined){if(h.life.length!==n.life)return g;h.life.push(o.value);}
   log(h,n.title,o.label);
   if(n.id==='settlement'&&o.value==='trade'){h.choices.trade=true;end(h,'settlement');return h;}
   if(o.reply.length){h.beat=n.beats.length;record(h);}else advance(h);return h;
  }
  if(a.type==='visit'&&n.type==='explore'&&!g.explorationFocus&&Object.hasOwn(M.explorationVisits,a.place)){
   const h=copy(g),v=M.explorationVisits[a.place];h.explorationFocus=a.place;h.beat=0;h.map.selected=a.place;h.feedback=null;
   if(!h.explored.includes(a.place))h.explored.push(a.place);if(!h.visitedPlaces.includes(a.place))h.visitedPlaces.push(a.place);
   grant(h,v.grant,v.title);for(const p of v.people)if(!h.people.includes(p))h.people.push(p);record(h);return h;
  }
  if(a.type==='finishExplore'&&n.type==='explore'&&!g.explorationFocus){if(!exploreReady(g))return g;const h=copy(g);advance(h);return h;}
  if(a.type==='mapView'){const v=a.viewport;if(!v||!['x','y','zoom'].every(k=>Number.isFinite(v[k]))||v.zoom<1||v.zoom>3||Math.abs(v.x)>1500||Math.abs(v.y)>1500)return g;const h=copy(g);h.map={...h.map,...v};return h;}
  if(a.type==='mapSelect'&&g.knownPlaces.includes(a.place)){const h=copy(g);h.map.selected=a.place;return h;}
  if(a.type==='note'&&g.chapter>=3&&typeof a.text==='string'&&a.text.trim()&&a.text.length<=2000&&g.notes.length<120){const h=copy(g);h.notes.push({id:h.nextNote++,text:a.text,document:a.document&&own(g,a.document)?a.document:null});return h;}
  if(a.type==='editNote'&&g.chapter>=3&&typeof a.text==='string'&&a.text.length<=2000){const h=copy(g),x=h.notes.find(x=>x.id===a.id);if(!x)return g;x.text=a.text;return h;}
  if(a.type==='removeNote'&&g.chapter>=3){if(!g.notes.some(x=>x.id===a.id))return g;const h=copy(g);h.notes=h.notes.filter(x=>x.id!==a.id);return h;}
  if(!p||g.phase!=='node')return g;
  if(a.type==='hint'){const h=copy(g);h.hints[p.id]=Math.min(3,(h.hints[p.id]??0)+1);return h;}
  if(a.type==='place'&&p.kind==='match'&&p.items.some(i=>i.id===a.item)&&p.targets.some(t=>t.id===a.target)){const h=copy(g);saveWork(h,p).placements[a.item]=a.target;h.feedback=null;return h;}
  if(a.type==='pair'&&p.kind==='compare'&&[0,1].includes(a.side)&&p.panels[a.side].fields.some(f=>f.id===a.field)){const h=copy(g);saveWork(h,p).pair[a.side]=a.field;h.feedback=null;return h;}
  if(a.type==='order'&&p.kind==='order'&&Array.isArray(a.order)&&a.order.length===p.items.length&&new Set(a.order).size===p.items.length&&a.order.every(id=>p.items.some(i=>i.id===id))){const h=copy(g);saveWork(h,p).order=[...a.order];h.feedback=null;return h;}
  if(a.type==='submitPuzzle'){
   const h=copy(g),w=saveWork(h,p),valid=grade(p,w);
   if(!valid){h.feedback={kind:'wrong',text:p.wrong};return h;}
   if(!h.solved.includes(p.id))h.solved.push(p.id);
   for(const f of p.facts)h.facts[f]={sources:sources(h,p),via:p.id};
   if(p.trialRound!==undefined)trialRecord(h,p,true);
   log(h,p.title,p.factText);h.phase='result';h.feedback={kind:'correct',text:p.trialRound===2&&h.trial.some(r=>!r.supported)?'本轮各人的行为与责任得到核明。前两轮已经留下的证明缺口仍然保留，主审将分别说明哪些指控撤销、哪些事项继续补办，不把本轮采信当成全案完整翻案。':p.success,...(p.resultReaction?{reaction:copy(p.resultReaction)}:{})};for(const speaker of [p.resultSpeaker,p.resultReaction?.speaker])if(speaker&&speaker!=='narrator'&&!h.people.includes(speaker))h.people.push(speaker);return h;
  }
  if(a.type==='limitRound'&&p.trialRound!==undefined&&a.confirmed){const h=copy(g);trialRecord(h,p,false);log(h,p.title,'主动结束本轮补证，按现有范围裁定。');h.phase='result';h.feedback={kind:'limited',text:'本轮未形成完整证明，主审只采能核实的部分。你已明确选择结束本轮补证；后续轮次仍可分别说明。'};return h;}
  return g;
 }
 Object.assign(M,{initial,reduce,currentNode:node,sceneBeats:beats,puzzleWork:work,gradePuzzle:grade,puzzleSources:sources,exploreReady,lifeRoute:g=>g.life.filter(x=>x==='office').length>=3?'office':'letters',caseDate:g=>node(g).date});
})();
