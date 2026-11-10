(function(root){
'use strict';
const B=root.BallBattle,TAU=Math.PI*2,EPSILON=1e-9;
const MAX_POOLS=6,MAX_STRIPES=4,MAX_BOXES=3;

const specs=[
 ['arenaSpring','弹簧拳','#ff936d',3,'撞墙压缩弹簧，最多 3 层 / 接触敌人造成 4+2×层数伤害并击退 / 满 3 层眩晕且高压减伤'],
 ['arenaPainter','油漆匠','#bf8bea',1.6,'移动滴落油漆、撞墙刷漆线 / 油漆区域减速 35% 并持续伤害 / 最多 6 池、4 条线'],
 ['arenaCourier','快递员','#d6ac71',2.5,'快递箱绕身旋转 / 敌人触碰受到 7 点伤害并减速 / 箱子回收时回复 1 点、短暂加速并产生余波'],
 ['arenaBoomerang','回旋镖','#86d5af',2.4,'一次投出两枚回旋镖 / 碰墙反弹，最多 3 次 / 每个敌人每 0.5 秒最多受一次 3 点伤害'],
 ['arenaBubble','泡泡机','#8ddded',4,'周期进入无敌泡泡形态 / 破裂后 55 范围 5 点伤害并留下泡沫区域 / 区域减速并持续伤害'],
 ['arenaBattery','蓄电池','#dfed83',3,'受伤或撞墙蓄电，最多 4 层 / 接触敌人造成 2+2×电量伤害 / 满电自动放电并眩晕周围']
];

function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function effectId(owner,name){return 'arena-'+owner.instanceId+'-'+name;}
function nearestEnemy(origin,enemies){
 let nearest=null,distance=Infinity;
 for(const enemy of enemies){
  if(!enemy||enemy.hp<=0)continue;
  const d=Math.hypot(enemy.x-origin.x,enemy.y-origin.y);
  if(d<distance){distance=d;nearest=enemy;}
 }
 return nearest;
}
function stunEffect(owner,duration){
 return {
  id:effectId(owner,'stun'),visualType:'stun',duration,locksMovement:true,preventsAttack:true,pausesBehavior:true,
  onApply({ball}){ball.vx=0;ball.vy=0;},
  update({ball,effect,game}){if(game.time<effect.expiresAt){ball.vx=0;ball.vy=0;}},
  onExpire({ball}){ball.speedNeedsNormalization=true;}
 };
}
function applyStun(services,owner,target,duration){if(target)services.applyEffect(target,stunEffect(owner,duration));}
function applySlow(services,owner,target,duration,factor,name='slow'){
 if(target)services.applyEffect(target,{id:effectId(owner,name),duration,speedFactor:factor,visualType:'slow'});
}
function ring(services,x,y,color,radius=22,life=.35){
 services.spawnVisualEffect({kind:'arena-ring',x,y,life,color,radius,draw({effect:e},c){
  c.save();c.globalAlpha*=Math.max(0,1-e.age/e.life);c.strokeStyle=e.color;c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,e.radius*(.45+.55*Math.min(1,e.age/e.life)),0,TAU);c.stroke();c.restore();
 }});
}
function lightning(services,points,color='#d9f4ff'){
 if(!points||points.length<2)return;
 services.spawnVisualEffect({kind:'arena-lightning',life:.28,points:points.map(p=>({x:p.x,y:p.y})),color,draw({effect:e},c){
  c.save();c.globalAlpha*=Math.max(0,1-e.age/e.life);c.lineCap='round';
  for(let pass=0;pass<2;pass++){
   c.strokeStyle=pass===0?'rgba(27,32,39,.9)':e.color;c.lineWidth=pass===0?4:1.8;c.beginPath();
   for(let segment=0;segment<e.points.length-1;segment++){
    const a=e.points[segment],b=e.points[segment+1],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,nx=-dy/length,ny=dx/length;
    c.moveTo(a.x,a.y);
    for(let step=1;step<5;step++){
     const t=step/5,offset=Math.sin((segment*5+step)*2.37)*3.2;
     c.lineTo(a.x+dx*t+nx*offset,a.y+dy*t+ny*offset);
    }
    c.lineTo(b.x,b.y);
   }
   c.stroke();
  }
  c.restore();
 }});
}
function knockback(services,owner,target,angle,distance){
 if(!target||!Number.isFinite(angle))return;
 services.applyEffect(target,B.createKnockbackEffect({
  id:effectId(owner,'knock'),duration:.2,directionX:Math.cos(angle),directionY:Math.sin(angle),distance,speedMultiplier:1.6
 }));
}
function pointSegmentDistance(x,y,x1,y1,x2,y2){
 const dx=x2-x1,dy=y2-y1,lengthSquared=dx*dx+dy*dy;
 if(lengthSquared<=EPSILON)return Math.hypot(x-x1,y-y1);
 const t=clamp(((x-x1)*dx+(y-y1)*dy)/lengthSquared,0,1);
 return Math.hypot(x-(x1+dx*t),y-(y1+dy*t));
}
function drawBody({ball},c){
 c.save();c.fillStyle=ball.color;c.strokeStyle='#f6f0df';c.lineWidth=1.2;
 c.beginPath();c.arc(ball.x,ball.y,ball.radius,0,TAU);c.fill();c.stroke();
 c.fillStyle='rgba(0,0,0,.12)';c.beginPath();c.arc(ball.x,ball.y,ball.radius*.8,0,TAU);c.fill();c.restore();return true;
}
function glyph(c,id,x,y,r,color){
 c.save();c.translate(x,y);c.strokeStyle='#1b2027';c.fillStyle='#1b2027';c.lineWidth=2;c.lineCap='round';c.lineJoin='round';
 if(id==='arenaSpring'){
  c.beginPath();c.moveTo(r*.55,-r*.55);for(let i=0;i<5;i++)c.lineTo(r*(.55+(i%2)*.28),r*(-.4+i*.23));c.stroke();
  c.fillStyle=color;c.fillRect(r*.45,-r*.9,r*.5,r*.4);
 }else if(id==='arenaPainter'){
  c.fillStyle=color;c.fillRect(-r*.9,-r*.7,r*.7,r*.35);c.strokeRect(-r*.9,-r*.7,r*.7,r*.35);
  c.beginPath();c.moveTo(-r*.45,-r*.3);c.lineTo(-r*.45,r*.6);c.stroke();
 }else if(id==='arenaCourier'){
  c.fillStyle='#ab7545';c.fillRect(r*.35,-r*.85,r*.65,r*.65);c.strokeRect(r*.35,-r*.85,r*.65,r*.65);
  c.strokeStyle='#f9dfb3';c.beginPath();c.moveTo(r*.67,-r*.85);c.lineTo(r*.67,-r*.2);c.stroke();
 }else if(id==='arenaBoomerang'){
  c.strokeStyle='#efd590';c.lineWidth=4;c.beginPath();c.moveTo(-r*.85,-r*.25);c.lineTo(-r*.65,-r*.9);c.lineTo(r*.1,-r*.85);c.stroke();
 }else if(id==='arenaBubble'){
  c.strokeStyle='#fff';for(let i=0;i<3;i++){c.beginPath();c.arc(r*(.45+i*.22),r*(-.6-i*.2),r*(.22-i*.04),0,TAU);c.stroke();}
 }else if(id==='arenaBattery'){
  c.strokeStyle='#364719';c.lineWidth=3;c.beginPath();c.moveTo(r*.72,-r*.8);c.lineTo(r*.4,-r*.2);c.lineTo(r*.85,-r*.2);c.lineTo(r*.45,r*.7);c.stroke();
 }
 c.restore();
}
function drawGlyph(ball,id,c){glyph(c,id,ball.x,ball.y,ball.radius,ball.color);}

function createSpring(services){
 let stacks=0,wallHits=0,collisions=0,lastPulseAt=-Infinity;
 function refreshSpeed(ball){
  if(stacks<=0)return;
  services.applyEffect(ball,{id:effectId(ball,'tension'),duration:5,speedFactor:1+stacks*.08,visualType:'haste'});
 }
 return {
  onSpawn(){stacks=0;wallHits=0;collisions=0;lastPulseAt=-Infinity;},
  onWallBounce(context){
   stacks=Math.min(3,stacks+1);wallHits++;refreshSpeed(context.ball);
   const point=(B.getArenaWallContacts(context)||[])[0]||context.ball;
   if(context.game.time-lastPulseAt>=.7){
    lastPulseAt=context.game.time;
    services.forEachEnemy(enemy=>{if(Math.hypot(enemy.x-point.x,enemy.y-point.y)<=38+enemy.radius)services.dealDamage(enemy,3);});
   }
   ring(services,point.x,point.y,context.ball.color,14,.28);
  },
  onBeforeDamage(context,event){
   if(event&&event.amount>0&&stacks>0)event.amount*=1-stacks*.12;
   return event;
  },
  onCollision(context,target){
   if(!target)return;
   const ball=context.ball,amount=4+stacks*2;
   if(!context.services.dealDamage(target,amount))return;
   const angle=Math.atan2(target.y-ball.y,target.x-ball.x);
   knockback(context.services,ball,target,angle,10+stacks*2);
   if(stacks>=3)applyStun(context.services,ball,target,.35);
   ring(context.services,ball.x,ball.y,ball.color,18+stacks*3);
   collisions++;stacks=0;services.clearEffect(ball,effectId(ball,'tension'));
  },
  getArenaExtensionState(){return {stacks,wallHits,collisions};},
  drawBody,
  drawAfter({ball},c){drawGlyph(ball,'arenaSpring',c);}
 };
}

function createPainter(services){
 const interval=1.6,POOL_RADIUS=30,POOL_LIFE=6,STRIPE_LIFE=8;
 let clock=0,attacks=0,pools=[],stripes=[],lastPoolTick=-Infinity,lastStripeTick=-Infinity;
 function addPool(ball){
  if(pools.length>=MAX_POOLS){const old=pools.shift();if(old)old.entityActive=false;}
  const pool=services.spawnCombatEntity({kind:'arena-paint-pool',x:ball.x,y:ball.y,radius:POOL_RADIUS,life:POOL_LIFE,drawLayer:'background',
   draw({effect:e},c){c.save();c.globalAlpha*=.22*Math.min(1,(e.life-e.age)*2);c.fillStyle='#bf8bea';c.beginPath();c.ellipse(e.x,e.y,e.radius,e.radius*.83,-.3,0,TAU);c.fill();c.globalAlpha*=2;c.strokeStyle='#d0a9ef';c.lineWidth=.8;c.stroke();c.restore();}
  },{lifecycle:'owner-bound'});
  pools.push(pool);attacks++;
 }
 function addStripe(context){
  const arena=B.resolveArenaGeometry(context.game),contacts=B.getArenaWallContacts(context);
  const contact=contacts[0];if(!contact)return;
  const tangentX=-contact.normalY,tangentY=contact.normalX,half=28;
  const first=arena.clampPoint(contact.x-tangentX*half,contact.y-tangentY*half,2);
  const second=arena.clampPoint(contact.x+tangentX*half,contact.y+tangentY*half,2);
  if(stripes.length>=MAX_STRIPES){const old=stripes.shift();if(old)old.entity.entityActive=false;}
  const entity=services.spawnCombatEntity({kind:'arena-paint-stripe',life:STRIPE_LIFE,drawLayer:'background',x1:first.x,y1:first.y,x2:second.x,y2:second.y,
   draw({effect:e},c){c.save();c.globalAlpha*=.46*Math.min(1,(e.life-e.age)*2);c.strokeStyle='#bf8bea';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(e.x1,e.y1);c.lineTo(e.x2,e.y2);c.stroke();c.globalAlpha*=.8;c.strokeStyle='#e0bdff';c.lineWidth=1.4;c.stroke();c.restore();}
  },{lifecycle:'owner-bound'});
  stripes.push({entity,x1:first.x,y1:first.y,x2:second.x,y2:second.y});attacks++;
 }
 return {
  onSpawn(){clock=0;attacks=0;pools=[];stripes=[];lastPoolTick=-Infinity;lastStripeTick=-Infinity;},
  update({ball,game},dt){
   clock+=dt;while(clock+EPSILON>=interval){clock-=interval;addPool(ball);}
   pools=pools.filter(pool=>pool.entityActive!==false);
   stripes=stripes.filter(stripe=>stripe.entity.entityActive!==false);
   const now=game.time;let poolTouched=false,stripeTouched=false;
   services.forEachEnemy(enemy=>{
    let inPool=false,inStripe=false;
    for(const pool of pools)if(Math.hypot(enemy.x-pool.x,enemy.y-pool.y)<=pool.radius+enemy.radius){inPool=true;break;}
    for(const stripe of stripes)if(pointSegmentDistance(enemy.x,enemy.y,stripe.x1,stripe.y1,stripe.x2,stripe.y2)<=enemy.radius+4){inStripe=true;break;}
    if(!inPool&&!inStripe)return;
    applySlow(services,ball,enemy,.3,.65,'paint');
    if(inPool&&now-lastPoolTick>=.8&&services.dealDamage(enemy,3))poolTouched=true;
    if(inStripe&&now-lastStripeTick>=.5&&services.dealDamage(enemy,2))stripeTouched=true;
   });
   if(poolTouched)lastPoolTick=now;
   if(stripeTouched)lastStripeTick=now;
  },
  onWallBounce(context){addStripe(context);},
  getNextTransitionIn(){return Math.max(.001,Math.min(interval-clock,.25));},
  getArenaExtensionState(){return {clock,pools:pools.length,stripes:stripes.length,attacks};},
  drawBody,
  drawAfter({ball},c){drawGlyph(ball,'arenaPainter',c);},
  onBattleDispose(){pools.forEach(pool=>pool.entityActive=false);stripes.forEach(stripe=>stripe.entity.entityActive=false);pools=[];stripes=[];}
 };
}

function createCourier(services){
 const interval=2.5,MAX_BOX_COUNT=3,ORBIT_RADIUS=40,ORBIT_SPEED=1.8,BOX_LIFE=3.2,HIT_COOLDOWN=.8;
 let clock=0,orbitAngle=0,spawns=0,hits=0,pickups=0,boxes=[];
 function addBox(){if(boxes.length>=MAX_BOX_COUNT)boxes.shift();boxes.push({offset:boxes.length*TAU/3,age:0,cooldowns:new Map()});spawns++;}
 return {
  onSpawn(){clock=0;orbitAngle=0;spawns=0;hits=0;pickups=0;boxes=[];},
  update({ball,game},dt){
   clock+=dt;while(clock+EPSILON>=interval){clock-=interval;addBox();}
   orbitAngle+=ORBIT_SPEED*dt;
   for(const box of boxes){
    box.age+=dt;
    const angle=orbitAngle+box.offset;
    const boxX=ball.x+Math.cos(angle)*ORBIT_RADIUS,boxY=ball.y+Math.sin(angle)*ORBIT_RADIUS;
    services.forEachEnemy(enemy=>{
     if(Math.hypot(enemy.x-boxX,enemy.y-boxY)>15+enemy.radius)return;
     if((box.cooldowns.get(enemy.instanceId)||-Infinity)+HIT_COOLDOWN>game.time)return;
     box.cooldowns.set(enemy.instanceId,game.time);
     if(services.dealDamage(enemy,7)){hits++;applySlow(services,ball,enemy,1.2,.65,'courier');}
    });
   }
   const kept=[];
   for(const box of boxes){
    if(box.age<BOX_LIFE){kept.push(box);continue;}
    if(ball.hp>0){
     ball.hp=Math.min(ball.maxHp,ball.hp+1);
     services.spawnHitText(ball,'+1',{color:'#8fefb4'});
     services.applyEffect(ball,{id:effectId(ball,'courier-haste'),duration:2,speedFactor:1.25,visualType:'haste'});
     services.forEachEnemy(enemy=>{if(Math.hypot(enemy.x-ball.x,enemy.y-ball.y)<=35+enemy.radius){if(services.dealDamage(enemy,5)){hits++;applySlow(services,ball,enemy,1,.65,'courier');}}});
     pickups++;
    }
    ring(services,ball.x,ball.y,ball.color,35);
   }
   boxes=kept;
  },
  onBeforeDamage(context,event){if(event&&event.amount>0&&boxes.length>0)event.amount*=1-Math.min(.24,boxes.length*.08);return event;},
  getNextTransitionIn(){return Math.max(.001,Math.min(interval-clock,.25));},
  getArenaExtensionState(){return {clock,spawns,hits,pickups,boxes:boxes.length};},
  drawBody,
  drawAfter({ball},c){
   drawGlyph(ball,'arenaCourier',c);
   c.save();c.globalAlpha*=.32;c.setLineDash([3,4]);c.strokeStyle=ball.color;c.lineWidth=1;c.beginPath();c.arc(ball.x,ball.y,ORBIT_RADIUS,0,TAU);c.stroke();c.setLineDash([]);
   for(const box of boxes){const angle=orbitAngle+box.offset,x=ball.x+Math.cos(angle)*ORBIT_RADIUS,y=ball.y+Math.sin(angle)*ORBIT_RADIUS;c.globalAlpha*=.9;c.fillStyle='#9a6a3d';c.strokeStyle='#f9dfb3';c.lineWidth=1;c.fillRect(x-8,y-8,16,16);c.strokeRect(x-8,y-8,16,16);c.strokeStyle='#e0bdff';c.beginPath();c.moveTo(x-5,y);c.lineTo(x+5,y);c.moveTo(x,y-5);c.lineTo(x,y+5);c.stroke();}
   c.restore();
  }
 };
}

function createBoomerang(services){
 const interval=2.4,SPEED=320,MAX_BOUNCES=3;
 let clock=0,attacks=0,hits=0;
 function throwBoomerang(ball,game){
  const target=services.getOpponent();if(!target)return false;
  const angle=Math.atan2(target.y-ball.y,target.x-ball.x);attacks++;
  for(const spread of [-.1,.1])services.spawnProjectile({kind:'arena-boomerang',x:ball.x,y:ball.y,vx:Math.cos(angle+spread)*SPEED,vy:Math.sin(angle+spread)*SPEED,radius:6,life:2.4,damage:3,hitAt:new Map(),
   update({effect:e,services:s,game:g},dt){
    const arena=B.resolveArenaGeometry(g);
    const motion=arena.advanceMotion({x:e.x,y:e.y,vx:e.vx,vy:e.vy,radius:e.radius},dt,{maxBounces:MAX_BOUNCES});
    for(const segment of motion.segments){
     s.forEachEnemy(enemy=>{
      const last=e.hitAt.get(enemy.instanceId)||-Infinity;
      if(g.time-last<.5)return;
      if(B.firstSegmentCircleContact(segment.x1,segment.y1,segment.x2,segment.y2,enemy.x,enemy.y,enemy.radius+e.radius)===null)return;
      e.hitAt.set(enemy.instanceId,g.time);
      if(s.dealDamage(enemy,3)){hits++;ring(s,enemy.x,enemy.y,ball.color,14);}
     });
    }
    e.x=motion.x;e.y=motion.y;e.vx=motion.vx;e.vy=motion.vy;
    if(motion.blocked)e.life=0;
   },
   draw({effect:e},c){c.save();c.translate(e.x,e.y);c.rotate(e.age*15);c.strokeStyle='#e2efb7';c.lineWidth=4;c.lineJoin='round';c.beginPath();c.moveTo(-7,-3);c.lineTo(0,4);c.lineTo(7,-3);c.stroke();c.restore();}
  });
  return true;
 }
 return {
  onSpawn(){clock=0;attacks=0;hits=0;},
  update({ball,game},dt){clock+=dt;while(clock+EPSILON>=interval){clock-=interval;throwBoomerang(ball,game);}},
  getNextTransitionIn(){return Math.max(.001,interval-clock);},
  getArenaExtensionState(){return {clock,attacks,hits};},
  drawBody,
  drawAfter({ball},c){drawGlyph(ball,'arenaBoomerang',c);}
 };
}

function createBubble(services){
 const SOLID_TIME=2.8,BUBBLE_TIME=1.2;
 let phaseTime=0,bubbled=false,pops=0,contactHits=0,cloud=null;
 function enterBubble(ball){
  bubbled=true;phaseTime=0;
  services.applyEffect(ball,{id:effectId(ball,'bubble-form'),duration:BUBBLE_TIME,locksMovement:true,preventsAttack:true,
   onApply({ball}){ball.vx=0;ball.vy=0;},update({ball,effect,game}){if(game.time<effect.expiresAt){ball.vx=0;ball.vy=0;}},
   onExpire({ball}){ball.speedNeedsNormalization=true;}
  });
 }
 function pop(ball,game){
  bubbled=false;phaseTime=0;services.clearEffect(ball,effectId(ball,'bubble-form'));
  services.forEachEnemy(enemy=>{
   if(Math.hypot(enemy.x-ball.x,enemy.y-ball.y)>55+enemy.radius)return;
   if(services.dealDamage(enemy,5))applyStun(services,ball,enemy,.25);
  });
  if(cloud)cloud.entityActive=false;
  cloud=services.spawnCombatEntity({kind:'arena-bubble-cloud',x:ball.x,y:ball.y,radius:55,life:1,nextTick:0,drawLayer:'background',
   update({effect:e,services:s,game:g}){
    if(g.time+EPSILON<e.nextTick)return;
    e.nextTick=g.time+.3;
    s.forEachEnemy(enemy=>{
     if(Math.hypot(enemy.x-e.x,enemy.y-e.y)>e.radius+enemy.radius)return;
     if(s.dealDamage(enemy,2))applySlow(s,ball,enemy,.4,.65,'bubble-cloud');
    });
   },
   draw({effect:e},c){c.save();const fade=Math.max(0,Math.min(1,(e.life-e.age)*3));c.globalAlpha*=.12*fade;c.fillStyle='#8ddded';c.beginPath();c.arc(e.x,e.y,e.radius,0,TAU);c.fill();c.globalAlpha*=.7*fade;c.strokeStyle='#c9f5ff';c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,e.radius*.92,0,TAU);c.stroke();c.restore();}
  },{lifecycle:'owner-bound'});
  pops++;ring(services,ball.x,ball.y,ball.color,58);services.playSound('hit');
 }
 return {
  onSpawn(){phaseTime=0;bubbled=false;pops=0;contactHits=0;cloud=null;},
  update({ball,game},dt){
   phaseTime+=dt;
   if(!bubbled&&phaseTime+EPSILON>=SOLID_TIME)enterBubble(ball);
   else if(bubbled&&phaseTime+EPSILON>=BUBBLE_TIME)pop(ball,game);
   if(cloud&&cloud.entityActive===false)cloud=null;
  },
  getNextTransitionIn(){return Math.max(.001,(bubbled?BUBBLE_TIME:SOLID_TIME)-phaseTime);},
  getContactProfile(){return bubbled?{physical:false,targetable:false}:null;},
  onBeforeDamage(context,event){return bubbled?{amount:0,showHitText:false,cancelAttack:true}:event;},
  onCollision(context,target){if(!bubbled&&target&&context.services.dealDamage(target,3))contactHits++;},
  getArenaExtensionState(){return {phaseTime,bubbled,pops,contactHits,cloud:!!cloud};},
  drawBody,
  drawAfter({ball},c){
   if(bubbled){c.save();c.globalAlpha*=.38;c.fillStyle='rgba(141,221,237,.18)';c.strokeStyle='#c9f5ff';c.lineWidth=2;c.beginPath();c.arc(ball.x,ball.y,ball.radius+9+Math.sin(ball.x*.2)*1.5,0,TAU);c.fill();c.stroke();c.restore();}
   drawGlyph(ball,'arenaBubble',c);
  },
  onBattleDispose(){if(cloud)cloud.entityActive=false;cloud=null;}
 };
}

