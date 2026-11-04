
import * as THREE from 'three';
import { CFG, DIFF, GAME, SETTINGS, saveSettings, KART_COLORS, CARS } from './config.js';
import { THEMES, TRACKS, TAU } from './world/tracks.js';
import { createWorld, N } from './world/world.js';
import { M, makeKartMesh } from './world/kart.js';
import { SND } from './audio.js';
import { createClub } from './features/club.js';
import { sampleRoute, roadPoint, roadQuaternion, projectRoute, wrap } from './world/course.js';
import { resetDriver, stepDriver, PHYSICS_STEP } from './world/driving.js';


/* ============================================================
   配置 & 全局
============================================================ */
/* ============================================================
   渲染器 / 场景 / 相机 (双相机用于分屏)
============================================================ */
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
function applyQuality() {
  const q = SETTINGS.qual; renderer.shadowMap.enabled = q !== 'low'; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (q === 'low') renderer.setPixelRatio(1);
  else if (q === 'high') renderer.setPixelRatio(Math.min(devicePixelRatio, 2.5));
  else renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
}
applyQuality();
container.appendChild(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ecae6);
scene.fog = new THREE.Fog(0x8ecae6, 240, 760);

const cam1 = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 2400);
const cam2 = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 2400);
cam1.position.set(0, 30, -60); cam2.position.set(60, 30, 0);

scene.add(new THREE.AmbientLight(0xffffff,.5));
scene.add(new THREE.HemisphereLight(0xcfefff, 0x55703a, 1.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.15); sun.position.set(120, 220, 80); scene.add(sun);
sun.castShadow=true; sun.shadow.mapSize.set(1024,1024); sun.shadow.camera.left=-65; sun.shadow.camera.right=65; sun.shadow.camera.top=65; sun.shadow.camera.bottom=-65; sun.shadow.camera.near=1; sun.shadow.camera.far=230; sun.shadow.bias=-.0005; sun.shadow.normalBias=.12; scene.add(sun.target);
// 太阳本体可视化 (在某些主题里改色)
const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(20, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xfff2a0, fog: false }));
sunDisc.position.set(700, 380, 500); scene.add(sunDisc);

// 云朵 (实例化组)
const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
function makeClouds(count, color = 0xffffff) {
  club.clearGenerated(cloudGroup);
  const m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85, fog: false });
  for (let i = 0; i < count; i++) {
    const cg = new THREE.Group();
    const parts = 3 + (Math.random() * 3 | 0);
    for (let p = 0; p < parts; p++) {
      const r = 8 + Math.random() * 12;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m);
      s.position.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 22);
      cg.add(s);
    }
    cg.position.set((Math.random() - 0.5) * 1400, 120 + Math.random() * 140, (Math.random() - 0.5) * 1400);
    cloudGroup.add(cg);
  }
}

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(3600, 3600, 96, 96).rotateX(-Math.PI / 2),
  new THREE.MeshLambertMaterial({ color: 0x57a83f })
);
ground.receiveShadow=true; ground.position.y = -0.08; scene.add(ground);

const trackGroup = new THREE.Group(); scene.add(trackGroup);
// 远景山脉 (装饰)
const decorGroup = new THREE.Group(); scene.add(decorGroup);

/* ============================================================
   音频 (Web Audio 程序化合成) - 三段独立音量
============================================================ */
/* ============================================================
   赛道定义 & 主题
============================================================ */
const world = createWorld({ scene, ground, sunDisc, makeClouds, trackGroup, decorGroup,
  clearGenerated: group => club.clearGenerated(group),
  makePalm: (x,z) => club.makePalm(x,z), makeBuilding: (x,z) => club.makeBuilding(x,z),
  addTrackDetails: track => club.addTrackDetails(track) });
const { CL, clVec, bbMin, bbMax, boostPads, slowPads, tangentAt, perpAt, buildTrack, ensureTrack } = world;

/* ============================================================
   卡丁车模型 (更精致)
============================================================ */
/* ============================================================
   游戏对象
============================================================ */
const karts = [], itemBoxes = [], bananas = [], shells = [];

const CTRL = {
  p1_1p: { accel: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'], drift: ['ShiftLeft', 'ShiftRight'], item: ['Space', 'Enter'] },
  p1_2p: { accel: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], drift: ['ShiftRight'], item: ['Enter', 'NumpadEnter'] },
  p2_2p: { accel: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], drift: ['ShiftLeft'], item: ['Space'] },
};

