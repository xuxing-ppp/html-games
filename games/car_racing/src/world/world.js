import * as THREE from 'three';
import { CFG, GAME } from '../config.js';
import { THEMES, TRACKS } from './tracks.js';
import { M } from './kart.js';
import { buildCourse, sampleRoute, roadPoint, roadQuaternion, hasSurface } from './course.js';
export const N = 500;
export function createWorld({ scene, ground, sunDisc, makeClouds, trackGroup, decorGroup, clearGenerated, makePalm, makeBuilding, addTrackDetails }) {

const CL = [], clVec = [];
let bbMin = { x: Infinity, z: Infinity }, bbMax = { x: -Infinity, z: -Infinity };
let builtTrack = -1;
let course;
let currentTheme = THEMES.meadow;
const boostPads = [], slowPads = [];

function tangentAt(i) { return sampleRoute(course.main, ((i % N + N) % N) / N * course.length).forward; }
function perpAt(i) { return sampleRoute(course.main, ((i % N + N) % N) / N * course.length).right; }
function normalAt(i) { return sampleRoute(course.main, ((i % N + N) % N) / N * course.length).up; }
function terrainHeightAt(){return 0;}

function buildRibbon(inner, outer, color, height = .02, route = course.main) {
  const pos=[],idx=[];
  const count=Math.ceil(route.length/2);
  for(let i=0;i<=count;i++) {
    const f=sampleRoute(route,i/count*route.length);
    for(const lateral of [inner,outer])pos.push(...roadPoint(f,lateral,height).toArray());
    if(i<count && hasSurface(route,(i+.5)/count*route.length)) { const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3); }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide}));m.receiveShadow=true;return m;
}
function buildCurbs(offset,side) { return buildRibbon(offset,offset+side*.7,side>0?currentTheme.curbA:currentTheme.curbB,.06); }
function buildStructures() {
  const concrete=new THREE.MeshLambertMaterial({color:currentTheme.decor==='crystal'?0x353c70:0x8e8c83,flatShading:true});
  const rock=new THREE.MeshLambertMaterial({color:currentTheme.ground,flatShading:true});
  const arrowMat=new THREE.MeshBasicMaterial({color:0xffdc57,side:THREE.DoubleSide});
  const magnetMat=new THREE.MeshBasicMaterial({color:0x65e7ec});
  for(const route of Object.values(course.routes)) {
    if(route.id!=='main') {
      trackGroup.add(buildRibbon(-route.width,route.width,currentTheme.road,.02,route));
      trackGroup.add(buildRibbon(-route.width,-route.width+.35,0xffdc57,.07,route));
      trackGroup.add(buildRibbon(route.width-.35,route.width,0xffdc57,.07,route));
    }
    for(let s=12;s<route.length;s+=24) {
      const f=sampleRoute(route,s);if(!hasSurface(route,s)||f.up.y<.7)continue;
      const h=f.pos.y;
      if(h>4){
        const column=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.8,h,6),concrete);column.position.set(f.pos.x,h/2-1,f.pos.z);decorGroup.add(column);

      }
      // Low guard rails communicate the road boundary without hiding scenery.
      for(const side of [-1,1]){
        const rail=new THREE.Mesh(new THREE.BoxGeometry(.35,.65,9),concrete);rail.position.copy(roadPoint(f,side*(route.width+.6),.55));rail.quaternion.copy(roadQuaternion(f));trackGroup.add(rail);
      }
    }
    for(const jump of route.jumps) {
      for(let n=0;n<3;n++){
        const f=sampleRoute(route,jump.s-5-n*4),g=new THREE.Group();g.position.copy(roadPoint(f,0,.12));g.quaternion.copy(roadQuaternion(f));
        for(const side of [-1,1]){const bar=new THREE.Mesh(new THREE.BoxGeometry(4,.08,.7),arrowMat);bar.position.x=side*1.6;bar.rotation.y=side*.5;g.add(bar);}trackGroup.add(g);
      }
      const f=sampleRoute(route,jump.s+25);const landing=new THREE.Mesh(new THREE.BoxGeometry(route.width*1.8,.07,1.1),new THREE.MeshBasicMaterial({color:0xfff3c4}));landing.position.copy(roadPoint(f,0,.12));landing.quaternion.copy(roadQuaternion(f));trackGroup.add(landing);
    }
    if(route.magnet)for(let s=route.magnet.start;s<route.magnet.end;s+=7){const f=sampleRoute(route,s);for(const side of [-1,1]){const light=new THREE.Mesh(new THREE.BoxGeometry(.5,.12,3),magnetMat);light.position.copy(roadPoint(f,side*(route.width-.6),.12));light.quaternion.copy(roadQuaternion(f));trackGroup.add(light);}}
  }
  // Continuous earth banks support ground routes; flyovers keep open space
  // underneath so their lower deck remains visible and traversable.
  if(![6,9].includes(course.index)){
    const vertices=[];
    for(let s=0;s<course.length;s+=6){
      if(course.main.flyover&&s>course.main.flyover.start-40&&s<course.main.flyover.end+40)continue;
      const a=sampleRoute(course.main,s),b=sampleRoute(course.main,s+6);
      if(a.up.y<.7||!hasSurface(course.main,s))continue;
      for(const side of [-1,1]){
        const p=roadPoint(a,side*10,-.6),q=roadPoint(b,side*10,-.6),r=roadPoint(a,side*(26+a.pos.y*.35)),t=roadPoint(b,side*(26+b.pos.y*.35));r.y=-.2;t.y=-.2;
        for(const v of [p,q,r,r,q,t])vertices.push(...v.toArray());
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();const banks=new THREE.Mesh(geo,rock);decorGroup.add(banks);
  }
  const branch=course.routes.shortcut;
  if(branch){
    const f=sampleRoute(course.main,branch.entry-12),g=new THREE.Group();g.position.copy(roadPoint(f,branch.side*5,.15));g.quaternion.copy(roadQuaternion(f));
    const shape=new THREE.Shape();shape.moveTo(-1,-2);shape.lineTo(1,-2);shape.lineTo(1,0);shape.lineTo(3,0);shape.lineTo(0,3);shape.lineTo(-3,0);shape.lineTo(-1,0);shape.closePath();
    const arrow=new THREE.Mesh(new THREE.ShapeGeometry(shape),arrowMat);arrow.rotation.x=-Math.PI/2;arrow.rotation.z=branch.side*.6;g.add(arrow);trackGroup.add(g);
  }
}

function checkerTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  for (let x = 0; x < 8; x++) for (let y = 0; y < 2; y++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff'; ctx.fillRect(x * 32, y * 32, 32, 32); }
  return new THREE.CanvasTexture(c);
}

/* ---------- 装饰物工厂 ---------- */

function makeTree(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.9, 4, 6), new THREE.MeshLambertMaterial({ color: 0x7a4a22 }));
  trunk.position.y = 2; g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.ConeGeometry(4, 9, 7), new THREE.MeshLambertMaterial({ color: 0x2f8f3e }));
  leaves.position.y = 8; g.add(leaves);
  g.position.set(x, 0, z); g.scale.setScalar(0.8 + Math.random() * 0.8);
  return g;
}
function makePine(x, z) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3, 6), new THREE.MeshLambertMaterial({ color: 0x5a3a20 }));
  trunk.position.y = 1.5; g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(3.4 - i * 0.7, 4, 7),
      new THREE.MeshLambertMaterial({ color: 0x2a5a3a }));
    c.position.y = 3 + i * 2.2; g.add(c);
  }
  // 雪盖
  const snow = new THREE.Mesh(new THREE.ConeGeometry(2.0, 2.2, 7),
    new THREE.MeshLambertMaterial({ color: 0xffffff }));
  snow.position.y = 9.4; g.add(snow);
  g.position.set(x, 0, z); g.scale.setScalar(0.9 + Math.random() * 0.7);
  return g;
}
function makeCactus(x, z) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0x3a7a3a });
  const main = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6, 8), m);
  main.position.y = 3; g.add(main);
  // 双臂
  for (const sx of [-1, 1]) {
    if (Math.random() < 0.7) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 2.4, 6), m);
      arm.position.set(sx * 1.0, 3.5, 0); g.add(arm);
      const armUp = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 6), m);
      armUp.position.set(sx * 1.0, 5.0, 0); g.add(armUp);
    }
  }
  g.position.set(x, 0, z); g.scale.setScalar(0.8 + Math.random() * 0.6);
  g.rotation.y = Math.random() * Math.PI;
  return g;
}
function makeRock(x, z) {
  const g = new THREE.Group();
  const colors = [0x3a2018, 0x4a2820, 0x2a1810];
  for (let i = 0; i < 3 + (Math.random() * 3 | 0); i++) {
    const r = 0.8 + Math.random() * 2.4;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0),
      new THREE.MeshLambertMaterial({ color: colors[i % colors.length], flatShading: true }));
    m.position.set((Math.random() - 0.5) * 5, r * 0.5, (Math.random() - 0.5) * 5);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    g.add(m);
  }
  // 熔岩裂纹 (发光)
  if (currentTheme.lavaGlow && Math.random() < 0.6) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff6a22 }));
    glow.position.set((Math.random() - 0.5) * 3, 0.3, (Math.random() - 0.5) * 3);
    g.add(glow);
  }
  g.position.set(x, 0, z);
  return g;
}
function makeCrystal(x, z) {
  const g = new THREE.Group();
  const cols = [0x66ddff, 0xaa66ff, 0xff66dd, 0x66ffaa];
  for (let i = 0; i < 4 + (Math.random() * 4 | 0); i++) {
    const h = 1.5 + Math.random() * 4;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.5 + Math.random() * 0.6, h, 5),
      new THREE.MeshLambertMaterial({ color: cols[i % cols.length], emissive: cols[i % cols.length], emissiveIntensity: 0.4, flatShading: true }));
    c.position.set((Math.random() - 0.5) * 5, h / 2, (Math.random() - 0.5) * 5);
    c.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * 6, (Math.random() - 0.5) * 0.4);
    g.add(c);
  }
  g.position.set(x, 0, z);
  return g;
}
function makeDecor(theme, x, z) {
  if (theme.decor === 'palm') return makePalm(x, z);
  if (theme.decor === 'city') return makeBuilding(x, z);
  if (theme.decor === 'cactus') return makeCactus(x, z);
  if (theme.decor === 'pine') return makePine(x, z);
  if (theme.decor === 'rock') return makeRock(x, z);
  if (theme.decor === 'crystal') return makeCrystal(x, z);
  return makeTree(x, z);
}

