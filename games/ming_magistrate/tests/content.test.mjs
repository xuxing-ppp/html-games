import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{M,campaign,act}from'./support/game.mjs';
test('all scenes have coherent dialogue, explicit dates, stable places and referenced materials',()=>{assert.equal(new Set(M.sceneNodes.map(n=>n.id)).size,M.sceneNodes.length);for(const n of M.sceneNodes){assert(n.date&&n.title);for(const id of n.grant??[])assert(M.mysteryDocuments[id],id);if(n.type==='scene'||n.type==='choice'){assert(n.beats.length);for(const b of n.beats){assert(b.variable==='receipt'||typeof b.text==='string'&&b.text.trim().length>0);assert(b.speaker==='narrator'||M.people[b.speaker],b.speaker);}}if(n.target)assert(M.places[n.target]);if(n.puzzle)assert(M.puzzles[n.puzzle]);}});
test('every puzzle has complete originals, three useful hints, distractors and a concrete payoff',()=>{for(const p of Object.values(M.puzzles)){assert.equal(p.hints.length,3);assert(p.wrong.length>20);assert(p.success.length>30);assert(p.factText.length>15);assert(p.sources.every(id=>M.mysteryDocuments[id]));if(p.kind==='order')assert.deepEqual([...p.answer].sort(),p.items.map(i=>i.id).sort());if(p.kind==='compare')assert(p.answer.every((x,i)=>p.panels[i].fields.some(f=>f.id===x)));}});
test('opening explains identity and vocabulary, without a glossary exam or premature solution',()=>{const text=M.sceneNodes.filter(n=>['arrival','yamen','qiuniang'].includes(n.id)).flatMap(n=>n.beats.map(b=>b.text)).join('');for(const word of ['县令','沈砚','浙江','嘉靖四十年','粮税','官粮','收据'])assert(text.includes(word));assert(!text.includes('双重销账'));for(const term of ['里长','官粮','收据','仓书','知府'])assert(M.terms[term]);});
test('core historical clues precede revelation and event versus document dates remain distinct',()=>{const g=campaign({until:'relief-intro'}).game;for(const id of ['dispatch_stub','refund_sheet','cargo_marks'])assert(g.documents[id]);assert.match(M.mysteryDocuments.refund_sheet.written,/初七/);assert.match(M.mysteryDocuments.refund_sheet.eventDate,/初九/);assert(M.mysteryDocuments.confession.text.join('').includes('初九'));assert(M.mysteryDocuments.draft_sheet.text.join('').includes('初七'));});
test('fictional notices stay out of normal story, dialogue and endings',()=>{const text=M.sceneNodes.flatMap(n=>[...n.beats.map(b=>b.text??''),...(n.options??[]).flatMap(o=>o.reply.map(b=>b[1]))]).join('');assert(!/这是虚构|虚构人物|虚构剧情|游戏化简化/.test(text));const ui=readFileSync(new URL('../js/ui/library.js',import.meta.url),'utf8');assert(ui.includes("page.type==='creation'"));assert(ui.includes('创作说明'));});
test('full historical library survives with local topics and source references',()=>{assert.equal(Object.keys(M.sources).length,24);assert.equal(M.sourceTopics.length,6);assert.equal(M.bibliography.length,8);for(const t of M.sourceTopics)for(const id of t.notes)assert(M.sources[id]);for(const s of Object.values(M.sources))for(const r of s.references)assert(M.bibliography.some(b=>b.id===r.book));});
test('runtime imports exactly the current offline campaign',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');assert(!/https?:\/\/|type="module"|linked-engine|linked-storage|data\/linked|data\/story|ui\/board|ui\/dialogs/.test(html));for(const x of html.matchAll(/(?:src|href)="\.\/(.*?)"/g))assert(readFileSync(new URL('../'+x[1],import.meta.url)).length);const app=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');assert(!/legacy|preserveBefore|\.records/.test(app));});
const biography=(id,g,endingActRead=-1)=>M.personBiography(id,g,{endingActRead}).paragraphs.join('');
test('all 22 biographies grow from encounters, without changing game state',()=>{
 const initial=M.initial(),g=campaign({exploreOrder:['scribe','courier','markets']}).game,before=JSON.stringify(g);
 assert.equal(Object.keys(M.people).length,22);
 for(const id of Object.keys(M.people)){const p=M.personBiography(id,g,{endingActRead:4});assert(p.paragraphs.length>=2&&p.paragraphs.length<=3,id);assert(biography(id,g,4).length>biography(id,initial).length,id);}
 assert.equal(JSON.stringify(g),before);assert.equal(M.personBiography('missing',g),null);
});
test('unread dialogue and acquired paper bundles cannot unlock later biography events',()=>{
 let g=campaign({until:'restitution'}).game;assert(g.documents.cargo_marks);assert(!biography('coroner',g).includes('三月初九'));g=act(g,{type:'advance'});assert(biography('coroner',g).includes('三月初九'));
 g=campaign({until:'confession-intro'}).game;assert(g.documents.confession);assert(!biography('clerk',g).includes('牵挂母亲'));g=act(g,{type:'advance'});assert(biography('clerk',g).includes('牵挂母亲'));assert(!biography('xu',g).includes('设单转售的责任有了'));
 const end=campaign().game;assert(biography('xu',end).includes('设单转售的责任有了'));
});
test('rereading never rewinds biographies, and actual signing choices remain distinct',()=>{
 for(const receipt of ['restricted','normal','refused']){let g=campaign({until:'boats-close',receipt}).game;g=act(g,{type:'advance'});const before=biography('xu',g);g=act(g,{type:'previousBeat'});assert.equal(biography('xu',g),before);const self=biography('you',g);assert(self.includes(receipt==='restricted'?'来源用途待核':receipt==='normal'?'按“陆庄退补”的标题':'先另仓保管'));}
});
test('ending profiles reveal sanctions and later careers only at displayed acts',()=>{
 const g=campaign().game;assert(!biography('xu',g).includes('被判徒'));assert(!biography('xu',g,0).includes('被判徒'));assert(biography('xu',g,1).includes('被判徒'));assert(!biography('gu',g,0).includes('被革职'));assert(biography('gu',g,1).includes('被革职'));
 assert(!biography('you',g,1).includes('出任巡抚'));assert(!biography('you',g,2).includes('出任巡抚'));assert(biography('you',g,3).includes('出任巡抚'));
 assert.equal(M.personBiography('you',g,{endingActRead:3}).role,'巡抚');assert.equal(M.personBiography('gu',g,{endingActRead:0}).role,'停职审办的知府');assert.equal(M.personBiography('gu',g,{endingActRead:1}).role,'革职知府');
 const letters=campaign({route:'letters'}).game;assert(!biography('you',letters,2).includes('由书坊刊行'));assert(biography('you',letters,3).includes('由书坊刊行'));
 const trade=campaign({trade:true}).game;assert(biography('xu',trade,0).includes('未获追究'));assert(!biography('xu',trade,2).includes('被判徒'));
 const partial=campaign({fail:['trial-duty']}).game;assert(!biography('gu',partial,2).includes('被革职'));
});