function createKarts() {
  for (let i = 0; i < CFG.KART_COUNT; i++) {
    const mesh = makeKartMesh(KART_COLORS[i % KART_COLORS.length]); scene.add(mesh);
    karts.push({
      mesh, color: KART_COLORS[i % KART_COLORS.length],
      isPlayer: false, isPlayer2: false, isAI: true, ctrl: null,
      pos: new THREE.Vector3(), heading: 0, speed: 0,
      steer: 0, steerTarget: 0, throttle: 0, brakeI: 0,
      driftKey: false, driftCharge: 0, drifting: false, boostTimer: 0,
      item: null, _itemDeb: false, stunTimer: 0,
      lap: 0, segIndex: 0, crossedHalf: false, progress: 0, rank: i + 1,
      finished: false, finishTime: 0,
      lapTimes: [], lapStartTime: 0, bestLap: Infinity,
      aiOffset: (Math.sin(i * 12.9) + (Math.random() - 0.5) * 0.8) * 2.2,
      bravery: 0.9 + Math.random() * 0.22,        // 过弯胆量(越高弯道越快越险), 各车不同
      itemAgg: 0.8 + Math.random() * 0.5,         // 道具攻击性, 各车不同
      useItemCooldown: 1.5 + (i % 3) + Math.random() * 1.5,
    });
  }
}

function assignControls() {
  for (const k of karts) { k.isPlayer = false; k.isPlayer2 = false; k.isAI = true; k.ctrl = null; }
  karts[0].isPlayer = true; karts[0].ctrl = GAME.mode === '2p' ? CTRL.p1_2p : CTRL.p1_1p; karts[0].isAI = false;
  if (GAME.mode === '2p') { karts[1].isPlayer2 = true; karts[1].ctrl = CTRL.p2_2p; karts[1].isAI = false; }
}

function createItemBoxes() {
  for (const b of itemBoxes) { scene.remove(b.mesh); clearGenerated(b.mesh); } itemBoxes.length = 0;
  const rows = [26, 95, 165, 240, 315, 380];
  for (const idx of rows) for (const off of [-4, 0, 4]) {
    const p = clVec[idx], n = perpAt(idx);
    const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffcf33'; ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, 52, 52);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', 32, 50);
    const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(c) }));
    const frame=sampleRoute(world.course.main,idx/N*world.course.length);m.position.copy(roadPoint(frame,off,1.4));m.quaternion.copy(roadQuaternion(frame));scene.add(m);
    itemBoxes.push({ mesh: m, active: true, respawn: 0, basePos: m.position.clone() });
  }
}

/* ============================================================
   道具逻辑
============================================================ */
const ITEM_NAMES = { mushroom: '🍄', banana: '🍌', green: '🐢', red: '🔴' };
function rollItem(rank) {
  let w;
  if (rank <= 2) w = { banana: 0.35, green: 0.30, red: 0.10, mushroom: 0.25 };
  else if (rank <= 5) w = { green: 0.28, red: 0.27, banana: 0.20, mushroom: 0.25 };
  else w = { mushroom: 0.42, red: 0.30, green: 0.16, banana: 0.12 };
  const r = Math.random(), keys = ['mushroom', 'banana', 'green', 'red']; let acc = 0;
  for (const k of keys) { acc += w[k]; if (r <= acc) return k; }
  return 'mushroom';
}
function useItem(k){
  if(!k.item||k.motion!=='grounded')return;
  if(k.item==='mushroom'){k.boostTimer=Math.max(k.boostTimer,1.3);SND.boost();}
  else{
    const banana=k.item==='banana',route=world.course.routes[k.routeId];
    const roadS=k.roadS+(banana?-4:3),frame=sampleRoute(route,roadS);
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(banana?.8:.7,10,8),new THREE.MeshLambertMaterial({color:banana?0xffe14a:k.item==='red'?0xff3b3b:0x33cc55}));
    const pos=roadPoint(frame,k.lateral,.8);mesh.position.copy(pos);scene.add(mesh);
    const data={mesh,pos,routeId:k.routeId,roadS,lateral:k.lateral,life:banana?20:4,born:0,owner:k,type:k.item,motion:'grounded',yaw:k.yaw};
    (banana?bananas:shells).push(data);if(banana)SND.banana();else SND.shell();
  }
  k.item=null;
}
function stunKart(k, t = 1.3) { if (!k.finished) { k.stunTimer = t; k.boostTimer = 0; k.driftCharge = 0; k.drifting = false; k._stunHeading = k.heading; SND.stun(); } }

/* ============================================================
   输入
============================================================ */
const keys = {};
const down = (...cs) => cs.some(c => keys[c]);
addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'KeyR' && (state === 'racing' || state === 'finished' || state === 'paused')) { restart(); return; }
  if (e.code === 'KeyM') { SND.toggleMute(); syncMuteToggle(); showToast(SETTINGS.muted ? '已静音' : '已开启声音'); return; }
  if (state === 'racing') {
    for (const k of karts) {
      if ((k.isPlayer || k.isPlayer2) && k.ctrl.item.includes(e.code) && !k._itemDeb && !k.finished) { useItem(k); k._itemDeb = true; }
    }
  }
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  for (const k of karts) { if ((k.isPlayer || k.isPlayer2) && k.ctrl && k.ctrl.item.includes(e.code)) k._itemDeb = false; }
});

/* ============================================================
   工具
============================================================ */
function nearestSeg(x,z,y=0,hint){ const near=projectRoute(world.course.main,new THREE.Vector3(x,y,z),hint);return {i:Math.floor(near.s/world.course.length*N)%N,d:Math.abs(near.lateral),...near}; }
const damp = (k, dt) => 1 - Math.exp(-k * dt);   // 帧率无关平滑系数