// 草地小花 (点缀草地赛道)
function makeFlowerPatch(x, z) {
  const g = new THREE.Group();
  const cols = [0xff5252, 0xffd23f, 0xff8a3d, 0xff6fb5, 0xf5f5f5];
  for (let i = 0; i < 7; i++) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 4),
      new THREE.MeshLambertMaterial({ color: 0x3a7a3a }));
    stem.position.set((Math.random() - 0.5) * 4, 0.35, (Math.random() - 0.5) * 4);
    g.add(stem);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5),
      new THREE.MeshLambertMaterial({ color: cols[(Math.random() * cols.length) | 0] }));
    head.position.copy(stem.position); head.position.y = 0.75; g.add(head);
  }
  g.position.set(x, 0, z);
  return g;
}

// 主题地面特色: 水池(沙漠绿洲)/熔岩池(熔岩)/雪堆(雪原)/能量池(星际)
function makePond(x, z, theme) {
  const g = new THREE.Group();
  const r = 10 + Math.random() * 12;
  let waterCol, ringCol, glow = false;
  if (theme.decor === 'cactus') { waterCol = 0x2f7fd0; ringCol = 0xc8a868; }      // 绿洲水
  else if (theme.decor === 'rock') { waterCol = 0xff5a18; ringCol = 0x2a1008; glow = true; } // 熔岩
  else if (theme.decor === 'crystal') { waterCol = 0x33ccff; ringCol = 0x8844ff; glow = true; } // 能量
  else if (theme.decor === 'pine') { waterCol = 0x3a6a9a; ringCol = 0xeaf0f6; }     // 冰湖
  else { waterCol = 0x2f8fd0; ringCol = 0x6a8a3a; }                                  // 池塘
  const mat = glow
    ? new THREE.MeshBasicMaterial({ color: waterCol, transparent: true, opacity: 0.9 })
    : new THREE.MeshLambertMaterial({ color: waterCol, transparent: true, opacity: 0.85 });
  const water = new THREE.Mesh(new THREE.CircleGeometry(r, 20), mat);
  water.rotation.x = -Math.PI / 2; water.position.y = 0.04; g.add(water);
  const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.6, 20),
    new THREE.MeshLambertMaterial({ color: ringCol }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; g.add(ring);
  g.position.set(x, 0, z);
  return g;
}

