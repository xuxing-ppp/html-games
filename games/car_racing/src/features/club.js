import * as THREE from 'three';
import { CFG, GAME, SETTINGS, CARS, PAINTS } from '../config.js';
import { THEMES, TRACKS, TAU } from '../world/tracks.js';
import { M, makeKartMesh } from '../world/kart.js';
import { sampleRoute, roadPoint, roadQuaternion } from '../world/course.js';
export function createClub(ctx) {
const { scene, karts, hudEl, $, decorGroup, N, perpAt, tangentAt, fmtTime, hex, isHuman, nearestSeg, SND, showToast, keys, togglePause } = ctx;
/* Club expansion: progression, race variants, scenery and feedback. */
let profile;
try { profile = JSON.parse(localStorage.getItem('kart-club-v2')) || {}; } catch { profile = {}; }
if (!profile || typeof profile !== 'object' || Array.isArray(profile)) profile = {};
profile.records ||= {}; profile.races = Number(profile.races) || 0; profile.coins = Number(profile.coins) || 0;
const raceCoins = [], sparks = [];
const coinGroup = new THREE.Group(); scene.add(coinGroup);
const sparkGeo = new THREE.SphereGeometry(.13, 4, 3);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc369 });
const weatherGeo = new THREE.BufferGeometry();
const weatherPositions = new Float32Array(360 * 3);
for (let i = 0; i < weatherPositions.length; i += 3) { weatherPositions[i] = (Math.random() - .5) * 160; weatherPositions[i+1] = Math.random() * 90; weatherPositions[i+2] = (Math.random() - .5) * 160; }
weatherGeo.setAttribute('position', new THREE.BufferAttribute(weatherPositions, 3));
const weatherFX = new THREE.Points(weatherGeo, new THREE.PointsMaterial({ color: 0xe1f4ff, size: .4, transparent: true, opacity: .65 }));
scene.add(weatherFX);
const speedHUD = document.createElement('div'); speedHUD.id = 'speedHUD'; speedHUD.innerHTML = '<div class="speed-dial"><b id="speedValue">0</b><small>KM/H</small></div><div id="raceFeedback"></div><div id="challengeInfo"></div>';
hudEl.appendChild(speedHUD);
const resultExtra = document.createElement('div'); resultExtra.id = 'resultExtra'; $('resultTable').after(resultExtra);

