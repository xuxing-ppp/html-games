import * as THREE from 'three';
function M(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }

function makeKartMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color, metalness: .3, roughness: .32 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });
  const white = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x264b59, metalness: .55, roughness: .18 });
  const metal = new THREE.MeshLambertMaterial({ color: 0x9aa0a6 });
  const lightM = new THREE.MeshLambertMaterial({ color: 0xffe89a });

  g.add(M(new THREE.BoxGeometry(3.0, 0.45, 4.6), dark, 0, 0.45, 0));        // 底盘
  g.add(M(roundedBody(2.2, 0.7, 3.8), body, 0, 0.98, 0));          // 车身
  g.add(M(roundedBody(2.0, 0.45, 1.4), body, 0, 0.82, 2.0));       // 引擎盖
  g.add(M(new THREE.BoxGeometry(0.55, 0.08, 3.7), white, 0, 1.34, 0));       // 白色条纹
  g.add(M(new THREE.BoxGeometry(1.7, 0.8, 1.6), body, 0, 1.6, -0.3));        // 座舱
  g.add(M(new THREE.BoxGeometry(1.4, 0.5, 0.08), glass, 0, 1.62, 0.55));     // 前挡风
  g.add(M(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshLambertMaterial({ color: 0xffe0b2 }), 0, 2.05, -0.3)); // 头
  // 尾翼
  g.add(M(new THREE.BoxGeometry(2.5, 0.12, 0.7), white, 0, 1.5, -2.05));
  g.add(M(new THREE.BoxGeometry(0.14, 0.45, 0.3), dark, 0.95, 1.28, -2.05));
  g.add(M(new THREE.BoxGeometry(0.14, 0.45, 0.3), dark, -0.95, 1.28, -2.05));
  // 前保险杠 + 大灯
  g.add(M(new THREE.BoxGeometry(2.6, 0.4, 0.5), dark, 0, 0.72, 2.25));
  g.add(M(new THREE.SphereGeometry(0.2, 10, 8), lightM, 0.75, 0.9, 2.32));
  g.add(M(new THREE.SphereGeometry(0.2, 10, 8), lightM, -0.75, 0.9, 2.32));
  // 排气管
  g.add(M(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), metal, 0.6, 0.55, -2.35));
  g.add(M(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 8), metal, -0.6, 0.55, -2.35));

  // 车轮 (group, 绕 X 轴滚动)
  const wheels = [];
  for (const [wx, wz] of [[-1.55, 1.5], [1.55, 1.5], [-1.55, -1.45], [1.55, -1.45]]) {
    const wg = new THREE.Group(); wg.position.set(wx, 0.6, wz);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.7, 14), dark); tire.rotation.z = Math.PI / 2; wg.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.72, 10), white); hub.rotation.z = Math.PI / 2; wg.add(hub);
    g.add(wg); wheels.push(wg);
  }
  // 阴影
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.06; g.add(shadow);
  // 双火焰
  const flames = [];
  for (const fx of [0.6, -0.6]) {
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.5, 8), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.9 }));
    fl.rotation.x = Math.PI; fl.position.set(fx, 0.6, -2.7); fl.visible = false; g.add(fl); flames.push(fl);
  }

  // Helmet, visor, tail lights and metallic wheel hubs give the small silhouette readable detail.
  g.add(M(new THREE.SphereGeometry(.49,16,12),body,0,2.16,-.3));
  g.add(M(new THREE.BoxGeometry(.72,.20,.12),glass,0,2.20,.12));
  const redLight=new THREE.MeshBasicMaterial({color:0xff443e});
  for(const x of [-.75,.75]) g.add(M(new THREE.BoxGeometry(.45,.16,.12),redLight,x,.95,-1.94));
  for(const x of [-1.18,1.18])g.add(M(roundedBody(.25,.25,3.4),body,x,.75,0));
  g.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  shadow.castShadow=false;
  g.userData = { wheels, flames, color };
  return g;
}


export { M, makeKartMesh };

function roundedBody(w,h,d) {
  const s=new THREE.Shape(), r=Math.min(h*.25,.14), x=-w/2, y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);
  s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  const g=new THREE.ExtrudeGeometry(s,{depth:d-.16,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.06,bevelThickness:.08,curveSegments:3});
  g.center();return g;
}