function createBattery(services){
 let charge=0,discharges=0,hits=0,wallHits=0,lastWallChargeAt=-Infinity,autoClock=0;
 function fire(ball,target){
  const amount=2+2*charge;
  if(!services.dealDamage(target,amount))return false;
  const points=[{x:ball.x,y:ball.y},{x:target.x,y:target.y}];
  if(charge>=4){
   services.forEachEnemy(enemy=>{
    if(enemy===target)return;
    if(Math.hypot(enemy.x-ball.x,enemy.y-ball.y)>55+enemy.radius)return;
    if(services.dealDamage(enemy,5))applyStun(services,ball,enemy,.3);
    points.push({x:enemy.x,y:enemy.y});
   });
  }
  knockback(services,ball,target,Math.atan2(target.y-ball.y,target.x-ball.x),8+charge*2);
  lightning(services,points,'#e8ff8a');ring(services,ball.x,ball.y,ball.color,18+charge*5);
  hits++;discharges++;charge=0;autoClock=0;
  return true;
 }
 return {
  onSpawn(){charge=0;discharges=0;hits=0;wallHits=0;lastWallChargeAt=-Infinity;autoClock=0;},
  onDamaged(context,event){if(event.amount>0)charge=Math.min(4,charge+1);},
  onWallBounce(context){
   wallHits++;
   if(context.game.time-lastWallChargeAt>=1.2){charge=Math.min(4,charge+1);lastWallChargeAt=context.game.time;}
   const point=(B.getArenaWallContacts(context)||[])[0]||context.ball;ring(services,point.x,point.y,context.ball.color,12,.25);
  },
  update({ball,game},dt){
   if(charge>=4){
    autoClock+=dt;
    if(autoClock+EPSILON>=2.5){
     const target=nearestEnemy(ball,services.getEnemies());
     if(target)fire(ball,target);
     else autoClock=0;
    }
   }else autoClock=0;
  },
  onCollision(context,target){if(target)fire(context.ball,target);},
  getNextTransitionIn(){return .25;},
  getArenaExtensionState(){return {charge,discharges,hits,wallHits};},
  drawBody,
  drawAfter({ball},c){drawGlyph(ball,'arenaBattery',c);}
 };
}

const builders={
 arenaSpring:createSpring,
 arenaPainter:createPainter,
 arenaCourier:createCourier,
 arenaBoomerang:createBoomerang,
 arenaBubble:createBubble,
 arenaBattery:createBattery
};

for(const spec of specs){
 const [id,name,color,interval,description]=spec;
 B.registerBall({id,name,englishName:id.replace('arena',''),color,description,rosterType:'normal',stats:{radius:15,speed:150,maxHp:100},rionCycleDuration:interval,createBehavior:builders[id]});
}

root.ArenaCharacters={specs,glyph};
})(globalThis);
