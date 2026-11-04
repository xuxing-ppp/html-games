import * as THREE from '../../lib/three.module.js';
import { buildLine } from './geometry.js';

const TAU = Math.PI * 2, UP = new THREE.Vector3(0, 1, 0);
export const wrap = (s, length) => ((s % length) + length) % length;
const smooth = x => { x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };
const V = (x,y,z) => new THREE.Vector3(x,y,z);

// Dense, arc-length indexed roads. Each sample carries an explicit surface frame;
// an upright-world Frenet frame cannot represent the top of a vertical loop.
function makeRoute(id, points, rights, closed, width = 8.5) {
  const samples = [], lengths = [0];
  for (let i=1;i<points.length;i++) lengths.push(lengths[i-1]+points[i].distanceTo(points[i-1]));
  if (closed) lengths.push(lengths.at(-1)+points.at(-1).distanceTo(points[0]));
  for (let i=0;i<points.length;i++) {
    const a=points[Math.max(0,i-1)], b=points[Math.min(points.length-1,i+1)];
    const forward = closed ? points[(i+1)%points.length].clone().sub(points[(i-1+points.length)%points.length]).normalize() : b.clone().sub(a).normalize();
    let right=rights[i].clone().addScaledVector(forward,-rights[i].dot(forward)).normalize();
    const up=forward.clone().cross(right).normalize();
    samples.push({pos:points[i],forward,right,up,s:lengths[i]});
  }
  return {id,samples,length:lengths.at(-1),closed,width,jumps:[],gaps:[]};
}
export function sampleRoute(route, distance) {
  const s=route.closed?wrap(distance,route.length):Math.max(0,Math.min(route.length,distance));
  const a=route.samples;
  let lo=0,hi=a.length-1;
  while(lo<hi){const m=(lo+hi+1)>>1;if(a[m].s<=s)lo=m;else hi=m-1;}
  const p=a[lo],q=a[(lo+1)%a.length]||p;
  const end=lo===a.length-1?route.length:q.s, f=end>p.s?(s-p.s)/(end-p.s):0;
  const forward=p.forward.clone().lerp(q.forward,f).normalize();
  const right=p.right.clone().lerp(q.right,f);right.addScaledVector(forward,-right.dot(forward)).normalize();
  return {pos:p.pos.clone().lerp(q.pos,route.closed||lo<a.length-1?f:0),forward,right,up:forward.clone().cross(right).normalize(),s,width:route.width,route:route.id};
}
export function roadPoint(frame, lateral=0, height=0){return frame.pos.clone().addScaledVector(frame.right,lateral).addScaledVector(frame.up,height);}
export function roadQuaternion(frame,yaw=0){
  const forward=frame.forward.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(frame.right,Math.sin(yaw));
  const right=frame.up.clone().cross(forward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right,frame.up,forward));
}
export function projectRoute(route,pos,hint,window=85){
  let best=null,dist=Infinity;
  for(let i=0;i<route.samples.length-(route.closed?0:1);i++){
    const a=route.samples[i], b=route.samples[(i+1)%route.samples.length];
    const delta=route.closed?Math.abs(wrap(a.s-hint+route.length/2,route.length)-route.length/2):Math.abs(a.s-hint);
    if(hint!==undefined&&delta>window)continue;
    const edge=b.pos.clone().sub(a.pos),f=Math.max(0,Math.min(1,pos.clone().sub(a.pos).dot(edge)/edge.lengthSq()));
    const p=a.pos.clone().addScaledVector(edge,f),d=p.distanceToSquared(pos);
    if(d<dist){dist=d;best={s:a.s+edge.length()*f};}
  }
  const frame=sampleRoute(route,best?.s??hint??0),delta=pos.clone().sub(frame.pos);
  return {...frame,lateral:delta.dot(frame.right),height:delta.dot(frame.up),distance:Math.sqrt(dist)};
}
export function routeProgress(course,routeId,s){
  const r=course.routes[routeId];
  return routeId==='main'?wrap(s,r.length):r.entry+(Math.max(0,Math.min(1,s/r.length)))*(r.exit-r.entry);
}
export function hasSurface(route,s){return !route.gaps.some(g=>s>=g.start&&s<g.end);}