function isHuman(k) { return k.isPlayer || k.isPlayer2; }

/* ============================================================
   物理 / AI
============================================================ */
function readPlayerInput(k) {
  const c = k.ctrl;
  const left = down(...c.left), right = down(...c.right);
  // Steering is screen-relative in the rear chase view (+Z faces away).
  k.steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
  k.throttle = down(...c.accel) ? 1 : 0;
  k.brakeI = down(...c.brake) ? 1 : 0;
  k.driftKey = down(...c.drift);
}

function updateAI(k,dt) {
  const D=DIFF[SETTINGS.diff],route=world.course.routes[k.routeId],f=sampleRoute(route,k.roadS),look=sampleRoute(route,k.roadS+18);
  const bend=Math.atan2(f.forward.clone().cross(look.forward).dot(f.up),f.forward.dot(look.forward))/18;
  let target=k.aiOffset;
  const branch=world.course.routes.shortcut;
  if(branch&&k.routeId==='main'&&branch.entry-k.roadS>0&&branch.entry-k.roadS<80&&['normal','hard','expert'].includes(SETTINGS.diff)&&karts.indexOf(k)%3!==0)target=branch.side*4.1;
  const desired=Math.atan2(k.lateral-target,16);
  k.steerTarget=THREE.MathUtils.clamp((desired-k.yaw)*3-bend*k.speed/CFG.turnRate,-1,1);
  const targetSpeed=Math.max(22,Math.min(CFG.maxSpeed*D.maxMul,Math.sqrt(35/Math.max(.01,Math.abs(bend)))));
  k.throttle=k.speed<targetSpeed?1:0;k.brakeI=k.speed>targetSpeed+5?1:0;
  k.driftKey=Math.abs(bend)>.012&&k.motion==='grounded';
  if(k.motion==='airborne')k.driftKey=k.airTime>.1&&k.airTime<.2;
  k._maxMul=D.maxMul;k._accelMul=D.accelMul;
  k.useItemCooldown-=dt;
  if(k.item&&k.useItemCooldown<=0){useItem(k);k.useItemCooldown=2.5/ D.agg;}
}
function updateKart(k,dt) {
  if(!k.mesh.visible)return;
  if(state==='racing'&&!k.finished){
    if(isHuman(k))readPlayerInput(k);else updateAI(k,dt);
    const beforeBoost=k.boostTimer;
    stepDriver(k,world.course,{steer:k.steerTarget,throttle:k.throttle,brake:k.brakeI,drift:k.driftKey},dt,{CFG,car:isHuman(k)?CARS[GAME.car]:undefined,maxMul:k._maxMul,accelMul:k._accelMul});
    if(k.completedLap){
      k.completedLap=false;const lapTime=raceTime-k.lapStartTime;k.lapTimes.push(lapTime);k.bestLap=Math.min(k.bestLap,lapTime);k.lapStartTime=raceTime;
      if(k.lap>=CFG.LAPS&&GAME.event!=='drift'){k.finished=true;k.finishTime=raceTime;}
    }
    if(k.boostTimer>beforeBoost+.2&&isHuman(k))SND.boost();
  }
  k.mesh.position.copy(k.pos);
  const frame=k.frame||sampleRoute(world.course.main,0);
  k.mesh.quaternion.copy(roadQuaternion(frame,-k.yaw));
  if(k.motion==='airborne'&&k.trick&&!reducedMotion())k.mesh.rotateZ(k.trickAngle);
  if(k.stunTimer>0&&!reducedMotion())k.mesh.rotateY(k.stunTimer*10);
  k.mesh.scale.setScalar(k.motion==='rescue'?.65:1);
  for(const w of k.mesh.userData.wheels)w.rotation.x+=k.speed*dt*1.6;
  for(const fl of k.mesh.userData.flames)fl.visible=k.boostTimer>0;
}
function sameRoad(a,b,radius){
  return a.routeId===b.routeId&&a.pos.distanceToSquared(b.pos)<radius*radius&&a.motion!=='rescue'&&b.motion!=='rescue';
}
function kartKartCollisions(){
  for(let i=0;i<karts.length;i++)for(let j=i+1;j<karts.length;j++){
    const a=karts[i],b=karts[j];if(!a.mesh.visible||!b.mesh.visible||!sameRoad(a,b,3.4))continue;
    const d=a.lateral-b.lateral;if(Math.abs(d)<2.8){const push=(2.8-Math.abs(d))*.25;const sign=d===0?(i%2?1:-1):Math.sign(d);a.lateral+=sign*push;b.lateral-=sign*push;const avg=(a.speed+b.speed)*.5;a.speed=a.speed*.9+avg*.1;b.speed=b.speed*.9+avg*.1;}
  }
}
function updateItems(dt){
  for(const [pads,boost] of [[boostPads,true],[slowPads,false]])for(const pad of pads){
    for(const k of karts){
      if(!k.mesh.visible||k.finished||k.motion!=='grounded'||k.routeId!==pad.routeId||k.pos.distanceToSquared(pad.mesh.position)>25)continue;
      if(boost){if(k.boostTimer<.5)k.boostTimer=1.5;}else k.speed*=Math.exp(-3.5*dt);
    }
  }
  for(const b of itemBoxes){
    if(!b.active){b.respawn-=dt;if(b.respawn<=0){b.active=true;b.mesh.visible=true;}continue;}
    b.mesh.rotateY(dt*2);
    for(const k of karts)if(k.mesh.visible&&!k.finished&&!k.item&&k.motion==='grounded'&&k.routeId==='main'&&k.pos.distanceToSquared(b.basePos)<16){b.active=false;b.mesh.visible=false;b.respawn=4.5;k.item=rollItem(k.rank);if(isHuman(k))SND.pickup();break;}
  }
  for(let i=bananas.length-1;i>=0;i--){const b=bananas[i];b.life-=dt;
    if(b.life<=0||karts.some(k=>k.mesh.visible&&k.stunTimer<=0&&sameRoad(k,b,2.5)&&(stunKart(k),true))){scene.remove(b.mesh);clearGenerated(b.mesh);bananas.splice(i,1);}
  }
  for(let i=shells.length-1;i>=0;i--){
    const s=shells[i];s.life-=dt;s.born+=dt;let route=world.course.routes[s.routeId];
    if(s.type==='red'){
      const targets=karts.filter(k=>k.mesh.visible&&k!==s.owner&&!k.finished&&k.motion==='grounded'&&k.routeId===s.routeId).map(k=>({k,d:route.closed?wrap(k.roadS-s.roadS,route.length):k.roadS-s.roadS})).filter(t=>t.d>0&&t.d<120).sort((a,b)=>a.d-b.d);
      if(targets[0])s.lateral+=(targets[0].k.lateral-s.lateral)*Math.min(1,dt*3);
    }
    if(s.type==='green'){
      const before=sampleRoute(route,s.roadS);const advance=70*Math.cos(s.yaw)*dt;const after=sampleRoute(route,s.roadS+advance);
      s.yaw+=Math.atan2(before.forward.clone().cross(after.forward).dot(before.up),before.forward.dot(after.forward));
      s.roadS+=advance;s.lateral-=Math.sin(s.yaw)*70*dt;
    }else s.roadS+=70*dt;
    if(!route.closed&&s.roadS>route.length){s.roadS=route.exit+s.roadS-route.length;s.routeId='main';route=world.course.main;}
    const f=sampleRoute(route,s.roadS);s.pos.copy(roadPoint(f,s.lateral,.8));s.mesh.position.copy(s.pos);s.mesh.quaternion.copy(roadQuaternion(f));
    let dead=s.life<=0||Math.abs(s.lateral)>route.width;
    for(const k of karts)if(k.mesh.visible&&!(k===s.owner&&s.born<.4)&&!k.finished&&sameRoad(k,s,2.5)){stunKart(k);dead=true;break;}
    if(dead){scene.remove(s.mesh);clearGenerated(s.mesh);shells.splice(i,1);}
  }
}

