/* Presentation coordinates only: river occupies its own track, never a board cell. */
(function(root){'use strict';
function geometry(s){
 const river=Number.isInteger(s.river)&&s.river>=0&&s.river<s.height-1?s.river:null,gap=river===null?0:70,north=river===null?s.height:river+1,height=s.height*100+gap;
 const top=y=>y*100+(river!==null&&y>river?gap:0),center=q=>({x:q.x*100+50,y:top(q.y)+50}),point=q=>{const p=center(q);return p.x+','+p.y;};
 return {river,gap,north,height,rows:height/100,top,center,point,gridRow:y=>y+1+(river!==null&&y>river?1:0),tracks:river===null?`repeat(${s.height},minmax(0,1fr))`:`repeat(${north},minmax(0,1fr)) .7fr repeat(${s.height-north},minmax(0,1fr))`,riverY:north*100+gap/2};
}
// SVG auto-orientation needs a nonzero final segment. Stop at the destination,
// rather than appending it twice (or tracing a projectile past its impact).
function routePoints(from,path=[],to){const out=[];for(const q of [from,...path,to]){if(!q)continue;const last=out.at(-1);if(!last||last.x!==q.x||last.y!==q.y)out.push(q);if(to&&out.length>1&&q.x===to.x&&q.y===to.y)break;}return out;}
const api={geometry,routePoints};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.XQView=api;
})(typeof globalThis!=='undefined'?globalThis:this);
