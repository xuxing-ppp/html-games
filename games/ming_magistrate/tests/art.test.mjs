import test from'node:test';import assert from'node:assert/strict';import{readFileSync,readdirSync}from'node:fs';import{createHash}from'node:crypto';import{M,campaign}from'./support/game.mjs';import'../js/ui/art-data.js';
test('all actual scene and ending paintings exist, with portrait opening and Hai variants',()=>{for(const n of M.sceneNodes){assert(M.artCatalog[n.art],n.id);for(const b of n.beats)if(b.art)assert(M.artCatalog[b.art],n.id+' beat');}for(const v of Object.values(M.explorationVisits))assert(M.artCatalog[v.art]);for(const options of [{},{route:'letters'},{trade:true},{fail:['trial-old','trial-delivery','trial-duty']}])for(const a of M.endingStory(campaign(options).game).acts)assert(M.artCatalog[a.art]);for(const key of ['opening','hai'])assert(M.artCatalog[key].portrait);for(const art of Object.values(M.artCatalog))for(const file of [art.file,art.portrait].filter(Boolean)){assert(readFileSync(new URL('../assets/runtime/'+file+'.webp',import.meta.url)).length);}});
test('manifest checksums match all retained runtime images',()=>{const manifest=JSON.parse(readFileSync(new URL('../docs/asset-manifest.json',import.meta.url),'utf8')),hash=d=>createHash('sha256').update(d).digest('hex');assert.deepEqual(readdirSync(new URL('../assets/runtime',import.meta.url)).filter(x=>x.endsWith('.webp')).sort(),manifest.images.map(x=>x.file+'.webp').sort());for(const row of manifest.images){assert.equal(hash(readFileSync(new URL('../assets/runtime/'+row.file+'.webp',import.meta.url))),row.runtime_sha256);}assert(manifest.runtime_bytes<manifest.original_bytes*.2);});

test('each known person has an explicit distinctive portrait with matching identity cues',async()=>{
 await import('../js/ui/portrait.js');
 const profiles=M.portraitProfiles;assert.deepEqual(Object.keys(profiles).sort(),Object.keys(M.people).sort());
 const shapes=Object.values(profiles).map(({robe,skin,pose,...identity})=>JSON.stringify(identity));
 assert.equal(new Set(shapes).size,22,'do not distinguish people by color alone');
 for(const id of ['lin','widow','family','tenant'])assert(profiles[id].woman,id);
 for(const id of ['north','south','boat','clerk'])assert(!profiles[id].woman,id);
 assert.equal(profiles.north.hat,'wrap');assert.equal(profiles.south.hat,'lowcap');assert.equal(profiles.tenant.hat,'tiedbun');
 assert.equal(profiles.gu.hat,'official');assert.equal(profiles.xu.hat,'soft');
 const g=campaign().game;assert.equal(M.personBiography('you',g,{endingActRead:3}).portraitAge,'older');assert.equal(M.personBiography('you',g,{endingActRead:1}).portraitAge,'current');
});
test('scene images follow the actual cast, place and event rather than recycling a different petitioner',()=>{
 const expected={'qiuniang':'opening','names-intro':'north-hearing','north-visit':'north-repair','south-visit':'south-doorway','names-close':'north-repair','lu-dock':'estate-dock','relief-intro':'lin-hearing','relief-visit':'relief-doorway','relief-close':'relief-doorway','confession-intro':'clerk-account','autumn-close':'clerk-account','settlement':'letter','trial-intro':'review-hearing'};
 for(const [id,art] of Object.entries(expected)){assert.equal(M.sceneById[id].art,art,id);assert.equal(M.sceneNodes.find(n=>n.id===id).art,art,id+' index');}
 assert.equal(M.sceneById['names-close'].place,'北渡');assert(M.artCatalog['north-hearing'].portrait);
 for(const art of Object.values(M.artCatalog))for(const id of art.cast??[])assert(M.people[id]);
 const story=M.endingStory(campaign().game);assert.equal(story.acts[1].art,'enforcement-grain');assert(!M.artCatalog[story.acts[1].art].cast.includes('xu'));
 assert.equal(M.explorationVisits.courier.art,'letter');assert.equal(M.explorationVisits.scribe.art,'letter');
});

// Original artwork is a local maintenance input, intentionally absent from fresh clones.
test('optional source artwork audit', {skip:process.env.CHECK_SOURCE_ASSETS!=='1'},()=>{
 const manifest=JSON.parse(readFileSync(new URL('../docs/asset-manifest.json',import.meta.url),'utf8'));
 for(const row of manifest.images){
  const data=readFileSync(new URL('../assets/originals/'+row.file+'.png',import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'),row.original_sha256);
  assert(data.readUInt32BE(16)>=900);assert(data.readUInt32BE(20)>=900);
 }
});

test('corridor art follows Lin only and remains separate from the hearing',()=>{const a=M.artCatalog['review-corridor'];assert.deepEqual(a.cast,['lin']);assert.equal(a.setting,'复审堂外廊');const corridor=M.sceneById['trial-intro'].beats.filter(b=>b.art==='review-corridor');assert.deepEqual(corridor.map(b=>b.speaker),['narrator','lin']);assert.equal(M.sceneById['trial-intro'].beats[0].art,'review-corridor');});

test('every retained painting is reachable in the current story, endings, atlas or paper surfaces',()=>{
 const keys=new Set(['county','desk']);
 for(const n of M.sceneNodes){keys.add(n.art);for(const b of n.beats)if(b.art)keys.add(b.art);}
 for(const v of Object.values(M.explorationVisits))keys.add(v.art);
 const rounds=['trial-old','trial-delivery','trial-duty'];
 for(const route of ['office','letters'])for(let mask=0;mask<8;mask++){
  const g=campaign({route,fail:rounds.filter((id,i)=>mask>>i&1)}).game;
  for(const act of M.endingStory(g).acts)keys.add(act.art);
 }
 for(const act of M.endingStory(campaign({trade:true}).game).acts)keys.add(act.art);
 assert.deepEqual([...keys].sort(),Object.keys(M.artCatalog).sort(),'remove unused art aliases instead of retaining obsolete scenes');
 const images=new Set(['county-atlas','xuan-paper']);
 for(const key of keys){const art=M.artCatalog[key];images.add(art.file);if(art.portrait)images.add(art.portrait);}
 const manifest=JSON.parse(readFileSync(new URL('../docs/asset-manifest.json',import.meta.url),'utf8'));
 assert.deepEqual([...images].sort(),manifest.images.map(r=>r.file).sort(),'retained runtime and source image pairs must serve the current game');
});