// 放置主题地面特色 (水池/熔岩池等), 避开赛道
function placeThemeFeatures(theme) {
  const count = theme.decor === 'rock' ? 12 : theme.decor === 'crystal' ? 8 : 7;
  let placed = 0, tries = 0;
  while (placed < count && tries < 400) {
    tries++;
    const x = bbMin.x - 40 + Math.random() * (bbMax.x - bbMin.x + 80);
    const z = bbMin.z - 40 + Math.random() * (bbMax.z - bbMin.z + 80);
    let dmin = Infinity;
    for (let i = 0; i < N; i += 3) { const dx = x - CL[i].x, dz = z - CL[i].z; const d = dx * dx + dz * dz; if (d < dmin) dmin = d; }
    if (Math.sqrt(dmin) > CFG.ROAD_HALF + 28) {
      const f = makePond(x, z, theme);
      f.position.y = terrainHeightAt(x, z);
      decorGroup.add(f); placed++;
    }
  }
}

// 轮胎护栏 (放在赛道边的 y 上)
function makeTireBarrier(x, y, z, ry) {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
  for (let i = -2; i <= 2; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.32, 8, 12), m);
    t.position.set(i * 1.05, 0.55, 0);
    t.rotation.y = Math.PI / 2;
    g.add(t);
  }
  // 反光带 (红/白)
  for (let i = -2; i <= 2; i++) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.18),
      new THREE.MeshLambertMaterial({ color: i % 2 ? 0xd93333 : 0xf5f5f5 }));
    stripe.position.set(i * 1.05, 0.9, 0.32);
    g.add(stripe);
  }
  g.position.set(x, y, z); g.rotation.y = ry;
  return g;
}

