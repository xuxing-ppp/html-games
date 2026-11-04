(function(){
  const $=id=>document.getElementById(id);
  function preview(){const id=$('mapSelect').value,map=W.Terrain.maps[id];if(!map)return;$('mapDesc').textContent=map.desc;
    const c=$('mapPreview'),ctx=c.getContext('2d');ctx.fillStyle='#c4b48b';ctx.fillRect(0,0,c.width,c.height);
    ctx.save();ctx.translate(c.width/2,c.height/2);const size=W.Terrain.bounds(id),zoom=Math.min((c.width-10)/(size.x*2),(c.height-10)/(size.y*2));ctx.scale(zoom,zoom);W.Terrain.trace(ctx,id);ctx.fillStyle='#98af6c';ctx.fill();ctx.clip();
    for(const s of map.shapes){ctx.fillStyle={forest:'#51733d',water:'#76bec2',rock:'#858a77'}[s.type];ctx.fillRect(s.x,s.y,s.w,s.h);}
    ctx.strokeStyle='#fff1cc';ctx.lineWidth=10;ctx.setLineDash([28,28]);ctx.beginPath();ctx.moveTo(0,-size.y);ctx.lineTo(0,size.y);ctx.stroke();ctx.restore();
  }
  function init(){$('mapSelect').innerHTML=Object.entries(W.Terrain.maps).map(([id,m])=>`<option value="${id}">${m.name}</option>`).join('');$('mapSelect').value='meadow';$('mapSelect').onchange=preview;preview();}
  W.Maps={init,preview};
})();