test('homonyms keep their real name, with residence as identity rather than a puzzle answer',()=>{
 assert.equal(M.people.north.name,'吴长生');assert.equal(M.people.south.name,'吴长生');
 assert.equal(M.people.north.role,'北渡农户');assert.equal(M.people.south.role,'南桥农户');
 assert.equal(M.people.tenant.name,'吴秋娘');assert.equal(M.people.boat.name,'船工');
 assert.notEqual(M.personCaption('north'),M.personCaption('south'));
 for(const id of ['north','south'])assert(!/田号|十九|七号|已交|欠粮|错催/.test(M.personCaption(id)));
});
test('public document dates match the later court date, while writing and delivery dates remain separate',()=>{
 assert.equal(M.mysteryDocuments.review_notice.eventDate,M.sceneById['trial-intro'].date);
 assert.equal(M.mysteryDocuments.review_notice.written,'十月廿八');
 assert.equal(M.mysteryDocuments.confession.written,'九月初六');
 assert.equal(M.sceneById['confession-intro'].date,'九月初八');
 assert(M.mysteryDocuments.confession.eventDate.includes('五月'));
});

test('expanded campaign has four optional disputes, sufficient sources before each task and short teaching',()=>{
 const sides=M.sceneNodes.filter(n=>n.sideStory);assert.equal(sides.length,4);assert(sides.every(n=>n.options.length===3&&n.options.some(o=>o.value==='skip')));
 for(const p of Object.values(M.puzzles)){
  const g=campaign({until:p.id}).game;
  for(const id of p.sources)if(id!=='courier_register')assert(g.documents[id],p.id+' '+id);
  if(p.kind==='order'&&!p.id.startsWith('tutorial'))for(const i of p.items)assert(!/初[一二三四五六七八九十]|十一月/.test(i.text),p.id);
 }
 const dialogue=M.sceneNodes.flatMap(n=>[...n.beats.map(b=>b.text??''),...(n.options??[]).flatMap(o=>o.reply.map(b=>b[1]))]).join('');assert(dialogue.length>=15500);
 assert(!M.sceneById['names-intro'].beats[0].text.includes('方才两次整理'));
 assert(M.mysteryDocuments.cargo_marks.text.join('').includes('车牌可复用'));
 assert(M.mysteryDocuments.escort_record.text.join('').includes('不能认定许家指使'));
});