export function buildCourse(def,index=0){
  const curve=new THREE.CatmullRomCurve3(buildLine(def.verts,Math.max(def.R,index<8?48:38)).map(p=>V(p[0],0,p[1])),true,'centripetal');
  curve.arcLengthDivisions=6000;curve.updateArcLengths();
  const base=curve.getSpacedPoints(1600).slice(0,-1).map(p=>[p.x,p.z]);
  const bankWindow=Math.max(5,Math.ceil(14/(curve.getLength()/1600)));
  const amplitude=[12,18,42,26,32,38,28,40,29,36,48,52][index];
  const waves=[2,4,1,3,2,3,2,3,2,2,2,3][index];
  const points=[],rights=[];
  // Find a long straight for the loop so both joins have the same tangent.
  let loopStart=-1,loopEnd=-1, loopRight,loopForward,loopOrigin;
  if([2,6,7,9].includes(index)){
    let best=0;
    for(let i=90;i<1400;i++){
      const a=base[i],b=base[i+65],c=base[i+32];const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
      const deviation=Math.abs((c[0]-a[0])*(b[1]-a[1])-(c[1]-a[1])*(b[0]-a[0]))/len;
      if(deviation<.4&&len>best){best=len;loopStart=i;loopEnd=i+65;}
    }
    if(loopStart<0)throw new Error('Vertical loop needs a straight entry');
    const a=base[loopStart],b=base[loopEnd];loopForward=V(b[0]-a[0],0,b[1]-a[1]).normalize();loopRight=V(loopForward.z,0,-loopForward.x);loopOrigin=V(a[0],0,a[1]);
  }
  const elevation = t => 8+amplitude*(.5-.5*Math.cos(TAU*waves*t))*smooth(t/.035)*smooth((1-t)/.035);
  const bankAmount=[.16,.23,.32,.22,.36,.28,.2,.27,.26,.44,.52,.3][index];
  let loopRange=null,flyoverRange=null;
  for(let i=0;i<1600;i++){
    if(i===loopStart&&index!==6){
      const length=Math.hypot(base[loopEnd][0]-base[i][0],base[loopEnd][1]-base[i][1]);
      const radius=Math.min(76,length*.48),height=elevation(i/1600),turns=index===2?2:1;
      const first=points.length;
      for(let j=0;j<360;j++){
        const u=j/360,angle=TAU*turns*u;
        const side=radius*(1-Math.cos(angle));
        const ahead=length*u+radius*Math.sin(angle);
        const rise=(index===2?48:index===7?60:68)*(smooth(u/.64)-smooth((u-.73)/.27));
        const p=loopOrigin.clone().addScaledVector(loopForward,ahead).addScaledVector(loopRight,side);p.y=height+rise+(elevation(loopEnd/1600)-height)*smooth(u);
        const f=loopForward.clone().multiplyScalar(length+radius*TAU*turns*Math.cos(angle)).addScaledVector(loopRight,radius*TAU*turns*Math.sin(angle)).normalize();
        const right=V(f.z,0,-f.x).applyAxisAngle(f,.18);
        points.push(p);rights.push(right);
      }
      flyoverRange={first,last:points.length-1};i=loopEnd-1;continue;
    }
    if(i===loopStart){
      const length=Math.hypot(base[loopEnd][0]-base[i][0],base[loopEnd][1]-base[i][1]);
      const radius=Math.max(38,length*.42),height=elevation(i/1600);
      const first=points.length;
      for(let j=0;j<320;j++){
        const u=j/320,angle=TAU*u;
        const p=loopOrigin.clone().addScaledVector(loopForward,length*u+radius*Math.sin(angle));p.y=height+radius*(1-Math.cos(angle))+(elevation(loopEnd/1600)-height)*smooth(u);
        points.push(p);rights.push(loopRight.clone());
      }
      loopRange={first,last:points.length-1};i=loopEnd-1;continue;
    }
    const p=base[i],a=base[(i-bankWindow+1600)%1600],b=base[(i+bankWindow)%1600];
    const forward=V(b[0]-a[0],0,b[1]-a[1]).normalize(),right=V(forward.z,0,-forward.x);
    const before=V(p[0]-a[0],0,p[1]-a[1]).normalize(),after=V(b[0]-p[0],0,b[1]-p[1]).normalize();
    const turn=before.clone().cross(after).y;
    right.applyAxisAngle(forward,Math.max(-bankAmount,Math.min(bankAmount,turn*5))*smooth((i/1600)/.025)*smooth((1-i/1600)/.025));
    points.push(V(p[0],elevation(i/1600),p[1]));rights.push(right);
  }
  let main=makeRoute('main',points,rights,true);
  if(flyoverRange)main.flyover={start:main.samples[flyoverRange.first].s,end:main.samples[flyoverRange.last].s};
  if(loopRange){main.magnet={start:main.samples[loopRange.first].s-12,end:main.samples[loopRange.last].s+12};}
  // Place launch ramps on the straightest available stretches, away from joins.
  const launches=[];
  for(const fraction of (index===11?[.16,.47,.76]:index===1?[.18,.48,.78]:[.2,.7])){
    let chosen=null,cost=Infinity;
    for(let offset=-.15;offset<=.15;offset+=.004){
      const s=(fraction+offset)*main.length;
      if(main.magnet&&s>main.magnet.start-100&&s<main.magnet.end+100)continue;
      if(launches.some(x=>Math.abs(x-s)<140))continue;
      let score=0;
      for(let d=-10;d<70;d+=10){const a=sampleRoute(main,s+d).forward,b=sampleRoute(main,s+d+10).forward;const ax=new THREE.Vector2(a.x,a.z).normalize(),bx=new THREE.Vector2(b.x,b.z).normalize();score+=1-ax.dot(bx);}
      score+=Math.abs(offset)*.015;
      if(score<cost){cost=score;chosen=s;}
    }
    if(chosen)launches.push(chosen);
  }
  // Landing decks give every main-route jump a readable, broad receiving
  // surface. Flatten the local vertical profile before adding the ramp lip.
  const launchHeights=launches.map(s=>sampleRoute(main,s).pos.y);
  for(const sample of main.samples){
    for(let j=0;j<launches.length;j++){
      const d=sample.s-launches[j];
      const blend=smooth((d+45)/25)*smooth((110-d)/30);
      sample.pos.y+=(launchHeights[j]-sample.pos.y)*blend;
      if(d>=-18&&d<0)sample.pos.y+=2.6*smooth((d+18)/18);else if(d>=0&&d<26)sample.pos.y+=2.6*(1-smooth(d/26));
    }
  }
  const magnet=main.magnet,flyover=main.flyover;main=makeRoute('main',main.samples.map(p=>p.pos),rights,true);main.magnet=magnet;main.flyover=flyover;
  for(const s0 of launches){const s=projectRoute(main,sampleRoute(main,s0).pos,s0,10).s;main.jumps.push({s,power:index===0?8:9,gap:index===0?0:7});if(index!==0)main.gaps.push({start:s+1,end:s+8});}
  const course={routes:{main},main,length:main.length,index,def};
  // A physically shorter, narrower line across a bend; arc progress maps to its
  // entry/exit on the main road rather than its raw distance or segment index.
  if(index!==0){
    let entry=0,exit=0,best=0;
    for(let t=.18;t<.8;t+=.007){
      const a=t*main.length,b=a+Math.min(180,main.length*.14);
      if(main.jumps.some(j=>Math.abs(j.s-a)<50||Math.abs(j.s-b)<60)||main.magnet&&b>main.magnet.start-30&&a<main.magnet.end+30)continue;
      const ratio=(b-a)/sampleRoute(main,a).pos.distanceTo(sampleRoute(main,b).pos);
      if(ratio<1.04||ratio>1.65||sampleRoute(main,a).forward.dot(sampleRoute(main,b).forward)<-.35)continue;
      if(ratio>best){best=ratio;entry=a;exit=b;}
    }
    if(exit>entry){
      const a=sampleRoute(main,entry),b=sampleRoute(main,exit),chord=b.pos.clone().sub(a.pos);
      const side=Math.sign(chord.dot(a.right))||1,pts=[],rs=[];
      for(let i=0;i<=160;i++){
        const t=i/160, h=(2*t*t*t-3*t*t+1),h1=(-2*t*t*t+3*t*t);
        const p=a.pos.clone().multiplyScalar(h).addScaledVector(b.pos,h1).addScaledVector(a.forward,(t*t*t-2*t*t+t)*chord.length()*.65).addScaledVector(b.forward,(t*t*t-t*t)*chord.length()*.65);
        p.y+=Math.sin(Math.PI*t)**2*(index===8?-4:6);
        pts.push(p);rs.push(a.right.clone().lerp(b.right,t).normalize());
      }
      for(let i=0;i<pts.length;i++){const f=pts[Math.min(i+1,pts.length-1)].clone().sub(pts[Math.max(0,i-1)]).normalize();rs[i]=V(f.z,0,-f.x).normalize();}
      const branch=makeRoute('shortcut',pts,rs,false,5.8);branch.entry=entry;branch.exit=exit;branch.side=side;course.routes.shortcut=branch;
    }
  }
  return course;
}
