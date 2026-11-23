(function(root,factory){ const api=factory(); if(typeof module==='object') module.exports=api; root.ArenaModel=api; })(globalThis,function(){
'use strict';
const MODES={duel:'单挑',team:'团战',wheel:'车轮战',brawl:'自由混战',boss:'Boss 挑战'};
const TYPE_NAMES={normal:'普通',zako:'杂鱼',elite:'精英',outOfSpec:'规格外',boss:'Boss'};
const ORIGINAL_IDS=['arenaSpring','arenaPainter','arenaCourier','arenaBoomerang','arenaBubble','arenaBattery',...(globalThis.ArenaRosterExpansion||[]).map(role=>role.id)];
const TIME_LIMITS=Object.freeze({duel:240,team:360,wheel:600,brawl:480,boss:480});
const MAP_PRESETS=Object.freeze({small:.8,medium:1,large:1.4,extraLarge:2,huge:4});
const MAP_LIMITS=Object.freeze({minSide:100,maxSide:900,minRatio:.5,maxRatio:2});
function timeLimit(state){return TIME_LIMITS[state?.mode]||TIME_LIMITS.duel;}
const clone=value=>JSON.parse(JSON.stringify(value));
function mapSettings(map){
 const {minSide,maxSide,minRatio,maxRatio}=MAP_LIMITS;
 const validSide=n=>Number.isInteger(n)&&n>=minSide&&n<=maxSide;
 return {
  preset:map?.preset==='custom'||Object.hasOwn(MAP_PRESETS,map?.preset)?map.preset:'medium',
  ratio:Number.isFinite(map?.ratio)&&map.ratio>=minRatio&&map.ratio<=maxRatio?map.ratio:1,
  width:validSide(map?.width)?map.width:200,
  height:validSide(map?.height)?map.height:200
 };
}
function standardMapSide(state,api){
 if(state.mode==='boss')return api.MODE_RULES.totalwar.arenaSize;
 if(state.physics==='bounce')return api.BOUNCE_ARENA_SIZE;
 if(state.physics==='gyro')return api.GYRO_ARENA_SIZE;
 return api.MODE_RULES['1v1'].arenaSize;
}
function mapDimensions(state,api){
 const {preset,ratio,width,height}=mapSettings(state.map);
 if(preset==='custom')return {width,height};
 const side=standardMapSide(state,api)*MAP_PRESETS[preset],stretch=Math.sqrt(ratio);
 return {width:side*stretch,height:side/stretch};
}
function hasDynamicCamera(arena,mediumSide){
 return arena.width*arena.height>mediumSide*mediumSide+1e-6;
}
function cameraFrame(arena,balls,mediumSide,previous=null,dt=0){
 const {left,right,top,bottom,width,height}=arena;
 const whole={x:left,y:top,width,height};
 if(!hasDynamicCamera(arena,mediumSide))return whole;
 if(!balls.length)return previous||whole;
 const extent=(axis,start,end)=>{
  const lower=Math.min(...balls.map(ball=>ball[axis]-3*ball.radius));
  const upper=Math.max(...balls.map(ball=>ball[axis]+3*ball.radius));
  return [Math.max(start,Math.min(end,lower)),Math.max(start,Math.min(end,upper))];
 };
 const [minX,maxX]=extent('x',left,right),[minY,maxY]=extent('y',top,bottom);
 const floor=mediumSide/Math.sqrt(width*height);
 const target=Math.min(1,Math.max(floor,(maxX-minX)/width,(maxY-minY)/height));
 const blend=1-Math.exp(-8*dt),before=previous?previous.width/width:target;
 const fraction=before-target>.1/Math.max(width,height)?before+(target-before)*blend:target;
 const viewWidth=width*fraction,viewHeight=height*fraction;
 const origin=(low,high,start,end,span,last)=>{
  const desired=(low+high-span)/2;
  const next=last===undefined||Math.abs(last-desired)<.1?desired:last+(desired-last)*blend;
  return Math.max(start,high-span,Math.min(end-span,low,next));
 };
 return {x:origin(minX,maxX,left,right,viewWidth,previous?.x),
  y:origin(minY,maxY,top,bottom,viewHeight,previous?.y),width:viewWidth,height:viewHeight};
}
function defaults(){return {mode:'duel',left:['oldWoodMaster'],right:['steelCoil'],brawl:['oldWoodMaster','steelCoil'],series:1,retainDeadSkills:true,physics:'none',map:mapSettings(),teamRings:true,hazards:{pads:false,supplies:false,laser:false},seedText:'',expanded:false,soundOn:true,soundPreferenceSet:true,speed:1,favorites:[],filter:'all',tag:'all',search:''};}
function sanitize(value,registry){
 const s=Object.assign(defaults(),value&&typeof value==='object'?value:{}), ids=new Set(registry.list().map(d=>d.id));
 s.mode=Object.hasOwn(MODES,s.mode)?s.mode:'duel'; s.series=[1,3,5].includes(Number(s.series))?Number(s.series):1;
 s.retainDeadSkills=s.retainDeadSkills!==false;
 s.physics=['none','bounce','gyro'].includes(s.physics)?s.physics:'none';
 s.map=mapSettings(s.map);s.teamRings=s.teamRings!==false;
 for(const key of ['left','right','brawl']){
  const fallback=defaults()[key]; s[key]=Array.isArray(s[key])?s[key].slice(0,key==='brawl'?12:6).map(id=>id===null?null:ids.has(id)?id:null):fallback;
  if(!s[key].length)s[key]=fallback;
 }
 if(s.brawl.length<2)s.brawl.push('steelCoil');
 s.hazards=Object.fromEntries(['pads','supplies','laser'].map(k=>[k,s.hazards?.[k]===true]));
 s.favorites=Array.isArray(s.favorites)?[...new Set(s.favorites.filter(id=>ids.has(id)))]:[];
 s.expanded=s.expanded===true;// 旧版默认静音的自动保存迁移为开启；本次起显式选择的静音仍会记住。
 s.soundOn=value?.soundPreferenceSet===true&&typeof value.soundOn==='boolean'?value.soundOn:true;s.soundPreferenceSet=true;s.speed=[.5,1,2,4].includes(s.speed)?s.speed:1; s.seedText=/^\d{1,10}$/.test(String(s.seedText))&&Number(s.seedText)<=4294967295?String(s.seedText):'';
 s.search=typeof s.search==='string'?s.search.slice(0,100):'';
 s.filter=['all','normal','zako','elite','outOfSpec','boss','original','favorites'].includes(s.filter)?s.filter:'all';
 s.tag=typeof s.tag==='string'?s.tag:'all';
 return s;
}
function eligible(def,state,side){return state.mode==='boss'&&side==='left'?def.rosterType==='boss':def.rosterType!=='boss';}
function validate(state,registry){
 const teams=state.mode==='brawl'?[state.brawl]:[state.left,state.right];
 for(let t=0;t<teams.length;t++){
  const arr=teams[t], min=state.mode==='brawl'?2:1, max=state.mode==='brawl'?12:state.mode==='duel'||state.mode==='boss'&&t===0?1:6;
  if(arr.length<min||arr.length>max)return '请调整阵容人数';
  for(const id of arr){if(!id)return '还有空位，请先选择角色'; let d;try{d=registry.get(id);}catch{return '角色不存在';} if(!eligible(d,state,t===0?'left':'right'))return state.mode==='boss'&&t===0?'红方请选 Boss':'Boss 只能进入 Boss 挑战的红方';}
 }
 return '';
}
function configFor(state,api){
 const mode={duel:'1v1',team:'nvn',wheel:'wheel',brawl:'brawl',boss:'totalwar'}[state.mode];
 const options=state.mode==='boss'?{}:{bounce:state.physics==='bounce',gyro:state.physics==='gyro'};
 const {width,height}=mapDimensions(state,api),standard=standardMapSide(state,api);
 if(width!==standard||height!==standard)options.arena={shape:width===height?'square':'rectangle',width,height};
 const cfg=api.createModeBattleConfig(mode,state.mode==='brawl'?state.brawl:state.left,state.mode==='brawl'?[]:state.right,options);
 return cfg;
}
// Install per engine so series rounds and seeded replays start with fresh cleanup state.
function installWheelSkillCleanup(engine,state){
 if(state.mode!=='wheel'||state.retainDeadSkills!==false)return;
 const notify=engine.notifyNewDeaths.bind(engine);
 engine.notifyNewDeaths=function(){
  notify();
  const removed=new Set(this.game.balls.filter(b=>b.hp<=0&&b.deathNotified).map(b=>b.instanceId));
  // Follow summon ancestry, including summons of summons, without touching the next entrant.
  let changed=true;
  while(changed){changed=false;for(const b of this.game.balls)if(b.isSummon&&removed.has(b.summonerInstanceId)&&!removed.has(b.instanceId)){
   removed.add(b.instanceId);changed=true;b.hp=0;b.fade=0;b.deathNotified=true;b.diedAt=this.game.time;
   b.vx=b.vy=b.storedVx=b.storedVy=0;this.invokeHook(b,'onBattleDispose');
  }}
  for(const entity of this.entitySystem.entities.concat(this.entitySystem.pendingEntities)){
   if(removed.has(entity.ownerInstanceId)||removed.has(entity.creditInstanceId))this.entitySystem.removeEntity(entity);
  }
  for(const effect of this.visualEffectSystem.effects.concat(this.visualEffectSystem.pendingEffects)){
   if(removed.has(effect.ownerInstanceId))effect.visualActive=false;
  }
  for(const b of this.game.balls)for(const [id,effect] of b.effects){
   if(removed.has(effect.source?.instanceId))this.removeEffect(b,id);
  }
 };
}
class Series{
 constructor(length=1){this.length=[1,3,5].includes(length)?length:1;this.scores=[0,0];this.draws=0;this.round=1;this.history=[];this.complete=false;}
 record(winner){
  if(this.complete||this.history.some(r=>r.round===this.round))return false;
  winner=winner===0||winner===1?winner:null;
  if(winner===null)this.draws++;else{this.scores[winner]++;this.draws=0;}
  this.history.push({round:this.round,winner});
  this.complete=this.length===1||this.draws>=3||Math.max(...this.scores)>=Math.ceil(this.length/2);return true;
 }
 next(){if(this.complete||!this.history.some(r=>r.round===this.round))return false;this.round++;return true;}
}
return {MODES,TYPE_NAMES,ORIGINAL_IDS,TIME_LIMITS,MAP_PRESETS,MAP_LIMITS,timeLimit,mapSettings,standardMapSide,mapDimensions,hasDynamicCamera,cameraFrame,defaults,sanitize,eligible,validate,configFor,installWheelSkillCleanup,Series,clone};
});
