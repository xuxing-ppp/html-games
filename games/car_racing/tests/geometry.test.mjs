import test from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS } from '../src/world/tracks.js';
import { buildLine, resamplePoly } from '../src/world/geometry.js';

function cross(a,b,c){return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);}
for (const track of TRACKS) {
  test(`${track.name}: closed centerline is finite and traversable`,()=>{
    const line=resamplePoly(buildLine(track.verts,track.R),500);
    assert.equal(line.length,500);
    assert.ok(line.every(p=>p.every(Number.isFinite)));
    const distances=line.map((p,i)=>Math.hypot(p[0]-line[(i+1)%500][0],p[1]-line[(i+1)%500][1]));
    assert.ok(Math.min(...distances)>.01,'No duplicate consecutive points');
    assert.ok(Math.max(...distances)<30,'No discontinuities');
  });
}
for(const track of TRACKS.slice(8)) {
  test(`${track.name}: base outline has no crossing centerline`,()=>{
    const line=resamplePoly(buildLine(track.verts,track.R),500);
    for(let i=0;i<500;i++)for(let j=i+2;j<500;j++) {
      if(i===0&&j===499)continue;
      const a=line[i],b=line[(i+1)%500],c=line[j],d=line[(j+1)%500];
      assert.ok(!(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0),`Segments ${i}, ${j} cross`);
    }
  });
}
