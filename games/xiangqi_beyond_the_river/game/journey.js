/* Twelve branching steps per chapter, rewards fixed when generated. */
(function(root){'use strict';const D=typeof module!=='undefined'&&module.exports?require('./data.js'):root.XQData;
function rand(s){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296;}
function shuffle(s,a){for(let i=a.length-1;i>0;i--){const j=Math.floor(rand(s)*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function choose(s,a){return a.length?a[Math.floor(rand(s)*a.length)]:null;}
function card(s,key,level=0){return {id:'c'+s.cardSerial++,key,level};}
function pool(s,foreign=false){return Object.keys(D.cards).filter(k=>foreign?D.cards[k].school!=='neutral'&&D.cards[k].school!==s.school:D.cards[k].school==='neutral'||D.cards[k].school===s.school);}
function relicPool(s){return Object.keys(D.relics).filter(k=>!s.relics.includes(k)&&(!D.relics[k].school||D.relics[k].school===s.school));}
function offers(s,n=3,foreign=false){if(foreign)return shuffle(s,pool(s,true)).slice(0,n);const own=shuffle(s,Object.keys(D.cards).filter(k=>D.cards[k].school===s.school)),common=shuffle(s,Object.keys(D.cards).filter(k=>D.cards[k].school==='neutral'));if(s.pathKey){const tags=D.paths[s.pathKey].tags.filter(k=>D.cards[k].school===s.school),first=choose(s,tags);return shuffle(s,[first,own.find(k=>k!==first),common[0]]);}return shuffle(s,[...own.slice(0,n-1),common[0]]);}
function position(n){return [n.mapX??(n.lane===1?280:n.lane===0?150:410),n.mapY??(600-n.row*86)];}
function connect(s,a,b){
 const add=(i,j)=>{if(!a[i].next.includes(b[j].id))a[i].next.push(b[j].id);};
 if(a.length===1){b.forEach((_,j)=>add(0,j));return;}if(b.length===1){a.forEach((_,i)=>add(i,0));return;}
 a.forEach((_,i)=>add(i,Math.round(i*(b.length-1)/(a.length-1))));
 b.forEach((n,j)=>{if(!a.some(q=>q.next.includes(n.id)))add(Math.round(j*(a.length-1)/(b.length-1)),j);});
 // Keep the reachable backbone; add only a few optional forks.
 const candidates=shuffle(s,a.flatMap((_,i)=>b.map((_,j)=>[i,j])));
 for(const [i,j] of candidates){if(a[i].next.includes(b[j].id)||a[i].next.length>=2||rand(s)>.20)continue;
  const crossing=a.some((n,k)=>n.next.some(id=>{const l=b.findIndex(q=>q.id===id);return (i-k)*(j-l)<0;}));
  if(!crossing)add(i,j);
 }
}
function map(s,chapter){const def=D.chapters[chapter-1],nodes=[],rows=[],elites=shuffle(s,[...def.favored,...Object.keys(D.fusions).filter(k=>!def.favored.includes(k))]),layouts=shuffle(s,[...def.layouts]);let eliteIndex=0;
 const schedule=[['battle'],['battle','event','battle','event','battle'],['elite','shop','battle','event','elite'],['camp','event','shop','event','event'],['battle','mission','event','battle','mission'],['elite','battle','mission','battle','elite'],['cache','event','shop','cache','event'],['battle','mission','event','battle','mission'],['camp','event','battle','event','camp'],['elite','shop','battle','event','elite'],['camp','cache','event','shop','event'],['boss']];
 for(let row=0;row<12;row++){
  const edge=row===0||row===11,lanes=edge?[1]:[0,...shuffle(s,[1,2,3]).slice(0,rand(s)<.3?3:2),4].sort((a,b)=>a-b),kinds=edge?schedule[row]:shuffle(s,schedule[row].slice(0,lanes.length));
  // The rightmost route can always bypass camps; every camp remains reachable.
  if(kinds.at(-1)==='camp'){const i=kinds.findIndex(k=>k!=='camp');[kinds[i],kinds[kinds.length-1]]=[kinds.at(-1),kinds[i]];}
  rows[row]=lanes.map((lane,i)=>({id:`${chapter}-${row}-${lane}`,chapter,row,lane,type:kinds[i],river:choose(s,[2,3,4]),bridges:shuffle(s,[1,2,3,4,5]).slice(0,choose(s,[1,2])),layout:layouts[row%layouts.length],formation:choose(s,D.formations).key,fusion:kinds[i]==='elite'?elites[eliteIndex++%elites.length]:null,mutation:choose(s,Object.keys(D.mutations)),objective:kinds[i]==='mission'?choose(s,Object.keys(D.objectives)):null,event:choose(s,def.events),seed:(rand(s)*4294967295)>>>0,visited:false,next:[],mapX:edge?280:82+lane*99+(rand(s)-.5)*56,mapY:1340-row*112+(edge?0:(rand(s)-.5)*48)}));nodes.push(...rows[row]);
 }
 for(let row=0;row<11;row++)connect(s,rows[row],rows[row+1]);return nodes;}
function lastRow(s,chapter=s.chapter){return Math.max(...s.maps[chapter-1].map(n=>n.row));}
function total(s){return s.maps.reduce((n,m)=>n+Math.max(...m.map(q=>q.row))+1,0);}
function isBoss(s){return s.row===lastRow(s);}
function newAdventure(s){s.routeVersion=2;s.maps=D.chapters.map(c=>map(s,c.id));const dry=choose(s,s.maps.flat().filter(n=>n.type==='battle'&&n.row>0));if(dry){dry.river=null;dry.bridges=[];}s.chapter=1;s.row=-1;s.lane=1;s.nodeId=null;s.gold=60;s.removeCost=50;s.completed=0;s.path=[];s.override=null;s.quest=null;s.provisions={boat:0,shield:0};}
function links(a,b){return a.chapter===b.chapter&&b.row===a.row+1&&(!Array.isArray(a.next)||a.next.includes(b.id));}
function available(s){if(s.phase!=='map')return [];const map=s.maps[s.chapter-1],from=map.find(n=>n.id===s.nodeId);return map.filter(n=>n.row===s.row+1&&(s.row<0||from&&links(from,n)));}
function node(s){return s.maps.flat().find(n=>n.id===s.nodeId);}
function finish(s){if(s.routeVersion===2&&!s.pathKey&&s.chapter===1&&s.row>=2){s.phase='insight';s.insight={draft:null};return;}s.completed++;if(isBoss(s)){if(s.chapter===3){s.phase='victory';return;}const amount=Math.min(Math.ceil(s.hero.maxHp*.25),s.hero.maxHp-s.hero.hp);s.hero.hp+=amount;s.events=[{type:'heal',unit:'hero',amount}];s.chapter++;s.row=-1;s.lane=1;}s.phase='map';}
function reward(s){const n=node(s)||{type:'battle'},amount=n.type==='boss'?80:n.type==='elite'?45+Math.floor(rand(s)*16):20+Math.floor(rand(s)*11);s.gold+=amount;const relics=n.type==='elite'||n.type==='boss'?shuffle(s,relicPool(s)).slice(0,3):[];s.reward={gold:amount,cards:offers(s),cardDone:false,relics,relicDone:!relics.length};}
function shop(s){s.shop={cards:offers(s).map(k=>({key:k,price:D.cards[k].op==='power'||D.cards[k].cost>=2?75:45,sold:false})),borrow:{key:choose(s,pool(s,true)),price:75,sold:false},relic:choose(s,relicPool(s)),relicSold:false,removed:false,medicineBought:false};}
function event(s){s.event={name:node(s).event,resolved:false,offers:offers(s),foreign:offers(s,3,true),relic:choose(s,relicPool(s)),roll:rand(s),message:'',pending:null,remaining:0};}
const api={rand,shuffle,choose,card,pool,relicPool,newAdventure,position,lastRow,total,isBoss,links,available,node,finish,reward,offers,shop,event};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.XQJourney=api;})(typeof globalThis!=='undefined'?globalThis:this);