// 看台
function makeGrandstand(x, z, ry) {
  const g = new THREE.Group();
  const frame = new THREE.MeshLambertMaterial({ color: 0x6a6a78 });
  const seatM = new THREE.MeshLambertMaterial({ color: 0x3a78d8 });
  // 顶
  const roof = M(new THREE.BoxGeometry(16, 0.6, 6), frame, 0, 8, 0);
  g.add(roof);
  for (let i = 0; i < 6; i++) {
    g.add(M(new THREE.BoxGeometry(16, 0.8, 1.5), seatM, 0, 1 + i * 1.0, -2 + i * 1.2));
  }
  // 柱
  for (const sx of [-7, 7]) for (const sz of [-2, 2]) {
    g.add(M(new THREE.BoxGeometry(0.5, 8, 0.5), frame, sx, 4, sz));
  }
  // 观众 (随机小色块)
  const people = [0xff5252, 0xffd23f, 0x5ce06b, 0xff8a3d, 0xff6fb5, 0xf5f5f5];
  for (let i = 0; i < 40; i++) {
    const p = M(new THREE.BoxGeometry(0.4, 0.6, 0.4),
      new THREE.MeshLambertMaterial({ color: people[(Math.random() * people.length) | 0] }),
      (Math.random() - 0.5) * 14, 1 + (Math.random() * 5 | 0) * 1.0 + 0.5, -2 + (Math.random() * 4 | 0) * 1.2);
    g.add(p);
  }
  g.position.set(x, 0, z); g.rotation.y = ry;
  return g;
}

