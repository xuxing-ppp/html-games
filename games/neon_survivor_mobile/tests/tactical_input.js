// Independent scripted-input stress policy. It uses public positions/velocities, not future RNG or modified game stats.
// Useful alongside the built-in Auto policy; neither estimates a human's win rate.
module.exports = function tacticalInput(SV, s, frame) {
  if (frame % 6) return;
  const p=s.player, m=SV.Entities.mods(s), speed=p.speed*m.speedMul;
  const near=s.enemies.filter(e=>e.hp>0&&e.sheep<=0&&Math.hypot(e.x-p.x,e.y-p.y)<550);
  const shots=s.eshots.filter(e=>Math.hypot(e.x-p.x,e.y-p.y)<450);
  let goal=null,value=-Infinity;
  for(const g of s.gems.concat(s.pickups)) {
    const d=Math.hypot(g.x-p.x,g.y-p.y);
    const weight=g.kind==='health'?(1-p.hp/p.maxHp)*9:g.kind==='treasure'?8:g.kind==='bomb'?4:g.kind?1:Math.sqrt(g.value||1);
    const score=weight/(80+d);
    if(score>value){value=score;goal=g;}
  }
  if(!goal) {
    let best=Infinity;
    for(const e of near) { const d=Math.hypot(e.x-p.x,e.y-p.y);if(d<best){best=d;goal=e;} }
  }
  let bestScore=-Infinity,bestX=0,bestY=0;
  for(let i=0;i<24;i++) {
    const angle=i*Math.PI*2/24,dx=Math.cos(angle),dy=Math.sin(angle);
    let score=0;
    if(goal) { const gx=goal.x-p.x,gy=goal.y-p.y,gd=Math.hypot(gx,gy)||1;score+=35*(dx*gx+dy*gy)/gd+12*(-dx*gy+dy*gx)/gd; }
    // Return toward the arena interior before a wall becomes the only escape direction.
    const half=s.stage.half;
    score-=Math.max(0,Math.abs(p.x+dx*speed)-half+100)*2+Math.max(0,Math.abs(p.y+dy*speed)-half+100)*2;
    score+=3*(dx*(s._testDX||0)+dy*(s._testDY||0));
    for(const h of [.12,.28,.5]) {
      const x=p.x+dx*speed*h,y=p.y+dy*speed*h;
      for(const e of near) {
        const ex=e.x+(e.vx||0)*h,ey=e.y+(e.vy||0)*h;
        const pad=e.type==='bomber'?e.aoe+8:e.isBoss?16:8;
        const clearance=Math.hypot(x-ex,y-ey)-p.r-e.r-pad;
        if(e.dmg>0||e.boomDmg>0)score-=clearance<0?500+Math.min(100,-clearance*3):Math.max(0,35-clearance)*1.5;
      }
      for(const e of shots) {
        const clearance=Math.hypot(x-e.x-e.vx*h,y-e.y-e.vy*h)-p.r-e.r-6;
        if(clearance<0)score-=240;
      }
      for(const z of s.hazards) {
        if(z.kind==='scorch'||z.warm>h||z.life<=h)continue;
        if(z.kind==='poisonTrail') {
          for(const q of z.points||[])if(Math.hypot(x-q.x,y-q.y)<p.r+z.r+8){score-=150;break;}
        } else if(Math.hypot(x-z.x,y-z.y)<p.r+z.r+8)score-=180;
      }
    }
    if(score>bestScore){bestScore=score;bestX=dx;bestY=dy;}
  }
  s._testDX=bestX;s._testDY=bestY;SV.Input.axis.x=bestX;SV.Input.axis.y=bestY;
};
