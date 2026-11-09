(function initializeModule(root, factory) {
  const api = factory(typeof module === "object" && module.exports
    ? { ...require("../core/ball-registry.js"), ...require("../core/contact-model.js"), ...require("../core/arena-geometry.js"), ...require("./hammer-v2.js") }
    : root.BallBattle);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.BallBattle = Object.assign(root.BallBattle || {}, api);
})(globalThis, function createModulePlugin({ resolveArenaGeometry, registerBall, firstSegmentCircleContact, createHammerDaze }) {
  const TAU = Math.PI * 2;
  const EPS = 1e-8;
  const REASSEMBLY_COOLDOWN = 0.3;
  const ANGLES = [-Math.PI * 0.75, -Math.PI * 0.25, Math.PI * 0.75, Math.PI * 0.25];
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const angularDistance = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)));
  function centerOffset(parts) {
    let x=0,y=0;
    for(const part of parts){x+=Math.cos(ANGLES[part])*9;y+=Math.sin(ANGLES[part])*9;}
    return {x:x/parts.length,y:y/parts.length};
  }
  function point(ball,state,angle,distance) {
    const offset=centerOffset(state.parts),c=Math.cos(state.angle),s=Math.sin(state.angle);
    return {x:ball.x-offset.x*c+offset.y*s+Math.cos(state.angle+angle)*distance,
      y:ball.y-offset.x*s-offset.y*c+Math.sin(state.angle+angle)*distance};
  }
  function impulse(nx,ny,duration=0.1,multiplier=2) {
    const length=Math.hypot(nx,ny)||1;nx/=length;ny/=length;
    return {id:"module-kick",duration,bounceCompatible:true,locksMovement:true,
      onApply({ball}){ball.vx=nx*ball.speed*ball.speedMultiplier*multiplier;ball.vy=ny*ball.speed*ball.speedMultiplier*multiplier;},
      update({ball}){ball.vx=nx*ball.speed*ball.speedMultiplier*multiplier;ball.vy=ny*ball.speed*ball.speedMultiplier*multiplier;},
      onExpire({ball}){ball.vx=ball.storedVx=nx*ball.speed*ball.speedMultiplier;ball.vy=ball.storedVy=ny*ball.speed*ball.speedMultiplier;}};
  }
  function createModuleBullet(x,y,angle) {
    return {kind:"module-bullet",life:1,radius:2.5,damage:1,x,y,vx:Math.cos(angle)*1000,vy:Math.sin(angle)*1000,
      update({entity:e,game,services},dt){
        const sx=e.x,sy=e.y;e.x+=e.vx*dt;e.y+=e.vy*dt;
        const target=services.getFirstEnemyHit(sx,sy,e.x,e.y,e.radius);
        if(target){services.dealDamage(target,e.damage);e.entityActive=false;}
        if(!resolveArenaGeometry(game).contains(e.x,e.y))e.entityActive=false;
      },
      draw({entity:e},ctx){ctx.save();ctx.translate(e.x,e.y);ctx.rotate(Math.atan2(e.vy,e.vx));
        ctx.globalCompositeOperation="lighter";ctx.fillStyle="#ffd24a";ctx.fillRect(-14,-2,14,4);
        ctx.fillStyle="#fff6c9";ctx.fillRect(-7.7,-1,9.8,2);ctx.beginPath();ctx.arc(0,0,2.48,0,TAU);ctx.fill();ctx.restore();}
    };
  }

  function createWeapons(ball,state) {
    let nextShot=0,legUntil=0,legReady=0;
    const hammerContacts=new Set();
    return {kind:"module-equipment",combatKind:"skill",life:Number.MAX_SAFE_INTEGER,
      lifecycle:"owner-bound",indestructible:true,shieldBreakPoints:[],
      update({entity:e,game,services},dt){
        if(!services.getCapabilities(ball).canAct||!services.getCapabilities(ball).canDealDamage)return;
        const contacts=new Set();
        if(state.parts.includes(0)) {
          const tip=point(ball,state,ANGLES[0],37),base=point(ball,state,ANGLES[0],23);
          services.forEachEnemy(target=>{
            if(!services.getContactProfile(target).attackable)return;
            const hit=firstSegmentCircleContact(base.x,base.y,tip.x,tip.y,target.x,target.y,target.radius+7.5);
            if(hit===null)return;
            contacts.add(target.instanceId);
            const nx=target.x-tip.x,ny=target.y-tip.y;
            if(!hammerContacts.has(target.instanceId)&&services.dealDamage(target,5))
              services.applyEffect(target,createHammerDaze(nx,ny,{dazeDuration:0.75,knockbackSpeedMultiplier:1.8}));
          });
        }
        hammerContacts.clear();for(const id of contacts)hammerContacts.add(id);
        if(state.parts.includes(2)&&game.time+EPS>=nextShot) {
          const a=state.angle+ANGLES[2],muzzle=point(ball,state,ANGLES[2],28);
          const reach=resolveArenaGeometry(game).movementLimit(muzzle.x,muzzle.y,Math.cos(a),Math.sin(a),game.arenaSize*2);
          const end={x:muzzle.x+Math.cos(a)*reach,y:muzzle.y+Math.sin(a)*reach};
          if(services.getFirstEnemyHit(muzzle.x,muzzle.y,end.x,end.y,2.5)) {
            nextShot=Math.max(nextShot,game.time-dt);
            while(nextShot<=game.time+EPS){services.spawnProjectile(createModuleBullet(muzzle.x,muzzle.y,a));nextShot+=0.03;}
          }
        }
        if(state.parts.includes(3)) {
          const base=point(ball,state,ANGLES[3],12),a=state.angle+ANGLES[3];
          const tip=point(ball,state,ANGLES[3],67);
          if(game.time>=legReady)services.forEachEnemy(target=>{
            if(game.time<legReady||!services.getContactProfile(target).attackable)return;
            const dx=target.x-base.x,dy=target.y-base.y;
            const approaching=(target.vx-ball.vx)*dx+(target.vy-ball.vy)*dy<0;
            if(!approaching||firstSegmentCircleContact(base.x,base.y,tip.x,tip.y,target.x,target.y,target.radius+2.5)===null)return;
            legUntil=game.time+0.25;legReady=game.time+0.45;
            state.legHit=false;
          });
          const targetLength=game.time<legUntil?55:10;
          const oldLength=state.legLength;
          state.legLength += clamp(targetLength-state.legLength,-300*dt,700*dt);
          if(game.time<legUntil&&!state.legHit) {
            const p1=point(ball,state,ANGLES[3],12+oldLength),p2=point(ball,state,ANGLES[3],12+state.legLength);
            const target=services.getFirstEnemyHit(p1.x,p1.y,p2.x,p2.y,2.5);
            if(target){state.legHit=true;if(services.dealDamage(target,2)&&!services.isMovementLocked(target))services.applyEffect(target,impulse(Math.cos(a),Math.sin(a)));}
          }
        }
      },
      draw(){},
      extendLeg(now){legUntil=now+0.25;legReady=now+0.45;}
    };
  }

  function drawModule(ball,state,ctx) {
    const offset=centerOffset(state.parts);
    ctx.save();ctx.translate(ball.x,ball.y);ctx.rotate(state.angle);ctx.translate(-offset.x,-offset.y);
    for(const part of state.parts){
      const a=ANGLES[part];
      ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,15,a-Math.PI/4,a+Math.PI/4);ctx.closePath();
      ctx.fillStyle=["#999fa6","#7d858e","#8c9298","#676f79"][part];ctx.fill();
      ctx.strokeStyle="#272c32";ctx.lineWidth=0.8;ctx.stroke();
      ctx.save();ctx.rotate(a);
      ctx.fillStyle="#d6d9dc";ctx.beginPath();ctx.arc(8,0,1.4,0,TAU);ctx.fill();
      if(part===0){
        ctx.fillStyle="#444a53";ctx.fillRect(12,-2.5,23,5);
        ctx.fillStyle="#aab0b5";ctx.fillRect(31,-7.5,11,15);
        ctx.strokeStyle="#454c54";ctx.lineWidth=1;ctx.strokeRect(31,-7.5,11,15);
        ctx.fillStyle="#d5d9dc";ctx.fillRect(32,-6.5,2,13);
      }else if(part===1){
        ctx.strokeStyle="#3d454f";ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,17,-Math.PI/4,Math.PI/4);ctx.stroke();
        ctx.strokeStyle="#a2adb8";ctx.lineWidth=0.5;ctx.beginPath();ctx.arc(0,0,18.5,-Math.PI/4,Math.PI/4);ctx.stroke();
      }else if(part===2){
        ctx.fillStyle="#242930";ctx.fillRect(12,-3.5,17,5);ctx.fillRect(14,0,5,8);
        ctx.fillStyle="#646c73";ctx.fillRect(13,-3.5,15,1.4);
        ctx.strokeStyle="#10151a";ctx.lineWidth=0.7;ctx.strokeRect(19,1,5,3);
      }else{
        const length=state.legLength,knee=Math.sqrt(Math.max(0,27.5**2-(length/2)**2));
        ctx.strokeStyle="#414851";ctx.lineWidth=5;ctx.lineJoin="round";
        ctx.beginPath();ctx.moveTo(12,0);ctx.lineTo(12+length/2,knee);ctx.lineTo(12+length,0);ctx.stroke();
        ctx.strokeStyle="#aeb6be";ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle="#333b44";ctx.fillRect(10+length,-5,5,10);
        for(const [x,y] of [[12,0],[12+length/2,knee],[12+length,0]]){ctx.fillStyle="#c0c7ce";ctx.beginPath();ctx.arc(x,y,2,0,TAU);ctx.fill();}
      }
      ctx.restore();
    }
    ctx.restore();
  }

  function createModuleBehavior(services,group=new Set(),initialParts=[0,1,2,3],initialAngle=0,partHp=[25,25,25,25],healthScale=null) {
    const state={parts:[...initialParts],angle:initialAngle,legLength:10,legHit:false};
    // Individual HP survives assembly; the assembled body's HP is a separate pool.
    state.partHp=[...partHp];
    let owner=null,weapons=null,baseline=null;
    const setGeometry=ball=>{ball.radius=state.parts.length===1?11.6:15;};
    function bind(context) {
      if(owner)return;
      owner=context.ball;baseline={radius:owner.radius,maxHp:owner.maxHp};
      if(healthScale===null){
        healthScale=Number.isFinite(owner.hpMultiplier)&&owner.hpMultiplier>0?owner.hpMultiplier:1;
        state.partHp=state.partHp.map(hp=>hp*healthScale);
      }
      owner.moduleState=state;owner.moduleGroup=group;group.add(owner);
      weapons=services.spawnCombatEntity(createWeapons(owner,state));
    }
    function split(context) {
      const ball=context.ball,parts=[...state.parts],angle=state.angle;
      group.reassemblyReadyAt = Math.max(
        Number.isFinite(group.reassemblyReadyAt) ? group.reassemblyReadyAt : 0,
        context.game.time + REASSEMBLY_COOLDOWN
      );
      const positions=parts.map(part=>point(ball,state,ANGLES[part],12));
      state.parts=[parts[0]];state.legLength=10;
      setGeometry(ball);ball.maxHp=25*healthScale;ball.hp=state.partHp[parts[0]];
      parts.forEach((part,index)=>{
        const a=angle+ANGLES[part],p=positions[index];
        const position=resolveArenaGeometry(context.game).clampPoint(p.x,p.y,12);
        const spawn={...position,vx:Math.cos(a)*150,vy:Math.sin(a)*150};
        if(index===0){ball.x=spawn.x;ball.y=spawn.y;ball.vx=ball.storedVx=spawn.vx;ball.vy=ball.storedVy=spawn.vy;return;}
        const piece=services.spawnSummon({id:"module-piece",name:"模块零件",englishName:"Module Piece",color:"#858d96",
          description:"Independent module",stats:{radius:11.6,speed:150,maxHp:25*healthScale},summonsCountForTeamSurvival:true,
          createBehavior:bound=>createModuleBehavior(bound,group,[part],angle,state.partHp,healthScale)},spawn);
        if(piece)piece.hp=state.partHp[part];
      });
      services.spawnParticleBurst({kind:"module-break",x:ball.x,y:ball.y,count:20,colors:["#d5d9dc","#737f8b","#fbc26a"],life:0.35});
    }
    // 被吸收的零件直接消失：置 deathNotified 让引擎跳过这具身体的死亡结算，
    // 否则 updateDeathFades 会把 fade 从 0 拉回 1，多出 1.1 秒的渐隐残影。
    function absorb(member) {
      if(!member)return;
      member.hp=0;member.fade=0;member.deathNotified=true;
      member.vx=member.vy=member.storedVx=member.storedVy=0;
      group.delete(member);
    }
    function merge(context) {
      const ball=context.ball;
      if (Number.isFinite(group.reassemblyReadyAt) && context.game.time + EPS < group.reassemblyReadyAt) return;
      for(const ally of group){
        if(ally===ball||ally.hp<=0||services.isEnemy(ally))continue;
        const other=ally.moduleState;
        if(Math.hypot(ball.x-ally.x,ball.y-ally.y)>ball.radius+ally.radius+0.15)continue;
        if(state.parts.some(p=>other.parts.includes(p)))continue;
        if(state.parts.length===1)state.partHp[state.parts[0]]=ball.hp;
        if(other.parts.length===1)other.partHp[other.parts[0]]=ally.hp;
        for(const part of other.parts)state.partHp[part]=other.partHp[part];
        state.parts.push(...other.parts);state.parts.sort();
        ball.hp=ball.maxHp=state.parts.length*5*healthScale;setGeometry(ball);
        ball.name="模块";
        absorb(ally);
        services.spawnParticleBurst({kind:"module-join",x:ball.x,y:ball.y,count:8,colors:["#cad8e3","#8ca8be"],life:0.2});
        break;
      }
    }
    return {
      onSpawn:bind,
      update(context,dt){bind(context);state.angle=(state.angle+dt*TAU*(state.parts.length===1?1:0.4))%TAU;},
      afterUpdateStep:merge,
      onBeforeDamage({ball},event){
        if(!state.parts.includes(1))return event;
        const source=event.entity||event.actor;
        if(!source||source===ball||["dot","self"].includes(event.kind))return event;
        const origin=[source,event.owner,event.credit].find(candidate=>candidate&&
          ((Number.isFinite(candidate.x)&&Number.isFinite(candidate.y))||
          (Number.isFinite(candidate.startX)&&Number.isFinite(candidate.startY))));
        if(!origin)return event;
        const originX=Number.isFinite(origin.startX)?origin.startX:origin.x;
        const originY=Number.isFinite(origin.startY)?origin.startY:origin.y;
        let dx=originX-ball.x,dy=originY-ball.y;
        if(event.kind==="projectile"&&Number.isFinite(source.vx)&&Number.isFinite(source.vy)&&Math.hypot(source.vx,source.vy)>EPS){dx=-source.vx;dy=-source.vy;}
        if(!Number.isFinite(dx)||!Number.isFinite(dy)||Math.hypot(dx,dy)<EPS)return event;
        return angularDistance(Math.atan2(dy,dx),state.angle+ANGLES[1])<=Math.PI/4
          ?{amount:0,cancelAttack:true,showHitText:false}:event;
      },
      onDamaged(context){bind(context);if(context.ball.hp<=0&&state.parts.length>1)split(context);},
      onWallBounce({ball,game}){
        if(!state.parts.includes(3)||!services.getCapabilities(ball).canAct)return;
        const a=state.angle+ANGLES[3],dx=Math.cos(a),dy=Math.sin(a),p=point(ball,state,ANGLES[3],67);
        if(!resolveArenaGeometry(game).contains(p.x,p.y)){weapons.extendLeg(game.time);services.applyEffect(ball,impulse(-dx,-dy));}
      },
      drawBody({ball},ctx){drawModule(ball,state,ctx);return true;},
      onDeath(){group.delete(owner);if(weapons)weapons.entityActive=false;},
      onBorrowEnd(){
        for(const member of [...group])if(member!==owner)absorb(member);
        group.clear();group.reassemblyReadyAt=0;if(weapons)weapons.entityActive=false;
        if(owner&&baseline){owner.radius=baseline.radius;owner.maxHp=baseline.maxHp;owner.hp=Math.min(owner.hp,owner.maxHp);}
        if(owner){delete owner.moduleState;delete owner.moduleGroup;}
      }
    };
  }
  const moduleDefinition={id:"module",name:"模块",englishName:"Module",color:"#858d96",
    description:"四象限机械 / 榔头、护盾、手枪、机械腿 / 首次拆分零件各25血，重组不恢复零件血量 / 分离后0.3秒才能重组",
    stats:{radius:15,speed:150,maxHp:20},summonsCountForTeamSurvival:true,
    createBehavior:createModuleBehavior};
  registerBall(moduleDefinition);
  return {moduleDefinition,createModuleBullet,createModuleBehavior,REASSEMBLY_COOLDOWN};
});