function updateRanks() {
  const sorted = karts.filter(k => k.mesh.visible).sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1; if (b.finished) return 1;
    return b.progress - a.progress;
  });
  sorted.forEach((k, i) => k.rank = i + 1);
}

/* ============================================================
   相机 (修复抖动: 平滑位置 + 一次性 rotateZ roll)
============================================================ */
const _camPos = new THREE.Vector3(), _camLook = new THREE.Vector3();
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
function reducedMotion(){return SETTINGS.reduceMotion||motionPreference.matches;}
function updateCamera(cam,k,dt){
  const frame=k.frame||sampleRoute(world.course.main,0);
  const fwd=frame.forward.clone().multiplyScalar(Math.cos(k.yaw)).addScaledVector(frame.right,-Math.sin(k.yaw));
  const up=frame.up;
  cam.fov+=((k.boostTimer>0&&!reducedMotion()?73:62)-cam.fov)*damp(3,dt);cam.updateProjectionMatrix();
  let dist=((GAME.camera?19:11)+Math.min(65,Math.abs(k.speed))*.09)*Math.max(1,Math.min(1.85,.7/cam.aspect));
  const route=world.course.routes[k.routeId];if(route.magnet&&k.roadS>route.magnet.start&&k.roadS<route.magnet.end)dist=Math.min(dist,13);
  _camPos.copy(k.pos).addScaledVector(fwd,-dist).addScaledVector(up,GAME.camera?10:6);
  cam.position.lerp(_camPos,damp(10,dt));
  cam.up.lerp(up,damp(12,dt)).normalize();
  _camLook.copy(k.pos).addScaledVector(fwd,10).addScaledVector(up,2);cam.lookAt(_camLook);
}

