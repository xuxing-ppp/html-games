(function(root){
'use strict';
const B=root.BallBattle, TAU=Math.PI*2;
const specs=[
 ['arenaSpring','弹簧拳','#ff936d',3,'每 3 秒发射短程弹簧拳 / 6 点伤害并击退'],
 ['arenaPainter','油漆匠','#bf8bea',2,'每 2 秒留下持续 6 秒的油漆 / 区域减速 25% / 同源不叠加，最多 6 区'],
 ['arenaCourier','快递员','#d6ac71',5,'每 5 秒向最近敌人投递包裹 / 预警 1 秒后范围爆炸 10 点'],
 ['arenaBoomerang','回旋镖','#86d5af',4,'每 4 秒发射回旋镖 / 去程与回程各造成 4 点伤害'],
 ['arenaBubble','泡泡机','#8ddded',3,'每 3 秒发射泡泡 / 2 点伤害 / 减速 40%，持续 1.5 秒'],
 ['arenaBattery','蓄电池','#dfed83',5,'实际受伤的 30% 转为电量，上限 20 / 每 5 秒向 65 范围敌人放电 / 未命中保留电量']
];
function ring(services,x,y,color,radius=22){services.spawnVisualEffect({kind:'arena-burst',x,y,life:.35,draw({effect:e},c){c.save();c.globalAlpha*=1-e.age/e.life;c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,radius*(.5+e.age/e.life),0,TAU);c.stroke();c.restore();}});}
function glyph(c,id,x,y,r,color){
 c.save();c.translate(x,y);c.strokeStyle='#1b2027';c.fillStyle='#1b2027';c.lineWidth=2;c.lineCap='round';
 if(id==='arenaSpring'){c.beginPath();c.moveTo(r*.55,-r*.55);for(let i=0;i<5;i++)c.lineTo(r*(.55+(i%2)*.28),r*(-.4+i*.23));c.stroke();c.fillStyle=color;c.fillRect(r*.45,-r*.9,r*.5,r*.4);}
 else if(id==='arenaPainter'){c.fillStyle=color;c.fillRect(-r*.9,-r*.7,r*.7,r*.35);c.strokeRect(-r*.9,-r*.7,r*.7,r*.35);c.beginPath();c.moveTo(-r*.45,-r*.3);c.lineTo(-r*.45,r*.6);c.stroke();}
 else if(id==='arenaCourier'){c.fillStyle='#ab7545';c.fillRect(r*.35,-r*.85,r*.65,r*.65);c.strokeRect(r*.35,-r*.85,r*.65,r*.65);c.strokeStyle='#f9dfb3';c.beginPath();c.moveTo(r*.67,-r*.85);c.lineTo(r*.67,-r*.2);c.stroke();}
 else if(id==='arenaBoomerang'){c.strokeStyle='#efd590';c.lineWidth=4;c.beginPath();c.moveTo(-r*.85,-r*.25);c.lineTo(-r*.65,-r*.9);c.lineTo(r*.1,-r*.85);c.stroke();}
 else if(id==='arenaBubble'){c.strokeStyle='#fff';for(let i=0;i<3;i++){c.beginPath();c.arc(r*(.45+i*.22),r*(-.6-i*.2),r*(.22-i*.04),0,TAU);c.stroke();}}
 else {c.strokeStyle='#364719';c.lineWidth=3;c.beginPath();c.moveTo(r*.72,-r*.8);c.lineTo(r*.4,-r*.2);c.lineTo(r*.85,-r*.2);c.lineTo(r*.45,r*.7);c.stroke();}
 c.restore();
}
function bullet(owner,services,spec,bubble){
 const target=services.getOpponent();if(!target)return;
 const angle=Math.atan2(target.y-owner.y,target.x-owner.x),speed=bubble?115:235;
 services.spawnProjectile({kind:bubble?'arena-bubble-shot':'arena-spring-shot',x:owner.x,y:owner.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:bubble?6:5,life:bubble?2:.44,damage:bubble?2:6,
 update({effect:e,services:s},dt){const x=e.x,y=e.y;e.x+=e.vx*dt;e.y+=e.vy*dt;const hit=s.getFirstEnemyHit(x,y,e.x,e.y,e.radius);if(!hit)return;
  if(s.dealDamage(hit,bubble?2:6)){
   if(bubble)s.applyEffect(hit,{id:'arena-bubble-slow',duration:1.5,speedFactor:.6,visualType:'slow'});
   else if(s.getContactProfile(hit).solid&&!s.isMovementLocked(hit))s.applyEffect(hit,{id:'arena-spring-push',duration:.12,onApply({ball}){const m=Math.hypot(e.vx,e.vy)||1;const a=B.resolveArenaGeometry(s.engine?.game||{arenaSize:200});const p=a.clampPoint(ball.x+e.vx/m*9,ball.y+e.vy/m*9,ball.radius);ball.x=p.x;ball.y=p.y;}});
   ring(s,e.x,e.y,spec[2],bubble?12:18);
  } e.life=0;
 },draw({effect:e},c){c.save();c.strokeStyle=bubble?'#c9f5ff':spec[2];c.fillStyle=spec[2];c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,e.radius,0,TAU);if(!bubble)c.fill();c.stroke();if(bubble){c.beginPath();c.arc(e.x-1,e.y-1,2,Math.PI,1.5*Math.PI);c.stroke();}c.restore();}});
}
function paint(owner,services,pools){
 while(pools.length>=6){pools.shift().life=0;}
 const pool=services.spawnCombatEntity({kind:'arena-paint',x:owner.x,y:owner.y,radius:25,life:6,drawLayer:'background',
 update({effect:e,services:s}){s.forEachEnemy(t=>{if(Math.hypot(t.x-e.x,t.y-e.y)<=e.radius+t.radius)s.applyEffect(t,{id:'arena-paint-'+owner.instanceId,duration:.06,speedFactor:.75,visualType:'slow'});});},
 draw({effect:e},c){c.save();c.globalAlpha*=.22*Math.min(1,(e.life-e.age)*2);c.fillStyle='#bf8bea';c.beginPath();c.ellipse(e.x,e.y,e.radius,e.radius*.83,-.3,0,TAU);c.fill();c.globalAlpha*=2;c.strokeStyle='#d0a9ef';c.lineWidth=.8;c.stroke();c.restore();}});
 pools.push(pool);
}
function parcel(owner,services){
 const t=services.getOpponent();if(!t)return;
 services.spawnCombatEntity({kind:'arena-parcel',x:t.x,y:t.y,radius:30,life:1.04,exploded:false,
 update({effect:e,services:s}){if(e.exploded||e.age<1)return;e.exploded=true;s.forEachEnemy(t=>{if(Math.hypot(t.x-e.x,t.y-e.y)<=e.radius+t.radius)s.dealDamage(t,10);});ring(s,e.x,e.y,'#ffba72',32);s.playSound('hit');e.life=0;},
 draw({effect:e},c){c.save();c.strokeStyle='#ffba72';c.fillStyle='rgba(255,186,114,.09)';c.lineWidth=1;c.setLineDash([3,3]);c.beginPath();c.arc(e.x,e.y,e.radius,0,TAU);c.fill();c.stroke();c.setLineDash([]);c.lineWidth=2;c.beginPath();c.arc(e.x,e.y,e.radius,-Math.PI/2,-Math.PI/2+TAU*Math.min(1,e.age));c.stroke();c.fillStyle='#ba874b';c.fillRect(e.x-5,e.y-5,10,10);c.strokeRect(e.x-5,e.y-5,10,10);c.restore();}});
}
function boomerang(owner,services){
 const t=services.getOpponent();if(!t)return;const a=Math.atan2(t.y-owner.y,t.x-owner.x),dx=Math.cos(a),dy=Math.sin(a),ox=owner.x,oy=owner.y;
 services.spawnProjectile({kind:'arena-boomerang',x:ox,y:oy,vx:dx*160,vy:dy*160,radius:6,life:1.6,damage:4,outHits:new Set(),inHits:new Set(),
 update({effect:e,services:s},dt){const prev={x:e.x,y:e.y};const travel=e.age<=.8?e.age:1.6-e.age;e.x=ox+dx*160*Math.max(0,travel);e.y=oy+dy*160*Math.max(0,travel);const hits=e.age<=.8?e.outHits:e.inHits;
 s.forEachEnemy(t=>{if(hits.has(t.instanceId))return;const hit=B.firstSegmentCircleContact(prev.x,prev.y,e.x,e.y,t.x,t.y,t.radius+e.radius);if(hit!==null){hits.add(t.instanceId);if(s.dealDamage(t,4))ring(s,t.x,t.y,'#86d5af',14);}});},
 draw({effect:e},c){c.save();c.translate(e.x,e.y);c.rotate(e.age*13);c.strokeStyle='#e2efb7';c.lineWidth=4;c.lineJoin='round';c.beginPath();c.moveTo(-7,-3);c.lineTo(0,4);c.lineTo(7,-3);c.stroke();c.restore();}});
}
for(const spec of specs){const [id,name,color,interval,description]=spec;
 B.registerBall({id,name,englishName:id.replace('arena',''),color,description,rosterType:'normal',stats:{radius:15,speed:150,maxHp:100},rionCycleDuration:interval,
 createBehavior(services){let clock=0,charge=0,pools=[];return {
 onSpawn(){clock=0;charge=0;pools=[];},
 update({ball},dt){clock+=dt;pools=pools.filter(p=>p.entityActive!==false&&p.age<p.life);while(clock+1e-9>=interval){clock-=interval;
  if(id==='arenaSpring'||id==='arenaBubble')bullet(ball,services,spec,id==='arenaBubble');
  if(id==='arenaPainter')paint(ball,services,pools);
  if(id==='arenaCourier')parcel(ball,services);
  if(id==='arenaBoomerang')boomerang(ball,services);
  if(id==='arenaBattery'&&charge>0){const targets=services.getEnemies().filter(t=>Math.hypot(t.x-ball.x,t.y-ball.y)<=65+t.radius);let hit=false;for(const t of targets)hit=services.dealDamage(t,charge)||hit;if(hit){ring(services,ball.x,ball.y,color,65);charge=0;services.playSound('hit');}}
 }},
 onDamaged(context,event){if(id==='arenaBattery')charge=Math.min(20,charge+Math.max(0,event.amount)*.3);},
 getNextTransitionIn(){return Math.max(.001,interval-clock);},
 getArenaExtensionState(){return {clock,charge,pools:pools.length};},
 drawBody({ball},c){c.save();c.fillStyle=color;c.strokeStyle='#f6f0df';c.lineWidth=1.2;c.beginPath();c.arc(ball.x,ball.y,ball.radius,0,TAU);c.fill();c.stroke();c.fillStyle='rgba(0,0,0,.12)';c.beginPath();c.arc(ball.x,ball.y,ball.radius*.8,0,TAU);c.fill();c.restore();return true;},
 drawAfter({ball},c){glyph(c,id,ball.x,ball.y,ball.radius,color);c.save();c.strokeStyle=color;c.globalAlpha*=.65;c.lineWidth=1.7;c.beginPath();c.arc(ball.x,ball.y,ball.radius+4,-Math.PI/2,-Math.PI/2+TAU*Math.min(1,clock/interval));c.stroke();if(id==='arenaBattery'&&charge>0){c.fillStyle='#f4ffaf';c.fillRect(ball.x-ball.radius,ball.y+ball.radius+6,2*ball.radius*charge/20,2);}c.restore();},
 onBattleDispose(){pools.forEach(p=>p.life=0);pools=[];charge=0;}
 };}});
}
root.ArenaCharacters={specs,glyph};
})(globalThis);
