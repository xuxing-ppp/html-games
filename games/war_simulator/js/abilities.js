(function(){
  const T=W.Config.UNIT_TYPES;
  function reset(u){u.abilityCd=1;u.slowTime=0;u.stunTime=0;u.dashTime=0;u.chargeTime=0;u.chargeHits=new Set();u.rally=false;u.skillFlash=0;}
  function prepare(dt){const units=W.Game.state.units;
    for(const u of units){u.rally=false;u.slowTime=Math.max(0,(u.slowTime||0)-dt);u.stunTime=Math.max(0,(u.stunTime||0)-dt);u.skillFlash=Math.max(0,(u.skillFlash||0)-dt);u.chargeTime=Math.max(0,(u.chargeTime||0)-dt);u.dashTime=Math.max(0,(u.dashTime||0)-dt);u.abilityCd=Math.max(0,(u.abilityCd||0)-dt);}
    for(const u of units)if(u.alive&&T[u.typeId].special?.kind==='rally')for(const a of units)if(a.alive&&a.team===u.team&&a!==u&&Math.hypot(a.pos.x-u.pos.x,a.pos.y-u.pos.y)<125)a.rally=true;
  }
  function attack(u,t,dt){const kind=T[u.typeId].special?.kind;if(!t||u.stunTime>0)return;const dx=t.pos.x-u.pos.x,dy=t.pos.y-u.pos.y,d=Math.hypot(dx,dy)||1;
    if(kind==='charge'&&u.abilityCd<=0&&d>65&&d<280){u.chargeTime=.9;u.chargeHits=new Set();u.abilityCd=4.5;u.skillFlash=.6;W.Physics.applyImpulse(u,dx/d*260,dy/d*260);W.Effects.pulse(u.pos.x,u.pos.y,42,'#f3ce81','冲锋');}
    if(kind==='dash'&&u.abilityCd<=0&&d<150){u.dashTime=.5;u.abilityCd=3.4;u.skillFlash=.5;const side=u.id%2?1:-1;W.Physics.applyImpulse(u,(dx/d-dy/d*side)*80,(dy/d+dx/d*side)*80);W.Effects.pulse(u.pos.x,u.pos.y,30,'#efe0b4','突进');}
    if(kind==='quake'&&u.abilityCd<=0&&d<95){u.abilityCd=5;u.skillFlash=.6;W.Effects.pulse(u.pos.x,u.pos.y,100,'#e5bd7d','震地');for(const a of W.Game.state.units){if(!a.alive||a.team===u.team)continue;const ax=a.pos.x-u.pos.x,ay=a.pos.y-u.pos.y,ad=Math.hypot(ax,ay)||1;if(ad>100)continue;if(W.Physics.applyDamage(a,20))W.Physics.kill(a);W.Physics.applyImpulse(a,ax/ad*160,ay/ad*160);a.stunTime=.55;}}
    if(u.slowTime>0)u.moveSpeed*=.55;if(u.rally){u.moveSpeed*=1.12;u.attackMult*=1.18;}
  }
  function impact(a,b,nx,ny,speed){if(!a.alive||!b.alive||a.team===b.team||a.chargeTime<=0||a.chargeHits.has(b.id)||speed<35)return;
    a.chargeHits.add(b.id);const brace=T[b.typeId].special?.kind==='brace'&&(-nx*Math.cos(b.angle)-ny*Math.sin(b.angle))>.4;
    if(W.Physics.applyDamage(b,brace?5:Math.min(45,15+speed*.13)))W.Physics.kill(b);
    W.Physics.applyImpulse(b,nx*(brace?25:130),ny*(brace?25:130));
    if(brace){if(W.Physics.applyDamage(a,35))W.Physics.kill(a);a.chargeTime=0;a.stunTime=.5;W.Effects.pulse(b.pos.x,b.pos.y,38,'#b4ddce','架枪');}else W.Effects.pulse(b.pos.x,b.pos.y,30,'#f3ce81','冲撞');
  }
  function draw(ctx,u){if(!u.alive)return;const kind=T[u.typeId].special?.kind;
    ctx.save();ctx.translate(u.pos.x,u.pos.y);
    if(kind==='rally'){ctx.strokeStyle='#e5ce782a';ctx.lineWidth=1;ctx.beginPath();ctx.arc(0,0,125,0,Math.PI*2);ctx.stroke();}
    if(u.slowTime>0||u.stunTime>0||u.rally||u.skillFlash>0){ctx.strokeStyle=u.stunTime>0?'#ffe6a0':u.slowTime>0?'#8fe3e7':u.rally?'#e5ce78':'#fff2cf';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,u.radius+4,0,Math.PI*2);ctx.stroke();}
    if(u.stunTime>0){ctx.fillStyle='#ffe6a0';ctx.font='12px sans-serif';ctx.fillText('✦',-5,-u.radius-8);}ctx.restore();
  }
  W.Abilities={reset,prepare,attack,impact,draw};
})();