// 起跑拱门
function makeStartGate() {
  const g = new THREE.Group();
  const pivot = new THREE.Object3D();
  pivot.position.copy(clVec[0]);
  pivot.quaternion.copy(roadQuaternion(sampleRoute(course.main,0)));
  // 棋盘线
  const m = new THREE.Mesh(new THREE.PlaneGeometry(CFG.ROAD_HALF * 2, 5), new THREE.MeshBasicMaterial({ map: checkerTexture() }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.05; pivot.add(m);
  // 拱柱
  const pillarM = new THREE.MeshLambertMaterial({ color: 0xff3b3b });
  for (const sx of [-CFG.ROAD_HALF - 0.5, CFG.ROAD_HALF + 0.5]) {
    const pillar = M(new THREE.BoxGeometry(1, 9, 1), pillarM, sx, 4.5, 0);
    pivot.add(pillar);
  }
  // 横梁
  const beam = M(new THREE.BoxGeometry(CFG.ROAD_HALF * 2 + 3, 2.4, 1),
    new THREE.MeshLambertMaterial({ color: 0xd93333 }), 0, 9.5, 0);
  pivot.add(beam);
  // "START" 字
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#d93333'; ctx.font = 'bold 96px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('起终点', 256, 64);
  const tex = new THREE.CanvasTexture(c);
  const sign = M(new THREE.PlaneGeometry(8, 2),
    new THREE.MeshBasicMaterial({ map: tex }), 0, 9.5, 0.55);
  pivot.add(sign);
  // 拱顶旗子
  const flagColors = [0xffd23f, 0x5ce06b, 0x4d9bff, 0xff5252];
  for (let i = 0; i < 6; i++) {
    const fx = -CFG.ROAD_HALF + i * (CFG.ROAD_HALF * 2 / 5);
    const flag = M(new THREE.BoxGeometry(1.4, 0.9, 0.06),
      new THREE.MeshLambertMaterial({ color: flagColors[i % flagColors.length] }), fx, 11.4, 0);
    pivot.add(flag);
  }
  g.add(pivot);
  return g;
}

// 加速带纹理 (橙色底 + 白色指向箭头)
function makeBoostPadTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#ff7a20'); grd.addColorStop(1, '#cc4a00');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  // 白色箭头 (朝下, 对应路面切线的前方)
  ctx.fillStyle = '#fff5d0';
  ctx.beginPath();
  ctx.moveTo(64, 118);  // 箭头尖端 (底)
  ctx.lineTo(105, 68);
  ctx.lineTo(90, 68);
  ctx.lineTo(90, 10);
  ctx.lineTo(38, 10);
  ctx.lineTo(38, 68);
  ctx.lineTo(23, 68);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

// Fit pad decals to the curved surface instead of intersecting a banked road.
function padPatch(texture,s,lateral){
  const frame=sampleRoute(course.main,s),base=roadPoint(frame,lateral,.12),inverse=roadQuaternion(frame).invert();
  const geo=new THREE.PlaneGeometry(7,7,4,8),position=geo.attributes.position;
  for(let i=0;i<position.count;i++){
    const point=roadPoint(sampleRoute(course.main,s-position.getY(i)),lateral+position.getX(i),.14).sub(base).applyQuaternion(inverse);
    position.setXYZ(i,point.x,point.y,point.z);
  }
  position.needsUpdate=true;geo.computeVertexNormals();
  return new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide}));
}

