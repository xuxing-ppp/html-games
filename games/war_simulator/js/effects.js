// effects.js —— 特效粒子 (从原单文件拆出; 全局命名空间 W)
(function(){
  let list = [];
  function push(e){ list.push(e); if (list.length > 300) list.shift(); }
  function hit(x,y,color){ for (let i=0;i<5;i++){ const a=Math.random()*Math.PI*2, sp=50+Math.random()*130; push({type:'p',pos:{x,y},vel:{vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,gm:0.2},age:0,life:0.3+Math.random()*0.25,color,size:1.5+Math.random()*2}); } }
  function slash(x,y,ang,color){ push({type:'slash',pos:{x,y},angle:ang,age:0,life:0.18,color}); }
  function dust(x,y){ for (let i=0;i<4;i++){ push({type:'p',pos:{x,y},vel:{vx:W.Util.rand(-40,40),vy:-30-Math.random()*60,gm:0.4},age:0,life:0.4+Math.random()*0.2,color:'#b9a78c',size:2}); } }
  function heal(x,y){ for (let i=0;i<4;i++){ push({type:'p',pos:{x,y},vel:{vx:W.Util.rand(-20,20),vy:-40-Math.random()*30,gm:-0.2},age:0,life:0.5,color:'#7CFC00',size:1.5+Math.random()*1.5}); } }
  function explosion(x,y,r){ push({type:'ring',pos:{x,y},radius:r,age:0,life:0.3,color:'#ff6b35'}); for(let i=0;i<10;i++){ const a=Math.random()*Math.PI*2,sp=80+Math.random()*120; push({type:'p',pos:{x,y},vel:{vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,gm:0.3},age:0,life:0.4+Math.random()*0.2,color:'#ff9500',size:2+Math.random()*2}); } }
  function pulse(x,y,r,color,label){push({type:'pulse',pos:{x,y},radius:r,color,label,age:0,life:.65});}
  function update(dt){
    const G = W.Config.CONST.PARTICLE_G;
    for (let i=0;i<list.length;i++){ const e=list[i]; e.age+=dt; if(e.type==='p'){ e.vel.vy+=G*e.vel.gm*dt; e.pos.x+=e.vel.vx*dt; e.pos.y+=e.vel.vy*dt; } }
    for (let i=list.length-1;i>=0;i--) if(list[i].age>=list[i].life) list.splice(i,1);
  }
  function draw(ctx){
    for (let i=0;i<list.length;i++){
      const e=list[i];
      if(e.type==='p'){ const a=1-e.age/e.life; ctx.globalAlpha=Math.max(0,a); ctx.fillStyle=e.color; ctx.beginPath(); ctx.arc(e.pos.x,e.pos.y,e.size,0,Math.PI*2); ctx.fill(); }
      else if(e.type==='slash'){ const a=1-e.age/e.life; ctx.save(); ctx.translate(e.pos.x,e.pos.y); ctx.rotate(e.angle); ctx.globalAlpha=Math.max(0,a); ctx.strokeStyle=e.color; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(0,0,20,-0.6,0.6); ctx.stroke(); ctx.restore(); }
      else if(e.type==='pulse'){ctx.save();ctx.globalAlpha=1-e.age/e.life;ctx.strokeStyle=e.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(e.pos.x,e.pos.y,e.radius*(.3+.7*e.age/e.life),0,Math.PI*2);ctx.stroke();ctx.fillStyle=e.color;ctx.textAlign='center';ctx.font='bold 11px sans-serif';ctx.fillText(e.label,e.pos.x,e.pos.y-20-e.age*20);ctx.restore();}
      else if(e.type==='ring'){ const a=1-e.age/e.life; ctx.globalAlpha=Math.max(0,a*0.6); ctx.strokeStyle=e.color; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(e.pos.x,e.pos.y,e.radius*(0.5+0.5*a),0,Math.PI*2); ctx.stroke(); }
    }
    ctx.globalAlpha=1;
  }
  function clear(){ list.length=0; }
  W.Effects = { pulse, hit, slash, dust, heal, explosion, update, draw, clear };
})();
