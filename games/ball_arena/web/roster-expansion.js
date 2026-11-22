(function(root){
'use strict';
const B=root.BallBattle,TAU=Math.PI*2,EPS=1e-8;
const {resolveArenaGeometry:arena,firstSegmentCircleContact:circleHit}=B;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const delta=(a,b)=>({x:b.x-a.x,y:b.y-a.y});
const distance=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y);
const angleTo=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const offset=(p,angle,length)=>({x:p.x+Math.cos(angle)*length,y:p.y+Math.sin(angle)*length});
function heading(ball){
 const moving=Math.hypot(ball.vx,ball.vy)>EPS;
 return Math.atan2(moving?ball.vy:ball.storedVy||0,moving?ball.vx:ball.storedVx||0);
}
const inside=(a,b,r)=>distance(a,b)<=r+b.radius;
const point=(game,p,r=0)=>arena(game).clampPoint(p.x,p.y,r);

function line(c,a,b){
 c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
}
function circle(c,p,r){
 c.beginPath();c.arc(p.x,p.y,r,0,TAU);c.stroke();
}
function push(services,ball,angle,length){
 if(!services.getCapabilities(ball).canMove)return;
 services.applyEffect(ball,B.createKnockbackEffect({
  id:'arena-displacement',duration:.18,distance:length,directionX:Math.cos(angle),
  directionY:Math.sin(angle),speedMultiplier:1.2
 }));
}
function ring(services,p,color,radius,life=.28){
 services.spawnVisualEffect({kind:'arena-original-pulse',x:p.x,y:p.y,radius,life,color,
  draw({effect},c){
   c.save();const t=effect.age/effect.life;
   c.globalAlpha*=1-t;c.strokeStyle=effect.color;c.lineWidth=1.7;
   circle(c,effect,Math.max(1,effect.radius*(.65+.35*t)));c.restore();
  }});
}
function enemiesIn(services,p,r,fn){
 services.forEachEnemy(target=>{if(inside(p,target,r))fn(target);});
}
function impact(services,p,r,damage,color,hit=new Set()){
 enemiesIn(services,p,r,target=>{
  if(hit.has(target.instanceId))return;
  hit.add(target.instanceId);services.dealDamage(target,damage);
 });
 ring(services,p,color,r);
}
function effectId(ball,kind){return ball.instanceId+'-arena-'+kind;}
function boost(services,ball,id,speedFactor,duration){
 services.applyEffect(ball,{id,duration,speedFactor,visualType:speedFactor>1?'haste':'slow'});
}
function warning(c,p,r,color,alpha=.7){
 c.save();c.globalAlpha*=alpha;c.strokeStyle=color;c.lineWidth=1.15;
 c.setLineDash([3,3]);circle(c,p,r);c.restore();
}
function timed(services,period,action,hooks={}){
 let elapsed=0,casts=0;
 return {
  ...hooks,
  onSpawn(context){elapsed=0;casts=0;hooks.onSpawn?.(context);},
  update(context,dt){
   hooks.update?.(context,dt);
   elapsed=Math.min(period,elapsed+dt);
   if(elapsed+EPS<period||!services.getCapabilities(context.ball).canDealDamage)return;
   if(action(context)!==false){elapsed=0;casts++;}
  },
  getNextTransitionIn(){const remaining=period-elapsed;return remaining>EPS?remaining:.25;},
  getArenaExtensionState(){return {elapsed,casts,...hooks.getArenaExtensionState?.()};}
 };
}
function zone(services,kind,p,life,definition){
 return services.spawnCombatEntity({kind,x:p.x,y:p.y,life,drawLayer:'background',...definition});
}
function delayed(services,kind,p,delay,radius,color,fire,art){
 return zone(services,kind,p,delay+.1,{
  update({entity,services:source},dt){
   if(entity.age+dt+EPS<delay)return;
   entity.contactLayer='ground';fire(entity,source);entity.entityActive=false;
  },
  draw({entity},c){
   const t=clamp(entity.age/delay,0,1);
   warning(c,entity,radius,color,.45+.4*t);art?.(entity,c,t);
  }});
}
function throwTo(services,ball,target,kind,color,{flight=.45,radius=2,onLand,art}){
 const ballStart={x:ball.x,y:ball.y},d=delta(ballStart,target);
 return services.spawnProjectile({kind,x:ball.x,y:ball.y,vx:d.x/flight||.001,vy:d.y/flight,
  radius,life:flight+.1,contactLayer:'air',height:0,drawLayer:'foreground',
  update({entity,services:source},dt){
   const t=clamp((entity.age+dt)/flight,0,1);
   entity.x=ballStart.x+d.x*t;entity.y=ballStart.y+d.y*t;entity.height=4*20*t*(1-t);
   if(t<1-EPS)return;
   entity.contactLayer='ground';entity.height=0;onLand(target,source);
   entity.entityActive=false;
  },
  draw({entity},c){
   warning(c,target,radius+6,color);
   c.save();c.fillStyle=color;c.strokeStyle=color;
   c.translate(entity.x,entity.y-entity.height);
   if(art)art(c);else c.fillRect(-3,-3,6,6);
   c.restore();
  }});
}

function riveter(services,color){
 let rivets=[],charged=false;
 return timed(services,4,({ball,game})=>{
  rivets=rivets.filter(e=>e.entityActive!==false);
  if(rivets.length>=2)rivets.shift().entityActive=false;
  const map=arena(game),a=heading(ball),end=offset(ball,a,map.size*2);
  const wall=map.traceSegment(ball.x,ball.y,end.x,end.y,5);
  const p=point(game,wall||end,5);
  throwTo(services,ball,p,'arena-rivet-flight',color,{onLand(position){
   const rivet=zone(services,'arena-rivet',position,5,{
    update({entity},dt){
     const holder=entity.owner;
     if(entity.age+dt<.35||!holder||holder.hp<=0||holder.active===false||!inside(entity,holder,5))return;
     charged=true;entity.entityActive=false;ring(services,holder,color,18);
    },
    draw({entity},c){
     c.save();c.strokeStyle=color;c.lineWidth=2;
     circle(c,entity,5);line(c,offset(entity,0,-3),offset(entity,0,3));c.restore();
    }
   });
   rivets.push(rivet);
  }});
 },{
  onSpawn(){rivets=[];charged=false;},
  onCollision({ball},target){if(charged&&services.dealDamage(target,5)){charged=false;ring(services,ball,color,23);}},
  drawAfter({ball},c){if(charged){c.save();c.strokeStyle=color;c.lineWidth=2;circle(c,ball,19);c.restore();}}
 });
}

function beacon(services,color){
 return timed(services,3,({ball,game})=>{
  const target=services.getOpponent();if(!target)return false;
  const p=point(game,offset(ball,angleTo(ball,target),Math.min(88,distance(ball,target))),6);
  throwTo(services,ball,p,'arena-beacon-flight',color,{onLand(position){
   zone(services,'arena-beacon',position,2,{
    update({entity,services:source}){
     enemiesIn(source,entity,22,target=>{
      if(!entity.entityActive)return;
      entity.entityActive=false;
      if(source.dealDamage(target,3))boost(source,target,effectId(ball,'beacon'),.75,1);
      ring(source,entity,color,22);
     });
    },
    draw({entity},c){warning(c,entity,22,color);c.save();c.fillStyle=color;c.fillRect(entity.x-2,entity.y-6,4,12);c.restore();}
   });
  }});
 });
}

function pottery(services,color){
 let expires=0;
 return timed(services,5,({game})=>{expires=game.time+2;},{
  onSpawn(){expires=0;},
  onBeforeDamage({ball,game},event){
   const actor=event.combatSource?.actor;
   if(!actor||actor===ball||event.amount<=0||B.isTrueDamage(event)||game.time>=expires||!Number.isFinite(actor.x)||!Number.isFinite(actor.y))return event;
   if(Math.cos(angleTo(ball,actor)-heading(ball))<.5)return event;
   expires=0;event.amount=Math.max(0,event.amount-4);
   boost(services,ball,effectId(ball,'pottery'),1.2,1);ring(services,ball,color,19);
   return event;
  },
  drawAfter({ball,game},c){
   if(game.time>=expires)return;
   c.save();c.strokeStyle=color;c.lineWidth=3;c.beginPath();
   const a=heading(ball);c.arc(ball.x,ball.y,19,a-1,a+1);c.stroke();c.restore();
  }
 });
}

function sequence(services,kind,positions,delays,radius,color,callback){
 positions.forEach((p,i)=>{
  delayed(services,kind,p,delays[i],radius,color,(entity,source)=>callback(entity,source,i));
 });
}

function tremor(services,color){
 return timed(services,4,({ball,game})=>{
  const hit=new Set(),a=heading(ball)+Math.PI;
  const positions=[18,34,50].map(n=>point(game,offset(ball,a,n)));
  sequence(services,'arena-tremor',positions,[.35,.55,.75],16,color,
   (p,source)=>impact(source,p,16,4,color,hit));
 });
}

function bellows(services,color){
 return timed(services,3,({ball})=>{
  const target=services.getOpponent();if(!target)return false;
  const rotation=angleTo(ball,target),hit=new Set(),origin=offset(ball,rotation,12);
  zone(services,'arena-wind-strip',origin,1.2,{
   update({entity,services:source}){
    source.forEachEnemy(enemy=>{
     const d=delta(entity,enemy),x=d.x*Math.cos(rotation)+d.y*Math.sin(rotation);
     const side=-d.x*Math.sin(rotation)+d.y*Math.cos(rotation);
     if(x<0||x>62+enemy.radius||Math.abs(side)>10+enemy.radius||hit.has(enemy.instanceId))return;
     hit.add(enemy.instanceId);
     if(source.dealDamage(enemy,2))push(source,enemy,rotation+(side>=0?1:-1)*Math.PI/2,12);
    });
   },
   draw({entity},c){
    c.save();c.strokeStyle=color;c.globalAlpha*=.7;c.lineWidth=1.4;
    for(const y of [-8,0,8]){
     const p=offset(entity,rotation+Math.PI/2,y);line(c,p,offset(p,rotation,62));
    }
    c.restore();
   }});
 });
}

// Sweep the centre against the rendered capsule, including fast projectiles.
function crossedStrip(previous,current,a,b,radius){
 const length=distance(a,b);
 if(length<EPS)return circleHit(previous.x,previous.y,current.x,current.y,a.x,a.y,radius)!==null;
 if(circleHit(previous.x,previous.y,current.x,current.y,a.x,a.y,radius)!==null||
    circleHit(previous.x,previous.y,current.x,current.y,b.x,b.y,radius)!==null)return true;
 const ux=(b.x-a.x)/length,uy=(b.y-a.y)/length;
 const project=p=>{
  const d=delta(a,p);return {x:d.x*ux+d.y*uy,y:-d.x*uy+d.y*ux};
 };
 const p=project(previous),q=project(current);
 let low=0,high=1;
 for(const [start,end,min,max] of [[p.x,q.x,0,length],[p.y,q.y,-radius,radius]]){
  const change=end-start;
  if(Math.abs(change)<EPS){if(start<min||start>max)return false;continue;}
  const enter=(min-start)/change,leave=(max-start)/change;
  low=Math.max(low,Math.min(enter,leave));high=Math.min(high,Math.max(enter,leave));
  if(low>high)return false;
 }
 return true;
}
function oldPosition(actor){
 return {x:actor.previousX??actor.prevX??actor.x,y:actor.previousY??actor.prevY??actor.y};
}

function cardboard(services,color){
 let boards=[];
 return timed(services,5,({ball,game})=>{
  const a=heading(ball),center=offset(ball,a,-23),map=arena(game),sides=[-42,42];
  const ends=sides.map(n=>offset(center,a+Math.PI/2,n));
  if(!map.contains(center.x,center.y,4))return false;
  const start=map.clampPoint(ends[0].x,ends[0].y,3),end=map.clampPoint(ends[1].x,ends[1].y,3);
  const length=distance(start,end);
  if(length<24)return false;
  boards=boards.filter(b=>b.entityActive!==false);
  if(boards.length>=2)boards.shift().entityActive=false;
  const segments=Array.from({length:6},(_,i)=>{
   const p=offset(start,angleTo(start,end),i*length/6);
   return {a:p,b:offset(start,angleTo(start,end),(i+1)*length/6),alive:true};
  });
  const board=zone(services,'arena-cardboard',center,6,{
   solid:true,segments,
   update({entity,services:source,game}){
    function hit(actor,radius){
     const part=segments.find(s=>s.alive&&crossedStrip(oldPosition(actor),actor,s.a,s.b,radius+2.5));
     if(!part)return false;
     part.alive=false;ring(source,part.a,color,9,.18);
     return true;
    }
    source.forEachContactEnemy(enemy=>{
     if(!source.getContactProfile(enemy).solid||!hit(enemy,enemy.radius))return;
     if(source.isMovementLocked(enemy))return;
     const normal=angleTo(start,end)+Math.PI/2,prior=oldPosition(enemy);
     const side=Math.cos(angleTo(center,prior)-normal)<0?-1:1;
     const depth=(enemy.x-center.x)*Math.cos(normal)+(enemy.y-center.y)*Math.sin(normal);
     const corrected=offset(enemy,normal,side*(enemy.radius+2.5)-depth);
     Object.assign(enemy,map.clampPoint(corrected.x,corrected.y,enemy.radius));
     push(source,enemy,normal+(side<0?Math.PI:0),7);
    });
    for(const shot of game.combatEntities){
     if(!shot.entityActive||!shot.isProjectile||!source.isEnemy(shot)||!B.canShareContactLayer(entity,shot))continue;
     if(hit(shot,shot.radius||0)&&!shot.indestructible)shot.entityActive=false;
    }
    if(!segments.some(s=>s.alive))entity.entityActive=false;
   },
   draw(_,c){
    c.save();c.strokeStyle=color;c.lineWidth=5;
    for(const s of segments)if(s.alive)line(c,s.a,{x:s.a.x+(s.b.x-s.a.x)*.9,y:s.a.y+(s.b.y-s.a.y)*.9});
    c.restore();
   }});
  boards.push(board);
 },{onSpawn(){boards=[];}});
}

function magnet(services,color){
 return timed(services,5,({ball})=>{
  let pullAt=0,reversed=false;
  zone(services,'arena-magnet',ball,.85,{
   update({entity,services:source},dt){
    if(entity.age+dt>=.52&&!reversed){
     reversed=true;enemiesIn(source,entity,60,target=>{
      if(source.dealDamage(target,3))push(source,target,angleTo(entity,target),18);
     });
     ring(source,entity,color,60);
    }else if(!reversed&&entity.age+dt>=pullAt){
     pullAt+=.16;enemiesIn(source,entity,60,target=>push(source,target,angleTo(target,entity),7));
    }
   },
   draw({entity},c){
    c.save();c.strokeStyle=color;c.globalAlpha*=.55;
    circle(c,entity,60);circle(c,entity,reversed?58:53-entity.age*35);c.restore();
   }});
 });
}
function kite(services,color){
 return timed(services,4,({ball,game})=>{
  const p=point(game,offset(ball,heading(ball),45),4);
  throwTo(services,ball,p,'arena-kite',color,{flight:1,radius:21,
   onLand(position,source){impact(source,position,24,4,color);},
   art(c){c.rotate(Math.PI/4);c.fillRect(-5,-5,10,10);line(c,{x:4,y:4},{x:10,y:12});}});
 });
}
function ruler(services,color){
 let extra=false;
 return timed(services,3,({ball,game})=>{
  const end=offset(ball,heading(ball),extra?90:62);
  const wall=arena(game).traceSegment(ball.x,ball.y,end.x,end.y,2);
  const tip=wall||end,target=services.getFirstEnemyHit(ball.x,ball.y,tip.x,tip.y,2);
  if(target)services.dealDamage(target,4);
  extra=!target&&Boolean(wall);
  const start={x:ball.x,y:ball.y};
  services.spawnVisualEffect({kind:'arena-ruler',life:.26,draw({effect},c){
   c.save();c.strokeStyle=color;c.globalAlpha*=1-effect.age/effect.life;c.lineWidth=3;
   line(c,start,tip);c.restore();
  }});
 },{
  onSpawn(){extra=false;},
  drawAfter({ball},c){if(extra)warning(c,ball,19,color,1);}
 });
}
function rain(services,color){
 let history=[],nextSample=0,tracked=null;
 return timed(services,4,({game})=>{
  if(!history.length)return false;
  const hits=new Map(),positions=history.map(p=>point(game,p,4));
  sequence(services,'arena-rain',positions,[.28,.48,.68],15,color,(p,source)=>{
   enemiesIn(source,p,15,target=>{
    const count=hits.get(target.instanceId)||0;if(count>=2)return;
    hits.set(target.instanceId,count+1);source.dealDamage(target,2);
   });
   ring(source,p,color,15);
  });
 },{
  onSpawn(){history=[];nextSample=0;tracked=null;},
  update({game}){
   const target=services.getOpponent();
   if(!target){history=[];tracked=null;return;}
   if(tracked!==target.instanceId){tracked=target.instanceId;history=[];nextSample=0;}
   if(game.time+EPS<nextSample)return;
   nextSample=game.time+.23;
   history.push({x:target.x,y:target.y});
   if(history.length>3)history.shift();
  }
 });
}
function foldingBarrier(services,color){
 return timed(services,5,({ball,game})=>{
  const p=point(game,offset(ball,heading(ball),-22),3),a=heading(ball)+Math.PI/2;
  let phase=-1,hit=new Set();
  const tips=(age,map)=>{
   const opening=Math.max(0,Math.sin((age%.9)/.9*Math.PI));
   return [offset(p,a,-26*opening),offset(p,a,26*opening)].map(v=>map.clampPoint(v.x,v.y,3));
  };
  zone(services,'arena-folding-barrier',p,3,{
   update({entity,game,services:source}){
    const cycle=Math.floor(entity.age/.9);
    if(phase!==cycle){phase=cycle;hit=new Set();}
    if(entity.age%.9<.2||entity.age%.9>.72)return;
    const [left,right]=tips(entity.age,arena(game));
    function redirect(target,hostile){
     if(hit.has(target.instanceId)||!source.getContactProfile(target).solid||
       !crossedStrip(oldPosition(target),target,left,right,target.radius+2))return;
     hit.add(target.instanceId);
     if(hostile)source.dealDamage(target,2);
     push(hostile?source:target.services,target,a+(Math.sin(angleTo(p,target)-a)>0?1:-1)*Math.PI/2,13);
    }
    source.forEachContactEnemy(target=>redirect(target,true));
    source.forEachAlly(target=>redirect(target,false));
    const holder=entity.owner;
    if(holder?.hp>0&&holder.active!==false)redirect(holder,false);
   },
   draw({entity,game},c){
    const [left,right]=tips(entity.age,arena(game));
    c.save();c.strokeStyle=color;c.lineWidth=3;line(c,left,right);circle(c,p,4);c.restore();
   }});
 });
}

function shard(services,ball,angle,color,kind,hits,max,damage,curvature=0){
 const speed=200;
 services.spawnProjectile({kind,x:ball.x,y:ball.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,
  radius:4,life:.75,hitIds:new Set(),
  update({entity,game,services:source},dt){
   const dir=Math.atan2(entity.vy,entity.vx)+curvature*dt;
   const from={x:entity.x,y:entity.y},end=offset(from,dir,speed*dt),map=arena(game);
   const edge=map.traceSegment(from.x,from.y,end.x,end.y,entity.radius);
   const to=edge||end;
   const collisions=[];
   source.forEachEnemy(target=>{
    if(!B.canShareContactLayer(entity,target)||entity.hitIds.has(target.instanceId)||(hits.get(target.instanceId)||0)>=max)return;
    const t=circleHit(from.x,from.y,to.x,to.y,target.x,target.y,entity.radius+target.radius);
    if(t!==null)collisions.push({target,t});
   });
   collisions.sort((a,b)=>a.t-b.t);
   if(collisions.length){
    const target=collisions[0].target;
    entity.hitIds.add(target.instanceId);hits.set(target.instanceId,(hits.get(target.instanceId)||0)+1);
    source.dealDamage(target,damage);entity.entityActive=false;
   }
   entity.x=to.x;entity.y=to.y;entity.vx=Math.cos(dir)*speed;entity.vy=Math.sin(dir)*speed;
   if(edge)entity.entityActive=false;
  },
  draw({entity},c){
   c.save();c.translate(entity.x,entity.y);c.rotate(Math.atan2(entity.vy,entity.vx));
   c.strokeStyle=color;c.fillStyle=color;c.lineWidth=1.5;
   if(curvature){c.beginPath();c.arc(-2,0,6,-1.2,1.2);c.stroke();}
   else{c.rotate(Math.PI/4);c.fillRect(-3,-3,6,6);}
   c.restore();
  }});
}
function tides(services,color){
 return timed(services,4,({ball})=>{
  const hits=new Map(),a=heading(ball);
  for(const side of [-1,1])shard(services,ball,a+side*Math.PI/2,color,'arena-tide',hits,1,3,side*1.8);
 });
}
function mirror(services,color){
 return timed(services,3,({ball})=>{
  const target=services.getOpponent();
  if(!target)return false;
  const a=angleTo(ball,target),hits=new Map();
  for(const spread of [-.3,0,.3])shard(services,ball,a+spread,color,'arena-mirror',hits,2,2);
 });
}
function carbon(services,color){
 return timed(services,5,({ball})=>{
  delayed(services,'arena-carbon',ball,1,28,color,(p,source)=>impact(source,p,28,4,color));
 });
}
function stamp(services,color){
 return {
  getArenaExtensionState(){return {};},
  onCollision({ball,game},target){
   const id=effectId(ball,'stamp'),old=target.effects.get(id);
   const expirations=[...(old?.expirations||[]).filter(time=>time>game.time),game.time+4].slice(-2);
   services.applyEffect(target,{id,expirations,duration:4,
    onWallBounce({ball:victim,effect,game,services:source}){
     if(effect.expirations.filter(time=>time>game.time).length<2||victim.hp<=0)return;
     source.clearEffect(victim,id);
     source.dealDamage(victim,3);ring(source,victim,color,20);
    },
    draw({ball:victim,effect,game},c){
     const count=effect.expirations.filter(time=>time>game.time).length;
     c.save();c.fillStyle=color;
     for(let i=0;i<count;i++)c.fillRect(victim.x-5+i*6,victim.y+10,4,3);
     c.restore();
    }});
  }
 };
}
function prism(services,color){
 return timed(services,4,({ball,game})=>{
  const target=services.getOpponent();if(!target)return false;
  const a=angleTo(ball,target),center=offset(ball,a,Math.min(75,distance(ball,target))),hit=new Set();
  const positions=[-27,0,27].map(n=>point(game,offset(center,a+Math.PI/2,n),4));
  sequence(services,'arena-prism',positions,[.38,.58,.78],15,color,
   (p,source)=>impact(source,p,15,4,color,hit));
 });
}
function spool(services,color){
 return timed(services,5,({ball,game})=>{
  const a=heading(ball),center=offset(ball,a,27);
  const left=point(game,offset(center,a+Math.PI/2,-29),3);
  const right=point(game,offset(center,a+Math.PI/2,29),3);
  if(distance(left,right)<12)return false;
  zone(services,'arena-thread',center,3,{
   update({entity,services:source}){
    source.forEachContactEnemy(target=>{
     if(!entity.entityActive||!crossedStrip(oldPosition(target),target,left,right,1.7))return;
     entity.entityActive=false;
     if(source.dealDamage(target,3))push(source,target,angleTo(left,right),14);
     ring(source,target,color,17);
    });
   },
   draw(_,c){
    c.save();c.strokeStyle=color;c.lineWidth=1.8;line(c,left,right);
    circle(c,left,3);circle(c,right,3);c.restore();
   }});
 });
}
function gate(services,color){
 return timed(services,5,({ball,game})=>{
  const target=services.getOpponent();if(!target)return false;
  const a=angleTo(ball,target),center=point(game,offset(ball,a,Math.min(75,distance(ball,target))));
  const hit=new Set();
  const ends=(age,side,map)=>{
   const p=offset(center,a,side*(36-26*clamp(age/2,0,1)));
   return [-25,25].map(n=>offset(p,a+Math.PI/2,n)).map(v=>map.clampPoint(v.x,v.y,2));
  };
  zone(services,'arena-gate',center,2,{
   update({entity,game,services:source},dt){
    for(const side of [-1,1]){
     const [left,right]=ends(entity.age+dt,side,arena(game));
     source.forEachContactEnemy(victim=>{
      if(hit.has(victim.instanceId)||!crossedStrip(oldPosition(victim),victim,left,right,victim.radius+2))return;
      hit.add(victim.instanceId);
      if(source.dealDamage(victim,3))push(source,victim,a+Math.PI/2,14);
     });
    }
   },
   draw({entity,game},c){
    c.save();c.strokeStyle=color;c.lineWidth=4;
    for(const side of [-1,1])line(c,...ends(entity.age,side,arena(game)));
    c.restore();
   }});
 });
}
function heatPump(services,color){
 let layers=0,readyAt=0;
 function shield(actor,target){
  const id=effectId(actor,'heat-shield');
  target.services.applyEffect(target,{id,duration:3,remaining:3,
   beforeDamage({ball,effect,services:source},event){
    if(event.amount<=0||B.isTrueDamage(event))return event;
    const absorb=Math.min(effect.remaining,event.amount);
    event.amount-=absorb;effect.remaining-=absorb;
    if(effect.remaining<=EPS)source.clearEffect(ball,id);
    return event;
   },
   draw({ball},c){warning(c,ball,ball.radius+3,color,1);}
  });
 }
 function charge({ball,game}){
  if(ball.hp<=0||game.time+EPS<readyAt||++layers<3)return;
  layers=0;readyAt=game.time+6;shield(ball,ball);
  const ally=services.getAllies().filter(b=>b!==ball&&b.hp>0&&distance(b,ball)<=90)
   .sort((a,b)=>a.hp-b.hp)[0];
  if(ally)shield(ball,ally);
 }
 return {
  onSpawn(){layers=0;readyAt=0;},onDamaged:charge,onDamagedWhileControlled:charge,
  getArenaExtensionState(){return {layers,readyAt};},
  drawAfter({ball},c){
   c.save();c.fillStyle=color;
   for(let i=0;i<layers;i++)c.fillRect(ball.x-7+i*5,ball.y+10,3,3);
   c.restore();
  }
 };
}
function lantern(services,color){
 let mark=null;
 return timed(services,5,({ball,game})=>{
  mark={x:ball.x,y:ball.y,expiresAt:game.time+5};
 },{
  onSpawn(){mark=null;},
  onDamaged({ball,game},event){
   if(!mark||game.time>=mark.expiresAt||ball.hp<=0||event.amount<=0)return;
   const p=point(game,mark,ball.radius);mark=null;
   ring(services,ball,color,24,.45);
   ball.x=ball.prevX=p.x;ball.y=ball.prevY=p.y;
  },
  drawArenaBackground({game},c){if(mark&&game.time<mark.expiresAt)warning(c,mark,12,color);}
 });
}
function stairs(services,color){
 return timed(services,5,({ball,game})=>{
  const map=arena(game),a=heading(ball);
  let count=0;
  for(let i=1;i<=4;i++){
   const p=offset(ball,a,i*19);
   if(!map.contains(p.x,p.y,8))break;
   count++;
   zone(services,'arena-step-light',p,3.7,{
    update({entity,services:source}){
     if(entity.age+EPS<i*.2)return;
     const candidates=[entity.owner,...source.getAllies(),...source.getEnemies()];
     const target=candidates.find(b=>b?.hp>0&&b.active!==false&&source.getContactProfile(b).solid&&inside(entity,b,8));
     if(!target)return;
     entity.entityActive=false;
     if(source.isEnemy(target))source.dealDamage(target,2);
     else boost(target.services,target,effectId(ball,'stairs'),1.25,.8);
     ring(source,entity,color,12);
    },
    draw({entity},c){
     c.save();c.globalAlpha*=entity.age<i*.2?.35:.85;c.strokeStyle=color;c.lineWidth=2;
     c.strokeRect(entity.x-7,entity.y-7,14,14);c.restore();
    }});
  }
  return count>0;
 });
}

const roster=[
 ['Riveter','铆钉钳','#cf8558',4,'.##../.##../..###/..#..',['投射物','强化'],'每4秒投出一枚贴墙铆钉，保留5秒，最多2枚。捡回后下次命中额外造成5点伤害。',riveter],
 ['Beacon','信号桩','#f3c568',3,'..#../.###./..#../#####',['陷阱','减速'],'每3秒投出一枚标记桩。落地后等待2秒，首个进入22范围的敌人受3点伤害并减速25%，持续1秒。',beacon],
 ['Pottery','陶甲','#dfa595',5,'.###./##.##/.###./..#..',['防御','加速'],'每5秒获得迎面护甲，最多等待2秒。抵消一次正面命中最多4点伤害后碎裂，提速20%持续1秒。',pottery],
 ['Tremor','震纹','#ef9f62',4,'#...#/.#.#./..#../#####',['范围','预警'],'每4秒在身后依次释放三道有预警的地面震波，每轮同一敌人最多受4点伤害。',tremor],
 ['Bellows','风箱','#86cdd3',3,'#####/.###./#####/.#.#.',['范围','击退'],'每3秒朝最近敌人吹出风带，持续1.2秒。敌人首次进入受2点伤害并被横向推开。',bellows],
 ['Cardboard','纸板工','#d2ae7d',5,'##.##/##.##/#####/##.##',['障碍','防御'],'每5秒在身后铺一块六段纸板，最多2块，各存留6秒。敌球或弹体破坏接触段，缺口足够宽时可通行。',cardboard],
 ['HourglassMagnet','沙漏磁盘','#b6a4ec',5,'#####/.#.#./..#../#####',['范围','击退'],'每5秒生成半径60的磁场，先牵引敌人，再将敌人推开并造成3点伤害。',magnet],
 ['KiteBox','风筝匣','#ef8d88',4,'..#../.###./..#../...##',['投射物','预警'],'每4秒放飞一只风筝，提前显示落点，1秒后落地对24范围内敌人造成4点伤害。',kite],
 ['Ruler','伸缩尺','#e4dc9c',3,'....#/#####/#.#.#/#####',['近战','强化'],'每3秒沿行进方向伸尺，命中造成4点伤害。落空碰墙时，下次伸出距离从62增至90。',ruler],
 ['RainBarrel','雨桶','#79c2e6',4,'.#.#./..#../#...#/.###.',['范围','预警'],'每4秒依次向敌人的三个历史位置落雨，每滴2点伤害；每轮同一敌人最多受两滴。',rain],
 ['FoldingBarrier','折尺','#c6bd73',5,'##.../.##../..##./...##',['障碍','击退'],'每5秒留下开合路障，持续3秒。每次展开改变触碰者方向，同一敌人最多受2点伤害。',foldingBarrier],
 ['TideWheel','潮轮','#75cfb3',4,'###../..###/###../..###',['投射物','范围'],'每4秒向两侧发出反向弧形波，每道3点伤害。同一敌人每轮最多受到一道。',tides],
 ['MirrorShard','碎镜','#b9d6f9',3,'.##../.#.#./#.##./..#..',['投射物','远程'],'每3秒向最近敌人射出三片散开的小镜，每片2点伤害。同一敌人每轮最多受到两片。',mirror],
 ['CarbonTape','复写带','#c995bb',5,'..##./.#..#/.###./#....',['范围','预警'],'每5秒记录自身位置并显示预警，1秒后对半径28内的敌人造成4点伤害。',carbon],
 ['InkStamp','胶印','#d77c9e',0,'.###./..#../#####/#...#',['近战','标记'],'撞击留下印记，最多两层，持续4秒。满两层敌球下次撞墙时额外受3点伤害并清空。',stamp],
 ['PrismLamp','棱灯','#ec9ce1',4,'#.#.#/.###./.###./#.#.#',['范围','预警'],'每4秒预告三个落点后依次闪光，每轮同一敌人最多受4点伤害。',prism],
 ['Spool','线轴','#ba94e8',5,'##.##/.###./.###./##.##',['陷阱','击退'],'每5秒放下两锚点并连线3秒。首个横穿的敌球受3点伤害并被沿线推开，随后断线。',spool],
 ['Gate','闸门','#e0a267',5,'#...#/#.#.#/#.#.#/#...#',['障碍','击退'],'每5秒生成两段缓慢合拢的横杆，持续2秒，端部可绕行。每轮触杆首次受3点伤害并被推开。',gate],
 ['HeatPump','热泵','#f2a078',0,'.#.#./#####/..#../.###.',['护盾','辅助'],'受伤积热三层后，给自己和90范围内生命最低的一名队友各提供3点护盾，持续3秒，冷却6秒。',heatPump],
 ['SlideLantern','幻灯','#a68fe2',5,'.###./.#.#./.#.#./.###.',['位移','标记'],'每5秒在自身经过的位置留下一处标记，存留至下次刷新。非致死受伤后移动到标记并清除它，原地闪光。',lantern],
 ['StepLight','阶梯灯','#b9dc72',5,'...##/..##./.##../##...',['陷阱','加速'],'每5秒沿行进方向逐格点亮最多四格。每格使用一次，友军提速25%持续0.8秒，敌方受2点伤害。',stairs]
];
root.ArenaRosterExpansion=roster.map(([key,name,color,period,glyph,tags,description,build])=>{
 const id='arena'+key;
 const pixels=glyph.split('/').flatMap((row,y)=>Array.from(row).flatMap((pixel,x)=>pixel==='#'?[[x,y]]:[]));
 B.registerBall({id,name,englishName:key,color,description,rosterType:'normal',
  stats:{radius:15,speed:150,maxHp:100},collisionDamage:2,rionCycleDuration:period||1,
  createBehavior(services){
   const behavior=build(services,color);
   return {...behavior,
    onCollision(context,target){
     context.services.dealDamage(target,2);
     if(target.hp>0&&services.getCapabilities(context.ball).canBodyAttack)behavior.onCollision?.(context,target);
    },
    drawAfter(context,c){
     const {ball}=context;
     c.save();c.translate(ball.x,ball.y-ball.radius*.5);c.scale(ball.radius/15,ball.radius/15);
     c.fillStyle='#192029';
     for(const [x,y] of pixels)c.fillRect((x-2.5)*1.8,(y-2)*1.4,1.8,1.4);
     c.restore();
     behavior.drawAfter?.(context,c);
    }
   };
  }});
 return {id,name,tags,description};
});
})(globalThis);
