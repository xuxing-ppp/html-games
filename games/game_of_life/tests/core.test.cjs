const {test}=require('node:test'),assert=require('node:assert/strict'),K=require('../web/core.js');require('../web/patterns.js');
const cfg=(extra={})=>K.validate({mode:'classic',rows:20,cols:20,pbc:false,rule:'3/23',...extra});
function grid(c,points){const a=new Uint8Array(c.rows*c.cols);for(const[r,x]of points)a[r*c.cols+x]=1;return a;}
test('still life, blinker, glider, all source patterns and transforms',()=>{const c=cfg(),a=grid(c,LifePatterns.Block.map(([r,x])=>[r+4,x+4]));assert.deepEqual(K.step(a,c),a);const b=grid(c,[[5,4],[5,5],[5,6]]);assert.deepEqual(K.step(K.step(b,c),c),b);let g=grid(c,LifePatterns.Glider.map(([r,x])=>[r+4,x+4]));for(let i=0;i<4;i++)g=K.step(g,c);assert.deepEqual(g,grid(c,LifePatterns.Glider.map(([r,x])=>[r+5,x+5])));assert.equal(Object.keys(LifePatterns).length,13);let cells=LifePatterns.Glider;for(let i=0;i<4;i++)cells=K.transform(cells,'cw');assert.deepEqual(cells,LifePatterns.Glider);});
test('PBC differs from OBC; rules and sizes validated',()=>{const c=cfg(),a=grid(c,[[0,0],[0,19],[19,0]]);assert.equal(K.step(a,{...c,pbc:true})[399],1);assert.equal(K.step(a,c)[399],0);for(const s of ['3/23','B36/S23','2/','B/S8','B0/S'])assert.ok(K.parseRule(s));for(const s of ['9/23','/','B3/S2abc','3',''])assert.throws(()=>K.parseRule(s));assert.equal(cfg({rows:10000}).rows,10000);assert.throws(()=>cfg({rows:4}));assert.throws(()=>cfg({rows:10001}));});
test('Logistic freezing, Conway equivalence, growth precedence and endpoints',()=>{const c=cfg({mode:'logistic',lam:1,slo:1.5,shi:2.5,glo:2.5,ghi:3.5}),a=Float32Array.from(grid(c,[[4,4],[4,5],[4,6]]));assert.deepEqual(Array.from(K.step(a,c)),Array.from(K.step(Uint8Array.from(a),cfg())));assert.deepEqual(K.step(a,{...c,lam:0}),a);const b=new Float32Array(400);b[20*5+5]=.2;b[20*4+5]=1;b[20*5+4]=1;b[20*5+6]=1;assert.ok(Math.abs(K.step(b,{...c,lam:.5,slo:0,shi:8})[105]-.6)<1e-6);assert.throws(()=>K.validate({...c,lam:1.1}));assert.throws(()=>K.validate({...c,slo:3,shi:2}));});

test('matches captured original NumPy results for 16 configurations over 8 generations',()=>{
 const fixture=require('./fixtures/python-rules.json');
 for(const item of fixture.cases){
  const c=K.validate({...item.config});let a=c.mode==='classic'?Uint8Array.from(item.initial):Float32Array.from(item.initial);
  for(let generation=0;generation<item.expected.length;generation++){
   a=K.step(a,c);const expected=item.expected[generation];assert.equal(a.length,expected.length);
   for(let i=0;i<a.length;i++)assert.ok(Math.abs(a[i]-expected[i])<=1e-6+Math.abs(expected[i])*1e-6,`${c.mode}, pbc=${c.pbc}, rule=${c.rule}, lambda=${c.lam}, generation=${generation+1}, cell=${i}: ${a[i]} != ${expected[i]}`);
  }
 }
});
