import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.module.js';
import { TRACKS } from '../src/world/tracks.js';
import { CFG } from '../src/config.js';
import { buildCourse,sampleRoute,projectRoute,roadPoint,routeProgress,wrap } from '../src/world/course.js';
import {resetDriver,stepDriver,rescueDriver,PHYSICS_STEP as dt} from '../src/world/driving.js';
const courses=TRACKS.map(buildCourse);
const make=(c,s=0,lateral=0)=>{const k={pos:new THREE.Vector3(),speed:0,steer:0,stunTimer:0,boostTimer:0,driftScore:0,lap:0,chain:0,combo:1};resetDriver(k,c,s,lateral);return k;};
const drive=(k,c,input,n=1,opts={})=>{for(let i=0;i<n;i++)stepDriver(k,c,input,dt,{CFG,...opts});};
function autopilot(k,c){const r=c.routes[k.routeId],f=sampleRoute(r,k.roadS),look=sampleRoute(r,k.roadS+18),bend=Math.atan2(f.forward.clone().cross(look.forward).dot(f.up),f.forward.dot(look.forward))/18;
 const steer=THREE.MathUtils.clamp((Math.atan2(k.lateral,16)-k.yaw)*3-bend*k.speed/CFG.turnRate,-1,1),top=Math.max(22,Math.min(58,Math.sqrt(35/Math.max(.01,Math.abs(bend)))));
 return {steer,throttle:k.speed<top?1:0,brake:k.speed>top+5?1:0,drift:k.motion==='airborne'?k.airTime>.1&&k.airTime<.2:Math.abs(bend)>.012};}
for(const [index,c] of courses.entries()){
 test(`${TRACKS[index].name}: 3D road frames, closed seam and height variation`,()=>{
  const ys=c.main.samples.map(f=>f.pos.y);assert.ok(Math.max(...ys)-Math.min(...ys)>9);
  for(const route of Object.values(c.routes))for(const f of route.samples){
   for(const v of [f.pos,f.forward,f.right,f.up])assert.ok(v.toArray().every(Number.isFinite));
   for(const v of [f.forward,f.right,f.up])assert.ok(Math.abs(v.length()-1)<1e-6,`${route.id} invalid basis`);
   assert.ok(Math.abs(f.forward.dot(f.up))<1e-6);
  }
  assert.ok(sampleRoute(c.main,0).pos.distanceTo(sampleRoute(c.main,c.length).pos)<1e-6);
  for(let i=1;i<c.main.samples.length;i++)assert.ok(c.main.samples[i].up.dot(c.main.samples[i-1].up)>.8,'surface frame should not flip');
 });
 test(`${TRACKS[index].name}: shared driving rules complete a lap with all jumps`,()=>{
  const k=make(c);for(let i=0;i<120*240&&k.lap<1;i++)drive(k,c,autopilot(k,c));
  assert.equal(k.lap,1);assert.equal(k.rescues,0);assert.equal(k.landingCount,c.main.jumps.length);assert.ok(k.trickCount>=1&&k.trickCount<=k.landingCount);
 });
 if(c.routes.shortcut)test(`${TRACKS[index].name}: shortcut joins and monotonic equivalent progress`,()=>{
  const r=c.routes.shortcut;assert.ok(r.length<r.exit-r.entry);assert.ok(sampleRoute(r,0).pos.distanceTo(sampleRoute(c.main,r.entry).pos)<1e-6);assert.ok(sampleRoute(r,r.length).pos.distanceTo(sampleRoute(c.main,r.exit).pos)<1e-6);
  assert.equal(routeProgress(c,'shortcut',r.length/2),(r.entry+r.exit)/2);
 });
}
test('Vertical loop supports low-speed entry without a mode key or minimum speed',()=>{
 const c=courses[6],k=make(c,c.main.magnet.start);k.speed=2;
 let inverted=false;
 for(let i=0;i<120*35&&k.roadS<c.main.magnet.end+5;i++){drive(k,c,{steer:0,throttle:1,drift:false,brake:0},1,{car:{speed:1.12,accel:.84,grip:.9}});inverted ||= k.frame.up.y<-.9;}
 assert.ok(inverted);assert.ok(k.roadS>c.main.magnet.end);assert.equal(k.motion,'grounded');assert.equal(k.rescues,0);
});
test('Slope adds or removes speed beyond the engine target',()=>{
 const c=courses[0],up=c.main.samples.find(f=>f.forward.y>.025),down=c.main.samples.find(f=>f.forward.y<-.025);
 const a=make(c,up.s),b=make(c,down.s);a.speed=b.speed=CFG.maxSpeed;
 drive(a,c,{throttle:1,steer:0,drift:false},1);drive(b,c,{throttle:1,steer:0,drift:false},1);
 assert.ok(a.speed<CFG.maxSpeed);assert.ok(b.speed>CFG.maxSpeed);
});
test('Trick requires a fresh airborne press, lands once, and does not repeat scoring',()=>{
 const c=courses[0],j=c.main.jumps[0],k=make(c,j.s-1);k.speed=50;
 drive(k,c,{throttle:1,steer:0,drift:true},10);assert.equal(k.motion,'airborne');assert.equal(k.trick,false);
 drive(k,c,{throttle:1,steer:0,drift:true},10);assert.equal(k.trick,false);
 drive(k,c,{steer:0,drift:false});drive(k,c,{steer:0,drift:true});assert.equal(k.trick,true);
 for(let n=0;n<240&&k.motion==='airborne';n++)drive(k,c,{steer:0,throttle:1,drift:false});
 assert.equal(k.landingCount,1);assert.equal(k.trickCount,1);const points=k.driftScore;assert.ok(points>=180);drive(k,c,{steer:0,throttle:1},30);assert.equal(k.driftScore,points);
});
test('Air steering adjusts landing laterally without grounded turning',()=>{
 const c=courses[0],j=c.main.jumps[0],a=make(c,j.s-1),b=make(c,j.s-1);a.speed=b.speed=45;
 drive(a,c,{steer:0,throttle:1},10);drive(b,c,{steer:0,throttle:1},10);
 drive(a,c,{steer:-1},40);drive(b,c,{steer:1},40);assert.ok(a.lateral>b.lateral);assert.ok(Math.abs(a.lateral-b.lateral)<10);
});
test('Rescue retains route, rewinds to safety and cannot grant checkpoints',()=>{
 const c=courses[8],r=c.routes.shortcut,k=make(c);k.routeId='shortcut';k.roadS=r.length*.5;k.lastSafe={routeId:'shortcut',s:r.length*.25,lateral:1};k.checkpoint=2;k.trick=true;k.boostTimer=2;
 rescueDriver(k);assert.equal(k.trick,false);assert.equal(k.boostTimer,0);drive(k,c,{steer:0},130);assert.equal(k.routeId,'shortcut');assert.equal(k.checkpoint,2);assert.ok(k.roadS<r.length*.5);
});
test('Local 3D projection keeps a route at the correct overpass deck',()=>{
 const c=courses[2],r=c.main;for(let i=0;i<r.samples.length;i+=9){const f=r.samples[i],near=projectRoute(r,roadPoint(f,2,.1),f.s,35);assert.ok(Math.abs(wrap(near.s-f.s+c.length/2,c.length)-c.length/2)<4);}
});
test('Reverse crossing the start cannot finish a lap',()=>{
 const c=courses[0],k=make(c,2);k.speed=-10;k.checkpoint=4;drive(k,c,{steer:0},60);assert.equal(k.lap,0);
});

