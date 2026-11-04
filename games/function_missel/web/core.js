/* Pure game rules. Classic script also runs in Node for regression tests. */
(function(root){
'use strict';
const C={xmin:-24,xmax:24,ymin:-15,ymax:15,hp:3,hitR:.28,cluster:.2,margin:2.5,moveDist:3,ds:.18,holes:40,destroy:.6};
const colors=['#ff647c','#59b6ff','#71d49c','#f6cf64','#bb96ed','#ffae63','#65d5cf','#ef98cb'];
const fnames=new Set('sin cos tan asin acos atan sinh cosh tanh exp log ln sqrt abs'.split(' '));
function parse(text,point){
 const tokens=String(text).match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_]+|\*\*|[^\s]/g)||[];
 if(!tokens.length)throw Error('请输入函数'); if(tokens.length>512)throw Error('表达式过长');let i=0;
 function expr(min=0,depth=0){if(depth>80)throw Error('表达式嵌套过深');let t=tokens[i++],n;
  if(t==='+'||t==='-')n={op:'u'+t,a:expr(25,depth+1)};
  else if(t==='('){n=expr(0,depth+1);if(tokens[i++]!==')')throw Error('括号不完整');}
  else if(t==='x')n={op:'x'};
  else if(t==='pi'||t==='E')n={op:'n',v:t==='pi'?Math.PI:Math.E};
  else if(t&&/^(?:\d|\.)/.test(t))n={op:'n',v:Number(t)};
  else if(fnames.has(t)){if(tokens[i++]!=='(')throw Error('函数名后需要括号');const a=expr(0,depth+1);let b;if(tokens[i]===','){i++;b=expr(0,depth+1);}if(tokens[i++]!==')')throw Error('括号不完整');if(b&&t!=='log')throw Error('此函数只接受一个参数');n={op:t,a,b};}
  else throw Error('仅支持 x、数学运算和帮助中列出的函数');
  while(i<tokens.length){const op=tokens[i],p=op==='+'||op==='-'?10:op==='*'||op==='/'?20:op==='**'?30:-1;if(p<min)break;i++;n={op,a:n,b:expr(op==='**'?p:p+1,depth+1)};}return n;
 }
 const ast=expr();if(i!==tokens.length)throw Error('请检查运算符与括号');
 function ev(n,x){if(n.op==='n')return[n.v,0];if(n.op==='x')return[x,1];const [a,d]=ev(n.a,x);let b,e;if(n.b)[b,e]=ev(n.b,x);switch(n.op){
 case'u+':return[a,d];case'u-':return[-a,-d];case'+':return[a+b,d+e];case'-':return[a-b,d-e];case'*':return[a*b,d*b+a*e];case'/':return[a/b,(d*b-a*e)/(b*b)];case'**':return[Math.pow(a,b),e===0?b*Math.pow(a,b-1)*d:Math.pow(a,b)*(e*Math.log(a)+b*d/a)];
 case'sin':return[Math.sin(a),Math.cos(a)*d];case'cos':return[Math.cos(a),-Math.sin(a)*d];case'tan':return[Math.tan(a),d/Math.cos(a)**2];case'asin':return[Math.asin(a),d/Math.sqrt(1-a*a)];case'acos':return[Math.acos(a),-d/Math.sqrt(1-a*a)];case'atan':return[Math.atan(a),d/(1+a*a)];case'sinh':return[Math.sinh(a),Math.cosh(a)*d];case'cosh':return[Math.cosh(a),Math.sinh(a)*d];case'tanh':return[Math.tanh(a),d/Math.cosh(a)**2];case'exp':return[Math.exp(a),Math.exp(a)*d];case'log':case'ln':return n.b?[Math.log(a)/Math.log(b),(d/a*Math.log(b)-Math.log(a)*e/b)/Math.log(b)**2]:[Math.log(a),d/a];case'sqrt':return[Math.sqrt(a),d/(2*Math.sqrt(a))];case'abs':return[Math.abs(a),NaN];default:throw Error('无效函数');}}
 const f=ev(ast,point.x)[0];if(!Number.isFinite(f))throw Error('函数在你的位置无定义或不是实数');const c=point.y-f;
 return{raw:String(text),c,value(x){const y=ev(ast,x)[0]+c;return Number.isFinite(y)?y:null;},slope(x){const d=ev(ast,x)[1];return Number.isFinite(d)?d:null;},display(){return 'y = '+text+(Math.abs(c)<.0005?'':(c<0?' − ':' + ')+Math.abs(c).toFixed(3));}};
}
function distance(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function segCircle(a,b,c,r){const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((c.x-a.x)*dx+(c.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(a.x+t*dx-c.x,a.y+t*dy-c.y)<=r;}
function base(o,p){return o.r?distance(o,p)<=o.r:Math.abs(p.x-o.x)<=o.w/2&&Math.abs(p.y-o.y)<=o.h/2;}
function solid(o,p){return base(o,p)&&!o.holes.some(h=>distance(h,p)<h.r);}
function carve(o,p){if(o.holes.length<C.holes)o.holes.push({...p,r:C.destroy});}
function valid(w,p,mover){return p.x>=-21.5&&p.x<=21.5&&p.y>=-12.5&&p.y<=12.5&&!w.obstacles.some(o=>solid(o,p))&&!w.players.some(q=>q!==mover&&q.hp>0&&distance(p,q)<3);}
function spawn(humans,ais,rng=Math.random){const rnd=(a,b)=>a+(b-a)*rng(),pt=()=>({x:rnd(-21.5,21.5),y:rnd(-12.5,12.5)}),players=[];
 for(let i=0;i<humans+ais;i++){let best=pt(),score=-1;for(let k=0;k<(i?80:1);k++){const p=pt(),d=Math.min(...players.map(q=>distance(p,q)));if(d>score){score=d;best=p;}}players.push({...best,id:i,name:(i>=humans?'AI ':'玩家 ')+(i+1),ai:i>=humans,hp:3,color:colors[i],moved:false});}
 const obstacles=[],w={players,obstacles};const extent=o=>o.r||Math.max(o.w,o.h)/2;
 function clear(o,cover=false){const e=extent(o);return !players.some(p=>distance(p,o)<e+(cover?.48:1.6))&&!obstacles.some(q=>Math.abs(o.x-q.x)<(q.r||q.w/2)+e+(cover?.3:.5)&&Math.abs(o.y-q.y)<(q.r||q.h/2)+e+(cover?.3:.5));}
 function make(round,x,y,cover=false){const long=rnd(2,6),short=rnd(.5,1.2),horizontal=rng()<.5;return round?{x,y,r:rnd(cover?1.5:.8,cover?2.8:2),holes:[]}:{x,y,w:horizontal?long:short,h:horizontal?short:long,holes:[]};}
 for(const round of [true,false])for(let k=0;k<3+Math.floor(Math.max(0,players.length-2)/2);k++)for(let j=0;j<400;j++){const o=make(round,0,0);o.x=rnd(-23.5+(o.r||o.w/2),23.5-(o.r||o.w/2));o.y=rnd(-14.5+(o.r||o.h/2),14.5-(o.r||o.h/2));if(clear(o)){obstacles.push(o);break;}}
 const edges=new Set();for(const p of players)for(const q of players.filter(q=>q!==p).sort((a,b)=>distance(a,p)-distance(b,p)).slice(0,2)){const key=[p.id,q.id].sort().join(',');if(edges.has(key))continue;edges.add(key);let blocked=false;for(let t=0;t<=1;t+=.01)if(obstacles.some(o=>base(o,{x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t}))){blocked=true;break;}if(blocked)continue;for(const t of [.5,.42,.58,.35,.65,.3,.7]){const o=make(rng()<.5,p.x+(q.x-p.x)*t,p.y+(q.y-p.y)*t,true);if(clear(o,true)){obstacles.push(o);break;}}}
 return w;
}
function bullet(curve,shooter,dir){return{curve,shooter,dir,x:shooter.x,y:shooter.y,alive:true,hits:new Set(),trail:[{x:shooter.x,y:shooter.y}],steps:0};}
function advance(b,w,onHit=()=>{}){if(!b.alive)return;const m=b.curve.slope(b.x)||0;let dx=b.dir*C.ds/Math.sqrt(1+m*m);if(Math.abs(dx)<1e-6)dx=b.dir*C.ds;const p={x:b.x+dx,y:b.curve.value(b.x+dx)};if(p.y===null||Math.abs(p.x)>24||Math.abs(p.y)>15||Math.abs(p.y)>1e6){b.alive=false;return;}
 const ob=w.obstacles.find(o=>solid(o,p));if(ob){carve(ob,p);b.alive=false;}else for(const q of w.players){if(q===b.shooter||q.hp<=0||b.hits.has(q.id))continue;const centers=[q,...[0,1,2,3].map(i=>({x:q.x+.2*Math.cos(i*Math.PI/2),y:q.y+.2*Math.sin(i*Math.PI/2)}))];if(centers.some(c=>segCircle(b,p,c,.28))){b.hits.add(q.id);q.hp=Math.max(0,q.hp-1);onHit(q);}}
 b.x=p.x;b.y=p.y;b.trail.push(p);if(++b.steps>=1e6)b.alive=false;
}
const difficulty={easy:{targets:1,shapes:1,miss:.4,simulate:false},normal:{targets:2,shapes:2,miss:.4,simulate:true},hard:{targets:3,shapes:4,miss:.2,simulate:true}};
function simulate(curve,p,q,obs){let closest=distance(p,q);for(const dir of [1,-1]){let a={x:p.x,y:p.y};for(let k=0;k<1200;k++){let dx=dir*.18/Math.sqrt(1+(curve.slope(a.x)||0)**2);if(Math.abs(dx)<1e-6)dx=dir*.18;const b={x:a.x+dx,y:curve.value(a.x+dx)};if(b.y===null||Math.abs(b.x)>24||Math.abs(b.y)>1e6||obs.some(o=>solid(o,b)))break;const d=distance(b,q);closest=Math.min(closest,d);if(d<=.33)return[true,closest];a=b;}}return[false,closest];}
function choose(w,p,level,rng=Math.random){const d=difficulty[level]||difficulty.normal,others=w.players.filter(q=>q!==p&&q.hp>0),targets=others.slice().sort((a,b)=>distance(a,p)-distance(b,p)).slice(0,d.targets);let reaching=false,scored=[];
 for(const q of targets){const dx=q.x-p.x,dy=q.y-p.y;if(Math.abs(dx)<1e-4)continue;let shapes=[dy/dx,0,(rng()*6-3),(rng()*6-3),(rng()*3-1.5)].slice(0,d.shapes);for(const slope of shapes){let raw=`(${(dy-slope*dx)/(dx*dx)})*(x-(${p.x}))**2+(${slope})*(x-(${p.x}))`;const [hit,near]=simulate(parse(raw,p),p,q,w.obstacles);reaching||=hit;if(!d.simulate&&rng()<d.miss){const tx=q.x+rng()*6-3,ty=q.y+rng()*6-3;raw=Math.abs(tx-p.x)<1e-4?String(p.y):`(${(ty-p.y)/(tx-p.x)})*x`;}scored.push({score:hit?1000-near:-near,raw});}}
 scored.sort((a,b)=>b.score-a.score);let chosen=scored[0]?.raw||String(p.y);if(d.simulate&&scored.length>1&&rng()<d.miss)chosen=scored[Math.floor(scored.length/2)+Math.floor(rng()*(scored.length-Math.floor(scored.length/2)))].raw;
 if(!reaching&&!p.moved){let best=null,score=-1;for(let k=0;k<20;k++){const q={x:-21.5+rng()*43,y:-12.5+rng()*25};if(valid(w,q,p)){const s=Math.min(...others.map(o=>distance(o,q)));if(s>score){score=s;best=q;}}}if(best)return{type:'move',point:best};}
 return{type:'shoot',raw:chosen};
}
root.Missile={C,colors,parse,segCircle,base,solid,carve,valid,spawn,bullet,advance,choose,simulate,difficulty};if(typeof module!=='undefined')module.exports=root.Missile;
})(globalThis);
