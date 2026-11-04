import * as THREE from '../../lib/three.module.js';
import { sampleRoute, projectRoute, roadPoint, routeProgress, wrap, hasSurface } from './course.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const PHYSICS_STEP=1/120;
export function resetDriver(k,course,s=0,lateral=0){
  Object.assign(k,{routeId:'main',roadS:s,lateral,yaw:0,motion:'grounded',airTime:0,trick:false,trickAngle:0,driftHeld:false,jumpLock:0,rescueTimer:0,feedback:'',feedbackTimer:0,travel:0,lastMainProgress:wrap(s,course.length),checkpoint:1,lastSafe:{routeId:'main',s,lateral},landingCount:0,trickCount:0,rescues:0,scoredJumps:new Set()});
  k.velocity=new THREE.Vector3();k.frame=sampleRoute(course.main,s);k.pos.copy(roadPoint(k.frame,lateral));
}
export function setFeedback(k,text){k.feedback=text;k.feedbackTimer=1.8;}
export function rescueDriver(k){
  if(k.motion==='rescue')return;
  k.motion='rescue';k.rescueTimer=1.05;k.speed=0;k.boostTimer=0;k.trick=false;k.drifting=false;k.driftCharge=0;k.chain=0;k.combo=1;k.rescues++;
  setFeedback(k,'救援中');
}
function awardLanding(k,alignment){
  const scoreEligible=!k.scoredJumps.has(k.activeJump);k.scoredJumps.add(k.activeJump);
  k.landingCount++;
  if(alignment>.8){
    k.speed=Math.max(0,k.speed);k.boostTimer=Math.max(k.boostTimer,k.trick?1.15:.35);
    if(scoreEligible)k.driftScore+=(k.trick?180:60)*(k.combo||1);k.chain=(k.chain||0)+.8;k.combo=Math.min(4,1+Math.floor(k.chain/1.5));
    if(k.trick)k.trickCount++;
    setFeedback(k,k.trick?'特技落地 · 加速':'平稳落地');
  }else{k.speed*=.72;k.chain=0;k.combo=1;setFeedback(k,'落地偏斜');}
  k.trick=false;k.trickAngle=0;k.airTime=0;k.motion='grounded';k.jumpLock=.65;
}
export function stepDriver(k,course,input,dt,settings){
  const {CFG,car={speed:1,accel:1,grip:1},maxMul=1,accelMul=1}=settings;
  k.feedbackTimer=Math.max(0,k.feedbackTimer-dt);k.jumpLock=Math.max(0,k.jumpLock-dt);k.boostTimer=Math.max(0,k.boostTimer-dt);
  const pressed=input.drift&&!k.driftHeld;k.driftHeld=!!input.drift;
  if(k.motion==='rescue'){
    k.rescueTimer-=dt;
    if(k.rescueTimer<=0){const safe=k.lastSafe;k.routeId=safe.routeId;k.roadS=safe.s;k.lateral=clamp(safe.lateral,-3,3);k.yaw=0;k.speed=18;k.motion='grounded';k.jumpLock=.2;k.airTime=0;setFeedback(k,'回到赛道');}
    else return;
  }
  let route=course.routes[k.routeId],frame=sampleRoute(route,k.roadS);
  k.steer+=(input.steer-k.steer)*(1-Math.exp(-14*dt));
  if(k.motion==='airborne'){
    k.airTime+=dt;
    if(pressed&&!k.trick&&k.airTime>.045){k.trick=true;setFeedback(k,'特技 · 准备落地');}
    if(k.trick)k.trickAngle=Math.min(Math.PI*2,k.trickAngle+dt*9);
    const before=k.pos.clone();
    k.velocity.y-=26*dt;
    k.velocity.addScaledVector(frame.right,-k.steer*18*dt);
    k.pos.addScaledVector(k.velocity,dt);
    // Local projection preserves the road identity at overpasses and loop joins.
    const near=projectRoute(route,k.pos,k.roadS,85);
    const old=projectRoute(route,before,k.roadS,85);
    k.roadS=near.s;k.lateral=near.lateral;k.frame=near;
    const normalV=k.velocity.dot(near.up);
    if(k.airTime>.12&&normalV<0&&old.height>=-.5&&near.height<=.15&&Math.abs(near.lateral)<route.width+1&&hasSurface(route,near.s)){
      k.pos.copy(roadPoint(near,near.lateral));
      const horizontal=k.velocity.clone().addScaledVector(near.up,-normalV).normalize();
      const alignment=horizontal.dot(near.forward);
      k.yaw=clamp(-Math.atan2(horizontal.dot(near.right),alignment),-.8,.8);
      k.speed=Math.max(8,k.velocity.dot(near.forward));awardLanding(k,alignment);
    }else if(k.airTime>4||near.height<-16||k.pos.y<-30)rescueDriver(k);
  }else{
    if(k.stunTimer>0){k.stunTimer=Math.max(0,k.stunTimer-dt);k.speed*=Math.exp(-1.5*dt);input={...input,throttle:0,brake:0,steer:0};}
    const top=(k.boostTimer>0?CFG.boostMaxSpeed:CFG.maxSpeed)*car.speed*maxMul;
    if(input.throttle&&k.speed<top)k.speed=Math.min(top,k.speed+CFG.accel*car.accel*accelMul*dt);
    if(input.brake)k.speed-=CFG.brake*dt;
    if(!input.throttle&&!input.brake)k.speed*=Math.exp(-CFG.drag*dt);
    if(k.speed>top)k.speed=Math.max(top,k.speed-10*dt);
    // Gravity changes longitudinal speed; the downhill cap is distinct from the
    // engine's target speed so a slope can actually carry speed onto the flat.
    const magnetic=route.magnet&&k.roadS>=route.magnet.start&&k.roadS<=route.magnet.end;
    k.speed-=frame.forward.y*CFG.gravitySlope*dt*(magnetic?.35:1);
    k.speed=clamp(k.speed,-CFG.reverseMax,CFG.boostMaxSpeed*car.speed+12);
    const drift=input.drift&&Math.abs(k.speed)>CFG.driftMinSpeed&&Math.abs(input.steer)>.08;
    if(drift){k.drifting=true;k.driftCharge=Math.min(3,k.driftCharge+dt);}
    else if(k.drifting){
      const tier=k.driftCharge>=2.4?3:k.driftCharge>=1.4?2:k.driftCharge>=.7?1:0;
      if(tier)k.boostTimer=Math.max(k.boostTimer,CFG.boostTime[tier]);
      k.drifting=false;k.driftCharge=0;
    }
    // Heading is relative to the road, but includes its curvature: driving a
    // curve still requires steering rather than automatically following a rail.
    const advance=k.speed*Math.cos(k.yaw)*dt, next=sampleRoute(route,k.roadS+advance);
    const curvature=Math.atan2(frame.forward.clone().cross(next.forward).dot(frame.up),frame.forward.dot(next.forward));
    k.yaw=clamp(k.yaw+k.steer*(drift?CFG.driftTurnRate:CFG.turnRate)*car.grip*dt*Math.min(1,Math.abs(k.speed)/18)+curvature,-1.25,1.25);
    // Positive input turns toward the negative road-X axis (chase-view right).
    k.lateral-=Math.sin(k.yaw)*k.speed*dt;
    const oldS=k.roadS,previousRoute=route;k.roadS+=advance;
    // Branch entry is a physical lane choice, not an extra action or teleport.
    const branch=course.routes.shortcut;
    if(k.routeId==='main'&&branch&&oldS<=branch.entry+6&&k.roadS>=branch.entry&&k.lateral*branch.side>2.8){
      const oldForward=next.forward.clone().multiplyScalar(Math.cos(k.yaw)).addScaledVector(next.right,-Math.sin(k.yaw));
      k.routeId='shortcut';k.roadS=Math.max(0,k.roadS-branch.entry);route=branch;
      const start=sampleRoute(route,k.roadS);k.yaw=-Math.atan2(oldForward.dot(start.right),oldForward.dot(start.forward));
      setFeedback(k,'捷径');
    }
    if(!route.closed&&k.roadS>=route.length){
      const oldFrame=sampleRoute(route,route.length);const direction=oldFrame.forward.clone().multiplyScalar(Math.cos(k.yaw)).addScaledVector(oldFrame.right,-Math.sin(k.yaw));
      k.roadS=route.exit+(k.roadS-route.length);k.routeId='main';route=course.main;
      const end=sampleRoute(route,k.roadS);k.yaw=-Math.atan2(direction.dot(end.right),direction.dot(end.forward));
    }
    if(route.closed)k.roadS=wrap(k.roadS,route.length);
    else if(k.roadS<0){k.roadS=route.entry+k.roadS;k.routeId='main';route=course.main;}
    frame=sampleRoute(route,k.roadS);k.frame=frame;
    if(Math.abs(k.lateral)>route.width){
      if(frame.pos.y>15||k.routeId!=='main'||frame.up.y<.7){
        if(Math.abs(k.lateral)>route.width+2)rescueDriver(k);
      }else{k.speed+=(Math.min(k.speed,CFG.maxSpeed*CFG.GRASS_SLOW)-k.speed)*dt*2;k.lateral=clamp(k.lateral,-route.width-10,route.width+10);}
    }
    k.pos.copy(roadPoint(frame,k.lateral));
    const jump=route===previousRoute&&route.jumps.find(j=>oldS<j.s&&k.roadS>=j.s);
    if(jump&&k.jumpLock<=0&&k.speed>8&&Math.abs(k.lateral)<=route.width){
      k.activeJump=`${k.lap}:${route.id}:${route.jumps.indexOf(jump)}`;
      k.motion='airborne';k.airTime=0;k.trick=false;k.drifting=false;k.driftCharge=0;
      k.velocity.copy(frame.forward).multiplyScalar(k.speed*Math.cos(k.yaw)).addScaledVector(frame.right,-Math.sin(k.yaw)*k.speed).addScaledVector(frame.up,jump.power+k.speed*.045);
      k.pos.addScaledVector(frame.up,.2);setFeedback(k,'腾空 · 点按漂移做特技');
    }else if(!hasSurface(route,k.roadS)&&k.motion==='grounded'){rescueDriver(k);}
    if(k.motion==='grounded'&&Math.abs(k.lateral)<route.width-1&&hasSurface(route,k.roadS)&&!route.jumps.some(j=>Math.abs(j.s-k.roadS)<35))k.lastSafe={routeId:k.routeId,s:k.roadS,lateral:k.lateral};
  }
  const mainProgress=routeProgress(course,k.routeId,k.roadS);
  let delta=mainProgress-k.lastMainProgress;
  if(delta<-course.length/2)delta+=course.length;if(delta>course.length/2)delta-=course.length;
  // Rescue rewinds are allowed but never count as forward checkpoint crossings.
  if(k.motion!=='rescue'&&delta>0&&delta<100){
    const previous=k.lastMainProgress;
    if(k.checkpoint<=3&&previous<k.checkpoint*course.length/4&&mainProgress>=k.checkpoint*course.length/4)k.checkpoint++;
    if(k.checkpoint===4&&previous>course.length*.9&&mainProgress<course.length*.1){k.lap++;k.checkpoint=1;k.completedLap=true;}
  }
  k.travel+=delta;k.lastMainProgress=mainProgress;
  k.segIndex=Math.floor(mainProgress/course.length*500)%500;k.progress=k.lap*500+mainProgress/course.length*500;
}