function clearGenerated(group) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of [].concat(o.material)) { materials.add(m); if (m.map) textures.add(m.map); } });
  group.clear(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
}
function makePalm(x,z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const trunk = new THREE.MeshLambertMaterial({color:0xb48c5e});
  const leaf = new THREE.MeshLambertMaterial({color:0x3b8870, side:THREE.DoubleSide});
  const h = 10 + Math.random()*5;
  g.add(M(new THREE.CylinderGeometry(.45,.85,h,7),trunk,0,h/2,0));
  for (let i=0;i<7;i++) { const l=M(new THREE.ConeGeometry(2.1,8,3),leaf,Math.sin(i)*3,h,Math.cos(i)*3); l.rotation.set(Math.cos(i)*1.15, i, Math.sin(i)*1.15); g.add(l); }
  g.traverse(o=>{if(o.isMesh)o.castShadow=true;});
  return g;
}
function makeBuilding(x,z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const h = 14+Math.random()*55, w=9+Math.random()*12;
  const mat=new THREE.MeshLambertMaterial({color: new THREE.Color().setHSL(.60,.16,.19+Math.random()*.12)});
  g.add(M(new THREE.BoxGeometry(w,h,w),mat,0,h/2,0));
  const lit=new THREE.MeshBasicMaterial({color:Math.random()>.5?0x74d9d2:0xffb991});
  const positions=[];
  for(let y=4;y<h-2;y+=5) for(let x1=-w/2+2;x1<w/2;x1+=4) { positions.push([x1,y,w/2+.1,0], [w/2+.1,y,x1,Math.PI/2]); }
  const windows=new THREE.InstancedMesh(new THREE.BoxGeometry(1.3,2,.1),lit,positions.length), dummy=new THREE.Object3D();
  positions.forEach(([x,y,z,r],i)=>{dummy.position.set(x,y,z);dummy.rotation.y=r;dummy.updateMatrix();windows.setMatrixAt(i,dummy.matrix);}); g.add(windows);
  g.add(M(new THREE.BoxGeometry(w+.5,.25,w+.5),lit,0,h+.2,0)); return g;
}
function addTrackDetails(def) {
  // Frequent edge markers make direction readable at speed.
  const poleMat=new THREE.MeshLambertMaterial({color:0x313c42});
  const lightMat=new THREE.MeshBasicMaterial({color:def.theme==='city'?0x75f7d3:0xffce88});
  for(let i=0;i<N;i+=20) {
    const p=ctx.clVec[i], n=perpAt(i), sign=(i/20)%2?1:-1;
    const f=sampleRoute(ctx.course.main,i/N*ctx.course.length);if(f.up.y<.7)continue;
    const g=new THREE.Group();g.position.copy(roadPoint(f,sign*13));g.quaternion.copy(roadQuaternion(f));
    g.add(M(new THREE.CylinderGeometry(.14,.2,7,5),poleMat,0,3.5,0));
    g.add(M(new THREE.BoxGeometry(1.8,.25,.9),lightMat,0,7,0)); decorGroup.add(g);
  }
  if(def.theme==='coast') {
    const water=new THREE.Mesh(new THREE.PlaneGeometry(1500,1700),new THREE.MeshPhongMaterial({color:0x3da7b1,shininess:90,transparent:true,opacity:.88}));
    water.rotation.x=-Math.PI/2;water.position.set(1000,.02,0);decorGroup.add(water);
    const stripe=new THREE.MeshBasicMaterial({color:0xc6f2eb,transparent:true,opacity:.5});
    for(let i=0;i<16;i++){const wave=M(new THREE.BoxGeometry(2,.03,80+Math.random()*160),stripe,260+i*25,.06,-450+i*50);decorGroup.add(wave);}
    for(let i=0;i<7;i++){ const g=new THREE.Group();g.position.set(250,0,-170+i*55);g.add(M(new THREE.CylinderGeometry(.15,.15,5,6),poleMat,0,2.5,0));g.add(M(new THREE.ConeGeometry(4.5,1.3,8),new THREE.MeshLambertMaterial({color:i%2?0xffbc82:0xf1f0da}),0,5,0));decorGroup.add(g); }
  }
  if(def.theme==='city') for(let i=0;i<16;i++){const a=i/16*TAU;decorGroup.add(makeBuilding(Math.sin(a)*360,Math.cos(a)*290));}
  // A colored racing banner anchors the finish straight.
  const c=document.createElement('canvas');c.width=512;c.height=96;const ink=c.getContext('2d');
  ink.fillStyle='#142b2e';ink.fillRect(0,0,512,96);ink.fillStyle='#dbf48a';ink.font='900 44px sans-serif';ink.textAlign='center';ink.fillText('🏁',256,63);
  const banner=new THREE.Mesh(new THREE.PlaneGeometry(21,4),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.DoubleSide}));
  banner.position.copy(ctx.clVec[0]);banner.position.y+=10;banner.rotation.y=Math.atan2(tangentAt(0).x,tangentAt(0).z);decorGroup.add(banner);
}
function trackSVG(t) {
  const xs=t.verts.map(p=>p[0]),zs=t.verts.map(p=>p[1]), minX=Math.min(...xs),minZ=Math.min(...zs);
  const scale=70/Math.max(Math.max(...xs)-minX,Math.max(...zs)-minZ);
  const points=t.verts.map(p=>`${10+(p[0]-minX)*scale},${10+(p[1]-minZ)*scale}`).join(' ');
  return `<svg viewBox="0 0 90 90" aria-hidden="true"><polygon points="${points}" /></svg>`;
}
let showroom;
function previewCar(){
  if(!showroom){
    const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true});renderer.setSize(420,260);renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    const stage=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,420/260,.1,100);camera.position.set(7,6,9);camera.lookAt(0,1,0);
    stage.add(new THREE.HemisphereLight(0xffffff,0x536f7d,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-4,8,5);stage.add(light);
    const model=makeKartMesh(PAINTS[GAME.paint]);stage.add(model);$('garagePreview').appendChild(renderer.domElement);showroom={renderer,stage,camera,model,color:PAINTS[GAME.paint]};
  }
  showroom.model.traverse(o=>{if(o.material?.color?.getHex()===showroom.color)o.material.color.setHex(PAINTS[GAME.paint]);});showroom.color=PAINTS[GAME.paint];
  showroom.renderer.render(showroom.stage,showroom.camera);
}
function buildLobby() {
  const order=[0,8,1,3,4,11,10,9,2,5,7,6];
  $('trackGrid').innerHTML=order.map(i=>`<button class="trackBtn ${i===GAME.track?'on':''}" data-track="${i}" style="--track:${hex(THEMES[TRACKS[i].theme].curbA)}">${trackSVG(TRACKS[i])}<span><b>${TRACKS[i].name}</b></span></button>`).join('');
  $('garage').innerHTML=CARS.map((c,i)=>`<button class="garage-btn ${i===0?'on':''}" data-car="${i}">${c.label}</button>`).join('');
  $('paintPicker').innerHTML=PAINTS.map((p,i)=>`<button aria-label="车漆 ${['珊瑚橙','薄荷绿','柠檬黄','薰衣草','珍珠白'][i]}" class="paint ${i===0?'on':''}" data-paint="${i}" style="background:${hex(p)}"></button>`).join('');
  document.querySelectorAll('[data-car]').forEach(b=>b.onclick=()=>{GAME.car=+b.dataset.car;document.querySelectorAll('[data-car]').forEach(x=>x.classList.toggle('on',x===b));$('carInfo').textContent=CARS[GAME.car].detail;refreshRecord();});
  document.querySelectorAll('[data-paint]').forEach(b=>b.onclick=()=>{GAME.paint=+b.dataset.paint;document.querySelectorAll('[data-paint]').forEach(x=>x.classList.toggle('on',x===b));applyPaint();previewCar();});
  document.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>{GAME.event=b.dataset.event;document.querySelectorAll('[data-event]').forEach(x=>x.classList.toggle('on',x===b));refreshRecord();});
  $('weatherBtn').onclick=()=>{GAME.weather=(GAME.weather+1)%3;$('weatherBtn').textContent='天气：'+['晴朗','雨幕','飘雪'][GAME.weather]+' ↻';refreshRecord();};
  $('carInfo').textContent=CARS[0].detail;
  let helpSource;
  const openHelp=event=>{helpSource=event.currentTarget;$('drivingGuide').classList.remove('hidden');$('drivingHelpClose').focus();};
  const closeHelp=()=>{$('drivingGuide').classList.add('hidden');helpSource?.focus();};
  $('menuHelpBtn').onclick=openHelp;$('drivingHelpClose').onclick=closeHelp;
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('drivingGuide').classList.contains('hidden')){event.preventDefault();closeHelp();}});
  const chooseTrack = step => {
    const index = (order.indexOf(GAME.track) + step + order.length) % order.length;
    document.querySelector(`[data-track="${order[index]}"]`).click();
  };
  $('trackPrev').onclick=()=>chooseTrack(-1); $('trackNext').onclick=()=>chooseTrack(1);
  $('trackPagination').innerHTML=order.map((id,i)=>`<button data-track-jump="${id}" aria-label="赛道 ${i+1}">${String(i+1).padStart(2,'0')}</button>`).join('');
  document.querySelectorAll('[data-track-jump]').forEach(b=>b.onclick=()=>document.querySelector(`[data-track="${b.dataset.trackJump}"]`).click());
  document.querySelectorAll('.setup-tabs button').forEach(b=>b.onclick=()=>{
    $('menu').dataset.page=b.dataset.page;
    document.querySelectorAll('.setup-tabs button').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-pressed',String(x===b));});
    document.querySelectorAll('[data-config]').forEach(x=>x.hidden=x.dataset.config!==b.dataset.page);
  });
  previewCar();
  refreshTrackInfo();
}
function applyPaint() {
  const k=karts[0], old=k.color; k.mesh.traverse(o=>{if(o.material?.color?.getHex()===old)o.material.color.setHex(PAINTS[GAME.paint]);});k.color=PAINTS[GAME.paint];
}
function refreshTrackInfo() {
  const t=TRACKS[GAME.track]; $('previewName').textContent=t.name;
  document.querySelectorAll('[data-track-jump]').forEach(b=>{b.classList.toggle('on',+b.dataset.trackJump===GAME.track);b.setAttribute('aria-pressed',String(+b.dataset.trackJump===GAME.track));});
  const length=ctx.course?.index===GAME.track?ctx.course.length:t.verts.reduce((sum,p,i)=>sum+Math.hypot(p[0]-t.verts[(i+1)%t.verts.length][0],p[1]-t.verts[(i+1)%t.verts.length][1]),0);
  $('trackInfo').textContent=`${(length/1000).toFixed(1)} km · ${t.feature}`;refreshRecord();
}
function recordKey(){return `terrain-v3:${GAME.track}:${GAME.event}:${GAME.car}:${GAME.weather}:${SETTINGS.diff}:${GAME.event==='time'?1:SETTINGS.laps}`;}
function refreshRecord(){const r=profile.records[recordKey()];$('record').textContent=r?(GAME.event==='drift'?Math.floor(r)+' PTS':fmtTime(r)):'暂无纪录';}
function prepareRaceExtras(){
  clearGenerated(coinGroup);raceCoins.length=0;
  for (const p of sparks) scene.remove(p.mesh); sparks.length=0;
  applyPaint();
  const geo=new THREE.TorusGeometry(.8,.22,6,12),mat=new THREE.MeshStandardMaterial({color:0xffd56b,metalness:.65,roughness:.24,emissive:0x5b3105});
  for(let i=18;i<N;i+=12){const p=ctx.clVec[i],n=perpAt(i),mesh=new THREE.Mesh(geo,mat);const frame=sampleRoute(ctx.course.main,i/N*ctx.course.length);mesh.position.copy(roadPoint(frame,Math.sin(i)*3.7,1.6));mesh.quaternion.copy(roadQuaternion(frame));coinGroup.add(mesh);raceCoins.push({mesh, cooldown:0});}
  speedHUD.classList.toggle('split',GAME.mode==='2p');
}
function updateRaceExtras(dt){
  for(const coin of raceCoins){coin.mesh.rotateY(dt*2);coin.cooldown=Math.max(0,coin.cooldown-dt);coin.mesh.visible=coin.cooldown===0;
    if(coin.cooldown>0)continue;
    for(const k of karts.filter(isHuman)){if(k.finished)continue;if(k.motion!=='rescue'&&k.routeId==='main'&&k.pos.distanceTo(coin.mesh.position)<3){k.coins++;coin.cooldown=12;coin.mesh.visible=false;k.boostTimer=Math.max(k.boostTimer,.3);SND.pickup();break;}}
  }
  for(const k of karts.filter(isHuman)){
    const valid=k.drifting&&k.stunTimer<=0&&k.motion==='grounded'&&Math.abs(k.lateral)<ctx.course.routes[k.routeId].width;
    if(valid&&!k.finished){k.chain+=dt;k.combo=Math.min(4,1+Math.floor(k.chain/1.5));k.driftScore+=Math.abs(k.speed)*dt*k.combo;
      if(sparks.length<90){const mesh=new THREE.Mesh(sparkGeo,sparkMat);mesh.position.copy(k.pos);mesh.position.x+=(Math.random()-.5)*3;mesh.position.y+=.3;scene.add(mesh);sparks.push({mesh,life:.4});}
    } else if(k.motion!=='airborne'){k.chain=Math.max(0,k.chain-dt*1.5);k.combo=Math.min(4,1+Math.floor(k.chain/1.5));}
  }
  for(let i=sparks.length-1;i>=0;i--){const p=sparks[i];p.life-=dt;p.mesh.position.y+=dt;p.mesh.scale.setScalar(Math.max(0,p.life*2));if(p.life<=0){scene.remove(p.mesh);sparks.splice(i,1);}}
  const k=karts[0];$('speedValue').textContent=Math.round(Math.abs(k.speed)*3.6);
  $('speedP1').textContent=Math.round(Math.abs(k.speed)*3.6);$('speedP2').textContent=Math.round(Math.abs(karts[1]?.speed||0)*3.6);
  const feedback=h=>h.motion==='rescue'?'救援中':h.feedbackTimer>0?h.feedback:h.motion==='airborne'?'腾空 · 点按漂移做特技':h.stunTimer>0?'失控':h.drifting?`漂移 ×${h.combo}`:h.boostTimer>0?'加速':h.routeId==='shortcut'?'捷径':'Shift 漂移';
  $('raceFeedback').textContent=feedback(k);
  for(const [i,h] of karts.filter(isHuman).entries())$('feedback'+(i+1)).textContent=feedback(h)+(GAME.event==='drift'?` · ${Math.floor(h.driftScore)}分`:'');
  $('speedHUD').classList.toggle('boosting',k.boostTimer>0);
  $('challengeInfo').textContent=`◉ ${k.coins} 金币${GAME.mode==='2p'?' / P2 '+karts[1].coins+' 金币':''}　`+(GAME.event==='drift'?`剩余 ${Math.max(0,90-ctx.raceTime).toFixed(1)}s · 目标 5000 PTS`:'C 切换视角');
  if(GAME.event==='drift'&&ctx.raceTime>=90){for(const h of karts.filter(isHuman)){h.finished=true;h.finishTime=ctx.raceTime;} }
}
function updateAtmosphere(dt){
  weatherFX.visible=GAME.weather!==0&&ctx.state!=='menu'&&ctx.state!=='finished';
  if(!weatherFX.visible)return;weatherFX.position.copy(karts[0].pos);
  weatherFX.material.size=GAME.weather===2?.6:.22;
  const a=weatherGeo.attributes.position;
  for(let i=0;i<a.count;i++){a.array[i*3+1]-=dt*(GAME.weather===2?5:45);if(a.array[i*3+1]<0)a.array[i*3+1]=90;}
  a.needsUpdate=true;
}
function saveRaceProgress(){
  const k=karts[0], key=recordKey(), value=GAME.event==='drift'?k.driftScore:k.finishTime;
  const old=profile.records[key];
  profile.newRecord=!old||(GAME.event==='drift'?value>old:value<old);
  if(profile.newRecord)profile.records[key]=value;
  profile.coins+=karts.filter(isHuman).reduce((s,k)=>s+k.coins,0); profile.races++;
  try{localStorage.setItem('kart-club-v2',JSON.stringify(profile));}catch{}
  refreshRecord();
}
function decorateResults(){
  const k=karts[0];
  if(GAME.event!=='race')$('resultTitle').textContent=GAME.event==='time'?'计时挑战 · 完成':k.driftScore>=5000?'技巧挑战 · 挑战成功':'技巧挑战 · 再接再厉';
  $('podium').style.display=GAME.event==='race'?'':'none';
  resultExtra.innerHTML=`<span>${profile.newRecord?'刷新个人纪录':'比赛完成'}</span><b>◉ ${k.coins} 金币　 /　${Math.floor(k.driftScore)} 技巧积分</b>${GAME.mode==='2p'?`<small>P2：${karts[1].coins} 金币 / ${Math.floor(karts[1].driftScore)} 技巧积分</small>`:''}<small>累计 ${profile.races} 场完赛 · ${profile.coins} 枚金币</small>`;
}
addEventListener('keydown',e=>{if(e.code==='KeyC'&&!e.repeat){GAME.camera=1-GAME.camera;showToast(GAME.camera?'远景追逐视角':'近景追逐视角');}});
addEventListener('blur',()=>{for(const key in keys)keys[key]=false;if(ctx.state==='racing'||ctx.state==='countdown')togglePause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const key in keys)keys[key]=false;if(ctx.state==='racing'||ctx.state==='countdown')togglePause();}});


return { clearGenerated, makePalm, makeBuilding, addTrackDetails, buildLobby, refreshTrackInfo, refreshRecord, prepareRaceExtras, updateRaceExtras, updateAtmosphere, saveRaceProgress, decorateResults };
}