// 加速带 (与减速带统一风格: 7×7 贴面 + 圆环边框)
function placeBoostPads() {
  for (const b of boostPads) { scene.remove(b.mesh); clearGenerated(b.mesh); }
  boostPads.length = 0;
  const slots = [55, 115, 175, 230, 285, 340, 395, 450];
  const tex = makeBoostPadTexture();
  for (const idx of slots) {
    const p = clVec[idx], n = perpAt(idx), t = tangentAt(idx);
    const ry = Math.atan2(t.x, t.z);
    const rx = -Math.atan2(t.y, Math.sqrt(t.x * t.x + t.z * t.z));
    const latOff = ((idx * 7 + GAME.track * 13) % 5 - 2) * 2.25;
    const padX = p.x + n.x * latOff, padZ = p.z + n.z * latOff;

    const grp = new THREE.Group();
    // 贴面
    const patch=padPatch(tex,idx/N*course.length,latOff);
    grp.add(patch);


    const f=sampleRoute(course.main,idx/N*course.length);
    grp.position.copy(roadPoint(f,latOff,.12));grp.quaternion.copy(roadQuaternion(f));
    scene.add(grp);
    boostPads.push({ mesh: grp, x: padX, z: padZ, routeId: 'main', s: idx/N*course.length });
  }
}

// 减速带 (蓝色贴面 + 白色 X) — 踩到持续减速
function makeSlowPadTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grd = ctx.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, '#3a78d8'); grd.addColorStop(1, '#1a4a9a');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#e8f0ff'; ctx.lineWidth = 14; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(24, 24); ctx.lineTo(104, 104);
  ctx.moveTo(104, 24); ctx.lineTo(24, 104);
  ctx.stroke();
  return new THREE.CanvasTexture(c);
}
function placeSlowPads() {
  for (const b of slowPads) { scene.remove(b.mesh); clearGenerated(b.mesh); }
  slowPads.length = 0;
  const slots = [85, 145, 205, 260, 320, 375, 430];
  const tex = makeSlowPadTexture();
  for (const idx of slots) {
    if(course.main.jumps.some(j=>Math.abs(j.s-idx/N*course.length)<65))continue;
    const p = clVec[idx], n = perpAt(idx), t = tangentAt(idx);
    const ry = Math.atan2(t.x, t.z);
    const rx = -Math.atan2(t.y, Math.sqrt(t.x * t.x + t.z * t.z));
    const latOff = ((idx * 11 + GAME.track * 7) % 5 - 1) * 3.5;
    const padX = p.x + n.x * latOff, padZ = p.z + n.z * latOff;
    const grp = new THREE.Group();
    const patch=padPatch(tex,idx/N*course.length,latOff);
    grp.add(patch);

    const f=sampleRoute(course.main,idx/N*course.length);
    grp.position.copy(roadPoint(f,latOff,.12));grp.quaternion.copy(roadQuaternion(f));
    scene.add(grp);
    slowPads.push({ mesh: grp, x: padX, z: padZ, routeId: 'main', s: idx/N*course.length, _snd: 0 });
  }
}