for(const [index,c] of courses.entries())if(c.routes.shortcut)test(`${TRACKS[index].name}: lane entry, shortcut driving and legal merge`,()=>{
 const b=c.routes.shortcut,k=make(c,b.entry-140);let entered=false,merged=false;
 for(let i=0;i<120*25&&!merged;i++){
  const input=autopilot(k,c),target=k.routeId==='main'&&b.entry-k.roadS>0&&b.entry-k.roadS<80?b.side*4.1:0;
  const f=sampleRoute(c.routes[k.routeId],k.roadS),look=sampleRoute(c.routes[k.routeId],k.roadS+18),bend=Math.atan2(f.forward.clone().cross(look.forward).dot(f.up),f.forward.dot(look.forward))/18;
  input.steer=THREE.MathUtils.clamp((Math.atan2(k.lateral-target,16)-k.yaw)*3-bend*k.speed/CFG.turnRate,-1,1);
  drive(k,c,input);if(k.routeId==='shortcut')entered=true;else if(entered)merged=true;
 }
 assert.ok(entered&&merged);assert.equal(k.rescues,0);assert.equal(k.motion,'grounded','merging must not trigger a main-road jump already bypassed');
 assert.ok(Math.abs(k.roadS-b.exit)<2);
});
test('Overpass crossings have physical clearance',()=>{
 for(const i of [2,7,9]){const r=courses[i].main,a=r.samples;let count=0;
  for(let j=0;j<a.length;j++)for(let k=j+10;k<a.length;k++){
   const p=a[j].pos,q=a[(j+1)%a.length].pos,b=a[k].pos,d=a[(k+1)%a.length].pos;
   const dx=q.x-p.x,dz=q.z-p.z,ex=d.x-b.x,ez=d.z-b.z,den=dx*ez-dz*ex;if(Math.abs(den)<1e-7)continue;
   const t=((b.x-p.x)*ez-(b.z-p.z)*ex)/den,u=((b.x-p.x)*dz-(b.z-p.z)*dx)/den;
   if(t>0&&t<1&&u>0&&u<1){count++;assert.ok(Math.abs(p.y+(q.y-p.y)*t-b.y-(d.y-b.y)*u)>8,`course ${i} lacks deck clearance`);}
  }
  assert.ok(count>0,`course ${i} needs a real overpass`);
 }
});
