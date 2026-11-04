// Fixed tabletop maps with individual proportions and polygon boundaries. All geometry uses world coordinates.
(function(){
  const C=W.Config.CONST, clamp=W.Util.clamp;
  const rect=(type,x,y,w,h)=>({type,x,y,w,h});
  const pair=(type,x,y,w,h)=>[rect(type,x,y,w,h),rect(type,-x-w,y,w,h)];
  const box=(x,y)=>[[-x,-y],[x,-y],[x,y],[-x,y]];
  const maps={
    meadow:{name:'开阔草原',desc:'2:1 长形草原，开阔无障碍，适合横向交锋。',outline:box(840,420),shapes:[]},
    woodland:{name:'疏林小径',desc:'宽阔八角林地；树林内移速 80%，中央通路畅通。',outline:[[-760,-260],[-560,-440],[560,-440],[760,-260],[760,260],[560,440],[-560,440],[-760,260]],shapes:[...pair('forest',180,-410,220,210),...pair('forest',140,200,260,210)]},
    wetlands:{name:'浅滩湿地',desc:'扁长浅滩，两端收尖；浅水内移速 60%，可沿干地绕行。',outline:[[-900,0],[-660,-360],[660,-360],[900,0],[660,360],[-660,360]],shapes:[...pair('water',100,-330,160,230),...pair('water',100,100,160,230)]},
    pass:{name:'碎石隘口',desc:'两翼宽、中央收腰的隘口；岩石阻挡士兵与攻击。',outline:[[-800,-420],[-360,-420],[-130,-200],[130,-200],[360,-420],[800,-420],[800,420],[360,420],[130,200],[-130,200],[-360,420],[-800,420]],shapes:[rect('rock',-360,-250,110,180),rect('rock',250,70,110,180)]},
    crossings:{name:'林溪交错',desc:'红蓝不对称的不规则林溪；树林 80% · 浅水 60% · 岩石阻挡。',outline:[[-860,-330],[-400,-430],[240,-300],[700,-380],[860,-40],[620,180],[760,430],[160,350],[-150,180],[-720,360],[-860,0]],shapes:[rect('forest',-620,-300,240,190),rect('forest',300,-240,230,180),rect('water',-430,80,190,230),rect('water',220,100,170,240),rect('rock',80,-240,100,90),rect('rock',-300,0,100,90)]}
  };
  for(const map of Object.values(maps)){map.edges=map.outline.map((p,i)=>({a:{x:p[0],y:p[1]},b:{x:map.outline[(i+1)%map.outline.length][0],y:map.outline[(i+1)%map.outline.length][1]}}));map.bounds={x:Math.max(...map.outline.map(p=>Math.abs(p[0]))),y:Math.max(...map.outline.map(p=>Math.abs(p[1])))};}
  let current='meadow',version=0;const shapes=[];
  function hasMap(id){return typeof id==='string'&&Object.prototype.hasOwnProperty.call(maps,id);}
  function bounds(id=current){return maps[id].bounds;}
  function setMap(id){if(!hasMap(id))return false;current=id;const size=bounds();C.BOUND_X=size.x;C.BOUND_Y=size.y;shapes.splice(0,shapes.length,...maps[id].shapes.map(s=>({...s})));version++;return true;}
  function touches(p,r,s){const dx=p.x-clamp(p.x,s.x,s.x+s.w),dy=p.y-clamp(p.y,s.y,s.y+s.h);return dx*dx+dy*dy<r*r||p.x>=s.x&&p.x<=s.x+s.w&&p.y>=s.y&&p.y<=s.y+s.h;}
  function blocked(p,r=0,id=current){return maps[id].shapes.some(s=>s.type==='rock'&&touches(p,r,s));}
  function closest(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1),0,1),x=a.x+t*dx,y=a.y+t*dy;return {x,y,d2:(x-p.x)**2+(y-p.y)**2};}
  function edges(id=current){return maps[id].edges;}
  function contains(p,r=0,id=current){
    if(!hasMap(id))return false;if(id==='meadow'){const size=bounds(id);return Math.abs(p.x)<=size.x-r&&Math.abs(p.y)<=size.y-r;}let inside=false,min=Infinity;
    for(const {a,b} of edges(id)){if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;min=Math.min(min,closest(p,a,b).d2);}
    return (inside||min<1e-10)&&min+1e-7>=r*r;
  }
  function passable(p,r=0,id=current){return contains(p,r,id)&&!blocked(p,r,id);}
  function trace(ctx,id=current){ctx.beginPath();maps[id].outline.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();}
  function segmentDistance(a,b,c,d){
    const cross=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);
    const x1=cross(a,b,c),x2=cross(a,b,d),x3=cross(c,d,a),x4=cross(c,d,b);
    if(x1*x2<0&&x3*x4<0)return 0;
    return Math.min(closest(a,c,d).d2,closest(b,c,d).d2,closest(c,a,b).d2,closest(d,a,b).d2);
  }
  function collideBoundary(b){
    const r=b.radius+.15;
    for(let attempt=0;attempt<8&&!contains(b.pos,r);attempt++){
      let best=null;for(const edge of edges()){const q=closest(b.pos,edge.a,edge.b);if(!best||q.d2<best.q.d2)best={...edge,q};}
      const {a,b:edgeEnd,q}=best,dx=edgeEnd.x-a.x,dy=edgeEnd.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len;
      b.pos.x=q.x+nx*(r+.1);b.pos.y=q.y+ny*(r+.1);const vn=b.vel.vx*nx+b.vel.vy*ny;if(vn<0){b.vel.vx-=vn*nx*1.7;b.vel.vy-=vn*ny*1.7;}
    }
    // At a concave corner two edge pushes can alternate. Recover to the closest safe cell.
    if(!contains(b.pos,b.radius)){let best=null,dist=Infinity;for(let y=-C.BOUND_Y+20;y<C.BOUND_Y;y+=20)for(let x=-C.BOUND_X+20;x<C.BOUND_X;x+=20){const p={x,y},d=(x-b.pos.x)**2+(y-b.pos.y)**2;if(d<dist&&passable(p,r)){best=p;dist=d;}}if(best){b.pos.x=best.x;b.pos.y=best.y;b.vel.vx=b.vel.vy=0;}}
  }
  function speedAt(p){let speed=1;for(const s of shapes)if(touches(p,0,s))speed=Math.min(speed,s.type==='water'?.6:s.type==='forest'?.8:1);return speed;}
  // Slab intersection against expanded boxes: also catches high speed projectiles.
  function lineClear(a,b,r=0){
    if(!contains(a,r)||!contains(b,r))return false;
    for(const e of edges())if(segmentDistance(a,b,e.a,e.b)<=r*r+1e-8)return false;
    for(const s of shapes){if(s.type!=='rock')continue;let lo=0,hi=1;
      for(const axis of ['x','y']){const d=b[axis]-a[axis],min=s[axis]-r,max=s[axis]+(axis==='x'?s.w:s.h)+r;
        if(Math.abs(d)<1e-9){if(a[axis]<min||a[axis]>max){lo=2;break;}}
        else{let t1=(min-a[axis])/d,t2=(max-a[axis])/d;if(t1>t2)[t1,t2]=[t2,t1];lo=Math.max(lo,t1);hi=Math.min(hi,t2);}
      }if(lo<=hi)return false;
    }return true;
  }
  function freeSpot(typeId,team,x,y){const r=W.Config.UNIT_TYPES[typeId].radius,units=W.Game.state.units;
    const valid=p=>passable(p,r)&&(p.x<0)===(team==='red')&&!units.some(u=>Math.hypot(p.x-u.pos.x,p.y-u.pos.y)<r+u.radius+2);
    const origin={x:clamp(x,team==='red'?-C.BOUND_X+r:r,team==='red'?-r:C.BOUND_X-r),y:clamp(y,-C.BOUND_Y+r,C.BOUND_Y-r)};
    if(valid(origin))return origin;
    for(let d=16;d<1800;d+=16){const n=Math.ceil(2*Math.PI*d/16);for(let i=0;i<n;i++){const p={x:origin.x+Math.cos(i/n*Math.PI*2)*d,y:origin.y+Math.sin(i/n*Math.PI*2)*d};if(valid(p))return p;}}return null;
  }
  function collideTerrain(b){
    for(const s of shapes){if(s.type!=='rock'||!touches(b.pos,b.radius,s))continue;
      let rx=clamp(b.pos.x,s.x,s.x+s.w),ry=clamp(b.pos.y,s.y,s.y+s.h),dx=b.pos.x-rx,dy=b.pos.y-ry,d=Math.hypot(dx,dy),nx,ny;
      if(d>0){nx=dx/d;ny=dy/d;}else{const edges=[{d:b.pos.x-s.x,nx:-1,ny:0,x:s.x,y:b.pos.y},{d:s.x+s.w-b.pos.x,nx:1,ny:0,x:s.x+s.w,y:b.pos.y},{d:b.pos.y-s.y,nx:0,ny:-1,x:b.pos.x,y:s.y},{d:s.y+s.h-b.pos.y,nx:0,ny:1,x:b.pos.x,y:s.y+s.h}];edges.sort((a,b)=>a.d-b.d);({nx,ny,x:rx,y:ry}=edges[0]);}
      b.pos.x=rx+nx*(b.radius+.1);b.pos.y=ry+ny*(b.radius+.1);const vn=b.vel.vx*nx+b.vel.vy*ny;if(vn<0){b.vel.vx-=vn*nx;b.vel.vy-=vn*ny;}
    }
  }
  // A* on a 40-unit grid; radius inflation and segment tests prevent corner cutting.
  function path(start,goal,r){
    const step=40,nx=Math.ceil(2*C.BOUND_X/step),ny=Math.ceil(2*C.BOUND_Y/step),point=i=>({x:-C.BOUND_X+20+(i%nx)*step,y:-C.BOUND_Y+20+Math.floor(i/nx)*step});
    const cells=Array.from({length:nx*ny},(_,i)=>passable(point(i),r+4));
    function nearest(p,allowBlocked=false){let best=-1,d=Infinity;for(let i=0;i<cells.length;i++)if(cells[i]){const q=point(i),v=(q.x-p.x)**2+(q.y-p.y)**2;if(v<d&&(allowBlocked||lineClear(p,q,r))){best=i;d=v;}}return best;}
    const from=nearest(start),to=nearest(goal,!passable(goal,r+4));if(from<0||to<0)return [];
    const open=[from],prev=new Int32Array(nx*ny).fill(-1),g=new Float64Array(nx*ny).fill(Infinity),closed=new Uint8Array(nx*ny);g[from]=0;
    const heuristic=i=>{const p=point(i),q=point(to);return Math.hypot(p.x-q.x,p.y-q.y);};
    while(open.length){let k=0;for(let j=1;j<open.length;j++)if(g[open[j]]+heuristic(open[j])<g[open[k]]+heuristic(open[k]))k=j;const i=open.splice(k,1)[0];if(i===to){const out=passable(goal,r+4)?[goal]:[];let at=to;while(at!==from){out.push(point(at));at=prev[at];}out.push(point(from));return out.reverse();}closed[i]=1;
      const x=i%nx,y=Math.floor(i/nx);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=nx||y+dy<0||y+dy>=ny)continue;const j=i+dx+dy*nx;if(!cells[j]||closed[j]||!lineClear(point(i),point(j),r+3))continue;const cost=g[i]+step*Math.hypot(dx,dy);if(cost<g[j]){g[j]=cost;prev[j]=i;if(!open.includes(j))open.push(j);}}
    }return [];
  }
  function steer(u,goal,dt){
    const force=Math.hypot(u.thrustX,u.thrustY);if(!force)return;
    goal={x:clamp(goal.x,-C.BOUND_X+u.radius+5,C.BOUND_X-u.radius-5),y:clamp(goal.y,-C.BOUND_Y+u.radius+5,C.BOUND_Y-u.radius-5)};
    let target=goal;
    if(!lineClear(u.pos,goal,u.radius+4)){
      let nav=u.navigation;if(!nav||nav.version!==version||nav.ttl<=0||Math.hypot(nav.goal.x-goal.x,nav.goal.y-goal.y)>100){nav=u.navigation={version,ttl:.8,goal,path:path(u.pos,goal,u.radius)};}nav.ttl-=dt;
      while(nav.path.length&&Math.hypot(nav.path[0].x-u.pos.x,nav.path[0].y-u.pos.y)<22)nav.path.shift();
      while(nav.path.length>1&&lineClear(u.pos,nav.path[1],u.radius+4))nav.path.shift();
      if(!nav.path.length){u.thrustX=u.thrustY=0;return;}target=nav.path[0];
    }else u.navigation=null;
    let dx=target.x-u.pos.x,dy=target.y-u.pos.y,d=Math.hypot(dx,dy)||1;
    // Mild short-range separation keeps a file of units from clogging an entrance.
    let sx=0,sy=0;for(const v of W.Game.state.units){if(v===u||!v.alive)continue;const x=u.pos.x-v.pos.x,y=u.pos.y-v.pos.y,l=Math.hypot(x,y),rr=u.radius+v.radius+12;if(l>0&&l<rr){sx+=x/l*(1-l/rr);sy+=y/l*(1-l/rr);}}
    dx=dx/d+sx*.25;dy=dy/d+sy*.25;d=Math.hypot(dx,dy)||1;u.thrustX=dx/d*force;u.thrustY=dy/d*force;
  }
  function draw(ctx){ctx.save();trace(ctx);ctx.clip();for(const s of shapes){ctx.save();
    if(s.type==='water'){ctx.fillStyle='#74b7bb';ctx.fillRect(s.x,s.y,s.w,s.h);ctx.strokeStyle='#c0e0cb';ctx.lineWidth=3;for(let y=s.y+20;y<s.y+s.h;y+=32){ctx.beginPath();ctx.moveTo(s.x+12,y);ctx.quadraticCurveTo(s.x+s.w/2,y+12,s.x+s.w-12,y);ctx.stroke();}}
    if(s.type==='forest'){ctx.fillStyle='#6d92558c';ctx.fillRect(s.x,s.y,s.w,s.h);for(let y=s.y+20;y<s.y+s.h;y+=48)for(let x=s.x+20;x<s.x+s.w;x+=48){ctx.fillStyle='#698c4d';ctx.beginPath();ctx.arc(x+3,y+4,17,0,Math.PI*2);ctx.fill();ctx.fillStyle='#aec17a';ctx.beginPath();ctx.arc(x-2,y-3,13,0,Math.PI*2);ctx.fill();}}
    if(s.type==='rock'){ctx.fillStyle='#56634c55';ctx.fillRect(s.x+7,s.y+9,s.w,s.h);ctx.fillStyle='#8d927d';ctx.fillRect(s.x,s.y,s.w,s.h);ctx.fillStyle='#c0bca0';ctx.fillRect(s.x,s.y,s.w,10);ctx.strokeStyle='#6a735e';ctx.lineWidth=3;ctx.strokeRect(s.x,s.y,s.w,s.h);ctx.beginPath();ctx.moveTo(s.x+12,s.y+25);ctx.lineTo(s.x+s.w*.55,s.y+s.h*.45);ctx.lineTo(s.x+s.w-15,s.y+s.h-15);ctx.stroke();}ctx.restore();}ctx.restore();}
  W.Terrain={maps,shapes,hasMap,bounds,contains,trace,collideBoundary,setMap,blocked,passable,speedAt,lineClear,freeSpot,path,steer,collideTerrain,draw,clear(){setMap('meadow');},get current(){return current;}};
  setMap('meadow');
})();
