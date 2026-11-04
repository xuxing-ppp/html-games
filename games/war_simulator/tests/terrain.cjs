// Geometry and live simulation regressions for the fixed tactical maps.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const nodes=new Map();function node(id){if(!nodes.has(id))nodes.set(id,{value:id==='battleMode'?'classic':id==='formation'?'single':'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},textContent:'',innerHTML:''});return nodes.get(id);}
const ctx=vm.createContext({console,Math,performance:{now:()=>1000},setTimeout:()=>0,clearTimeout(){},document:{getElementById:node,querySelectorAll:()=>[],body:{classList:{toggle(){}}}},window:{},requestAnimationFrame(){}});
for(const file of ['namespace','util','config','roster','physics','ai','projectiles','specials','effects','terrain','ui','abilities','game','lab'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',file+'.js'),'utf8'),ctx);
const run=s=>vm.runInContext(s,ctx);run('W.Renderer={fit(){}}');
assert.equal(run('W.Config.CONST.BOUND_X/W.Config.CONST.BOUND_Y'),2);
assert.equal(run('Object.keys(W.Terrain.maps).length'),5);
run("W.Terrain.setMap('woodland')");assert.equal(run('W.Terrain.speedAt({x:200,y:-280})'),.8);
run("W.Terrain.setMap('wetlands')");assert.equal(run('W.Terrain.speedAt({x:200,y:-280})'),.6);assert.equal(run('W.Terrain.speedAt({x:0,y:0})'),1);
for(const id of ['meadow','woodland','wetlands','pass','crossings']){
 run(`W.Terrain.setMap('${id}');W.Game.clearAll();`);
 assert.equal(run('W.Terrain.passable({x:0,y:0},35)'),true,'Central objective accessible');
 run("for(const team of ['red','blue'])W.Game.randomArmy(team,2500);");
 assert.equal(run('W.Game.state.units.every(u=>W.Terrain.passable(u.pos,u.radius))'),true,'Random army outside rocks');
 assert.equal(run('W.Game.state.units.every((u,i)=>W.Game.state.units.slice(0,i).every(v=>Math.hypot(u.pos.x-v.pos.x,u.pos.y-v.pos.y)>=u.radius+v.radius+2))'),true,'Random army separated');
 for(const type of ['giant','lancer','archer']){
  run(`W.Game.clearAll();var a=W.Game.createUnit('${type}','red',-480,-240),b=W.Game.createUnit('shielder','blue',480,-240);var route=W.Terrain.path(a.pos,b.pos,a.radius);`);
  assert.ok(run('route.length>0'),id+' '+type+' finds path');
  assert.equal(run('route.every((p,i)=>W.Terrain.passable(p,a.radius)&&(i===0?W.Terrain.lineClear(a.pos,p,a.radius):W.Terrain.lineClear(route[i-1],p,a.radius)))'),true,'Body fits each segment');
 }
}
run("W.Terrain.setMap('pass');W.Game.clearAll();W.Game.state.input.selectedTypeId='tribesman';W.Lab.place({x:-300,y:-160});");assert.equal(run('W.Game.state.units.length'),0,'Cannot deploy inside rock');
run("var body=W.Game.createUnit('giant','red',-300,-160);body.vel.vx=5;W.Terrain.collideTerrain(body)");assert.equal(run('W.Terrain.passable(body.pos,body.radius)'),true,'Resolve body deep inside rock');
run("W.Game.clearAll();var ar=W.Game.createUnit('archer','red',-460,-160);var target=W.Game.createUnit('archer','blue',-120,-160);W.Projectiles.spawn(ar,0,W.Config.UNIT_TYPES.archer.projectile);for(var i=0;i<60;i++)W.Projectiles.step(1/60)");assert.equal(run('target.hp===target.maxHp'),true,'Rock blocks projectile');assert.equal(run('W.Projectiles.list.length'),0);
// Follow the real steering with a kinematic body, including the largest radius.
for(const goal of [{x:480,y:-240},{x:0,y:0}]){
 run(`W.Game.clearAll();var walker=W.Game.createUnit('giant','red',-480,-240);var destination=${JSON.stringify(goal)};var reached=false;for(var i=0;i<1800;i++){walker.thrustX=100;walker.thrustY=0;W.Terrain.steer(walker,destination,1/60);walker.pos.x+=walker.thrustX/60;walker.pos.y+=walker.thrustY/60;W.Terrain.collideTerrain(walker);if(Math.hypot(walker.pos.x-destination.x,walker.pos.y-destination.y)<25){reached=true;break;}}`);
 assert.equal(run('reached'),true,'Giant routes around rock to enemy/objective');
}
// Real AI and physics on the obstacle map, covering ranged closing and retreat.
run("W.Game.clearAll();W.Game.createUnit('lancer','red',-480,-240);W.Game.createUnit('archer','blue',480,-240);W.Game.startBattle();for(var i=0;i<10801&&!W.Game.state.winner;i++)W.Game.step(1/60);");assert.ok(run('W.Game.state.winner'),'Obstacle battle resolves');assert.equal(run('W.Game.state.units.every(u=>Number.isFinite(u.pos.x)&&Number.isFinite(u.pos.y))'),true);
console.log('PASS: five maps, individual polygon boundaries, slow terrain, largest-body paths, collision recovery, blocked deployment/shots, nonoverlapping random armies, obstacle battle and objective routing.');

for(const id of ['meadow','woodland','wetlands','pass','crossings']){
 run(`W.Terrain.setMap('${id}');W.Game.clearAll();`);
 assert.equal(run('W.Terrain.contains({x:0,y:0},35)'),true,'Center reachable');
 assert.equal(run('W.Config.CONST.BOUND_X===W.Terrain.bounds().x'),true,'Dynamic map width');
 run('var edges=W.Terrain.maps[W.Terrain.current].edges;var allInside=true;for(const edge of edges){for(const pos of [edge.a,{x:(edge.a.x+edge.b.x)/2,y:(edge.a.y+edge.b.y)/2}]){var unit={pos:{...pos},vel:{vx:100,vy:-100},radius:28};W.Terrain.collideBoundary(unit);if(!W.Terrain.contains(unit.pos,28))allInside=false;}}');
 assert.equal(run('allInside'),true,'Largest body recovers from every vertex and edge on '+id);
 const extent=run('W.Terrain.bounds()');
 run(`var unit={pos:{x:${extent.x+50},y:0},vel:{vx:300,vy:0},radius:28};W.Terrain.collideBoundary(unit);`);
 assert.equal(run('W.Terrain.contains(unit.pos,28)'),true,'Outside body returns inside');
}
run("W.Terrain.setMap('pass')");assert.equal(run('W.Terrain.contains({x:0,y:-300},0)'),false,'Waist cutout not playable');assert.equal(run('W.Terrain.lineClear({x:-500,y:-380},{x:500,y:-380},0)'),false,'Cannot cut across outside bay');
run("W.Terrain.setMap('crossings')");assert.notEqual(run('W.Terrain.contains({x:-750,y:250},0)'),run('W.Terrain.contains({x:750,y:250},0)'),'Asymmetric outlines affect actual play');
console.log('PASS: individual extents, irregular/concave/asymmetric boundaries, full-body edge/vertex recovery and no paths across outside bays.');

for(const id of Object.keys(run('W.Terrain.maps'))){
 run(`W.Terrain.setMap('${id}');var recovered=true;for(const rock of W.Terrain.shapes.filter(s=>s.type==='rock')){var body={pos:{x:rock.x+rock.w/2,y:rock.y+rock.h/2},vel:{vx:10,vy:0},radius:28};W.Terrain.collideTerrain(body);W.Terrain.collideBoundary(body);if(!W.Terrain.passable(body.pos,28))recovered=false;}`);
 assert.equal(run('recovered'),true,'Rock and map boundary recovery agree on '+id);
}
run("W.Terrain.setMap('woodland');W.Game.clearAll();var slow=W.Game.createUnit('archer','red',-250,-280);W.Game.createUnit('archer','blue',250,0);slow.slowTime=1;W.AI.update(slow,1/60)");assert.ok(run('Math.abs(slow.moveSpeed-W.Config.UNIT_TYPES.archer.moveSpeed*.8*.55)<1e-7'),'Forest and frost multiply');
console.log('PASS: obstacle/boundary collision agreement and terrain/skill slowdown composition.');