test('v1.2 compresses the first case and preserves all tasks, visits and issued originals',()=>{
 assert.equal(M.sceneNodes.length,77);assert.equal(M.sceneNodes.filter(n=>n.chapter===0).length,18);assert.equal(Object.keys(M.puzzles).length,21);
 assert.equal(M.sceneNodes.filter(n=>n.chapter===0&&n.type==='puzzle'&&!n.id.startsWith('tutorial')).length,3);
 assert.equal(M.sceneById['debt-boundary'].chapter,1);assert.equal(M.sceneById['debt-boundary'].index,M.sceneById['boats-intro'].index+1);
 const g=campaign({until:'boats-intro'}).game;for(const id of ['county','north','south'])assert(g.knownPlaces.includes(id)&&g.visitedPlaces.includes(id),id);
 assert.match(M.sceneById.arrival.beats.map(b=>b.text).join(''),/旧出粮条.*回执/);
 const issued=new Set(M.sceneNodes.flatMap(n=>[...(n.grant??[]),...(n.options??[]).flatMap(o=>o.grant??[])]).concat(Object.values(M.explorationVisits).flatMap(v=>v.grant??[])));
 assert.equal(Object.keys(M.mysteryDocuments).length,64);assert.deepEqual([...issued].sort(),Object.keys(M.mysteryDocuments).sort());
});
test('review preparation presents unresolved records and each hearing gives its own objection',()=>{
 const text=M.mysteryDocuments.review_collation.text.join('');assert(!/均指.*同一次交付|实物交付只记一次/.test(text));
 for(const word of ['甲三','甲五','乙二','乙四','春丙十七','初十','东栈乙联','赈运丙回'])assert(text.includes(word));
 for(const [task,hearing,speaker]of [['trial-old','hearing-old','gu'],['trial-delivery','hearing-delivery','xu'],['trial-duty','hearing-duty','lu']]){
  assert.equal(M.sceneById[task].index,M.sceneById[hearing].index+1);assert.equal(M.puzzles[task].resultSpeaker,'censor');assert.equal(M.puzzles[task].resultReaction.speaker,speaker);
 }
 assert.match(M.puzzles['trial-delivery'].success,/同一次交付/);assert.match(M.puzzles['trial-delivery'].success,/初十只有归档/);
 for(const p of Object.values(M.puzzles)){assert(p.resultSpeaker==='narrator'||M.people[p.resultSpeaker]);assert(M.people[p.resultReaction.speaker]);assert(p.resultReaction.text.trim());}
 for(const id of ['coroner','zhou','lin'])assert(Object.values(M.puzzles).some(p=>p.resultReaction.speaker===id));
 assert.match(M.sceneById['hearing-old'].beats.map(b=>b.text).join(''),/旧供与补述并存/);
 assert.match(M.sceneById['hearing-duty'].beats.find(b=>b.speaker==='scribe').text,/字是我写的/);
});
test('private extracts and all side consequences stay independent of required proof',()=>{
 for(const [node,value,id]of [['boat-side','ledger','boat_recheck'],['relief-side','neighbours','family_letter']]){
  assert(M.sceneById[node].options.find(o=>o.value===value).grant.includes(id));
  assert(!Object.values(M.puzzles).some(p=>p.sources.includes(id)));
 }
 assert(!M.mysteryDocuments.family_letter.text.join('').includes('你上封信说水暖便回'));
 assert.match(M.mysteryDocuments.family_letter.text.join(''),/其余信文仍由本人收存/);
 for(const [id,key]of [['names-close','namesApproach'],['boats-close','boatApproach'],['relief-close','reliefApproach'],['autumn-close','autumnApproach']]){
  assert(M.sceneById[id].beats.some(b=>b.choiceEcho===key));
  for(const option of M.sceneNodes.find(n=>n.key===key).options)assert(M.sideConsequences[key][option.value],key+' '+option.value);
 }
 const raw=readFileSync(new URL('../js/data/endings.js',import.meta.url),'utf8');assert(!/has\('(?:relief_correction|winter_delivery|dyke_record)'\)|outcomes\[0\]/.test(raw));
});