/* ============================================================
   HUD / 小地图
============================================================ */
const $ = id => document.getElementById(id);
const minimap = $('minimap'), mctx = minimap.getContext('2d');
function fmtTime(t) { const m = Math.floor(t / 60), s = (t % 60).toFixed(1); return `${m}:${s.padStart(4, '0')}`; }
function ordinal(n) { return ['1st', '2nd', '3rd'][n - 1] || n + 'th'; }
function hex(c) { return '#' + c.toString(16).padStart(6, '0'); }

function updatePlayerHUD(k, idx) {
  $('lap' + idx).textContent = GAME.event === 'drift' ? `剩余 ${Math.max(0,90-raceTime).toFixed(0)}s` : `LAP ${Math.min(k.lap + 1, CFG.LAPS)}/${CFG.LAPS}`;
  $('pos' + idx).textContent = GAME.event === 'race' ? `${ordinal(k.rank)} / 8` : GAME.event === 'time' ? 'TIME ATTACK' : `${Math.floor(k.driftScore)} PTS`;
  $('time' + idx).textContent = fmtTime(raceTime);
  const slot = $('item' + idx);
  if (k.item) { slot.textContent = ITEM_NAMES[k.item]; slot.classList.remove('empty'); } else { slot.textContent = '·'; slot.classList.add('empty'); }
  const boost = Math.max(k.boostTimer / 1.4, k.drifting ? k.driftCharge / 3 : 0);
  $('boost' + idx).style.width = (Math.min(1, boost) * 100) + '%';
}

function drawMinimap() {
  const W = minimap.width, H = minimap.height, pad = 14;
  const s = Math.min((W - pad * 2) / (bbMax.x - bbMin.x), (H - pad * 2) / (bbMax.z - bbMin.z));
  const ox = (W - (bbMax.x - bbMin.x) * s) / 2, oz = (H - (bbMax.z - bbMin.z) * s) / 2;
  const tx = x => ox + (x - bbMin.x) * s, tz = z => oz + (z - bbMin.z) * s;
  mctx.clearRect(0, 0, W, H);
  mctx.strokeStyle = 'rgba(255,255,255,0.85)'; mctx.lineWidth = 5; mctx.lineJoin = 'round'; mctx.beginPath();
  for (let i = 0; i <= N; i++) { const p = CL[i % N]; const X = tx(p.x), Z = tz(p.z); i ? mctx.lineTo(X, Z) : mctx.moveTo(X, Z); }
  mctx.stroke();
  const branch=world.course.routes.shortcut;if(branch){mctx.strokeStyle='#ffdc57';mctx.lineWidth=2;mctx.beginPath();branch.samples.forEach((f,i)=>i?mctx.lineTo(tx(f.pos.x),tz(f.pos.z)):mctx.moveTo(tx(f.pos.x),tz(f.pos.z)));mctx.stroke();}
  for (const k of karts.filter(k => k.mesh.visible)) {
    mctx.beginPath(); mctx.arc(tx(k.pos.x), tz(k.pos.z), isHuman(k) ? 5 : 3.5, 0, Math.PI * 2);
    mctx.fillStyle = hex(k.color); mctx.fill();
    if (isHuman(k)) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 2; mctx.stroke(); }
  }
}

/* ============================================================
   状态机
============================================================ */
let state = 'menu', raceTime = 0, cdTimer = 0, lastCd = 99, prevRaceState = null;
const cdEl = $('countdown'), cdNum = $('cdNum'), menuEl = $('menu'), resultsEl = $('results'), hudEl = $('hud'), splitterEl = $('splitter');
const pauseEl = $('pause'), pauseBtnEl = $('pauseBtn'), settingsEl = $('settings');
const toastEl = $('toast'); let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1200);
}

function resetKarts(){
  karts.forEach((k,i)=>{
    Object.assign(k,{speed:0,steer:0,steerTarget:0,throttle:0,brakeI:0,driftKey:false,driftCharge:0,drifting:false,boostTimer:0,item:null,stunTimer:0,lap:0,progress:0,finished:false,finishTime:0,_maxMul:1,_accelMul:1,lapTimes:[],lapStartTime:0,bestLap:Infinity,coins:0,driftScore:0,chain:0,combo:1,_itemDeb:false});
    resetDriver(k,world.course,-4-Math.floor(i/2)*6,i%2?3.5:-3.5);
    k.mesh.position.copy(k.pos);k.mesh.quaternion.copy(roadQuaternion(k.frame));
  });
}

function startGame() {
  SND.init();
  CFG.LAPS = GAME.event === 'time' ? 1 : SETTINGS.laps;
  assignControls();
  ensureTrack(); createItemBoxes(); resetKarts();
  for (const k of karts) { k.mesh.visible = GAME.event === 'race' || isHuman(k); if (!k.mesh.visible) k.pos.set(10000,0,10000); }
  if (GAME.event !== 'race') for (const b of itemBoxes) { b.active = false; b.respawn = 1e9; b.mesh.visible = false; }
  prepareRaceExtras();
  physicsAccumulator=0;
  cam1.userData.roll = cam2.userData.roll = 0; updateCamera(cam1, karts[0], 1); updateCamera(cam2, karts[1], 1);
  bananas.forEach(b => scene.remove(b.mesh)); bananas.length = 0;
  shells.forEach(s => scene.remove(s.mesh)); shells.length = 0;
  hudEl.classList.toggle('mode-2p', GAME.mode === '2p');
  splitterEl.style.display = GAME.mode === '2p' ? 'block' : 'none';
  state = 'countdown'; cdTimer = 3.4; lastCd = 99; raceTime = 0;
  menuEl.classList.add('hidden'); resultsEl.classList.add('hidden');
  pauseEl.classList.add('hidden'); settingsEl.classList.add('hidden');
  hudEl.classList.remove('hidden'); cdEl.classList.remove('hidden');
  pauseBtnEl.classList.remove('hidden');
  (document.activeElement && document.activeElement.blur) && document.activeElement.blur();
}

