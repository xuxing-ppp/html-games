(function(root){
'use strict';
const B=root.BallBattle;
class ArenaMechanisms{
 constructor(engine,options={}){
  this.engine=engine;this.options={...options};this.time=0;this.cooldowns=new Map();this.supplies=[];this.nextSupply=10;this.nextLaser=12;this.sweep=null;this.laserNumber=0;
  this.actor={instanceId:'arena-neutral',id:'arena-neutral',name:'场地机关',teamId:'arena-neutral',isCombatEntity:true,active:true,hp:1,maxHp:1,x:engine.arenaSize/2,y:engine.arenaSize/2,radius:0,effects:new Map(),replayFrames:[],replayEvents:[],damageOutputScale:1};
  // Skill-kind neutral damage intentionally follows the same targetability and defenses as an ordinary attack.
  this.source=B.createCombatSource({actor:this.actor,credit:this.actor,teamId:this.actor.teamId,kind:'skill'});
 }
 participants(){return this.engine.game.balls.filter(b=>b.hp>0&&this.engine.isBallActive(b)&&this.engine.getContactProfile(b).solid!==false&&this.engine.getContactProfile(b).attackable!==false&&!this.engine.isTimeFrozen(b));}
 isOpen(p){
  return !this.engine.game.combatEntities.some(e=>{
   if(e.entityActive===false||e.solid!==true||e.hp===0)return false;
   if(Number.isFinite(e.length)&&Number.isFinite(e.width)){
    const angle=e.angle||0,dx=p.x-e.x,dy=p.y-e.y,x=dx*Math.cos(angle)+dy*Math.sin(angle),y=-dx*Math.sin(angle)+dy*Math.cos(angle);
    return Math.hypot(Math.max(0,Math.abs(x)-e.length/2),Math.max(0,Math.abs(y)-e.width/2))<10;
   }
   return Number.isFinite(e.radius)&&Math.hypot(e.x-p.x,e.y-p.y)<e.radius+10;
  });
 }
 pads(){const s=this.engine.arenaSize;return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>({x:x*s,y:y*s,radius:9}));}
 update(dt){
  const g=this.engine.game;if(g.state!=='running'||dt<=0)return;this.time+=dt;
  const active=this.participants(),s=this.engine.arenaSize;
  if(this.options.pads)for(const b of active){
   if((this.cooldowns.get(b.instanceId)||0)>this.time||this.engine.getCapabilities(b).canMove===false||b.positionLocked)continue;
   for(const pad of this.pads())if(Math.hypot(b.x-pad.x,b.y-pad.y)<=b.radius+pad.radius){let dx=b.x-pad.x,dy=b.y-pad.y,m=Math.hypot(dx,dy);if(m<.001){dx=b.vx||1;dy=b.vy||0;m=Math.hypot(dx,dy);}
    const speed=Math.max(1,Math.hypot(b.vx,b.vy),b.speed*b.speedMultiplier);b.vx=b.storedVx=dx/m*speed;b.vy=b.storedVy=dy/m*speed;this.cooldowns.set(b.instanceId,this.time+1);break;
   }
  }
  if(this.options.supplies){
   while(this.time+1e-9>=this.nextSupply){this.nextSupply+=10;if(this.supplies.length>=2)continue;
    for(let tries=0;tries<32;tries++){const p=this.engine.arena.samplePoint(this.engine.random,10);if(!this.isOpen(p)||active.some(b=>Math.hypot(b.x-p.x,b.y-p.y)<b.radius+15)||this.supplies.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<24))continue;this.supplies.push({...p});break;}
   }
   this.supplies=this.supplies.filter(p=>{for(const b of active){if(b.definition?.healthless||b.hp>=b.maxHp||!Number.isFinite(b.maxHp))continue;if(Math.hypot(b.x-p.x,b.y-p.y)>b.radius+6)continue;const heal=Math.min(12,b.maxHp-b.hp);if(heal<=0)continue;b.hp+=heal;this.engine.spawnHitText(b.x,b.y,'+'+Math.round(heal),{color:'#8fefb4'});return false;}return true;});
  }
  if(this.options.laser){
   if(this.time+1e-9>=this.nextLaser){this.sweep={start:this.nextLaser,vertical:this.laserNumber++%2===0,hits:new Set(),previous:s*.2};this.nextLaser+=12;}
   const beam=this.sweep;if(beam){const age=this.time-beam.start;
    if(age>=1.5&&age<=2.3){const pos=s*(.2+.6*(age-1.5)/.8),lo=Math.min(beam.previous,pos),hi=Math.max(beam.previous,pos);for(const b of active){const axis=beam.vertical?b.x:b.y;if(axis+b.radius<lo-2||axis-b.radius>hi+2||beam.hits.has(b.instanceId))continue;beam.hits.add(b.instanceId);this.engine.dealDamage(b,8,this.source);}beam.previous=pos;}
    if(age>2.3)this.sweep=null;
   }
  }
 }
 draw(c){
  const s=this.engine.arenaSize;c.save();
  if(this.options.pads)for(const p of this.pads()){c.strokeStyle='#e4b756';c.fillStyle='rgba(228,183,86,.08)';c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,9,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.moveTo(p.x-4,p.y+2);c.lineTo(p.x,p.y-3);c.lineTo(p.x+4,p.y+2);c.stroke();}
  for(const p of this.supplies){c.fillStyle='#70e3ab';c.fillRect(p.x-5,p.y-5,10,10);c.fillStyle='#122a22';c.fillRect(p.x-3,p.y-1,6,2);c.fillRect(p.x-1,p.y-3,2,6);}
  if(this.sweep){const b=this.sweep,age=this.time-b.start,warning=age<1.5;const pos=warning?s*.2:s*(.2+.6*Math.min(1,(age-1.5)/.8));c.strokeStyle=warning?'#e9ae60':'#ff5c65';c.fillStyle='rgba(255,92,101,.06)';if(b.vertical)c.fillRect(s*.2,0,s*.6,s);else c.fillRect(0,s*.2,s,s*.6);c.lineWidth=warning?1:3;if(warning)c.setLineDash([4,3]);c.beginPath();if(b.vertical){c.moveTo(pos,0);c.lineTo(pos,s);}else{c.moveTo(0,pos);c.lineTo(s,pos);}c.stroke();c.setLineDash([]);c.fillStyle='#ffdcae';c.font='5px sans-serif';c.textAlign='center';if(warning)c.fillText('激光预警 →',s/2,s-6);}
  c.restore();
 }
 dispose(){this.cooldowns.clear();this.supplies=[];this.sweep=null;this.actor.active=false;}
}
root.ArenaMechanisms=ArenaMechanisms;
})(globalThis);