// Build the 3D course and its theme-specific surroundings.
function buildTrack(idx) {
  clearGenerated(trackGroup); clearGenerated(decorGroup);

  const trackDef = TRACKS[idx];
  currentTheme = THEMES[trackDef.theme];

  // 应用主题色
  scene.background = new THREE.Color(currentTheme.sky);
  scene.fog = new THREE.Fog(currentTheme.fog, currentTheme.fogNear, currentTheme.fogFar);
  ground.material.color.setHex(currentTheme.ground);
  sunDisc.material.color.setHex(currentTheme.sun);
  scene.traverse(o => {
    if (o.isHemisphereLight) { o.color.setHex(currentTheme.hemiSky); o.groundColor.setHex(currentTheme.hemiGround); }
  });
  if (currentTheme.cloudOn) makeClouds(currentTheme.cloudCount, currentTheme.cloudColor);
  else makeClouds(0);
  if (currentTheme.stars) {
    const points=[];
    for(let i=0;i<700;i++) {const a=Math.random()*Math.PI*2,r=900,y=Math.random()*500+80;points.push(Math.sin(a)*r,y,Math.cos(a)*r);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));
    const stars=new THREE.Points(geo,new THREE.PointsMaterial({color:0xffffff,size:1.8,fog:false}));stars.name='stars';decorGroup.add(stars);
  }

  course = buildCourse(trackDef,idx);
  CL.length = 0; clVec.length = 0;
  for(let i=0;i<N;i++){ const p=sampleRoute(course.main,i/N*course.length).pos;CL.push({x:p.x,y:p.y,z:p.z});clVec.push(p); }
  Object.assign(bbMin, { x: Infinity, z: Infinity }); Object.assign(bbMax, { x: -Infinity, z: -Infinity });
  for (const p of CL) { bbMin.x = Math.min(bbMin.x, p.x); bbMin.z = Math.min(bbMin.z, p.z); bbMax.x = Math.max(bbMax.x, p.x); bbMax.z = Math.max(bbMax.z, p.z); }

  // Raised roads are supported by continuous banks or open bridge columns.
  buildStructures();

  // 路面 + 路缘
  trackGroup.add(buildRibbon(-CFG.ROAD_HALF - 1.2, CFG.ROAD_HALF + 1.2, 0x2a2a30, -0.7));
  trackGroup.add(buildRibbon(-CFG.ROAD_HALF, CFG.ROAD_HALF, currentTheme.road, 0.02));
  trackGroup.add(buildCurbs(CFG.ROAD_HALF, +1));
  trackGroup.add(buildCurbs(-CFG.ROAD_HALF, -1));
  trackGroup.add(buildRibbon(CFG.ROAD_HALF + 1.2, CFG.ROAD_HALF + 2.0, 0xf2f2f2, 0.03));
  trackGroup.add(buildRibbon(-CFG.ROAD_HALF - 2.0, -CFG.ROAD_HALF - 1.2, 0xf2f2f2, 0.03));

  // 中心虚线
  for (let i = 0; i < N; i += 14) {
    const p = clVec[i], t = tangentAt(i);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 2.4), new THREE.MeshLambertMaterial({ color: 0xffe14a }));
    const f=sampleRoute(course.main,i/N*course.length);dash.position.copy(roadPoint(f,0,.08));dash.quaternion.copy(roadQuaternion(f)); trackGroup.add(dash);
  }

  // 起跑拱门
  trackGroup.add(makeStartGate());

  // 加速带 + 减速带
  placeBoostPads();
  placeSlowPads();

  // 远景山脉
  {
    const cx = (bbMin.x + bbMax.x) / 2, cz = (bbMin.z + bbMax.z) / 2;
    const range = Math.max(bbMax.x - bbMin.x, bbMax.z - bbMin.z);
    const dist = range * 0.9 + 200;
    const mtnColor = currentTheme.decor === 'pine' ? 0x6a7a90 : currentTheme.decor === 'rock' ? 0x3a1a10 : currentTheme.decor === 'crystal' ? 0x2a3060 : 0x4a6a3a;
    const mtnMat = new THREE.MeshLambertMaterial({ color: mtnColor, flatShading: true });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = dist + Math.random() * 200;
      const mx = cx + Math.cos(a) * r, mz = cz + Math.sin(a) * r;
      const h = 60 + Math.random() * 120;
      const mtn = new THREE.Mesh(new THREE.ConeGeometry(40 + Math.random() * 50, h, 5), mtnMat);
      mtn.position.set(mx, h / 2 - 2, mz); mtn.rotation.y = Math.random() * 6;
      decorGroup.add(mtn);
    }
  }

  // 看台 (起点两侧, 跟随起跑点高度)
  {
    const p = clVec[0], n = perpAt(0);
    const dist = CFG.ROAD_HALF + 8;
    const baseY = p.y;
    const gs1 = makeGrandstand(p.x + n.x * dist, p.z + n.z * dist, Math.atan2(tangentAt(0).x, tangentAt(0).z));
    gs1.position.y = baseY; decorGroup.add(gs1);
    const gs2 = makeGrandstand(p.x - n.x * dist, p.z - n.z * dist, Math.atan2(tangentAt(0).x, tangentAt(0).z) + Math.PI);
    gs2.position.y = baseY; decorGroup.add(gs2);
  }

  // 路边装饰物 (跟随地形高度, 带森林簇 + 草地小花)
  const farFromRoad = (x, z, pad) => {
    let dmin = Infinity;
    for (let i = 0; i < N; i += 3) { const dx = x - CL[i].x, dz = z - CL[i].z; const d = dx * dx + dz * dz; if (d < dmin) dmin = d; }
    return Math.sqrt(dmin) > CFG.ROAD_HALF + pad;
  };
  const putDecor = (x, z) => {
    const dec = makeDecor(currentTheme, x, z);
    dec.position.y = terrainHeightAt(x, z);
    decorGroup.add(dec);
  };
  let placed = 0, tries = 0;
  const target = currentTheme.decor === 'city' ? 65 : GAME.track >= 8 ? 145 : 260;
  while (placed < target && tries < 9000) {
    tries++;
    // 1/3 概率放一簇 (森林感)
    const cx = bbMin.x - 60 + Math.random() * (bbMax.x - bbMin.x + 120);
    const cz = bbMin.z - 60 + Math.random() * (bbMax.z - bbMin.z + 120);
    if (!farFromRoad(cx, cz, 16)) continue;
    if (Math.random() < 0.35) {
      const n = 3 + (Math.random() * 4 | 0);
      for (let k = 0; k < n; k++) {
        const x = cx + (Math.random() - 0.5) * 26, z = cz + (Math.random() - 0.5) * 26;
        if (farFromRoad(x, z, 14)) { putDecor(x, z); placed++; }
      }
    } else {
      putDecor(cx, cz); placed++;
    }
  }
  // 草地赛道撒一些小花
  if (currentTheme.decor === 'tree') {
    for (let i = 0; i < 60; i++) {
      const x = bbMin.x - 40 + Math.random() * (bbMax.x - bbMin.x + 80);
      const z = bbMin.z - 40 + Math.random() * (bbMax.z - bbMin.z + 80);
      if (farFromRoad(x, z, 12)) {
        const f = makeFlowerPatch(x, z); f.position.y = terrainHeightAt(x, z); decorGroup.add(f);
      }
    }
  }
  // 主题地面特色 (水池/熔岩池/能量池/冰湖)
  placeThemeFeatures(currentTheme);

  addTrackDetails(trackDef);
  batchStaticGeometry(trackGroup);batchStaticGeometry(decorGroup);
  builtTrack = idx;
}