function endRace() {
  state = 'finished'; updateRanks();
  saveRaceProgress();
  const sorted = karts.filter(k => k.mesh.visible).sort((a, b) => a.rank - b.rank);
  const leader = sorted[0];

  // 领奖台 (前 3 名)
  const medals = ['🥇', '🥈', '🥉'];
  const order = [1, 0, 2]; // 视觉顺序: 2nd 1st 3rd
  $('podium').innerHTML = order.map(i => {
    const k = sorted[i]; if (!k) return '';
    const who = k.isPlayer ? '你 · P1' : k.isPlayer2 ? '你 · P2' : 'CPU ' + karts.indexOf(k);
    const cls = 'p' + (i + 1);
    return `<div class="spot ${cls}">
      <div class="medal">${medals[i]}</div>
      <div class="sw" style="background:${hex(k.color)}"></div>
      <div class="who">${who}</div>
      <div class="t">${k.finished ? fmtTime(k.finishTime) : 'DNF'}</div>
      <div class="best">最佳圈 ${k.bestLap !== Infinity ? fmtTime(k.bestLap) : '—'}</div>
    </div>`;
  }).join('');

  // 完整表格
  $('resultTable').innerHTML =
    `<thead><tr><th>名次</th><th>车手</th><th class="r">总用时</th><th class="r">最佳圈</th><th class="r">落后</th></tr></thead>` +
    `<tbody>${sorted.map(k => {
      const who = k.isPlayer ? '你 (P1)' : k.isPlayer2 ? '你 (P2)' : 'CPU ' + karts.indexOf(k);
      const total = k.finished ? fmtTime(k.finishTime) : 'DNF';
      const best = k.bestLap !== Infinity ? fmtTime(k.bestLap) : '—';
      const gap = (k.finished && k !== leader && leader.finished) ? '+' + fmtTime(k.finishTime - leader.finishTime) : '—';
      return `<tr class="${isHuman(k) ? 'you' : ''}">
        <td><span class="swatch" style="background:${hex(k.color)}"></span>${ordinal(k.rank)}</td>
        <td>${who}</td>
        <td class="r">${total}</td>
        <td class="r">${best}</td>
        <td class="r">${gap}</td>
      </tr>`;
    }).join('')}</tbody>`;

  const best = Math.min(...karts.filter(isHuman).map(k => k.rank));
  $('resultTitle').textContent = best === 1 ? '🏆 第一名!' : best <= 3 ? '🥈 上台领奖!' : '🏁 完成!';
  decorateResults();
  resultsEl.classList.remove('hidden'); hudEl.classList.add('hidden'); splitterEl.style.display = 'none';
  pauseBtnEl.classList.add('hidden');
}
function restart() {
  resultsEl.classList.add('hidden');
  pauseEl.classList.add('hidden'); settingsEl.classList.add('hidden');
  startGame();
}

/* ---------- 暂停 ---------- */
function togglePause() {
  if (state === 'racing' || state === 'countdown') {
    prevRaceState = state;
    state = 'paused';
    pauseEl.classList.remove('hidden');
    pauseBtnEl.classList.add('hidden');
    SND.engine(0, false);
    showToast('已暂停');
  } else if (state === 'paused') {
    resumeGame();
  }
}
function resumeGame() {
  pauseEl.classList.add('hidden');
  settingsEl.classList.add('hidden');
  state = prevRaceState || 'racing';
  pauseBtnEl.classList.remove('hidden');
  showToast('继续!');
}
function backToMenu() {
  state = 'menu';
  refreshRecord();
  pauseEl.classList.add('hidden');
  settingsEl.classList.add('hidden');
  resultsEl.classList.add('hidden');
  hudEl.classList.add('hidden');
  pauseBtnEl.classList.add('hidden');
  splitterEl.style.display = 'none';
  menuEl.classList.remove('hidden');
  SND.engine(0, false);
}

