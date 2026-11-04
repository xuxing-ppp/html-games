/* 楚河行：原创《松风渡》；离线拨弦 / 箫感合成，声音不参与规则与随机状态。 */
(function(root){'use strict';
const STORAGE='xiangqi-btr-audio-v1',BPM=76,BEAT=60/BPM,BARS=32,DEFAULTS=Object.freeze({music:true,sfx:true,musicVolume:.36,sfxVolume:.62});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function preferences(input={}){const p=input&&typeof input==='object'?input:{};return {music:typeof p.music==='boolean'?p.music:DEFAULTS.music,sfx:typeof p.sfx==='boolean'?p.sfx:DEFAULTS.sfx,musicVolume:Number.isFinite(p.musicVolume)?clamp(p.musicVolume,0,1):DEFAULTS.musicVolume,sfxVolume:Number.isFinite(p.sfxVolume)?clamp(p.sfxVolume,0,1):DEFAULTS.sfxVolume};}
// Eight four-bar phrases: space between phrases is part of the composition.
const MELODY=[
 [[0,74,1.4],[2,78,.7],[3,76,1],[5,71,1.5],[8,69,.8],[9.5,71,1],[12,74,2.3]],
 [[.5,76,1.1],[2,78,.8],[4,81,1.5],[7,78,1],[8.5,76,1.5],[12,74,2.7]],
 [[0,71,2],[3,69,1],[5,66,1.5],[8,69,1],[10,71,1.5],[13,74,1.8]],
 [[1,76,1],[3,74,1],[4.5,71,1.5],[8,69,1.5],[11,66,1],[13,64,1.8]],
 [[0,66,1.4],[2.5,69,.8],[4,71,2],[8,74,1.5],[10.5,76,1],[13,78,1.7]],
 [[0,81,1.4],[2,78,.9],[4,76,1.4],[6.5,74,.9],[9,71,1.5],[12,69,2]],
 [[1,71,1.5],[4,74,2],[8,76,1],[10,78,.8],[12,76,1.8]],
 [[0,74,2],[4,71,1.4],[6,69,1.1],[9,66,1.5],[12,74,3]]
];
function scoreBar(bar){bar=((bar%BARS)+BARS)%BARS;const rootNote=[50,50,47,47,43,43,45,45][bar%8],third=rootNote===47?3:4,notes=[];
 const add=(beat,midi,kind,velocity,duration,pan=0)=>notes.push({beat,midi,kind,velocity,duration,pan});
 add(0,rootNote,'pluck',.31,3.2,-.26);add(1.5,rootNote+7,'pluck',.17,2.8,.22);add(3,rootNote+12+(bar%4===3?2:0),'pluck',.20,2.5,-.08);
 if(bar%2===0){add(.15,rootNote+third+12,'pad',.10,6,.2);add(.15,rootNote+19,'pad',.07,6,-.2);}
 for(const [offset,note,duration] of MELODY[Math.floor(bar/4)])if(Math.floor(offset/4)===bar%4)add(offset%4,note,'flute',.21,duration*BEAT+.32,.17);
 if(bar%4===3)add(2.5,rootNote+19,'pluck',.12,2,.3);
 add(0,45,'drum',.55,.65,-.12);add(2,42,'drum',.32,.65,.1);
 for(const beat of [1,2.5,3.5])add(beat,74,'wood',beat===1?.29:.18,.16,beat===1?-.28:.28);
 return notes.sort((a,b)=>a.beat-b.beat);
}
function sceneFor(screen,state){if(screen==='home'||!state)return 'home';if(state.phase==='battle')return state.boss?'boss':'battle';if(state.phase==='victory'||state.phase==='defeat')return 'quiet';return 'travel';}
function transitionCues(before,after){if(!after||before===after)return [];const cues=[];const add=k=>{if(!cues.includes(k))cues.push(k);};const changed=before?.phase!==after.phase,events=after.events||[];
 if(changed){if(after.phase==='defeat')return ['defeat'];if(after.phase==='victory')return ['victory'];if(after.phase==='reward'||after.phase==='lesson')add('reward');if(after.phase==='battle')return ['encounter'];}
 // Battle events are consumed exactly once by the UI transition, never by preview/render.
 if(before?.phase==='battle'){
  const card=events.find(e=>e.type==='card');if(card){const d=root.XQData?.cards[card.key];if(d?.op==='power')add('power');else if(['move','chase','swap'].includes(d?.op))add('light');else if(d?.school==='sword')add('slash');else if(d?.school==='palm')add('palm');else if(d?.school==='finger')add('finger');else add('card');}
  if(events.some(e=>e.type==='ultimate'))add('ultimate');
  if(events.some(e=>e.type==='enemy')){const enemy=after.enemies?.find(e=>e.id===events.find(e=>e.type==='enemy').unit)||before.enemies?.find(e=>e.id===events.find(e=>e.type==='enemy').unit);if(enemy?.intent?.actions.some(a=>a.type==='attack'))add(enemy.plan?.kind==='cannon'?'cannon':'enemy');}
  if(events.some(e=>e.type==='move')&&!cues.includes('light'))add('move');
  if(events.some(e=>e.type==='collision'))add('collision');
  if(events.some(e=>e.type==='hit'&&e.unit==='hero'&&e.amount>0))add('hurt');else if(events.some(e=>e.type==='hit'&&e.amount>0)&&!cues.includes('collision'))add('hit');
  if(events.some(e=>e.type==='cross'||e.type==='river'))add('river');
  if(events.some(e=>['break','eye-break','interrupt','dislocate'].includes(e.type)))add('break');
  if(events.some(e=>e.type==='fall'))add('fall');
  if(events.some(e=>e.type==='shield'||e.type==='hit'&&e.blocked>0))add('shield');
  if(events.some(e=>e.type==='heal'))add('heal');
  if(events.some(e=>e.type==='power'))add('power');
  if(events.some(e=>e.type==='draw')&&!cues.includes('reward'))add('draw');
  if(events.some(e=>e.type==='spawn'))add('place');
 }else if(before){
  if(after.gold<before.gold)add('coin');else if(after.deck?.length!==before.deck?.length||after.relics?.length!==before.relics?.length)add('reward');
  if(after.hero?.hp>before.hero?.hp)add('heal');
  if(!cues.length&&before.nodeId!==after.nodeId)add('place');
  if(!cues.length&&after.phase===before.phase&&after.deck?.some(c=>before.deck?.find(d=>d.id===c.id)?.level!==c.level))add('power');
 }
 return cues.slice(0,6);
}
const MIX={home:{pluck:.9,flute:.8,pad:.7,drum:0,wood:0},travel:{pluck:.9,flute:.75,pad:.65,drum:.07,wood:.2},battle:{pluck:.95,flute:.68,pad:.45,drum:.45,wood:.65},boss:{pluck:1,flute:.85,pad:.65,drum:.8,wood:.95},quiet:{pluck:.55,flute:.45,pad:.5,drum:0,wood:0}};
function random(seed){let n=seed>>>0;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
function graph(ctx){const master=ctx.createGain(),compressor=ctx.createDynamicsCompressor(),analyser=ctx.createAnalyser(),music=ctx.createGain(),sfx=ctx.createGain(),reverb=ctx.createConvolver(),wet=ctx.createGain(),musicSend=ctx.createGain(),sfxSend=ctx.createGain();
 master.gain.value=.75;compressor.threshold.value=-16;compressor.knee.value=10;compressor.ratio.value=3;compressor.attack.value=.004;compressor.release.value=.16;analyser.fftSize=1024;
 music.connect(master);sfx.connect(master);music.connect(musicSend);sfx.connect(sfxSend);musicSend.gain.value=.23;sfxSend.gain.value=.07;musicSend.connect(reverb);sfxSend.connect(reverb);reverb.connect(wet);wet.gain.value=.55;wet.connect(master);master.connect(compressor);compressor.connect(analyser);analyser.connect(ctx.destination);
 const impulse=ctx.createBuffer(2,Math.floor(ctx.sampleRate*1.65),ctx.sampleRate),r=random(319);for(let c=0;c<2;c++){const a=impulse.getChannelData(c);let low=0;for(let i=0;i<a.length;i++){low=low*.64+(r()*2-1)*.36;a[i]=low*Math.pow(1-i/a.length,2.9);}}reverb.buffer=impulse;
 const layers={};for(const k of ['pluck','flute','pad','drum','wood']){layers[k]=ctx.createGain();layers[k].connect(music);}
 return {master,music,sfx,layers,analyser};
}
function ramp(param,value,time,duration=.18){if(param.cancelAndHoldAtTime)param.cancelAndHoldAtTime(time);else{param.cancelScheduledValues(time);param.setValueAtTime(param.value,time);}param.linearRampToValueAtTime(value,time+duration);}
function synth(ctx){const buffers=new Map(),active=new Set();
 function buffer(kind,midi=60){const key=kind+':'+midi;if(buffers.has(key))return buffers.get(key);const sr=ctx.sampleRate,length=kind==='flute'?4:kind==='pad'?7:kind==='pluck'?3.5:kind==='drum'?.8:kind==='wood'?.18:1.2,b=ctx.createBuffer(1,Math.ceil(sr*length),sr),a=b.getChannelData(0),f=440*Math.pow(2,(midi-69)/12),rnd=random(midi*919+kind.length*113);
  if(kind==='pluck'){const size=Math.max(2,Math.round(sr/f)),line=new Float32Array(size);for(let i=0;i<size;i++)line[i]=(rnd()*2-1)*.34+Math.sin(i/size*Math.PI*2)*.55;let index=0;for(let i=0;i<a.length;i++){const v=line[index],next=(index+1)%size;line[index]=(v+line[next])*.4987;index=next;const t=i/sr;a[i]=(v*.85+Math.sin(2*Math.PI*f*t)*Math.exp(-t*1.8)*.15)*Math.min(1,t/.003);}}
  else if(kind==='flute'){let phase=0,breath=0;for(let i=0;i<a.length;i++){const t=i/sr;phase+=2*Math.PI*f/sr*(1+.003*Math.sin(t*2*Math.PI*4.7)*Math.min(1,t*2));breath=breath*.72+(rnd()*2-1)*.28;a[i]=(Math.sin(phase)*.65+Math.sin(phase*2)*.14+Math.sin(phase*3)*.035+breath*.055)*Math.min(1,t/.11)*Math.exp(-t*.13);}}
  else if(kind==='pad'){for(let i=0;i<a.length;i++){const t=i/sr;a[i]=(Math.sin(t*f*Math.PI*2)*.57+Math.sin(t*f*Math.PI*2*1.002)*.24+Math.sin(t*f*Math.PI*4)*.07)*Math.min(1,t/.7);}}
  else if(kind==='drum'){let phase=0;for(let i=0;i<a.length;i++){const t=i/sr;phase+=2*Math.PI*(f*.75+75*Math.exp(-t*35))/sr;a[i]=Math.sin(phase)*Math.exp(-t*10)*.8+(rnd()*2-1)*Math.exp(-t*65)*.07;}}
  else if(kind==='wood'){for(let i=0;i<a.length;i++){const t=i/sr;a[i]=(Math.sin(2*Math.PI*640*t)*.45+Math.sin(2*Math.PI*1031*t)*.3+(rnd()*2-1)*.18)*Math.exp(-t*48);}}
  else {let low=0;for(let i=0;i<a.length;i++){low=low*.3+(rnd()*2-1)*.7;a[i]=low;}}
  buffers.set(key,b);return b;
 }
 function track(source,stop){active.add(source);source.onended=()=>{active.delete(source);try{source.disconnect();}catch{}};source.stop(stop);}
 function note(kind,midi,time,velocity,duration,pan,out,group='sfx'){const source=ctx.createBufferSource(),gain=ctx.createGain(),panner=ctx.createStereoPanner();source.buffer=buffer(kind,midi);source.gameGroup=group;source.connect(gain);gain.connect(panner);panner.pan.value=clamp(pan,-1,1);panner.connect(out);const end=time+Math.min(duration,source.buffer.duration),attack=kind==='flute'?.045:kind==='pad'?.2:.003;gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(velocity,time+attack);gain.gain.setValueAtTime(velocity,Math.max(time+attack,end-.13));gain.gain.linearRampToValueAtTime(0,end);source.start(time);track(source,end+.01);source.onended=()=>{active.delete(source);source.disconnect();gain.disconnect();panner.disconnect();};return source;}
 function tone(f,time,duration,volume,out,{end=f,type='sine'}={}){const o=ctx.createOscillator(),g=ctx.createGain();o.gameGroup='sfx';o.type=type;o.frequency.setValueAtTime(f,time);o.frequency.exponentialRampToValueAtTime(Math.max(15,end),time+duration);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(volume,time+.004);g.gain.exponentialRampToValueAtTime(.0001,time+duration);o.connect(g);g.connect(out);o.start(time);track(o,time+duration+.02);o.onended=()=>{active.delete(o);o.disconnect();g.disconnect();};}
 function noise(time,duration,volume,frequency,out,end=frequency){const source=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),g=ctx.createGain();source.gameGroup='sfx';source.buffer=buffer('noise');filter.type='bandpass';filter.Q.value=.7;filter.frequency.setValueAtTime(frequency,time);filter.frequency.exponentialRampToValueAtTime(Math.max(30,end),time+duration);g.gain.setValueAtTime(0,time);g.gain.linearRampToValueAtTime(volume,time+.008);g.gain.exponentialRampToValueAtTime(.0001,time+duration);source.connect(filter);filter.connect(g);g.connect(out);source.start(time);track(source,time+duration+.02);source.onended=()=>{active.delete(source);source.disconnect();filter.disconnect();g.disconnect();};}
 function effect(key,t,out){const n=(m,at=t,v=.25,d=.8)=>note('pluck',m,at,v,d,0,out),wood=(at=t,v=.24)=>note('wood',74,at,v,.15,0,out),sweep=(f,end,d,v=.2)=>noise(t,d,v,f,out,end);
  switch(key){
   case 'pick':wood(t,.1);break;
   case 'card':sweep(1800,900,.11,.13);wood(t+.035,.1);break;
   case 'move':case 'place':wood(t,.28);tone(165,t,.11,.12,out,{end:110});break;
   case 'light':sweep(900,2900,.26,.18);n(81,t+.09,.12,.4);break;
   case 'slash':sweep(2900,500,.2,.3);break;
   case 'palm':sweep(420,110,.19,.28);tone(160,t,.18,.24,out,{end:65});break;
   case 'finger':n(90,t,.19,.35);tone(1450,t,.14,.09,out,{end:940});break;
   case 'enemy':sweep(1300,350,.15,.17);break;
   case 'cannon':tone(115,t,.4,.34,out,{end:36});sweep(500,80,.38,.3);break;
   case 'hit':wood(t,.29);sweep(900,180,.095,.15);break;
   case 'hurt':tone(110,t,.25,.32,out,{end:48});sweep(260,90,.19,.24);break;
   case 'collision':wood(t,.48);wood(t+.055,.19);tone(145,t,.24,.24,out,{end:65});break;
   case 'river':sweep(700,2200,.45,.16);n(74,t+.03,.17,.65);n(81,t+.14,.12,.65);break;
   case 'break':wood(t,.28);n(85,t+.015,.26,.9);n(90,t+.07,.16,.8);break;
   case 'fall':tone(350,t,.48,.2,out,{end:32});sweep(1000,60,.55,.22);break;
   case 'shield':n(62,t,.16,.65);n(69,t+.025,.12,.65);break;
   case 'heal':n(66,t,.16,.9);n(69,t+.11,.16,.9);n(74,t+.22,.19,1.1);break;
   case 'power':n(74,t,.17,.8);n(78,t+.11,.12,.8);break;
   case 'draw':sweep(2600,1400,.11,.11);break;
   case 'turn':wood(t,.21);wood(t+.1,.12);break;
   case 'coin':n(86,t,.18,.5);n(90,t+.075,.13,.55);break;
   case 'encounter':note('drum',45,t,.31,.65,0,out);n(50,t+.07,.24,1.2);break;
   case 'ultimate':sweep(450,2900,.4,.2);note('drum',43,t+.12,.4,.8,0,out);[62,69,74,78].forEach((m,i)=>n(m,t+.13+i*.065,.2,1.1));break;
   case 'reward':[69,74,78].forEach((m,i)=>n(m,t+i*.13,.22,1.15));break;
   case 'victory':[62,69,74,78,81,86].forEach((m,i)=>n(m,t+i*.16,.25,1.65));break;
   case 'defeat':[66,62,59,50].forEach((m,i)=>n(m,t+i*.3,.21,2));break;
  }
 }
 function stop(group){for(const s of [...active])if(!group||s.gameGroup===group)try{s.stop();}catch{}}
 return {note,effect,stop,active,buffers};
}
function create(options={}){let pref=preferences(),ctx=null,bus=null,voices=null,scene='home',timer=null,nextBar=0,bar=0,unlocked=false,destroyed=false,hidden=false,unavailable=false,effectsPlayed=0,lastCue=null;const recent=new Map();
 try{if(options.storage!==false)pref=preferences(JSON.parse(root.localStorage.getItem(STORAGE)||'null'));}catch{}
 const enabledMusic=()=>pref.music&&pref.musicVolume>0,enabledSfx=()=>pref.sfx&&pref.sfxVolume>0;
 function persist(){try{if(options.storage!==false)root.localStorage.setItem(STORAGE,JSON.stringify(pref));}catch{}}
 function mix(){if(!ctx||!bus)return;ramp(bus.master.gain,(enabledMusic()||enabledSfx()) ? .75 : 0,ctx.currentTime);ramp(bus.music.gain,enabledMusic()?pref.musicVolume:0,ctx.currentTime);ramp(bus.sfx.gain,enabledSfx()?pref.sfxVolume:0,ctx.currentTime);for(const [k,g]of Object.entries(bus.layers))ramp(g.gain,MIX[scene][k],ctx.currentTime,.65);}
 function schedule(){if(!ctx||ctx.state!=='running'||hidden||!enabledMusic())return;const now=ctx.currentTime;if(nextBar<now-.2)nextBar=now+.04;while(nextBar<now+.22){for(const n of scoreBar(bar))voices.note(n.kind,n.midi,nextBar+n.beat*BEAT,n.velocity,n.duration,n.pan,bus.layers[n.kind],'music');bar=(bar+1)%BARS;nextBar+=4*BEAT;}}
 function transport(){if(!ctx||!unlocked||hidden||ctx.state!=='running'||!enabledMusic()){if(timer!==null){clearInterval(timer);timer=null;}return;}if(timer===null){schedule();timer=setInterval(schedule,60);}}
 async function unlock(){if(destroyed||hidden||unavailable)return false;if(unlocked&&ctx?.state==='running')return true;try{if(!ctx){const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio){unavailable=true;return false;}ctx=new Audio();bus=graph(ctx);voices=synth(ctx);bus.music.gain.value=0;bus.sfx.gain.value=0;ctx.addEventListener('statechange',transport);}if(ctx.state!=='running')await ctx.resume();unlocked=ctx.state==='running';mix();transport();return unlocked;}catch{unavailable=true;return false;}}
 function setScene(next){if(!Object.hasOwn(MIX,next)||next===scene)return;scene=next;mix();}
 function configure(partial){const wasMusic=enabledMusic(),wasSfx=enabledSfx();pref=preferences({...pref,...partial});persist();mix();if(wasMusic&&!enabledMusic())voices?.stop('music');if(wasSfx&&!enabledSfx())voices?.stop('sfx');if(!wasMusic&&enabledMusic()&&ctx)nextBar=ctx.currentTime+.04;transport();return {...pref};}
 function play(key,delay=0){if(!unlocked||!ctx||ctx.state!=='running'||hidden||!enabledSfx()||destroyed)return false;const now=ctx.currentTime;if(now-(recent.get(key)??-100)<.075)return false;recent.set(key,now);voices.effect(key,now+.012+delay,bus.sfx);effectsPlayed++;lastCue=key;return true;}
 function transition(before,after){transitionCues(before,after).forEach((cue,i)=>play(cue,i*.045));}
 function pause(){hidden=true;if(timer!==null){clearInterval(timer);timer=null;}voices?.stop();if(ctx&&ctx.state==='running')ctx.suspend().catch(()=>{});}
 async function resume(){hidden=false;if(!ctx||!unlocked||destroyed)return;try{nextBar=ctx.currentTime+.04;await ctx.resume();mix();transport();}catch{}}
 function visibility(){if(root.document.hidden)pause();else resume();}
 function destroy(){destroyed=true;pause();if(root.document){root.document.removeEventListener('visibilitychange',visibility);root.removeEventListener('pagehide',pause);root.removeEventListener('pageshow',resume);}if(ctx)ctx.close().catch(()=>{});}
 if(root.document&&options.lifecycle!==false){root.document.addEventListener('visibilitychange',visibility);root.addEventListener('pagehide',pause);root.addEventListener('pageshow',resume);hidden=root.document.hidden;}
 function status(){return {preferences:{...pref},scene,unlocked,unavailable,context:ctx?.state||'idle',musicScheduled:timer!==null,voices:voices?.active.size||0,cachedSamples:voices?.buffers.size||0,effectsPlayed,lastCue,musicBar:bar};}
 return {unlock,configure,setScene,play,transition,pause,resume,destroy,status,readMeter(){if(!bus)return null;const a=new Float32Array(bus.analyser.fftSize);bus.analyser.getFloatTimeDomainData(a);return a;}};
}
async function renderPreview(context,{seconds=32,scene='battle',effects=[],music=true}={}){const bus=graph(context),voices=synth(context);bus.music.gain.value=music?DEFAULTS.musicVolume:0;bus.sfx.gain.value=DEFAULTS.sfxVolume;for(const [k,g]of Object.entries(bus.layers))g.gain.value=MIX[scene]?.[k]??MIX.battle[k];for(let bar=0;bar*4*BEAT<seconds;bar++)for(const n of scoreBar(bar))voices.note(n.kind,n.midi,.03+bar*4*BEAT+n.beat*BEAT,n.velocity,n.duration,n.pan,bus.layers[n.kind],'music');effects.forEach((key,i)=>voices.effect(key,.2+i*1.1,bus.sfx));return context.startRendering();}
const api={DEFAULTS,STORAGE,BPM,BEAT,BARS,preferences,scoreBar,sceneFor,transitionCues,create,renderPreview};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.XQAudio=api;
})(typeof globalThis!=='undefined'?globalThis:this);