// Bake static opaque scenery by material. Racing adds many supports and rails;
// submitting each as a draw call is especially costly in two-player views.
function batchStaticGeometry(group){
  group.updateMatrixWorld(true);const buckets=new Map();
  group.traverse(mesh=>{
    const m=mesh.material;
    if(!mesh.isMesh||mesh.isInstancedMesh||mesh.children.length||!m||Array.isArray(m)||m.map||m.transparent||m.vertexColors)return;
    const key=[m.type,m.color?.getHex(),m.emissive?.getHex(),m.roughness,m.metalness,m.flatShading,m.side,mesh.castShadow,mesh.receiveShadow].join(':');
    if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(mesh);
  });
  const disposed=new Set();
  for(const meshes of buckets.values()){
    if(meshes.length<2)continue;
    const positions=[],normals=[],material=meshes[0].material;
    for(const mesh of meshes){
      let geo=mesh.geometry.index?mesh.geometry.toNonIndexed():mesh.geometry.clone();geo.applyMatrix4(mesh.matrixWorld);if(!geo.attributes.normal)geo.computeVertexNormals();
      positions.push(...geo.attributes.position.array);normals.push(...geo.attributes.normal.array);geo.dispose();
      mesh.removeFromParent();if(!disposed.has(mesh.geometry)){mesh.geometry.dispose();disposed.add(mesh.geometry);}
      if(mesh.material!==material&&!disposed.has(mesh.material)){mesh.material.dispose();disposed.add(mesh.material);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geo.computeBoundingSphere();
    const mesh=new THREE.Mesh(geo,material);mesh.castShadow=meshes[0].castShadow;mesh.receiveShadow=meshes[0].receiveShadow;group.add(mesh);
  }
}

function ensureTrack() { if (builtTrack !== GAME.track) buildTrack(GAME.track); }

return { CL, clVec, bbMin, bbMax, boostPads, slowPads, tangentAt, perpAt, normalAt, buildTrack, ensureTrack, get course(){return course;} };
}