/* ---------- 设置 ---------- */
let settingsReturnTo = 'menu';  // 设置返回去哪里
function openSettings(returnTo) {
  settingsReturnTo = returnTo;
  syncSettingsUI();
  settingsEl.classList.remove('hidden');
}
function closeSettings() {
  settingsEl.classList.add('hidden');
}
function syncSettingsUI() {
  $('volMaster').value = Math.round(SETTINGS.master * 100);
  $('volMusic').value = Math.round(SETTINGS.music * 100);
  $('volSfx').value = Math.round(SETTINGS.sfx * 100);
  $('volMasterVal').textContent = $('volMaster').value;
  $('volMusicVal').textContent = $('volMusic').value;
  $('volSfxVal').textContent = $('volSfx').value;
  $('muteToggle').classList.toggle('on', SETTINGS.muted);
  $('motionToggle').checked=SETTINGS.reduceMotion;
  document.querySelectorAll('#lapsGroup .pill').forEach(p => p.classList.toggle('on', +p.dataset.laps === SETTINGS.laps));
  document.querySelectorAll('#lapsGroup .pill').forEach(p => {
    const locked = state !== 'menu';
    p.style.opacity = locked ? '0.4' : '';
    p.style.pointerEvents = locked ? 'none' : '';
  });
  $('lapsLock').classList.toggle('hidden', state === 'menu');
  document.querySelectorAll('#diffGroup .pill').forEach(p => p.classList.toggle('on', p.dataset.diff === SETTINGS.diff));
  document.querySelectorAll('#qualGroup .pill').forEach(p => p.classList.toggle('on', p.dataset.qual === SETTINGS.qual));
}
function syncMuteToggle() { $('muteToggle').classList.toggle('on', SETTINGS.muted); }

$('startBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', restart);
$('resultsMenuBtn').addEventListener('click', backToMenu);
$('pauseBtn').addEventListener('click', togglePause);
$('resumeBtn').addEventListener('click', resumeGame);
const club = createClub({ scene, karts, hudEl, $, decorGroup, N, perpAt, tangentAt, fmtTime, hex, isHuman, nearestSeg, SND, showToast, keys, togglePause, get state(){ return state; }, get raceTime(){ return raceTime; }, get clVec(){ return clVec; }, get course(){return world.course;}, reducedMotion });
const { clearGenerated, makePalm, makeBuilding, addTrackDetails, buildLobby, refreshTrackInfo, refreshRecord, prepareRaceExtras, updateRaceExtras, updateAtmosphere, saveRaceProgress, decorateResults } = club;

$('restartBtn').addEventListener('click', restart);
$('toMenuBtn').addEventListener('click', backToMenu);
$('pauseSettingsBtn').addEventListener('click', () => openSettings('pause'));
$('menuSettingsBtn').addEventListener('click', () => openSettings('menu'));
$('settingsBackBtn').addEventListener('click', () => {
  closeSettings();
  if (settingsReturnTo === 'pause') {
    // 仍停留在暂停界面
  } else {
    // 回到主菜单 (什么都不做, 因为菜单已经在底层)
  }
});

$('motionToggle').addEventListener('change',e=>{SETTINGS.reduceMotion=e.target.checked;saveSettings();});

// 玩家模式按钮
document.querySelectorAll('.segbtn[data-mode]').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.parentElement.querySelectorAll('.segbtn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    GAME.mode = btn.dataset.mode;
  });
});
buildLobby();
// 赛道按钮 (含主题色)
document.querySelectorAll('.trackBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.trackBtn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    GAME.track = +btn.dataset.track;
    if (state === 'menu') { buildTrack(GAME.track); resetKarts(); }
    refreshTrackInfo();
  });
});
// 音量滑块
function bindVolume(id, key) {
  $(id).addEventListener('input', e => {
    SETTINGS[key] = e.target.value / 100;
    $(id + 'Val').textContent = e.target.value;
    SND.applyVolumes();
    saveSettings();
  });
}
bindVolume('volMaster', 'master');
bindVolume('volMusic', 'music');
bindVolume('volSfx', 'sfx');
// 静音 toggle
$('muteToggle').addEventListener('click', () => {
  SETTINGS.muted = !SETTINGS.muted;
  SND.muted = SETTINGS.muted;
  SND.applyVolumes();
  syncMuteToggle();
  saveSettings();
  if (SND.eng) SND.eng.g.gain.setTargetAtTime(0, SND.ctx.currentTime, 0.05);
});
// 圈数 (比赛中锁定, 不可更改)
document.querySelectorAll('#lapsGroup .pill').forEach(p => {
  p.addEventListener('click', () => {
    if (state !== 'menu') { showToast('圈数只能在主菜单中修改'); return; }
    document.querySelectorAll('#lapsGroup .pill').forEach(b => b.classList.remove('on'));
    p.classList.add('on');
    SETTINGS.laps = +p.dataset.laps; refreshRecord();
    CFG.LAPS = SETTINGS.laps;
    saveSettings();
  });
});
// 难度
document.querySelectorAll('#diffGroup .pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('#diffGroup .pill').forEach(b => b.classList.remove('on'));
    p.classList.add('on');
    SETTINGS.diff = p.dataset.diff; refreshRecord();
    saveSettings();
    showToast('难度: ' + p.textContent);
  });
});
// 画质
document.querySelectorAll('#qualGroup .pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('#qualGroup .pill').forEach(b => b.classList.remove('on'));
    p.classList.add('on');
    SETTINGS.qual = p.dataset.qual;
    saveSettings();
    applyQuality();
    showToast('画质: ' + p.textContent + ' (已应用)');
  });
});

