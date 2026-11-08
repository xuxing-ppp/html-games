/* A chamber score and short, synthesized desk sounds. */
(() => {
 'use strict';

 const storageKey='jingshui.sound';
 const preferences={music:100,effects:100};
 try{
  const saved=JSON.parse(localStorage.getItem(storageKey));
  for(const key of Object.keys(preferences)){
   const value=saved?.[key];
   if(typeof value==='boolean')preferences[key]=value?100:0;
   else if(Number.isFinite(value))preferences[key]=Math.min(100,Math.max(0,Math.round(value)));
  }
 }catch{}

 const frequency=note=>440*2**((note-69)/12);

 function tone(context,output,{at,hz,length,level,attack=.006,release=length,type='sine',endHz=hz}){
  const oscillator=context.createOscillator(),envelope=context.createGain();
  oscillator.type=type;
  oscillator.frequency.setValueAtTime(hz,at);
  oscillator.frequency.exponentialRampToValueAtTime(endHz,at+length);
  envelope.gain.setValueAtTime(0,at);
  envelope.gain.linearRampToValueAtTime(level,at+attack);
  envelope.gain.exponentialRampToValueAtTime(.0001,at+release);
  envelope.gain.linearRampToValueAtTime(0,at+length+.006);
  oscillator.connect(envelope).connect(output);
  oscillator.start(at);
  oscillator.stop(at+length+.006);
 }

 // Original cue in D minor, with a pentatonic lead and an F–G–C–A motif.
 // The middle carries the motif into a higher register. The reprise brings back the opening
 // contour with a longer answer, before the plucked tail returns to the pickup.
 const fluteLines=[
  [1,65,.72,.71],[2,67,.83,.75],[3,72,1.72,.86],[5,69,1.35,.76],
  [8.5,72,.67,.74],[9.5,74,1.54,.85],[11.5,72,.78,.74],[12.5,69,.93,.70],
  [14,67,1.5,.65],[16.5,69,.62,.68],[17.5,67,.74,.63],
  [18.5,65,1.56,.69],[21,62,1.74,.63],

  [25,65,.72,.70],[26,67,.84,.73],[27,72,1.65,.83],[29.5,74,1.16,.76],
  [32,72,.66,.73],[33,69,1.45,.75],[35,67,.89,.66],[36.5,65,1.93,.69],
  [41,67,.67,.75],[42,69,.84,.80],[43,74,1.78,.90],[45.5,72,1.20,.80],
  [48.5,72,.67,.79],[49.5,74,.85,.85],[51,77,1.78,.96],[53.25,74,1.21,.84],
  [55,72,1.67,.76],[58,69,.75,.69],[59,67,1.72,.67],

  [65,65,.72,.69],[66,67,.84,.73],[67,72,2.10,.85],[70,69,1.60,.76],
  [73,74,1.13,.76],[74.5,72,.82,.73],[76,69,1.61,.69],
  [79,67,.81,.62],[80,65,1.28,.63],[82,67,.61,.61],[83,62,2.13,.64]
 ];
 // Zheng answers start after the flute releases. Each uses a clear
 // half-beat pickup or a stepwise descent with a longer landing.
 const zhengReplies=[
  [7,65,.49],[7.5,67,.47],[8,72,.60],
  [23.5,67,.47],[24,65,.51],[24.5,62,.53],
  [39,67,.50],[39.5,69,.47],[40,74,.63,24],
  [47,74,.53],[48,72,.52],
  [61.5,67,.47],[62,65,.53],[63,62,.59],
  [78,72,.52],[78.5,69,.47],
  [86,67,.52],[87,65,.50],[88,62,.61],

  // The coda recalls F–G–C–A, then answers with a slower descent to D.
  [89,65,.49],[90,67,.51],[91,72,.61],[93,69,.55],
  [96,67,.49],[97,65,.47],[98,62,.56],[102,57,.43],[104,62,.49]
 ];
 // Voicings change with the phrase: Dm, F, open G, Dm; F and C support
 // the higher register. The tail settles onto D and A.
 const harmony=[
  [0,8,50,[57,62],[65,69]],[8,8,53,[60,65],[65,69]],
  [16,8,55,[62,67],[62,69]],[24,8,50,[57,65],[65,69]],
  [32,8,48,[55,64],[64,67]],[40,8,55,[62,67],[65,70]],
  [48,8,53,[60,65],[69,72]],[56,8,55,[62,67],[65,70]],
  [64,8,50,[57,62],[65,69]],[72,8,53,[60,65],[65,69]],
  [80,8,55,[62,67],[62,69]],[88,8,50,[57,65],[65,69]],
  [96,12,50,[57,62],[57,62]]
 ];

 function zhengVoice(ctx,output){
  const strings=new Map();
  return (at,note,touch,press=0)=>{
   if(!strings.has(note)){
    const hz=frequency(note),rate=ctx.sampleRate,period=rate/hz-.5;
    const size=Math.ceil(period)+1,ring=new Float32Array(size);
    const buffer=ctx.createBuffer(1,Math.ceil(rate*2.7),rate);
    const samples=buffer.getChannelData(0);
    let seed=note*1543,previous=0,write=0;
    for(let i=0;i<size;i++){
     seed=(Math.imul(seed,1664525)+1013904223)>>>0;
     ring[i]=.52*Math.sin(2*Math.PI*i/period)+.38*(seed/2147483648-1);
    }
    for(let i=0;i<samples.length;i++){
     const read=(write+size-period)%size,index=Math.floor(read);
     const v=ring[index]+(ring[(index+1)%size]-ring[index])*(read-index);
     ring[write]=.4993*(v+previous);
     previous=v;
     write=(write+1)%size;
     const time=i/rate;
     samples[i]=v*Math.min(1,time/.004)*Math.exp(-time*.64)*Math.min(1,(2.7-time)*5);
    }
    strings.set(note,buffer);
   }
   const source=ctx.createBufferSource(),gain=ctx.createGain();
   source.buffer=strings.get(note);
   gain.gain.value=touch*.35;
   if(press){
    source.detune.setValueAtTime(0,at);
    source.detune.linearRampToValueAtTime(press,at+.18);
    source.detune.linearRampToValueAtTime(0,at+.68);
   }
   source.connect(gain).connect(output);
   source.start(at);
  };
 }

 function roomResponse(ctx){
  const response=ctx.createBuffer(2,Math.round(ctx.sampleRate*1.75),ctx.sampleRate);
  // Filtered, decaying noise gives a diffuse tail instead of a rhythmic echo.
  let seed=23;
  for(let channel=0;channel<2;channel++){
   const samples=response.getChannelData(channel);
   let filtered=0;
   for(let i=0;i<samples.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    filtered+=(seed/2147483648-1-filtered)*.24;
    const t=i/ctx.sampleRate;
    samples[i]=filtered*Math.min(t/.025,1)*(1-i/samples.length)**3;
   }
  }
  return response;
 }

 function wave(ctx,partials){
  return ctx.createPeriodicWave(new Float32Array(partials.length+1),Float32Array.of(0,...partials));
 }

 function sustained(ctx,output,shape,{at,note,length,level,attack,release,vibrato}){
  const voice=ctx.createOscillator(),gain=ctx.createGain();
  voice.setPeriodicWave(shape);
  voice.frequency.value=frequency(note);
  gain.gain.setValueAtTime(0,at);
  gain.gain.linearRampToValueAtTime(level,at+attack);
  gain.gain.linearRampToValueAtTime(level*.84,at+length);
  gain.gain.linearRampToValueAtTime(0,at+length+release);
  if(vibrato){
   const lfo=ctx.createOscillator(),depth=ctx.createGain();
   lfo.frequency.value=4.8;
   depth.gain.setValueAtTime(0,at);
   depth.gain.linearRampToValueAtTime(vibrato,at+length*.75);
   lfo.connect(depth).connect(voice.detune);
   lfo.start(at);
   lfo.stop(at+length+release);
  }
  voice.connect(gain).connect(output);
  voice.start(at);
  voice.stop(at+length+release);
 }

 async function renderScore(){
  const Offline=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext;
  const beat=.79,rate=22050,frames=Math.round(108*beat*rate);
  const score=new Offline(2,frames+rate*4,rate);
  const mix=score.createGain(),room=score.createConvolver(),wet=score.createGain();
  mix.connect(score.destination);
  room.buffer=roomResponse(score);
  wet.gain.value=.35;
  mix.connect(room).connect(wet).connect(score.destination);

  const flute=wave(score,[1,.20,.13,.04,.02]);
  const bowed=wave(score,[1,.30,.14,.06]);
  const strings=score.createStereoPanner();
  strings.pan.value=-.20;
  strings.connect(mix);
  const wind=score.createStereoPanner();
  wind.pan.value=.16;
  wind.connect(mix);

  const pluck=zhengVoice(score,strings);
  const replyBeats=new Set(zhengReplies.map(([step])=>step));
  for(const [step,duration,bass,voicing,pad] of harmony){
   for(let bar=0;bar<duration/4;bar++){
    const downbeat=step+bar*4,tail=step>=88;
    pluck(downbeat*beat,bass,tail?.35:.44);
    const answerBeat=downbeat+2;
    if(!replyBeats.has(answerBeat)&&!replyBeats.has(answerBeat-.5)){
     pluck(answerBeat*beat,voicing[bar%2],tail?.24:.32);
    }
   }
   for(const note of pad){
    sustained(score,score.destination,bowed,{at:step*beat,note,length:duration*beat-.85,
     level:step>=88?.018:.024,attack:1.2,release:1.35});
   }
  }
  for(const [step,note,touch,press] of zhengReplies){
   pluck(step*beat,note,touch,press);
  }
  for(const [step,note,duration,touch] of fluteLines){
   sustained(score,wind,flute,{at:step*beat,note,length:duration*beat,
    level:.174*touch,attack:duration<1?.083:.16,release:.23,vibrato:duration>1?13:0});
  }

  // Fold the final chord and room reflections into the start for a continuous loop.
  const rendered=await score.startRendering(),loop=score.createBuffer(2,frames,rate);
  for(let channel=0;channel<2;channel++){
   const full=rendered.getChannelData(channel),samples=loop.getChannelData(channel);
   samples.set(full.subarray(0,frames));
   for(let i=frames;i<full.length;i++)samples[i-frames]+=full[i];
  }
  return loop;
 }

 let context,effects,noise,unlocking,scoreTask,score,source,offset=0,startedAt=0;
 let pageActive=true,activated=false;
 const visible=()=>pageActive&&!document.hidden;
 const ready=()=>context?.state==='running'&&visible();

 function syncMusic(){
  if(source&&(!preferences.music||!ready())){
   const now=context.currentTime;
   offset=(offset+now-startedAt)%score.duration;
   source.gain.gain.cancelScheduledValues(now);
   source.gain.gain.setTargetAtTime(0,now,.005);
   source.node.stop(now+.025);
   source=null;
  }
  if(!preferences.music||!ready()||source)return;
  if(!score){
   scoreTask??=renderScore().then(buffer=>{score=buffer;syncMusic();}).catch(()=>{});
   return;
  }
  const node=context.createBufferSource(),gain=context.createGain();
  node.buffer=score;
  node.loop=true;
  node.connect(gain).connect(context.destination);
  startedAt=context.currentTime;
  gain.gain.setValueAtTime(0,startedAt);
  gain.gain.linearRampToValueAtTime(.34*preferences.music/100,startedAt+.04);
  node.start(startedAt,offset);
  source={node,gain};
 }

 // Environmental loops are quiet, local and independent of the musical score.
 let atmosphere=null,ambientSource=null,ambientBuffer=new Map();
 const lastCue=new Map();
 function stopAmbience(){if(!ambientSource)return;const {node,gain}=ambientSource;ambientSource=null;const t=context.currentTime;gain.gain.cancelScheduledValues(t);gain.gain.setTargetAtTime(0,t,.09);node.stop(t+.45);}
 function environmentBuffer(kind){
  if(ambientBuffer.has(kind))return ambientBuffer.get(kind);
  const rate=context.sampleRate,length=12,buffer=context.createBuffer(2,rate*length,rate);
  let seed=91;
  for(let channel=0;channel<2;channel++){
   const data=buffer.getChannelData(channel);let smooth=0,deep=0;
   for(let i=0;i<data.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const random=seed/2147483648-1,t=i/rate;
    smooth+=(random-smooth)*.035;deep+=(smooth-deep)*.009;
    const edge=Math.min(1,t/.3,(length-t)/.3);
    let sample=0;
    if(kind.includes('river'))sample+=deep*.27*(.7+.3*Math.sin(t*Math.PI/3))+smooth*.035*(1+Math.sin(t*2.1));
    if(kind==='rain')sample+=smooth*.13+Math.sin(2*Math.PI*720*t)*Math.exp(-(((t%1.7)-.16)**2)*700)*.009;
    if(kind.includes('night'))sample+=deep*.15+Math.sin(2*Math.PI*2350*t)*Math.max(0,Math.sin(t*Math.PI/2))**18*.007;
    if(kind==='river')sample+=Math.sin(2*Math.PI*116*t)*Math.exp(-(((t%4)-.8)**2)*55)*.007;
    data[i]=sample*Math.max(0,edge);
   }
  }
  ambientBuffer.set(kind,buffer);return buffer;
 }
 function syncAmbience(){
  if(!ready()||!preferences.effects||!atmosphere){stopAmbience();return;}
  if(ambientSource?.kind===atmosphere)return;
  stopAmbience();
  const node=context.createBufferSource(),gain=context.createGain();node.buffer=environmentBuffer(atmosphere);node.loop=true;
  gain.gain.setValueAtTime(0,context.currentTime);gain.gain.linearRampToValueAtTime(.65,context.currentTime+.6);
  node.connect(gain).connect(effects);node.start();ambientSource={node,gain,kind:atmosphere};
 }
 function setScene(kind){const next=['river','rain','night','river-night'].includes(kind)?kind:null;if(atmosphere===next)return;atmosphere=next;syncAmbience();}
 function deskCue(cue,at){
  if(['slip','sort','select','ledger'].includes(cue)){
   const specs={slip:[.08,1300,.09],sort:[.10,1050,.12],select:[.04,2100,.045],ledger:[.14,900,.18]};
   const [level,band,length]=specs[cue];rustle(at,level,band,length);
   if(cue==='sort'||cue==='ledger')rustle(at+.065,level*.55,band*1.4,length*.7);
   if(cue==='slip'||cue==='select')tone(context,effects,{at,hz:cue==='select'?520:270,endHz:210,length:.045,level:.025});
  }else if(cue==='knock'||cue==='block'){
   const beats=cue==='knock'?[0,.17]:[0,.11,.26];
   for(const offset of beats){tone(context,effects,{at:at+offset,hz:cue==='knock'?155:105,endHz:78,length:.11,level:.07});rustle(at+offset,.035,640,.08);}
  }else if(cue==='steps'){
   for(const offset of [0,.26,.54]){rustle(at+offset,.08,570,.09);tone(context,effects,{at:at+offset,hz:115,endHz:72,length:.09,level:.035});}
  }else if(cue==='handover'){rustle(at,.10,1550,.14);rustle(at+.11,.06,1000,.12);}
 }

 function syncAudio(){
  if(effects){
   const now=context.currentTime;
   effects.gain.cancelScheduledValues(now);
   effects.gain.setTargetAtTime(visible()?preferences.effects/100:0,now,.008);
  }
  syncMusic();syncAmbience();
 }

 function unlock(){
  if(!activated||!visible()||!(preferences.music||preferences.effects)||ready()||unlocking)return;
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Audio)return;
  try{
   if(!context){
    context=new Audio();
    effects=context.createGain();
    effects.connect(context.destination);
    context.addEventListener('statechange',syncAudio);
   }
   unlocking=context.resume().then(syncAudio).catch(()=>{}).finally(()=>{unlocking=null;});
  }catch{}
 }

 function rustle(at,level,band,length){
  if(!noise){
   noise=context.createBuffer(1,Math.ceil(context.sampleRate*.2),context.sampleRate);
   const data=noise.getChannelData(0);
   for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  }
  const node=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
  node.buffer=noise;
  filter.type='bandpass';
  filter.frequency.value=band;
  gain.gain.setValueAtTime(0,at);
  gain.gain.linearRampToValueAtTime(level,at+.014);
  gain.gain.exponentialRampToValueAtTime(.0001,at+length);
  node.connect(filter).connect(gain).connect(effects);
  node.start(at);
  node.stop(at+length);
 }

 function play(cue){
  if(!preferences.effects||!visible())return;
  const requested=performance.now();if(requested-(lastCue.get(cue)??-Infinity)<85)return;lastCue.set(cue,requested);
  function sound(){
   if(!ready()||!preferences.effects||performance.now()-requested>200)return;
   const at=context.currentTime+.005;
   deskCue(cue,at);
   if(cue==='paper'){
    rustle(at,.14,1850,.14);
    rustle(at+.047,.075,3100,.09);
   }else if(cue==='tap'){
    tone(context,effects,{at,hz:420,endHz:220,length:.075,level:.085});
    rustle(at,.055,1400,.055);
   }else if(cue==='seal'){
    tone(context,effects,{at,hz:165,endHz:83,length:.19,level:.15});
    tone(context,effects,{at:at+.012,hz:370,endHz:205,length:.10,level:.06});
    rustle(at,.095,800,.075);
   }else if(cue==='retry'){
    tone(context,effects,{at,hz:245,endHz:177,length:.20,level:.09});
    tone(context,effects,{at,hz:486,endHz:356,length:.10,level:.026});
   }
  }
  if(ready())sound();
  else unlocking?.then(sound);
 }

 function set(key,volume){
  preferences[key]=volume;
  if(key==='music'&&source&&volume){
   const now=context.currentTime;
   const gain=source.gain.gain;
   if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(now);
   else gain.cancelScheduledValues(now);
   gain.setTargetAtTime(.34*volume/100,now,.015);
  }
  try{localStorage.setItem(storageKey,JSON.stringify(preferences));}catch{}
  if(volume)unlock();
  syncAudio();
 }

 for(const type of ['pointerdown','pointerup','keydown','click']){
  document.addEventListener(type,event=>{
   if(!event.isTrusted||navigator.userActivation?.isActive===false)return;
   activated=true;
   unlock();
  },true);
 }
 document.addEventListener('visibilitychange',()=>{syncAudio();unlock();});
 addEventListener('pagehide',()=>{pageActive=false;syncAudio();});
 addEventListener('pageshow',()=>{pageActive=true;syncAudio();unlock();});
 globalThis.Ming.sound={get:key=>preferences[key],set,play,setScene};
})();
