(function(root){
const canvas=document.getElementById('board'),ctx=canvas.getContext('2d');let width=0,height=0,scale=1,ox=0,oy=0;
function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;width=r.width;height=r.height;canvas.width=Math.round(width*d);canvas.height=Math.round(height*d);ctx.setTransform(d,0,0,d,0,0);scale=Math.max(.1,Math.min((width-36)/48,(height-36)/30));ox=width/2;oy=height/2+4;}
new ResizeObserver(resize).observe(canvas);
function to(p){return{x:ox+p.x*scale,y:oy-p.y*scale};}function from(x,y){return{x:(x-ox)/scale,y:(oy-y)/scale};}
function path(points,color,lw=1){ctx.beginPath();points.forEach((p,i)=>{p=to(p);i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)});ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.stroke();}
function draw(w,curve,bullets=[],coords=false,move=null,fx=[]){if(!width)return;ctx.clearRect(0,0,width,height);ctx.font='12px Menlo,monospace';ctx.textAlign='center';
 for(let x=-24;x<=24;x++){path([{x,y:-15},{x,y:15}],x===0?'#7891a6':x%5===0?'#315169':'#203b50');if(x%(scale<10?10:5)===0){const p=to({x,y:0});ctx.fillStyle='#99afc0';ctx.fillText(x,p.x,p.y+15);}}
 for(let y=-15;y<=15;y++){path([{x:-24,y},{x:24,y}],y===0?'#7891a6':y%5===0?'#315169':'#203b50');if(y%(scale<10?10:5)===0&&y){const p=to({x:0,y});ctx.fillStyle='#99afc0';ctx.fillText(y,p.x+17,p.y+4);}}
 path([{x:-24,y:-15},{x:24,y:-15},{x:24,y:15},{x:-24,y:15},{x:-24,y:-15}],'#7492a7');
 for(const o of w.obstacles){const p=to(o),e=o.r||Math.max(o.w,o.h)/2,pad=2;const side=Math.ceil(e*2*scale+pad*2),layer=document.createElement('canvas');layer.width=side;layer.height=side;const g=layer.getContext('2d'),mid=side/2;g.fillStyle='#526879';g.strokeStyle='#9aaeb8';g.lineWidth=1;g.beginPath();o.r?g.arc(mid,mid,o.r*scale,0,Math.PI*2):g.rect(mid-o.w*scale/2,mid-o.h*scale/2,o.w*scale,o.h*scale);g.fill();g.stroke();g.globalCompositeOperation='destination-out';for(const h of o.holes){g.beginPath();g.arc(mid+(h.x-o.x)*scale,mid-(h.y-o.y)*scale,h.r*scale,0,Math.PI*2);g.fill();}ctx.drawImage(layer,p.x-mid,p.y-mid);}
 if(curve){ctx.save();const a=to({x:-24,y:15});ctx.beginPath();ctx.rect(a.x,a.y,48*scale,30*scale);ctx.clip();let points=[];for(let x=-24;x<=24;x+=.055){const y=curve.value(x);if(y===null||Math.abs(y)>100||points.length&&Math.abs(y-points.at(-1).y)>10){if(points.length)path(points,'#fa9d7188',2);points=[];}else points.push({x,y});}if(points.length)path(points,'#fa9d7188',2);ctx.restore();}
 for(const b of bullets){path(b.trail,'#ff9259',2);const p=to(b);ctx.fillStyle='#ffe7a3';ctx.beginPath();ctx.arc(p.x,p.y,4,0,7);ctx.fill();}
 for(const p of w.players){if(p.hp<=0)continue;const s=to(p),r=Math.max(5,.48*scale);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(s.x,s.y,r,0,7);ctx.fill();ctx.strokeStyle=p.color;ctx.beginPath();ctx.arc(s.x,s.y,r+4,0,7);ctx.stroke();ctx.fillStyle='#eef3f4';ctx.font='13px "PingFang SC",sans-serif';ctx.fillText(p.name,s.x,s.y-r-10);for(let i=0;i<3;i++){ctx.fillStyle=i<p.hp?p.color:'#33485a';ctx.fillRect(s.x-12+i*9,s.y+r+9,6,4);}if(coords){ctx.font='11px Menlo,monospace';ctx.fillText(`(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`,s.x,s.y+r+28);}}
 if(move){const p=to(move);ctx.strokeStyle=move.valid?'#75d9a4':'#ff7771';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(8,.65*scale),0,7);ctx.stroke();}
 for(const f of (matchMedia('(prefers-reduced-motion: reduce)').matches?[]:fx)){const p=to(f);ctx.strokeStyle=`rgba(255,174,87,${1-f.age/650})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(1,f.age/650*(f.fatal?2.6:1.3)*scale),0,7);ctx.stroke();}
}
root.MissileView={draw,to,from,resize};
})(globalThis);