/* ============================================================
   渲染 (含分屏)
============================================================ */
function renderScene(dt) {
  if (state !== 'menu' && state !== 'finished') { const p=karts[0].pos;sun.position.set(p.x+45,p.y+85,p.z+35);sun.target.position.copy(p);sun.target.updateMatrixWorld(); }
  if (state === 'menu' || state === 'finished') {
    const t = reducedMotion() ? .35 : performance.now() * 0.0002;
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
    cam1.aspect = innerWidth / innerHeight;cam1.fov=62;cam1.updateProjectionMatrix();
    // 预览相机距离/高度随赛道尺寸缩放
    const cx = (bbMin.x + bbMax.x) / 2, cz = (bbMin.z + bbMax.z) / 2;
    const span = Math.max(bbMax.x - bbMin.x, bbMax.z - bbMin.z);
    const cd = span * 0.72, chh = span * 0.55;
    cam1.up.set(0,1,0);cam1.position.set(cx + Math.sin(t) * cd, chh, cz + Math.cos(t) * cd); cam1.lookAt(cx + span * 0.22, 0, cz);
    renderer.render(scene, cam1); return;
  }
  // 'racing' / 'countdown' / 'paused' - 暂停时不再更新相机,保持原视角
  const upd = state !== 'paused';
  if (GAME.mode === '2p') {
    const w = innerWidth, h = innerHeight, half = Math.floor(w / 2);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, half, h); renderer.setScissor(0, 0, half, h);
    cam1.aspect = half / h; cam1.updateProjectionMatrix(); if (upd) updateCamera(cam1, karts[0], dt);
    renderer.render(scene, cam1);
    renderer.setViewport(half, 0, w - half, h); renderer.setScissor(half, 0, w - half, h);
    cam2.aspect = (w - half) / h; cam2.updateProjectionMatrix(); if (upd) updateCamera(cam2, karts[1], dt);
    renderer.render(scene, cam2);
  } else {
    renderer.setScissorTest(false); renderer.setViewport(0, 0, innerWidth, innerHeight);
    cam1.aspect = innerWidth / innerHeight; cam1.updateProjectionMatrix();
    if (upd) updateCamera(cam1, karts[0], dt); renderer.render(scene, cam1);
  }
}

/* ============================================================
   主循环
============================================================ */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  updateSimulation(dt);
  renderScene(dt);
}

let physicsAccumulator=0;
function updateSimulation(dt){
  if(state==='paused')return;
  physicsAccumulator+=Math.min(dt,.25);
  while(physicsAccumulator+1e-9>=PHYSICS_STEP){simulateStep(PHYSICS_STEP);physicsAccumulator-=PHYSICS_STEP;}
}
function simulateStep(dt) {
  if (state === 'paused') return;

  if (state === 'countdown') {
    cdTimer -= dt;
    const n = Math.ceil(cdTimer - 0.4);
    if (n !== lastCd) { lastCd = n; if (n > 0) SND.beep(false); else SND.go(); }
    cdNum.textContent = n > 0 ? n : 'GO!';
    cdNum.style.color = n > 0 ? '#ffd23f' : '#5ce06b';
    if (cdTimer <= 0) { state = 'racing'; cdEl.classList.add('hidden'); }
  }

  if (state === 'racing' || state === 'countdown') {
    for (const k of karts) updateKart(k, dt);
    if (state === 'racing') { kartKartCollisions(); updateItems(dt); updateRanks(); raceTime += dt; updateRaceExtras(dt); }
    updatePlayerHUD(karts[0], 1);
    if (GAME.mode === '2p') updatePlayerHUD(karts[1], 2);
    drawMinimap();

    // 引擎声跟随 P1
    const p = karts[0];
    SND.engine(Math.min(1, Math.abs(p.speed) / CFG.maxSpeed), state === 'racing' && p.stunTimer <= 0);

    if (state === 'racing') {
      const humans = karts.filter(isHuman);
      if (humans.every(h => h.finished)) endRace();
    }
  } else {
    SND.engine(0, false);
  }

  updateAtmosphere(dt);
}

/* ============================================================
   初始化
============================================================ */
createKarts();
buildTrack(GAME.track);
resetKarts();refreshTrackInfo();
CFG.LAPS = SETTINGS.laps;
syncSettingsUI();
SND.muted = SETTINGS.muted;
$('loading').classList.add('hidden');

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  cam1.aspect = innerWidth / innerHeight; cam1.updateProjectionMatrix();
  cam2.aspect = innerWidth / innerHeight; cam2.updateProjectionMatrix();
});

animate();

export { GAME, CFG, SETTINGS, karts, state, raceTime, startGame, backToMenu, updateKart, updateRanks, world, scene, renderer, clVec, club, updateSimulation, keys, itemBoxes, bananas, shells, updateItems, kartKartCollisions, renderScene, updateCamera, cam1 };
